// Per-segment HU histogram panel of the 3D view's analysis overlay.
// - The voxels of a segment are its FINAL runs (getFinalSegmentRuns: filter-aware, post-processing, edits, voxel takers above).
//   A segment that is a plain HU range on unfiltered data needs no pass of its own: it is a slice of the whole-volume histogram.
// - The HU values are read slice by slice through readEffectiveSlice (effective-hu.js): the FILTERED axial planes (what the 2D cards show)
//   by default, or the raw source values (toggle "フィルター後 / 元の値"); never a full copy of the volume, so a
//   3.5 GB study is never copied. The pass yields to the UI by time, can be cancelled, restarts when the segment settings change
//   and reads every N-th slice first (a draft) on long volumes. Results: Uint32Array(4096) per segment (histogram.js), cached by
//   the segment cache key (segment-cache-key.js).
// - The chart's x range is display only (stats are always over all the data): 自動 = a percentile window of the shown segments together (a thin bone tail does not
//   squeeze the rest), 全体 = min..max, or typed / wheel-zoomed; kept in localStorage. A range line outside it is marked at the edge and still draggable there.
// - The HU range of every shown segment is a vertical line; dragging it moves the segment's min / max slider through the very
//   same events as the slider itself (input while moving, change on release), so the segment code runs exactly as for a slider.
// -: the VR board counts the VR data itself (vr-label-histogram.js) and reads only the display range and the scale from here; the VR
//   consumer / texture pass of-566 (acquireHistogram, getHistogramView, ...) is gone.
import { volume, current3DVolume, currentLanguage } from './state.js?v=20261110-build708';
import { segmentState, segmentNeedsVoxelMask, segmentEditGen, segmentSourceSignature, setShadeAutoSource, shadeDataRange, dataAxis, shownSegmentKeys, segmentById } from './segments.js?v=20261110-build708';
import { isChildKey } from './segment-look.js?v=20261110-build708';
import { childByKey } from './child-segments.js?v=20261110-build708';
import { getFinalSegmentRuns } from './segment-runs.js?v=20261110-build708';
import { sourceFilterStages, sourceFilterSignature } from './source-filters.js?v=20261110-build708';
import { getHuMode, effectiveHuSignature, huModeToggle, segmentNeedsRuns, HU_MODE_FILTERED } from './effective-hu.js?v=20261110-build708';
import { readEffectiveSlice, rawHuVolume, filtersActive } from './effective-hu-source.js?v=20261110-build708';
import { segmentRunsCacheKey } from './segment-cache-key.js?v=20261110-build708';
import { setCtSliderRange, ctSliderFullBounds, segmentControl } from './segment-ui.js?v=20261110-build708';
import { createShadeHist, binShadeValues, binShadeRuns, shadeHistCount } from './cap-shade.js?v=20261110-build708';
import { tr } from './i18n.js?v=20261110-build708';
import { frameYield } from './utils.js?v=20261110-build708';
import { createHist, binValues, binRuns, scaleHist, histInRange, rebinHist, histExtent, histStats, voxelsToMm3, huToX, xToHu, nearestLine, niceStep, windowFor, clampWindow, zoomWindow, normalizeRange, HU_AXIS, axisKey, axisDecimals, axisWidth, fmtAxisValue, windowBins, tickText } from './histogram.js?v=20261110-build708';
const MAX_RETRIES = 6, POLL_MS = 400, DRAFT_MIN_SLICES = 240, DRAFT_SLICES = 80, CACHE_MAX = 24, CHART_H = 150, GRAB_PX = 6, PAD = { l: 34, r: 8, t: 14, b: 20 };
const RANGE_KEY = 'vrl-hist-range-v1';
// the axis of the data open now (histogram.js axisFor): the CT axis (1-HU bins, as always) for CT-like data, else equal bins over the data's own range (MRI 0..65535, 8-bit, slope-scaled values)
const axisOf = v => (v ? dataAxis(v) : HU_AXIS);
// the chart's display range ('auto' = robust to tails, 'full' = min..max, 'manual'): remembered per viewer, never required
function loadRange() { try { return normalizeRange(JSON.parse(localStorage.getItem(RANGE_KEY)), null); } catch { return normalizeRange(null); } } // null: a manual window is only checked for being finite here; it is clamped to the data's axis when drawn (windowFor), and only on the axis it was set on
function saveRange() { try { localStorage.setItem(RANGE_KEY, JSON.stringify(st.range)); } catch { /* private window: the choice just lasts for the session */ } }
const st = {
  open: false, log: false, timer: 0, job: null, lastRun: '', lastDisp: '', doneSig: '', stopSig: '', message: '', lang: '',
  listeners: new Set(), sliceMs: 30, // sliceMs: how long a pass works before it yields
  retries: 0, // passes restarted after __SUPERSEDED__
  cur: {}, totals: new Map(), runCache: new Map(), volIds: new WeakMap(), nextVolId: 1, drag: null, win: null, hover: null, range: loadRange(), rangeEls: null,
  el: null, canvas: null, table: null, progress: null, status: null, cancelBtn: null, logBtn: null, linBtn: null, hint: null
};

