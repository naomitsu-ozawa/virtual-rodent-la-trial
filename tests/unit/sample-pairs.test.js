import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { listedIds, DEMO } from '../helpers/demo-lists.js';
import { makeCtSlice, asFile } from '../helpers/synthetic-dicom.js';
import {
  sampleSet, sampleIndexUrl, sampleProjectUrl, sampleSliceUrl, sampleCacheKey, setKnownSamplePairs, samplePartners, memberSet, memberIndexUrl, memberProjectUrl, memberSliceUrl, memberCacheKey,
  normalizeSamplePairs, isPairDir, isPairProjectName, sliceSubfolder, sampleSliceFileName,
} from '../../docs/sample-sets.js';
import { parseSamplePairs, splitIndexBySubfolder, readProjectDataset, probeSliceFile, findPartnerSeries, samplePairsUrl } from '../../docs/sample-pairs.js';

const SITE = 'https://site.example/app/';
const REAL_PAIRS = JSON.parse(readFileSync(new URL('../../docs/sample-pairs.json', import.meta.url), 'utf8'));
const ARTH = join(DEMO, 'sample7', 'arthritis');
const REAL_PROJECT = readFileSync(join(ARTH, 'hindpaw_154_2m_arthritis.vrlab'));
const REAL_INDEX = JSON.parse(readFileSync(join(ARTH, 'index.json'), 'utf8')).files;
const CT_UID = '1.2.826.0.1.3680043.8.498.95025408379892155964467896683349364864';
const proj = dataset => zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'virtual-rodent-lab-project', dataset })) });

