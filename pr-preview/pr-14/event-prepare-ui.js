// the 設定 > キャッシュ button 「体験会用データを準備」: the page side of event-prepare.js. It opens each practice level on the page (the same route as choosing it: startSample), waits until the page is quiet,
// has the VR module build and save the finished VR data of that level (vr-view.js prepareStandardLevel: the same keys as VR entry / a data switch, saved completely, marked standard), and shows the progress per level.
// Nothing here is a worker; the saves are the paced, 1 MiB-sliced writes of the VR data cache (no frame is held up). The VR module is handed in (app.js owns its one loader).
import { prepareEventLevels } from './event-prepare.js?v=20261028-build683';
import { EVENT_LEVELS, eventModeOn } from './event-mode.js?v=20261028-build683';
import { createSettleGate } from './vr-data-switch.js?v=20261028-build683';
import { vrStateSignature } from './vr-data-key.js?v=20261028-build683';
import { volumeCacheBudgetInfo } from './gpu-volume-data.js?v=20261028-build683';
import { tr } from './i18n.js?v=20261028-build683';

const SETTLE_MS = 10 * 60 * 1000;
const isPractice = id => typeof id === 'string' && /^sample\d+$/.test(id);

// the page side: opens a level and waits until it is quiet (the volume ready, the bundled project applied, no job running, the state unchanged for a moment)
function pageIo({ getVr, openLevel, onPhase = () => {}, g = globalThis }) {
  const settle = async () => {
    const gate = createSettleGate({ timeoutMs: SETTLE_MS, volumeReady: () => g.__vrlVolumeReady === true, busy: () => { try { const b = g.__vrlBusyModal?.(); return !!(b && (b.active || b.visible)); } catch { return false; } }, key: () => { try { return vrStateSignature(); } catch { return ''; } } });
    if (!await gate.wait()) throw new Error('the page did not settle');
  };
  const prev = isPractice(g.__vrlOpenSample) ? g.__vrlOpenSample : null; let last = null;
  return {
    isCached: async s => (await getVr()).standardLevelCached(s),
    open: async s => { last = s; await openLevel(s); await settle(); },
    build: async s => (await getVr()).prepareStandardLevel(s, p => { try { onPhase(p); } catch { /* none */ } }),
    release: () => { void getVr().then(m => m.releaseVrPrepared()).catch(() => {}); },
    restore: async () => { if (prev && last && prev !== last) { await openLevel(prev); await settle(); } },
  };
}
export const runEventPrepare = ({ getVr, openLevel, onStatus, onPhase }) => prepareEventLevels({ levels: EVENT_LEVELS.map(l => ({ id: l.id, lv: l.lv, sample: l.sample })), io: pageIo({ getVr, openLevel, onPhase }), onStatus });

const STATE_KEY = { wait: 'cacheEventWait', building: 'cacheEventBuilding', saved: 'cacheEventSaved', cached: 'cacheEventCached', failed: 'cacheEventFailed' };
export const statusLine = results => results.map(r => 'Lv' + r.lv + ' ' + tr(STATE_KEY[r.state])).join(' / ');
export function summaryText(out, short) {
  if (out.ok) return tr('cacheEventDone');
  return tr('cacheEventPartial').replace('{levels}', out.failed.map(r => 'Lv' + r.lv).join(', ')) + (short ? ' ' + tr('cacheEventShort') : '');
}

