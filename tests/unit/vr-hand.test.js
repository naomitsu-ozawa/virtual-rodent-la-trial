import { describe, it, expect } from 'vitest';
import {
  isHand, createOneEuro, euroAlpha, ONE_EURO, createPoseFilter, createPinchHysteresis, PINCH_ON_M, PINCH_OFF_M, createPoseHistory, RAY_DELAY_MS,
  createTrackingLoss, LOSS_CANCEL_MS, wristMenuMetrics, createWristMenuGate, WRIST_MENU, WRIST_ITEMS, WRIST_GRID, wristSlotFromUv, handTexts,
  fingerCurl, grabScore, createGrabHysteresis, GRAB, GRAB_JOINT_NAMES, GRAB_FINGERS, palmPoint, PALM_FROM_WRIST, WRIST_SCROLL, wristScrollGain, wristScrollSign,
  handAlive, fistForming, FIST_GUARD, wristScrollKeep, PINCH, PINCH_FUSION, createPinchFusion, DRAG_CARRY, createDragCarry, blendPose, parsePinchTune, parseDragTune,
  PALM_FILTER, RAY_DELAY, rayDelayMs, slewDelay, boxDist, centeredBoxDist, squareOutlineDist, pickNearGrab, NEAR_KINDS, parseFilterTune, parseGrabTune,
  HAND_RAY, HAND_RAY_FILTER, PINCH_LOCK, headForward, shoulderPoint, aimPoint, rayDirection, dirQuat, turnDir, createPinchLock, createHandRay,
} from '../../docs/vr-hand.js';
import { pinchScale } from '../../docs/vr-real-scale.js';
import { DRAG_RECORD, DRAG_HAND, DRAG_RECORD_HAND, HAND_LABEL_MOVE_M, dragShouldStart, sectionFollowStart, sectionFollowStep } from '../../docs/vr-point.js';

// hand tracking (Quest 3), the pure module
const FRAME = 1000 / 72;

