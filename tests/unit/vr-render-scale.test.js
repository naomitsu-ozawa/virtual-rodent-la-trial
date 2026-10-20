import { describe, it, expect } from 'vitest';
import { eyeMetrics, capFromPpv, nextCap, foveaRect, outsideFovea, foveaWorth, qualityText, PPV_CENTER, PPV_FAR, PPV_CENTER_MIN, PPV_FAR_MIN, RELIEF_FROM, RELIEF_TO, reliefOf, targetCenter, targetFar, CAP_MIN, CAP_QUANT, CAP_HYST, FOVEA_HALF, FOVEA_K } from '../../docs/vr-render-scale.js';

// column-major 4x4 like THREE.Matrix4.elements
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// the volume mesh: uniform scale s, centre at (x, y, z)
const model = (s, x, y, z) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1];
// perspective projection (three.js makePerspective) from tangents of the half angles: l, r, b, t (> 0), near n, far f
const persp = (l, r, b, t, n = 0.05, f = 100) => {
  const L = -l * n, R = r * n, B = -b * n, T = t * n;
  return [2 * n / (R - L), 0, 0, 0, 0, 2 * n / (T - B), 0, 0, (R + L) / (R - L), (T + B) / (T - B), -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0];
};
const P90 = persp(1, 1, 1, 1); // 90 deg symmetric: focal = viewport / 2 px per unit tangent
const HALF = [1, 1, 1], DIMS = [256, 256, 256];

