import { HIST_MIN, HIST_BINS } from './histogram.js?v=20261023-build657';
import { accToHist, createAcc, textureU16 } from './histogram-texture.js?v=20261023-build657';

export const SLOTS = 4, REGION_COLORS = 14, LABELS = 1 + SLOTS + REGION_COLORS, UNLABELED = 0;
export const UNLABELED_COLOR = '#8c969c';
export const slotLabel = s => 1 + s;
export const regionLabel = k => 1 + SLOTS + k;
export const labelSlot = L => (L >= 1 && L <= SLOTS ? L - 1 : -1);
export const labelRegion = L => (L > SLOTS && L < LABELS ? L - 1 - SLOTS : -1);

// the slots the shader tests on the classification path, in its order: [slot, channel] pairs of the shown slots that have a channel in cls
export function slotPicks(chan, shownMask) {
  const out = [];
  for (let s = 0; s < SLOTS; s++) if (chan && chan[s] >= 0 && (shownMask >> s) & 1) out.push(s, chan[s]);
  return Int32Array.from(out);
}
// the label of voxel i on the classification path (see the header); cls: bytes, C channels per voxel; reg / regSegs may be null
export function labelAt(i, cls, C, picks, reg, regSegs) {
  for (let k = 0; k < picks.length; k += 2) {
    if (cls[i * C + picks[k + 1]] >= 128) {
      const s = picks[k];
      if (reg) { const r = reg[i]; if (r > 0 && r <= 14 && (regSegs[r - 1] >> s) & 1) return 5 + r - 1; }
      return 1 + s;
    }
  }
  return 0;
}

