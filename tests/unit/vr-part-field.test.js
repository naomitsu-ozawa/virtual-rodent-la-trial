import { describe, it, expect } from 'vitest';
import { PART_FIELD, partFieldBox, partFieldCodes, partFieldOf, partFieldPlain, partFieldBoxOf, partBoundsOf, runPartField, partFieldUnion, partFieldSet, PART_SEAM_TIE, partFieldJointGroups, partFieldNearOf, partFieldDilate, partGroupFieldsOf, partGroupPlain, runPartGroup, partFieldSelOf, partFieldMap, partAirOf, markCutRegionLut, markCutChildLut, PART_CUT_REGION_BIT, PART_CUT_CHILD_BIT } from '../../docs/vr-part-view.js';
import { regionLutAlpha, regionLutHiddenSlots } from '../../docs/region-visibility.js';
import { makeMask } from '../helpers/voxel-mesh.js';

const tri = (f, w, h, d, x, y, z) => {
  const u = x - 0.5, v = y - 0.5, s = z - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), z0 = Math.floor(s), fx = u - x0, fy = v - y0, fz = s - z0;
  const at = (i, j, k) => f[Math.min(w - 1, Math.max(0, i)) + w * (Math.min(h - 1, Math.max(0, j)) + h * Math.min(d - 1, Math.max(0, k)))] / 255;
  let r = 0; for (let c = 0; c < 8; c++) { const a = c & 1, b = (c >> 1) & 1, e = (c >> 2) & 1; r += (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (e ? fz : 1 - fz) * at(x0 + a, y0 + b, z0 + e); } return r;
};
const fieldOfMask = (m, w, h, d) => partFieldOf(Uint8Array.from(m), [w, h, d], PART_FIELD);

describe('partFieldOf: the smoothed cut', () => {
  it('keeps every voxel centre on its side of 0.5 (the LINEAR read at a centre is the voxel itself)', () => {
    const N = 20, m = makeMask(N, N, N, (x, y, z) => (x - 10) ** 2 + (y - 9) ** 2 + ((z - 10) * 1.4) ** 2 < 40 || (Math.floor(x) === 3 && z > 4 && z < 15)), f = fieldOfMask(m, N, N, N);
    for (let i = 0; i < m.length; i++) expect(m[i] ? f[i] >= 128 : f[i] <= 127).toBe(true);
  });
  it('turns the terraces of a 15 degree slope into the slope (peak-to-peak of the 0.5 level well below the 1 voxel step)', () => {
    const W = 64, H = 12, D = 40, z0 = 8, sl = Math.tan(15 * Math.PI / 180), nl = Math.hypot(sl, 1), m = makeMask(W, H, D, (x, y, z) => z < z0 + sl * x), f = fieldOfMask(m, W, H, D);
    let lo = Infinity, hi = -Infinity;
    for (let x = 12; x <= W - 12; x += 0.25) {
      let a = 0, b = D; for (let k = 0; k < 40; k++) { const md = (a + b) / 2; if (tri(f, W, H, D, x, 6, md) >= 0.5) a = md; else b = md; }
      const dev = ((a - z0) - sl * x) / nl; lo = Math.min(lo, dev); hi = Math.max(hi, dev);
    }
    expect(hi - lo).toBeLessThan(0.35); // nearest (today): 1.14; the mesh at strength 6: 0.17
  });
  it('keeps a 1-voxel plate and rod (the half-voxel rule: no shrink of thin structures)', () => {
    { const W = 24, H = 9, D = 24, m = makeMask(W, H, D, (x, y, z) => Math.floor(y) === 4 && x > 3 && x < W - 3 && z > 3 && z < D - 3), f = fieldOfMask(m, W, H, D);
      let a = null, b = null; for (let y = 0.5; y < H - 0.5; y += 0.002) if (tri(f, W, H, D, 12, y, 12) >= 0.5) { if (a === null) a = y; b = y; }
      expect(b - a).toBeGreaterThan(0.95); }
    { const W = 9, H = 9, D = 24, m = makeMask(W, H, D, (x, y, z) => Math.floor(x) === 4 && Math.floor(y) === 4 && z > 3 && z < D - 3), f = fieldOfMask(m, W, H, D);
      let a = null, b = null; for (let x = 0.5; x < W - 0.5; x += 0.002) if (tri(f, W, H, D, x, 4.5, 12) >= 0.5) { if (a === null) a = x; b = x; }
      expect(b - a).toBeGreaterThan(0.95); }
  });
  it('makes a voxel sphere round: the field normal at the 0.5 level within a few degrees of the radius', () => {
    const N = 24, c = 12, m = makeMask(N, N, N, (x, y, z) => (x - c) ** 2 + (y - c) ** 2 + (z - c) ** 2 < 64), f = fieldOfMask(m, N, N, N), angs = [];
    for (let k = 0; k < 400; k++) {
      const th = Math.acos(1 - 2 * ((k + 0.5) / 400)), ph = k * 2.399963, dir = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      let a = 0, b = 11; for (let t = 0; t < 30; t++) { const md = (a + b) / 2; if (tri(f, N, N, N, c + dir[0] * md, c + dir[1] * md, c + dir[2] * md) >= 0.5) a = md; else b = md; }
      const p = dir.map(v => c + v * a), g = [0, 1, 2].map(ax => { const e = [0, 0, 0]; e[ax] = 1; return tri(f, N, N, N, p[0] - e[0], p[1] - e[1], p[2] - e[2]) - tri(f, N, N, N, p[0] + e[0], p[1] + e[1], p[2] + e[2]); });
      angs.push(Math.acos(Math.min(1, (g[0] * dir[0] + g[1] * dir[1] + g[2] * dir[2]) / Math.hypot(...g))) * 180 / Math.PI);
    }
    expect(angs.reduce((s, v) => s + v, 0) / angs.length).toBeLessThan(6); // nearest 0 / 1 (hideGrad today): 23 deg; the mesh at strength 6: 4.7 deg
  });
  it('takes the air skin beside the part (code 2 next to the part) and nothing else', () => {
    const w = 7, h = 3, d = 3, codes = new Uint8Array(w * h * d).fill(2); codes[3 + w * (1 + h * 1)] = 1; codes[0 + w * (1 + h * 1)] = 0;
    const f = partFieldOf(codes, [w, h, d], PART_FIELD), at = (x, y, z) => f[x + w * (y + h * z)];
    expect(at(3, 1, 1)).toBeGreaterThanOrEqual(128); expect(at(2, 0, 0)).toBeGreaterThanOrEqual(128); expect(at(4, 2, 2)).toBeGreaterThanOrEqual(128); // the 26 neighbours
    expect(at(1, 1, 1)).toBeLessThanOrEqual(127); expect(at(5, 1, 1)).toBeLessThanOrEqual(127); expect(at(0, 1, 1)).toBeLessThanOrEqual(127);
  });
  it('the unsmoothed fallback (partFieldPlain) has the same inside / outside per voxel as the field', () => {
    const w = 9, h = 7, d = 6, codes = new Uint8Array(w * h * d);
    for (let i = 0; i < codes.length; i++) codes[i] = (i * 37 + (i >> 3)) % 5 === 0 ? 1 : (i % 3 === 0 ? 2 : 0);
    const f = partFieldOf(codes, [w, h, d], PART_FIELD), p = partFieldPlain(codes, [w, h, d]);
    for (let i = 0; i < codes.length; i++) expect(p[i] === 255).toBe(f[i] >= 128);
    expect(new Set(p)).toEqual(new Set([0, 255]));
  });
});

