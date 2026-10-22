import { describe, it, expect } from 'vitest';
import { ANIM_STEP_MS, ANIM_STEPS, ANIM_IDLE_MS, animLive, animPhase, animKey, drawStepFrame, drawDoneMark, drawPointer, drawKnobHint, PINK } from '../../docs/tutorial-marks.js';

// the marks on the slide pictures / the かんたんメニュー; the redraw budget on Quest
const recCtx = () => {
  const calls = [], rec = n => (...a) => calls.push([n, ...a]), set = n => v => calls.push([n, v]);
  const ctx = { calls };
  for (const n of ['save', 'restore', 'beginPath', 'roundRect', 'rect', 'fill', 'stroke', 'arc', 'moveTo', 'lineTo', 'closePath']) ctx[n] = rec(n);
  for (const n of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha']) Object.defineProperty(ctx, n, { set: set(n) });
  return ctx;
};
const balanced = c => { let d = 0; for (const [n] of c.calls) { if (n === 'save') d++; if (n === 'restore') d--; expect(d).toBeGreaterThanOrEqual(0); } expect(d).toBe(0); };

describe('blink timing (Quest: every redraw re-uploads the board)', () => {
  it('at most two states, changing every 500 ms (2 redraws a second)', () => {
    expect(ANIM_STEP_MS).toBe(500); expect(ANIM_STEPS).toBe(2);
    const keys = new Set(), phases = new Set(); let changes = 0, prev = null;
    for (let t = 0; t < 10000; t += 10) { const k = animKey(t, 0); keys.add(k); phases.add(animPhase(t, 0)); if (prev !== null && k !== prev) changes++; prev = k; }
    expect(keys.size).toBe(2); expect([...phases].sort()).toEqual([0, 0.5]); expect(changes).toBeLessThanOrEqual(20);
  });
  it('still (bright, one key) 20 s after the board last changed; live again after a change', () => {
    expect(ANIM_IDLE_MS).toBe(20000);
    expect(animLive(19999, 0)).toBe(true); expect(animLive(20000, 0)).toBe(false);
    expect(animKey(20000, 0)).toBe('s'); expect(animKey(20750, 0)).toBe('s'); expect(animPhase(20750, 0)).toBe(0);
    expect(animLive(20750, 20000)).toBe(true); expect(animKey(20750, 20000)).toBe('1');
    expect(animLive(1e9)).toBe(true); // no change time known: animate
  });
});

describe('the marks (canvas 2D, state restored)', () => {
  it('drawStepFrame: a pink glow + frame exactly on the given rect, a thin white outline just outside; dims with the phase', () => {
    const a = recCtx(); drawStepFrame(a, { x: 10, y: 20, w: 300, h: 50, phase: 0 }); balanced(a);
    const rr = a.calls.filter(c => c[0] === 'roundRect'); expect(rr[0].slice(1, 5)).toEqual([10, 20, 300, 50]); expect(rr[1].slice(1, 5)).toEqual([10, 20, 300, 50]); expect(rr[2].slice(1, 5)).toEqual([7, 17, 306, 56]);
    expect(a.calls).toContainEqual(['strokeStyle', PINK]);
    const alpha = c => c.calls.filter(x => x[0] === 'globalAlpha').map(x => x[1]);
    const b = recCtx(); drawStepFrame(b, { x: 10, y: 20, w: 300, h: 50, phase: 0.5 }); expect(alpha(b)[1]).toBeLessThan(alpha(a)[1]);
  });
  it('drawDoneMark: a green disc with a white rim centred on the badge, and a tick', () => {
    const c = recCtx(); drawDoneMark(c, { cx: 100, cy: 50, r: 12 }); balanced(c);
    expect(c.calls.filter(x => x[0] === 'arc').map(x => x.slice(1, 4))).toEqual([[100, 50, 14], [100, 50, 12]]);
    expect(c.calls.filter(x => x[0] === 'lineTo')).toHaveLength(2);
  });
  it('drawPointer: an outline around the rect; an arrow from a side, none for from null', () => {
    const c = recCtx(); drawPointer(c, { x: 0, y: 0, w: 100, h: 40, from: null }); balanced(c);
    expect(c.calls.filter(x => x[0] === 'roundRect')).toHaveLength(1); expect(c.calls.some(x => x[0] === 'closePath')).toBe(false);
    for (const from of ['left', 'right', 'top', 'bottom']) { const d = recCtx(); drawPointer(d, { x: 0, y: 0, w: 100, h: 40, from }); balanced(d); expect(d.calls.some(x => x[0] === 'closePath'), from).toBe(true); }
  });
  it('drawKnobHint: a ring around the knob and arrows both ways', () => {
    const c = recCtx(); drawKnobHint(c, { kx: 200, cy: 80 }); balanced(c);
    expect(c.calls.filter(x => x[0] === 'arc')[0].slice(1, 3)).toEqual([200, 80]); expect(c.calls.filter(x => x[0] === 'closePath')).toHaveLength(2);
  });
});
