import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  createPointRay, POINT_RAY, POINT_JOINTS, createPointGate, POINT_GATE, createHomeRay, HOME_RAY, HOME_VIS, HOME_PINCH_JOINTS, homeBeam, beamAlpha, pinchStrength,
  HAND_RAY_MODES, HAND_RAY_DEFAULT, normalizeHandRay, headForward, shoulderPoint, RAY_HOLD_MS, fingerCurl, PINCH, parsePointTune, parseHomeTune,
} from '../../docs/vr-hand.js';
import * as hand from '../../docs/vr-hand.js';
import { createHandInput } from '../../docs/vr-hand-view.js';

// the hand's laser. Three modes (the device setting handRay): 'standard' = 標準 (the system's ray as it is), 'home' = ホーム方式 (the Meta Quest Home pointer
// rebuilt: estimated shoulder -> pinch point, Meta's beam / cursor), 'point' = 指差し (shown only while pointing; wrist -> index fingertip; select = the normal pinch).
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
// createPointRay's inputs from a hand pose
const pIn = h => ({ j: new Float64Array([...h.j.wrist, ...h.j['index-finger-tip']]), w: new Float64Array([...h.j.wrist, ...h.wq]), pd: h.pd, tip: h.j['index-finger-tip'], wrist: h.j.wrist });
const wristToTip = s => unit(add(s.tip, s.wrist, -1));
function pRun(ray, f, from, to, sys = SYS) {
  const out = [];
  for (let t = from; t <= to + 1e-6; t += FRAME) { const s = pIn(f(t - from)), pose = sys(); ray.update(pose, s.j, s.w, s.pd, s.pd < PINCH.on, t); out.push({ t, pose: Float64Array.from(pose), s }); }
  return out;
}
const settleP = (opts = {}, ms = 500) => { const ray = createPointRay(), seq = pRun(ray, () => handPose(opts), 0, ms); return { ray, last: seq[seq.length - 1].pose, s: pIn(handPose(opts)) }; };
// a pinch: pointing (gap 6 cm, index bend 10) until t0, then over dur ms the thumb closes to 1 cm while the index curls to bend 110 (its tip moves toward the thumb)
const closing = (t, t0 = 500, dur = 150) => { const k = Math.max(0, Math.min(1, (t - t0) / dur)); return { gap: 0.06 - 0.05 * k, index: 10 + 100 * k }; };

describe('the setting: 標準 / ホーム方式 / 指差し, 標準 by default; 指先 / 手のひら are gone and read as 標準', () => {
  it('modes and default', () => {
    expect(HAND_RAY_MODES).toEqual(['standard', 'home', 'point']); expect(HAND_RAY_DEFAULT).toBe('standard');
    for (const m of HAND_RAY_MODES) expect(normalizeHandRay(m)).toBe(m);
    for (const bad of [undefined, null, '', 'x', 1, {}, 'Standard', 'between', 'wrist']) expect(normalizeHandRay(bad)).toBe('standard');
  });
  it('the removed rays are gone from the module (createFingerRay / createPalmRay / createArmRay and their constants)', () => {
    for (const k of ['createFingerRay', 'createPalmRay', 'createArmRay', 'FINGER_RAY', 'FINGER_JOINTS', 'PALM_RAY', 'ARM_RAY']) expect(hand[k], k).toBeUndefined();
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
    for (const m of ['home', 'point']) {
      cur.mod.settings.set('handRay', m); expect(JSON.parse(cur.store.get('vrl.settings.v1')).handRay).toBe(m);
      cur = await load(JSON.parse(cur.store.get('vrl.settings.v1'))); expect(cur.mod.settings.get('handRay')).toBe(m);
    }
    const old = await load({ gpuSide: 768 }); expect(old.mod.settings.get('handRay')).toBe('standard'); // settings saved before the entry: the default
  });
  it('migration: a stored 指先 (between) / 手のひら (wrist) / bad value reads as standard on load (so the 2D select shows a real option), other settings kept', async () => {
    for (const v of ['between', 'wrist', 'laser', 3, null]) {
      const { mod } = await load({ handRay: v, gpuSide: 768 });
      expect(mod.settings.get('handRay')).toBe('standard'); expect(mod.settings.get('gpuSide')).toBe(768);
    }
  });
});

