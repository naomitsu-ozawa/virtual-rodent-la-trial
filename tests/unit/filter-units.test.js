import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as K from '../../docs/cpu-filters.js';
import { sourceRangeFromMetadata } from '../../docs/dicom.js';
import { FILTER_UNITS, isValidUnitValue, filterLegacyRange, legacyFilterValueHU, resolveFilterParams, sourceFilterSignature } from '../../docs/filter-units.js';
import { segmentRunsCacheKey } from '../../docs/segment-cache-key.js';
import { packProject, unpackProject } from '../../docs/project-file.js';

// Builds 445-447: filter strengths that used to be fractions of (v.max - v.min) are absolute HU values.
const read = p => readFileSync(p, 'utf8');
const sf = read('docs/source-filters.js');

const noisy = (min, max) => {
  const w = 6, h = 5, d = 5, data = new Float32Array(w * h * d);
  for (let i = 0; i < data.length; i++) data[i] = -100 + ((i * 7919) % 97) * 3 + (i % 5 === 0 ? 400 : 0);
  return { columns: w, rows: h, slices: d, data, min, max };
};
// stage params of each HU-based filter as sourceFilterStages() builds them
const PARAMS = {
  spikeHole: { strength: 0.7, thresholdHU: 100 },
  nlm: { hHU: 40, searchRadius: 1, patchRadius: 1 },
  anisotropic: { strength: 0.45, kappaHU: 60, iterations: 3 },
  tv: { weight: 0.12, epsHU: 1, iterations: 3 },
  unsharp: { radius: 1, amount: 0.8, thresholdHU: 60 },
};
const CPU = { spikeHole: 'cpuSpikeHole', nlm: 'cpuNlm3D', anisotropic: 'cpuAnisotropicDiffusion', tv: 'cpuTvDenoising3D', unsharp: 'cpuUnsharpMask3D' };
const series = { id: 's::1', columns: 8, rows: 6, spacingX: 0.05, spacingY: 0.05, spacingZ: 0.1, slices: [{ studyUid: 's', seriesUid: '1' }, {}, {}] };
const practiceSlices = [{ bits: 16, bitsStored: 16, signed: false, slope: 1, intercept: -4000 }];
const practice = sourceRangeFromMetadata(practiceSlices); // -4000 .. 61535

// the worker kernels, evaluated from the source text (sourceFilterWorkerMain is stringified into a worker in the app)
const kernels = (() => {
  const a = sf.indexOf('export function sourceFilterWorkerMain(){'), b = sf.indexOf(' function extract(');
  const body = sf.slice(a, b).replace('export function sourceFilterWorkerMain(){', '');
  return new Function(body + '; return {spike,nlm,anisotropic,tv,unsharp,sigmoid,bilateral,stage};')();
})();

describe('the five filters no longer depend on v.min / v.max (CPU)', () => {
  it.each(Object.keys(CPU))('%s gives the same output for any range', async key => {
    const a = await K[CPU[key]](noisy(-1361, 3102), PARAMS[key]);
    const b = await K[CPU[key]](noisy(-4000, 61535), PARAMS[key]);
    expect([...b.data]).toEqual([...a.data]);
  });
  it.each(Object.keys(CPU))('%s reacts to its HU parameter (the test is not vacuous)', async key => {
    const name = Object.keys(FILTER_UNITS[key].params)[0];
    const make = () => { const v = noisy(0, 1); if (key === 'spikeHole') { v.data.fill(0); v.data[2 * 30 + 2 * 6 + 3] = 400; } return v; }; // an isolated spike for Spike/Hole
    const a = await K[CPU[key]](make(), PARAMS[key]);
    const b = await K[CPU[key]](make(), { ...PARAMS[key], [name]: PARAMS[key][name] * 8 });
    expect([...b.data]).not.toEqual([...a.data]);
  });
});

