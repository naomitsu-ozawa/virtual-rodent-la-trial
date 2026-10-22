// 2D (tutorial-ui.js getTutorialEngine) and VR (tutorial-vr.js getEngine / createTutorialVr) share ONE engine and ONE signal wiring:
// whichever side is first, there is a single engine on globalThis.__vrlTutorialEngine and one 'vrl-tut-signal' reaches it exactly once (no double counting).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTutorialEngine, _resetTutorialEngineForTest } from '../../docs/tutorial-ui.js';
import { getEngine, createTutorialVr } from '../../docs/tutorial-vr.js';
import { TUTORIAL_MISSIONS } from '../../docs/tutorial-data.js';

const SIG0 = TUTORIAL_MISSIONS.find(m => m.steps[0].done).steps[0].done.signal; // ステップ1 (controls) has no signal: the first one waited for
let doc, hadDoc, prevDoc, store;
beforeEach(() => {
  globalThis.__vrlSettings.set('tutorialMode', true); // signals only move the engine while the switch is on
  globalThis.__vrlOpenSample = 'sample4'; // ... and while the tutorial's own data (Lv0) is open
  _resetTutorialEngineForTest();
  hadDoc = 'document' in globalThis; prevDoc = globalThis.document; doc = new EventTarget(); globalThis.document = doc;
  store = {}; globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
});
afterEach(() => {
  globalThis.__vrlSettings.set('tutorialMode', false);
  delete globalThis.__vrlOpenSample;
  _resetTutorialEngineForTest();
  if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document;
  delete globalThis.localStorage;
});
const audio = () => ({ play: vi.fn(), stop: vi.fn() });
const sig = kind => doc.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind } }));

describe('switch off: the page wiring ignores signals', () => {
  it('nothing advances while tutorialMode is off; on again counts as before', () => {
    const e = getTutorialEngine(); const spy = vi.spyOn(e, 'onSignal');
    globalThis.__vrlSettings.set('tutorialMode', false); sig(SIG0); expect(spy).not.toHaveBeenCalled();
    globalThis.__vrlSettings.set('tutorialMode', true); sig(SIG0); expect(spy).toHaveBeenCalledTimes(1);
  });
  it('other data open (another practice level or the visitor\'s own): nothing advances; back on Lv0 it counts again', () => {
    const e = getTutorialEngine(); const spy = vi.spyOn(e, 'onSignal');
    for (const other of ['sample3', 'sample1', 'mine']) { globalThis.__vrlOpenSample = other; sig(SIG0); }
    expect(spy).not.toHaveBeenCalled();
    globalThis.__vrlOpenSample = 'sample4'; sig(SIG0); expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('2D + VR share one tutorial engine and one signal wiring', () => {
  it('2D first: the VR board gets the same engine; one signal is counted once', () => {
    const e2d = getTutorialEngine(); const spy = vi.spyOn(e2d, 'onSignal');
    expect(getEngine()).toBe(e2d);
    const vr = createTutorialVr({ audio: audio(), doc });
    expect(vr.engine).toBe(e2d); expect(globalThis.__vrlTutorialEngine).toBe(e2d);
    sig(SIG0); expect(spy).toHaveBeenCalledTimes(1);
    vr.dispose(); sig(SIG0); expect(spy).toHaveBeenCalledTimes(2); // the page's wiring outlives the VR board
    expect(globalThis.__vrlTutSignalWired).toBe(true);
  });
  it('VR first: the 2D side gets the same engine; one signal is counted once', () => {
    const vr = createTutorialVr({ audio: audio(), doc }); const e = vr.engine; const spy = vi.spyOn(e, 'onSignal');
    expect(globalThis.__vrlTutorialEngine).toBe(e); expect(getTutorialEngine()).toBe(e);
    sig(SIG0); expect(spy).toHaveBeenCalledTimes(1);
    vr.dispose();
  });
  it('two VR boards in a row (session re-entry) still leave one engine and one listener', () => {
    const a = createTutorialVr({ audio: audio(), doc }); const e = a.engine; const spy = vi.spyOn(e, 'onSignal');
    a.dispose(); const b = createTutorialVr({ audio: audio(), doc });
    expect(b.engine).toBe(e); sig(SIG0); expect(spy).toHaveBeenCalledTimes(1); b.dispose();
  });
});