// ---- kernels: self-contained (no imports, no outer names), also stringified into the worker ----
// u16 -> HU bin (histogram.js: round, minus HIST_MIN, clamped into the end bins)
export function binLut(cal, histMin, bins) {
  const slope = cal[0], intercept = cal[1], bias = cal[2], lut = new Uint16Array(65536);
  for (let u = 0; u < 65536; u++) { const b = Math.round((u - bias) * slope + intercept) - histMin; lut[u] = b < 0 ? 0 : b >= bins ? bins - 1 : b; }
  return lut;
}
// u16 -> bit s set when shown slot s passes its HU test (the shader: maskOnly bit || min <= HU <= max)
export function rangeLut(cal, ranges, shown, maskOnly) {
  const slope = cal[0], intercept = cal[1], bias = cal[2], lut = new Uint8Array(65536);
  for (let u = 0; u < 65536; u++) {
    const v = (u - bias) * slope + intercept; let bits = 0;
    for (let s = 0; s < 4; s++) if ((shown >> s) & 1 && ((maskOnly >> s) & 1 || (v >= ranges[2 * s] && v <= ranges[2 * s + 1]))) bits |= 1 << s;
    lut[u] = bits;
  }
  return lut;
}
// voxel centres of a grid of D along one axis -> texels of a texture of E texels (clamp to edge): linear = the two texels and the weight of the
// second ((x + 0.5) E / D - 0.5), nearest = one texel (floor((x + 0.5) E / D), weight 0)
export function axisMap(D, E, linear) {
  const i0 = new Int32Array(D), i1 = new Int32Array(D), w = new Float64Array(D), cl = i => (i < 0 ? 0 : i > E - 1 ? E - 1 : i);
  for (let x = 0; x < D; x++) {
    if (linear) { const f = (x + 0.5) * E / D - 0.5, i = Math.floor(f); i0[x] = cl(i); i1[x] = cl(i + 1); w[x] = f - i; }
    else { i0[x] = i1[x] = cl(Math.floor((x + 0.5) * E / D)); w[x] = 0; }
  }
  return { i0, i1, w };
}
// what one pass needs, from its spec (the same on the main thread and in the worker): the luts, the axis maps, and the byte layout of one slice
// message (u16 at 0, then the classification / region bytes, or the two edit layers and the region layer). luts false: the layout only
export function prepareKernel(spec, luts = true) {
  const K = Object.assign({}, spec), plane = spec.W * spec.H;
  if (luts) K.lut = binLut(spec.cal, spec.histMin, spec.bins);
  let off = plane * 2;
  const part = n => { const o = off; off += n; return o; };
  if (spec.mode === 'cls') {
    K.useCls = spec.picks.length > 0;
    K.oX = K.useCls ? part(plane * spec.C) : -1; K.oR = K.useCls && spec.hasReg ? part(plane) : -1;
  } else {
    if (luts) K.rl = rangeLut(spec.cal, spec.ranges, spec.shown, spec.maskOnly);
    if (spec.ed) { const ep = spec.ed.ew * spec.ed.eh * 4; K.emx = axisMap(spec.W, spec.ed.ew, spec.ed.linear); K.emy = axisMap(spec.H, spec.ed.eh, spec.ed.linear); K.oE0 = part(ep); K.oE1 = part(ep); }
    if (spec.rg) { K.rmx = axisMap(spec.W, spec.rg.rw, false); K.rmy = axisMap(spec.H, spec.rg.rh, false); K.oR = part(spec.rg.rw * spec.rg.rh); }
  }
  K.bytes = off;
  return K;
}
// the views of one slice message
export function sliceViews(K, buf, wz) {
  const plane = K.W * K.H, s = { u: new Uint16Array(buf, 0, plane), x: null, r: null, e0: null, e1: null, wz };
  if (K.mode === 'cls') { if (K.oX >= 0) s.x = new Uint8Array(buf, K.oX, plane * K.C); if (K.oR >= 0) s.r = new Uint8Array(buf, K.oR, plane); }
  else {
    if (K.ed) { const ep = K.ed.ew * K.ed.eh * 4; s.e0 = new Uint8Array(buf, K.oE0, ep); s.e1 = new Uint8Array(buf, K.oE1, ep); }
    if (K.rg) s.r = new Uint8Array(buf, K.oR, K.rg.rw * K.rg.rh);
  }
  return s;
}
// count rows [ya, yb) of one slice into counts[label * bins + bin]
export function countSliceRows(K, counts, s, ya, yb) {
  const W = K.W, bins = K.bins, lut = K.lut, u = s.u, regSegs = K.regSegs;
  if (K.mode === 'cls') {
    const picks = K.picks, np = picks.length, cls = s.x, C = K.C, reg = s.r, a = ya * W, b = yb * W;
    if (!cls || !np) { for (let i = a; i < b; i++) counts[lut[u[i]]]++; return; }
    for (let i = a; i < b; i++) {
      let L = 0;
      for (let k = 0; k < np; k += 2) {
        if (cls[i * C + picks[k + 1]] >= 128) {
          const sl = picks[k]; L = 1 + sl;
          if (reg) { const r = reg[i]; if (r > 0 && r <= 14 && (regSegs[r - 1] >> sl) & 1) L = 5 + r - 1; }
          break;
        }
      }
      counts[L * bins + lut[u[i]]]++;
    }
    return;
  }
  // HU path (vr-view.js segmentIndexAt, useCls 0)
  const rl = K.rl, order = K.order, no = order.length, em = K.ed ? K.em : 0, e0 = s.e0, e1 = s.e1, wz = s.wz, reg = s.r;
  const ew = K.ed ? K.ed.ew : 0, emx = K.emx, emy = K.emy, rw = K.rg ? K.rg.rw : 0, rmx = K.rmx, rmy = K.rmy;
  for (let y = ya; y < yb; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const uu = u[row + x], bits = rl[uu];
      let L = 0;
      if (bits) {
        for (let k = 0; k < no; k++) {
          const sl = order[k];
          if (!((bits >> sl) & 1)) continue;
          if ((em >> sl) & 1) { // editAllows: the mask texture at the voxel centre (bytes; >= 0.5 of 255)
            const X0 = emx.i0[x], X1 = emx.i1[x], wx = emx.w[x], Y0 = emy.i0[y], Y1 = emy.i1[y], wy = emy.w[y];
            const p00 = (Y0 * ew + X0) * 4 + sl, p01 = (Y0 * ew + X1) * 4 + sl, p10 = (Y1 * ew + X0) * 4 + sl, p11 = (Y1 * ew + X1) * 4 + sl;
            const v0 = (1 - wy) * ((1 - wx) * e0[p00] + wx * e0[p01]) + wy * ((1 - wx) * e0[p10] + wx * e0[p11]);
            const v1 = wz ? (1 - wy) * ((1 - wx) * e1[p00] + wx * e1[p01]) + wy * ((1 - wx) * e1[p10] + wx * e1[p11]) : 0;
            if ((1 - wz) * v0 + wz * v1 < 127.5) continue;
          }
          L = 1 + sl;
          if (reg) { const r = reg[rmy.i0[y] * rw + rmx.i0[x]]; if (r > 0 && r <= 14 && (regSegs[r - 1] >> sl) & 1) L = 5 + r - 1; }
          break;
        }
      }
      counts[L * bins + lut[uu]]++;
    }
  }
}

