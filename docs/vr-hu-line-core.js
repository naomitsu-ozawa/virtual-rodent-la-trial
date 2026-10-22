// HU line in VR, pure part: no DOM, no three.js, no app state (unit-tested in tests/unit/vr-hu-line-core.test.js).
// The controller ray hit -> a voxel position of the shared model (hu-line-model.js), the update rate of the live panel, the panel's layout,
// the plot geometry and the texts. The stateful part (three.js objects, the gesture, the sampling calls) is vr-hu-line.js.
// also the VR self-check's HU線 scenario (below; the self-check runner has no DOM and no three.js either).
import { registerVrSelfCheck } from './vr-self-check.js?v=20261022-build646';

// VR self-check scenario: the frame rate while a line is stretched, then the time of the full read after the release.
// env.huLine (vr-view.js) = { beginDrag() -> '' | reason, moveTo(u), release(), reading(), cancel() }: a synthetic laser (no controller) drags a line
// across the middle of the data for HU_LINE_DRAG_SECONDS (the live preview runs as in a real drag), releases it, and the full read is timed
// (polled every 50 ms, at most HU_LINE_READ_TIMEOUT_MS). cancel() in finally puts back the line, the panel and the armed state as they were.
export const HU_LINE_DRAG_SECONDS = 3, HU_LINE_READ_TIMEOUT_MS = 20000;
export const HU_LINE_SELF_CHECK = {
  id: 'huLine', label: 'HU線',
  async run(ctx) {
    const h = ctx.env.huLine, ja = ctx.ja; if (!h) return ctx.skip(ja ? 'HU線なし' : 'no HU line');
    const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), sec = ms => (ms / 1000).toFixed(1);
    try {
      const why = h.beginDrag(); if (why) return ctx.skip(why);
      const s = await ctx.measure({ seconds: HU_LINE_DRAG_SECONDS, onFrame: (tSec, frac) => h.moveTo(frac) });
      const t0 = clock(); h.release();
      while (h.reading() && !ctx.cancelled() && clock() - t0 < HU_LINE_READ_TIMEOUT_MS) await new Promise(r => setTimeout(r, 50));
      if (ctx.cancelled()) return s;
      const ms = clock() - t0;
      ctx.note(h.reading() ? (ja ? '確定読み取りが ' + sec(ms) + ' 秒で終わらず' : 'full read not done in ' + sec(ms) + ' s')
        : (ja ? '確定読み取り ' + sec(ms) + ' 秒' : 'full read ' + sec(ms) + ' s'));
      return s;
    } finally { h.cancel(); }
  },
};
registerVrSelfCheck(HU_LINE_SELF_CHECK);

export const HU_PANEL_INTERVAL_MS = 80; // the live panel's sampling + redraw rate while dragging: 12.5 Hz (the spec: 10-15 Hz)
export const HU_MIN_LENGTH_VOXELS = 1;  // a release closer to the start than this is a mis-click: the previous line is kept
// ready(now, dirty) -> true at most once per interval while dirty; reset() makes the next call ready. Allocation-free (createLiveGate's step() returns an object).
export function createHuPanelGate(intervalMs = HU_PANEL_INTERVAL_MS) {
  let last = -Infinity;
  return {
    ready(now, dirty) { if (!dirty || now - last < intervalMs) return false; last = now; return true; },
    reset() { last = -Infinity; }
  };
}

