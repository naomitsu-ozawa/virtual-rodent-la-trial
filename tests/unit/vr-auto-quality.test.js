import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAutoQuality, autoFloor, STEP_LEVELS, AUTO_FLOORS, AUTO_MID, GROW_SCALE, GROW_MAX_DROP, marchStep, STEP_VOXELS } from '../../docs/vr-auto-quality.js';

const BUDGET = 1000 / 72;
// mocked GPU timings: the volume pass costs `unit` ms at f = 1 and step 1; it scales with f^2 and 1/step; the rest of the frame is `rest` ms
const sample = (aq, unit, rest = 2) => {
  const f = aq.f, vol = unit * f * f * STEP_LEVELS[0] / STEP_LEVELS[aq.stepIdx];
  return f < 1 ? { volMs: vol, mainMs: rest, interval: BUDGET, budget: BUDGET } : { volMs: 0, mainMs: vol + rest, interval: BUDGET, budget: BUDGET };
};
const run = (aq, unit, n, rest) => { const trace = []; for (let i = 0; i < n; i++) { aq.update(sample(aq, unit, rest)); trace.push({ f: aq.f, s: aq.stepIdx }); } return trace; };

describe('ladder', () => {
  it('floor values and labels order: 50 / 35 / 25 %', () => {
    expect(AUTO_FLOORS).toEqual([0.5, 0.35, 0.25]);
    expect(autoFloor(0)).toBe(0.5); expect(autoFloor(2)).toBe(0.25); expect(autoFloor(9)).toBe(0.5);
  });
  it('overload: resolution first to 0.7, step only then; resolution stays >= 0.7 while step < 2', () => {
    const aq = createAutoQuality();
    const trace = run(aq, 40, 60);
    for (const t of trace) if (t.s < 2) expect(t.f).toBeGreaterThanOrEqual(0.7 - 1e-9);
    const firstStep = trace.findIndex(t => t.s > 0);
    expect(firstStep).toBeGreaterThan(0);
    expect(trace[firstStep - 1].f).toBeCloseTo(0.7, 6);       // resolution reached 0.7 before the first step change
    expect(trace.some(t => t.s === 1)).toBe(true);             // 1 -> 1.5 passed through
    const i2 = trace.findIndex(t => t.s === 2);
    expect(trace.slice(0, i2).every(t => t.f >= 0.7 - 1e-9)).toBe(true);
  });
  it('steps rise one level at a time and never skip', () => {
    const aq = createAutoQuality(); let prev = 0;
    for (const t of run(aq, 60, 80)) { expect(t.s - prev).toBeLessThanOrEqual(1); expect(t.s).toBeGreaterThanOrEqual(prev); prev = t.s; }
  });
  it.each([[0, 0.5], [1, 0.35], [2, 0.25]])('floor setting %i is respected (min %f) and reached only at step 2', (idx, floor) => {
    const aq = createAutoQuality({ min: autoFloor(idx) });
    const trace = run(aq, 400, 200); // far beyond what the GPU can do
    expect(Math.min(...trace.map(t => t.f))).toBeGreaterThanOrEqual(floor - 1e-9);
    expect(aq.f).toBeCloseTo(floor, 6); expect(aq.stepIdx).toBe(2);
    for (const t of trace) if (t.f < 0.7 - 1e-9) expect(t.s).toBe(2);
  });
  it('manual Detail is the lowest rung: base step 1 never goes back to 0, base 2 never moves the step', () => {
    const a = createAutoQuality({ baseStep: 1 });
    expect(Math.min(...run(a, 40, 40).map(t => t.s))).toBe(1);
    expect(Math.min(...run(a, 1, 200).map(t => t.s))).toBe(1);
    const b = createAutoQuality({ baseStep: 2 });
    const tb = run(b, 40, 60);
    expect(tb.every(t => t.s === 2)).toBe(true);
    expect(b.f).toBeLessThan(1);
  });
  it('hysteresis: one over sample, or alternating samples, change nothing', () => {
    const aq = createAutoQuality();
    aq.update({ volMs: 0, mainMs: 40, interval: BUDGET, budget: BUDGET });
    expect(aq.f).toBe(1);
    for (let i = 0; i < 10; i++) {
      aq.update({ volMs: 0, mainMs: i % 2 ? 40 : 4, interval: BUDGET, budget: BUDGET });
      expect(aq.f).toBe(1); expect(aq.stepIdx).toBe(0);
    }
    aq.update({ volMs: 0, mainMs: 40, interval: BUDGET, budget: BUDGET });
    aq.update({ volMs: 0, mainMs: 40, interval: BUDGET, budget: BUDGET });
    expect(aq.f).toBeLessThan(1);
  });
  it('recovery needs consecutive samples with headroom', () => {
    const aq = createAutoQuality();
    run(aq, 40, 60);
    const before = { f: aq.f, s: aq.stepIdx };
    aq.update({ volMs: 1, mainMs: 1, interval: BUDGET, budget: BUDGET });
    aq.update({ volMs: 1, mainMs: 1, interval: BUDGET, budget: BUDGET });
    expect({ f: aq.f, s: aq.stepIdx }).toEqual(before);
    aq.update({ volMs: 40, mainMs: 2, interval: BUDGET, budget: BUDGET }); // heavy again: counter resets
    aq.update({ volMs: 1, mainMs: 1, interval: BUDGET, budget: BUDGET });
    aq.update({ volMs: 1, mainMs: 1, interval: BUDGET, budget: BUDGET });
    expect({ f: aq.f, s: aq.stepIdx }).toEqual(before);
  });
  it('recovery runs in reverse: resolution to 0.7, then step 2 -> 1.5 -> 1, then resolution to 1', () => {
    const aq = createAutoQuality({ min: 0.35 });
    run(aq, 400, 200);
    expect(aq.stepIdx).toBe(2); expect(aq.f).toBeCloseTo(0.35, 6);
    const trace = run(aq, 3, 300); // light scene now (the failed-level memory lapses after 120 samples)
    expect(aq.f).toBe(1); expect(aq.stepIdx).toBe(0);
    for (let i = 1; i < trace.length; i++) {
      const p = trace[i - 1], t = trace[i];
      if (t.s < p.s) { expect(t.s).toBe(p.s - 1); expect(p.f).toBeGreaterThanOrEqual(0.7 - 1e-9); expect(t.f).toBeGreaterThanOrEqual(0.7 - 1e-9); }
      if (p.s === 2 && t.s === 1) expect(p.f).toBeCloseTo(0.7, 6);   // step comes down only once resolution is back at 0.7
      if (t.f > p.f && p.f < 0.7 - 1e-9) expect(t.s).toBe(2);       // below 0.7 only resolution rises, step still max
      if (t.f > 0.7 + 1e-9 && p.s !== t.s) throw new Error('step and resolution moved together above 0.7');
    }
    const iStep0 = trace.findIndex(t => t.s === 0), i1 = trace.findIndex(t => t.f > 0.7 + 1e-9);
    expect(trace.slice(0, iStep0).every(t => t.f <= 0.7 + 1e-9)).toBe(true);
    expect(i1).toBeGreaterThanOrEqual(iStep0);
  });
  it('does not oscillate at a steady load that fits only after one rung', () => {
    const aq = createAutoQuality();
    const trace = run(aq, 24, 200, 3);
    const tail = trace.slice(-100); let moves = 0;
    for (let i = 1; i < tail.length; i++) if (tail[i].f !== tail[i - 1].f || tail[i].s !== tail[i - 1].s) moves++;
    expect(moves).toBeLessThanOrEqual(2);
  });
  it('wall-clock only (no timer): drops after two slow windows, rises only after a longer run of good ones', () => {
    const aq = createAutoQuality();
    const slow = { volMs: 0, mainMs: 0, interval: BUDGET * 1.6, budget: BUDGET }, ok = { volMs: 0, mainMs: 0, interval: BUDGET, budget: BUDGET };
    aq.update(slow); expect(aq.f).toBe(1); aq.update(slow); expect(aq.f).toBeLessThan(1);
    const f0 = aq.f;
    for (let i = 0; i < 5; i++) aq.update(ok);
    expect(aq.f).toBe(f0);
    aq.update(ok);
    expect(aq.f).toBeGreaterThan(f0);
  });
  it('a rise that bounces back backs off (longer wait next time)', () => {
    const aq = createAutoQuality();
    const slow = { volMs: 0, mainMs: 0, interval: BUDGET * 1.6, budget: BUDGET }, ok = { volMs: 0, mainMs: 0, interval: BUDGET, budget: BUDGET };
    aq.update(slow); aq.update(slow);
    for (let i = 0; i < 6; i++) aq.update(ok);   // rises
    const up = aq.f; aq.update(slow); aq.update(slow); // bounces
    expect(aq.f).toBeLessThan(up);
    expect(aq.state.penalty).toBeGreaterThan(1);
    const f1 = aq.f;
    for (let i = 0; i < 6; i++) aq.update(ok);
    expect(aq.f).toBe(f1);
  });
  it('setFloor / setBaseStep clamp the live state', () => {
    const aq = createAutoQuality({ min: 0.25 }); run(aq, 400, 200);
    expect(aq.f).toBeCloseTo(0.25, 6);
    aq.setFloor(0.5); expect(aq.f).toBe(0.5);
    aq.setBaseStep(2); expect(aq.stepIdx).toBe(2);
  });
});

