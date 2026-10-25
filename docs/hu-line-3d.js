// HU line in the 3D view.
// Pick two points directly on the 3D surface: press = start, drag to stretch, release = end (or click, then click). The pick is the same
// one the 3D analysis uses: the GPU volume pick in volume mode (medicalVolume.pick), the mesh ray cast (analysis-ops surfacePointerVoxel)
// in surface mode. When the ray hits nothing, the active section (clip) plane is intersected instead; with neither, the point is ignored.
// The endpoints go into the shared model (hu-line-model.js, voxel coordinates), so the slice views show the line and a line drawn on a
// slice shows here. While armed the camera must not rotate: a CAPTURE-phase pointerdown on the viewport stops the press before the
// canvas handlers (rotate / pan / comment taps) see it; moves and releases are followed on the document. The line is an SVG overlay
// projected like the comment / measure lines (voxelToLocal3D -> object matrix -> camera), updated after every 3D frame.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { sceneState, volume, current3DVolume, threeRenderMode, analysisEditTool, sectionViewOpen, sectionViewPlane } from './state.js?v=20261025-build667';
import { voxelToLocal3D } from './crosshair.js?v=20261025-build667';
import { surfacePointerVoxel } from './analysis-ops.js?v=20261025-build667';
import { segmentState, gpuSegmentOrder } from './segments.js?v=20261025-build667';
import { sectionLocalPoint, sectionLocalNormal } from './section-view.js?v=20261025-build667';
import { request3DRender } from './scene3d.js?v=20261025-build667';
import { getHuLine, setHuLine, clearHuLine, onHuLineChange, getHuLineHover, onHuLineHoverChange, localToVoxel, voxelInside, rayPlaneT } from './hu-line-model.js?v=20261025-build667';
import { createLiveScheduler } from './hu-line-live.js?v=20261025-build667';
const DRAG_PX = 6, CYAN = '#35e0ff', ORANGE = '#ffb13b';
let host = null, svg = null, armed = false;
const armedListeners = new Set();
const el = {};
// g: the gesture. phase: idle | press (down, start being picked) | drag | second (clicked once: waiting for the end) | endpress (the second press)
const g = { phase: 'idle', pid: null, canvas: null, down: null, last: null, a: null, startP: null, b: null, token: 0 };

export const isHuLine3dArmed = () => armed;
export const onHuLine3dArmedChange = fn => { armedListeners.add(fn); return () => armedListeners.delete(fn); };
// the 3D view is on screen with a volume loaded
export const huLine3dAvailable = () => !!host && !!volume && !!sceneState?.obj && host.clientWidth > 8 && host.clientHeight > 8;
export function setHuLine3dArmed(on) {
  const v = !!on && huLine3dAvailable();
  if (v === armed) return;
  armed = v; cancelGesture(true);
  host?.classList.toggle('hu-line-3d-armed', armed);
  for (const fn of [...armedListeners]) { try { fn(armed); } catch (e) { console.error(e); } }
  request3DRender();
}

