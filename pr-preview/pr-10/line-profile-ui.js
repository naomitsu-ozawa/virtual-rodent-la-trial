// Line profile panel.
// "HU線プロファイル" arms a two-point pick on the MPR / 2D slice views (press-drag-release, or click then click): the line is sampled
// at about the smallest voxel spacing with trilinear interpolation of the effective HU (line-profile.js) and shown in the analysis dock (analysis-dock.js)
// as a plot (HU vs distance, hover = value + marker on the line in the view), a histogram of the sampled values and the same
// statistics as the segment histogram (mean, SD, min, max, percentiles; histogram.js).
// - The HU values come through readEffectiveSlice (effective-hu.js): the FILTERED axial planes the 2D cards show (default) or the raw
//   source values (toggle "フィルター後 / 元の値", shared with the histogram); at most two slices at a time, never a full copy; async,
//   with progress and cancel. The line is recomputed when the filter settings or the toggle change.
// -: the two end points live in the shared model hu-line-model.js (voxel coordinates), so a line drawn on a slice shows in 3D and
//   vice versa (hu-line-3d.js). While the line is dragged (2D or 3D) the plot / histogram / stats show a COARSE live preview (hu-line-live.js:
//   at most 192 samples from data already in memory, about 13 Hz, never blocking); on release the full read replaces it.
// - The 3D analysis overlay is pointer-events:none (style.css); the dock re-enables it. Interactive elements here also stop the pointer
//   events so the 3D view does not rotate (the Phase 1 lesson).
import { volume, currentLanguage } from './state.js?v=20261026-build670';
import { planes } from './ui-shell.js?v=20261026-build670';
import { tr } from './i18n.js?v=20261026-build670';
import { frameYield } from './utils.js?v=20261026-build670';
import { sourceFilterStages, sourceFilterSignature } from './source-filters.js?v=20261026-build670';
import { getHuMode, onHuModeChange, effectiveHuSignature, huModeToggle } from './effective-hu.js?v=20261026-build670';
import { readEffectiveSlice, rawHuVolume, filtersActive } from './effective-hu-source.js?v=20261026-build670';
import { setExtraOverlayPainter, requestOverlayDraw } from './crosshair-ui.js?v=20261026-build670';
import { clientToFraction, voxelFromPlanePoint, planePointFromVoxel, sliceIndexFor, formatHu } from './crosshair.js?v=20261026-build670';
import { distanceMm, formatMm } from './measurements.js?v=20261026-build670';
import { rebinHist } from './histogram.js?v=20261026-build670';
import { lineSamples, sampleLine, profileStats, nearestSample } from './line-profile.js?v=20261026-build670';
import { getHuLine, setHuLine, clearHuLine, onHuLineChange, getHuLineHover, setHuLineHover, onHuLineHoverChange, isHuLineDeferred, onHuLineDeferChange, lineOnPlane, planeFraction, voxelOnSlice } from './hu-line-model.js?v=20261026-build670';
import { liveProfile, createLiveScheduler } from './hu-line-live.js?v=20261026-build670';
import { peekEffectiveReaders } from './effective-hu-source.js?v=20261026-build670';
import { isHuLine3dArmed, setHuLine3dArmed, onHuLine3dArmedChange, huLine3dAvailable } from './hu-line-3d.js?v=20261026-build670';

const PLOT_H = 130, HIST_H = 90, PAD = { l: 38, r: 8, t: 12, b: 20 }, DRAG_PX = 6;
const st = {
  open: false, stage: 'idle', a: null, plane: null, pid: null, downXY: null, job: null, result: null, message: '', hover: -1, lang: '', liveOn: false,
  el: null, btn: null, plot: null, hist: null, table: null, progress: null, status: null, hint: null, cancelBtn: null, liveBadge: null, btn3d: null
}; // st.a = the START of a line being drawn on a slice; the line itself (a, b) is in the shared model (hu-line-model.js)
const dimsOf = v => ({ columns: v.columns, rows: v.rows, slices: v.slices });
const rawVolume = rawHuVolume;
const nice = span => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, span / 5)))); for (const m of [1, 2, 5, 10]) if (span / (m * p) <= 6) return m * p; return 10 * p; };
const fmt = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));

// the effective HU (filtered / raw) currently selected: part of the result's identity
const effSig = () => { const stages = sourceFilterStages(); return effectiveHuSignature(getHuMode(), stages.length, stages.length ? sourceFilterSignature(stages) : ''); };

