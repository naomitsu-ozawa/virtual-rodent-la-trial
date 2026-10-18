import { describe, it, expect, beforeEach } from 'vitest';
import { rayPlaneT, localToVoxel, voxelToLocal, sectionRayHit, vrPointText, nextVrPointNumber, recordVrPoint } from '../../docs/vr-point.js';
import { setComments, getComments, addComment, createComment, onCommentsChange, commentTarget, commentsForProject, commentMarkers } from '../../docs/comments.js';
import { datasetFingerprint, packProject, unpackProject } from '../../docs/project-file.js';

// synthetic volume (practice data, no real scan): 10 columns x 8 rows x 6 slices, spacing 1 x 1 x 2 mm -> 10 x 8 x 12 mm
const dims = { columns: 10, rows: 8, slices: 6 };
const halfExt = [5, 4, 6]; // object units: the box is +-halfExt (any common scale gives the same fractions)
const mk = uid => ({ id: 's::' + uid, description: 'synthetic', modality: 'CT', columns: 10, rows: 8, spacingX: 1, spacingY: 1, spacingZ: 2, slices: Array.from({ length: 6 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: uid })) });
const fp = datasetFingerprint(mk('1'));
const store = { getComments, addComment }; // recordVrPoint writes to the store of the same module instance as this test
const v = (x, y, z) => ({ x, y, z });
// a plane n.p = w
const pl = (x, y, z, w) => ({ x, y, z, w });

beforeEach(() => setComments([]));

describe('object-space point -> voxel (rounding rule: floor of the fraction of the box)', () => {
  it('the corner voxels and the axes (x, z up the index, y down the row index)', () => {
    expect(localToVoxel(v(-5, 4, -6), halfExt, dims)).toEqual({ i: 0, j: 0, k: 0 }); // the min-x / max-y / min-z corner is voxel 0,0,0
    expect(localToVoxel(v(4.999, -3.999, 5.999), halfExt, dims)).toEqual({ i: 9, j: 7, k: 5 });
    expect(localToVoxel(v(0, 0, 0), halfExt, dims)).toEqual({ i: 5, j: 4, k: 3 }); // exactly on a voxel boundary: floor takes the upper voxel
  });
  it('a point inside a voxel gives that voxel; every voxel centre maps back to itself', () => {
    for (let i = 0; i < dims.columns; i++) for (let j = 0; j < dims.rows; j++) for (let k = 0; k < dims.slices; k++) {
      expect(localToVoxel(voxelToLocal({ i, j, k }, halfExt, dims), halfExt, dims)).toEqual({ i, j, k });
    }
  });
  it('same orientation as voxelToLocal3D of the 3D view (index up = +x, row index up = -y, slice up = +z)', async () => {
    const { voxelToLocal3D } = await import('../../docs/crosshair.js');
    const sp = [1, 1, 2], ref = voxelToLocal3D({ i: 2, j: 6, k: 1 }, dims, sp), mine = voxelToLocal({ i: 2, j: 6, k: 1 }, halfExt, dims);
    // 3D view scale: 3.3 over the longest side (12 mm); the VR halfExt here is in mm, so compare the directions / fractions
    const s = 3.3 / 12;
    expect(mine.x * s).toBeCloseTo(ref.x, 9); expect(mine.y * s).toBeCloseTo(ref.y, 9); expect(mine.z * s).toBeCloseTo(ref.z, 9);
  });
  it('outside the volume is null on every axis, the far face included (never clamped)', () => {
    for (const p of [v(-5.001, 0, 0), v(5, 0, 0), v(0, 4.001, 0), v(0, -4, 0), v(0, 0, -6.001), v(0, 0, 6), v(NaN, 0, 0)]) expect(localToVoxel(p, halfExt, dims)).toBeNull();
    expect(localToVoxel(v(-5, 3.999, -6), halfExt, dims)).toEqual({ i: 0, j: 0, k: 0 }); // the near faces belong to voxel 0
  });
});