// unit quaternion of the rotation whose columns (local X, Y, Z in world) are x, y, z (orthonormal, right-handed)
function quatFromBasis(x, y, z) {
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2], tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  const l = Math.hypot(...q); return q.map(v => v / l);
}
const norm = v => { const l = Math.hypot(...v); return v.map(a => a / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// a wrist joint whose back of the hand (+Y) points along `dorsal` and whose fingers (-Z) point along `fingers`
const wristQ = (dorsal, fingers) => { const y = norm(dorsal), z = norm(fingers.map(v => -v)), x = cross(y, z); return quatFromBasis(x, y, z); };

describe('isHand', () => {
  it('only an input source with .hand is a hand', () => {
    expect(isHand({ hand: new Map() })).toBe(true);
    expect(isHand({ handedness: 'left', gamepad: {} })).toBe(false);
    expect(isHand(null)).toBe(false); expect(isHand(undefined)).toBe(false); expect(isHand({ hand: null })).toBe(false);
  });
});

describe('One Euro filter', () => {
  it('defaults: 1.2 Hz, beta 0.05, speed estimate at 5 Hz', () => { expect(ONE_EURO).toEqual({ minCutoff: 1.2, beta: 0.05, dCutoff: 5 }); });
  it('alpha grows with the cutoff and the time step', () => {
    expect(euroAlpha(1, 0.01)).toBeLessThan(euroAlpha(5, 0.01)); expect(euroAlpha(1, 0.01)).toBeLessThan(euroAlpha(1, 0.05));
    expect(euroAlpha(1, 0.01)).toBeGreaterThan(0); expect(euroAlpha(1, 1e6)).toBeLessThanOrEqual(1);
  });
  it('a constant passes unchanged; the first sample is taken as it is', () => {
    const f = createOneEuro(2), out = [0, 0];
    for (let i = 0; i < 50; i++) f.filter([0.3, -1.2], i * FRAME, out);
    expect(out[0]).toBeCloseTo(0.3, 12); expect(out[1]).toBeCloseTo(-1.2, 12);
  });
  it('jitter at rest is smoothed (white noise: to ~0.35 of the input)', () => {
    const f = createOneEuro(1, { speedScale: 1000 }); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const inp = [], outp = [];
    for (let i = 0; i < 400; i++) { const v = 0.002 * rnd(); inp.push(v); outp.push(f.filter([v], i * FRAME, [0])[0]); } // +-1 mm hand tremor
    const sd = a => { const s = a.slice(100), m = s.reduce((x, y) => x + y, 0) / s.length; return Math.sqrt(s.reduce((x, y) => x + (y - m) ** 2, 0) / s.length); };
    expect(sd(outp)).toBeLessThan(sd(inp) * 0.4);
  });
  it('a fast move trails less with beta (mm scale) than without', () => {
    const run = beta => { const f = createOneEuro(1, { beta, speedScale: 1000 }); let o = 0; for (let i = 0; i <= 36; i++) o = f.filter([i * FRAME / 1000 * 1.0], i * FRAME, [0])[0]; return 0.5 - o; }; // 1 m/s for 0.5 s
    const lag0 = run(0), lag1 = run(0.01);
    expect(lag1).toBeLessThan(lag0 * 0.5); expect(lag1).toBeGreaterThan(0);
  });
  it('a repeated / older time stamp returns the previous output; reset takes the next sample as it is', () => {
    const f = createOneEuro(1); f.filter([0], 0, [0]); const a = f.filter([1], 20, [0])[0];
    expect(f.filter([5], 20, [0])[0]).toBe(a); expect(f.filter([5], 10, [0])[0]).toBe(a);
    f.reset(); expect(f.primed).toBe(false); expect(f.filter([9], 30, [0])[0]).toBe(9);
  });
  it('the pose filter keeps the quaternion on one hemisphere and normalised', () => {
    const pf = createPoseFilter(), out = new Float64Array(7), s = Math.SQRT1_2;
    pf.filter([0, 1, 0, 0, 0, s, s], 0, out);
    pf.filter([0, 1, 0, 0, 0, -s, -s], FRAME, out); // the same rotation, the other sign
    expect(Math.abs(out[5] * s + out[6] * s)).toBeCloseTo(1, 9); // still the same turn (not pulled through zero)
    expect(Math.hypot(out[3], out[4], out[5], out[6])).toBeCloseTo(1, 12);
    expect(out[1]).toBeCloseTo(1, 12);
  });
});

describe('pinch hysteresis', () => {
  it('defaults: on below 1.8 cm for 2 frames, off above 3 cm for 2 frames', () => {
    expect(PINCH).toEqual({ on: 0.018, off: 0.03, onFrames: 2, offFrames: 2 }); expect(PINCH_ON_M).toBe(0.018); expect(PINCH_OFF_M).toBe(0.03);
  });
  it('on after 2 frames below on, off after 2 frames above off; the band between keeps the state; a missing distance keeps state and count', () => {
    const p = createPinchHysteresis();
    expect(p.update(0.04)).toBe(false); expect(p.update(0.017)).toBe(false); expect(p.update(0.016)).toBe(true);
    expect(p.update(0.025)).toBe(true); expect(p.update(0.029)).toBe(true); expect(p.update(NaN)).toBe(true);
    expect(p.update(0.031)).toBe(true); expect(p.update(undefined)).toBe(true); expect(p.update(0.035)).toBe(false);
    expect(p.update(0.02)).toBe(false); expect(p.update(0.019)).toBe(false);
    p.update(0.01); p.update(0.01); expect(p.pinched).toBe(true); p.reset(); expect(p.pinched).toBe(false);
  });
  it('one frame of blur (a wrist swing: the tips jump apart / together for a frame) neither ends nor starts a pinch', () => {
    const p = createPinchHysteresis();
    p.update(0.01); p.update(0.01); expect(p.pinched).toBe(true);
    for (let i = 0; i < 20; i++) { expect(p.update(i % 3 === 0 ? 0.05 : 0.012)).toBe(true); } // a single far frame every 3rd frame
    p.update(0.05); p.update(0.05); expect(p.pinched).toBe(false);
    for (let i = 0; i < 20; i++) { expect(p.update(i % 3 === 0 ? 0.01 : 0.04)).toBe(false); }
  });
  it('custom thresholds / frame counts (localStorage vrl-hand-pinch)', () => {
    const p = createPinchHysteresis({ on: 0.025, off: 0.04, onFrames: 1, offFrames: 3 });
    expect(p.update(0.024)).toBe(true); expect(p.update(0.045)).toBe(true); expect(p.update(0.045)).toBe(true); expect(p.update(0.045)).toBe(false);
  });
});

// one press per pinch: the own pinch (per frame) OR the system's select (events)
describe('createPinchFusion: own pinch + system select = one press', () => {
  const T = 1000 / 72;
  // drives frames of own distances; sys: {frameIndex: true/false} system select edges before that frame; returns the edges with their frame
  const run = (f, ds, sys = {}, guard = () => false) => {
    const ev = [];
    ds.forEach((d, i) => { const t = i * T; if (i in sys) { const e = f.os(sys[i], t, guard(i)); if (e) ev.push([e, i, 'os']); } const e = f.own(d, t, guard(i)); if (e) ev.push([e, i, 'own']); });
    return ev;
  };
  const pinch = (open = 4, closed = 10, after = 4) => [...Array(open).fill(0.06), ...Array(closed).fill(0.01), ...Array(after).fill(0.06)];
  it('defaults: both inputs on, a system select within 100 ms after a press ended is its tail', () => { expect(PINCH_FUSION).toEqual({ own: 1, os: 1, osGapMs: 100 }); });
  it('own pinch alone: one start (2nd closed frame), one end (2nd open frame)', () => {
    expect(run(createPinchFusion(), pinch())).toEqual([['start', 5, 'own'], ['end', 15, 'own']]);
  });
  it('own first, the system joins and leaves: still one press, ended by the own pinch', () => {
    expect(run(createPinchFusion(), pinch(), { 7: true, 12: false })).toEqual([['start', 5, 'own'], ['end', 15, 'own']]);
  });
  it('the system first (it saw the pinch earlier): its start is the press, the own pinch joins and ends it (one press)', () => {
    expect(run(createPinchFusion(), pinch(), { 3: true, 16: false })).toEqual([['start', 3, 'os'], ['end', 15, 'own']]);
  });
  it('a wrist swing: the system drops the select mid-pinch and selects again — the press goes on until the fingers open', () => {
    expect(run(createPinchFusion(), pinch(4, 30), { 4: true, 12: false, 14: true, 20: false, 22: true, 36: false })).toEqual([['start', 4, 'os'], ['end', 35, 'own']]);
  });
  it('a pinch only the system sees (fingertips read 2.2 cm): the system ends it', () => {
    expect(run(createPinchFusion(), Array(20).fill(0.022), { 3: true, 12: false })).toEqual([['start', 3, 'os'], ['end', 12, 'os']]);
  });
  it('a system select that starts again right after the release (< 100 ms) is the same pinch; later it is a new one', () => {
    expect(run(createPinchFusion(), pinch(4, 10, 20), { 16: true, 17: false, 30: true, 31: false })).toEqual([['start', 5, 'own'], ['end', 15, 'own'], ['start', 30, 'os'], ['end', 31, 'os']]);
  });
  it('the fist guard: no press, and the pinch never fires later while it is held (latched until both inputs are released)', () => {
    const g = i => i < 8; // the hand is closing into a fist for the first frames, then the guard clears while the fingers stay closed
    expect(run(createPinchFusion(), pinch(4, 10), { 5: true, 13: false }, g)).toEqual([]);
    // released, then a real pinch
    const f = createPinchFusion(); run(f, pinch(4, 10), { 5: true }, g);
    expect(run(f, pinch(4, 10), { 0: false })).toEqual([['start', 5, 'own'], ['end', 15, 'own']]);
  });
  it('cancel() (tracking lost / the fist took over): no end is reported, no new press until the pinch opened', () => {
    const f = createPinchFusion(); const ev = [];
    pinch(4, 10, 4).forEach((d, i) => { if (i === 8) f.cancel(); const e = f.own(d, i * T); if (e) ev.push([e, i]); });
    expect(ev).toEqual([['start', 5]]); expect(f.pressed).toBe(false);
    expect(run(f, pinch())).toEqual([['start', 5, 'own'], ['end', 15, 'own']]);
  });
  it('own:false = the system select alone (as before); os:false = the own pinch alone', () => {
    expect(run(createPinchFusion({ own: 0 }), Array(30).fill(0.01), { 3: true, 9: false, 20: true, 26: false })).toEqual([['start', 3, 'os'], ['end', 9, 'os'], ['start', 20, 'os'], ['end', 26, 'os']]);
    expect(run(createPinchFusion({ os: 0 }), Array(20).fill(0.022), { 3: true, 12: false })).toEqual([]);
    expect(run(createPinchFusion({ os: 0 }), pinch(), { 3: true, 12: false })).toEqual([['start', 5, 'own'], ['end', 15, 'own']]);
  });
  it('starts and ends always alternate (random edges and distances)', () => {
    let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let k = 0; k < 20; k++) {
      const f = createPinchFusion(), ds = [], sys = {};
      for (let i = 0; i < 300; i++) { ds.push(rnd() < 0.05 ? NaN : rnd() < 0.5 ? 0.01 : 0.05); if (rnd() < 0.1) sys[i] = rnd() < 0.5; }
      const ev = run(f, ds, sys, () => rnd() < 0.05);
      ev.forEach(([e], i) => expect(e).toBe(i % 2 ? 'end' : 'start'));
    }
  });
});

describe('delayed ray (pose history)', () => {
  const pose = x => [x, 0, 0, 0, 0, 0, 1];
  it('returns the newest pose at or before now - 60 ms', () => {
    expect(RAY_DELAY_MS).toBeGreaterThanOrEqual(50); expect(RAY_DELAY_MS).toBeLessThanOrEqual(80);
    const h = createPoseHistory(), out = new Float64Array(7);
    for (let i = 0; i <= 20; i++) h.push(i * FRAME, pose(i));
    const now = 20 * FRAME, t = h.at(now - RAY_DELAY_MS, out);
    expect(t).toBeLessThanOrEqual(now - RAY_DELAY_MS); expect(t).toBeGreaterThan(now - RAY_DELAY_MS - FRAME);
    expect(out[0]).toBe(Math.round(t / FRAME)); // the pose recorded at that time (16 at 72 Hz: 4 frames back)
  });
  it('the pinch jump is left out: a ray that turns in the last 40 ms before selectstart still gives the pose before it', () => {
    const h = createPoseHistory(), out = new Float64Array(7);
    for (let i = 0; i <= 30; i++) h.push(i * FRAME, pose(i < 27 ? 0 : 0.05)); // the last 3 frames (~40 ms) jumped 5 cm
    h.at(30 * FRAME - RAY_DELAY_MS, out); expect(out[0]).toBe(0);
  });
  it('a record shorter than the delay gives its oldest pose; empty gives null; the ring wraps', () => {
    const h = createPoseHistory(4), out = new Float64Array(7);
    expect(h.at(100, out)).toBe(null);
    h.push(100, pose(1)); h.push(110, pose(2));
    expect(h.at(50, out)).toBe(100); expect(out[0]).toBe(1);
    for (let i = 3; i <= 9; i++) h.push(100 + (i - 1) * 10, pose(i)); // 7 more into a ring of 4: 6..9 remain (t 150..180)
    expect(h.length).toBe(4); expect(h.at(0, out)).toBe(150); expect(out[0]).toBe(6);
    expect(h.at(175, out)).toBe(170); expect(out[0]).toBe(8);
    h.reset(); expect(h.at(1000, out)).toBe(null);
  });
});

describe('tracking loss timer', () => {
  it('cancels once after 200 ms without a pose, and drops the first frame back', () => {
    expect(LOSS_CANCEL_MS).toBe(200);
    const l = createTrackingLoss(), seq = [];
    let t = 0; const step = (has, dt = FRAME) => { t += dt; seq.push(l.update(has, t)); return seq.at(-1); };
    expect(step(false)).toBe('lost'); for (let i = 0; i < 30; i++) expect(step(false)).toBe('lost'); // never seen yet: no timer, no cancel
    expect(step(true)).toBe('ok'); expect(step(true)).toBe('ok');
    expect(step(false)).toBe('lost'); expect(step(false, 100)).toBe('lost'); // 100 ms gone: the operation goes on
    expect(step(true)).toBe('recover'); expect(step(true)).toBe('ok');
    expect(step(false)).toBe('lost'); expect(step(false, 150)).toBe('lost'); expect(step(false, 60)).toBe('cancel'); // 210 ms
    expect(step(false, 500)).toBe('lost'); // only once
    expect(step(true)).toBe('recover'); expect(step(true)).toBe('ok');
    l.reset(); expect(l.update(false, t + 1000)).toBe('lost'); expect(l.update(false, t + 2000)).toBe('lost');
  });
});

describe('wrist menu decision (synthetic joint poses)', () => {
  const head = { x: 0, y: 1.6, z: 0 }, wp = [0, 1.25, -0.3]; // the left wrist 35 cm below and 30 cm in front of the eyes
  const toHead = norm([head.x - wp[0], head.y - wp[1], head.z - wp[2]]);
  const watch = wristQ(toHead, [1, 0, 0]); // back of the wrist to the eyes, fingers across to the right (a watch check)
  const palm = wristQ(toHead.map(v => -v), [1, 0, 0]); // palm to the face (the OS's own gesture)
  const pointing = wristQ([0, 1, 0], [0, 0, -1]); // aiming forward, back of the hand up
  const run = (q, ms, gate, t0 = 0, blocked = false) => { let v = false, t = t0; for (; t <= t0 + ms; t += FRAME) v = gate.update(wristMenuMetrics(wp, q, head), t, blocked); return { v, t }; };
  it('metrics: the watch pose faces the eyes with the fingers across; the palm-up pose faces away; aiming has the fingers away from the face', () => {
    const m = wristMenuMetrics(wp, watch, head); expect(m.facing).toBeCloseTo(1, 6); expect(m.across).toBeCloseTo(0, 6); expect(m.dist).toBeCloseTo(Math.hypot(0.35, 0.3), 9);
    expect(wristMenuMetrics(wp, palm, head).facing).toBeCloseTo(-1, 6);
    const a = wristMenuMetrics(wp, pointing, head); expect(a.across).toBeGreaterThan(WRIST_MENU.maxAcross);
    expect(wristMenuMetrics([0, 1, 0], watch, [0, 1, 0]).facing).toBe(-1); // degenerate: the head on the wrist
  });
  it('shown only after the watch pose is held 150 ms', () => {
    const g = createWristMenuGate();
    expect(g.update(wristMenuMetrics(wp, watch, head), 0)).toBe(false);
    expect(g.update(wristMenuMetrics(wp, watch, head), 100)).toBe(false);
    expect(g.update(wristMenuMetrics(wp, watch, head), 160)).toBe(true);
  });
  it('never for the palm turned to the face (the system menu gesture) nor for aiming forward', () => {
    expect(run(palm, 2000, createWristMenuGate()).v).toBe(false);
    expect(run(pointing, 2000, createWristMenuGate()).v).toBe(false);
    const g = createWristMenuGate(); expect(run(watch, 400, g, 0, false).v).toBe(true);
    expect(g.update(wristMenuMetrics([0, 1.25, -1.5], watch, head), 1000)).toBe(true); // too far: not hidden at once ...
    expect(run(watch, 2000, createWristMenuGate()).v).toBe(true);
  });
  it('hides once the wrist turns away (after the hide delay), with a looser limit while shown; blocked hides at once', () => {
    const g = createWristMenuGate(); let r = run(watch, 400, g); expect(r.v).toBe(true);
    const tilted = wristQ(norm([toHead[0] + 0.9, toHead[1], toHead[2]]), [0, 0.3, 1]); // facing about 0.6: below show, above hide
    const m = wristMenuMetrics(wp, tilted, head); expect(m.facing).toBeLessThan(WRIST_MENU.showFacing); expect(m.facing).toBeGreaterThan(WRIST_MENU.hideFacing);
    expect(g.update(m, r.t + 500)).toBe(true); // kept
    expect(g.update(wristMenuMetrics(wp, palm, head), r.t + 600)).toBe(true); // turned away: not yet
    expect(g.update(wristMenuMetrics(wp, palm, head), r.t + 760)).toBe(false); // after 150 ms
    r = run(watch, 400, g, r.t + 1000); expect(r.v).toBe(true);
    expect(g.update(wristMenuMetrics(wp, watch, head), r.t + 10, true)).toBe(false); // the left hand pinches / tracking lost
    expect(g.update(null, r.t + 20)).toBe(false);
  });
  it('seven buttons in slot order (ring, menu, sections, add, undo, section -, section +), laid out as a 3 x 3 grid; uv -> slot', () => {
    expect(WRIST_ITEMS).toEqual(['ring', 'menu', 'section', 'add', 'undo', 'secDown', 'secUp']);
    expect(WRIST_GRID.cells).toHaveLength(WRIST_ITEMS.length); expect(WRIST_GRID.cols).toBe(3); expect(WRIST_GRID.rows).toBe(3);
    const key = c => c.join(','); expect(new Set(WRIST_GRID.cells.map(key)).size).toBe(WRIST_ITEMS.length); // one cell each
    for (const [c, r] of WRIST_GRID.cells) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(3); expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThan(3); }
    // the cell centre -> its slot (v is up: row 0 is the top)
    WRIST_GRID.cells.forEach(([c, r], i) => expect(wristSlotFromUv((c + 0.5) / 3, 1 - (r + 0.5) / 3), WRIST_ITEMS[i]).toBe(i));
    expect(wristSlotFromUv(0.01, 0.99)).toBe(0); expect(wristSlotFromUv(0.5, 0.99)).toBe(1); expect(wristSlotFromUv(0.99, 0.99)).toBe(2); // top row
    expect(wristSlotFromUv(0.01, 0.5)).toBe(3); expect(wristSlotFromUv(0.5, 0.5)).toBe(4); // middle row: add, undo
    expect(wristSlotFromUv(0.01, 0.01)).toBe(5); expect(wristSlotFromUv(0.4, 0.01)).toBe(6); // bottom row: the 断面 - / + pair side by side
    expect(wristSlotFromUv(0.9, 0.5)).toBe(null); expect(wristSlotFromUv(0.9, 0.1)).toBe(null); // the empty cells hit nothing
    expect(wristSlotFromUv(1, 1)).toBe(2); expect(wristSlotFromUv(0, 0)).toBe(5); // the edges stay in their cell
    expect(wristSlotFromUv(NaN, 0.5)).toBe(null); expect(wristSlotFromUv(0.5, undefined)).toBe(null);
  });
  it('the panel is compact: 15 x 10.5 cm (the strip was 28 x 4), buttons 5 x 3.5 cm', () => {
    expect(WRIST_GRID.cellW).toBe(0.05); expect(WRIST_GRID.cellH).toBe(0.035);
    const w = WRIST_GRID.cols * WRIST_GRID.cellW, h = WRIST_GRID.rows * WRIST_GRID.cellH; expect(w).toBeCloseTo(0.15, 9); expect(h).toBeCloseTo(0.105, 9); expect(w).toBeLessThan(0.28);
    expect(WRIST_GRID.cellH).toBeGreaterThanOrEqual(0.03); // readable at arm's length (the strip's buttons were 4 cm)
  });
  it('断面 -/+ held: a tap nudges (0.4), holding ramps to the full stick in 1 s; + = stick up (-), - = stick down (+)', () => {
    expect(wristScrollGain(0)).toBeCloseTo(WRIST_SCROLL.start); expect(wristScrollGain(WRIST_SCROLL.rampMs / 2)).toBeCloseTo((1 + WRIST_SCROLL.start) / 2);
    expect(wristScrollGain(WRIST_SCROLL.rampMs)).toBe(1); expect(wristScrollGain(1e6)).toBe(1); expect(wristScrollGain(-5)).toBeCloseTo(WRIST_SCROLL.start); expect(wristScrollGain(undefined)).toBeCloseTo(WRIST_SCROLL.start);
    for (let t = 0; t < 1500; t += 50) expect(wristScrollGain(t + 50)).toBeGreaterThanOrEqual(wristScrollGain(t));
    expect(wristScrollSign('secUp')).toBe(-1); expect(wristScrollSign('secDown')).toBe(1); expect(wristScrollSign('ring')).toBe(0);
  });
});

