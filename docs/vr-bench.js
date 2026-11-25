// The comparison bench, the per-frame ring and the isolation switches of the VR view (Quest 3: the WebGL view and the WebGPU view alike).
// Pure (no DOM, no three.js, no GPU): vr-view.js drives it frame by frame and shows the text in the performance record (vr-perf-log.js sections). Nothing here changes what is drawn,
// except through the host's own calls the controller makes (the body's pose / size, the menu, the quality settings) while a bench runs.
//
//  1. createBenchScript / createCompareBench: a scripted run (the body at its largest size, 0.30 m longest side, held in front of the head and shaken, no section plane, 100 %, auto quality off, the hold scale off)
//     of four segments = two scenes x two periods: hold (the body 0.45 m +- 0.12 m from the head) and near (0.30 m +- 0.08 m), each with a violent period and a slow period (45 s each, 180 s a run).
//     The pose is a function of the time since the scene began and of the head's position and heading taken once at the start (benchPose: no frame counts, so the WebGL and the WebGPU view move alike);
//     the violent period is the user's own way of handling the body (a turn about the vertical axis at 150 deg/s with two tilts and three translations laid over it), the slow period the same figure at the slower
//     speeds of the user's recorded seconds (BENCH_SPEED). The first 2 s of each segment are left out; per segment: drops (frame intervals of 1.5 refresh periods or more = g2 + g3, as the performance record counts
//     them), the 95 / 99 % points and the longest frame interval, (WebGPU) the median and the 95 % point of span and vol, and what really came out: covered px, scale f / cap, the volume's movement (mv cm/s, mvr deg/s
//     as the performance record counts them) and how far the head moved.
//  2. createFrameRing: the last 2000 frames, one record each, with what happened in that frame interval; windows around the frames over 30 ms are kept for the report.
//  3. createIsolation: the switches of the isolation run (volume timestamps and their read-back, the menu's once-a-second redraw, the diagnostics' heartbeat save, the performance record's 5 s save).
import { gapBucket } from './vr-perf-log.js?v=20261125-build763';
import { MAX_LONG_M, NORM_LONG } from './vr-real-scale.js?v=20261125-build763';

export const BENCH_DISCARD_MS = 2000; // the first 2 s of every segment are left out of its numbers
export const BENCH_SEGMENT_MS = 45000; // one segment (a scene in one period)
// the scenes: where the body is held, as the distance from the head (m): the middle and the swing (a sine at BENCH_MOTION.distHz)
export const BENCH_SCENES = [
  { id: 'hold', dist: 0.45, distAmp: 0.12 }, // held out and shaken
  { id: 'near', dist: 0.30, distAmp: 0.08 }, // held close
];
// the violent figure (the user's own handling, from the recorded sessions): yaw = a steady turn about the vertical axis (deg/s); pitch (forward tilt) / roll (sideways tilt) = amplitude deg and Hz;
// lateral / vertical = amplitude m and Hz of the move to the side and up and down; distHz = the Hz of the swing in distance (its amplitude is the scene's)
export const BENCH_MOTION = { yawDegPerS: 150, pitchDeg: 45, pitchHz: 0.4, rollDeg: 30, rollHz: 0.3, lateralM: 0.12, lateralHz: 0.35, verticalM: 0.06, verticalHz: 0.5, distHz: 0.25 };
// the slow period: the same figure with its clocks slowed (the turn and the tilts by rot, the three translations by trans). The numbers are the slow side (the lower quartile) of the volume's recorded movement in the seconds
// the volume was held, (WebGPU) and 756 (WebGPU, WebGL): 208 seconds, mv 12 cm/s and mvr 58 deg/s; with these factors the figure's median comes to about 12 cm/s and 58 deg/s (the violent period: about 25 cm/s and 180 deg/s)
export const BENCH_SPEED = { fast: { rot: 1, trans: 1 }, slow: { rot: 0.32, trans: 0.45 } };
// the segments in order (the first moves from the first frame: no still scene); a scene's clock runs on through its two periods
export const BENCH_SEGMENTS = [];
for (const sc of BENCH_SCENES) for (const period of ['fast', 'slow']) BENCH_SEGMENTS.push({ id: sc.id + '/' + period, scene: sc.id, period, ms: BENCH_SEGMENT_MS });
// the conditions a run can have (what is on while its segments run): timers = the volume pass's GPU timestamps and their read-back (WebGL: the timer queries), span = the frame marker pass that gives span / gap
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

