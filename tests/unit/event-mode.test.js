import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { EVENT_LEVELS, EVENT_HINT_KEYS, levelById, levelForSample, chooseEventLevel, chosenEventLevel, eventModeOn, activeEventLevel, simpleMenuSegments, simpleMenuLabelsRow, simpleMenuLabelsAtStart, simpleMenuUndoRow, simpleMenuLayout, SIMPLE_MENU, wrapWords, missionLines } from '../../docs/event-mode.js';
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
    expect(I18N.ja.evLv2Mission).toBe('断面でおなかの中を観察しよう → 軟部組織を隠して脂肪を表示し、解析済みの脂肪を観察しよう');
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

describe('the VR かんたん menu segments', () => {
  it('per level: Lv0 bone / Lv1 bone, soft, lung / Lv2 and Lv3 bone, soft, fat', () => {
    expect(Object.fromEntries(EVENT_LEVELS.map(l => [l.id, [...l.segments]]))).toEqual({ lv0: ['bone'], lv1: ['bone', 'soft', 'lung'], lv2: ['bone', 'soft', 'fat'], lv3: ['bone', 'soft', 'fat'] });
  });
  it('only the segments the data shows, in the level order; no level = every shown segment', () => {
    // shown segments of the bundled projects: sample4 bone; sample3 bone soft lung; sample2 bone soft fat lung; sample1 bone soft fat
    expect(simpleMenuSegments(levelById('lv0'), ['bone'])).toEqual(['bone']);
    expect(simpleMenuSegments(levelById('lv1'), ['bone', 'soft', 'lung'])).toEqual(['bone', 'soft', 'lung']);
    expect(simpleMenuSegments(levelById('lv2'), ['bone', 'soft', 'fat', 'lung'])).toEqual(['bone', 'soft', 'fat']);
    expect(simpleMenuSegments(levelById('lv3'), ['fat', 'bone', 'soft'])).toEqual(['bone', 'soft', 'fat']);
    expect(simpleMenuSegments(levelById('lv2'), ['bone'])).toEqual(['bone']);
    expect(simpleMenuSegments(null, ['bone', 'contrast'])).toEqual(['bone', 'contrast']);
    expect(simpleMenuSegments(null, undefined)).toEqual([]);
  });
  it('解析結果のラベル: Lv2 only (on from the start), or with no level chosen; never without results', () => {
    expect(EVENT_LEVELS.filter(l => l.labels === true).map(l => l.id)).toEqual(['lv2']);
    expect(simpleMenuLabelsRow(levelById('lv2'), true)).toBe(true);
    expect(simpleMenuLabelsRow(levelById('lv2'), false)).toBe(false);
    expect(simpleMenuLabelsRow(levelById('lv3'), true)).toBe(false); // Lv3 records points with the trigger
    expect(simpleMenuLabelsRow(null, true)).toBe(true);
    expect(simpleMenuLabelsAtStart(levelById('lv2'))).toBe(true);
    expect(['lv0', 'lv1', 'lv3'].map(id => simpleMenuLabelsAtStart(levelById(id)))).toEqual([false, false, false]);
    expect(simpleMenuLabelsAtStart(null)).toBe(false);
  });
});

// the かんたん menu board: what each level gets (simpleMenuLayout is the pure layout vr-view.js draws)
const TEXT = lang => {
  const t = I18N[lang], ja = lang === 'ja';
  return { show: t.evShow, hide: t.evHide, section: ja ? '断面' : 'Sections', labels: t.evLabels, results: ja ? '解析結果（体積）' : 'Analysis results (volume)', total: ja ? '合計' : 'Total', noSeg: 'none', home: ja ? '正面に戻す' : 'Bring to front', undo: ja ? '元に戻す' : 'Undo', all: t.evAllSettings, exit: t.evExitVr };
};
const SEG_NAMES = { ja: { bone: '骨', soft: '軟部組織', fat: '脂肪', lung: '肺' }, en: { bone: 'Bone', soft: 'Soft tissue', fat: 'Fat', lung: 'Lung' } };
const COLORS = { bone: '#f3f0e8', soft: '#d97f7f', fat: '#e7c85d', lung: '#7fb3d9' };
// the bundled projects (what the data shows when a level is opened)
const bundled = sample => JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(new URL(`../../docs/demo/${sample}/project.vrlab`, import.meta.url))))['project.json']));
const shownOf = p => ['bone', 'soft', 'fat', 'lung', 'contrast'].filter(k => p.segments?.[k]?.active && p.segments?.[k]?.enabled);
function layoutFor(level, lang = 'ja', over = {}) {
  const p = level ? bundled(level.sample) : null, keys = p ? simpleMenuSegments(level, shownOf(p)) : [];
  const regions = (p?.analysis?.regions || []).map((r, i) => ({ hex: '#' + r.color.toString(16).padStart(6, '0'), name: `${i + 1}. ${SEG_NAMES[lang][r.segmentKeys[0]]}`, text: (12.34 * (i + 1)).toFixed(2) + ' mm³' }));
  return simpleMenuLayout({ level, segments: keys.map(k => ({ key: k, name: SEG_NAMES[lang][k], color: COLORS[k], on: true })), sectionOn: true, labels: { show: simpleMenuLabelsRow(level, regions.length > 0), on: false }, results: regions, total: '99.99 mm³', undo: { show: simpleMenuUndoRow(level) }, text: TEXT(lang), ...over });
}
const ids = w => w.map(x => x.id);
const buttons = w => w.filter(x => x.type === 'button');

