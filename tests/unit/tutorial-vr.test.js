import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTutorialEngine } from '../../docs/tutorial-engine.js';
import { TUTORIAL_MISSIONS } from '../../docs/tutorial-data.js';
import { buildPage, layoutPage, stepTextKey, stepTexts, tutorialModeOn, createTutorialVr, createTutorialPreview, panelTabs, stepNoLabel, TAB_H, FLASH_MS } from '../../docs/tutorial-vr.js';
import { audioSrc, voiceOf, speechFor, createTutorialAudio, createStepReplay, isFeedbackId } from '../../docs/tutorial-audio.js';

globalThis.__vrlSettings.set('tutorialMode', true); // the signal tests run with the switch on (off = signals are ignored, tested below)
const M1 = TUTORIAL_MISSIONS[0], S0 = M1.steps[0], N1 = M1.steps.length, SIG0 = S0.done.signal;
const mem = () => { let p = { v: 1, done: {}, skipAll: false, last: null }; return { load: () => JSON.parse(JSON.stringify(p)), save: x => { p = JSON.parse(JSON.stringify(x)); }, clear: () => { p = { v: 1, done: {}, skipAll: false, last: null }; } }; };
const eng = o => createTutorialEngine({ progress: mem(), arAvailable: false, ...o });
const fakeAudio = () => { const played = []; const C = function (src) { this.src = src; played.push(src); this.play = () => Promise.resolve(); this.pause = () => {}; }; return { C, played }; };
const mkVr = (o = {}) => { const a = { play: vi.fn(), stop: vi.fn() }; let t = 1000; const doc = new EventTarget(); const e = eng(); const vr = createTutorialVr({ engine: e, audio: a, doc, now: () => t, getInput: () => 'ctrl', ...o }); return { vr, e, a, doc, setT: v => { t = v; }, sig: kind => doc.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind } })) }; };

describe('tutorial-vr page model', () => {
  it('idle engine -> list page, m1 startable, the rest locked', () => {
    const e = eng(), p = buildPage({ engine: e });
    expect(p.kind).toBe('list'); expect(p.missions[0].status).toBe('available'); expect(p.missions[1].status).toBe('locked');
    expect(p.buttons.map(b => b.id)).toEqual(['skipAll', 'reset']);
  });
  it('step page: n/N, marks, buttons, prev disabled on the first step', () => {
    const e = eng(); e.start('m1'); const p = buildPage({ engine: e });
    expect(p.kind).toBe('step'); expect(p.counter).toBe('1/' + N1); expect(p.marks).toBe(['●', ...Array(N1 - 1).fill('○')].join(' '));
    expect(p.buttons.map(b => b.id)).toEqual(['prev', 'next', 'skipMission', 'skipAll', 'list', 'reset']); expect(p.buttons[0].disabled).toBe(true);
    e.onSignal({ kind: SIG0 }); const q = buildPage({ engine: e });
    expect(q.counter).toBe('2/' + N1); expect(q.marks.startsWith('✓ ●')).toBe(true); expect(q.buttons[0].disabled).toBe(false);
  });
  it('last step: the next button finishes; finished -> missionDone with a next-mission button', () => {
    const e = eng(); e.skipMission('m1'); e.start('m2'); e.next(); e.next();
    expect(buildPage({ engine: e }).buttons[1].label).toBe('完了'); e.next();
    const p = buildPage({ engine: e }); expect(p.kind).toBe('missionDone'); expect(p.buttons[0].id).toBe('start:m3');
  });
  it('allDone when every required mission is done', () => {
    const e = eng(); e.start('m1'); e.skipAll(); expect(buildPage({ engine: e }).kind).toBe('allDone');
  });
  it('list view on demand, even mid-mission; reset arm changes the label', () => {
    const e = eng(); e.start('m1');
    expect(buildPage({ engine: e, view: 'list' }).kind).toBe('list');
    expect(buildPage({ engine: e, resetArmed: true }).buttons.at(-1).warn).toBe(true);
  });
  it('hint selection by input source; English only as a subtitle', () => {
    const s = M1.steps.find(x => x.hint);
    expect(stepTextKey(s, 'ctrl')).toBe(s.hint.ctrl); expect(stepTextKey(s, 'hand')).toBe(s.hint.hand);
    expect(stepTextKey(M1.steps.find(x => !x.hint), 'hand')).toBe(M1.steps.find(x => !x.hint).text);
    const ja = stepTexts(S0.text, 'ja'), en = stepTexts(S0.text, 'en');
    expect(ja.sub).toBe(''); expect(en.text).toBe(ja.text); expect(en.sub).not.toBe('');
  });
  it('the page text follows the input source', () => {
    const e = eng(); e.start('m1'); for (let i = 0; i < M1.steps.findIndex(x => x.hint); i++) e.next();
    expect(buildPage({ engine: e, input: 'ctrl' }).text).not.toBe(buildPage({ engine: e, input: 'hand' }).text);
  });
  it('layout: every button has an action and fits the 820 wide board; flash adds a mark', () => {
    const e = eng(); e.start('m1'); const act = vi.fn(), ms = (t, z) => t.length * z * 0.6;
    const w = layoutPage(buildPage({ engine: e, lang: 'en' }), { measure: ms, act, flash: { mark: '✓', text: 'x' } });
    const bs = w.filter(x => !x.type); expect(bs.length).toBe(6);
    for (const b of bs) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(820); expect(b.y + b.h).toBeLessThanOrEqual(560); }
    bs[1].action(); expect(act).toHaveBeenCalledWith('next');
    expect(w.some(x => x.text === '✓')).toBe(true);
    const lw = layoutPage(buildPage({ engine: eng() }), { measure: ms, act }).filter(x => !x.type);
    expect(lw.length).toBe(9); expect(lw.filter(b => b.disabled).length).toBe(6); // 7 steps + 全部スキップ / 最初から; m1 open, five locked, M7 (no AR) unavailable
  });
});

