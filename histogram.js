// Per-segment HU histogram. Pure functions only (no DOM, no app state), so the unit tests use them directly.
// Fixed 1-HU bins from HIST_MIN (-1024) to HIST_MAX (3071): 4096 bins; values outside are clamped into the two end bins
// (bin 0 = "<= -1024", the last bin = ">= 3071"). A histogram is a Uint32Array(HIST_BINS); the results of a whole volume stay tiny.
export const HIST_MIN = -1024;
export const HIST_MAX = 3071;
export const HIST_BINS = HIST_MAX - HIST_MIN + 1;
export const HIST_PERCENTILES = [5, 25, 50, 75, 95];
export const ROBUST_LO_P = 0.5, ROBUST_HI_P = 99.5; // the percentile window of the robust (auto) chart range
export const ROBUST_MIN_FRAC = 0.03; // ... whose ends are then trimmed to the bins that reach this fraction of the highest bin (a shorter bar is a sliver of a few pixels on the chart)
export const MIN_WINDOW = 50; // the narrowest chart window (HU)
const AUTO_RANGE = { mode: 'auto', lo: 0, hi: 0 };

export const createHist = () => new Uint32Array(HIST_BINS);
// HU (any number) -> bin index, rounded to the nearest HU and clamped
export function huToBin(hu) {
  const i = Math.round(+hu) - HIST_MIN;
  return i < 0 ? 0 : i >= HIST_BINS ? HIST_BINS - 1 : i;
}
export const binToHu = i => i + HIST_MIN;

