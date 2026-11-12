import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SHADE_BRIGHT_DEFAULT, SHADE_CONTRAST_DEFAULT, SHADE_FLOOR, SHADE_MIN_WIDTH, SHADE_RANGE_STEPS, shadeLumT, shadeT, shadeLumV, brightOf, contrastOf,
  dataRangeOf, shadeRangeStep, initialShadeRange, shadeRangeOf, moveShadeEnd, shadeValueAt, shadePosOf, shadeRangesToProject, shadeRangesFromProject,
} from '../../docs/cap-shade.js';
import { volumeShader } from '../../docs/medical-volume.js';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// the cut-face shading (segment colour x brightness from the data value) reads the value through the SEGMENT's own range (lower, upper), for every kind of data. The slice image's window no longer takes part.
const vr = readFileSync('docs/vr-view.js', 'utf8'), mv = readFileSync('docs/medical-volume.js', 'utf8'), app = readFileSync('docs/app.js', 'utf8'), ov = readFileSync('docs/mpr3d-overlay.js', 'utf8');
const shell = readFileSync('docs/ui-shell.js', 'utf8'), i18n = readFileSync('docs/i18n.js', 'utf8'), state = readFileSync('docs/state.js', 'utf8'), pure = readFileSync('docs/cap-shade.js', 'utf8');
const sectionShade = readFileSync('docs/section-shade.js', 'utf8'), sectionView = readFileSync('docs/section-view.js', 'utf8'), mprRender = readFileSync('docs/mpr-render.js', 'utf8');
const dataLoad = readFileSync('docs/data-load.js', 'utf8'), segmentsSrc = readFileSync('docs/segments.js', 'utf8');
installDomStub();
let S;
beforeAll(async () => { S = await importApp('segments'); });

const CT = dataRangeOf(-1024, 3071), U16 = dataRangeOf(0, 65535);