describe('the VR かんたん menu board per level', () => {
  const lv = id => levelById(id);
  it('Lv0: bone, 断面, the bottom row (no analysis, no undo)', () => {
    const w = layoutFor(lv('lv0'));
    expect(ids(buttons(w))).toEqual(['seg:bone:show', 'seg:bone:hide', 'section:show', 'section:hide', 'home', 'all', 'exit']);
  });
  it('Lv1: bone, soft tissue, lung, 断面', () => {
    expect(ids(buttons(layoutFor(lv('lv1')))).filter(i => i.endsWith(':show'))).toEqual(['seg:bone:show', 'seg:soft:show', 'seg:lung:show', 'section:show']);
  });
  it('Lv2: bone, soft tissue, fat, 断面, the analysis labels, and the 4 analysis results with the total', () => {
    const w = layoutFor(lv('lv2'));
    expect(ids(buttons(w)).filter(i => i.endsWith(':show'))).toEqual(['seg:bone:show', 'seg:soft:show', 'seg:fat:show', 'section:show', 'labels:show']);
    expect(buttons(w).filter(b => b.id.startsWith('result:')).length).toBe(4);
    expect(w.find(x => x.id === 'results').text).toBe('解析結果（体積）');
    expect(w.find(x => x.id === 'total').text).toBe('合計 99.99 mm³ · 4');
    expect(ids(w)).not.toContain('undo');
  });
  it('Lv3: bone, soft tissue, fat, 断面, 元に戻す, the analysis list (read only) but no label row', () => {
    const w = layoutFor(lv('lv3'));
    expect(ids(buttons(w)).filter(i => i.endsWith(':show'))).toEqual(['seg:bone:show', 'seg:soft:show', 'seg:fat:show', 'section:show']);
    expect(ids(buttons(w))).toContain('undo');
    expect(buttons(w).filter(b => b.id.startsWith('result:')).length).toBe(2);
    expect(ids(w)).not.toContain('labels:show');
  });
  it('the exit button is always there, last, red and filled; 正面に戻す and すべての設定 stay', () => {
    for (const l of [...EVENT_LEVELS, null]) {
      const b = buttons(layoutFor(l)), last = b[b.length - 1];
      expect(last.id).toBe('exit');
      expect(last.on).toBe(true);
      expect(last.color).toBe('#b33');
      expect(ids(b)).toEqual(expect.arrayContaining(['home', 'all']));
    }
    expect(buttons(layoutFor(null)).map(b => b.id)).toContain('undo'); // no level chosen: everything
    expect(simpleMenuUndoRow(levelById('lv2'))).toBe(false);
    expect(simpleMenuUndoRow(levelById('lv3'))).toBe(true);
  });
  it('the exit label says VR or AR, in both languages', () => {
    for (const lang of ['ja', 'en']) for (const [k, re] of [['evExitVr', /VR/], ['evExitAr', /AR/]]) expect(I18N[lang][k]).toMatch(re);
    expect(I18N.ja.evExitVr).toBe('VRを終了');
    expect(I18N.en.evExitAr).toBe('Exit AR');
  });
  it('no advanced settings on the board (quality, foveation, HU, benchmark, resolution ...)', () => {
    const all = [].concat(...[...EVENT_LEVELS, null].map(l => layoutFor(l)));
    for (const x of all) expect(x.id).toMatch(/^(noseg|seg:\w+(:name|:show|:hide)|section(:name|:show|:hide)|labels(:name|:show|:hide)|results|result:\d+(:name|:vol)?|total|home|undo|all|exit)$/);
  });
  it('a hidden / shown state is reflected by the on flags', () => {
    const w = simpleMenuLayout({ level: levelById('lv0'), segments: [{ key: 'bone', name: '骨', color: '#fff', on: false }], sectionOn: false, labels: { show: false }, results: [], total: '', undo: { show: false }, text: TEXT('ja') });
    const on = id => w.find(x => x.id === id).on;
    expect([on('seg:bone:show'), on('seg:bone:hide'), on('section:show'), on('section:hide')]).toEqual([false, true, false, true]);
  });
  it('no title / level line: the level is named on the help board only; the rows start right under the status line', () => {
    for (const l of [...EVENT_LEVELS, null]) {
      const w = layoutFor(l);
      expect(w.some(x => x.id === 'title' || /^Lv\d/.test(x.text || ''))).toBe(false);
      const first = Math.min(...w.filter(x => x.type === 'button').map(x => x.y));
      expect(first).toBe(l ? SIMPLE_MENU.TOP : SIMPLE_MENU.TOP + SIMPLE_MENU.ROW); // (no level / no segment: the note takes the first row)
    }
    expect(SIMPLE_MENU.TOP - SIMPLE_MENU.STATUS).toBeLessThanOrEqual(60); // no empty band between the status line and the first row
    expect(SIMPLE_MENU.STATUS).toBeGreaterThan(90); // below the header buttons (y 18-90)
  });
});

