// Resampling of a rotated crop box (pure: no DOM; unit-tested in tests/unit/crop-resample.test.js).
// Source samples are the STORED integers (crop-source.js). Interpolation is done on them directly (RescaleSlope / Intercept are linear, so
// the result equals interpolating the calibrated values), then rounded to an integer and clamped to the stored range.
// - nearest: the nearest source voxel (only original values appear).
// - linear: trilinear, 8 voxels.
// - cubic: cubic convolution (Catmull-Rom), 4x4x4 voxels, interpolating, no pre-filter. It is NOT a B-spline (a B-spline needs a
//   pre-filtered copy of the whole source region, too much memory for large volumes); it can overshoot, hence the clamp.
// A position inside the source volume (index -0.5 .. size-0.5 per axis, i.e. within the outer faces of the outermost voxels) is sampled
// (neighbours outside are replaced by the nearest voxel); a position outside gets the fill value.
import { boxSteps, sourcePosition } from './crop-geometry.js?v=20261019-build623';

const NEAREST_EPS = 1e-7;
// block: a sub-box of the source {x0,y0,z0,w,h,d,data} (data[(z*h+y)*w+x], z/y/x relative to x0/y0/z0); dims: the whole source {columns,rows,slices}
export function createSampler(block, dims, interp, fill, range) {
  const { x0, y0, z0, w, h, d, data } = block, W = dims.columns, H = dims.rows, D = dims.slices, [lo, hi] = range;
  const at = (x, y, z) => { // clamped to the volume, then (defensively) to the block
    x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y; z = z < 0 ? 0 : z > D - 1 ? D - 1 : z;
    x -= x0; y -= y0; z -= z0;
    x = x < 0 ? 0 : x > w - 1 ? w - 1 : x; y = y < 0 ? 0 : y > h - 1 ? h - 1 : y; z = z < 0 ? 0 : z > d - 1 ? d - 1 : z;
    return data[(z * h + y) * w + x];
  };
  const inside = (x, y, z) => x >= -0.5 - NEAREST_EPS && x < W - 0.5 + NEAREST_EPS && y >= -0.5 - NEAREST_EPS && y < H - 0.5 + NEAREST_EPS && z >= -0.5 - NEAREST_EPS && z < D - 0.5 + NEAREST_EPS;
  const clampRound = v => { v = Math.round(v); return v < lo ? lo : v > hi ? hi : v; };
  if (interp === 'nearest') {
    return (x, y, z) => (inside(x, y, z) ? at(Math.floor(x + 0.5 + NEAREST_EPS), Math.floor(y + 0.5 + NEAREST_EPS), Math.floor(z + 0.5 + NEAREST_EPS)) : fill);
  }
  if (interp === 'linear') {
    return (x, y, z) => {
      if (!inside(x, y, z)) return fill;
      const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z), tx = x - fx, ty = y - fy, tz = z - fz;
      const c000 = at(fx, fy, fz), c100 = at(fx + 1, fy, fz), c010 = at(fx, fy + 1, fz), c110 = at(fx + 1, fy + 1, fz);
      const c001 = at(fx, fy, fz + 1), c101 = at(fx + 1, fy, fz + 1), c011 = at(fx, fy + 1, fz + 1), c111 = at(fx + 1, fy + 1, fz + 1);
      const a = (c000 * (1 - tx) + c100 * tx) * (1 - ty) + (c010 * (1 - tx) + c110 * tx) * ty, b = (c001 * (1 - tx) + c101 * tx) * (1 - ty) + (c011 * (1 - tx) + c111 * tx) * ty;
      return clampRound(a * (1 - tz) + b * tz);
    };
  }
  if (interp === 'cubic') {
    const wt = t => [(-t * t * t + 2 * t * t - t) / 2, (3 * t * t * t - 5 * t * t + 2) / 2, (-3 * t * t * t + 4 * t * t + t) / 2, (t * t * t - t * t) / 2]; // Catmull-Rom
    return (x, y, z) => {
      if (!inside(x, y, z)) return fill;
      const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z), wx = wt(x - fx), wy = wt(y - fy), wz = wt(z - fz);
      let acc = 0;
      for (let k = 0; k < 4; k++) {
        let accY = 0;
        for (let j = 0; j < 4; j++) {
          let accX = 0;
          for (let i = 0; i < 4; i++) accX += wx[i] * at(fx - 1 + i, fy - 1 + j, fz - 1 + k);
          accY += wy[j] * accX;
        }
        acc += wz[k] * accY;
      }
      return clampRound(acc);
    };
  }
  throw new Error('Unknown interpolation: ' + interp);
}

// One output slice c of a ROTATED box (n*n values, row-major: b rows of a columns), into out (storage typed array).
export function resampleSlice(box, spacing, sampler, c, out) {
  const n = box.n, steps = boxSteps(box, spacing), p0 = sourcePosition(box, steps, 0, 0, c), { stepA, stepB } = steps;
  let o = 0;
  for (let b = 0; b < n; b++) {
    let x = p0[0] + stepB[0] * b, y = p0[1] + stepB[1] * b, z = p0[2] + stepB[2] * b;
    for (let a = 0; a < n; a++) { out[o++] = sampler(x, y, z); x += stepA[0]; y += stepA[1]; z += stepA[2]; }
  }
  return out;
}

// One output slice of an AXIS ALIGNED box: a plain copy of the source rectangle (no arithmetic on the values), the part outside the
// source gets the fill value. src: the stored slice (columns*rows) or null when the slice lies outside the volume.
export function copyAlignedSlice(src, columns, rows, i0, j0, n, fill, out) {
  if (!src) { out.fill(fill); return out; }
  for (let b = 0; b < n; b++) {
    const j = j0 + b, row = b * n;
    if (j < 0 || j >= rows) { out.fill(fill, row, row + n); continue; }
    const a0 = Math.max(0, -i0), a1 = Math.min(n, columns - i0); // output columns that have a source column
    if (a0 > 0) out.fill(fill, row, row + Math.min(a0, n));
    if (a1 > a0) out.set(src.subarray(j * columns + i0 + a0, j * columns + i0 + a1), row + a0);
    if (a1 < n) out.fill(fill, row + Math.max(a1, 0), row + n);
  }
  return out;
}
