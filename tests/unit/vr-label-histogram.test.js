import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LABELS, UNLABELED, slotLabel, regionLabel, labelSlot, labelRegion, slotPicks, labelAt, binLut, axisMap, labelWorkerMain, createLabelCountClient, countsToHists, createVrLabelHistogram, passPlan, POOL_SLICES, sameResult } from '../../docs/vr-label-histogram.js';
import { buildClsData } from '../../docs/point-cls.js';
import { histCount, HIST_MIN, HIST_BINS } from '../../docs/histogram.js';
import { accToHist } from '../../docs/histogram-texture.js';

// build 567: the label of a voxel on the VR board is the one the VR shader draws (vr-view.js segmentIndexAt: segmentIndexFromQ on the classification
// path, the HU test + edit mask on the HU path; regionColor), from the data the VR session uses, never a guess.
// a "volume" of HU values, packed as the VR texture (rg8, u16 = HU + 1024)
function grid(hus, dims = [hus.length, 1, 1], calibration = [1, -1024, 0]) {
  const data = new Uint8Array(hus.length * 2);
  hus.forEach((h, i) => { const u = Math.round((h - calibration[1]) / calibration[0] + calibration[2]); data[2 * i] = u & 255; data[2 * i + 1] = u >> 8; });
  return { data, dims, calibration };
}
const u16 = g => new Uint16Array(g.data.buffer);
// the first index where two typed arrays differ (-1: equal): toEqual on long arrays is slow
const diff = (a, b) => { if (!a || !b) return a === b ? -1 : -3; if (a.length !== b.length) return -2; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
const sameHists = (a, b) => { for (let L = 0; L < LABELS; L++) { const d = diff(a.hists[L], b.hists[L]); if (d !== -1) return 'label ' + L + ': ' + d; } return diff(a.total, b.total) === -1 ? 'same' : 'total'; };
const perLabel = r => r.hists.map(h => (h ? histCount(h) : 0));

describe('labels: the VR shader rule (classification path)', () => {
  it('label ids', () => {
    expect(labelSlot(slotLabel(2))).toBe(2); expect(labelRegion(regionLabel(13))).toBe(13); expect(labelSlot(UNLABELED)).toBe(-1); expect(LABELS).toBe(19);
  });
  // slots: 0 = bone, 1 = soft (both shown); soft's range overlaps bone's (overlaps allowed, 'off' mode)
  const segs = { bone: { active: true, enabled: true, min: 100, max: 1000 }, soft: { active: true, enabled: true, min: -100, max: 300 }, fat: { active: false, enabled: false, min: 0, max: 0 }, lung: { active: false, enabled: false, min: 0, max: 0 } };
  const g = grid([-500, 0, 200, 500, 2000]);
  const noEdit = { data: null, dims: g.dims, active: 0, maskOnly: 0 };
  it('overlap: the first shown slot wins (priority), unlabeled is 0 (gray)', () => {
    const cls = buildClsData(g, g.calibration, noEdit, segs), picks = slotPicks(cls.chan, 0b11);
    expect([0, 1, 2, 3, 4].map(i => labelAt(i, cls.data, cls.C, picks, null, null))).toEqual([UNLABELED, slotLabel(1), slotLabel(0), slotLabel(0), UNLABELED]);
  });
  it('a slot hidden in VR falls through to the next one; nothing shown = all unlabeled', () => {
    const cls = buildClsData(g, g.calibration, noEdit, segs);
    expect(labelAt(2, cls.data, cls.C, slotPicks(cls.chan, 0b10), null, null)).toBe(slotLabel(1)); // bone hidden: soft takes 200 HU
    expect(labelAt(2, cls.data, cls.C, slotPicks(cls.chan, 0), null, null)).toBe(UNLABELED);
  });
  it('the card priority (seg.min / max already trimmed by segment-exclusive.js) decides the label, not the user range', () => {
    const trimmed = { ...segs, soft: { ...segs.soft, userMin: -100, userMax: 300, min: -100, max: 99 } }; // soft lost 100..300 to bone above it
    const cls = buildClsData(g, g.calibration, noEdit, trimmed), picks = slotPicks(cls.chan, 0b11);
    expect(labelAt(2, cls.data, cls.C, picks, null, null)).toBe(slotLabel(0));
    expect(labelAt(1, cls.data, cls.C, picks, null, null)).toBe(slotLabel(1));
  });
  it('the processing mask: an excluded voxel (edit / post-processing) is not the segment even inside its range; a mask-only voxel is', () => {
    const edit = { data: new Uint8Array(5 * 4).fill(255), dims: g.dims, active: 0b11, maskOnly: 0b10 };
    edit.data[3 * 4 + 0] = 0; // voxel 3 (500 HU) removed from bone by an edit
    edit.data[0 * 4 + 1] = 255; for (const i of [1, 2, 3, 4]) edit.data[i * 4 + 1] = 0; // soft = mask only, its mask holds voxel 0 (-500 HU, outside its range)
    const cls = buildClsData(g, g.calibration, edit, segs), picks = slotPicks(cls.chan, 0b11);
    expect([0, 1, 2, 3, 4].map(i => labelAt(i, cls.data, cls.C, picks, null, null))).toEqual([slotLabel(1), UNLABELED, slotLabel(0), UNLABELED, UNLABELED]);
  });
  it('an analysis colour labels the voxel only when its colour belongs to the segment the voxel resolved to', () => {
    const cls = buildClsData(g, g.calibration, noEdit, segs), picks = slotPicks(cls.chan, 0b11);
    const reg = Uint8Array.from([1, 1, 1, 2, 0]), regSegs = Int32Array.from([0b10, 0b01]); // colour 0 = a soft result, colour 1 = a bone result
    expect([0, 1, 2, 3, 4].map(i => labelAt(i, cls.data, cls.C, picks, reg, regSegs))).toEqual([UNLABELED, regionLabel(0), slotLabel(0), regionLabel(1), UNLABELED]);
  });
});

// ---- reference implementations (independent of the module's kernels) ----
// build 565's pipeline: raw u16 counts per label, then per label: whole counts per bin, x w once, accToHist; the total = the sum of those
function refHists(labelOf, g, w) {
  const u = u16(g), [sl, ic, bi] = g.calibration, raw = Array.from({ length: LABELS }, () => new Map());
  for (let i = 0; i < u.length; i++) { const m = raw[labelOf(i)]; m.set(u[i], (m.get(u[i]) || 0) + 1); }
  const hists = new Array(LABELS).fill(null), tot = new Float64Array(HIST_BINS);
  raw.forEach((m, L) => {
    if (!m.size) return;
    const b = new Float64Array(HIST_BINS); for (const [uu, n] of m) { let k = Math.round((uu - bi) * sl + ic) - HIST_MIN; k = k < 0 ? 0 : k >= HIST_BINS ? HIST_BINS - 1 : k; b[k] += n; }
    const acc = new Float64Array(HIST_BINS); for (let i = 0; i < HIST_BINS; i++) if (b[i]) acc[i] += b[i] * w;
    hists[L] = accToHist(acc); for (let i = 0; i < HIST_BINS; i++) tot[i] += acc[i];
  });
  return { hists, total: accToHist(tot) };
}
// the shader's HU path at the centre of voxel (x, y, z) of grid D (vr-view.js segmentIndexAt with useCls 0, editAllows, regionColor)
function huLabel(hu, x, y, z, D, { ranges, shown, maskOnly = 0, em = 0, edit = null, region = null }) {
  const tex = (dims, data, ch, C, linear) => { // sample a texture at the voxel centre: clamp to edge, trilinear or nearest, in bytes
    const c = [x, y, z].map((v, a) => (v + 0.5) / D[a]);
    if (!linear) { const i = c.map((t, a) => Math.min(dims[a] - 1, Math.floor(t * dims[a]))); return data[((i[2] * dims[1] + i[1]) * dims[0] + i[0]) * C + ch]; }
    const f = c.map((t, a) => t * dims[a] - 0.5), i0 = f.map(Math.floor), w = f.map((v, a) => v - i0[a]), cl = (v, a) => Math.max(0, Math.min(dims[a] - 1, v));
    let s = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const wt = (dx ? w[0] : 1 - w[0]) * (dy ? w[1] : 1 - w[1]) * (dz ? w[2] : 1 - w[2]); if (!wt) continue;
      s += wt * data[((cl(i0[2] + dz, 2) * dims[1] + cl(i0[1] + dy, 1)) * dims[0] + cl(i0[0] + dx, 0)) * C + ch];
    }
    return s;
  };
  for (let s = 0; s < 4; s++) {
    if (!((shown >> s) & 1)) continue;
    if (!(((maskOnly >> s) & 1) || (hu >= ranges[2 * s] && hu <= ranges[2 * s + 1]))) continue;
    if ((em >> s) & 1 && edit && tex(edit.dims, edit.data, s, 4, edit.linear) / 255 < 0.5) continue;
    if (region) { const r = tex(region.dims, region.data, 0, 1, false); if (r > 0 && r <= 14 && (region.segs[r - 1] >> s) & 1) return regionLabel(r - 1); }
    return slotLabel(s);
  }
  return UNLABELED;
}
// a worker running labelWorkerMain in this thread (messages delivered on the next microtask, buffers moved as by transfer)
function fakeWorker() {
  const scope = { postMessage: m => queueMicrotask(() => w.onmessage?.({ data: m })) };
  const w = { postMessage: m => { const c = structuredClone(m, { transfer: m.buf ? [m.buf] : [] }); queueMicrotask(() => scope.onmessage({ data: c })); }, terminate() { w.dead = true; } };
  labelWorkerMain(scope);
  return w;
}
const noWorker = () => { throw new Error('main thread'); };
const pass = async (input, makeWorker, opts = {}) => { const h = createVrLabelHistogram({ makeWorker, budget: () => 4, yieldFn: async () => {}, ...opts }); expect(await h.run(input)).toBe(true); return h; };

