import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

// vr-hand-view.js run with three.js and stand-in hand joints (no WebXR): the own pinch, its de-duplication with the system select,
// the carried pinch drag, and that a controller in the other slot is never touched.
const q = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8').match(/\.\/vr-hand-view\.js(\?v=[^']+)/)[1];
let createHandInput;
beforeAll(async () => {
  const inert = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : inert), apply: () => inert, set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => inert }) });
  vi.stubGlobal('localStorage', { getItem: k => LS[k] ?? null, setItem() {}, removeItem() {} });
  ({ createHandInput } = await import(/* @vite-ignore */ '../../docs/vr-hand-view.js' + q));
});
afterAll(() => vi.unstubAllGlobals());

const FRAME = 1000 / 72;
const LS = {}; // what the stand-in localStorage answers (the tunables are read once, when the rig is made)
const BONES = { index: [0.068, 0.039, 0.022, 0.018], middle: [0.065, 0.044, 0.026, 0.019], ring: [0.058, 0.041, 0.025, 0.019], pinky: [0.054, 0.032, 0.018, 0.017] };
const BASE_X = { index: 0.02, middle: 0, ring: -0.02, pinky: -0.038 };
const PREFIX = { index: 'index-finger', middle: 'middle-finger', ring: 'ring-finger', pinky: 'pinky-finger' };
const SUFFIX = ['-metacarpal', '-phalanx-proximal', '-phalanx-intermediate', '-phalanx-distal', '-tip'];
const deg = Math.PI / 180;

// a hand in the XR space: wrist at `pos` turned by `rot`; fingers along -Z, back of the hand +Y (WebXR joint axes). bend: [mcp, pip, dip] deg per finger.
// thumbGap: thumb tip - index tip distance (m), the thumb tip placed beside the index tip.
function handPose(joints, { pos = new THREE.Vector3(0.15, 1.1, -0.35), rot = new THREE.Quaternion(), index = [40, 50, 20], others = [35, 50, 25], thumbGap = 0.06 } = {}) {
  const set = (name, local, q = rot) => { const j = joints[name]; j.position.copy(local).applyQuaternion(rot).add(pos); j.quaternion.copy(q); j.updateMatrix(); j.visible = true; };
  set('wrist', new THREE.Vector3());
  let indexTip = null;
  for (const f of Object.keys(BONES)) {
    const bend = f === 'index' ? index : others; let ang = 0; const p = new THREE.Vector3(BASE_X[f], 0, 0);
    set(PREFIX[f] + SUFFIX[0], p);
    for (let i = 0; i < 4; i++) { if (i) ang += bend[i - 1] * deg; p.add(new THREE.Vector3(0, -Math.sin(ang), -Math.cos(ang)).multiplyScalar(BONES[f][i])); set(PREFIX[f] + SUFFIX[i + 1], p, rot.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), i < 3 ? -(ang + bend[i] * deg) : -ang))); } // each joint's -Z along its own bone
    if (f === 'index') indexTip = p.clone();
  }
  set('thumb-tip', indexTip.clone().add(new THREE.Vector3(thumbGap, 0, 0)));
  set('thumb-metacarpal', new THREE.Vector3(0.035, -0.01, -0.02)); // the thumb's base: on the +X side of this stand-in hand (thumbSideOf reads it)
  if (joints.noIndex) for (const n of ['index-finger-metacarpal', 'index-finger-phalanx-proximal']) joints[n].visible = false; // the joint ray's sources lost (the wrist stays: the palm anchor) -> the system ray
}
const JOINTS = ['wrist', 'thumb-tip', 'thumb-metacarpal', ...Object.values(PREFIX).flatMap(f => SUFFIX.map(s => f + s))];
// where the aim ray should be for a hand at pos / rot with the index bent `index` deg at its knuckle: from the second knuckle, along the proximal phalanx
const aimOf = ({ pos = new THREE.Vector3(0.15, 1.1, -0.35), rot = new THREE.Quaternion(), index = [40, 50, 20] } = {}) => {
  const a = index[0] * deg, bone = new THREE.Vector3(0, -Math.sin(a), -Math.cos(a));
  const origin = new THREE.Vector3(BASE_X.index, 0, -BONES.index[0]).add(bone.clone().multiplyScalar(BONES.index[1])).applyQuaternion(rot).add(pos);
  return { origin, dir: bone.applyQuaternion(rot) };
};
// 's ray (vrl-hand-ray axis "metacarpal"): from the first knuckle, along the metacarpal (-Z) tilted 8 deg to the palm (-Y) and 4 deg to the thumb (+X here)
const aimMetaOf = ({ pos = new THREE.Vector3(0.15, 1.1, -0.35), rot = new THREE.Quaternion() } = {}) => {
  const origin = new THREE.Vector3(BASE_X.index, 0, -BONES.index[0]).applyQuaternion(rot).add(pos);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(-8 * deg, -4 * deg, 0, 'YXZ'))).applyQuaternion(rot);
  return { origin, dir };
};
const dirOf = h => new THREE.Vector3(0, 0, -1).applyQuaternion(h.getWorldQuaternion(new THREE.Quaternion()));

