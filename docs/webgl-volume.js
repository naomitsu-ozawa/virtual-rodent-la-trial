import * as THREE from './vendor/three@0.186.0/build/three.module.js';
import { volumeTexturePlan, reduceSliceArea, packedRgSlice, packCtSlice } from './medical-volume.js?v=20261112-build727';
import { computeBricksOf, buildEditMaskOf, buildRegionIndexOf, buildChildIndexOf, packIndexRg, BRICK } from './vr-volume-prep.js?v=20261112-build727';
import { gpuRunsForTexture } from './gpu-runs.js?v=20261112-build727';
import { MATERIALS, materialKey, materialVec } from './lighting.js?v=20261112-build727';
import { MAX_SECTION_PLANES } from './vr-section-frame.js?v=20261112-build727';
import { SHADE_BRIGHT_DEFAULT, SHADE_CONTRAST_DEFAULT, brightOf, contrastOf } from './cap-shade.js?v=20261112-build727';
import { pickRay, hiddenTestOf } from './webgl-volume-pick.js?v=20261112-build727';
import { regionLutAlpha, regionLutHiddenSlots } from './region-visibility.js?v=20261112-build727';

export const WEBGL_VOLUME_DEFAULT = true;
export const webglVolumeEnabled = (search = typeof location !== 'undefined' ? location.search : '', m = /[?&]webglvolume=(\d)(&|$)/.exec(search || '')) => (m ? m[1] !== '0' : WEBGL_VOLUME_DEFAULT); // one line: the public gate reads a URL key from the line that reads location.search

const UNCOMPRESSED_TS = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2']);
export const WEBGL_VOLUME_SIDE = 512; // the in-plane side of the volume texture when the 3D-resolution setting is 「フル」 (memory: 512^3 x 2 B = 256 MB)
const MASK_SIDE = 256;                // the edit mask and the analysis index live on a grid of at most this many voxels per side
const PREVIEW_COLOR = 0xff290e;       // the cut preview's red (medical-volume.js: vec3(1, .16, .055))
const SLICE_AIR = -100000;            // the section's slice image shows every HU (the WebGPU volume does not make air transparent)
const CAP_HATCH_FREQ = 28;            // = medical-volume.js (put(20, ..., 28)) / the stripe test of its cap
const SECTION_AXES = { axial: { axis: 2, flip: 1 }, coronal: { axis: 1, flip: -1 }, sagittal: { axis: 0, flip: -1 } };

// ---- the shader: the VR fragment shader with a few page-only additions. Each anchor must exist (a unit test checks): when vr-view.js changes the text, the test says which. ----
export const SHADER_PATCHES = [
  // new uniforms
  { name: 'uniforms', find: 'uniform int capOn;', put: 'uniform int capOn;\nuniform float capAlpha;\nuniform float capHatch;\nuniform float capShade;\nuniform int planeSlice;' },
  // a surface hit coloured by an analysis result: exactly the VR shader's regionColor (the result's own colour through the look-up table regionLut, 0 = the result is hidden, the segment colour shows)
  // x the diffuse light; a FOCUSED result (the page's selection, bit 4 of the table's alpha) is 18 % brighter, as in the WebGPU volume. No result there: the segment colour as before
  { name: 'region-lit', find: 'VRL_MP vec3 lit=regionColor(hp+dir*(0.75*voxelMin),segC[idx].rgb,idx)*diffuse+vec3(spec);', put: 'VRL_MP vec3 lit=regionLit(hp+dir*(0.75*voxelMin),segC[idx].rgb,idx,diffuse,spec);', all: true },
  // the cut face: opacity (section cap opacity), hatching and the CT shading of the segment colour (cap-shade.js, ctLumHU through the segment's own range), as the WebGPU volume's cap
  { name: 'cap-alpha', find: 'clamp(segA[ci].z,0.03,1.0)', put: '(clamp(segA[ci].z,0.03,1.0)*capAlpha)', all: true },
  { name: 'cap-lit', find: 'VRL_MP vec3 lit=vrlRealCut(mix(regionColor(cp,segC[ci].rgb,ci),vec3(1.0),0.22),n,viewDir,vLightOff,vrlDepth01(capAt,o,halfExt));', put: 'VRL_MP vec3 lit=vrlRealCut(mix(regionColor(cp,segC[ci].rgb,ci),vec3(1.0),0.22),n,viewDir,vLightOff,vrlDepth01(capAt,o,halfExt))*capHatchF(cp,capPlane)*capShadeF(cp,ci);', all: true },
  { name: 'cap-functions', find: 'void main(){\n gl_FragDepth=gl_FragCoord.z;', put: `float capHatchF(vec3 cp,int pl){
 if(capHatch<0.5)return 1.0;
 vec3 tc=texCoord(cp);vec3 n=abs(cutPlanes[pl].xyz);vec2 uv=n.z>0.5?tc.xy:(n.y>0.5?tc.xz:tc.yz);
 return abs(fract((uv.x+uv.y)*${CAP_HATCH_FREQ}.0)-0.5)<0.14?0.26:1.0;
}
float capShadeF(vec3 cp,int s){return capShade>0.5?ctLumHU(huAt(texCoord(cp)),s):1.0;}
vec3 regionLit(vec3 p,vec3 base,int s,float diffuse,float spec){
#ifdef VRL_REGIONS
 int i=int(texture(regionTex,clamp(texCoord(p),vec3(0.0),vec3(0.999999))).r*255.0+0.5);
 if(i>=1&&regionAnyHidden!=0&&((int(texelFetch(regionLut,ivec2(i,0),0).a+0.5)>>(8+s))&1)==1){int j=int(texture(regionTex,clamp(texCoord(p),vec3(0.0),vec3(0.999999))).g*255.0+0.5);i=j==i?0:j;} // the colour index's result is hidden here: the hide index's own result (as the VR regionColor)
 if(i>=1){vec4 e=texelFetch(regionLut,ivec2(i,0),0);int m=int(e.a+0.5);if(((m>>s)&1)==1)return e.rgb*diffuse*(((m>>4)&1)==1?1.18:1.0)+vec3(spec);}
#endif
 return base*diffuse+vec3(spec);
}
void main(){\n gl_FragDepth=gl_FragCoord.z;` },
  // which planes show their slice image (a cutting plane whose image is hidden still clips and draws the cap)
  { name: 'plane-slice', find: 'if(crossT[i]>=t-1e-5&&crossT[i]<=endT+1e-5){sliceT[nSlice]=crossT[i];nSlice++;}', put: 'if(((planeSlice>>i)&1)==1&&crossT[i]>=t-1e-5&&crossT[i]<=endT+1e-5){sliceT[nSlice]=crossT[i];nSlice++;}' },
];
// the additions for a session WITH child segments (the shader is then compiled with VRL_CHILDREN, vr-view.js block A / A2): applied only then, so the shader of a session without child segments is the same text as ever.
// The page's surface colour goes through the child's colour (childBase) as the VR's regionColor macro does, and the cut-face shading through the child's own range (ctLumAt).
export const CHILD_SHADER_PATCHES = [
  { name: 'child-region-lit', find: ' return base*diffuse+vec3(spec);\n}', put: ' return childBase(p,base,s)*diffuse+vec3(spec);\n}' },
  { name: 'child-cap-shade', find: 'float capShadeF(vec3 cp,int s){return capShade>0.5?ctLumHU(huAt(texCoord(cp)),s):1.0;}', put: 'float capShadeF(vec3 cp,int s){return capShade>0.5?ctLumAt(cp,huAt(texCoord(cp)),s):1.0;}' },
];
export function patchFragmentShader(src, { children = false } = {}) {
  let out = src;
  const apply = list => { for (const p of list) {
    if (!out.includes(p.find)) throw new Error('webgl-volume: shader anchor "' + p.name + '" not found in the VR fragment shader (vr-view.js changed it)');
    out = p.all ? out.split(p.find).join(p.put) : out.replace(p.find, () => p.put);
  } };
  apply(SHADER_PATCHES);
  if (children) apply(CHILD_SHADER_PATCHES);
  return out;
}

