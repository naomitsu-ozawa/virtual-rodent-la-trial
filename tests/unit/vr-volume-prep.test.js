import { describe, it, expect } from 'vitest';
import { computeBricksOf, halveData, buildDistanceBytesSync, buildEditMaskOf, buildRegionIndexOf, prepRun, prepWorkerSource, createVolumePrep, BRICK } from '../../docs/vr-volume-prep.js';
import { gpuRunsForTexture } from '../../docs/gpu-runs.js';
import { buildClsData } from '../../docs/point-cls.js';
import { buildDistanceBytes, combineClassificationDistance, fourthChannelBytes } from '../../docs/distance-field.js';
import { brickOccupancy } from '../../docs/vr-brick-occupancy.js';

// the heavy pure steps of the VR preparation run in a worker (switching the data inside a running session must not stall the frames). Each of them must give
// BYTE-IDENTICAL results to the synchronous code it replaced (the reference versions below are that code as it was in vr-view.js), the worker's source must be
// self-contained (it is made from the function texts), and the main-thread side must hand buffers over and take them back.

// ---- the reference: vr-view.js computeBricks / halveVolume before (verbatim, with BRICK = 8)
function refBricks(data, [tw, th, td], [slope, intercept, bias]) {
  const bx = Math.ceil(tw / BRICK), by = Math.ceil(th / BRICK), bz = Math.ceil(td / BRICK), mm = new Float32Array(bx * by * bz * 4);
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    let lo = 65535, hi = 0;
    const z0 = Math.max(0, k * BRICK - 1), z1 = Math.min(td, (k + 1) * BRICK + 1), y0 = Math.max(0, j * BRICK - 1), y1 = Math.min(th, (j + 1) * BRICK + 1), x0 = Math.max(0, i * BRICK - 1), x1 = Math.min(tw, (i + 1) * BRICK + 1);
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) { let o = (z * th + y) * tw * 2 + x0 * 2; for (let x = x0; x < x1; x++, o += 2) { const w = data[o] | (data[o + 1] << 8); if (w < lo) lo = w; if (w > hi) hi = w; } }
    const b = ((k * by + j) * bx + i) * 4, a = (lo - bias) * slope + intercept, c = (hi - bias) * slope + intercept; mm[b] = Math.min(a, c); mm[b + 1] = Math.max(a, c);
  }
  return { bricks: mm, brickDims: [bx, by, bz] };
}
function refHalve(vd) {
  const [w, h, d] = vd.dims, tw = Math.max(1, w >> 1), th = Math.max(1, h >> 1), td = Math.max(1, d >> 1), src = vd.data, out = new Uint8Array(tw * th * td * 2);
  for (let z = 0; z < td; z++) for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let acc = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) { const o = (((z * 2 + dz) * h + (y * 2 + dy)) * w + x * 2) * 2; acc += (src[o] | (src[o + 1] << 8)) + (src[o + 2] | (src[o + 3] << 8)); }
    const v = Math.round(acc / 8), o = ((z * th + y) * tw + x) * 2; out[o] = v & 255; out[o + 1] = v >> 8;
  }
  return { data: out, dims: [tw, th, td] };
}
// the processing mask and the analysis index as vr-view.js built them on the page (verbatim, with the page state replaced by the arguments)
function refEditMask(descs, sourceDims, dims) { // descs: {key: {mode, maskOnly, runs}}, slot order = the keys' order
  const [w, h, d] = dims, reduced = w !== sourceDims[0] || h !== sourceDims[1] || d !== sourceDims[2];
  let activeMask = 0, maskOnly = 0, data = null;
  Object.keys(descs).forEach((key, si) => {
    const desc = descs[key]; if (!desc?.runs) return;
    const runs = gpuRunsForTexture(desc.runs, sourceDims, dims, { dilate: reduced && desc.mode === 'exclude' ? 1 : 0 });
    data ||= new Uint8Array(w * h * d * 4); activeMask |= 1 << si; if (desc.maskOnly) maskOnly |= 1 << si;
    const on = desc.mode === 'exclude' ? 0 : 255;
    if (desc.mode === 'exclude') for (let i = si; i < data.length; i += 4) data[i] = 255;
    for (let z = 0; z < d; z++) { const rec = runs?.[z]; if (!rec?.length) continue; for (let i = 0; i < rec.length; i += 3) { const o = (z * h + rec[i]) * w; for (let x = rec[i + 1]; x <= rec[i + 2]; x++) data[(o + x) * 4 + si] = on; } }
  });
  return { activeMask, maskOnly, data };
}
function refRegionIndex(regions, slotKeys, sourceDims, dims) { // regions: [{color, segmentKeys, runsBySlice, mm3, id}]
  if (!regions.length) return { data: null, colors: [], segs: [], list: [] };
  const [w, h, d] = dims, colors = [], segs = [], data = new Uint8Array(w * h * d), ids = new Uint8Array(w * h * d), list = [];
  for (const r of regions) {
    const c = Number(r.color) >>> 0; let k = colors.indexOf(c); if (k < 0) { if (colors.length >= 14) continue; colors.push(c); segs.push(0); k = colors.length - 1; }
    for (const key of r.segmentKeys || []) { const s = slotKeys.indexOf(key); if (s >= 0) segs[k] |= 1 << s; }
    const runs = gpuRunsForTexture(r.runsBySlice, sourceDims, dims, { dilate: 0 });
    if (list.length >= 255) break; const id = list.length + 1;
    for (let z = 0; z < d; z++) { const rec = runs?.[z]; if (!rec?.length) continue; for (let i = 0; i < rec.length; i += 3) { const o = (z * h + rec[i]) * w; data.fill(k + 1, o + rec[i + 1], o + rec[i + 2] + 1); ids.fill(id, o + rec[i + 1], o + rec[i + 2] + 1); } }
    list.push({ color: c, mm3: r.mm3, segmentKeys: [...(r.segmentKeys || [])], rid: r.id });
  }
  return { data: colors.length ? data : null, ids: colors.length ? ids : null, colors, segs, list };
}
// runs of a blob-ish mask: per z slice [y, x0, x1] triples (Uint32Array like the run builders'), a different shape per seed
function blobRuns(dims, seed) {
  const [w, h, d] = dims, out = [];
  for (let z = 0; z < d; z++) { const r = []; for (let y = 0; y < h; y++) { const x0 = (seed * 3 + y + z) % Math.max(1, w >> 1), x1 = Math.min(w - 1, x0 + 2 + ((y * seed + z) % Math.max(1, w >> 1))); if ((y + z + seed) % 3) r.push(y, x0, x1); } out.push(new Uint32Array(r)); }
  return out;
}
// a deterministic rg8 u16 volume (a blob and some structure; odd sizes too)
function volume(dims, seed = 1) {
  const [w, h, d] = dims, data = new Uint8Array(w * h * d * 2);
  let s = seed;
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const r = Math.hypot(x - w / 2, y - h / 2, z - d / 2), v = Math.max(0, Math.min(65535, Math.round(1024 + (r < Math.min(w, h, d) / 3 ? 1500 : 0) + (z * 31) % 400 + (s >> 16) % 60)));
    const o = ((z * h + y) * w + x) * 2; data[o] = v & 255; data[o + 1] = v >> 8;
  }
  return data;
}
const CAL = [1, -1024, 0];
const same = (a, b) => { expect(a.length).toBe(b.length); expect(Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength))).toBe(0); };

