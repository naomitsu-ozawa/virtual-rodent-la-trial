import { describe, it, expect } from 'vitest';
import { suppressThinBoxEdt, edtSq, exteriorAirSlice, airSlice, suppressThinBox, suppressThinMask, BODY_MIN_HU } from '../../docs/thin-suppress.js';

const count = m => m.reduce((a, b) => a + b, 0);

describe('thin-suppress', () => {
  it('edtSq matches brute force with anisotropic spacing', () => {
    const w = 7, h = 5, d = 4, sp = [0.5, 1, 2], f = new Uint8Array(w * h * d);
    f[3 + 2 * w + 1 * w * h] = 1; f[6 + 0 * w + 3 * w * h] = 1;
    const out = edtSq(f, w, h, d, ...sp);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (let i = 0; i < f.length; i++) if (f[i]) {
        const fz = Math.floor(i / (w * h)), fy = Math.floor((i % (w * h)) / w), fx = i % w;
        best = Math.min(best, ((x - fx) * sp[0]) ** 2 + ((y - fy) * sp[1]) ** 2 + ((z - fz) * sp[2]) ** 2);
      }
      expect(out[x + y * w + z * w * h]).toBeCloseTo(best, 4);
    }
  });

  it('exterior air excludes enclosed air', () => {
    const w = 7, h = 7, body = new Uint8Array(w * h);
    for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) body[y * w + x] = 1;
    body[3 * w + 3] = 0; // enclosed hole (lung)
    const ext = exteriorAirSlice(body, w, h);
    expect(ext[0]).toBe(1);
    expect(ext[3 * w + 3]).toBe(0);
    expect(count(ext)).toBe(49 - 25);
  });

  it('A removes the rim next to any air (outside and enclosed) and keeps deeper voxels', () => {
    const w = 12, h = 12, d = 1, n = w * h, sp = [0.1, 0.1, 0.1];
    const values = new Float32Array(n).fill(-1000);
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) values[y * w + x] = -100;
    values[6 * w + 6] = -800; // enclosed air
    const seg = new Uint8Array(n); for (let i = 0; i < n; i++) seg[i] = values[i] >= -250 && values[i] <= -50 ? 1 : 0;
    const out = suppressThinMask(seg, values, w, h, d, sp, { surfaceMm: 0.1, thicknessMm: 0 });
    expect(out[2 * w + 5]).toBe(0); // outer ring gone
    expect(out[3 * w + 5]).toBe(1);
    expect(out[5 * w + 6]).toBe(0); // next to enclosed air (gut gas): removed too
    expect(out[4 * w + 6]).toBe(1);
    expect(count(out)).toBe(count(seg) - 28 - 4);
    expect(BODY_MIN_HU).toBeLessThan(-250);
  });

  it('B removes thin sheets and keeps thick blocks unchanged', () => {
    const w = 20, h = 20, d = 20, sp = [1, 1, 1], seg = new Uint8Array(w * h * d), idx = (x, y, z) => x + y * w + z * w * h;
    for (let z = 2; z < 18; z++) for (let y = 2; y < 18; y++) seg[idx(2, y, z)] = 1; // 1-voxel sheet
    for (let z = 6; z < 14; z++) for (let y = 6; y < 14; y++) for (let x = 8; x < 16; x++) seg[idx(x, y, z)] = 1; // 8³ block
    const out = suppressThinBox(seg, null, w, h, d, sp, { surfaceMm: 0, thicknessMm: 2 });
    expect(out[idx(2, 10, 10)]).toBe(0);
    expect(out[idx(8, 10, 10)]).toBe(1); // block face kept
    expect(out[idx(11, 10, 10)]).toBe(1);
    // a ball opening only rounds the block's edges (radius 1 voxel here)
    expect(count(out)).toBeGreaterThanOrEqual(512 - 96);
    expect(count(out)).toBeLessThanOrEqual(512);
  });

  it('block-wise stack equals one whole-volume box', () => {
    const w = 40, h = 30, d = 25, sp = [0.2, 0.2, 0.3], n = w * h * d, values = new Float32Array(n);
    let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < n; i++) values[i] = rnd() < 0.15 ? -1000 : -100;
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 3 || y < 3) values[x + y * w + z * w * h] = -1000;
    const seg = new Uint8Array(n); for (let i = 0; i < n; i++) seg[i] = values[i] > -500 ? 1 : 0;
    const opts = { surfaceMm: 0.4, thicknessMm: 0.6 };
    const tiled = suppressThinMask(seg, values, w, h, d, sp, opts, { blockDepth: 4, tile: 16 });
    const ext = new Uint8Array(n), plane = w * h;
    for (let z = 0; z < d; z++) {
      const b = new Uint8Array(plane); for (let i = 0; i < plane; i++) b[i] = values[z * plane + i] >= BODY_MIN_HU ? 1 : 0;
      ext.set(airSlice(b), z * plane);
    }
    expect([...tiled]).toEqual([...suppressThinBox(seg, ext, w, h, d, sp, opts)]);
  });

  // radii off the voxel lattice: the float32 reference rounds exact ties
  it('boundary stamping equals the distance-transform reference', () => {
    const w = 24, h = 20, d = 16, n = w * h * d;
    let s = 11; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const seg = new Uint8Array(n), ext = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const v = rnd(); ext[i] = v < 0.1 ? 1 : 0; seg[i] = !ext[i] && v < 0.75 ? 1 : 0; }
    for (const sp of [[1, 1, 1], [0.05, 0.05, 0.08], [0.2, 0.3, 0.5]])
      for (const opts of [{ surfaceMm: sp[0] * 2.1, thicknessMm: 0 }, { surfaceMm: 0, thicknessMm: sp[0] * 3.1 }, { surfaceMm: sp[0] * 1.55, thicknessMm: sp[0] * 4.3 }])
        expect([...suppressThinBox(seg, ext, w, h, d, sp, opts)]).toEqual([...suppressThinBoxEdt(seg, ext, w, h, d, sp, opts)]);
  });

  it('A uses the segment lower bound as the air threshold', () => {
    const w = 12, h = 12, n = w * h, values = new Float32Array(n).fill(-1000);
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) values[y * w + x] = -700;
    const seg = new Uint8Array(n); for (let i = 0; i < n; i++) seg[i] = values[i] >= -800 && values[i] <= -600 ? 1 : 0;
    const out = suppressThinMask(seg, values, w, h, 1, [0.1, 0.1, 0.1], { min: -800, surfaceMm: 0.1, thicknessMm: 0 });
    expect(count(out)).toBe(64 - 28);
  });
});