// a 3-D test volume: HU -200..1199 in a pattern, slot 0 = bone (300..2000), slot 1 = soft (-100..400): overlap 300..400
function volume(n, dims = [n, n, n], calibration) {
  const N = dims[0] * dims[1] * dims[2], hus = []; for (let i = 0; i < N; i++) hus.push(((i * 7) % 1400) - 200);
  return { g: grid(hus, dims, calibration), hus };
}
const segs = { bone: { active: true, enabled: true, min: 300, max: 2000 }, soft: { active: true, enabled: true, min: -100, max: 400 }, fat: {}, lung: {} };
const RANGES = [300, 2000, -100, 400, 0, 0, 0, 0];
const voxelXYZ = (i, D) => [i % D[0], Math.floor(i / D[0]) % D[1], Math.floor(i / (D[0] * D[1]))];

describe('build 568: counted straight into HU bins (worker and main thread), identical to the build 565 pipeline', () => {
  it('classification path, a slope and offset calibration, a non-integer weight, regions: worker == main thread == the old raw-count pipeline', async () => {
    const n = 10, { g } = volume(n, [n, n, n], [0.5, -1500, 32]);
    const edit = { data: new Uint8Array(n * n * n * 4).fill(255), dims: g.dims, active: 1, maskOnly: 0 }; for (let i = 0; i < n * n * n; i += 2) edit.data[i * 4] = 0;
    const cls = buildClsData(g, g.calibration, edit, segs), region = { data: Uint8Array.from({ length: n * n * n }, (_, i) => (i % 5 === 0 ? 1 : 0)), dims: g.dims, segs: [0b10] };
    const input = { key: 'k', grid: g, cls, region, shownMask: 0b11, volDims: [17, 13, 11] }, w = (17 * 13 * 11) / (n * n * n);
    const a = await pass(input, fakeWorker), b = await pass(input, noWorker);
    const picks = slotPicks(cls.chan, 0b11), ref = refHists(i => labelAt(i, cls.data, cls.C, picks, region.data, Int32Array.from(region.segs)), g, w);
    expect(sameHists(a.result, ref)).toBe('same'); expect(sameHists(b.result, ref)).toBe('same');
    expect(a.result.reduced).toBe(true); expect(a.result.hists[regionLabel(0)]).not.toBeNull(); expect(a.result.hists[UNLABELED]).not.toBeNull();
  });
  it('nothing shown: every voxel gray', async () => {
    const { g } = volume(6), cls = buildClsData(g, g.calibration, { data: null, dims: g.dims, active: 0, maskOnly: 0 }, segs);
    const r = (await pass({ key: 'k', grid: g, cls, region: null, shownMask: 0 }, fakeWorker)).result;
    expect(perLabel(r)[UNLABELED]).toBe(216); expect(perLabel(r).reduce((x, y) => x + y)).toBe(216);
  });
  it('countsToHists: per label and the total, weighted to the volume', () => {
    const counts = new Uint32Array(LABELS * HIST_BINS); counts[slotLabel(1) * HIST_BINS + (0 - HIST_MIN)] = 3; counts[UNLABELED * HIST_BINS] = 5;
    const { hists, total } = countsToHists(counts, 2);
    expect(histCount(hists[slotLabel(1)])).toBe(6); expect(histCount(hists[UNLABELED])).toBe(10); expect(hists[slotLabel(0)]).toBeNull();
    expect(histCount(total)).toBe(16); expect(hists[slotLabel(1)][0 - HIST_MIN]).toBe(6);
  });
  it('binLut / axisMap', () => {
    const lut = binLut([1, -1024, 0], HIST_MIN, HIST_BINS); expect(lut[0]).toBe(0); expect(lut[1024]).toBe(1024); expect(lut[65535]).toBe(HIST_BINS - 1);
    const lin = axisMap(4, 2, true); expect(Array.from(lin.i0)).toEqual([0, 0, 0, 1]); expect(Array.from(lin.i1)).toEqual([0, 1, 1, 1]); expect(Array.from(lin.w)).toEqual([0.75, 0.25, 0.75, 0.25]); // (x + 0.5) / 2 - 0.5 = -0.25, 0.25, 0.75, 1.25
    const nn = axisMap(4, 2, false); expect(Array.from(nn.i0)).toEqual([0, 0, 1, 1]); expect(Array.from(nn.w)).toEqual([0, 0, 0, 0]);
  });
});