describe('worker kernels (build 447)', () => {
  it('take no min / max and use the HU parameters', () => {
    const fns = ['spike', 'nlm', 'anisotropic', 'tv', 'unsharp', 'sigmoid', 'bilateral', 'stage'];
    for (const n of fns) {
      const m = sf.match(new RegExp(' function ' + n + '\\(([^)]*)\\)'));
      expect(m, n).toBeTruthy();
      expect(m[1], n).not.toMatch(/\bmin\b|\bmax\b/);
    }
    const kernelText = sf.slice(sf.indexOf('function spike('), sf.indexOf(' function extract('));
    expect(kernelText).not.toMatch(/max\s*-\s*min|range=/);
    for (const hu of ['p.thresholdHU', 'p.hHU', 'p.kappaHU', 'p.epsHU', 'p.sigmaHU']) expect(kernelText).toContain(hu);
    expect(sf).toContain('data=stage(data,m.w,m.h,m.d,s)');
  });
  it('the messages to the worker and the GPU runner carry no volume range', () => {
    for (const f of ['docs/source-filters.js', 'docs/segment-runs.js', 'docs/surface-build.js']) {
      const t = read(f);
      expect(t, f).not.toMatch(/type:'process'[^\n]*min:/);
      expect(t, f).not.toMatch(/runGpuSourceFilters\([^)]*\.min,/);
    }
    expect(read('docs/gpu-compute.js')).toContain('export async function runGpuSourceFilters(data,w,h,d,stages,');
    expect(read('docs/gpu-compute.js')).not.toMatch(/\bminv\b|\bmaxv\b/);
  });
  it.each(Object.keys(CPU))('%s: worker and CPU give the same result', async key => {
    const v = noisy(-1361, 3102);
    const cpu = (await K[CPU[key]](noisy(-1361, 3102), PARAMS[key])).data;
    const out = kernels.stage(new Float32Array(v.data), v.columns, v.rows, v.slices, { key, params: PARAMS[key] });
    expect(out.length).toBe(cpu.length);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(cpu[i], 2);
  });
});

describe('compatibility values (old projects)', () => {
  const R = 65535;
  it('are old parameter x metadata range for large (sourceBacked) series', () => {
    expect(resolveFilterParams('spikeHole', { strength: '0.5', threshold: '0.075' }, practice).values.thresholdHU).toBeCloseTo(0.075 * R, 6); // 4915.125
    expect(resolveFilterParams('spikeHole', { threshold: '0.075' }, practice).values.thresholdHU).toBe(4915.125);
    expect(resolveFilterParams('nlm', { strength: '0.45' }, practice).values.hHU).toBeCloseTo(R * (0.018 + 0.11 * 0.45), 4);
    expect(resolveFilterParams('anisotropic', { strength: '0.45' }, practice).values.kappaHU).toBeCloseTo(R * (0.025 + 0.09 * 0.45), 4);
    expect(resolveFilterParams('tv', { weight: '0.12' }, practice).values.epsHU).toBeCloseTo(6.5535, 6);
    expect(resolveFilterParams('unsharp', { threshold: '0.02' }, practice).values.thresholdHU).toBeCloseTo(1310.7, 6);
    expect(resolveFilterParams('bilateral', { intensitySigma: '0.02' }, practice).values.sigmaHU).toBeCloseTo(1310.7, 6);
  });
  it('use the ratio that was saved, and the old default when none was', () => {
    expect(resolveFilterParams('unsharp', { threshold: '0.1' }, practice).values.thresholdHU).toBeCloseTo(6553.5, 6);
    expect(resolveFilterParams('unsharp', {}, practice).values.thresholdHU).toBeCloseTo(1310.7, 6);
    expect(resolveFilterParams('anisotropic', { strength: '0' }, practice).values.kappaHU).toBeCloseTo(R * 0.025, 4);
  });
  it('use the decoded data range for small series, the metadata range (tags, signed) for large ones', () => {
    const data = { min: -1361, max: 3102 };
    expect(filterLegacyRange(false, practice, data)).toBe(data);
    expect(filterLegacyRange(true, practice, data)).toBe(practice);
    expect(resolveFilterParams('spikeHole', { threshold: '0.075' }, filterLegacyRange(false, practice, data)).values.thresholdHU).toBeCloseTo(0.075 * 4463, 6);
    const tagged = sourceRangeFromMetadata([{ bits: 16, bitsStored: 12, signed: false, slope: 1, intercept: -1024, smallest: 0, largest: 4095 }]);
    expect(resolveFilterParams('unsharp', { threshold: '0.02' }, filterLegacyRange(true, tagged, data)).values.thresholdHU).toBeCloseTo(0.02 * 4095, 6);
    const signed = sourceRangeFromMetadata([{ bits: 16, bitsStored: 16, signed: true, slope: 1, intercept: 0 }]);
    expect(resolveFilterParams('unsharp', { threshold: '0.02' }, filterLegacyRange(true, signed, data)).values.thresholdHU).toBeCloseTo(0.02 * 65535, 6);
  });
  it('fall back to the default when the range is not finite, and report it', () => {
    for (const range of [undefined, { min: NaN, max: 5 }, { min: 0, max: Infinity }]) {
      const r = resolveFilterParams('nlm', { strength: '0.45' }, range);
      expect(r.values.hHU).toBe(40);
      expect(r.derived).toEqual([{ name: 'hHU', label: 'NLM h', value: 40, fallback: true }]);
    }
    expect(legacyFilterValueHU('nlm', 'nope', {}, practice)).toBeNaN();
  });
  it('are not used when HU values are saved; a saved value wins over stale old parameters and any range', () => {
    for (const [key, params] of Object.entries(PARAMS)) {
      const hu = Object.fromEntries(Object.entries(params).filter(([n]) => n in FILTER_UNITS[key].params));
      const r = resolveFilterParams(key, { ...params, strength: '0.9', threshold: '0.1', intensitySigma: '0.25' }, { min: 0, max: 100 });
      expect(r.values).toEqual(hu);
      expect(r.derived).toEqual([]);
    }
  });
});

