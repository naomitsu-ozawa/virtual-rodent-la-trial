import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openVolumeCache, pruneOtherFilterSettings } from '../../docs/gpu-volume-cache.js';
import { protectedKeys, pruneSiblings, removeOldBuilds } from '../../docs/vr-prep-cache.js';

// in 体験会モード the four practice levels opened with their standard settings stay in the device cache whatever else is stored (settings variants, other data, older builds); the rest goes first, oldest first.
// What is standard: the latest alias of each level that a data switch wrote (standard: true), the vr-volume / vr-derived entries it points at, and the browser's filtered 3D volume of the same data and filter.
let idb, clock, event;
beforeEach(() => { idb = new IDBFactory(); clock = 1000; event = true; globalThis.__vrlSettings = { get: k => (k === 'eventMode' ? event : undefined) }; });
afterEach(() => { delete globalThis.__vrlSettings; });
const open = () => openVolumeCache({ indexedDB: idb, now: () => clock });
async function put(c, key, info, bytes = 100) { const w = await c.begin(key, { slices: 1, bytesPerSlice: bytes, info }); await w.write(0, new Uint8Array(bytes)); await w.commit(); clock += 10; }
const ds = n => ({ seriesUid: 'S' + n, columns: 512, rows: 512, slices: 300 });
// one practice level with its standard entries (3D volume only for a filtered level)
async function level(c, n, { filter = 'f' + n, bytes = 100, build = 'B1', filtered = true } = {}) {
  const base = { dataset: ds(n), filter, build, prep: 3 };
  if (filtered) await put(c, `vol${n}`, { kind: 'volume', dataset: ds(n), filter, plan: '512x512x300' }, bytes);
  await put(c, `V${n}`, { kind: 'vr-volume', plan: 'vr-512', ...base }, bytes); await put(c, `D${n}`, { kind: 'vr-derived', plan: 'vr-512', ...base }, bytes);
  await put(c, `A${n}`, { kind: 'vr-alias', dataset: { id: 'sample' + n }, filter: '', plan: 'alias', standard: true, keyV: `V${n}`, keyD: `D${n}`, build, prep: 3 }, 1);
}
const keys = async c => (await c.list()).map(e => e.key).sort();

describe('which entries are protected', () => {
  it('the latest standard alias of every level, what it points at, and the filtered 3D volume of the same data and filter; nothing outside 体験会モード', async () => {
    const c = await open(); for (const n of [1, 2, 3, 4]) await level(c, n);
    await put(c, 'Vx', { kind: 'vr-volume', dataset: ds(1), filter: 'other', plan: 'vr-512' }); await put(c, 'volx', { kind: 'volume', dataset: ds(1), filter: 'other', plan: '512x512x300' });
    await put(c, 'Dx', { kind: 'vr-derived', dataset: ds(1), filter: 'f1', plan: 'vr-512' }); // a variant of the settings
    const all = await c.list(), p = protectedKeys(all, true);
    expect([...p].sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'D1', 'D2', 'D3', 'D4', 'V1', 'V2', 'V3', 'V4', 'vol1', 'vol2', 'vol3', 'vol4']);
    expect(protectedKeys(all, false).size).toBe(0);
  });
  it('an alias that is not standard (the session\'s own start) and an older alias of the same level protect nothing', async () => {
    const c = await open();
    await put(c, 'V1', { kind: 'vr-volume', dataset: ds(1), filter: 'f' }); await put(c, 'A1', { kind: 'vr-alias', dataset: { id: 'sample1' }, standard: false, keyV: 'V1', keyD: 'D1' });
    await put(c, 'V1b', { kind: 'vr-volume', dataset: ds(1), filter: 'f' }); await put(c, 'A1old', { kind: 'vr-alias', dataset: { id: 'sample1' }, standard: true, keyV: 'V1', keyD: 'D1' });
    await put(c, 'A1new', { kind: 'vr-alias', dataset: { id: 'sample1' }, standard: true, keyV: 'V1b', keyD: 'D1b' });
    expect([...protectedKeys(await c.list(), true)].sort()).toEqual(['A1new', 'D1b', 'V1b']); // (D1b: the key it points at, whether or not that entry exists)
  });
});

describe('eviction in 体験会モード', () => {
  it('variants beyond the budget are evicted oldest first and all four standard levels stay; outside the event mode the LRU is blind to them', async () => {
    const c = await open(); for (const n of [1, 2, 3, 4]) await level(c, n);
    const std = await keys(c);
    for (let i = 0; i < 10; i++) await put(c, 'var' + i, { kind: 'vr-derived', dataset: ds(1), filter: 'f1', plan: 'vr-512' }, 100);
    expect(await c.prune(1700)).toBeLessThanOrEqual(1700 + 100); // the standard entries alone are 4 x 301 + ... bytes
    const left = await keys(c); for (const k of std) expect(left, k).toContain(k);
    expect(left.filter(k => k.startsWith('var')).length).toBeLessThan(10);
    event = false; await c.prune(0); expect((await keys(c)).length).toBe(0); // normal mode: everything is evictable
  });
  it('when the standard entries alone are over the budget nothing is evicted and nothing throws (the caller falls back to computing what it cannot store)', async () => {
    const c = await open(); for (const n of [1, 2, 3, 4]) await level(c, n, { bytes: 1000 });
    await put(c, 'var', { kind: 'vr-derived', dataset: ds(1), filter: 'f1' }, 1000);
    const total = await c.prune(100); expect(total).toBeGreaterThan(100); expect(await keys(c)).toEqual(expect.arrayContaining(['A1', 'D1', 'V1', 'vol1', 'A4', 'D4', 'V4', 'vol4'])); expect(await keys(c)).not.toContain('var');
  });
  it('changing the filter stores other entries and the auto-prune of the old filter setting leaves the standard ones; the variants of one data replace each other', async () => {
    const c = await open(); await level(c, 2);
    await put(c, 'vol2b', { kind: 'volume', dataset: ds(2), filter: 'variant', plan: '512x512x300' });
    await pruneOtherFilterSettings(c, { kind: 'volume', dataset: ds(2), plan: '512x512x300', filter: 'variant' }, 'vol2b');
    expect(await keys(c)).toEqual(expect.arrayContaining(['vol2', 'vol2b']));
    await put(c, 'D2v1', { kind: 'vr-derived', dataset: ds(2), filter: 'f2', plan: 'vr-512' }); await put(c, 'D2v2', { kind: 'vr-derived', dataset: ds(2), filter: 'f2', plan: 'vr-512' });
    await pruneSiblings(c, { kind: 'vr-derived', dataset: ds(2), filter: 'f2' }, 'D2v2');
    const left = await keys(c); expect(left).toContain('D2'); expect(left).toContain('D2v2'); expect(left).not.toContain('D2v1');
  });
});

describe('older builds', () => {
  it('entries of another build / preparation version (and untagged ones) are removed, the current ones and the browser\'s 3D volumes stay', async () => {
    const c = await open(); await level(c, 1, { build: 'B1' }); await level(c, 2, { build: 'B0' }); await put(c, 'untagged', { kind: 'vr-derived', dataset: ds(3), filter: 'x' });
    await removeOldBuilds(c, { build: 'B1', prep: 3 });
    expect(await keys(c)).toEqual(['A1', 'D1', 'V1', 'vol1', 'vol2']);
  });
});
