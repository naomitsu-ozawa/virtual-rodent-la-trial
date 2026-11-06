// cut-face shading in the browser 3D view (the VR / AR shader vr-view.js ctLumHU has the same maths in GLSL). "Cut-face shading" = the cut painted with the SEGMENT COLOUR, darker / brighter
// by the data value, shown when the slice image is hidden (and 「スライスの塗り」 is CT濃淡).
//
// The data value is read through the SAME window as the slice image (window centre / width, the CT-value 表示範囲): one setting, so changing the window changes the slice image and this shading
// together. Same for every kind of data (CT, MRI, ...). A value below the window's low end is the darkest, above its high end the brightest.
//   t   = clamp((value - (centre - width/2)) / width, 0, 1)
//   l   = mix(0.35, 1, t) ^ (1 / brightness)                    brightness (明るさ): a gamma, above 1 lifts the dark end most and leaves the top at 1
//   out = l                                                      when contrast == 1
//         clamp(p + (l - p) * contrast, 0.05, 1), p = (0.35^(1/brightness) + 1) / 2      contrast (コントラスト): spreads l about the middle of its range
// 0.35 = SHADE_FLOOR, the darkest level (fixed, as in VR). medical-volume.js (WGSL capShadeLum) and mpr3d-overlay.js (shadeLumT) use this; tests/unit/cap-shade.test.js keeps all three equal.

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
