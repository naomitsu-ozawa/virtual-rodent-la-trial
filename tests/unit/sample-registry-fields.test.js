import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mbLabel, parseSample, buildRegistry, registerSampleTexts, sizeLabel, loadingText, sampleLoadingTextFor, defaultSampleId, vrInitialScaleOf, sampleKey, registry } from '../../docs/sample-registry.js';
import { I18N } from '../../docs/i18n.js';
import { publicIds } from '../helpers/demo-lists.js';

// the optional sample.json fields that replaced the sample-specific hard-codes: size (loading text), vrInitialScale (VR start), default (the page's default dataset)
const SRC = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const bi = (ja, en) => ({ ja, en });
const other = (over = {}) => ({ name: bi('名', 'n'), level: null, description: bi('説明', 'd'), ...over });
const lvl = (level, over = {}) => ({ name: bi('レベル' + level, 'Level ' + level), level, description: bi('説明', 'd'), mission: bi('み', 'm'), hints: ['section'], initialSegments: ['bone'], ...over });
const entry = (raw, id) => parseSample(raw, id).entry;

describe('sample.json size', () => {
  it('is optional; when given it needs dims [columns, rows, slices] (whole numbers > 0) and megabytes > 0', () => {
    expect(parseSample(other(), 'sample1').errors).toEqual([]);
    expect(entry(other(), 'sample1').size).toBeNull();
    const ok = entry(other({ size: { dims: [560, 768, 480], megabytes: 413.4 } }), 'sample1');
    expect(ok.size).toEqual({ dims: [560, 768, 480], megabytes: 413.4 });
    for (const bad of [{ dims: [1, 2], megabytes: 5 }, { dims: [0, 2, 3], megabytes: 5 }, { dims: [1.5, 2, 3], megabytes: 5 }, { dims: [1, 2, 3] }, { dims: [1, 2, 3], megabytes: -1 }, { megabytes: 5 }, 'big', null, []]) {
      expect(parseSample(other({ size: bad }), 'sample1').entry, JSON.stringify(bad)).toBeNull();
    }
  });
  it('sizeLabel: the real size in the language, rounded to 10 MB from 100 MB up; empty without a size', () => {
    expect(sizeLabel({ dims: [512, 512, 512], megabytes: 269.2 }, 'ja')).toBe('512×512×512、約270MB');
    expect(sizeLabel({ dims: [512, 512, 512], megabytes: 269.2 }, 'en')).toBe('512×512×512, about 270 MB');
    expect(sizeLabel({ dims: [560, 768, 480], megabytes: 413.4 }, 'ja')).toBe('560×768×480、約410MB');
    expect(sizeLabel({ dims: [64, 64, 64], megabytes: 12.4 }, 'en')).toBe('64×64×64, about 12 MB');
    expect(sizeLabel(null, 'ja')).toBe('');
  });
  it('the description\'s {mb} and the loading text come from the same size field with the same formatting, so they cannot disagree', () => {
    const size = { dims: [512, 512, 512], megabytes: 269.4 };
    const e = entry(other({ description: bi('ラット（{mb}）', 'Rat ({mb})'), size }), 'sample1');
    expect(e.description).toEqual({ ja: 'ラット（約270MB）', en: 'Rat (about 270 MB)' });
    expect(mbLabel(size, 'ja')).toBe('約270MB'); expect(sizeLabel(size, 'ja')).toContain(mbLabel(size, 'ja')); expect(sizeLabel(size, 'en')).toContain(mbLabel(size, 'en'));
    expect(parseSample(other({ description: bi('ラット（{mb}）', 'Rat ({mb})') }), 'sample1').entry).toBeNull(); // {mb} without a size is refused
    for (const s of registry.samples) { expect(s.description.ja + s.description.en, s.id).not.toContain('{mb}'); if (/MB/.test(s.description.ja)) expect(I18N.ja[sampleKey(s.id, 'loading')], s.id).toContain(mbLabel(s.size, 'ja')); }
    for (const id of ['sample1', 'sample2', 'sample3', 'sample4']) expect(JSON.parse(readFileSync(new URL(`../../docs/demo/${id}/sample.json`, import.meta.url), 'utf8')).description.ja, id).toContain('{mb}'); // no hand-typed number left
  });
  it('loading text: each dataset shows its own size; without a size the text has no numbers; unknown ids fall back to the plain text', () => {
    const reg = buildRegistry([entry(other({ size: { dims: [10, 20, 30], megabytes: 55 } }), 'sample1'), entry(other(), 'sample2')]);
    const i18n = { ja: { ...I18N.ja }, en: { ...I18N.en } };
    registerSampleTexts(reg, i18n);
    expect(i18n.ja[sampleKey('sample1', 'loading')]).toBe('練習データ（10×20×30、約55MB）を取得中…');
    expect(i18n.en[sampleKey('sample1', 'loading')]).toBe('Loading practice data (10×20×30, about 55 MB)…');
    expect(i18n.ja[sampleKey('sample2', 'loading')]).toBe('練習データを取得中…');
    expect(i18n.en[sampleKey('sample2', 'loading')]).toBe('Loading practice data…');
    expect(loadingText(reg.byId.sample1, 'ja', i18n)).toContain('10×20×30');
    const tr = k => i18n.ja[k] ?? k;
    expect(sampleLoadingTextFor('sample1', tr, reg)).toBe('練習データ（10×20×30、約55MB）を取得中…');
    expect(sampleLoadingTextFor('nope', tr, reg)).toBe('練習データを取得中…');
  });
  it('the bundled datasets: every public one has a size that matches its files, and the texts show the real numbers', () => {
    for (const s of registry.samples.filter(x => publicIds.includes(x.id))) { // a dataset that is not public may still lack its size (then the loading text has no numbers)
      expect(s.size, s.id).not.toBeNull();
      const { files } = JSON.parse(readFileSync(new URL(`../../docs/demo/${s.id}/index.json`, import.meta.url), 'utf8'));
      expect(s.size.dims[2], s.id).toBe(files.length);
      expect(I18N.ja[sampleKey(s.id, 'loading')], s.id).toContain(s.size.dims.join('×'));
    }
    expect(I18N.ja[sampleKey('sample5', 'loading')]).toContain('560×768×480');
    expect(I18N.ja[sampleKey('sample4', 'loading')]).toContain('512×512×512');
  });
  it('the old hard-coded wording is gone from i18n.js and app.js', () => {
    expect(SRC('i18n.js')).not.toMatch(/sampleLoading5|512×512×512、約260MB|about 260 MB/);
    expect(SRC('app.js')).not.toContain('sampleLoading5');
  });
});

