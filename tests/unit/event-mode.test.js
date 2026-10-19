import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { EVENT_LEVELS, EVENT_HINT_KEYS, levelById, levelForSample, chooseEventLevel, chosenEventLevel, eventModeOn, activeEventLevel, simpleMenuSegments, MAX_SEG_ROWS, triggerModeRow, triggerMode, TRIGGER_AT_START, simpleMenuLayout, SIMPLE_MENU, wrapWords, missionLines } from '../../docs/event-mode.js';
import { I18N } from '../../docs/i18n.js';
import { SAMPLE_SETS } from '../../docs/sample-sets.js';

// build 626: 体験会モード. Levels -> bundled practice datasets (the names must match the practice-data chooser's buttons).
describe('event mode levels', () => {
  it('Lv0..Lv3 map to sample4 / sample3 / sample2 / sample1', () => {
    expect(EVENT_LEVELS.map(l => [l.id, l.lv, l.sample])).toEqual([['lv0', 0, 'sample4'], ['lv1', 1, 'sample3'], ['lv2', 2, 'sample2'], ['lv3', 3, 'sample1']]);
    for (const l of EVENT_LEVELS) expect(SAMPLE_SETS[l.sample]).toBeTruthy();
    expect(levelForSample('sample1').id).toBe('lv3');
    expect(levelForSample('sample9')).toBeNull();
    expect(levelById('lv2').sample).toBe('sample2');
    expect(levelById('nope')).toBeNull();
    expect(Object.isFrozen(EVENT_LEVELS) && Object.isFrozen(EVENT_LEVELS[0])).toBe(true);
  });
  it('level names are the chooser names of the same dataset, in both languages', () => {
    const chooser = { sample1: 'sampleRat', sample2: 'sampleMouse', sample3: 'sampleMouseHead', sample4: 'sampleTrabecular' };
    for (const lang of ['ja', 'en']) for (const l of EVENT_LEVELS) expect(I18N[lang][chooser[l.sample]].startsWith(I18N[lang][l.nameKey])).toBe(true);
    expect(I18N.ja.evLv0Name).toBe('骨梁');
    expect(I18N.ja.evLv3Name).toBe('ラット腹部');
  });
  it('every text key exists in ja and en (missions as given)', () => {
    const keys = ['setEventMode', 'setEventModeNote', 'evTitle', 'evSelected', 'evAfter', 'evMissionCap', ...Object.values(EVENT_HINT_KEYS), ...EVENT_LEVELS.flatMap(l => [l.nameKey, l.missionKey])];
    for (const lang of ['ja', 'en']) for (const k of keys) expect(typeof I18N[lang][k], `${lang}.${k}`).toBe('string');
    expect(I18N.ja.evLv0Mission).toBe('骨の中のスポンジ構造を断面で観察しよう');
    expect(I18N.ja.evLv1Mission).toBe('断面で頭の中を観察しよう → 軟部組織を表示して、肺の構造を確かめよう');
    expect(I18N.ja.evLv2Mission).toBe('断面でおなかの中を観察しよう → 軟部組織を隠して脂肪を表示しよう → メニューで「解析モード」に切り替えよう → 脂肪にレーザーを向けるとラベルが出る（トリガーで固定）');
    // the mission names the menu's mode button by its exact label (Lv2 starts in point mode, so the step is needed)
    for (const lang of ['ja', 'en']) {
      expect(I18N[lang].evLv2Mission).toContain(I18N[lang].evModeAnalysis);
    }
    expect(I18N.ja.evLv3Mission).toBe('断面で腹腔を観察しよう → 腎臓を探して、長さを測ろう');
    for (const l of EVENT_LEVELS) for (const h of l.hints) expect(EVENT_HINT_KEYS[h]).toBeTruthy();
  });
  it('the chosen level only counts while the mode is on', () => {
    const on = { get: k => (k === 'eventMode' ? true : undefined) }, off = { get: () => false };
    expect(chooseEventLevel('lv1')).toBe('lv1');
    expect(chosenEventLevel().sample).toBe('sample3');
    expect(activeEventLevel(on).id).toBe('lv1');
    expect(activeEventLevel(off)).toBeNull();
    expect(activeEventLevel(undefined)).toBeNull();
    expect(eventModeOn({ get: () => { throw new Error('x'); } })).toBe(false);
    expect(eventModeOn({ get: () => 'true' })).toBe(false); // only a real true
    expect(chooseEventLevel('bogus')).toBeNull();
    expect(activeEventLevel(on)).toBeNull();
  });
});

