import { describe, it, expect, beforeEach } from 'vitest';
import { I18N } from '../../docs/i18n.js';
import { voxelToLocal3D, planePointFromVoxel } from '../../docs/crosshair.js';
import {
  getHuLine, setHuLine, clearHuLine, onHuLineChange, getHuLineHover, setHuLineHover, onHuLineHoverChange,
  localToVoxel, voxelInside, clampToVolume, rayPlaneT, planeFraction, lineOnPlane, voxelOnSlice
} from '../../docs/hu-line-model.js';

const dims = { columns: 20, rows: 10, slices: 8 };

describe('shared endpoint model', () => {
  beforeEach(() => clearHuLine());
  it('stores the endpoints once, in voxel coordinates, and hands out copies', () => {
    expect(getHuLine()).toBeNull();
    expect(setHuLine({ i: 1, j: 2, k: 3 }, { i: 4.5, j: 5, k: 6 }, 'final', '2d')).toBe(true);
    const L = getHuLine(); expect(L).toEqual({ a: { i: 1, j: 2, k: 3 }, b: { i: 4.5, j: 5, k: 6 } });
    L.a.i = 99; expect(getHuLine().a.i).toBe(1);
  });
  it('refuses a non-finite endpoint and keeps the old line', () => {
    setHuLine({ i: 0, j: 0, k: 0 }, { i: 1, j: 1, k: 1 });
    expect(setHuLine({ i: NaN, j: 0, k: 0 }, { i: 1, j: 1, k: 1 })).toBe(false);
    expect(getHuLine().b.i).toBe(1);
  });
  it('notifies live / final / clear with the phase and the source', () => {
    const ev = []; const off = onHuLineChange(e => ev.push([e.phase, e.source, !!e.line]));
    setHuLine({ i: 0, j: 0, k: 0 }, { i: 3, j: 0, k: 0 }, 'live', '3d');
    setHuLine({ i: 0, j: 0, k: 0 }, { i: 4, j: 0, k: 0 }, 'final', '3d');
    clearHuLine('panel'); clearHuLine('panel'); // the second one changes nothing
    off(); setHuLine({ i: 0, j: 0, k: 0 }, { i: 1, j: 0, k: 0 });
    expect(ev).toEqual([['live', '3d', true], ['final', '3d', true], ['clear', 'panel', false]]);
  });
  it('the plot hover point is shared and reset by a new final line / clear', () => {
    const seen = []; const off = onHuLineHoverChange(h => seen.push(h ? h.i : null));
    setHuLine({ i: 0, j: 0, k: 0 }, { i: 9, j: 0, k: 0 });
    setHuLineHover({ i: 4.5, j: 0, k: 0 }); expect(getHuLineHover()).toEqual({ i: 4.5, j: 0, k: 0 });
    setHuLineHover(null); setHuLineHover({ i: 2, j: 0, k: 0 });
    clearHuLine(); off();
    expect(seen).toEqual([4.5, null, 2, null]);
    expect(getHuLineHover()).toBeNull();
  });
});

