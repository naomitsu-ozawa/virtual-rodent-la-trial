import { describe, it, expect } from 'vitest';
import { resolveSampleBase, SAMPLE_SETS, DEFAULT_SAMPLE, sampleCacheKey, sampleSliceUrl, sampleIndexUrl, sampleProjectUrl } from '../../docs/sample-sets.js';

describe('practice dataset paths and cache keys', () => {
  it('keeps sample1 URLs and its existing cache key unchanged', () => {
    expect(DEFAULT_SAMPLE).toBe('sample1');
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
    expect(Object.keys(SAMPLE_SETS)).toEqual(['sample1', 'sample2', 'sample3', 'sample4']);
    expect(DEFAULT_SAMPLE).toBe('sample1');
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
    const prefixes = Object.values(SAMPLE_SETS).map(s => s.keyPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(() => sampleCacheKey('o', 'nope', 'a')).toThrow();
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
    expect(resolveSampleBase(SAMPLE_SETS.sample3.base, '/r/pr-preview/pr-157/', true)).toBe('/r/demo/sample3/');
    expect(resolveSampleBase(SAMPLE_SETS.sample3.base, '/r/pr-preview/pr-157/', false)).toBe('demo/sample3/');
    expect(sampleIndexUrl('sample3', '/r/pr-preview/pr-157/')).toBe('demo/sample3/index.json'); // flag is false in the repo
    expect(sampleProjectUrl('sample3', '/')).toBe('demo/sample3/project.vrlab');
  });
  it('url helpers keep the same cache key whichever base is used', () => {
    expect(sampleCacheKey('https://x.io', 'sample2', 'a.dcm')).toBe('https://x.io/__vrl-sample/v1/sample2/a.dcm');
    expect(sampleIndexUrl('sample2', '/r/pr-preview/pr-1/')).toBe('demo/sample2/index.json'); // flag is false in the repo
  });
});