describe('eyeMetrics: projected box, pixels per voxel', () => {
  it('a box straight ahead: covered pixels = the projected near face, px per voxel = focal x voxel / depth', () => {
    const s = 0.1, d = 0.65, vw = 1000, vh = 1000, out = {};
    const r = eyeMetrics(model(s, 0, 0, -d), HALF, DIMS, I(), P90, vw, vh, out);
    expect(r).toBe(out); // written into the caller's object (no allocation per frame)
    const nearHalfPx = s / (d - s) * vw / 2; // the near face (depth d - s) is the largest
    expect(r.cover).toBeCloseTo((2 * nearHalfPx) ** 2, 3);
    const voxel = 2 * s / 256, focal = vw / 2;
    expect(r.ppvCenter).toBeCloseTo(focal * voxel / d, 9);
    expect(r.ppvFar).toBeCloseTo(focal * voxel / (d + s), 9);
    expect(r.depthCenter).toBeCloseTo(d, 9); expect(r.inside).toBe(false);
    expect(r.cx).toBeCloseTo(vw / 2, 9); expect(r.cy).toBeCloseTo(vh / 2, 9);
  });
  it('magnifying 2x doubles px per voxel and about quadruples the covered pixels', () => {
    const a = eyeMetrics(model(0.03, 0, 0, -0.65), HALF, DIMS, I(), P90, 1000, 1000, {});
    const b = eyeMetrics(model(0.06, 0, 0, -0.65), HALF, DIMS, I(), P90, 1000, 1000, {});
    expect(b.ppvCenter / a.ppvCenter).toBeCloseTo(2, 9);
    expect(b.cover / a.cover).toBeGreaterThan(4); expect(b.cover / a.cover).toBeLessThan(4.6); // the near face comes closer too
  });
  it('the smallest voxel edge counts (anisotropic grid) and a 512 grid halves px per voxel', () => {
    const iso = eyeMetrics(model(0.1, 0, 0, -0.65), HALF, DIMS, I(), P90, 1000, 1000, {});
    const aniso = eyeMetrics(model(0.1, 0, 0, -0.65), [1, 1, 0.5], [256, 256, 256], I(), P90, 1000, 1000, {});
    expect(aniso.ppvCenter).toBeCloseTo(iso.ppvCenter / 2, 9);
    const fine = eyeMetrics(model(0.1, 0, 0, -0.65), HALF, [512, 512, 512], I(), P90, 1000, 1000, {});
    expect(fine.ppvCenter).toBeCloseTo(iso.ppvCenter / 2, 9);
  });
  it('the eye inside / at the box: the whole viewport counts; a box behind the eye covers nothing', () => {
    const inside = eyeMetrics(model(0.2, 0, 0, -0.05), HALF, DIMS, I(), P90, 800, 600, {});
    expect(inside.inside).toBe(true); expect(inside.cover).toBe(800 * 600);
    expect(Number.isFinite(inside.ppvFar)).toBe(true);
    const behind = eyeMetrics(model(0.1, 0, 0, 2), HALF, DIMS, I(), P90, 800, 600, {});
    expect(behind.cover).toBe(0); expect(behind.ppvCenter).toBe(Infinity);
  });
  it('a box partly off screen is clipped to the viewport', () => {
    const r = eyeMetrics(model(0.1, 0.6, 0, -0.65), HALF, DIMS, I(), P90, 1000, 1000, {});
    const full = eyeMetrics(model(0.1, 0, 0, -0.65), HALF, DIMS, I(), P90, 1000, 1000, {});
    expect(r.cover).toBeGreaterThan(0); expect(r.cover).toBeLessThan(full.cover);
  });
  it('a view matrix moves the eye: the same box seen from 0.65 m away along +x', () => {
    // camera at (0.65, 0, 0) looking down -x: view = inverse of (rotate +90 deg about y, then translate)
    const view = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, -0.65, 1];
    const a = eyeMetrics(model(0.1, 0, 0, 0), HALF, DIMS, view, P90, 1000, 1000, {});
    const b = eyeMetrics(model(0.1, 0, 0, -0.65), HALF, DIMS, I(), P90, 1000, 1000, {});
    expect(a.depthCenter).toBeCloseTo(0.65, 9); expect(a.ppvCenter).toBeCloseTo(b.ppvCenter, 9); expect(a.cover).toBeCloseTo(b.cover, 3);
  });
  it('Quest 3 like numbers (about 1700 px over 2 tangent units, 256 grid): 1x / max / close-up', () => {
    const vw = 1700, vh = 1760, P = persp(1.0, 1.0, 1.0, 1.0), d = 0.65, NORM = 3.3; // the box is 3.3 units long (vr-view halfExt), longest side
    const at = (longM, depth) => eyeMetrics(model(longM / NORM, 0, 0, -depth), [1.65, 0.5, 0.5], [256, 80, 80], I(), P, vw, vh, {});
    const x1 = at(0.06, d), max = at(0.30, d), close = at(0.30, 0.75 * 0.30);
    expect(capFromPpv(x1.ppvCenter, x1.ppvFar)).toBe(1); // 6 cm at 65 cm: far below one px per voxel
    const cm = capFromPpv(max.ppvCenter, max.ppvFar); expect(cm).toBeGreaterThan(0.75); expect(cm).toBeLessThan(1); // 30 cm at 65 cm: about 1.5 px per voxel: little to save without losing detail
    const c = capFromPpv(close.ppvCenter, close.ppvFar);
    expect(c).toBeLessThan(0.5); expect(c).toBeGreaterThan(CAP_MIN);
    // the close-up (about 4.3 px per voxel at the centre) keeps the relaxed targets, never fewer than the minimum ones
    expect(close.ppvCenter * c).toBeGreaterThanOrEqual(targetCenter(close.ppvCenter) - 1e-9); expect(close.ppvFar * c).toBeGreaterThanOrEqual(targetFar(close.ppvCenter) - 1e-9);
    expect(close.ppvCenter * c).toBeGreaterThanOrEqual(PPV_CENTER_MIN - 1e-9); expect(close.ppvCenter * c).toBeLessThan(PPV_CENTER);
  });
});