function rig(ray = null) {
  if (ray) LS['vrl-hand-ray'] = ray; else delete LS['vrl-hand-ray'];
  const scene = new THREE.Scene(), hands = [0, 1].map(() => ({ joints: Object.fromEntries(JOINTS.map(n => [n, new THREE.Group()])) }));
  const controllers = [0, 1].map(() => { const g = new THREE.Group(); g.matrixAutoUpdate = false; scene.add(g); return g; });
  const events = [], released = [];
  const hi = createHandInput(THREE, {
    renderer: { xr: { getHand: i => hands[i] } }, scene, controllers, ja: true, getHead: () => new THREE.Vector3(0, 1.6, 0), colorOf: () => 0xffffff,
    release: c => { released.push(c); c.userData.press = null; }, handInHolder: c => { const p = new THREE.Vector3(), qq = new THREE.Quaternion(); c.getWorldPosition(p); c.getWorldQuaternion(qq); return { p, q: qq }; },
    sectionOn: () => false, avail: () => true, grab: () => true, ungrab: () => {}, busy: () => false, near: null,
  });
  // vr-view.js's listeners: the pre-hook, then the handlers that a hand reaches only with handPinch (the guards)
  for (const c of controllers) {
    for (const t of ['selectstart', 'selectend']) c.addEventListener(t, e => hi.eventPose(c, e));
    c.addEventListener('selectstart', e => { if (c.userData.source?.hand && (!e.handPinch || hi.grabbing(c) || hi.fistLike(c))) return; const p = new THREE.Vector3(); c.getWorldPosition(p); events.push(['start', controllers.indexOf(c), p.clone()]); c.userData.press = { t0: performance.now(), dragRec: false }; });
    c.addEventListener('selectend', e => { if (c.userData.source?.hand && !e.handPinch) return; events.push(['end', controllers.indexOf(c)]); c.userData.press = null; });
  }
  // slot 0: a right hand; slot 1: a controller
  controllers[0].userData.source = { hand: {}, handedness: 'right' }; hi.connect(controllers[0], 0);
  controllers[1].userData.source = { gamepad: { axes: [], buttons: [] }, handedness: 'left' }; hi.connect(controllers[1], 1);
  // the system's pinch ray (what three writes into the group every frame): from the shoulder through the hand
  const sysRay = new THREE.Matrix4().compose(new THREE.Vector3(0.15, 1.05, -0.45), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.2), new THREE.Vector3(1, 1, 1));
  const ctrlPose = new THREE.Matrix4().compose(new THREE.Vector3(-0.2, 1.0, -0.3), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3), new THREE.Vector3(1, 1, 1));
  let t = 1000;
  const writeRaw = (vis = true) => { const h = controllers[0]; h.matrix.copy(sysRay); h.matrix.decompose(h.position, h.quaternion, h.scale); h.visible = vis; const c = controllers[1]; c.matrix.copy(ctrlPose); c.matrix.decompose(c.position, c.quaternion, c.scale); c.visible = true; c.updateMatrixWorld(true); };
  const frame = opts => { hands[0].joints.noIndex = !!opts?.noIndex; handPose(hands[0].joints, opts); writeRaw(opts?.visible ?? true); t += FRAME; vi.spyOn(performance, 'now').mockReturnValue(t); hi.frame(t); };
  const osEvent = type => { writeRaw(); controllers[0].dispatchEvent({ type, data: controllers[0].userData.source }); };
  return { hi, controllers, events, released, frame, osEvent, sysRay, ctrlPose };
}

