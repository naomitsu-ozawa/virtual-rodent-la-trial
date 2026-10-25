import { describe, it, expect, vi } from 'vitest';
import { planeCacheKey, planeCacheInfo, isCacheablePlane, loadCachedPlane, storeCachedPlane, createPlaneWriteQueue, MAX_PLANES_PER_FILTER } from '../../docs/plane-cache.js';
import { pruneOtherFilterSettings } from '../../docs/gpu-volume-cache.js';

const series = () => ({ id: 's1', description: 'x', modality: 'CT', columns: 8, rows: 6, spacingX: .1, spacingY: .1, spacingZ: .1, slices: Array.from({ length: 4 }, () => ({ studyUid: '1', seriesUid: '2' })) });

// in-memory stand-in with the same surface as openVolumeCache()
function fakeCache() {
  const entries = new Map(), data = new Map(); let t = 0;
  return {
    entries,
    async lookup(k) { const e = entries.get(k); if (!e?.complete) return null; e.lastUsed = ++t; return e; },
    async read(k, i) { return data.get(k + ':' + i); },
    async begin(k, { slices, bytesPerSlice, info }) {
      entries.set(k, { key: k, slices, bytesPerSlice, bytes: slices * bytesPerSlice, info, complete: false, lastUsed: ++t });
      return { async write(i, b) { data.set(k + ':' + i, b); }, async commit() { entries.get(k).complete = true; entries.get(k).lastUsed = ++t; }, async abort() { entries.delete(k); } };
    },
    async remove(k) { entries.delete(k); data.delete(k + ':0'); },
    async list() { return [...entries.values()]; },
    async prune() {},
  };
}

describe('filtered plane cache', () => {
  it('key: stable, and different per dataset / plane / index / filter', async () => {
    const k = await planeCacheKey(series(), 'g:0.6', 'axial', 3);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await planeCacheKey(series(), 'g:0.6', 'axial', 3)).toBe(k);
    expect(await planeCacheKey(series(), 'g:0.6', 'coronal', 3)).not.toBe(k);
    expect(await planeCacheKey(series(), 'g:0.6', 'axial', 4)).not.toBe(k);
    const other = series(); other.columns = 9;
    expect(await planeCacheKey(other, 'g:0.6', 'axial', 3)).not.toBe(k);
    expect(planeCacheInfo(series(), 'g:0.6')).toMatchObject({ kind: 'filtered-plane', filter: 'g:0.6' });
  });

  it('a changed filter invalidates: new key, and old-filter planes are pruned when a new one is stored', async () => {
    const s = series(), cache = fakeCache(), v = new Float32Array(48);
    const kOld = await planeCacheKey(s, 'g:0.5', 'axial', 0), kNew = await planeCacheKey(s, 'g:0.6', 'axial', 0);
    expect(kOld).not.toBe(kNew);
    await storeCachedPlane(cache, kOld, planeCacheInfo(s, 'g:0.5'), v);
    expect(await loadCachedPlane(cache, kNew, 48)).toBeNull();
    await storeCachedPlane(cache, kNew, planeCacheInfo(s, 'g:0.6'), v);
    expect(cache.entries.has(kOld)).toBe(false);
    expect((await loadCachedPlane(cache, kNew, 48)).length).toBe(48);
  });

  it('only mpr:* planes are stored', () => {
    expect(isCacheablePlane('mpr:axial')).toBe(true);
    expect(isCacheablePlane('mpr:sagittal')).toBe(true);
    expect(isCacheablePlane('analysis-pick')).toBe(false);
    expect(isCacheablePlane('hu-analysis')).toBe(false);
    expect(isCacheablePlane(undefined)).toBe(false);
  });

  it('keeps Float32 values exactly, and drops a wrong-sized entry', async () => {
    const s = series(), cache = fakeCache(), v = Float32Array.from({ length: 48 }, (_, i) => -1000.123456 + i / 3), k = await planeCacheKey(s, 'f', 'axial', 1);
    await storeCachedPlane(cache, k, planeCacheInfo(s, 'f'), v);
    expect([...(await loadCachedPlane(cache, k, 48))]).toEqual([...v]);
    expect(await loadCachedPlane(cache, k, 99)).toBeNull();
    expect(cache.entries.has(k)).toBe(false);
  });

  it('caps planes per (dataset, filter), dropping the least recently used', async () => {
    const s = series(), cache = fakeCache(), info = planeCacheInfo(s, 'f'), keys = [];
    for (let i = 0; i < MAX_PLANES_PER_FILTER + 3; i++) { const k = await planeCacheKey(s, 'f', 'axial', i); keys.push(k); await storeCachedPlane(cache, k, info, new Float32Array(48)); }
    expect(cache.entries.size).toBe(MAX_PLANES_PER_FILTER);
    expect(cache.entries.has(keys[0])).toBe(false);
    expect(cache.entries.has(keys[keys.length - 1])).toBe(true);
    // touching an old plane protects it
    const cache2 = fakeCache(), ks = [];
    for (let i = 0; i < MAX_PLANES_PER_FILTER; i++) { const k = await planeCacheKey(s, 'f', 'axial', i); ks.push(k); await storeCachedPlane(cache2, k, info, new Float32Array(48)); }
    await loadCachedPlane(cache2, ks[0], 48);
    await storeCachedPlane(cache2, await planeCacheKey(s, 'f', 'coronal', 0), info, new Float32Array(48));
    expect(cache2.entries.has(ks[0])).toBe(true);
    expect(cache2.entries.has(ks[1])).toBe(false);
  });

  it('a failing store is ignored', async () => {
    const cache = { begin: async () => { throw new Error('quota'); } };
    expect(await storeCachedPlane(cache, 'k', { kind: 'filtered-plane', dataset: 'd', filter: 'f' }, new Float32Array(2))).toBe(false);
  });

  it('existing auto-prune treats filtered-plane entries like the other kinds', async () => {
    const entries = [
      { key: 'cur', info: { kind: 'filtered-plane', dataset: 'A', filter: 'g1' } },
      { key: 'old', info: { kind: 'filtered-plane', dataset: 'A', filter: 'g0' } },
      { key: 'vol', info: { kind: 'volume', dataset: 'A', plan: '512', filter: 'g0' } },
    ];
    const removed = [];
    await pruneOtherFilterSettings({ list: async () => entries, remove: async k => removed.push(k) }, { kind: 'filtered-plane', dataset: 'A', filter: 'g1' }, 'cur');
    expect(removed).toEqual(['old']);
  });

  it('write queue: waits until requests stop, keeps the newest few, drops other filters', async () => {
    vi.useFakeTimers();
    const written = [], q = createPlaneWriteQueue(async it => { written.push(it.key); }, { delayMs: 1000 });
    for (let i = 0; i < 10; i++) { q.add({ key: 'k' + i, info: { filter: 'f' } }); await vi.advanceTimersByTimeAsync(300); q.touch(); }
    expect(written).toEqual([]); // still "dragging"
    expect(q.size).toBe(MAX_PLANES_PER_FILTER);
    q.keepOnly(it => it.key !== 'k9');
    await vi.advanceTimersByTimeAsync(1100);
    expect(written).toEqual(['k4', 'k5', 'k6', 'k7', 'k8']);
    vi.useRealTimers();
  });
});
