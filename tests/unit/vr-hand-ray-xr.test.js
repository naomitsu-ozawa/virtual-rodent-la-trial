import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { WebXRController } from 'three';
import { PALM_FROM_WRIST, PALM_RAY } from '../../docs/vr-hand.js';

// the hand laser end to end, from a synthetic XRFrame to the laser that is drawn and the ray that is hit-tested. three.js' own WebXRController
// writes the poses (frame.getPose(inputSource.targetRaySpace, referenceSpace) into the controller group, frame.getJointPose into the hand's joints) exactly as
// in a session; vr-hand-view.js then runs as vr-view.js runs it; the laser is the Line vr-view.js hangs on the group, read after scene.updateMatrixWorld() (what
// the renderer does), and the hit test is vr-view.js's own setRay (taken from its source). For each mode the drawn laser's world origin / direction must be the
// mode's (指先: index tip along the finger; 手のひら: the palm along the hand axis; 標準: the system's target ray, bit for bit) and the hit test must be the same ray.
const viewSrc = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const hvQ = viewSrc.match(/\.\/vr-hand-view\.js(\?v=[^']+)/)[1];
let createHandInput;
beforeAll(async () => {
  const inert = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : inert), apply: () => inert, set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => inert }) });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  ({ createHandInput } = await import(/* @vite-ignore */ '../../docs/vr-hand-view.js' + hvQ));
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

// vr-view.js's hit-test ray (const setRay=c=>{...}), evaluated as it is written there
const setRaySrc = viewSrc.match(/const setRay=(c=>\{tmpM[^\n]*?\});/)[1];
const makeSetRay = () => { const raycaster = new THREE.Raycaster(), tmpM = new THREE.Matrix4(); return { raycaster, setRay: new Function('raycaster', 'tmpM', 'return ' + setRaySrc)(raycaster, tmpM) }; };

// a right hand, palm down, pointing ahead (-Z) with the fingers relaxed; wrist joint orientation = identity (WebXR: -Z along the fingers, +Y the back of the hand)
const OFF = new THREE.Vector3(0.22, 1.05, -0.32);
const P = { wrist: [0, 0, 0], 'thumb-metacarpal': [-0.025, -0.012, -0.025], 'thumb-phalanx-proximal': [-0.045, -0.015, -0.055], 'thumb-phalanx-distal': [-0.055, -0.02, -0.085], 'thumb-tip': [-0.058, -0.025, -0.108] };
const FX = { index: -0.022, middle: 0, ring: 0.02, pinky: 0.038 };
for (const f of Object.keys(FX)) ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].forEach((n, i) => { P[`${f}-finger-${n}`] = [FX[f], [0, -0.004, -0.012, -0.022, -0.03][i], [-0.02, -0.09, -0.135, -0.16, -0.178][i]]; });
const NAMES = Object.keys(P);
const W = n => new THREE.Vector3(...P[n]).add(OFF);
// the system's ray of a Quest hand: from the web between thumb and index, aimed from the shoulder through the hand (not along the fingers)
const AIM_P = W('thumb-metacarpal').lerp(W('index-finger-phalanx-proximal'), 0.5), AIM_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, 0.18, 0.05, 'YXZ'));

