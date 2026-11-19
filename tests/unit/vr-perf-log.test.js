// The VR performance record (docs/vr-perf-log.js) and its wiring in vr-view.js: the same rows for the WebGL and the WebGPU session, a ring buffer, the summary of the menu-closed stretch, the file names.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPerfLog, perfReport, perfFileName, gapBucket, perfMedian, PERF_KEY, PERF_MAX_ROWS, PERF_MIRROR_ROWS } from '../../docs/vr-perf-log.js';
import { saveGxDiagText } from '../../docs/vr-wgpu.js';

const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const memStore = () => { const m = new Map(), sets = []; return { m, sets, setItem(k, v) { sets.push(k); m.set(k, v); }, getItem: k => m.get(k) ?? null }; };
const BUDGET = 1000 / 72;
// one simulated second: n frames at the given gaps (ms), then the row
const second = (log, t, gaps, at, snap = {}) => { for (const g of gaps) { t += g; log.frame(t, BUDGET); } return log.row(snap, at); };

describe('frame interval classes', () => {
  it('1 = up to 1.5 refresh periods, 2 = up to 2.5, 3 = longer', () => {
    expect(gapBucket(BUDGET, BUDGET)).toBe(0);
    expect(gapBucket(BUDGET * 1.49, BUDGET)).toBe(0);
    expect(gapBucket(BUDGET * 1.51, BUDGET)).toBe(1);
    expect(gapBucket(BUDGET * 2.49, BUDGET)).toBe(1);
    expect(gapBucket(BUDGET * 2.51, BUDGET)).toBe(2);
    expect(gapBucket(500, BUDGET)).toBe(2);
  });
  it('a row counts the gaps of its second (the first frame has no gap) and its fps from the frames and the time', () => {
    let clock = 0; const log = createPerfLog({ now: () => clock, store: null });
    clock = 1000;
    const row = second(log, 0, [BUDGET, BUDGET, BUDGET * 2, BUDGET, BUDGET * 3, BUDGET * 4], clock);
    expect([row.g1, row.g2, row.g3]).toEqual([2, 1, 2]); // 6 frames, 5 gaps (the first frame has none)
    expect(row.fps).toBe(6);
    // the counts start again
    clock = 2000;
    const r2 = second(log, 12 * BUDGET, [BUDGET, BUDGET, BUDGET * 5], clock);
    expect([r2.g1, r2.g2, r2.g3]).toEqual([2, 0, 1]); expect(r2.fps).toBe(3);
  });
});