describe('hand texts and thresholds', () => {
  it('ja / en: the help fits the board (6 lines), the fist is documented (grab, boards, two fists), one wrist label per button', () => {
    for (const ja of [true, false]) {
      const t = handTexts(ja);
      expect(t.helpBasic.length).toBeLessThanOrEqual(6); expect(t.helpSec.length).toBeLessThanOrEqual(6);
      expect(t.wrist(true)).toHaveLength(WRIST_ITEMS.length); expect(t.wrist(false)[2][1]).not.toBe(t.wrist(true)[2][1]);
    }
    // the help board draws each line unwrapped: no line longer than the pre-existing longest (47 ja / 125 en before; now 39 / 98)
    for (const [x, max] of [[handTexts(true), 47], [handTexts(false), 100]]) for (const l of x.helpBasic.concat(x.helpSec, x.helpMenu)) expect(l.length, l).toBeLessThanOrEqual(max);
    const j = handTexts(true), e = handTexts(false);
    expect(j.helpBasic.join()).toContain('ピンチ'); expect(j.helpBasic.join()).toContain('手首メニュー'); expect(j.helpBasic.join()).toContain('グー'); expect(j.helpBasic.join()).toContain('両手でグー');
    expect(j.helpMenuSimple).toContain('グー'); expect(e.helpMenuSimple).toContain('fist'); // 体験会モードのかんたんメニュー（ボタンのみ）
    expect(j.helpSec.join()).toContain('断面＋／－'); expect(j.helpMenu).toContain('グー'); expect(e.helpBasic.join()).toContain('Fist'); expect(e.helpBasic.join()).toContain('Two fists');
    expect(e.helpSec.join()).toContain('Section + / -'); expect(e.helpMenu).toContain('fist');
    for (const x of [j, e]) expect(x.helpBasic.concat(x.helpSec, x.helpMenu).join()).not.toMatch(/コントローラーで|with the controllers/); // nothing is left to the controllers any more
    expect(j.wrist(true).map(x => x[0])).toEqual(['よく使う', 'メニュー', '断面', '断面を', '取り消し', '断面', '断面']);
    expect(j.wrist(true).slice(5).map(x => x[1])).toEqual(['－', '＋']);
  });
  it('the hand drag thresholds are at least 2 cm / 5 deg; the controller ones are unchanged', () => {
    expect(DRAG_RECORD).toEqual({ posM: 0.02, angDeg: 5, holdMs: Infinity });
    expect(DRAG_HAND.posM).toBeGreaterThanOrEqual(0.02); expect(DRAG_HAND.angDeg).toBeGreaterThanOrEqual(5);
    expect(DRAG_RECORD_HAND.posM).toBeGreaterThanOrEqual(DRAG_RECORD.posM); expect(DRAG_RECORD_HAND.angDeg).toBeGreaterThanOrEqual(DRAG_RECORD.angDeg); expect(DRAG_RECORD_HAND.holdMs).toBe(Infinity);
    expect(HAND_LABEL_MOVE_M).toBeGreaterThanOrEqual(0.02);
    expect(dragShouldStart({ dPosM: 0.015 })).toBe(true); expect(dragShouldStart({ dPosM: 0.015 }, DRAG_HAND)).toBe(false); // 1.5 cm drags a controller press, not a hand's
    expect(dragShouldStart({ dAngleDeg: 3 }, DRAG_HAND)).toBe(false); expect(dragShouldStart({ dAngleDeg: 5.5 }, DRAG_HAND)).toBe(true);
  });
});

// ---- phase 2: the fist = the grip ----
const P = (x, y = 0, z = 0) => ({ x, y, z });
// a finger as 5 joints along +x from the metacarpal, bone length 4 cm each (extended) or folded back by `bend` (0 = straight line, 1 = folded back on itself)
const finger = bend => {
  const pts = [P(0)]; let ang = 0, x = 0, y = 0;
  for (let i = 1; i < 5; i++) { if (i > 1) ang += bend * Math.PI * 0.35; x += 0.04 * Math.cos(ang); y += 0.04 * Math.sin(ang); pts.push(P(x, y)); }
  return pts;
};
describe('fingerCurl', () => {
  it('~1 extended, falls as the finger curls, independent of size and position', () => {
    expect(fingerCurl(finger(0))).toBeCloseTo(1, 6);
    const c = [0.25, 0.5, 0.8, 1].map(b => fingerCurl(finger(b)));
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThan(c[i - 1]);
    expect(c[0]).toBeGreaterThan(GRAB.off); expect(c[3]).toBeLessThan(GRAB.on);
    const moved = finger(0.8).map(p => P(p.x * 1.4 + 3, p.y * 1.4 - 2, 7)); expect(fingerCurl(moved)).toBeCloseTo(fingerCurl(finger(0.8)), 9);
  });
  it('NaN when a joint is missing or the finger has no length', () => {
    const f = finger(0.3); f[2] = null; expect(fingerCurl(f)).toBeNaN(); expect(fingerCurl(null)).toBeNaN(); expect(fingerCurl([])).toBeNaN();
    expect(fingerCurl([P(0), P(0), P(0), P(0), P(0)])).toBeNaN();
  });
  it('joint names: four fingers x (metacarpal, proximal, intermediate, distal, tip), thumb left out', () => {
    expect(GRAB_FINGERS).toEqual(['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']);
    expect(GRAB_JOINT_NAMES).toHaveLength(4);
    expect(GRAB_JOINT_NAMES[1]).toEqual(['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip']);
    expect(GRAB_JOINT_NAMES.flat().some(n => /thumb/.test(n))).toBe(false);
  });
});
describe('grabScore: a fist needs all four fingers', () => {
  it('is the least curled finger; NaN when one is unknown', () => {
    expect(grabScore([0.3, 0.4, 0.35, 0.5])).toBe(0.5); expect(grabScore([0.3, 0.9, 0.3, 0.3])).toBe(0.9);
    expect(grabScore([0.3, NaN, 0.3, 0.3])).toBeNaN(); expect(grabScore([])).toBeNaN();
  });
  it('a fist is below GRAB.on, pointing (index out) / an open hand / a pinch posture (index half bent out) are not', () => {
    const fist = grabScore([1, 1, 1, 1].map(b => fingerCurl(finger(b))));
    const pointing = grabScore([0, 1, 1, 1].map(b => fingerCurl(finger(b))));
    const open = grabScore([0, 0, 0, 0].map(b => fingerCurl(finger(b))));
    const pinch = grabScore([0.45, 0.8, 0.9, 0.9].map(b => fingerCurl(finger(b))));
    expect(fist).toBeLessThan(GRAB.on); expect(pointing).toBeGreaterThan(GRAB.off); expect(open).toBeGreaterThan(GRAB.off); expect(pinch).toBeGreaterThan(GRAB.on);
  });
});
describe('createGrabHysteresis', () => {
  const run = (g, seq, t0 = 0, dt = 14) => { const ev = []; let t = t0; for (const sc of seq) { const e = g.update(sc, t); if (e) ev.push([e, t]); t += dt; } return { ev, t }; };
  it('defaults: on 0.55 < off 0.7, 60 ms to start, reach 5 cm', () => { expect(GRAB).toEqual({ on: 0.55, off: 0.7, holdMs: 60, near: 0.05 }); expect(GRAB.on).toBeLessThan(GRAB.off); });
  it('starts only after the fist has been held holdMs; ends the moment it opens past off; the band between on and off keeps the state', () => {
    const g = createGrabHysteresis();
    expect(run(g, Array(5).fill(0.3)).ev).toEqual([]); // 56 ms: not yet
    expect(g.pending).toBe(true); expect(g.active).toBe(false);
    const r = run(g, Array(10).fill(0.3), 70); expect(r.ev).toHaveLength(1); expect(r.ev[0][0]).toBe('start'); expect(r.ev[0][1] - 0).toBeGreaterThanOrEqual(GRAB.holdMs); expect(g.active).toBe(true);
    expect(run(g, [0.6, 0.65, 0.69, 0.6], r.t).ev).toEqual([]); expect(g.active).toBe(true); // between on and off: kept
    const e = run(g, [0.71], r.t + 100); expect(e.ev).toEqual([['end', r.t + 100]]); expect(g.active).toBe(false);
  });
  it('a brief closing (< holdMs) never grabs; the timer restarts after an opening', () => {
    const g = createGrabHysteresis();
    expect(run(g, [0.3, 0.3, 0.3, 0.8, 0.3, 0.3, 0.3, 0.8]).ev).toEqual([]);
    expect(g.pending).toBe(false);
  });
  it('NaN (joints lost) keeps an active grab and drops a pending one', () => {
    const g = createGrabHysteresis(); run(g, Array(12).fill(0.3)); expect(g.active).toBe(true);
    expect(run(g, [NaN, NaN, NaN], 500).ev).toEqual([]); expect(g.active).toBe(true);
    const h = createGrabHysteresis(); run(h, [0.3, 0.3, 0.3]); expect(h.pending).toBe(true); h.update(NaN, 100); expect(h.pending).toBe(false);
  });
  it('blocked (the hand drags something) never starts a grab; the hold starts again once unblocked; a grab already running is not ended by it', () => {
    const g = createGrabHysteresis(); let t = 0;
    for (let i = 0; i < 20; i++, t += 14) expect(g.update(0.2, t, true)).toBe(null);
    expect(g.pending).toBe(false); let ev = null; for (let i = 0; i < 12 && !ev; i++, t += 14) ev = g.update(0.2, t, false); expect(ev).toBe('start');
    expect(g.update(0.2, t, true)).toBe(null); expect(g.active).toBe(true);
  });
  it('release() (tracking lost / refused / ended from outside) latches: no new grab until the hand has opened once', () => {
    const g = createGrabHysteresis(); let t = 0; for (let i = 0; i < 12; i++, t += 14) g.update(0.2, t); expect(g.active).toBe(true);
    g.release(); expect(g.active).toBe(false);
    for (let i = 0; i < 30; i++, t += 14) expect(g.update(0.2, t)).toBe(null); // still a fist: nothing
    expect(g.update(0.5, t)).toBe(null); t += 14; expect(g.update(0.8, t)).toBe(null); // open (above off): unlatched
    let ev = null; for (let i = 0; i < 12 && !ev; i++, t += 14) ev = g.update(0.2, t); expect(ev).toBe('start');
    g.release(); g.reset(); let e2 = null; for (let i = 0; i < 12 && !e2; i++, t += 14) e2 = g.update(0.2, t); expect(e2).toBe('start'); // reset() clears the latch
  });
  it('custom thresholds (localStorage vrl-hand-grab)', () => {
    const g = createGrabHysteresis({ on: 0.4, off: 0.5, holdMs: 30 }); let ev = null;
    for (let i = 0, t = 0; i < 4 && !ev; i++, t += 14) ev = g.update(0.45, t); expect(ev).toBe(null);
    for (let i = 0, t = 100; i < 4 && !ev; i++, t += 14) ev = g.update(0.3, t); expect(ev).toBe('start');
    expect(g.update(0.55, 300)).toBe('end');
  });
});
describe('the fist anchor and two-fist scaling', () => {
  it('the palm centre lies between the wrist and the middle-finger knuckle', () => {
    const p = palmPoint([0, 0, 0], [0, 0, -0.1]); expect(p[2]).toBeCloseTo(-0.1 * PALM_FROM_WRIST, 9); expect(PALM_FROM_WRIST).toBeGreaterThan(0); expect(PALM_FROM_WRIST).toBeLessThan(1);
    const out = [9, 9, 9]; expect(palmPoint([1, 2, 3], [1, 2, 3], out)).toBe(out); expect(out).toEqual([1, 2, 3]);
  });
  it('two fists: the volume scale follows the distance between the fists (the controllers\' pinchScale, unchanged)', () => {
    expect(pinchScale(1, 0.2, 0.4, 0)).toBeCloseTo(2, 6); expect(pinchScale(1, 0.2, 0.1, 0)).toBeCloseTo(0.5, 6); expect(pinchScale(0.7, 0.3, 0.3, 0)).toBeCloseTo(0.7, 6);
  });
});

