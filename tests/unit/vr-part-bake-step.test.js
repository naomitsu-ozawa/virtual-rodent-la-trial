// The baked texture of a cut (docs/vr-part-view.js partBakeStep, driven by vr-view.js partBakeFrame): the body reads it once the bake is ready, so it must hold the WHOLE original
// volume (outside the baked box too) plus the worker's baked box. Every byte goes up from memory (texSubImage3D from a wrapper of CPU bytes, like uploadCombo): a GPU-to-GPU copy
// (copyTexSubImage3D from a framebuffer layer) is not relied on. The fake renderer below copies only from such wrappers; a copy from a GPU texture writes nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { partBakeStep } from '../../docs/vr-part-view.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

const gpuTex = (dims, C) => ({ gpu: true, dims, C, bytes: new Uint8Array(dims[0] * dims[1] * dims[2] * C) });
function fakeOps() {
  const log = { copies: [], wraps: [], drops: [] };
  const ops = {
    wrap: (data, dims, C) => { const w = { wrap: true, data, dims, C, dropped: false }; log.wraps.push(w); return w; },
    copy: (s, d, lo, hi, at) => {
      log.copies.push({ s, d, lo, hi, at });
      if (!s.wrap || s.dropped) return; // only bytes from memory arrive
      const [sw, sh] = s.dims, [dw, dh] = d.dims, C = d.C;
      for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) for (let x = lo[0]; x < hi[0]; x++) {
        const si = ((z * sh + y) * sw + x) * C, di = (((at[2] + z - lo[2]) * dh + at[1] + y - lo[1]) * dw + at[0] + x - lo[0]) * C;
        for (let c = 0; c < C; c++) d.bytes[di + c] = s.data[si + c];
      }
    },
    drop: w => { w.dropped = true; log.drops.push(w); },
  };
  return { ops, log };
}
const fill = (n, f) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = f(i); return a; };

function scene(four) {
  const dims = [12, 10, 9], n = dims[0] * dims[1] * dims[2];
  const combo = { gpu: true, dims, C: 4, image: { data: fill(n * 4, i => 1 + (i * 7) % 250) } };
  const cls4 = four ? { gpu: true, dims, C: 1, image: { data: fill(n, i => 3 + (i * 5) % 200) } } : null;
  combo.bytes = combo.image.data.slice(); if (cls4) cls4.bytes = cls4.image.data.slice(); // the GPU copy of the original holds the same bytes
  const box = { lo: [3, 2, 1], size: [5, 4, 6] }, bn = box.size[0] * box.size[1] * box.size[2];
  const patch = { rgba: fill(bn * 4, i => 251 - (i % 200)), c4: four ? fill(bn, i => 90 + (i % 50)) : null };
  const b = { tex: gpuTex(dims, 4), cls4Tex: four ? gpuTex(dims, 1) : null, box, z: 0, patch: null, pz: 0, ready: false, srcTex: null, src4Tex: null };
  return { t: { combo, cls4, dims }, b, patch, box };
}
const inBox = (box, x, y, z) => x >= box.lo[0] && y >= box.lo[1] && z >= box.lo[2] && x < box.lo[0] + box.size[0] && y < box.lo[1] + box.size[1] && z < box.lo[2] + box.size[2];
function expected(t, patch, box, C, orig, pdata) {
  const [W, H, D] = t.dims, out = orig.slice(), [bw, bh] = box.size;
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inBox(box, x, y, z)) {
    const pi = (((z - box.lo[2]) * bh + y - box.lo[1]) * bw + x - box.lo[0]) * C, i = ((z * H + y) * W + x) * C;
    for (let c = 0; c < C; c++) out[i + c] = pdata[pi + c];
  }
  return out;
}
function run(four, budget) {
  const s = scene(four), { ops, log } = fakeOps();
  let steps = 0;
  while (!s.b.ready && steps < 1000) { if (steps === 3) s.b.patch = s.patch; partBakeStep(s.b, s.t, budget, ops); steps++; }
  return { ...s, log, steps };
}