describe('the generic VR かんたん menu: segments and the trigger switch', () => {
  it('levels carry no menu data: the menu is the same for every level (and with none chosen)', () => {
    for (const l of EVENT_LEVELS) { expect(l.segments).toBeUndefined(); expect(l.labels).toBeUndefined(); }
    expect(simpleMenuLayout.length).toBe(1); // simpleMenuLayout(o): no level argument
  });
  it('segment rows = the shown segments of the loaded data, in order, capped', () => {
    expect(simpleMenuSegments(['bone'])).toEqual(['bone']);
    expect(simpleMenuSegments(['bone', 'soft', 'fat', 'lung'])).toEqual(['bone', 'soft', 'fat', 'lung']);
    expect(simpleMenuSegments(['bone', 'contrast'])).toEqual(['bone', 'contrast']);
    expect(simpleMenuSegments(undefined)).toEqual([]);
    expect(simpleMenuSegments(Array.from({ length: 9 }, (_, i) => 's' + i)).length).toBe(MAX_SEG_ROWS);
  });
  it('the trigger switch exists only with analysis results; no results = always point mode', () => {
    expect(triggerModeRow(true)).toBe(true);
    expect(triggerModeRow(false)).toBe(false);
    expect(triggerMode(true, true)).toBe('label');
    expect(triggerMode(false, true)).toBe('point');
    expect(triggerMode(true, false)).toBe('point'); // a stale "label" without results never swallows a press
    expect(triggerMode(false, false)).toBe('point');
  });
  it('every session starts in point mode, for every dataset and level (Lv3 marks need it; the board shows the mode)', () => {
    expect(TRIGGER_AT_START).toBe('point');
  });
});

// the かんたん menu board: simpleMenuLayout is the pure layout vr-view.js draws
const TEXT = lang => {
  const t = I18N[lang], ja = lang === 'ja';
  return { show: t.evShow, hide: t.evHide, section: ja ? '断面' : 'Sections', trigger: t.evMode, trigPoint: t.evModePoint, trigLabel: t.evModeAnalysis, trigHintPoint: t.evModeHintPoint, trigHintLabel: t.evModeHintAnalysis, results: ja ? '解析結果（体積）' : 'Analysis results (volume)', total: ja ? '合計' : 'Total', noSeg: 'none', home: ja ? '正面に戻す' : 'Bring to front', undo: ja ? '元に戻す' : 'Undo', all: t.evAllSettings, exit: t.evExitVr };
};
const SEG_NAMES = { ja: { bone: '骨', soft: '軟部組織', fat: '脂肪', lung: '肺', contrast: '造影剤' }, en: { bone: 'Bone', soft: 'Soft tissue', fat: 'Fat', lung: 'Lung', contrast: 'Contrast' } };
const COLORS = { bone: '#f3f0e8', soft: '#d97f7f', fat: '#e7c85d', lung: '#7fb3d9', contrast: '#9b7fd9' };
// the bundled projects (what the data shows when a level is opened)
const bundled = sample => JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(new URL(`../../docs/demo/${sample}/project.vrlab`, import.meta.url))))['project.json']));
const SEG_ORDER = ['bone', 'soft', 'fat', 'lung', 'contrast'];
const shownOf = p => SEG_ORDER.filter(k => p.segments?.[k]?.active && p.segments?.[k]?.enabled);
// the board for a dataset: its shown segments and analysis results (what vr-view.js feeds in); labelsOn = the trigger switch
function layoutFor(sample, lang = 'ja', over = {}) {
  const p = sample ? bundled(sample) : { segments: {}, analysis: {} }, keys = simpleMenuSegments(shownOf(p));
  const regions = (p.analysis?.regions || []).map((r, i) => ({ hex: '#' + r.color.toString(16).padStart(6, '0'), name: `${i + 1}. ${SEG_NAMES[lang][r.segmentKeys[0]]}`, text: (12.34 * (i + 1)).toFixed(2) + ' mm³' }));
  return simpleMenuLayout({ segments: keys.map(k => ({ key: k, name: SEG_NAMES[lang][k], color: COLORS[k], on: true })), sectionOn: true, trigger: { show: triggerModeRow(regions.length > 0), label: false }, results: regions, total: '99.99 mm³', text: TEXT(lang), ...over });
}
const ids = w => w.map(x => x.id);
const buttons = w => w.filter(x => x.type === 'button');
const SAMPLES = ['sample4', 'sample3', 'sample2', 'sample1'];

