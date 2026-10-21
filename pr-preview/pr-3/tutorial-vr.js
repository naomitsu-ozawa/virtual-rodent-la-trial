// チュートリアル on the VR help board (carousel: one page at a time). The board itself (vr-view.js makeMenu: grip move, ray hit) is the existing help board;
// this module owns what is on it while the tutorial is on: createTutorialVr() wires the engine (tutorial-engine.js) to the 'vrl-tut-signal' events, the voice
// (tutorial-audio.js) and the board's widgets. Pure apart from the injected engine / audio / document: unit-tested in tests/unit/tutorial-vr.test.js.
// On / off: settings key tutorialMode (default false; only the settings switch sets it, no URL parameter). Off = no engine is wired, no voice, no progress: the board shows the help (手順一覧) and
// a 詳細 tab that opens a READ-ONLY preview of the steps (createTutorialPreview: its own cursor, nothing advances, nothing is saved, nothing is spoken).
// the board has one tab strip under the page (panelTabs): 手順一覧 | 詳細. The unit is called ステップN (stepNoLabel); the pages inside a step are n/N only.
import { getTutorialEngine, resetTutorialAll } from './tutorial-ui.js?v=20261021-build641';
import { createTutorialAudio, createStepReplay, speechFor, isFeedbackId } from './tutorial-audio.js?v=20261021-build641';
import { resetPress, resetArmed, wrapWords } from './event-mode.js?v=20261021-build641';
import { I18N, tr } from './i18n.js?v=20261021-build641';
import { TUTORIAL_MISSIONS } from './tutorial-data.js?v=20261021-build641';

