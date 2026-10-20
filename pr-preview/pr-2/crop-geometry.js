// Crop box geometry (pure: no DOM, no imports; unit-tested in tests/unit/crop-geometry.test.js).
//
// Coordinate systems
// - INDEX space: (i, j, k) = (column, row, slice) of the loaded series, voxel CENTRES at integers, a voxel occupies [n-0.5, n+0.5].
//   Fractional values are allowed (a rotated box has a fractional centre).
// - MM frame of the series: (i*sx, j*sy, k*sz). The box is rotated in this frame, about its own centre, so a box that is rotated about
//   an axis stays orthogonal even when the voxel spacing is anisotropic.
// - PATIENT space (DICOM LPS, mm): P = origin + x*rowDir + y*colDir + z*sliceDir where (x, y, z) is the mm frame above.
//
// The box has N voxels per side, in ITS OWN axes, with the SAME spacing as the source axis it started on (output spacing == source
// spacing; for an anisotropic source the box is N*sx x N*sy x N*sz mm, not a physical cube).
// Rotation: the SINGLE SOURCE OF TRUTH is the 3x3 matrix box.R (row-major, columns = box axes in the mm frame; set by setBoxRotation, which keeps
// box.angles as a derived readout only). A box without box.R (older callers / tests) uses R = Rz(rz) * Ry(ry) * Rx(rx) from box.angles (degrees).
// "Axis aligned" (the byte-copy export path) means R is EXACTLY the identity: the exporter does not treat 90 degree turns as exact copies.
export const CROP_SIZES = [128, 256, 512];
export const CROP_INTERPOLATIONS = ['nearest', 'linear', 'cubic'];
export const DEFAULT_ROTATED_INTERPOLATION = 'linear';

