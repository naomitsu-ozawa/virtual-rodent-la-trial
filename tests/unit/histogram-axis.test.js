import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  HIST_BINS, HU_AXIS, createHist, binValues, binRuns, binOf, binValue, huToBin, histInRange, histCount, histExtent, histStats, rebinHist, windowBins, niceStep, tickText, stepDecimals,
  fmtAxisValue, axisFor, valueStepOf, axisKey, axisWidth, axisDecimals, isHuLike, chartSpans, fitWindow, windowFor, clampWindow, zoomWindow, normalizeRange, huToX, MIN_WINDOW,
} from '../../docs/histogram.js';
import { shadeBinOf, shadeBinValue, binShadeValues, createShadeHist, SHADE_HIST_BINS } from '../../docs/cap-shade.js';
import { columnsFor, dragWindow, rangeRes, MAX_COLUMNS, PLOT } from '../../docs/vr-histogram-layout.js';
import { createVrHistogramPanel } from '../../docs/vr-histogram-panel.js';
import { binLut, LABELS, UNLABELED, slotLabel, UNLABELED_COLOR } from '../../docs/vr-label-histogram.js';
import { profileStats } from '../../docs/line-profile.js';
import { unitScaleFor, scaledUnitDef, FILTER_UNITS, resolveFilterParams } from '../../docs/filter-units.js';

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');

// ---- the data of the three non-HU families (deterministic, no random) ----
const LCG = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
// MRI: 16 bit unsigned 0..65535 (background noise near 0, a soft peak around 20000, a bright blob around 45000)
function mriLike(n = 60000) {
  const r = LCG(7), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const k = r(); out[i] = k < 0.35 ? r() * 1200 : k < 0.8 ? 20000 + (r() + r() + r() - 1.5) * 9000 : k < 0.99 ? 45000 + (r() + r() - 1) * 8000 : 65535 * r(); }
  out[0] = 0; out[1] = 65535;
  return out;
}
// slope-scaled: stored 0..56000 x slope 0.0005 = 0..28
function slopeScaled(n = 60000) {
  const r = LCG(11), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const k = r(); const stored = k < 0.3 ? r() * 4000 : k < 0.9 ? 22000 + (r() + r() - 1) * 14000 : 56000 * r(); out[i] = Math.round(Math.max(0, Math.min(56000, stored))) * 0.0005; }
  out[0] = 0; out[1] = 28;
  return out;
}
// 8 bit 0..255
function eightBit(n = 60000) {
  const r = LCG(5), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const k = r(); out[i] = Math.round(k < 0.3 ? r() * 20 : k < 0.9 ? 120 + (r() + r() - 1) * 70 : 255 * r()); }
  out[0] = 0; out[1] = 255;
  return out;
}
const FAMILIES = [['MRI 0..65535', mriLike, 0, 65535, 1], ['slope-scaled 0..28', slopeScaled, 0, 28, 0.0005], ['8-bit 0..255', eightBit, 0, 255, 1]]; // the last: the value step (valueStepOf: 1 for whole-number slopes, else the slope)
const bins = h => { let n = 0; for (let i = 0; i < h.length; i++) if (h[i]) n++; return n; };
const peakShare = h => Math.max(...h) / histCount(h);