describe('mission audit: every item a mission needs is on the かんたん menu', () => {
  // what each mission uses from the board (controller-only actions - grip move, B/Y, stick, trigger, ring 距離 - need nothing here)
  const NEED = { lv0: ['seg:bone', 'section'], lv1: ['seg:bone', 'seg:soft', 'seg:lung', 'section'], lv2: ['seg:bone', 'seg:soft', 'seg:fat', 'section', 'labels', 'result:0'], lv3: ['seg:bone', 'seg:soft', 'seg:fat', 'section', 'undo'] };
  for (const l of EVENT_LEVELS) {
    it(`${l.id} (${l.sample}): the bundled project shows the level's segments, and the board has every needed row`, () => {
      const p = bundled(l.sample);
      for (const k of l.segments) expect(shownOf(p), `${l.sample} shows ${k}`).toContain(k);
      for (const lang of ['ja', 'en']) {
        const have = new Set(layoutFor(l, lang).filter(x => x.type === 'button').map(x => x.id.replace(/:(show|hide)$/, '')));
        for (const n of [...NEED[l.id], 'exit']) expect(have.has(n), `${l.id}/${lang} needs ${n}`).toBe(true);
      }
    });
  }
  it('Lv2 starts with the analysis labels on (the mission uses the laser label and the trigger pin from the start)', () => {
    expect(simpleMenuLabelsAtStart(levelById('lv2'))).toBe(true);
    expect(bundled('sample2').analysis.regions.length).toBeGreaterThan(0);
  });
  it('Lv0 / Lv1 data has no analysis results, so those boards have no list', () => {
    expect(layoutFor(levelById('lv0')).some(x => x.id === 'results')).toBe(false);
    expect(layoutFor(levelById('lv1')).some(x => x.id === 'results')).toBe(false);
  });
});

describe('the かんたん menu board layout fits the canvas', () => {
  const M = SIMPLE_MENU;
  // a stand-in for ctx.measureText: CJK / full-width = 1 em, Latin = 0.6 em (bold 1.08 x)
  const measure = (text, size, bold) => [...String(text)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6) * size * (bold ? 1.08 : 1), 0);
  const rect = x => ({ x: x.x, y: x.y, w: x.w, h: x.h });
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const cases = [];
  for (const lang of ['ja', 'en']) for (const l of [...EVENT_LEVELS, null]) cases.push([lang, l]);
  for (const [lang, l] of cases) {
    it(`${l?.id ?? 'no level'} / ${lang}: inside the board, buttons do not overlap, texts fit`, () => {
      const w = layoutFor(l, lang), bs = buttons(w);
      for (const b of bs) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(M.W); expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.h).toBeLessThanOrEqual(M.H); }
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(overlap(rect(bs[i]), rect(bs[j])), `${bs[i].id} / ${bs[j].id}`).toBe(false);
      // button labels may shrink a little on the canvas (maxWidth), but should not need more than 25 %
      for (const b of bs.filter(x => x.label)) expect(measure(b.label, b.size, false), b.id).toBeLessThanOrEqual((b.w - 8) * 1.25);
      // a row name stays left of its buttons (x 440), result names left of their volumes (x 560), volumes inside the board
      for (const x of w.filter(x => x.type === 'label')) {
        const wd = measure(x.text, x.size || 30, x.bold);
        if (/^(seg:|section|labels).*:name$/.test(x.id)) expect(x.x + wd, x.id).toBeLessThanOrEqual(430);
        else if (/^result:\d+:name$/.test(x.id)) expect(x.x + wd, x.id).toBeLessThanOrEqual(x.x + 440);
        else expect(x.x + wd, x.id).toBeLessThanOrEqual(M.W - 20);
        expect(x.y).toBeLessThan(M.H);
      }
      // the list stops above the bottom row
      const bottomY = Math.min(...bs.filter(b => ['home', 'all', 'exit'].includes(b.id)).map(b => b.y));
      for (const x of w.filter(x => /^(result|total)/.test(x.id))) expect(x.y + (x.h || 0), x.id).toBeLessThan(bottomY);
    });
  }
  it('with more results than fit, the list is cut and the count of the rest is shown', () => {
    const results = Array.from({ length: 12 }, (_, i) => ({ hex: '#fff', name: `${i + 1}. Fat`, text: '1.00 mm³' }));
    const w = simpleMenuLayout({ level: levelById('lv2'), segments: ['bone', 'soft', 'fat'].map(k => ({ key: k, name: k, color: '#fff', on: true })), sectionOn: true, labels: { show: true, on: true }, results, total: '12.00 mm³', undo: { show: false }, text: TEXT('en') });
    const n = buttons(w).filter(b => b.id.startsWith('result:')).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(12);
    expect(w.find(x => x.id === 'total').text).toBe(`Total 12.00 mm³ · 12  (… +${12 - n})`);
  });
  it('no segment shown: the none-shown note, the 断面 row and the bottom row still come', () => {
    const w = simpleMenuLayout({ level: null, segments: [], sectionOn: true, labels: { show: false }, results: [], total: '', undo: { show: true }, text: TEXT('ja') });
    expect(ids(w)).toEqual(expect.arrayContaining(['noseg', 'section:show', 'exit']));
  });
});

