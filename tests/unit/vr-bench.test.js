// The comparison bench, the frame ring and the isolation switches (docs/vr-bench.js) and their wiring: the scripted scenes and their per-scene numbers (drops = g2 + g3, the 95 / 99 % points, the longest interval,
// span / vol), the cover tuner, the 2000-frame ring and the windows around slow frames, the report text, the switches (default = what the view always did), and the hooks in vr-wgpu.js / vr-perf-log.js / vr-view.js.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREEG from 'three/webgpu';
import {
  BENCH_SCENES, BENCH_DISCARD_MS, BENCH_PLANS, ISO_MODES, BENCH_ROT_RATE, RING_SIZE, RING_SLOW_MS, BENCH_COUNT, quantile, statsOf,
  createBenchScript, createCoverTuner, createFrameRing, createLongTaskWatcher, createIsolation, createCompareBench, tapPerfLog, benchReportLines, ringReportLines, readHeapBytes,
} from '../../docs/vr-bench.js';
import { createPerfLog, perfReport } from '../../docs/vr-perf-log.js';
import { GX_SWITCH, createGxDiag, startGxHeartbeat, createVrVolumeRenderer } from '../../docs/vr-wgpu.js';

const vrSrc = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const BUDGET = 1000 / 72;

describe('quantiles', () => {
  it('nearest rank: the value at or below which q of the samples are; null for none', () => {
    const s = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(quantile(s, 0.95)).toBe(10); expect(quantile(s, 0.9)).toBe(9); expect(quantile(s, 0.5)).toBe(5); expect(quantile(s, 0.99)).toBe(10); expect(quantile(s, 0.01)).toBe(1);
    expect(quantile(new Float64Array(0), 0.5)).toBe(null);
    const st = statsOf([5, 1, 3, 2, 4, NaN]); expect(st).toMatchObject({ n: 5, med: 3, max: 5, min: 1 }); expect(statsOf([])).toBe(null);
  });
});

// ---- the script ----
// frames at 72 Hz for the given seconds from t0 (ms); `slow` = { at: ms into the run, dt } makes that frame come late; returns the clock after the last frame
const drive = (script, t0, seconds, { slow = [], onFrame = null, budget = BUDGET } = {}) => {
  let t = t0; const end = t0 + seconds * 1000; let k = 0;
  while (t < end) {
    const late = slow.find(s => Math.abs(s.at - (t - t0)) < budget / 2 && !s.done);
    if (late) { late.done = true; t += late.dt - budget; }
    script.frame(t); script.tick(t); onFrame?.(t, k++);
    t += budget;
  }
  return t;
};

