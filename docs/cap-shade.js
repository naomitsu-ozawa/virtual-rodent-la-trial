// cut-face shading in the browser 3D view (the VR / AR shader vr-view.js ctLumHU has the same maths in GLSL). "Cut-face shading" = the cut painted with the SEGMENT COLOUR, darker / brighter
// by the data value, shown when the slice image is hidden (and 「スライスの塗り」 is CT濃淡).
//
// Each SEGMENT has its own shading range (lower, upper; data values). The data value of a pixel of segment k is read through that segment's range (the slice image's window is NOT used: moving the window changes the slice image only):
//   t   = clamp((value - lower_k) / max(upper_k - lower_k, SHADE_MIN_WIDTH), 0, 1)     (a width <= 0 is treated as the minimal width: safe)
//   l   = mix(0.35, 1, t) ^ (1 / brightness)                    brightness (明るさ): a gamma, above 1 lifts the dark end most and leaves the top at 1
//   out = l                                                      when contrast == 1
//         clamp(p + (l - p) * contrast, 0.05, 1), p = (0.35^(1/brightness) + 1) / 2      contrast (コントラスト): spreads l about the middle of its range
// 0.35 = SHADE_FLOOR, the darkest level (fixed, as in VR). medical-volume.js (WGSL capShadeLum) and mpr3d-overlay.js (shadeLumT) use this; tests/unit/cap-shade.test.js keeps all three equal.
//
// The range of a segment: AUTO unless the user set it. Auto = the 2nd..98th percentile (tails cut by the IQR) of the values of the voxels that belong to the segment (counted from the segment's per-segment histogram, see autoShadeRange), at least 0.5 % of the data's
// full width; until it is ready (and for a segment without voxels / with one value) the initial value is used: the segment's own min..max (what its sliders show) cut to the data's actual min..max (an open-ended segment, bone up to
// 61535, ends at the data's top). Once the user moves one of the two range sliders of a segment both ends are kept (manual) until 「自動に戻す」. The manual ranges live in segments.js (segmentShadeRanges), saved in the project file; the auto values are not saved.

import { HIST_BINS, binOf, binValue, binValues, binRuns, createHist } from './histogram.js?v=20261111-build717'; // build after 703: the ONE histogram implementation (equal bins over an axis {min, max}); the shade histogram below is histogram.js with the data's own range as the axis

export const SHADE_BRIGHT_DEFAULT = 1.8, SHADE_CONTRAST_DEFAULT = 1.7, SHADE_FLOOR = 0.35; // the same defaults as VR (vr-view.js DEFAULTS ctShadeBright / ctShadeContrast)
export const SHADE_BRIGHT_MIN = 0.5, SHADE_BRIGHT_MAX = 2, SHADE_CONTRAST_MIN = 0.5, SHADE_CONTRAST_MAX = 2; // 50..200 % in 10 % steps, as the VR sliders

const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const brightOf = v => { if (v == null || v === '') return SHADE_BRIGHT_DEFAULT; v = +v; return Number.isFinite(v) ? clampTo(Math.round(v * 10) / 10, SHADE_BRIGHT_MIN, SHADE_BRIGHT_MAX) : SHADE_BRIGHT_DEFAULT; };
export const contrastOf = v => { if (v == null || v === '') return SHADE_CONTRAST_DEFAULT; v = +v; return Number.isFinite(v) ? clampTo(Math.round(v * 10) / 10, SHADE_CONTRAST_MIN, SHADE_CONTRAST_MAX) : SHADE_CONTRAST_DEFAULT; };

// the brightness factor of a position t (0..1) in the window: SHADE_FLOOR..1
export function shadeLumT(t, bright = SHADE_BRIGHT_DEFAULT, contrast = SHADE_CONTRAST_DEFAULT) {
  const g = 1 / Math.max(bright, 0.1), l = Math.pow(SHADE_FLOOR + (1 - SHADE_FLOOR) * clampTo(t, 0, 1), g);
  if (contrast === 1) return l;
  const p = 0.5 * (Math.pow(SHADE_FLOOR, g) + 1);
  return clampTo(p + (l - p) * contrast, 0.05, 1);
}