describe('the shared maths (docs/cap-shade.js)', () => {
  it('the defaults are the VR ones: brightness 1.8, contrast 1.7, the darkest level fixed at 0.35', () => {
    expect([SHADE_BRIGHT_DEFAULT, SHADE_CONTRAST_DEFAULT, SHADE_FLOOR]).toEqual([1.8, 1.7, 0.35]);
    expect(vr).toContain('ctShadeBright:1.8,ctShadeContrast:1.7,laserStyle:2,stickShort:0}');
  });
  it('the position in a range: below the lower end 0 (darkest), above the upper end 1 (brightest), linear between', () => {
    expect(shadeT(-1000, 40, 440)).toBe(0); expect(shadeT(40, 40, 440)).toBe(0); expect(shadeT(440, 40, 440)).toBe(1); expect(shadeT(5000, 40, 440)).toBe(1);
    expect(shadeT(240, 40, 440)).toBeCloseTo(0.5, 12); expect(shadeT(140, 40, 440)).toBeCloseTo(0.25, 12);
  });
  it('a width <= 0 is safe: the minimal width is used (no NaN / Infinity), the factor is a hard step at the lower end', () => {
    expect(SHADE_MIN_WIDTH).toBe(1e-3);
    for (const [lo, hi] of [[100, 100], [100, 50], [100, -5000]]) for (const v of [-1e6, 50, 100, 100.0005, 100.01, 9e9]) {
      const t = shadeT(v, lo, hi); expect(Number.isFinite(t)).toBe(true); expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThanOrEqual(1);
      expect(Number.isFinite(shadeLumV(v, lo, hi))).toBe(true);
    }
    expect(shadeT(99, 100, 100)).toBe(0); expect(shadeT(100.01, 100, 100)).toBe(1);
  });
  it('each segment shades through its own range: the same value gives different factors for different segments, and a narrow soft-tissue range is not flat', () => {
    const soft = { lower: -50, upper: 350 }, bone = { lower: 350, upper: 3071 };
    expect(shadeLumV(100, soft.lower, soft.upper)).not.toBeCloseTo(shadeLumV(100, bone.lower, bone.upper), 3);
    let prev = -1; const seen = new Set();
    for (let hu = soft.lower; hu <= soft.upper; hu += 10) { const l = shadeLumV(hu, soft.lower, soft.upper); expect(l).toBeGreaterThanOrEqual(prev); prev = l; seen.add(l.toFixed(3)); }
    expect(seen.size).toBeGreaterThan(20); // across the soft range the factor really moves (the single shared window made it flat)
    expect(shadeLumV(soft.lower, soft.lower, soft.upper)).toBeLessThan(0.6); expect(shadeLumV(soft.upper, soft.lower, soft.upper)).toBe(1);
  });
  it('the same for CT and MRI-like data: the factor depends only on the position in the range (no data-type test, no fixed numbers)', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const a = shadeLumV(-50 + t * 400, -50, 350), b = shadeLumV(300 + t * 900, 300, 1200);
      expect(a).toBeCloseTo(b, 12); expect(a).toBeCloseTo(shadeLumT(t), 12);
    }
    expect(/modality|isCt|huLike|CT_SHADE_SPAN|1500/.test(pure)).toBe(false); // the auto range is a percentile of the segment's own values (tests/unit/cap-shade-auto.test.js), still no data-type test
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

describe('the range of a segment: initial value, follow / touch / reset', () => {
  it('initial = the segment min..max cut to the data (an open-ended bone ends at the data top, a low end below the data starts at the data bottom); no fixed numbers', () => {
    expect(initialShadeRange(350, 3071, CT)).toEqual({ lower: 350, upper: 3071 });
    expect(initialShadeRange(698, 61535, CT)).toEqual({ lower: 698, upper: 3071 }); // 61535 is beyond the data's actual maximum
    expect(initialShadeRange(698, 61535, dataRangeOf(0, 52000))).toEqual({ lower: 698, upper: 52000 });
    expect(initialShadeRange(-5000, -50, CT)).toEqual({ lower: -1024, upper: -50 }); // the lower end clipped at the data's actual minimum
    expect(initialShadeRange(-50, 350, CT)).toEqual({ lower: -50, upper: 350 });
    expect(initialShadeRange(5000, 6000, CT)).toEqual({ lower: 3071, upper: 3071 }); // a segment wholly above the data: a zero width (safe, see above)
    expect(initialShadeRange(10, 20, null)).toEqual({ lower: 10, upper: 20 }); // no data yet: the segment's own values
    expect(initialShadeRange(NaN, 20, CT)).toEqual({ lower: -1024, upper: 3071 });
    expect(dataRangeOf('a', 3)).toBe(null); expect(dataRangeOf(5, 1)).toEqual({ min: 1, max: 5 });
  });
  it('without an auto value an untouched range follows the segment min / max when they change (the initial value); a touched (manual) one stays at the user values; resetting follows again', () => {
    let touched; // what segments.js keeps per segment
    const range = (a, b) => shadeRangeOf(touched, a, b, CT);
    expect(range(-50, 350)).toEqual({ lower: -50, upper: 350, touched: false });
    expect(range(0, 300)).toEqual({ lower: 0, upper: 300, touched: false }); // the segment sliders moved: it follows
    touched = moveShadeEnd(range(0, 300), 'lower', 120, CT); // the user moves the lower slider: both ends are kept
    expect(touched).toEqual({ lower: 120, upper: 300 });
    expect(range(-50, 350)).toEqual({ lower: 120, upper: 300, touched: true }); // the segment changed: the user's values stay
    touched = undefined; // reset
    expect(range(-50, 350)).toEqual({ lower: -50, upper: 350, touched: false });
  });
  it('the real state (segments.js): touch, follow, stay and reset per segment (no auto value yet); a segment moves with its userMin / userMax (the sliders)', () => {
    const s = S.segmentState; S.clearSegmentShadeRanges(); S.clearSegmentShadeAuto();
    for (const k of ['bone', 'soft']) Object.assign(s[k], { min: 0, max: 1, userMin: undefined, userMax: undefined });
    s.soft.userMin = -50; s.soft.userMax = 350; s.bone.userMin = 698; s.bone.userMax = 61535;
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: -50, upper: 350, touched: false });
    expect(S.segmentShadeRange('bone', CT)).toMatchObject({ lower: 698, upper: 3071, touched: false });
    s.soft.userMin = 0; s.soft.userMax = 400; // follows
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: 0, upper: 400, touched: false });
    expect(S.setSegmentShadeEnd('soft', 'upper', 250, CT)).toMatchObject({ lower: 0, upper: 250, touched: true });
    s.soft.userMin = -50; s.soft.userMax = 350; // the segment moved: the touched segment stays
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: 0, upper: 250, touched: true });
    expect(S.segmentShadeRange('bone', CT).touched).toBe(false); // the other segment is independent
    S.resetSegmentShadeRange('soft');
    expect(S.segmentShadeRange('soft', CT)).toMatchObject({ lower: -50, upper: 350, touched: false });
    S.setSegmentShadeEnd('bone', 'lower', 900, CT); S.clearSegmentShadeRanges(); // a new dataset: everything follows again
    expect(Object.keys(S.segmentShadeRanges)).toEqual([]);
    expect(dataLoad).toContain('clearSegmentShadeRanges(); // another dataset');
  });
  it('the segment min / max the range starts from are the slider values (userMin / userMax, else min / max), as the project saves them', () => {
    expect(segmentsSrc).toContain('shadeRangeOf(segmentShadeRanges[key],s?.userMin??s?.min,s?.userMax??s?.max,data,segmentShadeAuto[key])');
    expect(dataLoad).toContain('min:g.userMin??g.min,max:g.userMax??g.max');
  });
});