describe('vr-hand-view.js: the own pinch and the system select give one press', () => {
  it('fingers close: one selectstart (handPinch) from the own pinch; the system select joining and leaving mid-pinch adds nothing; opening: one selectend', () => {
    const r = rig();
    for (let i = 0; i < 10; i++) r.frame({ thumbGap: 0.06 });
    expect(r.events).toEqual([]);
    r.frame({ thumbGap: 0.01 }); r.frame({ thumbGap: 0.01 });
    expect(r.events.map(e => e.slice(0, 2))).toEqual([['start', 0]]);
    r.osEvent('selectstart'); r.frame({ thumbGap: 0.01 }); r.osEvent('selectend'); r.frame({ thumbGap: 0.012 }); r.osEvent('selectstart');
    for (let i = 0; i < 5; i++) r.frame({ thumbGap: 0.012 });
    expect(r.events.map(e => e.slice(0, 2))).toEqual([['start', 0]]);
    r.frame({ thumbGap: 0.05 }); expect(r.events).toHaveLength(1); r.frame({ thumbGap: 0.05 });
    expect(r.events.map(e => e.slice(0, 2))).toEqual([['start', 0], ['end', 0]]);
    r.osEvent('selectend'); for (let i = 0; i < 5; i++) r.frame({ thumbGap: 0.06 });
    expect(r.events).toHaveLength(2);
  });
  it('a pinch only the system sees (tips read 2.2 cm) still presses and ends with the system select', () => {
    const r = rig();
    for (let i = 0; i < 5; i++) r.frame({ thumbGap: 0.022 });
    r.osEvent('selectstart'); for (let i = 0; i < 5; i++) r.frame({ thumbGap: 0.022 }); r.osEvent('selectend');
    expect(r.events.map(e => e.slice(0, 2))).toEqual([['start', 0], ['end', 0]]);
  });
  it('a pinch with the other fingers tucked presses; a hand closing into a fist does not (then the fist grabs and the pinch stays latched)', () => {
    const r = rig();
    for (let i = 0; i < 4; i++) r.frame({ thumbGap: 0.06, others: [50, 70, 35] });
    for (let i = 0; i < 3; i++) r.frame({ thumbGap: 0.01, others: [50, 70, 35] });
    expect(r.events.map(e => e[0])).toEqual(['start']);
    for (let i = 0; i < 3; i++) r.frame({ thumbGap: 0.06, others: [50, 70, 35] });
    const f = rig();
    for (let i = 0; i < 4; i++) f.frame({ thumbGap: 0.06 });
    for (let i = 0; i < 10; i++) f.frame({ thumbGap: 0.012, index: [70, 90, 50], others: [70, 90, 50] });
    f.osEvent('selectstart');
    expect(f.events).toEqual([]);
  });
});

describe('vr-hand-view.js: no press without the system ray', () => {
  it('a pinch while the system hides the hand ray (palm to the face: the system menu gesture) starts nothing; a press already held goes on (wrist tracked)', () => {
    const r = rig();
    for (let i = 0; i < 4; i++) r.frame({ thumbGap: 0.06, visible: false });
    for (let i = 0; i < 6; i++) r.frame({ thumbGap: 0.01, visible: false });
    expect(r.events).toEqual([]);
    const k = rig();
    for (let i = 0; i < 4; i++) k.frame({ thumbGap: 0.06 });
    for (let i = 0; i < 3; i++) k.frame({ thumbGap: 0.01 });
    for (let i = 0; i < 30; i++) k.frame({ thumbGap: 0.01, visible: false }); // 400 ms without the system ray: no cancel, no end
    expect(k.events.map(e => e[0])).toEqual(['start']); expect(k.released).toEqual([]); expect(k.controllers[0].visible).toBe(true);
    for (let i = 0; i < 2; i++) k.frame({ thumbGap: 0.06, visible: false });
    expect(k.events.map(e => e[0])).toEqual(['start', 'end']);
  });
});

