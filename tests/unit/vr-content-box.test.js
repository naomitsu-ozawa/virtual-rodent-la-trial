import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { contentBox, brickShown, growByBricks, segsFromUniforms, contentKeyChanged, KEY_LEN, BRICK, sliceIndex, sliceRange, boxFromRange, createSegScan, segScanStart, segScanStep, segsSubset } from '../../docs/vr-content-box.js';
import { brickOccupancy, writeBrickOccupancy } from '../../docs/vr-brick-occupancy.js';
import { eyeMetrics, capFromPpv } from '../../docs/vr-render-scale.js';

// the app's computeBricks (vr-view.js): per 8^3 brick the HU min / max with one voxel of overlap; 4 floats per brick (min, max, occupancy, 0)
function bricksOf(hu, [w, h, d]) {
  const bx = Math.ceil(w / BRICK), by = Math.ceil(h / BRICK), bz = Math.ceil(d / BRICK), mm = new Float32Array(bx * by * bz * 4);
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let z = Math.max(0, k * BRICK - 1); z < Math.min(d, (k + 1) * BRICK + 1); z++) for (let y = Math.max(0, j * BRICK - 1); y < Math.min(h, (j + 1) * BRICK + 1); y++) for (let x = Math.max(0, i * BRICK - 1); x < Math.min(w, (i + 1) * BRICK + 1); x++) { const v = hu[(z * h + y) * w + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const o = ((k * by + j) * bx + i) * 4; mm[o] = lo; mm[o + 1] = hi;
  }
  return { bricks: mm, brickDims: [bx, by, bz], dims: [w, h, d] };
}
// trilinear HU at a texture coordinate (the shader's linear filter, clamp to edge)
function trilinear(hu, [w, h, d], tc) {
  const u = [tc[0] * w - 0.5, tc[1] * h - 0.5, tc[2] * d - 0.5], n = [w, h, d], i0 = [], f = [];
  for (let a = 0; a < 3; a++) { const fl = Math.floor(u[a]); f[a] = u[a] - fl; i0[a] = fl; }
  const at = (x, y, z) => hu[(Math.min(d - 1, Math.max(0, z)) * h + Math.min(h - 1, Math.max(0, y))) * w + Math.min(w - 1, Math.max(0, x))];
  let v = 0;
  for (let c = 0; c < 8; c++) { const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1; v += at(i0[0] + dx, i0[1] + dy, i0[2] + dz) * (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]); }
  void n; return v;
}
// object-space point of a texture coordinate (shader texCoord inverted: y runs down)
const objOf = (tc, he) => [(tc[0] - 0.5) * 2 * he[0], (0.5 - tc[1]) * 2 * he[1], (tc[2] - 0.5) * 2 * he[2]];
const inBox = (p, b, eps = 1e-9) => [0, 1, 2].every(a => p[a] >= b.c[a] - b.h[a] - eps && p[a] <= b.c[a] + b.h[a] + eps);
// deterministic pseudo-random
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const SEG = (min, max, on = true, maskOnly = false, maskAny = false) => ({ min, max, on, maskOnly, maskAny });
const OFF = SEG(0, 0, false);

// a 52 x 44 x 42 phantom (dims not multiples of 8 on purpose): air -1000, a soft ball (40 HU) off centre, a bone rod (900) inside it,
// and an isolated -600 speck far from both (a "lung" voxel)
function phantom() {
  const dims = [52, 44, 42], [w, h, d] = dims, hu = new Float32Array(w * h * d).fill(-1000);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (z * h + y) * w + x, r = Math.hypot(x - 18, y - 17, z - 16);
    if (r < 7) hu[i] = 40; if (Math.hypot(x - 18, z - 16) < 2 && Math.abs(y - 17) < 5) hu[i] = 900;
  }
  hu[(36 * h + 38) * w + 47] = -600;
  return { hu, dims };
}
const HE = [1.65, 1.3, 1.0];

