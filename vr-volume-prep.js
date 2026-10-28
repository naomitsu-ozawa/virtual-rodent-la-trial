// the heavy, pure steps of the VR data preparation, runnable off the main thread (switching the data inside a running VR session
// must not stall the headset's frames: vr-data-switch.js, vr-view.js swapData). Pure: no DOM, no GL; unit-tested (tests/unit/vr-volume-prep.test.js)
// to give byte-identical results to the synchronous versions they replace.
//   computeBricksOf   per brick HU min / max of an rg8-packed u16 volume (was computeBricks in vr-view.js)
//   halveData         2x2x2 average of such a volume (was the data part of halveVolume in vr-view.js)
//   buildDistanceBytesSync   the chamfer distance of every classification channel (distance-field.js buildDistanceBytes without its yields)
//   buildEditMaskOf  the processing masks of the segments on the grid (RGBA, one channel per GPU slot; was buildEditMask in vr-view.js, which ran on the main thread)
//   buildRegionIndexOf   the analysis results' colour / id index on the grid (was buildRegionIndex in vr-view.js)
//   prepRun           one job of the worker: 'volume' (bricks of the full grid and the 256 copy) or 'cls' (the processing mask and the analysis index, classification bytes,
//                     distance field, the combined texture's bytes for the shown mask, brick occupancy of the mask-only segments)
// The worker is a Blob made from this site's own functions (the same way as vr-combo-rebuild.js); the data goes in and comes back by
// transfer (no second copy of a 512 MB array is ever held). Without a Worker (tests) the same job runs on the calling thread.
import { buildClsData } from './point-cls.js?v=20261027-build680';
import { chamferDistanceBytes, combineClassificationDistance, fourthChannelBytes } from './distance-field.js?v=20261027-build680';
import { brickOccupancy, cellRange } from './vr-brick-occupancy.js?v=20261027-build680';
import { gpuRunsForTexture, gpuRunRowMapToSlice, gpuLowerBound, gpuUpperBound, gpuDilateRuns } from './gpu-runs.js?v=20261027-build680';

export const BRICK = 8;

// brick min / max in HU; one voxel of overlap so trilinear samples at a brick edge are covered. Four floats per brick (RGBA32F texture):
// min, max, mask-only occupancy (filled by the caller), unused. Self-contained (it is also the worker's source).
export function computeBricksOf(data, dims, calibration, brick) {
  const tw = dims[0], th = dims[1], td = dims[2], slope = calibration[0], intercept = calibration[1], bias = calibration[2];
  const bx = Math.ceil(tw / brick), by = Math.ceil(th / brick), bz = Math.ceil(td / brick), mm = new Float32Array(bx * by * bz * 4);
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    let lo = 65535, hi = 0;
    const z0 = Math.max(0, k * brick - 1), z1 = Math.min(td, (k + 1) * brick + 1), y0 = Math.max(0, j * brick - 1), y1 = Math.min(th, (j + 1) * brick + 1), x0 = Math.max(0, i * brick - 1), x1 = Math.min(tw, (i + 1) * brick + 1);
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) { let o = (z * th + y) * tw * 2 + x0 * 2; for (let x = x0; x < x1; x++, o += 2) { const w = data[o] | (data[o + 1] << 8); if (w < lo) lo = w; if (w > hi) hi = w; } }
    const b = ((k * by + j) * bx + i) * 4, a = (lo - bias) * slope + intercept, c = (hi - bias) * slope + intercept; mm[b] = Math.min(a, c); mm[b + 1] = Math.max(a, c);
  }
  return { bricks: mm, brickDims: [bx, by, bz] };
}