describe('the generic かんたん menu board per bundled dataset', () => {
  const rows = w => ids(buttons(w)).filter(i => /:show$|^trigger:point$/.test(i)).map(i => i.replace(/:show$/, ''));
  it('sample4 (Lv0 trabecular): bone, 断面; no trigger switch, no list', () => {
    const w = layoutFor('sample4');
    expect(ids(buttons(w))).toEqual(['seg:bone:show', 'seg:bone:hide', 'section:show', 'section:hide', 'home', 'undo', 'all', 'exit']);
    expect(ids(w)).not.toContain('trigger:name');
    expect(ids(w)).not.toContain('results');
  });
  it('sample3 (Lv1 mouse head): bone, soft tissue, lung, 断面; no trigger switch', () => {
    const w = layoutFor('sample3');
    expect(rows(w)).toEqual(['seg:bone', 'seg:soft', 'seg:lung', 'section']);
    expect(ids(w)).not.toContain('trigger:name');
  });
  it('sample2 (Lv2 mouse abdomen): bone, soft tissue, fat, lung, 断面, the trigger switch, 4 results with the total', () => {
    const w = layoutFor('sample2');
    expect(rows(w)).toEqual(['seg:bone', 'seg:soft', 'seg:fat', 'seg:lung', 'section', 'trigger:point']);
    expect(buttons(w).filter(b => b.id.startsWith('result:')).length).toBe(4);
    expect(w.find(x => x.id === 'results').text).toBe('解析結果（体積）');
    expect(w.find(x => x.id === 'total').text).toBe('合計 99.99 mm³ · 4');
  });
  it('sample1 (Lv3 rat abdomen): bone, soft tissue, fat, 断面, the trigger switch, 2 results', () => {
    const w = layoutFor('sample1');
    expect(rows(w)).toEqual(['seg:bone', 'seg:soft', 'seg:fat', 'section', 'trigger:point']);
    expect(buttons(w).filter(b => b.id.startsWith('result:')).length).toBe(2);
  });
  it('no dataset: the none-shown note, 断面 and the bottom row; the bottom row is the same everywhere', () => {
    expect(ids(layoutFor(null))).toEqual(expect.arrayContaining(['noseg', 'section:show', 'exit']));
    for (const s of [...SAMPLES, null]) expect(ids(buttons(layoutFor(s))).slice(-4)).toEqual(['home', 'undo', 'all', 'exit']);
  });
  it('the exit button is last, red and filled; 元に戻す is always there', () => {
    for (const s of [...SAMPLES, null]) {
      const b = buttons(layoutFor(s)), last = b[b.length - 1];
      expect(last.id).toBe('exit');
      expect(last.on).toBe(true);
      expect(last.color).toBe('#b33');
    }
  });
  it('the exit label says VR or AR, in both languages', () => {
    for (const lang of ['ja', 'en']) for (const [k, re] of [['evExitVr', /VR/], ['evExitAr', /AR/]]) expect(I18N[lang][k]).toMatch(re);
    expect(I18N.ja.evExitVr).toBe('VRを終了');
    expect(I18N.en.evExitAr).toBe('Exit AR');
  });
  it('no advanced settings and no level text on the board', () => {
    for (const s of [...SAMPLES, null]) for (const x of layoutFor(s)) {
      expect(x.id).toMatch(/^(noseg|seg:\w+(:name|:show|:hide|)|section(:name|:show|:hide)|trigger:(name|point|label|hint)|results|result:\d+(:name|:vol)?|total|home|undo|all|exit)$/);
      expect(x.text || x.label || '').not.toMatch(/Lv\s?\d/);
    }
  });
  it('a hidden / shown state is reflected by the on flags', () => {
    const w = simpleMenuLayout({ segments: [{ key: 'bone', name: '骨', color: '#fff', on: false }], sectionOn: false, trigger: { show: false }, results: [], total: '', text: TEXT('ja') });
    const on = id => w.find(x => x.id === id).on;
    expect([on('seg:bone:show'), on('seg:bone:hide'), on('section:show'), on('section:hide')]).toEqual([false, true, false, true]);
  });
  it('no title / level line: the rows start right under the status line', () => {
    for (const s of [...SAMPLES, null]) {
      const w = layoutFor(s);
      expect(w.some(x => x.id === 'title')).toBe(false);
      expect(Math.min(...buttons(w).map(x => x.y))).toBe(s ? SIMPLE_MENU.TOP : SIMPLE_MENU.TOP + SIMPLE_MENU.ROW); // (no segment: the note takes the first row)
    }
    expect(SIMPLE_MENU.TOP - SIMPLE_MENU.STATUS).toBeLessThanOrEqual(60);
    expect(SIMPLE_MENU.STATUS).toBeGreaterThan(90);
  });
});