// ---- the worker ----
export const POOL_SLICES = 8;
export function labelWorkerMain(scope) {
  let job = null;
  scope.onmessage = e => {
    const m = e.data;
    if (m.t === 'begin') { const K = prepareKernel(m.spec); job = { id: m.id, K, counts: new Uint32Array(K.labels * K.bins) }; }
    else if (m.t === 'slice') {
      if (job && job.id === m.id) countSliceRows(job.K, job.counts, sliceViews(job.K, m.buf, m.wz), 0, job.K.H);
      scope.postMessage({ t: 'ack', buf: m.buf }, [m.buf]);
    } else if (m.t === 'end') {
      if (job && job.id === m.id) { scope.postMessage({ t: 'done', id: job.id, counts: job.counts }, [job.counts.buffer]); job = null; }
    } else if (m.t === 'abort' && job && job.id === m.id) job = null;
  };
}
const blobWorker = () => {
  const src = [binLut, rangeLut, axisMap, prepareKernel, sliceViews, countSliceRows].map(String).join('\n') + '\n(' + labelWorkerMain + ')(self);';
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), w = new Worker(url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return w;
};
// main-thread side of the worker. count({ spec, td, fill(buf, tz) -> wz, gate(tz), frame(tz), work(fn) }) -> counts | null (cancelled); throws when
// the worker failed. gate: may wait for the next frame (time), frame: waits for the next frame (no free buffer: the copy then starts a frame),
// both resolve false when the pass was cancelled; work(fn): runs (and times) one unit of main-thread work
export function createLabelCountClient(makeWorker = blobWorker) {
  let wk = null, broken = false, pool = [], size = 0, inFlight = 0, seq = 0;
  const done = new Map();
  const rejectAll = err => { for (const d of done.values()) d.reject(err); done.clear(); };
  const fail = err => { broken = true; try { wk?.terminate(); } catch { /* gone */ } wk = null; rejectAll(err); };
  const ensure = () => {
    if (wk || broken) return wk;
    try {
      if (typeof Worker === 'undefined' && makeWorker === blobWorker) { broken = true; return null; }
      wk = makeWorker();
      wk.onmessage = e => {
        const m = e.data;
        if (m.t === 'ack') { inFlight--; if (m.buf.byteLength === size) pool.push(m.buf); }
        else if (m.t === 'done') { const d = done.get(m.id); if (d) { done.delete(m.id); d.resolve(m); } }
      };
      wk.onerror = e => { e?.preventDefault?.(); fail(new Error('label histogram worker: ' + (e?.message || 'error'))); };
    } catch { broken = true; wk = null; }
    return wk;
  };
  const lost = () => { if (!wk) throw new Error('label histogram worker failed'); };
  return {
    available: () => !!ensure(),
    async count({ spec, bytes, td, fill, gate, frame, work }) {
      const w = ensure(); if (!w) throw new Error('label histogram worker unavailable');
      const id = ++seq; if (bytes !== size) { size = bytes; pool = []; }
      const stop = () => { w.postMessage({ t: 'abort', id }); return null; };
      w.postMessage({ t: 'begin', id, spec });
      for (let tz = 0; tz < td; tz++) {
        if (!(await gate(tz))) return stop(); lost();
        while (!pool.length && inFlight >= POOL_SLICES) { if (!(await frame(tz))) return stop(); lost(); }
        work(() => { inFlight++; const buf = pool.pop() || new ArrayBuffer(size), wz = fill(buf, tz); w.postMessage({ t: 'slice', id, buf, wz }, [buf]); });
      }
      lost();
      const m = await new Promise((resolve, reject) => { done.set(id, { resolve, reject }); w.postMessage({ t: 'end', id }); });
      return m.counts;
    },
    dispose() { try { wk?.terminate(); } catch { /* gone */ } wk = null; pool = []; inFlight = 0; const e = new Error('label histogram worker disposed'); e.disposed = true; rejectAll(e); },
  };
}