// the wall-clock fallback cycled 81 % -> 70 % -> 81 % ... for ever (a small overrun shows as a halved rate)
describe('failed level is remembered', () => {
  const budget = 1000 / 72;
  const quant = load => Math.ceil(load / budget - 1e-9) * budget; // the display halves the rate on a small overrun
  const loadOf = aq => 20 * aq.f * aq.f * STEP_LEVELS[0] / STEP_LEVELS[aq.stepIdx] + 2;
  const drive = (aq, n, ctx = 'a') => { const tr = []; for (let i = 0; i < n; i++) { aq.update({ volMs: 0, mainMs: 0, interval: quant(loadOf(aq)), budget, ctx }); tr.push(aq.f); } return tr; };
  const flips = tr => { let n = 0; for (let i = 1; i < tr.length; i++) if (Math.abs(tr[i] - tr[i - 1]) > 1e-9) n++; return n; };
  it('settles: no resolution moves in the second minute', () => {
    const aq = createAutoQuality();
    const tr = drive(aq, 200);
    expect(flips(tr.slice(100, 118))).toBe(0); // 100..118 samples = 50..59 s
    expect(Math.min(...tr)).toBeGreaterThanOrEqual(0.7 - 1e-9);
  });
  it('does not retry above 0.97x of the level that failed while the context is unchanged', () => {
    const aq = createAutoQuality();
    const tr = drive(aq, 60);
    const peaks = []; for (let i = 1; i < tr.length - 1; i++) if (tr[i] > tr[i - 1] + 1e-9 && tr[i] >= tr[i + 1]) peaks.push(tr[i]);
    // at most one overshoot that fails; afterwards never above 0.97 x the failed level
    expect(peaks.length).toBeLessThanOrEqual(1);
  });
  it('a changed context (view size, segments, section) allows a new attempt', () => {
    const aq = createAutoQuality();
    drive(aq, 80, 'a');
    const settled = aq.f;
    drive(aq, 3, 'b'); // load is the same: it climbs again for one try
    const tr = drive(aq, 40, 'b');
    expect(Math.max(settled, ...tr)).toBeGreaterThan(settled - 1e-9);
    expect(aq.state.penalty).toBeGreaterThanOrEqual(1);
  });
  // vr-view drops the samples of a rebuild's no-jump interim and keys ctx on distInCls, so a lock taken then is cleared once the jumps are back
  it('a lock taken in a heavier interim (ctx …|0) is lifted when the context returns to …|1', () => {
    const run = back => {
      const aq = createAutoQuality();
      for (let i = 0; i < 4; i++) aq.update({ volMs: 0, mainMs: 0, interval: budget * 1.6, budget, ctx: 'v|0' }); // two windows over budget: one step down, locked
      const f0 = aq.f;
      for (let i = 0; i < 30; i++) aq.update({ volMs: 0, mainMs: 0, interval: budget, budget, ctx: back });
      return { f0, f: aq.f };
    };
    const held = run('v|0'), freed = run('v|1');
    expect(held.f0).toBeLessThan(1);
    expect(held.f).toBeCloseTo(held.f0, 6); // same context: held for FAIL_LAPSE
    expect(freed.f).toBeGreaterThan(freed.f0); // the jumps are back: climbs at once
  });
  it('the memory lapses after about 60 s (120 samples)', () => {
    const aq = createAutoQuality();
    drive(aq, 60); const f0 = aq.f;
    const light = []; for (let i = 0; i < 160; i++) { aq.update({ volMs: 0, mainMs: 0, interval: budget, budget, ctx: 'a' }); light.push(aq.f); }
    expect(light[20]).toBeCloseTo(f0, 6);           // still held at 10 s
    expect(aq.f).toBeGreaterThan(f0);               // released afterwards
  });
});

