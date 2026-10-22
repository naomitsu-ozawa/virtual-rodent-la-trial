import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createVelocityTracker, flingDecision, flingDebugLines, FLING_SPEED_MPS, FLING_STALE_MS, FLING_COS } from '../../docs/vr-section-frame.js';
import { sectionFollowStart, sectionFollowStep, qMul } from '../../docs/vr-point.js';
import { VOLUME_FWD, VOLUME_DOWN } from '../../docs/vr-layout.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

const head = { x: 0, y: 1.6, z: 0 };
const C = { x: 0, y: head.y - VOLUME_DOWN, z: -VOLUME_FWD };        // volume centre in front of the viewer (bringVolumeFront)
const S = 0.0005;                                                   // holder scale (volume object units -> m): positions in holder space are NOT metres
const toHolder = p => ({ x: (p.x - C.x) / S, y: (p.y - C.y) / S, z: (p.z - C.z) / S });
const toWorld = p => ({ x: C.x + p.x * S, y: C.y + p.y * S, z: C.z + p.z * S });
const norm = v => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const qAxis = (ax, ang) => { const s = Math.sin(ang / 2); return { x: ax.x * s, y: ax.y * s, z: ax.z * s, w: Math.cos(ang / 2) }; };
// rotation taking the laser (controller -Z) onto direction d
const qLaserTo = d => { const a = { x: 0, y: 0, z: -1 }, b = norm(d), dot = a.x * b.x + a.y * b.y + a.z * b.z, cx = a.y * b.z - a.z * b.y, cy = a.z * b.x - a.x * b.z, cz = a.x * b.y - a.y * b.x, w = 1 + dot, l = Math.hypot(cx, cy, cz, w); return { x: cx / l, y: cy / l, z: cz / l, w: w / l }; };
const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const Y = { x: 0, y: 1, z: 0 };

// The laser drag of a section whose centre is where the laser points (the volume centre unless `aim` is given), then a hand motion pose(t) for `ms`, then still frames, then the
// release event `releaseAfterMs` after the last frame sample. step: frame time (11 ms = 90 Hz, 28 ms = 36 Hz). Returns what both measurements see.
function throwSim({ hand0 = { x: 0.2, y: 1.1, z: -0.02 }, aim = C, motion, ms = 150, stillMs = 22, step = 11, releaseAfterMs = 11, linear = false }) {
  const q0 = qLaserTo(sub(aim, hand0)), lp0 = toHolder(hand0), planeLocal0 = toHolder(aim), Qp0 = { x: 0, y: 0, z: 0, w: 1 };
  const fl = sectionFollowStart({ p0: lp0, q0, c0: planeLocal0, Qp0 });
  const plane = createVelocityTracker(), hand = createVelocityTracker();
  let t = 1000, last = null;
  const frame = (u) => {
    const m = motion(linear ? Math.min(1, Math.max(0, u)) : smooth(u)), p = { x: hand0.x + m.dx.x, y: hand0.y + m.dx.y, z: hand0.z + m.dx.z }, q = qMul(m.q, q0);
    const r = sectionFollowStep({ rel: fl.rel, Qrel: fl.Qrel, p: toHolder(p), q });
    const pw = toWorld(r.c); plane.push(t, pw); hand.push(t, p); last = { plane: pw, hand: p }; t += step;
  };
  for (let k = 0; k < 20; k++) frame(0);                                       // the drag is held still a moment first
  const n = Math.round(ms / step); for (let k = 1; k <= n; k++) frame(k / n);  // the flick
  for (let k = 0; k < Math.round(stillMs / step); k++) frame(1);               // a few frames before the trigger is let go
  const tRel = t - step + releaseAfterMs;                                     // the selectend event: after the last frame sample
  return { plane: plane.measure(tRel), hand: hand.measure(tRel), last };
}
// wrist flick: yaw by deg (negative = to the right) with a small hand translation dx (m)
const flick = (deg, dx = { x: 0, y: 0, z: 0 }) => s => ({ q: qAxis(Y, deg * Math.PI / 180 * s), dx: { x: dx.x * s, y: dx.y * s, z: dx.z * s } });