describe('no 解析結果のラベル 表示/非表示 row or 解析ラベル wording is left in event mode', () => {
  it('menu, help board and missions', () => {
    const texts = JSON.stringify([I18N.ja, I18N.en].map(t => Object.entries(t).filter(([k]) => /^ev/.test(k))));
    expect(texts).not.toMatch(/解析結果のラベル|解析ラベル|Analysis labels|Result labels|evLabels/);
    for (const s of [...SAMPLES, null]) for (const x of layoutFor(s)) expect(x.id).not.toMatch(/^labels/);
  });
});

describe('the mode switch on the board: ポイントモード or 解析モード, never both, always stated', () => {
  const sw = (labelsOn, lang = 'ja') => layoutFor('sample2', lang, { trigger: { show: true, label: labelsOn } });
  it('ポイントモード: lit, 解析モード is not, and the line says the trigger records a point', () => {
    const w = sw(false), g = id => w.find(x => x.id === id);
    expect([g('trigger:point').on, g('trigger:label').on]).toEqual([true, false]);
    expect(g('trigger:point').label).toBe('ポイントモード');
    expect(g('trigger:label').label).toBe('解析モード');
    expect(g('trigger:name').text).toBe('モード');
    expect(g('trigger:hint').text).toBe('トリガーを短く押すと印（ポイント）を記録');
  });
  it('解析モード: lit, ポイントモード is not, and the line says the trigger pins a label', () => {
    const w = sw(true), g = id => w.find(x => x.id === id);
    expect([g('trigger:point').on, g('trigger:label').on]).toEqual([false, true]);
    expect(g('trigger:hint').text).toBe('レーザーで解析結果の名前を表示、トリガーで固定');
  });
  it('en texts', () => {
    expect(sw(false, 'en').find(x => x.id === 'trigger:point').label).toBe('Point mode');
    expect(sw(true, 'en').find(x => x.id === 'trigger:label').label).toBe('Analysis mode');
    expect(sw(false, 'en').find(x => x.id === 'trigger:name').text).toBe('Mode');
    expect(sw(true, 'en').find(x => x.id === 'trigger:hint').text).toMatch(/pins/);
  });
  it('the two buttons share the row, same y, side by side', () => {
    const w = sw(false), a = w.find(x => x.id === 'trigger:point'), b = w.find(x => x.id === 'trigger:label');
    expect(a.y).toBe(b.y);
    expect(a.x + a.w).toBeLessThan(b.x);
  });
});

