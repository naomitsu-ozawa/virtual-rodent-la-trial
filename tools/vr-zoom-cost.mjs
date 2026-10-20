// Geometry model of the VR volume pass at and near maximum zoom (no browser, pure math on docs/vr-render-scale.js).
// For a Quest 3 like eye (2064 x 2208, about 100 x 106 degrees) and a 256-grid volume of 30 cm longest side (the largest displayed size) it prints, per
// box shape and viewing depth, the covered pixels, the pixels per voxel, the render-scale cap with the pre-633 rule (PPV_CENTER 1.3 / PPV_FAR 1.0 everywhere)
// and with the zoom relief (vr-render-scale.js), and the rays traced per frame (covered px x cap^2, both eyes) with the saving. The volume pass costs about
// rays x (steps per ray + a hit), so the ratio is the predicted change of the volume pass at the same content.
//   node tools/vr-zoom-cost.mjs
import { eyeMetrics, capFromPpv, PPV_CENTER, PPV_FAR, CAP_MIN } from '../docs/vr-render-scale.js';
const vw = 2064, vh = 2208, proj = new Float32Array(16); proj[0] = 0.84; proj[5] = 0.75; proj[10] = -1; proj[11] = -1; proj[14] = -0.02;
const view = new Float32Array(16); view[0] = view[5] = view[10] = view[15] = 1;
const oldCap = (pc, pf) => (!(pc > 0) || !(pf > 0)) ? 1 : Math.min(1, Math.max(CAP_MIN, Math.max(PPV_CENTER / pc, PPV_FAR / pf)));
const rows = [], N = 256, NORM = 3.3, sc = 0.30 / NORM;
for (const [name, ext] of [['cube', [1, 1, 1]], ['rat 2:1:1', [1, 0.5, 0.5]], ['mouse 3:1:1', [1, 1 / 3, 1 / 3]]]) {
  const half = ext.map(e => e * NORM / 2), dims = ext.map(e => Math.round(N * e));
  for (const depth of [0.15, 0.2, 0.225, 0.3, 0.4, 0.65]) {
    const m = new Float32Array(16); m[0] = m[5] = m[10] = sc; m[15] = 1; m[14] = -depth;
    const o = {}; eyeMetrics(m, half, dims, view, proj, vw, vh, o, null);
    const c0 = oldCap(o.ppvCenter, o.ppvFar), c1 = capFromPpv(o.ppvCenter, o.ppvFar);
    const rays0 = 2 * o.cover * c0 * c0, rays1 = 2 * o.cover * c1 * c1;
    rows.push({ shape: name, depth_m: depth, cover_pct: +(o.cover / (vw * vh) * 100).toFixed(0), ppv_centre: +o.ppvCenter.toFixed(2), ppv_far: +o.ppvFar.toFixed(2), cap_old: +c0.toFixed(2), cap_new: +c1.toFixed(2), Mrays_old: +(rays0 / 1e6).toFixed(2), Mrays_new: +(rays1 / 1e6).toFixed(2), saving_pct: +((1 - rays1 / rays0) * 100).toFixed(0) });
  }
}
console.table(rows);
