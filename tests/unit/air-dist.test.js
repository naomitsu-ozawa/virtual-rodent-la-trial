import { describe, it, expect } from 'vitest';
import { suppressThinBox } from '../../docs/thin-suppress.js';

// JS mirror of the 'airDist' compute shader (gpu-shaders.js): three passes, one
// axis each, compose the exact squared distance to the nearest air voxel within
// the radius; segment voxels keep g >= 0, others store -(g+1) between passes.
function airDistPasses(values, w, h, d, min, max, sp, n, pruned = true) {
  const idx = (x, y, z) => z * w * h + y * w + x, N = w * h * d;
  let src = Float32Array.from(values);
  for (let axis = 0; axis < 3; axis++) {
    const dst = new Float32Array(N);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = idx(x, y, z), inSeg = axis === 0 ? (src[i] >= min && src[i] <= max) : src[i] >= 0;
      let g = 1e30;
      // build 313 shader order: |k| ascending, stop once (k*s)^2 >= g
      for (let m = 0; m <= 2 * n[axis]; m++) {
        const k = m % 2 === 0 ? m / 2 : -(m + 1) / 2;
        if (pruned && (k * sp[axis]) ** 2 >= g) break;
        const q = [x, y, z]; q[axis] += k;
        if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[0] >= w || q[1] >= h || q[2] >= d) continue;
        const e = src[idx(...q)], dd = k * sp[axis];
        if (axis === 0) { if (e < min) g = Math.min(g, dd * dd); }
        else g = Math.min(g, (e < 0 ? -e - 1 : e) + dd * dd);
      }
      dst[i] = inSeg ? g : -(g + 1);
    }
    src = dst;
  }
  return src;
}

describe('airDist separable distance field', () => {
  it('pruned scan equals the full scan (build 313)', () => {
    const w = 16, h = 13, d = 10, sp = [0.04, 0.04, 0.08], N = w * h * d;
    let s = 9; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const values = new Float32Array(N); for (let i = 0; i < N; i++) { const r = rnd(); values[i] = r < 0.25 ? -1000 : r < 0.75 ? -600 : 50; }
    const n = [4, 4, 2];
    expect([...airDistPasses(values, w, h, d, -700, -500, sp, n, true)]).toEqual([...airDistPasses(values, w, h, d, -700, -500, sp, n, false)]);
  });
  it('equals brute force for segment voxels within the radius', () => {
    const w = 14, h = 12, d = 9, sp = [0.04, 0.04, 0.08], min = -700, max = -500, N = w * h * d;
    let s = 5; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const values = new Float32Array(N); for (let i = 0; i < N; i++) { const r = rnd(); values[i] = r < 0.2 ? -1000 : r < 0.7 ? -600 : 50; }
    const maxMm = 3 * 0.04, n = sp.map(v => Math.floor(maxMm / v + 1e-9));
    const out = airDistPasses(values, w, h, d, min, max, sp, n);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = z * w * h + y * w + x, inSeg = values[i] >= min && values[i] <= max;
      if (!inSeg) { expect(out[i]).toBeLessThan(0); continue; }
      let best = Infinity;
      for (let dz = -n[2]; dz <= n[2]; dz++) for (let dy = -n[1]; dy <= n[1]; dy++) for (let dx = -n[0]; dx <= n[0]; dx++) {
        const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d) continue;
        if (values[Z * w * h + Y * w + X] < min) best = Math.min(best, (dx * sp[0]) ** 2 + (dy * sp[1]) ** 2 + (dz * sp[2]) ** 2);
      }
      // within the slider range the value is exact; beyond it only "farther" matters
      if (best <= maxMm * maxMm * (1 + 1e-5)) expect(out[i]).toBeCloseTo(best, 6);
      else expect(out[i]).toBeGreaterThan(maxMm * maxMm);
    }
  });
});

// JS mirror of the opening passes (airDist modes 1 and 2, gpuOpenRuns): erosion
// distance on a 0/1 mask, distance to the eroded core, kept = g <= r².
function openPasses(mask, w, h, d, sp, r) {
  const idx = (x, y, z) => z * w * h + y * w + x, N = w * h * d, r2 = r * r, n = sp.map(s => Math.floor(r / s + 1e-9));
  const run = (src, mode) => {
    for (let axis = 0; axis < 3; axis++) {
      const dst = new Float32Array(N);
      for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = idx(x, y, z), inSeg = axis === 0 && mode === 1 ? src[i] > 0.5 : src[i] >= 0;
        let g = 1e30;
        for (let k = -n[axis]; k <= n[axis]; k++) {
          const q = [x, y, z]; q[axis] += k;
          if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[0] >= w || q[1] >= h || q[2] >= d) continue;
          const e = src[idx(...q)], dd = k * sp[axis];
          if (axis === 0) { const f = mode === 1 ? e <= 0.5 : e >= 0 && e > r2; if (f) g = Math.min(g, dd * dd); }
          else g = Math.min(g, (e < 0 ? -e - 1 : e) + dd * dd);
        }
        dst[i] = inSeg ? g : -(g + 1);
      }
      src = dst;
    }
    return src;
  };
  const field = run(run(Float32Array.from(mask), 1), 2), out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = field[i] >= 0 && field[i] <= r2 * (1 + 1e-5) ? 1 : 0;
  return out;
}

