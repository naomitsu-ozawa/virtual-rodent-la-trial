import { describe, it, expect } from 'vitest';
import { PART_FIELD, partFieldBox, partFieldCodes, partFieldOf, partFieldPlain, partFieldBoxOf, partBoundsOf, runPartField, partFieldUnion, partFieldSelOf, partFieldMap, partAirOf, markCutRegionLut, markCutChildLut, PART_CUT_REGION_BIT, PART_CUT_CHILD_BIT } from '../../docs/vr-part-view.js';
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

describe('parts of different slots out together (a result and a child segment)', () => {
  it('every point of tissue is drawn by exactly one of the body and the parts, on both slots', () => {
    const W = 24, H = 16, D = 20, n = W * H * D, at = (x, y, z) => x + W * (y + H * z);
    const reg = new Uint8Array(n), chi = new Uint8Array(n), cls = [new Uint8Array(n), new Uint8Array(n)];
    for (let z = 1; z < D - 1; z++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = at(x, y, z), under = z + 0.5 < 6 + 0.4 * (x + 0.5);
      if (y < 8) { cls[0][k] = 1; if (under) reg[k] = 1; if (x % 6 === 3 && y % 4 === 2) cls[1][k] = 1; } // slot 0 with the result under a slope, slot-1 tissue (no child) through it
      else { cls[1][k] = 1; if (under) chi[k] = 1; if (x % 6 === 1 && y % 4 === 1) cls[0][k] = 1; } // slot 1 with the child under the slope, slot-0 tissue (no result) through it
    }
    const fA = partFieldOf(reg, [W, H, D], PART_FIELD), fB = partFieldOf(chi, [W, H, D], PART_FIELD);
    const un = partFieldUnion([{ data: fA, lo: [0, 0, 0], size: [W, H, D], mask: 1 }, { data: fB, lo: [0, 0, 0], size: [W, H, D], mask: 2 }]);
    expect(un.C).toBe(2);
    const tri = (f, C, c, x, y, z) => { const u = x - 0.5, v = y - 0.5, s = z - 0.5, X = Math.floor(u), Y = Math.floor(v), Z = Math.floor(s), fx = u - X, fy = v - Y, fz = s - Z; let r = 0;
      for (let q = 0; q < 8; q++) { const a = q & 1, b = (q >> 1) & 1, e = (q >> 2) & 1; r += (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (e ? fz : 1 - fz) * f[at(Math.min(W - 1, Math.max(0, X + a)), Math.min(H - 1, Math.max(0, Y + b)), Math.min(D - 1, Math.max(0, Z + e))) * C + c]; } return r; };
    const near = (m, x, y, z) => m[at(Math.floor(x), Math.floor(y), Math.floor(z))];
    const fin = (x, y, z, s) => un.sel[s].reduce((t, w, c) => t + (w ? tri(un.data, un.C, c, x, y, z) / 255 : 0), 0) >= 0.5; // partFieldIn: dot(texture, partFieldSel[s]) >= 0.5
    // the body: childHiddenAtP (child 1 cut out: the field; else the field reaching in, else its hidden bits) || regionHiddenAtP (result 1 cut out: the field; else its hidden bits; with children: no reach-in here)
    const bodyHides = (x, y, z, s) => (near(chi, x, y, z) === 1 ? fin(x, y, z, s) : fin(x, y, z, s)) || (near(reg, x, y, z) === 1 && fin(x, y, z, s));
    const partA = (x, y, z, s) => s === 0 && tri(fA, 1, 0, x, y, z) / 255 >= 0.5; // the result's part: its own field on its own slot (the child it does not draw is on slot 1 only)
    const partB = (x, y, z, s) => s === 1 && tri(fB, 1, 0, x, y, z) / 255 >= 0.5;
    let pts = 0, none = 0, twice = 0;
    for (let z = 1.2; z < D - 1.2; z += 0.31) for (let y = 1.2; y < H - 1.2; y += 0.27) for (let x = 1.2; x < W - 1.2; x += 0.37) for (let s = 0; s < 2; s++) {
      if (tri(cls[s], 1, 0, x, y, z) < 0.5) continue;
      pts++; const k = (bodyHides(x, y, z, s) ? 0 : 1) + (partA(x, y, z, s) ? 1 : 0) + (partB(x, y, z, s) ? 1 : 0);
      if (k === 0) none++; else if (k > 1) twice++;
    }
    expect(pts).toBeGreaterThan(10000);
    expect(none).toBe(0);
    expect(twice).toBe(0);
  });
});