describe('the one-second rows', () => {
  it('carry the means of the ms given (n frames per sum), null where nothing came, and the state the caller gives (fractions to 3 decimals)', () => {
    let clock = 0; const log = createPerfLog({ kind: 'webgpu', now: () => clock, store: null });
    log.add('vol', 6, 1); log.add('vol', 8, 1); log.add('main', 20, 4); log.add('js', 2); log.add('js', 4); log.add('render', 1.5);
    log.add('vol', NaN); log.add('vol', -1); log.add('nope', 5); // ignored
    clock = 1000;
    const r = log.row({ f: 0.7071067, per: 0.75, cap: 1, auto: 1, lv: 0.7, si: 2, step: 1.275, cov: 123456, w: 2064, h: 2208, size: 0.30001, menu: 0, hz: 72, fov: null });
    expect(r.vol).toBe(7); expect(r.main).toBe(5); expect(r.js).toBe(3); expect(r.render).toBe(1.5);
    expect(r.f).toBe(0.707); expect(r.size).toBe(0.3); expect(r.cov).toBe(123456); expect(r.hz).toBe(72); expect(r.fov).toBeNull(); expect(r.menu).toBe(0);
    clock = 2000;
    const r2 = log.row({}); expect(r2.vol).toBeNull(); expect(r2.main).toBeNull(); expect(r2.t).toBe(2);
  });
  it('are a ring buffer: past the maximum the oldest go and are counted', () => {
    let clock = 0; const log = createPerfLog({ now: () => clock, store: null, maxRows: 5 });
    for (let i = 1; i <= 8; i++) { clock = i * 1000; log.row({ menu: 0, tag: i }); }
    expect(log.rows).toHaveLength(5); expect(log.rows.map(r => r.tag)).toEqual([4, 5, 6, 7, 8]); expect(log.dropped).toBe(3);
    expect(PERF_MAX_ROWS).toBeGreaterThanOrEqual(300); expect(PERF_MAX_ROWS).toBeLessThanOrEqual(1000);
  });
  it('are mirrored to localStorage every few seconds, not every second, and once more at flush', () => {
    let clock = 0; const st = memStore(), log = createPerfLog({ kind: 'webgl', now: () => clock, store: st, saveEveryMs: 5000 });
    for (let i = 1; i <= 12; i++) { clock = i * 1000; log.row({ menu: 0 }); }
    expect(st.sets.length).toBe(2); // at 5 s and 10 s
    expect(st.sets.every(k => k === PERF_KEY + '-webgl')).toBe(true); // one key per kind
    log.flush(); expect(st.sets.length).toBe(3);
    const saved = JSON.parse(st.m.get(PERF_KEY + '-webgl')); expect(saved.kind).toBe('webgl'); expect(saved.rows).toHaveLength(12);
  });
  it('the mirror keeps only the last rows (the log in memory keeps them all); the WebGPU mirror has its own key', () => {
    let clock = 0; const st = memStore(), log = createPerfLog({ kind: 'webgpu', now: () => clock, store: st, saveEveryMs: 0 });
    for (let i = 1; i <= PERF_MIRROR_ROWS + 30; i++) { clock = i * 1000; log.row({ menu: 0, tag: i }); }
    const saved = JSON.parse(st.m.get(PERF_KEY + '-webgpu'));
    expect(saved.rows).toHaveLength(PERF_MIRROR_ROWS); expect(saved.rows.at(-1).tag).toBe(PERF_MIRROR_ROWS + 30); expect(log.rows).toHaveLength(PERF_MIRROR_ROWS + 30);
    expect(st.m.has(PERF_KEY + '-webgl')).toBe(false);
  });
  it('survive a store that throws or is missing', () => {
    let clock = 0;
    const bad = createPerfLog({ now: () => clock, store: { setItem() { throw new Error('full'); } }, saveEveryMs: 0 });
    clock = 1000; expect(() => { bad.row({}); bad.flush(); }).not.toThrow();
    const none = createPerfLog({ now: () => clock, store: null }); expect(() => { none.row({}); none.flush(); }).not.toThrow();
  });
});

describe('the summary: medians of the rows with the menu closed', () => {
  it('uses only the closed rows, the median of each column, the sum of the gap counts', () => {
    let clock = 0; const log = createPerfLog({ now: () => clock, store: null });
    const mk = (menu, fps, vol, main, render, js, f, step, g) => {
      clock += 1000; for (let i = 0; i < fps; i++) log.frame(clock - 1000 + i * (1000 / fps), BUDGET);
      log.add('vol', vol); log.add('main', main); log.add('render', render); log.add('js', js);
      const r = log.row({ menu, f, step }); r.g1 = g[0]; r.g2 = g[1]; r.g3 = g[2];
    };
    mk(0, 50, 8, 5, 2, 3, 1, 1.5, [40, 8, 1]);
    mk(1, 20, 30, 30, 9, 9, 0.5, 3, [1, 1, 15]); // menu open: left out
    mk(0, 54, 9, 6, 3, 4, 0.8, 1.5, [44, 5, 0]);
    mk(0, 60, 10, 7, 4, 5, 0.7, 2, [55, 2, 0]);
    const s = log.summary();
    expect(s.rows).toBe(4); expect(s.closedRows).toBe(3);
    expect(s.fps).toBe(54); expect(s.vol).toBe(9); expect(s.main).toBe(6); expect(s.render).toBe(3); expect(s.js).toBe(4); expect(s.f).toBe(0.8); expect(s.step).toBe(1.5);
    expect([s.g1, s.g2, s.g3]).toEqual([139, 15, 1]);
  });
  it('the median of an even count is the mean of the middle two; nothing = null (also with only open-menu rows)', () => {
    expect(perfMedian([4, 1, 3, 2])).toBe(2.5); expect(perfMedian([null, 7, undefined])).toBe(7); expect(perfMedian([])).toBeNull();
    let clock = 0; const log = createPerfLog({ now: () => clock, store: null });
    clock = 1000; log.frame(10, BUDGET); log.row({ menu: 1 });
    const s = log.summary(); expect(s.closedRows).toBe(0); expect(s.fps).toBeNull(); expect(s.main).toBeNull();
  });
});

