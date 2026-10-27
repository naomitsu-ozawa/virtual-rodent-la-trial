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
