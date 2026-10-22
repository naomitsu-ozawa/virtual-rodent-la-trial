import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTutorialEngine } from '../../docs/tutorial-engine.js';
import { TUTORIAL_MISSIONS, missionById } from '../../docs/tutorial-data.js';
import { GUIDE_SLIDES, LEVEL_SLIDES, guideSlide, slideItem, itemRect, slideSrc, SLIDE_W } from '../../docs/tutorial-slides.js';
import { buildPage, layoutPage, slideBox, levelBoardH, tutorialModeOn, createTutorialVr, createSlideViewer, createTutorialPreview, panelTabs, stepNoLabel, TAB_H, FLASH_MS, menuAnnotation, layoutLevelSlide } from '../../docs/tutorial-vr.js';
import { audioSrc, voiceOf, speechFor, createTutorialAudio, createStepReplay, isFeedbackId } from '../../docs/tutorial-audio.js';
import { I18N } from '../../docs/i18n.js';
import { ANIM_STEP_MS, ANIM_IDLE_MS } from '../../docs/tutorial-marks.js';
import { LOOK_DWELL_MS } from '../../docs/tutorial-orient.js';
import { TUT_ORIENT, TUT_FEEDBACK } from '../../docs/tutorial-data.js';
import { wrapText } from '../../docs/tutorial-vr.js';

// the board shows the step's slide (controls / g1 / g2 / g3 / g3b), the live tutorial runs on the Lv0 data only, the 詳細 tab without it is the read-only guide
globalThis.__vrlSettings.set('tutorialMode', true); // the signal tests run with the switch on (off = signals are ignored, tested below)
globalThis.__vrlOpenSample = 'sample4'; // ... and with the tutorial's data open
const G = missionById('grip'), SEC = missionById('section');
const eng = o => createTutorialEngine({ arAvailable: false, ...o });
const fakeAudio = () => { const played = []; const C = function (src) { this.src = src; played.push(src); this.play = () => Promise.resolve(); this.pause = () => {}; }; return { C, played }; };
const mkVr = (o = {}) => { const a = { play: vi.fn(), stop: vi.fn() }; let t = 1000; const doc = new EventTarget(); const e = o.engine || eng(); const vr = createTutorialVr({ engine: e, audio: a, doc, now: () => t, getInput: () => 'ctrl', entry: false, ...o }); return { vr, e, a, doc, setT: v => { t = v; }, sig: kind => doc.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind } })) }; };
// the voice files' cache-busting query, as tools/bump-build.mjs leaves it in docs/tutorial-audio.js
const AQ = readFileSync(new URL('../../docs/tutorial-audio.js', import.meta.url), 'utf8').match(/const AUDIO_QUERY = '([^']+)'/)[1];
const ms = (t, z) => String(t).length * z * 0.6;
const buttons = w => w.filter(x => !x.type);
// a loaded picture for every slide (the tests never load files): getImage(id) -> a stand-in element
const pic = id => ({ fake: id });
// a canvas context that records what the draw widgets do
const recCtx = () => { const calls = []; const rec = n => (...a) => calls.push([n, ...a]); return { calls, save: rec('save'), restore: rec('restore'), beginPath: rec('beginPath'), roundRect: rec('roundRect'), rect: rec('rect'), fill: rec('fill'), stroke: rec('stroke'), arc: rec('arc'), ellipse: rec('ellipse'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), closePath: rec('closePath'), fillRect: rec('fillRect'), fillText: rec('fillText'), clip: rec('clip'), drawImage: rec('drawImage'), set lineJoin(v) {}, set fillStyle(v) { calls.push(['fillStyle', v]); }, set strokeStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {}, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {}, set globalAlpha(v) {} }; };

describe('tutorial-vr page model', () => {
  it('idle engine -> list page: ステップ1 startable, the rest locked; the guide, skip-all and start-over below', () => {
    const p = buildPage({ engine: eng() });
    expect(p.kind).toBe('list'); expect(p.missions.map(m => m.status)).toEqual(['available', 'locked', 'locked', 'locked', 'locked']);
    expect(p.buttons.map(b => b.id)).toEqual(['guides', 'skipAll', 'reset']);
  });
  it('ステップ1 is the controls slide as it is (its picture, nothing framed), with a lit, pointed 次へ', () => {
    const e = eng(); e.start('controls'); const p = buildPage({ engine: e });
    expect(p).toMatchObject({ kind: 'controls', title: 'ステップ1 コントローラーの使い方', counter: '1/1', slide: 'controls', item: null, done: [] });
    expect(p.buttons.map(b => b.id)).toEqual(['list', 'skipAll', 'next']); expect(p.buttons[2]).toMatchObject({ label: '次へ', on: true, point: true });
  });
  it('a step page: the step\'s slide, the numbered row of the page now (item) and the rows done before it (✓); one row of buttons', () => {
    const e = eng(); e.skipMission('controls'); e.start('grip'); let p = buildPage({ engine: e });
    expect(p).toMatchObject({ kind: 'step', counter: '1/3', slide: 'g1', item: 1, done: [] });
    expect(p.buttons.map(b => b.id)).toEqual(['prev', 'skipMission', 'list', 'next']); expect(p.buttons[0].disabled).toBe(true);
    expect(p.buttons[3]).toMatchObject({ on: false, point: false }); // a page with a signal: 次へ only steps over it (not lit)
    expect(Object.keys(p)).not.toEqual(expect.arrayContaining(['items'])); expect(p.rows).toBeUndefined(); expect(p.note).toBeUndefined(); // nothing of the slide redrawn
    e.onSignal({ kind: 'grab' }); p = buildPage({ engine: e });
    expect(p).toMatchObject({ counter: '2/3', item: 2, done: [1] }); expect(p.buttons[0].disabled).toBe(false);
    e.onSignal({ kind: 'grab-move' }); expect(buildPage({ engine: e })).toMatchObject({ item: 3, done: [1, 2] });
  });
  it('hand tracking: the same slide and row (the board shows the deck\'s slides only)', () => {
    const e = eng(); e.skipMission('controls'); e.start('grip');
    expect(buildPage({ engine: e, input: 'hand' })).toEqual(buildPage({ engine: e }));
  });
  it('English board: the same slide picture; the title row and buttons in English', () => {
    const e = eng(); e.start('controls'); const en = k => I18N.en[k];
    const p = buildPage({ engine: e, lang: 'en', t: en }); expect(p.slide).toBe('controls'); expect(p.title).toBe('Step 1 ' + I18N.en.tutCtlTitle); expect(p.buttons[2].label).toBe(I18N.en.tutNext);
  });
  it('last step: 完了 finishes; finished -> missionDone with a lit, pointed next-step button; allDone at the end', () => {
    const e = eng(); e.skipMission('controls'); e.start('grip'); e.next(); e.next();
    expect(buildPage({ engine: e }).buttons[3].label).toBe('完了'); e.next();
    const p = buildPage({ engine: e }); expect(p.kind).toBe('missionDone'); expect(p.buttons[0]).toMatchObject({ id: 'start:section', point: true }); expect(p.buttons[0].label).toMatch(/ステップ3 /);
    const all = eng(); all.start('controls'); all.skipAll(); expect(buildPage({ engine: all }).kind).toBe('allDone');
  });
  it('list view on demand, even mid-step; reset arm changes the label', () => {
    const e = eng(); e.start('controls');
    expect(buildPage({ engine: e, view: 'list' }).kind).toBe('list');
    expect(buildPage({ engine: e, view: 'list', resetArmed: true }).buttons.at(-1).warn).toBe(true);
  });
  it('the menu steps name the widget to light; both frame row 1 of g3 (光線で指してトリガー); no step asks to open the menu (it is up from the start)', () => {
    expect(missionById('menu').steps.map(s => s.menu)).toEqual(['seg-hide', 'seg-show']);
    const e = eng(); for (const id of ['controls', 'grip', 'section']) e.skipMission(id); e.start('menu');
    expect(buildPage({ engine: e })).toMatchObject({ slide: 'g3', item: 1, done: [] });
    e.onSignal({ kind: 'seg-hide' }); expect(buildPage({ engine: e })).toMatchObject({ slide: 'g3', item: 1, done: [] }); // the row now is not also ✓
  });
});