describe('brickShown = the shader brickClass(tc) > 0', () => {
  it('a range segment is a candidate when its range meets the brick min..max; a mask-only one by its occupancy bit only; a hidden one never', () => {
    const segs = [SEG(300, 3000), SEG(-200, 299), OFF, SEG(-100, 100, true, true)];
    expect(brickShown(segs, -1000, -900, 0)).toBe(false);
    expect(brickShown(segs, -1000, 350, 0)).toBe(true); // bone range reached
    expect(brickShown(segs, -250, -210, 0)).toBe(false); expect(brickShown(segs, -250, -200, 0)).toBe(true); // inclusive ends, as the shader (a.y >= mm.x && a.x <= mm.y)
    expect(brickShown([OFF, OFF, OFF, SEG(-100, 100, true, true)], -50, 50, 0)).toBe(false); // mask-only: the HU range says nothing
    expect(brickShown([OFF, OFF, OFF, SEG(-100, 100, true, true)], -1000, -1000, 8)).toBe(true); // bit 3 set
    expect(brickShown([SEG(300, 3000, false), OFF, OFF, OFF], 0, 3000, 15)).toBe(false);
  });
});

describe('contentBox', () => {
  const { hu, dims } = phantom(), grid = bricksOf(hu, dims);
  it('holds every point the shader can draw: brute force over random points, range and trilinear test (soft ball + bone rod)', () => {
    for (const segs of [[SEG(300, 3000), SEG(-200, 299), OFF, OFF], [SEG(300, 3000), OFF, OFF, OFF], [OFF, OFF, SEG(-800, -300), OFF]]) {
      const b = contentBox({ halfExt: HE, grid, segs });
      expect(b.full).toBe(false); expect(b.empty).toBe(false);
      const r = rng(7); let drawn = 0;
      for (let k = 0; k < 200000; k++) {
        const tc = [r(), r(), r()], v = trilinear(hu, dims, tc);
        if (!segs.some(g => g.on && v >= g.min && v <= g.max)) continue;
        drawn++; expect(inBox(objOf(tc, HE), b)).toBe(true);
      }
      expect(drawn).toBeGreaterThan(20);
    }
  });
  it('is much smaller than the data box for a small object, and the bone-only box lies inside the soft one', () => {
    const soft = contentBox({ halfExt: HE, grid, segs: [SEG(300, 3000), SEG(-200, 299), OFF, OFF] }), bone = contentBox({ halfExt: HE, grid, segs: [SEG(300, 3000), OFF, OFF, OFF] });
    for (let a = 0; a < 3; a++) { expect(soft.h[a]).toBeLessThan(HE[a]); expect(bone.h[a]).toBeLessThanOrEqual(soft.h[a] + 1e-12); expect(bone.c[a] - bone.h[a]).toBeGreaterThanOrEqual(soft.c[a] - soft.h[a] - 1e-12); }
    expect(bone.h[0] * bone.h[1] * bone.h[2]).toBeLessThan(0.25 * HE[0] * HE[1] * HE[2]);
  });
  it('texture y runs down: content near texture y = 0 is at the top of the object box (+y)', () => {
    const dd = [16, 16, 16], v = new Float32Array(16 ** 3).fill(-1000); for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) v[(z * 16 + 1) * 16 + x] = 500; // a sheet at voxel row y = 1
    const b = contentBox({ halfExt: [1, 1, 1], grid: bricksOf(v, dd), segs: [SEG(300, 3000), OFF, OFF, OFF] });
    expect(b.c[1]).toBeGreaterThan(0); expect(b.c[1] + b.h[1]).toBeCloseTo(1, 12);
  });
  it('the CT slices count only while they are drawn, from the slice grid with HU above sliceAir', () => {
    const segs = [SEG(300, 3000), OFF, OFF, OFF], bone = contentBox({ halfExt: HE, grid, segs });
    const withSlice = contentBox({ halfExt: HE, grid, segs, slices: true, sliceGrid: grid, sliceAir: -500 });
    expect(withSlice.sliceBricks).toBeGreaterThan(0);
    for (let a = 0; a < 3; a++) expect(withSlice.h[a]).toBeGreaterThanOrEqual(bone.h[a]); // the soft ball (40 HU) widens it (the -600 speck does not: -600 <= -500)
    expect(withSlice.h[0] * withSlice.h[1] * withSlice.h[2]).toBeGreaterThan(bone.h[0] * bone.h[1] * bone.h[2]);
    // every point where the slice is visible (trilinear HU > sliceAir) is inside, also the soft tissue that no shown segment covers
    const r = rng(11); let n = 0;
    for (let k = 0; k < 100000; k++) { const tc = [r(), r(), r()]; if (trilinear(hu, dims, tc) > -500) { n++; expect(inBox(objOf(tc, HE), withSlice)).toBe(true); } }
    expect(n).toBeGreaterThan(50);
    const lowAir = contentBox({ halfExt: HE, grid, segs, slices: true, sliceGrid: grid, sliceAir: -700 }); // the -600 speck now shows on a slice
    expect(lowAir.c[0] + lowAir.h[0]).toBeGreaterThan(withSlice.c[0] + withSlice.h[0]);
    const r2 = rng(5); for (let k = 0; k < 100000; k++) { const tc = [r2(), r2(), r2()]; if (trilinear(hu, dims, tc) > -700) expect(inBox(objOf(tc, HE), lowAir)).toBe(true); }
    expect(contentBox({ halfExt: HE, grid, segs, slices: false, sliceGrid: grid, sliceAir: -700 })).toEqual(bone); // no slices: unchanged
  });
  it('the slices use the slice grid (full resolution): a voxel above sliceAir that the half-size grid averages away still counts', () => {
    const fd = [32, 32, 32], full = new Float32Array(32 ** 3).fill(-1000); full[(30 * 32 + 2) * 32 + 30] = 400; // one voxel: averaged over 2^3 it is -825
    const half = new Float32Array(16 ** 3).fill(-1000); half[(15 * 16 + 1) * 16 + 15] = -825;
    const b = contentBox({ halfExt: [1, 1, 1], grid: bricksOf(half, [16, 16, 16]), segs: [OFF, OFF, OFF, OFF], slices: true, sliceGrid: bricksOf(full, fd), sliceAir: -500 });
    expect(b.empty).toBe(false); expect(inBox(objOf([(30.5) / 32, 2.5 / 32, 30.5 / 32], [1, 1, 1]), b)).toBe(true);
  });
  it('clipping planes and cut faces need nothing more: a cap is painted only where a segment is (inside the segment box); a plane only removes', () => {
    // the cap test is the segment test at the plane crossing: any point that passes it passed the brute-force test above. Here: points ON a plane
    // (the cut face) that classify as bone lie inside the bone box, for random planes
    const segs = [SEG(300, 3000), OFF, OFF, OFF], b = contentBox({ halfExt: HE, grid, segs }), r = rng(3); let n = 0;
    for (let k = 0; k < 400; k++) {
      const nrm = [r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...nrm), c = [r(), r(), r()];
      for (let j = 0; j < 400; j++) { // points of the plane through c
        const s = r() - 0.5, t = r() - 0.5, e1 = [nrm[1], -nrm[0], 0], e2 = [nrm[0] * nrm[2], nrm[1] * nrm[2], -(nrm[0] ** 2 + nrm[1] ** 2)];
        const tc = c.map((v, a) => v + s * e1[a] / l + t * e2[a] / (l * l)); if (tc.some(v => v < 0 || v > 1)) continue;
        if (trilinear(hu, dims, tc) >= 300) { n++; expect(inBox(objOf(tc, HE), b)).toBe(true); }
      }
    }
    expect(n).toBeGreaterThan(10);
  });
  it('mask-only segments: the occupancy bits decide (vr-brick-occupancy.js), conservative for the trilinear edit mask', () => {
    const [w, h, d] = dims, edit = new Uint8Array(w * h * d * 4); edit[((5 * h + 25) * w + 33) * 4] = 255; // one mask voxel of segment 0, in air
    const g = bricksOf(hu, dims), occ = brickOccupancy({ data: edit, dims, maskOnly: 1 }, g.brickDims); writeBrickOccupancy(g.bricks, occ);
    const b = contentBox({ halfExt: HE, grid: g, segs: [SEG(300, 3000, true, true), OFF, OFF, OFF] });
    expect(inBox(objOf([33.5 / w, 25.5 / h, 5.5 / d], HE), b)).toBe(true); expect(inBox(objOf([18.5 / w, 17.5 / h, 16.5 / d], HE), b)).toBe(false); // the mask voxel, not the bone rod
  });
  it('full when the content reaches every face, empty when nothing can be drawn, the full box on missing data (fail-safe)', () => {
    const v = new Float32Array(16 ** 3).fill(40), g = bricksOf(v, [16, 16, 16]);
    expect(contentBox({ halfExt: HE, grid: g, segs: [OFF, SEG(-200, 299), OFF, OFF] })).toMatchObject({ full: true, c: [0, 0, 0], h: HE });
    expect(contentBox({ halfExt: HE, grid: g, segs: [SEG(300, 3000), OFF, OFF, OFF] })).toMatchObject({ empty: true });
    expect(contentBox({ halfExt: HE, grid: null, segs: [] }).full).toBe(true);
    expect(contentBox({ halfExt: HE, grid: { bricks: new Float32Array(4), brickDims: [2, 2, 2], dims: [16, 16, 16] }, segs: [SEG(0, 1), OFF, OFF, OFF] }).full).toBe(true); // short brick array
  });
  it('growByBricks: a brick contributes its voxel range plus two voxels and its normalised cell', () => {
    const lo = new Float64Array([Infinity, Infinity, Infinity]), hi = new Float64Array([-Infinity, -Infinity, -Infinity]), bricks = new Float32Array(3 * 2 * 2 * 4);
    bricks[(0 * 3 + 1) * 4 + 1] = 1; // brick (1, 0, 0) of a 20 x 16 x 16 grid (3 x 2 x 2 bricks): max 1
    expect(growByBricks(bricks, [3, 2, 2], [20, 16, 16], (mn, mx) => mx > 0, lo, hi)).toBe(1);
    expect(lo[0]).toBeCloseTo(Math.min(6.5 / 20, 1 / 3), 12); expect(hi[0]).toBeCloseTo(Math.max(17.5 / 20, 2 / 3), 12); expect(lo[1]).toBeCloseTo(-1.5 / 16, 12);
  });
});

