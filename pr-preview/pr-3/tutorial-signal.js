// Tutorial signals: a thin, side-effect-free wrapper that announces "the user just did X" as a DOM event ('vrl-tut-signal', detail {kind, ...}).
// Nobody listening = nothing happens. Never throws; no document (unit tests, workers) = no-op. The tutorial engine (tutorial-engine.js) listens.
export const SIGNAL_KINDS = Object.freeze([
  'vr-start', 'move', 'scale', 'home', 'menu-open', 'seg-toggle', 'menu-close', 'section-add', 'section-drag', 'section-toggle',
  'slice-clear', 'frame-hide', 'point-record', 'undo', 'measure-done', 'ar-start', 'session-end', 'trigger-label', 'label-show',
]);
// kinds that can fire in bursts: at most one per MIN_GAP_MS
const MIN_GAP_MS = { 'label-show': 400, 'section-drag': 400, 'point-record': 0 };
const last = new Map();
export function emit(kind, detail) {
  try {
    if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
    const gap = MIN_GAP_MS[kind];
    if (gap) { const t = Date.now(); if (t - (last.get(kind) || 0) < gap) return; last.set(kind, t); }
    document.dispatchEvent(new CustomEvent('vrl-tut-signal', { detail: { kind, ...detail } }));
  } catch { /* a tutorial signal never breaks the app */ }
}
// head travel since the session start: step(head) returns true ONCE, when the path length first exceeds thresholdM (cheap: one distance per call); reset() re-arms it (sum 0, not fired, next head position = the new start)
export function createMoveTracker(thresholdM = 0.3) {
  let px = 0, py = 0, pz = 0, has = false, sum = 0, fired = false;
  return {
    reset() { has = false; sum = 0; fired = false; },
    step(p) {
      if (fired || !p) return false;
      if (!has) { px = p.x; py = p.y; pz = p.z; has = true; return false; }
      const d = Math.hypot(p.x - px, p.y - py, p.z - pz); px = p.x; py = p.y; pz = p.z;
      if (d < 0.5) sum += d; // a tracking jump is not a walk
      if (sum > thresholdM) { fired = true; return true; }
      return false;
    },
  };
}
// a two-hand scale gesture counts when the scale changed by more than 15 % between its start and end
export const scaleChanged = (s0, s1) => !!(s0 > 0 && s1 > 0 && Math.abs(s1 / s0 - 1) > 0.15);
