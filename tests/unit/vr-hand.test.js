import { describe, it, expect } from 'vitest';
import {
  isHand, createOneEuro, euroAlpha, ONE_EURO, createPoseFilter, createPinchHysteresis, PINCH_ON_M, PINCH_OFF_M, createPoseHistory, RAY_DELAY_MS,
  createTrackingLoss, LOSS_CANCEL_MS, wristMenuMetrics, createWristMenuGate, WRIST_MENU, WRIST_ITEMS, wristSlotFromU, handTexts,
} from '../../docs/vr-hand.js';
import { DRAG_RECORD, DRAG_HAND, DRAG_RECORD_HAND, HAND_LABEL_MOVE_M, dragShouldStart } from '../../docs/vr-point.js';

// build 625: hand tracking (Quest 3), the pure module
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
  it('defaults: 1 Hz, beta 0.01', () => { expect(ONE_EURO).toEqual({ minCutoff: 1, beta: 0.01, dCutoff: 1 }); });
  it('alpha grows with the cutoff and the time step', () => {
    expect(euroAlpha(1, 0.01)).toBeLessThan(euroAlpha(5, 0.01)); expect(euroAlpha(1, 0.01)).toBeLessThan(euroAlpha(1, 0.05));
    expect(euroAlpha(1, 0.01)).toBeGreaterThan(0); expect(euroAlpha(1, 1e6)).toBeLessThanOrEqual(1);
  });
  it('a constant passes unchanged; the first sample is taken as it is', () => {
    const f = createOneEuro(2), out = [0, 0];
    for (let i = 0; i < 50; i++) f.filter([0.3, -1.2], i * FRAME, out);
    expect(out[0]).toBeCloseTo(0.3, 12); expect(out[1]).toBeCloseTo(-1.2, 12);
  });
  it('jitter at rest is smoothed (1 Hz)', () => {
    const f = createOneEuro(1, { speedScale: 1000 }); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const inp = [], outp = [];
    for (let i = 0; i < 400; i++) { const v = 0.002 * rnd(); inp.push(v); outp.push(f.filter([v], i * FRAME, [0])[0]); } // +-1 mm hand tremor
    const sd = a => { const s = a.slice(100), m = s.reduce((x, y) => x + y, 0) / s.length; return Math.sqrt(s.reduce((x, y) => x + (y - m) ** 2, 0) / s.length); };
    expect(sd(outp)).toBeLessThan(sd(inp) * 0.35);
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
  it('on below 1.5 cm, off only above 2.5 cm; a missing distance keeps the state', () => {
    expect(PINCH_ON_M).toBe(0.015); expect(PINCH_OFF_M).toBe(0.025);
    const p = createPinchHysteresis();
    expect(p.update(0.03)).toBe(false); expect(p.update(0.016)).toBe(false); expect(p.update(0.014)).toBe(true);
    expect(p.update(0.02)).toBe(true); expect(p.update(0.024)).toBe(true); expect(p.update(NaN)).toBe(true);
    expect(p.update(0.026)).toBe(false); expect(p.update(0.02)).toBe(false); expect(p.update(undefined)).toBe(false);
    p.update(0.01); p.reset(); expect(p.pinched).toBe(false);
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
  it('five buttons: ring, menu, sections, add, undo; u -> slot', () => {
    expect(WRIST_ITEMS).toEqual(['ring', 'menu', 'section', 'add', 'undo']);
    expect(wristSlotFromU(0)).toBe(0); expect(wristSlotFromU(0.19)).toBe(0); expect(wristSlotFromU(0.21)).toBe(1); expect(wristSlotFromU(0.99)).toBe(4); expect(wristSlotFromU(1)).toBe(4);
    expect(wristSlotFromU(NaN)).toBe(null);
  });
});

describe('hand texts and thresholds', () => {
  it('ja / en: the help fits the board (6 lines), grab / scale are left to the controllers, five wrist labels', () => {
    for (const ja of [true, false]) {
      const t = handTexts(ja);
      expect(t.helpBasic.length).toBeLessThanOrEqual(6); expect(t.helpSec.length).toBeLessThanOrEqual(6);
      expect(t.wrist(true)).toHaveLength(5); expect(t.wrist(false)[2][1]).not.toBe(t.wrist(true)[2][1]);
    }
    const j = handTexts(true), e = handTexts(false);
    expect(j.helpBasic.join()).toContain('ピンチ'); expect(j.helpBasic.join()).toContain('手首メニュー'); expect(j.helpBasic.join()).toContain('コントローラーで');
    expect(j.helpSec.join()).toContain('コントローラーで'); expect(e.helpBasic.join()).toContain('with the controllers');
    expect(j.wrist(true).map(x => x[0])).toEqual(['よく使う', 'メニュー', '断面', '断面を', '取り消し']);
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
