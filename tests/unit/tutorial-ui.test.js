import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizeTutorialSettings, SETTINGS_DEFAULTS } from '../../docs/app-settings.js';
import { tutorialSignalsOn, tutorialUiActive, continueTutorial, getTutorialEngine, resetTutorialAll, isPracticeSample, panelModel, detectVrSupport, _resetTutorialEngineForTest, introPhase, introTargets, introTextKey, createTutorialIntro } from '../../docs/tutorial-ui.js';
import { createTutorialEngine } from '../../docs/tutorial-engine.js';
import { TUTORIAL_MISSIONS } from '../../docs/tutorial-data.js';
import { EVENT_LEVELS } from '../../docs/event-mode.js';
import { I18N } from '../../docs/i18n.js';

const memProgress = () => { let p = { v: 1, done: {}, skipAll: false, last: null }; return { load: () => JSON.parse(JSON.stringify(p)), save: q => { p = JSON.parse(JSON.stringify(q)); }, clear: () => { p = { v: 1, done: {}, skipAll: false, last: null }; } }; };
const mk = () => createTutorialEngine({ progress: memProgress(), arAvailable: false }); // no AR step: AR support changes nothing

describe('tutorial settings', () => {
  it('defaults: off, voice F1', () => {
    expect(SETTINGS_DEFAULTS.tutorialMode).toBe(false);
    expect(SETTINGS_DEFAULTS.tutorialVoice).toBe('F1');
  });
  it('sanitize: only true switches on; voice F1 / off only (M1 is gone), anything else F1', () => {
    expect(sanitizeTutorialSettings({ tutorialMode: 'yes', tutorialVoice: 'X' })).toEqual({ tutorialMode: false, tutorialVoice: 'F1' });
    expect(sanitizeTutorialSettings({ tutorialMode: true, tutorialVoice: 'M1' })).toEqual({ tutorialMode: true, tutorialVoice: 'F1' });
    expect(sanitizeTutorialSettings({ tutorialVoice: 'off' }).tutorialVoice).toBe('off');
  });
  it('i18n has the switch and voice keys in both languages', () => {
    for (const l of ['ja', 'en']) for (const k of ['setTutorial', 'setTutorialNote', 'tutVoiceF1', 'tutVoiceOff']) expect(I18N[l][k], l + k).toBeTruthy();
  });
});

describe('panel model', () => {
  it('idle: ステップ1 (controls) available, the rest locked; the ステップ numbers are fixed 1..5; nothing is unavailable (no AR step)', () => {
    const m = panelModel(mk());
    expect(m.step).toBeNull();
    expect(m.missions.map(x => x.id)).toEqual(['controls', 'grip', 'section', 'menu', 'slice']);
    expect(m.missions.map(x => x.status)).toEqual(['available', 'locked', 'locked', 'locked', 'locked']);
    expect(m.missions.map(x => x.stepNo)).toEqual([1, 2, 3, 4, 5]);
    expect(m.missions[0].canStart).toBe(true);
    expect(m.missions[1].canStart).toBe(false);
  });
  it('carousel n/N while running; finishing a step by next() gives a check and unlocks the next', () => {
    const e = mk(); e.skipMission('controls'); e.start('grip');
    let m = panelModel(e);
    expect(m.step).toMatchObject({ n: 1, N: 3, hasPrev: false, hasNext: true, isLast: false, missionId: 'grip' });
    expect(I18N.ja[m.step.textKey]).toBe('光線を向けてグリップ');
    for (let i = 0; i < 3; i++) e.next();
    m = panelModel(e);
    expect(m.missions[1]).toMatchObject({ status: 'done', mark: 'tutDone' });
    expect(m.missions[2].status).toBe('available');
    expect(m.step.finished).toBe(true);
  });
  it('skipAll opens every mission and marks them done; reset clears', () => {
    const e = mk(); e.skipAll();
    expect(panelModel(e).missions.filter(x => x.status === 'done').length).toBe(5);
    expect(panelModel(e).allDone).toBe(true);
    e.reset();
    expect(panelModel(e).missions[0].status).toBe('available');
    expect(panelModel(e).allDone).toBe(false);
  });
});

describe('singleton engine', () => {
  beforeEach(() => _resetTutorialEngineForTest());
  it('getTutorialEngine returns the same engine and keeps it on globalThis', () => {
    const a = getTutorialEngine(), b = getTutorialEngine();
    expect(a).toBe(b);
    expect(globalThis.__vrlTutorialEngine).toBe(a);
  });
  it('no AR step and no AR detection: every step is available in order (also without XR)', () => {
    const e = getTutorialEngine();
    expect(e.listMissions().some(m => m.status === 'unavailable')).toBe(false);
  });
});

