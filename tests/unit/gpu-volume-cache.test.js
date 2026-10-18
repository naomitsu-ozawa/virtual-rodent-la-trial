import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { cacheKey, openVolumeCache, textureCacheHandle } from '../../docs/gpu-volume-cache.js';

let idb, clock;
beforeEach(() => { idb = new IDBFactory(); clock = 1000; });
const open = () => openVolumeCache({ indexedDB: idb, now: () => clock });
const slice = (n, v) => new Uint8Array(n).fill(v);

describe('cacheKey', () => {
  it('is stable and sensitive to every part', async () => {
    const a = await cacheKey({ fp: { seriesUid: '1' }, filter: 'g:1', plan: '512x512x300' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKey({ fp: { seriesUid: '1' }, filter: 'g:1', plan: '512x512x300' })).toBe(a);
    expect(await cacheKey({ fp: { seriesUid: '1' }, filter: 'g:2', plan: '512x512x300' })).not.toBe(a);
    expect(await cacheKey({ fp: { seriesUid: '1' }, filter: 'g:1', plan: '768x768x300' })).not.toBe(a);
  });
});

describe('texture cache handle', () => {
  it('miss -> write all slices -> commit -> hit returns the same bytes', async () => {
    const c = await open(), info = { slices: 3, bytesPerSlice: 4 };
    const miss = await textureCacheHandle(c, 'k', info);
    expect(miss.hit).toBe(false);
    for (let i = 0; i < 3; i++) await miss.write(i, slice(4, i + 1));
    expect(await miss.commit()).toBe(true);
    const hit = await textureCacheHandle(c, 'k', info);
    expect(hit.hit).toBe(true);
    expect([...await hit.read(2)]).toEqual([3, 3, 3, 3]);
  });

  it('an uncommitted (interrupted) entry is never a hit', async () => {
    const c = await open(), info = { slices: 3, bytesPerSlice: 4 };
    const h = await textureCacheHandle(c, 'k', info);
    await h.write(0, slice(4, 1)); // upload cancelled here
    expect((await textureCacheHandle(c, 'k', info)).hit).toBe(false);
  });

  it('commit refuses incomplete entries', async () => {
    const c = await open(), h = await textureCacheHandle(c, 'k', { slices: 2, bytesPerSlice: 4 });
    await h.write(0, slice(4, 1));
    expect(await h.commit()).toBe(false);
    expect(await c.lookup('k')).toBeNull();
  });

  it('a different texture layout for the same key is treated as a miss', async () => {
    const c = await open(), h = await textureCacheHandle(c, 'k', { slices: 1, bytesPerSlice: 4 });
    await h.write(0, slice(4, 9)); await h.commit();
    expect((await textureCacheHandle(c, 'k', { slices: 1, bytesPerSlice: 8 })).hit).toBe(false);
  });

  it('storage errors disable the handle instead of failing the upload', async () => {
    const real = await open();
    // wrap the cache so the second slice write fails like a QuotaExceededError
    let writes = 0;
    const flaky = { ...real, begin: async (key, meta) => { const w = await real.begin(key, meta); return { ...w, write: async (i, b) => { if (++writes === 2) throw new Error('QuotaExceededError'); return w.write(i, b); } }; } };
    const h = await textureCacheHandle(flaky, 'k', { slices: 3, bytesPerSlice: 4 });
    await expect(h.write(0, slice(4, 1))).resolves.toBeUndefined();
    await expect(h.write(1, slice(4, 2))).resolves.toBeUndefined(); // swallowed
    expect(h.broken).toBe(true);
    await expect(h.write(2, slice(4, 3))).resolves.toBeUndefined(); // no-op now
    expect(await h.commit()).toBe(false);
    expect(await real.lookup('k')).toBeNull(); // partial entry removed
  });
});

describe('prune', () => {
  it('evicts least recently used entries over budget and stale partial entries', async () => {
    const c = await open(), info = { slices: 1, bytesPerSlice: 100 };
    for (const k of ['a', 'b', 'c']) { const h = await textureCacheHandle(c, k, info); await h.write(0, slice(100, 1)); await h.commit(); clock += 10; }
    await c.lookup('a'); clock += 10;              // 'a' used most recently now
    await textureCacheHandle(c, 'partial', info);  // never committed
    clock += 11 * 60 * 1000;
    const total = await c.prune(200);
    expect(total).toBeLessThanOrEqual(200);
    expect(await c.lookup('b')).toBeNull();          // least recently used
    expect(await c.lookup('a')).not.toBeNull();
    expect((await c.usage())).toBe(200);
  });
});
