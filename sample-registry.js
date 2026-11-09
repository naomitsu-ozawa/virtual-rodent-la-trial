// The registry of the practice datasets hosted on this site: ONE loader, ONE registry (pure parts unit-tested: tests/unit/sample-registry.test.js).
// Every dataset is a folder docs/demo/sampleN/ with a sample.json (names, level, mission, initial segments, credit / license) and a thumb.webp. The app reads
// demo/sample1/sample.json, demo/sample2/sample.json, ... and stops at the first folder that has none (at most SAMPLE_JSON_MAX). Nothing else lists the datasets:
// the 体験会 cards, the practice-data chooser, the in-VR data list, the preparation list, the tutorial's data and the credit boxes are all built from this registry.
//
// The module waits for the registry before it finishes loading (top-level await at the bottom), so every module that imports it already sees the finished registry.
// If the files cannot be read (offline, server error) the registry stays EMPTY: no cards and no chooser buttons, the rest of the page works as usual.
// Order: the levels Lv0, Lv1, Lv2, Lv3 by the `level` field, then the datasets without a level (「その他」) by folder number. A second dataset that claims a level
// already taken is treated as 「その他」 (console warning).
import { I18N } from './i18n.js?v=20261109-build703';
import { sampleJsonUrl, setKnownSampleIds } from './sample-sets.js?v=20261109-build703';

export const SAMPLE_JSON_MAX = 32;
export const SAMPLE_LEVELS = Object.freeze([0, 1, 2, 3]);
export const HINT_NAMES = Object.freeze(['section', 'move', 'toggle', 'mark', 'distance']); // the keys of event-mode.js EVENT_HINT_KEYS
const FETCH_TIMEOUT_MS = 8000;

const isText = v => typeof v === 'string' && v.trim() !== '';
const isBilingual = v => !!v && typeof v === 'object' && isText(v.ja) && isText(v.en);
const isUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
export const sampleNumber = id => { const m = /^sample([1-9]\d*)$/.exec(typeof id === 'string' ? id : ''); return m ? Number(m[1]) : null; };
export const sampleKey = (id, part) => 'smp.' + id + '.' + part; // the i18n keys the registry adds (name, desc, mission, changes, terms, note)

// Validates the parsed content of one sample.json. Returns { entry, errors }: entry = null when anything required is missing or wrong.
export function parseSample(raw, id) {
  const errors = [], n = sampleNumber(id);
  if (n == null) return { entry: null, errors: ['bad folder id ' + id] };
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
  need(raw.note === undefined || (isBilingual(raw.note) && hasCredit), 'note{ja,en} (optional; shown with the credit, so it needs one)');
  if (errors.length) return { entry: null, errors };
  const entry = {
    id, n, level: isLevel ? raw.level : null,
    name: { ja: raw.name.ja, en: raw.name.en }, description: { ja: raw.description.ja, en: raw.description.en },
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

// The discovery: readJson(id) -> the parsed sample.json, or null/undefined when the folder has none (the end of the list). A read that FAILS throws (the whole
// registry then stays empty). A sample.json that is not valid is skipped with a warning. Returns the valid entries in folder order.
export async function discoverSamples(readJson, { cap = SAMPLE_JSON_MAX, warn = console.warn } = {}) {
  const out = [];
  for (let n = 1; n <= cap; n++) {
    const id = 'sample' + n, raw = await readJson(id);
    if (raw == null) break;
    const { entry, errors } = parseSample(raw, id);
    if (entry) out.push(entry); else warn('Sample registry: ' + id + '/sample.json ignored (' + errors.join(', ') + ')');
  }
  return out;
}

// entries (folder order) -> the registry. levels: by level; others: by folder number; a duplicate level becomes an 'other'.
export function buildRegistry(entries, { warn = console.warn } = {}) {
  const taken = new Set(), levels = [], others = [];
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (e.level != null && !taken.has(e.level)) { taken.add(e.level); levels.push(Object.freeze({ ...e })); continue; }
    if (e.level != null) warn('Sample registry: ' + e.id + ' claims level ' + e.level + ' that another dataset has; it is listed under 「その他」');
    others.push(Object.freeze({ ...e, level: null, mission: null, hints: Object.freeze([]), initialSegments: Object.freeze([]) }));
  }
  levels.sort((a, b) => a.level - b.level);
  const samples = Object.freeze([...levels, ...others]);
  return Object.freeze({ samples, levels: Object.freeze(levels), others: Object.freeze(others), byId: Object.freeze(Object.fromEntries(samples.map(s => [s.id, s]))) });
}

// The texts of the registry as i18n keys (the same lookup as every other text: data-i18n, tr(), the VR boards). Idempotent.
export function registerSampleTexts(registry, i18n = I18N) {
  for (const s of registry.samples) {
    for (const lang of ['ja', 'en']) {
      const t = i18n[lang]; if (!t) continue;
      t[sampleKey(s.id, 'name')] = s.name[lang]; t[sampleKey(s.id, 'desc')] = s.description[lang];
      if (s.mission) t[sampleKey(s.id, 'mission')] = s.mission[lang];
      if (s.credit) { t[sampleKey(s.id, 'changes')] = s.credit.changes[lang]; if (s.credit.terms) t[sampleKey(s.id, 'terms')] = s.credit.terms[lang]; if (s.credit.note) t[sampleKey(s.id, 'note')] = s.credit.note[lang]; }
    }
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

// ---- the page's own loader: sample.json of every folder, read next to the page like the data itself (sample-sets.js sampleJsonUrl)
async function fetchSampleJson(id) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(sampleJsonUrl(id), { cache: 'no-cache', signal: ctl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + id + '/sample.json');
    try { return await res.json(); } catch { return null; } // a server that answers a missing file with a page (200): the end of the list
  } finally { clearTimeout(timer); }
}
export async function loadRegistry() {
  try { setRegistry(await discoverSamples(fetchSampleJson)); } catch (e) { console.warn('Sample registry: the practice data list could not be read; no practice data cards are shown', e); registry = EMPTY_REGISTRY; setKnownSampleIds([]); }
  return registry;
}
// Waits for the list before this module finishes loading (browser only: Node tools and tests fill the registry with setRegistry).
if (typeof document !== 'undefined' && typeof fetch === 'function' && globalThis.location?.href) await loadRegistry();
