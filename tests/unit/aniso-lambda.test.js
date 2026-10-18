import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cpuAnisotropicDiffusion } from '../../docs/cpu-filters.js';
import { gpuFilterShader } from '../../docs/gpu-shaders.js';
import { ANISO_LAMBDA_MIN, ANISO_LAMBDA_MAX, anisotropicLambda, FILTER_UNITS, sourceFilterSignature } from '../../docs/filter-units.js';
import { segmentRunsCacheKey } from '../../docs/segment-cache-key.js';

// Anisotropic diffusion step size lambda: strength 0..1 -> [0.06, 1/7]; 1/6 is the stability limit of the 6-neighbour scheme
// and 1/7 keeps the finest checkerboard component damped (eigenvalue about -0.71).
const sf = readFileSync(new URL('../../docs/source-filters.js', import.meta.url), 'utf8');
const worker = (() => {
  const a = sf.indexOf('export function sourceFilterWorkerMain(){'), b = sf.indexOf(' function extract(');
  return new Function(sf.slice(a, b).replace('export function sourceFilterWorkerMain(){', '') + '; return {anisotropic};')();
})();
const STRENGTHS = [0, 0.25, 0.5, 0.75, 1, 1.2, -0.5];
const vol = (n, f) => {
  const data = new Float32Array(n * n * n);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[(z * n + y) * n + x] = f(x, y, z);
  return { columns: n, rows: n, slices: n, data, min: -1000, max: 1000 };
};
// One iteration on a lone unit spike with a huge kappa (conductance 1): spike' = 1 - 6 lambda, so lambda = (1 - spike') / 6.
const spike = () => vol(5, (x, y, z) => (x === 2 && y === 2 && z === 2 ? 1 : 0));
const centre = (d, n = 5) => d[(2 * n + 2) * n + 2];
const lambdaCpu = async s => (1 - centre((await cpuAnisotropicDiffusion(spike(), { strength: s, kappaHU: 1e9, iterations: 1 })).data)) / 6;
const lambdaWorker = s => { const v = spike(); return (1 - centre(worker.anisotropic(v.data, 5, 5, 5, { strength: s, kappaHU: 1e9, iterations: 1 }))) / 6; };
// evaluate the lambda expression of the WGSL kernel for a given strength
const lambdaWgsl = s => {
  const m = gpuFilterShader('anisotropic', 64).match(/let lambda=([^;]+);/);
  expect(m).toBeTruthy();
  const wgsl = m[1].replace(/\bmin\(/g, 'Math.min(').replace(/\bclamp\(/g, 'clampf(');
  return new Function('strength', 'clampf', 'return ' + wgsl)(s, (x, lo, hi) => Math.min(hi, Math.max(lo, x)));
};

describe('anisotropic lambda', () => {
  it('constants: strength 0 keeps 0.06, strength 1 is exactly 1/7', () => {
    expect(ANISO_LAMBDA_MIN).toBe(0.06);
    expect(ANISO_LAMBDA_MAX).toBe(1 / 7);
    expect(anisotropicLambda(0)).toBe(0.06);
    expect(anisotropicLambda(1)).toBe(1 / 7);
    expect(anisotropicLambda(0.5)).toBeCloseTo((0.06 + 1 / 7) / 2, 12);
  });
  it('stays within [0.06, 1/7] (so below the 1/6 stability limit) for any strength, including out of range and NaN', () => {
    for (let i = 0; i <= 1000; i++) expect(anisotropicLambda(i / 1000)).toBeLessThanOrEqual(1 / 7);
    expect(anisotropicLambda(1.2)).toBe(1 / 7);
    expect(anisotropicLambda(-0.5)).toBe(0.06);
    expect(anisotropicLambda(NaN)).toBe(0.06);
    expect(anisotropicLambda(undefined)).toBe(0.06);
  });
  it('the worker clamps NaN like anisotropicLambda', () => {
    expect(lambdaWorker(NaN)).toBeCloseTo(0.06, 5);
  });
  it.each(STRENGTHS)('CPU, worker and WGSL give the same lambda at strength %s', async s => {
    const want = anisotropicLambda(s);
    expect(await lambdaCpu(s)).toBeCloseTo(want, 5);
    expect(lambdaWorker(s)).toBeCloseTo(want, 5);
    expect(lambdaWgsl(s)).toBeCloseTo(want, 12);
  });
  it('the worker repeats the same constants as filter-units.js (it cannot import them)', () => {
    const m = sf.match(/LAMBDA_MIN=([0-9.]+),LAMBDA_MAX=([0-9./]+)/);
    expect(m).toBeTruthy();
    expect(new Function('return ' + m[1])()).toBe(ANISO_LAMBDA_MIN);
    expect(new Function('return ' + m[2])()).toBe(ANISO_LAMBDA_MAX);
  });
  it('the WGSL kernel uses the same constants and clamps at the maximum', () => {
    const src = gpuFilterShader('anisotropic', 64);
    expect(src).toContain(String(ANISO_LAMBDA_MIN));
    expect(src).toContain(String(ANISO_LAMBDA_MAX));
    expect(src).toMatch(/let lambda=min\(/);
  });
});

describe('anisotropic stability at strength 1', () => {
  const maxDev = (v, n) => { let m = 0; for (let z = 1; z < n - 1; z++) for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) m = Math.max(m, Math.abs(v.data[(z * n + y) * n + x] - 100)); return m; };
  it.each([2, 20])('a checkerboard of amplitude %s HU on a flat area does not grow (12 iterations)', async amp => {
    const n = 16, make = () => vol(n, (x, y, z) => 100 + ((x + y + z) % 2 ? amp : -amp));
    const before = maxDev(make(), n);
    const out = await cpuAnisotropicDiffusion(make(), { strength: 1, kappaHU: 60, iterations: 12 });
    const after = maxDev(out, n);
    expect(after).toBeLessThanOrEqual(before * 1.0001);
    if (amp === 20) expect(after).toBeLessThan(before * 0.5);
  });
  it('fine noise (2 HU checkerboard, kappa 60) is clearly reduced: under half after 4 iterations', async () => {
    // measured in the core, further from the fixed border than the iteration count, so the border does not feed the pattern back
    const n = 32, make = () => vol(n, (x, y, z) => 100 + ((x + y + z) % 2 ? 2 : -2));
    const core = v => { let m = 0; for (let z = 14; z < 18; z++) for (let y = 14; y < 18; y++) for (let x = 14; x < 18; x++) m = Math.max(m, Math.abs(v.data[(z * n + y) * n + x] - 100)); return m / 2; };
    const res = {};
    for (const it of [4, 12]) res[it] = core(await cpuAnisotropicDiffusion(make(), { strength: 1, kappaHU: 60, iterations: it }));
    
    expect(res[4]).toBeLessThan(0.5);
    expect(res[12]).toBeLessThan(res[4]);
  });
});

describe('anisotropic cache signature', () => {
  it('algo is 3, so signatures and cache keys of the old lambda are not reused', async () => {
    expect(FILTER_UNITS.anisotropic.algo).toBe(3);
    const stages = [{ key: 'anisotropic', params: { strength: 0.5, kappaHU: 60, iterations: 4 } }];
    const now = sourceFilterSignature(stages), old = now.replace('"algo":3', '"algo":2');
    expect(now).toContain('"algo":3');
    expect(old).not.toBe(now);
    const series = { id: 's::1', columns: 8, rows: 6, spacingX: 0.05, spacingY: 0.05, spacingZ: 0.1, slices: [{ studyUid: 's', seriesUid: '1' }, {}, {}] };
    const seg = { min: -250, max: 80, opening: 0, closing: 0, minComponent: 0, holeFill: false };
    expect(await segmentRunsCacheKey(series, now, seg)).not.toBe(await segmentRunsCacheKey(series, old, seg));
  });
});
