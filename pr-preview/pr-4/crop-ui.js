// Crop cube -> DICOM export (PC / desktop browsers; no GPU shader, VR, Mac or iPad code path is touched).
// One button opens a small panel: size (128 / 256 / 512 voxels per side), position (box centre, voxels), rotation and interpolation (shown only
// when rotated). The box is drawn in the three slice views (cross-section with the slice on show; drag inside to move, drag just outside a corner
// to rotate about the view normal: crop-interact.js; no rotation sliders, a numeric angle in the collapsed details). The panel says whether the
// export will copy the original values or interpolate
// and in 3D (12 edges, SVG overlay like the HU line). "Export" writes a folder of DICOM files (showDirectoryPicker) or a .zip.
// The values come from the ORIGINAL source files (crop-export.js), never from the display texture or the filter pipeline.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { volume, activeSeries, sourceVolume, sceneState } from './state.js?v=20261022-build643';
import { planes } from './ui-shell.js?v=20261022-build643';
import { tr } from './i18n.js?v=20261022-build643';
import { setCropOverlayPainter, requestOverlayDraw } from './crosshair-ui.js?v=20261022-build643';
import { clientToFraction, voxelToLocal3D } from './crosshair.js?v=20261022-build643';
import { schedulePlaneRender } from './mpr-render.js?v=20261022-build643';
import { request3DRender } from './scene3d.js?v=20261022-build643';
import { downloadBlob, isIPhoneRuntime, isTabletRuntime } from './utils.js?v=20261022-build643';
import { decodeCompressedDicomSlice } from './volume-io.js?v=20261022-build643';
import { defaultCropBox, effectiveBox, boxAligned, boxRotation, setBoxRotation, rotationMatrix, IDENTITY3, planeSection, pointInPolygon, boxCorners, BOX_EDGES, clampCenter, seriesGeometry, rotationBlockReason } from './crop-geometry.js?v=20261022-build643';
import { exportCrop, directorySink, zipSink, rotatedBlockBytes, rotatedBlockLimitFor, checkExportable, CropExportError } from './crop-export.js?v=20261022-build643';
import { namingFor } from './crop-dicom.js?v=20261022-build643';
import { classifyPoint, pointerAngle, wrapDelta, rotateAboutViewStep, ROTATE_BAND_PX, SNAP_STEP_DEG, FINE_STEP_DEG } from './crop-interact.js?v=20261022-build643';

// Hide the whole feature (button and panel) until the experts have verified the output: set to false.
export const CROP_EXPORT_UI_ENABLED = true;

const PINK = '#ff6ad5', PLANE_AXES = { axial: ['i', 'j'], coronal: ['i', 'k'], sagittal: ['j', 'k'] };
// error code -> i18n key (the CropExportError codes of crop-source.js / crop-export.js)
const ERR_KEYS = {
  'too-large': 'cropErrLarge', tilt: 'cropErrTilt', geometry: 'cropErrGeom', spacing: 'cropErrSpacing', 'unsupported-samples': 'cropErrSamples', 'unsupported-multiframe': 'cropErrMulti',
  'unsupported-bits': 'cropErrBits', 'unsupported-photometric': 'cropErrBits', 'unsupported-highbit': 'cropErrBits', 'unsupported-rescale': 'cropErrBits', 'unsupported-empty': 'cropErrBits',
  'mixed-storage': 'cropErrMixed', 'mixed-size': 'cropErrMixed', 'rescale-overflow': 'cropErrOverflow', 'not-exact': 'cropErrExact',
};
const st = { open: false, box: null, busy: false, cancel: false, drag: null, hover: null };
const $ = id => document.getElementById(id);
let host = null, svg = null, lines = [];
const dimsOf = v => ({ columns: v.columns, rows: v.rows, slices: v.slices });
const spacingOf = () => (activeSeries ? [activeSeries.spacingX, activeSeries.spacingY, activeSeries.spacingZ] : volume?.spacing || [1, 1, 1]);
export const cropOpen = () => st.open;

