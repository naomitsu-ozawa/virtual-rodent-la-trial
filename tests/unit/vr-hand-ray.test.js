import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  createPointRay, POINT_RAY, POINT_JOINTS, createPointGate, POINT_GATE, pinchStrength, pinchDotScale, PINCH_DOT,
  HAND_RAY_MODES, HAND_RAY_DEFAULT, normalizeHandRay, RAY_HOLD_MS, fingerCurl, PINCH, parsePointTune,
} from '../../docs/vr-hand.js';
import * as hand from '../../docs/vr-hand.js';
import { createHandInput } from '../../docs/vr-hand-view.js';

// the hand's laser. Two modes (the device setting handRay): 'standard' = 標準 (the system's ray as it is), 'point' = 指差し (shown only while pointing;
// the straight continuation of the index finger: knuckle -> tip, out of the tip; select = the normal pinch). ホーム方式 ('home',-638) is gone and reads as 標準.
// the laser's end dot of a hand shrinks as the pinch closes (both modes).
// The pure parts run here with synthetic joints; the view runs with stand-in joints (tests/unit/vr-hand-ray-xr.test.js runs it through three.js' own WebXRController).
const D = Math.PI / 180, FRAME = 1000 / 90;
const rotQ = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), deg * D);
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) / D;
const dirOfPose = p => { const v = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p[3], p[4], p[5], p[6])); return [v.x, v.y, v.z]; };
const SYS = () => new Float64Array([0.1, 1.2, -0.2, 0, 0, 0, 1]); // the system's ray: straight ahead (-Z), identity roll
const unit = v => { const l = Math.hypot(...v); return v.map(a => a / l); };
const add = (a, b, k = 1) => a.map((v, i) => v + k * b[i]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---- a synthetic right hand in its own frame: wrist at the origin, fingers along -Z, +Y = the back of the hand, -Y = the palm (WebXR). Each finger: metacarpal joint
// at (x, 0, -0.02), bones 6.5 / 4.5 / 2.5 / 2 cm; `bend` degrees in all (MCP 50 %, PIP 35 %, DIP 15 %) toward the palm, `side` degrees toward +X at the knuckle.
// fingerCurl: bend 10 -> 0.998 (extended), 100 -> 0.79, 120 -> 0.70 (an index reaching the thumb), 180 -> 0.39 (tucked / fist).
const FX = { index: -0.022, middle: 0, ring: 0.02, pinky: 0.038 }, BONES = [0.065, 0.045, 0.025, 0.02];
function fingerPts(x, bend, side = 0) {
  const p = [[x, 0, -0.02]]; let a = 0; const sw = side * D;
  [0, 0.5, 0.35, 0.15].forEach((k, i) => { a += bend * k * D; const d = [Math.sin(sw) * Math.cos(a), -Math.sin(a), -Math.cos(sw) * Math.cos(a)]; p.push(add(p[i], d, BONES[i])); });
  return p; // metacarpal, proximal, intermediate, distal, tip
}
const POINTING = { index: 10, others: 180 }, OPEN = { index: 10, others: 10 }, FIST = { index: 180, others: 180 };
// all joints of the hand (world): the hand turned by q and moved to p; the thumb tip `gap` metres from the index tip toward -X, its distal joint 2.5 cm behind it
function handPose({ index = 10, others = 180, side = 0, gap = 0.06, q = new THREE.Quaternion(), p = [0.1, 1.2, -0.3] } = {}) {
  const w = v => { const r = new THREE.Vector3(...v).applyQuaternion(q); return [r.x + p[0], r.y + p[1], r.z + p[2]]; };
  const local = {}, names = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
  for (const f of Object.keys(FX)) fingerPts(FX[f], f === 'index' ? index : others, f === 'index' ? side : 0).forEach((v, i) => { local[`${f}-finger-${names[i]}`] = v; });
  local['thumb-tip'] = add(local['index-finger-tip'], [-gap, 0, 0]); local['thumb-phalanx-distal'] = add(local['thumb-tip'], [-0.005, 0.005, 0.024]);
  const j = {}; for (const k in local) j[k] = w(local[k]); j.wrist = p.slice();
  const curls = ['index', 'middle', 'ring', 'pinky'].map(f => fingerCurl(names.map(n => { const v = j[`${f}-finger-${n}`]; return { x: v[0], y: v[1], z: v[2] }; })));
  return { j, curls, wq: [q.x, q.y, q.z, q.w], pd: dist(j['thumb-tip'], j['index-finger-tip']) };
}
// createPointRay's inputs from a hand pose (POINT_JOINTS: the index knuckle = index-finger-phalanx-proximal, the index tip)
const pIn = h => ({ j: new Float64Array([...h.j['index-finger-phalanx-proximal'], ...h.j['index-finger-tip']]), w: new Float64Array([...h.j.wrist, ...h.wq]), pd: h.pd, tip: h.j['index-finger-tip'], kn: h.j['index-finger-phalanx-proximal'], wrist: h.j.wrist });
const fingerAxis = s => unit(add(s.tip, s.kn, -1)); // the extended finger's line: knuckle -> tip
const wristToTip = s => unit(add(s.tip, s.wrist, -1));
// the distance of point x from the line through o along unit d
const offLine = (x, o, d) => { const v = add(x, o, -1), t = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]; return Math.hypot(v[0] - t * d[0], v[1] - t * d[1], v[2] - t * d[2]); };
function pRun(ray, f, from, to, sys = SYS) {
  const out = [];
  for (let t = from; t <= to + 1e-6; t += FRAME) { const s = pIn(f(t - from)), pose = sys(); ray.update(pose, s.j, s.w, s.pd, s.pd < PINCH.on, t); out.push({ t, pose: Float64Array.from(pose), s }); }
  return out;
}
const settleP = (opts = {}, ms = 500) => { const ray = createPointRay(), seq = pRun(ray, () => handPose(opts), 0, ms); return { ray, last: seq[seq.length - 1].pose, s: pIn(handPose(opts)) }; };
// a pinch: pointing (gap 6 cm, index bend 10) until t0, then over dur ms the thumb closes to 1 cm while the index curls to bend 110 (its tip moves toward the thumb)
const closing = (t, t0 = 500, dur = 150) => { const k = Math.max(0, Math.min(1, (t - t0) / dur)); return { gap: 0.06 - 0.05 * k, index: 10 + 100 * k }; };

