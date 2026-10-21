import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { localToVoxelInto, voxelToLocalInto, voxelFromHits, voxelDistanceMm, sameGrid, panelLayout, huRange, plotPoints, panelTexts, huMenuTexts, createHuPanelGate, sampleTexture, textureMatchesMode, textureIsReduced, liveFromTexture, readErrorText, HU_PANEL_INTERVAL_MS, PANEL_W, PANEL_H, PANEL_WORLD_W, backgroundKey, ribbonInto, quadIndex, atlasLayout, glyphsInto, pxX, pxY, GLYPHS } from '../../docs/vr-hu-line-core.js';
import { voxelToLocal } from '../../docs/vr-point.js';
import { lineSamples } from '../../docs/line-profile.js';
import { isHuLineDeferred, setHuLineDeferred, onHuLineDeferChange } from '../../docs/hu-line-model.js';

const dims = { columns: 64, rows: 48, slices: 32 }, he = [0.5, 0.375, 0.25];

describe('vr-hu-line-core: ray hit -> voxel', () => {
  it('is the inverse of voxelToLocalInto, also for fractional voxels', () => {
    const l = { x: 0, y: 0, z: 0 }, out = { i: 0, j: 0, k: 0 };
    for (const v of [{ i: 0, j: 0, k: 0 }, { i: 63, j: 47, k: 31 }, { i: 10.25, j: 20.5, k: 3.75 }]) {
      voxelToLocalInto(v, he, dims, l);
      expect(localToVoxelInto(l, he, dims, out)).toBe(out);
      expect(out.i).toBeCloseTo(v.i, 9); expect(out.j).toBeCloseTo(v.j, 9); expect(out.k).toBeCloseTo(v.k, 9);
    }
  });
  it('agrees with the VR point convention (vr-point.js voxelToLocal)', () => {
    const l = { x: 0, y: 0, z: 0 }; voxelToLocalInto({ i: 5, j: 7, k: 9 }, he, dims, l);
    expect(l).toEqual(voxelToLocal({ i: 5, j: 7, k: 9 }, he, dims));
  });
  it('rejects points outside the box (more than half a voxel) and bad input, writes nothing then', () => {
    const out = { i: -1, j: -1, k: -1 };
    expect(localToVoxelInto({ x: 0.6, y: 0, z: 0 }, he, dims, out)).toBeNull();
    expect(localToVoxelInto({ x: NaN, y: 0, z: 0 }, he, dims, out)).toBeNull();
    expect(localToVoxelInto(null, he, dims, out)).toBeNull();
    expect(out).toEqual({ i: -1, j: -1, k: -1 });
    expect(localToVoxelInto({ x: 0.5, y: 0, z: 0 }, he, dims, out)).not.toBeNull(); // the outer face of the edge voxel
  });
  it('prefers the tissue hit, falls back to the section plane, null when neither is inside', () => {
    const out = { i: 0, j: 0, k: 0 }, vh = { local: { x: 0.1, y: 0, z: 0 } }, sh = { point: { x: -0.2, y: 0, z: 0 } };
    expect(voxelFromHits(vh, sh, he, dims, out)).toBe('volume');
    const a = out.i;
    expect(voxelFromHits(null, sh, he, dims, out)).toBe('section');
    expect(out.i).toBeLessThan(a);
    expect(voxelFromHits({ local: { x: 5, y: 0, z: 0 } }, sh, he, dims, out)).toBe('section'); // a tissue hit outside the box is not used
    expect(voxelFromHits(null, null, he, dims, out)).toBeNull();
    expect(voxelFromHits(null, { point: { x: 9, y: 9, z: 9 } }, he, dims, out)).toBeNull();
  });
  it('distance in mm and grid comparison', () => {
    expect(voxelDistanceMm({ i: 0, j: 0, k: 0 }, { i: 3, j: 4, k: 0 }, [1, 1, 2])).toBeCloseTo(5);
    expect(voxelDistanceMm({ i: 0, j: 0, k: 0 }, { i: 0, j: 0, k: 3 }, [1, 1, 2])).toBeCloseTo(6);
    expect(voxelDistanceMm({ i: 0, j: 0, k: 0 }, { i: 3, j: 4, k: 0 }, null)).toBeCloseTo(5);
    expect(sameGrid(dims, { ...dims })).toBe(true);
    expect(sameGrid(dims, { ...dims, slices: 33 })).toBe(false);
    expect(sameGrid(null, dims)).toBe(false);
  });
});

