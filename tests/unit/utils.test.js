import { describe, it, expect } from 'vitest';
import { fmt, esc, multi, num, numberOr, clampRangeValue } from '../../docs/utils.js';

describe('utils', () => {
  it('fmt formats byte sizes', () => {
    expect(fmt(0)).toBe('0 B');
    expect(fmt(512)).toBe('512 B');
    expect(fmt(1536)).toBe('1.50 KiB');
    expect(fmt(20.8 * 1024 * 1024)).toBe('20.80 MiB');
  });
  it('esc escapes HTML metacharacters (series descriptions come from DICOM files)', () => {
    expect(esc('<img src=x onerror="a">&\'')).not.toMatch(/[<>"']/);
    expect(esc('<b>')).toContain('&lt;');
  });
  it('multi parses DICOM multi-valued strings', () => {
    expect(multi('0.1\\0.2', 2)).toEqual([0.1, 0.2]);
    expect(multi('1\\2\\x', 3)).toBeNull();
    expect(multi('1', 2)).toBeNull();
    expect(multi(undefined, 2)).toBeNull();
  });
  it('num / numberOr', () => {
    expect(num('3.5')).toBe(3.5);
    expect(num('abc')).toBeNull();
    expect(numberOr(undefined, 7)).toBe(7);
  });
  it('clampRangeValue keeps values inside an input range', () => {
    const input = { min: '0', max: '10', step: '1' };
    expect(clampRangeValue(input, 15)).toBeLessThanOrEqual(10);
    expect(clampRangeValue(input, -5)).toBeGreaterThanOrEqual(0);
  });
});
