// the 体験会モード page. With the mode on the page shows this layout from startup instead of the viewers: the views (2D / 3D) are NOT hidden behind it - they are not laid out at all (style.css:
// html.vrl-event-layout sets display:none on the view grid and its bar, so they have no box and the 3D loop / 2D paint do not draw: scene loop in app.js, renderPlane in mpr-render.js read __vrlEventLayout).
// What stays in the DOM although it is not shown: the viewers' own elements (settings controls, segment / filter / window inputs: project apply and the VR data need them), and the page's volume object
// (MedicalVolumeRenderer: the 512 grid reads and the end of 体験会用データを準備 need it). The left menu (データ / 設定) is untouched: settings stay reachable as before.
//   - the event bar under the top bar: the EXISTING #tutorial-start-button, #vr-view-button and #ar-view-button moved in (same elements: their handlers and show / enable logic are untouched) + the status text
//   - below it the cards (one per dataset of event-mode.js EVENT_DATASETS) in an area that scrolls by itself
// A card press opens the dataset through the page's own route ('vrl-event-sample' -> startSample), waits until the page is quiet, then prepares the VR data (prepareVrData + prepareVrGpu 'vr', the work of the
// prepare panel) so that 「VRで見る」 starts with one press. Nothing is opened or prepared by itself when the page loads. With the mode off none of this exists (the elements go back where they were).
import { tr } from './i18n.js?v=20261110-build708';
import { EVENT_DATASETS, chooseEventLevel } from './event-mode.js?v=20261110-build708';
import { eventCards, eventStatus, EVENT_STATUS_KEYS, openAndPrepare, waitForStandardOpen, createInflight } from './event-launcher-core.js?v=20261110-build708';
import { settlePage } from './event-prepare-ui.js?v=20261110-build708';
import { tutorialUiActive, restartTutorial } from './tutorial-ui.js?v=20261110-build708';
import { sampleSliceUrl } from './sample-sets.js?v=20261110-build708';
import { creditRows } from './sample-credit-ui.js?v=20261110-build708';

const MOVED = ['tutorial-start-button', 'vr-view-button', 'ar-view-button'];
const XR_CHECK_MS = 10000;
const wait = ms => new Promise(r => setTimeout(r, ms));

// the VR module is loaded by app.js (its one loader, as for the settings > cache button): the page asks through an event, as 'vrl-event-prepare' does
const askVrModule = doc => { const ev = new CustomEvent('vrl-vr-module', { detail: { done: null } }); doc.dispatchEvent(ev); return ev.detail.done ? Promise.resolve(ev.detail.done) : Promise.reject(new Error('the page did not answer vrl-vr-module')); };