describe('segsFromUniforms / contentKeyChanged', () => {
  const V = (x, y, z, w) => ({ x, y, z, w });
  it('reads segA (min, max, opacity, shown) and the editMaskOnly bits', () => {
    expect(segsFromUniforms([V(300, 3000, 1, 1), V(-200, 299, 1, 0), V(0, 0, 0, 0), V(-100, 100, 1, 1)], 8)).toEqual([SEG(300, 3000), SEG(-200, 299, false), SEG(0, 0, false), SEG(-100, 100, true, true)]);
  });
  it('reads the data mask-only bits as maskAny when the shader bit is off (editDiag 2 with the classification)', () => {
    const out = segsFromUniforms([V(300, 3000, 1, 1), V(-200, 299, 1, 1), V(0, 0, 0, 0), V(0, 0, 0, 0)], 0, undefined, 1);
    expect(out[0]).toEqual(SEG(300, 3000, true, false, true)); expect(out[1].maskAny).toBe(false);
    expect(segsFromUniforms([V(300, 3000, 1, 1), V(0, 0, 0, 0), V(0, 0, 0, 0), V(0, 0, 0, 0)], 1, undefined, 1)[0]).toEqual(SEG(300, 3000, true, true, false));
  });
  it('changes on a shown segment, a range, the mask flags and the grid; not on a hidden segment\'s range', () => {
    const k = new Float64Array(KEY_LEN).fill(NaN), segs = [SEG(300, 3000), SEG(-200, 299, false), OFF, OFF];
    expect(contentKeyChanged(k, segs, [256, 256, 256])).toBe(true); expect(contentKeyChanged(k, segs, [256, 256, 256])).toBe(false);
    expect(contentKeyChanged(k, [SEG(300, 3000), SEG(-100, 299, false), OFF, OFF], [256, 256, 256])).toBe(false); // a hidden one's range
    expect(contentKeyChanged(k, [SEG(300, 3000), SEG(-100, 299), OFF, OFF], [256, 256, 256])).toBe(true);
    expect(contentKeyChanged(k, [SEG(300, 3000), SEG(-100, 299), OFF, OFF], [512, 512, 512])).toBe(true);
    expect(contentKeyChanged(k, [SEG(300, 3000, true, false, true), SEG(-100, 299), OFF, OFF], [512, 512, 512])).toBe(true); // maskAny
    expect(contentKeyChanged(k, [SEG(300, 3000, true, true), SEG(-100, 299), OFF, OFF], [512, 512, 512])).toBe(true); // maskOnly
  });
});

