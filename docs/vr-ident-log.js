// The same-picture check (the page's button 「同じ絵の検査」): its scenes, its run (a state machine the frame loop of vr-view.js ticks), the record of every comparison and the verdict. Pure (no DOM, no GPU): the GPU side is docs/vr-wgpu-ident.js,
// which draws the centre pass once more each frame with one of the ways (same / dist = distSplit / coarse = proxyCoarse / both) and counts the pixels that differ from the picture the display drew; this file decides what the body does meanwhile,
// keeps what came back and says what it shows.
//   The run: prep (the check's programs, distance texture and grid are made; the body is left alone) -> auto (5 segments of 45 s, the body moved by the script of docs/vr-bench.js benchPose, at its largest size; the first 2 s of each segment are not counted;
//   in near/fast and far/slow the first shown tissue is hidden at the middle of the segment and shown again 2 s later) -> hold (1 minute: the body is put within reach and the person holds and moves it) -> done.
//   What it can say: with N comparisons of a way that really used it and no difference, the rate of a difference per comparison is at most about 3 / N at 95 % (the rule of three). It is no proof of sameness; the counts below decide "not judged".
import { benchPose, benchSegmentsOf, createBenchScript, BENCH_SCENES, BENCH_SEGMENT_MS, BENCH_DISCARD_MS } from './vr-bench.js?v=20261125-build763';

export const IDENT_WAYS = ['dist', 'coarse', 'both']; // the three new ways (the control `same` and the positive control `pos` are not ways)
export const IDENT_HELD_MS = 30000;
export const IDENT_HOLD_MS = 60000, IDENT_TOGGLE_MS = 2000, IDENT_PREP_MAX_MS = 30000;
// the scenes of the check: the two of the comparison bench (their numbers are copied, the bench's own lists are not touched) and far (1.0 m +- 0.2 m, the slow figure: far and light)
export const IDENT_SCENES = [
  ...BENCH_SCENES.map(s => ({ ...s })),
  { id: 'far', dist: 1.0, distAmp: 0.2 },
];
export const IDENT_SEGMENTS = [];
for (const [scene, period] of [['hold', 'fast'], ['hold', 'slow'], ['near', 'fast'], ['near', 'slow'], ['far', 'slow']]) IDENT_SEGMENTS.push({ id: scene + '/' + period, scene, period, ms: BENCH_SEGMENT_MS });
// the sixth segment: the hold scene's fast figure again, drawn the way the display draws while a hand holds the body (the page counts one more hand as holding: the hold gate and the hold scale of vr-render-scale.js, f x the setting's factor, run as they do for a real hold)
IDENT_SEGMENTS.push({ id: 'hold/fast-held', scene: 'hold', period: 'fast', ms: IDENT_HELD_MS, simHold: true });
export const IDENT_TOGGLE_SEGMENTS = ['near/fast', 'far/slow']; // the segments in which a tissue is hidden and shown again
// what a verdict needs (the plan's numbers): comparisons that used the way, in all / in each of the five segments / while held / within `switchFrames` frames after a tissue switch; the control's tolerance on the ratio; the record's sizes
export const IDENT_MIN = { total: 500, perSeg: 100, held: 100, afterSwitch: 10, switchFrames: 30, ctlTol: 0.10, rows: 6000, diffKeep: 100, bodyPx: 100, errKeep: 20 }; // bodyPx: a comparison whose display picture has fewer pixels with alpha than this has no body in it and is not counted
export const HELD = 'held', SWITCH = 'switch';