describe('the bench script: scenes, the left-out start, and the per-scene numbers', () => {
  it('the scenes are still 60 s, turn 40 s, turn big 40 s (covered px about 1 M), near 40 s (2-3 M, still); the first 2 s are left out; the turning scenes turn', () => {
    expect(BENCH_SCENES.map(s => [s.id, s.ms / 1000, s.rot, s.cover])).toEqual([['still', 60, false, 0], ['turn', 40, true, 0], ['turnBig', 40, true, 1.0e6], ['near', 40, false, 2.5e6]]);
    expect(BENCH_DISCARD_MS).toBe(2000);
    expect(BENCH_SCENES[3].cover).toBeGreaterThanOrEqual(2e6); expect(BENCH_SCENES[3].cover).toBeLessThanOrEqual(3e6);
    expect(BENCH_PLANS).toEqual({ cmp: ['std'], iso: ['asis', 'iso'] });
  });
  it('goes through the four scenes in order at 60 / 40 / 40 / 40 s of the clock, settles 2 s in each, and ends', () => {
    const sc = createBenchScript({ budgetMs: BUDGET }); const seen = []; let started = false;
    let st = sc.start(1000); seen.push([st.idx, st.phase]);
    let t = 1000, lastIdx = 0, lastPhase = st.phase;
    const changes = [];
    while (!sc.done && t < 1000 + 190000) {
      t += 13; st = sc.tick(t);
      if (st.idx !== lastIdx || st.phase !== lastPhase) { changes.push([st.idx, st.phase, Math.round((t - 1000) / 1000)]); lastIdx = st.idx; lastPhase = st.phase; }
    }
    void started; void seen;
    // measure starts 2 s into each scene; the next scene starts when the previous one's time is over
    expect(changes.map(c => c.slice(0, 2))).toEqual([[0, 'measure'], [1, 'settle'], [1, 'measure'], [2, 'settle'], [2, 'measure'], [3, 'settle'], [3, 'measure'], [3, 'done']]);
    expect(changes.map(c => c[2])).toEqual([2, 60, 62, 100, 102, 140, 142, 180]);
    expect(sc.done).toBe(true);
  });
  it('counts only the measured part of a scene: drops = intervals of 1.5 periods or more (g2 + g3), the 95 / 99 % points and the longest interval; the settle and the scene change are not in it', () => {
    const scenes = [{ id: 'a', ms: 10000, rot: false, cover: 0 }, { id: 'b', ms: 8000, rot: true, cover: 0 }];
    const sc = createBenchScript({ scenes, budgetMs: BUDGET });
    sc.start(0);
    // scene a: 2 s settle with a 100 ms hitch (not counted), then 8 s with one frame of 25 ms (g2), one of 45 ms (g3), one of 70 ms (g3)
    const slowA = [{ at: 1000, dt: 100 }, { at: 4000, dt: 25 }, { at: 6000, dt: 45 }, { at: 7000, dt: 70 }];
    const t1 = drive(sc, 0, 10, { slow: slowA });
    const t2 = drive(sc, t1, 8, { slow: [{ at: 3000, dt: 30 }] });
    expect(sc.done || sc.tick(t2 + 20).done).toBe(true);
    const [a, b] = sc.summary();
    expect(a.reached && b.reached).toBe(true);
    expect([a.g2, a.g3]).toEqual([1, 2]); expect(a.drop).toBeCloseTo(3 / a.frames, 10);
    expect(a.max).toBe(70); expect(a.p99).toBeLessThan(15);
    expect(a.frames).toBeGreaterThan(8 * 72 - 14); expect(a.frames).toBeLessThan(8 * 72 + 6); // 8 s of 72 Hz frames (the hitch in the first 2 s is not among them)
    expect([b.g2, b.g3]).toEqual([1, 0]); expect(b.max).toBe(30);
    expect(a.measuredMs).toBeGreaterThan(7900); expect(a.measuredMs).toBeLessThanOrEqual(8100);
    // p95: with 3 slow frames in about 580 the 95 % point is still a normal frame
    expect(a.p95).toBeLessThan(15);
  });
  it('the 95 / 99 % points and the longest interval are the nearest-rank values of the scene\'s intervals', () => {
    const sc = createBenchScript({ scenes: [{ id: 'a', ms: 60000, cover: 0 }], budgetMs: 10 }); sc.start(0); sc.tick(2500);
    let t = 3000; sc.frame(t);
    const dts = []; for (let i = 0; i < 200; i++) dts.push(i < 3 ? 100 + i : i < 15 ? 20 : 10); // 3 of 200 at 100+ ms (1.5 %), 12 at 20 ms (6 %), the rest 10 ms
    for (const d of dts) { t += d; sc.frame(t); }
    const s = sc.summary()[0];
    expect(s.frames).toBe(200); expect(s.max).toBe(102); expect(s.p99).toBe(100); // the 198th of 200 sorted values: the third slowest
    expect(s.p95).toBe(20); expect([s.g2, s.g3]).toEqual([12, 3]); expect(s.drop).toBeCloseTo(15 / 200, 10);
  });
  it('a 1.5-period interval is a drop (the same rule as the performance record), anything shorter is not', () => {
    const sc = createBenchScript({ scenes: [{ id: 'a', ms: 6000, cover: 0 }], budgetMs: 10 });
    sc.start(0); sc.tick(2500);
    sc.frame(2500); sc.frame(2510); sc.frame(2524.9); sc.frame(2540); sc.frame(2565); // 10, 14.9, 15.1, 25: no, no, g2, g3
    const s = sc.summary()[0];
    expect([s.frames, s.g1, s.g2, s.g3]).toEqual([4, 2, 1, 1]);
  });
  it('span / vol / main samples and the covered px / scale of the frames belong to the measured part of the scene they arrive in', () => {
    const sc = createBenchScript({ scenes: [{ id: 'a', ms: 6000, cover: 0 }, { id: 'b', ms: 6000, cover: 0 }], budgetMs: BUDGET });
    sc.start(0);
    sc.sample('vol', 99); sc.observe(1, 1); // settle: ignored
    sc.tick(2500); for (let i = 1; i <= 10; i++) { sc.sample('vol', i); sc.sample('span', i + 2); sc.observe(1e6 + i, 0.5 + i / 100); }
    sc.sample('nope', 1); sc.sample('vol', NaN);
    sc.tick(6100); sc.sample('vol', 50); // scene b's settle
    sc.tick(8200); sc.sample('vol', 7); sc.sample('main', 4);
    const [a, b] = sc.summary();
    expect(a.vol).toMatchObject({ n: 10, med: 5.5, p95: 10, max: 10 }); expect(a.span).toMatchObject({ n: 10, med: 7.5 }); expect(a.cov.med).toBe(1000006); expect(a.f.min).toBe(0.51);
    expect(b.vol).toMatchObject({ n: 1, med: 7 }); expect(b.main).toMatchObject({ n: 1, med: 4 }); expect(b.span).toBe(null);
  });
  it('an aborted script keeps the scene in progress as a partial one and the scenes after it as not reached', () => {
    const sc = createBenchScript({ budgetMs: BUDGET }); sc.start(0);
    let t = drive(sc, 0, 70); sc.abort(t);
    const s = sc.summary();
    expect(s.map(x => x.reached)).toEqual([true, true, false, false]); expect(s[1].partial).toBe(true); expect(s[0].partial).toBe(false);
    expect(s[0].frames).toBeGreaterThan(57 * 72 - 20); // 58 s measured of the 60 s scene
    expect(s[1].measuredMs).toBeGreaterThan(5000); expect(sc.done).toBe(true);
    t += 100; sc.frame(t); expect(sc.summary()[1].frames).toBe(s[1].frames); // nothing counted after the end
  });
});

