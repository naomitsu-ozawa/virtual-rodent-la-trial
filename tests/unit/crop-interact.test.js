import { describe, it, expect } from 'vitest';
import { classifyPoint, pointerAngle, wrapDelta, snapAngle, viewAngle, rotateAboutView, rotateAboutViewStep, ROTATE_BAND_PX, FINE_STEP_DEG, SNAP_STEP_DEG } from '../../docs/crop-interact.js';
import {
  orthonormalize, snapToPermutation, axisRotation, matMul, IDENTITY3, setBoxRotation, boxAligned, boxRotation, rotationMatrix, defaultCropBox, effectiveBox,
  exportGeometry, boxSteps, eulerFromMatrix, pointInPolygon,
} from '../../docs/crop-geometry.js';

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
const cls = pt => classifyPoint(pt, square, ROTATE_BAND_PX, pointInPolygon(pt, square));
const isIdentity = R => R.every((row, r) => row.every((v, c) => Object.is(v, r === c ? 1 : 0)));
const exactEntries = R => R.every(row => row.every(v => Object.is(v, 0) || Object.is(v, 1) || Object.is(v, -1)));
const maxDiff = (A, B) => Math.max(...A.flatMap((row, r) => row.map((v, c) => Math.abs(v - B[r][c]))));

describe('hit-test classification', () => {
  it('inside = move, outside a corner within the band = rotate, elsewhere none', () => {
    expect(cls([50, 50]).zone).toBe('move');
    expect(cls([2, 2]).zone).toBe('move'); // inside wins even next to a corner
    expect(cls([-10, -10])).toMatchObject({ zone: 'rotate', corner: 0 });
    expect(cls([110, 105])).toMatchObject({ zone: 'rotate', corner: 2 });
    expect(cls([50, -10]).zone).toBe(null); // outside the middle of an edge: no handle
    expect(cls([-40, -40]).zone).toBe(null); // beyond the band
    expect(cls([-ROTATE_BAND_PX - 1, 0]).zone).toBe(null);
    expect(cls([-ROTATE_BAND_PX + 1, 0]).zone).toBe('rotate');
  });
  it('a degenerate polygon has no zones', () => { expect(classifyPoint([0, 0], [[0, 0], [1, 1]], 20, false).zone).toBe(null); });
});

