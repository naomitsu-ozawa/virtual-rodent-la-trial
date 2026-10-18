import { describe, it, expect } from 'vitest';
import { createHist, binValues, histExtent, histStats, histPercentileSpan, histsPercentileSpan, ROBUST_LO_P, ROBUST_HI_P, ROBUST_MIN_FRAC, chartSpans, fitWindow, windowFor, clampWindow, zoomWindow, normalizeRange, HIST_MIN, HIST_MAX, MIN_WINDOW } from '../../docs/histogram.js';

// soft tissue around 40 HU (1000 voxels each at 20..60) plus a thin bone tail up to 2500 HU (3 voxels per step)
function boneStudy() {
  const h = createHist(), v = [];
  for (let hu = 20; hu <= 60; hu++) for (let i = 0; i < 1000; i++) v.push(hu);
  for (let hu = 300; hu <= 2500; hu += 100) v.push(hu, hu, hu);
  return binValues(h, Float32Array.from(v));
}
const seg = (min, max) => ({ min, max });

describe('robust chart range', () => {
  it('histPercentileSpan ignores a thin tail that histExtent includes', () => {
    const h = boneStudy();
    expect(histExtent(h)[1]).toBe(2500);
    const [a, b] = histPercentileSpan(h);
    expect(a).toBeGreaterThanOrEqual(20); expect(a).toBeLessThan(25);
    expect(b).toBeLessThanOrEqual(60);
  });
  it('an empty histogram has no span; a one-bin histogram is a point', () => {
    expect(histPercentileSpan(createHist())).toBeNull();
    expect(histPercentileSpan(binValues(createHist(), [100, 100, 100]))).toEqual([100, 100]);
  });
  it('percentiles 0 / 100 give the full extent', () => {
    const h = boneStudy();
    expect(histPercentileSpan(h, 0, 100)).toEqual(histExtent(h));
  });
  it('segments are weighed together: a small bone segment does not stretch the axis of a big soft-tissue one', () => {
    const soft = binValues(createHist(), Float32Array.from({ length: 10000 }, (_, i) => 20 + (i % 41)));
    const bone = binValues(createHist(), Float32Array.from({ length: 30 }, (_, i) => 300 + i * 70));
    const win = windowFor({ list: [{ seg: seg(0, 100), hist: soft }, { seg: seg(300, 3000), hist: bone }], total: null }, { mode: 'auto' });
    expect(win[1]).toBeLessThan(120);
    expect(windowFor({ list: [{ seg: seg(0, 100), hist: soft }, { seg: seg(300, 3000), hist: bone }], total: null }, { mode: 'full' })[1]).toBeGreaterThan(2200);
    expect(histsPercentileSpan([soft, bone], 0, 100)).toEqual([20, 2330]);
    expect(histsPercentileSpan([])).toBeNull();
  });
  it('a tail that holds more than 0.5 % of the voxels but is invisible (bars < 3 % of the peak) is trimmed too', () => {
    const v = []; for (let i = 0; i < 20000; i++) v.push(i % 100);                // 200 voxels per HU, 0..99
    for (let hu = 100; hu < 1100; hu++) v.push(hu);                                 // a 1 voxel per HU tail: 1000 voxels (4.8 %)
    const h = binValues(createHist(), Float32Array.from(v));
    expect(histPercentileSpan(h)[1]).toBeGreaterThan(900);                          // percentiles alone keep it
    expect(histPercentileSpan(h, ROBUST_LO_P, ROBUST_HI_P, ROBUST_MIN_FRAC)).toEqual([0, 99]);
    expect(windowFor({ list: [{ seg: seg(0, 1100), hist: h }], total: null }, { mode: 'auto' })[1]).toBeLessThan(110);
    expect(windowFor({ list: [{ seg: seg(0, 1100), hist: h }], total: null }, { mode: 'full' })[1]).toBeGreaterThan(1100);
  });
  it('auto window is narrow, full window keeps the whole tail', () => {
    const res = { list: [{ key: 'soft', seg: seg(-100, 3000), hist: boneStudy() }], total: null };
    const auto = windowFor(res, { mode: 'auto' }), full = windowFor(res, { mode: 'full' });
    expect(auto[1]).toBeLessThan(120); expect(auto[0]).toBeGreaterThan(-20);
    expect(full[1]).toBeGreaterThan(2500);
    expect(windowFor(res, undefined)).toEqual(auto);
    expect(chartSpans(res)).toEqual(chartSpans(res, false)); // the default is the old (full) behaviour
  });
  it('robust spans use the range line only while the segment has no data, and the total only when no segment has data', () => {
    const total = { hist: boneStudy() };
    expect(chartSpans({ list: [{ seg: seg(-100, 3000), hist: boneStudy() }], total }, true)).toHaveLength(1);
    expect(chartSpans({ list: [{ seg: seg(100, 200), hist: null }], total }, true)).toEqual([[100, 200], histPercentileSpan(total.hist, ROBUST_LO_P, ROBUST_HI_P, ROBUST_MIN_FRAC)]);
    expect(chartSpans({ list: [], total }, true)).toEqual([histPercentileSpan(total.hist, ROBUST_LO_P, ROBUST_HI_P, ROBUST_MIN_FRAC)]);
    expect(windowFor({ list: [], total: null }, { mode: 'auto' })).toEqual(fitWindow([]));
  });
});

