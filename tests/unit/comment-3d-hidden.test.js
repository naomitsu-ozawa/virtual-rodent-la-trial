import { describe, it, expect } from 'vitest';
import { computeHiddenIds, shownChannels, sectionPlaneLocal, createHiddenThrottle, HIDDEN_INTERVAL_MS } from '../../docs/comment-3d-hidden.js';
import { buildClsData } from '../../docs/point-cls.js';
import { pointIsHidden, voxelToLocal } from '../../docs/vr-point.js';
import { voxelToLocal3D } from '../../docs/crosshair.js';

// 3D position-comment markers of the PC / iPad view: the hidden judgement is VR's pointIsHidden over classification bytes built by the
// shared buildClsData. Synthetic data only: a 16^3 rg8-packed u16 volume (HU 0 everywhere, a wall of HU 1000 at x voxels 8..9).
const N = 16, dims = [N, N, N], halfExt = [1, 1, 1];
const packed = new Uint8Array(N * N * N * 2);
for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const v = x === 8 || x === 9 ? 1000 : 0, o = (x + N * (y + N * z)) * 2;
  packed[o] = v & 255; packed[o + 1] = v >> 8;
}
const vol = { dims, data: packed }, calibration = [1, 0, 0], noEdit = { dims, data: null, active: 0, maskOnly: 0 };
const seg = (active, enabled, min, max) => ({ active, enabled, min, max });
const state = (over = {}) => ({ bone: seg(true, true, 500, 3000), soft: seg(false, false, 0, 1), fat: seg(false, false, 0, 1), lung: seg(false, false, 0, 1), ...over });
const P = (x, y = 0, z = 0) => ({ x, y, z });
const prepOf = st => ({ cls: buildClsData(vol, calibration, noEdit, st), dims, halfExt });

describe('buildClsData (shared with VR)', () => {
  it('one channel per active + enabled segment; >= 128 inside the range, below outside', () => {
    const st = state(), cls = buildClsData(vol, calibration, noEdit, st);
    expect(cls.C).toBe(1); expect(cls.chan).toEqual([0, -1, -1, -1]);
    const at = x => cls.data[x + N * (0 + N * 0)];
    expect(at(8)).toBeGreaterThanOrEqual(128); expect(at(9)).toBeGreaterThanOrEqual(128); expect(at(3)).toBeLessThan(128);
  });
  it('no segment shown -> null (nothing to hide behind)', () => {
    expect(buildClsData(vol, calibration, noEdit, state({ bone: seg(true, false, 500, 3000) }))).toBeNull();
    expect(buildClsData(vol, calibration, noEdit, state({ bone: seg(false, true, 500, 3000) }))).toBeNull();
  });
  it('two shown segments get two channels in segment order', () => {
    const cls = buildClsData(vol, calibration, noEdit, state({ fat: seg(true, true, -200, 100) }));
    expect(cls.C).toBe(2); expect(cls.chan).toEqual([0, -1, 1, -1]);
  });
});

describe('shownChannels', () => {
  it('only segments that are active and enabled now', () => {
    const st = state({ fat: seg(true, true, -200, 100) }), cls = buildClsData(vol, calibration, noEdit, st);
    expect(shownChannels(cls, st)).toEqual([0, 1]);
    expect(shownChannels(cls, { ...st, fat: seg(true, false, -200, 100) })).toEqual([0]);
    expect(shownChannels(null, st)).toEqual([]);
  });
});

describe('computeHiddenIds (the VR rule, eye = camera)', () => {
  const st = state(), prep = prepOf(st), chs = [0];
  const pts = [{ id: 'a', local: P(-0.5) }, { id: 'b', local: P(0.6) }];
  it('a wall between the point and the eye hides it; the same as pointIsHidden point by point', () => {
    const eye = P(0.9);
    const ids = computeHiddenIds(pts, eye, prep, { chs });
    expect([...ids]).toEqual(['a']);
    const opt = { cls: prep.cls, dims, halfExt, chs, planes: [], count: 0, cut: 0 };
    for (const p of pts) expect(ids.has(p.id)).toBe(pointIsHidden(p.local, eye, opt));
  });
  it('the eye on the other side swaps the result', () => {
    expect([...computeHiddenIds(pts, P(-0.9), prep, { chs })]).toEqual(['b']);
  });
  it('nothing shown / no data / no eye / no points = all exposed', () => {
    expect(computeHiddenIds(pts, P(0.9), prep, { chs: [] }).size).toBe(0);
    expect(computeHiddenIds(pts, P(0.9), { cls: null, dims, halfExt }, { chs }).size).toBe(0);
    expect(computeHiddenIds(pts, P(0.9), null, { chs }).size).toBe(0);
    expect(computeHiddenIds(pts, null, prep, { chs }).size).toBe(0);
    expect(computeHiddenIds([], P(0.9), prep, { chs }).size).toBe(0);
  });
  it('the section view\'s cut plane: tissue on the cut side does not hide a point', () => {
    // keeps x <= -0.2 (n = (-1,0,0) through x = -0.2): the wall (x >= 0) is cut away
    const plane = sectionPlaneLocal(P(-0.2), P(-1));
    expect(plane).toEqual({ x: -1, y: 0, z: 0, w: 0.2 });
    expect(computeHiddenIds(pts, P(0.9), prep, { chs, plane }).has('a')).toBe(false);
  });
});

