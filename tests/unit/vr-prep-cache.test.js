import { describe, it, expect } from 'vitest';
import { CHUNK, VR_CACHE_FORMAT, canonicalBytes, hashHex, packEntry, sliceOf, storeEntry, loadEntry, pruneSiblings } from '../../docs/vr-prep-cache.js';

// the finished VR data on the device. The module is pure apart from the cache object it is given: an in-memory one with the same API as gpu-volume-cache.js stands in.
function memCache({ failBegin = false, failWriteAt = -1, dropSlice = null } = {}, state = {}) {
  const entries = state.entries || new Map(), slices = state.slices || new Map(); let writes = 0;
  return {
    entries, slices,
    async lookup(key) { const e = entries.get(key); return e?.complete ? e : null; },
    async read(key, i) { return dropSlice === i ? undefined : slices.get(key + '#' + i); },
    async remove(key) { entries.delete(key); for (const k of [...slices.keys()]) if (k.startsWith(key + '#')) slices.delete(k); },
    async list() { return [...entries.values()]; },
    async begin(key, { slices: n, bytesPerSlice, info }) {
      if (failBegin) throw new Error('quota');
      await this.remove(key); const e = { key, slices: n, bytesPerSlice, bytes: n * bytesPerSlice, info, complete: false }; entries.set(key, e); let written = 0;
      return {
        write: async (i, bytes) => { if (++writes === failWriteAt) throw new Error('write failed'); slices.set(key + '#' + i, bytes); written++; },
        commit: async () => { if (written !== n) throw new Error('incomplete'); e.complete = true; },
        abort: async () => { await this.remove(key); },
      };
    },
  };
}
const same = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength)); // (toEqual on megabytes is slow)
const fast = { pause: async () => {}, budgetMs: 0 };

describe('canonicalBytes / hashHex (the key of a derived entry)', () => {
  it('does not depend on the order of properties, does depend on every value and on typed array content', async () => {
    const a = await hashHex({ x: 1, y: [1, 2, { z: 'q' }], t: new Uint8Array([1, 2, 3]) }), b = await hashHex({ t: new Uint8Array([1, 2, 3]), y: [1, 2, { z: 'q' }], x: 1 });
    expect(a).toBe(b); expect(a).toMatch(/^[0-9a-f]{64}$/);
    for (const other of [{ x: 2, y: [1, 2, { z: 'q' }], t: new Uint8Array([1, 2, 3]) }, { x: 1, y: [1, 2, { z: 'r' }], t: new Uint8Array([1, 2, 3]) }, { x: 1, y: [1, 2, { z: 'q' }], t: new Uint8Array([1, 2, 4]) }, { x: 1, y: [1, 2, { z: 'q' }], t: new Uint16Array([1, 2, 3]) }, { x: '1', y: [1, 2, { z: 'q' }], t: new Uint8Array([1, 2, 3]) }])
      expect(await hashHex(other)).not.toBe(a);
  });
  it('a view of a bigger buffer hashes its own bytes only; null and undefined differ from missing', async () => {
    const big = new Uint8Array([9, 9, 1, 2, 3, 9]); expect(await hashHex(new Uint8Array(big.buffer, 2, 3))).toBe(await hashHex(new Uint8Array([1, 2, 3])));
    expect(canonicalBytes({ a: null }).length).not.toBe(canonicalBytes({}).length);
  });
});

