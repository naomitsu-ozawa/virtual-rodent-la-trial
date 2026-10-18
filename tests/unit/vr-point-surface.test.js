import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { POINT_MODES, normalizePointMode, resolveTriggerTarget, surfaceRayHit, surfaceVoxelFromHit, createStickGate, recordVrPoint, localToVoxel, voxelToLocal } from '../../docs/vr-point.js';
import { createSurfaceCursor, surfaceCursorSizes, SURFACE_CURSOR_MIN_CORE_RAD, SURFACE_CURSOR_COLOR, VR_MARKER_COLOR, VR_MARKER_FILL, VR_HALO_SELECTED } from '../../docs/vr-point-markers.js';
import { setComments, getComments, addComment, commentTarget } from '../../docs/comments.js';
import { datasetFingerprint } from '../../docs/project-file.js';

// synthetic data only (no real scan). 16^3 classification grid in a box of +-1 (one voxel = 0.125); channel 0 = tissue (>= 128).
const N = 16, C = 2, halfExt = [1, 1, 1], clsDims = [N, N, N], dims = { columns: N, rows: N, slices: N };
const at = (x, y, z) => (x + N * (y + N * z)) * C;
const tissue = pred => { const data = new Uint8Array(N * N * N * C); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (pred(x, y, z)) data[at(x, y, z)] = 255; return { data, C, chan: [0, 1, -1, -1] }; };
const wall = tissue(x => x >= 8 && x <= 11); // a slab: x voxels 8..11 (object x in [0, 0.5))
const ray = { o: { x: -3, y: 0.0625, z: 0.0625 }, q: { x: 1, y: 0, z: 0 } }; // along +x through voxel row y=7, slice z=8
const base = { halfExt, dims, cls: wall, clsDims, chs: [0] };
const mk = uid => ({ id: 's::' + uid, description: 'synthetic', modality: 'CT', columns: N, rows: N, spacingX: 1, spacingY: 1, spacingZ: 1, slices: Array.from({ length: N }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: uid })) });
const fp = datasetFingerprint(mk('1'));
const store = { getComments, addComment };
beforeEach(() => setComments([]));

describe('surface mode: the mode value', () => {
  it('two modes; anything but "surface" is the default 断面 (the current behaviour)', () => {
    expect(POINT_MODES).toEqual(['section', 'surface']);
    expect(normalizePointMode('surface')).toBe('surface');
    expect(normalizePointMode('section')).toBe('section');
    expect(normalizePointMode(undefined)).toBe('section');
    expect(normalizePointMode(null)).toBe('section');
    expect(normalizePointMode(1)).toBe('section');
  });
  it('switching the mode only changes what the nearest target means (the same input, two answers)', () => {
    const input = { plane: { t: 1 }, tissue: { t: 2 } };
    expect(resolveTriggerTarget({ ...input, mode: 'section' })).toMatchObject({ kind: 'record', ref: { t: 1 } });
    expect(resolveTriggerTarget({ ...input, mode: 'surface' })).toMatchObject({ kind: 'record', ref: { t: 2 } });
    expect(resolveTriggerTarget({ ...input })).toMatchObject({ ref: { t: 1 } }); // no mode given = 断面
  });
});

describe('trigger resolution per mode (board > ring > move > tag > nearest of point / band / target)', () => {
  it('断面: only a plane hit records; a tissue hit alone does nothing', () => {
    expect(resolveTriggerTarget({ tissue: { t: 1 }, mode: 'section' }).kind).toBe('tissue'); // build 484: stops the laser, records nothing
    expect(resolveTriggerTarget({ plane: { t: 1 }, mode: 'section' }).kind).toBe('record');
  });
  it('表面: only a tissue hit records; a plane hit alone does nothing (the plane never steals the ray)', () => {
    expect(resolveTriggerTarget({ plane: { t: 1 }, mode: 'surface' }).kind).toBe('none');
    expect(resolveTriggerTarget({ plane: { t: 1 }, tissue: { t: 2 }, mode: 'surface' })).toMatchObject({ kind: 'record', ref: { t: 2 } });
    expect(resolveTriggerTarget({ mode: 'surface' }).kind).toBe('none');
  });
});