// add values[start..end) to hist (NaN is skipped)
export function binValues(hist, values, start = 0, end = values.length) {
  for (let i = start; i < end; i++) {
    const v = values[i];
    if (v !== v) continue;
    const b = Math.round(v) - HIST_MIN;
    hist[b < 0 ? 0 : b >= HIST_BINS ? HIST_BINS - 1 : b]++;
  }
  return hist;
}
// add the voxels of one slice that lie in `runs` (the analysis run format: triples y, x0, x1 with x1 inclusive) to hist;
// `values` is the slice (width w, row-major); only the triples from index i0 (a multiple of 3) up to i1 when given (a pass bins a long slice in parts)
export function binRuns(hist, values, runs, w, i0 = 0, i1 = runs ? runs.length : 0) {
  if (!runs) return hist;
  const end = Math.min(i1, runs.length);
  for (let i = i0; i + 2 < end; i += 3) {
    const base = runs[i] * w;
    binValues(hist, values, base + runs[i + 1], base + runs[i + 2] + 1);
  }
  return hist;
}
export function mergeHist(dst, src) {
  for (let i = 0; i < HIST_BINS; i++) dst[i] += src[i];
  return dst;
}
// every count multiplied by k (a draft that read every k-th slice is scaled up to the whole volume)
export function scaleHist(hist, k) {
  const out = createHist();
  for (let i = 0; i < HIST_BINS; i++) out[i] = Math.round(hist[i] * k);
  return out;
}
// the bins of `hist` inside the HU range [min, max] (a segment defined by a plain HU range needs no pass of its own: it is a slice of the total)
export function histInRange(hist, min, max) {
  const out = createHist();
  if (!(max >= min) || max < HIST_MIN - 0.5 || min > HIST_MAX + 0.5) return out;
  const a = huToBin(Math.ceil(min - 0.5)), b = huToBin(Math.floor(max + 0.5));
  for (let i = a; i <= b; i++) out[i] = hist[i];
  return out;
}
export function histCount(hist) {
  let n = 0;
  for (let i = 0; i < HIST_BINS; i++) n += hist[i];
  return n;
}
// counts for display: the HU window [lo, hi] (inclusive, whole HU) cut into `columns` columns of equal width.
// Returns Float64Array(columns); a column holds the sum of the bins it covers.
// out (optional,: the VR board's drag redraw allocates nothing): a reused array at least `columns` long; its first `columns` entries are
// cleared and written, the rest is left alone
export function rebinHist(hist, lo, hi, columns, out) {
  const n = Math.max(1, columns | 0);
  if (out && out.length >= n) out.fill(0, 0, n); else out = new Float64Array(n);
  const a = Math.max(HIST_MIN, Math.round(lo)), b = Math.min(HIST_MAX, Math.round(hi));
  if (b < a) return out;
  const span = hi - lo + 1;
  for (let hu = a; hu <= b; hu++) {
    let c = Math.floor((hu - lo) / span * n);
    if (c < 0) c = 0; else if (c >= n) c = n - 1;
    out[c] += hist[hu - HIST_MIN];
  }
  return out;
}
// the HU extent that holds data (first / last non-empty bin), or null for an empty histogram
export function histExtent(hist) {
  let a = 0, b = HIST_BINS - 1;
  while (a < HIST_BINS && !hist[a]) a++;
  if (a >= HIST_BINS) return null;
  while (b > a && !hist[b]) b--;
  return [binToHu(a), binToHu(b)];
}
// count, mean, SD (population), min, max and the percentiles p5 / p25 / p50 / p75 / p95, all from the bins (bin value = its HU;
// a percentile is the first bin whose cumulative count reaches p % of the voxels, "nearest rank"). Empty: count 0, the rest null.
export function histStats(hist, percentiles = HIST_PERCENTILES) {
  const count = histCount(hist);
  const out = { count, mean: null, sd: null, min: null, max: null, percentiles: Object.fromEntries(percentiles.map(p => [p, null])) };
  if (!count) return out;
  let sum = 0, first = -1, last = -1;
  for (let i = 0; i < HIST_BINS; i++) {
    const c = hist[i];
    if (!c) continue;
    if (first < 0) first = i;
    last = i;
    sum += c * binToHu(i);
  }
  const mean = sum / count;
  let ss = 0;
  for (let i = first; i <= last; i++) { const c = hist[i]; if (c) { const d = binToHu(i) - mean; ss += c * d * d; } }
  out.mean = mean; out.sd = Math.sqrt(ss / count); out.min = binToHu(first); out.max = binToHu(last);
  const targets = percentiles.map(p => Math.max(1, Math.ceil(count * p / 100)));
  const order = percentiles.map((p, i) => i).sort((x, y) => percentiles[x] - percentiles[y]);
  let cum = 0, pi = 0;
  for (let i = first; i <= last && pi < order.length; i++) {
    cum += hist[i];
    while (pi < order.length && cum >= targets[order[pi]]) { out.percentiles[percentiles[order[pi]]] = binToHu(i); pi++; }
  }
  return out;
}
// volume in mm³ of `count` voxels (null when the spacing is unknown)
export function voxelsToMm3(count, spacing) {
  if (!spacing || spacing.length < 3) return null;
  const v = (+spacing[0]) * (+spacing[1]) * (+spacing[2]);
  return Number.isFinite(v) && v > 0 ? count * v : null;
}
// pixel <-> HU for the chart (window [lo, hi], plot width w)
export const huToX = (hu, lo, hi, w) => (hu - lo) / Math.max(1, hi - lo) * w;
export const xToHu = (x, lo, hi, w) => lo + x / Math.max(1, w) * (hi - lo);
// nearest line to a pointer x (CSS px, same space as xs); -1 when none is within tol px
export function nearestLine(xs, x, tol = 6) {
  let best = -1, bd = tol + 1e-9;
  xs.forEach((lx, i) => { const d = Math.abs(lx - x); if (d < bd) { bd = d; best = i; } });
  return best;
}