// ---- per-segment shading range ----
export const SHADE_MIN_WIDTH = 1e-3; // the narrowest width the maths divides by (upper - lower <= 0 is treated as this): no division by zero, the factor is then a (nearly) hard step
export const SHADE_RANGE_STEPS = 200; // the range sliders run over the span (auto: the values present in the segment + 5 % margin; else the data's full range) in 200 steps
const finite = v => typeof v === 'number' && Number.isFinite(v);
// the position of a data value in a segment's range: 0 (darkest) .. 1 (brightest)
export const shadeT = (value, lower, upper) => clampTo((value - lower) / Math.max(upper - lower, SHADE_MIN_WIDTH), 0, 1);
// the brightness factor of a data value in a segment's range (the whole formula: the range, the 0.35 floor, brightness, contrast)
export const shadeLumV = (value, lower, upper, bright = SHADE_BRIGHT_DEFAULT, contrast = SHADE_CONTRAST_DEFAULT) => shadeLumT(shadeT(value, lower, upper), bright, contrast);
// the data's range as {min, max} (min <= max), or null while there is no data
export function dataRangeOf(min, max) { min = +min; max = +max; return finite(min) && finite(max) ? { min: Math.min(min, max), max: Math.max(min, max) } : null; }
// the slider step: the slider's span ({min, max}: shadeSpanOf) in 200 steps
export const shadeRangeStep = data => (data ? (data.max - data.min) / SHADE_RANGE_STEPS : 0);
// the initial range: the segment's min..max cut to the data's actual min..max (no fixed numbers). Without data the segment's own values.
export function initialShadeRange(segMin, segMax, data) {
  let lo = +segMin, hi = +segMax;
  if (!finite(lo) || !finite(hi)) return data ? { lower: data.min, upper: data.max } : { lower: 0, upper: 1 };
  if (data) { lo = clampTo(lo, data.min, data.max); hi = clampTo(hi, data.min, data.max); }
  return { lower: Math.min(lo, hi), upper: Math.max(lo, hi) };
}
// the range in use: the user's (manual: {lower, upper}, cut to the data and ordered), else the auto one (auto: {lower, upper} from autoShadeRange, cut to the data), else the initial one (the auto value is not ready / not available).
// `touched` stays the name of "the user set it" (manual): the reset button is enabled by it.
export function shadeRangeOf(touched, segMin, segMax, data, auto = null) {
  if (touched && finite(touched.lower) && finite(touched.upper)) {
    let lo = touched.lower, hi = touched.upper;
    if (data) { lo = clampTo(lo, data.min, data.max); hi = clampTo(hi, data.min, data.max); }
    return { lower: Math.min(lo, hi), upper: Math.max(lo, hi), touched: true };
  }
  if (auto && finite(auto.lower) && finite(auto.upper)) {
    let lo = auto.lower, hi = auto.upper;
    if (data) { lo = clampTo(lo, data.min, data.max); hi = clampTo(hi, data.min, data.max); }
    return { lower: Math.min(lo, hi), upper: Math.max(lo, hi), touched: false };
  }
  return { ...initialShadeRange(segMin, segMax, data), touched: false };
}
// the user moves one end (which = 'lower' | 'upper') of a range to value: it stays inside the data's range and lower cannot pass upper (it stops there). Returns the new touched {lower, upper}.
export function moveShadeEnd(range, which, value, data) {
  let lo = range.lower, hi = range.upper, v = +value;
  if (!finite(v)) return { lower: lo, upper: hi };
  if (data) v = clampTo(v, data.min, data.max);
  if (which === 'lower') lo = Math.min(v, hi); else hi = Math.max(v, lo);
  return { lower: lo, upper: hi };
}
// ---- the auto range of a segment ----
// From the segment's histogram: SHADE_HIST_BINS (4096) equal bins over the DATA's own range (data.min..data.max, so CT, MRI up to 65535 or anything else counts the same way; histogram.js with the data's own range as the axis, so one implementation counts both the board and this), holding only the
// voxels that belong to the segment (a Uint32Array; made with binShadeValues / binShadeRuns here or by the VR label pass, vr-label-histogram.js binLut with histMax). Everything below is in data units; a bin's value is its centre.
//   lower = the 2nd percentile, upper = the 98th percentile (nearest rank);: the long tails are cut with the interquartile range (IQR = p75 - p25): lower = max(p2, p25 - k*IQR), upper = min(p98, p75 + k*IQR), k = 2 (a wide
//   distribution such as bone or MRI keeps p2 / p98; a narrow peak with a long tail, soft tissue, no longer stretches the range). When upper - lower is under 0.5 % of the data's full width it is widened symmetrically to 0.5 %; both are cut to the data's min..max.
//   span = the values really present (lower edge of the first non-empty bin .. upper edge of the last one) plus 5 % of that width on each side, cut to the data: the range the lower / upper sliders run over (step span / 200).
// null (= use the initial value, the full data range for the sliders) for a segment without voxels, with one distinct value (all in one bin), or without a histogram.
export const SHADE_AUTO_LOW_P = 2, SHADE_AUTO_HIGH_P = 98, SHADE_AUTO_MIN_FRAC = 0.005, SHADE_SPAN_MARGIN = 0.05, SHADE_HIST_BINS = HIST_BINS, SHADE_AUTO_IQR_K = 2;
export const createShadeHist = () => createHist();
// the bin of a data value (clamped; the data's max is in the last bin): histogram.js binOf on the axis {min, max}
export const shadeBinOf = (v, min, max) => binOf(v, { min, max });
// the centre of a bin, in data units
export const shadeBinValue = (b, min, max) => binValue(b, { min, max });
// add values[start..end) to hist; with lo / hi only the values inside lo..hi (a segment's own range: its voxel test); NaN is skipped (histogram.js binValues)
export const binShadeValues = (hist, values, min, max, start = 0, end = values.length, lo = -Infinity, hi = Infinity) => binValues(hist, values, start, end, { min, max }, lo, hi);
// add the voxels of one slice that lie in `runs` (the analysis run format: triples y, x0, x1 with x1 inclusive; the triples from i0 up to i1) to hist (histogram.js binRuns)
export const binShadeRuns = (hist, values, runs, w, min, max, i0 = 0, i1 = runs ? runs.length : 0) => binRuns(hist, values, runs, w, i0, i1, { min, max });
export function shadeHistCount(hist) { let n = 0; for (let i = 0; i < hist.length; i++) n += hist[i]; return n; }
export function autoShadeRange(hist, data) {
  if (!hist || !data || !(data.max > data.min)) return null;
  let first = -1, last = -1, count = 0;
  for (let i = 0; i < hist.length; i++) { const c = hist[i]; if (!c) continue; if (first < 0) first = i; last = i; count += c; }
  if (!count || last <= first) return null;
  const at = p => { const target = Math.max(1, Math.ceil(count * p / 100)); let cum = 0; for (let i = first; i <= last; i++) { cum += hist[i]; if (cum >= target) return shadeBinValue(i, data.min, data.max); } return shadeBinValue(last, data.min, data.max); };
  const p25 = at(25), p75 = at(75), iqr = p75 - p25; // the IQR cuts the long tails (p2 / p98 stay the outer limits)
  let lo = Math.max(at(SHADE_AUTO_LOW_P), p25 - SHADE_AUTO_IQR_K * iqr), hi = Math.min(at(SHADE_AUTO_HIGH_P), p75 + SHADE_AUTO_IQR_K * iqr);
  const bw = (data.max - data.min) / hist.length, a = data.min + first * bw, b = data.min + (last + 1) * bw, margin = (b - a) * SHADE_SPAN_MARGIN;
  let smin = a - margin, smax = b + margin;
  const minW = (data.max - data.min) * SHADE_AUTO_MIN_FRAC;
  if (hi - lo < minW) { const mid = (lo + hi) / 2; lo = mid - minW / 2; hi = mid + minW / 2; }
  lo = clampTo(lo, data.min, data.max); hi = clampTo(hi, data.min, data.max);
  smin = clampTo(smin, data.min, data.max); smax = clampTo(smax, data.min, data.max);
  return { lower: Math.min(lo, hi), upper: Math.max(lo, hi), span: { min: smin, max: smax } };
}
// the range the lower / upper sliders run over: the auto span when there is one, else the data's full range
export const shadeSpanOf = (auto, data) => (auto && auto.span && finite(auto.span.min) && finite(auto.span.max) && auto.span.max > auto.span.min ? { min: auto.span.min, max: auto.span.max } : data);

