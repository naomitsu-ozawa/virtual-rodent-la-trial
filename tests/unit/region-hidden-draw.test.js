import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import * as RV from '../../docs/region-visibility.js';
import { marchClassificationHitInfo, classifiedAt } from '../../docs/vr-pick.js';
import { pointIsHidden } from '../../docs/vr-point.js';
import { MedicalVolumeRenderer, analysisOverlayWord, analysisOverlayTableHead, OVERLAY_HIDDEN_BIT, volumeShader } from '../../docs/medical-volume.js';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { pickRay, hiddenTestOf } from '../../docs/webgl-volume-pick.js';
import { volumePickShader, volumePickShaderChild, volumeShaderChild } from '../../docs/medical-volume.js';
import { labelAt } from '../../docs/vr-label-histogram.js';

installDomStub();
const src = n => readFileSync('docs/' + n, 'utf8');
let S, ST, O, M, W;
beforeAll(async () => { S = await importApp('segments'); ST = await importApp('state'); O = await importApp('analysis-ops'); M = await importApp('mpr-render'); W = await importApp('webgl-volume'); });
afterEach(() => {
  ST.setAnalysisRegions([]); ST.setAnalysisFocusedRegionId(null); ST.setVolume(null); ST.setThreeRenderMode('surface'); ST.setSceneState(null);
  for (const k of S.SEGMENT_PRESET_ORDER) { S.segmentState[k].active = false; S.segmentState[k].enabled = false; }
});

// the shader's two rules on a texel's alpha, as written in vr-view.js (checked below against the source): the colour on slot s, the hidden shape on slot s
const colourOn = (a, s) => ((Math.trunc(a + 0.5) >> s) & 1) === 1;
const hiddenOn = (a, s) => ((Math.trunc(a + 0.5) >> (8 + s)) & 1) === 1;

