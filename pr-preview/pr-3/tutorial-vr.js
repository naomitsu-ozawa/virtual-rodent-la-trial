import { getTutorialEngine, resetTutorialAll, continueTutorial } from './tutorial-ui.js?v=20261022-build642';
import { createTutorialAudio, createStepReplay, createChime, speechFor, isFeedbackId } from './tutorial-audio.js?v=20261022-build642';
import { resetPress, resetArmed } from './event-mode.js?v=20261022-build642';
import { tr } from './i18n.js?v=20261022-build642';
import { TUTORIAL_MISSIONS, TUT_SAMPLE } from './tutorial-data.js?v=20261022-build642';
import { GUIDE_SLIDES, guideSlide, slideItem, itemRect, loc, createSlideImages, SLIDE_W, SLIDE_H } from './tutorial-slides.js?v=20261022-build642';
import { drawPointer, drawKnobHint, drawStepFrame, drawDoneMark, animPhase, animKey, GOLD } from './tutorial-marks.js?v=20261022-build642';

export const FLASH_MS = 1100;
export function tutorialModeOn(api = globalThis.__vrlSettings) {
  try { return api?.get?.('tutorialMode') === true; } catch { return false; }
}
const BTN = (id, label, o = {}) => ({ id, label, ...o });
// 'ステップ3' / 'Step 3': the word of the language (tutStepWord) + the fixed number (1..5)
export const stepNoLabel = (n, t = tr) => { const w = t('tutStepWord'); return /[A-Za-z]$/.test(w) ? `${w} ${n}` : `${w}${n}`; };
// 'A：B' (ja) / 'A: B' (en)
const joinTitle = (a, b, lang) => `${a}${lang === 'en' ? ': ' : '：'}${b}`;
// the tab strip under the board (the board is TAB_H taller than the 560 px page): 「手順一覧」 (= the existing help: the list of controls) | 「詳細」 (= the step slides). which = what is shown now
// ('list' | 'detail'); that tab is lit, the other one switches (act(which)). The live tutorial starts on 詳細, otherwise 手順一覧 (and 詳細 is then the read-only guide).
export const TAB_H = 72;
export function panelTabs(which, { W = 820, H = 560, act = () => {}, t = tr } = {}) {
  const M = 36, gap = 16, w = (W - 2 * M - gap) / 2, y = H + 8, h = TAB_H - 16;
  return [['list', t('tutPanelList')], ['detail', t('tutPanelDetail')]].map(([id, label], i) => ({ x: M + i * (w + gap), y, w, h, label, size: 28, on: which === id, action: () => act(id) }));
}
// The page model of the board from an engine snapshot. kind: 'list' | 'step' | 'controls' | 'missionDone' | 'allDone'. buttons: [{id,label,disabled?,on?,warn?,size?,point?}] in display order.
// A step / controls page: slide = the slide shown (its picture), item = its numbered row to frame (null: none), done = the rows to mark ✓ (the earlier pages' rows, not the current one).
export function buildPage({ engine, view = 'auto', lang = 'ja', resetArmed: armed = false, t = tr, missions = TUTORIAL_MISSIONS }) {
  const snap = engine.getState(), list = engine.listMissions(), pi = engine.pageInfo();
  const resetBtn = BTN('reset', armed ? t('tutResetAgain') : t('tutReset'), { warn: armed, size: 24 });
  const skipAllBtn = BTN('skipAll', t('tutSkipAll'), { size: 24 });
  const nameOf = m => `${stepNoLabel(m.stepNo, t)} ${t(m.title)}`, titleOf = id => { const m = list.find(x => x.id === id); return m ? nameOf(m) : ''; };
  if (view === 'list' || !snap.mission) {
    return { kind: 'list', title: t('tutTitle'), counter: '', missions: list.map(m => ({ id: m.id, label: nameOf(m), status: m.status, done: m.done, current: m.current })),
      buttons: [BTN('guides', t('tutGuides'), { size: 26 }), skipAllBtn, resetBtn] };
  }
  const mission = list.find(m => m.id === snap.mission), title = nameOf(mission), data = missions.find(m => m.id === snap.mission);
  if (snap.finished) {
    const next = engine.nextMissionId();
    if (!next && engine.listMissions().every(m => m.status === 'unavailable' || m.done || m.optional)) {
      return { kind: 'allDone', title, mark: t('tutDone'), headline: t('tutAllDone'), counter: '', buttons: [BTN('list', t('tutStepList')), BTN('prev', t('tutPrev')), resetBtn] };
    }
    return { kind: 'missionDone', title, mark: t('tutDone'), headline: t('tutMissionDone'), counter: pi ? `${pi.N}/${pi.N}` : '',
      buttons: [...(next ? [BTN('start:' + next, `${t('tutNext')}: ${titleOf(next)}`, { on: true, point: true })] : []), BTN('list', t('tutStepList')), BTN('prev', t('tutPrev'))] };
  }
  const step = engine.currentStep();
  // one row: a page finished by 次へ (step.next) has it lit with the pointer; on a page with a signal 次へ only steps over the page (plain button)
  const listBtn = BTN('list', t('tutStepList'), { size: 26 });
  const nextBtn = BTN('next', step.next ? t('tutNext') : pi.isLast ? t('tutFinish') : t('tutNext'), { on: !!step.next, point: !!step.next });
  const slide = data?.slide || null, item = step.item || null;
  if (slide === 'controls') return { kind: 'controls', title, counter: `${pi.n}/${pi.N}`, slide, item: null, done: [], buttons: [listBtn, skipAllBtn, nextBtn] };
  const done = [...new Set((data?.steps || []).slice(0, pi.n - 1).map(s => s.item).filter(n => n && n !== item))];
  return { kind: 'step', title, counter: `${pi.n}/${pi.N}`, slide, item, done,
    buttons: [BTN('prev', t('tutPrev'), { disabled: !pi.hasPrev }), BTN('skipMission', t('tutSkipMission'), { size: 24 }), listBtn, nextBtn] };
}
const M = 36;
// where the slide picture sits on a W x H page (under the title row, above the button row): 16:9, the full width but 18 px
export const slideBox = (W = 820) => { const w = W - 36; return { x: 18, y: 52, w, h: Math.round(w * SLIDE_H / SLIDE_W) }; };
// the picture (or, until it has loaded / if it failed, its place in the slide's own background colour) in a box, corners rounded
function slideWidget(id, box, getImage, r = 14) {
  const img = id ? getImage(id) : null;
  return { type: 'draw', slide: id, loaded: !!img, draw: ctx => {
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, r); else ctx.rect(box.x, box.y, box.w, box.h);
    if (img) { ctx.save(); ctx.clip(); ctx.drawImage(img, box.x, box.y, box.w, box.h); ctx.restore(); } else { ctx.fillStyle = '#14213D'; ctx.fill(); }
  } };
}
// the marks of a step page on the picture: the frame around the row of the step now, the ✓ over the number badge (60 x 60 slide px at the row's top left) of the rows done
function markWidgets(slide, item, done, box, phase) {
  const w = [], kx = box.w / SLIDE_W, ky = box.h / SLIDE_H;
  for (const n of done || []) {
    const r = slideItem(slide, n); if (!r) continue;
    const cx = box.x + (r.x + 30) * kx, cy = box.y + (r.y + 30) * ky, rad = 30 * kx;
    w.push({ type: 'draw', tut: 'done:' + n, draw: ctx => drawDoneMark(ctx, { cx, cy, r: rad }) });
  }
  const r = item ? slideItem(slide, item) : null;
  if (r) { const f = itemRect(r, box); w.push({ type: 'draw', tut: 'item:' + item, rect: f, draw: ctx => drawStepFrame(ctx, { ...f, phase }) }); }
  return w;
}
const noImage = () => null;
// canvas widgets (makeMenu's vocabulary: label / button / draw) of a page on a W x H board. act(id) is called by a pressed button; flash = {mark,text} while the ✓ flash is up;
// phase = the blink phase (0 bright / 0.5 dim) of the marks and the pointer; getImage(id) = the slide's picture element or null (not loaded yet).
export function layoutPage(page, { W = 820, H = 560, act = () => {}, flash = null, phase = 0, getImage = noImage } = {}) {
  const w = [], lab = (x, y, text, o = {}) => w.push({ type: 'label', x, y, text, ...o });
  const inner = W - 2 * M, gap = 16, half = (inner - gap) / 2;
  const btn = (b, x, y, bw, bh) => { w.push({ x, y, w: bw, h: bh, label: b.label, size: b.size || 30, disabled: !!b.disabled, on: !!b.on, color: b.warn ? '#c0392b' : b.color, action: () => act(b.id) });
    if (b.point && !b.disabled) w.push({ type: 'draw', draw: ctx => drawPointer(ctx, { x, y, w: bw, h: bh, phase, from: null }) }); };
  const row = (bs, y, h) => { const n = bs.length, bw = (inner - (n - 1) * gap) / n; bs.forEach((b, i) => btn(b, M + i * (bw + gap), y, bw, h)); };
  if (page.kind === 'list') {
    lab(M, 40, page.title, { bold: true, size: 28, color: GOLD });
    page.missions.forEach((m, i) => {
      const col = i % 2, r = (i / 2) | 0, mark = m.done ? '✓' : m.status === 'available' ? '▶' : '－';
      btn({ label: `${mark} ${m.label}`, disabled: m.status === 'locked' || m.status === 'unavailable', on: m.done, color: m.done ? '#2f8f5b' : undefined, size: 26, id: 'start:' + m.id },
        M + col * (half + gap), 76 + r * 76, half, 64);
    });
    row(page.buttons, H - 72, 58);
    return w;
  }
  if (page.kind === 'controls' || page.kind === 'step') {
    const box = slideBox(W);
    lab(M, 30, page.title, { bold: true, size: 26, color: GOLD });
    if (page.counter) lab(W - M - 64, 30, page.counter, { bold: true, size: 28, color: '#fff' });
    w.push(slideWidget(page.slide, box, getImage));
    w.push(...markWidgets(page.slide, page.item, page.done, box, phase));
    row(page.buttons, box.y + box.h + 8, H - (box.y + box.h + 8) - 6);
  } else {
    lab(M, 40, page.title, { bold: true, size: 28, color: GOLD });
    if (page.counter) lab(W - M - 80, 40, page.counter, { bold: true, size: 30, color: '#fff' });
    lab(M, 150, `${page.mark} ${page.headline}`, { bold: true, size: 44, color: '#7fd1a0' });
    lab(M, 210, page.title, { size: 30, color: '#cfe3f0' });
    page.buttons.forEach((b, i) => btn(b, M, 250 + i * 76, inner, 64));
  }
  if (flash) { // the ✓ flash: a dark box in the middle of the picture
    const fx = W / 2 - 160, fy = 150;
    w.push({ type: 'draw', tut: 'flash', draw: ctx => { ctx.fillStyle = 'rgba(14,20,27,.9)'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(fx, fy, 320, 150, 20); else ctx.rect(fx, fy, 320, 150); ctx.fill(); } });
    lab(fx + 24, fy + 78, flash.mark, { bold: true, size: 96, color: '#7fd1a0' }); if (flash.text) lab(fx + 120, fy + 78, flash.text, { size: 28, bold: true, color: '#7fd1a0' });
  }
  return w;
}
// the live controller. env: {engine?, audio?, getInput() -> 'ctrl'|'hand', lang, doc (EventTarget), now()}
// ONE place that gets the engine: tutorial-ui.js getTutorialEngine (the page's single engine, kept on globalThis.__vrlTutorialEngine; it also wires the signals once)
export function getEngine(opts = {}) { return getTutorialEngine(opts); }
export function createTutorialVr({ engine, audio, chime, getImage, getInput = () => 'ctrl', lang = 'ja', doc = globalThis.document, now = () => performance.now(), onChange = () => {}, resetUserState = null } = {}) {
  const eng = engine || getEngine();
  // the board opens on a step, never on an empty list: no step under way = the next one not done starts (ステップ1 = the controls slide on a first visit)
  if (!eng.getState().mission) { try { continueTutorial(eng); } catch { /* */ } }
  const getVoice = () => { try { return globalThis.__vrlSettings?.get?.('tutorialVoice') || 'F1'; } catch { return 'F1'; } };
  const voice = audio || createTutorialAudio({ getVoice }), ding = chime || createChime({ getVoice });
  let view = 'auto', rev = 1, armedUntil = 0, flashUntil = 0, flash = null, spoken = '', changedAt = now();
  const replay = createStepReplay(() => { const s = eng.currentStep(); if (s && !eng.getState().finished) voice.play([s.audio]); });
  const bump = () => { rev++; changedAt = now(); onChange(); };
  // the slide pictures: loaded on first use; one arriving redraws the board (bump)
  const pics = getImage ? null : createSlideImages({ onLoad: () => bump() }), image = getImage || (id => pics.get(id));
  const guides = createSlideViewer({ lang, onChange: bump, onClose: () => { view = 'list'; bump(); }, getImage });
  const unsub = eng.subscribe(snap => {
    const sp = speechFor(snap, eng.currentStep(), spoken); spoken = sp.key;
    if (snap.feedback === 'stepClear' || snap.feedback === 'missionClear' || snap.feedback === 'allClear') {
      flashUntil = now() + FLASH_MS; flash = { mark: tr('tutDone'), text: snap.feedbackItem ? tr(snap.feedbackItem.text) : '' };
      try { ding.play(); } catch { /* */ } // the success sound with the ✓
    }
    if (sp.ids.length) voice.play(sp.ids);
    const s = eng.currentStep(); if (s && !snap.finished) replay.reset(now(), s.timeoutHint); else replay.stop();
    bump();
  });
  const modeOff = () => { try { const a = globalThis.__vrlSettings; return !!a?.get && a.get('tutorialMode') !== true; } catch { return false; } }; // the switch is off: signals move nothing (no api = a test / no settings: not off)
  const otherData = () => { const o = globalThis.__vrlOpenSample; return o != null && o !== TUT_SAMPLE; }; // another dataset is open: signals move nothing
  const onSignal = e => { try { if (!modeOff() && !otherData()) eng.onSignal(e.detail); } catch { /* */ } };
  // the page side (tutorial-ui.js getTutorialEngine) wires the signals once and sets __vrlTutSignalWired; only when nobody wired yet does this board wire itself (never twice: double counting)
  const ownWire = !globalThis.__vrlTutSignalWired; if (ownWire) { try { globalThis.__vrlTutSignalWired = true; } catch { /* */ } doc?.addEventListener?.('vrl-tut-signal', onSignal); }
  { const s = eng.currentStep(), st = eng.getState(); if (s && !st.finished) { spoken = `${st.mission}:${st.step}:0`; voice.play([s.audio]); replay.reset(now(), s.timeoutHint); } }
  function act(id) {
    if (view === 'guides') return guides.act(id);
    if (id.startsWith('start:')) { view = 'auto'; eng.start(id.slice(6)); bump(); return true; }
    switch (id) {
      case 'prev': return eng.prev();
      case 'next': return eng.next();
      case 'skipMission': return eng.skipMission();
      case 'skipAll': return eng.skipAll();
      case 'list': view = 'list'; bump(); return true;
      case 'guides': view = 'guides'; guides.open(); bump(); return true;
      case 'reset': { const r = resetPress(armedUntil, now()); armedUntil = r.armedUntil; if (r.fire) { view = 'list'; resetTutorialAll({ engine: eng, resetUserState }); } else bump(); return r.fire; }
    }
    return false;
  }
  const page = () => buildPage({ engine: eng, view, lang, resetArmed: resetArmed(armedUntil, now()) });
  // the page blinks (the frame of the step's row / the pointer of a lit button) while a step page with a row to frame or a lit 次へ is up (and only for ANIM_IDLE_MS after a change)
  const animated = p => (p.kind === 'step' || p.kind === 'controls' || p.kind === 'missionDone') && (!!p.item || p.buttons.some(b => b.point));
  // the かんたんメニュー widget to light for the page up now (null: none): 'seg-hide' | 'seg-show' | 'slider'
  const menuTargetNow = () => { const st = eng.getState(); if (view !== 'auto' || !st.mission || st.finished) return null; return eng.currentStep()?.menu || null; };
  // per-frame questions (drawKey / menuKey) are answered from a cache that is rebuilt only when the board changed (rev) or the input did: no page model per frame
  let cRev = -1, cIn = '', cAnim = false, cMenu = null;
  const cache = () => { const inp = getInput(); if (cRev !== rev || cIn !== inp) { cRev = rev; cIn = inp; const p = view === 'guides' ? null : page(); cAnim = !!p && animated(p); cMenu = menuTargetNow(); } };
  const menuTarget = () => { cache(); return cMenu; };
  return {
    engine: eng, act, get rev() { return rev; }, page, menuTarget,
    widgets: (opts = {}) => {
      if (view === 'guides') return guides.widgets(opts);
      return layoutPage(page(), { ...opts, act, flash: now() < flashUntil ? flash : null, phase: animPhase(now(), changedAt), getImage: image });
    },
    // per frame: expire the reset arm / the ✓ flash (redraw), replay the voice after a quiet period
    update(t = now()) {
      if (armedUntil && t >= armedUntil) { armedUntil = 0; bump(); }
      if (flashUntil && t >= flashUntil) { flashUntil = 0; flash = null; bump(); }
      replay.tick(t);
    },
    drawKey: (t = now()) => { cache(); return `${rev}|${cIn}|${armedUntil ? 1 : 0}|${flashUntil ? 1 : 0}|${view === 'guides' ? 'g' + guides.drawKey() : cAnim ? animKey(t, changedAt) : ''}`; },
    // the menu's redraw key: the target and the blink step ('' = nothing to light: the menu is drawn as before); still 20 s after the board last changed
    menuKey: (t = now()) => { const m = menuTarget(); return m ? m + animKey(t, changedAt) : ''; },
    menuPhase: (t = now()) => animPhase(t, changedAt),
    dispose() { unsub(); if (ownWire) { doc?.removeEventListener?.('vrl-tut-signal', onSignal); try { globalThis.__vrlTutSignalWired = false; } catch { /* */ } } if (typeof voice.settle === 'function') voice.settle(isFeedbackId); else voice.stop(); replay.stop(); }, // the ✓ feedback that the closing signal (session-end) just earned is not cut off
  };
}

