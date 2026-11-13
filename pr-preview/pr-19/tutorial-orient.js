// the entry guidance of the VR / AR tutorial. Pure: no DOM, no THREE; unit-tested (tests/unit/tutorial-orient.test.js).
// Right after a session starts the tutorial first shows where its boards are: 'right' (the 操作パネル = the help board, 50 deg to the right) then 'left' (the メニュー, 50 deg to the left);
// then ステップ1 begins. A phase ends when the visitor TURNS THE HEAD toward the board (the horizontal angle between the gaze and the direction to the board is <= LOOK_DEG, 25 deg = a turn of 25 deg or more toward a board 50 deg out, held for
// LOOK_DWELL_MS; not before the phase's voice has ended, or SAY_MAX_MS passed, so the narration is not cut off) or presses 次へ (next(), at once).
export const ORIENT_PHASES = Object.freeze(['right', 'left']);
export const LOOK_DEG = 25, LOOK_DWELL_MS = 600, SAY_MAX_MS = 9000;
// the horizontal angle (deg, 0..180) between the gaze (gx, gz) and the direction (dx, dz) from the head to a board; null when either has no horizontal extent
export function horizAngleDeg(gx, gz, dx, dz) {
  const a = Math.hypot(gx, gz), b = Math.hypot(dx, dz);
  if (!(a > 1e-6) || !(b > 1e-6)) return null;
  return Math.acos(Math.max(-1, Math.min(1, (gx * dx + gz * dz) / (a * b)))) * 180 / Math.PI;
}
// phases: the ids in order. now: ms clock. onChange(): after every change of phase / done.
export function createOrient({ phases = ORIENT_PHASES, lookDeg = LOOK_DEG, dwellMs = LOOK_DWELL_MS, sayMaxMs = SAY_MAX_MS, onChange = () => {} } = {}) {
  let i = -1, since = 0, lookSince = null;
  const phase = () => (i >= 0 && i < phases.length ? phases[i] : null);
  function go(t, to) { i = to; since = t; lookSince = null; onChange(); }
  return {
    start(t = 0) { go(t, 0); },
    get phase() { return phase(); },
    get active() { return phase() !== null; },
    get done() { return i >= phases.length; },
    get index() { return i; },
    get since() { return since; },
    // 次へ: this phase is over (true when it was running)
    next(t = 0) { if (!this.active) return false; go(t, i + 1); return true; },
    // per frame. angles = {right, left}: deg from the gaze to each board (null = not known yet); voiceDone: the phase's voice has ended (or there is none). Returns true when the phase changed.
    update(t, angles = {}, voiceDone = false) {
      const p = phase(); if (!p) return false;
      const a = angles[p], ready = voiceDone || t - since >= sayMaxMs;
      if (a == null || !(a <= lookDeg) || !ready) { lookSince = null; return false; }
      if (lookSince == null) lookSince = t;
      if (t - lookSince < dwellMs) return false;
      go(t, i + 1); return true;
    },
  };
}
