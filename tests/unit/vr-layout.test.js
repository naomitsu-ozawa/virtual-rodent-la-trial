import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VOLUME_FWD, MENU_OFFSET, HELP_OFFSET, HIST_OFFSET, HIST_WIDTH, MENU_WIDTH, HELP_WIDTH, boardDistance, placeFromHead, volumeFromHead } from '../../docs/vr-layout.js';

import { PANEL_W, PANEL_H } from '../../docs/vr-histogram-layout.js';
import { sliceDrawState, SLICE_SEG_ALPHA } from '../../docs/event-mode.js';
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
describe('slice fill (slice tab row + shader guards, static)', () => {
  const v = readFileSync('docs/vr-view.js', 'utf8'), MENU_H = 1180, y0 = 270;
  it('the fill row sits below the air-floor slider (y0+604..+676) and its help line (y0+720), inside the menu', () => {
    expect(v).toContain('choice(y0+770,L.ctSh,');
    expect(v).toContain('btn(800,y0+604,70,'); expect(v).toContain('label(X,y0+720,L.airHelp');
    expect(y0 + 770).toBeGreaterThan(y0 + 604 + 72); expect(y0 + 770).toBeGreaterThan(y0 + 720 + 24); expect(y0 + 770 + 72).toBeLessThanOrEqual(MENU_H);
  });
  it('the label and the two options are short (ja / en); the default is CT shading', () => {
    expect(v).toContain("ctSh:'スライスの塗り',ctShV:['単色','CT濃淡']"); expect(v).toContain("ctSh:'Slice fill',ctShV:['Solid','CT shading']");
    expect(v).toContain('labelHide:LABEL_HIDE_DEFAULT,ctShade:1}'); expect(v).toContain('ctShade:{value:1}'); expect(v).toContain('sliceSegOnly:{value:0}');
  });
  it('shader: the CT factor is used by the two slice branches only; surface hits and caps keep the flat colour; 陰影なし (diag 3) is flat', () => {
    expect(v.match(/ctLumHU\(/g)).toHaveLength(3); // the definition + the 0 % branch + the above-0 % tint
    expect(v).toContain('vec4(regionColor(p,segC[si].rgb,si)*ctLumHU(hu,si),ctShade>0.5?SEG_ALPHA:sliceTint)'); // 0 %: CT shading at the fixed opacity, solid at the tint
    expect(v).toContain('vec4(mix(vec3(g),regionColor(p,segC[si].rgb,si)*ctLumHU(hu,si),sliceTint),a)'); // above 0 %: the tint colour carries the CT value (factor 1 when solid = the old slice)
    expect(v).not.toContain('segHitColor'); expect(v).not.toContain('CT_SHADE_DEPTH');
    expect(v.match(/lit=regionColor\(hp\+dir\*\(0\.75\*voxelMin\),segC\[idx\]\.rgb,idx\)\*diffuse\+vec3\(spec\)/g)).toHaveLength(4);
    expect(v.match(/lit=mix\(regionColor\(cp,segC\[ci\]\.rgb,ci\),vec3\(1\.0\),0\.22\)\*diffuse/g)).toHaveLength(2);
    expect(v).toContain('if(ctShade<0.5||diag==3||segC[s].w>0.5)return 1.0;');
  });
  it('the shader\'s fixed fill opacity equals the JS constant (0.95)', () => {
    expect(SLICE_SEG_ALPHA).toBe(0.95); expect(v).toContain('#define SEG_ALPHA 0.95 ');
  });
  it('host: the slice state comes from sliceDrawState, fed with ui.sliceClear (so the thumbstick click and the double pinch, which only toggle it, draw the same as 0 %)', () => {
    expect(v).toContain('sliceDrawState({on:section.on&&!bench.noSection,clear:ui.sliceClear,opacity:settings.sliceOpacity,tint:settings.sliceTint,ctShade:settings.ctShade})');
    expect(v).toContain('u.sliceSegOnly.value=d.segOnly;u.sliceOpacity.value=d.opacity');
    const i0 = v.indexOf('u.sliceOpacity.value=section.on&&!bench.noSection&&!ui.sliceClear?settings.sliceOpacity:0;'), i1 = v.indexOf('const d=sliceDrawState(');
    expect(i0).toBeGreaterThan(0); expect(i1).toBeGreaterThan(i0); // the original assignment stays; sliceDrawState overrides it right after (a cleared slice no longer ends as nothing)
    expect(v.match(/ui\.sliceClear=/g).length).toBeGreaterThan(2); // toggled by toggleSliceClear (stick / pinch), reset by the slider and the reset
    expect(v).toContain('const toggleSliceClear=c=>{ui.sliceClear=!ui.sliceClear;');
    expect(v).toContain("if(ev==='short')toggleSliceClear(c);"); expect(v).toContain('toggleSliceClear(c)}}'); // stick click, double pinch
  });
});
describe('sliceDrawState (what the slice draws)', () => {
  const on = { on: true, clear: false, opacity: 0.6, tint: 0.45, ctShade: 1 };
  it('above 0 % the slice is the CT image at the slider value (segOnly 0), solid or shaded', () => {
    expect(sliceDrawState(on)).toEqual({ opacity: 0.6, segOnly: 0 }); expect(sliceDrawState({ ...on, ctShade: 0 })).toEqual({ opacity: 0.6, segOnly: 0 });
  });
  it('0 % and the thumbstick-cleared slice give the same segment-only fill, even with a slider above 0 %', () => {
    for (const ctShade of [0, 1]) {
      const zero = sliceDrawState({ ...on, opacity: 0, ctShade }), cleared = sliceDrawState({ ...on, clear: true, ctShade }), clearedAt0 = sliceDrawState({ ...on, clear: true, opacity: 0, ctShade });
      expect(zero).toEqual({ opacity: 1, segOnly: 1 }); expect(cleared).toEqual(zero); expect(clearedAt0).toEqual(zero);
    }
  });
  it('section off (or bench no-section) draws nothing; solid without a tint draws nothing, CT shading does not need the tint', () => {
    expect(sliceDrawState({ ...on, on: false })).toEqual({ opacity: 0, segOnly: 0 }); expect(sliceDrawState({ ...on, on: false, clear: true, opacity: 0 })).toEqual({ opacity: 0, segOnly: 0 });
    expect(sliceDrawState({ ...on, opacity: 0, ctShade: 0, tint: 0 })).toEqual({ opacity: 0, segOnly: 0 }); expect(sliceDrawState({ ...on, clear: true, ctShade: 0, tint: 0 })).toEqual({ opacity: 0, segOnly: 0 });
    expect(sliceDrawState({ ...on, opacity: 0, ctShade: 1, tint: 0 })).toEqual({ opacity: 1, segOnly: 1 });
  });
});
