import { describe, it, expect } from 'vitest';
import { startHolderScale, tutorialHolderScale, scaleLimits, displayedLongM, realMagnification, clampScale, realHolderScale, isOversize, NORM_LONG, MIN_START_LONG_M } from '../../docs/vr-real-scale.js';

const FB = 0.165 / NORM_LONG;
// the start as it was before this change
const oldStart = (longMm, fb, mag = 1) => {
  const r = realHolderScale(longMm);
  if (r) return clampScale(r * (mag > 0 ? mag : 1), longMm);
  return clampScale(fb, longMm);
};

describe('minimum start size 2 cm', () => {
  it('2 cm and above: exactly the same as before (20, 25.6 at x1 and x4, 42.5, 75.8)', () => {
    for (const [l, m] of [[20, 1], [25.6, 1], [25.6, 4], [42.5, 1], [75.8, 1], [100, 1], [300, 1]]) {
      expect(startHolderScale(l, FB, m)).toBe(oldStart(l, FB, m));
    }
    expect(displayedLongM(startHolderScale(25.6, FB, 4))).toBeCloseTo(0.1024, 6);
    expect(realMagnification(startHolderScale(25.6, FB, 4), 25.6)).toBeCloseTo(4, 9);
  });
  it('12.04 mm (mouse hind leg) starts at 2 cm longest side, x1.7 of real size', () => {
    const s = startHolderScale(12.04, FB);
    expect(displayedLongM(s)).toBeCloseTo(0.02, 9);
    expect(realMagnification(s, 12.04)).toBeCloseTo(20 / 12.04, 6);
    expect(realMagnification(s, 12.04).toFixed(1)).toBe('1.7');
  });
  it('19.99 mm also starts at 2 cm', () => {
    expect(displayedLongM(startHolderScale(19.99, FB))).toBeCloseTo(0.02, 9);
  });
  it('a magnification that already gives more than 2 cm wins', () => {
    const s = startHolderScale(12.04, FB, 4);
    expect(displayedLongM(s)).toBeCloseTo(0.04816, 6);
    expect(s).toBe(oldStart(12.04, FB, 4));
  });
  it('unknown physical size and oversize data are the same as before', () => {
    for (const l of [0, NaN, undefined, -1, 301, 1800]) {
      expect(startHolderScale(l, FB)).toBe(oldStart(l, FB));
      expect(startHolderScale(l, FB, 4)).toBe(oldStart(l, FB, 4));
    }
    expect(isOversize(1800)).toBe(true);
  });
  it('the tutorial start is 2 cm too for small data, unchanged for 2 cm and above', () => {
    expect(displayedLongM(tutorialHolderScale(12.04))).toBeCloseTo(0.02, 9);
    expect(tutorialHolderScale(25.6, 4)).toBe(oldStart(25.6, 0.1 / NORM_LONG, 4));
    expect(tutorialHolderScale(75.8)).toBe(oldStart(75.8, 0.1 / NORM_LONG));
  });
  it('the lower limit stays the real size (can still be pinched down to real size)', () => {
    expect(scaleLimits(12.04).min).toBeCloseTo(12.04 / 1000 / NORM_LONG, 12);
    expect(scaleLimits(12.04).min).toBeLessThan(startHolderScale(12.04, FB));
    expect(MIN_START_LONG_M).toBe(0.02);
  });
});