describe('vr-hand-view.js: the carried pinch drag', () => {
  it('at the press the group keeps the ray it had (no jump); then it follows the hand 1:1 and turns with the wrist, whatever the system ray does', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.06 }); // the hand is still: the filtered joint ray converges on it
    r.frame({ thumbGap: 0.01 }); r.frame({ thumbGap: 0.01 });
    const p0 = r.events[0][2], sys = new THREE.Vector3().setFromMatrixPosition(r.sysRay);
    expect(p0.distanceTo(aimOf().origin)).toBeLessThan(1e-3); expect(p0.distanceTo(sys)).toBeGreaterThan(0.02);
    expect(r.hi.dragTh(h, h.userData.press)).not.toBeNull(); // the drag may start at once (no 60 ms wait)
    const q0 = h.getWorldQuaternion(new THREE.Quaternion());
    // the hand moves 3 cm up and the wrist turns 30 deg (a fan stroke) while the system ray stays where it was
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 30 * deg);
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.01, pos: new THREE.Vector3(0.15, 1.13, -0.35), rot: turn });
    const q1 = h.getWorldQuaternion(new THREE.Quaternion());
    expect(q1.angleTo(q0) / deg).toBeCloseTo(30, 0);
    const p1 = h.getWorldPosition(new THREE.Vector3());
    // the ray origin turned with the hand about the palm, then moved 3 cm: compare with the rigid motion of the hand
    const wrist0 = new THREE.Vector3(0.15, 1.1, -0.35), wrist1 = new THREE.Vector3(0.15, 1.13, -0.35);
    const exp = p0.clone().sub(wrist0).applyQuaternion(turn).add(wrist1);
    expect(p1.distanceTo(exp)).toBeLessThan(2e-3);
  });
  it('after the release the group goes back to the aim ray within blendMs (120 ms); with the system ray as the source (joints lost) it goes back to that', () => {
    const r = rig(), h = r.controllers[0], pos = new THREE.Vector3(0.25, 1.1, -0.35);
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.06 });
    for (let i = 0; i < 3; i++) r.frame({ thumbGap: 0.01 });
    for (let i = 0; i < 20; i++) r.frame({ thumbGap: 0.01, pos });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(aimOf().origin)).toBeGreaterThan(0.09); // carried 10 cm away from where the aim ray started
    for (let i = 0; i < 2; i++) r.frame({ thumbGap: 0.06, pos });
    expect(r.events.map(e => e[0])).toEqual(['start', 'end']);
    for (let i = 0; i < 20; i++) r.frame({ thumbGap: 0.08, pos });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(aimOf({ pos }).origin)).toBeLessThan(2e-3); // the aim ray of the hand where it is now
    // the fallback: no index joints -> the system ray, as before
    const f = rig(), g = f.controllers[0], sys = new THREE.Vector3().setFromMatrixPosition(f.sysRay);
    for (let i = 0; i < 40; i++) f.frame({ thumbGap: 0.06, noIndex: true });
    for (let i = 0; i < 3; i++) f.frame({ thumbGap: 0.01, noIndex: true });
    for (let i = 0; i < 20; i++) f.frame({ thumbGap: 0.01, pos, noIndex: true });
    expect(g.getWorldPosition(new THREE.Vector3()).distanceTo(sys)).toBeGreaterThan(0.09);
    for (let i = 0; i < 2; i++) f.frame({ thumbGap: 0.06, pos, noIndex: true });
    for (let i = 0; i < 20; i++) f.frame({ thumbGap: 0.08, pos, noIndex: true });
    expect(g.getWorldPosition(new THREE.Vector3()).distanceTo(sys)).toBeLessThan(2e-3);
  });
  it('the controller in the other slot: its pose is exactly what three wrote, no hand state, no events', () => {
    const r = rig(), c = r.controllers[1];
    for (let i = 0; i < 5; i++) r.frame({ thumbGap: 0.06 });
    for (let i = 0; i < 5; i++) r.frame({ thumbGap: 0.01 });
    expect(c.matrix.equals(r.ctrlPose)).toBe(true); expect(c.userData.hs).toBeUndefined();
    expect(r.events.every(e => e[1] === 0)).toBe(true);
    // a controller's own select reaches the handlers as before (the hand guard is not taken)
    c.dispatchEvent({ type: 'selectstart', data: c.userData.source }); c.dispatchEvent({ type: 'selectend', data: c.userData.source });
    expect(r.events.filter(e => e[1] === 1).map(e => e[0])).toEqual(['start', 'end']);
    expect(c.matrix.equals(r.ctrlPose)).toBe(true);
  });
});

