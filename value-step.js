// the ＋ / − buttons of the sliders that hold DATA VALUES (CT values and the like), in VR and in the browser.
// A short press changes the value by 10. Holding repeats: it starts after 0.4 s, then one step every 0.1 s; the first 1 s of repeating uses 10 per step, after that 100 per step. Release stops.
// This module is only the timing / size rule (pure; tests/unit/value-step.test.js); the callers clamp to the slider's own limits.
// Not for percentages (brightness, contrast, opacity), counts or other settings that are not data values.
export const STEP_PRESS = 10, STEP_FAST = 100, HOLD_DELAY_MS = 400, HOLD_INTERVAL_MS = 100, HOLD_SLOW_MS = 1000;

// repeat k (0, 1, 2 ...) happens at HOLD_DELAY_MS + k * HOLD_INTERVAL_MS after the press; the first HOLD_SLOW_MS of repeating (k < 10) is STEP_PRESS, then STEP_FAST
export const repeatCountAt = heldMs => (heldMs >= HOLD_DELAY_MS ? Math.floor((heldMs - HOLD_DELAY_MS) / HOLD_INTERVAL_MS) + 1 : 0);
export const repeatStep = k => (k * HOLD_INTERVAL_MS < HOLD_SLOW_MS ? STEP_PRESS : STEP_FAST);
// the sum of the steps of repeats from..to-1 (each in magnitude)
export function repeatTotal(from, to) { let sum = 0; for (let k = from; k < to; k++) sum += repeatStep(k); return sum; }

// a value moved by delta (signed) inside [lo, hi]; a bound that is not a number is no bound
export const stepClamp = (value, delta, lo = -Infinity, hi = Infinity) => Math.min(Number.isFinite(+hi) ? +hi : Infinity, Math.max(Number.isFinite(+lo) ? +lo : -Infinity, value + delta));

// one held button: press(t) gives the first step (STEP_PRESS), update(t) the magnitude due since the last call (0 while nothing is due). Times in ms, any clock.
export function createStepHold() {
  let t0 = null, done = 0;
  return {
    get active() { return t0 !== null; },
    press(t) { t0 = t; done = 0; return STEP_PRESS; },
    update(t) { if (t0 === null) return 0; const n = repeatCountAt(t - t0), sum = repeatTotal(done, n); done = Math.max(done, n); return sum; },
    release() { t0 = null; done = 0; },
  };
}

// browser: wires a ＋ / − button (pointer events: press = one step, hold = repeats, release / leave / cancel stops). apply(signedDelta) does the change. Returns a function that removes the listeners.
export function wireStepButton(button, dir, apply, { now = () => performance.now(), setTimer = (f, ms) => setInterval(f, ms), clearTimer = id => clearInterval(id), win = typeof window !== 'undefined' ? window : null } = {}) {
  const hold = createStepHold();
  let timer = null;
  const stop = () => { hold.release(); if (timer !== null) { clearTimer(timer); timer = null; } };
  const down = e => {
    if (button.disabled || (e && e.button != null && e.button !== 0)) return;
    if (e && e.preventDefault) e.preventDefault();
    stop(); apply(dir * hold.press(now()));
    timer = setTimer(() => { if (button.disabled) { stop(); return; } const d = hold.update(now()); if (d) apply(dir * d); }, 50);
  };
  const keyDown = e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); apply(dir * STEP_PRESS); } }; // a keyboard press is one short step
  if (button.style) button.style.touchAction = 'none'; // a touch hold must not scroll or cancel
  if (win) win.addEventListener('blur', stop); // pointerdown's preventDefault keeps focus off the button, so its own blur never fires
  button.addEventListener('pointerdown', down);
  for (const t of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) button.addEventListener(t, stop);
  button.addEventListener('keydown', keyDown);
  return () => { stop(); if (win) win.removeEventListener('blur', stop); button.removeEventListener('pointerdown', down); for (const t of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) button.removeEventListener(t, stop); button.removeEventListener('keydown', keyDown); };
}