// ---- picking: a voxel position {i,j,k} (float, full-resolution volume) under a client point, or null ----
const ndc = (canvas, x, y) => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((x - r.left) / Math.max(r.width, 1)) * 2 - 1, -((y - r.top) / Math.max(r.height, 1)) * 2 + 1); };
const dimsOf = v => ({ columns: v.columns, rows: v.rows, slices: v.slices });
async function pickSurface(canvas, x, y) {
  const s = sceneState, obj = s.obj, camera = s.camera, v = volume;
  obj.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  if (threeRenderMode === 'volume' && s.medicalVolume?.active) {
    const hit = await s.medicalVolume.pick(x, y, camera, obj, segmentState, gpuSegmentOrder());
    if (!hit) return null;
    const c = current3DVolume || v; // the GPU texture may be reduced: scale its voxel index to the full-resolution volume
    const map = (n, full, red) => ((n + 0.5) * full) / Math.max(1, red) - 0.5;
    return { i: map(hit.x, v.columns, c.columns), j: map(hit.y, v.rows, c.rows), k: map(hit.z, v.slices, c.slices) };
  }
  const hit = surfacePointerVoxel({ clientX: x, clientY: y }, canvas, camera);
  if (!hit?.hit) return null;
  return localToVoxel(obj.worldToLocal(hit.hit.point.clone()), dimsOf(v), v.spacing);
}
// the ray through the pointer against the active section plane (scene-local frame), inside the volume box
function pickSectionPlane(canvas, x, y) {
  const s = sceneState, obj = s.obj, camera = s.camera, v = volume;
  if (!sectionViewOpen || !sectionViewPlane) return null;
  const pt = sectionLocalPoint(), nm = sectionLocalNormal(); if (!pt || !nm) return null;
  const rc = new THREE.Raycaster(); rc.setFromCamera(ndc(canvas, x, y), camera);
  const inv = obj.matrixWorld.clone().invert(), o = rc.ray.origin.clone().applyMatrix4(inv), d = rc.ray.direction.clone().transformDirection(inv);
  const t = rayPlaneT(o, d, pt, nm); if (t == null) return null;
  const vox = localToVoxel({ x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, dimsOf(v), v.spacing);
  return voxelInside(vox, dimsOf(v)) ? vox : null;
}
// With a section (cut) open, the picks above see the UNCUT volume / mesh (the GPU pick and the mesh ray cast ignore the cut): a press on the
// cut face would land on tissue that was cut away, far from what the user points at. What is visible there is: seen from the cut side
// (camera on the removed side) the cap on the plane; seen from the kept side the first surface, which must itself be on the kept side.
function keptSideOf(obj, camera, hit, vol) {
  const pt = sectionLocalPoint(), nm = sectionLocalNormal(); if (!pt || !nm) return null;
  const inv = obj.matrixWorld.clone().invert(), e = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv);
  const dist = q => (q.x - pt.x) * nm.x + (q.y - pt.y) * nm.y + (q.z - pt.z) * nm.z;
  const l = hit ? voxelToLocal3D(hit, dimsOf(vol), vol.spacing) : null;
  return { eyeKept: dist(e) >= 0, hitKept: l ? dist(l) >= -1e-6 : false };
}
export async function pickHuLinePoint(canvas, x, y) {
  if (!volume || !sceneState?.obj || !sceneState.camera) return null;
  let p = null;
  try { p = await pickSurface(canvas, x, y); } catch (e) { console.warn('HU line 3D pick failed', e); }
  if (sectionViewOpen && sectionViewPlane) {
    const plane = pickSectionPlane(canvas, x, y), k = keptSideOf(sceneState.obj, sceneState.camera, p, volume);
    if (!k) return p || plane;
    if (!k.eyeKept && plane) return plane;
    return p && k.hitKept ? p : plane;
  }
  return p || pickSectionPlane(canvas, x, y);
}

