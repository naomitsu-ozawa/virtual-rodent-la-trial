import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('docs/vr-view.js', 'utf8');

describe('VR histogram board placement (vr-view.js)', () => {
  it('never follows the head: no lazyFollow / per-frame target for the board', () => {
    expect(src).not.toMatch(/lazyFollow\(\s*hist\.group/);
    expect(src).not.toMatch(/histMoving/);
    // the per-frame block only places it once (when it has no place yet) and updates its contents
    const frame = src.match(/if\(hist\.isOpen\)\{[^\n]*hist\.update\(/)?.[0] || '';
    expect(frame).not.toBe(''); expect(frame).not.toMatch(/computeHistTarget|position\.(copy|set|lerp)/);
  });
  it('the grip on the board picks it up and puts it down (as the help board); the holding hand does not hit its own board', () => {
    expect(src).toMatch(/c\.userData\.histHit\)\{holdOf\(c\)\.attach\(hist\.group\);histHeld=c/);
    expect(src).toMatch(/if\(histHeld===c\)\{scene\.attach\(hist\.group\);histHeld=null;readHead\(\);hist\.group\.lookAt\(head\)/);
    expect(src).toMatch(/histHit=c=>\{if\(!hist\.isOpen\|\|hist\.group\.parent===holdOf\(c\)\)return null/);
  });
  it('「正面へ」 re-places it from both the 表示 tab and the ring', () => {
    expect(src).toMatch(/case'home':[^\n]*placeHistNow\(\)/);
    expect(src).toMatch(/btn\([^\n]*L\.home[^\n]*placeHistNow\(\)/);
  });
  it('the histogram pass waits for the XR frame loop (not window rAF / idle callbacks) and works at most ~2 ms at a time (build 563: up to 4 ms with frame headroom)', () => {
    expect(src).toContain('createVrLabelHistogram({yieldFn:()=>histYield(),budget:()=>histBudget()})'); // build 567: the board's own label pass (worker), same frame budget
    expect(src).toContain('const histBudget=()=>Math.max(2,Math.min(4,HIST_HEAD*histPerMs-histCbMs));'); // build 563
    expect(src).toContain('unsubHist();unsubLabelHist();labelHist.dispose();hist.dispose();'); // the counting worker ends with the session
    expect(src).toMatch(/hist\.update\([^\n]*\);releaseHistWaiters\(\)/);
  });
});