describe('save and load', () => {
  it('HU values round-trip through the project file as numbers and are used as they are', () => {
    const order = Object.entries(PARAMS).map(([key, p]) => ({ key, params: { ...p, strength: '0.5' } }));
    order.push({ key: 'bilateral', params: { strength: '0.8', spatialSigma: '1.2', sigmaHU: 1310.7, passes: '2' } });
    order[0].params.thresholdHU = 4915.125;
    const { project } = unpackProject(packProject({ filters: { order } }, {}));
    for (const e of project.filters.order) {
      const r = resolveFilterParams(e.key, e.params, practice);
      for (const name of Object.keys(FILTER_UNITS[e.key].params)) {
        expect(typeof e.params[name]).toBe('number');
        expect(r.values[name]).toBe(e.params[name]);
      }
      expect(r.derived).toEqual([]);
    }
  });
  const dl = read('docs/data-load.js');
  it('data-load.js: the control table has the HU names and none of the old ones', () => {
    const t = dl.match(/export const FILTER_PARAM_INPUTS=\{[^\n]*\};/)[0];
    for (const s of ['thresholdHU:spikeHoleThreshold', 'hHU:nlmStrength', 'kappaHU:anisotropicKappa', 'epsHU:tvEps', 'thresholdHU:unsharpThreshold', 'sigmaHU:bilateralIntensity']) expect(t).toContain(s);
    for (const s of ['threshold:', 'intensitySigma', 'nlm:{strength']) expect(t).not.toContain(s);
  });
  it('data-load.js: HU values are saved as numbers once, and set once from resolveFilterParams on load', () => {
    expect(dl).toContain('name in (FILTER_UNITS[key]?.params||{})?+el.value:el.value');
    expect(dl.match(/gatherProject[\s\S]*?return\{project,binaries\}/)[0].match(/params:Object\.fromEntries/g).length).toBe(1);
    expect(dl).toContain('if(!(name in (FILTER_UNITS[key]?.params||{})))setControlValue(');
    expect(dl.match(/setFilterUnitControl\(key,name,value\)/g).length).toBe(1);
    expect(dl.match(/resolveFilterParams\(key,params,legacyRange\)/g).length).toBe(1);
  });
});

describe('signature and cache key', () => {
  const stage = (key, params) => [{ key, params }];
  it.each(Object.keys(PARAMS))('%s: a changed HU value changes the signature and the cache key', async key => {
    const name = Object.keys(FILTER_UNITS[key].params)[0];
    const p2 = { ...PARAMS[key], [name]: PARAMS[key][name] + 1 };
    expect(sourceFilterSignature(stage(key, PARAMS[key]))).not.toBe(sourceFilterSignature(stage(key, p2)));
    const seg = { min: -250, max: 80, opening: 0, closing: 0, minComponent: 0, holeFill: false };
    const k = sig => segmentRunsCacheKey(series, sig, seg);
    expect(await k(sourceFilterSignature(stage(key, PARAMS[key])))).not.toBe(await k(sourceFilterSignature(stage(key, p2))));
    expect(await k(sourceFilterSignature(stage(key, PARAMS[key])))).toBe(await k(sourceFilterSignature(stage(key, PARAMS[key]))));
  });
  it.each(Object.keys(FILTER_UNITS))('%s: the algorithm version is in the signature, so ratio-era cache entries are not reused', key => {
    const params = key === 'bilateral' ? { sigmaHU: 50 } : PARAMS[key];
    expect(sourceFilterSignature(stage(key, params))).toContain('"algo":' + FILTER_UNITS[key].algo);
    expect(sourceFilterSignature(stage(key, params))).not.toBe(JSON.stringify(stage(key, params)));
  });
  it('filters that are not HU-based (gaussian, sigmoid) keep their signature', () => {
    for (const key of ['gaussian', 'sigmoid']) expect(sourceFilterSignature(stage(key, { strength: 0.5 }))).toBe(JSON.stringify(stage(key, { strength: 0.5 })));
  });
});

