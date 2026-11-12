import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { pairBoxHas, pairSectionOwnerIn, planeNearerPartner, grabTargetOf, pairGrabPlan } from '../../docs/vr-pair-view.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

describe('pure rules of the individual poses', () => {
  it('pairBoxHas: inside a box of half extents (edges belong to it)', () => {
    expect(pairBoxHas({ x: 0, y: 0, z: 0 }, [1, 2, 3])).toBe(true);
    expect(pairBoxHas({ x: 1, y: 2, z: -3 }, [1, 2, 3])).toBe(true);
    expect(pairBoxHas({ x: 1.01, y: 0, z: 0 }, [1, 2, 3])).toBe(false);
    expect(pairBoxHas({ x: 0, y: 0, z: 3.01 }, [1, 2, 3])).toBe(false);
  });
  it('pairSectionOwnerIn: inside one box only -> that dataset; both / neither -> unchanged (a small shake never flips it)', () => {
    for (const prev of [false, true]) {
      expect(pairSectionOwnerIn(prev, true, false)).toBe(false);
      expect(pairSectionOwnerIn(prev, false, true)).toBe(true);
      expect(pairSectionOwnerIn(prev, false, false)).toBe(prev);
      expect(pairSectionOwnerIn(prev, true, true)).toBe(prev);
    }
  });
  it('planeNearerPartner: the box centre that is nearer; a tie is the primary', () => {
    expect(planeNearerPartner(1, 2)).toBe(false); expect(planeNearerPartner(2, 1)).toBe(true); expect(planeNearerPartner(1, 1)).toBe(false);
  });
  it('grabTargetOf: the nearer hit of the laser; the primary when the partner is not hit or ties', () => {
    expect(grabTargetOf({ distance: 1 }, null)).toBe('main'); expect(grabTargetOf(null, { distance: 1 })).toBe('pair');
    expect(grabTargetOf({ distance: 1 }, { distance: 0.5 })).toBe('pair'); expect(grabTargetOf({ distance: 0.5 }, { distance: 1 })).toBe('main');
    expect(grabTargetOf({ distance: 1 }, { distance: 1 })).toBe('main'); expect(grabTargetOf(null, null)).toBe('main');
  });
  it('pairGrabPlan: one hand each moves its own; two hands on the same dataset scale; one hand alone moves what it holds', () => {
    expect(pairGrabPlan(['main'])).toMatchObject({ scale: false, moveMain: true, movePair: false });
    expect(pairGrabPlan(['pair'])).toMatchObject({ scale: false, moveMain: false, movePair: true });
    expect(pairGrabPlan(['main', 'pair'])).toMatchObject({ scale: false, moveMain: true, movePair: true });
    expect(pairGrabPlan(['main', 'main'])).toMatchObject({ scale: true, moveMain: false, movePair: false });
    expect(pairGrabPlan(['pair', 'pair'])).toMatchObject({ scale: true, moveMain: false, movePair: false });
    expect(pairGrabPlan([])).toMatchObject({ scale: false, moveMain: false, movePair: false });
  });
});

