import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { TUTORIAL_MISSIONS, TUT_SIGNALS, TUT_VOICES, TUT_FEEDBACK, TUT_INTRO, TUT_ORIENT, TUT_MENU_OPEN, TUT_SAMPLE, missionById } from '../../docs/tutorial-data.js';
import { GUIDE_SLIDES, LEVEL_SLIDES, guideSlide, levelSlide, slideItem, loc } from '../../docs/tutorial-slides.js';
import { SIGNAL_KINDS } from '../../docs/tutorial-signal.js';
import { I18N } from '../../docs/i18n.js';
import { SAMPLE_SETS } from '../../docs/sample-sets.js';

const steps = TUTORIAL_MISSIONS.flatMap(m => m.steps);
describe('tutorial data', () => {
  it('five steps in the slides\' order; g4 is not a step; no AR, no approach / walking, no analysis step', () => {
    expect(TUTORIAL_MISSIONS.map(m => m.id)).toEqual(['controls', 'grip', 'section', 'menu', 'slice']);
    expect(TUTORIAL_MISSIONS.map(m => m.slide)).toEqual(['controls', 'g1', 'g2', 'g3', 'g3b']);
    expect(missionById('grip').title).toBe('tutGripTitle');
    expect(missionById('x')).toBeNull();
    for (const old of ['m1', 'm5', 'm6', 'm7']) expect(missionById(old)).toBeNull();
    expect(TUTORIAL_MISSIONS.some(m => m.requiresAr || m.optional || m.requiresAnalysis)).toBe(false);
    expect(steps.map(s => s.done?.signal).filter(Boolean)).not.toEqual(expect.arrayContaining(['move']));
    for (const k of ['move', 'ar-start', 'point-record', 'measure-done', 'undo', 'trigger-label', 'label-show']) expect(TUT_SIGNALS, k).not.toContain(k);
  });
  it('ステップ1 is the controls slide, two pages finished with 次へ (no signal); every other page waits for one signal', () => {
    const c = missionById('controls');
    expect(c.steps.map(s => s.id)).toEqual(['controls1', 'controls2']);
    for (const s of c.steps) { expect(s.done).toBeNull(); expect(s.next).toBe(true); }
    for (const s of steps.filter(s => !/^controls/.test(s.id))) { expect(s.done.count, s.id).toBe(1); expect(s.next, s.id).toBeFalsy(); }
  });
  it('step-by-step: every page names the controller button it uses (ctl), the menu pages the board (board: menu), ステップ5\'s section page is conditional', () => {
    const ctl = id => missionById(id).steps.map(s => s.ctl?.btn + (s.ctl?.motion ? ':' + s.ctl.motion : ''));
    expect(ctl('controls')).toEqual(['trigger', 'trigger']); expect(ctl('grip')).toEqual(['grip', 'grip', 'grip']); expect(ctl('section')).toEqual(['face', 'trigger', 'stick:updown']);
    expect(ctl('menu')).toEqual(['trigger', 'trigger']); expect(ctl('slice')).toEqual(['face', 'trigger', 'stick:press', 'stick:hold']);
    for (const s of steps) { expect(['trigger', 'grip', 'face', 'stick'], s.id).toContain(s.ctl.btn); if (s.ctl.motion) expect(['updown', 'press', 'hold'], s.id).toContain(s.ctl.motion); }
    expect(missionById('menu').steps.map(s => s.board)).toEqual(['menu', 'menu']); expect(missionById('slice').steps.map(s => s.board)).toEqual([undefined, 'menu', undefined, undefined]);
    expect(missionById('slice').steps.map(s => s.when)).toEqual(['no-section', undefined, undefined, undefined]);
    expect(missionById('slice').steps[1].then).toMatchObject({ audio: 'g4a2' });
    // the captions say where / which hand / which button
    expect(I18N.ja.tutMenuS1).toContain('左のメニュー'); expect(I18N.ja.tutMenuS1).toContain('{tissue}'); expect(I18N.ja.tutSliceS1).toMatch(/左のメニュー.*スライス.*つまみ/); expect(I18N.ja.tutSecS1).toMatch(/右手の B.*左手の Y/);
    expect(I18N.ja.tutGripS1).toContain('中指のグリップ'); expect(I18N.ja.tutCtlS1).toContain('人さし指のトリガー');
    for (const l of ['ja', 'en']) { expect(I18N[l].tutTissueFallback).toBeTruthy(); expect(I18N[l].tutSliceS0).toBeTruthy(); }
  });
  it('each page frames a numbered row of its own slide (item: the slide is shown as a picture; menu1 and menu2 are both row 1 of g3)', () => {
    const items = id => missionById(id).steps.map(s => s.item);
    expect(items('grip')).toEqual([1, 2, 3]); expect(items('section')).toEqual([1, 2, 3]); expect(items('menu')).toEqual([1, 1]); expect(items('slice')).toEqual([undefined, 1, 2, 3]); // the section page of ステップ5 frames no row
    for (const s of missionById('controls').steps) expect(s.item).toBeUndefined(); // ステップ1: the controls slide, nothing framed
    for (const m of TUTORIAL_MISSIONS) for (const s of m.steps) if (s.item) expect(slideItem(m.slide, s.item), s.id).toBeTruthy();
    // g1 / g2 / g3b: one page per numbered row of the slide, in its order
    for (const id of ['grip', 'section', 'slice']) { const m = missionById(id); expect(m.steps.map(s => s.item).filter(Boolean), id).toEqual(guideSlide(m.slide).items.map(r => r.n)); }
    const menu = missionById('menu');
    expect(menu.steps.map(s => s.done.signal)).toEqual(['seg-hide', 'seg-show']);
    expect(menu.steps.map(s => s.menu)).toEqual(['seg-hide', 'seg-show']);
    expect(missionById('slice').steps[1].menu).toBe('slider');
    // the menu is up from the start: no step asks to open it
    for (const l of ['ja', 'en']) for (const s of steps) for (const k of [s.text]) expect(I18N[l][k], `${l}:${k}`).not.toMatch(/メニューを(出|開)|open the menu/i);
  });
  it('the menu narration says where (the left menu), which row and button, and that the trigger does it', () => {
    const [m1, m2] = missionById('menu').steps;
    expect(m1.audioText).toMatch(/ひだりのメニュー/); expect(m1.audioText).toMatch(/ひかっているぎょう/); expect(m1.audioText).toMatch(/ひひょうじ/); expect(m1.audioText).toMatch(/トリガー/);
    expect(m2.audioText).toMatch(/ひょうじ/);
    const [, s1] = missionById('slice').steps; expect(s1.audioText).toMatch(/ひだりのメニュー.*スライスのぎょう.*つまみ.*トリガーを引いたまま/); expect(s1.then.audioText).toMatch(/ひだりで.*みぎで/);
  });
  it('every step practises on sample4 (骨梁 Lv0), a bundled practice dataset', () => {
    expect(TUT_SAMPLE).toBe('sample4');
    for (const m of TUTORIAL_MISSIONS) { expect(m.sample, m.id).toBe('sample4'); expect(SAMPLE_SETS[m.sample], m.id).toBeTruthy(); }
  });
  it('ids are unique (missions, steps, audio)', () => {
    for (const list of [TUTORIAL_MISSIONS.map(m => m.id), steps.map(s => s.id), [...steps.map(s => s.audio), ...steps.filter(s => s.then).map(s => s.then.audio)]]) expect(new Set(list).size).toBe(list.length);
  });
  it('every title / text / sub / note / hint key exists in ja and en', () => {
    const keys = [];
    for (const m of TUTORIAL_MISSIONS) { keys.push(m.title); if (m.note) keys.push(m.note); for (const s of m.steps) keys.push(s.text); }
    for (const it of Object.values(TUT_INTRO)) keys.push(it.text);
    for (const k of keys) for (const l of ['ja', 'en']) expect(I18N[l][k], `${l}:${k}`).toBeTruthy();
  });
  it('every done.signal is a known kind and is emitted somewhere (SIGNAL_KINDS); TUT_SIGNALS has no unused kinds', () => {
    expect(new Set(TUT_SIGNALS).size).toBe(TUT_SIGNALS.length);
    const used = [...new Set(steps.filter(s => s.done).map(s => s.done.signal))].sort();
    expect([...TUT_SIGNALS].sort()).toEqual(used);
    for (const k of TUT_SIGNALS) expect(SIGNAL_KINDS, k).toContain(k);
    expect(TUT_SIGNALS).toHaveLength(11);
  });
  it('steps are well formed (audio script, timeout)', () => {
    for (const s of steps) {
      expect(s.audioText.length, s.id).toBeGreaterThan(3);
      expect(s.audioText, s.id).not.toMatch(/VR|AR|CT|[A-Za-z]/); // spelled out in kana for TTS
      expect(s.timeoutHint).toBeGreaterThan(0);
    }
  });
  it('the page introduction: open Lv0, then press VR / AR (its own voice lines)', () => {
    expect(Object.keys(TUT_INTRO)).toEqual(['openLv0', 'pressVr', 'startVr']); expect(TUT_INTRO.startVr).toMatchObject({ audio: 'intro3', text: 'tutIntroStart' });
    expect(TUT_INTRO.openLv0.audio).toBe('intro1'); expect(TUT_INTRO.pressVr.audio).toBe('intro2');
    for (const it of Object.values(TUT_INTRO)) { expect(it.audioText).not.toMatch(/[A-Za-z]/); expect(it.audioText.length).toBeLessThanOrEqual(25); }
    expect(I18N.ja.tutIntroLv0).toContain('Lv0'); expect(I18N.ja.tutIntroVr).toContain('VRで見る');
  });
  it('voices and the data are frozen', () => {
    expect(TUT_VOICES).toEqual(['F1']);
    expect(() => { 'use strict'; TUTORIAL_MISSIONS[0].steps[0].id = 'z'; }).toThrow();
    expect(() => { 'use strict'; GUIDE_SLIDES[1].items[0].y = 0; }).toThrow();
  });
  it('ui keys exist in both languages', () => {
    for (const k of ['tutTitle', 'tutNext', 'tutPrev', 'tutSkipMission', 'tutSkipAll', 'tutReset', 'tutResetAgain', 'tutDone', 'tutLocked', 'tutVoiceF1', 'tutVoiceM1', 'tutStepWord', 'tutPanelList', 'tutPanelDetail', 'tutMissionDone', 'tutAllDone', 'tutFbMissionClear', 'tutStepList', 'tutGuides', 'tutGuideWord', 'tutCta', 'tutGuideClose', 'tutIntroVrOnly', 'tutIntroLoading', 'tutIntroLv0Off'])
      for (const l of ['ja', 'en']) expect(I18N[l][k], `${l}:${k}`).toBeTruthy();
  });
});

