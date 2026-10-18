import { describe, it, expect } from 'vitest';
import * as Layout from '../../docs/vr-histogram-layout.js';
import { PANEL_W, PANEL_H, PLOT, LEGEND, STATUS_Y, TITLE_Y, X_TICK_Y, X_AXIS_Y, MIN_GAP_MS, boardHeightM, pxToLocalX, pxToLocalY, columnsFor, barFraction, countLabel, yTicks, STACK_ORDER, stackColumn, rangeRes, legendItems, legendLayout, titleText, yAxisText, progressText, shouldRedraw, axisTarget, dragWindow, localToPxX, localToPxY, AUTO_BTN, AXIS_GRAB } from '../../docs/vr-histogram-layout.js';
import { createHist, binValues, fitWindow, chartSpans, windowFor, histCount, HIST_MIN } from '../../docs/histogram.js';
import { LABELS, UNLABELED, slotLabel, regionLabel } from '../../docs/vr-label-histogram.js';

const W = 0.46;
const histOf = values => binValues(createHist(), Float32Array.from(values));

describe('canvas px -> board metres', () => {
  it('the centre of the canvas is the board centre, x grows right, y grows up', () => {
    expect(pxToLocalX(PANEL_W / 2, W)).toBeCloseTo(0); expect(pxToLocalY(PANEL_H / 2, W)).toBeCloseTo(0);
    expect(pxToLocalX(PANEL_W, W)).toBeCloseTo(W / 2); expect(pxToLocalY(0, W)).toBeCloseTo(boardHeightM(W) / 2);
  });
  it('title, plot, axis titles, legend and status are stacked top to bottom inside the canvas', () => {
    expect(TITLE_Y).toBeLessThan(PLOT.y); expect(PLOT.y + PLOT.h).toBeLessThan(X_TICK_Y); expect(X_TICK_Y).toBeLessThan(X_AXIS_Y);
    expect(X_AXIS_Y).toBeLessThan(LEGEND.y); expect(LEGEND.y + LEGEND.rowH).toBeLessThan(STATUS_Y); expect(STATUS_Y).toBeLessThan(PANEL_H);
    expect(PLOT.x + PLOT.w).toBeLessThan(PANEL_W);
  });
});

describe('build 567: what was removed is gone', () => {
  it('no range lines, no VR window lines, no laser drag, no stats table', () => {
    for (const k of ['lineLayout', 'edgeLabelText', 'labelCenterX', 'plotMetrics', 'snapshotRanges', 'localXToHu', 'GRAB_TOL_M', 'DRAG_START_M', 'DRAG_GAP_MS',
      'LINE_W_M', 'LINE_WIN_W_M', 'LABEL_W_M', 'TABLE', 'tableColumns', 'statsCells', 'tableRows', 'SETTLE_MS', 'subtitleText']) expect(Layout[k]).toBeUndefined();
  });
});

describe('bars and ticks', () => {
  it('columns: one per HU while that fits, at most one per 2 px', () => {
    expect(columnsFor(0, 99)).toBe(100); expect(columnsFor(-1024, 3071)).toBe(Math.floor(PLOT.w / 2)); expect(columnsFor(5, 5)).toBe(1);
  });
  it('bar fraction: linear and log are 0 for an empty bin and 1 for the maximum', () => {
    expect(barFraction(0, 100, false)).toBe(0); expect(barFraction(100, 100, false)).toBe(1); expect(barFraction(50, 100, false)).toBe(0.5);
    expect(barFraction(100, 100, true)).toBeCloseTo(1); expect(barFraction(10, 100, true)).toBeGreaterThan(barFraction(10, 100, false));
  });
  it('count labels are short', () => { expect(countLabel(950)).toBe('950'); expect(countLabel(1500)).toBe('1.5k'); expect(countLabel(12345)).toBe('12k'); expect(countLabel(2500000)).toBe('2.5M'); expect(countLabel(0)).toBe('0'); });
  it('y ticks: 0 and a few round steps (linear), powers of ten (log), all within the plot', () => {
    { const o = [9, 9, 9, 9, 9, 9, 9, 9, 9]; expect(yTicks(12345, false, o)).toBe(o); expect(o).toEqual(yTicks(12345, false)); } // build 571: a reused array
    const lin = yTicks(12345, false); expect(lin[0]).toBe(0); expect(lin.length).toBeGreaterThanOrEqual(3); expect(lin.length).toBeLessThanOrEqual(7);
    expect(lin.every(v => v <= 12345)).toBe(true); expect(lin.every((v, i) => !i || v > lin[i - 1])).toBe(true);
    const lg = yTicks(2e6, true); expect(lg[0]).toBe(0); expect(lg.slice(1).every(v => Math.log10(v) % 1 === 0)).toBe(true); expect(lg.length).toBeLessThanOrEqual(6);
    expect(yTicks(0, false)).toEqual([0]); expect(yTicks(44000, false)).toEqual([0, 10000, 20000, 30000, 40000]); expect(yTicks(3, false)).toEqual([0, 1, 2, 3]);
  });
});