const RAD = Math.PI / 180;
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = a => Math.hypot(a[0], a[1], a[2]);
export const unit3 = a => { const n = norm3(a); return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0]; };
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// Row-major 3x3. A 90 degree turn gives exact 0 / +-1 (cos/sin of multiples of 90 degrees are snapped).
function cs(deg) {
  const m = ((deg % 360) + 360) % 360;
  if (m === 0) return [1, 0];
  if (m === 90) return [0, 1];
  if (m === 180) return [-1, 0];
  if (m === 270) return [0, -1];
  return [Math.cos(deg * RAD), Math.sin(deg * RAD)];
}
export function rotationMatrix(rxDeg = 0, ryDeg = 0, rzDeg = 0) {
  const [cx, sx] = cs(rxDeg), [cy, sy] = cs(ryDeg), [cz, sz] = cs(rzDeg);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]], Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (A, B) => A.map((_, r) => [0, 1, 2].map(c => A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]));
  return mul(Rz, mul(Ry, Rx));
}
export const IDENTITY3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export const matMul = (A, B) => A.map((_, r) => [0, 1, 2].map(c => A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]));
// rotation by deg about the mm-frame axis (0 = x / i, 1 = y / j, 2 = z / k); multiples of 90 degrees are exact
export function axisRotation(axis, deg) {
  const [c, s] = cs(deg);
  return axis === 0 ? [[1, 0, 0], [0, c, -s], [0, s, c]] : axis === 1 ? [[c, 0, s], [0, 1, 0], [-s, 0, c]] : [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
const isExactIdentity = R => !!R && [0, 1, 2].every(r => [0, 1, 2].every(c => R[r][c] === (r === c ? 1 : 0)));
// Gram-Schmidt on the columns: removes the drift of repeated float products (proper rotation, det +1)
export function orthonormalize(R) {
  const c0 = unit3(matCol(R, 0));
  let c1 = matCol(R, 1); const d = dot3(c0, c1); c1 = unit3([c1[0] - d * c0[0], c1[1] - d * c0[1], c1[2] - d * c0[2]]);
  const c2 = cross3(c0, c1);
  return [0, 1, 2].map(r => [c0[r], c1[r], c2[r]]);
}
// R within tolDeg of an axis permutation (identity or any of the 23 other proper 90 degree orientations)? -> the EXACT integer matrix (+0, never -0), else null
export function snapToPermutation(R, tolDeg = 3) {
  const tol = Math.sin(tolDeg * RAD), out = R.map(row => row.map(v => { const r = Math.round(v); return Math.abs(v - r) <= tol && Math.abs(r) <= 1 ? r + 0 : NaN; }));
  if (out.some(row => row.some(Number.isNaN))) return null;
  const ok = out.every(row => row.reduce((a, v) => a + Math.abs(v), 0) === 1) && [0, 1, 2].every(c => out.reduce((a, row) => a + Math.abs(row[c]), 0) === 1);
  if (!ok) return null;
  const det = dot3(matCol(out, 0), cross3(matCol(out, 1), matCol(out, 2)));
  return det === 1 ? out.map(row => row.map(v => v + 0)) : null;
}
// Euler angles (degrees, R = Rz*Ry*Rx) of R: for display and the DICOM description only
export function eulerFromMatrix(R) {
  const D = 180 / Math.PI, y = Math.asin(Math.max(-1, Math.min(1, -R[2][0])));
  let x, z;
  if (Math.abs(R[2][0]) > 1 - 1e-12) { z = 0; x = Math.atan2(-R[1][2], R[1][1]); } else { x = Math.atan2(R[2][1], R[2][2]); z = Math.atan2(R[1][0], R[0][0]); }
  const r = v => { const q = Math.round(v * D * 1e6) / 1e6; return q === 0 ? 0 : q; };
  return { x: r(x), y: r(y), z: r(z) };
}
export const boxRotation = box => (box.R ? box.R : rotationMatrix(box.angles?.x, box.angles?.y, box.angles?.z));
// the box's R is exactly the identity (box.R), or all its Euler angles are whole turns (no box.R)
export const boxAligned = box => (box.R ? isExactIdentity(box.R) : isAxisAligned(box.angles));
// the one way to change the orientation: store R, derive the angle readout (exactly 0 for the identity)
export function setBoxRotation(box, R) {
  box.R = R.map(row => row.slice());
  box.angles = isExactIdentity(box.R) ? { x: 0, y: 0, z: 0 } : eulerFromMatrix(box.R);
  return box;
}
export const matVec = (R, v) => [dot3(R[0], v), dot3(R[1], v), dot3(R[2], v)];
export const matCol = (R, c) => [R[0][c], R[1][c], R[2][c]];
const turnZero = v => { const m = (((v || 0) % 360) + 360) % 360; return m < 1e-9 || 360 - m < 1e-9; };
export const isAxisAligned = a => turnZero(a?.x) && turnZero(a?.y) && turnZero(a?.z);

// The default state of the box: axis aligned, in the middle of the volume.
export function defaultCropBox(dims, n = 256) {
  return { n, center: { i: (dims.columns - 1) / 2, j: (dims.rows - 1) / 2, k: (dims.slices - 1) / 2 }, R: IDENTITY3(), angles: { x: 0, y: 0, z: 0 }, interp: DEFAULT_ROTATED_INTERPOLATION };
}
// Axis aligned: the box start is an INTEGER voxel (snap): i0..i0+n-1 and the centre is i0+(n-1)/2.
export function alignedOrigin(box) {
  const h = (box.n - 1) / 2;
  return { i0: Math.round(box.center.i - h) + 0, j0: Math.round(box.center.j - h) + 0, k0: Math.round(box.center.k - h) + 0 }; // + 0: no negative zero
}
// the box as it is exported: aligned boxes are snapped to the voxel grid, rotated boxes keep their (fractional) centre
export function effectiveBox(box) {
  if (!boxAligned(box)) return box;
  const { i0, j0, k0 } = alignedOrigin(box), h = (box.n - 1) / 2;
  return { ...box, center: { i: i0 + h, j: j0 + h, k: k0 + h } };
}
// How far the box may move: the centre stays inside the volume (a box larger than the volume is padded with the fill value)
export function clampCenter(c, dims) {
  const cl = (v, hi) => Math.max(0, Math.min(hi, v));
  return { i: cl(c.i, dims.columns - 1), j: cl(c.j, dims.rows - 1), k: cl(c.k, dims.slices - 1) };
}

// step of one output voxel along the box axes, in INDEX units: stepA (output column), stepB (row), stepC (slice)
export function boxSteps(box, spacing) {
  const R = boxRotation(box);
  const ax = [0, 1, 2].map(a => [0, 1, 2].map(comp => R[comp][a] * spacing[a] / spacing[comp])); // column a of R scaled by spacing[a], then to index units
  return { R, stepA: ax[0], stepB: ax[1], stepC: ax[2] };
}
// source index position of output voxel (a, b, c)
export function sourcePosition(box, steps, a, b, c) {
  const h = (box.n - 1) / 2, ca = a - h, cb = b - h, cc = c - h, o = [box.center.i, box.center.j, box.center.k];
  return [0, 1, 2].map(m => o[m] + steps.stepA[m] * ca + steps.stepB[m] * cb + steps.stepC[m] * cc);
}
// 8 corners of the box (outer faces of the outermost voxels) in INDEX space
export function boxCorners(box, spacing) {
  const { R } = boxSteps(box, spacing), o = [box.center.i, box.center.j, box.center.k], half = box.n / 2, out = [];
  for (let m = 0; m < 8; m++) {
    const off = [(m & 1 ? 1 : -1) * half * spacing[0], (m & 2 ? 1 : -1) * half * spacing[1], (m & 4 ? 1 : -1) * half * spacing[2]], r = matVec(R, off);
    out.push([o[0] + r[0] / spacing[0], o[1] + r[1] / spacing[1], o[2] + r[2] / spacing[2]]);
  }
  return out;
}
export const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
// axis-aligned bounds (index space) of the box, expanded by margin voxels and clamped to the volume; null when it misses the volume
export function sourceBounds(box, spacing, dims, margin = 0) {
  const cs8 = boxCorners(box, spacing), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of cs8) for (let m = 0; m < 3; m++) { lo[m] = Math.min(lo[m], p[m]); hi[m] = Math.max(hi[m], p[m]); }
  const max = [dims.columns - 1, dims.rows - 1, dims.slices - 1];
  const x0 = [0, 1, 2].map(m => Math.max(0, Math.floor(lo[m] - margin))), x1 = [0, 1, 2].map(m => Math.min(max[m], Math.ceil(hi[m] + margin)));
  if ([0, 1, 2].some(m => x1[m] < x0[m])) return null;
  return { x0: x0[0], y0: x0[1], z0: x0[2], x1: x1[0], y1: x1[1], z1: x1[2], w: x1[0] - x0[0] + 1, h: x1[1] - x0[1] + 1, d: x1[2] - x0[2] + 1 };
}

// Cross-section of the box with a slice plane, as a polygon in the plane's own index coordinates:
// axial (i, j) at k = s, coronal (i, k) at j = s, sagittal (j, k) at i = s. [] when the plane misses the box.
const PLANE_AXIS = { axial: 2, coronal: 1, sagittal: 0 }, PLANE_UV = { axial: [0, 1], coronal: [0, 2], sagittal: [1, 2] };
export function planeSection(box, spacing, plane, s) {
  const ax = PLANE_AXIS[plane], [u, v] = PLANE_UV[plane], C = boxCorners(box, spacing), pts = [], eps = 1e-9;
  const d = C.map(p => p[ax] - s);
  for (const [a, b] of BOX_EDGES) {
    const da = d[a], db = d[b];
    if (Math.abs(da) <= eps && Math.abs(db) <= eps) { pts.push([C[a][u], C[a][v]], [C[b][u], C[b][v]]); continue; }
    if (Math.abs(da) <= eps) { pts.push([C[a][u], C[a][v]]); continue; }
    if (Math.abs(db) <= eps) { pts.push([C[b][u], C[b][v]]); continue; }
    if ((da < 0) !== (db < 0)) { const t = da / (da - db); pts.push([C[a][u] + (C[b][u] - C[a][u]) * t, C[a][v] + (C[b][v] - C[a][v]) * t]); }
  }
  const uniq = [];
  for (const p of pts) if (!uniq.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-7)) uniq.push(p);
  if (uniq.length < 3) return uniq.length ? uniq : [];
  const cx = uniq.reduce((a, p) => a + p[0], 0) / uniq.length, cy = uniq.reduce((a, p) => a + p[1], 0) / uniq.length;
  return uniq.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
}
// point-in-convex-or-any polygon (ray casting), used to decide whether a press starts a drag of the box
export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a], [xb, yb] = poly[b];
    if ((ya > pt[1]) !== (yb > pt[1]) && pt[0] < ((xb - xa) * (pt[1] - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

// ---- patient space ----
// series: the app's series object ({slices:[meta], spacingX, spacingY, spacingZ, rows, columns}); meta.pos / meta.orientation as parsed from the headers
export function seriesGeometry(series) {
  const sl = series.slices, f = sl[0] || {}, iop = f.orientation && f.orientation.length >= 6 && f.orientation.slice(0, 6).every(Number.isFinite) ? f.orientation : null;
  const rowDir = iop ? unit3(iop.slice(0, 3)) : [1, 0, 0], colDir = iop ? unit3(iop.slice(3, 6)) : [0, 1, 0], nrm = cross3(rowDir, colDir);
  const havePos = sl.length > 0 && sl.every(s => Array.isArray(s.pos) && s.pos.every(Number.isFinite));
  const spacing = [series.spacingX, series.spacingY, series.spacingZ];
  let sliceDir = nrm;
  if (havePos && sl.length > 1) { const d = unit3([0, 1, 2].map(m => sl[sl.length - 1].pos[m] - sl[0].pos[m])); if (norm3(d) > 0) sliceDir = d; }
  const tiltDeg = Math.acos(Math.min(1, Math.abs(dot3(sliceDir, nrm)))) / RAD;
  const syntheticPos = sl.some(s => s.syntheticPos), sc = series.spacingCheck || null, spacingUniform = !(sc && (sc.missing > 0 || sc.nonUniform)); // sc.missing / nonUniform: slice-spacing.js
  return {
    dims: { columns: series.columns, rows: series.rows, slices: sl.length }, spacing, rowDir, colDir, sliceDir, havePos, tiltDeg,
    origin: havePos ? [...sl[0].pos] : [0, 0, 0], slicePos: havePos ? sl.map(s => [...s.pos]) : null,
    orientation: [...rowDir, ...colDir], hadOrientation: !!iop, syntheticPos, spacingUniform,
    // true when the patient-space geometry is really in the source headers (IPP of every slice, IOP, no per-frame positions made up by the app)
    realGeometry: havePos && !!iop && !syntheticPos,
  };
}
// why the geometry of the exported series is not the source's (null = it is): used for FrameOfReferenceUID and the descriptions
export const syntheticGeometryReason = geom => (!geom.havePos ? 'ImagePositionPatient missing' : !geom.hadOrientation ? 'ImageOrientationPatient missing' : geom.syntheticPos ? 'frame positions of a multi-frame image computed by the viewer' : null);
// null when a rotated crop is allowed, else why not: 'tilt' (gantry tilt), 'geometry' (synthetic / incomplete geometry), 'spacing' (missing or uneven slice spacing)
export function rotationBlockReason(geom) {
  if (geom.tiltDeg > 0.5) return 'tilt';
  if (!geom.realGeometry) return 'geometry';
  if (!geom.spacingUniform) return 'spacing';
  return null;
}
// a series with a gantry tilt (slice direction not perpendicular to the rows / columns), without real position / orientation tags, or with
// missing / uneven slice spacing (patientOf assumes uniform spacing) can be cropped axis aligned only (axis aligned uses the real IPP of every slice)
export const rotationAllowed = geom => rotationBlockReason(geom) === null;
export function patientOf(geom, idx) {
  const [sx, sy, sz] = geom.spacing, o = geom.origin;
  return [0, 1, 2].map(m => o[m] + idx[0] * sx * geom.rowDir[m] + idx[1] * sy * geom.colDir[m] + idx[2] * sz * geom.sliceDir[m]);
}
// position of slice k (integer, may lie outside the series: extrapolated with the slice spacing)
export function slicePatientPos(geom, k) {
  const d = geom.dims.slices;
  if (geom.slicePos) {
    if (k >= 0 && k < d) return geom.slicePos[k];
    const e = k < 0 ? 0 : d - 1;
    return add3(geom.slicePos[e], scale3(geom.sliceDir, (k - e) * geom.spacing[2]));
  }
  return patientOf(geom, [0, 0, k]);
}
// DICOM geometry of the exported series: per slice ImagePositionPatient, and one ImageOrientationPatient
export function exportGeometry(geom, box) {
  const n = box.n, sp = geom.spacing;
  if (boxAligned(box)) {
    const { i0, j0, k0 } = alignedOrigin(box), shift = add3(scale3(geom.rowDir, i0 * sp[0]), scale3(geom.colDir, j0 * sp[1]));
    return { aligned: true, offset: { i0, j0, k0 }, orientation: [...geom.orientation], ipp: Array.from({ length: n }, (_, c) => add3(slicePatientPos(geom, k0 + c), shift)), rowDir: geom.rowDir, colDir: geom.colDir, sliceDir: geom.sliceDir };
  }
  const { R } = boxSteps(box, sp), M = [geom.rowDir, geom.colDir, geom.sliceDir]; // M maps the mm frame to patient directions
  const toPat = v => [0, 1, 2].map(m => M[0][m] * v[0] + M[1][m] * v[1] + M[2][m] * v[2]);
  const rowDir = toPat(matCol(R, 0)), colDir = toPat(matCol(R, 1)), sliceDir = toPat(matCol(R, 2)), h = (n - 1) / 2, centre = patientOf(geom, [box.center.i, box.center.j, box.center.k]);
  const ipp = Array.from({ length: n }, (_, c) => add3(centre, add3(scale3(rowDir, -h * sp[0]), add3(scale3(colDir, -h * sp[1]), scale3(sliceDir, (c - h) * sp[2])))));
  return { aligned: false, orientation: [...rowDir, ...colDir], ipp, rowDir, colDir, sliceDir };
}
