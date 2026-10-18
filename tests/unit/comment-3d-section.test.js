import { describe, it, expect } from 'vitest';
import { planeRelations, boxHalfExtent, clipSegmentNear, SECTION_EMPHASIS } from '../../docs/comment-3d-section.js';
import { sectionRelation, voxelToLocal } from '../../docs/vr-point.js';
import { voxelToLocal3D } from '../../docs/crosshair.js';
import { sectionPlaneLocal } from '../../docs/comment-3d-hidden.js';

// position cues of the 3D markers relative to the active section: synthetic geometry only
const dims = { columns: 10, rows: 8, slices: 6 }, spacing = [0.2, 0.2, 0.5], halfExt = boxHalfExtent(dims, spacing);
const at = v => voxelToLocal3D(v, dims, spacing);

describe('boxHalfExtent', () => {
  it('= the box of voxelToLocal3D (longest side 3.3)', () => {
    expect(Math.max(...halfExt) * 2).toBeCloseTo(3.3, 9);
    for (const v of [{ i: 0, j: 0, k: 0 }, { i: 9, j: 7, k: 5 }]) {
      const a = at(v), b = voxelToLocal(v, halfExt, dims);
      expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); expect(a.z).toBeCloseTo(b.z, 9);
    }
  });
});

describe('planeRelations (VR sectionRelation, reused)', () => {
  // the axial section through k = 2: normal +z through that slice's centre
  const plane = sectionPlaneLocal({ x: 0, y: 0, z: at({ i: 0, j: 0, k: 2 }).z }, { x: 0, y: 0, z: 1 });
  const pts = [{ id: 'on', local: at({ i: 3, j: 3, k: 2 }) }, { id: 'off', local: at({ i: 4, j: 1, k: 5 }) }, { id: 'next', local: at({ i: 4, j: 1, k: 3 }) }];
  it('a point in the section\'s slice is on it; others are off with their foot on the plane (same x / y, plane z)', () => {
    const r = planeRelations(pts, plane, halfExt, dims);
    expect(r.get('on').on).toBe(true); expect(r.get('off').on).toBe(false); expect(r.get('next').on).toBe(false);
    for (const p of pts) {
      const f = r.get(p.id).foot;
      expect(f.x).toBeCloseTo(p.local.x, 9); expect(f.y).toBeCloseTo(p.local.y, 9); expect(f.z).toBeCloseTo(plane.w, 9);
      expect(r.get(p.id).on).toBe(sectionRelation(p.local, plane, halfExt, dims).onSection);
    }
  });
  it('within half a voxel along the normal counts as on, beyond does not', () => {
    const half = (halfExt[2] * 2 / dims.slices) / 2, z0 = plane.w;
    const near = { id: 'n', local: { x: 0, y: 0, z: z0 + half * 0.9 } }, far = { id: 'f', local: { x: 0, y: 0, z: z0 + half * 1.2 } };
    const r = planeRelations([near, far], plane, halfExt, dims);
    expect(r.get('n').on).toBe(true); expect(r.get('f').on).toBe(false);
  });
  it('no active section (no plane) = no emphasis and no lines', () => {
    expect(planeRelations(pts, null, halfExt, dims).size).toBe(0);
    expect(planeRelations([], plane, halfExt, dims).size).toBe(0);
  });
  it('the emphasis factor is VR\'s 1.4', () => { expect(SECTION_EMPHASIS).toBe(1.4) });
});

describe('clipSegmentNear (camera looks down -z)', () => {
  const P = (x, y, z) => ({ x, y, z });
  it('both ends in front: unchanged; both behind: nothing', () => {
    const a = P(0, 0, -1), b = P(1, 0, -2);
    expect(clipSegmentNear(a, b, 0.01)).toEqual([a, b]);
    expect(clipSegmentNear(P(0, 0, 1), P(1, 0, 2), 0.01)).toBeNull();
  });
  it('one end behind the camera: cut at the near plane, the front end kept', () => {
    const r = clipSegmentNear(P(0, 0, -1), P(2, 0, 1), 0.01);
    expect(r[0]).toEqual(P(0, 0, -1)); expect(r[1].z).toBeCloseTo(-0.01, 9); expect(r[1].x).toBeCloseTo(0.99, 6);
    const q = clipSegmentNear(P(2, 0, 1), P(0, 0, -1), 0.01); // either order
    expect(q[1]).toEqual(P(0, 0, -1)); expect(q[0].z).toBeCloseTo(-0.01, 9);
  });
});
