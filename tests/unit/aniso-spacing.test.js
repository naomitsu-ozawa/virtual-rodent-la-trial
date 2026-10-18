import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cpuAnisotropicDiffusion, cpuTvDenoising3D } from '../../docs/cpu-filters.js';
import { gpuFilterShader } from '../../docs/gpu-shaders.js';
import { spacingParams, spacingWeights, withSpacingWeights, SPACING_AWARE_KEYS, sourceFilterSignature, anisotropicLambda } from '../../docs/filter-units.js';

// Per-axis weights w_a = (hmin / h_a)^2 for Anisotropic diffusion. Isotropic data: nothing is added to the stage params, so
// the signature and the result are those of the build before (PR #94).
const sf = readFileSync(new URL('../../docs/source-filters.js', import.meta.url), 'utf8');
const gc = readFileSync(new URL('../../docs/gpu-compute.js', import.meta.url), 'utf8');
const workerAll = (() => {
  const a = sf.indexOf('export function sourceFilterWorkerMain(){'), b = sf.indexOf(' function extract(');
  return new Function(sf.slice(a, b).replace('export function sourceFilterWorkerMain(){', '') + '; return {anisotropic, tv};')();
})();
const worker = workerAll;

// sourceFilterStages() evaluated with stubbed controls (it only reads `.value` of UI elements)
const stagesOf = (spacing, key = 'anisotropic', explicit = true) => {
  const a = sf.indexOf('export function sourceFilterStages('), b = sf.indexOf('export function sourceFilterHalo');
  const body = sf.slice(a, b).replace('export function', 'function');
  const names = [...new Set([...body.matchAll(/\b(\w+)\.value\b/g)].map(m => m[1]))];
  const vals = { smoothingType: 'gaussian' };
  const fn = new Function('filterOrder', 'filterState', 'sourceVolume', 'withSpacingWeights', ...names, body + '; return sourceFilterStages;');
  const f = fn([key], { [key]: true }, { spacing }, withSpacingWeights, ...names.map(n => ({ value: vals[n] ?? (n.includes('Iterations') ? 4 : 0.5) })));
  return explicit ? f(spacing) : f();
};

// the pre-change kernel (isotropic, as on main) for exact comparison
function mainAniso(input, w, h, d, p) {
  const k2 = p.kappaHU ** 2, lambda = anisotropicLambda(p.strength), it = Math.max(1, Math.round(p.iterations));
  let a = new Float32Array(input), b = new Float32Array(a.length);
  for (let iter = 0; iter < it; iter++) {
    b.set(a);
    for (let z = 1; z < d - 1; z++) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = z * h * w + y * w + x, c = a[i]; let flux = 0;
      for (const nv of [a[i - 1], a[i + 1], a[i - w], a[i + w], a[i - w * h], a[i + w * h]]) { const diff = nv - c; flux += Math.exp(-(diff * diff) / Math.max(k2, 1e-6)) * diff; }
      b[i] = c + lambda * flux;
    }
    [a, b] = [b, a];
  }
  return a;
}
const rng = s => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const noisy = (nx, ny, nz, f, sd = 8, seed = 7) => {
  const r = rng(seed), g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const data = new Float32Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) data[(z * ny + y) * nx + x] = f(x, y, z) + g() * sd;
  return data;
};
const P = { strength: 0.6, kappaHU: 60, iterations: 4 };

describe('spacingParams (the values written to params[2..4] of the GPU kernels)', () => {
  it('returns [wx, wy, wz] of the stage in this order, [1, 1, 1] when the stage has no sp', () => {
    expect(spacingParams({ sp: [1, 1, 0.04] })).toEqual([1, 1, 0.04]);
    expect(spacingParams({ sp: [0.25, 1, 1] })).toEqual([0.25, 1, 1]);
    expect(spacingParams({ sp: [1, 0.36, 1] })).toEqual([1, 0.36, 1]);
    expect(spacingParams({ sp: [0.2, 0.3, 0.4] })).toEqual([0.2, 0.3, 0.4]);
    expect(spacingParams({})).toEqual([1, 1, 1]);
    expect(spacingParams({ strength: 0.5 })).toEqual([1, 1, 1]);
    expect(spacingParams(undefined)).toEqual([1, 1, 1]);
  });
  it('is what spacingWeights puts into a stage', () => {
    const st = withSpacingWeights({ key: 'tv', params: { weight: 0.3 } }, [0.5, 1, 2]);
    expect(spacingParams(st.params)).toEqual(spacingWeights([0.5, 1, 2]));
  });
});

