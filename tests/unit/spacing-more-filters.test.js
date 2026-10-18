import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cpuGaussian3D, cpuBilateral3D, cpuNlm3D, cpuUnsharpMask3D } from '../../docs/cpu-filters.js';
import { gpuFilterShader, gaussianPassKernel } from '../../docs/gpu-shaders.js';
import { boxBlur3D } from '../../docs/mask-ops.js';
import { spacingParams, spacingRatios, bilateralRadii, nlmRadii, unsharpAxes, withSpacingWeights, sourceFilterSignature } from '../../docs/filter-units.js';

// Spacing weights for Gaussian, Bilateral, NLM and Unsharp (second PR after Anisotropic / TV): radii and sigmas that were
// counted in voxels now cover the same distance in mm along every axis. Isotropic data (or no spacing): nothing changes.
const sf = readFileSync(new URL('../../docs/source-filters.js', import.meta.url), 'utf8');
const gc = readFileSync(new URL('../../docs/gpu-compute.js', import.meta.url), 'utf8');
const worker = (() => {
  const a = sf.indexOf('export function sourceFilterWorkerMain(){'), b = sf.indexOf(' function extract(');
  return new Function(sf.slice(a, b).replace('export function sourceFilterWorkerMain(){', '') + '; return {gaussian, bilateral, nlm, unsharp, median};')();
})();
const stagesOf = (spacing, key, extra = {}) => {
  const a = sf.indexOf('export function sourceFilterStages('), b = sf.indexOf('export function sourceFilterHalo');
  const body = sf.slice(a, b).replace('export function', 'function');
  const names = [...new Set([...body.matchAll(/\b(\w+)\.value\b/g)].map(m => m[1]))];
  const vals = { smoothingType: 'gaussian', ...extra };
  const fn = new Function('filterOrder', 'filterState', 'sourceVolume', 'withSpacingWeights', ...names, body + '; return sourceFilterStages;');
  return fn([key], { [key]: true }, { spacing }, withSpacingWeights, ...names.map(n => ({ value: vals[n] ?? 0.5 })))(spacing);
};

const rng = s => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const noisy = (nx, ny, nz, f, sd = 8, seed = 7) => {
  const r = rng(seed), g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const data = new Float32Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) data[(z * ny + y) * nx + x] = f(x, y, z) + g() * sd;
  return data;
};
const same = (a, b, what = '') => { expect(a.length).toBe(b.length); for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) throw new Error(what + ' differs at ' + i + ': ' + a[i] + ' vs ' + b[i]); };
const close = (a, b, tol, what = '') => { expect(a.length).toBe(b.length); for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i] - b[i]) <= tol)) throw new Error(what + ' differs at ' + i + ': ' + a[i] + ' vs ' + b[i]); };
const vol = (n, data, spacing) => ({ columns: n, rows: n, slices: n, data, spacing });