// the data-resolution cap as a ceiling, and the faster reaction to a jump in the covered pixels (zoom)
describe('ceiling (data-resolution cap) and coverage jumps', () => {
  const B = 1000 / 72, over = { volMs: 0, mainMs: 0, interval: B * 1.4, budget: B }, ok = { volMs: 0, mainMs: 0, interval: B, budget: B };
  it('the scale in use is min(level, ceiling); the level is kept and comes back when the ceiling lifts', () => {
    const aq = createAutoQuality(); aq.setCeiling(0.4);
    expect(aq.f).toBeCloseTo(0.4, 9); expect(aq.level).toBe(1);
    aq.update(ok); expect(aq.f).toBeCloseTo(0.4, 9);
    aq.setCeiling(1); expect(aq.f).toBe(1); // zoomed out again: full scale at once (no climb)
  });
  it('the ceiling may lie below the floor (no detail is lost at the cap)', () => {
    const aq = createAutoQuality({ min: 0.5 }); aq.setCeiling(0.2); expect(aq.f).toBeCloseTo(0.2, 9);
  });
  it('an over sample at the ceiling first brings the level down to it, so the first rung really lowers the scale', () => {
    const aq = createAutoQuality(); aq.setCeiling(0.9);
    aq.update({ ...over, cover: 1000 }); aq.update({ ...over, cover: 1000 });
    expect(aq.f).toBeLessThan(0.9); expect(aq.level).toBeLessThan(0.9);
  });
  it('without a coverage jump two over samples are needed (unchanged); after a jump the first one acts and may halve', () => {
    const a = createAutoQuality(); a.update({ ...ok, cover: 1000 }); a.update({ ...over, cover: 1000 }); expect(a.f).toBe(1);
    const b = createAutoQuality(); b.update({ ...ok, cover: 1000 }); b.update({ ...over, interval: B * 3, cover: 20000 });
    expect(b.f).toBeLessThan(1); expect(b.f).toBeGreaterThanOrEqual(0.7 - 1e-9); // the first rung stops at 0.7 (then the step ladder)
    const c = createAutoQuality({ min: 0.25, baseStep: 2 }); c.update({ ...ok, cover: 1000 }); c.update({ ...over, interval: B * 4, cover: 20000 });
    expect(c.f).toBeCloseTo(0.5, 6); // step already at its last rung: the resolution drops by up to JUMP_SCALE at once
  });
  it('the fast reaction lasts a few samples after the jump, then the normal hysteresis is back', () => {
    const aq = createAutoQuality({ min: 0.25, baseStep: 2 }); aq.update({ ...ok, cover: 1000 }); aq.update({ ...ok, cover: 20000 });
    for (let i = 0; i < 6; i++) aq.update({ ...ok, cover: 20000 });
    const f0 = aq.f; aq.update({ ...over, cover: 20000 }); expect(aq.f).toBe(f0);
  });
  it('a drop in coverage raises the resolution at once by the square root of the ratio', () => {
    const aq = createAutoQuality({ min: 0.25, baseStep: 2 });
    aq.update({ ...ok, cover: 1000 }); aq.update({ ...over, interval: B * 4, cover: 16000 }); const f0 = aq.f; expect(f0).toBeLessThan(1);
    aq.update({ ...ok, cover: 4000 }); expect(aq.f).toBeCloseTo(Math.min(1, f0 * 2), 6);
  });
});