// the pose step, run from its own source against a real three.js graph (scene > holder > partner mesh; a palm for the hand)
describe('the partner has its own pose (pairPose, from its own source)', () => {
  const a = src.indexOf('  const pairQa=new THREE.Quaternion()'), b = src.indexOf('  pairFrame=()=>{');
  expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
  const code = src.slice(a, b);
  const make = () => {
    const scene = new THREE.Scene(), holder = new THREE.Group(); scene.add(holder);
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); holder.add(mesh); mesh.position.set(3.4, 0, 0);
    const palm = new THREE.Object3D(); scene.add(palm);
    const mkPlane = (x, own) => { const o = new THREE.Group(); o.position.set(x, 0, 0); o.scale.setScalar(1.7); holder.add(o); return { obj: o, own }; };
    const planes = [mkPlane(0, false), mkPlane(3.4, true)];
    const pair = { on: true, mesh, delta: [3.4, 0, 0], apos: new THREE.Vector3(), aquat: new THREE.Quaternion() };
    scene.updateMatrixWorld(true);
    const x = { THREE, scene, holder, planes, pair, pairHeld: null, pairHold: null, pairPose: null, pairAnchorReset: null, holdOf: c => c, draggedBy: () => false };
    new Function('ctx', 'with(ctx){' + code + '}')(x);
    x.pairAnchorReset(); x.pairPose();
    const world = o => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
    return { x, scene, holder, mesh, palm, planes, world };
  };
  it('at the start it is where it was: beside the primary, the same turn', () => {
    const { mesh, holder } = make();
    expect(mesh.position.x).toBeCloseTo(3.4, 9); expect(mesh.position.y).toBeCloseTo(0, 9); expect(mesh.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    expect(mesh.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(holder.scale.x, 9);
  });
  it('moving / turning the primary alone (the holder) does NOT take the partner along: it stays in the room, and its own frames stay with it', () => {
    const { x, scene, holder, mesh, planes, world } = make();
    const before = world(mesh), planeBefore = world(planes[1].obj), mineBefore = world(planes[0].obj);
    holder.position.add(new THREE.Vector3(0.2, 0.1, -0.1)); holder.rotateY(0.7); scene.updateMatrixWorld(true);
    x.pairPose();
    expect(world(mesh).distanceTo(before)).toBeLessThan(1e-9); // the partner did not move
    expect(world(planes[1].obj).distanceTo(planeBefore)).toBeLessThan(1e-9); // a frame put on the partner stays on it
    expect(world(planes[0].obj).distanceTo(mineBefore)).toBeGreaterThan(0.05); // a frame of the primary went with the primary
    expect(mesh.scale.x).toBe(1); expect(planes[1].obj.scale.x).toBeCloseTo(1.7, 12);
    // and the partner is NOT turned either (its world turn is the one it had)
    const q = new THREE.Quaternion(); mesh.getWorldQuaternion(q); expect(q.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });
  it('a hand holding the partner moves / turns the partner alone; the primary stays; its frames go with it; letting go leaves it there', () => {
    const { x, scene, holder, mesh, palm, planes, world } = make();
    const primaryBefore = world(holder), mineBefore = world(planes[0].obj);
    palm.position.copy(world(mesh)); palm.updateMatrixWorld(true);
    x.pairHold(palm); expect(x.pairHeld).not.toBeNull();
    const framePos0 = world(planes[1].obj), mesh0 = world(mesh);
    palm.position.add(new THREE.Vector3(0.3, 0.2, 0.1)); palm.rotateY(0.5); scene.updateMatrixWorld(true);
    x.pairPose();
    expect(world(holder).distanceTo(primaryBefore)).toBeLessThan(1e-12); expect(world(planes[0].obj).distanceTo(mineBefore)).toBeLessThan(1e-12);
    expect(world(mesh).distanceTo(mesh0.clone().add(new THREE.Vector3(0.3, 0.2, 0.1)))).toBeLessThan(1e-9);
    // the frame kept its place in the partner's own space: it moved and turned with the partner (the frame sat at the partner's centre)
    expect(world(planes[1].obj).distanceTo(world(mesh))).toBeLessThan(1e-9); expect(framePos0.distanceTo(mesh0)).toBeLessThan(1e-9);
    // letting go: the pose stays; nothing moves any more
    const at = world(mesh); x.pairHeld = null; palm.position.add(new THREE.Vector3(1, 1, 1)); scene.updateMatrixWorld(true); x.pairPose();
    expect(world(mesh).distanceTo(at)).toBeLessThan(1e-12);
  });
  it('the magnification is one for both: the holder scale changes the partner too, about the partner\'s own centre', () => {
    const { x, scene, holder, mesh, world } = make();
    const at = world(mesh); holder.scale.setScalar(0.2); scene.updateMatrixWorld(true); x.pairPose();
    expect(world(mesh).distanceTo(at)).toBeLessThan(1e-9); expect(mesh.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(0.2, 9);
  });
  it('nothing moved: not a float is rewritten (a still frame never drifts)', () => {
    const { x, mesh } = make();
    const p = mesh.position.clone(), q = mesh.quaternion.clone();
    for (let i = 0; i < 50; i++) x.pairPose();
    expect(mesh.position.equals(p)).toBe(true); expect(mesh.quaternion.equals(q)).toBe(true);
  });
  it('正面に戻す: the partner comes back beside the primary, in the primary\'s own frame', () => {
    const { x, scene, holder, mesh, world } = make();
    holder.rotateY(1.1); holder.position.set(1, 1, -1); scene.updateMatrixWorld(true); x.pairPose();
    x.pairAnchorReset(); x.pairPose();
    expect(mesh.position.x).toBeCloseTo(3.4, 9); expect(mesh.position.y).toBeCloseTo(0, 9); expect(mesh.position.z).toBeCloseTo(0, 9);
    expect(world(mesh).distanceTo(new THREE.Vector3(3.4, 0, 0).applyMatrix4(holder.matrixWorld))).toBeLessThan(1e-9);
  });
});

describe('vr-view.js is wired to the individual poses', () => {
  it('the frame calls pairPose right after the two-hand scale and before the controllers are read', () => {
    const i = src.indexOf('if(twoHand)holder.scale.setScalar(pinchScale('), j = src.indexOf('pairPose();', i), k = src.indexOf('const fHide=framesHidden();');
    expect(i).toBeGreaterThan(0); expect(j).toBeGreaterThan(i); expect(k).toBeGreaterThan(j);
  });
  it('a grip / a fist records which dataset it took; regrab hands the plan to pairGrabPlan; stopPair lets the partner\'s hands go', () => {
    expect(src).toContain('grabKind.set(c,gripKind(c));grabbing.add(c);regrab();');
    expect(src).toContain("if(t.kind==='volume')grabKind.set(c,t.ref==='pair'?'pair':'main');");
    expect(src).toContain('pairGrabPlan(hands.map(c=>isP(c)?\'pair\':\'main\'))');
    expect(src).toContain('dropPairGrips(); // a hand that holds the partner lets it go with it');
    expect(src).toContain('pairAnchorReset()}};'); // 正面に戻す puts the partner back beside the primary
  });
  it('without a partner the grab is the old one (the original two lines are kept)', () => {
    expect(src).toContain('else if(grabbing.size===2)twoHand={d0:Math.max(handDist(),1e-3),s0:holder.scale.x,sg:holder.scale.x};');
    expect(src).toContain('else if(grabbing.size===1){grabP.copy(holder.position);grabQ.copy(holder.quaternion);grab1=true;holdOf([...grabbing][0]).attach(holder)}');
  });
});