describe('the cover tuner', () => {
  // covered px of both eyes ~ K (scale / dist)^2 (K: a body of 16.5 cm at 0.65 m covers about 0.4 M px)
  const K = 0.4e6 * (0.65 / 0.05) ** 2;
  const run = (target, { maxScale = 0.09, steps = 20 } = {}) => {
    const t = createCoverTuner({ target }), fr = { scale: 0.05, dist: 0.65 }, clamp = s => Math.min(maxScale, Math.max(0.01, s));
    const cov = () => K * (fr.scale / fr.dist) ** 2;
    for (let i = 0; i < steps; i++) { for (let k = 0; k < 7; k++) t.feed(cov()); t.step(fr, clamp); }
    return { fr, cov: cov(), t };
  };
  it('moves the size (up to its limit) and then the distance until the covered px is within 8 % of the target: about 1 M, and 2-3 M', () => {
    const big = run(1.0e6); expect(Math.abs(big.cov / 1.0e6 - 1)).toBeLessThanOrEqual(0.08); expect(big.fr.scale).toBeGreaterThan(0.05);
    const near = run(2.5e6); expect(Math.abs(near.cov / 2.5e6 - 1)).toBeLessThanOrEqual(0.08);
    expect(near.fr.scale).toBeCloseTo(0.09, 6); expect(near.fr.dist).toBeLessThan(0.65); // the size is at its limit: the rest is distance
  });
  it('leaves a frame within the tolerance alone, never goes closer than the minimum distance, and comes closer when nothing is on screen', () => {
    const t = createCoverTuner({ target: 1e6 }), fr = { scale: 0.05, dist: 0.65 };
    t.feed(1.02e6); t.step(fr); expect(fr).toEqual({ scale: 0.05, dist: 0.65 }); expect(t.ok).toBe(1);
    const t2 = createCoverTuner({ target: 5e6, minDist: 0.3 }), f2 = { scale: 0.05, dist: 0.65 };
    for (let i = 0; i < 80; i++) { t2.feed(1e5); t2.step(f2, s => s); }
    expect(f2.dist).toBeGreaterThanOrEqual(0.3);
    const t3 = createCoverTuner({ target: 1e6 }), f3 = { scale: 0.05, dist: 0.65 }; t3.feed(0); t3.step(f3); expect(f3.dist).toBeLessThan(0.65);
  });
});

// ---- the controller, with a fake view ----
const fakeEnv = (over = {}) => {
  const log = { enter: 0, leave: [], menu: [], iso: [], scenes: 0, poses: [], done: null, frames: 0, progress: 0 };
  let cov = 0.4e6; const fr = { scale: 0.05, dist: 0.65 };
  const env = {
    now: () => 0, budgetMs: () => BUDGET, can: () => '', enter: () => { log.enter++; }, leave: ok => { log.leave.push(ok); },
    menu: m => log.menu.push(m), iso: st => log.iso.push({ ...st }),
    scene: () => { log.scenes++; fr.scale = 0.05; fr.dist = 0.65; return { scale: 0.05, dist: 0.65 }; },
    frame: f => { fr.scale = f.scale; fr.dist = f.dist; log.frames++; cov = 0.4e6 * (f.scale / f.dist / (0.05 / 0.65)) ** 2; },
    pose: a => log.poses.push(a), clamp: s => Math.min(0.09, s), read: () => ({ cover: cov, f: 1 }), progress: () => { log.progress++; }, done: (runs, ok) => { log.done = { runs, ok }; },
    ...over,
  };
  return { env, log, fr };
};
const SHORT = [{ id: 'a', ms: 6000, rot: false, cover: 0 }, { id: 'b', ms: 6000, rot: true, cover: 0 }, { id: 'c', ms: 6000, rot: true, cover: 1.0e6 }];
const play = (cb, t0, seconds, { slow = [] } = {}) => { let t = t0; const end = t0 + seconds * 1000, tt0 = t0; while (cb.active && t < end) { const late = slow.find(s => !s.done && t - tt0 >= s.at); if (late) { late.done = true; t += late.dt - BUDGET; } cb.frame(t); cb.tick(t); t += BUDGET; } return t; };