// ---- gesture ----
const moved = () => g.down && g.last && Math.hypot(g.last.x - g.down.x, g.last.y - g.down.y) > DRAG_PX;
function cancelGesture(clearLine) {
  g.token++; sched.cancel();
  if (g.phase !== 'idle' && clearLine) clearHuLine('3d');
  g.phase = 'idle'; g.pid = null; g.a = null; g.startP = null; g.b = null; g.down = g.last = null;
  drawOverlay();
}
// the live stretch: pick at the newest pointer position (one pick at a time, throttled by the scheduler), update the model as 'live'
let picking = false; // one pick at a time (the GPU pick re-renders and reads back): newer pointer positions wait for it
const sched = createLiveScheduler(async () => {
  if (picking) { sched.request(); return; }
  picking = true;
  try {
    const tok = g.token, at = g.last, a0 = g.phase === 'second' || g.phase === 'endpress' ? g.a : null;
    if (!at || !g.canvas) return;
    const a = a0 || await g.startP; if (!a || tok !== g.token) return;
    if (g.phase !== 'drag' && g.phase !== 'second' && g.phase !== 'endpress') return;
    const b = await pickHuLinePoint(g.canvas, at.x, at.y);
    if (!b || tok !== g.token) return; // an empty-space point is ignored: the line keeps its last valid end
    g.b = b; setHuLine(a, b, 'live', '3d');
  } finally { picking = false; }
});
function onDown(ev) {
  if (!armed || !huLine3dAvailable() || analysisEditTool !== 'select') return;
  const t = ev.target;
  if (!t || t.tagName !== 'CANVAS' || t.parentElement !== host || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
  ev.stopPropagation(); ev.preventDefault(); // the camera does not rotate, pan or pick a comment from this press
  if (g.pid != null && ev.pointerId !== g.pid) return; // a second finger while drawing: ignored
  g.pid = ev.pointerId; g.canvas = t; g.down = { x: ev.clientX, y: ev.clientY }; g.last = { x: ev.clientX, y: ev.clientY };
  if (g.phase === 'second') { g.phase = 'endpress'; return; }
  const tok = ++g.token;
  g.phase = 'press'; g.a = null; g.b = null;
  g.startP = pickHuLinePoint(t, ev.clientX, ev.clientY).then(p => { if (tok === g.token && p) g.a = p; return p; });
}
function onMove(ev) {
  if (g.pid == null || (ev.pointerId !== g.pid && g.phase !== 'second')) return;
  if (g.phase === 'idle') return;
  ev.stopPropagation();
  g.last = { x: ev.clientX, y: ev.clientY };
  if (g.phase === 'press' && moved()) g.phase = 'drag';
  if (g.phase === 'drag' || g.phase === 'second' || g.phase === 'endpress') sched.request();
}
async function onUp(ev) {
  if (g.pid == null || ev.pointerId !== g.pid || (g.phase !== 'press' && g.phase !== 'drag' && g.phase !== 'endpress')) return;
  ev.stopPropagation();
  const phase = g.phase, canvas = g.canvas, at = { x: ev.clientX, y: ev.clientY }, wasMoved = moved(), startP = g.startP, a0 = g.a;
  g.last = at; sched.cancel(); g.pid = null;
  const tok = ++g.token; // a live pick still in flight is stale from here on (it must not overwrite the final line)
  if (ev.type === 'pointercancel') { cancelGesture(true); return; }
  if (phase === 'press' && !wasMoved) { // a click: the START is set, the next click sets the END
    const a = await startP; if (tok !== g.token) return;
    if (!a) { cancelGesture(false); return; }
    clearHuLine('3d'); g.a = a; g.phase = 'second'; g.pid = null; g.down = null; drawOverlay(); request3DRender();
    return;
  }
  const a = phase === 'endpress' ? a0 : await startP; if (tok !== g.token) return;
  const b = a ? (await pickHuLinePoint(canvas, at.x, at.y)) || g.b : null; if (tok !== g.token) return;
  g.phase = 'idle'; g.startP = null; g.a = null; g.b = null; g.down = g.last = null;
  if (a && b) setHuLine(a, b, 'final', '3d'); else clearHuLine('3d');
  drawOverlay();
}
function onHover(ev) { // click-click: after the first click the line follows the pointer without a button
  if (g.phase !== 'second' || ev.target?.tagName !== 'CANVAS' || ev.target.parentElement !== host) return;
  g.last = { x: ev.clientX, y: ev.clientY }; g.canvas = ev.target; sched.request();
}
function onKey(ev) { if (ev.key === 'Escape' && g.phase !== 'idle') cancelGesture(true); }

// ---- the overlay (SVG over the 3D canvas; pointer-events:none) ----
function mkSvg(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; }
function screenOf(v, dims, obj, camera, W, H) {
  const l = voxelToLocal3D(v, dims, volume.spacing), p = new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(obj.matrixWorld).project(camera);
  return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H, ok: p.z > -1 && p.z < 1 };
}
const setDot = (c, p, r) => { if (!p?.ok) { c.setAttribute('visibility', 'hidden'); return; } c.setAttribute('visibility', 'visible'); c.setAttribute('cx', p.x.toFixed(1)); c.setAttribute('cy', p.y.toFixed(1)); c.setAttribute('r', String(r)); };
function drawOverlay() { updateHuLine3d(); }
// called after every 3D frame (app.js, next to updateComment3dMarkers) and on model changes
export function updateHuLine3d() {
  if (!svg) return;
  const s = sceneState, obj = s?.obj, camera = s?.camera, L = getHuLine(), pend = g.phase === 'second' ? g.a : null;
  const show = !!volume && !!obj && !!camera && (!!L || !!pend) && host.clientWidth > 8;
  svg.style.display = show ? '' : 'none'; svg.dataset.visible = show ? '1' : '0';
  if (!show) return;
  const W = host.clientWidth, H = host.clientHeight, dims = dimsOf(volume);
  obj.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const A = L ? L.a : pend, B = L ? L.b : null, pa = screenOf(A, dims, obj, camera, W, H), pb = B ? screenOf(B, dims, obj, camera, W, H) : null;
  const both = !!pb && pa.ok && pb.ok;
  for (const ln of [el.halo, el.line]) { ln.setAttribute('visibility', both ? 'visible' : 'hidden'); if (both) { ln.setAttribute('x1', pa.x.toFixed(1)); ln.setAttribute('y1', pa.y.toFixed(1)); ln.setAttribute('x2', pb.x.toFixed(1)); ln.setAttribute('y2', pb.y.toFixed(1)); } }
  setDot(el.a, pa, 4.5); setDot(el.b, pb, 4.5);
  const hv = getHuLineHover(), ph = hv && L ? screenOf(hv, dims, obj, camera, W, H) : null;
  setDot(el.hoverHalo, ph, 6.5); setDot(el.hover, ph, 6.5);
  svg.dataset.a = pa.ok ? pa.x.toFixed(0) + ',' + pa.y.toFixed(0) : ''; svg.dataset.b = pb?.ok ? pb.x.toFixed(0) + ',' + pb.y.toFixed(0) : '';
}

