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
// where the ray should be for a hand at pos / rot: from the aim point (the index knuckle, 2 cm on along the metacarpal) along shoulder -> aim point;
// the right shoulder is 0.17 m to the right of and 0.18 m below the head (HEAD, looking along -Z)
const HEAD = new THREE.Vector3(0, 1.6, 0);
const aimOf = ({ pos = new THREE.Vector3(0.15, 1.1, -0.35), rot = new THREE.Quaternion(), head = HEAD, side = 1, fwd = [0, -1] } = {}) => {
  const origin = new THREE.Vector3(BASE_X.index, 0, -BONES.index[0] - 0.02).applyQuaternion(rot).add(pos);
  const sh = new THREE.Vector3(head.x - fwd[1] * side * 0.17, head.y - 0.18, head.z + fwd[0] * side * 0.17);
  return { origin, dir: origin.clone().sub(sh).normalize(), shoulder: sh };
};
const dirOf = h => new THREE.Vector3(0, 0, -1).applyQuaternion(h.getWorldQuaternion(new THREE.Quaternion()));

function rig() {
  const headQ = new THREE.Quaternion(), headPos = HEAD.clone();
  const scene = new THREE.Scene(), hands = [0, 1].map(() => ({ joints: Object.fromEntries(JOINTS.map(n => [n, new THREE.Group()])) }));
  const controllers = [0, 1].map(() => { const g = new THREE.Group(); g.matrixAutoUpdate = false; scene.add(g); return g; });
  const events = [], released = [];
  const hi = createHandInput(THREE, {
    renderer: { xr: { getHand: i => hands[i] } }, scene, controllers, ja: true, getHead: () => headPos, getHeadQuat: () => headQ, colorOf: () => 0xffffff,
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
  return { hi, controllers, events, released, frame, osEvent, sysRay, ctrlPose, headQ, headPos };
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
    for (let i = 0; i < 12; i++) r.frame({ thumbGap: 0.01 }); // the first 120 ms after the press the carried ray stays (the closing fingers still wobble the hand)
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
    for (let i = 0; i < 12; i++) r.frame({ thumbGap: 0.01 }); // (the lock after the press)
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
    for (let i = 0; i < 12; i++) f.frame({ thumbGap: 0.01, noIndex: true });
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

// the standard far-field ray: shoulder (head yaw, down and to the side) -> index knuckle, the system's ray only as the fallback
describe('vr-hand-view.js: the shoulder -> knuckle ray', () => {
  const pos3 = (x, y, z) => new THREE.Vector3(x, y, z), at = h => h.getWorldPosition(new THREE.Vector3());
  it('the group sits at the aim point and looks along shoulder -> aim point, not along the finger, the metacarpal or the system ray; the index curling does not move it', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05 });
    const e = aimOf();
    expect(at(h).distanceTo(e.origin)).toBeLessThan(1e-3); expect(dirOf(h).angleTo(e.dir) / deg).toBeLessThan(0.05);
    expect(dirOf(h).angleTo(new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(r.sysRay))) / deg).toBeGreaterThan(5);
    const d0 = dirOf(h);
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05, index: [Math.min(70, 40 + i), 60, 40], others: [60, 70, 40] }); // the index curls 30 deg more at the knuckle
    expect(dirOf(h).angleTo(d0) / deg).toBeLessThan(0.1); expect(at(h).distanceTo(e.origin)).toBeLessThan(1e-3);
  });
  it('the wrist turning 25 deg and the hand moving: the ray goes through the knuckle from the shoulder (the origin follows the hand; the direction turns about the shoulder, not with the wrist)', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05 });
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(25 * deg, 15 * deg, 0)), pos = pos3(0.1, 1.2, -0.4);
    for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05, rot, pos });
    const e = aimOf({ rot, pos });
    expect(at(h).distanceTo(e.origin)).toBeLessThan(1e-3); expect(dirOf(h).angleTo(e.dir) / deg).toBeLessThan(0.05);
    expect(dirOf(h).angleTo(new THREE.Vector3(0, 0, -1).applyQuaternion(rot)) / deg).toBeGreaterThan(8); // the wrist's own axis is not the ray
  });
  it('the head: nodding and tilting leave the ray alone, turning (yaw) moves the shoulder and so the ray; the left hand uses the left shoulder; the controller slot is unaffected', () => {
    const r = rig(), h = r.controllers[0]; for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05 });
    const d0 = dirOf(h);
    r.headQ.setFromEuler(new THREE.Euler(-50 * deg, 0, 25 * deg, 'YXZ')); for (let i = 0; i < 60; i++) r.frame({ thumbGap: 0.05 });
    expect(dirOf(h).angleTo(d0) / deg).toBeLessThan(0.3);
    r.headQ.setFromEuler(new THREE.Euler(0, 30 * deg, 0, 'YXZ')); for (let i = 0; i < 80; i++) r.frame({ thumbGap: 0.05 });
    const fwd = [-Math.sin(30 * deg), -Math.cos(30 * deg)];
    expect(dirOf(h).angleTo(aimOf({ fwd }).dir) / deg).toBeLessThan(0.1); expect(dirOf(h).angleTo(d0) / deg).toBeGreaterThan(2);
    const l = rig(); l.controllers[0].userData.source.handedness = 'left'; for (let i = 0; i < 60; i++) l.frame({ thumbGap: 0.05 });
    expect(dirOf(l.controllers[0]).angleTo(aimOf({ side: -1 }).dir) / deg).toBeLessThan(0.05);
  });
  it('dropout: the joints missing under 200 ms keep the group exactly where it was; longer: the system ray is blended in; back again: blended out (no step either way)', () => {
    const r = rig(), h = r.controllers[0], sysP = new THREE.Vector3().setFromMatrixPosition(r.sysRay);
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.05 });
    const p0 = at(h), d0 = dirOf(h);
    for (let i = 0; i < 12; i++) { r.frame({ thumbGap: 0.05, noIndex: true }); expect(at(h).distanceTo(p0)).toBeLessThan(1e-9); expect(dirOf(h).angleTo(d0)).toBeLessThan(1e-9); }
    let prev = at(h), maxStep = 0; for (let i = 0; i < 40; i++) { r.frame({ thumbGap: 0.05, noIndex: true }); maxStep = Math.max(maxStep, at(h).distanceTo(prev)); prev = at(h); }
    expect(at(h).distanceTo(sysP)).toBeLessThan(2e-3); expect(maxStep).toBeLessThan(p0.distanceTo(sysP) / 5);
    prev = at(h); maxStep = 0; for (let i = 0; i < 40; i++) { r.frame({ thumbGap: 0.05 }); maxStep = Math.max(maxStep, at(h).distanceTo(prev)); prev = at(h); }
    expect(at(h).distanceTo(aimOf().origin)).toBeLessThan(2e-3); expect(maxStep).toBeLessThan(p0.distanceTo(sysP) / 5);
  });
  it('intermittent dropouts (the index joints missing on every 3rd frame for 1.5 s): the laser never jumps to the system ray', () => {
    const r = rig(), h = r.controllers[0]; for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.05 });
    const e = aimOf(); let maxP = 0;
    for (let i = 0; i < 108; i++) { r.frame({ thumbGap: 0.05, noIndex: i % 3 === 2 }); maxP = Math.max(maxP, at(h).distanceTo(e.origin)); expect(dirOf(h).angleTo(e.dir) / deg).toBeLessThan(0.1); }
    expect(maxP).toBeLessThan(1e-3);
  });
  it('a bad head pose (no orientation callback result) is a dropout, never a NaN group', () => {
    const r = rig(), h = r.controllers[0]; for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.05 });
    r.headQ.set(NaN, 0, 0, 1); for (let i = 0; i < 10; i++) { r.frame({ thumbGap: 0.05 }); expect(Number.isFinite(h.matrix.elements[12])).toBe(true); expect(at(h).distanceTo(aimOf().origin)).toBeLessThan(1e-3); }
  });
  it('no jump at the pinch start or end: the shown direction moves under 0.3 deg and the origin under 1 mm per frame through a pinch of a still hand', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.05 });
    let maxA = 0, maxP = 0, d0 = dirOf(h), p0 = at(h);
    const step = o => { r.frame(o); const d = dirOf(h), p = at(h); maxA = Math.max(maxA, d.angleTo(d0) / deg); maxP = Math.max(maxP, p.distanceTo(p0)); d0 = d; p0 = p; };
    for (const g of [0.04, 0.025, 0.012, 0.01, 0.01, 0.01, 0.01, 0.01, 0.015, 0.03, 0.05, 0.06]) step({ thumbGap: g });
    for (let i = 0; i < 15; i++) step({ thumbGap: 0.06 });
    expect(r.events.map(e => e[0])).toEqual(['start', 'end']);
    expect(maxA).toBeLessThan(0.3); expect(maxP).toBeLessThan(1e-3);
  });
  it('the pinch lock: the hand moving 30 cm/s sideways while the fingers close has turned the ray under half as far at the press (it is held, not frozen); an open hand moving the same way is followed', () => {
    const run = closing => {
      const r = rig(), h = r.controllers[0], x = i => pos3(0.15 + 0.3 * i * FRAME / 1000, 1.1, -0.35); let i = 0;
      for (; i < 40; i++) r.frame({ thumbGap: 0.045, pos: x(i) });
      const d0 = dirOf(h), i0 = i, gaps = closing ? [0.035, 0.025, 0.015, 0.01, 0.01] : [0.045, 0.045, 0.045, 0.045, 0.045];
      for (const g of gaps) r.frame({ thumbGap: g, pos: x(i++) });
      return { turned: d0.angleTo(dirOf(h)) / deg, free: d0.angleTo(aimOf({ pos: x(i - 1) }).dir) / deg, started: r.events.length };
    };
    const c = run(true), o = run(false);
    expect(c.started).toBe(1); expect(o.started).toBe(0); expect(o.free).toBeGreaterThan(1); expect(o.turned).toBeGreaterThan(o.free * 0.8); // open: followed (a few ms behind)
    expect(c.turned).toBeLessThan(o.turned * 0.5); expect(c.turned).toBeGreaterThan(0);
  });
  it('after the press the carried ray stays put for 120 ms (the wobble of the closing fingers is not carried), then follows the hand from there', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.05 });
    r.frame({ thumbGap: 0.01 }); r.frame({ thumbGap: 0.01 }); expect(r.events.map(e => e[0])).toEqual(['start']);
    const p0 = at(h), d0 = dirOf(h), turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 20 * deg), pos = pos3(0.15, 1.15, -0.35);
    for (let i = 0; i < 6; i++) r.frame({ thumbGap: 0.01, pos, rot: turn }); // 83 ms: inside the lock
    expect(at(h).distanceTo(p0)).toBeLessThan(1e-9); expect(dirOf(h).angleTo(d0)).toBeLessThan(1e-9);
    for (let i = 0; i < 8; i++) r.frame({ thumbGap: 0.01, pos, rot: turn }); // the lock is over: the next movement is carried
    const pos2 = pos3(0.15, 1.25, -0.35); for (let i = 0; i < 20; i++) r.frame({ thumbGap: 0.01, pos: pos2, rot: turn });
    expect(at(h).distanceTo(p0)).toBeGreaterThan(0.08); expect(at(h).distanceTo(p0)).toBeLessThan(0.12);
  });
});