describe('the comparison bench controller', () => {
  it('start refuses while something else is going on (the reason comes back), and does nothing then', () => {
    const { env, log } = fakeEnv({ can: () => 'data is being prepared' });
    const cb = createCompareBench(env, createIsolation(), { scenes: SHORT });
    expect(cb.start('cmp')).toBe('data is being prepared'); expect(cb.active).toBe(false); expect(log.enter).toBe(0); expect(log.scenes).toBe(0);
  });
  it('runs the comparison bench: menu closed, the std switches, each scene starts from the standard pose, the turning scenes turn at the fixed rate, the cover scene is tuned, and it ends with leave(true) and the switches back to the default', () => {
    const { env, log, fr } = fakeEnv(); const iso = createIsolation(); const cb = createCompareBench(env, iso, { scenes: SHORT });
    expect(cb.start('cmp')).toBe(''); expect(cb.active).toBe(true); expect(cb.start('cmp')).toBe('running');
    expect(log.enter).toBe(1); expect(log.menu).toEqual(['closed']); expect(log.iso.at(-1).mode).toBe('std'); expect(iso.state).toMatchObject(ISO_MODES.std);
    expect(log.scenes).toBe(1);
    let t = 0; t = play(cb, t, 5.9);
    expect(log.scenes).toBe(1); expect(log.poses.some(a => a !== 0)).toBe(false); // scene a is still
    t = play(cb, t, 0.4); expect(log.scenes).toBe(2);
    t = play(cb, t, 2.6); // scene b: turning
    const turned = log.poses.filter(a => a > 0); expect(turned.length).toBeGreaterThan(100); expect(Math.max(...turned)).toBeLessThan(BENCH_ROT_RATE * 3.2);
    t = play(cb, t, 3.3); // scene c starts at 12 s: standard pose, then tuned within its 2 s settle
    expect(log.scenes).toBe(3);
    t = play(cb, t, 2.0);
    expect(Math.abs(0.4e6 * (fr.scale / fr.dist / (0.05 / 0.65)) ** 2 / 1.0e6 - 1)).toBeLessThanOrEqual(0.12);
    const frozen = { ...fr }; t = play(cb, t, 1); expect({ ...fr }).toEqual(frozen); // the framing is frozen after the settle
    t = play(cb, t, 5); expect(cb.active).toBe(false);
    expect(log.leave).toEqual([true]); expect(log.done.ok).toBe(true); expect(log.done.runs).toHaveLength(1);
    const run = log.done.runs[0]; expect(run.mode).toBe('std'); expect(run.scenes.map(s => s.id)).toEqual(['a', 'b', 'c']); expect(run.scenes.every(s => s.reached && !s.partial)).toBe(true);
    expect(run.scenes[2].cov.med).toBeGreaterThan(0.85e6); expect(run.scenes[2].cov.med).toBeLessThan(1.15e6);
    expect(log.iso.at(-1)).toMatchObject({ mode: 'default', ...ISO_MODES.default }); expect(iso.state.mode).toBe('default'); expect(log.progress).toBeGreaterThan(10);
    void t;
  });
  it('the isolation bench runs twice: as is (menu open) and isolated (menu closed, timestamps / saves off), then puts everything back; the real scenes take 180 s a run', () => {
    const { env, log } = fakeEnv(); const iso = createIsolation(); const cb = createCompareBench(env, iso);
    cb.start('iso'); expect(log.menu).toEqual(['open']); expect(iso.state).toMatchObject(ISO_MODES.asis);
    let t = play(cb, 0, 181);
    expect(log.menu).toEqual(['open', 'closed']); expect(iso.state).toMatchObject(ISO_MODES.iso); expect(cb.active).toBe(true);
    expect(log.iso.map(s => s.mode)).toEqual(['asis', 'iso']);
    t = play(cb, t, 181); expect(cb.active).toBe(false);
    expect(log.done.runs.map(r => r.mode)).toEqual(['asis', 'iso']); expect(log.leave).toEqual([true]);
    for (const r of log.done.runs) { expect(r.scenes.map(s => s.id)).toEqual(['still', 'turn', 'turnBig', 'near']); expect(r.scenes.map(s => Math.round(s.measuredMs / 1000))).toEqual([58, 38, 38, 38]); }
    expect(iso.state.mode).toBe('default');
    // no hitch was given: no drops
    expect(log.done.runs[0].scenes.every(s => s.g2 === 0 && s.g3 === 0 && s.drop === 0)).toBe(true);
  });
  it('a hitch in one scene is counted in that scene only', () => {
    const { env, log } = fakeEnv(); const cb = createCompareBench(env, createIsolation(), { scenes: SHORT });
    cb.start('cmp'); let t = play(cb, 0, 6.5); // into scene b's settle
    t = play(cb, t, 1.9, { slow: [{ at: 0, dt: 200 }] }); // a hitch during b's settle: not counted
    t = play(cb, t, 1.0, { slow: [{ at: 300, dt: 60 }] }); // a hitch while b is measured
    t = play(cb, t, 20);
    const s = log.done.runs[0].scenes; expect(s[0].g2 + s[0].g3).toBe(0); expect(s[1].g2 + s[1].g3).toBe(1); expect(s[1].max).toBe(60); expect(s[2].g2 + s[2].g3).toBe(0);
  });
  it('an abort in the middle keeps an incomplete run, puts the settings back (leave(false)) and the switches to the default', () => {
    const { env, log } = fakeEnv(); const iso = createIsolation(); const cb = createCompareBench(env, iso, { scenes: SHORT });
    cb.start('iso'); let t = play(cb, 0, 10); cb.abort(t);
    expect(cb.active).toBe(false); expect(log.leave).toEqual([false]); expect(log.done.ok).toBe(false);
    expect(log.done.runs).toHaveLength(1); expect(log.done.runs[0].partial).toBe(true); expect(log.done.runs[0].scenes[1].partial).toBe(true); expect(log.done.runs[0].scenes[2].reached).toBe(false);
    expect(iso.state.mode).toBe('default'); expect(log.iso.at(-1).mode).toBe('default');
    cb.abort(t); expect(log.leave).toEqual([false]); // nothing happens twice
  });
});

