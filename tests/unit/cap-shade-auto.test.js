import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SHADE_HIST_BINS, createShadeHist, shadeBinOf, shadeBinValue, binShadeValues, binShadeRuns, shadeHistCount, SHADE_AUTO_LOW_P, SHADE_AUTO_HIGH_P, SHADE_AUTO_MIN_FRAC, SHADE_AUTO_IQR_K, SHADE_SPAN_MARGIN, SHADE_RANGE_STEPS, autoShadeRange, shadeSpanOf, shadeRangeOf, shadeRangeStep,
  shadeValueAt, shadePosOf, initialShadeRange, dataRangeOf, moveShadeEnd, shadeRangesToProject, createShadeAutoScheduler,
} from '../../docs/cap-shade.js';
import { binLut } from '../../docs/vr-label-histogram.js';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// the AUTO shading range of a segment = the 2nd..98th percentile of the values of the voxels that belong to the segment,
// the sliders run over the values present in the segment + 5 %; manual (user) ranges win, the reset button goes back to auto; only manual ranges are saved.
const vr = readFileSync('docs/vr-view.js', 'utf8'), segmentsSrc = readFileSync('docs/segments.js', 'utf8'), dataLoad = readFileSync('docs/data-load.js', 'utf8');
const histUi = readFileSync('docs/histogram-ui.js', 'utf8'), sectionShade = readFileSync('docs/section-shade.js', 'utf8');
installDomStub();
let S;
beforeAll(async () => { S = await importApp('segments'); });
afterEach(() => { S?.shadeAutoPage.reset(); S?.clearSegmentShadeAuto(); S?.clearSegmentShadeRanges(); });

