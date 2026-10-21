import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  sectionWristTurn, sectionFollowStart, sectionFollowStep, dragShouldStart, DRAG_RECORD, DRAG_HAND, qMul, qInv, qAngleDeg, qRot,
} from '../../docs/vr-point.js';

// a section (断面) grabbed by a HAND's pinch turns with the WRIST: the wrist joint's turn since the grab (its palm anchor, roll about the forearm included) is
// applied to the section's orientation; the ray still gives the position. Before, the turn came from the hand's group = the system's target ray in 標準, which is aimed
// from the shoulder and does not roll with the wrist, so a twist of the hand did nothing (not even start the drag). Controllers keep sectionFollowStep as it was.
// The pure part runs here, and vr-view.js's own wristQ / startDrag / updatePress (taken from its source) run against stand-ins.
const D = Math.PI / 180;
const q = (axis, deg) => { const t = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), deg * D); return { x: t.x, y: t.y, z: t.z, w: t.w }; };
const mul = (a, b) => qMul(a, b);
const angle = (a, b) => qAngleDeg(qMul(a, qInv(b)));
const axisOf = r => { const s = Math.hypot(r.x, r.y, r.z) || 1, k = r.w < 0 ? -1 : 1; return [k * r.x / s, k * r.y / s, k * r.z / s]; };
const near = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('sectionWristTurn: the section turns by the wrist\'s turn since the grab', () => {
  it('no wrist turn: the section keeps its orientation; a twist about the forearm (the hand\'s -Z, here turned in space): the same turn about the same axis', () => {
    const Qp0 = q([0.3, 1, -0.2], 70), qw0 = q([1, 0.5, 0], 40);
    const same = sectionWristTurn({ qw0, qw: qw0, Qp0 });
    expect(angle(same, Qp0)).toBeLessThan(1e-6);
    for (const deg of [10, 30, 60, -45, 120]) {
      const fore = qRot(qw0, { x: 0, y: 0, z: -1 }), twist = q([fore.x, fore.y, fore.z], deg), qw = mul(twist, qw0); // the wrist rolled about its own forearm axis
      const Qp = sectionWristTurn({ qw0, qw, Qp0 }), d = mul(Qp, qInv(Qp0));
      expect(qAngleDeg(d)).toBeCloseTo(Math.abs(deg), 6);
      const ax = axisOf(d), s = Math.sign(deg); expect(near(ax, [s * fore.x, s * fore.y, s * fore.z], 1e-6)).toBe(true);
    }
  });
  it('any wrist turn (pitch / yaw / roll together) is passed on 1:1, whatever the section\'s and the wrist\'s starting orientations', () => {
    for (const [a, b, c] of [[[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[1, 1, 1], [0, 1, -1], [1, -2, 0.5]]]) {
      const Qp0 = q(a, 33), qw0 = q(b, -50), turn = mul(q(c, 25), q([0, 1, 0], -15)), qw = mul(turn, qw0);
      expect(angle(mul(qInv(sectionWristTurn({ qw0, qw, Qp0 })), mul(turn, Qp0)), { x: 0, y: 0, z: 0, w: 1 })).toBeLessThan(1e-6);
    }
  });
});

// ---- vr-view.js's code for the press / drag, run as it is written there ----
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const grab = (start, end) => { const a = src.indexOf(start); expect(a, start).toBeGreaterThan(0); const b = src.indexOf(end, a); expect(b, end).toBeGreaterThan(a); return src.slice(a, b); };
const CODE = [
  grab(' const wristQ=c=>', '\n'),
  grab(' const startDrag=(c,pr,hp)=>{', '\n const updatePress='),
  grab(' const updatePress=(c,now)=>{', '\n // the section an empty-space grab moves'),
].join('\n');
function world({ hand }) {
  const pl = { obj: new THREE.Object3D(), hand: 'right' }; pl.obj.position.set(0.02, -0.01, 0.03); pl.obj.quaternion.set(...(() => { const t = q([0.2, 1, 0.1], 25); return [t.x, t.y, t.z, t.w]; })());
  const c = { userData: {}, ray: { p: { x: 0.1, y: 0.2, z: 0.4 }, q: q([0, 1, 0], 10) }, wrist: hand ? q([0.1, 0.3, 1], 20) : null };
  c.userData.source = hand ? { hand: {}, handedness: 'right' } : { gamepad: {}, handedness: 'right' };
  const anchor = { anchor: true };
  const env = {
    isHand: s => !!(s && s.hand), holdOf: x => (x.wrist ? anchor : x), anchorInHolder: x => ({ p: { x: 0, y: 0, z: 0.3 }, q: { ...x.wrist } }),
    handInHolder: x => ({ p: { ...x.ray.p }, q: { ...x.ray.q } }), holder: { getWorldScale: v => v.set(1, 1, 1) }, tmpHs: new THREE.Vector3(),
    handIn: { dragTh: () => DRAG_HAND }, twoHand: null, grabbing: new Set(), vrHalfExt: [0.1, 0.1, 0.1], planes: [pl], draggedBy: () => false, section: { selected: pl },
    pulse() {}, emit() {}, HAPTIC: { select: {} }, drawHandle() {}, menu: { refresh() {} }, openPointWheel() {}, pulseTwice() {}, resetPin() {},
    sectionFollowStart, sectionFollowStep, sectionWristTurn, dragShouldStart, DRAG_RECORD, qAngleDeg, qMul, qInv,
  };
  const names = Object.keys(env);
  const fns = new Function(...names, CODE + '\nreturn {wristQ,startDrag,updatePress};')(...names.map(k => env[k]));
  const press = () => { const hp = env.handInHolder(c); c.userData.press = { t0: 0, res: { kind: 'section', ref: { pl } }, p0: hp.p, q0: hp.q, wq0: fns.wristQ(c), dragPl: pl, dragRec: false, consumed: false, tp: { update: () => null } }; };
  return { c, pl, env, fns, press };
}
const quat = o => ({ x: o.quaternion.x, y: o.quaternion.y, z: o.quaternion.z, w: o.quaternion.w });
const pos = o => [o.position.x, o.position.y, o.position.z];

describe('vr-view.js: a hand\'s pinch drag of a section turns it with the wrist (標準 included); a controller\'s drag is as before', () => {
  it('wristQ: the palm anchor\'s orientation for a hand, null for a controller', () => {
    const h = world({ hand: true }), k = world({ hand: false });
    expect(h.fns.wristQ(h.c)).toEqual(h.c.wrist); expect(k.fns.wristQ(k.c)).toBe(null);
  });
  it('標準: the system ray stays still while the hand twists 40 deg about the forearm: the drag starts and the section rolls 40 deg about the same axis; its centre stays (the ray did not move)', () => {
    const w = world({ hand: true }), { c, pl, fns } = w, Q0 = quat(pl.obj), C0 = pos(pl.obj), qw0 = { ...c.wrist };
    w.press(); expect(c.userData.press.wq0).toEqual(qw0);
    const fore = qRot(qw0, { x: 0, y: 0, z: -1 });
    for (let i = 1; i <= 40; i++) { c.wrist = mul(q([fore.x, fore.y, fore.z], i), qw0); fns.updatePress(c, 10 * i); }
    expect(c.userData.drag).toBeTruthy(); expect(c.userData.drag.wq0).toBeTruthy(); // started by the twist alone (a 5 deg wrist turn: DRAG_HAND.angDeg)
    const startAt = 5; // the drag took its references at the 5th degree; from there on the section turns with the wrist
    const d = mul(quat(pl.obj), qInv(Q0)); expect(qAngleDeg(d)).toBeCloseTo(40 - startAt, 6);
    expect(near(axisOf(d), [fore.x, fore.y, fore.z], 1e-6)).toBe(true);
    expect(near(pos(pl.obj), C0, 1e-12)).toBe(true);
    // the system ray of this step alone (the old path) would not have turned it at all
    const f = sectionFollowStart({ p0: c.ray.p, q0: c.ray.q, c0: { x: C0[0], y: C0[1], z: C0[2] }, Qp0: Q0 }), r = sectionFollowStep({ ...f, p: c.ray.p, q: c.ray.q });
    expect(angle(r.Qp, Q0)).toBeLessThan(1e-9);
  });
  it('a hand: the ray still moves the section (its centre follows the ray as before); the turn is the wrist\'s', () => {
    const w = world({ hand: true }), { c, pl, fns } = w, qw0 = { ...c.wrist };
    w.press(); c.ray.p = { x: 0.15, y: 0.2, z: 0.4 }; fns.updatePress(c, 10); expect(c.userData.drag).toBeTruthy();
    const dg = c.userData.drag, Q0 = { ...dg.Q0 };
    c.ray.p = { x: 0.2, y: 0.25, z: 0.35 }; c.ray.q = q([1, 0, 0], 12); c.wrist = mul(q([0, 1, 0], 15), qw0); fns.updatePress(c, 20);
    const r = sectionFollowStep({ rel: dg.rel, Qrel: dg.Qrel, p: c.ray.p, q: c.ray.q });
    expect(near(pos(pl.obj), [r.c.x, r.c.y, r.c.z], 1e-12)).toBe(true);
    expect(angle(quat(pl.obj), mul(q([0, 1, 0], 15), Q0))).toBeLessThan(1e-6);
  });
  it('a controller: the drag is sectionFollowStep of the controller pose exactly (position and turn), no wrist reference anywhere', () => {
    const w = world({ hand: false }), { c, pl, fns } = w;
    w.press(); expect(c.userData.press.wq0).toBe(null);
    c.ray.p = { x: 0.13, y: 0.2, z: 0.4 }; fns.updatePress(c, 10); const dg = c.userData.drag; expect(dg).toBeTruthy(); expect(dg.wq0).toBe(null);
    for (let i = 1; i <= 10; i++) {
      c.ray.p = { x: 0.13 + 0.01 * i, y: 0.2, z: 0.4 - 0.005 * i }; c.ray.q = mul(q([0, 0, 1], 4 * i), q([0, 1, 0], 10 + i)); fns.updatePress(c, 10 + 10 * i);
      const r = sectionFollowStep({ rel: dg.rel, Qrel: dg.Qrel, p: c.ray.p, q: c.ray.q });
      expect(pos(pl.obj)).toEqual([r.c.x, r.c.y, r.c.z]); expect(quat(pl.obj)).toEqual(r.Qp); // bit for bit
    }
    // a controller twist about its own axis does turn the section through the ray, as before (the controller's pose has the roll)
    const k = world({ hand: false }); k.press(); k.c.ray.q = mul(q([0, 0, -1], 30), k.c.ray.q); k.fns.updatePress(k.c, 10); expect(k.c.userData.drag).toBeTruthy();
  });
  it('the sources: the controller line of the step is unchanged in substance; startDrag / the press record the wrist only through wristQ (null for a controller)', () => {
    expect(src).toContain("const wristQ=c=>isHand(c.userData.source)&&holdOf(c)!==c?anchorInHolder(c).q:null;");
    expect(src).toContain('const wq=dg.wq0?wristQ(c):null,Qp=wq?sectionWristTurn({qw0:dg.wq0,qw:wq,Qp0:dg.Q0}):r.Qp;');
    expect(src).toContain('c.userData.drag={pl,rel:fl.rel,Qrel:fl.Qrel,wq0:wristQ(c),Q0:Qp0,volTouched:false};');
    expect(src).toContain('p0:hp.p,q0:hp.q,wq0:wristQ(c),gateOk:');
    expect(src).toContain('c.userData.drag={pl,rel:fl.rel,Qrel:fl.Qrel,volTouched:false,fist:true};'); // a fist keeps the palm anchor for both (unchanged)
  });
});
