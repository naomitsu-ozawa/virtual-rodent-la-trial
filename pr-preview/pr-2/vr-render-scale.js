// VR data-resolution render scale. Quest 3 report: 72 fps at 1x / 2x, 50 fps at 4x, 40 fps at max (30 cm) and 15 fps with the
// max size held at the face, image quality fixed at 100 %. The volume is ray-marched with an object-space step, so the cost of one pixel does
// not depend on the zoom; the cost follows the screen pixels the volume covers. Zoomed in, one voxel of the data spans many screen pixels:
// rendering every one of them shows nothing more than the data holds. Each frame the 8 corners of the volume box are projected with each
// eye's camera; that gives the covered pixels and the screen pixels per voxel (ppv). The volume render scale is capped so that
// ppv x scale stays >= PPV_CENTER at the box centre and >= PPV_FAR at the farthest corner (every voxel keeps at least one rendered pixel):
// no detail of the data is lost against 100 %. "100 %" therefore means "full data detail".
// Pure math on plain arrays (no THREE, no allocation per call): tests/unit/vr-render-scale.test.js.

export const PPV_CENTER = 1.3;
export const PPV_FAR = 1.0;        // ... and at the farthest corner of the box: never fewer than one pixel per voxel
export const CAP_MIN = 0.1;        // the cap never goes below this (the volume would need > 13 px per voxel at the centre)
export const CAP_QUANT = 1 / 32;   // the cap moves in steps of 1/32 (rounded up: detail first)
export const CAP_HYST = 2 / 32;    // ... and only drops once the new value is this far below (head bob does not make it flicker)
export const NEAR_DEPTH = 0.02;    // m: depths below this count as "at the eye" (the box reaches past the near plane)
export const NEAR_EXIT = 1.5;      // `inside` (cover = the whole viewport) leaves only when every corner is deeper than NEAR_DEPTH x this: head jitter at the 2 cm boundary no longer flips cover (and the ladder's jump rule) every frame
export const FOVEA_HALF = 0.28;    // offscreen foveation: the sharp rect is +-28 % of the eye viewport around the optical axis (about +-30 deg on Quest 3)
export const FOVEA_BAND = 0.05;    // ... blended into the periphery over the last 5 % of the viewport inside the rect
export const FOVEA_K = [1, 0.75, 0.5]; // periphery scale relative to the centre, per the 周辺の簡略化 setting (なし / 中 / 強)

const SX = [-1, 1, -1, 1, -1, 1, -1, 1], SY = [-1, -1, 1, 1, -1, -1, 1, 1], SZ = [-1, -1, -1, -1, 1, 1, 1, 1];