describe('hand fixes: grab keeps alive by the wrist, fist guard, wrist scroll stop', () => {
  it('handAlive: the ray decides, a grab is also kept alive by a tracked wrist', () => {
    expect(handAlive(true, false, false)).toBe(true);
    expect(handAlive(false, true, false)).toBe(false); // not grabbing: the ray alone (as before)
    expect(handAlive(false, true, true)).toBe(true); // palm turned to the face, the wrist is still tracked
    expect(handAlive(false, false, true)).toBe(false); // really lost
  });
  it('a grab with a lost ray but a tracked wrist never cancels; a lost wrist cancels after 200 ms', () => {
    const l = createTrackingLoss(); let t = 0;
    expect(l.update(handAlive(true, true, true), t)).toBe('ok');
    for (let i = 0; i < 40; i++) { t += FRAME; expect(l.update(handAlive(false, true, true), t)).toBe('ok'); }
    const out = []; for (let i = 0; i < 40; i++) { t += FRAME; out.push(l.update(handAlive(false, false, true), t)); }
    expect(out).toContain('cancel');
  });
  it('fistForming: the index AND middle / ring / little curled = a forming fist; open or unknown fingers do not', () => {
    expect(FIST_GUARD).toEqual({ index: 0.6, others: 0.5 });
    expect(fistForming([0.5, 0.4, 0.4, 0.45])).toBe(true);
    expect(fistForming([0.9, 0.4, 0.4, 0.45])).toBe(false); // index reaching out to the thumb: a pinch with the other fingers tucked
    expect(fistForming([0.5, 0.9, 0.4, 0.4])).toBe(false); // an aiming pinch: middle open
    expect(fistForming([0.5, 0.4, 0.75, 0.4])).toBe(false);
    expect(fistForming([0.5, 0.4, NaN, 0.4])).toBe(false); expect(fistForming([NaN, 0.4, 0.4, 0.4])).toBe(false);
    expect(fistForming(null)).toBe(false);
    expect(fistForming([0.9, 0.4, 0.4, 0.45], { index: 1, others: 0.5 })).toBe(true); // tunable (guardIndex 1: the old rule)
  });
  it('wristScrollKeep: only on the same button and not in a fist', () => {
    expect(wristScrollKeep('secUp', 'secUp', false)).toBe(true);
    expect(wristScrollKeep('secUp', 'secDown', false)).toBe(false);
    expect(wristScrollKeep('secUp', null, false)).toBe(false); // the ray left the menu
    expect(wristScrollKeep('secUp', 'secUp', true)).toBe(false); // the hand became a fist
    expect(wristScrollKeep(undefined, undefined, false)).toBe(false);
  });
});


// ---- latency ----
// the lag of a filtered position behind a hand that moves at constant speed v (m/s), in ms, at the 72 Hz frame rate
const steadyLagMs = (opts, v) => {
  const f = createPoseFilter(opts), o = new Float64Array(7); let x = 0;
  for (let i = 0; i < 400; i++) { x = v * i * FRAME / 1000; f.filter([x, 0, 0, 0, 0, 0, 1], i * FRAME, o); }
  return (x - o[0]) / v * 1000;
};
// rms of the output for a hand at rest (8 Hz, 0.5 mm tremor + 0.5 mm noise), mm
const restJitterMm = opts => {
  const f = createPoseFilter(opts), o = new Float64Array(7); let seed = 5, s2 = 0, n = 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
  for (let i = 0; i < 720; i++) { const j = 0.0005 * Math.sin(2 * Math.PI * 8 * i * FRAME / 1000) + 0.001 * 0.5 * rnd(); f.filter([j, 0, 0, 0, 0, 0, 1], i * FRAME, o); if (i > 72) { s2 += o[0] * o[0]; n++; } }
  return Math.sqrt(s2 / n) * 1000;
};
const OLD_RAY = { minCutoff: 1, beta: 0.01, dCutoff: 1 }, OLD_PALM = { minCutoff: 3, beta: 0.05, dCutoff: 1 };
describe('filter lag', () => {
  it('the new ray filter trails at most ~half as long as the old one at every speed from a slow placing move to a fast sweep', () => {
    for (const v of [0.02, 0.05, 0.1, 0.3, 1.0]) {
      const o = steadyLagMs(OLD_RAY, v), n = steadyLagMs(ONE_EURO, v);
      expect(n, 'v=' + v).toBeLessThan(o * 0.65);
    }
    expect(steadyLagMs(ONE_EURO, 0.3)).toBeLessThan(12); expect(steadyLagMs(ONE_EURO, 0.05)).toBeLessThan(30);
  });
  it('the palm anchor (what a fist holds) trails at most ~half as long as before and under 10 ms at 5 cm/s and above', () => {
    for (const v of [0.02, 0.05, 0.1, 0.3, 1.0]) expect(steadyLagMs(PALM_FILTER, v), 'v=' + v).toBeLessThan(steadyLagMs(OLD_PALM, v) * 0.65);
    for (const v of [0.05, 0.1, 0.3, 1.0]) expect(steadyLagMs(PALM_FILTER, v)).toBeLessThan(10);
  });
  it('the start of a move: after 150 ms of 0.5 m/s from rest the new filter is within 5 mm, the old one is not (the speed estimate no longer lags ~160 ms)', () => {
    const at150 = opts => { const f = createPoseFilter(opts), o = new Float64Array(7); for (let i = 0; i < 72; i++) f.filter([0, 0, 0, 0, 0, 0, 1], i * FRAME, o); const t0 = 71 * FRAME; let lag = 0;
      for (let i = 1; i * FRAME <= 150; i++) { const x = 0.5 * i * FRAME / 1000; f.filter([x, 0, 0, 0, 0, 0, 1], t0 + i * FRAME, o); lag = (x - o[0]) * 1000; } return lag; };
    expect(at150(ONE_EURO)).toBeLessThan(5); expect(at150(OLD_RAY)).toBeGreaterThan(8);
  });
  it('jitter at rest stays suppressed: the ray under 0.3 mm rms, the held palm under 0.5 mm rms (for ~0.9 mm of tremor + noise)', () => {
    expect(restJitterMm(ONE_EURO)).toBeLessThan(0.3); expect(restJitterMm(PALM_FILTER)).toBeLessThan(0.5);
    expect(restJitterMm(ONE_EURO)).toBeLessThan(restJitterMm(PALM_FILTER)); // the ray is the calmer one
  });
});

describe('ray delay only while the fingers are close (rayDelayMs / slewDelay)', () => {
  it('0 for an open hand, the full delay with thumb and index within 3 cm, linear between; unknown distance: the full delay; delayMs 0: none', () => {
    expect(RAY_DELAY).toEqual({ maxMs: 60, farM: 0.06, nearM: 0.03 });
    expect(rayDelayMs(0.12)).toBe(0); expect(rayDelayMs(0.06)).toBe(0); expect(rayDelayMs(0.03)).toBe(60); expect(rayDelayMs(0.01)).toBe(60);
    expect(rayDelayMs(0.045)).toBeCloseTo(30, 9); expect(rayDelayMs(NaN)).toBe(60); expect(rayDelayMs(0.01, { maxMs: 0 })).toBe(0);
    expect(rayDelayMs(0.2, { nearM: 10 })).toBe(60); // delayNear 10 = the old fixed delay
  });
  it('the pinch itself (< 1.5 cm) always has the full delay, so selectstart still sees the ray from before the fingers moved', () => {
    expect(rayDelayMs(0.015)).toBe(RAY_DELAY.maxMs); expect(rayDelayMs(0.025)).toBe(RAY_DELAY.maxMs);
  });
  it('slewDelay: rises at once, falls at half real time (no jump of the ray when the fingers open)', () => {
    expect(slewDelay(0, 60, 14)).toBe(60); expect(slewDelay(60, 0, 14)).toBeCloseTo(53, 9); expect(slewDelay(2, 0, 14)).toBe(0); expect(slewDelay(60, 60, 14)).toBe(60); expect(slewDelay(30, 0, -5)).toBe(30);
    let d = 60; for (let i = 0; i < 9; i++) d = slewDelay(d, 0, 14); expect(d).toBe(0); // 120 ms to get back to the live ray
  });
});

describe('direct grab: distances and the choice', () => {
  it('boxDist: 0 inside, the distance outside (face, edge, corner); a flat board is its rectangle', () => {
    const mn = { x: -1, y: -1, z: -1 }, mx = { x: 1, y: 1, z: 1 };
    expect(boxDist({ x: 0.2, y: -0.5, z: 0.9 }, mn, mx)).toBe(0); expect(boxDist({ x: 1.3, y: 0, z: 0 }, mn, mx)).toBeCloseTo(0.3, 12);
    expect(boxDist({ x: 2, y: 2, z: 0 }, mn, mx)).toBeCloseTo(Math.SQRT2, 12); expect(boxDist({ x: 2, y: 2, z: 2 }, mn, mx)).toBeCloseTo(Math.sqrt(3), 12);
    const flat = { min: { x: -0.25, y: -0.15, z: 0 }, max: { x: 0.25, y: 0.15, z: 0 } };
    expect(boxDist({ x: 0.1, y: 0.1, z: 0.04 }, flat.min, flat.max)).toBeCloseTo(0.04, 12); expect(boxDist({ x: 0.3, y: 0, z: 0 }, flat.min, flat.max)).toBeCloseTo(0.05, 12);
  });
  it('centeredBoxDist (the volume box, +-halfExt)', () => {
    expect(centeredBoxDist({ x: 0, y: 0, z: 0 }, [1, 2, 3])).toBe(0); expect(centeredBoxDist({ x: 1, y: -2, z: 3 }, [1, 2, 3])).toBe(0);
    expect(centeredBoxDist({ x: 1.04, y: 0, z: 0 }, [1, 2, 3])).toBeCloseTo(0.04, 12); expect(centeredBoxDist({ x: 4, y: 2, z: 7 }, [1, 2, 3])).toBeCloseTo(Math.hypot(3, 0, 4), 12);
  });
  it('squareOutlineDist: the thin frame line of a section (local X = the normal), not its face', () => {
    const h = 0.12;
    expect(squareOutlineDist({ x: 0, y: h, z: 0 }, h)).toBeCloseTo(0, 12); // on the edge
    expect(squareOutlineDist({ x: 0.03, y: h, z: 0 }, h)).toBeCloseTo(0.03, 12); // off the plane by 3 cm at the edge
    expect(squareOutlineDist({ x: 0, y: 0, z: 0 }, h)).toBeCloseTo(h, 12); // the middle of the face is h from the outline: the volume there stays the volume's
    expect(squareOutlineDist({ x: 0, y: h - 0.02, z: 0.01 }, h)).toBeCloseTo(0.02, 12); // 2 cm inside the edge
    expect(squareOutlineDist({ x: 0, y: h + 0.03, z: 0 }, h)).toBeCloseTo(0.03, 12); expect(squareOutlineDist({ x: 0.04, y: h + 0.03, z: -h - 0.04 }, h)).toBeCloseTo(Math.hypot(0.04, 0.03, 0.04), 12);
  });
  const C = (kind, d) => ({ kind, d, ref: null });
  it('nothing within near: null (the laser decides); NaN / Infinity are not candidates; the reach is tunable', () => {
    expect(pickNearGrab([C('menu', 0.2), C('section', Infinity), C('volume', NaN)], 0.05)).toBe(null);
    expect(pickNearGrab([], 0.05)).toBe(null);
    const v = C('volume', 0.07); expect(pickNearGrab([v], 0.05)).toBe(null); expect(pickNearGrab([v], 0.08)).toBe(v);
    expect(pickNearGrab([C('volume', 0.05)], 0.05)).not.toBe(null); // at the margin: in
  });
  it('boards first (nearest, listed order on a tie), then a section, then the volume', () => {
    const vol = C('volume', 0), sec = C('section', 0.04), menu = C('menu', 0.03), help = C('help', 0.01), hist = C('hist', 0.01), hu = C('hu', 0.04);
    expect(pickNearGrab([vol, sec, menu, help, hist, hu])).toBe(help); // a tie of help and hist: the listed order
    expect(pickNearGrab([vol, sec, menu, hist, help, hu])).toBe(help);
    expect(pickNearGrab([vol, sec, menu, hu])).toBe(menu); // nearest board
    expect(pickNearGrab([vol, sec])).toBe(sec); // a palm inside the box (0) still takes a section frame 4 cm away: sections rank above the volume
    expect(pickNearGrab([vol, C('section', 0.2)])).toBe(vol); // a far section frame: the volume
    expect(pickNearGrab([C('section', 0.04), C('section', 0.02)])).not.toBe(null);
  });
  it('NEAR_KINDS lists the priority order of the boards (the same as the laser grab) and ends with the section and the volume', () => {
    expect(NEAR_KINDS).toEqual(['menu', 'help', 'hist', 'hu', 'section', 'volume']);
  });
  it('two fists on the volume: both hands pick the volume (the scale then follows their distance, as before)', () => {
    const a = pickNearGrab([C('volume', 0)]), b = pickNearGrab([C('volume', 0.03)]);
    expect(a.kind).toBe('volume'); expect(b.kind).toBe('volume');
    expect(pinchScale(1, 0.2, 0.3, 0)).toBeCloseTo(1.5, 6);
  });
});

