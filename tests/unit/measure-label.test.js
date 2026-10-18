import { describe, it, expect } from 'vitest';
import { clampLabelCenter, planeLabelPlacement, planeVoxelDelta, stepDelta, offsetFromDelta, nearLabelWorld, createFocusTracker, OCCLUDED_ALPHA, LINE_SAMPLES, LABEL_MID, probeKey, labelPart, lineSamplePoints, fadeAlpha, lineAlphas, approachAlpha, lineStopOffsets, createIdMaker, createProbeGate } from '../../docs/measure-label.js';
import { planePointFromVoxel } from '../../docs/crosshair.js';


describe('2D label placement (beside the line, compact, inside the image)', () => {
  it('perpendicular to the line (the upper side) and clear of it', () => {
    const a = { x: 50, y: 100 }, b = { x: 150, y: 100 }, r = planeLabelPlacement(a, b, { w: 48, h: 14, gap: 4, x0: 0, y0: 0, iw: 300, ih: 200 });
    expect(r.x).toBeCloseTo(100, 9); expect(r.y).toBeCloseTo(100 - (4 + 7), 9); expect(r.mx).toBe(100);
    const c = planeLabelPlacement({ x: 50, y: 50 }, { x: 150, y: 150 }, { w: 48, h: 14, gap: 4, x0: 0, y0: 0, iw: 300, ih: 300 });
    expect((c.x - c.mx) * 100 + (c.y - c.my) * 100).toBeCloseTo(0, 6); expect(c.y).toBeLessThan(c.my);
  });
  it('is clamped into the image rect', () => {
    const r = planeLabelPlacement({ x: 2, y: 3 }, { x: 10, y: 3 }, { w: 48, h: 14, gap: 4, x0: 0, y0: 0, iw: 100, ih: 100 });
    expect(r.x - 24).toBeGreaterThanOrEqual(0); expect(r.y - 7).toBeGreaterThanOrEqual(0);
  });
});

describe('moving a label: pixels / metres <-> voxel offsets', () => {
  it('stepDelta and offsetFromDelta are inverses (any per-voxel step, including a flipped axis)', () => {
    const step = [0.01, -0.02, 0.04], off = { i: 3.5, j: -2, k: 7 };
    const d = stepDelta(off, step); expect(d).toEqual({ x: 0.035, y: 0.04, z: 0.28 });
    const back = offsetFromDelta(d, step); expect(back.i).toBeCloseTo(3.5, 12); expect(back.j).toBeCloseTo(-2, 12); expect(back.k).toBeCloseTo(7, 12);
    expect(offsetFromDelta({ x: 1, y: 1, z: 1 }, [0, 0, 0])).toEqual({ i: 0, j: 0, k: 0 });
  });
  it('planeVoxelDelta inverts the real plane mapping for all three planes (the out-of-plane axis stays 0)', () => {
    const dims = { columns: 16, rows: 20, slices: 12 };
    for (const plane of ['axial', 'coronal', 'sagittal']) {
      const project = v => planePointFromVoxel(plane, v, dims), o = { i: 4, j: 7, k: 5 }, t = { i: 9, j: 3, k: 8 };
      const a = project(o), b = project(t), d = planeVoxelDelta(project, b.fx - a.fx, b.fy - a.fy);
      const back = project({ i: o.i + d.i, j: o.j + d.j, k: o.k + d.k });
      expect(back.fx).toBeCloseTo(b.fx, 9); expect(back.fy).toBeCloseTo(b.fy, 9);
      expect(Object.values(d).filter(x => Math.abs(x) < 1e-9).length).toBe(1); // exactly one axis is out of the plane
    }
  });
  it('the VR default spot is beside the line (perpendicular to it and to the view), on the upper side, `dist` from the midpoint', () => {
    const a = { x: -0.05, y: 1.3, z: -0.6 }, b = { x: 0.05, y: 1.3, z: -0.6 }, head = { x: 0, y: 1.6, z: 0 }, p = nearLabelWorld(a, b, head, 0.02);
    const mid = { x: 0, y: 1.3, z: -0.6 }, dv = { x: p.x - mid.x, y: p.y - mid.y, z: p.z - mid.z };
    expect(Math.hypot(dv.x, dv.y, dv.z)).toBeCloseTo(0.02, 9); expect(dv.x * 0.1).toBeCloseTo(0, 9); // perpendicular to the line
    expect(dv.x * (head.x - mid.x) + dv.y * (head.y - mid.y) + dv.z * (head.z - mid.z)).toBeCloseTo(0, 9); // and to the view direction
    expect(dv.y).toBeGreaterThan(0); // upper side
    expect(Number.isFinite(nearLabelWorld(a, b, { x: 0, y: 1.3, z: -0.6 }, 0.02).y)).toBe(true); // a degenerate view still gives a spot
  });
});