describe('the setting: 標準 / 指差し, 標準 by default; ホーム方式 / 指先 / 手のひら are gone and read as 標準', () => {
  it('modes and default', () => {
    expect(HAND_RAY_MODES).toEqual(['standard', 'point']); expect(HAND_RAY_DEFAULT).toBe('standard');
    for (const m of HAND_RAY_MODES) expect(normalizeHandRay(m)).toBe(m);
    for (const bad of [undefined, null, '', 'x', 1, {}, 'Standard', 'between', 'wrist', 'home']) expect(normalizeHandRay(bad)).toBe('standard');
  });
  it('the removed rays are gone from the module (createFingerRay / createPalmRay / createArmRay, ホーム方式\'s createHomeRay and its look, and their constants)', () => {
    for (const k of ['createFingerRay', 'createPalmRay', 'createArmRay', 'FINGER_RAY', 'FINGER_JOINTS', 'PALM_RAY', 'ARM_RAY',
      'createHomeRay', 'HOME_RAY', 'HOME_VIS', 'HOME_PINCH_JOINTS', 'homeBeam', 'beamAlpha', 'headForward', 'shoulderPoint', 'parseHomeTune']) expect(hand[k], k).toBeUndefined();
  });
  afterEach(() => vi.unstubAllGlobals());
  const load = async stored => {
    vi.resetModules();
    const store = new Map(stored === undefined ? [] : [['vrl.settings.v1', JSON.stringify(stored)]]);
    vi.stubGlobal('localStorage', { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) });
    return { mod: await import('../../docs/app-settings.js'), store };
  };
  it('persists in the device settings (app-settings.js): default standard, stored under vrl.settings.v1, read back after a reload', async () => {
    let cur = await load();
    expect(cur.mod.SETTINGS_DEFAULTS.handRay).toBe('standard'); expect(cur.mod.settings.get('handRay')).toBe('standard');
    for (const m of ['point', 'standard']) {
      cur.mod.settings.set('handRay', m); expect(JSON.parse(cur.store.get('vrl.settings.v1')).handRay).toBe(m);
      cur = await load(JSON.parse(cur.store.get('vrl.settings.v1'))); expect(cur.mod.settings.get('handRay')).toBe(m);
    }
    const old = await load({ gpuSide: 768 }); expect(old.mod.settings.get('handRay')).toBe('standard'); // settings saved before the entry: the default
  });
  it('migration: a stored ホーム方式 (home) / 指先 (between) / 手のひら (wrist) / bad value reads as standard on load (so the 2D select shows a real option), other settings kept', async () => {
    for (const v of ['home', 'between', 'wrist', 'laser', 3, null]) {
      const { mod } = await load({ handRay: v, gpuSide: 768 });
      expect(mod.settings.get('handRay')).toBe('standard'); expect(mod.settings.get('gpuSide')).toBe(768);
    }
  });
});