describe('pointer delta -> angle', () => {
  it('angle about the centre, anisotropic spacing uses mm', () => {
    expect(pointerAngle([0, 0], [1, 0])).toBeCloseTo(0, 9);
    expect(pointerAngle([0, 0], [0, 1])).toBeCloseTo(90, 9);
    expect(pointerAngle([0, 0], [-1, 0])).toBeCloseTo(180, 9);
    expect(pointerAngle([0, 0], [1, 1], [1, 2])).toBeCloseTo(Math.atan2(2, 1) * 180 / Math.PI, 9);
  });
  it('wrapDelta keeps a drag continuous across the +-180 jump', () => {
    expect(wrapDelta(170, -170)).toBe(20); expect(wrapDelta(-170, 170)).toBe(-20); expect(wrapDelta(10, 30)).toBe(20);
  });
  it('dragging the pointer a quarter turn rotates the box by a quarter turn', () => {
    const c = [0, 0], a0 = pointerAngle(c, [10, 0]), a1 = pointerAngle(c, [0, 10]);
    const R = rotateAboutView(IDENTITY3(), 'axial', wrapDelta(a0, a1));
    expect(R).toEqual([[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
  });
});

describe('snapping', () => {
  it('0 / 90 / 180 / 270 within 3 degrees, 15 degree steps otherwise, Shift = free', () => {
    expect(snapAngle(2.9)).toBe(0); expect(snapAngle(-2.9)).toBe(0); expect(snapAngle(92)).toBe(90); expect(snapAngle(-178)).toBe(-180); expect(snapAngle(268.5)).toBe(270);
    expect(snapAngle(7)).toBe(0); expect(snapAngle(8)).toBe(15); expect(snapAngle(22)).toBe(15); expect(snapAngle(38)).toBe(45); expect(snapAngle(-52)).toBe(-45);
    expect(snapAngle(7.3, { free: true })).toBe(7.3);
    expect(snapAngle(5, { step: 0 })).toBe(5); expect(snapAngle(2, { step: 0 })).toBe(0); // axis snapping alone
  });
  it('a drag result is on the grid in the view, a Shift drag is not', () => {
    for (const plane of ['axial', 'coronal', 'sagittal']) {
      const R = rotateAboutView(IDENTITY3(), plane, 33.3);
      expect(viewAngle(R, plane)).toBeCloseTo(30, 9);
      const F = rotateAboutView(IDENTITY3(), plane, 33.3, { free: true });
      expect(Math.abs(Math.abs(viewAngle(F, plane)) - 33.3)).toBeLessThan(1e-9);
    }
  });
  it('the sign matches the screen: a pointer turning clockwise on screen (y down) turns the cross-section the same way in every view', () => {
    // plane coordinates (u, v): the box axis a of an identity box points to +u; after +30 deg of pointer turn it points at +30 deg in (u, v)
    for (const plane of ['axial', 'coronal', 'sagittal']) expect(viewAngle(rotateAboutView(IDENTITY3(), plane, 30), plane)).toBeCloseTo(30, 9);
  });
  it('tilted out of the view: the drag amount is snapped (a matching drag back restores the orientation)', () => {
    const R0 = matMul(axisRotation(1, 45), axisRotation(2, 30)), R1 = rotateAboutView(R0, 'sagittal', 62), R2 = rotateAboutView(R1, 'sagittal', -60.5);
    expect(maxDiff(R1, matMul(axisRotation(0, 60), R0))).toBeLessThan(1e-12); expect(maxDiff(R2, R0)).toBeLessThan(1e-12);
  });
  it('re-snaps relative to a tilted start: the in-view angle lands on the grid', () => {
    const R0 = rotationMatrix(0, 0, 40), R = rotateAboutView(R0, 'axial', 3);
    expect(viewAngle(R, 'axial') % 15).toBeCloseTo(0, 9);
  });
});

describe('orthonormalization', () => {
  it('removes drift: 5000 small rotations keep R orthonormal with det 1', () => {
    let R = IDENTITY3(); const step = axisRotation(2, 0.37), step2 = axisRotation(0, 0.11);
    for (let n = 0; n < 5000; n++) R = matMul(step2, matMul(step, R)); // no re-orthonormalization: drift
    const O = orthonormalize(R);
    const RtR = matMul(O[0].map((_, c) => O.map(row => row[c])), O);
    expect(maxDiff(RtR, IDENTITY3())).toBeLessThan(1e-14);
    const det = O[0][0] * (O[1][1] * O[2][2] - O[1][2] * O[2][1]) - O[0][1] * (O[1][0] * O[2][2] - O[1][2] * O[2][0]) + O[0][2] * (O[1][0] * O[2][1] - O[1][1] * O[2][0]);
    expect(det).toBeCloseTo(1, 14);
  });
  it('a perturbed matrix is restored and a clean one is unchanged', () => {
    const R = rotationMatrix(10, 20, 30), P = R.map(row => row.map(v => v * 1.001 + 1e-4));
    expect(maxDiff(orthonormalize(P), R)).toBeLessThan(2e-3);
    expect(maxDiff(orthonormalize(R), R)).toBeLessThan(1e-15);
  });
});

describe('exact permutation snapping', () => {
  it('near identity -> exactly the identity (no -0)', () => {
    const near = matMul(axisRotation(2, 2.5), matMul(axisRotation(1, -1.2), axisRotation(0, 0.4)));
    const S = snapToPermutation(near, 3);
    expect(isIdentity(S)).toBe(true);
  });
  it('near 90 degree turns -> exact 0 / +-1 entries', () => {
    for (const [ax, deg] of [[2, 90], [2, 180], [0, 270], [1, 90]]) {
      const R = matMul(axisRotation(ax, deg + 1.7), axisRotation((ax + 1) % 3, -1));
      const S = snapToPermutation(R, 3); expect(S).not.toBe(null); expect(exactEntries(S)).toBe(true);
    }
    expect(snapToPermutation(matMul(axisRotation(0, 91), matMul(axisRotation(2, 90), IDENTITY3())), 3)).toEqual(matMul(axisRotation(0, 90), axisRotation(2, 90)));
  });
  it('outside the tolerance -> null', () => { expect(snapToPermutation(rotationMatrix(0, 0, 4), 3)).toBe(null); expect(snapToPermutation(rotationMatrix(0, 0, 45), 3)).toBe(null); });
  it('several drags (same view, then different views), dragged back to about 0: exactly the identity -> byte-copy path', () => {
    const dims = { columns: 64, rows: 64, slices: 40 }, geom = { dims, spacing: [1, 1, 1], rowDir: [1, 0, 0], colDir: [0, 1, 0], sliceDir: [0, 0, 1], origin: [0, 0, 0], slicePos: null, orientation: [1, 0, 0, 0, 1, 0] };
    let R = IDENTITY3();
    for (const d of [37, 52, -85, 40]) R = rotateAboutView(R, 'axial', d); // net 30 degrees, on the 15 degree grid after each drag
    expect(isIdentity(R)).toBe(false);
    const box = setBoxRotation(defaultCropBox(dims, 128), R);
    expect(boxAligned(box)).toBe(false); expect(exportGeometry(geom, box).aligned).toBe(false);
    R = rotateAboutView(R, 'axial', -28.4); // dragged back to near 0
    for (const d of [-8, 8, -1.4]) R = rotateAboutView(R, 'axial', d);
    setBoxRotation(box, R);
    // tilt in two other views, then back by the (snapped) angles in reverse order, a little off
    R = rotateAboutView(IDENTITY3(), 'axial', 31); R = rotateAboutView(R, 'coronal', 44); R = rotateAboutView(R, 'sagittal', 62);
    expect(snapToPermutation(R, 3)).toBe(null);
    R = rotateAboutView(R, 'sagittal', -60.5); R = rotateAboutView(R, 'coronal', -46.2); R = rotateAboutView(R, 'axial', -29.5);
    setBoxRotation(box, R);
    expect(isIdentity(box.R)).toBe(true); expect(boxAligned(box)).toBe(true); expect(box.angles).toEqual({ x: 0, y: 0, z: 0 });
    expect(exportGeometry(geom, box).aligned).toBe(true);
  });
  it('Shift (free) keeps a deliberate tilt but removes float dust', () => {
    const F = rotateAboutView(IDENTITY3(), 'axial', 1.3, { free: true }); expect(boxAligned({ R: F })).toBe(false);
    expect(isIdentity(rotateAboutView(IDENTITY3(), 'axial', 0.01, { free: true }))).toBe(true);
  });
});

describe('orientation is stored as a matrix', () => {
  it('setBoxRotation keeps R and derives the Euler readout; boxSteps uses R', () => {
    const box = setBoxRotation(defaultCropBox({ columns: 64, rows: 64, slices: 40 }, 128), rotationMatrix(10, 20, 30));
    const e = eulerFromMatrix(box.R); expect(e.x).toBeCloseTo(10, 5); expect(e.y).toBeCloseTo(20, 5); expect(e.z).toBeCloseTo(30, 5);
    expect(box.angles).toEqual(e);
    expect(boxSteps(box, [1, 1, 1]).R).toEqual(box.R);
    const R = rotateAboutView(IDENTITY3(), 'axial', 45); setBoxRotation(box, R); box.angles = { x: 0, y: 0, z: 0 }; // a stale readout must not matter
    expect(boxAligned(box)).toBe(false); expect(boxRotation(box)).toEqual(R); expect(effectiveBox(box)).toBe(box);
  });
  it('a box without R (older callers) still works from its angles', () => {
    expect(boxAligned({ angles: { x: 0, y: 0, z: 0 } })).toBe(true); expect(boxAligned({ angles: { x: 0, y: 0, z: 1 } })).toBe(false);
  });
});

describe('drag steps: 1 degree plain, 15 degrees with Shift', () => {
  it('a plain drag lands on whole degrees, also 1 and 2 degrees from an axis', () => {
    for (const plane of ['axial', 'coronal', 'sagittal']) for (const [drag, want] of [[1.3, 1], [2.4, 2], [-1.6, -2], [33.3, 33], [0.4, 0]]) {
      const r = rotateAboutViewStep(IDENTITY3(), plane, drag, { step: FINE_STEP_DEG });
      expect(r.delta).toBeCloseTo(want, 9); expect(viewAngle(r.R, plane)).toBeCloseTo(want, 9);
    }
  });
  it('a plain drag back to 0 or to 90 gives the exact integer matrix', () => {
    expect(isIdentity(rotateAboutViewStep(IDENTITY3(), 'axial', 0.3, { step: FINE_STEP_DEG }).R)).toBe(true);
    expect(exactEntries(rotateAboutViewStep(IDENTITY3(), 'coronal', 89.7, { step: FINE_STEP_DEG }).R)).toBe(true);
    const R1 = rotateAboutViewStep(IDENTITY3(), 'axial', 7.2, { step: FINE_STEP_DEG }).R;
    expect(isIdentity(rotateAboutViewStep(R1, 'axial', -6.9, { step: FINE_STEP_DEG }).R)).toBe(true);
  });
  it('Shift keeps the 15 degree grid and reports the snapped amount', () => {
    const r = rotateAboutViewStep(IDENTITY3(), 'sagittal', 37, { step: SNAP_STEP_DEG });
    expect(r.delta).toBeCloseTo(30, 9); expect(viewAngle(r.R, 'sagittal')).toBeCloseTo(30, 9);
    expect(isIdentity(rotateAboutViewStep(IDENTITY3(), 'axial', 2.5, { step: SNAP_STEP_DEG }).R)).toBe(true);
  });
});
