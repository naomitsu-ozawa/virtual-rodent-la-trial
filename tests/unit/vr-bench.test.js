// The comparison bench, the frame ring and the isolation switches (docs/vr-bench.js) and their wiring: the scripted segments (two scenes x a violent and a slow period) and their per-segment numbers (drops = g2 + g3,
// the 95 / 99 % points, the longest interval, span / vol, what really came out: covered px, scale, the volume's movement, the head's), the pose as a function of time alone, the 2000-frame ring and the windows around
// slow frames, the report text, the switches (default = what the view always did), and the hooks in vr-wgpu.js / vr-perf-log.js / vr-view.js.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREEG from 'three/webgpu';
import {
  BENCH_SCENES, BENCH_SEGMENTS, BENCH_SEGMENT_MS, BENCH_MOTION, BENCH_SPEED, BENCH_HOLDER_SCALE, BENCH_DISCARD_MS, BENCH_PLANS, ISO_MODES, RING_SIZE, RING_HEAD, RING_SLOW_MS, BENCH_COUNT, quantile, statsOf,
  benchPose, benchWarp, benchSegmentsOf, quatYXZ, quatAngleDeg,
  createBenchScript, createFrameRing, createLongTaskWatcher, createIsolation, createCompareBench, tapPerfLog, benchReportLines, ringReportLines, leftoverReportLines, readHeapBytes, RING_SAMPLES,
} from '../../docs/vr-bench.js';
import { MAX_LONG_M, NORM_LONG } from '../../docs/vr-real-scale.js';
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

