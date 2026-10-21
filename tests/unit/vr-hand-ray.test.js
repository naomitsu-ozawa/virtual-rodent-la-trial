import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  createFingerRay, createArmRay, createPalmRay, PALM_RAY, FINGER_RAY, FINGER_JOINTS, ARM_RAY, HAND_RAY_MODES, HAND_RAY_DEFAULT, normalizeHandRay, headForward, shoulderPoint, RAY_HOLD_MS, PALM_FROM_WRIST,
} from '../../docs/vr-hand.js';
import { createHandInput } from '../../docs/vr-hand-view.js';

// the hand's laser. Three modes (the device setting handRay; ids kept): 'between' = 指先 (from the index fingertip along the index
// finger), 'wrist' = 手のひら (from the palm along the arm / hand axis), 'standard' = 標準 (the system's ray as it is). The pure rays are run here with synthetic
// joints; the view is run with stand-in joints (tests/unit/vr-hand-ray-xr.test.js runs it through three.js' own WebXRController with a synthetic XRFrame).
const D = Math.PI / 180, FRAME = 1000 / 90;
const rotQ = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), deg * D);
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) / D;
const dirOfPose = p => { const v = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p[3], p[4], p[5], p[6])); return [v.x, v.y, v.z]; };
const SYS = () => new Float64Array([0.1, 1.2, -0.2, 0, 0, 0, 1]); // the system's ray: straight ahead (-Z), identity roll
const unit = v => { const l = Math.hypot(...v); return v.map(a => a / l); };
const add = (a, b, k = 1) => a.map((v, i) => v + k * b[i]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// a synthetic right hand in its own frame (wrist at the origin, fingers along -Z, +Y = the back of the hand, -Y = the palm). The index knuckle
// (index-finger-phalanx-proximal) sits at KN; the finger is curled by `curl` degrees in all (MCP 50%, PIP 35%, DIP 15%, toward the palm) and swung `side`
// degrees toward +X at the knuckle. The thumb tip is `gap` metres from the index tip.
const KN = [0.02, 0, -0.09], BONES = [0.045, 0.025, 0.02];
function finger(curl = 15, side = 0) {
  const pts = [KN.slice()]; let a = 0; const sw = side * D;
  [0.5, 0.35, 0.15].forEach((k, i) => { a += curl * k * D; const d = [Math.sin(sw) * Math.cos(a), -Math.sin(a), -Math.cos(sw) * Math.cos(a)]; pts.push(add(pts[i], d, BONES[i])); });
  return { knuckle: pts[0], tip: pts[3] };
}
// the frame's inputs of createFingerRay: joints (hand frame) turned by q and moved by p; w = the wrist pose
function fInputs({ curl = 15, side = 0, gap = 0.06, q = new THREE.Quaternion(), p = [0.1, 1.2, -0.3] } = {}) {
  const f = finger(curl, side), w = v => { const r = new THREE.Vector3(...v).applyQuaternion(q); return [r.x + p[0], r.y + p[1], r.z + p[2]]; };
  const k = w(f.knuckle), t = w(f.tip);
  return { j: new Float64Array([...k, ...t]), w: new Float64Array([...p, q.x, q.y, q.z, q.w]), pd: gap, tip: t, knuckle: k };
}
// runs frames at 90 Hz from `from` to `to` with the inputs f(t); returns the poses (copies)
function fRun(ray, f, from, to, sys = SYS) {
  const out = [];
  for (let t = from; t <= to + 1e-6; t += FRAME) {
    const s = f(t - from), pose = sys(); ray.update(pose, s.j, s.w, s.pd, s.pd < 0.018, t);
    out.push({ t, pose: Float64Array.from(pose), s });
  }
  return out;
}
const settleF = (opts = {}, ms = 500, rayOpt) => { const ray = createFingerRay(rayOpt); const seq = fRun(ray, () => fInputs(opts), 0, ms); return { ray, last: seq[seq.length - 1].pose, s: fInputs(opts) }; };
// a pinch: open (gap 6 cm, curl 15) until t0, then over dur ms the thumb closes to 1 cm while the index curls to 55 deg (its tip moves toward the thumb)
const closing = (t, t0 = 500, dur = 150) => { const k = Math.max(0, Math.min(1, (t - t0) / dur)); return { gap: 0.06 - 0.05 * k, curl: 15 + 40 * k }; };

describe('the setting: three modes, 指先 by default, anything else reads as the default', () => {
  it('modes and default (ids kept, so stored settings keep their meaning)', () => {
    expect(HAND_RAY_MODES).toEqual(['between', 'wrist', 'standard']); expect(HAND_RAY_DEFAULT).toBe('between');
    for (const m of HAND_RAY_MODES) expect(normalizeHandRay(m)).toBe(m);
    for (const bad of [undefined, null, '', 'x', 1, {}, 'Between']) expect(normalizeHandRay(bad)).toBe('between');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('persists in the device settings (app-settings.js): default between, stored under vrl.settings.v1, read back after a reload; a stored bad value reads as between', async () => {
    const load = async stored => {
      vi.resetModules();
      const store = new Map(stored === undefined ? [] : [['vrl.settings.v1', JSON.stringify(stored)]]);
      vi.stubGlobal('localStorage', { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) });
      return { mod: await import('../../docs/app-settings.js'), store };
    };
    const { mod, store } = await load();
    expect(mod.SETTINGS_DEFAULTS.handRay).toBe('between'); expect(mod.settings.get('handRay')).toBe('between');
    mod.settings.set('handRay', 'wrist');
    expect(JSON.parse(store.get('vrl.settings.v1')).handRay).toBe('wrist');
    const again = await load(JSON.parse(store.get('vrl.settings.v1')));
    expect(again.mod.settings.get('handRay')).toBe('wrist');
    const old = await load({ gpuSide: 768 }); expect(old.mod.settings.get('handRay')).toBe('between'); // settings saved before the entry: the default
    const bad = await load({ handRay: 'laser' }); expect(normalizeHandRay(bad.mod.settings.get('handRay'))).toBe('between');
  });
});

describe('指先 (between): from the index fingertip along the index finger', () => {
  it('origin = the index-finger-tip joint, direction = index-finger-phalanx-proximal (knuckle) -> tip; no thumb in it', () => {
    expect(FINGER_JOINTS).toEqual(['index-finger-phalanx-proximal', 'index-finger-tip']);
    for (const opts of [{}, { curl: 30, side: 10 }, { curl: 5, side: -15, q: rotQ([1, 1, 0], 30) }]) {
      const { last, s } = settleF(opts);
      expect(dist(last, s.tip)).toBeLessThan(0.001);
      expect(angleBetween(dirOfPose(last), unit(add(s.tip, s.knuckle, -1)))).toBeLessThan(0.2);
    }
    // the thumb (anywhere outside the pinch zone) changes nothing
    const a = settleF({ gap: 0.05 }).last, b = settleF({ gap: 0.09 }).last;
    expect(dist(a, b)).toBeLessThan(1e-9); expect(angleBetween(dirOfPose(a), dirOfPose(b))).toBeLessThan(1e-6);
  });
  it('pointing with the finger moves the ray, the wrist still: the index swung 20 deg to the side turns the ray ~20 deg, curled 25 deg more turns it down', () => {
    const base = settleF({ curl: 15 }).last, side = settleF({ curl: 15, side: 20 }).last, down = settleF({ curl: 40 }).last;
    expect(angleBetween(dirOfPose(base), dirOfPose(side))).toBeGreaterThan(18); expect(angleBetween(dirOfPose(base), dirOfPose(side))).toBeLessThan(22);
    expect(dirOfPose(down)[1]).toBeLessThan(dirOfPose(base)[1] - 0.15);
  });
  it('a relaxed hand with the thumb 4-6 cm from the index, drifting (outside the pinch zone), follows the finger at once', () => {
    const ray = createFingerRay();
    const seq = fRun(ray, t => fInputs({ gap: 0.05 + 0.01 * Math.sin(t / 200), side: t < 400 ? 0 : 20 }), 0, 800);
    const end = seq[seq.length - 1], want = unit(add(end.s.tip, end.s.knuckle, -1));
    expect(angleBetween(dirOfPose(end.pose), want)).toBeLessThan(0.5);
    expect(FINGER_RAY.preOn).toBeLessThanOrEqual(0.035); expect(ray.frozen).toBe(false);
  });
  it('it follows the hand, not the system ray: a hand turned 25 deg turns the ray 25 deg; a system ray 120 deg away does not pull it back', () => {
    const d0 = dirOfPose(settleF().last);
    for (const [axis, deg] of [[[0, 1, 0], 25], [[1, 0, 0], -20], [[0, 0, 1], 30], [[1, 1, 0], 15]]) {
      const q = rotQ(axis, deg), d1 = dirOfPose(settleF({ q }).last), v = new THREE.Vector3(...d0).applyQuaternion(q);
      expect(angleBetween(d1, [v.x, v.y, v.z])).toBeLessThan(0.3);
    }
    const q120 = rotQ([0, 1, 0], 120), sys = () => { const p = SYS(); p[3] = q120.x; p[4] = q120.y; p[5] = q120.z; p[6] = q120.w; return p; };
    const ray = createFingerRay(), seq = fRun(ray, () => fInputs(), 0, 500, sys), s = fInputs();
    expect(angleBetween(dirOfPose(seq[seq.length - 1].pose), unit(add(s.tip, s.knuckle, -1)))).toBeLessThan(0.2);
  });
  it('light filtering: under 10 ms of lag at normal speeds (origin 0.3 m/s, direction 60 deg/s)', () => {
    const speed = 0.3, rate = 60, at = t => fInputs({ q: rotQ([0, 1, 0], rate * t / 1000), p: [0.1 + speed * t / 1000, 1.2, -0.3] });
    const seq = fRun(createFingerRay(), at, 0, 1500), last = seq[seq.length - 1], s = at(last.t);
    expect(dist(last.pose, s.tip) / speed * 1000).toBeLessThan(10);
    expect(angleBetween(dirOfPose(last.pose), unit(add(s.tip, s.knuckle, -1))) / rate * 1000).toBeLessThan(10);
  });
  it('rest jitter (±0.5 mm of joint noise) is smoothed below what goes in', () => {
    const ray = createFingerRay(); let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const dirs = [], raw = [], base = fInputs();
    for (let t = 0; t <= 2000; t += FRAME) {
      const j = Float64Array.from(base.j, v => v + rnd() * 0.001), pose = SYS(); ray.update(pose, j, base.w, base.pd, false, t);
      if (t > 500) { dirs.push(dirOfPose(pose)); raw.push(unit([j[3] - j[0], j[4] - j[1], j[5] - j[2]])); }
    }
    const rms = arr => { const m = unit([0, 1, 2].map(i => arr.reduce((a, d) => a + d[i], 0) / arr.length)); return Math.sqrt(arr.reduce((a, d) => a + angleBetween(d, m) ** 2, 0) / arr.length); };
    expect(rms(dirs)).toBeLessThan(rms(raw)); expect(rms(dirs)).toBeLessThan(0.5);
  });
  it('pinch onset does not jump: the thumb closing while the index curls (the live line turns ~25 deg, the tip moves ~2 cm) leaves the ray where the finger pointed', () => {
    const run = report => {
      const ray = createFingerRay(), seq = [];
      for (let t = 0; t <= 1100; t += FRAME) { const c = closing(t), s = fInputs(c), pose = SYS(); ray.update(pose, s.j, s.w, report ? s.pd : NaN, report && s.pd < 0.018, t); seq.push({ t, pose: Float64Array.from(pose), s }); }
      const ref = seq.find(x => x.t > 450).pose;
      return seq.map(x => ({ t: x.t, dev: angleBetween(dirOfPose(x.pose), dirOfPose(ref)), move: dist(x.pose, ref), pd: x.s.pd }));
    };
    const held = run(true), free = run(false); // free: the gap / press not reported (control)
    expect(Math.max(...free.filter(x => x.t > 760).map(x => x.dev))).toBeGreaterThan(15);
    expect(Math.max(...held.filter(x => x.t > 450).map(x => x.dev))).toBeLessThan(5); // the first frames of the closing, before it is noticed
    expect(Math.max(...held.filter(x => x.t > 700).map(x => x.dev))).toBeLessThan(1); // held: where the finger pointed before the closing
    expect(Math.max(...held.filter(x => x.t > 450).map(x => x.move))).toBeLessThan(0.01); expect(Math.max(...held.filter(x => x.t > 700).map(x => x.move))).toBeLessThan(0.002);
    expect(held.find(x => x.pd < 0.018)).toBeTruthy(); // the hand did pinch (the press fired inside the hold)
  });
  it('the held ray moves and turns with the WRIST: after the onset a 20 deg turn of the hand turns it 20 deg', () => {
    const ray = createFingerRay(), f = t => ({ ...closing(t), q: t < 900 ? new THREE.Quaternion() : rotQ([0, 1, 0], Math.min(20, 20 * (t - 900) / 200)) });
    const seq = fRun(ray, t => fInputs(f(t)), 0, 1700), a = dirOfPose(seq.find(x => x.t > 880).pose), b = dirOfPose(seq[seq.length - 1].pose);
    expect(angleBetween(a, b)).toBeGreaterThan(19); expect(angleBetween(a, b)).toBeLessThan(21);
  });
  it('a quick second pinch (the double pinch) keeps the same hold: the ray does not move between the two', () => {
    const g = t => (t < 400 ? 0.06 : t < 550 ? 0.06 - 0.05 * (t - 400) / 150 : t < 650 ? 0.01 : t < 700 ? 0.01 + 0.04 * (t - 650) / 50 : t < 750 ? 0.05 : t < 800 ? 0.05 - 0.04 * (t - 750) / 50 : 0.01);
    const seq = fRun(createFingerRay(), t => fInputs({ gap: g(t), curl: 15 + 40 * (0.06 - g(t)) / 0.05 }), 0, 1000), ref = dirOfPose(seq.find(x => x.t > 380).pose);
    expect(Math.max(...seq.filter(x => x.t > 380).map(x => angleBetween(dirOfPose(x.pose), ref)))).toBeLessThan(5); expect(Math.max(...seq.filter(x => x.t > 600).map(x => angleBetween(dirOfPose(x.pose), ref)))).toBeLessThan(1);
  });
  it('after the fingers open the ray eases back to the live finger line (no stuck hold)', () => {
    const g = t => (t < 400 ? 0.06 : t < 550 ? 0.06 - 0.05 * (t - 400) / 150 : t < 800 ? 0.01 : t < 900 ? 0.01 + 0.05 * (t - 800) / 100 : 0.06);
    const seq = fRun(createFingerRay(), t => fInputs({ gap: g(t), curl: 15 + 40 * (0.06 - g(t)) / 0.05, side: t > 1000 ? 15 : 0 }), 0, 1800), end = seq[seq.length - 1];
    expect(angleBetween(dirOfPose(end.pose), unit(add(end.s.tip, end.s.knuckle, -1)))).toBeLessThan(0.5); expect(dist(end.pose, end.s.tip)).toBeLessThan(0.001);
  });
  it('no wrist pose: no hold (the live finger line, never a NaN)', () => {
    const ray = createFingerRay(), seq = fRun(ray, t => ({ ...fInputs(closing(t)), w: new Float64Array(7).fill(NaN) }), 0, 1000), end = seq[seq.length - 1];
    expect([...end.pose].every(Number.isFinite)).toBe(true); expect(angleBetween(dirOfPose(end.pose), unit(add(end.s.tip, end.s.knuckle, -1)))).toBeLessThan(0.5);
  });
  it('a chord too short or a lost joint: the system ray, reached by a cross-fade (no one-frame jump)', () => {
    const base = fInputs(), short = { ...base, j: Float64Array.from([...base.j.slice(0, 3), ...add([...base.j.slice(0, 3)], [0.005, 0, 0])]) };
    const seq = fRun(createFingerRay(), t => (t < 300 ? base : short), 0, 700), before = seq.find(x => x.t > 290 && x.t < 300 + FRAME).pose, first = seq.find(x => x.t >= 300).pose, end = seq[seq.length - 1].pose;
    expect(angleBetween(dirOfPose(first), dirOfPose(before))).toBeLessThan(15); expect(dist(first, before)).toBeLessThan(0.04); // one frame of a 100 ms cross-fade
    expect(angleBetween(dirOfPose(end), [0, 0, -1])).toBeLessThan(1e-4); expect(dist(end, SYS())).toBeLessThan(1e-6);
  });
  it('NaN guards: a lost joint, a NaN wrist, NaN pd, a NaN time or pose never reach the output; the previous state survives', () => {
    const ray = createFingerRay(), base = fInputs(), all = p => [...p].every(Number.isFinite);
    let pose; for (let t = 0; t <= 300; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.w, base.pd, false, t); }
    const good = Float64Array.from(pose);
    for (let k = 0; k < 6; k++) { const j = Float64Array.from(base.j); j[k] = NaN; const p = SYS(); ray.update(p, j, base.w, base.pd, false, 310); expect(all(p)).toBe(true); }
    const w = Float64Array.from(base.w); w[5] = NaN; let p = SYS(); ray.update(p, base.j, w, base.pd, false, 320); expect(all(p)).toBe(true);
    p = SYS(); ray.update(p, base.j, new Float64Array([0, 0, 0, 0, 0, 0, 0]), base.pd, false, 330); expect(all(p)).toBe(true); // a zero quaternion
    p = SYS(); ray.update(p, base.j, base.w, NaN, false, 340); expect(all(p)).toBe(true);
    p = SYS(); ray.update(p, base.j, base.w, base.pd, false, NaN); expect([...p]).toEqual([...SYS()]);
    p = SYS(); p[3] = NaN; ray.update(p, base.j, base.w, base.pd, false, 350); expect(Object.is(p[3], NaN)).toBe(true);
    for (let t = 400; t <= 700; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.w, base.pd, false, t); }
    expect(all(pose)).toBe(true); expect(angleBetween(dirOfPose(pose), dirOfPose(good))).toBeLessThan(0.5);
  });
  it('dropout: the joints missing for a moment fade to the system ray; after a long loss it comes back clean; no allocation (the pose given is the one written)', () => {
    const ray = createFingerRay(), base = fInputs(), nan = new Float64Array(6).fill(NaN);
    let pose; for (let t = 0; t <= 300; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.w, base.pd, false, t); }
    for (let t = 300 + FRAME; t <= 700; t += FRAME) { pose = SYS(); ray.update(pose, nan, base.w, base.pd, false, t); }
    expect(dist(pose, SYS())).toBeLessThan(1e-6); expect(ray.weight).toBe(0);
    for (let t = 700 + FRAME; t <= 1100; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.w, base.pd, false, t); }
    expect(dist(pose, base.tip)).toBeLessThan(0.001);
    const p = SYS(); expect(ray.update(p, base.j, base.w, base.pd, false, 1200)).toBe(p); expect(RAY_HOLD_MS).toBe(200);
  });
});
describe('createArmRay: from the wrist along the arm (shoulder -> wrist)', () => {
  const HEAD = [0, 1.6, 0], hq = (yaw = 0, pitch = 0, roll = 0) => { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D, yaw * D, roll * D, 'YXZ')); return new Float64Array([q.x, q.y, q.z, q.w]); };
  const WR = [0.25, 1.2, -0.35]; // a right wrist in front of the body
  const armRun = (ray, wf, from, to, o = {}) => {
    const out = []; for (let t = from; t <= to + 1e-6; t += FRAME) {
      const pose = SYS(), w = wf(t - from), pd = o.pd ? o.pd(t - from) : 0.1; ray.update(pose, w, o.head || HEAD, o.hq || hq(), o.side ?? 1, pd, o.pressed ? o.pressed(t - from) : false, t); out.push({ t, pose: Float64Array.from(pose) });
    } return out;
  };
  it('the shoulder: 0.18 m below the head, 0.17 m toward the hand side, using the head yaw only', () => {
    const fw = [0, 0]; expect(headForward(hq(0), fw)).toBe(true); expect(fw[1]).toBeCloseTo(-1, 6);
    const sh = [0, 0, 0]; shoulderPoint(HEAD, fw, 1, sh); expect(sh[0]).toBeCloseTo(0.17, 6); expect(sh[1]).toBeCloseTo(1.42, 6); expect(sh[2]).toBeCloseTo(0, 6);
    shoulderPoint(HEAD, fw, -1, sh); expect(sh[0]).toBeCloseTo(-0.17, 6);
    headForward(hq(90), fw); shoulderPoint(HEAD, fw, 1, sh); expect(sh[2]).toBeCloseTo(-0.17, 6); // turned to -X: the right side is now -Z
    expect(ARM_RAY.neckDown).toBe(0.18); expect(ARM_RAY.shoulderSide).toBe(0.17);
  });
  it('origin = the wrist; direction = normalize(wrist - shoulder), whatever the hand does', () => {
    const seq = armRun(createArmRay(), () => WR, 0, 500), last = seq[seq.length - 1].pose;
    expect(Math.hypot(last[0] - WR[0], last[1] - WR[1], last[2] - WR[2])).toBeLessThan(1e-9);
    const want = unit([WR[0] - 0.17, WR[1] - 1.42, WR[2] - 0]);
    expect(angleBetween(dirOfPose(last), want)).toBeLessThan(0.05);
  });
  it('bending the hand at the wrist does not move it: the ray reads the wrist position only (a wrist that stays still keeps the ray still, whatever the fingers do)', () => {
    const ray = createArmRay(), seq = armRun(ray, () => WR, 0, 800), a = dirOfPose(seq[seq.length - 1].pose);
    const ray2 = createArmRay(), seq2 = armRun(ray2, () => WR, 0, 800, { pd: t => 0.1 + 0.05 * Math.sin(t / 100) });
    expect(angleBetween(a, dirOfPose(seq2[seq2.length - 1].pose))).toBeLessThan(1.5); // (only the pinch-freeze window could differ; the position is the same)
    expect(ray.update.length).toBe(8); // the arguments: no hand orientation, no finger joints
  });
  it('the head: nodding / tilting does not turn the ray; turning the head (yaw) moves the shoulder; the left hand uses the other side', () => {
    const dir = (q, side = 1, wr = WR) => { const seq = armRun(createArmRay(), () => wr, 0, 300, { hq: q, side }); return dirOfPose(seq[seq.length - 1].pose); };
    const d0 = dir(hq(0));
    expect(angleBetween(d0, dir(hq(0, 40, 0)))).toBeLessThan(0.05); expect(angleBetween(d0, dir(hq(0, -50, 0)))).toBeLessThan(0.05); expect(angleBetween(d0, dir(hq(0, 0, 30)))).toBeLessThan(0.05);
    expect(angleBetween(d0, dir(hq(30)))).toBeGreaterThan(0.5);
    const wl = [-0.25, 1.2, -0.35], dl = dir(hq(0), -1, wl); expect(dl[0]).toBeLessThan(0); // mirrored: left of the body
    expect(dl[0]).toBeCloseTo(-d0[0], 4); // and the mirror image of the right hand's
    expect(angleBetween(dir(hq(0), 0), d0)).toBeLessThan(0.05); // side unknown: taken from which side of the head the wrist is
  });
  it('the arm moves the ray one to one (the wrist swings 0.2 m to the side: the ray follows the line to the shoulder), with light filtering', () => {
    const seq = armRun(createArmRay(), t => [WR[0] + 0.2 * Math.min(1, t / 400), WR[1], WR[2]], 0, 1000), last = seq[seq.length - 1].pose;
    expect(angleBetween(dirOfPose(last), unit([0.45 - 0.17, WR[1] - 1.42, WR[2]]))).toBeLessThan(0.1);
  });
  it('light filter: under 10 ms of lag at normal speed (0.3 m/s)', () => {
    const ray = createArmRay(); let last;
    const v = 0.3, at = t => [WR[0] + v * t / 1000, WR[1], WR[2]];
    for (let t = 0; t <= 1500; t += FRAME) { last = SYS(); ray.update(last, at(t), HEAD, hq(), 1, 0.1, false, t); }
    const t1 = Math.floor(1500 / FRAME) * FRAME; expect(Math.abs(last[0] - at(t1)[0]) / v * 1000).toBeLessThan(10);
  });
  it('pinch onset: the direction is held for ~120 ms while the wrist moves, then eased back to the live arm line', () => {
    const ray = createArmRay(), move = t => [WR[0] + (t < 600 ? 0 : 0.1 * Math.min(1, (t - 600) / 100)), WR[1], WR[2]]; // the wrist drifts 10 cm while the pinch closes
    const seq = armRun(ray, move, 0, 1200, { pd: t => (t < 600 ? 0.1 : 0.03) });
    const before = dirOfPose(seq.find(x => x.t > 580).pose), inFreeze = seq.filter(x => x.t > 610 && x.t < 700);
    expect(Math.max(...inFreeze.map(x => angleBetween(dirOfPose(x.pose), before)))).toBeLessThan(1.0);
    const live = unit([0.35 - 0.17, WR[1] - 1.42, WR[2]]);
    expect(angleBetween(dirOfPose(seq[seq.length - 1].pose), live)).toBeLessThan(0.3); // not stuck
    expect(ARM_RAY.freezeMs).toBeGreaterThanOrEqual(100); expect(ARM_RAY.freezeMs).toBeLessThanOrEqual(150);
  });
  it('NaN guards and fallback: a NaN wrist / head / head orientation gives the system ray (never a NaN); a bad system pose or time is left alone', () => {
    const base = (w, h, q, side = 1) => { const ray = createArmRay(); let p; for (let t = 0; t <= 400; t += FRAME) { p = SYS(); ray.update(p, t < 100 ? WR : w, t < 100 ? HEAD : h, t < 100 ? hq() : q, side, 0.1, false, t); } return p; };
    for (const p of [base([NaN, 1, 1], HEAD, hq()), base(WR, [0, NaN, 0], hq()), base(WR, HEAD, new Float64Array([NaN, 0, 0, 1])), base(WR, HEAD, new Float64Array([0, 0, 0, 0])), base([Infinity, 1, 1], HEAD, hq())]) {
      expect([...p].every(Number.isFinite)).toBe(true); expect(angleBetween(dirOfPose(p), [0, 0, -1])).toBeLessThan(1e-3); expect(Math.abs(p[0] - 0.1)).toBeLessThan(1e-6);
    }
    const ray = createArmRay(); let p = SYS(); ray.update(p, WR, HEAD, hq(), 1, 0.1, false, NaN); expect([...p]).toEqual([...SYS()]);
    p = SYS(); p[4] = NaN; ray.update(p, WR, HEAD, hq(), 1, 0.1, false, 0); expect(Object.is(p[4], NaN)).toBe(true);
    expect(headForward(null, [0, 0])).toBe(false); expect(headForward([NaN, 0, 0, 1], [0, 0])).toBe(false); expect(headForward([0, 0, 0, 0], [0, 0])).toBe(false);
  });
  it('dropout: a wrist lost for a moment fades to the system ray; it comes back clean after a long loss', () => {
    const ray = createArmRay(); let p;
    for (let t = 0; t <= 300; t += FRAME) { p = SYS(); ray.update(p, WR, HEAD, hq(), 1, 0.1, false, t); }
    const live = Float64Array.from(p);
    for (let t = 300 + FRAME; t <= 700; t += FRAME) { p = SYS(); ray.update(p, [NaN, NaN, NaN], HEAD, hq(), 1, 0.1, false, t); }
    expect(angleBetween(dirOfPose(p), [0, 0, -1])).toBeLessThan(1e-3);
    for (let t = 700 + FRAME; t <= 1100; t += FRAME) { p = SYS(); ray.update(p, WR, HEAD, hq(), 1, 0.1, false, t); }
    expect(angleBetween(dirOfPose(p), dirOfPose(live))).toBeLessThan(0.3);
  });
});