describe('tunables from localStorage (parse only what is valid)', () => {
  it('vrl-hand-pinch / vrl-hand-drag', () => {
    expect(parsePinchTune('{"on":0.02,"off":0.035,"onFrames":1,"offFrames":3,"own":0,"os":1,"osGapMs":50,"guardIndex":0.55,"guardOthers":0.45}')).toEqual({ on: 0.02, off: 0.035, onFrames: 1, offFrames: 3, own: 0, os: 1, osGapMs: 50, guardIndex: 0.55, guardOthers: 0.45 });
    expect(parsePinchTune('{"on":0,"offFrames":0,"own":2}')).toEqual({}); expect(parsePinchTune(null)).toEqual({});
    expect(parseDragTune('{"carry":0,"gain":1.5,"rot":0.5,"blendMs":0}')).toEqual({ carry: 0, gain: 1.5, rot: 0.5, blendMs: 0 });
    expect(parseDragTune('{"rot":2,"gain":-1}')).toEqual({}); expect(parseDragTune('x')).toEqual({});
    expect(DRAG_CARRY).toEqual({ carry: 1, gain: 1, rot: 1, blendMs: 120 });
  });
  it('vrl-hand-filter', () => {
    expect(parseFilterTune(null)).toEqual({}); expect(parseFilterTune('not json')).toEqual({}); expect(parseFilterTune('[1]')).toEqual({}); expect(parseFilterTune('{"beta":"x","dCutoff":null}')).toEqual({});
    expect(parseFilterTune('{"minCutoff":2,"beta":0.1,"dCutoff":8,"aMinCutoff":6,"aBeta":0.2,"aDCutoff":9,"delayMs":0,"delayFar":0.08,"delayNear":0.02}')).toEqual({ minCutoff: 2, beta: 0.1, dCutoff: 8, aMinCutoff: 6, aBeta: 0.2, aDCutoff: 9, delayMs: 0, delayFar: 0.08, delayNear: 0.02 });
    expect(parseFilterTune('{"minCutoff":0,"beta":-1,"delayMs":1e9}')).toEqual({}); // out of range: ignored (minCutoff 0 would freeze the ray)
  });
  it('vrl-hand-grab (the old keys keep working; near is new)', () => {
    expect(parseGrabTune('{"on":0.5,"off":0.65,"holdMs":30,"near":0.08}')).toEqual({ on: 0.5, off: 0.65, holdMs: 30, near: 0.08 });
    expect(parseGrabTune('{"on":0.55,"off":0.7,"holdMs":100}')).toEqual({ on: 0.55, off: 0.7, holdMs: 100 });
    expect(parseGrabTune(null)).toEqual({}); expect(parseGrabTune('{"near":5}')).toEqual({});
  });
});

// ---- the pinch drag carried by the hand (createDragCarry) ----
const qAxis = (ax, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h), l = Math.hypot(...ax); return [ax[0] / l * s, ax[1] / l * s, ax[2] / l * s, Math.cos(h)]; };
const qRotV = (q, v) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]; };
const qM = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qAng = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180 / Math.PI;
const pose = (p, q) => Float64Array.from([...p, ...q]);
describe('createDragCarry: the press ray carried by the palm anchor', () => {
  const ray0 = pose([0.1, 1.2, -0.3], qAxis([0, 1, 0], 20)), palm0 = pose([0.12, 1.15, -0.25], qAxis([1, 0.2, 0], 35));
  it('at the press the output is the press ray itself (no jump); a hand at rest keeps it', () => {
    const c = createDragCarry(), o = new Float64Array(7); c.start(ray0, palm0); c.step(palm0, o);
    for (let i = 0; i < 7; i++) expect(o[i]).toBeCloseTo(ray0[i], 12);
    expect(c.active).toBe(true); c.stop(); expect(c.active).toBe(false);
  });
  it('the hand moves 3 cm: the ray moves 3 cm (1:1), its direction unchanged; gain 2: 6 cm', () => {
    const c = createDragCarry(), o = new Float64Array(7); c.start(ray0, palm0);
    const moved = pose([palm0[0] + 0.03, palm0[1], palm0[2]], palm0.slice(3)); c.step(moved, o);
    expect(o[0] - ray0[0]).toBeCloseTo(0.03, 12); expect(o[1]).toBeCloseTo(ray0[1], 12); expect(qAng([...o.slice(3)], [...ray0.slice(3)])).toBeLessThan(1e-6);
    c.step(moved, o, { gain: 2 }); expect(o[0] - ray0[0]).toBeCloseTo(0.06, 12);
  });
  it('the wrist turns 30 deg (a fan stroke): the ray turns 30 deg about the palm, like a controller; rot 0 keeps the direction, rot 0.5 half', () => {
    const c = createDragCarry(), o = new Float64Array(7); c.start(ray0, palm0);
    const d = qAxis([1, 0, 0], 30), turned = pose(palm0.slice(0, 3), qM(d, [...palm0.slice(3)])); c.step(turned, o);
    expect(qAng([...o.slice(3)], qM(d, [...ray0.slice(3)]))).toBeLessThan(1e-6);
    const off = qRotV(d, [ray0[0] - palm0[0], ray0[1] - palm0[1], ray0[2] - palm0[2]]);
    for (let i = 0; i < 3; i++) expect(o[i]).toBeCloseTo(palm0[i] + off[i], 12);
    c.step(turned, o, { rot: 0 }); for (let i = 0; i < 7; i++) expect(o[i]).toBeCloseTo(ray0[i], 12);
    c.step(turned, o, { rot: 0.5 }); expect(qAng([...o.slice(3)], [...ray0.slice(3)])).toBeCloseTo(15, 6);
  });
  it('a section frame held by the pinch (sectionFollowStep on the carried pose) moves 3 cm and turns 30 deg with the hand', () => {
    const c = createDragCarry(), o = new Float64Array(7); c.start(ray0, palm0);
    const c0 = { x: 0.1, y: 1.25, z: -0.8 }, Qp0 = { x: 0, y: 0, z: 0, w: 1 }, P = a => ({ x: a[0], y: a[1], z: a[2] }), Q = a => ({ x: a[3], y: a[4], z: a[5], w: a[6] });
    const f = sectionFollowStart({ p0: P(ray0), q0: Q(ray0), c0, Qp0 });
    const d = qAxis([0, 1, 0], 30), hand = pose([palm0[0], palm0[1] + 0.03, palm0[2]], qM(d, [...palm0.slice(3)])); c.step(hand, o);
    const r = sectionFollowStep({ rel: f.rel, Qrel: f.Qrel, p: P(o), q: Q(o) });
    const exp = qRotV(d, [c0.x - palm0[0], c0.y - palm0[1], c0.z - palm0[2]]);
    expect(r.c.x).toBeCloseTo(palm0[0] + exp[0], 9); expect(r.c.y).toBeCloseTo(palm0[1] + 0.03 + exp[1], 9); expect(r.c.z).toBeCloseTo(palm0[2] + exp[2], 9);
    expect(qAng([r.Qp.x, r.Qp.y, r.Qp.z, r.Qp.w], d)).toBeLessThan(1e-6);
    c.step(hand, o, { rot: 0 }); const r0 = sectionFollowStep({ rel: f.rel, Qrel: f.Qrel, p: P(o), q: Q(o) });
    expect(r0.c.y - c0.y).toBeCloseTo(0.03, 9); expect(r0.c.x).toBeCloseTo(c0.x, 9); expect(qAng([r0.Qp.x, r0.Qp.y, r0.Qp.z, r0.Qp.w], [0, 0, 0, 1])).toBeLessThan(1e-6);
  });
  it('rebase (the palm was lost and is back): the output stays where it was and follows on from there', () => {
    const c = createDragCarry(), o = new Float64Array(7), o2 = new Float64Array(7); c.start(ray0, palm0);
    c.step(pose([palm0[0] + 0.02, palm0[1], palm0[2]], palm0.slice(3)), o);
    const back = pose([palm0[0] + 0.1, palm0[1], palm0[2]], qM(qAxis([0, 0, 1], 40), [...palm0.slice(3)])); c.rebase(o, back); c.step(back, o2);
    for (let i = 0; i < 7; i++) expect(o2[i]).toBeCloseTo(o[i], 12);
    c.step(pose([back[0] + 0.01, back[1], back[2]], back.slice(3)), o2); expect(o2[0] - o[0]).toBeCloseTo(0.01, 12);
  });
  it('blendPose: a at 0, b at 1, a unit quaternion between (q and -q are the same turn)', () => {
    const a = pose([0, 0, 0], qAxis([0, 1, 0], 0)), b = pose([1, 2, 3], qAxis([0, 1, 0], 60)).map((v, i) => i > 2 ? -v : v), o = new Float64Array(7);
    blendPose(a, b, 0, o); expect([...o]).toEqual([...a]);
    blendPose(a, b, 1, o); expect(qAng([...o.slice(3)], qAxis([0, 1, 0], 60))).toBeLessThan(1e-6); expect(o[2]).toBe(3);
    blendPose(a, b, 0.5, o); expect(Math.hypot(...o.slice(3))).toBeCloseTo(1, 12); expect(qAng([...o.slice(3)], qAxis([0, 1, 0], 30))).toBeLessThan(1e-6); expect(o[1]).toBe(1);
  });
});

