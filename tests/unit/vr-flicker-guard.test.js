import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFlapGuard, createScaleGuard, variantFallback, LOW_BELOW, FLAP_MAX, FLAP_WINDOW_MS, FLAP_HOLD_MS } from '../../docs/vr-flicker-guard.js';
import { createAutoQuality } from '../../docs/vr-auto-quality.js';
import { nextCap } from '../../docs/vr-render-scale.js';

const FRAME = 1000 / 72;
// how many times a sequence of per-frame values changes within each second (the worst second)
const worstPerSecond = (vals, eq = (a, b) => a === b) => {
  let worst = 0;
  for (let s = 0; s * 72 < vals.length; s++) {
    let n = 0;
    for (let i = Math.max(1, s * 72); i < Math.min(vals.length, (s + 1) * 72); i++) if (!eq(vals[i], vals[i - 1])) n++;
    worst = Math.max(worst, n);
  }
  return worst;
};

describe('flap guard (categorical)', () => {
  it('a value alternating every frame is frozen after a few flaps and takes the fallback', () => {
    const g = createFlapGuard({ fallback: variantFallback });
    const out = [];
    for (let i = 0; i < 72 * 3; i++) out.push(g.step(i % 2 ? 'combined' : 'noEvents', i * FRAME));
    expect(g.freezes).toBeGreaterThanOrEqual(1);
    expect(worstPerSecond(out)).toBeLessThanOrEqual(FLAP_MAX + 2);
    expect(out.slice(20)).toEqual(out.slice(20).map(() => 'combined'));
  });
  it('a single change (a section shown) passes at once, no freeze', () => {
    const g = createFlapGuard({ fallback: () => 'full' });
    expect(g.step('noEvents', 0)).toBe('noEvents');
    expect(g.step('combined', 100)).toBe('combined');
    expect(g.step('combined', 200)).toBe('combined');
    expect(g.step('noEvents', 5000)).toBe('noEvents');
    expect(g.freezes).toBe(0);
  });
  it('the hold ends: a value that settles is taken again', () => {
    const g = createFlapGuard({ fallback: () => 'full' });
    let t = 0; for (let i = 0; i < 20; i++, t += FRAME) g.step(i % 2 ? 'a' : 'b', t);
    expect(g.frozenAt(t)).toBe(true);
    t += FLAP_HOLD_MS + 10;
    expect(g.step('a', t)).toBe('a');
    expect(g.frozenAt(t)).toBe(false);
  });
});

describe('variant fallback while held', () => {
  it('the combined texture in use: the jump-loop variant with the section events (combined), never the general-loop one; full stays full; CLS4 kept', () => {
    expect(variantFallback('noEvents')).toBe('combined');
    expect(variantFallback('combined')).toBe('combined');
    expect(variantFallback('noEvents4')).toBe('combined4');
    expect(variantFallback('combined4')).toBe('combined4');
    expect(variantFallback('full')).toBe('full');
    expect(variantFallback('full4')).toBe('full4');
  });
});

describe('scale guard', () => {
  it('direct path holds down to LOW_BELOW; below it the offscreen path; back to direct only at 1', () => {
    const g = createScaleGuard();
    expect(g.step(1, 0)).toBe(1);
    expect(g.step(0.96875, 100)).toBe(1);
    expect(g.step(LOW_BELOW, 200)).toBe(1);
    expect(g.step(0.85, 300)).toBeCloseTo(0.85);
    expect(g.direct).toBe(false);
    expect(g.step(0.96875, 400)).toBeCloseTo(0.96875); // offscreen stays offscreen until 1
    expect(g.step(1, 500)).toBe(1);
    expect(g.direct).toBe(true);
  });
  it('a steady zoom (scale falling every frame) is never frozen', () => {
    const g = createScaleGuard();
    const out = []; for (let i = 0; i < 72 * 2; i++) out.push(g.step(1 - i * 0.004, i * FRAME));
    expect(g.freezes).toBe(0);
    expect(out[out.length - 1]).toBeCloseTo(1 - 143 * 0.004);
  });
  it('a scale alternating across the path boundary every frame is frozen (no strobe)', () => {
    const g = createScaleGuard();
    const out = []; for (let i = 0; i < 72 * 3; i++) out.push(g.step(i % 2 ? 1 : 0.5, i * FRAME));
    expect(g.freezes).toBeGreaterThanOrEqual(1);
    expect(worstPerSecond(out.map(f => f < 1))).toBeLessThanOrEqual(FLAP_MAX + 1);
  });
  it('the real ladder + data-resolution cap with head bob around 0.97 and a light volume pass: the path no longer alternates', () => {
    // without the guard this sequence switched direct <-> offscreen about 3 times a second (aq.f 0.969 <-> 1 with the cap's 1/32 steps)
    for (const gpu of [false, true]) {
      const aq = createAutoQuality({ min: 0.5 }), g = createScaleGuard();
      let t = 0, at = 0, cap = 0; const raw = [], used = [];
      for (let i = 0; i < 72 * 20; i++) {
        cap = nextCap(cap, 0.97 + 0.04 * Math.sin(2 * Math.PI * 1.5 * t / 1000));
        aq.setCeiling(cap); aq.anticipate(1, t);
        const f = aq.f, cost = f < 1 ? 9 * f * f + 3 : 12;
        if (t - at >= 500) { aq.update({ volMs: gpu ? (f < 1 ? 9 * f * f : 0) : 0, mainMs: gpu ? (f < 1 ? 3 : 12) : 0, interval: Math.max(FRAME, cost), budget: FRAME, ctx: 'x', cover: 1e6 }); at = t; }
        raw.push(f < 1); used.push(g.step(f, t) < 1);
        t += Math.max(FRAME, cost);
      }
      expect(worstPerSecond(raw)).toBeGreaterThanOrEqual(2); // the unguarded input does flap
      expect(worstPerSecond(used)).toBeLessThanOrEqual(1);
    }
  });
});

describe('vr-view.js wiring', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('the scale, the foveation and the variant pass through the guards', () => {
    expect(src).toMatch(/scaleGuard\.step\(fRaw,nowG\)/);
    expect(src).toMatch(/fovGuard\.step\(fovRaw,nowG\)/);
    expect(src).toMatch(/variantGuard\.step\(variantKey\(\),nowG\)/);
    expect(src).toMatch(/rayVariants\)\[vk\]/);
    expect(src).toMatch(/variants\)\[vk\]/);
  });
  it('the variant guard falls back with variantFallback (not a fixed heavy variant)', () => {
    expect(src).toMatch(/variantGuard=createFlapGuard\(\{fallback:variantFallback\}\)/);
  });
  it('session end releases the WebGL context at once (VR <-> AR switches must not pile up contexts)', () => {
    const c = src.slice(src.indexOf('const cleanup=()=>{'), src.indexOf("session.addEventListener('end',()=>{cleanup()"));
    expect(c).toMatch(/renderer\.dispose\(\);try\{renderer\.forceContextLoss\?\.\(\)\}catch\{\}/);
  });
  it('window constants: at most a few changes a second', () => {
    expect(FLAP_MAX).toBeLessThanOrEqual(3); expect(FLAP_WINDOW_MS).toBeGreaterThanOrEqual(1000);
  });
});