describe('vr-hu-line-core: throttle', () => {
  it('runs about 12.5 Hz while dirty and never when idle (and returns a plain boolean: no per-frame object)', () => {
    expect(HU_PANEL_INTERVAL_MS).toBeGreaterThanOrEqual(66); expect(HU_PANEL_INTERVAL_MS).toBeLessThanOrEqual(100); // 10-15 Hz
    const g = createHuPanelGate();
    let runs = 0;
    for (let t = 0; t < 1000; t += 1000 / 72) { const r = g.ready(t, true); expect(typeof r).toBe('boolean'); if (r) runs++; } // 72 fps frames, always dirty
    expect(runs).toBeGreaterThanOrEqual(10); expect(runs).toBeLessThanOrEqual(15);
    expect(g.ready(5000, false)).toBe(false);
    g.reset(); expect(g.ready(5001, true)).toBe(true); // a new press samples at once
  });
});

describe('vr-hu-line-core: panel layout and plot', () => {
  it('keeps every block inside the canvas without overlaps', () => {
    const L = panelLayout(), inside = r => r.x >= 0 && r.y >= 0 && r.x + r.w <= PANEL_W && r.y + r.h <= PANEL_H && r.w > 0 && r.h > 0;
    for (const r of [L.head, L.plot, L.axisX, ...L.stats]) expect(inside(r), JSON.stringify(r)).toBe(true);
    expect(L.plot.y).toBeGreaterThanOrEqual(L.head.y + L.head.h);
    expect(L.axisX.y).toBeGreaterThanOrEqual(L.plot.y + L.plot.h);
    expect(L.stats[0].y).toBeGreaterThanOrEqual(L.axisX.y + L.axisX.h);
    for (let i = 1; i < 3; i++) expect(L.stats[i].x).toBeGreaterThanOrEqual(L.stats[i - 1].x + L.stats[i - 1].w);
  });
  it('huRange adds a margin and never collapses', () => {
    const [lo, hi] = huRange({ min: -100, max: 300 });
    expect(lo).toBeLessThan(-100); expect(hi).toBeGreaterThan(300);
    const [a, b] = huRange({ min: 40, max: 40 }); expect(b - a).toBeGreaterThanOrEqual(20);
    expect(huRange(null)).toEqual([-100, 100]);
  });
  it('plotPoints maps into the rect, leaves gaps for NaN, allocates nothing (fills the given buffer)', () => {
    const r = { x: 10, y: 20, w: 100, h: 50 }, out = new Float32Array(16), dist = [0, 5, 10], values = [0, NaN, 100];
    expect(plotPoints(dist, values, 3, r, 0, 100, 10, out)).toBe(3);
    expect([out[0], out[1]]).toEqual([10, 70]); // x at 0 mm, the lowest value at the bottom
    expect(out[3]).toBeNaN();
    expect([out[4], out[5]]).toEqual([110, 20]); // the end at the right edge, the highest value at the top
    expect(plotPoints(dist, [500, -500, 0], 3, r, 0, 100, 10, out)).toBe(3); expect(out[1]).toBe(20); expect(out[3]).toBe(70); // clamped
    expect(plotPoints([0], [5], 1, r, 0, 10, 0, out)).toBe(1); expect(out[0]).toBe(60); // a zero-length line sits in the middle
    expect(plotPoints(new Float64Array(100), new Float64Array(100), 100, r, 0, 1, 1, out)).toBe(8); // capped by the buffer
  });
  it('texts: mode, live, length, mean / min / max, in both languages', () => {
    const st = { mean: 12.34, min: -5.2, max: 99.9 };
    const ja = panelTexts('ja', { stats: st, lengthMm: 12.345, modeKey: 'filtered', live: true });
    expect(ja.title).toContain('フィルター後'); expect(ja.title).toContain('ライブ'); expect(ja.length).toBe('12.3 mm');
    expect(ja.stats).toEqual([['平均', '12.3'], ['最小', '-5'], ['最大', '100']]);
    const en = panelTexts('en', { stats: null, lengthMm: 0, modeKey: 'raw', busy: true, empty: true });
    expect(en.title).toContain('Raw'); expect(en.title).toContain('reading'); expect(en.stats[0][1]).toBe('—'); expect(en.length).toBe('');
    for (const lang of ['ja', 'en']) { const m = huMenuTexts(lang); expect(m.help.length).toBe(4); expect(m.tab.length).toBeGreaterThan(0); }
  });
});

