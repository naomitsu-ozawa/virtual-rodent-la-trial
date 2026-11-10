import { describe, it, expect } from 'vitest';
import { buildRegionIndexOf, prepWorkerSource } from '../../docs/vr-volume-prep.js';
import { gpuRunsForTexture } from '../../docs/gpu-runs.js';

// on a REDUCED grid buildRegionIndexOf paints the nearest source voxel first (as before), then fills the coarse voxels that are still 0 from the source block they cover.
// refOld below is buildRegionIndexOf as it was (verbatim), the reference for "same grid: not one byte different" and "the first pass is never overwritten".
function refOld(items, sourceDims, dims) {
  if (!items.length) return { data: null, colors: [], segs: [], list: [] };
  const w = dims[0], h = dims[1], d = dims[2], colors = [], segs = [], data = new Uint8Array(w * h * d), ids = new Uint8Array(w * h * d), list = [];
  for (const r of items) {
    if (list.length >= 255) break; const id = list.length + 1;
    const c = Number(r.color) >>> 0; let k = colors.indexOf(c); if (k < 0 && colors.length < 14) { colors.push(c); segs.push(0); k = colors.length - 1; }
    if (k >= 0) segs[k] |= r.segMask | 0;
    const runs = gpuRunsForTexture(r.runsBySlice, sourceDims, dims, { dilate: 0 });
    for (let z = 0; z < d; z++) { const rec = runs ? runs[z] : null; if (!rec || !rec.length) continue; for (let i = 0; i < rec.length; i += 3) { const o = (z * h + rec[i]) * w; if (k >= 0) data.fill(k + 1, o + rec[i + 1], o + rec[i + 2] + 1); ids.fill(id, o + rec[i + 1], o + rec[i + 2] + 1); } }
    list.push({ color: c, mm3: r.mm3, segmentKeys: r.segmentKeys.slice(), rid: r.rid, segMask: r.segMask | 0 });
  }
  return { data: colors.length ? data : null, ids: colors.length ? ids : null, colors, segs, list };
}

// VR_PREP_VERSION 7: after both passes, ids grows ONE voxel into its 6 face neighbours (only voxels still 0; the largest id among the neighbours as they were before the growth = the later result wins;
// the colour index `data` is not grown). refGrow is that rule written the plain way (a copy, then every 0 voxel looks at the copy), the reference for the in-place one-pass code.
function refGrow(ids, dims) {
  const [w, h, d] = dims, src = ids.slice(), out = ids.slice();
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (z * h + y) * w + x; if (src[o]) continue; let m = 0;
    for (const [dx, dy, dz] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]) { const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d) continue; m = Math.max(m, src[(Z * h + Y) * w + X]); }
    out[o] = m;
  }
  return out;
}
// source runs ([y, x0, x1] triples per z) of the voxels where pred(x, y, z)
function runsOf(dims, pred) {
  const [w, h, d] = dims, out = new Array(d);
  for (let z = 0; z < d; z++) { const rec = []; for (let y = 0; y < h; y++) { let x0 = -1; for (let x = 0; x <= w; x++) { const on = x < w && pred(x, y, z); if (on && x0 < 0) x0 = x; else if (!on && x0 >= 0) { rec.push(y, x0, x - 1); x0 = -1; } } } out[z] = rec.length ? new Uint32Array(rec) : null; }
  return out;
}
const item = (runsBySlice, color, i = 0) => ({ color, segMask: 1 << (i % 8), runsBySlice, mm3: 1, segmentKeys: ['bone'], rid: i + 1 });
const eq = (a, b) => { expect(a.length).toBe(b.length); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error('differs at ' + i + ': ' + a[i] + ' vs ' + b[i]); };
// the coarse voxels (x, y, z) the source voxel (sx, sy, sz) lies in, by the 2:1 block rule
const blockOf = (v, n, t) => [Math.floor(v * t / n), Math.floor(((v + 1) * t - 1) / n)];