// the wrist menu is a compact 3 x 3 grid panel (WRIST_GRID), facing the head, with the same hit test (the other hand's ray -> slot)
describe('vr-hand-view.js: the wrist menu grid', () => {
  function wristRig() {
    const scene = new THREE.Scene(), hands = [0, 1].map(() => ({ joints: Object.fromEntries(JOINTS.map(n => [n, new THREE.Group()])) }));
    const controllers = [0, 1].map(() => { const g = new THREE.Group(); g.matrixAutoUpdate = false; scene.add(g); return g; });
    const head = new THREE.Vector3(0, 1.6, 0), hi = createHandInput(THREE, {
      renderer: { xr: { getHand: i => hands[i] } }, scene, controllers, ja: true, getHead: () => head, getHeadQuat: () => new THREE.Quaternion(), colorOf: () => 0xffffff,
      release() {}, handInHolder: () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }), sectionOn: () => false, avail: () => true, grab: () => true, ungrab() {}, busy: () => false, near: null,
    });
    controllers[0].userData.source = { hand: {}, handedness: 'right' }; hi.connect(controllers[0], 0);
    controllers[1].userData.source = { hand: {}, handedness: 'left' }; hi.connect(controllers[1], 1);
    const wristPos = new THREE.Vector3(-0.2, 1.2, -0.3), y = head.clone().sub(wristPos).normalize(), f = new THREE.Vector3().crossVectors(y, new THREE.Vector3(0, 1, 0)).normalize(), z = f.clone().negate(), x = new THREE.Vector3().crossVectors(y, z);
    const watch = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); // the back of the left wrist to the eyes, the fingers across the view
    let t = 1000;
    const frame = () => {
      handPose(hands[0].joints, {}); handPose(hands[1].joints, { pos: wristPos, rot: watch });
      for (const c of controllers) { c.matrix.identity(); c.visible = true; c.updateMatrixWorld(true); }
      t += FRAME; vi.spyOn(performance, 'now').mockReturnValue(t); hi.frame(t);
    };
    return { hi, scene, controllers, head, frame, wristPos };
  }
  const panelOf = scene => scene.children.find(o => o.isMesh && o.geometry.type === 'PlaneGeometry');
  it('a 15 x 10.5 cm panel, shown after the watch pose is held, facing the head, above the back of the wrist', () => {
    const r = wristRig(), p = panelOf(r.scene);
    expect(p.geometry.parameters.width).toBeCloseTo(0.15, 9); expect(p.geometry.parameters.height).toBeCloseTo(0.105, 9);
    for (let i = 0; i < 20; i++) r.frame();
    expect(r.hi.wristShown).toBe(true); expect(p.visible).toBe(true);
    p.updateMatrixWorld(true);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(p.matrixWorld), toHead = r.head.clone().sub(p.getWorldPosition(new THREE.Vector3())).normalize();
    expect(n.dot(toHead)).toBeGreaterThan(0.999); // faces the eyes
    expect(Math.abs(new THREE.Vector3(1, 0, 0).transformDirection(p.matrixWorld).y)).toBeLessThan(1e-6); // not rolled: its rows stay level
    expect(p.getWorldPosition(new THREE.Vector3()).distanceTo(r.wristPos)).toBeGreaterThan(0.06); expect(p.getWorldPosition(new THREE.Vector3()).distanceTo(r.wristPos)).toBeLessThan(0.12);
  });
  it('the other hand\'s ray: each button cell gives its slot (same ids as before), an empty cell nothing; the left hand itself never hits it', () => {
    const r = wristRig(), p = panelOf(r.scene); for (let i = 0; i < 20; i++) r.frame(); p.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(), W = 0.15, H = 0.105, normal = new THREE.Vector3(0, 0, 1).transformDirection(p.matrixWorld);
    const hitCell = (col, row, c = r.controllers[0]) => {
      const centre = p.localToWorld(new THREE.Vector3((col + 0.5) / 3 * W - W / 2, H / 2 - (row + 0.5) / 3 * H, 0));
      return r.hi.wristHit(c, rc, () => { rc.ray.origin.copy(centre).addScaledVector(normal, 0.3); rc.ray.direction.copy(normal).negate(); });
    };
    const ids = [['ring', 0, 0], ['menu', 1, 0], ['section', 2, 0], ['add', 0, 1], ['undo', 1, 1], ['secDown', 0, 2], ['secUp', 1, 2]];
    for (const [id, c, rw] of ids) { const h = hitCell(c, rw); expect(h, id).not.toBeNull(); expect(r.hi.wristId(h.slot), id).toBe(id); expect(h.distance).toBeCloseTo(0.3, 3); }
    expect(hitCell(2, 1)).toBeNull(); expect(hitCell(2, 2)).toBeNull();
    expect(hitCell(0, 0, r.controllers[1])).toBeNull();
  });
});
