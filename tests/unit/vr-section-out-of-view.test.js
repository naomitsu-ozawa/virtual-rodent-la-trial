import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { frameOutOfView, pointInView, OUT_OF_VIEW_MARGIN, flingDecision, flingDebugLines, createOutOfViewTracker, outOfViewRelease, outOfViewNow, OUT_OF_VIEW_HOLD_MS, OUT_OF_VIEW_MIN_DIST_M } from '../../docs/vr-section-frame.js';
import { VOLUME_FWD, VOLUME_DOWN } from '../../docs/vr-layout.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

// two eyes 64 mm apart at the head, looking along -Z (yaw: turned to the left by yaw radians), a Quest-like ~100 degree vertical field
const eyes = (yaw = 0, head = { x: 0, y: 1.6, z: 0 }) => [-0.032, 0.032].map(dx => {
  const c = new THREE.PerspectiveCamera(100, 1, 0.01, 50);
  c.position.set(head.x + dx * Math.cos(yaw), head.y, head.z - dx * Math.sin(yaw)); c.rotation.set(0, yaw, 0); c.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse).elements.slice();
});
// the frame of a section: 0.24 m square (makePlane h = 0.12) facing +X at centre c, scaled by s (world metres per holder unit is folded into s)
const frame = (c, s = 1, h = 0.12) => [[0, -h, -h], [0, h, -h], [0, h, h], [0, -h, h], [0, 0, 0]].map(([x, y, z]) => ({ x: c.x + x * s, y: c.y + y * s, z: c.z + z * s }));
const C = { x: 0, y: 1.6 - VOLUME_DOWN, z: -VOLUME_FWD }; // the volume in front of the viewer

describe('frameOutOfView (pure)', () => {
  it('a frame on the volume in front of the viewer is in view; behind the head / far to the side / above is out', () => {
    expect(frameOutOfView(frame(C), eyes())).toBe(false);
    expect(frameOutOfView(frame({ x: 0.1, y: 1.4, z: 0.5 }), eyes())).toBe(true);   // behind the shoulder
    expect(frameOutOfView(frame({ x: 1.5, y: 1.5, z: -0.1 }), eyes())).toBe(true);  // far to the right, level with the head
    expect(frameOutOfView(frame({ x: 0, y: 3.2, z: -0.2 }), eyes())).toBe(true);    // high above
  });
  it('one corner in view (either eye) keeps it in view', () => {
    const m = eyes();
    // move a frame out to the right until it is just out, then back by a little: only a corner pokes into the view
    let x = 0.3; while (!frameOutOfView(frame({ x, y: 1.5, z: -0.5 }), m)) x += 0.01;
    const back = frame({ x: x - 0.02, y: 1.5, z: -0.5 });
    expect(frameOutOfView(back, m)).toBe(false);
    expect(back.filter(p => m.some(e => pointInView(p, e))).length).toBeGreaterThanOrEqual(1);
    expect(frameOutOfView(back, [m[1]])).toBe(false); // the right eye alone sees it
  });
  it('the margin: a corner just outside the eye frustum still counts as in view (10 % in NDC)', () => {
    expect(OUT_OF_VIEW_MARGIN).toBe(0.1);
    const [e] = eyes(); const p = { x: 0, y: 1.6, z: -1 }; const t = Math.tan(50 * Math.PI / 180); // the half-height of the view at 1 m
    expect(pointInView({ ...p, y: 1.6 + t * 1.05 }, e)).toBe(true);
    expect(pointInView({ ...p, y: 1.6 + t * 1.05 }, e, 0)).toBe(false);
    expect(pointInView({ ...p, y: 1.6 + t * 1.2 }, e)).toBe(false);
  });
  it('a frame held so close that it covers the view (its corners all outside the frustum) is NOT out of view: the centre is checked too', () => {
    const near = frame({ x: 0, y: 1.6, z: -0.02 }); // 2 cm in front of the eyes; the frame faces +X: turn the viewer so it faces it
    const m = eyes(-Math.PI / 2, { x: -0.03, y: 1.6, z: -0.02 });
    expect(near.slice(0, 4).every(p => m.every(e => !pointInView(p, e)))).toBe(true);
    expect(frameOutOfView(near, m)).toBe(false);
  });
  it('the head turned away: the same frame is out of view; no XR eyes / no points = never out', () => {
    expect(frameOutOfView(frame(C), eyes(Math.PI))).toBe(true);
    expect(frameOutOfView(frame(C), [])).toBe(false);
    expect(frameOutOfView([], eyes())).toBe(false);
    expect(frameOutOfView(frame(C), [[1, 2, 3]])).toBe(false);
  });
});