describe('computeBricksOf / halveData = the code they replace', () => {
  for (const dims of [[16, 16, 16], [19, 11, 13], [40, 24, 9]]) {
    it('bricks of ' + dims.join('x'), () => {
      const d = volume(dims), a = computeBricksOf(d, dims, CAL, BRICK), b = refBricks(d, dims, CAL);
      expect(a.brickDims).toEqual(b.brickDims); same(a.bricks, b.bricks);
      const sg = computeBricksOf(d, dims, [2, 5, 32768], BRICK), rg = refBricks(d, dims, [2, 5, 32768]); same(sg.bricks, rg.bricks); // slope / signed bias too
    });
    it('half copy of ' + dims.join('x'), () => {
      const d = volume(dims, 7), a = halveData(d, dims), b = refHalve({ data: d, dims });
      expect(a.dims).toEqual(b.dims); same(a.data, b.data);
    });
  }
  it('a thin axis keeps one voxel (max(1, n >> 1))', () => { expect(halveData(volume([8, 1, 4]), [8, 1, 4]).dims).toEqual([4, 1, 2]); });
});

describe('buildEditMaskOf / buildRegionIndexOf = what the page built', () => {
  const dims = [20, 16, 12];
  it('the processing mask: same grid, a reduced grid (exclude runs dilated), mask-only flags, no runs -> no data', () => {
    const descs = { bone: { mode: 'exclude', maskOnly: false, runs: blobRuns([40, 32, 24], 1) }, soft: { mode: 'keep', maskOnly: true, runs: blobRuns([40, 32, 24], 2) }, fat: { mode: 'keep', maskOnly: false, runs: null } };
    for (const src of [[40, 32, 24], dims]) {
      const sd = { bone: { ...descs.bone, runs: blobRuns(src, 1) }, soft: { ...descs.soft, runs: blobRuns(src, 2) }, fat: descs.fat };
      const list = Object.keys(sd).map((k, si) => sd[k].runs ? { si, mode: sd[k].mode, maskOnly: sd[k].maskOnly, runs: sd[k].runs } : null).filter(Boolean);
      const a = buildEditMaskOf(list, src, dims), b = refEditMask(sd, src, dims);
      expect(a.activeMask).toBe(b.activeMask); expect(a.maskOnly).toBe(b.maskOnly); same(a.data, b.data);
    }
    expect(buildEditMaskOf([], dims, dims)).toEqual({ activeMask: 0, maskOnly: 0, data: null });
  });
  it('the analysis index: colours shared, the 14-colour cap, the 255-result cap, an overlap won by the later result', () => {
    const slot = ['bone', 'soft', 'fat', 'lung'], mk = (n, colorOf, keysOf) => Array.from({ length: n }, (_, i) => ({ color: colorOf(i), segmentKeys: keysOf(i), runsBySlice: blobRuns(dims, i % 7 + 1), mm3: i + 0.5, id: i + 1 }));
    const items = rs => rs.map(r => ({ color: r.color, segMask: r.segmentKeys.reduce((m, k) => m | (1 << slot.indexOf(k)), 0), runsBySlice: r.runsBySlice, mm3: r.mm3, segmentKeys: r.segmentKeys, rid: r.id }));
    for (const rs of [mk(3, i => 0xff0000 + (i % 2), i => [slot[i % 4]]), mk(20, i => 0x100 + i, i => ['bone']), mk(260, i => 0x10 + (i % 5), i => ['soft', 'lung'])]) {
      const a = buildRegionIndexOf(items(rs), dims, dims), b = refRegionIndex(rs, slot, dims, dims);
      expect(a.colors).toEqual(b.colors); expect(a.segs).toEqual(b.segs); expect(a.list).toEqual(b.list); same(a.data, b.data); same(a.ids, b.ids);
    }
    expect(buildRegionIndexOf([], dims, dims)).toEqual({ data: null, colors: [], segs: [], list: [] });
    expect(buildRegionIndexOf(items(mk(20, i => i, () => ['bone'])), dims, dims).colors).toHaveLength(14);
    expect(buildRegionIndexOf(items(mk(260, () => 1, () => ['bone'])), dims, dims).list).toHaveLength(255);
  });
});

