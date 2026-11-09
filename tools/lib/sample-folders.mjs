// Node side of the practice-data registry (docs/sample-registry.js): reads the same docs/demo/sampleN/sample.json files from the file system, with the SAME discovery
// (sample1, sample2, ... stops at the first folder without a sample.json) and the same validation, so tools and tests see exactly the list the page builds.
// Used by tools/make-event-thumbs.mjs, tools/register-sample.mjs and the unit tests (tests/setup/registry.js).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverSamples, buildRegistry } from '../../docs/sample-registry.js';

// the valid entries of every demo/sampleN folder (folder order). demoDir = .../docs/demo
export async function readSampleEntries(demoDir, opts = {}) {
  return discoverSamples(id => {
    const p = join(demoDir, id, 'sample.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  }, opts);
}
export async function readSampleRegistry(demoDir, opts = {}) {
  return buildRegistry(await readSampleEntries(demoDir, opts), opts);
}