describe('buildRegionIndexOf on a reduced grid: no holes in a thin result', () => {
  const sd = [40, 32, 24], dims = [20, 16, 12];
  // a one-voxel-thick diagonal plate x + y = 30 (with z free): about half of its voxels are not the nearest voxel of any coarse voxel
  const plate = runsOf(sd, (x, y) => x + y === 30);
  it('the old nearest-voxel pass left holes in the plate, the new index has none', () => {
    const old = refOld([item(plate, 0xff0000)], sd, dims), now = buildRegionIndexOf([item(plate, 0xff0000)], sd, dims);
    // every coarse voxel whose 2x2x2 block holds a plate voxel
    const need = new Uint8Array(dims[0] * dims[1] * dims[2]);
    for (let z = 0; z < sd[2]; z++) for (let y = 0; y < sd[1]; y++) for (let x = 0; x < sd[0]; x++) if (x + y === 30) need[((z >> 1) * dims[1] + (y >> 1)) * dims[0] + (x >> 1)] = 1;
    let holesOld = 0, holesNow = 0, n = 0;
    for (let i = 0; i < need.length; i++) if (need[i]) { n++; if (!old.ids[i]) holesOld++; if (!now.ids[i]) holesNow++; if (now.data[i] !== 1) throw new Error('data not painted at ' + i); }
    expect(n).toBeGreaterThan(50); expect(holesOld).toBeGreaterThan(0); expect(holesNow).toBe(0);
  });
  it('the first pass is never overwritten and only blocks that hold a result voxel are added', () => {
    const items = [item(plate, 0xff0000, 0), item(runsOf(sd, (x, y, z) => x >= 4 && x < 14 && y >= 4 && y < 14 && z >= 2 && z < 12), 0x00ff00, 1)];
    const old = refOld(items, sd, dims), now = buildRegionIndexOf(items, sd, dims);
    for (let i = 0; i < old.ids.length; i++) if (old.ids[i]) { expect(now.ids[i]).toBe(old.ids[i]); expect(now.data[i]).toBe(old.data[i]); }
    // a coarse voxel far from both results stays 0
    expect(now.ids[(11 * dims[1] + 0) * dims[0] + 19]).toBe(0);
    expect(now.colors).toEqual(old.colors); expect(now.segs).toEqual(old.segs); expect(now.list).toEqual(old.list);
  });
  it('two results in one block: the later one in the list wins, in ids and in data (a first-pass voxel is still kept)', () => {
    // source voxels (5,5,5) = result A and (4,4,4) = result B lie in the same coarse voxel (2,2,2); the nearest source voxel of (2,2,2) is round(2*39/19) = 4 -> (4,4,4) is B's, so use others:
    // A at (5,5,5), B at (4,5,5): the nearest voxel (4,4,4) belongs to nobody, so the block is a hole for both and the later (B) wins
    const A = runsOf(sd, (x, y, z) => x === 5 && y === 5 && z === 5), B = runsOf(sd, (x, y, z) => x === 4 && y === 5 && z === 5);
    const ab = buildRegionIndexOf([item(A, 0x111111, 0), item(B, 0x222222, 1)], sd, dims), ba = buildRegionIndexOf([item(B, 0x222222, 0), item(A, 0x111111, 1)], sd, dims);
    const o = (2 * dims[1] + 2) * dims[0] + 2;
    expect(refOld([item(A, 0x111111, 0), item(B, 0x222222, 1)], sd, dims).ids[o]).toBe(0);
    expect(ab.ids[o]).toBe(2); expect(ab.colors[ab.data[o] - 1]).toBe(0x222222); expect(ba.ids[o]).toBe(2); expect(ba.colors[ba.data[o] - 1]).toBe(0x111111); // the later result's id and colour
  });
  it('a result of the 15th colour is in ids only, also in the second pass; a null runsBySlice is skipped', () => {
    const items = Array.from({ length: 15 }, (_, i) => item(i === 14 ? plate : runsOf(sd, (x, y, z) => x === 2 * i + 1 && y === 1 && z === 1), 0x1000 + i, i));
    items.push({ ...item(null, 0x5555, 15) });
    const now = buildRegionIndexOf(items, sd, dims);
    expect(now.colors).toHaveLength(14); expect(now.list).toHaveLength(16);
    let inIds = 0, inData15 = 0; for (let i = 0; i < now.ids.length; i++) { if (now.ids[i] === 15) { inIds++; if (now.data[i]) inData15++; } }
    expect(inIds).toBeGreaterThan(0); expect(inData15).toBe(0);
  });
  it('odd and non-integer ratios never write outside the grid, and every source voxel lands in a coarse voxel of its own result', () => {
    for (const [s, t] of [[[41, 33, 25], [20, 16, 12]], [[30, 30, 30], [20, 20, 20]], [[17, 5, 9], [8, 2, 4]], [[40, 32, 24], [1, 1, 1]]]) {
      const all = runsOf(s, () => true), now = buildRegionIndexOf([item(all, 1)], s, t);
      expect(now.ids.length).toBe(t[0] * t[1] * t[2]); expect(now.ids.every(v => v === 1)).toBe(true);
      const one = runsOf(s, (x, y, z) => x === s[0] - 1 && y === s[1] - 1 && z === s[2] - 1), r1 = buildRegionIndexOf([item(one, 1)], s, t);
      const [x0, x1] = blockOf(s[0] - 1, s[0], t[0]), [y0, y1] = blockOf(s[1] - 1, s[1], t[1]), [z0, z1] = blockOf(s[2] - 1, s[2], t[2]);
      expect(x1).toBe(t[0] - 1);
      const seed = (x, y, z) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1) || (x === t[0] - 1 && y === t[1] - 1 && z === t[2] - 1);
      for (let z = 0; z < t[2]; z++) for (let y = 0; y < t[1]; y++) for (let x = 0; x < t[0]; x++) {
        // the block / nearest voxel and (VR_PREP_VERSION 7) their face neighbours may be painted; everything else stays 0
        if (seed(x, y, z) || seed(x - 1, y, z) || seed(x + 1, y, z) || seed(x, y - 1, z) || seed(x, y + 1, z) || seed(x, y, z - 1) || seed(x, y, z + 1)) continue; expect(r1.ids[(z * t[1] + y) * t[0] + x]).toBe(0);
      }
    }
  });
  it('2:1 is the 2x2x2 block: source voxel (x, y, z) fills coarse voxel (x >> 1, y >> 1, z >> 1)', () => {
    const one = runsOf(sd, (x, y, z) => x === 7 && y === 9 && z === 11), now = buildRegionIndexOf([item(one, 1)], sd, dims);
    let count = 0, inData = 0, at = -1; for (let i = 0; i < now.ids.length; i++) { if (now.ids[i]) count++; if (now.data[i]) { inData++; at = i; } }
    // the nearest voxel of the coarse voxel (3, 4, 5) is (round(3*39/19), ...) = (6, 8, 10) in the source, so only the block pass can paint it; ids then grows into its 6 face neighbours (7 voxels), data stays 1 voxel
    expect(inData).toBe(1); expect(at).toBe((5 * dims[1] + 4) * dims[0] + 3); expect(count).toBe(7); eq(now.ids, refGrow(now.data, dims));
  });
});