describe('the sliders: limits, step, lower cannot pass upper', () => {
  it('the slider runs over the data range (actual min..max) in 200 steps; the values on the grid are raw data values', () => {
    expect(SHADE_RANGE_STEPS).toBe(200); expect(shadeRangeStep(CT)).toBeCloseTo(4095 / 200, 12); expect(shadeRangeStep(U16)).toBeCloseTo(65535 / 200, 12);
    expect(shadeValueAt(0, CT)).toBe(-1024); expect(shadeValueAt(1, CT)).toBeCloseTo(3071, 9); expect(shadeValueAt(0.5, CT)).toBeCloseTo(-1024 + 100 * (4095 / 200), 9);
    expect(shadeValueAt(0.5004, CT)).toBeCloseTo(shadeValueAt(0.5, CT), 9); // snapped to the grid
    expect(shadePosOf(-1024, CT)).toBe(0); expect(shadePosOf(3071, CT)).toBe(1); expect(shadePosOf(99999, CT)).toBe(1); expect(shadePosOf(5, null)).toBe(0);
    for (let k = 0; k <= 200; k += 25) expect(shadePosOf(shadeValueAt(k / 200, CT), CT)).toBeCloseTo(k / 200, 12);
  });
  it('lower stops at upper and upper stops at lower; both stay inside the data range', () => {
    const r = { lower: 100, upper: 300 };
    expect(moveShadeEnd(r, 'lower', 250, CT)).toEqual({ lower: 250, upper: 300 });
    expect(moveShadeEnd(r, 'lower', 900, CT)).toEqual({ lower: 300, upper: 300 }); // stops at the upper end
    expect(moveShadeEnd(r, 'upper', -500, CT)).toEqual({ lower: 100, upper: 100 }); // stops at the lower end
    expect(moveShadeEnd(r, 'upper', 99999, CT)).toEqual({ lower: 100, upper: 3071 }); expect(moveShadeEnd(r, 'lower', -99999, CT)).toEqual({ lower: -1024, upper: 300 });
    expect(moveShadeEnd(r, 'lower', NaN, CT)).toEqual(r);
  });
  it('a touched range read back is cut to the data and ordered', () => {
    expect(shadeRangeOf({ lower: -9999, upper: 9999 }, 0, 1, CT)).toEqual({ lower: -1024, upper: 3071, touched: true });
    expect(shadeRangeOf({ lower: 300, upper: 100 }, 0, 1, CT)).toMatchObject({ lower: 100, upper: 300 });
  });
});

describe('project file: only the touched ranges are saved; an old file loads', () => {
  it('writes {key: {min, max}} of the touched segments only; nothing touched = an empty field', () => {
    expect(shadeRangesToProject({ soft: { lower: 0, upper: 250 } })).toEqual({ soft: { min: 0, max: 250 } });
    expect(shadeRangesToProject({})).toEqual({}); expect(shadeRangesToProject(undefined)).toEqual({}); expect(shadeRangesToProject({ bone: { lower: NaN, upper: 1 } })).toEqual({});
  });
  it('reads it back; an old file without the field (or a broken one) gives nothing touched', () => {
    const keys = ['bone', 'soft', 'fat', 'lung', 'contrast'];
    expect(shadeRangesFromProject({ soft: { min: 0, max: 250 }, fat: { min: 9, max: 3 }, x: { min: 1, max: 2 } }, keys)).toEqual({ soft: { lower: 0, upper: 250 }, fat: { lower: 3, upper: 9 } });
    for (const old of [undefined, null, 5, 'x', {}, { soft: null }, { soft: { min: 'a', max: 2 } }, { soft: { min: null, max: 2 } }]) expect(shadeRangesFromProject(old, keys)).toEqual({});
    const rt = shadeRangesFromProject(JSON.parse(JSON.stringify(shadeRangesToProject({ bone: { lower: 700, upper: 2500.5 } }))), keys);
    expect(rt).toEqual({ bone: { lower: 700, upper: 2500.5 } });
  });
  it('gatherProject writes the field only when something is touched; applyProject replaces the ranges (an old project: all follow); a new dataset clears them', () => {
    expect(dataLoad).toContain('{const sr=shadeRangesToProject(segmentShadeRanges);if(Object.keys(sr).length)project.shadeRanges=sr}');
    expect(dataLoad).toContain('clearSegmentShadeRanges();Object.assign(segmentShadeRanges,shadeRangesFromProject(project.shadeRanges,SEGMENT_PRESET_ORDER));');
    expect(dataLoad.indexOf('Object.assign(segmentShadeRanges,shadeRangesFromProject')).toBeGreaterThan(dataLoad.indexOf('commitExclusiveRanges();for(const key of SEGMENT_PRESET_ORDER)updateSegmentOutputs(key);'));
  });
  it('brightness and contrast stay device settings (not in the project)', () => {
    expect(dataLoad).not.toMatch(/ctShadeBright|ctShadeContrast|sectionShadeBright|sectionShadeContrast/);
  });
});

// a GLSL / WGSL function body evaluated as JS (the shared expressions only: let / float, clamp, mix, pow, max)
const shaderFn = (body, vars) => new Function(...Object.keys(vars), 'clamp', 'mix', 'pow', 'max', body)(...Object.values(vars), (x, a, b) => Math.min(b, Math.max(a, x)), (a, b, t) => a + (b - a) * t, Math.pow, Math.max);
const between = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b, s.indexOf(a) + a.length));
const RANGES = [{ lower: -50, upper: 350 }, { lower: 350, upper: 3071 }, { lower: 100, upper: 100 }, { lower: 300, upper: -20 }, { lower: 0, upper: 1500 }];

