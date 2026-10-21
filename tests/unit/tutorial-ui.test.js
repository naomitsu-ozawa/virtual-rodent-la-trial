import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizeTutorialSettings, SETTINGS_DEFAULTS } from '../../docs/app-settings.js';
import { tutorialSignalsOn, syncAnalysisEnv, hasAnalysisNow, getTutorialEngine, resetTutorialAll, isPracticeSample, panelModel, detectVrSupport, _resetTutorialEngineForTest } from '../../docs/tutorial-ui.js';
import { createTutorialEngine } from '../../docs/tutorial-engine.js';
import { TUTORIAL_MISSIONS } from '../../docs/tutorial-data.js';
import { I18N } from '../../docs/i18n.js';

const memProgress = () => { let p = { v: 1, done: {}, skipAll: false, last: null }; return { load: () => JSON.parse(JSON.stringify(p)), save: q => { p = JSON.parse(JSON.stringify(q)); }, clear: () => { p = { v: 1, done: {}, skipAll: false, last: null }; } }; };
const mk = () => createTutorialEngine({ progress: memProgress(), arAvailable: false, hasAnalysis: false });

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
  it('idle: m1 available, the rest locked, M7 (no AR) / M8 (no analysis) unavailable with a reason', () => {
    const m = panelModel(mk());
    expect(m.step).toBeNull();
    expect(m.missions.map(x => x.status)).toEqual(['available', 'locked', 'locked', 'locked', 'locked', 'locked', 'unavailable', 'unavailable']);
    expect(m.missions[6].reasonKey).toBe('tutNoAr');
    expect(m.missions[7].reasonKey).toBe('tutNoAnalysis');
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
    expect(panelModel(e).missions.filter(x => x.status === 'done').length).toBe(6);
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

describe('hasAnalysis follows the data', () => {
  beforeEach(() => _resetTutorialEngineForTest());
  it('hasAnalysisNow / syncAnalysisEnv: false -> true -> false, setEnv only on a change', () => {
    const engine = { setEnv: vi.fn() };
    expect(hasAnalysisNow([])).toBe(false); expect(hasAnalysisNow([{}])).toBe(true); expect(hasAnalysisNow(undefined)).toBe(false);
    expect(syncAnalysisEnv(engine, [{}])).toBe(true); expect(engine.setEnv).toHaveBeenLastCalledWith({ hasAnalysis: true });
    expect(syncAnalysisEnv(engine, [{}, {}])).toBe(false); expect(engine.setEnv).toHaveBeenCalledTimes(1);
    expect(syncAnalysisEnv(engine, [])).toBe(true); expect(engine.setEnv).toHaveBeenLastCalledWith({ hasAnalysis: false });
    expect(syncAnalysisEnv(null, [{}])).toBe(false);
  });
  it('the real engine: M8 (needs analysis) becomes available and unavailable again', () => {
    const e = getTutorialEngine(); e.skipAll(); const m8 = () => e.listMissions().find(m => m.id === 'm8').status;
    expect(m8()).toBe('unavailable'); syncAnalysisEnv(e, [{}]); expect(m8()).not.toBe('unavailable'); syncAnalysisEnv(e, []); expect(m8()).toBe('unavailable');
  });
  it('wired to the series change and to the data-ready point', async () => {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../../docs/tutorial-ui.js', import.meta.url), 'utf8');
    expect(ui).toContain("'vrl-serieschange'"); expect(ui).toContain("'vrl-data-ready'");
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
