// VR data-resolution render scale. Quest 3 report: 72 fps at 1x / 2x, 50 fps at 4x, 40 fps at max (30 cm) and 15 fps with the
// max size held at the face, image quality fixed at 100 %. The volume is ray-marched with an object-space step, so the cost of one pixel does
// not depend on the zoom; the cost follows the screen pixels the volume covers. Zoomed in, one voxel of the data spans many screen pixels:
// rendering every one of them shows nothing more than the data holds. Each frame the 8 corners of the volume box are projected with each
// eye's camera; that gives the covered pixels and the screen pixels per voxel (ppv). The volume render scale is capped so that
// ppv x scale stays >= PPV_CENTER at the box centre and >= PPV_FAR at the farthest corner (every voxel keeps at least one rendered pixel):
// no detail of the data is lost against 100 %. "100 %" therefore means "full data detail".
// Pure math on plain arrays (no THREE, no allocation per call): tests/unit/vr-render-scale.test.js.

export const PPV_CENTER = 1.3;     // rendered pixels per voxel at the box centre (1.2 .. 1.5)
export const PPV_FAR = 1.0;        // ... and at the farthest corner of the box: never fewer than one pixel per voxel
export const CAP_MIN = 0.1;        // the cap never goes below this (the volume would need > 13 px per voxel at the centre)
export const N_MAX = 1000000;      // ray budget, both eyes together, rays per frame (screen pixels x scale^2); about 1M rays: set from the Quest 3 max-size close-up, tune on the device
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
// covered pixels, the far corner (PPV_FAR) and the centre depth come from it instead of the full data box (the far corner of the
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