const SEGS = { order: ['bone', 'soft', 'fat', 'lung'], state: { bone: { active: true, enabled: true, min: 1200, max: 4000 }, soft: { active: true, enabled: true, min: 1024, max: 1300 }, fat: { active: true, enabled: false, min: 900, max: 1100 }, lung: { active: false, enabled: false, min: 0, max: 10 } } };
const stateOf = (n) => { // n segments stored (active + enabled), in slot order
  const out = {}; ['bone', 'soft', 'fat', 'lung'].forEach((k, i) => { out[k] = { ...SEGS.state[k], active: i < n, enabled: i < n }; }); return out;
};
function edit(dims, active, maskOnly) { const n = dims[0] * dims[1] * dims[2], data = new Uint8Array(n * 4); for (let i = 0; i < n; i++) for (let s = 0; s < 4; s++) data[i * 4 + s] = ((i * 7 + s * 13) % 5) ? 255 : 0; return { data, dims, active, maskOnly }; }

describe('buildDistanceBytesSync = buildDistanceBytes', () => {
  it('the same bytes for 1, 2 and 4 channels (and the progress goes through every channel)', async () => {
    const dims = [14, 12, 10];
    for (const n of [1, 2, 4]) {
      const t = { dims, data: volume(dims, 3) }, st = stateOf(n), cls = buildClsData(t, CAL, { data: null, dims, active: 0, maskOnly: 0 }, st, SEGS.order);
      const a = await buildDistanceBytes(cls, dims), calls = [], b = buildDistanceBytesSync(cls, dims, (x, y) => calls.push([x, y]));
      expect(b.C).toBe(a.C); expect(b.chan).toEqual(a.chan); same(b.data, a.data);
      expect(calls[0]).toEqual([0, cls.C]); expect(calls.at(-1)).toEqual([cls.C, cls.C]); expect(calls).toHaveLength(cls.C + 1);
    }
  });
});

