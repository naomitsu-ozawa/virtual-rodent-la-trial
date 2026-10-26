// VR self-check, pure part: frame-interval ring buffer, statistics, pass / fail judgement and the Japanese / English result text.
// No DOM, no three.js, no XR: tests/unit/vr-self-check.test.js runs it on synthetic frame series (with hitches).
// The runner that drives scenarios inside the headset is vr-self-check.js.

// ---- pass rule (constants: change here only) ----
export const DEFAULT_HZ = 72;           // Quest 3 default when the session does not say
export const OVER_FRAME_FACTOR = 1.5;   // a frame is "over budget" when its interval > 1.5 x the target interval
export const P5_FPS_RATIO = 0.9;        // p5 fps must be >= 0.9 x target fps
export const OVER_FRAME_MAX_RATIO = 0.02; // at most 2 % of the frames may be over budget
export const MIN_FRAMES = 30;           // fewer measured frames than this = no verdict (FAIL: the headset did not deliver frames)
export const RING_CAPACITY = 4096;      // preallocated: 5 s at 120 Hz is 600; the newest are kept when a scenario runs longer
export const PASS_MARK = '✔', FAIL_MARK = '✖', SKIP_MARK = '－';

// Fixed-size ring of frame intervals (ms). push() never allocates (called every frame); copy() is for the end of a scenario.
export function createFrameRing(capacity = RING_CAPACITY) {
  const buf = new Float32Array(capacity);
  let n = 0, head = 0;
  return {
    push(ms) { buf[head] = ms; head = (head + 1) % capacity; if (n < capacity) n++; },
    reset() { n = 0; head = 0; },
    get count() { return n; },
    copy() { const out = new Float32Array(n), start = n < capacity ? 0 : head; for (let i = 0; i < n; i++) out[i] = buf[(start + i) % capacity]; return out; },
  };
}

// value at fraction q (0..1) of an ascending array, nearest-rank (q = 0.95 of 100 values = the 95th)
function rank(sorted, q) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]; }

// Statistics of frame intervals (ms) against a target refresh rate (Hz). Fps values come from intervals, so the percentile is of the SLOW end:
// p5Fps = 1000 / (95th percentile interval), low1Fps = 1000 / (99th percentile interval).
export function computeStats(intervalsMs, targetHz = DEFAULT_HZ) {
  const hz = targetHz > 0 ? targetHz : DEFAULT_HZ, budgetMs = 1000 / hz, overMs = budgetMs * OVER_FRAME_FACTOR;
  const n = intervalsMs.length;
  if (!n) return { frames: 0, targetHz: hz, budgetMs, meanFps: 0, p5Fps: 0, low1Fps: 0, worstMs: 0, p50Ms: 0, p95Ms: 0, overCount: 0, overRatio: 0, seconds: 0 };
  const s = Float64Array.from(intervalsMs).sort();
  let sum = 0, over = 0;
  for (let i = 0; i < n; i++) { sum += s[i]; if (s[i] > overMs) over++; }
  return {
    frames: n, targetHz: hz, budgetMs,
    meanFps: 1000 * n / sum, p5Fps: 1000 / rank(s, 0.95), low1Fps: 1000 / rank(s, 0.99),
    worstMs: s[n - 1], p50Ms: rank(s, 0.5), p95Ms: rank(s, 0.95), overCount: over, overRatio: over / n, seconds: sum / 1000, // raw interval percentiles (ms)
  };
}

// Verdict of one scenario: { pass, reasons[] } (reasons are short codes: 'frames' | 'p5' | 'over')
export function judge(stats, th = {}) {
  const p5Ratio = th.p5Ratio ?? P5_FPS_RATIO, overMax = th.overMax ?? OVER_FRAME_MAX_RATIO, minFrames = th.minFrames ?? MIN_FRAMES;
  const reasons = [];
  if (!stats || stats.frames < minFrames) reasons.push('frames');
  else {
    if (stats.p5Fps < p5Ratio * stats.targetHz) reasons.push('p5');
    if (stats.overRatio > overMax) reasons.push('over');
  }
  return { pass: reasons.length === 0, reasons };
}

// ---- text ----
const f1 = v => (Number.isFinite(v) ? v : 0).toFixed(1);
const fMs = v => String(Math.round(Number.isFinite(v) ? v : 0));

