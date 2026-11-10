// Fills the practice-data registry (docs/sample-registry.js) from the real docs/demo/samples.json list and the sample.json of every listed folder before every test file: the browser reads them with fetch when the page
// starts; in Node (vitest) nothing is fetched, so this setup file does it from the file system, with the same loading and validation (tools/lib/sample-folders.mjs).
import { fileURLToPath } from 'node:url';
import { readSampleEntries } from '../../tools/lib/sample-folders.mjs';
import { setRegistry } from '../../docs/sample-registry.js';

setRegistry(await readSampleEntries(fileURLToPath(new URL('../../docs/demo', import.meta.url))));