describe('zoom relief', () => {
  it('none up to RELIEF_FROM px per voxel, full from RELIEF_TO, linear between, never raising the targets', () => {
    expect(reliefOf(0.5)).toBe(0); expect(reliefOf(RELIEF_FROM)).toBe(0); expect(reliefOf(RELIEF_TO)).toBe(1); expect(reliefOf(50)).toBe(1); expect(reliefOf(Infinity)).toBe(1);
    expect(reliefOf((RELIEF_FROM + RELIEF_TO) / 2)).toBeCloseTo(0.5, 12);
    expect(targetCenter(1)).toBe(PPV_CENTER); expect(targetFar(1)).toBe(PPV_FAR); expect(targetCenter(9)).toBe(PPV_CENTER_MIN); expect(targetFar(9)).toBe(PPV_FAR_MIN);
    for (let p = 0.5; p < 9; p += 0.25) { expect(targetCenter(p)).toBeLessThanOrEqual(targetCenter(p - 0.25 > 0 ? p - 0.25 : p) + 1e-12); expect(targetCenter(p)).toBeGreaterThanOrEqual(PPV_CENTER_MIN); expect(targetFar(p)).toBeGreaterThanOrEqual(PPV_FAR_MIN); }
  });
  it('the cap falls monotonically with the magnification (no step, no rise when zooming in) and the rendered pixels per voxel never exceed the old rule', () => {
    let prev = 1;
    for (let p = 0.5; p <= 12; p += 0.05) {
      const c = capFromPpv(p, p * 0.7); // far corner at 1.43 x the centre depth
      expect(c).toBeLessThanOrEqual(prev + 1e-12); prev = c;
      const old = Math.min(1, Math.max(CAP_MIN, Math.max(PPV_CENTER / p, PPV_FAR / (p * 0.7))));
      expect(c).toBeLessThanOrEqual(old + 1e-12);
      if (p <= RELIEF_FROM) expect(c).toBeCloseTo(old, 12); // unchanged below the relief
      if (c < 1) expect(c * p).toBeGreaterThanOrEqual(PPV_CENTER_MIN - 1e-9); // never below one pixel per voxel at the centre once the cap acts
    }
  });
  it('saves up to 1 - (PPV_CENTER_MIN / PPV_CENTER)^2 of the pixels at the largest magnifications', () => {
    const c = capFromPpv(8, 8), old = PPV_CENTER / 8;
    expect(c).toBeCloseTo(PPV_CENTER_MIN / 8, 12); expect(1 - (c / old) ** 2).toBeCloseTo(1 - (PPV_CENTER_MIN / PPV_CENTER) ** 2, 9);
  });
});

describe('capFromPpv / nextCap', () => {
  it('keeps PPV_CENTER at the centre and PPV_FAR at the far corner, within [CAP_MIN, 1]', () => {
    expect(capFromPpv(1.3, 1.0)).toBe(1); expect(capFromPpv(0.5, 0.4)).toBe(1);
    expect(capFromPpv(1.9, 1.5)).toBeCloseTo(Math.max(PPV_CENTER / 1.9, PPV_FAR / 1.5), 12); // below RELIEF_FROM: the original rule, unchanged
    expect(capFromPpv(4, 2)).toBeCloseTo(Math.max(PPV_CENTER_MIN / 4, PPV_FAR_MIN / 2), 12); // at RELIEF_TO and above: the relaxed targets
    expect(capFromPpv(100, 100)).toBe(CAP_MIN);
    expect(capFromPpv(Infinity, Infinity)).toBe(CAP_MIN); expect(capFromPpv(0, 0)).toBe(1); expect(capFromPpv(NaN, 1)).toBe(1);
  });
  it('the applied cap is quantised up; rises at once, drops only beyond the hysteresis', () => {
    const q = nextCap(0, 0.4); expect(q).toBeGreaterThanOrEqual(0.4); expect(q - 0.4).toBeLessThan(CAP_QUANT); expect(Math.round(q / CAP_QUANT) * CAP_QUANT).toBeCloseTo(q, 12);
    expect(nextCap(q, 0.45)).toBeGreaterThanOrEqual(0.45); // more detail needed: at once
    expect(nextCap(q, q - CAP_QUANT)).toBe(q); // head bob: no change
    expect(nextCap(q, q - CAP_HYST - CAP_QUANT)).toBeLessThan(q);
    expect(nextCap(0.5, 1)).toBe(1); expect(nextCap(1, 0.01)).toBe(CAP_MIN);
  });
});