// ---- the pose: a function of time alone ----
const HEAD = { x: 0.3, y: 1.6, z: -0.2, yaw: 0 };
const POSE_SEGS = sceneId => benchSegmentsOf(sceneId);
const sceneOf = id => BENCH_SCENES.find(s => s.id === id);
// what the performance record counts per second (vr-perf-log.js move: the sum of the per-frame world movement, cm and deg, over the second): the pose sampled at 72 Hz from tMs0 for `seconds`
const speeds = (sceneId, tMs0, seconds, ref = HEAD) => {
  const segs = POSE_SEGS(sceneId), sc = sceneOf(sceneId), mv = [], mvr = [], per = 72; let prev = benchPose(sc, segs, tMs0, ref);
  for (let s = 0; s < seconds; s++) {
    let cm = 0, deg = 0;
    for (let k = 1; k <= per; k++) { const p = benchPose(sc, segs, tMs0 + (s * per + k) * 1000 / per, ref); cm += Math.hypot(p.pos[0] - prev.pos[0], p.pos[1] - prev.pos[1], p.pos[2] - prev.pos[2]) * 100; deg += quatAngleDeg(prev.quat, p.quat); prev = p; }
    mv.push(cm); mvr.push(deg);
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  return { mv, mvr, mvMed: med(mv), mvrMed: med(mvr), mvMax: Math.max(...mv), mvrMax: Math.max(...mvr), mvMin: Math.min(...mv), mvrMin: Math.min(...mvr) };
};
describe('the bench pose: a function of time alone, the body at its largest size, moving from the first frame', () => {
  it('the segments: two scenes (hold 0.45 m +- 0.12 m, near 0.30 m +- 0.08 m), each with a violent and a slow period, 45 s each = 180 s; the first 2 s of each are left out; the first segment is a moving one', () => {
    expect(BENCH_SCENES.map(s => [s.id, s.dist, s.distAmp])).toEqual([['hold', 0.45, 0.12], ['near', 0.30, 0.08]]);
    expect(BENCH_SEGMENTS.map(s => [s.id, s.scene, s.period, s.ms / 1000])).toEqual([['hold/fast', 'hold', 'fast', 45], ['hold/slow', 'hold', 'slow', 45], ['near/fast', 'near', 'fast', 45], ['near/slow', 'near', 'slow', 45]]);
    expect(BENCH_SEGMENTS.reduce((s, x) => s + x.ms, 0)).toBe(180000); expect(BENCH_SEGMENT_MS).toBe(45000); expect(BENCH_DISCARD_MS).toBe(2000);
    expect(BENCH_PLANS).toEqual({ cmp: ['std'], iso: ['asis', 'iso'] });
    expect(BENCH_MOTION).toMatchObject({ yawDegPerS: 150, pitchDeg: 45, pitchHz: 0.4, rollDeg: 30, rollHz: 0.3, lateralM: 0.12, lateralHz: 0.35, verticalM: 0.06, verticalHz: 0.5, distHz: 0.25 });
    expect(BENCH_SPEED.fast).toEqual({ rot: 1, trans: 1 }); expect(BENCH_SPEED.slow.rot).toBeLessThan(1); expect(BENCH_SPEED.slow.trans).toBeLessThan(1);
    for (const sc of BENCH_SCENES) expect(benchSegmentsOf(sc.id).map(s => s.period)).toEqual(['fast', 'slow']); // both periods in both scenes
  });
  it('the size is the largest the view allows: the displayed longest side is MAX_LONG_M (0.30 m), at every moment', () => {
    expect(BENCH_HOLDER_SCALE).toBe(MAX_LONG_M / NORM_LONG); expect(BENCH_HOLDER_SCALE * NORM_LONG).toBeCloseTo(0.30, 12);
    for (const sc of BENCH_SCENES) for (const t of [0, 1234, 44999, 45000, 70000, 89999]) expect(benchPose(sc, POSE_SEGS(sc.id), t, HEAD).scale).toBe(BENCH_HOLDER_SCALE);
  });
  it('the same time gives the same pose, whatever was asked before (no frame counts: the WebGL and the WebGPU view move alike)', () => {
    const sc = sceneOf('hold'), segs = POSE_SEGS('hold');
    const a = benchPose(sc, segs, 12345, HEAD); for (let i = 0; i < 50; i++) benchPose(sc, segs, i * 777, HEAD); const b = benchPose(sc, segs, 12345, HEAD);
    expect(b).toEqual(a);
    expect(benchPose(sc, segs, 12345, { ...HEAD, x: 5 }).pos[0]).toBeCloseTo(a.pos[0] + 4.7, 12); // only the head's reference moves it
    expect(benchPose(sc, segs, 12345, HEAD).quat).toEqual(a.quat);
  });
  it('it moves from the very first frame on: every one of the first frames at 72 Hz is somewhere else and turned, in a violent and in a slow segment, in both scenes', () => {
    for (const sc of BENCH_SCENES) for (const t0 of [0, 45000]) {
      const segs = POSE_SEGS(sc.id); let prev = benchPose(sc, segs, t0, HEAD);
      for (let k = 1; k <= 10; k++) {
        const p = benchPose(sc, segs, t0 + k * BUDGET, HEAD);
        expect(Math.hypot(p.pos[0] - prev.pos[0], p.pos[1] - prev.pos[1], p.pos[2] - prev.pos[2])).toBeGreaterThan(3e-4); expect(quatAngleDeg(prev.quat, p.quat)).toBeGreaterThan(0.2); prev = p;
      }
    }
  });
  it('it is held in front of the head: the distance along the head\'s heading swings about the scene\'s middle by its amplitude (0.45 +- 0.12, 0.30 +- 0.08), for any heading', () => {
    for (const yaw of [0, 1.0, -2.2]) for (const sc of BENCH_SCENES) {
      const segs = POSE_SEGS(sc.id), ref = { ...HEAD, yaw }, fwd = [-Math.sin(yaw), 0, -Math.cos(yaw)]; let lo = 9, hi = -9;
      for (let t = 0; t < 90000; t += 97) { const p = benchPose(sc, segs, t, ref), d = (p.pos[0] - ref.x) * fwd[0] + (p.pos[2] - ref.z) * fwd[2]; lo = Math.min(lo, d); hi = Math.max(hi, d); expect(Math.abs(p.pos[1] - ref.y)).toBeLessThanOrEqual(BENCH_MOTION.verticalM + 1e-9); }
      expect(lo).toBeGreaterThanOrEqual(sc.dist - sc.distAmp - 1e-9); expect(hi).toBeLessThanOrEqual(sc.dist + sc.distAmp + 1e-9); expect(lo).toBeLessThan(sc.dist - sc.distAmp + 0.01); expect(hi).toBeGreaterThan(sc.dist + sc.distAmp - 0.01);
    }
  });
  it('the turn is 150 deg/s about the vertical axis in the violent period (and the tilts stay within 45 / 30 deg); the Euler quaternion is the product yaw x pitch x roll', () => {
    const sc = sceneOf('hold'), segs = POSE_SEGS('hold'), q0 = benchPose(sc, segs, 0, HEAD).quat;
    const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    const ax = (x, y, z, a) => [x * Math.sin(a / 2), y * Math.sin(a / 2), z * Math.sin(a / 2), Math.cos(a / 2)];
    const e = quatYXZ(0.7, -0.4, 0.3), prod = mul(mul(ax(0, 1, 0, 0.7), ax(1, 0, 0, -0.4)), ax(0, 0, 1, 0.3));
    for (let i = 0; i < 4; i++) expect(e[i]).toBeCloseTo(prod[i], 12);
    expect(Math.hypot(...q0)).toBeCloseTo(1, 12);
    // over 4 s the heading advanced by 600 deg: the yaw part of the quaternion (pitch and roll at 4 s are what they are, so compare the tilt-free moments: 2.5 s = a whole period of the 0.4 Hz tilt and 0.3 Hz is 0.75 period, so use 10 s = whole periods of both)
    const q10 = benchPose(sc, segs, 10000, HEAD).quat, qy = quatYXZ(10 * 150 * Math.PI / 180, 0, 0); // pitch 0.4 Hz x 10 s = 4 periods, roll 0.3 Hz x 10 s = 3 periods: both are 0 again
    for (let i = 0; i < 4; i++) expect(q10[i]).toBeCloseTo(qy[i], 9);
  });
  it('the violent period moves at the recorded user speeds and the slow period at their slow side; both stay in their ranges in both scenes, second by second', () => {
    // the user's recorded seconds with a hand on the volume: mv median 20 cm/s, 75 % point 34 / 90 % point 50; mvr median 101 deg/s, 75 % 156, 90 % 191; the slow side (25 % point): mv 12 cm/s, mvr 58 deg/s
    for (const sc of BENCH_SCENES) {
      const fast = speeds(sc.id, 0, 40), slow = speeds(sc.id, BENCH_SEGMENT_MS, 40);
      expect(fast.mvMed).toBeGreaterThan(20); expect(fast.mvMed).toBeLessThan(32); expect(fast.mvrMed).toBeGreaterThan(165); expect(fast.mvrMed).toBeLessThan(195);
      expect(fast.mvMin).toBeGreaterThan(12); expect(fast.mvMax).toBeLessThan(50); expect(fast.mvrMin).toBeGreaterThan(150); expect(fast.mvrMax).toBeLessThan(215); // no still second, no second beyond the user's top tenth
      expect(slow.mvMed).toBeGreaterThan(9); expect(slow.mvMed).toBeLessThan(15); expect(slow.mvrMed).toBeGreaterThan(48); expect(slow.mvrMed).toBeLessThan(68);
      expect(slow.mvMax).toBeLessThan(22); expect(slow.mvrMax).toBeLessThan(90);
      expect(slow.mvMed).toBeLessThan(fast.mvMed / 1.8); expect(slow.mvrMed).toBeLessThan(fast.mvrMed / 2.5); // clearly different periods
    }
  });
  it('the clock is continuous over the change of period (the speed changes, the pose does not jump) and the second period goes on with the scene\'s own clock', () => {
    const sc = sceneOf('near'), segs = POSE_SEGS('near');
    const a = benchPose(sc, segs, BENCH_SEGMENT_MS - 1, HEAD), b = benchPose(sc, segs, BENCH_SEGMENT_MS + 1, HEAD);
    expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])).toBeLessThan(2e-3); expect(quatAngleDeg(a.quat, b.quat)).toBeLessThan(1);
    expect(benchWarp(segs, 45000, 'rot')).toBeCloseTo(45, 9); expect(benchWarp(segs, 90000, 'rot')).toBeCloseTo(45 + 45 * BENCH_SPEED.slow.rot, 9); expect(benchWarp(segs, 60000, 'trans')).toBeCloseTo(45 + 15 * BENCH_SPEED.slow.trans, 9);
    expect(benchWarp([], 1000, 'rot')).toBeCloseTo(1, 12); expect(benchWarp(segs, -5, 'rot')).toBe(0);
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
const seg = (id, ms) => ({ id, scene: id.split('/')[0], period: id.split('/')[1] || 'fast', ms });
describe('the bench script: segments, the left-out start, and the per-segment numbers', () => {
  it('goes through the four segments in order at 45 s of the clock each, settles 2 s in each, and ends', () => {
    const sc = createBenchScript({ budgetMs: BUDGET });
    let st = sc.start(1000), t = 1000, lastIdx = 0, lastPhase = st.phase;
    expect(st.phase).toBe('settle'); expect(st.seg.id).toBe('hold/fast'); // it starts at once: the first segment is a moving one
    const changes = [];
    while (!sc.done && t < 1000 + 190000) {
      t += 13; st = sc.tick(t);
      if (st.idx !== lastIdx || st.phase !== lastPhase) { changes.push([st.idx, st.phase, Math.round((t - 1000) / 1000)]); lastIdx = st.idx; lastPhase = st.phase; }
    }
    // measure starts 2 s into each segment; the next segment starts when the previous one's time is over
    expect(changes.map(c => c.slice(0, 2))).toEqual([[0, 'measure'], [1, 'settle'], [1, 'measure'], [2, 'settle'], [2, 'measure'], [3, 'settle'], [3, 'measure'], [3, 'done']]);
    expect(changes.map(c => c[2])).toEqual([2, 45, 47, 90, 92, 135, 137, 180]);
    expect(sc.done).toBe(true);
  });
  it('counts only the measured part of a segment: drops = intervals of 1.5 periods or more (g2 + g3), the 95 / 99 % points and the longest interval; the settle and the segment change are not in it', () => {
    const segments = [seg('a/fast', 10000), seg('b/slow', 8000)];
    const sc = createBenchScript({ segments, budgetMs: BUDGET });
    sc.start(0);
    // segment a: 2 s settle with a 100 ms hitch (not counted), then 8 s with one frame of 25 ms (g2), one of 45 ms (g3), one of 70 ms (g3)
    const slowA = [{ at: 1000, dt: 100 }, { at: 4000, dt: 25 }, { at: 6000, dt: 45 }, { at: 7000, dt: 70 }];
    const t1 = drive(sc, 0, 10, { slow: slowA });
    const t2 = drive(sc, t1, 8, { slow: [{ at: 3000, dt: 30 }] });
    expect(sc.done || sc.tick(t2 + 20).done).toBe(true);
    const [a, b] = sc.summary();
    expect(a.reached && b.reached).toBe(true); expect([a.scene, a.period, b.scene, b.period]).toEqual(['a', 'fast', 'b', 'slow']);
    expect([a.g2, a.g3]).toEqual([1, 2]); expect(a.drop).toBeCloseTo(3 / a.frames, 10);
    expect(a.max).toBe(70); expect(a.p99).toBeLessThan(15);
    expect(a.frames).toBeGreaterThan(8 * 72 - 14); expect(a.frames).toBeLessThan(8 * 72 + 6); // 8 s of 72 Hz frames (the hitch in the first 2 s is not among them)
    expect([b.g2, b.g3]).toEqual([1, 0]); expect(b.max).toBe(30);
    expect(a.measuredMs).toBeGreaterThan(7900); expect(a.measuredMs).toBeLessThanOrEqual(8100);
    // p95: with 3 slow frames in about 580 the 95 % point is still a normal frame
    expect(a.p95).toBeLessThan(15);
  });
  it('the 95 / 99 % points and the longest interval are the nearest-rank values of the segment\'s intervals', () => {
    const sc = createBenchScript({ segments: [seg('a/fast', 60000)], budgetMs: 10 }); sc.start(0); sc.tick(2500);
    let t = 3000; sc.frame(t);
    const dts = []; for (let i = 0; i < 200; i++) dts.push(i < 3 ? 100 + i : i < 15 ? 20 : 10); // 3 of 200 at 100+ ms (1.5 %), 12 at 20 ms (6 %), the rest 10 ms
    for (const d of dts) { t += d; sc.frame(t); }
    const s = sc.summary()[0];
    expect(s.frames).toBe(200); expect(s.max).toBe(102); expect(s.p99).toBe(100); // the 198th of 200 sorted values: the third slowest
    expect(s.p95).toBe(20); expect([s.g2, s.g3]).toEqual([12, 3]); expect(s.drop).toBeCloseTo(15 / 200, 10);
  });
  it('a 1.5-period interval is a drop (the same rule as the performance record), anything shorter is not', () => {
    const sc = createBenchScript({ segments: [seg('a/fast', 6000)], budgetMs: 10 });
    sc.start(0); sc.tick(2500);
    sc.frame(2500); sc.frame(2510); sc.frame(2524.9); sc.frame(2540); sc.frame(2565); // 10, 14.9, 15.1, 25: no, no, g2, g3
    const s = sc.summary()[0];
    expect([s.frames, s.g1, s.g2, s.g3]).toEqual([4, 2, 1, 1]);
  });
  it('span / vol / main samples and what really came out (covered px, scale, data cap) belong to the measured part of the segment they arrive in; cov has its median and the value the top tenth reached', () => {
    const sc = createBenchScript({ segments: [seg('a/fast', 6000), seg('a/slow', 6000)], budgetMs: BUDGET });
    sc.start(0);
    sc.sample('vol', 99); sc.observe(1, 1, 1); // settle: ignored
    sc.tick(2500); for (let i = 1; i <= 10; i++) { sc.sample('vol', i); sc.sample('span', i + 2); sc.observe(1e6 + i, 0.5 + i / 100, 0.7 + i / 100); }
    sc.sample('nope', 1); sc.sample('vol', NaN);
    sc.tick(6100); sc.sample('vol', 50); // the next segment's settle
    sc.tick(8200); sc.sample('vol', 7); sc.sample('main', 4);
    const [a, b] = sc.summary();
    expect(a.vol).toMatchObject({ n: 10, med: 5.5, p95: 10, max: 10 }); expect(a.span).toMatchObject({ n: 10, med: 7.5 });
    expect(a.cov).toMatchObject({ med: 1000006, p90: 1000009, min: 1000001, max: 1000010 }); expect(a.f.min).toBe(0.51); expect(a.cap).toEqual({ med: 0.755, min: 0.71 }); // the 10th of 10 sorted values is the top tenth's start
    expect(b.vol).toMatchObject({ n: 1, med: 7 }); expect(b.main).toMatchObject({ n: 1, med: 4 }); expect(b.span).toBe(null); expect(b.cov).toBe(null);
  });
  it('the volume\'s movement (mv cm/s, mvr deg/s) is summed per second of the measured part the way the performance record does, and the head\'s path is summed over the measured frames only', () => {
    const sc = createBenchScript({ segments: [seg('a/fast', 12000)], budgetMs: BUDGET }); sc.start(0);
    let k = 0, hx = 0;
    const t = drive(sc, 0, 11.5, { onFrame: (tt, i) => { k = i; const sec = Math.floor(tt / 1000); sc.move(0.5, 2 + sec * 0.1); hx += 0.001; sc.head({ x: hx, y: 1.6, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }); } });
    sc.tick(t + 1000);
    const s = sc.summary()[0];
    expect(k).toBeGreaterThan(800); expect(s.mv.n).toBeGreaterThanOrEqual(8); expect(s.mv.n).toBeLessThanOrEqual(10); // 9.5 s measured: whole seconds
    expect(s.mv.med).toBeGreaterThan(35); expect(s.mv.med).toBeLessThan(37); expect(s.mv.p90).toBeLessThan(37); // 0.5 cm per frame, 72 frames a second
    expect(s.mvr.med).toBeGreaterThan(2 * 72); expect(s.mvr.p90).toBeGreaterThanOrEqual(s.mvr.med); expect(s.mvr.p90).toBeLessThan(5 * 72);
    expect(s.head.deg).toBe(0); expect(s.head.cm).toBeGreaterThan(0.1 * 9.5 * 72 * 0.9); expect(s.head.cm).toBeLessThan(0.1 * 9.5 * 72 * 1.1); // 1 mm a frame over the measured frames (the 2 s settle is not in it)
    // the host hands ONE object every frame and changes it in place (vr-view.js read()): the path is still the sum of the steps
    const one = createBenchScript({ segments: [seg('a/fast', 8000)], budgetMs: BUDGET }), h = { x: 0, y: 1.6, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }; one.start(0);
    drive(one, 0, 7.5, { onFrame: () => { h.x += 0.001; one.head(h); } });
    expect(one.summary()[0].head.cm).toBeGreaterThan(0.1 * 5.5 * 72 * 0.9); expect(one.summary()[0].head.cm).toBeLessThan(0.1 * 5.5 * 72 * 1.1 + 1);
    const none = createBenchScript({ segments: [seg('a/fast', 6000)] }); none.start(0); none.move(5, 5); none.head({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }); // not measuring: nothing kept
    expect(none.summary()[0].mv).toBe(null); expect(none.summary()[0].head).toBe(null);
  });
  it('an aborted script keeps the segment in progress as a partial one and the segments after it as not reached', () => {
    const sc = createBenchScript({ budgetMs: BUDGET }); sc.start(0);
    let t = drive(sc, 0, 50); sc.abort(t);
    const s = sc.summary();
    expect(s.map(x => x.reached)).toEqual([true, true, false, false]); expect(s[1].partial).toBe(true); expect(s[0].partial).toBe(false);
    expect(s[0].frames).toBeGreaterThan(42 * 72 - 20); // 43 s measured of the 45 s segment
    expect(s[1].measuredMs).toBeGreaterThan(2000); expect(sc.done).toBe(true);
    t += 100; sc.frame(t); expect(sc.summary()[1].frames).toBe(s[1].frames); // nothing counted after the end
  });
});

// ---- the controller, with a fake view ----
const fakeEnv = (over = {}) => {
  const log = { enter: 0, leave: [], menu: [], iso: [], refs: 0, settings: 0, poses: [], done: null, progress: 0, order: [] };
  const env = {
    now: () => 0, budgetMs: () => BUDGET, can: () => '', enter: () => { log.enter++; log.order.push('enter'); }, leave: ok => { log.leave.push(ok); },
    menu: m => log.menu.push(m), iso: st => log.iso.push({ ...st }),
    ref: () => { log.refs++; log.order.push('ref'); return HEAD; }, settings: () => { log.settings++; return { section: 'off', periphery: 2, rate: 72 }; },
    pose: p => log.poses.push(p), read: () => ({ cover: 1.2e6, f: 1, cap: 0.9, head: { x: 0, y: 1.6, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 } }), progress: () => { log.progress++; }, done: (runs, ok) => { log.done = { runs, ok }; },
    ...over,
  };
  return { env, log };
};
const SHORT_SCENES = [{ id: 'a', dist: 0.45, distAmp: 0.12 }, { id: 'b', dist: 0.30, distAmp: 0.08 }];
const SHORT = [seg('a/fast', 6000), seg('a/slow', 6000), seg('b/fast', 6000)];
const play = (cb, t0, seconds, { slow = [] } = {}) => { let t = t0; const end = t0 + seconds * 1000, tt0 = t0; while (cb.active && t < end) { const late = slow.find(s => !s.done && t - tt0 >= s.at); if (late) { late.done = true; t += late.dt - BUDGET; } cb.frame(t); cb.tick(t); t += BUDGET; } return t; };
const mk = (env, iso = createIsolation(), o = {}) => createCompareBench(env, iso, { segments: SHORT, scenes: SHORT_SCENES, ...o });

describe('the comparison bench controller', () => {
  it('start refuses while something else is going on (the reason comes back), and does nothing then', () => {
    const { env, log } = fakeEnv({ can: () => 'data is being prepared' });
    const cb = mk(env);
    expect(cb.start('cmp')).toBe('data is being prepared'); expect(cb.active).toBe(false); expect(log.enter).toBe(0); expect(log.refs).toBe(0); expect(log.poses).toEqual([]);
  });
  it('runs the comparison bench: menu closed, the std switches, the head taken once, the body placed from the first frame, a new scene begins its own clock and a new period continues it, and it ends with leave(true) and the switches back to the default', () => {
    const { env, log } = fakeEnv(); const iso = createIsolation(); const cb = mk(env, iso);
    expect(cb.start('cmp')).toBe(''); expect(cb.active).toBe(true); expect(cb.start('cmp')).toBe('running');
    expect(log.order).toEqual(['enter', 'ref']); expect(log.enter).toBe(1); expect(log.settings).toBe(1); expect(log.menu).toEqual(['closed']); expect(log.iso.at(-1).mode).toBe('std'); expect(iso.state).toMatchObject(ISO_MODES.std);
    expect(log.poses).toHaveLength(1); expect(log.poses[0]).toEqual(benchPose(SHORT_SCENES[0], benchSegmentsOf('a', SHORT), 0, HEAD)); // placed at once, before the first frame
    let t = play(cb, 0, 0.5); const fr = log.poses.slice(1), moved = fr.filter((p, i) => i && JSON.stringify(p) !== JSON.stringify(fr[i - 1])); // (the first frame's tick is at the very time of the start: the same pose)
    expect(moved.length).toBe(fr.length - 1); expect(fr.length).toBeGreaterThan(30); // every frame is another pose, from the first
    t = play(cb, t, 5.5 + 3.0); // 9 s in: the slow period of scene a
    const at = Math.round(t / BUDGET) * BUDGET, last = log.poses.at(-1), ex = benchPose(SHORT_SCENES[0], benchSegmentsOf('a', SHORT), t - BUDGET, HEAD);
    expect(last.pos[0]).toBeCloseTo(ex.pos[0], 6); expect(last.pos[2]).toBeCloseTo(ex.pos[2], 6); void at; // scene a's own clock goes on through its second period
    t = play(cb, t, 3.1); // 12 s: scene b begins with a clock of its own
    const b0 = benchPose(SHORT_SCENES[1], benchSegmentsOf('b', SHORT), 0, HEAD), pb = log.poses.filter(p => JSON.stringify(p) === JSON.stringify(b0)); expect(pb.length).toBeGreaterThanOrEqual(1); expect(pb.length).toBeLessThanOrEqual(2); // the time-0 pose of b (placed at the change and by the same frame's tick)
    t = play(cb, t, 8); expect(cb.active).toBe(false);
    expect(log.refs).toBe(1); // the head was taken once
    expect(log.leave).toEqual([true]); expect(log.done.ok).toBe(true); expect(log.done.runs).toHaveLength(1);
    const run = log.done.runs[0]; expect(run.mode).toBe('std'); expect(run.settings).toEqual({ section: 'off', periphery: 2, rate: 72 }); expect(run.scenes.map(s => s.id)).toEqual(['a/fast', 'a/slow', 'b/fast']); expect(run.scenes.every(s => s.reached && !s.partial)).toBe(true);
    expect(run.scenes[2].cov.med).toBe(1.2e6); expect(run.scenes[2].cap).toMatchObject({ med: 0.9 }); expect(run.scenes[2].head).toMatchObject({ cm: 0, deg: 0 });
    expect(log.iso.at(-1)).toMatchObject({ mode: 'default', ...ISO_MODES.default }); expect(iso.state.mode).toBe('default'); expect(log.progress).toBeGreaterThan(10);
    for (const p of log.poses) expect(p.scale).toBe(BENCH_HOLDER_SCALE);
  });
  it('the head and the volume\'s movement are fed to the segment being measured (cb.move is the performance record\'s move call)', () => {
    const { env } = fakeEnv(); const cb = mk(env, createIsolation(), { segments: [seg('a/fast', 8000)] });
    cb.start('cmp'); let t = 0; const end = 7900;
    while (t < end) { cb.frame(t); cb.tick(t); cb.move(0.4, 2); t += BUDGET; }
    t += 200; cb.tick(t); // the segment's time is over
    const s = cb.runs.length ? cb.runs[0].scenes[0] : null; expect(s).not.toBe(null);
    expect(s.mv.med).toBeGreaterThan(0.4 * 72 * 0.95); expect(s.mv.med).toBeLessThan(0.4 * 72 * 1.05); expect(s.mvr.med).toBeGreaterThan(2 * 72 * 0.95);
  });
  it('the isolation bench runs twice: as is (menu open) and isolated (menu closed, timestamps / saves off), then puts everything back; the real segments take 180 s a run and the head is taken once for both', () => {
    const { env, log } = fakeEnv(); const iso = createIsolation(); const cb = createCompareBench(env, iso);
    cb.start('iso'); expect(log.menu).toEqual(['open']); expect(iso.state).toMatchObject(ISO_MODES.asis);
    let t = play(cb, 0, 181);
    expect(log.menu).toEqual(['open', 'closed']); expect(iso.state).toMatchObject(ISO_MODES.iso); expect(cb.active).toBe(true);
    expect(log.iso.map(s => s.mode)).toEqual(['asis', 'iso']);
    t = play(cb, t, 181); expect(cb.active).toBe(false);
    expect(log.done.runs.map(r => r.mode)).toEqual(['asis', 'iso']); expect(log.leave).toEqual([true]); expect(log.refs).toBe(1);
    for (const r of log.done.runs) { expect(r.scenes.map(s => s.id)).toEqual(['hold/fast', 'hold/slow', 'near/fast', 'near/slow']); expect(r.scenes.map(s => Math.round(s.measuredMs / 1000))).toEqual([43, 43, 43, 43]); }
    expect(iso.state.mode).toBe('default');
    // no hitch was given: no drops
    expect(log.done.runs[0].scenes.every(s => s.g2 === 0 && s.g3 === 0 && s.drop === 0)).toBe(true);
  });
  it('a hitch in one segment is counted in that segment only', () => {
    const { env } = fakeEnv(); const cb = mk(env);
    cb.start('cmp'); let t = play(cb, 0, 6.5); // into the second segment's settle
    t = play(cb, t, 1.9, { slow: [{ at: 0, dt: 200 }] }); // a hitch during its settle: not counted
    t = play(cb, t, 1.0, { slow: [{ at: 300, dt: 60 }] }); // a hitch while it is measured
    t = play(cb, t, 20);
    const s = cb.runs[0].scenes; expect(s[0].g2 + s[0].g3).toBe(0); expect(s[1].g2 + s[1].g3).toBe(1); expect(s[1].max).toBe(60); expect(s[2].g2 + s[2].g3).toBe(0);
  });
  it('an abort in the middle keeps an incomplete run, puts the settings back (leave(false)) and the switches to the default', () => {
    const { env, log } = fakeEnv(); const iso = createIsolation(); const cb = mk(env, iso);
    cb.start('iso'); let t = play(cb, 0, 10); cb.abort(t);
    expect(cb.active).toBe(false); expect(log.leave).toEqual([false]); expect(log.done.ok).toBe(false);
    expect(log.done.runs).toHaveLength(1); expect(log.done.runs[0].partial).toBe(true); expect(log.done.runs[0].scenes[1].partial).toBe(true); expect(log.done.runs[0].scenes[2].reached).toBe(false);
    expect(iso.state.mode).toBe('default'); expect(log.iso.at(-1).mode).toBe('default');
    cb.abort(t); expect(log.leave).toEqual([false]); // nothing happens twice
  });
});

// ---- the report ----
const sampleRun = (mode, drop) => ({ mode, settings: { section: 'off', periphery: 2, rate: 72 }, scenes: BENCH_SEGMENTS.map((s, i) => ({ id: s.id, scene: s.scene, period: s.period, reached: true, partial: false, measuredMs: 43000, frames: 3100, g1: 0, g2: 10, g3: 2, drop, p95: 14.1, p99: 16.5 + i, max: 45, span: i ? { med: 7, p95: 9 } : null, vol: { med: 5.5, p95: 7.25 }, main: null, cov: { med: 1000000, p90: 2300000 }, f: { avg: 0.9, min: 0.8 }, cap: { med: 1, min: 1 }, mv: { med: 26.1, p90: 33.4 }, mvr: { med: 181.2, p90: 190.7 }, head: { cm: 12.5, deg: 30.2 } })) });
describe('the bench report', () => {
  it('prints a header, the settings, one line per segment (scene/period) with the drop share, the percentiles, the covered px, the movement and the head, and the isolation comparison of a bench with both runs', () => {
    const runs = [{ ...sampleRun('asis', 0.012), n: 1, label: 'bench 1 · run 1 of 2' }, { ...sampleRun('iso', 0.004), n: 1, label: 'bench 1 · run 2 of 2' }];
    const L = benchReportLines(runs, { kind: 'webgpu', build: '758', hz: 72 });
    expect(L[0]).toContain('comparison bench: WebGPU · · target 72 Hz'); expect(L[0]).toContain('first 2 s'); expect(L[0]).toContain('30 cm');
    expect(L.filter(l => l.startsWith('bench 1 · run'))).toHaveLength(2);
    expect(L.filter(l => l.startsWith('settings: section off · periphery strong (2) · refresh rate 72 Hz'))).toHaveLength(2);
    const head = L.find(l => l.startsWith('segment')); for (const k of ['drop%', 'p99', 'spanMed', 'volP95', 'covMed', 'covP90', 'cap', 'mvMed', 'mvP90', 'mvrMed', 'mvrP90', 'headCm', 'headDeg']) expect(head).toContain(k);
    const hold = L.filter(l => l.startsWith('hold/fast'));
    expect(hold).toHaveLength(2); expect(hold[0]).toContain('1.20'); expect(hold[1]).toContain('0.40'); expect(hold[0]).toMatch(/\s43\.0\s+3100/); expect(hold[0]).toContain('2300000'); expect(hold[0]).toContain('181.2'); expect(hold[0]).toContain('30.2');
    expect(L.filter(l => /^(hold|near)\/(fast|slow)/.test(l))).toHaveLength(8); // every scene x period, in both runs
    expect(L.some(l => l.startsWith('isolation of bench 1'))).toBe(true);
    expect(L.find(l => l.includes('hold/fast') && l.includes('->'))).toMatch(/1\.20\s+->\s+0\.40/);
    expect(benchReportLines([], {})).toEqual([]);
    expect(benchReportLines([{ mode: 'std', scenes: [{ id: 'near/slow', reached: false }] }], {}).some(l => l.includes('not reached'))).toBe(true);
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
    const hi = L.findIndex(l => l.startsWith('-- the first ')); expect(hi).toBeGreaterThan(0); // the first frames are listed after the windows
    expect(L.slice(0, hi).filter(l => /^\s+\d+ /.test(l))).toHaveLength(7);
    expect(L.slice(hi).filter(l => /^\s+\d+ /.test(l))).toHaveLength(30); // (all 30 frames of the session: it is shorter than the head)
    const none = ringReportLines(createFrameRing(), {}); expect(none[0]).toContain('0 of 0 frames'); expect(none.some(l => l.includes('0 window(s)'))).toBe(true);
  });
  it('the first frames of the session are kept whatever the ring has overwritten since (the head), and the text lists them', () => {
    const ring = createFrameRing({ size: 50, headSize: 20 }); ring.frame(1000, {}); feed(ring, 200, { t0: 1000, c: i => ({ hold: i }) });
    expect(ring.count).toBe(200); expect(ring.records()[0].n).toBe(150); // the ring holds the last 50
    const h = ring.first(); expect(h).toHaveLength(20); expect(h[0].n).toBe(0); expect(h[19].n).toBe(19); expect(h[19].hold).toBe(19);
    const L = ringReportLines(ring, { sinceMs: 1000 }), hi = L.findIndex(l => l.startsWith('-- the first 20 frames'));
    expect(hi).toBeGreaterThan(0); expect(L.slice(hi).filter(l => /^\s+\d+ /.test(l))).toHaveLength(20);
    expect(createFrameRing().first()).toEqual([]); expect(RING_HEAD).toBe(600);
  });
  it('fv / pz / pms are running totals (the ring keeps the differences); ml / gd / vol / lag / ph are the frame\'s own values (NaN = none)', () => {
    const ring = createFrameRing(); const c = { fv: 0, pz: 0, pms: 0 };
    ring.frame(0, { ...c });
    Object.assign(c, { fv: 1, pz: 1, pms: 0.4 }); ring.frame(14, { ...c, ml: 2.5, gd: -1.5, vol: 6, lag: 3, ph: 1 });
    ring.frame(28, { ...c }); // nothing in this interval
    Object.assign(c, { fv: 3, pz: 2, pms: 0.9 }); ring.frame(42, { ...c });
    const [a, b, d] = ring.records();
    expect(a).toMatchObject({ fv: 1, pz: 1, ml: 2.5, gd: -1.5, vol: 6, lag: 3, ph: 1 }); expect(a.pms).toBeCloseTo(0.4, 5);
    expect(b).toMatchObject({ fv: 0, pz: 0, pms: 0 }); expect(Number.isNaN(b.ml)).toBe(true); expect(Number.isNaN(b.gd)).toBe(true); expect(Number.isNaN(b.lag)).toBe(true);
    expect(d.fv).toBe(2); expect(d.pz).toBe(1); expect(d.pms).toBeCloseTo(0.5, 5);
  });
  it('the session table counts ALL frames (not only the ring\'s): phase x frames since the check\'s last draw (0..15, then none) x measured frame (mp > 0) -> frames / over 21 / over 30 ms', () => {
    const ring = createFrameRing({ size: 50 }); ring.frame(0, {}); let t = 0, fv = 0, maps = 0;
    const step = (dt, { draw = false, mp = false, ph = 0 } = {}) => { t += dt; if (draw) fv++; if (mp) maps++; ring.frame(t, { fv, maps, ph }); };
    step(14, { draw: true }); // since 0
    step(25); // since 1, over 21
    for (let k = 2; k <= 14; k++) step(14); // since 2..14
    step(35, { mp: true }); // since 15, measured, over 30 (and over 21)
    step(14); step(14); // since none (16 and later)
    step(14, { draw: true, ph: 1 }); step(22, { ph: 1 }); step(14, { ph: 2, mp: true });
    for (let k = 0; k < 400; k++) step(14, { ph: 2 }); // far beyond the ring's size (50)
    expect(ring.count).toBe(1 + 1 + 13 + 1 + 2 + 3 + 400 + 0 - 0 + 0); // 421
    const S = ring.session(), cell = (ph, since, mp) => S.cells.find(c => c.ph === ph && c.since === since && c.mp === mp);
    expect(cell(0, 0, 0)).toEqual({ ph: 0, since: 0, mp: 0, n: 1, o21: 0, o30: 0 });
    expect(cell(0, 1, 0)).toMatchObject({ n: 1, o21: 1, o30: 0 });
    expect(cell(0, 15, 1)).toMatchObject({ n: 1, o21: 1, o30: 1 });
    expect(cell(0, 16, 0)).toMatchObject({ n: 2, o21: 0, o30: 0 }); // 'none'
    expect(cell(1, 0, 0)).toMatchObject({ n: 1 }); expect(cell(1, 1, 0)).toMatchObject({ n: 1, o21: 1 });
    expect(cell(2, 2, 1)).toMatchObject({ n: 1 }); expect(cell(2, 3, 0).n).toBe(1); expect(cell(2, 15, 0).n).toBe(1); expect(cell(2, 16, 0).n).toBe(400 - 13);
    expect(S.cells.reduce((n, c) => n + c.n, 0)).toBe(421); expect(ring.records()).toHaveLength(50);
    expect(S.phases.map(p => p.name)).toEqual(['pre', 'rec', 'post']);
  });
  it('per phase: median and p95 of dt, cov, vol, ml, gd, lag (exact when few); a very long session keeps a uniform sample, and the count seen', () => {
    const ring = createFrameRing(); ring.frame(0, {}); let t = 0;
    for (let i = 1; i <= 100; i++) { t += 14; ring.frame(t, { ph: 0, cov: 1000 + i, vol: i % 2 ? 4 : 8, ml: i <= 10 ? i : NaN, gd: i === 5 ? -3 : NaN, lag: i }); }
    const p = ring.session().phases[0];
    expect(p.dt).toMatchObject({ n: 100, used: 100, med: 14, p95: 14 }); expect(p.cov).toMatchObject({ n: 100, med: 1050.5, p95: 1095 }); expect(p.vol).toMatchObject({ n: 100, med: 6, p95: 8 });
    expect(p.ml).toMatchObject({ n: 10, med: 5.5, p95: 10 }); expect(p.gd).toMatchObject({ n: 1, med: -3, p95: -3 }); expect(p.lag).toMatchObject({ n: 100, med: 50.5, p95: 95 });
    expect(ring.session().phases[1].dt.n).toBe(0); expect(ring.session().phases[1].dt.med).toBeNull();
    const big = createFrameRing(); big.frame(0, {}); let u = 0; const N = RING_SAMPLES * 3;
    for (let i = 0; i < N; i++) { u += 14; big.frame(u, { cov: i }); }
    const q = big.session().phases[0].cov; expect(q.n).toBe(N); expect(q.used).toBe(RING_SAMPLES); expect(Math.abs(q.med - N / 2)).toBeLessThan(N * 0.05); expect(Math.abs(q.p95 - N * 0.95)).toBeLessThan(N * 0.05);
    const big2 = createFrameRing(); big2.frame(0, {}); let w = 0; for (let i = 0; i < N; i++) { w += 14; big2.frame(w, { cov: i }); } expect(big2.session().phases[0].cov.med).toBe(q.med); // the same run, the same sample
  });
  it('the text: the session table with the phases and the since rows, the new columns in the windows, and the leftovers of the recording', () => {
    const ring = createFrameRing(); ring.frame(1000, {}); let t = 1000, fv = 0, maps = 0;
    for (let i = 0; i < 40; i++) { t += i === 12 ? 45 : 14; if (i === 10) fv++; if (i === 11) maps++; ring.frame(t, { fv, maps, pz: i, pms: i * 0.2, ph: i > 30 ? 2 : i > 20 ? 1 : 0, cov: 5e5, vol: 7, ml: i === 12 ? 4.5 : NaN, gd: i === 12 ? 9.25 : NaN, lag: i === 12 ? 11.5 : 2 }); }
    const L = ringReportLines(ring, { sinceMs: 1000 });
    expect(L.some(l => l.includes('foveation check x frame intervals, all 40 frames of the session'))).toBe(true);
    expect(L.some(l => l.startsWith('ph    since'))).toBe(true);
    // the draw is in interval 10 (since 0), the read-back started in interval 11 (since 1, measured), the 45 ms interval is 12 (since 2, not measured)
    const cells = ring.session().cells, c2 = cells.find(c => c.ph === 0 && c.since === 2); expect(c2).toMatchObject({ mp: 0, n: 1, o21: 1, o30: 1 }); expect(cells.find(c => c.ph === 0 && c.since === 1)).toMatchObject({ mp: 1, n: 1, o21: 0 });
    expect(L.find(l => /^pre\s+2\s+\|/.test(l))).toMatch(/\|\s+1\s+1\s+1 \|/); expect(L.find(l => /^pre\s+1\s+\|/.test(l))).toBeTruthy(); expect(L.find(l => /^pre\s+none\s+\|/.test(l))).toBeTruthy();
    expect(L.find(l => l.startsWith('ph pre: median / p95'))).toMatch(/cov 500000 \/ 500000 \(n 21\) · vol 7 \/ 7/); expect(L.find(l => l.startsWith('ph rec:'))).toBeTruthy(); expect(L.find(l => l.startsWith('ph post:'))).toBeTruthy();
    const head = L.find(l => /^\s+n\s+t\s+dt\s/.test(l)); expect(head).toMatch(/\bfv\s+pz\s+pm\s+ml\s+gd\s+lag\s+flag/);
    const w = L.find(l => /^\s+12 /.test(l)); expect(w).toContain('45.0'); expect(w).toContain('4.5'); expect(w).toContain('9.3'); expect(w).toContain('11.5');
    const E = leftoverReportLines([{ at: 'prepare', t: 2000, every: 8, slots: 24, slotsBusy: 0, bd: false, track: false, groups: 3, pipes: 5, ubufs: 4, heap: 52428800 }, { at: 'freed', t: 33000, every: 8, slots: 24, slotsBusy: 2, bd: true, track: true, groups: 40, pipes: 5, ubufs: 9, heap: 0 }], { sinceMs: 1000 });
    expect(E[0]).toContain('2 dump(s)'); expect(E[1]).toContain('prepare'); expect(E[1]).toContain('t 1.00 s'); expect(E[1]).toContain('timestamps every 8'); expect(E[1]).toContain('breakdown object no'); expect(E[1]).toContain('JS heap 50.0 MB');
    expect(E[2]).toContain('slots busy 2 of 24'); expect(E[2]).toContain('breakdown object yes'); expect(E[2]).toContain('trackTimestamp true'); expect(E[2]).toContain('bind groups 40'); expect(E[2]).toContain('uniform buffers 9'); expect(E[2]).toContain('JS heap -');
    expect(leftoverReportLines([])[0]).toContain('no recording in this session');
  });
  it('vr-view.js feeds the new columns, switches the phase when the recording is prepared / its resources are let go, and dumps the leftovers three times', () => {
    expect(vrSrc).toContain('{const fvN=gxCaps?gxCaps.foveaDraws|0:0,pzN=gxPose?gxPose.poseReads:0,pmN=gxPose?gxPose.poseMs:0;c.fv=benchLag.fv;c.pz=benchLag.pz;c.pms=benchLag.pms;benchLag.fv=fvN;benchLag.pz=pzN;benchLag.pms=pmN}c.ph=benchPh;'); // one frame late: the heartbeat's tick runs before this callback
    expect(vrSrc).toContain('gx?.vol?.volume.takeGauges?.(benchG);c.ml=benchG.ml;c.gd=benchG.gd;c.vol=benchG.vol;c.lag=xrTs?fa0-xrTs:NaN;');
    expect(vrSrc).toContain("gxRec.phase='prep';benchPh=1;gxRec.leftAt=0;gxLeftDump('prepare');");
    expect(vrSrc).toContain("benchPh=2;gxLeftDump('freed');gxRec.leftAt=tn+10000}else if(gxRec.leftAt&&tn>=gxRec.leftAt){gxRec.leftAt=0;gxLeftDump('freed +10 s')}");
    expect(vrSrc).toContain("if(benchPh===1){benchPh=2;gxLeftDump('freed (abort)')}"); expect(vrSrc).toContain('gxPose=gxHb?gxHb.stats:null;'); expect(vrSrc).toContain('leftoverReportLines(gxLeft,{sinceMs:benchT0})');
    expect(vrSrc).toContain("gxLeft.push({at,t:performance.now(),...o,track:renderer.backend?.trackTimestamp,heap:readHeapBytes()})");
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
  it('the diagnostics heartbeat does not write once a second (E0); it writes when the page is hidden; with saveOn false it does not (and the count of writes is readable)', () => {
    const mk = () => { const cbs = []; const s = { ended: 0, inputSources: [], requestAnimationFrame(cb) { cbs.push(cb); return 1; }, end() { return Promise.resolve(); }, frame() { const l = cbs.splice(0); for (const cb of l) cb(0, { getViewerPose: () => null }); } }; return { s }; };
    const mkDoc = () => { const fns = []; return { visibilityState: 'visible', addEventListener: (_t, f) => fns.push(f), removeEventListener() {}, fire() { for (const f of fns) f(); } }; };
    for (const [off, writes] of [[false, 1], [true, 0]]) {
      const { s } = mk(); let t = 0; const sets = []; const store = { setItem: (k) => sets.push(k) }; const doc = mkDoc();
      const diag = createGxDiag({ store, now: () => t }); const st = { bound: true, rendered: 0 };
      const hb = startGxHeartbeat({ session: s, diag, state: () => st, now: () => t, stallFrames: 1e9, doc, ...(off ? { saveOn: () => false } : {}) });
      const base = sets.length;
      for (let i = 1; i <= 3; i++) { t = i * 1000; s.frame(); }
      expect(sets.length - base).toBe(0); // no save once a second
      doc.visibilityState = 'hidden'; doc.fire();
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
  it('tapPerfLog hands the add / sample / move calls to the bench and still records them; the returned function takes the tap off', () => {
    const log = createPerfLog({ now: () => 0, store: null }), got = [];
    const off = tapPerfLog(log, { add: (k, ms, n) => got.push(['add', k, ms, n]), sample: (k, ms) => got.push(['sample', k, ms]), move: (cm, deg) => got.push(['move', cm, deg]) });
    log.add('vol', 6, 2); log.sample('span', 4); log.move(3, 90); const row = log.row({}, 1000);
    expect(got).toEqual([['add', 'vol', 6, 2], ['sample', 'span', 4], ['move', 3, 90]]); expect(row.vol).toBe(3); expect(row.span).toBe(4); expect(row.mv).toBeGreaterThan(0); expect(row.mvr).toBeGreaterThan(0); // the log still records the movement
    off(); log.add('vol', 1); log.move(1, 1); expect(got).toHaveLength(3);
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
    expect(vrSrc).toContain("gxRec.phase!=='idle'||bench.active||anBench.active||cmpBench.active||identRun?.active||!mesh||!material)return; // not together"); // (the same-picture check refuses the recording too) // the breakdown recording does not start inside the bench (its button is on the tab the as-is run has open)
  });
  it('the comparison bench is its own thing: not bench.active (the old benchmark\'s cap / guards / periphery rules do not apply), no section plane through bench.noSection, 100 %, auto off, menu closed', () => {
    const blk = vrSrc.slice(vrSrc.indexOf('const cmpBench=createCompareBench('), vrSrc.indexOf(' const applyQuality=()=>{'));
    expect(blk).toContain('bench.noSection=true'); expect(blk).toContain('settings.vres=1;settings.foveation=2;applyQuality()'); expect(blk).not.toContain('bench.active=true');
    expect(blk).toContain("m==='open'"); expect(blk).toContain('setMenuOpen(false)'); expect(blk).toContain('bringVolumeFront()');
    expect(blk).toContain('holder.quaternion.set(p.quat[0],p.quat[1],p.quat[2],p.quat[3])'); expect(blk).toContain('holder.scale.setScalar(p.scale)'); expect(blk).toContain('ref:()=>'); // the pose is the bench's own (time alone), the size is its largest
    expect(blk).not.toContain('headFwd'); expect(blk).not.toContain('clampScale');
    expect(vrSrc).toContain('move:(cm,deg)=>{cmpBench.move(cm,deg);'); // the volume's movement as the performance record counts it
    expect(vrSrc).toContain("session.addEventListener('end',()=>cmpBench.abort(),{once:true})");
    expect(vrSrc).toContain('if(bench.active||cmpBench.active||identRun?.active||!mesh||gxRec.phase===\'prep\'||gxRec.on)return;'); // the old benchmark does not start inside it
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