export function installHuLine3d(viewportEl) {
  if (host || !viewportEl) return;
  host = viewportEl;
  svg = mkSvg('svg', { class: 'hu-line-3d', 'aria-hidden': 'true' });
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', display: 'none', zIndex: '6' }); // above the GPU volume canvas (appended later, z-index 0): the comment layer's rule
  el.halo = mkSvg('line', { stroke: 'rgba(0,0,0,.6)', 'stroke-width': '4.5', 'stroke-linecap': 'round' });
  el.line = mkSvg('line', { stroke: CYAN, 'stroke-width': '2', 'stroke-linecap': 'round' });
  el.a = mkSvg('circle', { fill: CYAN, stroke: 'rgba(0,0,0,.7)', 'stroke-width': '2' }); el.b = mkSvg('circle', { fill: CYAN, stroke: 'rgba(0,0,0,.7)', 'stroke-width': '2' });
  el.hoverHalo = mkSvg('circle', { fill: 'none', stroke: 'rgba(0,0,0,.7)', 'stroke-width': '4' }); el.hover = mkSvg('circle', { fill: 'none', stroke: ORANGE, 'stroke-width': '2' });
  svg.append(el.halo, el.line, el.a, el.b, el.hoverHalo, el.hover);
  host.appendChild(svg);
  // capture phase: runs before the canvas handlers (rotate / pan) and before comment-3d's tap handlers
  host.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true); document.addEventListener('pointerup', onUp, true); document.addEventListener('pointercancel', onUp, true);
  host.addEventListener('pointermove', onHover, true);
  document.addEventListener('keydown', onKey);
  const again = () => { updateHuLine3d(); request3DRender(); };
  onHuLineChange(again); onHuLineHoverChange(updateHuLine3d); // a hover only moves the SVG marker: no 3D re-render
  document.addEventListener('vrl-serieschange', () => { if (armed) setHuLine3dArmed(false); });
}