// ---- the pose: a function of time alone ----
const D2R = Math.PI / 180, TAU = 2 * Math.PI;
export const BENCH_HOLDER_SCALE = MAX_LONG_M / NORM_LONG; // the body at the largest size the view allows: its displayed longest side is MAX_LONG_M (0.30 m)
// the time (s) the figure's clock has run `tMs` ms into a scene, as the segments of that scene (in order, { ms, period }) slow it: key 'rot' (the turn and the tilts) or 'trans' (the three translations).
// The clock is continuous over a change of period (the speed changes, the pose does not jump); past the last segment the last period goes on
export function benchWarp(segments, tMs, key) {
  let t = 0, left = Math.max(0, tMs);
  for (const sg of segments) {
    const k = BENCH_SPEED[sg.period]?.[key] ?? 1;
    if (left <= sg.ms) return t + left / 1000 * k;
    t += sg.ms / 1000 * k; left -= sg.ms;
  }
  const last = segments[segments.length - 1];
  return t + left / 1000 * (last ? BENCH_SPEED[last.period]?.[key] ?? 1 : 1);
}
// the segments of one scene
export const benchSegmentsOf = (sceneId, segments = BENCH_SEGMENTS) => segments.filter(s => s.scene === sceneId);
// the quaternion [x, y, z, w] of the Euler angles YXZ (yaw about the vertical axis, then pitch, then roll: three.js' 'YXZ' order)
export function quatYXZ(yaw, pitch, roll) {
  const c1 = Math.cos(yaw / 2), s1 = Math.sin(yaw / 2), c2 = Math.cos(pitch / 2), s2 = Math.sin(pitch / 2), c3 = Math.cos(roll / 2), s3 = Math.sin(roll / 2);
  return [s2 * c1 * c3 + c2 * s1 * s3, c2 * s1 * c3 - s2 * c1 * s3, c2 * c1 * s3 - s2 * s1 * c3, c2 * c1 * c3 + s2 * s1 * s3];
}
// the body's pose `tMs` ms into scene `scene` (a BENCH_SCENES entry), with `segments` = the scene's segments (benchSegmentsOf) and ref = { x, y, z, yaw }: the head's position (m) and its heading (rad about the vertical axis,
// 0 = looking along -z) taken ONCE when the bench starts. Returns { pos: [x, y, z], quat: [x, y, z, w], scale } in world space; the same time gives the same pose, whatever frames came before.
// It moves from the very first moment: at tMs = 0 every part of the figure is at the middle of its swing and moving.
export function benchPose(scene, segments, tMs, ref = { x: 0, y: 0, z: 0, yaw: 0 }) {
  const m = BENCH_MOTION, r = benchWarp(segments, tMs, 'rot'), s = benchWarp(segments, tMs, 'trans');
  const yaw = ref.yaw + m.yawDegPerS * D2R * r, pitch = m.pitchDeg * D2R * Math.sin(TAU * m.pitchHz * r), roll = m.rollDeg * D2R * Math.sin(TAU * m.rollHz * r);
  const lat = m.lateralM * Math.sin(TAU * m.lateralHz * s), up = m.verticalM * Math.sin(TAU * m.verticalHz * s), dist = scene.dist + scene.distAmp * Math.sin(TAU * m.distHz * s);
  const sn = Math.sin(ref.yaw), cs = Math.cos(ref.yaw); // the heading: forward = (-sin, 0, -cos), right = (cos, 0, -sin)
  return { pos: [ref.x - sn * dist + cs * lat, ref.y + up, ref.z - cs * dist - sn * lat], quat: quatYXZ(yaw, pitch, roll), scale: BENCH_HOLDER_SCALE };
}
// the angle (deg) between two quaternions [x, y, z, w] (the way the performance record counts the volume's rotation: Quaternion.angleTo)
export const quatAngleDeg = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) / D2R;