// the raw cap (0..1] from the ray budget. coverPixels = the pixels the volume covers at scale 1, both eyes summed (eyeMetrics cover, the whole
// viewport for an eye inside the box). The rays per frame are about coverPixels x cap^2, so cap = sqrt(nMax / coverPixels): never above 1 (a small or
// far volume is not touched), never below CAP_MIN. The caller takes min(capFromPpv result, this): one more input to the cap, nothing else changes.
export function capFromBudget(coverPixels, nMax = N_MAX) {
  if (!(coverPixels > 0) || !(nMax > 0)) return 1;
  return Math.min(1, Math.max(CAP_MIN, Math.sqrt(nMax / coverPixels)));
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
// one MORE volume in the same volume pass (the partner of a sample pair). The two ray meshes are drawn into one low-resolution target at one render scale, so the ray
// budget (N_MAX, "rays per frame") counts both: the covered pixels of the partner's eyes are added to the primary's (acc.cover), its detail need joins the primary's
// (acc.need: the scale is one for both, every voxel of either keeps its pixel) and its pixels outside the fovea rect join the periphery count (acc.outside).
// acc = { cover, outside, need } (reused, start from the primary's sums); e = eyeMetrics out of that volume for one eye, rFov = that eye's foveaRect (viewport px). Returns acc.
// With no partner this is never called: a single volume is computed exactly as before.
export function addVolumeEye(acc, e, rFov) {
  acc.cover += e.cover;
  if (e.cover > 0) acc.need = Math.max(acc.need, capFromPpv(e.ppvCenter, e.ppvFar));
  acc.outside += outsideFovea(e, rFov);
  return acc;
}

// does the volume box cover EVERY pixel of one eye viewport? In the low-resolution path each box of a pair draws the
// composite (BackSide box, vr-view.js compositeFragment): a pixel is drawn where its ray leaves the box between the near and the far plane, and what it draws depends on
// the pixel alone (the same low-resolution images, the same uniforms). The rays whose exit point lies beyond the near plane form a convex cone (the box cut by the
// half-space beyond the near plane, seen from the eye): when the four corner rays of the viewport, taken 1.5 px OUTSIDE it, are in that cone (tested against the box
// shrunk a little and a near plane moved a little out), every pixel's ray is. m / half / view / proj / vw / vh as eyeMetrics (half: the composite's box half extents).
// false whenever unsure (a projection that is not a plain perspective, a corner ray that misses or grazes, a corner of the box past the far plane): the caller then draws as before.
const COVER_SHRINK = 1e-4, COVER_NEAR = 1e-3, COVER_PX = 1.5, PROJ_EPS = 1e-6;
const cvA = new Float64Array(12), cvI = new Float64Array(9), PROJ_ZERO = [1, 2, 3, 4, 6, 7, 12, 13, 15];
export function boxCoversView(m, half, view, proj, vw, vh) {
  if (!(vw > 0 && vh > 0) || !proj[0] || !proj[5]) return false;
  for (let i = 0; i < PROJ_ZERO.length; i++) if (Math.abs(proj[PROJ_ZERO[i]]) >= PROJ_EPS) return false; // a plain (asymmetric) perspective only
  if (Math.abs(proj[11] + 1) >= PROJ_EPS) return false;
  const near = proj[14] / (proj[10] - 1), far = proj[10] + 1 === 0 ? Infinity : proj[14] / (proj[10] + 1); // eye depths (> 0 in front of the eye)
  if (!(near > 0) || !(far > near)) return false;
  // A = view x m (object -> eye space): the 3 x 3 part in cvA[0..8] and the translation in cvA[9..11], column major
  for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) cvA[c * 3 + r] = view[r] * m[c * 4] + view[4 + r] * m[c * 4 + 1] + view[8 + r] * m[c * 4 + 2] + view[12 + r] * m[c * 4 + 3];
  const a = cvA[0], b = cvA[3], c = cvA[6], d = cvA[1], e = cvA[4], f = cvA[7], g = cvA[2], h = cvA[5], k = cvA[8]; // rows (a b c) (d e f) (g h k)
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (!(Math.abs(det) > 1e-30)) return false;
  cvI[0] = (e * k - f * h) / det; cvI[1] = (c * h - b * k) / det; cvI[2] = (b * f - c * e) / det; // the inverse, row major
  cvI[3] = (f * g - d * k) / det; cvI[4] = (a * k - c * g) / det; cvI[5] = (c * d - a * f) / det;
  cvI[6] = (d * h - e * g) / det; cvI[7] = (b * g - a * h) / det; cvI[8] = (a * e - b * d) / det;
  const tx = cvA[9], ty = cvA[10], tz = cvA[11];
  if (far < Infinity) for (let i = 0; i < 8; i++) { // every corner of the box nearer than the far plane: no exit point is clipped by it
    const ox = SX[i] * half[0], oy = SY[i] * half[1], oz = SZ[i] * half[2];
    if (-(g * ox + h * oy + k * oz + tz) >= far * (1 - COVER_NEAR)) return false;
  }
  const Ox = -(cvI[0] * tx + cvI[1] * ty + cvI[2] * tz), Oy = -(cvI[3] * tx + cvI[4] * ty + cvI[5] * tz), Oz = -(cvI[6] * tx + cvI[7] * ty + cvI[8] * tz); // the eye in object space
  const hx = half[0] * (1 - COVER_SHRINK), hy = half[1] * (1 - COVER_SHRINK), hz = half[2] * (1 - COVER_SHRINK), minExit = near * (1 + COVER_NEAR);
  for (let s = 0; s < 4; s++) {
    // the corner ray in eye space at depth 1 (z = -1): its parameter along the ray IS the eye depth, in object space as well (an affine map keeps it)
    const nx = SX[s] * (1 + 2 * COVER_PX / vw), ny = SY[s] * (1 + 2 * COVER_PX / vh);
    const vx = (nx + proj[8]) / proj[0], vy = (ny + proj[9]) / proj[5];
    const Dx = cvI[0] * vx + cvI[1] * vy - cvI[2], Dy = cvI[3] * vx + cvI[4] * vy - cvI[5], Dz = cvI[6] * vx + cvI[7] * vy - cvI[8];
    let t0 = -Infinity, t1 = Infinity;
    for (let ax = 0; ax < 3; ax++) {
      const o = ax === 0 ? Ox : ax === 1 ? Oy : Oz, dd = ax === 0 ? Dx : ax === 1 ? Dy : Dz, hh = ax === 0 ? hx : ax === 1 ? hy : hz;
      if (Math.abs(dd) < 1e-15) { if (Math.abs(o) >= hh) return false; continue; }
      let ta = (-hh - o) / dd, tb = (hh - o) / dd; if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    }
    if (!(t1 > t0) || !(t1 > minExit)) return false; // misses the box, or leaves it before the near plane
  }
  return true;
}
// which of the two composites of a pair the low-resolution path draws: primaryOnly / partnerOnly = that composite alone draws the picture, else both (as before). vr-view.js passes
// primaryOnly only when it cannot change a pixel (the primary's box covers every eye viewport AND the primary is the nearer box, so it draws first with LessEqual and the partner's, Less,
// is rejected at every pixel), and never partnerOnly. Constant objects: no allocation per frame.
const COMP_BOTH = Object.freeze({ primary: true, partner: true }), COMP_PRIMARY = Object.freeze({ primary: true, partner: false }), COMP_PARTNER = Object.freeze({ primary: false, partner: true });
export const pairComposites = (primaryOnly, partnerOnly) => (primaryOnly ? COMP_PRIMARY : partnerOnly ? COMP_PARTNER : COMP_BOTH);