describe('sample.json vrInitialScale', () => {
  it('is optional; a number within the range; anything else is refused', () => {
    expect(entry(other(), 'sample1').vrInitialScale).toBeNull();
    expect(entry(other({ vrInitialScale: 4 }), 'sample1').vrInitialScale).toBe(4);
    expect(entry(other({ vrInitialScale: 0.5 }), 'sample1').vrInitialScale).toBe(0.5);
    for (const bad of [0, -1, 100, '4', NaN, null, [4]]) expect(parseSample(other({ vrInitialScale: bad }), 'sample1').entry, String(bad)).toBeNull();
  });
  it('vrInitialScaleOf: the dataset\'s own value, 1 without one; the bundled registry enlarges only the Lv0 bone (sample4: bone trabeculae)', () => {
    const reg = buildRegistry([entry(other({ vrInitialScale: 3 }), 'sample1'), entry(other(), 'sample2')]);
    expect(vrInitialScaleOf('sample1', reg)).toBe(3); expect(vrInitialScaleOf('sample2', reg)).toBe(1); expect(vrInitialScaleOf('sample9', reg)).toBe(1); expect(vrInitialScaleOf(undefined, reg)).toBe(1);
    expect(vrInitialScaleOf('sample4')).toBe(4);
    expect(registry.byId.sample4.level).toBe(0);
    expect(registry.byId.sample4.name.en).toBe('Trabecular bone');
  });
});

