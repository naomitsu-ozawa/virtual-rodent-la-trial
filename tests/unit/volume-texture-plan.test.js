import { describe, it, expect } from 'vitest';
import { volumeTexturePlan } from '../../docs/medical-volume.js';

const vol = (columns, rows, slices) => ({ columns, rows, slices });

describe('volumeTexturePlan', () => {
  it('keeps full resolution when no limits apply', () => {
    const p = volumeTexturePlan(vol(256, 256, 128));
    expect(p.dims).toEqual([256, 256, 128]);
    expect(p.reduced).toBe(false);
    expect(p.bytes).toBe(256 * 256 * 128 * 2);
  });

  it('never exceeds the byte budget', () => {
    const budget = 64 * 1024 * 1024;
    const p = volumeTexturePlan(vol(1024, 1024, 800), budget);
    expect(p.bytes).toBeLessThanOrEqual(budget);
    expect(p.reduced).toBe(true);
  });

  it('respects the max 3D texture dimension', () => {
    const p = volumeTexturePlan(vol(4096, 512, 512), 0, 2048);
    expect(Math.max(...p.dims)).toBeLessThanOrEqual(2048);
  });

  it('downsamples in-plane to the target and keeps aspect roughly', () => {
    const p = volumeTexturePlan(vol(1000, 500, 100), 0, Infinity, 500);
    expect(p.dims[0]).toBe(500);
    expect(p.dims[1]).toBe(250);
  });

  it('handles missing/degenerate volumes without throwing', () => {
    const p = volumeTexturePlan({});
    expect(p.dims).toEqual([1, 1, 1]);
    expect(volumeTexturePlan(undefined).dims).toEqual([1, 1, 1]);
  });

  it('reports source dims unchanged', () => {
    const p = volumeTexturePlan(vol(300, 200, 100), 1024);
    expect(p.sourceDims).toEqual([300, 200, 100]);
    expect(p.dims.every(d => d >= 1)).toBe(true);
  });
});
