export const LOW_BELOW = 0.9;         // direct path -> offscreen only when the scale falls below this (the cap's quantum is 1/32, its hysteresis 2/32)
export const FLAP_MAX = 3;            // flaps allowed within FLAP_WINDOW_MS ...
export const FLAP_WINDOW_MS = 1000;   // ... (at most ~3 Hz; photosensitive risk starts around 3 Hz)
export const FLAP_HOLD_MS = 3000;     // then the value is frozen this long (and again while it keeps flapping)

export function createFlapGuard({ maxFlaps = FLAP_MAX, windowMs = FLAP_WINDOW_MS, holdMs = FLAP_HOLD_MS, numeric = false, eps = 1e-6, fallback = null } = {}) {
  let cur, has = false, lastDir = 0, until = -Infinity, freezes = 0;
  const hist = [];                    // [{t, v}] of applied values within the window (categorical) / flap times (numeric)
  const flapT = [];
  const prune = now => { while (flapT.length && now - flapT[0] > windowMs) flapT.shift(); while (hist.length && now - hist[0].t > windowMs) hist.shift(); };
  return {
    // proposed value for this frame -> the value to use
    step(v, now) {
      if (!has) { has = true; cur = v; hist.push({ t: now, v }); return cur; }
      prune(now);
      if (now < until) return fallback && !(numeric ? Math.abs(v - cur) <= eps : v === cur) ? fallback(v, cur) : cur;
      const same = numeric ? Math.abs(v - cur) <= eps : v === cur;
      if (same) return cur;
      let flap;
      if (numeric) { const dir = v > cur ? 1 : -1; flap = lastDir !== 0 && dir !== lastDir; lastDir = dir; }
      else flap = hist.some(h => h.v === v);
      if (flap) flapT.push(now);
      if (flapT.length > maxFlaps) {
        until = now + holdMs; freezes++; flapT.length = 0; hist.length = 0; lastDir = 0;
        if (fallback) { cur = fallback(v, cur); hist.push({ t: now, v: cur }); }
        return cur;
      }
      cur = v; hist.push({ t: now, v });
      return cur;
    },
    frozenAt(now) { return now < until; },
    get freezes() { return freezes; },
    get value() { return cur; },
    reset() { has = false; lastDir = 0; until = -Infinity; hist.length = 0; flapT.length = 0; },
  };
}

// the render scale in use: raw = the scale the auto ladder / manual setting and the data-resolution cap ask for (0..1]
export function createScaleGuard({ lowBelow = LOW_BELOW, ...flap } = {}) {
  let direct = true;
  const g = createFlapGuard({ ...flap, numeric: true });
  return {
    step(raw, now) {
      if (!(raw > 0)) raw = 1;
      let want = raw >= 1 - 1e-6 ? 1 : raw;
      if (direct && want < 1 && want >= lowBelow) want = 1; // hysteresis: the direct path holds down to lowBelow
      const f = g.step(want, now);
      direct = f >= 1 - 1e-6;
      return f;
    },
    get direct() { return direct; },
    get freezes() { return g.freezes; },
    frozenAt(now) { return g.frozenAt(now); },
    reset() { direct = true; g.reset(); },
  };
}

// the volume variant drawn while the variant guard holds: one that draws every state the flapping keys can stand for, and no heavier than needed.
// 'combined' / 'noEvents' (the combined texture in use) -> 'combined' (the same jump loop, with the section / cut-face events); a 'full' key
// (no combined texture, or a diagnostic) stays 'full' (it is the variant in use then anyway). The CLS4 suffix is kept.
export function variantFallback(v) {
  const four = typeof v === 'string' && v.endsWith('4'), base = four ? v.slice(0, -1) : v;
  return (base === 'full' ? 'full' : 'combined') + (four ? '4' : '');
}