// ---- main's kernels (isotropic, voxel units), copied from before this change, for exact comparison ----
function refGaussian(input, w, h, d, p) {
  const s = p.strength, r = Math.max(1, Math.round(p.passes)); let a = new Float32Array(input), b = new Float32Array(input.length);
  for (let rr = 0; rr < r; rr++) for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = z * h * w + y * w + x, x0 = Math.max(0, x - dx), x1 = Math.min(w - 1, x + dx), y0 = Math.max(0, y - dy), y1 = Math.min(h - 1, y + dy), z0 = Math.max(0, z - dz), z1 = Math.min(d - 1, z + dz);
      b[i] = a[i] * (1 - s) + (a[z0 * h * w + y0 * w + x0] + 2 * a[i] + a[z1 * h * w + y1 * w + x1]) * .25 * s;
    }
    const t = a; a = b; b = t;
  }
  return a;
}
function refBilateral(input, w, h, d, p) {
  const s = p.strength, ss = p.spatialSigma, is = Math.max(1e-6, +p.sigmaHU), passes = Math.max(1, Math.round(p.passes)), r = Math.max(1, Math.min(3, Math.ceil(ss * 1.5))), sp2 = 2 * ss * ss, int2 = 2 * is * is;
  let a = new Float32Array(input), b = new Float32Array(input.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = z * h * w + y * w + x, c = a[i]; let sum = 0, wsum = 0;
      for (let dz = -r; dz <= r; dz++) { const zz = z + dz; if (zz < 0 || zz >= d) continue;
        for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const j = zz * h * w + yy * w + xx, dv = a[j] - c, ww = Math.exp(-(dx * dx + dy * dy + dz * dz) / sp2) * Math.exp(-(dv * dv) / int2); sum += a[j] * ww; wsum += ww; } } }
      b[i] = c * (1 - s) + (wsum ? sum / wsum : c) * s;
    }
    const t = a; a = b; b = t;
  }
  return a;
}
function refNlm(input, w, h, d, p) {
  const out = new Float32Array(input), h2 = (+p.hHU) ** 2, sr = Math.max(1, Math.round(p.searchRadius)), pr = Math.max(0, Math.round(p.patchRadius)), offs = [];
  for (let dz = -sr; dz <= sr; dz++) for (let dy = -sr; dy <= sr; dy++) for (let dx = -sr; dx <= sr; dx++) if (dx || dy || dz) offs.push([dx, dy, dz]);
  const patch = [[0, 0, 0]]; for (let r = 1; r <= pr; r++) patch.push([r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]);
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), sample = (x, y, z) => input[cl(z, 0, d - 1) * h * w + cl(y, 0, h - 1) * w + cl(x, 0, w - 1)];
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let weighted = input[z * h * w + y * w + x], ws = 1;
    for (const [dx, dy, dz] of offs) {
      const nx = x + dx, ny = y + dy, nz = z + dz; if (nx < 0 || ny < 0 || nz < 0 || nx >= w || ny >= h || nz >= d) continue;
      let dist = 0; for (const [px, py, pz] of patch) { const dv = sample(x + px, y + py, z + pz) - sample(nx + px, ny + py, nz + pz); dist += dv * dv; }
      dist /= patch.length; const weight = Math.exp(-dist / Math.max(h2, 1e-6)); weighted += weight * input[nz * h * w + ny * w + nx]; ws += weight;
    }
    out[z * h * w + y * w + x] = weighted / ws;
  }
  return out;
}
function refUnsharp(input, w, h, d, p) {
  const r = Math.max(1, Math.round(p.radius)), blur = new Float32Array(input.length), out = new Float32Array(input.length), th = +p.thresholdHU;
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, count = 0;
    for (let dz = -r; dz <= r; dz++) { const zz = z + dz; if (zz < 0 || zz >= d) continue;
      for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; sum += input[zz * h * w + yy * w + xx]; count++; } } }
    blur[z * h * w + y * w + x] = sum / Math.max(1, count);
  }
  for (let i = 0; i < input.length; i++) { const detail = input[i] - blur[i]; out[i] = Math.abs(detail) >= th ? input[i] + p.amount * detail : input[i]; }
  return out;
}

const PARAMS = {
  gaussian: { mode: 'gaussian', strength: 0.5, passes: 2 },
  bilateral: { strength: 0.8, spatialSigma: 1.2, sigmaHU: 50, passes: 2 },
  nlm: { hHU: 40, searchRadius: 2, patchRadius: 1 },
  unsharp: { radius: 2, amount: 0.8, thresholdHU: 5 },
};
const REF = { gaussian: refGaussian, bilateral: refBilateral, nlm: refNlm, unsharp: refUnsharp };
const CPU = { gaussian: cpuGaussian3D, bilateral: cpuBilateral3D, nlm: cpuNlm3D, unsharp: cpuUnsharpMask3D };
const KEYS = Object.keys(PARAMS);