describe('spacingWeights', () => {
  it('(hmin/h)^2 per axis, min axis has weight 1', () => {
    expect(spacingWeights([1, 1, 2])).toEqual([1, 1, 0.25]);
    expect(spacingWeights([1, 1, 5])).toEqual([1, 1, 0.04]);
    expect(spacingWeights([0.5, 0.5, 2])).toEqual([1, 1, 0.0625]);
    expect(spacingWeights([2, 1, 1])).toEqual([0.25, 1, 1]);
    for (const s of [[1, 1.5, 3], [0.7, 0.9, 1.25], [3, 2, 1]]) { const w = spacingWeights(s); expect(Math.max(...w)).toBe(1); for (const x of w) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThanOrEqual(1); } }
  });
  it('isotropic (within 1e-3 of 1), missing or unusable spacing gives null', () => {
    for (const s of [[1, 1, 1], [0.7, 0.7, 0.7], [0.5, 0.5, 0.5002], [0.5, 0.5, 0.4998], undefined, null, [], [1, 1], 'abc',
      [0, 1, 1], [1, 1, 0], [-1, 1, 1], [1, NaN, 1], [1, 1, undefined], [Infinity, 1, 1], ['x', 1, 1], [null, 1, 1]]) expect(spacingWeights(s), String(s)).toBeNull();
  });
  it('a clearly anisotropic spacing is detected (w off by 4%, beyond the 1e-3 tolerance)', () => {
    expect(spacingWeights([0.5, 0.5, 0.51])).not.toBeNull();
  });
  it('numeric strings are accepted like numbers', () => {
    expect(spacingWeights(['1', '1', '2'])).toEqual([1, 1, 0.25]);
  });
});

describe('stage params and signature', () => {
  it('spacing-aware filters: Anisotropic, TV, Gaussian, Bilateral, NLM, Unsharp (see spacing-more-filters.test.js)', () => { expect([...SPACING_AWARE_KEYS]).toEqual(['anisotropic', 'tv', 'gaussian', 'bilateral', 'nlm', 'unsharp']); });
  it('isotropic / missing / invalid spacing: stage params and signature are exactly those without spacing', () => {
    const base = stagesOf(undefined);
    expect(base[0].params.sp).toBeUndefined();
    expect(Object.keys(base[0].params)).toEqual(['strength', 'kappaHU', 'iterations']);
    for (const s of [[1, 1, 1], [0.8, 0.8, 0.8], null, [0, 1, 1], [1, 1, NaN], [-2, 1, 1], [1, 1]]) {
      const st = stagesOf(s);
      expect(st).toEqual(base);
      expect(Object.keys(st[0].params)).toEqual(Object.keys(base[0].params));
      expect(sourceFilterSignature(st)).toBe(sourceFilterSignature(base));
    }
  });
  it('anisotropic spacing adds sp, changes the signature; default argument takes sourceVolume.spacing', () => {
    const base = stagesOf(undefined), st = stagesOf([0.7, 0.7, 2.1]);
    expect(st[0].params.sp).toEqual([1, 1, 0.111111]);
    expect(sourceFilterSignature(st)).not.toBe(sourceFilterSignature(base));
    expect(stagesOf([0.7, 0.7, 2.1], 'anisotropic', false)).toEqual(st);
    expect(sourceFilterSignature(stagesOf([1, 1, 2]))).not.toBe(sourceFilterSignature(stagesOf([1, 1, 5])));
  });
  it('filters that are not spacing-aware never get sp', () => {
    for (const key of ['spikeHole', 'sigmoid']) expect(stagesOf([1, 1, 5], key)[0].params.sp).toBeUndefined();
  });
});