// ---- 指差し: the ray ----
describe('指差し (point): the straight continuation of the index finger: origin = the fingertip, direction = index knuckle -> fingertip, nothing else mixed in', () => {
  it('the joints are the index knuckle (phalanx-proximal) and the index tip; the ray is their line exactly (any hand turn, finger swing, curl)', () => {
    expect(POINT_JOINTS).toEqual(['index-finger-phalanx-proximal', 'index-finger-tip']);
    for (const opts of [{}, { index: 30, side: 10 }, { index: 5, side: -15, q: rotQ([1, 1, 0], 30) }, { q: rotQ([0, 1, 0], 70) }]) {
      const { last, s } = settleP(opts);
      expect(dist(last, s.tip)).toBeLessThan(1e-6);
      expect(angleBetween(dirOfPose(last), fingerAxis(s))).toBeLessThan(0.01);
    }
  });
  it('collinear with the extended finger: the laser leaves the tip in the finger\'s own line (angle to knuckle -> tip ~0, the knuckle lies on the laser\'s line)', () => {
    for (const opts of [{ index: 0 }, { index: 10 }, { index: 10, side: 12 }, { index: 5, side: -8, q: rotQ([1, 0.3, -0.5], 50), p: [-0.2, 1.0, -0.4] }]) {
      const { last, s } = settleP({ ...POINTING, ...opts }), d = dirOfPose(last);
      expect(angleBetween(d, fingerAxis(s))).toBeLessThan(0.01); // deg
      expect(offLine(s.kn, [last[0], last[1], last[2]], d)).toBeLessThan(1e-5); // m: the line out of the tip runs back through the knuckle
      expect(dist(last, s.tip)).toBeLessThan(1e-6);
    }
    // the wrist -> tip line of was off the finger by several degrees on the same hand (the knuckle sits below / beside the wrist -> tip line)
    const { s } = settleP({ ...POINTING, index: 10, side: 12 }); expect(angleBetween(wristToTip(s), fingerAxis(s))).toBeGreaterThan(5);
  });
  it('no blend with any other direction: the wrist -> tip line, the thumb and a system ray 120 deg away change nothing', () => {
    const { last, s } = settleP({ index: 40 }); // a bent finger: the knuckle -> tip line is far off the wrist -> tip line
    expect(angleBetween(fingerAxis(s), wristToTip(s))).toBeGreaterThan(10);
    expect(angleBetween(dirOfPose(last), fingerAxis(s))).toBeLessThan(0.01);
    const a = settleP({ gap: 0.05 }).last, b = settleP({ gap: 0.09 }).last;
    expect(dist(a, b)).toBeLessThan(1e-9); expect(angleBetween(dirOfPose(a), dirOfPose(b))).toBeLessThan(1e-6);
    const q120 = rotQ([0, 1, 0], 120), sys = () => { const p = SYS(); p[3] = q120.x; p[4] = q120.y; p[5] = q120.z; p[6] = q120.w; return p; };
    const seq = pRun(createPointRay(), () => handPose(), 0, 500, sys), e = seq[seq.length - 1];
    expect(angleBetween(dirOfPose(e.pose), fingerAxis(e.s))).toBeLessThan(0.01);
    const first = pRun(createPointRay(), () => handPose(), 0, 0)[0]; // the very first frame: the pointing ray itself (no fade from the system's)
    expect(angleBetween(dirOfPose(first.pose), fingerAxis(first.s))).toBeLessThan(1e-6); expect(dist(first.pose, first.s.tip)).toBeLessThan(1e-9);
  });
  it('light filtering: under 10 ms of lag at normal speeds (0.3 m/s, 60 deg/s); rest jitter smoothed', () => {
    const at = t => handPose({ q: rotQ([0, 1, 0], 60 * t / 1000), p: [0.1 + 0.3 * t / 1000, 1.2, -0.3] });
    const seq = pRun(createPointRay(), at, 0, 1500), last = seq[seq.length - 1], s = pIn(at(last.t));
    expect(dist(last.pose, s.tip) / 0.3 * 1000).toBeLessThan(10);
    expect(angleBetween(dirOfPose(last.pose), fingerAxis(s)) / 60 * 1000).toBeLessThan(10);
    const ray = createPointRay(); let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const dirs = [], raw = [], base = pIn(handPose());
    for (let t = 0; t <= 2000; t += FRAME) {
      const j = Float64Array.from(base.j, v => v + rnd() * 0.002), pose = SYS(); ray.update(pose, j, base.w, base.pd, false, t);
      if (t > 500) { dirs.push(dirOfPose(pose)); raw.push(unit([j[3] - j[0], j[4] - j[1], j[5] - j[2]])); }
    }
    const rms = arr => { const m = unit([0, 1, 2].map(i => arr.reduce((a, d) => a + d[i], 0) / arr.length)); return Math.sqrt(arr.reduce((a, d) => a + angleBetween(d, m) ** 2, 0) / arr.length); };
    expect(rms(dirs)).toBeLessThan(rms(raw));
  });
  it('pinch onset: the ray is held where the hand pointed before the closing (the index curling toward the thumb does not drag the target)', () => {
    const run = report => {
      const ray = createPointRay(), seq = [];
      for (let t = 0; t <= 1100; t += FRAME) { const s = pIn(handPose(closing(t))), pose = SYS(); ray.update(pose, s.j, s.w, report ? s.pd : NaN, report && s.pd < PINCH.on, t); seq.push({ t, pose: Float64Array.from(pose), s }); }
      const ref = seq.find(x => x.t > 450).pose;
      return seq.map(x => ({ t: x.t, dev: angleBetween(dirOfPose(x.pose), dirOfPose(ref)), move: dist(x.pose, ref), pd: x.s.pd }));
    };
    const held = run(true), free = run(false); // free: the gap / press not reported (control)
    expect(Math.max(...free.filter(x => x.t > 760).map(x => x.dev))).toBeGreaterThan(5);
    // the closing is noticed a frame or two into it: until then the live ray follows the curling finger (the knuckle -> tip line swings about twice as fast as the
    // wrist -> tip line did, ~6 deg for 2-3 frames on this fast synthetic closing, 2-3 deg before); then the held ray is back on the pre-pinch one and stays there
    expect(Math.max(...held.filter(x => x.t > 450).map(x => x.dev))).toBeLessThan(7);
    expect(held.find(x => x.pd < PINCH.on).dev).toBeLessThan(0.1); // the press (the pinch reaching PINCH.on) aims where the hand pointed before the closing
    expect(Math.max(...held.filter(x => x.t > 560).map(x => x.dev))).toBeLessThan(0.5);
    expect(Math.max(...held.filter(x => x.t > 560).map(x => x.move))).toBeLessThan(0.005);
    expect(held.find(x => x.pd < PINCH.on)).toBeTruthy();
  });
  it('the held ray moves and turns with the WRIST (the hold is in wrist coordinates): a 20 deg turn of the hand after the onset turns it 20 deg', () => {
    const f = t => ({ ...closing(t), q: t < 900 ? new THREE.Quaternion() : rotQ([0, 1, 0], Math.min(20, 20 * (t - 900) / 200)) });
    const seq = pRun(createPointRay(), t => handPose(f(t)), 0, 1700), a = dirOfPose(seq.find(x => x.t > 880).pose), b = dirOfPose(seq[seq.length - 1].pose);
    expect(angleBetween(a, b)).toBeGreaterThan(19); expect(angleBetween(a, b)).toBeLessThan(21);
  });
  it('after the fingers open the ray goes back to the live knuckle -> tip line (no stuck hold)', () => {
    const g = t => (t < 400 ? 0.06 : t < 550 ? 0.06 - 0.05 * (t - 400) / 150 : t < 800 ? 0.01 : t < 900 ? 0.01 + 0.05 * (t - 800) / 100 : 0.06);
    const seq = pRun(createPointRay(), t => handPose({ gap: g(t), index: 10 + 100 * (0.06 - g(t)) / 0.05, side: t > 1000 ? 15 : 0 }), 0, 1800), end = seq[seq.length - 1];
    expect(angleBetween(dirOfPose(end.pose), fingerAxis(end.s))).toBeLessThan(0.5); expect(dist(end.pose, end.s.tip)).toBeLessThan(0.001);
  });
  it('a lost joint: the last ray for loseMs, then the system pose is left as it is (no cross-fade, valid false); NaN never reaches the output', () => {
    const ray = createPointRay(), base = pIn(handPose()), nan = new Float64Array(6).fill(NaN);
    let pose; for (let t = 0; t <= 300; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.w, base.pd, false, t); }
    const good = Float64Array.from(pose);
    pose = SYS(); ray.update(pose, nan, base.w, base.pd, false, 300 + FRAME); expect([...pose]).toEqual([...good]); expect(ray.valid).toBe(true);
    for (let t = 300 + 2 * FRAME; t <= 700; t += FRAME) { pose = SYS(); ray.update(pose, nan, base.w, base.pd, false, t); }
    expect([...pose]).toEqual([...SYS()]); expect(ray.valid).toBe(false);
    pose = SYS(); ray.update(pose, base.j, base.w, base.pd, false, 710); expect(dist(pose, base.tip)).toBeLessThan(1e-6); // back at once (the filter restarts)
    const w = Float64Array.from(base.w); w[5] = NaN; let p = SYS(); ray.update(p, base.j, w, base.pd, false, 720); expect([...p].every(Number.isFinite)).toBe(true);
    p = SYS(); ray.update(p, base.j, base.w, base.pd, false, NaN); expect([...p]).toEqual([...SYS()]);
    p = SYS(); p[3] = NaN; ray.update(p, base.j, base.w, base.pd, false, 730); expect(Object.is(p[3], NaN)).toBe(true);
    expect(ray.update(SYS(), base.j, base.w, base.pd, false, 740)).toBeInstanceOf(Float64Array); expect(RAY_HOLD_MS).toBe(200);
  });
  it('the pinch hold values are those of (unchanged)', () => {
    expect(POINT_RAY).toMatchObject({ freezeMs: 100, preOn: 0.03, preOff: 0.04, relHoldMs: 150, reArmMs: 400 });
  });
});

