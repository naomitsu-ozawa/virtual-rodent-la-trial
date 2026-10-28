// the 設定 > キャッシュ button 「体験会用データを準備」: the page side of event-prepare.js. It opens each practice level on the page (the same route as choosing it: startSample), waits until the page is quiet,
// has the VR module build and save the finished VR data of that level (vr-view.js prepareStandardLevel: the same keys as VR entry / a data switch, saved completely, marked standard), and shows the progress per level.
// Nothing here is a worker; the saves are the paced, 1 MiB-sliced writes of the VR data cache (no frame is held up). The VR module is handed in (app.js owns its one loader).
import { prepareEventLevels } from './event-prepare.js?v=20261027-build680';
import { EVENT_LEVELS, eventModeOn } from './event-mode.js?v=20261027-build680';
import { createSettleGate } from './vr-data-switch.js?v=20261027-build680';
import { vrStateSignature } from './vr-data-key.js?v=20261027-build680';
import { volumeCacheBudgetInfo } from './gpu-volume-data.js?v=20261027-build680';
import { tr } from './i18n.js?v=20261027-build680';

const SETTLE_MS = 10 * 60 * 1000;
const isPractice = id => typeof id === 'string' && /^sample\d+$/.test(id);

// the page side: opens a level and waits until it is quiet (the volume ready, the bundled project applied, no job running, the state unchanged for a moment)
function pageIo({ getVr, openLevel, g = globalThis }) {
  const settle = async () => {
    const gate = createSettleGate({ timeoutMs: SETTLE_MS, volumeReady: () => g.__vrlVolumeReady === true, busy: () => { try { const b = g.__vrlBusyModal?.(); return !!(b && (b.active || b.visible)); } catch { return false; } }, key: () => { try { return vrStateSignature(); } catch { return ''; } } });
    if (!await gate.wait()) throw new Error('the page did not settle');
  };
  const prev = isPractice(g.__vrlOpenSample) ? g.__vrlOpenSample : null; let last = null;
  return {
    isCached: async s => (await getVr()).standardLevelCached(s),
    open: async s => { last = s; await openLevel(s); await settle(); },
    build: async s => (await getVr()).prepareStandardLevel(s),
    release: () => { void getVr().then(m => m.releaseVrPrepared()).catch(() => {}); },
    restore: async () => { if (prev && last && prev !== last) { await openLevel(prev); await settle(); } },
  };
}
export const runEventPrepare = ({ getVr, openLevel, onStatus }) => prepareEventLevels({ levels: EVENT_LEVELS.map(l => ({ id: l.id, lv: l.lv, sample: l.sample })), io: pageIo({ getVr, openLevel }), onStatus });

const STATE_KEY = { wait: 'cacheEventWait', building: 'cacheEventBuilding', saved: 'cacheEventSaved', cached: 'cacheEventCached', failed: 'cacheEventFailed' };
export const statusLine = results => results.map(r => 'Lv' + r.lv + ' ' + tr(STATE_KEY[r.state])).join(' / ');
export function summaryText(out, short) {
  if (out.ok) return tr('cacheEventDone');
  return tr('cacheEventPartial').replace('{levels}', out.failed.map(r => 'Lv' + r.lv).join(', ')) + (short ? ' ' + tr('cacheEventShort') : '');
}

// the button of the cache panel (settings-ui.js calls it once); the page's loader / opener arrive through the 'vrl-event-prepare' event that app.js answers (detail.done = the promise of the run)
export function setupEventPrepareButton(doc = globalThis.document) {
  const btn = doc?.getElementById('set-cache-event-btn'), status = doc?.getElementById('set-cache-event-status');
  if (!btn || !status) return;
  let running = false;
  const sync = () => { const on = eventModeOn(); btn.disabled = running || !on; status.dataset.off = on ? '' : '1'; if (!running && !on) status.textContent = tr('cacheEventNeedsEvent'); };
  doc.addEventListener('vrl-settings-sync', sync); doc.addEventListener('vrl-event-sample-open', () => { if (!running) sync(); }); sync();
  btn.onclick = async () => {
    if (running || !eventModeOn()) return;
    running = true; btn.disabled = true;
    try {
      const info = await volumeCacheBudgetInfo().catch(() => null);
      const detail = { done: null, onStatus: rs => { status.textContent = tr('cacheEventRunning') + '\n' + statusLine(rs); } };
      doc.dispatchEvent(new CustomEvent('vrl-event-prepare', { detail }));
      const out = detail.done ? await detail.done : null;
      status.textContent = out ? statusLine(out.results) + '\n' + summaryText(out, !!info && info.event && !info.enough) : tr('cacheEventFailed');
    } catch (e) { console.warn('Event data preparation failed', e); status.textContent = tr('cacheEventFailed'); }
    finally { running = false; sync(); }
  };
}