describe('isotropic data: output equals main exactly', () => {
  const n = 12, data = noisy(n, n, n, (x, y, z) => (x > 5 ? 40 : 0) + z);
  const want = mainAniso(data, n, n, n, P);
  const same = (a, b) => { expect(a.length).toBe(b.length); for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) throw new Error('differs at ' + i); };
  it('CPU, with and without spacing / sp', async () => {
    const v = (spacing) => ({ columns: n, rows: n, slices: n, data, spacing });
    for (const s of [undefined, [1, 1, 1], [0.6, 0.6, 0.6], [0, 1, 1]]) same((await cpuAnisotropicDiffusion(v(s), P)).data, want);
    same((await cpuAnisotropicDiffusion(v(undefined), { ...P, sp: [1, 1, 1] })).data, want);
  });
  it('worker, with and without sp', () => {
    same(worker.anisotropic(data, n, n, n, P), want);
    same(worker.anisotropic(data, n, n, n, { ...P, sp: [1, 1, 1] }), want);
  });
});

describe('weights are applied the same way by CPU, worker and WGSL', () => {
  const n = 10, data = noisy(n, n, n, (x, y, z) => (x > 4 ? 30 : 0) + (z > 4 ? 20 : 0), 6, 3);
  for (const sp of [[1, 1, 0.25], [1, 1, 0.04], [0.25, 1, 1], [1, 0.36, 0.0625]]) {
    it('sp ' + sp, async () => {
      const cpu = (await cpuAnisotropicDiffusion({ columns: n, rows: n, slices: n, data }, { ...P, sp })).data, wk = worker.anisotropic(data, n, n, n, { ...P, sp });
      for (let i = 0; i < cpu.length; i++) expect(Math.abs(cpu[i] - wk[i])).toBeLessThan(1e-4);
      // via the spacing of the volume: the same weights
      const h = sp.map(w => 1 / Math.sqrt(w)), viaSpacing = (await cpuAnisotropicDiffusion({ columns: n, rows: n, slices: n, data, spacing: h }, P)).data;
      for (let i = 0; i < cpu.length; i++) expect(Math.abs(cpu[i] - viaSpacing[i])).toBeLessThan(1e-3);
      // WGSL: evaluate the kernel body in JS for every interior voxel (one iteration) and compare with one CPU iteration
      const src = gpuFilterShader('anisotropic', 64), m = src.match(/let center=[\s\S]*?dst\[i\]=center\+lambda\*flux;/);
      expect(m).toBeTruthy();
      const js = m[0].replace(/\b(\d+)u\b/g, '$1').replace(/\bvar /g, 'let ').replace(/\bexp\(/g, 'Math.exp(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(').replace(/\bclamp\(/g, 'clampf(').replace(/dst\[i\]=center\+lambda\*flux;/, 'return center+lambda*flux;');
      const k = new Function('src', 'i', 'w', 'h', 'params', 'clampf', js);
      const clampf = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
      const one = (await cpuAnisotropicDiffusion({ columns: n, rows: n, slices: n, data }, { ...P, sp, iterations: 1 })).data;
      const params = Float32Array.from([P.strength, P.kappaHU, ...sp, 0, 0, 0]);
      for (let z = 1; z < n - 1; z++) for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const i = (z * n + y) * n + x;
        expect(Math.abs(k(data, i, n, n, params, clampf) - one[i])).toBeLessThan(1e-3);
      }
    });
  }
  it('GPU dispatch passes sp as params[2..4] (1,1,1 without sp)', () => {
    expect(gc).toMatch(/stage\.key==='anisotropic'\)\{const \[wx,wy,wz\]=spacingParams\(p\);[^}]*dispatch\('anisotropic',\[\],\[p\.strength,p\.kappaHU,wx,wy,wz\]\)/);
    expect(gpuFilterShader('anisotropic', 64)).toMatch(/let wx=params\[2\];let wy=params\[3\];let wz=params\[4\]/);
  });
});

