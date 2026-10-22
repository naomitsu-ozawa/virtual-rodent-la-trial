import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VOLUME_FWD, MENU_OFFSET, HELP_OFFSET, HIST_OFFSET, HIST_WIDTH, MENU_WIDTH, HELP_WIDTH, boardDistance, placeFromHead, volumeFromHead } from '../../docs/vr-layout.js';

import { PANEL_W, PANEL_H } from '../../docs/vr-histogram-layout.js';
const HELP_W = 820, HELP_H = 560; // the help board canvas (makeMenu(820,560,...) in vr-view.js)
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
    expect(s).toMatch(/hist\.update\(/); expect(s).toMatch(/o\.hist=histHit\(c\)/); expect(s).toMatch(/if\(bd\.hist\)\{/); expect(s).toMatch(/histAxisEnd\(true\)/); expect(s).toMatch(/if\(histAxis===c\)histAxisEnd\(false\)/); expect(s).toMatch(/if\(!on\)histAxisEnd\(false\)/); expect(s).toMatch(/(const |,)bd=(rOff\?noHits:)?histAxis===c\?histAxisBd:boardHits\(c\)/); expect(s).toMatch(/histAxisBd=\{menu:null,help:null,hist:histAxisOut,wheel:null,pwheel:null,undoBtn:null,hu:null\}/); expect(s).not.toMatch(/hist\.grab\(/); expect(s).toMatch(/bd\.help\|\|bd\.hu/);
  });
});
describe('slice fill at 0 % opacity (slice tab row + shader guards, static)', () => {
  const v = readFileSync('docs/vr-view.js', 'utf8'), MENU_H = 1180, y0 = 270;
  it('the fill row sits below the air-floor slider (y0+604..+676) and its help line (y0+720), inside the menu', () => {
    expect(v).toContain('choice(y0+770,L.ctSh,');
    expect(v).toContain('btn(800,y0+604,70,'); expect(v).toContain('label(X,y0+720,L.airHelp');
    expect(y0 + 770).toBeGreaterThan(y0 + 604 + 72); expect(y0 + 770).toBeGreaterThan(y0 + 720 + 24); expect(y0 + 770 + 72).toBeLessThanOrEqual(MENU_H);
  });
  it('the label and the two options are short (ja / en); the default is CT shading', () => {
    expect(v).toContain("ctSh:'0%時の塗り',ctShV:['単色','CT濃淡']"); expect(v).toContain("ctSh:'Fill at 0%',ctShV:['Solid','CT shading']");
    expect(v).toContain('labelHide:LABEL_HIDE_DEFAULT,ctShade:1}'); expect(v).toContain('ctShade:{value:1}'); expect(v).toContain('sliceSegOnly:{value:0}');
  });
  it('shader: the CT factor is used only by the 0 % branch of sliceColor; the normal slice, surface hits and caps keep the flat colour; 陰影なし (diag 3) is flat', () => {
    expect(v.match(/ctLumHU\(/g)).toHaveLength(2); // the definition + the 0 % branch
    expect(v).toContain('vec4(regionColor(p,segC[si].rgb,si)*ctLumHU(hu,si),sliceTint)');
    expect(v).toContain('vec4(mix(vec3(g),regionColor(p,segC[si].rgb,si),sliceTint),a)'); // above 0 %: the old CT image + tint
    expect(v).not.toContain('segHitColor'); expect(v).not.toContain('CT_SHADE_DEPTH');
    expect(v.match(/lit=regionColor\(hp\+dir\*\(0\.75\*voxelMin\),segC\[idx\]\.rgb,idx\)\*diffuse\+vec3\(spec\)/g)).toHaveLength(4);
    expect(v.match(/lit=mix\(regionColor\(cp,segC\[ci\]\.rgb,ci\),vec3\(1\.0\),0\.22\)\*diffuse/g)).toHaveLength(2);
    expect(v).toContain('if(ctShade<0.5||diag==3||segC[s].w>0.5)return 1.0;');
  });
  it('host: 0 % opacity with a tint and the section on draws the segment region through the slice path (opacity 1); a cleared slice or no tint draws nothing', () => {
    expect(v).toContain('const segOnly=section.on&&!bench.noSection&&!ui.sliceClear&&!(settings.sliceOpacity>0)&&(+settings.sliceTint||0)>0;');
    expect(v).toContain('u.sliceSegOnly.value=segOnly?1:0;if(segOnly)u.sliceOpacity.value=1');
    expect(v).toContain('u.sliceOpacity.value=section.on&&!bench.noSection&&!ui.sliceClear?settings.sliceOpacity:0;'); // the normal assignment is unchanged
  });
});
