import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizeTutorialSettings, SETTINGS_DEFAULTS } from '../../docs/app-settings.js';
import { tutorialSignalsOn, tutorialUiActive, continueTutorial, getTutorialEngine, resetTutorialAll, isPracticeSample, panelModel, detectVrSupport, _resetTutorialEngineForTest } from '../../docs/tutorial-ui.js';
import { createTutorialEngine } from '../../docs/tutorial-engine.js';
import { TUTORIAL_MISSIONS } from '../../docs/tutorial-data.js';
import { EVENT_LEVELS } from '../../docs/event-mode.js';
import { I18N } from '../../docs/i18n.js';

const memProgress = () => { let p = { v: 1, done: {}, skipAll: false, last: null }; return { load: () => JSON.parse(JSON.stringify(p)), save: q => { p = JSON.parse(JSON.stringify(q)); }, clear: () => { p = { v: 1, done: {}, skipAll: false, last: null }; } }; };
const mk = () => createTutorialEngine({ progress: memProgress(), arAvailable: false });

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
  it('idle: m1 available, the rest locked, M7 (no AR) unavailable with a reason; the ステップ numbers are fixed 1..7 (also for the unavailable M7)', () => {
    const m = panelModel(mk());
    expect(m.step).toBeNull();
    expect(m.missions.map(x => x.status)).toEqual(['available', 'locked', 'locked', 'locked', 'locked', 'locked', 'unavailable']);
    expect(m.missions.map(x => x.stepNo)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(m.missions[6].reasonKey).toBe('tutNoAr');
    expect(m.missions[0].canStart).toBe(true);
    expect(m.missions[1].canStart).toBe(false);
  });
  it('carousel n/N while running; finishing m1 by next() gives a check and unlocks m2', () => {
    const e = mk(); e.start('m1');
    let m = panelModel(e);
    expect(m.step).toMatchObject({ n: 1, N: TUTORIAL_MISSIONS[0].steps.length, hasPrev: false, hasNext: true, isLast: false, missionId: 'm1' });
    expect(I18N.ja[m.step.textKey]).toBeTruthy();
    for (let i = 0; i < TUTORIAL_MISSIONS[0].steps.length; i++) e.next();
    m = panelModel(e);
    expect(m.missions[0]).toMatchObject({ status: 'done', mark: 'tutDone' });
    expect(m.missions[1].status).toBe('available');
    expect(m.step.finished).toBe(true);
  });
  it('skipAll opens every available mission and marks them done; reset clears', () => {
    const e = mk(); e.skipAll();
    expect(panelModel(e).missions.filter(x => x.status === 'done').length).toBe(6); // M7 (no AR) is unavailable
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
  it('without a DOM (no XR) AR is marked unavailable', () => {
    const e = getTutorialEngine();
    expect(e.listMissions().find(m => m.id === 'm7').status).toBe('unavailable');
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
  it('nothing done: starts step 1; a mission under way keeps going (not restarted); after finishing it the next one starts', () => {
    const e = eng();
    expect(continueTutorial(e)).toEqual({ action: 'start', id: 'm1' }); expect(e.getState()).toMatchObject({ mission: 'm1', step: 0 });
    e.next(); expect(e.getState().step).toBe(1);
    expect(continueTutorial(e)).toEqual({ action: 'resume', id: 'm1' }); expect(e.getState()).toMatchObject({ mission: 'm1', step: 1 }); // untouched
    for (let i = 0; i < 5; i++) e.next();
    expect(e.getState().finished).toBe(true);
    expect(continueTutorial(e)).toEqual({ action: 'start', id: 'm2' });
  });
  it('after a reload (no mission open) the next not-done step starts; everything done: nothing starts', () => {
    const e2 = eng(); e2.skipMission('m1'); e2.skipMission('m2'); // nothing open (as after a reload), m1 / m2 done
    expect(continueTutorial(e2)).toEqual({ action: 'start', id: 'm3' });
    const all = eng(); all.skipAll();
    expect(continueTutorial(all)).toEqual({ action: 'none', id: null }); expect(all.getState().mission).toBeNull();
  });
  it('the unavailable AR step is skipped (all other steps done, no AR: nothing to start)', () => {
    const e = eng(); for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) e.skipMission(id);
    expect(continueTutorial(e).action).toBe('none');
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
  it('tutorialSignalsOn follows the tutorialMode setting', async () => {
    const settings = globalThis.__vrlSettings, prev = settings.get('tutorialMode');
    try { settings.set('tutorialMode', false); expect(tutorialSignalsOn()).toBe(false); settings.set('tutorialMode', true); expect(tutorialSignalsOn()).toBe(true); } finally { settings.set('tutorialMode', prev); }
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
