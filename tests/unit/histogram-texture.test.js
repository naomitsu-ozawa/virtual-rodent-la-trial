import { describe, it, expect } from 'vitest';
import * as Tex from '../../docs/histogram-texture.js';
import { textureMatchesMode, accToHist, createAcc, textureU16 } from '../../docs/histogram-texture.js';

// build 568: what is left of the VR texture helpers (the VR board counts in vr-label-histogram.js; the PC consumer texture pass is gone)
describe('texture helpers', () => {
  it('mode match', () => {
    const t = { data: new Uint8Array(2), dims: [1, 1, 1], filtered: true };
    expect(textureMatchesMode(t, 'filtered')).toBe(true); expect(textureMatchesMode(t, 'raw')).toBe(false);
    expect(textureMatchesMode({ ...t, filtered: false }, 'raw')).toBe(true); expect(textureMatchesMode(null, 'raw')).toBe(false);
  });
  it('a weighted accumulator -> whole counts rounded on the running sum (the total is the rounded weighted total)', () => {
    const acc = createAcc(); acc[0] = 1.4; acc[1] = 1.4; acc[2] = 1.4;
    const h = accToHist(acc); expect(h[0] + h[1] + h[2]).toBe(4); expect([h[0], h[1], h[2]].every(x => x === 1 || x === 2)).toBe(true);
  });
  it('a texture on an odd byte offset is read through a copy; the view is made once per data array', () => {
    const buf = new Uint8Array(9); buf.set([0, 1, 0, 2, 0, 3, 0, 4, 0]); const data = buf.subarray(1); // u16 = 1, 2, 3, 4 (lo, hi)
    const tex = { data, dims: [4, 1, 1], calibration: [1, 0, 0] }, u = textureU16(tex);
    expect(Array.from(u)).toEqual([1, 2, 3, 4]); expect(textureU16({ ...tex })).toBe(u);
  });
  it('the PC consumer texture pass is gone (build 568)', () => {
    for (const k of ['textureIsReduced', 'texSourceSlice', 'createCounts', 'countsToAcc', 'countTextureRange', 'countTextureRuns', 'columnMap', 'createTexCountClient', 'texCountWorkerMain']) expect(Tex[k]).toBeUndefined();
  });
});