describe('z blur in mm approaches the in-plane blur', () => {
  // z-edge phantom (slab edge perpendicular to z) and x-edge phantom, 1 mm in plane, hz mm slices, same noise; 10-90% edge width in mm
  const C = 40, S = 8, N = 40;
  const width = (v, nx, ny, nz, axis, hmm) => {
    const n = axis === 'x' ? nx : nz, prof = new Float64Array(n), cnt = axis === 'x' ? ny * nz : nx * ny;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) prof[axis === 'x' ? x : z] += v[(z * ny + y) * nx + x];
    for (let i = 0; i < n; i++) prof[i] /= cnt;
    const t = f => -C / 2 + f * C; let p10 = null, p90 = null;
    for (let i = 2; i < n - 3; i++) { if (p10 == null && prof[i] >= t(0.1)) p10 = i - 1 + (t(0.1) - prof[i - 1]) / (prof[i] - prof[i - 1]); if (p90 == null && prof[i] >= t(0.9)) p90 = i - 1 + (t(0.9) - prof[i - 1]) / (prof[i] - prof[i - 1]); }
    return (p90 - p10) * hmm;
  };
  const growth = async (hz, spacing) => {
    const nz = Math.max(24, Math.round(N / hz)), out = {};
    for (const axis of ['x', 'z']) {
      const data = noisy(N, N, nz, (x, y, z) => ((axis === 'x' ? x - N / 2 + 0.5 : (z - nz / 2 + 0.5) * hz) > 0 ? C / 2 : -C / 2), S, 11);
      const v = (await cpuAnisotropicDiffusion({ columns: N, rows: N, slices: nz, data, spacing }, { strength: 0.5, kappaHU: 60, iterations: 12 })).data;
      out[axis] = width(v, N, N, nz, axis, axis === 'x' ? 1 : hz) - width(data, N, N, nz, axis, axis === 'x' ? 1 : hz);
    }
    return out;
  };
  it.each([2, 5])('hz = %s mm: z growth (mm) is much closer to the in-plane growth with the weights', async hz => {
    const off = await growth(hz, undefined), on = await growth(hz, [1, 1, hz]);
    expect(off.z).toBeGreaterThan(off.x * (hz - 0.5)); // without weights the blur grows ~hz times more in mm
    expect(Math.abs(on.z - on.x)).toBeLessThan(Math.abs(off.z - off.x) * 0.5);
    expect(on.z).toBeLessThan(off.z);
  });
});

