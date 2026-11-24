// The comparison bench, the per-frame ring and the isolation switches of the VR view (Quest 3: the WebGL view and the WebGPU view alike).
// Pure (no DOM, no three.js, no GPU): vr-view.js drives it frame by frame and shows the text in the performance record (vr-perf-log.js sections). Nothing here changes what is drawn,
// except through the host's own calls the controller makes (the body's pose / size, the menu, the quality settings) while a bench runs.
//
//  1. createBenchScript / createCoverTuner / createCompareBench: a scripted run (one body in front of the head, no section plane, 100 %, auto quality off) of four scenes:
//       still (standard size, 60 s) / turn (standard, 40 s) / turnBig (turning, covered px about 1 M, 40 s) / near (still, close, covered px 2-3 M, 40 s);
//     the first 2 s of each scene are left out; per scene: drops (frame intervals of 1.5 refresh periods or more = g2 + g3, as the performance record counts them), the 95 / 99 % points and the longest
//     frame interval, and (WebGPU) the median and the 95 % point of span and vol.
//  2. createFrameRing: the last 2000 frames, one record each, with what happened in that frame interval; windows around the frames over 30 ms are kept for the report.
//  3. createIsolation: the switches of the isolation run (volume timestamps and their read-back, the menu's once-a-second redraw, the diagnostics' heartbeat save, the performance record's 5 s save).
import { gapBucket } from './vr-perf-log.js?v=20261124-build757';

export const BENCH_DISCARD_MS = 2000; // the first 2 s of every scene are left out of its numbers
export const BENCH_ROT_RATE = 0.5; // rad/s, the turn of the turning scenes (the old benchmark's rate)
export const BENCH_TUNE_MS = 100; // the cover tuner looks at the covered px and moves the size / distance this often while a scene settles
// the scenes (ms = the whole scene including the left-out start; cover = the covered px (both eyes) the scene is tuned to, 0 = the standard size and distance)
export const BENCH_SCENES = [
  { id: 'still', rot: false, cover: 0, ms: 60000 },
  { id: 'turn', rot: true, cover: 0, ms: 40000 },
  { id: 'turnBig', rot: true, cover: 1.0e6, ms: 40000 },
  { id: 'near', rot: false, cover: 2.5e6, ms: 40000 },
];
// the conditions a run can have (what is on while its scenes run): timers = the volume pass's GPU timestamps and their read-back (WebGL: the timer queries), span = the frame marker pass that gives span / gap
// (WebGPU), diagSave = the diagnostics' once-a-second localStorage write, perfSave = the performance record's 5 s localStorage mirror, menu = the menu during the run ('closed' / 'open' on the 性能 tab / null = not touched)
export const ISO_MODES = {
  default: { timers: true, span: false, diagSave: true, perfSave: true, menu: null }, // outside a bench: what the view always did
  std: { timers: true, span: true, diagSave: true, perfSave: true, menu: 'closed' }, // the comparison bench: menu closed, only the fine timer that span needs
  asis: { timers: true, span: false, diagSave: true, perfSave: true, menu: 'open' }, // the isolation bench's first run: the state the records were taken in (menu open on the 性能 tab: its once-a-second redraw and probe)
  iso: { timers: false, span: false, diagSave: false, perfSave: false, menu: 'closed' }, // the isolation bench's second run: no timestamps, menu closed, no heartbeat save, no 5 s save
};
export const BENCH_PLANS = { cmp: ['std'], iso: ['asis', 'iso'] }; // the two buttons: the comparison bench / the comparison bench with the isolation

const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
// nearest-rank quantile of a sorted array (q = 0.95 -> the value 95 % of the samples are at or below)
export const quantile = (sorted, q) => { const n = sorted.length; if (!n) return null; return sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]; };
const sortedOf = a => Float64Array.from(a.filter(x => Number.isFinite(x))).sort();
const median = s => { const n = s.length; return n ? (s[(n - 1) >> 1] + s[n >> 1]) / 2 : null; };
// { n, med, p95, p99, max } of a list of numbers (null for none)
export const statsOf = a => { const s = sortedOf(a); if (!s.length) return null; return { n: s.length, med: median(s), p95: quantile(s, 0.95), p99: quantile(s, 0.99), max: s[s.length - 1], min: s[0], mean: s.reduce((x, y) => x + y, 0) / s.length }; };