describe('partBakeStep: the baked texture holds the whole original plus the baked box', () => {
  for (const four of [false, true]) for (const budget of [1, 4 << 20]) {
    it(`${four ? 'four segments' : 'three segments'}, budget ${budget} bytes a step`, () => {
      const { t, b, patch, box, log } = run(four, budget);
      expect(b.ready).toBe(true);
      expect(Array.from(b.tex.bytes)).toEqual(Array.from(expected(t, patch, box, 4, t.combo.image.data, patch.rgba)));
      if (four) expect(Array.from(b.cls4Tex.bytes)).toEqual(Array.from(expected(t, patch, box, 1, t.cls4.image.data, patch.c4)));
      // no copy reads a GPU texture; every wrapper made is dropped once its bytes are up
      expect(log.copies.every(c => c.s.wrap)).toBe(true);
      expect(log.wraps.every(w => w.dropped)).toBe(true);
      expect(b.srcTex).toBe(null); expect(b.src4Tex).toBe(null);
    });
  }
  it('no step copies before the original is complete, and the box waits for the worker', () => {
    const s = scene(true), { ops } = fakeOps();
    for (let i = 0; i < 50; i++) partBakeStep(s.b, s.t, 1 << 30, ops);
    expect(s.b.ready).toBe(false); // the worker's bytes have not come
    expect(s.b.z).toBe(s.t.dims[2]);
    s.b.patch = s.patch; partBakeStep(s.b, s.t, 1 << 30, ops);
    expect(s.b.ready).toBe(true);
  });
  it('perf2 (4-5): with ops.gpuCopy (the WebGPU view) the whole original is one GPU copy (the colour texture and the fourth channel\'s together), no wrapper is made, no slab is sent; the box then follows from the worker\'s bytes; the result is the same bytes', () => {
    for (const four of [false, true]) {
      const s = scene(four), { ops, log } = fakeOps(), calls = [];
      ops.gpuCopy = (pairs, done) => { calls.push(pairs.map(([a, b]) => [a, b])); for (const [a, b] of pairs) b.bytes.set(a.image.data); done(true); return true; }; // the GPU's copy of the original's bytes (the device's answer: valid)
      partBakeStep(s.b, s.t, 1, ops);
      expect(calls).toHaveLength(1); expect(calls[0].map(([a, b]) => [a, b])).toEqual(four ? [[s.t.combo, s.b.tex], [s.t.cls4, s.b.cls4Tex]] : [[s.t.combo, s.b.tex]]);
      expect(s.b.z).toBe(s.t.dims[2]); expect(s.b.ready).toBe(false); expect(log.wraps).toHaveLength(0); expect(log.copies).toHaveLength(0);
      for (let i = 0; i < 5; i++) partBakeStep(s.b, s.t, 1, ops); expect(s.b.ready).toBe(false); // the box waits for the worker
      s.b.patch = s.patch; let n = 0; while (!s.b.ready && n++ < 100) partBakeStep(s.b, s.t, 1 << 30, ops);
      expect(calls).toHaveLength(1); // not copied again
      expect(Array.from(s.b.tex.bytes)).toEqual(Array.from(expected(s.t, s.patch, s.box, 4, s.t.combo.image.data, s.patch.rgba)));
      if (four) expect(Array.from(s.b.cls4Tex.bytes)).toEqual(Array.from(expected(s.t, s.patch, s.box, 1, s.t.cls4.image.data, s.patch.c4)));
      expect(log.copies.every(c => c.s.wrap)).toBe(true); // only the box's patch went from memory
    }
  });
  it('perf2 (4-5): a GPU copy that cannot be made (false) falls back to the copy from memory for the whole bake, once', () => {
    const s = scene(true), { ops, log } = fakeOps(); let asked = 0; ops.gpuCopy = () => { asked++; return false; };
    let steps = 0; while (!s.b.ready && steps < 1000) { if (steps === 3) s.b.patch = s.patch; partBakeStep(s.b, s.t, 1 << 30, ops); steps++; }
    expect(asked).toBe(1); expect(s.b.ready).toBe(true); expect(Array.from(s.b.tex.bytes)).toEqual(Array.from(expected(s.t, s.patch, s.box, 4, s.t.combo.image.data, s.patch.rgba)));
    expect(log.copies.every(c => c.s.wrap)).toBe(true);
  });
  it('perf2: the bake is not ready until the device has said the GPU copy was valid (b.gpuOk); no answer yet = it waits, with the box already in', () => {
    const s = scene(true), { ops } = fakeOps(); let answer = null, calls = 0;
    ops.gpuCopy = (pairs, done) => { calls++; for (const [a, b] of pairs) b.bytes.set(a.image.data); answer = done; return true; };
    partBakeStep(s.b, s.t, 1, ops); s.b.patch = s.patch; for (let i = 0; i < 20; i++) partBakeStep(s.b, s.t, 1 << 30, ops);
    expect(s.b.ready).toBe(false); expect(s.b.gpuOk).toBeNull(); expect(s.b.patch).not.toBeNull();
    answer(true); expect(s.b.gpuOk).toBe(true); expect(partBakeStep(s.b, s.t, 1 << 30, ops)).toBe(true); expect(s.b.ready).toBe(true); expect(s.b.patch).toBeNull(); expect(calls).toBe(1);
    expect(Array.from(s.b.tex.bytes)).toEqual(Array.from(expected(s.t, s.patch, s.box, 4, s.t.combo.image.data, s.patch.rgba)));
  });
  it('perf2: a GPU copy the device reports as failed (b.gpuOk false) is made again from memory (z and the box start over, noGpu), and the result is the same bytes', () => {
    for (const early of [false, true]) {
      const s = scene(true), { ops, log } = fakeOps(); let answer = null, calls = 0;
      ops.gpuCopy = (pairs, done) => { calls++; answer = done; return true; }; // nothing arrives on the GPU's side
      partBakeStep(s.b, s.t, 1, ops); s.b.patch = s.patch;
      if (early) { for (let i = 0; i < 20; i++) partBakeStep(s.b, s.t, 1 << 30, ops); expect(s.b.ready).toBe(false); } // the box was copied before the answer
      answer(false); let n = 0; while (!s.b.ready && n++ < 1000) partBakeStep(s.b, s.t, 1 << 30, ops);
      expect(calls).toBe(1); expect(s.b.noGpu).toBe(true); expect(s.b.ready).toBe(true); expect(log.wraps.length).toBeGreaterThan(0);
      expect(Array.from(s.b.tex.bytes)).toEqual(Array.from(expected(s.t, s.patch, s.box, 4, s.t.combo.image.data, s.patch.rgba)));
      expect(Array.from(s.b.cls4Tex.bytes)).toEqual(Array.from(expected(s.t, s.patch, s.box, 1, s.t.cls4.image.data, s.patch.c4)));
    }
  });
  it('vr-view.js: the WebGPU view gives the step the GPU copy (with the device\'s answer, a failure counted as bake gpuCopyErr), the WebGL view none; vr-wgpu.js copyGpu reads a validation error scope around the copy', () => {
    expect(src).toContain("gpuCopy:gx?(pairs,done)=>gx.vol.volume.copyGpu(pairs,ok=>{if(!ok)perfLog?.tally('bake','gpuCopyErr');done(ok)}):null");
    const w = readFileSync(new URL('../../docs/vr-wgpu.js', import.meta.url), 'utf8');
    expect(w).toContain("device.pushErrorScope('validation')"); expect(w).toContain('device.popErrorScope().then(err => done(!err), () => done(false))');
    expect(w.indexOf("device.pushErrorScope('validation')")).toBeLessThan(w.indexOf('enc.copyTextureToTexture({ texture: a.gpu }')); expect(w.indexOf('device.queue.submit([enc.finish()]);', w.indexOf('const copyGpu'))).toBeLessThan(w.indexOf('device.popErrorScope().then(err => done(!err)'));
  });
  it('vr-view.js: the step runs through partBakeStep, and a dropped bake releases the wrappers of the original too', () => {
    expect(src).toContain('partBakeStep(b,t,uploadQueue.bytesPerTickNow,bakeOps)');
    const drop = src.slice(src.indexOf('const bakeDrop=why=>{'), src.indexOf('partBakeDrop=bakeDrop;'));
    for (const k of ['b.origTex', 'b.orig4Tex', 'b.srcTex', 'b.src4Tex']) expect(drop).toContain(k);
  });
});

