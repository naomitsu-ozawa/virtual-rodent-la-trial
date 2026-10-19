import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { EVENT_LEVELS, EVENT_HINT_KEYS, levelById, levelForSample, chooseEventLevel, chosenEventLevel, eventModeOn, activeEventLevel, simpleMenuSegments, simpleMenuLabelsRow, simpleMenuLabelsAtStart, wrapWords, missionLines } from '../../docs/event-mode.js';
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
    expect(src).toMatch(/if\(ui\.tab===10\)\{[\s\S]*?keys=simpleMenuSegments\(lv,act\)[\s\S]*?if\(simpleMenuLabelsRow\(lv,regionList\.length>0\)\)\{row\(y,tr\('evLabels'\)[\s\S]*?tr\('evAllSettings'\),false,\(\)=>\{ui\.tab=0\}[\s\S]*?\}else if\(ui\.tab===0\)\{/);
    expect(src).toContain('const labelMode=()=>(ui.open&&ui.tab===5)||!section.on||evLabels;');
    // label mode from the かんたん menu: the trigger on a result pins / unpins its label, as in the 解析 tab
    expect(src).toContain('analysis:(ui.open&&ui.tab===5)||evLabels,canDrag:');
    // evLabels is only ever switched on from the かんたん menu
    expect(src.match(/evLabels=/g).length).toBe(2);
    for (const k of ['evSimple', 'evSimpleTitle', 'evShow', 'evHide', 'evLabels', 'evAllSettings']) for (const lang of ['ja', 'en']) expect(typeof I18N[lang][k]).toBe('string');
  });
});