// packs HU values of a w x h x d grid like vr-view.js buildVolumeData (rg8 little-endian u16, bias 32768 = signed, slope 1, intercept 0)
const packTex = (w, h, d, f, filtered = true) => { const data = new Uint8Array(w * h * d * 2); for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = Math.round(f(x, y, z)) + 32768, o = ((z * h + y) * w + x) * 2; data[o] = u & 255; data[o + 1] = u >> 8; } return { data, dims: [w, h, d], calibration: [1, 0, 32768], filtered }; };
describe('vr-hu-line-core: live values from the VR texture copy (also with filters on, where the 2D caches are empty)', () => {
  const src = { columns: 16, rows: 12, slices: 8 }, f = (x, y, z) => -200 + 10 * x + 3 * y + 25 * z;
  it('reads the HU back exactly on the same grid, oblique lines included (no NaN)', () => {
    const tex = packTex(16, 12, 8, f), a = { i: 1, j: 2, k: 1 }, b = { i: 14, j: 9, k: 6 }, s = lineSamples(a, b, [1, 1, 1], 192), out = new Float64Array(s.n);
    sampleTexture(s, tex, src, out);
    for (let q = 0; q < s.n; q++) { expect(Number.isFinite(out[q])).toBe(true); expect(out[q]).toBeCloseTo(f(s.x[q], s.y[q], s.z[q]), 0); } // linear field: trilinear is exact up to the 1-HU packing
    expect(textureIsReduced(tex, src)).toBe(false);
  });
  it('a reduced grid is flagged approximate and still finite, within the field\'s slope', () => {
    const tex = packTex(8, 6, 4, (x, y, z) => f(2 * x + 0.5, 2 * y + 0.5, 2 * z + 0.5)), s = lineSamples({ i: 0, j: 0, k: 0 }, { i: 15, j: 11, k: 7 }, [1, 1, 1], 64), out = new Float64Array(s.n);
    sampleTexture(s, tex, src, out);
    expect(textureIsReduced(tex, src)).toBe(true);
    for (let q = 0; q < s.n; q++) { expect(Number.isFinite(out[q])).toBe(true); expect(Math.abs(out[q] - f(s.x[q], s.y[q], s.z[q]))).toBeLessThan(40); }
  });
  it('honours slope / intercept / bias', () => {
    const tex = { data: new Uint8Array([100, 0, 100, 0]), dims: [2, 1, 1], calibration: [2, -1000, 0], filtered: false }, s = lineSamples({ i: 0, j: 0, k: 0 }, { i: 1, j: 0, k: 0 }, [1, 1, 1], 5), out = new Float64Array(s.n);
    sampleTexture(s, tex, { columns: 2, rows: 1, slices: 1 }, out);
    expect([...out].every(v => v === -800)).toBe(true);
  });
  it('is used only when its kind (filtered / raw) is the one asked for', () => {
    const t = { data: new Uint8Array(2), filtered: true };
    expect(textureMatchesMode(t, 'filtered')).toBe(true); expect(textureMatchesMode(t, 'raw')).toBe(false);
    expect(textureMatchesMode({ ...t, filtered: false }, 'raw')).toBe(true); expect(textureMatchesMode(null, 'raw')).toBe(false);
  });
  it('an oblique line with a mode-mismatched texture gives zero NaN samples (both directions), approximate, unfiltered flagged', () => {
    const a = { i: 1, j: 2, k: 0 }, b = { i: 14, j: 9, k: 7 }, s = lineSamples(a, b, [0.5, 0.5, 1.2], 192);
    expect(new Set(Array.from(s.z, z => Math.round(z))).size).toBeGreaterThan(4); // crosses many axial slices
    for (const [filtered, mode] of [[false, 'filtered'], [true, 'raw']]) {
      const tex = packTex(16, 12, 8, f, filtered), r = liveFromTexture(s, tex, src, mode);
      expect(r).not.toBeNull(); expect(r.values.length).toBe(s.n);
      expect(Array.from(r.values).filter(v => !Number.isFinite(v))).toHaveLength(0);
      expect(r.approx).toBe(true); expect(r.unfiltered).toBe(mode === 'filtered');
    }
    const same = liveFromTexture(s, packTex(16, 12, 8, f, true), src, 'filtered');
    expect(same.approx).toBe(false); expect(same.unfiltered).toBe(false);
    expect(liveFromTexture(s, null, src, 'raw')).toBeNull(); expect(liveFromTexture(s, { dims: [1, 1, 1] }, src, 'raw')).toBeNull();
  });
  it('the panel says where the live values come from, the unfiltered case, and a failed read wins over the live state', () => {
    const st = { mean: 1, min: 0, max: 2, count: 3 };
    const ja = panelTexts('ja', { stats: st, lengthMm: 10, modeKey: 'filtered', live: true, approx: true, unfiltered: true });
    expect(ja.title).toContain('ライブ（VR表示データから概算）'); expect(ja.status).toContain('フィルター前'); expect(ja.head).toBe('HU線 · フィルター後');
    expect(panelTexts('ja', { stats: st, lengthMm: 10, modeKey: 'raw', live: true, approx: true }).status).not.toContain('フィルター前');
    const failed = panelTexts('ja', { stats: st, lengthMm: 10, modeKey: 'filtered', live: true, approx: true, failed: true });
    expect(failed.status).toContain('読み取り失敗'); expect(failed.statusKind).toBe('failed');
    expect(panelTexts('en', { stats: st, lengthMm: 10, modeKey: 'filtered', live: true, failed: true }).title).toContain('read failed');
  });
  it('the help says the line is a straight 3D line, not tied to a slice', () => {
    expect(huMenuTexts('ja').help.join('')).toContain('断面（スライス）には依存しません');
    expect(huMenuTexts('en').help.join('')).toContain('not tied to a slice');
  });
});

