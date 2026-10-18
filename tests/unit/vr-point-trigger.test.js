import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createStickGate, deleteSelected, undoDelete, raySphereT, pickPoint, sectionRelation, halfVoxelAlong, voxelSize, pointIsHidden, voxelToLocal, recordVrPoint } from '../../docs/vr-point.js';
import { markerStyle, createVrPointMarkers } from '../../docs/vr-point-markers.js';
import { marchClassificationHitInfo } from '../../docs/vr-pick.js';
import { setComments, getComments, addComment, createComment, removeComment, restoreComment, getMarkersShown } from '../../docs/comments.js';
import { datasetFingerprint } from '../../docs/project-file.js';

// synthetic data only (no real scan)
const mk = uid => ({ id: 's::' + uid, description: 'synthetic', modality: 'CT', columns: 10, rows: 8, spacingX: 1, spacingY: 1, spacingZ: 2, slices: Array.from({ length: 6 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: uid })) });
const fp = datasetFingerprint(mk('1'));
const store = { getComments, addComment, removeComment, restoreComment };
beforeEach(() => setComments([]));

// the trigger priority (resolveTriggerTarget) is tested in vr-point-gesture.test.js

describe('thumbstick gate: no recording while the stick is outside the dead zone nor for 0.3 s after it is back in the centre', () => {
  it('a stick that never moved records', () => {
    const g = createStickGate();
    expect(g.canRecord(0)).toBe(true);
    expect(g.update(0, 0, 10)).toBe(true);
  });
  it('blocked while outside the dead zone (either axis, or the diagonal)', () => {
    const g = createStickGate();
    expect(g.update(0, 0.5, 0)).toBe(false);
    expect(g.canRecord(1000)).toBe(false); // however long it is held
    expect(g.update(0.5, 0, 1000)).toBe(false);
    expect(g.update(0.11, 0.11, 2000)).toBe(false); // length 0.156 > 0.15
    expect(g.update(0.1, 0.1, 2100)).toBe(false); // length 0.141: inside, but 100 ms after the last frame outside
    expect(g.update(0.1, 0.1, 2300)).toBe(true);
  });
  it('after the return to the centre, recording opens exactly 300 ms after the last frame outside', () => {
    const g = createStickGate();
    g.update(0, -0.8, 1000);
    g.update(0, 0, 1016); // back inside
    expect(g.canRecord(1016)).toBe(false);
    expect(g.canRecord(1299)).toBe(false);
    expect(g.canRecord(1300)).toBe(true);
    expect(g.update(0, 0, 1400)).toBe(true);
  });
  it('leaving the centre again restarts the hold-off', () => {
    const g = createStickGate();
    g.update(0, 0.9, 0); g.update(0, 0, 16);
    expect(g.canRecord(316)).toBe(true);
    g.update(0, 0.9, 400); // pushed again
    expect(g.canRecord(420)).toBe(false);
    g.update(0, 0, 420);
    expect(g.canRecord(699)).toBe(false);
    expect(g.canRecord(700)).toBe(true);
  });
  it('the dead zone edge itself is inside (length 0.15 is not active); NaN / missing axes count as 0; reset opens the gate', () => {
    const g = createStickGate();
    expect(g.update(0.15, 0, 0)).toBe(true);
    expect(g.update(undefined, NaN, 5)).toBe(true);
    g.update(1, 0, 10); g.reset();
    expect(g.canRecord(10)).toBe(true);
  });
  it('one gate per hand: the state is not shared', () => {
    const l = createStickGate(), r = createStickGate();
    l.update(0, 1, 0);
    expect(l.canRecord(10)).toBe(false); expect(r.canRecord(10)).toBe(true);
  });
});

