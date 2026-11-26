// The measurement of the parts' own tiles (n764 plan 4-1, stage 0): what the parts' rays do in the loop, read from the counting twin of the performance record (docs/vr-wgsl-core.js counters: 'part',
// docs/vr-wgpu.js partProbeCounters). Nothing here draws: it decodes the probe windows (Uint32Array, PART_COUNTER_FIELDS per pixel) and makes the lines of the performance record.
// The part is drawn as D0 (the display text with the distance texture split off, no pre-pass); the twin is the display text with the same grid of samples (distSplit moves no sample), so its loop counts are the display's.
//
// Per part and per window kind:
//   whole  = the part's own rect on the screen fitted into the 64 x 64 window (every ray of the part, at a coarser pitch: the per-ray figures)
//   native = a 64 x 64 window at the pass's own pixel pitch; from probe to probe it steps across the part's rect (a low-discrepancy sequence; centred when the rect is smaller than the window): how the rays lie together, the 8 x 8 tile figures (a tile is a block of 8 x 8 window pixels)
// Figures (a ray = a pixel whose outcome is hit / pass / accstop; outcome discard = the ray left before the march: outside the part's box, counted apart):
//   loops/ray        = the loop iterations of a ray (iters)
//   partOcc skips    = the iterations that the 8^3 blocks of the part's field ended with a jump (partSkips); each one still fetches the class texture once (not in clsReads)
//   before 1st read  = the partOcc skips made before the ray's first march sample was read (partSkips0, clsReads still 0)
//   skip-only ray    = a ray whose every iteration was a partOcc skip (iters > 0 and partSkips == iters): it never read a march sample
//   skip-only tile   = a tile whose rays (those with iters > 0) are all skip-only; mixed = some are; none = none is; empty = no ray was marched in it (all discard)
import { PART_COUNTER_FIELDS } from './vr-wgsl-core.js?v=20261126-build767';

export const PP_BLOCK = 8; // the tile of the pre-pass is 8 x 8 px
const F = Object.fromEntries(PART_COUNTER_FIELDS.map((k, i) => [k, i]));
export const PP_STRIDE = PART_COUNTER_FIELDS.length;
const KEEP = 100000; // loops of the rays kept per aggregate (for the quantiles)

export const ppLabel = p => (p?.kind === 1 ? 'result' : p?.kind === 2 ? 'child' : 'part' + (p?.kind ?? '?')) + '#' + (p?.id ?? '?');

