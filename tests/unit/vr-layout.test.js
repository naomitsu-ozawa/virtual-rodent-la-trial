import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VOLUME_FWD, MENU_OFFSET, HELP_OFFSET, HIST_OFFSET, HIST_WIDTH, MENU_WIDTH, HELP_WIDTH, HELP_RES, EV_OFFSET, EV_WIDTH, EV_RES, HU_PANEL_OFFSET, FOLLOW_ANGLE, FOLLOW_DIST, BOARD_DIST, BOARD_YAW_DEG, boardDistance, placeFromHead, volumeFromHead } from '../../docs/vr-layout.js';
import { levelBoardH, PAGE_H, TAB_H } from '../../docs/tutorial-vr.js';

import { PANEL_W, PANEL_H } from '../../docs/vr-histogram-layout.js';
const HELP_W = 820, HELP_H = PAGE_H + TAB_H; // the help board canvas (makeMenu(820,PAGE_H+TAB_H,...) in vr-view.js: the page + the caption band under the slide + the 手順一覧 | 詳細 tab strip)
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
    expect(EV_WIDTH).toBeGreaterThanOrEqual(HELP_WIDTH); expect(EV_RES).toBeCloseTo(1280 / 820, 6); // the mission board is larger than the help board, drawn at the slide's own 1280 px
  });
  // seen only when the head turns, yet the inner edges just peek in at the edge of the view with the head straight (Quest 3: about 55 deg each side)
  const yawDeg = o => Math.atan2(Math.abs(o.left), o.fwd) * 180 / Math.PI, innerDeg = (o, w) => yawDeg(o) - Math.atan(w / 2 / Math.hypot(o.fwd, o.left)) * 180 / Math.PI;
  it('menu / help / ev boards far out to the sides: centres 45-55 deg out (BOARD_YAW_DEG 50), inner edges 30-40 deg (well inside the 55 deg edge of the view), all at the same 0.9 m', () => {
    for (const [o, w] of [[MENU_OFFSET, MENU_WIDTH], [HELP_OFFSET, HELP_WIDTH]]) { // the mission board is in front now (own test below)
      expect(yawDeg(o)).toBeCloseTo(BOARD_YAW_DEG, 1); expect(yawDeg(o)).toBeGreaterThan(45); expect(yawDeg(o)).toBeLessThan(55);
      expect(innerDeg(o, w)).toBeGreaterThan(30); expect(innerDeg(o, w)).toBeLessThan(40);
      expect(Math.hypot(o.fwd, o.left)).toBeCloseTo(BOARD_DIST, 3);
    }
  });
  it('a board in follow mode does not glide away when the head turns to read it (FOLLOW_ANGLE 65 deg = the boards\' 50 + 15)', () => {
    expect(FOLLOW_ANGLE * 180 / Math.PI).toBeCloseTo(65, 6); expect(FOLLOW_ANGLE * 180 / Math.PI).toBeGreaterThan(yawDeg(HELP_OFFSET) + 10); expect(FOLLOW_ANGLE * 180 / Math.PI).toBeGreaterThan(yawDeg(MENU_OFFSET) + 10);
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
  const evH = levelBoardH(820), h = EV_WIDTH * evH / 820, volRadius = 0.25 / 2 + 0.05; // the tutorial volume is 0.25 m, 0.5 m ahead
  const deg = r => r * 180 / Math.PI, bottom = EV_OFFSET.down + h / 2, top = EV_OFFSET.down - h / 2; // down is positive below the eyes: bottom/top are the lower/upper edges
  it('straight ahead behind the volume, a little above the gaze, larger than the help board', () => {
    expect(EV_OFFSET.left).toBe(0); expect(EV_OFFSET.fwd).toBeGreaterThan(VOLUME_FWD + volRadius); // behind the volume
    expect(EV_WIDTH).toBeGreaterThan(HELP_WIDTH); expect(EV_WIDTH).toBeGreaterThanOrEqual(0.6);
    expect(boardDistance(EV_OFFSET)).toBeGreaterThanOrEqual(1.0); expect(boardDistance(EV_OFFSET)).toBeLessThanOrEqual(1.2);
    expect(EV_OFFSET.down).toBeLessThan(0); // above the eyes
  });
  it('the lower edge is above the line of sight to the volume (the volume does not overlap it); the whole board stays inside the view', () => {
    expect(deg(Math.atan2(-bottom, boardDistance(EV_OFFSET)))).toBeGreaterThanOrEqual(4); // lower edge at least 4 deg above the gaze: the volume sits below it
    expect(deg(Math.atan2(-top, boardDistance(EV_OFFSET)))).toBeLessThanOrEqual(35); // upper edge within the view
    expect(deg(Math.atan(EV_WIDTH / 2 / boardDistance(EV_OFFSET)))).toBeLessThan(25); // the half width: inside the view and well inside the menu / help boards' 30 deg inner edges
  });
  it('clear of the menu (left) and the help board (right) and the HU panel is nearer', () => {
    expect(EV_OFFSET.left + EV_WIDTH / 2).toBeLessThan(MENU_OFFSET.left - MENU_WIDTH / 2); // nothing shares the side boards\' space
    expect(-HELP_OFFSET.left - HELP_WIDTH / 2).toBeGreaterThan(EV_WIDTH / 2); expect(HELP_OFFSET.left).toBeLessThan(0);
    expect(HU_PANEL_OFFSET.left).toBe(0); expect(HU_PANEL_OFFSET.fwd).toBeLessThan(EV_OFFSET.fwd);
  });
  it('vr-view.js places it at EV_OFFSET, 正面に戻す re-places it, and it follows the head with the same setting and rule as the help board', () => {
    const v = readFileSync('docs/vr-view.js', 'utf8');
    expect(v).toContain("const computeEvTarget=()=>{evTarget.copy(head).addScaledVector(headFwd,EV_OFFSET.fwd).addScaledVector(headLeft,EV_OFFSET.left);evTarget.y-=EV_OFFSET.down};");
    expect(v).toContain('if(ev.mesh.visible&&!evPlaced&&poseAt)placeEvNow()');
    expect(v).toContain('if(ev&&ev.mesh.visible&&evPlaced&&settings.help===1&&!evHeld){computeEvTarget();evMoving=lazyFollow(ev.mesh,evTarget,evMoving,false)}');
    expect(v).toMatch(/const placeHelpNow=[^\n]*placeEvNow\(\)/);
  });
  it('a practice session shows the operation panel on the right: help never hidden by an old setting', () => {
    const v = readFileSync('docs/vr-view.js', 'utf8');
    expect(v).toContain('const evMenu=eventModeOn()||tutLive;if(evMenu&&!(settings.help|0))settings.help=DEFAULTS.help;');
    expect(HELP_OFFSET.left).toBeLessThan(0); expect(Math.atan2(Math.abs(HELP_OFFSET.left), HELP_OFFSET.fwd) * 180 / Math.PI).toBeCloseTo(50, 1);
  });
});

describe('the help board with the caption band', () => {
  it('the caption sits under the slide: the board is taller, its top edge did not move (it stays under the histogram board), and it still clears the volume and the HU panel', () => {
    expect(PAGE_H).toBeGreaterThan(560); const h = HELP_WIDTH * HELP_H / HELP_W;
    expect(HELP_OFFSET.down - h / 2).toBeCloseTo(0.22 - HELP_WIDTH * (560 + 72) / HELP_W / 2, 2); // the top edge as before (0.22 with the old height)
    expect(HELP_OFFSET.down + h / 2).toBeLessThan(0.55); // the bottom edge is still a comfortable 55 cm below the eyes
  });
});