// ---- 指差し: the ray ----
describe('指差し (point): origin = the index fingertip, direction = wrist -> index fingertip, nothing else mixed in', () => {
  it('the joints are the wrist and the index tip; the ray is their line exactly (any hand turn, finger swing, curl)', () => {
    expect(POINT_JOINTS).toEqual(['wrist', 'index-finger-tip']);
    for (const opts of [{}, { index: 30, side: 10 }, { index: 5, side: -15, q: rotQ([1, 1, 0], 30) }, { q: rotQ([0, 1, 0], 70) }]) {
      const { last, s } = settleP(opts);
      expect(dist(last, s.tip)).toBeLessThan(1e-6);
      expect(angleBetween(dirOfPose(last), wristToTip(s))).toBeLessThan(0.01);
    }
  });
  it('no blend with any other direction: the index knuckle line, the thumb and a system ray 120 deg away change nothing', () => {
    const { last, s } = settleP({ index: 40 }); // a bent finger: the knuckle -> tip line is ~25 deg off the wrist -> tip line
    const kn = handPose({ index: 40 }).j['index-finger-phalanx-proximal'];
    expect(angleBetween(unit(add(s.tip, kn, -1)), wristToTip(s))).toBeGreaterThan(10);
    expect(angleBetween(dirOfPose(last), wristToTip(s))).toBeLessThan(0.01);
    const a = settleP({ gap: 0.05 }).last, b = settleP({ gap: 0.09 }).last;
    expect(dist(a, b)).toBeLessThan(1e-9); expect(angleBetween(dirOfPose(a), dirOfPose(b))).toBeLessThan(1e-6);
    const q120 = rotQ([0, 1, 0], 120), sys = () => { const p = SYS(); p[3] = q120.x; p[4] = q120.y; p[5] = q120.z; p[6] = q120.w; return p; };
    const seq = pRun(createPointRay(), () => handPose(), 0, 500, sys), e = seq[seq.length - 1];
    expect(angleBetween(dirOfPose(e.pose), wristToTip(e.s))).toBeLessThan(0.01);
    const first = pRun(createPointRay(), () => handPose(), 0, 0)[0]; // the very first frame: the pointing ray itself (no fade from the system's)
    expect(angleBetween(dirOfPose(first.pose), wristToTip(first.s))).toBeLessThan(1e-6); expect(dist(first.pose, first.s.tip)).toBeLessThan(1e-9);
  });
  it('light filtering: under 10 ms of lag at normal speeds (0.3 m/s, 60 deg/s); rest jitter smoothed', () => {
    const at = t => handPose({ q: rotQ([0, 1, 0], 60 * t / 1000), p: [0.1 + 0.3 * t / 1000, 1.2, -0.3] });
    const seq = pRun(createPointRay(), at, 0, 1500), last = seq[seq.length - 1], s = pIn(at(last.t));
    expect(dist(last.pose, s.tip) / 0.3 * 1000).toBeLessThan(10);
    expect(angleBetween(dirOfPose(last.pose), wristToTip(s)) / 60 * 1000).toBeLessThan(10);
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
    // the closing is noticed a frame or two into it (a 2-3 deg transient from the live ray), then the held ray is back on the pre-pinch one and stays there
    expect(Math.max(...held.filter(x => x.t > 450).map(x => x.dev))).toBeLessThan(4);
    expect(Math.max(...held.filter(x => x.t > 560).map(x => x.dev))).toBeLessThan(0.5);
    expect(Math.max(...held.filter(x => x.t > 560).map(x => x.move))).toBeLessThan(0.005);
    expect(held.find(x => x.pd < PINCH.on)).toBeTruthy();
  });
  it('the held ray moves and turns with the WRIST (the hold is in wrist coordinates): a 20 deg turn of the hand after the onset turns it 20 deg', () => {
    const f = t => ({ ...closing(t), q: t < 900 ? new THREE.Quaternion() : rotQ([0, 1, 0], Math.min(20, 20 * (t - 900) / 200)) });
    const seq = pRun(createPointRay(), t => handPose(f(t)), 0, 1700), a = dirOfPose(seq.find(x => x.t > 880).pose), b = dirOfPose(seq[seq.length - 1].pose);
    expect(angleBetween(a, b)).toBeGreaterThan(19); expect(angleBetween(a, b)).toBeLessThan(21);
  });
  it('after the fingers open the ray goes back to the live wrist -> tip line (no stuck hold)', () => {
    const g = t => (t < 400 ? 0.06 : t < 550 ? 0.06 - 0.05 * (t - 400) / 150 : t < 800 ? 0.01 : t < 900 ? 0.01 + 0.05 * (t - 800) / 100 : 0.06);
    const seq = pRun(createPointRay(), t => handPose({ gap: g(t), index: 10 + 100 * (0.06 - g(t)) / 0.05, side: t > 1000 ? 15 : 0 }), 0, 1800), end = seq[seq.length - 1];
    expect(angleBetween(dirOfPose(end.pose), wristToTip(end.s))).toBeLessThan(0.5); expect(dist(end.pose, end.s.tip)).toBeLessThan(0.001);
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

// ---- ホーム方式 ----
describe('ホーム方式 (home): from the pinch point along the estimated shoulder -> pinch point line (Meta ISDK shoulder estimate)', () => {
  const HEAD = [0, 1.6, 0], hq = (yaw = 0, pitch = 0, roll = 0) => { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D, yaw * D, roll * D, 'YXZ')); return new Float64Array([q.x, q.y, q.z, q.w]); };
  const pinchPoint = h => h.j[HOME_PINCH_JOINTS[0]].map((v, i) => (v + h.j[HOME_PINCH_JOINTS[1]][i]) / 2);
  const hRun = (ray, ppf, from, to, o = {}) => { const out = []; for (let t = from; t <= to + 1e-6; t += FRAME) { const pose = SYS(); ray.update(pose, ppf(t - from), o.head || HEAD, o.hq || hq(), o.side ?? 1, t); out.push({ t, pose: Float64Array.from(pose) }); } return out; };
  const settleH = (pp, o) => { const s = hRun(createHomeRay(), () => pp, 0, 800, o); return s[s.length - 1].pose; };
  it('the shoulder = head + yaw * (0.13 to the hand side, 0.25 down, 0.13 back): ISDK ShoulderEstimatePosition; left mirrored; head yaw turns it, pitch / roll do not', () => {
    expect(HOME_RAY).toMatchObject({ shoulderSide: 0.13, neckDown: 0.25, shoulderBack: 0.13, handScale: 1 });
    const fw = [0, 0], sh = [0, 0, 0];
    expect(headForward(hq(0), fw)).toBe(true); shoulderPoint(HEAD, fw, 1, sh);
    expect(sh[0]).toBeCloseTo(0.13, 9); expect(sh[1]).toBeCloseTo(1.35, 9); expect(sh[2]).toBeCloseTo(0.13, 9); // behind the head: +Z (the head looks along -Z)
    shoulderPoint(HEAD, fw, -1, sh); expect(sh[0]).toBeCloseTo(-0.13, 9); expect(sh[2]).toBeCloseTo(0.13, 9);
    headForward(hq(90), fw); shoulderPoint(HEAD, fw, 1, sh); expect(sh[0]).toBeCloseTo(0.13, 9); expect(sh[2]).toBeCloseTo(-0.13, 9); // turned to -X: right = -Z, back = +X
    headForward(hq(0, 40, 25), fw); expect(fw[0]).toBeCloseTo(0, 6); expect(fw[1]).toBeCloseTo(-1, 6);
  });
  it('origin = the pinch point + 2 cm along the ray; direction = shoulder -> pinch point (the midpoint of the thumb / index distal joints)', () => {
    expect(HOME_PINCH_JOINTS).toEqual(['thumb-phalanx-distal', 'index-finger-phalanx-distal']);
    const h = handPose({ ...OPEN, p: [0.25, 1.15, -0.35] }), pp = pinchPoint(h), last = settleH(pp), d = unit(add(pp, [0.13, 1.35, 0.13], -1));
    expect(angleBetween(dirOfPose(last), d)).toBeLessThan(1e-6);
    expect(dist(last, add(pp, d, HOME_RAY.originFwd))).toBeLessThan(1e-9);
    const l = settleH([-0.25, 1.15, -0.35], { side: -1 }); expect(angleBetween(dirOfPose(l), unit([-0.25 + 0.13, 1.15 - 1.35, -0.35 - 0.13]))).toBeLessThan(1e-6);
    const u = settleH([-0.25, 1.15, -0.35], { side: 0 }); expect(angleBetween(dirOfPose(u), dirOfPose(l))).toBeLessThan(1e-4); // side unknown: from where the hand is
  });
  it('a turn of the WRIST hardly turns it (a 30 deg wrist turn: a few degrees; the 指差し ray turns the full 30)', () => {
    const W = [0.25, 1.15, -0.35];
    const homeDir = deg => dirOfPose(settleH(pinchPoint(handPose({ ...OPEN, p: W, q: rotQ([0, 1, 0], deg) }))));
    const pointDir = deg => dirOfPose(settleP({ ...POINTING, p: W, q: rotQ([0, 1, 0], deg) }).last);
    for (const [axis, deg] of [[[0, 1, 0], 30], [[1, 0, 0], 30], [[0, 1, 0], -30]]) {
      const h0 = dirOfPose(settleH(pinchPoint(handPose({ ...OPEN, p: W })))), h1 = dirOfPose(settleH(pinchPoint(handPose({ ...OPEN, p: W, q: rotQ(axis, deg) }))));
      expect(angleBetween(h0, h1)).toBeLessThan(10);
    }
    expect(angleBetween(homeDir(0), homeDir(30))).toBeLessThan(angleBetween(pointDir(0), pointDir(30)) / 3);
    expect(angleBetween(pointDir(0), pointDir(30))).toBeGreaterThan(29);
  });
  it('the arm moving the hand moves the ray (the hand 20 cm to the side: the line to the shoulder turns ~20 deg)', () => {
    const a = settleH([0.25, 1.15, -0.35]), b = settleH([0.45, 1.15, -0.35]);
    expect(angleBetween(dirOfPose(a), dirOfPose(b))).toBeGreaterThan(15);
  });
  it('Meta\'s One Euro on the pinch point (ISDK HandFilterParameterBlock wrist: minCutoff 0.5 Hz, beta 5 per m/s, dCutoff 1 Hz; metres, speedScale 1)', () => {
    expect(HOME_RAY.pos).toEqual({ minCutoff: 0.5, beta: 5, dCutoff: 1 });
    const step = t => (t < 300 ? [0.25, 1.15, -0.35] : [0.27, 1.15, -0.35]); // a 2 cm step: smoothed, not jumped; reached within a second
    const seq = hRun(createHomeRay(), step, 0, 2000), after = seq.find(x => x.t > 300 + FRAME), end = seq[seq.length - 1];
    const before = seq.filter(x => x.t < 300).pop(); expect(after.pose[0] - before.pose[0]).toBeGreaterThan(0); expect(after.pose[0] - before.pose[0]).toBeLessThan(0.01); expect(Math.abs(end.pose[0] - (0.27 + HOME_RAY.originFwd * unit(add([0.27, 1.15, -0.35], [0.13, 1.35, 0.13], -1))[0]))).toBeLessThan(0.002);
  });
  it('a missing / non-finite pinch point, head or head orientation: the system ray through a cross-fade, never a NaN; a bad system pose or time is left alone', () => {
    for (const [pp, h, q] of [[[NaN, 1, 1], HEAD, hq()], [[0.25, 1.15, -0.35], [0, NaN, 0], hq()], [[0.25, 1.15, -0.35], HEAD, new Float64Array([NaN, 0, 0, 1])], [[0.25, 1.15, -0.35], HEAD, new Float64Array(4)]]) {
      const ray = createHomeRay(); let p; for (let t = 0; t <= 600; t += FRAME) { p = SYS(); ray.update(p, t < 100 ? [0.25, 1.15, -0.35] : pp, t < 100 ? HEAD : h, t < 100 ? hq() : q, 1, t); }
      expect([...p].every(Number.isFinite)).toBe(true); expect(angleBetween(dirOfPose(p), [0, 0, -1])).toBeLessThan(1e-6);
    }
    const ray = createHomeRay(); let p = SYS(); ray.update(p, [0.25, 1.15, -0.35], HEAD, hq(), 1, NaN); expect([...p]).toEqual([...SYS()]);
    p = SYS(); p[4] = NaN; ray.update(p, [0.25, 1.15, -0.35], HEAD, hq(), 1, 0); expect(Object.is(p[4], NaN)).toBe(true);
  });
  it('the look (raycasting_specs / ISDK HandRayInteractor.prefab): beam 0.10 m off the hand, <= 0.25 m, 5 cm short of the hit, alpha 1 - 4 (u - 0.5)^2; cursor 0.48 -> 0.40 by the pinch strength', () => {
    expect(HOME_VIS).toMatchObject({ beamStart: 0.1, beamMax: 0.25, beamEnd: 0.05, beamWidth: 0.0005, feather: 4, lenFade: 0.1, fadeMs: 250, noHitAlpha: 1, hoverColor: 0xffffff, selectColor: 0x001e78,
      cursorScale: 0.017, hoverSize: 0.48, selectSize: 0.4, outline: 0.05, normalOffset: 0.005, cursorFadeMs: 500 });
    expect(beamAlpha(0)).toBe(0); expect(beamAlpha(1)).toBe(0); expect(beamAlpha(0.5)).toBe(1); expect(beamAlpha(0.25)).toBeCloseTo(0.75, 9);
    expect(homeBeam(2)).toEqual({ start: 0.1, len: 0.25, k: 1 }); expect(homeBeam(null)).toEqual({ start: 0.1, len: 0.25, k: 1 });
    const near = homeBeam(0.2); expect(near.len).toBeCloseTo(0.05, 9); expect(near.k).toBeCloseTo(0.5, 9); expect(homeBeam(0.1).len).toBe(0);
    expect(pinchStrength(0.08, false)).toBe(0); expect(pinchStrength(PINCH.on, false)).toBe(1); expect(pinchStrength(0.05, true)).toBe(1); expect(pinchStrength(NaN, false)).toBe(0);
    expect(pinchStrength(0.039, false)).toBeCloseTo(0.5, 6);
    expect(parseHomeTune('{"beamWidth":0.0012,"minCutoff":1,"shoulderBack":0,"nope":2}')).toEqual({ beamWidth: 0.0012, minCutoff: 1, shoulderBack: 0 });
  });
});

// ---- the view: createHandInput run with stand-in joints (real three.js objects, no WebXR) ----
describe('the view: each mode on the group, 標準 untouched, 指差し gated, ホーム方式 drawn with Meta\'s beam / cursor; controllers unaffected', () => {
  const SYSP = [0.1, 1.2, -0.2], OFF = [0.1, 1.2, -0.3];
  function setup(mode, pose0 = POINTING) {
    const stubs = { canvas: { width: 0, height: 0, getContext: () => ({ clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {}, measureText: () => ({ width: 10 }) }) } };
    vi.stubGlobal('document', { createElement: () => stubs.canvas });
    const joints = {}, mk = (name, p) => { const o = joints[name] || new THREE.Object3D(); o.visible = true; o.position.set(...p); o.quaternion.set(0, 0, 0, 1); o.updateMatrix(); joints[name] = o; };
    let cur = pose0;
    const pose = (o = {}) => { cur = { ...cur, ...o }; const h = handPose({ ...cur, p: OFF }); for (const k in h.j) mk(k, h.j[k]); return h; };
    pose();
    const c = new THREE.Group(); c.matrixAutoUpdate = false; c.visible = true; c.userData.source = { hand: {}, handedness: 'right' };
    const ray = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()); c.add(ray); c.userData.ray = ray;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004), new THREE.MeshBasicMaterial()); c.userData.dot = dot;
    const scene = new THREE.Scene(), m = { mode };
    scene.add(c);
    const renderer = { xr: { getHand: () => ({ joints }) } };
    const hi = createHandInput(THREE, { renderer, scene, controllers: [c], ja: true, getHead: () => new THREE.Vector3(0, 1.6, 0), getHeadQ: () => new THREE.Quaternion(), rayMode: () => m.mode, colorOf: () => 0xffffff, release() {}, handInHolder: () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }), sectionOn: () => false, avail: () => true, grab: () => true, ungrab() {}, busy: () => false, near: () => null });
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
    expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); expect(s.hi.rayOn(s.c)).toBe(true); expect(s.hi.drawLaser(s.c, 1, true, new THREE.Vector3(), 700)).toBe(false);
    let t = 700;
    for (let i = 0; i < 40; i++, t += FRAME) { s.setSysQ(rotQ([0, 1, 0], i)); s.frame(t, { gap: i < 10 ? 0.06 : 0.01, index: i < 10 ? 10 : 110 }); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); }
    expect(s.events.map(e => e[0])).toEqual(['selectstart']);
    for (let i = 0; i < 20; i++, t += FRAME) { s.setSysQ(rotQ([0, 1, 0], 40 - i)); s.frame(t, { gap: 0.06, index: 10 }); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); }
    expect(s.events.map(e => e[0])).toEqual(['selectstart', 'selectend']);
    s.setSysQ(rotQ([1, 0, 0], 12)); s.writeSys(); s.c.dispatchEvent({ type: 'selectstart', data: s.c.userData.source }); expect(same(s.c.matrix, s.sysMatrix())).toBe(true);
    s.writeSys(); s.c.dispatchEvent({ type: 'selectend', data: s.c.userData.source }); expect(same(s.c.matrix, s.sysMatrix())).toBe(true);
    t += 500; s.frame(t, { visible: false }); expect(s.c.visible).toBe(false);
  });
  it('指差し: on while pointing (rayOn), the group = index tip along wrist -> tip; off with an open hand (rayOn false)', () => {
    const s = setup('point'); settle(s);
    expect(s.hi.rayOn(s.c)).toBe(true);
    const h = s.hand(); expect(dist(posOf(s.c), h.j['index-finger-tip'])).toBeLessThan(1e-4);
    expect(angleBetween(dirOf(s.c), unit(add(h.j['index-finger-tip'], h.j.wrist, -1)))).toBeLessThan(0.05);
    let t = settle(s, 700, 0); for (let i = 0; i < 10; i++, t += FRAME) s.frame(t, OPEN);
    expect(s.hi.rayOn(s.c)).toBe(false);
    expect(s.hi.drawLaser(s.c, 1, true, new THREE.Vector3(), t)).toBe(false); // not home: vr-view.js's own line (hidden by rayOn there)
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
  it('ホーム方式: shoulder -> pinch point on the group; drawLaser draws Meta\'s beam (hover white / select blue) and the cursor at the hit, hidden on no hit and while a fist holds', () => {
    const s = setup('home', OPEN); let t = settle(s);
    const h = s.hand(), pp = h.j['thumb-phalanx-distal'].map((v, i) => (v + h.j['index-finger-phalanx-distal'][i]) / 2), d = unit(add(pp, [0.13, 1.35, 0.13], -1));
    expect(angleBetween(dirOf(s.c), d)).toBeLessThan(0.01); expect(dist(posOf(s.c), add(pp, d, 0.02))).toBeLessThan(1e-4);
    expect(s.hi.rayOn(s.c)).toBe(true);
    const at = new THREE.Vector3(0, 1.3, -1);
    for (let i = 0; i < 30; i++, t += FRAME) { s.frame(t); expect(s.hi.drawLaser(s.c, 1, true, at, t)).toBe(true); }
    const beam = s.c.children.find(o => o.isMesh), curs = s.scene.children.filter(o => o.isGroup && o !== s.c && o.children.length === 2 && o.children[0].isMesh);
    expect(beam.visible).toBe(true); expect(beam.position.z).toBeCloseTo(-0.1, 9); expect(beam.scale.z).toBeCloseTo(0.25, 9); expect(beam.scale.x).toBeCloseTo(0.0005, 9);
    expect(beam.material.opacity).toBeCloseTo(1, 6); expect(beam.material.color.getHex()).toBe(0xffffff); expect(beam.geometry.attributes.color.itemSize).toBe(4);
    expect(curs).toHaveLength(1); const cur = curs[0]; expect(cur.visible).toBe(true);
    const dh = new THREE.Vector3(0, 1.6, 0).distanceTo(at); expect(cur.position.distanceTo(at)).toBeCloseTo(0.005, 6);
    expect(cur.children[1].scale.x).toBeCloseTo(0.48 * 0.017 * (dh - 0.005), 6); expect(cur.children[0].material.opacity).toBeCloseTo(0.698, 3);
    // pinch: the beam turns blue, the cursor shrinks to 0.40
    for (let i = 0; i < 20; i++, t += FRAME) { s.frame(t, { gap: 0.01, index: 110 }); s.hi.drawLaser(s.c, 1, true, at, t); }
    expect(s.events.map(e => e[0])).toEqual(['selectstart']);
    expect(beam.material.color.getHex()).toBe(0x001e78); expect(cur.children[1].scale.x).toBeCloseTo(0.4 * 0.017 * (dh - 0.005), 6); expect(cur.children[0].material.opacity).toBeCloseTo(0.949, 3);
    for (let i = 0; i < 20; i++, t += FRAME) { s.frame(t, { gap: 0.06, index: 10 }); s.hi.drawLaser(s.c, 1, true, at, t); }
    // no hit: the beam stays (noHitAlpha 1), the cursor fades out over 0.5 s
    s.frame(t); s.hi.drawLaser(s.c, null, false, at, t); t += FRAME; s.frame(t); s.hi.drawLaser(s.c, null, false, at, t);
    expect(beam.material.opacity).toBeGreaterThan(0.5); expect(cur.visible).toBe(true);
    for (let i = 0; i < 60; i++, t += FRAME) { s.frame(t); s.hi.drawLaser(s.c, null, false, at, t); }
    expect(beam.visible).toBe(true); expect(beam.material.opacity).toBeGreaterThan(0.5); expect(cur.visible).toBe(false);
    // a short hit: the length fade
    for (let i = 0; i < 40; i++, t += FRAME) { s.frame(t); s.hi.drawLaser(s.c, 0.2, true, at, t); }
    expect(beam.scale.z).toBeCloseTo(0.05, 9); expect(beam.material.opacity).toBeCloseTo(0.5, 6);
    // back to 標準: the home visuals hide, vr-view.js's line is used again
    s.m.mode = 'standard'; s.frame(t); expect(s.hi.drawLaser(s.c, 1, true, at, t)).toBe(false); expect(beam.visible).toBe(false); expect(cur.visible).toBe(false);
  });
  it('ホーム方式: no carry through a pinch (the live shoulder -> hand ray stays on the group); 指差し carries it with the palm', () => {
    const s = setup('home', OPEN); let t = settle(s);
    for (let i = 0; i < 25; i++, t += FRAME) s.frame(t, { gap: i < 5 ? 0.06 : 0.01, index: i < 5 ? 10 : 110 });
    const h = s.hand(), pp = h.j['thumb-phalanx-distal'].map((v, i) => (v + h.j['index-finger-phalanx-distal'][i]) / 2);
    for (let i = 0; i < 200; i++, t += FRAME) s.frame(t); // the filter settles on the pinched hand
    expect(s.events.map(e => e[0])).toEqual(['selectstart']);
    expect(angleBetween(dirOf(s.c), unit(add(pp, [0.13, 1.35, 0.13], -1)))).toBeLessThan(0.05);
  });
  it('the setting is read every frame; back to 標準 = the system ray exactly; a controller is not touched (no hs)', () => {
    const s = setup('standard'); settle(s, 0, 300);
    s.m.mode = 'point'; settle(s, 310, 300); expect(dist(posOf(s.c), s.hand().j['index-finger-tip'])).toBeLessThan(1e-4);
    s.m.mode = 'home'; settle(s, 620, 300); expect(dist(posOf(s.c), s.hand().j['index-finger-tip'])).toBeGreaterThan(0.01);
    s.m.mode = 'standard'; s.frame(1000); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true);
    const k = setup('point'); k.c.userData.source = { gamepad: {}, handedness: 'right' }; delete k.c.userData.hs;
    k.c.matrix.compose(new THREE.Vector3(0.3, 1, -0.5), new THREE.Quaternion(0, 0.3826834, 0, 0.9238795), new THREE.Vector3(1, 1, 1));
    const mm = k.c.matrix.clone(); k.hi.frame(0); k.hi.frame(20);
    expect(same(k.c.matrix, mm)).toBe(true); expect(k.hi.rayOn(k.c)).toBe(true); expect(k.hi.drawLaser(k.c, 1, true, new THREE.Vector3(), 20)).toBe(false);
  });
  it('a missing joint: 指差し turns off (no fallback ray shown), ホーム方式 falls back to the system ray; NaN never reaches the group', () => {
    const s = setup('point'); let t = settle(s, 0, 300); expect(s.hi.rayOn(s.c)).toBe(true);
    s.joints['index-finger-tip'].visible = false; for (let i = 0; i < 30; i++, t += FRAME) s.frame(t);
    expect(s.hi.rayOn(s.c)).toBe(false); expect(s.c.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    const h = setup('home', OPEN); t = settle(h, 0, 300);
    h.joints['thumb-phalanx-distal'].visible = false; for (let i = 0; i < 60; i++, t += FRAME) h.frame(t);
    expect(h.c.matrixWorld.elements.every(Number.isFinite)).toBe(true); expect(angleBetween(dirOf(h.c), [0, 0, -1])).toBeLessThan(1e-3);
  });
});

