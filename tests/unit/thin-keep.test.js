import { describe, it, expect } from 'vitest';
import { prepRun, prepWorkerSource, thinHuData, sourceRangeInit, sourceRangeAdd, halveRangeOf, halveData, coverRunsOnGrid, thinKeepOf, BRICK } from '../../docs/vr-volume-prep.js';
import { PART_FIELD } from '../../docs/vr-part-view.js';


const CAL = [1, -1024, 0]; // raw word = HU + 1024
const AIR = -1000, BONE = 1500;
const run = m => { let out = null; prepRun(m, r => { if (r.t === 'cls' || r.t === 'volume' || r.t === 'error') out = r; }); if (out.t === 'error') throw new Error(out.message); return out; };
const volumeOf = (dims, huAt) => { const [w, h, d] = dims, v = new Uint8Array(w * h * d * 2); for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) { const raw = huAt(x, y, z) + 1024; v[i * 2] = raw & 255; v[i * 2 + 1] = raw >> 8; } return v; };
const runsOf = (dims, inside) => { const [w, h, d] = dims, out = []; for (let z = 0; z < d; z++) { const r = []; for (let y = 0; y < h; y++) { let x = 0; while (x < w) { if (!inside(x, y, z)) { x++; continue; } let b = x; while (b + 1 < w && inside(b + 1, y, z)) b++; r.push(y, x, b); x = b + 1; } } out.push(Uint32Array.from(r)); } return out; };
const STATE = (min = 300, max = 4000) => ({ bone: { active: true, enabled: true, min, max }, soft: { active: false, enabled: false, min: 0, max: 1 }, fat: { active: false, enabled: false, min: 0, max: 1 }, lung: { active: false, enabled: false, min: 0, max: 1 } });
const ORDER = ['bone', 'soft', 'fat', 'lung'];
const half = (dims, huAt) => { const v = volumeOf(dims, huAt), r = run({ t: 'volume', id: 1, data: v.slice().buffer, dims, calib: CAL, brick: BRICK, half: true }); r.half.srcV = v; r.half.srcDims = dims; return { v, h: r.half }; };
const srcExtra = h => ({ body: h.srcV.slice().buffer, editSourceDims: h.srcDims }); // the cls job reads the SOURCE voxels (the unreduced source grid) for the exact marks of a value-range segment
const clsJob = (h, extra) => ({ t: 'cls', id: 2, src: h.data.slice().buffer, dims: h.dims, calib: CAL, editDescs: [], editSourceDims: h.dims, regionItems: [], childItems: [], order: ORDER, state: STATE(), brickDimsFull: [1, 1, 1], brickDimsHalf: h.brickDims, mask: 1, ...extra });
const count = (arr, f) => { let n = 0; for (let i = 0; i < arr.length; i++) if (f(arr[i], i)) n++; return n; };
const sheet = (z0, z1, x0 = 6, x1 = 33) => (x, y, z) => (z >= z0 && z <= z1 && x >= x0 && x <= x1 && y >= x0 && y <= x1 ? BONE : AIR);
const rows = [];
const note = (kind, what, before, after) => { rows.push({ kind, what, before, after }); };

