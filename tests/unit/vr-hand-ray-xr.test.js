import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { WebXRController } from 'three';

// the hand laser end to end, from a synthetic XRFrame to the laser that is drawn and the ray that is hit-tested. three.js' own WebXRController
// writes the poses (frame.getPose(inputSource.targetRaySpace, referenceSpace) into the controller group, frame.getJointPose into the hand's joints) exactly as
// in a session; vr-hand-view.js then runs as vr-view.js runs it; the laser is the Line vr-view.js hangs on the group, read after scene.updateMatrixWorld() (what
// the renderer does), and the hit test is vr-view.js's own setRay (taken from its source). For each mode the drawn laser's world origin / direction must be the
// mode's (指差し: out of the index tip along the finger, knuckle -> tip, only while pointing; 標準: the system's target ray, bit for bit) and the hit test
// must be the same ray.
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
// the same hand pointing: the index as it is (straight), middle / ring / pinky curled into the palm (each joint bent 50 / 35 / 15 % of 180 deg toward -Y)
const PT = { ...P };
for (const f of ['middle', 'ring', 'pinky']) {
  let q = [FX[f], 0, -0.02], a = 0; PT[`${f}-finger-metacarpal`] = q;
  ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].forEach((n, i) => { a += 180 * [0, 0.5, 0.35, 0.15][i] * Math.PI / 180; const b = [0.065, 0.045, 0.025, 0.02][i]; q = [q[0], q[1] - Math.sin(a) * b, q[2] - Math.cos(a) * b]; PT[`${f}-finger-${n}`] = q; });
}
let pose = P;
const W = n => new THREE.Vector3(...pose[n]).add(OFF);
// the system's ray of a Quest hand: from the web between thumb and index, aimed from the shoulder through the hand (not along the fingers)
const AIM_P = W('thumb-metacarpal').lerp(W('index-finger-phalanx-proximal'), 0.5), AIM_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, 0.18, 0.05, 'YXZ'));