const effSig = () => { const stages = sourceFilterStages(); return effectiveHuSignature(getHuMode(), stages.length, stages.length ? sourceFilterSignature(stages) : ''); };
const totalKey = v => volId(v) + '|' + effSig();
const volId = v => { let id = st.volIds.get(v); if (!id) { id = st.nextVolId++; st.volIds.set(v, id); } return id; };
// the child segments (key 's<id>', child-segments.js) are segments of the histogram too: while one is shown (visible, its parent ticked) it has its own curve, row and shade range. Its voxels are its own mask
// (child.runsBySlice); it has no min / max of its own to drag (no range lines). (Ported from the tree-segments work d99f5414 for child segments.)
const enabledKeys = () => shownSegmentKeys();
const segOf = key => { if (!isChildKey(key)) return segmentState[key]; const g = segmentById(key); return { color: g?.color || '#888', min: null, max: null, userMin: null, userMax: null }; };
const nameOf = key => isChildKey(key) ? (segmentById(key)?.name || key) : (tr(key) || key);
// does the segment need its final runs (post-processing / edits / takers above / filtered source), or is it a plain range of the raw data?
const needsRuns = key => isChildKey(key) || segmentNeedsRuns(segmentNeedsVoxelMask(key), sourceFilterStages().length);
// the volume the segment code builds a segment from: source-backed = the volume itself; in-memory = the 3D build volume (the filtered one when filters are on)
const segmentVolume = v => (v.sourceBacked ? v : current3DVolume || v);
const keySig = (key, v) => { if (isChildKey(key)) { const c = childByKey(key); return [volId(v), sourceFilterSignature(sourceFilterStages()), effSig(), key, c?.hash, c?.voxels].join('|'); } const s = segmentState[key]; return [volId(v), sourceFilterSignature(sourceFilterStages()), effSig(), key, s.min, s.max, s.opening, s.closing, s.minComponent, s.holeFill ? 1 : 0, s.surfaceMm, s.thicknessMm, segmentEditGen[key] | 0, segmentSourceSignature(key, true)].join(','); };
// what must be (re)computed: the run-based segments and whether the whole-volume histogram is needed
function runSignature(v) {
  const keys = enabledKeys(), runKeys = keys.filter(k => needsRuns(k, v)), needTotal = !keys.length || runKeys.length < keys.length;
  return volId(v) + '|' + effSig() + '|' + (needTotal ? 'T' : '-') + '|' + runKeys.map(k => keySig(k, v)).join(';') + '|-';
}
// what is drawn: every shown segment's range as well (cheap: a plain range is a slice of the total)
const displaySignature = v => runSignature(v) + '|' + enabledKeys().map(k => { const s = segOf(k); return [k, s.min, s.max, s.userMin, s.userMax, s.color, isChildKey(k) ? nameOf(k) : ''].join(','); }).join(';') + '|' + st.log + '|' + currentLanguage + '|' + (st.job ? 1 : 0) + st.message;

function remember(ck, entry) {
  st.runCache.delete(ck); st.runCache.set(ck, entry);
  while (st.runCache.size > CACHE_MAX) st.runCache.delete(st.runCache.keys().next().value);
}
async function cacheKeyFor(v, key) {
  if (isChildKey(key)) return keySig(key, v);
  const seg = segmentState[key], extra = { hist: 1, vol: volId(v), gen: segmentEditGen[key] | 0, src: segmentSourceSignature(key, true), hu: effSig() };
  try { return await segmentRunsCacheKey(v.series, sourceFilterSignature(sourceFilterStages()), seg, extra); } catch { return keySig(key, v); }
}