describe('foveaRect', () => {
  it('centred on the optical axis, +-FOVEA_HALF of the viewport, band inside', () => {
    const out = [0, 0, 0, 0, 0];
    foveaRect(500, 400, 1000, 800, out);
    expect(out[0]).toBeCloseTo(500 - FOVEA_HALF * 1000); expect(out[2]).toBeCloseTo(500 + FOVEA_HALF * 1000);
    expect(out[1]).toBeCloseTo(400 - FOVEA_HALF * 800); expect(out[3]).toBeCloseTo(400 + FOVEA_HALF * 800); expect(out[4]).toBeGreaterThan(1);
  });
  it('an asymmetric eye frustum moves the centre (eyeMetrics.cx) and the rect stays inside the viewport', () => {
    const P = persp(1.2, 0.8, 1, 1), r = eyeMetrics(model(0.1, 0, 0, -0.65), HALF, DIMS, I(), P, 1000, 1000, {});
    expect(r.cx).toBeCloseTo(1.2 / 2 * 1000, 6); // the axis lies 1.2 of 2 tangent units from the left edge
    const out = foveaRect(950, 500, 1000, 1000, [0, 0, 0, 0, 0]); expect(out[2]).toBe(1000);
  });
  it('periphery factors: なし / 中 / 強', () => { expect(FOVEA_K).toEqual([1, 0.75, 0.5]); });
});

describe('qualityText', () => {
  it('100 % with nothing to cap reads 100 %', () => { expect(qualityText({ modeF: 1, eff: 1 })).toBe('100%'); });
  it('100 % with the data-resolution cap shows the effective scale', () => {
    expect(qualityText({ modeF: 1, eff: 0.41 })).toBe('100%（データ解像度・実効 41%）');
    expect(qualityText({ modeF: 1, eff: 0.41, periphery: 0.5 })).toBe('100%（データ解像度・実効 41%） · 周辺 21%');
    expect(qualityText({ modeF: 1, eff: 0.41 }, false)).toBe('100% (data resolution: effective 41%)');
  });
  it('auto and manual 70 %', () => {
    expect(qualityText({ auto: true, modeF: 0.7, eff: 0.7 })).toBe('自動 70%');
    expect(qualityText({ auto: true, modeF: 1, eff: 0.5 })).toBe('自動 100%（データ解像度・実効 50%）');
    expect(qualityText({ modeF: 0.7, eff: 0.7, periphery: 0.5 })).toBe('70% · 周辺 35%');
  });
});

describe('foveation pays off only when enough of the volume lies outside the centre rect', () => {
  const vw = 1680, vh = 1760, P = persp(1, 1, 1, 1), at = (longM, depth, half) => eyeMetrics(model(longM / 3.3, 0, 0, -depth), half, [256, 107, 107], I(), P, vw, vh, {});
  const rect = e => foveaRect(e.cx, e.cy, vw, vh, [0, 0, 0, 0, 0]);
  it('max size at arm\'s length fits in the rect: no periphery pass (it would ray-march the whole volume a second time)', () => {
    const e = at(0.30, 0.66, [1.65, 0.6875, 0.6875]);
    expect(outsideFovea(e, rect(e))).toBe(0); expect(foveaWorth(0, e.cover, 0.5)).toBe(false);
  });
  it('the eye inside the box (whole viewport covered): worth it at 強 (k 0.5) and at 中 (k 0.75)', () => {
    const e = at(0.30, 0.10, [0.6875, 0.6875, 1.65]); expect(e.inside).toBe(true);
    const o = outsideFovea(e, rect(e)); expect(o / e.cover).toBeCloseTo(1 - (2 * FOVEA_HALF) ** 2, 2);
    expect(foveaWorth(o, e.cover, 0.5)).toBe(true); expect(foveaWorth(o, e.cover, 0.75)).toBe(false); expect(foveaWorth(o, e.cover, 1)).toBe(false);
  });
  it('hysteresis: switched on above 1.25 k², kept until below 1.05 k²', () => {
    expect(foveaWorth(30, 100, 0.5, false)).toBe(false); expect(foveaWorth(30, 100, 0.5, true)).toBe(true);
    expect(foveaWorth(32, 100, 0.5, false)).toBe(true); expect(foveaWorth(25, 100, 0.5, true)).toBe(false); expect(foveaWorth(5, 0, 0.5)).toBe(false);
  });
  it('the covered rect is written (clipped) and matches the cover', () => {
    const e = at(0.06, 0.66, [1.65, 0.6875, 0.6875]);
    expect((e.x1 - e.x0) * (e.y1 - e.y0)).toBeCloseTo(e.cover, 6); expect(e.x0).toBeGreaterThan(0); expect(e.x1).toBeLessThan(vw);
  });
});