describe('storeEntry / loadEntry', () => {
  const bricks = new Float32Array(1000).map((_, i) => i * 0.5), data = new Uint8Array(CHUNK * 2 + 123).map((_, i) => i % 251), none = null;
  it('round-trips several arrays (one of them over two chunks), skips missing ones, keeps the meta', async () => {
    const cache = memCache(), packed = packEntry({ dims: [4, 5, 6], note: 'ä' }, [['bricks', bricks], ['data', data], ['absent', none], ['empty', new Uint8Array(0)]]);
    expect(packed.slices).toBe(1 + 1 + 3); // manifest + bricks (1 chunk) + data (3 chunks)
    expect(await storeEntry(cache, 'k', { kind: 'vr-volume' }, packed, fast)).toBe(true);
    const e = await loadEntry(cache, 'k'); expect(e.meta).toEqual({ dims: [4, 5, 6], note: 'ä' });
    expect(Object.keys(e.arrays).sort()).toEqual(['bricks', 'data']);
    expect(e.arrays.bricks).toBeInstanceOf(Float32Array); expect(same(e.arrays.bricks, bricks)).toBe(true); expect(same(e.arrays.data, data)).toBe(true);
    expect(cache.entries.get('k').info.kind).toBe('vr-volume'); expect(cache.entries.get('k').bytes).toBeGreaterThanOrEqual(packed.bytes);
  });
  it('a slice is a copy (the source array is not cloned whole)', () => {
    const packed = packEntry({}, [['data', data]]), s = sliceOf(packed, 1);
    expect(s.buffer.byteLength).toBe(CHUNK); expect(s.buffer).not.toBe(data.buffer); const last = sliceOf(packed, 3); expect(last.byteLength).toBe(123);
  });
  it('the write is paced: a pause after every budget of work, and the entry only becomes visible at commit', async () => {
    const cache = memCache(), pauses = []; let t = 0, seenBeforeCommit = null;
    const origBegin = cache.begin.bind(cache); cache.begin = async (...a) => { const w = await origBegin(...a); const c = w.commit; w.commit = async () => { seenBeforeCommit = await cache.lookup('k'); return c(); }; return w; };
    const ok = await storeEntry(cache, 'k', {}, packEntry({}, [['data', data]]), { now: () => (t += 2), budgetMs: 3, idleMs: 14, pause: async ms => { pauses.push(ms); } });
    expect(ok).toBe(true); expect(pauses.length).toBeGreaterThan(0); expect(pauses.every(ms => ms === 14)).toBe(true); expect(seenBeforeCommit).toBe(null); expect(await cache.lookup('k')).not.toBe(null);
  });
  it('cancelling (the data was released) removes the half-written entry and returns false', async () => {
    const cache = memCache(); let n = 0;
    const ok = await storeEntry(cache, 'k', {}, packEntry({}, [['data', data]]), { ...fast, isCancelled: () => ++n > 2 });
    expect(ok).toBe(false); expect(cache.entries.size).toBe(0); expect(cache.slices.size).toBe(0);
  });
  it('no space / a failing write means "not cached", nothing is left behind and nothing throws', async () => {
    const warn = console.warn; console.warn = () => {};
    try {
      const c1 = memCache({ failBegin: true }); expect(await storeEntry(c1, 'k', {}, packEntry({}, [['data', data]]), fast)).toBe(false);
      const c2 = memCache({ failWriteAt: 3 }); expect(await storeEntry(c2, 'k', {}, packEntry({}, [['data', data]]), fast)).toBe(false); expect(c2.entries.size).toBe(0); expect(c2.slices.size).toBe(0);
    } finally { console.warn = warn; }
  });
  it('a miss is null; a damaged entry (a slice gone, another format, a wrong slice count) is null and is removed', async () => {
    const warn = console.warn; console.warn = () => {};
    try {
      const cache = memCache(); expect(await loadEntry(cache, 'none')).toBe(null);
      await storeEntry(cache, 'k', {}, packEntry({}, [['data', data]]), fast);
      const gone = memCache({ dropSlice: 2 }, { entries: cache.entries, slices: cache.slices }); expect(await loadEntry(gone, 'k')).toBe(null); expect(cache.entries.has('k')).toBe(false);
      await storeEntry(cache, 'k', {}, packEntry({}, [['data', data]]), fast); cache.entries.get('k').slices += 1; expect(await loadEntry(cache, 'k')).toBe(null); expect(cache.entries.has('k')).toBe(false);
      await storeEntry(cache, 'k', {}, packEntry({}, [['data', data]]), fast);
      cache.slices.set('k#0', new TextEncoder().encode(JSON.stringify({ format: VR_CACHE_FORMAT + 1, meta: {}, arrays: [] }))); expect(await loadEntry(cache, 'k')).toBe(null);
    } finally { console.warn = warn; }
  });
  it('reading stops when cancelled (the session ended) and keeps the entry', async () => {
    const cache = memCache(); await storeEntry(cache, 'k', {}, packEntry({}, [['data', data]]), fast);
    expect(await loadEntry(cache, 'k', { isCancelled: () => true })).toBe(null); expect(cache.entries.has('k')).toBe(true);
  });
  it('pruneSiblings drops the older entries of the same kind, dataset and filter, not the others', async () => {
    const cache = memCache(), ds = { seriesId: 'a' };
    for (const [k, kind, dataset, filter] of [['old', 'vr-derived', ds, 'f'], ['new', 'vr-derived', ds, 'f'], ['otherFilter', 'vr-derived', ds, 'g'], ['otherData', 'vr-derived', { seriesId: 'b' }, 'f'], ['volume', 'vr-volume', ds, 'f']]) cache.entries.set(k, { key: k, complete: true, info: { kind, dataset, filter } });
    await pruneSiblings(cache, { kind: 'vr-derived', dataset: ds, filter: 'f' }, 'new');
    expect([...cache.entries.keys()].sort()).toEqual(['new', 'otherData', 'otherFilter', 'volume']);
  });
});

// ---- why an entry is missing, the event-mode budget
import { explainMiss, noteStore, storeStatus, clearStoreStatus, partsOf, keyOfParts } from '../../docs/vr-prep-cache.js';
import { readFileSync } from 'node:fs';