// ---- a processing mask (領域): include (a region that keeps), exclude (a region that cuts), with the smoothing on as in a session
describe('thin structures on the 256 copy: a processing mask (領域)', () => {
  const dims = [20, 20, 20], src = [40, 40, 40], filler = new Uint8Array(20 * 20 * 20 * 2);
  const job = (desc, extra) => ({ t: 'cls', id: 3, src: filler.slice().buffer, dims, calib: CAL, editDescs: [desc], editSourceDims: src, regionItems: [], childItems: [], order: ORDER, state: STATE(-5000, 5000), brickDimsFull: [1, 1, 1], brickDimsHalf: [3, 3, 3], mask: 1, maskField: { ...PART_FIELD }, ...extra });
  const region = (z0, z1) => runsOf(src, (x, y, z) => z >= z0 && z <= z1 && x >= 6 && x <= 33 && y >= 6 && y <= 33);
  it('a mask-only region of one source voxel (odd slice): no voxel before, a full-byte layer in the mask and in the classification after, also after the smoothing', () => {
    const d = { si: 0, mode: 'keep', maskOnly: true, runs: region(11, 11) }, off = run(job(d, { thinKeep: false })), on = run(job(d, {}));
    const m = (r, f) => count(r.edit.data, (v, i) => i % 4 === 0 && f(v)), c = (r, f) => count(r.cls.data, f);
    expect(m(off, v => v >= 128)).toBe(0); expect(m(on, v => v === 255)).toBe(14 * 14); expect(c(on, v => v === 255)).toBe(14 * 14); expect(c(off, v => v >= 128)).toBe(0);
    expect(on.warnings).toEqual([]);
    expect(on.occHalf).toBeTruthy(); // the brick occupancy sees it (the mask-only brick is a candidate)
    note('領域(マスクのみ)', '1ボクセルの領域(奇数スライス)', m(off, v => v >= 128), m(on, v => v >= 128));
  });
  it('a region of 2 and of 3 source voxels is kept as at least one full voxel layer', () => {
    for (const [a, b] of [[11, 12], [11, 13]]) {
      const d = { si: 0, mode: 'keep', maskOnly: true, runs: region(a, b) }, off = run(job(d, { thinKeep: false })), on = run(job(d, {}));
      const m = r => count(r.edit.data, (v, i) => i % 4 === 0 && v >= 128);
      expect(m(on)).toBeGreaterThanOrEqual(14 * 14); expect(count(on.cls.data, v => v === 255)).toBeGreaterThanOrEqual(14 * 14);
      note('領域(マスクのみ)', (b - a + 1) + 'ボクセルの領域', m(off), m(on));
    }
  });
  it('a thin region that cuts (exclude): the cut stays one voxel thick (byte 0)', () => {
    const d = { si: 0, mode: 'exclude', maskOnly: false, runs: region(11, 11) }, off = run(job(d, { thinKeep: false })), on = run(job(d, {}));
    const z = r => count(r.edit.data, (v, i) => i % 4 === 0 && v < 128);
    expect(z(on)).toBeGreaterThanOrEqual(14 * 14); expect(count(on.edit.data, (v, i) => i % 4 === 0 && v === 0)).toBeGreaterThanOrEqual(14 * 14);
    note('領域(切り取り)', '1ボクセルの切り取り', z(off), z(on));
  });
  it('a thick region is not changed (the processing mask bytes and the classification are identical)', () => {
    const d = { si: 0, mode: 'keep', maskOnly: true, runs: region(8, 27) }, off = run(job(d, { thinKeep: false })), on = run(job(d, {}));
    expect(Buffer.compare(Buffer.from(on.edit.data), Buffer.from(off.edit.data))).toBe(0); expect(Buffer.compare(Buffer.from(on.cls.data), Buffer.from(off.cls.data))).toBe(0);
    note('領域(厚い)', '厚い領域', count(off.edit.data, (v, i) => i % 4 === 0 && v >= 128), count(on.edit.data, (v, i) => i % 4 === 0 && v >= 128));
  });
});