// ---- what the hand path adds, measured on synthetic motion (72 Hz) ----
// the old pinch drag: the system ray 60 ms in the past (thumb and index are close for the whole pinch) through the ray One Euro; the new one: the palm
// anchor (PALM_FILTER) carrying the press ray. Quest's own hand tracking / pointer latency is not in these numbers (it is the same for both).
const oldPinchRayLagMs = v => {
  const h = createPoseHistory(), f = createPoseFilter(ONE_EURO), del = new Float64Array(7), o = new Float64Array(7); let x = 0, delay = 0, last = 0;
  for (let i = 0; i < 400; i++) { const t = i * FRAME; x = v * t / 1000; delay = slewDelay(delay, rayDelayMs(0.01), t - last); last = t; h.push(t, [x, 0, 0, 0, 0, 0, 1]); const ts = h.at(t - delay, del); f.filter(del, ts, o); }
  return (x - o[0]) / v * 1000;
};
const carriedLagMs = v => {
  const f = createPoseFilter(PALM_FILTER), a = new Float64Array(7), c = createDragCarry(), o = new Float64Array(7); let x = 0;
  for (let i = 0; i < 400; i++) { const t = i * FRAME; x = v * t / 1000; f.filter([x, 0, 0, 0, 0, 0, 1], t, a); if (i === 0) c.start(pose([0, 0, -0.1], [0, 0, 0, 1]), a); c.step(a, o); }
  return (x - o[0]) / v * 1000;
};
describe('latency of a pinch drag', () => {
  it('before: ~84 ms at 10 cm/s (the 60 ms delay = 5 frames = 69 ms at 72 Hz for the whole pinch + 14 ms ray filter); after: ~6 ms (palm filter only)', () => {
    const before = [0.05, 0.1, 0.3].map(oldPinchRayLagMs), after = [0.05, 0.1, 0.3].map(carriedLagMs);
    expect(before[1]).toBeGreaterThan(80); expect(before[1]).toBeLessThan(88); // 69 + 14 (5 cm/s: ~91, 30 cm/s: ~76)
    expect(before[0]).toBeGreaterThan(86); expect(before[2]).toBeGreaterThan(72);
    expect(after[0]).toBeLessThan(10); expect(after[1]).toBeLessThan(7); expect(after[2]).toBeLessThan(3);
  });
  it('the drag no longer waits for the delayed ray to pass the pinch (60 ms) before it can start: the carried press has its reference at the press', () => {
    expect(RAY_DELAY.maxMs).toBe(60); // the old wait (vr-hand-view.js tick: now - pr.t0 >= delayTune.maxMs), skipped while the press is carried
  });
});

// a fan stroke: the wrist flexes +-30 deg at 1.5 Hz with the forearm still. The system's pinch ray is aimed from the shoulder through the pinch point
// (a model of Quest's hand pointer, without its own smoothing): it hardly turns. The carried ray turns with the wrist.
describe('fan stroke', () => {
  const W = [0, 0, -0.45], amp = 30, hz = 1.5, n = 300;
  const wristQ = t => qAxis([1, 0, 0], amp * Math.sin(2 * Math.PI * hz * t / 1000));
  const pitch = q => { const d = qRotV(q, [0, 0, -1]); return Math.atan2(d[1], -d[2]) * 180 / Math.PI; };
  // amplitude (deg) and lag (ms, from the input's zero crossings) of a pitch series sampled at FRAME
  const ampLag = (series, from = 120) => {
    let a = 0; const lags = [];
    for (let i = from; i < series.length; i++) { a = Math.max(a, Math.abs(series[i])); if (series[i - 1] < 0 && series[i] >= 0) { const t = (i - 1 + (-series[i - 1]) / (series[i] - series[i - 1])) * FRAME; const per = 1000 / hz; lags.push(((t % per) + per) % per); } }
    return { amp: a, lag: lags.reduce((s, v) => s + v, 0) / lags.length };
  };
  it('the system ray turns ~7 deg (23 %) and ~120 ms late; the carried ray turns the full 30 deg, < 1 ms late', () => {
    const h = createPoseHistory(), fr = createPoseFilter(ONE_EURO), fa = createPoseFilter(PALM_FILTER), c = createDragCarry();
    const del = new Float64Array(7), ro = new Float64Array(7), a = new Float64Array(7), co = new Float64Array(7), sys = [], car = [];
    let delay = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const t = i * FRAME, q = wristQ(t), pin = qRotV(q, [0, -0.02, -0.09]).map((v, k) => v + W[k]), palm = qRotV(q, [0, 0, -0.045]).map((v, k) => v + W[k]);
      const ph = Math.atan2(pin[1], -pin[2]) / 2, rq = [Math.sin(ph), 0, 0, Math.cos(ph)]; // shoulder (origin) -> pinch point
      delay = slewDelay(delay, rayDelayMs(0.01), t - last); last = t; h.push(t, [...pin, ...rq]); const ts = h.at(t - delay, del); fr.filter(del, ts, ro); sys.push(pitch([...ro.slice(3)]));
      fa.filter([...palm, ...q], t, a); if (i === 0) c.start(pose(pin, [0, 0, 0, 1]), a); c.step(a, co); car.push(pitch([...co.slice(3)]));
    }
    const s = ampLag(sys), k = ampLag(car);
    expect(s.amp).toBeLessThan(8); expect(s.amp / amp).toBeLessThan(0.25); expect(s.lag).toBeGreaterThan(100);
    expect(k.amp).toBeGreaterThan(29); expect(k.lag).toBeLessThan(3);
  });
});

// the fist guard against pinch postures (planar fingers, adult bone lengths): a pinch with the other fingers tucked is no fist
describe('fist guard vs. real pinch postures', () => {
  const bones = { index: [0.068, 0.039, 0.022, 0.018], middle: [0.065, 0.044, 0.026, 0.019], ring: [0.058, 0.041, 0.025, 0.019], pinky: [0.054, 0.032, 0.018, 0.017] };
  const fingerAt = (L, deg) => { const pts = [P(0)]; let ang = 0, x = 0, y = 0; for (let i = 0; i < 4; i++) { if (i) ang += deg[i - 1] * Math.PI / 180; x += L[i] * Math.cos(ang); y += L[i] * Math.sin(ang); pts.push(P(x, y)); } return pts; };
  const hand = (idx, rest) => [fingerCurl(fingerAt(bones.index, idx)), ...['middle', 'ring', 'pinky'].map(f => fingerCurl(fingerAt(bones[f], rest)))];
  const tipPinchIndex = [40, 50, 20]; // the index reaching the thumb tip
  it('tucked fingers during a pinch read ~0.57 (below the old 0.6 guard): the new guard lets the pinch through', () => {
    const tucked = hand(tipPinchIndex, [50, 70, 35]), moreTucked = hand(tipPinchIndex, [60, 85, 45]), relaxed = hand(tipPinchIndex, [35, 50, 25]);
    expect(tucked[1]).toBeGreaterThan(0.55); expect(tucked[1]).toBeLessThan(0.6); expect(tucked[0]).toBeGreaterThan(0.7);
    const oldGuard = cs => [1, 2, 3].every(i => cs[i] < 0.6);
    expect(oldGuard(tucked)).toBe(true); expect(oldGuard(moreTucked)).toBe(true); // refused these pinches
    for (const cs of [relaxed, tucked, moreTucked]) expect(fistForming(cs)).toBe(false);
    expect(grabScore(tucked)).toBeGreaterThan(GRAB.off); // and they are no grab either
  });
  it('a hand closing into a fist (all four curled together) is still caught before the grab starts', () => {
    for (const deg of [[60, 85, 45], [70, 90, 50], [85, 100, 60]]) { const cs = hand(deg, deg); expect(fistForming(cs)).toBe(true); }
    expect(fistForming(hand([35, 50, 25], [35, 50, 25]))).toBe(false); // a relaxed open hand
  });
});

// ---- the standard far-field ray (shoulder -> index knuckle), One Euro per axis, pinch lock, dropout hold ----
const rotQ = (q, v) => qRotV(q, v);
const angDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const axisY = [0, 1, 0], axisX = [1, 0, 0], axisZ = [0, 0, 1];
const axisFilter = () => createOneEuro(3, { ...HAND_RAY_FILTER, perAxis: true });
const ok = v => v.every(Number.isFinite);