describe('stage params and signature', () => {
  it('isotropic / missing / invalid spacing: stage params and signature are exactly those without spacing', () => {
    for (const key of KEYS) {
      const base = stagesOf(undefined, key);
      expect(base[0].params.sp).toBeUndefined();
      for (const s of [[1, 1, 1], [0.8, 0.8, 0.8], null, [0, 1, 1], [1, 1, NaN], [-2, 1, 1], [1, 1]]) {
        const st = stagesOf(s, key);
        expect(st, key + ' ' + s).toEqual(base);
        expect(Object.keys(st[0].params)).toEqual(Object.keys(base[0].params));
        expect(sourceFilterSignature(st)).toBe(sourceFilterSignature(base));
      }
    }
  });
  it('anisotropic spacing adds sp (w = (hmin/h)^2) and changes the signature', () => {
    for (const key of KEYS) {
      const base = stagesOf(undefined, key), st = stagesOf([0.5, 0.5, 2.5], key);
      expect(st[0].params.sp, key).toEqual([1, 1, 0.04]);
      expect(sourceFilterSignature(st)).not.toBe(sourceFilterSignature(base));
      expect(sourceFilterSignature(stagesOf([1, 1, 2], key))).not.toBe(sourceFilterSignature(stagesOf([1, 1, 5], key)));
    }
  });
  it('Gaussian in Median mode (not spacing-aware) keeps its stage and signature', () => {
    const base = stagesOf(undefined, 'gaussian', { smoothingType: 'median' }), st = stagesOf([1, 1, 5], 'gaussian', { smoothingType: 'median' });
    expect(st).toEqual(base); expect(st[0].params.sp).toBeUndefined();
  });
});

describe('helpers', () => {
  it('ratios hmin/h = sqrt(w); [1,1,1] without sp', () => {
    expect(spacingRatios({ sp: [1, 1, 0.25] })).toEqual([1, 1, 0.5]);
    expect(spacingRatios({})).toEqual([1, 1, 1]);
  });
  it('bilateralRadii: isotropic = main (max(1, min(3, ceil(1.5 sigma)))), a coarse axis gets clamp(ceil(1.5 sigma r), 0, 3)', () => {
    for (const ss of [0.2, 0.7, 1, 1.2, 2, 2.5, 5]) expect(bilateralRadii(ss, [1, 1, 1])).toEqual(Array(3).fill(Math.max(1, Math.min(3, Math.ceil(ss * 1.5)))));
    expect(bilateralRadii(1.2, [1, 1, 0.5])).toEqual([2, 2, 1]);
    expect(bilateralRadii(1.2, [1, 1, 0.2])).toEqual([2, 2, 1]);
    expect(bilateralRadii(2.5, [1, 1, 0.2])).toEqual([3, 3, 1]);
    expect(bilateralRadii(0.1, [1, 1, 0.01])).toEqual([1, 1, 1]); // ceil(0.0015) = 1
    expect(bilateralRadii(0, [1, 1, 0.5])).toEqual([1, 1, 0]);
  });
  it('nlmRadii: round(r * ratio); z can reach 0', () => {
    expect(nlmRadii(2, 1, [1, 1, 1])).toEqual({ sr: [2, 2, 2], pr: [1, 1, 1] });
    expect(nlmRadii(0, 0, [1, 1, 1])).toEqual({ sr: [1, 1, 1], pr: [0, 0, 0] });
    expect(nlmRadii(3, 1, [1, 1, 0.5])).toEqual({ sr: [3, 3, 2], pr: [1, 1, 1] });
    expect(nlmRadii(3, 2, [1, 1, 0.2])).toEqual({ sr: [3, 3, 1], pr: [2, 2, 0] });
    expect(nlmRadii(1, 1, [1, 1, 0.2])).toEqual({ sr: [1, 1, 0], pr: [1, 1, 0] });
  });
  it('unsharpAxes: isotropic = K R and A = R + 0.5 (all taps weight 1); K never exceeds R (halo is enough)', () => {
    for (const R of [1, 2, 3, 5]) for (const ax of unsharpAxes(R, [1, 1, 1])) { expect(ax.K).toBe(R); expect(ax.A).toBe(R + 0.5); }
    for (const r of [0.9, 0.5, 0.2, 0.1, 0.01]) for (const R of [1, 3, 7]) for (const ax of unsharpAxes(R, [1, 1, r])) expect(ax.K).toBeLessThanOrEqual(R);
    expect(unsharpAxes(3, [1, 1, 0.5]).map(a => a.K)).toEqual([3, 3, 2]);
  });
  it('the halo of sourceFilterHalo (voxels of the finest axis) covers every per-axis reach', () => {
    const a = sf.indexOf('export function sourceFilterHalo'), b = sf.indexOf('export function sourceFilterSignature'), halo = new Function(sf.slice(a, b).replace('export function', 'function') + '; return sourceFilterHalo;')();
    for (const sp of [[1, 1, 0.25], [1, 1, 0.04], [0.25, 1, 1], [0.36, 0.5, 1]]) {
      const ratios = spacingRatios({ sp });
      for (const [key, p] of Object.entries(PARAMS)) {
        const params = { ...p, sp, spatialSigma: 2.5, searchRadius: 3, patchRadius: 2, radius: 5 }, h = halo([{ key, params }]);
        let need = 0;
        if (key === 'bilateral') need = Math.max(...bilateralRadii(params.spatialSigma, ratios)) * params.passes;
        if (key === 'nlm') { const r = nlmRadii(params.searchRadius, params.patchRadius, ratios); need = Math.max(...r.sr) + Math.max(...r.pr); }
        if (key === 'unsharp') need = Math.max(...unsharpAxes(params.radius, ratios).map(a => a.K));
        if (key === 'gaussian') need = params.passes;
        expect(h, key + ' ' + sp).toBeGreaterThanOrEqual(need);
      }
    }
  });
});