const CT = dataRangeOf(-1024, 3071);
const histOf = (values, data = CT) => binShadeValues(createShadeHist(), Float64Array.from(values), data.min, data.max);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('autoShadeRange: percentiles of the segment\'s own values (4096 bins over the data\'s own range)', () => {
  it('the constants of the spec: 2nd / 98th percentile, IQR factor 1, 0.5 % of the data width at least, 5 % margin on the slider span, 200 steps, 4096 bins', () => {
    expect([SHADE_AUTO_LOW_P, SHADE_AUTO_HIGH_P, SHADE_AUTO_MIN_FRAC, SHADE_SPAN_MARGIN, SHADE_RANGE_STEPS, SHADE_HIST_BINS]).toEqual([2, 98, 0.005, 0.05, 200, 4096]);
    expect(SHADE_AUTO_IQR_K).toBe(1);
  });
  it('the bins: equal width over min..max, the max in the last bin, outside values clamped, NaN skipped, a segment\'s own range as the voxel test', () => {
    expect(shadeBinOf(0, 0, 4096)).toBe(0); expect(shadeBinOf(4096, 0, 4096)).toBe(4095); expect(shadeBinOf(-5, 0, 4096)).toBe(0); expect(shadeBinOf(9999, 0, 4096)).toBe(4095);
    expect(shadeBinOf(10.5, 0, 4096)).toBe(10); expect(shadeBinOf(1, 5, 5)).toBe(0);
    expect(shadeBinValue(0, 0, 4096)).toBe(0.5); expect(shadeBinValue(4095, 0, 4096)).toBe(4095.5);
    const h = binShadeValues(createShadeHist(), [1, 2, NaN, 3, 50], 0, 4096, 0, 5, 2, 10); // only 2 and 3 are inside 2..10
    expect(shadeHistCount(h)).toBe(2); expect(h[2]).toBe(1); expect(h[3]).toBe(1);
    const r = binShadeRuns(createShadeHist(), [0, 1, 2, 3, 4, 5, 6, 7], [1, 0, 1, 1, 2, 3], 4, 0, 4096); // row 1: x 0..1 -> 4, 5; row 1: x 2..3 -> 6, 7
    expect(shadeHistCount(r)).toBe(4); expect(r[4] + r[5] + r[6] + r[7]).toBe(4);
  });
  it('no histogram / no voxels / one distinct value / no data range: null (the initial value and the full-range sliders are used)', () => {
    expect(autoShadeRange(null, CT)).toBe(null); expect(autoShadeRange(undefined, CT)).toBe(null);
    expect(autoShadeRange(createShadeHist(), CT)).toBe(null);
    expect(autoShadeRange(histOf([120, 120, 120, 120]), CT)).toBe(null);
    expect(autoShadeRange(histOf(range(0, 9)), null)).toBe(null); expect(autoShadeRange(histOf([1, 2]), dataRangeOf(5, 5))).toBe(null);
  });
  it('2nd and 98th percentile of 1000 values 0..999 (one bin is about 1 HU wide: results within one bin of 19 and 979); outliers do not move the ends', () => {
    const r = autoShadeRange(histOf(range(0, 999)), CT);
    expect(Math.abs(r.lower - 19)).toBeLessThan(1.1); expect(Math.abs(r.upper - 979)).toBeLessThan(1.1);
    const withOutliers = [...range(0, 999), ...Array(5).fill(3000), ...Array(5).fill(-900)];
    const o = autoShadeRange(histOf(withOutliers), CT);
    expect(Math.abs(o.lower - 15)).toBeLessThan(1.1); expect(Math.abs(o.upper - 984)).toBeLessThan(1.1); // rank 21 / 990 of 1010
    expect(o.lower).toBeGreaterThan(-900); expect(o.upper).toBeLessThan(3000);
  });
  it('a result is ordered, finite and inside the data range', () => {
    for (const vals of [range(0, 50), range(-1024, -900), range(3000, 3071), [5, 6], [0, 3071]]) {
      const r = autoShadeRange(histOf(vals), CT);
      expect(r.lower).toBeLessThanOrEqual(r.upper); expect(r.lower).toBeGreaterThanOrEqual(CT.min); expect(r.upper).toBeLessThanOrEqual(CT.max);
      expect(Number.isFinite(r.lower + r.upper + r.span.min + r.span.max)).toBe(true);
    }
  });
  it('a width under 0.5 % of the data\'s full width is widened symmetrically to 0.5 %', () => {
    const minW = 0.005 * 4095, r = autoShadeRange(histOf([...Array(990).fill(50), ...Array(10).fill(52)]), CT); // p2 = p98: width 0
    expect(r.upper - r.lower).toBeCloseTo(minW, 9); expect((r.lower + r.upper) / 2).toBeCloseTo(50, 0);
    const w = autoShadeRange(histOf([...range(100, 110), ...range(100, 110)]), CT); // about 10 wide < 20.5
    expect(w.upper - w.lower).toBeCloseTo(minW, 9); expect((w.lower + w.upper) / 2).toBeCloseTo(105, 0);
    const mid = autoShadeRange(histOf([...range(100, 150), ...range(100, 150)]), CT); // about 49 wide: over 0.5 % (and under the old 2 % = 81.9): kept as it is, not widened
    expect(mid.upper - mid.lower).toBeGreaterThan(minW + 20); expect(mid.upper - mid.lower).toBeLessThan(0.02 * 4095);
    const wide = autoShadeRange(histOf(range(0, 999)), CT); expect(wide.upper - wide.lower).toBeGreaterThan(950);
  });
  it('the widening follows the data\'s width (no fixed numbers) and is cut to the data\'s min..max', () => {
    const small = dataRangeOf(0, 2000), r = autoShadeRange(histOf([0, 0, 0, 0, 1, 1], small), small);
    expect(r.lower).toBe(0); expect(r.upper).toBeCloseTo(5.7, 0); // 0.5 % of 2000 = 10, centred near 0.7 -> cut at 0
    const big = dataRangeOf(0, 65535), b = autoShadeRange(histOf([1000, 1000, 1000, 1100], big), big);
    expect(autoShadeRange(histOf([1000, 1001], big), big)).toBe(null); // inside one bin (16 wide here): one value, the initial value
    expect(b.upper - b.lower).toBeCloseTo(0.005 * 65535, 6);
  });
  it('slider span = the values present (first bin .. last bin) plus 5 % of that width on each side, cut to the data', () => {
    const r = autoShadeRange(histOf(range(100, 300)), CT);
    expect(Math.abs(r.span.min - 90)).toBeLessThan(1.5); expect(Math.abs(r.span.max - 310)).toBeLessThan(1.5);
    const cut = autoShadeRange(histOf(range(0, 100), dataRangeOf(0, 3071)), dataRangeOf(0, 3071));
    expect(cut.span.min).toBe(0); expect(Math.abs(cut.span.max - 105)).toBeLessThan(1.5);
    const top = autoShadeRange(histOf(range(2900, 3071)), CT); expect(top.span.max).toBe(3071);
    const far = autoShadeRange(histOf([...range(100, 300), 2000]), CT); expect(Math.abs(far.span.max - (2000 + 0.05 * 1900))).toBeLessThan(2); // a far voxel stretches the span (the extent of the values present, not of the percentiles)
  });
  it('step = span / 200; the slider maps its position to values on that grid and back; null auto = the data\'s full range', () => {
    const r = autoShadeRange(histOf(range(100, 300)), CT), span = shadeSpanOf(r, CT);
    expect(span).toEqual({ min: r.span.min, max: r.span.max });
    expect(shadeRangeStep(span)).toBeCloseTo((r.span.max - r.span.min) / 200, 12);
    expect(shadeValueAt(0, span)).toBe(r.span.min); expect(shadeValueAt(1, span)).toBeCloseTo(r.span.max, 9); expect(shadePosOf((r.span.min + r.span.max) / 2, span)).toBeCloseTo(0.5, 12);
    for (let k = 0; k <= 200; k += 20) expect(shadePosOf(shadeValueAt(k / 200, span), span)).toBeCloseTo(k / 200, 12);
    expect(shadeSpanOf(null, CT)).toBe(CT); expect(shadeSpanOf({ lower: 1, upper: 2 }, CT)).toBe(CT); expect(shadeSpanOf({ span: { min: 5, max: 5 } }, CT)).toBe(CT);
    expect(shadeRangeStep(shadeSpanOf(null, CT))).toBeCloseTo(4095 / 200, 12);
  });
});