// ---- the script: which segment it is, which frame intervals / samples belong to which segment ----
// start(now) / tick(now) every frame (a segment's time is in ms of `now`) / frame(ts) at the start of every XR frame callback (ts = the XR frame time: the interval to the previous frame) /
// sample(kind, ms) (vol, span, main as they are read) / observe(cover, f, cap) every frame / move(cm, deg) = the volume's world movement since the previous frame (the performance record's own call) /
// head(h) every frame (the head's pose: { x, y, z, qx, qy, qz, qw }) / summary()
// A segment has a second-by-second record of the volume's movement (mv cm/s, mvr deg/s), made the way the performance record makes its rows: the movement summed over the frame intervals of the second.
export function createBenchScript({ segments = BENCH_SEGMENTS, discardMs = BENCH_DISCARD_MS, budgetMs = 1000 / 72 } = {}) {
  const S = segments.map(sg => ({ ...sg, dts: [], g: [0, 0, 0], vol: [], span: [], main: [], cov: [], f: [], cap: [], mv: [], mvr: [], headCm: 0, headDeg: 0, reached: false, measureAt: 0, measuredMs: 0, partial: false }));
  let idx = -1, t0 = 0, lastTs = null, phase = 'idle', done = false, binMs = 0, binCm = 0, binDeg = 0, lastHead = null;
  const state = { idx: -1, seg: null, phase: 'idle', changed: false, done: false, segMs: 0 };
  const enter = (i, now) => { idx = i; t0 = now; phase = 'settle'; const sc = S[i]; sc.reached = true; state.changed = true; binMs = binCm = binDeg = 0; };
  const close = now => { const sc = S[idx]; if (sc && sc.measureAt > 0) sc.measuredMs = Math.max(0, now - sc.measureAt); };
  const api = {
    state, segments: S,
    set budgetMs(v) { if (Number.isFinite(v) && v > 0) budgetMs = v; }, get budgetMs() { return budgetMs; },
    get phase() { return phase; }, get done() { return done; }, get idx() { return idx; },
    start(now) { idx = -1; lastTs = null; lastHead = null; done = false; phase = 'idle'; enter(0, now); state.done = false; return api.tick(now); },
    tick(now) {
      state.changed = false;
      if (idx >= 0 && !done) {
        if (now - t0 >= S[idx].ms) { // the segment's time is over: the next one, or the end
          close(now);
          if (idx + 1 >= S.length) { done = true; phase = 'done'; state.changed = true; } else enter(idx + 1, now);
        }
        if (!done) {
          const sc = S[idx];
          if (now - t0 >= discardMs) { if (phase !== 'measure') { phase = 'measure'; sc.measureAt = now; } } else phase = 'settle';
        }
      }
      state.idx = idx; state.seg = S[idx] ?? null; state.phase = phase; state.done = done; state.segMs = idx >= 0 ? now - t0 : 0;
      return state;
    },
    // the interval from the previous frame: counted (with its 1 / 2 / 3+ period class) only in the measured part of a segment; a frame at a segment change has no interval of its own for the new segment
    frame(ts) {
      const dt = lastTs === null ? null : ts - lastTs; lastTs = ts;
      if (phase !== 'measure' || done || dt === null || !(dt > 0)) return;
      const sc = S[idx]; sc.dts.push(dt); sc.g[gapBucket(dt, budgetMs)]++;
      binMs += dt; // the movement record: a bin closes when its frame intervals add up to a second (the movement of the frame that ends this interval is added by move(), later in the same frame: it belongs to the next bin or the one after, as in the performance record)
      if (binMs >= 1000) { if (sc.mv.length < 2000) { sc.mv.push(binCm * 1000 / binMs); sc.mvr.push(binDeg * 1000 / binMs); } binMs = binCm = binDeg = 0; }
    },
    move(cm, deg) { if (phase !== 'measure' || done) return; if (Number.isFinite(cm) && cm >= 0) binCm += cm; if (Number.isFinite(deg) && deg >= 0) binDeg += deg; },
    head(h) {
      if (!h) return;
      if (lastHead && phase === 'measure' && !done) { const sc = S[idx]; sc.headCm += Math.hypot(h.x - lastHead.x, h.y - lastHead.y, h.z - lastHead.z) * 100; sc.headDeg += quatAngleDeg([h.qx, h.qy, h.qz, h.qw], [lastHead.qx, lastHead.qy, lastHead.qz, lastHead.qw]); }
      lastHead = { x: h.x, y: h.y, z: h.z, qx: h.qx, qy: h.qy, qz: h.qz, qw: h.qw }; // a copy: the host may hand the same object every frame and change it in place
    },
    sample(kind, ms) { if (phase !== 'measure' || done || !Number.isFinite(ms)) return; const a = S[idx][kind]; if (a && a.length < 20000) a.push(ms); },
    observe(cover, f, cap) { if (phase !== 'measure' || done) return; const sc = S[idx]; if (sc.cov.length < 20000) { sc.cov.push(cover); sc.f.push(f); sc.cap.push(cap); } },
    // the run ended early (the session ended, the bench was stopped): the segment in progress is a partial one
    abort(now) { if (done) return; if (idx >= 0) { close(now); S[idx].partial = true; } done = true; phase = 'done'; state.done = true; state.phase = 'done'; },
    // one summary per segment (a segment not reached has reached: false and no numbers)
    summary() {
      const top = a => { const s = sortedOf(a); return s.length ? { med: r1(median(s)), p90: r1(quantile(s, 0.9)), n: s.length } : null; };
      return S.map(sc => {
        const n = sc.dts.length, drops = sc.g[1] + sc.g[2], d = statsOf(sc.dts), cov = statsOf(sc.cov), f = statsOf(sc.f), cap = statsOf(sc.cap), cs = sortedOf(sc.cov);
        return {
          id: sc.id, scene: sc.scene, period: sc.period, reached: sc.reached, partial: sc.partial, measuredMs: Math.round(sc.measuredMs), frames: n, g1: sc.g[0], g2: sc.g[1], g3: sc.g[2],
          drop: n ? drops / n : null, p95: d ? r2(d.p95) : null, p99: d ? r2(d.p99) : null, max: d ? r2(d.max) : null, mean: d ? r2(d.mean) : null,
          span: statsOf(sc.span), vol: statsOf(sc.vol), main: statsOf(sc.main),
          cov: cov ? { med: Math.round(cov.med), p90: Math.round(quantile(cs, 0.9)), min: Math.round(cov.min), max: Math.round(cov.max) } : null, // p90 = the value the top tenth of the frames reached
          f: f ? { avg: Math.round(f.mean * 1000) / 1000, min: Math.round(f.min * 1000) / 1000 } : null,
          cap: cap ? { med: Math.round(cap.med * 1000) / 1000, min: Math.round(cap.min * 1000) / 1000 } : null,
          mv: top(sc.mv), mvr: top(sc.mvr), head: n ? { cm: r1(sc.headCm), deg: r1(sc.headDeg) } : null,
        };
      });
    },
  };
  return api;
}

