import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import * as Panel from '../../docs/vr-histogram-panel.js';
import { createVrHistogramPanel } from '../../docs/vr-histogram-panel.js';
import { createHist, binValues, windowFor } from '../../docs/histogram.js';
import { MIN_GAP_MS, rangeRes, PANEL_W, PANEL_H, PLOT, AUTO_BTN, X_AXIS_Y, DRAG_REDRAW_MS, pxToLocalX, pxToLocalY } from '../../docs/vr-histogram-layout.js';
import { LABELS, UNLABELED, UNLABELED_COLOR, slotLabel } from '../../docs/vr-label-histogram.js';

// a canvas whose 2D context records the colours of the bars and the texts drawn
let rec;
beforeEach(() => {
  rec = { fillRect: [], fillText: [], canvases: [] };
  const ctx = new Proxy({}, {
    get: (t, k) => (k === 'fillRect' ? (x, y, w, h) => rec.fillRect.push({ color: t.fillStyle, x, y, w, h }) : k === 'fillText' ? s => rec.fillText.push(String(s)) : k === 'measureText' ? s => ({ width: String(s).length * 13 })
      : typeof k === 'string' && /^(beginPath|moveTo|lineTo|stroke|fill|roundRect|clearRect|save|restore|translate|rotate|setTransform)$/.test(k) ? () => {} : t[k]),
    set: (t, k, v) => { t[k] = v; return true; } });
  vi.stubGlobal('document', { createElement: () => { const c = { width: 0, height: 0, getContext: () => ctx }; rec.canvases.push(c); return c; } });
});

const W = 0.46, slotKeys = ['bone', 'soft', 'fat', 'lung'];
const segs = { bone: { min: 300, max: 3000, color: '#e0d0a0' }, soft: { min: -100, max: 200, color: '#c06060' }, fat: { min: -200, max: -101, color: '#e7c85d' }, lung: { min: -900, max: -400, color: '#6fb8d6' } };
const histOf = values => binValues(createHist(), Float32Array.from(values));
const L = { title: 'HU分布', approx: '概算', busy: '計算中', empty: 'データなし', xAxis: 'HU値', yAxis: 'ボクセル数', yAxisLog: 'ボクセル数（対数）' };
const colorOf = l => (l === UNLABELED ? UNLABELED_COLOR : segs[slotKeys[l - 1]]?.color || '#123456');
const nameOf = l => (l === UNLABELED ? 'セグメント外' : slotKeys[l - 1]);
function mk({ range = { mode: 'manual', lo: -200, hi: 400 }, reduced = false, ready = true } = {}) {
  const hists = new Array(LABELS).fill(null);
  hists[slotLabel(1)] = histOf([0, 10, 20, 30, 40]); // soft
  hists[UNLABELED] = histOf([0, 0, 50, 300]);       // in the same HU bins as soft: one bar holds both
  const total = createHist(); for (const h of hists) if (h) for (let i = 0; i < h.length; i++) total[i] += h[i];
  const view = { ready, hists, total, res: rangeRes(hists, total, slotKeys, 0b0011, segs, []), range, approx: reduced, dims: [256, 256, 128], busy: false, message: '' };
  const getView = vi.fn(() => view);
  const prog = { busy: false, frac: -1 };
  const panel = createVrHistogramPanel(THREE, { getView, getProgress: () => prog, colorOf, nameOf, log: () => false, widthM: W, L });
  return { panel, getView, view, prog };
}

