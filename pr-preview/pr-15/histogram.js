// Per-segment histogram. Pure functions only (no DOM, no app state), so the unit tests use them directly.
// A histogram is a Uint32Array(HIST_BINS): 4096 EQUAL bins over an AXIS {min, max} (the edges of the first / last bin; the range of the data). Values outside are clamped into the two end bins.
// Everything that reads a bin back (a bin's value = its centre, the stats, the chart columns, the window clamps) takes the axis as its last argument and defaults to HU_AXIS.
//   HU_AXIS = the CT axis, exactly as before: 4096 bins of 1 HU, centred on whole HU from HIST_MIN (-1024) to HIST_MAX (3071) (bin 0 = "<= -1024", the last bin = ">= 3071"). axisFor(min, max) gives it for a CT-like range.
//   any other data (MRI 0..65535, 8-bit 0..255, a slope-scaled 0..28): axisFor(min, max, step) = 4096 equal bins over the data's own range, each a whole number of value steps wide, so the histogram neither collapses nor turns comb-like.
// This is the ONE histogram implementation: cap-shade.js (the auto shading range) bins with the same functions (binOf / binValue / binValues / binRuns) through its own {min, max} axis.
export const HIST_MIN = -1024;
export const HIST_MAX = 3071;
export const HIST_BINS = HIST_MAX - HIST_MIN + 1;
export const HIST_PERCENTILES = [5, 25, 50, 75, 95];
export const ROBUST_LO_P = 0.5, ROBUST_HI_P = 99.5; // the percentile window of the robust (auto) chart range
export const ROBUST_MIN_FRAC = 0.03; // ... whose ends are then trimmed to the bins that reach this fraction of the highest bin (a shorter bar is a sliver of a few pixels on the chart)
export const MIN_WINDOW = 50; // the narrowest chart window, in BINS (HU on the CT axis: 1 bin = 1 HU)
const AUTO_RANGE = { mode: 'auto', lo: 0, hi: 0 };

// ---- the axis ----
export const HU_AXIS = Object.freeze({ min: HIST_MIN - 0.5, max: HIST_MAX + 0.5, hu: true });
// the same test as the CT detection of data-load.js configureSegments (huLike; not changed there, tests/unit/histogram-axis.test.js keeps the two equal)
export const isHuLike = (min, max) => min <= -500 && max >= 1000;
// the value step of data: q = 1 for integer-valued data (every rescale slope a whole number), else the finest rescale slope (values lie on a grid of q). slices: the series' slice metadata ({slope}).
export function valueStepOf(slices) {
  let q = Infinity, whole = true;
  for (const m of slices || []) { const s = Math.abs(+m?.slope); if (!(s > 0)) continue; if (!Number.isInteger(s)) whole = false; if (s < q) q = s; }
  return whole || !Number.isFinite(q) ? 1 : q;
}
// the axis of data whose range is min..max: the CT axis for CT-like data, else equal bins over the data's own range. A bin is a whole number of value steps wide (w = q * ceil(span / (q * HIST_BINS)))
// and the bins are centred on the values (axis.min = min - q / 2), so integer data narrower than 4096 values (8-bit 0..255: 1-unit bins on the integers) never falls into every n-th bin (a comb),
// MRI 0..65535 gets 16-unit bins, a slope 0.001 series 0.01. `step` = q (valueStepOf; default 1).
export function axisFor(min, max, step = 1) {
  min = +min; max = +max;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return HU_AXIS;
  if (isHuLike(min, max)) return HU_AXIS;
  const q = Number.isFinite(+step) && +step > 0 ? +step : 1, span = max > min ? max - min : 0, w = q * Math.max(1, Math.ceil(span / (q * HIST_BINS) - 1e-9)), lo = min - q / 2;
  return { min: lo, max: lo + HIST_BINS * w, hu: false };
}
export const axisWidth = axis => (axis.max - axis.min) / HIST_BINS; // the width of one bin (1 on the CT axis)
export const axisKey = axis => (axis.hu ? 'hu' : axis.min + ':' + axis.max); // a stored display range remembers which axis it was set on
// decimals that tell two neighbouring bins apart (0 on the CT axis: whole HU); the window ends and the table are rounded / written with them
export function axisDecimals(axis) {
  if (axis.hu) return 0;
  const w = axisWidth(axis);
  return w > 0 ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(w) - 1e-9))) : 0; // 1-unit and wider bins: whole numbers; 0.01 bins: 2 decimals
}
export const axisSnap = (v, axis) => { const p = 10 ** axisDecimals(axis); return Math.round(v * p) / p; };
export const fmtAxisValue = (v, axis) => (axis.hu ? String(Math.round(v)) : String(+(+v).toFixed(axisDecimals(axis))));
// bin <-> value: a bin's value is its centre
export function binOf(v, axis = HU_AXIS) {
  if (axis.hu) { const i = Math.round(+v) - HIST_MIN; return i < 0 ? 0 : i >= HIST_BINS ? HIST_BINS - 1 : i; }
  const w = axis.max - axis.min;
  if (!(w > 0)) return 0;
  const b = Math.floor((v - axis.min) / w * HIST_BINS);
  return b < 0 ? 0 : b >= HIST_BINS ? HIST_BINS - 1 : b;
}
export const binValue = (i, axis = HU_AXIS) => axis.min + (i + 0.5) * ((axis.max - axis.min) / HIST_BINS);
const centre0 = axis => axis.min + axisWidth(axis) / 2, centreLast = axis => binValue(HIST_BINS - 1, axis);
const minWindowOf = axis => MIN_WINDOW * axisWidth(axis);

