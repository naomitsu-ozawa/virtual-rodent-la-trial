import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTutorialEngine } from '../../docs/tutorial-engine.js';
import { TUTORIAL_MISSIONS, TUT_SAMPLE } from '../../docs/tutorial-data.js';
import { buildPage, createTutorialVr, exitSignalAllowed } from '../../docs/tutorial-vr.js';
import { tutorialSignalsOn, tutorialExitSignalOn, getTutorialEngine, _resetTutorialEngineForTest } from '../../docs/tutorial-ui.js';
import { I18N } from '../../docs/i18n.js';

// switching the data in the 'data' ステップ goes on to the way out ('exit'), back is shut, the end of the session counts on any data; the left laser is green in the texts
globalThis.__vrlSettings.set('tutorialMode', true);
globalThis.__vrlOpenSample = TUT_SAMPLE;
const mk = () => createTutorialEngine({ arAvailable: false });
const toData = e => { e.skipAll(); e.reset(); for (const m of TUTORIAL_MISSIONS) { if (m.id === 'data') break; e.start(m.id); e.skipMission(m.id); } e.start('data'); return e; };
const src = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');

describe('engine.dataSwitched', () => {
  it('in the data ステップ: data is done, exit starts, back is shut', () => {
    const e = toData(mk());
    expect(e.getState()).toMatchObject({ mission: 'data', backLocked: false });
    expect(e.dataSwitched()).toBe(true);
    const s = e.getState();
    expect(s).toMatchObject({ mission: 'exit', step: 0, finished: false, backLocked: true }); expect(s.done.data).toBe(true);
    expect(e.pageInfo()).toMatchObject({ hasPrev: false, isLast: true });
    expect(e.prev()).toBe(false); expect(e.start('data')).toBe(false); expect(e.start('menu')).toBe(false);
    expect(e.getState().mission).toBe('exit');
  });
  it('works on the second page and after the data ステップ was cleared; nothing in another ステップ', () => {
    const e = toData(mk()); e.next(); expect(e.dataSwitched()).toBe(true);
    const f = toData(mk()); f.next(); f.next(); expect(f.getState()).toMatchObject({ mission: 'data', finished: true }); expect(f.dataSwitched()).toBe(true); expect(f.getState()).toMatchObject({ mission: 'exit', finished: false });
    const g = mk(); g.start('controls'); expect(g.dataSwitched()).toBe(false); expect(g.getState()).toMatchObject({ mission: 'controls', backLocked: false });
    const h = mk(); expect(h.dataSwitched()).toBe(false);
  });
  it('a second call in exit changes nothing; session-end clears exit (allClear); reset opens everything again', () => {
    const e = toData(mk()); e.dataSwitched(); expect(e.dataSwitched()).toBe(false); expect(e.getState().mission).toBe('exit');
    const seen = []; e.subscribe(s => seen.push(s.feedback)); e.onSignal({ kind: 'session-end' });
    expect(e.getState()).toMatchObject({ mission: 'exit', finished: true, backLocked: true }); expect(seen).toContain('allClear');
    expect(e.prev()).toBe(false); expect(e.pageInfo().hasPrev).toBe(false);
    e.reset(); expect(e.getState().backLocked).toBe(false);
  });
});