describe('the text (panel / copy / file)', () => {
  const sample = kind => {
    let clock = 0; const log = createPerfLog({ kind, mode: 'vr', now: () => clock, store: null });
    for (let i = 1; i <= 3; i++) { clock = i * 1000; for (let k = 0; k < 55; k++) log.frame(clock - 1000 + k * 18, BUDGET); log.add('vol', 7); log.row({ f: 0.7, per: 1, cap: 1, auto: 1, lv: 0.7, si: 1, step: 1.275, cov: 99999, w: 2000, h: 2000, size: 0.3, menu: i === 3 ? 1 : 0, hz: 72, fov: 1 }); }
    return log;
  };
  it('names the kind, has the summary of the closed stretch and one line per row under a header of the columns', () => {
    const t = perfReport(sample('webgpu'), { build: '744', ua: 'UA-X' }).split('\n');
    expect(t[0]).toBe('VR performance log · WebGPU · vr ·');
    expect(t[1]).toBe('UA: UA-X');
    expect(t[2]).toContain('rows with the menu closed: 2 of 3');
    expect(t[3]).toContain('median fps'); expect(t[3]).toContain('volume GPU 7 ms'); expect(t[3]).toContain('main GPU - ms');
    expect(t[4]).toContain('frame intervals');
    const h = t.findIndex(l => /^\s*t\s+fps\s+g1/.test(l));
    expect(h).toBeGreaterThan(0); expect(t.slice(h + 1)).toHaveLength(3);
    expect(t[h]).toMatch(/vol\s+main\s+render\s+js\s+span\s+gap\s+oth\s+cpu\s+swd\s+wake\s+pre\s+vlat\s+vdrop\s+f\s+per\s+cap\s+auto\s+lv\s+si\s+step\s+cov\s+w\s+h\s+size\s+menu\s+hz\s+fov\s+rec/);
    expect(t[h + 1].trim().split(/\s+/)).toHaveLength(t[h].trim().split(/\s+/).length);
    expect(perfReport(sample('webgl'), {})).toContain('· WebGL ·');
    const w = sample('webgl'); w.meta['GPU timers'] = 'none (no GPU time)';
    const wt = perfReport(w, {}); expect(wt).toContain('GPU timers: none (no GPU time)'); expect(wt).toContain('no sample in that second'); expect(wt).toContain('straight into the XR framebuffer');
  });
  it('the file name tells the two apart: WebGL vrl-vr-perf-webgl-<build>-<date>-<time>.txt, WebGPU keeps vrl-vr-gpu-diag-...', () => {
    const d = new Date(2026, 10, 18, 9, 15, 42);
    expect(perfFileName('webgl', '744', d)).toBe('vrl-vr-perf-webgl-744-20261118-0915.txt');
    expect(perfFileName('webgpu', '744', d)).toBe('vrl-vr-gpu-diag-744-20261118-0915.txt');
    expect(perfFileName('webgl', '', new Date(2026, 0, 2, 3, 4))).toBe('vrl-vr-perf-webgl-x-20260102-0304.txt');
  });
  it('saveGxDiagText saves under a given name (the WebGL record), else under the diagnostics name as before', async () => {
    const made = [], doc = { body: { append() {} }, createElement() { const n = { style: {}, click() {}, remove() {} }; made.push(n); return n; } };
    const urlApi = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
    expect(saveGxDiagText('t', { build: '744', now: new Date(2026, 10, 18, 9, 15), doc, urlApi, name: 'vrl-vr-perf-webgl-744-20261118-0915.txt' })).toBe('vrl-vr-perf-webgl-744-20261118-0915.txt');
    expect(saveGxDiagText('t', { build: '744', now: new Date(2026, 10, 18, 9, 15), doc, urlApi })).toBe('vrl-vr-gpu-diag-744-20261118-0915.txt');
  });
});

