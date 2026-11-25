// The skip marks of S / OS / EvS (docs/vr-wgpu-marks.js): the program texts, the exactness of the marks against a brute-force trilinear read, and the host on a recording device.
import { describe, it, expect, vi } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl } from '../../docs/vr-wgsl-core.js';
import { coarseVolumeWgsl, coarseDims, packedDims, coarseGridCpu, coarseProxyWgsl } from '../../docs/vr-wgpu-coarse-proxy.js';
import { skipText, skipSub, SKIP_ANCHORS, marksBuildWgsl, marksCpu, alphaGridCpu, marksRowsOf, createMarkHost, MARK_GROUP } from '../../docs/vr-wgpu-marks.js';
import { GPU_GLOBALS, recordingDevice } from '../helpers/gpu-call-log.js';

const lines = t => t.split('\n').filter(l => !/^\/\/ VR \/ AR volume pass/.test(l));
const isSubsequence = (small, big) => { let j = 0; for (const l of big) if (j < small.length && l === small[j]) j++; return j === small.length; };

describe('the programs', () => {
  for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const kind of ['S', 'EvS', 'OS']) {
    it((f16 ? 'f16 ' : 'f32 ') + (cls4 ? 'c4 ' : 'c3 ') + kind + ': every anchor is found once, the text parses, and it is the display text with lines added only (every line of the display text is still there, in order)', () => {
      const o = kind === 'S' ? { events: false } : kind === 'EvS' ? { events: true } : { tiles: true };
      const t = skipText({ f16, cls4, ...o }), base = o.tiles ? coarseVolumeWgsl({ f16, cls4 }, 4) : volumeWgsl({ f16, cls4, events: o.events });
      expect(() => new WgslReflect(t)).not.toThrow();
      expect(isSubsequence(lines(base), lines(t))).toBe(true);
      expect(t).toContain('prevValid=true;prevSkip=true;lastIndex=-1;previousT=t;k++;continue;'); // what the display's own read of a sample outside every shown segment does, plus prevSkip (the hit path fetches the previous sample's value)
      expect(t).toContain('if(u.jumpOn==0){'); expect(t).toContain('(mt[mc.x%4]&shownMask)==0u');
      expect(/k>=4096/.test(t)).toBe(kind === 'OS');
    });
  }
  it('the section-plane program has no tile walk', () => { expect(() => skipText({ events: true, tiles: true })).toThrow(/tiles/); });
  it('an anchor that is not there (or is there twice) throws', () => {
    expect(() => skipSub('nothing', {})).toThrow(/anchor/);
    const t = volumeWgsl({ f16: false, cls4: false, events: false });
    expect(() => skipSub(t.replace(SKIP_ANCHORS.sample, SKIP_ANCHORS.sample + SKIP_ANCHORS.sample), {})).toThrow(/found 2 times/);
  });
  it('the skip is made before the sample is read and the inserted block never changes anything but the sample it skips (a frame with jumps never reaches it)', () => {
    const t = skipText({ f16: false, cls4: false, events: false }), a = t.indexOf('let mc=min('), b = t.indexOf('var q=textureSampleLevel(clsTex,smp,tcS,0.0)');
    expect(a).toBeGreaterThan(0); expect(a).toBeLessThan(b);
    const block = t.slice(t.indexOf('  if(u.jumpOn==0){\n   let mc'), t.indexOf('var q=textureSampleLevel(clsTex,smp,tcS,0.0)'));
    expect(block).not.toContain('texDims'); expect(t).toContain('let markDims=vec3<f32>(textureDimensions(clsTex));'); // the cell is found with the texture's own size (the marks are made from it), not with a uniform
    expect(block.replace(/let [a-z]+=[^;]*;/g, '').replace(/\{|\}|if\([^)]*\)|\(|\)/g, '').trim()).toContain('prevValid=true;prevSkip=true;lastIndex=-1;previousT=t;k++;continue;');
  });
  it('the build program parses (c3 / c4), uses the pre-pass\'s own threshold and ORs bits (no minimum)', () => {
    for (const cls4 of [false, true]) { const t = marksBuildWgsl({ cls4 }); expect(() => new WgslReflect(t)).not.toThrow(); expect(t).toContain('q[c]>=0.498'); expect(t).toContain('m.x=m.x|v;'); expect(t).toContain('c<4'); expect(t.includes('textureLoad(cls4Tex')).toBe(cls4); }
  });
});