describe('clamping a label into the view (display time only)', () => {
  it('keeps a label inside the rect, leaves one that already fits, and works for a rect with an origin', () => {
    const o = { w: 60, h: 14, x0: 0, y0: 0, iw: 400, ih: 300 };
    expect(clampLabelCenter(200, 150, o)).toEqual({ x: 200, y: 150 });
    expect(clampLabelCenter(-500, 9999, o)).toEqual({ x: 32, y: 291 }); // 30 + pad 2, 300 - 7 - 2
    expect(clampLabelCenter(9999, -50, o)).toEqual({ x: 368, y: 9 });
    expect(clampLabelCenter(0, 0, { ...o, x0: 100, y0: 50 })).toEqual({ x: 132, y: 59 });
    expect(clampLabelCenter(5, 5, { w: 60, h: 14, x0: 0, y0: 0, iw: 40, ih: 10 })).toEqual({ x: 32, y: 9 }); // a rect smaller than the label: no crash
  });
});

describe('createFocusTracker (the lit distance label)', () => {
  it('calls back only when the lit label changes; a drag keeps it lit when the hover leaves', () => {
    const calls = [], f = createFocusTracker((n, p) => calls.push([n, p]));
    f.hover('a'); f.hover('a'); expect(calls).toEqual([['a', null]]);
    f.drag('a'); expect(calls.length).toBe(1); // already lit: no change
    f.hover(null); expect(f.get()).toBe('a'); expect(calls.length).toBe(1); // still dragged
    f.drag(null); expect(f.get()).toBeNull(); expect(calls[calls.length - 1]).toEqual([null, 'a']);
    f.drag('b'); f.hover('c'); expect(f.get()).toBe('b'); // the drag wins over the hover
  });
});