// the maths as it was (2nd..98th percentile, widened to 2 %), to show where it is unchanged
function ref694(hist, data) {
  let first = -1, last = -1, count = 0;
  for (let i = 0; i < hist.length; i++) { const c = hist[i]; if (!c) continue; if (first < 0) first = i; last = i; count += c; }
  const at = p => { const target = Math.max(1, Math.ceil(count * p / 100)); let cum = 0; for (let i = first; i <= last; i++) { cum += hist[i]; if (cum >= target) return shadeBinValue(i, data.min, data.max); } return shadeBinValue(last, data.min, data.max); };
  let lo = at(2), hi = at(98); const minW = (data.max - data.min) * 0.02;
  if (hi - lo < minW) { const m = (lo + hi) / 2; lo = m - minW / 2; hi = m + minW / 2; }
  return { lower: Math.min(Math.max(lo, data.min), data.max), upper: Math.min(Math.max(hi, data.min), data.max) };
}
describe('the IQR cuts the long tails; wide distributions (bone, MRI) are; the minimum width is 0.5 %', () => {
  // soft tissue: a narrow peak (30..50, 90 % of the voxels) and a long tail up to 350
  const peakAndTail = () => { const v = []; for (let i = 0; i < 9000; i++) v.push(30 + (i * 37) % 21); for (let i = 0; i < 1000; i++) v.push(50 + i * 0.3); return v; };
  it('narrow peak + long tail: the upper end is p75 + IQR (near the peak), not the 98th percentile far out in the tail', () => {
    const h = histOf(peakAndTail()), old = ref694(h, CT), r = autoShadeRange(h, CT);
    expect(old.upper).toBeGreaterThan(250); // stretched by the tail
    expect(r.upper).toBeLessThan(70); expect(r.upper).toBeGreaterThan(50); expect(r.lower).toBeGreaterThan(28); expect(r.lower).toBeLessThan(32);
    expect(r.upper - r.lower).toBeGreaterThan(0.005 * 4095); // wide enough: not the minimum width
    expect(r.span.max).toBeGreaterThan(340); // the sliders still reach the tail (span unchanged)
  });
  it('the cut is max(p2, p25 - IQR) .. min(p98, p75 + IQR) (checked against an independent count of the raw values)', () => {
    const vals = peakAndTail(), h = histOf(vals), sorted = Float64Array.from(vals).sort(), n = sorted.length, bin = 4095 / 4096;
    const q = p => sorted[Math.max(1, Math.ceil(n * p / 100)) - 1];
    const iqr = q(75) - q(25), up = Math.min(q(98), q(75) + iqr), lo = Math.max(q(2), q(25) - iqr), r = autoShadeRange(h, CT);
    expect(Math.abs(r.upper - up)).toBeLessThan(1.5 * bin); expect(Math.abs(r.lower - lo)).toBeLessThan(1.5 * bin);
  });
  it('bone-like (wide, flat) and MRI-like distributions: p2 / p98 win, the result equals\'s', () => {
    const boneLike = []; for (let v = 300; v <= 2900; v++) boneLike.push(v, v);
    const MR = dataRangeOf(0, 65535);
    for (const [vals, d] of [[boneLike, CT], [range(0, 999), CT], [range(12000, 52000), MR], [range(20000, 30000), MR]]) {
      const h = histOf(vals, d), a = autoShadeRange(h, d), b = ref694(h, d);
      expect(a.lower).toBeCloseTo(b.lower, 9); expect(a.upper).toBeCloseTo(b.upper, 9);
    }
  });
  it('the IQR never widens the range beyond p2 / p98', () => {
    const h = histOf([...range(0, 999), ...range(0, 999)]), r = autoShadeRange(h, CT), p = ref694(h, CT);
    expect(r.lower).toBeGreaterThanOrEqual(p.lower - 1e-9); expect(r.upper).toBeLessThanOrEqual(p.upper + 1e-9);
  });
  it('the minimum width is 0.5 % of the data\'s full width: a 10 HU wide peak is widened to 20.5 HU only', () => {
    const r = autoShadeRange(histOf([...range(40, 49), ...range(40, 49), ...range(40, 49)]), CT);
    expect(r.upper - r.lower).toBeCloseTo(0.005 * 4095, 9); expect(r.upper - r.lower).toBeLessThan(0.02 * 4095);
  });
  it('the slider span and the step are unchanged by the IQR (the values present + 5 %)', () => {
    const r = autoShadeRange(histOf(peakAndTail()), CT);
    expect(Math.abs(r.span.min - (30 - 0.05 * 320))).toBeLessThan(2); expect(Math.abs(r.span.max - (350 + 0.05 * 320))).toBeLessThan(3);
    expect(shadeRangeStep(shadeSpanOf(r, CT))).toBeCloseTo((r.span.max - r.span.min) / 200, 12);
  });
});

describe('MRI-like data (values 0..65535, far outside the HU bins): the auto range and the span are right', () => {
  const MR = dataRangeOf(0, 65535);
  it('a segment of values 20000..30000: percentiles and span are in data units (the fixed -1024..3071 bins would pile them all into the last bin)', () => {
    const vals = range(20000, 30000), r = autoShadeRange(histOf(vals, MR), MR), bin = 65535 / 4096;
    expect(Math.abs(r.lower - (20000 + 0.02 * 10000))).toBeLessThan(2 * bin); expect(Math.abs(r.upper - (20000 + 0.98 * 10000))).toBeLessThan(2 * bin);
    expect(r.lower).toBeGreaterThan(19000); expect(r.upper).toBeLessThan(31000);
    expect(Math.abs(r.span.min - (20000 - 500))).toBeLessThan(2 * bin); expect(Math.abs(r.span.max - (30000 + 500))).toBeLessThan(2 * bin);
    expect(shadeRangeStep(shadeSpanOf(r, MR))).toBeCloseTo((r.span.max - r.span.min) / 200, 12);
  });
  it('outliers up to 65535 do not move the 2nd..98th percentile; the span still reaches them', () => {
    const vals = [...range(20000, 30000), ...Array(50).fill(65535)], r = autoShadeRange(histOf(vals, MR), MR);
    expect(r.upper).toBeLessThan(31000); expect(r.span.max).toBeGreaterThan(65000);
  });
  it('a narrow cluster is widened to 0.5 % of 65535 (about 328) around its middle, cut to the data', () => {
    const r = autoShadeRange(histOf([...Array(500).fill(40000), ...Array(500).fill(40100)], MR), MR);
    expect(r.upper - r.lower).toBeCloseTo(0.005 * 65535, 6); expect((r.lower + r.upper) / 2).toBeCloseTo(40050, -2);
  });
  it('the VR lookup table (vr-label-histogram.js binLut with histMax) bins the same way; without histMax it is the board\'s 1-HU bins', () => {
    const cal = [1, 0, 0], lut = binLut(cal, 0, 4096, 65535);
    expect(lut[0]).toBe(0); expect(lut[65535]).toBe(4095); expect(lut[30000]).toBe(shadeBinOf(30000, 0, 65535)); expect(lut[20000]).toBe(shadeBinOf(20000, 0, 65535));
    const hu = binLut(cal, -1024, 4096); expect(hu[0]).toBe(1024); expect(hu[65535]).toBe(4095); // the board: unchanged
    expect(binLut([1, -1024, 0], -1024, 4096)[1024]).toBe(1024);
    expect(binLut(cal, 5, 4096, 5)[100]).toBe(0); // no width: bin 0, no NaN
  });
});

