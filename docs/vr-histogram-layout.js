import { HIST_MIN, HIST_MAX, MIN_WINDOW } from './histogram.js?v=20261028-build687';
import { LABELS, SLOTS, UNLABELED } from './vr-label-histogram.js?v=20261028-build687';

// canvas size and the plot rectangle inside it (px)
export const PANEL_W = 1024, PANEL_H = 640;
export const TITLE_Y = 40;
export const PLOT = { x: 120, y: 96, w: 876, h: 320 };
export const X_TICK_Y = PLOT.y + PLOT.h + 22, X_AXIS_Y = PLOT.y + PLOT.h + 56, Y_AXIS_X = 30;
export const LEGEND = { x: 24, y: 530, rowH: 40, maxX: PANEL_W - 24, swatch: 22, gap: 30 };
export const STATUS_Y = 612;
// the progress quad of a running pass (top right, over the end of the title row): canvas px and width in metres
export const PROG_PX = { w: 360, h: 52 }, PROG_W_M = 0.15;
// the shortest gap between two redraws
export const MIN_GAP_MS = 100;

export const boardHeightM = widthM => widthM * PANEL_H / PANEL_W;
// canvas px -> metres from the board centre (x right, y up)
export const pxToLocalX = (px, widthM) => (px / PANEL_W - 0.5) * widthM;
export const pxToLocalY = (py, widthM) => (0.5 - py / PANEL_H) * boardHeightM(widthM);

// the number of bar columns for the window [lo, hi]: one per HU when there is room, else at most one per 2 px
export const columnsFor = (lo, hi) => Math.max(1, Math.min(Math.round(hi - lo + 1), Math.floor(PLOT.w / 2)));
// 0..1 bar height for a count
export const barFraction = (count, ymax, log) => (ymax > 0 && count > 0 ? (log ? Math.log10(1 + count) / Math.log10(1 + ymax) : count / ymax) : 0);
export const countLabel = n => (n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? +(n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n)));
// the y ticks (counts) for a plot of height ymax: linear = 0 and a few round steps; log = 0 and powers of ten (at most 5)
export function yTicks(ymax, log, out = []) { // out: a reused array, emptied first
  out.length = 0; out.push(0);
  if (!(ymax > 0)) return out;
  if (log) {
    const top = Math.floor(Math.log10(ymax)), every = Math.max(1, Math.ceil(top / 4));
    for (let k = top; k >= 0; k -= every) out.splice(1, 0, 10 ** k);
    return out;
  }
  const step = countStep(ymax, 5);
  for (let v = step; v <= ymax + 1e-9; v += step) out.push(v);
  return out;
}
// a round count step (1 / 2 / 5 x 10^k, at least 1) giving at most maxTicks steps up to ymax (histogram.js niceStep is for HU: capped at 2000)
export function countStep(ymax, maxTicks) {
  for (let p = 1; ; p *= 10) for (const m of [1, 2, 5]) if (ymax / (m * p) <= maxTicks) return m * p;
}
// the stacking order of the labels in a bar (bottom first): the segments in the shader's slot order, then the analysis colours, unlabeled on top
export const STACK_ORDER = (() => { const o = []; for (let L = 1; L < LABELS; L++) o.push(L); o.push(UNLABELED); return o; })();
// one bar column: the heights (px) of its parts, bottom first, in STACK_ORDER; out[i] for label STACK_ORDER[i]. cols = the per-label rebinned
// counts (null for a label without data), c = the column. Returns the column total. The whole bar is as tall as its total (barFraction, linear or
// log); its parts split that height in proportion to their counts. (writes into `out`: no allocation per column)
export function stackColumn(cols, c, ymax, log, plotH, out) {
  let total = 0;
  for (let i = 0; i < STACK_ORDER.length; i++) { const b = cols[STACK_ORDER[i]]; const n = b ? b[c] : 0; out[i] = n; total += n; }
  if (!total) { out.fill(0); return 0; }
  const h = Math.max(1.5, barFraction(total, ymax, log) * plotH);
  for (let i = 0; i < out.length; i++) out[i] = out[i] ? (out[i] / total) * h : 0;
  return total;
}
// the res object of histogram.js windowFor (the display range: 自動 / 全体 / 手動, as on PC): one entry per shown segment (its voxels = its slot's
// label plus its analysis colours), and the whole volume. slotKeys: the GPU slot order; shownSlots: bit s = slot s shown; regionSegs: slot bits per colour
export function rangeRes(hists, total, slotKeys, shownSlots, segs, regionSegs) {
  const list = [];
  for (let s = 0; s < SLOTS; s++) {
    const key = slotKeys[s]; if (!((shownSlots >> s) & 1) || !segs[key]) continue;
    let hist = null;
    const add = h => { if (!h) return; if (!hist) hist = Uint32Array.from(h); else for (let i = 0; i < h.length; i++) hist[i] += h[i]; };
    add(hists[1 + s]);
    (regionSegs || []).forEach((bits, k) => { if ((bits >> s) & 1) add(hists[1 + SLOTS + k]); });
    list.push({ key, seg: segs[key], hist });
  }
  return { list, total: total ? { hist: total } : null };
}
// the legend: the labels that have voxels in the whole volume, in STACK_ORDER, as {label, color, name}
export function legendItems(hists, colorOf, nameOf) {
  const out = [];
  for (const L of STACK_ORDER) if (hists[L]) { let n = 0; const h = hists[L]; for (let i = 0; i < h.length; i++) n += h[i]; if (n > 0) out.push({ label: L, color: colorOf(L), name: nameOf(L) }); }
  return out;
}
// legend positions (px): left to right, wrapping; width(text) measures a name. Items past the last row are dropped.
export function legendLayout(items, width, rows = 2) {
  const out = []; let x = LEGEND.x, row = 0;
  for (const it of items) {
    const w = LEGEND.swatch + 10 + width(it.name);
    if (x > LEGEND.x && x + w > LEGEND.maxX) { row++; x = LEGEND.x; }
    if (row >= rows) break;
    out.push({ ...it, x, y: LEGEND.y + row * LEGEND.rowH });
    x += w + LEGEND.gap;
  }
  return out;
}
// the title: 「HU分布」 plus 「（概算 256×256×128）」 when the counts come from a reduced grid
export const titleText = (title, approx, dims) => title + (approx && dims ? '（' + approx + ' ' + dims.join('×') + '）' : '');
// the y axis title: 「ボクセル数」 or 「ボクセル数（対数）」
export const yAxisText = (L, log) => (log ? L.yAxisLog : L.yAxis);
// the progress text of a running pass: 「計算中 42%」; '' when idle
export function progressText(busyLabel, prog) {
  if (!prog || !prog.busy) return '';
  return busyLabel + (prog.frac >= 0 ? ' ' + Math.round(100 * prog.frac) + '%' : '');
}
// the bar texture is redrawn when something it shows changed (dirty), never more often than every MIN_GAP_MS
export const shouldRedraw = ({ dirty, now, lastDraw }) => !!dirty && now - lastDraw >= MIN_GAP_MS;

