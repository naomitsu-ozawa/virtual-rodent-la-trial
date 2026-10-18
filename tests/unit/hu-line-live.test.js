import { describe, it, expect } from 'vitest';
import { lineSamples, sampleLine } from '../../docs/line-profile.js';
import {
  LIVE_MAX_SAMPLES, LIVE_INTERVAL_MS, createLiveGate, createLiveScheduler, planeKindOf, planeCoords, sampleOnPlane, sampleFromCachedSlices, liveProfile
} from '../../docs/hu-line-live.js';

// HU = 10*x + 100*y + 1000*z: linear, so bilinear / trilinear sampling must reproduce it exactly
const dims = { columns: 6, rows: 5, slices: 4 };
const f = (x, y, z) => 10 * x + 100 * y + 1000 * z;
const axial = k => Float32Array.from({ length: 30 }, (_, n) => f(n % 6, Math.floor(n / 6), k));
const slices = [0, 1, 2, 3].map(axial);
// the coronal plane j: columns x slices, row = d-1-k (the layout of source-filters.js getFilteredSourcePlaneValues)
const coronal = j => { const o = new Float32Array(6 * 4); for (let k = 0; k < 4; k++) for (let x = 0; x < 6; x++) o[(3 - k) * 6 + x] = f(x, j, k); return o; };
const sagittal = i => { const o = new Float32Array(5 * 4); for (let k = 0; k < 4; k++) for (let y = 0; y < 5; y++) o[(3 - k) * 5 + y] = f(i, y, k); return o; };

describe('rate gate and latest-only scheduler (about 13 Hz, never more)', () => {
  it('runs at most once per interval and tells the caller how long to wait', () => {
    const g = createLiveGate(75);
    expect(g.step(1000, false)).toEqual({ run: false, wait: 0 });
    expect(g.step(1000, true)).toEqual({ run: true, wait: 0 });
    expect(g.step(1030, true)).toEqual({ run: false, wait: 45 });
    expect(g.step(1075, true).run).toBe(true);
    expect(LIVE_INTERVAL_MS).toBeGreaterThanOrEqual(66); expect(LIVE_INTERVAL_MS).toBeLessThanOrEqual(100); // 10-15 Hz
  });
  it('coalesces a burst of requests into one run per interval with the newest state, and cancel() makes older runs stale', () => {
    let t = 0; const rafs = [], timers = [], runs = [];
    const s = createLiveScheduler(seq => runs.push(seq), {
      gate: createLiveGate(75), now: () => t, raf: f => { rafs.push(f); return rafs.length; }, cancelRaf: () => {}, setT: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearT: () => {}
    });
    for (let i = 0; i < 50; i++) s.request(); // 50 pointer moves in one frame
    expect(rafs).toHaveLength(1);
    rafs.shift()(); expect(runs).toEqual([1]); expect(s.pending()).toBe(false);
    t = 20; s.request(); s.request(); rafs.shift()(); // too soon: no run, one timer for the remaining time
    expect(runs).toEqual([1]); expect(timers).toHaveLength(1); expect(timers[0][1]).toBe(55);
    t = 80; timers.shift()[0](); rafs.shift()(); expect(runs).toEqual([1, 2]);
    expect(s.current()).toBe(2);
    s.request(); s.cancel(); expect(s.current()).toBe(3); // a result of run 2 is now stale
    expect(s.pending()).toBe(false);
  });
});

describe('plane detection and in-plane coordinates', () => {
  it('a line with a common integer axis coordinate lies on that plane; a 3D oblique line does not', () => {
    expect(planeKindOf({ i: 0, j: 1, k: 2 }, { i: 5, j: 3, k: 2 })).toEqual({ plane: 'axial', idx: 2 });
    expect(planeKindOf({ i: 0, j: 1, k: 2 }, { i: 5, j: 1, k: 3 })).toEqual({ plane: 'coronal', idx: 1 });
    expect(planeKindOf({ i: 4, j: 1, k: 2 }, { i: 4, j: 3, k: 3 })).toEqual({ plane: 'sagittal', idx: 4 });
    expect(planeKindOf({ i: 0, j: 1, k: 2 }, { i: 5, j: 3, k: 3 })).toBeNull();
    expect(planeKindOf({ i: 0, j: 1, k: 2.5 }, { i: 5, j: 3, k: 2.5 })).toBeNull(); // between two slices
  });
  it('coronal / sagittal rows run from the top slice down', () => {
    const s = lineSamples({ i: 0, j: 2, k: 0 }, { i: 5, j: 2, k: 3 }, [1, 1, 1]);
    const c = planeCoords('coronal', s, dims);
    expect(c.w).toBe(6); expect(c.h).toBe(4); expect(c.v[0]).toBe(3); expect(c.v[s.n - 1]).toBe(0);
    expect(planeCoords('sagittal', s, dims).w).toBe(5);
  });
});