// ---- 手のひら ----
describe('手のひら (wrist): from the centre of the palm along the arm / hand axis (wrist -> middle knuckle)', () => {
  const W = [0.2, 1.2, -0.3], K = add(W, [0.02, 0.03, -0.09]), WQ = [0, 0, 0, 1], wp = (p = W, q = WQ) => new Float64Array([...p, ...q]);
  const settle = (w, kp, ms = 600, sys = SYS) => { const ray = createPalmRay(); let p; for (let t = 0; t <= ms; t += FRAME) { p = sys(); ray.update(p, w, kp, t); } return { p, ray }; };
  it('direction = normalize(knuckle - wrist); origin = the palm centre (PALM_FROM_WRIST toward the knuckle) moved 1.5 cm to the palm side (wrist -Y)', () => {
    const { p } = settle(wp(), K), f = unit([0.02, 0.03, -0.09]);
    expect(angleBetween(dirOfPose(p), f)).toBeLessThan(0.1);
    const want = add(add(W, [0.02, 0.03, -0.09], PALM_FROM_WRIST), [0, -PALM_RAY.palmSide, 0]);
    expect(dist(p, want)).toBeLessThan(1e-3); expect(PALM_RAY.palmSide).toBeCloseTo(0.015, 6);
    // the palm side follows the wrist's turn: palm turned to face left (+90 deg about -Z, fingers still ahead): the offset goes to -X
    const q = rotQ([0, 0, 1], 90), r = settle(wp(W, [q.x, q.y, q.z, q.w]), K).p;
    expect(dist(r, add(add(W, [0.02, 0.03, -0.09], PALM_FROM_WRIST), [PALM_RAY.palmSide, 0, 0]))).toBeLessThan(1e-3);
    expect([...p].every(Number.isFinite)).toBe(true);
  });
  it('the hand / arm turning turns the ray one to one; a system ray 120 deg away does not pull it back', () => {
    const q = rotQ([0, 1, 0], 30), v = new THREE.Vector3(0.02, 0.03, -0.09).applyQuaternion(q), a = settle(wp(), K).p, b = settle(wp(), add(W, [v.x, v.y, v.z])).p;
    expect(angleBetween(dirOfPose(a), dirOfPose(b))).toBeCloseTo(angleBetween([0.02, 0.03, -0.09], [v.x, v.y, v.z]), 0);
    const q120 = rotQ([0, 1, 0], 120), c = settle(wp(), K, 600, () => { const s = SYS(); s[3] = q120.x; s[4] = q120.y; s[5] = q120.z; s[6] = q120.w; return s; }).p;
    expect(angleBetween(dirOfPose(c), unit([0.02, 0.03, -0.09]))).toBeLessThan(0.1);
  });
  it('no wrist orientation: the palm centre without the side offset; NaN / too short input: the system ray, never a NaN; a bad system pose or time is left alone', () => {
    const { p } = settle(wp(W, [NaN, NaN, NaN, NaN]), K); expect(dist(p, add(W, [0.02, 0.03, -0.09], PALM_FROM_WRIST))).toBeLessThan(1e-3);
    for (const [w, kp] of [[wp([NaN, 1, 1]), K], [wp(), [NaN, NaN, NaN]], [wp(), add(W, [0.001, 0, 0])]]) {
      const r = settle(w, kp, 300).p; expect([...r].every(Number.isFinite)).toBe(true); expect(angleBetween(dirOfPose(r), [0, 0, -1])).toBeLessThan(1e-6);
    }
    const ray = createPalmRay(), bad = SYS(); bad[1] = NaN; ray.update(bad, wp(), K, 0); expect(Number.isNaN(bad[1])).toBe(true);
    const ok = SYS(); ray.update(ok, wp(), K, NaN); expect(Array.from(ok)).toEqual(Array.from(SYS()));
  });
  it('fades in from the system ray (no jump) and fades out when the joints are lost; a long loss restarts clean', () => {
    const ray = createPalmRay(); let p = SYS(); ray.update(p, wp(), K, 0); p = SYS(); ray.update(p, wp(), K, FRAME);
    expect(angleBetween(dirOfPose(p), [0, 0, -1])).toBeLessThan(5);
    for (let t = 2 * FRAME; t < 400; t += FRAME) { p = SYS(); ray.update(p, wp(), K, t); }
    expect(ray.weight).toBe(1);
    for (let t = 400; t < 500; t += FRAME) { p = SYS(); ray.update(p, wp([NaN, 0, 0]), K, t); }
    expect(ray.weight).toBeLessThan(1); expect([...p].every(Number.isFinite)).toBe(true);
    for (let t = 500; t < 1200; t += FRAME) { p = SYS(); ray.update(p, wp([NaN, 0, 0]), K, t); }
    expect(angleBetween(dirOfPose(p), [0, 0, -1])).toBeLessThan(1e-6);
  });
  it('the 手のひら laser is visible in the view source: at least 8 cm long and opaque for a hand in that mode', () => {
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toMatch(/wristRay\?Math\.max\(dist,0\.08\)/); expect(src).toMatch(/opacity=wristRay\?0\.8:0\.35/);
  });
});