describe('最初から (resetTutorialAll, shared by 2D and VR)', () => {
  it('progress always cleared; resetUserState only while a practice dataset is open', () => {
    for (const [open, called] of [['sample1', 1], ['sample2', 1], ['sample3', 1], ['sample4', 1], ['mine', 0], ['', 0], [undefined, 0], [null, 0]]) {
      const engine = { reset: vi.fn() }, ru = vi.fn();
      resetTutorialAll({ engine, resetUserState: ru, openSample: open });
      expect(engine.reset, String(open)).toHaveBeenCalledTimes(1); expect(ru, String(open)).toHaveBeenCalledTimes(called);
    }
    for (const l of EVENT_LEVELS) expect(isPracticeSample(l.sample), l.sample).toBe(true); // all 体験会 practice data (Lv0-Lv3),
    expect(isPracticeSample('sample4')).toBe(true); expect(isPracticeSample('mine')).toBe(false);
  });
  it('a throwing resetUserState does not escape; no resetUserState is fine', () => {
    const engine = { reset: vi.fn() };
    expect(() => resetTutorialAll({ engine, resetUserState: () => { throw new Error('x'); }, openSample: 'sample4' })).not.toThrow();
    expect(() => resetTutorialAll({ engine, openSample: 'sample4' })).not.toThrow(); expect(engine.reset).toHaveBeenCalledTimes(2);
  });
  it('reads globalThis.__vrlOpenSample at call time by default', () => {
    const prev = globalThis.__vrlOpenSample, engine = { reset: vi.fn() }, ru = vi.fn();
    try { globalThis.__vrlOpenSample = 'sample3'; resetTutorialAll({ engine, resetUserState: ru }); globalThis.__vrlOpenSample = 'other'; resetTutorialAll({ engine, resetUserState: ru }); } finally { globalThis.__vrlOpenSample = prev; }
    expect(ru).toHaveBeenCalledTimes(1);
  });
});