describe('VR / AR shader (vr-view.js ctLumHU): the segment slot\'s own range, no slice window', () => {
  const lumFn = between(vr, 'float ctLumHU(float hu,int s){\n', '\n}\nbool editAllows');
  it('the factor is read through ctShadeRange[s] and the fixed floor CT_SHADE_MIN; no sliceWindow, no segment min / max, no fixed span', () => {
    expect(vr).toContain('uniform vec2 ctShadeRange[4];');
    expect(lumFn).toContain('vec2 rg=ctShadeRange[s];float t=clamp((hu-rg.x)/max(rg.y-rg.x,1e-3),0.0,1.0);');
    expect(lumFn).toContain('pow(mix(CT_SHADE_MIN,1.0,t),g)'); expect(lumFn).not.toMatch(/segA|a\.x|a\.y|CT_SHADE_SPAN|sliceWindow/); expect(vr).toContain('#define CT_SHADE_MIN 0.35');
    expect(lumFn).not.toMatch(/ctLike|isCt|modality/i);
  });
  it('both slice branches (0 % opacity and the tint over the visible slice image) use the SAME ctLumHU: no separate tint formula, no fixed span (the old ctLumTint / CT_SHADE_SPAN 1500 is gone)', () => {
    expect(vr).toContain('vec4(regionColor(p,segC[si].rgb,si)*ctLumHU(hu,si),ctShade>0.5?SEG_ALPHA:sliceTint)');
    expect(vr).toContain('regionColor(p,segC[si].rgb,si)*ctLumHU(hu,si),sliceTint),a)');
    expect(vr.match(/ctLumHU\(/g)).toHaveLength(5); // the definition + the two branches + the same two in sliceColorR, the copy for a session with results whose hidden results get no fill / tint (compiled only with VRL_REGIONS and no child segment)
    expect(vr).not.toMatch(/ctLumTint|CT_SHADE_SPAN|1500\.0/);
  });
  it('the tint path reads the value through the per-segment range like cap-shade.js: the same GLSL function, so the factor for any value / range equals shadeLumV; a segment max open-ended (bone up to 61535) no longer matters', () => {
    const body = lumFn.replace(/\bfloat /g, 'let ').replace(/vec2 rg=ctShadeRange\[s\];/, 'let rg={x:ctShadeRange[s][0],y:ctShadeRange[s][1]};').replace(/^ if\(ctShade<0\.5[^\n]*\n/, '').replace('CT_SHADE_MIN', '0.35').replace('CT_SHADE_MIN', '0.35');
    // the tint site in sliceColor: the call passes the slot of the segment under the pixel (si), the range of that slot is the segment's own
    const tintSite = between(vr, 'if(sliceTint>0.0){int si=segmentIndexAt(texCoord(p));', ',a);}');
    expect(tintSite).toContain('ctLumHU(hu,si)'); expect(tintSite).not.toMatch(/segA|min\(|1500/);
    // a wide, open-ended segment (bone 698 .. 61535) and a narrow one: the old formula cut the top at min + 1500, the new one follows the range given
    const ctShadeRange = [[698, 61535], [-200, 299], [-250, -50], [0, 1]];
    for (const [s, r] of ctShadeRange.map((a, k) => [k, { lower: a[0], upper: a[1] }])) for (const frac of [0, 0.02, 0.05, 0.25, 0.5, 1]) {
      const hu = r.lower + frac * (r.upper - r.lower);
      const got = shaderFn(body, { hu, s, ctShadeRange, ctShadeBright: 1.8, ctShadeContrast: 1.7 });
      expect(got).toBeCloseTo(shadeLumV(hu, r.lower, r.upper, 1.8, 1.7), 5);
    }
    // 1500 above the bone's min is NOT the top of the tint any more: the factor there is still near the bottom of the range
    expect(shadeLumV(698 + 1500, 698, 61535)).toBeLessThan(shadeLumV(61535, 698, 61535) * 0.6);
  });
  it('the slice image still uses the window (sliceWindow) for its own grey, set every frame; the shading does not', () => {
    expect(vr).toContain('float g=clamp((hu-(sliceWindow.x-0.5*sliceWindow.y))/max(sliceWindow.y,1e-3),0.0,1.0);'); expect(vr).toContain('u.sliceWindow.value.set(vrWindow.c,Math.max(1,vrWindow.w));');
    expect(vr).not.toMatch(/ctShadeFloor|ctFloorOf|CT_FLOOR/);
  });
  it('the GLSL maths equals cap-shade.js for every range (incl. width <= 0), brightness and contrast', () => {
    const body = lumFn.replace(/\bfloat /g, 'let ').replace(/vec2 rg=ctShadeRange\[s\];/, 'let rg={x:ctShadeRange[s][0],y:ctShadeRange[s][1]};').replace(/^ if\(ctShade<0\.5[^\n]*\n/, '').replace('CT_SHADE_MIN', '0.35').replace('CT_SHADE_MIN', '0.35');
    expect(body).toContain('let rg={x:'); expect(body).not.toContain('CT_SHADE_MIN');
    const ctShadeRange = RANGES.map(r => [r.lower, r.upper]);
    for (const [s, r] of RANGES.entries()) for (const [bright, contrast] of [[1.8, 1.7], [1, 1], [1.3, 1], [2, 2], [0.5, 0.5]]) for (let i = -2; i <= 12; i++) {
      const hu = r.lower + (i / 10) * (Math.abs(r.upper - r.lower) || 10);
      const got = shaderFn(body, { hu, s, ctShadeRange, ctShadeBright: bright, ctShadeContrast: contrast });
      expect(got).toBeCloseTo(shadeLumV(hu, r.lower, r.upper, bright, contrast), 5);
    }
  });
  it('the host sets each slot\'s range from segments.js every frame (the segment of the slot, cut to the data); the uniform starts as 0..1', () => {
    expect(vr).toContain('ctShadeRange:{value:[0,1,2,3].map(()=>new THREE.Vector2(0,1))}');
    expect(vr).toContain('{const sr=segmentShadeRange(key,shadeData);u.ctShadeRange.value[i].set(sr.lower,sr.upper)}');
    expect(vr).toContain('const shadeData=shadeDataRange(); // ');
    expect(vr.indexOf('const shadeData=shadeDataRange();')).toBeLessThan(vr.indexOf('u.ctShadeRange.value[i].set(')); expect(vr.indexOf('u.ctShadeRange.value[i].set(')).toBeGreaterThan(vr.indexOf('u.segA.value[i].set(seg?.min||0'));
  });
});

describe('browser GPU volume shader (medical-volume.js): the cut face with the slice image hidden', () => {
  const wgsl = volumeShader();
  it('capShadeLum reads the value through the range of the segment slot (capRange); the SEGMENT colour is multiplied by it before an analysis result replaces it (results are not shaded)', () => {
    expect(wgsl).toContain('capShade:vec4<f32>,\n capRange:array<vec4<f32>,2>\n};'); expect(wgsl).toContain('if(u.capShade.x>0.5){capColor*=capShadeLum(huAt(ctc),capIndex);}');
    const i = wgsl.indexOf('capColor*=capShadeLum(huAt(ctc),capIndex)');
    expect(i).toBeGreaterThan(wgsl.indexOf('var capColor=mix(u.segments[')); expect(i).toBeLessThan(wgsl.indexOf('analysisOverlayAt(ctc)')); expect(i).toBeLessThan(wgsl.indexOf('if(u.sectionCap.z>0.5){')); // segment colour -> shade -> result colour -> hatching
    expect(wgsl).toContain('let t=clamp((hv-lo)/max(hi-lo,0.001),0.0,1.0);'); expect(between(wgsl, 'fn capShadeLum', '\n}\n')).not.toContain('mprWindow');
    expect(wgsl).toContain('let planePoint=u.camOrigin.xyz+dir*pt;let planeValue=huAt(texCoord(planePoint));\n   let ww=max(u.mprWindow.y,1.0);let low=u.mprWindow.x-ww*0.5;'); // the slice image keeps its own window
    expect(wgsl).not.toMatch(/ctLike|isCt|modality/i);
  });
  it('the WGSL maths equals cap-shade.js for each slot (incl. width <= 0)', () => {
    const body = between(wgsl, 'fn capShadeLum(hv:f32,slot:i32)->f32{\n', '\n}\n').replace(/u\.capShade\./g, 'capShade_').replace(/let cr=u\.capRange\[u32\(slot\)\/2u\];let odd=\(u32\(slot\)&1u\)==1u;let lo=select\(cr\.x,cr\.z,odd\);let hi=select\(cr\.y,cr\.w,odd\);/, 'let cr=capRange[slot>>1];let odd=(slot&1)==1;let lo=odd?cr[2]:cr[0];let hi=odd?cr[3]:cr[1];');
    expect(body).toContain('let lo=odd?cr[2]:cr[0];'); // the replacement above matched the real text
    const capRange = [[RANGES[0].lower, RANGES[0].upper, RANGES[1].lower, RANGES[1].upper], [RANGES[2].lower, RANGES[2].upper, RANGES[3].lower, RANGES[3].upper]];
    for (let slot = 0; slot < 4; slot++) for (const [bright, contrast] of [[1.8, 1.7], [1, 1], [2, 0.5]]) for (let i = -2; i <= 12; i++) {
      const r = RANGES[slot], hv = r.lower + (i / 10) * (Math.abs(r.upper - r.lower) || 10);
      const got = shaderFn(body, { hv, slot, capRange, capShade_x: 1, capShade_y: bright, capShade_z: contrast });
      expect(got).toBeCloseTo(shadeLumV(hv, r.lower, r.upper, bright, contrast), 5);
    }
  });
  it('slot 27 = (on, brightness, contrast), slots 28 / 29 = the four segment slots\' (lower, upper) from section.shade.ranges; the buffer holds 30 slots', () => {
    expect(mv).toContain("put(27,sh.on&&section.capEnabled?1:0,brightOf(sh.bright??SHADE_BRIGHT_DEFAULT),contrastOf(sh.contrast??SHADE_CONTRAST_DEFAULT),0)");
    expect(mv).toContain('const rg=s=>{const r=sh.ranges?.[segmentOrder[s]];'); expect(mv).toContain('put(28,...rg(0),...rg(1));put(29,...rg(2),...rg(3))}');
    expect(mv).toContain('size:480,usage'); expect(mv).toContain('new Float32Array(120)'); expect(30 * 16).toBe(480);
    expect(app).toContain('hatch:sectionCapHatch,shade:sectionShadeParams()}'); expect(app).toContain('windowCenter:+wc.value,windowWidth:+ww.value'); // the slice image keeps the page's window
    expect(sectionShade).toMatch(/const sig = currentLanguage \+ '\|' \+ shownShadeSegments/); // the language is in the 400 ms sync signature
    expect(sectionShade).toContain('on: !sectionSliceImageVisible && sectionShadeMode === 1'); expect(sectionShade).toContain('ranges[key] = { lower: r.lower, upper: r.upper }');
  });
});

describe('browser mesh view (mpr3d-overlay.js, mpr-render.js)', () => {
  it('the mesh cap, slice image hidden and CT濃淡: the segment colour x shadeLumV of the pixel\'s value through its segment\'s range, only where the cap shows a segment colour (a preset or a child segment: its own colour and range; not an analysis result)', () => {
    expect(ov).toContain('if(!sectionSliceImageVisible&&sectionShadeMode===1&&ca&&seg&&val){'); expect(ov).toContain('ranges:(keys||[]).map(k=>segmentShadeRange(k,data))'); // the keys of the paint (the presets, then the child segments)
    expect(ov).toContain('if(shade&&seg[i]){const q=shade.ranges[seg[i]-1];if(q){const l=shadeLumV(val[i],q.lower,q.upper,shade.b,shade.k2);r*=l;gg*=l;b*=l}}');
    expect(ov.indexOf('if(shade&&seg[i])')).toBeLessThan(ov.indexOf('if(sectionCapHatch){')); expect(ov).not.toMatch(/lum\[g\]|shadeLumT\(k\/255/);
    expect(ov).toContain('export function setSectionCapColors(p,idx,w,h,pixels,gray,seg,val,keys=null){'); expect(ov).toContain('entry.capColors={w,h,pixels,gray,seg,val,keys};');
    expect(mprRender).toContain('low=+wc.value-(+ww.value)/2,scale=255/Math.max(+ww.value,1)'); // gray = the slice image's window: the slice image keeps it
    expect(mprRender).toContain('val[i]=v;'); expect(mprRender).toContain('c=rr||rgb;isSeg=rr?0:1+SEGMENT_PRESET_ORDER.indexOf(key)}}'); expect(mprRender).toContain('c=rr||rgb;isSeg=rr?0:capIndex.get(key)||0}}'); // no child: the 704 loop; with children: the loop through the keys list expect(mprRender).toContain('setSectionCapColors(p,idx,w,h,out,gray,seg,val,capKeys)');
  });
  it('the mesh view uses the same maths as the GPU volume and VR: per segment, per pixel', () => {
    for (const r of RANGES) for (const v of [-200, 0, 150, 400, 3000]) expect(shadeLumV(v, r.lower, r.upper, 1.8, 1.7)).toBeCloseTo(shadeLumT(shadeT(v, r.lower, r.upper), 1.8, 1.7), 12);
  });
});

describe('browser panel (断面解析): the same set of controls, enabled like 明るさ / コントラスト', () => {
  it('the panel has 単色 / CT濃淡 (default CT濃淡), 明るさ / コントラスト (180 / 170 %) and, below them, 濃淡の範囲: the segment buttons, 下限 / 上限 sliders with − / ＋, 自動に戻す', () => {
    expect(shell).toContain('<select id="section-shade-mode"><option value="0" data-i18n="shadeSolid">単色</option><option value="1" data-i18n="shadeCt" selected>CT濃淡</option></select>');
    for (const [id, key, mn, mx, st, val] of [['section-shade-bright', 'shadeBright', 50, 200, 10, 180], ['section-shade-contrast', 'shadeContrast', 50, 200, 10, 170]])
      expect(shell).toContain(`<span data-i18n="${key}">`) && expect(shell).toContain(`<output id="${id}-value">${val}%</output><input id="${id}" type="range" min="${mn}" max="${mx}" step="${st}" value="${val}"`);
    expect(shell.indexOf('id="section-shade-contrast"')).toBeLessThan(shell.indexOf('data-i18n="shadeRange"'));
    expect(shell).toContain('<div id="section-shade-seg" role="group"');
    for (const k of ['lower', 'upper']) for (const id of [`section-shade-${k}"`, `section-shade-${k}-value"`, `section-shade-${k}-minus" type="button"`, `section-shade-${k}-plus" type="button"`]) expect(shell).toContain(`id="${id}`);
    expect(shell).toContain('<button id="section-shade-reset" type="button" data-i18n="shadeReset">自動に戻す</button>');
    expect(shell).toContain("sectionShadeSegGroup=$('#section-shade-seg')"); expect(shell).toContain("sectionShadeResetButton=$('#section-shade-reset')");
  });
  it('texts in ja + en (VR menu and browser)', () => {
    expect(i18n).toContain("shadeFill:'スライスの塗り',shadeSolid:'単色',shadeCt:'CT濃淡',shadeBright:'明るさ',shadeContrast:'コントラスト',shadeRange:'濃淡の範囲',shadeLower:'下限',shadeUpper:'上限',shadeReset:'自動に戻す',");
    expect(i18n).toContain("shadeFill:'Slice fill',shadeSolid:'Solid',shadeCt:'CT shading',shadeBright:'Brightness',shadeContrast:'Contrast',shadeRange:'Shading range',shadeLower:'Lower',shadeUpper:'Upper',shadeReset:'Back to auto',");
    expect(vr).toContain("ctSh:'スライスの塗り',ctShV:['単色','CT濃淡']"); expect(vr).toContain("ctSh:'Slice fill',ctShV:['Solid','CT shading']");
    expect(vr).toContain("shRange:'濃淡の範囲',shT:'濃淡の範囲'"); expect(vr).toContain("shLower:'下限',shUpper:'上限',shReset:'自動に戻す',shNone:"); expect(vr).toContain("shRange:'Shading range',shT:'Shading range'"); expect(vr).toContain("shLower:'Lower',shUpper:'Upper',shReset:'Back to auto',shNone:");
    expect(i18n).toContain("sectionShade:'断面の濃淡（スライス画像を隠したとき）'"); expect(i18n).toContain("sectionShade:'Cut-face shading (slice image hidden)'");
    expect(state).toContain('export let sectionShadeMode=1;'); expect(state).toContain('export let sectionShadeBright=SHADE_BRIGHT_DEFAULT;'); expect(state).toContain('export let sectionShadeContrast=SHADE_CONTRAST_DEFAULT;');
    expect(shell + i18n + state + sectionShade + app + mv + ov).not.toMatch(/shadeFloor|section-shade-floor|sectionShadeFloor|暗い側の明るさ|Dark-side/);
  });
  it('no menu / help text says the shading shares the slice image\'s window any more', () => {
    expect(vr + i18n).not.toMatch(/(スライス画像|slice image)[^'"]{0,12}(ウィンドウ|window)[^'"]{0,30}(共通|同じ|shared|same)/i);
    expect(vr).not.toMatch(/'[^'\n]*(濃淡|shading)[^'\n]*(ウィンドウと共通|shares the window|follows the window)[^'\n]*'/i);
  });
  it('the three values stay saved on this device like VR (localStorage, on release); the range sliders act on the chosen segment, − / ＋ use value-step.js, 初期値に戻す resets it (back to auto); enabled only while the section is open, the cap is on and the slice image hidden, and with CT濃淡', () => {
    expect(sectionShade).toContain("const KEY = 'vrl-section-shade';"); expect(sectionShade).toContain('JSON.stringify({ ctShade: sectionShadeMode, ctShadeBright: brightOf(sectionShadeBright), ctShadeContrast: contrastOf(sectionShadeContrast) })');
    expect(sectionShade).toContain('control.onchange = save;'); expect(sectionShade).toContain('setSectionShadeMode(+sectionShadeModeControl.value === 0 ? 0 : 1); save();'); expect(sectionShade).toContain('restore();');
    expect(sectionShade).toContain('sectionViewOpen && !!sectionViewPlane && sectionCapEnabled && !sectionSliceImageVisible'); expect(sectionShade).toContain('control.disabled = !enabled || sectionShadeMode !== 1');
    expect(sectionShade).toContain('on = enabled && sectionShadeMode === 1 && !!key && !!data'); expect(sectionShade).toContain('control.disabled = !on'); expect(sectionShade).toContain('sectionShadeResetButton.disabled = !on || !r?.touched');
    expect(sectionShade).toContain('shownSegmentKeys()'); // the segments shown now
    expect(sectionShade).toContain('control.step = String(step || 1)'); expect(sectionShade).toContain('control.min = String(span.min); control.max = String(span.max);'); // the segment's span
    expect(sectionShade).toContain('moveEnd(which, shadeValueAt(shadePosOf(+control.value, d), d))'); expect(sectionShade).toContain('setSegmentShadeEnd(key, which, value); syncSectionShadeUi(); refresh();');
    expect(sectionShade).toContain('wireStepButton(minus, -1, step()); if (plus) wireStepButton(plus, 1, step());'); expect(sectionShade).toContain("stepClamp(which === 'lower' ? r.lower : r.upper, delta, d.min, d.max)");
    expect(sectionShade).toContain('resetSegmentShadeRange(key); syncSectionShadeUi(); refresh();');
    expect(app).toContain('initSectionShadeUi({refresh:()=>{recomposeSectionCaps();request3DRender()}});'); expect(app).toContain('setSectionSliceImageVisible(!!sectionSliceImageControl.checked);syncSectionShadeUi();'); expect(sectionView).toContain('syncSectionShadeUi();');
  });
  it('nothing was added that decides by data type or loads code dynamically', () => {
    for (const s of [pure, sectionShade, readFileSync('docs/value-step.js', 'utf8')]) { expect(/\bimport\s*\(/.test(s)).toBe(false); expect(/huLike|modality|isCt/i.test(s)).toBe(false); }
  });
});

describe('VR menu: the 濃淡の範囲 page (tab 12), opened from the スライス tab without moving any existing row', () => {
  const sliceTab = between(vr, '}else if(ui.tab===2){', '}else if(ui.tab===3){'), page = between(vr, '}else if(ui.tab===12){', '}else if(ui.tab===11){');
  it('the entry button sits right of the 単色 / CT濃淡 buttons (x 796..980, same row y0+650, 72 high): it overlaps no existing widget', () => {
    expect(sliceTab).toContain('btn(796,y0+650,184,L.shRange,false,()=>{ui.tab=12;menu.refresh()},{size:ja?26:22});');
    const MENU_W = 1024, X = 40, CX = 330, bw = Math.min(220, (MENU_W - X - CX - 12) / 2), choiceEnd = CX + 2 * bw + 12;
    expect(choiceEnd).toBe(782); expect(796).toBeGreaterThan(choiceEnd); expect(796 + 184).toBeLessThanOrEqual(980); // the close button / ＋ buttons end at 980 / 960
    for (const y of [44, 126, 216, 298, 390, 520, 734, 818]) expect(y + 72 <= 650 || y >= 650 + 72).toBe(true); // no other row shares the entry button's band
  });
  it('the existing slice-tab rows keep their places (the layout test also pins them): opacity 44, tint 126, centre 216, width 298, presets 390, window help 490, air 520 / help 618, fill 650, brightness 734, contrast 818', () => {
    for (const s of ['y:y0+44,w:300', 'y:y0+126,w:300', "row(y0+216,L.wcL,'c',cMin,cMax);row(y0+298,L.wwL,'w',1,wMax);", 'btn(X+i*244,y0+390,232,', 'label(X,y0+490,L.winHelp,', 'x:CX+26,y:y0+520,w:300,h:72', 'label(X,y0+618,L.airHelp', 'choice(y0+650,L.ctSh,', 'y:y0+734,w:300', 'y:y0+818,w:300']) expect(sliceTab).toContain(s);
  });
  it('the page: the segments shown now (vrSegShown), lower / upper sliders of the chosen one with − / ＋, 初期値に戻す, a back button to the スライス tab; it is not in the tab bar', () => {
    // the shown child segments of the tree follow the presets in the chooser (same key / data rule)
    expect(page).toContain('const keys=[...gpuSegmentOrder().filter(k=>k&&vrSegShown(k)),...childList.map(e=>e.key)');
    expect(page).toContain('key=keys.includes(ui.shadeSeg)?ui.shadeSeg:(keys[0]??null),data=shadeDataRange();');
    expect(page).toContain('pageKeys.forEach((k,i)=>{const sg=segmentById(k);btn(X+aw+i*(bw+12),y0+130,bw,ellipsize(sg?.name??tr(k),bw-16,z=>menu.measure(z,28,true)),k===key,()=>{ui.shadeSeg=k;menu.refresh()}'); // up to 5 per row, ◀ ▶ with more (child segments)
    expect(page).toContain("rowOf(y0+250,L.shLower,'lower',r.lower);rowOf(y0+350,L.shUpper,'upper',r.upper);");
    expect(page).toContain('btn(X,y0+470,420,L.shReset,false,()=>{resetSegmentShadeRange(key)},{size:28,disabled:!r.touched});');
    expect(page).toContain('btn(X,MENU_H-100,260,L.back,false,()=>{ui.tab=2;menu.refresh()},{size:28});');
    expect(vr).toContain('TAB_IDS=[0,1,2,3,4,5,6,9,11]');
  });
  it('the sliders run over the segment\'s span in 200 steps (shadeValueAt / shadePosOf), show raw values, and − / ＋ stop at the data limits and at the other end', () => {
    expect(page).toContain('value:shadePosOf(value,span),text:formatCtValue(value,step)'); expect(page).toContain('set:v=>{setSegmentShadeEnd(key,which,shadeValueAt(v,span),data)}');
    expect(page).toContain("const q=segmentShadeRange(key,data);setSegmentShadeEnd(key,which,stepClamp(which==='lower'?q.lower:q.upper,d,data.min,data.max),data)");
    expect(page).toContain('span=segmentShadeSpan(key,data),step=shadeRangeStep(span)');
    expect(segmentsSrc).toContain('moveShadeEnd(segmentShadeRange(key,data),which,value,data)');
  });
  it('VR and browser share one state and one maths (segments.js, cap-shade.js): no separate copy in vr-view.js', () => {
    expect(vr).toContain("segmentShadeRange, segmentShadeSpan, setSegmentShadeEnd, resetSegmentShadeRange, shadeDataRange, applyShadeAutoHistograms, onShadeAutoChange } from './segments.js"); expect(sectionShade).toContain("from './segments.js"); expect(ov).toContain("segmentShadeRange, shadeDataRange } from './segments.js");
    expect(vr).not.toMatch(/segmentShadeRanges\b/);
  });
});