describe('sample.json default', () => {
  const warn = vi.fn();
  it('the flagged dataset is the default; without a flag the lowest folder number; two flags: the first, with a warning', () => {
    const a = entry(other(), 'sample1'), b = entry(other({ default: true }), 'sample2'), c = entry(other({ default: true }), 'sample3');
    expect(buildRegistry([a, b], { warn }).defaultId).toBe('sample2');
    expect(buildRegistry([a, entry(other(), 'sample2')], { warn }).defaultId).toBe('sample1');
    expect(warn).not.toHaveBeenCalled();
    expect(buildRegistry([a, b, c], { warn }).defaultId).toBe('sample2'); expect(warn).toHaveBeenCalledTimes(1);
    expect(buildRegistry([], { warn }).defaultId).toBe('');
    expect(defaultSampleId(buildRegistry([], { warn }))).toBe('');
  });
  it('must be a boolean', () => {
    expect(parseSample(other({ default: 'yes' }), 'sample1').entry).toBeNull();
    expect(parseSample(other({ default: false }), 'sample1').errors).toEqual([]);
  });
  it('the user sees the same default as before: sample1 (Lv3, the rat abdomen) is flagged in its sample.json and is the registry default; the loader reads it from the registry', () => {
    expect(JSON.parse(readFileSync(new URL('../../docs/demo/sample1/sample.json', import.meta.url), 'utf8')).default).toBe(true);
    expect(defaultSampleId()).toBe('sample1');
    expect(registry.samples.filter(s => s.isDefault).map(s => s.id)).toEqual(['sample1']);
    expect(SRC('data-load.js')).toContain('loadSampleDemo(setId=defaultSampleId())');
    expect(SRC('sample-sets.js')).not.toContain("DEFAULT_SAMPLE='sample1'");
  });
});

describe('the tutorial text names the Lv0 dataset from sample.json', () => {
  it('tutIntroLv0 / tutIntroLv0Off carry the registry name of the Lv0 entry in each language; without a Lv0 the plain wording stays', () => {
    expect(I18N.ja.tutIntroLv0).toBe('まず、Lv0 の練習データ（骨梁）を表示しましょう');
    expect(I18N.en.tutIntroLv0).toBe('First, open the Lv0 practice data (Trabecular bone)');
    expect(I18N.ja.tutIntroLv0Off).toContain('「練習データ」→「骨梁」');
    const i18n = { ja: { ...I18N.ja }, en: { ...I18N.en } };
    registerSampleTexts(buildRegistry([entry(lvl(0, { name: bi('別のデータ', 'Other data') }), 'sample1')]), i18n);
    expect(i18n.ja.tutIntroLv0).toBe('まず、Lv0 の練習データ（別のデータ）を表示しましょう');
    expect(i18n.en.tutIntroLv0Off).toContain('“Other data”');
    const none = { ja: { ...I18N.ja, tutIntroLv0: 'x' }, en: { ...I18N.en } };
    registerSampleTexts(buildRegistry([entry(lvl(1), 'sample1')]), none);
    expect(none.ja.tutIntroLv0).toBe('x');
    expect(I18N.ja.tutIntroLv0Named).toContain('{name}');
  });
  it('the wording keys in i18n.js name no dataset (the plain fallback keys have no 骨梁 / bone)', () => {
    const src = SRC('i18n.js');
    for (const k of ['tutIntroLv0', 'tutIntroLv0Off']) { const m = new RegExp(k + ":'([^']*)'").exec(src); expect(m[1], k).not.toMatch(/骨梁|trabecular/i); }
    expect(SRC('tutorial-data.js')).toContain("registry.levels.find(l => l.level === 0)"); // the tutorial stays bound to the Lv0 entry
  });
});
