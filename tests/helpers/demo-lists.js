// What the tests know about the practice data WITHOUT naming or counting it: docs/demo/samples.json (the list the app reads, in display order) and the sample.json of every listed folder,
// read straight from the files (not through the registry code under test), and tools/public-samples.json (the datasets that may go into the trial; the list itself when the file is not there).
// The expected order is the rule of the registry: the levels Lv0..Lv3 by the level field, then every dataset without a level in the order of the list.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const DEMO = fileURLToPath(new URL('../../docs/demo/', import.meta.url));
const json = p => JSON.parse(readFileSync(p, 'utf8'));
export const listedIds = json(join(DEMO, 'samples.json'));
const publicFile = fileURLToPath(new URL('../../tools/public-samples.json', import.meta.url));
export const publicIds = existsSync(publicFile) ? json(publicFile) : listedIds;
export const rawOf = id => json(join(DEMO, id, 'sample.json'));

const withLevel = listedIds.filter(id => Number.isInteger(rawOf(id).level)).sort((a, b) => rawOf(a).level - rawOf(b).level || listedIds.indexOf(a) - listedIds.indexOf(b));
const seen = new Set();
export const LEVEL_IDS = withLevel.filter(id => { const lv = rawOf(id).level; if (seen.has(lv)) return false; seen.add(lv); return true; }); // a second dataset of the same level is a 「その他」
export const OTHER_IDS = listedIds.filter(id => !LEVEL_IDS.includes(id));
export const ORDER = [...LEVEL_IDS, ...OTHER_IDS]; // the order of the registry, the cards, the VR data list, the preparation
export const LEVEL_NUMBERS = LEVEL_IDS.map(id => rawOf(id).level);
export const hasCredit = id => ['credit', 'license', 'changes', 'terms'].some(k => rawOf(id)[k] !== undefined);
export const CREDIT_IDS = ORDER.filter(hasCredit);