// the READ-ONLY operation guide (the deck's slides controls, g1, g2, g3, g3b, g4 as pictures: tutorial-slides.js). No engine, no signals, no voice, no storage: only a
// cursor (the list of slides / one slide) that 前へ / 次へ / 一覧 move. It is the help board's 詳細 while the live tutorial is not running, and 操作ガイド（見るだけ） inside the tutorial.
export function buildSlidePage(slide, { i = 0, N = GUIDE_SLIDES.length, lang = 'ja', t = tr } = {}) {
  return { kind: 'slide', id: slide.id, slide: slide.id, title: joinTitle(t('tutGuideWord'), loc(slide.title, lang), lang), counter: `${i + 1}/${N}`,
    buttons: [BTN('prev', t('tutPrev'), { disabled: i === 0 }), BTN('next', t('tutNext'), { disabled: i === N - 1, on: i < N - 1 }), BTN('list', t('tutGuides'), { size: 24 })] };
}
export function layoutSlidePage(page, { W = 820, H = 560, act = () => {}, getImage = noImage } = {}) {
  const w = [], inner = W - 2 * M, gap = 16, box = slideBox(W);
  w.push({ type: 'label', x: M, y: 30, text: page.title, bold: true, size: 26, color: GOLD });
  w.push({ type: 'label', x: W - M - 64, y: 30, text: page.counter, bold: true, size: 28, color: '#fff' });
  w.push(slideWidget(page.slide, box, getImage));
  const n = page.buttons.length, bw = (inner - (n - 1) * gap) / n, by = box.y + box.h + 8;
  page.buttons.forEach((b, i) => w.push({ x: M + i * (bw + gap), y: by, w: bw, h: H - by - 6, label: b.label, size: b.size || 28, disabled: !!b.disabled, on: !!b.on, action: () => act(b.id) }));
  return w;
}
export function createSlideViewer({ slides = GUIDE_SLIDES, lang = 'ja', onChange = () => {}, onClose = null, getImage = null } = {}) {
  let i = -1, rev = 1; // -1 = the list of slides
  const bump = () => { rev++; onChange(); };
  const pics = getImage ? null : createSlideImages({ onLoad: () => bump() }), image = getImage || (id => pics.get(id));
  function page(t = tr) {
    if (i < 0) return { kind: 'slideList', title: t('tutGuides'), counter: '', slides: slides.map((s, k) => ({ id: s.id, label: `${k + 1}. ${loc(s.title, lang)}` })), buttons: onClose ? [BTN('close', t('tutTitle'), { size: 26 })] : [] };
    return buildSlidePage(slides[i], { i, N: slides.length, lang, t });
  }
  function act(id) {
    if (id === 'close') { i = -1; onClose?.(); return true; }
    if (id.startsWith('slide:')) { const k = slides.findIndex(s => s.id === id.slice(6)); if (k < 0) return false; i = k; bump(); return true; }
    if (i < 0) return false;
    switch (id) {
      case 'prev': if (i > 0) { i--; bump(); return true; } return false;
      case 'next': if (i < slides.length - 1) { i++; bump(); return true; } return false;
      case 'list': i = -1; bump(); return true;
    }
    return false;
  }
  function widgets({ W = 820, H = 560 } = {}) {
    const p = page();
    if (p.kind === 'slideList') {
      const w = [{ type: 'label', x: M, y: 40, text: p.title, bold: true, size: 28, color: GOLD }], inner = W - 2 * M, gap = 16, half = (inner - gap) / 2;
      p.slides.forEach((s, k) => w.push({ x: M + (k % 2) * (half + gap), y: 76 + ((k / 2) | 0) * 76, w: half, h: 64, label: s.label, size: 25, action: () => act('slide:' + s.id) }));
      p.buttons.forEach(b => w.push({ x: M, y: H - 74, w: inner, h: 56, label: b.label, size: b.size, action: () => act(b.id) }));
      return w;
    }
    return layoutSlidePage(p, { W, H, act, getImage: image });
  }
  return { act, page, widgets, open() { i = -1; }, get index() { return i; }, get rev() { return rev; }, drawKey: () => `${rev}|${i}` };
}
// the old name of the read-only view: the 詳細 tab with the switch off = the operation guide
export const createTutorialPreview = opts => createSlideViewer(opts);