// ---- the pass ----
function setProgress(text, fraction) {
  if (!st.progress) return;
  st.progress.hidden = fraction == null;
  if (fraction != null) st.progress.value = fraction;
  if (st.status) st.status.textContent = text || '';
}
// how the pass gives the thread back
const pause = () => frameYield();
const CHUNK = 32768, RUN_CHUNK = 3 * 2048; // voxels / run triples binned between two time checks (well under 1 ms on a Quest 3)
async function streamPass(job, v, runs, todo, wantTotal, step, label) {
  const n = v.slices, w = v.columns;
  const total = wantTotal ? createHist() : null, hists = todo.map(() => createHist());
  const raw = rawHuVolume(), mode = getHuMode(), axis = axisOf(v);
  let last = performance.now(), sampled = 0;
  // the work of one slice is cut into chunks, and the time is checked after each: a pass never holds the thread much longer than sliceMs
  const budget = async z => { if (performance.now() - last > st.sliceMs) { setProgress(label + ' ' + Math.round(100 * z / n) + '%', z / n); await pause(); last = performance.now(); } return !job.cancelled; };
  for (let z = 0; z < n; z += step) {
    if (job.cancelled) return null;
    const values = await readEffectiveSlice(z, { mode, volume: raw });
    if (job.cancelled) return null;
    if (total) for (let a = 0; a < values.length; a += CHUNK) { binValues(total, values, a, Math.min(values.length, a + CHUNK), axis); if (!(await budget(z))) return null; }
    for (let i = 0; i < todo.length; i++) {
      const r = runs[todo[i]]?.[z]; if (!r) continue;
      for (let a = 0; a < r.length; a += RUN_CHUNK) { binRuns(hists[i], values, r, w, a, a + RUN_CHUNK, axis); if (!(await budget(z))) return null; }
    }
    sampled++;
    if (!(await budget(z))) return null;
  }
  const k = sampled ? n / sampled : 1;
  return { total: total && (k === 1 ? total : scaleHist(total, k)), hists: hists.map(h => (k === 1 ? h : scaleHist(h, k))), draft: step > 1 };
}
async function runJob(sig) {
  const v = volume;
  if (!v || st.job) return;
  const job = { sig, cancelled: false };
  st.job = job; st.message = '';
  try {
    const keys = enabledKeys(), runKeys = keys.filter(k => needsRuns(k, v));
    const cks = await Promise.all(runKeys.map(k => cacheKeyFor(v, k)));
    runKeys.forEach((k, i) => { st.cur[k] = { ks: keySig(k, v), ck: cks[i] }; });
    const finish = () => { if (job.cancelled) return false; st.doneSig = sig; st.retries = 0; return true; };
    const todo = runKeys.filter((k, i) => { const c = st.runCache.get(cks[i]); return !c || c.draft; });
    const tot = st.totals.get(totalKey(v)), wantTotal = (!keys.length || runKeys.length < keys.length) && (!tot || tot.draft);
    if (!todo.length && !wantTotal) { finish(); return; }
    const runs = {};
    for (const k of todo) {
      setProgress(tr('segHistPrepare') + ': ' + nameOf(k), 0);
      if (isChildKey(k)) { runs[k] = childByKey(k)?.runsBySlice || []; continue; }
      runs[k] = await getFinalSegmentRuns(k, segmentVolume(v), (d, t) => { if (!job.cancelled) setProgress(tr('segHistPrepare') + ': ' + nameOf(k) + ' ' + Math.round(100 * d / Math.max(1, t)) + '%', d / Math.max(1, t)); });
      if (job.cancelled) return;
    }
    const steps = v.slices >= DRAFT_MIN_SLICES ? [Math.ceil(v.slices / DRAFT_SLICES), 1] : [1];
    for (const [si, step] of steps.entries()) {
      const r = await streamPass(job, v, runs, todo, wantTotal, step, step > 1 ? tr('segHistDraft') : tr('segHistReading'));
      if (!r) return;
      if (r.total) { const tk = totalKey(v); st.totals.delete(tk); st.totals.set(tk, { hist: r.total, draft: r.draft }); while (st.totals.size > 6) st.totals.delete(st.totals.keys().next().value); }
      todo.forEach((k, i) => remember(st.cur[k].ck, { hist: r.hists[i], draft: r.draft }));
      draw(true);
    }
    finish();
  } catch (e) {
    // __SUPERSEDED__: another computation of the same tiles took the worker slot (or the settings moved under the segment code): not a result,
    // so the pass starts again on a later poll (it stopped here for good, silently: the VR board said 「計算中」 for ever)
    const msg = String(e?.message || e);
    if (!job.cancelled) {
      if (msg === '__SUPERSEDED__' && st.retries < MAX_RETRIES) { st.retries++; st.lastRun = ''; }
      else { st.stopSig = sig; st.message = msg === '__SUPERSEDED__' ? tr('segHistInterrupted') : tr('segHistError') + ': ' + msg; }
    }
  } finally {
    if (st.job === job) { st.job = null; setProgress('', null); } else if (!st.job) setProgress('', null); // a cancelled stale job must not wipe the running job's progress
    draw(true);
  }
}
function cancelJob(userAsked) {
  const job = st.job;
  if (!job) return;
  job.cancelled = true; st.job = null;
  if (userAsked) { st.stopSig = job.sig; st.message = tr('segHistCancelled'); }
  setProgress('', null); draw(true);
}