describe('the One Euro filter per axis (shoulder and aim point), tuned for latency', () => {
  it('parameters: min cutoff 1 Hz, beta 1 per cm/s, derivative cutoff 1 Hz (the published recipe, speed in cm/s)', () => {
    expect(HAND_RAY_FILTER).toEqual({ minCutoff: 1, beta: 1, dCutoff: 1, speedScale: 100 });
  });
  it('perAxis: a fast move on x does not open the cutoff of y: y keeps smoothing its noise, where the pooled filter lets it through', () => {
    const run = perAxis => {
      const f = createOneEuro(2, { ...HAND_RAY_FILTER, perAxis }), o = new Float64Array(2); let seed = 3, s2 = 0, n = 0;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
      for (let i = 0; i < 400; i++) { f.filter([0.5 * i * FRAME / 1000, 0.002 * rnd()], i * FRAME, o); if (i > 60) { s2 += o[1] * o[1]; n++; } }
      return Math.sqrt(s2 / n);
    };
    expect(run(true)).toBeLessThan(run(false) * 0.5);
  });
  it('latency: the filtered point trails a hand at constant speed by under 10 / 5 / 2 ms at 10 / 30 / 100 cm/s (the rest: smoothing only)', () => {
    const lag = v => { const f = axisFilter(), o = new Float64Array(3); let x = 0; for (let i = 0; i < 400; i++) { x = v * i * FRAME / 1000; f.filter([x, 0, 0], i * FRAME, o); } return (x - o[0]) / v * 1000; };
    expect(lag(0.1)).toBeLessThan(10); expect(lag(0.3)).toBeLessThan(5); expect(lag(1)).toBeLessThan(2);
    expect(lag(0.02)).toBeLessThan(30); // a slow nudge is smoothed, not frozen
  });
  it('at rest 1.5 mm of tracking noise comes out under half', () => {
    const f = axisFilter(), o = new Float64Array(3); let seed = 5, s2 = 0, s0 = 0, n = 0;
    const g = () => { let u = 0; for (let k = 0; k < 12; k++) u += (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; return u - 6; };
    for (let i = 0; i < 1000; i++) { const v = [0.0015 * g(), 0.0015 * g(), 0.0015 * g()]; f.filter(v, i * FRAME, o); if (i > 100) { s2 += o[0] * o[0]; s0 += v[0] * v[0]; n++; } }
    expect(Math.sqrt(s2 / n)).toBeLessThan(Math.sqrt(s0 / n) * 0.5);
  });
  it('a non-finite sample (a lost joint) is never fed to the filter: the previous output comes back and the state stays clean', () => {
    const f = axisFilter(), o = new Float64Array(3);
    f.filter([1, 2, 3], 0, o); f.filter([1, 2, 3], FRAME, o);
    f.filter([NaN, 2, 3], 2 * FRAME, o); expect([...o]).toEqual([1, 2, 3]);
    f.filter([1, Infinity, 3], 3 * FRAME, o); expect([...o]).toEqual([1, 2, 3]);
    f.filter([1, 2, 3], NaN, o); expect([...o]).toEqual([1, 2, 3]);
    f.filter([1.5, 2, 3], 4 * FRAME, o); expect(ok([...o])).toBe(true); expect(o[0]).toBeGreaterThan(1);
    const g = axisFilter(), p = new Float64Array([7, 7, 7]); g.filter([NaN, 0, 0], 0, p); expect([...p]).toEqual([7, 7, 7]); // unprimed: out untouched
  });
});

describe('the shoulder from the head, the yaw only', () => {
  const fwdOf = q => { const o = [9, 9]; return headForward(q, o) ? o : null; };
  it('headForward: the head looks along -Z -> [0,-1]; turned 90 deg left (about +Y) -> -X', () => {
    const a = fwdOf([0, 0, 0, 1]); expect(a[0]).toBeCloseTo(0, 9); expect(a[1]).toBeCloseTo(-1, 9);
    const b = fwdOf(qAxis(axisY, 90)); expect(b[0]).toBeCloseTo(-1, 9); expect(b[1]).toBeCloseTo(0, 9);
  });
  it('pitch and roll do not change it: nodding 60 deg down / 45 up and tilting 30 deg give the yaw alone, even looking almost straight down', () => {
    for (const yaw of [0, 35, -120, 170]) {
      const base = fwdOf(qAxis(axisY, yaw));
      for (const [pitch, roll] of [[-60, 0], [45, 0], [-30, 30], [-40, -35], [-85, 0], [-89.9, 0], [80, 0]]) {
        const q = qMul(qMul(qAxis(axisY, yaw), qAxis(axisX, pitch)), qAxis(axisZ, roll)), f = fwdOf(q);
        expect(f, `yaw ${yaw} pitch ${pitch} roll ${roll}`).not.toBeNull();
        expect(Math.hypot(f[0] - base[0], f[1] - base[1]), `yaw ${yaw} pitch ${pitch} roll ${roll}`).toBeLessThan(0.02);
      }
    }
  });
  it('a bad orientation (NaN, zero, missing) is refused and leaves out as it was', () => {
    for (const q of [[NaN, 0, 0, 1], [0, 0, 0, 0], null, undefined, [0, 0, Infinity, 1]]) { const o = [4, 5]; expect(headForward(q, o)).toBe(false); expect(o).toEqual([4, 5]); }
  });
  it('shoulderPoint: 0.18 m below the head and 0.17 m toward the hand side (right: +right, left: -right); turning the head turns the offset', () => {
    const o = [0, 0, 0];
    shoulderPoint([1, 1.6, 2], [0, -1], 1, o); expect(o[0]).toBeCloseTo(1.17, 9); expect(o[1]).toBeCloseTo(1.42, 9); expect(o[2]).toBeCloseTo(2, 9);
    shoulderPoint([1, 1.6, 2], [0, -1], -1, o); expect(o[0]).toBeCloseTo(0.83, 9);
    shoulderPoint([1, 1.6, 2], [-1, 0], 1, o); expect(o[0]).toBeCloseTo(1, 9); expect(o[2]).toBeCloseTo(1.83, 9); // facing -X: the right hand side is -Z
    expect(HAND_RAY.neckDown).toBeGreaterThanOrEqual(0.15); expect(HAND_RAY.neckDown).toBeLessThanOrEqual(0.2); expect(HAND_RAY.shoulderSide).toBeGreaterThanOrEqual(0.15); expect(HAND_RAY.shoulderSide).toBeLessThanOrEqual(0.2);
  });
});

describe('the aim point, the direction and the pose', () => {
  it('aimPoint: the index knuckle 2 cm on along the metacarpal (-Z of its frame); without a (finite) frame: the knuckle itself', () => {
    const o = [0, 0, 0];
    aimPoint([1, 2, 3], [0, 0, 0, 1], o); expect(o[0]).toBeCloseTo(1, 9); expect(o[2]).toBeCloseTo(2.98, 9);
    aimPoint([1, 2, 3], qAxis(axisY, 90), o); expect(o[0]).toBeCloseTo(0.98, 9); expect(o[2]).toBeCloseTo(3, 9); // -Z turned to -X
    aimPoint([1, 2, 3], null, o); expect(o).toEqual([1, 2, 3]); aimPoint([1, 2, 3], [NaN, 0, 0, 1], o); expect(o).toEqual([1, 2, 3]);
  });
  it('rayDirection: the unit vector shoulder -> aim; zero length, too close or non-finite: false and out untouched', () => {
    const o = [9, 9, 9]; expect(rayDirection([0, 0, 0], [0, 0, -2], o)).toBe(true); expect(o).toEqual([0, 0, -1]);
    expect(rayDirection([1, 1, 1], [1.3, 1.4, 1], o)).toBe(true); expect(Math.hypot(...o)).toBeCloseTo(1, 12);
    const p = [9, 9, 9];
    for (const [a, b] of [[[1, 1, 1], [1, 1, 1]], [[0, 0, 0], [0, 0.01, 0]], [[0, 0, 0], [NaN, 0, 1]], [[0, 0, 0], [Infinity, 0, 1]]]) { expect(rayDirection(a, b, p)).toBe(false); expect(p).toEqual([9, 9, 9]); }
  });
  it('dirQuat: -Z of the pose is the direction, no roll (the pose X stays horizontal); (almost) vertical keeps the last yaw', () => {
    let yaw = 0, seed = 1; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 200; i++) {
      const d = norm([r(), r() * 0.6, r()]), q = [0, 0, 0, 0]; yaw = dirQuat(d, yaw, q, 0);
      expect(angDeg(rotQ(q, [0, 0, -1]), d)).toBeLessThan(1e-4); expect(Math.abs(rotQ(q, [1, 0, 0])[1])).toBeLessThan(1e-9); expect(Math.hypot(...q)).toBeCloseTo(1, 12);
    }
    const q = [0, 0, 0, 0], y0 = dirQuat(norm([1, 0, 1]), 0, q, 0), y1 = dirQuat([0.001, 0.99999, 0.002], y0, q, 0);
    expect(y1).toBe(y0); expect(ok(q)).toBe(true); expect(angDeg(rotQ(q, [0, 0, -1]), [0, 1, 0])).toBeLessThan(0.5);
  });
  it('turnDir: within the limit the target itself; beyond it exactly maxRad toward it, unit; opposite or a zero limit never gives NaN', () => {
    const a = [0, 0, -1], b = norm([1, 0, -1]), o = [0, 0, 0];
    expect(turnDir(a, b, 1, o) * 180 / Math.PI).toBeCloseTo(45, 9); expect(o).toEqual(b);
    turnDir(a, b, 10 * Math.PI / 180, o); expect(angDeg(o, a)).toBeCloseTo(10, 6); expect(angDeg(o, b)).toBeCloseTo(35, 6); expect(Math.hypot(...o)).toBeCloseTo(1, 12);
    turnDir(a, b, 0, o); expect(o).toEqual(a);
    turnDir(a, [0, 0, 1], 0.1, o); expect(ok(o)).toBe(true); expect(Math.hypot(...o)).toBeCloseTo(1, 9);
    const s = [0, 0, -1]; turnDir(s, b, 10 * Math.PI / 180, s); expect(angDeg(s, a)).toBeCloseTo(10, 6); // out may be an input
  });
});

describe('the pinch lock', () => {
  const R = Math.PI / 180;
  const run = (lock, gaps) => { let t = 0; return gaps.map(g => lock.update(g, t += FRAME)); };
  it('defaults: closing faster than 12 cm/s below 6 cm; 10 deg/s for 120 ms, ramped free over 120 ms; a window lasts 300 ms at most, then 600 ms without a new one', () => {
    expect(PINCH_LOCK).toEqual({ closeM: 0.06, speed: 0.12, holdDegPerS: 10, lockMs: 120, maxMs: 300, rampMs: 120, freeDegPerS: 720, coolMs: 600 });
    expect(PINCH_LOCK.lockMs).toBeGreaterThanOrEqual(100); expect(PINCH_LOCK.lockMs).toBeLessThanOrEqual(150);
  });
  it('a relaxed gap (wavering a few mm), a slow close, an open hand and a gap far away are never locked', () => {
    const l = createPinchLock();
    for (const v of run(l, Array.from({ length: 60 }, (_, i) => 0.045 + 0.0007 * Math.sin(i)))) expect(v).toBe(Infinity);
    const s = createPinchLock(); for (const v of run(s, Array.from({ length: 40 }, (_, i) => 0.05 - 0.0001 * i))) expect(v).toBe(Infinity); // 0.5 cm/s
    const o = createPinchLock(); for (const v of run(o, Array.from({ length: 30 }, (_, i) => 0.01 + 0.004 * i))) expect(v).toBe(Infinity); // opening
    const far = createPinchLock(); for (const v of run(far, [0.2, 0.15, 0.1, 0.07, 0.065])) expect(v).toBe(Infinity); // closing, but not below 6 cm yet
  });
  it('fingers closing at 25 cm/s: the direction may turn only 10 deg/s for ~120 ms after the last closing frame, then the limit ramps to free (no step)', () => {
    const l = createPinchLock(); let t = 0; const lim = [];
    for (const g of [0.06, 0.05, 0.04, 0.03, 0.02, 0.012, 0.01, 0.01]) lim.push(l.update(g, t += FRAME));
    expect(lim[1]).toBeCloseTo(10 * R * FRAME / 1000, 12); expect(l.locked).toBe(true);
    for (let i = 0; i < 4; i++) expect(lim[4 + i]).toBeLessThan(11 * R * FRAME / 1000);
    let heldMs = 0, prev = 0, ramp = [];
    for (let i = 0; i < 40; i++) { const v = l.update(0.01, t += FRAME); if (v < 11 * R * FRAME / 1000) heldMs += FRAME; else ramp.push(v); if (v === Infinity) break; }
    expect(heldMs).toBeGreaterThan(80); expect(heldMs).toBeLessThan(160);
    expect(ramp.length).toBeGreaterThan(5); for (const v of ramp) { expect(v).toBeGreaterThanOrEqual(prev); prev = v === Infinity ? prev : v; } // monotone: the limit only loosens
    expect(l.locked).toBe(false);
  });
  it('fidgeting fingers cannot pin the ray: a lock window is capped (300 ms + lockMs), then no new one for 600 ms', () => {
    const l = createPinchLock(); let t = 0; const locked = [];
    for (let i = 0; i < 120; i++) { const v = l.update(i % 2 ? 0.02 : 0.04, t += FRAME); locked.push(v < 11 * R * FRAME / 1000); }
    const first = locked.indexOf(true), lastOfFirst = locked.indexOf(false, first) - 1;
    expect((lastOfFirst - first + 1) * FRAME).toBeLessThan(300 + PINCH_LOCK.lockMs + 40); expect(lastOfFirst - first + 1).toBeGreaterThan(20);
    const freeRun = locked.slice(lastOfFirst + 1, lastOfFirst + 1 + 30); expect(freeRun.filter(Boolean).length).toBeLessThan(8); // the cooldown: mostly free (the ramp frames are not locked)
  });
  it('a missing gap (NaN) starts nothing and the rate needs two tracked samples in a row; reset() frees it', () => {
    const l = createPinchLock(); let t = 0; l.update(0.05, t += FRAME);
    expect(l.update(NaN, t += FRAME)).toBe(Infinity); expect(l.update(0.01, t += FRAME)).toBe(Infinity); // 0.05 -> NaN -> 0.01 is no measured closing
    expect(l.update(0.005, t += FRAME)).toBeLessThan(Infinity); l.reset(); expect(l.update(0.005, t += FRAME)).toBe(Infinity);
  });
});

