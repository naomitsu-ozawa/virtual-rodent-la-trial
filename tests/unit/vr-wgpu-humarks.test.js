// The HU marks of the general loop's S for the classification-off diagnostic (docs/vr-wgpu-humarks.js): the build program, the exactness of the marks against a brute-force trilinear read (CPU twin), the program's test.
import { describe, it, expect } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { huMarksBuildWgsl, huMarksCpu, huCellMay, HU_MAY_WGSL, HU_EDIT_THRESHOLD, createHuMarkHost } from '../../docs/vr-wgpu-humarks.js';
import { generalWgsl } from '../../docs/vr-wgsl-general.js';
import { coarseDims } from '../../docs/vr-wgpu-coarse-proxy.js';
import { GPU_GLOBALS, recordingDevice } from '../helpers/gpu-call-log.js';

const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// the trilinear read (clamp to edge, texel centres at (i + 0.5) / dim) of one value a texel: f(x, y, z) at the texture coordinate tc of a texture of size dims
const tri = (f, dims, tc) => {
  const p = tc.map((v, k) => v * dims[k] - 0.5), fl = p.map(Math.floor), r = p.map((v, k) => v - fl[k]); let s = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    s += (dx ? r[0] : 1 - r[0]) * (dy ? r[1] : 1 - r[1]) * (dz ? r[2] : 1 - r[2]) * f(Math.min(dims[0] - 1, Math.max(0, fl[0] + dx)), Math.min(dims[1] - 1, Math.max(0, fl[1] + dy)), Math.min(dims[2] - 1, Math.max(0, fl[2] + dz)));
  }
  return s;
};
const nearest = (f, dims, tc) => f(...tc.map((v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor(v * dims[k])))));

describe('the program texts', () => {
  it('the build program parses and keeps the footprint of the classification marks (cells of 4, one texel of dilation) and the edit footprint of its own grid', () => {
    const t = huMarksBuildWgsl(); expect(() => new WgslReflect(t)).not.toThrow();
    expect(t).toContain('texture_storage_3d<rgba16uint,write>'); expect(t).toContain('z<=4*t.z+4'); expect(t).toContain('lo=min(lo,v);hi=max(hi,v);');
  });
  it('the test function parses inside the general text and is used before the sample\'s read (skip text of the data\'s own value, with and without sections and features)', () => {
    expect(HU_MAY_WGSL).toContain(String(HU_EDIT_THRESHOLD) + 'u');
    for (const events of [false, true]) for (const feat of [null, { R: true, C: true }]) {
      const t = generalWgsl({ src: 'hu', skip: true, events, feat }); expect(() => new WgslReflect(t)).not.toThrow();
      expect(t).toContain('fn huCellMay('); expect(t.indexOf('if(!huCellMay(mt)){')).toBeGreaterThan(0); expect(t.indexOf('if(!huCellMay(mt)){')).toBeLessThan(t.indexOf('let idx=segIdxG(tc0);'));
      expect(t).toContain('let markDims=vec3<f32>(textureDimensions(vol));'); expect(t).toContain('textureLoad(markTex,mc,0)');
      expect(t).toContain(feat ? '{prevValid=true;prevSkip=true;lastIndex=-1;prevHid=false;previousT=t;t=nextT;continue;}' : '{prevValid=true;prevSkip=true;lastIndex=-1;previousT=t;t=nextT;continue;}');
    }
    expect(generalWgsl({ src: 'hu' }).includes('huCellMay')).toBe(false);
  });
});

// a data set: raw values (two bytes a texel) in blobs and noise, an edit texture of its own size (or another) with the masks of slots
const scene = (rnd, dims, eDims, eC) => {
  const [W, H, D] = dims, n = W * H * D, vol = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) { const v = rnd() < 0.998 ? 1000 + Math.floor(rnd() * 300) : 2000 + Math.floor(rnd() * 2500); vol[i * 2] = v & 255; vol[i * 2 + 1] = v >> 8; }
  for (let b = 0; b < 3; b++) { const c = [rnd() * W, rnd() * H, rnd() * D]; for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - c[0], y - c[1], z - c[2]) < 3) { const i = (z * H + y) * W + x, v = 3500 + b * 200; vol[i * 2] = v & 255; vol[i * 2 + 1] = v >> 8; } }
  const en = eDims[0] * eDims[1] * eDims[2], data = new Uint8Array(en * eC);
  for (let i = 0; i < en * eC; i++) data[i] = rnd() < 0.05 ? 255 : Math.floor(rnd() * 90);
  return { vol, edit: { data, C: eC, dims: eDims } };
};