export function createEventLauncher({ doc = globalThis.document, g = globalThis, getVr = () => askVrModule(doc) } = {}) {
  let on = false, bar = null, statusEl = null, launcher = null, cardsEl = null;
  let phase = '', phaseSample = null, token = 0, vrMod = null, glow = false, wasReady = false; // glow = the top bar's VR / AR buttons pulse after the preparation finished
  const moved = [], inflight = createInflight();
  let held = 0; // other work that keeps the cards waiting (the データ panel's 最初の状態に戻す reopening the data)

  const el = (tag, cls, key) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (key) { e.dataset.i18n = key; e.textContent = tr(key); } return e; };
  const busy = () => phase === 'loading' || phase === 'preparing' || held > 0;
  const announce = () => { try { doc.dispatchEvent(new CustomEvent('vrl-event-launcher-state', { detail: { phase } })); } catch { /* none */ } };

  // ---- status text
  const vrStillReady = () => { try { return !!vrMod?.vrReady?.(); } catch { return false; } };
  function render() {
    if (!on) return;
    const state = eventStatus({ loading: phase === 'loading', preparing: phase === 'preparing', ready: phase === 'ready' && vrStillReady() });
    if (state === 'ready' && !wasReady) glow = true; else if (state !== 'ready') glow = false; // starts when the preparation completes; a press / another card / a session stops it
    wasReady = state === 'ready';
    bar?.classList.toggle('is-ready-glow', glow);
    if (statusEl) {
      statusEl.dataset.state = state;
      if (state) { statusEl.dataset.i18n = EVENT_STATUS_KEYS[state]; statusEl.textContent = tr(EVENT_STATUS_KEYS[state]); }
      else { delete statusEl.dataset.i18n; statusEl.textContent = ''; }
    }
    const open = g.__vrlOpenSample, b = busy();
    for (const c of cardsEl?.querySelectorAll('[data-event-sample]') || []) {
      const sel = c.dataset.eventSample === open;
      c.classList.toggle('is-selected', sel); c.setAttribute('aria-pressed', String(sel)); c.disabled = b;
    }
    cardsEl?.setAttribute('aria-busy', String(b));
    // the big 「VRで見る」「ARで見る」 buttons live only in the ready card (the AR one only while the top bar's AR button is shown)
    const arShown = !!doc.getElementById('ar-view-button') && !doc.getElementById('ar-view-button').hidden;
    for (const go of cardsEl?.querySelectorAll('[data-event-go]') || []) {
      const mine = state === 'ready' && go.dataset.eventGo === open;
      go.hidden = !mine;
      const ar = go.querySelector('[data-event-go-ar]'); if (ar) ar.hidden = !arShown;
    }
  }
  const stopGlow = () => { if (glow) { glow = false; render(); } };
  function setPhase(p) { phase = p; render(); announce(); }
  // another dataset was opened by some other route, or the prepared data is gone (a session used it): "ready" no longer holds
  function refresh() { if (phase === 'ready' && (g.__vrlOpenSample !== phaseSample || !vrStillReady())) phase = ''; render(); }

  // ---- the VR preparation that follows a card press: the same work as the prepare panel, once (the run in flight is shared with a button pressed meanwhile: vr-view.js prepareVrGpuOnce / prepareVrData)
  const xrAvailable = () => ['vr-view-button', 'ar-view-button'].some(id => { const b = doc.getElementById(id); return !!b && !b.hidden; });
  async function prepareVr(stale = () => false) { // stale() = a card press was replaced or an XR session started meanwhile: no step starts any more (a session holds the GPU assets; a new preparation would build a second renderer beside it)
    for (let t = 0; g.__vrlXrChecked !== true && t < XR_CHECK_MS; t += 200) await wait(200);
    if (!xrAvailable()) return false; // no VR / AR in this browser: there is nothing to prepare for
    if (stale()) return true;
    return inflight.run('vr', async () => {
      const m = vrMod = await getVr();
      if (stale()) return true;
      const P = await m.prepareVrData(() => {});
      if (stale()) return true;
      await m.prepareVrGpuOnce(P, 'vr');
      return true;
    });
  }

  // ---- a card (or 「チュートリアルを始める」) opens its dataset and goes on to prepare
  async function press(d, { tutorial = false } = {}) {
    if (!on || busy()) return;
    const my = ++token;
    chooseEventLevel(d.kind === 'level' ? d.id : null); // a dataset that is not a level chooses none (no mission), as before
    // with the tutorial switch on, Lv0 (骨梁) = the tutorial, started from ステップ1 (the start button has begun it already)
    if (!tutorial && d.id === 'lv0' && tutorialUiActive()) { try { restartTutorial(); } catch (e) { console.warn('Tutorial: Lv0 card', e); } }
    const ev = new CustomEvent('vrl-event-sample', { detail: { sampleSet: d.sample, done: null } });
    phaseSample = d.sample; setPhase('loading');
    doc.dispatchEvent(ev);
    if (!ev.detail.done) { setPhase(''); return; }
    try {
      const out = await openAndPrepare({
        open: () => ev.detail.done, settle: () => settlePage(g),
        standard: () => waitForStandardOpen({ sample: d.sample, read: () => g.__vrlStandardOpen, stop: () => my !== token }), // the standard-open record is set before the entry is stored (marked standard)
        prepare: async () => { if (!await prepareVr(() => my !== token)) throw Object.assign(new Error('no VR / AR'), { quiet: true }); },
        isStale: () => my !== token, onPhase: p => { if (my === token) setPhase(p); },
      });
      if (out === 'ready' && my === token) refresh();
    } catch (e) {
      if (!e?.quiet) console.warn('Event page: the data was opened but the VR preparation did not finish (the VR button prepares as usual)', e);
      if (my === token) setPhase('');
    }
  }
  const onTutorialBegin = () => { const lv0 = EVENT_DATASETS.find(d => d.id === 'lv0'); if (on && lv0) void press(lv0, { tutorial: true }); };

  // ---- DOM
  function buildCards() {
    const area = el('div', 'event-cards'); area.id = 'event-cards'; area.setAttribute('role', 'list');
    for (const c of eventCards()) {
      const card = el('article', 'event-card'); card.setAttribute('role', 'listitem');
      const btn = el('button', 'event-card-btn'); btn.type = 'button'; btn.dataset.eventSample = c.sample; btn.setAttribute('aria-pressed', 'false');
      if (c.levelAttr) btn.dataset.eventLevel = c.levelAttr; else btn.dataset.eventOther = c.sample; // the tutorial's highlight targets are [data-event-level]
      const thumb = el('span', 'event-card-thumb'), img = doc.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.draggable = false; img.onerror = () => img.remove(); // no picture (yet): the frame stays empty, no text
      img.src = sampleSliceUrl(c.sample, c.thumbFile);
      thumb.append(img);
      const top = el('span', 'event-card-top');
      if (c.lv != null) { const badge = el('span', 'event-card-badge'); badge.textContent = 'Lv' + c.lv; top.append(badge); }
      top.append(el('span', 'event-card-name', c.nameKey));
      btn.append(thumb, top);
      if (c.missionKey) btn.append(el('span', 'event-card-mission', c.missionKey));
      const d = EVENT_DATASETS.find(x => x.sample === c.sample);
      btn.onclick = () => { if (d) void press(d); };
      card.append(btn);
      card.onclick = e => { if (e.target === btn || btn.contains(e.target) || e.target.closest?.('a, summary, details, button')) return; if (!btn.disabled) btn.click(); }; // the card's padding / empty parts press the card as well; the credit link, 「詳細」 and the VR / AR buttons do not
      const go = el('div', 'event-card-go'); go.dataset.eventGo = c.sample; go.hidden = true; // pressing = pressing the top bar's own button
      for (const [id, key, flag] of [['vr-view-button', 'vrView', 'eventGoVr'], ['ar-view-button', 'arView', 'eventGoAr']]) {
        const gb = el('button', 'event-card-go-btn', key); gb.type = 'button'; gb.dataset[flag] = ''; gb.onclick = () => doc.getElementById(id)?.click(); go.append(gb);
      }
      card.append(go);
      if (c.credit) { // only a dataset whose sample.json carries a credit: a short line (source name + license link) and 「詳細」 with the four lines (source, license, changes, terms)
        const box = el('div', 'event-card-license'), line = doc.createElement('div'), a = doc.createElement('a');
        a.href = c.credit.licenseUrl; a.textContent = c.credit.licenseName; a.target = '_blank'; a.rel = 'noopener noreferrer';
        const nm = doc.createElement('span'); nm.textContent = c.credit.name + ' · ';
        line.append(el('span', '', 'creditSource'), nm, el('span', '', 'creditLicense'), a);
        const more = doc.createElement('details');
        const body = doc.createElement('div'); body.className = 'event-card-details-body'; body.append(...creditRows(doc, c.credit));
        more.append(el('summary', '', 'tutPanelDetail'), body);
        // the opened details lie inside the card's own box (absolute, scrolling inside), so the card keeps its size. They cover the body below the title down to the card's VR / AR buttons (or the credit line)
        // when that is tall enough; else (a card with a short body) the picture area above the title. The title, the VR / AR buttons and 「詳細」 itself stay visible.
        const fit = () => {
          if (!more.open) return;
          const edge = (!go.hidden && go.offsetHeight > 0 ? go.offsetTop : box.offsetTop) - 8, below = top.offsetTop + top.offsetHeight + 8;
          const [t, e] = edge - below >= 140 ? [below, edge] : [thumb.offsetTop, top.offsetTop - 8];
          card.style.setProperty('--details-top', t + 'px'); card.style.setProperty('--details-bottom', Math.max(0, card.clientHeight - e) + 'px');
        };
        more.addEventListener('toggle', fit); g.addEventListener?.('resize', fit); more.addEventListener('click', e => e.stopPropagation());
        try { new g.MutationObserver(fit).observe(go, { attributes: true, attributeFilter: ['hidden'] }); } catch { /* none */ }
        box.append(line, more); card.append(box);
      }
      area.append(card);
    }
    return area;
  }
  function enable() {
    if (on) return true;
    const topbar = doc.querySelector('.topbar'), workspace = doc.querySelector('.workspace');
    if (!topbar || !workspace) return false;
    on = true; g.__vrlEventLayout = true; doc.documentElement.classList.add('vrl-event-layout');
    bar = el('div', 'event-bar'); bar.id = 'event-bar';
    statusEl = el('span', 'event-status'); statusEl.id = 'event-status'; statusEl.setAttribute('role', 'status'); statusEl.setAttribute('aria-live', 'polite');
    bar.append(statusEl); topbar.after(bar);
    for (const id of MOVED) { // the existing elements, moved (a comment keeps their place for disable)
      const e = doc.getElementById(id); if (!e) continue;
      const ph = doc.createComment(id); e.replaceWith(ph); bar.insertBefore(e, statusEl); e.addEventListener('click', stopGlow); moved.push({ e, ph });
    }
    launcher = el('section', 'event-launcher'); launcher.id = 'event-launcher';
    cardsEl = buildCards(); launcher.append(cardsEl); workspace.append(launcher);
    render();
    try { doc.dispatchEvent(new CustomEvent('vrl-event-layout', { detail: { on: true } })); } catch { /* none */ }
    return true;
  }
  function disable() {
    if (!on) return;
    token++; on = false; g.__vrlEventLayout = false; phase = '';
    for (const { e, ph } of moved.splice(0)) { e.removeEventListener('click', stopGlow); ph.replaceWith(e); }
    glow = wasReady = false;
    // the tutorial button is mounted after the page started: it came into the bar without a place of its own; it goes before 「VRで見る」 again
    const late = bar?.querySelector('#tutorial-start-button'), vr = doc.getElementById('vr-view-button');
    if (late && vr?.parentNode) vr.parentNode.insertBefore(late, vr);
    bar?.remove(); launcher?.remove(); bar = statusEl = launcher = cardsEl = null;
    doc.documentElement.classList.remove('vrl-event-layout');
    try { doc.dispatchEvent(new CustomEvent('vrl-event-layout', { detail: { on: false } })); } catch { /* none */ }
    announce();
  }

  doc?.addEventListener?.('vrl-event-sample-open', () => refresh());
  // an XR session started (VR / AR pressed while the card flow was still running): the flow stops (the run token moves on), so nothing is prepared during the session
  doc?.addEventListener?.('vrl-tut-signal', e => {
    const k = e?.detail?.kind;
    if (on && (k === 'vr-start' || k === 'ar-start')) { token++; glow = false; if (phase === 'loading' || phase === 'preparing') setPhase(''); }
    refresh();
  });
  doc?.addEventListener?.('vrl-tutorial-begin', onTutorialBegin);
  const hold = p => { held++; render(); announce(); Promise.resolve(p).catch(() => {}).finally(() => { held--; render(); announce(); }); };
  return { enable, disable, press, refresh, hold, get on() { return on; }, get busy() { return busy(); }, get phase() { return phase; } };
}