// ---- the report of a bench ----
const pad = (v, w) => String(v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '-' : v).padStart(w);
const fix = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : null);
const MODE_TEXT = {
  std: 'std (menu closed; volume timestamps and the frame marker (span) on; heartbeat and 5 s saves on)',
  asis: 'as is (menu open on the performance tab; volume timestamps on, no frame marker; heartbeat and 5 s saves on)',
  iso: 'isolated (menu closed; no volume timestamps and no read-back; no heartbeat save; no 5 s save)',
};
const PERI_TEXT = ['none', 'middle', 'strong'];
// the settings the run was made under (the host's { section, periphery, rate }): the section plane is never drawn in a bench, whatever the user had; periphery = the 周辺の簡略化 setting index; rate = the refresh rate asked for (Hz)
const settingsText = st => (st ? 'settings: section ' + (st.section || 'off') + ' · periphery ' + (PERI_TEXT[st.periphery] ?? st.periphery) + ' (' + st.periphery + ') · refresh rate ' + (st.rate ? st.rate + ' Hz' : '-') : '');
const COLS = [['segment', 10, 'l'], ['sec', 5], ['frames', 6], ['drop%', 6], ['g2', 4], ['g3', 3], ['p95', 6], ['p99', 6], ['max', 6], ['spanMed', 8], ['spanP95', 8], ['volMed', 7], ['volP95', 7], ['mainMed', 8], ['covMed', 8], ['covP90', 8], ['f', 6], ['fMin', 6], ['cap', 6], ['mvMed', 6], ['mvP90', 6], ['mvrMed', 7], ['mvrP90', 7], ['headCm', 7], ['headDeg', 7]];
// runs = [{ mode, when, settings, scenes: summary() }] (`scenes` = one summary per segment); meta = { kind, build, hz }
export function benchReportLines(runs, { kind = 'webgl', build = '', hz = null } = {}) {
  if (!runs?.length) return [];
  const L = [];
  L.push('-- comparison bench: ' + (kind === 'webgpu' ? 'WebGPU' : 'WebGL') + (build ? ' · build ' + build : '') + (hz ? ' · target ' + hz + ' Hz' : '') + ' · the body at its largest size (' + Math.round(MAX_LONG_M * 1000) / 10 + ' cm longest side), held and shaken (a function of time: the same in both views; violent: a turn of ' + BENCH_MOTION.yawDegPerS + ' deg/s with tilts and moves laid over it; slow: the user\'s slow recorded speeds), 100 %, auto quality off, no section plane, no hold scale; the first ' + BENCH_DISCARD_MS / 1000 + ' s of every segment are left out');
  L.push('note: a segment is scene/period: hold = the body ' + BENCH_SCENES[0].dist + ' m +- ' + BENCH_SCENES[0].distAmp + ' m from the head, near = ' + BENCH_SCENES[1].dist + ' m +- ' + BENCH_SCENES[1].distAmp + ' m; fast = the violent period, slow = the slow period (speed factors turn ' + BENCH_SPEED.slow.rot + ', moves ' + BENCH_SPEED.slow.trans + ').');
  L.push('note: drop% = share of the frame intervals of 1.5 refresh periods or more (g2 + g3, the performance record\'s own count: the interval between two XR frame callbacks, not the compositor\'s drops); p95 / p99 / max = frame intervals in ms; span / vol = ms (WebGPU only; span needs the frame marker pass, so it is "-" in a run without it); cov = covered px of both eyes (median / the value the top tenth of the frames reached); f = render scale (mean / lowest); cap = data cap (median); mv / mvr = how far the volume moved, cm/s and deg/s, per second of the segment (median / the value the top tenth of the seconds reached; the performance record\'s own measure); headCm / headDeg = how far the head moved in the segment (the path, cm and deg).');
  runs.forEach((run, i) => {
    L.push((run.label || 'run ' + (i + 1) + ' of ' + runs.length) + ' · ' + (MODE_TEXT[run.mode] || run.mode) + (run.partial ? ' · INCOMPLETE (the session ended first)' : ''));
    if (run.settings) L.push(settingsText(run.settings));
    L.push(COLS.map(([k, w, a]) => (a === 'l' ? k.padEnd(w) : k.padStart(w))).join(' '));
    for (const s of run.scenes) {
      if (!s.reached) { L.push(s.id.padEnd(10) + ' not reached'); continue; }
      L.push([s.id.padEnd(10), pad(fix(s.measuredMs / 1000, 1), 5), pad(s.frames, 6), pad(s.drop === null ? null : fix(s.drop * 100, 2), 6), pad(s.g2, 4), pad(s.g3, 3), pad(s.p95, 6), pad(s.p99, 6), pad(s.max, 6),
        pad(s.span ? r2(s.span.med) : null, 8), pad(s.span ? r2(s.span.p95) : null, 8), pad(s.vol ? r2(s.vol.med) : null, 7), pad(s.vol ? r2(s.vol.p95) : null, 7), pad(s.main ? r2(s.main.med) : null, 8),
        pad(s.cov ? s.cov.med : null, 8), pad(s.cov ? s.cov.p90 : null, 8), pad(s.f ? s.f.avg : null, 6), pad(s.f ? s.f.min : null, 6), pad(s.cap ? s.cap.med : null, 6),
        pad(s.mv ? s.mv.med : null, 6), pad(s.mv ? s.mv.p90 : null, 6), pad(s.mvr ? s.mvr.med : null, 7), pad(s.mvr ? s.mvr.p90 : null, 7), pad(s.head ? s.head.cm : null, 7), pad(s.head ? s.head.deg : null, 7)].join(' ') + (s.partial ? ' (partial)' : ''));
    }
  });
  for (const n of [...new Set(runs.map(r => r.n))]) { // the isolation of each bench: the same segments as is and isolated
    const a = runs.find(r => r.n === n && r.mode === 'asis'), b = runs.find(r => r.n === n && r.mode === 'iso');
    if (!a || !b) continue;
    L.push('isolation of ' + (n !== undefined ? 'bench ' + n : 'the bench') + ' (as is -> isolated), per segment: drop% and p99 ms');
    for (const sa of a.scenes) { const sb = b.scenes.find(x => x.id === sa.id); if (!sb || !sa.reached || !sb.reached) continue; L.push('  ' + sa.id.padEnd(10) + ' drop% ' + pad(sa.drop === null ? null : fix(sa.drop * 100, 2), 6) + ' -> ' + pad(sb.drop === null ? null : fix(sb.drop * 100, 2), 6) + ' · p99 ' + pad(sa.p99, 6) + ' -> ' + pad(sb.p99, 6)); }
  }
  return L;
}