// ---- the report ----
const sampleRun = (mode, drop) => ({ mode, scenes: BENCH_SCENES.map((s, i) => ({ id: s.id, reached: true, partial: false, measuredMs: 58000, frames: 4000, g1: 0, g2: 10, g3: 2, drop, p95: 14.1, p99: 16.5 + i, max: 45, span: i ? { med: 7, p95: 9 } : null, vol: { med: 5.5, p95: 7.25 }, main: null, cov: { med: 1000000 }, f: { avg: 0.9, min: 0.8 } })) });
describe('the bench report', () => {
  it('prints a header, one line per scene with the drop share and the percentiles, and the isolation comparison of a bench with both runs', () => {
    const runs = [{ ...sampleRun('asis', 0.012), n: 1, label: 'bench 1 · run 1 of 2' }, { ...sampleRun('iso', 0.004), n: 1, label: 'bench 1 · run 2 of 2' }];
    const L = benchReportLines(runs, { kind: 'webgpu', build: '757', hz: 72 });
    expect(L[0]).toContain('comparison bench: WebGPU · · target 72 Hz'); expect(L[0]).toContain('first 2 s');
    expect(L.filter(l => l.startsWith('bench 1 · run'))).toHaveLength(2);
    const still = L.filter(l => l.startsWith('still'));
    expect(still).toHaveLength(2); expect(still[0]).toContain('1.20'); expect(still[1]).toContain('0.40'); expect(still[0]).toMatch(/\s58\.0\s+4000/);
    expect(L.some(l => l.startsWith('isolation of bench 1'))).toBe(true);
    expect(L.find(l => l.includes('still') && l.includes('->'))).toMatch(/1\.20\s+->\s+0\.40/);
    expect(benchReportLines([], {})).toEqual([]);
    expect(benchReportLines([{ mode: 'std', scenes: [{ id: 'near', reached: false }] }], {}).some(l => l.includes('not reached'))).toBe(true);
  });
});

// ---- the ring ----
const feed = (ring, n, { dt = BUDGET, c = () => ({}), t0 = 1000, slow = {} } = {}) => { let t = t0; for (let i = 0; i < n; i++) { t += slow[i] ?? dt; ring.callback(2 + (i % 3), 1); ring.frame(t, c(i)); } return t; };
describe('the frame ring', () => {
  it('keeps the last 2000 frames: 2500 frames make a ring of 2000 records, the oldest being frame 500 of the 2499 intervals', () => {
    const ring = createFrameRing(); expect(RING_SIZE).toBe(2000);
    ring.frame(1000, {}); // the first frame has no interval
    feed(ring, 2500, { t0: 1000 });
    expect(ring.count).toBe(2500); const rec = ring.records();
    expect(rec).toHaveLength(2000); expect(rec[0].n).toBe(500); expect(rec[1999].n).toBe(2499);
    expect(rec.every((r, i) => i === 0 || r.t > rec[i - 1].t)).toBe(true); expect(rec[0].dt).toBeCloseTo(BUDGET, 3);
    const st = ring.stats(); expect(st.frames).toBe(2000); expect(st.total).toBe(2500); expect(st.slow).toBe(0); expect(st.med).toBeCloseTo(13.89, 1);
  });
  it('a short run has only the frames it saw (an interval needs two frames)', () => {
    const ring = createFrameRing(); ring.frame(0, {}); expect(ring.count).toBe(0);
    feed(ring, 5, { t0: 0 }); expect(ring.records()).toHaveLength(5);
  });
  it('a record carries the interval, the callback before it (cpu, pre) and what happened in the interval as differences of the running counts', () => {
    const ring = createFrameRing(), cum = { menu: 0, tex: 0, dsave: 0, psave: 0, mk: 0, maps: 0, heap: 5e7, hold: 0, f: 1, per: 1, cov: 1e6 };
    ring.frame(0, { ...cum });
    ring.callback(2.5, 1.2); Object.assign(cum, { menu: 1, tex: 2, dsave: 1, mk: 3, maps: 3, hold: 1, f: 0.8, heap: 5e7 - 2048 * 1024 }); ring.frame(14, { ...cum });
    ring.callback(2.0, NaN); ring.frame(28, { ...cum }); // nothing happened
    const [a, b] = ring.records();
    expect(a).toMatchObject({ dt: 14, cb: 2.5, menu: 1, tex: 2, dsave: 1, psave: 0, mk: 3, maps: 3, hold: 1 }); expect(a.pre).toBeCloseTo(1.2, 5); expect(a.f).toBeCloseTo(0.8, 5); expect(a.heap).toBe(2048);
    expect(b).toMatchObject({ dt: 14, cb: 2, menu: 0, tex: 0, dsave: 0, mk: 0, maps: 0, heap: 0 }); expect(Number.isNaN(b.pre)).toBe(true);
    // a running total that went down (a reset) is no negative count
    ring.frame(42, { ...cum, menu: 0 }); expect(ring.records()[2].menu).toBe(0);
  });
  it('an interval over 30 ms keeps that frame and 3 before and 3 after as a window; slow frames close together share one; the newest 40 windows are kept', () => {
    expect(RING_SLOW_MS).toBe(30);
    const ring = createFrameRing(); ring.frame(0, {});
    feed(ring, 100, { t0: 0, slow: { 49: 35, 52: 50, 80: 31, 30: 30 } }); // frame 30 is exactly 30 ms: not slow
    const w = ring.allWindows();
    expect(ring.slowCount).toBe(3); expect(w).toHaveLength(2);
    expect(w[0].map(r => r.n)).toEqual([46, 47, 48, 49, 50, 51, 52, 53, 54, 55]); // 49 and 52 share a window: 3 before the first to 3 after the last
    expect(w[1].map(r => r.n)).toEqual([77, 78, 79, 80, 81, 82, 83]);
    expect(w[0][3].dt).toBe(35); expect(w[0][6].dt).toBe(50);
    // the window is complete once its frames have come; before that it is reported as far as it goes
    const r2 = createFrameRing(); r2.frame(0, {}); feed(r2, 10, { t0: 0, slow: { 8: 40 } });
    expect(r2.windows).toHaveLength(0); expect(r2.allWindows()[0].map(r => r.n)).toEqual([5, 6, 7, 8, 9]);
    const r3 = createFrameRing({ maxWindows: 3 }); r3.frame(0, {}); const slow = {}; for (let k = 0; k < 6; k++) slow[20 + k * 20] = 40;
    feed(r3, 150, { t0: 0, slow }); expect(r3.windows).toHaveLength(3); expect(r3.windowsDropped).toBe(3); expect(r3.allWindows()[2][3].n).toBe(120);
  });
  it('the heap drop (a garbage collection) is the KB the heap shrank by; none without a heap reading', () => {
    const ring = createFrameRing(); ring.frame(0, { heap: 10e6 }); ring.frame(14, { heap: 12e6 }); ring.frame(28, { heap: 9e6 }); ring.frame(42, { heap: 0 }); ring.frame(56, { heap: 0 });
    expect(ring.records().map(r => Math.round(r.heap))).toEqual([0, 2930, 0, 0]);
  });
  it('the text lists the windows with the slow frame marked, the counts and the long tasks that overlap them', () => {
    const lt = { supported: true, tasks: [{ s: 1200, d: 80 }], overlap: (a, b) => Math.max(0, Math.min(b, 1280) - Math.max(a, 1200)) };
    const ring = createFrameRing(); ring.frame(1000, {}); const cum = { menu: 0 };
    feed(ring, 30, { t0: 1000, slow: { 10: 130 }, c: i => { if (i === 10) cum.menu++; return { ...cum, f: i > 11 ? 0.8 : 1, per: i > 12 ? 0.5 : 1, hold: i > 9 ? 1 : 0 }; } });
    const L = ringReportLines(ring, { longTasks: lt, sinceMs: 1000 });
    expect(L[0]).toContain('frame ring: the last 30 of 30 frames'); expect(L[0]).toContain('1 intervals over 30 ms'); expect(L[0]).toContain('long tasks 1 seen');
    const row = L.find(l => /^\s+10 /.test(l)); expect(row).toBeTruthy(); expect(row).toContain('130.0'); expect(row).toContain('*'); expect(row.trim().split(/\s+/)).toContain('69');
    const heads = L.find(l => l.includes('menu') && l.includes('flag')); expect(heads).toBeTruthy();
    expect(row).toMatch(/\*H\s*$/); // the slow frame, and the hands holding started in it
    expect(L.find(l => /^\s+12 /.test(l))).toMatch(/F\s*$/); expect(L.find(l => /^\s+13 /.test(l))).toMatch(/P\s*$/); // the render scale changed at 12, the periphery scale at 13
    expect(L.filter(l => /^\s+\d+ /.test(l))).toHaveLength(7);
    const none = ringReportLines(createFrameRing(), {}); expect(none[0]).toContain('0 of 0 frames'); expect(none.some(l => l.includes('0 window(s)'))).toBe(true);
  });
  it('the long-task observer collects the tasks it is told of (the newest 300) and sums their overlap with an interval; unsupported = no tasks, no throw', () => {
    let cb = null; class PO { constructor(f) { cb = f; } observe() {} disconnect() {} }
    const w = createLongTaskWatcher({ PO }); expect(w.start()).toBe(true); expect(w.supported).toBe(true);
    cb({ getEntries: () => [{ startTime: 100, duration: 60 }, { startTime: 300, duration: 90 }] });
    expect(w.overlap(0, 1000)).toBe(150); expect(w.overlap(120, 330)).toBe(40 + 30); expect(w.overlap(500, 600)).toBe(0);
    for (let i = 0; i < 400; i++) cb({ getEntries: () => [{ startTime: 1000 + i, duration: 51 }] }); expect(w.tasks).toHaveLength(300);
    w.stop();
    const bad = createLongTaskWatcher({ PO: class { constructor() { throw new Error('no'); } } }); expect(bad.start()).toBe(false); expect(bad.supported).toBe(false); expect(bad.overlap(0, 10)).toBe(0);
    expect(readHeapBytes()).toBeGreaterThanOrEqual(0);
  });
});

