#!/usr/bin/env node
// Writes docs/sample-pairs.json: which practice datasets have a PARTNER folder (a second series shown in the same space). Nothing is registered by hand: the file is made from the folder structure.
//
//   node tools/scan-sample-pairs.mjs            write docs/sample-pairs.json of this repository
//   node tools/scan-sample-pairs.mjs --check    do not write; exit 1 when the file differs from the scan
//   node tools/scan-sample-pairs.mjs <root>     scan / write below another tree (an export, a test copy)
//
// For every dataset listed in docs/demo/samples.json, each direct sub-folder docs/demo/<id>/<dir>/ is a partner when ALL of these hold:
//   - <dir> follows the sub-folder name rule ([a-z][a-z0-9-]*, docs/sample-sets.js isPairDir) and is a real folder (not a link),
//   - it has an index.json and a sample.json that the registry accepts (docs/sample-registry.js parseSample, the same check as for a dataset),
//   - it holds exactly ONE .vrlab project file (a plain file with a plain name, docs/sample-sets.js isPairProjectName).
// Nothing is read below <dir> (ct/, labels/ ...): which of its slices is the series is decided in the app by the UID of the .vrlab (docs/sample-pairs.js).
// The file: {"<id>": [{"dir": "<dir>", "project": "<file>.vrlab"}]}, only datasets that have a partner, in the order of samples.json, partners by name.
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSample } from '../docs/sample-registry.js';
import { isPairDir, isPairProjectName } from '../docs/sample-sets.js';
import { readSampleList } from './lib/sample-folders.mjs';

export const SAMPLE_PAIRS_FILE = 'docs/sample-pairs.json';
const isFile = p => existsSync(p) && lstatSync(p).isFile();
const isRealDir = p => existsSync(p) && lstatSync(p).isDirectory(); // lstat: a link to a folder is not a folder here
const validSampleJson = (p, dir) => { try { return !!parseSample(JSON.parse(readFileSync(p, 'utf8')), dir).entry; } catch { return false; } };

// -> { <id>: [{ dir, project }] } for the datasets listed in <demoDir>/samples.json
export function scanSamplePairs(demoDir) {
  const out = {};
  for (const id of readSampleList(demoDir, { warn: () => {} })) {
    const base = join(demoDir, id);
    if (!isRealDir(base)) continue;
    const list = [];
    for (const dir of readdirSync(base).sort()) {
      const d = join(base, dir);
      if (!isPairDir(dir) || !isRealDir(d)) continue;
      if (!isFile(join(d, 'index.json')) || !isFile(join(d, 'sample.json')) || !validSampleJson(join(d, 'sample.json'), dir)) continue;
      const projects = readdirSync(d).filter(n => n.endsWith('.vrlab') && isFile(join(d, n)));
      if (projects.length === 1 && isPairProjectName(projects[0])) list.push({ dir, project: projects[0] });
    }
    if (list.length) out[id] = list;
  }
  return out;
}
// the text of the file (one partner per line; '{}' when there is none)
export function samplePairsText(pairs) {
  const ids = Object.keys(pairs);
  if (!ids.length) return '{}\n';
  return '{\n' + ids.map(id => `  ${JSON.stringify(id)}: [\n` + pairs[id].map(e => '    ' + JSON.stringify({ dir: e.dir, project: e.project })).join(',\n') + '\n  ]').join(',\n') + '\n}\n';
}
// scans <root>/docs/demo and writes <root>/docs/sample-pairs.json; returns the pairs
export function writeSamplePairs(root) {
  const pairs = scanSamplePairs(join(root, 'docs/demo'));
  writeFileSync(join(root, SAMPLE_PAIRS_FILE), samplePairsText(pairs));
  return pairs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), check = args.includes('--check');
  const root = resolve(args.find(a => !a.startsWith('--')) || fileURLToPath(new URL('..', import.meta.url)));
  if (check) {
    const want = samplePairsText(scanSamplePairs(join(root, 'docs/demo'))), have = existsSync(join(root, SAMPLE_PAIRS_FILE)) ? readFileSync(join(root, SAMPLE_PAIRS_FILE), 'utf8') : null;
    if (have !== want) { console.error(`${SAMPLE_PAIRS_FILE} differs from the folder structure; run: node tools/scan-sample-pairs.mjs`); process.exit(1); }
    console.log(`${SAMPLE_PAIRS_FILE} is up to date`);
  } else {
    const pairs = writeSamplePairs(root);
    console.log(`${SAMPLE_PAIRS_FILE}: ${Object.values(pairs).flat().length} partner(s) of ${Object.keys(pairs).length} dataset(s)`);
  }
}
