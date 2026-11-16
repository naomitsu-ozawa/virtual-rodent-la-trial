export const AUTO_MAX = 1;
export const AUTO_MID = 0.7;
export const AUTO_FLOORS = [0.5, 0.35, 0.25]; // settings.autoMin index: 最低 50 % (default) / 35 % / 25 %
export const STEP_LEVELS = [1, 1.5, 2];
// the base ray-march step is STEP_VOXELS of the smallest voxel side of the texture actually in use (was: of the full grid,
// so the 256³ copy of 512³ data marched at 0.425 of its own voxel = twice the samples of the 512 case). Hits are bisection-refined and
// every colour / alpha contribution is per event (surface crossing, slice, cut face), not per step, so no opacity correction is needed.
export const STEP_VOXELS = 0.85;
export const marchStep = (halfExt, dims) => Math.max(1e-5, STEP_VOXELS * Math.min(...[0, 1, 2].map(i => 2 * halfExt[i] / Math.max(1, dims[i]))));
const OVER = 0.9;   // GPU time above this share of the frame budget counts as over
const UNDER = 0.8;  // a move up needs the predicted time at or below this share (dead band 0.8 .. 0.9)
const DOWN_N = 2;   // consecutive over samples before anything is lowered
const UP_N = 3;     // consecutive samples with headroom before anything is raised (GPU timer present)
const UP_N_BLIND = 6; // same with the wall-clock interval only (it is capped by the refresh rate: no headroom information)
const FAIL_MARGIN = 0.03; // a level this close to (or better than) one that failed under the same view is not retried
const FAIL_LAPSE = 120;   // samples (60 s) after which a failed level may be tried again
// a rise that fails is a stutter of its own (the frames of the probe are slow until two over samples have been seen). Two changes:
// the first over sample right after a rise (RISE_FAST windows) takes the level back at once, and each failed probe doubles the time the failed level is
// kept out (60 s, 120 s, ... up to FAIL_LAPSE_MAX = 8 min): a view whose cost has no room above the settled level is probed less and less often instead
// of every minute for ever. A change of the view (ctx) starts again at 60 s.
const RISE_FAST = 2, FAIL_LAPSE_MAX = 960;
// the covered pixels jump when the volume is magnified or brought close; the ladder used to need 2 over samples per rung
// (>= 1 s each, > 4 s to the floor). After a jump in coverage (factor JUMP), JUMP_SAMPLES samples step down on the FIRST over sample and by
// up to JUMP_SCALE at once; a drop in coverage by the same factor raises the resolution at once by the square root of the ratio (cost ~ pixels).
export const JUMP = 1.3, JUMP_SAMPLES = 4, JUMP_SCALE = 0.5;
// the ladder above reacts to a measured over sample, i.e. after the 0.5 s window in which the frames were
// already slow (and after the covered pixels have jumped 1.3x between two windows; a steady zoom of 1.2x per window never counts as a jump). anticipate() is
// called every frame with the volume's scale: when the scale grew by GROW_SCALE (area 1.25x) within GROW_WINDOW ms, the volume pass is about to cost
// (growth)^2 as much, so the resolution is lowered AT ONCE by the inverse of the growth (clamped to GROW_MAX_DROP per call), never below the MID rung
// (0.7 of the data-resolution cap: a slight blur; deeper rungs stay with the measured ladder), only when the last measurement says the predicted time would exceed the budget (or
// there is none yet), and not while the data-resolution cap already holds the scale in use below the level (cost then follows the cap, not the zoom).
// Recovery is the normal ladder. Scale constant, shrinking or growing slowly: no effect at all.
export const GROW_SCALE = 1.12, GROW_WINDOW = 300, GROW_MAX_DROP = 0.6, GROW_SPACING = 30, GROW_RING = 16;

export const autoFloor = idx => AUTO_FLOORS[idx] ?? AUTO_FLOORS[0];

