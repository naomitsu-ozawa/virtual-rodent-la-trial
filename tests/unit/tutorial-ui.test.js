import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizeTutorialSettings, SETTINGS_DEFAULTS } from '../../docs/app-settings.js';
import { tutorialSignalsOn, tutorialUiActive, getTutorialEngine, resetTutorialAll, isPracticeSample, detectVrSupport, _resetTutorialEngineForTest, introPhase, introTargets, introTextKey, createTutorialIntro, sampleReady, restartTutorial, forgetLegacyProgress, preparePanelShown } from '../../docs/tutorial-ui.js';
import { createTutorialEngine } from '../../docs/tutorial-engine.js';
import { TUTORIAL_MISSIONS } from '../../docs/tutorial-data.js';
import { EVENT_LEVELS } from '../../docs/event-mode.js';
import { I18N } from '../../docs/i18n.js';

const mk = () => createTutorialEngine({ arAvailable: false }); // no AR step: AR support changes nothing

describe('tutorial settings', () => {
  it('defaults: off, voice F1', () => {
    expect(SETTINGS_DEFAULTS.tutorialMode).toBe(false);
    expect(SETTINGS_DEFAULTS.tutorialVoice).toBe('F1');
  });
  it('sanitize: only true switches on; voice F1 / M1 / off, anything else F1', () => {
    expect(sanitizeTutorialSettings({ tutorialMode: 'yes', tutorialVoice: 'X' })).toEqual({ tutorialMode: false, tutorialVoice: 'F1' });
    expect(sanitizeTutorialSettings({ tutorialMode: true, tutorialVoice: 'M1' })).toEqual({ tutorialMode: true, tutorialVoice: 'M1' });
    expect(sanitizeTutorialSettings({ tutorialVoice: 'off' }).tutorialVoice).toBe('off');
  });
  it('i18n has the switch and voice keys in both languages', () => {
    for (const l of ['ja', 'en']) for (const k of ['setTutorial', 'setTutorialNote', 'tutVoiceF1', 'tutVoiceM1', 'tutVoiceOff', 'tutVoiceTitle', 'tutVoicePick', 'tutVoiceCredit', 'tutVoiceCreditF1', 'tutVoiceCreditM1']) expect(I18N[l][k], l + k).toBeTruthy();
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

describe('Lv0 card: starts the tutorial from ステップ1 every time; nothing is resumed', () => {
  const eng = () => createTutorialEngine({ arAvailable: false });
  it('restartTutorial (what the card calls): mid-mission, finished or everything skipped, it always ends on ステップ1, page 1, nothing done', () => {
    const e = eng(); e.start('controls'); e.next(); e.next(); e.start('grip'); e.next();
    expect(restartTutorial(e)).toEqual({ action: 'start', id: 'controls' }); expect(e.getState()).toMatchObject({ mission: 'controls', step: 0, finished: false, done: {} });
    e.skipAll(); expect(restartTutorial(e)).toEqual({ action: 'start', id: 'controls' }); expect(e.getState()).toMatchObject({ mission: 'controls', step: 0, skipAll: false, done: {} });
    expect(e.isUnlocked('grip')).toBe(false);
  });
  it('no resume and no jump: continueTutorial does not exist; the 2D チュートリアル panel (list, step card, 次へ / スキップ / 最初から buttons) is gone altogether', async () => {
    const ui = await import('../../docs/tutorial-ui.js');
    expect(ui.continueTutorial).toBeUndefined();
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../docs/tutorial-ui.js', import.meta.url), 'utf8').split('\n').filter(l => !l.startsWith('//')).join('\n');
    expect(src).not.toMatch(/tut-list|tut-row|data-tut-start|dataset\.tutStart|dataset\.tutMission|startMission|continueTutorial|panelModel|tutorial-panel|tut-panel|tut-card|tut-count|tut-reset|tut-skip|tut-next|tut-prev/);
    expect(Object.keys(ui)).not.toContain('panelModel');
    const vr = readFileSync(new URL('../../docs/tutorial-vr.js', import.meta.url), 'utf8');
    expect(vr).not.toMatch(/continueTutorial\(/);
  });
  it('wiring: only Lv0 and only while the tutorial UI is live; the switch is never turned on by the card', async () => {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../../docs/event-mode-ui.js', import.meta.url), 'utf8');
    expect(ui).toContain("if(lv.id==='lv0'&&tutorialUiActive()){try{restartTutorial()}");
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
  it('the VR board goes through resetTutorialAll (the 2D 最初から button is gone), and nothing else calls engine.reset / resetUserState directly', async () => {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../../docs/tutorial-ui.js', import.meta.url), 'utf8'), vr = readFileSync(new URL('../../docs/tutorial-vr.js', import.meta.url), 'utf8');
    expect(ui).not.toMatch(/getTutorialEngine\(\)\.reset\(\)/); expect(ui).not.toContain('resetTutorialAll({resetUserState})'); // the 2D 最初から button is gone, only the VR board resets
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
    expect(introPhase('sample4', true)).toBe('pressVr');
    expect(introPhase('sample4', false)).toBe('loading'); // chosen but not READY yet: wait
    for (const o of [undefined, null, 'sample1', 'mine']) for (const r of [true, false]) expect(introPhase(o, r)).toBe('openLv0');
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
    expect(introTargets('loading', b.doc)).toEqual([]); expect(introTextKey('loading', b.doc)).toBe('tutIntroLoading'); // nothing is lit while the data loads
    expect(introTargets(null, b.doc)).toEqual([]);
    expect(I18N.ja.tutIntroLv0Off).toContain('練習データ'); expect(I18N.ja.tutIntroVr).toContain('VRで見る');
  });
  it('start → open Lv0 (lit, said once, nothing opened for the visitor) → Lv0 opened → press VR → VR starts: the bar and the outlines go', () => {
    vi.useFakeTimers();
    try {
      const f = fakeDoc(), audio = { play: vi.fn() }; let open = null;
      const it = createTutorialIntro({ doc: f.doc, audio, getOpenSample: () => open, getReady: () => true });
      it.start();
      expect(it.phase).toBe('openLv0'); expect(f.bar()).toBeTruthy(); expect(f.bar().dataset.tutPhase).toBe('openLv0');
      expect(f.bar().children[0].textContent).toBe(I18N.ja.tutIntroLv0Off);
      expect(f.byId['sample-demo-button'].cls.has('tut-hl')).toBe(true); expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(false);
      expect(audio.play).toHaveBeenCalledWith(['intro1']);
      vi.advanceTimersByTime(2000); expect(audio.play).toHaveBeenCalledTimes(1); // said once
      f.doc.dispatchEvent(Object.assign(new Event('vrl-event-sample-open'), { detail: { id: 'sample3' } })); expect(it.phase).toBe('openLv0'); // other data: still Lv0 first
      open = 'sample4'; f.doc.dispatchEvent(Object.assign(new Event('vrl-event-sample-open'), { detail: { id: 'sample4' } }));
      expect(it.phase).toBe('pressVr'); expect(audio.play).toHaveBeenLastCalledWith(['intro4']); // both buttons (the AR button is there)
      expect(f.byId['sample-demo-button'].cls.has('tut-hl')).toBe(false); expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(true);
      f.doc.dispatchEvent(Object.assign(new Event('vrl-tut-signal'), { detail: { kind: 'vr-start' } }));
      expect(it.active).toBe(false); expect(f.bar()).toBeNull(); expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(false);
      it.start(); expect(it.phase).toBe('pressVr'); // started again with Lv0 already open: straight to the VR button
      expect(f.bar().hidden).toBe(true); expect(f.bar().children.length).toBe(1); // never shown, no 閉じる button
      it.stop(); expect(it.active).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('VR / AR guidance waits for the volume: chosen but not ready = wait text, nothing lit, nothing said; ready = the VR button, said once', () => {
    vi.useFakeTimers();
    try {
      const f = fakeDoc({ job: false }), audio = { play: vi.fn() }; let open = null, ready = false; // the progress modal is hidden (its delay) yet the data is NOT ready
      const it = createTutorialIntro({ doc: f.doc, audio, getOpenSample: () => open, getReady: () => ready });
      it.start(); expect(it.phase).toBe('openLv0'); audio.play.mockClear();
      open = 'sample4'; f.doc.dispatchEvent(Object.assign(new Event('vrl-event-sample-open'), { detail: { id: 'sample4' } }));
      expect(it.phase).toBe('loading'); expect(f.bar().children[0].textContent).toBe(I18N.ja.tutIntroLoading); expect(I18N.ja.tutIntroLoading).toContain('お待ちください');
      expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(false); expect(f.byId['ar-view-button'].cls.has('tut-hl')).toBe(false); expect(audio.play).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5000); expect(it.phase).toBe('loading'); expect(audio.play).not.toHaveBeenCalled(); // however long it takes
      ready = true; vi.advanceTimersByTime(600); // the next tick notices (no event needed)
      expect(it.phase).toBe('pressVr'); expect(f.bar().children[0].textContent).toBe(I18N.ja.tutIntroVr);
      expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(true); expect(audio.play).toHaveBeenCalledTimes(1); expect(audio.play).toHaveBeenCalledWith(['intro4']);
      ready = false; open = 'sample4'; f.doc.dispatchEvent(Object.assign(new Event('vrl-event-sample-open'), { detail: { id: 'sample4' } })); // the data is opened again: back to waiting
      expect(it.phase).toBe('loading'); expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(false);
      it.stop();
    } finally { vi.useRealTimers(); }
  });
  it('sampleReady reads data-load.js\'s flag: only a true flag is ready', () => {
    expect(sampleReady({})).toBe(false); expect(sampleReady({ __vrlVolumeReady: false })).toBe(false); expect(sampleReady({ __vrlVolumeReady: 1 })).toBe(false); expect(sampleReady({ __vrlVolumeReady: true })).toBe(true);
  });
  it('the flag is set false when a series starts / a dataset is chosen and true only as the last step of selectSeries (static)', async () => {
    const { readFileSync } = await import('node:fs');
    const dl = readFileSync(new URL('../../docs/data-load.js', import.meta.url), 'utf8'), app = readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8');
    expect(app).toMatch(/function setOpenSample\(id\)\{[^}]*globalThis\.__vrlVolumeReady=false/);
    const sel = dl.slice(dl.indexOf('export async function selectSeries'), dl.indexOf('export function openSourceBackedVolume'));
    expect(sel.indexOf('__vrlVolumeReady=false')).toBeGreaterThan(0); expect(sel.indexOf('__vrlVolumeReady=false')).toBeLessThan(sel.indexOf('await decode'));
    expect(sel.indexOf('__vrlVolumeReady=true')).toBeGreaterThan(sel.indexOf('renderAll()')); expect(sel.indexOf('__vrlVolumeReady=true')).toBeGreaterThan(sel.indexOf('activateMedicalVolume'));
    expect(sel.indexOf('__vrlVolumeReady=true')).toBeLessThan(sel.indexOf('}catch(e){')); // never on the failure path
  });
  it('wiring: the start button sits before 練習データ, only on VR devices, and switches the tutorial on (static)', async () => {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../../docs/tutorial-ui.js', import.meta.url), 'utf8');
    expect(ui).toContain("b.id='tutorial-start-button'");
    expect(ui).toContain("const at=document.getElementById('vr-view-button');"); // the top bar, just before 「VRで見る」
    expect(ui).toContain("const begin=()=>{if(settings.get('tutorialMode')!==true)settings.set('tutorialMode',true);sync();restartTutorial();intro.start()};"); // every start is from ステップ1: nothing is remembered
    expect(ui).toContain('b.onclick=()=>chooseVoice(begin);'); // the voice is chosen first
    // the dialog: 女性 / 男性 buttons, each says 「私が案内します」 in its own voice on hover / focus, a press saves the voice and starts; × (the first focus) closes silently; the credits are shown
    expect(ui).toContain("for(const v of ['F1','M1'])"); expect(ui).toContain("settings.set('tutorialVoice',v);d._onPick?.()");
    expect(ui).toContain("b.addEventListener('pointerenter',say);b.addEventListener('focus',say);"); expect(ui).toContain('pickAudio.play([TUT_VOICE_PICK.audio])');
    expect(ui).toContain('x.autofocus=true;'); expect(ui).toContain("el('div','','tutVoiceCreditF1'),el('div','','tutVoiceCreditM1')");
    expect(ui).not.toMatch(/localStorage\.(set|get)Item/); // the tutorial saves nothing and reads nothing (a legacy key is only removed)
    expect(ui).toContain('detectVrSupport().then(ok=>{vr=ok;showRows(ok);if(ok)mountCta();sync()});');
    expect(I18N.ja.tutCta).toBe('チュートリアルを始める');
  });
});

describe('nothing is remembered', () => {
  it('restartTutorial: every start is from ステップ1, whatever this page did before; no storage is touched', () => {
    const calls = []; const keep = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => { calls.push(['get', k]); return JSON.stringify({ v: 1, done: { controls: true, grip: true }, skipAll: true, last: 'grip' }); }, setItem: k => calls.push(['set', k]), removeItem: k => calls.push(['remove', k]) } });
    try {
      const e = createTutorialEngine({ arAvailable: false });
      expect(e.listMissions().map(m => m.status)).toEqual(['available', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked']); // the stale value is ignored
      e.skipMission('controls'); e.start('grip');
      expect(restartTutorial(e)).toEqual({ action: 'start', id: 'controls' });
      expect(e.getState()).toMatchObject({ mission: 'controls', step: 0, finished: false, done: {} });
      expect(calls).toEqual([]);
    } finally { if (keep) Object.defineProperty(globalThis, 'localStorage', keep); else delete globalThis.localStorage; }
  });
  it('forgetLegacyProgress removes the old key (once, guarded) and never throws', () => {
    const removed = []; forgetLegacyProgress({ removeItem: k => removed.push(k) }); expect(removed).toEqual(['vrl.tutorial.v1']);
    expect(() => forgetLegacyProgress({ removeItem() { throw new Error('x'); } })).not.toThrow(); expect(() => forgetLegacyProgress(null)).not.toThrow();
  });
});

describe('the preparation panel phase', () => {
  const panel = (o = {}) => { const start = { disabled: false, hidden: false, closest: () => null, ...o.start }; const p = { style: { display: '', ...o.style }, querySelector: s => (s === '.start' ? start : null) }; return { getElementById: id => (id === 'vr-prepare-panel' ? p : null), start }; };
  it('announced only while its start button is there, shown and ENABLED; a failed / unfinished preparation (button disabled) or a hidden panel is not announced', () => {
    expect(preparePanelShown(panel())).toBe(true);
    expect(preparePanelShown(panel({ start: { disabled: true } }))).toBe(false); // the preparation failed (or is still running)
    expect(preparePanelShown(panel({ style: { display: 'none' } }))).toBe(false); // the page's progress modal is up instead
    expect(preparePanelShown({ getElementById: () => null })).toBe(false); expect(preparePanelShown(null)).toBe(false);
    expect(introPhase('sample4', true, true)).toBe('startVr'); expect(introPhase('sample4', true, false)).toBe('pressVr'); expect(introPhase('sample4', false, true)).toBe('startVr'); // the panel's own start button wins over the (busy) VR button expect(introPhase('sample3', true, true)).toBe('openLv0');
    const d = panel({ start: { disabled: true } }); d.byId = {}; expect(introTargets('startVr', { getElementById: id => d.getElementById(id), querySelector: () => null })).toEqual([]);
    const ok = panel(); expect(introTargets('startVr', { getElementById: id => ok.getElementById(id), querySelector: () => null })).toEqual([ok.start]);
  });
});

// the page is done loading only when everything is quiet; VR and AR on equal terms; the way out; Lv1-Lv3
import { createReadyGate, pageBusy, xrChecked, READY_QUIET_MS, LV_SAMPLES } from '../../docs/tutorial-ui.js';
describe('the ready gate: guidance after the REAL end of loading', () => {
  const mkGate = o => { let t = 0; const st = { vol: true, busy: false, btn: true, ...o }; const g = createReadyGate({ now: () => t, volumeReady: () => st.vol, busy: () => st.busy, buttonsOk: () => st.btn }); return { g, st, at: v => { t = v; return g.ready(); } }; };
  it('volume ready alone is not enough: a job (the bundled project\'s filters) running or its dialog shown, a busy / missing VR button or an unfinished AR check keep it closed', () => {
    const m = mkGate(); expect(m.at(0)).toBe(false); expect(m.at(READY_QUIET_MS - 1)).toBe(false); expect(m.at(READY_QUIET_MS)).toBe(true); // all quiet for the quiet time: open
    m.st.busy = true; expect(m.at(READY_QUIET_MS + 10)).toBe(false); // the job after "ready" (see the timeline: ready at 19.0 s, 「フィルターを適用中…」 from 19.3 s to 122 s)
    m.st.busy = false; expect(m.at(READY_QUIET_MS + 20)).toBe(false); expect(m.at(READY_QUIET_MS * 2 + 19)).toBe(false); expect(m.at(READY_QUIET_MS * 2 + 20)).toBe(true); // the quiet time starts again after the job
    m.st.btn = false; expect(m.at(10000)).toBe(false); m.st.btn = true; expect(m.at(10001)).toBe(false); expect(m.at(10001 + READY_QUIET_MS)).toBe(true);
    m.st.vol = false; expect(m.at(20000)).toBe(false);
  });
  it('a gap between two jobs shorter than the quiet time does not open it (jobs chain)', () => {
    const m = mkGate(); m.at(0); expect(m.at(1000)).toBe(false); m.st.busy = true; m.at(1100); m.st.busy = false; expect(m.at(1200)).toBe(false); expect(m.at(2500)).toBe(false); m.st.busy = true; m.at(2600); m.st.busy = false; expect(m.at(2700)).toBe(false); expect(m.at(2700 + READY_QUIET_MS)).toBe(true);
  });
  it('pageBusy reads the progress modal state (active OR visible); xrChecked only a true flag', () => {
    expect(pageBusy({ __vrlBusyModal: () => ({ active: true, visible: false }) })).toBe(true); expect(pageBusy({ __vrlBusyModal: () => ({ active: false, visible: true }) })).toBe(true);
    expect(pageBusy({ __vrlBusyModal: () => ({ active: false, visible: false }) })).toBe(false); expect(pageBusy({})).toBe(false); expect(pageBusy({ __vrlBusyModal: () => { throw new Error('x'); } })).toBe(false);
    expect(xrChecked({})).toBe(false); expect(xrChecked({ __vrlXrChecked: true })).toBe(true); expect(xrChecked({ __vrlXrChecked: 1 })).toBe(false);
  });
  it('the intro uses the gate by default: a data set whose volume is ready is announced only after the quiet time with the page idle; a busy page keeps the wait text', () => {
    vi.useFakeTimers(); const keepB = globalThis.__vrlBusyModal, keepR = globalThis.__vrlVolumeReady, keepX = globalThis.__vrlXrChecked, keepN = performance.now.bind(performance);
    try {
      let busy = false, t = 0; vi.spyOn(performance, 'now').mockImplementation(() => t);
      globalThis.__vrlBusyModal = () => ({ active: busy, visible: false }); globalThis.__vrlVolumeReady = true; globalThis.__vrlXrChecked = true;
      const f = fakeDoc({ ar: true, job: false }), audio = { play: vi.fn() }; let open = 'sample4';
      const it = createTutorialIntro({ doc: f.doc, audio, getOpenSample: () => open }); it.start(); expect(it.phase).toBe('loading');
      for (let i = 0; i < 2; i++) { t += 500; vi.advanceTimersByTime(500); } expect(it.phase).toBe('loading'); // 1.0 s of quiet: not yet
      t += 600; vi.advanceTimersByTime(500); expect(it.phase).toBe('pressVr'); expect(audio.play).toHaveBeenLastCalledWith(['intro4']);
      busy = true; t += 500; vi.advanceTimersByTime(500); expect(it.phase).toBe('loading'); // a job started (e.g. the project's filters): back to waiting
      globalThis.__vrlXrChecked = false; busy = false; t += 5000; vi.advanceTimersByTime(500); expect(it.phase).toBe('loading'); // the AR check has not answered: no wording yet
      it.stop();
    } finally { vi.useRealTimers(); vi.restoreAllMocks(); globalThis.__vrlBusyModal = keepB; globalThis.__vrlVolumeReady = keepR; globalThis.__vrlXrChecked = keepX; }
  });
});
describe('VR and AR on equal terms', () => {
  it('both buttons there: 「VRで見る」か「ARで見る」, both lit, the voice names both (intro4); VR only: the old wording and voice (intro2)', () => {
    const f = fakeDoc({ ar: true }); expect(introTextKey('pressVr', f.doc)).toBe('tutIntroVr'); expect(I18N.ja.tutIntroVr).toBe('「VRで見る」か「ARで見る」を押しましょう'); expect(I18N.en.tutIntroVr).toBe('Press “View in VR” or “View in AR”');
    expect(introTargets('pressVr', f.doc)).toEqual([f.byId['vr-view-button'], f.byId['ar-view-button']]);
    const v = fakeDoc({ ar: false }); expect(introTextKey('pressVr', v.doc)).toBe('tutIntroVrOnly'); expect(introTargets('pressVr', v.doc)).toEqual([v.byId['vr-view-button']]);
    vi.useFakeTimers(); try {
      for (const [ar, id] of [[true, 'intro4'], [false, 'intro2']]) { const d = fakeDoc({ ar }), audio = { play: vi.fn() }; const it = createTutorialIntro({ doc: d.doc, audio, getOpenSample: () => 'sample4', getReady: () => true }); it.start(); expect(audio.play).toHaveBeenCalledWith([id]); it.stop(); }
    } finally { vi.useRealTimers(); }
  });
});
describe('after the last ステップ: Lv1-Lv3 on the page', () => {
  it('LV_SAMPLES = the Lv1-Lv3 data (sample3 / sample2 / sample1); phases of the levels mode', () => {
    expect(LV_SAMPLES).toEqual(['sample3', 'sample2', 'sample1']);
    expect(introPhase('sample4', true, false, 'levels')).toBe('chooseLv'); expect(introPhase(undefined, true, false, 'levels')).toBe('chooseLv'); // Lv0 / nothing is not what is asked for
    for (const s of LV_SAMPLES) { expect(introPhase(s, false, false, 'levels'), s).toBe('loading'); expect(introPhase(s, true, false, 'levels'), s).toBe('pressVr'); expect(introPhase(s, true, true, 'levels'), s).toBe('startVr'); }
    expect(introPhase('sample3', true, false, 'lv0')).toBe('openLv0'); // the first guidance is unchanged
  });
  it('what is lit: the Lv1-Lv3 cards when 体験会 shows them, else 練習データ and its three entries; the words for each', () => {
    const f = fakeDoc(); const cards = ['lv1', 'lv2', 'lv3'].map(id => { const c = f.doc.createElement('button'); f.bySel[`[data-event-level="${id}"]`] = c; return c; });
    expect(introTargets('chooseLv', f.doc)).toEqual(cards); expect(introTextKey('chooseLv', f.doc)).toBe('tutIntroLv123');
    const g = fakeDoc(); const ent = ['sample3', 'sample2', 'sample1'].map(id => { const c = g.doc.createElement('button'); g.bySel[`[data-sample-set="${id}"]`] = c; return c; });
    expect(introTargets('chooseLv', g.doc)).toEqual([g.byId['sample-demo-button'], ...ent]); expect(introTextKey('chooseLv', g.doc)).toBe('tutIntroLv123Off'); // 体験会 off: the practice-data chooser
    expect(I18N.ja.tutIntroLv123).toBe('次は Lv1〜Lv3 のカードから選びましょう'); expect(I18N.ja.tutIntroLv123Off).toMatch(/練習データ.*マウス頭部.*マウス腹部.*ラット腹部/);
  });
  it('startLevels: choose (lit, said after the closing clip) -> chosen: wait -> ready: VR / AR -> a session starts: the guidance is over; Lv1-Lv3 get no tutorial wording', () => {
    vi.useFakeTimers();
    try {
      const f = fakeDoc({ ar: true }), audio = { play: vi.fn() }; let open = 'sample4', ready = false; const cards = ['lv1', 'lv2', 'lv3'].map(id => { const c = f.doc.createElement('button'); f.bySel[`[data-event-level="${id}"]`] = c; return c; });
      const it = createTutorialIntro({ doc: f.doc, audio, getOpenSample: () => open, getReady: () => ready, levelsVoiceDelayMs: 3500 }); it.startLevels();
      expect(it.phase).toBe('chooseLv'); expect(it.mode).toBe('levels'); expect(f.bar().dataset.tutMode).toBe('levels'); expect(cards.every(c => c.cls.has('tut-hl'))).toBe(true); expect(f.bar().children[0].textContent).toBe(I18N.ja.tutIntroLv123);
      expect(audio.play).not.toHaveBeenCalled(); vi.advanceTimersByTime(3400); expect(audio.play).not.toHaveBeenCalled(); vi.advanceTimersByTime(200); expect(audio.play).toHaveBeenCalledWith(['intro5']); // after the 「すべてクリアです」 clip
      open = 'sample3'; f.doc.dispatchEvent(Object.assign(new Event('vrl-event-sample-open'), { detail: { id: 'sample3' } })); expect(it.phase).toBe('loading'); expect(cards.some(c => c.cls.has('tut-hl'))).toBe(false);
      ready = true; vi.advanceTimersByTime(600); expect(it.phase).toBe('pressVr'); expect(audio.play).toHaveBeenLastCalledWith(['intro4']); expect(f.byId['vr-view-button'].cls.has('tut-hl')).toBe(true); expect(f.byId['ar-view-button'].cls.has('tut-hl')).toBe(true);
      f.doc.dispatchEvent(Object.assign(new Event('vrl-tut-signal'), { detail: { kind: 'ar-start' } })); expect(it.active).toBe(false); expect(f.bar()).toBeNull();
      // closing the bar before the voice: nothing is said later
      const it2 = createTutorialIntro({ doc: fakeDoc().doc, audio: { play: vi.fn() }, getOpenSample: () => 'sample4', getReady: () => true }); const a2 = { play: vi.fn() }; it2.startLevels(); it2.stop(); vi.advanceTimersByTime(5000);
    } finally { vi.useRealTimers(); }
  });
  it('wiring (static): the last ステップ cleared (allClear) starts the Lv guidance, only while the tutorial UI is live; the VR board does not create the Lv wording; a VR session of Lv1-Lv3 has no tutorial (the live tutorial runs on sample4 only)', async () => {
    const { readFileSync } = await import('node:fs'); const ui = readFileSync(new URL('../../docs/tutorial-ui.js', import.meta.url), 'utf8'), vv = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8'), app = readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8');
    expect(ui).toContain("getTutorialEngine().subscribe(snap=>{if(snap.feedback==='allClear'&&uiActive&&!snap.backLocked)intro.startLevels()});");
    expect(vv).toContain("const tutLive=tutorialModeOn()&&globalThis.__vrlOpenSample===TUT_SAMPLE;"); // sample1-3: no tutorial board, no entry guidance, no steps
    expect(vv).toContain("emit('session-end');cleanup()"); // the way out's signal
    expect(app).toContain("globalThis.__vrlXrChecked=true"); expect(app).toMatch(/Promise\.all\(\[xrShow\('immersive-vr',vrViewBtn\),xrShow\('immersive-ar',arViewBtn\)\]\)/);
  });
});

// after the VR session the left pane shows the 表示 tab (selectSeries): the Lv cards / the 練習データ button are in the データ tab and were lit but invisible
import { revealTargets, laidOut } from '../../docs/tutorial-ui.js';
describe('the left pane follows the guidance', () => {
  it('laidOut: an element in a hidden tab (offsetParent null) is not; one without offsetParent info (fake DOM) is', () => {
    expect(laidOut({ offsetParent: null })).toBe(false); expect(laidOut({ offsetParent: {} })).toBe(true); expect(laidOut({})).toBe(true); expect(laidOut(null)).toBe(false);
  });
  it('revealTargets: openLv0 / chooseLv with every target hidden -> the データ tab is clicked; visible targets, other phases or no tab -> nothing', () => {
    let clicks = 0; const doc = { querySelector: s => (s === '[data-ipad-drawer-tab="data"]' ? { click: () => clicks++ } : null) };
    const hidden = [{ offsetParent: null }, { offsetParent: null }], shownEl = [{ offsetParent: null }, { offsetParent: {} }];
    expect(revealTargets('chooseLv', hidden, doc)).toBe(true); expect(clicks).toBe(1); expect(revealTargets('openLv0', hidden, doc)).toBe(true); expect(clicks).toBe(2);
    expect(revealTargets('chooseLv', shownEl, doc)).toBe(false); expect(revealTargets('chooseLv', [], doc)).toBe(false); expect(revealTargets('pressVr', hidden, doc)).toBe(false); expect(revealTargets('loading', hidden, doc)).toBe(false); expect(clicks).toBe(2);
    expect(revealTargets('chooseLv', hidden, { querySelector: () => null })).toBe(false); expect(revealTargets('chooseLv', hidden, { querySelector: () => ({ click() { throw new Error('x'); } }) })).toBe(false);
  });
  it('the intro opens the tab and scrolls the first on-screen card to the top once (the paint loop), not every tick', () => {
    vi.useFakeTimers();
    try {
      const f = fakeDoc(); let tabClicks = 0; const cards = ['lv1', 'lv2', 'lv3'].map(id => { const c = f.doc.createElement('button'); c.offsetParent = null; c.scrolls = []; c.scrollIntoView = o => c.scrolls.push(o); f.bySel[`[data-event-level="${id}"]`] = c; return c; });
      f.bySel['[data-ipad-drawer-tab="data"]'] = { click: () => { tabClicks++; for (const c of cards) c.offsetParent = {}; } };
      const it = createTutorialIntro({ doc: f.doc, audio: { play: vi.fn() }, getOpenSample: () => 'sample4', getReady: () => true, levelsVoiceDelayMs: 0 }); it.startLevels();
      expect(tabClicks).toBe(1); // opened at the first paint
      vi.advanceTimersByTime(2000); expect(tabClicks).toBe(1); expect(cards[0].scrolls).toHaveLength(1); expect(cards[0].scrolls[0]).toMatchObject({ block: 'start' }); expect(cards[1].scrolls).toHaveLength(0); // once, the first card, from the top
      it.stop();
    } finally { vi.useRealTimers(); }
  });
});
