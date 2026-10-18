import { describe, it, expect } from 'vitest';
import {
  rotationMatrix, isAxisAligned, alignedOrigin, effectiveBox, boxCorners, planeSection, pointInPolygon, seriesGeometry, patientOf,
  exportGeometry, sourcePosition, boxSteps, sourceBounds, rotationAllowed, rotationBlockReason, syntheticGeometryReason, defaultCropBox, clampCenter,
} from '../../docs/crop-geometry.js';

const close = (a, b, eps = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));
const box = (o = {}) => ({ n: 8, center: { i: 10, j: 10, k: 10 }, angles: { x: 0, y: 0, z: 0 }, interp: 'linear', ...o });

describe('rotation', () => {
  it('multiples of 90 degrees are exact', () => {
    expect(rotationMatrix(0, 0, 90)).toEqual([[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
    expect(rotationMatrix(90, 0, 0)).toEqual([[1, 0, 0], [0, 0, -1], [0, 1, 0]]);
    expect(rotationMatrix(0, 90, 0)).toEqual([[0, 0, 1], [0, 1, 0], [-1, 0, 0]]);
    expect(rotationMatrix(0, 0, 360)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });
  it('axis aligned detection', () => {
    expect(isAxisAligned({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(isAxisAligned({ x: 360, y: 0, z: -360 })).toBe(true);
    expect(isAxisAligned({ x: 0, y: 0, z: 1 })).toBe(false);
    expect(isAxisAligned({ x: 0, y: 90, z: 0 })).toBe(false);
  });
});

describe('aligned snapping', () => {
  it('start voxel is an integer and the centre follows', () => {
    const b = box({ n: 8, center: { i: 10.4, j: 10.6, k: 3 } }), o = alignedOrigin(b);
    expect(o).toEqual({ i0: 7, j0: 7, k0: 0 }); // 10.4-3.5=6.9 -> 7, 10.6-3.5=7.1 -> 7
    expect(effectiveBox(b).center).toEqual({ i: 10.5, j: 10.5, k: 3.5 });
  });
  it('rotated boxes are not snapped', () => {
    const b = box({ angles: { x: 0, y: 0, z: 10 }, center: { i: 10.4, j: 1, k: 2 } });
    expect(effectiveBox(b)).toBe(b);
  });
  it('default box is centred; centre stays inside the volume', () => {
    const dims = { columns: 100, rows: 80, slices: 60 };
    expect(defaultCropBox(dims, 256).center).toEqual({ i: 49.5, j: 39.5, k: 29.5 });
    expect(clampCenter({ i: -5, j: 200, k: 3 }, dims)).toEqual({ i: 0, j: 79, k: 3 });
  });
});

describe('box corners and sections', () => {
  it('aligned corners sit on the outer voxel faces', () => {
    const c = boxCorners(box({ center: { i: 10.5, j: 10.5, k: 10.5 } }), [1, 1, 1]);
    close(c[0], [6.5, 6.5, 6.5]); close(c[7], [14.5, 14.5, 14.5]); // voxels 7..14 -> faces at 6.5 and 14.5
  });
  it('anisotropic spacing: the box is n voxels per side in each axis', () => {
    const c = boxCorners(box({ n: 4, center: { i: 5, j: 5, k: 5 } }), [0.1, 0.1, 0.4]);
    close(c[7].map((v, m) => v - c[0][m]), [4, 4, 4]);
  });
  it('axial section of an aligned box is its rectangle; outside the box it is empty', () => {
    const b = box({ center: { i: 10.5, j: 10.5, k: 10.5 } });
    const poly = planeSection(b, [1, 1, 1], 'axial', 10), xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    expect(poly.length).toBe(4);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([6.5, 14.5, 6.5, 14.5]);
    expect(planeSection(b, [1, 1, 1], 'axial', 20)).toEqual([]);
    expect(planeSection(b, [1, 1, 1], 'coronal', 10).length).toBe(4);
    expect(pointInPolygon([10, 10], poly)).toBe(true);
    expect(pointInPolygon([2, 2], poly)).toBe(false);
  });
  it('a box turned 45 degrees about z has a diamond-like axial section', () => {
    const b = box({ n: 10, center: { i: 20, j: 20, k: 20 }, angles: { x: 0, y: 0, z: 45 } }), poly = planeSection(b, [1, 1, 1], 'axial', 20);
    expect(poly.length).toBe(4);
    const r = 5 * Math.SQRT2; // half diagonal
    close(poly.map(p => Math.hypot(p[0] - 20, p[1] - 20)), [r, r, r, r], 1e-9);
    expect(Math.max(...poly.map(p => p[0]))).toBeCloseTo(20 + r, 9);
  });
  it('bounds cover the rotated box, clamped to the volume', () => {
    const dims = { columns: 100, rows: 100, slices: 100 }, b = box({ n: 10, center: { i: 50, j: 50, k: 50 }, angles: { x: 0, y: 0, z: 45 } });
    const bb = sourceBounds(b, [1, 1, 1], dims, 0);
    expect(bb.x0).toBe(Math.floor(50 - 5 * Math.SQRT2)); expect(bb.z0).toBe(45); expect(bb.z1).toBe(55);
    expect(sourceBounds(box({ center: { i: -50, j: 0, k: 0 } }), [1, 1, 1], dims, 0)).toBeNull();
  });
  it('source positions: identity maps output voxel (a,b,c) to i0+a ...', () => {
    const b = effectiveBox(box({ center: { i: 10.2, j: 4, k: 4 } })), s = boxSteps(b, [0.2, 0.3, 0.5]), { i0, j0, k0 } = alignedOrigin(b);
    close(sourcePosition(b, s, 2, 3, 4), [i0 + 2, j0 + 3, k0 + 4]);
  });
});

// the sample practice data: IOP -1\0\0\0\-1\0 (not identity)
const series = (n = 6, o = {}) => ({
  columns: 20, rows: 18, spacingX: 0.3, spacingY: 0.2, spacingZ: 0.5,
  slices: Array.from({ length: n }, (_, k) => ({ pos: [10, 20, 5 + k * 0.5], orientation: [-1, 0, 0, 0, -1, 0], ...o })),
});
describe('patient space', () => {
  it('geometry from the headers', () => {
    const g = seriesGeometry(series());
    expect(g.rowDir).toEqual([-1, 0, 0]); expect(g.colDir).toEqual([0, -1, 0]); expect(g.sliceDir).toEqual([0, 0, 1]); expect(g.dims).toEqual({ columns: 20, rows: 18, slices: 6 });
    expect(g.tiltDeg).toBeLessThan(1e-9); expect(rotationAllowed(g)).toBe(true);
    close(patientOf(g, [2, 3, 4]), [10 - 2 * 0.3, 20 - 3 * 0.2, 5 + 4 * 0.5]);
  });
  it('a slice direction opposite to the normal is kept (descending positions)', () => {
    const s = series(4); s.slices.reverse();
    expect(seriesGeometry(s).sliceDir).toEqual([0, 0, -1]);
  });
  it('gantry tilt blocks rotation', () => {
    const s = series(4); s.slices.forEach((m, k) => { m.pos = [10, 20 + k * 0.3, 5 + k * 0.4]; });
    const g = seriesGeometry(s); expect(g.tiltDeg).toBeGreaterThan(10); expect(rotationAllowed(g)).toBe(false);
  });
  it('rotation is blocked without real geometry or with missing / uneven slice spacing (reasons)', () => {
    expect(rotationBlockReason(seriesGeometry(series()))).toBe(null);
    expect(rotationBlockReason(seriesGeometry(series(4, { pos: null })))).toBe('geometry'); expect(syntheticGeometryReason(seriesGeometry(series(4, { pos: null })))).toMatch(/ImagePositionPatient/);
    expect(rotationBlockReason(seriesGeometry(series(4, { orientation: null })))).toBe('geometry'); expect(syntheticGeometryReason(seriesGeometry(series(4, { orientation: null })))).toMatch(/ImageOrientationPatient/);
    expect(rotationBlockReason(seriesGeometry(series(4, { syntheticPos: true })))).toBe('geometry');
    expect(rotationBlockReason(seriesGeometry({ ...series(4), spacingCheck: { missing: 1, nonUniform: false } }))).toBe('spacing');
    expect(rotationBlockReason(seriesGeometry({ ...series(4), spacingCheck: { missing: 0, nonUniform: true } }))).toBe('spacing');
    expect(rotationBlockReason(seriesGeometry({ ...series(4), spacingCheck: { missing: 0, nonUniform: false } }))).toBe(null);
    expect(rotationAllowed(seriesGeometry(series(4, { pos: null })))).toBe(false);
  });
  it('axis aligned export: IOP copied, IPP = the source slice shifted by the in-plane offset', () => {
    const g = seriesGeometry(series()), e = exportGeometry(g, box({ n: 3, center: { i: 5, j: 6, k: 2 } })); // i0=4 j0=5 k0=1
    expect(e.aligned).toBe(true); expect(e.offset).toEqual({ i0: 4, j0: 5, k0: 1 });
    expect(e.orientation).toEqual([-1, 0, 0, 0, -1, 0]);
    close(e.ipp[0], [10 - 4 * 0.3, 20 - 5 * 0.2, 5.5]); close(e.ipp[2], [10 - 4 * 0.3, 20 - 5 * 0.2, 6.5]);
  });
  it('a box that sticks out of the series gets extrapolated slice positions', () => {
    const g = seriesGeometry(series()), e = exportGeometry(g, box({ n: 4, center: { i: 5, j: 6, k: 0 } }));
    const k0 = e.offset.k0; close(e.ipp[0], [e.ipp[0][0], e.ipp[0][1], 5 + k0 * 0.5]);
  });
  it('rotated 90 degrees about z: axes turn, centre stays', () => {
    const g = seriesGeometry({ ...series(), spacingX: 0.2, spacingY: 0.2, spacingZ: 0.2 }), b = box({ n: 4, center: { i: 5, j: 6, k: 2 }, angles: { x: 0, y: 0, z: 90 } }), e = exportGeometry(g, b);
    expect(e.aligned).toBe(false);
    // output +a runs along source +y (patient -y*... since colDir = [0,-1,0] and R e_x = (0,1,0) in the mm frame)
    close(e.orientation, [0, -1, 0, 1, 0, 0]); // rowDir_out = M*(0,1,0) = colDir = (0,-1,0); colDir_out = M*(-1,0,0) = -rowDir = (1,0,0)
    const centre = patientOf(g, [5, 6, 2]);
    const mid = e.ipp.reduce((acc, p) => acc.map((v, m) => v + p[m] / 4), [0, 0, 0]); // the mean of the 4 IPPs: the first voxel column/row, at the centre height
    close([mid[2]], [centre[2]]);
  });
});