describe('the tutorial has no analysis part', () => {
  it('tutorial-ui.js / tutorial-vr.js / the engine carry no hasAnalysis / analysis wiring and data-load.js no vrl-data-ready', async () => {
    const { readFileSync } = await import('node:fs');
    const rd = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
    for (const f of ['tutorial-ui.js', 'tutorial-vr.js', 'tutorial-engine.js', 'tutorial-data.js']) expect(rd(f), f).not.toMatch(/hasAnalysis|requiresAnalysis|syncAnalysisEnv|vrl-data-ready|tutNoAnalysis/);
    expect(rd('tutorial-ui.js')).not.toContain("'vrl-serieschange'");
    expect(rd('data-load.js')).not.toContain('vrl-data-ready'); // nobody else listens to it
    expect(rd('vr-view.js')).not.toMatch(/setEnv\(\{hasAnalysis/);
  });
});

describe('Lv0 card continues the tutorial', () => {
  const eng = () => createTutorialEngine({ progress: memProgress(), arAvailable: false });
  it('nothing done: starts ステップ1; a mission under way keeps going (not restarted); after finishing it the next one starts', () => {
    const e = eng();
    expect(continueTutorial(e)).toEqual({ action: 'start', id: 'controls' }); expect(e.getState()).toMatchObject({ mission: 'controls', step: 0 });
    e.next(); expect(e.getState().finished).toBe(true);
    expect(continueTutorial(e)).toEqual({ action: 'start', id: 'grip' });
    e.next(); expect(e.getState().step).toBe(1);
    expect(continueTutorial(e)).toEqual({ action: 'resume', id: 'grip' }); expect(e.getState()).toMatchObject({ mission: 'grip', step: 1 }); // untouched
  });
  it('after a reload (no mission open) the next not-done step starts; everything done: nothing starts', () => {
    const e2 = eng(); e2.skipMission('controls'); e2.skipMission('grip'); // nothing open (as after a reload)
    expect(continueTutorial(e2)).toEqual({ action: 'start', id: 'section' });
    const all = eng(); all.skipAll();
    expect(continueTutorial(all)).toEqual({ action: 'none', id: null }); expect(all.getState().mission).toBeNull();
  });
  it('wiring: only Lv0 and only while the tutorial UI is live; the switch is never turned on by the card', async () => {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../../docs/event-mode-ui.js', import.meta.url), 'utf8');
    expect(ui).toContain("if(lv.id==='lv0'&&tutorialUiActive()){try{continueTutorial()}");
    expect(ui).not.toMatch(/settings\.set\('tutorialMode'/);
    expect(tutorialUiActive()).toBe(false); // no panel mounted in this test: the Lv0 card is the plain card
  });
});
describe('tutorial switch off: signals are ignored', () => {
  it('tutorialSignalsOn follows the tutorialMode setting, and only while the Lv0 data (sample4) is open', async () => {
    const settings = globalThis.__vrlSettings, prev = settings.get('tutorialMode'), prevS = globalThis.__vrlOpenSample;
    try {
      globalThis.__vrlOpenSample = 'sample4';
      settings.set('tutorialMode', false); expect(tutorialSignalsOn()).toBe(false); settings.set('tutorialMode', true); expect(tutorialSignalsOn()).toBe(true);
      for (const other of ['sample1', 'sample2', 'sample3', 'mine', undefined]) { globalThis.__vrlOpenSample = other; expect(tutorialSignalsOn(), String(other)).toBe(false); }
    } finally { settings.set('tutorialMode', prev); globalThis.__vrlOpenSample = prevS; }
  });
});

describe('最初から wiring (static)', () => {
  it('2D and VR both go through resetTutorialAll, and nothing else calls engine.reset / resetUserState directly', async () => {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../../docs/tutorial-ui.js', import.meta.url), 'utf8'), vr = readFileSync(new URL('../../docs/tutorial-vr.js', import.meta.url), 'utf8');
    expect(ui).toContain('resetTutorialAll({resetUserState})'); expect(ui).not.toMatch(/getTutorialEngine\(\)\.reset\(\)/);
    expect(vr).toContain('resetTutorialAll({ engine: eng, resetUserState })'); expect(vr).not.toMatch(/eng\.reset\(\)/);
  });
});

describe('detectVrSupport (VR-only gate)', () => {
  it('true only when immersive-vr is supported', async () => {
    expect(await detectVrSupport({ xr: { isSessionSupported: async m => m === 'immersive-vr' } })).toBe(true);
  });
  it('false for no xr / no function / false / rejection / throw', async () => {
    expect(await detectVrSupport({})).toBe(false);
    expect(await detectVrSupport(undefined)).toBe(false);
    expect(await detectVrSupport({ xr: {} })).toBe(false);
    expect(await detectVrSupport({ xr: { isSessionSupported: async () => false } })).toBe(false);
    expect(await detectVrSupport({ xr: { isSessionSupported: async () => { throw new Error('x'); } } })).toBe(false);
    expect(await detectVrSupport({ xr: { isSessionSupported: () => { throw new Error('x'); } } })).toBe(false);
  });
});

// the page introduction after 「チュートリアルを始める」 (a tiny fake DOM: the test environment has none)
function fakeDoc({ lv0Card = false, vrReady = true, ar = true, job = null } = {}) {
  const doc = new EventTarget(); const byId = {}, bySel = {};
  const elem = (tag = 'div') => { const e = { tag, hidden: false, disabled: false, dataset: {}, children: [], textContent: '', className: '', attrs: {}, cls: new Set(),
    classList: { add: c => e.cls.add(c), remove: c => e.cls.delete(c), contains: c => e.cls.has(c) }, closest: () => null, setAttribute: (k, v) => { e.attrs[k] = v; },
    append: (...k) => e.children.push(...k), remove: () => { const i = doc.body.children.indexOf(e); if (i >= 0) doc.body.children.splice(i, 1); },
    querySelector: sel => e.children.find(c => sel === '.' + c.className) || null }; return e; };
  doc.body = elem('body'); doc.createElement = elem;
  doc.getElementById = id => byId[id] || null; doc.querySelector = sel => bySel[sel] || null;
  byId['sample-demo-button'] = elem('button'); bySel['[data-sample-set="sample4"]'] = elem('button');
  byId['vr-view-button'] = Object.assign(elem('button'), { disabled: !vrReady }); byId['ar-view-button'] = Object.assign(elem('button'), { hidden: !ar });
  if (lv0Card) bySel['[data-event-level="lv0"]'] = elem('button');
  if (job !== null) { byId['job-modal'] = elem(); if (!job) byId['job-modal'].cls.add('is-hidden'); } // the progress modal: up (job) or hidden
  return { doc, byId, bySel, bar: () => doc.body.children.find(c => c.id === 'tut-guide') || null };
}
describe('page introduction', () => {
  it('phase: Lv0 data open = press VR, anything else = open Lv0 first', () => {
    expect(introPhase('sample4')).toBe('pressVr');
    for (const o of [undefined, null, 'sample1', 'mine']) expect(introPhase(o)).toBe('openLv0');
  });
  it('what is lit and said: the Lv0 card when 体験会 shows it, else 練習データ and its 骨梁 entry; then the VR (and AR) button, or wait while it loads', () => {
    const a = fakeDoc({ lv0Card: true });
    expect(introTargets('openLv0', a.doc)).toEqual([a.bySel['[data-event-level="lv0"]']]); expect(introTextKey('openLv0', a.doc)).toBe('tutIntroLv0');
    const b = fakeDoc();
    expect(introTargets('openLv0', b.doc)).toEqual([b.byId['sample-demo-button'], b.bySel['[data-sample-set="sample4"]']]); expect(introTextKey('openLv0', b.doc)).toBe('tutIntroLv0Off');
    expect(introTargets('pressVr', b.doc)).toEqual([b.byId['vr-view-button'], b.byId['ar-view-button']]); expect(introTextKey('pressVr', b.doc)).toBe('tutIntroVr');
    const c = fakeDoc({ ar: false }); expect(introTargets('pressVr', c.doc)).toEqual([c.byId['vr-view-button']]); expect(introTextKey('pressVr', c.doc)).toBe('tutIntroVrOnly');
    expect(introTextKey('pressVr', fakeDoc({ vrReady: false }).doc)).toBe('tutIntroLoading');
    expect(introTextKey('pressVr', fakeDoc({ job: true }).doc)).toBe('tutIntroLoading'); // the data is still loading (the VR button can be enabled already)
    expect(introTextKey('pressVr', fakeDoc({ job: false }).doc)).toBe('tutIntroVr');
    expect(introTargets(null, b.doc)).toEqual([]);
    expect(I18N.ja.tutIntroLv0Off).toContain('練習データ'); expect(I18N.ja.tutIntroVr).toContain('VRで見る');
  });
  it('start → open Lv0 (lit, said once, nothing opened for the visitor) → Lv0 opened → press VR → VR starts: the bar and the outlines go', () => {
    vi.useFakeTimers();
    try {
      const f = fakeDoc(), audio = { play: vi.fn() }; let open = null;
      const it = createTutorialIntro({ doc: f.doc, audio, getOpenSample: () => open });
      it.start();
      expect(it.phase).toBe('openLv0'); expect(f.bar()).toBeTruthy(); expect(f.bar().dataset.tutPhase).toBe('openLv0');
      expect(f.bar().children[0].textContent).toBe(I18N.ja.tutIntroLv0Off);
      expect(f.byId['sample-demo-button'].cls.has('tut-hl')).toBe(true); expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(false);
      expect(audio.play).toHaveBeenCalledWith(['intro1']);
      vi.advanceTimersByTime(2000); expect(audio.play).toHaveBeenCalledTimes(1); // said once
      f.doc.dispatchEvent(Object.assign(new Event('vrl-event-sample-open'), { detail: { id: 'sample3' } })); expect(it.phase).toBe('openLv0'); // other data: still Lv0 first
      open = 'sample4'; f.doc.dispatchEvent(Object.assign(new Event('vrl-event-sample-open'), { detail: { id: 'sample4' } }));
      expect(it.phase).toBe('pressVr'); expect(audio.play).toHaveBeenLastCalledWith(['intro2']);
      expect(f.byId['sample-demo-button'].cls.has('tut-hl')).toBe(false); expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(true);
      f.doc.dispatchEvent(Object.assign(new Event('vrl-tut-signal'), { detail: { kind: 'vr-start' } }));
      expect(it.active).toBe(false); expect(f.bar()).toBeNull(); expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(false);
      it.start(); expect(it.phase).toBe('pressVr'); // started again with Lv0 already open: straight to the VR button
      f.bar().children[1].onclick(); expect(it.active).toBe(false); // 閉じる
    } finally { vi.useRealTimers(); }
  });
  it('wiring: the start button sits before 練習データ, only on VR devices, and switches the tutorial on (static)', async () => {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../../docs/tutorial-ui.js', import.meta.url), 'utf8');
    expect(ui).toContain("b.id='tutorial-start-button'");
    expect(ui).toContain("const at=document.getElementById('vr-view-button');"); // the top bar, just before 「VRで見る」
    expect(ui).toContain("b.onclick=()=>{if(settings.get('tutorialMode')!==true)settings.set('tutorialMode',true);sync();continueTutorial();intro.start()};");
    expect(ui).toContain('detectVrSupport().then(ok=>{vr=ok;showRows(ok);if(ok)mountCta();sync()});');
    expect(I18N.ja.tutCta).toBe('チュートリアルを始める');
  });
});