// ---- the computation ----
function setProgress(text, fraction) {
  if (!st.progress) return;
  st.progress.hidden = fraction == null; if (fraction != null) st.progress.value = fraction;
  if (st.status) st.status.textContent = text || '';
}
async function compute() {
  if (isHuLineDeferred()) { st.deferred = true; return; } // an immersive session is on: the read waits until it ends
  cancelJob(false);
  const v = rawVolume(), L = getHuLine();
  if (!v || !L) return;
  const a = L.a, b = L.b;
  const mode = getHuMode(), sig = effSig();
  const reader = z => readEffectiveSlice(z, { mode, volume: v });
  const job = { cancelled: false, sig };
  st.job = job; st.message = ''; if (!st.result?.live) st.result = null; st.hover = -1; // a live preview stays on screen until the full read replaces it
  draw();
  try {
    const samples = lineSamples(a, b, v.spacing);
    const values = await sampleLine(samples, dimsOf(v), reader, {
      cancelled: () => job.cancelled, yieldFn: frameYield,
      onProgress: (d, t) => { if (!job.cancelled) setProgress(tr('lpReading') + ' ' + Math.round(100 * d / Math.max(1, t)) + '%', d / Math.max(1, t)); }
    });
    if (!values || job.cancelled) return;
    st.result = { samples, values, stats: profileStats(values), a, b, sig };
  } catch (e) {
    if (!job.cancelled) st.message = tr('lpError') + ': ' + String(e?.message || e);
  } finally {
    if (st.job === job) st.job = null;
    setProgress('', null); draw(); requestOverlayDraw();
  }
}
function cancelJob(userAsked) {
  const job = st.job; if (!job) return;
  job.cancelled = true; st.job = null; if (userAsked) st.message = tr('lpCancelled');
  setProgress('', null); draw();
}
// the filter settings or the Filtered / Raw toggle changed since the line was read: read it again (an in-flight read is cancelled first)
function recomputeIfStale() {
  if (!st.open || !getHuLine() || st.liveOn || st.stage === 'drag' || st.stage === 'second') return;
  const sig = effSig();
  if (st.job ? st.job.sig !== sig : (st.result && st.result.sig !== sig)) void compute();
}
function clearLine() { st.a = st.plane = null; st.stage = 'idle'; clearHuLine('panel'); if (getHuLine() == null) resetResult(); }
function resetResult() { sched.cancel(); cancelJob(false); st.liveOn = false; st.result = null; st.message = ''; st.hover = -1; draw(); requestOverlayDraw(); }

// ---- live preview ----
const sched = createLiveScheduler(seq => runLive(seq));
function runLive(seq) {
  const v = rawVolume(), L = getHuLine();
  if (!st.open || !v || !L || !st.liveOn) return;
  const r = liveProfile(L.a, L.b, v.spacing, dimsOf(v), peekEffectiveReaders({ mode: getHuMode(), volume: v }));
  if (!r || sched.current() !== seq) return; // nothing cached to read, or a newer request / the release made this one stale
  st.result = { samples: r.samples, values: r.values, stats: profileStats(r.values), a: L.a, b: L.b, sig: effSig(), live: true };
  st.hover = -1; st.message = ''; draw();
}
// the model changed (drawn on a slice here, or in 3D by hu-line-3d.js)
function onLineChange(ev) {
  if (!st.open) return;
  if (ev.phase === 'live') { cancelJob(false); st.liveOn = true; sched.request(); }
  else if (ev.phase === 'final') { st.liveOn = false; sched.cancel(); void compute(); }
  else resetResult();
  requestOverlayDraw();
}

