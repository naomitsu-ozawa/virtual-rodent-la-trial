import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO } from '../helpers/demo-lists.js';
import { makeCtSlice } from '../helpers/synthetic-dicom.js';
import { sampleIndexUrl, sampleSliceUrl, sampleCacheKey, sampleSliceFileName, setKnownSamplePairs, memberIndexUrl, memberProjectUrl, memberSliceUrl, memberCacheKey } from '../../docs/sample-sets.js';
import { samplePairsUrl, parseSamplePairs, readProjectDataset, probeSliceFile, findPartnerSeries } from '../../docs/sample-pairs.js';

// The partner loading of docs/data-load.js (findSamplePartners / loadSamplePartnerFiles): which files it asks for, on the real arthritis index and the real .vrlab. docs/data-load.js needs a DOM, so its
// functions are cut out of the source and run against recording stubs (like tests/unit/sample-load-targets.test.js).
const SITE = 'https://site.example/app/';
const ARTH = join(DEMO, 'sample7', 'arthritis');
const REAL_INDEX = readFileSync(join(ARTH, 'index.json'));
// the public index lists the ct group only; the labels scenes below use a synthetic index (the real ct names + 340 labels names), as an earlier index had
const { files: CT_FILES } = JSON.parse(REAL_INDEX);
const WITH_LABELS = JSON.stringify({ files: [...CT_FILES, ...Array.from({ length: 340 }, (_, i) => `labels/HindpawLabels_${String(i + 1).padStart(4, '0')}.dcm`)] });
const REAL_PROJECT = readFileSync(join(ARTH, 'hindpaw_154_2m_arthritis.vrlab'));
const REAL_PAIRS = readFileSync(new URL('../../docs/sample-pairs.json', import.meta.url));
const CT_UID = '1.2.826.0.1.3680043.8.498.95025408379892155964467896683349364864';
const slice = (seriesUid, i) => makeCtSlice({ seriesUid, rows: 197, columns: 501, instance: i, pixels: new Int16Array(1) }); // header of the real size; the pixels do not matter here

function dataLoadFunctions() {
  const src = readFileSync(new URL('../../docs/data-load.js', import.meta.url), 'utf8');
  const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); expect(a, from).toBeGreaterThan(-1); expect(b, to).toBeGreaterThan(a); return src.slice(a, b).replace(/^export /gm, ''); };
  const code = [cut('async function fetchSampleIndex(', 'export async function loadSampleDemo('), cut('let samplePairsRead=null;', 'export const detectedSeries')].join('\n');
  const deps = { SAMPLE_CACHE: 'cache', withTimeout: p => Promise.resolve(p), sampleSliceFileName, setKnownSamplePairs, memberIndexUrl, memberProjectUrl, memberSliceUrl, memberCacheKey, samplePairsUrl, parseSamplePairs, readProjectDataset, probeSliceFile, findPartnerSeries };
  return { code, names: Object.keys(deps), deps };
}

// a fake network: the site's own files, and the slices made by `sliceFor(url)` (null = 404)
function setup({ hasCache = false, sliceFor, project = REAL_PROJECT, index = REAL_INDEX, pairs = REAL_PAIRS } = {}) {
  const fetched = [], store = new Map();
  const cache = { match: async k => store.get(k) ?? null, put: async (k, r) => { store.set(k, r); } };
  const fetchFn = async (url, opts) => {
    const u = new URL(String(url), SITE).href; fetched.push({ url: u, opts });
    const rel = u.slice(SITE.length);
    if (rel === 'sample-pairs.json') return pairs === false ? new Response('nope', { status: 404 }) : new Response(pairs);
    if (rel === 'demo/sample7/arthritis/index.json') return new Response(index);
    if (rel === 'demo/sample7/arthritis/hindpaw_154_2m_arthritis.vrlab') return project ? new Response(project) : new Response('nope', { status: 404 });
    const b = sliceFor?.(rel);
    return b ? new Response(b) : new Response('nope', { status: 404 });
  };
  const { code, names, deps } = dataLoadFunctions();
  const all = { ...deps, fetch: fetchFn, location: new URL(SITE + 'index.html'), window: hasCache ? { caches: {} } : {}, caches: { open: async () => cache } };
  const fns = new Function('deps', `const {${names.concat(['fetch', 'location', 'window', 'caches']).join(',')}}=deps;${code}\nreturn {loadSamplePairs,findSamplePartners,loadSamplePartnerFiles,loadSamplePartnerProject};`)(all);
  return { fetched, store, ...fns };
}
const arthritisSlices = rel => {
  const m = /^demo\/sample7\/arthritis\/(ct|labels)\/Hindpaw(?:CT|Labels)_(\d{4})\.dcm$/.exec(rel);
  return m ? slice(m[1] === 'ct' ? CT_UID : '1.2.3.labels', Number(m[2])) : null;
};
const slicesFetched = f => f.filter(x => x.url.endsWith('.dcm')).map(x => x.url.slice(SITE.length));
beforeEach(() => setKnownSamplePairs({}));

