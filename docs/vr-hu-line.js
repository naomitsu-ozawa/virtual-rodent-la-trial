import { getHuLine, setHuLine, clearHuLine, onHuLineChange } from './hu-line-model.js?v=20261028-build687';
import { lineSamples, sampleLine, profileStats } from './line-profile.js?v=20261028-build687';
import { liveProfile, LIVE_MAX_SAMPLES } from './hu-line-live.js?v=20261028-build687';
import { getHuMode, onHuModeChange, resolveHuMode } from './effective-hu.js?v=20261028-build687';
import { readEffectiveSlice, rawHuVolume, peekEffectiveReaders } from './effective-hu-source.js?v=20261028-build687';
import { sourceFilterStages } from './source-filters.js?v=20261028-build687';
import { frameYield } from './utils.js?v=20261028-build687';
import { HAPTIC } from './vr-point.js?v=20261028-build687';
import { createHuPanelGate, HU_MIN_LENGTH_VOXELS, voxelToLocalInto, voxelDistanceMm, sameGrid, liveFromTexture, readErrorText, PANEL_W, PANEL_H, PANEL_WORLD_W, panelLayout, huRange, plotPoints, panelTexts, huMenuTexts, backgroundKey, ribbonInto, quadIndex, atlasLayout, glyphsInto, GRAPH_MAX_POINTS, GLYPHS } from './vr-hu-line-core.js?v=20261028-build687';

// the self-check's HU線 scenario (HU_LINE_SELF_CHECK) is in vr-hu-line-core.js (registered when that module loads); its hooks here are
// setArmed(on, quiet), isReading(), snapshot() and restoreState(s) (vr-view.js builds selfCheck.env.huLine from them)
const LINE_COLOR = 0x35e0ff, START_COLOR = 0x7dffb0, TUBE_R_M = 0.0010, DOT_R_M = 0.0026; // thin tube (1 mm radius at real size) + end markers, in world metres