// ---- 指差し: the gate ----
describe('指差し: the laser is on only while pointing (index extended, the other three curled), latched through a pinch and 250 ms after it', () => {
  const gRun = (gate, f, from, to) => { const out = []; for (let t = from; t <= to + 1e-6; t += FRAME) { const s = f(t - from); out.push({ t, on: gate.update(s.curls, s.pd, !!s.near, t) }); } return out; };
  it('the thresholds of the study', () => {
    expect(POINT_GATE).toEqual({ indexOn: 0.85, indexOff: 0.75, othersOn: 0.62, othersOff: 0.72, pdMin: 0.03, onFrames: 3, offFrames: 8, relHoldMs: 250 });
    const p = handPose(POINTING); expect(p.curls[0]).toBeGreaterThan(0.85); for (const c of p.curls.slice(1)) expect(c).toBeLessThan(0.62);
  });
  it('on after 3 pointing frames; never with an open hand, a fist, or the thumb on the index (pd <= 3 cm)', () => {
    const g = createPointGate(), h = handPose(POINTING);
    expect(g.update(h.curls, h.pd, false, 0)).toBe(false); expect(g.update(h.curls, h.pd, false, 11)).toBe(false); expect(g.update(h.curls, h.pd, false, 22)).toBe(true);
    for (const pose of [OPEN, FIST, { ...POINTING, gap: 0.025 }]) { const gg = createPointGate(), hh = handPose(pose); expect(gRun(gg, () => hh, 0, 500).some(x => x.on)).toBe(false); }
    const gg = createPointGate(), nanC = { curls: [NaN, 0.4, 0.4, 0.4], pd: 0.06 }; expect(gRun(gg, () => nanC, 0, 200).some(x => x.on)).toBe(false);
  });
  it('off 8 frames after the hand opens or closes into a fist; ±2 mm joint noise does not flicker it', () => {
    for (const end of [OPEN, FIST]) {
      const g = createPointGate(), seq = gRun(g, t => handPose(t < 300 ? POINTING : end), 0, 600);
      const offAt = seq.find(x => x.t >= 300 && !x.on).t, firstChange = seq.find(x => x.t >= 300).t;
      expect(Math.round((offAt - firstChange) / FRAME)).toBe(7); // the 8th frame of the new pose
    }
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const g = createPointGate(), seq = gRun(g, () => { const h = handPose(POINTING), names = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
      const curls = ['index', 'middle', 'ring', 'pinky'].map(f => fingerCurl(names.map(n => { const v = h.j[`${f}-finger-${n}`]; return { x: v[0] + rnd() * 0.004, y: v[1] + rnd() * 0.004, z: v[2] + rnd() * 0.004 }; })));
      return { curls, pd: h.pd }; }, 0, 3000);
    expect(seq.filter(x => x.t > 100).every(x => x.on)).toBe(true);
  });
  it('the latch: on through a pinch (near) whatever the fingers do, and relHoldMs (250 ms) after it; then the normal OFF test', () => {
    const g = createPointGate(), pin = handPose({ index: 110, others: 180, gap: 0.01 }), after = handPose({ index: 110, others: 180, gap: 0.05 });
    expect(pin.curls[0]).toBeLessThan(0.75); // the pinching index is "not pointing"
    const seq = gRun(g, t => (t < 200 ? handPose(POINTING) : t < 700 ? { ...pin, near: true } : after), 0, 1300);
    expect(seq.filter(x => x.t > 100 && x.t < 700).every(x => x.on)).toBe(true);
    const lastNear = seq.filter(x => x.t < 700).pop().t, offAt = seq.find(x => x.t > 700 && !x.on).t;
    expect(offAt - lastNear).toBeGreaterThanOrEqual(250); expect(offAt - lastNear).toBeLessThan(250 + 9 * FRAME);
  });
  it('a pinch while off does not turn it on (the thumb is near the index), and the tunable parser accepts the gate values', () => {
    const g = createPointGate(), seq = gRun(g, () => ({ ...handPose({ ...POINTING, gap: 0.015 }), near: true }), 0, 500);
    expect(seq.some(x => x.on)).toBe(false);
    expect(parsePointTune('{"indexOn":0.9,"offFrames":12,"rayRelHoldMs":200,"bogus":1,"othersOn":"x"}')).toEqual({ indexOn: 0.9, offFrames: 12, rayRelHoldMs: 200 });
  });
});

