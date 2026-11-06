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
// The range of a segment: initial = the segment's own min..max (what its sliders show), cut to the data's actual min..max (an open-ended segment, bone up to 61535, ends at the data's top). A segment whose range the user has NOT touched
// follows its segment min / max when they change; once the user moves one of its two range sliders both ends are kept (touched) until 「初期値に戻す」. The touched ranges live in segments.js (segmentShadeRanges), saved in the project file.

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
export const SHADE_RANGE_STEPS = 200; // the range sliders run over the data's full range in 200 steps
const finite = v => typeof v === 'number' && Number.isFinite(v);
// the position of a data value in a segment's range: 0 (darkest) .. 1 (brightest)
export const shadeT = (value, lower, upper) => clampTo((value - lower) / Math.max(upper - lower, SHADE_MIN_WIDTH), 0, 1);
// the brightness factor of a data value in a segment's range (the whole formula: the range, the 0.35 floor, brightness, contrast)
export const shadeLumV = (value, lower, upper, bright = SHADE_BRIGHT_DEFAULT, contrast = SHADE_CONTRAST_DEFAULT) => shadeLumT(shadeT(value, lower, upper), bright, contrast);
// the data's range as {min, max} (min <= max), or null while there is no data
export function dataRangeOf(min, max) { min = +min; max = +max; return finite(min) && finite(max) ? { min: Math.min(min, max), max: Math.max(min, max) } : null; }
// the slider step: the data's range in 200 steps
export const shadeRangeStep = data => (data ? (data.max - data.min) / SHADE_RANGE_STEPS : 0);
// the initial range: the segment's min..max cut to the data's actual min..max (no fixed numbers). Without data the segment's own values.
export function initialShadeRange(segMin, segMax, data) {
  let lo = +segMin, hi = +segMax;
  if (!finite(lo) || !finite(hi)) return data ? { lower: data.min, upper: data.max } : { lower: 0, upper: 1 };
  if (data) { lo = clampTo(lo, data.min, data.max); hi = clampTo(hi, data.min, data.max); }
  return { lower: Math.min(lo, hi), upper: Math.max(lo, hi) };
}
// the range in use: the user's (touched: {lower, upper}, cut to the data and ordered) or, untouched, the initial one (follows the segment)
export function shadeRangeOf(touched, segMin, segMax, data) {
  if (touched && finite(touched.lower) && finite(touched.upper)) {
    let lo = touched.lower, hi = touched.upper;
    if (data) { lo = clampTo(lo, data.min, data.max); hi = clampTo(hi, data.min, data.max); }
    return { lower: Math.min(lo, hi), upper: Math.max(lo, hi), touched: true };
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