// one VR panel line: 「✔ 基準 72.0fps（最低 70.1, 最大 18ms）」 = mean fps (最低 = p5 fps, 最大 = worst frame). A failed line adds why.
export function formatLine(r, ja = true) {
  if (r.skipped) return SKIP_MARK + ' ' + r.label + (ja ? '（実施せず：' : ' (skipped: ') + r.skipped + (ja ? '）' : ')');
  if (r.error) return FAIL_MARK + ' ' + r.label + (ja ? '（エラー：' : ' (error: ') + r.error + (ja ? '）' : ')');
  const s = r.stats, mark = r.verdict.pass ? PASS_MARK : FAIL_MARK;
  let t = mark + ' ' + r.label + ' ' + f1(s.meanFps) + 'fps' + (ja ? '（最低 ' : ' (low ') + f1(s.p5Fps) + (ja ? ', 最大 ' : ', worst ') + fMs(s.worstMs) + 'ms' + (ja ? '）' : ')');
  if (!r.verdict.pass) {
    if (r.verdict.reasons.includes('frames')) t += ja ? ' コマ不足 ' + s.frames : ' too few frames ' + s.frames;
    else if (r.verdict.reasons.includes('over')) t += (ja ? ' 遅れ ' : ' late ') + f1(s.overRatio * 100) + '%';
  }
  // the zoom scenarios also measure the first second right after the size change (not judged): 「· 直後 61.2fps 遅れ 8.0%」
  const tr = r.phases?.transition?.stats;
  if (tr && tr.frames) t += (ja ? ' · 直後 ' : ' · right after ') + f1(tr.meanFps) + 'fps' + (tr.overCount ? (ja ? ' 遅れ ' : ' late ') + f1(tr.overRatio * 100) + '%' : '');
  return t;
}

// overall: scenarios that ran count; skipped ones do not. { pass, ran, failed, skipped }
export function overall(results) {
  let ran = 0, failed = 0, skipped = 0;
  for (const r of results) { if (r.skipped) { skipped++; continue; } ran++; if (r.error || !r.verdict?.pass) failed++; }
  return { pass: ran > 0 && failed === 0, ran, failed, skipped };
}

export function verdictLine(results, ja = true) {
  const o = overall(results);
  if (!o.ran) return SKIP_MARK + (ja ? ' 実施した項目がありません' : ' nothing was run');
  return o.pass ? PASS_MARK + (ja ? ' 総合：合格（' + o.ran + ' 項目）' : ' Overall: PASS (' + o.ran + ' scenarios)')
    : FAIL_MARK + (ja ? ' 総合：不合格（' + o.failed + ' / ' + o.ran + ' 項目）' : ' Overall: FAIL (' + o.failed + ' of ' + o.ran + ')');
}

export function criteriaText(hz, ja = true) {
  return ja ? '合格の基準：最低（下位5%）が目標 ' + hz + 'Hz の ' + Math.round(P5_FPS_RATIO * 100) + '% 以上、かつ ' + OVER_FRAME_FACTOR + '倍より遅いコマが ' + Math.round(OVER_FRAME_MAX_RATIO * 100) + '% 以下'
    : 'Pass: p5 fps >= ' + Math.round(P5_FPS_RATIO * 100) + '% of ' + hz + ' Hz and frames slower than ' + OVER_FRAME_FACTOR + 'x the budget <= ' + Math.round(OVER_FRAME_MAX_RATIO * 100) + '%';
}

// zoom summary. Scenarios that ran at a magnification carry r.zoom = { order, name, nameEn, rot } (order = the magnification, 1000 = close-up; name = 「2倍」 ...).
// One line per kind (still / rotating): the first level that fails ("2倍から NG"), or the last level that was measured when all pass. [] when none measured.
export function zoomSummaries(results, ja = true) {
  const zn = z => (ja ? z.name : z.nameEn || z.name);
  const out = [];
  for (const rot of [false, true]) {
    const rs = results.filter(r => r.zoom && !!r.zoom.rot === rot && !r.skipped).sort((a, b) => a.zoom.order - b.zoom.order);
    if (!rs.length) continue;
    const bad = rs.find(r => r.error || !r.verdict?.pass), head = ja ? (rot ? '拡大（回転中）：' : '拡大（静止）：') : (rot ? 'Zoom (rotating): ' : 'Zoom (still): ');
    out.push({ pass: !bad, text: (bad ? FAIL_MARK : PASS_MARK) + ' ' + head + (bad ? zn(bad.zoom) + (ja ? 'から NG' : ' and above: NG') : zn(rs.at(-1).zoom) + (ja ? 'まで OK' : ' all OK')) });
  }
  return out;
}