// a brute-force trilinear read of channel c at a texture coordinate (clamp to edge, the texel centre at (i + 0.5) / dim)
const tri = (data, dims, c, tc, cls4 = null) => {
  const [W, H, D] = dims, p = [tc[0] * W - 0.5, tc[1] * H - 0.5, tc[2] * D - 0.5], f = p.map(Math.floor), r = p.map((v, k) => v - f[k]); let s = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const x = Math.min(W - 1, Math.max(0, f[0] + dx)), y = Math.min(H - 1, Math.max(0, f[1] + dy)), z = Math.min(D - 1, Math.max(0, f[2] + dz)), i = (z * H + y) * W + x;
    s += (dx ? r[0] : 1 - r[0]) * (dy ? r[1] : 1 - r[1]) * (dz ? r[2] : 1 - r[2]) * ((c === 3 && cls4 ? cls4[i] : data[i * 4 + c]) / 255);
  }
  return s;
};
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

describe('the marks are exact: a sample the marks skip would not have been inside any shown segment', () => {
  it('on random class volumes (c3 and c4, sizes that are no multiple of 4), at random points, at cell boundaries and at the edges of the texture: whenever (cell marks & shown channels) == 0 the trilinear read of every shown channel is below 0.5', () => {
    const rnd = mulberry(7);
    for (const [dims, cls4On] of [[[16, 12, 20], false], [[13, 9, 11], true], [[8, 8, 8], true]]) {
      const [W, H, D] = dims, n = W * H * D, data = new Uint8Array(n * 4), cls4 = new Uint8Array(n);
      for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = rnd() < 0.04 ? 255 : Math.floor(rnd() * 100); data[i * 4 + 3] = Math.floor(rnd() * 255); cls4[i] = rnd() < 0.03 ? 255 : Math.floor(rnd() * 100); }
      // grow a few blobs so there are cells with and without marks
      for (let b = 0; b < 3; b++) { const cx = Math.floor(rnd() * W), cy = Math.floor(rnd() * H), cz = Math.floor(rnd() * D); for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy, z - cz) < 2.5) data[((z * H + y) * W + x) * 4 + (b % 3)] = 255; }
      const m = marksCpu({ data, dims, cls4: cls4On ? cls4 : null }), cd = coarseDims(dims), nCh = 4; // (channel 3 without a fourth class texture is the alpha: a classification-only texture of a four-segment data set)
      let skipped = 0, kept = 0;
      const check = tc => {
        const v = [tc[0] * W, tc[1] * H, tc[2] * D], c = [0, 1, 2].map(k => Math.min(Math.floor(v[k] / 4), cd[k] - 1)), mark = m[(c[2] * cd[1] + c[1]) * cd[0] + c[0]];
        for (let shown = 0; shown < (1 << nCh); shown++) {
          if ((mark & shown) !== 0) continue; skipped++;
          for (let ch = 0; ch < nCh; ch++) if (shown & (1 << ch)) expect(tri(data, dims, ch, tc, cls4On ? cls4 : null)).toBeLessThan(0.5);
        }
        if (mark) kept++;
      };
      for (let i = 0; i < 6000; i++) check([Math.min(0.999999, rnd()), Math.min(0.999999, rnd()), Math.min(0.999999, rnd())]);
      for (let i = 0; i < 3000; i++) { // on and a hair off the cell boundaries, and at the texture's edges
        const tc = [0, 1, 2].map(k => { const d = dims[k], b = 4 * Math.floor(rnd() * (cd[k] + 1)); return Math.min(0.999999, Math.max(0, (b + (rnd() < 0.5 ? 0 : (rnd() - 0.5) * 1e-3)) / d)); });
        check(tc);
      }
      expect(skipped).toBeGreaterThan(0); expect(kept).toBeGreaterThan(0); // (the test has teeth: cells with marks exist, and cells without)
    }
  });
  it('the marks are what the threshold says: a texel at 0.5 - classMargin (byte 127) sets its channel in the 6 x 6 x 6 cells around it, a texel at byte 126 does not', () => {
    const dims = [16, 16, 16], n = 16 ** 3, data = new Uint8Array(n * 4), i = (5 * 16 + 6) * 16 + 7;
    data[i * 4 + 1] = 126; expect(marksCpu({ data, dims }).every(v => v === 0)).toBe(true);
    data[i * 4 + 1] = 127; const m = marksCpu({ data, dims }); const set = [];
    for (let cz = 0; cz < 4; cz++) for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) if (m[(cz * 4 + cy) * 4 + cx] === 2) set.push([cx, cy, cz].join());
    // x = 7 is in the footprint of cells 1 (texels 3..8) and 2 (7..12); y = 6: cells 1 (3..8) and 2 (7..12) -> 6 is in 1 only (7 > 6), and cell 0 (-1..4) no; z = 5: cells 1 only (3..8)
    expect(set.sort()).toEqual(['1,1,1', '2,1,1']);
  });
  it('the rows of cells a write touches (marksRowsOf): exactly the cells whose footprint reaches the slices, clamped to the grid', () => {
    const dims = [32, 32, 64], n = coarseDims(dims)[2];
    for (const [z0, z1] of [[0, 1], [10, 12], [3, 5], [4, 5], [60, 64], [0, 64], [31, 33]]) {
      const [a, b] = marksRowsOf(z0, z1, dims), want = []; for (let cz = 0; cz < n; cz++) { const lo = Math.max(0, 4 * cz - 1), hi = Math.min(63, 4 * cz + 4); if (lo <= z1 - 1 && hi >= z0) want.push(cz); }
      expect([a, b]).toEqual([want[0], want[want.length - 1] + 1]);
    }
  });
});