describe('the axis: CT keeps the 1-HU bins, other data bins over its own range', () => {
  it('HU_AXIS is the old fixed binning: 4096 bins of 1 HU, centred on whole HU from -1024', () => {
    expect(HU_AXIS.hu).toBe(true); expect(axisWidth(HU_AXIS)).toBe(1); expect(HIST_BINS).toBe(4096);
    for (const v of [-5000, -1024.4, -1024, -0.5, 0, 0.5, 10.4, 10.6, 3071, 3071.6, 99999]) expect(binOf(v, HU_AXIS)).toBe(huToBin(v));
    for (let i = 0; i < HIST_BINS; i += 97) expect(binValue(i, HU_AXIS)).toBe(i - 1024);
    expect(axisDecimals(HU_AXIS)).toBe(0); expect(axisKey(HU_AXIS)).toBe('hu');
  });
  it('axisFor: a CT-like range gets the CT axis (so CT is bit-for-bit as before); anything else its own range', () => {
    expect(axisFor(-1024, 3071)).toEqual(HU_AXIS); expect(axisFor(-1000, 2500)).toEqual(HU_AXIS); expect(axisFor(-3024, 61535)).toEqual(HU_AXIS);
    expect(axisFor(0, 65535)).toEqual({ min: -0.5, max: 65535.5, hu: false }); // 16-unit bins centred on the integers' grid (sample5: 0..65535)
    expect(axisFor(0, 255)).toEqual({ min: -0.5, max: 4095.5, hu: false }); // 8-bit: 1-unit bins centred on the integers
    const a28 = axisFor(0, 28, 0.0005); expect(axisWidth(a28)).toBeCloseTo(0.007, 12); expect(a28.min).toBeCloseTo(-0.00025, 12);
    const a6 = axisFor(-15.94, 22.628, 0.001); expect(axisWidth(a6)).toBeCloseTo(0.01, 12); // sample6: slope 0.001 -> 0.01 bins
    expect(axisWidth(axisFor(0, 65535))).toBe(16); expect(axisWidth(axisFor(0, 255))).toBe(1); expect(axisWidth(axisFor(0, 4095))).toBe(1);
    expect(axisFor(5, 5).max).toBeGreaterThan(5); // a single value still has a width
    expect(axisFor(NaN, 3)).toEqual(HU_AXIS); expect(axisFor(undefined, undefined)).toEqual(HU_AXIS);
  });
  it('valueStepOf: 1 for whole-number slopes, else the finest slope', () => {
    expect(valueStepOf([{ slope: 1 }, { slope: 1 }])).toBe(1); expect(valueStepOf([{ slope: 2 }])).toBe(1); expect(valueStepOf([{ slope: 0.001 }])).toBe(0.001);
    expect(valueStepOf([{ slope: 0.5 }, { slope: 0.25 }])).toBe(0.25); expect(valueStepOf([])).toBe(1); expect(valueStepOf(null)).toBe(1); expect(valueStepOf([{ slope: 0 }, { slope: NaN }])).toBe(1);
  });
  it('the CT test is the one of data-load.js (huLike), which is not changed', () => {
    expect(read('data-load.js')).toContain('const huLike=v.min<=-500&&v.max>=1000;');
    for (const [a, b, want] of [[-500, 1000, true], [-501, 1000, true], [-499, 1000, false], [-500, 999, false], [0, 65535, false], [-1024, 3071, true]]) expect(isHuLike(a, b)).toBe(want);
  });
  it('the bin of a value on a data axis: equal bins, the max in the last bin, clamped; its value is the centre', () => {
    const ax = axisFor(0, 65535);
    expect(binOf(0, ax)).toBe(0); expect(binOf(65535, ax)).toBe(4095); expect(binOf(-5, ax)).toBe(0); expect(binOf(1e9, ax)).toBe(4095);
    expect(binOf(32768, ax)).toBe(2048); expect(binValue(0, ax)).toBe(7.5); expect(binValue(4095, ax)).toBe(65527.5); expect(binOf(15, ax)).toBe(0); expect(binOf(16, ax)).toBe(1); // 16-unit bins: -0.5 .. 15.5 is bin 0
  });
});