describe('the rebuild never blocks a frame', () => {
  const src = readFileSync(new URL('../../docs/vr-content-box.js', import.meta.url), 'utf8');
  const body = name => { const i = src.indexOf('export function ' + name + '('); return src.slice(i, src.indexOf('\n}\n', i)); };
  function randomGrid(seed, dims) {
    const r = rng(seed), [w, h, d] = dims, hu = new Float32Array(w * h * d).fill(-1000);
    for (let n = 0; n < 6; n++) { const c = [r() * w, r() * h, r() * d], rad = 1 + r() * 5, v = -900 + r() * 2500; for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - c[0], y - c[1], z - c[2]) < rad) hu[(z * h + y) * w + x] = v; }
    return bricksOf(hu, dims);
  }
  it('sliceRange (slab maxima, O(slabs)) gives exactly the brick-by-brick range of max > sliceAir', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = randomGrid(seed, [36 + seed, 30, 27 + 2 * seed]), idx = sliceIndex(g);
      expect(sliceIndex(g)).toBe(idx); // cached per grid
      for (const air of [-950, -500, -200, 0, 400, 1500, 5000]) {
        const lo = new Float64Array(3).fill(Infinity), hi = new Float64Array(3).fill(-Infinity), lo2 = new Float64Array(3).fill(Infinity), hi2 = new Float64Array(3).fill(-Infinity);
        const nBrute = growByBricks(g.bricks, g.brickDims, g.dims, (mn, mx) => mx > air, lo, hi), n = sliceRange(idx, air, lo2, hi2);
        expect(n === 0).toBe(nBrute === 0); expect(n).toBeGreaterThanOrEqual(nBrute);
        if (nBrute) for (let a = 0; a < 3; a++) { expect(lo2[a]).toBe(lo[a]); expect(hi2[a]).toBe(hi[a]); }
      }
    }
  });
  it('the resumable scan gives exactly the one-shot result, one chunk per frame when the budget is spent', () => {
    const g = randomGrid(7, [70, 61, 53]), segs = [SEG(300, 3000), SEG(-200, 299), OFF, OFF], n = g.brickDims[0] * g.brickDims[1] * g.brickDims[2];
    const lo = new Float64Array(3).fill(Infinity), hi = new Float64Array(3).fill(-Infinity), count = growByBricks(g.bricks, g.brickDims, g.dims, (a, b, c) => brickShown(segs, a, b, c), lo, hi);
    for (const chunk of [1, 7, 64, 1000, 1e6]) {
      let t = 0; const now = () => (t += 10), sc = segScanStart(createSegScan(), g, segs); let frames = 0;
      while (!segScanStep(sc, 1, chunk, now)) frames++;
      expect(frames + 1).toBe(Math.ceil(n / chunk)); expect(sc.frames).toBe(frames + 1);
      expect(sc.count).toBe(count); expect([...sc.lo]).toEqual([...lo]); expect([...sc.hi]).toEqual([...hi]);
    }
    const sc = segScanStart(createSegScan(), g, segs); segs[0].on = false; while (!segScanStep(sc)); expect(sc.count).toBe(count); // the scan keeps its own copy
  });
  it('segsSubset: the old box still covers the new segments only when a segment was hidden or a range narrowed', () => {
    const old = [SEG(300, 3000), SEG(-200, 299), OFF, SEG(0, 0, true, true)];
    expect(segsSubset([SEG(300, 3000), OFF, OFF, OFF], old)).toBe(true);
    expect(segsSubset([SEG(400, 2000), SEG(-100, 299), OFF, SEG(5, 6, true, true)], old)).toBe(true);
    expect(segsSubset([SEG(200, 3000), SEG(-200, 299), OFF, OFF], old)).toBe(false); // widened
    expect(segsSubset([SEG(300, 3000), SEG(-200, 299), SEG(0, 1), OFF], old)).toBe(false); // newly shown
    expect(segsSubset([SEG(300, 3000, true, false, true), OFF, OFF, OFF], old)).toBe(false); // mask flags changed
    expect(segsSubset([SEG(300, 3000), OFF, OFF, OFF], [SEG(300, 3000, false), OFF, OFF, OFF])).toBe(false);
  });
  it('maskAny: a brick counts by its HU range or its occupancy bit (the classification may still hold the mask)', () => {
    expect(brickShown([SEG(300, 3000, true, false, true)], -1000, -900, 1)).toBe(true);
    expect(brickShown([SEG(300, 3000, true, false, false)], -1000, -900, 1)).toBe(false);
    expect(brickShown([SEG(300, 3000, true, false, true)], 500, 900, 0)).toBe(true);
    expect(brickShown([SEG(300, 3000, true, true, false)], 500, 900, 0)).toBe(false);
  });
  it('boxFromRange matches contentBox and writes into the given object', () => {
    const g = randomGrid(3, [40, 40, 40]), segs = [SEG(300, 3000), OFF, OFF, OFF], ref = contentBox({ halfExt: [1, 0.8, 1.2], grid: g, segs });
    const lo = new Float64Array(3).fill(Infinity), hi = new Float64Array(3).fill(-Infinity); growByBricks(g.bricks, g.brickDims, g.dims, (a, b, c) => brickShown(segs, a, b, c), lo, hi);
    const out = { c: [0, 0, 0], h: [0, 0, 0] }; expect(boxFromRange([1, 0.8, 1.2], lo, hi, out)).toBe(out);
    expect(out.c).toEqual(ref.c); expect(out.h).toEqual(ref.h); expect(out.full).toBe(ref.full); expect(out.empty).toBe(ref.empty);
    expect(boxFromRange([1, 1, 1], new Float64Array(3).fill(Infinity), new Float64Array(3).fill(-Infinity)).empty).toBe(true);
  });
  it('no allocation in the per-frame key compare or per brick of a scan (no closure, no array literal)', () => {
    expect(body('contentKeyChanged')).not.toMatch(/=>|\[[^\]]*,[^\]]*\]|new /);
    expect(body('growByBricks')).not.toMatch(/\[i, j, k\]|=>|new /); expect(body('segScanStep')).not.toMatch(/\[[a-z]+, [a-z]+\]|new /);
  });
  it('vr-view: the frame only steps the scan (no synchronous contentBox), the slice part from the slab index, the rebuild time in the self-check info', () => {
    const v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8'), i0 = v.indexOf('refreshContentBox=()=>{\n'), f = v.slice(i0, v.indexOf('disposeEdits=()=>{', i0));
    expect(f).not.toMatch(/contentBox\(/); expect(f).toMatch(/segScanStep\(cbScan\)/); expect(f).toMatch(/sliceRange\(cbSliceIdx,air,/);
    expect(f).toMatch(/if\(cbSegOk&&!segsSubset\(segs,cbShownSegs\)\)cbSegOk=false/); // the old box stays only while it covers the new segments
    expect(f).toMatch(/if\(off\|\|!cbSegOk\|\|\(sl&&!cbSliceIdx\)\)\{u\.boxC\.value\.set\(0,0,0\);u\.boxH\.value\.set\(0,0,0\);return\}/); // else the full box
    expect(f).toMatch(/editActive\?\(P\.edit\.maskOnly\|0\):0/);
    expect(v).toMatch(/cbSliceIdx=sliceIndex\(vd\)/); expect(v).toMatch(/boxMs:cbStat\.frames\?cbStat\.ms:null/);
  });
});

describe('render-scale cap on the content box', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], model = (s, x, y, z) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1];
  const persp = (n = 0.05, f = 100) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0]; // 90 deg
  const HALF = [1, 1, 1], DIMS = [256, 256, 256];
  it('the full box as the content box gives exactly the old numbers', () => {
    const m = model(0.15, 0.02, -0.01, -0.3), a = eyeMetrics(m, HALF, DIMS, I, persp(), 1000, 1000, {}), b = eyeMetrics(m, HALF, DIMS, I, persp(), 1000, 1000, {}, { c: [0, 0, 0], h: HALF });
    expect(b).toEqual(a);
  });
  it('the far corner comes from the content box: close up, the empty air behind the body no longer holds the cap up', () => {
    const m = model(0.15, 0, 0, -0.3), full = eyeMetrics(m, HALF, DIMS, I, persp(), 1000, 1000, {}), body = { c: [0, 0, 0.1], h: [0.6, 0.5, 0.7] };
    const cb = eyeMetrics(m, HALF, DIMS, I, persp(), 1000, 1000, {}, body);
    expect(cb.depthFar).toBeLessThan(full.depthFar); expect(cb.ppvFar).toBeGreaterThan(full.ppvFar); // the farthest content corner is nearer
    expect(cb.cover).toBeLessThan(full.cover);
    expect(cb.depthCenter).toBeCloseTo(0.3 - 0.1 * 0.15, 12); // the content centre (object z +0.1 is towards the eye)
    expect(capFromPpv(cb.ppvCenter, cb.ppvFar)).toBeLessThanOrEqual(capFromPpv(full.ppvCenter, full.ppvFar) + 1e-12);
    expect(cb.ppvCenter * 1).toBeGreaterThan(0); // voxel size still from the grid: one voxel = 2 * 0.15 / 256 world units
    const voxel = 2 * 0.15 / 256, focal = 500; expect(cb.ppvFar).toBeCloseTo(focal * voxel / cb.depthFar, 9);
  });
});

