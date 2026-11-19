import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HOLD_SCALE, HOLD_MIN, HOLD_MAX, HOLD_STEP, HOLD_RELEASE_MS, HOLD_MIN_OFF_MS, holdScaleOf, holdScaleValue, holdAllowed, createHoldGate, applyHoldScale, CAP_MIN, PPV_CENTER } from '../../docs/vr-render-scale.js';
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

describe('the menu value (settings.moveLowK) is the factor', () => {
  it('the slider value becomes holdK: every step in range comes out as itself', () => {
    for (let i = 0; i <= 9; i++) {
      const k = Math.round((HOLD_MIN + i * HOLD_STEP) * 100) / 100;
      expect(holdScaleOf({ ...base, scale: k })).toBe(k);
      expect(holdScaleValue(HOLD_MIN + (i / 9) * (HOLD_MAX - HOLD_MIN))).toBe(k); // the slider position 0..1 as vr-view.js maps it
    }
    expect(holdScaleOf({ ...base, scale: 0.65 })).toBe(0.65);
    expect(holdScaleOf(base)).toBe(HOLD_SCALE); // no value given: the default
  });
  it('the range: the bottom is above CAP_MIN, the top is below 1 (1 = no cut = the setting off), the default is inside, "stronger" than the default is selectable', () => {
    expect(HOLD_MAX).toBeLessThan(1);
    expect(HOLD_MIN).toBeGreaterThan(CAP_MIN);
    expect(HOLD_SCALE).toBeGreaterThanOrEqual(HOLD_MIN); expect(HOLD_SCALE).toBeLessThanOrEqual(HOLD_MAX);
    expect(HOLD_MIN).toBeLessThan(HOLD_SCALE); // "stronger" is selectable
    // a value at or above LOW_BELOW is not swallowed: the factor is applied after the guard, so the direct path's rounding never sees it
    expect(HOLD_MAX).toBeGreaterThanOrEqual(LOW_BELOW);
    const p = makePipe(); p.frame(0, { raw: 1 });
    expect(p.frame(20, { raw: 1, held: 1, scale: HOLD_MAX }).f).toBeCloseTo(HOLD_MAX, 12);
  });
  it('out of range / not a number: clamped to the ends / the default; between steps: rounded to a step', () => {
    expect(holdScaleValue(0.96)).toBe(HOLD_MAX); expect(holdScaleValue(1)).toBe(HOLD_MAX); expect(holdScaleValue(5)).toBe(HOLD_MAX);
    expect(holdScaleValue(0.2)).toBe(HOLD_MIN); expect(holdScaleValue(0)).toBe(HOLD_MIN); expect(holdScaleValue(-1)).toBe(HOLD_MIN);
    expect(holdScaleValue(undefined)).toBe(HOLD_SCALE); expect(holdScaleValue(null)).toBe(HOLD_SCALE); expect(holdScaleValue(NaN)).toBe(HOLD_SCALE); expect(holdScaleValue('x')).toBe(HOLD_SCALE); expect(holdScaleValue('')).toBe(HOLD_SCALE);
    expect(holdScaleValue('0.7')).toBe(0.7);
    expect(holdScaleValue(0.74)).toBe(0.75); expect(holdScaleValue(0.71)).toBe(0.7);
    expect(holdScaleOf({ ...base, scale: 3 })).toBe(HOLD_MAX); expect(holdScaleOf({ ...base, scale: NaN })).toBe(HOLD_SCALE);
    expect(holdScaleOf({ ...base, scale: 0.6, enabled: false })).toBe(1); // the setting off wins over any value
  });
  it('holdAllowed = the restoring situations', () => {
    expect(holdAllowed({ enabled: true, webgpu: true })).toBe(true);
    for (const o of [{ enabled: false }, { webgpu: false }, { live: false }, { recording: true }, { bench: true }]) expect(holdAllowed({ enabled: true, webgpu: true, ...o })).toBe(false);
  });
});

// the frame pipeline of vr-view.js: base scale -> scale guard (does not see the hold) -> hold gate -> factor applied after the guard
function makePipe(opts = {}) {
  const guard = createScaleGuard(), gate = createHoldGate(), out = [];
  return {
    guard, gate, out,
    frame(t, { raw = 1, held = 0, scale = HOLD_SCALE, ...cond } = {}) {
      const c = { ...base, ...cond };
      const on = gate.step(held > 0, t, { allowed: holdAllowed(c) });
      const k = holdScaleOf({ ...c, heldTracked: on ? 1 : 0, scale });
      const fg = guard.step(raw, t), f = applyHoldScale(fg, k);
      out.push(f); return { f, k, fg, on };
    },
  };
}
const FR = 1000 / 72;
const changesIn = (ts, vs, windowMs) => { // the most scale changes inside any window of windowMs
  const ch = []; for (let i = 1; i < vs.length; i++) if (Math.abs(vs[i] - vs[i - 1]) > 1e-9) ch.push(ts[i]);
  let m = 0; for (let i = 0; i < ch.length; i++) m = Math.max(m, ch.filter(c => c >= ch[i] && c < ch[i] + windowMs).length); return m;
};

