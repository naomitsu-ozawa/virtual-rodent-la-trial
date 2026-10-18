import { describe, it, expect, beforeAll } from 'vitest';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { morphMask, fillMaskHoles, removeSmallMaskComponents } from '../../docs/mask-ops.js';
import { maskToAnalysisRuns, maskFromAnalysisRuns } from '../../docs/run-length.js';

installDomStub();
let S, R;
beforeAll(async () => { S = await importApp('segments'); R = await importApp('segment-runs'); });

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const w = 12, h = 12, d = 6, n = w * h * d, dims = { columns: w, rows: h, slices: d };
const KEYS = ['bone', 'soft', 'fat', 'lung'];

const process = (mask, s) => {
  let m = mask;
  if (s.opening) { m = morphMask(m, w, h, d, s.opening, false); m = morphMask(m, w, h, d, s.opening, true); }
  if (s.closing) { m = morphMask(m, w, h, d, s.closing, true); m = morphMask(m, w, h, d, s.closing, false); }
  if (s.holeFill) m = fillMaskHoles(m, w, h, d);
  if (s.minComponent) m = removeSmallMaskComponents(m, w, h, d, s.minComponent);
  return m;
};
const thr = (data, lo, hi) => { const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = data[i] >= lo && data[i] <= hi ? 1 : 0; return m; };

function fullModel(data, p, order) {
  const E = new Uint8Array(n), out = {};
  for (const k of order) {
    const s = p[k]; if (!s.active) continue;
    let m = thr(data, s.userMin, s.userMax);
    for (let i = 0; i < n; i++) if (E[i]) m[i] = 0;
    m = process(m, s);
    for (let i = 0; i < n; i++) if (E[i]) m[i] = 0;
    if (s.keep) for (let i = 0; i < n; i++) if (!s.keep[i]) m[i] = 0;
    if (s.exclude) for (let i = 0; i < n; i++) if (s.exclude[i]) m[i] = 0;
    out[k] = m;
    for (let i = 0; i < n; i++) if (m[i]) E[i] = 1;
  }
  return out;
}

function setupState(p, order) {
  S.segmentExclusive.mode = 'priority'; S.segmentExclusive.order = order;
  for (const k of KEYS) {
    const g = S.segmentState[k], st = S.segmentEditState[k], s = p[k];
    Object.assign(g, { active: s.active, enabled: true, userMin: s.userMin, userMax: s.userMax, min: s.userMin, max: s.userMax, opening: s.opening, closing: s.closing, holeFill: s.holeFill, minComponent: s.minComponent, surfaceMm: 0, thicknessMm: 0, _maskCache: null, _maskCacheKey: '', exclusive: undefined });
    Object.assign(st, { baseRuns: null, baseSignature: '', pendingBase: null, finalRuns: null, keepRuns: s.keep ? maskToAnalysisRuns(s.keep, w, h, d) : null, excludeRuns: s.exclude ? maskToAnalysisRuns(s.exclude, w, h, d) : null, cutRuns: null, undo: [], redo: [] });
    S.segmentEditGen[k]++;
  }
  S.applyExclusiveRanges(); S.segmentExclusive.pending.clear();
}
const randomParams = (order, { adds = true, edits = true } = {}) => {
  const p = {};
  for (const k of order) {
    const a = Math.round(rnd() * 100), b = Math.round(rnd() * 100), proc = rnd() < 0.5;
    p[k] = {
      userMin: Math.min(a, b), userMax: Math.max(a, b), active: rnd() < 0.85,
      opening: proc && rnd() < 0.3 ? 1 : 0, closing: adds && proc && rnd() < 0.3 ? 1 : 0, holeFill: adds && proc && rnd() < 0.2, minComponent: proc && rnd() < 0.5 ? 3 : 0,
    };
    if (edits && rnd() < 0.3) {
      const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = rnd() < 0.6 ? 1 : 0;
      if (rnd() < 0.5) p[k].keep = m; else { for (let i = 0; i < n; i++) m[i] = rnd() < 0.3 ? 1 : 0; p[k].exclude = m; }
    }
  }
  return p;
};
const hasDropped = order => order.some(k => S.segmentState[k].active && S.segmentState[k].exclusive?.dropped?.length);