describe('realistic Quest throw: laser drag at ~0.7 m, 45 degree wrist flick + 8 cm hand motion in 150 ms', () => {
  const r = throwSim({ motion: flick(-45, { x: 0.08, y: 0, z: 0 }) });
  it('the controller itself barely moves (< FLING_SPEED_MPS) while the frame at the end of the laser flies (> 3 m/s)', () => {
    expect(r.hand.v.speed).toBeLessThan(FLING_SPEED_MPS);
    expect(r.plane.v.speed).toBeGreaterThan(3);
  });
  it('measured the controller and used the axis volume centre -> controller: the throw was kept (the bug)', () => {
    const B521 = { minSpeed: 1.5, minCos: 0.5 }; // 's thresholds (this replays that build's measurement)
    const old = flingDecision({ v: r.hand.v, from: r.last.hand, center: C, head, ...B521 });
    expect(old.fling).toBe(false); expect(old.reason).toBe('slow');
    // even a fast hand would have failed: the hand is between the viewer and the volume, so "centre -> hand" points back at the viewer
    const fastHand = { x: r.plane.v.x, y: r.plane.v.y, z: r.plane.v.z };
    expect(flingDecision({ v: fastHand, from: r.last.hand, center: C, head, ...B521 }).fling).toBe(false);
  });
  it('measures the frame and uses centre -> frame: the throw deletes', () => {
    const d = flingDecision({ v: r.plane.v, from: r.last.plane, center: C, head });
    expect(d).toMatchObject({ fling: true, reason: 'fling' }); expect(d.cos).toBeGreaterThan(0.8);
  });
  it('the same throw to the left, upward and forward (away from the viewer) deletes too', () => {
    const X = { x: 1, y: 0, z: 0 };
    for (const motion of [flick(45, { x: -0.08, y: 0, z: 0 }), s => ({ q: qAxis(X, 40 * Math.PI / 180 * s), dx: { x: 0, y: 0.06 * s, z: 0 } }), s => ({ q: { x: 0, y: 0, z: 0, w: 1 }, dx: { x: 0, y: 0, z: -0.35 * s } })]) {
      const q = throwSim({ motion }); expect(flingDecision({ v: q.plane.v, from: q.last.plane, center: C, head }).fling).toBe(true);
    }
  });
  it('a heavy frame rate (36 Hz) and a release 60 ms after the last frame still measure (FLING_STALE_MS was 50 ms)', () => {
    const q = throwSim({ motion: flick(-45, { x: 0.08, y: 0, z: 0 }), step: 28, stillMs: 28, releaseAfterMs: 60 });
    expect(q.plane.ageMs).toBeGreaterThan(50); expect(q.plane.ageMs).toBeLessThanOrEqual(FLING_STALE_MS);
    expect(flingDecision({ v: q.plane.v, from: q.last.plane, center: C, head }).fling).toBe(true);
  });
  it('a late release (trigger let go 80 ms after the flick) still deletes', () => {
    const q = throwSim({ motion: flick(-45, { x: 0.08, y: 0, z: 0 }), stillMs: 77 });
    expect(flingDecision({ v: q.plane.v, from: q.last.plane, center: C, head }).fling).toBe(true);
  });
});