describe('ray and plane', () => {
  it('t on the plane; parallel or behind the origin is null', () => {
    expect(rayPlaneT(v(0, 0, -10), v(0, 0, 1), pl(0, 0, 1, 2))).toBeCloseTo(12, 9);
    expect(rayPlaneT(v(0, 0, -10), v(1, 0, 0), pl(0, 0, 1, 2))).toBeNull();
    expect(rayPlaneT(v(0, 0, 10), v(0, 0, 1), pl(0, 0, 1, 2))).toBeNull();
  });
});

describe('the section point of a laser', () => {
  const opt = (planes, extra = {}) => ({ halfExt, dims, planes, count: planes.length, cutBits: 0, ...extra });
  it('ray x plane -> voxel (axial plane z = 1 mm, ray from the side)', () => {
    // plane z = 1 (fraction 0.583 -> k = 3); ray along +x at y = 1 (row = floor((0.5 - 1/8) * 8) = 3)
    const h = sectionRayHit(v(-20, 1, -3), v(1, 0.0, 0.2), opt([pl(0, 0, 1, 1)]));
    expect(h.plane).toBe(0);
    expect(h.point.z).toBeCloseTo(1, 9);
    expect(h.voxel).toEqual(localToVoxel(h.point, halfExt, dims));
    expect(h.voxel.k).toBe(3);
  });
  it('a plane that is hit outside the volume records nothing', () => {
    expect(sectionRayHit(v(-20, 0, 0), v(1, 0, 0), opt([pl(1, 0, 0, 7)]))).toBeNull(); // x = 7 is outside +-5
    expect(sectionRayHit(v(0, 0, -20), v(0.9, 0, 1), opt([pl(0, 0, 1, 0)]))).toBeNull(); // hits z = 0 at x = 18 (outside)
    expect(sectionRayHit(v(0, 0, -20), v(0, 0, 1), opt([pl(0, 0, 1, 6)]))).toBeNull(); // the far face itself
  });
  it('no sections / ray parallel / plane behind the controller -> null', () => {
    expect(sectionRayHit(v(0, 0, -20), v(0, 0, 1), opt([]))).toBeNull();
    expect(sectionRayHit(v(0, 0, -20), v(0, 0, 1), { halfExt, dims, planes: [pl(0, 0, 1, 0)], count: 0 })).toBeNull(); // count 0: sections off
    expect(sectionRayHit(v(0, 0, -20), v(1, 0, 0), opt([pl(0, 0, 1, 0)]))).toBeNull();
    expect(sectionRayHit(v(0, 0, 20), v(0, 0, 1), opt([pl(0, 0, 1, 0)]))).toBeNull();
  });
  it('several sections: the first one the laser meets wins (whichever order they are listed in)', () => {
    const a = pl(0, 0, 1, -3), b = pl(0, 0, 1, 1), c = pl(0, 0, 1, 4);
    for (const order of [[a, b, c], [c, b, a], [b, c, a]]) {
      const h = sectionRayHit(v(0.5, 0.5, -20), v(0, 0, 1), opt(order));
      expect(h.point.z).toBeCloseTo(-3, 9);
    }
    expect(sectionRayHit(v(0.5, 0.5, 20), v(0, 0, -1), opt([a, b, c])).point.z).toBeCloseTo(4, 9); // from the other side: c is first
  });
  it('a nearer section that meets the laser outside the volume is skipped for one inside', () => {
    const near = pl(1, 0, 0, -7), inner = pl(1, 0, 0, 0); // x = -7 is outside the box (+-5) and met first, x = 0 is inside
    const h = sectionRayHit(v(-20, 0, 0), v(1, 0, 0.05), opt([near, inner]));
    expect(h.plane).toBe(1);
    expect(h.voxel).toEqual({ i: 5, j: 4, k: 3 });
  });
  it('a point another clipping section has removed is not used (kept side n.p - w >= 0)', () => {
    const a = pl(0, 0, 1, -3), clip = pl(0, 0, 1, 0); // clip keeps z >= 0: the point of a (z = -3) is cut away
    expect(sectionRayHit(v(0, 0, -20), v(0, 0, 1), opt([a, clip], { cutBits: 0b10 })).plane).toBe(1); // falls through to the clip plane itself
    expect(sectionRayHit(v(0, 0, -20), v(0, 0, 1), opt([a, clip], { cutBits: 0 })).plane).toBe(0); // not clipping: a is the first section
    expect(sectionRayHit(v(0, 0, -20), v(0, 0, 1), opt([a], { cutBits: 1 })).plane).toBe(0); // a plane never cuts itself away
  });
  it('t is in the units of the direction (a world distance when q is the image of a unit world direction)', () => {
    const h = sectionRayHit(v(0, 0, -10), v(0, 0, 2), opt([pl(0, 0, 1, 0)]));
    expect(h.t).toBeCloseTo(5, 9);
  });
});