// n740: the baked cut is lit as the VRL_PART body lights it (vr-view.js VRL_BAKE_CUT / bakeGrad); the pictures: tools/vr-part-bake-check.mjs (SwiftShader)
import { shaderTemplate, preprocess } from '../helpers/glsl-preprocess.js';
import { PAIR_UNIFORMS } from '../../docs/vr-pair-view.js';
describe('the light of a baked cut', () => {
  const t = shaderTemplate(src), NG = ['VRL_NO_GENERAL', 'VRL_OPAQUE'];
  it('is compiled only in the programs a baked body is drawn with: results or child segments, the combined texture, not VRL_PART', () => {
    const has = d => preprocess(t, new Set(d)).includes('vec3 bakeGrad(');
    for (const x of [['VRL_REGIONS'], ['VRL_CHILDREN'], ['VRL_REGIONS', 'VRL_CHILDREN']]) for (const v of [NG, [...NG, 'VRL_NO_EVENTS']]) for (const f of [[], ['VRL_NOHIDE'], ['VRL_CLS4'], ['VRL_MEDIUMP']]) {
      expect(has([...v, ...x, ...f]), [...v, ...x, ...f].join()).toBe(true);
      expect(has([...v, ...x, ...f, 'VRL_PART'])).toBe(false);
      expect(has([...x, ...f])).toBe(false); // the full program (the general loop): not the combined texture
    }
    for (const v of [[], NG, [...NG, 'VRL_NO_EVENTS']]) expect(has(v)).toBe(false); // no results, no child segments: no part
  });
  it('gradientAtS takes the field\'s gradient only on a slot bakeCut has, within 0.08 of the 0.5 level, never flipped (as hideGrad on the VRL_PART body)', () => {
    const fn = src.slice(src.indexOf('vec3 gradientAtS('), src.indexOf('#define gradientAt(tc)'));
    expect(fn).toContain('#ifdef VRL_BAKE_CUT\n if(s>=0&&((bakeCut>>s)&1)==1){vec3 bn=bakeGrad(tc,s);if(dot(bn,bn)>0.0){gHuMean=1e9;return normalize(bn);}}');
    const g = src.slice(src.indexOf('vec3 bakeGrad('), src.indexOf('vec3 gradientAtS('));
    expect(g).toContain('if(abs(bakeFieldAt(tc,a,b)-0.5)>=0.08)return vec3(0.0);');
    const h = src.slice(src.indexOf('vec3 hideGrad('), src.indexOf('vec3 hideGrad(') + 1600); // the same band and the same difference formula as the VRL_PART body
    expect(h).toContain('if(abs(f0-0.5)<0.08)');
    expect(h).toContain('vec3 vx=2.0*halfExt*d;return vec3(g.x/max(vx.x,1e-6),-g.y/max(vx.y,1e-6),g.z/max(vx.z,1e-6));');
    expect(g).toContain('vec3 vx=2.0*halfExt*d;return vec3(g.x/max(vx.x,1e-6),-g.y/max(vx.y,1e-6),g.z/max(vx.z,1e-6));');
  });
  it('vr-view.js: bakeSet sets the light with the textures (from the body\'s field) and clears it when the bake goes; volumeUniforms has the keys (0 / null), the partner keeps its own', () => {
    const set = src.slice(src.indexOf('const bakeSet=on=>{'), src.indexOf('const bakeDrop=why=>{'));
    expect(set).toContain('bakeLight(on?b:null);');
    expect(set).toContain('const bakeLight=b=>{const u=material.uniforms,f=b&&partRes?.body?.u;u.bakeCut.value=f?b.cut|0:0;u.bakeField.value=f?f.partField.value:null;');
    expect(src).toContain('bakeCut:{value:0},bakeField:{value:null},');
    expect(src).toContain('{b.patch=res;b.cut=res.slots|0}');
    for (const k of ['bakeCut', 'bakeField', 'bakeFieldScale', 'bakeFieldOff', 'bakeFieldA', 'bakeFieldB']) expect(PAIR_UNIFORMS.own).toContain(k);
  });
});