describe('the frame timeline columns: span / gap medians, oth, cpu / swd means', () => {
  it('a row has the median span and gap of its second, oth = span - vol - main, the mean cpu and swd; a second with no sample has "-" (WebGL)', () => {
    let clock = 1000; const log = createPerfLog({ kind: 'webgpu', now: () => clock, store: null });
    for (const v of [9, 30, 10]) log.sample('span', v); for (const v of [6, 7, 100]) log.sample('gap', v);
    log.add('vol', 10); log.add('main', 0.9); log.add('cpu', 4); log.add('cpu', 6); log.add('swd', 5);
    const row = log.row({}, clock);
    expect(row.span).toBe(10); expect(row.gap).toBe(7); expect(row.oth).toBe(-0.9); expect(row.cpu).toBe(5); expect(row.swd).toBe(5);
    clock = 2000; const r2 = log.row({}, clock); // no samples: they start again
    expect([r2.span, r2.gap, r2.oth, r2.cpu, r2.swd]).toEqual([null, null, null, null, null]);
    const row3 = (() => { for (const v of [17, 17]) log.sample('span', v); log.add('vol', 10); log.add('main', 0.9); clock = 3000; return log.row({}, clock); })();
    expect(row3.oth).toBe(6.1); expect(row3.gap).toBeNull();
    log.sample('gap', NaN); log.sample('nope', 1); // ignored
  });
  it('the summary has their medians over the menu-closed rows, the report has the line and one note line each (English) for span / gap, oth, and cpu / swd', () => {
    let clock = 0; const log = createPerfLog({ kind: 'webgpu', now: () => clock, store: null });
    for (let i = 1; i <= 3; i++) { clock = i * 1000; log.frame(clock - 500, BUDGET); log.frame(clock, BUDGET); log.sample('span', 10 + i); log.sample('gap', 5 + i); log.add('cpu', 3); log.add('swd', 2); log.add('vol', 9); log.add('main', 1); log.row({ menu: 0 }, clock); }
    const s = log.summary(); expect([s.span, s.gap, s.oth, s.cpu, s.swd]).toEqual([12, 7, 2, 3, 2]);
    const t = perfReport(log, {});
    expect(t).toContain('GPU timeline (WebGPU, menu closed): span 12 ms · gap 7 ms');
    for (const w of ['span = ms from the first GPU start', 'gap = ms the GPU was idle', 'oth = span - vol - main', 'cpu = mean ms from the start of the XR frame callback', 'swd = mean ms from that submit']) expect(t, w).toContain(w);
  });
  it('the WebGL record is not broken: the new columns are "-" and the row still lines up with the header', () => {
    let clock = 1000; const log = createPerfLog({ kind: 'webgl', now: () => clock, store: null }); log.add('vol', 2); log.row({ f: 1, menu: 0, fps: 72 }, clock);
    const t = perfReport(log, {}).split('\n'), h = t.findIndex(l => /^\s*t\s+fps\s+g1/.test(l));
    expect(t[h + 1].trim().split(/\s+/)).toHaveLength(t[h].trim().split(/\s+/).length);
  });
  it('wiring: the frame end (marker, cpu, swd) runs after the main render, swd on every 4th frame one at a time; span / gap are taken with the volume ms', () => {
    expect(vr).toContain("perfLog.add('render',performance.now()-rc0); // the CPU ms of renderer.render() (WebGPU: with gxRender's bookkeeping)\n  if(gx)gxFrameEnd(fa0);");
    expect(vr).toContain("gx.vol?.volume.markFrame?.()"); expect(vr).toContain("perfLog.add('cpu',t1-fa0)");
    expect(vr).toContain("if(!gxRec.on&&!gxSwdBusy&&(gxS.rendered&3)===2){gxSwdBusy=true;const fn=frameNo;gx.device.queue.onSubmittedWorkDone()");
    expect(vr).toContain("perfLog.sample('span',v)"); expect(vr).toContain("perfLog.sample('gap',v)");
  });
});