describe('build 568: the HU path (512 data, or 詳細 cls off) follows the shader: HU ranges, mask-only, the edit texture (trilinear / nearest), regions', () => {
  // a grid twice the size of the 256-style edit / region grid along x and y (and odd in z: 7 -> 3), as 512 data against the 256 edit mask
  const D = [12, 10, 7], E = [6, 5, 3], { g, hus } = volume(0, D);
  const ne = E[0] * E[1] * E[2], editData = new Uint8Array(ne * 4);
  for (let i = 0; i < ne; i++) { editData[i * 4] = (i * 5) % 3 ? 255 : 0; editData[i * 4 + 1] = (i * 3) % 4 ? 0 : 255; editData[i * 4 + 2] = 255; }
  const regionData = Uint8Array.from({ length: ne }, (_, i) => (i % 7 === 0 ? 1 : i % 11 === 0 ? 2 : 0)), region = { data: regionData, dims: E, segs: [0b01, 0b10] };
  const cases = {
    'trilinear edit mask, priority overlap, regions': { shown: 0b11, maskOnly: 0, em: 0b01, linear: true },
    'nearest edit mask (詳細 編集 nearest)': { shown: 0b11, maskOnly: 0, em: 0b01, linear: false },
    'mask-only slot (its range ignored, its mask decides)': { shown: 0b11, maskOnly: 0b10, em: 0b11, linear: true },
    'bone hidden in VR: soft takes the overlap; edits off (詳細 編集 off)': { shown: 0b10, maskOnly: 0, em: 0, linear: true },
  };
  for (const [name, c] of Object.entries(cases)) {
    it(name + ': worker == main thread == the shader rule voxel by voxel', async () => {
      const edit = { data: editData, dims: E, linear: c.linear };
      const input = { key: name, grid: g, cls: null, region, shownMask: c.shown, hu: { ranges: RANGES, maskOnly: c.maskOnly, em: c.em, edit } };
      const a = await pass(input, fakeWorker), b = await pass(input, noWorker);
      const ref = refHists(i => { const [x, y, z] = voxelXYZ(i, D); return huLabel(hus[i], x, y, z, D, { ranges: RANGES, shown: c.shown, maskOnly: c.maskOnly, em: c.em, edit, region }); }, g, 1);
      expect(sameHists(a.result, ref)).toBe('same'); expect(sameHists(b.result, ref)).toBe('same');
      expect(a.result.reduced).toBe(false);
    });
  }
  it('the HU path on the classification grid gives the classification path\'s labels (same data, same mask)', async () => {
    const n = 8, { g: g2 } = volume(n), ed = new Uint8Array(n * n * n * 4).fill(255); for (let i = 0; i < n * n * n; i += 3) ed[i * 4] = 0;
    const edit = { data: ed, dims: g2.dims, active: 0b01, maskOnly: 0 }, cls = buildClsData(g2, g2.calibration, edit, segs);
    const viaCls = (await pass({ key: 'c', grid: g2, cls, region: null, shownMask: 0b11 }, fakeWorker)).result;
    const viaHu = (await pass({ key: 'h', grid: g2, cls: null, region: null, shownMask: 0b11, hu: { ranges: RANGES, maskOnly: 0, em: 0b01, edit: { data: ed, dims: g2.dims, linear: true } } }, fakeWorker)).result;
    expect(sameHists(viaCls, viaHu)).toBe('same');
  });
  it('the slice message carries the two edit layers and the region layer of that slice (layout)', () => {
    const p = passPlan({ key: 'l', grid: g, cls: null, region, shownMask: 0b11, hu: { ranges: RANGES, maskOnly: 0, em: 1, edit: { data: editData, dims: E, linear: true } } });
    expect(p.bytes).toBe(D[0] * D[1] * 2 + 2 * E[0] * E[1] * 4 + E[0] * E[1]); expect(p.td).toBe(7);
  });
});

