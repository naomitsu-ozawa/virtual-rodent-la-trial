import * as THREE from './vendor/three@0.186.0/build/three.module.js';
import { volumeTexturePlan, reduceSliceArea, packedRgSlice, packCtSlice } from './medical-volume.js?v=20261109-build704';
import { computeBricksOf, buildEditMaskOf, buildRegionIndexOf, BRICK } from './vr-volume-prep.js?v=20261109-build704';
import { gpuRunsForTexture } from './gpu-runs.js?v=20261109-build704';
import { MATERIALS, materialKey, materialVec } from './lighting.js?v=20261109-build704';
import { MAX_SECTION_PLANES } from './vr-section-frame.js?v=20261109-build704';
import { SHADE_BRIGHT_DEFAULT, SHADE_CONTRAST_DEFAULT, brightOf, contrastOf } from './cap-shade.js?v=20261109-build704';
import { pickRay } from './webgl-volume-pick.js?v=20261109-build704';

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
  { name: 'cap-lit', find: 'VRL_MP vec3 lit=mix(regionColor(cp,segC[ci].rgb,ci),vec3(1.0),0.22)*diffuse;', put: 'VRL_MP vec3 lit=mix(regionColor(cp,segC[ci].rgb,ci),vec3(1.0),0.22)*diffuse*capHatchF(cp,capPlane)*capShadeF(cp,ci);', all: true },
  { name: 'cap-functions', find: 'void main(){\n gl_FragDepth=gl_FragCoord.z;', put: `float capHatchF(vec3 cp,int pl){
 if(capHatch<0.5)return 1.0;
 vec3 tc=texCoord(cp);vec3 n=abs(cutPlanes[pl].xyz);vec2 uv=n.z>0.5?tc.xy:(n.y>0.5?tc.xz:tc.yz);
 return abs(fract((uv.x+uv.y)*${CAP_HATCH_FREQ}.0)-0.5)<0.14?0.26:1.0;
}
float capShadeF(vec3 cp,int s){return capShade>0.5?ctLumHU(huAt(texCoord(cp)),s):1.0;}
vec3 regionLit(vec3 p,vec3 base,int s,float diffuse,float spec){
#ifdef VRL_REGIONS
 int i=int(texture(regionTex,clamp(texCoord(p),vec3(0.0),vec3(0.999999))).r*255.0+0.5);
 if(i>=1){vec4 e=texelFetch(regionLut,ivec2(i,0),0);int m=int(e.a+0.5);if(((m>>s)&1)==1)return e.rgb*diffuse*(((m>>4)&1)==1?1.18:1.0)+vec3(spec);}
#endif
 return base*diffuse+vec3(spec);
}
void main(){\n gl_FragDepth=gl_FragCoord.z;` },
  // which planes show their slice image (a cutting plane whose image is hidden still clips and draws the cap)
  { name: 'plane-slice', find: 'if(crossT[i]>=t-1e-5&&crossT[i]<=endT+1e-5){sliceT[nSlice]=crossT[i];nSlice++;}', put: 'if(((planeSlice>>i)&1)==1&&crossT[i]>=t-1e-5&&crossT[i]<=endT+1e-5){sliceT[nSlice]=crossT[i];nSlice++;}' },
];
export function patchFragmentShader(src) {
  let out = src;
  for (const p of SHADER_PATCHES) {
    if (!out.includes(p.find)) throw new Error('webgl-volume: shader anchor "' + p.name + '" not found in the VR fragment shader (vr-view.js changed it)');
    out = p.all ? out.split(p.find).join(p.put) : out.replace(p.find, () => p.put);
  }
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
    this.applyEdits(); this.applyRegions(true);
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
      regionTex: { value: this.dummy }, regionLut: { value: null }, refine: { value: 1 },
      useCls: { value: 0 }, clsTex: { value: this.dummy }, cls4Tex: { value: this.dummy }, useSkip: { value: 0 }, skipTex: { value: this.skipDummy }, clsChan: { value: V4(-1, -1, -1, -1) },
      editMask: { value: 0 }, editMaskOnly: { value: 0 }, editTex: { value: this.dummy }, useDist: { value: 0 }, distInCls: { value: 0 }, distTex: { value: this.dummy }, voxelMin: { value: 1 }, voxelSize: { value: V3(1, 1, 1) },
    };
  }
  ensureMaterial() {
    if (this.mesh) return;
    const { vertexShader, fragmentShader } = this.vrModule;
    this.uniforms = this.uniformSet();
    const fragment = patchFragmentShader(fragmentShader);
    const make = defines => { const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader: fragment, side: THREE.BackSide, toneMapped: false, uniforms: this.uniforms, defines });
      m.transparent = false; m.depthWrite = false; m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; return m; };
    this.material = make({}); this.materialRegions = make({ VRL_REGIONS: '' });
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
  // regions: [{runs, color, focused, segments (slot indices), shown (default true)}]. The index texture holds one index PER RESULT (1..255, a later result wins where two overlap:, as the VR volume);
  // the look-up table regionLut says, per result, its colour and the slots it is drawn on (0 = hidden: only that result stops colouring, the data and the index stay). Every result the page has is passed,
  // a hidden one with shown false (analysis-ops.js syncVolumeAnalysisOverlay), so hiding / showing / focusing one rewrites 4 KB of the table and never the index.
  setAnalysisRuns(regions, v, signature = '', textureSignature = signature) {
    if (signature && signature === this.analysisOverlaySignature) return;
    this.analysisOverlaySignature = signature;
    this.regionsArgs = v && regions?.length ? { regions, v, textureSignature: textureSignature || null } : null;
    this.applyRegions();
  }
  regionItems() {
    const items = (this.regionsArgs?.regions || []).map(r => ({ color: r.color, focused: !!r.focused, shown: r.shown !== false, segMask: (r.segments || []).reduce((m, i) => (i >= 0 && i < 4 ? m | (1 << i) : m), 0), runsBySlice: r.runs, mm3: 0, segmentKeys: [], rid: 0 }));
    const pv = this.previewRuns;
    if (pv) items.push({ color: PREVIEW_COLOR, focused: true, shown: true, segMask: 1 << pv.slot, runsBySlice: pv.runs, mm3: 0, segmentKeys: [], rid: 0 });
    return items;
  }
  applyRegions(rebuild = false) {
    if (!this.uniforms) return;
    const u = this.uniforms, pv = this.previewRuns, args = this.regionsArgs, items = this.regionItems();
    const reuse = !rebuild && !pv && !!this.regionTexture && !!args && !!args.textureSignature && this.regionTexSignature === args.textureSignature && this.regionIndexed === items.length;
    if (!reuse) {
      const old = this.regionTexture; this.regionTexture = null; this.regionIndexed = 0; this.regionTexSignature = null;
      if (items.length && this.texture) {
        const v = args?.v || pv.v, dims = maskDims(this.textureDims), built = buildRegionIndexOf(items, [v.columns, v.rows, v.slices], dims);
        this.regionIndexed = built.list.length;
        if (built.ids) { const t = new THREE.Data3DTexture(built.ids, ...dims); t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true; this.regionTexture = t; this.regionTexSignature = pv ? null : args?.textureSignature; }
      }
      old?.dispose();
    }
    // the table: texel i = result i (list order, up to 255): rgb = colour, a = the slot bits it is drawn on (+16 when focused), 0 when hidden
    const a = this.regionLut.image.data; a.fill(0);
    if (this.regionTexture) items.slice(0, 255).forEach((it, i) => { const o = (i + 1) * 4; this.color.setHex(Number(it.color) >>> 0); a[o] = this.color.r; a[o + 1] = this.color.g; a[o + 2] = this.color.b; a[o + 3] = it.shown ? (it.segMask | (it.focused ? 16 : 0)) : 0; });
    this.regionLut.needsUpdate = true; u.regionLut.value = this.regionLut;
    u.regionTex.value = this.regionTexture || this.dummy;
    this.hasRegions = !!this.regionTexture;
    if (this.mesh) this.mesh.material = this.hasRegions ? this.materialRegions : this.material;
    this.onRedraw();
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
    this.texture = this.bricksTexture = this.editTexture = this.regionTexture = null; this.cpu = null; this.edit = null; this.hasRegions = false;
    this.seriesId = null; this.dataSignature = ''; this.planSignature = ''; this.volume = null; this.textureDims = [1, 1, 1]; this.textureBytes = 0; this.reducedVolume = false;
    this.editArgs = null; this.previewRuns = null; this.regionsArgs = null; this.regionIndexed = 0; this.regionTexSignature = null; this.analysisOverlaySignature = '';
    if (this.uniforms) { this.uniforms.vol.value = this.uniforms.sliceVol.value = this.uniforms.bricks.value = null; this.uniforms.editTex.value = this.uniforms.regionTex.value = this.dummy; this.uniforms.editMask.value = this.uniforms.editMaskOnly.value = 0; if (this.mesh) this.mesh.material = this.material; }
  }
  destroy() { this.resetData(); this.mesh?.geometry?.dispose(); this.material?.dispose(); this.materialRegions?.dispose(); this.dummy.dispose(); this.skipDummy.dispose(); this.regionLut.dispose(); }
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
    for (let s = 0; s < 4; s++) { const r = sh.ranges?.[segmentOrder[s]]; if (r && Number.isFinite(r.lower) && Number.isFinite(r.upper)) u.ctShadeRange.value[s].set(r.lower, r.upper); else u.ctShadeRange.value[s].set(0, 1); }
  }
  // ---- pick (CPU) ----
  pickMany(points, camera, obj, segmentState, segmentOrder, preferredKey = null) {
    if (!this.active || !this.cpu || !obj || !points?.length) return Promise.resolve(points?.map(() => null) || []);
    camera.updateMatrixWorld(true); obj.updateMatrixWorld(true);
    const rect = this.renderer.domElement.getBoundingClientRect(), inv = this.tmpInv.copy(obj.matrixWorld).invert();
    const segs = [0, 1, 2, 3].map(s => { const seg = segmentState[segmentOrder[s]]; return { min: seg?.min || 0, max: seg?.max || 0, enabled: !!(seg?.active && seg?.enabled) }; });
    const preferred = preferredKey ? segmentOrder.indexOf(preferredKey) : -1;
    const out = points.map(p => {
      const ndc = new THREE.Vector2(((p.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -((p.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1);
      this.raycaster.setFromCamera(ndc, camera);
      const o = this.raycaster.ray.origin.clone().applyMatrix4(inv), d = this.raycaster.ray.direction.clone().transformDirection(inv);
      const hit = pickRay({ data: this.cpu.data, dims: this.cpu.dims, calibration: this.cpu.calibration, halfExt: this.halfExtents, step: this.step, origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z], segs, edit: this.edit, preferred, srcDims: [this.volume.columns, this.volume.rows, this.volume.slices] });
      return hit ? { x: hit.x, y: hit.y, z: hit.z, key: segmentOrder[hit.slot] } : null;
    });
    return Promise.resolve(out);
  }
  async pick(clientX, clientY, camera, obj, segmentState, segmentOrder, preferredKey = null) {
    return (await this.pickMany([{ clientX, clientY }], camera, obj, segmentState, segmentOrder, preferredKey))[0] || null;
  }
}
