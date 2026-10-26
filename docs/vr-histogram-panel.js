import { rebinHist, niceStep, huToX, windowFor, HIST_MIN, HIST_MAX } from './histogram.js?v=20261026-build670';
import { PLOT_OV, PLOT_OV_SCALE, AXIS_GRAB, AUTO_BTN, END_LABEL_Y, DRAG_REDRAW_MS, axisTarget, localToPxX, localToPxY, dragWindow, PANEL_W, PANEL_H, PLOT, LEGEND, STATUS_Y, TITLE_Y, X_TICK_Y, X_AXIS_Y, Y_AXIS_X, PROG_PX, PROG_W_M, boardHeightM, pxToLocalX, pxToLocalY, columnsFor, barFraction, countLabel, yTicks, STACK_ORDER, stackColumn, legendItems, legendLayout, titleText, yAxisText, progressText, shouldRedraw } from './vr-histogram-layout.js?v=20261026-build670';
import { registerVrSelfCheck } from './vr-self-check.js?v=20261026-build670';

// VR self-check scenario: the frame rate while the histogram pass runs. env.histogram (vr-view.js) =
// { isOpen(), open(), close(), forceCompute(), busy() }. The board is opened and the pass is started again each time it finishes, so it runs during
// the whole measurement; the note says how many passes finished and the longest one. Restored in finally (closed again when it was closed).
export const HISTOGRAM_SELF_CHECK = {
  id: 'histogram', label: 'ヒストグラム',
  async run(ctx) {
    const h = ctx.env.histogram; if (!h) return ctx.skip(ctx.ja ? 'パネルなし' : 'no panel');
    const was = h.isOpen(), clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let forcedAt = 0, passes = 0, longest = 0;
    const onFrame = () => { // no allocation: two calls and a few numbers per frame
      if (h.busy()) return;
      const now = clock();
      if (forcedAt) { passes++; if (now - forcedAt > longest) longest = now - forcedAt; }
      h.forceCompute(); forcedAt = now;
    };
    h.open();
    try {
      const s = await ctx.measure({ onFrame });
      const open = forcedAt ? clock() - forcedAt : 0, sec = ms => (ms / 1000).toFixed(1);
      ctx.note(passes ? (ctx.ja ? '集計 ' + passes + ' 回完了・最長 ' + sec(longest) + ' 秒' : passes + ' passes, longest ' + sec(longest) + ' s')
        : (ctx.ja ? '集計が測定中に終わらず（' + sec(open) + ' 秒以上）' : 'pass did not finish (over ' + sec(open) + ' s)'));
      return s;
    } finally { if (!was) h.close(); }
  },
};
registerVrSelfCheck(HISTOGRAM_SELF_CHECK);