// the pass's spec and its slices, from the run input (see createVrLabelHistogram)
export function passPlan(input) {
  const { grid, shownMask } = input, [W, H, D] = grid.dims, plane = W * H, u = textureU16(grid);
  const base = { W, H, labels: LABELS, bins: HIST_BINS, histMin: HIST_MIN, cal: Array.from(grid.calibration) };
  const region = input.region?.data ? input.region : null, regSegs = Int32Array.from(region?.segs || []);
  let spec, zParts;
  if (input.cls) {
    const cls = input.cls, picks = slotPicks(cls.chan, shownMask), C = cls.C;
    const hasReg = !!region && region.dims.join() === grid.dims.join();
    spec = { ...base, mode: 'cls', C, picks, regSegs, hasReg };
    zParts = (z, out) => { // [array, start, length] per part, in layout order
      if (!picks.length) return;
      out.push(cls.data, z * plane * C, plane * C);
      if (hasReg) out.push(region.data, z * plane, plane);
    };
  } else {
    const hu = input.hu, order = Int32Array.from([0, 1, 2, 3].filter(s => (shownMask >> s) & 1)), edit = hu.edit?.data && hu.em ? hu.edit : null;
    const ed = edit ? { ew: edit.dims[0], eh: edit.dims[1], linear: !!edit.linear } : null, rg = region ? { rw: region.dims[0], rh: region.dims[1] } : null;
    spec = { ...base, mode: 'hu', ranges: Float64Array.from(hu.ranges), shown: shownMask, maskOnly: hu.maskOnly | 0, em: hu.em | 0, order, regSegs, ed, rg };
    const ez = edit ? axisMap(D, edit.dims[2], !!edit.linear) : null, rz = region ? axisMap(D, region.dims[2], false) : null;
    const ep = ed ? ed.ew * ed.eh * 4 : 0, rp = rg ? rg.rw * rg.rh : 0;
    zParts = (z, out) => {
      if (edit) { out.push(edit.data, ez.i0[z] * ep, ep, edit.data, ez.i1[z] * ep, ep); out.wz = ez.w[z]; }
      if (region) out.push(region.data, rz.i0[z] * rp, rp);
    };
  }
  const layout = prepareKernel(spec, false), parts = [];
  let K = null; // the main-thread kernel (luts): made only when the worker cannot count
  // the slice z as a message buffer (worker) -> wz
  const fill = (buf, z) => {
    new Uint16Array(buf, 0, plane).set(u.subarray(z * plane, z * plane + plane));
    parts.length = 0; parts.wz = 0; zParts(z, parts);
    let off = plane * 2;
    for (let i = 0; i < parts.length; i += 3) { const a = parts[i], s = parts[i + 1], n = parts[i + 2]; new Uint8Array(buf, off, n).set(a.subarray(s, s + n)); off += n; }
    return parts.wz;
  };
  // the slice z as views on the data (main thread)
  const slice = z => {
    parts.length = 0; parts.wz = 0; zParts(z, parts);
    const s = { u: u.subarray(z * plane, z * plane + plane), x: null, r: null, e0: null, e1: null, wz: parts.wz }, v = [];
    for (let i = 0; i < parts.length; i += 3) v.push(parts[i].subarray(parts[i + 1], parts[i + 1] + parts[i + 2]));
    if (spec.mode === 'cls') { s.x = v[0] || null; s.r = v[1] || null; } else { let k = 0; if (spec.ed) { s.e0 = v[k++]; s.e1 = v[k++]; } if (spec.rg) s.r = v[k++]; }
    return s;
  };
  return { spec, bytes: layout.bytes, td: D, fill, slice, kernel: () => (K ||= prepareKernel(spec)) };
}