// half-size copy (2x2x2 average) of an rg8-packed u16 volume
export function halveData(src, dims) {
  const w = dims[0], h = dims[1], d = dims[2], tw = Math.max(1, w >> 1), th = Math.max(1, h >> 1), td = Math.max(1, d >> 1), out = new Uint8Array(tw * th * td * 2);
  for (let z = 0; z < td; z++) for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let acc = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) { const o = (((z * 2 + dz) * h + (y * 2 + dy)) * w + x * 2) * 2; acc += (src[o] | (src[o + 1] << 8)) + (src[o + 2] | (src[o + 3] << 8)); }
    const v = Math.round(acc / 8), o = ((z * th + y) * tw + x) * 2; out[o] = v & 255; out[o + 1] = v >> 8;
  }
  return { data: out, dims: [tw, th, td] };
}

// the processing masks of the segments on the grid `dims` (RGBA, channel = GPU slot): the WebGPU edit runs mapped with gpuRunsForTexture (exclude runs dilated by one on a reduced
// grid, as the WebGPU volume does). descs: [{si: the slot, mode: 'exclude' | other, maskOnly, runs}] in slot order (only the segments that have runs); sourceDims: the volume's own grid.
// Returns {activeMask, maskOnly, data | null}. Self-contained (it is also the worker's source).
export function buildEditMaskOf(descs, sourceDims, dims) {
  const w = dims[0], h = dims[1], d = dims[2], reduced = w !== sourceDims[0] || h !== sourceDims[1] || d !== sourceDims[2];
  let activeMask = 0, maskOnly = 0, data = null;
  for (const desc of descs) {
    const si = desc.si, runs = gpuRunsForTexture(desc.runs, sourceDims, dims, { dilate: reduced && desc.mode === 'exclude' ? 1 : 0 });
    data = data || new Uint8Array(w * h * d * 4); activeMask |= 1 << si; if (desc.maskOnly) maskOnly |= 1 << si;
    const on = desc.mode === 'exclude' ? 0 : 255;
    if (desc.mode === 'exclude') for (let i = si; i < data.length; i += 4) data[i] = 255;
    for (let z = 0; z < d; z++) {
      const rec = runs ? runs[z] : null; if (!rec || !rec.length) continue;
      for (let i = 0; i < rec.length; i += 3) { const o = (z * h + rec[i]) * w; for (let x = rec[i + 1]; x <= rec[i + 2]; x++) data[(o + x) * 4 + si] = on; }
    }
  }
  return { activeMask, maskOnly, data };
}

// the analysis results on the grid: item = {color, segMask: bit s = the result belongs to GPU slot s, runsBySlice, mm3, segmentKeys, rid}. Colour index per voxel
// (0 none, 1..14 = the distinct colours in list order, at most 14; a later result wins where two overlap), the result's id (list position + 1, up to 255) per voxel, the colours, the
// slot bits per colour and the list. Self-contained (it is also the worker's source).
export function buildRegionIndexOf(items, sourceDims, dims) {
  if (!items.length) return { data: null, colors: [], segs: [], list: [] };
  const w = dims[0], h = dims[1], d = dims[2], colors = [], segs = [], data = new Uint8Array(w * h * d), ids = new Uint8Array(w * h * d), list = [];
  for (const r of items) {
    const c = Number(r.color) >>> 0; let k = colors.indexOf(c); if (k < 0) { if (colors.length >= 14) continue; colors.push(c); segs.push(0); k = colors.length - 1; }
    segs[k] |= r.segMask | 0;
    const runs = gpuRunsForTexture(r.runsBySlice, sourceDims, dims, { dilate: 0 });
    if (list.length >= 255) break; const id = list.length + 1;
    for (let z = 0; z < d; z++) { const rec = runs ? runs[z] : null; if (!rec || !rec.length) continue; for (let i = 0; i < rec.length; i += 3) { const o = (z * h + rec[i]) * w; data.fill(k + 1, o + rec[i + 1], o + rec[i + 2] + 1); ids.fill(id, o + rec[i + 1], o + rec[i + 2] + 1); } }
    list.push({ color: c, mm3: r.mm3, segmentKeys: r.segmentKeys.slice(), rid: r.rid });
  }
  return { data: colors.length ? data : null, ids: colors.length ? ids : null, colors, segs, list };
}