export const FLASH_MS = 1100;
export function tutorialModeOn(api = globalThis.__vrlSettings) {
  try { return api?.get?.('tutorialMode') === true; } catch { return false; }
}
// the wording of a step for the input in use: hint.ctrl (controllers) / hint.hand (hand tracking) when the step has one, else its common text
export function stepTextKey(step, input) {
  if (!step) return null;
  const h = step.hint, k = h && (input === 'hand' ? h.hand : h.ctrl);
  return k || step.text;
}
// ja text always; the English line only when the UI language is en (English = subtitle)
export function stepTexts(key, lang, dict = I18N) {
  if (!key) return { text: '', sub: '' };
  const ja = dict.ja?.[key] ?? key;
  return { text: ja, sub: lang === 'ja' ? '' : (dict.en?.[key] ?? '') };
}
const BTN = (id, label, o = {}) => ({ id, label, ...o });
// 'ステップ3' / 'Step 3': the word of the language (tutStepWord) + the fixed number (M1..M7 = 1..7)
export const stepNoLabel = (n, t = tr) => { const w = t('tutStepWord'); return /[A-Za-z]$/.test(w) ? `${w} ${n}` : `${w}${n}`; };
// the tab strip under the board (the board is TAB_H taller than the 560 px page): 「手順一覧」 (= the existing help: the list of controls) | 「詳細」 (= the step slides). which = what is shown now
// ('list' | 'detail'); that tab is lit, the other one switches (act(which)). The tutorial switch on starts on 詳細, off starts on 手順一覧 (and 詳細 is then a read-only preview).
export const TAB_H = 72;
export function panelTabs(which, { W = 820, H = 560, act = () => {}, t = tr } = {}) {
  const M = 36, gap = 16, w = (W - 2 * M - gap) / 2, y = H + 8, h = TAB_H - 16;
  return [['list', t('tutPanelList')], ['detail', t('tutPanelDetail')]].map(([id, label], i) => ({ x: M + i * (w + gap), y, w, h, label, size: 28, on: which === id, action: () => act(id) }));
}
// The page model of the board from an engine snapshot. kind: 'list' | 'step' | 'missionDone' | 'allDone'. buttons: [{id,label,disabled?,on?,warn?,size?}] in display order.
export function buildPage({ engine, view = 'auto', input = 'ctrl', lang = 'ja', resetArmed: armed = false, t = tr, dict = I18N }) {
  const snap = engine.getState(), list = engine.listMissions(), pi = engine.pageInfo();
  const resetBtn = BTN('reset', armed ? t('tutResetAgain') : t('tutReset'), { warn: armed, size: 24 });
  const skipAllBtn = BTN('skipAll', t('tutSkipAll'), { size: 24 });
  const nameOf = m => `${stepNoLabel(m.stepNo, t)} ${t(m.title)}`, titleOf = id => { const m = list.find(x => x.id === id); return m ? nameOf(m) : ''; };
  if (view === 'list' || !snap.mission) {
    return { kind: 'list', title: t('tutTitle'), counter: '', missions: list.map(m => ({ id: m.id, label: nameOf(m), status: m.status, done: m.done, current: m.current })),
      buttons: [skipAllBtn, resetBtn] };
  }
  const mission = list.find(m => m.id === snap.mission), title = nameOf(mission);
  if (snap.finished) {
    const next = engine.nextMissionId();
    if (!next && engine.listMissions().every(m => m.status === 'unavailable' || m.done || m.optional)) {
      return { kind: 'allDone', title, mark: t('tutDone'), headline: t('tutAllDone'), counter: '', buttons: [BTN('list', t('tutTitle')), BTN('prev', t('tutPrev')), resetBtn] };
    }
    return { kind: 'missionDone', title, mark: t('tutDone'), headline: t('tutMissionDone'), counter: pi ? `${pi.N}/${pi.N}` : '',
      buttons: [...(next ? [BTN('start:' + next, `${t('tutNext')}: ${titleOf(next)}`, { on: true })] : []), BTN('list', t('tutTitle')), BTN('prev', t('tutPrev'))] };
  }
  const step = engine.currentStep(), tx = stepTexts(stepTextKey(step, input), lang, dict);
  const marks = []; for (let i = 0; i < pi.N; i++) marks.push(i < pi.n - 1 ? t('tutDone') : i === pi.n - 1 ? '●' : '○');
  return { kind: 'step', title, counter: `${pi.n}/${pi.N}`, marks: marks.join(' '), text: tx.text, sub: tx.sub,
    buttons: [BTN('prev', t('tutPrev'), { disabled: !pi.hasPrev }), BTN('next', pi.isLast ? t('tutFinish') : t('tutNext'), { on: true }),
      BTN('skipMission', t('tutSkipMission'), { size: 24 }), skipAllBtn, BTN('list', t('tutTitle'), { size: 24 }), resetBtn] };
}
// canvas widgets (makeMenu's vocabulary: label / button) of a page on a W x H board. act(id) is called by a pressed button; flash = {mark,text} while the ✓ flash is up.
export function layoutPage(page, { W = 820, H = 560, measure = () => 0, act = () => {}, flash = null } = {}) {
  const w = [], lab = (x, y, text, o = {}) => w.push({ type: 'label', x, y, text, ...o });
  const M = 36, inner = W - 2 * M, gap = 16, half = (inner - gap) / 2;
  const btn = (b, x, y, bw, bh) => w.push({ x, y, w: bw, h: bh, label: b.label, size: b.size || 30, disabled: !!b.disabled, on: !!b.on, color: b.warn ? '#c0392b' : b.color, action: () => act(b.id) });
  const row = (bs, y, h) => bs.forEach((b, i) => btn(b, M + i * (half + gap), y, half, h));
  lab(M, 46, page.title, { bold: true, size: 28, color: '#ffd27a' });
  if (page.counter) lab(W - M - 90, 46, page.counter, { bold: true, size: 30, color: '#fff' });
  if (page.kind === 'list') {
    page.missions.forEach((m, i) => {
      const col = i % 2, r = (i / 2) | 0, mark = m.done ? '✓' : m.status === 'available' ? '▶' : '－';
      btn({ label: `${mark} ${m.label}`, disabled: m.status === 'locked' || m.status === 'unavailable', on: m.done, color: m.done ? '#2f8f5b' : undefined, size: 28, id: 'start:' + m.id },
        M + col * (half + gap), 84 + r * 76, half, 64);
    });
    row(page.buttons, H - 70, 52);
    return w;
  }
  if (page.kind === 'step') {
    lab(M, 96, page.marks, { size: 30, color: '#7fd1a0' });
    const tl = wrapWords(page.text, inner, z => measure(z, 32)).slice(0, 4);
    lab(M, 150, '', { lines: tl, lh: 42, size: 32, color: '#fff' });
    if (page.sub) lab(M, 150 + tl.length * 42 + 22, '', { lines: wrapWords(page.sub, inner, z => measure(z, 24)).slice(0, 2), lh: 30, size: 24, color: '#9fb3c3' });
    row(page.buttons.slice(0, 2), H - 200, 64); row(page.buttons.slice(2, 4), H - 130, 52); row(page.buttons.slice(4, 6), H - 70, 52);
  } else {
    lab(M, 150, `${page.mark} ${page.headline}`, { bold: true, size: 44, color: '#7fd1a0' });
    lab(M, 210, page.title, { size: 30, color: '#cfe3f0' });
    page.buttons.forEach((b, i) => btn(b, M, 250 + i * 76, inner, 64));
  }
  if (flash) { lab(W - M - 150, 110, flash.mark, { bold: true, size: 96, color: '#7fd1a0' }); if (flash.text) lab(M, H - 224, flash.text, { size: 26, color: '#7fd1a0' }); }
  return w;
}
// the live controller. env: {engine?, audio?, getInput() -> 'ctrl'|'hand', lang, doc (EventTarget), now()}
// ONE place that gets the engine: tutorial-ui.js getTutorialEngine (the page's single engine, kept on globalThis.__vrlTutorialEngine; it also wires the signals once)
export function getEngine(opts = {}) { return getTutorialEngine(opts); }
export function createTutorialVr({ engine, audio, getInput = () => 'ctrl', lang = 'ja', doc = globalThis.document, now = () => performance.now(), onChange = () => {}, arAvailable = false, moveTracker = null, resetUserState = null } = {}) {
  const eng = engine || getEngine({ arAvailable });
  const voice = audio || createTutorialAudio({ getVoice: () => { try { return globalThis.__vrlSettings?.get?.('tutorialVoice') || 'F1'; } catch { return 'F1'; } } });
  let view = 'auto', rev = 1, armedUntil = 0, flashUntil = 0, flash = null, spoken = '';
  const replay = createStepReplay(() => { const s = eng.currentStep(); if (s && !eng.getState().finished) voice.play([s.audio]); });
  const bump = () => { rev++; onChange(); };
  // 'move' fires once per tracker life: re-arm it each time a step that waits for 'move' is entered (board start, 前へ, 最初から, ...); null tracker = nothing
  let moveKey = '';
  const armMove = snap => {
    const s = snap && !snap.finished && snap.mission ? eng.currentStep() : null, k = s && s.done && s.done.signal === 'move' ? `${snap.mission}:${snap.step}` : '';
    if (k && k !== moveKey) { try { moveTracker?.reset?.(); } catch { /* */ } }
    moveKey = k;
  };
  const unsub = eng.subscribe(snap => {
    armMove(snap);
    const sp = speechFor(snap, eng.currentStep(), spoken); spoken = sp.key;
    if (snap.feedback === 'stepClear' || snap.feedback === 'missionClear' || snap.feedback === 'allClear') {
      flashUntil = now() + FLASH_MS; flash = { mark: tr('tutDone'), text: snap.feedbackItem ? tr(snap.feedbackItem.text) : '' };
    }
    if (sp.ids.length) voice.play(sp.ids);
    const s = eng.currentStep(); if (s && !snap.finished) replay.reset(now(), s.timeoutHint); else replay.stop();
    bump();
  });
  const modeOff = () => { try { const a = globalThis.__vrlSettings; return !!a?.get && a.get('tutorialMode') !== true; } catch { return false; } }; // the switch is off: signals move nothing (no api = a test / no settings: not off)
  const onSignal = e => { try { if (!modeOff()) eng.onSignal(e.detail); } catch { /* */ } };
  // the page side (tutorial-ui.js getTutorialEngine) wires the signals once and sets __vrlTutSignalWired; only when nobody wired yet does this board wire itself (never twice: double counting)
  const ownWire = !globalThis.__vrlTutSignalWired; if (ownWire) { try { globalThis.__vrlTutSignalWired = true; } catch { /* */ } doc?.addEventListener?.('vrl-tut-signal', onSignal); }
  { const s = eng.currentStep(), st = eng.getState(); armMove(st); if (s && !st.finished) { spoken = `${st.mission}:${st.step}:0`; voice.play([s.audio]); replay.reset(now(), s.timeoutHint); } }
  function act(id) {
    if (id.startsWith('start:')) { view = 'auto'; moveKey = ''; eng.start(id.slice(6)); bump(); return true; } // moveKey '' = the start re-arms even when the step key is unchanged
    switch (id) {
      case 'prev': return eng.prev();
      case 'next': return eng.next();
      case 'skipMission': return eng.skipMission();
      case 'skipAll': return eng.skipAll();
      case 'list': view = 'list'; bump(); return true;
      case 'reset': { const r = resetPress(armedUntil, now()); armedUntil = r.armedUntil; if (r.fire) { view = 'list'; resetTutorialAll({ engine: eng, resetUserState }); } else bump(); return r.fire; }
    }
    return false;
  }
  return {
    engine: eng, act, get rev() { return rev; },
    page: () => buildPage({ engine: eng, view, input: getInput(), lang, resetArmed: resetArmed(armedUntil, now()) }),
    widgets: (opts = {}) => layoutPage(buildPage({ engine: eng, view, input: getInput(), lang, resetArmed: resetArmed(armedUntil, now()) }), { ...opts, act, flash: now() < flashUntil ? flash : null }),
    // per frame: expire the reset arm / the ✓ flash (redraw), replay the voice after a quiet period
    update(t = now()) {
      if (armedUntil && t >= armedUntil) { armedUntil = 0; bump(); }
      if (flashUntil && t >= flashUntil) { flashUntil = 0; flash = null; bump(); }
      replay.tick(t);
    },
    drawKey: () => `${rev}|${getInput()}|${armedUntil ? 1 : 0}|${flashUntil ? 1 : 0}`,
    dispose() { unsub(); if (ownWire) { doc?.removeEventListener?.('vrl-tut-signal', onSignal); try { globalThis.__vrlTutSignalWired = false; } catch { /* */ } } if (typeof voice.settle === 'function') voice.settle(isFeedbackId); else voice.stop(); replay.stop(); }, // the ✓ feedback that the closing signal (session-end) just earned is not cut off
  };
}