// ---- a child segment (子セグメント) and an analysis result (解析結果)
describe('thin structures on the 256 copy: a child segment and an analysis result', () => {
  const dims = [20, 20, 20], src = [40, 40, 40], filler = new Uint8Array(20 * 20 * 20 * 2);
  const runs = (z0, z1) => runsOf(src, (x, y, z) => z >= z0 && z <= z1 && x >= 6 && x <= 33 && y >= 6 && y <= 33);
  const job = extra => ({ t: 'cls', id: 4, src: filler.slice().buffer, dims, calib: CAL, editDescs: [], editSourceDims: src, regionItems: [], childItems: [], order: ORDER, state: STATE(-5000, 5000), brickDimsFull: [1, 1, 1], brickDimsHalf: [3, 3, 3], mask: 1, ...extra });
  const childAt = (r, id) => { const rg = r.child.rg; return count({ length: rg.length / 2 }, (_, i) => rg[2 * i] === id); };
  for (const [a, b] of [[11, 11], [11, 12], [11, 13], [10, 10]]) it('a child of ' + (b - a + 1) + ' source voxel(s) (z ' + a + '..' + b + '): kept in its id and in its hide index', () => {
    const item = { key: 'c1', segMask: 1, runsBySlice: runs(a, b), hash: 'h' }, off = run(job({ childItems: [item], thinKeep: false })), on = run(job({ childItems: [item] }));
    expect(on.warnings).toEqual([]);
    expect(childAt(on, 1)).toBeGreaterThanOrEqual(14 * 14);
    const hideOn = count({ length: on.child.rg.length / 2 }, (_, i) => on.child.rg[2 * i + 1] === 1);
    expect(hideOn).toBeGreaterThanOrEqual(14 * 14);
    if (a === 11 && b === 11) expect(childAt(off, 1)).toBe(0);
    note('子セグメント', (b - a + 1) + 'ボクセル(z' + a + '-' + b + ')', childAt(off, 1), childAt(on, 1));
  });
  it('a thick child is not changed', () => {
    const item = { key: 'c1', segMask: 1, runsBySlice: runs(8, 27), hash: 'h' }, off = run(job({ childItems: [item], thinKeep: false })), on = run(job({ childItems: [item] }));
    expect(Buffer.compare(Buffer.from(on.child.rg), Buffer.from(off.child.rg))).toBe(0);
  });
  for (const [a, b] of [[11, 11], [11, 12], [11, 13]]) it('an analysis result of ' + (b - a + 1) + ' source voxel(s): already kept (the second pass of buildRegionIndexOf), before = after', () => {
    const item = { color: 0xff0000, segMask: 1, runsBySlice: runs(a, b), mm3: 1, segmentKeys: ['bone'], rid: 5 }, off = run(job({ regionItems: [item], thinKeep: false })), on = run(job({ regionItems: [item] }));
    const at = r => count({ length: r.region.rg.length / 2 }, (_, i) => r.region.rg[2 * i] === 1);
    expect(at(on)).toBeGreaterThanOrEqual(14 * 14); expect(at(off)).toBe(at(on)); expect(Buffer.compare(Buffer.from(on.region.rg), Buffer.from(off.region.rg))).toBe(0);
    note('解析結果', (b - a + 1) + 'ボクセル(z' + a + '-' + b + ')', at(off), at(on));
  });
});

// ---- not reduced: nothing changes
describe('thin structures: a grid that is not reduced (256 or less) is not changed', () => {
  it('the same bytes with and without thinKeep when the grid is the source grid', () => {
    const dims = [24, 24, 24], v = volumeOf(dims, (x, y, z) => (z === 11 && x > 3 && x < 20 && y > 3 && y < 20 ? BONE : AIR));
    const d = { si: 0, mode: 'keep', maskOnly: true, runs: runsOf(dims, (x, y, z) => z === 12 && x > 3 && x < 20 && y > 3 && y < 20) }, ch = { key: 'c', segMask: 1, runsBySlice: runsOf(dims, (x, y, z) => z === 5 && x > 3 && x < 20 && y > 3 && y < 20), hash: '' };
    const mk = x => ({ t: 'cls', id: 5, src: v.slice().buffer, dims, calib: CAL, editDescs: [d], editSourceDims: dims, regionItems: [], childItems: [ch], order: ORDER, state: STATE(), brickDimsFull: [3, 3, 3], brickDimsHalf: null, mask: 1, maskField: { ...PART_FIELD }, ...x });
    const a = run(mk({ thinKeep: false })), b = run(mk({}));
    for (const k of ['cls', 'dist']) expect(Buffer.compare(Buffer.from(a[k].data), Buffer.from(b[k].data))).toBe(0);
    expect(Buffer.compare(Buffer.from(a.edit.data), Buffer.from(b.edit.data))).toBe(0); expect(Buffer.compare(Buffer.from(a.child.rg), Buffer.from(b.child.rg))).toBe(0);
    note('(間引きなし)', '24^3 そのまま: 変わらない', count(a.cls.data, v => v >= 128), count(b.cls.data, v => v >= 128));
  });
});

