import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { TUTORIAL_MISSIONS, TUT_SIGNALS, TUT_VOICES, TUT_FEEDBACK, TUT_INTRO, TUT_ORIENT, TUT_MENU_OPEN, TUT_VOICE_PICK, TUT_SAMPLE, missionById } from '../../docs/tutorial-data.js';
import { GUIDE_SLIDES, LEVEL_SLIDES, guideSlide, levelSlide, slideItem, loc } from '../../docs/tutorial-slides.js';
import { SIGNAL_KINDS } from '../../docs/tutorial-signal.js';
import { I18N } from '../../docs/i18n.js';
import { SAMPLE_SETS } from '../../docs/sample-sets.js';

const steps = TUTORIAL_MISSIONS.flatMap(m => m.steps);
describe('tutorial data', () => {
  it('five steps in the slides\' order + the way out (ステップ7); g4 is not a step; no AR, no approach / walking, no analysis step', () => {
    expect(TUTORIAL_MISSIONS.map(m => m.id)).toEqual(['controls', 'grip', 'section', 'menu', 'slice', 'data', 'exit']);
    expect(TUTORIAL_MISSIONS.map(m => m.slide)).toEqual(['controls', 'g1', 'g2', 'g3', 'g3b', 'g3', 'g3']); // the data switch explains the g3 menu; the way out is row 3 of g3 (下のボタン ... VRを終了)
    expect(missionById('grip').title).toBe('tutGripTitle');
    expect(missionById('x')).toBeNull();
    for (const old of ['m1', 'm5', 'm6', 'm7']) expect(missionById(old)).toBeNull();
    expect(TUTORIAL_MISSIONS.some(m => m.requiresAr || m.optional || m.requiresAnalysis)).toBe(false);
    expect(steps.map(s => s.done?.signal).filter(Boolean)).not.toEqual(expect.arrayContaining(['move']));
    for (const k of ['move', 'ar-start', 'point-record', 'measure-done', 'undo', 'trigger-label', 'label-show']) expect(TUT_SIGNALS, k).not.toContain(k);
  });
  it('the data-switch step sits between the slice step and the way out: two 次へ pages that only explain (nothing is switched), the exit step is the last', () => {
    expect(TUTORIAL_MISSIONS.map(m => m.id).slice(-3)).toEqual(['slice', 'data', 'exit']); expect(TUTORIAL_MISSIONS.at(-1).id).toBe('exit');
    const d = missionById('data'); expect(d.steps.map(s => s.id)).toEqual(['data1', 'data2']);
    for (const s of d.steps) { expect(s.done).toBeNull(); expect(s.next).toBe(true); expect(s.board).toBe('menu'); expect(s.menu).toBe('levels'); expect(s.audio).toMatch(/^dat[12]$/); }
    expect(I18N.ja.tutDataS1).toMatch(/データ.*Lv0.*Lv3/); expect(I18N.ja.tutDataS2).toMatch(/もう一度/); expect(I18N.en.tutDataS1).toMatch(/Data.*Lv0 to Lv3/);
    for (const l of ['ja', 'en']) expect(I18N[l].tutDataTitle).toBeTruthy();
  });
  it('ステップ1 is the controls slide, two pages finished with 次へ (no signal); every other page waits for one signal', () => {
    const c = missionById('controls');
    expect(c.steps.map(s => s.id)).toEqual(['controls1', 'controls2']);
    for (const s of c.steps) { expect(s.done).toBeNull(); expect(s.next).toBe(true); }
    for (const s of steps.filter(s => !/^(controls|data)/.test(s.id))) { expect(s.done.count, s.id).toBe(1); expect(s.next, s.id).toBeFalsy(); }
  });
  it('step-by-step: every page names the controller button it uses (ctl), the menu pages the board (board: menu), ステップ5\'s section page is conditional', () => {
    const ctl = id => missionById(id).steps.map(s => s.ctl?.btn + (s.ctl?.motion ? ':' + s.ctl.motion : ''));
    expect(ctl('controls')).toEqual(['trigger', 'trigger']); expect(ctl('grip')).toEqual(['grip', 'grip', 'grip']); expect(ctl('section')).toEqual(['face', 'trigger', 'stick:updown']);
    expect(ctl('menu')).toEqual(['trigger', 'trigger']); expect(ctl('slice')).toEqual(['face', 'trigger', 'stick:press', 'stick:hold', 'stick:hold']);
    expect(steps.filter(s => s.free).map(s => s.id)).toEqual(['exit1']); for (const s of steps.filter(s => s.free)) { expect(s.ctl, s.id).toBeUndefined(); expect(s.item, s.id).toBeUndefined(); expect(s.menu).toBe('exit'); expect(s.done).toEqual({ signal: 'session-end', count: 1 }); } // the way-out page is free: no controller annotation, no row frame
    for (const s of steps.filter(s => !s.free)) { expect(['trigger', 'grip', 'face', 'stick'], s.id).toContain(s.ctl.btn); if (s.ctl.motion) expect(['updown', 'press', 'hold'], s.id).toContain(s.ctl.motion); }
    expect(missionById('menu').steps.map(s => s.board)).toEqual(['menu', 'menu']); expect(missionById('slice').steps.map(s => s.board)).toEqual([undefined, 'menu', undefined, undefined, undefined]);
    expect(missionById('slice').steps.map(s => s.when)).toEqual(['no-section', undefined, undefined, 'frames-shown', undefined]);
    expect(missionById('slice').steps.map(s => s.id).slice(3)).toEqual(['slice3', 'slice4']); expect(missionById('slice').steps.map(s => s.done?.signal).slice(3)).toEqual(['frame-hide', 'frame-show']); // hide, then restore
    expect(missionById('slice').steps.slice(3).map(s => [s.text, s.audio, s.item])).toEqual([['tutSliceS3', 'g4c', 3], ['tutSliceS4', 'g4c2', 3]]);
    expect(I18N.ja.tutSliceS3).toBe('スティックを長く押し込む（断面の枠が隠れる）'); expect(I18N.ja.tutSliceS4).toBe('もう一度スティックを長く押し込む（枠が戻る）');
    expect(I18N.en.tutSliceS3).toBe('Click and hold the stick (the section frame hides)'); expect(I18N.en.tutSliceS4).toBe('Click and hold the stick again (the frame comes back)');
    expect(missionById('slice').steps[1].then).toMatchObject({ audio: 'g4a2' });
    // the captions say where / which hand / which button
    expect(I18N.ja.tutMenuS1).toContain('左のメニュー'); expect(I18N.ja.tutMenuS1).toContain('{tissue}'); expect(I18N.ja.tutSliceS1).toMatch(/左のメニュー.*スライス.*つまみ/); expect(I18N.ja.tutSecS1).toMatch(/右手の B.*左手の Y/);
    expect(I18N.ja.tutGripS1).toContain('中指のグリップ'); expect(I18N.ja.tutCtlS1).toContain('人さし指のトリガー');
    for (const l of ['ja', 'en']) { expect(I18N[l].tutTissueFallback).toBeTruthy(); expect(I18N[l].tutSliceS0).toBeTruthy(); }
  });
  it('each page frames a numbered row of its own slide (item: the slide is shown as a picture; menu1 and menu2 are both row 1 of g3)', () => {
    const items = id => missionById(id).steps.map(s => s.item);
    expect(items('grip')).toEqual([1, 2, 3]); expect(items('section')).toEqual([1, 2, 3]); expect(items('menu')).toEqual([1, 1]); expect(items('slice')).toEqual([undefined, 1, 2, 3, 3]); // the section page of ステップ5 frames no row
    for (const s of missionById('controls').steps) expect(s.item).toBeUndefined(); // ステップ1: the controls slide, nothing framed
    for (const m of TUTORIAL_MISSIONS) for (const s of m.steps) if (s.item) expect(slideItem(m.slide, s.item), s.id).toBeTruthy();
    // g1 / g2 / g3b: one page per numbered row of the slide, in its order
    for (const id of ['grip', 'section', 'slice']) { const m = missionById(id); expect([...new Set(m.steps.map(s => s.item).filter(Boolean))], id).toEqual(guideSlide(m.slide).items.map(r => r.n)); } // slice3 / slice4 (hide, restore the frames) share row 3
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
    expect(TUT_SIGNALS).toHaveLength(13); expect(TUT_SIGNALS).toContain('session-end');
  });
  it('steps are well formed (audio script, timeout)', () => {
    for (const s of steps) {
      expect(s.audioText.length, s.id).toBeGreaterThan(3);
      expect(s.audioText, s.id).not.toMatch(/VR|AR|CT|[A-Za-z]/); // spelled out in kana for TTS
      expect(s.timeoutHint).toBeGreaterThan(0);
    }
  });
  it('the page introduction: open Lv0, then press VR / AR (its own voice lines)', () => {
    expect(Object.keys(TUT_INTRO)).toEqual(['openLv0', 'pressVr', 'pressVrOnly', 'chooseLv', 'startVr']); expect(TUT_INTRO.pressVr).toMatchObject({ audio: 'intro4', text: 'tutIntroVr' }); expect(TUT_INTRO.pressVrOnly).toMatchObject({ audio: 'intro2', text: 'tutIntroVrOnly' }); expect(TUT_INTRO.chooseLv).toMatchObject({ audio: 'intro5', text: 'tutIntroLv123' }); expect(TUT_INTRO.startVr).toMatchObject({ audio: 'intro3', text: 'tutIntroStart' });
    expect(TUT_INTRO.openLv0.audio).toBe('intro1');
    for (const it of Object.values(TUT_INTRO)) { expect(it.audioText).not.toMatch(/[A-Za-z]/); expect(it.audioText.length).toBeLessThanOrEqual(40); }
    expect(I18N.ja.tutIntroLv0).toContain('Lv0'); expect(I18N.ja.tutIntroVr).toBe('「VRで見る」か「ARで見る」を押しましょう'); expect(TUT_INTRO.pressVr.audioText).toMatch(/ブイアールで見る、または、エーアールで見る/);
  });
  it('voices and the data are frozen', () => {
    expect(TUT_VOICES).toEqual(['F1', 'M1']);
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
  it('the narration: one file per voice (F1, M1) + manifest entry per audio id (steps, feedback, page intro, VR entry guidance, menu closed, voice choice), nothing stale', () => {
    const ids = new Set([...steps, ...Object.values(TUT_FEEDBACK).flat(), ...Object.values(TUT_INTRO), ...Object.values(TUT_ORIENT), TUT_MENU_OPEN, TUT_VOICE_PICK, ...steps.filter(s => s.then).map(s => s.then)].map(e => e.audio));
    // ids whose voice files are not made yet (no file, no manifest entry; a missing file is skipped at play time). Empty now: ex2 (the free exit page's new line) is made.
    const PENDING_AUDIO = new Set(); for (const id of PENDING_AUDIO) expect(ids.has(id), id).toBe(true);
    const shipped = new Set([...ids].filter(id => !PENDING_AUDIO.has(id)));
    for (const v of TUT_VOICES) {
      const files = readdirSync(new URL(`../../docs/tutorial/audio/${v}/`, import.meta.url)).filter(f => f.endsWith('.m4a')).map(f => f.slice(0, -4));
      expect(new Set(files), v).toEqual(shipped);
    }
    const man = JSON.parse(readFileSync(new URL('../../docs/tutorial/manifest.json', import.meta.url), 'utf8'));
    expect(new Set(Object.keys(man))).toEqual(new Set(TUT_VOICES.flatMap(v => [...shipped].map(id => v + '/' + id))));
    for (const [k, v] of Object.entries(man)) { expect(v.voice).toBe(k.split('/')[0]); expect(v.sec, k).toBeGreaterThan(0.5); expect(v.sec, k).toBeLessThan(12); } // the step-by-step lines are longer (up to about 12 s: the slider line)
    for (const k of ['ok1', 'ok2', 'ok3', 'mclear', 'intro1', 'intro2', 'pick'].flatMap(id => TUT_VOICES.map(v => v + '/' + id))) expect(man[k].sec, k).toBeLessThan(6); // the short feedback / intro lines stay short
  });
});

describe('lines: entry guidance, next-step prompt, closing', () => {
  it('TUT_ORIENT: right = the 操作パネル (help board), left = the メニュー; spoken with kana-safe readings, ja / en texts', () => {
    expect(Object.keys(TUT_ORIENT)).toEqual(['right', 'left']);
    expect(TUT_ORIENT.right).toMatchObject({ audio: 'orient1', text: 'tutOrientRight', board: 'help' }); expect(TUT_ORIENT.left).toMatchObject({ audio: 'orient2', text: 'tutOrientLeft', board: 'menu' });
    for (const it of Object.values(TUT_ORIENT)) { expect(it.audioText).not.toMatch(/[A-Za-z]/); expect(Object.isFrozen(it)).toBe(true); }
  });
  it('missionClear / allClear carry the line that follows: 「次へ」を押してください / the end; both are voiced top-level entries', () => {
    expect(TUT_FEEDBACK.missionClear.then).toBe(TUT_FEEDBACK.goNext); expect(TUT_FEEDBACK.allClear.then).toBeUndefined(); expect(TUT_FEEDBACK.end).toBeUndefined(); // the way out ends with the session, the page guides to Lv1-Lv3 itself
    expect(TUT_FEEDBACK.goNext).toMatchObject({ id: 'gonext', audio: 'gonext', text: 'tutFbGoNext' });
    expect(I18N.ja.tutFbGoNext).toBe('次のステップに進みましょう。「次へ」を押してください。');
    for (const l of ['ja', 'en']) for (const k of ['tutFbGoNext', 'tutOrientTitle', 'tutOrientHint', 'tutExitTitle', 'tutExitS1', 'tutIntroLv123', 'tutIntroLv123Off']) expect(I18N[l][k], `${l}:${k}`).toBeTruthy();
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