// ---- the switches: the default is what the view always did ----
describe('the isolation switches', () => {
  it('the default state is the view as it always was: timestamps on, no frame marker, heartbeat and 5 s saves on, menu not touched', () => {
    expect(ISO_MODES.default).toEqual({ timers: true, span: false, diagSave: true, perfSave: true, menu: null });
    const iso = createIsolation(); expect(iso.state).toEqual({ mode: 'default', ...ISO_MODES.default });
    expect(GX_SWITCH).toEqual({ timers: true });
  });
  it('the runs: std = menu closed with the frame marker; as is = menu open, nothing off; isolated = all four off and the menu closed; reset goes back; an unknown mode is the default', () => {
    const seen = []; const iso = createIsolation({ onChange: s => seen.push(s.mode) });
    expect(iso.apply('std')).toMatchObject({ timers: true, span: true, diagSave: true, perfSave: true, menu: 'closed' });
    expect(iso.apply('asis')).toMatchObject({ timers: true, span: false, diagSave: true, perfSave: true, menu: 'open' });
    expect(iso.apply('iso')).toMatchObject({ timers: false, span: false, diagSave: false, perfSave: false, menu: 'closed' });
    iso.reset(); expect(iso.state).toEqual({ mode: 'default', ...ISO_MODES.default }); iso.apply('nope'); expect(iso.state.mode).toBe('default'); expect(seen).toEqual(['std', 'asis', 'iso', 'default', 'default']);
  });
  it('the diagnostics heartbeat writes to the store once a second as always; with saveOn false it does not (and the count of writes is readable)', () => {
    const mk = () => { const ls = []; const cbs = []; const s = { ended: 0, inputSources: [], requestAnimationFrame(cb) { cbs.push(cb); return 1; }, end() { return Promise.resolve(); }, frame() { const l = cbs.splice(0); for (const cb of l) cb(0, { getViewerPose: () => null }); } }; return { s, ls }; };
    for (const [off, writes] of [[false, 3], [true, 0]]) {
      const { s } = mk(); let t = 0; const sets = []; const store = { setItem: (k) => sets.push(k) };
      const diag = createGxDiag({ store, now: () => t }); const st = { bound: true, rendered: 0 };
      const hb = startGxHeartbeat({ session: s, diag, state: () => st, now: () => t, stallFrames: 1e9, ...(off ? { saveOn: () => false } : {}) });
      const base = sets.length;
      for (let i = 1; i <= 3; i++) { t = i * 1000; s.frame(); }
      expect(sets.length - base).toBe(writes); expect(diag.saves).toBe(base + writes); hb.stop();
    }
  });
  it('the performance record: its 5 s mirror is paused by setSaveOff (a forced save still writes); the sections go into the report after its header; ext goes into the mirror', () => {
    let clock = 0; const sets = []; const store = { setItem: (k, v) => sets.push(JSON.parse(v)) };
    const log = createPerfLog({ now: () => clock, store }); const saved = () => log.saves;
    clock = 1000; log.row({}, clock); expect(saved()).toBe(0); clock = 5000; log.row({}, clock); expect(saved()).toBe(1); // saved after 5 s as always
    log.setSaveOff(true); clock = 12000; log.row({}, clock); clock = 20000; log.row({}, clock); expect(saved()).toBe(1);
    log.flush(); expect(saved()).toBe(2);
    log.setSaveOff(false); clock = 26000; log.row({}, clock); expect(saved()).toBe(3);
    log.ext.bench = [{ mode: 'std' }]; log.flush(); expect(sets.at(-1).ext).toEqual({ bench: [{ mode: 'std' }] }); expect(sets[0].ext).toBeUndefined();
    log.sections.push(['SECTION A', 'second line'], () => ['SECTION B'], () => { throw new Error('x'); }, () => null);
    const textFail = perfReport({ ...log, sections: [() => { throw new Error('boom'); }] }, {}).split('\n'); expect(textFail.some(l => l.startsWith('-- section failed: boom'))).toBe(true); // a section that throws is said so, not dropped
    const text = perfReport(log, { build: '1' }).split('\n');
    const head = text.findIndex(l => l.startsWith('VR performance log')), sum = text.findIndex(l => l.startsWith('-- summary'));
    expect(text.slice(head, sum)).toEqual(expect.arrayContaining(['SECTION A', 'second line', 'SECTION B'])); expect(sum).toBeGreaterThan(text.indexOf('SECTION B'));
  });
  it('tapPerfLog hands the add / sample calls to the bench and still records them; the returned function takes the tap off', () => {
    const log = createPerfLog({ now: () => 0, store: null }), got = [];
    const off = tapPerfLog(log, { add: (k, ms, n) => got.push(['add', k, ms, n]), sample: (k, ms) => got.push(['sample', k, ms]) });
    log.add('vol', 6, 2); log.sample('span', 4); const row = log.row({}, 1000);
    expect(got).toEqual([['add', 'vol', 6, 2], ['sample', 'span', 4]]); expect(row.vol).toBe(3); expect(row.span).toBe(4);
    off(); log.add('vol', 1); expect(got).toHaveLength(2);
    const bad = createPerfLog({ now: () => 0, store: null }); tapPerfLog(bad, { add: () => { throw new Error('tap'); } }); expect(() => bad.add('vol', 1)).not.toThrow();
  });
});

