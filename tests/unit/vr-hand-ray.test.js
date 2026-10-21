import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  createBisectorRay, createArmRay, createPalmRay, PALM_RAY, BISECTOR, BISECTOR_JOINTS, ARM_RAY, HAND_RAY_MODES, HAND_RAY_DEFAULT, normalizeHandRay, headForward, shoulderPoint, RAY_HOLD_MS,
} from '../../docs/vr-hand.js';
import { createHandInput } from '../../docs/vr-hand-view.js';

// the hand's laser. Three modes (the device setting handRay): 'between' (the bisector of the thumb and index axes, from the gap), 'wrist' (shoulder -> wrist, along the arm),
// 'standard' (the system's ray as it is). The pure rays are run here with synthetic joints; the view is run with stand-in joints.
const D = Math.PI / 180, FRAME = 1000 / 90;
const rotQ = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), deg * D);
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) / D;
const dirOfPose = p => { const v = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p[3], p[4], p[5], p[6])); return [v.x, v.y, v.z]; };
const SYS = () => new Float64Array([0.1, 1.2, -0.2, 0, 0, 0, 1]); // the system's ray: straight ahead (-Z), identity roll
const unit = v => { const l = Math.hypot(...v); return v.map(a => a / l); };
const add = (a, b, k = 1) => a.map((v, i) => v + k * b[i]);

// a synthetic hand in its own frame (wrist at the origin, fingers along -Z, +Y = the back of the hand). The index points `idxDeg` to the +X side; the thumb is
// `open` degrees away from the index (a V) and touches the index tip at open = 0. Joint order = BISECTOR_JOINTS.
const IDX_DEG = 10, METAI = [0.02, 0, -0.04], METAT = [-0.03, 0, -0.03];
const xz = deg => [Math.sin(deg * D), 0, -Math.cos(deg * D)];
const tipI = add(METAI, xz(IDX_DEG), 0.10);
const toTip = add(tipI, METAT, -1), LT = Math.hypot(...toTip), T1 = Math.atan2(toTip[0], -toTip[2]) / D; // the thumb's direction when it touches the index tip
function handJoints(open, tilt = 0) {
  const di = xz(IDX_DEG), dt = xz(T1 - open);
  const j = {
    'index-finger-metacarpal': METAI, 'index-finger-phalanx-intermediate': add(METAI, di, 0.07), 'thumb-metacarpal': METAT, 'thumb-phalanx-distal': add(METAT, dt, 0.8 * LT),
    'index-finger-tip': add(METAI, di, 0.10), 'thumb-tip': add(METAT, dt, LT), 'index-finger-phalanx-proximal': add(METAI, di, 0.04), 'thumb-phalanx-proximal': add(METAT, dt, 0.45 * LT),
  };
  void tilt;
  return j;
}
// the frame's inputs of createBisectorRay from joints (hand frame) turned by q and moved by p
function inputs(open, q = new THREE.Quaternion(), p = [0.1, 1.2, -0.3]) {
  const j = handJoints(open), flat = new Float64Array(24);
  BISECTOR_JOINTS.forEach((n, i) => { const v = new THREE.Vector3(...j[n]).applyQuaternion(q); flat[3 * i] = v.x + p[0]; flat[3 * i + 1] = v.y + p[1]; flat[3 * i + 2] = v.z + p[2]; });
  const a = j['index-finger-tip'], b = j['thumb-tip'];
  return { j: flat, wq: new Float64Array([q.x, q.y, q.z, q.w]), pd: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) };
}
// runs `ms` of frames at 90 Hz with (open, q, p) given by f(t); returns the poses (copies) and the last time
function run(ray, f, from, to, sys = SYS, now0 = 0) {
  const out = [];
  for (let t = from; t <= to + 1e-6; t += FRAME) {
    const s = f(t - from), pose = sys(), pressed = s.pd < 0.018;
    ray.update(pose, s.j, s.wq, s.pd, pressed, now0 + t);
    out.push({ t, pose: Float64Array.from(pose), pd: s.pd });
  }
  return out;
}