// ---- the view: createHandInput run with stand-in joints (real three.js objects, no WebXR) ----
describe('the view: each mode on the group, the standard ray untouched (also through a pinch), controllers unaffected', () => {
  const OFF = [0.1, 1.2, -0.3], SYSP = [0.1, 1.2, -0.2];
  function setup(mode) {
    const stubs = { canvas: { width: 0, height: 0, getContext: () => ({ clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {}, measureText: () => ({ width: 10 }) }) } };
    vi.stubGlobal('document', { createElement: () => stubs.canvas });
    const joints = {}, mk = (name, p) => { const o = new THREE.Object3D(); o.visible = true; o.position.set(...p); o.updateMatrix(); joints[name] = o; };
    const pose = (gap = 0.06, curl = 15) => { const f = finger(curl); mk('index-finger-phalanx-proximal', add(f.knuckle, OFF)); mk('index-finger-tip', add(f.tip, OFF)); mk('thumb-tip', add(add(f.tip, OFF), [-gap, 0, 0])); };
    pose(); mk('wrist', OFF); mk('middle-finger-phalanx-proximal', add(OFF, [0.02, 0.03, -0.09]));
    const c = new THREE.Group(); c.matrixAutoUpdate = false; c.visible = true; c.userData.source = { hand: {}, handedness: 'right' };
    const scene = new THREE.Scene(), cur = { mode };
    scene.add(c);
    const renderer = { xr: { getHand: () => ({ joints }) } };
    const hi = createHandInput(THREE, { renderer, scene, controllers: [c], ja: true, getHead: () => new THREE.Vector3(0, 1.6, 0), getHeadQ: () => new THREE.Quaternion(), rayMode: () => cur.mode, colorOf: () => 0xffffff, release() {}, handInHolder: () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }), sectionOn: () => false, avail: () => true, grab: () => true, ungrab() {}, busy: () => false, near: () => null });
    hi.connect(c, 0);
    const events = [];
    for (const t of ['selectstart', 'selectend']) c.addEventListener(t, e => { hi.eventPose(c, e); if (e.handPinch) events.push([t, c.matrix.clone()]); });
    let sysQ = new THREE.Quaternion();
    // what three.js does every frame: the target ray pose into the group's matrix (matrixAutoUpdate off), visible = a pose exists
    const writeSys = (vis = true) => { if (vis) { c.matrix.compose(new THREE.Vector3(...SYSP), sysQ, new THREE.Vector3(1, 1, 1)); c.matrix.decompose(c.position, c.quaternion, c.scale); } c.visible = vis; };
    const frame = (t, o = {}) => { if (o.gap !== undefined) pose(o.gap, o.curl ?? 15); writeSys(o.visible ?? true); vi.spyOn(performance, 'now').mockReturnValue(t); hi.frame(t); c.updateMatrixWorld(true); };
    const sysMatrix = () => new THREE.Matrix4().compose(new THREE.Vector3(...SYSP), sysQ, new THREE.Vector3(1, 1, 1));
    return { c, hi, frame, cur, joints, events, writeSys, sysMatrix, setSysQ: q => { sysQ = q; } };
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const dirOf = c => { const v = new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld); return [v.x, v.y, v.z]; };
  const posOf = c => new THREE.Vector3().setFromMatrixPosition(c.matrixWorld).toArray();
  const settle = (s, from = 0, ms = 600) => { for (let t = from; t <= from + ms; t += FRAME) s.frame(t); };
  const same = (a, b) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-12);

  it('standard: the system ray as it is, every frame: idle, through an own pinch with a turning wrist, a system select, after the release, and while the system drops it', () => {
    const s = setup('standard'); settle(s);
    expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true);
    // an own pinch (thumb closes) while the system ray turns: the group always equals the system ray of that frame (no carry, no blend)
    let t = 700;
    for (let i = 0; i < 40; i++, t += FRAME) { s.setSysQ(rotQ([0, 1, 0], i)); s.frame(t, { gap: i < 10 ? 0.06 : 0.01, curl: i < 10 ? 15 : 55 }); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); }
    expect(s.events.map(e => e[0])).toEqual(['selectstart']);
    expect(same(s.events[0][1], s.sysMatrix().clone().compose(new THREE.Vector3(...SYSP), rotQ([0, 1, 0], 11), new THREE.Vector3(1, 1, 1))) || s.events[0][1].elements.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < 20; i++, t += FRAME) { s.setSysQ(rotQ([0, 1, 0], 40 - i)); s.frame(t, { gap: 0.06 }); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true); }
    expect(s.events.map(e => e[0])).toEqual(['selectstart', 'selectend']);
    // the system's own select: three writes the event frame's pose, then dispatches; the group keeps exactly that pose
    s.setSysQ(rotQ([1, 0, 0], 12)); s.writeSys(); s.c.dispatchEvent({ type: 'selectstart', data: s.c.userData.source }); expect(same(s.c.matrix, s.sysMatrix())).toBe(true);
    s.writeSys(); s.c.dispatchEvent({ type: 'selectend', data: s.c.userData.source }); expect(same(s.c.matrix, s.sysMatrix())).toBe(true);
    // the system drops the ray: the group is hidden as the system's is (no hold shown)
    t += 500; s.frame(t, { visible: false }); expect(s.c.visible).toBe(false);
  });
  it('指先 (between, the default and a bad value): from the index fingertip along the index finger', () => {
    for (const m of ['between', 'garbage']) {
      const s = setup(m); settle(s);
      const f = finger(15);
      expect(dist(posOf(s.c), add(f.tip, OFF))).toBeLessThan(0.001);
      expect(angleBetween(dirOf(s.c), unit(add(f.tip, f.knuckle, -1)))).toBeLessThan(0.3);
    }
  });
  it('手のひら (wrist): visible, from the palm centre (palm side), along wrist -> middle knuckle; turning the hand turns the ray', () => {
    const s = setup('wrist'); settle(s);
    const fwd = unit([0.02, 0.03, -0.09]);
    expect(s.c.visible).toBe(true);
    expect(angleBetween(dirOf(s.c), fwd)).toBeLessThan(0.1);
    expect(dist(posOf(s.c), add(add(OFF, [0.02, 0.03, -0.09], PALM_FROM_WRIST), [0, -0.015, 0]))).toBeLessThan(1e-3);
    const k = s.joints['middle-finger-phalanx-proximal']; k.position.set(OFF[0] + 0.09, OFF[1], OFF[2] - 0.02); k.updateMatrix();
    settle(s, 700);
    expect(angleBetween(dirOf(s.c), unit([0.09, 0, -0.02]))).toBeLessThan(0.2);
  });
  it('the setting is read every frame: a change takes effect at once (the joint modes fade in from the system ray); back to standard = the system ray exactly', () => {
    const s = setup('standard'); settle(s, 0, 300);
    s.cur.mode = 'wrist'; s.frame(310);
    expect(angleBetween(dirOf(s.c), [0, 0, -1])).toBeLessThan(5);
    settle(s, 320, 480);
    expect(angleBetween(dirOf(s.c), [0, 0, -1])).toBeGreaterThan(5);
    s.cur.mode = 'between'; settle(s, 900); expect(dist(posOf(s.c), add(finger(15).tip, OFF))).toBeLessThan(0.001);
    s.cur.mode = 'standard'; s.frame(1600); expect(same(s.c.matrixWorld, s.sysMatrix())).toBe(true);
  });
  it('a missing joint falls back to the system ray; tracking NaN never reaches the group', () => {
    for (const m of ['between', 'wrist']) {
      const s = setup(m); settle(s, 0, 300);
      s.joints['index-finger-tip'].visible = false; s.joints.wrist.visible = false;
      settle(s, 400, 500);
      expect(s.c.matrixWorld.elements.every(Number.isFinite)).toBe(true);
      expect(angleBetween(dirOf(s.c), [0, 0, -1])).toBeLessThan(1e-3);
    }
  });
  it('a controller is not touched: the hand code never runs for it (no hs)', () => {
    const s = setup('between'); s.c.userData.source = { gamepad: {}, handedness: 'right' }; delete s.c.userData.hs;
    s.c.matrix.compose(new THREE.Vector3(0.3, 1, -0.5), new THREE.Quaternion(0, 0.3826834, 0, 0.9238795), new THREE.Vector3(1, 1, 1));
    const m = s.c.matrix.clone(); s.hi.frame(0); s.hi.frame(20);
    expect(same(s.c.matrix, m)).toBe(true);
  });
});