describe('auto / manual: which range is in use', () => {
  const auto = { lower: 40, upper: 160, span: { min: 0, max: 200 } };
  it('manual wins over auto, auto over the initial value; auto is cut to the data and ordered', () => {
    expect(shadeRangeOf(undefined, -50, 350, CT, null)).toEqual({ lower: -50, upper: 350, touched: false }); // not ready: the initial value
    expect(shadeRangeOf(undefined, -50, 350, CT, auto)).toEqual({ lower: 40, upper: 160, touched: false });
    expect(shadeRangeOf({ lower: 10, upper: 20 }, -50, 350, CT, auto)).toEqual({ lower: 10, upper: 20, touched: true });
    expect(shadeRangeOf(undefined, 0, 1, dataRangeOf(50, 100), auto)).toEqual({ lower: 50, upper: 100, touched: false });
    expect(shadeRangeOf(undefined, 0, 1, CT, { lower: NaN, upper: 3 })).toMatchObject({ touched: false }); // an unusable auto value: the initial one
    expect(shadeRangeOf(undefined, -50, 350, CT, { lower: NaN, upper: 3 })).toEqual({ lower: -50, upper: 350, touched: false });
  });
  it('the real state: an auto segment follows its auto value (not the threshold range); moving an end makes it manual with both ends kept; the reset button returns to auto', () => {
    const s = S.segmentState; Object.assign(s.soft, { userMin: -50, userMax: 350 });
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: -50, upper: 350, touched: false }); // auto not ready: 693 initial
    S.setSegmentShadeAuto('soft', auto);
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: 40, upper: 160, touched: false });
    s.soft.userMin = 0; s.soft.userMax = 400; // the threshold moved: the auto value stays until its recomputation is ready
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: 40, upper: 160, touched: false });
    expect(S.setSegmentShadeEnd('soft', 'upper', 120, CT)).toMatchObject({ lower: 40, upper: 120, touched: true }); // lower keeps the auto value
    S.setSegmentShadeAuto('soft', { lower: 70, upper: 90, span: { min: 0, max: 200 } }); // a new auto value arrives: the manual range stays
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: 40, upper: 120, touched: true });
    S.resetSegmentShadeRange('soft'); // 自動に戻す
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: 70, upper: 90, touched: false });
    expect(Object.keys(S.segmentShadeRanges)).toEqual([]);
    expect(S.segmentShadeSpan('soft', CT)).toEqual({ min: 0, max: 200 }); expect(S.segmentShadeSpan('bone', CT)).toBe(CT);
  });
  it('an auto value of another segment does not leak; setSegmentShadeAuto(null) / a histogram without usable values goes back to the initial value; unknown keys are ignored', () => {
    const s = S.segmentState; Object.assign(s.soft, { userMin: -50, userMax: 350 }); Object.assign(s.bone, { userMin: 700, userMax: 3071 });
    S.setSegmentShadeAuto('soft', auto);
    expect(S.segmentShadeRange('bone', CT)).toMatchObject({ lower: 700, upper: 3071 });
    expect(S.setSegmentShadeAuto('nope', auto)).toBe(false);
    S.applyShadeAutoHistograms({ soft: null }, CT);
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: -50, upper: 350 });
    S.applyShadeAutoHistograms({ soft: histOf(range(100, 300)), bone: histOf([500, 500, 500]) }, CT);
    expect(S.segmentShadeRange('soft', CT).touched).toBe(false); expect(S.segmentShadeAuto.soft).toMatchObject({ lower: expect.any(Number), upper: expect.any(Number) });
    expect(S.segmentShadeAuto.bone).toBeUndefined(); // one distinct value: no auto, the initial value
  });
  it('listeners are told when an auto value changes (not when it is the same); a new dataset clears every auto value', () => {
    const seen = []; const off = S.onShadeAutoChange(k => seen.push(k));
    S.setSegmentShadeAuto('fat', auto); S.setSegmentShadeAuto('fat', { ...auto }); S.setSegmentShadeAuto('fat', { ...auto, upper: 170 });
    expect(seen).toEqual(['fat', 'fat']);
    S.resetShadeAutoForDataset(); expect(seen).toEqual(['fat', 'fat', null]); expect(S.segmentShadeAuto.fat).toBeUndefined();
    off(); S.setSegmentShadeAuto('fat', auto); expect(seen.length).toBe(3);
  });
});