// the local point (volume object space, as vr-point.js voxelToLocal) -> voxel {i,j,k} written into `out` (float: a ray rarely lands on a centre)
// null when the point is outside the volume box (a half voxel of margin, as the PC model's voxelInside)
export function localToVoxelInto(p, halfExt, dims, out) {
  if (!p || !halfExt || !dims || !out) return null;
  const i = (p.x / (2 * halfExt[0]) + 0.5) * dims.columns - 0.5, j = (0.5 - p.y / (2 * halfExt[1])) * dims.rows - 0.5, k = (p.z / (2 * halfExt[2]) + 0.5) * dims.slices - 0.5; // = analysis-label.js voxelFromLocalVr, without its allocation
  if (!Number.isFinite(i) || !Number.isFinite(j) || !Number.isFinite(k)) return null;
  const m = 0.5; // a half voxel of margin, as the PC model's voxelInside
  if (i < -m || j < -m || k < -m || i > dims.columns - 1 + m || j > dims.rows - 1 + m || k > dims.slices - 1 + m) return null;
  out.i = i; out.j = j; out.k = k;
  return out;
}
// the inverse: voxel {i,j,k} -> the local point written into `out` {x,y,z} (a THREE.Vector3 works too)
export function voxelToLocalInto(v, halfExt, dims, out) {
  out.x = ((v.i + 0.5) / dims.columns - 0.5) * 2 * halfExt[0];
  out.y = (0.5 - (v.j + 0.5) / dims.rows) * 2 * halfExt[1];
  out.z = ((v.k + 0.5) / dims.slices - 0.5) * 2 * halfExt[2];
  return out;
}
// What the laser points at, like PC (hu-line-3d.js pickHuLinePoint): the first visible tissue surface (vh.local: the march of vr-view.js
// volumeHitRay, which already skips what a clipping section cuts away); when the ray meets no tissue, the selected section plane
// (sh.point, inside the box). Both are local points. Writes the voxel into `out` and returns where it came from ('volume' | 'section'), or null (nothing is allocated).
export function voxelFromHits(vh, sh, halfExt, dims, out) {
  if (vh?.local && localToVoxelInto(vh.local, halfExt, dims, out)) return 'volume';
  if (sh?.point && localToVoxelInto(sh.point, halfExt, dims, out)) return 'section';
  return null;
}
// distance a -> b in mm (spacing [sx, sy, sz])
export const voxelDistanceMm = (a, b, spacing) => Math.hypot((b.i - a.i) * (spacing?.[0] || 1), (b.j - a.j) * (spacing?.[1] || 1), (b.k - a.k) * (spacing?.[2] || 1));
// is the VR grid the grid the HU values are read from (the line is stored in voxel coordinates of ONE grid)
export const sameGrid = (a, b) => !!a && !!b && a.columns === b.columns && a.rows === b.rows && a.slices === b.slices;

