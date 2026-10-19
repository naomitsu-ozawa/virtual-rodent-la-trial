import { describe, it, expect } from 'vitest';
import {
  isHand, createOneEuro, euroAlpha, ONE_EURO, createPoseFilter, createPinchHysteresis, PINCH_ON_M, PINCH_OFF_M, createPoseHistory, RAY_DELAY_MS,
  createTrackingLoss, LOSS_CANCEL_MS, wristMenuMetrics, createWristMenuGate, WRIST_MENU, WRIST_ITEMS, wristSlotFromU, handTexts,
  fingerCurl, grabScore, createGrabHysteresis, GRAB, GRAB_JOINT_NAMES, GRAB_FINGERS, palmPoint, PALM_FROM_WRIST, WRIST_SCROLL, wristScrollGain, wristScrollSign,
  handAlive, fistForming, FIST_GUARD_CURL, wristScrollKeep,
  PALM_FILTER, RAY_DELAY, rayDelayMs, slewDelay, boxDist, centeredBoxDist, squareOutlineDist, pickNearGrab, NEAR_KINDS, parseFilterTune, parseGrabTune,
} from '../../docs/vr-hand.js';
import { pinchScale } from '../../docs/vr-real-scale.js';
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
  it('defaults (build 626): 1.2 Hz, beta 0.05, speed estimate at 5 Hz', () => { expect(ONE_EURO).toEqual({ minCutoff: 1.2, beta: 0.05, dCutoff: 5 }); });
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
  it('seven buttons: ring, menu, sections, add, undo, section -, section +; u -> slot', () => {
    expect(WRIST_ITEMS).toEqual(['ring', 'menu', 'section', 'add', 'undo', 'secDown', 'secUp']);
    expect(wristSlotFromU(0)).toBe(0); expect(wristSlotFromU(0.14)).toBe(0); expect(wristSlotFromU(0.15)).toBe(1); expect(wristSlotFromU(0.99)).toBe(6); expect(wristSlotFromU(1)).toBe(6);
    expect(wristSlotFromU(5 / 7 + 0.01)).toBe(5); expect(wristSlotFromU(NaN)).toBe(null);
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
    // build 626: the help board draws each line unwrapped: no line longer than the pre-existing longest (47 ja / 125 en before; now 39 / 98)
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
  it('defaults (build 626): on 0.55 < off 0.7, 60 ms to start, reach 5 cm', () => { expect(GRAB).toEqual({ on: 0.55, off: 0.7, holdMs: 60, near: 0.05 }); expect(GRAB.on).toBeLessThan(GRAB.off); });
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
  it('fistForming: middle / ring / little curled = a forming fist; the index does not matter; open or unknown fingers do not', () => {
    expect(FIST_GUARD_CURL).toBeGreaterThan(GRAB.on);
    expect(fistForming([0.5, 0.4, 0.4, 0.45])).toBe(true);
    expect(fistForming([0.9, 0.4, 0.4, 0.45])).toBe(true); // index still out
    expect(fistForming([0.5, 0.9, 0.4, 0.4])).toBe(false); // an aiming pinch: middle open
    expect(fistForming([0.5, 0.4, 0.75, 0.4])).toBe(false);
    expect(fistForming([0.5, 0.4, NaN, 0.4])).toBe(false);
    expect(fistForming(null)).toBe(false);
  });
  it('wristScrollKeep: only on the same button and not in a fist', () => {
    expect(wristScrollKeep('secUp', 'secUp', false)).toBe(true);
    expect(wristScrollKeep('secUp', 'secDown', false)).toBe(false);
    expect(wristScrollKeep('secUp', null, false)).toBe(false); // the ray left the menu
    expect(wristScrollKeep('secUp', 'secUp', true)).toBe(false); // the hand became a fist
    expect(wristScrollKeep(undefined, undefined, false)).toBe(false);
  });
});


// ---- build 626: latency ----
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
describe('filter lag (build 626: the hand felt delayed)', () => {
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

describe('direct grab: distances and the choice (build 626)', () => {
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
