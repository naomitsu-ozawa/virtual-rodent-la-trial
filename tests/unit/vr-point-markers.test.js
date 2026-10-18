import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { createVrPointMarkers, PICK_MIN_M } from '../../docs/vr-point-markers.js';
import { setComments, getComments, getMarkersShown, setMarkersShown, createComment, addComment } from '../../docs/comments.js';
import { voxelToLocal } from '../../docs/vr-point.js';
import { datasetFingerprint } from '../../docs/project-file.js';

// the temporary VR display: a real 3D sphere + a number chip per comment of the open series (canvas stubbed: no DOM in node)
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
const mk = uid => ({ id: 's::' + uid, description: 'synthetic', modality: 'CT', columns: 10, rows: 8, spacingX: 1, spacingY: 1, spacingZ: 2, slices: Array.from({ length: 6 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: uid })) });
const fp = datasetFingerprint(mk('1')), other = datasetFingerprint(mk('2'));
const dims = { columns: 10, rows: 8, slices: 6 }, halfExt = [5, 4, 6];
const deps = { getComments, getMarkersShown };

beforeEach(() => { vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }); setComments([]); setMarkersShown(true) });
afterEach(() => vi.unstubAllGlobals());

describe('VR position markers', () => {
  it('one sphere + chip per comment of the open series, numbered by the place in the whole list, at the voxel centre in world space', () => {
    addComment(createComment({ text: 'a', position: { i: 2, j: 3, k: 1 }, series: other })); // another series: not shown, but it counts in the list
    addComment(createComment({ text: 'b', position: { i: 7, j: 1, k: 4 }, series: fp }));
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), holder = new THREE.Group();
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.05); holder.add(mesh); scene.add(holder); scene.updateMatrixWorld(true);
    const m = createVrPointMarkers(THREE, scene, deps);
    m.update({ fingerprint: fp, dims, halfExt, mesh, head: new THREE.Vector3(0, 1.6, 0) });
    const spheres = scene.children.filter(o => o.geometry?.type === 'SphereGeometry' && o.renderOrder === 4); // the core (rim / halo spheres are other meshes)
    expect(spheres).toHaveLength(1);
    const l = voxelToLocal({ i: 7, j: 1, k: 4 }, halfExt, dims), want = new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(holder.matrixWorld);
    expect(spheres[0].position.distanceTo(want)).toBeLessThan(1e-9);
    expect(spheres[0].material.depthTest).toBe(false); // always visible (a hidden point is drawn as a small dot, see vr-point-trigger.test.js)
    expect(scene.children.length).toBe(6); // holder + halo + rim + sphere + perpendicular line + chip
    m.dispose(); expect(scene.children.length).toBe(1);
  });
  it('follows the comments: removed / switched off / other series -> nothing left', () => {
    const c = addComment(createComment({ text: 'b', position: { i: 1, j: 1, k: 1 }, series: fp }));
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(mesh); scene.updateMatrixWorld(true);
    const m = createVrPointMarkers(THREE, scene, deps), args = { fingerprint: fp, dims, halfExt, mesh, head: new THREE.Vector3(0, 0, 3) };
    m.update(args); expect(scene.children.length).toBe(6);
    setMarkersShown(false); m.update(args); expect(scene.children.length).toBe(1);
    setMarkersShown(true); m.update(args); expect(scene.children.length).toBe(6);
    m.update({ ...args, fingerprint: other }); expect(scene.children.length).toBe(1);
    m.update(args); setComments([]); m.update(args); expect(scene.children.length).toBe(1);
    void c; m.dispose();
  });
});

describe('pick radius (build 468)', () => {
  it('about 4.7 mm at the default size: a ray 3 mm off hits, 6 mm off does not; the least is PICK_MIN_M', () => {
    addComment(createComment({ text: 'a', position: { i: 5, j: 4, k: 3 }, series: fp }));
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), holder = new THREE.Group();
    holder.scale.setScalar(0.05); holder.add(mesh); scene.add(holder); scene.updateMatrixWorld(true);
    const m = createVrPointMarkers(THREE, scene, deps);
    m.update({ fingerprint: fp, dims, halfExt, mesh, head: new THREE.Vector3(0, 0, 3) });
    const c = m.centres()[0].world, d = new THREE.Vector3(0, 0, -1), at = off => new THREE.Vector3(c.x + off, c.y, c.z + 1);
    expect(m.pick(at(0.003), d)).not.toBeNull();
    expect(m.pick(at(0.006), d)).toBeNull();
    expect(PICK_MIN_M).toBe(0.004);
    m.dispose();
  });
});

describe('preview of a point being moved (build 468)', () => {
  it('drawn at the preview voxel; faint at its old place when the voxel is null', () => {
    addComment(createComment({ text: 'a', position: { i: 1, j: 1, k: 1 }, series: fp, id: 'p1' }));
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(mesh); scene.updateMatrixWorld(true);
    const m = createVrPointMarkers(THREE, scene, deps), base = { fingerprint: fp, dims, halfExt, mesh, head: new THREE.Vector3(0, 0, 3) };
    m.update(base); const home = m.centres()[0].world.clone(); const solid = scene.children.find(o => o.renderOrder === 4).material;
    m.update({ ...base, preview: { id: 'p1', voxel: { i: 7, j: 5, k: 4 } } });
    const l = voxelToLocal({ i: 7, j: 5, k: 4 }, halfExt, dims);
    expect(m.centres()[0].world.distanceTo(new THREE.Vector3(l.x, l.y, l.z))).toBeLessThan(1e-9);
    m.update({ ...base, preview: { id: 'p1', voxel: null } });
    expect(m.centres()[0].world.distanceTo(home)).toBeLessThan(1e-9);
    const ghost = scene.children.find(o => o.renderOrder === 4).material;
    expect(ghost.opacity).toBeCloseTo(0.35); expect(ghost).not.toBe(solid);
    m.dispose();
  });
});

import * as markers from '../../docs/vr-point-markers.js';
describe('one cursor for both modes (build 470)', () => {
  it('the square section cursor is gone', () => {
    expect(markers.createSectionCursor).toBeUndefined(); expect(markers.sectionCursorSize).toBeUndefined();
  });
});