// The modal shown from the button press until the end (the same card as the app's progress modal: .job-modal / .job-card, progress-modal.js). It is NOT a busy slot of that modal on purpose:
// the page waits for "no busy modal" before it calls a level quiet, so a slot held for the whole run would never let a level settle. Only a close button (no cancel): it appears when the run has ended.
const PHASE_KEY = { open: 'cacheEventPhaseOpen', build: 'cacheEventPhaseBuild', save: 'cacheEventPhaseSave', reopen: 'cacheEventPhaseReopen' };
// the shares of one level's bar: reading the data fills the first half, then the build steps, then the save
const phaseShare = (phase, done, total) => phase === 'open' ? 0 : phase === 'read' ? 0.5 * (total > 0 ? Math.min(1, done / total) : 0) : phase === 'save' ? 0.9 : 0.6;
export function modalView(results, ph) {
  const n = results.length, finished = results.filter(r => r.state === 'saved' || r.state === 'cached' || r.state === 'failed').length;
  const cur = results.find(r => r.state === 'building');
  let phase = 'open', share = 0, extra = '';
  if (cur) {
    const p = ph || null;
    phase = !p ? 'open' : p.phase === 'save' ? 'save' : 'build';
    share = p ? phaseShare(p.phase === 'copy' ? 'read' : p.phase, p.done, p.total) : 0;
    if (p && (p.phase === 'read' || p.phase === 'copy') && p.total > 0) extra = ' ' + p.done + ' / ' + p.total;
  } else if (finished === n) phase = 'reopen';
  const index = Math.min(n, cur ? results.indexOf(cur) + 1 : finished);
  const line = (cur ? tr('cacheEventModalLevel').replace('{n}', index).replace('{total}', n) + ' · Lv' + cur.lv + ' ' : '') + tr(PHASE_KEY[phase]) + extra;
  return { title: tr('cacheEventModalTitle'), detail: line + '\n' + statusLine(results) + '\n' + tr('cacheEventModalWait'), frac: Math.min(1, (finished + share) / n) };
}
export function createPrepareModal(doc = globalThis.document) {
  if (!doc?.body) return null;
  const root = doc.createElement('div');
  root.className = 'job-modal event-prepare-modal is-hidden'; root.id = 'event-prepare-modal'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-live', 'polite');
  root.innerHTML = '<div class="job-card"><div class="job-head"><div class="job-spinner" aria-hidden="true"></div><strong class="job-title"></strong></div><div class="job-detail"></div><div class="job-track"><div class="job-bar"></div></div><div class="job-foot"><span class="job-time"></span><button type="button" class="job-button is-close is-hidden"></button></div></div>';
  doc.body.append(root);
  const q = c => root.querySelector(c), els = { title: q('.job-title'), detail: q('.job-detail'), track: q('.job-track'), bar: q('.job-bar'), time: q('.job-time'), button: q('.job-button') };
  let t0 = 0, ticker = 0, finished = false;
  const secs = () => tr('cacheEventModalElapsed').replace('{s}', Math.floor((Date.now() - t0) / 1000));
  const tick = () => { if (!finished) els.time.textContent = secs(); };
  // input stays blocked while it is shown (pointer: the full-screen root; keys: here, as the app's progress modal does)
  root.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  const block = e => { if (root.classList.contains('is-hidden') || root.contains(e.target)) return; e.preventDefault(); e.stopPropagation(); };
  for (const ev of ['keydown', 'keypress']) doc.defaultView?.addEventListener(ev, block, { capture: true });
  els.button.onclick = () => { root.classList.add('is-hidden'); };
  const paint = v => { els.title.textContent = v.title; els.detail.textContent = v.detail; els.track.classList.remove('is-indeterminate'); els.bar.style.width = Math.round(v.frac * 100) + '%'; };
  return {
    root,
    start(results) { finished = false; t0 = Date.now(); root.classList.remove('is-hidden', 'is-finished'); els.button.classList.add('is-hidden'); paint(modalView(results, null)); tick(); clearInterval(ticker); ticker = setInterval(tick, 500); },
    update(results, ph) { if (!finished) paint(modalView(results, ph)); },
    finish(title, detail) { finished = true; clearInterval(ticker); ticker = 0; root.classList.add('is-finished'); els.title.textContent = title; els.detail.textContent = detail; els.track.classList.remove('is-indeterminate'); els.bar.style.width = '100%'; els.time.textContent = secs(); els.button.textContent = tr('cacheEventModalClose'); els.button.classList.remove('is-hidden'); try { els.button.focus(); } catch { /* none */ } },
  };
}

// the button of the cache panel (settings-ui.js calls it once); the page's loader / opener arrive through the 'vrl-event-prepare' event that app.js answers (detail.done = the promise of the run)
export function setupEventPrepareButton(doc = globalThis.document) {
  const btn = doc?.getElementById('set-cache-event-btn'), status = doc?.getElementById('set-cache-event-status');
  if (!btn || !status) return;
  let running = false;
  const sync = () => { const on = eventModeOn(); btn.disabled = running || !on; status.dataset.off = on ? '' : '1'; if (!running && !on) status.textContent = tr('cacheEventNeedsEvent'); };
  doc.addEventListener('vrl-settings-sync', sync); doc.addEventListener('vrl-event-sample-open', () => { if (!running) sync(); }); sync();
  let modal = null;
  btn.onclick = async () => {
    if (running || !eventModeOn()) return;
    running = true; btn.disabled = true;
    modal ??= createPrepareModal(doc);
    let rs = null, ph = null, curSample;
    const detail = { done: null, onStatus: r => { const b = r.find(x => x.state === 'building')?.sample; if (b !== curSample) { curSample = b; ph = null; } rs = r; status.textContent = tr('cacheEventRunning') + '\n' + statusLine(r); modal?.update(r, ph); }, onPhase: p => { ph = p; if (rs) modal?.update(rs, ph); } };
    try {
      modal?.start(EVENT_LEVELS.map(l => ({ id: l.id, lv: l.lv, sample: l.sample, state: 'wait' })));
      const info = await volumeCacheBudgetInfo().catch(() => null);
      doc.dispatchEvent(new CustomEvent('vrl-event-prepare', { detail }));
      const out = detail.done ? await detail.done : null;
      status.textContent = out ? statusLine(out.results) + '\n' + summaryText(out, !!info && info.event && !info.enough) : tr('cacheEventFailed');
      if (out) modal?.finish(out.ok ? tr('cacheEventModalDoneTitle') : tr('cacheEventModalFailTitle'), statusLine(out.results) + '\n' + summaryText(out, !!info && info.event && !info.enough));
      else modal?.finish(tr('cacheEventModalFailTitle'), tr('cacheEventFailed'));
    } catch (e) { console.warn('Event data preparation failed', e); status.textContent = tr('cacheEventFailed'); modal?.finish(tr('cacheEventModalFailTitle'), tr('cacheEventFailed') + (e && e.message ? '\n' + e.message : '')); }
    finally { running = false; sync(); }
  };
}
