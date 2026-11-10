import { describe, it, expect } from 'vitest';
import { registry, defaultSampleId } from '../../docs/sample-registry.js';
import { resolveSampleBase, sampleSet, sampleJsonUrl, sampleListUrl, isSampleId, sampleCacheKey, sampleSliceUrl, sampleIndexUrl, sampleProjectUrl, sliceRoot } from '../../docs/sample-sets.js';
import { listedIds } from '../helpers/demo-lists.js';
import { SLICE_ROOT } from '../../docs/sample-config.js';

describe('practice dataset paths and cache keys', () => {
  it('keeps sample1 URLs and its existing cache key unchanged', () => {
    expect(defaultSampleId()).toBe('sample1'); // the default now comes from the registry (sample1/sample.json "default": true), unchanged for the user
    expect(sampleIndexUrl('sample1')).toBe('demo/sample1/index.json');
    expect(sampleProjectUrl('sample1')).toBe('demo/sample1/project.vrlab');
    expect(sampleSliceUrl('sample1', 'a b.dcm')).toBe('demo/sample1/a%20b.dcm');
    expect(sampleCacheKey('https://x.io', 'sample1', 'a b.dcm')).toBe('https://x.io/__vrl-sample/v1/a%20b.dcm');
  });
  it('puts the folder in the sample2 key so equal file names do not collide', () => {
    const n = 'Sample_2_20250707_145808_0001.dcm';
    expect(sampleIndexUrl('sample2')).toBe('demo/sample2/index.json');
    expect(sampleProjectUrl('sample2')).toBe('demo/sample2/project.vrlab');
    expect(sampleSliceUrl('sample2', n)).toBe('demo/sample2/' + n);
    expect(sampleCacheKey('https://x.io', 'sample2', n)).toBe('https://x.io/__vrl-sample/v1/sample2/' + n);
    expect(sampleCacheKey('https://x.io', 'sample2', 'z.dcm')).not.toBe(sampleCacheKey('https://x.io', 'sample1', 'z.dcm'));
  });
  it('appends sample3 (mouse head) with its own folder key and keeps the default', () => {
    const n = '01784_crop512_0001.dcm';
    expect(registry.samples.map(s => s.id).sort()).toEqual([...listedIds].sort()); // exactly the datasets of docs/demo/samples.json (the registry), each set by the one rule
    expect(defaultSampleId()).toBe('sample1');
    expect(sampleIndexUrl('sample3')).toBe('demo/sample3/index.json');
    expect(sampleSliceUrl('sample3', n)).toBe('demo/sample3/' + n);
    expect(sampleCacheKey('https://x.io', 'sample3', n)).toBe('https://x.io/__vrl-sample/v1/sample3/' + n);
  });
  it('appends sample4 (trabecular bone) with its own folder key', () => {
    const n = 'Sample_4_0001.dcm';
    expect(sampleIndexUrl('sample4')).toBe('demo/sample4/index.json');
    expect(sampleSliceUrl('sample4', n)).toBe('demo/sample4/' + n);
    expect(sampleCacheKey('https://x.io', 'sample4', n)).toBe('https://x.io/__vrl-sample/v1/sample4/' + n);
  });
  it('key prefixes are distinct across sets and an unknown set throws', () => {
    const prefixes = registry.samples.map(s => sampleSet(s.id).keyPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(sampleSet('sample1')).toEqual({ base: 'demo/sample1/', keyPrefix: '/__vrl-sample/v1/' }); // existing caches stay valid
    expect(sampleSet('sample2')).toEqual({ base: 'demo/sample2/', keyPrefix: '/__vrl-sample/v1/sample2/' });
    expect(() => sampleCacheKey('o', 'nope', 'a')).toThrow();
    expect(() => sampleCacheKey('o', 'sample99', 'a')).toThrow(); // a valid name, but not a registered dataset (not in docs/demo/samples.json)
    expect(sampleJsonUrl('sample4')).toBe('demo/sample4/sample.json');
    expect(sampleJsonUrl('sample4', '/r/pr-preview/pr-1/')).toBe('demo/sample4/sample.json'); // flag is false in the repo
    expect(() => sampleJsonUrl('../x')).toThrow(/Unknown sample set/);
  });
});

describe('the folder name rule (isSampleId): the ONE function every module asks', () => {
  it('accepts `sample` + a number, and a name of lower-case letters, digits and hyphens that starts with a letter', () => {
    for (const id of ['sample1', 'sample12', 'sample01', 'sample', 'a', 'rat-kidney-4um', 'mouse-skull-e12-5', 'x1', 'a--b']) expect(isSampleId(id), id).toBe(true);
  });
  it('refuses `../`, `/`, capitals, a leading hyphen or digit, spaces, dots, backslashes, and anything that is not a string', () => {
    for (const id of ['../sample1', '..', '.', 'sample1/', '/sample1', 'a/b', 'a\\b', 'Sample1', 'sAmple1', 'RAT', '-x', '1sample', '9', 'a b', ' a', 'a ', 'a.b', 'a%2e', 'a_b', '', 'é', 'sample1\n', null, undefined, 0, 1, {}, [], ['sample1']]) expect(isSampleId(id), String(id)).toBe(false);
  });
  it('is what the URL builders use: a name that breaks the rule has no URL, a name that follows it gets the folder of that name', () => {
    expect(() => sampleJsonUrl('../x')).toThrow(/Unknown sample set/);
    expect(() => sampleJsonUrl('Upper')).toThrow(/Unknown sample set/);
    expect(sampleJsonUrl('rat-kidney-4um')).toBe('demo/rat-kidney-4um/sample.json');
  });
  it('the cache key of a named folder carries the folder name; sample1 keeps the original key (existing caches stay valid)', () => {
    expect(sampleSet('sample1')?.keyPrefix).toBe('/__vrl-sample/v1/');
    for (const id of listedIds.filter(i => i !== 'sample1')) expect(sampleSet(id).keyPrefix).toBe('/__vrl-sample/v1/' + id + '/');
  });
  it('the list of the datasets is demo/samples.json, resolved like the data (a PR preview reads the site root)', () => {
    expect(sampleListUrl('/')).toBe('demo/samples.json');
    expect(sampleListUrl()).toBe('demo/samples.json');
    expect(resolveSampleBase('demo/samples.json', '/r/pr-preview/pr-9/', true)).toBe('/r/demo/samples.json');
  });
});

describe('resolveSampleBase (PR previews read the practice data from the site root)', () => {
  const b = 'demo/sample1/';
  it('keeps the relative base on the site root, with or without index.html', () => {
    for (const p of ['/', '/site/', '/site', '/site/index.html', ''])
      expect(resolveSampleBase(b, p, true)).toBe(b);
  });
  it('keeps the relative base on a local dev server', () => {
    for (const p of ['/', '/index.html', '/docs/']) expect(resolveSampleBase(b, p, true)).toBe(b);
  });
  it('uses the site-root demo from a preview path (trailing slash, none, index.html)', () => {
    for (const p of ['/site/pr-preview/pr-12/', '/site/pr-preview/pr-12', '/site/pr-preview/pr-12/index.html'])
      expect(resolveSampleBase(b, p, true)).toBe('/site/' + b);
    expect(resolveSampleBase(b, '/pr-preview/pr-3/', true)).toBe('/' + b);
  });
  it('does not match look-alike paths', () => {
    for (const p of ['/site/pr-preview/', '/site/pr-preview/pr-x/', '/site/pr-preview/pr-12x/'])
      expect(resolveSampleBase(b, p, true)).toBe(b);
  });
  it('stays relative in a preview that ships its own docs/demo (flag off)', () => {
    expect(resolveSampleBase(b, '/site/pr-preview/pr-12/', false)).toBe(b);
  });
  it('sample3 goes through the same base resolution', () => {
    expect(resolveSampleBase(sampleSet('sample3').base, '/r/pr-preview/pr-157/', true)).toBe('/r/demo/sample3/');
    expect(resolveSampleBase(sampleSet('sample3').base, '/r/pr-preview/pr-157/', false)).toBe('demo/sample3/');
    expect(sampleIndexUrl('sample3', '/r/pr-preview/pr-157/')).toBe('demo/sample3/index.json'); // flag is false in the repo
    expect(sampleProjectUrl('sample3', '/')).toBe('demo/sample3/project.vrlab');
  });
  it('url helpers keep the same cache key whichever base is used', () => {
    expect(sampleCacheKey('https://x.io', 'sample2', 'a.dcm')).toBe('https://x.io/__vrl-sample/v1/sample2/a.dcm');
    expect(sampleIndexUrl('sample2', '/r/pr-preview/pr-1/')).toBe('demo/sample2/index.json'); // flag is false in the repo
  });
});

// The published site carries no .dcm: .github/workflows/pages.yml writes SLICE_ROOT (this repository's main branch on raw.githubusercontent.com)
// into the published copy of docs/sample-config.js, and only the slices are read from there.
describe('slice root (SLICE_ROOT)', () => {
  const ROOT = 'https://raw.githubusercontent.com/acct-1/repo.name_x-trial/main/docs/';
  it('is empty in the repository, so the slices are read as before', () => {
    expect(SLICE_ROOT).toBe('');
    expect(sliceRoot(SLICE_ROOT)).toBe('');
    expect(sampleSliceUrl('sample2', 'a.dcm')).toBe('demo/sample2/a.dcm');
    expect(sampleSliceUrl('sample2', 'a.dcm', '/r/pr-preview/pr-3/', '')).toBe('demo/sample2/a.dcm');
  });
  it('a root of the one accepted shape: the .dcm slices of every set are read from <root>demo/<id>/ (preview or not)', () => {
    expect(sliceRoot(ROOT)).toBe(ROOT);
    expect(sampleSliceUrl('sample1', 'a b.dcm', '/', ROOT)).toBe(ROOT + 'demo/sample1/a%20b.dcm');
    expect(sampleSliceUrl('sample5', '001.dcm', '/r/pr-preview/pr-15/', ROOT)).toBe(ROOT + 'demo/sample5/001.dcm');
    expect(sampleSliceUrl('sample3', 'X.DCM', '/', ROOT)).toBe(ROOT + 'demo/sample3/X.DCM');
    // a hostile name stays one path segment below the set folder
    expect(sampleSliceUrl('sample2', '../../x.dcm', '/', ROOT)).toBe(ROOT + 'demo/sample2/..%2F..%2Fx.dcm');
  });
  it('anything that is not a .dcm slice (a thumbnail, ...) is not read from the root', () => {
    expect(sampleSliceUrl('sample2', 'thumb.webp', '/', ROOT)).toBe('demo/sample2/thumb.webp');
    expect(sampleSliceUrl('sample2', 'a.dcm.webp', '/', ROOT)).toBe('demo/sample2/a.dcm.webp');
  });
  it('the cache key does not depend on the root (devices that already downloaded a set do not download it again)', () => {
    expect(sampleCacheKey('https://x.io', 'sample1', 'a.dcm')).toBe('https://x.io/__vrl-sample/v1/a.dcm');
    expect(sampleCacheKey('https://x.io', 'sample2', 'a.dcm')).toBe('https://x.io/__vrl-sample/v1/sample2/a.dcm');
  });
  it.each([
    'https://raw.githubusercontent.com/o/r/dev/docs/', 'https://raw.githubusercontent.com/o/r/main/', 'https://raw.githubusercontent.com/o/r/main/docs',
    'https://raw.githubusercontent.com/o/../main/docs/', 'https://raw.githubusercontent.com/o/.r/main/docs/', 'https://raw.githubusercontent.com/-o/r/main/docs/',
    'http://raw.githubusercontent.com/o/r/main/docs/', 'https://evil.example/o/r/main/docs/', 'https://raw.githubusercontent.com.evil.example/o/r/main/docs/',
    '//raw.githubusercontent.com/o/r/main/docs/', 'https://raw.githubusercontent.com/o/r/main/docs/?x=1', 'https://raw.githubusercontent.com/o/r/main/docs/#h',
    'https://raw.githubusercontent.com/o/r/x/main/docs/', ' ' + 'https://raw.githubusercontent.com/o/r/main/docs/', '/', 'demo/', null, undefined, 0, {},
  ].map(v => [String(v), v]))('a root of any other shape (%s) is ignored: the slices are read as before', (_l, root) => {
    expect(sliceRoot(root)).toBe('');
    expect(sampleSliceUrl('sample2', 'a.dcm', '/', root)).toBe('demo/sample2/a.dcm');
    expect(sampleSliceUrl('sample2', 'a.dcm', '/r/pr-preview/pr-3/', root)).toBe('demo/sample2/a.dcm'); // flag is false in the repo
  });
  it('an unknown set id still throws, root or not', () => {
    expect(() => sampleSliceUrl('sample99', 'a.dcm', '/', ROOT)).toThrow(/Unknown sample set/);
  });
});