describe('the deck (tutorial-slides.js)', () => {
  it('the guide: controls, g1, g2, g3, g3b, g4 in order, each with a ja and en title (the slide itself is a picture)', () => {
    expect(GUIDE_SLIDES.map(s => s.id)).toEqual(['controls', 'g1', 'g2', 'g3', 'g3b', 'g4']);
    for (const s of GUIDE_SLIDES) expect(s.title.ja && s.title.en, s.id).toBeTruthy();
    expect(guideSlide('controls').items).toHaveLength(0); expect(guideSlide('g3').items.map(r => r.n)).toEqual([1, 2, 3, 4]);
    expect(guideSlide('nope')).toBeNull();
  });
  it('the level slides lv0..lv3 (the 体験会 mission board)', () => {
    expect(LEVEL_SLIDES.map(s => s.id)).toEqual(['lv0', 'lv1', 'lv2', 'lv3']); expect(LEVEL_SLIDES.map(s => s.lv)).toEqual([0, 1, 2, 3]);
    expect(levelSlide('lv0').title.ja).toBe('骨の中のスポンジ構造を観察しよう');
    expect(loc(levelSlide('lv1').title, 'en')).toBe('Look at the ethmoid labyrinth and the lungs');
    expect(loc({ ja: 'a' }, 'en')).toBe('a'); expect(loc(null, 'ja')).toBe('');
  });
});

