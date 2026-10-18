import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HU_MODE_FILTERED, HU_MODE_RAW, getHuMode, setHuMode, onHuModeChange, resolveHuMode, effectiveHuSignature, createEffectiveReader, segmentNeedsRuns } from '../../docs/effective-hu.js';

const mkReader = stages => {
  const calls = [];
  const read = createEffectiveReader({
    stageCount: () => stages.n,
    rawSlice: z => { calls.push('raw' + z); return Float32Array.of(z, z); },
    filteredSlice: z => { calls.push('f' + z); return Promise.resolve(Float32Array.of(z + 0.5, z + 0.5)); }
  });
  return { read, calls };
};

describe('mode selection', () => {
  it('defaults to filtered; filtered only reads the filtered plane when a stage is active', async () => {
    expect(getHuMode()).toBe(HU_MODE_FILTERED);
    const st = { n: 0 }, { read, calls } = mkReader(st);
    expect([...await read(3, {})]).toEqual([3, 3]); // no stage: raw
    st.n = 2;
    expect([...await read(3, {})]).toEqual([3.5, 3.5]); // stages: filtered
    expect([...await read(3, { mode: 'raw' })]).toEqual([3, 3]); // raw on request
    expect([...await read(4, { mode: 'filtered' })]).toEqual([4.5, 4.5]);
    expect(calls).toEqual(['raw3', 'f3', 'raw3', 'f4']);
  });
  it('resolveHuMode', () => {
    expect(resolveHuMode('filtered', 0)).toBe(HU_MODE_RAW);
    expect(resolveHuMode('filtered', 1)).toBe(HU_MODE_FILTERED);
    expect(resolveHuMode('raw', 3)).toBe(HU_MODE_RAW);
  });
  it('the shared mode notifies listeners once per change', () => {
    const fn = vi.fn(), off = onHuModeChange(fn);
    setHuMode('raw'); setHuMode('raw'); setHuMode('filtered');
    expect(fn.mock.calls.map(c => c[0])).toEqual(['raw', 'filtered']);
    off(); setHuMode('raw'); expect(fn).toHaveBeenCalledTimes(2); setHuMode('filtered');
  });
});

describe('cache signature', () => {
  it('changes with the filter signature and the mode; raw / unfiltered ignore the signature', () => {
    const a = effectiveHuSignature('filtered', 1, 'sigA'), b = effectiveHuSignature('filtered', 1, 'sigB'), r = effectiveHuSignature('raw', 1, 'sigA');
    expect(a).not.toBe(b); expect(a).not.toBe(r);
    expect(effectiveHuSignature('raw', 1, 'sigA')).toBe(effectiveHuSignature('raw', 1, 'sigB'));
    expect(effectiveHuSignature('filtered', 0, '')).toBe(r);
  });
});

describe('HU units (source check)', () => {
  it('the filter input is the slope / intercept-scaled source and the filtered plane is returned unscaled, so both readers are HU', () => {
    const sf = readFileSync(new URL('../../docs/source-filters.js', import.meta.url), 'utf8');
    expect(sf).toMatch(/out\[q\+\+\]=raw\*meta\.slope\+meta\.intercept/);
    const wiring = readFileSync(new URL('../../docs/effective-hu-source.js', import.meta.url), 'utf8');
    expect(wiring).toMatch(/getFilteredSourcePlaneValues\('axial'/);
    expect(wiring).not.toMatch(/slope|intercept|\* ?255/);
  });
});

describe('plain-range fast path', () => {
  it('is used only when no filter stage is active (in-memory volumes included), so membership and values share the same data', () => {
    expect(segmentNeedsRuns(false, 0)).toBe(false); // unfiltered plain range: slice of the total
    expect(segmentNeedsRuns(false, 2)).toBe(true); // filters on (in-memory or source-backed): final runs
    expect(segmentNeedsRuns(true, 0)).toBe(true); // post-processing / edits
  });
  it('histogram-ui routes by segmentNeedsRuns, not by sourceBacked', () => {
    const src = readFileSync(new URL('../../docs/histogram-ui.js', import.meta.url), 'utf8');
    expect(src).toMatch(/segmentNeedsRuns\(segmentNeedsVoxelMask\(key\), sourceFilterStages\(\)\.length\)/);
    expect(src).not.toMatch(/sourceBacked && sourceFilterStages/);
  });
});
