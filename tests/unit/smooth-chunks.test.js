import { describe, it, expect } from 'vitest';
import { makeVolume3DCoordinates, Float32FaceBuilder } from '../../docs/mesh-geometry.js';
import { smoothedChunkGeometry, createSeamLinker, snapToLattice, latticeHalfBox, SMOOTH_CHUNK_HALO, smoothChunkHalo, SmoothedSurfaceStream } from '../../docs/smooth-chunks.js';
import { vertexNormals } from '../../docs/smooth-prepare.js';
import { makeMask, voxelFaces, weld, edgeCounts } from '../helpers/voxel-mesh.js';

// a ball with a 1-voxel rod beside it, on an anisotropic grid, in the app's world coordinates (y flipped, scaled)
const W = 48, H = 48, D = 80, v = { columns: W, rows: H, slices: D, spacing: [0.04, 0.04, 0.06] };
const coords = makeVolume3DCoordinates(v);
const mask = makeMask(W, H, D, (x, y, z) => Math.hypot(x - 24, y - 24, (z - 40) * 1.5) < 18 || (Math.floor(x) === 24 && Math.floor(y) === 44 && z > 6 && z < D - 6));
const world = p => { const o = new Float32Array(p.length); for (let i = 0; i < p.length; i += 3) { o[i] = coords.xs[p[i]]; o[i + 1] = coords.ys[p[i + 1]]; o[i + 2] = coords.zs[p[i + 2]]; } return o; };
const triangles = (g, attr = 'position') => { const a = g.getAttribute(attr).array, ix = g.index.array, out = new Float32Array(ix.length * 3); for (let i = 0; i < ix.length; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = a[ix[i] * 3 + c]; return out; };

describe('chunked constrained smoothing', () => {
  it('assembles a watertight surface that matches the one-piece smoothing', () => {
    const strength = 4, fullGeometry = smoothedChunkGeometry(world(voxelFaces(mask, W, H, D).positions), { strength, coords }), full = triangles(fullGeometry), fullNormals = triangles(fullGeometry, 'normal');
    const seams = createSeamLinker(), parts = [], normals = [], chunk = 20;
    for (let z0 = 0; z0 < D; z0 += chunk) {
      const z1 = Math.min(D, z0 + chunk), lo = Math.max(0, z0 - SMOOTH_CHUNK_HALO), hi = Math.min(D, z1 + SMOOTH_CHUNK_HALO);
      const { positions, owner } = voxelFaces(mask, W, H, D, { zFrom: lo, zTo: hi });
      const coreFrom = owner.findIndex(z => z >= z0) * 18, after = owner.findIndex(z => z >= z1), coreTo = after < 0 ? positions.length : after * 18;
      const g = smoothedChunkGeometry(world(positions), { strength, coords, coreFrom, coreTo, seams, zLow: z0 > 0 ? z0 : null, zHigh: z1 < D ? z1 : null });
      expect(new Set(g.index.array).size).toBe(g.getAttribute('position').count); // no vertex of the halo alone is kept
      parts.push(triangles(g)); normals.push(triangles(g, 'normal'));
    }
    const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let q = 0; for (const p of parts) { all.set(p, q); q += p.length; }
    // the normals come from the whole chunk with its halo: a vertex on a chunk's first or last plane gets the triangles on
    // both sides of it, as in the one-piece surface (here 4e-6; from the core alone they were off by up to 0.26 there)
    q = 0; let worstNormal = 0; for (const p of normals) { for (let i = 0; i < p.length; i++) worstNormal = Math.max(worstNormal, Math.abs(p[i] - fullNormals[q + i])); q += p.length; }
    expect(worstNormal).toBeLessThan(1e-3);
    expect(all.length).toBe(full.length);
    const asm = weld(all);
    expect(edgeCounts(asm.idx).boundary).toBe(0);
    expect(edgeCounts(asm.idx).edges).toBe(edgeCounts(weld(full).idx).edges);
    // triangle for triangle the same surface as the one-piece smoothing, to well under a hundredth of a voxel
    const [hx, hy, hz] = latticeHalfBox(coords); let worst = 0;
    for (let i = 0; i < all.length; i += 3) worst = Math.max(worst, Math.abs(all[i] - full[i]) / hx, Math.abs(all[i + 1] - full[i + 1]) / hy, Math.abs(all[i + 2] - full[i + 2]) / hz);
    expect(worst / 2).toBeLessThan(0.01);
  });

  it('streams blocks of slices into chunks that assemble into the one-piece smoothed surface', async () => {
    const strength = 3, full = triangles(smoothedChunkGeometry(world(voxelFaces(mask, W, H, D).positions), { strength, coords }));
    const parts = [], zs = [];
    const stream = new SmoothedSurfaceStream({ keys: ['a'], coords, strength, slices: D, Builder: Float32FaceBuilder, onGeometry: (key, g, z) => { parts.push(triangles(g)); zs.push(z); } });
    // blocks of 1-7 slices, chunks cut after ~3000 faces or 18 slices (as the base surface builder)
    let z = 0, sinceCut = 0, n = 0;
    while (z < D) {
      const depth = Math.min(D - z, 1 + (n++ * 5) % 7);
      stream.builders.get('a').appendArray(world(voxelFaces(mask, W, H, D, { zFrom: z, zTo: z + depth }).positions));
      z += depth; sinceCut += depth; stream.endBlock(z);
      if (sinceCut >= 18 || stream.coreFloats() >= 3000 * 18) { stream.cut(); sinceCut = 0; }
    }
    await stream.finish();
    expect(parts.length).toBeGreaterThan(3);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let q = 0; for (const p of parts) { all.set(p, q); q += p.length; }
    expect(all.length).toBe(full.length);
    expect(edgeCounts(weld(all).idx).boundary).toBe(0);
    const [hx, hy, hz] = latticeHalfBox(coords); let worst = 0;
    for (let i = 0; i < all.length; i += 3) worst = Math.max(worst, Math.abs(all[i] - full[i]) / hx, Math.abs(all[i + 1] - full[i + 1]) / hy, Math.abs(all[i + 2] - full[i + 2]) / hz);
    expect(worst / 2).toBeLessThan(0.01);
    // only the slices a pending chunk still needs are held
    expect(stream.builders.get('a').length).toBeLessThan(full.length / 2);
  });

  it('takes a halo as long as the strength needs', () => {
    expect([0.6, 1, 1.5, 3, 3.5, 6].map(smoothChunkHalo)).toEqual([8, 8, 12, 12, SMOOTH_CHUNK_HALO, SMOOTH_CHUNK_HALO]);
  });

  it('snaps GPU-style f32 coordinates onto the CPU lattice', () => {
    const p = new Float32Array([coords.xs[3] + 1e-7, coords.ys[5] - 1e-7, coords.zs[7] + 2e-7]);
    snapToLattice(p, coords);
    expect([p[0], p[1], p[2]]).toEqual([Math.fround(coords.xs[3]), Math.fround(coords.ys[5]), Math.fround(coords.zs[7])]);
    expect(latticeHalfBox(coords).map(x => +(x / coords.scale).toFixed(6))).toEqual([0.02, 0.02, 0.03]);
  });

  it('pins the vertices of pinned keys', () => {
    const tri = world(voxelFaces(mask, W, H, D, { zFrom: 30, zTo: 50 }).positions), k = i => Math.fround(tri[i]) + ',' + Math.fround(tri[i + 1]) + ',' + Math.fround(tri[i + 2]);
    const pinnedKeys = new Set(); for (let i = 0; i < tri.length; i += 9) pinnedKeys.add(k(i));
    const g = smoothedChunkGeometry(new Float32Array(tri), { strength: 6, coords, pinnedKeys }), a = g.getAttribute('position').array;
    let found = 0; for (let i = 0; i < a.length; i += 3) if (pinnedKeys.has(a[i] + ',' + a[i + 1] + ',' + a[i + 2])) found++;
    expect(found).toBe(pinnedKeys.size);
  });

  it('makes the vertex normals bit for bit as three.js computeVertexNormals', () => {
    const g = smoothedChunkGeometry(world(voxelFaces(mask, W, H, D).positions), { strength: 2, coords }), ours = g.getAttribute('normal').array.slice();
    g.deleteAttribute('normal'); g.computeVertexNormals();
    expect(ours.length).toBe(g.getAttribute('normal').array.length);
    expect(ours.every((x, i) => Object.is(x, g.getAttribute('normal').array[i]))).toBe(true);
    // a triangle that uses one vertex twice adds to it once (three.js reads all corners before writing)
    const n = vertexNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2, 0, 0, 1]));
    expect(Array.from(n.slice(0, 3))).toEqual([0, 0, 1]);
  });
});