describe('prepRun: the worker jobs', () => {
  const run = m => { const out = []; prepRun(m, (msg, tr) => out.push({ msg, tr })); return out; };
  it("'volume': bricks of the grid and of the 256 copy, the input buffer comes back", () => {
    const dims = [20, 14, 10], data = volume(dims, 5), copy = data.slice(), out = run({ t: 'volume', id: 3, data: data.buffer, dims, calib: CAL, brick: BRICK, half: true });
    expect(out).toHaveLength(1);
    const { msg, tr } = out[0];
    expect(msg.t).toBe('volume'); expect(msg.id).toBe(3); expect(msg.data).toBe(data.buffer); expect(tr).toContain(data.buffer);
    same(new Uint8Array(msg.data), copy);
    same(msg.bricks, refBricks(copy, dims, CAL).bricks); expect(msg.brickDims).toEqual(refBricks(copy, dims, CAL).brickDims);
    const h = refHalve({ data: copy, dims });
    expect(msg.half.dims).toEqual(h.dims); same(msg.half.data, h.data); same(msg.half.bricks, refBricks(h.data, h.dims, CAL).bricks);
    for (const b of [msg.bricks, msg.half.data, msg.half.bricks]) expect(tr).toContain(b.buffer);
    expect(run({ t: 'volume', id: 4, data: copy.slice().buffer, dims, calib: CAL, brick: BRICK, half: false })[0].msg.half).toBe(null);
  });
  for (const [n, srcDims] of [[1, [18, 12, 10]], [3, [36, 24, 20]], [4, [36, 24, 20]]]) {
    it("'cls' with " + n + ' stored segment(s), the mask / index built on a ' + (srcDims[0] === 18 ? 'same' : 'reduced') + ' grid: processing mask, analysis index, classification, distance field, combined bytes, occupancy; the input comes back', () => {
      const dims = [18, 12, 10], src = volume(dims, 11), srcCopy = src.slice(), st = stateOf(n);
      const descs = { bone: { mode: 'exclude', maskOnly: false, runs: blobRuns(srcDims, 1) }, soft: n >= 2 ? { mode: 'keep', maskOnly: true, runs: blobRuns(srcDims, 2) } : null, fat: null, lung: n >= 4 ? { mode: 'keep', maskOnly: false, runs: blobRuns(srcDims, 5) } : null };
      const editDescs = Object.keys(descs).map((key, si) => descs[key]?.runs ? { si, mode: descs[key].mode, maskOnly: descs[key].maskOnly, runs: descs[key].runs } : null).filter(Boolean);
      const regions = [{ color: 0xff3300, segmentKeys: ['bone'], runsBySlice: blobRuns(srcDims, 3), mm3: 1.5, id: 7 }, { color: 0x2255ff, segmentKeys: ['soft', 'fat'], runsBySlice: blobRuns(srcDims, 4), mm3: 2.5, id: 8 }, { color: 0xff3300, segmentKeys: ['lung'], runsBySlice: blobRuns(srcDims, 6), mm3: 0.5, id: 9 }];
      const regionItems = regions.map(r => ({ color: r.color, segMask: r.segmentKeys.reduce((m, k) => m | (1 << ['bone', 'soft', 'fat', 'lung'].indexOf(k)), 0), runsBySlice: r.runsBySlice, mm3: r.mm3, segmentKeys: r.segmentKeys, rid: r.id }));
      const bricksFull = refBricks(volume([36, 24, 20], 2), [36, 24, 20], CAL), bricksHalf = refBricks(srcCopy, dims, CAL), mask = n >= 2 ? 3 : 1;
      const out = run({ t: 'cls', id: 9, src: src.buffer, dims, calib: CAL, editDescs, editSourceDims: srcDims, regionItems, order: SEGS.order, state: st, brickDimsFull: bricksFull.brickDims, brickDimsHalf: bricksHalf.brickDims, mask });
      const r = out.at(-1).msg;
      expect(r.t).toBe('cls'); expect(r.warnings).toEqual([]);
      // the processing mask and the analysis index = what the page built (the reference above)
      const rm = refEditMask(descs, srcDims, dims); // a segment without runs keeps its slot (the page's forEach index)
      expect(r.edit.active).toBe(rm.activeMask); expect(r.edit.maskOnly).toBe(rm.maskOnly); same(r.edit.data, rm.data);
      const rr = refRegionIndex(regions, ['bone', 'soft', 'fat', 'lung'], srcDims, dims);
      same(r.region.data, rr.data); same(r.region.ids, rr.ids); expect(r.region.colors).toEqual(rr.colors); expect(r.region.segs).toEqual(rr.segs); expect(r.region.list).toEqual(rr.list);
      const edit = { data: rm.data, dims, active: rm.activeMask, maskOnly: rm.maskOnly };
      const cls = buildClsData({ dims, data: srcCopy }, CAL, edit, st, SEGS.order);
      same(r.cls.data, cls.data); expect(r.cls.C).toBe(cls.C); expect(r.cls.chan).toEqual(cls.chan);
      const dist = buildDistanceBytesSync(cls, dims); same(r.dist.data, dist.data);
      const four = cls.chan.includes(3);
      same(r.combo, combineClassificationDistance(cls, dist, mask, null, { four }));
      if (four) same(r.cls4, fourthChannelBytes(cls)); else expect(r.cls4).toBe(null);
      const occ = brickOccupancy(edit, bricksFull.brickDims);
      if (occ) same(r.occFull, occ); else expect(r.occFull).toBe(null);
      same(new Uint8Array(r.src), srcCopy);
      expect(out.filter(o => o.msg.t === 'progress').length).toBe(cls.C + 1);
    });
  }
  it("'cls' with no stored segment: nothing to classify (null), no distance, still the inputs back", () => {
    const dims = [8, 8, 8], src = volume(dims), out = run({ t: 'cls', id: 1, src: src.buffer, dims, calib: CAL, editDescs: [], editSourceDims: dims, regionItems: [], order: SEGS.order, state: stateOf(0), brickDimsFull: [1, 1, 1], brickDimsHalf: null, mask: 0 });
    const r = out.at(-1).msg; expect(r.cls).toBe(null); expect(r.dist).toBe(null); expect(r.combo).toBe(null); expect(r.edit).toEqual({ data: null, active: 0, maskOnly: 0 }); expect(r.region.data).toBe(null); expect(r.src).toBe(src.buffer);
  });
  it('an exception is answered as an error message (never thrown into the worker loop)', () => {
    const out = run({ t: 'volume', id: 8, data: new ArrayBuffer(4), dims: null, calib: CAL, brick: 8, half: false });
    expect(out[0].msg).toMatchObject({ t: 'error', id: 8 }); expect(out[0].msg.message.length).toBeGreaterThan(0);
    expect(run({ t: 'nope', id: 2 })[0].msg).toMatchObject({ t: 'error', id: 2 });
  });
});