describe('tutorial-vr controller', () => {
  it('tutorialModeOn: only the tutorialMode setting turns it on (no URL parameter), default off', () => {
    globalThis.__vrlSettings.set('tutorialMode', false); // the global default api is read when none is passed
    try {
    expect(tutorialModeOn({ get: () => false })).toBe(false); expect(tutorialModeOn({ get: k => k === 'tutorialMode' ? true : undefined })).toBe(true);
    expect(tutorialModeOn({ get: () => 'yes' })).toBe(false); expect(tutorialModeOn({ get: () => { throw new Error('x'); } })).toBe(false); expect(tutorialModeOn(undefined)).toBe(false);
    const loc = globalThis.location; try { globalThis.location = { search: '?tutorial=1' }; expect(tutorialModeOn({ get: () => false })).toBe(false); expect(tutorialModeOn(undefined)).toBe(false); } finally { if (loc === undefined) delete globalThis.location; else globalThis.location = loc; }
      } finally { globalThis.__vrlSettings.set('tutorialMode', true); }
  });
  it('signals from the document drive the engine, speak the step, and flash', () => {
    const { vr, e, a, sig, setT } = mkVr(); e.start('m1'); a.play.mockClear();
    expect(e.getState().step).toBe(0);
    sig(SIG0); expect(e.getState().step).toBe(1);
    expect(a.play).toHaveBeenLastCalledWith(['ok1', M1.steps[1].audio]);
    const k = vr.drawKey(); expect(vr.widgets().some(w => w.text === '✓')).toBe(true);
    setT(1000 + FLASH_MS + 1); vr.update(); expect(vr.drawKey()).not.toBe(k); expect(vr.widgets().some(w => w.text === '✓' && w.size === 96)).toBe(false);
    vr.dispose(); sig(M1.steps[1].done.signal); expect(e.getState().step).toBe(1);
  });
  it('mission clear speaks mclear and shows the mission-done page', () => {
    const { vr, e, a } = mkVr(); e.skipMission('m1'); e.start('m2'); e.onSignal({ kind: 'menu-open' }); e.onSignal({ kind: 'seg-toggle' }); a.play.mockClear(); e.onSignal({ kind: 'menu-close' });
    expect(a.play).toHaveBeenLastCalledWith(['mclear']); expect(vr.page().kind).toBe('missionDone');
    vr.act('start:m3'); expect(e.getState().mission).toBe('m3'); expect(vr.page().kind).toBe('step');
  });
  it('button actions: prev / next / skip / list', () => {
    const { vr, e } = mkVr(); vr.act('start:m1'); vr.act('next'); expect(e.getState().step).toBe(1); vr.act('prev'); expect(e.getState().step).toBe(0);
    vr.act('list'); expect(vr.page().kind).toBe('list'); vr.act('start:m1'); expect(vr.page().kind).toBe('step');
    vr.act('skipMission'); expect(e.isDone('m1')).toBe(true); vr.act('skipAll'); expect(e.getState().skipAll).toBe(true);
  });
  it('reset needs two presses within the guard window', () => {
    const { vr, e, setT } = mkVr(); vr.act('start:m1'); vr.act('skipMission'); vr.act('list');
    expect(vr.act('reset')).toBe(false); expect(e.isDone('m1')).toBe(true); expect(vr.page().buttons.at(-1).warn).toBe(true);
    setT(1000 + 3500); vr.update(); expect(vr.page().buttons.at(-1).warn).toBe(false); // expired: arms again
    expect(vr.act('reset')).toBe(false); setT(1000 + 3600); expect(vr.act('reset')).toBe(true);
    expect(e.isDone('m1')).toBe(false); expect(vr.page().kind).toBe('list');
  });
  it('reset: the practice dataset open -> resetUserState runs; the visitor\'s own data -> it does not (progress is cleared either way)', () => {
    const prev = globalThis.__vrlOpenSample;
    try {
      for (const [open, called] of [['sample4', 1], ['sample1', 1], ['mine', 0], [undefined, 0], [null, 0]]) {
        globalThis.__vrlOpenSample = open;
        const ru = vi.fn(), { vr, e, setT } = mkVr({ resetUserState: ru }); vr.act('start:m1'); vr.act('skipMission'); vr.act('list');
        vr.act('reset'); setT(1000 + 600); vr.act('reset');
        expect(e.isDone('m1'), String(open)).toBe(false); expect(ru, String(open)).toHaveBeenCalledTimes(called);
      }
    } finally { globalThis.__vrlOpenSample = prev; }
  });
  it('a move step re-arms the move tracker each time it is entered (board start, prev, restart)', () => {
    const mt = { reset: vi.fn() }, { vr, e } = mkVr({ moveTracker: mt });
    expect(M1.steps[0].done.signal).toBe('move'); expect(mt.reset).not.toHaveBeenCalled(); // idle: nothing armed
    vr.act('start:m1'); expect(mt.reset).toHaveBeenCalledTimes(1);
    e.next(); expect(mt.reset).toHaveBeenCalledTimes(1); // a non-move step: untouched
    e.prev(); expect(mt.reset).toHaveBeenCalledTimes(2); // back on the move step
    vr.act('start:m1'); expect(mt.reset).toHaveBeenCalledTimes(3); // restarted on the same step
  });
  it('without a tracker (or with a throwing one) nothing breaks', () => {
    const { vr } = mkVr(); expect(() => vr.act('start:m1')).not.toThrow();
    const { vr: v2 } = mkVr({ moveTracker: { reset() { throw new Error('x'); } } }); expect(() => v2.act('start:m1')).not.toThrow();
  });
  it('switch off: the board ignores signals (nothing advances); on again: as before', () => {
    delete globalThis.__vrlTutSignalWired; const { vr, e, sig } = mkVr(); vr.act('start:m1'); // (earlier boards left the page-wired flag on)
    try { globalThis.__vrlSettings.set('tutorialMode', false); sig('move'); expect(e.getState().step).toBe(0); } finally { globalThis.__vrlSettings.set('tutorialMode', true); }
    sig('move'); expect(e.getState().step).toBe(1);
  });
  it('session end: the ✓ feedback the closing signal earned is not cut off; guidance voice is', () => {
    const made = []; const C = function (s) { this.src = s; made.push(this); this.play = () => Promise.resolve(); this.pause = vi.fn(); };
    const audio = createTutorialAudio({ AudioCtor: C }); delete globalThis.__vrlTutSignalWired; const { vr, sig } = mkVr({ audio });
    vr.act('start:m1'); sig('move'); sig('scale'); sig('home'); // the last step done by signal -> mclear
    expect(made.at(-1).src).toContain('/mclear.m4a'); const clip = made.at(-1);
    vr.dispose(); expect(clip.pause).not.toHaveBeenCalled(); expect(made.at(-1)).toBe(clip);
    const g = []; const C2 = function (s) { this.src = s; g.push(this); this.play = () => Promise.resolve(); this.pause = vi.fn(); };
    const a2 = createTutorialAudio({ AudioCtor: C2 }), m2 = mkVr({ audio: a2 }); m2.vr.act('start:m1'); // the step voice (guidance) is playing
    m2.vr.dispose(); expect(g.at(-1).pause).toHaveBeenCalled();
  });
  it('audio settle: kept clip plays out, waiting guidance is dropped, a guidance clip is stopped', () => {
    const made = []; const C = function (s) { this.src = s; made.push(this); this.play = () => Promise.resolve(); this.pause = vi.fn(); };
    const p = createTutorialAudio({ AudioCtor: C }); p.play(['ok1', 'm1s2', 'mclear']);
    expect(p.settle(isFeedbackId)).toBe(true); expect(made[0].pause).not.toHaveBeenCalled();
    made[0].onended(); expect(made.map(x => x.src.split('/').pop().split('?')[0])).toEqual(['ok1.m4a', 'mclear.m4a']); made[1].onended(); expect(made.length).toBe(2);
    p.play(['m1s2']); const g = made.at(-1); expect(p.settle(isFeedbackId)).toBe(false); expect(g.pause).toHaveBeenCalled();
    expect(p.settle(isFeedbackId)).toBe(false); expect(isFeedbackId('ok2') && isFeedbackId('allclear') && !isFeedbackId('m1s2') && !isFeedbackId(undefined)).toBe(true);
  });
  it('replays the step voice after timeoutHint of no progress, once', () => {
    const { vr, a, setT } = mkVr(); vr.act('start:m1'); a.play.mockClear();
    setT(1000 + 19000); vr.update(); expect(a.play).not.toHaveBeenCalled();
    setT(1000 + 21000); vr.update(); expect(a.play).toHaveBeenCalledWith([S0.audio]);
    a.play.mockClear(); setT(1000 + 90000); vr.update(); expect(a.play).not.toHaveBeenCalled();
  });
});