describe('the box, the codes, the worker, the union', () => {
  const dims = [10, 8, 6], ids = new Uint8Array(480);
  for (let z = 2; z < 4; z++) for (let y = 3; y < 5; y++) for (let x = 4; x < 7; x++) ids[x + 10 * (y + 8 * z)] = 3;
  ids[0] = 5;
  it('partFieldBox: the bounding box grown by pad, clamped', () => {
    expect(partFieldBox(ids, dims, 3, 2)).toEqual({ lo: [2, 1, 0], size: [7, 6, 6] });
    expect(partFieldBox(ids, dims, 9, 2)).toBe(null);
  });
  it('partFieldCodes: 1 = the part, 2 = hide index 0 and air, 0 = another item or tissue', () => {
    const box = { lo: [0, 0, 0], size: dims }, c = partFieldCodes(ids, dims, 3, box, (x, y, z) => x !== 9);
    expect(c[4 + 10 * (3 + 8 * 2)]).toBe(1); expect(c[0]).toBe(0); expect(c[1]).toBe(2); expect(c[9]).toBe(0);
    expect(partFieldCodes(ids, dims, 3, box, null)[1]).toBe(0);
  });
  it('runPartField without a Worker gives the same bytes as partFieldOf', async () => {
    const box = partFieldBox(ids, dims, 3), c = partFieldCodes(ids, dims, 3, box, () => true);
    expect(Array.from(await runPartField(c, box.size))).toEqual(Array.from(partFieldOf(c, box.size, PART_FIELD)));
  });
  it('partFieldBoxOf: the same box from the voxel range partBoundsOf found (no second scan)', () => {
    const b = partBoundsOf(ids, dims, 3, [1, 1, 1], 2);
    expect(b.vox).toEqual({ lo: [4, 3, 2], hi: [6, 4, 3] });
    expect(partFieldBoxOf(b.vox, dims)).toEqual(partFieldBox(ids, dims, 3));
  });
  it('runPartField: a worker that never answers, or fails, settles the promise (rejected) and is terminated', async () => {
    const W0 = globalThis.Worker, made = [];
    class Silent { constructor() { this.terminated = false; made.push(this); } postMessage() {} terminate() { this.terminated = true; } }
    class Broken extends Silent { postMessage() { setTimeout(() => this.onerror({ message: 'out of memory', preventDefault() {} }), 0); } }
    try {
      globalThis.Worker = Silent; await expect(runPartField(new Uint8Array(8), [2, 2, 2], PART_FIELD, 20)).rejects.toThrow(/no answer/);
      globalThis.Worker = Broken; await expect(runPartField(new Uint8Array(8), [2, 2, 2], PART_FIELD, 5000)).rejects.toThrow(/out of memory/);
      expect(made.length).toBe(2); expect(made.every(w => w.terminated)).toBe(true);
    } finally { globalThis.Worker = W0; }
  });
  it('partFieldOf in slabs (opt.budget) gives the same bytes as the whole box', () => {
    const w = 23, h = 17, d = 61, c = new Uint8Array(w * h * d);
    for (let z = 0, o = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, o++) c[o] = Math.hypot(x - 11, y - 8, (z - 30) * 0.4) < 9 ? 1 : ((x * 7 + y * 3 + z) % 5 === 0 ? 2 : 0);
    const whole = partFieldOf(c, [w, h, d], PART_FIELD);
    for (const budget of [1, w * h * 45, w * h * 50]) expect(Array.from(partFieldOf(c, [w, h, d], { ...PART_FIELD, budget }))).toEqual(Array.from(whole));
  });
  it('partFieldUnion: one box over all, the larger byte wins; partFieldMap: texture coordinates of the box', () => {
    const a = { data: Uint8Array.from([10, 200]), lo: [1, 0, 0], size: [2, 1, 1] }, b = { data: Uint8Array.from([150, 20]), lo: [2, 0, 0], size: [2, 1, 1] };
    const one = [1, 0, 0, 0], none = [0, 0, 0, 0];
    expect(partFieldUnion([a, b])).toEqual({ data: Uint8Array.from([10, 200, 20]), lo: [1, 0, 0], size: [3, 1, 1], C: 1, sel: [one, one, one, one], mask: 15 });
    // every part with the same slots: ONE channel, the bytes of before (the larger byte of all), on those slots only
    expect(partFieldUnion([{ ...a, mask: 3 }, { ...b, mask: 3 }])).toEqual({ data: Uint8Array.from([10, 200, 20]), lo: [1, 0, 0], size: [3, 1, 1], C: 1, sel: [one, one, none, none], mask: 3 });
    // parts of different slots (a result and a child segment): a channel per group of slots the same parts have, so a part's field cuts only its own slots, and every slot a part has is cut by a field
    // A on slot 0, B on slot 1 -> two channels: slot 0 = A's field, slot 1 = B's
    expect(partFieldUnion([{ ...a, mask: 1 }, { ...b, mask: 2 }])).toEqual({ data: Uint8Array.from([10, 0, 200, 150, 0, 20]), lo: [1, 0, 0], size: [3, 1, 1], C: 2, sel: [one, [0, 1, 0, 0], none, none], mask: 3 });
    // A on slot 0, B on slots 0 and 1 -> slot 0 = both (the larger byte), slot 1 = B's
    expect(partFieldUnion([{ ...a, mask: 1 }, { ...b, mask: 3 }])).toEqual({ data: Uint8Array.from([10, 0, 200, 150, 20, 20]), lo: [1, 0, 0], size: [3, 1, 1], C: 2, sel: [one, [0, 1, 0, 0], none, none], mask: 3 });
    // three groups are stored as four channels (no 3-byte texture)
    const c3 = partFieldUnion([{ ...a, mask: 1 }, { ...b, mask: 2 }, { ...b, lo: [0, 0, 0], mask: 4 }]);
    expect(c3.C).toBe(4); expect(c3.sel).toEqual([one, [0, 1, 0, 0], [0, 0, 1, 0], none]); expect(c3.data.length).toBe(4 * 4);
    expect(partFieldSelOf(5)).toEqual([one, none, one, none]);
    expect(partFieldUnion([])).toBe(null);
    const m = partFieldMap({ lo: [2, 1, 0], size: [4, 2, 6] }, [8, 8, 6]);
    expect(m.scale).toEqual([2, 4, 1]); expect(m.off).toEqual([-0.5, -0.5, -0]);
  });
  it('partAirOf: air = below 128 on every slot of the mask (the classification channel of each)', () => {
    const cls = { data: Uint8Array.from([0, 200, 0, 0, 150, 10, 0, 0]), C: 4, chan: [0, 1, -1, -1] }, air = partAirOf(cls, [2, 1, 1], [2, 1, 1], 1);
    expect(air(0, 0, 0)).toBe(true); expect(air(1, 0, 0)).toBe(false);
    expect(partAirOf(cls, [2, 1, 1], [2, 1, 1], 3)(0, 0, 0)).toBe(false);
    expect(partAirOf(null, [2, 1, 1], [2, 1, 1], 1)).toBe(null);
  });
  it('the cut bits of the body tables leave every other reader as it was (hidden slots, child hidden mask)', () => {
    const a = new Float32Array(256 * 4); a[2 * 4 + 3] = regionLutAlpha(5, { hidden: true });
    expect(markCutRegionLut(a, [1])).toBe(1);
    expect(regionLutHiddenSlots(a[2 * 4 + 3])).toBe(5); expect(Math.round(a[2 * 4 + 3]) & PART_CUT_REGION_BIT).toBe(PART_CUT_REGION_BIT); expect(Math.round(a[2 * 4 + 3]) & 31).toBe(0);
    const c = new Float32Array(256 * 12); c[1024 + 3 * 4 + 3] = 2;
    expect(markCutChildLut(c, [2])).toBe(1);
    expect(Math.round(c[1024 + 3 * 4 + 3]) & 15).toBe(2); expect(Math.round(c[1024 + 3 * 4 + 3]) & PART_CUT_CHILD_BIT).toBe(PART_CUT_CHILD_BIT);
  });
});