// the source as the browser makes it (Function.prototype.toString of native modules). vitest's SSR transform rewrites the calls of imported functions to
// `(0, __vite_ssr_import_N__.name)(...)`; undoing that gives the text a browser has
const rawSource = () => prepWorkerSource().replace(/\(0,\s*__vite_ssr_import_\d+__\.(\w+)\)/g, '$1').replace(/__vite_ssr_import_\d+__\./g, '');
describe('the worker source is self-contained', () => {
  // the source runs in a fresh function scope with only `self` defined: exactly what a Blob worker has
  const boot = () => {
    const posted = [];
    const self = { postMessage: (m, tr) => posted.push({ m, tr }) };
    new Function('self', rawSource())(self);
    return { self, posted };
  };
  it("answers a 'volume' job with the same bytes as the module's own prepRun", () => {
    const { self, posted } = boot();
    const dims = [20, 14, 10], d = volume(dims, 5), copy = d.slice();
    self.onmessage({ data: { t: 'volume', id: 1, data: d.buffer, dims, calib: CAL, brick: BRICK, half: true } });
    const m = posted[0].m;
    same(m.bricks, refBricks(copy, dims, CAL).bricks); same(m.half.data, refHalve({ data: copy, dims }).data);
  });
  it("answers a 'cls' job (all four stored: the fourth channel too) with the same bytes", () => {
    const { self, posted } = boot();
    const dims = [14, 12, 10], src = volume(dims, 4), copy = src.slice(), st = stateOf(4);
    const descs = [{ si: 0, mode: 'exclude', maskOnly: false, runs: blobRuns([28, 24, 20], 1) }, { si: 1, mode: 'keep', maskOnly: true, runs: blobRuns([28, 24, 20], 2) }];
    const items = [{ color: 0x123456, segMask: 3, runsBySlice: blobRuns([28, 24, 20], 3), mm3: 1, segmentKeys: ['bone', 'soft'], rid: 4 }];
    self.onmessage({ data: { t: 'cls', id: 2, src: src.buffer, dims, calib: CAL, editDescs: descs, editSourceDims: [28, 24, 20], regionItems: items, order: SEGS.order, state: st, brickDimsFull: [2, 2, 2], brickDimsHalf: null, mask: 15 } });
    const r = posted.at(-1).m, em = buildEditMaskOf(descs, [28, 24, 20], dims), cls = buildClsData({ dims, data: copy }, CAL, { data: em.data, dims, active: em.activeMask, maskOnly: em.maskOnly }, st, SEGS.order), dist = buildDistanceBytesSync(cls, dims);
    same(r.cls.data, cls.data); same(r.dist.data, dist.data); same(r.combo, combineClassificationDistance(cls, dist, 15, null, { four: true })); same(r.cls4, fourthChannelBytes(cls)); same(r.edit.data, em.data);
    same(r.region.data, buildRegionIndexOf(items, [28, 24, 20], dims).data);
  });
  it('has no import / export statement and no outer name left unresolved', () => { expect(rawSource()).not.toMatch(/^\s*(import|export)\s/m); expect(rawSource()).not.toContain('__vite_ssr'); });
});

