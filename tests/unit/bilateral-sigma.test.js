import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cpuBilateral3D } from '../../docs/cpu-filters.js';
import { sourceRangeFromMetadata } from '../../docs/dicom.js';
import { sourceFilterSignature, resolveBilateralParams, legacyBilateralSigmaHU, bilateralLegacyRange, BILATERAL_SIGMA_HU_DEFAULT } from '../../docs/bilateral-sigma.js';
import { segmentRunsCacheKey } from '../../docs/segment-cache-key.js';
import { packProject, unpackProject } from '../../docs/project-file.js';

const noisy = (min, max) => {
  const w = 6, h = 5, d = 4, data = new Float32Array(w * h * d);
  for (let i = 0; i < data.length; i++) data[i] = -100 + ((i * 7919) % 97) * 3 + (i % 5 === 0 ? 400 : 0);
  return { columns: w, rows: h, slices: d, data, min, max };
};
const stage = sigmaHU => [{ key: 'bilateral', params: { strength: 0.8, spatialSigma: 1.2, sigmaHU, passes: 2 } }];
const series = { id: 's::1', columns: 8, rows: 6, spacingX: 0.05, spacingY: 0.05, spacingZ: 0.1, slices: [{ studyUid: 's', seriesUid: '1' }, {}, {}] };
// the practice data: no SmallestImagePixelValue / LargestImagePixelValue, unsigned 16 bit, slope 1, intercept -4000
const practiceSlices = [{ bits: 16, bitsStored: 16, signed: false, slope: 1, intercept: -4000 }];

describe('bilateral intensity sigma in HU (build 445)', () => {
  it('(a) the filter output does not depend on v.min / v.max', async () => {
    const params = { strength: 0.8, spatialSigma: 1.2, sigmaHU: 50, passes: 2 };
    const a = await cpuBilateral3D(noisy(-1361, 3102), params);
    const b = await cpuBilateral3D(noisy(-4000, 61535), params);
    expect([...b.data]).toEqual([...a.data]);
    // and sigmaHU does change the result (the test is not vacuous)
    const c = await cpuBilateral3D(noisy(-1361, 3102), { ...params, sigmaHU: 500 });
    expect([...c.data]).not.toEqual([...a.data]);
  });

  it('(b) sigmaHU changes the filter signature and the segment-runs cache key', async () => {
    expect(sourceFilterSignature(stage(50))).not.toBe(sourceFilterSignature(stage(51)));
    expect(sourceFilterSignature(stage(50))).toBe(sourceFilterSignature(stage(50)));
    const seg = { min: -250, max: 80, opening: 0, closing: 0, minComponent: 0, holeFill: false };
    const k = sig => segmentRunsCacheKey(series, sig, seg);
    expect(await k(sourceFilterSignature(stage(50)))).not.toBe(await k(sourceFilterSignature(stage(51))));
    expect(await k(sourceFilterSignature(stage(50)))).toBe(await k(sourceFilterSignature(stage(50))));
  });

  it('the signature carries the algorithm version, so old (ratio-era) cache entries are not reused', () => {
    const old = JSON.stringify(stage(50));
    expect(sourceFilterSignature(stage(50))).not.toBe(old);
    expect(sourceFilterSignature(stage(50))).toMatch(/"algo":2/);
    // other filters are unchanged
    const other = [{ key: 'gaussian', params: { strength: 0.5 } }];
    expect(sourceFilterSignature(other)).toBe(JSON.stringify(other));
  });

  it('(c) a project without sigmaHU gets ratio × metadata range: 0.02 × 65535 = 1310.7 HU', () => {
    const range = sourceRangeFromMetadata(practiceSlices);
    expect([range.min, range.max]).toEqual([-4000, 61535]);
    const r = resolveBilateralParams({ strength: '0.80', spatialSigma: '1.20', intensitySigma: '0.02', passes: '2' }, range);
    expect(r.legacy).toBe(true);
    expect(r.sigmaHU).toBeCloseTo(1310.7, 6);
    expect(legacyBilateralSigmaHU(undefined, range)).toBeCloseTo(1310.7, 6); // no saved ratio: the old default 0.02
    expect(legacyBilateralSigmaHU('0.1', { min: -1000, max: 3000 })).toBeCloseTo(400, 6);
  });

  it('(d) sigmaHU round-trips through save and load, and is used as it is (not recomputed)', () => {
    const range = sourceRangeFromMetadata(practiceSlices);
    for (const sigmaHU of [BILATERAL_SIGMA_HU_DEFAULT, 1310.7, 12.5]) {
      const bytes = packProject({ filters: { order: [{ key: 'bilateral', params: { strength: '0.80', spatialSigma: '1.20', sigmaHU, passes: '2' } }] } }, {});
      const saved = unpackProject(bytes).project.filters.order[0].params;
      expect(saved.sigmaHU).toBe(sigmaHU);
      expect(typeof saved.sigmaHU).toBe('number');
      // even with a stale ratio in the file and another range, the saved value wins
      const r = resolveBilateralParams({ ...saved, intensitySigma: '0.25' }, { min: 0, max: 100 });
      expect(r).toEqual({ sigmaHU, legacy: false, fallback: false });
      expect(resolveBilateralParams(saved, range).sigmaHU).toBe(sigmaHU);
    }
  });
});