describe('select, delete, undo = the same store operations as the 2D list', () => {
  const three = () => ['a', 'b', 'c'].map((t, n) => addComment(createComment({ text: t, position: { i: n, j: 1, k: 1 }, series: fp, id: 'id' + t })));
  it('deleteSelected removes that comment only and returns what the undo needs; undo restores it at its place', () => {
    three();
    const d = deleteSelected('idb', store);
    expect(d.c.id).toBe('idb'); expect(d.index).toBe(1);
    expect(getComments().map(c => c.id)).toEqual(['ida', 'idc']);
    expect(undoDelete(d, store)).toBe(true);
    expect(getComments().map(c => c.id)).toEqual(['ida', 'idb', 'idc']);
    expect(getComments()[1].position).toEqual({ i: 1, j: 1, k: 1 });
  });
  it('nothing selected / unknown id: nothing is deleted; a second undo does nothing', () => {
    three();
    expect(deleteSelected(null, store)).toBe(null);
    expect(deleteSelected('nope', store)).toBe(null);
    expect(getComments()).toHaveLength(3);
    const d = deleteSelected('ida', store);
    expect(undoDelete(d, store)).toBe(true);
    expect(undoDelete(d, store)).toBe(false); // already back
    expect(undoDelete(null, store)).toBe(false);
    expect(getComments()).toHaveLength(3);
  });
  it('a VR point recorded earlier can be deleted and restored; numbering by the highest number never repeats', () => {
    const r1 = recordVrPoint({ voxel: { i: 1, j: 1, k: 1 }, series: fp, store }), r2 = recordVrPoint({ voxel: { i: 2, j: 1, k: 1 }, series: fp, store });
    expect([r1.text, r2.text]).toEqual(['VR ポイント 1', 'VR ポイント 2']);
    const d = deleteSelected(r2.id, store);
    undoDelete(d, store);
    expect(getComments().map(c => c.text)).toEqual(['VR ポイント 1', 'VR ポイント 2']);
  });
});

describe('laser against a point', () => {
  it('ray-sphere distance; a miss and a sphere behind the origin give null; inside gives the exit', () => {
    const o = { x: 0, y: 0, z: 0 }, d = { x: 0, y: 0, z: -1 };
    expect(raySphereT(o, d, { x: 0, y: 0, z: -2 }, 0.5)).toBeCloseTo(1.5, 9);
    expect(raySphereT(o, d, { x: 1, y: 0, z: -2 }, 0.5)).toBe(null);
    expect(raySphereT(o, d, { x: 0, y: 0, z: 2 }, 0.5)).toBe(null);
    expect(raySphereT(o, d, { x: 0, y: 0, z: -0.1 }, 0.5)).toBeCloseTo(0.6, 9);
  });
  it('pickPoint takes the nearest one', () => {
    const items = [{ id: 'far', center: { x: 0, y: 0, z: -3 }, radius: 0.2 }, { id: 'near', center: { x: 0, y: 0.05, z: -1 }, radius: 0.2 }, { id: 'off', center: { x: 2, y: 0, z: -1 }, radius: 0.2 }];
    expect(pickPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, items).id).toBe('near');
    expect(pickPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, items)).toBe(null);
  });
});

describe('distance from the active section (within half a voxel = on the section) and the perpendicular', () => {
  const dims = { columns: 10, rows: 8, slices: 6 }, halfExt = [5, 4, 6]; // voxels 1 x 1 x 2 units
  it('voxel size and the half thickness along a normal', () => {
    expect(voxelSize(halfExt, dims)).toEqual([1, 1, 2]);
    expect(halfVoxelAlong({ x: 1, y: 0, z: 0 }, [1, 1, 2])).toBeCloseTo(0.5, 9);
    expect(halfVoxelAlong({ x: 0, y: 0, z: 1 }, [1, 1, 2])).toBeCloseTo(1, 9); // thicker along z
  });
  it('axis-aligned section x = 0.3: a point within half a voxel is ON, beyond it OFF', () => {
    const plane = { x: 1, y: 0, z: 0, w: 0.3 };
    const on = sectionRelation({ x: 0.7, y: 1, z: 1 }, plane, halfExt, dims); // distance 0.4 <= 0.5
    expect(on.onSection).toBe(true); expect(on.distance).toBeCloseTo(0.4, 9);
    const edge = sectionRelation({ x: 0.8, y: 1, z: 1 }, plane, halfExt, dims); // exactly 0.5
    expect(edge.onSection).toBe(true);
    const off = sectionRelation({ x: 1.5, y: 1, z: 1 }, plane, halfExt, dims); // 1.2
    expect(off.onSection).toBe(false); expect(off.distance).toBeCloseTo(1.2, 9);
  });
  it('the foot of the perpendicular lies on the plane and the line is along the normal; the sign says the side', () => {
    const plane = { x: 0, y: 1, z: 0, w: -1 };
    const r = sectionRelation({ x: 2, y: -3, z: 1 }, plane, halfExt, dims);
    expect(r.distance).toBeCloseTo(-2, 9);
    expect(r.foot).toEqual({ x: 2, y: -1, z: 1 });
    const r2 = sectionRelation({ x: 2, y: 1, z: 1 }, plane, halfExt, dims);
    expect(r2.distance).toBeCloseTo(2, 9); expect(r2.foot.y).toBeCloseTo(-1, 9);
  });
  it('an oblique plane: distance is along the unit normal, the foot is on the plane; a non-unit normal is normalised', () => {
    const s = Math.SQRT1_2, plane = { x: 2 * s, y: 2 * s, z: 0, w: 0 }; // length 2
    const r = sectionRelation({ x: 3, y: 1, z: 0 }, plane, halfExt, dims);
    expect(r.distance).toBeCloseTo(4 * s, 9);
    expect(r.foot.x * s + r.foot.y * s).toBeCloseTo(0, 9);
    expect(r.onSection).toBe(false);
  });
  it('a voxel centre exactly on a section is on it (distance 0, foot = itself)', () => {
    const p = voxelToLocal({ i: 4, j: 3, k: 2 }, halfExt, dims);
    const r = sectionRelation(p, { x: 1, y: 0, z: 0, w: p.x }, halfExt, dims);
    expect(r.onSection).toBe(true); expect(Math.abs(r.distance)).toBeLessThan(1e-12);
  });
});