// the base march step is STEP_VOXELS (0.85) of the smallest voxel side of the texture in use, not of the full grid
describe('marchStep (per-texture ray-march step)', () => {
  const he = [1.65, 1.2, 0.9];
  it('is 0.85 of the smallest voxel side', () => {
    expect(STEP_VOXELS).toBe(0.85);
    expect(marchStep(he, [512, 512, 512])).toBeCloseTo(0.85 * 1.8 / 512, 12);
    expect(marchStep([1, 1, 1], [100, 50, 200])).toBeCloseTo(0.85 * 2 / 200, 12); // anisotropic: the finest axis decides
  });
  it('halving the grid doubles the step (256³ data takes about half the samples of before)', () => {
    expect(marchStep(he, [256, 256, 256]) / marchStep(he, [512, 512, 512])).toBeCloseTo(2, 12);
    expect(marchStep(he, [256, 200, 128]) / marchStep(he, [512, 400, 256])).toBeCloseTo(2, 12);
  });
  it('follows the actual resolution, not a fixed 256', () => {
    expect(marchStep(he, [384, 384, 384]) / marchStep(he, [512, 512, 512])).toBeCloseTo(512 / 384, 12);
    expect(marchStep(he, [128, 128, 128]) / marchStep(he, [512, 512, 512])).toBeCloseTo(4, 12);
  });
  it('equals the voxelMin uniform x 0.85 and stays positive on degenerate input', () => {
    const dims = [300, 260, 90], voxelMin = Math.min(2 * he[0] / dims[0], 2 * he[1] / dims[1], 2 * he[2] / dims[2]);
    expect(marchStep(he, dims)).toBeCloseTo(voxelMin * 0.85, 12);
    expect(marchStep([0, 0, 0], [0, 0, 0])).toBeGreaterThan(0);
  });
  it('vr-view.js sets the step per texture in useData (and the half copy carries its own step)', () => {
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    const ud = src.slice(src.indexOf('useData=i=>{'), src.indexOf('refreshEdits();', src.indexOf('useData=i=>{')));
    expect(ud).toContain('baseStep=marchStep(vd.halfExt,t.dims)');
    expect(ud).toMatch(/material\.uniforms\.stepSize\.value=baseStep\*/);
    expect(src).toContain('step:marchStep(vd.halfExt,[tw,th,td])');
    expect(src).not.toMatch(/\*scale\*\.85/);
  });
});

