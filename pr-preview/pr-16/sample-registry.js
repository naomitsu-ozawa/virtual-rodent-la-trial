// The registry of the practice datasets hosted on this site: ONE loader, ONE registry (pure parts unit-tested: tests/unit/sample-registry.test.js).
// Every dataset is a folder docs/demo/<id>/ with a sample.json (names, level, mission, initial segments, credit / license) and a thumb.webp. The app reads the list
// docs/demo/samples.json ONCE (an array of folder ids, the display order) and then the sample.json of every listed folder, at the same time. A folder that is not in the list is never read.
// The list is all there is: no search for folders. Nothing else lists the datasets:
// the 体験会 cards, the practice-data chooser, the in-VR data list, the preparation list, the tutorial's data and the credit boxes are all built from this registry.
//
// The module waits for the registry before it finishes loading (top-level await at the bottom), so every module that imports it already sees the finished registry.
// If the list or a file cannot be read (offline, server error) the registry stays EMPTY: no cards and no chooser buttons, the rest of the page works as usual.
// Optional fields (all validated here, never required): size {dims:[columns,rows,slices], megabytes} = the real size shown while the data loads; vrInitialScale (a number > 0) = the
// magnification the VR / AR view starts the data at (1 = real size; the registry's Lv0 bone has 4); default (true on at most one dataset) = the dataset the page opens when none is chosen.
// Order: the levels Lv0, Lv1, Lv2, Lv3 by the `level` field, then the datasets without a level (「その他」) in the order of the list. A second dataset that claims a level
// already taken is treated as 「その他」 (console warning).
import { I18N } from './i18n.js?v=20261111-build712';
import { sampleJsonUrl, sampleListUrl, setKnownSampleIds, isSampleId } from './sample-sets.js?v=20261111-build712';

export const SAMPLE_LEVELS = Object.freeze([0, 1, 2, 3]);
export const VR_INITIAL_SCALE_RANGE = Object.freeze({ min: 0.1, max: 20 }); // sane bounds for sample.json vrInitialScale (the viewer clamps to its own limits anyway)
export const HINT_NAMES = Object.freeze(['section', 'move', 'toggle', 'mark', 'distance']); // the keys of event-mode.js EVENT_HINT_KEYS
const FETCH_TIMEOUT_MS = 8000;

const isText = v => typeof v === 'string' && v.trim() !== '';
const isBilingual = v => !!v && typeof v === 'object' && isText(v.ja) && isText(v.en);
const isUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
export const sampleKey = (id, part) => 'smp.' + id + '.' + part; // the i18n keys the registry adds (name, desc, mission, changes, terms, note)

// '約270MB' / 'about 270 MB': the megabytes of sample.json size, rounded to the nearest 10 MB from 100 MB up (269 -> 270). The ONE formatting of every size text (loading text, chooser / card description).
export function mbLabel(size, lang) {
  const mb = size.megabytes, shown = mb >= 100 ? Math.round(mb / 10) * 10 : Math.round(mb);
  return lang === 'en' ? 'about ' + shown + ' MB' : '約' + shown + 'MB';
}
const withMb = (text, size, lang) => size ? text.replaceAll('{mb}', mbLabel(size, lang)) : text;