describe('partner folders: the sets of sample-sets.js (the pairs file decides which exist)', () => {
  beforeAll(() => setKnownSamplePairs(REAL_PAIRS));
  afterAll(() => setKnownSamplePairs({}));

  it('sample7/arthritis: base, index / project / slice URLs and cache keys follow the set rule one folder deeper', () => {
    expect(samplePartners('sample7')).toEqual([{ dir: 'arthritis', project: 'hindpaw_154_2m_arthritis.vrlab' }]);
    expect(memberSet('sample7', 'arthritis')).toEqual({ base: 'demo/sample7/arthritis/', keyPrefix: '/__vrl-sample/v1/sample7/arthritis/', project: 'hindpaw_154_2m_arthritis.vrlab' });
    expect(memberIndexUrl('sample7', 'arthritis')).toBe('demo/sample7/arthritis/index.json');
    expect(memberProjectUrl('sample7', 'arthritis')).toBe('demo/sample7/arthritis/hindpaw_154_2m_arthritis.vrlab');
    expect(memberSliceUrl('sample7', 'arthritis', 'ct/HindpawCT_0001.dcm')).toBe('demo/sample7/arthritis/ct/HindpawCT_0001.dcm');
    expect(memberSliceUrl('sample7', 'arthritis', 'a b.dcm')).toBe('demo/sample7/arthritis/a%20b.dcm');
    expect(memberCacheKey('https://x.io', 'sample7', 'arthritis', 'ct/HindpawCT_0001.dcm')).toBe('https://x.io/__vrl-sample/v1/sample7/arthritis/ct%2FHindpawCT_0001.dcm');
  });
  it('in a PR preview the index / project are read from the site root like the data, the slices from the slice root when there is one', () => {
    expect(memberIndexUrl('sample7', 'arthritis', '/r/pr-preview/pr-3/')).toBe('demo/sample7/arthritis/index.json'); // the flag is false in the repository
    const ROOT = 'https://raw.githubusercontent.com/o/r/main/docs/';
    expect(memberSliceUrl('sample7', 'arthritis', 'ct/a.dcm', '/', ROOT)).toBe(ROOT + 'demo/sample7/arthritis/ct/a.dcm');
    expect(memberSliceUrl('sample7', 'arthritis', 'x.json', '/', ROOT)).toBe('demo/sample7/arthritis/x.json'); // only .dcm go to the slice root
    expect(memberSliceUrl('sample7', 'arthritis', 'ct/../../x.dcm', '/', ROOT)).toBe(ROOT + 'demo/sample7/arthritis/' + encodeURIComponent('ct/../../x.dcm'));
  });
  it('only a dir and a project that the file lists are let through; the parent must be a registered dataset too', () => {
    for (const [id, dir] of [['sample7', 'other'], ['sample7', '../x'], ['sample7', 'ARTHRITIS'], ['sample7', 'arthritis/ct'], ['sample7', ''], ['sample2', 'arthritis'], ['nope', 'arthritis'], ['sample99', 'arthritis'], [null, 'arthritis'], ['sample7', null]]) {
      expect(memberSet(id, dir), `${id}/${dir}`).toBeNull();
      expect(() => memberIndexUrl(id, dir), `${id}/${dir}`).toThrow(/Unknown sample partner/);
      expect(() => memberSliceUrl(id, dir, 'a.dcm')).toThrow();
      expect(() => memberCacheKey('o', id, dir, 'a')).toThrow();
    }
    setKnownSamplePairs({ nope: [{ dir: 'x', project: 'p.vrlab' }] }); // listed, but `nope` is not a registered dataset
    expect(memberSet('nope', 'x')).toBeNull(); expect(samplePartners('nope')).toEqual([]);
    setKnownSamplePairs(REAL_PAIRS);
  });
  it('without a pairs file nothing is a partner', () => {
    setKnownSamplePairs({});
    expect(memberSet('sample7', 'arthritis')).toBeNull(); expect(samplePartners('sample7')).toEqual([]);
    setKnownSamplePairs(undefined); expect(samplePartners('sample7')).toEqual([]);
    setKnownSamplePairs(REAL_PAIRS);
  });
  it('the existing URLs, keys and File names are exactly what they were (a partner changes none of them)', () => {
    expect(sampleIndexUrl('sample1')).toBe('demo/sample1/index.json');
    expect(sampleProjectUrl('sample1')).toBe('demo/sample1/project.vrlab');
    expect(sampleSliceUrl('sample1', 'a b.dcm')).toBe('demo/sample1/a%20b.dcm');
    expect(sampleCacheKey('https://x.io', 'sample1', 'a b.dcm')).toBe('https://x.io/__vrl-sample/v1/a%20b.dcm');
    expect(sampleSet('sample1')).toEqual({ base: 'demo/sample1/', keyPrefix: '/__vrl-sample/v1/' });
    expect(sampleSet('sample7')).toEqual({ base: 'demo/sample7/', keyPrefix: '/__vrl-sample/v1/sample7/' });
    expect(sampleSliceUrl('sample7', 'HindpawCT_0001.dcm')).toBe('demo/sample7/HindpawCT_0001.dcm');
    expect(sampleSliceUrl('sample7', 'ct/HindpawCT_0001.dcm')).toBe('demo/sample7/ct/HindpawCT_0001.dcm'); // the one-level sub-folder rule of the set itself
    expect(sampleCacheKey('https://x.io', 'sample7', 'HindpawCT_0001.dcm')).toBe('https://x.io/__vrl-sample/v1/sample7/HindpawCT_0001.dcm');
    expect(sampleSliceFileName('ct/HindpawCT_0001.dcm')).toBe('HindpawCT_0001.dcm'); expect(sampleSliceFileName('HindpawCT_0001.dcm')).toBe('HindpawCT_0001.dcm');
    // a plain / one-level set and a partner never share a cache key (also not sample1, whose own keys carry no id)
    expect(memberCacheKey('o', 'sample7', 'arthritis', 'HindpawCT_0001.dcm')).not.toBe(sampleCacheKey('o', 'sample7', 'HindpawCT_0001.dcm'));
    expect(memberCacheKey('o', 'sample7', 'arthritis', 'ct/HindpawCT_0001.dcm')).not.toBe(sampleCacheKey('o', 'sample7', 'ct/HindpawCT_0001.dcm'));
  });
  it('a partner of sample1 has a key below sample1/ (the plain sample1 keys have no folder)', () => {
    setKnownSamplePairs({ sample1: [{ dir: 'x', project: 'p.vrlab' }] });
    expect(memberSet('sample1', 'x').keyPrefix).toBe('/__vrl-sample/v1/sample1/x/');
    setKnownSamplePairs(REAL_PAIRS);
  });
});