describe('isotropic data (or no spacing): output equals main exactly (bit for bit)', () => {
  const n = 9, data = noisy(n, n, n, (x, y, z) => (x > 4 ? 40 : 0) + z * 3, 12);
  for (const key of KEYS) {
    const want = REF[key](data, n, n, n, PARAMS[key]);
    it(key + ': CPU with / without spacing or sp', async () => {
      for (const s of [undefined, [1, 1, 1], [0.6, 0.6, 0.6], [0, 1, 1], null]) same((await CPU[key](vol(n, data, s), PARAMS[key])).data, want, key);
      same((await CPU[key](vol(n, data, undefined), { ...PARAMS[key], sp: [1, 1, 1] })).data, want, key + ' sp=1');
    });
    it(key + ': worker with / without sp', () => {
      same(worker[key](data, n, n, n, PARAMS[key]), want, key);
      same(worker[key](data, n, n, n, { ...PARAMS[key], sp: [1, 1, 1] }), want, key + ' sp=1');
    });
  }
  it('boxBlur3D (used by the CPU Unsharp; app.js only imports it) is unchanged without sp', async () => {
    const v = vol(n, data), a = await boxBlur3D(v, 2), b = await boxBlur3D(v, 2, null), c = await boxBlur3D(v, 2, [1, 1, 1]);
    same(a, b); same(a, c); // sp = [1,1,1] takes the weighted path (weights are all 1 there): same, bit for bit
  });
});