// ---- chart helpers shared by the PC chart (histogram-ui.js) and the VR panel (vr-histogram-layout.js) ----
// a tick step (HU) that keeps the axis to at most maxTicks labels
export function niceStep(span, maxTicks) {
  for (const s of [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]) if (span / s <= maxTicks) return s;
  return 2000;
}
// the HU extent of the data of `hists` taken together that a chart needs: the loP-th to the hiP-th percentile (nearest rank, % of all their voxels), with
// both ends trimmed in to the first / last bin that reaches minFrac of the highest bin; null when empty. A long thin tail (bone in a soft-tissue study)
// no longer decides the chart window. No allocation.
export function histsPercentileSpan(hists, loP = ROBUST_LO_P, hiP = ROBUST_HI_P, minFrac = 0) {
  let count = 0;
  for (const h of hists) count += histCount(h);
  if (!count) return null;
  const tLo = Math.max(1, Math.ceil(count * loP / 100)), tHi = Math.max(1, Math.ceil(count * hiP / 100));
  let cum = 0, a = -1, b = HIST_BINS - 1, peak = 0;
  for (let i = 0; i < HIST_BINS; i++) {
    let c = 0;
    for (let k = 0; k < hists.length; k++) c += hists[k][i];
    if (c > peak) peak = c;
    cum += c;
    if (a < 0 && cum >= tLo) a = i;
    if (b === HIST_BINS - 1 && cum >= tHi) b = i;
  }
  a = Math.max(0, a);
  if (minFrac > 0) {
    const thr = peak * minFrac, at = i => { let c = 0; for (let k = 0; k < hists.length; k++) c += hists[k][i]; return c; };
    let a2 = a, b2 = b;
    while (a2 < b2 && at(a2) < thr) a2++;
    while (b2 > a2 && at(b2) < thr) b2--;
    if (at(a2) >= thr) { a = a2; b = b2; }
  }
  return [binToHu(a), binToHu(b)];
}
export const histPercentileSpan = (hist, loP, hiP, minFrac) => histsPercentileSpan([hist], loP, hiP, minFrac);
// the HU spans that decide the chart window. robust = false: every segment's data extent (min..max) and range line, and the whole-volume extent.
// robust = true: ONE percentile span of all the segments' voxels together (a segment with few voxels, like bone, cannot stretch the axis; its
// range line is then marked at the chart edge), the range line of a segment that has no data yet, and the whole volume only when no segment has data.
export function chartSpans(res, robust = false) {
  const spans = [];
  if (robust) {
    const hists = [];
    for (const r of res.list) { if (r.hist && histCount(r.hist)) hists.push(r.hist); else spans.push([r.seg.userMin ?? r.seg.min, r.seg.userMax ?? r.seg.max]); }
    const e = histsPercentileSpan(hists.length || !res.total ? hists : [res.total.hist], ROBUST_LO_P, ROBUST_HI_P, ROBUST_MIN_FRAC);
    if (e) spans.push(e);
    return spans;
  }
  for (const r of res.list) {
    const e = r.hist && histExtent(r.hist); if (e) spans.push(e);
    spans.push([r.seg.userMin ?? r.seg.min, r.seg.userMax ?? r.seg.max]);
  }
  if (res.total) { const e = histExtent(res.total.hist); if (e) spans.push(e); }
  return spans;
}
// the HU window [lo, hi] a chart shows: the union of `spans` ([a, b] pairs: data extents and segment ranges), a little padding,
// clamped to the histogram range and at least 50 HU wide; no span at all gives the default soft-tissue window
export function fitWindow(spans) {
  let lo = Infinity, hi = -Infinity;
  for (const s of spans) { if (s[0] < lo) lo = s[0]; if (s[1] > hi) hi = s[1]; }
  if (!(hi > lo)) { lo = -200; hi = 400; }
  lo = Math.max(HIST_MIN, Math.min(HIST_MAX, lo)); hi = Math.max(HIST_MIN, Math.min(HIST_MAX, hi));
  const pad = Math.max(10, (hi - lo) * 0.04);
  lo = Math.max(HIST_MIN, Math.floor(lo - pad)); hi = Math.min(HIST_MAX, Math.ceil(hi + pad));
  if (hi - lo < MIN_WINDOW) hi = lo + MIN_WINDOW;
  return [lo, hi];
}
// ---- the adjustable display range (display only: the stats are always computed over the whole data) ----
// a manual window: ordered, whole HU, inside the histogram range and at least MIN_WINDOW wide; null for a non-finite input
export function clampWindow(lo, hi) {
  lo = +lo; hi = +hi;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  lo = Math.max(HIST_MIN, Math.min(HIST_MAX - MIN_WINDOW, Math.round(lo)));
  hi = Math.min(HIST_MAX, Math.max(lo + MIN_WINDOW, Math.round(hi)));
  return [lo, hi];
}
// the window zoomed by `factor` (< 1 zooms in) around the HU `anchor`; null for non-finite input
export function zoomWindow(lo, hi, anchor, factor) {
  return clampWindow(anchor - (anchor - lo) * factor, anchor + (hi - anchor) * factor);
}
// a stored / typed range -> { mode: 'auto' | 'full' | 'manual', lo, hi }; anything unusable is 'auto'
export function normalizeRange(r) {
  const mode = r && (r.mode === 'full' || r.mode === 'manual') ? r.mode : 'auto';
  if (mode === 'manual') { const w = clampWindow(r.lo, r.hi); if (w) return { mode, lo: w[0], hi: w[1] }; return { mode: 'auto', lo: 0, hi: 0 }; }
  return { mode, lo: 0, hi: 0 };
}
// the HU window a chart shows for `range` (see normalizeRange): manual = as set, full = min..max of the data, auto = robust to tails
export function windowFor(res, range) {
  const r = range || AUTO_RANGE;
  if (r.mode === 'manual') { const w = clampWindow(r.lo, r.hi); if (w) return w; }
  return fitWindow(chartSpans(res, r.mode !== 'full'));
}
