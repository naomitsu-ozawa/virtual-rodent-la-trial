// 体験会モード: every practice dataset opens fresh from its project file. The state of the previous visitor must not reach the next one, so what lives
// OUTSIDE the dataset's own per-series state (and so survives a switch: the position-comment and distance stores keep every series' entries, the
// histogram's remembered range, the Filtered / Raw HU choice, the "show the positions" switch, the 3D view's zoom, the VR side's per-segment modes) is put
// back here, before the dataset is opened (app.js startSample). What the dataset itself holds (segments, sections, window, filters, regions and their
// labels, crop, crosshair, HU line, the 3D object) is reset by the series switch itself (app.js resetVolume, data-load.js resetDatasetState, selectSeries).
// resetUserState() is also the first half of the VR 「最初の状態に戻す」 button (data-load.js restoreProjectAnnotations puts the project's own points back).
// With event mode off nothing here runs (freshForEventSelection returns false), so the normal flow keeps its behaviour (comments kept per dataset, ...).
import { setComments, resetCommentsSaved, setMarkersShown } from './comments.js?v=20261022-build656';
import { resetMeasurements } from './measurements.js?v=20261022-build656';
import { setHuMode, HU_MODE_FILTERED } from './effective-hu.js?v=20261022-build656';
import { resetHistogramView } from './histogram-ui.js?v=20261022-build656';
import { clearHuLine } from './hu-line-model.js?v=20261022-build656';
import { eventModeOn } from './event-mode.js?v=20261022-build656';

// 'vrl-event-fresh': modules that keep a piece of state of their own listen to it (the 3D view's camera distance in app.js, the VR module's
// per-segment modes / point mode / screenshots), so that this file needs no import of them
export const EVENT_FRESH_EVENT = 'vrl-event-fresh';
export function resetUserState(target = globalThis.document) {
  globalThis.__vrlEventFreshCount = (globalThis.__vrlEventFreshCount | 0) + 1; // for the VR module, loaded lazily: it applies a start it missed (vr-view.js onEventFresh)
  setComments([]); resetCommentsSaved(); resetMeasurements(); setMarkersShown(true);
  setHuMode(HU_MODE_FILTERED); resetHistogramView(); clearHuLine('event-reset');
  try { target?.dispatchEvent?.(new CustomEvent(EVENT_FRESH_EVENT)); } catch (e) { console.warn('Event reset listener failed:', e); }
}
// the call of app.js startSample: only with the event mode on; true = it ran
export function freshForEventSelection(api = globalThis.__vrlSettings) {
  if (!eventModeOn(api)) return false;
  resetUserState();
  return true;
}