describe('3D <-> voxel mapping', () => {
  it('localToVoxel inverts voxelToLocal3D (anisotropic spacing too)', () => {
    for (const sp of [[1, 1, 1], [0.7, 0.7, 2.5]]) {
      for (const v of [{ i: 0, j: 0, k: 0 }, { i: 19, j: 9, k: 7 }, { i: 3.25, j: 6.5, k: 1.75 }]) {
        const r = localToVoxel(voxelToLocal3D(v, dims, sp), dims, sp);
        expect(r.i).toBeCloseTo(v.i, 9); expect(r.j).toBeCloseTo(v.j, 9); expect(r.k).toBeCloseTo(v.k, 9);
      }
    }
  });
  it('voxelInside allows the outer half voxel; clampToVolume clamps to the centres', () => {
    expect(voxelInside({ i: -0.5, j: 0, k: 7.5 }, dims)).toBe(true);
    expect(voxelInside({ i: -0.6, j: 0, k: 0 }, dims)).toBe(false);
    expect(voxelInside({ i: 19.6, j: 0, k: 0 }, dims)).toBe(false);
    expect(clampToVolume({ i: -3, j: 100, k: 2.5 }, dims)).toEqual({ i: 0, j: 9, k: 2.5 });
  });
  it('rayPlaneT: distance along the ray, null when parallel or behind', () => {
    const o = { x: 0, y: 0, z: 10 }, d = { x: 0, y: 0, z: -1 };
    expect(rayPlaneT(o, d, { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(8);
    expect(rayPlaneT(o, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 1 })).toBeNull();
    expect(rayPlaneT(o, d, { x: 0, y: 0, z: 20 }, { x: 0, y: 0, z: 1 })).toBeNull(); // the plane is behind the eye
  });
});

describe('the line on a 2D slice view (projection / intersection)', () => {
  it('planeFraction agrees with crosshair.js planePointFromVoxel for voxel centres', () => {
    for (const p of ['axial', 'coronal', 'sagittal']) {
      const v = { i: 4, j: 3, k: 5 };
      expect(planeFraction(p, v, dims)).toEqual(planePointFromVoxel(p, v, dims));
    }
  });
  it('a line drawn on an axial slice lies ON that slice (solid), and only there', () => {
    const a = { i: 2, j: 1, k: 3 }, b = { i: 12, j: 6, k: 3 };
    const on = lineOnPlane('axial', a, b, 3, dims);
    expect(on.kind).toBe('on'); expect(on.hit).toBeNull();
    expect(on.seg[0]).toEqual(planePointFromVoxel('axial', a, dims)); expect(on.seg[1]).toEqual(planePointFromVoxel('axial', b, dims));
    expect(lineOnPlane('axial', a, b, 4, dims).kind).toBe('none');
    expect(lineOnPlane('axial', a, b, 2, dims).kind).toBe('none');
  });
  it('the same line on the coronal / sagittal views is a dashed projection with a crossing mark', () => {
    const a = { i: 2, j: 1, k: 3 }, b = { i: 12, j: 6, k: 3 };
    const cor = lineOnPlane('coronal', a, b, 3, dims); // j runs 1 -> 6: slice 3 is crossed at t = 0.4
    expect(cor.kind).toBe('cross'); expect(cor.t).toBeCloseTo(0.4);
    expect(cor.hit).toEqual(planePointFromVoxel('coronal', { i: 6, j: 3, k: 3 }, dims));
    expect(cor.seg).toHaveLength(2);
    expect(lineOnPlane('coronal', a, b, 8, dims).kind).toBe('none');
    const sag = lineOnPlane('sagittal', a, b, 7, dims); expect(sag.kind).toBe('cross'); expect(sag.t).toBeCloseTo(0.5);
  });
  it('an oblique 3D line crosses a slice where its axis coordinate passes through it; the half-voxel slab counts as touching', () => {
    const a = { i: 1, j: 1, k: 0.2 }, b = { i: 9, j: 5, k: 6.4 };
    expect(lineOnPlane('axial', a, b, 3, dims).kind).toBe('cross');
    expect(lineOnPlane('axial', a, b, 7, dims).kind).toBe('none');
    expect(lineOnPlane('axial', a, b, 0, dims).kind).toBe('cross'); // one end on slice 0, the other far above: it passes through
    expect(lineOnPlane('axial', { i: 0, j: 0, k: 2.4 }, { i: 3, j: 0, k: 2.6 }, 2, dims).kind).toBe('cross'); // 2.6 is off slice 2 by more than half a voxel: it passes through instead
    expect(lineOnPlane('axial', { i: 0, j: 0, k: 2.4 }, { i: 3, j: 0, k: 2.5 }, 2, dims).kind).toBe('on');
  });
  it('a line parallel to the slice but off it is not drawn; hover marker follows the same slab rule', () => {
    expect(lineOnPlane('axial', { i: 0, j: 0, k: 5 }, { i: 4, j: 4, k: 5 }, 2, dims).kind).toBe('none');
    expect(voxelOnSlice('axial', { i: 1, j: 1, k: 3.4 }, 3)).toBe(true);
    expect(voxelOnSlice('axial', { i: 1, j: 1, k: 3.6 }, 3)).toBe(false);
  });
});

describe('i18n: 3D line + live indicator', () => {
  it('every key exists in ja and en', () => {
    for (const k of ['lpLive', 'lpLiveTip', 'lp3dDraw', 'lp3dDrawTip', 'lpHint3d']) for (const lang of ['ja', 'en']) expect(I18N[lang][k], lang + ':' + k).toBeTruthy();
  });
});
