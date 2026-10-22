import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VOLUME_FWD, MENU_OFFSET, HELP_OFFSET, HIST_OFFSET, HIST_WIDTH, MENU_WIDTH, HELP_WIDTH, EV_OFFSET, EV_WIDTH, HU_PANEL_OFFSET, boardDistance, placeFromHead, volumeFromHead } from '../../docs/vr-layout.js';

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
  it('board physical size is unchanged (not scaled up with the distance)', () => {
    expect(MENU_WIDTH).toBe(0.5); expect(HELP_WIDTH).toBe(0.32);
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
  const MENU_H = 1180, MENU_W = 1024, evH = 64 + 5 * 32 + 10; // the tallest mission (5 lines) on its own board
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
describe('CT shading (slice tab row + shader guards, static)', () => {
  const v = readFileSync('docs/vr-view.js', 'utf8'), MENU_H = 1180, y0 = 270;
  it('the CT shading row sits below the air-floor slider (y0+604..+676) and its help line (y0+720), inside the menu', () => {
    expect(v).toContain('choice(y0+770,L.ctSh,');
    expect(v).toContain('btn(800,y0+604,70,'); expect(v).toContain('label(X,y0+720,L.airHelp');
    expect(y0 + 770).toBeGreaterThan(y0 + 604 + 72); expect(y0 + 770).toBeGreaterThan(y0 + 720 + 24); expect(y0 + 770 + 72).toBeLessThanOrEqual(MENU_H);
  });
  it('the row label is short (ja / en)', () => {
    expect(v).toContain("ctSh:'CT値の濃淡'"); expect(v).toContain("ctSh:'CT shading'");
  });
  it('shader: rim fallback to the 0.75-voxel HU, caps read the slice HU, 陰影なし (diag 3) is flat', () => {
    expect(v).toContain('if(hu<a.x||hu>a.y)hu=huAt(texCoord(p));lum=ctLumHU(hu,s);');
    expect(v.match(/ctLumHU\(sliceHU\(cp\),ci\)/g)).toHaveLength(2); expect(v).not.toContain('ctLum(cp,ci)');
    expect(v).toContain('if(ctShade<0.5||diag==3||segC[s].w>0.5)return 1.0;'); expect(v).toContain('ctShade>=0.5&&diag!=3&&segC[s].w<0.5');
  });
});