describe('the other kind\'s table of a part keeps only what is hidden (re-review)', () => {
  it('partHideOnlyRegionLut: hidden bits 8..11 kept, colour / focus / cut bits dropped; partHideOnlyChildLut: row 1 hidden bits kept, row 0 slot bits and flat mode dropped', async () => {
    const { partHideOnlyRegionLut, partHideOnlyChildLut } = await import('../../docs/vr-part-view.js');
    const r = new Float32Array(256 * 4); r.set([0.2, 0.3, 0.4, 1 | 16 | (5 << 8) | PART_CUT_REGION_BIT], 4); r.set([1, 1, 1, 15], 8);
    const dr = new Float32Array(256 * 4); partHideOnlyRegionLut(r, dr);
    expect(dr[7]).toBe(5 << 8); expect(dr[11]).toBe(0); expect(regionLutHiddenSlots(dr[7])).toEqual(regionLutHiddenSlots(5 << 8));
    const c = new Float32Array(256 * 12); c.set([0.9, 0.1, 0.1, 3], 4); c.set([300, 3000, 3, 2], 1024 + 4); c.set([0.2, 0.5, 20, 0.7], 2048 + 4);
    const dc = new Float32Array(256 * 12); partHideOnlyChildLut(c, dc);
    expect(dc[7]).toBe(0); expect(dc[1024 + 7]).toBe(2); expect(dc[1024 + 6]).toBe(0);
  });
});