describe('depth cue helpers (build 493)', () => {
  it('fadeAlpha: faint only when hidden and not lit', () => {
    expect(fadeAlpha(false, false)).toBe(1); expect(fadeAlpha(true, false)).toBe(OCCLUDED_ALPHA); expect(fadeAlpha(true, true)).toBe(1); expect(fadeAlpha(false, true)).toBe(1);
    expect(OCCLUDED_ALPHA).toBeGreaterThanOrEqual(0.25); expect(OCCLUDED_ALPHA).toBeLessThanOrEqual(0.35);
  });
  it('probe keys: a not dragged label follows the line midpoint, a dragged one its own place', () => {
    expect(labelPart(null)).toBe(LABEL_MID); expect(labelPart(undefined)).toBe(LABEL_MID); expect(labelPart({ i: 1, j: 0, k: 0 })).toBe('L');
    expect(probeKey('m1', LABEL_MID)).toBe('m1|4'); expect(probeKey('m1', 'L')).toBe('m1|L');
  });
  it('lineSamplePoints: n + 1 points from a to b, evenly; the middle one is the midpoint', () => {
    const p = lineSamplePoints({ x: 0, y: 2, z: -4 }, { x: 8, y: 2, z: 4 });
    expect(p).toHaveLength(LINE_SAMPLES + 1); expect(p[0]).toEqual({ x: 0, y: 2, z: -4 }); expect(p[LINE_SAMPLES]).toEqual({ x: 8, y: 2, z: 4 }); expect(p[LABEL_MID]).toEqual({ x: 4, y: 2, z: 0 });
  });
  it('lineAlphas: faint exactly at the hidden samples', () => {
    expect(lineAlphas('m', null)).toEqual(Array(LINE_SAMPLES + 1).fill(1));
    const a = lineAlphas('m', new Set([probeKey('m', 0), probeKey('m', 5), probeKey('x', 1)]));
    expect(a.map(v => v < 1 ? 'h' : '.').join('')).toBe('h....h...');
  });
  it('approachAlpha: moves towards the target, never overshoots, snaps, does not move without time', () => {
    expect(approachAlpha(1, 0.3, 0)).toBe(1);
    const a = approachAlpha(1, 0.3, 35); expect(a).toBeLessThan(1); expect(a).toBeGreaterThan(0.3);
    let v = 1; for (let i = 0; i < 40; i++) v = approachAlpha(v, 0.3, 16); expect(v).toBe(0.3);
    let w = 0.3; for (let i = 0; i < 40; i++) w = approachAlpha(w, 1, 16); expect(w).toBe(1);
  });
});

describe('gradient stop offsets (build 494)', () => {
  it('equal depths (or orthographic): the offsets are i / n', () => {
    const o = lineStopOffsets(2, 2); for (let i = 0; i <= LINE_SAMPLES; i++) expect(o[i]).toBeCloseTo(i / LINE_SAMPLES, 12);
    const q = lineStopOffsets(1, 9, 0.01, true); for (let i = 0; i <= LINE_SAMPLES; i++) expect(q[i]).toBeCloseTo(i / LINE_SAMPLES, 12);
  });
  it('perspective: the 3D midpoint is not drawn at the middle of the segment (near end 1, far end 4 -> 0.8)', () => {
    const o = lineStopOffsets(1, 4); expect(o[0]).toBe(0); expect(o[LINE_SAMPLES]).toBe(1); expect(o[LABEL_MID]).toBeCloseTo(0.8, 12);
    const r = lineStopOffsets(4, 1); expect(r[LABEL_MID]).toBeCloseTo(0.2, 12); // the same line seen from the other end
    for (let i = 1; i <= LINE_SAMPLES; i++) expect(o[i]).toBeGreaterThanOrEqual(o[i - 1]);
  });
  it('matches a real projection of every sample along the drawn segment', () => {
    // camera space, looking down -z, focal 1: x_screen = x / depth
    const A = { x: -0.3, z: 0.5 }, B = { x: 0.8, z: 5 }, n = LINE_SAMPLES, o = lineStopOffsets(A.z, B.z, 0.01, false, n);
    const sx = t => (A.x + (B.x - A.x) * t) / (A.z + (B.z - A.z) * t), s0 = sx(0), s1 = sx(1);
    for (let i = 0; i <= n; i++) expect(o[i]).toBeCloseTo((sx(i / n) - s0) / (s1 - s0), 10);
  });
  it('near-clipped: only the part in front is drawn; samples behind snap to 0, the rest keep their place on the drawn part', () => {
    // a at depth -1 (behind the camera), b at depth 4, near 0.5: the line is in front from t = 1.5/5 = 0.3
    const o = lineStopOffsets(-1, 4, 0.5);
    expect(o[0]).toBe(0); expect(o[1]).toBe(0); expect(o[2]).toBe(0); // t = 0, .125, .25 are behind the near plane
    expect(o[LINE_SAMPLES]).toBe(1);
    for (let i = 1; i <= LINE_SAMPLES; i++) expect(o[i]).toBeGreaterThanOrEqual(o[i - 1]);
    for (const v of o) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    const t0 = 0.3, wa = 0.5, wb = 4, u = (0.5 - t0) / (1 - t0); // sample 4 (t = .5)
    expect(o[4]).toBeCloseTo(u * wb / ((1 - u) * wa + u * wb), 12);
    const p = lineStopOffsets(4, -1, 0.5); expect(p[LINE_SAMPLES]).toBe(1); expect(p[LINE_SAMPLES - 1]).toBe(1); expect(p[0]).toBe(0); // clipped at the far end
    for (let i = 1; i <= LINE_SAMPLES; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1]);
  });
  it('whole segment behind the near plane, or not finite: null', () => {
    expect(lineStopOffsets(-1, 0.001, 0.01)).toBeNull(); expect(lineStopOffsets(NaN, 1)).toBeNull();
  });
});