describe('GPU opening (thin-part removal) mirror', () => {
  it('equals the CPU ball-stamping kernel', () => {
    const w = 16, h = 14, d = 10, N = w * h * d;
    let s = 9; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = rnd() < 0.7 ? 1 : 0;
    for (const sp of [[1, 1, 1], [0.04, 0.04, 0.08]]) for (const t of [sp[0] * 2.3, sp[0] * 4.1]) {
      const gpu = openPasses(mask, w, h, d, sp, t / 2), cpu = suppressThinBox(mask, null, w, h, d, sp, { surfaceMm: 0, thicknessMm: t });
      expect([...gpu]).toEqual([...cpu]);
    }
  });
});


// JS mirror of 'airDistX' (build 316): the axis-0 pass reading its neighbours
// from a per-workgroup tile [base-n, base+WG+n) of the flat buffer instead of
// the storage buffer. Must equal the axis-0 pass of airDist for any WG / width.
function airDistXTiled(src, w, h, d, min, max, s, n, WG, mode = 0, r2 = 0) {
  const N = w * h * d, out = new Float32Array(N);
  for (let base = 0; base < N; base += WG) {
    const tile = new Float32Array(WG + 2 * n);
    for (let j = 0; j < WG + 2 * n; j++) { const p = base - n + j; tile[j] = p >= 0 && p < N ? src[p] : 0; }
    for (let l = 0; l < WG; l++) {
      const i = base + l; if (i >= N) break;
      const cx = i % w, own = tile[l + n];
      const inSeg = mode === 0 ? own >= min && own <= max : mode === 1 ? own > 0.5 : own >= 0;
      let g = 1e30;
      for (let m = 0; m <= 2 * n; m++) {
        const k = m % 2 === 0 ? m / 2 : -(m + 1) / 2, dd = k * s;
        if (dd * dd >= g) break;
        const qx = cx + k; if (qx < 0 || qx >= w) continue;
        const e = tile[l + n + k];
        const feature = mode === 0 ? e < min : mode === 1 ? e <= 0.5 : e >= 0 && e > r2;
        if (feature) g = Math.min(g, dd * dd);
      }
      out[i] = inSeg ? g : -(g + 1);
    }
  }
  return out;
}
function airDistAxis0(src, w, h, d, min, max, s, n, mode = 0, r2 = 0) {
  const N = w * h * d, out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const cx = i % w, v = src[i];
    const inSeg = mode === 0 ? v >= min && v <= max : mode === 1 ? v > 0.5 : v >= 0;
    let g = 1e30;
    for (let m = 0; m <= 2 * n; m++) {
      const k = m % 2 === 0 ? m / 2 : -(m + 1) / 2, dd = k * s;
      if (dd * dd >= g) break;
      const qx = cx + k; if (qx < 0 || qx >= w) continue;
      const e = src[i + k];
      const feature = mode === 0 ? e < min : mode === 1 ? e <= 0.5 : e >= 0 && e > r2;
      if (feature) g = Math.min(g, dd * dd);
    }
    out[i] = inSeg ? g : -(g + 1);
  }
  return out;
}
describe('airDistX tiled x pass (build 316)', () => {
  it.each([[16, 64, 4], [37, 64, 8], [100, 128, 8], [13, 256, 64], [300, 64, 30]])('w=%i WG=%i n=%i equals the untiled pass', (w, WG, n) => {
    const h = 5, d = 3, N = w * h * d;
    let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ct = new Float32Array(N); for (let i = 0; i < N; i++) { const r = rnd(); ct[i] = r < 0.1 ? -1000 : r < 0.8 ? -600 : 50; }
    expect([...airDistXTiled(ct, w, h, d, -700, -500, 0.04, n, WG)]).toEqual([...airDistAxis0(ct, w, h, d, -700, -500, 0.04, n)]);
    const mask = ct.map(v => (v > -700 ? 1 : 0));
    expect([...airDistXTiled(mask, w, h, d, 0, 1, 0.04, n, WG, 1)]).toEqual([...airDistAxis0(mask, w, h, d, 0, 1, 0.04, n, 1)]);
    const enc = ct.map((v, i) => (v > -700 ? (i % 7) * 0.001 : -1 - (i % 5) * 0.001));
    expect([...airDistXTiled(enc, w, h, d, 0, 1, 0.04, n, WG, 2, 0.003)]).toEqual([...airDistAxis0(enc, w, h, d, 0, 1, 0.04, n, 2, 0.003)]);
  });
});