describe('vr-view.js wiring (static)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('the proxy geometry stays the full box; a ray missing the content box is discarded and the march ends at its exit (entry unchanged)', () => {
    expect(src).toMatch(/vPos=position\*halfExt;/); expect(src).toMatch(/meshObj=new THREE\.Mesh\(new THREE\.BoxGeometry\(2,2,2\),st\.base\)/);
    expect(src).toMatch(/if\(boxH\.x>0\.0\)\{vec2 cb=hitContent\(o,dir\);if\(cb\.x>cb\.y\|\|cb\.y<0\.0\)discard;endT=min\(endT,cb\.y\);if\(boxEntry==1\)t=max\(t,cb\.x\);\}/);
    expect(src).toMatch(/boxEntry:\{value:0\}/); // the app never starts the march at the content box
  });
  it('the box is refreshed with the per-frame uniforms (only rebuilt on a change), follows the grid, and the cap reads it', () => {
    expect(src).toMatch(/comboTick\(\);refreshCombo\(\);\n(?:[^\n]*\n){1,9}?[^\n]*vis=comboShaderMask\(\)[^\n]*\n(?:[^\n]*\n){5}   refreshContentBox\(\);/); // after the shader's segA of the frame is set expect(src).toMatch(/cbGrid=i===1&&P\.half\?P\.half:vd;cbKey\.fill\(NaN\);cbSegOk=false/);
    expect(src).toMatch(/contentKeyChanged\(cbKey,segs,cbGrid\.dims\)/);
    expect(src).toMatch(/eyeMetrics\([^;]*,rsEye,rsBox\)/);
  });
});