describe('the partner of sample7 (arthritis): what is read from the network', () => {
  it('reads the pairs file, the index, the .vrlab, ONE slice of each group, then the other 339 ct slices - 344 requests, no labels beyond the first (index with a labels group)', async () => {
    const t = setup({ sliceFor: arthritisSlices, index: WITH_LABELS });
    const found = await t.findSamplePartners('sample7');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: 'sample7', dir: 'arthritis', project: 'hindpaw_154_2m_arthritis.vrlab', sub: 'ct' });
    expect(found[0].names).toHaveLength(340);
    expect(found[0].firstFile).toBeInstanceOf(File);
    // probe phase: the pairs file, index, .vrlab, the first ct slice and the first labels slice
    expect(t.fetched.map(f => f.url.slice(SITE.length)).sort()).toEqual([
      'demo/sample7/arthritis/ct/HindpawCT_0001.dcm', 'demo/sample7/arthritis/hindpaw_154_2m_arthritis.vrlab', 'demo/sample7/arthritis/index.json', 'demo/sample7/arthritis/labels/HindpawLabels_0001.dcm', 'sample-pairs.json',
    ]);
    const files = await t.loadSamplePartnerFiles(found[0]);
    expect(files).toHaveLength(340);
    expect(files.map(f => f.name)).toEqual(found[0].names.map(n => n.replace(/^ct\//, ''))); // File names: the slice file names, index order
    const sl = slicesFetched(t.fetched);
    expect(t.fetched).toHaveLength(344);
    expect(sl.filter(u => u.includes('/ct/'))).toHaveLength(340); // each ct slice exactly once (the probed first one is reused)
    expect(new Set(sl).size).toBe(sl.length);
    expect(sl.filter(u => u.includes('/labels/'))).toEqual(['demo/sample7/arthritis/labels/HindpawLabels_0001.dcm']);
    expect(t.fetched.every(f => f.opts.credentials === 'omit')).toBe(true);
    expect(t.fetched.every(f => f.url.startsWith(SITE + 'demo/sample7/arthritis/') || f.url === SITE + 'sample-pairs.json')).toBe(true); // nothing outside the partner folder
  });
  it('the volume of the partner is the ct group: the Files carry the ct header (UID of the .vrlab), none the labels', async () => {
    const t = setup({ sliceFor: arthritisSlices });
    const [p] = await t.findSamplePartners('sample7');
    const files = await t.loadSamplePartnerFiles(p);
    expect((await probeSliceFile(files[0])).seriesUid).toBe(CT_UID);
    expect((await probeSliceFile(files[339])).seriesUid).toBe(CT_UID);
  });
  it('the real (public) index lists the ct group only: the partner is found and loaded with no labels request - 343 requests', async () => {
    const t = setup({ sliceFor: arthritisSlices });
    const [p] = await t.findSamplePartners('sample7');
    expect(p.sub).toBe('ct');
    expect(await t.loadSamplePartnerFiles(p)).toHaveLength(340);
    expect(slicesFetched(t.fetched).filter(u => u.includes('/labels/'))).toEqual([]);
    expect(t.fetched).toHaveLength(343); // pairs file, index, .vrlab, 340 ct slices
  });
  it('the labels are not needed: without a labels folder (404 on its first slice) the partner is still found, with the same ct requests', async () => {
    const t = setup({ index: WITH_LABELS, sliceFor: rel => (rel.includes('/labels/') ? null : arthritisSlices(rel)) });
    const [p] = await t.findSamplePartners('sample7');
    expect(p.sub).toBe('ct');
    expect((await t.loadSamplePartnerFiles(p))).toHaveLength(340);
    expect(slicesFetched(t.fetched).filter(u => u.includes('/labels/'))).toEqual(['demo/sample7/arthritis/labels/HindpawLabels_0001.dcm']); // asked once, 404, skipped
    expect(t.fetched).toHaveLength(344);
  });
  it('labels that are not a DICOM (an HTML page for a 404) are skipped the same way', async () => {
    const t = setup({ sliceFor: rel => (rel.includes('/labels/') ? new TextEncoder().encode('<html>not found</html>') : arthritisSlices(rel)) });
    const [p] = await t.findSamplePartners('sample7');
    expect(p.sub).toBe('ct');
  });
  it('a partner whose ct slices are not the .vrlab series (another UID) is not opened; no further slice is requested', async () => {
    const t = setup({ index: WITH_LABELS, sliceFor: rel => { const m = /Hindpaw(CT|Labels)_(\d{4})/.exec(rel); return m ? slice('9.9.9.other', Number(m[2])) : null; } });
    expect(await t.findSamplePartners('sample7')).toEqual([]);
    expect(slicesFetched(t.fetched).sort()).toEqual(['demo/sample7/arthritis/ct/HindpawCT_0001.dcm', 'demo/sample7/arthritis/labels/HindpawLabels_0001.dcm']);
  });
  it('wrong size (rows x columns) of the slices: not opened', async () => {
    const t = setup({ sliceFor: rel => { const m = /Hindpaw(CT|Labels)_(\d{4})/.exec(rel); return m ? makeCtSlice({ seriesUid: CT_UID, rows: 100, columns: 501, pixels: new Int16Array(1) }) : null; } });
    expect(await t.findSamplePartners('sample7')).toEqual([]);
  });
  it('wrong slice count in the index: not opened', async () => {
    const files = JSON.parse(REAL_INDEX).files.filter(n => !n.startsWith('ct/') || Number(/(\d{4})\.dcm$/.exec(n)[1]) <= 339);
    const t = setup({ sliceFor: arthritisSlices, index: JSON.stringify({ files }) });
    expect(await t.findSamplePartners('sample7')).toEqual([]);
  });
  it('an unreadable .vrlab (404 / not a zip) or an unreadable index: not opened, nothing thrown', async () => {
    expect(await setup({ sliceFor: arthritisSlices, project: null }).findSamplePartners('sample7')).toEqual([]);
    expect(await setup({ sliceFor: arthritisSlices, project: new TextEncoder().encode('not a zip') }).findSamplePartners('sample7')).toEqual([]);
    expect(await setup({ sliceFor: arthritisSlices, index: '{oops' }).findSamplePartners('sample7')).toEqual([]);
    expect(await setup({ sliceFor: arthritisSlices, index: '{"files":[]}' }).findSamplePartners('sample7')).toEqual([]);
  });
  it('Cache Storage: a second run reads every slice from the cache (keys below /__vrl-sample/v1/sample7/arthritis/), no slice request', async () => {
    const t = setup({ hasCache: true, sliceFor: arthritisSlices, index: WITH_LABELS });
    const [p] = await t.findSamplePartners('sample7');
    await t.loadSamplePartnerFiles(p);
    const keys = [...t.store.keys()];
    expect(keys).toHaveLength(341); // 340 ct + the first labels slice
    for (const k of keys) expect(k.startsWith('https://site.example/__vrl-sample/v1/sample7/arthritis/')).toBe(true);
    expect(keys).toContain('https://site.example/__vrl-sample/v1/sample7/arthritis/ct%2FHindpawCT_0340.dcm');
    const before = t.fetched.length;
    const [p2] = await t.findSamplePartners('sample7');
    await t.loadSamplePartnerFiles(p2);
    expect(slicesFetched(t.fetched.slice(before))).toEqual([]); // index and .vrlab are read again, slices come from the cache
  });
});

describe('the partner\'s .vrlab (stage 2)', () => {
  it('is read once while the partner is checked and handed back by loadSamplePartnerProject (no second request)', async () => {
    const t = setup({ sliceFor: arthritisSlices }), [p] = await t.findSamplePartners('sample7');
    expect(p.projectBytes).toBeInstanceOf(Uint8Array); expect(Buffer.from(p.projectBytes).equals(REAL_PROJECT)).toBe(true);
    const before = t.fetched.length, bytes = await t.loadSamplePartnerProject(p);
    expect(bytes).toBe(p.projectBytes); expect(t.fetched).toHaveLength(before);
    expect(t.fetched.filter(f => f.url.endsWith('.vrlab'))).toHaveLength(1);
  });
  it('without the bytes it reads the file (and throws on a missing one)', async () => {
    const t = setup({ sliceFor: arthritisSlices }), [p] = await t.findSamplePartners('sample7');
    expect(Buffer.from(await t.loadSamplePartnerProject({ id: p.id, dir: p.dir })).equals(REAL_PROJECT)).toBe(true);
    const t2 = setup({ sliceFor: arthritisSlices, project: null });
    await expect(t2.loadSamplePartnerProject({ id: 'sample7', dir: 'arthritis' })).rejects.toThrow(/HTTP 404/);
  });
});

describe('datasets without a partner, and the pairs file', () => {
  it('a dataset that has no partner reads the pairs file (once) and nothing else', async () => {
    const t = setup({ sliceFor: arthritisSlices });
    expect(await t.findSamplePartners('sample2')).toEqual([]);
    expect(await t.findSamplePartners('sample1')).toEqual([]);
    expect(t.fetched.map(f => f.url.slice(SITE.length))).toEqual(['sample-pairs.json']); // one read for all
  });
  it('nothing is read until findSamplePartners / loadSamplePairs is called (the module does not fetch by itself)', () => {
    const t = setup({ sliceFor: arthritisSlices });
    expect(t.fetched).toEqual([]);
  });
  it('a missing / broken pairs file means no partners (no other request)', async () => {
    for (const pairs of [false, '{oops', '[]']) { // false = 404
      const t = setup({ sliceFor: arthritisSlices, pairs });
      expect(await t.findSamplePartners('sample7')).toEqual([]);
      expect(t.fetched.map(f => f.url.slice(SITE.length))).toEqual(['sample-pairs.json']);
    }
  });
  it('a pairs file that lists a dir the rules refuse never reaches a URL', async () => {
    const t = setup({ sliceFor: arthritisSlices, pairs: JSON.stringify({ sample7: [{ dir: '../sample2', project: 'p.vrlab' }] }) });
    expect(await t.findSamplePartners('sample7')).toEqual([]);
    expect(t.fetched).toHaveLength(1);
  });
  it('the plain loading is not touched: loadSampleDemo makes no request for a partner or for the pairs file (it is not wired in)', () => {
    const src = readFileSync(new URL('../../docs/data-load.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function loadSampleDemo('), src.indexOf('let samplePairsRead=null;'));
    expect(body).not.toMatch(/member|Pairs|Partner/);
    expect(readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8')).not.toMatch(/findSamplePartners|loadSamplePartnerFiles|loadSamplePairs/);
    // stage 2 wires them in ON DEMAND only: vr-view.js names them in its import line and inside startPair (the entry point the menu calls), nowhere else (tests/unit/vr-pair-view.test.js)
    const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8'), at = vr.indexOf('export async function startPair(id');
    expect(at).toBeGreaterThan(0);
    for (const m of vr.matchAll(/findSamplePartners|loadSamplePartnerFiles|loadSamplePairs/g)) expect(m.index > at || vr.lastIndexOf('\n', m.index) < vr.indexOf('import { findSamplePartners'), `${m[0]} outside startPair`).toBe(true);
    expect([sampleIndexUrl('sample7'), sampleSliceUrl('sample7', 'a.dcm'), sampleCacheKey('o', 'sample7', 'a.dcm')]).toEqual(['demo/sample7/index.json', 'demo/sample7/a.dcm', 'o/__vrl-sample/v1/sample7/a.dcm']);
  });
});