// ---- the script: which scene it is, which frame intervals / samples belong to which scene ----
// start(now) / tick(now) every frame (a scene's time is in ms of `now`) / frame(ts) at the start of every XR frame callback (ts = the XR frame time: the interval to the previous frame) /
// sample(kind, ms) (vol, span, main as they are read) / observe(cover, f) every frame / summary()
export function createBenchScript({ scenes = BENCH_SCENES, discardMs = BENCH_DISCARD_MS, budgetMs = 1000 / 72 } = {}) {
  const S = scenes.map(sc => ({ ...sc, dts: [], g: [0, 0, 0], vol: [], span: [], main: [], cov: [], f: [], reached: false, measureAt: 0, measuredMs: 0, partial: false }));
  let idx = -1, t0 = 0, lastTs = null, phase = 'idle', done = false;
  const state = { idx: -1, scene: null, phase: 'idle', changed: false, done: false, sceneMs: 0 };
  const enter = (i, now) => { idx = i; t0 = now; phase = 'settle'; const sc = S[i]; sc.reached = true; state.changed = true; };
  const close = now => { const sc = S[idx]; if (sc && sc.measureAt > 0) sc.measuredMs = Math.max(0, now - sc.measureAt); };
  const api = {
    state, scenes: S,
    set budgetMs(v) { if (Number.isFinite(v) && v > 0) budgetMs = v; }, get budgetMs() { return budgetMs; },
    get phase() { return phase; }, get done() { return done; }, get idx() { return idx; },
    start(now) { idx = -1; lastTs = null; done = false; phase = 'idle'; enter(0, now); state.done = false; return api.tick(now); },
    tick(now) {
      state.changed = false;
      if (idx >= 0 && !done) {
        if (now - t0 >= S[idx].ms) { // the scene's time is over: the next one, or the end
          close(now);
          if (idx + 1 >= S.length) { done = true; phase = 'done'; state.changed = true; } else enter(idx + 1, now);
        }
        if (!done) {
          const sc = S[idx];
          if (now - t0 >= discardMs) { if (phase !== 'measure') { phase = 'measure'; sc.measureAt = now; } } else phase = 'settle';
        }
      }
      state.idx = idx; state.scene = S[idx] ?? null; state.phase = phase; state.done = done; state.sceneMs = idx >= 0 ? now - t0 : 0;
      return state;
    },
    // the interval from the previous frame: counted (with its 1 / 2 / 3+ period class) only in the measured part of a scene; a frame at a scene change has no interval of its own for the new scene
    frame(ts) {
      const dt = lastTs === null ? null : ts - lastTs; lastTs = ts;
      if (phase !== 'measure' || done || dt === null || !(dt > 0)) return;
      const sc = S[idx]; sc.dts.push(dt); sc.g[gapBucket(dt, budgetMs)]++;
    },
    sample(kind, ms) { if (phase !== 'measure' || done || !Number.isFinite(ms)) return; const a = S[idx][kind]; if (a && a.length < 20000) a.push(ms); },
    observe(cover, f) { if (phase !== 'measure' || done) return; const sc = S[idx]; if (sc.cov.length < 20000) { sc.cov.push(cover); sc.f.push(f); } },
    // the run ended early (the session ended, the bench was stopped): the scene in progress is a partial one
    abort(now) { if (done) return; if (idx >= 0) { close(now); S[idx].partial = true; } done = true; phase = 'done'; state.done = true; state.phase = 'done'; },
    // one summary per scene (a scene not reached has reached: false and no numbers)
    summary() {
      return S.map(sc => {
        const n = sc.dts.length, drops = sc.g[1] + sc.g[2], d = statsOf(sc.dts), cov = statsOf(sc.cov), f = statsOf(sc.f);
        return {
          id: sc.id, rot: !!sc.rot, coverTarget: sc.cover, reached: sc.reached, partial: sc.partial, measuredMs: Math.round(sc.measuredMs), frames: n, g1: sc.g[0], g2: sc.g[1], g3: sc.g[2],
          drop: n ? drops / n : null, p95: d ? r2(d.p95) : null, p99: d ? r2(d.p99) : null, max: d ? r2(d.max) : null, mean: d ? r2(d.mean) : null,
          span: statsOf(sc.span), vol: statsOf(sc.vol), main: statsOf(sc.main), cov: cov ? { med: Math.round(cov.med), min: Math.round(cov.min), max: Math.round(cov.max) } : null, f: f ? { avg: Math.round(f.mean * 1000) / 1000, min: Math.round(f.min * 1000) / 1000 } : null,
        };
      });
    },
  };
  return api;
}