describe('cap-shade.js uses this one histogram implementation (same bins, same counts)', () => {
  it('shadeBinOf / shadeBinValue / binShadeValues are histogram.js on the axis {min, max}', () => {
    expect(SHADE_HIST_BINS).toBe(HIST_BINS);
    const vals = mriLike(5000);
    for (const [min, max] of [[0, 65535], [-1024, 3071], [0, 28], [10.5, 4106.5]]) {
      for (const v of [min - 1, min, (min + max) / 2, max, max + 1, min + (max - min) * 0.123]) { expect(shadeBinOf(v, min, max)).toBe(binOf(v, { min, max })); }
      for (let b = 0; b < HIST_BINS; b += 311) expect(shadeBinValue(b, min, max)).toBe(binValue(b, { min, max }));
    }
    const a = binShadeValues(createShadeHist(), vals, 0, 65535, 0, vals.length, 1000, 50000), b = binValues(createHist(), vals, 0, vals.length, { min: 0, max: 65535 }, 1000, 50000);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it('cap-shade.js has no binning code of its own any more', () => {
    const s = read('cap-shade.js');
    expect(s).toContain("from './histogram.js"); expect(s).not.toMatch(/Math\.floor\(\(v - min\) \/ w \* SHADE_HIST_BINS\)/); expect(s).not.toMatch(/hist\[shadeBinOf/);
  });
  it('the VR label pass LUT (binLut with histMax) bins like binOf on the same axis', () => {
    const cal = [1, 0, 0], lut = binLut(cal, 0, HIST_BINS, 65535), ax = { min: 0, max: 65535 };
    for (const u of [0, 1, 17, 1000, 30000, 65534, 65535]) expect(lut[u]).toBe(binOf(u, ax));
  });
});

describe.each(FAMILIES)('histogram of %s data is meaningful (not collapsed into a few bins)', (name, make, min, max, step) => {
  const values = make(), ax = axisFor(min, max, step), h = binValues(createHist(), values, 0, values.length, ax);
  it('the old fixed 1-HU bins collapse it, the data axis does not', () => {
    const old = binValues(createHist(), values); // HU axis, as before
    if (max > 3071) expect(peakShare(old)).toBeGreaterThan(0.5); // MRI: most of it in the last bin
    expect(bins(h)).toBeGreaterThan(Math.min(150, max < 100 ? 150 : 400)); expect(peakShare(h)).toBeLessThan(0.1); expect(histCount(h)).toBe(values.length);
  });
  it('the extent, the stats and the percentiles are in the data units', () => {
    const e = histExtent(h, ax), w = axisWidth(ax);
    expect(e[0]).toBeLessThanOrEqual(min + w); expect(e[1]).toBeGreaterThanOrEqual(max - w);
    const st = histStats(h, undefined, ax);
    expect(st.min).toBeCloseTo(e[0], 9); expect(st.max).toBeCloseTo(e[1], 9);
    let s = 0; for (const v of values) s += v;
    expect(Math.abs(st.mean - s / values.length)).toBeLessThan(w); // the mean from the bins is within one bin of the exact mean
    const sorted = Float32Array.from(values).sort(), exact = p => sorted[Math.max(1, Math.ceil(values.length * p / 100)) - 1];
    for (const p of [5, 25, 50, 75, 95]) expect(Math.abs(st.percentiles[p] - exact(p))).toBeLessThanOrEqual(w + 1e-9);
  });
  it('the auto chart window covers the data (not the fixed -200..400), and is made of whole bins of the axis', () => {
    const res = { list: [], total: { hist: h }, axis: ax }, [lo, hi] = windowFor(res, { mode: 'auto' }), full = windowFor(res, { mode: 'full' });
    expect(hi - lo).toBeGreaterThan((max - min) * 0.5); expect(lo).toBeLessThanOrEqual(min + (max - min) * 0.05); expect(hi).toBeGreaterThan(min + (max - min) * 0.5);
    expect(full[0]).toBeLessThanOrEqual(min + 2 * axisWidth(ax) + (max - min) * 0.05); expect(full[1] - full[0]).toBeGreaterThan((max - min) * 0.9);
    expect(lo).toBeGreaterThanOrEqual(binValue(0, ax) - 1e-9); expect(hi).toBeLessThanOrEqual(binValue(HIST_BINS - 1, ax) + 1e-9);
  });
  it('rebinned into chart columns keeps the total and fills many columns', () => {
    const [lo, hi] = windowFor({ list: [], total: { hist: h }, axis: ax }, { mode: 'full' }), cols = 120, b = rebinHist(h, lo, hi, cols, undefined, ax);
    expect(b.reduce((x, y) => x + y)).toBe(histCount(h)); expect(b.filter(c => c > 0).length).toBeGreaterThan(Math.min(60, cols / 2));
    expect(windowBins(lo, hi, ax)).toBeGreaterThan(MIN_WINDOW);
  });
  it('a segment range on the data is a slice of the total (histInRange)', () => {
    const lo = min + (max - min) * 0.25, hi = min + (max - min) * 0.6, part = histInRange(h, lo, hi, ax);
    const exact = values.filter(v => v >= lo && v <= hi).length, got = histCount(part);
    expect(Math.abs(got - exact)).toBeLessThan(values.length * 0.01); // the two edge bins are shared
    expect(histCount(histInRange(h, hi, lo, ax))).toBe(0);
  });
  it('binRuns bins the voxels of the runs on the same axis', () => {
    const w = 4, vals = Float32Array.from([min, max, (min + max) / 2, min, max, max, min, min]), r = binRuns(createHist(), vals, Uint32Array.from([1, 0, 1]), w, 0, 3, ax);
    expect(histCount(r)).toBe(2); expect(r[binOf(max, ax)]).toBe(2);
  });
});

describe('8-bit and other integer data narrower than 4096 values: no comb (no empty columns, exact percentiles)', () => {
  // every integer 0..255 present, 40 times each (a flat histogram: any empty column inside the data is a binning artefact)
  const flat = Float32Array.from({ length: 256 * 40 }, (_, i) => i % 256), ax = axisFor(0, 255), h = binValues(createHist(), flat, 0, flat.length, ax);
  it('the bins are 1 unit wide and centred on the integers: one value per bin, the bin value is the integer', () => {
    expect(axisWidth(ax)).toBe(1); for (let v = 0; v < 256; v++) { expect(h[binOf(v, ax)]).toBe(40); expect(binValue(binOf(v, ax), ax)).toBe(v); }
    expect(bins(h)).toBe(256);
  });
  const emptyInside = (lo, hi, cols, dataHi = 255) => {
    const b = rebinHist(h, lo, hi, cols, undefined, ax), span = hi - lo + axisWidth(ax); let empty = 0;
    for (let k = 0; k < cols; k++) if (lo + k * span / cols <= dataHi && b[k] === 0) empty++; // a column that starts inside the data
    return empty;
  };
  it('VR board: the columns of the shown window (one per bin up to the board width) are all filled inside the data', () => {
    const res = { list: [], total: { hist: h }, axis: ax };
    for (const range of [{ mode: 'auto' }, { mode: 'full' }]) { const [lo, hi] = windowFor(res, range); expect(emptyInside(lo, hi, columnsFor(lo, hi, ax))).toBe(0); }
    expect(columnsFor(0, 255, ax)).toBe(256);
  });
  it('PC panel: at every chart width the columns inside the data are filled (columns = min(bins in the window, width / 2))', () => {
    const res = { list: [], total: { hist: h }, axis: ax }, [lo, hi] = windowFor(res, { mode: 'auto' });
    for (const plotW of [60, 100, 160, 240, 300, 420, 600, 900, 1400]) { const cols = Math.max(1, Math.min(windowBins(lo, hi, ax), Math.floor(plotW / 2))); expect(emptyInside(lo, hi, cols), 'width ' + plotW).toBe(0); }
  });
  it('p50 is 127 exactly, p5 / p25 / p75 / p95 are integers, min / max 0 / 255', () => {
    const st = histStats(h, undefined, ax);
    expect(st.percentiles[50]).toBe(127); expect(st.min).toBe(0); expect(st.max).toBe(255);
    for (const p of [5, 25, 75, 95]) expect(Number.isInteger(st.percentiles[p])).toBe(true);
    expect(st.mean).toBeCloseTo(127.5, 9); expect(axisDecimals(ax)).toBe(0); expect(fmtAxisValue(st.percentiles[50], ax)).toBe('127');
  });
  it('MRI 0..65535 (16-unit bins) and slope 0.001 (0.01 bins) data on their grid also leave no empty bin inside a flat histogram', () => {
    const mri = axisFor(0, 65535), n = 65536, mh = binValues(createHist(), Float32Array.from({ length: n }, (_, i) => i), 0, n, mri); // every value once: each of the 4096 bins holds exactly 16
    expect(bins(mh)).toBe(4096); expect(Math.max(...mh)).toBe(16); expect(Math.min(...mh)).toBe(16);
    const a6 = axisFor(-15.94, 22.63, 0.001), m = 38690, vals = Float32Array.from({ length: m }, (_, i) => Math.round((-15.94 + i * 0.001) * 1000) / 1000);
    const sh = binValues(createHist(), vals, 0, m, a6); expect(bins(sh)).toBe(Math.ceil(m / 10)); expect(Math.max(...sh) - Math.min(...sh.filter(x => x))).toBeLessThanOrEqual(1);
  });
});

describe('the window helpers on a data axis', () => {
  const ax = axisFor(0, 255), w = axisWidth(ax);
  it('clampWindow: inside the axis, at least MIN_WINDOW bins wide, rounded to the axis decimals; zoom keeps that', () => {
    const [lo, hi] = clampWindow(-30, 99999, ax);
    expect(lo).toBeCloseTo(binValue(0, ax), 6); expect(hi).toBeCloseTo(binValue(4095, ax), 6);
    const n = clampWindow(100, 101, ax); expect(n[1] - n[0]).toBeGreaterThanOrEqual(MIN_WINDOW * w - 1e-9);
    expect(clampWindow(NaN, 3, ax)).toBeNull();
    const z = zoomWindow(0, 255, 128, 0.5, ax); expect(z[1] - z[0]).toBeLessThan(255); expect(z[1] - z[0]).toBeGreaterThanOrEqual(MIN_WINDOW * w - 1e-9);
    expect(clampWindow(10.37, 100.99, ax).every(v => Math.abs(v * 10 ** axisDecimals(ax) - Math.round(v * 10 ** axisDecimals(ax))) < 1e-6)).toBe(true);
  });
  it('fitWindow without data is the whole axis (CT: the soft tissue window as before)', () => {
    const [lo, hi] = fitWindow([], ax); expect(lo).toBeCloseTo(binValue(0, ax), 6); expect(hi).toBeCloseTo(binValue(4095, ax), 6);
    expect(fitWindow([])).toEqual([-224, 424]); // CT: the default soft-tissue window (-200..400) padded by 4 %, as before
  });
  it('a manual window remembers the axis it was set on: a CT window is not applied to MRI data, an MRI window not to CT', () => {
    const mri = axisFor(0, 65535), res = { list: [], total: { hist: binValues(createHist(), mriLike(2000), 0, 2000, mri) }, axis: mri };
    const ctWindow = { mode: 'manual', lo: -200, hi: 400 }; // an old stored range (no ax) = a CT one
    const w = windowFor(res, ctWindow); expect(w[1] - w[0]).toBeGreaterThan(20000); // not -200..400
    const set = normalizeRange({ mode: 'manual', lo: 1000, hi: 30000, ax: axisKey(mri) }, mri); expect(set.ax).toBe('-0.5:65535.5');
    expect(windowFor(res, set)).toEqual([1000, 30000]);
    const ct = { list: [], total: null, axis: HU_AXIS };
    expect(windowFor(ct, set)).toEqual(fitWindow([], HU_AXIS)); // set on MRI: ignored on CT data
    expect(windowFor(ct, { mode: 'manual', lo: -100, hi: 300 })).toEqual([-100, 300]); // CT as before
    expect(normalizeRange({ mode: 'manual', lo: 9000, hi: 100 }, null)).toEqual({ mode: 'manual', lo: 100, hi: 9000 }); // null axis: finite and ordered only
  });
  it('chartSpans / the segment range lines use the axis too', () => {
    const mri = axisFor(0, 65535), h = binValues(createHist(), Float32Array.from([100, 30000, 60000]), 0, 3, mri);
    const e = chartSpans({ list: [{ seg: { min: 5000, max: 20000 }, hist: h }], total: null, axis: mri }, false);
    expect(e[0][0]).toBeCloseTo(binValue(binOf(100, mri), mri), 6); expect(e[1]).toEqual([5000, 20000]);
  });
  it('huToX divides by at least one bin of the axis, not by 1', () => {
    expect(huToX(0.5, 0, 1, 100, 0.01)).toBeCloseTo(50, 9); expect(huToX(5, 0, 10, 100)).toBe(50);
  });
});

describe('axis labels and ticks follow the scale of the data', () => {
  it('CT: the same fixed list of steps (10 .. 2000) and whole-HU labels', () => {
    for (const [span, mt] of [[50, 8], [400, 8], [4095, 8], [600, 5], [900, 3], [30, 12]]) expect(niceStep(span, mt)).toBe(niceStep(span, mt, HU_AXIS));
    expect(niceStep(400, 8)).toBe(50); expect(tickText(-150, 50)).toBe('-150'); expect(fmtAxisValue(-12, HU_AXIS)).toBe('-12');
  });
  it('other data: 1 / 2 / 2.5 / 5 x 10^k at any scale, labels without float noise', () => {
    const mri = axisFor(0, 65535), small = axisFor(0, 28, 0.0005), byte = axisFor(0, 255);
    expect(niceStep(65535, 8, mri)).toBe(10000); expect(niceStep(28, 8, small)).toBe(5); expect(niceStep(2.8, 8, small)).toBe(0.5); expect(niceStep(255, 8, byte)).toBe(50);
    expect(niceStep(0.0035, 8, small)).toBe(0.0005);
    for (let k = 1; k <= 7; k++) expect(tickText(k * 0.3, 0.3)).toBe((k * 0.3).toFixed(1)); // 0.30000000000000004 -> 0.3
    expect(tickText(0.0015, 0.0005)).toBe('0.0015'); expect(stepDecimals(2.5)).toBe(1); expect(stepDecimals(0.0025)).toBe(4); expect(stepDecimals(10000)).toBe(0);
    expect(fmtAxisValue(12.5, small)).toBe('12.5'); expect(fmtAxisValue(127, byte)).toBe('127'); expect(fmtAxisValue(0.30000000000000004, small)).toBe('0.3'); expect(fmtAxisValue(65535, mri)).toBe('65535');
  });
});

describe('VR histogram board layout and drawing on a data axis', () => {
  it('columnsFor: one column per bin up to the board width; CT unchanged; MAX_COLUMNS is the same for every axis', () => {
    expect(columnsFor(-200, 400)).toBe(Math.min(601, Math.floor(PLOT.w / 2))); expect(columnsFor(-200, 400, HU_AXIS)).toBe(columnsFor(-200, 400));
    expect(MAX_COLUMNS).toBe(Math.floor(PLOT.w / 2)); expect(columnsFor(-1024, 3071)).toBe(MAX_COLUMNS);
    const mri = axisFor(0, 65535), w = axisWidth(mri);
    expect(columnsFor(0, 100 * w, mri)).toBe(101); expect(columnsFor(0, 65535, mri)).toBe(MAX_COLUMNS);
  });
  it('dragWindow: CT as before (whole HU, 50 HU, -1024..3071); a data axis clamps to its own range and keeps the minimum window in bins', () => {
    expect(dragWindow('lo', { lo: -200, hi: 400, px: 100 }, 100 + PLOT.w / 4)).toEqual([-200 + 150, 400]);
    expect(dragWindow('hi', { lo: -200, hi: 400, px: 100 }, -1e6)).toEqual([-200, -200 + MIN_WINDOW]);
    expect(dragWindow('lo', { lo: 0, hi: 600, px: 0 }, -1e6)).toEqual([-1024, 600]);
    const mri = axisFor(0, 65535), w = axisWidth(mri), out = dragWindow('hi', { lo: 1000, hi: 40000, px: 0 }, 1e6, [0, 0], mri);
    expect(out[0]).toBe(1000); expect(out[1]).toBeCloseTo(binValue(HIST_BINS - 1, mri), 6);
    const lo = dragWindow('lo', { lo: 1000, hi: 40000, px: 0 }, 1e6, [0, 0], mri); expect(lo[1] - lo[0]).toBeCloseTo(MIN_WINDOW * w, 6);
    const neg = dragWindow('lo', { lo: 1000, hi: 40000, px: 0 }, -1e6, [0, 0], mri); expect(neg[0]).toBeCloseTo(binValue(0, mri), 6);
  });
  it('rangeRes carries the axis (default CT)', () => {
    expect(rangeRes([], null, [], 0, {}, []).axis).toEqual(HU_AXIS);
    const mri = axisFor(0, 65535); expect(rangeRes([], null, [], 0, {}, [], mri).axis).toEqual(mri);
  });
  describe('the board drawn on MRI-like data', () => {
    let rec;
    beforeEach(() => {
      rec = { fillRect: [], fillText: [] };
      const ctx = new Proxy({}, {
        get: (t, k) => (k === 'fillRect' ? (x, y, w, h) => rec.fillRect.push({ color: t.fillStyle, x, y, w, h }) : k === 'fillText' ? s => rec.fillText.push(String(s)) : k === 'measureText' ? s => ({ width: String(s).length * 12 })
          : typeof k === 'string' && /^(beginPath|moveTo|lineTo|stroke|fill|roundRect|clearRect|save|restore|translate|rotate|setTransform)$/.test(k) ? () => {} : t[k]),
        set: (t, k, v) => { t[k] = v; return true; } });
      vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    });
    const slotKeys = ['bone', 'soft', 'fat', 'lung'], segs = { bone: { min: 30000, max: 65535, color: '#e0d0a0' }, soft: { min: 5000, max: 30000, color: '#c06060' }, fat: { min: 1, max: 4999, color: '#e7c85d' }, lung: { min: 0, max: 0, color: '#6fb8d6' } };
    const L = { title: 'HU分布', approx: '概算', busy: '計算中', empty: 'データなし', xAxis: 'HU値', yAxis: 'ボクセル数', yAxisLog: 'ボクセル数（対数）' };
    function view(axis, values, range = { mode: 'auto' }) {
      const hists = new Array(LABELS).fill(null); hists[slotLabel(1)] = binValues(createHist(), values, 0, values.length, axis);
      const total = Uint32Array.from(hists[slotLabel(1)]);
      return { ready: true, hists, total, res: rangeRes(hists, total, slotKeys, 0b0010, segs, [], axis), range, approx: false, dims: [64, 64, 64], busy: false, message: '' };
    }
    const open = v => { const p = createVrHistogramPanel(THREE, { getView: () => v, getProgress: () => ({ busy: false, frac: -1 }), colorOf: () => '#c06060', nameOf: () => 'x', log: () => false, widthM: 0.46, L }); p.setOpen(true); p.update(1000); return p; };
    it('auto range: the window covers the MRI data, many bars are drawn, the tick labels are on the data scale', () => {
      const ax = axisFor(0, 65535), v = view(ax, mriLike()), p = open(v);
      const [lo, hi] = p.window; expect(hi - lo).toBeGreaterThan(30000);
      expect(rec.fillRect.filter(r => r.color === '#c06060').length).toBeGreaterThan(100);
      const ticks = rec.fillText.filter(t => /^\d+$/.test(t)).map(Number); expect(ticks.some(t => t >= 10000)).toBe(true);
      expect(rec.fillText.some(t => t.startsWith('◀ '))).toBe(true);
    });
    it('slope-scaled 0..28: decimal tick labels and end values, still many bars', () => {
      const ax = axisFor(0, 28, 0.0005), v = view(ax, slopeScaled()), p = open(v);
      expect(p.window[1] - p.window[0]).toBeGreaterThan(14); expect(rec.fillRect.filter(r => r.color === '#c06060').length).toBeGreaterThan(100);
      expect(rec.fillText.some(t => /^[0-9]+(\.[0-9]+)?$/.test(t) && +t > 0 && +t < 30)).toBe(true);
      expect(rec.fillText.every(t => !/\d\.\d{9,}/.test(t))).toBe(true); // no float noise in a label
    });
    it('a CT view is drawn exactly as before (CT axis, whole HU labels)', () => {
      const v = view(HU_AXIS, Float32Array.from({ length: 4000 }, (_, i) => -200 + (i % 700))), p = open(v);
      expect(p.window[0]).toBeLessThan(-150); expect(rec.fillText.filter(t => /^-?\d+$/.test(t)).length).toBeGreaterThan(3);
    });
    it('the end drag on a data axis stays inside the data axis and keeps whole decimals', () => {
      const ax = axisFor(0, 65535), p = open(view(ax, mriLike()));
      expect(p.startAxisDrag('hi', 0.1)).toBe(true); p.moveAxisDrag(5); // far to the right
      expect(p.dragWindow[1]).toBeLessThanOrEqual(binValue(HIST_BINS - 1, ax) + 1e-6); expect(p.dragWindow[1]).toBeGreaterThan(30000);
      const w = p.endAxisDrag(); expect(w).not.toBeNull();
    });
  });
});

describe('line profile percentiles on a data axis', () => {
  it('profileStats on MRI-like values: the percentiles are on the data scale (the CT axis would pile them into the top bin)', () => {
    const vals = mriLike(5000), ax = axisFor(0, 65535), st = profileStats(vals, ax), old = profileStats(vals);
    expect(st.percentiles[50]).toBeGreaterThan(10000); expect(st.percentiles[5]).toBeLessThan(st.percentiles[95]); expect(old.percentiles[50]).toBe(3071);
    expect(profileStats(vals).axis).toEqual(HU_AXIS); expect(profileStats([]).axis).toEqual(HU_AXIS);
  });
});

describe('the PC panel and the VR board hand the data axis to the histogram code', () => {
  it('histogram-ui.js bins, reads and draws with axisOf(volume); the VR pass counts non-CT data in equal bins over the data range (binRange)', () => {
    const ui = read('histogram-ui.js'), vr = read('vr-view.js');
    expect(read('segments.js')).toContain('const axis=axisFor(v.min,v.max,valueStepOf(activeSeries?.slices));');
    expect(ui).toContain('const axisOf = v => (v ? dataAxis(v) : HU_AXIS);'); expect(ui).toContain('binValues(total, values, a, Math.min(values.length, a + CHUNK), axis);'); expect(ui).toContain('binRuns(hists[i], values, r, w, a, a + RUN_CHUNK, axis);');
    expect(ui).toContain('histInRange(tot.hist, seg.min, seg.max, axis)'); expect(ui).toContain('return { list: out, total: tot || null, axis };');
    expect(vr).toContain('ax=dr?dataAxis():null,br=ax&&!ax.hu?{min:ax.min,max:ax.max}:null'); expect(vr).toContain("binRange:br,grid:g"); expect(vr).toContain('segmentState,histP?.region?.segs,r.axis)');
    expect(read('vr-label-histogram.js')).toContain('const br = input.binRange, axis = br ? { min: br.min, max: br.max, hu: false } : HU_AXIS;');
  });
  it('no fixed 1-HU range is left in the chart code paths of the panel / board (HIST_MIN / HIST_MAX only inside histogram.js and the label pass defaults)', () => {
    for (const f of ['histogram-ui.js', 'vr-histogram-panel.js', 'vr-histogram-layout.js']) expect(read(f)).not.toMatch(/\bHIST_MIN\b|\bHIST_MAX\b/);
  });
});

describe('filter parameters (filter-units.js) follow the data range when it is not CT-like', () => {
  it('CT-like and unknown ranges: scale exactly 1, the same definition objects (nothing changes)', () => {
    for (const r of [{ min: -1024, max: 3071 }, { min: -4000, max: 61535 }, { min: -500, max: 1000 }, null, {}, { min: NaN, max: 1 }, { min: 5, max: 5 }]) expect(unitScaleFor(r)).toBe(1);
    const d = FILTER_UNITS.spikeHole.params.thresholdHU; expect(scaledUnitDef(d, 1)).toBe(d);
    expect([d.def, d.min, d.max, d.step]).toEqual([100, 20, 1000, 5]);
  });
  it('MRI 0..65535 / 8-bit 0..255 / slope-scaled 0..28: the Spike/Hole threshold (and the other HU sliders) scale with the span', () => {
    const d = FILTER_UNITS.spikeHole.params.thresholdHU;
    const mri = scaledUnitDef(d, unitScaleFor({ min: 0, max: 65535 })); expect(mri.min).toBeCloseTo(20 * 65535 / 4095, 0); expect(mri.max).toBeGreaterThan(15000); expect(mri.def).toBeGreaterThan(1000); expect(mri.step).toBeGreaterThan(50);
    const b = scaledUnitDef(d, unitScaleFor({ min: 0, max: 255 })); expect(b.min).toBeCloseTo(1.25, 2); expect(b.max).toBeCloseTo(62.3, 1); expect(b.def).toBeCloseTo(6.23, 2);
    const s = scaledUnitDef(d, unitScaleFor({ min: 0, max: 28 })); expect(s.max).toBeCloseTo(6.84, 2); expect(s.min).toBeGreaterThan(0); expect(s.min).toBeLessThan(s.def); expect(s.def).toBeLessThan(s.max);
    const u = FILTER_UNITS.unsharp.params.thresholdHU; expect(scaledUnitDef(u, 0.5).min).toBe(0); // 0 stays 0 (the slider starts at 0)
    const tv = FILTER_UNITS.tv.params.epsHU; expect(scaledUnitDef(tv, 0.5).min).toBe(null); expect(scaledUnitDef(tv, 0.5).def).toBe(0.5);
  });
  it('a project without a saved value gets the scaled default (CT: the old 100)', () => {
    expect(resolveFilterParams('spikeHole', null, { min: -1024, max: 3071 }).values.thresholdHU).toBeCloseTo(0.075 * 4095, 6); // CT: derived from the span as before
    expect(resolveFilterParams('spikeHole', null, { min: 0, max: 28 }).values.thresholdHU).toBeCloseTo(0.075 * 28, 6); // the derivation was always from the span
    const bad = resolveFilterParams('spikeHole', { threshold: -1 }, { min: NaN, max: NaN }); expect(bad.values.thresholdHU).toBe(100);
    expect(resolveFilterParams('spikeHole', { thresholdHU: 3 }, { min: 0, max: 28 }).values.thresholdHU).toBe(3);
  });
  it('the sliders are re-ranged when a data opens (and only when the scale changes)', () => {
    const fp = read('filter-pipeline.js'), dl = read('data-load.js');
    expect(fp).toContain('export function applyFilterUnitRanges(range){'); expect(fp).toContain('const k=unitScaleFor(range);if(k===unitScale)return;');
    expect(dl).toContain('applyFilterUnitRanges({min:v.min,max:v.max})'); expect(dl).toContain('const huLike=v.min<=-500&&v.max>=1000;');
    expect(fp).not.toMatch(/def=FILTER_UNITS\[key\]/); // every lookup goes through the scaled definition (unitDefOf)
    // the metadata range of a source-backed series (sample5: 0..65535, factor 16) is only the fallback: once the MPR cache has measured the data's own range (volume.min / max rewritten) the sliders follow it
    expect(dl.indexOf('applyFilterUnitRanges({min:sourceVolume.min,max:sourceVolume.max})')).toBeGreaterThan(dl.indexOf('await prepareSourceMprCache(sourceVolume,'));
    expect(unitScaleFor({ min: 0, max: 11997 })).toBeCloseTo(11997 / 4095, 9); expect(unitScaleFor({ min: 0, max: 65535 })).toBeCloseTo(16.0037, 3); expect(unitScaleFor({ min: 0, max: 11997 })).not.toBe(unitScaleFor({ min: 0, max: 65535 }));
  });
});