describe('CPU, worker and WGSL treat the weights the same way', () => {
  const n = 10, data = noisy(n, n, n, (x, y, z) => (x > 4 ? 30 : 0) + (z > 4 ? 20 : 0), 9, 3);
  const SPS = [[1, 1, 0.25], [1, 1, 0.04], [0.25, 1, 1], [1, 0.36, 0.0625]];
  for (const sp of SPS) for (const key of KEYS) {
    it(key + ' CPU = worker, and CPU via volume spacing = via sp, for sp ' + sp, async () => {
      const p = { ...PARAMS[key], sp }, cpu = (await CPU[key](vol(n, data), p)).data, wk = worker[key](data, n, n, n, p);
      close(cpu, wk, 1e-4, key);
      const h = sp.map(w => 1 / Math.sqrt(w)), via = (await CPU[key](vol(n, data, h), PARAMS[key])).data;
      close(cpu, via, 1e-2, key + ' via spacing');
      // the filter really reacts to sp (not a no-op)
      const iso = (await CPU[key](vol(n, data), PARAMS[key])).data; let diff = 0; for (let i = 0; i < iso.length; i++) diff = Math.max(diff, Math.abs(iso[i] - cpu[i]));
      expect(diff, key + ' reacts to sp').toBeGreaterThan(1e-3);
    });
  }

  // ---- WGSL: the kernel body evaluated in JS for every voxel, with the meta / params the dispatch in gpu-compute.js writes ----
  function wgslKernel(kind) {
    const src = gpuFilterShader(kind, 64), m = src.match(/fn main\(@builtin\(global_invocation_id\) gid:vec3<u32>\)\s*\{([\s\S]*)\}\s*$/);
    expect(m, kind).toBeTruthy();
    const js = m[1].replace(/\b(\d+)u\b/g, '$1').replace(/\bvar\s+(\w+)\s*:\s*\w+/g, 'let $1').replace(/\bvar\b/g, 'let')
      .replace(/\blet (\w+)=(c|coord\(i\));/g, 'let $1={...$2};').replace(/\blet\s+(\w+)=vec3<\w+>\(coord\(i\)\)/, 'let $1={...coord(i)}').replace(/vec3<\w+>\(/g, 'vec3(').replace(/let i=gid\.x;/, 'let i=gid;');
    return new Function('src', 'dst', 'meta', 'params', 'orig', 'gid', 'coord', 'idx', 'cidx', 'vec3', 'min', 'max', 'abs', 'exp', 'clamp', 'select', 'f32', 'i32', 'u32', js.replace(/let i=gid;/, 'let i=gid;'));
  }
  const run = (kind, w, h, d, input, extra, params, orig) => {
    const n3 = w * h * d, meta = [w, h, d, n3, ...extra, 0, 0, 0, 0].slice(0, 8), dst = new Float64Array(n3), k = wgslKernel(kind);
    const coord = i => ({ x: i % w, y: Math.floor(i / w) % h, z: Math.floor(i / (w * h)) }), idx = (x, y, z) => z * w * h + y * w + x;
    const cidx = (x, y, z) => idx(Math.min(w - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y)), Math.min(d - 1, Math.max(0, z)));
    const vec3 = (x, y, z) => ({ x, y, z }), P = Float32Array.from([...params, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (let g = 0; g < n3; g++) k(input, dst, meta, P, orig, g, coord, idx, cidx, vec3, Math.min, Math.max, Math.abs, Math.exp, (x, lo, hi) => Math.min(hi, Math.max(lo, x)), (a, b, c) => c ? b : a, x => x, x => Math.trunc(x), x => Math.trunc(x));
    return dst;
  };
  // the dispatch sequence of gpu-compute.js, replayed with the same helpers (the source is pinned to it below)
  const gpuGaussian = (p) => { let a = Float64Array.from(data); const sw = spacingParams(p); for (let axis = 0; axis < 3; axis++) { const kernel = gaussianPassKernel(p.strength * sw[axis], p.passes); a = run('gaussianK', n, n, n, a, [axis, (kernel.length - 1) / 2], kernel); } return a; };
  const gpuBilateral = (p) => { const [bx, by, bz] = bilateralRadii(p.spatialSigma, spacingRatios(p)), [wx, wy, wz] = spacingParams(p); let a = Float64Array.from(data); for (let q = 0; q < p.passes; q++) a = run('bilateral', n, n, n, a, [bx, by, bz], [p.strength, p.spatialSigma, p.sigmaHU, 1 / wx, 1 / wy, 1 / wz]); return a; };
  const gpuNlm = (p) => { const { sr: [a, b, c], pr: [d, e, f] } = nlmRadii(p.searchRadius, p.patchRadius, spacingRatios(p)); return run('nlm', n, n, n, Float64Array.from(data), [a, b, c], [p.hHU, d, e, f]); };
  const gpuUnsharp = (p) => { const [ux, uy, uz] = unsharpAxes(p.radius, spacingRatios(p)); const x = run('boxMean', n, n, n, Float64Array.from(data), [0, ux.K], [0, ux.A]), xy = run('boxMean', n, n, n, x, [1, uy.K], [0, uy.A]); return run('unsharpCombine', n, n, n, xy, [0, uz.K], [p.amount, p.thresholdHU, uz.A], Float64Array.from(data)); };
  const GPU = { gaussian: gpuGaussian, bilateral: gpuBilateral, nlm: gpuNlm, unsharp: gpuUnsharp };
  const tol = { gaussian: 2e-3, bilateral: 5e-2, nlm: 5e-2, unsharp: 5e-2 };
  // Gaussian: the fused kernel equals the passes away from the volume edge only (as before); the others compare everywhere
  const inside = (i, m) => { const x = i % n, y = Math.floor(i / n) % n, z = Math.floor(i / (n * n)); return [x, y, z].every(q => q >= m && q < n - m); };
  for (const sp of [undefined, ...SPS]) for (const key of KEYS) {
    it('WGSL ' + key + ' = CPU, sp ' + (sp ?? 'none (isotropic)'), async () => {
      const p = { ...PARAMS[key], ...(sp ? { sp } : {}) }, cpu = (await CPU[key](vol(n, data), p)).data, gpu = GPU[key](p), margin = key === 'gaussian' ? p.passes : 0;
      let worst = 0; for (let i = 0; i < cpu.length; i++) if (inside(i, margin)) worst = Math.max(worst, Math.abs(cpu[i] - gpu[i]));
      expect(worst, key).toBeLessThan(tol[key]);
    });
  }
  it('sabotage: a GPU path that ignores sp is caught by the comparison above', async () => {
    const sp = [1, 1, 0.04];
    for (const key of ['bilateral', 'nlm', 'unsharp']) {
      const cpu = (await CPU[key](vol(n, data), { ...PARAMS[key], sp })).data, gpu = GPU[key](PARAMS[key]); let worst = 0; for (let i = 0; i < cpu.length; i++) worst = Math.max(worst, Math.abs(cpu[i] - gpu[i]));
      expect(worst, key).toBeGreaterThan(tol[key]);
    }
    const cpu = (await cpuGaussian3D(vol(n, data), { ...PARAMS.gaussian, sp })).data, gpu = gpuGaussian(PARAMS.gaussian); let worst = 0; for (let i = 2; i < cpu.length; i++) if (inside(i, 2)) worst = Math.max(worst, Math.abs(cpu[i] - gpu[i]));
    expect(worst).toBeGreaterThan(tol.gaussian);
  });

  it('gpu-compute.js dispatches what the replay above does', () => {
    expect(gc).toMatch(/const sw=spacingParams\(p\);\s*for\(let axis=0;axis<3;axis\+\+\)\{const kernel=gaussianPassKernel\(p\.strength\*sw\[axis\],p\.passes\)/);
    expect(gc).toMatch(/const \[bx,by,bz\]=bilateralRadii\(p\.spatialSigma,spacingRatios\(p\)\),\[wx,wy,wz\]=spacingParams\(p\),ix=1\/wx,iy=1\/wy,iz=1\/wz;/);
    expect(gc).toContain("dispatch('bilateral',[bx,by,bz],[p.strength,p.spatialSigma,p.sigmaHU,ix,iy,iz])");
    expect(gc).toMatch(/const \{sr:\[srx,sry,srz\],pr:\[prx,pry,prz\]\}=nlmRadii\(p\.searchRadius,p\.patchRadius,spacingRatios\(p\)\);/);
    expect(gc).toContain("dispatch('nlm',[srx,sry,srz],[p.hHU,prx,pry,prz])");
    expect(gc).toMatch(/const \[ux,uy,uz\]=unsharpAxes\(p\.radius,spacingRatios\(p\)\)/);
    expect(gc).toContain("dispatch('boxMean',[0,ux.K],[0,ux.A])");
    expect(gc).toContain("dispatch('boxMean',[1,uy.K],[0,uy.A])");
    expect(gc).toContain("dispatch('unsharpCombine',[0,uz.K],[p.amount,p.thresholdHU,uz.A]");
  });
});

describe('reach in mm along z approaches the in-plane reach', () => {
  const N = 31, C = 15, idx = (x, y, z) => (z * N + y) * N + x, nvox = N ** 3;
  const impulse = amp => { const v = new Float32Array(nvox); v[idx(C, C, C)] = amp; return v; };
  const mk = (data, spacing) => ({ columns: N, rows: N, slices: N, data, spacing });
  const footprint = (o, i, tol) => { const r = [0, 0, 0]; for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const k = idx(x, y, z); if (Math.abs(o[k] - i[k]) > tol) { r[0] = Math.max(r[0], Math.abs(x - C)); r[1] = Math.max(r[1], Math.abs(y - C)); r[2] = Math.max(r[2], Math.abs(z - C)); } } return r; };
  const sigma = o => { const q = [0, 0, 0]; let tot = 0; for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const w = o[idx(x, y, z)]; tot += w; q[0] += w * (x - C) ** 2; q[1] += w * (y - C) ** 2; q[2] += w * (z - C) ** 2; } return q.map(s => Math.sqrt(s / tot)); };
  const HXY = 0.5;

  // `filter(spacing, useSp)` returns the filtered impulse; reach(out) returns [xy, z] in mm; the check is the same for the real filter and for sabotaged ones
  const checkApproach = async (hz, measure) => {
    const spacing = [HXY, HXY, hz], off = await measure(spacing, false), on = await measure(spacing, true);
    expect(off.z, 'without sp the z reach in mm is ~hz/hxy times the in-plane one').toBeGreaterThan(off.xy * (hz / HXY) * 0.6);
    expect(Math.abs(on.z - on.xy), 'with sp').toBeLessThan(Math.abs(off.z - off.xy) * 0.5);
    return { off, on };
  };
  const gaussMeasure = async (spacing, useSp) => { const o = (await cpuGaussian3D(mk(impulse(1000), useSp ? spacing : undefined), { strength: 0.4, passes: 2 })).data, s = sigma(o); return { xy: s[0] * HXY, z: s[2] * spacing[2] }; };
  const bilMeasure = async (spacing, useSp) => { const v = impulse(1000), o = (await cpuBilateral3D(mk(v, useSp ? spacing : undefined), { strength: 1, spatialSigma: 2, sigmaHU: 1e6, passes: 1 })).data, f = footprint(o, v, 1e-6); return { xy: f[0] * HXY, z: f[2] * spacing[2] }; };
  const nlmMeasure = async (spacing, useSp) => { const v = impulse(1000), o = (await cpuNlm3D(mk(v, useSp ? spacing : undefined), { hHU: 1e6, searchRadius: 3, patchRadius: 0 })).data, f = footprint(o, v, 1e-6); return { xy: f[0] * HXY, z: f[2] * spacing[2] }; };
  const unsharpMeasure = async (spacing, useSp) => { const v = impulse(1000), o = (await cpuUnsharpMask3D(mk(v, useSp ? spacing : undefined), { radius: 3, amount: 1, thresholdHU: 0 })).data, f = footprint(o, v, 1e-6); return { xy: f[0] * HXY, z: f[2] * spacing[2] }; };

  it.each([2, 5])('Gaussian, hz = %s mm: the z sigma in mm equals the in-plane one', async hz => {
    const { on, off } = await checkApproach(hz, gaussMeasure);
    expect(on.z / on.xy).toBeGreaterThan(0.97); expect(on.z / on.xy).toBeLessThan(1.03);
    expect(off.z / off.xy).toBeGreaterThan(hz / HXY * 0.97);
  });
  it.each([2, 5])('Bilateral, hz = %s mm: z reach (mm) within one z-voxel of the in-plane reach', async hz => {
    const { on, off } = await checkApproach(hz, bilMeasure);
    expect(Math.abs(on.z - on.xy)).toBeLessThanOrEqual(hz); expect(off.z).toBe(off.xy * hz / HXY);
  });
  it.each([2, 5])('NLM, hz = %s mm: z search reach (mm) close to the in-plane one (z may drop to a 2D search)', async hz => {
    const { on } = await checkApproach(hz, nlmMeasure);
    expect(Math.abs(on.z - on.xy)).toBeLessThanOrEqual(hz);
    if (hz === 5) expect(on.z).toBe(0);
  });
  it.each([2, 5])('Unsharp, hz = %s mm: box half-width in z (mm) matches the in-plane one', async hz => {
    const { on } = await checkApproach(hz, unsharpMeasure);
    expect(Math.abs(on.z - on.xy)).toBeLessThanOrEqual(hz);
    // effective half-width in mm: A * h_z = (R + 0.5) * hmin on every axis
    expect(unsharpAxes(3, spacingRatios({ sp: [1, 1, (HXY / hz) ** 2] }))[2].A * hz).toBeCloseTo(3.5 * HXY, 9);
  });
  it('sabotage: filters that ignore sp fail the same check', { timeout: 60000 }, async () => {
    const ignoring = measure => (spacing) => measure(spacing, false);
    for (const measure of [gaussMeasure, bilMeasure, nlmMeasure, unsharpMeasure]) {
      await expect(checkApproach(2, async (spacing, useSp) => ignoring(measure)(spacing, useSp))).rejects.toThrow();
    }
  });
  it('sabotage: dropping the z scaling of one filter (z axis treated like x) fails', async () => {
    // e.g. a Gaussian that uses s_x for z as well: z sigma in mm is hz/hxy times too large
    await expect(checkApproach(2, async (spacing, useSp) => { const m = await gaussMeasure(spacing, false); return m; })).rejects.toThrow();
  });
});