describe('thin structures: inside the worker source (a fresh scope with only `self`, as a Blob worker)', () => {
  const rawSource = () => prepWorkerSource().replace(/\(0,\s*__vite_ssr_import_\d+__\.(\w+)\)/g, '$1').replace(/__vite_ssr_import_\d+__\./g, '');
  it('the volume job and the cls job give the same thin-keep bytes as prepRun on the calling thread (value range, mask, child, no warning)', () => {
    const posted = [], post = (m, tr) => posted.push(m), ws = new Function('self', rawSource() + '\nreturn { prepRun };')({ postMessage: post }); // prepRun of the worker's own scope (the job its message handler runs; as hidden-neighbour.test.js)
    const dims = [40, 40, 40], { h } = half(dims, sheet(11, 11)), src = [40, 40, 40];
    const base = x => ({ t: 'cls', id: 7, src: h.data.slice().buffer, ...srcExtra(h), dims: h.dims, calib: CAL, editDescs: [{ si: 0, mode: 'keep', maskOnly: false, runs: runsOf(src, (x, y, z) => z >= 10 && z <= 12 && x >= 6 && x <= 33 && y >= 6 && y <= 33) }], editSourceDims: src, regionItems: [], childItems: [{ key: 'c', segMask: 1, runsBySlice: runsOf(src, (x, y, z) => z === 11 && x >= 6 && x <= 33 && y >= 6 && y <= 33), hash: '' }], order: ORDER, state: STATE(), brickDimsFull: [1, 1, 1], brickDimsHalf: h.brickDims, mask: 1, maskField: { ...PART_FIELD }, ...x });
    const ref = run(base({}));
    ws.prepRun(base({}), post);
    const r = posted.at(-1); expect(r.t).toBe('cls'); expect(r.warnings).toEqual([]);
    expect(Buffer.compare(Buffer.from(r.cls.data), Buffer.from(ref.cls.data))).toBe(0); expect(Buffer.compare(Buffer.from(r.edit.data), Buffer.from(ref.edit.data))).toBe(0); expect(Buffer.compare(Buffer.from(r.child.rg), Buffer.from(ref.child.rg))).toBe(0);
    const vol = volumeOf(dims, sheet(11, 11)); ws.prepRun({ t: 'volume', id: 8, data: vol.buffer, dims, calib: CAL, brick: BRICK, half: true }, post);
    const vr = posted.at(-1); expect(vr.t).toBe('volume'); expect(vr.half.rangeHi).toBeUndefined(); // the extremes only make the bricks
  });
});

describe('thin structures: a source that was reduced on its way in (area average + nearest slice), the extremes come from the SOURCE voxels', () => {
  it('sourceRangeInit / sourceRangeAdd: every source voxel lands in the block of the grid the classification is made on (the half copy of the drawn grid), odd drawn grid included', () => {
    const src = [80, 60, 51], draw = [40, 30, 25], small = [20, 15, 12];
    const spans = (n, t) => { const a = new Uint32Array(t + 1); for (let i = 0; i <= t; i++) a[i] = Math.min(n, Math.round(i * n / t)); return a; };
    const acc = sourceRangeInit(src, draw, small, spans(80, 40), spans(60, 30)), v = volumeOf(src, (x, y, z) => ((x * 7 + y * 13 + z * 29) % 1500) - 400), eLo = new Uint16Array(20 * 15 * 12).fill(65535), eHi = new Uint16Array(20 * 15 * 12);
    for (let z = 0; z < src[2]; z++) sourceRangeAdd(acc, v.subarray(z * 80 * 60 * 2, (z + 1) * 80 * 60 * 2), z);
    for (let z = 0; z < src[2]; z++) for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) {
      const w = v[((z * 60 + y) * 80 + x) * 2] | (v[((z * 60 + y) * 80 + x) * 2 + 1] << 8), dz = Math.min(24, Math.floor(z * 25 / 51)), i = (Math.min(11, dz >> 1) * 15 + (y >> 2)) * 20 + (x >> 2);
      if (w < eLo[i]) eLo[i] = w; if (w > eHi[i]) eHi[i] = w;
    }
    expect(Buffer.compare(Buffer.from(acc.lo.buffer), Buffer.from(eLo.buffer))).toBe(0); expect(Buffer.compare(Buffer.from(acc.hi.buffer), Buffer.from(eHi.buffer))).toBe(0);
    expect(acc.lo.every(x => x < 65535)).toBe(true); // every block of the grid saw a source voxel (none is left empty)
  });
});