describe('the two grids give the older grid\'s value for every shown set (a tissue switch makes nothing again)', () => {
  it('D = (marks & shown channels) ? 0 : least alpha equals coarseGridCpu (the least over the footprint of V, V = 0 where a shown segment may be inside, else the alpha) for random volumes, every shown set and channel layout, c3 and c4', () => {
    const rnd = mulberry(11);
    for (const [dims, cls4On] of [[[13, 9, 11], false], [[16, 12, 8], true]]) {
      const [W, H, D] = dims, n = W * H * D, data = new Uint8Array(n * 4), cls4 = new Uint8Array(n);
      for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = rnd() < 0.05 ? 200 : Math.floor(rnd() * 90); data[i * 4 + 3] = Math.floor(rnd() * 256); cls4[i] = rnd() < 0.04 ? 255 : Math.floor(rnd() * 90); }
      const marks = marksCpu({ data, dims, cls4: cls4On ? cls4 : null }), alpha = alphaGridCpu({ data, dims });
      for (const chan of [[0, 1, 2, cls4On ? 3 : -1], [2, 0, -1, -1], [1, -1, 0, cls4On ? 3 : -1]]) for (let mask = 0; mask < 16; mask++) {
        const segOn = [0, 1, 2, 3].map(k => (mask >> k) & 1), shown = chan.reduce((m, c, k) => (c >= 0 && segOn[k] ? m | (1 << c) : m), 0);
        const old = coarseGridCpu({ data, dims, chan, segOn, cls4: cls4On ? cls4 : null });
        for (let i = 0; i < old.length; i++) expect(marks[i] & shown ? 0 : alpha[i]).toBe(old[i]);
      }
    }
  });
  it('the tiles\' program in mode marks parses (c3 / c4) and takes the cell\'s reach from both grids and the shown channels', () => {
    for (const cls4 of [false, true]) { const t = coarseProxyWgsl({ cls4, mode: 'marks', tile: 4 }); expect(() => new WgslReflect(t)).not.toThrow(); expect(t).toContain('markTex'); expect(t).toContain('if((mk[c.x%4]&shown)!=0u){d=0.0;}'); }
    expect(() => coarseProxyWgsl({ mode: 'nope' })).toThrow();
  });
  it('the build writes the alpha grid too (the least distance byte over the footprint, 255 where nothing, 0 beyond the grid)', () => { const t = marksBuildWgsl({ cls4: false }); expect(t).toContain('al.x=min(al.x,d);'); expect(t).toContain('textureStore(alphaOut,t,al);'); expect(t).toContain('al[j]=0u;'); });
});