describe('tutorial texts', () => {
  it('audioText <= 70 chars (a clip stays under about 9 s: the manifest test), captions <= 75 chars (ja) so that they fit 3 lines on the board', () => {
    for (const s of steps) {
      expect(s.audioText.length, s.id).toBeLessThanOrEqual(70); expect(I18N.ja[s.text].length, s.text).toBeLessThanOrEqual(75);
      if (s.then) expect(s.then.audioText.length, s.id).toBeLessThanOrEqual(40);
    }
  });
});

describe('ステップ wording', () => {
  it('the user-facing step texts say ステップ / Step, not ミッション / Mission; the 体験会 wording is untouched', () => {
    const jaKeys = { tutSkipMission: 'このステップをスキップ', tutLocked: '前のステップを終えると開きます', tutMissionDone: 'ステップ完了', tutAllDone: 'すべてのステップが終わりました', tutFbMissionClear: 'ステップクリアです。', tutStepWord: 'ステップ' };
    for (const [k, v] of Object.entries(jaKeys)) expect(I18N.ja[k], k).toBe(v);
    expect(I18N.ja.setTutorialNote).toContain('ステップ一覧と手順カード');
    expect(I18N.en.tutFbMissionClear).toBe('Step clear.'); expect(I18N.en.tutStepWord).toBe('Step'); expect(I18N.en.tutSkipMission).toBe('Skip this step');
    for (const l of ['ja', 'en']) for (const k of Object.keys(I18N[l]).filter(k => k.startsWith('tut'))) expect(I18N[l][k], `${l}:${k}`).not.toMatch(/ミッション|[Mm]ission/);
    expect(I18N.ja.evMissionCap).toBe('ミッション'); expect(I18N.en.evMissionCap).toBe('Mission');
    expect(I18N.ja.tutPanelList).toBe('手順一覧'); expect(I18N.ja.tutPanelDetail).toBe('詳細'); expect(I18N.en.tutPanelList).toBe('Steps'); expect(I18N.en.tutPanelDetail).toBe('Details');
    expect(TUT_FEEDBACK.missionClear.audioText).toBe('ステップクリアです。');
    for (const l of ['ja', 'en']) for (const k of Object.keys(I18N[l]).filter(k => /^tutM\d|^tutNoAnalysis$/.test(k))) expect(k).toBe(null); // the old M1..M8 keys are gone
  });
  it('the narration: one F1 file + manifest entry per audio id (steps, feedback, page intro, VR entry guidance, menu closed), nothing stale', () => {
    const ids = new Set([...steps, ...Object.values(TUT_FEEDBACK).flat(), ...Object.values(TUT_INTRO), ...Object.values(TUT_ORIENT), TUT_MENU_OPEN, ...steps.filter(s => s.then).map(s => s.then)].map(e => e.audio));
    const files = readdirSync(new URL('../../docs/tutorial/audio/F1/', import.meta.url)).filter(f => f.endsWith('.m4a')).map(f => f.slice(0, -4));
    expect(new Set(files)).toEqual(ids);
    const man = JSON.parse(readFileSync(new URL('../../docs/tutorial/manifest.json', import.meta.url), 'utf8'));
    expect(new Set(Object.keys(man))).toEqual(new Set([...ids].map(id => 'F1/' + id)));
    for (const [k, v] of Object.entries(man)) { expect(v.voice).toBe('F1'); expect(v.sec, k).toBeGreaterThan(0.5); expect(v.sec, k).toBeLessThan(12); } // the step-by-step lines are longer (up to about 12 s: the slider line)
    for (const k of ['F1/ok1', 'F1/ok2', 'F1/ok3', 'F1/mclear', 'F1/intro1', 'F1/intro2']) expect(man[k].sec, k).toBeLessThan(6); // the short feedback / intro lines stay short
  });
});

