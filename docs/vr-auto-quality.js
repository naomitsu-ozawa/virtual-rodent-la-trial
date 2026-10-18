export const AUTO_MAX = 1;
export const AUTO_MID = 0.7;
export const AUTO_FLOORS = [0.5, 0.35, 0.25]; // settings.autoMin index: 最低 50 % (default) / 35 % / 25 %
export const STEP_LEVELS = [1, 1.5, 2];
// build 561: the base ray-march step is STEP_VOXELS of the smallest voxel side of the texture actually in use (was: of the full grid,
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
// build 560 (zoom): the covered pixels jump when the volume is magnified or brought close; the ladder used to need 2 over samples per rung
// (>= 1 s each, > 4 s to the floor). After a jump in coverage (factor JUMP), JUMP_SAMPLES samples step down on the FIRST over sample and by
// up to JUMP_SCALE at once; a drop in coverage by the same factor raises the resolution at once by the square root of the ratio (cost ~ pixels).
export const JUMP = 1.3, JUMP_SAMPLES = 4, JUMP_SCALE = 0.5;

export const autoFloor = idx => AUTO_FLOORS[idx] ?? AUTO_FLOORS[0];

export function createAutoQuality({ min = AUTO_FLOORS[0], baseStep = 0, f = AUTO_MAX } = {}) {
  const st = { f, stepIdx: baseStep, min, baseStep, over: 0, good: 0, penalty: 1, sinceUp: 99, stable: 0, failPos: null, sinceFail: 0, ctx: null, ceil: 1, cover: 0, jump: 0 };
  // build 560: ceil = the data-resolution cap (vr-render-scale.js). The scale in use is min(level, ceil): rendering at the cap loses no detail,
  // so it may lie below the floor. The level (st.f) keeps its own place on the ladder; an over sample first brings it down to the cap.
  const eff = () => Math.min(st.f, st.ceil);
  const maxIdx = () => Math.max(STEP_LEVELS.length - 1, st.baseStep);
  const clampState = () => {
    st.min = Math.min(AUTO_MID, Math.max(0.05, st.min));
    st.stepIdx = Math.min(maxIdx(), Math.max(st.baseStep, st.stepIdx));
    st.f = Math.min(AUTO_MAX, Math.max(st.min, st.f));
  };
  clampState();
  // position on the ladder, growing with the load saved: resolution first (1 - f), then one unit per step level
  const posOf = c => (1 - c.f) + (c.stepIdx - st.baseStep);
  const mid = () => Math.max(st.min, AUTO_MID);
  // the next rung down from the present state, or null at the bottom
  const down = scale => {
    if (st.stepIdx < maxIdx()) {
      if (st.f > mid() + 1e-6) return { f: Math.max(mid(), st.f * scale), stepIdx: st.stepIdx };
      return { f: st.f, stepIdx: st.stepIdx + 1 };
    }
    if (st.f > st.min + 1e-6) return { f: Math.max(st.min, st.f * scale), stepIdx: st.stepIdx };
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
    get level() { return st.f; },
    get ceiling() { return st.ceil; },
    get stepIdx() { return st.stepIdx; },
    get state() { return { f: st.f, stepIdx: st.stepIdx, over: st.over, good: st.good, penalty: st.penalty }; },
    setFloor(m) { st.min = m; clampState(); },
    setBaseStep(i) { st.baseStep = i; clampState(); },
    setCeiling(c) { st.ceil = Math.min(AUTO_MAX, Math.max(0.01, +c || AUTO_MAX)); },
    // sample: one 0.5 s window. volMs = GPU time of the low-resolution volume pass (0 when drawn directly),
    // mainMs = GPU time of the main pass (0 = no timer query: wall-clock interval only), interval = mean frame interval, budget = frame budget (ms)
    // cover (build 560) = the screen pixels the volume covers (0 = unknown): a jump changes how fast the ladder moves (JUMP above)
  update({ volMs = 0, mainMs = 0, interval = 0, budget, ctx = null, cover = 0 }) {
      // the view changed (size, shown segments, section): what failed before says nothing about it
      if (ctx !== st.ctx) { st.ctx = ctx; st.failPos = null; }
      if (st.failPos !== null && ++st.sinceFail >= FAIL_LAPSE) st.failPos = null;
      let grew = false, shrunk = 0;
      if (cover > 0 && st.cover > 0) { const r = cover / st.cover; if (r >= JUMP) grew = true; else if (r <= 1 / JUMP) shrunk = r; }
      if (cover > 0) st.cover = cover;
      if (grew) st.jump = JUMP_SAMPLES; else if (st.jump > 0) st.jump--;
      const e0 = eff(), gpu = mainMs > 0;
      const total = mainMs + (e0 < AUTO_MAX ? volMs : 0);
      const vol = e0 < AUTO_MAX && volMs > 0 ? volMs : total, rest = e0 < AUTO_MAX && volMs > 0 ? mainMs : 0;
      const dropping = interval > budget * 1.5; // frames are being dropped anyway
      const isOver = gpu ? (total > budget * OVER || dropping) : interval > budget * 1.12;
      const before = { f: st.f, stepIdx: st.stepIdx };
      let changed = false;
      st.sinceUp++;
      if (isOver) {
        st.over++; st.good = 0; st.stable = 0;
        if (st.over >= (st.jump > 0 ? 1 : DOWN_N)) {
          let scale = gpu ? Math.sqrt(Math.max(1, budget * UNDER - rest) / vol) : Math.sqrt(budget / interval);
          scale = Math.min(0.92, Math.max(st.jump > 0 ? JUMP_SCALE : 0.7, scale));
          if (dropping) scale = Math.min(scale, 0.85);
          if (st.f > st.ceil) st.f = st.ceil; // the level comes down to the scale in use first (otherwise the first rungs would change nothing)
          const c = down(scale);
          if (c) {
            st.failPos = posOf(before); st.sinceFail = 0; // this level is too heavy for the present view: do not climb back to it
            if (st.sinceUp <= 4) st.penalty = Math.min(4, st.penalty * 2); // a rise just before was too optimistic: wait longer next time
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