describe('surface hit -> voxel -> record', () => {
  it('the first voxel of a shown segment the ray meets is the surface point', () => {
    const h = surfaceRayHit(ray.o, ray.q, base);
    expect(h.voxel).toEqual({ i: 8, j: 7, k: 8 });
    expect(h.point.x).toBeGreaterThan(-0.0626); expect(h.point.x).toBeLessThan(0.07);
    expect(h.ch).toBe(0);
  });
  it('from the other side the first voxel is the other face of the slab', () => {
    const h = surfaceRayHit({ x: 3, y: 0.0625, z: 0.0625 }, { x: -1, y: 0, z: 0 }, base);
    expect(h.voxel.i).toBe(11); expect(h.voxel).toMatchObject({ j: 7, k: 8 });
  });
  it('nothing shown / ray misses the tissue / no data = null (nothing to record)', () => {
    expect(surfaceRayHit(ray.o, ray.q, { ...base, chs: [1] })).toBe(null);
    expect(surfaceRayHit(ray.o, ray.q, { ...base, chs: [] })).toBe(null);
    expect(surfaceRayHit(ray.o, ray.q, { ...base, cls: null })).toBe(null);
    expect(surfaceRayHit({ x: -3, y: 0.0625, z: 5 }, ray.q, base)).toBe(null);
  });
  it('recorded as the usual voxel position comment "VR ポイント N" (no schema change)', () => {
    const h = surfaceRayHit(ray.o, ray.q, base);
    const c = recordVrPoint({ voxel: h.voxel, series: fp, store });
    expect(c.text).toBe('VR ポイント 1');
    expect(commentTarget(c, { columns: N, rows: N, slices: N })).toMatchObject({ i: 8, j: 7, k: 8 });
    expect(Object.keys(c.position).sort()).toEqual(['i', 'j', 'k']);
    expect(recordVrPoint({ voxel: surfaceRayHit(ray.o, ray.q, base).voxel, series: fp, store }).text).toBe('VR ポイント 2');
  });
  it('a coarser classification grid maps to the data voxel under the hit point', () => {
    // data 32^3, classification 16^3: the hit voxel is in the finer grid
    const fine = { columns: 32, rows: 32, slices: 32 };
    const h = surfaceRayHit(ray.o, ray.q, { ...base, dims: fine });
    expect(h.voxel).toEqual(localToVoxel(h.point, halfExt, fine));
    expect(h.voxel.i).toBe(16);
  });
  it('the point rounding outside the box falls back to the centre of the classification voxel', () => {
    const v = surfaceVoxelFromHit({ t: 0, x: 15, y: 0, z: 3 }, { x: 1, y: 1.0, z: 0 }, { x: 0, y: 0, z: 0 }, { halfExt, dims: { columns: 32, rows: 32, slices: 32 }, clsDims });
    expect(v).toEqual({ i: 31, j: 1, k: 7 });
    expect(surfaceVoxelFromHit(null, ray.o, ray.q, { halfExt, dims, clsDims })).toBe(null);
  });
});

describe('a face cut by a clipping section is a surface too', () => {
  // keep x >= 0.3 (kept side n.p - w >= 0 with n = (1,0,0), w = 0.3): the slab x in [0, 0.5) is cut to [0.3, 0.5)
  const planes = [{ x: 1, y: 0, z: 0, w: 0.3 }];
  it('clipping: the first voxel on the kept side, found at the cut', () => {
    const h = surfaceRayHit(ray.o, ray.q, { ...base, planes, count: 1, cut: 1 });
    expect(h.voxel.i).toBe(10); // x = 0.3 lies in voxel 10 (0.25..0.375)
    expect(h.point.x).toBeGreaterThanOrEqual(0.3 - 1e-9);
  });
  it('a non-clipping section changes nothing (the original surface)', () => {
    expect(surfaceRayHit(ray.o, ray.q, { ...base, planes, count: 1, cut: 0 }).voxel.i).toBe(8);
  });
  it('a cut that removes all tissue on the ray leaves nothing to record', () => {
    expect(surfaceRayHit(ray.o, ray.q, { ...base, planes: [{ x: 1, y: 0, z: 0, w: 0.9 }], count: 1, cut: 1 })).toBe(null);
  });
  it('seen from the removed side the cut face is hit, not the hidden tissue behind it', () => {
    const h = surfaceRayHit({ x: -3, y: 0.0625, z: 0.0625 }, { x: 1, y: 0, z: 0 }, { ...base, planes: [{ x: 1, y: 0, z: 0, w: 0.45 }], count: 1, cut: 1 });
    expect(h.voxel.i).toBe(11);
  });
});