describe('lines: entry guidance, next-step prompt, closing', () => {
  it('TUT_ORIENT: right = the 操作パネル (help board), left = the メニュー; spoken with kana-safe readings, ja / en texts', () => {
    expect(Object.keys(TUT_ORIENT)).toEqual(['right', 'left']);
    expect(TUT_ORIENT.right).toMatchObject({ audio: 'orient1', text: 'tutOrientRight', board: 'help' }); expect(TUT_ORIENT.left).toMatchObject({ audio: 'orient2', text: 'tutOrientLeft', board: 'menu' });
    for (const it of Object.values(TUT_ORIENT)) { expect(it.audioText).not.toMatch(/[A-Za-z]/); expect(Object.isFrozen(it)).toBe(true); }
  });
  it('missionClear / allClear carry the line that follows: 「次へ」を押してください / the end; both are voiced top-level entries', () => {
    expect(TUT_FEEDBACK.missionClear.then).toBe(TUT_FEEDBACK.goNext); expect(TUT_FEEDBACK.allClear.then).toBe(TUT_FEEDBACK.end);
    expect(TUT_FEEDBACK.goNext).toMatchObject({ id: 'gonext', audio: 'gonext', text: 'tutFbGoNext' }); expect(TUT_FEEDBACK.end).toMatchObject({ id: 'end', audio: 'end', text: 'tutFbEnd' });
    expect(I18N.ja.tutFbGoNext).toBe('次のステップに進みましょう。「次へ」を押してください。'); expect(I18N.ja.tutFbEnd).toContain('終わり');
    for (const l of ['ja', 'en']) for (const k of ['tutFbGoNext', 'tutFbEnd', 'tutOrientTitle', 'tutOrientHint']) expect(I18N[l][k], `${l}:${k}`).toBeTruthy();
  });
});