describe('the pairs file: its shape, one place', () => {
  it('the name rules', () => {
    for (const d of ['arthritis', 'a', 'x-1', 'a--b']) expect(isPairDir(d), d).toBe(true);
    for (const d of ['', 'A', '1a', '-a', 'a/b', '..', 'a b', 'a_b', 'a.b', null, 1]) expect(isPairDir(d), String(d)).toBe(false);
    for (const n of ['p.vrlab', 'hindpaw_154_2m_arthritis.vrlab', 'My Project (1).vrlab', 'é.vrlab']) expect(isPairProjectName(n), n).toBe(true);
    for (const n of ['', '.vrlab', 'p.zip', 'p.VRLAB', '../p.vrlab', 'a/p.vrlab', 'a\\p.vrlab', '.hidden.vrlab', 'p\n.vrlab', null, 5]) expect(isPairProjectName(n), String(n)).toBe(false);
  });
  it('normalizeSamplePairs keeps what follows the rules and reports the rest', () => {
    const { pairs, problems } = normalizeSamplePairs({ sample7: [{ dir: 'arthritis', project: 'p.vrlab' }, { dir: 'arthritis', project: 'q.vrlab' }, { dir: '../x', project: 'p.vrlab' }, { dir: 'ok', project: 'x/p.vrlab' }, null, { dir: 'fine', project: 'f.vrlab', extra: 1 }], 'Bad Id': [], sample2: 'no', sample3: [] });
    expect(pairs).toEqual({ sample7: [{ dir: 'arthritis', project: 'p.vrlab' }, { dir: 'fine', project: 'f.vrlab' }] });
    expect(problems).toHaveLength(6);
    for (const bad of [null, undefined, [], 'x', 5]) expect(normalizeSamplePairs(bad)).toEqual({ pairs: {}, problems: ['not an object'] });
  });
  it('parseSamplePairs warns for each thing it leaves out and returns the clean object', () => {
    const w = [];
    expect(parseSamplePairs({ sample7: [{ dir: 'a', project: 'p.vrlab' }, { dir: 'B', project: 'p.vrlab' }] }, { warn: m => w.push(m) })).toEqual({ sample7: [{ dir: 'a', project: 'p.vrlab' }] });
    expect(w).toHaveLength(1);
    expect(parseSamplePairs(REAL_PAIRS, { warn: m => { throw new Error(m); } })).toEqual(REAL_PAIRS);
    expect(samplePairsUrl()).toBe('sample-pairs.json');
  });
});