describe('grab / release through the pipeline: the scale guard does not count them', () => {
  it('one grab and one release: HOLD_SCALE while held, back to 1 after the release delay, no freeze', () => {
    const p = makePipe(), ts = [], vs = [];
    for (let i = 0; i < 160; i++) { const t = i * FR, r = p.frame(t, { held: i >= 10 && i < 60 ? 1 : 0 }); ts.push(t); vs.push(r.f); }
    expect(vs.slice(0, 10).every(v => v === 1)).toBe(true);
    expect(vs.slice(10, 60).every(v => Math.abs(v - HOLD_SCALE) < 1e-9)).toBe(true);
    expect(vs[59 + Math.ceil(HOLD_RELEASE_MS / FR) - 2]).toBeCloseTo(HOLD_SCALE, 12); // still reduced shortly after the release
    expect(vs.at(-1)).toBe(1);
    expect(p.guard.freezes).toBe(0);
  });
  it('grip chatter (grab / release every 3 frames for 5 s): the guard never freezes, the reduction stays on, no change after the first', () => {
    const p = makePipe(), ts = [], vs = [];
    for (let i = 0; i < 360; i++) { const t = i * FR, r = p.frame(t, { held: Math.floor(i / 3) % 2 }); ts.push(t); vs.push(r.f); }
    expect(p.guard.freezes).toBe(0);
    let changes = 0; for (let i = 1; i < vs.length; i++) if (vs[i] !== vs[i - 1]) changes++;
    expect(changes).toBe(1); // 1 -> HOLD_SCALE once and it stays (every pulse re-arms the release delay)
    expect(vs.at(-1)).toBeCloseTo(HOLD_SCALE, 12);
  });
  it('slow repeated grabs (hold 0.7 s, free 0.5 s .. 0.9 s, many times): never more than 2 changes in any second, no freeze', () => {
    for (const gap of [500, 700, 900, 1100]) {
      const p = makePipe(), ts = [], vs = []; let t = 0;
      for (let rep = 0; rep < 12; rep++) {
        for (let tt = 0; tt < 700; tt += FR) { const r = p.frame(t, { held: 1 }); ts.push(t); vs.push(r.f); t += FR; }
        for (let tt = 0; tt < gap; tt += FR) { const r = p.frame(t, { held: 0 }); ts.push(t); vs.push(r.f); t += FR; }
      }
      expect(p.guard.freezes).toBe(0);
      expect(changesIn(ts, vs, 1000)).toBeLessThanOrEqual(2);
    }
  });
  it('worst case for the gate: a one-frame grab right when the release delay ends, again and again: at most 2 changes in 1 s and the off period lasts HOLD_MIN_OFF_MS', () => {
    const g = createHoldGate(), ts = [], st = []; let t = 0, next = 0;
    for (let i = 0; i < 2000; i++) { const held = t >= next; if (held) next = t + HOLD_RELEASE_MS + 1; st.push(g.step(held, t)); ts.push(t); t += FR; }
    expect(changesIn(ts, st.map(Number), 1000)).toBeLessThanOrEqual(2);
    let offAt = null, minOff = Infinity; for (let i = 1; i < st.length; i++) { if (st[i - 1] && !st[i]) offAt = ts[i]; if (!st[i - 1] && st[i] && offAt !== null) minOff = Math.min(minOff, ts[i] - offAt); }
    expect(minOff).toBeGreaterThanOrEqual(HOLD_MIN_OFF_MS - 1e-9);
  });
  it('a grab while the ordinary scale is frozen by the guard is reduced like any other (the hold does not wait for the guard)', () => {
    const p = makePipe();
    for (let i = 0; i < 100; i++) p.frame(i * FR, { raw: i % 6 < 3 ? 0.6 : 0.5, held: 0 });
    expect(p.guard.frozenAt(99 * FR)).toBe(true);
    const r = p.frame(100 * FR, { raw: 0.6, held: 1 });
    expect(r.on).toBe(true); expect(r.f).toBeCloseTo(r.fg * HOLD_SCALE, 12);
  });
});

describe('not held: the scale guard behaves as before', () => {
  it('the same ordinary scale changes give the same output as a plain guard, including a freeze, with the hold setting on and no hand holding', () => {
    const p = makePipe(), plain = createScaleGuard(); const a = [], b = [];
    for (let i = 0; i < 400; i++) { const t = i * FR, raw = [1, 0.7, 0.6, 0.65, 0.95, 1, 0.5][(i * 7 + (i >> 3)) % 7]; a.push(p.frame(t, { raw, held: 0 }).f); b.push(plain.step(raw, t)); }
    expect(a).toEqual(b);
    expect(p.guard.freezes).toBe(plain.freezes); expect(plain.freezes).toBeGreaterThan(0); // the sequence does flap: the guard still works
  });
  it('the ordinary scale flapping while held is still frozen by the guard', () => {
    const p = makePipe(); let changes = 0, prev = null;
    for (let i = 0; i < 144; i++) { const f = p.frame(i * FR, { raw: i % 6 < 3 ? 0.6 : 0.5, held: 1 }).f; if (prev !== null && Math.abs(f - prev) > 1e-9) changes++; prev = f; }
    expect(p.guard.freezes).toBeGreaterThan(0);
    expect(changes).toBeLessThanOrEqual(8);
  });
});