export function createVrHuLine(THREE, env) {
  const t = () => huMenuTexts(env.language);
  const gate = createHuPanelGate(), layout = panelLayout(), plotBuf = new Float32Array(2 * 4096);
  let armed = false, g = null, token = 0, tubeDirty = true, scaleCache = 0, fullBusy = false, failed = false, res = null, panelOn = false, disposed = false;
  const a = { i: 0, j: 0, k: 0 }, b = { i: 0, j: 0, k: 0 }, pick = { i: 0, j: 0, k: 0 }; // the shown endpoints (reused), the pick scratch
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmpS = new THREE.Vector3();
  let shown = false; // the line is currently drawn (model line or the one being dragged)

  // ---- the line: a thin tube + two end dots, children of the volume mesh (they move / scale with it), drawn over the volume ----
  const mat = (color, op = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false, depthWrite: false, toneMapped: false });
  const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), dotGeo = new THREE.SphereGeometry(1, 12, 8);
  const halo = new THREE.Mesh(tubeGeo, mat(0x000000, 0.55)), tube = new THREE.Mesh(tubeGeo, mat(LINE_COLOR)), dotA = new THREE.Mesh(dotGeo, mat(START_COLOR)), dotB = new THREE.Mesh(dotGeo, mat(LINE_COLOR));
  const grp = new THREE.Group(); grp.visible = false; grp.name = 'vr-hu-line';
  for (const [o, ro] of [[halo, 7], [tube, 8], [dotA, 9], [dotB, 9]]) { o.renderOrder = ro; o.frustumCulled = false; grp.add(o); }

  // ---- the live panel (world-fixed): a CanvasTexture redrawn only when new samples arrive ----
  const canvas = document.createElement('canvas'); canvas.width = PANEL_W; canvas.height = PANEL_H;
  const ctx = canvas.getContext('2d'), tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WORLD_W, PANEL_WORLD_W * PANEL_H / PANEL_W), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  panel.renderOrder = 10; panel.frustumCulled = false; panel.visible = false; panel.name = 'vr-hu-panel';

  // the graph (ribbon quads) and the numbers (atlas quads) over the background canvas; children of the panel, so the grip, 正面に戻す,
  // the laser hit (the panel itself, not recursive) and the screenshot hide of vr-view.js treat them with it. Drawn after the panel (renderOrder).
  let bgKey = '', bgDraws = 0, panelUpdates = 0, textWrites = 0;
  const GRAPH_COLOR = 0x35e0ff, GRAPH_HALF_PX = 1.5, Z_GRAPH = 0.0004, Z_TEXT = 0.0006;
  const quadMesh = (quads, material, ro) => {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(12 * quads), at = new THREE.BufferAttribute(pos, 3);
    at.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('position', at); geo.setIndex(new THREE.BufferAttribute(quadIndex(quads), 1)); geo.setDrawRange(0, 0);
    const m = new THREE.Mesh(geo, material); m.renderOrder = ro; m.frustumCulled = false; panel.add(m);
    return { m, geo, pos, at };
  };
  const graph = quadMesh(GRAPH_MAX_POINTS - 1, new THREE.MeshBasicMaterial({ color: GRAPH_COLOR, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), 10.2);
  // the digit atlas: one row of GLYPHS in bold white, made once
  const ac = document.createElement('canvas'), actx = ac.getContext('2d'), ATLAS_PX = 48, ATLAS_FONT = 'bold ' + ATLAS_PX + 'px system-ui,sans-serif';
  actx.font = ATLAS_FONT;
  const atlas = atlasLayout(ch => actx.measureText?.(ch)?.width, ATLAS_PX);
  ac.width = atlas.w; ac.height = atlas.h;
  actx.font = ATLAS_FONT; actx.fillStyle = '#ffffff'; actx.textBaseline = 'middle'; actx.textAlign = 'left';
  for (const ch of GLYPHS) { const c = atlas.cells[ch]; actx.fillText(ch, c.x + c.pad, atlas.h / 2 + 2); }
  const atex = new THREE.CanvasTexture(ac); atex.colorSpace = THREE.SRGBColorSpace; atex.generateMipmaps = false; atex.minFilter = THREE.LinearFilter; atex.magFilter = THREE.LinearFilter;
  const textMat = color => new THREE.MeshBasicMaterial({ map: atex, color, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const TEXT_CAP = 40;
  const mkText = (color, fields) => {
    const t = quadMesh(TEXT_CAP, textMat(color), 10.4), uv = new Float32Array(8 * TEXT_CAP), ua = new THREE.BufferAttribute(uv, 2);
    ua.setUsage(THREE.DynamicDrawUsage); t.geo.setAttribute('uv', ua);
    return { ...t, uv, ua, fields, shown: fields.map(() => '\u0000'), want: fields.map(() => '') };
  };
  // the number fields at the canvas places the old drawPanel used (x, y px, size px, align)
  const L0 = layout, P0 = L0.plot;
  const grey = mkText(0x9fb3c3, [
    { x: L0.head.x + L0.head.w, y: L0.head.y + L0.head.t1, size: 24, align: 'right' },                // length 「44.3 mm」 (first line, with the title)
    { x: P0.x - 6, y: P0.y + 8, size: 20, align: 'right' },                                         // axis hi
    { x: P0.x - 6, y: P0.y + P0.h - 6, size: 20, align: 'right' },                                  // axis lo
    { x: P0.x + P0.w - 22, y: L0.axisX.y + 12, size: 20, align: 'center' },                         // axis length 「44 mm」
  ]);
  const white = mkText(0xffffff, L0.stats.map(r => ({ x: r.x + r.w / 2, y: r.y + r.h - 28, size: 38, align: 'center' }))); // mean / min / max
  // rewrite a text mesh only when one of its strings changed (want[] set by the caller)
  const flushText = t => {
    let same = true; for (let i = 0; i < t.fields.length; i++) if (t.want[i] !== t.shown[i]) { same = false; break; }
    if (same) return false;
    let at = 0;
    for (let i = 0; i < t.fields.length; i++) { const f = t.fields[i]; t.shown[i] = t.want[i]; at = glyphsInto(t.want[i], f.x, f.y, f.size, f.align, atlas, t.pos, t.uv, at, Z_TEXT); }
    t.at.clearUpdateRanges(); t.at.addUpdateRange(0, 12 * at); t.at.needsUpdate = true;
    t.ua.clearUpdateRanges(); t.ua.addUpdateRange(0, 8 * at); t.ua.needsUpdate = true;
    t.geo.setDrawRange(0, 6 * at); textWrites++;
    return true;
  };

  const modeKey = () => resolveHuMode(getHuMode(), sourceFilterStages().length);
  // the background canvas: everything that does not change with the samples
  function drawBackground(tx, live, hasPlot) {
    const W = PANEL_W, H = PANEL_H, L = layout, p = L.plot;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(14,20,27,.92)'; ctx.beginPath(); ctx.roundRect(0, 0, W, H, 22); ctx.fill();
    const failedNow = tx.statusKind === 'failed';
    ctx.strokeStyle = failedNow ? '#ff8a7a' : live ? '#ffd23d' : '#35e0ff'; ctx.lineWidth = 4; ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e9f3fb'; ctx.font = 'bold 26px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.fillText(tx.head, L.head.x, L.head.y + L.head.t1, L.head.w - 130);
    if (tx.status) { // the state on its own line (one line with the title was squeezed to about half width); the font shrinks to fit, never below 15 px
      let px = 20; ctx.font = px + 'px system-ui,sans-serif';
      while (px > 15 && (ctx.measureText?.(tx.status)?.width || 0) > L.head.w) { px--; ctx.font = px + 'px system-ui,sans-serif'; }
      ctx.fillStyle = failedNow ? '#ff8a7a' : live ? '#ffd23d' : '#9fb3c3'; ctx.fillText(tx.status, L.head.x, L.head.y + L.head.t2, L.head.w);
    }
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(p.x, p.y, p.w, p.h);
    if (hasPlot) {
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
      for (const yy of [p.y, p.y + p.h]) { ctx.beginPath(); ctx.moveTo(p.x, yy); ctx.lineTo(p.x + p.w, yy); ctx.stroke(); }
      ctx.fillStyle = '#9fb3c3'; ctx.font = '20px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('0', p.x, L.axisX.y + 12);
    } else { ctx.fillStyle = '#9fb3c3'; ctx.font = '24px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(tx.empty, p.x + p.w / 2, p.y + p.h / 2); }
    for (let i = 0; i < 3; i++) {
      const r = L.stats[i];
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 12); ctx.fill();
      ctx.textAlign = 'center'; ctx.fillStyle = '#9fb3c3'; ctx.font = '22px system-ui,sans-serif'; ctx.fillText(tx.stats[i][0] + ' HU', r.x + r.w / 2, r.y + 20);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    tex.needsUpdate = true; bgDraws++;
  }
  // the panel for the current res: the background only when its state changed; the graph and the numbers as geometry
  function drawPanel() {
    if (disposed) return;
    const st = res?.stats, v = rawHuVolume(), live = !!res?.live, hasPlot = !!(res && st && st.count > 0);
    const lengthMm = res && v ? voxelDistanceMm(res.a, res.b, v.spacing) : 0;
    const tx = panelTexts(env.language, { stats: st, lengthMm, modeKey: modeKey(), live, approx: !!res?.approx, unfiltered: !!res?.unfiltered, failed, busy: fullBusy && !live, empty: !res });
    const key = backgroundKey(tx, live, hasPlot);
    if (key !== bgKey) { bgKey = key; drawBackground(tx, live, hasPlot); }
    panelUpdates++;
    let n = 0, lo = 0, hi = 0;
    if (hasPlot) {
      [lo, hi] = huRange(st);
      n = plotPoints(res.samples.dist, res.values, res.samples.n, layout.plot, lo, hi, res.samples.length, plotBuf);
      const q = ribbonInto(plotBuf, n, GRAPH_HALF_PX, graph.pos, Z_GRAPH);
      graph.at.clearUpdateRanges(); graph.at.addUpdateRange(0, 12 * q); graph.at.needsUpdate = true; graph.geo.setDrawRange(0, 6 * q);
    } else graph.geo.setDrawRange(0, 0);
    grey.want[0] = tx.length;
    grey.want[1] = hasPlot ? String(Math.round(hi)) : ''; grey.want[2] = hasPlot ? String(Math.round(lo)) : '';
    grey.want[3] = hasPlot ? Math.round(res.samples.length) + ' mm' : '';
    for (let i = 0; i < 3; i++) white.want[i] = tx.stats[i][1];
    flushText(grey); flushText(white);
  }
  // shown / hidden only: it stays where vr-view.js put it (or where the grip left it); env.onPanelShow lets vr-view.js place it the first time
  function showPanel() { if (!panelOn) { panel.visible = panelOn = true; env.onPanelShow?.(panel); } }
  function hidePanel() { panel.visible = panelOn = false; }

  // ---- sampling (the same functions as the PC panel) ----
  function liveSample() {
    const v = rawHuVolume(); if (!v || !g) return;
    const dims = { columns: v.columns, rows: v.rows, slices: v.slices }, tex = env.texture?.() || null;
    let r = null;
    if (tex?.data) { // the VR texture's CPU copy whenever it exists, also of the other kind (then approximate, labelled): the line is a
      // 3D line, an oblique one crosses slices the 2D caches do not hold (each would be a NaN gap in the graph)
      const samples = lineSamples(g.a, g.b, v.spacing, LIVE_MAX_SAMPLES), t = liveFromTexture(samples, tex, dims, modeKey());
      r = { samples, values: t.values, approx: t.approx, unfiltered: t.unfiltered };
    } else { // no copy (not ready yet): only what the 2D side already has in memory
      const p = liveProfile(g.a, g.b, v.spacing, dims, peekEffectiveReaders({ mode: getHuMode(), volume: v }), LIVE_MAX_SAMPLES);
      if (p) r = { samples: p.samples, values: p.values, approx: false, unfiltered: false };
    }
    if (r) res = { samples: r.samples, values: r.values, stats: profileStats(r.values), a: { i: g.a.i, j: g.a.j, k: g.a.k }, b: { i: g.b.i, j: g.b.j, k: g.b.k }, live: true, approx: r.approx, unfiltered: r.unfiltered };
    drawPanel();
  }
  async function fullRead(la, lb) {
    const v = rawHuVolume(); if (!v) return;
    const tok = ++token, mode = getHuMode(), dims = { columns: v.columns, rows: v.rows, slices: v.slices };
    fullBusy = true; failed = false; if (panelOn) drawPanel();
    try {
      const samples = lineSamples(la, lb, v.spacing);
      // yieldMs 6: between samples the loop gives the frame back once 6 ms have passed (PC panel: 30 ms). It cannot bound ONE slice read: a slice that is
      // not cached yet (decode / filter run in readEffectiveSlice) is a single await, and its synchronous parts can still take longer than a frame.
      const values = await sampleLine(samples, dims, z => readEffectiveSlice(z, { mode, volume: v }), { cancelled: () => tok !== token || disposed, yieldFn: frameYield, yieldMs: 6 });
      if (!values || tok !== token) return;
      res = { samples, values, stats: profileStats(values), a: la, b: lb, live: false, approx: false };
    } catch (e) {
      if (tok === token) { const msg = readErrorText(env.language, e); if (msg) { console.warn('VR HU line read failed', e); failed = true; env.flash(msg); } } // never silent (the live values stay on the panel, marked)
    }
    finally { if (tok === token) { fullBusy = false; if (panelOn) drawPanel(); } }
  }

  // ---- the line mesh ----
  function setEnds(ea, eb, withB) {
    a.i = ea.i; a.j = ea.j; a.k = ea.k;
    if (eb) { b.i = eb.i; b.j = eb.j; b.k = eb.k; }
    shown = true; tubeDirty = true; grp.userData.withB = !!withB;
  }
  function hideLine() { shown = false; grp.visible = false; }
  function placeTube(o, len, r) { o.position.copy(pa).addScaledVector(dir, len / 2); o.quaternion.setFromUnitVectors(up, dir); o.scale.set(r, len, r); }
  function layoutLine() {
    const m = env.mesh(), he = env.halfExt(), dims = env.dims();
    if (!m || !he || !dims || !shown) { grp.visible = false; return; }
    if (grp.parent !== m) m.add(grp);
    const e = m.matrixWorld.elements, s = Math.hypot(e[0], e[1], e[2]) || 1; // world scale of the volume: the tube keeps its real thickness
    if (Math.abs(s - scaleCache) > scaleCache * 1e-3) { scaleCache = s; tubeDirty = true; }
    if (!tubeDirty) { grp.visible = true; return; }
    tubeDirty = false;
    const rt = TUBE_R_M / s, rd = DOT_R_M / s, withB = grp.userData.withB;
    voxelToLocalInto(a, he, dims, pa); dotA.position.copy(pa); dotA.scale.setScalar(rd);
    dotB.visible = tube.visible = halo.visible = withB;
    if (withB) {
      voxelToLocalInto(b, he, dims, pb); dotB.position.copy(pb); dotB.scale.setScalar(rd);
      dir.subVectors(pb, pa); const len = dir.length();
      if (len > 1e-9) {
        dir.multiplyScalar(1 / len);
        placeTube(tube, len, rt); placeTube(halo, len, rt * 2.4);
      } else tube.visible = halo.visible = false;
    }
    grp.visible = true;
  }
  const showModelLine = () => { const L = getHuLine(); if (L) setEnds(L.a, L.b, true); else hideLine(); };

  // ---- the gesture ----
  function start(c) {
    if (!armed || g) return false;
    const v = rawHuVolume(), dims = env.dims();
    if (!v || !sameGrid(v, dims)) { env.flash(t().gridFlash); return false; }
    if (!env.pick(c, pick)) return false; // the laser is on neither tissue nor a section: the trigger keeps its normal action
    token++; fullBusy = false; failed = false; // an older full read is stale now
    g = { c, a: { i: pick.i, j: pick.j, k: pick.k }, b: { i: pick.i, j: pick.j, k: pick.k }, moved: false, prevShown: shown };
    res = null; gate.reset();
    setEnds(g.a, g.b, false); showPanel(); drawPanel();
    env.pulse(c, HAPTIC.select.amp, HAPTIC.select.ms);
    return true;
  }
  function end(c) {
    if (!g || g.c !== c) return false;
    const cur = g; g = null;
    if (env.pick(c, pick)) { cur.b.i = pick.i; cur.b.j = pick.j; cur.b.k = pick.k; }
    const v = rawHuVolume();
    if (!v || voxelDistanceMm(cur.a, cur.b, [1, 1, 1]) < HU_MIN_LENGTH_VOXELS) { // a click without a stretch: nothing is drawn, the old line stays
      res = null; hidePanel(); showModelLine(); return true;
    }
    setHuLine(cur.a, cur.b, 'final', 'vr'); // the shared model: the PC views show it too (onHuLineChange below keeps the mesh in step)
    setEnds(cur.a, cur.b, true);
    env.pulse(c, HAPTIC.record.amp, HAPTIC.record.ms);
    void fullRead({ i: cur.a.i, j: cur.a.j, k: cur.a.k }, { i: cur.b.i, j: cur.b.j, k: cur.b.k });
    return true;
  }
  function cancelDrag() { if (!g) return; g = null; res = null; hidePanel(); showModelLine(); }

  function update(now) {
    if (disposed) return;
    if (g) { // the pick follows the laser every frame (smooth line); the sampling + panel at <= 12.5 Hz
      if (env.pick(g.c, pick) && (pick.i !== g.b.i || pick.j !== g.b.j || pick.k !== g.b.k)) {
        g.b.i = pick.i; g.b.j = pick.j; g.b.k = pick.k; g.moved = true; failed = false; b.i = pick.i; b.j = pick.j; b.k = pick.k; grp.userData.withB = true; tubeDirty = true;
      }
      if (gate.ready(now, g.moved)) { g.moved = false; liveSample(); }
    }
    if (shown) layoutLine();
  }

  // ---- shared state in / out ----
  const offLine = onHuLineChange(ev => {
    if (g) return; // our own drag shows its own line; the model change of another view waits until the release
    if (ev.phase === 'clear') { token++; fullBusy = false; res = null; hideLine(); hidePanel(); return; }
    if (ev.source !== 'vr') { showModelLine(); if (panelOn) { res = null; hidePanel(); } } // drawn elsewhere (PC): the line follows; the live panel belongs to a VR draw
  });
  const offMode = onHuModeChange(() => { const L = getHuLine(); if (panelOn && !g && L && res) { void fullRead(L.a, L.b); } });
  showModelLine();

  return {
    group: grp, panel,
    isArmed: () => armed,
    hasLine: () => !!getHuLine(),
    isDragging: () => !!g,
    setArmed(on, quiet = false) { // quiet: no flash message (the self-check arms it for its synthetic drag)
      const v = !!on; if (v === armed) return;
      armed = v; if (!v) { cancelDrag(); if (panelOn) hidePanel(); }
      if (!quiet) env.flash(armed ? t().armedFlash : t().disarmFlash); env.refresh();
    },
    clear() { cancelDrag(); token++; fullBusy = false; res = null; clearHuLine('vr'); hideLine(); hidePanel(); env.flash(t().clearedFlash); env.refresh(); },
    start, end, update, cancelDrag,
    cancelDragOf(c) { if (g && g.c === c) cancelDrag(); }, // the controller that holds the drag went away
    isReading: () => fullBusy, // the full read after a release is running
    // snapshot() before the synthetic drag, restoreState(s) after it (also on cancel / error). The restore drops the drag and any
    // pending read, puts the shared line back as it was (source 'self-check': the PC views and this module follow it; no line = cleared), re-reads it
    // when its panel was showing, and puts the armed state back without a flash.
    snapshot: () => ({ armed, line: getHuLine(), panel: panelOn }),
    restoreState(s) {
      if (!s) return;
      g = null; token++; fullBusy = false; failed = false; res = null;
      // the shared model even after dispose(): leaving VR cancels the self-check, whose restore then runs after the cleanup (the PC views keep the old line)
      if (s.line) setHuLine(s.line.a, s.line.b, 'final', 'self-check'); else clearHuLine('self-check'); // (no emit when there was no line to clear)
      if (disposed) return;
      showModelLine(); hidePanel(); // the drag's own line / panel go in any case
      if (s.line && s.panel) { showPanel(); void fullRead(s.line.a, s.line.b); }
      if (armed !== s.armed) { armed = s.armed; env.refresh(); }
    },
    onModelChanged: showModelLine,
    stats: () => res?.stats || null,
    // how the panel was redrawn (tests / self-check): background canvas draws, panel updates (one per sample), number-field rewrites
    panelCounts: () => ({ background: bgDraws, updates: panelUpdates, texts: textWrites }),
    // what the panel shows now: the title (head + state), live / approx / unfiltered, the number of samples and of NaN gaps
    panelState: () => ({ title: bgKey.split('|')[0], live: !!res?.live, approx: !!res?.approx, unfiltered: !!res?.unfiltered, failed, n: res ? res.values.length : 0, nan: res ? Array.from(res.values).filter(x => !Number.isFinite(x)).length : 0 }),
    dispose() {
      disposed = true; token++; offLine(); offMode(); hidePanel(); panel.parent?.remove(panel); grp.parent?.remove(grp);
      tubeGeo.dispose(); dotGeo.dispose(); for (const o of [halo, tube, dotA, dotB]) o.material.dispose();
      tex.dispose(); panel.geometry.dispose(); panel.material.dispose();
      atex.dispose(); for (const o of [graph, grey, white]) { o.geo.dispose(); o.m.material.dispose(); }
    }
  };
}