// ---- the frame ring: the last 2000 frames ----
export const RING_SIZE = 2000;
export const RING_SLOW_MS = 30; // an interval longer than this is a slow frame: the frames around it are kept
export const RING_COUNTERS = ['menu', 'tex', 'dsave', 'psave', 'mk', 'maps', 'fv', 'pz', 'pms']; // running totals the host passes each frame (the ring keeps the difference since the previous frame)
// menu = menu / help / mission board canvases redrawn, tex = canvas textures uploaded (the boards and the toast: the places that count it), dsave / psave = the diagnostics' / the performance record's localStorage writes,
// mk = objects the WebGPU renderer made (targets + tile textures + bind groups), maps = timestamp read-backs (mapAsync) started,
// fv = heavy draws the foveation check submitted (vr-wgpu-caps.js rec.foveaDraws), pz = getViewerPose calls of the session's heartbeat (vr-wgpu.js startGxHeartbeat stats), pms = the ms those calls took
export const BENCH_COUNT = { menu: 0, tex: 0 }; // incremented by vr-view.js where a board canvas is redrawn / a canvas texture is flagged for upload
// values of the frame itself (taken as given, NaN = none): hold / f / per / cov = the view's state; ph = the phase of the breakdown recording (0 before it is prepared, 1 from its preparation to the release of its resources,
// 2 after); ml = the longest timestamp mapAsync (call -> resolved) that completed in the interval (ms); gd = (GPU start gap - CPU submit gap) between two successive measured frames (ms); vol = the volume GPU ms of the
// frame that was read back; lag = the ms from the XR frame time (the callback's argument) to the start of the callback
const RING_STATE = ['hold', 'f', 'per', 'cov', 'ph', 'ml', 'gd', 'vol', 'lag'];
// the session's table, kept for ALL frames (not only the ring's): ph (0 pre, 1 rec, 2 post) x since (frames since the interval the foveation check last drew in: 0..15, 16 = later or never) x measured (maps > 0)
// -> frames, intervals over 21 ms, over 30 ms. And per phase the values of dt / cov / vol / ml / gd / lag, kept as a uniform sample of at most RING_SAMPLES (exact below that) for the medians and p95
export const RING_PHASES = ['pre', 'rec', 'post'], RING_SINCE = 17, RING_SAMPLES = 4096, RING_SERIES = ['dt', 'cov', 'vol', 'ml', 'gd', 'lag'];
export function createFrameRing({ size = RING_SIZE, slowMs = RING_SLOW_MS, before = 3, after = 3, maxWindows = 40 } = {}) {
  const cols = {}; for (const k of ['dt', 'cb', 'pre', ...RING_COUNTERS, 'heap', ...RING_STATE]) cols[k] = new Float32Array(size);
  const tt = new Float64Array(size);
  let n = 0, lastTs = null, pendCb = NaN, pendPre = NaN, prevHeap = 0, slow = 0, windowsDropped = 0, pend = null;
  const prev = {}; for (const k of RING_COUNTERS) prev[k] = null;
  const agg = new Uint32Array(RING_PHASES.length * RING_SINCE * 2 * 3); let since = RING_SINCE - 1, seed = 20261124;
  const smp = {}; for (const k of RING_SERIES) smp[k] = RING_PHASES.map(() => ({ buf: new Float32Array(RING_SAMPLES), seen: 0 }));
  const addSample = (k, ph, v) => { // a uniform sample of everything seen (reservoir; the generator is fixed, so a run is reproducible)
    if (!Number.isFinite(v)) return;
    const o = smp[k][ph];
    if (o.seen < RING_SAMPLES) o.buf[o.seen] = v;
    else { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = Math.floor(seed / 4294967296 * (o.seen + 1)); if (j < RING_SAMPLES) o.buf[j] = v; }
    o.seen++;
  };
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
      { // the session's table (all frames)
        since = cols.fv[i] > 0 ? 0 : Math.min(since + 1, RING_SINCE - 1);
        const ph = Number.isFinite(c.ph) ? Math.min(RING_PHASES.length - 1, Math.max(0, c.ph | 0)) : 0, a = ((ph * RING_SINCE + since) * 2 + (cols.maps[i] > 0 ? 1 : 0)) * 3;
        agg[a]++; if (dt > 21) agg[a + 1]++; if (dt > 30) agg[a + 2]++;
        addSample('dt', ph, dt); addSample('cov', ph, cols.cov[i]); addSample('vol', ph, cols.vol[i]); addSample('ml', ph, cols.ml[i]); addSample('gd', ph, cols.gd[i]); addSample('lag', ph, cols.lag[i]);
      }
      if (dt > slowMs) { slow++; if (pend) pend.to = n + after; else pend = { from: n - before, to: n + after }; }
      n++;
      if (pend && n - 1 >= pend.to) finalize();
    },
    // the records of the ring, oldest first (plain objects; reporting)
    records() { const a = []; for (let i = lo(); i < n; i++) a.push(rec(i)); return a; },
    // the windows kept (a window still waiting for its frames after is included as far as it goes)
    allWindows() { const w = windows.slice(); if (pend) { const x = copyWindow(pend.from, pend.to); if (x.length) w.push(x); } return w; },
    // the session's table: cells [{ ph, since, mp, n, o21, o30 }] (only those with frames) and per phase the values' { n (seen), used (in the sample), med, p95 } for each of RING_SERIES
    session() {
      const cells = [];
      for (let ph = 0; ph < RING_PHASES.length; ph++) for (let sn = 0; sn < RING_SINCE; sn++) for (let mp = 0; mp < 2; mp++) { const a = ((ph * RING_SINCE + sn) * 2 + mp) * 3; if (agg[a]) cells.push({ ph, since: sn, mp, n: agg[a], o21: agg[a + 1], o30: agg[a + 2] }); }
      const phases = RING_PHASES.map((name, ph) => { const o = { name }; for (const k of RING_SERIES) { const m = smp[k][ph], v = Array.from(m.buf.subarray(0, Math.min(m.seen, RING_SAMPLES))).sort((x, y) => x - y); o[k] = { n: m.seen, used: v.length, med: v.length ? r2(median(v)) : null, p95: v.length ? r2(quantile(v, 0.95)) : null }; } return o; });
      return { cells, phases };
    },
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

