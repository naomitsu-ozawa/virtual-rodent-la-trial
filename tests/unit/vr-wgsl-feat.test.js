// The feature axis of the WGSL volume texts (docs/vr-wgsl-feat.js): every text of every feature combination parses; a feature-less text is the core's (the hash test is in wgsl-text-hash.test.js); the packer's members agree with the struct of a
// text with features; the f16 text of a feature is the f32 text with the type names changed; the ways' anchors are found once in the feature texts; the look-up tables' bytes are packed where the shader reads them.
import { describe, it, expect } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, uniformLayout, UNIFORM_FIELDS, UNIFORM_FIELDS_ALL } from '../../docs/vr-wgsl-core.js';
import { FEAT_FIELDS, FEAT_BINDINGS, REGION_LUT_VEC4, CHILD_LUT_VEC4, featOf, featKey, featParts, featOfUniforms } from '../../docs/vr-wgsl-feat.js';
import { newPathText, DISPLAY_MODES } from '../../docs/vr-wgpu-newpath.js';
import { regionLut, childLut } from '../helpers/m6-scene.js';
import { withFeat } from '../../docs/vr-wgpu.js';

const FEATS = [{ R: true }, { C: true }, { R: true, C: true }, { C: true, T: true }, { R: true, C: true, T: true }, { R: true, P: true }, { C: true, P: true }, { R: true, C: true, P: true }, { R: true, C: true, T: true, P: true }];
const norm = t => t.replace(/^enable f16;\n/m, '').replace(/\bf16\b/g, 'f32');

describe('feat helpers', () => {
  it('featOf: no flag, no feature; T only with child segments; featKey names the set', () => {
    expect(featOf(null)).toBe(null); expect(featOf({})).toBe(null); expect(featOf({ R: false, C: false, T: true })).toBe(null);
    expect(featOf({ R: true, T: true })).toEqual({ R: true, C: false }); expect(featOf({ C: true, T: true })).toEqual({ R: false, C: true, T: true });
    expect([null, { R: true }, { C: true }, { R: true, C: true }, { C: true, T: true }, { R: true, C: true, T: true }].map(featKey)).toEqual(['-', 'R', 'C', 'RC', 'CT', 'RCT']);
    expect(featOf({ P: true })).toBe(null); expect(featOf({ R: true, P: true })).toEqual({ R: true, C: false, P: true }); expect([{ R: true, P: true }, { C: true, T: true, P: true }].map(featKey)).toEqual(['RP', 'CTP']); // P (the parts) only with results or child segments
  });
  it('featParts of no feature is the core text itself (neutral pieces)', () => {
    const p = featParts(null);
    expect(p.on).toBe(false); expect(p.bind + p.fns + p.init + p.hidInit + p.look).toBe('');
    expect(p.segA).toBe('u.segA'); expect(p.segM).toBe('u.segM'); expect(p.col('p', 'b', 's')).toBe('b'); expect(p.vis('e', 'p')).toBe('e'); expect(p.lum('p', 'hu', 'si')).toBe('ctLumHU(hu,si)');
  });
  it('featOfUniforms: the index textures of the data set are real ones (wider than the 1 x 1 x 1 dummy)', () => {
    const tex = w => ({ isData3DTexture: true, image: { width: w } });
    expect(featOfUniforms({ regionTex: { value: tex(1) }, childTex: { value: tex(1) } })).toBe(null);
    expect(featOfUniforms({ regionTex: { value: tex(64) }, childTex: { value: tex(1) } })).toEqual({ R: true, C: false });
    expect(featOfUniforms({ regionTex: { value: tex(64) }, childTex: { value: tex(64) } })).toEqual({ R: true, C: true });
    expect(featOfUniforms({})).toBe(null);
    expect(featOfUniforms({ regionTex: { value: tex(64) }, childTex: { value: tex(1) }, partField: { value: tex(1) } })).toEqual({ R: true, C: false, P: true }); // a part's uniforms (or the body's while parts are out): they have the part's field
  });
});