// cover must be the screen coverage, independent of the ladder's own scale. Fed cover x eff², a step down looked
// like "shrunk" (raised at once, failPos cleared) and the next sample like "grew" (jump cut): 0.70 -> 0.60 -> 0.70 ... every 0.5 s.
describe('auto quality settles with a constant screen coverage (no self-feedback)', () => {
  const B = 1000 / 72, C = 4e6;
  const run = (volFull, ceil, n = 40) => {
    const aq = createAutoQuality({ min: 0.5 }), seq = [];
    for (let s = 0; s < n; s++) {
      aq.setCeiling(ceil); const eff = Math.min(aq.f, ceil), v = volFull * eff * eff;
      aq.update({ volMs: eff < 1 ? v : 0, mainMs: eff < 1 ? 2 : 2 + v, interval: B, budget: B, ctx: 'x', cover: C });
      seq.push(aq.f.toFixed(3) + '/' + aq.stepIdx);
    }
    return seq;
  };
  for (const [vol, ceil] of [[25, 1], [30, 1], [35, 1], [30, 0.8]]) {
    it('volume ' + vol + ' ms at 100 %, cap ' + ceil + ': the last 20 samples do not move', () => {
      const tail = run(vol, ceil).slice(-20);
      expect(new Set(tail).size).toBe(1);
      expect(+tail[0].split('/')[0]).toBeLessThan(0.7);
    });
  }
  it('vr-view.js passes the screen coverage, not the rendered pixels', () => {
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toMatch(/aq\.update\(\{[^}]*cover:rs\.cover\}\)/);
    expect(src).not.toMatch(/cover:rs\.cover\*/);
  });
});