// ---- the cover tuner: the body's size and distance are moved until the covered px (both eyes) is about the scene's target ----
// feed(cov) every frame (smoothed), step(framing, clamp) every BENCH_TUNE_MS while the scene settles. covered px ~ (scale / dist)^2: the size is moved first (as far as clamp(scale) allows), the rest goes to the distance.
export function createCoverTuner({ target, tol = 0.08, gain = 0.7, minDist = 0.2, maxDist = 3 } = {}) {
  let ema = null, okSteps = 0;
  return {
    get ema() { return ema; }, get ok() { return okSteps; }, target,
    feed(cov) { if (Number.isFinite(cov) && cov >= 0) ema = ema === null ? cov : ema * 0.8 + cov * 0.2; },
    step(framing, clamp = s => s) {
      if (ema === null) return framing;
      if (!(ema > 1000)) { framing.dist = Math.max(minDist, framing.dist * 0.9); okSteps = 0; return framing; } // nothing of the body is on screen: come closer
      const ratio = target / ema;
      if (Math.abs(ratio - 1) <= tol) { okSteps++; return framing; }
      okSteps = 0;
      const r = Math.pow(ratio, 0.5 * gain), s = clamp(framing.scale * r), rs = s / framing.scale, rd = r / rs;
      framing.scale = s; framing.dist = Math.min(maxDist, Math.max(minDist, framing.dist / rd));
      return framing;
    },
  };
}

// ---- the report of a bench ----
const pad = (v, w) => String(v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '-' : v).padStart(w);
const fix = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : null);
const MODE_TEXT = {
  std: 'std (menu closed; volume timestamps and the frame marker (span) on; heartbeat and 5 s saves on)',
  asis: 'as is (menu open on the performance tab; volume timestamps on, no frame marker; heartbeat and 5 s saves on)',
  iso: 'isolated (menu closed; no volume timestamps and no read-back; no heartbeat save; no 5 s save)',
};
// runs = [{ mode, when, scenes: summary() }]; meta = { kind, build, hz }
export function benchReportLines(runs, { kind = 'webgl', build = '', hz = null } = {}) {
  if (!runs?.length) return [];
  const L = [];
  L.push('-- comparison bench: ' + (kind === 'webgpu' ? 'WebGPU' : 'WebGL') + (build ? ' · build ' + build : '') + (hz ? ' · target ' + hz + ' Hz' : '') + ' · 100 %, auto quality off, no section plane, the body straight ahead (turning scenes: ' + BENCH_ROT_RATE + ' rad/s); the first ' + BENCH_DISCARD_MS / 1000 + ' s of every scene are left out');
  L.push('note: drop% = share of the frame intervals of 1.5 refresh periods or more (g2 + g3, the performance record\'s own count: the interval between two XR frame callbacks, not the compositor\'s drops); p95 / p99 / max = frame intervals in ms; span / vol = ms (WebGPU only; span needs the frame marker pass, so it is "-" in a run without it); cov = covered px of both eyes (median); f = render scale (mean / lowest).');
  runs.forEach((run, i) => {
    L.push((run.label || 'run ' + (i + 1) + ' of ' + runs.length) + ' · ' + (MODE_TEXT[run.mode] || run.mode) + (run.partial ? ' · INCOMPLETE (the session ended first)' : ''));
    L.push(['scene'.padEnd(8), 'sec'.padStart(5), 'frames'.padStart(6), 'drop%'.padStart(6), 'g2'.padStart(4), 'g3'.padStart(3), 'p95'.padStart(6), 'p99'.padStart(6), 'max'.padStart(6), 'spanMed'.padStart(8), 'spanP95'.padStart(8), 'volMed'.padStart(7), 'volP95'.padStart(7), 'mainMed'.padStart(8), 'covMed'.padStart(8), 'f'.padStart(6), 'fMin'.padStart(6)].join(' '));
    for (const s of run.scenes) {
      if (!s.reached) { L.push(s.id.padEnd(8) + ' not reached'); continue; }
      L.push([s.id.padEnd(8), pad(fix(s.measuredMs / 1000, 1), 5), pad(s.frames, 6), pad(s.drop === null ? null : fix(s.drop * 100, 2), 6), pad(s.g2, 4), pad(s.g3, 3), pad(s.p95, 6), pad(s.p99, 6), pad(s.max, 6),
        pad(s.span ? r2(s.span.med) : null, 8), pad(s.span ? r2(s.span.p95) : null, 8), pad(s.vol ? r2(s.vol.med) : null, 7), pad(s.vol ? r2(s.vol.p95) : null, 7), pad(s.main ? r2(s.main.med) : null, 8), pad(s.cov ? s.cov.med : null, 8), pad(s.f ? s.f.avg : null, 6), pad(s.f ? s.f.min : null, 6)].join(' ') + (s.partial ? ' (partial)' : ''));
    }
  });
  for (const n of [...new Set(runs.map(r => r.n))]) { // the isolation of each bench: the same scenes as is and isolated
    const a = runs.find(r => r.n === n && r.mode === 'asis'), b = runs.find(r => r.n === n && r.mode === 'iso');
    if (!a || !b) continue;
    L.push('isolation of ' + (n !== undefined ? 'bench ' + n : 'the bench') + ' (as is -> isolated), per scene: drop% and p99 ms');
    for (const sa of a.scenes) { const sb = b.scenes.find(x => x.id === sa.id); if (!sb || !sa.reached || !sb.reached) continue; L.push('  ' + sa.id.padEnd(8) + ' drop% ' + pad(sa.drop === null ? null : fix(sa.drop * 100, 2), 6) + ' -> ' + pad(sb.drop === null ? null : fix(sb.drop * 100, 2), 6) + ' · p99 ' + pad(sa.p99, 6) + ' -> ' + pad(sb.p99, 6)); }
  }
  return L;
}