// The scheduler of the auto computation (one per source: the browser's, VR's). request(keys) is the only way in: a data open or a threshold change of those segments. It waits `delay` ms after the LAST request (a slider
// drag asks on every move), then computes: compute(keys, stale) -> Promise of {key: hist | null} (null = this segment has no voxels), or null when it cannot run now (retried a few times). Every request bumps the generation: a
// computation that is still running is stale, its result is thrown away (and `cancel` is called so it stops working), and its keys are asked again with the new request. apply(results) gets only the result of the current generation.
// retryDelay = the wait between the retries of a compute that returned null (default: delay; VR waits 1000 ms x 60 for the cache write). hold(true) = nothing runs (the XR session is on): requests are only remembered
// (no timer, no retry used up), a running computation is cancelled and its keys kept; hold(false) asks for all the remembered keys again.
export function createShadeAutoScheduler({ compute, apply, cancel = () => {}, delay = 300, retries = 5, retryDelay = delay, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id) }) {
  let gen = 0, timer = null, tries = 0, held = false;
  const pending = new Set(), inflight = new Set();
  const fire = async () => {
    timer = null;
    if (held) return; // the keys stay in pending until hold(false)
    const mine = ++gen, keys = [...pending]; pending.clear();
    if (!keys.length) return;
    for (const k of keys) inflight.add(k);
    const stale = () => mine !== gen;
    let out = null;
    try { out = await compute(keys, stale); } catch (e) { out = null; if (!(e && e.message === '__SUPERSEDED__')) console.warn('shade auto range:', e); }
    if (stale()) return; // a newer request owns the keys now
    for (const k of keys) inflight.delete(k);
    if (out) { tries = 0; apply(out); return; }
    if (tries++ < retries) { for (const k of keys) pending.add(k); timer = setTimer(fire, retryDelay); } else tries = 0;
  };
  return {
    request(keys) {
      gen++; tries = 0;
      if (inflight.size) { cancel(); for (const k of inflight) pending.add(k); inflight.clear(); }
      for (const k of keys) pending.add(k);
      if (timer !== null) clearTimer(timer);
      timer = held ? null : setTimer(fire, delay);
    },
    hold(on) {
      on = !!on; if (on === held) return; held = on;
      if (on) { gen++; tries = 0; if (inflight.size) { cancel(); for (const k of inflight) pending.add(k); inflight.clear(); } if (timer !== null) { clearTimer(timer); timer = null; } }
      else if (pending.size) { tries = 0; timer = setTimer(fire, delay); }
    },
    get held() { return held; },
    // the data went away / was replaced: nothing is computed or applied any more
    reset() { gen++; tries = 0; pending.clear(); inflight.clear(); if (timer !== null) { clearTimer(timer); timer = null; } cancel(); },
    get generation() { return gen; },
    get busy() { return timer !== null || inflight.size > 0; },
  };
}
// a slider position 0..1 -> the data value on the step grid (min + k * step), and back
export function shadeValueAt(pos01, data) { if (!data) return 0; const k = Math.round(clampTo(pos01, 0, 1) * SHADE_RANGE_STEPS); return data.min + k * shadeRangeStep(data); }
export function shadePosOf(value, data) { return data && data.max > data.min ? clampTo((value - data.min) / (data.max - data.min), 0, 1) : 0; }
// the project file's field: {key: {min, max}} of the touched ranges only (untouched ones follow, so they are not saved); loading reads it back (an old file without it: nothing touched)
export function shadeRangesToProject(touchedByKey) {
  const out = {};
  for (const [key, t] of Object.entries(touchedByKey || {})) if (t && finite(t.lower) && finite(t.upper)) out[key] = { min: t.lower, max: t.upper };
  return out;
}
export function shadeRangesFromProject(field, keys) {
  const out = {};
  if (!field || typeof field !== 'object') return out;
  for (const key of keys) { const g = field[key]; if (g && finite(+g.min) && finite(+g.max) && g.min !== null && g.max !== null) out[key] = { lower: Math.min(+g.min, +g.max), upper: Math.max(+g.min, +g.max) }; }
  return out;
}