// the measurement details of one scenario for the pasted text (not the VR panel, which is narrow): raw frame intervals (p50 / p95 / worst ms,
// frames over 1.5 x budget), the data grid, the content box (% of the data box per axis) and the ray probe taken right after the measurement
// (samples per ray: mean / p95 over the covered pixels of a 48 x 48 diag-5 render; share of rays ended by a hit; share of the path skipped by jumps).
// '' when there is nothing to add
export function detailLine(r, ja = true) {
  if (!r || r.skipped || r.error || !r.stats) return '';
  const s = r.stats, i = r.info || {}, p = i.probe, parts = [];
  parts.push((ja ? '間隔 p50 ' : 'interval p50 ') + f1(s.p50Ms) + ' / p95 ' + f1(s.p95Ms) + (ja ? ' / 最大 ' : ' / worst ') + f1(s.worstMs) + ' ms · ' + (ja ? '1.5倍超 ' + s.overCount + ' コマ' : 'over 1.5x ' + s.overCount));
  if (i.grid) parts.push((ja ? '格子 ' : 'grid ') + i.grid);
  if (i.boxPct) parts.push((ja ? '内容ボックス ' : 'content box ') + i.boxPct.join('×') + '%');
  if (Number.isFinite(i.boxMs)) parts.push((ja ? '箱の再構築 ' : 'box rebuild ') + i.boxMs.toFixed(2) + ' ms / ' + (i.boxFrames | 0) + (ja ? ' フレーム' : ' frames')); // the last segment scan (spread over frames)
  if (p) parts.push((ja ? '反復 平均 ' : 'samples mean ') + Math.round(p.mean) + ' / p95 ' + Math.round(p.p95) + (ja ? ' · hit終了 ' : ' · hit end ') + Math.round(p.hit * 100) + '% · ' + (ja ? '跳躍 ' : 'jump ') + Math.round(p.skip * 100) + '%' + (ja ? '（' + p.px + ' 画素）' : ' (' + p.px + ' px)'));
  return '   ' + parts.join(' · ');
}

// text for pasting (PC side): header, one line per scenario (+ its detail line), zoom summary, verdict
export function resultText(res, ja = true) {
  return [res.head, ...res.results.flatMap(r => { const d = detailLine(r, ja); return d ? [formatLine(r, ja), d] : [formatLine(r, ja)]; }), ...zoomSummaries(res.results, ja).map(z => z.text), verdictLine(res.results, ja)].join('\n');
}

// JSON for the PC side (console / download / localStorage): numbers rounded to keep it short
const r2 = v => Math.round(v * 100) / 100;
const phaseJson = p => (p && p.stats ? { frames: p.stats.frames, seconds: r2(p.stats.seconds), meanFps: r2(p.stats.meanFps), p5Fps: r2(p.stats.p5Fps), worstMs: r2(p.stats.worstMs), overCount: p.stats.overCount, overPercent: r2(p.stats.overRatio * 100), info: p.info || undefined } : undefined);
export function resultJson(res) {
  const o = overall(res.results);
  return {
    kind: 'vr-self-check', head: res.head, build: res.build, when: res.when, targetHz: res.hz, info: res.info || null,
    thresholds: { p5Ratio: P5_FPS_RATIO, overFactor: OVER_FRAME_FACTOR, overMaxRatio: OVER_FRAME_MAX_RATIO, minFrames: MIN_FRAMES },
    verdict: o.pass ? 'PASS' : 'FAIL', ran: o.ran, failed: o.failed, skipped: o.skipped, zoomSummary: zoomSummaries(res.results, false).map(z => z.text),
    scenarios: res.results.map(r => r.skipped ? { id: r.id, label: r.label, skipped: r.skipped }
      : r.error ? { id: r.id, label: r.label, error: r.error }
      : { id: r.id, label: r.label, pass: r.verdict.pass, reasons: r.verdict.reasons, note: r.note || undefined, zoom: r.zoom || undefined,
        frames: r.stats.frames, seconds: r2(r.stats.seconds), meanFps: r2(r.stats.meanFps), p5Fps: r2(r.stats.p5Fps), low1Fps: r2(r.stats.low1Fps), worstMs: r2(r.stats.worstMs), p50Ms: r2(r.stats.p50Ms), p95Ms: r2(r.stats.p95Ms), overCount: r.stats.overCount, overPercent: r2(r.stats.overRatio * 100), info: r.info || undefined, transition: phaseJson(r.phases?.transition) }),
  };
}
