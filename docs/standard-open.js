// in 体験会モード a practice level that has finished opening from its built-in project is in its STANDARD state; this module records that state (vr-data-key.js vrStateSignature) once the page is quiet,
// so that the VR preparation can tell, by any route (the level chosen on the page and then VR entered, a data switch in VR, ...), whether the finished VR data it is about to make is the standard one
// (and so protected from eviction, vr-prep-cache.js protectedKeys). A change of the state afterwards (segment settings, edits, filters, analysis results) makes the record not match. Nothing is built here.
import { createSettleGate } from './vr-data-switch.js?v=20261029-build689';
import { vrStateSignature } from './vr-data-key.js?v=20261029-build689';
import { eventModeOn } from './event-mode.js?v=20261029-build689';

let token = 0;
const OPEN_SETTLE_MS = 10 * 60 * 1000; // the load of a big level on a slow device can take minutes; waiting costs nothing (a poll every 200 ms), and a level that never settles is simply not recorded
export function watchStandardOpen(doc = globalThis.document, g = globalThis) {
  doc?.addEventListener?.('vrl-event-sample-open', e => {
    const my = ++token, id = e.detail?.id; g.__vrlStandardOpen = null; // a level (re)opened: the old record is void
    if (!eventModeOn() || typeof id !== 'string' || !/^sample\d+$/.test(id)) return;
    const gate = createSettleGate({ timeoutMs: OPEN_SETTLE_MS, volumeReady: () => g.__vrlVolumeReady === true, busy: () => { try { const b = g.__vrlBusyModal?.(); return !!(b && (b.active || b.visible)); } catch { return false; } }, key: () => { try { return vrStateSignature(); } catch { return ''; } } });
    void gate.wait(() => my === token).then(ok => { if (ok && my === token) { try { g.__vrlStandardOpen = { id, sig: vrStateSignature() }; } catch { /* none */ } } }, () => {});
  });
}