// one probe window -> its figures (a plain object of sums; no arrays except `loops`)
export function decodePartWindow(counters, w, h) {
  if (!counters || !(w > 0) || !(h > 0) || counters.length < w * h * PP_STRIDE) return null;
  const r = { px: 0, rays: 0, miss: 0, hits: 0, loops: [], sumIters: 0, sumSkips: 0, sumSkips0: 0, sumSkipSteps: 0, sumClsReads: 0, raysWithSkips: 0, raysSkip0: 0, raysSkipOnly: 0, raysNoRead: 0, raysNoLoop: 0, skipOnlyIters: 0,
    tiles: { n: 0, skipOnly: 0, mixed: 0, none: 0, empty: 0, itersSkipOnly: 0 } };
  const bw = Math.ceil(w / PP_BLOCK), bh = Math.ceil(h / PP_BLOCK), tl = Array.from({ length: bw * bh }, () => ({ ray: 0, so: 0, other: 0, iters: 0 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * PP_STRIDE, oc = counters[o + F.outcome];
    if (oc === 0) continue;
    r.px++;
    if (oc === 4) { r.miss++; continue; }
    const it = counters[o + F.iters], ps = counters[o + F.partSkips], ps0 = counters[o + F.partSkips0], cr = counters[o + F.clsReads], t = tl[((y / PP_BLOCK) | 0) * bw + ((x / PP_BLOCK) | 0)];
    r.rays++; if (oc === 1) r.hits++;
    if (r.loops.length < KEEP) r.loops.push(it);
    r.sumIters += it; r.sumSkips += ps; r.sumSkips0 += ps0; r.sumSkipSteps += counters[o + F.partSkipSteps]; r.sumClsReads += cr;
    t.ray++; t.iters += it;
    if (ps > 0) r.raysWithSkips++;
    if (ps0 > 0) r.raysSkip0++;
    if (it === 0) { r.raysNoLoop++; continue; }
    if (cr === 0) r.raysNoRead++;
    if (ps === it) { r.raysSkipOnly++; r.skipOnlyIters += it; t.so++; } else t.other++;
  }
  for (const t of tl) {
    r.tiles.n++;
    if (!t.ray) r.tiles.empty++;
    else if (t.so && !t.other) { r.tiles.skipOnly++; r.tiles.itersSkipOnly += t.iters; }
    else if (t.so) r.tiles.mixed++;
    else r.tiles.none++;
  }
  return r;
}

const quantile = (a, q) => { if (!a.length) return null; const v = a.slice().sort((x, y) => x - y), i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
const f1 = x => (x === null || x === undefined || !Number.isFinite(x) ? '-' : (Math.round(x * 10) / 10).toString());
const pc = (a, b) => (b > 0 ? Math.round(1000 * a / b) / 10 + '%' : '-');

export function createPartProbeLog() {
  const aggs = new Map(); // 'kind#id|window' -> the sums of its windows
  const notes = [], st = { rounds: 0, noPart: 0, partsMax: 0, pending: 0, busy: 0, windows: 0 }; // st: the rounds of the probe: how many found no part, the most parts in one, the probes that found a program still being made / the last read not done
  const wayOf = new Map(); // 'kind#id' -> the last way the display drew the part with (vr-wgpu.js stats.vways)
  const add = (part, windowKind, counters, w, h) => {
    const d = decodePartWindow(counters, w, h); if (!d) return false;
    const key = ppLabel(part) + '|' + windowKind;
    let a = aggs.get(key);
    if (!a) aggs.set(key, a = { label: ppLabel(part), window: windowKind, windows: 0, px: 0, rays: 0, miss: 0, hits: 0, loops: [], sumIters: 0, sumSkips: 0, sumSkips0: 0, sumSkipSteps: 0, sumClsReads: 0, raysWithSkips: 0, raysSkip0: 0, raysSkipOnly: 0, raysNoRead: 0, raysNoLoop: 0, skipOnlyIters: 0,
      tiles: { n: 0, skipOnly: 0, mixed: 0, none: 0, empty: 0, itersSkipOnly: 0 } });
    a.windows++; st.windows++;
    for (const k of ['px', 'rays', 'miss', 'hits', 'sumIters', 'sumSkips', 'sumSkips0', 'sumSkipSteps', 'sumClsReads', 'raysWithSkips', 'raysSkip0', 'raysSkipOnly', 'raysNoRead', 'raysNoLoop', 'skipOnlyIters']) a[k] += d[k];
    for (const k of Object.keys(a.tiles)) a.tiles[k] += d.tiles[k];
    for (const v of d.loops) if (a.loops.length < KEEP * 4) a.loops.push(v);
    if (part?.way) wayOf.set(ppLabel(part), part.way);
    return true;
  };
  const round = r => { st.rounds++; if (!(r?.parts > 0)) st.noPart++; st.partsMax = Math.max(st.partsMax, r?.parts | 0); st.pending += r?.pending | 0; st.busy += r?.busy | 0; };
  const note = text => { if (text && !notes.includes(text) && notes.length < 8) notes.push(String(text).slice(0, 200)); };
  const lines = () => {
    const L = ['-- parts: the parts\' rays in the loop (n764 4-1 stage 0; the counting twin with the partOcc counts, probe windows of 64 x 64 px; the part is drawn as D0) --'];
    L.push('legend: whole = the part\'s rect fitted into the window (per-ray figures); native = the pass\'s own pixel pitch, the window stepping across the part\'s rect from probe to probe (tiles = 8 x 8 window px). ray = a pixel that was marched; miss = left before the march (outside the part\'s box). loops = loop iterations;'
      + ' skips = iterations that partOcc ended with a jump (each also fetches the class texture once, not in reads); before 1st read = skips made while no march sample had been read yet; skip-only ray = every iteration was a partOcc skip (it read no march sample); skip-only tile = every ray of the 8 x 8 tile with iterations is skip-only');
    L.push('status: ' + st.rounds + ' probe rounds (' + st.noPart + ' with no part in the frame), most parts in a frame ' + st.partsMax + ', windows decoded ' + st.windows + ', probes that found the program still being made ' + st.pending + ', probes skipped for a read not done ' + st.busy);
    for (const n of notes) L.push('note: ' + n);
    const keys = [...aggs.keys()].sort();
    for (const k of keys) {
      const a = aggs.get(k), n = a.rays, w = way => way ? ' [' + way + ']' : '';
      if (!n) { L.push(a.label + w(wayOf.get(a.label)) + ' ' + a.window + ': ' + a.windows + ' windows, no ray marched (miss ' + a.miss + ' px)'); continue; }
      const sk = (a.sumSkips / n), s0 = (a.sumSkips0 / n), ss = (a.sumSkipSteps / n);
      L.push(a.label + w(wayOf.get(a.label)) + ' ' + a.window + ': ' + a.windows + ' windows, ' + n + ' rays (' + a.hits + ' hit), miss ' + pc(a.miss, a.miss + n) + ' of the px covered'
        + ' | loops/ray mean ' + f1(a.sumIters / n) + ' p50 ' + f1(quantile(a.loops, 0.5)) + ' p90 ' + f1(quantile(a.loops, 0.9)) + ' max ' + f1(quantile(a.loops, 1)) + ', total ' + f1(a.sumIters / a.windows) + '/window, cls reads/ray ' + f1(a.sumClsReads / n)
        + ' | partOcc skips/ray ' + f1(sk) + ' (before the 1st read ' + f1(s0) + '; rays with a skip ' + pc(a.raysWithSkips, n) + ', starting with one ' + pc(a.raysSkip0, n) + '), grid points jumped/ray ' + f1(ss)
        + ' | skip-only rays ' + a.raysSkipOnly + ' (' + pc(a.raysSkipOnly, n) + ' of rays, ' + pc(a.skipOnlyIters, a.sumIters) + ' of the loops), rays with no march read ' + a.raysNoRead + ' (' + pc(a.raysNoRead, n) + ')'
        + (a.window === 'native' ? ' | tiles ' + a.tiles.n + ': skip-only ' + a.tiles.skipOnly + ' (' + pc(a.tiles.skipOnly, a.tiles.n - a.tiles.empty) + ' of the marched), mixed ' + a.tiles.mixed + ', none ' + a.tiles.none + ', empty ' + a.tiles.empty + '; loops in skip-only tiles ' + pc(a.tiles.itersSkipOnly, a.sumIters) : ''));
    }
    return L;
  };
  return { add, round, note, lines, get size() { return aggs.size; } };
}