// the 体験会 mission board (vr-view.js ev board, event mode only) shows the chosen level's slide as it is: its picture over the whole board (the board is the slide's
// 16:9), nothing added, nothing pressable. getImage(id) = the picture or null (the board shows its place until it arrives). Returns the widgets and the board height.
export const levelBoardH = (W = 820) => Math.round(W * SLIDE_H / SLIDE_W);
export function layoutLevelSlide(slide, { W = 820, getImage = noImage } = {}) {
  const H = levelBoardH(W);
  return { widgets: [slideWidget(slide.id, { x: 0, y: 0, w: W, h: H }, getImage, 30)], H };
}

// where the かんたんメニュー lights for a step (target = the step's menu: 'seg-hide' | 'seg-show' | 'slider'), from the menu's own widgets (event-mode.js simpleMenuLayout ids):
// 'seg-hide' = the 非表示 of the first tissue shown now, 'seg-show' = the 表示 of the first tissue hidden now, 'slider' = the slice-opacity knob. Returns a draw widget or null.
export function menuAnnotation(widgets, target, phase = 0) {
  if (!target || !Array.isArray(widgets)) return null;
  if (target === 'slider') {
    const s = widgets.find(x => x.type === 'slider'); if (!s) return null;
    const kx = s.x + s.w * (+s.value || 0), cy = s.y + s.h / 2;
    return { type: 'draw', tut: 'slider', draw: ctx => drawKnobHint(ctx, { kx, cy, phase }) };
  }
  const want = target === 'seg-hide' ? 'hide' : target === 'seg-show' ? 'show' : null; if (!want) return null;
  const b = widgets.find(x => typeof x.id === 'string' && x.id.startsWith('seg:') && x.id.endsWith(':' + want) && !x.on); if (!b) return null;
  return { type: 'draw', tut: b.id, draw: ctx => drawPointer(ctx, { x: b.x, y: b.y, w: b.w, h: b.h, phase, from: want === 'hide' ? 'right' : 'left', len: 36 }) };
}