describe('{tissue} in the captions', () => {
  it('fillTissue puts the real name or the fallback words, never leaves the placeholder; one caption (the menu page) has it, in ja and en', async () => {
    const { fillTissue } = await import('../../docs/tutorial-data.js');
    expect(fillTissue('「{tissue}」の行', '骨', 'x')).toBe('「骨」の行'); expect(fillTissue('「{tissue}」の行', '', '一番上の組織')).toBe('「一番上の組織」の行'); expect(fillTissue(undefined, 'a', 'b')).toBe('');
    for (const l of ['ja', 'en']) expect(Object.keys(I18N[l]).filter(k => /^tut/.test(k) && I18N[l][k].includes('{tissue}'))).toEqual(['tutMenuS1']);
    expect(I18N.en.tutMenuS1).toContain('“Hide”');
  });
});

describe('menu closed line and the hands', () => {
  it('TUT_MENU_OPEN: A / X long press (the real way: vr-view.js onAxLong), kana-safe, the 3D hint = the lower face button held, text in ja / en, frozen', () => {
    expect(TUT_MENU_OPEN).toMatchObject({ id: 'g3open', audio: 'g3open', text: 'tutMenuClosed', ctl: { btn: 'facelow', motion: 'hold' } }); expect(Object.isFrozen(TUT_MENU_OPEN)).toBe(true);
    expect(TUT_MENU_OPEN.audioText).not.toMatch(/[A-Za-z]/); expect(TUT_MENU_OPEN.audioText).toMatch(/ながおし/);
    for (const l of ['ja', 'en']) expect(I18N[l].tutMenuClosed, l).toMatch(/A.*X/);
    const vv = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8'); expect(vv).toContain('const onAxLong=c=>{'); expect(vv).toContain('if(!ui.open){setMenuOpen(true);'); // a long press of A / X opens a closed menu
  });
});
