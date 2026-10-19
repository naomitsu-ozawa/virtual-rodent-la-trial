import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { I18N } from '../../docs/i18n.js';
import { HIST_MIN, HIST_MAX, HIST_BINS, createHist, huToBin, binToHu, binValues, binRuns, mergeHist, scaleHist, histInRange, histCount, rebinHist, histExtent, histStats, voxelsToMm3, huToX, xToHu, nearestLine } from '../../docs/histogram.js';

describe('histogram bins', () => {
  it('has 4096 one-HU bins from -1024 to 3071', () => {
    expect(HIST_MIN).toBe(-1024); expect(HIST_MAX).toBe(3071); expect(HIST_BINS).toBe(4096);
    expect(createHist().length).toBe(4096);
    expect(huToBin(-1024)).toBe(0); expect(huToBin(3071)).toBe(4095); expect(huToBin(0)).toBe(1024);
    expect(binToHu(huToBin(-37))).toBe(-37);
  });
  it('clamps out-of-range values into the end bins and rounds to the nearest HU', () => {
    const h = binValues(createHist(), [-5000, -1024, 3071, 9999, 10.4, 10.6, NaN]);
    expect(h[0]).toBe(2); expect(h[4095]).toBe(2); expect(h[huToBin(10)]).toBe(1); expect(h[huToBin(11)]).toBe(1);
    expect(histCount(h)).toBe(6);
  });
  it('bins only the voxels of the runs (y, x0, x1 inclusive)', () => {
    const w = 4, values = Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const h = binRuns(createHist(), values, Uint32Array.from([0, 1, 2, 2, 0, 0]), w);
    expect(histCount(h)).toBe(3); expect(h[huToBin(2)]).toBe(1); expect(h[huToBin(3)]).toBe(1); expect(h[huToBin(9)]).toBe(1);
    expect(histCount(binRuns(createHist(), values, null, w))).toBe(0);
  });
  it('merges and scales', () => {
    const a = binValues(createHist(), [1, 1, 2]), b = binValues(createHist(), [2, 3]);
    const m = mergeHist(a, b); expect(histCount(m)).toBe(5); expect(m[huToBin(2)]).toBe(2);
    expect(histCount(scaleHist(m, 4))).toBe(20);
  });
  it('histInRange takes the bins of an inclusive HU range, empty outside the bins', () => {
    const h = binValues(createHist(), [-2000, -100, 0, 50, 100, 101, 5000]);
    expect(histCount(histInRange(h, -100, 100))).toBe(4);
    expect(histCount(histInRange(h, 3000, 4000))).toBe(1); // the clamped top bin
    expect(histCount(histInRange(h, -3000, -1000))).toBe(1); // the clamped bottom bin
    expect(histCount(histInRange(h, 5, 1))).toBe(0);
    expect(histCount(histInRange(h, -9000, -5000))).toBe(0);
  });
});