// is the offscreen foveation worth its second pass? The periphery pass ray-marches every covered pixel again at (f k)^2, the centre pass only the ones in
// the rect at f^2: it pays off when more than k^2 of the covered pixels lie outside the rect (switched on above 1.25 k^2, off below 1.05 k^2: no flicker at
// the threshold). A volume that fits in the rect (max zoom at arm's length) is drawn by the centre pass alone.
export const foveaWorth = (outside, cover, k, wasOn = false) => k < 1 && cover > 0 && outside / cover > k * k * (wasOn ? 1.05 : 1.25);

// While the volume is held in a hand (moved / turned / scaled) the WebGPU view draws it a little coarser; it goes back when the hold ends (after HOLD_RELEASE_MS, see createHoldGate).
// The factor multiplies the render scale in use (the auto ladder's / manual scale, already under the data-resolution cap), so it lowers the CENTRE rect and
// the periphery together (the periphery pass runs at f x FOVEA_K: its ratio to the centre does not change). HOLD_SCALE = 0.8 per axis (the default of the menu setting) = 0.64 of the rays of the volume pass (about -36 % of its
// GPU time; design estimate, to be checked on the Quest 3). Why this much by default: a held volume moves with the hand, so its image slips over the retina and the
// eye resolves less than at rest; at the cap the centre keeps PPV_CENTER x 0.8 = 1.04 rendered pixels per voxel, i.e. still one pixel per voxel of the data (only the far
// corner of the box, PPV_FAR 1.0, falls to 0.8).
// The menu slider (settings.moveLowK) picks the factor from HOLD_MIN .. HOLD_MAX in steps of HOLD_STEP. The factor is applied AFTER the scale guard (vr-view.js), so the guard's direct-path rounding
// (LOW_BELOW 0.9 of vr-flicker-guard.js: a scale of 0.9 or more is taken as 1) never sees it and every value in the range takes effect. The top, 0.95, is the mildest cut (1 = no cut is the setting's off);
// the bottom, 0.5, is the same as the lowest auto floor (最低 50 %); below 0.77 (1 / PPV_CENTER) the centre has fewer rendered pixels than voxels, which is what the setting is for (a stronger cut, not a safe default).
export const HOLD_SCALE = 0.8;
export const HOLD_MIN = 0.5, HOLD_MAX = 0.95, HOLD_STEP = 0.05;
// a stored / given value -> a valid factor: rounded to HOLD_STEP, clamped to HOLD_MIN .. HOLD_MAX; not a number -> HOLD_SCALE
export const holdScaleValue = v => {
  v = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? +v : NaN);
  if (!Number.isFinite(v)) return HOLD_SCALE;
  return Math.round(Math.round(Math.min(HOLD_MAX, Math.max(HOLD_MIN, v)) / HOLD_STEP) * HOLD_STEP * 100) / 100; // 2 decimals: no 0.7000000000000001
};

