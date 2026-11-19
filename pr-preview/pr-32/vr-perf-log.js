// VR performance record (the Quest 3 WebGPU / WebGL comparison): one row a second for both the WebGL and the WebGPU session, kept in a ring buffer, with a summary of the stretches the menu was closed.
// Pure (no DOM, no three.js): vr-view.js feeds it (frame / add / row) and shows the text on the page after the session. Nothing here changes what is drawn.
// A row: fps, how many frame intervals were 1 / 2 / 3+ refresh periods, the GPU ms of the volume pass and of the main render (WebGL: EXT_disjoint_timer_query; WebGPU: timestamp-query / three's timestamps),
// the JS ms of the app's frame, the CPU ms of renderer.render(), (WebGPU only) the frame's GPU timeline and CPU timeline: span / gap / oth / cpu / swd, and wake / pre / vlat / vdrop (see the note lines of the report), and the state the drawing choices were made in (scale f, periphery, data cap, auto level / step, step in voxels, covered px, size, menu, target Hz, foveation).
export const PERF_KEY = 'vrl-vr-perf'; // + '-webgl' / '-webgpu': one mirror per kind (a WebGPU session does not overwrite the WebGL one)
export const PERF_MIRROR_ROWS = 120; // the last rows the localStorage mirror keeps (the whole log stays in memory and in the page's text)
export const PERF_MAX_ROWS = 600; // 10 minutes of rows
const MEANS = ['vol', 'main', 'js', 'render', 'cpu', 'swd', 'wake', 'pre', 'vlat', 'vdrop']; // the per-frame ms, averaged over the second
const MEDIANS = ['span', 'gap']; // the per-frame ms, the median of the second (WebGPU: the frame's GPU span and the GPU idle before it)
const median = a => { const v = a.filter(x => Number.isFinite(x)).sort((p, q) => p - q); if (!v.length) return null; const m = v.length >> 1; return v.length & 1 ? v[m] : (v[m - 1] + v[m]) / 2; };
export const perfMedian = median;
// which interval a frame gap is: 0 = one refresh period (up to 1.5 of the budget), 1 = two (up to 2.5), 2 = three or more
export const gapBucket = (dtMs, budgetMs) => { const r = dtMs / Math.max(1, budgetMs); return r < 1.5 ? 0 : r < 2.5 ? 1 : 2; };
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
export function createPerfLog({ kind = 'webgl', mode = 'vr', now = () => performance.now(), store = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(), key = PERF_KEY + '-' + kind, maxRows = PERF_MAX_ROWS, saveEveryMs = 5000 } = {}) {
  const t0 = now();
  let lastTs = null, rowAt = t0, savedAt = t0, frames = 0, gaps = [0, 0, 0], dropped = 0;
  const acc = Object.fromEntries(MEANS.map(k => [k, { s: 0, n: 0 }])), smp = Object.fromEntries(MEDIANS.map(k => [k, []]));
  const rows = [], meta = {}; // meta: free text lines about the session (which GPU timers existed, ...) for the header of the report
  // one frame of the app's loop (ts = the frame's time in ms, budgetMs = 1000 / target Hz): the gap since the previous frame goes into the interval counts
  const frame = (ts, budgetMs) => { frames++; if (lastTs !== null && ts > lastTs) gaps[gapBucket(ts - lastTs, budgetMs)]++; lastTs = ts; };
  // a ms value (n = how many frames it stands for: a sum taken over n frames)
  const add = (k, ms, n = 1) => { const a = acc[k]; if (a && Number.isFinite(ms) && ms >= 0 && n > 0) { a.s += ms; a.n += n; } };
  // one per-frame ms value of a median column (span, gap)
  const sample = (k, ms) => { const a = smp[k]; if (a && Number.isFinite(ms) && a.length < 1000) a.push(ms); };
  // the localStorage mirror: every few seconds, not every row (the string of 600 rows is not made once a second)
  const save = (at = now(), force = false) => {
    if (!force && at - savedAt < saveEveryMs) return;
    savedAt = at;
    try { store?.setItem(key, JSON.stringify({ kind, mode, dropped, meta, rows: rows.slice(-PERF_MIRROR_ROWS) })); } catch { /* private window / full */ }
  };
  // the end of a second: the row = the accumulators + the state given; they start again. snap = { f, per, cap, auto, lv, si, step, cov, size, menu, hz, fov, ... }
  const row = (snap = {}, at = now()) => {
    const el = Math.max(1, at - rowAt);
    const x = { t: Math.round((at - t0) / 1000), fps: r1(frames * 1000 / el), g1: gaps[0], g2: gaps[1], g3: gaps[2] };
    for (const k of MEANS) x[k] = acc[k].n ? r2(acc[k].s / acc[k].n) : null;
    for (const k of MEDIANS) x[k] = r2(median(smp[k]));
    x.oth = Number.isFinite(x.span) && Number.isFinite(x.vol) && Number.isFinite(x.main) ? r2(x.span - x.vol - x.main) : null; // the GPU work in the span that neither the volume pass nor three.js' main render timer covers (the second's median span minus the second's mean vol and main)
    for (const k of Object.keys(snap)) { const v = snap[k]; x[k] = typeof v === 'number' ? (Number.isInteger(v) ? v : Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null) : v; } // fractions to 3 decimals
    if (rows.length >= maxRows) { rows.shift(); dropped++; }
    rows.push(x);
    rowAt = at; frames = 0; gaps = [0, 0, 0]; for (const k of MEANS) { acc[k].s = 0; acc[k].n = 0; } for (const k of MEDIANS) smp[k].length = 0;
    save(at);
    return x;
  };
  const flush = () => save(now(), true);
  // the medians of the rows with the menu closed (the stretch that is the view, not the menu's own cost); null where no row has a value
  const summary = () => {
    const closed = rows.filter(r => !r.menu && !r.rec && r.fps > 0), pick = k => median(closed.map(r => r[k])); // rec = 1: the volume breakdown's recording (its shadow passes load the GPU): left out
    const recLeft = rows.filter(r => !r.menu && r.rec && r.fps > 0).length;
    return { rows: rows.length, closedRows: closed.length, recLeft, dropped, fps: pick('fps'), vol: pick('vol'), main: pick('main'), render: pick('render'), js: pick('js'), span: pick('span'), gap: pick('gap'), oth: pick('oth'), cpu: pick('cpu'), swd: pick('swd'), wake: pick('wake'), pre: pick('pre'), vlat: pick('vlat'), vdrop: pick('vdrop'), f: pick('f'), step: pick('step'), g1: closed.reduce((s, r) => s + r.g1, 0), g2: closed.reduce((s, r) => s + r.g2, 0), g3: closed.reduce((s, r) => s + r.g3, 0) };
  };
  return { kind, mode, rows, meta, get dropped() { return dropped; }, frame, add, sample, row, save, flush, summary };
}
const COLS = [['t', 4], ['fps', 5], ['g1', 4], ['g2', 3], ['g3', 3], ['vol', 6], ['main', 6], ['render', 6], ['js', 6], ['span', 6], ['gap', 6], ['oth', 6], ['cpu', 6], ['swd', 6], ['wake', 6], ['pre', 6], ['vlat', 6], ['vdrop', 6], ['f', 5], ['per', 5], ['cap', 5], ['auto', 4], ['lv', 5], ['si', 3], ['step', 5], ['cov', 8], ['w', 5], ['h', 5], ['size', 6], ['menu', 4], ['hz', 4], ['fov', 4], ['rec', 3]];
const cell = (v, w) => String(v === null || v === undefined ? '-' : (typeof v === 'boolean' ? +v : v)).padStart(w);
// the text of the page panel / the copy button / the saved file: the header, the summary, then the rows
export function perfReport(p, { build = '', ua = '', hz = null } = {}) {
  const L = [], s = p.summary(), f = v => (v === null ? '-' : String(Math.round(v * 100) / 100));
  const name = p.kind === 'webgpu' ? 'WebGPU' : 'WebGL';
  L.push('VR performance log · ' + name + ' · ' + p.mode + (build ? ' · build ' + build : '') + (hz ? ' · target ' + hz + ' Hz' : ''));
  if (ua) L.push('UA: ' + ua);
  for (const [k, v] of Object.entries(p.meta || {})) L.push(k + ': ' + v);
  L.push('-- summary (rows with the menu closed: ' + s.closedRows + ' of ' + s.rows + (s.recLeft ? ', ' + s.recLeft + ' rows of the breakdown recording left out' : '') + (s.dropped ? ', ' + s.dropped + ' older rows dropped' : '') + ')');
  L.push('median fps ' + f(s.fps) + ' · volume GPU ' + f(s.vol) + ' ms · main GPU ' + f(s.main) + ' ms · render() CPU ' + f(s.render) + ' ms · JS ' + f(s.js) + ' ms · scale f ' + f(s.f) + ' · step ' + f(s.step) + ' voxel');
  L.push('frame intervals (menu closed): 1 period ' + s.g1 + ' · 2 periods ' + s.g2 + ' · 3+ periods ' + s.g3);
  L.push('GPU timeline (WebGPU, menu closed): span ' + f(s.span) + ' ms · gap ' + f(s.gap) + ' ms · other GPU work (span - vol - main) ' + f(s.oth) + ' ms · CPU frame start to submit end ' + f(s.cpu) + ' ms · submit to onSubmittedWorkDone ' + f(s.swd) + ' ms · wake ' + f(s.wake) + ' ms · pre ' + f(s.pre) + ' ms · vlat ' + f(s.vlat) + ' ms · vdrop ' + f(s.vdrop) + ' (share of vlat samples dropped)');
  L.push('note: a "-" is no sample in that second (or no timer). WebGL at f = 1 draws the volume straight into the XR framebuffer (vol empty, main includes the march); the WebGPU volume is always an offscreen pass.');
  L.push('note: span = ms from the first GPU start (the volume pass) to the end of the last GPU work of that XR frame (a marker pass after the last submit), median of the second; gap = ms the GPU was idle between the previous frame\'s last end and this frame\'s first start, median of the second; both from this device\'s own timestamp-query values (a "-" = no timer).');
  L.push('note: oth = span - vol - main (this row\'s median span minus the mean vol and main): GPU time inside the span that no timer covers; main is three.js\' own pass-duration sum (every 4th frame; a duration only, three.js\' timestamps are not on the same clock as span / gap) and the marker is an approximate end on a tiled GPU.');
  L.push('note: cpu = mean ms from the start of the XR frame callback to the end of the last submit (the marker\'s included); swd = mean ms from that submit to queue.onSubmittedWorkDone (sampled every 4th frame, one at a time).');
  L.push('note: wake = ms from the moment queue.onSubmittedWorkDone of the previous sampled frame returned to the start of the next XR frame callback (sampled with swd: every 4th frame; recorded only for frames whose completion arrived before the next frame started, i.e. the GPU kept up); pre = ms from the start of the XR frame callback to the return of the volume pass submit; vlat = ms from the volume pass submit to queue.onSubmittedWorkDone minus that frame\'s volume GPU ms (every 4th frame, one wait at a time, shared with swd). The completion promise resolves only after the frame callback returns, so the value has the CPU time up to the end of the callback as its floor: samples at that floor (GPU already done) are left out and counted in vdrop (share of samples dropped); a negative vlat is rounded to 0. WebGL: "-".');
  L.push('note: vlat / vdrop from build 749 on are not comparable with build 748 and earlier (the first frame end after the submit is kept as the end of the CPU time; before, a later frame end could overwrite it).');
  if (p.vb) for (const t of volBreakdownReport(p)) L.push(t);
  L.push('-- rows, one a second (t s; g1 / g2 / g3 = frame intervals of 1 / 2 / 3+ periods; vol / main = GPU ms, render = render() CPU ms, js = JS ms, span / gap / oth = GPU ms (see the notes), cpu / swd / wake / pre / vlat = CPU ms, vdrop = share 0-1 (see the notes); f = scale, per = periphery scale, cap = data cap, auto = auto quality on, lv = auto level, si = auto step index, step = voxels, cov = covered px, w / h = XR size, size = view scale, menu = open, fov = fixed foveation, rec = 1 while the volume breakdown was recording (WebGPU only; see its notes))');
  L.push(COLS.map(([k, w]) => k.padStart(w)).join(' '));
  for (const r of p.rows) L.push(COLS.map(([k, w]) => cell(r[k], w)).join(' '));
  return L.join('\n');
}
// the file name of the saved record: WebGPU keeps the diagnostics' name (its text starts with the stages), WebGL gets vrl-vr-perf-webgl-<build>-<date>-<time>.txt (both carry the log)
export function perfFileName(kind, build, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return 'vrl-vr-' + (kind === 'webgpu' ? 'gpu-diag-' : 'perf-webgl-') + (String(build ?? '').replace(/[^\w.-]/g, '') || 'x') + '-' + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + '-' + p(now.getHours()) + p(now.getMinutes()) + '.txt';
}