export function createAutoQuality({ min = AUTO_FLOORS[0], baseStep = 0, f = AUTO_MAX } = {}) {
  const st = { f, stepIdx: baseStep, min, baseStep, over: 0, good: 0, penalty: 1, sinceUp: 99, stable: 0, failPos: null, sinceFail: 0, lapse: FAIL_LAPSE, ctx: null, ceil: 1, cover: 0, jump: 0, lastVol: 0, lastRest: 0, lastBudget: 0, gAcc: 1, stale: false };
  const gT = new Float64Array(GROW_RING), gS = new Float64Array(GROW_RING); let gN = 0, gHead = 0; // recent (time, scale) samples of anticipate()
  const gReset = (now, scale) => { gHead = 0; gN = 1; gT[0] = now; gS[0] = scale; }; // measure the next growth from here (a continued zoom drops again, proportionally)
  // ceil = the data-resolution cap (vr-render-scale.js). The scale in use is min(level, ceil): rendering at the cap loses no detail,
  // so it may lie below the floor. The level (st.f) keeps its own place on the ladder; an over sample first brings it down to the cap.
  const eff = () => Math.min(st.f, st.ceil);
  const maxIdx = () => Math.max(STEP_LEVELS.length - 1, st.baseStep);
  // the resolution rungs are RELATIVE to the data-resolution cap, like "100 % = full data detail" itself. At maximum zoom the cap lies at
  // 0.4 .. 0.6 (256^3 data), i.e. below the floor (0.5) and the MID rung (0.7): every resolution rung was then dead (scale in use = min(level, cap) = cap), only
  // the step 1 -> 2 could act, and the ladder stopped at 50 .. 60 fps with nothing left to give. capRel scales the MID rung and the floor with the cap, so
  // the rungs act below it (the cost follows eff^2). Without a cap (ceil = 1) nothing changes at all.
  const capRel = () => Math.min(1, st.ceil);
  const lowest = () => Math.max(0.05, st.min * capRel());
  const clampState = () => {
    st.min = Math.min(AUTO_MID, Math.max(0.05, st.min));
    st.stepIdx = Math.min(maxIdx(), Math.max(st.baseStep, st.stepIdx));
    st.f = Math.min(AUTO_MAX, Math.max(lowest(), st.f));
  };
  clampState();
  // position on the ladder, growing with the load saved: resolution first (1 - f), then one unit per step level
  const posOf = c => (1 - c.f) + (c.stepIdx - st.baseStep);
  const mid = () => Math.max(lowest(), AUTO_MID * capRel());
  // the next rung down from the present state, or null at the bottom
  const down = scale => {
    if (st.stepIdx < maxIdx()) {
      if (st.f > mid() + 1e-6) return { f: Math.max(mid(), st.f * scale), stepIdx: st.stepIdx };
      return { f: st.f, stepIdx: st.stepIdx + 1 };
    }
    if (st.f > lowest() + 1e-6) return { f: Math.max(lowest(), st.f * scale), stepIdx: st.stepIdx };
    return null;
  };
  // the next rung up (reverse order), or null at the top
  const up = () => {
    if (st.stepIdx >= maxIdx() && st.f < mid() - 1e-6) return { f: Math.min(mid(), st.f * 1.15), stepIdx: st.stepIdx };
    if (st.stepIdx > st.baseStep) return { f: Math.max(st.f, mid()), stepIdx: st.stepIdx - 1 };
    if (st.f < AUTO_MAX - 1e-6) return { f: Math.min(AUTO_MAX, st.f * 1.15), stepIdx: st.stepIdx };
    return null;
  };
  // predicted GPU time of a candidate state: the volume part scales with the
  // pixel count (f^2) and with 1/step; the rest of the frame stays
  const predict = (c, vol, rest) => {
    const px = (Math.min(c.f, st.ceil) / eff()) ** 2, stepR = STEP_LEVELS[st.stepIdx] / STEP_LEVELS[c.stepIdx];
    return rest + vol * px * stepR;
  };
  return {
    get f() { return eff(); },
    get level() { return Math.min(AUTO_MAX, st.f / capRel()); }, // the readout: relative to the cap (100 % = full data detail), as the rungs are; = st.f without a cap
    get ceiling() { return st.ceil; },
    get stepIdx() { return st.stepIdx; },
    get state() { return { f: st.f, stepIdx: st.stepIdx, over: st.over, good: st.good, penalty: st.penalty }; },
    setFloor(m) { st.min = m; clampState(); },
    setBaseStep(i) { st.baseStep = i; clampState(); },
    setCeiling(c) { st.ceil = Math.min(AUTO_MAX, Math.max(0.01, +c || AUTO_MAX)); clampState(); }, // the floor follows the cap (lowest())
    // called once per frame while the Auto resolution is on. scale = the volume holder's scale, now = ms. Returns true when the level was lowered.
    anticipate(scale, now) {
      if (!(scale > 0) || !Number.isFinite(now)) return false;
      if (gN > 0 && now < gT[(gHead + gN - 1) % GROW_RING]) gN = 0; // the clock went back (a session restart): start again
      if (gN === 0 || now - gT[(gHead + gN - 1) % GROW_RING] >= GROW_SPACING) { // at most one sample per GROW_SPACING ms
        if (gN === GROW_RING) { gHead = (gHead + 1) % GROW_RING; gN--; }
        const k = (gHead + gN) % GROW_RING; gT[k] = now; gS[k] = scale; gN++;
      } else gS[(gHead + gN - 1) % GROW_RING] = scale; // the newest sample follows the frame
      let ref = Infinity;
      for (let i = 0; i < gN; i++) { const k = (gHead + i) % GROW_RING; if (now - gT[k] <= GROW_WINDOW && gS[k] < ref) ref = gS[k]; }
      const ratio = scale / ref; // > 1: grown within the window
      if (!(ratio >= GROW_SCALE)) return false;
      const base = eff(), floor = mid(); // the MID rung, relative to the data-resolution cap like the ladder's (= 0.7 without a cap)
      if (st.ceil < st.f - 1e-6 || base <= floor + 1e-6) { gReset(now, scale); return false; } // capped by the data resolution, or already at / below the MID rung
      const acc = st.gAcc * ratio * ratio; // the covered pixels (and so the volume pass) grow with the area: the growth since the last measurement
      if (st.lastBudget > 0 && st.lastRest + st.lastVol * acc <= st.lastBudget * OVER) { st.gAcc = acc; gReset(now, scale); return false; } // measured headroom: no drop needed (yet)
      const nf = Math.max(floor, base * Math.max(GROW_MAX_DROP, 1 / ratio));
      gReset(now, scale);
      if (!(nf < st.f - 1e-6)) { st.gAcc = acc; return false; }
      st.gAcc = acc * (nf / base) ** 2; st.f = nf; st.good = 0; st.over = 0; st.stale = true; clampState();
      return true;
    },
    // sample: one 0.5 s window. volMs = GPU time of the low-resolution volume pass (0 when drawn directly),
    // mainMs = GPU time of the main pass (0 = no timer query: wall-clock interval only), interval = mean frame interval, budget = frame budget (ms)
    // cover = the screen pixels the volume covers (0 = unknown): a jump changes how fast the ladder moves (JUMP above)
  update({ volMs = 0, mainMs = 0, interval = 0, budget, ctx = null, cover = 0 }) {
      // the view changed (size, shown segments, section): what failed before says nothing about it
      if (ctx !== st.ctx) { st.ctx = ctx; st.failPos = null; st.lapse = FAIL_LAPSE; }
      if (st.failPos !== null && ++st.sinceFail >= st.lapse) st.failPos = null;
      let grew = false, shrunk = 0;
      if (cover > 0 && st.cover > 0) { const r = cover / st.cover; if (r >= JUMP) grew = true; else if (r <= 1 / JUMP) shrunk = r; }
      if (cover > 0) st.cover = cover;
      if (grew) st.jump = JUMP_SAMPLES; else if (st.jump > 0) st.jump--;
      const e0 = eff(), gpu = mainMs > 0;
      const total = mainMs + (e0 < AUTO_MAX ? volMs : 0);
      const vol = e0 < AUTO_MAX && volMs > 0 ? volMs : total, rest = e0 < AUTO_MAX && volMs > 0 ? mainMs : 0;
      // a window in which anticipate() lowered the level mixes frames of two levels (at f = 1 the main pass also holds the volume,
      // below it only the composite), so its timings describe neither: the ladder skips it (it would take a second, stale drop on top of the predicted
      // one and lock the level it left via failPos) and anticipate() gets no headroom information from it. The next window measures the new level.
      if (st.stale) { st.stale = false; st.over = 0; st.good = 0; st.gAcc = 1; st.lastVol = 0; st.lastRest = 0; st.lastBudget = 0; clampState(); return { f: eff(), stepIdx: st.stepIdx, changed: false, stepChanged: false }; }
      st.gAcc = 1; if (gpu) { st.lastVol = vol; st.lastRest = rest; st.lastBudget = budget; } else { st.lastVol = 0; st.lastRest = 0; st.lastBudget = 0; } // for anticipate(); no timer = no headroom information
      const dropping = interval > budget * 1.5; // frames are being dropped anyway
      const isOver = gpu ? (total > budget * OVER || dropping) : interval > budget * 1.12;
      const before = { f: st.f, stepIdx: st.stepIdx };
      let changed = false;
      st.sinceUp++;
      if (isOver) {
        st.over++; st.good = 0; st.stable = 0;
        if (st.over >= (st.jump > 0 || st.sinceUp <= RISE_FAST ? 1 : DOWN_N)) { // a rise that is over on its first window is taken back at once
          let scale = gpu ? Math.sqrt(Math.max(1, budget * UNDER - rest) / vol) : Math.sqrt(budget / interval);
          scale = Math.min(0.92, Math.max(st.jump > 0 ? JUMP_SCALE : 0.7, scale));
          if (dropping) scale = Math.min(scale, 0.85);
          if (st.f > st.ceil) st.f = st.ceil; // the level comes down to the scale in use first (otherwise the first rungs would change nothing)
          const c = down(scale);
          if (c) {
            st.failPos = posOf(before); st.sinceFail = 0; // this level is too heavy for the present view: do not climb back to it
            if (st.sinceUp <= 4) { st.penalty = Math.min(4, st.penalty * 2); st.lapse = Math.min(FAIL_LAPSE_MAX, st.lapse * 2); } // a rise just before was too optimistic: wait longer next time, and keep this level out longer
            st.f = c.f; st.stepIdx = c.stepIdx; changed = true;
          }
          st.over = 0;
        }
      } else if (shrunk > 0 && st.f < AUTO_MAX - 1e-6) {
        // the volume covers far fewer pixels now (zoomed out / moved away): the cost fell by about this ratio, raise at once
        st.over = 0; st.good = 0; st.f = Math.min(AUTO_MAX, st.f / Math.sqrt(shrunk)); st.failPos = null; changed = true; st.sinceUp = 0;
      } else {
        st.over = 0; st.stable++;
        if (st.stable >= 40 && st.penalty > 1) { st.penalty = 1; st.stable = 0; }
        const c = up();
        const blocked = c && st.failPos !== null && posOf(c) < st.failPos + FAIL_MARGIN;
        const ok = c && !blocked && (gpu ? predict(c, vol, rest) <= budget * UNDER : interval < budget * 1.04);
        if (ok) {
          st.good++;
          if (st.good >= Math.ceil((gpu ? UP_N : UP_N_BLIND) * st.penalty)) {
            st.f = c.f; st.stepIdx = c.stepIdx; changed = true; st.sinceUp = 0;
            st.good = c.stepIdx === before.stepIdx && gpu ? Math.ceil(UP_N * st.penalty) - 1 : 0; // small resolution rises chain (the prediction guards them); a step change waits
          }
        } else st.good = 0;
      }
      clampState();
      return { f: eff(), stepIdx: st.stepIdx, changed, stepChanged: st.stepIdx !== before.stepIdx };
    },
  };
}