describe('mission audit: every item a mission needs is on the generic menu', () => {
  // what each mission uses from the board (controller-only actions - grip move, B/Y, stick, trigger, ring 距離 - need nothing here)
  const NEED = {
    lv0: ['seg:bone', 'section'],
    lv1: ['seg:bone', 'seg:soft', 'seg:lung', 'section'],
    lv2: ['seg:bone', 'seg:soft', 'seg:fat', 'section', 'trigger:label', 'result:0'],
    lv3: ['seg:bone', 'seg:soft', 'seg:fat', 'section', 'trigger:point', 'undo'],
  };
  for (const l of EVENT_LEVELS) {
    it(`${l.id} (${l.sample}): the board has every needed row`, () => {
      for (const lang of ['ja', 'en']) {
        const have = new Set(buttons(layoutFor(l.sample, lang)).map(x => x.id.replace(/:(show|hide)$/, '')));
        for (const n of [...NEED[l.id], 'exit']) expect(have.has(n), `${l.id}/${lang} needs ${n}`).toBe(true);
      }
    });
  }
  it('the datasets with analysis results are sample2 and sample1 (the switch shows there only); Lv3 marks, so the start is point mode', () => {
    expect(SAMPLES.filter(s => (bundled(s).analysis?.regions || []).length > 0).sort()).toEqual(['sample1', 'sample2']);
    expect(TRIGGER_AT_START).toBe('point');
  });
});

