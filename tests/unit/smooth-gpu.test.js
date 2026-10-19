import { describe, it, expect } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { gpuFilterShader, normalizeVrlWgsl, SMOOTH_KERNELS, SMOOTH_KERNEL_KINDS, smoothKernelBindings } from '../../docs/gpu-shaders.js';
import { buildSmoothTopology, smoothIterationPlan, smoothParamsWords } from '../../docs/smooth-gpu-plan.js';
import { constrainedSmoothPositions, constrainedSmoothSchedule } from '../../docs/constrained-smooth.js';
import { makeMask, voxelFaces, weld } from '../helpers/voxel-mesh.js';

// the constrained smoothing on the GPU (smooth-gpu.js). CI has no GPU, so the WGSL kernels are run here on the
// CPU: their bodies are valid JavaScript, each is run once per vertex with only the buffers it declares, in the order of the
// dispatch plan (smooth-gpu-plan.js), and the result is compared with the CPU kernel (constrained-smooth.js).
const mesh = (w, h, d, inside, boundary = true) => weld(voxelFaces(makeMask(w, h, d, inside), w, h, d, { boundary }).positions);
const helpers = { abs: Math.abs, sqrt: Math.sqrt, clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi) };
const compiled = Object.fromEntries(SMOOTH_KERNEL_KINDS.map(kind => {
  const names = Object.keys(SMOOTH_KERNELS[kind].uses);
  return [kind, { names, fn: new Function('P', 'i', ...names, ...Object.keys(helpers), SMOOTH_KERNELS[kind].body) }];
}));

// the GPU job, emulated: same topology, same buffers (f32), same dispatch order
function smoothOnEmulatedGpu(pos, index, { iterations, lowpass, box, pinned = null, lambda = 0.5, rhoEvery = 5 }) {
  const n = pos.length / 3, t = buildSmoothTopology(index, n, pinned), words = smoothParamsWords(t.params, lambda, box);
  const u = new Uint32Array(words), f = new Float32Array(words);
  const P = { n: u[0], offB: u[1], toffB: u[2], adjB: u[3], triB: u[4], idxB: u[5], lambda: f[8], bx: f[9], by: f[10], bz: f[11] };
  const buf = { topoA: t.topoA, topoB: t.topoB, pos: new Float32Array(pos), orig: new Float32Array(pos), p1: new Float32Array(n * 3), nrm: new Float32Array(n * 3), dr: new Float32Array(n * 2), la: new Float32Array(n * 2), lb: new Float32Array(n * 2), invs: t.invs };
  for (let k = 0; k < iterations; k++) {
    for (const step of smoothIterationPlan(k, lowpass, rhoEvery)) {
      const b = step.swap ? { ...buf, la: buf.lb, lb: buf.la } : buf, { names, fn } = compiled[step.kind], args = names.map(nm => b[nm]);
      for (let i = 0; i < n; i++) fn(P, i, ...args, ...Object.values(helpers));
    }
  }
  return buf.pos;
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

describe('constrained smoothing kernels (WGSL)', () => {
  it.each(SMOOTH_KERNEL_KINDS)('%s parses with the 2D-grid index rewrite and binds only what it declares', kind => {
    const src = normalizeVrlWgsl(gpuFilterShader(kind, 64)).replaceAll('gid.x', '(gid.x+gid.y*' + (65535 * 64) + 'u)');
    const r = new WgslReflect(src);
    expect(r.entry.compute.map(e => e.name)).toContain('main');
    expect(src).not.toMatch(/undefined|NaN/);
    const bound = [...src.matchAll(/@binding\((\d+)\) var<storage, (read|read_write)> (\w+)/g)].map(m => [m[3], +m[1]]);
    expect(bound).toEqual(smoothKernelBindings(kind).map(b => [b.name, b.binding]));
  });

  it('the dispatch plan: low-pass rounds alternate la / lb and rho reads the last one written', () => {
    expect(smoothIterationPlan(1, 8, 5).map(s => s.kind)).toEqual(['smoothNormals', 'smoothLaplace', 'smoothApply']);
    const even = smoothIterationPlan(0, 2, 5), odd = smoothIterationPlan(5, 3, 5);
    expect(even.map(s => s.kind + (s.swap ? '*' : ''))).toEqual(['smoothNormals', 'smoothLaplace', 'smoothLowpassInit', 'smoothLowpass', 'smoothLowpass*', 'smoothRho', 'smoothApply']);
    expect(odd.map(s => s.kind + (s.swap ? '*' : ''))).toEqual(['smoothNormals', 'smoothLaplace', 'smoothLowpassInit', 'smoothLowpass', 'smoothLowpass*', 'smoothLowpass', 'smoothRho*', 'smoothApply']);
    expect(smoothIterationPlan(0, 0, 5).map(s => s.kind)).toEqual(['smoothNormals', 'smoothLaplace', 'smoothApply']);
  });

  it('the topology: sorted unique neighbours, the triangles of every vertex in order, pinned vertices stay', () => {
    const index = new Uint32Array([0, 1, 2, 2, 1, 3]), t = buildSmoothTopology(index, 5, new Uint8Array([0, 0, 0, 1, 0]));
    const { offB, toffB, adjB, triB, idxB } = t.params, row = i => [...t.topoA.subarray(adjB + t.topoA[offB + i], adjB + t.topoA[offB + i + 1])];
    expect([row(0), row(1), row(2), row(3), row(4)]).toEqual([[1, 2], [0, 2, 3], [0, 1, 3], [1, 2], []]);
    const tris = i => [...t.topoB.subarray(triB + t.topoA[toffB + i], triB + t.topoA[toffB + i + 1])];
    expect([tris(0), tris(1), tris(2), tris(3), tris(4)]).toEqual([[0], [0, 3], [0, 3], [3], []]);
    expect([...t.topoB.subarray(idxB)]).toEqual([...index]);
    expect([...t.invs].filter((_, k) => k % 2 === 0)).toEqual([0.5, Math.fround(1 / 3), Math.fround(1 / 3), 0, 0]);
  });

  // a ball with a 1-voxel rod, and a 5 degree slab with a pinned corner: every strength gives the CPU kernel's result
  const ball = () => mesh(20, 20, 20, (x, y, z) => Math.hypot(x - 9.5, y - 9.5, z - 9.5) < 7 || (x === 3 && y === 3 && z > 2 && z < 17));
  const slab = () => mesh(48, 12, 16, (x, y, z) => z < 8 + Math.tan(5 * Math.PI / 180) * x);
  it.each([[0.6, ball], [2, ball], [4, ball], [6, ball], [4, slab]])('strength %s: the emulated GPU job matches the CPU kernel', (strength, make) => {
    const { pos, idx } = make(), pinned = new Uint8Array(pos.length / 3); pinned[0] = 1; pinned[7] = 1;
    const opts = { ...constrainedSmoothSchedule(strength), box: [0.5, 0.5, 0.5], pinned };
    const cpu = new Float32Array(pos); constrainedSmoothPositions(cpu, idx, { ...opts, orig: new Float32Array(pos) });
    const gpu = smoothOnEmulatedGpu(pos, idx, opts);
    expect(maxDiff(cpu, pos)).toBeGreaterThan(0.05); // it smoothed
    expect(maxDiff(gpu, cpu)).toBeLessThan(1e-4);
    for (const k of [0, 7]) expect([gpu[k * 3], gpu[k * 3 + 1], gpu[k * 3 + 2]]).toEqual([pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
  });
});
