// The general loop as a text of the WGSL volume pass (docs/vr-wgsl-general.js): every combination parses, it is the core text with its march replaced (everything outside the march is the core's), the skip of S / EvS has the state of a sample that finds no
// segment, the display chooses S / EvS for a frame that does not use the combined texture, and the programs of those ways are in the display's list.
import { describe, it, expect } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl } from '../../docs/vr-wgsl-core.js';
import { generalWgsl, BRICKS_BINDING } from '../../docs/vr-wgsl-general.js';
import { featKey } from '../../docs/vr-wgsl-feat.js';
import { newPathText, chooseWay, GENERAL_MODES, DISPLAY_MODES, GENERAL_LADDER, GENERAL_HU_LADDER, WAY_LADDER, modeNeeds } from '../../docs/vr-wgpu-newpath.js';

const FEATS = [null, { R: true }, { C: true }, { R: true, C: true }, { C: true, T: true }];
const lines = t => t.split('\n').filter(l => !/^\/\/ VR \/ AR volume pass/.test(l));

describe('the general loop texts', () => {
  for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const events of [false, true]) for (const feat of FEATS) for (const [src, skip] of [['cls', false], ['cls', true], ['hu', false], ['hu', true]]) {
    it((f16 ? 'f16 ' : 'f32 ') + (cls4 ? 'c4 ' : 'c3 ') + (events ? 'ev ' : 'no ') + featKey(feat) + ' ' + src + (skip ? ' skip' : '') + ': parses, binds the bricks, has the loop of the WebGL program', () => {
      const t = generalWgsl({ f16, cls4, events, feat, src, skip }), r = new WgslReflect(t);
      expect(r.getBindGroups()[0].some(b => b.binding === BRICKS_BINDING)).toBe(true);
      expect(t).toContain('fn brickClass('); expect(t).toContain('fn brickExit('); expect(t).toContain('var canSample=u.diag==4||t<brickEnd;'); expect(t).toContain('nextT=t+max(brickExit(tc0,dir)+stp*0.05,stp);lastIndex=-1;');
      expect(t).not.toContain('let t=t0+f32(k)*stp;'); expect(t).not.toContain('previousT=t;k++'); expect(t).not.toContain('hitIdx>=0'); // no grid index, no deferred hit
      expect(t).toContain(' general src=' + src + (skip ? ' skip-marks' : ''));
      expect(t.includes('markTex')).toBe(skip);
      expect(t.includes('fn editAllows')).toBe(src === 'hu');
    });
  }
  it('everything outside the march is the core text\'s: every line of the core text before the march and after it is in the general text, in the same order', () => {
    for (const events of [false, true]) for (const feat of [null, { R: true, C: true }]) {
      const core = lines(volumeWgsl({ events, feat })), gen = lines(generalWgsl({ events, feat }));
      const head = core.slice(0, core.findIndex(l => l.startsWith(' let skipOn='))).filter(l => !l.includes('let bn=bakeGrad(tc,s);')), tail = core.slice(core.findIndex(l => l.startsWith('  depthMark(hi,1.0);')) + 2);
      const at = gen.findIndex(l => l.startsWith(' var brickEnd=-1.0;')); // (head: without the baked cut's light, the one line of the core the general loop leaves out: the WebGL 'full' program has none)
      expect(at).toBeGreaterThan(0);
      // the head: the core's lines, the new bindings / functions put in between (a subsequence)
      let j = 0; for (const l of gen.slice(0, at)) if (j < head.length && l === head[j]) j++;
      expect(j).toBeGreaterThanOrEqual(head.length - 1); // (the core's segIdxAt line is the one that may be replaced: the HU variant)
      expect(gen.slice(gen.length - tail.length)).toEqual(tail);
    }
  });
  it('the section block of the core is in the loop of an EvS text with the next sample one step on (t += stp), and not in a text without sections', () => {
    expect(generalWgsl({ events: true, skip: true })).toContain('lastIndex=ci;previousT=t;t+=stp;continue;'); expect(generalWgsl({ events: true })).toContain('sliceT');
    expect(generalWgsl({ events: false })).not.toContain('sliceT[');
  });
  it('the skip leaves the state of a sample that finds no segment (prevValid, lastIndex -1, previousT = t, the same next t) and the hit reads the outside value again; with a feature a skipped sample is not in a hidden part', () => {
    const a = generalWgsl({ skip: true }), b = generalWgsl({ skip: true, feat: { R: true } });
    expect(a).toContain('{prevValid=true;prevSkip=true;lastIndex=-1;previousT=t;t=nextT;continue;}'); expect(a).toContain('if(prevSkip&&prevValid){let ip=segIdxG(texCoord(o+dir*previousT));prevF=maxSegValue();}');
    expect(b).toContain('{prevValid=true;prevSkip=true;lastIndex=-1;prevHid=false;previousT=t;t=nextT;continue;}');
    expect(a.indexOf('(mt[mc.x%4]&shownMask)==0u')).toBeLessThan(a.indexOf('let idx=segIdxG(tc0);')); // before the sample's read
    expect(generalWgsl({}).includes('prevSkip=true')).toBe(false);
  });
  it('the HU source reads the data\'s own value (the range or the mask alone, the processing mask) and the cut face / the slice use it', () => {
    const t = generalWgsl({ src: 'hu', events: true });
    expect(t).toContain('let v=huAt(tc);gHu=v;'); expect(t).toContain('(((u.editMaskOnly>>u32(s))&1)==1||(v>=a.x&&v<=a.y))&&editAllows(s,tc)'); expect(t).not.toContain('fn segIdxAt(tc:vec3<f32>)->i32{return segIdxOfQ(clsAt(tc));}');
    expect(t).toContain('fn segValue(s:i32)->f32{let a=u.segA[s];return select(a.y-gHu,gHu-a.x,gHu<a.x);}');
  });
});