describe('vr-hu-line-core: read errors are clear, never a bare code', () => {
  it('WebGPU missing, superseded, other', () => {
    expect(readErrorText('ja', new Error('__GPU_UNAVAILABLE__'))).toContain('WebGPU');
    expect(readErrorText('en', new Error('__GPU_UNAVAILABLE__'))).toContain('Raw');
    expect(readErrorText('en', new Error('__SUPERSEDED__'))).toBe('');
    expect(readErrorText('en', new Error('boom'))).toContain('boom');
    expect(readErrorText('ja', 'x')).not.toContain('__');
  });
  it('the panel title says when the full read failed', () => {
    expect(panelTexts('en', { stats: null, lengthMm: 1, modeKey: 'filtered', failed: true }).title).toContain('failed');
    expect(panelTexts('en', { stats: null, lengthMm: 1, modeKey: 'filtered', live: true, approx: true }).title).toContain('approx');
  });
});

describe('hu-line-model: heavy work deferral while an immersive session is on', () => {
  it('toggles, notifies once per change, and unsubscribes', () => {
    const seen = []; const off = onHuLineDeferChange(v => seen.push(v));
    expect(isHuLineDeferred()).toBe(false);
    setHuLineDeferred(true); setHuLineDeferred(true); setHuLineDeferred(false);
    expect(seen).toEqual([true, false]); off(); setHuLineDeferred(true); setHuLineDeferred(false); expect(seen.length).toBe(2);
  });
  it('the PC panel defers its read and runs it when the session ends (source guard)', () => {
    const ui = readFileSync(new URL('../../docs/line-profile-ui.js', import.meta.url), 'utf8');
    expect(ui).toContain('if (isHuLineDeferred()) { st.deferred = true; return; }');
    expect(ui).toContain('onHuLineDeferChange(on => { if (!on && st.deferred)');
  });
});

