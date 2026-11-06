import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SHADE_BRIGHT_DEFAULT, SHADE_CONTRAST_DEFAULT, SHADE_FLOOR, shadeLumT, brightOf, contrastOf } from '../../docs/cap-shade.js';
import { volumeShader } from '../../docs/medical-volume.js';

// the cut-face shading (segment colour x brightness from the data value) reads the value through the SAME window as the slice image, for every kind of data.
const vr = readFileSync('docs/vr-view.js', 'utf8'), mv = readFileSync('docs/medical-volume.js', 'utf8'), app = readFileSync('docs/app.js', 'utf8'), ov = readFileSync('docs/mpr3d-overlay.js', 'utf8');
const shell = readFileSync('docs/ui-shell.js', 'utf8'), i18n = readFileSync('docs/i18n.js', 'utf8'), state = readFileSync('docs/state.js', 'utf8'), pure = readFileSync('docs/cap-shade.js', 'utf8');
const sectionShade = readFileSync('docs/section-shade.js', 'utf8'), sectionView = readFileSync('docs/section-view.js', 'utf8'), mprRender = readFileSync('docs/mpr-render.js', 'utf8');
// the window position of a value and the factor of a data value under the slice image's window (the reference the shaders are compared with)
const windowT = (value, center, width) => Math.min(1, Math.max(0, (value - (center - 0.5 * Math.max(width, 1e-3))) / Math.max(width, 1e-3)));
const shadeLum = (value, win, bright = 1.8, contrast = 1.7) => shadeLumT(windowT(value, win.center, win.width), bright, contrast);

describe('the shared maths (docs/cap-shade.js)', () => {
  it('the defaults are the VR ones: brightness 1.8, contrast 1.7, the darkest level fixed at 0.35', () => {
    expect([SHADE_BRIGHT_DEFAULT, SHADE_CONTRAST_DEFAULT, SHADE_FLOOR]).toEqual([1.8, 1.7, 0.35]);
    expect(vr).toContain('ctShadeBright:1.8,ctShadeContrast:1.7,laserStyle:2}');
  });
  it('the position in the window: below the low end 0 (darkest), above the high end 1 (brightest), linear between', () => {
    expect(windowT(-1000, 40, 400)).toBe(0); expect(windowT(-160, 40, 400)).toBe(0); expect(windowT(240, 40, 400)).toBe(1); expect(windowT(5000, 40, 400)).toBe(1);
    expect(windowT(40, 40, 400)).toBeCloseTo(0.5, 12); expect(windowT(90, 40, 400)).toBeCloseTo(0.625, 12);
  });
  it('the shading uses the slice window (lo / hi): outside it the factor is flat darkest / brightest, inside it rises, and moving the window moves the shading', () => {
    const w = { center: 100, width: 200 }; // lo 0, hi 200
    const dark = shadeLum(0, w), bright = shadeLum(200, w);
    expect(shadeLum(-500, w)).toBe(dark); expect(shadeLum(-1, w)).toBe(dark); expect(shadeLum(201, w)).toBe(bright); expect(shadeLum(9000, w)).toBe(bright);
    expect(bright).toBe(1); expect(dark).toBeGreaterThan(0.05); expect(dark).toBeLessThan(0.6);
    let prev = -1; for (let hu = 0; hu <= 200; hu += 10) { const l = shadeLum(hu, w); expect(l).toBeGreaterThanOrEqual(prev); prev = l; }
    expect(shadeLum(150, { center: 100, width: 200 })).toBeGreaterThan(shadeLum(150, { center: 300, width: 400 })); // the same value under another window shades differently (live window)
  });
  it('the same for CT and MRI-like data: the factor depends on the position in the window only (no data-type test, no per-segment range)', () => {
    const ct = { center: 40, width: 400 }, mri = { center: 450, width: 900 }; // HU-like and an MRI-like unsigned scale
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const a = shadeLum(ct.center - ct.width / 2 + t * ct.width, ct), b = shadeLum(mri.center - mri.width / 2 + t * mri.width, mri);
      expect(a).toBeCloseTo(b, 12); expect(a).toBeCloseTo(shadeLumT(t), 12);
    }
    expect(shadeLum(0, mri)).toBeLessThan(shadeLum(450, mri)); expect(shadeLum(450, mri)).toBeLessThan(shadeLum(900, mri)); // the factor spans the whole range over the window
    expect(/modality|isCt|percentile|autoShade|huLike|CT_SHADE_SPAN/.test(pure)).toBe(false);
  });
  it('the darkest level is fixed at 0.35: t = 0 gives 0.35^(1/b) (contrast 1); brightness and contrast keep the formulas', () => {
    expect(shadeLumT(0, 1, 1)).toBeCloseTo(0.35, 12); expect(shadeLumT(0, 1.8, 1)).toBeCloseTo(Math.pow(0.35, 1 / 1.8), 12); expect(shadeLumT(1, 1.8, 1.7)).toBe(1);
    const old = (t, b, c) => { const g = 1 / b, l = Math.pow(0.35 + 0.65 * t, g); if (c === 1) return l; const p = 0.5 * (Math.pow(0.35, g) + 1); return Math.min(1, Math.max(0.05, p + (l - p) * c)); };
    for (const b of [0.5, 1, 1.8, 2]) for (const c of [0.5, 1, 1.7, 2]) for (let i = 0; i <= 10; i++) expect(shadeLumT(i / 10, b, c)).toBeCloseTo(old(i / 10, b, c), 12);
  });
  it('the setting helpers clamp brightness / contrast to 50..200 % in 10 % steps (default when unset)', () => {
    expect(brightOf(undefined)).toBe(1.8); expect(brightOf(9)).toBe(2); expect(brightOf(0)).toBe(0.5); expect(contrastOf(undefined)).toBe(1.7); expect(contrastOf(1.26)).toBe(1.3); expect(contrastOf('x')).toBe(1.7);
  });
});

