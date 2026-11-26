// The march variants of the performance record's shadow passes (docs/vr-wgpu-coarse-march.js): distSplit (the distance bytes in a texture of their own) and march2 / march2c4 (a coarse lower-bound grid read first).
// Tested here: the coarse grid is a lower bound of what a trilinear sample can read (brute force on synthetic distance data), the two-stage walk finds the same first inside grid point k* with the same state as the display's walk
// (a JS model of the shader's march, many random rays on volumes made with the real distance-field code), the text of the variants, the host's wiring (mock device: CI has no GPU) and the record's table / collector.
import { describe, it, expect, vi } from 'vitest';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, uniformLayout } from '../../docs/vr-wgsl-core.js';
import { euclideanDistanceBytes } from '../../docs/distance-field.js';
import { createVrVolumeRenderer } from '../../docs/vr-wgpu.js';
import { createVolBreakdown, createPerfLog, perfReport, BD_VARIANTS, BD_SPECS } from '../../docs/vr-perf-log.js';
import { MARCH_VARIANTS, MARCH_CELLS, MARCH_BINDINGS, MARCH_JUMP_MARGIN, MARCH_JUMP_MIN, extractDistPlane, coarseDims, coarseRange, coarseMinRange, coarseMinGrid, createMarchGridBuilder, marchWgsl } from '../../docs/vr-wgpu-coarse-march.js';

const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// ---- the trilinear sample as the sampler makes it: the texel centres at +1/2, clamp to edge; tc already clamped to [0, 0.999999] by the march ----
const tri = (get, dims, tc) => {
  const p = [0, 1, 2].map(i => tc[i] * dims[i] - 0.5), f = p.map(Math.floor), w = p.map((v, i) => v - f[i]);
  const cl = (i, a) => Math.min(dims[a] - 1, Math.max(0, i));
  let s = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const wt = (dx ? w[0] : 1 - w[0]) * (dy ? w[1] : 1 - w[1]) * (dz ? w[2] : 1 - w[2]);
    if (wt > 0) s += wt * get(cl(f[0] + dx, 0), cl(f[1] + dy, 1), cl(f[2] + dz, 2));
  }
  return s;
};
const idxOf = (dims, x, y, z) => (z * dims[1] + y) * dims[0] + x;
// a volume: spheres and slabs of "inside" voxels, its distance bytes (the real euclideanDistanceBytes), the class bytes (255 inside), the combined rgba bytes (rgb = class in channel 0, alpha = distance)
const makeVolume = (dims, seed, { blobs = 6, rMin = 2, rMax = 7, slabs = 0 } = {}) => {
  const R = rng(seed), n = dims[0] * dims[1] * dims[2], inside = new Uint8Array(n);
  for (let b = 0; b < blobs; b++) {
    const c = dims.map(d => R() * d), r = rMin + R() * (rMax - rMin);
    for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) if ((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 <= r * r) inside[idxOf(dims, x, y, z)] = 1;
  }
  for (let s = 0; s < slabs; s++) { const z0 = Math.floor(R() * (dims[2] - 2)); for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) inside[idxOf(dims, x, y, z0)] = 1; }
  const dist = euclideanDistanceBytes(inside, dims), data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { data[4 * i] = inside[i] ? 255 : 0; data[4 * i + 3] = dist[i]; }
  return { dims, inside, dist, data };
};