describe('manual range clamping', () => {
  it('orders, rounds and clamps to the histogram range', () => {
    expect(clampWindow(300, -100)).toEqual([-100, 300]);
    expect(clampWindow(-5000, 9000)).toEqual([HIST_MIN, HIST_MAX]);
    expect(clampWindow(10.4, 200.6)).toEqual([10, 201]);
  });
  it('keeps at least MIN_WINDOW wide, also at the ends', () => {
    expect(clampWindow(100, 110)).toEqual([100, 100 + MIN_WINDOW]);
    const top = clampWindow(HIST_MAX, HIST_MAX); expect(top[1]).toBe(HIST_MAX); expect(top[1] - top[0]).toBeGreaterThanOrEqual(MIN_WINDOW);
    const bot = clampWindow(-9999, -9999); expect(bot[0]).toBe(HIST_MIN); expect(bot[1] - bot[0]).toBeGreaterThanOrEqual(MIN_WINDOW);
  });
  it('non-finite input is rejected', () => {
    expect(clampWindow(NaN, 10)).toBeNull(); expect(clampWindow('x', 10)).toBeNull(); expect(clampWindow(0, Infinity)).toBeNull();
  });
  it('zoomWindow keeps the anchor and respects the limits', () => {
    expect(zoomWindow(0, 1000, 250, 0.5)).toEqual([125, 625]);
    expect(zoomWindow(0, 1000, 500, 100)).toEqual([HIST_MIN, HIST_MAX]);
    const tiny = zoomWindow(0, 100, 50, 0.01); expect(tiny[1] - tiny[0]).toBe(MIN_WINDOW);
  });
  it('windowFor honours a manual range (clamped) and falls back to auto when it is unusable', () => {
    const res = { list: [{ seg: seg(0, 100), hist: boneStudy() }], total: null };
    expect(windowFor(res, { mode: 'manual', lo: -50, hi: 400 })).toEqual([-50, 400]);
    expect(windowFor(res, { mode: 'manual', lo: 400, hi: 400 })[1]).toBe(450);
    expect(windowFor(res, { mode: 'manual', lo: NaN, hi: 5 })).toEqual(windowFor(res, { mode: 'auto' }));
  });
  it('normalizeRange sanitizes stored values', () => {
    expect(normalizeRange(null).mode).toBe('auto');
    expect(normalizeRange({ mode: 'bogus' }).mode).toBe('auto');
    expect(normalizeRange({ mode: 'full' }).mode).toBe('full');
    expect(normalizeRange({ mode: 'manual', lo: 500, hi: -20 })).toEqual({ mode: 'manual', lo: -20, hi: 500 });
    expect(normalizeRange({ mode: 'manual', lo: 'a', hi: 1 }).mode).toBe('auto');
  });
  it('the stats do not depend on the window', () => {
    const h = boneStudy(), before = histStats(h);
    windowFor({ list: [{ seg: seg(0, 1), hist: h }], total: null }, { mode: 'manual', lo: 0, hi: 100 });
    expect(histStats(h)).toEqual(before); expect(before.max).toBe(2500);
  });
});