// one eye. m = the volume mesh's matrixWorld elements (column major, 16), half = the box half extents (object units), dims = the voxel grid in use,
// view = the eye camera's matrixWorldInverse elements, proj = its projectionMatrix elements, vw / vh = the eye viewport in framebuffer pixels.
// Writes into out (reused): { cover: covered px (screen bbox of the box, clipped), ppvCenter, ppvFar, depthCenter, depthFar, inside: the box reaches the eye,
// cx, cy: the optical axis in viewport px (fovea centre), x0 y0 x1 y1: the covered rect (clipped; the whole viewport when inside) }. Returns out.
// box = { c: [3], h: [3] } (object space centre / half extents), the content box the volume pass draws (vr-content-box.js): the corners, the
// covered pixels, the far corner (PPV_FAR) and the centre depth come from it instead of the full data box (approved rule change: the far corner of the
// empty air around the body no longer holds the cap up). The voxel size still comes from half / dims (the grid). null = the full box (as before).
export function eyeMetrics(m, half, dims, view, proj, vw, vh, out = {}, box = null) {
  // world voxel edge: the smallest of the three axes (anisotropic spacing: conservative)
  const c0 = Math.hypot(m[0], m[1], m[2]), c1 = Math.hypot(m[4], m[5], m[6]), c2 = Math.hypot(m[8], m[9], m[10]);
  const voxel = Math.min(2 * half[0] / Math.max(1, dims[0]) * c0, 2 * half[1] / Math.max(1, dims[1]) * c1, 2 * half[2] / Math.max(1, dims[2]) * c2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, far = -Infinity, inside = false;
  const nearD = out.inside === true ? NEAR_DEPTH * NEAR_EXIT : NEAR_DEPTH; // hysteresis on the previous state of this out (one out per eye)
  const bh = box ? box.h : half, bcx = box ? box.c[0] : 0, bcy = box ? box.c[1] : 0, bcz = box ? box.c[2] : 0;
  for (let i = 0; i < 8; i++) {
    const ox = bcx + SX[i] * bh[0], oy = bcy + SY[i] * bh[1], oz = bcz + SZ[i] * bh[2];
    const wx = m[0] * ox + m[4] * oy + m[8] * oz + m[12], wy = m[1] * ox + m[5] * oy + m[9] * oz + m[13], wz = m[2] * ox + m[6] * oy + m[10] * oz + m[14];
    const x = view[0] * wx + view[4] * wy + view[8] * wz + view[12], y = view[1] * wx + view[5] * wy + view[9] * wz + view[13], z = view[2] * wx + view[6] * wy + view[10] * wz + view[14];
    const d = -z; if (d > far) far = d;
    if (d < nearD) { inside = true; continue; }
    const cx = proj[0] * x + proj[4] * y + proj[8] * z + proj[12], cy = proj[1] * x + proj[5] * y + proj[9] * z + proj[13], w = proj[3] * x + proj[7] * y + proj[11] * z + proj[15];
    const px = (cx / w + 1) * 0.5 * vw, py = (cy / w + 1) * 0.5 * vh;
    if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  const ox = m[0] * bcx + m[4] * bcy + m[8] * bcz + m[12], oy = m[1] * bcx + m[5] * bcy + m[9] * bcz + m[13], oz = m[2] * bcx + m[6] * bcy + m[10] * bcz + m[14]; // the box centre in world space
  const dc = -(view[2] * ox + view[6] * oy + view[10] * oz + view[14]);
  let cover;
  if (far < NEAR_DEPTH) { cover = 0; out.x0 = out.y0 = out.x1 = out.y1 = 0; } // the whole box is behind the eye
  else if (inside) { cover = vw * vh; out.x0 = 0; out.y0 = 0; out.x1 = vw; out.y1 = vh; } // a corner at / behind the eye: the projection is unbounded; count the whole viewport
  else {
    out.x0 = Math.max(0, minX); out.y0 = Math.max(0, minY); out.x1 = Math.max(out.x0, Math.min(vw, maxX)); out.y1 = Math.max(out.y0, Math.min(vh, maxY));
    cover = (out.x1 - out.x0) * (out.y1 - out.y0);
  }
  const focal = Math.min(Math.abs(proj[0]) * vw, Math.abs(proj[5]) * vh) * 0.5; // px per unit of tan(angle)
  out.cover = cover;
  out.depthCenter = dc; out.depthFar = far; out.inside = inside;
  out.ppvCenter = cover > 0 ? focal * voxel / Math.max(dc, NEAR_DEPTH) : Infinity;
  out.ppvFar = cover > 0 ? focal * voxel / Math.max(far, NEAR_DEPTH) : Infinity;
  out.cx = (1 - proj[8]) * 0.5 * vw; out.cy = (1 - proj[9]) * 0.5 * vh;
  return out;
}

// the raw cap (0..1] from the pixels per voxel of one eye: the smallest scale that keeps PPV_CENTER at the centre and PPV_FAR at the far corner
export function capFromPpv(ppvCenter, ppvFar) {
  if (!(ppvCenter > 0) || !(ppvFar > 0)) return 1;
  const need = Math.max(PPV_CENTER / ppvCenter, PPV_FAR / ppvFar);
  return Math.min(1, Math.max(CAP_MIN, need));
}

// the cap that is applied: quantised up to CAP_QUANT; a rise is taken at once (more detail), a drop only beyond CAP_HYST (no flicker with head bob)
export function nextCap(prev, raw) {
  const q = Math.min(1, Math.max(CAP_MIN, Math.ceil(raw / CAP_QUANT - 1e-6) * CAP_QUANT));
  if (!(prev > 0) || q > prev || q < prev - CAP_HYST + 1e-9) return q;
  return prev;
}

// the fovea rect of one eye in its viewport px (x0, y0, x1, y1) around the optical axis; with the blend band (px) along the inner edge. Writes out[0..4].
export function foveaRect(cx, cy, vw, vh, out) {
  const hx = FOVEA_HALF * vw, hy = FOVEA_HALF * vh;
  out[0] = Math.max(0, cx - hx); out[1] = Math.max(0, cy - hy); out[2] = Math.min(vw, cx + hx); out[3] = Math.min(vh, cy + hy);
  out[4] = Math.max(1, FOVEA_BAND * Math.min(vw, vh));
  return out;
}

// covered pixels of one eye (eyeMetrics out) that lie outside its fovea rect (foveaRect, same viewport px) — the pixels the periphery pass saves on
export function outsideFovea(e, r) {
  const ix = Math.max(0, Math.min(e.x1, r[2]) - Math.max(e.x0, r[0])), iy = Math.max(0, Math.min(e.y1, r[3]) - Math.max(e.y0, r[1]));
  return Math.max(0, e.cover - ix * iy);
}
// is the offscreen foveation worth its second pass? The periphery pass ray-marches every covered pixel again at (f k)^2, the centre pass only the ones in
// the rect at f^2: it pays off when more than k^2 of the covered pixels lie outside the rect (switched on above 1.25 k^2, off below 1.05 k^2: no flicker at
// the threshold). A volume that fits in the rect (max zoom at arm's length) is drawn by the centre pass alone.
export const foveaWorth = (outside, cover, k, wasOn = false) => k < 1 && cover > 0 && outside / cover > k * k * (wasOn ? 1.05 : 1.25);

const pct = v => Math.round(v * 100) + '%';
// the quality readout: the mode (100 % / 70 % / 50 % / auto x %) and, when the data-resolution cap renders fewer pixels, the effective scale
// e.g. 「100%（データ解像度・実効 41%）」 / 「自動 70%（データ解像度・実効 41%）」
export function qualityText({ auto = false, modeF = 1, eff = 1, periphery = 1 } = {}, ja = true) {
  let t = (auto ? (ja ? '自動 ' : 'auto ') : '') + pct(modeF);
  if (eff < modeF - 0.005) t += ja ? '（データ解像度・実効 ' + pct(eff) + '）' : ' (data resolution: effective ' + pct(eff) + ')';
  if (periphery < 1 && eff < 1) t += ja ? ' · 周辺 ' + pct(eff * periphery) : ' · periphery ' + pct(eff * periphery);
  return t;
}
