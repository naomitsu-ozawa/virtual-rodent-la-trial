import { describe, it, expect } from 'vitest';
import {
  maskToAnalysisRuns, runsSliceToMask, mergeIntervals, unionRunSlice, intersectRunSlice,
  subtractRunSlice, analysisRunsVoxelCount, analysisRunsContain, componentsFromRuns,
  complementRunArrays, unionRunArrays,
} from '../../docs/run-length.js';

// run records are flat triples: y, x0, x1 (inclusive)
const runs = (...t) => new Uint32Array(t);

describe('mask <-> runs', () => {
  it('encodes rows as inclusive runs and round-trips', () => {
    const w = 5, h = 2, d = 1;
    const mask = new Uint8Array([0, 1, 1, 0, 1, /* y1 */ 1, 1, 1, 1, 1]);
    const r = maskToAnalysisRuns(mask, w, h, d);
    expect([...r[0]]).toEqual([0, 1, 2, 0, 4, 4, 1, 0, 4]);
    expect([...runsSliceToMask(r[0], w, h)]).toEqual([...mask]);
    expect(analysisRunsVoxelCount(r)).toBe(8);
  });
});

describe('interval set operations', () => {
  it('mergeIntervals merges overlapping and adjacent ranges', () => {
    expect(mergeIntervals([[5, 6], [0, 2], [3, 3], [8, 9]])).toEqual([[0, 3], [5, 6], [8, 9]]);
    expect(mergeIntervals([])).toEqual([]);
  });
  it('union / intersect / subtract on a slice', () => {
    const a = runs(0, 0, 4), b = runs(0, 3, 7, 1, 0, 0);
    expect([...unionRunSlice(a, b)]).toEqual([0, 0, 7, 1, 0, 0]);
    expect([...intersectRunSlice(a, b)]).toEqual([0, 3, 4]);
    expect([...subtractRunSlice(a, b)]).toEqual([0, 0, 2]);
  });
  it('per-slice array ops tolerate missing slices', () => {
    const out = unionRunArrays([runs(0, 0, 1), undefined], [undefined, runs(0, 2, 2)], 2);
    expect(out.map(s => [...s])).toEqual([[0, 0, 1], [0, 2, 2]]);
  });
  it('complement covers exactly the remaining voxels', () => {
    const w = 4, h = 1, d = 2, r = [runs(0, 1, 2), runs()];
    const c = complementRunArrays(r, w, h, d);
    expect(analysisRunsVoxelCount(c)).toBe(w * h * d - 2);
  });
});

describe('queries and connectivity', () => {
  it('analysisRunsContain checks membership', () => {
    const r = [runs(1, 2, 4)];
    expect(analysisRunsContain(r, 3, 1, 0)).toBe(true);
    expect(analysisRunsContain(r, 5, 1, 0)).toBe(false);
    expect(analysisRunsContain(r, 3, 1, 1)).toBe(false);
  });
  it('componentsFromRuns separates disconnected blobs, largest first, across slices', () => {
    const w = 10, h = 2, d = 2;
    // blob A: x0..2 on both slices (6 voxels); blob B: x7..8 on slice 0 (2 voxels)
    const r = [runs(0, 0, 2, 0, 7, 8), runs(0, 0, 2)];
    const comps = componentsFromRuns(r, w, h, d);
    expect(comps.map(c => c.voxels)).toEqual([6, 2]);
    expect(analysisRunsVoxelCount(comps[0].runsBySlice)).toBe(6);
  });
});