// ---- the volume breakdown (WebGPU, one 30 s recording started from the detail tab; vr-wgpu.js shadow passes and counting probe) ----
// The shadow passes are throw-away copies of a frame's low pass with one step taken out; `add` gets each one's GPU ms and the same frame's real low pass ms. This is a pure collector (no DOM, no GPU): it never touches the log's own columns.
// How each variant of the eight is made (the host reads this table): abl = another program text (docs/vr-wgsl-core.js ablate), overrides = another uniform value.
export const BD_VARIANTS = ['same', 'box', 'simple', 'noGrad', 'noRefine', 'noShade', 'withCreep', 'noJump'];
export const BD_SPECS = {
  same: { name: 'same' }, box: { name: 'box', overrides: { diag: 1 } }, simple: { name: 'simple', overrides: { diag: 3 } },
  noGrad: { name: 'noGrad', abl: 'grad' }, noRefine: { name: 'noRefine', abl: 'refine' }, noShade: { name: 'noShade', abl: 'shade' },
  withCreep: { name: 'withCreep', overrides: { useSkip: 1 } }, // the display runs without the creep skip (useSkip 0); this pass turns it on (the host skips it when its bits are not valid)
  noJump: { name: 'noJump', overrides: { jumpOn: 0 } },
};
export const BD_PROBE_FIELDS = ['outcome', 'iters', 'creep', 'jumps', 'skipReads', 'clsReads', 'refineReads', 'gradReads', 'near4Steps', 'near4Jumps', 'near8Steps', 'near8Jumps', 'near16Steps', 'near16Jumps']; // the u32 of a probe pixel (docs/vr-wgsl-core.js COUNTER_FIELDS)
const BD_STRIDE = BD_PROBE_FIELDS.length;
export const BD_NEAR_R = [4, 8, 16]; // the approach radii in voxels (grid-index units of the distance bytes); the field pair of R is 8 + 2 * index
const BD_OUTCOMES = ['hit', 'pass', 'accstop', 'discard']; // outcome value 1..4 (0 = the pixel was not covered)
const BD_BLOCK = 8; // 8 x 8 pixels stand in for a GPU wave
const quantile = (a, q) => { const v = a.filter(x => Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
const newOutcomeAgg = () => ({ px: 0, steps: [], iters: 0, jumps: 0, creep: 0, skipReads: 0, near: BD_NEAR_R.map(() => ({ n: 0, steps: 0, jumps: 0 })) }); // one outcome's share of the probe (hit, pass): its steps, jumps, creep steps and skipTex reads; near[i] = the rays that came within BD_NEAR_R[i] of a surface (count, sums of their steps and jumps up to that sample)
const newProbeAgg = () => ({ windows: 0, px: 0, steps: [], by: [newOutcomeAgg(), newOutcomeAgg()], sums: { iters: 0, creep: 0, jumps: 0, skipReads: 0, clsReads: 0, refineReads: 0, gradReads: 0 }, outcome: [0, 0, 0, 0], blocks: 0, blockRatio: [], mixed: 0 });
export function createVolBreakdown() {
  const ratios = Object.fromEntries(BD_VARIANTS.map(v => [v, []])), lows = [], probes = { whole: newProbeAgg(), native: newProbeAgg() };
  // one shadow pass of `variant`: its GPU ms and the same frame's low pass GPU ms (both > 0 and finite, else it is not a sample)
  const add = (variant, shadowMs, lowMs) => {
    if (!ratios[variant] || !Number.isFinite(shadowMs) || !Number.isFinite(lowMs) || shadowMs < 0 || !(lowMs > 0)) return false;
    ratios[variant].push(shadowMs / lowMs); lows.push(lowMs);
    return true;
  };
  // one counting probe window: counters = Uint32Array(w * h * BD_PROBE_FIELDS.length) (BD_PROBE_FIELDS per pixel; outcome 0 = not covered); kind = 'whole' | 'native'
  const addProbe = (kind, counters, w, h) => {
    const a = probes[kind]; if (!a || !counters || !(w > 0) || !(h > 0) || counters.length < w * h * BD_STRIDE) return false;
    a.windows++;
    const nb = Math.ceil(w / BD_BLOCK) * Math.ceil(h / BD_BLOCK), bn = new Uint16Array(nb), bh = new Uint16Array(nb), bs = new Float64Array(nb), bm = new Float64Array(nb);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * BD_STRIDE, oc = counters[o];
      if (oc < 1 || oc > 4) continue;
      a.px++; a.outcome[oc - 1]++;
      if (a.steps.length < 200000) a.steps.push(counters[o + 1]);
      if (oc <= 2) { const b = a.by[oc - 1]; b.px++; if (b.steps.length < 200000) b.steps.push(counters[o + 1]); b.iters += counters[o + 1]; b.jumps += counters[o + 3]; b.creep += counters[o + 2]; b.skipReads += counters[o + 4]; BD_NEAR_R.forEach((_, i) => { const st = counters[o + 8 + 2 * i]; if (st > 0) { const nr = b.near[i]; nr.n++; nr.steps += st; nr.jumps += counters[o + 9 + 2 * i]; } }); }
      a.sums.iters += counters[o + 1]; a.sums.creep += counters[o + 2]; a.sums.jumps += counters[o + 3]; a.sums.skipReads += counters[o + 4]; a.sums.clsReads += counters[o + 5]; a.sums.refineReads += counters[o + 6]; a.sums.gradReads += counters[o + 7];
      const work = counters[o + 1] + counters[o + 6] + counters[o + 7], b = (y / BD_BLOCK | 0) * Math.ceil(w / BD_BLOCK) + (x / BD_BLOCK | 0);
      bn[b]++; if (oc === 1) bh[b]++; bs[b] += work; if (work > bm[b]) bm[b] = work;
    }
    for (let b = 0; b < nb; b++) {
      if (!bn[b]) continue;
      a.blocks++;
      if (bh[b] > 0 && bh[b] < bn[b]) a.mixed++;
      if (bs[b] > 0) a.blockRatio.push(bm[b] / (bs[b] / bn[b]));
    }
    return true;
  };
  // the per-pixel means of one outcome (null where no pixel ended so) and the 95th percentile of its steps
  const outcomeSummary = b => {
    if (!b.px) return null;
    const st = b.steps.slice().sort((x, y) => x - y);
    // near = per radius: the rays that came within R of a surface: their mean steps / jumps up to the first such sample (null = none did) and never = the share of this outcome's rays that never did
    const near = BD_NEAR_R.map((R, i) => { const x = b.near[i]; return { R, reached: x.n, steps: x.n ? x.steps / x.n : null, jumps: x.n ? x.jumps / x.n : null, never: (b.px - x.n) / b.px }; });
    return { px: b.px, steps: { mean: b.iters / b.px, p95: st[Math.min(st.length - 1, Math.ceil(0.95 * st.length) - 1)] }, jumps: b.jumps / b.px, creep: b.creep / b.px, skip: b.skipReads / b.px, near };
  };
  const probeSummary = a => {
    if (!a.windows || !a.px) return null;
    const m = k => a.sums[k] / a.px, st = a.steps.slice().sort((x, y) => x - y), pq = q => st[Math.min(st.length - 1, Math.ceil(q * st.length) - 1)];
    return { windows: a.windows, px: a.px / a.windows, steps: { mean: m('iters'), p50: pq(0.5), p95: pq(0.95), max: st[st.length - 1] }, creep: m('creep'), jumps: m('jumps'),
      reads: { skip: m('skipReads'), cls: m('clsReads'), refine: m('refineReads'), grad: m('gradReads') },
      outcome: Object.fromEntries(BD_OUTCOMES.map((k, i) => [k, a.outcome[i] / a.px])),
      byOutcome: Object.fromEntries(['hit', 'pass'].map((k, i) => [k, outcomeSummary(a.by[i])])),
      blocks: a.blocks, blockMax: a.blockRatio.length ? { median: quantile(a.blockRatio, 0.5), p90: quantile(a.blockRatio, 0.9) } : null, mixedShare: a.blocks ? a.mixed / a.blocks : null };
  };
  // R_v = the median ratio of a variant, M = the median of the real low pass ms of these frames; the cost of a step = (R_same - R_v) x M
  const summary = () => {
    const M = median(lows), R = {}, out = { M, nLow: lows.length, variants: {}, split: null, probes: { whole: probeSummary(probes.whole), native: probeSummary(probes.native) } };
    for (const v of BD_VARIANTS) R[v] = median(ratios[v]);
    for (const v of BD_VARIANTS) {
      const q1 = quantile(ratios[v], 0.25), q3 = quantile(ratios[v], 0.75);
      out.variants[v] = { n: ratios[v].length, R: R[v], q1, q3, est: v !== 'same' && R.same !== null && R[v] !== null && M !== null ? (R.same - R[v]) * M : null };
    }
    const e = out.variants, ok = [R.box, R.simple, R.same, e.noRefine.est, e.noGrad.est, e.noShade.est].every(x => x !== null && x !== undefined) && M !== null;
    if (ok) {
      const fixed = R.box * M, shading = e.noShade.est, march = (R.simple - R.box) * M - shading, refine = e.noRefine.est, gradient = e.noGrad.est, sum = fixed + march + refine + gradient + shading;
      out.split = { fixed, march, refine, gradient, shading, sum, pct: sum / M * 100 };
    }
    return out;
  };
  const f1 = v => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) : '-'), f2 = v => (Number.isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : '-');
  // the lines of the report's section: seconds = the recording's length, volMs = the median vol column of the recorded rows (the low pass's share of the whole volume work)
  const lines = ({ volMs = null } = {}) => {
    const s = summary(), L = [];
    L.push('rec ' + (Number.isFinite(api.seconds) ? Math.round(api.seconds) : '-') + ' s · shadow every 4th frame · low pass median ' + f2(s.M) + ' ms (' + s.nLow + ') · low share of vol ' + (s.M !== null && volMs > 0 ? f2(s.M / volMs) : '-'));
    for (const v of BD_VARIANTS) { const x = s.variants[v]; L.push('abl ' + v + ' n=' + x.n + ' ratio ' + f2(x.R) + ' (IQR ' + (x.q1 === null ? '-' : f2(x.q1) + '-' + f2(x.q3)) + ') · est ' + (x.est === null ? '-' : f1(x.est) + ' ms')); }
    const sp = s.split;
    L.push(sp ? 'split: fixed(box) ' + f1(sp.fixed) + ' ms · march ' + f1(sp.march) + ' ms · refine ' + f1(sp.refine) + ' ms · gradient ' + f1(sp.gradient) + ' ms · shading ' + f1(sp.shading) + ' ms · sum ' + f1(sp.sum) + ' ms vs low ' + f1(s.M) + ' ms (' + Math.round(sp.pct) + ' %)' : 'split: fixed(box) - · march - · refine - · gradient - · shading - · sum vs low -');
    const w = s.probes.whole, n = s.probes.native;
    L.push(w ? 'probe whole: windows ' + w.windows + ' · px ' + Math.round(w.px) + ' · steps mean/p50/p95/max ' + [f1(w.steps.mean), w.steps.p50, w.steps.p95, w.steps.max].join('/') + ' · creep ' + f1(w.creep) + ' · jumps ' + f1(w.jumps)
      + ' · reads per px skipTex/cls/refine/grad ' + [w.reads.skip, w.reads.cls, w.reads.refine, w.reads.grad].map(f1).join('/') + ' · outcome hit/pass/accstop/discard ' + BD_OUTCOMES.map(k => Math.round(w.outcome[k] * 100)).join('/') + ' %'
      : 'probe whole: - (no probe read back)');
    const bo = o => (o ? 'steps mean/p95 ' + f1(o.steps.mean) + '/' + o.steps.p95 + ' · jumps ' + f1(o.jumps) + ' · creep ' + f1(o.creep) + ' · skipTex ' + f1(o.skip) : '-');
    L.push(w ? 'probe whole by outcome: hit ' + bo(w.byOutcome.hit) + ' | pass ' + bo(w.byOutcome.pass) : 'probe whole by outcome: - (no probe read back)');
    const ap = (o, i) => (o && o.near[i].steps !== null ? f1(o.near[i].steps) + '/' + f1(o.near[i].jumps) : '-');
    L.push(w ? 'probe approach (steps/jumps to the first sample within R voxels of a surface): ' + BD_NEAR_R.map((R, i) => 'R=' + R + ' hit steps/jumps ' + ap(w.byOutcome.hit, i) + ' pass ' + ap(w.byOutcome.pass, i) + ' never ' + (w.byOutcome.pass ? Math.round(w.byOutcome.pass.near[i].never * 100) + '%' : '-')).join(' | ')
      : 'probe approach (steps/jumps to the first sample within R voxels of a surface): - (no probe read back)');
    L.push(n ? 'probe native: windows ' + n.windows + ' · blocks ' + n.blocks + ' · block max/mean median/p90 ' + (n.blockMax ? f2(n.blockMax.median) + '/' + f2(n.blockMax.p90) : '-') + ' · mixed hit blocks share ' + f2(n.mixedShare)
      : 'probe native: - (no probe read back)');
    return L;
  };
  const api = { add, addProbe, summary, lines, seconds: null };
  return api;
}
// the report's section (an array of lines; empty without data and without a recording that started)
export function volBreakdownReport(p) {
  const vb = p.vb; if (!vb) return [];
  const rec = (p.rows || []).filter(r => r.rec === 1), L = ['-- vol breakdown (recording, paired shadow passes)'];
  L.push(...vb.lines({ volMs: median(rec.map(r => r.vol)) }));
  L.push('note: a shadow pass is the frame\'s low pass drawn once more after the frame\'s marker pass (same eyes, region, scissors and uniforms, into scratch targets that are never shown) with one step taken out; its GPU ms comes from a timestamp pair of its own and is not part of the vol column or of span. Variants run in turn, one shadow pass every 4th frame.');
  L.push('note: ratio = shadow ms / the same frame\'s low pass ms (median per variant, IQR = quartiles); "same" is the control (expected near 1). M = median low pass ms of the recording. est = (R_same - R_variant) x M ms: what the variant leaves out (positive = the variant is faster than the display); the display runs without the creep skip, withCreep turns it on (useSkip 1 over the display\'s 0) and noJump leaves out the distance jumps: a negative est of withCreep = the ms the creep skip adds, i.e. what leaving it out of the display saves; a negative est of noJump = the ms the jumps save. A withCreep pass is made only while the host\'s skip bits are valid for the texture. A "-" = no sample.');
  L.push('note: split: fixed = R_box x M (box = nothing but the per-pixel start: diag 1); refine / gradient / shading = est of noRefine / noGrad / noShade; march = (R_simple - R_box) x M - shading (simple = diag 3: no surface search, no gradient, the shading maths kept); sum = the five against M ("sum vs low", additive steps give 100 %).');
  L.push('note: probe = a 64 x 64 window of the left eye, alternately every second: whole = the eye\'s whole image shrunk into the window (the spread of the work), native = the centre of the region the low pass drew, at the pass\'s own pixel pitch (how the heavy pixels lie together). The counts per pixel come from a counting twin of the display program (steps = loop iterations; reads per px = fetches of skipTex / clsTex in the march, with the re-read of the previous sample / in the surface search / in the gradient; creep, jumps = how often; the display runs without the creep skip, so the counting twin runs without it too and its creep and skipTex counts are 0).');
  L.push('note: probe approach = per outcome (hit / pass) of the whole-image probe window: the loop iterations (steps) and jumps a ray used until its first sample with a surface distance <= R voxels, R = 4 / 8 / 16 (the distance byte dd the march jumps by, in grid-index units = voxels of the texture, read before the jumps switch; the sample itself counts as a step, the jumps are those made before it), the mean over the rays that did come within R; never = the share of the pass rays none of whose samples came within R. Counts only; it changes nothing that is drawn. It is a rough upper bound of what starting the ray near the surface (and ending it where nothing is left) could save: the steps before the first sample within R, and the pass rays that never come near a surface at all.');
  L.push('note: blocks are 8 x 8 pixels, an approximation of a GPU wave (the real wave size is not known): block max/mean = the largest work of the block over its mean (work = steps + search reads + gradient reads, covered pixels only), median and 90th percentile over the blocks; mixed hit blocks = blocks with both pixels that end on a hit and pixels that do not, as a share of the blocks with a covered pixel.');
  L.push('note: rows with rec = 1 were recorded while the breakdown ran: its shadow passes and probes load the GPU and its recording does not sample swd / vlat / wake, so span, gap, swd and fps of those rows are disturbed (the frame after a shadow pass has no gap sample); the summary above leaves them out, and the auto quality does not change while it records. This section does not follow the menu state (it uses every recorded pass).');
  return L;
}