describe('the marks are exact: a sample the marks skip would not have been inside any shown slot', () => {
  it('random data (sizes that are no multiple of 4, an edit texture of the same size, a smaller one and a 1 x 1 x 1 one), every kind of slot (range, range with an edit gate, the mask alone): whenever huCellMay is false the program\'s read finds no shown slot inside (linear and nearest edit reads)', () => {
    const rnd = mulberry(5);
    for (const [dims, eDims, eC] of [[[16, 12, 20], [16, 12, 20], 4], [[13, 9, 11], [7, 5, 6], 4], [[12, 12, 12], [1, 1, 1], 4], [[10, 14, 9], [10, 14, 9], 2]]) {
      const { vol, edit } = scene(rnd, dims, eDims, eC), m = huMarksCpu({ vol, dims, edit }), cd = coarseDims(dims);
      const calib = [0.5, -1024, 0];
      const raw = (x, y, z) => { const i = (z * dims[1] + y) * dims[0] + x; return vol[i * 2] + 256 * vol[i * 2 + 1]; };
      const ev = (c, x, y, z) => { const i = (z * eDims[1] + y) * eDims[0] + x; return (c < eC ? edit.data[i * eC + c] : c === 3 ? 255 : 0) / 255; };
      const segA = [[100, 450, 1, 1], [800, 1000, 1, 1], [-2000, -1900, 1, 1], [-100, 0, 1, 0]]; // slot 3 is not shown
      let skipped = 0, kept = 0;
      for (const [editMask, editMaskOnly] of [[0, 0], [5, 0], [15, 0], [6, 4], [0, 8], [3, 2]]) {
        const check = tc => {
          const v = tc.map((x, k) => x * dims[k]), c = [0, 1, 2].map(k => Math.min(Math.floor(v[k] / 4), cd[k] - 1)), o = ((c[2] * cd[1] + c[1]) * cd[0] + c[0]) * 6, cell = Array.from(m.subarray(o, o + 6));
          const may = huCellMay(cell, { segA, calib, editMask, editMaskOnly });
          if (may) { kept++; return; }
          skipped++;
          const rawV = tri(raw, dims, tc), hu = (rawV - calib[2]) * calib[0] + calib[1];
          for (const rd of [tri, nearest]) for (let s = 0; s < 4; s++) {
            if (!(segA[s][3] > 0.5)) continue;
            const edOk = !((editMask >> s) & 1) || rd((x, y, z) => ev(s, x, y, z), eDims, tc) >= 0.5, inside = ((editMaskOnly >> s) & 1) || (hu >= segA[s][0] && hu <= segA[s][1]);
            expect(edOk && inside, 'slot ' + s + ' at ' + tc.join()).toBe(false);
          }
        };
        for (let i = 0; i < 2500; i++) check([Math.min(0.999999, rnd()), Math.min(0.999999, rnd()), Math.min(0.999999, rnd())]);
        for (let i = 0; i < 1500; i++) check([0, 1, 2].map(k => { const b = 4 * Math.floor(rnd() * (cd[k] + 1)); return Math.min(0.999999, Math.max(0, (b + (rnd() < 0.5 ? 0 : (rnd() - 0.5) * 1e-3)) / dims[k])); }));
      }
      expect(skipped).toBeGreaterThan(0); expect(kept).toBeGreaterThan(0); // (the test has teeth: cells that are skipped and cells that are not)
    }
  });
  it('the range and the edit maxima are what they say: one texel sets them in the cells whose footprint holds it, a byte of 125 does not open an edit gate and 126 does', () => {
    const dims = [16, 16, 16], vol = new Uint8Array(16 ** 3 * 2), i = (5 * 16 + 6) * 16 + 7;
    vol[i * 2] = 0x34; vol[i * 2 + 1] = 0x12;
    const m = huMarksCpu({ vol, dims }), cd = coarseDims(dims), hit = [];
    for (let cz = 0; cz < 4; cz++) for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) if (m[((cz * 4 + cy) * 4 + cx) * 6 + 1] === 0x1234) hit.push([cx, cy, cz].join());
    expect(hit.sort()).toEqual(['1,1,1', '2,1,1']); expect(cd).toEqual([4, 4, 4]);
    expect(m[0]).toBe(0); // (an edit-less texture reads zeros in the slots 0..2 and one in the slot 3)
    const cell = [0, 100, 124, 125, 126, 255], seg = [[0, 1e9, 1, 1], [0, 1e9, 1, 1], [0, 1e9, 1, 1], [0, 1e9, 1, 1]], c = { segA: seg, calib: [1, 0, 0] };
    expect(HU_EDIT_THRESHOLD).toBe(126);
    expect(huCellMay(cell, { ...c, editMask: 1 })).toBe(true); // slots 1..3 are free of the mask
    expect(huCellMay(cell, { ...c, editMask: 15 })).toBe(true); // slot 3 holds 255
    expect(huCellMay([0, 100, 124, 125, 126, 125], { ...c, editMask: 15 })).toBe(true); // slot 2 holds 126
    expect(huCellMay([0, 100, 124, 125, 125, 125], { ...c, editMask: 15 })).toBe(false);
  });
  it('a segment whose range misses the cell by more than the rounding margin is skipped, one that touches it is not (a negative calibration slope too)', () => {
    const seg = lo => [[lo, lo + 10, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (const calib of [[1, 0, 0], [-1, 100, 0], [0.5, -1024, 0], [1, 0, 10]]) {
      const cell = [1000, 1200, 0, 0, 0, 0], h = r => (r - calib[2]) * calib[0] + calib[1], lo = Math.min(h(1000), h(1200)), hi = Math.max(h(1000), h(1200));
      expect(huCellMay(cell, { segA: seg(hi + 5), calib })).toBe(false); expect(huCellMay(cell, { segA: seg(hi - 5), calib })).toBe(true);
      expect(huCellMay(cell, { segA: seg(lo - 30), calib })).toBe(false); expect(huCellMay(cell, { segA: seg(lo - 5), calib })).toBe(true);
    }
  });
});

describe('the host on a recording device', () => {
  it('makes the marks whole once for a pair of textures and again only when a write number changes; the failed or pending program says wait / failed', async () => {
    Object.assign(globalThis, GPU_GLOBALS);
    const rec = recordingDevice(); const host = createHuMarkHost({ device: rec.device, bgl: {}, onShader: null, tag: 't' });
    const tex = () => rec.device.createTexture({ size: [16, 16, 16], dimension: '3d', format: 'rg8unorm', usage: 1 });
    const F = (g, e) => ({ enc: null, vol: { tex: {}, gen: g, gpu: tex(), dims: [16, 16, 16] }, edit: { tex: {}, gen: e, gpu: tex(), dims: [16, 16, 16] } });
    expect(host.prepare(F(1, 1))).toBe('wait');
    await new Promise(r => setTimeout(r, 20));
    const n0 = host.state.builds; expect(host.prepare(F(1, 1))).toBe('ready'); expect(host.state.builds).toBe(n0 + 1);
    expect(host.prepare(F(1, 1))).toBe('ready'); expect(host.state.builds).toBe(n0 + 1);
    expect(host.prepare(F(1, 2))).toBe('ready'); expect(host.state.builds).toBe(n0 + 2);
    expect(host.prepare(F(2, 2))).toBe('ready'); expect(host.state.builds).toBe(n0 + 3);
    expect(host.group()).toBeTruthy(); host.destroy(); expect(host.markTex).toBe(null);
  });
});