// ---- TV denoising: same weights, same lambda ----
const TP = { weight: 0.3, epsHU: 5, iterations: 4 };
function mainTv(input, w, h, d, p) {
  const eps = +p.epsHU, lambda = Math.min(0.18, 0.02 + p.weight * 0.45), it = Math.max(1, Math.round(p.iterations));
  let a = new Float32Array(input), b = new Float32Array(a.length);
  for (let iter = 0; iter < it; iter++) {
    b.set(a);
    for (let z = 1; z < d - 1; z++) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = z * h * w + y * w + x, c = a[i]; let flux = 0;
      for (const nv of [a[i - 1], a[i + 1], a[i - w], a[i + w], a[i - w * h], a[i + w * h]]) { const diff = nv - c; flux += diff / Math.sqrt(diff * diff + eps * eps); }
      b[i] = c + lambda * flux;
    }
    [a, b] = [b, a];
  }
  return a;
}
describe('TV denoising with spacing weights', () => {
  const n = 12, data = noisy(n, n, n, (x, y, z) => (x > 5 ? 40 : 0) + z);
  const want = mainTv(data, n, n, n, TP);
  const same = (a, b) => { expect(a.length).toBe(b.length); for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) throw new Error('differs at ' + i); };
  it('stage params / signature unchanged for isotropic or invalid spacing; sp added otherwise', () => {
    const base = stagesOf(undefined, 'tv');
    expect(Object.keys(base[0].params)).toEqual(['weight', 'epsHU', 'iterations']);
    for (const s of [[1, 1, 1], null, [0, 1, 1], [1, NaN, 1], [-1, 1, 1]]) {
      const st = stagesOf(s, 'tv');
      expect(st).toEqual(base); expect(sourceFilterSignature(st)).toBe(sourceFilterSignature(base));
    }
    const st = stagesOf([1, 1, 2], 'tv');
    expect(st[0].params.sp).toEqual([1, 1, 0.25]);
    expect(sourceFilterSignature(st)).not.toBe(sourceFilterSignature(base));
    expect(stagesOf([1, 1, 2], 'tv', false)).toEqual(st);
  });
  it('isotropic: CPU and worker output equal main exactly', async () => {
    for (const s of [undefined, [1, 1, 1], [0, 1, 1]]) same((await cpuTvDenoising3D({ columns: n, rows: n, slices: n, data, spacing: s }, TP)).data, want);
    same(workerAll.tv(data, n, n, n, TP), want);
    same(workerAll.tv(data, n, n, n, { ...TP, sp: [1, 1, 1] }), want);
  });
  for (const sp of [[1, 1, 0.25], [1, 1, 0.04], [0.25, 1, 1]]) {
    it('CPU, worker and WGSL agree for sp ' + sp, async () => {
      const cpu = (await cpuTvDenoising3D({ columns: n, rows: n, slices: n, data }, { ...TP, sp })).data, wk = workerAll.tv(data, n, n, n, { ...TP, sp });
      for (let i = 0; i < cpu.length; i++) expect(Math.abs(cpu[i] - wk[i])).toBeLessThan(1e-4);
      const h = sp.map(w => 1 / Math.sqrt(w)), via = (await cpuTvDenoising3D({ columns: n, rows: n, slices: n, data, spacing: h }, TP)).data;
      for (let i = 0; i < cpu.length; i++) expect(Math.abs(cpu[i] - via[i])).toBeLessThan(1e-3);
      const src = gpuFilterShader('tv', 64), m = src.match(/let center=[\s\S]*?dst\[i\]=center\+lambda\*flux;/);
      expect(m).toBeTruthy();
      const js = m[0].replace(/\b(\d+)u\b/g, '$1').replace(/\bvar /g, 'let ').replace(/\bsqrt\(/g, 'Math.sqrt(').replace(/\bmin\(/g, 'Math.min(').replace(/dst\[i\]=center\+lambda\*flux;/, 'return center+lambda*flux;');
      const k = new Function('src', 'i', 'w', 'h', 'params', js);
      const one = (await cpuTvDenoising3D({ columns: n, rows: n, slices: n, data }, { ...TP, sp, iterations: 1 })).data;
      const params = Float32Array.from([TP.weight, TP.epsHU, ...sp, 0, 0, 0]);
      for (let z = 1; z < n - 1; z++) for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const i = (z * n + y) * n + x;
        expect(Math.abs(k(data, i, n, n, params) - one[i])).toBeLessThan(1e-3);
      }
    });
  }
  it('GPU dispatch passes sp as params[2..4]', () => {
    expect(gc).toMatch(/stage\.key==='tv'\)\{const \[wx,wy,wz\]=spacingParams\(p\);[^}]*dispatch\('tv',\[\],\[p\.weight,p\.epsHU,wx,wy,wz\]\)/);
  });
  it.each([2, 5])('hz = %s mm: z blur (mm) gets closer to the in-plane blur with the weights', async hz => {
    const N = 40, C = 40, nz = Math.max(24, Math.round(N / hz));
    const width = (v, axis) => {
      const nn = axis === 'x' ? N : nz, prof = new Float64Array(nn), cnt = axis === 'x' ? N * nz : N * N;
      for (let z = 0; z < nz; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) prof[axis === 'x' ? x : z] += v[(z * N + y) * N + x];
      for (let i = 0; i < nn; i++) prof[i] /= cnt;
      const t = f => -C / 2 + f * C; let p10 = null, p90 = null;
      for (let i = 2; i < nn - 3; i++) { if (p10 == null && prof[i] >= t(0.1)) p10 = i - 1 + (t(0.1) - prof[i - 1]) / (prof[i] - prof[i - 1]); if (p90 == null && prof[i] >= t(0.9)) p90 = i - 1 + (t(0.9) - prof[i - 1]) / (prof[i] - prof[i - 1]); }
      return (p90 - p10) * (axis === 'x' ? 1 : hz);
    };
    const growth = async spacing => {
      const out = {};
      for (const axis of ['x', 'z']) {
        const d0 = noisy(N, N, nz, (x, y, z) => ((axis === 'x' ? x - N / 2 + 0.5 : (z - nz / 2 + 0.5) * hz) > 0 ? C / 2 : -C / 2), 8, 11);
        const v = (await cpuTvDenoising3D({ columns: N, rows: N, slices: nz, data: d0, spacing }, { weight: 0.3, epsHU: 5, iterations: 12 })).data;
        out[axis] = width(v, axis) - width(d0, axis);
      }
      return out;
    };
    const off = await growth(undefined), on = await growth([1, 1, hz]);
    expect(Math.abs(on.z - on.x)).toBeLessThan(Math.abs(off.z - off.x) * 0.5);
    expect(on.z).toBeLessThan(off.z);
  });
});
