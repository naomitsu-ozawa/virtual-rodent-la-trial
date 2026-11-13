// Partner data of a practice dataset (pure: no DOM, no network; unit-tested in tests/unit/sample-pairs.test.js).
// A practice dataset can have a partner folder below it (docs/demo/<id>/<dir>/, e.g. the arthritis hindpaw next to the normal one) that is shown in the same space. Which partners exist
// is read from docs/sample-pairs.json, which tools/scan-sample-pairs.mjs writes from the folder structure (nothing is registered by hand).
// The slices of a partner folder are NOT told apart by a folder name: its index.json lists them, they are split by sub-folder, and the group whose first slice has the SeriesInstanceUID
// of the folder's .vrlab (dataset.seriesUid) - with the same slice count and the same rows x columns - is the series. Every other group (e.g. a label volume with its own UID) is not opened.
// This module does no loading itself: docs/data-load.js reads the files and hands them in (so no fetch is made here, and nothing touches the volume / the active series).
import { unzipSync, strFromU8 } from './vendor/fflate@0.8.2/index.js';
import { normalizeSamplePairs, sliceSubfolder } from './sample-sets.js?v=20261113-build733';
import { parseDicomHeader, parsedSliceMeta } from './dicom.js?v=20261113-build733';

// where docs/sample-pairs.json is read from: next to the page (it is part of the site's own files, not of docs/demo)
export const samplePairsUrl = () => 'sample-pairs.json';

// the parsed file -> {<id>: [{dir, project}]}; an entry that breaks the rules is left out with a warning (the file is tool-made, so this is only a guard). Anything that is not an object: {}.
export function parseSamplePairs(raw, { warn = console.warn } = {}) {
  const { pairs, problems } = normalizeSamplePairs(raw);
  for (const p of problems) warn('Sample pairs: ' + p + '; skipped');
  return pairs;
}

// the names of an index.json split by sub-folder, in the order they first appear: [{ sub, names }] (sub '' = the names that are read from the folder itself).
// Names that are not a string are dropped. No folder name is special-cased.
export function splitIndexBySubfolder(names) {
  const groups = new Map();
  for (const n of Array.isArray(names) ? names : []) {
    if (typeof n !== 'string' || !n) continue;
    const sub = sliceSubfolder(n);
    if (!groups.has(sub)) groups.set(sub, []);
    groups.get(sub).push(n);
  }
  return [...groups].map(([sub, list]) => ({ sub, names: list }));
}

// the dataset block of a .vrlab (a zip with project.json): { seriesUid, columns, rows, slices } or null when it cannot be read / is not a project / lacks one of the four
export function readProjectDataset(bytes) {
  try {
    const entries = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { filter: f => f.name === 'project.json' });
    const p = JSON.parse(strFromU8(entries['project.json']));
    const d = p?.format === 'virtual-rodent-lab-project' ? p.dataset : null;
    const pos = n => Number.isInteger(n) && n > 0;
    return d && typeof d.seriesUid === 'string' && d.seriesUid && pos(d.columns) && pos(d.rows) && pos(d.slices)
      ? { seriesUid: d.seriesUid, columns: d.columns, rows: d.rows, slices: d.slices } : null;
  } catch { return null; }
}

// the identity of one slice file: { seriesUid, rows, columns } or null when it cannot be read as a DICOM slice
export async function probeSliceFile(file) {
  try {
    const m = parsedSliceMeta(file, await parseDicomHeader(file));
    return m ? { seriesUid: m.seriesUid, rows: m.rows, columns: m.columns } : null;
  } catch { return null; }
}

// Finds the series of a partner folder.
//   names   : the files of its index.json
//   dataset : readProjectDataset() of its .vrlab (null: nothing is opened)
//   probe   : async (name) -> { seriesUid, rows, columns, file? } | null | throws  - reads the FIRST slice of a group (a slice that cannot be read: that group is skipped)
// Every group is probed once (first slice only). A group is the series when its UID is the project's AND it has dataset.slices slices AND its rows x columns are the project's.
// The first matching group in index order wins. Returns { sub, names, firstFile } (firstFile = the `file` the probe returned for that slice, so it need not be read twice) or null.
export async function findPartnerSeries(names, dataset, probe) {
  if (!dataset) return null;
  const groups = splitIndexBySubfolder(names);
  const probed = await Promise.all(groups.map(async g => { try { return await probe(g.names[0]); } catch { return null; } }));
  for (let i = 0; i < groups.length; i++) {
    const p = probed[i], g = groups[i];
    if (!p || p.seriesUid !== dataset.seriesUid) continue;
    if (g.names.length !== dataset.slices || p.rows !== dataset.rows || p.columns !== dataset.columns) continue;
    return { sub: g.sub, names: g.names, firstFile: p.file ?? null };
  }
  return null;
}