// ---- the run ----
// env (the host's hands): now() · can() '' or the reason it cannot start · enter() / leave(ok) set up and restore the view (the person's pose, size, settings, the menu) · ready() the GPU side has what it needs · ref() { x, y, z, yaw } of the head, taken once ·
// holdStart() the person's own settings back for the hold part · pose({ pos, quat, scale }) puts the body there · segState() { key: mode } of the tissues (a copy) and setSegMode(key, mode) (the menu's own action) and shownKey() the first tissue shown normally or simply (null: none) · cue(secLeft) the hold part's call · progress(info) · done(ok)
export function createIdentRun(env, { segments = IDENT_SEGMENTS, scenes = IDENT_SCENES, holdMs = IDENT_HOLD_MS, prepMaxMs = IDENT_PREP_MAX_MS, toggleMs = IDENT_TOGGLE_MS, toggleSegments = IDENT_TOGGLE_SEGMENTS, budgetMs = 1000 / 72 } = {}) {
  let phase = 'idle', t0 = 0, autoAt = 0, script = null, ref = null, sceneId = null, sceneDef = null, sceneSegs = null, sceneAt = 0, holdAt = 0, lastCue = -1, lastProgress = 0, saved = null, tog = null, toggled = new Set(), swFrames = Infinity, reason = '';
  const state = { phase: 'idle', seg: '', segIdx: -1, measured: false, sinceSwitch: Infinity, segMs: 0, simHold: false, switchSeq: 0 };
  const place = now => env.pose(benchPose(sceneDef, sceneSegs, now - sceneAt, ref));
  const beginSegment = now => {
    const sg = script.state.seg;
    if (sg.scene !== sceneId) { sceneId = sg.scene; sceneDef = scenes.find(s => s.id === sceneId); sceneSegs = benchSegmentsOf(sceneId, segments); sceneAt = now; }
    place(now);
  };
  const restoreTissues = () => { // the tissues the way they were when the run began (a hidden one that was being shown again, or never restored, included)
    if (tog) { const t = tog; tog = null; env.setSegMode(t.key, t.was); }
    if (!saved) return;
    const was = saved; saved = null;
    for (const k of Object.keys(was)) if ((env.segState()[k] | 0) !== (was[k] | 0)) env.setSegMode(k, was[k] | 0);
  };
  const finish = ok => {
    if (phase === 'idle' || phase === 'done') return;
    restoreTissues();
    phase = 'done'; state.phase = 'done'; state.measured = false; state.simHold = false;
    try { env.leave?.(ok); } catch { /* the host's */ }
    try { env.done?.(ok, reason); } catch { /* the host's */ }
  };
  const api = {
    state, get phase() { return phase; }, get active() { return phase !== 'idle' && phase !== 'done'; }, get script() { return script; },
    // '' = started, else the reason it did not
    start() {
      if (api.active) return 'running';
      const why = env.can?.() || ''; if (why) return why;
      phase = 'prep'; t0 = env.now(); script = null; toggled = new Set(); swFrames = Infinity; saved = { ...env.segState() }; reason = '';
      state.phase = 'prep'; state.seg = ''; state.segIdx = -1; state.measured = false; state.sinceSwitch = Infinity; state.simHold = false; state.switchSeq = 0;
      env.enter?.();
      return '';
    },
    // once per frame, before the frame is drawn (the host's loop)
    tick(now) {
      if (!api.active) return state;
      if (phase === 'prep') {
        if (env.ready?.() || now - t0 >= prepMaxMs) {
          if (!env.ready?.()) reason = 'the check\'s resources were not all ready after ' + Math.round(prepMaxMs / 1000) + ' s';
          ref = { ...env.ref() }; script = createBenchScript({ segments, budgetMs }); script.start(now); autoAt = now; phase = 'auto'; state.phase = 'auto'; beginSegment(now);
        } else if (now - lastProgress >= 1000) { lastProgress = now; env.progress?.({ phase: 'prep', sec: Math.round((now - t0) / 1000) }); }
      }
      if (phase === 'auto') {
        const st = script.tick(now);
        if (st.done) {
          restoreTissues();
          try { env.holdStart?.(); } catch { /* the host's */ } // the person's own settings are back for the part they hold the body in
          const hs = scenes.find(s => s.id === 'hold');
          env.pose(benchPose(hs, benchSegmentsOf('hold', segments), 0, ref)); // within reach, at the largest size: the person takes it from here
          phase = 'hold'; state.phase = 'hold'; state.seg = 'hold'; state.measured = true; state.simHold = false; holdAt = now; lastCue = -1;
        } else {
          if (st.changed) beginSegment(now);
          place(now);
          state.seg = st.seg.id; state.segIdx = st.idx; state.measured = st.phase === 'measure'; state.segMs = st.segMs; state.simHold = !!st.seg.simHold;
          // the tissue switch: at the middle of the segment, once
          if (toggleSegments.includes(st.seg.id) && !toggled.has(st.seg.id) && st.segMs >= st.seg.ms / 2 && !tog) {
            const key = env.shownKey();
            toggled.add(st.seg.id);
            if (key !== null && key !== undefined) { const was = env.segState()[key] | 0; env.setSegMode(key, 2); tog = { key, was, at: now }; swFrames = 0; state.switchSeq++; }
          }
          if (tog && now - tog.at >= toggleMs) { env.setSegMode(tog.key, tog.was); tog = null; swFrames = 0; state.switchSeq++; }
          if (now - lastProgress >= 1000) { lastProgress = now; env.progress?.({ phase: 'auto', seg: st.idx + 1, segs: script.segments.length, id: st.seg.id, sec: Math.round(st.segMs / 1000), of: Math.round(st.seg.ms / 1000) }); }
        }
      } else if (phase === 'hold') {
        const left = Math.max(0, Math.ceil((holdMs - (now - holdAt)) / 1000));
        if (left !== lastCue) { lastCue = left; env.cue?.(left); }
        if (now - holdAt >= holdMs) { finish(true); return state; }
      }
      state.sinceSwitch = swFrames;
      return state;
    },
    // the time left of the whole run (the page's button), ms
    leftMs(now) {
      const total = segments.reduce((a, s) => a + s.ms, 0);
      if (phase === 'prep') return total + holdMs;
      if (phase === 'auto') return Math.max(0, total - (now - autoAt)) + holdMs;
      if (phase === 'hold') return Math.max(0, holdMs - (now - holdAt));
      return 0;
    },
    // after the frame is drawn: counts the frames since the last switch of a tissue
    frame() { if (swFrames !== Infinity) swFrames++; state.sinceSwitch = swFrames; },
    // a run cut short (the session ended, the page asked): the view is put back
    abort() { if (api.active) { reason = reason || 'ended early'; finish(false); } },
    get reason() { return reason; },
  };
  return api;
}