describe('sectionPlaneLocal', () => {
  it('unit normal, w = n . point (kept side n.p - w >= 0); null without a point or a normal', () => {
    expect(sectionPlaneLocal(P(0, 0, 0.5), P(0, 0, 2))).toEqual({ x: 0, y: 0, z: 1, w: 0.5 });
    expect(sectionPlaneLocal(null, P(1))).toBeNull();
    expect(sectionPlaneLocal(P(0), null)).toBeNull();
    expect(sectionPlaneLocal(P(0), P(0, 0, 0))).toBeNull();
  });
});

describe('createHiddenThrottle (about 10 Hz while the view moves, once more when it stops)', () => {
  it('the first call runs; calls inside the interval wait; the trailing pass is announced', () => {
    const t = createHiddenThrottle(), I = HIDDEN_INTERVAL_MS;
    expect(t.step(1000, true)).toEqual({ run: true, wait: 0 });
    expect(t.step(1016, true)).toEqual({ run: false, wait: I - 16 }); // a frame later: not judged, a pass is due at the end of the interval
    expect(t.step(1033, true).run).toBe(false);
    expect(t.step(1000 + I, true)).toEqual({ run: true, wait: 0 }); // the trailing pass
  });
  it('60 fps of changes run about 10 times a second, not every frame', () => {
    const t = createHiddenThrottle(); let runs = 0;
    for (let ms = 0; ms < 1000; ms += 16) if (t.step(ms, true).run) runs++;
    expect(runs).toBeGreaterThanOrEqual(8); expect(runs).toBeLessThanOrEqual(11);
  });
  it('an idle frame with nothing changed does nothing; a change after the interval runs at once', () => {
    const t = createHiddenThrottle(); t.step(0, true);
    expect(t.step(500, false)).toEqual({ run: false, wait: 0 });
    expect(t.step(600, true)).toEqual({ run: true, wait: 0 });
  });
  it('a change inside the interval is not lost: it is judged by the trailing pass when the motion stops', () => {
    const t = createHiddenThrottle(); t.step(0, true);
    expect(t.step(30, true).run).toBe(false);
    expect(t.step(HIDDEN_INTERVAL_MS, false)).toEqual({ run: true, wait: 0 }); // the timer's frame: dirty already pending
    expect(t.step(HIDDEN_INTERVAL_MS + 5, false)).toEqual({ run: false, wait: 0 });
  });
  it('reset (the classification became ready) makes the next call run', () => {
    const t = createHiddenThrottle(); t.step(0, true); t.reset();
    expect(t.step(10, false).run).toBe(true);
  });
});

describe('the 3D view\'s voxel positions are the VR object-space positions', () => {
  it('voxelToLocal3D (PC overlay) = voxelToLocal (VR) for halfExt = size * 3.3 / longest / 2', () => {
    const d = { columns: 10, rows: 8, slices: 6 }, sp = [0.2, 0.2, 0.5], px = 2, py = 1.6, pz = 3, k = 3.3 / Math.max(px, py, pz);
    const he = [px * k / 2, py * k / 2, pz * k / 2];
    for (const v of [{ i: 0, j: 0, k: 0 }, { i: 4, j: 3, k: 5 }, { i: 9, j: 7, k: 2 }]) {
      const a = voxelToLocal3D(v, d, sp), b = voxelToLocal(v, he, d);
      expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); expect(a.z).toBeCloseTo(b.z, 9);
    }
  });
});

describe('the PC dots use the VR colours', () => {
  it('style.css custom properties = vr-point-markers.js constants', async () => {
    const { readFileSync } = await import('node:fs');
    const { VR_MARKER_COLOR, VR_MARKER_FILL, VR_RIM_COLOR } = await import('../../docs/vr-point-markers.js');
    const css = readFileSync(new URL('../../docs/style.css', import.meta.url), 'utf8'), hex = n => '#' + n.toString(16).padStart(6, '0');
    expect(css).toContain('--vr-point-fill:' + hex(VR_MARKER_FILL));
    expect(css).toContain('--vr-point-dot:' + hex(VR_MARKER_COLOR));
    expect(hex(VR_RIM_COLOR)).toBe('#ffffff'); expect(css).toContain('--vr-point-rim:#fff');
  });
});