// bin counts [LABELS x HIST_BINS] -> one HU histogram per label (null when the label has no voxel) and the total, each weighted by w (volume
// voxels per grid voxel). Each bin count is a whole number, weighted once (as's countsToAcc), so the result does not depend on the order
// the voxels were counted in.
// (one label per call of binLabel: the pass spreads them over frames)
function binLabel(counts, L, w, acc, totalAcc) {
  const o = L * HIST_BINS; let any = false;
  for (let i = 0; i < HIST_BINS; i++) { const n = counts[o + i]; acc[i] = n ? n * w : 0; if (n) any = true; }
  if (!any) return null;
  for (let i = 0; i < HIST_BINS; i++) totalAcc[i] += acc[i];
  return accToHist(acc);
}
export function countsToHists(counts, w) {
  const hists = new Array(LABELS).fill(null), totalAcc = createAcc(), acc = createAcc();
  for (let L = 0; L < LABELS; L++) hists[L] = binLabel(counts, L, w, acc, totalAcc);
  return { hists, total: accToHist(totalAcc) };
}

// two results show the same thing (same input key, same per-label and total histograms)
export function sameResult(a, b) {
  if (!a || !b || a.key !== b.key || a.shownMask !== b.shownMask || a.reduced !== b.reduced || a.dims.join() !== b.dims.join()) return false;
  const eq = (x, y) => { if (!x || !y) return x === y; if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
  for (let L = 0; L < LABELS; L++) if (!eq(a.hists[L], b.hists[L])) return false;
  return eq(a.total, b.total);
}

// ---- the pass (one at a time; a new run cancels the running one) ----
// opts: yieldFn() -> Promise (VR: the next XR frame), budget() -> ms per frame, makeWorker (tests), now (tests)
// run(input): input = { key, grid: {data, dims, calibration}, shownMask, volDims: [cols, rows, slices], region: {data, dims, segs} | null,
//   cls: {data, C, chan} (classification path) | null, hu (HU path, cls null): { ranges: [min0, max0, .. min3, max3], maskOnly, em,
//   edit: {data, dims, linear} | null } }
// result: { key, shownMask, hists[LABELS], total, dims, reduced } (kept until the next pass replaces it)
// stats: the last pass's main-thread time: maxFrameMs (the most it worked in one frame: its plan, copies / chunks and the final binning, timed
// one by one - waiting for the worker is not work), frames, ms (wall time); maxUnitMs (the longest unit), planMs, binMs
const ROW_VOXELS = 8192; // main-thread fallback: voxels per chunk (whole rows)
export function createVrLabelHistogram({ yieldFn = () => new Promise(r => setTimeout(r, 0)), budget = () => 4, makeWorker, now = () => performance.now() } = {}) {
  const prog = { busy: false, frac: -1, text: '' }, stats = { maxFrameMs: 0, frames: 0, ms: 0, maxUnitMs: 0, planMs: 0, binMs: 0 }, listeners = new Set();
  let client = null, job = null, result = null, error = '', lastInput = null, frameMs = 0;
  const note = d => { if (d > stats.maxUnitMs) stats.maxUnitMs = d; frameMs += d; if (frameMs > stats.maxFrameMs) stats.maxFrameMs = frameMs; };
  const timed = (fn, k) => { const t = now(), r = fn(), d = now() - t; stats[k] = d; note(d); return r; };
  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
  async function count(j, plan, w) {
    const td = plan.td;
    let last = now(), fresh = true, ema = 0;
    const frame = async tz => { stats.frames++; prog.frac = tz / td; await yieldFn(); last = now(); fresh = true; frameMs = 0; return !j.cancelled; };
    const gate = tz => (j.cancelled ? false : !fresh && now() - last + ema > budget() ? frame(tz) : true);
    const work = fn => { const t = now(); fn(); const d = now() - t; note(d); ema = ema ? 0.75 * ema + 0.25 * d : d; fresh = false; };
    // bin counts -> histograms, one label per unit of work (binMs: their sum)
    const toHists = async counts => {
      if (!counts) return null;
      const out = { hists: new Array(LABELS).fill(null), total: null }, totalAcc = createAcc(), acc = createAcc();
      for (let L = 0; L < LABELS; L++) { if (!(await gate(td))) return null; const t0 = now(); work(() => { out.hists[L] = binLabel(counts, L, w, acc, totalAcc); }); stats.binMs += now() - t0; }
      if (!(await gate(td))) return null; const t0 = now(); work(() => { out.total = accToHist(totalAcc); }); stats.binMs += now() - t0;
      return out;
    };
    client ||= createLabelCountClient(makeWorker);
    if (client.available()) {
      try { return await toHists(await client.count({ spec: plan.spec, bytes: plan.bytes, td, fill: plan.fill, gate, frame, work })); }
      catch (e) { if (j.cancelled || e?.disposed) return null; console.warn('label histogram worker failed, counting on the main thread', e); }
    }
    if (!(await gate(0))) return null;
    let K; work(() => { K = plan.kernel(); });
    const counts = new Uint32Array(LABELS * HIST_BINS), rows = Math.max(1, Math.floor(ROW_VOXELS / K.W));
    for (let tz = 0; tz < td; tz++) {
      const s = plan.slice(tz);
      for (let y = 0; y < K.H; y += rows) { if (!(await gate(tz))) return null; work(() => countSliceRows(K, counts, s, y, Math.min(K.H, y + rows))); }
    }
    return toHists(counts);
  }
  async function run(input) {
    cancel();
    lastInput = input;
    const hadError = !!error; // the board shows that error: a good result after it is a change
    const j = { cancelled: false }; job = j; error = '';
    prog.busy = true; prog.frac = 0;
    stats.maxFrameMs = 0; stats.frames = 0; stats.maxUnitMs = 0; stats.binMs = 0; frameMs = 0; const t0 = now();
    if (!result) emit(); // the board shows 「計算中」 instead of 「データなし」; with a result it keeps it (the progress is read per frame, not emitted)
    let quiet = false;
    try {
      const d = input.grid.dims, v = input.volDims || d, w = (v[0] * v[1] * v[2]) / (d[0] * d[1] * d[2]);
      const plan = timed(() => passPlan(input), 'planMs'), h = await count(j, plan, w);
      if (!h || j.cancelled) return false;
      const next = { key: input.key, shownMask: input.shownMask, hists: h.hists, total: h.total, dims: d, reduced: d[0] !== v[0] || d[1] !== v[1] || d[2] !== v[2] };
      // the same pass again (self-check, histForce) giving the same result: nothing on the board changes, so no redraw / upload
      if (sameResult(result, next) && !hadError) quiet = true; else result = next;
      stats.ms = now() - t0;
      return true;
    } catch (e) {
      if (!j.cancelled) { error = String(e?.message || e); console.error(e); }
      return false;
    } finally {
      if (job === j) { job = null; prog.busy = false; prog.frac = -1; if (!quiet) emit(); } // completion (a changed result) or failure: the board redraws once
    }
  }
  function cancel() { if (job) { job.cancelled = true; job = null; prog.busy = false; prog.frac = -1; } }
  return {
    run,
    rerun: () => (lastInput ? run(lastInput) : Promise.resolve(false)), // the self-check: the same pass again
    cancel,
    get result() { return result; },
    get error() { return error; },
    get busy() { return !!job; },
    progress: prog, // the same object every call (read every frame by the board)
    stats,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { cancel(); client?.dispose(); client = null; listeners.clear(); },
  };
}
