// HU line model (build 541): the ONE place the HU line's two endpoints live, in VOXEL (index) coordinates {i,j,k} (voxel CENTRES are
// integers; fractional values are fine, a line picked in 3D rarely lands on a centre). The 2D slice views, the 3D view and the line
// profile panel all read and write this model, so a line drawn in 2D shows in 3D and vice versa; VR can reuse it later (no VR code
// here). Pure module: no DOM, no three.js, no app state (unit-tested in tests/unit/hu-line-model.test.js).
// A change carries a phase: 'live' (the line is being dragged: coarse preview), 'final' (released: full-resolution read), 'clear'.
import { planeDims } from './crosshair.js?v=20261018-build621';

const store = { a: null, b: null, hover: null, listeners: new Set(), hoverListeners: new Set() };
const cp = v => (v ? { i: +v.i, j: +v.j, k: +v.k } : null);
const finite = v => !!v && Number.isFinite(v.i) && Number.isFinite(v.j) && Number.isFinite(v.k);

export const getHuLine = () => (store.a && store.b ? { a: cp(store.a), b: cp(store.b) } : null);
export function setHuLine(a, b, phase = 'final', source = '') {
  if (!finite(a) || !finite(b)) return false;
  store.a = cp(a); store.b = cp(b);
  if (phase === 'final') store.hover = null; // a new line: the old plot hover is meaningless
  emit({ phase: phase === 'live' ? 'live' : 'final', source, line: getHuLine() });
  return true;
}
export function clearHuLine(source = '') {
  if (!store.a && !store.b && !store.hover) return;
  store.a = store.b = store.hover = null;
  emit({ phase: 'clear', source, line: null });
  for (const fn of [...store.hoverListeners]) { try { fn(null); } catch (e) { console.error(e); } }
}
export const onHuLineChange = fn => { store.listeners.add(fn); return () => store.listeners.delete(fn); };
function emit(ev) { for (const fn of [...store.listeners]) { try { fn(ev); } catch (e) { console.error(e); } } }

// the point of the line under the plot's pointer (voxel position), or null: drawn on every view that shows the line
export const getHuLineHover = () => cp(store.hover);
export function setHuLineHover(v) {
  const n = finite(v) ? cp(v) : null;
  if (!n && !store.hover) return;
  store.hover = n;
  for (const fn of [...store.hoverListeners]) { try { fn(cp(n)); } catch (e) { console.error(e); } }
}
export const onHuLineHoverChange = fn => { store.hoverListeners.add(fn); return () => store.hoverListeners.delete(fn); };

// ---- heavy work deferral (build 546) ----
// While an immersive (VR / AR) session is on, the PC views' full-resolution line reads (line-profile-ui.js compute: slice reads + filter runs, a
// 30 ms main-thread budget per chunk) must not run: they would break the headset's frame rate and double the filtered-plane work the VR line
// already does. vr-view.js sets this for the session; the panel runs its pending read when it is cleared.
const defer = { on: false, listeners: new Set() };
export const isHuLineDeferred = () => defer.on;
export function setHuLineDeferred(on) {
  const v = !!on; if (v === defer.on) return;
  defer.on = v;
  for (const fn of [...defer.listeners]) { try { fn(v); } catch (e) { console.error(e); } }
}
export const onHuLineDeferChange = fn => { defer.listeners.add(fn); return () => defer.listeners.delete(fn); };

// ---- geometry ----
// the scene-local position (voxelToLocal3D's frame) -> voxel index coordinates (the inverse of crosshair.js voxelToLocal3D)
export function localToVoxel(l, dims, spacing) {
  const [sx, sy, sz] = spacing || [1, 1, 1], px = dims.columns * sx, py = dims.rows * sy, pz = dims.slices * sz, scale = 3.3 / Math.max(px, py, pz, 1);
  return { i: (l.x / scale + px / 2) / sx - 0.5, j: (-l.y / scale + py / 2) / sy - 0.5, k: (l.z / scale + pz / 2) / sz - 0.5 };
}
// a voxel position inside the volume box (a half voxel of margin: the outer faces of the edge voxels)
export const voxelInside = (v, dims, margin = 0.5) => !!v && v.i >= -margin && v.j >= -margin && v.k >= -margin && v.i <= dims.columns - 1 + margin && v.j <= dims.rows - 1 + margin && v.k <= dims.slices - 1 + margin;
export function clampToVolume(v, dims) {
  const c = (x, n) => (x < 0 ? 0 : x > n - 1 ? n - 1 : x);
  return { i: c(v.i, dims.columns), j: c(v.j, dims.rows), k: c(v.k, dims.slices) };
}
// ray (origin o, direction d, plain {x,y,z}) against a plane (point p, normal n): the distance t along the ray, or null (parallel / behind)
export function rayPlaneT(o, d, p, n) {
  const den = d.x * n.x + d.y * n.y + d.z * n.z;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z) / den;
  return t > 0 ? t : null;
}

// ---- the line on a 2D slice view ----
const axisOf = (plane, v) => (plane === 'axial' ? v.k : plane === 'coronal' ? v.j : v.i);
// where a voxel position sits in a plane's image, as a fraction 0..1 (planePointFromVoxel of crosshair.js, kept here for float input)
export function planeFraction(plane, v, dims) {
  const [w, h] = planeDims(plane, dims);
  if (plane === 'axial') return { fx: (v.i + 0.5) / w, fy: (v.j + 0.5) / h };
  const fy = (dims.slices - 1 - v.k + 0.5) / h;
  return plane === 'coronal' ? { fx: (v.i + 0.5) / w, fy } : { fx: (v.j + 0.5) / w, fy };
}
// How the line meets the slice `idx` of `plane`:
//   'on'    both ends lie on that slice (within half a voxel): drawn solid, exactly as drawn
//   'cross' the line passes through the slice: its projection onto the view is drawn dashed, with the crossing marked (hit)
//   'none'  the line does not touch the slice: nothing is drawn
// seg = the two end points as image fractions; hit = the crossing point (cross only); t = its position along a -> b.
export function lineOnPlane(plane, a, b, idx, dims) {
  const ca = axisOf(plane, a), cb = axisOf(plane, b), H = 0.5, eps = 1e-9;
  const seg = [planeFraction(plane, a, dims), planeFraction(plane, b, dims)];
  if (Math.abs(ca - idx) <= H + eps && Math.abs(cb - idx) <= H + eps) return { kind: 'on', seg, hit: null, t: null };
  const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
  if (hi < idx - H - eps || lo > idx + H + eps || Math.abs(cb - ca) < eps) return { kind: 'none', seg: null, hit: null, t: null };
  const t = Math.min(1, Math.max(0, (idx - ca) / (cb - ca)));
  const p = { i: a.i + (b.i - a.i) * t, j: a.j + (b.j - a.j) * t, k: a.k + (b.k - a.k) * t };
  return { kind: 'cross', seg, hit: planeFraction(plane, p, dims), t };
}
// is a voxel position (the plot's hover point) on the slice, within half a voxel
export const voxelOnSlice = (plane, v, idx) => Math.abs(axisOf(plane, v) - idx) <= 0.5 + 1e-9;