// the hand's own aim ray (the joints), the system's ray only as the fallback
describe('vr-hand-view.js: the joint aim ray', () => {
  it('aims from the second knuckle of the index along its proximal phalanx (no pitch / yaw bias), turns 1:1 with the hand and follows the index bending at its knuckle; the system ray is not used', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05 });
    let e = aimOf();
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(e.origin)).toBeLessThan(1e-3);
    expect(dirOf(h).angleTo(e.dir) / deg).toBeLessThan(0.05);
    expect(dirOf(h).angleTo(new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(r.sysRay))) / deg).toBeGreaterThan(5);
    expect(dirOf(h).angleTo(aimMetaOf().dir) / deg).toBeGreaterThan(30); // not the back of the hand: the index is bent 40 deg at the knuckle
    // the hand turns 25 deg about X and 15 deg about Y and moves: the ray goes with it (unlike the system ray, which is left where it was)
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(25 * deg, 15 * deg, 0)), pos = new THREE.Vector3(0.1, 1.2, -0.4);
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05, rot, pos });
    e = aimOf({ rot, pos });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(e.origin)).toBeLessThan(1e-3);
    expect(dirOf(h).angleTo(e.dir) / deg).toBeLessThan(0.05);
    // the index straightens to 10 deg (slowly: no hold): the ray follows the finger, the middle / ring / little fingers do not matter
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05, rot, pos, index: [Math.max(10, 40 - i), 50, 20], others: [60, 70, 40] });
    e = aimOf({ rot, pos, index: [10, 50, 20] });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(e.origin)).toBeLessThan(1e-3);
    expect(dirOf(h).angleTo(e.dir) / deg).toBeLessThan(0.05);
  });
  it('vrl-hand-ray: axis "metacarpal" gives\'s ray (first knuckle, the metacarpal tilted 8 / 4 deg); origin "knuckle" / "tip"; tipMix 1 aims along the knuckle -> tip line', () => {
    const r = rig('{"axis":"metacarpal"}'), h = r.controllers[0];
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05 });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(aimMetaOf().origin)).toBeLessThan(1e-3); expect(dirOf(h).angleTo(aimMetaOf().dir) / deg).toBeLessThan(0.05);
    const k = rig('{"origin":"knuckle"}'), hk = k.controllers[0];
    for (let i = 0; i < 60; i++) k.frame({ thumbGap: 0.05 });
    expect(hk.getWorldPosition(new THREE.Vector3()).distanceTo(aimMetaOf().origin)).toBeLessThan(1e-3); expect(dirOf(hk).angleTo(aimOf().dir) / deg).toBeLessThan(0.05);
    const t = rig('{"origin":"tip","tipMix":1}'), ht = t.controllers[0];
    for (let i = 0; i < 60; i++) t.frame({ thumbGap: 0.05 });
    const tipP = ht.getWorldPosition(new THREE.Vector3());
    const knuckle = aimMetaOf().origin, tipJ = new THREE.Vector3(); // the fingertip of the stand-in: the knuckle plus the three phalanges at 40 / 90 / 110 deg
    let ang = 0; tipJ.copy(knuckle); for (let i = 1; i < 4; i++) { ang += [40, 50, 20][i - 1] * deg; tipJ.add(new THREE.Vector3(0, -Math.sin(ang), -Math.cos(ang)).multiplyScalar(BONES.index[i])); }
    expect(tipP.distanceTo(tipJ)).toBeLessThan(1e-3);
    expect(dirOf(ht).angleTo(tipJ.clone().sub(knuckle).normalize()) / deg).toBeLessThan(0.05);
  });
  it('the fallback: with the index joints missing the group shows the system ray; the joints back: the aim ray again (each switch is one step, no slew)', () => {
    const r = rig(), h = r.controllers[0], sysP = new THREE.Vector3().setFromMatrixPosition(r.sysRay);
    for (let i = 0; i < 30; i++) r.frame({ thumbGap: 0.05, noIndex: true });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(sysP)).toBeLessThan(1e-3);
    r.frame({ thumbGap: 0.05 });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(aimOf().origin)).toBeLessThan(1e-3); // the first joint frame is taken as it is
    r.frame({ thumbGap: 0.05, noIndex: true });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(sysP)).toBeLessThan(1e-3);
  });
  it('no jump at the pinch start or end: the shown direction moves under 0.3 deg and the origin under 1 mm per frame through a pinch of a still hand', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.05 });
    let maxA = 0, maxP = 0, d0 = dirOf(h), p0 = h.getWorldPosition(new THREE.Vector3());
    const step = o => { r.frame(o); const d = dirOf(h), p = h.getWorldPosition(new THREE.Vector3()); maxA = Math.max(maxA, d.angleTo(d0) / deg); maxP = Math.max(maxP, p.distanceTo(p0)); d0 = d; p0 = p; };
    for (const g of [0.04, 0.025, 0.012, 0.01, 0.01, 0.01, 0.01, 0.01, 0.015, 0.03, 0.05, 0.06]) step({ thumbGap: g });
    for (let i = 0; i < 15; i++) step({ thumbGap: 0.06 });
    expect(r.events.map(e => e[0])).toEqual(['start', 'end']);
    expect(maxA).toBeLessThan(0.3); expect(maxP).toBeLessThan(1e-3);
  });
  it('the aim hold: a hand turning 30 deg/s while the fingers close has turned the ray under half as far at the press; a relaxed gap or an opening hand is never held; the ray catches up after', () => {
    const r = rig(), h = r.controllers[0];
    const at = i => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 30 * deg * i * FRAME / 1000);
    let i = 0;
    for (; i < 60; i++) r.frame({ thumbGap: 0.045, rot: at(i) }); // turning with a relaxed 4.5 cm gap: the ray follows (no hold)
    const lagFree = aimOf({ rot: at(i - 1) }).dir.angleTo(dirOf(h)) / deg;
    expect(lagFree).toBeLessThan(0.5);
    const dStart = dirOf(h), iStart = i;
    for (const g of [0.035, 0.025, 0.015, 0.01, 0.01]) r.frame({ thumbGap: g, rot: at(i++) }); // the pinch closes in 70 ms while the hand keeps turning
    expect(r.events.map(e => e[0])).toEqual(['start']);
    const handTurned = 30 * (i - iStart) * FRAME / 1000, rayTurned = dStart.angleTo(dirOf(h)) / deg;
    expect(handTurned).toBeGreaterThan(1.9); expect(rayTurned).toBeLessThan(handTurned * 0.5); expect(rayTurned).toBeGreaterThan(0.3); // held, not frozen
    for (let k = 0; k < 2; k++) r.frame({ thumbGap: 0.05, rot: at(i++) }); // opens: selectend, the carried ray blends back
    expect(r.events.map(e => e[0])).toEqual(['start', 'end']);
    for (let k = 0; k < 30; k++) r.frame({ thumbGap: 0.05, rot: at(i++) }); // 400 ms on: the hold has ramped out, the ray tracks the turning hand again
    expect(aimOf({ rot: at(i - 1) }).dir.angleTo(dirOf(h)) / deg).toBeLessThan(0.5);
  });
  it('the index curling into a slow pinch (the gap closing under 12 cm/s) holds the ray too: it swings under 2 deg while the finger bends 30 deg; the carry keeps it through the pinch', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.035, index: [20, 40, 20] });
    const d0 = dirOf(h);
    // 8 frames (110 ms): the knuckle bends 20 -> 50 deg (270 deg/s) while the gap closes 3.5 -> 1 cm (~10 cm/s, under the gap trigger)
    for (let i = 1; i <= 8; i++) r.frame({ thumbGap: 0.035 - 0.025 * i / 8, index: [20 + 30 * i / 8, 40, 20] });
    expect(r.events.map(e => e[0])).toEqual(['start']);
    expect(d0.angleTo(dirOf(h)) / deg).toBeLessThan(2); // held (the finger axis alone would have swung 30 deg)
    for (let i = 0; i < 20; i++) r.frame({ thumbGap: 0.01, index: [50, 40, 20] }); // the pinch held: the carried ray stays where the press was
    expect(d0.angleTo(dirOf(h)) / deg).toBeLessThan(2);
    for (let i = 0; i < 2; i++) r.frame({ thumbGap: 0.05, index: [20, 40, 20] });
    expect(r.events.map(e => e[0])).toEqual(['start', 'end']);
    for (let i = 0; i < 30; i++) r.frame({ thumbGap: 0.05, index: [20, 40, 20] }); // opened again: back on the finger within the blend + ramp
    expect(dirOf(h).angleTo(aimOf({ index: [20, 40, 20] }).dir) / deg).toBeLessThan(0.3);
  });
});
