import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SAMPLE_SETS, sampleIndexUrl, sampleSliceUrl, sampleCacheKey } from '../../docs/sample-sets.js';
import { SAMPLE_CREDITS, sampleCredit } from '../../docs/sample-credits.js';
import { EVENT_LEVELS, EVENT_OTHER_SAMPLES, levelForSample, levelSwitchItems } from '../../docs/event-mode.js';
import { I18N } from '../../docs/i18n.js';

const DIR = new URL('../../docs/demo/sample5/', import.meta.url);
const SRC = u => readFileSync(new URL(u, import.meta.url), 'utf8');

describe('sample5 (marmoset brain MRI, 50 um): registration', () => {
  it('has its own folder and cache key like sample1-4', () => {
    expect(SAMPLE_SETS.sample5).toEqual({ base: 'demo/sample5/', keyPrefix: '/__vrl-sample/v1/sample5/' });
    expect(sampleIndexUrl('sample5')).toBe('demo/sample5/index.json');
    expect(sampleSliceUrl('sample5', '001.dcm')).toBe('demo/sample5/001.dcm');
    expect(sampleCacheKey('https://x.io', 'sample5', '001.dcm')).toBe('https://x.io/__vrl-sample/v1/sample5/001.dcm');
  });
  it('index.json lists every .dcm of the folder, in order', () => {
    const { name, files } = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8'));
    const dcm = readdirSync(DIR).filter(n => n.endsWith('.dcm')).sort();
    expect(name).toBe('Marmoset brain MRI (50 µm)');
    expect(files.length).toBe(480);
    expect(files).toEqual(dcm);
  });
  it('is not a level: Lv0-Lv3 are unchanged; the VR data-switch items include it as a fifth one with its plain name, the level list passed explicitly stays at four', () => {
    expect(levelForSample('sample5')).toBeNull();
    expect(EVENT_LEVELS.map(l => l.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1']);
    expect(levelSwitchItems(k => k, 'sample5', null, EVENT_LEVELS).map(i => i.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1']);
    expect(levelSwitchItems(k => k, 'sample5').map(i => i.sample)).toEqual(['sample4', 'sample3', 'sample2', 'sample1', 'sample5']);
    expect(levelSwitchItems(k => k, 'sample5').map(i => i.label)).toEqual(['Lv0 evLv0Name', 'Lv1 evLv1Name', 'Lv2 evLv2Name', 'Lv3 evLv3Name', 'sampleMarmoset']);
    expect(levelSwitchItems(k => k, 'sample5').map(i => i.on)).toEqual([false, false, false, false, true]);
    expect(EVENT_OTHER_SAMPLES.map(o => o.sample)).toEqual(['sample5']);
    expect(Object.isFrozen(EVENT_OTHER_SAMPLES)).toBe(true);
  });
  it('is in the chooser under the 「その他」 group, after the four levels\' datasets', () => {
    const shell = SRC('../../docs/ui-shell.js');
    const i4 = shell.indexOf('data-sample-set="sample4"'), g = shell.indexOf('data-i18n="sampleGroupOther"'), i5 = shell.indexOf('data-sample-set="sample5"');
    expect(i4).toBeGreaterThan(0); expect(g).toBeGreaterThan(i4); expect(i5).toBeGreaterThan(g);
    expect(I18N.ja.sampleMarmoset).toBe('マーモセット脳 MRI（50 µm）');
    expect(I18N.en.sampleMarmoset).toBe('Marmoset brain MRI (50 µm)');
    expect(I18N.ja.sampleGroupOther).toBe('その他');
    expect(I18N.en.sampleGroupOther).toBe('Other');
  });
});

describe('sample5: loading text', () => {
  it('shows its own size; the other samples keep the generic text', () => {
    expect(I18N.ja.sampleLoading5).toBe('練習データ（560×768×480、約410MB）を取得中…');
    expect(I18N.en.sampleLoading5).toContain('560×768×480');
    expect(I18N.en.sampleLoading5).toContain('410 MB');
    expect(I18N.ja.sampleLoading).toContain('512×512×512');
    expect(SRC('../../docs/app.js')).toContain("tr(setId==='sample5'?'sampleLoading5':'sampleLoading')");
  });
});

describe('sample5: attribution (CC BY-NC-SA 4.0)', () => {
  const c = sampleCredit('sample5');
  it('only sample5 has a credit; unknown ids give none', () => {
    expect(Object.keys(SAMPLE_CREDITS)).toEqual(['sample5']);
    for (const id of ['sample1', 'sample4', 'constructor', '__proto__', null, undefined, 5]) expect(sampleCredit(id)).toBeNull();
  });
  it('links to the data and to the license', () => {
    expect(c.sourceUrl).toBe('https://www.scidb.cn/en/file?fid=6444dd2f292d4e32b96ea092&mode=front');
    expect(c.licenseUrl).toBe('https://creativecommons.org/licenses/by-nc-sa/4.0/');
    expect(c.licenseName).toBe('CC BY-NC-SA 4.0');
  });
  it('every credit text exists in ja and en and names source, changes and the non-commercial / share-alike terms', () => {
    for (const lang of ['ja', 'en']) for (const k of ['creditTitle', 'creditSource', 'creditLicense', 'creditChanges', c.sourceKey, c.changesKey, c.termsKey]) expect(typeof I18N[lang][k], `${lang}.${k}`).toBe('string');
    expect(I18N.ja.creditMarmosetSource).toContain('Cirong Liu');
    expect(I18N.en.creditMarmosetSource).toContain('Marmoset Brain Mapping');
    expect(I18N.ja.creditMarmosetChanges).toBe('元の3D画像ファイルから DICOM に変換、信号値を100万倍に換算、本アプリで3D再構成');
    expect(I18N.en.creditMarmosetChanges).toContain('original 3D image file to DICOM');
    expect(I18N.en.creditMarmosetChanges).toContain('1,000,000');
    expect(I18N.ja.creditMarmosetTerms).toContain('非営利');
    expect(I18N.en.creditMarmosetTerms).toContain('Non-commercial');
    expect(I18N.en.creditMarmosetTerms).toContain('same license');
  });
  it('the credit box is built with real links and is wired into the page', () => {
    const ui = SRC('../../docs/sample-credit-ui.js');
    expect(ui).toContain("a.target='_blank';a.rel='noopener noreferrer'");
    expect(ui).toContain("'vrl-event-sample-open'");
    expect(SRC('../../docs/app.js')).toContain('initSampleCreditUi();');
  });
  it('README.md and LICENSE in the folder carry the same notice', () => {
    for (const f of ['README.md', 'LICENSE']) {
      const t = readFileSync(new URL(f, DIR), 'utf8');
      for (const s of [c.sourceUrl, c.licenseUrl, 'Cirong Liu / Marmoset Brain Mapping', 'CC BY-NC-SA 4.0', 'DICOM', '1,000,000', '100万倍']) expect(t, `${f}: ${s}`).toContain(s);
    }
  });
});