describe('the host on a recording device', () => {
  const withGpu = fn => async () => { for (const [k, v] of Object.entries(GPU_GLOBALS)) vi.stubGlobal(k, v); try { await fn(); } finally { vi.unstubAllGlobals(); } };
  const mk = () => {
    const rec = recordingDevice({}), entries = new Map(), tex = { a: {}, b: {} };
    const entry = (t, gen) => { const e = { gpu: rec.device.createTexture({ size: [32, 32, 32], dimension: '3d', format: 'rgba8unorm', usage: 1 }), gen }; entries.set(t, e); return e; };
    const host = createMarkHost({ device: rec.device, bgl0: {}, onShader: null, dropGroups: () => {}, dummy: () => rec.device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rgba8unorm', usage: 1 }), entryOf: t => entries.get(t), tag: 't' });
    return { rec, host, entries, entry, tex };
  };
  const settle = () => new Promise(r => setTimeout(r, 0));
  it('the first use makes the marks whole in one dispatch (the grid\'s packed size), the same version again makes nothing, a new version makes them whole again, and the program is compiled once', withGpu(async () => {
    const { rec, host, entry, tex } = mk(), e = entry(tex.a, 5);
    const F = { clsObj: tex.a, c4Obj: null, clsTex: e.gpu, c4Tex: e.gpu, dims: [32, 32, 32], cls4: false, clsGen: 5, c4Gen: 0 };
    expect(host.prepare(F)).toBe('wait'); // (the program is being compiled)
    await settle();
    const enc = rec.device.createCommandEncoder(); const n0 = rec.log.length;
    expect(host.prepare({ ...F, enc })).toBe('ready');
    const pd = packedDims([32, 32, 32]); expect(rec.log.slice(n0).filter(l => l.startsWith('compute.dispatch'))).toEqual(['compute.dispatch ' + Math.ceil(pd[0] / 4) + ',' + Math.ceil(pd[1] / 4) + ',' + Math.ceil(8 / 4)]);
    const n1 = rec.log.length; expect(host.prepare({ ...F, enc })).toBe('ready'); expect(rec.log.slice(n1).filter(l => l.startsWith('compute.dispatch'))).toEqual([]);
    const n2 = rec.log.length; expect(host.prepare({ ...F, enc, clsGen: 6 })).toBe('ready'); expect(rec.log.slice(n2).filter(l => l.startsWith('compute.dispatch'))).toHaveLength(1);
    expect(rec.log.filter(l => l.startsWith('createComputePipelineAsync'))).toHaveLength(1);
    expect(host.group()).toBeTruthy(); expect(MARK_GROUP).toEqual({ group: 1, tex: 0 });
    host.destroy();
  }));
  it('a write of slices [z0, z1) of the entry redoes only the rows it touches, from the GPU\'s bytes in a submit of its own, and the marks stay "ready" for the entry\'s new write number; another entry\'s write is left alone', withGpu(async () => {
    const { rec, host, entry, tex } = mk(), e = entry(tex.a, 5), other = entry(tex.b, 1);
    const F = { clsObj: tex.a, c4Obj: null, clsTex: e.gpu, c4Tex: e.gpu, dims: [32, 32, 32], cls4: false, clsGen: 5, c4Gen: 0 };
    host.prepare(F); await settle(); const enc = rec.device.createCommandEncoder(); expect(host.prepare({ ...F, enc })).toBe('ready');
    const n0 = rec.log.length; e.gen = 9; expect(host.onWrite(e, 10, 12)).toBe(true);
    const seg = rec.log.slice(n0); expect(seg.filter(l => l.startsWith('compute.dispatch'))).toEqual(['compute.dispatch 1,2,1']); expect(seg).toContain('finish'); expect(seg.some(l => l.startsWith('submit'))).toBe(true);
    const n1 = rec.log.length; expect(host.prepare({ ...F, enc, clsGen: 9 })).toBe('ready'); expect(rec.log.slice(n1).filter(l => l.startsWith('compute.dispatch'))).toEqual([]);
    const n2 = rec.log.length; expect(host.onWrite(other, 0, 32)).toBe(false); expect(rec.log.slice(n2).filter(l => l.startsWith('compute.dispatch'))).toEqual([]);
    host.destroy();
  }));
  it('a program that does not compile is "failed", not waited for for ever', withGpu(async () => {
    const { rec, host, entry, tex } = mk(), e = entry(tex.a, 5), orig = rec.device.createComputePipelineAsync;
    rec.device.createComputePipelineAsync = async () => { throw new Error('boom'); };
    const F = { clsObj: tex.a, c4Obj: null, clsTex: e.gpu, c4Tex: e.gpu, dims: [32, 32, 32], cls4: false, clsGen: 5, c4Gen: 0 };
    host.prepare(F); await settle(); expect(host.prepare(F)).toBe('failed'); expect(host.prog(false).msg).toContain('boom'); void orig;
    host.destroy();
  }));
});
