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
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  ({ createHandInput } = await import(/* @vite-ignore */ '../../docs/vr-hand-view.js' + q));
});
afterAll(() => vi.unstubAllGlobals());

const FRAME = 1000 / 72;
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
    for (let i = 0; i < 4; i++) { if (i) ang += bend[i - 1] * deg; p.add(new THREE.Vector3(0, -Math.sin(ang), -Math.cos(ang)).multiplyScalar(BONES[f][i])); set(PREFIX[f] + SUFFIX[i + 1], p); }
    if (f === 'index') indexTip = p.clone();
  }
  set('thumb-tip', indexTip.clone().add(new THREE.Vector3(thumbGap, 0, 0)));
}
const JOINTS = ['wrist', 'thumb-tip', ...Object.values(PREFIX).flatMap(f => SUFFIX.map(s => f + s))];

function rig() {
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
  const frame = opts => { handPose(hands[0].joints, opts); writeRaw(opts?.visible ?? true); t += FRAME; vi.spyOn(performance, 'now').mockReturnValue(t); hi.frame(t); };
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
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.06 }); // the system ray is still: the filtered ray converges on it
    r.frame({ thumbGap: 0.01 }); r.frame({ thumbGap: 0.01 });
    const p0 = r.events[0][2], sys = new THREE.Vector3().setFromMatrixPosition(r.sysRay);
    expect(p0.distanceTo(sys)).toBeLessThan(1e-3);
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
  it('after the release the group goes back to the system ray within blendMs (120 ms)', () => {
    const r = rig(), h = r.controllers[0];
    for (let i = 0; i < 40; i++) r.frame({ thumbGap: 0.06 });
    for (let i = 0; i < 3; i++) r.frame({ thumbGap: 0.01 });
    for (let i = 0; i < 20; i++) r.frame({ thumbGap: 0.01, pos: new THREE.Vector3(0.25, 1.1, -0.35) });
    const sys = new THREE.Vector3().setFromMatrixPosition(r.sysRay);
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(sys)).toBeGreaterThan(0.09); // carried 10 cm away from the system ray
    for (let i = 0; i < 2; i++) r.frame({ thumbGap: 0.06, pos: new THREE.Vector3(0.25, 1.1, -0.35) });
    expect(r.events.map(e => e[0])).toEqual(['start', 'end']);
    for (let i = 0; i < 20; i++) r.frame({ thumbGap: 0.08, pos: new THREE.Vector3(0.25, 1.1, -0.35) });
    expect(h.getWorldPosition(new THREE.Vector3()).distanceTo(sys)).toBeLessThan(2e-3);
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