describe('the coarse grid is a lower bound of the distance a trilinear sample can read', () => {
  it('the cell value is the minimum over the texel block [cell * C - 1, (cell + 1) * C] (clamped), on sizes that are not a multiple of the cell', () => {
    for (const dims of [[16, 16, 16], [13, 11, 9], [20, 5, 17]]) for (const C of [4, 8]) {
      const R = rng(dims[0] * 31 + C), n = dims[0] * dims[1] * dims[2], dist = new Uint8Array(n).map(() => Math.floor(R() * 256));
      const g = coarseMinGrid(dist, dims, C), [cw, ch, cd] = coarseDims(dims, C);
      expect(g.length).toBe(cw * ch * cd);
      for (let cz = 0; cz < cd; cz++) for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
        const [x0, x1] = coarseRange(cx, C, dims[0]), [y0, y1] = coarseRange(cy, C, dims[1]), [z0, z1] = coarseRange(cz, C, dims[2]);
        let m = 255; for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m = Math.min(m, dist[idxOf(dims, x, y, z)]);
        expect(g[(cz * ch + cy) * cw + cx]).toBe(m);
      }
    }
  });
  it('every trilinear sample at a point of the cell (and up to half a voxel outside it: a rounded cell index) is at or above the cell value: random points, the grid edges and the cell boundaries', () => {
    for (const dims of [[24, 24, 24], [19, 13, 22]]) for (const C of [4, 8]) {
      const R = rng(7 + C), n = dims[0] * dims[1] * dims[2], dist = new Uint8Array(n);
      for (let i = 0; i < n; i++) dist[i] = R() < 0.5 ? Math.floor(R() * 256) : 40 + Math.floor(R() * 20); // rough data: the bound must hold for any bytes, not only for a distance field
      const g = coarseMinGrid(dist, dims, C), cds = coarseDims(dims, C), get = (x, y, z) => dist[idxOf(dims, x, y, z)];
      let checked = 0;
      const check = (x) => { // x = the position in texel-edge units on each axis ([0, dims))
        const tc = x.map((v, i) => Math.min(Math.max(v / dims[i], 0), 0.999999)), v = tri(get, dims, tc);
        const base = tc.map((c, i) => Math.floor(c * dims[i] / C));
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const cell = [base[0] + dx, base[1] + dy, base[2] + dz]; if (cell.some((c, i) => c < 0 || c >= cds[i])) continue;
          const px = tc.map((c, i) => c * dims[i]), inside = cell.every((c, i) => px[i] >= c * C - 0.5 && px[i] < (c + 1) * C + 0.5);
          if (!inside) continue;
          checked++; expect(v).toBeGreaterThanOrEqual(g[(cell[2] * cds[1] + cell[1]) * cds[0] + cell[0]] - 1e-9);
        }
      };
      for (let i = 0; i < 4000; i++) check([R() * dims[0], R() * dims[1], R() * dims[2]]);
      for (let i = 0; i < 600; i++) check(dims.map(d => { const c = Math.floor(R() * (d / C + 1)) * C + (R() < 0.5 ? -0.5 : 0) + (R() - 0.5) * 1e-3; return c; })); // on and around the cell boundaries
      for (let i = 0; i < 300; i++) check(dims.map(d => (R() < 0.5 ? 0 : d - 1e-7) + (R() - 0.5) * 1e-6)); // the grid edges
      expect(checked).toBeGreaterThan(4000);
    }
  });
  it('extractDistPlane takes the alpha byte of the slices asked for; the chunked builder makes the very same plane and grids as the one-shot functions, in the order z 0..d-1, each slice once', () => {
    const dims = [17, 9, 13], R = rng(3), n = 17 * 9 * 13, data = new Uint8Array(n * 4).map(() => Math.floor(R() * 256));
    const out = new Uint8Array(n); extractDistPlane(data, dims, out, 2, 5);
    for (let i = 0; i < n; i++) expect(out[i]).toBe(Math.floor(i / (17 * 9)) >= 2 && Math.floor(i / (17 * 9)) < 5 ? data[4 * i + 3] : 0);
    const slabs = [], b = createMarchGridBuilder({ data, dims, cells: [4, 8], onDistSlab: (z0, z1) => slabs.push([z0, z1]) });
    let steps = 0; while (!b.step(400)) steps++;
    expect(steps).toBeGreaterThan(5); expect(b.done).toBe(true);
    let at = 0; for (const [z0, z1] of slabs) { expect(z0).toBe(at); expect(z1).toBeGreaterThan(z0); at = z1; } expect(at).toBe(13);
    const full = new Uint8Array(n); extractDistPlane(data, dims, full, 0, 13); expect(Array.from(b.dist)).toEqual(Array.from(full));
    for (const C of [4, 8]) expect(Array.from(b.coarse.get(C))).toEqual(Array.from(coarseMinGrid(full, dims, C)));
    expect(b.step()).toBe(true);
  });
  it('a distance field of the real code: its coarse grid is a lower bound of every sample, and rises with the distance (a cell far from every surface has a large value)', () => {
    const v = makeVolume([40, 40, 40], 11, { blobs: 2, rMin: 3, rMax: 4 }), g = coarseMinGrid(v.dist, v.dims, 8);
    expect(Math.max(...g)).toBeGreaterThan(12); expect(Math.min(...g)).toBe(0);
    const R = rng(5), get = (x, y, z) => v.dist[idxOf(v.dims, x, y, z)];
    for (let i = 0; i < 3000; i++) { const tc = [R() * 0.999999, R() * 0.999999, R() * 0.999999], c = tc.map(x => Math.floor(x * 40 / 8)); expect(tri(get, v.dims, tc)).toBeGreaterThanOrEqual(g[(c[2] * 5 + c[1]) * 5 + c[0]] - 1e-9); }
  });
});

