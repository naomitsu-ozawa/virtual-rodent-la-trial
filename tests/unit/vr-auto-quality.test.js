import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAutoQuality, autoFloor, STEP_LEVELS, AUTO_FLOORS, marchStep, STEP_VOXELS } from '../../docs/vr-auto-quality.js';

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