// distance-field.js buildDistanceBytes without the yields (it runs in the worker); progress(done, total) between channels
export function buildDistanceBytesSync(cls, dims, progress) {
  const n = dims[0] * dims[1] * dims[2], C = cls.C, out = new Uint8Array(n * C), inside = new Uint8Array(n);
  const scratch = { D: new Int32Array(n), a: new Uint8Array(n), b: new Uint8Array(n), dil: new Uint8Array(n) };
  for (let c = 0; c < C; c++) {
    if (progress) progress(c, C);
    for (let i = 0; i < n; i++) inside[i] = cls.data[i * C + c] >= 128 ? 1 : 0;
    const dist = chamferDistanceBytes(inside, dims, scratch);
    for (let i = 0; i < n; i++) out[i * C + c] = dist[i];
  }
  if (progress) progress(C, C);
  return { data: out, C, chan: cls.chan };
}

// One worker job. m.t 'volume': {data: ArrayBuffer of the rg8 volume, dims, calib, brick, half: also the 256 copy} -> {data (returned), bricks, brickDims, half: {data, dims, bricks, brickDims} | null}.
// m.t 'cls': {src: ArrayBuffer of the grid the classification is built on, dims, calib, editDescs / editSourceDims (the processing masks, built here on `dims`), regionItems (the analysis index, built
// here on `dims`), order, state: {key: {active, enabled, min, max}}, brickDimsFull, brickDimsHalf | null, mask: the shown-segment mask of the combined texture (-1: none)}
// -> {cls, dist, combo, cls4, occFull, occHalf, src (comes back), edit: {data | null, active, maskOnly}, region}.
// post(message, transferList). Self-contained apart from the functions listed in prepWorkerSource.
export function prepRun(m, post) {
  try {
    if (m.t === 'volume') {
      const data = new Uint8Array(m.data), b = computeBricksOf(data, m.dims, m.calib, m.brick);
      const out = { t: 'volume', id: m.id, data: m.data, bricks: b.bricks, brickDims: b.brickDims, half: null }, tr = [m.data, b.bricks.buffer];
      if (m.half) {
        const h = halveData(data, m.dims), hb = computeBricksOf(h.data, h.dims, m.calib, m.brick);
        out.half = { data: h.data, dims: h.dims, bricks: hb.bricks, brickDims: hb.brickDims }; tr.push(h.data.buffer, hb.bricks.buffer);
      }
      post(out, tr);
    } else if (m.t === 'cls') {
      // a failure of the mask or the index is reported and the picture goes on without it (as it did when they were built on the page)
      const src = new Uint8Array(m.src), warnings = [];
      let em; try { em = buildEditMaskOf(m.editDescs, m.editSourceDims, m.dims); } catch (e) { em = { activeMask: 0, maskOnly: 0, data: null }; warnings.push('processing mask: ' + String((e && e.message) || e)); }
      const edit = { data: em.data, dims: m.dims, active: em.activeMask, maskOnly: em.maskOnly };
      let region; try { region = buildRegionIndexOf(m.regionItems, m.editSourceDims, m.dims); } catch (e) { region = { data: null, colors: [], segs: [], list: [] }; warnings.push('analysis index: ' + String((e && e.message) || e)); }
      const cls = buildClsData({ dims: m.dims, data: src }, m.calib, edit, m.state, m.order);
      let dist = null, combo = null, cls4 = null;
      if (cls) {
        dist = buildDistanceBytesSync(cls, m.dims, (done, total) => post({ t: 'progress', id: m.id, done, total }, []));
        const four = cls.chan.includes(3);
        if (m.mask >= 0) combo = combineClassificationDistance(cls, dist, m.mask, null, { four });
        if (four) cls4 = fourthChannelBytes(cls);
      }
      const occFull = brickOccupancy(edit, m.brickDimsFull), occHalf = m.brickDimsHalf ? brickOccupancy(edit, m.brickDimsHalf) : null;
      const tr = [m.src], bufs = [cls?.data, dist?.data, combo, cls4, occFull, occHalf, em.data, region.data, region.ids];
      for (const a of bufs) if (a) tr.push(a.buffer);
      post({ t: 'cls', id: m.id, cls, dist, combo, cls4, occFull, occHalf, src: m.src, edit: { data: em.data, active: em.activeMask, maskOnly: em.maskOnly }, region, warnings }, tr);
    } else post({ t: 'error', id: m.id, message: 'unknown job ' + m.t }, []);
  } catch (e) { post({ t: 'error', id: m.id, message: String((e && e.message) || e) }, []); }
}