describe('buildRegionIndexOf on the same grid', () => {
  it('= the function, then ids grown by one voxel (data, colours, segs, list byte-identical), also for empty and null runs', () => {
    const dims = [37, 29, 23], mk = (i, p) => item(runsOf(dims, p), 0x100 + (i % 5), i);
    const items = [mk(0, (x, y, z) => (x + y + z) % 7 === 0), mk(1, (x, y, z) => x === y), mk(2, (x, y, z) => z > 20 || x < 2), { ...item(null, 3, 3) }, mk(4, () => false)];
    const a = buildRegionIndexOf(items, dims, dims), b = refOld(items, dims, dims);
    eq(a.ids, refGrow(b.ids, dims)); eq(a.data, b.data); expect(a.colors).toEqual(b.colors); expect(a.segs).toEqual(b.segs); expect(a.list).toEqual(b.list);
    expect(buildRegionIndexOf([], dims, dims)).toEqual({ data: null, colors: [], segs: [], list: [] });
  });
});

describe('buildRegionIndexOf grows ids by one voxel (VR_PREP_VERSION 7)', () => {
  const dims = [9, 8, 7], at = (x, y, z) => (z * dims[1] + y) * dims[0] + x, one = (X, Y, Z) => runsOf(dims, (x, y, z) => x === X && y === Y && z === Z);
  it('one voxel grows into exactly its 6 face neighbours: no diagonal, no second step; at a corner only the neighbours inside the grid', () => {
    const r = buildRegionIndexOf([item(one(4, 4, 3), 0xaa0000)], dims, dims);
    const on = []; for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) if (r.ids[at(x, y, z)]) on.push([x, y, z].join());
    expect(on.sort()).toEqual(['4,4,3', '3,4,3', '5,4,3', '4,3,3', '4,5,3', '4,4,2', '4,4,4'].sort());
    expect(r.ids[at(5, 5, 3)]).toBe(0); expect(r.ids[at(6, 4, 3)]).toBe(0); // diagonal / two steps away
    const c = buildRegionIndexOf([item(one(0, 0, 0), 0xaa0000)], dims, dims); let n = 0; for (const v of c.ids) if (v) n++;
    expect(n).toBe(4); expect(c.ids[at(1, 0, 0)]).toBe(1); expect(c.ids[at(0, 1, 0)]).toBe(1); expect(c.ids[at(0, 0, 1)]).toBe(1);
  });
  it('a painted voxel is never changed, and the colour index (data, the label histogram) is not grown', () => {
    // results 1 and 2 touch (x = 3 | x = 4): neither eats the other; the grown voxels have data 0
    const items = [item(runsOf(dims, (x, y, z) => x === 3 && y >= 2 && y <= 5), 0x110000, 0), item(runsOf(dims, (x, y, z) => x === 4 && y >= 2 && y <= 5), 0x220000, 1)];
    const r = buildRegionIndexOf(items, dims, dims), b = refOld(items, dims, dims);
    for (let i = 0; i < b.ids.length; i++) if (b.ids[i]) expect(r.ids[i]).toBe(b.ids[i]);
    eq(r.data, b.data);
    expect(r.ids[at(2, 3, 3)]).toBe(1); expect(r.ids[at(5, 3, 3)]).toBe(2); expect(r.data[at(2, 3, 3)]).toBe(0); expect(r.data[at(5, 3, 3)]).toBe(0);
  });
  it('a gap voxel between two results takes the LATER result in the list, whichever side it is on (not the scan order)', () => {
    const L = runsOf(dims, (x, y, z) => x === 2 && y === 4 && z === 3), R = runsOf(dims, (x, y, z) => x === 4 && y === 4 && z === 3), gap = at(3, 4, 3);
    const lr = buildRegionIndexOf([item(L, 0x110000, 0), item(R, 0x220000, 1)], dims, dims), rl = buildRegionIndexOf([item(R, 0x220000, 0), item(L, 0x110000, 1)], dims, dims);
    expect(lr.ids[gap]).toBe(2); expect(lr.list[1].color).toBe(0x220000); // R is later: R's id
    expect(rl.ids[gap]).toBe(2); expect(rl.list[1].color).toBe(0x110000); // L is later: L's id
    // the same along z and y (neighbours read from the slices before / after and the rows above / below)
    const Z0 = runsOf(dims, (x, y, z) => x === 4 && y === 4 && z === 1), Z1 = runsOf(dims, (x, y, z) => x === 4 && y === 4 && z === 3);
    expect(buildRegionIndexOf([item(Z0, 1, 0), item(Z1, 2, 1)], dims, dims).ids[at(4, 4, 2)]).toBe(2); expect(buildRegionIndexOf([item(Z1, 2, 0), item(Z0, 1, 1)], dims, dims).ids[at(4, 4, 2)]).toBe(2);
    const Y0 = runsOf(dims, (x, y, z) => x === 4 && y === 1 && z === 3), Y1 = runsOf(dims, (x, y, z) => x === 4 && y === 3 && z === 3);
    expect(buildRegionIndexOf([item(Y0, 1, 0), item(Y1, 2, 1)], dims, dims).ids[at(4, 2, 3)]).toBe(2); expect(buildRegionIndexOf([item(Y1, 2, 0), item(Y0, 1, 1)], dims, dims).ids[at(4, 2, 3)]).toBe(2);
  });
  it('on a reduced grid the growth comes after both passes (= refGrow of the index without it)', () => {
    const sd = [40, 32, 24], rd = [20, 16, 12], items = [item(runsOf(sd, (x, y) => x + y === 30), 0xff0000, 0), item(runsOf(sd, (x, y, z) => x >= 4 && x < 14 && y >= 4 && y < 14 && z >= 2 && z < 12), 0x00ff00, 1)];
    const r = buildRegionIndexOf(items, sd, rd);
    // data has every voxel of the two passes (each result has a colour of its own here), so the index before the growth is data mapped back to the ids
    const before = r.data.map(v => v);
    eq(r.ids, refGrow(before, rd));
  });
});

describe('the worker source', () => {
  it('buildRegionIndexOf made from the function text (no outer name) gives the same bytes on a reduced grid', () => {
    const src = prepWorkerSource().replace(/\(0,\s*__vite_ssr_import_\d+__\.(\w+)\)/g, '$1').replace(/__vite_ssr_import_\d+__\./g, '');
    const fn = new Function('self', src + '\nreturn buildRegionIndexOf;')({ postMessage() {} });
    const sd = [40, 32, 24], dims = [20, 16, 12], items = [item(runsOf(sd, (x, y) => x + y === 30), 7, 0), item(runsOf(sd, (x, y, z) => x === 5 && y === 5 && z === 5), 9, 1)];
    const a = fn(items, sd, dims), b = buildRegionIndexOf(items, sd, dims);
    eq(a.ids, b.ids); eq(a.data, b.data);
  });
});