// opts: getView() -> { ready, hists[LABELS] (per-label HU histograms, null = none), total, res (histogram.js windowFor input), range (自動 / 全体 / 手動),
//         approx (bool), dims, busy, message }, colorOf(label), nameOf(label), getProgress() -> {busy, frac} (the same object every call; optional),
//       log() -> bool, widthM, L { title, approx, busy, empty, xAxis, yAxis, yAxisLog, auto }
export function createVrHistogramPanel(THREE, opts) {
  const { getView, colorOf, nameOf, L, widthM } = opts;
  const getProgress = opts.getProgress || (() => null);
  const canvas = document.createElement('canvas'); canvas.width = PANEL_W; canvas.height = PANEL_H;
  const ctx = canvas.getContext('2d'), tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group(); group.visible = false;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(widthM, boardHeightM(widthM)), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  board.renderOrder = 1; group.add(board);
  // the progress quad (top right of the board): 「計算中 42%」, shown only while a pass runs
  const pc = document.createElement('canvas'); pc.width = PROG_PX.w; pc.height = PROG_PX.h;
  const pctx = pc.getContext('2d'), ptex = new THREE.CanvasTexture(pc); ptex.colorSpace = THREE.SRGBColorSpace;
  const progH = PROG_W_M * PROG_PX.h / PROG_PX.w, prog = new THREE.Mesh(new THREE.PlaneGeometry(PROG_W_M, progH), new THREE.MeshBasicMaterial({ map: ptex, transparent: true, toneMapped: false, depthWrite: false }));
  prog.position.set(pxToLocalX(PANEL_W - 20, widthM) - PROG_W_M / 2, pxToLocalY(TITLE_Y, widthM), 0.0012); prog.renderOrder = 3; prog.visible = false; group.add(prog);
  let progShown = -2;
  const drawProgress = (p, pct) => {
    progShown = pct;
    const c = pctx, w = PROG_PX.w, h = PROG_PX.h;
    c.clearRect(0, 0, w, h); c.fillStyle = 'rgba(60,44,10,.95)'; c.beginPath(); c.roundRect(1, 1, w - 2, h - 2, 12); c.fill();
    if (p.frac >= 0) { c.fillStyle = 'rgba(255,210,122,.35)'; c.beginPath(); c.roundRect(1, 1, Math.max(14, (w - 2) * p.frac), h - 2, 12); c.fill(); }
    c.fillStyle = '#ffd27a'; c.font = 'bold 26px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(progressText(L.busy, p), w / 2, h / 2 + 1, w - 20);
    ptex.needsUpdate = true;
  };
  const rd = { dirty: false, now: 0, lastDraw: 0 }; // the argument of shouldRedraw, reused every frame
  let open = false, dirty = false, lastDraw = -1e9, drawCount = 0, shownWin = null;
  // the highlight quads of the grab zones (x axis ends) and the 「自動」 button: opacity only, never a redraw
  const pxW = px => px / PANEL_W * widthM, pxH = py => py / PANEL_H * boardHeightM(widthM);
  const quad = (x0, y0, w0, h0) => { // clipped to the board, so the right end's zone (it reaches past PANEL_W) never hangs off the edge
    const x = Math.max(0, x0), y = Math.max(0, y0), w = Math.min(PANEL_W, x0 + w0) - x, h = Math.min(PANEL_H, y0 + h0) - y;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pxW(w), pxH(h)), new THREE.MeshBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    m.position.set(pxToLocalX(x + w / 2, widthM), pxToLocalY(y + h / 2, widthM), 0.001); m.renderOrder = 2; m.visible = false; group.add(m); return m;
  };
  const gh = AXIS_GRAB.bottom - AXIS_GRAB.top, gw = AXIS_GRAB.inner + AXIS_GRAB.outer;
  const lit = { lo: quad(PLOT.x - AXIS_GRAB.outer, AXIS_GRAB.top, gw, gh), hi: quad(PLOT.x + PLOT.w - AXIS_GRAB.inner, AXIS_GRAB.top, gw, gh), auto: quad(AUTO_BTN.x, AUTO_BTN.y, AUTO_BTN.w, AUTO_BTN.h) };
  let hoverT = null, drag = null, dragDirty = false; // drag: { end, lo, hi, px } at the grab
  const dragWin = [0, 0];
  const showLit = () => { for (const k in lit) { const a = drag ? (drag.end === k ? 0.3 : 0) : hoverT === k ? 0.16 : 0; lit[k].material.opacity = a; lit[k].visible = a > 0; } };

  // ---- the drag overlay (PLOT_OV, half resolution): only it follows a dragged end; the board under it is blank there while dragging ----
  const oc = document.createElement('canvas'); oc.width = Math.round(PLOT_OV.w * PLOT_OV_SCALE); oc.height = Math.round(PLOT_OV.h * PLOT_OV_SCALE);
  const octx = oc.getContext('2d'), otex = new THREE.CanvasTexture(oc); otex.colorSpace = THREE.SRGBColorSpace;
  const ov = new THREE.Mesh(new THREE.PlaneGeometry(pxW(PLOT_OV.w), pxH(PLOT_OV.h)), new THREE.MeshBasicMaterial({ map: otex, transparent: true, toneMapped: false, depthWrite: false }));
  ov.position.set(pxToLocalX(PLOT_OV.x + PLOT_OV.w / 2, widthM), pxToLocalY(PLOT_OV.y + PLOT_OV.h / 2, widthM), 0.0005); ov.renderOrder = 1.5; ov.visible = false; group.add(ov);
  let ovCount = 0, lastOv = -1e9, ovPending = false, blankPending = false;
  // reused by the plot drawing (no allocation per redraw apart from the tick / value strings): the rebinned columns per label, a column's parts,
  // the label colours, the count ticks and the shown window
  const binPool = [], bins = [], part = new Float64Array(STACK_ORDER.length), colors = new Array(STACK_ORDER.length), ticks = [], shownArr = [0, 0];
  const MAX_COLS = columnsFor(HIST_MIN, HIST_MAX);
  // the plot part (inside PLOT_OV) on context c in board px (the caller sets the transform): axes, HU ticks, count ticks, the x axis title, the
  // stacked bars and the end values. Returns nothing; reads view.hists.
  const drawPlot = (c, view, lo, hi) => {
    const cols = columnsFor(lo, hi), hs = view.hists;
    bins.length = hs.length;
    for (let l = 0; l < hs.length; l++) { if (!hs[l]) { bins[l] = null; continue; } if (!binPool[l]) binPool[l] = new Float64Array(MAX_COLS); bins[l] = rebinHist(hs[l], lo, hi, cols, binPool[l]); }
    let ymax = 1;
    for (let k = 0; k < cols; k++) { let t = 0; for (let l = 0; l < bins.length; l++) if (bins[l]) t += bins[l][k]; if (t > ymax) ymax = t; }
    const log = !!opts.log();
    // axes, HU ticks and a few count ticks
    c.strokeStyle = '#8aa0b0'; c.fillStyle = '#9fb3c3'; c.lineWidth = 2; c.globalAlpha = 0.5;
    c.beginPath(); c.moveTo(PLOT.x, PLOT.y); c.lineTo(PLOT.x, PLOT.y + PLOT.h); c.lineTo(PLOT.x + PLOT.w, PLOT.y + PLOT.h); c.stroke();
    c.globalAlpha = 1; c.font = '22px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const step = niceStep(hi - lo, 8);
    for (let hu = Math.ceil(lo / step) * step; hu <= hi; hu += step) {
      const x = PLOT.x + huToX(hu, lo, hi, PLOT.w);
      c.globalAlpha = 0.18; c.beginPath(); c.moveTo(x, PLOT.y); c.lineTo(x, PLOT.y + PLOT.h); c.stroke();
      c.globalAlpha = 0.95; c.fillText(String(hu), x, X_TICK_Y);
    }
    c.textAlign = 'right';
    yTicks(ymax, log, ticks);
    for (let i = 0; i < ticks.length; i++) {
      const v = ticks[i], y = PLOT.y + PLOT.h - barFraction(v, ymax, log) * PLOT.h;
      if (v) { c.globalAlpha = 0.18; c.beginPath(); c.moveTo(PLOT.x, y); c.lineTo(PLOT.x + PLOT.w, y); c.stroke(); }
      c.globalAlpha = 0.95; c.fillText(countLabel(v), PLOT.x - 8, y);
    }
    // the x axis title 「HU値」 under the ticks (the y one is outside PLOT_OV: drawn with the board)
    c.globalAlpha = 1; c.fillStyle = '#c9d6e0'; c.font = 'bold 24px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(L.xAxis, PLOT.x + PLOT.w / 2, X_AXIS_Y, PLOT.w);
    // stacked bars: each column split by label, bottom first (STACK_ORDER), gray (unlabeled) on top
    const bw = PLOT.w / cols;
    for (let i = 0; i < STACK_ORDER.length; i++) colors[i] = colorOf(STACK_ORDER[i]);
    for (let k = 0; k < cols; k++) {
      if (!stackColumn(bins, k, ymax, log, PLOT.h, part)) continue;
      let y = PLOT.y + PLOT.h;
      for (let i = 0; i < part.length; i++) { const h = part[i]; if (!h) continue; c.fillStyle = colors[i]; c.fillRect(PLOT.x + k * bw, y - h, Math.max(1.5, bw - 0.4), h); y -= h; }
    }
    // the window's ends under the axis ends (the grab targets)
    c.font = 'bold 22px system-ui,sans-serif'; c.fillStyle = '#ffd27a';
    c.textAlign = 'left'; c.fillText('◀ ' + lo, PLOT.x - 40, END_LABEL_Y); c.textAlign = 'right'; c.fillText(hi + ' ▶', PLOT.x + PLOT.w + 20, END_LABEL_Y);
    c.textAlign = 'left';
  };
  // the overlay while dragging: the drag window, ~DRAG_REDRAW_MS apart (update)
  const drawOverlay = now => {
    ovCount++; lastOv = now; ovPending = false;
    const view = getView(), s = PLOT_OV_SCALE;
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, oc.width, oc.height);
    if (view.ready) { octx.setTransform(s, 0, 0, s, -PLOT_OV.x * s, -PLOT_OV.y * s); drawPlot(octx, view, dragWin[0], dragWin[1]); shownArr[0] = dragWin[0]; shownArr[1] = dragWin[1]; shownWin = shownArr; }
    otex.needsUpdate = true; ov.visible = true;
  };

  // ---- the board texture ----
  const redraw = now => {
    drawCount++; lastDraw = now; dirty = false; blankPending = false;
    const W = PANEL_W, H = PANEL_H, view = getView();
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = 'rgba(14,20,27,.94)'; ctx.beginPath(); ctx.roundRect(0, 0, W, H, 30); ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 30px system-ui,sans-serif';
    ctx.fillText(titleText(L.title, view.ready && view.approx ? L.approx : '', view.dims), 24, TITLE_Y, 620);
    const status = view.message || (view.busy && !view.ready ? L.busy : '');
    if (!drag) ov.visible = false; else ovPending = true; // dragging: the plot part is the overlay's (drawn in the same update)
    if (!view.ready) { shownWin = null; ctx.font = '24px system-ui,sans-serif'; ctx.fillStyle = '#ffd27a'; ctx.fillText(status || L.empty, 24, PLOT.y + 40, W - 48); tex.needsUpdate = true; return; }
    if (drag) { shownArr[0] = dragWin[0]; shownArr[1] = dragWin[1]; shownWin = shownArr; } else { shownWin = windowFor(view.res, view.range); drawPlot(ctx, view, shownWin[0], shownWin[1]); }
    // the y axis title 「ボクセル数」 (「（対数）」 in log) turned up the left side (outside the overlay)
    ctx.globalAlpha = 1; ctx.fillStyle = '#c9d6e0'; ctx.font = 'bold 24px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(Y_AXIS_X, PLOT.y + PLOT.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yAxisText(L, !!opts.log()), 0, 0, PLOT.h + 40); ctx.restore();
    // legend: swatch + name of every label present
    ctx.font = 'bold 24px system-ui,sans-serif'; ctx.textAlign = 'left';
    for (const it of legendLayout(legendItems(view.hists, colorOf, nameOf), t => ctx.measureText(t).width || t.length * 13)) {
      ctx.fillStyle = it.color; ctx.fillRect(it.x, it.y - LEGEND.swatch / 2, LEGEND.swatch, LEGEND.swatch);
      ctx.fillStyle = '#fff'; ctx.fillText(it.name, it.x + LEGEND.swatch + 10, it.y + 1);
    }
    // the 「自動」 button
    const auto = !drag && view.range?.mode === 'auto';
    ctx.fillStyle = auto ? 'rgba(127,211,255,.85)' : 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect(AUTO_BTN.x, AUTO_BTN.y, AUTO_BTN.w, AUTO_BTN.h, 12); ctx.fill();
    ctx.fillStyle = auto ? '#0e141b' : '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 24px system-ui,sans-serif'; ctx.fillText(L.auto || '自動', AUTO_BTN.x + AUTO_BTN.w / 2, AUTO_BTN.y + AUTO_BTN.h / 2 + 1);
    ctx.textAlign = 'left';
    if (status) { ctx.font = '22px system-ui,sans-serif'; ctx.fillStyle = '#ffd27a'; ctx.fillText(status, 24, STATUS_Y, AUTO_BTN.x - 40); }
    tex.needsUpdate = true;
  };

  return {
    group, board, canvas,
    get drawCount() { return drawCount; }, // whole-board redraws (1024 x 640)
    get overlayDrawCount() { return ovCount; }, // drag overlay redraws (PLOT_OV at half resolution)
    overlay: ov, overlayCanvas: oc,
    get isOpen() { return open; },
    get window() { return shownWin; }, // the HU window [lo, hi] last drawn (null before data)
    setOpen(on) {
      open = !!on; group.visible = open;
      if (!open) { drag = null; hoverT = null; showLit(); }
      if (open) { dirty = true; lastDraw = -1e9; progShown = -2; } // first look: redraw at once
    },
    // new data / display range / scale / language: the next update() redraws (at most one per MIN_GAP_MS)
    invalidate() { dirty = true; },
    // the laser on the board (board-local metres): 'lo' / 'hi' (an end of the x axis), 'auto' or null; only once data is shown
    axisTargetAt(x, y) { return open && shownWin ? axisTarget(localToPxX(x, widthM), localToPxY(y, widthM)) : null; },
    setAxisHover(t) { if (t !== hoverT) { hoverT = t; showLit(); } },
    // grab an end at board x (metres); false when nothing is shown
    startAxisDrag(end, x) {
      if (!shownWin || (end !== 'lo' && end !== 'hi')) return false;
      drag = { end, lo: shownWin[0], hi: shownWin[1], px: localToPxX(x, widthM) }; dragWin[0] = drag.lo; dragWin[1] = drag.hi; dragDirty = false; blankPending = true; showLit(); return true;
    },
    // the laser's board x while the trigger is held (it may leave the board: the caller intersects the board plane); no allocation
    moveAxisDrag(x) {
      if (!drag) return; const a = dragWin[0], b = dragWin[1]; dragWindow(drag.end, drag, localToPxX(x, widthM), dragWin);
      if (a !== dragWin[0] || b !== dragWin[1]) dragDirty = true;
    },
    // release: the window to commit ([lo, hi], a new array) or null; the board shows the committed range on the next change
    endAxisDrag() { if (!drag) return null; const w = [dragWin[0], dragWin[1]], moved = w[0] !== drag.lo || w[1] !== drag.hi; drag = null; dirty = true; showLit(); return moved ? w : null; },
    cancelAxisDrag() { if (!drag) return; drag = null; dirty = true; showLit(); },
    get axisDragging() { return drag ? drag.end : null; },
    get dragWindow() { return drag ? dragWin : null; },
    // once per frame while the board is shown. No allocation.
    update(now) {
      if (!open) return;
      rd.dirty = dirty; rd.now = now; rd.lastDraw = lastDraw;
      if (blankPending || shouldRedraw(rd)) redraw(now); // the grab: once at once (the plot part blank, the overlay takes it)
      if (drag && (ovPending || (dragDirty && now - lastOv >= DRAG_REDRAW_MS))) { dragDirty = false; drawOverlay(now); }
      const p = getProgress(), pct = p && p.busy ? (p.frac >= 0 ? Math.round(100 * p.frac) : -1) : -2;
      if (pct !== progShown) { if (pct === -2) { progShown = -2; prog.visible = false; } else { drawProgress(p, pct); prog.visible = true; } }
    },
    dispose() {
      tex.dispose(); board.geometry.dispose(); board.material.dispose(); ptex.dispose(); prog.geometry.dispose(); prog.material.dispose();
      otex.dispose(); ov.geometry.dispose(); ov.material.dispose();
      drag = null; for (const k in lit) { lit[k].geometry.dispose(); lit[k].material.dispose(); }
      group.removeFromParent();
    },
  };
}