describe('the wake / pre / vlat columns (the wait inside the gap)', () => {
  it('a row has their means; a second with no sample (and every WebGL second) has "-"; the summary has their medians, the report a line and a note', () => {
    let clock = 1000; const log = createPerfLog({ kind: 'webgpu', now: () => clock, store: null });
    log.add('wake', 2); log.add('wake', 4); log.add('pre', 1.2); log.add('vlat', 0.5); log.add('vlat', NaN); log.add('vlat', -1); // the last two are ignored
    const r = log.row({ menu: 0 }, clock);
    expect([r.wake, r.pre, r.vlat]).toEqual([3, 1.2, 0.5]);
    clock = 2000; const r2 = log.row({ menu: 0 }, clock); expect([r2.wake, r2.pre, r2.vlat]).toEqual([null, null, null]);
    for (let i = 3; i <= 5; i++) { clock = i * 1000; log.frame(clock - 500, BUDGET); log.frame(clock, BUDGET); log.add('wake', i); log.add('pre', 1); log.add('vlat', 2); log.row({ menu: 0 }, clock); }
    const s = log.summary(); expect(s.pre).toBe(1); expect(s.vlat).toBe(2);
    const t = perfReport(log, {}); expect(t).toContain('wake '); expect(t).toContain(' ms · pre 1 ms · vlat 2 ms');
    for (const w of ['wake = ms from the moment queue.onSubmittedWorkDone', 'pre = ms from the start of the XR frame callback to the return of the volume pass submit', 'vlat = ms from the volume pass submit to queue.onSubmittedWorkDone minus that frame', 'a negative vlat is rounded to 0', 'recorded only for frames whose completion arrived before the next frame started', 'counted in vdrop']) expect(t, w).toContain(w);
    const gl = createPerfLog({ kind: 'webgl', now: () => 1000, store: null }); const g = gl.row({ menu: 0, fps: 72 }, 1000); expect([g.wake, g.pre, g.vlat]).toEqual([null, null, null]);
  });
  it('vdrop: the share of vlat samples dropped at the CPU floor (GPU already done) is a column; dropped samples leave vlat unchanged', () => {
    let clock = 1000; const log = createPerfLog({ kind: 'webgpu', now: () => clock, store: null });
    log.add('vdrop', 1); log.add('vdrop', 0); log.add('vlat', 3);
    const r = log.row({ menu: 0 }, clock); expect([r.vdrop, r.vlat]).toEqual([0.5, 3]);
    expect(vr).toContain("if(p.d<=floor+0.5){perfLog.add('vdrop',1);return}perfLog.add('vdrop',0);");
  });
  it('wiring: a later frame end does not overwrite the first t1 of the pending vlat sample', () => {
    const m = vr.match(/if\(gxVolPend&&gxVolPend\.t1===null\)gxVolPend\.t1=t1;/); expect(m).not.toBeNull();
    const step = new Function('gxVolPend', 't1', m[0] + 'return gxVolPend;');
    const p = { tv: 0, t1: null }; step(p, 5); step(p, 20); expect(p.t1).toBe(5);
    expect(step(null, 7)).toBeNull();
  });
  it('wiring: pre is taken when the volume pass submit returns, vlat on every 4th frame (a phase of its own) sharing the one-at-a-time wait with swd, wake from the swd of the previous sampled frame to the next frame start', () => {
    expect(vr).toContain("const tv=performance.now();perfLog.add('pre',tv-fa0);");
    expect(vr).toContain("if(!gxRec.on&&!gxSwdBusy&&(gxS.rendered&3)===3){");
    expect(vr).toContain("gx.vol.volume.onFrameVolMs?.(ms=>{p.v=ms;fin()})"); expect(vr).toContain("perfLog.add('vlat',Math.max(0,p.d-p.v))"); expect(vr).toContain("if(p.d<=floor+0.5){perfLog.add('vdrop',1);return}"); expect(vr).toContain("if(gxVolPend&&gxVolPend.t1===null)gxVolPend.t1=t1"); expect(vr).not.toContain("if(gxVolPend)gxVolPend.t1=t1"); expect(vr).toContain("catch(e){gxSwdBusy=false;gxVolPend=null;");
    expect(vr).toContain("perfLog.add('swd',n-t1);if(frameNo===fn)gxWakeAt=n");
    expect(vr).toContain("if(gxWakeAt>0){if(!gxRec.on&&fa0-gxWakeAt<1000)perfLog.add('wake',fa0-gxWakeAt);gxWakeAt=0}");
    expect(vr.indexOf("gxVolSubmitted(fa0);")).toBeGreaterThan(vr.indexOf('gx.vol.draw({u:material.uniforms'));
    expect(vr.indexOf("gxVolSubmitted(fa0);")).toBeLessThan(vr.indexOf('rs.low=true;rs.w=gx.vol.stats.w'));
  });
});