describe('thin structures: the diagnostic HU view (clsDiag, the classification is off)', () => {
  const huOf = (data, i, calib = CAL) => ((data[i * 2] | (data[i * 2 + 1] << 8)) - calib[2]) * calib[0] + calib[1];
  it('is a copy (the 256 copy itself is not changed) and does nothing without kept voxels', () => {
    const dims = [20, 20, 20], d = volumeOf(dims, () => AIR), copy = d.slice(), out = thinHuData(d, dims, [], CAL);
    expect(Buffer.compare(Buffer.from(out), Buffer.from(copy))).toBe(0); expect(out).not.toBe(d);
    thinHuData(d, dims, [{ lo: 300, hi: 4000, idx: Uint32Array.of(5 * 400 + 5 * 20 + 5) }], CAL); expect(Buffer.compare(Buffer.from(d), Buffer.from(copy))).toBe(0);
  });
});

describe('an earlier change: the shape bytes keep their 708 strength, no beads, nothing made up, no taking of another child\'s voxels', () => {
  const dims = [20, 20, 20], src = [20, 20, 20];
  it('classification bytes made with the smoothed mask field are the bytes made with the plain 0 / 255 mask (strength 250 stays 250); the mask texture is still smooth', () => {
    const v = volumeOf(src, () => BONE), runs = runsOf(src, (x, y, z) => z < 12 + (y >> 2)), d = [{ si: 0, mode: 'keep', maskOnly: false, runs }];
    const mk = x => ({ t: 'cls', id: 1, src: v.slice().buffer, dims, calib: CAL, editDescs: d, editSourceDims: src, regionItems: [], childItems: [], order: ORDER, state: STATE(), brickDimsFull: [3, 3, 3], brickDimsHalf: null, mask: 1, ...x });
    const plain = run(mk({})), smooth = run(mk({ maskField: { ...PART_FIELD } }));
    expect(smooth.edit.data.some((b, i) => i % 4 === 0 && b > 0 && b < 255)).toBe(true); // the shading field is smooth
    expect(Buffer.compare(Buffer.from(smooth.cls.data), Buffer.from(plain.cls.data))).toBe(0); // the shape bytes are not
    expect(count(smooth.cls.data, b => b >= 128 && b < 160)).toBe(count(plain.cls.data, b => b >= 128 && b < 160));
  });
  it('a thin child never takes a voxel of another child', () => {
    const runs = (z0, z1) => runsOf(src, (x, y, z) => z >= z0 && z <= z1 && x >= 2 && x <= 17 && y >= 2 && y <= 17), big = { key: 'a', segMask: 1, runsBySlice: runsOf([40, 40, 40], (x, y, z) => z >= 4 && z <= 33 && x >= 4 && x <= 33 && y >= 4 && y <= 33), hash: '' }, thin = { key: 'b', segMask: 1, runsBySlice: runsOf([40, 40, 40], (x, y, z) => z === 21 && x >= 10 && x <= 29 && y >= 10 && y <= 29), hash: '' };
    void runs;
    const base = x => ({ t: 'cls', id: 1, src: new Uint8Array(20 * 20 * 20 * 2).buffer, dims, calib: CAL, editDescs: [], editSourceDims: [40, 40, 40], regionItems: [], childItems: [big, thin], order: ORDER, state: STATE(-5000, 5000), brickDimsFull: [1, 1, 1], brickDimsHalf: [3, 3, 3], mask: 1, ...x });
    const off = run(base({ thinKeep: false })), on = run(base({}));
    for (let i = 0; i < off.child.rg.length / 2; i++) if (off.child.rg[2 * i] !== 0) expect(on.child.rg[2 * i]).toBe(off.child.rg[2 * i]); // 0 voxels changed that anyone owned
  });
});

describe('n733: a segment drawn by a value range has no thin-keep (no noise)', () => {
  it('an isolated source voxel / line in the range is NOT set on the 256 copy, with or without the source grid handed to the job (the bytes are those of thinKeep: false)', () => {
    const dims = [40, 40, 40], { h } = half(dims, (x, y, z) => ((x === 9 && y === 9) || (x === 25 && y === 25 && z === 25) ? BONE : AIR));
    const a = run(clsJob(h, { thinKeep: false })), b = run(clsJob(h, {})), c = run(clsJob(h, { ...srcExtra(h) }));
    expect(b.warnings).toEqual([]); expect(c.warnings).toEqual([]);
    expect(count(c.cls.data, v => v >= 128)).toBe(0); expect(c.thin).toEqual([]);
    for (const r of [b, c]) expect(Buffer.compare(Buffer.from(r.cls.data), Buffer.from(a.cls.data))).toBe(0);
  });
  it('a 1-voxel sheet of the range that the reduction lost stays lost (nothing is made up)', () => {
    const { h } = half([40, 40, 40], (x, y, z) => (z === 11 && x >= 6 && x <= 33 && y >= 6 && y <= 33 ? BONE : AIR)), r = run(clsJob(h, { ...srcExtra(h) }));
    expect(count(r.cls.data, v => v === 255)).toBe(0);
  });
});