// ---- picking on the 2D views (called first by installMprTouch in app.js; true = handled) ----
const voxelAt = (p, e) => {
  const v = volume; if (!v) return null;
  const { fx, fy } = clientToFraction(planes[p].canvas.getBoundingClientRect(), e.clientX, e.clientY);
  return voxelFromPlanePoint(p, fx, fy, dimsOf(v), +planes[p].slider.value);
};
export function lineProfilePointerDown(p, e) {
  if (!st.open || !volume) return false;
  if (isHuLine3dArmed()) return false; // the 3D pick is armed: the slice views behave as usual
  e.stopPropagation();
  if (e.pointerType === 'mouse' && e.button !== 0) return true;
  const vox = voxelAt(p, e); if (!vox) return true;
  e.preventDefault();
  if (st.stage === 'second' && st.plane === p && st.a) { st.stage = 'idle'; setHuLine(st.a, vox, 'final', '2d'); return true; }
  cancelJob(false);
  st.a = vox; st.plane = p; st.stage = 'drag'; st.pid = e.pointerId; st.downXY = [e.clientX, e.clientY]; st.message = '';
  clearHuLine('2d'); resetResult();
  try { planes[p].canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  setHint(); draw(); requestOverlayDraw();
  return true;
}
export function lineProfilePointerMove(p, e) {
  if (!st.open || st.plane !== p || (st.stage !== 'drag' && st.stage !== 'second') || !st.a) return false;
  if (st.stage === 'drag' && e.pointerId !== st.pid) return false;
  const vox = voxelAt(p, e), cur = getHuLine()?.b;
  if (vox && !(cur && cur.i === vox.i && cur.j === vox.j && cur.k === vox.k)) setHuLine(st.a, vox, 'live', '2d'); // live preview (throttled in the scheduler)
  return true;
}
export function lineProfilePointerEnd(p, e) {
  if (!st.open || st.stage !== 'drag' || e.pointerId !== st.pid || st.plane !== p) return false;
  try { if (planes[p].canvas.hasPointerCapture(e.pointerId)) planes[p].canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  const moved = Math.hypot(e.clientX - st.downXY[0], e.clientY - st.downXY[1]) > DRAG_PX;
  if (e.type === 'pointercancel') { st.a = null; st.stage = 'idle'; clearHuLine('2d'); }
  else if (moved) { const vox = voxelAt(p, e) || getHuLine()?.b; st.stage = 'idle'; if (vox) setHuLine(st.a, vox, 'final', '2d'); else clearHuLine('2d'); }
  else { st.stage = 'second'; clearHuLine('2d'); } // a click: the next click is the END
  setHint(); requestOverlayDraw();
  return true;
}

// ---- the line on the slice view ----
function paintLine(ctx, p, g) {
  const L = getHuLine();
  if (!ctx || !st.open || !L || !volume) return;
  const dims = dimsOf(volume), idx = +planes[p].slider.value, m = lineOnPlane(p, L.a, L.b, idx, dims);
  if (m.kind === 'none') return;
  const pt = f => [g.x0 + f.fx * g.w, g.y0 + f.fy * g.h], [x1, y1] = pt(m.seg[0]), [x2, y2] = pt(m.seg[1]), solid = m.kind === 'on';
  ctx.save();
  if (!solid) ctx.setLineDash([6, 5]);
  const stroke = (w, c) => { ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  stroke(solid ? 4.5 : 3.5, 'rgba(0,0,0,.6)'); stroke(solid ? 2 : 1.5, '#35e0ff');
  ctx.setLineDash([]);
  for (const [x, y] of [[x1, y1], [x2, y2]]) { ctx.beginPath(); ctx.arc(x, y, solid ? 4.5 : 3, 0, Math.PI * 2); if (solid) { ctx.fillStyle = '#35e0ff'; ctx.fill(); } ctx.lineWidth = 2; ctx.strokeStyle = solid ? 'rgba(0,0,0,.7)' : '#35e0ff'; ctx.stroke(); }
  if (m.hit) { const [x, y] = pt(m.hit); ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#35e0ff'; ctx.stroke(); }
  const h = getHuLineHover(); // the sample under the plot's pointer
  if (h && (!solid || voxelOnSlice(p, h, idx))) {
    const [x, y] = pt(planeFraction(p, h, dims));
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#ffb13b'; ctx.stroke();
  }
  ctx.restore();
}

// ---- charts ----
function prep(canvas, H) {
  if (!canvas || !canvas.clientWidth) return null;
  const dpr = globalThis.devicePixelRatio || 1, W = canvas.clientWidth;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.font = '9px system-ui,sans-serif'; ctx.textBaseline = 'middle';
  return { ctx, W, fg: getComputedStyle(canvas).color || '#888' };
}
const rectOf = (canvas, H) => ({ x: PAD.l, y: PAD.t, w: Math.max(10, canvas.clientWidth - PAD.l - PAD.r), h: H - PAD.t - PAD.b });
function huWindow(stats) {
  let lo = stats.min, hi = stats.max; const pad = Math.max(5, (hi - lo) * 0.06);
  lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad); if (hi - lo < 20) hi = lo + 20;
  return [lo, hi];
}
function axes(ctx, fg, r, lo, hi, xMax, xLabel) {
  ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = 1;
  ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke();
  const ys = nice(hi - lo); ctx.textAlign = 'right';
  for (let hu = Math.ceil(lo / ys) * ys; hu <= hi; hu += ys) {
    const y = r.y + r.h - (hu - lo) / (hi - lo) * r.h;
    ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
    ctx.globalAlpha = 0.8; ctx.fillText(String(Math.round(hu)), r.x - 3, y);
  }
  const xs = nice(xMax); ctx.textAlign = 'center';
  for (let d = 0; d <= xMax + 1e-9; d += xs) { const x = r.x + d / Math.max(1e-9, xMax) * r.w; ctx.globalAlpha = 0.8; ctx.fillText(String(Math.round(d * 100) / 100), x, r.y + r.h + 10); }
  ctx.globalAlpha = 0.8; ctx.textAlign = 'right'; ctx.fillText(xLabel, r.x + r.w, r.y - 5);
  ctx.globalAlpha = 1;
}
function drawPlot() {
  const c = prep(st.plot, PLOT_H); if (!c) return;
  const r0 = st.result; if (!r0 || !r0.stats.count) return;
  const { ctx, fg } = c, r = rectOf(st.plot, PLOT_H), [lo, hi] = huWindow(r0.stats), L = Math.max(r0.samples.length, 1e-9), n = r0.samples.n;
  axes(ctx, fg, r, lo, hi, r0.samples.length, 'mm');
  const X = q => r.x + (n > 1 ? r0.samples.dist[q] / L : 0.5) * r.w, Y = q => r.y + r.h - (r0.values[q] - lo) / (hi - lo) * r.h;
  ctx.strokeStyle = '#35b8d8'; ctx.lineWidth = 1.5; ctx.beginPath();
  let pen = false; // NaN = not cached (live preview): a gap
  for (let q = 0; q < n; q++) { if (!(r0.values[q] === r0.values[q])) { pen = false; continue; } if (pen) ctx.lineTo(X(q), Y(q)); else ctx.moveTo(X(q), Y(q)); pen = true; }
  ctx.stroke();
  if (n === 1) { ctx.fillStyle = '#35b8d8'; ctx.beginPath(); ctx.arc(X(0), Y(0), 3, 0, Math.PI * 2); ctx.fill(); }
  if (st.hover >= 0 && st.hover < n) {
    const x = X(st.hover), y = Y(st.hover);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = fg; ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffb13b'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    const label = fmt(r0.samples.dist[st.hover], 2) + ' mm · ' + fmt(r0.values[st.hover], 1) + ' HU';
    ctx.fillStyle = fg; ctx.textAlign = x > r.x + r.w / 2 ? 'right' : 'left'; ctx.fillText(label, x + (x > r.x + r.w / 2 ? -5 : 5), r.y + 4);
  }
}
function drawHist() {
  const c = prep(st.hist, HIST_H); if (!c) return;
  const r0 = st.result; if (!r0 || !r0.stats.count) return;
  const { ctx, fg } = c, r = rectOf(st.hist, HIST_H), [lo, hi] = huWindow(r0.stats);
  const cols = Math.max(1, Math.min(Math.round(hi - lo + 1), Math.floor(r.w / 3))), bars = rebinHist(r0.stats.hist, lo, hi, cols);
  let ymax = 1; for (const x of bars) if (x > ymax) ymax = x;
  ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke();
  const xs = nice(hi - lo); ctx.textAlign = 'center';
  for (let hu = Math.ceil(lo / xs) * xs; hu <= hi; hu += xs) { const x = r.x + (hu - lo) / (hi - lo) * r.w; ctx.globalAlpha = 0.8; ctx.fillText(String(Math.round(hu)), x, r.y + r.h + 10); }
  ctx.textAlign = 'right'; ctx.fillText(String(ymax), r.x - 3, r.y + 4); ctx.fillText('0', r.x - 3, r.y + r.h);
  ctx.fillStyle = '#35b8d8'; ctx.globalAlpha = 0.8; const bw = r.w / cols;
  for (let q = 0; q < cols; q++) { if (!bars[q]) continue; const h = Math.max(1, bars[q] / ymax * r.h); ctx.fillRect(r.x + q * bw, r.y + r.h - h, Math.max(1, bw - 0.3), h); }
  ctx.globalAlpha = 1;
}
function drawTable() {
  const t = st.table; if (!t) return;
  const r = st.result; if (!r) { t.replaceChildren(); return; }
  const s = r.stats, head = [tr('lpLength'), tr('lpSamples'), tr('statMean'), 'SD', 'p5', 'p25', 'p50', 'p75', 'p95', tr('statMin'), tr('statMax')];
  const cells = [formatMm(r.samples.length), String(s.count), fmt(s.mean), fmt(s.sd), ...[5, 25, 50, 75, 95].map(p => fmt(s.percentiles[p], 0)), fmt(s.min, 1), fmt(s.max, 1)];
  const table = document.createElement('table'); table.className = 'seg-hist-table';
  const h0 = table.createTHead().insertRow(); for (const h of head) { const th = document.createElement('th'); th.textContent = h; h0.append(th); }
  const row = table.createTBody().insertRow(); for (const c of cells) row.insertCell().textContent = c;
  t.replaceChildren(table);
}
function setHint() {
  if (!st.hint) return;
  st.hint.textContent = isHuLine3dArmed() ? tr('lpHint3d') : st.stage === 'second' ? tr('lpPickB') : st.stage === 'drag' ? tr('lpPickB') : st.result ? tr('lpHintDone') : tr('lpHint');
}
function draw() {
  if (!st.open || !st.el) return;
  drawPlot(); drawHist(); drawTable();
  if (st.status && !st.job) st.status.textContent = st.message;
  if (st.cancelBtn) { st.cancelBtn.textContent = st.job ? tr('lpCancel') : tr('lpClear'); st.cancelBtn.disabled = !st.job && !getHuLine(); }
  if (st.plot) { st.plot.dataset.n = st.result ? String(st.result.samples.n) : '0'; if (st.result?.live) st.plot.dataset.live = '1'; else delete st.plot.dataset.live; }
  if (st.liveBadge) st.liveBadge.hidden = !st.result?.live;
  setHint();
}

// ---- hover on the plot ----
function installPlot(canvas) {
  canvas.style.touchAction = 'none';
  const own = (type, fn) => canvas.addEventListener(type, e => { e.stopPropagation(); fn(e); });
  const at = e => {
    const r0 = st.result; if (!r0 || !r0.samples.n) return;
    const r = rectOf(canvas, PLOT_H), x = e.clientX - canvas.getBoundingClientRect().left;
    const mm = Math.max(0, Math.min(1, (x - r.x) / r.w)) * r0.samples.length, q = nearestSample(r0.samples.dist, mm);
    if (q !== st.hover) {
      st.hover = q; drawPlot(); canvas.dataset.hover = q < 0 ? '' : fmt(r0.samples.dist[q], 2) + '|' + fmt(r0.values[q], 1);
      setHuLineHover(q < 0 ? null : { i: r0.samples.x[q], j: r0.samples.y[q], k: r0.samples.z[q] }); // the marker shows on the slice views and in 3D
    }
  };
  own('pointerdown', e => { at(e); canvas.setPointerCapture?.(e.pointerId); });
  own('pointermove', at);
  own('pointerup', e => { canvas.releasePointerCapture?.(e.pointerId); });
  own('pointercancel', () => {});
  own('pointerleave', () => { if (st.hover >= 0) { st.hover = -1; delete canvas.dataset.hover; drawPlot(); setHuLineHover(null); } });
  canvas.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
}
function installBlock(el) { // charts / table that take no pointer action themselves still must not rotate the 3D view
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) el.addEventListener(t, e => e.stopPropagation());
  el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
}

// ---- panel ----
function build() {
  const box = st.el, mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const bar = mk('div', 'seg-hist-bar');
  st.liveBadge = mk('span', 'lp-live', '● ' + tr('lpLive')); st.liveBadge.hidden = true; st.liveBadge.title = tr('lpLiveTip');
  st.btn3d = mk('button', 'seg-hist-mini lp-3d-toggle', tr('lp3dDraw')); st.btn3d.type = 'button'; st.btn3d.title = tr('lp3dDrawTip');
  st.btn3d.onclick = () => setHuLine3dArmed(!isHuLine3dArmed());
  bar.append(mk('strong', '', tr('lpTitle')), huModeToggle(currentLanguage, filtersActive), st.btn3d, st.liveBadge);
  sync3dButton();
  st.plot = mk('canvas', 'lp-canvas lp-plot'); st.plot.style.height = PLOT_H + 'px'; installPlot(st.plot);
  st.hist = mk('canvas', 'lp-canvas lp-hist'); st.hist.style.height = HIST_H + 'px'; installBlock(st.hist);
  const prog = mk('div', 'seg-hist-progress');
  st.progress = document.createElement('progress'); st.progress.max = 1; st.progress.value = 0; st.progress.hidden = true;
  st.status = mk('span', 'seg-hist-status'); st.cancelBtn = mk('button', 'seg-hist-mini', tr('lpClear')); st.cancelBtn.type = 'button';
  st.cancelBtn.onclick = () => { if (st.job) cancelJob(true); else clearLine(); };
  prog.append(st.progress, st.status, st.cancelBtn);
  st.table = mk('div', 'seg-hist-tablewrap'); installBlock(st.table);
  st.hint = mk('div', 'seg-hist-hint', tr('lpHint'));
  box.replaceChildren(bar, st.plot, st.hist, prog, st.table, st.hint);
  st.lang = currentLanguage;
}
function sync3dButton() {
  if (!st.btn3d) return;
  const armed = isHuLine3dArmed(), ok = huLine3dAvailable();
  st.btn3d.classList.toggle('is-active', armed); st.btn3d.setAttribute('aria-pressed', armed ? 'true' : 'false'); st.btn3d.disabled = !ok && !armed;
}
function setOpen(on) {
  st.open = !!on; st.el.classList.toggle('is-hidden', !st.open); st.btn.classList.toggle('is-active', st.open);
  if (st.open) {
    // the result card lives in the analysis dock (analysis-dock.js), which shows it in every view mode: no view switch needed
    build(); requestAnimationFrame(() => { draw(); }); }
  else { setHuLine3dArmed(false); sched.cancel(); cancelJob(false); st.stage = 'idle'; st.a = st.plane = null; st.liveOn = false; st.result = null; st.hover = -1; clearHuLine('panel'); }
  requestOverlayDraw();
}
// another dataset is being opened (data-load.js resetDatasetState): the old line goes now, in every view (2D, 3D, VR read the shared
// model), the panel closes and a pick in progress is dropped. The 600 ms poll below used to be the only reset: a load faster than its period, or a
// line in the model while the panel was closed (drawn in VR), stayed on the new data.
export function resetLineProfileForDataset() {
  if (st.open && st.el) setOpen(false);
  else { setHuLine3dArmed(false); sched.cancel(); cancelJob(false); st.stage = 'idle'; st.a = st.plane = null; st.liveOn = false; st.result = null; st.hover = -1; }
  clearHuLine('dataset'); // also the plot's hover marker (no emit when there was no line)
  requestOverlayDraw();
}
export function installLineProfile() {
  const btn = document.getElementById('line-profile-toggle'), box = document.getElementById('line-profile-result');
  if (!btn || !box) return;
  st.el = box; st.btn = btn;
  btn.onclick = () => { if (volume) setOpen(!st.open); };
  setExtraOverlayPainter(paintLine);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.open && st.stage !== 'idle') { st.stage = 'idle'; st.a = null; clearHuLine('2d'); requestOverlayDraw(); setHint(); } });
  onHuLineChange(onLineChange);
  onHuLineHoverChange(() => requestOverlayDraw());
  onHuLine3dArmedChange(() => { sync3dButton(); setHint(); });
  addEventListener('resize', () => draw());
  document.addEventListener('vrl-themechange', () => draw());
  document.addEventListener('vrl-slicechange', () => requestOverlayDraw());
  let lastVol = null;
  setInterval(() => {
    btn.disabled = !volume;
    if (rawVolume() !== lastVol) { lastVol = rawVolume(); if (st.open) setOpen(false); }
    if (st.open && st.lang !== currentLanguage) { build(); draw(); }
    sync3dButton(); recomputeIfStale();
  }, 600);
  onHuModeChange(() => recomputeIfStale());
  onHuLineDeferChange(on => { if (!on && st.deferred) { st.deferred = false; if (st.open && getHuLine()) void compute(); } });
}