describe('UI controls match the table', () => {
  const ui = read('docs/ui-shell.js');
  const IDS = { spikeHole: ['thresholdHU', 'spike-hole-threshold'], nlm: ['hHU', 'nlm-strength'], anisotropic: ['kappaHU', 'anisotropic-kappa'], unsharp: ['thresholdHU', 'unsharp-threshold'], bilateral: ['sigmaHU', 'bilateral-intensity'] };
  it.each(Object.keys(IDS))('%s slider has the range, step and default of FILTER_UNITS', key => {
    const [name, id] = IDS[key], def = FILTER_UNITS[key].params[name];
    const tag = ui.match(new RegExp('<input id="' + id + '" type="range"[^>]*>'))[0];
    const at = a => +tag.match(new RegExp(' ' + a + '="([^"]*)"'))[1];
    expect([at('min'), at('max'), at('step'), at('value')]).toEqual([def.min, def.max, def.step, def.def]);
    expect(ui).toMatch(new RegExp('<output id="' + id + '-value">' + def.def + '</output>'));
  });
  it('the TV epsilon is a hidden input with its default', () => {
    expect(ui).toContain('<input type="hidden" id="tv-eps" value="' + FILTER_UNITS.tv.params.epsHU.def + '">');
  });
});

describe('0 and other small values are values, not "missing" (build 448)', () => {
  it('Unsharp 0 HU survives a save / load round trip', () => {
    const { project } = unpackProject(packProject({ filters: { order: [{ key: 'unsharp', params: { radius: '1', amount: '0.8', thresholdHU: 0 } }] } }, {}));
    const r = resolveFilterParams('unsharp', project.filters.order[0].params, practice);
    expect(r.values.thresholdHU).toBe(0);
    expect(r.derived).toEqual([]);
    expect(resolveFilterParams('unsharp', { thresholdHU: '0' }, practice).values.thresholdHU).toBe(0); // also as the string a control gives
  });
  it('an old Unsharp ratio of 0 gives 0 HU, not the default ratio x range (1310.7)', () => {
    const r = resolveFilterParams('unsharp', { radius: '1', amount: '0.8', threshold: '0' }, practice);
    expect(r.values.thresholdHU).toBe(0);
    expect(r.derived).toEqual([{ name: 'thresholdHU', label: 'Unsharp threshold', value: 0, fallback: false }]);
    expect(legacyFilterValueHU('unsharp', 'thresholdHU', { threshold: 0 }, practice)).toBe(0);
  });
  it('0 is not accepted where the slider starts above 0; negative values and junk never are', () => {
    expect(isValidUnitValue(FILTER_UNITS.unsharp.params.thresholdHU, 0)).toBe(true);
    for (const [key, p] of Object.entries(FILTER_UNITS)) for (const [name, def] of Object.entries(p.params)) {
      expect(isValidUnitValue(def, 0), key + '.' + name).toBe(def.min === 0);
      for (const bad of [-1, NaN, Infinity, undefined]) expect(isValidUnitValue(def, bad), key + '.' + name).toBe(false);
    }
    // a saved 0 where 0 is not allowed is taken as missing and derived / defaulted, as before
    expect(resolveFilterParams('spikeHole', { thresholdHU: 0 }, practice).derived.length).toBe(1);
  });
  it('every HU parameter keeps its slider minimum, maximum and default through save / load', () => {
    for (const [key, p] of Object.entries(FILTER_UNITS)) for (const [name, def] of Object.entries(p.params)) {
      for (const v of [def.min, def.max, def.def].filter(x => x !== null)) {
        const { project } = unpackProject(packProject({ filters: { order: [{ key, params: { [name]: v } }] } }, {}));
        const r = resolveFilterParams(key, project.filters.order[0].params, practice);
        expect(r.values[name], key + '.' + name + '=' + v).toBe(v);
        expect(r.derived, key + '.' + name + '=' + v).toEqual([]);
      }
    }
  });
  it('the control code uses the same test (a 0 HU value reaches the slider)', () => {
    const fp = read('docs/filter-pipeline.js');
    expect(fp).toContain('isValidUnitValue(def,v)');
    expect(fp).not.toMatch(/Number\.isFinite\(v\)\|\|v<=0/);
    expect(fp).not.toContain('*def.step||def.def'); // 0 must not fall back to the default when the range is restored
  });
});