async function check(trials, opts) {
  let ok = 0, skipped = 0, sourcesSeen = 0;
  for (let t = 0; t < trials; t++) {
    const data = new Float32Array(n); for (let i = 0; i < n; i++) data[i] = Math.round(rnd() * 100);
    const order = [...KEYS].sort(() => rnd() - 0.5), p = randomParams(order, opts);
    setupState(p, order);
    if (hasDropped(order)) { skipped++; continue; }
    const v = { ...dims, data, spacing: [1, 1, 1], sourceBacked: false, min: 0, max: 100 };
    const full = fullModel(data, p, order), union = new Uint8Array(n);
    for (const k of order.filter(k => p[k].active)) {
      const runs = await R.getFinalSegmentRuns(k, v), m = maskFromAnalysisRuns(v, runs);
      sourcesSeen += S.segmentSourcesOf(k).length;
      expect(Array.from(m), 'trial ' + t + ' segment ' + k).toEqual(Array.from(full[k]));
      for (let i = 0; i < n; i++) { if (m[i] && union[i]) throw new Error('overlap at ' + i + ' trial ' + t); if (m[i]) union[i] = 1; }
    }
    ok++;
  }
  return { ok, skipped, sourcesSeen };
}

describe('hybrid exclusion equals the full voxel model (in-memory path)', () => {
  it('post-processing without adding voxels (small components, Opening), no edits', async () => {
    const r = await check(300, { adds: false, edits: false });
    expect(r.ok).toBeGreaterThan(120); expect(r.sourcesSeen).toBeGreaterThan(20);
  });
  it('with Closing and hole filling (voxels outside the HU range), no edits', async () => {
    const r = await check(300, { adds: true, edits: false });
    expect(r.ok).toBeGreaterThan(120); expect(r.sourcesSeen).toBeGreaterThan(20);
  });
  it('with manual keep / exclude edits too: no voxel in two segments and the same voxels as the full model', async () => {
    const r = await check(300, { adds: true, edits: true });
    expect(r.ok).toBeGreaterThan(120); expect(r.sourcesSeen).toBeGreaterThan(20);
  });
});

// build 460: the thin-part removal runs AFTER the higher segments' voxels are taken out (as on the run path), so a thin
// shell that only looked thick together with the bone voxels it wraps is not kept
describe('thin-part removal comes after the higher voxels are taken out (in-memory path)', () => {
  it('a soft shell of thickness 2 around a bone core is empty once the bone is removed from it', async () => {
    const N = 20, m = N ** 3, data = new Float32Array(m).fill(-1000), v = { columns: N, rows: N, slices: N, data, spacing: [1, 1, 1], sourceBacked: false, min: -1000, max: 100 };
    const core = (x, y, z) => x >= 8 && x < 12 && y >= 8 && y < 12 && z >= 8 && z < 12, shell = (x, y, z) => x >= 6 && x < 14 && y >= 6 && y < 14 && z >= 6 && z < 14;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) data[(z * N + y) * N + x] = core(x, y, z) ? 80 : shell(x, y, z) ? 10 : -1000;
    S.segmentExclusive.mode = 'priority'; S.segmentExclusive.order = ['bone', 'soft', 'fat', 'lung'];
    for (const k of KEYS) {
      const g = S.segmentState[k], st = S.segmentEditState[k];
      Object.assign(g, { active: k === 'bone' || k === 'soft', enabled: true, opening: 0, closing: 0, holeFill: false, minComponent: 0, surfaceMm: 0, thicknessMm: 0, _maskCache: null, _maskCacheKey: '', exclusive: undefined });
      Object.assign(st, { baseRuns: null, baseSignature: '', pendingBase: null, finalRuns: null, keepRuns: null, excludeRuns: null, cutRuns: null, undo: [], redo: [] });
      S.segmentEditGen[k]++;
    }
    Object.assign(S.segmentState.bone, { userMin: 60, userMax: 100, min: 60, max: 100, minComponent: 1 });
    Object.assign(S.segmentState.soft, { userMin: 0, userMax: 100, min: 0, max: 100, thicknessMm: 4 });
    S.applyExclusiveRanges(); S.segmentExclusive.pending.clear();
    const runs = await R.getFinalSegmentRuns('soft', v), soft = maskFromAnalysisRuns(v, runs);
    expect(soft.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