describe('withFeat: the feature axis of a frame\'s variant', () => {
  const tex = w => ({ value: { isData3DTexture: true, image: { width: w } } });
  const u = (r, c, diag = 0) => ({ regionTex: tex(r), childTex: tex(c), diag: { value: diag } });
  it('the data set\'s feature from the uniforms\' index textures; none for the dummies', () => {
    expect(withFeat({ cls4: false, events: false }, u(1, 1)).feat).toBeUndefined();
    expect(withFeat({ cls4: false, events: false }, u(64, 1)).feat).toEqual({ R: true, C: false });
    expect(withFeat({ cls4: true, events: true }, u(64, 64)).feat).toEqual({ R: true, C: true });
  });
  it('a diagnostic (the effective diag is not 0) with child segments adds T, for every diag, and an override\'s diag wins; without child segments never', () => {
    for (const d of [1, 2, 3, 4, 5]) { expect(withFeat({}, u(64, 64, d)).feat).toEqual({ R: true, C: true, T: true }); expect(withFeat({}, u(64, 1, d)).feat).toEqual({ R: true, C: false }); }
    expect(withFeat({}, u(64, 64, 0)).feat).toEqual({ R: true, C: true });
    expect(withFeat({}, u(64, 64, 0), 5).feat).toEqual({ R: true, C: true, T: true });
  });
  it('a variant with the key feat: null draws without the features (the diagnostic that draws without the results), a given feat is normalised', () => {
    expect(withFeat({ feat: null }, u(64, 64)).feat).toBeUndefined();
    expect(withFeat({ feat: { R: true } }, u(1, 1)).feat).toEqual({ R: true, C: false });
    expect(withFeat({ feat: { C: true } }, u(1, 1, 3)).feat).toEqual({ R: false, C: true, T: true });
  });
});