describe('coarse sampler', () => {
  const line = { a: { i: 0, j: 1, k: 2 }, b: { i: 5, j: 3, k: 2 } };
  it('reads an in-plane line straight from that plane image, matching the full-resolution read', async () => {
    const s = lineSamples(line.a, line.b, [1, 1, 1]);
    const live = sampleOnPlane(s, 'axial', dims, slices[2]);
    const full = await sampleLine(s, dims, z => slices[z]);
    for (let q = 0; q < s.n; q++) { expect(live[q]).toBeCloseTo(full[q], 6); expect(live[q]).toBeCloseTo(f(s.x[q], s.y[q], 2), 4); }
  });
  it('coronal and sagittal in-plane lines read the right voxels (row flip)', () => {
    const a = { i: 0, j: 2, k: 0 }, b = { i: 5, j: 2, k: 3 }, s = lineSamples(a, b, [1, 1, 1]);
    const cor = sampleOnPlane(s, 'coronal', dims, coronal(2));
    for (let q = 0; q < s.n; q++) expect(cor[q]).toBeCloseTo(f(s.x[q], 2, s.z[q]), 4);
    const a2 = { i: 3, j: 0, k: 0 }, b2 = { i: 3, j: 4, k: 3 }, s2 = lineSamples(a2, b2, [1, 1, 1]);
    const sag = sampleOnPlane(s2, 'sagittal', dims, sagittal(3));
    for (let q = 0; q < s2.n; q++) expect(sag[q]).toBeCloseTo(f(3, s2.y[q], s2.z[q]), 4);
  });
  it('an oblique 3D line reads cached axial slices; a missing slice uses its neighbour or leaves a NaN gap (never loads)', () => {
    const a = { i: 0, j: 0, k: 0 }, b = { i: 5, j: 4, k: 3 }, s = lineSamples(a, b, [1, 1, 1]);
    const asked = [];
    const all = sampleFromCachedSlices(s, dims, z => { asked.push(z); return slices[z]; });
    for (let q = 0; q < s.n; q++) expect(all[q]).toBeCloseTo(f(s.x[q], s.y[q], s.z[q]), 4);
    expect(new Set(asked).size).toBe(asked.length); // each slice is asked for once (memoised)
    const holey = sampleFromCachedSlices(s, dims, z => (z === 2 ? null : slices[z]));
    expect(holey.some(x => x !== x)).toBe(false); // a neighbour stands in while only one of the two slices is missing
    const none = sampleFromCachedSlices(s, dims, () => null);
    expect(none.every(x => x !== x)).toBe(true);
  });
  it('liveProfile caps the sample count, prefers the plane image, falls back to slices, and returns null when nothing is cached', () => {
    const big = { columns: 2000, rows: 2, slices: 1 }, flat = Float32Array.from({ length: 4000 }, () => 7);
    const r0 = liveProfile({ i: 0, j: 0, k: 0 }, { i: 1999, j: 0, k: 0 }, [1, 1, 1], big, { plane: () => flat, slice: () => null });
    expect(r0.samples.n).toBe(LIVE_MAX_SAMPLES); expect(r0.values[10]).toBe(7);
    let planeAsked = 0;
    const r1 = liveProfile(line_a, line_b, [1, 1, 1], dims, { plane: (p, i) => { planeAsked++; expect([p, i]).toEqual(['axial', 2]); return slices[2]; }, slice: () => { throw new Error('not needed'); } });
    expect(planeAsked).toBe(1); expect(r1.filled).toBe(r1.samples.n);
    const r2 = liveProfile(line_a, line_b, [1, 1, 1], dims, { plane: () => null, slice: z => slices[z] });
    expect(r2.values[0]).toBeCloseTo(f(0, 1, 2), 4);
    expect(liveProfile(line_a, line_b, [1, 1, 1], dims, { plane: () => null, slice: () => null })).toBeNull();
  });
});
const line_a = { i: 0, j: 1, k: 2 }, line_b = { i: 5, j: 3, k: 2 };
