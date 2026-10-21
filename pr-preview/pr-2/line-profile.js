// Line profile: pure sampling code, no DOM and no app state (unit-tested in tests/unit/line-profile.test.js).
// A line is two voxel positions a, b ({i,j,k}: voxel CENTRES, index space). It is cut into N samples spaced at most the smallest voxel
// spacing apart (the last sample is exactly b), and every sample reads the raw HU by trilinear interpolation. The reading goes slice by
// slice (z ascending, at most two slices held at once), so a source-backed study is never copied: the caller supplies getSlice(z) ->
// Float32Array | Int16Array (or a promise of one).
import { createHist, binValues, histStats } from './histogram.js?v=20261021-build635';

export const PROFILE_MAX_SAMPLES = 4096;
const spacingOf = sp => [0, 1, 2].map(n => { const x = +(sp?.[n]); return Number.isFinite(x) && x > 0 ? x : 1; });

// samples along a -> b. Returns { n, step (mm), length (mm), dist: Float64Array (mm from a), x, y, z: Float64Array (voxel index coordinates) }
export function lineSamples(a, b, spacing, maxSamples = PROFILE_MAX_SAMPLES) {
  const s = spacingOf(spacing), d = [b.i - a.i, b.j - a.j, b.k - a.k], mm = Math.hypot(d[0] * s[0], d[1] * s[1], d[2] * s[2]);
  const minSp = Math.min(...s);
  const n = mm > 0 ? Math.min(Math.max(2, maxSamples | 0), Math.ceil(mm / minSp - 1e-9) + 1) : 1;
  const dist = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  for (let q = 0; q < n; q++) {
    const t = n > 1 ? q / (n - 1) : 0;
    dist[q] = t * mm; x[q] = a.i + d[0] * t; y[q] = a.j + d[1] * t; z[q] = a.k + d[2] * t;
  }
  return { n, step: n > 1 ? mm / (n - 1) : 0, length: mm, dist, x, y, z };
}

// bilinear value of one slice (w x h, row-major) at (x, y) in index space; coordinates are clamped into the slice
export function bilinear(slice, w, h, x, y) {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x; y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const r0 = y0 * w, r1 = y1 * w;
  const top = slice[r0 + x0] * (1 - fx) + slice[r0 + x1] * fx, bot = slice[r1 + x0] * (1 - fx) + slice[r1 + x1] * fx;
  return top * (1 - fy) + bot * fy;
}
// trilinear value from the two slices around z (lo = floor(z), hi = lo + 1; hi may be null when fz is 0)
export function trilinear(lo, hi, w, h, x, y, fz) {
  const v0 = bilinear(lo, w, h, x, y);
  if (!(fz > 0) || !hi) return v0;
  return v0 * (1 - fz) + bilinear(hi, w, h, x, y) * fz;
}
// slice indices the samples need (floor z, and the next one when z is fractional), ascending
export function neededSlices(samples, slices) {
  const set = new Set();
  for (let q = 0; q < samples.n; q++) {
    const z = Math.min(slices - 1, Math.max(0, samples.z[q])), z0 = Math.floor(z);
    set.add(z0); if (z - z0 > 1e-9 && z0 + 1 < slices) set.add(z0 + 1);
  }
  return [...set].sort((p, q) => p - q);
}
// Float64Array(n) of raw values, or null when cancelled. getSlice(z) -> the slice (or a promise of it).
// opts: { onProgress(done,total), yieldFn(), cancelled(), yieldMs }. Samples are visited in z order, holding at most two slices.
export async function sampleLine(samples, dims, getSlice, opts = {}) {
  const { columns: w, rows: h, slices: d } = dims, out = new Float64Array(samples.n);
  const order = Array.from({ length: samples.n }, (_, q) => q).sort((p, q) => samples.z[p] - samples.z[q]);
  const held = new Map(); // z -> slice (the last two kept)
  const get = async z => {
    if (held.has(z)) return held.get(z);
    const s = await getSlice(z);
    if (!s) throw new Error('slice ' + z + ' is not readable');
    held.set(z, s);
    if (held.size > 2) held.delete(held.keys().next().value);
    return s;
  };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let last = now();
  for (let m = 0; m < order.length; m++) {
    if (opts.cancelled?.()) return null;
    const q = order[m], z = Math.min(d - 1, Math.max(0, samples.z[q])), z0 = Math.floor(z), fz = z - z0;
    const lo = await get(z0), hi = fz > 1e-9 && z0 + 1 < d ? await get(z0 + 1) : null;
    out[q] = trilinear(lo, hi, w, h, samples.x[q], samples.y[q], hi ? fz : 0);
    if (opts.onProgress && m % 16 === 0) opts.onProgress(m + 1, order.length);
    if (opts.yieldFn && now() - last > (opts.yieldMs ?? 30)) { await opts.yieldFn(); last = now(); }
  }
  opts.onProgress?.(order.length, order.length);
  return opts.cancelled?.() ? null : out;
}

// stats of the sampled values: exact count / mean / SD (population) / min / max; percentiles from the 1-HU histogram (histogram.js)
export function profileStats(values) {
  const hist = createHist();
  let n = 0, sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) { if (v !== v) continue; n++; sum += v; if (v < min) min = v; if (v > max) max = v; }
  if (!n) return { count: 0, mean: null, sd: null, min: null, max: null, percentiles: { 5: null, 25: null, 50: null, 75: null, 95: null }, hist };
  binValues(hist, values);
  const mean = sum / n; let ss = 0;
  for (const v of values) if (v === v) ss += (v - mean) * (v - mean);
  return { count: n, mean, sd: Math.sqrt(ss / n), min, max, percentiles: histStats(hist).percentiles, hist };
}
// the sample nearest to a distance (mm) along the line (-1 when there are none); dist ascending
export function nearestSample(dist, mm) {
  const n = dist.length; if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (dist[mid] <= mm) lo = mid; else hi = mid; }
  return Math.abs(dist[lo] - mm) <= Math.abs(dist[hi] - mm) ? lo : hi;
}