describe('the setting: three modes, 指の間 by default, anything else reads as the default', () => {
  it('modes and default', () => {
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

describe('指の間: the bisector of the thumb and index axes, from the gap', () => {
  it('the direction follows the INDEX FINGERTIP (metacarpal -> tip, plus 15% of the thumb axis); the origin rides the index tip (30% toward the thumb tip)', () => {
    const s = inputs(30), ray = createBisectorRay(); let last;
    for (let t = 0; t <= 400; t += FRAME) { last = SYS(); ray.update(last, s.j, s.wq, s.pd, false, t); }
    const j = handJoints(30), v = (a, b) => unit(add(j[b], j[a], -1));
    const want = unit(add(v('index-finger-metacarpal', 'index-finger-tip'), v('thumb-metacarpal', 'thumb-phalanx-distal'), BISECTOR.thumbW));
    expect(angleBetween(dirOfPose(last), want)).toBeLessThan(0.2);
    const org = [0, 1, 2].map(i => j['index-finger-tip'][i] + 0.3 * (j['thumb-tip'][i] - j['index-finger-tip'][i]) + [0.1, 1.2, -0.3][i]);
    expect(Math.hypot(last[0] - org[0], last[1] - org[1], last[2] - org[2])).toBeLessThan(0.002);
  });
  it('pointing the fingertip moves the ray (the wrist still): the index swung 20 deg to the side turns the ray ~17+ deg, 10 deg up turns it too', () => {
    const settle = tipOff => {
      const s = inputs(30), ray = createBisectorRay(); let last;
      const j = Float64Array.from(s.j); for (let i = 0; i < 3; i++) j[12 + i] += tipOff[i]; // the index tip moved (the other joints stay)
      for (let t = 0; t <= 600; t += FRAME) { last = SYS(); ray.update(last, j, s.wq, s.pd, false, t); }
      return { d: dirOfPose(last), p: [last[0], last[1], last[2]] };
    };
    const base = settle([0, 0, 0]);
    const side = settle([-0.04, 0, 0.01]), up = settle([0, 0.04, 0.01]);
    expect(angleBetween(base.d, side.d)).toBeGreaterThan(12); expect(angleBetween(base.d, up.d)).toBeGreaterThan(12);
    expect(side.d.every(Number.isFinite) && up.d.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...[0, 1, 2].map(i => side.p[i] - base.p[i]))).toBeGreaterThan(0.02); // the origin follows the tip too
  });
  it('the ray is far from the system ray when the hand is turned (it follows the hand, not the shoulder): a hand turned 25 deg turns the ray 25 deg, the system ray staying put', () => {
    const settle = q => { const ray = createBisectorRay(), s = inputs(30, q); let last; for (let t = 0; t <= 500; t += FRAME) { last = SYS(); ray.update(last, s.j, s.wq, s.pd, false, t); } return dirOfPose(last); };
    const d0 = settle(new THREE.Quaternion());
    for (const [axis, deg] of [[[0, 1, 0], 25], [[1, 0, 0], -20], [[0, 0, 1], 30], [[1, 1, 0], 15]]) {
      const q = rotQ(axis, deg), d1 = settle(q), expected = (() => { const v = new THREE.Vector3(...d0).applyQuaternion(q); return [v.x, v.y, v.z]; })();
      expect(angleBetween(d1, expected)).toBeLessThan(0.3); // exactly the hand's turn
      if (axis[1] === 1 && axis[0] === 0) expect(angleBetween(d0, d1)).toBeCloseTo(25, 0);
    }
  });
  it('light filtering: under 10 ms of lag at normal speeds (origin 0.3 m/s, direction 60 deg/s)', () => {
    const ray = createBisectorRay();
    const speed = 0.3, rate = 60; // m/s, deg/s
    let last, t1;
    for (let t = 0; t <= 1500; t += FRAME) {
      const q = rotQ([0, 1, 0], rate * t / 1000), s = inputs(30, q, [0.1 + speed * t / 1000, 1.2, -0.3]);
      last = SYS(); ray.update(last, s.j, s.wq, s.pd, false, t); t1 = t;
    }
    const q = rotQ([0, 1, 0], rate * t1 / 1000), s = inputs(30, q, [0.1 + speed * t1 / 1000, 1.2, -0.3]), ideal = SYS();
    const ref = createBisectorRay(); // the unfiltered target: the same frame, settled
    let lastRef; for (let k = 0; k < 80; k++) { lastRef = SYS(); ref.update(lastRef, s.j, s.wq, s.pd, false, 10000 + k * FRAME); }
    // the target (not the filter) is the geometry of the last frame: compare with a hand held still at that frame
    const lagMsPos = Math.abs(last[0] - lastRef[0]) / speed * 1000, lagMsDir = angleBetween(dirOfPose(last), dirOfPose(lastRef)) / rate * 1000;
    expect(lagMsPos).toBeLessThan(10); expect(lagMsDir).toBeLessThan(10); void ideal;
  });
  it('rest jitter (±0.5 mm of joint noise) is smoothed below what goes in', () => {
    const ray = createBisectorRay(); let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const dirs = [], base = inputs(30);
    for (let t = 0; t <= 2000; t += FRAME) {
      const j = Float64Array.from(base.j, v => v + rnd() * 0.001), pose = SYS(); ray.update(pose, j, base.wq, base.pd, false, t); if (t > 500) dirs.push(dirOfPose(pose));
    }
    const mean = unit([0, 1, 2].map(i => dirs.reduce((a, d) => a + d[i], 0) / dirs.length));
    const rms = Math.sqrt(dirs.reduce((a, d) => a + angleBetween(d, mean) ** 2, 0) / dirs.length);
    const inRay = createBisectorRay(); void inRay;
    expect(rms).toBeLessThan(0.35); // degrees
  });

  it('pinch onset does not swing the ray: closing the thumb (the live ray turns ~4.5 deg: the index tip does the pointing) leaves the ray where it was aimed', () => {
    const closing = (opts, press = true) => {
      const ray = createBisectorRay(opts), seq = [];
      for (let t = 0; t <= 1100; t += FRAME) { const s = inputs(t < 500 ? 35 : Math.max(0, 35 * (1 - (t - 500) / 150))), pose = SYS(); ray.update(pose, s.j, s.wq, press ? s.pd : NaN, press && s.pd < 0.018, t); seq.push({ t, pose: Float64Array.from(pose), pd: s.pd }); }
      const ref = dirOfPose(seq[40].pose);
      return seq.map(x => ({ t: x.t, dev: angleBetween(dirOfPose(x.pose), ref), pd: x.pd }));
    };
    const withFreeze = closing(), noFreeze = closing({}, false); // the gap / press not reported: never frozen (control)
    const settled = withFreeze.filter(x => x.t > 760), settledFree = noFreeze.filter(x => x.t > 760);
    expect(Math.max(...settledFree.map(x => x.dev))).toBeGreaterThan(3); // without the freeze the live ray still swings away a little (the thumb's 15% share; control)
    expect(Math.max(...settled.map(x => x.dev))).toBeLessThan(1.5); // frozen (in the wrist's frame) from freezeMs before the closing was noticed
    expect(Math.max(...withFreeze.filter(x => x.t > 200).map(x => x.dev))).toBeLessThan(8); // and never swings far on the way
    expect(withFreeze.find(x => x.pd < 0.018)).toBeTruthy(); // the hand did pinch (the press fired inside the freeze)
  });
  it('the frozen direction turns with the WRIST (not with the fingers): after the onset, a wrist turn of 20 deg turns the ray 20 deg', () => {
    const ray = createBisectorRay();
    const f = t => { const open = t < 500 ? 35 : Math.max(0, 35 * (1 - (t - 500) / 150)), q = t < 900 ? new THREE.Quaternion() : rotQ([0, 1, 0], Math.min(20, 20 * (t - 900) / 200)); return inputs(open, q); };
    const seq = run(ray, f, 0, 1700), a = dirOfPose(seq.find(x => x.t > 880).pose), b = dirOfPose(seq[seq.length - 1].pose);
    expect(angleBetween(a, b)).toBeGreaterThan(19); expect(angleBetween(a, b)).toBeLessThan(21);
  });
  it('a quick second pinch (the double pinch) keeps the same freeze: the ray does not move between the two', () => {
    const ray = createBisectorRay(), open = t => (t < 400 ? 35 : t < 550 ? 35 * (1 - (t - 400) / 150) : t < 650 ? 0 : t < 700 ? 12 * (t - 650) / 50 : t < 750 ? 12 : t < 800 ? 12 * (1 - (t - 750) / 50) : 0);
    const seq = run(ray, t => inputs(open(t)), 0, 1000), ref = dirOfPose(seq.find(x => x.t > 600).pose);
    expect(Math.max(...seq.filter(x => x.t > 600).map(x => angleBetween(dirOfPose(x.pose), ref)))).toBeLessThan(1.5);
  });
  it('after the fingers open the ray eases back to the live bisector (no stuck freeze)', () => {
    const ray = createBisectorRay(), open = t => (t < 400 ? 35 : t < 550 ? 35 * (1 - (t - 400) / 150) : t < 800 ? 0 : t < 900 ? 35 * (t - 800) / 100 : 35);
    const seq = run(ray, t => inputs(open(t)), 0, 1800), s = inputs(35), live = createBisectorRay(); let l;
    for (let t = 0; t < 600; t += FRAME) { l = SYS(); live.update(l, s.j, s.wq, s.pd, false, 20000 + t); }
    expect(angleBetween(dirOfPose(seq[seq.length - 1].pose), dirOfPose(l))).toBeLessThan(0.5);
  });

  it('degenerate: the thumb and index axes opposite (the sum ~ 0), a chord too short, the bisector > 90 deg from the system ray: the system ray, reached by a cross-fade', () => {
    const base = inputs(30);
    const settle = (mut, sys) => { const ray = createBisectorRay(); let last; for (let t = 0; t <= 400; t += FRAME) { last = (sys || SYS)(); const s = t < 150 ? base : mut(); ray.update(last, s.j, s.wq, s.pd, false, t); } return last; };
    const opp = () => { const j = Float64Array.from(base.j), c = BISECTOR_JOINTS.indexOf('thumb-phalanx-distal'), m = BISECTOR_JOINTS.indexOf('thumb-metacarpal'); for (let k = 0; k < 3; k++) j[3 * c + k] = j[3 * m + k] + 0.002; return { ...base, j }; }; // a thumb chord too short
    const short = () => { const j = Float64Array.from(base.j), a = BISECTOR_JOINTS.indexOf('index-finger-tip'), b = BISECTOR_JOINTS.indexOf('index-finger-metacarpal'); for (let k = 0; k < 3; k++) j[3 * a + k] = j[3 * b + k] + 0.002; return { ...base, j }; }; // an index chord too short
    for (const mut of [opp, short]) { const last = settle(mut); expect(Math.abs(last[0] - 0.1) + Math.abs(last[1] - 1.2) + Math.abs(last[2] + 0.2)).toBeLessThan(1e-6); expect(angleBetween(dirOfPose(last), [0, 0, -1])).toBeLessThan(1e-4); }
    const last = settle(() => base, () => new Float64Array([0.1, 1.2, -0.2, 0, 1, 0, 0])); // the system ray points +Z (180 deg turned): more than 90 deg from the bisector
    expect(angleBetween(dirOfPose(last), [0, 0, 1])).toBeLessThan(1e-4);
  });
  it('degenerate input fades: the ray does not jump to the system ray in one frame', () => {
    const ray = createBisectorRay(), base = inputs(30); let before, first;
    for (let t = 0; t <= 300; t += FRAME) { before = SYS(); ray.update(before, base.j, base.wq, base.pd, false, t); }
    const bad = Float64Array.from(base.j); bad[0] = NaN; first = SYS(); ray.update(first, bad, base.wq, base.pd, false, 300 + FRAME);
    expect(angleBetween(dirOfPose(first), dirOfPose(before))).toBeLessThan(15); expect(Math.abs(first[0] - before[0])).toBeLessThan(0.03);
  });

  it('NaN guards: a lost joint, a NaN wrist, NaN pd, a NaN / Infinity time or pose never reach the output; the previous state survives', () => {
    const ray = createBisectorRay(), base = inputs(30), all = p => [...p].every(Number.isFinite);
    let pose; for (let t = 0; t <= 300; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.wq, base.pd, false, t); }
    const good = Float64Array.from(pose);
    for (let k = 0; k < 24; k++) { const j = Float64Array.from(base.j); j[k] = NaN; const p = SYS(); ray.update(p, j, base.wq, base.pd, false, 310); expect(all(p)).toBe(true); }
    const wq = Float64Array.from(base.wq); wq[2] = NaN; let p = SYS(); ray.update(p, base.j, wq, base.pd, false, 320); expect(all(p)).toBe(true);
    p = SYS(); ray.update(p, base.j, new Float64Array([0, 0, 0, 0]), base.pd, false, 330); expect(all(p)).toBe(true); // a zero quaternion
    p = SYS(); ray.update(p, base.j, base.wq, NaN, false, 340); expect(all(p)).toBe(true);
    p = SYS(); ray.update(p, base.j, base.wq, base.pd, false, NaN); expect([...p]).toEqual([...SYS()]); // no time: the pose as given
    p = SYS(); p[3] = NaN; const keep = Float64Array.from(p); ray.update(p, base.j, base.wq, base.pd, false, 350); expect(Object.is(p[3], NaN)).toBe(true); expect([...p].slice(0, 3)).toEqual([...keep].slice(0, 3)); // a bad system pose is left alone
    // after all that the ray still works and is not poisoned by a NaN
    for (let t = 400; t <= 700; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.wq, base.pd, false, t); }
    expect(all(pose)).toBe(true); expect(angleBetween(dirOfPose(pose), dirOfPose(good))).toBeLessThan(0.5);
  });
  it('dropout: the joints missing for a moment fade to the system ray, and a long loss restarts the ray (nothing stale comes back)', () => {
    const ray = createBisectorRay(), base = inputs(30), nan = new Float64Array(24).fill(NaN);
    let pose; for (let t = 0; t <= 300; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.wq, base.pd, false, t); }
    const live = Float64Array.from(pose);
    for (let t = 300 + FRAME; t <= 700; t += FRAME) { pose = SYS(); ray.update(pose, nan, base.wq, base.pd, false, t); }
    expect(angleBetween(dirOfPose(pose), [0, 0, -1])).toBeLessThan(1e-3); expect(Math.abs(pose[0] - 0.1)).toBeLessThan(1e-6); // the system ray
    expect(ray.weight).toBe(0);
    for (let t = 700 + FRAME; t <= 1100; t += FRAME) { pose = SYS(); ray.update(pose, base.j, base.wq, base.pd, false, t); }
    expect(angleBetween(dirOfPose(pose), dirOfPose(live))).toBeLessThan(0.5); expect([...pose].every(Number.isFinite)).toBe(true); // back, no jump from a stale filter
    expect(RAY_HOLD_MS).toBe(200); // the view still holds the system's last ray that long (vr-hand-view.js)
  });
  it('no allocation per update: the arrays are reused (the pose given is the one written)', () => {
    const ray = createBisectorRay(), base = inputs(30), pose = SYS(); const r = ray.update(pose, base.j, base.wq, base.pd, false, 0);
    expect(r).toBe(pose); expect(BISECTOR.freezeMs).toBeGreaterThanOrEqual(100); expect(BISECTOR.freezeMs).toBeLessThanOrEqual(150);
  });
});

