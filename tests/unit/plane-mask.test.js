import { describe, it, expect } from 'vitest';
import { runsPlaneMask, analysisRunsContain } from '../../docs/run-length.js';

// runsPlaneMask must give the same pixels as the per-pixel analysisRunsContain
// test it replaces in paintSourcePlane (pixel mapping as there).
describe('runsPlaneMask', () => {
  const w = 9, h = 7, d = 5;
  let s = 3; const rnd = n => (s = (s * 1103515245 + 12345) % 2147483648) % n;
  const runs = Array.from({ length: d }, () => { const rec = []; for (let y = 0; y < h; y++) if (rnd(2)) { const a = rnd(w), b = Math.min(w - 1, a + rnd(4)); rec.push(y, a, b); } return new Uint32Array(rec); });
  const pixel = (p, idx, px, py) => p === 'axial' ? [px, py, idx] : p === 'coronal' ? [px, idx, d - 1 - py] : [idx, px, d - 1 - py];
  it.each(['axial', 'coronal', 'sagittal'])('%s matches analysisRunsContain', p => {
    const count = p === 'axial' ? d : p === 'coronal' ? h : w;
    for (let idx = 0; idx < count; idx++) {
      const mask = runsPlaneMask(runs, p, idx, w, h, d), pw = p === 'sagittal' ? h : w, ph = p === 'axial' ? h : d;
      for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++)
        expect(mask[py * pw + px] === 1).toBe(analysisRunsContain(runs, ...pixel(p, idx, px, py)));
    }
  });
});
