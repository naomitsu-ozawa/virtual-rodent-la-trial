// Node side of the practice-data registry (docs/sample-registry.js): reads the same list docs/demo/samples.json and the sample.json of every LISTED folder from the file system, with the SAME
// loading and the same validation, so tools and tests see exactly the list the page builds. A folder that is not in the list is never read. No list = an error here (the page shows no datasets
// in that case; a tool or a test must say so loudly).
// Used by tools/make-event-thumbs.mjs, tools/register-sample.mjs, tools/export-public.mjs and the unit tests (tests/setup/registry.js).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverSamples, buildRegistry, parseSampleList } from '../../docs/sample-registry.js';
import { isSampleId } from '../../docs/sample-sets.js';

export const SAMPLES_LIST = 'samples.json';
// the folder ids of docs/demo/samples.json, in the order of the list (the display order). demoDir = .../docs/demo
export function readSampleList(demoDir, opts = {}) {
  const p = join(demoDir, SAMPLES_LIST);
  if (!existsSync(p)) throw new Error('no list of the practice datasets: ' + p);
  return parseSampleList(JSON.parse(readFileSync(p, 'utf8')), opts);
}
// writes the list (an array of folder ids, one per line); every id must follow the folder name rule
export function writeSampleList(demoDir, ids) {
  for (const id of ids) if (!isSampleId(id)) throw new Error('not a valid folder name: ' + id);
  if (new Set(ids).size !== ids.length) throw new Error('a folder id is listed twice');
  writeFileSync(join(demoDir, SAMPLES_LIST), '[\n' + ids.map(id => '  ' + JSON.stringify(id)).join(',\n') + '\n]\n');
}
// the valid entries of every LISTED demo folder (the order of the list). demoDir = .../docs/demo
export async function readSampleEntries(demoDir, opts = {}) {
  return discoverSamples(readSampleList(demoDir, opts), id => {
    const p = join(demoDir, id, 'sample.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  }, opts);
}
export async function readSampleRegistry(demoDir, opts = {}) {
  return buildRegistry(await readSampleEntries(demoDir, opts), opts);
}