describe('the texts with features', () => {
  for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const events of [false, true]) for (const feat of FEATS) {
    const name = (f16 ? 'f16 ' : 'f32 ') + (cls4 ? 'c4 ' : 'c3 ') + (events ? 'ev ' : 'no ') + featKey(feat);
    it(name + ': parses, declares only its own bindings, and the uniform struct is the core\'s members then the feature axis\'', () => {
      const t = volumeWgsl({ f16, cls4, events, feat }), r = new WgslReflect(t);
      const u = r.uniforms.find(x => x.name === 'u'), L = uniformLayout(UNIFORM_FIELDS_ALL);
      expect(u.members.map(m => m.name)).toEqual(UNIFORM_FIELDS_ALL.map(f => f[0]));
      for (const m of u.members) expect(L.fields.find(f => f.name === m.name).offset, m.name).toBe(m.offset);
      expect(L.byteSize).toBe(Math.ceil(u.size / 16) * 16);
      const bound = r.getBindGroups()[0].map(b => b.binding);
      expect(bound.includes(FEAT_BINDINGS.regionTex)).toBe(!!feat.R); expect(bound.includes(FEAT_BINDINGS.regionLut)).toBe(!!feat.R);
      expect(bound.includes(FEAT_BINDINGS.childTex)).toBe(!!feat.C); expect(bound.includes(FEAT_BINDINGS.childLut)).toBe(!!feat.C);
      expect(bound.includes(FEAT_BINDINGS.field)).toBe(true); expect(bound.includes(FEAT_BINDINGS.partOcc)).toBe(!!feat.P); // 15: the part's field (P) or the baked cut's; 16: the part's blocks
      expect(t.includes('var partField:')).toBe(!!feat.P); expect(t.includes('var bakeField:')).toBe(!feat.P);
      expect(t).toContain(' feat=' + featKey(feat));
      expect(/_cnt|fn fsMain/.test(t)).toBe(false);
    });
  }
  it('the core members keep their offsets when the feature axis is added', () => {
    const a = uniformLayout(UNIFORM_FIELDS), b = uniformLayout(UNIFORM_FIELDS_ALL);
    for (const f of a.fields) expect(b.fields.find(x => x.name === f.name).offset, f.name).toBe(f.offset);
    expect(b.fields.slice(a.fields.length).map(f => f.name)).toEqual(FEAT_FIELDS.map(f => f[0]));
    expect(b.byteSize).toBeGreaterThanOrEqual(a.byteSize);
  });
  for (const feat of FEATS) for (const cls4 of [false, true]) for (const events of [false, true]) {
    it(featKey(feat) + (cls4 ? ' c4' : ' c3') + (events ? ' ev' : ' no') + ': the f16 text is the f32 text with the type names changed (the header comment and the segment-off constant differ)', () => {
      const a = volumeWgsl({ f16: true, cls4, events, feat }), b = volumeWgsl({ f16: false, cls4, events, feat });
      const la = norm(a).split('\n'), lb = b.split('\n'); expect(la.length).toBe(lb.length);
      const diff = la.map((l, i) => (l === lb[i] ? null : i)).filter(i => i !== null);
      expect(diff).toHaveLength(2); expect(la[diff[1]]).toBe('const SEG_OFF=f32(4.0);'); expect(lb[diff[1]]).toBe('const SEG_OFF=1.0e9;');
    });
  }
  it('every anchor of the way programs is found in a feature text once (no mode throws, every text parses), and a feature text differs from the feature-less one', () => {
    for (const feat of FEATS) for (const cls4 of [false, true]) for (const mode of DISPLAY_MODES) {
      const t = newPathText({ f16: false, cls4, mode, feat });
      expect(() => new WgslReflect(t), featKey(feat) + ' ' + mode).not.toThrow();
      expect(t).not.toBe(newPathText({ f16: false, cls4, mode }));
      expect(t).toContain(' feat=' + featKey(feat));
    }
  });
  it('the skip of S / OS / EvS leaves no hidden part behind: prevHid is false after a skipped sample (a feature text only)', () => {
    for (const mode of ['skip', 'skipEv', 'tileSkip']) {
      expect(newPathText({ f16: false, cls4: false, mode, feat: { R: true } })).toContain('lastIndex=-1;prevHid=false;previousT=t;k++;continue;');
      expect(newPathText({ f16: false, cls4: false, mode })).not.toContain('prevHid');
    }
  });
  it('the hiding code is where the plan puts it: no jump from a hidden part, the first sample in a hidden part, the hidden test in the bisection, the cut face of a hidden part, a hit on a hidden part is no hit', () => {
    const t = volumeWgsl({ f16: false, cls4: false, events: true, feat: { R: true, C: true } });
    expect(t).toContain('if(prevHid&&!hideFieldOk()){dd=0.0;}');
    expect(t).toContain('if(hideAnyOn()){let tcH=tcO+tcD*t;let si=segIdxAt(tcH);if(si>=0&&hideAt(tcH,si)){prevHid=true;}}');
    expect(t).toContain('if(inside&&hideAnyOn()&&hideAt(tcO+tcD*mid,idx)){inside=false;}');
    expect(t).toContain('lastIndex=select(idx,-1,passH);'); expect(t).toContain('prevHid=hidNow;'); expect(t).toContain('hitHid=prevHid;'); expect(t).toContain('else if(hitIso&&!hideAnyOn())');
    expect(t).toContain('ci=regionVis(cp,ci);'); expect(t).toContain('ci=childVis(cp,ci);'); expect(t).toContain('childLook(childLookIdAt(texCoord(cp),ci),ci);');
    expect((t.match(/prevHid=false;/g) || []).length).toBeGreaterThanOrEqual(1);
    const tt = volumeWgsl({ events: false, feat: { C: true, T: true } });
    expect(tt).toContain('if((prevHid&&!hideFieldOk())||(lastIndex>=0&&hideAnyOn())){dd=0.0;}'); expect(tt).toContain('else if(idx>=0&&hideAnyOn()&&hideAt(tcO+tcD*t,idx)){lastIndex=-1;hidNow=true;}');
    expect(t).not.toContain('(lastIndex>=0&&hideAnyOn())'); expect(t).not.toContain('contributionT');
  });
  it('the child segments\' look reaches every read of the shown look (alpha, material, colour) and a text without them reads the uniforms', () => {
    const c = volumeWgsl({ events: true, feat: { C: true } }), r = volumeWgsl({ events: true, feat: { R: true } });
    expect(c).toContain('let alpha=clamp(gSegA[idx].z,0.03,1.0);'); expect(c).toContain('gSegM[idx].xyz);'); expect(c).toContain('clamp(gSegA[ci].z,0.03,1.0)'); expect(c).toContain('let m=gSegM[si];');
    expect(r).toContain('let alpha=clamp(u.segA[idx].z,0.03,1.0);'); expect(r).not.toContain('gSegA[idx]');
    expect(c).toContain('colAt(hp+dir*(0.75*u.voxelMin),u.segC[idx].rgb,idx)'); expect(c).toContain('ctLumAt(p,hu,si)'); expect(r).toContain('ctLumHU(hu,si)'); expect(r).not.toContain('ctLumAt');
  });
});