describe('the sources: where the setting lives, one behaviour, controllers and debug switches left alone', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const hv = readFileSync(new URL('../../docs/vr-hand-view.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../../docs/ui-shell.js', import.meta.url), 'utf8');
  const sui = readFileSync(new URL('../../docs/settings-ui.js', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('../../docs/i18n.js', import.meta.url), 'utf8');
  const dbg = readFileSync(new URL('../../docs/debug-switches-ui.js', import.meta.url), 'utf8') + readFileSync(new URL('../../docs/debug-flags.js', import.meta.url), 'utf8');
  it('the VR menu 表示 tab shows 「ハンドのレーザー」 (指先 / 手のひら / 標準) only with hands; with controllers the two controller lines stay', () => {
    expect(src).toContain("hrT:'ハンドのレーザー',hrV:['指先','手のひら','標準']"); expect(src).toContain("hrT:'Hand laser',hrV:['Fingertip','Palm','Standard']");
    expect(src).toContain('if(handIn.anyHand())choice(yb-100,L.hrT,L.hrV.map((t,i)=>({label:t,value:HAND_RAY_MODES[i]})),handRayMode(),v=>setHandRayMode(v));');
    expect(src).toContain("else{label(X,yb-96,L.menuKey,");
    expect(src).toContain("normalizeHandRay(globalThis.__vrlSettings?.get?.('handRay'))"); expect(src).toContain("globalThis.__vrlSettings?.set?.('handRay',normalizeHandRay(v))");
    expect(src).not.toMatch(/指の間|手首から/);
  });
  it('the page: 設定 > 描画 has the same choice (ハンドのレーザー), bound to the same key; the labels exist in Japanese and English', () => {
    expect(shell).toContain('id="set-hand-ray"'); expect(shell).toContain('value="between"'); expect(shell).toContain('value="wrist"'); expect(shell).toContain('value="standard"');
    expect(sui).toContain("bind('set-hand-ray','handRay',false)"); expect(sui).toContain("put('set-hand-ray',v.handRay)");
    for (const k of ['setHandRay', 'handRayBetween', 'handRayWrist', 'handRayStandard', 'setHandRayNote']) expect(i18n.match(new RegExp(k + ':', 'g'))).toHaveLength(2);
    expect(i18n).toContain("handRayBetween:'指先',handRayWrist:'手のひら',handRayStandard:'標準'"); expect(i18n).toContain("handRayBetween:'Fingertip',handRayWrist:'Palm',handRayStandard:'Standard'");
    expect(i18n).not.toMatch(/指の間|手首から/);
  });
  it('not a debug switch', () => { expect(dbg).not.toMatch(/handRay|hand-ray/); });
  it('the view: one handRay step per frame for 指先 / 手のひら; 標準 never writes the group (no apply, no carry, no hold shown, no rewrite at a select event)', () => {
    expect(hv).toContain("hs.has=true;if(std(hs))c.updateMatrixWorld(true);else{handRay(c,hs,r,now);apply(c,shownPose(hs))}");
    expect(hv).toContain("if(hs.mode==='between'){"); expect(hv).toContain("else if(hs.mode==='wrist'){");
    expect(hv).toContain('const show=(c,hs)=>{if(std(hs))c.updateMatrixWorld(true);else apply(c,shownPose(hs))};');
    expect(hv).toContain('if(carryOn&&!std(hs)&&'); expect(hv).toContain('if(!real){hs.held=inHold;if(std(hs))return true;');
    expect(hv).toContain('inHold=!real&&hs.has&&now-hs.rayAt<=RAY_HOLD_MS');
    expect(hv.match(/handRay\(/g)).toHaveLength(1); expect(hv).toContain('const handRay=(c,hs,r,now)=>{');
    expect(hv.match(/apply\(c,shownPose\(hs\)\)/g)).toHaveLength(3); // show(), the 指先 / 手のひら write in tick, the held ray: all behind a standard check
  });
});