// ---- the end dot: smaller as the pinch closes ----
describe('the end dot of a hand shrinks with the pinch (both modes): full size open, half at the pinch / a held press, continuous in between', () => {
  it('pinchDotScale', () => {
    expect(PINCH_DOT).toEqual({ open: 0.06, minScale: 0.5 });
    expect(pinchDotScale(0.08, false)).toBe(1); expect(pinchDotScale(0.06, false)).toBe(1); expect(pinchDotScale(NaN, false)).toBe(1);
    expect(pinchDotScale(PINCH.on, false)).toBeCloseTo(0.5, 12); expect(pinchDotScale(0.005, false)).toBeCloseTo(0.5, 12); expect(pinchDotScale(0.05, true)).toBeCloseTo(0.5, 12); expect(pinchDotScale(NaN, true)).toBeCloseTo(0.5, 12);
    expect(pinchDotScale(0.039, false)).toBeCloseTo(0.75, 6); expect(pinchStrength(0.039, false)).toBeCloseTo(0.5, 6);
    let prev = Infinity; for (let g = 0.07; g >= 0.01; g -= 0.002) { const k = pinchDotScale(g, false); expect(k).toBeLessThanOrEqual(prev + 1e-12); prev = k; }
  });
});

// ---- the view: createHandInput run with stand-in joints (real three.js objects, no WebXR) ----
describe('the view: each mode on the group, 標準 untouched, 指差し gated, the dot shrinks with the pinch; controllers unaffected', () => {
  const SYSP = [0.1, 1.2, -0.2], OFF = [0.1, 1.2, -0.3];
  function setup(mode, pose0 = POINTING) {
    const stubs = { canvas: { width: 0, height: 0, getContext: () => ({ clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {}, measureText: () => ({ width: 10 }) }) } };
    vi.stubGlobal('document', { createElement: () => stubs.canvas });
    const joints = {}, mk = (name, p) => { const o = joints[name] || new THREE.Object3D(); o.visible = true; o.position.set(...p); o.quaternion.set(0, 0, 0, 1); o.updateMatrix(); joints[name] = o; };
    let cur = pose0;
    const pose = (o = {}) => { cur = { ...cur, ...o }; const h = handPose({ ...cur, p: OFF }); for (const k in h.j) mk(k, h.j[k]); return h; };
    pose();
    const c = new THREE.Group(); c.matrixAutoUpdate = false; c.visible = true; c.userData.source = { hand: {}, handedness: 'right' };
    const ray = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()); c.add(ray); c.userData.ray = ray;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004), new THREE.MeshBasicMaterial()); c.userData.dot = dot;
    const scene = new THREE.Scene(), m = { mode };
    scene.add(c);
    const renderer = { xr: { getHand: () => ({ joints }) } };
    const hi = createHandInput(THREE, { renderer, scene, controllers: [c], ja: true, getHead: () => new THREE.Vector3(0, 1.6, 0), rayMode: () => m.mode, colorOf: () => 0xffffff, release() {}, handInHolder: () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }), sectionOn: () => false, avail: () => true, grab: () => true, ungrab() {}, busy: () => false, near: () => null });
    hi.connect(c, 0);
    const events = [];
    for (const t of ['selectstart', 'selectend']) c.addEventListener(t, e => { hi.eventPose(c, e); if (e.handPinch) events.push([t, c.matrix.clone()]); });
    let sysQ = new THREE.Quaternion();
    const writeSys = (vis = true) => { if (vis) { c.matrix.compose(new THREE.Vector3(...SYSP), sysQ, new THREE.Vector3(1, 1, 1)); c.matrix.decompose(c.position, c.quaternion, c.scale); } c.visible = vis; };
    const frame = (t, o) => { if (o) pose(o); writeSys(o?.visible ?? true); vi.spyOn(performance, 'now').mockReturnValue(t); hi.frame(t); c.updateMatrixWorld(true); };
    const sysMatrix = () => new THREE.Matrix4().compose(new THREE.Vector3(...SYSP), sysQ, new THREE.Vector3(1, 1, 1));
    return { c, hi, frame, m, joints, events, writeSys, sysMatrix, scene, setSysQ: q => { sysQ = q; }, hand: () => handPose({ ...cur, p: OFF }) };
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const dirOf = c => { const v = new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld); return [v.x, v.y, v.z]; };
  const posOf = c => new THREE.Vector3().setFromMatrixPosition(c.matrixWorld).toArray();
  const settle = (s, from = 0, ms = 600) => { let t = from; for (; t <= from + ms; t += FRAME) s.frame(t); return t; };
  const same = (a, b) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-12);

  it('標準: the system ray as it is, every frame: idle, through an own pinch with a turning wrist, a system select, after the release, and while the system drops it', () => {
    const s = setup('standard', OPEN); settle(s);
    expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); expect(s.hi.rayOn(s.c)).toBe(true); expect(s.hi.drawLaser).toBeUndefined();
    let t = 700;
    for (let i = 0; i < 40; i++, t += FRAME) { s.setSysQ(rotQ([0, 1, 0], i)); s.frame(t, { gap: i < 10 ? 0.06 : 0.01, index: i < 10 ? 10 : 110 }); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); }
    expect(s.events.map(e => e[0])).toEqual(['selectstart']);
    for (let i = 0; i < 20; i++, t += FRAME) { s.setSysQ(rotQ([0, 1, 0], 40 - i)); s.frame(t, { gap: 0.06, index: 10 }); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); }
    expect(s.events.map(e => e[0])).toEqual(['selectstart', 'selectend']);
    s.setSysQ(rotQ([1, 0, 0], 12)); s.writeSys(); s.c.dispatchEvent({ type: 'selectstart', data: s.c.userData.source }); expect(same(s.c.matrix, s.sysMatrix())).toBe(true);
    s.writeSys(); s.c.dispatchEvent({ type: 'selectend', data: s.c.userData.source }); expect(same(s.c.matrix, s.sysMatrix())).toBe(true);
    t += 500; s.frame(t, { visible: false }); expect(s.c.visible).toBe(false);
  });
  it('指差し: on while pointing (rayOn), the group = index tip along the finger (knuckle -> tip); off with an open hand (rayOn false)', () => {
    const s = setup('point'); settle(s);
    expect(s.hi.rayOn(s.c)).toBe(true);
    const h = s.hand(); expect(dist(posOf(s.c), h.j['index-finger-tip'])).toBeLessThan(1e-4);
    expect(angleBetween(dirOf(s.c), unit(add(h.j['index-finger-tip'], h.j['index-finger-phalanx-proximal'], -1)))).toBeLessThan(0.05);
    let t = settle(s, 700, 0); for (let i = 0; i < 10; i++, t += FRAME) s.frame(t, OPEN);
    expect(s.hi.rayOn(s.c)).toBe(false);
  });
  it('the end dot (vr-view.js\'s 4 mm sphere): full size open, smaller as the fingers close, half at the pinch, back after it; both modes; the pulse swell still multiplies it', () => {
    for (const mode of ['standard', 'point']) {
      const s = setup(mode); let t = settle(s, 0, 300); const dot = s.c.userData.dot, seq = [];
      expect(dot.scale.x).toBeCloseTo(1, 12);
      for (let i = 0; i <= 12; i++, t += FRAME) { const k = i / 12; s.frame(t, { gap: 0.06 - 0.05 * k, index: 10 + 100 * k }); seq.push(dot.scale.x); }
      for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1] + 1e-12);
      expect(seq[6]).toBeGreaterThan(0.55); expect(seq[6]).toBeLessThan(0.95); // continuous: in between halfway
      expect(seq[seq.length - 1]).toBeCloseTo(0.5, 9); expect(s.events.map(e => e[0])).toEqual(['selectstart']);
      expect(dot.scale.x).toBe(dot.scale.y); expect(dot.scale.x).toBe(dot.scale.z);
      s.hi.flash(s.c, 0.4, 30); s.frame(t); expect(dot.scale.x).toBeGreaterThan(0.5); t += 1000;
      for (let i = 0; i < 20; i++, t += FRAME) s.frame(t, { gap: 0.06, index: 10 });
      expect(dot.scale.x).toBeCloseTo(1, 12);
    }
  });
  it('指差し: a pinch while the laser is off is no press, also when the hand points again before it opens; the pinch after pointing presses and the laser stays on through it and 250 ms after', () => {
    const s = setup('point', OPEN); let t = settle(s, 0, 300);
    expect(s.hi.rayOn(s.c)).toBe(false);
    for (let i = 0; i < 20; i++, t += FRAME) s.frame(t, { gap: 0.01, index: 110 }); // a pinch with an open hand: no press
    for (let i = 0; i < 10; i++, t += FRAME) s.frame(t, { gap: 0.01, index: 10, others: 180 }); // still pinched, now "pointing" (thumb on the index: no laser)
    expect(s.events).toHaveLength(0); expect(s.hi.rayOn(s.c)).toBe(false);
    for (let i = 0; i < 20; i++, t += FRAME) s.frame(t, { gap: 0.06, index: 10, others: 180 }); // the fingers open: pointing -> on
    expect(s.hi.rayOn(s.c)).toBe(true); expect(s.events).toHaveLength(0);
    const onTrace = [];
    for (let i = 0; i < 30; i++, t += FRAME) { const k = Math.min(1, i / 12); s.frame(t, { gap: 0.06 - 0.05 * k, index: 10 + 100 * k }); onTrace.push(s.hi.rayOn(s.c)); }
    expect(s.events.map(e => e[0])).toEqual(['selectstart']); expect(onTrace.every(Boolean)).toBe(true);
    let rel = null;
    for (let i = 0; i < 60; i++, t += FRAME) { s.frame(t, { gap: 0.06, index: 110 }); if (!rel && s.events.length === 2) rel = t; onTrace.push(s.hi.rayOn(s.c)); if (!s.hi.rayOn(s.c)) break; }
    expect(s.events.map(e => e[0])).toEqual(['selectstart', 'selectend']);
    expect(t - rel).toBeGreaterThanOrEqual(250); // the index stays curled after the release: off only after the 250 ms latch (+ the 8 OFF frames)
    expect(s.hi.rayOn(s.c)).toBe(false);
  });
  it('指差し: the system\'s own select with the laser off is no press either', () => {
    const s = setup('point', OPEN); settle(s, 0, 300);
    s.writeSys(); s.c.dispatchEvent({ type: 'selectstart', data: s.c.userData.source }); s.writeSys(); s.c.dispatchEvent({ type: 'selectend', data: s.c.userData.source });
    expect(s.events).toHaveLength(0);
  });
  it('the setting is read every frame; back to 標準 = the system ray exactly; a controller is not touched (no hs)', () => {
    const s = setup('standard'); settle(s, 0, 300);
    s.m.mode = 'point'; settle(s, 310, 300); expect(dist(posOf(s.c), s.hand().j['index-finger-tip'])).toBeLessThan(1e-4);
    s.m.mode = 'home'; s.frame(620); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); // a stale 'home' (read live) is 標準
    s.m.mode = 'point'; settle(s, 640, 300); s.m.mode = 'standard'; s.frame(1000); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true);
    const k = setup('point'); k.c.userData.source = { gamepad: {}, handedness: 'right' }; delete k.c.userData.hs;
    k.c.matrix.compose(new THREE.Vector3(0.3, 1, -0.5), new THREE.Quaternion(0, 0.3826834, 0, 0.9238795), new THREE.Vector3(1, 1, 1));
    k.c.userData.dot.scale.setScalar(1.7); // whatever vr-view.js left on a controller's dot stays
    const mm = k.c.matrix.clone(); k.hi.frame(0); k.hi.frame(20);
    expect(same(k.c.matrix, mm)).toBe(true); expect(k.hi.rayOn(k.c)).toBe(true); expect(k.c.userData.dot.scale.x).toBe(1.7);
  });
  it('a missing joint: 指差し turns off (no fallback ray shown); NaN never reaches the group', () => {
    const s = setup('point'); let t = settle(s, 0, 300); expect(s.hi.rayOn(s.c)).toBe(true);
    s.joints['index-finger-tip'].visible = false; for (let i = 0; i < 30; i++, t += FRAME) s.frame(t);
    expect(s.hi.rayOn(s.c)).toBe(false); expect(s.c.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    const k = setup('point'); t = settle(k, 0, 300); k.joints['index-finger-phalanx-proximal'].visible = false; for (let i = 0; i < 30; i++, t += FRAME) k.frame(t);
    expect(k.hi.rayOn(k.c)).toBe(false); expect(k.c.matrixWorld.elements.every(Number.isFinite)).toBe(true);
  });
});