describe('unique ids (build 494)', () => {
  it('ids from the same project-file ids that look alike once made attribute-safe do not collide', () => {
    const next = createIdMaker('mg3d-'), safe = id => 'mg3d-' + String(id).replace(/[^\w-]/g, '_');
    expect(safe('距離')).toBe(safe('測定')); // the old scheme: a collision
    const ids = new Set(['距離A', '距離B', 'a b', 'a_b', 'a.b'].map(() => next())); expect(ids.size).toBe(5);
    expect([...ids].every(i => /^mg3d-\d+$/.test(i))).toBe(true);
  });
  it('every maker counts on its own', () => { const a = createIdMaker('x-'), b = createIdMaker('x-'); expect([a(), a(), b()]).toEqual(['x-1', 'x-2', 'x-1']) });
});

describe('probe gate (build 494): skip the judgement while nothing changed', () => {
  const cls = {}, e0 = { x: 0, y: 1.6, z: 0 };
  it('the first check runs; the same inputs skip', () => {
    const g = createProbeGate(0.005);
    expect(g.shouldRun('k', [cls], e0)).toBe(true); expect(g.shouldRun('k', [cls], { ...e0 })).toBe(false); expect(g.shouldRun('k', [cls], e0)).toBe(false);
  });
  it('a changed key or object runs again', () => {
    const g = createProbeGate(0.005); g.shouldRun('k', [cls], e0);
    expect(g.shouldRun('k2', [cls], e0)).toBe(true); expect(g.shouldRun('k2', [{}], e0)).toBe(true); expect(g.shouldRun('k2', [{}, 1], e0)).toBe(true);
  });
  it('the head sway under the tolerance is skipped; beyond it runs; a slow drift adds up from the LAST judged place', () => {
    const g = createProbeGate(0.005); g.shouldRun('k', [cls], e0);
    expect(g.shouldRun('k', [cls], { x: 0.003, y: 1.6, z: 0 })).toBe(false);
    expect(g.shouldRun('k', [cls], { x: 0.006, y: 1.6, z: 0 })).toBe(true); // 6 mm from the judged place
    expect(g.shouldRun('k', [cls], { x: 0.009, y: 1.6, z: 0 })).toBe(false); // 3 mm from the new one
    expect(g.shouldRun('k', [cls], { x: 0.009, y: 1.6, z: 0.0045 })).toBe(true); // 3 mm + 4.5 mm sideways = 5.4 mm
  });
  it('reset makes the next check run', () => {
    const g = createProbeGate(); g.shouldRun('k', [cls], e0); g.reset(); expect(g.shouldRun('k', [cls], e0)).toBe(true);
  });
});

describe('measure line colour (build 494, static)', () => {
  it('the measure line / leader out-rank `.comment-lines-3d line` (cyan) so they are yellow whether hidden or not', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../docs/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.comment-lines-3d \.measure-line-3d\{stroke:#ffd23d;/);
    expect(css).toMatch(/\.comment-lines-3d \.measure-leader-3d\{stroke:#ffd23d;/);
    expect(css).not.toMatch(/(^|\n)\.measure-(line|leader)-3d\{stroke/); // a bare class would lose to `.comment-lines-3d line` again
  });
});