// a GLSL / WGSL function body evaluated as JS (the shared expressions only: let / float, clamp, mix, pow, max)
const shaderFn = (body, vars) => new Function(...Object.keys(vars), 'clamp', 'mix', 'pow', 'max', body)(...Object.values(vars), (x, a, b) => Math.min(b, Math.max(a, x)), (a, b, t) => a + (b - a) * t, Math.pow, Math.max);
const between = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b, s.indexOf(a) + a.length));

describe('VR / AR shader (vr-view.js ctLumHU): the slice window, no per-segment range', () => {
  const lumFn = between(vr, 'float ctLumHU(float hu,int s){\n', '\n}\n// shading of the tint');
  const tintFn = between(vr, 'float ctLumTint(float hu,int s){\n', '\n}\nbool editAllows');
  it('the factor is read through sliceWindow (the same uniform as the slice image grey) and the fixed floor CT_SHADE_MIN; no segment min / max, no CT_SHADE_SPAN', () => {
    expect(lumFn).toContain('float t=clamp((hu-(sliceWindow.x-0.5*sliceWindow.y))/max(sliceWindow.y,1e-3),0.0,1.0);');
    expect(lumFn).toContain('pow(mix(CT_SHADE_MIN,1.0,t),g)'); expect(lumFn).not.toMatch(/segA|a\.x|a\.y|CT_SHADE_SPAN/); expect(vr).toContain('#define CT_SHADE_MIN 0.35');
    expect(vr).toContain('float g=clamp((hu-(sliceWindow.x-0.5*sliceWindow.y))/max(sliceWindow.y,1e-3),0.0,1.0);'); // the slice image grey uses the very same window expression
    expect(lumFn).not.toMatch(/ctLike|isCt|modality/i);
  });
  it('only the slice-hidden branch (0 % opacity) uses it; the tint over the visible slice image keeps the formula (the segment range, CT_SHADE_SPAN) in its own function', () => {
    expect(vr).toContain('vec4(regionColor(p,segC[si].rgb,si)*ctLumHU(hu,si),ctShade>0.5?SEG_ALPHA:sliceTint)');
    expect(vr).toContain('regionColor(p,segC[si].rgb,si)*ctLumTint(hu,si),sliceTint),a)');
    expect(tintFn).toContain('l=pow(mix(CT_SHADE_MIN,1.0,clamp((hu-a.x)/max(min(a.y-a.x,CT_SHADE_SPAN),1.0),0.0,1.0)),g);'); expect(vr).toContain('#define CT_SHADE_SPAN 1500.0');
  });
  it('the host sets sliceWindow from the menu window every frame (live); there is no floor setting any more', () => {
    expect(vr).toContain('u.sliceWindow.value.set(vrWindow.c,Math.max(1,vrWindow.w));'); expect(vr).not.toMatch(/ctShadeFloor|ctFloorOf|CT_FLOOR/);
  });
  it('the GLSL maths equals cap-shade.js for CT and MRI-like windows, brightness and contrast', () => {
    const body = lumFn.replace(/\bfloat /g, 'let ').replace(/sliceWindow\./g, 'sliceWindow_').replace(/^ if\(ctShade<0\.5[^\n]*\n/, '').replace('CT_SHADE_MIN', '0.35').replace('CT_SHADE_MIN', '0.35');
    for (const win of [{ center: 40, width: 400 }, { center: 450, width: 900 }, { center: -600, width: 1500 }]) for (const [bright, contrast] of [[1.8, 1.7], [1, 1], [1.3, 1], [2, 2], [0.5, 0.5]]) for (let i = -2; i <= 12; i++) {
      const hu = win.center - win.width / 2 + (i / 10) * win.width;
      const got = shaderFn(body, { hu, sliceWindow_x: win.center, sliceWindow_y: win.width, ctShadeBright: bright, ctShadeContrast: contrast });
      expect(got).toBeCloseTo(shadeLum(hu, win, bright, contrast), 5);
    }
  });
});

describe('browser GPU volume shader (medical-volume.js): the cut face with the slice image hidden', () => {
  const wgsl = volumeShader();
  it('capShadeLum reads the value through mprWindow (the slice image window); the SEGMENT colour is multiplied by it before an analysis result replaces it (results are not shaded)', () => {
    expect(wgsl).toContain('capShade:vec4<f32>'); expect(wgsl).toContain('if(u.capShade.x>0.5){capColor*=capShadeLum(huAt(ctc));}');
    const i = wgsl.indexOf('capColor*=capShadeLum(huAt(ctc))');
    expect(i).toBeGreaterThan(wgsl.indexOf('var capColor=mix(u.segments[')); expect(i).toBeLessThan(wgsl.indexOf('analysisOverlayAt(ctc)')); expect(i).toBeLessThan(wgsl.indexOf('if(u.sectionCap.z>0.5){')); // segment colour -> shade -> result colour -> hatching
    expect(wgsl).toContain('let sww=max(u.mprWindow.y,0.001);let t=clamp((hv-(u.mprWindow.x-sww*0.5))/sww,0.0,1.0);');
    expect(wgsl).toContain('let planePoint=u.camOrigin.xyz+dir*pt;let planeValue=huAt(texCoord(planePoint));\n   let ww=max(u.mprWindow.y,1.0);let low=u.mprWindow.x-ww*0.5;'); // the slice image's own window
    expect(wgsl).not.toMatch(/ctLike|isCt|modality/i);
  });
  it('the WGSL maths equals cap-shade.js', () => {
    const body = between(wgsl, 'fn capShadeLum(hv:f32)->f32{\n', '\n}\n// ').replace(/u\.mprWindow\./g, 'mprWindow_').replace(/u\.capShade\./g, 'capShade_');
    for (const win of [{ center: 40, width: 400 }, { center: 450, width: 900 }]) for (const [bright, contrast] of [[1.8, 1.7], [1, 1], [2, 0.5]]) for (let i = -2; i <= 12; i++) {
      const hv = win.center - win.width / 2 + (i / 10) * win.width;
      const got = shaderFn(body, { hv, mprWindow_x: win.center, mprWindow_y: win.width, capShade_x: 1, capShade_y: bright, capShade_z: contrast });
      expect(got).toBeCloseTo(shadeLum(hv, win, bright, contrast), 5);
    }
  });
  it('slot 27 of the uniform buffer carries (on, brightness, contrast): on only while the slice image is hidden, the fill is CT濃淡 and the cap is drawn; the buffer holds it', () => {
    expect(mv).toContain("put(27,sh.on&&section.capEnabled?1:0,brightOf(sh.bright??SHADE_BRIGHT_DEFAULT),contrastOf(sh.contrast??SHADE_CONTRAST_DEFAULT),0)");
    expect(mv).toContain('size:448,usage'); expect(mv).toContain('new Float32Array(112)'); expect(28 * 16).toBe(448);
    expect(app).toContain('hatch:sectionCapHatch,shade:sectionShadeParams()}'); expect(app).toContain('windowCenter:+wc.value,windowWidth:+ww.value'); // the same window as the slice image
    expect(sectionShade).toContain('on: !sectionSliceImageVisible && sectionShadeMode === 1');
  });
});

describe('browser mesh view (mpr3d-overlay.js) and the panel controls', () => {
  it('the mesh cap, slice image hidden and CT濃淡: the segment colour x shadeLumT of the window-mapped grey, only where the cap shows a segment colour (not an analysis result)', () => {
    expect(ov).toContain('if(!sectionSliceImageVisible&&sectionShadeMode===1&&ca&&seg){'); expect(ov).toContain('lum[k]=shadeLumT(k/255,b,k2)'); expect(ov).toContain('if(lum&&seg[i]){const l=lum[g];r*=l;gg*=l;b*=l}');
    expect(ov.indexOf('if(lum&&seg[i])')).toBeLessThan(ov.indexOf('if(sectionCapHatch){'));
    expect(mprRender).toContain('low=+wc.value-(+ww.value)/2,scale=255/Math.max(+ww.value,1)'); // gray = the slice image's window
    expect(mprRender).toContain('if(inside){const rr=layers.length&&resultRgbAt(layers,key,i,ix,iy,iz);c=rr||rgb;isSeg=rr?0:1}'); expect(mprRender).toContain('setSectionCapColors(p,idx,w,h,out,gray,seg)');
  });
  it('the panel has 単色 / CT濃淡 (default CT濃淡, the VR labels) and the sliders 明るさ / コントラスト with the VR defaults 180 / 170 %, texts in ja + en; there is no dark-side slider', () => {
    expect(shell).toContain('<select id="section-shade-mode"><option value="0" data-i18n="shadeSolid">単色</option><option value="1" data-i18n="shadeCt" selected>CT濃淡</option></select>');
    for (const [id, key, mn, mx, st, val] of [['section-shade-bright', 'shadeBright', 50, 200, 10, 180], ['section-shade-contrast', 'shadeContrast', 50, 200, 10, 170]])
      expect(shell).toContain(`<span data-i18n="${key}">`) && expect(shell).toContain(`<output id="${id}-value">${val}%</output><input id="${id}" type="range" min="${mn}" max="${mx}" step="${st}" value="${val}"`);
    expect(i18n).toContain("shadeFill:'スライスの塗り',shadeSolid:'単色',shadeCt:'CT濃淡',shadeBright:'明るさ',shadeContrast:'コントラスト'");
    expect(i18n).toContain("shadeFill:'Slice fill',shadeSolid:'Solid',shadeCt:'CT shading',shadeBright:'Brightness',shadeContrast:'Contrast'"); expect(vr).toContain("ctSh:'スライスの塗り',ctShV:['単色','CT濃淡']"); expect(vr).toContain("ctSh:'Slice fill',ctShV:['Solid','CT shading']");
    expect(i18n).toContain("sectionShade:'断面の濃淡（スライス画像を隠したとき）'"); expect(i18n).toContain("sectionShade:'Cut-face shading (slice image hidden)'");
    expect(state).toContain('export let sectionShadeMode=1;'); expect(state).toContain('export let sectionShadeBright=SHADE_BRIGHT_DEFAULT;'); expect(state).toContain('export let sectionShadeContrast=SHADE_CONTRAST_DEFAULT;');
    expect(shell + i18n + state + sectionShade + app + mv + ov).not.toMatch(/shadeFloor|section-shade-floor|sectionShadeFloor|暗い側の明るさ|Dark-side/);
  });
  it('the three values are saved on this device like VR (localStorage, on release) and restored at start; the controls are wired and enabled only for a hidden slice image', () => {
    expect(sectionShade).toContain("const KEY = 'vrl-section-shade';"); expect(sectionShade).toContain('JSON.stringify({ ctShade: sectionShadeMode, ctShadeBright: brightOf(sectionShadeBright), ctShadeContrast: contrastOf(sectionShadeContrast) })');
    expect(sectionShade).toContain('control.onchange = save;'); expect(sectionShade).toContain('setSectionShadeMode(+sectionShadeModeControl.value === 0 ? 0 : 1); save();'); expect(sectionShade).toContain('restore();');
    expect(sectionShade).toContain('sectionViewOpen && !!sectionViewPlane && sectionCapEnabled && !sectionSliceImageVisible'); expect(sectionShade).toContain('control.disabled = !enabled || sectionShadeMode !== 1');
    expect(app).toContain('initSectionShadeUi({refresh:()=>{recomposeSectionCaps();request3DRender()}});'); expect(app).toContain('setSectionSliceImageVisible(!!sectionSliceImageControl.checked);syncSectionShadeUi();'); expect(sectionView).toContain('syncSectionShadeUi();');
  });
  it('nothing was added that decides by data type, estimates a range, or loads code dynamically', () => {
    for (const s of [pure, sectionShade]) { expect(/\bimport\s*\(/.test(s)).toBe(false); expect(/percentile|autoShade|huLike|modality/i.test(s)).toBe(false); }
  });
});