const RING_COLS = [['n', 6], ['t', 8], ['dt', 6], ['cb', 5], ['pre', 5], ['menu', 4], ['tex', 3], ['ds', 3], ['ps', 3], ['mk', 3], ['mp', 3], ['gc', 6], ['hold', 4], ['f', 5], ['cov', 8], ['lt', 5], ['fv', 3], ['pz', 3], ['pm', 5], ['ml', 5], ['gd', 6], ['lag', 5], ['flag', 4]];
// the session table of the ring (all frames of the session, whatever the ring still holds): frames, intervals over 21 / 30 ms by phase x frames since the foveation check's last draw x measured frame; then per phase the medians
export function sessionTableLines(sess) {
  const L = [], f = v => (v === null || v === undefined ? '-' : String(v));
  const tot = sess.cells.reduce((n, c) => n + c.n, 0);
  L.push('-- foveation check x frame intervals, all ' + tot + ' frames of the session (not only the ring): ph = pre (before the breakdown is prepared) / rec (from its preparation to the release of its resources) / post; since = frames after the interval the check last drew in (0 = that interval, 15 = the 15th after, none = later or never); mp = a measured frame (timestamp read-backs started); n = frames, >21 / >30 = intervals over 21 / 30 ms');
  L.push('ph    since   | mp=0:       n   >21   >30 | mp>0:       n   >21   >30');
  for (let ph = 0; ph < sess.phases.length; ph++) for (let sn = 0; sn < RING_SINCE; sn++) {
    const a = sess.cells.find(c => c.ph === ph && c.since === sn && c.mp === 0), b = sess.cells.find(c => c.ph === ph && c.since === sn && c.mp === 1);
    if (!a && !b) continue;
    const cell = c => (c ? String(c.n).padStart(8) + String(c.o21).padStart(6) + String(c.o30).padStart(6) : ''.padStart(20, ' '));
    L.push(sess.phases[ph].name.padEnd(6) + (sn === RING_SINCE - 1 ? 'none' : String(sn)).padEnd(8) + '| ' + '     ' + cell(a) + ' |      ' + cell(b));
  }
  for (const p of sess.phases) {
    const x = p.dt; if (!x.n) continue;
    const m = k => { const q = p[k]; return q.n ? f(q.med) + ' / ' + f(q.p95) + ' (n ' + q.n + (q.used < q.n ? ', sample ' + q.used : '') + ')' : '-'; };
    L.push('ph ' + p.name + ': median / p95 · dt ' + m('dt') + ' · cov ' + m('cov') + ' · vol ' + m('vol') + ' · ml ' + m('ml') + ' · gd ' + m('gd') + ' · lag ' + m('lag'));
  }
  return L;
}
// what the breakdown recording left behind, dumped three times (its preparation starts / its resources are let go / 10 s after that): list = [{ at, t (ms, page clock), every (the volume timestamps one frame in n), slots, slotsBusy,
// bd (the breakdown object exists), track (three.js' trackTimestamp), groups / pipes / ubufs (the renderer's bind groups / pipelines / uniform buffers), heap (JS heap bytes) }]; the text is made when the record is saved
export function leftoverReportLines(list, { sinceMs = 0 } = {}) {
  const L = [];
  L.push('-- what the breakdown recording leaves behind (dumped when its preparation starts, when its resources are let go, and 10 s after that): ' + (list.length ? list.length + ' dump(s)' : 'no recording in this session'));
  if (!list.length) return L;
  const v = x => (x === undefined || x === null ? '-' : String(x));
  for (const o of list) L.push('  ' + o.at.padEnd(12) + ' t ' + ((o.t - sinceMs) / 1000).toFixed(2) + ' s · timestamps every ' + v(o.every) + ' · measuring slots busy ' + v(o.slotsBusy) + ' of ' + v(o.slots) + ' · breakdown object ' + (o.bd ? 'yes' : 'no') + ' · three.js trackTimestamp ' + v(o.track) + ' · bind groups ' + v(o.groups) + ' · pipelines ' + v(o.pipes) + ' · uniform buffers ' + v(o.ubufs) + ' · JS heap ' + (o.heap > 0 ? (o.heap / 1048576).toFixed(1) + ' MB' : '-'));
  return L;
}
// the ring's text: its numbers, then the windows around the slow frames (the frame over the limit is marked *)
export function ringReportLines(ring, { longTasks = null, sinceMs = 0 } = {}) {
  const st = ring.stats(), L = [];
  L.push('-- frame ring: the last ' + st.frames + ' of ' + st.total + ' frames' + (st.med !== undefined ? ' · interval median ' + st.med + ' · p95 ' + st.p95 + ' · p99 ' + st.p99 + ' · max ' + st.max + ' ms' : '') + ' · ' + st.slow + ' intervals over ' + st.slowMs + ' ms in the session' + (longTasks ? ' · long tasks ' + (longTasks.supported ? longTasks.tasks.length + ' seen' : 'not available here') : ''));
  L.push('note: a record is the frame interval that ENDS at that frame (t = s since the session start; dt = the interval in ms); cb / pre = the callback that ran just before it (total CPU ms; start to the volume pass submit); the counts are what happened in that interval: menu = board canvases redrawn, tex = canvas textures flagged for upload (boards and toast only), ds / ps = diagnostics / performance-record localStorage writes, mk = objects the WebGPU renderer made, mp = timestamp read-backs (mapAsync) started, gc = KB the JS heap shrank by (garbage collection; "-" = none or no heap reading), hold = hands holding, f = render scale, cov = covered px, lt = ms of long tasks (>50 ms main-thread tasks) overlapping the interval, fv = heavy draws the foveation check made, pz / pm = poses the heartbeat read (count / ms) (fv / pz / pm are those of the previous frame: the heartbeat tick runs before the app callback in a frame, so what it did in frame N-1 is what slowed the interval ending at N), ml = the longest timestamp mapAsync that completed (ms), gd = GPU start gap minus CPU submit gap between two successive measured frames (ms), lag = the callback start minus the XR frame time (ms; "-" = none). Flags: * = the slow frame, H = the hands holding changed from the row above, F = the render scale changed by more than 0.01, P = the periphery scale changed (the periphery pass switched on / off or its factor changed).');
  L.push(...sessionTableLines(ring.session()));
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
        (r.heap > 0 ? Math.round(r.heap) + 'K' : '-').padStart(6), num(r.hold).padStart(4), num(r.f, 2).padStart(5), num(r.cov).padStart(8), (lt > 0 ? lt.toFixed(0) : '-').padStart(5),
        nz(r.fv).padStart(3), nz(r.pz).padStart(3), (r.pms > 0 ? r.pms.toFixed(1) : '-').padStart(5), num(r.ml, 1).padStart(5), num(r.gd, 1).padStart(6), num(r.lag, 1).padStart(5), marks.padStart(4)].join(' '));
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
// a perf log's add / sample / move calls are also handed to `taps` ({ add(k, ms, n), sample(k, ms), move(cm, deg) }): the bench reads vol / span / pre and the volume's movement from the calls the view already makes (no change to the log's own code)
export function tapPerfLog(log, taps) {
  const add = log.add, sample = log.sample, move = log.move;
  if (taps.add) log.add = (k, ms, n) => { try { taps.add(k, ms, n); } catch { /* a tap never breaks the log */ } return add(k, ms, n); };
  if (taps.sample) log.sample = (k, ms) => { try { taps.sample(k, ms); } catch { /* the same */ } return sample(k, ms); };
  if (taps.move && move) log.move = (cm, deg) => { try { taps.move(cm, deg); } catch { /* the same */ } return move(cm, deg); };
  return () => { log.add = add; log.sample = sample; if (move) log.move = move; };
}