// ---- pure helpers (unit-tested) ----
// the data grid of a mask: at most MASK_SIDE per side, same proportions
export function maskDims(dims, side = MASK_SIDE) {
  const m = Math.max(...dims);
  if (m <= side) return dims.slice();
  const k = side / m;
  return dims.map(n => Math.max(1, Math.round(n * k)));
}
// the section view / MPR planes of one frame as the shader's plane list. mpr = what app.js hands to render(): {indices: [axial, coronal, sagittal], visible: [0|1 x3], opacity, windowCenter, windowWidth, section: {active, plane, index, reverse, capEnabled, capOpacity, hatch, shade}}
// kept side of the cut plane: sign * (axis - coord) >= 0 with the sign of medical-volume.js render() (reverse, and -1 for coronal / sagittal) = dot(n, p) >= w with n = sign * e_axis, w = sign * coord.
export function planeState(mpr = {}, dims, halfExt) {
  const [w, h, d] = dims, idx = mpr.indices || [0, 0, 0], vis = mpr.visible || [0, 0, 0], section = mpr.section || {};
  const coordOf = (plane, i) => plane === 'axial' ? ((i + 0.5) / Math.max(d, 1) * 2 - 1) * halfExt[2] : plane === 'coronal' ? (1 - (i + 0.5) / Math.max(h, 1) * 2) * halfExt[1] : ((i + 0.5) / Math.max(w, 1) * 2 - 1) * halfExt[0];
  const planes = [], order = ['axial', 'coronal', 'sagittal'];
  let cutBits = 0, sliceBits = 0;
  const active = !!(section.active && SECTION_AXES[section.plane]);
  if (active) {
    const { axis, flip } = SECTION_AXES[section.plane], sign = (section.reverse ? -1 : 1) * flip, n = [0, 0, 0];
    n[axis] = sign;
    const sectionIdx = Number.isFinite(+section.index) ? +section.index : 0;
    planes.push([n[0], n[1], n[2], sign * coordOf(section.plane, sectionIdx)]);
    cutBits |= 1;
    if (vis[order.indexOf(section.plane)]) sliceBits |= 1;
  }
  order.forEach((plane, k) => {
    if (!vis[k] || (active && section.plane === plane)) return;
    if (planes.length >= MAX_SECTION_PLANES) return;
    const { axis } = SECTION_AXES[plane], n = [0, 0, 0]; n[axis] = 1;
    planes.push([n[0], n[1], n[2], coordOf(plane, +idx[k] || 0)]);
    sliceBits |= 1 << (planes.length - 1);
  });
  const opacity = Number.isFinite(+mpr.opacity) ? Math.max(0, Math.min(1, +mpr.opacity)) : 0;
  return {
    planes, planeCount: planes.length, planeCut: cutBits, planeSlice: sliceBits,
    sliceOpacity: sliceBits ? opacity : 0,
    capOn: active && section.capEnabled ? 1 : 0,
    capAlpha: Number.isFinite(+section.capOpacity) ? Math.max(0, Math.min(1, +section.capOpacity)) : 0.85,
    capHatch: section.hatch ? 1 : 0,
    shade: !!(active && section.capEnabled && section.shade?.on),
  };
}

// ---- child segments (pure, unit-tested) ----
// the entries of the page's render hand-off (segments.js childRenderEntries) that the shader can draw: with a mask, voxels, and a parent that has a GPU slot (a child recolours its parent's surface)
export const childItemsOfEntries = entries => (entries || []).filter(e => e && e.runs && !(e.voxels === 0) && Number.isFinite(+e.parentSlot) && +e.parentSlot >= 0 && +e.parentSlot <= 3)
  .map(e => ({ key: e.key, segMask: 1 << (+e.parentSlot | 0), runsBySlice: e.runs, hash: e.hash ?? e.voxels ?? 0 }));