describe('the look-up table: a hidden result has no hit (regionLutAlpha)', () => {
  it('the shader reads the rules this test applies', () => {
    const v = src('vr-view.js');
    expect(v).toContain('return ((int(e.a+0.5)>>s)&1)==1?e.rgb:base;'); // regionColor (unchanged)
    expect(v).toContain('return ((int(texelFetch(regionLut,ivec2(i,0),0).a+0.5)>>(8+s))&1)==1;'); // regionHiddenAt
    expect(RV.REGION_HIDE_SHIFT).toBe(8);
  });
  it('hidden: the hide bits of its slots, no colour bit, whatever the colour flag / the stick press / the focus say', () => {
    for (const shown of [true, false]) for (const focused of [true, false]) {
      const a = RV.regionLutAlpha(0b0101, { shown, hidden: true, focused });
      expect(a).toBe(0b0101 << 8);
      for (const s of [0, 1, 2, 3]) { expect(colourOn(a, s)).toBe(false); expect(hiddenOn(a, s)).toBe(s === 0 || s === 2); }
      expect(RV.regionLutHiddenSlots(a)).toBe(0b0101);
    }
  });
  it('colour only (not hidden): the very values of before (shown = its slots, + 16 when focused; colour off / stick press = 0), no hide bit', () => {
    for (const m of [0, 1, 2, 4, 8, 5, 15]) {
      expect(RV.regionLutAlpha(m, { shown: true })).toBe(m);
      expect(RV.regionLutAlpha(m, { shown: true, focused: true })).toBe(m | 16);
      expect(RV.regionLutAlpha(m, { shown: false })).toBe(0);
      expect(RV.regionLutAlpha(m, { shown: false, focused: true })).toBe(0);
      for (const s of [0, 1, 2, 3]) expect(hiddenOn(RV.regionLutAlpha(m, { shown: true, focused: true }), s)).toBe(false);
      expect(RV.regionLutHiddenSlots(RV.regionLutAlpha(m, { shown: true, focused: true }))).toBe(0);
    }
    expect(RV.regionLutAlpha(5)).toBe(5); // defaults: shown, not hidden
  });
  it('VR: refreshRegionLut and the partner\'s table write the alpha through regionLutAlpha (hidden = region.hidden; colour = region.visible and not the stick press)', () => {
    const v = src('vr-view.js');
    expect(v).toContain('a[o+3]=regionLutAlpha(m,{shown:regionColorSeen(e.rid),hidden:regionHiddenVr(e.rid)})');
    expect(v).toContain("a[o+3]=regionLutAlpha(typeof e.segMask==='number'?e.segMask:0,{shown:p?regionColorSeen(p.id):!regionColorOff,hidden:regionHidden(p)});");
    expect(v).toContain('const unsubRegionHid=onRegionHiddenChange(()=>{visGen++;if(!running)return;try{refreshRegionLut()}catch(e){console.warn(e)}if(ui.open)menu.refresh()});'); // visGen: the HU histogram board counts again; an earlier change stage 3: the board's 表示 toggles and 「すべて表示（隠 N）」 redraw
    expect(v).toContain('unsubRegionVis();unsubRegionHid();');
  });
  it('VR shader: the three loops, the two cut faces and the slices skip a hidden result (as a hidden child), only where VRL_REGIONS is compiled', () => {
    const v = src('vr-view.js');
    expect(v.match(/if\(!passH&&regionAnyHidden!=0\)passH=regionHiddenAt\(/g)).toHaveLength(3); // the reads are skipped while nothing is hidden (regionAnyHidden = 0)
    expect(v.match(/ci=regionVis\(cp,ci\);/g)).toHaveLength(2);
    expect(v).toContain('#define sliceColor(p,rd,ro) sliceColorR(p,rd,ro)');
    expect(v).toContain('#define CHILD_REG_VIS(p,si) regionVis(p,si)');
    expect(v.match(/#ifdef VRL_HIDE\n    lastIndex=passH\?-1:idx;/g)).toHaveLength(3);
  });
});

describe('the PC WebGL volume (webgl-volume.js applyRegions): the same table', () => {
  const fake = regions => {
    const r = Object.create(W.WebGlVolumeRenderer.prototype);
    const data = new Float32Array(256 * 4);
    Object.assign(r, { uniforms: { regionLut: { value: null }, regionTex: { value: null }, regionAnyHidden: { value: 0 } }, regionLut: { image: { data } }, regionTexture: {}, regionTexSignature: 't', regionIndexed: regions.length,
      regionsArgs: { regions, v: {}, textureSignature: 't' }, previewRuns: null, hoverRuns: null, color: { r: 0, g: 0, b: 0, setHex(h) { this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; return this; } },
      texture: {}, mesh: null, pickMaterial: () => null, onRedraw: vi.fn(), dummy: {} });
    r.applyRegions();
    fake.anyHidden = r.uniforms.regionAnyHidden.value;
    return data;
  };
  it('hidden: hide bits of its slots; colour off: 0 as before; shown / focused as before; the index texture is reused (no new preparation)', () => {
    const regs = [{ runs: [], color: 0x112233, segments: [1], shown: true, focused: true }, { runs: [], color: 0x445566, segments: [0], shown: false }, { runs: [], color: 0x778899, segments: [2], shown: true, hidden: true }];
    const a = fake(regs);
    expect(a[4 + 3]).toBe(2 | 16); expect(a[8 + 3]).toBe(0); expect(a[12 + 3]).toBe(4 << 8);
    expect(hiddenOn(a[12 + 3], 2)).toBe(true); expect(colourOn(a[12 + 3], 2)).toBe(false);
  });
  it('regionAnyHidden (the VR shader reads the hide bits only while it is 1): 1 when one result is hidden, 0 when none is (colour off alone is not hidden); declared in uniformSet', () => {
    fake([{ runs: [], color: 0x112233, segments: [1], shown: true }, { runs: [], color: 0x778899, segments: [2], shown: true, hidden: true }]);
    expect(fake.anyHidden).toBe(1);
    fake([{ runs: [], color: 0x112233, segments: [1], shown: true }, { runs: [], color: 0x445566, segments: [0], shown: false }]);
    expect(fake.anyHidden).toBe(0);
    expect(src('webgl-volume.js')).toContain('regionAnyHidden: { value: 0 }');
  });
  it('the page passes the shape flag (analysis-ops.js syncVolumeAnalysisOverlay)', () => {
    const regions = [{ id: 1, runsBySlice: [], voxels: 3, color: 0x00ff00, segmentKeys: ['soft'], visible: true, hidden: true }, { id: 2, runsBySlice: [], voxels: 3, color: 0x0000ff, segmentKeys: ['soft'], visible: false }];
    for (const webgl of [true, false]) {
      const mv = { active: true, drawsInScene: webgl, seriesId: 's', textureDims: [1, 1, 1], setAnalysisRuns: vi.fn() };
      ST.setSceneState({ medicalVolume: mv }); ST.setThreeRenderMode('volume'); ST.setVolume({ columns: 1, rows: 1, slices: 1, spacing: [1, 1, 1] });
      S.segmentState.soft.active = true; S.segmentState.soft.enabled = true; ST.setAnalysisRegions(regions);
      O.syncVolumeAnalysisOverlay();
      const items = mv.setAnalysisRuns.mock.calls[0][0];
      if (webgl) { expect(items.map(i => [i.hidden === true, i.shown])).toEqual([[true, true], [false, false]]); }
      else expect(items.map(i => i.hidden === true)).toEqual([true]); // WebGPU: the shown ones as before + the hidden one; the colour-off one stays out
      const sig1 = mv.setAnalysisRuns.mock.calls[0][2]; regions[0].hidden = false; O.syncVolumeAnalysisOverlay(); regions[0].hidden = true;
      expect(mv.setAnalysisRuns.mock.calls.at(-1)[2]).not.toBe(sig1); // the flag is part of the signature: a switch reaches the volume
    }
  });
});

describe('the PC WebGPU volume (medical-volume.js): a hidden result is no member of its segments', () => {
  it('overlay word: bit 31 + bit 30 + its segment bits, never a colour; a shown one as before', () => {
    expect(analysisOverlayWord({ color: 0x123456, segments: [1, 3], hidden: true })).toBe((0x80000000 | OVERLAY_HIDDEN_BIT | 0b1010) >>> 0);
    expect(analysisOverlayWord({ color: 0x123456, hidden: true })).toBe((0x80000000 | OVERLAY_HIDDEN_BIT | 0xff) >>> 0); // unknown segments: all
    expect(analysisOverlayWord({ color: 0x123456, focused: true })).toBe((0x123456 | 0x1000000 | 0x80000000) >>> 0);
    expect(analysisOverlayTableHead([{ segments: [0] }, { segments: [2], hidden: true }])).toBe(1 | (4 << 8));
    expect(analysisOverlayTableHead([{ segments: [0] }, { segments: [1] }])).toBe(3); // no hidden one: the head of before
  });
  it('setAnalysisRuns writes the hidden word into the runs and the table', () => {
    globalThis.GPUBufferUsage ??= { STORAGE: 0x80, COPY_DST: 0x8, COPY_SRC: 0x4 }; globalThis.GPUTextureUsage ??= { TEXTURE_BINDING: 0x4, COPY_DST: 0x2 };
    const written = [], r = Object.create(MedicalVolumeRenderer.prototype);
    const device = { limits: { maxStorageBufferBindingSize: 1 << 20 }, createBuffer: ({ size }) => { const d = new ArrayBuffer(size); return { size, destroy() {}, getMappedRange: () => d, unmap() {} }; }, createTexture: () => ({ destroy() {} }),
      createCommandEncoder: () => ({ copyBufferToTexture() {}, finish: () => ({}) }), queue: { writeBuffer: (b, o, data) => written.push(new Uint32Array(data)), submit() {}, onSubmittedWorkDone: () => Promise.resolve() } };
    Object.assign(r, { device, textureDims: [8, 1, 1], analysisOverlaySignature: '', rebuildBindGroup() {} });
    r.setAnalysisRuns([{ runs: [new Uint32Array([0, 0, 1])], color: 0x112233, segments: [0] }, { runs: [new Uint32Array([0, 4, 5])], color: 0x445566, segments: [1], hidden: true }], { columns: 8, rows: 1, slices: 1 }, 'sig');
    const data = written.at(-1), table = data[0];
    expect(data[table]).toBe(1 | (2 << 8));
    expect(data[table + 1]).toBe((0x112233 | 0x80000000) >>> 0);
    expect(data[table + 2]).toBe((0x80000000 | OVERLAY_HIDDEN_BIT | 2) >>> 0);
  });
  it('the shader: segmentIndexFor and the cut face skip it (regionHiddenAt), the colour paths ignore a hidden word; it still parses', () => {
    const s = volumeShader();
    expect(s).toContain('if(regionHiddenAt(s,tc)){continue;}');
    expect(s).toContain('if(segMember(s,v,a,tc)&&!regionHiddenAt(s,tc)){return i32(s);}}');
    expect(s).toContain('if(overlay!=0u&&(overlay&0x40000000u)==0u){');
    expect(s).toContain('if(ov!=0u&&(ov&0x40000000u)==0u){capColor=');
    expect(() => new WgslReflect(s)).not.toThrow();
  });
});

describe('picks: a hidden result is never hit', () => {
  const D = [4, 4, 4], HE = [1, 1, 1], cls = { C: 1, chan: [0, -1, -1, -1], data: new Uint8Array(64).fill(255) };
  const ids = new Uint8Array(64); for (let z = 2; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) ids[x + 4 * (y + 4 * z)] = 1; // result 1 = the far half (z >= 2)
  const lut = alpha => { const a = new Float32Array(256 * 4); a[4 + 3] = alpha; return a; };
  const o = { x: 0, y: 0, z: 3 }, q = { x: 0, y: 0, z: -1 };
  it('the VR laser (marchClassificationHitInfo) goes through a hidden result and stops at the first visible voxel; colour only = the hit of before', () => {
    expect(RV.hiddenRegionVoxelOf(ids, D, lut(RV.regionLutAlpha(1, { shown: false })), cls.chan)).toBeNull(); // colour off: nothing to skip (the march is the one it always was)
    expect(RV.hiddenRegionVoxelOf(ids, D, lut(RV.regionLutAlpha(1, { shown: true })), cls.chan)).toBeNull();
    expect(marchClassificationHitInfo(o, q, HE, D, cls, [0]).z).toBe(3);
    const skip = RV.hiddenRegionVoxelOf(ids, D, lut(RV.regionLutAlpha(1, { hidden: true })), cls.chan);
    const hi = marchClassificationHitInfo(o, q, HE, D, cls, [0], [], 0, 0, 0, Infinity, skip);
    expect(hi.z).toBeLessThan(2);
    // hidden on ANOTHER slot (its segment is slot 1): the hit on slot 0 stays
    expect(marchClassificationHitInfo(o, q, HE, D, cls, [0], [], 0, 0, 0, Infinity, RV.hiddenRegionVoxelOf(ids, D, lut(RV.regionLutAlpha(2, { hidden: true })), cls.chan)).z).toBe(3);
  });
  it('the points / the section tissue: a hidden result covers nothing and is no tissue', () => {
    const skip = RV.hiddenRegionVoxelOf(ids, D, lut(RV.regionLutAlpha(1, { hidden: true })), cls.chan);
    expect(classifiedAt({ x: 0, y: 0, z: 0.8 }, HE, D, cls, [0])).toBe(true);
    expect(classifiedAt({ x: 0, y: 0, z: 0.8 }, HE, D, cls, [0], skip)).toBe(false);
    const p = { x: 0, y: 0, z: 0.1 }, head = { x: 0, y: 0, z: 5 };
    expect(pointIsHidden(p, head, { cls, dims: D, halfExt: HE, chs: [0] })).toBe(true);
    expect(pointIsHidden(p, head, { cls, dims: D, halfExt: HE, chs: [0], skip })).toBe(false);
  });
  it('anyHiddenVoxel: a hidden child and a hidden result together', () => {
    const a = (x, y, z) => z === 0, b = (x, y, z) => z === 1, f = RV.anyHiddenVoxel(a, b);
    expect([0, 1, 2].map(z => f(0, 0, z, 0))).toEqual([true, true, false]);
    expect(RV.anyHiddenVoxel(null, null)).toBeNull(); expect(RV.anyHiddenVoxel(a, null)).toBe(a);
  });
  it('VR wiring: the laser, the points, the section tissue and the partner use the hidden results; a hidden result is not the picked result', () => {
    const v = src('vr-view.js');
    expect(v).toContain('const hiddenVoxel=()=>anyHiddenVoxel(hiddenChildVoxel(),hiddenRegionVoxel());');
    expect(v).toContain('u.planeCount.value,u.planeCut.value,0,Infinity,hiddenVoxel());');
    expect(v).toContain('id=id0&&!regionCountedVr(regionList[id0-1]?.rid)?0:id0;');
    expect(v).toContain('regionCountedVr=rid=>!regionHiddenVr(rid)');
    expect(v).toContain("key+='|kids'+childHideSig()+'|rh'+regionHideSig();");
    expect(v).toContain('0,Infinity,pairHiddenVoxel(pt));');
    expect(v).toContain('id=e&&(!pp||!regionHidden(pp))?id0:0;');
  });
  it('the page: analysisRegionAtVoxel skips a hidden result, never a colour-off one; the mesh pick the same', () => {
    ST.setVolume({ columns: 4, rows: 1, slices: 1, spacing: [1, 1, 1] });
    const r = { id: 1, runsBySlice: [new Uint32Array([0, 1, 2])], segmentKeys: [], visible: true, hidden: false };
    ST.setAnalysisRegions([r]);
    expect(O.analysisRegionAtVoxel(1, 0, 0)).toBe(r);
    r.hidden = true; expect(O.analysisRegionAtVoxel(1, 0, 0)).toBeNull();
    ST.setAnalysisFocusedRegionId(1); expect(O.analysisRegionAtVoxel(1, 0, 0)).toBeNull(); // focused too
    r.hidden = false; r.visible = false; expect(O.analysisRegionAtVoxel(1, 0, 0)).toBe(r);
    r.hidden = true; expect(O.analysisRegionAtVoxel(1, 0, 0)).toBeNull();
    expect(src('analysis-ops.js')).toContain('analysisRegionPickable(analysisRegionById(h.object.userData.analysisRegionId))');
  });
});

describe('2D (mpr-render.js paintSourcePlane): a hidden result paints nothing, like a hidden child (the grey image shows)', () => {
  const paint = region => {
    ST.setVolume({ columns: 4, rows: 1, slices: 1, spacing: [1, 1, 1], data: new Float32Array(4) });
    const seg = S.segmentState.soft; seg.active = true; seg.enabled = true; seg.min = -1000; seg.max = 1000; seg.color = '#ff0000'; seg.opacity = 1;
    ST.setAnalysisRegions(region ? [region] : []);
    const img = { data: new Uint8ClampedArray(16) }, ctx = { createImageData: () => img, putImageData() {}, getContext() {} };
    M.mprPaintCache.axial = null;
    M.paintSourcePlane({ canvas: { width: 4, height: 1, getContext: () => ctx, parentElement: null } }, [4, 1], new Float32Array(4), 'axial', 0);
    return [0, 1, 2, 3].map(i => [...img.data.slice(4 * i, 4 * i + 3)]);
  };
  const reg = o => ({ id: 1, runsBySlice: [new Uint32Array([0, 1, 2])], segmentKeys: ['soft'], color: 0x00ff00, visible: true, hidden: false, ...o });
  it('shown: its colour; colour off: the segment colour (as before); hidden: nothing (the grey value), the rest of the segment unchanged', () => {
    const none = paint(null), shown = paint(reg()), off = paint(reg({ visible: false })), hid = paint(reg({ hidden: true })), both = paint(reg({ visible: false, hidden: true }));
    expect(none[1]).not.toEqual(shown[1]); // the result colours its voxels
    expect(off).toEqual(none); // colour off: the segment's own colour there, as before
    expect(hid[0]).toEqual(none[0]); expect(hid[3]).toEqual(none[3]); // outside the result: the segment as always
    expect(hid[1]).toEqual([0, 0, 0]); expect(hid[2]).toEqual([0, 0, 0]); // inside: the grey image (value 0) with no segment / result colour
    expect(both).toEqual(hid);
    expect(src('mpr-render.js')).toContain('if(!analysisRegionShown(region)||regionHidden(region))continue; // an earlier change: a hidden shape has no frame either');
  });
});

describe('follow-up (coordinator): the PC volume picks and the VR HU histogram treat a hidden shape as a hidden child', () => {
  // a 4 x 1 x 4 volume along z, every voxel HU 100 (segment slot 0: 0..200); the far half (z >= 2) belongs to index 1 of a grid
  const dims = [4, 1, 4], data = new Uint8Array(4 * 4 * 2); for (let i = 0; i < 16; i++) { data[2 * i] = 100; data[2 * i + 1] = 0; }
  const ids = new Uint8Array(16); for (let z = 2; z < 4; z++) for (let x = 0; x < 4; x++) ids[z * 4 + x] = 1;
  const base = { data, dims, calibration: [1, 0, 0], halfExt: [1, 1, 1], step: 0.05, origin: [0, 0, 3], dir: [0, 0, -1], segs: [{ min: 0, max: 200, enabled: true }, {}, {}, {}] };
  it('WebGL CPU pick (pickRay): goes through a hidden shape (result or child) and picks what lies behind; colour only = the pick of before', () => {
    expect(pickRay(base).z).toBe(3);
    expect(hiddenTestOf([{ ids, dims, slotsOf: () => 0, any: false }])).toBeNull(); // nothing hidden: the pick of before
    const hidden = hiddenTestOf([{ ids, dims, slotsOf: id => (id === 1 ? 1 : 0), any: true }]);
    expect(pickRay({ ...base, hidden }).z).toBe(1);
    expect(pickRay({ ...base, hidden, preferred: 0 }).z).toBe(1);
    expect(pickRay({ ...base, hidden: hiddenTestOf([{ ids, dims, slotsOf: () => 2, any: true }]) }).z).toBe(3); // hidden on another slot
    expect(pickRay({ ...base, hidden: () => true })).toBeNull();
  });
  it('WebGL wiring: the pick reads the shader\'s own tables (regionLut hide bits, childLut row 1 hidden mask)', () => {
    const w = src('webgl-volume.js');
    expect(w).toContain('preferred, srcDims: [this.volume.columns, this.volume.rows, this.volume.slices], hidden });');
    expect(w).toContain('regionLutHiddenSlots(rl[4 * id + 3])'); expect(w).toContain('Math.round(cl[R + 4 * id + 3]) & 15');
  });
  it('WebGPU pick shader: the results\' bindings 8 / 9 and the hidden-result test in its segment test (and the child variant keeps both tests); every shader parses', () => {
    const p = volumePickShader(), pc = volumePickShaderChild();
    expect(p).toContain('@group(0) @binding(8) var<storage,read> analysisOverlay:array<u32>;'); expect(p).toContain('@group(0) @binding(9) var regionTex:texture_3d<u32>;');
    expect(p).toContain('if(segMember(s,v,a,tc)&&!regionHiddenAt(s,tc)){return preferred;}');
    expect(pc).toContain('if(segMember(s,v,a,tc)&&!regionHiddenAt(s,tc)&&!childHiddenAt(s,tc)){return preferred;}');
    expect(pc).toContain('if(segMember(s,v,a,tc)&&!regionHiddenAt(s,tc)&&!childHiddenAt(s,tc)){return i32(s);}}');
    for (const s of [p, pc, volumeShader(), volumeShaderChild()]) expect(() => new WgslReflect(s)).not.toThrow();
    expect(src('medical-volume.js')).toContain("{binding:8,resource:{buffer:this.analysisOverlayBuffer}},{binding:9,resource:(this.regionTexture||this.regionDummy()).createView({dimension:'3d'})}");
  });
  it('WebGPU drawing: the hidden child\'s shading rules for a hidden result too (the normal of the cut it leaves, no HU iso search, no uniform-brick jump on its segment)', () => {
    const s = volumeShader();
    expect(s).toContain('}else if(previousRegHideIdx==idx){n=regionHiddenNormal(u32(idx),texCoord(u.camOrigin.xyz+dir*previousT));}');
    expect(s).toContain('&&!regionHideSeg(u32(idx));');
    expect(s).toContain('if(uniformSeg>=0&&regionHideSeg(u32(uniformSeg))){uniformSeg=-1;}');
    expect(s.match(/previousRegHideIdx=select\(-1,rawIdx,/g)).toHaveLength(2);
    const c = volumeShaderChild(); // the child variant has both
    expect(c).toContain('previousHideIdx=select(-1,rawIdx,rawIdx>=0&&childHiddenAt(u32(rawIdx),tc0));'); expect(c).toContain('previousRegHideIdx=select(-1,rawIdx,rawIdx>=0&&regionHiddenAt(u32(rawIdx),tc0));');
  });
  it('VR HU histogram: a hidden result\'s voxels carry the hidden marker (200 + slot) and are not counted as that segment', () => {
    const v = src('vr-view.js');
    expect(v).toContain('hr.push([i+1,200+31-Math.clz32(hs&-hs)])');
    expect(v).toContain('return{data:histRegCache.data,dims,segs,hk:hk.length>0||hr.length>0}}');
    expect(v).toContain('rh=(Math.imul(rh,31)+(regionHiddenVr(L[i].rid)?3:regionShownVr(L[i].rid)?2:1))|0;');
    const picks = Int32Array.from([0, 0]), c = new Uint8Array([200]), regSegs = Int32Array.from([1]);
    expect(labelAt(0, c, 1, picks, new Uint8Array([1]), regSegs)).toBe(5); // a shown result colour labels it
    expect(labelAt(0, c, 1, picks, new Uint8Array([200]), regSegs)).toBe(0); // the marker: unlabeled
  });
});

describe('2D: a yolk inside a hidden white keeps its shape (mpr-render.js resultPlaneLayers / resultRgbAt)', () => {
  const white = (o = {}) => ({ id: 1, runsBySlice: [new Uint32Array([0, 0, 7])], segmentKeys: ['soft'], color: 0x00ff00, visible: true, hidden: true, ...o });
  const yolk = (o = {}) => ({ id: 2, runsBySlice: [new Uint32Array([0, 3, 4])], segmentKeys: ['soft'], color: 0x0000ff, visible: false, hidden: false, ...o });
  const paint = regions => {
    ST.setVolume({ columns: 8, rows: 1, slices: 1, spacing: [1, 1, 1], data: new Float32Array(8) });
    const seg = S.segmentState.soft; seg.active = true; seg.enabled = true; seg.min = -1000; seg.max = 1000; seg.color = '#ff0000'; seg.opacity = 1;
    ST.setAnalysisRegions(regions);
    const img = { data: new Uint8ClampedArray(32) }, ctx = { createImageData: () => img, putImageData() {}, getContext() {} };
    M.mprPaintCache.axial = null;
    M.paintSourcePlane({ canvas: { width: 8, height: 1, getContext: () => ctx, parentElement: null } }, [8, 1], new Float32Array(8), 'axial', 0);
    return [...Array(8).keys()].map(i => [...img.data.slice(4 * i, 4 * i + 3)]);
  };
  it('(7) [white (hidden), yolk (colour off)] in either order: the yolk\'s voxels are NOT hidden (the segment colour), the white\'s own voxels are (grey); the yolk shown: its colour', () => {
    const none = paint([]); // the segment's own colour everywhere
    for (const order of [r => r, r => r.slice().reverse()]) {
      const px = paint(order([white(), yolk()]));
      for (const x of [3, 4]) expect(px[x]).toEqual(none[x]);
      for (const x of [0, 2, 5, 7]) expect(px[x]).toEqual([0, 0, 0]);
      const shown = paint(order([white(), yolk({ visible: true })]));
      for (const x of [3, 4]) { expect(shown[x][0]).toBe(0); expect(shown[x][2]).toBeGreaterThan(0); } // the yolk's blue (blended at the segment's opacity)
      const yh = paint(order([white({ hidden: false, visible: false }), yolk({ hidden: true })])); // the yolk hidden: only its voxels
      for (const x of [3, 4]) expect(yh[x]).toEqual([0, 0, 0]); for (const x of [0, 7]) expect(yh[x]).toEqual(none[x]);
    }
  });
  it('resultRgbAt: HIDDEN_SHAPE only where the result that owns the voxel (fewest voxels, equal: later) is hidden on that segment; nothing hidden: the layers of before (shown ones only)', () => {
    ST.setVolume({ columns: 8, rows: 1, slices: 1, spacing: [1, 1, 1], data: new Float32Array(8) });
    const seg = S.segmentState.soft; seg.active = true; seg.enabled = true;
    for (const regs of [[white(), yolk()], [yolk(), white()]]) {
      ST.setAnalysisRegions(regs);
      const L = M.resultPlaneLayers('axial', 0, true, true);
      expect(L.hid).toBe(true); expect(L).toHaveLength(2);
      expect(M.resultRgbAt(L, 'soft', 3, 3, 0, 0)).toBeNull(); expect(M.resultRgbAt(L, 'soft', 0, 0, 0, 0)).toBe(M.HIDDEN_SHAPE);
      expect(M.resultRgbAt(L, 'bone', 0, 0, 0, 0)).toBeNull(); // another segment: not hidden by it
    }
    ST.setAnalysisRegions([white({ hidden: false }), yolk()]);
    const L0 = M.resultPlaneLayers('axial', 0, true, true); expect(L0.hid).toBeUndefined(); expect(L0).toHaveLength(1); // the colour-off yolk is no layer while nothing is hidden (as before)
    expect(M.resultRgbAt(L0, 'soft', 3, 3, 0, 0)).toEqual([0, 255, 0]);
    expect(M.resultPlaneLayers('axial', 0, true)).toHaveLength(1); // the mesh section face never asks for hidden ones
  });
});