function session(mode, { pointing = false } = {}) {
  pose = pointing ? PT : P;
  const hand = new Map(NAMES.map(n => [n, { jointName: n }])), src = { hand, handedness: 'right', targetRaySpace: { ray: true }, gripSpace: { grip: true }, profiles: [] };
  let aimP = AIM_P.clone(), aimQ = AIM_Q.clone(), gap = null;
  const mat = (p, q) => ({ matrix: new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).toArray() });
  const frame = { session: { visibilityState: 'visible' },
    getPose: s => (s === src.targetRaySpace ? { transform: mat(aimP, aimQ) } : null),
    getJointPose: j => { let p = W(j.jointName); if (gap !== null && j.jointName === 'thumb-tip') p = W('index-finger-tip').add(new THREE.Vector3(-gap, 0, 0)); return { radius: 0.008, transform: mat(p, new THREE.Quaternion()) }; } };
  const xc = [new WebXRController(), new WebXRController()], scene = new THREE.Scene();
  const controllers = [0, 1].map(i => { const c = xc[i].getTargetRaySpace(); scene.add(c); // vr-view.js: renderer.xr.getController(i); scene.add(c); a 2 mm tube (0,0,0) -> (0,0,-1) as the laser
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial()); ray.scale.z = 0.6; c.add(ray); c.userData.ray = ray; return c; });
  const cur = { mode }, events = [];
  const hi = createHandInput(THREE, { renderer: { xr: { getHand: i => xc[i].getHandSpace() } }, scene, controllers, ja: true, getHead: () => new THREE.Vector3(0, 1.6, 0), rayMode: () => cur.mode,
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
  it('指差し: while pointing, the laser starts at the index fingertip and runs on in the finger\'s line, index knuckle -> fingertip (nothing else mixed in); the hit test is the same ray', () => {
    const s = session('point', { pointing: true }); for (let i = 0; i < 60; i++) s.tick();
    expect(s.hi.rayOn(s.c)).toBe(true);
    const want = { o: W('index-finger-tip'), d: W('index-finger-tip').sub(W('index-finger-phalanx-proximal')).normalize() };
    sameRay(s.drawn(), want, 1e-6, 1e-4); sameRay(s.hit(), s.drawn(), 1e-12, 1e-9);
    const line = new THREE.Ray(s.drawn().o, s.drawn().d.clone().negate()); expect(line.distanceToPoint(W('index-finger-phalanx-proximal'))).toBeLessThan(1e-5); // collinear with the finger
    expect(deg(s.drawn().d, W('index-finger-tip').sub(W('wrist')).normalize())).toBeGreaterThan(5); // the wrist -> tip line of left the tip at an angle on this hand
    expect(s.drawn().o.distanceTo(s.aim().o)).toBeGreaterThan(0.06); // not the system ray's origin (the base of the thumb)
    expect(deg(s.drawn().d, s.aim().d)).toBeGreaterThan(5); // off the system's aim on this hand
    // a pinch while pointing: a press (vr-view.js's select handlers run), the laser stays on through it
    s.setGap(0.008); for (let i = 0; i < 10; i++) { s.tick(); expect(s.hi.rayOn(s.c)).toBe(true); }
    s.setGap(null); for (let i = 0; i < 10; i++) s.tick();
    expect(s.events.filter(e => e.own).map(e => e.type)).toEqual(['selectstart', 'selectend']);
  });
  it('指差し: the relaxed (not pointing) hand has no laser and its pinch presses nothing; 標準 on the same hand is on', () => {
    const s = session('point'); for (let i = 0; i < 60; i++) { s.tick(); expect(s.hi.rayOn(s.c)).toBe(false); }
    s.setGap(0.008); for (let i = 0; i < 10; i++) s.tick(); s.setGap(null); for (let i = 0; i < 10; i++) s.tick();
    expect(s.events.filter(e => e.own)).toEqual([]);
    const t = session('standard'); for (let i = 0; i < 10; i++) { t.tick(); expect(t.hi.rayOn(t.c)).toBe(true); }
  });
  it('the two modes give two different lasers on the same hand, the setting is read live (no restart), and back on 標準 the system ray is bit for bit; a stale \'home\' is 標準', () => {
    const s = session('standard', { pointing: true }), at = {};
    for (const m of ['standard', 'point', 'home', 'standard']) { s.cur.mode = m; for (let i = 0; i < 60; i++) s.tick(); at[m] = s.drawn(); sameRay(s.hit(), s.drawn(), 1e-12, 1e-9); }
    expect(at.standard.o.distanceTo(AIM_P)).toBeLessThan(1e-9); sameRay(at.standard, s.aim(), 1e-12, 1e-9); sameRay(at.home, s.aim(), 1e-12, 1e-9);
    expect(at.point.o.distanceTo(at.standard.o)).toBeGreaterThan(0.05); expect(deg(at.point.d, at.standard.d)).toBeGreaterThan(5);
  });

  it('the laser is a light beam (flat ribbon, per-eye billboard, additive, fading), z=0..-1 with scale.z as its length, never hit by a raycast', () => {
    const m = viewSrc.match(/const makeLaser=\(\)=>\{[\s\S]*?return r\};/)[0];
    expect(viewSrc).toContain('const ray=makeLaser();ray.scale.z=0.08;c.add(ray);c.userData.ray=ray;');
    expect(viewSrc).not.toContain('const ray=new THREE.Line(');
    expect(m).toContain('cameraPosition'); expect(m).toContain('blending:THREE.AdditiveBlending'); expect(m).toContain('depthWrite:false'); expect(m).toContain('toneMapped:false');
    expect(m).toContain('mix(1.,0.3,vU.y)'); expect(m).toContain('r.raycast=()=>{}'); expect(m).toContain('position.x*0.001*mix(1.,0.3,t)'); // 2 mm at the hand, 0.6 mm at the tip expect(m).toContain('m.color=m.uniforms.color.value');
    expect(m).toContain('[-1,0,0,1,0,0,-1,0,-1,1,0,-1]'); // x = -1..1 (feathered width), z = 0..-1 (length)
  });
});
