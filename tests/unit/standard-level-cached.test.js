import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// n738: the REAL judgement behind a card's 「キャッシュ済み」 (vr-view.js standardLevelCached) against a real IndexedDB cache (fake-indexeddb): the standard alias of the dataset (its key is made of the project file's bytes,
// the grid plan, the side and the preparation version), the two entries it points at, and for a filtered level the browser's filtered 3D volume.
describe('standardLevelCached (real store)', () => {
  let vr, gv, pc, cache, bytes, aliasKey;
  const fast = { pause: async () => {}, budgetMs: 0 };
  const put = (key, info, meta = {}) => pc.storeEntry(cache, key, info, pc.packEntry(meta, []), fast);
  beforeAll(async () => {
    installDomStub(); vr = await importApp('vr-view'); gv = await importApp('gpu-volume-data'); pc = await importApp('vr-prep-cache');
  });
  beforeEach(async () => {
    // a real cache on a fresh database; the page's answer to 'vrl-sample-key' (the project file's bytes); no WebGL (the plan falls back)
    const idb = new IDBFactory(); vi.stubGlobal('indexedDB', idb); gv.volumeCacheState.cache = null; gv.volumeCacheState.failed = false;
    cache = await gv.volumeCache();
    bytes = new Uint8Array([1, 2, 3]);
    const doc = new EventTarget(); doc.createElement = () => ({ getContext: () => null });
    doc.addEventListener('vrl-sample-key', e => { e.detail.done = Promise.resolve(bytes); });
    vi.stubGlobal('document', doc);
    const seen = []; const orig = cache.lookup; cache.lookup = async k => { seen.push(k); return orig(k); }; // the first lookup of the judgement is the alias key: the code's own key, not a copy of its formula
    expect(await vr.standardLevelCached('sampleA')).toBe(false); // nothing stored yet
    aliasKey = seen[0]; cache.lookup = orig; expect(aliasKey).toMatch(/^[0-9a-f]{64}$/);
  });
  const standardAlias = (extra = {}) => put(aliasKey, { kind: 'vr-alias', dataset: { id: 'sampleA' }, filter: '', plan: 'alias', standard: true, keyV: 'kV', keyD: 'kD', prep: 0, ...extra }, { keyV: 'kV', keyD: 'kD' });
  const entries = async () => { await put('kV', { kind: 'vr-volume', filter: '', dataset: { id: 'd' } }); await put('kD', { kind: 'vr-derived', filter: '', dataset: { id: 'd' } }); };

  it('the standard alias + both entries it points at (complete) -> true', async () => {
    await standardAlias(); await entries();
    expect(await vr.standardLevelCached('sampleA')).toBe(true);
  });
  it('an entry removed (settings > cache delete) -> false; the alias removed -> false; an alias that is not standard -> false', async () => {
    await standardAlias(); await entries(); expect(await vr.standardLevelCached('sampleA')).toBe(true);
    await cache.remove('kD'); expect(await vr.standardLevelCached('sampleA')).toBe(false);
    await entries(); expect(await vr.standardLevelCached('sampleA')).toBe(true);
    await cache.remove('kV'); expect(await vr.standardLevelCached('sampleA')).toBe(false);
    await entries(); await cache.remove(aliasKey); expect(await vr.standardLevelCached('sampleA')).toBe(false);
    await standardAlias({ standard: false }); expect(await vr.standardLevelCached('sampleA')).toBe(false);
  });
  it('a half-written entry (not committed) does not count', async () => {
    await standardAlias(); await put('kV', { kind: 'vr-volume', filter: '' });
    const w = await cache.begin('kD', { slices: 2, bytesPerSlice: 1, info: { kind: 'vr-derived', filter: '' } }); await w.write(0, new Uint8Array(1)); // no commit
    expect(await vr.standardLevelCached('sampleA')).toBe(false);
  });
  it('the key does not match when what it is made of changed (here the project file: the same holds for the grid plan and the preparation version) -> false, nothing is shown', async () => {
    await standardAlias(); await entries(); expect(await vr.standardLevelCached('sampleA')).toBe(true);
    bytes = new Uint8Array([1, 2, 4]); expect(await vr.standardLevelCached('sampleA')).toBe(false);
    expect(await vr.standardLevelCached('sampleB')).toBe(false); // another dataset: another alias key
  });
  it('a filtered level also needs the browser\'s filtered 3D volume of the same data and filter', async () => {
    await standardAlias(); await put('kV', { kind: 'vr-volume', filter: 'g:1', dataset: { id: 'd' } }); await put('kD', { kind: 'vr-derived', filter: 'g:1', dataset: { id: 'd' } });
    expect(await vr.standardLevelCached('sampleA')).toBe(false);
    await put('vol', { kind: 'volume', filter: 'g:1', dataset: { id: 'd' } }); expect(await vr.standardLevelCached('sampleA')).toBe(true);
    await cache.remove('vol'); expect(await vr.standardLevelCached('sampleA')).toBe(false);
  });
  it('local: the key is made from the page\'s answer to a LOCAL ask (detail.local, the device\'s copy of the project file); no copy -> false; the default ask is not local', async () => {
    await standardAlias(); await entries();
    const asks = []; let localBytes = new Uint8Array([1, 2, 3]);
    const doc = new EventTarget(); doc.createElement = () => ({ getContext: () => null });
    doc.addEventListener('vrl-sample-key', e => { asks.push(e.detail.local); e.detail.done = Promise.resolve(e.detail.local ? localBytes : bytes); }); vi.stubGlobal('document', doc);
    expect(await vr.standardLevelCached('sampleA', { local: true })).toBe(true); // the copy is the bytes the alias was made of
    expect(await vr.standardLevelCached('sampleA')).toBe(true); expect(asks).toEqual([true, false]);
    localBytes = null; expect(await vr.standardLevelCached('sampleA', { local: true })).toBe(false); // no copy on the device: not shown
    localBytes = new Uint8Array([9]); expect(await vr.standardLevelCached('sampleA', { local: true })).toBe(false); // a copy of another version: another key
  });
  it('no project file answer (a dataset without one) -> false', async () => {
    await standardAlias(); await entries();
    const doc = new EventTarget(); doc.createElement = () => ({ getContext: () => null }); vi.stubGlobal('document', doc); // nobody answers vrl-sample-key
    expect(await vr.standardLevelCached('sampleA')).toBe(false);
  });
});
