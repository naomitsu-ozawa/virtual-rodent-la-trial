import { describe, it, expect } from 'vitest';
import { startHolderScale, tutorialHolderScale, scaleLimits, displayedLongM, realMagnification, clampScale, realHolderScale, isOversize, NORM_LONG, MIN_START_LONG_M } from '../../docs/vr-real-scale.js';

const FB = 0.165 / NORM_LONG;
// the start as it was before this change
const oldStart = (longMm, fb, mag = 1) => {
  const r = realHolderScale(longMm);
  if (r) return clampScale(r * (mag > 0 ? mag : 1), longMm);
  return clampScale(fb, longMm);
};

describe('minimum start size 5 cm', () => {
  it('5 cm and above: exactly the same as before (50, 50.1, 75.8, 100, 300; 25.6 is below 5 cm and has its own tests)', () => {
    for (const [l, m] of [[50, 1], [50.1, 1], [60.4, 1], [75.8, 1], [100, 1], [300, 1], [50, 4]]) {
      expect(startHolderScale(l, FB, m)).toBe(oldStart(l, FB, m));
    }
    expect(displayedLongM(startHolderScale(25.6, FB, 4))).toBeCloseTo(0.1024, 6); // x4 of the 2.56 cm bone: more than 5 cm, so the magnification wins
    expect(realMagnification(startHolderScale(25.6, FB, 4), 25.6)).toBeCloseTo(4, 9);
  });
  it('12.04 mm (mouse hind leg) starts at 5 cm longest side, x4.2 of real size', () => {
    const s = startHolderScale(12.04, FB);
    expect(displayedLongM(s)).toBeCloseTo(0.05, 9);
    expect(realMagnification(s, 12.04)).toBeCloseTo(50 / 12.04, 6);
    expect(realMagnification(s, 12.04).toFixed(1)).toBe('4.2');
  });
  it('the 5 cm boundary: 49.9 mm starts at 5 cm, 50 mm at real size; a tiny 4 mm sample at 5 cm', () => {
    expect(displayedLongM(startHolderScale(49.9, FB))).toBeCloseTo(0.05, 9);
    expect(startHolderScale(50, FB)).toBe(realHolderScale(50));
    expect(displayedLongM(startHolderScale(50, FB))).toBeCloseTo(0.05, 9);
    expect(displayedLongM(startHolderScale(4, FB))).toBeCloseTo(0.05, 9);
    expect(realMagnification(startHolderScale(4, FB), 4)).toBeCloseTo(12.5, 9);
    expect(displayedLongM(startHolderScale(20, FB))).toBeCloseTo(0.05, 9);
  });
  it('a magnification (vrInitialScale) that already gives more than 5 cm wins; a smaller one is lifted to 5 cm', () => {
    const s = startHolderScale(12.04, FB, 5);
    expect(displayedLongM(s)).toBeCloseTo(0.0602, 6);
    expect(s).toBe(oldStart(12.04, FB, 5));
    expect(displayedLongM(startHolderScale(12.04, FB, 4))).toBeCloseTo(0.05, 9); // x4 = 4.8 cm < 5 cm: lifted
    expect(displayedLongM(startHolderScale(30, FB, 4))).toBeCloseTo(0.12, 9); // 30 mm x4 = 12 cm wins
    expect(displayedLongM(startHolderScale(2.56, FB, 40))).toBeCloseTo(0.1024, 6);
  });
  it('unknown physical size and oversize data are the same as before', () => {
    for (const l of [0, NaN, undefined, -1, 301, 1800]) {
      expect(startHolderScale(l, FB)).toBe(oldStart(l, FB));
      expect(startHolderScale(l, FB, 4)).toBe(oldStart(l, FB, 4));
    }
    expect(isOversize(1800)).toBe(true);
  });
  it('the tutorial start is 5 cm too for small data, unchanged for 5 cm and above', () => {
    expect(displayedLongM(tutorialHolderScale(12.04))).toBeCloseTo(0.05, 9);
    expect(tutorialHolderScale(25.6, 4)).toBe(oldStart(25.6, 0.1 / NORM_LONG, 4));
    expect(tutorialHolderScale(75.8)).toBe(oldStart(75.8, 0.1 / NORM_LONG));
  });
  it('the lower limit stays the real size (can still be pinched down to real size)', () => {
    expect(scaleLimits(12.04).min).toBeCloseTo(12.04 / 1000 / NORM_LONG, 12);
    expect(scaleLimits(12.04).min).toBeLessThan(startHolderScale(12.04, FB));
    expect(MIN_START_LONG_M).toBe(0.05);
  });
});