describe('hidden behind tissue: from the point to the head, a shown-segment voxel before the head = hidden', () => {
  // 16^3 grid in a box of +-1; channel 0 = tissue (>= 128). A wall at x voxels 8..9 (object x in [0, 0.25)), full in y / z.
  const N = 16, C = 2, data = new Uint8Array(N * N * N * C), dims = [N, N, N], halfExt = [1, 1, 1];
  const at = (x, y, z) => (x + N * (y + N * z)) * C;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (const x of [8, 9]) data[at(x, y, z)] = 255;
  const cls = { data, C };
  const base = { cls, dims, halfExt, chs: [0], planes: [], count: 0, cut: 0 };
  const P = (x, y = 0, z = 0) => ({ x, y, z });
  it('a wall between the point and the head: hidden; the head on the same side as the point: exposed', () => {
    expect(pointIsHidden(P(-0.5), P(0.9), base)).toBe(true);
    expect(pointIsHidden(P(-0.5), P(-0.9), base)).toBe(false);
    expect(pointIsHidden(P(0.6), P(-0.9), base)).toBe(true); // from the other side
  });
  it('the head can be outside the box; the march stops at the head, so tissue beyond the head does not hide a point', () => {
    expect(pointIsHidden(P(-0.5), P(5), base)).toBe(true);
    expect(pointIsHidden(P(0.6), P(0.9), base)).toBe(false); // wall is behind the point (head is further right)
    expect(pointIsHidden(P(-0.9), P(-0.6), base)).toBe(false); // head is before the wall
  });
  it('the point\'s own voxel does not hide it (a point inside tissue seen from the open side is exposed)', () => {
    // a point at the surface voxel x = 9 (object 0.125..0.25): the head is on the right, no tissue to the right of it
    expect(pointIsHidden(P(0.2), P(0.9), base)).toBe(false);
    // the same point seen from the left has the whole voxel x = 8 in the way
    expect(pointIsHidden(P(0.2), P(-0.9), base)).toBe(true);
  });
  it('only the shown channels count; nothing shown / no data = exposed', () => {
    expect(pointIsHidden(P(-0.5), P(0.9), { ...base, chs: [1] })).toBe(false);
    expect(pointIsHidden(P(-0.5), P(0.9), { ...base, chs: [] })).toBe(false);
    expect(pointIsHidden(P(-0.5), P(0.9), { ...base, cls: null })).toBe(false);
    expect(pointIsHidden(P(0.1), P(0.1), base)).toBe(false); // head on the point
  });
  it('a clipping section that removes the wall un-hides the point (tissue on the cut side does not count)', () => {
    // plane keeps x < -0.2 side?  kept side is n.p - w >= 0: n = (-1,0,0), w = 0.2 keeps x <= -0.2
    const planes = [{ x: -1, y: 0, z: 0, w: 0.2 }];
    expect(pointIsHidden(P(-0.5), P(0.9), { ...base, planes, count: 1, cut: 1 })).toBe(false);
    expect(pointIsHidden(P(-0.5), P(0.9), { ...base, planes, count: 1, cut: 0 })).toBe(true); // a non-clipping section changes nothing
  });
  it('the added tMin / tMax of marchClassificationHitInfo leave the default march as it was', () => {
    const o = P(-0.95), q = { x: 1.9, y: 0, z: 0 };
    const a = marchClassificationHitInfo(o, q, halfExt, dims, cls, [0]), b = marchClassificationHitInfo(o, q, halfExt, dims, cls, [0], [], 0, 0, 0, Infinity);
    expect(b).toEqual(a); expect(a.x).toBe(8);
    expect(marchClassificationHitInfo(o, q, halfExt, dims, cls, [0], [], 0, 0, 0, 0.4)).toBe(null); // stops before the wall (t = 0.4 is x = -0.19)
  });
});