describe('releases that must NOT delete (same real follow math)', () => {
  const decide = q => flingDecision({ v: q.plane.v, from: q.last.plane, center: C, head });
  it('a careful laser drag (20 degrees in 0.6 s) and a normal placement', () => {
    expect(decide(throwSim({ motion: flick(-20, { x: 0.03, y: 0, z: 0 }), ms: 600 }))).toMatchObject({ fling: false, reason: 'slow' });
    expect(decide(throwSim({ motion: flick(10), ms: 400, stillMs: 300 }))).toMatchObject({ fling: false });
  });
  it('a fast flick that stopped well before the release (held still 250 ms)', () => {
    expect(decide(throwSim({ motion: flick(-45, { x: 0.08, y: 0, z: 0 }), stillMs: 253 })).reason).toBe('slow');
  });
  it('inward: the frame held out to the right is pulled fast back toward the volume, let go while still moving', () => {
    const aim = { x: C.x + 0.3, y: C.y, z: C.z };
    const q = throwSim({ aim, motion: flick(18), ms: 110, stillMs: 0, linear: true });
    expect(q.plane.v.speed).toBeGreaterThan(FLING_SPEED_MPS);
    expect(decide(q)).toMatchObject({ fling: false, reason: 'inward' });
  });
  it('sideways: a frame beside the volume swept fast along it (tangentially), short', () => {
    const aim = { x: C.x + 0.25, y: C.y, z: C.z }, X = { x: 1, y: 0, z: 0 };
    // 4 degrees in 33 ms (1.5 m/s, ~78 degrees off the outward axis) stays; the 7 degrees in 55 ms sweep of ends ~70 degrees off the axis and,
    // with the ~75 degree edge of (FLING_COS 0.26), deletes now (asserted below so the change is visible)
    const q = throwSim({ aim, motion: s => ({ q: qAxis(X, 4 * Math.PI / 180 * s), dx: { x: 0, y: 0, z: 0 } }), ms: 33, stillMs: 0, linear: true });
    expect(q.plane.v.speed).toBeGreaterThan(FLING_SPEED_MPS);
    expect(decide(q)).toMatchObject({ fling: false, reason: 'inward' });
    const q7 = throwSim({ aim, motion: s => ({ q: qAxis(X, 7 * Math.PI / 180 * s), dx: { x: 0, y: 0, z: 0 } }), ms: 55, stillMs: 0, linear: true });
    const d7 = decide(q7); expect(d7.fling).toBe(true); expect(d7.cos).toBeGreaterThan(FLING_COS); expect(d7.cos).toBeLessThan(0.5);
  });
  it('twisting the frame fast about the laser (wrist roll): the frame centre stays, nothing happens', () => {
    const q = throwSim({ motion: s => { const d = norm(sub(C, { x: 0.2, y: 1.1, z: -0.02 })); return { q: qAxis(d, 90 * Math.PI / 180 * s), dx: { x: 0, y: 0, z: 0 } }; } });
    expect(decide(q).fling).toBe(false); expect(q.plane.v.speed).toBeLessThan(0.3);
  });
  it('a grip / two-hand gesture during the drag blocks even a perfect throw', () => {
    const q = throwSim({ motion: flick(-45, { x: 0.08, y: 0, z: 0 }) });
    expect(flingDecision({ v: q.plane.v, from: q.last.plane, center: C, head, blocked: true })).toMatchObject({ fling: false, reason: 'volume-gesture' });
  });
});

describe('vr-view.js wires the frame (not the controller) into the throw', () => {
  const loop = src.slice(src.indexOf('the dragged FRAME'), src.indexOf('the dragged FRAME') + 700);
  const fl = src.slice(src.indexOf('const tryFling=c=>{'), src.indexOf('const tryFling=c=>{') + 900);
  it('the frame loop samples the dragged frame\'s world position, with the frame time', () => {
    expect(loop).toContain('.obj.getWorldPosition(tmpFv)');
    expect(loop).toMatch(/fv\.push\(js0,tmpFv\)/);
    expect(loop).toContain('grabbing.size');
  });
  it('tryFling measures the frame, takes its centre at the release as `from`, and shows the ?debug readout on every release', () => {
    expect(fl).toContain('dg.pl.obj.getWorldPosition(tmpFv)');
    expect(fl).toMatch(/fv\.measure\(/);
    expect(fl).toContain('from:tmpFv');
    expect(fl).toContain('flingDebugOn()');
    expect(fl.indexOf('flingDebugOn()')).toBeLessThan(fl.indexOf('if(!r.fling)return false'));
  });
  it('the readout is debug-only (settings デバッグモード or ?debug), hidden otherwise', () => {
    expect(src).toContain("const flingDebugOn=()=>!!globalThis.__vrlSettings?.debugOn?.()||(typeof location!=='undefined'&&/[?&]debug(\\b|=|&|$)/.test(location.search))");
    expect(src).toMatch(/flingDbg\.mesh\.visible=false|flingDbg=createFlingDebugTag/);
  });
});

describe('flingDebugLines', () => {
  it('verdict, frame and hand speed, cos, samples / span / time to the release', () => {
    const ls = flingDebugLines({ fling: false, reason: 'slow', speed: 0.84, cos: 0.31, n: 14, spanMs: 33, ageMs: 12, hand: 0.4 }, true);
    expect(ls[0]).toBe('投げ判定: 削除しない（遅い）'); expect(ls[1]).toContain('0.84 m/s'); expect(ls[1]).toContain('手 0.40'); expect(ls[2]).toContain('cos 0.31');
    expect(ls[3]).toBe('サンプル 14 / 区間 33 ms / 離すまで 12 ms');
    expect(flingDebugLines({ fling: true, reason: 'fling', speed: 4.2, cos: 0.9, n: 15, spanMs: 33, ageMs: 11, hand: null }, false)[0]).toBe('Throw: deleted');
    expect(flingDebugLines({ fling: false, reason: 'no-velocity', speed: 0, cos: 0, n: 1, spanMs: 0, ageMs: 200, why: 'stale' }, true)[0]).toContain('最後のサンプルが古い');
  });
});