function session(mode) {
  const hand = new Map(NAMES.map(n => [n, { jointName: n }])), src = { hand, handedness: 'right', targetRaySpace: { ray: true }, gripSpace: { grip: true }, profiles: [] };
  let aimP = AIM_P.clone(), aimQ = AIM_Q.clone(), gap = null;
  const mat = (p, q) => ({ matrix: new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).toArray() });
  const frame = { session: { visibilityState: 'visible' },
    getPose: s => (s === src.targetRaySpace ? { transform: mat(aimP, aimQ) } : null),
    getJointPose: j => { let p = W(j.jointName); if (gap !== null && j.jointName === 'thumb-tip') p = W('index-finger-tip').add(new THREE.Vector3(-gap, 0, 0)); return { radius: 0.008, transform: mat(p, new THREE.Quaternion()) }; } };
  const xc = [new WebXRController(), new WebXRController()], scene = new THREE.Scene();
  const controllers = [0, 1].map(i => { const c = xc[i].getTargetRaySpace(); scene.add(c); // vr-view.js: renderer.xr.getController(i); scene.add(c); a Line (0,0,0) -> (0,0,-1) as the laser
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial()); ray.scale.z = 0.6; c.add(ray); c.userData.ray = ray; return c; });
  const cur = { mode }, events = [];
  const hi = createHandInput(THREE, { renderer: { xr: { getHand: i => xc[i].getHandSpace() } }, scene, controllers, ja: true, getHead: () => new THREE.Vector3(0, 1.6, 0), getHeadQ: () => new THREE.Quaternion(), rayMode: () => cur.mode,
    colorOf: () => 0xffffff, release() {}, handInHolder: c => ({ p: c.getWorldPosition(new THREE.Vector3()), q: c.getWorldQuaternion(new THREE.Quaternion()) }), sectionOn: () => false, avail: () => true, grab: () => true, ungrab() {}, busy: () => false, near: null });
  const sr = makeSetRay();
  for (const c of controllers) {
    c.addEventListener('connected', e => { c.userData.source = e.data; hi.connect(c, controllers.indexOf(c)); });
    for (const t of ['selectstart', 'selectend']) c.addEventListener(t, e => { hi.eventPose(c, e); if (!e.handPinch && e.data?.hand) return; sr.setRay(c); events.push({ type: t, own: !!e.handPinch, o: sr.raycaster.ray.origin.clone(), d: sr.raycaster.ray.direction.clone() }); });
  }
  xc[0].connect(src);
  let t = 1000;
  const tick = () => { t += 1000 / 72; vi.spyOn(performance, 'now').mockReturnValue(t); xc[0].update(src, frame, {}); hi.frame(t); };
  // what is drawn: the laser Line's world start and direction after the renderer's scene.updateMatrixWorld()
  const drawn = () => { scene.updateMatrixWorld(); const l = controllers[0].userData.ray; return { o: new THREE.Vector3(0, 0, 0).applyMatrix4(l.matrixWorld), d: new THREE.Vector3(0, 0, -1).applyMatrix4(l.matrixWorld).sub(new THREE.Vector3().applyMatrix4(l.matrixWorld)).normalize() }; };
  const hit = () => { sr.setRay(controllers[0]); return { o: sr.raycaster.ray.origin.clone(), d: sr.raycaster.ray.direction.clone() }; };
  // three's onSessionEvent for the system's own select: controller.update(event.inputSource, event.frame, referenceSpace), then the event on the groups
  const osSelect = type => { xc[0].update(src, frame, {}); xc[0].dispatchEvent({ type, data: src }); };
  return { scene, c: controllers[0], hi, cur, tick, drawn, hit, osSelect, events, setAim: (p, q) => { aimP = p; aimQ = q; }, setGap: g => { gap = g; }, aim: () => ({ o: aimP.clone(), d: new THREE.Vector3(0, 0, -1).applyQuaternion(aimQ), q: aimQ.clone() }) };
}
const deg = (a, b) => a.angleTo(b) * 180 / Math.PI;
const sameRay = (a, b, mm = 1e-9, dg = 1e-6) => { expect(a.o.distanceTo(b.o)).toBeLessThan(mm); expect(deg(a.d, b.d)).toBeLessThan(dg); };