// ---- the volume pass's timestamps (vr-wgpu.js) with a mock device ----
const withGpu = fn => async () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
  try { await fn(); } finally { vi.unstubAllGlobals(); GX_SWITCH.timers = true; }
};
const settle = () => new Promise(r => setTimeout(r, 0));
const mockGpu = () => {
  const log = { passes: [], maps: 0 };
  const device = { features: new Set(['timestamp-query']), limits: {} };
  device.queue = { writeBuffer() {}, writeTexture() {}, submit() {} }; device.createQuerySet = d => ({ d, destroy() {} });
  device.createBuffer = d => { const b = { d, destroy() {}, mapAsync: async () => { log.maps++; }, getMappedRange: () => (d.size > 16 ? new Uint32Array(d.size / 4).buffer : new BigUint64Array([1_000_000n, 4_000_000n]).buffer), unmap() {} }; return b; };
  device.createTexture = d => ({ d, destroy() {}, createView: () => ({}) });
  device.createSampler = () => ({}); device.createBindGroupLayout = () => ({}); device.createPipelineLayout = () => ({}); device.createShaderModule = () => ({});
  device.createComputePipeline = d => ({ d }); device.createComputePipelineAsync = async d => ({ d }); device.createRenderPipeline = d => ({ d }); device.createRenderPipelineAsync = async d => ({ d }); device.createBindGroup = d => ({ d });
  device.createCommandEncoder = () => ({ beginRenderPass: d => { log.passes.push(d); return { setPipeline() {}, setVertexBuffer() {}, setBindGroup() {}, setViewport() {}, setScissorRect() {}, draw() {}, end() {} }; }, beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), resolveQuerySet() {}, copyBufferToBuffer() {}, clearBuffer() {}, copyTextureToBuffer() {}, finish: () => ({}) });
  return { device, log };
};
const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
const frameU = () => ({ distInCls: { value: 0 }, useCls: { value: 0 }, diag: { value: 0 }, planeCount: { value: 0 } });
const drawOne = r => r.draw({ u: frameU(), cams: [eyeCam(320, 240), eyeCam(320, 240)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false } });
describe('GX_SWITCH.timers (the volume pass\'s GPU timestamps)', () => {
  it('on (the default): the low pass has a timestamp slot and its result is read back (mapAsync, counted in counts.maps); off: no slot, no read-back, and the frame marker makes no sample', withGpu(async () => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    expect(GX_SWITCH.timers).toBe(true); expect(r.volume.counts.maps).toBe(0);
    drawOne(r); r.volume.markFrame(false);
    expect(log.passes.at(-1).timestampWrites).toBeTruthy(); expect(r.volume.counts.maps).toBe(1); await settle(); expect(r.volume.takeGpuMs()).toMatchObject({ n: 1 });
    GX_SWITCH.timers = false; const n = log.passes.length, m = r.volume.counts.maps;
    drawOne(r); r.volume.markFrame(false);
    expect(log.passes.length).toBeGreaterThan(n); expect(log.passes.at(-1).timestampWrites).toBeUndefined(); expect(r.volume.counts.maps).toBe(m); await settle(); expect(r.volume.takeGpuMs()).toBe(null);
    GX_SWITCH.timers = true; drawOne(r); expect(log.passes.at(-1).timestampWrites).toBeTruthy(); r.dispose();
  }));
});

