import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseSample, discoverSamples, buildRegistry, registerSampleTexts, sampleCredit, sampleKey, sampleNumber, practiceSeriesName, registry, HINT_NAMES, SAMPLE_JSON_MAX } from '../../docs/sample-registry.js';
import { EVENT_LEVELS, EVENT_OTHER_SAMPLES, EVENT_DATASETS, EVENT_INITIAL_SEGMENTS } from '../../docs/event-mode.js';
import { readSampleEntries } from '../../tools/lib/sample-folders.mjs';

const DEMO = fileURLToPath(new URL('../../docs/demo/', import.meta.url));
// folders whose thumb.webp is still to be made on the PC (tools/make-event-thumbs.mjs --only sampleN); remove the name when the picture is added
const THUMB_PENDING = [];
const folders = readdirSync(DEMO).filter(n => /^sample\d+$/.test(n)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
const raws = Object.fromEntries(folders.map(f => [f, JSON.parse(readFileSync(join(DEMO, f, 'sample.json'), 'utf8'))]));
const bi = (ja, en) => ({ ja, en });
const lvl = (over = {}) => ({ name: bi('名', 'n'), level: 1, description: bi('説明', 'd'), mission: bi('み', 'm'), hints: ['section'], initialSegments: ['bone'], ...over });
const other = (over = {}) => ({ name: bi('名', 'n'), level: null, description: bi('説明', 'd'), ...over });
const credit = () => ({
  credit: { name: 'A / B', url: 'https://example.org/a', dataUrl: 'https://example.org/d' }, license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  changes: bi('かえた', 'changed'), terms: bi('ルール', 'rules'),
});

describe('every docs/demo/sampleN/sample.json', () => {
  it('there are sample folders, numbered 1..N without a gap (the app stops at the first missing one)', () => {
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.map(f => Number(f.slice(6)))).toEqual(folders.map((_, i) => i + 1));
    expect(folders.length).toBeLessThanOrEqual(SAMPLE_JSON_MAX);
  });
  it.each(folders)('%s: valid (required fields), has thumb.webp, index.json and project.vrlab', f => {
    const { entry, errors } = parseSample(raws[f], f);
    expect(errors, f).toEqual([]);
    expect(entry.id).toBe(f);
    if (!THUMB_PENDING.includes(f)) expect(existsSync(join(DEMO, f, 'thumb.webp')), 'thumb.webp').toBe(true);
    expect(existsSync(join(DEMO, f, 'index.json')), 'index.json').toBe(true);
  });
  it.each(folders)('%s: levels carry mission / hints / initialSegments; credit and license are complete when present', f => {
    const r = raws[f];
    expect(typeof r.name.ja + typeof r.name.en + typeof r.description.ja + typeof r.description.en).toBe('stringstringstringstring');
    if (r.level !== null) {
      expect([0, 1, 2, 3]).toContain(r.level);
      expect(r.mission.ja && r.mission.en).toBeTruthy();
      expect(r.hints.every(h => HINT_NAMES.includes(h))).toBe(true);
      expect(r.initialSegments.length).toBeGreaterThan(0);
    }
    if (r.credit || r.license || r.changes || r.terms) {
      for (const u of [r.credit?.url, r.credit?.dataUrl, r.license?.url]) expect(u).toMatch(/^https?:\/\//);
      for (const t of [r.credit?.name, r.license?.name, r.changes?.ja, r.changes?.en]) expect(typeof t === 'string' && t.trim() !== '').toBe(true);
      if (r.terms !== undefined) for (const t of [r.terms.ja, r.terms.en]) expect(typeof t === 'string' && t.trim() !== '').toBe(true); // terms are optional (CC0)
    }
  });
  it('a pending thumbnail is listed only while the picture is missing', () => {
    for (const f of THUMB_PENDING) expect(existsSync(join(DEMO, f, 'thumb.webp')), f + ' has its thumb.webp now: remove it from THUMB_PENDING').toBe(false);
  });
  it('levels are unique across the folders', () => {
    const levels = folders.map(f => raws[f].level).filter(l => l !== null);
    expect(new Set(levels).size).toBe(levels.length);
  });
  it('the folders read from the file system give exactly the registry the tests run with', async () => {
    expect((await readSampleEntries(DEMO)).map(e => e.id)).toEqual(folders);
    expect(registry.samples.map(s => s.id).sort()).toEqual([...folders].sort());
  });
});

describe('the bundled data: today\'s order and content did not change', () => {
  it('Lv0 sample4, Lv1 sample3, Lv2 sample2, Lv3 sample1, then 「その他」 sample5, sample6', () => {
    expect(EVENT_LEVELS.map(l => [l.id, l.sample])).toEqual([['lv0', 'sample4'], ['lv1', 'sample3'], ['lv2', 'sample2'], ['lv3', 'sample1']]);
    expect(EVENT_OTHER_SAMPLES.map(o => o.sample)).toEqual(['sample5', 'sample6']);
    expect(EVENT_DATASETS.map(d => d.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5', 'sample6']);
  });
  it('hints and initial segments are the old tables', () => {
    expect(EVENT_LEVELS.map(l => l.hints)).toEqual([['section', 'move'], ['section', 'move', 'toggle'], ['section', 'move', 'toggle'], ['section', 'move', 'mark', 'distance']]);
    expect(EVENT_INITIAL_SEGMENTS).toEqual({ sample4: ['bone'], sample3: ['bone'], sample2: ['bone', 'soft'], sample1: ['bone', 'soft'] });
  });
  it('the chooser texts and the card names (the size part comes from sample.json size: 269 MB -> 約270MB, was a hand-typed 約260MB)', () => {
    const d = k => registry.byId[k].description;
    expect([d('sample2').ja, d('sample1').ja, d('sample3').ja, d('sample4').ja, d('sample5').ja]).toEqual(['マウス腹部（約270MB）', 'ラット腹部（約270MB）', 'マウス頭部（約270MB）', '骨梁（約270MB）', 'マーモセット脳 MRI（50 µm）']);
    expect([d('sample2').en, d('sample1').en, d('sample3').en, d('sample4').en, d('sample5').en]).toEqual(['Mouse abdomen (about 270 MB)', 'Rat abdomen (about 270 MB)', 'Mouse head (about 270 MB)', 'Trabecular bone (about 270 MB)', 'Marmoset brain MRI (50 µm)']);
    expect(registry.levels.map(l => l.name.ja)).toEqual(['骨梁', 'マウス頭部', 'マウス腹部', 'ラット腹部']);
    expect(registry.levels.map(l => l.name.en)).toEqual(['Trabecular bone', 'Mouse head', 'Mouse abdomen', 'Rat abdomen']);
  });
  it('the registry adds its texts as i18n keys (both languages)', async () => {
    const { I18N } = await import('../../docs/i18n.js');
    for (const lang of ['ja', 'en']) for (const s of registry.samples) {
      expect(typeof I18N[lang][sampleKey(s.id, 'name')]).toBe('string'); expect(typeof I18N[lang][sampleKey(s.id, 'desc')]).toBe('string');
      if (s.level != null) expect(typeof I18N[lang][sampleKey(s.id, 'mission')]).toBe('string');
    }
  });
});

describe('the optional note (sample6: the unit of the lengths)', () => {
  it('sample6 carries the scale note in both languages, shown with its credit (the card 「詳細」 and the data-panel box both use creditRows)', () => {
    expect(registry.byId.sample6.credit.note).toEqual({ ja: '注意：表示される長さの単位 mm は実際には nm です（1 mm = 1 nm。体積の mm³ は nm³）。', en: 'Note: lengths shown in mm are actually nm (1 mm = 1 nm; mm³ = nm³).' });
    expect(sampleCredit('sample6').noteKey).toBe('smp.sample6.note');
    for (const id of ['sample1', 'sample2', 'sample3', 'sample4', 'sample5']) expect(raws[id].note, id).toBeUndefined();
    expect(sampleCredit('sample5').noteKey).toBeNull();
    const ui = readFileSync(new URL('../../docs/sample-credit-ui.js', import.meta.url), 'utf8');
    expect(ui).toContain("if(c.noteKey)rows.push(el('div','',c.noteKey))");
  });
  it('a note must be complete and needs a credit to be shown with', () => {
    expect(parseSample(other({ ...credit(), note: bi('注意', 'Note') }), 'sample7').errors).toEqual([]);
    expect(parseSample(other({ ...credit(), note: { ja: 'x' } }), 'sample7').entry).toBeNull();
    expect(parseSample(other({ note: bi('注意', 'Note') }), 'sample7').entry).toBeNull();
    const r = buildRegistry([parseSample(other({ ...credit(), note: bi('注意', 'Note') }), 'sample7').entry]), t = { ja: {}, en: {} };
    registerSampleTexts(r, t);
    expect(t.ja['smp.sample7.note']).toBe('注意'); expect(t.en['smp.sample7.note']).toBe('Note');
  });
});

describe('the series name of a practice dataset (the DICOM has no series description any more)', () => {
  it('is the sample.json name in the language; nothing for any other id (the visitor\'s own DICOM)', () => {
    expect(practiceSeriesName('sample4', 'ja')).toBe('骨梁');
    expect(practiceSeriesName('sample4', 'en')).toBe('Trabecular bone');
    expect(practiceSeriesName('sample6', 'ja')).toBe('ジカウイルス EMD-8116');
    for (const id of [null, undefined, '', 'mine', 'sample99', 'constructor', 5]) expect(practiceSeriesName(id, 'ja')).toBe('');
  });
  it('wiring: only a series named "Unnamed series" of a practice dataset is renamed; the file name keeps letters only for such a name', () => {
    const app = readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8');
    expect(app).toContain('practiceSeriesName(openSample.id,currentLanguage)');
    expect(app).toContain('if(s.description===UNNAMED_SERIES){s.description=pn;s.nameFromRegistry=true}');
    expect(readFileSync(new URL('../../docs/dicom.js', import.meta.url), 'utf8')).toContain("export const UNNAMED_SERIES='Unnamed series'");
  });
});

describe('parseSample', () => {
  it('accepts a level dataset and one without a level', () => {
    expect(parseSample(lvl(), 'sample7').errors).toEqual([]);
    expect(parseSample(other(), 'sample7').errors).toEqual([]);
    expect(parseSample(other(credit()), 'sample7').entry.credit.licenseName).toBe('CC BY 4.0');
    const noTerms = credit(); delete noTerms.terms; // CC0: no terms
    expect(parseSample(other(noTerms), 'sample7').errors).toEqual([]);
    expect(parseSample(other(noTerms), 'sample7').entry.credit.terms).toBeNull();
    const r = buildRegistry([parseSample(other(noTerms), 'sample7').entry]);
    expect(sampleCredit('sample7', r).termsKey).toBeNull();
  });
  it.each([
    ['no name', lvl({ name: undefined })], ['name without en', lvl({ name: { ja: 'x' } })], ['empty description text', lvl({ description: bi('', 'd') })],
    ['level 4', lvl({ level: 4 })], ['level 1.5', lvl({ level: 1.5 })], ['level missing', (() => { const r = lvl(); delete r.level; return r; })()],
    ['level without mission', lvl({ mission: undefined })], ['unknown hint', lvl({ hints: ['fly'] })], ['level without initialSegments', lvl({ initialSegments: [] })],
    ['credit without license', other({ ...credit(), license: undefined })], ['credit without dataUrl', other({ ...credit(), credit: { name: 'x', url: 'https://example.org' } })],
    ['credit with a javascript: url', other({ ...credit(), credit: { name: 'x', url: 'javascript:alert(1)', dataUrl: 'https://example.org' } })],
    ['license only', other({ license: credit().license })], ['changes without en', other({ ...credit(), changes: { ja: 'x' } })], ['terms given but without en', other({ ...credit(), terms: { ja: 'x' } })],
  ])('rejects: %s', (_n, raw) => {
    const r = parseSample(raw, 'sample7');
    expect(r.entry).toBeNull(); expect(r.errors.length).toBeGreaterThan(0);
  });
  it('rejects non-objects and bad folder ids', () => {
    for (const raw of [null, 5, 'x', [], undefined]) expect(parseSample(raw, 'sample7').entry).toBeNull();
    for (const id of ['sample0', 'sample', 'Sample1', '../sample1', 'sample01']) expect(parseSample(lvl(), id).entry).toBeNull();
    expect(sampleNumber('sample12')).toBe(12); expect(sampleNumber('nope')).toBeNull();
  });
});

describe('discoverSamples: sample1, sample2, ... stops at the first folder without a sample.json', () => {
  const store = { sample1: lvl({ level: 2 }), sample2: other(), sample3: lvl({ level: 0 }), sample5: other() }; // sample4 is missing: sample5 is never read
  it('reads in order and stops at the first missing one', async () => {
    const read = vi.fn(async id => store[id] ?? null);
    const out = await discoverSamples(read);
    expect(out.map(e => e.id)).toEqual(['sample1', 'sample2', 'sample3']);
    expect(read.mock.calls.map(c => c[0])).toEqual(['sample1', 'sample2', 'sample3', 'sample4']);
  });
  it('is capped (32 by default)', async () => {
    const read = vi.fn(async () => other());
    expect((await discoverSamples(read)).length).toBe(32);
    expect(read).toHaveBeenCalledTimes(32);
    expect((await discoverSamples(async () => other(), { cap: 3 })).length).toBe(3);
  });
  it('an invalid file is skipped with a warning (the discovery goes on); a failing read rejects (the whole list stays empty)', async () => {
    const warn = vi.fn();
    const out = await discoverSamples(async id => ({ sample1: lvl(), sample2: { nope: 1 }, sample3: other() })[id] ?? null, { warn });
    expect(out.map(e => e.id)).toEqual(['sample1', 'sample3']);
    expect(warn).toHaveBeenCalledTimes(1); expect(warn.mock.calls[0][0]).toContain('sample2');
    await expect(discoverSamples(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });
});

describe('buildRegistry', () => {
  const E = (id, raw) => parseSample(raw, id).entry;
  it('orders Lv0..Lv3 by the level field, then the others by folder number', () => {
    const r = buildRegistry([E('sample1', lvl({ level: 3 })), E('sample2', other()), E('sample3', lvl({ level: 0 })), E('sample4', lvl({ level: 2 })), E('sample5', lvl({ level: 1 })), E('sample6', other())]);
    expect(r.samples.map(s => s.id)).toEqual(['sample3', 'sample5', 'sample4', 'sample1', 'sample2', 'sample6']);
    expect(r.levels.map(s => s.level)).toEqual([0, 1, 2, 3]);
    expect(r.others.map(s => s.id)).toEqual(['sample2', 'sample6']);
    expect(r.byId.sample5.id).toBe('sample5');
    expect(Object.isFrozen(r.samples)).toBe(true);
  });
  it('a duplicate level becomes 「その他」 with a console warning; the lower folder number keeps the level', () => {
    const warn = vi.fn();
    const r = buildRegistry([E('sample1', lvl({ level: 1 })), E('sample2', lvl({ level: 1 })), E('sample3', other())], { warn });
    expect(r.levels.map(s => s.id)).toEqual(['sample1']);
    expect(r.others.map(s => s.id)).toEqual(['sample2', 'sample3']);
    expect(r.byId.sample2.level).toBeNull(); expect(r.byId.sample2.mission).toBeNull(); expect(r.byId.sample2.hints).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1); expect(warn.mock.calls[0][0]).toContain('sample2');
  });
  it('an empty list gives an empty registry (no cards, no chooser buttons)', () => {
    const r = buildRegistry([]);
    expect(r.samples).toEqual([]); expect(r.levels).toEqual([]); expect(r.others).toEqual([]);
  });
  it('registerSampleTexts adds name / desc / mission, and changes / terms for a credit, in ja and en (and is idempotent)', () => {
    const r = buildRegistry([E('sample1', lvl()), E('sample2', other(credit()))]), t = { ja: {}, en: {} };
    registerSampleTexts(r, t); registerSampleTexts(r, t);
    expect(t.ja['smp.sample1.name']).toBe('名'); expect(t.en['smp.sample1.mission']).toBe('m');
    expect(t.ja['smp.sample2.terms']).toBe('ルール'); expect(t.en['smp.sample2.changes']).toBe('changed');
    expect(t.ja['smp.sample2.mission']).toBeUndefined();
    expect(sampleCredit('sample2', r)).toMatchObject({ name: 'A / B', licenseName: 'CC BY 4.0', changesKey: 'smp.sample2.changes', termsKey: 'smp.sample2.terms' });
    expect(sampleCredit('sample1', r)).toBeNull();
  });
});

describe('static wiring', () => {
  const SRC = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('docs/sample-credits.js is gone; the credit box, the cards, the chooser and the data panel read the registry', () => {
    expect(existsSync(new URL('../../docs/sample-credits.js', import.meta.url))).toBe(false);
    for (const f of ['sample-credit-ui.js', 'event-launcher-core.js']) expect(SRC(f)).toContain("from './sample-registry.js?v=");
    expect(SRC('ui-shell.js')).toContain("from './sample-registry.js?v=");
    expect(SRC('event-mode.js')).toContain("from './sample-registry.js?v=");
    expect(SRC('tutorial-data.js')).toContain("from './sample-registry.js?v=");
  });
  it('the registry waits for the list at load time (top-level await) in the browser only, and never uses import()', () => {
    const src = SRC('sample-registry.js');
    expect(src).toMatch(/^if \(typeof document !== 'undefined' && typeof fetch === 'function' && globalThis\.location\?\.href\) await loadRegistry\(\);$/m);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).toContain("fetch(sampleJsonUrl(id), { cache: 'no-cache', signal: ctl.signal })");
  });
  it('no table of datasets is left in the code (the ids sample1..sample5 appear only as examples / comments)', () => {
    for (const f of ['event-mode.js', 'tutorial-data.js']) expect(SRC(f).replace(/\/\/.*$/gm, '')).not.toMatch(/['"]sample[1-9]['"]/);
  });
});