describe('the sources: where the setting lives, the VR / 2D labels, the hooks in vr-view.js', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const hv = readFileSync(new URL('../../docs/vr-hand-view.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../../docs/ui-shell.js', import.meta.url), 'utf8');
  const sui = readFileSync(new URL('../../docs/settings-ui.js', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('../../docs/i18n.js', import.meta.url), 'utf8');
  const dbg = readFileSync(new URL('../../docs/debug-switches-ui.js', import.meta.url), 'utf8') + readFileSync(new URL('../../docs/debug-flags.js', import.meta.url), 'utf8');
  it('the VR menu 表示 tab: 「ハンドのレーザー」 標準 / ホーム方式 / 指差し in the order of HAND_RAY_MODES, only with hands', () => {
    expect(src).toContain("hrT:'ハンドのレーザー',hrV:['標準','ホーム方式','指差し']"); expect(src).toContain("hrT:'Hand laser',hrV:['Standard','Home style','Pointing']");
    expect(src).toContain('if(handIn.anyHand())choice(yb-100,L.hrT,L.hrV.map((t,i)=>({label:t,value:HAND_RAY_MODES[i]})),handRayMode(),v=>setHandRayMode(v));');
    expect(src).toContain("normalizeHandRay(globalThis.__vrlSettings?.get?.('handRay'))"); expect(src).toContain("globalThis.__vrlSettings?.set?.('handRay',normalizeHandRay(v))");
    expect(src).not.toMatch(/'指先'|'手のひら'|wristRay|'Fingertip'|'Palm'/);
  });
  it('the page: 設定 > 描画 has the same three options bound to the same key; the labels exist in Japanese and English; the old ones are gone', () => {
    expect(shell).toContain('<select id="set-hand-ray"><option value="standard" data-i18n="handRayStandard"></option><option value="home" data-i18n="handRayHome"></option><option value="point" data-i18n="handRayPoint"></option></select>');
    expect(shell).not.toMatch(/value="between"|value="wrist"/);
    expect(sui).toContain("bind('set-hand-ray','handRay',false)"); expect(sui).toContain("put('set-hand-ray',v.handRay)");
    for (const k of ['setHandRay', 'handRayStandard', 'handRayHome', 'handRayPoint', 'setHandRayNote']) expect(i18n.match(new RegExp(k + ':', 'g'))).toHaveLength(2);
    for (const k of ['handRayBetween', 'handRayWrist']) expect(i18n).not.toContain(k);
    expect(i18n).toContain("handRayStandard:'標準',handRayHome:'ホーム方式',handRayPoint:'指差し'"); expect(i18n).toContain("handRayStandard:'Standard',handRayHome:'Home style',handRayPoint:'Pointing'");
  });
  it('not a debug switch', () => { expect(dbg).not.toMatch(/handRay|hand-ray/); });
  it('vr-view.js: a hand whose laser is off hits nothing and draws nothing; ホーム方式 draws through drawLaser; the 標準 / controller line path is the old one', () => {
    expect(src).toContain('const rOff=!handIn.rayOn(c),bd=rOff?noHits:histAxis===c?histAxisBd:boardHits(c)');
    expect(src).toContain('if(!board&&!rh&&!rOff){'); expect(src).toContain("const res=rOff||rh&&!board&&wheelOwner!==c&&pw?.c!==c?{kind:'none',ref:null}:resolveTriggerTarget(");
    expect(src).toContain('if(dist!=null){ray.scale.z=dist;ray.material.opacity=1;setRay(c);raycaster.ray.at(dist,dot.position);'); expect(src).toContain('else{ray.scale.z=0.6;ray.material.opacity=0.35}');
    expect(src).toContain('{const own=!rOff&&handIn.drawLaser(c,dist,dot.visible,dot.position,nowF);ray.visible=!rOff&&!own;if(rOff||own)dot.visible=false}');
  });
  it('the view: 標準 never writes the group; only 指差し carries a pinch; a press is refused while the 指差し laser is off', () => {
    expect(hv).toContain("hs.has=true;if(std(hs))c.updateMatrixWorld(true);else{handRay(c,hs,r,now);apply(c,shownPose(hs))}");
    expect(hv).toContain("if(hs.mode==='point'){"); expect(hv).toContain("}else if(hs.mode==='home'){");
    expect(hv).toContain('const show=(c,hs)=>{if(std(hs))c.updateMatrixWorld(true);else apply(c,shownPose(hs))};');
    expect(hv).toContain("if(carryOn&&hs.mode==='point'&&"); expect(hv).toContain('if(!real){hs.held=inHold;if(std(hs))return true;');
    expect(hv).toContain('const guardNow=(c,hs)=>hs.held||hs.grab.active||(fistScore(hs),fistForming(curls,guardTune))||!rayOn(hs);');
    expect(hv).toContain("const rayOn=hs=>hs.mode!=='point'||hs.gate.on;");
    expect(hv.match(/handRay\(/g)).toHaveLength(1); expect(hv.match(/apply\(c,shownPose\(hs\)\)/g)).toHaveLength(3);
    expect(hv).toContain("parsePointTune(lsGet('vrl-hand-point'))"); expect(hv).toContain("parseHomeTune(lsGet('vrl-hand-home'))");
  });
});