describe('save / load: only manual ranges are saved; auto values are recomputed on open; an old file loads', () => {
  it('project.shadeRanges holds the manual ranges only (the auto values are not in the file)', () => {
    S.setSegmentShadeAuto('soft', { lower: 1, upper: 2, span: { min: 0, max: 5 } }); S.setSegmentShadeAuto('bone', { lower: 3, upper: 4, span: { min: 0, max: 5 } });
    S.setSegmentShadeEnd('bone', 'lower', 3.5, CT);
    expect(shadeRangesToProject(S.segmentShadeRanges)).toEqual({ bone: { min: 3.5, max: 4 } });
    expect(dataLoad).not.toMatch(/segmentShadeAuto/); // data-load.js saves / restores segmentShadeRanges only
    expect(dataLoad).toContain('{const sr=shadeRangesToProject(segmentShadeRanges);if(Object.keys(sr).length)project.shadeRanges=sr}');
  });
});

// a manual timer: advance(ms) runs the timers that are due
const fakeTimers = () => {
  let now = 0, id = 0; const timers = new Map();
  return {
    setTimer: (f, ms) => { timers.set(++id, { f, at: now + ms }); return id; }, clearTimer: i => { timers.delete(i); },
    async advance(ms) { const end = now + ms; for (;;) { const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = Math.max(now, due[1].at); timers.delete(due[0]); due[1].f(); for (let i = 0; i < 12; i++) await Promise.resolve(); } now = end; },
    get pending() { return timers.size; },
  };
};
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('the scheduler: triggers, 300 ms after the last request, stale results thrown away', () => {
  it('requests are waited on for 300 ms after the LAST one (a slider drag asks on every move) and computed once', async () => {
    const t = fakeTimers(), calls = [], applied = [];
    const sch = createShadeAutoScheduler({ compute: async keys => { calls.push([...keys]); return Object.fromEntries(keys.map(k => [k, null])); }, apply: r => applied.push(r), ...t });
    sch.request(['soft']); await t.advance(200); sch.request(['soft']); await t.advance(200); sch.request(['bone']); await t.advance(299);
    expect(calls).toEqual([]); await t.advance(1); await settle();
    expect(calls).toEqual([['soft', 'bone']]); expect(applied).toEqual([{ soft: null, bone: null }]);
  });
  it('a request while a computation runs makes it stale: its result is discarded, its keys are asked again with the new request', async () => {
    const t = fakeTimers(), applied = [], stales = [], gates = []; let cancelled = 0;
    const sch = createShadeAutoScheduler({
      compute: (keys, stale) => new Promise(res => { gates.push(() => { stales.push(stale()); res(Object.fromEntries(keys.map(k => [k, 'h-' + gates.length]))); }); }),
      apply: r => applied.push(r), cancel: () => { cancelled++; }, ...t });
    sch.request(['soft', 'bone']); await t.advance(300); expect(gates.length).toBe(1);
    sch.request(['fat']); expect(cancelled).toBe(1); // the running one stops working
    gates[0](); await settle(); expect(stales).toEqual([true]); expect(applied).toEqual([]); // stale: thrown away
    await t.advance(300); expect(gates.length).toBe(2); // soft, bone (still wanted) and fat together
    gates[1](); await settle(); expect(applied).toEqual([{ soft: 'h-2', bone: 'h-2', fat: 'h-2' }]);
  });
  it('the previous value is kept until the new result is ready: nothing is applied while it runs or when it fails', async () => {
    const t = fakeTimers(), applied = [];
    let fail = true;
    const sch = createShadeAutoScheduler({ compute: async () => { if (fail) throw new Error('boom'); return { soft: null }; }, apply: r => applied.push(r), retries: 0, ...t });
    const warn = console.warn; console.warn = () => {};
    try { sch.request(['soft']); await t.advance(300); await settle(); expect(applied).toEqual([]); } finally { console.warn = warn; }
    fail = false; sch.request(['soft']); await t.advance(300); await settle(); expect(applied).toEqual([{ soft: null }]);
  });
  it('a computation that cannot run yet (null) is retried a few times 300 ms apart, then given up; a new request starts again', async () => {
    const t = fakeTimers(); let calls = 0, ready = false; const applied = [];
    const sch = createShadeAutoScheduler({ compute: async () => { calls++; return ready ? { soft: null } : null; }, apply: r => applied.push(r), retries: 3, ...t });
    sch.request(['soft']); await t.advance(300 + 3 * 300 + 1000); await settle();
    expect(calls).toBe(4); expect(applied).toEqual([]); expect(t.pending).toBe(0);
    ready = true; sch.request(['soft']); await t.advance(300); await settle(); expect(applied).toEqual([{ soft: null }]);
  });
  it('reset (another dataset / the session ended): nothing is computed or applied any more', async () => {
    const t = fakeTimers(), applied = []; let calls = 0, cancelled = 0, gate;
    const sch = createShadeAutoScheduler({ compute: () => { calls++; return new Promise(res => { gate = () => res({ soft: null }); }); }, apply: r => applied.push(r), cancel: () => { cancelled++; }, ...t });
    sch.request(['soft']); sch.reset(); await t.advance(1000); expect(calls).toBe(0); expect(sch.busy).toBe(false);
    sch.request(['soft']); await t.advance(300); expect(calls).toBe(1); sch.reset(); expect(cancelled).toBeGreaterThan(0); gate(); await settle(); expect(applied).toEqual([]);
  });
  it('the generation counter grows with every request (stale results are told apart by it)', () => {
    const t = fakeTimers(), sch = createShadeAutoScheduler({ compute: async () => ({}), apply() {}, ...t }), g0 = sch.generation;
    sch.request(['soft']); sch.request(['soft']); expect(sch.generation).toBe(g0 + 2);
  });
});