describe('tracking: short breaks keep the reduction, a long loss restores', () => {
  it('heldTracked = 0 for 150 ms in the middle of a hold (a short break, under the 200 ms of the tracking cancel): no change at all', () => {
    const p = makePipe(), vs = [];
    for (let i = 0; i < 120; i++) { const t = i * FR, lost = t >= 500 && t < 650; vs.push(p.frame(t, { held: lost ? 0 : 1 }).f); }
    expect(vs.slice(0, 1).every(v => Math.abs(v - HOLD_SCALE) < 1e-9)).toBe(true);
    expect(vs.every(v => Math.abs(v - HOLD_SCALE) < 1e-9)).toBe(true);
  });
  it('a break of 500 ms (still under the release delay) also keeps it; a loss of 1 s (the hand is dropped) restores it', () => {
    const p = makePipe(), vs = [], ts = [];
    for (let i = 0; i < 300; i++) { const t = i * FR; ts.push(t); vs.push(p.frame(t, { held: t < 500 || (t >= 1000 && t < 2000) ? 1 : (t >= 2000 ? 0 : 0) }).f); }
    const at = ms => vs[ts.findIndex(t => t >= ms)];
    expect(at(800)).toBeCloseTo(HOLD_SCALE, 12);  // 300 ms into the break
    expect(at(1500)).toBeCloseTo(HOLD_SCALE, 12);
    expect(at(2000 + HOLD_RELEASE_MS + 100)).toBe(1); // long loss: back to 1 once the delay has passed
  });
});

describe('restoring situations are immediate (no release delay)', () => {
  it.each([['setting off', { enabled: false }], ['session over', { live: false }], ['breakdown recording', { recording: true }], ['benchmark', { bench: true }], ['WebGL', { webgpu: false }]])('%s: 1 on the very frame, even while held', (_n, cond) => {
    const p = makePipe();
    for (let i = 0; i < 20; i++) p.frame(i * FR, { held: 1 });
    expect(p.out.at(-1)).toBeCloseTo(HOLD_SCALE, 12);
    const r = p.frame(20 * FR, { held: 1, ...cond });
    expect(r.f).toBe(1);
  });
});

describe('wiring in docs/vr-view.js (source)', () => {
  it('the setting exists (on by default, factor default 0.8); the menu rows are shown in the WebGPU view only; ja + en text for the slider', () => {
    expect(vr).toMatch(/DEFAULTS=\{[^}]*\bmoveLow:1\b/);
    expect(vr).toMatch(/DEFAULTS=\{[^}]*\bmoveLowK:0\.8\b/); expect(HOLD_SCALE).toBe(0.8); // a literal: other tests evaluate the DEFAULTS text on its own
    expect(vr).toMatch(/if\(gx\)choice\(y0\+\d+,L\.moveLow,/);
    expect(vr).toMatch(/if\(gx\)\{const hk=holdScaleValue\(settings\.moveLowK\)/);
    expect(vr).toMatch(/moveLow:'[^']+'/);
    expect((vr.match(/\bmoveLow:'/g) || []).length).toBe(2);
    expect((vr.match(/\bmoveLowK:'/g) || []).length).toBe(2);
    expect(vr).toMatch(/type:'slider',x:CX\+26,y:y0\+960,w:300,h:72,value:\(hk-HOLD_MIN\)\/\(HOLD_MAX-HOLD_MIN\)/); // the same slider part as 濃淡の明るさ
  });
  it('the frame loop feeds the factor from the held hands that are still connected through the hold gate, applied after the scale guard', () => {
    const m = vr.match(/const heldTracked=[^\n]*\n[^\n]*holdOn=holdGate\.step[^\n]*\n[^\n]*fRaw=[^\n]*\n[^\n]*scaleGuard\.step\(fRaw,nowG\)[^\n]*/);
    expect(m).toBeTruthy();
    const t = m[0];
    expect(t).toContain('grabbing.has(c)&&c.userData.source');
    expect(t).toContain('enabled:!!settings.moveLow');
    expect(t).toContain('webgpu:!!gx');
    expect(t).toContain('live:running?.session===session');
    expect(t).toMatch(/recording:gxRec\.phase==='prep'\|\|gxRec\.on/);
    expect(t).toContain('bench:benchOn');
    expect(t).toContain('scale:settings.moveLowK');
    expect(t).toContain('f=applyHoldScale(fG,holdK)'); // after the guard
    expect(t).not.toMatch(/scaleGuard\.step\([^)]*holdK/); // the guard never sees the hold
  });
  it('the auto ladder is fed with the factor really applied; the performance record gets hset and hk', () => {
    expect(vr).toContain('freeVolMs(gt.ms,holdKA)');
    expect(vr).toMatch(/hset:settings\.moveLow\?holdScaleValue\(settings\.moveLowK\):0,hk:hkMin/);
  });
});