describe('createVolumePrep (the main-thread side)', () => {
  // a fake worker: runs the real worker source in a function scope, answers asynchronously like a worker
  const fakeWorker = () => {
    const w = { onmessage: null, onerror: null, terminated: false, sent: [] };
    const self = { postMessage: (m) => setTimeout(() => w.onmessage && w.onmessage({ data: m }), 0) };
    new Function('self', rawSource())(self);
    w.postMessage = (m, tr) => { w.sent.push({ m, tr }); setTimeout(() => self.onmessage({ data: m }), 0); };
    w.terminate = () => { w.terminated = true; };
    return w;
  };
  it('hands the buffers over (transfer list) and resolves with the worker answer; progress reaches the caller; dispose ends the worker', async () => {
    let w = null; const prep = createVolumePrep({ makeWorker: () => (w = fakeWorker()) });
    const dims = [20, 14, 10], d = volume(dims, 5), copy = d.slice();
    const r = await prep.volume({ data: d.buffer, dims, calib: CAL, brick: BRICK, half: true });
    expect(w.sent[0].tr).toEqual([d.buffer]); same(r.bricks, refBricks(copy, dims, CAL).bricks);
    const seen = [], cdims = [10, 10, 8], src = volume(cdims, 2);
    const c = await prep.cls({ src: src.buffer, dims: cdims, calib: CAL, editDescs: [], editSourceDims: cdims, regionItems: [], order: SEGS.order, state: stateOf(2), brickDimsFull: [2, 2, 1], brickDimsHalf: null, mask: 3 }, (a, b) => seen.push([a, b]));
    expect(c.cls.C).toBe(2); expect(seen.at(-1)).toEqual([2, 2]);
    expect(prep.stats).toEqual({ worker: 2, local: 0 }); // the device log says whether the worker ran
    prep.dispose(); expect(w.terminated).toBe(true);
    await expect(prep.volume({ data: new ArrayBuffer(8), dims: [1, 1, 1], calib: CAL, brick: 8, half: false })).rejects.toThrow(/disposed/);
  });
  it('without a worker the same job runs on this thread', async () => {
    const prep = createVolumePrep({ makeWorker: () => null }), dims = [12, 12, 12], d = volume(dims, 8), copy = d.slice();
    const r = await prep.volume({ data: d.buffer, dims, calib: CAL, brick: BRICK, half: true });
    same(r.bricks, refBricks(copy, dims, CAL).bricks); same(r.half.data, refHalve({ data: copy, dims }).data);
    expect(prep.stats).toEqual({ worker: 0, local: 1 });
    prep.dispose();
  });
  it('an error answer rejects the call; dispose rejects what is still pending', async () => {
    const prep = createVolumePrep({ makeWorker: () => null });
    await expect(prep.volume({ data: new ArrayBuffer(4), dims: null, calib: CAL, brick: 8, half: false })).rejects.toThrow();
    let w = null; const p2 = createVolumePrep({ makeWorker: () => (w = { postMessage() {}, terminate() {}, onmessage: null, onerror: null }) });
    const pending = p2.volume({ data: new ArrayBuffer(8), dims: [1, 1, 1], calib: CAL, brick: 8, half: false });
    p2.dispose(); await expect(pending).rejects.toThrow(/disposed/);
    // a worker that dies fails its job (the transferred buffers went with it)
    let w3 = null; const p3 = createVolumePrep({ makeWorker: () => (w3 = { postMessage() {}, terminate() {}, onmessage: null, onerror: null }) });
    const dead = p3.volume({ data: new ArrayBuffer(8), dims: [1, 1, 1], calib: CAL, brick: 8, half: false });
    w3.onerror({ message: 'boom' }); await expect(dead).rejects.toThrow(/boom/);
  });
});