describe('手首から: from the wrist along the arm (shoulder -> wrist)', () => {
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

// ---- the view: createHandInput run with stand-in joints (real three.js objects, no WebXR) ----
describe('手首から: from the wrist along the palm forward axis (wrist -> knuckles)', () => {
  const W = [0.2, 1.2, -0.3], K = add(W, [0.02, 0.03, -0.09]);
  const settle = (wp, kp, ms = 600) => { const ray = createPalmRay(); let p; for (let t = 0; t <= ms; t += FRAME) { p = SYS(); ray.update(p, wp, kp, t); } return { p, ray }; };
  it('direction = normalize(knuckle - wrist), origin = the wrist pushed originFwd along it; finite and rolled like the system ray', () => {
    const { p } = settle(W, K), f = unit([0.02, 0.03, -0.09]);
    expect(angleBetween(dirOfPose(p), f)).toBeLessThan(0.1);
    expect(Math.hypot(p[0] - (W[0] + PALM_RAY.originFwd * f[0]), p[1] - (W[1] + PALM_RAY.originFwd * f[1]), p[2] - (W[2] + PALM_RAY.originFwd * f[2]))).toBeLessThan(1e-3);
    expect([...p].every(Number.isFinite)).toBe(true);
  });
  it('rotating the wrist moves the ray one to one (palm turned 30 deg about the vertical -> ray turned 30 deg)', () => {
    const q = rotQ([0, 1, 0], 30), v = new THREE.Vector3(0.02, 0.03, -0.09).applyQuaternion(q), a = settle(W, K).p, b = settle(W, add(W, [v.x, v.y, v.z])).p;
    expect(angleBetween(dirOfPose(a), dirOfPose(b))).toBeCloseTo(angleBetween([0.02, 0.03, -0.09], [v.x, v.y, v.z]), 0);
  });
  it('NaN / missing / too short input: the system ray, never a NaN; a bad system pose or time is left alone', () => {
    for (const [wp, kp] of [[[NaN, 1, 1], K], [W, [NaN, NaN, NaN]], [W, add(W, [0.001, 0, 0])]]) {
      const { p } = settle(wp, kp, 300); expect([...p].every(Number.isFinite)).toBe(true); expect(angleBetween(dirOfPose(p), [0, 0, -1])).toBeLessThan(1e-6);
    }
    const ray = createPalmRay(), bad = SYS(); bad[1] = NaN; ray.update(bad, W, K, 0); expect(Number.isNaN(bad[1])).toBe(true);
    const ok = SYS(); ray.update(ok, W, K, NaN); expect(Array.from(ok)).toEqual(Array.from(SYS()));
  });
  it('fades in from the system ray (no jump) and fades out when the joints are lost; a long loss restarts clean', () => {
    const ray = createPalmRay(); let p = SYS(); ray.update(p, W, K, 0); p = SYS(); ray.update(p, W, K, FRAME);
    expect(angleBetween(dirOfPose(p), [0, 0, -1])).toBeLessThan(5);
    for (let t = 2 * FRAME; t < 400; t += FRAME) { p = SYS(); ray.update(p, W, K, t); }
    expect(ray.weight).toBe(1);
    for (let t = 400; t < 500; t += FRAME) { p = SYS(); ray.update(p, [NaN, 0, 0], K, t); }
    expect(ray.weight).toBeLessThan(1); expect([...p].every(Number.isFinite)).toBe(true);
    for (let t = 500; t < 1200; t += FRAME) { p = SYS(); ray.update(p, [NaN, 0, 0], K, t); }
    expect(angleBetween(dirOfPose(p), [0, 0, -1])).toBeLessThan(1e-6);
  });
  it('wrist mode is visible in the view source: the laser is at least 8 cm long and opaque for a hand in wrist mode', () => {
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toMatch(/wristRay\?Math\.max\(dist,0\.08\)/); expect(src).toMatch(/opacity=wristRay\?0\.8:0\.35/);
  });
});

describe('the view: each mode on the group, the standard ray untouched, controllers unaffected', () => {
  function setup(mode) {
    const stubs = { canvas: { width: 0, height: 0, getContext: () => ({ clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {}, measureText: () => ({ width: 10 }) }) } };
    vi.stubGlobal('document', { createElement: () => stubs.canvas });
    const joints = {}, mk = (name, p) => { const o = new THREE.Object3D(); o.visible = true; o.position.set(...p); o.updateMatrix(); joints[name] = o; };
    const j = handJoints(30), off = [0.1, 1.2, -0.3];
    for (const n of BISECTOR_JOINTS) mk(n, add(j[n], off));
    mk('wrist', off); mk('middle-finger-phalanx-proximal', add(off, [0.02, 0.03, -0.09]));
    const c = new THREE.Group(); c.visible = true; c.userData.source = { hand: {}, handedness: 'right' };
    const scene = new THREE.Scene(), cur = { mode };
    const renderer = { xr: { getHand: () => ({ joints }) } };
    const head = new THREE.Vector3(0, 1.6, 0), hq = new THREE.Quaternion();
    const hi = createHandInput(THREE, { renderer, scene, controllers: [c], ja: true, getHead: () => head, getHeadQ: () => hq, rayMode: () => cur.mode, colorOf: () => 0xffffff, release() {}, handInHolder: () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }), sectionOn: () => false, avail: () => true, grab: () => true, ungrab() {}, busy: () => false, near: () => null });
    hi.connect(c, 0);
    const setSys = () => { c.position.set(0.1, 1.2, -0.2); c.quaternion.identity(); c.matrix.compose(c.position, c.quaternion, new THREE.Vector3(1, 1, 1)); };
    const frame = t => { setSys(); c.visible = true; hi.frame(t); };
    return { c, hi, frame, cur, joints };
  }
  afterEach(() => vi.unstubAllGlobals());
  const dirOf = c => { const v = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion); return [v.x, v.y, v.z]; };
  const settle = (s, ms = 600) => { for (let t = 0; t <= ms; t += FRAME) s.frame(t); };

  it('standard: the system ray as it is (position and direction untouched)', () => {
    const s = setup('standard'); settle(s);
    expect(s.c.position.toArray()).toEqual([0.1, 1.2, -0.2]); expect(angleBetween(dirOf(s.c), [0, 0, -1])).toBeLessThan(1e-9);
  });
  it('between (the default and a bad value): from the gap, along the bisector', () => {
    for (const m of ['between', 'garbage']) {
      const s = setup(m); settle(s);
      const j = handJoints(30), v = (a, b) => unit(add(j[b], j[a], -1)), want = unit(add(v('index-finger-metacarpal', 'index-finger-tip'), v('thumb-metacarpal', 'thumb-phalanx-distal'), BISECTOR.thumbW));
      expect(angleBetween(dirOf(s.c), want)).toBeLessThan(0.3);
      const tm = [0, 1, 2].map(i => j['index-finger-tip'][i] + 0.3 * (j['thumb-tip'][i] - j['index-finger-tip'][i]) + [0.1, 1.2, -0.3][i]);
      expect(Math.hypot(s.c.position.x - tm[0], s.c.position.y - tm[1], s.c.position.z - tm[2])).toBeLessThan(0.01);
    }
  });
  it('wrist: visible and finite, from the wrist (pushed 4 cm out along the ray), along the palm forward axis (wrist -> middle knuckle); turning the hand turns the ray', () => {
    const s = setup('wrist'); settle(s);
    const w = [0.1, 1.2, -0.3], fwd = unit([0.02, 0.03, -0.09]);
    expect(s.c.visible).toBe(true);
    expect([...s.c.position.toArray(), ...s.c.quaternion.toArray()].every(Number.isFinite)).toBe(true);
    expect(angleBetween(dirOf(s.c), fwd)).toBeLessThan(0.1);
    expect(Math.hypot(s.c.position.x - (w[0] + 0.04 * fwd[0]), s.c.position.y - (w[1] + 0.04 * fwd[1]), s.c.position.z - (w[2] + 0.04 * fwd[2]))).toBeLessThan(1e-3);
    const k = s.joints['middle-finger-phalanx-proximal']; k.position.set(w[0] + 0.09, w[1], w[2] - 0.02); k.updateMatrix(); // the wrist turned: the knuckles point to the side
    for (let t = 700; t <= 1300; t += FRAME) s.frame(t);
    expect(angleBetween(dirOf(s.c), unit([0.09, 0, -0.02]))).toBeLessThan(0.2);
  });
  it('the setting is read every frame: changing the mode takes effect at once and fades in from the system ray; no NaN anywhere', () => {
    const s = setup('standard'); settle(s, 300);
    s.cur.mode = 'wrist'; s.frame(310);
    const first = dirOf(s.c); expect(first.every(Number.isFinite)).toBe(true); expect(angleBetween(first, [0, 0, -1])).toBeLessThan(5);
    for (let t = 320; t <= 800; t += FRAME) s.frame(t);
    expect(angleBetween(dirOf(s.c), [0, 0, -1])).toBeGreaterThan(5); // the palm axis differs from the system's here
    s.cur.mode = 'between'; settle(s, 600); expect([...s.c.position.toArray(), ...s.c.quaternion.toArray()].every(Number.isFinite)).toBe(true);
    s.cur.mode = 'standard'; for (let t = 1500; t < 1600; t += FRAME) s.frame(t); expect(s.c.position.toArray()).toEqual([0.1, 1.2, -0.2]);
  });
  it('a missing joint falls back to the system ray (between), a missing wrist too (wrist); tracking NaN never reaches the group', () => {
    for (const m of ['between', 'wrist']) {
      const s = setup(m); settle(s, 300);
      s.joints['thumb-tip'].visible = false; s.joints['wrist'].visible = false; s.joints['index-finger-metacarpal'].visible = false;
      for (let t = 400; t <= 900; t += FRAME) s.frame(t);
      expect([...s.c.position.toArray(), ...s.c.quaternion.toArray()].every(Number.isFinite)).toBe(true);
      expect(angleBetween(dirOf(s.c), [0, 0, -1])).toBeLessThan(1e-3);
    }
  });
  it('a controller is not touched: the hand code never runs for it (no hs)', () => {
    const s = setup('between'); s.c.userData.source = { gamepad: {}, handedness: 'right' }; delete s.c.userData.hs;
    s.c.position.set(0.3, 1, -0.5); s.c.quaternion.set(0, 0.3826834, 0, 0.9238795); s.c.updateMatrix();
    const p = s.c.position.toArray(), q = s.c.quaternion.toArray(); s.hi.frame(0); s.hi.frame(20);
    expect(s.c.position.toArray()).toEqual(p); expect(s.c.quaternion.toArray()).toEqual(q);
  });
});