// ---- the frame ring: the last 2000 frames ----
export const RING_SIZE = 2000;
export const RING_SLOW_MS = 30; // an interval longer than this is a slow frame: the frames around it are kept
export const RING_COUNTERS = ['menu', 'tex', 'dsave', 'psave', 'mk', 'maps']; // running totals the host passes each frame (the ring keeps the difference since the previous frame)
// menu = menu / help / mission board canvases redrawn, tex = canvas textures uploaded (the boards and the toast: the places that count it), dsave / psave = the diagnostics' / the performance record's localStorage writes,
// mk = objects the WebGPU renderer made (targets + tile textures + bind groups), maps = timestamp read-backs (mapAsync) started
export const BENCH_COUNT = { menu: 0, tex: 0 }; // incremented by vr-view.js where a board canvas is redrawn / a canvas texture is flagged for upload
const RING_STATE = ['hold', 'f', 'per', 'cov'];
export function createFrameRing({ size = RING_SIZE, slowMs = RING_SLOW_MS, before = 3, after = 3, maxWindows = 40 } = {}) {
  const cols = {}; for (const k of ['dt', 'cb', 'pre', ...RING_COUNTERS, 'heap', ...RING_STATE]) cols[k] = new Float32Array(size);
  const tt = new Float64Array(size);
  let n = 0, lastTs = null, pendCb = NaN, pendPre = NaN, prevHeap = 0, slow = 0, windowsDropped = 0, pend = null;
  const prev = {}; for (const k of RING_COUNTERS) prev[k] = null;
  const windows = [];
  const rec = abs => { // the record of absolute index abs as a plain object (reporting only)
    const i = abs % size, o = { n: abs, t: tt[i] };
    for (const k in cols) o[k] = cols[k][i];
    return o;
  };
  const lo = () => Math.max(0, n - size);
  const copyWindow = (from, to) => { const a = []; for (let i = Math.max(from, lo()); i <= Math.min(to, n - 1); i++) a.push(rec(i)); return a; };
  const finalize = () => { if (!pend) return; const w = copyWindow(pend.from, pend.to); pend = null; if (w.length) { windows.push(w); if (windows.length > maxWindows) { windows.shift(); windowsDropped++; } } };
  const api = {
    size, windows, before, after,
    get count() { return n; }, get slowCount() { return slow; }, get windowsDropped() { return windowsDropped; },
    // the callback that just ended: its total CPU ms and the ms until the volume pass was submitted (NaN = none); shown with the interval that follows it
    callback(cb, pre) { pendCb = Number.isFinite(cb) ? cb : NaN; pendPre = Number.isFinite(pre) ? pre : NaN; },
    // the start of an XR frame callback: ts = the frame's time, c = { menu, tex, dsave, psave, mk, maps (running totals), heap (bytes), hold, f, per, cov }; one record for the interval that ends here
    frame(ts, c = {}) {
      if (lastTs !== null && !(ts > lastTs)) return;
      const dt = lastTs === null ? NaN : ts - lastTs; lastTs = ts;
      const heap = Number.isFinite(c.heap) ? c.heap : 0;
      if (!Number.isFinite(dt)) { for (const k of RING_COUNTERS) prev[k] = c[k] ?? 0; prevHeap = heap; return; } // the first frame has no interval
      const i = n % size; tt[i] = ts; cols.dt[i] = dt; cols.cb[i] = pendCb; cols.pre[i] = pendPre; pendCb = pendPre = NaN;
      for (const k of RING_COUNTERS) { const v = c[k] ?? 0; cols[k][i] = prev[k] === null ? 0 : Math.max(0, v - prev[k]); prev[k] = v; }
      cols.heap[i] = prevHeap > 0 && heap > 0 ? Math.max(0, prevHeap - heap) / 1024 : 0; prevHeap = heap; // KB the JS heap shrank by since the previous frame (a garbage collection)
      for (const k of RING_STATE) cols[k][i] = Number.isFinite(c[k]) ? c[k] : NaN;
      if (dt > slowMs) { slow++; if (pend) pend.to = n + after; else pend = { from: n - before, to: n + after }; }
      n++;
      if (pend && n - 1 >= pend.to) finalize();
    },
    // the records of the ring, oldest first (plain objects; reporting)
    records() { const a = []; for (let i = lo(); i < n; i++) a.push(rec(i)); return a; },
    // the windows kept (a window still waiting for its frames after is included as far as it goes)
    allWindows() { const w = windows.slice(); if (pend) { const x = copyWindow(pend.from, pend.to); if (x.length) w.push(x); } return w; },
    stats() { const s = statsOf(Array.from(cols.dt.subarray(0, Math.min(n, size)))); return { frames: Math.min(n, size), total: n, slow, windowsDropped, slowMs, ...(s ? { med: r2(s.med), p95: r2(s.p95), p99: r2(s.p99), max: r2(s.max) } : {}) }; },
  };
  return api;
}
// the long-task observer (PerformanceObserver 'longtask'): tasks = [{ s: start ms, d: duration ms }] (the newest 300); overlap(a, b) = ms of long tasks inside [a, b]
export function createLongTaskWatcher({ PO = globalThis.PerformanceObserver } = {}) {
  const tasks = []; let obs = null, ok = false;
  return {
    tasks, get supported() { return ok; },
    start() { try { obs = new PO(list => { for (const e of list.getEntries()) { tasks.push({ s: e.startTime, d: e.duration }); if (tasks.length > 300) tasks.shift(); } }); obs.observe({ entryTypes: ['longtask'] }); ok = true; } catch { obs = null; ok = false; } return ok; },
    stop() { try { obs?.disconnect(); } catch { /* gone */ } obs = null; },
    overlap(a, b) { let t = 0; for (const x of tasks) { const o = Math.min(b, x.s + x.d) - Math.max(a, x.s); if (o > 0) t += o; } return t; },
  };
}
export const readHeapBytes = () => { try { return globalThis.performance?.memory?.usedJSHeapSize || 0; } catch { return 0; } };

