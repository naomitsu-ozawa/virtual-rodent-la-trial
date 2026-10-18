import { describe, it, expect } from 'vitest';
import { constrainedSmoothPositions, constrainedSmoothSchedule } from '../../docs/constrained-smooth.js';
import { makeMask, voxelFaces, weld, vertexNormals, volume, edgeCounts, planeStats, thickness } from '../helpers/voxel-mesh.js';

// the surface smoothing for 3D printing (build 612): staircases go, 1-voxel structures stay
const strength4 = constrainedSmoothSchedule(4);
const mesh = (w, h, d, inside, boundary = true) => weld(voxelFaces(makeMask(w, h, d, inside), w, h, d, { boundary }).positions);

describe('constrainedSmoothSchedule', () => {
  it('maps the 0-6 strength to iterations and low-pass rounds', () => {
    expect(constrainedSmoothSchedule(0)).toEqual({ iterations: 0, lowpass: 0 });
    expect(constrainedSmoothSchedule(1)).toEqual({ iterations: 20, lowpass: 8 });
    expect(constrainedSmoothSchedule(2)).toEqual({ iterations: 40, lowpass: 12 });
    expect(constrainedSmoothSchedule(3)).toEqual({ iterations: 60, lowpass: 12 });
    expect(constrainedSmoothSchedule(4)).toEqual({ iterations: 100, lowpass: 20 });
    expect(constrainedSmoothSchedule(5)).toEqual({ iterations: 150, lowpass: 20 });
    expect(constrainedSmoothSchedule(6)).toEqual({ iterations: 150, lowpass: 20 });
    expect(constrainedSmoothSchedule(0.6)).toEqual({ iterations: 12, lowpass: 8 });
    expect(constrainedSmoothSchedule(3.5)).toEqual({ iterations: 80, lowpass: 16 });
    expect(constrainedSmoothSchedule('x')).toEqual({ iterations: 0, lowpass: 0 });
  });
});

describe('constrainedSmoothPositions', () => {
  it('flattens the terraces of a 5 degree slope', () => {
    const W = 96, H = 24, D = 40, z0 = D / 2, slope = Math.tan(5 * Math.PI / 180);
    const { pos, idx } = mesh(W, H, D, (x, y, z) => z < z0 + slope * x, false);
    const before = planeStats(pos, slope, W, H, z0).pp;
    constrainedSmoothPositions(pos, idx, strength4);
    const after = planeStats(pos, slope, W, H, z0).pp;
    expect(before).toBeGreaterThan(0.9);
    expect(after).toBeLessThan(0.25);
  });

  it('flattens a 15 degree slope at strength 3', () => {
    const W = 96, H = 24, D = 40, z0 = D / 2, slope = Math.tan(15 * Math.PI / 180);
    const { pos, idx } = mesh(W, H, D, (x, y, z) => z < z0 + slope * x, false);
    constrainedSmoothPositions(pos, idx, constrainedSmoothSchedule(3));
    expect(planeStats(pos, slope, W, H, z0).pp).toBeLessThan(0.35);
  });

  it('keeps a 1-voxel rod (volume) and its surface closed', () => {
    const { pos, idx } = mesh(9, 9, 40, (x, y, z) => Math.floor(x) === 4 && Math.floor(y) === 4 && z > 2 && z < 38);
    expect(volume(pos, idx)).toBeCloseTo(36, 5);
    constrainedSmoothPositions(pos, idx, strength4);
    expect(volume(pos, idx)).toBeGreaterThan(35);
    expect(edgeCounts(idx).boundary).toBe(0);
  });

  it('keeps the thickness of a 1-voxel plate and the width of a 1-voxel gap', () => {
    const W = 36, D = 36;
    const plate = mesh(W, 9, D, (x, y, z) => Math.floor(y) === 4 && x > 3 && x < W - 3 && z > 3 && z < D - 3);
    constrainedSmoothPositions(plate.pos, plate.idx, strength4);
    const t = thickness(plate.pos, vertexNormals(plate.pos, plate.idx), 1, 0.75, (x, y, z) => x > 8 && x < W - 8 && z > 8 && z < D - 8);
    expect(t.min).toBeGreaterThan(0.98);
    expect(Math.abs(t.med - 1)).toBeLessThan(0.02);
    const gap = mesh(W, 11, D, (x, y, z) => (Math.floor(y) === 4 || Math.floor(y) === 6) && x > 3 && x < W - 3 && z > 3 && z < D - 3);
    constrainedSmoothPositions(gap.pos, gap.idx, strength4);
    const g = thickness(gap.pos, vertexNormals(gap.pos, gap.idx), 1, 0.75, (x, y, z) => x > 8 && x < W - 8 && z > 8 && z < D - 8 && y > 4.4 && y < 6.6);
    expect(-g.max).toBeGreaterThan(0.97); // the narrowest place of the gap
  });

  it('does not shrink a convex blob (sphere r=8)', () => {
    const { pos, idx } = mesh(24, 24, 24, (x, y, z) => (x - 12) ** 2 + (y - 12) ** 2 + (z - 12) ** 2 < 64);
    expect(volume(pos, idx)).toBeCloseTo(2176, 3);
    constrainedSmoothPositions(pos, idx, strength4);
    expect(volume(pos, idx)).toBeGreaterThan(2050);
  });

  it('never moves a vertex by more than half a voxel per axis (anisotropic spacing too)', () => {
    const sp = [0.5, 0.5, 2];
    const { pos, idx } = mesh(24, 24, 24, (x, y, z) => (x - 12) ** 2 + (y - 12) ** 2 + (z - 12) ** 2 < 64);
    for (let i = 0; i < pos.length; i += 3) { pos[i] *= sp[0]; pos[i + 1] *= sp[1]; pos[i + 2] *= sp[2]; }
    const orig = new Float32Array(pos), r = constrainedSmoothPositions(pos, idx, strength4);
    expect(r.box.map(v => +v.toFixed(6))).toEqual([0.25, 0.25, 1]);
    let moved = 0;
    for (let i = 0; i < pos.length; i++) { const d = Math.abs(pos[i] - orig[i]); expect(d).toBeLessThanOrEqual(sp[i % 3] / 2 + 1e-5); if (d > 1e-3) moved++; }
    expect(moved).toBeGreaterThan(pos.length / 10);
  });

  it('leaves pinned vertices where they are', () => {
    const { pos, idx } = mesh(24, 24, 24, (x, y, z) => (x - 12) ** 2 + (y - 12) ** 2 + (z - 12) ** 2 < 64);
    const n = pos.length / 3, pinned = new Uint8Array(n), orig = new Float32Array(pos);
    for (let i = 0; i < n; i += 2) pinned[i] = 1;
    constrainedSmoothPositions(pos, idx, { ...strength4, pinned });
    for (let i = 0; i < n; i += 2) expect([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]).toEqual([orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]]);
  });

  it('does nothing at strength 0 or on an empty mesh', () => {
    const { pos, idx } = mesh(8, 8, 8, (x, y, z) => x > 2 && x < 6 && y > 2 && y < 6 && z > 2 && z < 6);
    const orig = new Float32Array(pos);
    expect(constrainedSmoothPositions(pos, idx, constrainedSmoothSchedule(0)).iterations).toBe(0);
    expect(pos).toEqual(orig);
    expect(constrainedSmoothPositions(new Float32Array(0), new Uint32Array(0), strength4).iterations).toBe(0);
  });
});