describe('tutorial-vr layout', () => {
  const pages = () => { const out = []; const e = eng(); out.push(['list', buildPage({ engine: e })]); e.start('controls'); out.push(['controls', buildPage({ engine: e })]);
    for (const id of ['grip', 'section', 'menu', 'slice']) { e.skipMission(e.getState().mission); e.start(id); for (let i = 0; i < missionById(id).steps.length; i++) { out.push([id + i, buildPage({ engine: e })]); out.push([id + i + 'en', buildPage({ engine: e, lang: 'en' })]); e.next(); } out.push([id + 'done', buildPage({ engine: e })]); }
    return out; };
  it('every page keeps its buttons inside the 820 x 560 page (the tab strip is extra height), each with an action', () => {
    for (const [name, p] of pages()) {
      const act = vi.fn(), w = layoutPage(p, { act, getImage: pic });
      for (const b of buttons(w)) { expect(b.x, name).toBeGreaterThanOrEqual(0); expect(b.x + b.w, name).toBeLessThanOrEqual(820); expect(b.y + b.h, name).toBeLessThanOrEqual(560); expect(typeof b.action, name).toBe('function'); }
      for (const l of w.filter(x => x.type === 'label')) expect(l.y, name).toBeLessThan(560);
    }
  });
  it('the step page: the title row, the slide picture under it, the frame EXACTLY on the slide\'s numbered row of the page now, ✓ on the rows done; 次へ calls act', () => {
    const e = eng(); e.skipMission('controls'); e.skipMission('grip'); e.start('section'); e.next(); // page 2 of 3
    expect(e.getState()).toMatchObject({ mission: 'section', step: 1 });
    const act = vi.fn(), w = layoutPage(buildPage({ engine: e }), { act, phase: 0.5, getImage: pic }), box = slideBox(820);
    expect(box).toEqual({ x: 18, y: 52, w: 784, h: 441 });
    // labels: only the title and n/N (nothing of the slide redrawn as text)
    expect(w.filter(x => x.type === 'label').map(x => x.text)).toEqual(['ステップ3 断面を出して動かす', '2/3']);
    const sl = w.find(x => x.slide); expect(sl).toMatchObject({ slide: 'g2', loaded: true });
    const c = recCtx(); sl.draw(c); expect(c.calls.find(x => x[0] === 'drawImage')).toEqual(['drawImage', { fake: 'g2' }, 18, 52, 784, 441]);
    const fr = w.find(x => x.tut === 'item:2'); expect(fr.rect).toEqual(itemRect(slideItem('g2', 2), box));
    const k = box.w / SLIDE_W, r2 = slideItem('g2', 2); expect(fr.rect.x).toBeCloseTo(18 + (r2.x - 10) * k); expect(fr.rect.y).toBeCloseTo(52 + (r2.y - 10) * k); expect(fr.rect.h).toBeCloseTo((r2.h + 20) * k);
    const fc = recCtx(); fr.draw(fc); expect(fc.calls.filter(x => x[0] === 'roundRect')[0].slice(1, 5)).toEqual([fr.rect.x, fr.rect.y, fr.rect.w, fr.rect.h]);
    const dn = w.find(x => x.tut === 'done:1'), dc = recCtx(); dn.draw(dc); const r1 = slideItem('g2', 1);
    const disc = dc.calls.find(x => x[0] === 'arc'); expect(disc[1]).toBeCloseTo(18 + (r1.x + 30) * k); expect(disc[2]).toBeCloseTo(52 + (r1.y + 30) * k); // the ✓ on the number badge of row 1
    expect(w.filter(x => x.tut && x.tut.startsWith('done:')).length).toBe(1); expect(w.some(x => x.tut === 'done:2' || x.tut === 'item:3')).toBe(false);
    // the buttons under the picture, inside the page
    for (const b of buttons(w)) { expect(b.y).toBeGreaterThanOrEqual(box.y + box.h); expect(b.y + b.h).toBeLessThanOrEqual(560); }
    buttons(w).at(-1).action(); expect(act).toHaveBeenCalledWith('next');
  });
  it('a picture not loaded yet: its place in the slide\'s background colour (no text drawn)', () => {
    const e = eng(); e.start('controls'); const w = layoutPage(buildPage({ engine: e }));
    const sl = w.find(x => x.slide); expect(sl.loaded).toBe(false); const c = recCtx(); sl.draw(c);
    expect(c.calls.some(x => x[0] === 'drawImage' || x[0] === 'fillText')).toBe(false); expect(c.calls).toContainEqual(['fillStyle', '#14213D']);
  });
  it('the controls page: the picture, no frame, and the pointer on the lit 次へ', () => {
    const e = eng(); e.start('controls'); const w = layoutPage(buildPage({ engine: e }), { getImage: pic });
    const bs = buttons(w); expect(bs.map(b => b.label)).toEqual(['ステップ一覧', '経験者はすべてスキップ', '次へ']); expect(bs[2].on).toBe(true);
    expect(w.filter(x => x.type === 'label').map(x => x.text)).toEqual(['ステップ1 コントローラーの使い方', '1/1']);
    expect(w.filter(x => x.type === 'draw').length).toBe(2); // the picture + the pointer
    expect(w.some(x => x.tut)).toBe(false);
  });
  it('flash adds the ✓ mark', () => {
    const e = eng(); e.start('controls'); const w = layoutPage(buildPage({ engine: e }), { flash: { mark: '✓', text: 'x' } });
    expect(w.some(x => x.text === '✓' && x.size === 96)).toBe(true);
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
  it('the board opens on a step, never on an empty list: no step under way = the next not done starts (ステップ1 on a first visit) and is spoken', () => {
    const { vr, e, a } = mkVr();
    expect(e.getState().mission).toBe('controls'); expect(vr.page().kind).toBe('controls'); expect(a.play).toHaveBeenCalledWith(['controls1']);
    const e2 = eng(); e2.skipMission('controls'); const m = mkVr({ engine: e2 }); expect(m.vr.page().kind).toBe('step'); expect(e2.getState().mission).toBe('grip');
    const e3 = eng(); e3.skipAll(); expect(mkVr({ engine: e3 }).vr.page().kind).toBe('list'); // everything done: the list
  });
  it('signals from the document drive the engine, speak the step, and flash', () => {
    delete globalThis.__vrlTutSignalWired; const e = eng(); e.skipMission('controls'); const { vr, a, sig, setT } = mkVr({ engine: e }); a.play.mockClear();
    expect(e.getState()).toMatchObject({ mission: 'grip', step: 0 });
    sig('grab'); expect(e.getState().step).toBe(1);
    expect(a.play).toHaveBeenLastCalledWith(['ok1', G.steps[1].audio]);
    const k = vr.drawKey(); expect(vr.widgets({ measure: ms }).some(w => w.text === '✓' && w.size === 96)).toBe(true);
    setT(1000 + FLASH_MS + 1); vr.update(); expect(vr.drawKey()).not.toBe(k); expect(vr.widgets({ measure: ms }).some(w => w.text === '✓' && w.size === 96)).toBe(false);
    vr.dispose(); sig(G.steps[1].done.signal); expect(e.getState().step).toBe(1);
  });
  it('signals count only on the tutorial\'s data: another dataset open = nothing advances', () => {
    delete globalThis.__vrlTutSignalWired; const e = eng(); e.skipMission('controls'); const { vr, sig } = mkVr({ engine: e });
    try { for (const o of ['sample3', 'mine']) { globalThis.__vrlOpenSample = o; sig('grab'); } expect(e.getState().step).toBe(0); } finally { globalThis.__vrlOpenSample = 'sample4'; }
    sig('grab'); expect(e.getState().step).toBe(1); vr.dispose();
  });
  it('switch off: the board ignores signals (nothing advances); on again: as before', () => {
    delete globalThis.__vrlTutSignalWired; const e = eng(); e.skipMission('controls'); const { vr, sig } = mkVr({ engine: e });
    try { globalThis.__vrlSettings.set('tutorialMode', false); sig('grab'); expect(e.getState().step).toBe(0); } finally { globalThis.__vrlSettings.set('tutorialMode', true); }
    sig('grab'); expect(e.getState().step).toBe(1); vr.dispose();
  });
  it('the controls page: 次へ (laser + trigger on the board) finishes ステップ1 and the next step is one press away', () => {
    const { vr, e, a } = mkVr(); a.play.mockClear(); vr.act('next');
    expect(e.getState()).toMatchObject({ mission: 'controls', finished: true }); expect(a.play).toHaveBeenLastCalledWith(['mclear', 'gonext']); expect(vr.page().kind).toBe('missionDone');
    vr.act('start:grip'); expect(vr.page().kind).toBe('step'); expect(e.getState().mission).toBe('grip');
  });
  it('button actions: prev / next / skip / list / the read-only guide inside the tutorial', () => {
    const { vr, e } = mkVr(); vr.act('next'); vr.act('start:grip'); vr.act('next'); expect(e.getState().step).toBe(1); vr.act('prev'); expect(e.getState().step).toBe(0);
    vr.act('list'); expect(vr.page().kind).toBe('list'); vr.act('start:grip'); expect(vr.page().kind).toBe('step');
    vr.act('list'); vr.act('guides'); const w = vr.widgets({ measure: ms }); expect(buttons(w).map(b => b.label)).toContain('6. ラベルを出す・距離を測る');
    vr.act('slide:g2'); expect(vr.widgets({ measure: ms })[0].text).toBe('操作ガイド：断面を出して動かす'); vr.act('list'); vr.act('close'); expect(vr.page().kind).toBe('list');
    expect(e.getState().mission).toBe('grip'); // the guide moves nothing
    vr.act('skipMission'); expect(e.isDone('grip')).toBe(true); vr.act('skipAll'); expect(e.getState().skipAll).toBe(true);
  });
  it('reset needs two presses within the guard window', () => {
    const { vr, e, setT } = mkVr(); vr.act('skipMission'); vr.act('list');
    expect(vr.act('reset')).toBe(false); expect(e.isDone('controls')).toBe(true); expect(vr.page().buttons.at(-1).warn).toBe(true);
    setT(1000 + 3500); vr.update(); expect(vr.page().buttons.at(-1).warn).toBe(false); // expired: arms again
    expect(vr.act('reset')).toBe(false); setT(1000 + 3600); expect(vr.act('reset')).toBe(true);
    expect(e.isDone('controls')).toBe(false); expect(vr.page().kind).toBe('list');
  });
  it('reset: the practice dataset open -> resetUserState runs; the visitor\'s own data -> it does not (progress is cleared either way)', () => {
    try {
      for (const [open, called] of [['sample4', 1], ['sample1', 1], ['mine', 0], [undefined, 0], [null, 0]]) {
        globalThis.__vrlOpenSample = open;
        const ru = vi.fn(), { vr, e, setT } = mkVr({ resetUserState: ru }); vr.act('skipMission'); vr.act('list');
        vr.act('reset'); setT(1000 + 600); vr.act('reset');
        expect(e.isDone('controls'), String(open)).toBe(false); expect(ru, String(open)).toHaveBeenCalledTimes(called);
      }
    } finally { globalThis.__vrlOpenSample = 'sample4'; }
  });
  it('the menu pointer: menuTarget / menuKey name the widget of the menu step and animate; nothing outside the menu steps', () => {
    const e = eng(); for (const id of ['controls', 'grip', 'section']) e.skipMission(id);
    const { vr, setT } = mkVr({ engine: e });
    expect(vr.menuTarget()).toBe('seg-hide'); const k0 = vr.menuKey(); setT(1000 + ANIM_STEP_MS); expect(vr.menuKey()).not.toBe(k0); expect(vr.menuKey()).toMatch(/^seg-hide\d$/);
    setT(1000 + ANIM_IDLE_MS + 10); expect(vr.menuKey()).toBe('seg-hides'); expect(vr.menuPhase()).toBe(0); // still 20 s after the board last changed
    e.onSignal({ kind: 'seg-hide' }); expect(vr.menuTarget()).toBe('seg-show');
    e.onSignal({ kind: 'seg-show' }); expect(vr.menuTarget()).toBeNull(); expect(vr.menuKey()).toBe(''); // finished
    vr.act('start:slice'); expect(vr.menuTarget()).toBe('slider'); e.next(); expect(vr.menuTarget()).toBeNull();
    vr.act('list'); expect(vr.menuTarget()).toBeNull();
  });
  it('the board blinks at most twice a second, only on a page with a frame or a pointer, and stops 20 s after it last changed (Quest: each redraw re-uploads the board)', () => {
    const { vr, setT } = mkVr(); const k = vr.drawKey(); setT(1000 + 200); expect(vr.drawKey()).toBe(k); setT(1000 + ANIM_STEP_MS); expect(vr.drawKey()).not.toBe(k); // the controls page: the 次へ pointer
    const keys = new Set(); for (let t = 1000; t < 1000 + 10000; t += 50) { setT(t); keys.add(vr.drawKey()); } expect(keys.size).toBe(2); // two states
    setT(1000 + ANIM_IDLE_MS + 1); const s1 = vr.drawKey(); setT(1000 + ANIM_IDLE_MS + 700); expect(vr.drawKey()).toBe(s1); // still
    vr.act('list'); const l = vr.drawKey(); setT(1000 + ANIM_IDLE_MS + 1400); expect(vr.drawKey()).toBe(l); // the list never blinks
  });
  it('a page done: the ✓ flash and the chime (silent when the voice is off: tutorial-audio createChime)', () => {
    const e = eng(); e.skipMission('controls'); e.start('grip'); const chime = { play: vi.fn() };
    const { vr } = mkVr({ engine: e, chime }); e.onSignal({ kind: 'grab' }); expect(chime.play).toHaveBeenCalledTimes(1);
    expect(vr.widgets().some(x => x.tut === 'flash')).toBe(true);
  });
  it('the board loads the slide pictures itself when vr-view gives none; one arriving redraws the board', () => {
    const made = []; const OldImage = globalThis.Image; globalThis.Image = function () { made.push(this); };
    try {
      const { vr } = mkVr(); const r0 = vr.rev; vr.widgets(); expect(made).toHaveLength(1); expect(made[0].src).toBe(slideSrc('controls'));
      expect(vr.widgets().find(x => x.slide).loaded).toBe(false); made[0].onload(); expect(vr.rev).toBeGreaterThan(r0); expect(vr.widgets().find(x => x.slide).loaded).toBe(true);
    } finally { if (OldImage === undefined) delete globalThis.Image; else globalThis.Image = OldImage; }
  });
  it('session end: the ✓ feedback the closing signal earned is not cut off; guidance voice is', () => {
    const made = []; const C = function (s) { this.src = s; made.push(this); this.play = () => Promise.resolve(); this.pause = vi.fn(); };
    const audio = createTutorialAudio({ AudioCtor: C }); delete globalThis.__vrlTutSignalWired; const e = eng(); for (const id of ['controls', 'grip', 'section']) e.skipMission(id);
    const { vr, sig } = mkVr({ audio, engine: e }); sig('seg-hide'); sig('seg-show'); // the last step done by signal -> mclear
    expect(made.at(-1).src).toContain('/mclear.m4a'); const clip = made.at(-1);
    vr.dispose(); expect(clip.pause).not.toHaveBeenCalled(); expect(made.at(-1)).toBe(clip);
    const g = []; const C2 = function (s) { this.src = s; g.push(this); this.play = () => Promise.resolve(); this.pause = vi.fn(); };
    const a2 = createTutorialAudio({ AudioCtor: C2 }), m2 = mkVr({ audio: a2 }); // the step voice (guidance) is playing
    m2.vr.dispose(); expect(g.at(-1).pause).toHaveBeenCalled();
  });
  it('audio settle: kept clip plays out, waiting guidance is dropped, a guidance clip is stopped', () => {
    const made = []; const C = function (s) { this.src = s; made.push(this); this.play = () => Promise.resolve(); this.pause = vi.fn(); };
    const p = createTutorialAudio({ AudioCtor: C }); p.play(['ok1', 'grip2', 'mclear']);
    expect(p.settle(isFeedbackId)).toBe(true); expect(made[0].pause).not.toHaveBeenCalled();
    made[0].onended(); expect(made.map(x => x.src.split('/').pop().split('?')[0])).toEqual(['ok1.m4a', 'mclear.m4a']); made[1].onended(); expect(made.length).toBe(2);
    p.play(['grip2']); const g = made.at(-1); expect(p.settle(isFeedbackId)).toBe(false); expect(g.pause).toHaveBeenCalled();
    expect(p.settle(isFeedbackId)).toBe(false); expect(isFeedbackId('ok2') && isFeedbackId('allclear') && !isFeedbackId('grip2') && !isFeedbackId(undefined)).toBe(true);
  });
  it('replays the step voice after timeoutHint of no progress, once', () => {
    const e = eng(); e.skipMission('controls'); const { vr, a, setT } = mkVr({ engine: e }); a.play.mockClear();
    setT(1000 + 19000); vr.update(); expect(a.play).not.toHaveBeenCalled();
    setT(1000 + 21000); vr.update(); expect(a.play).toHaveBeenCalledWith([G.steps[0].audio]);
    a.play.mockClear(); setT(1000 + 90000); vr.update(); expect(a.play).not.toHaveBeenCalled();
  });
});

describe('the かんたんメニュー pointer (menuAnnotation)', () => {
  const ws = (boneOn = true) => [{ type: 'label', id: 'seg:bone:name', text: '骨' }, { type: 'button', id: 'seg:bone:show', x: 440, y: 180, w: 250, h: 72, on: boneOn }, { type: 'button', id: 'seg:bone:hide', x: 710, y: 180, w: 250, h: 72, on: !boneOn },
    { type: 'button', id: 'seg:fat:show', x: 440, y: 262, w: 250, h: 72, on: false }, { type: 'button', id: 'seg:fat:hide', x: 710, y: 262, w: 250, h: 72, on: true }, { type: 'slider', id: 'sliceOpacity', x: 440, y: 426, w: 330, h: 72, value: 0.6 }];
  it('hide: the 非表示 of the first tissue shown; show: the 表示 of the first tissue hidden; slider: the knob', () => {
    expect(menuAnnotation(ws(), 'seg-hide').tut).toBe('seg:bone:hide');
    expect(menuAnnotation(ws(), 'seg-show').tut).toBe('seg:fat:show');
    expect(menuAnnotation(ws(false), 'seg-show').tut).toBe('seg:bone:show');
    const k = menuAnnotation(ws(), 'slider', 0.5); expect(k.tut).toBe('slider');
    const ctx = recCtx(); k.draw(ctx); const ring = ctx.calls.find(c => c[0] === 'arc'); expect(ring[1]).toBeCloseTo(440 + 330 * 0.6); expect(ring[2]).toBe(462);
    const ctx2 = recCtx(); menuAnnotation(ws(), 'seg-hide').draw(ctx2); const rr = ctx2.calls.find(c => c[0] === 'roundRect'); expect(rr[1]).toBeLessThan(710); expect(rr[1] + rr[3]).toBeGreaterThan(960);
  });
  it('nothing to light: no target, no widget, nothing hidden for show', () => {
    expect(menuAnnotation(ws(), null)).toBeNull(); expect(menuAnnotation(ws(), 'nope')).toBeNull(); expect(menuAnnotation([], 'slider')).toBeNull(); expect(menuAnnotation(null, 'seg-hide')).toBeNull();
    expect(menuAnnotation(ws().filter(x => x.id !== 'seg:fat:show'), 'seg-show')).toBeNull();
  });
});

describe('the read-only operation guide (the 詳細 tab without the live tutorial)', () => {
  it('lists controls, g1, g2, g3, g3b, g4; each slide is its picture; 前へ / 次へ / 一覧 move a cursor only', () => {
    const onChange = vi.fn(), v = createSlideViewer({ onChange, getImage: pic });
    const l = v.page(); expect(l.kind).toBe('slideList'); expect(l.slides.map(s => s.id)).toEqual(['controls', 'g1', 'g2', 'g3', 'g3b', 'g4']);
    expect(v.act('slide:g3b')).toBe(true); const p = v.page();
    expect(p).toMatchObject({ kind: 'slide', slide: 'g3b', counter: '5/6', title: '操作ガイド：スライスの透け具合を変える' });
    expect(v.widgets().filter(x => x.type === 'label').map(x => x.text)).toEqual([p.title, '5/6']); expect(v.widgets().find(x => x.slide)).toMatchObject({ slide: 'g3b', loaded: true });
    v.act('next'); expect(v.page().id).toBe('g4'); expect(v.page().buttons[1].disabled).toBe(true);
    v.act('prev'); expect(v.page().id).toBe('g3b'); v.act('list'); expect(v.page().kind).toBe('slideList'); expect(onChange).toHaveBeenCalled();
    expect(v.act('slide:nope')).toBe(false); expect(v.act('prev')).toBe(false);
    expect(createTutorialPreview).toBeTypeOf('function');
    const en = createSlideViewer({ lang: 'en' }); en.act('slide:g1'); expect(en.page().title).toMatch(/: Grab and move with the grip$/); expect(en.page().title).not.toContain('：'); // half-width ': ' in English
  });
  it('every slide page fits the board with actions on its buttons; the list has the 6 slides', () => {
    const v = createSlideViewer({});
    expect(buttons(v.widgets())).toHaveLength(6);
    for (const s of GUIDE_SLIDES) {
      v.act('slide:' + s.id); const w = v.widgets();
      for (const b of buttons(w)) { expect(b.y + b.h, s.id).toBeLessThanOrEqual(560); expect(typeof b.action).toBe('function'); }
      for (const t of w.filter(x => x.type === 'label')) expect(t.y, s.id).toBeLessThan(560 - 70);
    }
  });
  it('touches nothing: no engine, no voice, no storage, no signal wiring', () => {
    const tv = readFileSync(new URL('../../docs/tutorial-vr.js', import.meta.url), 'utf8');
    const part = tv.slice(tv.indexOf('export function buildSlidePage'), tv.indexOf('export const createTutorialPreview'));
    expect(part).not.toMatch(/getEngine|engine|createTutorialAudio|voice\.|localStorage|saveProgress|addEventListener|vrl-tut-signal/);
  });
});

describe('the level slide on the 体験会 mission board (layoutLevelSlide)', () => {
  it('lv0..lv3: the slide\'s picture over the whole board (16:9), nothing added, nothing pressable', () => {
    expect(levelBoardH(820)).toBe(461);
    for (const s of LEVEL_SLIDES) {
      const { widgets, H } = layoutLevelSlide(s, { getImage: pic });
      expect(H).toBe(461); expect(widgets).toHaveLength(1); expect(widgets[0]).toMatchObject({ type: 'draw', slide: s.id, loaded: true });
      const c = recCtx(); widgets[0].draw(c); expect(c.calls.find(x => x[0] === 'drawImage')).toEqual(['drawImage', { fake: s.id }, 0, 0, 820, 461]);
    }
  });
});

describe('tutorial-audio', () => {
  it('one fixed female voice F1, independent of any setting', () => {
    expect(AQ).toMatch(/^\?v=\d{8}-build\d+$/); expect(readFileSync(new URL('../../docs/index.html', import.meta.url), 'utf8')).toContain(AQ); // the same query as the page's assets
    expect(audioSrc('F1', 'm1s2')).toBe('./tutorial/audio/F1/m1s2.m4a' + AQ); expect(audioSrc(undefined, 'ok1')).toBe('./tutorial/audio/F1/ok1.m4a' + AQ);
    expect(audioSrc('M1', 'ok1')).toBe('./tutorial/audio/F1/ok1.m4a' + AQ); expect(audioSrc('off', 'x')).toBeNull(); expect(audioSrc('F1', '')).toBeNull(); expect(voiceOf('M1')).toBe('F1'); expect(voiceOf('off')).toBe('off');
  });
  it('speechFor: feedback then the new step, nothing for a count-only change', () => {
    const e = eng(); let last; e.subscribe(s => { last = s; }); e.skipMission('controls'); e.start('grip'); let r = speechFor(last, e.currentStep(), '');
    expect(r.ids).toEqual([G.steps[0].audio]); e.onSignal({ kind: 'grab' }); r = speechFor(last, e.currentStep(), r.key); expect(r.ids).toEqual(['ok1', G.steps[1].audio]);
    e.onSignal({ kind: 'nothing' }); expect(speechFor({ ...last, feedbackItem: null }, e.currentStep(), r.key).ids).toEqual([]);
  });
  it('player: error and reject both arriving advance the next clip only once', async () => {
    const made = []; const C = function (s) { this.src = s; made.push(this); this.pause = () => {}; this.play = () => (made.length === 1 ? Promise.reject(new Error('x')) : Promise.resolve()); };
    const p = createTutorialAudio({ AudioCtor: C }); p.play(['a', 'b', 'c']);
    made[0].onerror(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(made.map(x => x.src)).toEqual(['./tutorial/audio/F1/a.m4a' + AQ, './tutorial/audio/F1/b.m4a' + AQ]); // b only once (error + reject + a late onended all hit the guard)
    made[0].onended?.();
    expect(made.length).toBe(2);
  });
  it('player: new Audio, sequential, a stop cancels, a failing file is skipped, off plays nothing', async () => {
    const { C, played } = fakeAudio(); const p = createTutorialAudio({ AudioCtor: C });
    expect(p.play(['ok1', 'm1s2'])).toBe(true); expect(played).toEqual(['./tutorial/audio/F1/ok1.m4a' + AQ]);
    // find the audio object: error -> next
    const first = []; const C2 = function (s) { this.src = s; first.push(this); this.play = () => Promise.resolve(); this.pause = () => {}; };
    const p2 = createTutorialAudio({ AudioCtor: C2 }); p2.play(['a', 'b']); first[0].onerror(); expect(first.map(x => x.src)).toEqual(['./tutorial/audio/F1/a.m4a' + AQ, './tutorial/audio/F1/b.m4a' + AQ]);
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
  it('the hooks exist and everything is gated on tutVr (null unless the switch is on AND the Lv0 data is open)', () => {
    expect(src).toContain("from './tutorial-vr.js?v=");
    expect(src).toContain('const tutLive=tutorialModeOn()&&globalThis.__vrlOpenSample===TUT_SAMPLE;');
    expect(src).toMatch(/tutVr=tutLive\?createTutorialVr\(\{resetUserState,/);
    expect(src).toContain('if(tutVr)return [...tutVr.widgets({W:820,H:560}),...tabs]');
    expect(src).toContain('tutVr.update(performance.now())'); expect(src).toContain('try{tutVr?.dispose()}catch');
    expect(src).not.toContain('moveTracker'); expect(src).not.toContain('tutMove');
    expect(src).toContain("if(r&&faint)emit('label-show')"); // only the hover card, never the pinned card redrawn on re-entry
    expect(src).toContain("if(!sweepOn)emit('section-add')"); expect(src).toContain("if(!sweepOn)emit('section-toggle')");
    expect(src).toMatch(/begin:\(\)=>\{[^}]*sweepOn=true/); expect(src).toContain('tmp=pl=null;sweepOn=false');
    expect(src).toContain('help.mesh.visible=(settings.help|0)>0||!!tutVr');
    expect(src).toContain('if(bd.help){const i=help.hit(bd.help.uv);if(i>=0){help.press(i);pulse(c)}return}');
    expect(src).toContain('(tutVr?tutVr.drawKey():\'\')');
    expect(src).toContain('if(tutVr&&ui.open&&ui.tab===10){const mk=tutVr.menuKey();if(mk!==tutMenuKey){tutMenuKey=mk;menu.refresh()}}');
    expect(src).toContain('if(tutVr&&!tutBad){try{const an=menuAnnotation(w,tutVr.menuTarget(),tutVr.menuPhase());if(an)w.push(an)}catch(e){tutFail(e)}}');
    expect(src).toContain("if(w.type==='draw'){ctx.save();try{w.draw(ctx)}catch(e){console.warn('[menu] draw widget',e)}ctx.restore();");
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
  it('the list says ステップN before each name (fixed 1..5); a step page title carries it, the page counter is only n/N', () => {
    const p = buildPage({ engine: eng() });
    expect(p.missions.map(m => m.label.match(/^ステップ(\d)/)?.[1])).toEqual(['1', '2', '3', '4', '5']);
    const e = eng(); e.skipMission('controls'); e.skipMission('grip'); e.start('section'); const q = buildPage({ engine: e });
    expect(q.title).toBe('ステップ3 断面を出して動かす'); expect(q.counter).toBe('1/' + SEC.steps.length); expect(q.counter).not.toMatch(/ステップ/);
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
});

describe('vr-view.js: tabs, the guide and the mission board (static)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('the help board starts on 詳細 with the live tutorial and on 手順一覧 otherwise; the guide is made only on first use', () => {
    expect(src).toContain("let helpShow=tutVr?'detail':'list';");
    expect(src).toContain('tutPreview||=createSlideViewer(');
    expect(src).toContain('const tabs=tutBad?[]:panelTabs(helpShow,');
    expect(src).toContain('help.setHover(tutHov)');
  });
  it('the mission board: own board, placed once at EV_OFFSET, grip / near-grab / ray like the others, the level slide, none for Lv0 while the live tutorial runs', () => {
    expect(src).toContain("evSlide=evLevel&&!(evLevel.id==='lv0'&&tutLive)?levelSlide(evLevel.id):null;");
    expect(src).toContain('const ev=evH?makeMenu(820,evH,EV_WIDTH,EV_RES):null;');
    expect(src).toContain('EV_OFFSET.fwd'); expect(src).toContain('o.ev=ev?evHit(c):null;');
    expect(src).toContain('if(!evHeld&&c.userData.evHit){holdOf(c).attach(ev.mesh);evHeld=c;'); expect(src).toContain('o[6].d=boardDist(ev.mesh)'); expect(src).toContain("case'ev':if(!evHeld)");
    expect(src).toContain('ev?.dispose()'); expect(src).toContain('placeHelpNow=()=>{readHead();computeHelpTarget();help.mesh.position.copy(helpTarget);help.mesh.lookAt(head);helpPlaced=true;helpMoving=false;placeEvNow()}');
  });
});


describe('tutorial-vr entry guidance', () => {
  const look = { right: 90, left: 90 };
  const mkEntry = (o = {}) => { const m = mkVr({ entry: true, getLook: () => ({ ...look }), ...o }); return m; };
  it('a session starts at the entry guidance, not at ステップ1: the engine is idle, the page says look right, the help board blinks, the line is spoken', () => {
    const e = eng(); e.skipMission('controls'); // a page that had progress: a session still starts from the beginning
    const { vr, a } = mkEntry({ engine: e }); look.right = look.left = 90;
    expect(e.getState()).toMatchObject({ mission: null, done: {} });
    vr.update(1000); // both boards are in place (getLook gives angles): the guidance begins
    expect(vr.page()).toMatchObject({ kind: 'entry', phase: 'right', board: 'help', text: I18N.ja.tutOrientRight });
    expect(vr.entryBoard()).toBe('help'); expect(a.play).toHaveBeenLastCalledWith([TUT_ORIENT.right.audio], expect.any(Function));
    expect(vr.menuTarget()).toBeNull();
  });
  it('right -> look right -> left (menu blinks, its line spoken) -> look left -> ステップ1 (controls) is up and spoken', () => {
    const { vr, e, a } = mkEntry(); look.right = look.left = 90; vr.update(1000);
    const spoken = a.play.mock.calls.at(-1); spoken[1](); // the clip ended
    look.right = 5; vr.update(1100); expect(vr.entryPhase()).toBe('right'); // not yet: the dwell
    vr.update(1100 + LOOK_DWELL_MS + 1); expect(vr.entryPhase()).toBe('left'); expect(vr.entryBoard()).toBe('menu');
    expect(vr.page()).toMatchObject({ kind: 'entry', phase: 'left', text: I18N.ja.tutOrientLeft }); expect(a.play).toHaveBeenLastCalledWith([TUT_ORIENT.left.audio], expect.any(Function));
    expect(e.getState().mission).toBeNull();
    a.play.mock.calls.at(-1)[1](); look.right = 90; look.left = 5; vr.update(3000); vr.update(3000 + LOOK_DWELL_MS + 1);
    expect(vr.entryBoard()).toBeNull(); expect(vr.entryDone).toBe(true);
    expect(e.getState()).toMatchObject({ mission: 'controls', step: 0, finished: false }); expect(vr.page().kind).toBe('controls');
    expect(a.play).toHaveBeenLastCalledWith(['controls1']);
  });
  it('次へ goes on without turning (both phases) and signals do nothing during the guidance', () => {
    const { vr, e, a, sig } = mkEntry(); look.right = look.left = 90; vr.update(1000);
    sig('grab'); expect(e.getState().mission).toBeNull();
    expect(vr.act('skipAll')).toBe(false); expect(vr.act('list')).toBe(false); expect(e.getState().skipAll).toBe(false);
    expect(vr.act('next')).toBe(true); expect(vr.entryPhase()).toBe('left'); expect(vr.act('next')).toBe(true);
    expect(e.getState().mission).toBe('controls'); expect(vr.page().kind).toBe('controls');
  });
  it('the guidance waits for both boards to be in place (null angles) and shows its first page meanwhile; 次へ does nothing yet', () => {
    let up = false; const { vr, e } = mkEntry({ getLook: () => (up ? { right: 90, left: 90 } : { right: null, left: null }) });
    vr.update(1000); expect(vr.entryPending).toBe(true); expect(vr.entryPhase()).toBeNull(); expect(vr.entryBoard()).toBeNull(); expect(vr.page().kind).toBe('entry'); expect(vr.act('next')).toBe(false);
    up = true; vr.update(1100); expect(vr.entryPending).toBe(false); expect(vr.entryPhase()).toBe('right'); expect(e.getState().mission).toBeNull();
  });
  it('AR starts the same way (the guidance does not depend on the session kind): no getLook = it begins at once', () => {
    const { vr } = mkVr({ entry: true }); expect(vr.entryPhase()).toBe('right'); expect(vr.page().kind).toBe('entry');
  });
  it('the entry page: big text, the hint, a lit and pointed 次へ; the layout fits the 820 x 560 page', () => {
    const { vr } = mkVr({ entry: true }); const p = vr.page();
    expect(p.hint).toBe(I18N.ja.tutOrientHint); expect(p.counter).toBe('1/2'); expect(p.buttons).toHaveLength(1); expect(p.buttons[0]).toMatchObject({ id: 'next', label: '次へ', on: true, point: true });
    const w = layoutPage(p, { W: 820, H: 560 }); const labels = w.filter(x => x.type === 'label'), btn = buttons(w);
    expect(labels.map(l => l.text).join('')).toContain('右を見てください'); expect(btn).toHaveLength(1);
    for (const x of [...labels, ...btn]) expect(x.y, x.text || x.label).toBeLessThan(560);
    expect(btn[0].y + btn[0].h).toBeLessThanOrEqual(560); expect(Math.max(...labels.map(l => l.y))).toBeLessThan(btn[0].y);
    expect(w.some(x => x.type === 'draw')).toBe(true); // the pointer around 次へ
    const en = buildPage({ engine: eng(), lang: 'en', t: k => I18N.en[k], entry: { phase: 'left', index: 1, N: 2 } }); expect(en.text).toBe(I18N.en.tutOrientLeft); expect(en.counter).toBe('2/2');
  });
  it('wrapText keeps every line within the width (ja: 1 em per character, Latin 0.55 em) and loses no character', () => {
    for (const [txt, size] of [[I18N.ja.tutOrientRight, 44], [I18N.en.tutOrientRight, 44], [I18N.ja.tutFbGoNext, 32], [I18N.en.tutFbEnd, 32]]) {
      const lines = wrapText(txt, size, 748);
      expect(lines.join('').replace(/ /g, '')).toBe(txt.replace(/ /g, ''));
      for (const ln of lines) expect([...ln].reduce((a, c) => a + (/[\u0000-\u00ff]/.test(c) ? 0.55 : 1), 0) * size, ln).toBeLessThanOrEqual(748 + 1);
      expect(lines.length).toBeLessThanOrEqual(4);
    }
  });
});
describe('a cleared ステップ waits for 次へ', () => {
  it('ステップ1 cleared: 「ステップクリアです。」 then 「次のステップに進みましょう…次へ」 (spoken + on the page); the mission stays until 次へ; 次へ opens ステップ2', () => {
    const { vr, e, a } = mkVr(); a.play.mockClear(); vr.act('next');
    expect(a.play).toHaveBeenLastCalledWith(['mclear', 'gonext']);
    expect(e.getState()).toMatchObject({ mission: 'controls', finished: true });
    const p = vr.page(); expect(p).toMatchObject({ kind: 'missionDone', headline: 'ステップ完了', note: I18N.ja.tutFbGoNext }); expect(p.buttons[0]).toMatchObject({ id: 'start:grip', on: true, point: true });
    expect(I18N.ja.tutFbGoNext).toContain('「次へ」'); expect(TUT_FEEDBACK.goNext.audioText).toMatch(/つぎのステップ/);
    expect(layoutPage(p, {}).filter(x => x.type === 'label').map(l => l.text).join('')).toContain('次のステップに進みましょう');
    for (const x of buttons(layoutPage(p, {}))) expect(x.y + x.h).toBeLessThanOrEqual(560);
    a.play.mockClear(); expect(e.getState().mission).toBe('controls'); // nothing started by itself
    vr.act('start:grip'); expect(e.getState()).toMatchObject({ mission: 'grip', step: 0, finished: false }); expect(a.play).toHaveBeenLastCalledWith(['grip1']);
  });
  it('a ステップ cleared by its signals waits the same way; the pages inside a ステップ still go on by themselves', () => {
    const e = eng(); for (const id of ['controls', 'grip', 'section']) e.skipMission(id); const { vr, a } = mkVr({ engine: e }); e.start('menu'); a.play.mockClear();
    e.onSignal({ kind: 'seg-hide' }); expect(e.getState()).toMatchObject({ mission: 'menu', step: 1, finished: false }); // page 2 of the same ステップ: automatic, as before
    a.play.mockClear(); e.onSignal({ kind: 'seg-show' });
    expect(e.getState()).toMatchObject({ mission: 'menu', finished: true }); expect(a.play).toHaveBeenLastCalledWith(['mclear', 'gonext']); expect(vr.page().kind).toBe('missionDone');
    expect(vr.page().buttons[0].id).toBe('start:slice');
  });
  it('the last ステップ: allclear then the closing line; the page says it is over; no next button', () => {
    const e = eng(); e.skipMission('controls'); e.skipMission('grip'); e.skipMission('section'); e.skipMission('menu'); const { vr, a } = mkVr({ engine: e }); e.start('slice'); a.play.mockClear();
    for (const k of ['slice-opacity', 'slice-toggle', 'frame-hide']) e.onSignal({ kind: k });
    expect(a.play).toHaveBeenLastCalledWith(['allclear', 'end']);
    const p = vr.page(); expect(p).toMatchObject({ kind: 'allDone', note: I18N.ja.tutFbEnd }); expect(p.buttons.map(b => b.id)).not.toContain('next'); expect(p.buttons.some(b => b.id.startsWith('start:'))).toBe(false);
    expect(TUT_FEEDBACK.end.audioText).toMatch(/おわり/);
    for (const x of buttons(layoutPage(p, {}))) expect(x.y + x.h).toBeLessThanOrEqual(560);
  });
  it('the closing clips survive the end of the session like the other feedback; the new ids are all feedback ids', () => {
    for (const id of ['gonext', 'end', 'mclear', 'allclear', 'ok1']) expect(isFeedbackId(id), id).toBe(true);
    for (const id of ['orient1', 'orient2', 'controls1', 'intro1']) expect(isFeedbackId(id), id).toBe(false);
    const e = eng(); let last; e.subscribe(s => { last = s; }); e.start('controls'); e.next();
    expect(speechFor(last, e.currentStep(), '').ids).toEqual(['mclear', 'gonext']);
  });
  it('createTutorialAudio.play(ids, onEnd): onEnd runs once after the last clip, not when stopped or replaced', async () => {
    const { C } = fakeAudio(); const clips = []; const A = function (src) { const a = new C(src); clips.push(a); return a; };
    const au = createTutorialAudio({ AudioCtor: A, getVoice: () => 'F1' }); let n = 0;
    au.play(['a', 'b'], () => n++); expect(n).toBe(0); clips[0].onended(); expect(n).toBe(0); clips[1].onended(); expect(n).toBe(1); clips[1].onended?.();
    au.play(['c'], () => n++); au.stop(); clips[2].onended?.(); expect(n).toBe(1);
    au.play(['d'], () => n++); au.play(['e']); clips[3].onended?.(); expect(n).toBe(1);
    expect(createTutorialAudio({ AudioCtor: A, getVoice: () => 'off' }).play(['x'], () => n++)).toBe(false); expect(n).toBe(1);
  });
});