describe('compatibility value by load path (build 446)', () => {
  const dataRange = { min: -1361, max: 3102 };
  const meta = sl => sourceRangeFromMetadata(sl);
  const old = { intensitySigma: '0.02' };

  it('large (sourceBacked) series use the metadata range, small series the decoded data range', () => {
    const m = meta(practiceSlices);
    expect(bilateralLegacyRange(true, m, dataRange)).toBe(m);
    expect(bilateralLegacyRange(false, m, dataRange)).toBe(dataRange);
    expect(resolveBilateralParams(old, bilateralLegacyRange(true, m, dataRange)).sigmaHU).toBeCloseTo(1310.7, 6);
    expect(resolveBilateralParams(old, bilateralLegacyRange(false, m, dataRange)).sigmaHU).toBeCloseTo(0.02 * 4463, 6);
  });

  it('metadata range with DICOM tags (0..4095, intercept -1024) and signed data', () => {
    const tagged = [{ bits: 16, bitsStored: 12, signed: false, slope: 1, intercept: -1024, smallest: 0, largest: 4095 }];
    expect(meta(tagged)).toEqual({ min: -1024, max: 3071 });
    expect(resolveBilateralParams(old, meta(tagged)).sigmaHU).toBeCloseTo(0.02 * 4095, 6);
    // signed 16 bit without tags: -32768..32767, slope 1, intercept 0
    const signed = [{ bits: 16, bitsStored: 16, signed: true, slope: 1, intercept: 0 }];
    expect(meta(signed)).toEqual({ min: -32768, max: 32767 });
    expect(resolveBilateralParams(old, meta(signed)).sigmaHU).toBeCloseTo(0.02 * 65535, 6);
    // signed with tags stored as unsigned words (wrap-around is undone)
    const wrapped = [{ bits: 16, bitsStored: 16, signed: true, slope: 1, intercept: 0, smallest: 64536, largest: 3000 }];
    expect(meta(wrapped)).toEqual({ min: -1000, max: 3000 });
  });

  it('a range that is not finite falls back to the default and says so', () => {
    for (const range of [{ min: NaN, max: 10 }, { min: 0, max: undefined }, undefined, { min: -Infinity, max: 5 }]) {
      expect(resolveBilateralParams(old, range)).toEqual({ sigmaHU: BILATERAL_SIGMA_HU_DEFAULT, legacy: true, fallback: true });
    }
    expect(resolveBilateralParams(old, { min: 0, max: 100 })).toEqual({ sigmaHU: 2, legacy: true, fallback: false });
  });
});

describe('bilateral kernels do not use the volume range (build 446)', () => {
  const src = readFileSync('docs/source-filters.js', 'utf8');
  // the worker function is stringified into a Blob worker in the app; here the same source text is evaluated
  const fn = src.match(/function bilateral\(input,w,h,d,p\)\{[^\n]*\}\n/)?.[0];

  it('the worker bilateral takes no min / max and uses sigmaHU', () => {
    expect(fn).toBeTruthy();
    expect(fn).toContain('p.sigmaHU');
    expect(fn).not.toMatch(/max\s*-\s*min|\bmin\s*,\s*max\b|range/);
    expect(src).toMatch(/return bilateral\(input,w,h,d,p\)/);
  });

  it('the worker kernel and cpuBilateral3D give the same result', async () => {
    const worker = new Function(fn + '; return bilateral;')();
    const params = { strength: 0.8, spatialSigma: 1.2, sigmaHU: 50, passes: 2 };
    const v = noisy(-1361, 3102);
    const a = worker(new Float32Array(v.data), v.columns, v.rows, v.slices, params);
    const b = (await cpuBilateral3D(v, params)).data;
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 3);
  });
});