describe('VR histogram board (build 567): one stacked histogram of the whole volume', () => {
  it('is hidden and does nothing until opened', () => {
    const { panel, getView } = mk(); panel.update(0);
    expect(panel.group.visible).toBe(false); expect(panel.drawCount).toBe(0); expect(getView).not.toHaveBeenCalled();
  });
  it('opening draws once; 600 further frames with nothing changed draw nothing and read no data', () => {
    const { panel, getView } = mk(); panel.setOpen(true);
    for (let f = 0; f < 600; f++) panel.update(1000 + f * 14);
    expect(panel.drawCount).toBe(1); expect(getView).toHaveBeenCalledTimes(1);
  });
  it('new data / range / scale (invalidate) redraws, at most once per MIN_GAP_MS', () => {
    const { panel } = mk(); panel.setOpen(true); panel.update(1000);
    panel.invalidate(); panel.update(1000 + MIN_GAP_MS - 1); expect(panel.drawCount).toBe(1);
    panel.update(1000 + MIN_GAP_MS); expect(panel.drawCount).toBe(2);
  });
  it('a bar holding a segment and unlabeled voxels is drawn as a stack: the segment colour at the bottom, gray on top', () => {
    const { panel } = mk(); panel.setOpen(true); panel.update(1000);
    const bars = rec.fillRect.filter(r => r.color === segs.soft.color || r.color === UNLABELED_COLOR);
    const soft0 = bars.find(r => r.color === segs.soft.color), grayAbove = bars.find(r => r.color === UNLABELED_COLOR && Math.abs(r.x - soft0.x) < 1e-6);
    expect(soft0).toBeTruthy(); expect(grayAbove).toBeTruthy();
    expect(grayAbove.y + grayAbove.h).toBeCloseTo(soft0.y); // the gray part starts where the segment part ends
  });
  it('the display range is the PC one: 手動 shows exactly that window, 自動 / 全体 follow windowFor', () => {
    const a = mk({ range: { mode: 'manual', lo: -300, hi: 700 } }); a.panel.setOpen(true); a.panel.update(1000); expect(a.panel.window).toEqual([-300, 700]);
    const b = mk({ range: { mode: 'full' } }); b.panel.setOpen(true); b.panel.update(1000); expect(b.panel.window[1]).toBeGreaterThanOrEqual(3000); // the bone range is in the full window
    const c = mk({ range: { mode: 'auto' } }); c.panel.setOpen(true); c.panel.update(1000); expect(c.panel.window).toEqual(windowFor(c.view.res, { mode: 'auto' }));
  });
  it('title, axes with a few y ticks, and a legend (swatch + name) of the labels present; no stats table', () => {
    const { panel } = mk(); panel.setOpen(true); panel.update(1000);
    expect(rec.fillText).toContain('HU分布'); expect(rec.fillText).toContain('HU値'); expect(rec.fillText).toContain('ボクセル数');
    expect(rec.fillText).toContain('soft'); expect(rec.fillText).toContain('セグメント外'); expect(rec.fillText).not.toContain('bone'); // bone has no voxel: not in the legend
    expect(rec.fillText.filter(t => /^\d+(\.\d)?k?$/.test(t)).length).toBeGreaterThanOrEqual(5); // HU ticks and count ticks
    expect(rec.fillText.some(t => /SD|中央値|平均/.test(t))).toBe(false);
  });
  it('「概算」 only when the counts come from a reduced grid', () => {
    const a = mk({ reduced: true }); a.panel.setOpen(true); a.panel.update(1000); expect(rec.fillText).toContain('HU分布（概算 256×256×128）');
    rec.fillText.length = 0; const b = mk(); b.panel.setOpen(true); b.panel.update(1000); expect(rec.fillText.some(t => t.includes('概算'))).toBe(false);
  });
  it('no data yet: the empty board with a short status', () => {
    const { panel } = mk({ ready: false }); panel.setOpen(true); panel.update(1000); expect(rec.fillText).toContain('データなし'); expect(panel.window).toBeNull();
  });
  it('a running pass shows its percent on a small quad redrawn only when the percent changes; the board is not redrawn for it', () => {
    const { panel, prog } = mk(); panel.setOpen(true); panel.update(1000);
    const quad = panel.group.children.find(o => o !== panel.board); const n0 = rec.fillText.length;
    prog.busy = true; prog.frac = 0.42; panel.update(1014); expect(quad.visible).toBe(true); expect(rec.fillText.at(-1)).toBe('計算中 42%');
    const n1 = rec.fillText.length; panel.update(1028); expect(rec.fillText.length).toBe(n1); expect(n1).toBe(n0 + 1);
    prog.busy = false; panel.update(1042); expect(quad.visible).toBe(false); expect(panel.drawCount).toBe(1);
  });
  it('no segment range lines / segment editing: only the x axis ends and 「自動」 react; the board, the progress quad, three highlight quads and the drag overlay', () => {
    const { panel } = mk(); panel.setOpen(true); panel.update(1000);
    for (const k of ['grab', 'dragTo', 'release', 'setLine', 'commitLine']) expect(k in panel).toBe(false);
    expect(panel.group.children.length).toBe(6); // + build 571: the drag overlay
    // every highlight quad lies on the board (the right end's grab zone reaches past the edge; its quad is clipped)
    const hw = W / 2, hh = W * 640 / 1024 / 2, eps = 1e-9;
    for (const m of panel.group.children.slice(2)) {
      m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
      expect(m.position.x + b.min.x).toBeGreaterThanOrEqual(-hw - eps); expect(m.position.x + b.max.x).toBeLessThanOrEqual(hw + eps);
      expect(m.position.y + b.min.y).toBeGreaterThanOrEqual(-hh - eps); expect(m.position.y + b.max.y).toBeLessThanOrEqual(hh + eps);
    }
    expect(Panel.HISTOGRAM_SELF_CHECK.id).toBe('histogram');
  });
  // board metres of a canvas px point
  const at = (px, py) => [pxToLocalX(px, W), pxToLocalY(py, W)];
  it('build 570: the laser target: the x axis ends (plot edges down to the end labels) and 「自動」; nothing before data is shown', () => {
    const { panel } = mk({ ready: false }); panel.setOpen(true); panel.update(1000); expect(panel.axisTargetAt(...at(PLOT.x, PLOT.y + 50))).toBeNull();
    const b = mk(); b.panel.setOpen(true); b.panel.update(1000);
    expect(b.panel.axisTargetAt(...at(PLOT.x + 5, PLOT.y + 100))).toBe('lo'); expect(b.panel.axisTargetAt(...at(PLOT.x + PLOT.w - 5, X_AXIS_Y))).toBe('hi');
    expect(b.panel.axisTargetAt(...at(PLOT.x + PLOT.w / 2, PLOT.y + 100))).toBeNull();
    expect(b.panel.axisTargetAt(...at(AUTO_BTN.x + 10, AUTO_BTN.y + 10))).toBe('auto');
  });
  it('build 570: hover lights only that zone (a quad, no redraw)', () => {
    const { panel } = mk(); panel.setOpen(true); panel.update(1000); const n = panel.drawCount, quads = panel.group.children.slice(2);
    panel.setAxisHover('hi'); expect(quads.filter(q => q.visible).length).toBe(1); panel.update(2000); expect(panel.drawCount).toBe(n);
    panel.setAxisHover(null); expect(quads.some(q => q.visible)).toBe(false);
  });
  it('build 570 / 571: dragging the right end narrows / widens the window at the grab-time scale; only the small overlay follows, at most every DRAG_REDRAW_MS; release returns the window', () => {
    const { panel } = mk({ range: { mode: 'manual', lo: -200, hi: 400 } }); panel.setOpen(true); panel.update(1000); const n0 = panel.drawCount;
    expect(panel.overlay.visible).toBe(false); expect(panel.overlayCanvas.width * panel.overlayCanvas.height).toBeLessThan(PANEL_W * PANEL_H / 5);
    const [x0] = at(PLOT.x + PLOT.w, 0); expect(panel.startAxisDrag('hi', x0)).toBe(true); expect(panel.axisDragging).toBe('hi');
    panel.update(1014); expect(panel.drawCount).toBe(n0 + 1); expect(panel.overlayDrawCount).toBe(1); expect(panel.overlay.visible).toBe(true); // the grab: the board once (plot part blank) + the overlay
    const [x1] = at(PLOT.x + PLOT.w / 2, 0); panel.moveAxisDrag(x1); expect(panel.dragWindow).toEqual([-200, 100]); // half the plot = 300 HU
    let t = 1014; for (let f = 0; f < 6; f++) { t += 14; panel.update(t); }
    expect(panel.overlayDrawCount).toBe(2); expect(panel.drawCount).toBe(n0 + 1); expect(panel.window).toEqual([-200, 100]); // 84 ms: one overlay redraw, no board redraw
    // a steady drag over 1 s of 14 ms frames: the overlay ~12 times, the board never
    const o0 = panel.overlayDrawCount;
    for (let f = 1; f <= 72; f++) { panel.moveAxisDrag(at(PLOT.x + PLOT.w / 2 + f, 0)[0]); t += 14; panel.update(t); }
    expect(panel.overlayDrawCount - o0).toBeGreaterThanOrEqual(10); expect(panel.overlayDrawCount - o0).toBeLessThanOrEqual(Math.ceil(72 * 14 / DRAG_REDRAW_MS) + 1); expect(panel.drawCount).toBe(n0 + 1);
    panel.moveAxisDrag(at(0, 0)[0]); expect(panel.dragWindow).toEqual([-200, -150]); // min width 50
    expect(panel.endAxisDrag()).toEqual([-200, -150]); expect(panel.axisDragging).toBeNull(); expect(panel.endAxisDrag()).toBeNull();
    t += 14; panel.update(t); expect(panel.drawCount).toBe(n0 + 2); expect(panel.overlay.visible).toBe(false); // the release: the whole board once more
  });
  it('build 571: the drag redraw reuses its arrays (rebinned columns, the shown window)', () => {
    const { panel } = mk({ range: { mode: 'manual', lo: -200, hi: 400 } }); panel.setOpen(true); panel.update(1000);
    panel.startAxisDrag('hi', at(PLOT.x + PLOT.w, 0)[0]); panel.update(1014); const w0 = panel.window;
    panel.moveAxisDrag(at(PLOT.x + PLOT.w / 2, 0)[0]); panel.update(1014 + DRAG_REDRAW_MS); expect(panel.window).toBe(w0); expect(panel.window).toEqual([-200, 100]);
    panel.dispose();
  });
  it('build 570: the left end clamps at -1024; a drag that did not move commits nothing; close / cancel / dispose clear the drag', () => {
    const { panel } = mk({ range: { mode: 'manual', lo: -200, hi: 400 } }); panel.setOpen(true); panel.update(1000);
    const [x0] = at(PLOT.x, 0); panel.startAxisDrag('lo', x0); panel.moveAxisDrag(x0 - 10); expect(panel.dragWindow[0]).toBe(-1024);
    panel.cancelAxisDrag(); expect(panel.axisDragging).toBeNull();
    panel.startAxisDrag('lo', x0); expect(panel.endAxisDrag()).toBeNull();
    panel.startAxisDrag('lo', x0); panel.setOpen(false); expect(panel.axisDragging).toBeNull(); expect(panel.group.children.slice(2).some(q => q.visible)).toBe(false);
    panel.setOpen(true); panel.update(5000); panel.startAxisDrag('hi', x0); panel.dispose(); expect(panel.axisDragging).toBeNull();
  });
  it('dispose removes the board', () => {
    const { panel } = mk(); const parent = new THREE.Group(); parent.add(panel.group); panel.dispose(); expect(panel.group.parent).toBeNull();
  });
});