describe('recording a VR point as a comment', () => {
  it('adds "VR ポイント N" at the voxel with the series fingerprint and a time; the panel / project readers see it', () => {
    const seen = []; const off = onCommentsChange(l => seen.push(l.length));
    const c = recordVrPoint({ voxel: { i: 3, j: 4, k: 2 }, series: fp, now: Date.UTC(2026, 9, 6) , store });
    off();
    expect(c).toMatchObject({ text: 'VR ポイント 1', position: { i: 3, j: 4, k: 2 }, createdAt: '2026-10-06T00:00:00.000Z', series: fp });
    expect(getComments()).toHaveLength(1); expect(seen).toEqual([1]);
    expect(commentsForProject(fp)).toHaveLength(1);
    expect(commentTarget(c, dims)).toEqual({ i: 3, j: 4, k: 2 }); // "view this place" target (inside: unchanged)
    expect(commentMarkers('axial', getComments(), fp, 2, dims)[0]).toMatchObject({ number: 1, exact: true }); // the 2D marker
    const { project } = unpackProject(packProject({ dataset: fp, comments: commentsForProject(fp) })); // save / load keeps it
    setComments([]);
    expect(project.comments).toMatchObject([{ text: 'VR ポイント 1', position: { i: 3, j: 4, k: 2 } }]);
  });
  it('numbers count on (max + 1, per series, English too); an edited text is left alone', () => {
    const fpB = datasetFingerprint(mk('2'));
    expect(recordVrPoint({ voxel: { i: 0, j: 0, k: 0 }, series: fp , store }).text).toBe('VR ポイント 1');
    expect(recordVrPoint({ voxel: { i: 1, j: 0, k: 0 }, series: fp, language: 'en' , store }).text).toBe('VR point 2');
    expect(recordVrPoint({ voxel: { i: 1, j: 1, k: 0 }, series: fpB , store }).text).toBe('VR ポイント 1'); // another series counts on its own
    setComments(getComments().map(c => c.text === 'VR point 2' ? { ...c, text: 'lesion A' } : c));
    expect(recordVrPoint({ voxel: { i: 2, j: 0, k: 0 }, series: fp , store }).text).toBe('VR ポイント 2');
    expect(nextVrPointNumber([createComment({ text: 'VR ポイント 7', position: { i: 0, j: 0, k: 0 }, series: fp })], fp)).toBe(8);
    expect(vrPointText(3, 'en')).toBe('VR point 3');
  });
  it('no voxel (outside / no section) or no series records nothing', () => {
    expect(recordVrPoint({ voxel: null, series: fp , store })).toBeNull();
    expect(recordVrPoint({ voxel: { i: 0, j: 0, k: 0 }, series: null , store })).toBeNull();
    expect(getComments()).toHaveLength(0);
  });
  it('end to end: laser -> section -> voxel -> comment', () => {
    const h = sectionRayHit(v(-20, 1, -3), v(1, 0, 0.2), { halfExt, dims, planes: [pl(0, 0, 1, 1)], count: 1, cutBits: 0 });
    const c = recordVrPoint({ voxel: h.voxel, series: fp , store });
    expect(c.position).toEqual(h.voxel);
    expect(sectionRayHit(v(-20, 1, -3), v(1, 0, 0.2), { halfExt, dims, planes: [pl(0, 0, 1, 40)], count: 1 })).toBeNull(); // outside: nothing to record
  });
});
