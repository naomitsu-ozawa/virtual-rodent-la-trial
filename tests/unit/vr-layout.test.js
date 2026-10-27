import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VOLUME_FWD, MENU_OFFSET, HELP_OFFSET, HIST_OFFSET, HIST_WIDTH, MENU_WIDTH, HELP_WIDTH, HELP_RES, EV_OFFSET, EV_WIDTH, EV_RES, HU_PANEL_OFFSET, FOLLOW_ANGLE, FOLLOW_DIST, BOARD_DIST, BOARD_YAW_DEG, boardDistance, placeFromHead, volumeFromHead } from '../../docs/vr-layout.js';
import { levelBoardH, PAGE_H, TAB_H } from '../../docs/tutorial-vr.js';

import { PANEL_W, PANEL_H } from '../../docs/vr-histogram-layout.js';
const HELP_W = 820, HELP_H = PAGE_H + TAB_H; // the help board canvas (makeMenu(820,PAGE_H+TAB_H,...) in vr-view.js: the page + the caption band under the slide + the 手順一覧 | 詳細 tab strip)
import { sliceDrawState, SLICE_SEG_ALPHA } from '../../docs/event-mode.js';
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
  const evH = levelBoardH(820), h = EV_WIDTH * evH / 820, helpH = HELP_WIDTH * HELP_H / HELP_W;
  const deg = r => r * 180 / Math.PI, horiz = o => Math.hypot(o.fwd, o.left), yaw = o => deg(Math.atan2(-o.left, o.fwd)); // yaw: + = right
  const bottom = EV_OFFSET.down + h / 2, top = EV_OFFSET.down - h / 2, helpTop = HELP_OFFSET.down - helpH / 2; // down is positive below the eyes
  it('on the right, in the help board\'s direction, at 1.1 m, larger than the help board', () => {
    expect(yaw(EV_OFFSET)).toBeCloseTo(yaw(HELP_OFFSET), 1); expect(EV_OFFSET.left).toBeLessThan(0);
    expect(horiz(EV_OFFSET)).toBeCloseTo(1.1, 3);
    expect(EV_WIDTH).toBeGreaterThan(HELP_WIDTH); expect(EV_WIDTH).toBeGreaterThanOrEqual(0.6);
  });
  it('above the help board: its lower edge above the help board\'s top edge (by angle from the eyes), its top inside the view', () => {
    const elev = (y, o) => deg(Math.atan2(-y, horiz(o)));
    expect(elev(bottom, EV_OFFSET) - elev(helpTop, HELP_OFFSET)).toBeGreaterThanOrEqual(3);
    expect(elev(bottom, EV_OFFSET)).toBeLessThanOrEqual(3); // close above it, not far up
    expect(elev(top, EV_OFFSET)).toBeLessThanOrEqual(30);
  });
  it('clear of the volume (centre) and the menu (left)', () => {
    expect(yaw(EV_OFFSET) - deg(Math.atan(EV_WIDTH / 2 / horiz(EV_OFFSET)))).toBeGreaterThan(20); // inner edge: the volume is within about 15 deg
    expect(EV_OFFSET.left).toBeLessThan(0); expect(MENU_OFFSET.left).toBeGreaterThan(0);
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
describe('slice fill (slice tab row + shader guards, static)', () => {
  const v = readFileSync('docs/vr-view.js', 'utf8'), MENU_H = 1180, y0 = 270;
  it('the fill row sits below the air-floor slider (y0+520..+592) and its help line (y0+618, centred, 24 px), inside the menu', () => {
    expect(v).toContain('choice(y0+650,L.ctSh,');
    expect(v).toContain('btn(800,y0+520,70,'); expect(v).toContain('label(X,y0+618,L.airHelp');
    expect(y0 + 650).toBeGreaterThan(y0 + 520 + 72); expect(y0 + 650).toBeGreaterThan(y0 + 618 + 12); expect(y0 + 618 - 12).toBeGreaterThan(y0 + 520 + 72); expect(y0 + 650 + 72).toBeLessThanOrEqual(MENU_H);
  });
  it('the 濃淡の明るさ slider (+ − buttons) is the row right below the fill row, overlaps nothing, and ends inside the menu', () => {
    expect(v).toContain("label(X,y0+770,L.ctBr)"); expect(v).toContain("type:'slider',x:CX+26,y:y0+734,w:300,h:72,value:(b-CT_BRIGHT_MIN)/(CT_BRIGHT_MAX-CT_BRIGHT_MIN),text:Math.round(b*100)+'%'");
    expect(v).toContain('btn(800,y0+734,70,'); expect(v).toContain('btn(890,y0+734,70,');
    expect(y0 + 734).toBeGreaterThanOrEqual(y0 + 650 + 72); expect(y0 + 734 + 72).toBeLessThanOrEqual(MENU_H); expect(y0 + 770).toBe(y0 + 734 + 36); // label centred on the slider like the others
    expect(v).toContain("ctBr:'濃淡の明るさ'"); expect(v).toContain("ctBr:'Shading brightness'");
    // the other slice-tab rows end above the fill row (their y0 offsets: opacity 44, tint 126, centre 216, width 298, presets 390, air 520)
    for (const y of [44, 126, 216, 298, 390, 520]) expect(y + 72).toBeLessThanOrEqual(650);
  });
  it('the 濃淡のコントラスト slider (+ − buttons) is the row right below 濃淡の明るさ and ends inside the menu; the packed slice-tab rows do not overlap', () => {
    expect(v).toContain("label(X,y0+854,L.ctCo)"); expect(v).toContain("type:'slider',x:CX+26,y:y0+818,w:300,h:72,value:(c-CT_CONTRAST_MIN)/(CT_CONTRAST_MAX-CT_CONTRAST_MIN),text:Math.round(c*100)+'%'");
    expect(v).toContain('btn(800,y0+818,70,'); expect(v).toContain('btn(890,y0+818,70,');
    expect(y0 + 818).toBeGreaterThanOrEqual(y0 + 734 + 72); expect(y0 + 818 + 72).toBeLessThanOrEqual(MENU_H); expect(y0 + 854).toBe(y0 + 818 + 36);
    expect(v).toContain("ctCo:'濃淡のコントラスト'"); expect(v).toContain("ctCo:'Shading contrast'");
    expect(v.indexOf('label(X,y0+854,L.ctCo)')).toBeGreaterThan(v.indexOf('label(X,y0+770,L.ctBr)'));
    // 72-px rows (top offsets) and centred help labels (centre, 24 px): opacity, tint, centre, width, presets, [window help 490], air, [air help 618], fill, brightness, contrast
    expect(v).toContain('label(X,y0+490,L.winHelp,'); expect(v).toContain('btn(X+i*244,y0+390,232,'); expect(v).toContain("row(y0+216,L.wcL,'c',cMin,cMax);row(y0+298,L.wwL,'w',1,wMax);");
    const rows = [[44, 116], [126, 198], [216, 288], [298, 370], [390, 462], [478, 502], [520, 592], [606, 630], [650, 722], [734, 806], [818, 890]];
    for (let i = 1; i < rows.length; i++) expect(rows[i][0]).toBeGreaterThan(rows[i - 1][1]);
    expect(y0 + 10 + 13).toBeLessThan(y0 + 44); // the window heading line above the first row
  });
  it('ctShadeBright: 50..200 % in 10 % steps, default 180 %, a menu preference like ctShade (not an event view value, no URL parameter); the setting is clamped before it reaches the shader', () => {
    expect(v).toContain('labelHide:LABEL_HIDE_DEFAULT,ctShade:1,ctShadeBright:1.8,'); // ctShadeContrast follows
    expect(v).toContain('const CT_BRIGHT_MIN=0.5,CT_BRIGHT_MAX=2,CT_BRIGHT_STEP=0.1,ctBrightOf=v=>{v=+v;return Number.isFinite(v)?Math.min(CT_BRIGHT_MAX,Math.max(CT_BRIGHT_MIN,Math.round(v*10)/10)):DEFAULTS.ctShadeBright};');
    expect(v).toContain('ctShadeBright:{value:1.8}'); expect(v).toContain('u.ctShadeBright.value=ctBrightOf(settings.ctShadeBright);');
    expect(v).toContain("const EVENT_VIEW_KEYS=['cut','cap','sliceAir','sliceTint','sliceOpacity','labelSize'];");
    expect(v).not.toMatch(/URLSearchParams[^;]*ctShadeBright|get\('ctShadeBright'\)/);
  });
  it('ctShadeContrast: 50..200 % in 10 % steps, default 170 %, a menu preference like ctShadeBright (not an event view value, no URL parameter); clamped before the shader', () => {
    expect(v).toContain('ctShade:1,ctShadeBright:1.8,ctShadeContrast:1.7,laserStyle:1}');
    expect(v).toContain('const CT_CONTRAST_MIN=0.5,CT_CONTRAST_MAX=2,CT_CONTRAST_STEP=0.1,ctContrastOf=v=>{v=+v;return Number.isFinite(v)?Math.min(CT_CONTRAST_MAX,Math.max(CT_CONTRAST_MIN,Math.round(v*10)/10)):DEFAULTS.ctShadeContrast};');
    expect(v).toContain('ctShadeContrast:{value:1.7}'); expect(v).toContain('u.ctShadeContrast.value=ctContrastOf(settings.ctShadeContrast);');
    expect(v).toContain("const EVENT_VIEW_KEYS=['cut','cap','sliceAir','sliceTint','sliceOpacity','labelSize'];");
    expect(v).not.toMatch(/URLSearchParams[^;]*ctShadeContrast|get\('ctShadeContrast'\)/);
  });
  it('shader: the contrast spreads the gamma value about the middle of its range, clamped to 0.05..1; exactly 1 returns the gamma value unchanged; only inside ctLumHU', () => {
    expect(v).toContain('uniform float ctShadeContrast;');
    expect(v).toContain(' float g=1.0/max(ctShadeBright,0.1),l=pow(mix(CT_SHADE_MIN,1.0,clamp((hu-a.x)/max(min(a.y-a.x,CT_SHADE_SPAN),1.0),0.0,1.0)),g);');
    expect(v).toContain(' if(ctShadeContrast==1.0)return l;'); expect(v).toContain(' float p=0.5*(pow(CT_SHADE_MIN,g)+1.0);return clamp(p+(l-p)*ctShadeContrast,0.05,1.0);');
    const sh = v.slice(0, v.indexOf('bool editAllows(')); expect(sh.match(/ctShadeContrast/g).length).toBe(5); // the comment above ctLumHU, the uniform and its comment, and the two uses in ctLumHU
    const lum = (t, b, c) => { const g = 1 / b, l = Math.pow(0.35 + 0.65 * t, g); if (c === 1) return l; const p = 0.5 * (Math.pow(0.35, g) + 1); return Math.min(1, Math.max(0.05, p + (l - p) * c)); };
    for (const b of [0.5, 1, 1.3, 2]) for (let i = 0; i <= 10; i++) { const t = i / 10; expect(lum(t, b, 1)).toBe(Math.pow(0.35 + 0.65 * t, 1 / b)); }
    for (const b of [1, 1.3, 2]) { const span = c => lum(1, b, c) - lum(0, b, c); expect(span(1.5)).toBeGreaterThan(span(1)); expect(span(2)).toBeGreaterThan(span(1.5)); expect(span(0.5)).toBeLessThan(span(1)); }
    for (const c of [0.5, 1.5, 2]) for (let i = 1; i <= 10; i++) expect(lum(i / 10, 1.3, c)).toBeGreaterThanOrEqual(lum((i - 1) / 10, 1.3, c)); // the order of the shading is kept
    for (const c of [0.5, 1.5, 2]) for (let i = 0; i <= 10; i++) { const x = lum(i / 10, 2, c); expect(x).toBeGreaterThanOrEqual(0.05); expect(x).toBeLessThanOrEqual(1); }
  });
  it('shader: the brightness is a gamma on the CT factor (pow(lum,1/b)): 1 at the top whatever b is, identity at 100 %, only inside ctLumHU (so only CT shading uses it)', () => {
    expect(v).toContain('uniform float ctShadeBright;'); expect(v.match(/ctShadeBright/g).length).toBeGreaterThanOrEqual(2);
    expect(v).toContain(' float g=1.0/max(ctShadeBright,0.1),l=pow(mix(CT_SHADE_MIN,1.0,clamp((hu-a.x)/max(min(a.y-a.x,CT_SHADE_SPAN),1.0),0.0,1.0)),g);'); // the gamma value l (the contrast step after it returns l itself at 100 %)
    const lum = (t, b) => Math.pow(0.35 + 0.65 * t, 1 / b); // the same formula in JS
    for (const b of [0.5, 1, 1.3, 2]) { expect(lum(1, b)).toBe(1); expect(lum(0, b)).toBeGreaterThan(0); }
    for (let i = 0; i <= 9; i++) { const t = i / 10; expect(lum(t, 1)).toBeCloseTo(0.35 + 0.65 * t, 12); expect(lum(t, 1.3)).toBeGreaterThan(lum(t, 1)); expect(lum(t, 2)).toBeGreaterThan(lum(t, 1.3)); expect(lum(t, 1.3)).toBeLessThanOrEqual(1); }
    for (let i = 1; i <= 10; i++) expect(lum(i / 10, 1.3)).toBeGreaterThan(lum((i - 1) / 10, 1.3)); // still monotone: the shading keeps its order
  });
  it('the label and the two options are short (ja / en); the default is CT shading', () => {
    expect(v).toContain("ctSh:'スライスの塗り',ctShV:['単色','CT濃淡']"); expect(v).toContain("ctSh:'Slice fill',ctShV:['Solid','CT shading']");
    expect(v).toContain('labelHide:LABEL_HIDE_DEFAULT,ctShade:1,'); expect(v).toContain('ctShade:{value:1}'); expect(v).toContain('sliceSegOnly:{value:0}');
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
    expect(v).toContain('sliceDrawState({on:section.on&&!bench.noSection&&sliceReady(),clear:ui.sliceClear,opacity:settings.sliceOpacity,tint:settings.sliceTint,ctShade:settings.ctShade})');
    expect(v).toContain('u.sliceSegOnly.value=d.segOnly;u.sliceOpacity.value=d.opacity');
    const i0 = v.indexOf('u.sliceOpacity.value=section.on&&!bench.noSection&&!ui.sliceClear&&sliceReady()?settings.sliceOpacity:0;'), i1 = v.indexOf('const d=sliceDrawState(');
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
