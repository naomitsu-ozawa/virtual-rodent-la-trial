import { describe, it, expect } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { gpuFilterShader, normalizeVrlWgsl, GPU_PREWARM_KINDS } from '../../docs/gpu-shaders.js';
import { readFileSync } from 'node:fs';
import { volumeShader, brickShader, volumePickShader, mprPlaneShader } from '../../docs/medical-volume.js';

// CI has no GPU, so WGSL compile errors used to surface only on the device.
// wgsl_reflect parses WGSL in Node: it catches syntax/structure errors (not
// every validation rule a real GPU driver applies, e.g. type checking).
const parse = src => new WgslReflect(src);

// 'faceExtract' is handled by gpuFilterShader but not prewarmed.
const FILTER_KINDS = [...GPU_PREWARM_KINDS, 'faceExtract'];

describe('compute shaders (docs/gpu-shaders.js)', () => {
  // gpuFilterPipeline rewrites gid.x for 2D dispatch grids (build 263)
  it.each(FILTER_KINDS)('%s parses with the 2D-grid index rewrite', kind => {
    const src = normalizeVrlWgsl(gpuFilterShader(kind, 64)).replaceAll('gid.x', '(gid.x+gid.y*' + (65535 * 64) + 'u)');
    expect(() => parse(src)).not.toThrow();
    expect(src).not.toMatch(/[^(]gid\.x/);
  });
  it.each(FILTER_KINDS)('%s parses and exposes a compute main()', kind => {
    const src = normalizeVrlWgsl(gpuFilterShader(kind, 64));
    expect(src).not.toMatch(/undefined|NaN/);
    expect(src).toContain('@workgroup_size(64)');
    const r = parse(src);
    expect(r.entry.compute.map(e => e.name)).toContain('main');
  });

  // build 447: the strength parameters are absolute HU values at fixed indexes (params[0..]); the volume range
  // (min / max) is no longer passed, so no shader may compute a range from the params
  it.each(['sigmoid', 'spikeHole', 'anisotropic', 'tv', 'unsharpCombine', 'bilateral', 'nlm'])('%s does not use a volume range', kind => {
    const src = gpuFilterShader(kind, 64);
    expect(src).not.toMatch(/params\[1\]\s*-\s*params\[0\]/);
    expect(src).not.toMatch(/let range=/);
  });
  it('the HU parameters are read from params[] at the documented indexes', () => {
    expect(gpuFilterShader('bilateral', 64)).toMatch(/intensitySigma=max\(0\.000001,params\[2\]\)/);
    expect(gpuFilterShader('nlm', 64)).toMatch(/let hp=params\[0\];/);
    expect(gpuFilterShader('anisotropic', 64)).toMatch(/let k=params\[1\];/);
    expect(gpuFilterShader('tv', 64)).toMatch(/let eps=params\[1\];/);
    expect(gpuFilterShader('spikeHole', 64)).toMatch(/let threshold=params\[1\];/);
    expect(gpuFilterShader('unsharpCombine', 64)).toMatch(/let threshold=params\[1\];/);
  });

  // build 448: what a kernel reads from params[] must match what runGpuSourceFilters writes there (a wrong order or an extra
  // value gives wrong results on the GPU only, and the kernels alone cannot show it)
  describe('params[] layout: dispatch (gpu-compute.js) vs kernel (gpu-shaders.js)', () => {
    const LAYOUT = {
      sigmoid: { args: ['p.strength', 'p.center', 'p.width||300'], reads: [/let g=max\(0\.0,params\[0\]\)/, /let c=params\[1\]/, /let hw=max\(1\.0,params\[2\]\*0\.5\)/] },
      spikeHole: { args: ['p.strength', 'p.thresholdHU'], reads: [/let strength=params\[0\]/, /let threshold=params\[1\]/] },
      anisotropic: { args: ['p.strength', 'p.kappaHU', 'wx', 'wy', 'wz'], reads: [/let strength=params\[0\]/, /let k=params\[1\]/, /let wx=params\[2\]/, /let wy=params\[3\]/, /let wz=params\[4\]/] },
      tv: { args: ['p.weight', 'p.epsHU', 'wx', 'wy', 'wz'], reads: [/let weight=params\[0\]/, /let eps=params\[1\]/, /let wx=params\[2\]/, /let wy=params\[3\]/, /let wz=params\[4\]/] },
      unsharpCombine: { args: ['p.amount', 'p.thresholdHU', 'uz.A'], reads: [/params\[0\]\*detail/, /let threshold=params\[1\]/, /clamp\(params\[2\]-f32\(abs\(k\)\)\+0\.5/] },
      bilateral: { args: ['p.strength', 'p.spatialSigma', 'p.sigmaHU', 'ix', 'iy', 'iz'], reads: [/let strength=params\[0\]/, /let spatialSigma=params\[1\]/, /intensitySigma=max\(0\.000001,params\[2\]\)/, /let ix=params\[3\];let iy=params\[4\];let iz=params\[5\]/, /let rx=i32\(meta\[4\]\);let ry=i32\(meta\[5\]\);let rz=i32\(meta\[6\]\)/] },
      nlm: { args: ['p.hHU', 'prx', 'pry', 'prz'], reads: [/let hp=params\[0\]/, /let prx=i32\(params\[1\]\);let pry=i32\(params\[2\]\);let prz=i32\(params\[3\]\)/, /let srx=i32\(meta\[4\]\);let sry=i32\(meta\[5\]\);let srz=i32\(meta\[6\]\)/] },
    };
    const gc = readFileSync('docs/gpu-compute.js', 'utf8');
    const dispatched = kind => [...gc.matchAll(new RegExp("dispatch\\('" + kind + "',\\[[^\\]]*\\],\\[([^\\]]*)\\]", 'g'))].map(m => m[1].split(',').map(x => x.trim()));
    it.each(Object.keys(LAYOUT))('%s: the dispatch writes the values in the order the kernel reads them', kind => {
      const calls = dispatched(kind);
      expect(calls.length, 'dispatch calls of ' + kind).toBe(1);
      expect(calls[0]).toEqual(LAYOUT[kind].args);
      const src = gpuFilterShader(kind, 64);
      for (const re of LAYOUT[kind].reads) expect(src).toMatch(re);
      // the kernel reads no params[] index beyond the values that are written
      const used = [...src.matchAll(/params\[(\d+)\]/g)].map(m => +m[1]);
      expect(Math.max(...used)).toBeLessThan(LAYOUT[kind].args.length);
    });
  });

  it('uses the workgroup size it is given', () => {
    expect(gpuFilterShader('gaussian', 128)).toContain('@workgroup_size(128)');
  });

  it('normalizeVrlWgsl renames identifiers that clash with WGSL reserved words', () => {
    expect(normalizeVrlWgsl('let meta = active + target;')).toBe('let vrlMeta = vrlActive + vrlTarget;');
  });

  it('rejects broken WGSL (parser sanity check)', () => {
    expect(() => parse('fn main( { let x = ; }')).toThrow();
  });
});

describe('render shaders (docs/medical-volume.js)', () => {
  it('volumeShader has vertex + fragment entry points', () => {
    const r = parse(volumeShader());
    expect(r.entry.vertex.length).toBe(1);
    expect(r.entry.fragment.length).toBe(1);
  });
  // build 460: the MPR planes drawn inside the 3D volume colour by the same membership as the volume itself (mask + edits)
  it('volumeShader colours the in-volume MPR planes with segmentIndexFor, not a bare HU interval', () => {
    const src = volumeShader();
    expect(src).toMatch(/segmentIndexFor\(planeValue,/);
    expect(src).not.toMatch(/planeValue>=a\.x/);
  });
  it.each([['brickShader', brickShader], ['volumePickShader', volumePickShader], ['mprPlaneShader', mprPlaneShader]])(
    '%s parses and exposes a compute main()', (_name, fn) => {
      expect(parse(fn()).entry.compute.map(e => e.name)).toContain('main');
    });
});

// Regression: pipelines use layout:'auto', which drops every binding that the entry point does not
// (transitively) use. dispatch() in gpu-compute.js binds 0..3 whatever the shader declares, so a declared
// but unused binding fails createBindGroup validation and nothing is written (boxMean never read params,
// so Unsharp came out all zeros on the GPU). wgsl_reflect resolves what main() really uses, so every
// declared binding must show up in its resources.
describe('every declared binding is used by main() (layout:auto keeps only those)', () => {
  const declaredBindings = r => r.getBindGroups().flatMap(g => g.filter(Boolean)).map(v => v.group + ':' + v.binding + ' ' + v.name);
  const usedBindings = r => r.entry.compute.find(e => e.name === 'main').resources.map(v => v.group + ':' + v.binding + ' ' + v.name);
  it.each(FILTER_KINDS)('%s', kind => {
    const r = new WgslReflect(normalizeVrlWgsl(gpuFilterShader(kind, 64)));
    const used = new Set(usedBindings(r)), declared = declaredBindings(r);
    expect(declared.length, 'declared bindings').toBeGreaterThan(0);
    const missing = declared.filter(b => !used.has(b));
    expect(missing).toEqual([]);
  });
});

// The other direction: dispatch() in gpu-compute.js binds 0..3 (plus the extra entries a stage passes, binding 4
// for unsharpCombine) for every kind it dispatches, so the kernel has to declare them. Combined with the test above
// (declared => used) this makes the bind group always valid against the 'auto' layout.
describe('dispatch() kinds declare the bindings it passes', () => {
  const compute = readFileSync(new URL('../../docs/gpu-compute.js', import.meta.url), 'utf8');
  const kinds = new Set();
  for (const m of compute.matchAll(/dispatch\(([^;]*?),\s*\[/g)) {
    for (const k of m[1].matchAll(/'(\w+)'/g)) kinds.add(k[1]);
  }
  it('finds the dispatch() kinds', () => {
    for (const k of ['boxMean', 'unsharpCombine', 'gaussianK', 'airDistX', 'sigmoid']) expect(kinds.has(k)).toBe(true);
  });
  it.each([...kinds])('%s declares bindings 0-3', kind => {
    const declared = new Set(new WgslReflect(normalizeVrlWgsl(gpuFilterShader(kind, 64))).getBindGroups().flatMap(g => g.filter(Boolean)).map(v => v.binding));
    const want = kind === 'unsharpCombine' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3];
    expect(want.filter(b => !declared.has(b))).toEqual([]);
  });
});