describe('no counting during an XR session (hold) and the VR side\'s own wait', () => {
  it('hold(true): requests are only remembered (no timer, no compute, no retry used up); hold(false) asks for them again once', async () => {
    const t = fakeTimers(), calls = [], applied = [];
    const sch = createShadeAutoScheduler({ compute: async keys => { calls.push([...keys]); return Object.fromEntries(keys.map(k => [k, null])); }, apply: r => applied.push(r), retries: 2, ...t });
    sch.hold(true); expect(sch.held).toBe(true);
    sch.request(['soft']); sch.request(['bone']); await t.advance(10000); await settle();
    expect(calls).toEqual([]); expect(t.pending).toBe(0); expect(sch.busy).toBe(false);
    sch.hold(false); expect(t.pending).toBe(1); await t.advance(300); await settle();
    expect(calls).toEqual([['soft', 'bone']]); expect(applied).toEqual([{ soft: null, bone: null }]);
    sch.hold(false); await t.advance(1000); await settle(); expect(calls.length).toBe(1); // nothing left: no second run
  });
  it('a computation that is running when the XR session starts is cancelled, its result thrown away, and its keys are computed after the session', async () => {
    const t = fakeTimers(), applied = [], gates = []; let cancelled = 0;
    const sch = createShadeAutoScheduler({ compute: (keys, stale) => new Promise(res => { gates.push(() => res(stale() ? null : Object.fromEntries(keys.map(k => [k, 'h'])))); }), apply: r => applied.push(r), cancel: () => { cancelled++; }, ...t });
    sch.request(['soft', 'bone']); await t.advance(300); expect(gates.length).toBe(1);
    sch.hold(true); expect(cancelled).toBe(1); gates[0](); await settle(); expect(applied).toEqual([]);
    await t.advance(5000); expect(gates.length).toBe(1);
    sch.hold(false); await t.advance(300); expect(gates.length).toBe(2); gates[1](); await settle(); expect(applied).toEqual([{ soft: 'h', bone: 'h' }]);
  });
  it('a pending (not yet fired) request when the session starts waits for the end of it; reset still clears everything', async () => {
    const t = fakeTimers(); let calls = 0;
    const sch = createShadeAutoScheduler({ compute: async () => { calls++; return {}; }, apply() {}, ...t });
    sch.request(['soft']); sch.hold(true); await t.advance(2000); expect(calls).toBe(0);
    sch.hold(false); sch.reset(); await t.advance(2000); expect(calls).toBe(0); // the data went away meanwhile
  });
  it('retries are not used up by the requests made during the session: after it the full retry count is still there', async () => {
    const t = fakeTimers(); let calls = 0;
    const sch = createShadeAutoScheduler({ compute: async () => { calls++; return null; }, apply() {}, retries: 3, ...t });
    sch.hold(true); for (let i = 0; i < 20; i++) { sch.request(['soft']); await t.advance(300); }
    sch.hold(false); await t.advance(300 + 3 * 300 + 2000); await settle(); expect(calls).toBe(4); // first try + 3 retries
  });
  it('retryDelay: the wait between retries of a "not now" compute (VR: 1000 ms x 60) is separate from the 300 ms debounce; the start is still after 300 ms', async () => {
    const t = fakeTimers(); let calls = 0, saving = true; const applied = [];
    const sch = createShadeAutoScheduler({ compute: async () => { calls++; return saving ? null : { soft: null }; }, apply: r => applied.push(r), retryDelay: 1000, retries: 60, ...t });
    sch.request(['soft']); await t.advance(299); expect(calls).toBe(0); await t.advance(1); await settle(); expect(calls).toBe(1);
    await t.advance(999); await settle(); expect(calls).toBe(1); await t.advance(1); await settle(); expect(calls).toBe(2); // 1000 ms between the tries
    await t.advance(50 * 1000); await settle(); expect(calls).toBe(52); expect(applied).toEqual([]); // still waiting for a long save
    saving = false; await t.advance(1000); await settle(); expect(applied).toEqual([{ soft: null }]); // the save finished: counted, no give-up
  });
  it('the VR wait gives up only after 60 retries (a save longer than a minute); the default retries are unchanged (5, 300 ms)', async () => {
    const t = fakeTimers(); let calls = 0;
    const sch = createShadeAutoScheduler({ compute: async () => { calls++; return null; }, apply() {}, retryDelay: 1000, retries: 60, ...t });
    sch.request(['soft']); await t.advance(300 + 61 * 1000 + 5000); await settle(); expect(calls).toBe(61); expect(t.pending).toBe(0);
    const t2 = fakeTimers(); let c2 = 0; const s2 = createShadeAutoScheduler({ compute: async () => { c2++; return null; }, apply() {}, ...t2 });
    s2.request(['soft']); await t2.advance(300 + 5 * 300 + 5000); await settle(); expect(c2).toBe(6);
  });
  it('wiring: the browser counting is held from the XR session start to its end (segments.js setShadeAutoPageHeld, called in vr-view.js); the VR counting waits for the cache write', () => {
    expect(segmentsSrc).toContain('export const setShadeAutoPageHeld=on=>shadeAutoPage.hold(on);');
    expect(vr).toContain("running={session};setShadeAutoPageHeld(true);vrHold(true);step('in-session');");
    expect(vr).toContain('renderer.domElement.remove();running=null;setShadeAutoPageHeld(false);');
    expect((vr.match(/setShadeAutoPageHeld\(/g) || []).length).toBe(2);
    expect(vr).toContain("if([...storeStatus.map.values()].some(s=>s.state==='saving'))return null;"); // not now while the VR prep cache is being written (the same test as flushVrStores)
    expect(vr.indexOf("some(s=>s.state==='saving'))return null;")).toBeLessThan(vr.indexOf('const ok=await shadeHist.run(inp)')); // before any counting starts
    expect(vr).toContain('apply:applyShadeAutoHistograms,cancel:()=>shadeHist.cancel(),retryDelay:1000,retries:60});');
    expect(segmentsSrc).not.toMatch(/createShadeAutoScheduler\(\{[^}]*retryDelay/); // the browser keeps the default wait
  });
});

describe('the triggers: only a data open and a threshold change', () => {
  it('a data open asks for every segment (once the data is ready), another dataset clears the auto values first', () => {
    expect(dataLoad).toContain('projectSaveBtn.disabled=false;syncMpr3DSliceSliders();requestShadeAuto();void applyPendingProject();');
    expect(dataLoad).toContain('resetShadeAutoForDataset(); // ');
    expect(dataLoad.indexOf('resetShadeAutoForDataset();')).toBeLessThan(dataLoad.indexOf('requestShadeAuto();void applyPendingProject'));
    expect(segmentsSrc).toContain('export const requestShadeAuto=(keys=SEGMENT_PRESET_ORDER)=>shadeAutoPage.request(keys);');
  });
  it('a threshold (min / max in use) change asks for the segments that changed, nothing else does', () => {
    expect(segmentsSrc).toContain('if(changed.length)requestShadeAuto(changed);');
    const s = S.segmentState; for (const k of ['bone', 'soft', 'fat', 'lung', 'contrast']) Object.assign(s[k], { active: false, userMin: undefined, userMax: undefined, min: 0, max: 1 });
    S.applyExclusiveRanges(); S.shadeAutoPage.reset();
    expect(S.shadeAutoPage.busy).toBe(false);
    S.applyExclusiveRanges(); expect(S.shadeAutoPage.busy).toBe(false); // nothing changed: no request
    s.soft.active = true; s.soft.userMin = -50; s.soft.userMax = 350;
    const g = S.shadeAutoPage.generation; S.applyExclusiveRanges(); expect(S.shadeAutoPage.busy).toBe(true); expect(S.shadeAutoPage.generation).toBeGreaterThan(g);
  });
  it('without a source or a volume the browser computation just waits (no error)', () => {
    expect(segmentsSrc).toContain('compute:(keys,stale)=>shadeAutoSource&&volume?shadeAutoSource(keys,stale):null');
  });
});

describe('the browser source (histogram-ui.js computeSegmentHistograms)', () => {
  it('is registered when the app installs the histogram; reads the filtered planes; the voxels of a segment = the same rule as the panel (plain range of the data, else its final runs); touches no panel state', () => {
    expect(histUi).toContain('setShadeAutoSource(computeSegmentHistograms);');
    const fn = histUi.slice(histUi.indexOf('export async function computeSegmentHistograms'), histUi.indexOf('// ---- results as drawn ----'));
    expect(fn).toContain('mode: HU_MODE_FILTERED'); expect(fn).toContain('needsRuns(k, v)'); expect(fn).toContain('getFinalSegmentRuns(k, segmentVolume(v))'); expect(fn).toContain('binShadeValues(plain[i], values, data.min, data.max,'); expect(fn).toContain('binShadeRuns(hists[i], values, r, w, data.min, data.max,'); expect(fn).not.toMatch(/histInRange|binValues|binRuns|createHist\(|HIST_/); // its own bins over the data's range; the panel's HU bins are not used
    expect(fn).toContain('stale()'); expect(fn).toContain('st.sliceMs');
    expect(fn).not.toMatch(/st\.(job|doneSig|cur|runCache|totals|message)|setProgress|draw\(|cancelJob|import\s*\(/);
  });
  it('the panel (browser) sliders run over the span and the cut face repaints when an auto value arrives', () => {
    expect(sectionShade).toContain('segmentShadeSpan(key, data)'); expect(sectionShade).toContain('const d = spanNow(); if (d) moveEnd(which, shadeValueAt(shadePosOf(+control.value, d), d))');
    expect(sectionShade).toContain('onShadeAutoChange(() => { syncSectionShadeUi(); refresh(); });');
    expect(sectionShade).toContain("wireStepButton(minus, -1, step()); if (plus) wireStepButton(plus, 1, step());"); // ＋ / − unchanged: 10, hold 100, clamped to the data
    expect(sectionShade).toContain("stepClamp(which === 'lower' ? r.lower : r.upper, delta, d.min, d.max)");
  });
});

describe('VR: the auto range from the label pass of the board (vr-label-histogram.js), the same data the shader reads', () => {
  it('a second label pass without the board: analysis colours left out (region null), every segment of the session counted, hists[1 + slot] of the slot\'s segment', () => {
    expect(vr).toContain('const shadeHist=createVrLabelHistogram({yieldFn:()=>histYield(),budget:()=>histBudget()})');
    expect(vr).toContain('const inp=histInput(shadeSig);inp.region=null;inp.binRange={min:data.min,max:data.max};'); // 4096 equal bins over the data's own range, the board's instance keeps its HU bins
    expect(vr).toContain('shadeSig[0]=shadeAvailMask();');
    expect(vr).toContain('out[k]=r.hists[1+sl]||null');
    expect(vr).toContain('const histInput=(s=histSig)=>');
    expect(vr).toContain('apply:applyShadeAutoHistograms,cancel:()=>shadeHist.cancel()');
  });
  it('triggers: the data was bound (install resets the threshold signature) and a slot\'s threshold min / max changed; the pass goes on in XR frames; cleaned up with the data and the session', () => {
    expect(vr).toContain('histP=P;histFor=null;histRun();shadeMM.fill(NaN);');
    expect(vr).toContain('if(shadeMM[2*i]!==(seg?.min||0)||shadeMM[2*i+1]!==(seg?.max||0)){');
    expect(vr).toContain('if(seg&&histP)shadeAuto.request([key])');
    expect(vr).toContain('}else if(shadeHist.busy)releaseHistWaiters();');
    expect(vr).toContain('shadeAuto.reset();shadeHist.reset();'); expect(vr).toContain('hist.dispose();shadeAuto.reset();shadeHist.dispose();unsubShade();');
    expect((vr.match(/shadeAuto\.request\(/g) || []).length).toBe(1); // no other trigger
  });
  it('the menu page: the sliders use the span, the reset button is 自動に戻す / Back to auto and still acts on the segment only; the page repaints when an auto value arrives', () => {
    expect(vr).toContain("shReset:'自動に戻す'"); expect(vr).toContain("shReset:'Back to auto'"); expect(vr).not.toContain("shReset:'初期値に戻す'");
    expect(vr).toContain('const unsubShade=onShadeAutoChange(()=>{if(ui.tab===12&&running)menu.refresh()});');
  });
  it('the shader and its uniform are untouched: only the values fed through segmentShadeRange change', () => {
    expect(vr).toContain('ctShadeRange:{value:[0,1,2,3].map(()=>new THREE.Vector2(0,1))}');
    expect(vr).toContain('uniform vec2 ctShadeRange[4];');
    expect(vr).toContain('{const sr=segmentShadeRange(key,shadeData);u.ctShadeRange.value[i].set(sr.lower,sr.upper)}');
  });
});

describe('a segment\'s own values: the auto range makes shading span the values that are really there', () => {
  it('values clustered at the ends of the threshold range: the initial range is mostly dark / bright, the auto range spreads them', () => {
    const soft = initialShadeRange(-250, 3000, CT); // a wide threshold range
    const values = [...range(40, 80)]; // the voxels of the segment sit in a narrow band
    const r = autoShadeRange(histOf(values), CT);
    const spread = (lo, hi) => { const t = values.map(v => Math.min(1, Math.max(0, (v - lo) / Math.max(hi - lo, 1e-3)))); return Math.max(...t) - Math.min(...t); };
    expect(spread(r.lower, r.upper)).toBeGreaterThan(spread(soft.lower, soft.upper) * 5);
    expect(moveShadeEnd({ lower: r.lower, upper: r.upper }, 'lower', 50, CT).lower).toBe(50);
  });
});

// the real browser source on an in-memory volume (no filter, no post-processing: every segment is a plain range of the data)
describe('computeSegmentHistograms on a small volume', () => {
  it('counts the values of the voxels inside each segment\'s range only; a segment without voxels is null; stale() stops it', async () => {
    const H = await importApp('histogram-ui'), St = await importApp('state');
    const columns = 4, rows = 4, slices = 3, data = new Int16Array(columns * rows * slices);
    for (let i = 0; i < data.length; i++) data[i] = i < 16 ? 10 + (i % 4) : i < 32 ? 200 + (i % 8) : -700; // slice 0: 10..13, slice 1: 200..207, slice 2: air
    St.setVolume({ data, columns, rows, slices, min: -700, max: 207, spacing: [1, 1, 1] });
    const s = S.segmentState;
    Object.assign(s.soft, { active: true, min: 0, max: 100, opening: 0, closing: 0, minComponent: 0, holeFill: false }); Object.assign(s.bone, { active: true, min: 150, max: 3000, opening: 0, closing: 0, minComponent: 0, holeFill: false });
    Object.assign(s.fat, { active: true, min: 5000, max: 6000, opening: 0, closing: 0, minComponent: 0, holeFill: false });
    const out = await H.computeSegmentHistograms(['soft', 'bone', 'fat'], () => false);
    const dr = dataRangeOf(-700, 207);
    const vals = h => { const r = []; h.forEach((c, b) => { for (let k = 0; k < c; k++) r.push(shadeBinValue(b, dr.min, dr.max)); }); return r; };
    expect(shadeHistCount(out.soft)).toBe(16); expect(shadeHistCount(out.bone)).toBe(16); // soft 0..100: slice 0 (10..13); bone 150..3000: slice 1 (200..207)
    expect(Math.max(...vals(out.soft))).toBeLessThan(14.3); expect(Math.min(...vals(out.soft))).toBeGreaterThan(9.7);
    expect(Math.min(...vals(out.bone))).toBeGreaterThan(199.7); expect(Math.max(...vals(out.bone))).toBeLessThan(207.3);
    expect(out.fat).toBe(null);
    expect(await H.computeSegmentHistograms(['soft'], () => true)).toBe(null);
    // and the auto range made from it spans the values that are there, not the threshold range
    const r = autoShadeRange(out.soft, dr);
    expect(r.upper - r.lower).toBeCloseTo(0.005 * 907, 9); expect(Math.abs(r.span.min - 9.85)).toBeLessThan(0.5); expect(Math.abs(r.span.max - 13.15)).toBeLessThan(0.5); // 10..13 (3 wide) -> widened to 0.5 % of the data's 907
    St.setVolume(null);
  });
});
