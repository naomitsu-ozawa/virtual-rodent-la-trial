// VR performance record (the Quest 3 WebGPU / WebGL comparison): one row a second for both the WebGL and the WebGPU session, kept in a ring buffer, with a summary of the stretches the menu was closed.
// Pure (no DOM, no three.js): vr-view.js feeds it (frame / add / row) and shows the text on the page after the session. Nothing here changes what is drawn.
// A row: fps, how many frame intervals were 1 / 2 / 3+ refresh periods, the GPU ms of the volume pass and of the main render (WebGL: EXT_disjoint_timer_query; WebGPU: timestamp-query / three's timestamps),
// the JS ms of the app's frame, the CPU ms of renderer.render(), (WebGPU only) the frame's GPU timeline and CPU timeline: span / gap / oth / cpu / swd (see the note line of the report), and the state the drawing choices were made in (scale f, periphery, data cap, auto level / step, step in voxels, covered px, size, menu, target Hz, foveation).
export const PERF_KEY = 'vrl-vr-perf'; // + '-webgl' / '-webgpu': one mirror per kind (a WebGPU session does not overwrite the WebGL one)
export const PERF_MIRROR_ROWS = 120; // the last rows the localStorage mirror keeps (the whole log stays in memory and in the page's text)
export const PERF_MAX_ROWS = 600; // 10 minutes of rows
const MEANS = ['vol', 'main', 'js', 'render', 'cpu', 'swd']; // the per-frame ms, averaged over the second
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
    const closed = rows.filter(r => !r.menu && r.fps > 0), pick = k => median(closed.map(r => r[k]));
    return { rows: rows.length, closedRows: closed.length, dropped, fps: pick('fps'), vol: pick('vol'), main: pick('main'), render: pick('render'), js: pick('js'), span: pick('span'), gap: pick('gap'), oth: pick('oth'), cpu: pick('cpu'), swd: pick('swd'), f: pick('f'), step: pick('step'), g1: closed.reduce((s, r) => s + r.g1, 0), g2: closed.reduce((s, r) => s + r.g2, 0), g3: closed.reduce((s, r) => s + r.g3, 0) };
  };
  return { kind, mode, rows, meta, get dropped() { return dropped; }, frame, add, sample, row, save, flush, summary };
}
const COLS = [['t', 4], ['fps', 5], ['g1', 4], ['g2', 3], ['g3', 3], ['vol', 6], ['main', 6], ['render', 6], ['js', 6], ['span', 6], ['gap', 6], ['oth', 6], ['cpu', 6], ['swd', 6], ['f', 5], ['per', 5], ['cap', 5], ['auto', 4], ['lv', 5], ['si', 3], ['step', 5], ['cov', 8], ['w', 5], ['h', 5], ['size', 6], ['menu', 4], ['hz', 4], ['fov', 4]];
const cell = (v, w) => String(v === null || v === undefined ? '-' : (typeof v === 'boolean' ? +v : v)).padStart(w);
// the text of the page panel / the copy button / the saved file: the header, the summary, then the rows
export function perfReport(p, { build = '', ua = '', hz = null } = {}) {
  const L = [], s = p.summary(), f = v => (v === null ? '-' : String(Math.round(v * 100) / 100));
  const name = p.kind === 'webgpu' ? 'WebGPU' : 'WebGL';
  L.push('VR performance log · ' + name + ' · ' + p.mode + (build ? ' · build ' + build : '') + (hz ? ' · target ' + hz + ' Hz' : ''));
  if (ua) L.push('UA: ' + ua);
  for (const [k, v] of Object.entries(p.meta || {})) L.push(k + ': ' + v);
  L.push('-- summary (rows with the menu closed: ' + s.closedRows + ' of ' + s.rows + (s.dropped ? ', ' + s.dropped + ' older rows dropped' : '') + ')');
  L.push('median fps ' + f(s.fps) + ' · volume GPU ' + f(s.vol) + ' ms · main GPU ' + f(s.main) + ' ms · render() CPU ' + f(s.render) + ' ms · JS ' + f(s.js) + ' ms · scale f ' + f(s.f) + ' · step ' + f(s.step) + ' voxel');
  L.push('frame intervals (menu closed): 1 period ' + s.g1 + ' · 2 periods ' + s.g2 + ' · 3+ periods ' + s.g3);
  L.push('GPU timeline (WebGPU, menu closed): span ' + f(s.span) + ' ms · gap ' + f(s.gap) + ' ms · other GPU work (span - vol - main) ' + f(s.oth) + ' ms · CPU frame start to submit end ' + f(s.cpu) + ' ms · submit to onSubmittedWorkDone ' + f(s.swd) + ' ms');
  L.push('note: a "-" is no sample in that second (or no timer). WebGL at f = 1 draws the volume straight into the XR framebuffer (vol empty, main includes the march); the WebGPU volume is always an offscreen pass.');
  L.push('note: span = ms from the first GPU start (the volume pass) to the end of the last GPU work of that XR frame (a marker pass after the last submit), median of the second; gap = ms the GPU was idle between the previous frame\'s last end and this frame\'s first start, median of the second; both from this device\'s own timestamp-query values (a "-" = no timer).');
  L.push('note: oth = span - vol - main (this row\'s median span minus the mean vol and main): GPU time inside the span that no timer covers; main is three.js\' own pass-duration sum (every 4th frame; a duration only, three.js\' timestamps are not on the same clock as span / gap) and the marker is an approximate end on a tiled GPU.');
  L.push('note: cpu = mean ms from the start of the XR frame callback to the end of the last submit (the marker\'s included); swd = mean ms from that submit to queue.onSubmittedWorkDone (sampled every 4th frame, one at a time).');
  L.push('-- rows, one a second (t s; g1 / g2 / g3 = frame intervals of 1 / 2 / 3+ periods; vol / main = GPU ms, render = render() CPU ms, js = JS ms, span / gap / oth = GPU ms (see the notes), cpu / swd = CPU ms (see the notes); f = scale, per = periphery scale, cap = data cap, auto = auto quality on, lv = auto level, si = auto step index, step = voxels, cov = covered px, w / h = XR size, size = view scale, menu = open, fov = fixed foveation)');
  L.push(COLS.map(([k, w]) => k.padStart(w)).join(' '));
  for (const r of p.rows) L.push(COLS.map(([k, w]) => cell(r[k], w)).join(' '));
  return L.join('\n');
}
// the file name of the saved record: WebGPU keeps the diagnostics' name (its text starts with the stages), WebGL gets vrl-vr-perf-webgl-<build>-<date>-<time>.txt (both carry the log)
export function perfFileName(kind, build, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return 'vrl-vr-' + (kind === 'webgpu' ? 'gpu-diag-' : 'perf-webgl-') + (String(build ?? '').replace(/[^\w.-]/g, '') || 'x') + '-' + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + '-' + p(now.getHours()) + p(now.getMinutes()) + '.txt';
}