describe('explainMiss (the reason a VR data entry is built again)', () => {
  const ds = { seriesId: 'a' }, entry = (key, kind, parts, dataset = ds) => ({ key, complete: true, lastUsed: 1, info: { kind, dataset, parts } });
  const cache = list => ({ list: async () => list });
  it('never saved: first; saved before with other parts: changed + WHICH parts; the status of this page session wins when there is one', async () => {
    clearStoreStatus();
    const parts = await partsOf({ state: 1, edit: 'a', region: 'r' }), other = await partsOf({ state: 2, edit: 'a', region: 'r2' });
    expect(await explainMiss(cache([]), { kind: 'vr-derived', key: 'k', dataset: ds, parts })).toEqual({ code: 'first' });
    expect(await explainMiss(cache([entry('old', 'vr-derived', other), entry('x', 'vr-volume', other), entry('y', 'vr-derived', other, { seriesId: 'b' })]), { kind: 'vr-derived', key: 'k', dataset: ds, parts })).toEqual({ code: 'changed', changed: ['state', 'region'] });
    noteStore('k', { state: 'saving', written: 3, total: 10 }); expect(await explainMiss(cache([]), { kind: 'vr-derived', key: 'k', dataset: ds, parts })).toMatchObject({ code: 'saving', written: 3, total: 10 });
    noteStore('k', { state: 'cancelled' }); expect((await explainMiss(cache([]), { kind: 'vr-derived', key: 'k', dataset: ds, parts })).code).toBe('interrupted');
    noteStore('k', { state: 'failed', error: 'QuotaExceededError' }); expect(await explainMiss(cache([]), { kind: 'vr-derived', key: 'k', dataset: ds, parts })).toEqual({ code: 'failed', detail: 'QuotaExceededError' });
    noteStore('k', { state: 'skipped', why: 'over budget' }); expect((await explainMiss(cache([]), { kind: 'vr-derived', key: 'k', dataset: ds, parts })).code).toBe('capacity');
    noteStore('k', { state: 'done' }); expect((await explainMiss(cache([]), { kind: 'vr-derived', key: 'k', dataset: ds, parts })).code).toBe('evicted'); // saved earlier, gone now: the LRU / the storage
    expect((await explainMiss(cache([]), { kind: 'vr-derived', key: 'k', dataset: ds, parts, readFailed: true })).code).toBe('damaged');
    expect((await explainMiss(cache([]), { kind: 'vr-derived', key: 'unknown', dataset: ds, parts, readFailed: true })).code).toBe('damaged');
    clearStoreStatus(); expect(storeStatus.map.size).toBe(0);
  });
  it('the parts are hashed one by one and the key follows every part (a part that did not change keeps its hash)', async () => {
    const a = await partsOf({ x: [1, 2], y: 'q' }), b = await partsOf({ x: [1, 2], y: 'r' });
    expect(a.x).toBe(b.x); expect(a.y).not.toBe(b.y);
    expect(await keyOfParts('vr-derived', a)).not.toBe(await keyOfParts('vr-derived', b)); expect(await keyOfParts('vr-derived', a)).toBe(await keyOfParts('vr-derived', { ...a })); expect(await keyOfParts('vr-volume', a)).not.toBe(await keyOfParts('vr-derived', a));
  });
});

describe('the event-mode budget (all four practice levels stay in the device cache)', () => {
  const g = readFileSync(new URL('../../docs/gpu-volume-data.js', import.meta.url), 'utf8');
  const take = (from, to) => g.slice(g.indexOf(from), g.indexOf(to));
  const body = take('export const EVENT_CACHE_NEED_BYTES', 'export async function volumeCacheBudget()') .replace(/export /g, '');
  const run = async ({ event, quota, fixed = 0, tablet = false }) => {
    const fn = new Function('isTabletRuntime', 'navigator', 'globalThis', body + '\nreturn volumeCacheBudgetInfo();');
    return fn(() => tablet, { storage: { estimate: async () => ({ quota, usage: 5 }), persisted: async () => false } }, { __vrlSettings: { get: k => k === 'eventMode' ? event : k === 'cacheLimit' ? fixed : undefined } });
  };
  const GB = 2 ** 30;
  it('normal mode keeps its defaults (tablet 1.5 GB cap, 30 % of the quota); the event mode raises it to the 3.5 GB the four levels need when the browser allows it', async () => {
    expect((await run({ event: false, quota: 50 * GB, tablet: true })).budget).toBe(1.5 * GB);
    expect((await run({ event: false, quota: 2 * GB, tablet: true })).budget).toBe(0.6 * GB);
    const e = await run({ event: true, quota: 50 * GB, tablet: true }); expect(e.budget).toBe(3.5 * GB); expect(e.need).toBe(3.5 * GB); expect(e.enough).toBe(true);
  });
  it('a browser that can store less is told: the budget is 85 % of the quota and enough is false (the 詳細 tab warns); a limit set by hand wins', async () => {
    const e = await run({ event: true, quota: 3 * GB, tablet: true }); expect(e.budget).toBeCloseTo(2.55 * GB, -3); expect(e.enough).toBe(false);
    expect((await run({ event: true, quota: 50 * GB, fixed: 1 })).budget).toBe(1 * GB);
    expect((await run({ event: true, quota: 0, tablet: true })).budget).toBe(3.5 * GB); // unknown quota: the need itself
  });
  it('persistent storage is asked once in event mode (the data is then not evicted under pressure), and the settings list calls the entries VR用データ', () => {
    expect(g).toContain('if(volumeCacheState.cache&&eventModeOnForCache())void requestPersistentCache()');
    expect(g).toContain('navigator.storage?.persisted?.())||(await navigator.storage?.persist?.())');
  });
});