describe('the out-of-view release in vr-view.js', () => {
  const t = src.slice(src.indexOf('const tryFling='), src.indexOf('const tryFling=') + 1600);
  it('deletes through the same undoable deleteSection, only when the throw did not, with the throw\'s exclusions (grip / two-hand / volume grab)', () => {
    expect(t).toContain('const blocked=!!dg.volTouched||!!twoHand||grabbing.size>0');
    expect(t).toContain("if(!r.fling&&!blocked&&outOfViewRelease(dg.oov,now))r={...r,fling:true,reason:'out-of-view'}");
    expect(t).toContain("return deleteSection(dg.pl,{c,vel:m.v,front:r.reason==='out-of-view'})");
    expect(t.indexOf('outOfViewRelease(dg.oov,now)')).toBeLessThan(t.indexOf('if(!r.fling)return false'));
  });
  it('is judged every frame of the drag (not at the release alone): the drag loop feeds dg.oov with out of view + distance', () => {
    expect(src).toContain('if(dg&&planes.includes(dg.pl))(dg.oov||=createOutOfViewTracker()).update(js0,!dg.volTouched&&sectionOutOfView(dg.pl))');
    const s = src.slice(src.indexOf('const sectionOutOfView='), src.indexOf('const tryFling='));
    expect(s).toContain('return outOfViewNow(true,oovPts[4].distanceTo(oovC))');
    expect(s).not.toMatch(/\.slice\(\)|\.map\(k=>/); // no per-frame allocation of the eye matrices
  });
  it('the undo board of an out-of-view delete comes up in front of the face (head + forward 0.45 m), not at the hand behind the shoulder', () => {
    const u = src.slice(src.indexOf('const showUndoBoard='), src.indexOf('const deleteSection='));
    expect(u).toContain('const showUndoBoard=(c,n,front=false)=>{');
    expect(u).toContain('if(c&&!front){c.getWorldPosition(tmpFv)}else{readHead();tmpFv.copy(head).addScaledVector(headFwd,0.45)');
    expect(src).toContain('secUndo.push(snap,performance.now());showUndoBoard(c,i+1,front);');
  });
  it('the frame points are its 4 corners (square(h) of makePlane, h = 0.12) + the centre, against every XR eye', () => {
    expect(src).toContain('const square=(h)=>new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-h,-h),new THREE.Vector3(0,h,-h),new THREE.Vector3(0,h,h),new THREE.Vector3(0,-h,h)]);');
    expect(src).toContain('h=0.12; // ');
    const s = src.slice(src.indexOf('const sectionOutOfView='), src.indexOf('const tryFling='));
    expect(s).toContain('[[0,-h,-h],[0,h,-h],[0,h,h],[0,-h,h],[0,0,0]]'); expect(s).toContain('const h=0.12;');
    expect(s).toContain('oovM.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse)');
  });
  it('「元に戻す」 (the undo board and the menu / ring undo) brings it back: deleteSection keeps the snapshot, restoreSection is what both call', () => {
    const d = src.slice(src.indexOf('const deleteSection='), src.indexOf('const restoreSection='));
    expect(d).toContain('secUndo.push(snap,performance.now())');
    expect(src).toContain("case'undo':if(secUndo.peek(performance.now()))restoreSection(c);else undoLast();break;");
    expect(src).toContain('if(bd.undoBtn){restoreSection(c);return}');
  });
  it('inside the view a slow release is kept (the throw decides): out of view is never asked when the frame is seen', () => {
    // the decision order of tryFling, replayed: a slow release inside the view
    const from = { x: C.x + 0.1, y: C.y, z: C.z }, v = { x: 0.3, y: 0, z: 0 }; // outward, slowly
    expect(flingDecision({ v, from, center: C, head: { x: 0, y: 1.6, z: 0 } })).toMatchObject({ fling: false, reason: 'slow' });
    const inView = !frameOutOfView(frame(from), eyes());
    expect(inView).toBe(true); // -> no out-of-view delete: the section stays
    // the same slow release behind the shoulder: out of view -> deleted
    expect(frameOutOfView(frame({ x: 0.1, y: 1.4, z: 0.5 }), eyes())).toBe(true);
  });
  it('?debug says why: 視界の外で離した', () => {
    expect(flingDebugLines({ fling: true, reason: 'out-of-view', speed: 0.2, cos: -0.5 }, true)[0]).toBe('投げ判定: 削除した（視界の外で離した）');
    expect(flingDebugLines({ fling: true, reason: 'out-of-view', speed: 0.2, cos: -0.5 }, false)[0]).toBe('Throw: deleted (released out of view)');
    expect(flingDebugLines({ fling: true, reason: 'fling', speed: 3, cos: 0.9 }, true)[0]).toBe('投げ判定: 削除した');
  });
});

describe('out of view for long enough, far enough (review: one frame is not enough)', () => {
  it('constants: 200 ms, 0.35 m', () => { expect(OUT_OF_VIEW_HOLD_MS).toBe(200); expect(OUT_OF_VIEW_MIN_DIST_M).toBe(0.35); });
  it('a run of out-of-view frames shorter than 200 ms is kept; 200 ms or more deletes', () => {
    const t = createOutOfViewTracker();
    for (let f = 0; f <= 10; f++) t.update(1000 + f * 14, true); // 140 ms
    expect(outOfViewRelease(t, 1140)).toBe(false);
    for (let f = 11; f <= 15; f++) t.update(1000 + f * 14, true); // 210 ms
    expect(outOfViewRelease(t, 1210)).toBe(true);
  });
  it('one frame in view breaks the run (it starts again)', () => {
    const t = createOutOfViewTracker();
    for (let f = 0; f <= 12; f++) t.update(f * 14, true);
    t.update(13 * 14, false);
    for (let f = 14; f <= 20; f++) t.update(f * 14, true);
    expect(t.heldMs(20 * 14)).toBe(6 * 14); expect(outOfViewRelease(t, 20 * 14)).toBe(false);
  });
  it('the last frame in view = kept, however long it was out before', () => {
    const t = createOutOfViewTracker(); for (let f = 0; f < 40; f++) t.update(f * 14, true); t.update(40 * 14, false);
    expect(outOfViewRelease(t, 40 * 14)).toBe(false);
  });
  it('no tracker (no frame of the drag was judged) = kept', () => { expect(outOfViewRelease(undefined, 500)).toBe(false); });
  it('nearer than 0.35 m to the head never counts as out of view (a frame held against the face)', () => {
    expect(outOfViewNow(true, 0.2)).toBe(false); expect(outOfViewNow(true, 0.34)).toBe(false);
    expect(outOfViewNow(true, 0.35)).toBe(true); expect(outOfViewNow(true, 0.8)).toBe(true);
    expect(outOfViewNow(false, 0.8)).toBe(false); expect(outOfViewNow(true, NaN)).toBe(false);
    // a frame just behind the ear, 0.25 m away: out of the frustums, but too near -> kept even after 1 s
    const near = frame({ x: 0.2, y: 1.6, z: 0.12 }); expect(frameOutOfView(near, eyes())).toBe(true);
    const d = Math.hypot(0.2, 0, 0.12), t = createOutOfViewTracker();
    for (let f = 0; f < 72; f++) t.update(f * 14, outOfViewNow(frameOutOfView(near, eyes()), d));
    expect(outOfViewRelease(t, 71 * 14)).toBe(false);
  });
});