describe('the sources: where the setting lives, the VR / 2D labels, the hooks in vr-view.js', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const hv = readFileSync(new URL('../../docs/vr-hand-view.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../../docs/ui-shell.js', import.meta.url), 'utf8');
  const sui = readFileSync(new URL('../../docs/settings-ui.js', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('../../docs/i18n.js', import.meta.url), 'utf8');
  const dbg = readFileSync(new URL('../../docs/debug-switches-ui.js', import.meta.url), 'utf8') + readFileSync(new URL('../../docs/debug-flags.js', import.meta.url), 'utf8');
  it('the VR menu 表示 tab: 「ハンドのレーザー」 標準 / 指差し in the order of HAND_RAY_MODES, only with hands', () => {
    expect(src).toContain("hrT:'ハンドのレーザー',hrV:['標準','指差し']"); expect(src).toContain("hrT:'Hand laser',hrV:['Standard','Pointing']");
    expect(src).toContain('if(handIn.anyHand())choice(yb-80,L.hrT,L.hrV.map((t,i)=>({label:t,value:HAND_RAY_MODES[i]})),handRayMode(),v=>setHandRayMode(v));');
    expect(src).toContain("normalizeHandRay(globalThis.__vrlSettings?.get?.('handRay'))"); expect(src).toContain("globalThis.__vrlSettings?.set?.('handRay',normalizeHandRay(v))");
    expect(src).not.toMatch(/'指先'|'手のひら'|wristRay|'Fingertip'|'Palm'|ホーム方式|'Home style'|drawLaser|getHeadQ/);
  });
  it('the page: 設定 > 描画 has the same two options bound to the same key; the labels exist in Japanese and English; the old ones are gone', () => {
    expect(shell).toContain('<select id="set-hand-ray"><option value="standard" data-i18n="handRayStandard"></option><option value="point" data-i18n="handRayPoint"></option></select>');
    expect(shell).not.toMatch(/value="between"|value="wrist"|value="home"|handRayHome/);
    expect(sui).toContain("bind('set-hand-ray','handRay',false)"); expect(sui).toContain("put('set-hand-ray',v.handRay)");
    for (const k of ['setHandRay', 'handRayStandard', 'handRayPoint', 'setHandRayNote']) expect(i18n.match(new RegExp(k + ':', 'g'))).toHaveLength(2);
    for (const k of ['handRayBetween', 'handRayWrist', 'handRayHome', 'ホーム方式', 'Home style']) expect(i18n).not.toContain(k);
    expect(i18n).toContain("handRayStandard:'標準',handRayPoint:'指差し'"); expect(i18n).toContain("handRayStandard:'Standard',handRayPoint:'Pointing'");
  });
  it('not a debug switch', () => { expect(dbg).not.toMatch(/handRay|hand-ray/); });
  it('vr-view.js: a hand whose laser is off hits nothing and draws nothing; the 標準 / 指差し / controller line path is the old one (0.6 m, α 0.35, 4 mm dot)', () => {
    expect(src).toContain('const rOff=!handIn.rayOn(c),bd=rOff?noHits:histAxis===c?histAxisBd:boardHits(c)');
    expect(src).toContain('if(!board&&!rh&&!rOff){'); expect(src).toContain("const res=rOff||rh&&!board&&wheelOwner!==c&&pw?.c!==c?{kind:'none',ref:null}:resolveTriggerTarget(");
    expect(src).toContain('if(dist!=null){ray.scale.z=dist;ray.material.opacity=1;setRay(c);raycaster.ray.at(dist,dot.position);'); expect(src).toContain('else{ray.scale.z=0.6;ray.material.opacity=0.35}');
    expect(src).toContain('ray.visible=!rOff;if(rOff)dot.visible=false;'); expect(src).toContain('const dotGeo=new THREE.SphereGeometry(0.004,12,8);');
    expect(hv).toContain('c.userData.dot?.scale.setScalar(pinchDotScale(hs.pd,hs.pinch.pressed)*(1+2.5*hs.flashAmp*k));'); // hands only (frame() skips controllers), no colour / line change
  });
  it('the view: 標準 never writes the group; only 指差し carries a pinch; a press is refused while the 指差し laser is off', () => {
    expect(hv).toContain("hs.has=true;if(std(hs))c.updateMatrixWorld(true);else{handRay(c,hs,r,now);apply(c,shownPose(hs))}");
    expect(hv).toContain("if(hs.mode==='point'){"); expect(hv).not.toMatch(/'home'|createHomeRay|HOME_VIS|drawLaser|vrl-hand-home|getHeadQ/);
    expect(hv).toContain('const show=(c,hs)=>{if(std(hs))c.updateMatrixWorld(true);else apply(c,shownPose(hs))};');
    expect(hv).toContain("if(carryOn&&hs.mode==='point'&&"); expect(hv).toContain('if(!real){hs.held=inHold;if(std(hs))return true;');
    expect(hv).toContain('const guardNow=(c,hs)=>hs.held||hs.grab.active||(fistScore(hs),fistForming(curls,guardTune))||!rayOn(hs);');
    expect(hv).toContain("const rayOn=hs=>hs.mode!=='point'||hs.gate.on;");
    expect(hv.match(/handRay\(/g)).toHaveLength(1); expect(hv.match(/apply\(c,shownPose\(hs\)\)/g)).toHaveLength(3);
    expect(hv).toContain("parsePointTune(lsGet('vrl-hand-point'))");
  });
});