describe('thin-keep helpers', () => {
  it('halveRangeOf: block extremes of the source words, the odd last slice folded in', () => {
    const dims = [5, 4, 3], v = volumeOf(dims, (x, y, z) => x * 10 + y + z * 100), r = halveRangeOf(v, dims), hv = halveData(v, dims);
    expect(hv.dims).toEqual([2, 2, 1]); expect(r.lo).toHaveLength(4);
    const word = (x, y, z) => v[((z * 4 + y) * 5 + x) * 2] | (v[((z * 4 + y) * 5 + x) * 2 + 1] << 8);
    expect(r.lo[0]).toBe(Math.min(word(0, 0, 0), word(1, 1, 1), word(0, 0, 2))); expect(r.hi[3]).toBe(Math.max(word(4, 3, 2), word(2, 2, 0)));
  });
  it('halveData with the range = halveRangeOf (odd dims included), and the data are the same bytes', () => {
    for (const dims of [[5, 4, 3], [8, 6, 4], [7, 9, 11]]) { const v = volumeOf(dims, (x, y, z) => x * 10 + y * 3 + z * 100 + ((x * y + z) % 7)), a = halveData(v, dims, true), b = halveRangeOf(v, dims), c = halveData(v, dims); expect(Array.from(a.lo)).toEqual(Array.from(b.lo)); expect(Array.from(a.hi)).toEqual(Array.from(b.hi)); expect(Buffer.compare(Buffer.from(a.data), Buffer.from(c.data))).toBe(0); }
  });
  it('thinKeepOf: a thick block yields nothing; a flat sheet yields every voxel', () => {
    const dims = [8, 8, 8], U = new Uint8Array(512), thick = new Uint8Array(512); for (let i = 0; i < 512; i++) { const x = i % 8, y = (i >> 3) % 8, z = i >> 6; if (z === 4) U[i] = 1; if (x >= 2 && x < 6 && y >= 2 && y < 6 && z >= 2 && z < 6) thick[i] = 1; }
    expect(thinKeepOf(thick, i => thick[i] === 1, dims)).toHaveLength(0); // a body the reduction kept is never changed
    expect(thinKeepOf(U, () => false, dims)).toHaveLength(64);
  });
  it('coverRunsOnGrid: an odd, non-2:1 ratio never writes outside the grid and covers every source voxel', () => {
    const src = [37, 23, 19], dims = [11, 7, 6], U = coverRunsOnGrid(runsOf(src, () => true), src, dims, new Uint8Array(11 * 7 * 6)); expect(count(U, v => v === 1)).toBe(11 * 7 * 6);
    const one = coverRunsOnGrid(runsOf(src, (x, y, z) => x === 36 && y === 22 && z === 18), src, dims, new Uint8Array(11 * 7 * 6)); expect(U[11 * 7 * 6 - 1]).toBe(1); expect(count(one, v => v === 1)).toBeGreaterThanOrEqual(1);
  });
  it('the worker source carries every helper (the unit tests run on the calling thread; a missing name would only fail inside the Worker, where the catch turns it into a warning)', () => {
    const text = prepWorkerSource();
    for (const n of ['halveRangeOf', 'computeBricksRangeOf', 'coverRunsOnGrid', 'thinKeepOf', 'forceThinMask', 'applyThinCls', 'finishChildIndex']) expect(text).toMatch(new RegExp('function ' + n + '\\('));
    expect(text).not.toMatch(/^\s*(import|export)\s/m);
  });
  it('REPORT', () => { if (process.env.REPORT) console.log('\n' + rows.map(r => [r.kind, r.what, '前 ' + r.before, '後 ' + r.after].join(' | ')).join('\n')); });
});