// ---- the live values: the VR volume texture's CPU copy ----
// vr-view.js keeps the data the VR texture is built from (prepared.vd: rg8-packed u16, grid dims [tw,th,td], calibration [slope, intercept, bias]).
// It is built from the FILTERED slices when image filters are on (else the raw DICOM), so it is a real, always-resident source for the coarse
// live preview: nothing is decoded, filtered or waited for. HU = (u16 - bias) * slope + intercept. The grid may be reduced against the volume
// (VR texture <= 512 per side): then a sample is a trilinear read of the reduced grid = APPROXIMATE (shown as such); same grid: exact up to the
// packing's rounding to one raw unit. The release always does the exact full read (effective-hu), so the final values equal the PC's.
// the line is a straight line through the volume in 3D, not tied to any slice; an oblique line crosses many axial slices, and the 2D
// caches (hu-line-live.js) hold only a few of them (NaN = a gap in the graph for every slice not cached). So the live values ALWAYS come from this
// copy when it exists, also when its kind (filtered / raw) is not the one the mode asks for: then they are approximate (labelled 「VR表示データから
// 概算」) and, when the filters are on but not applied to the 3D view, the panel says they are the unfiltered values.
export const textureIsReduced = (tex, src) => !!tex && !!src && (tex.dims[0] !== src.columns || tex.dims[1] !== src.rows || tex.dims[2] !== src.slices);
// does the texture hold what the effective mode asks for? (filtered mode with filters on needs a filtered texture; raw / no filters needs a raw one)
export const textureMatchesMode = (tex, modeKey) => !!tex && !!tex.data && (modeKey === 'filtered') === !!tex.filtered;
// the live values of samples (lineSamples() result) from the texture copy, whatever its kind: { values, approx, unfiltered } | null (no copy).
// approx: a reduced grid or a kind other than the mode's; unfiltered: the mode asks for filtered values but the copy is the raw data.
export function liveFromTexture(samples, tex, src, modeKey) {
  if (!tex || !tex.data || !src) return null;
  const match = textureMatchesMode(tex, modeKey);
  return { values: sampleTexture(samples, tex, src, new Float64Array(samples.n)), approx: !match || textureIsReduced(tex, src), unfiltered: modeKey === 'filtered' && !tex.filtered };
}
// samples = lineSamples() result in the volume's voxel coordinates (x, y, z); out: Float64Array(samples.n). Trilinear over the texture grid.
export function sampleTexture(samples, tex, src, out) {
  const [tw, th, td] = tex.dims, d = tex.data, [slope, intercept, bias] = tex.calibration, sx = tw / src.columns, sy = th / src.rows, sz = td / src.slices, plane = tw * th;
  const at = (x, y, z) => { const o = (z * plane + y * tw + x) * 2; return d[o] | (d[o + 1] << 8); };
  for (let q = 0; q < samples.n; q++) {
    let u = (samples.x[q] + 0.5) * sx - 0.5, v = (samples.y[q] + 0.5) * sy - 0.5, w = (samples.z[q] + 0.5) * sz - 0.5;
    u = u < 0 ? 0 : u > tw - 1 ? tw - 1 : u; v = v < 0 ? 0 : v > th - 1 ? th - 1 : v; w = w < 0 ? 0 : w > td - 1 ? td - 1 : w;
    const x0 = Math.floor(u), y0 = Math.floor(v), z0 = Math.floor(w), x1 = Math.min(tw - 1, x0 + 1), y1 = Math.min(th - 1, y0 + 1), z1 = Math.min(td - 1, z0 + 1), fx = u - x0, fy = v - y0, fz = w - z0;
    const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx, c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
    const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx, c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
    const lo = c00 * (1 - fy) + c10 * fy, hi = c01 * (1 - fy) + c11 * fy;
    out[q] = (lo * (1 - fz) + hi * fz - bias) * slope + intercept;
  }
  return out;
}
// a read error as a clear message (never a bare internal code). '__SUPERSEDED__' = the filters changed meanwhile: not an error to show.
export function readErrorText(lang, e) {
  const m = String(e?.message || e || ''), ja = lang !== 'en';
  if (m.includes('__SUPERSEDED__')) return '';
  if (m.includes('__GPU_UNAVAILABLE__')) return ja ? 'フィルター後の値の計算に WebGPU が必要ですが使えません。HU線タブで「元の値」に切り替えてください' : 'Filtered values need WebGPU, which is not available. Switch to Raw in the HU line tab';
  return (ja ? 'HU線の読み取りに失敗: ' : 'HU line read failed: ') + m.slice(0, 60);
}

