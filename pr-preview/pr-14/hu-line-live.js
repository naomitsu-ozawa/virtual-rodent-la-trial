// Live preview of the HU line while it is dragged. Pure module (no DOM, no app state; tests/unit/hu-line-live.test.js).
// The full-resolution read (line-profile.js sampleLine) can take seconds on a source-backed study, so while the pointer moves the
// panels use a COARSE sample (at most LIVE_MAX_SAMPLES points) read only from data that is ALREADY in memory (a cached / filtered
// plane, a resident array): never a decode, never a filter run, never a wait. Points whose data is not cached are NaN (a gap in the
// preview; profileStats skips them). On release the normal full read replaces the preview.
import { bilinear, lineSamples } from './line-profile.js?v=20261028-build684';

export const LIVE_MAX_SAMPLES = 192; // coarse cap (the full read uses up to 4096)
export const LIVE_INTERVAL_MS = 75;  // about 13 Hz

// Rate gate: step(now, dirty) -> { run: true } when a preview may run now, { run: false, wait: ms } when it must wait, { run: false, wait: 0 }
// when there is nothing to do. The caller does the scheduling (requestAnimationFrame / setTimeout), so the clock is injectable in tests.
export function createLiveGate(intervalMs = LIVE_INTERVAL_MS) {
  let last = -Infinity;
  return {
    step(now, dirty) {
      if (!dirty) return { run: false, wait: 0 };
      if (now - last >= intervalMs) { last = now; return { run: true, wait: 0 }; }
      return { run: false, wait: Math.max(1, Math.ceil(intervalMs - (now - last))) };
    },
    reset() { last = -Infinity; }
  };
}

// Latest-only scheduler on top of the gate: request() may be called on every pointer move; the work runs at most once per interval, on the
// next frame, and only for the newest request. cancel() drops a waiting run. Timers are injected (raf / setTimeout / clearTimeout / cancelRaf).
export function createLiveScheduler(work, { gate = createLiveGate(), now = () => performance.now(), raf = f => requestAnimationFrame(f), cancelRaf = id => cancelAnimationFrame(id), setT = setTimeout, clearT = clearTimeout } = {}) {
  let dirty = false, rafId = 0, timer = 0, seq = 0;
  const pump = () => {
    rafId = 0; timer = 0;
    const s = gate.step(now(), dirty);
    if (s.run) { dirty = false; work(++seq); } else if (s.wait > 0) timer = setT(() => { timer = 0; schedule(); }, s.wait);
  };
  const schedule = () => { if (!rafId && !timer) rafId = raf(pump); };
  return {
    request() { dirty = true; schedule(); },
    cancel() { dirty = false; if (rafId) cancelRaf(rafId); if (timer) clearT(timer); rafId = 0; timer = 0; seq++; },
    current: () => seq, // a result of work(n) is stale when current() !== n
    pending: () => dirty
  };
}

// ---- the coarse sampler ----
export const planeKindOf = (a, b) => {
  const same = (p, q) => Math.abs(p - q) < 1e-6;
  if (same(a.k, b.k) && same(a.k, Math.round(a.k))) return { plane: 'axial', idx: Math.round(a.k) };
  if (same(a.j, b.j) && same(a.j, Math.round(a.j))) return { plane: 'coronal', idx: Math.round(a.j) };
  if (same(a.i, b.i) && same(a.i, Math.round(a.i))) return { plane: 'sagittal', idx: Math.round(a.i) };
  return null;
};
// in-plane coordinates of the samples inside a plane image (columns x rows, row-major; coronal / sagittal rows run from the top slice down,
// the layout of source-filters.js getFiltered*PlaneValues): { u, v, w, h }
export function planeCoords(plane, samples, dims) {
  const d = dims.slices, u = new Float64Array(samples.n), v = new Float64Array(samples.n);
  for (let q = 0; q < samples.n; q++) {
    u[q] = plane === 'sagittal' ? samples.y[q] : samples.x[q];
    v[q] = plane === 'axial' ? samples.y[q] : d - 1 - samples.z[q];
  }
  return { u, v, w: plane === 'sagittal' ? dims.rows : dims.columns, h: plane === 'axial' ? dims.rows : d };
}
// values of the samples read from ONE plane image (the line lies on that plane)
export function sampleOnPlane(samples, plane, dims, values) {
  const { u, v, w, h } = planeCoords(plane, samples, dims), out = new Float64Array(samples.n);
  for (let q = 0; q < samples.n; q++) out[q] = bilinear(values, w, h, u[q], v[q]);
  return out;
}
// values read from axial slices that are already cached: peekSlice(z) -> the slice or null (never loads). A sample needs the slice below
// and (when z is fractional) the one above; when only one of them is cached that one is used, when none is the sample is NaN.
export function sampleFromCachedSlices(samples, dims, peekSlice) {
  const { columns: w, rows: h, slices: d } = dims, out = new Float64Array(samples.n), memo = new Map();
  const get = z => { if (!memo.has(z)) memo.set(z, peekSlice(z) || null); return memo.get(z); };
  for (let q = 0; q < samples.n; q++) {
    const z = Math.min(d - 1, Math.max(0, samples.z[q])), z0 = Math.floor(z), fz = z - z0, z1 = fz > 1e-9 && z0 + 1 < d ? z0 + 1 : -1;
    const lo = get(z0), hi = z1 >= 0 ? get(z1) : null, x = samples.x[q], y = samples.y[q];
    if (lo && (z1 < 0 || hi)) out[q] = z1 < 0 ? bilinear(lo, w, h, x, y) : bilinear(lo, w, h, x, y) * (1 - fz) + bilinear(hi, w, h, x, y) * fz;
    else if (lo || hi) out[q] = bilinear(lo || hi, w, h, x, y);
    else out[q] = NaN;
  }
  return out;
}
// the coarse preview of the line a -> b: { samples, values, filled } or null when nothing at all could be read.
// peek = { plane(plane, idx) -> plane image | null, slice(z) -> axial slice | null } (cache-only readers, supplied by the app)
export function liveProfile(a, b, spacing, dims, peek, maxSamples = LIVE_MAX_SAMPLES) {
  const samples = lineSamples(a, b, spacing, maxSamples), kind = planeKindOf(a, b);
  let values = null;
  if (kind) { const img = peek.plane(kind.plane, kind.idx); if (img) values = sampleOnPlane(samples, kind.plane, dims, img); }
  if (!values) values = sampleFromCachedSlices(samples, dims, peek.slice);
  let filled = 0; for (const x of values) if (x === x) filled++;
  return filled ? { samples, values, filled } : null;
}