// ---- the hooks in vr-view.js: the defaults are the old behaviour ----
describe('the hooks in vr-view.js', () => {
  it('the switches are read where the work happens, and the default (ISO.state at its default) leaves each as it was', () => {
    expect(vrSrc).toContain("const ISO=createIsolation();");
    expect(vrSrc).toContain("saveOn:()=>ISO.state.diagSave"); // the heartbeat's save
    expect(vrSrc).toContain("markFrame?.(gxMeasure()||ISO.state.span)"); // the frame marker (span): off unless the bench asks
    expect(vrSrc).toContain("if(!timerExt||!ISO.state.timers||pending.length>12){fn();return}"); // the WebGL timer queries
    expect(vrSrc).toContain("GX_SWITCH.timers=!!st.timers;perfLog?.setSaveOff(!st.perfSave)"); // the volume timestamps and the 5 s mirror
    expect(vrSrc).toContain("bench:benchOn||cmpBench.active"); // no hold scale while the bench runs
    expect(vrSrc).toContain("gxRec.phase!=='idle'||bench.active||anBench.active||cmpBench.active||!mesh||!material)return; // not together"); // the breakdown recording does not start inside the bench (its button is on the tab the as-is run has open)
  });
  it('the comparison bench is its own thing: not bench.active (the old benchmark\'s cap / guards / periphery rules do not apply), no section plane through bench.noSection, 100 %, auto off, menu closed', () => {
    const blk = vrSrc.slice(vrSrc.indexOf('const cmpBench=createCompareBench('), vrSrc.indexOf(' const applyQuality=()=>{'));
    expect(blk).toContain('bench.noSection=true'); expect(blk).toContain('settings.vres=1;settings.foveation=2;applyQuality()'); expect(blk).not.toContain('bench.active=true');
    expect(blk).toContain("m==='open'"); expect(blk).toContain('setMenuOpen(false)'); expect(blk).toContain('bringVolumeFront()');
    expect(vrSrc).toContain("session.addEventListener('end',()=>cmpBench.abort(),{once:true})");
    expect(vrSrc).toContain('if(bench.active||cmpBench.active||!mesh||gxRec.phase===\'prep\'||gxRec.on)return;'); // the old benchmark does not start inside it
  });
  it('the ring is fed at the start of each frame callback, closed at its end, and the report sections are registered with the perf log', () => {
    expect(vrSrc).toContain('benchRing.frame(xrTs||performance.now(),c);cmpBench.frame(xrTs||performance.now())');
    expect(vrSrc).toContain('benchRing.callback(performance.now()-fa0,benchPre)');
    expect(vrSrc).toContain('perfLog.sections.push(()=>benchReportLines(benchAll');
    expect(vrSrc).toContain('cmpBench.tick(performance.now())');
    expect(vrSrc).toContain('BENCH_COUNT.menu++;BENCH_COUNT.tex++');
    expect(BENCH_COUNT).toEqual({ menu: expect.any(Number), tex: expect.any(Number) });
  });
  it('both buttons are on the detail tab (4), bilingual, and start the two plans', () => {
    expect(vrSrc).toContain("比較ベンチ（約3分）':'Compare bench (3 min)'"); expect(vrSrc).toContain("比較ベンチ＋切り分け（約6分）':'Compare bench + isolation (6 min)'");
    expect(vrSrc).toContain("()=>go('cmp')"); expect(vrSrc).toContain("()=>go('iso')");
    const tab4 = vrSrc.slice(vrSrc.indexOf('}else if(ui.tab===4){'), vrSrc.indexOf('  return w;\n });\n if(!gx)await renderer.xr.setSession'));
    expect(tab4).toContain("go('cmp')");
  });
});