export const createHist = () => new Uint32Array(HIST_BINS);
// HU (any number) -> bin index, rounded to the nearest HU and clamped (the CT axis)
export function huToBin(hu) { return binOf(hu, HU_AXIS); }
export const binToHu = i => i + HIST_MIN;

// add values[start..end) to hist (NaN is skipped); lo / hi (optional): only the values inside lo..hi (a segment's own range)
export function binValues(hist, values, start = 0, end = values.length, axis = HU_AXIS, lo = -Infinity, hi = Infinity) {
  // one tight loop per case (CT axis / another axis, with / without a value range): this is the pass over every voxel of the series, so the axis kind and the range
  // are tested once here, not per voxel (the results are bit for bit those of the single general loop below)
  const ranged = lo !== -Infinity || hi !== Infinity, last = HIST_BINS - 1;
  if (axis.hu === true) {
    if (ranged) {
      for (let i = start; i < end; i++) {
        const v = values[i];
        if (v !== v || v < lo || v > hi) continue;
        const b = Math.round(v) - HIST_MIN;
        hist[b < 0 ? 0 : b >= HIST_BINS ? last : b]++;
      }
    } else {
      for (let i = start; i < end; i++) {
        const v = values[i];
        if (v !== v) continue;
        const b = Math.round(v) - HIST_MIN;
        hist[b < 0 ? 0 : b >= HIST_BINS ? last : b]++;
      }
    }
    return hist;
  }
  const min = axis.min, w = axis.max - axis.min;
  if (w > 0) {
    if (ranged) {
      for (let i = start; i < end; i++) {
        const v = values[i];
        if (v !== v || v < lo || v > hi) continue;
        const b = Math.floor((v - min) / w * HIST_BINS);
        hist[b < 0 ? 0 : b >= HIST_BINS ? last : b]++;
      }
    } else {
      for (let i = start; i < end; i++) {
        const v = values[i];
        if (v !== v) continue;
        const b = Math.floor((v - min) / w * HIST_BINS);
        hist[b < 0 ? 0 : b >= HIST_BINS ? last : b]++;
      }
    }
    return hist;
  }
  for (let i = start; i < end; i++) { const v = values[i]; if (v !== v || v < lo || v > hi) continue; hist[0]++; } // a degenerate axis (no width): everything in bin 0
  return hist;
}
// add the voxels of one slice that lie in `runs` (the analysis run format: triples y, x0, x1 with x1 inclusive) to hist;
// `values` is the slice (width w, row-major); only the triples from index i0 (a multiple of 3) up to i1 when given (a pass bins a long slice in parts)
export function binRuns(hist, values, runs, w, i0 = 0, i1 = runs ? runs.length : 0, axis = HU_AXIS) {
  if (!runs) return hist;
  const end = Math.min(i1, runs.length);
  for (let i = i0; i + 2 < end; i += 3) {
    const base = runs[i] * w;
    binValues(hist, values, base + runs[i + 1], base + runs[i + 2] + 1, axis);
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
// the bins of `hist` inside the range [min, max] (a segment defined by a plain range needs no pass of its own: it is a slice of the total): the bins whose centre lies within half a bin of it
export function histInRange(hist, min, max, axis = HU_AXIS) {
  const out = createHist();
  if (!(max >= min)) return out;
  const w = axisWidth(axis), a = Math.max(0, Math.ceil((min - axis.min) / w) - 1), b = Math.min(HIST_BINS - 1, Math.floor((max - axis.min) / w));
  for (let i = a; i <= b; i++) out[i] = hist[i];
  return out;
}
export function histCount(hist) {
  let n = 0;
  for (let i = 0; i < HIST_BINS; i++) n += hist[i];
  return n;
}
// counts for display: the window [lo, hi] (inclusive, whole bins) cut into `columns` columns of equal width.
// Returns Float64Array(columns); a column holds the sum of the bins it covers.
// out (optional,: the VR board's drag redraw allocates nothing): a reused array at least `columns` long; its first `columns` entries are
// cleared and written, the rest is left alone
export function rebinHist(hist, lo, hi, columns, out, axis = HU_AXIS) {
  const n = Math.max(1, columns | 0);
  if (out && out.length >= n) out.fill(0, 0, n); else out = new Float64Array(n);
  const w = axisWidth(axis), c0 = centre0(axis);
  const a = Math.max(0, Math.ceil((lo - c0) / w - 1e-9)), b = Math.min(HIST_BINS - 1, Math.floor((hi - c0) / w + 1e-9));
  if (b < a) return out;
  const span = hi - lo + w;
  const nm = n - 1;
  if (axis.hu === true) { // the CT axis (w = 1, c0 = HIST_MIN, both exact): the same value as the general line below, without the multiply by the width and the add of the centre per bin
    for (let i = a; i <= b; i++) {
      const c = Math.floor((i + HIST_MIN - lo) * n / span);
      out[c < 0 ? 0 : c > nm ? nm : c] += hist[i];
    }
    return out;
  }
  for (let i = a; i <= b; i++) {
    const c = Math.floor((c0 + i * w - lo) * n / span); // multiply first: with one column per bin (n * w = span) the quotient is then exact, not 10.999999 (which dropped a bin into its neighbour and left an empty column)
    out[c < 0 ? 0 : c > nm ? nm : c] += hist[i];
  }
  return out;
}
// the number of bins inside the window [lo, hi] (one chart column per bin when there is room)
export const windowBins = (lo, hi, axis = HU_AXIS) => Math.round((hi - lo) / axisWidth(axis) + 1);
// the extent (values) that holds data (first / last non-empty bin), or null for an empty histogram
export function histExtent(hist, axis = HU_AXIS) {
  let a = 0, b = HIST_BINS - 1;
  while (a < HIST_BINS && !hist[a]) a++;
  if (a >= HIST_BINS) return null;
  while (b > a && !hist[b]) b--;
  return [binValue(a, axis), binValue(b, axis)];
}
// count, mean, SD (population), min, max and the percentiles p5 / p25 / p50 / p75 / p95, all from the bins (bin value = its centre, whole HU on the CT axis;
// a percentile is the first bin whose cumulative count reaches p % of the voxels, "nearest rank"). Empty: count 0, the rest null.
export function histStats(hist, percentiles = HIST_PERCENTILES, axis = HU_AXIS) {
  const count = histCount(hist);
  const out = { count, mean: null, sd: null, min: null, max: null, percentiles: Object.fromEntries(percentiles.map(p => [p, null])) };
  if (!count) return out;
  const a0 = axis.min, bw = (axis.max - axis.min) / HIST_BINS, valueOf = i => a0 + (i + 0.5) * bw; // = binValue(i, axis), the width worked out once
  let sum = 0, first = -1, last = -1;
  for (let i = 0; i < HIST_BINS; i++) {
    const c = hist[i];
    if (!c) continue;
    if (first < 0) first = i;
    last = i;
    sum += c * valueOf(i);
  }
  const mean = sum / count;
  let ss = 0;
  for (let i = first; i <= last; i++) { const c = hist[i]; if (c) { const d = valueOf(i) - mean; ss += c * d * d; } }
  out.mean = mean; out.sd = Math.sqrt(ss / count); out.min = valueOf(first); out.max = valueOf(last);
  const targets = percentiles.map(p => Math.max(1, Math.ceil(count * p / 100)));
  const order = percentiles.map((p, i) => i).sort((x, y) => percentiles[x] - percentiles[y]);
  let cum = 0, pi = 0;
  for (let i = first; i <= last && pi < order.length; i++) {
    cum += hist[i];
    while (pi < order.length && cum >= targets[order[pi]]) { out.percentiles[percentiles[order[pi]]] = valueOf(i); pi++; }
  }
  return out;
}
// volume in mm³ of `count` voxels (null when the spacing is unknown)
export function voxelsToMm3(count, spacing) {
  if (!spacing || spacing.length < 3) return null;
  const v = (+spacing[0]) * (+spacing[1]) * (+spacing[2]);
  return Number.isFinite(v) && v > 0 ? count * v : null;
}
// pixel <-> value for the chart (window [lo, hi], plot width w); minSpan: the narrowest span divided by (one bin of the axis: axisWidth; 1 on the CT axis)
export const huToX = (hu, lo, hi, w, minSpan = 1) => (hu - lo) / Math.max(minSpan, hi - lo) * w;
export const xToHu = (x, lo, hi, w) => lo + x / Math.max(1, w) * (hi - lo);
// nearest line to a pointer x (CSS px, same space as xs); -1 when none is within tol px
export function nearestLine(xs, x, tol = 6) {
  let best = -1, bd = tol + 1e-9;
  xs.forEach((lx, i) => { const d = Math.abs(lx - x); if (d < bd) { bd = d; best = i; } });
  return best;
}

// ---- chart helpers shared by the PC chart (histogram-ui.js) and the VR panel (vr-histogram-layout.js) ----
// a tick step that keeps the axis to at most maxTicks labels. The CT axis: the fixed list (10 .. 2000 HU, as before); any other axis: 1 / 2 / 2.5 / 5 x 10^k, whatever the scale of the data
export function niceStep(span, maxTicks, axis) {
  if (!axis || axis.hu) {
    for (const s of [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]) if (span / s <= maxTicks) return s;
    return 2000;
  }
  const want = span / Math.max(1, maxTicks);
  if (!(want > 0)) return 1;
  for (let e = Math.floor(Math.log10(want)) - 1; e < 300; e++) for (const m of [1, 2, 2.5, 5]) { const s = m * 10 ** e; if (span / s <= maxTicks) return s; }
  return want;
}
// the decimals a tick step needs (0 for 10, 1 for 0.5, 4 for 0.0025) and a tick's text with them (no float noise)
export function stepDecimals(step) {
  for (let d = 0; d <= 8; d++) { const q = step * 10 ** d; if (Math.abs(q - Math.round(q)) < 1e-6) return d; }
  return 8;
}
export const tickText = (v, step) => { const d = stepDecimals(step); return d ? v.toFixed(d) : String(Math.round(v)); };
// the extent of the data of `hists` taken together that a chart needs: the loP-th to the hiP-th percentile (nearest rank, % of all their voxels), with
// both ends trimmed in to the first / last bin that reaches minFrac of the highest bin; null when empty. A long thin tail (bone in a soft-tissue study)
// no longer decides the chart window. No allocation.
export function histsPercentileSpan(hists, loP = ROBUST_LO_P, hiP = ROBUST_HI_P, minFrac = 0, axis = HU_AXIS) {
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
  return [binValue(a, axis), binValue(b, axis)];
}
export const histPercentileSpan = (hist, loP, hiP, minFrac, axis) => histsPercentileSpan([hist], loP, hiP, minFrac, axis);
// the spans that decide the chart window (res.axis: the axis of the data, default HU_AXIS). robust = false: every segment's data extent (min..max) and range line, and the whole-volume extent.
// robust = true: ONE percentile span of all the segments' voxels together (a segment with few voxels, like bone, cannot stretch the axis; its
// range line is then marked at the chart edge), the range line of a segment that has no data yet, and the whole volume only when no segment has data.
export function chartSpans(res, robust = false) {
  const spans = [], axis = res.axis || HU_AXIS;
  if (robust) {
    const hists = [];
    for (const r of res.list) { if (r.hist && histCount(r.hist)) hists.push(r.hist); else spans.push([r.seg.userMin ?? r.seg.min, r.seg.userMax ?? r.seg.max]); }
    const e = histsPercentileSpan(hists.length || !res.total ? hists : [res.total.hist], ROBUST_LO_P, ROBUST_HI_P, ROBUST_MIN_FRAC, axis);
    if (e) spans.push(e);
    return spans;
  }
  for (const r of res.list) {
    const e = r.hist && histExtent(r.hist, axis); if (e) spans.push(e);
    spans.push([r.seg.userMin ?? r.seg.min, r.seg.userMax ?? r.seg.max]);
  }
  if (res.total) { const e = histExtent(res.total.hist, axis); if (e) spans.push(e); }
  return spans;
}
// the window [lo, hi] a chart shows: the union of `spans` ([a, b] pairs: data extents and segment ranges), a little padding,
// clamped to the histogram range and at least MIN_WINDOW bins wide; no span at all gives the default soft-tissue window (the CT axis) or the whole axis
export function fitWindow(spans, axis = HU_AXIS) {
  const w = axisWidth(axis), c0 = centre0(axis), cN = centreLast(axis), grid = (x, up) => c0 + (up ? Math.ceil((x - c0) / w - 1e-9) : Math.floor((x - c0) / w + 1e-9)) * w;
  let lo = Infinity, hi = -Infinity;
  for (const s of spans) { if (s[0] < lo) lo = s[0]; if (s[1] > hi) hi = s[1]; }
  if (!(hi > lo)) { if (axis.hu) { lo = -200; hi = 400; } else { lo = c0; hi = cN; } }
  lo = Math.max(c0, Math.min(cN, lo)); hi = Math.max(c0, Math.min(cN, hi));
  const pad = Math.max(10 * w, (hi - lo) * 0.04);
  lo = Math.max(c0, grid(lo - pad, false)); hi = Math.min(cN, grid(hi + pad, true));
  if (hi - lo < minWindowOf(axis)) hi = lo + minWindowOf(axis);
  return [lo, hi];
}
// ---- the adjustable display range (display only: the stats are always computed over the whole data) ----
// a manual window: ordered, rounded to the axis' decimals (whole HU on the CT axis), inside the histogram range and at least MIN_WINDOW bins wide; null for a non-finite input
export function clampWindow(lo, hi, axis = HU_AXIS) {
  lo = +lo; hi = +hi;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  const c0 = centre0(axis), cN = centreLast(axis), minW = minWindowOf(axis);
  lo = Math.max(c0, Math.min(cN - minW, axisSnap(lo, axis)));
  hi = Math.min(cN, Math.max(lo + minW, axisSnap(hi, axis)));
  return [lo, hi];
}
// the window zoomed by `factor` (< 1 zooms in) around the value `anchor`; null for non-finite input
export function zoomWindow(lo, hi, anchor, factor, axis = HU_AXIS) {
  return clampWindow(anchor - (anchor - lo) * factor, anchor + (hi - anchor) * factor, axis);
}
// a stored / typed range -> { mode: 'auto' | 'full' | 'manual', lo, hi }; anything unusable is 'auto'. axis: the axis a manual window is clamped to (default the CT axis);
// null = only finite and ordered (a range read before any data is known). `ax` (the axisKey of the data a manual window was set on) is kept when given.
export function normalizeRange(r, axis = HU_AXIS) {
  const mode = r && (r.mode === 'full' || r.mode === 'manual') ? r.mode : 'auto';
  if (mode === 'manual') {
    let w = null;
    if (axis) w = clampWindow(r.lo, r.hi, axis);
    else { const lo = +r.lo, hi = +r.hi; if (Number.isFinite(lo) && Number.isFinite(hi)) w = lo > hi ? [hi, lo] : [lo, hi]; }
    if (w) return typeof r.ax === 'string' ? { mode, lo: w[0], hi: w[1], ax: r.ax } : { mode, lo: w[0], hi: w[1] };
    return { mode: 'auto', lo: 0, hi: 0 };
  }
  return { mode, lo: 0, hi: 0 };
}
// the window a chart shows for `range` (see normalizeRange): manual = as set (only on the axis it was set on; a window set on CT data is not applied to MRI data), full = min..max of the data, auto = robust to tails
export function windowFor(res, range) {
  const r = range || AUTO_RANGE, axis = res.axis || HU_AXIS;
  if (r.mode === 'manual' && (r.ax || 'hu') === axisKey(axis)) { const w = clampWindow(r.lo, r.hi, axis); if (w) return w; }
  return fitWindow(chartSpans(res, r.mode !== 'full'), axis);
}