// the parent slot bits of the prepared list follow the entries' current ones (key by key); the index texture and its signature are not touched
export function syncChildListMasks(list, items) {
  const m = new Map((items || []).map(i => [i.key, i.segMask | 0]));
  for (const e of list || []) if (m.has(e.key)) e.segMask = m.get(e.key);
  return list;
}
const rangeOk = r => !!r && Number.isFinite(+r.lower) && Number.isFinite(+r.upper) && +r.upper > +r.lower;
// the shading range of a child: its own (the user's), else the app-resolved one for its key (section.shade.ranges: the automatic range of this frame wins over the one handed over earlier, as in the WebGPU volume), else the one handed over (entry.shadeRange), else 0..1
export const childShadeOf = (e, range = null) => { const r = rangeOk(e.shade) ? e.shade : rangeOk(range) ? range : rangeOk(e.shadeRange) ? e.shadeRange : null; return r ? [+r.lower, +r.upper] : [0, 1]; };
// the PC's focus of a child (the mouse on its name card): its table colour x 1.18, the same 18 % a FOCUSED result gets in the shader ((m >> 4) & 1: rgb x 1.18), so a lit child and a lit result look alike. Only row 0's rgb of that child's
// texel (list order, entry j + 1) is scaled; alpha (the slot bits) and every other row stay. -> true when a texel changed.
export const CHILD_FOCUS_GAIN = 1.18;
export function applyChildFocus(a, list, key, gain = CHILD_FOCUS_GAIN) {
  const j = key ? (list || []).findIndex(e => e.key === key) : -1, o = (j + 1) * 4;
  if (j < 0 || j + 1 >= 256 || !(a[o + 3] > 0)) return false; // not prepared, past the 255th, or hidden (alpha 0): nothing to light
  a[o] *= gain; a[o + 1] *= gain; a[o + 2] *= gain; return true;
}
// vr-view.js refreshChildLut: the 256 x 3 RGBA32F table (row stride 256 * 4), entry j + 1 = list[j]. Row 0: colour + the parent's slot bit (0 while hidden); row 1: lower, upper, flat mask (the page has no simple mode: 0), hidden mask;
// row 2: the child's material (ambient, spec, shininess) + opacity. A child hidden = its own shown flag off (entry.shown, else entry.visible). A child deleted since (no entry) has no row.
export function fillChildLut(a, list, entries, rgbOf, materialsOf) {
  const R = 256 * 4, byKey = new Map((entries || []).map(x => [x.key, x]));
  a.fill(0);
  list.forEach((e, j) => {
    const idx = j + 1, en = idx < 256 ? byKey.get(e.key) : null; if (!en) return;
    const o = idx * 4, m = e.segMask | 0, hid = (en.shown === undefined ? en.visible : en.shown) === false, [lo, hi] = childShadeOf(en), rgb = rgbOf(en.color), mt = materialsOf(en.material);
    a[o] = rgb[0]; a[o + 1] = rgb[1]; a[o + 2] = rgb[2]; a[o + 3] = hid ? 0 : m;
    a[2 * R + o] = mt.ambient; a[2 * R + o + 1] = mt.spec; a[2 * R + o + 2] = mt.shininess; a[2 * R + o + 3] = Number.isFinite(+en.opacity) ? Math.min(1, Math.max(0, +en.opacity)) : 1;
    a[R + o] = lo; a[R + o + 1] = Math.max(hi, lo + 1e-3); a[R + o + 2] = 0; a[R + o + 3] = hid ? m : 0;
  });
  return a;
}

const dummyTexture = () => { const t = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.needsUpdate = true; return t; };
const skipDummyTexture = () => { const t = new THREE.Data3DTexture(new Uint32Array(2), 1, 1, 1); t.format = THREE.RGIntegerFormat; t.type = THREE.UnsignedIntType; t.internalFormat = 'RG32UI'; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true; return t; };