// ---- the cut of several parts on the CPU, as the shader reads it (PART_GLSL partFieldAt: min over the channels of a * texel + b, the texel the GL trilinear read of the material's own box, 0 outside it; vr-part-view.js partFieldSet).
// The body hides slot s where its value is >= 0.5, a part draws slot s where its value is >= 0.5. none = a point of tissue the body hides and no part draws (tissue gone), twice = drawn by two (the body and a part, or two parts).
const triBox = (f, c, x, y, z) => {
  const [w, h, d] = f.size, u = x - f.lo[0] - 0.5, v = y - f.lo[1] - 0.5, s = z - f.lo[2] - 0.5, X = Math.floor(u), Y = Math.floor(v), Z = Math.floor(s), fx = u - X, fy = v - Y, fz = s - Z; let r = 0;
  for (let q = 0; q < 8; q++) { const a = q & 1, b = (q >> 1) & 1, e = (q >> 2) & 1; const i = Math.min(w - 1, Math.max(0, X + a)) + w * (Math.min(h - 1, Math.max(0, Y + b)) + h * Math.min(d - 1, Math.max(0, Z + e))); r += (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (e ? fz : 1 - fz) * f.data[i * f.C + c]; }
  return r / 255;
};
const cutAt = (f, s, x, y, z) => {
  if ([x, y, z].some((v, k) => v < f.lo[k] || v > f.lo[k] + f.size[k])) return 0;
  let m = Infinity; for (let c = 0; c < 4; c++) m = Math.min(m, Math.fround(f.a[s][c] * Math.fround(c < f.C ? triBox(f, c, x, y, z) : 0) + f.b[s][c])); return m; // 32-bit floats, as the shader
};
const localRun = async (lab, size, n, opt) => partGroupFieldsOf(lab, size, n, opt);
// every point of a grid (offset so that it never sits on a voxel centre or face), on the slots given, that tissue(s, x, y, z) says is tissue (all points without it)
const drawCount = (set, dims, slots, tissue = null) => {
  const [W, H, D] = dims; let pts = 0, none = 0, twice = 0; const by = set.parts.map(() => 0);
  for (let z = 1.2; z < D - 1.2; z += 0.31) for (let y = 1.2; y < H - 1.2; y += 0.27) for (let x = 1.2; x < W - 1.2; x += 0.37) for (const s of slots) {
    if (tissue && !tissue(s, x, y, z)) continue;
    pts++; let k = cutAt(set.body, s, x, y, z) >= 0.5 ? 0 : 1;
    set.parts.forEach((P, p) => { if (cutAt(P, s, x, y, z) >= 0.5) { k++; by[p]++; } });
    if (k === 0) none++; else if (k > 1) twice++;
  }
  return { pts, none, twice, by };
};

describe('parts of different slots out together (a result and a child segment)', () => {
  it('every point of tissue is drawn by exactly one of the body and the parts, on both slots', async () => {
    const W = 24, H = 16, D = 20, n = W * H * D, at = (x, y, z) => x + W * (y + H * z);
    const reg = new Uint8Array(n), chi = new Uint8Array(n), cls = [new Uint8Array(n), new Uint8Array(n)];
    for (let z = 1; z < D - 1; z++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = at(x, y, z), under = z + 0.5 < 6 + 0.4 * (x + 0.5);
      if (y < 8) { cls[0][k] = 1; if (under) reg[k] = 1; if (x % 6 === 3 && y % 4 === 2) cls[1][k] = 1; } // slot 0 with the result under a slope, slot-1 tissue (no child) through it
      else { cls[1][k] = 1; if (under) chi[k] = 1; if (x % 6 === 1 && y % 4 === 1) cls[0][k] = 1; } // slot 1 with the child under the slope, slot-0 tissue (no result) through it
    }
    const fA = partFieldOf(reg, [W, H, D], PART_FIELD), fB = partFieldOf(chi, [W, H, D], PART_FIELD);
    const set = await partFieldSet([{ data: fA, lo: [0, 0, 0], size: [W, H, D], mask: 1, kind: 'region' }, { data: fB, lo: [0, 0, 0], size: [W, H, D], mask: 2, kind: 'child' }], localRun);
    expect(set.body.C).toBe(2);
    expect(set.parts[0].data).toBe(fA); expect(set.parts[1].data).toBe(fB); // no part touches another of its slots: each reads its own field, as before (no copy)
    const c = drawCount(set, [W, H, D], [0, 1], (s, x, y, z) => tri(cls[s], W, H, D, x, y, z) * 255 >= 0.5);
    expect(c.pts).toBeGreaterThan(10000);
    expect(c.none).toBe(0);
    expect(c.twice).toBe(0);
  });
});

describe('a child segment inside a result, both cut out: every point of tissue is drawn by exactly one of the body and the parts', () => {
  const W = 26, H = 18, D = 20, n = W * H * D, at = (x, y, z) => x + W * (y + H * z);
  const build = (maskA, maskB) => {
    const reg = new Uint8Array(n), chi = new Uint8Array(n), cls = [0, 1, 2, 3].map(() => new Uint8Array(n));
    for (let z = 1; z < D - 1; z++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = at(x, y, z), inReg = z + 0.5 < 9 + 0.3 * (x + 0.5) && x > 2 && x < W - 3, inChi = inReg && x > 8 && x < 17 && y > 4 && y < 12 && z < 12;
      for (let s = 0; s < 4; s++) if (((maskA | maskB) >> s) & 1) cls[s][k] = 1;
      if (inReg) reg[k] = 1; if (inChi) chi[k] = 1;
    }
    return { reg, chi, cls };
  };
  const count = async (maskA, maskB) => {
    const { reg, chi, cls } = build(maskA, maskB), fA = partFieldOf(reg, [W, H, D], PART_FIELD), fB = partFieldOf(chi, [W, H, D], PART_FIELD);
    const fields = [{ data: fA, lo: [0, 0, 0], size: [W, H, D], mask: maskA, kind: 'region' }, { data: fB, lo: [0, 0, 0], size: [W, H, D], mask: maskB, kind: 'child' }];
    const set = await partFieldSet(fields, localRun), slots = [0, 1, 2, 3].filter(s => ((maskA | maskB) >> s) & 1), tissue = (s, x, y, z) => tri(cls[s], W, H, D, x, y, z) * 255 >= 0.5;
    // the old picture: every part drew its own field on its slots, the body hid the larger byte
    const un = partFieldUnion(fields), old = { body: { ...un, a: un.sel, b: un.sel.map(r => r.map(v => (r.some(t => t) ? 1 - v : 0))) }, parts: fields.map(f => ({ data: f.data, lo: f.lo, size: f.size, C: 1, a: [0, 1, 2, 3].map(s => ((f.mask >> s) & 1 ? [1, 0, 0, 0] : [0, 0, 0, 0])), b: [0, 1, 2, 3].map(s => ((f.mask >> s) & 1 ? [0, 1, 1, 1] : [0, 0, 0, 0])) })) };
    let overlap = 0; for (let i = 0; i < n; i++) if (reg[i] && chi[i]) overlap++;
    return { before: drawCount(old, [W, H, D], slots, tissue), after: drawCount(set, [W, H, D], slots, tissue), overlap, set };
  };
  it('result and child on the same slot: before, the overlap was drawn twice; now once (nothing lost)', async () => {
    const { before, after, overlap } = await count(1, 1);
    expect(overlap).toBeGreaterThan(100);
    expect(before.twice).toBeGreaterThan(1000); // the old picture: the result's part and the child's part both draw the child's tissue
    expect(after.pts).toBe(before.pts);
    expect(after.twice).toBe(0);
    expect(after.none).toBe(0);
    expect(after.by[1]).toBeGreaterThan(1000); // the child's part draws the child
  }, 60000);
  it('result on slots 0 + 1, child on slot 1: only slot 1 is the child\'s (slot 0 stays the result\'s: the seams are slot by slot)', async () => {
    const { before, after, set } = await count(3, 2);
    expect(before.twice).toBeGreaterThan(1000);
    expect(after.twice).toBe(0);
    expect(after.none).toBe(0);
    expect(after.pts).toBe(before.pts);
    expect(set.parts[0].a[0]).toEqual([1, 0, 0, 0]); // slot 0: the result's own field alone (it is alone in that channel)
    expect(set.parts[0].a[1].filter(v => v !== 0).length).toBe(2); // slot 1: the joint field and the child's seam
  }, 60000);
  it('result on slot 0, child on slot 1: nothing to share, the picture is what it was', async () => {
    const { before, after, set } = await count(1, 2);
    expect(after).toEqual(before);
    expect(after.twice).toBe(0);
    expect(after.none).toBe(0);
    expect(set.parts.every((P, p) => P.C === 1)).toBe(true);
  }, 60000);
});

describe('parts that touch: one smooth surface for the hole and the parts, smooth seams, every point drawn once (partFieldSet)', () => {
  const W = 64, H = 12, D = 40, z0 = 8, sl = Math.tan(15 * Math.PI / 180), nl = Math.hypot(sl, 1), under = (x, z) => z < z0 + sl * x;
  const F = m => partFieldOf(m, [W, H, D], PART_FIELD), mk = f => makeMask(W, H, D, f);
  const part = (f, mask, kind = 'region') => ({ data: f, lo: [0, 0, 0], size: [W, H, D], mask, kind });
  // the peak-to-peak (voxels, perpendicular to the slope) of a surface along x in [14, 50] at y = 6 (z by bisection): the step of a cut (one part on this slope: 0.28)
  const step = test => { let lo = Infinity, hi = -Infinity; for (let x = 14; x <= 50; x += 0.25) {
    let a = 0, b = D; for (let k = 0; k < 40; k++) { const md = (a + b) / 2; if (test(x, 6, md)) a = md; else b = md; }
    const dev = ((a - z0) - sl * x) / nl; lo = Math.min(lo, dev); hi = Math.max(hi, dev); } return hi - lo; };
  const R = F(mk((x, y, z) => under(x, z)));
  const layer = t => F(mk((x, y, z) => under(x, z) && z > z0 + sl * x - t && x > 20 && x < 44));
  const cases = {
    'a result (slots 0 + 1) and a 3-thick child (slot 1) along its surface': [[part(R, 3), part(layer(3), 2, 'child')], 1],
    'a result and a 6-thick child along its surface': [[part(R, 3), part(layer(6), 2, 'child')], 1],
    'two parts of the same slots side by side': [[part(F(mk((x, y, z) => under(x, z) && x < 32)), 1), part(F(mk((x, y, z) => under(x, z) && x >= 32)), 1)], 0],
    'three parts side by side': [[part(F(mk((x, y, z) => under(x, z) && x < 24)), 1, 'child'), part(F(mk((x, y, z) => under(x, z) && x >= 24 && x < 40)), 1, 'child'), part(F(mk((x, y, z) => under(x, z) && x >= 40)), 1, 'child')], 0],
    'three parts about one line': [[part(F(mk((x, y, z) => under(x, z) && x < 32 && z < 12)), 1, 'child'), part(F(mk((x, y, z) => under(x, z) && x >= 32 && z < 12)), 1, 'child'), part(F(mk((x, y, z) => under(x, z) && z >= 12)), 1, 'child')], 0],
  };
  for (const [name, [fields, s]] of Object.entries(cases)) it(name + ': the hole and the parts\' outer surface 0.28 voxel (one part\'s), every point drawn once, the same voxel centres hidden', async () => {
    const un = partFieldUnion(fields), set = await partFieldSet(fields, localRun);
    expect(set.plain).toBe(0); expect(set.merged).toBe(0);
    for (const k of ['lo', 'size', 'C']) expect(set.body[k]).toEqual(un[k]);
    const before = step((x, y, z) => cutAt({ ...un, a: un.sel, b: un.sel.map(r => r.map(v => 1 - v)) }, s, x, y, z) >= 0.5); // the larger byte (before)
    const hole = step((x, y, z) => cutAt(set.body, s, x, y, z) >= 0.5), outer = step((x, y, z) => set.parts.some(P => cutAt(P, s, x, y, z) >= 0.5));
    expect(before).toBeGreaterThan(0.34);
    expect(hole).toBeLessThan(0.31); // one part's: 0.28
    expect(outer).toBeCloseTo(hole, 6); // the parts' outer surface IS the hole's wall
    let diffCentre = 0; for (let i = 0; i < un.data.length; i++) if ((un.data[i] >= 128) !== (set.body.data[i] >= 128)) diffCentre++;
    expect(diffCentre).toBe(0); // a voxel centre is hidden by the body when some part has it, before and after
    const c = drawCount(set, [W, H, D], [0, 1, 2, 3].filter(t => fields.some(f => (f.mask >> t) & 1)));
    expect(c.none).toBe(0);
    expect(c.twice).toBe(0);
    expect(c.by.every(v => v > 1000)).toBe(true); // every part draws its own
    // no film of a part on another's face: every point a part draws is within 1.5 voxel of a voxel centre of its own (its field's inside)
    let far = 0;
    for (let z = 1.2; z < D - 1.2; z += 0.62) for (let y = 1.2; y < H - 1.2; y += 0.54) for (let x = 1.2; x < W - 1.2; x += 0.74) set.parts.forEach((P, p) => {
      if (cutAt(P, s, x, y, z) < 0.5) return;
      let ok = false; for (let dz = -2; dz <= 2 && !ok; dz++) for (let dy = -2; dy <= 2 && !ok; dy++) for (let dx = -2; dx <= 2 && !ok; dx++) { const X = Math.floor(x) + dx, Y = Math.floor(y) + dy, Z = Math.floor(z) + dz; if (X >= 0 && Y >= 0 && Z >= 0 && X < W && Y < H && Z < D && fields[p].data[X + W * (Y + H * Z)] >= 128 && Math.hypot(X + 0.5 - x, Y + 0.5 - y, Z + 0.5 - z) <= 1.5) ok = true; }
      if (!ok) far++;
    });
    expect(far).toBe(0);
  }, 60000);
  // each part on its own field box (its voxels' bounds + the pad, as in the app), so the boxes of a group differ and a part reads only what reaches into its box. A crowd: one result with five child segments about it, every box
  // meeting nearly every other (more than 4 terms on a part: two made one, the exact pair where there is one)
  const boxed = (m, mask, kind) => {
    const lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[x + W * (y + H * z)]) [x, y, z].forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
    const b = partFieldBoxOf({ lo, hi }, [W, H, D]), c = new Uint8Array(b.size[0] * b.size[1] * b.size[2]);
    for (let z = 0, i = 0; z < b.size[2]; z++) for (let y = 0; y < b.size[1]; y++) for (let x = 0; x < b.size[0]; x++, i++) c[i] = m[b.lo[0] + x + W * (b.lo[1] + y + H * (b.lo[2] + z))];
    return { data: partFieldOf(c, b.size, PART_FIELD), lo: b.lo, size: b.size, mask, kind };
  };
  const tight = {
    'a result (slots 0 + 1) and a 3-thick child (slot 1), on their own boxes': [() => [boxed(mk((x, y, z) => under(x, z) && x > 2), 3), boxed(mk((x, y, z) => under(x, z) && z > z0 + sl * x - 3 && x > 20 && x < 44), 2, 'child')], [0, 1]],
    'five parts in a row, on their own boxes': [() => [0, 1, 2, 3, 4].map(k => boxed(mk((x, y, z) => under(x, z) && x >= k * 12 && x < (k + 1) * 12), 1, 'child')), [0]],
    'a crowd: a result with five child segments about it, on their own boxes': [() => [boxed(mk((x, y, z) => under(x, z) && x >= 24 && x < 40 && z >= 6 && z < 12), 1), ...[[0, 24], [40, 64]].map(([a, b]) => boxed(mk((x, y, z) => under(x, z) && x >= a && x < b), 1, 'child')), boxed(mk((x, y, z) => under(x, z) && x >= 24 && x < 40 && z < 6 && y < 6), 1, 'child'), boxed(mk((x, y, z) => under(x, z) && x >= 24 && x < 40 && z < 6 && y >= 6), 1, 'child'), boxed(mk((x, y, z) => under(x, z) && x >= 24 && x < 40 && z >= 12), 1, 'child')], [0]],
  };
  for (const [name, [make, slots]] of Object.entries(tight)) it(name + ': every point drawn once', async () => {
    const set = await partFieldSet(make(), localRun);
    expect(set.plain).toBe(0);
    expect(set.parts.every(P => P.C <= 4)).toBe(true);
    if (name.startsWith('a crowd')) { expect(set.merged).toBeGreaterThan(0); expect(set.parts.some(P => P.b[0].includes(-PART_SEAM_TIE))).toBe(true); } // the crowd does take the merge (not exact by the cell check), still drawn once
    const c = drawCount(set, [W, H, D], slots);
    expect(c.none).toBe(0); expect(c.twice).toBe(0);
    if (name.startsWith('a crowd')) { // points exactly on a seam (S = 0.5 to the last bit: 8 x 8 x 8 points a voxel, where two of the crowd's seams met 0.5 exactly): drawn once (before PART_SEAM_TIE: twice)
      let pts = 0, none = 0, twice = 0;
      for (const [x0, y0, z0_] of [[39, 9, 1], [23, 5, 3]]) for (let Z = z0_; Z < z0_ + 2; Z++) for (let Y = y0; Y < y0 + 2; Y++) for (let X = x0; X < x0 + 2; X++) for (let k = 0; k < 512; k++) {
        const x = X + ((k & 7) + 0.5) / 8, y = Y + (((k >> 3) & 7) + 0.5) / 8, z = Z + ((k >> 6) + 0.5) / 8;
        pts++; let m = cutAt(set.body, 0, x, y, z) >= 0.5 ? 0 : 1; set.parts.forEach(P => { if (cutAt(P, 0, x, y, z) >= 0.5) m++; }); if (m === 0) none++; else if (m > 1) twice++;
      }
      expect(pts).toBe(8192); expect(none).toBe(0); expect(twice).toBe(0);
    }
  }, 60000);
  it('the seam between two parts is as smooth as a single part\'s cut on the same plane (15 degrees: 0.25 voxel), on both sides', async () => {
    const sx = z => 30 + sl * z, solid = (x, z) => z < 34;
    const A = F(mk((x, y, z) => solid(x, z) && x < sx(z))), B = F(mk((x, y, z) => solid(x, z) && x >= sx(z)));
    const seam = (P, inside) => { let lo = Infinity, hi = -Infinity; for (let z = 6; z <= 28; z += 0.25) {
      let a = 10, b = 54; for (let k = 0; k < 40; k++) { const md = (a + b) / 2; if ((cutAt(P, 0, md, 6, z) >= 0.5) === inside) a = md; else b = md; }
      const dev = (a - sx(z)) / nl; lo = Math.min(lo, dev); hi = Math.max(hi, dev); } return hi - lo; };
    const one = (await partFieldSet([part(A, 1)], localRun)).parts[0], two = (await partFieldSet([part(A, 1), part(B, 1)], localRun)).parts;
    const single = seam(one, true);
    expect(single).toBeLessThan(0.3);
    expect(seam(two[0], true)).toBeLessThan(single + 0.02);
    expect(seam(two[1], false)).toBeLessThan(single + 0.02);
  }, 60000);
  it('parts that do not touch, or one part: nothing to join, each reads its own field (the same bytes, no copy)', async () => {
    const far1 = { data: new Uint8Array(8 * 8 * 8).fill(255), lo: [0, 0, 0], size: [8, 8, 8], mask: 1, kind: 'region' }, far2 = { ...far1, data: new Uint8Array(8 * 8 * 8).fill(255), lo: [40, 0, 0] };
    expect(partFieldJointGroups([far1, far2])).toEqual([]);
    const s1 = await partFieldSet([far1, far2], localRun);
    expect(s1.parts[0].data).toBe(far1.data); expect(s1.parts[1].data).toBe(far2.data);
    expect(s1.parts[0].a[0]).toEqual([1, 0, 0, 0]); expect(s1.parts[0].b[0]).toEqual([0, 1, 1, 1]); expect(s1.parts[0].a[1]).toEqual([0, 0, 0, 0]); expect(s1.parts[0].b[1]).toEqual([0, 0, 0, 0]);
    expect(s1.body.a[0]).toEqual([1, 0, 0, 0]); expect(s1.body.b[0]).toEqual([0, 1, 1, 1]); expect(s1.body.a[1]).toEqual([0, 0, 0, 0]); expect(s1.body.b[1]).toEqual([0, 0, 0, 0]);
    const s0 = await partFieldSet([far1], localRun);
    expect(s0.body.data).toBe(far1.data); expect(s0.parts[0].data).toBe(far1.data); // the union of one part is its field itself (no second copy in memory)
    expect(await partFieldSet([], localRun)).toBe(null);
    // the order of a group: the smallest-last order of the meeting boxes (equal: the order given; the kind does not change it: a child inside a result is the child's by the labels)
    const near = { ...far2, lo: [8, 0, 0] };
    expect(partFieldJointGroups([far1, near])).toEqual([{ channel: 0, parts: [0, 1] }]);
    expect(partFieldJointGroups([far1, { ...near, kind: 'child' }])).toEqual([{ channel: 0, parts: [0, 1] }]);
    const box = (lo, size) => ({ data: new Uint8Array(size[0] * size[1] * size[2]).fill(255), lo, size, mask: 1, kind: 'child' });
    // a hub that three others meet (they do not meet each other), given last: no part has more than one earlier neighbour
    expect(partFieldJointGroups([box([0, 8, 0], [8, 8, 8]), box([16, 8, 0], [8, 8, 8]), box([9, 17, 0], [6, 8, 8]), { ...box([6, 6, 0], [12, 12, 8]), kind: 'region' }])).toEqual([{ channel: 0, parts: [0, 3, 1, 2] }]);
    expect(partFieldJointGroups([{ ...far1, mask: 1 }, { ...near, mask: 2 }])).toEqual([]); // different slots: a channel each, nothing shared
  });
  it('a group the worker could not make: the larger byte and the unsmoothed seams (counted), still every point drawn once', async () => {
    const fields = [part(F(mk((x, y, z) => under(x, z) && x < 32)), 1), part(F(mk((x, y, z) => under(x, z) && x >= 32)), 1)];
    const set = await partFieldSet(fields, async () => { throw new Error('worker out of memory'); });
    expect(set.plain).toBe(1);
    expect(Array.from(set.body.data)).toEqual(Array.from(partFieldUnion(fields).data));
    const c = drawCount(set, [W, H, D], [0]);
    expect(c.none).toBe(0); expect(c.twice).toBe(0);
  }, 60000);
  it('partGroupFieldsOf: J is the field of the inside of any part; S_k keeps part k\'s voxel centres in and the later parts\' out', () => {
    const lab = new Uint8Array(W * H * D); for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (under(x + 0.5, z + 0.5)) lab[x + W * (y + H * z)] = x < 20 ? 1 : x < 40 ? 2 : 3;
    const { J, S } = partGroupFieldsOf(lab, [W, H, D], 3, PART_FIELD);
    expect(S.length).toBe(2);
    expect(Array.from(J)).toEqual(Array.from(partFieldOf(Uint8Array.from(lab, v => (v ? 1 : 0)), [W, H, D], PART_FIELD)));
    for (let i = 0; i < lab.length; i++) { if (lab[i] === 1) { expect(S[0][i]).toBeGreaterThanOrEqual(128); } else if (lab[i]) expect(S[0][i]).toBeLessThan(128); if (lab[i] === 2) expect(S[1][i]).toBeGreaterThanOrEqual(128); if (lab[i] === 3) expect(S[1][i]).toBeLessThan(128); }
    expect(partGroupPlain(lab, [W, H, D], 3).map(s => s.reduce((t, v) => t + (v ? 1 : 0), 0))).toEqual([1, 2].map(k => lab.reduce((t, v) => t + (v === k ? 1 : 0), 0)));
  });
  it('runPartGroup without a Worker gives the same bytes as partGroupFieldsOf', async () => {
    const lab = new Uint8Array(10 * 6 * 6); for (let i = 0; i < lab.length; i++) { const x = i % 10, z = (i / 60) | 0; if (z < 3) lab[i] = x < 5 ? 1 : 2; }
    const a = await runPartGroup(lab, [10, 6, 6], 2), b = partGroupFieldsOf(lab, [10, 6, 6], 2, PART_FIELD);
    expect(Array.from(a.J)).toEqual(Array.from(b.J)); expect(Array.from(a.S[0])).toEqual(Array.from(b.S[0]));
  });
});