// a fast zoom-in lowers the resolution at once (anticipate), before the measured ladder reacts; no effect when the scale is not growing fast
describe('anticipate: predictive drop on a fast zoom', () => {
  const FRAME = 1000 / 72;
  // drive anticipate() once per frame with a scale curve; returns the level after each frame
  const zoom = (aq, scaleAt, ms, t0 = 0) => { const lv = []; for (let t = 0; t <= ms; t += FRAME) { aq.anticipate(scaleAt(t), t0 + t); lv.push(aq.level); } return lv; };
  it('scale constant, shrinking, or growing slowly (1.5x in 5 s): nothing changes', () => {
    for (const curve of [() => 1, t => 2 * Math.exp(-t / 3000), t => Math.pow(1.5, t / 5000), t => 1 + 0.0001 * t]) {
      const aq = createAutoQuality(); const lv = zoom(aq, curve, 6000);
      expect(lv.every(v => v === 1)).toBe(true); expect(aq.stepIdx).toBe(0);
    }
  });
  it('jitter of the hand distance (+-2 %) is no growth', () => {
    const aq = createAutoQuality(); let k = 0;
    expect(zoom(aq, () => 1 + 0.02 * Math.sin(k++ * 1.7), 3000).every(v => v === 1)).toBe(true);
  });
  it('a fast zoom (1 -> 2 in 0.6 s) drops the resolution within a few frames, never below the MID rung, and leaves the step alone', () => {
    const aq = createAutoQuality(); const lv = zoom(aq, t => Math.pow(2, Math.min(1, t / 600)), 1000);
    const first = lv.findIndex(v => v < 1);
    expect(first).toBeGreaterThanOrEqual(0); expect(first * FRAME).toBeLessThan(300); // GROW_WINDOW
    expect(lv[lv.length - 1]).toBeLessThan(0.9);
    expect(Math.min(...lv)).toBeGreaterThanOrEqual(AUTO_MID - 1e-9);
    expect(aq.stepIdx).toBe(0);
  });
  it('one call drops by at most GROW_MAX_DROP, and about the inverse of the growth', () => {
    const aq = createAutoQuality();
    aq.anticipate(1, 0); expect(aq.anticipate(1.2, 100)).toBe(true);
    expect(aq.level).toBeCloseTo(1 / 1.2, 6);
    const b = createAutoQuality(); b.anticipate(1, 0); expect(b.anticipate(5, 100)).toBe(true);
    expect(b.level).toBeCloseTo(Math.max(GROW_MAX_DROP, AUTO_MID), 6); // clamped (and by the MID rung)
  });
  it('below GROW_SCALE nothing happens, at it the drop starts', () => {
    const a = createAutoQuality(); a.anticipate(1, 0); expect(a.anticipate(GROW_SCALE - 0.01, 100)).toBe(false); expect(a.level).toBe(1);
    const b = createAutoQuality(); b.anticipate(1, 0); expect(b.anticipate(GROW_SCALE + 0.001, 100)).toBe(true); expect(b.level).toBeLessThan(1);
  });
  it('a continued zoom drops again proportionally, but stops at the MID rung (deeper rungs stay with the measured ladder)', () => {
    const aq = createAutoQuality(); const lv = zoom(aq, t => Math.pow(1.6, t / 1000), 6000);
    expect(lv[lv.length - 1]).toBeCloseTo(AUTO_MID, 6); expect(Math.min(...lv)).toBeGreaterThanOrEqual(AUTO_MID - 1e-9);
    for (let i = 1; i < lv.length; i++) expect(lv[i]).toBeLessThanOrEqual(lv[i - 1] + 1e-12);
  });
  it('already at or below the MID rung: no change (the measured ladder owns that range)', () => {
    const aq = createAutoQuality({ min: 0.35 }); run(aq, 400, 200);
    const before = { f: aq.f, s: aq.stepIdx };
    zoom(aq, t => Math.pow(3, t / 500), 1500);
    expect({ f: aq.f, s: aq.stepIdx }).toEqual(before);
  });
  it('the data-resolution cap already holds the scale in use below the level: the zoom does not lower the level', () => {
    const aq = createAutoQuality(); aq.setCeiling(0.5);
    zoom(aq, t => Math.pow(3, t / 500), 1500);
    expect(aq.level).toBe(1); expect(aq.f).toBe(0.5);
  });
  it('the level already at or below the cap: the drop is floored at the MID rung relative to the cap (0.7 x cap), not at 0.7', () => {
    const aq = createAutoQuality({ f: 0.5 }); aq.setCeiling(0.5);
    aq.anticipate(1, 0); expect(aq.anticipate(1.3, 100)).toBe(true);
    expect(aq.f).toBeLessThan(0.5); expect(aq.f).toBeGreaterThanOrEqual(0.35 - 1e-9);
    zoom(aq, t => 1.3 * Math.pow(3, t / 500), 1500, 200);
    expect(aq.f).toBeCloseTo(0.35, 9); expect(aq.level).toBeCloseTo(AUTO_MID, 9);
    const c = createAutoQuality(); c.anticipate(1, 0); c.anticipate(5, 100); expect(c.f).toBeCloseTo(AUTO_MID, 9); // without a cap: 0.7 as before
  });
  it('measured headroom: no drop while the predicted volume time stays within the budget; the growth since the last measurement accumulates', () => {
    const aq = createAutoQuality();
    aq.update({ volMs: 0, mainMs: 3, interval: BUDGET, budget: BUDGET }); // 3 ms of 13.9
    aq.anticipate(1, 0); expect(aq.anticipate(1.3, 100)).toBe(false); expect(aq.level).toBe(1); // 3 x 1.69 = 5 ms
    expect(aq.anticipate(1.3 * 1.3, 400)).toBe(false);                                                // 3 x 1.69^2 = 8.6 ms
    expect(aq.anticipate(1.3 ** 3, 700)).toBe(true);                                                  // 3 x 1.69^3 = 14.5 ms > 0.9 x budget
    expect(aq.level).toBeLessThan(1);
    // after a new measurement the accumulated growth starts again
    const b = createAutoQuality(); b.update({ volMs: 0, mainMs: 3, interval: BUDGET, budget: BUDGET });
    b.anticipate(1, 0); b.anticipate(1.3, 100); b.update({ volMs: 0, mainMs: 5, interval: BUDGET, budget: BUDGET });
    expect(b.anticipate(1.3 * 1.3, 400)).toBe(false);
  });
  it('no timer query (wall-clock only): no headroom information, so a fast zoom drops', () => {
    const aq = createAutoQuality(); aq.update({ volMs: 0, mainMs: 0, interval: BUDGET, budget: BUDGET });
    aq.anticipate(1, 0); expect(aq.anticipate(1.3, 100)).toBe(true);
  });
  it('bad input is ignored', () => {
    const aq = createAutoQuality();
    expect(aq.anticipate(0, 0)).toBe(false); expect(aq.anticipate(NaN, 10)).toBe(false); expect(aq.anticipate(1, NaN)).toBe(false); expect(aq.level).toBe(1);
  });
  it('the clock going back (a new session) restarts the measurement instead of reading old samples', () => {
    const aq = createAutoQuality(); aq.anticipate(1, 5000); aq.anticipate(1, 5100);
    expect(aq.anticipate(2, 0)).toBe(false); expect(aq.level).toBe(1);
  });
  it('the next 0.5 s window and the recovery are the normal ladder: after the zoom stops the level climbs back to 1 on light frames', () => {
    const aq = createAutoQuality(); zoom(aq, t => Math.pow(2, Math.min(1, t / 600)), 800);
    expect(aq.level).toBeLessThan(0.9);
    const trace = run(aq, 3, 60, 2);
    expect(aq.f).toBe(1); expect(aq.stepIdx).toBe(0);
    expect(trace.length).toBe(60);
  });
  // closed loop on mocked timings: the volume pass costs unit x scale^2 x f^2 ms (unit 7 ms at scale 1); a 0.5 s controller window; the zoom 1 -> 2.2 takes 0.7 s
  const simulate = (withAnticipate, { blind = false } = {}) => {
    const aq = createAutoQuality(); const unit = 7, rest = 2, scaleAt = t => Math.pow(2.2, Math.min(1, Math.max(0, (t - 1000) / 700)));
    let t = 0, winStart = 0, winMs = 0, winN = 0, over = 0, overMs = 0, maxMs = 0, vol = 0, mainSum = 0, volSum = 0;
    while (t < 8000) {
      const s = scaleAt(t); if (withAnticipate) aq.anticipate(s, t);
      const f = aq.f, v = unit * s * s * f * f, ms = rest + v, frame = Math.max(FRAME, ms);
      if (ms > FRAME * 1.1) { over++; overMs += ms - FRAME; } if (t > 1000) maxMs = Math.max(maxMs, ms);
      volSum += f < 1 ? v : 0; mainSum += f < 1 ? rest : ms; winN++; t += frame; winMs = t - winStart;
      if (winMs >= 500) {
        aq.update(blind ? { interval: winMs / winN, budget: FRAME } : { volMs: volSum / winN, mainMs: mainSum / winN, interval: winMs / winN, budget: FRAME, cover: 1e5 * s * s });
        winStart = t; winN = 0; volSum = 0; mainSum = 0;
      }
    }
    return { over, overMs, maxMs, f: aq.f };
  };
  it('closed loop: fewer and shorter over-budget frames after a fast zoom than with the measured ladder alone', () => {
    const base = simulate(false), pre = simulate(true);
    expect(pre.overMs).toBeLessThan(base.overMs * 0.8);
    expect(pre.maxMs).toBeLessThanOrEqual(base.maxMs + 1e-9);
    expect(Math.abs(pre.f - base.f)).toBeLessThan(0.03); // the same steady state: the prediction only brings it forward
  });
  // the window in which anticipate() lowered the level mixes two levels (at f = 1 the main pass holds the volume too): the ladder must not read it as over
  // and take a second, stale drop (which also locked the level it left via failPos and settled a rung lower: 0.805 instead of about 0.89)
  it('closed loop: the window with the predicted drop is not measured again (no second, stale drop; the level is not locked below the predicted one)', () => {
    const aq = createAutoQuality(); const unit = 7, rest = 2, scaleAt = t => Math.pow(1.3, Math.min(1, Math.max(0, (t - 1000) / 300)));
    let t = 0, winStart = 0, winN = 0, volSum = 0, volN = 0, mainSum = 0, dropped = 0; const after = [];
    while (t < 6000) {
      const s = scaleAt(t); if (aq.anticipate(s, t)) dropped = aq.level;
      const f = aq.f, v = unit * s * s * f * f, ms = rest + v;
      if (f < 1) { volSum += v; volN++; } mainSum += f < 1 ? rest : ms; winN++; t += Math.max(FRAME, ms);
      if (t - winStart >= 500) {
        aq.update({ volMs: volN ? volSum / volN : 0, mainMs: mainSum / winN, interval: (t - winStart) / winN, budget: FRAME, cover: 1e5 * s * s, ctx: s.toFixed(2) });
        if (dropped) after.push(aq.level);
        winStart = t; winN = 0; volSum = 0; volN = 0; mainSum = 0;
      }
    }
    expect(dropped).toBeGreaterThan(0.8); expect(dropped).toBeLessThan(1);
    expect(Math.min(...after)).toBeGreaterThanOrEqual(dropped - 1e-9); // 7 x 1.69 x 0.89^2 + 2 = 11.4 ms: within the budget, nothing to lower
    expect(aq.level).toBeGreaterThan(0.85);
  });
  it('the update right after a predicted drop changes nothing and gives anticipate() no headroom information', () => {
    const aq = createAutoQuality(); aq.update({ volMs: 0, mainMs: 6, interval: BUDGET, budget: BUDGET, cover: 1e5 }); // 6 x 4 ms after the zoom: over
    aq.anticipate(1, 0); expect(aq.anticipate(2, 100)).toBe(true); const lv = aq.level;
    const r = aq.update({ volMs: 20, mainMs: 20, interval: 2 * BUDGET, budget: BUDGET, cover: 4e5 }); // the stale, slow window
    expect(r.changed).toBe(false); expect(aq.level).toBe(lv);
    const r2 = aq.update({ volMs: 20, mainMs: 2, interval: 2 * BUDGET, budget: BUDGET, cover: 4e5 }); // the next window measures the new level
    expect(r2.changed).toBe(true); expect(aq.stepIdx).toBe(1); // at the MID rung the ladder coarsens the step next
  });
  it('closed loop without a timer query behaves the same way (and still ends within the ladder)', () => {
    const base = simulate(false, { blind: true }), pre = simulate(true, { blind: true });
    expect(pre.overMs).toBeLessThanOrEqual(base.overMs + 1e-9);
  });
  it('no zoom, no effect: the closed loop with a constant scale is identical with and without anticipate', () => {
    const run2 = on => { const aq = createAutoQuality(); const tr = []; for (let i = 0; i < 40; i++) { if (on) aq.anticipate(1.7, i * 500 / 3); aq.update(sample(aq, 30)); tr.push(aq.f + '/' + aq.stepIdx); } return tr; };
    expect(run2(true)).toEqual(run2(false));
  });
  it('vr-view.js calls anticipate with the holder scale every frame in Auto, not in the benchmarks', () => {
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toMatch(/if\(!bench\.active&&!anBench\.active\)aq\.anticipate\(holder\.scale\.x,nowA\);/);
    expect(src.indexOf('aq.anticipate(')).toBeGreaterThan(src.indexOf('if(auto){\n   autoFrames++'));
  });
});

