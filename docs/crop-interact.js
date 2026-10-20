// Direct manipulation of the crop box in the 2D slice views (pure: no DOM; unit-tested in tests/unit/crop-interact.test.js).
// Zones of the box cross-section: inside = move, a band just OUTSIDE a corner = rotate. A drag rotates the box about the view's normal
// (a frame axis of the series), around the box centre, pre-multiplied onto the orientation the box had when the drag started.
// DATA ACCURACY: a drag must never leave a tiny accidental tilt (it would silently turn the byte-copy export into a resampled one), so
// the in-view angle snaps to whole steps: 1 degree for a plain drag, 15 degrees (with 0 / 90 / 180 / 270 within 3 degrees) with Shift.
// An orientation at an axis permutation becomes the EXACT integer matrix (within 3 degrees for 15 degree steps, float dust for 1 degree steps).
import { axisRotation, matMul, orthonormalize, snapToPermutation } from './crop-geometry.js?v=20261020-build630';

export const ROTATE_BAND_PX = 26;        // width of the rotate band outside a corner (screen px)
export const SNAP_STEP_DEG = 15;
export const FINE_STEP_DEG = 1;          // plain drag (Shift = SNAP_STEP_DEG)
export const SNAP_AXIS_DEG = 3;
export const SNAP_PERMUTATION_DEG = 3;
export const FREE_DUST_DEG = 0.05;

// plane -> [horizontal index axis, vertical index axis, normal axis, sign]: rotating the box by theta about the normal axis turns its cross-section
// in the plane coordinates (u, v) by sign * theta (axial and sagittal are right handed in (u, v), coronal (i, k) is not)
export const VIEW_AXES = { axial: { a: 0, b: 1, n: 2, sign: 1 }, coronal: { a: 0, b: 2, n: 1, sign: -1 }, sagittal: { a: 1, b: 2, n: 0, sign: 1 } };

// 'move' (inside the polygon), 'rotate' (outside, within band of a corner), else null. pt / poly / band in the same units. corner: vertex index.
export function classifyPoint(pt, poly, band, inside) {
  if (!poly || poly.length < 3) return { zone: null };
  if (inside) return { zone: 'move' };
  let best = -1, bd = Infinity;
  poly.forEach((q, n) => { const d = Math.hypot(q[0] - pt[0], q[1] - pt[1]); if (d < bd) { bd = d; best = n; } });
  return bd <= band ? { zone: 'rotate', corner: best, dist: bd } : { zone: null };
}
// angle (degrees) of pt about centre; both in plane index units, scaled to mm (sp = [spacing u, spacing v]) so the angle is the physical one
export const pointerAngle = (centre, pt, sp = [1, 1]) => Math.atan2((pt[1] - centre[1]) * sp[1], (pt[0] - centre[0]) * sp[0]) * 180 / Math.PI;
// difference next - prev wrapped to (-180, 180] (a drag past the +-180 jump keeps going)
export function wrapDelta(prev, next) { let d = next - prev; while (d > 180) d -= 360; while (d <= -180) d += 360; return d; }
// snap an angle: 0 / 90 / 180 / 270 within axisTol, else the nearest multiple of step (step 0 = no step snapping). free = unchanged.
export function snapAngle(deg, { free = false, step = SNAP_STEP_DEG, axisTol = SNAP_AXIS_DEG } = {}) {
  if (free) return deg;
  const q = Math.round(deg / 90) * 90;
  if (Math.abs(deg - q) <= axisTol) return q + 0; // + 0: no negative zero
  return step > 0 ? Math.round(deg / step) * step + 0 : deg;
}
// the in-view angle of the box: direction (in the plane coordinates) of the box axis that lies most in the plane; norm = how much of that axis is in
// the plane (1 = the box is turned about the view normal only)
export function viewInfo(R, plane) {
  const { a, b } = VIEW_AXES[plane];
  let best = 0, bn = -1;
  for (let c = 0; c < 3; c++) { const n = Math.hypot(R[a][c], R[b][c]); if (n > bn + 1e-12) { bn = n; best = c; } }
  return { angle: Math.atan2(R[b][best], R[a][best]) * 180 / Math.PI, norm: bn };
}
export const viewAngle = (R, plane) => viewInfo(R, plane).angle;
export const VIEW_ALIGNED_MIN = Math.cos(5 * Math.PI / 180);
// R0 (orientation at the drag start) turned by deltaDeg (the pointer's rotation in the view, on screen) -> new orientation (orthonormal, exact
// permutation matrix when close to one). Without free: when the box is turned about this view's normal only (in-view axis norm >= cos 5 deg) the
// ABSOLUTE in-view angle lands on the snap grid; when it is also tilted out of the view that angle is not meaningful, so the drag amount itself is snapped
// (a drag back by about the same amount restores the orientation exactly). Either way an orientation within 3 degrees of an axis permutation becomes
// the exact integer matrix.
// rotateAboutViewStep also returns the applied drag amount (degrees, after snapping) for the on-screen readout. Steps finer than 15 degrees
// have no 3 degree axis magnet (a 1 or 2 degree turn must stay possible); the snapped angle is then exactly on the axis anyway.
export function rotateAboutViewStep(R0, plane, deltaDeg, { free = false, step = SNAP_STEP_DEG } = {}) {
  const { n, sign } = VIEW_AXES[plane], rot = d => orthonormalize(matMul(axisRotation(n, sign * d), R0));
  const coarse = step >= SNAP_STEP_DEG, axisTol = coarse ? SNAP_AXIS_DEG : 0;
  let d = deltaDeg, R = rot(d);
  if (!free) {
    const { angle, norm } = viewInfo(R, plane);
    d = norm >= VIEW_ALIGNED_MIN ? d + snapAngle(angle, { step, axisTol }) - angle : snapAngle(d, { step, axisTol });
    R = rot(d);
  }
  return { R: snapToPermutation(R, free || !coarse ? FREE_DUST_DEG : SNAP_PERMUTATION_DEG) || R, delta: d };
}
export const rotateAboutView = (R0, plane, deltaDeg, opts) => rotateAboutViewStep(R0, plane, deltaDeg, opts).R;