describe('the かんたん menu board layout fits the canvas', () => {
  const M = SIMPLE_MENU;
  // a stand-in for ctx.measureText: CJK / full-width = 1 em, Latin = 0.6 em (bold 1.08 x)
  const measure = (text, size, bold) => [...String(text)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6) * size * (bold ? 1.08 : 1), 0);
  const rect = x => ({ x: x.x, y: x.y, w: x.w, h: x.h });
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const check = (w, name = '') => {
    const bs = buttons(w);
    for (const b of bs) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(M.W); expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.h).toBeLessThanOrEqual(M.H); }
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(overlap(rect(bs[i]), rect(bs[j])), `${name} ${bs[i].id} / ${bs[j].id}`).toBe(false);
    // button labels may shrink a little on the canvas (maxWidth), but should not need more than 25 %
    for (const b of bs.filter(x => x.label)) expect(measure(b.label, b.size, false), b.id).toBeLessThanOrEqual((b.w - 8) * 1.25);
    // a row name stays left of its buttons (x 440), result names left of their volumes (x 560), everything inside the board
    for (const x of w.filter(x => x.type === 'label')) {
      const wd = measure(x.text, x.size || 30, x.bold);
      if (/^(seg:\w+|section|trigger):name$/.test(x.id)) expect(x.x + wd, x.id).toBeLessThanOrEqual(430);
      else if (/^result:\d+:name$/.test(x.id)) expect(x.x + wd, x.id).toBeLessThanOrEqual(x.x + 440);
      else expect(x.x + wd, `${name} ${x.id}`).toBeLessThanOrEqual(M.W - 20);
      expect(x.y).toBeLessThan(M.H);
    }
    // the trigger line sits under its buttons, above the next row; the list stops above the bottom row
    const bottomY = Math.min(...bs.filter(b => ['home', 'undo', 'all', 'exit'].includes(b.id)).map(b => b.y));
    for (const x of w.filter(x => /^(result|total)/.test(x.id))) expect(x.y + (x.h || 0), `${name} ${x.id}`).toBeLessThan(bottomY);
    const h = w.find(x => x.id === 'trigger:hint'), tb = w.find(x => x.id === 'trigger:point');
    if (h) expect(h.y).toBeGreaterThan(tb.y + tb.h);
  };
  for (const lang of ['ja', 'en']) for (const s of [...SAMPLES, null]) for (const labelsOn of [false, true]) {
    it(`${s ?? 'no dataset'} / ${lang} / ${labelsOn ? 'label' : 'point'} mode: inside the board, buttons do not overlap, texts fit`, () => {
      check(layoutFor(s, lang, { trigger: { show: s === 'sample1' || s === 'sample2', label: labelsOn } }), `${s}/${lang}`);
    });
  }
  it('the most the bundled kinds of data can show (5 segments, the trigger switch, 4 results) fits, with all 4 results listed', () => {
    for (const lang of ['ja', 'en']) {
      const results = Array.from({ length: 4 }, (_, i) => ({ hex: '#fff', name: `${i + 1}. ${SEG_NAMES[lang].fat}`, text: '123.45 mm³' }));
      const w = simpleMenuLayout({ segments: SEG_ORDER.map(k => ({ key: k, name: SEG_NAMES[lang][k], color: COLORS[k], on: true })), sectionOn: true, trigger: { show: true, label: true }, results, total: '99.99 mm³', text: TEXT(lang) });
      check(w, 'max');
      const n = buttons(w).filter(b => b.id.startsWith('result:')).length;
      expect(n, lang).toBeGreaterThan(0);
    }
  });
  it('with more results than fit, the list is cut and the count of the rest is shown', () => {
    const results = Array.from({ length: 12 }, (_, i) => ({ hex: '#fff', name: `${i + 1}. Fat`, text: '1.00 mm³' }));
    const w = simpleMenuLayout({ segments: ['bone', 'soft', 'fat'].map(k => ({ key: k, name: k, color: '#fff', on: true })), sectionOn: true, trigger: { show: true, label: false }, results, total: '12.00 mm³', text: TEXT('en') });
    const n = buttons(w).filter(b => b.id.startsWith('result:')).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(12);
    expect(w.find(x => x.id === 'total').text).toBe(`Total 12.00 mm³ · 12  (… +${12 - n})`);
    check(w, 'cut');
  });
  it('more segments than MAX_SEG_ROWS: the rows are capped, the rest is counted, nothing overlaps the bottom row', () => {
    const segs = Array.from({ length: MAX_SEG_ROWS + 3 }, (_, i) => ({ key: 's' + i, name: 'S' + i, color: '#fff', on: true }));
    const w = simpleMenuLayout({ segments: segs, sectionOn: true, trigger: { show: true, label: false }, results: [], total: '', text: TEXT('en') });
    expect(buttons(w).filter(b => /^seg:s\d+:show$/.test(b.id)).length).toBe(MAX_SEG_ROWS);
    expect(w.find(x => x.id === 'seg:more').text).toBe('… +3');
    check(w, 'segcap');
  });
  it('the exact button labels (ja)', () => {
    expect(buttons(layoutFor('sample2')).filter(b => b.label).map(b => b.label)).toEqual(['表示', '非表示', '表示', '非表示', '表示', '非表示', '表示', '非表示', '表示', '非表示', 'ポイントモード', '解析モード', '正面に戻す', '元に戻す', 'すべての設定', 'VRを終了']);
  });
});

