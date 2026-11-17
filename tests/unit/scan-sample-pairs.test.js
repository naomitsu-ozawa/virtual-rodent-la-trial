import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanSamplePairs, samplePairsText, writeSamplePairs, SAMPLE_PAIRS_FILE } from '../../tools/scan-sample-pairs.mjs';
import { listedIds, DEMO } from '../helpers/demo-lists.js';

// docs/sample-pairs.json is made by tools/scan-sample-pairs.mjs from the folder structure of docs/demo (nothing is registered by hand): a sub-folder of a listed dataset is a partner when it has an
// index.json, a sample.json the registry accepts and exactly one .vrlab. The file in the repository must be exactly the scan of the folders as they are now.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const roots = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const VALID = JSON.stringify({ name: { ja: 'a', en: 'a' }, description: { ja: 'b', en: 'b' }, level: null });

describe('docs/sample-pairs.json of the repository', () => {
  it('is exactly the scan of docs/demo as it is now (and --check says so)', () => {
    const pairs = scanSamplePairs(DEMO);
    expect(JSON.parse(readFileSync(join(ROOT, SAMPLE_PAIRS_FILE), 'utf8'))).toEqual(pairs);
    expect(readFileSync(join(ROOT, SAMPLE_PAIRS_FILE), 'utf8')).toBe(samplePairsText(pairs));
    const r = spawnSync(process.execPath, [join(ROOT, 'tools/scan-sample-pairs.mjs'), '--check'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
  it('sample7 has ONE partner, arthritis, and every other dataset stands alone', () => {
    const pairs = scanSamplePairs(DEMO);
    expect(Object.keys(pairs)).toEqual(['sample7']);
    expect(pairs.sample7).toEqual([{ dir: 'arthritis', project: 'hindpaw_154_2m_arthritis.vrlab' }]);
    for (const id of listedIds.filter(i => i !== 'sample7')) expect(pairs[id], id).toBeUndefined();
    expect(readFileSync(join(ROOT, SAMPLE_PAIRS_FILE), 'utf8')).toBe('{\n  "sample7": [\n    {"dir":"arthritis","project":"hindpaw_154_2m_arthritis.vrlab"}\n  ]\n}\n');
  });
});

describe('the scan (synthetic trees)', () => {
  function tree(list = ['sample1', 'sample2']) {
    const root = mkdtempSync(join(tmpdir(), 'scan-pairs-')); roots.push(root);
    const demo = join(root, 'docs/demo'); mkdirSync(demo, { recursive: true });
    writeFileSync(join(demo, 'samples.json'), JSON.stringify(list));
    for (const id of list) { mkdirSync(join(demo, id)); writeFileSync(join(demo, id, 'sample.json'), VALID); }
    return { root, demo };
  }
  const partner = (demo, id, dir, { index = true, sample = VALID, projects = ['p.vrlab'] } = {}) => {
    const d = join(demo, id, dir); mkdirSync(join(d, 'ct'), { recursive: true });
    if (index) writeFileSync(join(d, 'index.json'), '{"files":[]}');
    if (sample !== null) writeFileSync(join(d, 'sample.json'), sample);
    for (const p of projects) writeFileSync(join(d, p), 'zip');
    return d;
  };
  it('a sub-folder with index.json, a valid sample.json and exactly one .vrlab is a partner; the partner dir is not looked into (ct/ is not read)', () => {
    const { demo } = tree(); partner(demo, 'sample2', 'inflamed');
    expect(scanSamplePairs(demo)).toEqual({ sample2: [{ dir: 'inflamed', project: 'p.vrlab' }] });
  });
  it('the list file has the shape {"id":[{"dir","project"}]}, one partner per line, sorted by dir; {} for none', () => {
    const { root, demo } = tree(); partner(demo, 'sample1', 'b-two', { projects: ['two.vrlab'] }); partner(demo, 'sample1', 'a-one'); partner(demo, 'sample2', 'z');
    expect(writeSamplePairs(root)).toEqual({ sample1: [{ dir: 'a-one', project: 'p.vrlab' }, { dir: 'b-two', project: 'two.vrlab' }], sample2: [{ dir: 'z', project: 'p.vrlab' }] });
    expect(readFileSync(join(root, SAMPLE_PAIRS_FILE), 'utf8')).toBe('{\n  "sample1": [\n    {"dir":"a-one","project":"p.vrlab"},\n    {"dir":"b-two","project":"two.vrlab"}\n  ],\n  "sample2": [\n    {"dir":"z","project":"p.vrlab"}\n  ]\n}\n');
    expect(samplePairsText({})).toBe('{}\n');
  });
  it('is left out: no index.json, no / an invalid sample.json, no .vrlab, two .vrlab, a .vrlab that is a folder, a bad folder name, a link, a plain file', () => {
    const { demo } = tree();
    partner(demo, 'sample1', 'no-index', { index: false });
    partner(demo, 'sample1', 'no-sample', { sample: null });
    partner(demo, 'sample1', 'bad-sample', { sample: '{"name":1}' });
    partner(demo, 'sample1', 'broken-json', { sample: '{oops' });
    partner(demo, 'sample1', 'no-project', { projects: [] });
    partner(demo, 'sample1', 'two-projects', { projects: ['a.vrlab', 'b.vrlab'] });
    partner(demo, 'sample1', 'other-ext', { projects: ['p.zip'] });
    const asDir = partner(demo, 'sample1', 'project-is-dir', { projects: [] }); mkdirSync(join(asDir, 'x.vrlab'));
    partner(demo, 'sample1', 'Capital'); partner(demo, 'sample1', '1digit'); partner(demo, 'sample1', 'with_underscore');
    symlinkSync(join(demo, 'sample2'), join(demo, 'sample1', 'a-link'));
    writeFileSync(join(demo, 'sample1', 'plain.json'), '{}');
    partner(demo, 'sample1', 'good');
    expect(scanSamplePairs(demo)).toEqual({ sample1: [{ dir: 'good', project: 'p.vrlab' }] });
  });
  it('a project name that is not a plain file name is left out', () => {
    const { demo } = tree(); partner(demo, 'sample1', 'dot', { projects: ['.vrlab'] });
    expect(scanSamplePairs(demo)).toEqual({});
  });
  it('only the datasets listed in samples.json are looked at; a folder that is not listed (or is not a folder) has no partner', () => {
    const { demo } = tree(['sample1']); mkdirSync(join(demo, 'sample2')); partner(demo, 'sample2', 'x');
    expect(scanSamplePairs(demo)).toEqual({});
    writeFileSync(join(demo, 'samples.json'), '["sample1","gone"]');
    expect(scanSamplePairs(demo)).toEqual({});
  });
  it('the partner is found whatever its slices are called (no folder name such as ct is looked for)', () => {
    const { demo } = tree(); const d = partner(demo, 'sample2', 'x'); rmSync(join(d, 'ct'), { recursive: true });
    expect(scanSamplePairs(demo)).toEqual({ sample2: [{ dir: 'x', project: 'p.vrlab' }] });
  });
  it('no list = an error (not an empty answer)', () => {
    const root = mkdtempSync(join(tmpdir(), 'scan-pairs-')); roots.push(root); mkdirSync(join(root, 'docs/demo'), { recursive: true });
    expect(() => scanSamplePairs(join(root, 'docs/demo'))).toThrow(/no list/);
  });
});