describe('WebGPU: the volume pass is submitted before the bookkeeping that does not feed it', () => {
  const loopAt = vr.indexOf(' renderer.setAnimationLoop(xrTs=>{'), draw = vr.indexOf('gx.vol.draw({u:material.uniforms');
  const at = (needle, from = loopAt) => { const i = vr.indexOf(needle, from); expect(i, needle).toBeGreaterThan(from); return i; };
  it('what decides the volume (hands, planes, uniforms, shown set, pair / part, render scale, region highlight) is before the submit; the HU line / hover / cards / markers bookkeeping is after it on WebGPU', () => {
    for (const before of ['updatePress(c,nowF)', 'setRegionHighlight(hlTracker.update(', 'refreshContentBox();', 'skipTick();', 'pairFrame();', 'partFrame();', 'benchTick();', 'const kF=FOVEA_K[settings.foveation|0]??1', 'const f=benchOn?fRaw:scaleGuard.step(fRaw,nowG)'])
      expect(at(before), before).toBeLessThan(draw);
    const late = at('if(gx){lateHints();lateScale();lateHud();lateCards();lateMarks()}');
    expect(late).toBeGreaterThan(draw);
    expect(late).toBeLessThan(at('labelBatch.flush(renderer,camera);', draw)); expect(late).toBeLessThan(at('if(gx)gxRender();', draw));
    const calls = vr.slice(loopAt, draw).match(/(if\(!gx\))?(lateHints|lateScale|lateHud|lateCards|lateMarks)\(\)/g) || []; // before the submit every call is guarded by !gx (WebGL)
    expect(calls).toHaveLength(5); expect(calls.every(c => c.startsWith('if(!gx)'))).toBe(true);
  });
  it('WebGL keeps its order: lateHints / lateScale at their old places, lateHud at the old place (right after the controller loop), lateCards after the highlight (before the thumbstick scroll), lateMarks after benchTick; all three only when there is no gx', () => {
    const hints = at('if(!gx)lateHints();'), scl = at('if(!gx)lateScale()'), hud = at('if(!gx)lateHud();'), cards = at('if(!gx)lateCards();'), scroll = at('// thumbstick scroll'), marks = at('if(!gx)lateMarks();');
    expect(hints).toBeGreaterThan(at('tutVr.update(performance.now())')); expect(hints).toBeLessThan(at('placeHelpNow();')); // the guides read what the tutorial step set this frame
    expect(scl).toBeGreaterThan(at('const cs=clampScale(holder.scale.x,lm)')); expect(scl).toBeLessThan(at('let tutHov=-1,hover=-1')); // after the scale is clamped, before the controller loop
    expect(hud).toBeGreaterThan(at('c.userData.gate.update(')); expect(hud).toBeLessThan(at('{snFrame=undefined;'));
    expect(cards).toBeGreaterThan(at('setRegionHighlight(hlTracker.update(')); expect(cards).toBeLessThan(scroll);
    expect(marks).toBeGreaterThan(at('benchTick();')); expect(marks).toBeLessThan(at('data-resolution cap (vr-render-scale.js)'));
  });
  it('the late functions hold exactly the moved bookkeeping, fed by the loop through lf', () => {
    const fn = (name, next) => vr.slice(vr.indexOf(' const ' + name + '=') , vr.indexOf(next));
    const hints = fn('lateHints', ' const lateHud='), scl = fn('lateScale', ' const lateHints='), hud = fn('lateHud', ' const lateCards='), cards = fn('lateCards', ' const lateMarks='), marks = fn('lateMarks', ' renderer.setAnimationLoop(xrTs=>{');
    for (const w of ['ctlHints.update(', 'edgeArrow.update(', 'boardArrow.update(', 'glowHelp.visible=']) expect(hints, w).toContain(w);
    for (const w of ['scaleTag.setText(', 'scaleTag.place(holder,vrHalfExt,head)', 'scaleMenuKey=k']) expect(scl, w).toContain(w);
    for (const w of ['huLine.update(lf.js0)', 'menu.setHover(hover)', 'help.setHover(tutHov)', 'hist.setAxisHover(', 'undoBtn.update(', 'flingDbg?.update(']) expect(hud, w).toContain(w);
    for (const w of ['syncPins();', 'embedLabel(lb,occ,pinHeld.has(lb.rid))', 'thinPins(occ);', 'px.pins()']) expect(cards, w).toContain(w);
    for (const w of ['updateHidden(nowH)', 'vpMarkers.update(', 'vpMeasure.update(', 'pt2.markers.update(', 'pt2.measure.update(']) expect(marks, w).toContain(w);
    expect(vr).toContain('lf.js0=js0;lf.hover=hover;lf.tutHov=tutHov;lf.undoLit=undoLit;lf.histHov=histHov;lf.hoverIds=hoverIds;');
  });
});