export const PANEL_W = 512, PANEL_H = 300, PANEL_WORLD_W = 0.30;
export function panelLayout(w = PANEL_W, h = PANEL_H) {
  const pad = 14, head = 44, statH = 84, gap = 8, axisL = 58, axisB = 22;
  const py = head + gap + 6, plot = { x: pad + axisL, y: py, w: w - 2 * pad - axisL, h: h - pad - statH - gap - (axisB + 4) - py };
  const sw = (w - 2 * pad - 2 * gap) / 3, sy = h - pad - statH;
  return {
    // two lines in the head: t1 = the title (HU線 · mode) and the length, t2 = the state (ライブ… / 計算中… / 読み取り失敗…), 20 px, above the plot
    pad, head: { x: pad, y: 0, w: w - 2 * pad, h: head, t1: 20, t2: 45 }, plot,
    axisX: { x: plot.x, y: plot.y + plot.h + 4, w: plot.w, h: axisB },
    stats: [0, 1, 2].map(i => ({ x: pad + i * (sw + gap), y: sy, w: sw, h: statH }))
  };
}
// the HU range of the plot: min..max of the stats with a margin (a flat line still gets a visible span); [lo, hi]
export function huRange(stats) {
  if (!stats || stats.min == null || stats.max == null) return [-100, 100];
  let lo = stats.min, hi = stats.max;
  const span = Math.max(hi - lo, 20), m = span * 0.08;
  if (hi - lo < 20) { const c = (hi + lo) / 2; lo = c - 10; hi = c + 10; }
  return [lo - m, hi + m];
}
// plot points: x from dist (mm) over [0, maxMm], y from value over [lo, hi]; written into `out` (Float32Array, x, y pairs), NaN values give a NaN y
// (a gap). Returns the number of points. No allocation.
export function plotPoints(dist, values, n, rect, lo, hi, maxMm, out) {
  const cnt = Math.min(n, (out.length / 2) | 0), sx = maxMm > 0 ? rect.w / maxMm : 0, sy = hi > lo ? rect.h / (hi - lo) : 0;
  for (let q = 0; q < cnt; q++) {
    const v = values[q];
    out[2 * q] = rect.x + (maxMm > 0 ? dist[q] * sx : rect.w / 2);
    out[2 * q + 1] = v === v ? rect.y + rect.h - (Math.min(hi, Math.max(lo, v)) - lo) * sy : NaN;
  }
  return cnt;
}
export const PX_TO_M = PANEL_WORLD_W / PANEL_W, PANEL_WORLD_H = PANEL_WORLD_W * PANEL_H / PANEL_W;
export const pxX = x => x * PX_TO_M - PANEL_WORLD_W / 2, pxY = y => PANEL_WORLD_H / 2 - y * PX_TO_M;
export const GRAPH_MAX_POINTS = 4096; // the full read's sample cap (line-profile.js); plotPoints writes at most this many
export const GLYPHS = '0123456789.-—m '; // what the numbers of the panel use (— = no value)
// the state the background canvas shows: redrawn only when this string changes (never for new samples)
export const backgroundKey = (tx, live, hasPlot) => tx.title + '|' + (live ? 1 : 0) + '|' + tx.empty + '|' + (hasPlot ? 1 : 0) + '|' + tx.stats[0][0] + tx.stats[1][0] + tx.stats[2][0];
// the polyline pts (x, y pairs in px, NaN y = gap) -> one quad per drawn segment (4 vertices x xyz into out), halfW px either side; a gap
// leaves its two segments out (no bridge). Returns the number of quads. No allocation.
export function ribbonInto(pts, n, halfW, out, zOff = 0) {
  let q = 0; const cap = (out.length / 12) | 0;
  for (let i = 0; i + 1 < n && q < cap; i++) {
    const x0 = pts[2 * i], y0 = pts[2 * i + 1], x1 = pts[2 * i + 2], y1 = pts[2 * i + 3];
    if (y0 !== y0 || y1 !== y1) continue;
    let dx = x1 - x0, dy = y1 - y0; const len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    const nx = -dy * halfW, ny = dx * halfW, ex = dx * halfW * 0.5, ey = dy * halfW * 0.5, o = 12 * q; // ends pushed out by halfW / 2: the joints overlap, no cracks
    out[o] = pxX(x0 - ex + nx); out[o + 1] = pxY(y0 - ey + ny); out[o + 2] = zOff;
    out[o + 3] = pxX(x0 - ex - nx); out[o + 4] = pxY(y0 - ey - ny); out[o + 5] = zOff;
    out[o + 6] = pxX(x1 + ex + nx); out[o + 7] = pxY(y1 + ey + ny); out[o + 8] = zOff;
    out[o + 9] = pxX(x1 + ex - nx); out[o + 10] = pxY(y1 + ey - ny); out[o + 11] = zOff;
    q++;
  }
  return q;
}
// quad indices for `quads` quads of 4 vertices (0 1 2, 2 1 3)
export function quadIndex(quads) {
  const ix = new Uint16Array(6 * quads);
  for (let q = 0; q < quads; q++) { const v = 4 * q, o = 6 * q; ix[o] = v; ix[o + 1] = v + 1; ix[o + 2] = v + 2; ix[o + 3] = v + 2; ix[o + 4] = v + 1; ix[o + 5] = v + 3; }
  return ix;
}
// the digit atlas layout: glyph cells side by side in one row; widths = the measured advance of each glyph at fontPx (measure(ch) -> px),
// cellH = the row height. { w, h, fontPx, cells: { ch: { x, w } } }
export function atlasLayout(measure, fontPx = 48, pad = 4) {
  const cells = {}; let x = 0;
  for (const ch of GLYPHS) { const w = Math.ceil(measure(ch) || fontPx * 0.6) + 2 * pad; cells[ch] = { x, w, pad }; x += w; }
  return { w: x, h: Math.ceil(fontPx * 1.3), fontPx, cells };
}
// one string as glyph quads: centred vertically on yPx, aligned 'left' | 'center' | 'right' at xPx, text height sizePx (the canvas font size it
// replaces). Writes 4 vertices (xyz into pos, uv into uv) per glyph from quad index `at`; returns the next free index. Unknown characters are
// skipped (a space advances). No allocation.
export function glyphsInto(str, xPx, yPx, sizePx, align, atlas, pos, uv, at, zOff = 0) {
  const k = sizePx / atlas.fontPx, cap = (pos.length / 12) | 0;
  let w = 0;
  for (let i = 0; i < str.length; i++) { const c = atlas.cells[str[i]]; if (c) w += (c.w - 2 * c.pad) * k; }
  let x = align === 'right' ? xPx - w : align === 'center' ? xPx - w / 2 : xPx;
  const h = atlas.h * k, top = yPx - h / 2;
  for (let i = 0; i < str.length && at < cap; i++) {
    const ch = str[i], c = atlas.cells[ch]; if (!c) continue;
    const adv = (c.w - 2 * c.pad) * k;
    if (ch !== ' ') {
      const x0 = x - c.pad * k, x1 = x + adv + c.pad * k, o = 12 * at, t = 8 * at;
      const u0 = c.x / atlas.w, u1 = (c.x + c.w) / atlas.w; // the canvas texture is flipped (flipY): v = 1 at the canvas top
      pos[o] = pxX(x0); pos[o + 1] = pxY(top); pos[o + 2] = zOff; uv[t] = u0; uv[t + 1] = 1;
      pos[o + 3] = pxX(x0); pos[o + 4] = pxY(top + h); pos[o + 5] = zOff; uv[t + 2] = u0; uv[t + 3] = 0;
      pos[o + 6] = pxX(x1); pos[o + 7] = pxY(top); pos[o + 8] = zOff; uv[t + 4] = u1; uv[t + 5] = 1;
      pos[o + 9] = pxX(x1); pos[o + 10] = pxY(top + h); pos[o + 11] = zOff; uv[t + 6] = u1; uv[t + 7] = 0;
      at++;
    }
    x += adv;
  }
  return at;
}
// Texts (ja / en). modeKey: 'filtered' | 'raw' (the mode really read). busy: the full read is running (a live preview is shown meanwhile).
// head = 「HU線 · mode」 (first line), status = the state (second line); title = both (the background key and the tests). A failed full
// read wins over the live state (the live values stay plotted, the title says the read failed). unfiltered: the live values are the raw data
// although the mode asks for filtered ones (filters on but not applied to the 3D view).
export function panelTexts(lang, { stats, lengthMm, modeKey, live, approx, busy, empty, failed, unfiltered }) {
  const ja = lang !== 'en', f = (x, d) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
  const head = (ja ? 'HU線' : 'HU line') + ' · ' + (modeKey === 'raw' ? (ja ? '元の値' : 'Raw') : (ja ? 'フィルター後' : 'Filtered'));
  const status = failed ? (live ? (ja ? '読み取り失敗（ライブ値を表示中）' : 'read failed (showing live values)') : (ja ? '読み取り失敗' : 'read failed'))
    : live ? (approx ? (ja ? 'ライブ（VR表示データから概算）' : 'live (approx. from VR data)') : (ja ? 'ライブ' : 'live')) + (unfiltered ? (ja ? ' · フィルター前の値' : ' · unfiltered values') : '')
    : busy ? (ja ? '計算中…' : 'reading…') : '';
  return {
    title: head + (status ? ' · ' + status : ''), head, status, statusKind: failed ? 'failed' : live ? 'live' : busy ? 'busy' : '',
    length: lengthMm > 0 ? f(lengthMm, 1) + ' mm' : '',
    empty: empty ? (ja ? 'ライブ値なし（離すと計算します）' : 'No live values (computed on release)') : '',
    stats: [[ja ? '平均' : 'Mean', f(stats?.mean, 1)], [ja ? '最小' : 'Min', f(stats?.min, 0)], [ja ? '最大' : 'Max', f(stats?.max, 0)]]
  };
}
// the menu tab's texts
export function huMenuTexts(lang) {
  return lang === 'en'
    ? { tab: 'HU line', title: 'HU line (line profile)', arm: 'HU line tool', on: 'ON', off: 'OFF', clear: 'Clear the line', mode: 'Values', filtered: 'Filtered', raw: 'Raw', modeNote: 'Same setting as the 2D/3D screens',
        help: ['ON: pull the trigger on the volume = START, keep it held and move = the line stretches, release = END', 'The line is a straight line through the volume in 3D, not tied to a slice. The panel in the air shows its graph, mean, min and max (while moving: approx. from the VR display data, about 12 times a second; exact after the release). Grip it to move it; Bring to front puts it back',
          'No tissue under the laser: the selected section plane is used. With a section cut, only the visible surface counts', 'The line is shared with the 2D / 3D screens (both ways). OFF returns the trigger to its normal actions'],
        armedFlash: 'HU line ON: trigger = start, hold, release = end', disarmFlash: 'HU line OFF', clearedFlash: 'HU line cleared', gridFlash: 'HU line is not available for this data', hasLine: 'Line: ', none: 'No line' }
    : { tab: 'HU線', title: 'HU線（ラインプロファイル）', arm: 'HU線ツール', on: 'ON', off: 'OFF', clear: '線を消す', mode: '値', filtered: 'フィルター後', raw: '元の値', modeNote: '2D/3D画面と同じ設定です',
        help: ['ON：ボリュームにレーザーを当ててトリガーを押す＝始点、押したまま動かす＝線が伸びる、離す＝終点', '線は3D空間でボリュームを貫く直線で、断面（スライス）には依存しません。空中のパネルにグラフと平均・最小・最大（動かす間はVR表示データから概算・1秒に約12回、離すと正確な値）。パネルはグリップで移動、「正面に戻す」で正面へ',
          '組織に当たらないときは選択中の断面に当たります。断面で切ったときは見えている表面だけが対象です', '線は2D／3D画面と共有されます（どちらで引いても両方に出ます）。OFFでトリガーは通常の動作に戻ります'],
        armedFlash: 'HU線 ON：トリガー＝始点、押したまま動かし、離す＝終点', disarmFlash: 'HU線 OFF', clearedFlash: 'HU線を消しました', gridFlash: 'このデータではHU線を使えません', hasLine: '線：', none: '線はありません' };
}