describe('mission wrap for the VR help board', () => {
  it('every mission (both languages) fits the help board mission block (5 lines at 24 px, 748 px wide)', () => {
    const measure = z => [...z].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6) * 24, 0);
    for (const lang of ['ja', 'en']) for (const l of EVENT_LEVELS) expect(missionLines(I18N[lang][l.missionKey], 820 - 72, measure).length, `${lang} ${l.id}`).toBeLessThanOrEqual(5);
  });
  const w = s => s.length * 10;
  it('keeps Latin words whole and breaks CJK anywhere', () => {
    expect(wrapWords('find a kidney and measure its length', 140, w)).toEqual(['find a kidney', 'and measure', 'its length']);
    expect(wrapWords('断面で腹腔を観察しよう', 50, w)).toEqual(['断面で腹腔', 'を観察しよ', 'う']);
    expect(wrapWords('', 50, w)).toEqual([]);
  });
  it('each step starts a line, later steps keep the arrow', () => {
    expect(missionLines('A b → C d', 1000, w)).toEqual(['A b', '→ C d']);
    expect(missionLines(I18N.ja.evLv0Mission, 1000, w)).toEqual([I18N.ja.evLv0Mission]);
  });
});

// the switch is stored with the other device settings (app-settings.js, localStorage key vrl.settings.v1)
async function loadSettings(storage) {
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  return import('../../docs/app-settings.js');
}
afterEach(() => vi.unstubAllGlobals());

describe('event mode setting persistence', () => {
  it('defaults to off and is read back after a reload', async () => {
    const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const mod = await loadSettings(storage);
    expect(mod.SETTINGS_DEFAULTS.eventMode).toBe(false);
    expect(mod.settings.get('eventMode')).toBe(false);
    expect(eventModeOn(mod.settings)).toBe(false);
    mod.settings.set('eventMode', true);
    expect(JSON.parse(store.get('vrl.settings.v1')).eventMode).toBe(true);
    const again = await loadSettings(storage);
    expect(again.settings.get('eventMode')).toBe(true);
    expect(eventModeOn(again.settings)).toBe(true);
  });
  it('a throwing storage reads as off and setting it does not throw (kept for the page)', async () => {
    const boom = () => { throw new Error('SecurityError'); };
    const mod = await loadSettings({ getItem: boom, setItem: boom });
    expect(mod.settings.get('eventMode')).toBe(false);
    expect(() => mod.settings.set('eventMode', true)).not.toThrow();
    expect(mod.settings.get('eventMode')).toBe(true);
  });
  it('a broken stored value falls back to the defaults', async () => {
    const mod = await loadSettings({ getItem: () => '{not json', setItem: () => {} });
    expect(mod.settings.get('eventMode')).toBe(false);
  });
});