// Validates the parsed content of one sample.json. Returns { entry, errors }: entry = null when anything required is missing or wrong.
export function parseSample(raw, id) {
  const errors = [];
  if (!isSampleId(id)) return { entry: null, errors: ['bad folder id ' + id] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { entry: null, errors: ['not an object'] };
  const need = (ok, what) => { if (!ok) errors.push(what); };
  need(isBilingual(raw.name), 'name{ja,en}');
  need(isBilingual(raw.description), 'description{ja,en}');
  need(raw.level === null || (Number.isInteger(raw.level) && SAMPLE_LEVELS.includes(raw.level)), 'level (0-3 or null)');
  const isLevel = Number.isInteger(raw.level);
  if (isLevel) {
    need(isBilingual(raw.mission), 'mission{ja,en}');
    need(Array.isArray(raw.hints) && raw.hints.every(h => HINT_NAMES.includes(h)), 'hints (' + HINT_NAMES.join(' | ') + ')');
    need(Array.isArray(raw.initialSegments) && raw.initialSegments.length > 0 && raw.initialSegments.every(isText), 'initialSegments');
  }
  const hasCredit = ['credit', 'license', 'changes', 'terms'].some(k => raw[k] !== undefined); // terms is optional (a CC0 data set has none); the rest is required together
  if (hasCredit) {
    need(!!raw.credit && isText(raw.credit.name) && isUrl(raw.credit.url) && isUrl(raw.credit.dataUrl), 'credit{name,url,dataUrl}');
    need(!!raw.license && isText(raw.license.name) && isUrl(raw.license.url), 'license{name,url}');
    need(isBilingual(raw.changes), 'changes{ja,en}');
    need(raw.terms === undefined || isBilingual(raw.terms), 'terms{ja,en} (optional, but complete when given)');
  }
  const sz = raw.size;
  need(sz === undefined || (!!sz && typeof sz === 'object' && Array.isArray(sz.dims) && sz.dims.length === 3 && sz.dims.every(n => Number.isInteger(n) && n > 0)
    && typeof sz.megabytes === 'number' && Number.isFinite(sz.megabytes) && sz.megabytes > 0), 'size{dims:[columns,rows,slices],megabytes} (optional, but complete when given)');
  need(raw.vrInitialScale === undefined || (typeof raw.vrInitialScale === 'number' && Number.isFinite(raw.vrInitialScale)
    && raw.vrInitialScale >= VR_INITIAL_SCALE_RANGE.min && raw.vrInitialScale <= VR_INITIAL_SCALE_RANGE.max), 'vrInitialScale (optional number ' + VR_INITIAL_SCALE_RANGE.min + '-' + VR_INITIAL_SCALE_RANGE.max + ')');
  need(!(isBilingual(raw.description) && /\{mb\}/.test(raw.description.ja + raw.description.en)) || !!sz, 'size (the description uses {mb})');
  need(raw.default === undefined || typeof raw.default === 'boolean', 'default (optional true / false)');
  need(raw.note === undefined || (isBilingual(raw.note) && hasCredit), 'note{ja,en} (optional; shown with the credit, so it needs one)');
  if (errors.length) return { entry: null, errors };
  const entry = {
    id, level: isLevel ? raw.level : null,
    size: sz ? Object.freeze({ dims: Object.freeze([...sz.dims]), megabytes: sz.megabytes }) : null,
    vrInitialScale: raw.vrInitialScale ?? null, isDefault: raw.default === true,
    name: { ja: raw.name.ja, en: raw.name.en }, description: { ja: withMb(raw.description.ja, sz, 'ja'), en: withMb(raw.description.en, sz, 'en') }, // {mb} of a description = the size from sample.json size (the same words as the loading text)
    mission: isLevel ? { ja: raw.mission.ja, en: raw.mission.en } : null,
    hints: isLevel ? Object.freeze([...raw.hints]) : Object.freeze([]),
    initialSegments: isLevel ? Object.freeze([...raw.initialSegments]) : Object.freeze([]),
    credit: hasCredit ? Object.freeze({
      name: raw.credit.name, url: raw.credit.url, dataUrl: raw.credit.dataUrl, licenseName: raw.license.name, licenseUrl: raw.license.url,
      changes: { ja: raw.changes.ja, en: raw.changes.en }, terms: raw.terms ? { ja: raw.terms.ja, en: raw.terms.en } : null, note: raw.note ? { ja: raw.note.ja, en: raw.note.en } : null,
    }) : null,
  };
  return { entry, errors };
}

// The list of the datasets (the parsed docs/demo/samples.json): an array of folder ids. Returns the valid ids in the order of the list; an id that breaks the folder name rule
// (sample-sets.js isSampleId) or is given twice is skipped with a warning. Anything that is not an array is an error (the whole registry then stays empty).
export function parseSampleList(raw, { warn = console.warn } = {}) {
  if (!Array.isArray(raw)) throw new Error('samples.json is not an array of folder ids');
  const out = [];
  for (const id of raw) {
    if (!isSampleId(id)) warn('Sample registry: ' + JSON.stringify(id) + ' in samples.json is not a valid folder name; skipped');
    else if (out.includes(id)) warn('Sample registry: ' + id + ' is listed twice in samples.json; the second one is skipped');
    else out.push(id);
  }
  return out;
}

// The loading: ids = the listed folder ids (parseSampleList), readJson(id) -> the parsed sample.json, or null/undefined when the listed folder has none. Reads ONLY the listed folders, all at the same time
// (one read per id, nothing else). A read that FAILS throws (the whole registry then stays empty). A listed folder without a sample.json, or a sample.json that is not valid, is skipped with a warning.
// Returns the valid entries in the order of the list.
export async function discoverSamples(ids, readJson, { warn = console.warn } = {}) {
  const raws = await Promise.all(ids.map(id => readJson(id)));
  const out = [];
  ids.forEach((id, i) => {
    if (raws[i] == null) { warn('Sample registry: ' + id + ' is in samples.json but has no sample.json; skipped'); return; }
    const { entry, errors } = parseSample(raws[i], id);
    if (entry) out.push(entry); else warn('Sample registry: ' + id + '/sample.json ignored (' + errors.join(', ') + ')');
  });
  return out;
}

// entries (the order of the list) -> the registry. levels: by level; others: in the order of the list; a duplicate level becomes an 'other'.
export function buildRegistry(entries, { warn = console.warn } = {}) {
  const taken = new Set(), levels = [], others = [];
  for (const e of entries.map((x, order) => ({ ...x, order }))) {
    if (e.level != null && !taken.has(e.level)) { taken.add(e.level); levels.push(Object.freeze({ ...e })); continue; }
    if (e.level != null) warn('Sample registry: ' + e.id + ' claims level ' + e.level + ' that another dataset has; it is listed under 「その他」');
    others.push(Object.freeze({ ...e, level: null, mission: null, hints: Object.freeze([]), initialSegments: Object.freeze([]) }));
  }
  levels.sort((a, b) => a.level - b.level);
  const samples = Object.freeze([...levels, ...others]);
  // the dataset opened when none is chosen: the first one of the list that says "default": true; none says it -> the first one of the list
  const byNumber = [...samples].sort((a, b) => a.order - b.order), flagged = byNumber.filter(s => s.isDefault);
  if (flagged.length > 1) warn('Sample registry: ' + flagged.map(s => s.id).join(', ') + ' all say "default": true; ' + flagged[0].id + ' is used');
  const defaultId = (flagged[0] || byNumber[0])?.id ?? '';
  return Object.freeze({ samples, levels: Object.freeze(levels), others: Object.freeze(others), byId: Object.freeze(Object.fromEntries(samples.map(s => [s.id, s]))), defaultId });
}

// the real size of a dataset as the loading text shows it: '512×512×512、約270MB' / '512×512×512, about 270 MB'; '' when sample.json has no size
export function sizeLabel(size, lang) {
  if (!size) return '';
  const dims = size.dims.join('×');
  return lang === 'en' ? dims + ', ' + mbLabel(size, 'en') : dims + '、' + mbLabel(size, 'ja');
}
// the loading text of a dataset (i18n key smp.<id>.loading): the wording of sampleLoadingSized with its real size, or sampleLoading (no numbers) when sample.json has no size
export const loadingText = (s, lang, i18n = I18N) => {
  const t = i18n[lang] || {}, label = sizeLabel(s.size, lang);
  return label ? String(t.sampleLoadingSized || '').replace('{size}', label) : String(t.sampleLoading || '');
};
// the loading text shown while a dataset is fetched, in the current language: its own smp.<id>.loading, the plain sampleLoading for an id the registry does not know
export const sampleLoadingTextFor = (id, tr, reg = registry) => { const k = sampleKey(id, 'loading'), t = tr(k); return Object.hasOwn(reg.byId, id) && t !== k ? t : tr('sampleLoading'); };
// the registry's default dataset id (the page's default when no dataset is chosen; '' while the registry is empty)
export const defaultSampleId = (reg = registry) => reg.defaultId || '';
// the start magnification of the VR / AR view for a dataset (sample.json vrInitialScale); 1 when it has none
export const vrInitialScaleOf = (id, reg = registry) => { const s = typeof id === 'string' && Object.hasOwn(reg.byId, id) ? reg.byId[id] : null; return s?.vrInitialScale ?? 1; };

// The texts of the registry as i18n keys (the same lookup as every other text: data-i18n, tr(), the VR boards). Idempotent.
export function registerSampleTexts(registry, i18n = I18N) {
  for (const s of registry.samples) {
    for (const lang of ['ja', 'en']) {
      const t = i18n[lang]; if (!t) continue;
      t[sampleKey(s.id, 'name')] = s.name[lang]; t[sampleKey(s.id, 'desc')] = s.description[lang]; t[sampleKey(s.id, 'loading')] = loadingText(s, lang, i18n);
      if (s.mission) t[sampleKey(s.id, 'mission')] = s.mission[lang];
      if (s.credit) { t[sampleKey(s.id, 'changes')] = s.credit.changes[lang]; if (s.credit.terms) t[sampleKey(s.id, 'terms')] = s.credit.terms[lang]; if (s.credit.note) t[sampleKey(s.id, 'note')] = s.credit.note[lang]; }
    }
  }
  // the tutorial's first line names the Lv0 dataset by its sample.json name (the wording keys: tutIntroLv0Named / tutIntroLv0OffNamed; the plain keys stay as the fallback without a Lv0)
  const lv0 = registry.levels.find(l => l.level === 0);
  for (const lang of ['ja', 'en']) {
    const t = i18n[lang]; if (!t || !lv0) continue;
    if (t.tutIntroLv0Named) t.tutIntroLv0 = t.tutIntroLv0Named.replace('{name}', lv0.name[lang]);
    if (t.tutIntroLv0OffNamed) t.tutIntroLv0Off = t.tutIntroLv0OffNamed.replace('{name}', lv0.name[lang]);
  }
}

export const EMPTY_REGISTRY = buildRegistry([]);
export let registry = EMPTY_REGISTRY;
export function setRegistry(entries, opts) { registry = buildRegistry(entries, opts); registerSampleTexts(registry); setKnownSampleIds(registry.samples.map(s => s.id)); return registry; }

// the credit of a dataset that has one (null for a dataset without one); the texts are i18n keys of registerSampleTexts
export function sampleCredit(id, reg = registry) {
  const c = typeof id === 'string' ? reg.byId[id]?.credit : null;
  return c ? { name: c.name, url: c.url, dataUrl: c.dataUrl, licenseName: c.licenseName, licenseUrl: c.licenseUrl, changesKey: sampleKey(id, 'changes'), termsKey: c.terms ? sampleKey(id, 'terms') : null, noteKey: c.note ? sampleKey(id, 'note') : null } : null;
}

// the name of a practice dataset in a language ('' when `id` is not a registered dataset): the series name of a practice dataset whose DICOM has no series description
export function practiceSeriesName(id, lang, reg = registry) {
  const s = typeof id === 'string' && Object.hasOwn(reg.byId, id) ? reg.byId[id] : null;
  return s ? s.name[lang === 'en' ? 'en' : 'ja'] : '';
}

// ---- the page's own loader: the list docs/demo/samples.json (ONE read), then sample.json of every listed folder (one read each), read next to the page like the data itself (sample-sets.js)
async function fetchSampleList() {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(sampleListUrl(), { cache: 'no-cache', signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for samples.json'); // no list = no datasets (the registry stays empty); there is no search for folders
    return await res.json();
  } finally { clearTimeout(timer); }
}
async function fetchSampleJson(id) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(sampleJsonUrl(id), { cache: 'no-cache', signal: ctl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + id + '/sample.json');
    try { return await res.json(); } catch { return null; } // a server that answers a missing file with a page (200): no such file
  } finally { clearTimeout(timer); }
}
export async function loadRegistry() {
  try { setRegistry(await discoverSamples(parseSampleList(await fetchSampleList()), fetchSampleJson)); } catch (e) { console.warn('Sample registry: the practice data list could not be read; no practice data cards are shown', e); registry = EMPTY_REGISTRY; setKnownSampleIds([]); }
  return registry;
}
// Waits for the list before this module finishes loading (browser only: Node tools and tests fill the registry with setRegistry).
if (typeof document !== 'undefined' && typeof fetch === 'function' && globalThis.location?.href) await loadRegistry();
