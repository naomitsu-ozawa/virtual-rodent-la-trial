import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAutoQuality, STEP_LEVELS } from '../../docs/vr-auto-quality.js';

// the WebGPU view never feeds the main-pass time (mainMs = 0), so update() runs on the frame-interval path. A window that holds a frame drawn at the hold scale
// (held) is lighter than the level's own cost and must never raise the level; a lowering and the unheld behaviour stay as they were.
const BUDGET = 1000 / 72;
const OK = { mainMs: 0, interval: BUDGET, budget: BUDGET };          // frames on time: the interval path would raise
const SLOW = { mainMs: 0, interval: BUDGET * 1.3, budget: BUDGET };  // frames dropped: the interval path lowers

describe('held window (frame-interval path, mainMs = 0)', () => {
  it('without held the level rises on on-time frames (the premise of the tests below)', () => {
    const aq = createAutoQuality({ f: 0.6 });
    for (let i = 0; i < 30; i++) aq.update({ ...OK, ctx: 'a' });
    expect(aq.f).toBeGreaterThan(0.6);
  });
  it('held windows in a row: neither the resolution nor the step rises', () => {
    const aq = createAutoQuality({ f: 0.6 }); aq.setBaseStep(0);
    const f0 = aq.f, s0 = aq.stepIdx;
    for (let i = 0; i < 200; i++) { aq.update({ ...OK, ctx: 'a', held: true }); expect(aq.f).toBe(f0); expect(aq.stepIdx).toBe(s0); }
  });
  it('held windows in a row on a lowered step: the step does not come back either', () => {
    const aq = createAutoQuality({ f: 0.7 });
    for (let i = 0; i < 40; i++) aq.update({ ...SLOW, ctx: 'a' }); // down the ladder
    const f0 = aq.f, s0 = aq.stepIdx; expect(s0).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) aq.update({ ...OK, ctx: 'a', held: true });
    expect(aq.f).toBe(f0); expect(aq.stepIdx).toBe(s0);
  });
  it('a change of the view (ctx) or of the covered pixels does not open a rise while held', () => {
    const aq = createAutoQuality({ f: 0.6 });
    for (let i = 0; i < 4; i++) aq.update({ ...SLOW, ctx: 'a', cover: 1000 }); // a failed level is recorded
    const f0 = aq.f, s0 = aq.stepIdx;
    for (let i = 0; i < 100; i++) {
      aq.update({ ...OK, ctx: 'k' + i, cover: i % 2 ? 100 : 1000, held: true }); // ctx changes every window; coverage falls by far more than the JUMP factor every other window
      expect(aq.f).toBe(f0); expect(aq.stepIdx).toBe(s0);
    }
  });
  it('a zoom-out (covered pixels fall) while held does not raise at once', () => {
    const aq = createAutoQuality({ f: 0.5 });
    aq.update({ ...OK, ctx: 'a', cover: 4000, held: true });
    aq.update({ ...OK, ctx: 'a', cover: 1000, held: true });
    expect(aq.f).toBe(0.5);
    const b = createAutoQuality({ f: 0.5 }); // the same without held does raise at once (the path being blocked)
    b.update({ ...OK, ctx: 'a', cover: 4000 }); b.update({ ...OK, ctx: 'a', cover: 1000 });
    expect(b.f).toBeGreaterThan(0.5);
  });
  it('a held window with dropped frames still lowers the level', () => {
    const aq = createAutoQuality({ f: 0.9 });
    for (let i = 0; i < 6; i++) aq.update({ ...SLOW, ctx: 'a', held: true });
    expect(aq.f).toBeLessThan(0.9);
  });
  it('a held window resets the good count: the rise needs its whole run of unheld windows after it', () => {
    const aq = createAutoQuality({ f: 0.6 });
    for (let i = 0; i < 5; i++) aq.update({ ...OK, ctx: 'a' });
    expect(aq.f).toBe(0.6); // UP_N_BLIND = 6: not yet
    aq.update({ ...OK, ctx: 'a', held: true });
    for (let i = 0; i < 5; i++) aq.update({ ...OK, ctx: 'a' });
    expect(aq.f).toBe(0.6); // the held window took the run back to zero
    aq.update({ ...OK, ctx: 'a' });
    expect(aq.f).toBeGreaterThan(0.6);
  });
  it('held = false / absent: the same states as before, window by window (frame-interval path and timer path)', () => {
    const feeds = [];
    for (let i = 0; i < 400; i++) {
      const k = i % 37;
      feeds.push(k < 14 ? { ...OK, ctx: 'a', cover: 1000 } : k < 18 ? { ...SLOW, ctx: 'a', cover: 3000 } : k < 30 ? { ...OK, ctx: 'b' + (i >> 6), cover: 900 } : { volMs: 6 + (k % 5), mainMs: 2, interval: BUDGET, budget: BUDGET, ctx: 'c', cover: 500 + 40 * k });
    }
    const a = createAutoQuality({ f: 0.8 }), b = createAutoQuality({ f: 0.8 }), c = createAutoQuality({ f: 0.8 });
    for (const x of feeds) {
      const ra = a.update(x), rb = b.update({ ...x, held: false }), rc = c.update({ ...x, held: undefined });
      expect(rb).toEqual(ra); expect(rc).toEqual(ra); expect(b.state).toEqual(a.state); expect(c.state).toEqual(a.state);
    }
  });
});

describe('vr-view.js passes the held mark', () => {
  const view = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('aq.update gets held:heldWin', () => { expect(view).toContain('cover:rs.cover,held:heldWin}'); });
  it('the mark is set only after a frame is really drawn at the hold scale (holdKA < 1), after the draw and after holdKA is computed', () => {
    const iDraw = view.indexOf('gx.vol.draw({'), iSet = view.indexOf('if(auto&&holdKA<1)heldWin=true'), iK = view.indexOf('holdKA=holdK<1&&fG>0');
    expect(iK).toBeGreaterThan(0); expect(iDraw).toBeGreaterThan(iK); expect(iSet).toBeGreaterThan(iDraw);
    expect(view.indexOf('heldWin=true')).toBe(iSet + 'if(auto&&holdKA<1)'.length); expect(view.split('heldWin=true').length).toBe(2); // the only place the mark is set
    expect(view).not.toMatch(/heldWin=(settings|holdOn|heldTracked|holdK\b)/); // never taken from the setting or from "is held"
  });
  it('the mark goes back with the window (the window reset and the recording / preparing reset)', () => {
    expect(view).toContain('autoFrames=0;heldWin=false;autoAt=nowA;ctrl.vol=ctrl.main=0;ctrlN.vol=ctrlN.main=0}');
    expect(view).toContain('ctrl.vol=ctrl.main=0;ctrlN.vol=ctrlN.main=0;autoFrames=0;heldWin=false;autoAt=nowA;');
  });
});