describe('the parts (P) and the baked cut', () => {
  it('the march\'s hidden tests and hideAt read the part\'s field; the slices\' and the cut face\'s visibility keep the ordinary tests (the WebGL program re-points only the call sites after PART_GLSL)', () => {
    for (const events of [false, true]) {
      const t = volumeWgsl({ events, feat: { R: true, C: true, P: true } });
      expect(t).toContain('passH=childHiddenAtP(tcO+tcD*t,idx);'); expect(t).toContain('passH=regionHiddenAtP(tcO+tcD*t,idx);');
      expect(t).toContain(' if(childHiddenAtP(tc,s)){return true;}'); expect(t).toContain(' if(u.regionAnyHidden!=0&&regionHiddenAtP(tc,s)){return true;}');
      expect(t).toContain('if(regionHiddenAt(texCoord(p),si)){return -1;}'); expect(t).toContain('if(childHiddenAt(texCoord(p),si)){return -1;}');
      expect(t).toContain('fn hideFieldOk()->bool{return u.partKind==0&&u.hideVMode>0;}');
      expect(t).toContain('else if(hitIso&&!hitHid&&!hideAnyOn())'); expect(t).toContain('if(hitHid&&!hitSimple&&u.diag!=4){');
      expect(t).toContain('let pfOn=' + (events ? 'nSlice==0&&capT<0.0' : 'true') + ';'); // the blocks: only on a ray without slices / a cut face (the WebGL narrow loop)
      expect(t.split('iters++;').length - 1).toBe(1); expect(t).not.toContain('bakeGrad');
    }
    const r = volumeWgsl({ feat: { R: true, P: true } }), c = volumeWgsl({ feat: { C: true, P: true } });
    expect(r).toContain(' if(f){return true;}\n return h;'); expect(c).not.toContain('regionHiddenAtP'); expect(r).not.toContain('childHiddenAtP');
  });
  it('the baked cut\'s light is in the R / C texts of the combined texture at diag 0 only, never in the general loop or a P text', async () => {
    const { generalWgsl } = await import('../../docs/vr-wgsl-general.js');
    const line = 'if(u.diag==0&&s>=0&&((u.bakeCut>>u32(s))&1)==1){let bn=bakeGrad(tc,s);';
    for (const feat of [{ R: true }, { C: true }, { R: true, C: true, T: true }]) {
      expect(volumeWgsl({ feat })).toContain(line); expect(newPathText({ mode: 'dist', feat })).toContain(line);
      for (const src of ['cls', 'hu']) expect(generalWgsl({ feat, src })).not.toContain(line);
    }
    expect(volumeWgsl({})).not.toContain('bake');
  });
});

describe('the look-up tables as the shader reads them', () => {
  it('lengths: 256 entries of a vec4 for the results, 3 rows of 256 for the child segments', () => { expect(REGION_LUT_VEC4).toBe(256); expect(CHILD_LUT_VEC4).toBe(768); expect(regionLut()).toHaveLength(256 * 4); expect(childLut({})).toHaveLength(768 * 4); });
  it('texel i of row r is at vec4 index r * 256 + i (colour + shown mask, range + flat / hidden masks, material + opacity)', () => {
    const d = childLut({ 3: { color: [0.1, 0.2, 0.3], mask: 5, row1: [7, 8, 9, 10], row2: [0.4, 0.5, 0.6, 0.7] } });
    expect(d.slice(3 * 4, 3 * 4 + 4).map(x => +x.toFixed(2))).toEqual([0.1, 0.2, 0.3, 5]);
    expect(d.slice((256 + 3) * 4, (256 + 3) * 4 + 4)).toEqual([7, 8, 9, 10]);
    expect(d.slice((512 + 3) * 4, (512 + 3) * 4 + 4).map(x => +x.toFixed(2))).toEqual([0.4, 0.5, 0.6, 0.7]);
    const r = regionLut({ hidden1: 15 }); expect(r[1 * 4 + 3]).toBe(15 << 8); expect(regionLut()[1 * 4 + 3]).toBe(15);
  });
});