export class WebGlVolumeRenderer {
  constructor({ renderer, host, vr, onProgress, onStatus, onRedraw } = {}) {
    this.renderer = renderer; this.host = host;
    this.onProgress = onProgress || (() => {}); this.onStatus = onStatus || (() => {}); this.onRedraw = onRedraw || (() => {});
    this.kind = 'webgl'; this.drawsInScene = true; // the picture is part of the three.js scene (app.js: no separate canvas, the drag resolution is the renderer's)
    this.active = false; this.texture = null; this.seriesId = null; this.dataSignature = ''; this.planSignature = ''; this.textureDims = [1, 1, 1]; this.textureBytes = 0; this.reducedVolume = false;
    this.lastCacheHit = false; this.analysisOverlaySignature = ''; this.volume = null; this.dataGeneration = 0; this.interactive = false; this.interactionTier = 0;
    this.halfExtents = [1, 1, 1]; this.step = 0.002; this.calibration = { slope: 1, intercept: 0, signedBias: 0 };
    this.childArgs = null; this.childSignature = ''; this.childTexture = null; this.childTexSignature = ''; this.childList = []; this.childLutTexture = null; this.hasChildren = false; this.materialChild = null; this.materialRegionsChild = null; this.makeMaterial = null;
    this.cpu = null; this.edit = null; this.regions = null; this.editArgs = null; this.previewRuns = null; this.mesh = null; this.material = null; this.materialRegions = null;
    this.vrModule = vr || null; this.dummy = dummyTexture(); this.skipDummy = skipDummyTexture();
    this.regionLut = new THREE.DataTexture(new Float32Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.FloatType); this.regionLut.minFilter = this.regionLut.magFilter = THREE.NearestFilter; this.regionLut.generateMipmaps = false; this.regionLut.needsUpdate = true;
    this.tmpInv = new THREE.Matrix4(); this.tmpOrigin = new THREE.Vector3(); this.tmpQuat = new THREE.Quaternion(); this.raycaster = new THREE.Raycaster();
    this.color = new THREE.Color();
  }
  maxTexture3D() { try { const gl = this.renderer.getContext(); return gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) || 256; } catch { return 256; } }
  support(v, { maxTextureBytes = 0, targetInPlane = 0 } = {}) {
    const s = v?.series; if (!v?.sourceBacked || !s) return { ok: false, reason: 'GPU volume currently targets source-backed DICOM' };
    if (!this.renderer) return { ok: false, reason: 'WebGL renderer unavailable' };
    if (!s.slices.length || s.slices.some(m => m.bits !== 16 || m.samples !== 1 || !UNCOMPRESSED_TS.has(m.ts))) return { ok: false, reason: '16-bit uncompressed single-channel DICOM required' };
    if (s.slices.some(m => m.rows !== s.rows || m.columns !== s.columns)) return { ok: false, reason: 'Inconsistent DICOM matrix' };
    const first = s.slices[0], slope = first.slope, intercept = first.intercept, signed = !!first.signed;
    if (s.slices.some(m => Math.abs(m.slope - slope) > 1e-9 || Math.abs(m.intercept - intercept) > 1e-6 || !!m.signed !== signed)) return { ok: false, reason: 'Per-slice calibration differs' };
    const lim = this.maxTexture3D(), plan = volumeTexturePlan(v, maxTextureBytes, lim, targetInPlane > 0 ? targetInPlane : WEBGL_VOLUME_SIDE);
    if (plan.dims.some(n => n > lim)) return { ok: false, reason: 'Volume exceeds MAX_3D_TEXTURE_SIZE ' + lim };
    return { ok: true, plan };
  }
  // one upload at a time, like MedicalVolumeRenderer.ensure
  ensure(v, options) {
    const run = (this.ensureQueue || Promise.resolve()).then(() => this.ensureNow(v, options));
    this.ensureQueue = run.catch(() => {});
    return run;
  }
  async ensureNow(v, { maxTextureBytes = 0, targetInPlane = 0 } = {}) {
    const support = this.support(v, { maxTextureBytes, targetInPlane }); if (!support.ok) throw new Error(support.reason);
    const s = v.series, plan = support.plan, [tw, th, td] = plan.dims, planSignature = plan.dims.join('x');
    const dataSignature = v.filterSignature && typeof v.sliceData === 'function' ? String(v.filterSignature) : '';
    const inPlace = this.seriesId === s.id && !!this.texture && this.planSignature === planSignature;
    if (inPlace && (this.dataSignature || '') === dataSignature) { this.volume = v; return; }
    if (!inPlace) this.resetData();
    const generation = this.dataGeneration, superseded = () => { if (this.dataGeneration !== generation) throw new Error('__SUPERSEDED__'); };
    const cancelled = () => { if (typeof v.isCancelled === 'function' && v.isCancelled()) throw new Error('__SUPERSEDED__'); };
    this.volume = v; this.onStatus('WEBGL VOLUME UPLOAD');
    if (!this.vrModule) throw new Error('webgl-volume: the VR module (its shader strings) was not handed over');
    superseded();
    if (inPlace) this.dataSignature = 'partial';
    const first = s.slices[0], signed = !!first.signed, slope = first.slope || 1, intercept = first.intercept || 0, bias = signed ? 32768 : 0;
    const sliceBytes = dataSignature ? async z => { cancelled(); return packCtSlice(await v.sliceData(z), first); } : async z => { cancelled(); return packedRgSlice(s.slices[z]); };
    const data = new Uint8Array(tw * th * td * 2), sliceSize = tw * th * 2;
    const spans = (n, t) => { const a = new Uint32Array(t + 1); for (let i = 0; i <= t; i++) a[i] = Math.min(n, Math.round(i * n / t)); for (let i = 0; i < t; i++) if (a[i + 1] <= a[i]) a[i + 1] = Math.min(n, a[i] + 1); return a; };
    const xs = spans(s.columns, tw), ys = spans(s.rows, th), rowSum = new Float64Array(tw), rowCnt = new Uint32Array(tw);
    const zMap = new Uint32Array(td); for (let z = 0; z < td; z++) zMap[z] = td <= 1 ? 0 : Math.round(z * (s.slices.length - 1) / (td - 1));
    for (let z = 0; z < td; z++) {
      const packed = await sliceBytes(plan.reduced ? zMap[z] : z), out = data.subarray(z * sliceSize, (z + 1) * sliceSize);
      superseded();
      if (plan.reduced) reduceSliceArea(packed, s.columns, xs, ys, tw, th, tw * 2, out, rowSum, rowCnt); else out.set(packed.subarray(0, sliceSize));
      if ((z & 15) === 15 || z === td - 1) { this.onProgress(z + 1, td); await new Promise(r => setTimeout(r, 0)); superseded(); }
    }
    const calibration = [slope, intercept, bias], { bricks, brickDims } = computeBricksOf(data, [tw, th, td], calibration, BRICK);
    superseded();
    const vol = new THREE.Data3DTexture(data, tw, th, td); vol.format = THREE.RGFormat; vol.type = THREE.UnsignedByteType;
    vol.minFilter = vol.magFilter = (globalThis.__vrlSettings?.interpLevel?.() ?? 1) === 0 ? THREE.NearestFilter : THREE.LinearFilter; vol.unpackAlignment = 1; vol.generateMipmaps = false; vol.needsUpdate = true;
    const brickTex = new THREE.Data3DTexture(bricks, ...brickDims); brickTex.format = THREE.RGBAFormat; brickTex.type = THREE.FloatType; brickTex.minFilter = brickTex.magFilter = THREE.NearestFilter; brickTex.unpackAlignment = 1; brickTex.generateMipmaps = false; brickTex.needsUpdate = true;
    const px = s.columns * s.spacingX, py = s.rows * s.spacingY, pz = s.slices.length * s.spacingZ, maxP = Math.max(px, py, pz, 1), scale = 3.3 / maxP;
    this.halfExtents = [px * scale * 0.5, py * scale * 0.5, pz * scale * 0.5];
    this.step = Math.max(1e-5, Math.min(px / tw, py / th, pz / td) * scale * 0.85);
    const old = [this.texture, this.bricksTexture]; // the previous data of the same series (a filter changed): replaced in one go
    this.texture = vol; this.bricksTexture = brickTex; this.cpu = { data, dims: [tw, th, td], calibration }; this.brickDims = brickDims;
    this.calibration = { slope, intercept, signedBias: bias }; this.textureDims = [tw, th, td]; this.reducedVolume = !!plan.reduced; this.textureBytes = plan.bytes;
    this.planSignature = planSignature; this.dataSignature = dataSignature; this.seriesId = s.id;
    this.ensureMaterial(); this.bindData();
    for (const t of old) t?.dispose();
    this.applyEdits(); this.applyRegions(true); this.applyChildren();
    this.onStatus(plan.reduced ? 'WEBGL VOLUME RESIDENT · REDUCED' : 'WEBGL VOLUME RESIDENT');
    this.onRedraw();
  }
  // ---- material / uniforms ----
  uniformSet() {
    const V3 = (...a) => new THREE.Vector3(...a), V4 = (...a) => new THREE.Vector4(...a), four = f => [0, 1, 2, 3].map(f);
    return {
      vol: { value: null }, bricks: { value: null }, halfExt: { value: V3(1, 1, 1) }, boxC: { value: V3() }, boxH: { value: V3() }, boxEntry: { value: 0 }, texDims: { value: V3(1, 1, 1) }, brickDims: { value: V3(1, 1, 1) },
      stepSize: { value: 0.002 }, diag: { value: 0 }, calib: { value: V3(1, 0, 0) }, segA: { value: four(() => V4()) }, segC: { value: four(() => V4()) }, segM: { value: four(() => V4(...materialVec('standard'))) },
      ctShade: { value: 0 }, ctShadeBright: { value: SHADE_BRIGHT_DEFAULT }, ctShadeContrast: { value: SHADE_CONTRAST_DEFAULT }, ctShadeRange: { value: four(() => new THREE.Vector2(0, 1)) }, sliceSegOnly: { value: 0 },
      cutPlanes: { value: Array.from({ length: MAX_SECTION_PLANES }, () => V4(0, 0, 1, 0)) }, planeCount: { value: 0 }, planeCut: { value: 0 }, planeSlice: { value: 0 }, capOn: { value: 0 }, capAlpha: { value: 0.85 }, capHatch: { value: 0 }, capShade: { value: 0 },
      sliceTint: { value: 0 }, sliceOpacity: { value: 0 }, sliceWindow: { value: new THREE.Vector2(0, 1) }, sliceAir: { value: SLICE_AIR }, sliceVol: { value: null },
      regionTex: { value: this.dummy }, regionLut: { value: null }, regionAnyHidden: { value: 0 }, refine: { value: 1 },
      useCls: { value: 0 }, clsTex: { value: this.dummy }, cls4Tex: { value: this.dummy }, useSkip: { value: 0 }, skipTex: { value: this.skipDummy }, clsChan: { value: V4(-1, -1, -1, -1) },
      editMask: { value: 0 }, editMaskOnly: { value: 0 }, editTex: { value: this.dummy }, useDist: { value: 0 }, distInCls: { value: 0 }, distTex: { value: this.dummy }, voxelMin: { value: 1 }, voxelSize: { value: V3(1, 1, 1) },
    };
  }
  ensureMaterial() {
    if (this.mesh) return;
    const { vertexShader, fragmentShader } = this.vrModule;
    this.uniforms = this.uniformSet();
    const fragment = patchFragmentShader(fragmentShader);
    const make = (defines, frag = fragment) => { const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader: frag, side: THREE.BackSide, toneMapped: false, uniforms: this.uniforms, defines });
      m.transparent = false; m.depthWrite = false; m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; return m; };
    this.material = make({}); this.materialRegions = make({ VRL_REGIONS: '' });
    this.makeMaterial = make; // the two programs with VRL_CHILDREN are made when the first child segment arrives (childMaterial)
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10; this.mesh.raycast = () => {}; this.mesh.name = 'webgl_volume'; this.mesh.visible = false;
  }
  bindData() {
    const u = this.uniforms, [tw, th, td] = this.textureDims;
    u.vol.value = this.texture; u.sliceVol.value = this.texture; u.bricks.value = this.bricksTexture;
    u.halfExt.value.set(...this.halfExtents); u.texDims.value.set(tw, th, td); u.brickDims.value.set(...this.brickDims);
    u.calib.value.set(this.calibration.slope, this.calibration.intercept, this.calibration.signedBias);
    const voxel = this.halfExtents.map((h, i) => 2 * h / this.textureDims[i]);
    u.voxelSize.value.set(...voxel); u.voxelMin.value = Math.min(...voxel);
  }
  // ---- edits (processing masks) / analysis results ----
  // edits: gpuVolumeEditDescriptors() = {segmentKey: {mode: 'keep' | 'exclude', runs, maskOnly}}; segmentOrder: the four GPU slots
  setEditRuns(edits, segmentOrder, v) {
    this.editArgs = v && segmentOrder?.length ? { edits, segmentOrder, v } : null;
    this.applyEdits();
  }
  currentEditDescs() {
    const a = this.editArgs; if (!a) return null;
    const descs = [];
    a.segmentOrder.slice(0, 4).forEach((key, si) => {
      const d = a.edits?.[key] || null;
      if (d?.runs) descs.push({ si, mode: d.mode, maskOnly: !!d.maskOnly, runs: d.runs });
    });
    return descs;
  }
  applyEdits() {
    if (!this.uniforms) return;
    const a = this.editArgs, u = this.uniforms;
    this.edit = null;
    const old = this.editTexture; this.editTexture = null;
    const descs = a && this.texture ? this.currentEditDescs() : null;
    if (descs?.length) {
      // the mask grid; an exclusion is grown by one voxel (as medical-volume.js does on a reduced grid): the HU is sampled trilinearly, so without it a half-voxel shell of the excluded
      // voxels stays drawn around a deleted region (the mask itself is then in the mask grid: buildEditMaskOf gets identical source and target grids)
      const dims = maskDims(this.textureDims), src = [a.v.columns, a.v.rows, a.v.slices];
      const mapped = descs.map(d => ({ ...d, runs: gpuRunsForTexture(d.runs, src, dims, { dilate: d.mode === 'exclude' ? 1 : 0 }) }));
      const built = buildEditMaskOf(mapped, dims, dims);
      if (built.data) {
        const t = new THREE.Data3DTexture(built.data, ...dims); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true;
        this.editTexture = t; this.edit = { activeMask: built.activeMask, maskOnly: built.maskOnly, data: built.data, dims };
      }
    }
    u.editMask.value = this.edit?.activeMask | 0; u.editMaskOnly.value = this.edit?.maskOnly | 0; u.editTex.value = this.editTexture || this.dummy;
    old?.dispose();
    this.onRedraw();
  }
  // the cut being previewed is painted on the segment's surface like a focused result, in the WebGPU volume's red (previewContains there)
  clearPreviewRuns() { if (!this.previewRuns) return; this.previewRuns = null; this.applyRegions(true); }
  setPreviewRuns(key, runs, segmentOrder, v) {
    const slot = segmentOrder?.indexOf?.(key) ?? -1;
    if (!v || !runs || slot < 0) { this.clearPreviewRuns(); return; }
    this.previewRuns = { slot, runs, v }; this.applyRegions(true);
  }
  clearAnalysisRuns() { this.analysisOverlaySignature = ''; this.regionsArgs = null; this.applyRegions(true); }
  // regions: [{runs, color, focused, segments (slot indices), shown (default true), hidden (default false; an earlier change: the SHAPE is hidden: drawn as a hidden child, the table's hide bits)}]. The index texture holds one index PER RESULT (1..255, a later result wins where two overlap:, as the VR volume);
  // the look-up table regionLut says, per result, its colour and the slots it is drawn on (0 = hidden: only that result stops colouring, the data and the index stay). Every result the page has is passed,
  // a hidden one with shown false (analysis-ops.js syncVolumeAnalysisOverlay), so hiding / showing / focusing one rewrites 4 KB of the table and never the index.
  setAnalysisRuns(regions, v, signature = '', textureSignature = signature) {
    if (signature && signature === this.analysisOverlaySignature) return;
    this.analysisOverlaySignature = signature;
    this.regionsArgs = v && regions?.length ? { regions, v, textureSignature: textureSignature || null } : null;
    this.applyRegions();
  }
  // A temporary focus for the result whose label the mouse is on (comment-3d.js): `runs` = that result's runsBySlice (the identity of the region passed to setAnalysisRuns), null = none. It only ORs into the focus bit of the table
  // (the page's own selection, region.focused, is never touched: releasing it gives the page's selection back). Rewrites the 4 KB table only when it changes; never rebuilds the index while a cut preview is shown (applied later).
  setHoverFocus(runs) {
    runs = runs || null;
    if (runs === this.hoverRuns) return;
    this.hoverRuns = runs;
    if (this.uniforms && this.regionTexture && !this.previewRuns) this.applyRegions();
  }
  // The same for a CHILD segment (comment-3d.js: the mouse on a child's name card): key = the child's key, '' = none. Only its own row-0 colour in the child table is scaled (applyChildFocus); the page's data is never touched.
  // Rewrites the table (8 KB) only when it changes; nothing at all while the view has no child segments.
  setHoverChildFocus(key) {
    key = key || '';
    if (key === (this.hoverChild || '')) return;
    this.hoverChild = key;
    if (this.uniforms && this.childArgs && this.childTexture) this.applyChildren();
  }
  regionItems() {
    const hv = this.hoverRuns;
    const items = (this.regionsArgs?.regions || []).map(r => ({ color: r.color, focused: !!r.focused || (!!hv && r.runs === hv), shown: r.shown !== false, hidden: r.hidden === true, segMask: (r.segments || []).reduce((m, i) => (i >= 0 && i < 4 ? m | (1 << i) : m), 0), runsBySlice: r.runs, mm3: 0, segmentKeys: [], rid: 0 }));
    const pv = this.previewRuns;
    if (pv) items.push({ color: PREVIEW_COLOR, focused: true, shown: true, segMask: 1 << pv.slot, runsBySlice: pv.runs, mm3: 0, segmentKeys: [], rid: 0 });
    return items;
  }
  applyRegions(rebuild = false) {
    if (!this.uniforms) return;
    const u = this.uniforms, pv = this.previewRuns, args = this.regionsArgs, items = this.regionItems();
    const reuse = !rebuild && !pv && !!this.regionTexture && !!args && !!args.textureSignature && this.regionTexSignature === args.textureSignature && this.regionIndexed === items.length;
    if (!reuse) {
      const old = this.regionTexture; this.regionTexture = null; this.regionIndexed = 0; this.regionTexSignature = null; this.regionRg = null;
      if (items.length && this.texture) {
        const v = args?.v || pv.v, dims = maskDims(this.textureDims), built = packIndexRg(buildRegionIndexOf(items, [v.columns, v.rows, v.slices], dims));
        this.regionIndexed = built.list.length;
        // an earlier change: RG8 as the VR one (R = colour index, G = hide index), the one array kept (packIndexRg); the pick reads its G bytes (regionRg)
        if (built.rg) { const t = new THREE.Data3DTexture(built.rg, ...dims); t.format = THREE.RGFormat; this.regionRg = built.rg; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true; this.regionTexture = t; this.regionTexSignature = pv ? null : args?.textureSignature; }
      }
      old?.dispose();
    }
    // the table: texel i = result i (list order, up to 255): rgb = colour, a = the slot bits it is drawn on (+16 when focused), 0 when its colour is off; an earlier change: a hidden SHAPE = the slot bits << 8 (region-visibility.js regionLutAlpha, read by the VR shader's regionHiddenAt)
    const a = this.regionLut.image.data; a.fill(0);
    if (this.regionTexture) items.slice(0, 255).forEach((it, i) => { const o = (i + 1) * 4; this.color.setHex(Number(it.color) >>> 0); a[o] = this.color.r; a[o + 1] = this.color.g; a[o + 2] = this.color.b; a[o + 3] = regionLutAlpha(it.segMask, { shown: it.shown, hidden: it.hidden, focused: it.focused }); });
    { let any = 0; for (let i = 1; i <= items.length && i < 256; i++) if (regionLutHiddenSlots(a[i * 4 + 3])) { any = 1; break; } u.regionAnyHidden.value = any; } // an earlier change: as vr-view.js refreshRegionLut, from the table just written (the VR shader reads regionHiddenAt only while this is 1)
    this.regionLut.needsUpdate = true; u.regionLut.value = this.regionLut;
    u.regionTex.value = this.regionTexture || this.dummy;
    this.hasRegions = !!this.regionTexture;
    if (this.mesh) this.mesh.material = this.pickMaterial();
    this.onRedraw();
  }
  // ---- child segments ----
  // the program for the current results / child segments state: with no child segment exactly the two of before
  pickMaterial() { return this.hasChildren ? this.childMaterial(this.hasRegions) : this.hasRegions ? this.materialRegions : this.material; }
  childMaterial(regions) {
    if (!this.materialChild) {
      const fragment = patchFragmentShader(this.vrModule.fragmentShader, { children: true });
      this.materialChild = this.makeMaterial({ VRL_CHILDREN: '' }, fragment); this.materialRegionsChild = this.makeMaterial({ VRL_CHILDREN: '', VRL_REGIONS: '' }, fragment);
    }
    return regions ? this.materialRegionsChild : this.materialChild;
  }
  // entries = childRenderEntries() (segments.js), v = the source volume, signature: changes when anything of the entries changes (the page's syncChildSegmentsToVolume, also called by the WebGPU volume's setChildSegments)
  setChildSegments(entries, v, signature = '') {
    if (signature && signature === this.childSignature) return;
    this.childSignature = signature;
    this.childArgs = v && entries?.length ? { entries, v } : null;
    this.applyChildren();
  }
  clearChildSegments() { this.childSignature = ''; this.childArgs = null; this.applyChildren(); }
  applyChildren() {
    if (!this.childArgs && !this.childTexture) return; // no child segments and none before: nothing at all (the usual data)
    if (!this.uniforms) return;
    const u = this.uniforms, a = this.childArgs, items = a && this.texture ? childItemsOfEntries(a.entries) : [];
    if (!items.length) {
      const old = this.childTexture; this.childTexture = null; this.childTexSignature = ''; this.childList = [];
      if (u.childTex) { u.childTex.value = this.dummy; u.childLut.value = this.dummy; u.childAnyHidden.value = 0; }
      old?.dispose();
      if (this.hasChildren) { this.hasChildren = false; if (this.mesh) this.mesh.material = this.pickMaterial(); this.onRedraw(); }
      return;
    }
    const dims = maskDims(this.textureDims), texSig = this.textureDims.join('x') + '|' + this.seriesId + '|' + this.dataGeneration + '|' + items.map(i => i.key + ':' + i.hash).join(',');
    if (!(this.childTexture && this.childTexSignature === texSig)) {
      const built = packIndexRg(buildChildIndexOf(items, [a.v.columns, a.v.rows, a.v.slices], dims)), old = this.childTexture;
      this.childTexture = null; this.childTexSignature = ''; this.childList = built?.list || []; this.childRg = null;
      if (built?.rg) {
        if (built.dropped) console.warn('WebGL volume: ' + built.dropped + ' child segment(s) past the 255th are not drawn.');
        const t = new THREE.Data3DTexture(built.rg, ...dims); t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true; // an earlier change: R = colour index, G = hide index
        this.childTexture = t; this.childTexSignature = texSig; this.childRg = built.rg;
      }
      old?.dispose();
    }
    if (!this.childTexture) { this.childList = []; this.hasChildren = false; if (u.childTex) { u.childTex.value = this.dummy; u.childLut.value = this.dummy; u.childAnyHidden.value = 0; } if (this.mesh) this.mesh.material = this.pickMaterial(); this.onRedraw(); return; }
    syncChildListMasks(this.childList, items); // a reused index texture: the parents' slots may have moved since (the index does not depend on them), the table follows
    if (!this.childLutTexture) { const t = new THREE.DataTexture(new Float32Array(256 * 12), 256, 3, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; this.childLutTexture = t; }
    if (!u.childTex) { u.childTex = { value: this.dummy }; u.childLut = { value: this.dummy }; u.childAnyHidden = { value: 0 }; } // the uniforms exist only once a child segment does
    fillChildLut(this.childLutTexture.image.data, this.childList, a.entries, c => { this.color.set(c); return [this.color.r, this.color.g, this.color.b]; }, m => MATERIALS[materialKey(m)]);
    { const d = this.childLutTexture.image.data; let any = 0; for (let j = 1; j <= this.childList.length && j < 256; j++) if (d[256 * 4 + j * 4 + 3] > 0) { any = 1; break; } u.childAnyHidden.value = any; } // an earlier change: as vr-view.js refreshChildLut (the shader's per-sample hidden test runs only while something is hidden)
    if (this.hoverChild) applyChildFocus(this.childLutTexture.image.data, this.childList, this.hoverChild); // the child whose card the mouse is on stays lit through a table rewrite
    this.childLutTexture.needsUpdate = true;
    u.childTex.value = this.childTexture; u.childLut.value = this.childLutTexture;
    this.hasChildren = true;
    if (this.mesh) this.mesh.material = this.pickMaterial();
    this.onRedraw();
  }
  // the cut-face shading range of a child without one of its own is the one the app resolves per key (section.shade.ranges); row 1 is rewritten only when one changed (as medical-volume.js refreshChildShade)
  refreshChildShade(ranges) {
    const a = this.childArgs, lut = this.childLutTexture; if (!this.hasChildren || !a || !lut) return;
    const R = 256 * 4, d = lut.image.data, byKey = new Map(a.entries.map(x => [x.key, x])); let dirty = false;
    this.childList.forEach((e, j) => {
      const en = byKey.get(e.key), o = (j + 1) * 4; if (!en || j + 1 >= 256) return;
      const [lo, hi0] = childShadeOf(en, ranges?.[e.key]), hi = Math.max(hi0, lo + 1e-3);
      if (d[R + o] !== lo || d[R + o + 1] !== hi) { d[R + o] = lo; d[R + o + 1] = hi; dirty = true; }
    });
    if (dirty) lut.needsUpdate = true;
  }
  // ---- state the page reads ----
  hasResident() { return false; } // MPR planes come from the MPR cache (CPU), not from this texture
  hasPreview() { return false; }
  isReduced() { return this.reducedVolume; }
  setActive(on) {
    this.active = !!on;
    if (this.mesh) { this.mesh.visible = this.active && !!this.texture; if (!this.active && this.mesh.parent) this.mesh.parent.remove(this.mesh); } // out of the scene while the surface view is shown (no ray cast / bounds see it)
    this.onRedraw();
  }
  setInteractive(active, tier = 0) { this.interactive = !!active; this.interactionTier = active ? Math.max(0, Math.min(2, Math.round(+tier || 0))) : 0; }
  resize() {}
  resetData() {
    this.dataGeneration++; this.setActive(false);
    if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
    for (const t of [this.texture, this.bricksTexture, this.editTexture, this.regionTexture]) t?.dispose();
    this.childTexture?.dispose(); this.childTexture = null; this.childRg = null; this.childTexSignature = ''; this.childArgs = null; this.childSignature = ''; this.childList = []; this.hasChildren = false;
    this.texture = this.bricksTexture = this.editTexture = this.regionTexture = this.regionRg = null; this.cpu = null; this.edit = null; this.hasRegions = false;
    this.seriesId = null; this.dataSignature = ''; this.planSignature = ''; this.volume = null; this.textureDims = [1, 1, 1]; this.textureBytes = 0; this.reducedVolume = false;
    this.editArgs = null; this.previewRuns = null; this.regionsArgs = null; this.regionIndexed = 0; this.regionTexSignature = null; this.analysisOverlaySignature = '';
    if (this.uniforms) { this.uniforms.vol.value = this.uniforms.sliceVol.value = this.uniforms.bricks.value = null; this.uniforms.editTex.value = this.uniforms.regionTex.value = this.dummy; this.uniforms.editMask.value = this.uniforms.editMaskOnly.value = 0; if (this.uniforms.childTex) { this.uniforms.childTex.value = this.uniforms.childLut.value = this.dummy; } if (this.mesh) this.mesh.material = this.material; }
  }
  destroy() { this.resetData(); this.mesh?.geometry?.dispose(); this.material?.dispose(); this.materialRegions?.dispose(); this.materialChild?.dispose(); this.materialRegionsChild?.dispose(); this.childLutTexture?.dispose(); this.dummy.dispose(); this.skipDummy.dispose(); this.regionLut.dispose(); }
  // ---- one frame: the uniforms; the page then calls renderer.render(scene, camera) ----
  render(camera, obj, segmentState, segmentOrder, mpr = {}) {
    if (!this.active || !this.texture || !this.mesh || !obj) return;
    this.lastMpr = mpr;
    if (this.mesh.parent !== obj) obj.add(this.mesh);
    this.mesh.visible = true;
    const u = this.uniforms, cfg = globalThis.__vrlSettings;
    const interactionStep = this.interactive ? [1.65, 2.0, 2.5][this.interactionTier] || 1.65 : 1;
    u.stepSize.value = this.step * interactionStep * (cfg?.stepScale?.() ?? 1);
    u.refine.value = (cfg?.refineMode?.() ?? 1) | 0;
    for (let s = 0; s < 4; s++) {
      const key = segmentOrder[s], seg = segmentState[key], enabled = seg?.active && seg?.enabled ? 1 : 0;
      u.segA.value[s].set(seg?.min || 0, seg?.max || 0, seg?.opacity ?? 1, enabled);
      this.color.set(seg?.color || '#ffffff'); u.segC.value[s].set(this.color.r, this.color.g, this.color.b, 0);
      const m = MATERIALS[materialKey(seg?.material)]; u.segM.value[s].set(m.ambient, m.spec, m.shininess, 0);
    }
    const ps = planeState(mpr, this.textureDims, this.halfExtents);
    ps.planes.forEach((p, i) => u.cutPlanes.value[i].set(p[0], p[1], p[2], p[3]));
    u.planeCount.value = ps.planeCount; u.planeCut.value = ps.planeCut; u.planeSlice.value = ps.planeSlice; u.sliceOpacity.value = ps.sliceOpacity;
    u.capOn.value = ps.capOn; u.capAlpha.value = ps.capAlpha; u.capHatch.value = ps.capHatch;
    u.sliceWindow.value.set(Number.isFinite(+mpr.windowCenter) ? +mpr.windowCenter : 0, Math.max(1, Number.isFinite(+mpr.windowWidth) ? +mpr.windowWidth : 1));
    const sh = mpr.section?.shade || {}, shadeOn = ps.shade;
    u.capShade.value = shadeOn ? 1 : 0; u.ctShade.value = shadeOn ? 1 : 0;
    u.ctShadeBright.value = brightOf(sh.bright ?? SHADE_BRIGHT_DEFAULT); u.ctShadeContrast.value = contrastOf(sh.contrast ?? SHADE_CONTRAST_DEFAULT);
    if (this.hasChildren) this.refreshChildShade(sh.ranges);
    for (let s = 0; s < 4; s++) { const r = sh.ranges?.[segmentOrder[s]]; if (r && Number.isFinite(r.lower) && Number.isFinite(r.upper)) u.ctShadeRange.value[s].set(r.lower, r.upper); else u.ctShadeRange.value[s].set(0, 1); }
  }
  // ---- pick (CPU) ----
  // an earlier change: what the pick goes through, read from the very tables the shader reads: a hidden result (regionLut alpha bits 8..11) and a hidden child segment (childLut row 1, hidden mask); both indexes are on the mask grid
  hiddenTest() {
    const dims = maskDims(this.textureDims), layers = [];
    const rl = this.regionLut?.image?.data, rids = this.regionTexture ? this.regionRg : null; // an earlier change: the hide index (the texture's G channel), never the grown colour index
    if (rl && rids) { const slotsOf = id => (id < 256 ? regionLutHiddenSlots(rl[4 * id + 3]) : 0); let any = false; for (let i = 1; i < 256; i++) if (slotsOf(i)) { any = true; break; } layers.push({ ids: rids, stride: 2, off: 1, dims, slotsOf, any }); }
    const cl = this.childLutTexture?.image?.data, cids = this.hasChildren && this.childTexture ? this.childRg : null;
    if (cl && cids) { const R = 256 * 4, slotsOf = id => (id < 256 ? Math.round(cl[R + 4 * id + 3]) & 15 : 0); let any = false; for (let i = 1; i < 256; i++) if (slotsOf(i)) { any = true; break; } layers.push({ ids: cids, stride: 2, off: 1, dims, slotsOf, any }); }
    return hiddenTestOf(layers);
  }
  pickMany(points, camera, obj, segmentState, segmentOrder, preferredKey = null) {
    if (!this.active || !this.cpu || !obj || !points?.length) return Promise.resolve(points?.map(() => null) || []);
    camera.updateMatrixWorld(true); obj.updateMatrixWorld(true);
    const rect = this.renderer.domElement.getBoundingClientRect(), inv = this.tmpInv.copy(obj.matrixWorld).invert();
    const segs = [0, 1, 2, 3].map(s => { const seg = segmentState[segmentOrder[s]]; return { min: seg?.min || 0, max: seg?.max || 0, enabled: !!(seg?.active && seg?.enabled) }; });
    const preferred = preferredKey ? segmentOrder.indexOf(preferredKey) : -1, hidden = this.hiddenTest();
    const out = points.map(p => {
      const ndc = new THREE.Vector2(((p.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -((p.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1);
      this.raycaster.setFromCamera(ndc, camera);
      const o = this.raycaster.ray.origin.clone().applyMatrix4(inv), d = this.raycaster.ray.direction.clone().transformDirection(inv);
      const hit = pickRay({ data: this.cpu.data, dims: this.cpu.dims, calibration: this.cpu.calibration, halfExt: this.halfExtents, step: this.step, origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z], segs, edit: this.edit, preferred, srcDims: [this.volume.columns, this.volume.rows, this.volume.slices], hidden });
      return hit ? { x: hit.x, y: hit.y, z: hit.z, key: segmentOrder[hit.slot] } : null;
    });
    return Promise.resolve(out);
  }
  async pick(clientX, clientY, camera, obj, segmentState, segmentOrder, preferredKey = null) {
    return (await this.pickMany([{ clientX, clientY }], camera, obj, segmentState, segmentOrder, preferredKey))[0] || null;
  }
}