describe('the VR board after the switch', () => {
  const setup = () => { delete globalThis.__vrlTutSignalWired; const e = toData(mk()); const doc = new EventTarget(); const vr = createTutorialVr({ engine: e, audio: { play: vi.fn(), stop: vi.fn() }, doc, getInput: () => 'ctrl', entry: false, getImage: () => null }); return { e, vr, doc }; };
  it('the step list / 前へ buttons are disabled and do nothing; the view never shows the list', () => {
    const { e, vr } = setup(); e.dataSwitched();
    const p = vr.page(); expect(p.kind).toBe('step'); const by = id => p.buttons.find(b => b.id === id);
    expect(by('prev').disabled).toBe(true); expect(by('list').disabled).toBe(true);
    expect(vr.act('list')).toBe(false); expect(vr.act('prev')).toBe(false); expect(vr.act('start:menu')).toBe(false); expect(vr.act('reset')).toBe(false);
    expect(vr.page().kind).toBe('step'); expect(e.getState().mission).toBe('exit');
    // before the switch they work
    const b = setup(); expect(b.vr.page().buttons.find(x => x.id === 'list').disabled).toBeFalsy();
  });
  it('the cleared page (allDone) has them disabled too', () => {
    const { e } = setup(); e.dataSwitched(); e.onSignal({ kind: 'session-end' });
    const p = buildPage({ engine: e }); expect(p.kind).toBe('allDone');
    expect(p.buttons.map(b => [b.id, !!b.disabled])).toEqual([['list', true], ['prev', true], ['reset', true]]);
  });
  it('session-end counts on another data in exit only; other signals do not', () => {
    const { e, doc } = setup(); globalThis.__vrlOpenSample = 'sample3';
    try {
      doc.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind: 'session-end' } })); expect(e.getState().mission).toBe('data'); // not in exit yet: ignored
      e.dataSwitched(); doc.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind: 'grab' } })); expect(e.getState().finished).toBe(false);
      doc.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind: 'session-end' } })); expect(e.getState()).toMatchObject({ mission: 'exit', finished: true });
    } finally { globalThis.__vrlOpenSample = TUT_SAMPLE; delete globalThis.__vrlTutSignalWired; }
  });
  it('exitSignalAllowed', () => {
    const e = toData(mk()); expect(exitSignalAllowed(e, { kind: 'session-end' })).toBe(false); e.dataSwitched();
    expect(exitSignalAllowed(e, { kind: 'session-end' })).toBe(true); expect(exitSignalAllowed(e, { kind: 'grab' })).toBe(false); expect(exitSignalAllowed(e, null)).toBe(false);
  });
});

describe('the page side signal gate', () => {
  it('tutorialExitSignalOn: only session-end, only in exit, only with the switch on', () => {
    const e = toData(mk()); const d = { kind: 'session-end' };
    expect(tutorialExitSignalOn(e, d)).toBe(false); e.dataSwitched(); expect(tutorialExitSignalOn(e, d)).toBe(true);
    expect(tutorialExitSignalOn(e, { kind: 'grab' })).toBe(false);
    const s = globalThis.__vrlSettings; s.set('tutorialMode', false); try { expect(tutorialExitSignalOn(e, d)).toBe(false); } finally { s.set('tutorialMode', true); }
  });
  it('the shared engine takes session-end of another data in exit (document event), but not before', () => {
    _resetTutorialEngineForTest(); const hadDoc = 'document' in globalThis; globalThis.document = new EventTarget(); const eng = getTutorialEngine(); // the node test environment has no document: a stand-in
    globalThis.__vrlOpenSample = 'sample2';
    try {
      eng.skipAll(); eng.reset(); for (const m of TUTORIAL_MISSIONS) { if (m.id === 'data') break; eng.start(m.id); eng.skipMission(m.id); } eng.start('data');
      document.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind: 'session-end' } })); expect(eng.getState().mission).toBe('data');
      eng.dataSwitched(); document.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind: 'session-end' } })); expect(eng.getState()).toMatchObject({ mission: 'exit', finished: true });
      expect(tutorialSignalsOn()).toBe(false);
    } finally { globalThis.__vrlOpenSample = TUT_SAMPLE; _resetTutorialEngineForTest(); if (!hadDoc) delete globalThis.document; }
  });
});

describe('vr-view.js wiring (static)', () => {
  const v = src('vr-view.js');
  it('swapData: in the data ステップ the tutorial stays (dataSwitched), later switches keep it, any other ステップ ends it as before', () => {
    const at = v.indexOf("if(tutLive&&!tutEnded&&id!==TUT_SAMPLE){"); expect(at).toBeGreaterThan(0);
    const part = v.slice(at, at + 900);
    expect(part).toMatch(/st\.mission==='data'\?eng\.dataSwitched\(\):!!st\.backLocked/);
    expect(part).toMatch(/else\{tutEnded=true;try\{tutVr\?\.dispose\(\)\}/);
  });
});

describe('the left laser colour in the texts', () => {
  it('no text says the left laser is purple; ja / en / voice script say green', () => {
    expect(I18N.ja.tutCtlS1).toBe('右手の光線はオレンジ、左手は緑。人さし指のトリガーで光線の先を押します');
    expect(I18N.en.tutCtlS1).toBe('The right ray is orange, the left one green. Press with the tip of the ray using the index-finger trigger');
    const c1 = TUTORIAL_MISSIONS[0].steps[0]; expect(c1.audio).toBe('ctl1'); expect(c1.audioText).toBe('みぎてのこうせんはオレンジ、ひだりては、みどりです。ひとさしゆびのトリガーで、こうせんのさきを押します。');
    for (const f of ['i18n.js', 'tutorial-data.js']) expect(src(f)).not.toMatch(/左手は紫|the left one purple|むらさきです/);
  });
});