describe('the wiring in vr-view.js (the drawing is not changed)', () => {
  it('one record per session, WebGL and WebGPU alike; the WebGL session shows the panel at its end (the WebGPU one from the diagnostics listener)', () => {
    expect(vr).toContain("perfLog=createPerfLog({kind:gx?'webgpu':'webgl',mode});");
    expect(vr).toContain("if(!gxD)session.addEventListener('end',()=>{perfLog.flush();const pl=perfLog;setTimeout(()=>showGxDiagPanel(ja,null,pl),0)},{once:true});");
    expect(vr).toContain("perfLog.meta['GPU timers']=gx?'volume '+(gx.vol?.volume.hasTimer");
    expect(vr).toContain("import { createPerfLog, perfReport, perfFileName, createVolBreakdown, BD_VARIANTS, BD_SPECS } from './vr-perf-log.js?v=");
  });
  it('the loop feeds it: frame gap, JS ms, render() CPU ms around the unchanged render line, the GPU ms of both paths, the row once a second', () => {
    expect(vr).toContain('perfLog.frame(xrTs||performance.now(),1000/Math.max(1,targetRate()||72));');
    expect(vr).toContain("perfLog.add('js',jm)");
    expect(vr).toContain("const rc0=performance.now();\n  if(gx)gxRender();else timed('main',()=>renderer.render(scene,camera));\n  perfLog.add('render',performance.now()-rc0);");
    expect(vr).toContain('ctrl[kind]+=ms;ctrlN[kind]++;perfLog.add(kind,ms)'); // WebGL: the timer query's vol / main
    expect(vr).toContain("perfLog.add('vol',gt.ms,gt.n)"); // WebGPU: the volume pass's timestamp
    expect(vr).toContain('perfLog.row({f:rs.eff,per:rs.per,cap:rs.cap,auto:auto?1:0,lv:aq.level,si:aq.stepIdx,step:');
    expect(vr).toContain('menu:ui.open?1:0,hz:targetRate(),fov:fovX,...(gx?{rec:gxRec.on?1:0}:{})},now)');
  });
  it('WebGPU main render GPU ms: three tracks timestamps, resolved every 4th frame one at a time, into the record only (never into the auto quality)', () => {
    expect(vr).toContain('forceWebGL:false,trackTimestamp:true});');
    const i = vr.indexOf('const gxRender=()=>{'), body = vr.slice(i, vr.indexOf('renderer.setAnimationLoop(xrTs=>', i));
    expect(body).toContain("renderer.resolveTimestampsAsync('render')");
    expect(body).toContain('!gxTsBusy&&(gxS.rendered&3)===0');
    expect(body).toContain("perfLog.add('main',ms)");
    expect(body).toContain('gxTsBusy=false');
    expect(body).not.toMatch(/ctrl\.main|ctrlN\.main|sums\.main/);
    expect(vr).toContain('let gxTsBusy=false;');
  });
  it('the auto quality is still driven by what it was (the record only reads: no aq call and no uniform is written by the perf lines)', () => {
    for (const line of vr.split('\n').filter(l => l.includes('perfLog.'))) expect(line).not.toMatch(/aq\.(update|anticipate|set\w+)\(|\.value\s*=[^=]|stepSize\.value=|setFoveation/);
  });
});