describe('a part of the same channel outside a touching group, inside the group\'s bounding box: drawn once', () => {
  const W = 64, H = 12, DD = 48, mk = f => { const m = new Uint8Array(W * H * DD); for (let z = 0; z < DD; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (f(x + 0.5, y + 0.5, z + 0.5)) m[x + W * (y + H * z)] = 1; return m; };
  const boxed = m => {
    const lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1]; for (let z = 0; z < DD; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[x + W * (y + H * z)]) [x, y, z].forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
    const b = partFieldBoxOf({ lo, hi }, [W, H, DD]), c = new Uint8Array(b.size[0] * b.size[1] * b.size[2]);
    for (let z = 0, i = 0; z < b.size[2]; z++) for (let y = 0; y < b.size[1]; y++) for (let x = 0; x < b.size[0]; x++, i++) c[i] = m[b.lo[0] + x + W * (b.lo[1] + y + H * (b.lo[2] + z))];
    return { data: partFieldOf(c, b.size, PART_FIELD), lo: b.lo, size: b.size, mask: 1, kind: 'region' };
  };
  const PA = boxed(mk((x, y, z) => y > 2 && y < 10 && x > 2 && x < 21 && z > 2 && z < 12)), PB = boxed(mk((x, y, z) => y > 2 && y < 10 && x >= 28 && x < 40 && z > 2 && z < 42));
  const PC = boxed(mk((x, y, z) => y > 2 && y < 10 && x > 3 && x < 16 && z >= 24 && z < 34)), PD = boxed(mk((x, y, z) => y > 2 && y < 10 && x > 3 && x < 16 && z >= 34 && z < 44));
  it('A and B touch, C is in the empty corner of their box: no tissue lost, none drawn twice (before: about 32 thousand points twice)', async () => {
    const hull = [0, 1, 2].map(a => [Math.min(PA.lo[a], PB.lo[a]), Math.max(PA.lo[a] + PA.size[a], PB.lo[a] + PB.size[a])]);
    expect(PC.lo.every((v, a) => v >= hull[a][0] && v + PC.size[a] <= hull[a][1])).toBe(true); // C is inside the hull of A and B
    const groups = partFieldJointGroups([PA, PB, PC]);
    expect(groups.length).toBe(1); expect(groups[0].parts).toEqual([0, 1]); // C is not in the group
    const set = await partFieldSet([PA, PB, PC], localRun), c = drawCount(set, [W, H, DD], [0]);
    expect(c.pts).toBeGreaterThan(10000);
    expect(c.none).toBe(0); expect(c.twice).toBe(0);
    expect(c.by[2]).toBeGreaterThan(500); // C draws its own tissue
  }, 60000);
  it('two groups (A and B, C and D) whose bounding boxes overlap: neither overwrites the other\'s place', async () => {
    const groups = partFieldJointGroups([PA, PB, PC, PD]);
    expect(groups.map(g => g.parts)).toEqual([[0, 1], [2, 3]]);
    const set = await partFieldSet([PA, PB, PC, PD], localRun), c = drawCount(set, [W, H, DD], [0]);
    expect(c.none).toBe(0); expect(c.twice).toBe(0);
    expect(c.by[2]).toBeGreaterThan(500); expect(c.by[3]).toBeGreaterThan(500);
  }, 60000);
});