describe('vr-view.js wiring of the HU line (source guard; the file is a WebXR module, not run in node)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('the trigger hands over to the HU line only when armed, after the menu / ring / board checks, and the release ends it first', () => {
    const ss = src.indexOf("addEventListener('selectstart'"), se = src.indexOf("addEventListener('selectend'");
    const press = src.slice(ss, se), iHu = press.indexOf('huLine.start(c)');
    expect(iHu).toBeGreaterThan(press.indexOf("res.kind==='ring-close'"));
    expect(iHu).toBeLessThan(press.indexOf('const pr={t0:now'));
    expect(press).toContain('huLine.isArmed()');
    expect(src.slice(se, se + 400)).toContain('huLine.end(c)'); // after the hand guard line (a hand's system selectend) and the histogram end
  });
  it('is updated in the frame loop, disposed on exit, and has its own tab id that collides neither with the quick-ring editor (7) nor the self-check page (8)', () => {
    expect(src).toContain('huLine.update(js0)'); expect(src).toContain('huLine.dispose()');
    expect(src).toContain('setHuLineDeferred(true)'); expect(src).toContain('setHuLineDeferred(false)');
    expect(src).toContain('TAB_IDS=[0,1,2,3,4,5,6,9]'); expect(src).toContain('ui.tab===9'); expect(src).toContain('ui.tab===8'); expect(src).toContain('ui.tab===7'); // 8 is the self-check page
  });
  it('the pick reuses the controller loop\'s hit (no second march) and runs after that loop', () => {
    const iUpd = src.indexOf('huLine.update(js0)'), iLoop = src.indexOf('for(const c of controllers){\n   // this hand');
    expect(iLoop).toBeGreaterThan(0); expect(iUpd).toBeGreaterThan(src.indexOf('c.userData.gate.update(')); // after the whole controller loop body
    expect(src).toContain('u.vhFrame===frameNo?u.volHit:volumeHit(c)'); expect(src).toContain('c.userData.vhFrame=frameNo'); expect(src).toContain('c.userData.secHit=sh');
  });
  it('keeps move / mlabel triggers, silences hover haptics while dragging, and shrinks long menu labels', () => {
    expect(src).toContain("res.kind!=='move'&&res.kind!=='mlabel'&&huLine.start(c)");
    expect(src).toContain('!huLine.isDragging()){const hpz=');
    expect(src).toContain('ctx.fillText(w.label,w.x+w.w/2,w.y+w.h/2+1,Math.max(10,w.w-8))');
  });
  it('the live panel is a world-fixed board (not on the controller): placed once, grip moves it, 正面に戻す re-places it, no follow', () => {
    const m = readFileSync(new URL('../../docs/vr-hu-line.js', import.meta.url), 'utf8');
    expect(m).not.toMatch(/\bc\.add\(panel\)|PANEL_POS|PANEL_TILT/); // never parented to a hand
    expect(m).toContain('function hidePanel() { panel.visible = panelOn = false; }'); // hiding keeps its place in the scene
    expect(src).toContain('scene.add(huLine.panel)');
    expect(src).not.toMatch(/lazyFollow\(huLine\.panel/);
    expect(src).toContain("case'home':bringVolumeFront();placeMenuNow();placeHelpNow();if(hist.isOpen)placeHistNow();placeHuNow();break;"); // quick ring 正面に戻す
    expect(src).toContain('()=>{bringVolumeFront();placeMenuNow();placeHelpNow();if(hist.isOpen)placeHistNow();placeHuNow()}'); // 表示 tab button
    expect(src).toContain('onPanelShow:()=>{if(!huPlaced&&poseAt)placeHuNow()}');
    // grip on the panel moves it (before the volume grab); release leaves it in the scene facing the head
    const sq = src.slice(src.indexOf('const gripStart=c=>{'), src.indexOf("addEventListener('selectstart'")); // gripStart / gripEnd hold the squeeze handlers' bodies
    expect(sq.indexOf('boardHits(c).hu){holdOf(c).attach(huLine.panel)')).toBeGreaterThan(0); // holdOf(c) = c for a controller
    expect(sq.indexOf('boardHits(c).hu')).toBeLessThan(sq.indexOf('grabbing.add(c)'));
    expect(sq).toContain('if(huHeld===c){scene.attach(huLine.panel);huHeld=null;');
    // the laser stops on it (nearest board), the trigger there does nothing and never starts a line; while a line is stretched it is not a target
    const hit = src.slice(src.indexOf('const huPanelHit='), src.indexOf('const huPanelHit=') + 300);
    expect(hit).toContain('huLine.isDragging())return null'); expect(hit).toContain('p.parent===holdOf(c)'); expect(hit).not.toMatch(/intersectObject|new THREE/);
    expect(src).toContain("for(const k of ['menu','help','hist','wheel','pwheel','undoBtn','hu'])");
    const press = src.slice(src.indexOf("addEventListener('selectstart'"), src.indexOf("addEventListener('selectend'"));
    expect(press.indexOf('if(bd.help||bd.hu)return;')).toBeGreaterThan(0);
    expect(press.indexOf('if(bd.help||bd.hu)return;')).toBeLessThan(press.indexOf('huLine.start(c)'));
    // on the histogram board the press only grabs an x-axis end or presses 「自動」 (display range), and always returns: it never reaches what is behind it
    const hb = press.indexOf('if(bd.hist){'); expect(hb).toBeGreaterThan(0); expect(hb).toBeLessThan(press.indexOf('huLine.start(c)'));
    expect(press.slice(hb, press.indexOf('return}', hb) + 7)).toMatch(/hist\.startAxisDrag\(t,histLocal\.x\)[\s\S]*return\}$/);
    expect(press).not.toMatch(/hist\.grab\(|setHistogramLine|commitHistogramLine/);
    expect(src).toContain('board=h||hh||bd.hist||bd.undoBtn||bd.hu||');
    // the histogram board is grabbed first, then the HU line panel, both before the volume
    expect(sq.indexOf('c.userData.histHit')).toBeGreaterThan(0); expect(sq.indexOf('c.userData.histHit')).toBeLessThan(sq.indexOf('boardHits(c).hu'));
    expect(src).toContain("ray.renderOrder=dot.renderOrder=bd.hu?11:top?8:0"); // the laser end is drawn over the panel
  });
  it('the initial place is above eye level, above the volume, at board distance, and the panel is readable there', async () => {
    const { HU_PANEL_OFFSET, VOLUME_FWD, VOLUME_DOWN, HELP_OFFSET } = await import('../../docs/vr-layout.js');
    const { PANEL_WORLD_W } = await import('../../docs/vr-hu-line-core.js');
    const h = PANEL_WORLD_W * PANEL_H / PANEL_W, bottom = -HU_PANEL_OFFSET.down - h / 2; // metres above eye level
    expect(bottom).toBeGreaterThan(-VOLUME_DOWN + 0.15); // clears the top of a 30 cm volume (the largest)
    expect(HU_PANEL_OFFSET.left).toBeLessThanOrEqual(0); expect(HU_PANEL_OFFSET.fwd).toBeGreaterThan(VOLUME_FWD); // centred (left 0)
    expect(-HU_PANEL_OFFSET.down - h / 2).toBeGreaterThan(-HELP_OFFSET.down + 0.15); // above the help board
    expect(20 * PANEL_WORLD_W / PANEL_W).toBeGreaterThanOrEqual(0.0115); // smallest text >= 1.15 cm (help board: 30 px x 0.32 m / 820 px)
  });
  it('at the initial places the HU line panel and the HU histogram board do not overlap as seen from the head, and neither covers the volume', async () => {
    const { HU_PANEL_OFFSET, HIST_OFFSET, HIST_WIDTH, VOLUME_FWD, VOLUME_DOWN } = await import('../../docs/vr-layout.js');
    const { PANEL_WORLD_W } = await import('../../docs/vr-hu-line-core.js');
    const { boardHeightM } = await import('../../docs/vr-histogram-layout.js');
    // both boards face the head (lookAt): angular extents (degrees) seen from the eye; azimuth positive = right
    const extent = (o, w, h) => {
      const d = Math.hypot(o.fwd, o.left), az = Math.atan2(-o.left, o.fwd), half = Math.atan(w / 2 / d), y = -o.down, deg = 180 / Math.PI;
      return { l: (az - half) * deg, r: (az + half) * deg, b: Math.atan((y - h / 2) / d) * deg, t: Math.atan((y + h / 2) / d) * deg };
    };
    const hu = extent(HU_PANEL_OFFSET, PANEL_WORLD_W, PANEL_WORLD_W * PANEL_H / PANEL_W), hist = extent(HIST_OFFSET, HIST_WIDTH, boardHeightM(HIST_WIDTH));
    const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.t <= b.b || b.t <= a.b;
    expect(apart(hu, hist)).toBe(true);
    expect(hist.l - hu.r).toBeGreaterThan(3); // at least 3° of clear space between them
    // the HU panel is drawn without depth test (over everything), so it must sit above the volume as seen from the eye:
    // a 30 cm volume (the largest) centred VOLUME_FWD ahead, VOLUME_DOWN below the eyes; its near face top is the highest it reaches
    const volTop = Math.atan((-VOLUME_DOWN + 0.15) / (VOLUME_FWD - 0.15)) * 180 / Math.PI;
    expect(hu.b).toBeGreaterThan(volTop);
    // the histogram board is depth-tested and further away than the volume's centre, so the volume stays in front of it
    expect(Math.hypot(HIST_OFFSET.fwd, HIST_OFFSET.left)).toBeGreaterThan(VOLUME_FWD + 0.15);
  });
  it('the HU-line module allocates no per-frame objects in update() and uses a mipmap-free canvas texture', () => {
    const m = readFileSync(new URL('../../docs/vr-hu-line.js', import.meta.url), 'utf8');
    expect(m).toContain('generateMipmaps = false');
    const u = m.slice(m.indexOf('function update(now)'), m.indexOf('// ---- shared state'));
    expect(u).not.toMatch(/new THREE\.|new Float|\.map\(|\.filter\(|\[\.\.\.|\bfor \(const \w+ of \[/);
    const lay = m.slice(m.indexOf('function placeTube'), m.indexOf('const showModelLine'));
    expect(lay).not.toMatch(/new THREE\.|new Float|\.map\(|for \(const \w+ of \[/);
  });
});

describe('a drag does not get stuck when its controller disconnects', () => {
  it('the HU-line API has cancelDragOf(c), only for the dragging controller, and vr-view calls it on disconnect and hides the panel in screenshots', () => {
    const m = readFileSync(new URL('../../docs/vr-hu-line.js', import.meta.url), 'utf8');
    expect(m).toMatch(/cancelDragOf\(c\)\s*\{\s*if \(g && g\.c === c\) cancelDrag\(\);?\s*\}/);
    const v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    const d = v.slice(v.indexOf("addEventListener('disconnected'"), v.indexOf("addEventListener('squeezestart'"));
    expect(d).toContain('huLine.cancelDragOf(c)');
    expect(v).toMatch(/hidden=\[[^\]]*huLine\.panel/);
  });
});

describe('the live panel as geometry (graph ribbon, digit atlas quads, background key)', () => {
  it('the background key changes with the state (live / final / reading / empty / language), never with the numbers', () => {
    const st = { mean: 10, min: 0, max: 20, count: 5 }, base = { stats: st, lengthMm: 40, modeKey: 'raw', live: true, approx: false, busy: false, empty: false, failed: false };
    const k = o => { const tx = panelTexts('ja', { ...base, ...o }); return backgroundKey(tx, !!(o.live ?? base.live), true); };
    expect(k({ stats: { mean: 99, min: -5, max: 300, count: 9 }, lengthMm: 12.3 })).toBe(k({})); // other numbers: same background
    expect(k({ live: false })).not.toBe(k({}));
    expect(k({ live: false, busy: true })).not.toBe(k({ live: false }));
    expect(k({ live: false, failed: true })).not.toBe(k({ live: false }));
    expect(k({ modeKey: 'filtered' })).not.toBe(k({}));
    expect(backgroundKey(panelTexts('en', base), true, true)).not.toBe(k({}));
    expect(backgroundKey(panelTexts('ja', base), true, false)).not.toBe(k({}));
  });
  it('ribbonInto: one quad per drawn segment, gaps (NaN) leave both neighbouring segments out, nothing past the buffer', () => {
    const pts = Float32Array.from([100, 100, 120, 100, 140, NaN, 160, 110, 180, 120, 200, 100]), out = new Float32Array(12 * 10);
    expect(ribbonInto(pts, 6, 1.5, out)).toBe(3); // 0-1, 3-4, 4-5 (1-2 and 2-3 touch the gap)
    // the first quad is centred on the segment, 1.5 px either side (in metres)
    const m = PANEL_WORLD_W / PANEL_W;
    expect(Math.abs(out[1] - out[4]) / m).toBeCloseTo(3, 4); expect(out[0]).toBeCloseTo(pxX(100 - 0.75), 6); expect(out[6]).toBeCloseTo(pxX(120 + 0.75), 6); expect(out[7]).toBeCloseTo(pxY(100 + 1.5), 6);
    expect(ribbonInto(pts, 6, 1.5, new Float32Array(12))).toBe(1); // capped by the buffer
    expect(ribbonInto(Float32Array.from([5, 5, 5, 5]), 2, 1, out)).toBe(1); // a zero-length segment still gets a (tiny) quad, no NaN
    expect(Array.from(out.subarray(0, 12)).every(Number.isFinite)).toBe(true);
  });
  it('quadIndex: two triangles per quad', () => { expect(Array.from(quadIndex(2))).toEqual([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]); });
  it('glyphsInto: aligned at x, centred on y, the size of the canvas font it replaces; spaces advance, unknown characters are skipped', () => {
    const atlas = atlasLayout(() => 30, 48, 4), pos = new Float32Array(12 * 20), uv = new Float32Array(8 * 20), m = PANEL_WORLD_W / PANEL_W;
    expect(atlas.w).toBe(GLYPHS.length * 38);
    let n = glyphsInto('12', 300, 50, 24, 'right', atlas, pos, uv, 0);
    expect(n).toBe(2); // two quads; the right edge of the inked part is at x = 300 (advance 30 * 24 / 48 = 15 px each)
    expect(pos[21]).toBeCloseTo(pxX(300 + 4 * 0.5), 6); expect(pos[12]).toBeCloseTo(pxX(300 - 15 - 2), 6);
    const h = (pos[1] - pos[4]) / m; expect(h).toBeCloseTo(atlas.h * 0.5, 4); expect((pos[1] + pos[4]) / 2).toBeCloseTo(pxY(50), 6);
    expect(uv[0]).toBeCloseTo(atlas.cells['1'].x / atlas.w, 6); expect(uv[1]).toBe(1); expect(uv[3]).toBe(0);
    n = glyphsInto('4 mm', 100, 50, 20, 'center', atlas, pos, uv, n); expect(n).toBe(5); // the space is not a quad
    n = glyphsInto('x7', 100, 50, 20, 'left', atlas, pos, uv, n); expect(n).toBe(6);
    expect(glyphsInto('—', 0, 0, 38, 'center', atlas, pos, uv, 0)).toBe(1); // the no-value dash is in the atlas
    expect(glyphsInto('1234567890', 0, 0, 20, 'left', atlas, new Float32Array(12 * 3), new Float32Array(8 * 3), 0)).toBe(3); // capped
  });
});
