import { describe, it, expect, beforeAll, vi } from 'vitest';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// n738: data-load.js sampleDataSaved - are ALL slices of a practice dataset in Cache Storage? (the keys are those fetchSliceFiles writes: sample-sets.js sampleCacheKey)
describe('sampleDataSaved', () => {
  let dl, ss;
  const ORIGIN = 'https://example.test';
  beforeAll(async () => { installDomStub(); ss = await importApp('sample-sets'); dl = await importApp('data-load'); ss.setKnownSampleIds(['sample1', 'sample2']); });
  const NAMES = ['a b.dcm', 'c.dcm', 'd.dcm'];
  // Cache Storage with one cache holding the given keys (a key = the URL string)
  const storage = (keys, { has = true } = {}) => ({ has: async () => has, open: async () => ({ keys: async () => keys.map(url => ({ url: new URL(url).href })) }) });
  const keysOf = (id, names) => names.map(n => ss.sampleCacheKey(ORIGIN, id, n));
  const run = (id, st, names = NAMES) => dl.sampleDataSaved(id, { cacheStorage: st, names, origin: ORIGIN });

  it('every slice there -> true (sample1 and a later set use their own key prefixes)', async () => {
    expect(await run('sample1', storage([...keysOf('sample1', NAMES), ...keysOf('sample2', NAMES)]))).toBe(true);
    expect(await run('sample2', storage(keysOf('sample2', NAMES)))).toBe(true);
  });
  it('a part of the slices -> false; none of them -> false; the slices of ANOTHER set do not count', async () => {
    expect(await run('sample2', storage(keysOf('sample2', NAMES.slice(0, 2))))).toBe(false);
    expect(await run('sample2', storage(keysOf('sample1', NAMES)))).toBe(false);
    expect(await run('sample2', storage([]))).toBe(false);
  });
  it('no such cache / no Cache Storage / an empty index -> false (nothing is created)', async () => {
    let opened = false; const st = { has: async () => false, open: async () => { opened = true; } };
    expect(await run('sample2', st)).toBe(false); expect(opened).toBe(false);
    expect(await run('sample2', null)).toBe(false);
    expect(await run('sample2', storage(keysOf('sample2', NAMES)), [])).toBe(false);
  });
  // two caches: the slices (SAMPLE_CACHE) and the device's copy of the index (keepSampleLocalCopy); a Map per cache name, keys = URL strings
  const twoCaches = () => {
    const by = new Map(), open = async name => { if (!by.has(name)) by.set(name, new Map()); const m = by.get(name);
      return { keys: async () => [...m.keys()].map(url => ({ url })), put: async (k, res) => { m.set(new URL(k).href, new Uint8Array(await res.arrayBuffer())); }, match: async k => (m.has(new URL(k).href) ? new Response(m.get(new URL(k).href)) : undefined) }; };
    return { has: async name => by.has(name), open, by };
  };
  it('no names given: the names are the device\'s copy of the index (never the network); no copy -> false', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('no network'); }); vi.stubGlobal('fetch', fetchSpy);
    try {
      const st = twoCaches(), slices = await st.open(ss.SAMPLE_CACHE);
      for (const k of keysOf('sample2', NAMES)) await slices.put(k, new Response('x'));
      expect(await dl.sampleDataSaved('sample2', { cacheStorage: st, origin: ORIGIN })).toBe(false); // the slices are there, but no copy of the index: cannot be judged
      await dl.keepSampleLocalCopy('sample2', 'index.json', new TextEncoder().encode(JSON.stringify({ files: NAMES })), { cacheStorage: st, origin: ORIGIN });
      expect(await dl.sampleDataSaved('sample2', { cacheStorage: st, origin: ORIGIN })).toBe(true);
      await dl.keepSampleLocalCopy('sample2', 'index.json', new TextEncoder().encode(JSON.stringify({ files: [...NAMES, 'e.dcm'] })), { cacheStorage: st, origin: ORIGIN });
      expect(await dl.sampleDataSaved('sample2', { cacheStorage: st, origin: ORIGIN })).toBe(false); // a name of the copy has no slice
      expect(await dl.sampleDataSaved('sample1', { cacheStorage: st, origin: ORIGIN })).toBe(false); // the copy of another set does not count
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('sampleLocalCopy reads only: no such cache -> null and nothing is created', async () => {
    const st = twoCaches();
    expect(await dl.sampleLocalCopy('sample2', 'project.vrlab', { cacheStorage: st, origin: ORIGIN })).toBe(null); expect(st.by.size).toBe(0);
    await dl.keepSampleLocalCopy('sample2', 'project.vrlab', new Uint8Array([7, 8]), { cacheStorage: st, origin: ORIGIN });
    expect([...await dl.sampleLocalCopy('sample2', 'project.vrlab', { cacheStorage: st, origin: ORIGIN })]).toEqual([7, 8]);
    expect(await dl.sampleLocalCopy('sample1', 'project.vrlab', { cacheStorage: st, origin: ORIGIN })).toBe(null);
  });
  it('a name that needs escaping is found under its encoded key', async () => {
    expect(NAMES[0]).toContain(' '); expect(await run('sample2', storage(keysOf('sample2', NAMES)))).toBe(true);
  });
});
