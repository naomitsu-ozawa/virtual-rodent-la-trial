// VR performance record (the Quest 3 WebGPU / WebGL comparison): one row a second for both the WebGL and the WebGPU session, kept in a ring buffer, with a summary of the stretches the menu was closed.
// Pure (no DOM, no three.js): vr-view.js feeds it (frame / add / row) and shows the text on the page after the session. Nothing here changes what is drawn.
// A row: fps, how many frame intervals were 1 / 2 / 3+ refresh periods, the GPU ms of the volume pass and of the main render (WebGL: EXT_disjoint_timer_query; WebGPU: timestamp-query / three's timestamps),
// the JS ms of the app's frame, the CPU ms of renderer.render(), (WebGPU only) the frame's GPU timeline and CPU timeline: span / gap / oth / cpu / swd, and wake / pre / vlat / vdrop (see the note lines of the report), and the state the drawing choices were made in (scale f, periphery, data cap, auto level / step, step in voxels, covered px, size, menu, target Hz, foveation).
export const PERF_KEY = 'vrl-vr-perf'; // + '-webgl' / '-webgpu': one mirror per kind (a WebGPU session does not overwrite the WebGL one)
export const PERF_MIRROR_ROWS = 120; // the last rows the localStorage mirror keeps (the whole log stays in memory and in the page's text)
export const PERF_MAX_ROWS = 600; // 10 minutes of rows
export const PERF_MIRROR_STALLS = 30; // the last stall lines the localStorage mirror keeps
export const PERF_MAX_STALLS = 60; // the stall lines kept (the newest; older ones are counted in stallsDropped)
const COUNTS = ['mk', 'tg', 'slotc', 'perc']; // per-second counts of what the WebGPU renderer made / changed: mk = targets + tile textures + bind groups made, tg = targets made, slotc = slot size changes, perc = periphery pass on / off switches
const MEANS = ['vol', 'main', 'js', 'render', 'cpu', 'swd', 'wake', 'pre', 'vlat', 'vdrop', 'late', 'lpx']; // the per-frame ms, averaged over the second
const MEDIANS = ['span', 'gap']; // the per-frame ms, the median of the second (WebGPU: the frame's GPU span and the GPU idle before it)
const median = a => { const v = a.filter(x => Number.isFinite(x)).sort((p, q) => p - q); if (!v.length) return null; const m = v.length >> 1; return v.length & 1 ? v[m] : (v[m - 1] + v[m]) / 2; };
export const perfMedian = median;
export const IP_BIN_MS = 0.5, IP_BINS = 512; // the frame-interval frequency table (ip95): bins of 0.5 ms up to 256 ms (the last bin takes everything longer)
// which interval a frame gap is: 0 = one refresh period (up to 1.5 of the budget), 1 = two (up to 2.5), 2 = three or more
export const gapBucket = (dtMs, budgetMs) => { const r = dtMs / Math.max(1, budgetMs); return r < 1.5 ? 0 : r < 2.5 ? 1 : 2; };
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
export function createPerfLog({ kind = 'webgl', mode = 'vr', now = () => performance.now(), store = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(), key = PERF_KEY + '-' + kind, maxRows = PERF_MAX_ROWS, saveEveryMs = 5000 } = {}) {
  const t0 = now();
  let lastTs = null, rowAt = t0, savedAt = t0, frames = 0, gaps = [0, 0, 0], dropped = 0;
  let gmax = 0, hmax = 0, mvp = 0, mvr = 0, lastSpan = null, lastVol = null, stallsDropped = 0; // the second's longest gap, most hands holding, summed movement (cm, deg); the latest span / vol read back
  const cnt = { mk: 0, tg: 0, slotc: 0, perc: 0 }, since = { mk: 0, tg: 0, slotc: 0, perc: 0 }; // the second's counts / those since the previous frame callback started (the stall's cause)
  const ipBins = new Uint16Array(IP_BINS); let ipN = 0; // the second's frame intervals as a frequency table (no array made per frame)
  let gfixOn = 0, fmin = Infinity, fsum = 0, fn = 0; // the second's: a guard held the scale / periphery (0 / 1), the lowest and the sum of the scale f over the frames
  const stalls = []; // one entry per frame interval of two or more periods (up to PERF_MAX_STALLS)
  let saveOff = false, saves = 0; // saveOff: the periodic localStorage mirror is paused (an isolation run of the comparison bench, docs/vr-bench.js; a forced save still writes); saves = how many times the mirror was written
  const sections = [], ext = {}; // sections: text blocks the report shows after its header (each a string array, or a function returning one); ext: extra JSON the mirror keeps (the bench results)
  const acc = Object.fromEntries(MEANS.map(k => [k, { s: 0, n: 0 }])), smp = Object.fromEntries(MEDIANS.map(k => [k, []]));
  const rows = [], meta = {}; // meta: free text lines about the session (which GPU timers existed, ...) for the header of the report
  // one frame of the app's loop (ts = the frame's time in ms, budgetMs = 1000 / target Hz): the gap since the previous frame goes into the interval counts
  // hold = how many hands hold the volume now, cov = covered px (both only read: no allocation here)
  // gfix = 1 when the flicker guard holds the scale or the periphery now (only read)
  const frame = (ts, budgetMs, hold = 0, cov = null, gfix = 0) => {
    frames++;
    if (hold > hmax) hmax = hold;
    if (gfix) gfixOn = 1;
    if (lastTs !== null && ts > lastTs) {
      const g = ts - lastTs, b = gapBucket(g, budgetMs); gaps[b]++; if (g > gmax) gmax = g;
      ipBins[Math.min(IP_BINS - 1, (g / IP_BIN_MS) | 0)]++; ipN++;
      if (b >= 1) { // a frame interval of two or more periods: one line (the flags are what happened in the callback of the frame before: since the previous frame() call)
        if (stalls.length >= PERF_MAX_STALLS) { stalls.shift(); stallsDropped++; }
        stalls.push({ t: r1((ts - t0) / 1000), gap: r1(g), span: lastSpan, vol: lastVol, hold, slot: since.slotc > 0 ? 1 : 0, tg: since.tg > 0 ? 1 : 0, per: since.perc > 0 ? 1 : 0, cov: Number.isFinite(cov) ? Math.round(cov) : null });
      }
    }
    lastTs = ts; since.mk = since.tg = since.slotc = since.perc = 0;
  };
  // a count of the WebGPU renderer (see COUNTS)
  const count = (k, n = 1) => { if (k in cnt && n > 0) { cnt[k] += n; since[k] += n; } };
  // the volume's movement since the previous frame (cm, deg), summed over the second
  const move = (cm, deg) => { if (Number.isFinite(cm) && cm >= 0) mvp += cm; if (Number.isFinite(deg) && deg >= 0) mvr += deg; };
  // a ms value (n = how many frames it stands for: a sum taken over n frames)
  const add = (k, ms, n = 1) => { const a = acc[k]; if (a && Number.isFinite(ms) && ms >= 0 && n > 0) { a.s += ms; a.n += n; if (k === 'vol') lastVol = r2(ms / n); } };
  // the render scale f of this frame (min / mean of the second)
  const fval = f => { if (Number.isFinite(f) && f > 0) { if (f < fmin) fmin = f; fsum += f; fn++; } };
  // p95 of the second's frame intervals (ms) from the frequency table; null with no interval
  const ip95 = () => {
    if (!ipN) return null;
    const need = Math.ceil(ipN * 0.95); let c = 0;
    for (let i = 0; i < IP_BINS; i++) { c += ipBins[i]; if (c >= need) return i === IP_BINS - 1 ? r1(gmax) : r1((i + 0.5) * IP_BIN_MS); }
    return r1(gmax);
  };
  // one per-frame ms value of a median column (span, gap)
  const sample = (k, ms) => { const a = smp[k]; if (a && Number.isFinite(ms) && a.length < 1000) { a.push(ms); if (k === 'span') lastSpan = r2(ms); } };
  // the localStorage mirror: every few seconds, not every row (the string of 600 rows is not made once a second)
  const save = (at = now(), force = false) => {
    if (!force && (saveOff || at - savedAt < saveEveryMs)) return;
    savedAt = at; saves++;
    try { store?.setItem(key, JSON.stringify({ kind, mode, dropped, meta, rows: rows.slice(-PERF_MIRROR_ROWS), stalls: stalls.slice(-PERF_MIRROR_STALLS), ...(Object.keys(ext).length ? { ext } : {}) })); } catch { /* private window / full */ }
  };
  // the end of a second: the row = the accumulators + the state given; they start again. snap = { f, per, cap, auto, lv, si, step, cov, size, menu, hz, fov, ... }
  const row = (snap = {}, at = now()) => {
    const el = Math.max(1, at - rowAt);
    const x = { t: Math.round((at - t0) / 1000), fps: r1(frames * 1000 / el), g1: gaps[0], g2: gaps[1], g3: gaps[2] };
    for (const k of MEANS) x[k] = acc[k].n ? r2(acc[k].s / acc[k].n) : null;
    for (const k of MEDIANS) x[k] = r2(median(smp[k]));
    x.oth = Number.isFinite(x.span) && Number.isFinite(x.vol) && Number.isFinite(x.main) ? r2(x.span - x.vol - x.main) : null; // the GPU work in the span that neither the volume pass nor three.js' main render timer covers (the second's median span minus the second's mean vol and main)
    x.gfix = gfixOn; x.fmin = fn ? Math.round(fmin * 1000) / 1000 : null; x.favg = fn ? Math.round(fsum / fn * 1000) / 1000 : null; x.ip95 = ip95(); // guard held (0 / 1), the second's lowest / mean scale f, p95 of the frame intervals (ms)
    x.hold = hmax; x.mv = r1(mvp * 1000 / el); x.mvr = r1(mvr * 1000 / el); x.imax = gmax > 0 ? r1(gmax) : null; // hands holding (the second's most), the volume's movement (cm/s, deg/s; held or not), the longest frame interval (ms)
    for (const k of ['mk', 'slotc', 'perc']) x[k] = kind === 'webgpu' ? cnt[k] : null; // WebGPU only
    for (const k of Object.keys(snap)) { const v = snap[k]; x[k] = typeof v === 'number' ? (Number.isInteger(v) ? v : Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null) : v; } // fractions to 3 decimals
    if (rows.length >= maxRows) { rows.shift(); dropped++; }
    rows.push(x);
    if (!smp.span.length) lastSpan = null; // a second with no span: the stall lines do not carry an old one (the fine timers run only while recording)
    rowAt = at; frames = 0; gaps = [0, 0, 0]; gmax = hmax = mvp = mvr = 0; gfixOn = 0; fmin = Infinity; fsum = fn = 0; ipBins.fill(0); ipN = 0; for (const k of COUNTS) cnt[k] = 0; for (const k of MEANS) { acc[k].s = 0; acc[k].n = 0; } for (const k of MEDIANS) smp[k].length = 0;
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
  return { kind, mode, rows, stalls, meta, sections, ext, setSaveOff(v) { saveOff = !!v; }, get saves() { return saves; }, get dropped() { return dropped; }, get stallsDropped() { return stallsDropped; }, frame, fval, count, move, add, sample, row, get lastDrops() { const r = rows[rows.length - 1]; return r ? r.g2 + r.g3 : null; }, save, flush, summary };
}
const COLS = [['t', 4], ['fps', 5], ['g1', 4], ['g2', 3], ['g3', 3], ['vol', 6], ['main', 6], ['render', 6], ['js', 6], ['span', 6], ['gap', 6], ['oth', 6], ['cpu', 6], ['swd', 6], ['wake', 6], ['pre', 6], ['vlat', 6], ['vdrop', 6], ['f', 5], ['per', 5], ['cap', 5], ['auto', 4], ['lv', 5], ['si', 3], ['step', 5], ['cov', 8], ['w', 5], ['h', 5], ['size', 6], ['menu', 4], ['hz', 4], ['fov', 4], ['rec', 3], ['hold', 4], ['mv', 6], ['mvr', 6], ['imax', 6], ['mk', 3], ['slotc', 5], ['perc', 4], ['hset', 5], ['hk', 5], ['gfix', 4], ['mlow', 4], ['tab', 3], ['fmin', 6], ['favg', 6], ['late', 5], ['ip95', 6], ['lpx', 8]];
const STALL_COLS = [['t', 6], ['gap', 6], ['span', 6], ['vol', 6], ['hold', 4], ['slot', 4], ['tg', 3], ['per', 3], ['cov', 8]];
const cell = (v, w) => String(v === null || v === undefined ? '-' : (typeof v === 'boolean' ? +v : v)).padStart(w);
// the text of the page panel / the copy button / the saved file: the header, the summary, then the rows
export function perfReport(p, { build = '', ua = '', hz = null } = {}) {
  const L = [], s = p.summary(), f = v => (v === null ? '-' : String(Math.round(v * 100) / 100));
  const name = p.kind === 'webgpu' ? 'WebGPU' : 'WebGL';
  L.push('VR performance log · ' + name + ' · ' + p.mode + (build ? ' · build ' + build : '') + (hz ? ' · target ' + hz + ' Hz' : ''));
  if (ua) L.push('UA: ' + ua);
  for (const [k, v] of Object.entries(p.meta || {})) L.push(k + ': ' + v);
  for (const sec of p.sections || []) { let t = null; try { t = typeof sec === 'function' ? sec() : sec; } catch (e) { t = ['-- section failed: ' + String(e?.message ?? e).slice(0, 160)]; } if (Array.isArray(t)) for (const l of t) L.push(l); } // the comparison bench's and the frame ring's blocks (docs/vr-bench.js)
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
  if (p.kind === 'webgpu') L.push('note: WebGPU fine timers: span / gap / oth, main (three.js\' timestamps) and swd / wake / vlat / vdrop / late are taken only while the breakdown recording (detail tab) is prepared or runs, so a "-" in these columns in the other seconds means not measured; swd / wake / vlat / vdrop / late only while it is prepared (the recording\'s shadow passes would disturb them, as before), span / gap / main in the preparation and the recording. The summary leaves out the rows with rec = 1 (a second with a recording frame in it, the second the recording ends in included) and the rows with the menu open, so its GPU timeline / main figures are mostly "-": only the preparation rows with the menu closed are left, and those show only swd / wake / vlat / vdrop and span / gap / main of the preparation. The values of the recording rows stay in the rows below; the vol breakdown section does not summarise span / gap / main. vol (the volume pass\'s timestamp) and pre / cpu / render / js are taken in every second.');
  if (p.vb) for (const t of volBreakdownReport(p)) L.push(t);
  L.push('note: hold = the most hands holding the volume in that second (0 / 1 / 2; the volume or its pair partner, not a section or a board); mv / mvr = how far the volume moved in that second, cm/s of its world position and deg/s of its world rotation, whether held or not (scale changes are not in it); imax = the longest frame interval of the second in ms.');
  L.push('note: mk = offscreen targets + tile textures + bind groups made in that second; slotc = times a pass\'s target slot size changed; perc = times the periphery pass switched on or off (WebGPU only; WebGL "-").');
  L.push('note: hset = the held-scale setting of the WebGPU view in that second (the factor the slider is set to, 0.5-0.95; 0 = the setting is off); hk = the lowest factor really applied to the render scale in that second (1 = never lowered; compare with hset while hold > 0).');
  L.push('note: gfix = 1 when the flicker guard (scale or periphery) held its value at any frame of that second; mlow = the setting "simplify while held" (1 on, 0 off; WebGPU only); tab = the menu tab open ("-" = menu closed); fmin / favg = the lowest / mean render scale f over the frames of the second (f in the row is the last frame\'s); late = share 0-1 of the sampled onSubmittedWorkDone (every 4th frame, as wake) that returned after the next frame callback had started (taken only while the recording is prepared, as swd; "-" in the other seconds); ip95 = p95 of the frame intervals of the second in ms (a frequency table of 0.5 ms bins); lpx = mean px per frame the low pass drew (sum of its scissor rects over the eyes; WebGPU only, "-" otherwise).');
  L.push('note: stall lines (after the rows): one per frame interval of about two periods or more (over 1.5 periods), the newest ' + PERF_MAX_STALLS + '. t = s since the start, gap = the interval in ms, span / vol = the latest GPU span / volume ms read back when it ended (a read-back may lag a few frames: it is the frame before only roughly; "-" = none yet), hold = hands holding, slot / tg / per = 1 when a slot size changed / a target was made / the periphery switched during the frame before the gap, cov = covered px.');
  L.push('-- rows, one a second (t s; g1 / g2 / g3 = frame intervals of 1 / 2 / 3+ periods; vol / main = GPU ms, render = render() CPU ms, js = JS ms, span / gap / oth = GPU ms (see the notes), cpu / swd / wake / pre / vlat = CPU ms, vdrop = share 0-1 (see the notes); f = scale, per = periphery scale, cap = data cap, auto = auto quality on, lv = auto level, si = auto step index, step = voxels, cov = covered px, w / h = XR size, size = view scale, menu = open, fov = fixed foveation, rec = 1 while the volume breakdown was recording (WebGPU only; see its notes); hold / mv / mvr / imax / mk / slotc / perc / hset / hk / gfix / mlow / tab / fmin / favg / late / ip95 / lpx = see the notes))');
  L.push(COLS.map(([k, w]) => k.padStart(w)).join(' '));
  for (const r of p.rows) L.push(COLS.map(([k, w]) => cell(r[k], w)).join(' '));
  const st = p.stalls || [];
  L.push('-- stalls: frame intervals of two or more periods, ' + st.length + (p.stallsDropped ? ' newest (' + p.stallsDropped + ' older dropped)' : '') + ' (t s; gap ms; span / vol = latest GPU ms; hold = hands; slot / tg / per = 1 if a slot size changed / a target was made / the periphery switched just before; cov = covered px)');
  L.push(STALL_COLS.map(([k, w]) => k.padStart(w)).join(' '));
  for (const r of st) L.push(STALL_COLS.map(([k, w]) => cell(r[k], w)).join(' '));
  return L.join('\n');
}
// the file name of the saved record: WebGPU keeps the diagnostics' name (its text starts with the stages), WebGL gets vrl-vr-perf-webgl-<build>-<date>-<time>.txt (both carry the log)
export function perfFileName(kind, build, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return 'vrl-vr-' + (kind === 'webgpu' ? 'gpu-diag-' : 'perf-webgl-') + (String(build ?? '').replace(/[^\w.-]/g, '') || 'x') + '-' + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + '-' + p(now.getHours()) + p(now.getMinutes()) + '.txt';
}

// ---- the volume breakdown (WebGPU, one 30 s recording started from the detail tab; vr-wgpu.js shadow passes and counting probe) ----
// The shadow passes are throw-away copies of a frame's low pass with one step taken out; `add` gets each one's GPU ms and the same frame's real low pass ms. This is a pure collector (no DOM, no GPU): it never touches the log's own columns.
// ---- the table of the shadow-pass variants: ONE place to add a variant ----
// A variant is made with defineBdVariant({ name, abl?, overrides?, proxy?, diff? }) (the nine of the build are the calls below; a new one is one more call there; BD_VARIANTS = the names in the order they run, BD_SPECS[name] = the entry):
//   name      the variant's name (the key of the report's "abl <name>" line); unique.
//   abl       another program text of the display pass (docs/vr-wgsl-core.js ablate: a name in ABLATIONS; the host compiles every ABLATIONS entry when the recording is prepared).
//   overrides another uniform value over the display's (a field of the uniform layout; the host writes it into the pass's own copy of the frame's uniforms).
//   proxy     true = the pass needs the low pass to have used the pre-pass (else the host has no program for the frame and steps past it).
//   diff      true = count the differing pixels: the host draws the variant AND the display's own pass (display program, the frame's own uniforms and tiles) into the same pair of scratch targets (same region, viewports and scissors) and a small compute counts the pixels
//             whose colour or packed depth differ, and the largest colour channel difference; the report gets "diff px <name>: max N of M px (the comparisons had one at most) · K of C comparisons had a differing pixel · max colour channel diff X of 255".
//             A variant that must be identical to the display (the pre-pass start, a coarse distance field, an early stop) says diff: true and its expected value is 0; one that is not identical (a different gradient) shows how much it differs.
//   A variant that cannot be made by a program text or a uniform value (its own pipeline, bind group, extra compute) registers a host function too: vr-wgpu.js registerShadowEncoder(name, fn); the table entry stays the same (name, diff, proxy).
export const BD_VARIANTS = [];
export const BD_SPECS = {};
export function defineBdVariant(spec) {
  if (!spec || typeof spec.name !== 'string' || !spec.name) throw new Error('defineBdVariant: a name is needed');
  if (BD_SPECS[spec.name]) throw new Error('defineBdVariant: ' + spec.name + ' is already defined');
  BD_SPECS[spec.name] = spec; BD_VARIANTS.push(spec.name);
  return spec;
}
// how each variant is made (the host reads this table): abl = another program text, overrides = another uniform value
defineBdVariant({ name: 'same' }); defineBdVariant({ name: 'box', overrides: { diag: 1 } }); defineBdVariant({ name: 'simple', overrides: { diag: 3 } });
defineBdVariant({ name: 'noGrad', abl: 'grad' }); defineBdVariant({ name: 'noRefine', abl: 'refine' }); defineBdVariant({ name: 'noShade', abl: 'shade' });
defineBdVariant({ name: 'withCreep', overrides: { useSkip: 1 } }); // the display runs without the creep skip (useSkip 0); this pass turns it on (the host skips it when its bits are not valid)
defineBdVariant({ name: 'noJump', overrides: { jumpOn: 0, proxyOn: 0 } }); // the pre-pass needs the jumps (its start is safe only with them): without jumps it is off too, so this pass leaves out both
defineBdVariant({ name: 'noProxy', overrides: { proxyOn: 0 }, proxy: true, diff: true }); // the pre-pass off over the display's (the host makes no pass when the frame's low pass did not use it; its turn also runs the pixel comparison, delivered as 'proxyDiff'; see add)
// ---- add new variants above this line, one defineBdVariant call each ----
export const BD_PROBE_FIELDS = ['outcome', 'iters', 'creep', 'jumps', 'skipReads', 'clsReads', 'refineReads', 'gradReads', 'near4Steps', 'near4Jumps', 'near8Steps', 'near8Jumps', 'near16Steps', 'near16Jumps', 'toTA', 'last4Steps', 'last8Steps', 'last16Steps']; // the u32 of a probe pixel (docs/vr-wgsl-core.js COUNTER_FIELDS)
const BD_STRIDE = BD_PROBE_FIELDS.length;
export const BD_NEAR_R = [4, 8, 16]; // the approach radii in voxels (grid-index units of the distance bytes); the field pair of R is 8 + 2 * index
const BD_OUTCOMES = ['hit', 'pass', 'accstop', 'discard']; // outcome value 1..4 (0 = the pixel was not covered)
const BD_BLOCK = 8; // 8 x 8 pixels stand in for a GPU wave
const quantile = (a, q) => { const v = a.filter(x => Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
const newOutcomeAgg = () => ({ px: 0, steps: [], iters: 0, jumps: 0, creep: 0, skipReads: 0, near: BD_NEAR_R.map(() => ({ n: 0, steps: 0, jumps: 0 })) }); // one outcome's share of the probe (hit, pass): its steps, jumps, creep steps and skipTex reads; near[i] = the rays that came within BD_NEAR_R[i] of a surface (count, sums of their steps and jumps up to that sample)
const newSplitAgg = () => ({ n: 0, toTA: 0, approach: 0, near: 0, tail: 0, never: 0 }); // one outcome's rays at one R: their steps cut into four places (see addProbe)
const newProbeAgg = () => ({ split: BD_NEAR_R.map(() => [newSplitAgg(), newSplitAgg()]), windows: 0, px: 0, steps: [], by: [newOutcomeAgg(), newOutcomeAgg()], sums: { iters: 0, creep: 0, jumps: 0, skipReads: 0, clsReads: 0, refineReads: 0, gradReads: 0 }, outcome: [0, 0, 0, 0], blocks: 0, blockRatio: [], mixed: 0 });
export function createVolBreakdown() {
  const ratios = Object.fromEntries(BD_VARIANTS.map(v => [v, []])), lows = [], probes = { whole: newProbeAgg(), native: newProbeAgg() }, probesOn = { whole: newProbeAgg(), native: newProbeAgg() }; // probes = the counting probe without the pre-pass (the upper bound, as before), probesOn = with the display's own tiles
  const proxy = { ms: [] }; // the pre-pass compute pass's ms
  const diffs = {}; // per diff variant (BD_SPECS diff): comparisons made, how many had a differing pixel, the largest count, the pixels compared, the largest colour channel / packed depth byte difference, the most pixels whose colour differs in one comparison
  const dstat = v => (diffs[v] ||= { cmp: 0, differ: 0, max: 0, total: 0, maxColor: 0, maxDepth: 0, colorPx: 0 });
  // one shadow pass of `variant`: its GPU ms and the same frame's low pass GPU ms (both > 0 and finite, else it is not a sample)
  // Two more kinds come through the same callback (the host's onShadow of the breakdown): ('proxyDiff', pixels that differ, pixels compared) and ('proxyMs', the pre-pass compute pass's ms, 1)
  const add = (variant, shadowMs, lowMs) => {
    // the comparison of a diff variant (BD_SPECS diff) comes as ('diff:<name>', pixels that differ, pixels compared), 'diffMax:<name>' (largest colour channel difference, largest packed depth byte difference), 'diffColor:<name>' (pixels whose colour differs, 1); noProxy's own count keeps its name 'proxyDiff'
    const dv = variant === 'proxyDiff' ? 'noProxy' : typeof variant === 'string' && variant.startsWith('diff:') ? variant.slice(5) : null;
    if (dv !== null) { if (!BD_SPECS[dv]?.diff || !Number.isFinite(shadowMs) || !(lowMs > 0) || shadowMs < 0) return false; const d = dstat(dv); d.cmp++; if (shadowMs > 0) d.differ++; d.max = Math.max(d.max, shadowMs); d.total = Math.max(d.total, lowMs); return true; }
    if (typeof variant === 'string' && (variant.startsWith('diffMax:') || variant.startsWith('diffColor:'))) {
      const v = variant.slice(variant.indexOf(':') + 1); if (!BD_SPECS[v]?.diff || !Number.isFinite(shadowMs) || shadowMs < 0) return false;
      const d = dstat(v); if (variant.startsWith('diffMax:')) { d.maxColor = Math.max(d.maxColor, shadowMs); d.maxDepth = Math.max(d.maxDepth, Number.isFinite(lowMs) ? lowMs : 0); } else d.colorPx = Math.max(d.colorPx, shadowMs);
      return true;
    }
    if (typeof variant === 'string' && variant.startsWith('probeOn:')) return addProbeOn(variant.slice(8), shadowMs, lowMs, lowMs); // the counting probe with the pre-pass on: (counters, w = h = 64)
    if (variant === 'proxyMs') { if (!Number.isFinite(shadowMs) || shadowMs < 0) return false; if (proxy.ms.length < 4000) proxy.ms.push(shadowMs); return true; }
    if (!Object.hasOwn(BD_SPECS, variant) || !Number.isFinite(shadowMs) || !Number.isFinite(lowMs) || shadowMs < 0 || !(lowMs > 0)) return false;
    (ratios[variant] ||= []).push(shadowMs / lowMs); lows.push(lowMs); // (a variant defined after this collector was made has its list made here)
    return true;
  };
  // one ray's steps in four places (R = BD_NEAR_R[i]): toTA = the iterations before the pre-pass's start (counted by the twin: the run without the pre-pass; 0 with it), approach = from there up to the first sample within R of a surface, near = from the first (or, if
  // that lay before the start, the first after the start) to the LAST sample within R, tail = after the last one to the ray's end. A ray none of whose samples came within R puts everything after the start in approach (and is counted in never). The four add up to the ray's steps.
  const splitRay = (a, k, c, o) => {
    const I = c[o + 1], A = Math.min(c[o + 14], I);
    BD_NEAR_R.forEach((_, i) => {
      const F = c[o + 8 + 2 * i], L = c[o + 15 + i], sp = a.split[i][k];
      sp.n++; sp.toTA += A;
      if (F === 0) { sp.never++; sp.approach += I - A; return; }
      sp.approach += Math.max(0, F - 1 - A); sp.near += L > A ? L - Math.max(F, A + 1) + 1 : 0; sp.tail += I - Math.max(L, A);
    });
  };
  // one counting probe window: counters = Uint32Array(w * h * BD_PROBE_FIELDS.length) (BD_PROBE_FIELDS per pixel; outcome 0 = not covered); kind = 'whole' | 'native'
  const feed = (a, counters, w, h) => {
    if (!a || !counters || !(w > 0) || !(h > 0) || counters.length < w * h * BD_STRIDE) return false;
    a.windows++;
    const nb = Math.ceil(w / BD_BLOCK) * Math.ceil(h / BD_BLOCK), bn = new Uint16Array(nb), bh = new Uint16Array(nb), bs = new Float64Array(nb), bm = new Float64Array(nb);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * BD_STRIDE, oc = counters[o];
      if (oc < 1 || oc > 4) continue;
      a.px++; a.outcome[oc - 1]++;
      if (a.steps.length < 200000) a.steps.push(counters[o + 1]);
      if (oc <= 2) { splitRay(a, oc - 1, counters, o); const b = a.by[oc - 1]; b.px++; if (b.steps.length < 200000) b.steps.push(counters[o + 1]); b.iters += counters[o + 1]; b.jumps += counters[o + 3]; b.creep += counters[o + 2]; b.skipReads += counters[o + 4]; BD_NEAR_R.forEach((_, i) => { const st = counters[o + 8 + 2 * i]; if (st > 0) { const nr = b.near[i]; nr.n++; nr.steps += st; nr.jumps += counters[o + 9 + 2 * i]; } }); }
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
  // one counting probe window: counters = Uint32Array(w * h * BD_PROBE_FIELDS.length) (BD_PROBE_FIELDS per pixel; outcome 0 = not covered); kind = 'whole' | 'native'. addProbe = the run without the pre-pass (as before), addProbeOn = the run with the display's tiles
  const addProbe = (kind, counters, w, h) => feed(probes[kind], counters, w, h);
  const addProbeOn = (kind, counters, w, h) => feed(probesOn[kind], counters, w, h);
  // the per-pixel means of one outcome (null where no pixel ended so) and the 95th percentile of its steps
  const outcomeSummary = b => {
    if (!b.px) return null;
    const st = b.steps.slice().sort((x, y) => x - y);
    // near = per radius: the rays that came within R of a surface: their mean steps / jumps up to the first such sample (null = none did) and never = the share of this outcome's rays that never did
    const near = BD_NEAR_R.map((R, i) => { const x = b.near[i]; return { R, reached: x.n, steps: x.n ? x.steps / x.n : null, jumps: x.n ? x.jumps / x.n : null, never: (b.px - x.n) / b.px }; });
    return { px: b.px, steps: { mean: b.iters / b.px, p95: st[Math.min(st.length - 1, Math.ceil(0.95 * st.length) - 1)] }, jumps: b.jumps / b.px, creep: b.creep / b.px, skip: b.skipReads / b.px, near };
  };
  // the four places of the steps per ray (see splitRay), per R and outcome: mean steps of the rays of that outcome (null = none)
  const splitSummary = a => {
    if (!a.windows || !a.px) return null;
    return a.split.map((pair, i) => ({ R: BD_NEAR_R[i], ...Object.fromEntries(['hit', 'pass'].map((k, j) => { const x = pair[j]; return [k, x.n ? { n: x.n, toTA: x.toTA / x.n, approach: x.approach / x.n, near: x.near / x.n, tail: x.tail / x.n, never: x.never / x.n } : null]; })) }));
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
    const M = median(lows), R = {}, out = { M, nLow: lows.length, variants: {}, split: null, probes: { whole: probeSummary(probes.whole), native: probeSummary(probes.native) }, proxy: { comparisons: (diffs.noProxy?.cmp | 0), withDifference: (diffs.noProxy?.differ | 0), maxDiffPx: (diffs.noProxy?.max | 0), pixels: (diffs.noProxy?.total | 0), computeMs: median(proxy.ms), computeN: proxy.ms.length },
      diffs: Object.fromEntries(BD_VARIANTS.filter(v => BD_SPECS[v].diff).map(v => { const d = dstat(v); return [v, { comparisons: d.cmp, withDifference: d.differ, maxDiffPx: d.max, pixels: d.total, maxColorDiff: d.maxColor, maxDepthByteDiff: d.maxDepth, maxColorPx: d.colorPx }]; })),
      probesOn: { whole: probeSummary(probesOn.whole), native: probeSummary(probesOn.native) },
      splits: { off: { whole: splitSummary(probes.whole), native: splitSummary(probes.native) }, on: { whole: splitSummary(probesOn.whole), native: splitSummary(probesOn.native) } } };
    for (const v of BD_VARIANTS) ratios[v] ||= [];
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
    const pc = s.proxy.computeMs;
    for (const v of BD_VARIANTS) {
      const x = s.variants[v];
      L.push('abl ' + v + ' n=' + x.n + ' ratio ' + f2(x.R) + ' (IQR ' + (x.q1 === null ? '-' : f2(x.q1) + '-' + f2(x.q3)) + ') · est ' + (x.est === null ? '-' : f1(x.est) + ' ms')
        + (v === 'noProxy' && x.est !== null ? ' · the pre-pass saves ' + f1(-x.est) + ' ms in the volume pass' + (pc !== null ? ', ' + f1(-x.est - pc) + ' ms after its own compute' : '') : ''));
    }
    L.push('proxy diff px: ' + (s.proxy.comparisons ? 'max ' + s.proxy.maxDiffPx + ' of ' + s.proxy.pixels + ' px · ' + s.proxy.withDifference + ' of ' + s.proxy.comparisons + ' comparisons had a differing pixel' : '- (no comparison made: the low pass did not use the pre-pass, or no read-back)')
      + ' · pre-pass compute median ' + (pc !== null ? f2(pc) + ' ms (' + s.proxy.computeN + ')' : '-'));
    for (const v of BD_VARIANTS) { // one line per variant that counts differing pixels (BD_SPECS diff)
      const d = s.diffs[v]; if (!d) continue;
      L.push('diff px ' + v + ': ' + (d.comparisons ? 'max ' + d.maxDiffPx + ' of ' + d.pixels + ' px · ' + d.withDifference + ' of ' + d.comparisons + ' comparisons had a differing pixel · max colour channel diff ' + d.maxColorDiff + ' of 255 · max packed depth byte diff ' + d.maxDepthByteDiff + ' of 255 · colour differs in up to ' + d.maxColorPx + ' px'
        : '- (no comparison made: the variant had no pass in a frame, or no read-back)'));
    }
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
    // the steps of a ray in four places, per window kind, the run without the pre-pass (to-tA is what the pre-pass skips: the iterations before its start) and the run with the display's tiles (as displayed)
    const sx = o => (o ? [o.toTA, o.approach, o.near, o.tail].map(f1).join('/') + ' (n ' + o.n + ', never ' + Math.round(o.never * 100) + '%)' : '-');
    const place = r => (r ? r.map(x => 'R=' + x.R + ' hit ' + sx(x.hit) + ' | pass ' + sx(x.pass)).join(' ; ') : '- (no window)');
    for (const k of ['whole', 'native']) {
      L.push('probe split ' + k + ' off (steps per ray: to tA / approach / near / tail): ' + place(s.splits.off[k]));
      L.push('probe split ' + k + ' on (the same, with the display\'s tiles): ' + place(s.splits.on[k]));
    }
    const mo = a => [a?.byOutcome.hit, a?.byOutcome.pass].map(o => (o ? f1(o.steps.mean) : '-')).join(' | ') + ' (windows ' + (a ? a.windows : 0) + ')';
    L.push('probe steps per ray, hit | pass: whole off ' + mo(s.probes.whole) + ' · whole on ' + mo(s.probesOn.whole) + ' · native off ' + mo(s.probes.native) + ' · native on ' + mo(s.probesOn.native));
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
  L.push('note: noProxy = the display with the pre-pass off (proxyOn 0: the volume pass starts every ray at its own start, the tiles are not read): a negative est = the ms the pre-pass saves in the volume pass (the line says so); the pre-pass compute pass is not part of the low pass ms, its median ms is on the proxy line, so "after its own compute" is the net saving. noJump leaves the pre-pass out too (it needs the jumps). A frame whose low pass did not use the pre-pass (sections, no distance field) makes no noProxy pass and no comparison.');
  L.push('note: proxy diff px = the pixels whose colour or packed depth differ between the low pass drawn with the pre-pass on and off: the noProxy turn draws both into scratch targets (same region, uniforms and tiles) and a small compute counts the differing pixels (4 bytes are read back; the probe windows are not used). The expected value is 0 on every comparison; max = the largest count, of = the pixels compared.');
  L.push('note: split: fixed = R_box x M (box = nothing but the per-pixel start: diag 1); refine / gradient / shading = est of noRefine / noGrad / noShade; march = (R_simple - R_box) x M - shading (simple = diag 3: no surface search, no gradient, the shading maths kept); sum = the five against M ("sum vs low", additive steps give 100 %).');
  L.push('note: probe = a 64 x 64 window of the left eye, alternately every second: whole = the eye\'s whole image shrunk into the window (the spread of the work), native = the centre of the region the low pass drew, at the pass\'s own pixel pitch (how the heavy pixels lie together). The counts per pixel come from a counting twin of the display program (steps = loop iterations; reads per px = fetches of skipTex / clsTex in the march, with the re-read of the previous sample / in the surface search / in the gradient; creep, jumps = how often; the display runs without the creep skip, so the counting twin runs without it too and its creep and skipTex counts are 0).');
  L.push('note: probe approach = per outcome (hit / pass) of the whole-image probe window: the loop iterations (steps) and jumps a ray used until its first sample with a surface distance <= R voxels, R = 4 / 8 / 16 (the distance byte dd the march jumps by, in grid-index units = voxels of the texture, read before the jumps switch; the sample itself counts as a step, the jumps are those made before it), the mean over the rays that did come within R; never = the share of the pass rays none of whose samples came within R. Counts only; it changes nothing that is drawn. It is a rough upper bound of what starting the ray near the surface (and ending it where nothing is left) could save: the steps before the first sample within R, and the pass rays that never come near a surface at all.');
  L.push('note: diff px <variant> (every variant with diff in the table of vr-perf-log.js, the noProxy line above included): the variant\'s pass and the display\'s own pass (display program, the frame\'s uniforms and tiles) are drawn into the same pair of scratch targets of the same region and a small compute counts the pixels whose colour or packed depth differ (4 u32 are read back, one comparison at a time); max = the largest count of a comparison, of = the pixels compared, "had a differing pixel" = comparisons with a count above 0, max colour channel diff = the largest difference of an rgba8 colour channel (0 to 255) over all comparisons, packed depth byte diff = the same for the packed depth bytes (it only says not equal: a byte is no depth). A variant that is meant to be identical to the display shows 0 everywhere; anything else is not identical.');
  L.push('note: probe split = the steps (loop iterations) of a ray in four places, mean over the hit and the pass rays of the window, per R (4 / 8 / 16 voxels of the surface distance byte): to tA = the iterations before the start the pre-pass gives the ray (the tile\'s tA; the run without the pre-pass counts them, the run with it starts there: 0), approach = from there to the first sample within R of a surface, near = from the first sample within R (the first after the start when it lay before it) to the last one, tail = after the last sample within R to the end of the ray; the four add up to the steps. A ray none of whose samples came within R has no near and no tail: all its steps after the start are approach (never = their share; a ray the pre-pass calls empty has 0 steps and counts as such a ray, so never is larger in the run with the pre-pass). The tail of the pass rays is what stopping a ray early (an end distance) could save at most. "off" = the counting twin without the pre-pass over the window (tA read from the display\'s tiles of that frame), "on" = with the display\'s tiles, the run of the display (the steps of the probe lines above are the off run, as before). whole = the eye\'s whole image shrunk into the window: a probe pixel reads the tile of the display pixel it stands for (its ray is between pixel centres, so a ray at the border of a tile is only approximately inside the tile\'s cone); a pixel outside the low pass\'s region has no tile (no pre-pass for it). "-" = no window with the display\'s tiles (the frame\'s low pass did not use the pre-pass).');
  L.push('note: blocks are 8 x 8 pixels, an approximation of a GPU wave (the real wave size is not known): block max/mean = the largest work of the block over its mean (work = steps + search reads + gradient reads, covered pixels only), median and 90th percentile over the blocks; mixed hit blocks = blocks with both pixels that end on a hit and pixels that do not, as a share of the blocks with a covered pixel.');
  L.push('note: rows with rec = 1 were recorded while the breakdown ran: its shadow passes and probes load the GPU and its recording does not sample swd / vlat / wake, so span, gap, swd and fps of those rows are disturbed (the frame after a shadow pass has no gap sample); the summary above leaves them out, and the auto quality does not change while it records. This section does not follow the menu state (it uses every recorded pass).');
  return L;
}