// ---- the per-segment histograms for the auto shading range of the cut face (cap-shade.js autoShadeRange; asked for by segments.js shadeAutoPage on a data open / threshold change) ----
// computeSegmentHistograms(keys, stale) -> {key: Uint32Array(4096) | null}: the values of the voxels that belong to each segment, counted into 4096 bins over the DATA's own range (volume.min..max: cap-shade.js binShadeValues /
// binShadeRuns; not this panel's fixed HU bins, so MRI values up to 65535 count right). The voxel rule is the panel's: a segment that is a plain range of the data = the values inside its min..max, else its FINAL runs (post-processing,
// edits, voxel takers above). The values are read from the FILTERED planes (effective-hu.js: the raw ones while no filter is on) = the data the 3D shading shows, every slice. A pass of its own: no panel state, cache or progress
// bar is touched, it works in time slices (sliceMs) and stops (null) as soon as stale() is true. null for a key = no voxel. A segment that is not ticked and would need its runs is left out (not computed).
export async function computeSegmentHistograms(keys, stale) {
  const v = volume, data = shadeDataRange();
  if (!v || !data) return null;
  // a child segment counts its own mask (no pass to find it); the presets as before
  const childKeys = keys.filter(k => isChildKey(k) && childByKey(k)?.runsBySlice);
  const presetRunKeys = keys.filter(k => !isChildKey(k) && segmentState[k]?.active && needsRuns(k, v)), plainKeys = keys.filter(k => !isChildKey(k) && segmentState[k] && !needsRuns(k, v));
  const runKeys = [...presetRunKeys, ...childKeys], runs = {};
  for (const k of presetRunKeys) { runs[k] = await getFinalSegmentRuns(k, segmentVolume(v)); if (stale()) return null; }
  for (const k of childKeys) runs[k] = childByKey(k).runsBySlice;
  const n = v.slices, w = v.columns, raw = rawHuVolume(), plain = plainKeys.map(() => createShadeHist()), hists = runKeys.map(() => createShadeHist());
  let last = performance.now();
  const budget = async () => { if (performance.now() - last > st.sliceMs) { await frameYield(); last = performance.now(); } return !stale(); };
  for (let z = 0; z < n; z++) {
    const values = await readEffectiveSlice(z, { mode: HU_MODE_FILTERED, volume: raw });
    if (stale()) return null;
    for (let i = 0; i < plainKeys.length; i++) {
      const sg = segmentState[plainKeys[i]];
      for (let a = 0; a < values.length; a += CHUNK) { binShadeValues(plain[i], values, data.min, data.max, a, Math.min(values.length, a + CHUNK), sg.min, sg.max); if (!(await budget())) return null; }
    }
    for (let i = 0; i < runKeys.length; i++) {
      const r = runs[runKeys[i]]?.[z]; if (!r) continue;
      for (let a = 0; a < r.length; a += RUN_CHUNK) { binShadeRuns(hists[i], values, r, w, data.min, data.max, a, a + RUN_CHUNK); if (!(await budget())) return null; }
    }
    if (!(await budget())) return null;
  }
  const out = {};
  plainKeys.forEach((k, i) => { out[k] = shadeHistCount(plain[i]) ? plain[i] : null; });
  runKeys.forEach((k, i) => { out[k] = shadeHistCount(hists[i]) ? hists[i] : null; });
  return out;
}

// ---- results as drawn ----
function resultsFor(v) {
  const out = [], tot = st.totals.get(totalKey(v)), axis = axisOf(v);
  for (const key of enabledKeys()) {
    const seg = segOf(key);
    let hist = null, draft = false;
    if (needsRuns(key, v)) {
      const c = st.cur[key], ok = c && c.ks === keySig(key, v);
      const e = ok ? st.runCache.get(c.ck) : null; if (e) { hist = e.hist; draft = e.draft; }
    }
    else if (tot) { hist = histInRange(tot.hist, seg.min, seg.max, axis); draft = tot.draft; }
    out.push({ key, seg, hist, draft, stats: hist ? histStats(hist, undefined, axis) : null });
  }
  return { list: out, total: tot || null, axis };
}