describe('rebin for display', () => {
  it('keeps the total of the window and puts each HU in one column', () => {
    const h = binValues(createHist(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(rebinHist(h, 0, 9, 5))).toEqual([2, 2, 2, 2, 2]);
    expect(rebinHist(h, 0, 9, 10).every(v => v === 1)).toBe(true);
    expect(rebinHist(h, 5, 9, 1)[0]).toBe(5);
  });
  it('writes into a reused array (its first `columns` entries) when one is given', () => {
    const h = binValues(createHist(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), out = new Float64Array(8).fill(7);
    expect(rebinHist(h, 0, 9, 5, out)).toBe(out); expect(Array.from(out.subarray(0, 5))).toEqual([2, 2, 2, 2, 2]);
    expect(rebinHist(h, 0, 9, 5, out)).toBe(out); expect(Array.from(out.subarray(0, 5))).toEqual([2, 2, 2, 2, 2]); // cleared, not added up
    expect(rebinHist(h, 0, 9, 10, out)).not.toBe(out); // too short: a new array
  });
  it('ignores HU outside the window and handles an inverted window', () => {
    const h = binValues(createHist(), [-50, 0, 50]);
    expect(rebinHist(h, -10, 10, 4).reduce((a, b) => a + b)).toBe(1);
    expect(rebinHist(h, 10, -10, 4).reduce((a, b) => a + b)).toBe(0);
  });
  it('histExtent and the pixel mapping', () => {
    expect(histExtent(createHist())).toBe(null);
    expect(histExtent(binValues(createHist(), [-30, 40, 7]))).toEqual([-30, 40]);
    expect(xToHu(huToX(123, -100, 400, 500), -100, 400, 500)).toBeCloseTo(123);
  });
});

describe('nearestLine (grab tolerance)', () => {
  it('picks the closest line within 6 px, else -1', () => {
    expect(nearestLine([100, 140, 300], 143)).toBe(1);
    expect(nearestLine([100, 140, 300], 106)).toBe(0);
    expect(nearestLine([100, 140, 300], 107)).toBe(-1);
    expect(nearestLine([], 5)).toBe(-1);
    expect(nearestLine([100, 104], 102.5)).toBe(1);
  });
  it('the canvas keeps pointer events away from the 3D controls', () => {
    const s = readFileSync(new URL('../../docs/histogram-ui.js', import.meta.url), 'utf8');
    expect(s).toContain('stopPropagation'); expect(s).toContain("touchAction = 'none'"); expect(s).toContain('setPointerCapture');
  });
});

describe('histStats', () => {
  it('is empty-safe', () => {
    const s = histStats(createHist());
    expect(s.count).toBe(0); expect(s.mean).toBe(null); expect(s.sd).toBe(null); expect(s.percentiles[50]).toBe(null);
  });
  it('computes count, mean, SD, min, max from the bins', () => {
    const s = histStats(binValues(createHist(), [10, 20, 30, 40]));
    expect(s.count).toBe(4); expect(s.mean).toBe(25); expect(s.sd).toBeCloseTo(Math.sqrt(125)); expect(s.min).toBe(10); expect(s.max).toBe(40);
  });
  it('percentiles are nearest rank on 1..100', () => {
    const v = []; for (let i = 1; i <= 100; i++) v.push(i);
    expect(histStats(binValues(createHist(), v)).percentiles).toEqual({ 5: 5, 25: 25, 50: 50, 75: 75, 95: 95 });
  });
  it('one bin: every percentile is that value; unordered percentile list works', () => {
    expect(histStats(binValues(createHist(), [7, 7, 7]), [95, 5]).percentiles).toEqual({ 5: 7, 95: 7 });
  });
  it('reports the clamped end bins as -1024 / 3071', () => {
    const s = histStats(binValues(createHist(), [-9999, 9999]));
    expect(s.min).toBe(-1024); expect(s.max).toBe(3071);
  });
});

describe('histogram panel wiring (static)', () => {
  const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('every i18n key the panel uses exists in Japanese and English', () => {
    const used = new Set([...read('histogram-ui.js').matchAll(/tr\('([A-Za-z]+)'\)/g)].map(m => m[1]));
    for (const k of ['bone', 'soft', 'fat', 'lung', 'contrast']) used.delete(k);
    expect(used.size).toBeGreaterThan(10);
    for (const l of ['ja', 'en']) for (const k of used) expect(I18N[l][k], l + ':' + k).toBeTruthy();
  });
  it('the toggle and the result box are in the 3D overlay and the module is installed from app.js', () => {
    const shell = read('ui-shell.js');
    expect(shell).toContain('id="seg-hist-toggle"'); expect(shell).toContain('id="seg-hist-result"');
    expect(read('app.js')).toMatch(/installSegmentHistogram\(\);/);
  });
  it('the lines move the slider through its own input / change events (no second code path)', () => {
    const s = read('histogram-ui.js');
    expect(s).toContain("new Event('input'"); expect(s).toContain("new Event('change'");
    expect(s).not.toMatch(/userMin\s*=/); expect(s).not.toMatch(/applyCtRangeMode/);
  });
});

describe('voxelsToMm3', () => {
  it('multiplies by the voxel volume, null without spacing', () => {
    expect(voxelsToMm3(10, [0.5, 0.5, 2])).toBeCloseTo(5);
    expect(voxelsToMm3(10, null)).toBe(null);
    expect(voxelsToMm3(10, [0, 1, 1])).toBe(null);
  });
});

describe('a cancelled stale job does not clear the running job progress', () => {
  it('runJob finally clears progress only for the current job or when no job runs', () => {
    const s = readFileSync(new URL('../../docs/histogram-ui.js', import.meta.url), 'utf8');
    expect(s).toContain("if (st.job === job) { st.job = null; setProgress('', null); } else if (!st.job) setProgress('', null);");
  });
});