// ---- the record ----
const med = a => { if (!a.length) return null; const s = Float64Array.from(a).sort(); const n = s.length; return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const qt = (a, q) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const r3 = v => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
// the segment of a record: held (a hand holds the body, whichever part of the run it is) or the segment's id; the idle time of the hold part belongs to no segment
export const regionOf = cx => (cx && cx.hands > 0 ? HELD : cx && cx.phase === 'auto' ? cx.seg : null);
// one comparison as the host knows it: r = the GPU side's result (mode, used, why, error, diff, compared, ms { pre, vol, build }, disp { vol, pre }, frame (the volume's own frame number), sinceRebuild, unavailable) with r.ctx = the page's context of that frame:
// { phase, seg, measured, sinceSwitch, switchSeq, simHold, cov, per, f, hk (holdKA: the factor of the hold scale really applied, 1 = not shrunk), hands, cmps, degps, headM, size, t }
// What is NOT counted (listed, never a pass or a fail): a comparison with a GPU error or whose counters were not its own (error), one whose display picture has no body in it (fewer than bodyPx pixels with alpha: the body is out of sight), one the positive control could not be made for.
// "After a tissue switch" (the page's switchSeq goes up at each hide and each show) is counted per way from the first comparison that really used the way again: used comparisons within switchFrames of the volume's frames after that count; the frames in between,
// drawn the old way, are kept by reason (afterNot).
export function createIdentLog({ min = IDENT_MIN, segments = IDENT_SEGMENTS } = {}) {
  const modes = ['same', ...IDENT_WAYS, 'pos'];
  const T = {}, W = {}; for (const m of modes) { T[m] = { n: 0, used: 0, diff: 0, notUsed: {}, seg: {}, held: 0, sw: 0, pixels: 0, maxColor: 0, maxDepth: 0, noCtl: 0, err: 0, noBody: 0, afterNot: {}, shrunk: 0, shrunkHeld: 0, shrunkSeg: {}, hk: 0, hkHeld: 0, hkSeg: {} }; W[m] = { seq: 0, resume: null, waiting: false }; }
  const ratios = new Map(); // `${region}|${mode}` -> { v: [check vol / display vol], vp: [(vol + pre) / (vol + pre)] }
  const byF = new Map(); // render scale f (2 decimals) -> { mode: comparisons that used the way }
  const rows = [], diffs = [], errors = [];
  let dropped = 0, count = 0, unmeasuredErr = 0; const unmeasuredErrBy = {}; // unmeasuredErr: comparisons with a GPU error or a read-back that was not theirs whose time is not measured (the first 2 s of a segment, the preparation, the idle part of the hold part): not counted anywhere else, only said
  const pushRow = r => { if (rows.length < min.rows) rows.push(r); else dropped++; };
  const api = {
    get count() { return count; }, get unmeasuredErr() { return unmeasuredErr; }, unmeasuredErrBy, rows, diffs, errors, T, byF,
    add(r) {
      const cx = r.ctx || {};
      if (!cx.measured) { if (r.error) { unmeasuredErr++; unmeasuredErrBy[r.mode] = (unmeasuredErrBy[r.mode] | 0) + 1; } return false; } // the first 2 s of a segment, the preparation and the idle part of the hold part are not counted (an error in them is counted as such, and nothing else of the comparison)
      const t = T[r.mode]; if (!t) return false;
      count++; t.n++;
      if (r.error) { t.err++; if (errors.length < min.errKeep) errors.push({ mode: r.mode, t: cx.t, seg: cx.seg, text: String(r.error) }); pushRow({ ...rowOf(r), used: 0, why: 'error' }); return true; }
      if (r.mode === 'pos' && r.unavailable) { t.noCtl++; return true; }
      if ((r.diff?.body ?? 0) < min.bodyPx) { t.noBody++; pushRow({ ...rowOf(r), used: 0, why: 'nobody' }); return true; }
      const region = regionOf(cx), d = r.diff, w = W[r.mode];
      if (cx.switchSeq > w.seq) { w.seq = cx.switchSeq; w.resume = null; w.waiting = true; }
      if (w.waiting) { if (r.used) { w.resume = r.frame; w.waiting = false; } else t.afterNot[r.why || '?'] = (t.afterNot[r.why || '?'] | 0) + 1; }
      const age = w.resume !== null && r.used ? r.frame - w.resume : null;
      if (r.used) {
        t.used++;
        if (d && d.pixels > 0) { t.diff++; t.pixels += d.pixels; t.maxColor = Math.max(t.maxColor, d.maxColor); t.maxDepth = Math.max(t.maxDepth, d.maxDepth); }
        if (region === HELD) t.held++; else if (region) t.seg[region] = (t.seg[region] | 0) + 1;
        if (age !== null && age >= 0 && age <= min.switchFrames) t.sw++;
        const fk = Math.round((cx.f || 0) * 100) / 100, o = byF.get(fk) || {}; byF.set(fk, o); o[r.mode] = (o[r.mode] | 0) + 1;
        if (Number.isFinite(cx.f) && cx.f < 1 - 1e-6) { t.shrunk++; if (region === HELD) t.shrunkHeld++; else if (region) t.shrunkSeg[region] = (t.shrunkSeg[region] | 0) + 1; } // the render scale was below 1 for this comparison (the hold scale, the ladder): said in the report, no part of the verdict
        if (Number.isFinite(cx.hk) && cx.hk < 1 - 1e-6) { t.hk++; if (region === HELD) t.hkHeld++; else if (region) t.hkSeg[region] = (t.hkSeg[region] | 0) + 1; } // the hold scale (the page's holdKA, the factor really applied) was below 1: the held part's own simplification was on; said in the report, no part of the verdict
        const dv = r.disp?.vol, dp = r.disp?.pre, cv = r.ms?.vol, cp = r.ms?.pre;
        if (region && dv > 0 && cv > 0) {
          const k = region + '|' + r.mode, o2 = ratios.get(k) || { v: [], vp: [] }; ratios.set(k, o2);
          o2.v.push(cv / dv);
          if (Number.isFinite(dp) && dp >= 0 && Number.isFinite(cp) && cp >= 0 && dv + dp > 0) o2.vp.push((cv + cp) / (dv + dp));
        }
      } else t.notUsed[r.why || '?'] = (t.notUsed[r.why || '?'] | 0) + 1;
      pushRow({ ...rowOf(r), age });
      if (d && d.pixels > 0 && r.mode !== 'pos' && diffs.length < min.diffKeep) diffs.push({ mode: r.mode, used: r.used, t: cx.t, seg: cx.seg, d });
      return true;
    },
    // the numbers of a region (a segment id or HELD) for a way: { n, med, q1, q3 } of the ratio of the check's ms to the display's, `vol` = the centre pass alone, `volpre` = the centre pass and the pre-pass
    ratio(region, mode, kind = 'v') { const o = ratios.get(region + '|' + mode); const a = o ? o[kind] : null; return a && a.length ? { n: a.length, med: r3(med(a)), q1: r3(qt(a, 0.25)), q3: r3(qt(a, 0.75)) } : null; },
    regions() { return [...segments.map(s => s.id), HELD]; },
    dropped: () => dropped,
    verdict(variant = {}) { return identVerdict(api, { min, segments, ...variant }); },
  };
  return api;
}
const rowOf = r => { const cx = r.ctx || {}, d = r.diff, m = r.ms || {}, x = r.disp || {}; return { t: r2((cx.t || 0) / 1000), seg: cx.seg || '', ph: cx.phase || '', mode: r.mode, used: r.used ? 1 : 0, why: r.why || '', pix: d ? d.pixels : null, body: d ? d.body : null, cmp: r.compared | 0, vol: r2(m.vol), pre: r2(m.pre), bld: r2(m.build), dvol: r2(x.vol), dpre: r2(x.pre), cov: cx.cov, per: r2(cx.per), f: r2(cx.f), sim: cx.simHold ? 1 : 0, hands: cx.hands | 0, cms: r2(cx.cmps), dps: r2(cx.degps), head: r2(cx.headM), size: r2(cx.size), age: null, rb: r.sinceRebuild }; };

// the verdict of each way and the validity of the run. state: 'diff' (a comparison that used the way differed), 'none' (no difference in enough comparisons), 'notjudged' (too few); the run is 'valid' only when the control `same` never differed and the positive control always did
export function identVerdict(log, { min = IDENT_MIN, segments = IDENT_SEGMENTS, cls4 = false } = {}) {
  const T = log.T, out = { valid: true, why: [], cls4: !!cls4, ways: {}, control: { same: { n: T.same.used, diff: T.same.diff, err: T.same.err, noBody: T.same.noBody }, pos: { n: T.pos.used, noDiff: T.pos.used - T.pos.diff, unavailable: T.pos.noCtl, err: T.pos.err, noBody: T.pos.noBody } } };
  if (T.same.diff > 0) { out.valid = false; out.why.push('control same: ' + T.same.diff + ' of ' + T.same.used + ' comparisons differed'); }
  if (T.pos.used === 0) { out.valid = false; out.why.push('positive control: none counted' + (T.pos.noCtl ? ' (' + T.pos.noCtl + ' could not be made: its program did not compile)' : '') + (T.pos.noBody ? ' (' + T.pos.noBody + ' had no body in the picture)' : '') + (T.pos.err ? ' (' + T.pos.err + ' with a GPU error)' : '')); }
  else if (T.pos.diff < T.pos.used) { out.valid = false; out.why.push('positive control: ' + (T.pos.used - T.pos.diff) + ' of ' + T.pos.used + ' showed no difference'); }
  for (const w of IDENT_WAYS) {
    const t = T[w], segN = segments.map(s => t.seg[s.id] | 0), enough = t.used >= min.total && segN.every(n => n >= min.perSeg) && t.held >= min.held && t.sw >= min.afterSwitch;
    let state = t.diff > 0 ? 'diff' : enough && t.err === 0 ? 'none' : 'notjudged'; // a comparison with a GPU error is not counted, and a way with even one is not judged
    if (cls4) state = 'c4';
    if (!out.valid && state !== 'diff' && state !== 'c4') state = 'invalid';
    out.ways[w] = { state, used: t.used, diff: t.diff, n: t.n, seg: segN, held: t.held, sw: t.sw, notUsed: { ...t.notUsed }, afterNot: { ...t.afterNot }, err: t.err, noBody: t.noBody, pixels: t.pixels, maxColor: t.maxColor, maxDepth: t.maxDepth, rate95: t.diff === 0 && t.used > 0 ? r3(3 / t.used) : null };
  }
  return out;
}

// ---- the text of the record ----
const WAY_JA = { dist: 'distSplit', coarse: 'proxyCoarse', both: '両方' };
// the short result of the page (one line of the menu): the number of comparisons that differed over the number that used the way, for each way
export function identResultLine(v, ok, ja = true) {
  const parts = IDENT_WAYS.map(w => (ja ? WAY_JA[w] : w) + ' ' + v.ways[w].diff + '/' + v.ways[w].used);
  return (ok ? (ja ? '完了 差の出た比較 ' : 'Done, comparisons with a difference ') : (ja ? '途中終了 差の出た比較 ' : 'Ended early, comparisons with a difference ')) + parts.join(ja ? '・' : ' · ') + (v.valid ? '' : (ja ? '（検査は無効）' : ' (check invalid)'));
}
// the display's own use of a new way (its switches are code constants, off): frames drawn the new way, frames drawn the old way and why, and what stopped it
export function newPathLines(np) {
  if (!np) return [];
  const L = ['display ways: drew ' + np.used + ' passes with a way' + (Object.keys(np.byWay || {}).length ? ' (' + Object.entries(np.byWay).map(([k, n]) => k + ' ' + n).join(', ') + ')' : '') + ', no way for ' + np.notUsed + ' passes' + (Object.keys(np.reasons || {}).length ? ' (' + Object.entries(np.reasons).map(([k, n]) => k + ' ' + n).join(', ') + ')' : '') + (np.errors ? ' · GPU errors of its own submits ' + np.errors : '')];
  for (const n of np.notes || []) L.push('  ' + n);
  return L;
}
const cell = (v, w = 7) => String(v === null || v === undefined ? '-' : v).padStart(w);
export function identReportLines(log, { variant = {}, newPath = null, runInfo = null, ctlTolerance = IDENT_MIN.ctlTol, segments = IDENT_SEGMENTS } = {}) {
  const L = [], v = log.verdict(variant);
  L.push('-- same-picture check (the button 「同じ絵の検査」): ' + log.count + ' comparisons counted' + (runInfo ? ' · ' + runInfo : ''));
  L.push('note: each frame the centre pass is drawn once more with one of the ways (same = the display\'s own way, the control; dist = distSplit; coarse = proxyCoarse; both = the two in one program) into a target of its own and compared pixel by pixel (colour and packed depth) with the picture the display drew that frame; the display itself draws the old way during the check. A comparison counts for a way only when the way was really used (a frame that could not use it is drawn the old way and listed under not used with the reason). The first 2 s of each segment are left out. Every 20th comparison is the positive control (no surface search: it must differ).');
  L.push('note: 0 differences in N comparisons says only that the rate of a difference per comparison is at most about 3 / N at 95 % (rule of three); it is no proof of sameness. The times are the check\'s extra draw (more GPU work than the display alone): use the ratios against the control `same` of the same segment, not the milliseconds.');
  L.push('validity: ' + (v.valid ? 'valid (control same: 0 of ' + v.control.same.n + ' differed; positive control: ' + v.control.pos.n + ' of ' + v.control.pos.n + ' differed)' : 'INVALID: ' + v.why.join('; ')));
  if (v.cls4) L.push('c4: no check (the fourth segment\'s own texture: the new ways draw the old way, NEW_PATH_ALLOW_C4 is false)');
  for (const w of IDENT_WAYS) {
    const x = v.ways[w];
    const label = { diff: 'DIFFERENCE', none: 'no difference', notjudged: 'not judged', invalid: 'invalid run', c4: 'c4: no check (the old way is drawn)' }[x.state];
    L.push(w.padEnd(7) + label + ' · differing ' + x.diff + ' of ' + x.used + ' used (of ' + x.n + ' drawn)' + (x.rate95 !== null ? ' · rate <= ' + x.rate95 + ' (95 %)' : '') + ' · per segment ' + segments.map((s, i) => s.id + ' ' + x.seg[i]).join(' ') + ' · held ' + x.held + ' · within ' + IDENT_MIN.switchFrames + ' frames after the way was usable again following a tissue switch ' + x.sw
      + (x.diff ? ' · pixels ' + x.pixels + ' · max colour ' + x.maxColor + ' · max depth byte ' + x.maxDepth : '') + (Object.keys(x.notUsed).length ? ' · not used: ' + Object.entries(x.notUsed).map(([k, n]) => k + ' ' + n).join(', ') : '') + (x.err ? ' · GPU ERRORS in ' + x.err + ' comparisons (not counted: this way is not judged)' : '') + (x.noBody ? ' · no body in the picture: ' + x.noBody + ' (not counted)' : '')
      + (Object.keys(x.afterNot).length ? ' · drawn the old way between a tissue switch and the way being usable again: ' + Object.entries(x.afterNot).map(([k, n]) => k + ' ' + n).join(', ') : ''));
  }
  for (const m of ['same', 'pos']) { const t = log.T[m]; if (t.err || t.noBody) L.push('control ' + m + ': ' + (t.err ? t.err + ' with a GPU error (not counted)' : '') + (t.err && t.noBody ? ' · ' : '') + (t.noBody ? t.noBody + ' with no body in the picture (not counted)' : '')); }
  L.push('errors in comparisons whose time is not measured (the first 2 s of a segment, the preparation, the idle part of the hold part; not in any count above): ' + log.unmeasuredErr + (log.unmeasuredErr ? ' (' + Object.entries(log.unmeasuredErrBy).map(([k, n]) => k + ' ' + n).join(', ') + ')' : ''));
  if (log.errors.length) { L.push('-- comparisons with a GPU error or a read-back that was not theirs (' + log.errors.length + ' kept): way, t s, segment, text'); for (const e of log.errors) L.push('  ' + e.mode + ' ' + r2((e.t || 0) / 1000) + ' ' + e.seg + ' · ' + e.text); }
  L.push('needs for a verdict: at least ' + IDENT_MIN.total + ' used per way, ' + IDENT_MIN.perSeg + ' in each segment, ' + IDENT_MIN.held + ' while held, ' + IDENT_MIN.afterSwitch + ' within ' + IDENT_MIN.switchFrames + ' frames after the way was usable again following a tissue switch (proposed numbers)');
  // the ratios
  // how many comparisons used each way at each render scale f (the hold scale and the settings move f; the sixth segment draws the way the display does while a hand holds the body)
  const fs = [...log.byF.keys()].sort((a, b) => a - b);
  L.push('comparisons that used a way, by render scale f (2 decimals): ' + (fs.length ? fs.map(f => f + ': ' + ['same', ...IDENT_WAYS].map(m => (log.byF.get(f)[m] | 0)).join('/')).join(' · ') + '  (same/dist/coarse/both)' : 'none'));
  // whether the hold simplification (the hold scale, holdKA < 1) really was on in the comparisons that used a way: the held part and the sixth segment (the hold scale asked for) are where it should be; none there says it was off (moveLow). The render scale f < 1 is said beside it (it also moves with the ladder and the cap, so it alone does not say the hold scale was on)
  const sixth = segments.filter(s => s.simHold).map(s => s.id), cnt = (t, held, seg) => '(held ' + held + '/' + t.held + sixth.map(id => ', ' + id + ' ' + (seg[id] | 0) + '/' + (t.seg[id] | 0)).join('') + ')';
  L.push('comparisons that used a way with the hold scale applied (holdKA < 1) / all that used it; beside it the render scale f < 1: ' + ['same', ...IDENT_WAYS].map(m => { const t = log.T[m]; return m + ' holdKA<1 ' + t.hk + '/' + t.used + ' ' + cnt(t, t.hkHeld, t.hkSeg) + ' f<1 ' + t.shrunk + '/' + t.used + ' ' + cnt(t, t.shrunkHeld, t.shrunkSeg); }).join(' · '));
  L.push('ratios (check ms / display ms of the same frame; median [q1-q3] n; "/ctl" = the way\'s median divided by the median of `same` in the same segment) for the centre pass alone (vol) and with the pre-pass (vol+pre)');
  const bad = [];
  for (const kind of ['v', 'vp']) {
    L.push('  ' + (kind === 'v' ? 'vol' : 'vol+pre'));
    L.push('  ' + 'segment'.padEnd(10) + ['same', 'dist', 'coarse', 'both'].map(m => m.padStart(22)).join('') + '   dist/ctl coarse/ctl both/ctl');
    for (const region of log.regions()) {
      const r = ['same', ...IDENT_WAYS].map(m => log.ratio(region, m, kind));
      const ctl = r[0]?.med;
      L.push('  ' + region.padEnd(10) + r.map(x => (x ? (x.med + ' [' + x.q1 + '-' + x.q3 + '] ' + x.n).padStart(22) : '-'.padStart(22))).join('') + '  ' + r.slice(1).map(x => cell(x && ctl ? r3(x.med / ctl) : null, 9)).join(''));
      if (kind === 'v' && ctl && Math.abs(ctl - 1) > ctlTolerance) bad.push(region + ' ' + ctl);
    }
  }
  L.push('segments where the control `same` median is further than ' + Math.round(ctlTolerance * 100) + ' % from 1 (the display\'s own way twice: the timing of this segment is not trusted): ' + (bad.length ? bad.join(', ') : 'none'));
  if (newPath) L.push(...newPathLines(newPath));
  // the differences found (the first ones)
  if (log.diffs.length) {
    L.push('-- comparisons with a difference, the positive control left out (' + log.diffs.length + ' kept of ' + Object.entries(log.T).reduce((a, [m, t]) => a + (m === 'pos' ? 0 : t.diff), 0) + '): way, used, t s, segment, pixels / compared range, max colour, max depth byte, colour-only pixels, rectangle x0 y0 x1 y1, eyes L R, 4 x 4 blocks, first pixels (x y colourA colourB depthA depthB, hex)');
    for (const e of log.diffs) {
      const d = e.d, hx = n => (n >>> 0).toString(16).padStart(8, '0');
      L.push('  ' + e.mode + ' ' + (e.used ? 'used' : 'ctl') + ' ' + r2((e.t || 0) / 1000) + ' ' + e.seg + ' · ' + d.pixels + ' · ' + d.maxColor + ' · ' + d.maxDepth + ' · ' + d.colorPixels + ' · ' + (d.rect ? [d.rect.x0, d.rect.y0, d.rect.x1, d.rect.y1].join(' ') : '-') + ' · ' + d.eyes.join(' ') + ' · [' + d.cells.join(' ') + '] · ' + d.list.map(p => p.x + ' ' + p.y + ' ' + hx(p.colA) + ' ' + hx(p.colB) + ' ' + hx(p.depA) + ' ' + hx(p.depB)).join(' | '));
    }
  }
  // one line per comparison
  const cols = ['t', 'seg', 'ph', 'mode', 'used', 'why', 'pix', 'body', 'cmp', 'vol', 'pre', 'bld', 'dvol', 'dpre', 'cov', 'per', 'f', 'sim', 'hands', 'cms', 'dps', 'head', 'size', 'age', 'rb'];
  L.push('-- every comparison (' + log.rows.length + ' kept' + (log.dropped() ? ', ' + log.dropped() + ' more not kept' : '') + '): ' + cols.join(' ') + ' (vol / pre / bld = the check\'s centre pass, pre-pass and grid build ms; dvol / dpre = the display\'s of the same frame; hands = hands holding; cms / dps = the body\'s cm/s and deg/s; head = distance from the head m; size = the body\'s size over 0.30 m; body = pixels with alpha in the display\'s picture; sim = the hold scale was asked for by the check (the sixth segment); age = the volume\'s frames since the way was usable again after a tissue switch; rb = frames since the grid was rebuilt)');
  for (const r of log.rows) L.push(cols.map(c => (r[c] === null || r[c] === undefined || r[c] === '' ? '-' : r[c])).join(' '));
  return L;
}