describe('stacked column (one bar = the labels it holds)', () => {
  const cols = new Array(LABELS).fill(null);
  cols[slotLabel(0)] = [30]; cols[slotLabel(1)] = [10]; cols[regionLabel(0)] = [20]; cols[UNLABELED] = [40];
  it('the parts add up to the bar height, in proportion to the counts; unlabeled (gray) on top', () => {
    const out = new Float64Array(STACK_ORDER.length), total = stackColumn(cols, 0, 100, false, 200, out);
    expect(total).toBe(100); expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(200);
    expect(out[STACK_ORDER.indexOf(slotLabel(0))]).toBeCloseTo(60); expect(out[STACK_ORDER.indexOf(UNLABELED)]).toBeCloseTo(80);
    expect(STACK_ORDER.at(-1)).toBe(UNLABELED); expect(STACK_ORDER[0]).toBe(slotLabel(0)); // slot order first (the shader's priority), gray last
  });
  it('log scale: the whole bar follows the log of its total, the parts still split it', () => {
    const out = new Float64Array(STACK_ORDER.length); stackColumn(cols, 0, 1000, true, 200, out);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(barFraction(100, 1000, true) * 200);
  });
  it('an empty column is empty', () => {
    const out = new Float64Array(STACK_ORDER.length).fill(5); expect(stackColumn(new Array(LABELS).fill(null), 0, 10, false, 100, out)).toBe(0); expect([...out].every(v => v === 0)).toBe(true);
  });
});

describe('display range: 自動 / 全体 / 手動 exactly as on PC (histogram.js windowFor)', () => {
  const segs = { bone: { min: 300, max: 3000, color: '#eee' }, soft: { min: -100, max: 200, color: '#c66' }, fat: { min: -200, max: -101, color: '#ec5' }, lung: { min: -900, max: -400 } };
  const hists = new Array(LABELS).fill(null);
  hists[slotLabel(0)] = histOf([1500]); // bone: a thin tail
  hists[slotLabel(1)] = histOf(Array.from({ length: 2000 }, (_, i) => -50 + (i % 150)));
  hists[regionLabel(0)] = histOf([10, 20, 30]); // an analysis colour of soft
  hists[UNLABELED] = histOf(Array.from({ length: 5000 }, () => -1000));
  const total = createHist(); for (const h of hists) if (h) for (let i = 0; i < h.length; i++) total[i] += h[i];
  const res = rangeRes(hists, total, ['bone', 'soft', 'fat', 'lung'], 0b0111, segs, [0b0010]);
  it('one entry per shown segment: its slot label plus its analysis colours; the whole volume as the total', () => {
    expect(res.list.map(r => r.key)).toEqual(['bone', 'soft', 'fat']);
    expect(histCount(res.list[1].hist)).toBe(2003); expect(res.list[2].hist).toBeNull(); expect(histCount(res.total.hist)).toBe(2000 + 3 + 1 + 5000);
  });
  it('the modes give the windows the PC chart gives for the same results', () => {
    const auto = windowFor(res, { mode: 'auto' }), full = windowFor(res, { mode: 'full' }), manual = windowFor(res, { mode: 'manual', lo: -300, hi: 700 });
    expect(auto[1]).toBeLessThan(1500); // the bone tail does not stretch the auto window (the reason it exists)
    expect(full[0]).toBeLessThanOrEqual(-1000); expect(full[1]).toBeGreaterThanOrEqual(3000);
    expect(manual).toEqual([-300, 700]);
    expect(full).toEqual(fitWindow(chartSpans(res, false)));
    expect(auto[0]).toBeGreaterThan(HIST_MIN);
  });
});