describe('tutorial-audio', () => {
  it('one fixed female voice F1, independent of any setting', () => {
    expect(audioSrc('F1', 'm1s2')).toBe('./tutorial/audio/F1/m1s2.m4a?v=20261022-build643'); expect(audioSrc(undefined, 'ok1')).toBe('./tutorial/audio/F1/ok1.m4a?v=20261022-build643');
    expect(audioSrc('M1', 'ok1')).toBe('./tutorial/audio/F1/ok1.m4a?v=20261022-build643'); expect(audioSrc('off', 'x')).toBeNull(); expect(audioSrc('F1', '')).toBeNull(); expect(voiceOf('M1')).toBe('F1'); expect(voiceOf('off')).toBe('off');
  });
  it('speechFor: feedback then the new step, nothing for a count-only change', () => {
    const e = eng(); let last; e.subscribe(s => { last = s; }); e.start('m1'); let r = speechFor(last, e.currentStep(), '');
    expect(r.ids).toEqual([S0.audio]); e.onSignal({ kind: SIG0 }); r = speechFor(last, e.currentStep(), r.key); expect(r.ids).toEqual(['ok1', M1.steps[1].audio]);
    e.onSignal({ kind: 'nothing' }); expect(speechFor({ ...last, feedbackItem: null }, e.currentStep(), r.key).ids).toEqual([]);
  });
  it('player: error and reject both arriving advance the next clip only once', async () => {
    const made = []; const C = function (s) { this.src = s; made.push(this); this.pause = () => {}; this.play = () => (made.length === 1 ? Promise.reject(new Error('x')) : Promise.resolve()); };
    const p = createTutorialAudio({ AudioCtor: C }); p.play(['a', 'b', 'c']);
    made[0].onerror(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(made.map(x => x.src)).toEqual(['./tutorial/audio/F1/a.m4a?v=20261022-build643', './tutorial/audio/F1/b.m4a?v=20261022-build643']); // b only once (error + reject + a late onended all hit the guard)
    made[0].onended?.();
    expect(made.length).toBe(2);
  });
  it('player: new Audio, sequential, a stop cancels, a failing file is skipped, off plays nothing', async () => {
    const { C, played } = fakeAudio(); const p = createTutorialAudio({ AudioCtor: C });
    expect(p.play(['ok1', 'm1s2'])).toBe(true); expect(played).toEqual(['./tutorial/audio/F1/ok1.m4a?v=20261022-build643']);
    // find the audio object: error -> next
    const first = []; const C2 = function (s) { this.src = s; first.push(this); this.play = () => Promise.resolve(); this.pause = () => {}; };
    const p2 = createTutorialAudio({ AudioCtor: C2 }); p2.play(['a', 'b']); first[0].onerror(); expect(first.map(x => x.src)).toEqual(['./tutorial/audio/F1/a.m4a?v=20261022-build643', './tutorial/audio/F1/b.m4a?v=20261022-build643']);
    p2.play(['c']); first.at(-1).onended(); expect(first.length).toBe(3); p2.stop(); first[2].onended?.(); expect(first.length).toBe(3);
    expect(p.play([])).toBe(false); expect(createTutorialAudio({ getVoice: () => 'off', AudioCtor: C }).play(['x'])).toBe(false); expect(createTutorialAudio({ AudioCtor: undefined }).play(['x'])).toBe(false);
  });
  it('a throwing play() or constructor never escapes', () => {
    const C = function () { this.play = () => { throw new Error('x'); }; this.pause = () => {}; };
    expect(() => createTutorialAudio({ AudioCtor: C }).play(['a', 'b'])).not.toThrow();
    expect(() => createTutorialAudio({ AudioCtor: function () { throw new Error('y'); } }).play(['a'])).not.toThrow();
  });
  it('createStepReplay fires once per quiet period', () => {
    const f = vi.fn(), r = createStepReplay(f); r.reset(0, 100); expect(r.tick(99)).toBe(false); expect(r.tick(100)).toBe(true); expect(r.tick(500)).toBe(false); r.reset(500, 100); expect(r.tick(600)).toBe(true); expect(f).toHaveBeenCalledTimes(2);
    r.reset(0, 0); expect(r.tick(1e9)).toBe(false);
  });
});

describe('vr-view.js hooks (static)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const tv = readFileSync(new URL('../../docs/tutorial-vr.js', import.meta.url), 'utf8');
  const au = readFileSync(new URL('../../docs/tutorial-audio.js', import.meta.url), 'utf8');
  it('the hooks exist and everything is gated on tutVr (null when tutorialMode is off)', () => {
    expect(src).toContain("from './tutorial-vr.js?v=");
    expect(src).toMatch(/tutVr=tutorialModeOn\(\)\?createTutorialVr\(/);
    expect(src).toContain('if(tutVr)return [...tutVr.widgets({W:820,H:560,');
    expect(src).toContain('tutVr.update(performance.now())'); expect(src).toContain('try{tutVr?.dispose()}catch');
    expect(src).toContain('moveTracker:tutMove');
    expect(src).toContain("if(r&&faint)emit('label-show')"); // only the hover card, never the pinned card redrawn on re-entry
    expect(src).toContain("if(!sweepOn)emit('section-add')"); expect(src).toContain("if(!sweepOn)emit('section-toggle')");
    expect(src).toMatch(/begin:\(\)=>\{[^}]*sweepOn=true/); expect(src).toContain('tmp=pl=null;sweepOn=false');
    expect(src).toContain('help.mesh.visible=(settings.help|0)>0||!!tutVr');
    expect(src).toContain('if(bd.help){const i=help.hit(bd.help.uv);if(i>=0){help.press(i);pulse(c)}return}');
    expect(src).toContain('(tutVr?tutVr.drawKey():\'\')');
        for (const l of src.split('\n').filter(x => /tutVr/.test(x) && !/^ let tutVr=null/.test(x))) expect(l, l.slice(0, 80)).toMatch(/tutVr\s*(\?|&&|\)|\|\||\.|;|:)|if\(tutVr\)|\?tutVr|&&tutVr|!!tutVr/);
  });
  it('audio uses new Audio, never fetch; no network in the board module', () => {
    expect(au).toContain('new AudioCtor('); expect(au + tv).not.toMatch(/\bfetch\s*\(/);
    expect(readFileSync(new URL('../../docs/app-settings.js', import.meta.url), 'utf8')).toMatch(/tutorialMode:false/);
  });
});

describe('ステップ numbering in the board', () => {
  it('stepNoLabel: ステップ3 / Step 3', () => {
    expect(stepNoLabel(3, k => ({ tutStepWord: 'ステップ' })[k])).toBe('ステップ3'); expect(stepNoLabel(3, k => ({ tutStepWord: 'Step' })[k])).toBe('Step 3');
  });
  it('the list says ステップN before each name (fixed 1..7, also for the unavailable AR step); a step page title carries it, the page counter is only n/N', () => {
    const p = buildPage({ engine: eng() });
    expect(p.missions.map(m => m.label.match(/^ステップ(\d)/)?.[1])).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(p.missions[6]).toMatchObject({ status: 'unavailable' }); expect(p.missions[6].label).toMatch(/^ステップ7 /);
    const e = eng(); e.skipMission('m1'); e.skipMission('m2'); e.start('m3'); const q = buildPage({ engine: e });
    expect(q.title).toMatch(/^ステップ3 /); expect(q.counter).toBe('1/' + TUTORIAL_MISSIONS[2].steps.length); expect(q.counter).not.toMatch(/ステップ/); expect(q.marks).not.toMatch(/ステップ/);
    e.skipMission(); const d = buildPage({ engine: e });
    expect(d.kind).toBe('missionDone'); expect(d.headline).toBe('ステップ完了'); expect(d.title).toMatch(/^ステップ3 /); expect(d.buttons[0].label).toMatch(/ステップ4 /);
  });
});

describe('手順一覧 | 詳細 tabs under the help board', () => {
  it('two buttons in the strip below the 560 px page, the shown one lit; pressing the other switches', () => {
    const act = vi.fn(), t = panelTabs('detail', { act });
    expect(t.map(b => b.label)).toEqual(['手順一覧', '詳細']); expect(t.map(b => !!b.on)).toEqual([false, true]);
    for (const b of t) { expect(b.y).toBeGreaterThanOrEqual(560); expect(b.y + b.h).toBeLessThanOrEqual(560 + TAB_H); expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(820); }
    t[0].action(); expect(act).toHaveBeenLastCalledWith('list'); t[1].action(); expect(act).toHaveBeenLastCalledWith('detail');
    expect(panelTabs('list').map(b => !!b.on)).toEqual([true, false]);
  });
  it('the tutorial page itself keeps within 560 px (the strip is extra height, nothing overlaps)', () => {
    const e = eng(); e.start('m1'); const w = layoutPage(buildPage({ engine: e }), { measure: (t, z) => t.length * z * 0.6 }).filter(x => !x.type);
    for (const b of w) expect(b.y + b.h).toBeLessThanOrEqual(560);
  });
});

const tv = readFileSync(new URL('../../docs/tutorial-vr.js', import.meta.url), 'utf8');
describe('READ-ONLY preview (tutorial switch off)', () => {
  const mkP = (o = {}) => { const onChange = vi.fn(); return { p: createTutorialPreview({ onChange, ...o }), onChange }; };
  it('lists the 7 steps with ステップN; opening one shows its pages n/N; 前へ / 次へ / 一覧 move a cursor only', () => {
    const { p, onChange } = mkP(); const l = p.page();
    expect(l.kind).toBe('list'); expect(l.missions.map(m => m.label.slice(0, 5))).toEqual(['ステップ1', 'ステップ2', 'ステップ3', 'ステップ4', 'ステップ5', 'ステップ6', 'ステップ7']); expect(l.missions.every(m => m.status === 'available' && !m.done)).toBe(true);
    expect(p.act('start:m3')).toBe(true); const s0 = p.page(); expect(s0.kind).toBe('step'); expect(s0.title).toMatch(/^ステップ3 /); expect(s0.counter).toBe('1/3'); expect(s0.buttons[0].disabled).toBe(true);
    p.act('next'); expect(p.page().counter).toBe('2/3'); p.act('prev'); expect(p.page().counter).toBe('1/3');
    p.act('next'); p.act('next'); expect(p.page().buttons[1].label).toBe('完了'); p.act('next'); expect(p.page().kind).toBe('list'); // 完了 goes back to the list
    p.act('start:m1'); p.act('list'); expect(p.page().kind).toBe('list'); expect(onChange).toHaveBeenCalled();
    expect(p.act('start:nope')).toBe(false); expect(p.act('prev')).toBe(false);
  });
  it('has no progress buttons: only 前へ / 次へ / 一覧 (no skip, no 最初から), and the widgets all have actions', () => {
    const { p } = mkP(); p.act('start:m1');
    expect(p.page().buttons.map(b => b.id)).toEqual(['prev', 'next', 'list']);
    const w = p.widgets({ measure: (t, z) => t.length * z * 0.6 }).filter(x => !x.type); for (const b of w) { expect(typeof b.action).toBe('function'); expect(b.y + b.h).toBeLessThanOrEqual(560); }
    expect(p.widgets({ measure: () => 0 }).filter(x => !x.type)).toHaveLength(w.length);
    p.act('list'); const lw = p.widgets({ measure: () => 0 }).filter(x => !x.type); expect(lw).toHaveLength(7); expect(lw.every(b => !b.disabled && typeof b.action === 'function')).toBe(true);
  });
  it('touches nothing: no engine, no voice, no storage, no signal wiring', () => {
    const tv2 = tv.slice(tv.indexOf('export function createTutorialPreview')); expect(tv2).not.toMatch(/getEngine|engine|createTutorialAudio|voice\.|localStorage|saveProgress|addEventListener|vrl-tut-signal/);
    const before = JSON.stringify(globalThis.localStorage ? { ...globalThis.localStorage } : {});
    const { p } = mkP(); p.act('start:m1'); p.act('next'); p.act('list');
    expect(JSON.stringify(globalThis.localStorage ? { ...globalThis.localStorage } : {})).toBe(before);
    expect(globalThis.__vrlTutorialEngine?.getState().mission ?? null).toBeNull();
  });
  it('uses the hand wording when a hand is the input', () => {
    let input = 'ctrl'; const { p } = mkP({ getInput: () => input }); p.act('start:m3'); const a = p.page().text; input = 'hand'; expect(p.page().text).not.toBe(a);
  });
});

describe('vr-view.js: tabs, preview and the mission board (static)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('the help board starts on 詳細 with the tutorial on and on 手順一覧 with it off; the preview is made only on first use', () => {
    expect(src).toContain("let helpShow=tutVr?'detail':'list';");
    expect(src).toContain('tutPreview||=createTutorialPreview(');
    expect(src).toContain('const tabs=tutBad?[]:panelTabs(helpShow,');
    expect(src).toContain('help.setHover(tutHov)');
  });
  it('the mission board: own board, placed once at EV_OFFSET, grip / near-grab / ray like the others, no mission panel for Lv0 with the tutorial on', () => {
    expect(src).toContain("evText=evLevel&&!(evLevel.id==='lv0'&&tutorialModeOn())?tr(evLevel.missionKey):''");
    expect(src).toContain('const ev=evH?makeMenu(820,evH+10,EV_WIDTH):null;');
    expect(src).toContain('EV_OFFSET.fwd'); expect(src).toContain('o.ev=ev?evHit(c):null;');
    expect(src).toContain('if(!evHeld&&c.userData.evHit){holdOf(c).attach(ev.mesh);evHeld=c;'); expect(src).toContain('o[6].d=boardDist(ev.mesh)'); expect(src).toContain("case'ev':if(!evHeld)");
    expect(src).toContain('ev?.dispose()'); expect(src).toContain('placeHelpNow=()=>{readHead();computeHelpTarget();help.mesh.position.copy(helpTarget);help.mesh.lookAt(head);helpPlaced=true;helpMoving=false;placeEvNow()}');
  });
});
