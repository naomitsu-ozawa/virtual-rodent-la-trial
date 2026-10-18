import { describe, it, expect } from 'vitest';
import { morphMask, fillMaskHoles, removeSmallMaskComponents, thresholdSourceMask } from '../../docs/mask-ops.js';

const idx = (w, h) => (x, y, z) => z * w * h + y * w + x;
const count = m => m.reduce((a, v) => a + (v ? 1 : 0), 0);

describe('morphMask', () => {
  it('dilating a single voxel by 1 gives a 6-neighbourhood cross', () => {
    const w = 5, h = 5, d = 5, i = idx(w, h), m = new Uint8Array(w * h * d);
    m[i(2, 2, 2)] = 1;
    const out = morphMask(m, w, h, d, 1, true);
    expect(count(out)).toBe(7);
    for (const [x, y, z] of [[1, 2, 2], [3, 2, 2], [2, 1, 2], [2, 3, 2], [2, 2, 1], [2, 2, 3]]) expect(out[i(x, y, z)]).toBe(1);
  });

  it('eroding a single voxel removes it, and does not mutate the input', () => {
    const w = 3, h = 3, d = 3, m = new Uint8Array(27); m[13] = 1;
    expect(count(morphMask(m, w, h, d, 1, false))).toBe(0);
    expect(m[13]).toBe(1);
  });

  it('radius 0 is identity', () => {
    const m = new Uint8Array([1, 0, 1, 1]);
    expect([...morphMask(m, 2, 2, 1, 0, true)]).toEqual([1, 0, 1, 1]);
  });
});

describe('fillMaskHoles', () => {
  it('fills an enclosed cavity but not background connected to the border', () => {
    const w = 5, h = 5, d = 5, i = idx(w, h), m = new Uint8Array(w * h * d);
    for (let z = 1; z <= 3; z++) for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) m[i(x, y, z)] = 1;
    m[i(2, 2, 2)] = 0; // cavity
    const out = fillMaskHoles(m, w, h, d);
    expect(out[i(2, 2, 2)]).toBe(1);
    expect(out[i(0, 0, 0)]).toBe(0);
    expect(count(out)).toBe(27);
  });
});

describe('removeSmallMaskComponents', () => {
  it('drops components smaller than minSize (6-connectivity)', () => {
    const w = 6, h = 1, d = 1, m = new Uint8Array([1, 1, 1, 0, 1, 0]);
    expect([...removeSmallMaskComponents(m, w, h, d, 2)]).toEqual([1, 1, 1, 0, 0, 0]);
  });
  it('is a no-op for minSize <= 0', () => {
    const m = new Uint8Array([1, 0, 1]);
    expect(removeSmallMaskComponents(m, 3, 1, 1, 0)).toBe(m);
  });
});

describe('thresholdSourceMask', () => {
  it('selects values inside [min, max] inclusive', () => {
    const out = thresholdSourceMask(new Float32Array([-1000, 0, 300, 400, 3000]), { min: 0, max: 400 });
    expect([...out]).toEqual([0, 1, 1, 1, 0]);
  });
});