const SEGMENT_ORDER_SRC = "const SEGMENT_ORDER=['bone','soft','fat','lung'];const INF=0x3fffffff;";
export const prepWorkerSource = () => [SEGMENT_ORDER_SRC, computeBricksOf, halveData, buildClsData, chamferDistanceBytes, combineClassificationDistance, fourthChannelBytes, cellRange, brickOccupancy, gpuRunRowMapToSlice, gpuLowerBound, gpuUpperBound, gpuDilateRuns, gpuRunsForTexture, buildEditMaskOf, buildRegionIndexOf, buildDistanceBytesSync, prepRun]
  .map(f => typeof f === 'string' ? f : f.toString()).join('\n') + '\nself.onmessage=e=>prepRun(e.data,(msg,tr)=>self.postMessage(msg,tr));';
const blobWorker = () => {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
  try {
    const url = URL.createObjectURL(new Blob([prepWorkerSource()], { type: 'text/javascript' })), w = new Worker(url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return w;
  } catch { return null; }
};

// The main-thread side: one worker for the life of one preparation. volume(job) / cls(job, onProgress) resolve with the worker's answer (or reject with its error);
// dispose() ends the worker and rejects what is still pending. Without a Worker the same job runs on this thread (slower, never wrong); a worker that dies fails its job.
export function createVolumePrep({ makeWorker = blobWorker } = {}) {
  let wk = null, started = false, seq = 0, dead = false;
  const pending = new Map(), stats = { worker: 0, local: 0 }; // stats: how many jobs ran in the worker / on this thread (a worker that could not start must be visible on the device)
  const start = () => {
    if (started) return wk; started = true;
    wk = makeWorker();
    if (!wk) return null;
    wk.onmessage = e => {
      const m = e.data, p = pending.get(m.id); if (!p) return;
      if (m.t === 'progress') { p.progress?.(m.done, m.total); return; }
      pending.delete(m.id);
      if (m.t === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    };
    wk.onerror = ev => { const err = new Error('prep worker: ' + (ev?.message || 'error')); for (const p of pending.values()) p.fail(err); pending.clear(); try { wk.terminate(); } catch { /* none */ } wk = null; };
    return wk;
  };
  const run = (job, transfer, progress) => new Promise((resolve, reject) => {
    if (dead) { reject(new Error('disposed')); return; }
    const id = ++seq, w = start();
    const local = () => { // the same job on this thread
      stats.local++; let out = null; prepRun({ ...job, id }, (m, tr) => { if (m.t === 'progress') progress?.(m.done, m.total); else out = m; });
      if (out && out.t === 'error') reject(new Error(out.message)); else resolve(out);
    };
    if (!w) { setTimeout(local, 0); return; }
    stats.worker++; pending.set(id, { resolve, reject, progress, fail: reject }); // a worker that dies took the transferred buffers with it: the job fails (no retry on stale data)
    try { w.postMessage({ ...job, id }, transfer); } catch (e) { pending.delete(id); reject(e); }
  });
  return {
    volume: job => run({ ...job, t: 'volume' }, [job.data]),
    cls: (job, progress) => run({ ...job, t: 'cls' }, [job.src], progress),
    get stats() { return { ...stats }; },
    get disposed() { return dead; },
    dispose() { dead = true; for (const p of pending.values()) p.reject(new Error('disposed')); pending.clear(); try { wk?.terminate(); } catch { /* none */ } wk = null; },
  };
}