// the situations in which the hold factor may apply at all (the rest restores the full scale at once, without any delay). Every condition is the user-visible state of this frame:
//  enabled = the menu setting (on by default); webgpu = the WebGPU view only (the WebGL drawing is not touched); live = the session is running;
//  recording = the volume breakdown is being prepared / recorded (it measures at the scale in use without the hold); bench = a benchmark (sets its own scales).
export const holdAllowed = ({ enabled = true, webgpu = false, live = true, recording = false, bench = false } = {}) => !!(enabled && webgpu && live && !recording && !bench);

// the factor for this frame (1 = no change). heldTracked = how many hands / controllers hold the volume AND are still tracked / connected (a hand whose tracking is lost, or a controller that is
// gone, no longer counts); scale = the menu's value (holdScaleValue: out of range is clamped, not a number gives HOLD_SCALE).
export const holdScaleOf = ({ enabled = true, webgpu = false, live = true, heldTracked = 0, recording = false, bench = false, scale = HOLD_SCALE } = {}) =>
  holdAllowed({ enabled, webgpu, live, recording, bench }) && heldTracked > 0 ? holdScaleValue(scale) : 1;

// Grab / release must not make the picture alternate (photosensitivity, see vr-flicker-guard.js): the hold has a state of its own with two timers, and the scale guard does not count it.
//  - the hold goes OFF only HOLD_RELEASE_MS after the last frame a hand held (a short loss of tracking, a grip that opens for a moment and closes again: the reduced scale stays);
//  - once OFF it stays off at least HOLD_MIN_OFF_MS before it can go ON again.
// So the scale changes by the hold at most twice in any HOLD_RELEASE_MS + HOLD_MIN_OFF_MS = 1 s (<= 2 Hz, under the 3 Hz of the scale guard), however fast the hands grab and let go.
// allowed = false (setting off, session over, breakdown, benchmark; holdAllowed) restores at once (no timer).
export const HOLD_RELEASE_MS = 600, HOLD_MIN_OFF_MS = 400;
export function createHoldGate({ releaseMs = HOLD_RELEASE_MS, minOffMs = HOLD_MIN_OFF_MS } = {}) {
  let on = false, lastHeld = -Infinity, changedAt = -Infinity;
  return {
    step(held, now, { allowed = true } = {}) {
      if (!allowed) { if (on) { on = false; changedAt = now; } lastHeld = -Infinity; return false; }
      if (held) lastHeld = now;
      if (on) { if (!held && now - lastHeld >= releaseMs) { on = false; changedAt = now; } }
      else if (held && now - changedAt >= minOffMs) { on = true; changedAt = now; }
      return on;
    },
    get on() { return on; },
    reset() { on = false; lastHeld = -Infinity; changedAt = -Infinity; },
  };
}

// the scale with the factor applied (never below CAP_MIN; factor 1 returns f itself)
export const applyHoldScale = (f, k) => (k < 1 ? Math.max(CAP_MIN, f * k) : f);

const pct = v => Math.round(v * 100) + '%';
// the quality readout: the mode (100 % / 70 % / 50 % / auto x %) and, when the data-resolution cap renders fewer pixels, the effective scale
// e.g. 「100%（データ解像度・実効 41%）」 / 「自動 70%（データ解像度・実効 41%）」
export function qualityText({ auto = false, modeF = 1, eff = 1, periphery = 1 } = {}, ja = true) {
  let t = (auto ? (ja ? '自動 ' : 'auto ') : '') + pct(modeF);
  if (eff < modeF - 0.005) t += ja ? '（データ解像度・実効 ' + pct(eff) + '）' : ' (data resolution: effective ' + pct(eff) + ')';
  if (periphery < 1 && eff < 1) t += ja ? ' · 周辺 ' + pct(eff * periphery) : ' · periphery ' + pct(eff * periphery);
  return t;
}
