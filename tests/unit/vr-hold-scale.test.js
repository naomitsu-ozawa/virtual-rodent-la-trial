import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HOLD_SCALE, holdScaleOf, applyHoldScale, CAP_MIN, PPV_CENTER } from '../../docs/vr-render-scale.js';
import { createScaleGuard, LOW_BELOW } from '../../docs/vr-flicker-guard.js';

const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const base = { enabled: true, webgpu: true, live: true, heldTracked: 1, recording: false, bench: false };

describe('holdScaleOf: the render scale factor while the volume is held (WebGPU view)', () => {
  it('held by a tracked hand, setting on, WebGPU, live, no recording: the hold scale', () => {
    expect(holdScaleOf(base)).toBe(HOLD_SCALE);
    expect(holdScaleOf({ ...base, heldTracked: 2 })).toBe(HOLD_SCALE); // two hands (scaling) too
  });
  it('the constant is a mild, guard-safe value: above the floor, below LOW_BELOW, centre keeps one pixel per voxel at the cap', () => {
    expect(HOLD_SCALE).toBeLessThan(LOW_BELOW);
    expect(HOLD_SCALE).toBeGreaterThan(CAP_MIN);
    expect(PPV_CENTER * HOLD_SCALE).toBeGreaterThanOrEqual(1);
  });
  it('not held (or every holding hand lost its tracking): 1', () => {
    expect(holdScaleOf({ ...base, heldTracked: 0 })).toBe(1);
    expect(holdScaleOf()).toBe(1);
  });
  it('each of the restoring situations gives 1: setting off, WebGL view, session over, breakdown recording, benchmark', () => {
    expect(holdScaleOf({ ...base, enabled: false })).toBe(1);
    expect(holdScaleOf({ ...base, webgpu: false })).toBe(1);
    expect(holdScaleOf({ ...base, live: false })).toBe(1);
    expect(holdScaleOf({ ...base, recording: true })).toBe(1);
    expect(holdScaleOf({ ...base, bench: true })).toBe(1);
  });
  it('a frame sequence: grab -> hold -> release changes the factor exactly twice, and a recording started during the hold restores it at once', () => {
    const seq = [0, 0, 1, 1, 1, 1, 0, 0].map(n => holdScaleOf({ ...base, heldTracked: n }));
    expect(seq).toEqual([1, 1, HOLD_SCALE, HOLD_SCALE, HOLD_SCALE, HOLD_SCALE, 1, 1]);
    const rec = [false, false, true, true].map(r => holdScaleOf({ ...base, recording: r }));
    expect(rec).toEqual([HOLD_SCALE, HOLD_SCALE, 1, 1]);
  });
});

describe('applyHoldScale', () => {
  it('factor 1 returns the scale itself; below 1 multiplies, never under CAP_MIN', () => {
    expect(applyHoldScale(0.7, 1)).toBe(0.7);
    expect(applyHoldScale(1, HOLD_SCALE)).toBeCloseTo(HOLD_SCALE, 12);
    expect(applyHoldScale(0.5, HOLD_SCALE)).toBeCloseTo(0.5 * HOLD_SCALE, 12);
    expect(applyHoldScale(CAP_MIN, HOLD_SCALE)).toBe(CAP_MIN);
  });
});

describe('through the scale guard (the hold goes through it like every other scale change)', () => {
  it('one grab and one release: the scale is HOLD_SCALE while held (not swallowed by the direct-path hysteresis) and 1 again right after', () => {
    const g = createScaleGuard(), out = [];
    for (let i = 0; i < 30; i++) out.push(g.step(applyHoldScale(1, holdScaleOf({ ...base, heldTracked: i >= 10 && i < 20 ? 1 : 0 })), i * 14));
    expect(out.slice(0, 10).every(v => v === 1)).toBe(true);
    expect(out.slice(10, 20).every(v => Math.abs(v - HOLD_SCALE) < 1e-9)).toBe(true);
    expect(out.slice(20).every(v => v === 1)).toBe(true);
    expect(g.freezes).toBe(0);
  });
  it('grip chatter (grab / release every few frames) is limited by the guard: it freezes instead of alternating faster than about 3 Hz', () => {
    const g = createScaleGuard(), out = [];
    for (let i = 0; i < 144; i++) out.push(g.step(applyHoldScale(1, holdScaleOf({ ...base, heldTracked: Math.floor(i / 3) % 2 })), i * (1000 / 72)));
    let changes = 0; for (let i = 1; i < out.length; i++) if (out[i] !== out[i - 1]) changes++;
    expect(g.freezes).toBeGreaterThan(0);
    expect(changes).toBeLessThanOrEqual(8); // 2 s of chatter at 12 Hz would be 48 changes unguarded
  });
});

describe('wiring in docs/vr-view.js (source)', () => {
  it('the setting exists and is on by default; the menu row is shown in the WebGPU view only', () => {
    expect(vr).toMatch(/DEFAULTS=\{[^}]*\bmoveLow:1\b/);
    expect(vr).toMatch(/if\(gx\)choice\(y0\+\d+,L\.moveLow,/);
    expect(vr).toMatch(/moveLow:'[^']+'/); // ja
    expect((vr.match(/\bmoveLow:'/g) || []).length).toBe(2); // ja + en
  });
  it('the frame loop feeds the scale from the held hands that are still connected, the WebGPU view, the session, the breakdown and the benchmarks', () => {
    const m = vr.match(/const heldTracked=[^\n]*\n[^\n]*fRaw=applyHoldScale\([^\n]*/);
    expect(m).toBeTruthy();
    const t = m[0];
    expect(t).toContain('grabbing.has(c)&&c.userData.source');
    expect(t).toContain('enabled:!!settings.moveLow');
    expect(t).toContain('webgpu:!!gx');
    expect(t).toContain('live:running?.session===session');
    expect(t).toMatch(/recording:gxRec\.phase==='prep'\|\|gxRec\.on/);
    expect(t).toContain('bench:benchOn');
    expect(vr).toContain('const f=benchOn?fRaw:scaleGuard.step(fRaw,nowG)'); // still through the guard
  });
});