// ---- overlay in the slice views ----
function paintCrop(ctx, p, geo) {
  if (!ctx || !st.open || !st.box || !volume) return;
  const eff = effectiveBox(st.box), sp = spacingOf(), dims = dimsOf(volume), s = +planes[p].slider.value;
  const poly = planeSection(eff, sp, p, s);
  if (poly.length < 3) return;
  const [w, h] = p === 'axial' ? [dims.columns, dims.rows] : p === 'coronal' ? [dims.columns, dims.slices] : [dims.rows, dims.slices];
  const pt = ([u, v]) => { // plane index coordinates -> canvas px (voxel centre i is at (i+.5)/w; k is drawn upside down)
    const fx = (u + 0.5) / w, fy = p === 'axial' ? (v + 0.5) / h : (dims.slices - 1 - v + 0.5) / h;
    return [geo.x0 + fx * geo.w, geo.y0 + fy * geo.h];
  };
  const path = () => { ctx.beginPath(); poly.forEach((q, i) => { const [x, y] = pt(q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
  ctx.lineJoin = 'round'; path(); ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 5; ctx.stroke(); path(); ctx.strokeStyle = PINK; ctx.lineWidth = 2.2; ctx.stroke();
  const hv = st.hover, rotating = st.drag?.mode === 'rotate' && st.drag.p === p;
  if (hv && hv.p === p && hv.zone === 'rotate' && !st.drag && hv.corner < poly.length) { const [x, y] = pt(poly[hv.corner]); ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.fillStyle = PINK; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  if (rotating || (hv && hv.p === p && hv.zone === 'rotate' && !st.drag)) paintRotateIcon(ctx, geo.x0 + (rotating ? st.drag.fx : hv.fx) * geo.w + 17, geo.y0 + (rotating ? st.drag.fy : hv.fy) * geo.h - 17);
  if (rotating) paintAngleLabel(ctx, geo.x0 + st.drag.fx * geo.w + 32, geo.y0 + st.drag.fy * geo.h - 17, st.drag.shown || 0);
}
// amount of the current drag next to the icon: ↺ = counter-clockwise, ↻ = clockwise on screen (whole degrees: the drag snaps to 1 or 15)
function paintAngleLabel(ctx, x, y, deg) {
  const n = Math.round(deg) + 0, text = (n > 0 ? '↺ ' : n < 0 ? '↻ ' : '') + Math.abs(n) + '°';
  ctx.save(); ctx.font = '600 13px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - 11, w, 22, 6) : ctx.rect(x, y - 11, w, 22); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(text, x + 6, y); ctx.restore();
}
// small circular arrow (drawn, no CSS cursor): dark badge, pink 270 degree arc with an arrow head
function paintRotateIcon(ctx, x, y) {
  const r = 9;
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 6.2832); ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, -0.6, 4.1); ctx.strokeStyle = PINK; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.stroke();
  const a = 4.1, tx = x + r * Math.cos(a), ty = y + r * Math.sin(a), dx = -Math.sin(a), dy = Math.cos(a), nx = Math.cos(a), ny = Math.sin(a);
  ctx.beginPath(); ctx.moveTo(tx + dx * 5, ty + dy * 5); ctx.lineTo(tx + nx * 4, ty + ny * 4); ctx.lineTo(tx - nx * 4, ty - ny * 4); ctx.closePath(); ctx.fillStyle = PINK; ctx.fill();
  ctx.restore();
}

// ---- 3D overlay ----
function mkSvg(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; }
export function updateCrop3d() {
  if (!svg) return;
  const s = sceneState, obj = s?.obj, camera = s?.camera, show = st.open && !!st.box && !!volume && !!obj && !!camera && host.clientWidth > 8;
  svg.style.display = show ? '' : 'none'; svg.dataset.visible = show ? '1' : '0';
  if (!show) return;
  const W = host.clientWidth, H = host.clientHeight, dims = dimsOf(volume), sp = spacingOf();
  obj.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const pts = boxCorners(effectiveBox(st.box), sp).map(([i, j, k]) => {
    const l = voxelToLocal3D({ i, j, k }, dims, volume.spacing), q = new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(obj.matrixWorld).project(camera);
    return { x: (q.x + 1) / 2 * W, y: (1 - q.y) / 2 * H, ok: q.z > -1 && q.z < 1 };
  });
  BOX_EDGES.forEach(([a, b], n) => {
    const ok = pts[a].ok && pts[b].ok, [halo, line] = lines[n];
    for (const ln of [halo, line]) { ln.setAttribute('visibility', ok ? 'visible' : 'hidden'); if (ok) { ln.setAttribute('x1', pts[a].x.toFixed(1)); ln.setAttribute('y1', pts[a].y.toFixed(1)); ln.setAttribute('x2', pts[b].x.toFixed(1)); ln.setAttribute('y2', pts[b].y.toFixed(1)); } }
  });
}
export function installCrop3d(viewportEl) {
  if (host || !viewportEl || !CROP_EXPORT_UI_ENABLED) return;
  host = viewportEl;
  svg = mkSvg('svg', { class: 'crop-3d', 'aria-hidden': 'true' });
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', display: 'none', zIndex: '6' });
  lines = BOX_EDGES.map(() => [mkSvg('line', { stroke: 'rgba(0,0,0,.6)', 'stroke-width': '4.5', 'stroke-linecap': 'round' }), mkSvg('line', { stroke: PINK, 'stroke-width': '2', 'stroke-linecap': 'round' })]);
  for (const [h, l] of lines) svg.append(h);
  for (const [, l] of lines) svg.append(l);
  host.appendChild(svg);
}

// ---- panel ----
const ids = { size: 'crop-size', interp: 'crop-interp', straight: 'crop-straight', px: 'crop-pos-x', py: 'crop-pos-y', pz: 'crop-pos-z', rx: 'crop-rot-x', ry: 'crop-rot-y', rz: 'crop-rot-z' };
function setText(id, t) { const e = $(id); if (e) e.textContent = t; }
function syncPanel() {
  if (!st.box || !volume) return;
  const b = st.box, dims = dimsOf(volume), rot = !boxAligned(b), eff = effectiveBox(b), geom = activeSeries ? seriesGeometry(activeSeries) : null, why = geom ? rotationBlockReason(geom) : 'tilt', canRot = !why;
  const set = (id, v, max) => { const e = $(id); if (!e) return; if (max != null) e.max = String(max); if (e !== document.activeElement) e.value = String(v); // the slider being dragged keeps its thumb
     setText(id + '-out', Number.isInteger(v) ? String(v) : v.toFixed(1)); };
  set(ids.px, eff.center.i, dims.columns - 1); set(ids.py, eff.center.j, dims.rows - 1); set(ids.pz, eff.center.k, dims.slices - 1);
  set(ids.rx, b.angles.x); set(ids.ry, b.angles.y); set(ids.rz, b.angles.z); // derived readout of b.R (the numeric inputs sit in the collapsed details)
  for (const id of [ids.rx, ids.ry, ids.rz]) { const e = $(id); if (e) { e.disabled = !canRot || st.busy; e.title = canRot ? '' : tr(ERR_KEYS[why]); } }
  setText('crop-angle', rot ? ['x', 'y', 'z'].filter(k => b.angles[k] !== 0).map(k => k.toUpperCase() + ' ' + +b.angles[k].toFixed(1) + '°').join(' ') || '0°' : '0°'); // derived from R
  const straight = $(ids.straight); if (straight) straight.disabled = !rot || st.busy;
  const hint = $('crop-hint'); if (hint) { hint.textContent = canRot ? tr('cropHint') : tr(ERR_KEYS[why]); hint.classList.toggle('is-warn', !canRot); }
  const sel = $(ids.interp); if (sel) { sel.value = b.interp; sel.disabled = !rot || st.busy; sel.closest('.crop-row')?.classList.toggle('is-hidden', !rot); } // the choice only exists when rotated
  const size = $(ids.size); if (size) { size.value = String(b.n); size.disabled = st.busy; }
  for (const id of [ids.px, ids.py, ids.pz]) { const e = $(id); if (e) e.disabled = st.busy; }
  setText('crop-mode', rot ? tr('cropModeResample') + ' · ' + tr({ nearest: 'cropNearest', linear: 'cropLinear', cubic: 'cropCubic' }[b.interp]) : tr('cropModeCopy'));
  const mode = $('crop-mode'); if (mode) mode.dataset.state = rot ? 'resample' : 'copy'; // same test as the exporter (boxAligned: R is exactly the identity)
  const run = $('crop-run'); if (run) { run.disabled = false; run.textContent = st.busy ? tr('cropCancel') : tr('cropExport'); run.dataset.i18n = st.busy ? 'cropCancel' : 'cropExport'; }
  const reset = $('crop-reset'); if (reset) reset.disabled = st.busy;
}
function changed(follow = false) {
  syncPanel(); requestOverlayDraw(); updateCrop3d(); request3DRender();
  if (follow && st.box && volume) { // bring the three slice views to the box centre so the box is seen
    const eff = effectiveBox(st.box), idx = { axial: Math.round(eff.center.k), coronal: Math.round(eff.center.j), sagittal: Math.round(eff.center.i) };
    for (const p of Object.keys(idx)) { const s = planes[p]?.slider; if (s && !s.disabled) { s.value = String(Math.max(0, Math.min(+s.max, idx[p]))); schedulePlaneRender(p, true); } }
  }
}
function straighten() { if (st.box && !st.busy) { setBoxRotation(st.box, IDENTITY3()); changed(); } }
function resetBox() { if (volume) st.box = defaultCropBox(dimsOf(volume), st.box?.n || 256); changed(true); }
function setOpen(on) {
  st.open = !!on && !!volume && !!activeSeries; $('crop-export-panel')?.classList.toggle('is-hidden', !st.open); $('crop-export-toggle')?.classList.toggle('is-active', st.open);
  if (st.open) { if (!st.box) st.box = defaultCropBox(dimsOf(volume), 256); setText('crop-status', ''); changed(true); } else { st.drag = null; for (const p of Object.keys(PLANE_AXES)) { st.hover = null; if (planes[p]?.canvas) planes[p].canvas.style.cursor = ''; } changed(); }
}
function readInputs(e) {
  if (!st.box || !volume) return;
  const id = e.target.id, v = +e.target.value, b = st.box;
  if (id === ids.size) { b.n = +e.target.value; b.center = { ...b.center }; }
  else if (id === ids.interp) b.interp = e.target.value;
  else if (id === ids.px) b.center = clampCenter({ ...b.center, i: v }, dimsOf(volume));
  else if (id === ids.py) b.center = clampCenter({ ...b.center, j: v }, dimsOf(volume));
  else if (id === ids.pz) b.center = clampCenter({ ...b.center, k: v }, dimsOf(volume));
  else if (id === ids.rx || id === ids.ry || id === ids.rz) { // typed angles (collapsed details): build R from them (exact for whole turns); R stays the source of truth
    const a = k => { const x = +$(ids[k])?.value; return Number.isFinite(x) ? x : 0; };
    setBoxRotation(b, rotationMatrix(a('rx'), a('ry'), a('rz')));
  }
  changed(id === ids.px || id === ids.py || id === ids.pz);
}

// ---- drag in the slice views (called first by installMprTouch in app.js; true = handled) ----
// Zones: inside the cross-section = move; a band outside a corner = rotate (only when rotation is allowed for this series). Hover updates the cursor and
// the rotate icon and returns false, so the other tools (crosshair, panning) are not affected.
const rotationAllowedNow = () => !!activeSeries && !rotationBlockReason(seriesGeometry(activeSeries));
const planeDims = p => (p === 'axial' ? [dimsOf(volume).columns, dimsOf(volume).rows] : p === 'coronal' ? [dimsOf(volume).columns, dimsOf(volume).slices] : [dimsOf(volume).rows, dimsOf(volume).slices]);
function hitTest(p, e) {
  const rect = planes[p].canvas.getBoundingClientRect(), { fx, fy } = clientToFraction(rect, e.clientX, e.clientY), dims = dimsOf(volume), [w, h] = planeDims(p);
  const u = fx * w - 0.5, v = p === 'axial' ? fy * h - 0.5 : dims.slices - 1 - (fy * h - 0.5);
  const poly = planeSection(effectiveBox(st.box), spacingOf(), p, +planes[p].slider.value), none = { zone: null, rect, fx, fy, u, v, poly };
  if (poly.length < 3) return none;
  const px = ([a, b]) => [((a + 0.5) / w) * rect.width, (p === 'axial' ? (b + 0.5) / h : (dims.slices - 1 - b + 0.5) / h) * rect.height]; // plane index coordinates -> px in the view
  const r = classifyPoint([fx * rect.width, fy * rect.height], poly.map(px), ROTATE_BAND_PX, pointInPolygon([u, v], poly));
  if (r.zone === 'rotate' && !rotationAllowedNow()) return none; // blocked (tilt / geometry / spacing): no handles, the move zone still works
  return { ...none, ...r };
}
function setHover(p, hit) {
  const cv = planes[p].canvas, was = st.hover, zone = hit?.zone || null;
  cv.style.cursor = zone === 'move' ? 'move' : zone === 'rotate' ? 'grab' : '';
  st.hover = zone ? { p, zone, corner: hit.corner, fx: hit.fx, fy: hit.fy } : null;
  if (zone === 'rotate' || was) requestOverlayDraw();
}
export function cropPointerDown(p, e) {
  if (!st.open || !st.box || !volume || st.busy || (e.pointerType === 'mouse' && e.button !== 0)) return false;
  const hit = hitTest(p, e); if (!hit.zone) return false;
  const base = { p, id: e.pointerId, rect: hit.rect, fx: hit.fx, fy: hit.fy };
  if (hit.zone === 'move') st.drag = { ...base, mode: 'move', u: hit.u, v: hit.v, center: { ...st.box.center } };
  else {
    const eff = effectiveBox(st.box), [au, av] = PLANE_AXES[p], sp = spacingOf(), ix = { i: 0, j: 1, k: 2 }, spp = [sp[ix[au]], sp[ix[av]]];
    st.box.center = { ...eff.center }; // rotate about the centre that is on screen (an aligned box sits on the voxel grid)
    const c = [eff.center[au], eff.center[av]], a0 = pointerAngle(c, [hit.u, hit.v], spp);
    st.drag = { ...base, mode: 'rotate', R0: boxRotation(st.box).map(r => r.slice()), c, spp, last: a0, acc: 0 };
  }
  setHover(p, null); planes[p].canvas.style.cursor = hit.zone === 'rotate' ? 'grabbing' : 'move';
  try { planes[p].canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  e.preventDefault(); changed(false); return true;
}
export function cropPointerMove(p, e) {
  const d = st.drag;
  if (!d) { if (st.open && st.box && volume && !st.busy) setHover(p, hitTest(p, e)); return false; }
  if (d.id !== e.pointerId || d.p !== p) return false;
  const { fx, fy } = clientToFraction(d.rect, e.clientX, e.clientY), dims = dimsOf(volume), [w, h] = planeDims(p);
  const u = fx * w - 0.5, v = p === 'axial' ? fy * h - 0.5 : dims.slices - 1 - (fy * h - 0.5);
  d.fx = fx; d.fy = fy;
  if (d.mode === 'rotate') {
    const now = pointerAngle(d.c, [u, v], d.spp); d.acc += wrapDelta(d.last, now); d.last = now;
    const r = rotateAboutViewStep(d.R0, p, d.acc, { step: e.shiftKey ? SNAP_STEP_DEG : FINE_STEP_DEG });
    d.shown = p === 'axial' ? -r.delta : r.delta; // + = counter-clockwise on screen (the axial v axis points down)
    setBoxRotation(st.box, r.R); changed(false); return true;
  }
  const [au, av] = PLANE_AXES[p], c = { ...d.center };
  c[au] += u - d.u; c[av] += v - d.v;
  st.box.center = clampCenter(c, dims); changed(false); return true;
}
export function cropPointerEnd(p, e) {
  const d = st.drag; if (!d || d.id !== e.pointerId) return false;
  st.drag = null; try { if (planes[d.p].canvas.hasPointerCapture(e.pointerId)) planes[d.p].canvas.releasePointerCapture(e.pointerId); } catch { /* released */ }
  planes[d.p].canvas.style.cursor = ''; if (e.type === 'pointerup' && st.box && volume) setHover(d.p, hitTest(d.p, e)); else setHover(d.p, null);
  changed(false); return true;
}
function cancelDrag() { const d = st.drag; if (!d) return; if (d.mode === 'rotate') setBoxRotation(st.box, d.R0); st.drag = null; planes[d.p].canvas.style.cursor = ''; changed(false); }

// ---- export ----
function say(t, fraction = null) { setText('crop-status', t); const pr = $('crop-progress'); if (pr) { pr.classList.toggle('is-hidden', fraction == null); if (fraction != null) pr.value = fraction; } }
function describeError(err) {
  if (err?.code === 'cancelled') return tr('cropCanceled');
  const key = ERR_KEYS[err?.code];
  let t;
  if (key) t = tr(key); else { console.error(err); t = tr('cropErr') + ' ' + (err?.message || err); }
  if (err?.cleanup && err.cleanup.removed === false) t += ' ' + tr('cropIncomplete') + ' ' + (err.cleanup.folder || ''); // what was written could not be removed: tell the user
  return t;
}
async function run() {
  if (st.busy) { st.cancel = true; return; }
  const series = activeSeries, box = st.box; if (!series || !box) return;
  // limit of the rotated block for THIS machine (device memory, and the whole volume the viewer already keeps in memory)
  const limit = rotatedBlockLimitFor({ deviceMemoryGB: navigator.deviceMemory || 0, residentBytes: volume?.data?.byteLength || 0 });
  try { // unsupported input is refused here: before the folder picker and before any folder or file is created
    checkExportable(series);
    if (!boxAligned(box)) {
      const why = rotationBlockReason(seriesGeometry(series)); if (why) throw new CropExportError(why, why);
      if (rotatedBlockBytes(series, box) > limit) throw new CropExportError('too-large', 'too large');
    }
  } catch (err) { say(describeError(err)); return; }
  let dir = null;
  if (typeof window.showDirectoryPicker === 'function') { // directly in the click handler: the picker needs the user gesture
    try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (err) { if (err?.name === 'AbortError') return; dir = null; }
  }
  st.busy = true; st.cancel = false; syncPanel(); say(tr('cropWorking'), 0);
  try {
    const folder = namingFor(series.slices[0].file?.name, box.n).folder;
    let zipBlob = null, sink;
    if (dir) sink = await directorySink(dir, folder); else sink = zipSink(b => { zipBlob = b; });
    const res = await exportCrop({
      series, box, sink, volumeMinHu: sourceVolume?.min ?? series.min, decodeCompressed: decodeCompressedDicomSlice, isCancelled: () => st.cancel, blockLimit: limit,
      onProgress: (n, total, stage) => say(tr('cropWorking') + ' ' + n + '/' + total, stage === 'read' ? (n / total) * 0.5 : 0.5 + (n / total) * 0.5),
    });
    if (zipBlob) { downloadBlob(zipBlob, res.folder + '.zip'); say(tr('cropDone') + ' · ' + res.folder + '.zip'); } else say(tr('cropDone') + ' · ' + (sink.folderName || res.folder));
  } catch (err) {
    say(describeError(err));
  } finally { st.busy = false; st.cancel = false; syncPanel(); const pr = $('crop-progress'); if (pr) pr.classList.add('is-hidden'); }
}

export function installCropExport() {
  const btn = $('crop-export-toggle'), panel = $('crop-export-panel');
  if (!btn || !panel) return;
  if (!CROP_EXPORT_UI_ENABLED || isIPhoneRuntime() || isTabletRuntime()) { btn.remove(); panel.remove(); return; } // removed (not just hidden): the analysis dock lists its cards from the DOM
  btn.classList.remove('is-hidden');
  setCropOverlayPainter(paintCrop);
  btn.onclick = () => { if (volume && activeSeries) setOpen(!st.open); };
  $('crop-close').onclick = () => setOpen(false);
  $('crop-reset').onclick = resetBox; $(ids.straight).onclick = straighten;
  for (const p of Object.keys(PLANE_AXES)) planes[p]?.canvas?.addEventListener('pointerleave', () => { if (!st.drag) setHover(p, null); });
  $('crop-run').onclick = run;
  panel.addEventListener('input', readInputs); panel.addEventListener('change', e => { if (e.target.tagName === 'SELECT') readInputs(e); });
  document.addEventListener('vrl-serieschange', () => { st.box = null; if (st.open) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.drag) cancelDrag(); });
  setInterval(() => { btn.disabled = !volume || !activeSeries; if (st.open && !volume) setOpen(false); }, 600);
}