describe('the hand laser from a synthetic XRFrame: what is drawn and what is hit-tested, per mode', () => {
  it('the scene has no rig: the controller groups hang on the untransformed scene and three uses the plain local-floor space (no offset reference space), so world = XR reference space', () => {
    expect(viewSrc).toContain('const controllers=[0,1].map(i=>{const c=renderer.xr.getController(i);scene.add(c);');
    expect(viewSrc).toContain("renderer.xr.setReferenceSpaceType('local-floor')");
    expect(viewSrc).not.toMatch(/getOffsetReferenceSpace|setReferenceSpace\(|scene\.(position|quaternion|rotation|scale)\.set|scene\.matrix/);
    expect(viewSrc).toContain('c.add(ray);c.userData.ray=ray;'); // the laser is the group's child: it is drawn from the group's pose
    const s = session('standard'); s.tick(); expect(s.c.parent).toBe(s.scene); expect(s.scene.matrixWorld.equals(new THREE.Matrix4())).toBe(true);
  });
  it('標準: the drawn laser and the hit test are frame.getPose(targetRaySpace) exactly: every frame, through an own pinch, a system select (event frame) and a moving aim', () => {
    const s = session('standard');
    for (let i = 0; i < 30; i++) { s.tick(); sameRay(s.drawn(), s.aim()); sameRay(s.hit(), s.aim()); }
    for (let i = 0; i < 30; i++) { // a pinch while the system's aim moves and turns (the system stabilises its own ray; nothing of ours is added)
      s.setGap(i < 25 ? 0.008 : 0.06); s.setAim(AIM_P.clone().add(new THREE.Vector3(0.002 * i, 0, 0)), AIM_Q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01 * i)));
      s.tick(); sameRay(s.drawn(), s.aim()); sameRay(s.hit(), s.aim());
    }
    expect(s.events.filter(e => e.own).map(e => e.type)).toEqual(['selectstart', 'selectend']);
    s.setAim(AIM_P.clone().add(new THREE.Vector3(0, 0.05, 0)), AIM_Q); s.osSelect('selectstart'); sameRay(s.hit(), s.aim()); s.osSelect('selectend'); sameRay(s.hit(), s.aim()); // the event frame's own pose stays
    const press = s.events.find(e => e.own && e.type === 'selectstart');
    expect([press.o.x, press.o.y, press.o.z].every(Number.isFinite)).toBe(true);
  });
  it('指先: the laser starts at the index fingertip and runs along the index finger (knuckle -> tip), not from the thumb web where the system ray starts', () => {
    const s = session('between'); for (let i = 0; i < 60; i++) s.tick();
    const want = { o: W('index-finger-tip'), d: W('index-finger-tip').sub(W('index-finger-phalanx-proximal')).normalize() };
    sameRay(s.drawn(), want, 1e-3, 0.3); sameRay(s.hit(), s.drawn(), 1e-12, 1e-9);
    expect(s.drawn().o.distanceTo(s.aim().o)).toBeGreaterThan(0.06); // ~9 cm ahead of the system ray's origin (the base of the thumb)
    expect(deg(s.drawn().d, s.aim().d)).toBeGreaterThan(8);
  });
  it('手のひら: the laser starts at the palm centre (palm side) and runs along wrist -> middle knuckle', () => {
    const s = session('wrist'); for (let i = 0; i < 60; i++) s.tick();
    const wr = W('wrist'), kn = W('middle-finger-phalanx-proximal');
    const want = { o: wr.clone().lerp(kn, PALM_FROM_WRIST).add(new THREE.Vector3(0, -PALM_RAY.palmSide, 0)), d: kn.clone().sub(wr).normalize() };
    sameRay(s.drawn(), want, 1e-3, 0.3); sameRay(s.hit(), s.drawn(), 1e-12, 1e-9);
    expect(s.drawn().o.distanceTo(s.aim().o)).toBeGreaterThan(0.02);
  });
  it('the three modes give three different laser origins on the same hand, and the setting is read live (no restart)', () => {
    const s = session('standard'), at = {};
    for (const m of ['standard', 'between', 'wrist', 'standard']) { s.cur.mode = m; for (let i = 0; i < 60; i++) s.tick(); at[m] = s.drawn().o; sameRay(s.hit(), s.drawn(), 1e-12, 1e-9); }
    expect(at.standard.distanceTo(AIM_P)).toBeLessThan(1e-9);
    expect(at.between.distanceTo(at.standard)).toBeGreaterThan(0.05); expect(at.wrist.distanceTo(at.standard)).toBeGreaterThan(0.02); expect(at.between.distanceTo(at.wrist)).toBeGreaterThan(0.05);
  });
});