// the READ-ONLY preview of the steps (the board's チュートリアル view while the tutorial switch is OFF). No engine, no signals, no voice, no storage: only a cursor
// (list / one page of one step) that 前へ / 次へ / 一覧 move. Pages are built from tutorial-data.js, the same texts as the real tutorial (hint.ctrl / hint.hand by the input in use).
export function createTutorialPreview({ missions = TUTORIAL_MISSIONS, getInput = () => 'ctrl', lang = 'ja', onChange = () => {} } = {}) {
  let mi = -1, si = 0, rev = 1;
  const bump = () => { rev++; onChange(); };
  function page(t = tr, dict = I18N) {
    if (mi < 0) return { kind: 'list', title: t('tutTitle'), counter: '', missions: missions.map((m, i) => ({ id: m.id, label: `${stepNoLabel(i + 1, t)} ${t(m.title)}`, status: 'available', done: false, current: false })), buttons: [] };
    const m = missions[mi], N = m.steps.length, tx = stepTexts(stepTextKey(m.steps[si], getInput()), lang, dict);
    const marks = []; for (let i = 0; i < N; i++) marks.push(i < si ? t('tutDone') : i === si ? '●' : '○');
    return { kind: 'step', title: `${stepNoLabel(mi + 1, t)} ${t(m.title)}`, counter: `${si + 1}/${N}`, marks: marks.join(' '), text: tx.text, sub: tx.sub,
      buttons: [BTN('prev', t('tutPrev'), { disabled: si === 0 }), BTN('next', si === N - 1 ? t('tutFinish') : t('tutNext'), { on: true }), BTN('list', t('tutTitle'), { size: 24 })] };
  }
  function act(id) {
    if (id.startsWith('start:')) { const i = missions.findIndex(m => m.id === id.slice(6)); if (i < 0) return false; mi = i; si = 0; bump(); return true; }
    if (mi < 0) return false;
    switch (id) {
      case 'prev': if (si > 0) { si--; bump(); return true; } return false;
      case 'next': if (si < missions[mi].steps.length - 1) si++; else mi = -1; bump(); return true; // the last page's 完了 goes back to the list
      case 'list': mi = -1; si = 0; bump(); return true;
    }
    return false;
  }
  return { act, page, get rev() { return rev; }, widgets: (opts = {}) => layoutPage(page(), { ...opts, act }), drawKey: () => `${rev}|${getInput()}` };
}
