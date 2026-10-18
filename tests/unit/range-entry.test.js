import { describe, it, expect } from 'vitest';
import { rangeWheelSteps, parseShownValue } from '../../docs/range-entry.js';

describe('rangeWheelSteps (build 442: one notch = one step)', () => {
  it('a mouse notch is one step whatever its size', () => {
    const s = { acc: 0 };
    expect(rangeWheelSteps(s, 100)).toBe(1);
    expect(rangeWheelSteps(s, 240)).toBe(1);
    expect(rangeWheelSteps(s, -100)).toBe(-1);
    expect(rangeWheelSteps(s, 3, 1)).toBe(1); // line mode
    expect(rangeWheelSteps(s, -1, 2)).toBe(-1); // page mode
  });
  it('trackpad pixels add up, one step per 42 px', () => {
    const s = { acc: 0 };
    const seq = [10, 10, 10, 10, 10, 10, 10, 10, 10];
    const steps = seq.map((d) => rangeWheelSteps(s, d));
    expect(steps.reduce((a, b) => a + b, 0)).toBe(2);
    expect(steps.indexOf(1)).toBe(4);
  });
  it('a direction change drops what was gathered', () => {
    const s = { acc: 0 };
    rangeWheelSteps(s, 40);
    expect(rangeWheelSteps(s, -10)).toBe(0);
    expect(s.acc).toBe(-10);
  });
  it('no delta, no step', () => {
    expect(rangeWheelSteps({ acc: 0 }, 0)).toBe(0);
  });
});

describe('parseShownValue', () => {
  it('reads plain values with units', () => {
    expect(parseShownValue('-250')).toEqual({ value: -250, offset: 0 });
    expect(parseShownValue('0.80 mm')).toEqual({ value: 0.8, offset: 0 });
    expect(parseShownValue('64%')).toEqual({ value: 64, offset: 0 });
    expect(parseShownValue('-0.0 mm')).toEqual({ value: -0, offset: 0 });
    expect(parseShownValue('0.0°')).toEqual({ value: 0, offset: 0 });
  });
  it('reads slice positions 1-based', () => {
    expect(parseShownValue('257 / 512')).toEqual({ value: 257, offset: 1 });
  });
  it('leaves non-numbers alone', () => {
    expect(parseShownValue('—')).toBe(null);
    expect(parseShownValue('')).toBe(null);
  });
});