describe('thumbstick gate in surface mode (same rule as 断面: dead zone 0.15, 0.3 s hold-off)', () => {
  it('no recording while the stick is out, nor for 0.3 s after; the surface decision itself is not gated', () => {
    const g = createStickGate();
    expect(resolveTriggerTarget({ tissue: { t: 1 }, mode: 'surface' }).kind).toBe('record');
    expect(g.update(0, 0.5, 0)).toBe(false);
    expect(g.canRecord(10)).toBe(false);
    g.update(0, 0.1, 100); // back inside the dead zone
    expect(g.canRecord(299)).toBe(false);
    expect(g.canRecord(300)).toBe(true);
    expect(g.update(0.15, 0, 500)).toBe(true); // exactly on the dead zone = still at rest
    expect(g.update(0.151, 0, 600)).toBe(false);
  });
  it('the hands are independent', () => {
    const l = createStickGate(), r = createStickGate();
    l.update(1, 0, 0);
    expect(l.canRecord(10)).toBe(false); expect(r.canRecord(10)).toBe(true);
  });
});

describe('point cursor (a small dot only: no ring, no glow; both modes)', () => {
  it('is lime, different from the point markers and the halo', () => {
    for (const c of [VR_MARKER_COLOR, VR_MARKER_FILL, VR_HALO_SELECTED]) expect(SURFACE_CURSOR_COLOR).not.toBe(c);
  });
  it('dot = about one voxel wide but never below the minimum angular size; no ring size any more', () => {
    expect(surfaceCursorSizes(0.5, 0.01).core).toBeCloseTo(0.005, 9); // 1 voxel wide = 0.5 voxel radius
    expect(surfaceCursorSizes(2, 0.0001).core).toBeCloseTo(2 * SURFACE_CURSOR_MIN_CORE_RAD, 9); // tiny voxel: the minimum on-screen size wins
    expect(surfaceCursorSizes(0.5, 0.002).core).toBeLessThan(0.01); // small: well under a centimetre at arm's length
    expect(surfaceCursorSizes(0.5, 0.002).ring).toBeUndefined();
  });
  it('the core sits exactly on the recorded voxel centre; no glow object', () => {
    const scene = new THREE.Scene(), cur = createSurfaceCursor(THREE, scene);
    const h = surfaceRayHit(ray.o, ray.q, base), centre = voxelToLocal(h.voxel, halfExt, dims);
    expect(cur.group.visible).toBe(false);
    cur.set(centre, { x: 0, y: 0, z: -1 }, 0.125);
    expect(cur.group.visible).toBe(true);
    expect(cur.group.position.toArray().map(v => +v.toFixed(6))).toEqual([centre.x, centre.y, centre.z].map(v => +v.toFixed(6)));
    expect(cur.core.position.length()).toBe(0); // the core is at the group's origin = the voxel centre
    expect(cur.group.children.length).toBe(1); // the dot only (build 470: no ring)
    expect(cur.group.children.every(m => m.material.blending !== THREE.AdditiveBlending)).toBe(true);
    expect(localToVoxel(centre, halfExt, dims)).toEqual(h.voxel); // the shown centre is inside the recorded voxel
    cur.set(null);
    expect(cur.group.visible).toBe(false);
    cur.dispose();
    expect(scene.children.length).toBe(0);
  });
});