// at maximum zoom the data-resolution cap (0.4 .. 0.6 for 256^3 data) lies below the floor (0.5) and the MID rung (0.7), so every resolution
// rung was dead (scale in use = min(level, cap) = cap) and only the step 1 -> 2 could act: the ladder stopped at 50 .. 60 fps. The MID rung and the floor are
// now relative to the cap (100 % = full data detail), so the rungs act below it. Without a cap nothing changes.
describe('rungs below the data-resolution cap', () => {
  // closed loop: the volume pass costs `unit` ms at scale 1, step 1; it scales with eff^2 and 1/step; rest = 2 ms
  const loop = (unit, cap, { min = 0.5, n = 80, baseStep = 0 } = {}) => {
    const aq = createAutoQuality({ min, baseStep }), tr = [];
    for (let i = 0; i < n; i++) {
      aq.setCeiling(cap); const eff = aq.f, v = unit * eff * eff * STEP_LEVELS[0] / STEP_LEVELS[aq.stepIdx], low = eff < 1;
      const total = v + 2;
      aq.update({ volMs: low ? v : 0, mainMs: low ? 2 : v + 2, interval: Math.max(BUDGET, total), budget: BUDGET, ctx: 'x', cover: 4e6 });
      tr.push({ eff: aq.f, s: aq.stepIdx, total, lvl: aq.level });
    }
    return { aq, tr };
  };
  const gpu = (unit, aq) => unit * aq.f * aq.f / STEP_LEVELS[aq.stepIdx] + 2;
  it('cap 0.45, a load that step 2 at the cap cannot carry: the scale goes below the cap and the frame fits the budget', () => {
    const unit = 170; // at the cap: 34 ms (step 1), 17 + 2 ms at step 2 (> 13.9 budget)
    const { aq } = loop(unit, 0.45);
    expect(aq.f).toBeLessThan(0.45 - 0.01);
    expect(aq.stepIdx).toBe(STEP_LEVELS.length - 1);
    expect(gpu(unit, aq)).toBeLessThanOrEqual(BUDGET * 0.95);
    expect(aq.f).toBeGreaterThanOrEqual(0.5 * 0.45 - 1e-9); // never below floor x cap
  });
  it('a light load keeps the scale at the cap (no detail given up) and the step at 1', () => {
    const { aq } = loop(40, 0.45); // 8 + 2 ms at the cap
    expect(aq.f).toBeCloseTo(0.45, 6); expect(aq.stepIdx).toBe(0);
  });
  it('a moderate overload costs a moderate drop: the resolution rung (about 0.7 of the cap) comes before the step', () => {
    const { aq, tr } = loop(100, 0.45); // 20 ms at the cap, step 1
    expect(aq.stepIdx).toBe(0);
    expect(aq.f).toBeLessThan(0.45); expect(aq.f).toBeGreaterThanOrEqual(0.7 * 0.45 - 1e-9);
    expect(new Set(tr.slice(-20).map(t => t.eff.toFixed(3) + '/' + t.s)).size).toBe(1); // settled
  });
  it('the bottom rung is floor x cap, and the user floor sets it (35 %: lower)', () => {
    const a = loop(3000, 0.45, { min: 0.5 }).aq, b = loop(3000, 0.45, { min: 0.35 }).aq;
    expect(a.f).toBeCloseTo(0.5 * 0.45, 6); expect(b.f).toBeCloseTo(0.35 * 0.45, 6);
  });
  it('the load goes away: the scale comes back to the cap and the step to 1', () => {
    const { aq } = loop(170, 0.45);
    for (let i = 0; i < 80; i++) aq.update({ volMs: 3, mainMs: 2, interval: BUDGET, budget: BUDGET, ctx: 'x', cover: 4e6 });
    expect(aq.f).toBeCloseTo(0.45, 6); expect(aq.stepIdx).toBe(0);
  });
  it('the cap lifts (zoomed out): the floor rises with it, the scale in use is never below floor x the new cap', () => {
    const { aq } = loop(170, 0.45); aq.setCeiling(1);
    expect(aq.f).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });
  it('the level readout is relative to the cap (never "32 %" under a Min 50 % floor); without a cap it is the scale itself', () => {
    const { aq } = loop(3000, 0.45); expect(aq.level).toBeCloseTo(0.5, 6); expect(aq.f).toBeCloseTo(0.225, 6);
    const { aq: b } = loop(3000, 1); expect(b.level).toBeCloseTo(b.f, 9);
    const c = createAutoQuality(); c.setCeiling(0.4); expect(c.level).toBe(1);
  });
  it('no cap (ceil = 1): the old behaviour, the floor is the user floor', () => {
    const { aq } = loop(3000, 1, { min: 0.5 }); expect(aq.f).toBeCloseTo(0.5, 6);
    const { aq: c } = loop(3000, 1, { min: 0.25 }); expect(c.f).toBeCloseTo(0.25, 6);
  });
});