// ---- the display range from VR (display only, never data): the laser grabs the LEFT or RIGHT end of the x axis and drags it ----
// the grab zones (canvas px): around each end of the plot, from the top of the plot down to the end labels under the axis
export const AXIS_GRAB = { inner: 70, outer: 70, top: PLOT.y, bottom: X_AXIS_Y + 24 };
// the end labels (the window's lo / hi, under the axis ends) and the 「自動」 button (bottom right, in the status row)
export const END_LABEL_Y = X_AXIS_Y;
export const AUTO_BTN = { x: PANEL_W - 24 - 128, y: STATUS_Y - 26, w: 128, h: 48 };
// the redraw interval while an end is dragged (the bars follow at ~12 Hz; the drag itself costs nothing per frame)
export const DRAG_REDRAW_MS = 80;
// while an end is dragged only this part of the board follows, on its own small texture (half resolution: 488 x 206, ~0.4 MB per upload
// instead of 2.6 MB for the whole board): the plot, the count ticks on its left, the HU ticks, the x axis title and the end values under it.
// The board under it is drawn once at the grab with this part blank, and once more after the release.
export const PLOT_OV = { x: 48, y: PLOT.y - 16, w: PANEL_W - 48, h: X_AXIS_Y + 20 - (PLOT.y - 16) }, PLOT_OV_SCALE = 0.5;
// what is under the canvas point (px, py): 'lo' / 'hi' (an end of the x axis), 'auto' (the button) or null
export function axisTarget(px, py) {
  if (px >= AUTO_BTN.x && px <= AUTO_BTN.x + AUTO_BTN.w && py >= AUTO_BTN.y && py <= AUTO_BTN.y + AUTO_BTN.h) return 'auto';
  if (py < AXIS_GRAB.top || py > AXIS_GRAB.bottom) return null;
  const dl = px - PLOT.x, dr = px - (PLOT.x + PLOT.w);
  if (dl >= -AXIS_GRAB.outer && dl <= AXIS_GRAB.inner) return 'lo';
  if (dr >= -AXIS_GRAB.inner && dr <= AXIS_GRAB.outer) return 'hi';
  return null;
}
// board metres (x right, y up, from the centre) -> canvas px
export const localToPxX = (x, widthM) => (x / widthM + 0.5) * PANEL_W;
export const localToPxY = (y, widthM) => (0.5 - y / boardHeightM(widthM)) * PANEL_H;
// the window while an end is dragged: that end moves by the laser's x travel since the grab, at the scale of the window at the grab (so the bars
// under the laser do not run away while the scale changes); whole HU, at least MIN_WINDOW wide, inside HIST_MIN..HIST_MAX; the other end stays
export function dragWindow(end, start, px, out = [0, 0]) {
  const d = (px - start.px) * (start.hi - start.lo) / PLOT.w;
  if (end === 'lo') { out[0] = Math.max(HIST_MIN, Math.min(start.hi - MIN_WINDOW, Math.round(start.lo + d))); out[1] = start.hi; }
  else { out[0] = start.lo; out[1] = Math.min(HIST_MAX, Math.max(start.lo + MIN_WINDOW, Math.round(start.hi + d))); }
  return out;
}