describe('static wiring', () => {
  const read = f => readFileSync(new URL(`../../docs/${f}`, import.meta.url), 'utf8');
  it('the settings checkbox exists and the card loads through the chooser startSample', () => {
    expect(read('ui-shell.js')).toContain('<input id="set-event-mode" type="checkbox">');
    expect(read('app.js')).toMatch(/addEventListener\('vrl-event-sample',e=>\{[^\n]*e\.detail\.done=startSample\(id\)/);
  });
  it('the VR help board keeps its size and layout without a mission', () => {
    const src = read('vr-view.js');
    expect(src).toContain('const help=makeMenu(820,560+evH,HELP_WIDTH)');
    expect(src).toContain('evH=evLines.length?');
    expect(src).toContain(':[],evH=');
    expect(src).toMatch(/y:60\+evH,text:L\.helpT/);
    expect(src).toMatch(/y:140\+evH\+i\*78/);
  });
  it('VR / AR start with the menu board closed, or open on the かんたん menu in event mode; A/X long press and the ring still open it', () => {
    const src = read('vr-view.js');
    expect(src).toContain("const evMenu=eventModeOn();let evLabels=TRIGGER_AT_START==='label';");
    expect(src).toContain('const menu=makeMenu(MENU_W,MENU_H,MENU_WIDTH);menu.mesh.visible=evMenu;scene.add(menu.mesh);');
    expect(src).toContain('const ui={tab:evMenu?10:0,open:evMenu,');
    expect(src).toContain('const setMenuOpen=open=>{ui.open=open;menu.mesh.visible=open;if(open)placeMenuNow();menu.refresh()};');
    expect(src).toContain("if(!ui.open){setMenuOpen(true);pulseTwice(c)}");
    expect(src).toContain("case'menu':setMenuOpen(!ui.open);break;");
    expect(src).toContain('const menuHit=c=>{if(!ui.open)return null;');
  });
  it('the かんたん menu: tab 10 hides the tab bar, rows come from the loaded data (no level), すべての設定 opens the full menu, かんたん comes back (event mode only)', () => {
    const src = read('vr-view.js');
    expect(src).toContain('if(ui.tab!==10){const tw=(MENU_W-2*X)/L.tabs.length,TAB_IDS=[0,1,2,3,4,5,6,9];');
    expect(src).toContain("if(evMenu&&ui.tab!==10)btn(560,18,200,tr('evSimple'),false,()=>{ui.tab=10},{size:28});");
    const block = src.match(/if\(ui\.tab===10\)\{[\s\S]*?\}else if\(ui\.tab===0\)\{/)[0];
    expect(block).toContain('keys=simpleMenuSegments(act)');
    expect(block).toContain('trigger:{show:triggerModeRow(hasRes),label:evLabelOn()}');
    expect(block).not.toMatch(/activeEventLevel|level:|lv\b/); // nothing level-dependent
    // the actions behind the layout's widget ids: 断面 (B/Y's setSection), the trigger switch, 元に戻す (the ring's undo), すべての設定 -> the full menu, 終了 = the full menu's session.end()
    expect(src).toContain("const acts={section:v=>setSection(v),'trigger:point':()=>{evLabels=false},'trigger:label':()=>{evLabels=true},undo:()=>{undoLast()},home:goHome,all:()=>{ui.tab=0},exit:()=>session.end()};");
    expect(src).toContain("exit:tr(mode==='ar'?'evExitAr':'evExitVr')");
    expect(src).toContain("btn(MENU_W-X-260,yb,260,L.exit,true,()=>session.end(),{color:'#b33'})"); // the full menu's own exit, unchanged
    // who decides what the trigger does: label mode only when the switch says so AND the data has results (or the 解析 tab is open, as before)
    expect(src).toContain("const evLabelOn=()=>evMenu&&triggerMode(evLabels,regionList.length>0)==='label';");
    expect(src).toContain('const labelMode=()=>(ui.open&&ui.tab===5)||!section.on||evLabelOn();');
    expect(src).toContain('analysis:analysisOn(),canDrag:');
    // evLabels is only ever switched from the かんたん menu (declared once, reset when the session's data arrives, and the two switch buttons)
    expect(src.match(/evLabels=/g).length).toBe(4);
    expect(src).toContain("regionList=P.region?.list||[];evLabels=TRIGGER_AT_START==='label';"); // reset to point mode when the session's data is known
    for (const k of ['evSimple', 'evShow', 'evHide', 'evMode', 'evModePoint', 'evModeAnalysis', 'evModeHintPoint', 'evModeHintAnalysis', 'evAllSettings', 'evExitVr', 'evExitAr']) for (const lang of ['ja', 'en']) expect(typeof I18N[lang][k], `${lang}.${k}`).toBe('string');
    expect(I18N.ja.evLabels).toBeUndefined();
  });
});

// 解析モード (体験会モード): the pinned analysis cards must be pickable (grab / move / unpin) exactly as with the analysis tab open
describe('analysis mode keeps the pinned label move', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('pickPin is gated by analysisOn (tab 5 or 解析モード), not by the tab alone', () => {
    expect(src).toMatch(/const analysisOn=\(\)=>\(ui\.open&&ui\.tab===5\)\|\|evLabelOn\(\)/);
    expect(src).toMatch(/if\(analysisOn\(\)&&pins\.size\)mlb=nearerLabel\(mlb,pickPin\(/);
    expect(src).not.toMatch(/ui\.open&&ui\.tab===5&&pins\.size/);
    expect(src).toMatch(/analysis:analysisOn\(\),/);
  });
});