describe('the display chooses the general loop\'s ways', () => {
  const base = { pass: 'low', jumpOn: false, section: false, diag: 0, distField: false, walkOk: true, matrixOk: true, gridReady: true, general: true };
  it('S without a section, EvS with one, whatever the diagnostic, the pass, the grid or the matrix', () => {
    for (const pass of ['low', 'peri', 'probe']) for (const diag of [0, 1, 2, 3, 4, 5]) for (const ok of [true, false]) for (const section of [false, true]) {
      expect(chooseWay({ ...base, pass, diag, matrixOk: ok, gridReady: ok, walkOk: ok, section })).toBe(section ? 'EvS' : 'S');
    }
  });
  it('a frame that is not general chooses as before', () => { expect(chooseWay({ ...base, general: false, jumpOn: true })).toBe('B'); expect(chooseWay({ ...base, general: false, diag: 4, distField: true })).toBe('OS'); });
  it('the ladder of the general loop is one program (no fall back to the core\'s S), the modes need the marks and are compiled with the display\'s', () => {
    expect(GENERAL_LADDER).toEqual({ S: [['genSkip', 'S']], EvS: [['genSkipEv', 'EvS']] }); expect(GENERAL_MODES).toEqual(['genSkip', 'genSkipEv', 'genSkipHu', 'genSkipHuEv']); expect(GENERAL_HU_LADDER).toEqual({ S: [['genSkipHu', 'S']], EvS: [['genSkipHuEv', 'EvS']] });
    for (const m of GENERAL_MODES) { expect(modeNeeds(m)).toEqual({ dist: false, coarse: false, hu: /Hu/.test(m), marks: !/Hu/.test(m) }); expect(DISPLAY_MODES.includes(m)).toBe(false); expect(() => new WgslReflect(newPathText({ f16: false, cls4: false, mode: m, feat: { C: true } }))).not.toThrow(); }
    expect(WAY_LADDER.S).toEqual([['skip', 'S']]);
  });
});
