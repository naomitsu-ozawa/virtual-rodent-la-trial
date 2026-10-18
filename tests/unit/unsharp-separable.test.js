import { describe, it, expect } from 'vitest';

// The GPU unsharp mask (build 271) replaces the (2r+1)³ cube loop by x and y
// 1D box means and a z mean fused with the sharpening. The clipped box is a
// product of 1D intervals, so the result is the same (up to float rounding).
function cube(src, w, h, d, r) {
  const out = new Float64Array(src.length);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d) continue;
      s += src[Z * w * h + Y * w + X]; c++;
    }
    out[z * w * h + y * w + x] = s / c;
  }
  return out;
}
function separable(src, w, h, d, r) {
  let a = Float64Array.from(src);
  for (let axis = 0; axis < 3; axis++) {
    const b = new Float64Array(a.length);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) {
        const q = [x, y, z]; q[axis] += k; if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[0] >= w || q[1] >= h || q[2] >= d) continue;
        s += a[q[2] * w * h + q[1] * w + q[0]]; c++;
      }
      b[z * w * h + y * w + x] = s / c;
    }
    a = b;
  }
  return a;
}
describe('separable unsharp blur', () => {
  it('equals the cube box mean, including clipped edges', () => {
    const w = 9, h = 7, d = 6; let s = 3; const src = Float64Array.from({ length: w * h * d }, () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 * 2000 - 1000);
    for (const r of [1, 2, 3]) {
      const A = cube(src, w, h, d, r), B = separable(src, w, h, d, r);
      for (let i = 0; i < A.length; i++) expect(B[i]).toBeCloseTo(A[i], 9);
    }
  });
});
