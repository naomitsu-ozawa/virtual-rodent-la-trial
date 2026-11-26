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
  it('vr-view.js: the step runs through partBakeStep, and a dropped bake releases the wrappers of the original too', () => {
    expect(src).toContain('partBakeStep(b,t,uploadQueue.bytesPerTickNow,bakeOps)');
    const drop = src.slice(src.indexOf('const bakeDrop=()=>{'), src.indexOf('partBakeDrop=bakeDrop;'));
    for (const k of ['b.origTex', 'b.orig4Tex', 'b.srcTex', 'b.src4Tex']) expect(drop).toContain(k);
  });
  it('vr-view.js: partApply keeps the bound bake until the new set is installed (the drop is in the same step as the body\'s change, before done() and before the old field is dropped)', () => {
    const fn = src.slice(src.indexOf('const partApply=('), src.indexOf('const partBodySetRaw='));
    const head = fn.slice(0, fn.indexOf('const run=async()=>{'));
    expect(head).not.toContain('bakeDrop()'); // not at the start: the wait draws by the baked bytes
    const emptyAt = fn.indexOf('if(!list.length){bakeDrop();'), keepAt = fn.indexOf('if(!keepB){const ob=b.tex'), dropAt = fn.lastIndexOf('bakeDrop();', keepAt);
    expect(emptyAt).toBeGreaterThan(0); // the branch that removes the last part drops before it changes the body
    expect(dropAt).toBeGreaterThan(fn.indexOf('const stale=partRes!==r')); // after the last await and the staleness check
    expect(fn.indexOf('return false}', fn.indexOf('const stale=partRes!==r'))).toBeLessThan(dropAt); // a failed set (return false) leaves the bake alone
    expect(dropAt).toBeLessThan(fn.indexOf('done();return true;\n     }\n     return false;')); // before done() (it calls refreshRegionLut)
    expect(dropAt).toBeLessThan(keepAt);
    // partBakeFrame: a part change in flight only stops a NEW bake; the ready one is kept
    const frame = src.slice(src.indexOf('partBakeFrame=()=>{'), src.indexOf('let cfgChain='));
    expect(frame).toContain('(bakeApplying>0&&!b.ready)))bakeDrop()');
    expect(frame).toContain('if(bakeApplying>0||t.rb?.busy');
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
    const set = src.slice(src.indexOf('const bakeSet=on=>{'), src.indexOf('const bakeDrop=()=>{'));
    expect(set).toContain('bakeLight(on?b:null);');
    expect(set).toContain('const bakeLight=b=>{const u=material.uniforms,f=b&&partRes?.body?.u;u.bakeCut.value=f?b.cut|0:0;u.bakeField.value=f?f.partField.value:null;');
    expect(src).toContain('bakeCut:{value:0},bakeField:{value:null},');
    expect(src).toContain('{b.patch=res;b.cut=res.slots|0}');
    for (const k of ['bakeCut', 'bakeField', 'bakeFieldScale', 'bakeFieldOff', 'bakeFieldA', 'bakeFieldB']) expect(PAIR_UNIFORMS.own).toContain(k);
  });
});