// ---- chart ----
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function chartWindow(res) {
  if (st.drag && st.win) return st.win;
  return (st.win = windowFor(res, st.range));
}
// the display range only moves what is drawn: stats and the table are always over the whole data
function setRange(range) { const axis = axisOf(volume); st.range = normalizeRange({ ...range, ax: axisKey(axis) }, axis); st.win = null; saveRange(); draw(true); } // a manual window remembers the axis it was set on (a CT window is not applied to MRI data)
function zoomAt(e) {
  const v = volume; if (!v || !st.canvas) return;
  const res = resultsFor(v), r = plotRect(st.canvas), [lo, hi] = chartWindow(res);
  const x = Math.max(0, Math.min(r.w, e.clientX - st.canvas.getBoundingClientRect().left - r.x)), anchor = xToHu(x, lo, hi, r.w);
  const w = zoomWindow(lo, hi, anchor, e.deltaY < 0 ? 0.8 : 1.25, res.axis);
  if (w) setRange({ mode: 'manual', lo: w[0], hi: w[1] });
}
function plotRect(canvas) { return { x: PAD.l, y: PAD.t, w: Math.max(10, canvas.clientWidth - PAD.l - PAD.r), h: CHART_H - PAD.t - PAD.b }; }
function drawChart(res) {
  const canvas = st.canvas;
  if (!canvas || !canvas.clientWidth) return;
  const dpr = globalThis.devicePixelRatio || 1, W = canvas.clientWidth;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(CHART_H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(CHART_H * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, CHART_H);
  const fg = getComputedStyle(canvas).color || '#888', r = plotRect(canvas), [lo, hi] = chartWindow(res), axis = res.axis, minSpan = axisWidth(axis);
  ctx.font = '9px system-ui,sans-serif'; ctx.textBaseline = 'middle';
  const series = res.list.filter(s => s.hist);
  if (!res.list.length && res.total) series.push({ key: 'all', seg: { color: '#8c969c' }, hist: res.total.hist });
  const cols = Math.max(1, Math.min(windowBins(lo, hi, axis), Math.floor(r.w / 2)));
  const bars = series.map(s => rebinHist(s.hist, lo, hi, cols, undefined, axis));
  let ymax = 1; for (const b of bars) for (const c of b) if (c > ymax) ymax = c;
  const yOf = c => (st.log ? Math.log10(1 + c) / Math.log10(1 + ymax) : c / ymax);
  // axes
  ctx.globalAlpha = 0.35; ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke();
  ctx.globalAlpha = 0.8; ctx.textAlign = 'center';
  const step = niceStep(hi - lo, Math.max(3, Math.floor(r.w / 48)), axis);
  for (let k = Math.ceil(lo / step - 1e-9), hu; (hu = k * step) <= hi + step * 1e-9; k++) {
    const x = r.x + huToX(hu, lo, hi, r.w, minSpan);
    ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke();
    ctx.globalAlpha = 0.8; ctx.fillText(tickText(hu, step), x, r.y + r.h + 10);
  }
  ctx.textAlign = 'right'; ctx.fillText(ymax >= 1e6 ? (ymax / 1e6).toFixed(1) + 'M' : ymax >= 1e3 ? Math.round(ymax / 1e3) + 'k' : String(ymax), r.x - 3, r.y + 4);
  ctx.fillText('0', r.x - 3, r.y + r.h);
  // bars (overlay, one colour per segment)
  const bw = r.w / cols;
  bars.forEach((b, i) => {
    ctx.fillStyle = series[i].seg.color; ctx.globalAlpha = series.length > 1 ? 0.55 : 0.75;
    for (let c = 0; c < cols; c++) { if (!b[c]) continue; const h = Math.max(1, yOf(b[c]) * r.h); ctx.fillRect(r.x + c * bw, r.y + r.h - h, Math.max(1, bw - 0.3), h); }
  });
  // HU range lines (draggable)
  ctx.globalAlpha = 1; ctx.lineWidth = 1.5;
  let edgeL = 0, edgeR = 0;
  for (const s of res.list) {
    const a = s.seg.userMin ?? s.seg.min, b = s.seg.userMax ?? s.seg.max;
    if (a == null || b == null) continue; // a child segment has no range of its own
    for (const [hu, side] of [[a, 1], [b, -1]]) {
      if (hu < lo || hu > hi) { // outside the visible range: a marker on that edge (still draggable there), stacked so two do not overlap
        const left = hu < lo, k = left ? edgeL++ : edgeR++, ex = r.x + (left ? 0 : r.w), ey = r.y + 6 + 11 * k, d = left ? 1 : -1;
        ctx.fillStyle = s.seg.color; ctx.beginPath(); ctx.moveTo(ex - d * 5, ey); ctx.lineTo(ex + d * 3, ey - 4); ctx.lineTo(ex + d * 3, ey + 4); ctx.fill();
        ctx.fillStyle = fg; ctx.textAlign = left ? 'left' : 'right'; ctx.fillText(fmtAxisValue(hu, axis), ex + d * 7, ey);
        continue;
      }
      const x = r.x + huToX(hu, lo, hi, r.w, minSpan);
      ctx.strokeStyle = s.seg.color; ctx.fillStyle = s.seg.color;
      ctx.beginPath(); ctx.moveTo(x, r.y - 2); ctx.lineTo(x, r.y + r.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, r.y - 2); ctx.lineTo(x + 4 * side, r.y - 2); ctx.lineTo(x, r.y + 3); ctx.fill();
      ctx.fillStyle = fg; ctx.textAlign = side > 0 ? 'left' : 'right'; ctx.fillText(fmtAxisValue(hu, axis), x + 5 * side, r.y - 5 + 0);
    }
  }
  ctx.globalAlpha = 1;
}

// ---- table ----
const fmt = (x, d = 1) => (x == null ? '—' : x.toFixed(d));
function drawTable(res, v) {
  const t = st.table; if (!t) return;
  const axis = res.axis, dp = axisDecimals(axis), sp = v?.spacing, head = [tr('statSegment'), tr('statCount'), sp ? tr('statVolume') : null, tr('statMean'), 'SD', 'p5', 'p25', 'p50', 'p75', 'p95', tr('statMin'), tr('statMax')].filter(Boolean);
  const rows = res.list.map(s => ({ name: nameOf(s.key), color: s.seg.color, stats: s.stats, draft: s.draft }));
  if (!rows.length && res.total) rows.push({ name: tr('segHistWhole'), color: '#8c969c', stats: histStats(res.total.hist, undefined, axis), draft: res.total.draft });
  const table = document.createElement('table'); table.className = 'seg-hist-table';
  const tr0 = table.createTHead().insertRow(); for (const h of head) { const th = document.createElement('th'); th.textContent = h; tr0.append(th); }
  const body = table.createTBody();
  for (const row of rows) {
    const tr1 = body.insertRow(), s = row.stats, cells = [];
    const name = tr1.insertCell(); const sw = document.createElement('span'); sw.className = 'seg-hist-swatch'; sw.style.background = row.color;
    name.append(sw, document.createTextNode(row.name + (row.draft ? ' *' : '')));
    if (!s) { const c = tr1.insertCell(); c.colSpan = head.length - 1; c.textContent = '…'; continue; }
    cells.push(s.count.toLocaleString());
    if (sp) { const mm3 = voxelsToMm3(s.count, sp); cells.push(mm3 == null ? '—' : mm3.toLocaleString(undefined, { maximumFractionDigits: 1 })); }
    cells.push(fmt(s.mean, dp + 1), fmt(s.sd, dp + 1), ...[5, 25, 50, 75, 95].map(p => fmt(s.percentiles[p], dp)), fmt(s.min, dp), fmt(s.max, dp)); // whole HU on the CT axis (dp 0: mean / SD one decimal, as before); finer on a narrow data range
    for (const c of cells) tr1.insertCell().textContent = c;
  }
  t.replaceChildren(table);
}
function draw(force = false) {
  emit();
  if (!st.open || !st.el) return;
  const v = volume;
  if (!v) { st.table?.replaceChildren(); return; }
  if (!force && !st.canvas?.clientWidth) return;
  const res = resultsFor(v);
  drawChart(res); drawTable(res, v);
  if (st.status && !st.job) st.status.textContent = st.message || (enabledKeys().length ? '' : tr('segHistNoSeg'));
  if (st.cancelBtn) { st.cancelBtn.textContent = st.job ? tr('segHistCancel') : tr('segHistRecalc'); st.cancelBtn.disabled = !st.job && !enabledKeysNeedWork(v); }
  syncRangeUi(res);
  st.logBtn?.classList.toggle('is-active', st.log); st.linBtn?.classList.toggle('is-active', !st.log);
}
// the range boxes show the window really drawn (also in auto / full); a box being typed in is left alone
function syncRangeUi(res) {
  const e = st.rangeEls; if (!e) return;
  const [lo, hi] = chartWindow(res), step = res.axis.hu ? '10' : 'any'; // the spin step: 10 HU on the CT axis; any value on another data range
  if (e.lo.step !== step) e.lo.step = e.hi.step = step;
  if (document.activeElement !== e.lo) e.lo.value = fmtAxisValue(lo, res.axis);
  if (document.activeElement !== e.hi) e.hi.value = fmtAxisValue(hi, res.axis);
  e.auto.classList.toggle('is-active', st.range.mode === 'auto'); e.full.classList.toggle('is-active', st.range.mode === 'full');
}
// "Recalculate" is offered when a pass was cancelled / failed for the current settings
const enabledKeysNeedWork = v => st.doneSig !== runSignature(v);

// ---- dragging the range lines ----
const sliderValue = (el, hu) => {
  const step = +el.step || 1, full = ctSliderFullBounds(el), val = Math.round(hu / step) * step;
  return full ? clamp(val, full[0], full[1]) : val;
};
function setSlider(key, which, hu) {
  const el = segmentControl(which, key); if (!el) return;
  const step = +el.step || 1, val = sliderValue(el, hu);
  if (val < +el.min || val > +el.max) setCtSliderRange(el, Math.min(val, +el.min), Math.max(val, +el.max), step);
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true })); // the slider's own handler (user range, effective ranges, previews)
}
function hitLine(e) {
  const v = volume; if (!v || !st.canvas) return null;
  // CSS px: the canvas is drawn through setTransform(dpr), so clientX - rect.left is already in drawing units
  const res = resultsFor(v), r = plotRect(st.canvas), [lo, hi] = chartWindow(res), x = e.clientX - st.canvas.getBoundingClientRect().left;
  const cand = [], edge = []; // edge: lines outside the visible range, grabbed at the chart edge only when no visible line is under the pointer
  for (const s of res.list) for (const which of ['min', 'max']) {
    if ((s.seg.userMin ?? s.seg.min) == null) continue; // a child segment has no range lines
    const hu = which === 'min' ? (s.seg.userMin ?? s.seg.min) : (s.seg.userMax ?? s.seg.max);
    (hu < lo || hu > hi ? edge : cand).push({ key: s.key, which, x: r.x + (hu < lo ? 0 : hu > hi ? r.w : huToX(hu, lo, hi, r.w, axisWidth(res.axis))) });
  }
  for (const list of [cand, edge]) { const i = nearestLine(list.map(c => c.x), x, GRAB_PX); if (i >= 0) return { key: list[i].key, which: list[i].which }; }
  return null;
}
function installDrag(canvas) {
  canvas.style.touchAction = 'none';
  // the 3D camera controls must not see these events: stop them here (as the 3D view buttons do in scene-view.js)
  const own = (type, fn) => canvas.addEventListener(type, e => { e.stopPropagation(); fn(e); });
  own('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const hit = hitLine(e); if (!hit) return;
    const v = volume; st.drag = hit; st.win = chartWindow(resultsFor(v)); canvas.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  own('pointermove', e => {
    if (!st.drag) { canvas.style.cursor = hitLine(e) ? 'ew-resize' : ''; return; }
    const r = plotRect(canvas), [lo, hi] = st.win, box = canvas.getBoundingClientRect();
    setSlider(st.drag.key, st.drag.which, xToHu(e.clientX - box.left - r.x, lo, hi, r.w));
    draw(true);
  });
  const end = e => {
    if (!st.drag) return;
    const { key, which } = st.drag; st.drag = null; canvas.releasePointerCapture?.(e.pointerId);
    segmentControl(which, key)?.dispatchEvent(new Event('change', { bubbles: true })); // on release, like the slider
    st.win = null; draw(true);
  };
  own('pointerup', end); own('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.stopPropagation(); e.preventDefault(); zoomAt(e); }, { passive: false }); // wheel = zoom the axis around the pointer
}

// ---- panel ----
function build() {
  const box = st.el, mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const bar = mk('div', 'seg-hist-bar'), title = mk('strong', '', tr('segHistTitle'));
  st.linBtn = mk('button', 'seg-hist-mini', tr('segHistLinear')); st.logBtn = mk('button', 'seg-hist-mini', tr('segHistLog'));
  for (const b of [st.linBtn, st.logBtn]) b.type = 'button';
  st.linBtn.onclick = () => { st.log = false; draw(true); }; st.logBtn.onclick = () => { st.log = true; draw(true); };
  bar.append(title, huModeToggle(currentLanguage, filtersActive), st.linBtn, st.logBtn);
  const row = mk('div', 'seg-hist-range'), num = () => { const i = mk('input', 'seg-hist-num'); i.type = 'number'; i.step = '10'; i.inputMode = 'numeric'; return i; };
  const lo = num(), hi = num(), auto = mk('button', 'seg-hist-mini', tr('segHistAuto')), full = mk('button', 'seg-hist-mini', tr('segHistFull'));
  auto.type = full.type = 'button'; lo.setAttribute('aria-label', tr('segHistRange') + ' min'); hi.setAttribute('aria-label', tr('segHistRange') + ' max');
  const commit = () => { const axis = axisOf(volume), w = clampWindow(lo.value, hi.value, axis); if (w) { lo.value = fmtAxisValue(w[0], axis); hi.value = fmtAxisValue(w[1], axis); setRange({ mode: 'manual', lo: w[0], hi: w[1] }); } else draw(true); };
  for (const i of [lo, hi]) { i.onchange = commit; i.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') commit(); }; i.onpointerdown = e => e.stopPropagation(); }
  auto.onclick = () => setRange({ mode: 'auto' }); full.onclick = () => setRange({ mode: 'full' });
  row.append(mk('span', '', tr('segHistRange')), lo, mk('span', '', '–'), hi, mk('span', '', 'HU'), auto, full);
  st.rangeEls = { lo, hi, auto, full };
  st.canvas = mk('canvas', 'seg-hist-canvas'); st.canvas.style.height = CHART_H + 'px'; installDrag(st.canvas);
  const prog = mk('div', 'seg-hist-progress');
  st.progress = document.createElement('progress'); st.progress.max = 1; st.progress.value = 0; st.progress.hidden = true;
  st.status = mk('span', 'seg-hist-status'); st.cancelBtn = mk('button', 'seg-hist-mini', tr('segHistRecalc')); st.cancelBtn.type = 'button';
  st.cancelBtn.onclick = () => { if (st.job) cancelJob(true); else { st.stopSig = ''; st.message = ''; st.lastRun = ''; st.retries = 0; tick(true); } };
  prog.append(st.progress, st.status, st.cancelBtn);
  st.table = mk('div', 'seg-hist-tablewrap'); st.hint = mk('div', 'seg-hist-hint', tr('segHistHint'));
  box.replaceChildren(bar, row, st.canvas, prog, st.table, st.hint);
  st.lang = currentLanguage;
}
function tick(force = false) {
  const v = volume;
  if (!active() || !v) { if (st.job && !v) cancelJob(false); return; }
  if (st.lang !== currentLanguage) { if (st.open) build(); else st.lang = currentLanguage; draw(true); }
  const run = runSignature(v), disp = displaySignature(v);
  if (disp !== st.lastDisp) { st.lastDisp = disp; draw(true); }
  if (run !== st.lastRun) {
    // the settings moved: stop the pass now, restart once they are stable (the next tick sees the same signature)
    st.lastRun = run; if (st.job && st.job.sig !== run) cancelJob(false); if (st.stopSig !== run) st.stopSig = ''; if (!force) return;
  }
  if (!st.job && run !== st.doneSig && run !== st.stopSig) void runJob(run);
}
function setOpen(on, btn) {
  st.open = !!on; st.el.classList.toggle('is-hidden', !st.open); btn.classList.toggle('is-active', st.open);
  restart();
  if (st.open) requestAnimationFrame(() => draw(true));
}
// (re)start the poll while the PC card is open or another consumer (the VR panel) holds the results; stop it, and the pass, when nobody does
function restart() {
  clearInterval(st.timer); st.timer = 0;
  if (!active()) { cancelJob(false); return; }
  if (st.open) build();
  st.lastRun = ''; st.lastDisp = ''; st.timer = setInterval(tick, POLL_MS); tick(true);
}
const active = () => st.open;
function emit() { for (const fn of st.listeners) { try { fn(); } catch (e) { console.error(e); } } }

// ---- for the VR board ----
// onHistogramChange(fn) is called whenever the drawn chart may have changed (the range / the scale)
export const getHistogramLog = () => st.log;
// the chart's display range (自動 / 全体 / 手動), for the VR board's x axis (the same object until it is set again)
export const getHistogramRange = () => st.range;
// the VR board sets the display range (the end drag of its x axis = 手動, its 「自動」 button = auto): the same as the PC card's own controls
export function setHistogramRange(range) { setRange(range); }
export function onHistogramChange(fn) { st.listeners.add(fn); return () => st.listeners.delete(fn); }
export function setHistogramLog(on) { st.log = !!on; draw(true); }
// 体験会モード (event-fresh.js): back to the start state (自動 range, linear scale) and the remembered range of the previous visitor is forgotten
export function resetHistogramView() {
  st.log = false; st.range = normalizeRange(null); st.win = null; st.hover = null; st.drag = null;
  try { localStorage.removeItem(RANGE_KEY); } catch { /* private window */ }
  draw(true);
}
export function installSegmentHistogram() {
  setShadeAutoSource(computeSegmentHistograms); // the auto shading range reads its per-segment values here (the panel itself is not needed)
  const btn = document.getElementById('seg-hist-toggle'), box = document.getElementById('seg-hist-result');
  if (!btn || !box) return;
  st.el = box;
  btn.onclick = () => { if (volume) setOpen(!st.open, btn); };
  // the sliders move the lines (and the other way round): redraw after the slider's own handler ran
  const follow = e => { if (st.open && e.target?.matches?.('[data-seg-min],[data-seg-max]')) requestAnimationFrame(() => draw(true)); };
  document.addEventListener('input', follow, true); document.addEventListener('change', follow, true);
  addEventListener('resize', () => draw(true));
  document.addEventListener('vrl-themechange', () => draw(true));
  setInterval(() => { btn.disabled = !volume; if (!volume && st.open) setOpen(false, btn); }, 1000);
}