describe('the pass: time slicing, progress, cancellation, redraws', () => {
  it('the budget is checked BEFORE each unit of work: no frame works past the budget by more than one unit', async () => {
    const { g } = volume(24), cls = buildClsData(g, g.calibration, { data: null, dims: g.dims, active: 0, maskOnly: 0 }, segs);
    let t = 0, frames = 0; // a clock that moves 0.4 ms per reading: one chunk (two readings) costs 0.4 ms
    const h = await pass({ key: 'k', grid: g, cls, region: null, shownMask: 0b11 }, noWorker, { budget: () => 2, now: () => (t += 0.2), yieldFn: async () => { frames++; } });
    expect(frames).toBeGreaterThan(2); expect(h.stats.frames).toBe(frames); expect(h.stats.maxFrameMs).toBeLessThanOrEqual(2 + 0.6 + 1e-9);
  });
  it('worker: when every pooled buffer is in flight the pass waits for the next frame (the copy then starts a frame)', async () => {
    const acks = []; let frames = 0;
    const slow = () => { // a worker that answers only when the frame loop lets it
      const scope = { postMessage: m => (m.t === 'ack' ? acks.push(() => w.onmessage({ data: m })) : queueMicrotask(() => w.onmessage({ data: m }))) };
      const w = { postMessage: m => queueMicrotask(() => scope.onmessage({ data: m })), terminate() {} }; labelWorkerMain(scope); return w;
    };
    const { g } = volume(4, [4, 4, 40]), plan = passPlan({ key: 'w', grid: g, cls: null, region: null, shownMask: 0b11, hu: { ranges: RANGES, maskOnly: 0, em: 0, edit: null } });
    const client = createLabelCountClient(slow);
    const counts = await client.count({ spec: plan.spec, bytes: plan.bytes, td: plan.td, fill: plan.fill, gate: () => true, work: fn => fn(),
      frame: async () => { frames++; await new Promise(r => setTimeout(r, 0)); acks.splice(0).forEach(f => f()); return true; } });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4 * 4 * 40); expect(frames).toBeGreaterThanOrEqual(Math.floor(40 / POOL_SLICES) - 1);
  });
  it('a new run cancels the running one; only the last result is kept', async () => {
    const { g } = volume(8), cls = buildClsData(g, g.calibration, { data: null, dims: g.dims, active: 0, maskOnly: 0 }, segs);
    let release; const gate = new Promise(r => { release = r; }); let t = 0;
    const h = createVrLabelHistogram({ makeWorker: noWorker, budget: () => 1, now: () => (t += 1), yieldFn: () => gate });
    const first = h.run({ key: 'a', grid: g, cls, region: null, shownMask: 0b01 });
    expect(h.busy).toBe(true);
    const second = h.run({ key: 'b', grid: g, cls, region: null, shownMask: 0b11 });
    release();
    expect(await first).toBe(false); expect(await second).toBe(true); expect(h.result.key).toBe('b'); expect(h.result.shownMask).toBe(0b11);
  });
  it('change events (board redraws): the first pass emits at its start and its end; a pass over an existing result only at its end', async () => {
    const { g } = volume(6), cls = buildClsData(g, g.calibration, { data: null, dims: g.dims, active: 0, maskOnly: 0 }, segs);
    const h = createVrLabelHistogram({ makeWorker: fakeWorker, yieldFn: async () => {} }); let n = 0; h.onChange(() => n++);
    await h.run({ key: 'a', grid: g, cls, region: null, shownMask: 0b11 }); expect(n).toBe(2);
    // build 569: the self-check's reruns (same key, same result) do not redraw the board; the result object is kept
    const first = h.result; await h.rerun(); await h.rerun(); expect(n).toBe(2); expect(h.result).toBe(first);
    // a real change redraws once
    await h.run({ key: 'b', grid: g, cls, region: null, shownMask: 0b01 }); expect(n).toBe(3); expect(h.result.key).toBe('b');
  });
  it('build 569: after an error, the same good result again is a change (the board leaves the error)', async () => {
    const { g } = volume(6), cls = buildClsData(g, g.calibration, { data: null, dims: g.dims, active: 0, maskOnly: 0 }, segs);
    const h = createVrLabelHistogram({ makeWorker: fakeWorker, yieldFn: async () => {} }); let n = 0; h.onChange(() => n++);
    const input = { key: 'a', grid: g, cls, region: null, shownMask: 0b11 };
    await h.run(input); expect(n).toBe(2);
    expect(await h.run({ ...input, grid: { ...g, dims: null } })).toBe(false); expect(h.error).not.toBe(''); expect(n).toBe(3);
    await h.run(input); expect(h.error).toBe(''); expect(n).toBe(4);
  });
  it('sameResult: key, mask, dims and every histogram', () => {
    const hist = () => Uint32Array.from([1, 2, 3]), r = () => ({ key: 'k', shownMask: 1, reduced: false, dims: [2, 2, 2], hists: [hist(), ...new Array(LABELS - 1).fill(null)], total: hist() });
    expect(sameResult(r(), r())).toBe(true); expect(sameResult(null, r())).toBe(false);
    const b = r(); b.hists[0][1] = 5; expect(sameResult(r(), b)).toBe(false);
    const c = r(); c.key = 'x'; expect(sameResult(r(), c)).toBe(false);
    const d = r(); d.hists[3] = hist(); expect(sameResult(r(), d)).toBe(false);
  });
});

describe('the laser drag of range lines is gone (build 563 -> 567)', () => {
  const src = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('no drag code in the board, the VR view or the PC histogram exports', () => {
    expect(src('vr-view.js')).not.toMatch(/histDragHit|histDrag\b|endHistDrag|hist\.grab|hist\.dragTo|hist\.release|setHistogramLine|commitHistogramLine|DRAG_GAP_MS/);
    expect(src('vr-histogram-panel.js')).not.toMatch(/grab\(|dragTo|release\(|DRAG_GAP_MS|setLine|commitLine/);
    expect(src('histogram-ui.js')).not.toMatch(/export function (setHistogramLine|commitHistogramLine)/);
  });
});