// ---- the comparison bench controller ----
// env (the host's hands; the controller never touches the view itself):
//   now() ms · budgetMs() the refresh period · can() '' or the reason it cannot start now · enter() / leave(ok) save and set up / restore the view (100 %, no section, the user's pose and settings) ·
//   menu('closed' | 'open') · iso(state) applies the switches · ref() the head's { x, y, z, yaw } at this moment (taken once, when the bench starts) · settings() { section, periphery, rate } ·
//   pose({ pos, quat, scale }) puts the body there (world space, the size included) · read() { cover, f, cap, head } of the frame just drawn · progress(text) · done(runs, ok)
// start(plan) = 'cmp' | 'iso'. tick(now) once per frame after the pose is read; frame(ts) at the start of each frame callback; sample(kind, ms); move(cm, deg) = the volume's movement of the frame (perfLog.move).
export function createCompareBench(env, iso = createIsolation(), { segments = BENCH_SEGMENTS, scenes = BENCH_SCENES } = {}) { // iso = the switches the view reads (one object, made before the session: the heartbeat, the timers and the frame marker read it)
  let active = false, plan = [], runIdx = 0, script = null, ref = null, sceneId = null, sceneDef = null, sceneSegs = null, sceneAt = 0, lastProgress = 0, runs = [], settings = null;
  const place = now => { env.pose(benchPose(sceneDef, sceneSegs, now - sceneAt, ref)); };
  const finishRun = (partial, now) => {
    if (partial) script.abort(now);
    runs.push({ mode: plan[runIdx], when: env.now(), partial: !!partial, settings, scenes: script.summary() });
  };
  const startRun = now => {
    const mode = plan[runIdx];
    env.iso?.(iso.apply(mode)); env.menu?.(ISO_MODES[mode].menu === 'open' ? 'open' : 'closed');
    sceneId = null; script = createBenchScript({ segments, budgetMs: env.budgetMs() }); script.start(now); beginSegment(now);
  };
  const beginSegment = now => {
    const sg = script.state.seg;
    if (sg.scene !== sceneId) { sceneId = sg.scene; sceneDef = scenes.find(s => s.id === sceneId); sceneSegs = benchSegmentsOf(sceneId, segments); sceneAt = now; } // a new scene starts its clock; its second period goes on with it
    place(now);
  };
  const end = ok => { active = false; env.iso?.(iso.reset()); env.leave?.(ok); env.done?.(runs, ok); };
  const api = {
    get active() { return active; }, get runs() { return runs; }, iso,
    // '' = started, otherwise the reason it did not
    start(name) {
      if (active) return 'running';
      const why = env.can?.() || ''; if (why) return why;
      plan = BENCH_PLANS[name] || BENCH_PLANS.cmp; runIdx = 0; runs = []; active = true; env.enter?.();
      ref = { ...env.ref() }; settings = env.settings ? { ...env.settings() } : null; // the head's position and heading: once, here
      startRun(env.now()); return '';
    },
    tick(now) {
      if (!active) return;
      const st = script.tick(now);
      if (st.done) { finishRun(false, now); runIdx++; if (runIdx >= plan.length) { end(true); return; } startRun(now); return; }
      if (st.changed) beginSegment(now);
      const sg = st.seg, rd = env.read();
      place(now);
      script.observe(rd.cover, rd.f, rd.cap); script.head(rd.head);
      if (now - lastProgress >= 1000) { lastProgress = now; env.progress?.({ run: runIdx + 1, runs: plan.length, mode: plan[runIdx], scene: st.idx + 1, scenes: script.segments.length, id: sg.id, sec: Math.round(st.segMs / 1000), of: Math.round(sg.ms / 1000) }); }
    },
    frame(ts) { if (active) script.frame(ts); },
    sample(kind, ms) { if (active) script.sample(kind, ms); },
    move(cm, deg) { if (active) script.move(cm, deg); },
    // the session ended (or the user stopped it) in the middle: what was measured is kept as an incomplete run
    abort(now = env.now()) { if (!active) return; finishRun(true, now); end(false); },
  };
  return api;
}