// ---- a JS model of the shader's march (docs/vr-wgsl-core.js, the loop and the hit's state), with the coarse step of march2 as an option ----
// What matters for the picture is the hit: the grid point k* where the ray is first inside a shown segment and the state the search / gradient start from (prevValid, previousT, prevF); a ray that ends with no hit is a pass.
const modelWalk = (vol, ray, opt = {}) => {
  const { dims } = vol, he = vol.halfExt, vm = Math.min(...he.map((h, i) => 2 * h / dims[i])), stp = Math.max(opt.stepVoxels * vm, 1e-5);
  const { o, dir } = ray, inv = he.map((h, i) => 1 / (Math.abs(dir[i]) < 1e-20 ? 1e-20 : dir[i]));
  const a = he.map((h, i) => (-h - o[i]) * inv[i]), b = he.map((h, i) => (h - o[i]) * inv[i]);
  const lo = Math.max(...a.map((x, i) => Math.min(x, b[i]))), hi = Math.min(...a.map((x, i) => Math.max(x, b[i])));
  if (lo > hi) return { kind: 'miss' };
  const jkA = Math.max(1 / Math.max(0.5 * Math.hypot(...dir.map((d, i) => d * dims[i] / he[i])), 1e-6), vm);
  const t0 = Math.max(lo, 0), endT = hi, faceT = lo > 0 && t0 <= lo + 1e-4 ? t0 : -1;
  const gInv = he.map(h => 0.5 / h), tcOf = t => { const p = o.map((x, i) => x + dir[i] * t); return [p[0] * gInv[0] + 0.5, 0.5 - p[1] * gInv[1], p[2] * gInv[2] + 0.5].map(c => Math.min(Math.max(c, 0), 0.999999)); };
  const dget = (x, y, z) => vol.dist[idxOf(dims, x, y, z)], cget = (x, y, z) => vol.inside[idxOf(dims, x, y, z)] * 255;
  let k = 0, previousT = t0, prevValid = false, prevF = 0, iters = 0, coarseJumps = 0, fineReads = 0, outSeen = false, startInside = null;
  for (let iter = 0; iter < 4096; iter++) {
    const t = t0 + k * stp; if (t > endT) break;
    iters++;
    const tc = tcOf(t);
    if (opt.coarse && (outSeen || opt.coarse.always)) { // (the shader: outSeen && jumpOn; the first read sample must have been outside every shown segment; `always` = the model without that rule, for the test that it is needed)
      const C = opt.coarse.cell, cdm = coarseDims(dims, C), c = tc.map((x, i) => Math.min(Math.floor(x * dims[i] / C), cdm[i] - 1)), dc = opt.coarse.grid[(c[2] * cdm[1] + c[1]) * cdm[0] + c[0]];
      if (dc >= opt.coarse.minD) { const m = Math.max(1, Math.floor((dc - MARCH_JUMP_MARGIN) * jkA / stp)); previousT = t0 + (k + m) * stp - stp * 0.05; prevValid = false; k += m; coarseJumps++; continue; }
    }
    fineReads++;
    const q = tri(cget, dims, tc) / 255; let dd = tri(dget, dims, tc);
    if (startInside === null) startInside = q - 0.5 >= 0;
    if (!outSeen && q - 0.5 < 0) outSeen = true;
    if (dd >= MARCH_JUMP_MIN && t <= faceT && q - 0.5 >= 0) dd = 0;
    if (dd >= MARCH_JUMP_MIN) { const m = Math.max(1, Math.floor((dd - MARCH_JUMP_MARGIN) * jkA / stp)); previousT = t0 + (k + m) * stp - stp * 0.05; prevValid = false; k += m; continue; }
    const f = q - 0.5;
    if (f >= 0) return { kind: 'hit', k, prevValid, previousT, prevF, iters, coarseJumps, fineReads, startInside };
    prevValid = true; prevF = f; previousT = t; k++;
  }
  return { kind: 'pass', iters, coarseJumps, fineReads };
};
// mode 0: from outside the box, aimed into it; 1: from a random point inside the box; 2: from the centre of a random voxel that is inside a segment (the camera inside a segment)
const randomRay = (R, he, mode, vol = null) => {
  if (mode === 2 && vol) {
    const n = vol.inside.length; let i = Math.floor(R() * n), tries = 0; while (!vol.inside[i] && tries++ < 5000) i = Math.floor(R() * n);
    if (vol.inside[i]) { const [w, h] = vol.dims, x = i % w, y = Math.floor(i / w) % h, z = Math.floor(i / (w * h)), c = [x, y, z].map((v, a) => (v + 0.5) / vol.dims[a]), o = [(c[0] - 0.5) * 2 * he[0], (0.5 - c[1]) * 2 * he[1], (c[2] - 0.5) * 2 * he[2]], d = [R() - 0.5, R() - 0.5, R() - 0.5], l = Math.hypot(...d); return { o, dir: d.map(q => q / l) }; }
  }
  if (mode) { const o = he.map(h => (R() * 2 - 1) * h * 0.9), d = [R() - 0.5, R() - 0.5, R() - 0.5], l = Math.hypot(...d); return { o, dir: d.map(x => x / l) }; }
  const d0 = [R() - 0.5, R() - 0.5, R() - 0.5], l0 = Math.hypot(...d0), rad = 3 * Math.max(...he), o = d0.map(x => x / l0 * rad), tg = he.map(h => (R() * 2 - 1) * h * 0.9), d = tg.map((x, i) => x - o[i]), l = Math.hypot(...d);
  return { o, dir: d.map(x => x / l) };
};
const same = (a, b) => a.kind === b.kind && (a.kind !== 'hit' || (a.k === b.k && a.prevValid === b.prevValid && a.previousT === b.previousT && a.prevF === b.prevF));
const VOLUMES = [
  { name: 'cube, spheres', vol: { ...makeVolume([40, 40, 40], 1, { blobs: 7, rMin: 2, rMax: 8 }), halfExt: [1, 1, 1] } },
  { name: 'anisotropic box, many small', vol: { ...makeVolume([44, 30, 36], 2, { blobs: 14, rMin: 1.5, rMax: 4 }), halfExt: [1.1, 1.5, 0.7] } },
  { name: 'thin slabs and one blob', vol: { ...makeVolume([36, 36, 36], 3, { blobs: 1, rMin: 5, rMax: 6, slabs: 2 }), halfExt: [0.9, 1.0, 1.1] } },
  { name: 'empty with one speck', vol: { ...makeVolume([32, 32, 32], 4, { blobs: 1, rMin: 1, rMax: 1.2 }), halfExt: [1, 1, 1] } },
  { name: 'two very large blobs (the camera can be deep inside a segment)', vol: { ...makeVolume([64, 64, 64], 7, { blobs: 2, rMin: 20, rMax: 30 }), halfExt: [1, 1, 1] } },
];
const MODES = i => [0, 0, 1, 2][i % 4]; // per ray: 2 of 4 from outside, 1 from a point inside the box, 1 from inside a segment
const pair = (vol, ray, C, step, grid) => [modelWalk(vol, ray, { stepVoxels: step }), modelWalk(vol, ray, { stepVoxels: step, coarse: { cell: C, grid, minD: Math.max(C, MARCH_JUMP_MIN) } })];
describe('the two-stage walk (march2) finds the same hit as the display\'s walk', () => {
  for (const [C, step] of [[8, 0.85], [4, 0.85], [8, 0.6], [8, 1.4]]) {
    it(`cell ${C}, step ${step} voxel: the same pass / hit, the same grid point k*, the same state at the hit, on 5 volumes and 6000 random rays (from outside the box, from inside it, from inside a segment)`, () => {
      let hits = 0, passes = 0, coarse = 0, fewer = 0, landed = 0, landedOutside = 0, fromInside = 0;
      for (const { vol } of VOLUMES) {
        const grid = coarseMinGrid(vol.dist, vol.dims, C), R = rng(C * 1000 + Math.round(step * 100));
        for (let i = 0; i < 1200; i++) {
          const ray = randomRay(R, vol.halfExt, MODES(i), vol), [a, b] = pair(vol, ray, C, step, grid);
          if (!same(a, b)) throw new Error('walks differ on ' + vol.dims + ' ray ' + i + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
          if (a.kind === 'hit') { hits++; if (a.startInside) fromInside++; if (!a.prevValid && a.k > 0) { landed++; if (!a.startInside) landedOutside++; } } else if (a.kind === 'pass') passes++;
          if (b.coarseJumps) { coarse++; if (b.fineReads < a.fineReads) fewer++; }
        }
      }
      expect(landedOutside).toBe(0); // every hit that the display reaches by a jump (not by a step) belongs to a ray that starts inside a segment: no unexplained remainder
      expect(landed).toBeGreaterThan(0); expect(fromInside).toBeGreaterThan(100); // (and such rays are in the sample)
      expect(hits).toBeGreaterThan(1000); expect(passes).toBeGreaterThan(300); expect(coarse).toBeGreaterThan(500); expect(fewer).toBeGreaterThan(300); // the walk really uses the coarse step and reads the fine texture less often
    });
  }
  it('without the rule that the first read sample must be outside (coarse jumps from the first sample on) the walks differ on rays that start deep inside a segment, and only on those: the rule is needed, and the test sees it', () => {
    let differ = 0, differOutside = 0;
    const vol = VOLUMES[VOLUMES.length - 1].vol;
    for (const C of [8, 4]) {
      const grid = coarseMinGrid(vol.dist, vol.dims, C), R = rng(31 + C);
      for (let i = 0; i < 3000; i++) {
        const ray = randomRay(R, vol.halfExt, MODES(i), vol), a = modelWalk(vol, ray, { stepVoxels: 0.85 }), b = modelWalk(vol, ray, { stepVoxels: 0.85, coarse: { cell: C, grid, minD: C, always: true } });
        if (!same(a, b)) { differ++; if (!a.startInside) differOutside++; }
      }
    }
    expect(differ).toBeGreaterThan(5); expect(differOutside).toBe(0);
  });
  it('the test can fail: a coarse grid that is not a lower bound (every value 40 too high) makes some walks differ', () => {
    let differ = 0;
    for (const { vol } of VOLUMES.slice(0, 2)) {
      const grid = coarseMinGrid(vol.dist, vol.dims, 8).map(v => Math.min(255, v + 40)), R = rng(99);
      for (let i = 0; i < 800; i++) { const ray = randomRay(R, vol.halfExt, 0); if (!same(modelWalk(vol, ray, { stepVoxels: 0.85 }), modelWalk(vol, ray, { stepVoxels: 0.85, coarse: { cell: 8, grid, minD: 8 } }))) differ++; }
    }
    expect(differ).toBeGreaterThan(0);
  });
});

// ---- the text of the variants ----
const BASES = []; for (const f16 of [false, true]) for (const cls4 of [false, true]) BASES.push({ f16, cls4, events: false });
describe('the WGSL of the variants', () => {
  for (const base of BASES) for (const kind of Object.keys(MARCH_VARIANTS)) {
    it(`${kind} of f16=${base.f16} cls4=${base.cls4}: parses, binds group ${MARCH_BINDINGS.group} (distance, coarse grid), keeps the display's other text`, () => {
      const t0 = volumeWgsl(base), t = marchWgsl(t0, kind);
      expect(() => new WgslReflect(t)).not.toThrow();
      expect(t).toContain('@group(1) @binding(0) var distTex:texture_3d<f32>;'); expect(t).toContain('@group(1) @binding(1) var coarseTex:texture_3d<f32>;');
      expect(t).toContain('march=' + kind);
      expect(t.split('\n').length).toBeGreaterThan(t0.split('\n').length);
      expect(t.replace(/ march=\w+\n/, '\n')).not.toBe(t0);
    });
  }
  it('distSplit: the distance is read from distTex before the class; the class is read at the entry sample (the face rule) and after the jump; march2: the coarse jump comes first and is the display\'s jump formula on the coarse value', () => {
    const t0 = volumeWgsl({ f16: false, cls4: false, events: false }), ds = marchWgsl(t0, 'distSplit'), m2 = marchWgsl(t0, 'march2');
    const loop = ds.slice(ds.indexOf('let tcS=cl(tcO+tcD*t);'));
    expect(loop.indexOf('textureSampleLevel(distTex,smp,tcS,0.0)')).toBeGreaterThan(-1);
    expect(loop.indexOf('textureSampleLevel(distTex,smp,tcS,0.0)')).toBeLessThan(loop.indexOf('textureSampleLevel(clsTex,smp,tcS,0.0)'));
    expect(loop.indexOf('haveQ=true')).toBeLessThan(loop.indexOf('if(dd>=2.7){let m=')); expect(loop.indexOf('if(dd>=2.7){let m=')).toBeLessThan(loop.indexOf('if(!haveQ){q=textureSampleLevel(clsTex'));
    const displayJump = /let m=max\(1,i32\(floor\(\(dd-([\d.]+)\)\*jkA\/stp\)\)\);let nextJ=t0\+f32\(k\+m\)\*stp;jumpLen\+=nextJ-t;previousT=nextJ-stp\*0\.05;prevValid=false;/.exec(t0), coarseJump = /let m=max\(1,i32\(floor\(\(dc-([\d.]+)\)\*jkA\/stp\)\)\);let nextJ=t0\+f32\(k\+m\)\*stp;jumpLen\+=nextJ-t;previousT=nextJ-stp\*0\.05;prevValid=false;/.exec(m2);
    expect(displayJump && coarseJump).toBeTruthy(); expect(Number(displayJump[1])).toBe(MARCH_JUMP_MARGIN); expect(Number(coarseJump[1])).toBe(MARCH_JUMP_MARGIN);
    expect(t0).toContain('if(dd>=2.7){'); expect(m2).toContain('if(dc>=COARSE_MIN)'); expect(m2).toContain('const COARSE_MIN:f32=8.0;'); expect(m2).toContain('const COARSE_CELL:f32=8.0;');
    expect(m2.indexOf('if(outSeen&&u.jumpOn!=0)')).toBeLessThan(m2.indexOf('var q=textureSampleLevel(clsTex,smp,tcS,0.0);var dd=q.a*255.0;')); // jumps are on and a read sample has been outside; the first samples are read by the display's rules
    for (const base of BASES) { // the outside test of the first samples is the display's inside test of its face rule (the same expression, on a copy of the class vector made the same way)
      const d = volumeWgsl(base), m = marchWgsl(d, 'march2'), face = /var qf=q;([^\n]*)\n\s+let qfc=([^\n]*)\n\s+if\((max\(max\(dot\(qfc,sel0\)[^\n]*)>=(f16|f32)\(0\.0\)\)\{dd=0\.0;\}/.exec(d), mine = /if\(!outSeen\)\{var qo=q;([^\n]*)\n\s+let qoc=([^\n]*)\n\s+outSeen=!\((max\(max\(dot\(qoc,sel0\)[^\n]*)>=(f16|f32)\(0\.0\)\);\}/.exec(m);
      expect(face && mine).toBeTruthy(); expect(mine[2]).toBe(face[2].replace(/qf/g, 'qo').replace(/qfc/g, 'qoc')); expect(mine[3].replace(/qoc/g, 'qfc')).toBe(face[3]); expect(mine[4]).toBe(face[4]); expect(mine[1]).toBe(face[1].replace(/qf/g, 'qo'));
    }
    expect(marchWgsl(t0, 'march2c4')).toContain('const COARSE_CELL:f32=4.0;');
    for (const k of Object.keys(MARCH_VARIANTS)) if (MARCH_VARIANTS[k].cell) expect(Math.max(MARCH_VARIANTS[k].minD, MARCH_JUMP_MIN)).toBeGreaterThanOrEqual(2.7); // a coarse jump is never taken below the display's own threshold
  });
  it('a program with section planes (events) and an unknown kind are refused; a text whose anchor is missing throws', () => {
    expect(() => marchWgsl(volumeWgsl({ f16: false, cls4: false, events: true }), 'march2')).toThrow(/section/);
    expect(() => marchWgsl(volumeWgsl({ f16: false, cls4: false, events: false }), 'nope')).toThrow(/unknown/);
    expect(() => marchWgsl('struct U{}', 'march2')).toThrow(/anchor/);
  });
  it('the display\'s own text is not changed by the variants (the same text again after making them)', () => {
    const a = volumeWgsl({ f16: false, cls4: true, events: false }); marchWgsl(a, 'distSplit'); marchWgsl(a, 'march2'); expect(volumeWgsl({ f16: false, cls4: true, events: false })).toBe(a);
  });
});

// ---- the record's table and collector ----
describe('the record: the variants are in the table and the collector keeps their time ratios and picture differences', () => {
  it('BD_VARIANTS has distSplit, march2, march2c4 in this order (the specs carry march = their kind: the host compiles and runs them); the diff of a variant is its own line', () => {
    { const m3 = ['distSplit', 'march2', 'march2c4']; expect(BD_VARIANTS.filter(v => m3.includes(v))).toEqual(m3); }
    for (const k of Object.keys(MARCH_VARIANTS)) { expect(BD_SPECS[k]).toEqual({ name: k, march: k, diff: true }); expect(BD_VARIANTS).toContain(k); }
    expect(MARCH_CELLS).toEqual([8, 4]);
    const vb = createVolBreakdown();
    for (let i = 0; i < 10; i++) { vb.add('same', 10, 10); vb.add('distSplit', 8, 10); vb.add('march2', 6, 10); }
    expect(vb.add('diff:distSplit', 0, 38400)).toBe(true); expect(vb.add('diff:distSplit', 3, 38400)).toBe(true); expect(vb.add('diff:march2', 0, 38400)).toBe(true);
    expect(vb.add('diff:march2', -1, 38400)).toBe(false); expect(vb.add('diff:march2', 0, 0)).toBe(false);
    const s = vb.summary(); expect(s.variants.distSplit.R).toBeCloseTo(0.8); expect(s.variants.march2.R).toBeCloseTo(0.6);
    expect(s.diffs.distSplit).toMatchObject({ comparisons: 2, withDifference: 1, maxDiffPx: 3, pixels: 38400 }); expect(s.diffs.march2).toMatchObject({ comparisons: 1, withDifference: 0, maxDiffPx: 0, pixels: 38400 });
    const L = vb.lines().join('\n'); expect(L).toContain('abl distSplit n=10 ratio 0.80'); expect(L).toContain('diff px distSplit: max 3 of 38400 px · 1 of 2 comparisons had a differing pixel'); expect(L).toContain('diff px march2: max 0 of 38400 px · 0 of 1 comparisons'); expect(L).toContain('diff px march2c4: - (no comparison made');
  });
  it('the report explains the variants', () => {
    const log = createPerfLog({ kind: 'webgpu', now: () => 1000, store: null }); log.vb = createVolBreakdown(); log.row({ menu: 0, fps: 72, rec: 1 }, 1000);
    expect(perfReport(log, {})).toContain('note: distSplit / march2 / march2c4');
  });
});

// ---- the host, driven with a mock device ----
const GPU_GLOBALS = () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
};
const withGpu = fn => async () => { GPU_GLOBALS(); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));
const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
const mockGpu = script => {
  const log = { passes: [], cmds: [], buffers: [], textures: [], writes: [], texWrites: [], shaders: [], pipelines: [], bindGroups: [], layouts: [], pipeLayouts: [], computePasses: [] };
  const device = { features: new Set(['timestamp-query']), limits: {} };
  device.queue = { writeBuffer: (b, off, data) => { log.writes.push({ b, data: new Int32Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0)) }); }, writeTexture: (dst, bytes, layout, size) => log.texWrites.push({ dst, n: bytes.length, layout, size }), submit: () => log.cmds.push('submit') };
  device.createQuerySet = d => ({ d, destroy() {} });
  device.createBuffer = d => { const b = { d, vals: [0n, 0n], destroyed: false, destroy() { b.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => (d.size > 16 ? new Uint32Array(d.size / 4).buffer : new BigUint64Array(b.vals).buffer), unmap() {} }; log.buffers.push(b); return b; };
  device.createTexture = d => { const t = { d, destroyed: false, destroy() { t.destroyed = true; }, createView: () => ({ t }) }; log.textures.push(t); return t; };
  device.createSampler = () => ({}); device.createBindGroupLayout = d => { const l = { d }; log.layouts.push(l); return l; }; device.createPipelineLayout = d => { const l = { d }; log.pipeLayouts.push(l); return l; };
  device.createShaderModule = d => { log.shaders.push(d.code); return { code: d.code }; };
  device.createComputePipeline = d => ({ d, compute: true }); device.createComputePipelineAsync = async d => device.createComputePipeline(d);
  device.createRenderPipeline = d => { const p = { d }; log.pipelines.push(p); return p; }; device.createRenderPipelineAsync = async d => device.createRenderPipeline(d);
  device.createBindGroup = d => { const g = { d }; log.bindGroups.push(g); return g; };
  device.createCommandEncoder = () => ({
    beginRenderPass: d => { const p = { d, pipeline: null, groups: {}, viewports: [], scissors: [], draws: 0 }; log.passes.push(p); log.cmds.push('pass'); return { setPipeline: x => { p.pipeline = x; }, setVertexBuffer() {}, setBindGroup: (i, g) => { p.groups[i] = g; }, setViewport: (...a) => p.viewports.push(a), setScissorRect: (...a) => p.scissors.push(a), draw: () => { p.draws++; }, end() {} }; },
    beginComputePass: d => { const p = { d, pipeline: null, groups: {}, dispatches: [] }; log.computePasses.push(p); log.cmds.push('cpass'); return { setPipeline: x => { p.pipeline = x; }, setBindGroup: (i, g) => { p.groups[i] = g; }, dispatchWorkgroups: (...a) => p.dispatches.push(a), end() {} }; },
    resolveQuerySet() {}, copyBufferToTexture() {}, copyBufferToBuffer: (_s, _o, dst, _d, n) => { if (n === 16 && !(_s.d.usage & 64)) dst.vals = script.shift() ?? [1n, 2n]; log.cmds.push('copyB' + n); }, clearBuffer: () => log.cmds.push('clear'), copyTextureToBuffer() {}, finish: () => ({}),
  });
  return { device, log };
};
const comboU = (side = 4, seed = 1) => { // a session's uniforms that let the low pass use the pre-pass, with a combined texture of side^3 voxels (rgba bytes on the CPU)
  const R = rng(seed), data = new Uint8Array(side ** 3 * 4).map(() => Math.floor(R() * 256)), tex = new THREEG.Data3DTexture(data, side, side, side); tex.format = THREEG.RGBAFormat; tex.type = THREEG.UnsignedByteType; tex.needsUpdate = true;
  return { distInCls: { value: 1 }, useCls: { value: 1 }, diag: { value: 0 }, planeCount: { value: 0 }, clsTex: { value: tex }, halfExt: { value: new THREEG.Vector3(1, 1, 1) }, voxelMin: { value: 0.02 }, clsChan: { value: new THREEG.Vector4(0, 1, -1, -1) },
    segA: { value: [0, 1, 2, 3].map(i => new THREEG.Vector4(0, 0, 1, i < 2 ? 1 : 0)) } };
};
const draw = (r, u, extra = {}) => r.draw({ u, cams: [eyeCam(640, 480), eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false }, ...extra });
const frameOf = (r, u, extra) => { draw(r, u, extra); return r.volume.markFrame(); };
const begin = (r, cb, variant = { cls4: false, events: false }) => r.breakdown.begin(variant, cb);
const scriptN = n => Array.from({ length: n }, (_, i) => [BigInt(1000 + 100 * i), BigInt(5000 + 100 * i)]);

describe('host: the march variants run as shadow passes with a picture comparison', () => {
  it('begin compiles the three march programs (display variants without section planes only) with the group-1 layout; the pipelines are keyed apart from the other variants', withGpu(async () => {
    const { device, log } = mockGpu(scriptN(4));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const res = await begin(r, () => {}); expect(res.failed).toEqual([]);
    const texts = log.shaders.filter(t => /march=/.test(t)); expect(texts.map(t => /march=(\w+)/.exec(t)[1]).sort()).toEqual(['distSplit', 'march2', 'march2c4']);
    const lay = log.pipeLayouts.filter(l => l.d.bindGroupLayouts.length === 2 && l.d.bindGroupLayouts[1].d.entries.some(e => e.binding === 1 && e.texture?.viewDimension === '3d')); expect(lay).toHaveLength(1);
    expect(lay[0].d.bindGroupLayouts[1].d.entries.map(e => e.binding)).toEqual([0, 1]);
    r.breakdown.end();
    const r2 = createVrVolumeRenderer({ THREE: THREEG, device: mockGpu(scriptN(4)).device, halfExt: [1, 1, 1] }); const n = log.shaders.length;
    await begin(r2, () => {}, { cls4: false, events: true }); expect(log.shaders.length).toBe(n); // (r2 has a device of its own: nothing was logged here)
    r.dispose(); r2.dispose();
  }));
  it('a march shadow pass: the program of the variant, group 1 = the grids\' bind group, then the display program with the same group 0 into a second target and a compare compute; delivered as (diff:<name>, count, pixels compared); the timing pair as usual', withGpu(async () => {
    const { device, log } = mockGpu(scriptN(6));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); const u4 = comboU(4); await r.preload(u4, [{ cls4: false, events: false }]); // (the session start: the display's own program is compiled too, the shadow passes' reference)
    const got = []; await begin(r, (...a) => got.push(a));
    const rb = log.buffers.filter(b => b.d.size === 16 && (b.d.usage & 32)).at(-1); rb.vals = [5n, 0n];
    const rec = frameOf(r, u4); const np = log.passes.length, nt = log.textures.length;
    expect(r.breakdown.shadow(rec, BD_SPECS.march2)).toBe(true);
    const [sh, ref] = log.passes.slice(np); expect(sh.d.timestampWrites).toBeTruthy(); expect(ref.d.timestampWrites).toBeUndefined();
    const marchPipe = r.volume.pipeFor ? sh.pipeline : null; expect(marchPipe.d.layout.d.bindGroupLayouts).toHaveLength(2); expect(sh.groups[1]).toBeTruthy(); expect(sh.groups[1].d.entries.map(e => e.binding)).toEqual([0, 1]);
    expect(ref.pipeline).not.toBe(sh.pipeline); expect(ref.pipeline.d.layout.d.bindGroupLayouts).toHaveLength(1); expect(ref.groups[0]).toBe(sh.groups[0]); expect(ref.groups[1]).toBeUndefined();
    expect(ref.viewports).toEqual(sh.viewports); expect(ref.draws).toBe(sh.draws); expect(log.computePasses.length).toBeGreaterThan(0);
    const r8 = log.textures.slice(nt).filter(t => t.d.format === 'r8unorm'); expect(r8.map(t => t.d.size.join('x')).sort()).toEqual(['1x1x1', '1x1x1', '4x4x4']); // the distance texture (4^3) and the two coarse grids (ceil(4 / 8) = ceil(4 / 4) = 1)
    for (const t of r8) { expect(t.d.dimension).toBe('3d'); expect(t.d.usage).toBe(1 | 2); }
    expect(log.texWrites.filter(w => w.n === 64)).toHaveLength(1); // the distance bytes of the 4^3 texture, one byte a texel
    await settle();
    expect(got.filter(x => x[0] === 'diff:march2')).toEqual([['diff:march2', 5, 2 * 320 * 240]]);
    expect(got.find(x => x[0] === 'march2')).toBeTruthy(); expect(got.some(x => x[0] === 'proxyDiff')).toBe(false);
    r.dispose();
  }));
  it('the grids wait for the combined texture (false = not now, a little made per call), are made once, are made again when its bytes were written, and are let go with the recording; no bytes on the CPU or no texture = no program (null)', withGpu(async () => {
    const { device, log } = mockGpu(scriptN(30));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const u = comboU(128, 2); await r.preload(u, [{ cls4: false, events: false }]); await begin(r, () => {});
    // 128^3: 2.1 M texel reads for the distance plane alone, more than one call's budget
    let rec = frameOf(r, u), tries = 0, x; while ((x = r.breakdown.shadow(rec, BD_SPECS.distSplit)) === false && tries < 40) { tries++; rec = frameOf(r, u); await settle(); }
    expect(tries).toBeGreaterThan(1); expect(x).toBe(true);
    const dist = log.textures.filter(t => t.d.format === 'r8unorm' && t.d.size[0] === 128).filter(t => log.texWrites.some(w => w.dst.texture === t)); expect(dist).toHaveLength(1); // (the breakdown's distance texture is written from the CPU in slabs; the display's own is made on the GPU)
    const slabs = log.texWrites.filter(w => w.dst.texture === dist[0]); expect(slabs.reduce((a, w) => a + w.size[2], 0)).toBe(128); expect(slabs.map(w => w.dst.origin[2])).toEqual(slabs.map(w => w.dst.origin[2]).slice().sort((a, b) => a - b));
    const n1 = log.textures.length; rec = frameOf(r, u); expect(r.breakdown.shadow(rec, BD_SPECS.march2)).toBe(true); expect(log.textures.length).toBe(n1); // the same grids serve the next variant
    u.clsTex.value.needsUpdate = true; rec = frameOf(r, u); // the bytes are written again (a slab upload / a new version): the grids are made again
    let y = r.breakdown.shadow(rec, BD_SPECS.march2); expect(y).toBe(false); expect(dist[0].destroyed).toBe(true);
    for (let i = 0; i < 40 && y === false; i++) { rec = frameOf(r, u); y = r.breakdown.shadow(rec, BD_SPECS.march2); await settle(); } expect(y).toBe(true);
    const u2 = comboU(4); u2.clsTex.value.image.data = null; rec = frameOf(r, u2); expect(r.breakdown.shadow(rec, BD_SPECS.march2)).toBeNull();
    const u3 = comboU(4); u3.clsTex.value = null; rec = frameOf(r, u3, {}); expect(r.breakdown.shadow(rec, BD_SPECS.distSplit)).toBeNull();
    const alive = () => log.textures.filter(t => t.d.format === 'r8unorm' && t.d.size[0] > 1 && !t.destroyed && log.texWrites.some(w => w.dst.texture === t)).length; // (the breakdown's grids; the display's own distance texture stays) expect(alive()).toBeGreaterThan(0);
    r.breakdown.end(); expect(alive()).toBe(0);
    r.dispose();
  }));
});