describe('the sources: where the setting lives, one behaviour, controllers and debug switches left alone', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const hv = readFileSync(new URL('../../docs/vr-hand-view.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../../docs/ui-shell.js', import.meta.url), 'utf8');
  const sui = readFileSync(new URL('../../docs/settings-ui.js', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('../../docs/i18n.js', import.meta.url), 'utf8');
  const dbg = readFileSync(new URL('../../docs/debug-switches-ui.js', import.meta.url), 'utf8') + readFileSync(new URL('../../docs/debug-flags.js', import.meta.url), 'utf8');
  it('the VR menu 表示 tab shows 「ハンドのレーザー」 (指の間 / 手首から / 標準) only with hands; with controllers the two controller lines stay', () => {
    expect(src).toContain("hrT:'ハンドのレーザー',hrV:['指の間','手首から','標準']"); expect(src).toContain("hrT:'Hand laser',hrV:['Between fingers','From wrist','Standard']");
    expect(src).toContain('if(handIn.anyHand())choice(yb-100,L.hrT,L.hrV.map((t,i)=>({label:t,value:HAND_RAY_MODES[i]})),handRayMode(),v=>setHandRayMode(v));');
    expect(src).toContain("else{label(X,yb-96,L.menuKey,");
    expect(src).toContain("normalizeHandRay(globalThis.__vrlSettings?.get?.('handRay'))"); expect(src).toContain("globalThis.__vrlSettings?.set?.('handRay',normalizeHandRay(v))");
  });
  it('the page: 設定 > 描画 has the same choice (ハンドのレーザー), bound to the same key; the labels exist in Japanese and English', () => {
    expect(shell).toContain('id="set-hand-ray"'); expect(shell).toContain('value="between"'); expect(shell).toContain('value="wrist"'); expect(shell).toContain('value="standard"');
    expect(sui).toContain("bind('set-hand-ray','handRay',false)"); expect(sui).toContain("put('set-hand-ray',v.handRay)");
    for (const k of ['setHandRay', 'handRayBetween', 'handRayWrist', 'handRayStandard', 'setHandRayNote']) expect(i18n.match(new RegExp(k + ':', 'g'))).toHaveLength(2);
    expect(i18n).toContain("handRayBetween:'指の間',handRayWrist:'手首から',handRayStandard:'標準'"); expect(i18n).toContain("handRayBetween:'Between fingers',handRayWrist:'From wrist',handRayStandard:'Standard'");
  });
  it('not a debug switch', () => { expect(dbg).not.toMatch(/handRay|hand-ray/); });
  it('the view: one handRay step per frame for a hand, no write for standard; the hold, tracking loss and pinch code stay', () => {
    expect(hv).toContain("handRay(c,hs,r,now);hs.has=true;apply(c,shownPose(hs));");
    expect(hv).toContain("if(mode==='between'){"); expect(hv).toContain("else if(mode==='wrist'){"); expect(hv).not.toContain("mode==='standard'"); // standard = neither branch: the system pose stays in r
    expect(hv).toContain('inHold=!real&&hs.has&&now-hs.rayAt<=RAY_HOLD_MS');
    expect(hv.match(/handRay\(/g)).toHaveLength(1); expect(hv).toContain('const handRay=(c,hs,r,now)=>{'); // the definition and the one call
  });
});
