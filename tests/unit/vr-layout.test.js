import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VOLUME_FWD, MENU_OFFSET, HELP_OFFSET, HIST_OFFSET, HIST_WIDTH, MENU_WIDTH, HELP_WIDTH, HELP_RES, EV_OFFSET, EV_WIDTH, EV_RES, HU_PANEL_OFFSET, FOLLOW_ANGLE, FOLLOW_DIST, BOARD_DIST, boardDistance, placeFromHead, volumeFromHead } from '../../docs/vr-layout.js';
import { levelBoardH } from '../../docs/tutorial-vr.js';

import { PANEL_W, PANEL_H } from '../../docs/vr-histogram-layout.js';
const HELP_W = 820, HELP_H = 560 + 72; // the help board canvas (makeMenu(820,560+TAB_H,...) in vr-view.js;: the 手順一覧 | 詳細 tab strip is 72 px)
const head = { x: 1, y: 1.6, z: 2 }, fwd = { x: 0, z: -1 }, left = { x: -1, z: 0 };
describe('default VR/AR layout', () => {
  it('volume 0.6-0.7 m ahead, a little below the eyes', () => {
    expect(VOLUME_FWD).toBeGreaterThanOrEqual(0.6); expect(VOLUME_FWD).toBeLessThanOrEqual(0.7);
    const v = volumeFromHead(head, fwd);
    expect(v.z).toBeCloseTo(2 - VOLUME_FWD); expect(v.x).toBeCloseTo(1); expect(v.y).toBeLessThan(head.y);
  });
  it('boards 0.8-1.0 m away, below eye level, and left / right of the volume', () => {
    for (const o of [MENU_OFFSET, HELP_OFFSET]) { expect(boardDistance(o)).toBeGreaterThanOrEqual(0.8); expect(boardDistance(o)).toBeLessThanOrEqual(1.0); expect(o.down).toBeGreaterThan(0); }
    expect(MENU_OFFSET.left).toBeGreaterThan(0); expect(HELP_OFFSET.left).toBeLessThan(0);
    const m = placeFromHead(head, fwd, left, MENU_OFFSET); expect(m.x).toBeCloseTo(1 - MENU_OFFSET.left); expect(m.y).toBeCloseTo(1.6 - MENU_OFFSET.down);
  });
  it('board physical size: the menu as before, the help board 1.4 times, its canvas finer by as much (same texels per metre, not more)', () => {
    expect(MENU_WIDTH).toBe(0.5); expect(HELP_WIDTH).toBe(0.45);
    expect(HELP_RES).toBeCloseTo(HELP_WIDTH / 0.32, 1); expect(Math.round(820 * HELP_RES)).toBeLessThanOrEqual(1152); // 1148 px wide: the 1280 px slide pictures are not drawn larger than they are
    expect(EV_WIDTH).toBe(HELP_WIDTH); expect(EV_RES).toBe(HELP_RES);
  });
  const yawDeg = o => Math.atan2(Math.abs(o.left), o.fwd) * 180 / Math.PI, innerDeg = (o, w) => yawDeg(o) - Math.atan(w / 2 / Math.hypot(o.fwd, o.left)) * 180 / Math.PI;
  it('menu / help / ev boards far out to the sides: centres 55-65 deg out, inner edges 40-50 deg (inside the 55 deg edge of the view), all at the same 0.9 m', () => {
    for (const [o, w] of [[MENU_OFFSET, MENU_WIDTH], [HELP_OFFSET, HELP_WIDTH], [EV_OFFSET, EV_WIDTH]]) {
      expect(yawDeg(o)).toBeGreaterThan(55); expect(yawDeg(o)).toBeLessThan(65);
      expect(innerDeg(o, w)).toBeGreaterThan(40); expect(innerDeg(o, w)).toBeLessThan(50);
      expect(Math.hypot(o.fwd, o.left)).toBeCloseTo(BOARD_DIST, 3);
    }
  });
  it('a board in follow mode does not glide away when the head turns to read it (FOLLOW_ANGLE beyond the boards\' yaw + 10 deg)', () => {
    expect(FOLLOW_ANGLE * 180 / Math.PI).toBeGreaterThan(yawDeg(HELP_OFFSET) + 10); expect(FOLLOW_ANGLE * 180 / Math.PI).toBeGreaterThan(yawDeg(MENU_OFFSET) + 10);
    expect(FOLLOW_DIST).toBeGreaterThan(0.3);
    const v = readFileSync('docs/vr-view.js', 'utf8');
    expect(v).toContain('if(ang>FOLLOW_ANGLE||Math.abs(rm-rt)>FOLLOW_DIST||Math.abs(m.position.y-target.y)>FOLLOW_DIST)moving=true;');
    expect(v).not.toMatch(/ang>0\.6\|\|/);
  });
  it('boards stay clear of the default volume as seen from the head (half extent 0.1 m, volume is 0.165 m across)', () => {
    const volHalf = Math.atan(0.1 / VOLUME_FWD);
    for (const [o, w] of [[MENU_OFFSET, MENU_WIDTH], [HELP_OFFSET, HELP_WIDTH]]) {
      expect(Math.atan((Math.abs(o.left) - w / 2) / o.fwd)).toBeGreaterThan(volHalf);
    }
  });
  it('vr-view.js uses these constants, not literals', () => {
    const s = readFileSync('docs/vr-view.js', 'utf8');
    expect(s).toMatch(/MENU_OFFSET\.fwd/); expect(s).toMatch(/HELP_OFFSET\.fwd/); expect(s).toMatch(/VOLUME_FWD/); expect(s).toMatch(/makeMenu\(MENU_W,MENU_H,MENU_WIDTH\)/);
  });
  it('histogram board: right of the volume like the help board, at reading distance, clear of the volume and above the help board', () => {
    expect(boardDistance(HIST_OFFSET)).toBeGreaterThanOrEqual(0.8); expect(boardDistance(HIST_OFFSET)).toBeLessThanOrEqual(1.0);
    expect(HIST_OFFSET.left).toBeLessThan(0);
    expect(Math.atan((Math.abs(HIST_OFFSET.left) - HIST_WIDTH / 2) / HIST_OFFSET.fwd)).toBeGreaterThan(Math.atan(0.1 / VOLUME_FWD));
    const histBottom = HIST_OFFSET.down + HIST_WIDTH * PANEL_H / PANEL_W / 2, helpTop = HELP_OFFSET.down - HELP_WIDTH * HELP_H / HELP_W / 2;
    expect(histBottom).toBeLessThan(helpTop);
  });
  it('vr-view.js wires the histogram board: menu button, its own label pass, freed on exit; view only', () => {
    const s = readFileSync('docs/vr-view.js', 'utf8');
    expect(s).toMatch(/createVrHistogramPanel\(THREE/); expect(s).toMatch(/createVrLabelHistogram\(/); expect(s).toMatch(/labelHist\.dispose\(\)/);
    expect(s).not.toMatch(/acquireHistogram|releaseHistogram|getHistogramView|forceHistogramRecompute/); // the board counts the VR data itself (vr-label-histogram.js);: that PC consumer API is gone
    expect(readFileSync('docs/histogram-ui.js', 'utf8')).not.toMatch(/export (function|const) (acquireHistogram|releaseHistogram|getHistogramView|getHistogramProgress|forceHistogramRecompute)\b/);
    expect(s).toMatch(/histSigInto\(P,material\.uniforms,histSigNow\)/); // the pass follows the shader's path (uniforms) for the data in use
    expect(s).toMatch(/hist\.update\(/); expect(s).toMatch(/o\.hist=histHit\(c\)/); expect(s).toMatch(/if\(bd\.hist\)\{/); expect(s).toMatch(/histAxisEnd\(true\)/); expect(s).toMatch(/if\(histAxis===c\)histAxisEnd\(false\)/); expect(s).toMatch(/if\(!on\)histAxisEnd\(false\)/); expect(s).toMatch(/(const |,)bd=(rOff\?noHits:)?histAxis===c\?histAxisBd:boardHits\(c\)/); expect(s).toMatch(/histAxisBd=\{menu:null,help:null,hist:histAxisOut,wheel:null,pwheel:null,undoBtn:null,hu:null,ev:null\}/); expect(s).not.toMatch(/hist\.grab\(/); expect(s).toMatch(/bd\.hu\|\|bd\.ev/);
  });
});

describe('mission board', () => {
  const MENU_H = 1180, MENU_W = 1024, evH = levelBoardH(820); // the board is the level's 16:9 slide
  const h = EV_WIDTH * evH / 820, wH = HELP_WIDTH * (560 + 72) / 820;
  it('upper left at reading distance, same width as the help board (the text keeps its size), clear of the volume, the menu, the help board and the HU panel', () => {
    expect(EV_WIDTH).toBe(HELP_WIDTH);
    expect(boardDistance(EV_OFFSET)).toBeGreaterThanOrEqual(0.8); expect(boardDistance(EV_OFFSET)).toBeLessThanOrEqual(1.0);
    expect(EV_OFFSET.left).toBeGreaterThan(0); expect(EV_OFFSET.down).toBeLessThan(0); // left of and above the eyes
    expect(EV_OFFSET.down + h / 2).toBeLessThan(MENU_OFFSET.down - MENU_WIDTH * MENU_H / MENU_W / 2); // above the menu's top edge (no overlap)
    expect(EV_OFFSET.down + h / 2).toBeLessThan(-0.1); // far above the volume (which is below the eyes)
    expect(EV_OFFSET.left - EV_WIDTH / 2).toBeGreaterThan(0.15 + 0.1); // clear of the HU panel (centre, 0.15 m either side)
    expect(EV_OFFSET.left).toBeGreaterThan(0); expect(HELP_OFFSET.left).toBeLessThan(0); // the help board is on the other side
    expect(HELP_OFFSET.down - wH / 2).toBeGreaterThan(-0.2); expect(HU_PANEL_OFFSET.left).toBe(0);
  });
  it('vr-view.js places it once at EV_OFFSET (like the HU panel: no follow) and 正面に戻す re-places it', () => {
    const v = readFileSync('docs/vr-view.js', 'utf8');
    expect(v).toContain("evTarget.copy(head).addScaledVector(headFwd,EV_OFFSET.fwd).addScaledVector(headLeft,EV_OFFSET.left);evTarget.y-=EV_OFFSET.down;");
    expect(v).toContain('if(ev.mesh.visible&&!evPlaced&&poseAt)placeEvNow()');
    expect(v).not.toMatch(/lazyFollow\(ev\.mesh/);
  });
});
