// Tutorial signals: a thin, side-effect-free wrapper that announces "the user just did X" as a DOM event ('vrl-tut-signal', detail {kind, ...}).
// Nobody listening = nothing happens. Never throws; no document (unit tests, workers) = no-op. The tutorial engine (tutorial-engine.js) listens.
export const SIGNAL_KINDS = Object.freeze([
  'vr-start', 'grab', 'grab-move', 'scale', 'home', 'menu-open', 'seg-toggle', 'seg-hide', 'seg-show', 'menu-close', 'section-add', 'section-drag', 'section-scroll',
  'section-toggle', 'slice-opacity', 'slice-toggle', 'slice-clear', 'frame-hide', 'point-record', 'undo', 'measure-done', 'ar-start', 'session-end', 'trigger-label', 'label-show',
]);
// kinds that can fire in bursts: at most one per MIN_GAP_MS
const MIN_GAP_MS = { 'label-show': 400, 'section-drag': 400, 'section-scroll': 400, 'slice-opacity': 400, 'point-record': 0 };
const last = new Map();
export function emit(kind, detail) {
  try {
    if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
    const gap = MIN_GAP_MS[kind];
    if (gap) { const t = Date.now(); if (t - (last.get(kind) || 0) < gap) return; last.set(kind, t); }
    document.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind, ...detail } }));
  } catch { /* a tutorial signal never breaks the app */ }
}
// a one-hand hold of the volume counts as 'grab-move' when it ended with the volume moved more than distM or turned more than angDeg (p = {x,y,z}, q = {x,y,z,w}, world)
export function poseMoved(p0, q0, p1, q1, { distM = 0.03, angDeg = 15 } = {}) {
  if (!p0 || !p1 || !q0 || !q1) return false;
  if (Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) > distM) return true;
  const dot = Math.min(1, Math.abs(q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w));
  return 2 * Math.acos(dot) * 180 / Math.PI > angDeg;
}
// a two-hand scale gesture counts when the scale changed by more than 15 % between its start and end
export const scaleChanged = (s0, s1) => !!(s0 > 0 && s1 > 0 && Math.abs(s1 / s0 - 1) > 0.15);