describe('mission wrap for the VR help board', () => {
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
    expect(src).toContain('const evMenu=eventModeOn();let evLabels=evMenu&&simpleMenuLabelsAtStart(activeEventLevel());');
    expect(src).toContain('const menu=makeMenu(MENU_W,MENU_H,MENU_WIDTH);menu.mesh.visible=evMenu;scene.add(menu.mesh);');
    expect(src).toContain('const ui={tab:evMenu?10:0,open:evMenu,');
    expect(src).toContain('const setMenuOpen=open=>{ui.open=open;menu.mesh.visible=open;if(open)placeMenuNow();menu.refresh()};');
    expect(src).toContain("if(!ui.open){setMenuOpen(true);pulseTwice(c)}");
    expect(src).toContain("case'menu':setMenuOpen(!ui.open);break;");
    expect(src).toContain('const menuHit=c=>{if(!ui.open)return null;');
  });
  it('the かんたん menu: tab 10 hides the tab bar, rows come from simpleMenuSegments, すべての設定 opens the full menu, かんたん comes back (event mode only)', () => {
    const src = read('vr-view.js');
    expect(src).toContain('if(ui.tab!==10){const tw=(MENU_W-2*X)/L.tabs.length,TAB_IDS=[0,1,2,3,4,5,6,9];');
    expect(src).toContain("if(evMenu&&ui.tab!==10)btn(560,18,200,tr('evSimple'),false,()=>{ui.tab=10},{size:28});");
    expect(src).toMatch(/if\(ui\.tab===10\)\{[\s\S]*?keys=simpleMenuSegments\(lv,act\)[\s\S]*?simpleMenuLayout\(\{[\s\S]*?labels:\{show:simpleMenuLabelsRow\(lv,regionList\.length>0\),on:evLabels\}[\s\S]*?\}else if\(ui\.tab===0\)\{/);
    // the actions behind the layout's widget ids: 断面 (B/Y's setSection), the labels, 元に戻す (the ring's undo), すべての設定 -> the full menu, 終了 = the full menu's session.end()
    expect(src).toContain("const acts={section:v=>setSection(v),labels:v=>{evLabels=v},undo:()=>{undoLast()},home:goHome,all:()=>{ui.tab=0},exit:()=>session.end()};");
    expect(src).toContain("exit:tr(mode==='ar'?'evExitAr':'evExitVr')");
    expect(src).toContain("btn(MENU_W-X-260,yb,260,L.exit,true,()=>session.end(),{color:'#b33'})"); // the full menu's own exit, unchanged
    expect(src).toContain('const labelMode=()=>(ui.open&&ui.tab===5)||!section.on||evLabels;');
    // label mode from the かんたん menu: the trigger on a result pins / unpins its label, as in the 解析 tab
    expect(src).toContain('analysis:(ui.open&&ui.tab===5)||evLabels,canDrag:');
    // evLabels is only ever switched on from the かんたん menu
    expect(src.match(/evLabels=/g).length).toBe(2);
    for (const k of ['evSimple', 'evShow', 'evHide', 'evLabels', 'evAllSettings', 'evExitVr', 'evExitAr']) for (const lang of ['ja', 'en']) expect(typeof I18N[lang][k]).toBe('string');
  });
});