describe('the series of a partner folder is found by the UID of its .vrlab, not by a folder name', () => {
  it('sliceSubfolder / splitIndexBySubfolder: split by the first segment, in order of appearance, nothing special-cased', () => {
    expect(sliceSubfolder('ct/a.dcm')).toBe('ct'); expect(sliceSubfolder('a.dcm')).toBe(''); expect(sliceSubfolder('A/a.dcm')).toBe(''); expect(sliceSubfolder('a/b/c.dcm')).toBe('');
    expect(splitIndexBySubfolder(['x/1.dcm', 'y/1.dcm', 'x/2.dcm', 'top.dcm', 3, '', null])).toEqual([{ sub: 'x', names: ['x/1.dcm', 'x/2.dcm'] }, { sub: 'y', names: ['y/1.dcm'] }, { sub: '', names: ['top.dcm'] }]);
    expect(splitIndexBySubfolder(undefined)).toEqual([]);
  });
  it('the real arthritis index: one group of 340 (ct; the labels are not in the public index), and the real .vrlab says UID ...95025408..., 340 slices, 501 x 197', () => {
    const g = splitIndexBySubfolder(REAL_INDEX);
    expect(g.map(x => [x.sub, x.names.length])).toEqual([['ct', 340]]);
    expect(readProjectDataset(REAL_PROJECT)).toEqual({ seriesUid: CT_UID, columns: 501, rows: 197, slices: 340 });
  });
  it('readProjectDataset: null for anything that is not a project with the four values', () => {
    expect(readProjectDataset(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readProjectDataset(zipSync({ 'other.json': strToU8('{}') }))).toBeNull();
    expect(readProjectDataset(zipSync({ 'project.json': strToU8('{oops') }))).toBeNull();
    expect(readProjectDataset(zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'x', dataset: { seriesUid: 'a', columns: 1, rows: 1, slices: 1 } })) }))).toBeNull();
    for (const bad of [{ seriesUid: '', columns: 1, rows: 1, slices: 1 }, { seriesUid: 'a', columns: 0, rows: 1, slices: 1 }, { seriesUid: 'a', columns: 1, rows: 1.5, slices: 1 }, { seriesUid: 'a', columns: 1, rows: 1 }, null]) expect(readProjectDataset(proj(bad)), JSON.stringify(bad)).toBeNull();
    expect(readProjectDataset(proj({ seriesUid: 'a', columns: 2, rows: 3, slices: 4, spacing: [1, 1, 1] }))).toEqual({ seriesUid: 'a', columns: 2, rows: 3, slices: 4 });
  });
  it('probeSliceFile reads the UID and rows x columns of a slice (header only); null for what is not a DICOM', async () => {
    const f = asFile(makeCtSlice({ seriesUid: '1.2.9', rows: 7, columns: 5 }), 'a.dcm');
    expect(await probeSliceFile(f)).toEqual({ seriesUid: '1.2.9', rows: 7, columns: 5 });
    expect(await probeSliceFile(new File([new Uint8Array(500)], 'x.dcm'))).toBeNull();
    expect(await probeSliceFile(new File(['<html>404</html>'], 'x.dcm'))).toBeNull();
  });

  // groups of one index: ct = the series (UID, count, size right), the others are told apart ONLY by what is in their first slice
  const names = (sub, n) => Array.from({ length: n }, (_, i) => `${sub}/${String(i + 1).padStart(4, '0')}.dcm`);
  const DS = { seriesUid: 'S', columns: 5, rows: 4, slices: 3 };
  const probeOf = table => async name => { const r = table[name.split('/')[0]]; if (r instanceof Error) throw r; return r === undefined ? null : r; };
  it('the group whose first slice has the project UID (and the right count and size) is the series; the label group (another UID) is not', async () => {
    const all = [...names('ct', 3), ...names('labels', 3)], seen = [];
    const hit = await findPartnerSeries(all, DS, async n => { seen.push(n); return probeOf({ ct: { seriesUid: 'S', rows: 4, columns: 5, file: 'F' }, labels: { seriesUid: 'L', rows: 4, columns: 5 } })(n); });
    expect(hit).toEqual({ sub: 'ct', names: names('ct', 3), firstFile: 'F' });
    expect(seen.sort()).toEqual(['ct/0001.dcm', 'labels/0001.dcm']); // the FIRST slice of every group, nothing else
  });
  it('no folder name is decided on: the series may be in any sub-folder, or at the top level, or listed after the labels', async () => {
    for (const sub of ['scan', 'ct', 'a', '']) {
      const nm = sub ? names(sub, 3) : ['1.dcm', '2.dcm', '3.dcm'];
      const hit = await findPartnerSeries([...names('labels', 3), ...nm], DS, async n => (n.startsWith('labels') ? { seriesUid: 'L', rows: 4, columns: 5 } : { seriesUid: 'S', rows: 4, columns: 5 }));
      expect(hit, sub).toEqual({ sub, names: nm, firstFile: null });
    }
  });
  it('it does not open: a wrong slice count, wrong rows or columns, a UID that is not the project\'s, an unreadable group, a probe that throws, no project', async () => {
    const ok = { seriesUid: 'S', rows: 4, columns: 5 };
    expect(await findPartnerSeries(names('ct', 2), DS, async () => ok)).toBeNull(); // 2 slices, the project says 3
    expect(await findPartnerSeries(names('ct', 4), DS, async () => ok)).toBeNull();
    expect(await findPartnerSeries(names('ct', 3), DS, async () => ({ ...ok, rows: 5 }))).toBeNull();
    expect(await findPartnerSeries(names('ct', 3), DS, async () => ({ ...ok, columns: 4 }))).toBeNull();
    expect(await findPartnerSeries(names('ct', 3), DS, async () => ({ ...ok, seriesUid: 'T' }))).toBeNull();
    expect(await findPartnerSeries(names('ct', 3), DS, async () => null)).toBeNull();
    expect(await findPartnerSeries(names('ct', 3), DS, async () => { throw new Error('404'); })).toBeNull();
    expect(await findPartnerSeries(names('ct', 3), null, async () => ok)).toBeNull();
    expect(await findPartnerSeries([], DS, async () => ok)).toBeNull();
  });
  it('a group that cannot be read is skipped, the others are still tried', async () => {
    const hit = await findPartnerSeries([...names('labels', 3), ...names('ct', 3)], DS, probeOf({ labels: new Error('404'), ct: { seriesUid: 'S', rows: 4, columns: 5 } }));
    expect(hit?.sub).toBe('ct');
  });
  it('a group that matches by UID but not by count is not opened even if another group has the right count and a wrong UID', async () => {
    const hit = await findPartnerSeries([...names('ct', 2), ...names('labels', 3)], DS, probeOf({ ct: { seriesUid: 'S', rows: 4, columns: 5 }, labels: { seriesUid: 'L', rows: 4, columns: 5 } }));
    expect(hit).toBeNull();
  });
  it('the real arthritis index with the real .vrlab: the ct group is the series, whatever the labels say', async () => {
    const d = readProjectDataset(REAL_PROJECT);
    const hit = await findPartnerSeries(REAL_INDEX, d, probeOf({ ct: { seriesUid: CT_UID, rows: 197, columns: 501 }, labels: { seriesUid: '1.2.3.labels', rows: 197, columns: 501 } }));
    expect(hit.sub).toBe('ct'); expect(hit.names).toHaveLength(340); expect(hit.names[0]).toBe('ct/HindpawCT_0001.dcm');
  });
});