const RING_COLS = [['n', 6], ['t', 8], ['dt', 6], ['cb', 5], ['pre', 5], ['menu', 4], ['tex', 3], ['ds', 3], ['ps', 3], ['mk', 3], ['mp', 3], ['gc', 6], ['hold', 4], ['f', 5], ['cov', 8], ['lt', 5], ['flag', 4]];
// the ring's text: its numbers, then the windows around the slow frames (the frame over the limit is marked *)
export function ringReportLines(ring, { longTasks = null, sinceMs = 0 } = {}) {
  const st = ring.stats(), L = [];
  L.push('-- frame ring: the last ' + st.frames + ' of ' + st.total + ' frames' + (st.med !== undefined ? ' · interval median ' + st.med + ' · p95 ' + st.p95 + ' · p99 ' + st.p99 + ' · max ' + st.max + ' ms' : '') + ' · ' + st.slow + ' intervals over ' + st.slowMs + ' ms in the session' + (longTasks ? ' · long tasks ' + (longTasks.supported ? longTasks.tasks.length + ' seen' : 'not available here') : ''));
  L.push('note: a record is the frame interval that ENDS at that frame (t = s since the session start; dt = the interval in ms); cb / pre = the callback that ran just before it (total CPU ms; start to the volume pass submit); the counts are what happened in that interval: menu = board canvases redrawn, tex = canvas textures flagged for upload (boards and toast only), ds / ps = diagnostics / performance-record localStorage writes, mk = objects the WebGPU renderer made, mp = timestamp read-backs (mapAsync) started, gc = KB the JS heap shrank by (garbage collection; "-" = none or no heap reading), hold = hands holding, f = render scale, cov = covered px, lt = ms of long tasks (>50 ms main-thread tasks) overlapping the interval. Flags: * = the slow frame, H = the hands holding changed from the row above, F = the render scale changed by more than 0.01, P = the periphery scale changed (the periphery pass switched on / off or its factor changed).');
  const ws = ring.allWindows();
  L.push('-- slow frames: ' + ws.length + ' window(s) of ' + ring.before + ' frames before and ' + ring.after + ' after an interval over ' + st.slowMs + ' ms' + (st.windowsDropped ? ' (' + st.windowsDropped + ' older windows dropped)' : ''));
  L.push(RING_COLS.map(([k, w]) => k.padStart(w)).join(' '));
  const num = (v, d = 0) => (Number.isFinite(v) ? (d ? v.toFixed(d) : String(Math.round(v))) : '-');
  const nz = v => (Number.isFinite(v) && v > 0 ? String(Math.round(v)) : '-');
  ws.forEach((w, wi) => {
    if (wi) L.push('');
    w.forEach((r, i) => {
      const prevR = i > 0 ? w[i - 1] : null, lt = longTasks?.supported ? longTasks.overlap(r.t - r.dt, r.t) : NaN;
      const marks = (r.dt > st.slowMs ? '*' : ' ') + (prevR && prevR.hold !== r.hold ? 'H' : ' ') + (prevR && Number.isFinite(r.f) && Math.abs(prevR.f - r.f) > 0.01 ? 'F' : ' ') + (prevR && Number.isFinite(r.per) && Number.isFinite(prevR.per) && Math.abs(prevR.per - r.per) > 0.01 ? 'P' : ' ');
      L.push([String(r.n).padStart(6), ((r.t - sinceMs) / 1000).toFixed(2).padStart(8), num(r.dt, 1).padStart(6), num(r.cb, 1).padStart(5), num(r.pre, 1).padStart(5), nz(r.menu).padStart(4), nz(r.tex).padStart(3), nz(r.dsave).padStart(3), nz(r.psave).padStart(3), nz(r.mk).padStart(3), nz(r.maps).padStart(3),
        (r.heap > 0 ? Math.round(r.heap) + 'K' : '-').padStart(6), num(r.hold).padStart(4), num(r.f, 2).padStart(5), num(r.cov).padStart(8), (lt > 0 ? lt.toFixed(0) : '-').padStart(5), marks.padStart(4)].join(' '));
    });
  });
  return L;
}