describe('marker style (exposed solid + white rim, hidden dot, on / off the section, halos)', () => {
  it('exposed = solid with a rim; hidden = a dot without a rim; the SAME small size in every state (build 471)', () => {
    const e = markerStyle({}), h = markerStyle({ hidden: true });
    expect(e).toMatchObject({ fill: 'solid', rim: true, scale: 0.4 });
    expect(h).toMatchObject({ fill: 'dot', rim: false, scale: 0.4 });
    for (const hidden of [false, true]) for (const section of [null, 'on', 'off']) expect(markerStyle({ hidden, section }).scale).toBe(0.4);
  });
  it('on the section: no perpendicular and no enlargement; off the section: a perpendicular; no active section: neither', () => {
    const on = markerStyle({ section: 'on' }), off = markerStyle({ section: 'off' }), none = markerStyle({ section: null });
    expect(on.scale).toBe(off.scale); expect(on.perpendicular).toBe(false);
    expect(off.perpendicular).toBe(true);
    expect(none.perpendicular).toBe(false); expect(none.scale).toBe(off.scale);
  });
  it('halo: selected (yellow) wins over hover (white)', () => {
    expect(markerStyle({ hover: true }).halo).toBe('hover');
    expect(markerStyle({ selected: true }).halo).toBe('selected');
    expect(markerStyle({ hover: true, selected: true }).halo).toBe('selected');
    expect(markerStyle({}).halo).toBe(null);
  });
});

describe('markers in the scene: hidden / section / halo / pick', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
  const dims = { columns: 10, rows: 8, slices: 6 }, halfExt = [5, 4, 6], deps = { getComments, getMarkersShown };
  const globalDoc = globalThis.document;
  beforeEach(() => { globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } });
  const finish = () => { globalThis.document = globalDoc };
  it('on-section point is the same small size with no line; off-section has a line down to the plane; hidden is the same size, drawn as a dot; the halo follows hover / selected', () => {
    const a = addComment(createComment({ text: 'a', position: { i: 5, j: 3, k: 2 }, series: fp })); // x centre = 0.5
    const b = addComment(createComment({ text: 'b', position: { i: 9, j: 3, k: 2 }, series: fp })); // x centre = 4.5
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(mesh); scene.updateMatrixWorld(true);
    const m = createVrPointMarkers(THREE, scene, deps), plane = { x: 1, y: 0, z: 0, w: 0.5 };
    m.update({ fingerprint: fp, dims, halfExt, mesh, head: new THREE.Vector3(0, 0, 3), section: plane });
    const sph = scene.children.filter(o => o.geometry?.type === 'SphereGeometry' && o.renderOrder === 4), lines = scene.children.filter(o => o.isLine);
    expect(sph).toHaveLength(2);
    expect(sph[0].scale.x).toBeCloseTo(sph[1].scale.x, 9); // a on, b off: the same small size (build 471)
    expect(lines.map(l => l.visible)).toEqual([false, true]);
    const pos = lines[1].geometry.attributes.position; // foot is on x = 0.5 (object) -> the line is horizontal in x
    expect(pos.getY(0)).toBeCloseTo(pos.getY(1), 9); expect(pos.getX(0)).not.toBeCloseTo(pos.getX(1), 3);
    // hidden: the same size
    m.update({ fingerprint: fp, dims, halfExt, mesh, head: new THREE.Vector3(0, 0, 3), section: plane, hidden: new Set([a.id]) });
    expect(sph[0].scale.x).toBeCloseTo(sph[1].scale.x, 9);
    // halos
    const halos = scene.children.filter(o => o.renderOrder === 2);
    m.update({ fingerprint: fp, dims, halfExt, mesh, head: new THREE.Vector3(0, 0, 3), hover: new Set([a.id]), selectedId: b.id });
    expect(halos.map(h => h.visible)).toEqual([true, true]);
    expect(halos[0].material).not.toBe(halos[1].material);
    expect(lines.every(l => !l.visible)).toBe(true); // no section: no perpendicular
    // pick: a ray at the centre of a
    const c = sph[0].position, hit = m.pick({ x: c.x, y: c.y, z: c.z + 1 }, { x: 0, y: 0, z: -1 });
    expect(hit.id).toBe(a.id);
    expect(m.pick({ x: c.x, y: c.y + 1, z: c.z + 1 }, { x: 0, y: 0, z: -1 })).toBe(null);
    expect(m.centres().map(p => p.id)).toEqual([a.id, b.id]);
    m.dispose(); finish();
  });
});