describe('parts whose boxes meet but whose fields do not reach each other are not a group', () => {
  const W = 56, H = 40, DD = 8;
  const mk = f => { const m = new Uint8Array(W * H * DD); for (let z = 0; z < DD; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (f(x + 0.5, y + 0.5, z + 0.5)) m[x + W * (y + H * z)] = 1; return m; };
  const boxed = (m, mask = 1, kind = 'region') => {
    const lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1]; for (let z = 0; z < DD; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[x + W * (y + H * z)]) [x, y, z].forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
    const b = partFieldBoxOf({ lo, hi }, [W, H, DD]), c = new Uint8Array(b.size[0] * b.size[1] * b.size[2]);
    for (let z = 0, i = 0; z < b.size[2]; z++) for (let y = 0; y < b.size[1]; y++) for (let x = 0; x < b.size[0]; x++, i++) c[i] = m[b.lo[0] + x + W * (b.lo[1] + y + H * (b.lo[2] + z))];
    return { data: partFieldOf(c, b.size, PART_FIELD), lo: b.lo, size: b.size, mask, kind };
  };
  // A: an L (a bar along the bottom and one up the left side); C: a block that touches the end of A's bar; B: a ball in the notch of the L, 13 voxels from the bar and 17 from the other
  const mA = mk((x, y, z) => z > 1 && z < 7 && ((y > 1 && y < 9 && x > 1 && x < 46) || (x > 1 && x < 10 && y > 1 && y < 38))), mC = mk((x, y, z) => z > 1 && z < 7 && y > 1 && y < 9 && x >= 46 && x < 54);
  const mB = mk((x, y, z) => z > 1 && z < 7 && (x - 30) ** 2 + (y - 26) ** 2 < 9 * 9 / 2);
  const A = boxed(mA), B = boxed(mB), Cc = boxed(mC);
  it('the boxes meet, the fields do not reach: B is no member of the group of A and C (and the same set drawn once)', async () => {
    const meet = (a, b) => [0, 1, 2].every(k => a.lo[k] <= b.lo[k] + b.size[k] && b.lo[k] <= a.lo[k] + a.size[k]);
    expect(meet(A, B) && meet(A, Cc)).toBe(true); // by the boxes: all three one group (B meets A)
    expect(partFieldJointGroups([A, B, Cc]).map(g => g.parts.slice().sort())).toEqual([[0, 1, 2]]);
    const near = partFieldNearOf([A, B, Cc], PART_FIELD.pad);
    expect(near(0, 2)).toBe(true); expect(near(0, 1)).toBe(false); expect(near(1, 2)).toBe(false);
    expect(partFieldJointGroups([A, B, Cc], near).map(g => g.parts.slice().sort())).toEqual([[0, 2]]); // B is alone
    const set = await partFieldSet([A, B, Cc], localRun), cls = new Uint8Array(W * H * DD); for (let i = 0; i < cls.length; i++) cls[i] = mA[i] | mB[i] | mC[i];
    const c = drawCount(set, [W, H, DD], [0], (s, x, y, z) => tri(cls, W, H, DD, x, y, z) * 255 >= 0.5);
    expect(c.pts).toBeGreaterThan(5000); expect(c.none).toBe(0); expect(c.twice).toBe(0);
    expect(c.by[1]).toBeGreaterThan(300); // B draws its own tissue, on its own field (the part alone: its field, as it was made)
    expect(set.parts[1].data).toBe(B.data); expect(set.parts[1].C).toBe(1);
  }, 60000);
  it('the same with the other order and with child segments in the group', async () => {
    for (const fields of [[Cc, B, A], [B, A, Cc], [A, { ...B, kind: 'child' }, { ...Cc, kind: 'child' }]]) {
      const set = await partFieldSet(fields, localRun), cls = new Uint8Array(W * H * DD); for (let i = 0; i < cls.length; i++) cls[i] = mA[i] | mB[i] | mC[i];
      const c = drawCount(set, [W, H, DD], [0], (s, x, y, z) => tri(cls, W, H, DD, x, y, z) * 255 >= 0.5);
      expect(c.none).toBe(0); expect(c.twice).toBe(0);
    }
  }, 60000);
  it('partFieldDilate: the cube of radius r around the voxels > 0, inside the box', () => {
    const fw = 11, fh = 9, fd = 7, m = new Uint8Array(fw * fh * fd); m[5 + fw * (4 + fh * 3)] = 2; m[0] = 1;
    for (const r of [0, 1, 2, 4]) {
      const got = partFieldDilate(m, fw, fh, fd, r);
      for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) expect(got[i]).toBe(Math.max(Math.abs(x - 5), Math.abs(y - 4), Math.abs(z - 3)) <= r || Math.max(x, y, z) <= r ? 1 : 0);
    }
  });
  it('a field is > 0 only within PART_FIELD.pad of its inside (what partFieldNearOf relies on): blobs, plates, speckle', () => {
    let st = 99; const r = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
    for (let t = 0; t < 4; t++) {
      const w = 40, h = 36, d = 34, c = new Uint8Array(w * h * d), bl = Array.from({ length: 4 }, () => [8 + r() * 24, 8 + r() * 20, 8 + r() * 18, 2 + r() * 6]);
      for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (bl.some(b => (x - b[0]) ** 2 + (y - b[1]) ** 2 + (z - b[2]) ** 2 < b[3] ** 2) || r() < 0.01 * t) c[i] = 1;
      const f = partFieldOf(c, [w, h, d], PART_FIELD), ins = new Uint8Array(f.length).map((_, i) => (f[i] >= 128 ? 1 : 0)), far = partFieldDilate(ins, w, h, d, PART_FIELD.pad);
      for (let i = 0; i < f.length; i++) if (f[i] > 0) expect(far[i]).toBe(1);
    }
  });
});