describe('createHandRay (the whole ray of one hand)', () => {
  const HEAD = [0, 1.6, 0], KN = [0.2, 1.2, -0.4];
  const mk = () => ({ inp: { head: [...HEAD], headQ: [0, 0, 0, 1], knuckle: [...KN], metaQ: [0, 0, 0, 1], side: 1, gap: 0.06 }, sys: new Float64Array([0.1, 1.0, -0.2, 0, 0, 0, 1]), out: new Float64Array(7), hr: createHandRay() });
  const settle = (r, n = 60, t0 = 0) => { let k, t = t0; for (let i = 0; i < n; i++) k = r.hr.update(r.inp, r.sys, t += FRAME, r.out); return [k, t]; };
  const dirOfPose = o => rotQ([o[3], o[4], o[5], o[6]], [0, 0, -1]);
  const expected = (head = HEAD, kn = KN, side = 1) => { const sh = shoulderPoint(head, [0, -1], side, [0, 0, 0]), a = aimPoint(kn, [0, 0, 0, 1], [0, 0, 0]); return { a, d: norm([a[0] - sh[0], a[1] - sh[1], a[2] - sh[2]]) }; };
  it('a still hand: the pose is at the aim point and looks along shoulder -> aim point (not the knuckle -> fingertip line, not the system ray)', () => {
    const r = mk(), [k] = settle(r), e = expected();
    expect(k).toBe('joint'); expect(Math.hypot(r.out[0] - e.a[0], r.out[1] - e.a[1], r.out[2] - e.a[2])).toBeLessThan(1e-6);
    expect(angDeg(dirOfPose(r.out), e.d)).toBeLessThan(0.01);
    expect(angDeg(dirOfPose(r.out), dirOfPose(r.sys))).toBeGreaterThan(5);
  });
  it('the left hand takes the left shoulder; an unknown handedness takes the side the hand is on', () => {
    const r = mk(); r.inp.side = -1; settle(r); expect(angDeg(dirOfPose(r.out), expected(HEAD, KN, -1).d)).toBeLessThan(0.01);
    const u = mk(); u.inp.side = 0; u.inp.knuckle = [-0.2, 1.2, -0.4]; settle(u); expect(angDeg(dirOfPose(u.out), expected(HEAD, [-0.2, 1.2, -0.4], -1).d)).toBeLessThan(0.01);
  });
  it('head pitch and roll do not swing the ray (the yaw alone counts); the head turning does move the shoulder, so the ray', () => {
    const a = mk(); a.inp.headQ = qAxis(axisY, 20); settle(a);
    const b = mk(); b.inp.headQ = qMul(qMul(qAxis(axisY, 20), qAxis(axisX, -50)), qAxis(axisZ, 25)); settle(b);
    expect(angDeg(dirOfPose(a.out), dirOfPose(b.out))).toBeLessThan(0.5);
    const c = mk(); settle(c); expect(angDeg(dirOfPose(a.out), dirOfPose(c.out))).toBeGreaterThan(2);
  });
  it('turning the wrist 30 deg moves the aim point only ~1 cm: the ray turns under 2 deg (the old metacarpal ray turned 30)', () => {
    const r = mk(); settle(r); const d0 = dirOfPose(r.out); r.inp.metaQ = qAxis(axisX, 30); settle(r, 60, 5000);
    expect(angDeg(dirOfPose(r.out), d0)).toBeLessThan(2);
  });
  it('the hand moving sideways turns the ray about the shoulder: 10 cm at 0.45 m = ~13 deg, with the origin following the hand', () => {
    const r = mk(); settle(r); const d0 = dirOfPose(r.out); r.inp.knuckle = [KN[0] + 0.1, KN[1], KN[2]]; settle(r, 80, 5000);
    const a = angDeg(dirOfPose(r.out), d0); expect(a).toBeGreaterThan(8); expect(a).toBeLessThan(18); expect(r.out[0]).toBeCloseTo(KN[0] + 0.1, 3);
  });
  it('latency: a hand moving sideways at 30 cm/s is followed within 6 ms (the shoulder is still)', () => {
    const r = mk(); let t = 0, lag = 0;
    for (let i = 0; i < 200; i++) {
      const x = KN[0] + 0.3 * i * FRAME / 1000; r.inp.knuckle[0] = x; r.hr.update(r.inp, r.sys, t += FRAME, r.out);
      if (i > 150) lag = (x + 0 - (r.out[0] - 0)) / 0.3 * 1000;
    }
    expect(lag).toBeLessThan(6); expect(lag).toBeGreaterThan(0);
  });
  it('NaN guards: a NaN / missing knuckle, a knuckle on the shoulder, a NaN head: never a NaN pose, whatever the sequence', () => {
    const r = mk(); settle(r); let t = 1e4, seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 400; i++) {
      const c = Math.floor(rnd() * 8);
      r.inp.knuckle = c === 0 ? null : c === 1 ? [NaN, 1, 1] : c === 2 ? [0.17, 1.42, 0] : c === 3 ? [Infinity, 0, 0] : [KN[0] + 0.05 * rnd(), KN[1], KN[2]];
      r.inp.headQ = rnd() < 0.15 ? [NaN, 0, 0, 1] : rnd() < 0.1 ? [0, 0, 0, 0] : [0, 0, 0, 1]; r.inp.head = rnd() < 0.1 ? [NaN, 1, 1] : [...HEAD];
      r.inp.metaQ = rnd() < 0.2 ? null : [0, 0, 0, 1]; r.inp.gap = rnd() < 0.2 ? NaN : 0.05 * rnd();
      r.hr.update(r.inp, r.sys, t += FRAME, r.out); expect(ok([...r.out]), 'frame ' + i).toBe(true); expect(Math.hypot(r.out[3], r.out[4], r.out[5], r.out[6])).toBeCloseTo(1, 6);
    }
    const first = mk(); first.inp.knuckle = [NaN, 0, 0]; first.hr.update(first.inp, first.sys, 100, first.out); expect([...first.out]).toEqual([...first.sys]); // nothing good yet: the system's ray
  });
  it('a bad head orientation keeps the last yaw (the ray stays a joint ray); with no yaw ever known it is a dropout', () => {
    const r = mk(); r.inp.headQ = qAxis(axisY, 40); settle(r); const d0 = dirOfPose(r.out); r.inp.headQ = [NaN, 0, 0, 1];
    const [k] = settle(r, 20, 5000); expect(k).toBe('joint'); expect(angDeg(dirOfPose(r.out), d0)).toBeLessThan(0.01);
    const n = mk(); n.inp.headQ = [NaN, 0, 0, 1]; expect(settle(n, 3)[0]).toBe('sys');
  });
  it('dropout hold: with the joints gone the last good ray is held unchanged for holdMs (200), then the system ray is blended in over blendMs (150), no jump', () => {
    const r = mk(), [, t0] = settle(r), good = [...r.out]; r.inp.knuckle = null; let t = t0, k;
    for (let i = 0; i < 14; i++) { k = r.hr.update(r.inp, r.sys, t += FRAME, r.out); expect(k).toBe('hold'); expect([...r.out]).toEqual(good); } // 194 ms
    let max = 0, prev = [...r.out], sawSys = false;
    const gap = Math.hypot(r.sys[0] - good[0], r.sys[1] - good[1], r.sys[2] - good[2]);
    for (let i = 0; i < 30; i++) { k = r.hr.update(r.inp, r.sys, t += FRAME, r.out); if (k === 'sys') sawSys = true; max = Math.max(max, Math.hypot(r.out[0] - prev[0], r.out[1] - prev[1], r.out[2] - prev[2])); prev = [...r.out]; }
    expect(sawSys).toBe(true); expect(max).toBeLessThan(gap / (HAND_RAY.blendMs / FRAME) * 1.6); expect(Math.hypot(r.out[0] - r.sys[0], r.out[1] - r.sys[1], r.out[2] - r.sys[2])).toBeLessThan(1e-6);
  });
  it('intermittent dropouts (the joints missing on every 3rd / 5th frame for 2 s) never reach the system ray and the ray moves as the hand does, no jumps', () => {
    const r = mk(); let t = 0, kinds = new Set(), maxA = 0, d0 = null;
    for (let i = 0; i < 144; i++) {
      r.inp.knuckle = (i % 3 === 2 || i % 5 === 4) ? null : [KN[0] + 0.02 * Math.sin(i / 20), KN[1], KN[2]];
      kinds.add(r.hr.update(r.inp, r.sys, t += FRAME, r.out)); const d = dirOfPose(r.out); if (d0 && i > 5) maxA = Math.max(maxA, angDeg(d, d0)); d0 = d;
    }
    expect([...kinds].sort()).toEqual(['hold', 'joint']); expect(maxA).toBeLessThan(1);
  });
  it('the joints coming back after a hold are blended in (resumeMs 100) from the held pose; after a long loss from the system ray (blendMs 150): no step', () => {
    const r = mk(), [, t0] = settle(r), good = [...r.out]; r.inp.knuckle = null; let t = t0;
    for (let i = 0; i < 6; i++) r.hr.update(r.inp, r.sys, t += FRAME, r.out);
    r.inp.knuckle = [KN[0] + 0.08, KN[1], KN[2]];
    r.hr.update(r.inp, r.sys, t += FRAME, r.out); expect(Math.hypot(r.out[0] - good[0], r.out[1] - good[1], r.out[2] - good[2])).toBeLessThan(0.03); // it starts from the held pose
    for (let i = 0; i < 40; i++) r.hr.update(r.inp, r.sys, t += FRAME, r.out); expect(r.out[0]).toBeCloseTo(KN[0] + 0.08, 2);
    const q = mk(); [, t] = settle(q); q.inp.knuckle = null; for (let i = 0; i < 60; i++) q.hr.update(q.inp, q.sys, t += FRAME, q.out); // long loss: on the system ray
    const s0 = [...q.out]; q.inp.knuckle = [...KN]; q.hr.update(q.inp, q.sys, t += FRAME, q.out);
    expect(Math.hypot(q.out[0] - s0[0], q.out[1] - s0[1], q.out[2] - s0[2])).toBeLessThan(0.02); expect(q.hr.kind).toBe('joint');
    for (let i = 0; i < 40; i++) q.hr.update(q.inp, q.sys, t += FRAME, q.out); expect(Math.hypot(q.out[0] - expected().a[0], q.out[1] - expected().a[1], q.out[2] - expected().a[2])).toBeLessThan(1e-3);
  });
  it('pinch lock: the knuckle shifting 3 cm while the fingers close moves the ray under a third as far as without the lock; it catches up afterwards', () => {
    const go = lockOn => {
      const r = { ...mk(), hr: createHandRay(lockOn ? {} : { lock: { speed: 1e9 } }) }; let [, t] = settle(r, 60); const d0 = dirOfPose(r.out);
      const gaps = [0.05, 0.035, 0.022, 0.012, 0.01, 0.01];
      gaps.forEach((g, i) => { r.inp.gap = g; r.inp.knuckle = [KN[0] + 0.006 * (i + 1), KN[1], KN[2]]; r.hr.update(r.inp, r.sys, t += FRAME, r.out); });
      const moved = angDeg(dirOfPose(r.out), d0);
      for (let i = 0; i < 40; i++) { r.inp.gap = 0.05; r.hr.update(r.inp, r.sys, t += FRAME, r.out); }
      return [moved, angDeg(dirOfPose(r.out), expected(HEAD, [KN[0] + 0.036, KN[1], KN[2]]).d)];
    };
    const [locked, caught] = go(true), [free] = go(false);
    expect(free).toBeGreaterThan(2); expect(locked).toBeLessThan(free / 3); expect(caught).toBeLessThan(0.5);
  });
});

describe('the pure ray code allocates nothing per frame', () => {
  it('no new / array / object literals / spread / map in the per-frame functions', async () => {
    const { readFileSync } = await import('node:fs');
    const t = readFileSync(new URL('../../docs/vr-hand.js', import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    const body = from => { const a = t.indexOf(from); expect(a, from).toBeGreaterThanOrEqual(0); const o = t.indexOf('{', a + from.length - 1); let d = 0; for (let i = o; i < t.length; i++) { if (t[i] === '{') d++; else if (t[i] === '}' && --d === 0) return t.slice(o + 1, i); } };
    for (const f of ['export function headForward(', 'export function shoulderPoint(', 'export function aimPoint(', 'export function rayDirection(', 'export function dirQuat(', 'export function turnDir(', '  update(inp,sys,now,out){', ' const live=now=>{']) {
      const b = body(f); expect(b, f).not.toMatch(/\bnew\b|\.map\(|\.slice\(|\.\.\.|=\s*\[|\(\s*\[|return\s*\[|=\s*\{|return\s*\{/);
    }
    const pl = body('export function createPinchLock('); const up = body.call(null, 'update(d,now){'); expect(up).not.toMatch(/\bnew\b|\.map\(|=\s*\[|=\s*\{/); expect(pl.length).toBeGreaterThan(0);
  });
});