// ---- the isolation switches ----
// state = what is on now (ISO_MODES); apply(mode) sets it and tells the host (onChange(state)); reset() = the default (what the view always did)
export function createIsolation({ onChange = null } = {}) {
  const state = { mode: 'default', ...ISO_MODES.default };
  const api = { state, apply(mode) { const m = ISO_MODES[mode] || ISO_MODES.default; Object.assign(state, m, { mode: ISO_MODES[mode] ? mode : 'default' }); try { onChange?.(state); } catch { /* the host's */ } return state; }, reset() { return api.apply('default'); } };
  return api;
}
// a perf log's add / sample calls are also handed to `taps` ({ add(k, ms, n), sample(k, ms) }): the bench reads vol / span / pre from the calls the view already makes (no change to the log's own code)
export function tapPerfLog(log, taps) {
  const add = log.add, sample = log.sample;
  if (taps.add) log.add = (k, ms, n) => { try { taps.add(k, ms, n); } catch { /* a tap never breaks the log */ } return add(k, ms, n); };
  if (taps.sample) log.sample = (k, ms) => { try { taps.sample(k, ms); } catch { /* the same */ } return sample(k, ms); };
  return () => { log.add = add; log.sample = sample; };
}

// ---- the comparison bench controller ----
// env (the host's hands; the controller never touches the view itself):
//   now() ms · budgetMs() the refresh period · can() '' or the reason it cannot start now · enter() / leave(ok) save and set up / restore the view (100 %, no section, the user's pose and settings) ·
//   menu('closed' | 'open') · iso(state) applies the switches · scene(sc) puts the body in front of the head at its standard pose and returns { scale, dist } · pose(angle) the turn about the vertical axis ·
//   frame({ scale, dist }) puts the body at that size and distance · clamp(s) the allowed scale · read() { cover, f } of the frame just drawn · progress(text) · done(runs, ok)
// start(plan) = 'cmp' | 'iso'. tick(now) once per frame after the pose is read; frame(ts) at the start of each frame callback; sample(kind, ms).
export function createCompareBench(env, iso = createIsolation(), { scenes = BENCH_SCENES } = {}) { // iso = the switches the view reads (one object, made before the session: the heartbeat, the timers and the frame marker read it)
  let active = false, plan = [], runIdx = 0, script = null, tuner = null, framing = null, sceneAt = 0, tuneAt = 0, lastProgress = 0, runs = [];
  const finishRun = (partial, now) => {
    if (partial) script.abort(now);
    runs.push({ mode: plan[runIdx], when: env.now(), partial: !!partial, scenes: script.summary() });
  };
  const startRun = now => {
    const mode = plan[runIdx];
    env.iso?.(iso.apply(mode)); env.menu?.(ISO_MODES[mode].menu === 'open' ? 'open' : 'closed');
    script = createBenchScript({ scenes, budgetMs: env.budgetMs() }); script.start(now); beginScene(now);
  };
  const beginScene = now => {
    const sc = script.state.scene;
    framing = { ...env.scene(sc) }; sceneAt = now; tuneAt = now;
    tuner = sc.cover > 0 ? createCoverTuner({ target: sc.cover }) : null;
    env.pose(0);
  };
  const end = ok => { active = false; env.iso?.(iso.reset()); env.leave?.(ok); env.done?.(runs, ok); };
  const api = {
    get active() { return active; }, get runs() { return runs; }, iso,
    // '' = started, otherwise the reason it did not
    start(name) {
      if (active) return 'running';
      const why = env.can?.() || ''; if (why) return why;
      plan = BENCH_PLANS[name] || BENCH_PLANS.cmp; runIdx = 0; runs = []; active = true; env.enter?.();
      startRun(env.now()); return '';
    },
    tick(now) {
      if (!active) return;
      const st = script.tick(now);
      if (st.done) { finishRun(false, now); runIdx++; if (runIdx >= plan.length) { end(true); return; } startRun(now); return; }
      if (st.changed) beginScene(now);
      const sc = st.scene, rd = env.read();
      if (tuner) {
        tuner.feed(rd.cover);
        if (st.phase === 'settle' && now - tuneAt >= BENCH_TUNE_MS) { tuneAt = now; tuner.step(framing, env.clamp); }
      }
      env.frame(framing);
      env.pose(sc.rot ? BENCH_ROT_RATE * (now - sceneAt) / 1000 : 0);
      script.observe(rd.cover, rd.f);
      if (now - lastProgress >= 1000) { lastProgress = now; env.progress?.({ run: runIdx + 1, runs: plan.length, mode: plan[runIdx], scene: st.idx + 1, scenes: script.scenes.length, id: sc.id, sec: Math.round(st.sceneMs / 1000), of: Math.round(sc.ms / 1000) }); }
    },
    frame(ts) { if (active) script.frame(ts); },
    sample(kind, ms) { if (active) script.sample(kind, ms); },
    // the session ended (or the user stopped it) in the middle: what was measured is kept as an incomplete run
    abort(now = env.now()) { if (!active) return; finishRun(true, now); end(false); },
  };
  return api;
}