describe('legend and texts', () => {
  it('only labels with voxels, in stacking order; laid out left to right and wrapped', () => {
    const hists = new Array(LABELS).fill(null); hists[UNLABELED] = histOf([0]); hists[slotLabel(2)] = histOf([1]); hists[slotLabel(1)] = createHist();
    const items = legendItems(hists, L => '#' + L, L => 'n' + L);
    expect(items.map(i => i.label)).toEqual([slotLabel(2), UNLABELED]);
    const many = Array.from({ length: 12 }, (_, i) => ({ label: i, name: 'Segment ' + i, color: '#fff' }));
    const lay = legendLayout(many, t => t.length * 14);
    expect(lay.every(p => p.x >= LEGEND.x && p.x < LEGEND.maxX)).toBe(true); expect(new Set(lay.map(p => p.y)).size).toBeLessThanOrEqual(2);
  });
  it('the title says 概算 only for a reduced grid; axis and progress texts', () => {
    expect(titleText('HU分布', '', [256, 256, 128])).toBe('HU分布'); expect(titleText('HU分布', '概算', [256, 256, 128])).toBe('HU分布（概算 256×256×128）');
    const L = { yAxis: 'ボクセル数', yAxisLog: 'ボクセル数（対数）' }; expect(yAxisText(L, false)).toBe('ボクセル数'); expect(yAxisText(L, true)).toBe('ボクセル数（対数）');
    expect(progressText('計算中', { busy: true, frac: 0.42 })).toBe('計算中 42%'); expect(progressText('計算中', { busy: false })).toBe('');
  });
});

describe('redraw policy', () => {
  it('only when dirty, at most once per MIN_GAP_MS', () => {
    expect(shouldRedraw({ dirty: false, now: 1000, lastDraw: 0 })).toBe(false);
    expect(shouldRedraw({ dirty: true, now: 1000, lastDraw: 0 })).toBe(true);
    expect(shouldRedraw({ dirty: true, now: 1000, lastDraw: 1000 - MIN_GAP_MS + 1 })).toBe(false);
  });
});

describe('build 570: the x-axis end drag (display range from VR)', () => {
  it('px <-> board metres round trip', () => {
    expect(localToPxX(pxToLocalX(300, W), W)).toBeCloseTo(300); expect(localToPxY(pxToLocalY(200, W), W)).toBeCloseTo(200);
  });
  it('hit zones: each end of the plot from its top down to the end labels; the 自動 button; nothing in the middle or above the plot', () => {
    expect(axisTarget(PLOT.x, PLOT.y + 10)).toBe('lo'); expect(axisTarget(PLOT.x - AXIS_GRAB.outer, X_AXIS_Y)).toBe('lo'); expect(axisTarget(PLOT.x + AXIS_GRAB.inner + 1, PLOT.y + 10)).toBeNull();
    expect(axisTarget(PLOT.x + PLOT.w, PLOT.y + PLOT.h)).toBe('hi'); expect(axisTarget(PLOT.x + PLOT.w - AXIS_GRAB.inner - 1, PLOT.y + 10)).toBeNull();
    expect(axisTarget(PLOT.x, PLOT.y - 5)).toBeNull(); expect(axisTarget(PLOT.x, AXIS_GRAB.bottom + 1)).toBeNull();
    expect(axisTarget(AUTO_BTN.x + 1, AUTO_BTN.y + 1)).toBe('auto'); expect(axisTarget(PLOT.x + PLOT.w / 2, PLOT.y + 100)).toBeNull();
  });
  it('HU mapping: the end moves by the laser travel at the grab-time scale; whole HU; min width 50; clamped to -1024..3071; the other end stays', () => {
    const st = { lo: -200, hi: 800, px: PLOT.x + PLOT.w };
    expect(dragWindow('hi', st, st.px - PLOT.w / 4)).toEqual([-200, 550]); expect(dragWindow('hi', st, st.px - 10 * PLOT.w)).toEqual([-200, -150]);
    expect(dragWindow('hi', st, st.px + 10 * PLOT.w)).toEqual([-200, 3071]);
    const sl = { lo: -200, hi: 800, px: PLOT.x };
    expect(dragWindow('lo', sl, sl.px + PLOT.w / 10)).toEqual([-100, 800]); expect(dragWindow('lo', sl, sl.px + 10 * PLOT.w)).toEqual([750, 800]); expect(dragWindow('lo', sl, sl.px - 10 * PLOT.w)).toEqual([-1024, 800]);
    const out = [0, 0]; expect(dragWindow('lo', sl, sl.px, out)).toBe(out); // no allocation per frame
  });
});
