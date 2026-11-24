// WebGPU VR / AR trial (stage 1: the body volume): the WGSL core (docs/vr-wgsl-core.js), the host's pure parts (docs/vr-wgpu.js) and the wiring in vr-view.js.
// CI has no GPU: wgsl_reflect parses every variant (syntax / structure), the uniform layout of the host's packer is checked against the struct the reflection reads,
// the constants and maths shared with the GLSL program are checked against its source, and the WebGL path is checked to be still the default.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, uniformLayout, UNIFORM_FIELDS, BOX_VERTICES, VOLUME_BINDINGS } from '../../docs/vr-wgsl-core.js';
import { vrGpuRequested, eyeUniforms, createVrVolumeRenderer, createComposite, releaseXrLoop, disposeGxRenderer, gxDataValue, gxDataRow, stopRenderLoop, bindGxSession, failGxSession, watchDeviceLost, createGxDiag, gxDiagReport, gxDiagFileName, saveGxDiagText, gxErrorText, watchGxErrors, gxSessionValues, gxFrameValues, gxEscapeHeld, startGxHeartbeat, gxShaderInfo, GX_DIAG_KEY, useMaterialSrgbOutput, bucketSize, fitSlot, scaledRegion, regionClip, regionMvp, bandRects } from '../../docs/vr-wgpu.js';
import { createPlainLabelBatch } from '../../docs/vr-label-batch.js';

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const vr = read('vr-view.js'), core = read('vr-wgsl-core.js'), host = read('vr-wgpu.js'), app = read('app.js');
const VARIANTS = [];
for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const events of [false, true]) VARIANTS.push({ f16, cls4, events });

describe('WGSL core: the variants (the GLSL VRL_* defines as text)', () => {
  it.each(VARIANTS)('f16=$f16 cls4=$cls4 events=$events parses and has a vertex and a fragment entry', v => {
    const src = volumeWgsl(v);
    expect(src).not.toMatch(/undefined|NaN|\$\{/);
    const r = new WgslReflect(src);
    expect(r.entry.vertex.map(e => e.name)).toEqual(['vs']);
    expect(r.entry.fragment.map(e => e.name)).toEqual(['fs']);
  });
  it('f16 is enabled only in the half-precision variant, which keeps the 0.5 test exact (q - 0.5 is taken in f32, then narrowed)', () => {
    expect(volumeWgsl({ f16: false })).not.toMatch(/enable f16|f16\(|<f16>/);
    const h = volumeWgsl({ f16: true });
    expect(h.startsWith('enable f16;')).toBe(true);
    expect(h).toContain('vec4<f16>(q-vec4<f32>(0.5))');
    expect(h).toContain('const SEG_OFF=f16(4.0);');
    expect(volumeWgsl({ f16: false })).toContain('const SEG_OFF=1.0e9;');
  });
  it('cls4 reads the fourth segment from cls4Tex, events compiles the section code', () => {
    expect(volumeWgsl({ cls4: false })).not.toContain('textureSampleLevel(cls4Tex');
    expect(volumeWgsl({ cls4: true })).toContain('textureSampleLevel(cls4Tex');
    expect(volumeWgsl({ events: false })).not.toContain('crossT');
    expect(volumeWgsl({ events: true })).toContain('crossT');
    expect(volumeWgsl({ events: false })).not.toContain('sliceColor(o+dir');
  });
  it('the bindings are the ones the host binds (one bind group: uniforms, six textures, two samplers)', () => {
    const r = new WgslReflect(volumeWgsl({}));
    const got = r.getBindGroups()[0].map(b => [b.name || b.resource?.name, b.binding]).filter(x => x[0]);
    const want = Object.entries({ u: VOLUME_BINDINGS.uniforms, vol: VOLUME_BINDINGS.vol, clsTex: VOLUME_BINDINGS.cls, cls4Tex: VOLUME_BINDINGS.cls4, skipTex: VOLUME_BINDINGS.skip, editTex: VOLUME_BINDINGS.edit, sliceVol: VOLUME_BINDINGS.slice, smp: VOLUME_BINDINGS.sampler, smpE: VOLUME_BINDINGS.samplerEdit });
    for (const [n, b] of want) expect(got.find(x => x[0] === n)?.[1], n).toBe(b);
  });
});

describe('uniform layout: the packer writes where the shader reads', () => {
  it('every member of the struct is at the offset the packer uses (WGSL rules, checked against the reflection)', () => {
    const r = new WgslReflect(volumeWgsl({}));
    const u = r.uniforms.find(x => x.name === 'u');
    const L = uniformLayout();
    expect(u.members.map(m => m.name)).toEqual(UNIFORM_FIELDS.map(f => f[0]));
    for (const m of u.members) expect(L.fields.find(f => f.name === m.name).offset, m.name).toBe(m.offset);
    expect(L.byteSize).toBe(Math.ceil(u.size / 16) * 16);
    expect(L.byteSize % 16).toBe(0);
  });
  it('arrays are vec4 elements (16-byte stride) and vec3 members share their 16 bytes with the next scalar', () => {
    const L = uniformLayout(), at = n => L.fields.find(f => f.name === n);
    for (const n of ['segA', 'segC', 'segM', 'ctShadeRange', 'cutPlanes']) expect(at(n).stride).toBe(16);
    expect(at('stepSize').offset).toBe(at('origin').offset + 12);
    expect(at('cutPlanes').count).toBe(10); // SECTION_PLANES = MAX_SECTION_PLANES (vr-section-frame.js)
  });
  it('the uniform names the packer reads from the session\'s uniforms object exist there (volumeUniforms of vr-view.js)', () => {
    const decl = /const volumeUniforms=\(vd,full,settings\)=>\(\{[\s\S]*?\}\);\n/.exec(vr)[0];
    const perEye = new Set(['mvp', 'origin', 'lightOff', 'jumpOn', 'proxyOn', 'proxyOrg', 'pad1']); // made per eye / per pass by the host
    for (const f of UNIFORM_FIELDS.map(x => x[0]).filter(n => !perEye.has(n))) expect(decl, f).toMatch(new RegExp('\\b' + f + ':\\{value'));
  });
});

describe('the march is the GLSL one: the constants and the shading maths come from the same sources', () => {
  const glsl = /export const fragmentShader=`([\s\S]*?)\n}`;/.exec(vr)[1];
  const num = (re, s) => +re.exec(s)[1];
  it.each([
    ['ACC_STOP', /const float ACC_STOP=([\d.]+);/, /const ACC_STOP:f32=([\d.]+);/],
    ['DEPTH_BIAS_RAY', /const float DEPTH_BIAS_RAY=([\d.]+);/, /const DEPTH_BIAS_RAY:f32=([\d.]+);/],
    ['DEPTH_BIAS_MIN', /const float DEPTH_BIAS_MIN=([\d.]+);/, /const DEPTH_BIAS_MIN:f32=([\d.]+);/],
    ['CT_SHADE_MIN', /#define CT_SHADE_MIN ([\d.]+)/, /const CT_SHADE_MIN:f32=([\d.]+);/],
    ['SEG_ALPHA', /#define SEG_ALPHA ([\d.]+)/, /const SEG_ALPHA:f32=([\d.]+);/],
    ['SECTION_PLANES', /#define SECTION_PLANES (\d+)/, /const SECTION_PLANES:i32=(\d+);/],
  ])('%s equals the GLSL value', (_n, g, w) => { expect(num(w, core)).toBe(num(g, glsl)); });
  it('the jump rules, the skip test and the face rule are the same numbers', () => {
    for (const t of ['dd>=2.7', '(dd-1.8)*jkA/', 'previousT=nextJ-', '1.0/64.0', '63.0/64.0', 'hi<=faceEnd', 'faceEnd=', '0.3)']) expect(volumeWgsl({}).replace(/\s/g, '')).toContain(t.replace(/\s/g, ''));
    for (const t of ['dd>=2.7', '(dd-1.8)*jkA/step', 'previousT=nextJ-step*0.05', 'hi<=faceEnd', '1.0/64.0', '63.0/64.0']) expect(glsl).toContain(t);
  });
  it('the lighting functions come from lighting.js (one model for the meshes, the WebGL volume and this one)', () => {
    const src = volumeWgsl({});
    for (const fn of ['vrlShade', 'vrlRealCut', 'vrlDepth01']) expect(src).toContain('fn ' + fn + '(');
    expect(src).toContain('vrlShade(nn,viewDir,u.lightOff');
  });
  it('the proxy box: 12 triangles, counter-clockwise seen from outside (the pass draws the back faces)', () => {
    expect(BOX_VERTICES.length).toBe(36 * 3);
    for (let t = 0; t < 12; t++) {
      const p = i => BOX_VERTICES.slice((t * 3 + i) * 3, (t * 3 + i) * 3 + 3);
      const a = p(0), b = p(1), c = p(2), e1 = b.map((x, i) => x - a[i]), e2 = c.map((x, i) => x - a[i]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const cen = a.map((x, i) => (x + b[i] + c[i]) / 3);
      expect(n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2], 'triangle ' + t).toBeGreaterThan(0);
    }
  });
});

describe('host: the choice, the per-eye matrices', () => {
  it('the choice is the stored one of the button (no URL parameter: the public build\'s gate rejects unknown URL keys); the default is the WebGL view', () => {
    expect(vrGpuRequested('0')).toBe(false); expect(vrGpuRequested(null)).toBe(false); expect(vrGpuRequested('1')).toBe(true); expect(vrGpuRequested('true')).toBe(false);
    expect(host).not.toMatch(/location\??\.(search|hash)|URLSearchParams|vrgpu=/);
  });
  it('eyeUniforms: origin = the eye in object space, mvp = proj * view * model, lightOff = the GLSL vertex stage\'s headlight', () => {
    const cam = new THREE.PerspectiveCamera(60, 1.1, 0.01, 50);
    cam.position.set(0.3, 1.4, 0.8); cam.rotation.set(-0.2, 0.5, 0.1); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const model = new THREE.Matrix4().compose(new THREE.Vector3(0.1, 1.3, -0.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1, 0.4)), new THREE.Vector3(0.05, 0.05, 0.05));
    const e = eyeUniforms(THREE, model, cam, {});
    const inv = model.clone().invert(), eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).applyMatrix4(inv);
    expect(e.origin.distanceTo(eye)).toBeLessThan(1e-6);
    const mvp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).multiply(model);
    for (let i = 0; i < 16; i++) expect(e.mvp.elements[i]).toBeCloseTo(mvp.elements[i], 5);
    // lighting.js lightingVertexGLSL: normalize(mat3(invModel) * (viewMatrix[0][0], [1][0], [2][0])) * 0.3 + normalize(mat3(invModel) * (viewMatrix[0][1], [1][1], [2][1])) * 0.5
    const V = cam.matrixWorldInverse, m3 = v => new THREE.Vector3(v.x, v.y, v.z).applyMatrix3(new THREE.Matrix3().setFromMatrix4(inv)).normalize();
    const r = m3(new THREE.Vector3(V.elements[0], V.elements[4], V.elements[8])).multiplyScalar(0.3), u = m3(new THREE.Vector3(V.elements[1], V.elements[5], V.elements[9])).multiplyScalar(0.5);
    const want = r.add(u);
    expect(e.lightOff.distanceTo(want)).toBeLessThan(1e-6);
  });
});

describe('the plain label batch (the WebGPU session\'s twin of vr-label-batch.js)', () => {
  it('draws every shown card as its own plane and every shown leg as a line, at the card\'s world matrix; add / remove keep the scene clean', () => {
    const scene = new THREE.Scene();
    const b = createPlainLabelBatch(THREE, scene, { w: 0.12, h: 0.036 });
    const tex = new THREE.Texture(), m = Object.assign(new THREE.Object3D(), { material: { map: tex, opacity: 0.8, depthTest: true } });
    m.position.set(1, 2, 3); m.visible = true; m.updateMatrixWorld(true);
    const line = { geometry: { attributes: { position: new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0], 3) } }, material: { color: new THREE.Color(0xff0000), opacity: 0.9, depthTest: false }, renderOrder: 5, visible: true };
    const lb = { m, line };
    b.add(lb); expect(scene.children.length).toBe(2); expect(b.size).toBe(1);
    b.flush();
    const [card, leg] = scene.children;
    expect(card.visible && leg.visible).toBe(true); expect(card.matrixWorld.elements[12]).toBe(1); expect(card.material.opacity).toBeCloseTo(0.8);
    expect(Array.from(leg.geometry.attributes.position.array)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(b.stats).toMatchObject({ cards: 1, legs: 1, draws: 2 });
    m.visible = false; line.visible = false; b.flush(); expect(card.visible || leg.visible).toBe(false);
    b.remove(lb); expect(scene.children.length).toBe(0); expect(b.size).toBe(0);
  });
});

describe('vr-view.js wiring (static)', () => {
  it('the WebGL session is still the default and the fallback: a WebGLRenderer is made unless the WebGPU choice was honoured, and the page-side WebGL preparation is skipped only when WebGPU is chosen', () => {
    expect(vr).toContain("const r=gpu?.renderer||new THREE.WebGLRenderer({antialias:false,alpha:ar,preserveDrawingBuffer:false});");
    expect(vr).toContain('if(vrGpuRequested()){');
    expect(vr).not.toMatch(/vrgpu=/);
    expect(vr).toContain("if(vrGpuRequested()&&vrGpuAvailable())return null; // WebGPU trial");
    expect(vr).toContain("gx?{...sessionOpts,optionalFeatures:[...sessionOpts.optionalFeatures,'layers'],requiredFeatures:['webgpu']}:sessionOpts"); // 'layers' only on the WebGPU request: the WebGL request is as before
    expect(vr).toContain("gxNote='refused'"); expect(vr).toContain("gxNote='unavailable'"); expect(vr).toContain("gxNote='failed'");
    expect(vr).toContain('renderer=makeGlRenderer();'); // the WebGPU session was refused: the WebGL one opens in the same click
  });
  it('the WebGPU frame branch: the WGSL pass per eye, then the composite in the main render; the WebGL branches are unchanged below it', () => {
    expect(vr).toContain('gx.vol.draw({u:material.uniforms,cams,model:mesh.matrixWorld,f:Math.min(1,f),fov,fp,periK:kF,rects:rsFov,band:rsFov[0][4],variant:{cls4:cls4On,events:material.uniforms.planeCount.value>0},decode:renderer.currentColorSpace===THREE.SRGBColorSpace,boxes:xrCam?rsEyes:null,identCtx:identRun?.active?identCtxNow():null});');
    expect(vr).toContain('}else if(f<1&&lowTarget){');
    expect(vr).toContain('else if(!gx)hideFreeCompile(');
  });
  it('nothing GL-only runs in the WebGPU session: no GLSL compile, no timer query, no GL render target for the offscreen pass', () => {
    expect(vr).toContain('if(renderer.isWebGPURenderer)return mats;');
    expect(vr).toContain("const gl=gx?null:renderer.getContext()");
    expect(vr).toContain('const xrTarget=gx?null:renderer.getRenderTarget()'); // ensureLowTargets (WebGL render targets) is only reached with an XR target
    expect(vr).toContain('labelBatch=gx?createPlainLabelBatch(');
    expect(vr).toContain("const makeLaser=()=>{");
  });
  it('three.js\' XR manager chains to the animation loop that exists when the session is set: on WebGPU the session is set after renderer.setAnimationLoop (a loop set later would replace the XR frame handler)', () => {
    const iLoop = vr.indexOf('renderer.setAnimationLoop(xrTs=>{'), iSet = vr.indexOf('if(gx&&!await bindGxSession(renderer,session,'), iEnd = vr.indexOf("session.addEventListener('end',()=>{if(activeSwapPf)");
    expect(iLoop).toBeGreaterThan(0); expect(iSet).toBeGreaterThan(iLoop); expect(iSet).toBeGreaterThan(iEnd); // after the loop, and after the 'end' handler exists
    expect(vr).toContain('if(!gx)await renderer.xr.setSession(session);'); // WebGL: as before, at the same place
  });
  it('the part cut-out and the sample pair are off in the WebGPU view (stage 1: the body only)', () => {
    expect(vr).toContain('pairHost={ready:()=>!gx&&');
    expect(vr).toContain('if(gx){partDetachRing=()=>{flashMsg(');
  });
  it('the choice button sits next to VR / AR, is hidden with them, and the page decides from vrGpuRequested / vrGpuAvailable', () => {
    const shell = read('ui-shell.js');
    expect(shell).toContain('id="vr-gpu-button" class="secondary-button" type="button" hidden>');
    expect(app).toContain('vrGpuBtn.hidden=vrViewBtn.hidden&&arViewBtn.hidden');
    expect(app).toContain("tr(ok?(vrGpuRequested()?'vrGpuOn':'vrGpuOff'):'vrGpuNo')");
    expect(host).toContain("export const VRGPU_STORE_KEY = 'vrl-vr-gpu'");
  });
});

// ---- the session's life and the offscreen targets, driven with mocks (no GPU in CI) ----
const mockDevice = () => {
  const log = { viewports: [], scissors: [], groups: [], textures: [], used: [] };
  const mkTex = desc => { const t = { desc, destroyed: false, destroy() { this.destroyed = true; }, createView() { return { texture: t }; } }; log.textures.push(t); return t; };
  const pass = {
    setPipeline() {}, setVertexBuffer() {}, setBindGroup(_i, g) { log.groups.push(g); }, setViewport(...a) { log.viewports.push(a); }, setScissorRect(...a) { log.scissors.push(a); }, draw() {}, end() {},
  };
  const device = {
    features: new Set(), queue: { writeBuffer() {}, writeTexture() {}, submit() {} },
    createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}), createSampler: () => ({}), createBuffer: () => ({ destroy() {} }), createShaderModule: () => ({}),
    createRenderPipeline: () => ({}), createRenderPipelineAsync: async () => ({}), createComputePipeline: () => ({}), createComputePipelineAsync: async () => ({}), createTexture: mkTex,
    createBindGroup: d => ({ d }), createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}), copyTextureToBuffer() {} }),
  };
  return { device, log };
};
const withGpuGlobals = fn => async () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
  try { await fn(); } finally { vi.unstubAllGlobals(); }
};
const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
const nodeTextures = comp => ['c1', 'd1', 'c2', 'd2'].map(k => comp.nodes[k].value.sourceTexture);

describe('WebGPU: the passes draw a region of the eye, the viewport is that region and the scissors are what is drawn (A2)', () => {
  it('with the periphery pass on and no box given, the centre pass is the centre rect, the periphery pass is the eye minus four bands around the inner rect', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.draw({ u: {}, cams: [eyeCam(1000, 1000), eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f: 0.5, fov: true, fp: 0.25, rects: [[300, 300, 700, 700]], band: 1, variant: { cls4: false, events: false } });
    // centre pass: x 0.5 -> 150..350 with the 2 px margin = 148..352 (204 px), slot 256 (the step), stride 258
    expect(log.viewports.slice(0, 2)).toEqual([[0, 0, 204, 204, 0, 1], [258, 0, 204, 204, 0, 1]]);
    expect(log.scissors.slice(0, 2)).toEqual([[0, 0, 204, 204], [258, 0, 204, 204]]);
    // periphery (250 px eyes, stride 252): the inner rect shrunk by band + bilinear margin (10 px) = 78..172 px; the bands are top, bottom, left, right of it
    expect(log.viewports.slice(2, 4)).toEqual([[0, 0, 250, 250, 0, 1], [252, 0, 250, 250, 0, 1]]);
    expect(log.scissors.slice(2, 6)).toEqual([[0, 0, 250, 78], [0, 172, 250, 78], [0, 78, 78, 94], [172, 78, 78, 94]]);
    expect(log.scissors.slice(6, 10)).toEqual([[252, 0, 250, 78], [252, 172, 250, 78], [252, 78, 78, 94], [252 + 172, 78, 78, 94]]);
    for (let i = 0; i < log.scissors.length; i++) { const sc = log.scissors[i], vp = log.viewports[i < 2 ? i : i < 6 ? 2 : 3]; expect(sc[0]).toBeGreaterThanOrEqual(vp[0]); expect(sc[1] + sc[3]).toBeLessThanOrEqual(vp[1] + vp[3]); }
    r.dispose();
  }));
  it('without the periphery pass and no box given, viewport and scissor are the eye\'s full image (the same as before)', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.draw({ u: {}, cams: [eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 1, fov: false, rects: null, variant: { cls4: false, events: false } });
    expect(log.viewports).toEqual([[0, 0, 640, 480, 0, 1]]); expect(log.scissors).toEqual([[0, 0, 640, 480]]);
    r.dispose();
  }));
  it('the box\'s rect limits the pass: only that part of the eye is the viewport and the scissor (y up in the rect, y down in the target), at the scale of the pass', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const st = r.draw({ u: {}, cams: [eyeCam(1000, 800), eyeCam(1000, 800)], model: new THREEG.Matrix4(), f: 0.5, boxes: [{ x0: 400, y0: 300, x1: 600, y1: 420 }, { x0: 380, y0: 300, x1: 580, y1: 420 }], variant: { cls4: false, events: false } });
    // eye 0: x 200..300 +-2 = 198..302 (104 px), y (800-420)*0.5 = 190 .. (800-300)*0.5 = 250 +-2 = 188..252 (64 px)
    expect(log.viewports[0]).toEqual([0, 0, 104, 64, 0, 1]);
    expect(log.scissors[0]).toEqual([0, 0, 104, 64]);
    expect(log.viewports[1][2]).toBe(104); expect(log.viewports[1][0]).toBe(128 + 2); // stride = the slot (128, the step above 104) + 2
    expect(st.regions.low).toEqual([[104, 64], [104, 64]]); expect(st.regions.slot).toEqual([128, 64]); expect(st.w).toBe(1000); expect(st.h).toBe(800);
    r.dispose();
  }));
  it('a box that reaches the eye (the whole image) or a missing / broken rect draws the whole image with the identity transform; an empty rect draws a sliver (the margin), never nothing or a negative size', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const cams = [eyeCam(640, 480)], model = new THREEG.Matrix4(), v = { cls4: false, events: false };
    r.draw({ u: {}, cams, model, f: 1, boxes: [{ x0: 0, y0: 0, x1: 640, y1: 480 }], variant: v });
    r.draw({ u: {}, cams, model, f: 1, boxes: [{ x0: NaN, y0: 0, x1: 1, y1: 1 }], variant: v });
    expect(log.viewports).toEqual([[0, 0, 640, 480, 0, 1], [0, 0, 640, 480, 0, 1]]);
    log.viewports.length = 0; log.scissors.length = 0;
    r.draw({ u: {}, cams, model, f: 1, boxes: [{ x0: 700, y0: 100, x1: 700, y1: 100 }], variant: v }); // off to the right, no area
    expect(log.viewports[0][2]).toBe(1); expect(log.viewports[0][3]).toBeGreaterThanOrEqual(1); expect(log.scissors[0].slice(2, 4)).toEqual(log.viewports[0].slice(2, 4)); // 1 px wide at the edge, the margin in y
    r.dispose();
  }));
  it('the host passes viewport and the scissors separately (the WebGL pass of vr-view.js sets the viewport to the eye and the scissor to the centre rect)', () => {
    expect(host).toContain('pass.setViewport(e.vx ?? e.x, e.vy ?? e.y, e.vw ?? e.w, e.vh ?? e.h, 0, 1);');
    expect(host).toContain('for (const sc of e.scissors || [[e.x, e.y, e.w, e.h]]) { pass.setScissorRect(sc[0], sc[1], sc[2], sc[3]); pass.draw(36); }');
    expect(vr).toContain('lowTarget.viewport.set(x,y,vw,vh);'); expect(vr).toContain('lowTarget.scissor.set(sx,sy,');
  });
});

// the GPU timeline of a frame (performance record only): span = first volume pass start to the marker's end, gap = idle before the frame's first start
const timestampDevice = script => { // script = [[begin, end], ...] in ns ticks, one per timed pass in the order the resolves are encoded
  const { device, log } = mockDevice(); const marks = [], resolves = { n: 0 };
  device.features = new Set(['timestamp-query']); device.createQuerySet = () => ({ destroy() {} });
  device.createBuffer = d => { const b = { d, vals: [0n, 0n], destroy() {}, mapAsync: async () => {}, getMappedRange: () => new BigUint64Array(b.vals).buffer, unmap() {} }; return b; };
  device.createTexture = d => ({ d, destroy() {}, createView: () => ({}) });
  const mk = device.createCommandEncoder; const queue = device.queue; let pending = [];
  device.createCommandEncoder = () => { const e = mk(), bp = e.beginRenderPass; e.beginRenderPass = d => { if (d.timestampWrites && d.colorAttachments.length === 1) marks.push('marker'); return bp(d); }; e.resolveQuerySet = () => { resolves.n++; }; e.copyBufferToBuffer = (_s, _o, dst) => { dst.vals = script.shift(); }; return e; };
  queue.submit = () => {};
  return { device, log, marks, pending, resolves };
};
const settle = () => new Promise(r => setTimeout(r, 0));
describe('WebGPU: the frame\'s GPU timeline (span, gap) for the performance record, from the device\'s own timestamps', () => {
  const draw = r => r.draw({ u: {}, cams: [eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 1, fov: false, rects: null, variant: { cls4: false, events: false } });
  it('span = the first volume pass start to the marker end, gap = the previous frame\'s marker end to this frame\'s first start; a frame with no volume pass is no sample and breaks the chain', withGpuGlobals(async () => {
    const { device, marks } = timestampDevice([
      [10_000_000n, 20_000_000n], [20_100_000n, 20_200_000n], // frame 1: vol 10 ms, marker end 20.2 ms -> span 10.2
      [27_000_000n, 35_000_000n], [35_100_000n, 36_000_000n], // frame 2: first start 27 ms -> gap 6.8 ms after the marker end 20.2; span 9
      [50_000_000n, 58_000_000n], [58_100_000n, 59_000_000n], // frame 4 (after a frame with nothing drawn): span 9, no gap
    ]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    draw(r); r.volume.markFrame(); draw(r); r.volume.markFrame();
    r.volume.markFrame(); // nothing drawn in this frame
    draw(r); r.volume.markFrame();
    await settle();
    const st = r.volume.takeFrameStats();
    expect(marks).toHaveLength(3); // no marker (and no timestamp slot) for the frame that drew nothing
    expect(st.spans.map(x => +x.toFixed(3))).toEqual([10.2, 9, 9]);
    expect(st.gaps.map(x => +x.toFixed(3))).toEqual([6.8]);
    expect(r.volume.takeFrameStats()).toBeNull(); // taken once
    r.dispose();
  }));
  it('without timestamp-query (the device has none) markFrame and takeFrameStats do nothing and no marker pass is made', withGpuGlobals(() => {
    const { device, log } = mockDevice(); // features: none
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    draw(r); r.volume.markFrame();
    expect(r.volume.takeFrameStats()).toBeNull(); expect(r.volume.takeGpuMs()).toBeNull(); expect(r.volume.hasTimer).toBe(false);
    r.dispose();
  }));
  it('an unusable timestamp (zero, or the end before the start) makes that frame no sample', withGpuGlobals(async () => {
    const { device } = timestampDevice([[0n, 0n], [1n, 2n], [10_000_000n, 20_000_000n], [20_100_000n, 20_200_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    draw(r); r.volume.markFrame(); draw(r); r.volume.markFrame(); await settle();
    const st = r.volume.takeFrameStats(); expect(st.spans.map(x => +x.toFixed(3))).toEqual([10.2]); expect(st.gaps).toEqual([]);
    r.dispose();
  }));
});

describe('WebGPU: markFrame(false), the page is not recording: no marker pass, the volume pass keeps its own timestamp', () => {
  const draw = r => r.draw({ u: {}, cams: [eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 1, fov: false, rects: null, variant: { cls4: false, events: false } });
  it('makes no marker pass (no resolve / copy / read-back for it) and no span / gap; vol (takeGpuMs) and onFrameVolMs still work; the first recorded frame after it has a span and no gap', withGpuGlobals(async () => {
    const { device, marks, resolves } = timestampDevice([[10_000_000n, 17_500_000n], [20_000_000n, 30_000_000n], [30_100_000n, 30_200_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const got = []; draw(r); r.volume.onFrameVolMs(ms => got.push(ms));
    expect(r.volume.markFrame(false)).toBeNull(); await settle();
    expect(marks).toHaveLength(0); expect(resolves.n).toBe(1); /* the volume pass's own resolve only */ expect(got).toHaveLength(1); expect(got[0]).toBeCloseTo(7.5, 3); expect(r.volume.takeFrameStats()).toBeNull();
    draw(r); r.volume.markFrame(); await settle(); // now recording
    expect(marks).toHaveLength(1); expect(resolves.n).toBe(3); // + the volume pass and the marker of the recorded frame
    const st = r.volume.takeFrameStats(); expect(st.spans.map(x => +x.toFixed(3))).toEqual([10.2]); expect(st.gaps).toEqual([]);
    const g = r.volume.takeGpuMs(); expect(g.n).toBe(2); expect(g.ms).toBeCloseTo(17.5, 3);
    r.dispose();
  }));
  it('the timestamp slots do not run out over many unrecorded frames (the volume pass slots are freed by their read-backs)', withGpuGlobals(async () => {
    const { device, marks, resolves } = timestampDevice(Array.from({ length: 42 }, (_, i) => (i < 41 ? [1_000_000n, 2_000_000n] : [3_000_000n, 3_100_000n])));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    for (let i = 0; i < 40; i++) { draw(r); r.volume.markFrame(false); await settle(); }
    expect(r.volume.takeGpuMs().n).toBe(40); expect(marks).toHaveLength(0); expect(resolves.n).toBe(40);
    draw(r); r.volume.markFrame(); await settle(); expect(marks).toHaveLength(1); expect(resolves.n).toBe(42); // a free slot is found for the marker
    r.dispose();
  }));
  it('the default (no argument) is the recording path: a marker pass per frame, as before', withGpuGlobals(async () => {
    const { device, marks } = timestampDevice([[10_000_000n, 20_000_000n], [20_100_000n, 20_200_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    draw(r); r.volume.markFrame(); await settle(); expect(marks).toHaveLength(1); r.dispose();
  }));
});

describe('WebGPU: onFrameVolMs gives the volume GPU ms of the current frame once its read-backs are in (the performance record\'s vlat)', () => {
  const draw = r => r.draw({ u: {}, cams: [eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 1, fov: false, rects: null, variant: { cls4: false, events: false } });
  it('is called with the sum of the frame\'s volume passes after the read-backs, not before, and once; a frame with nothing drawn never calls it', withGpuGlobals(async () => {
    const { device } = timestampDevice([[10_000_000n, 17_500_000n], [17_600_000n, 17_700_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const got = []; r.volume.onFrameVolMs(ms => got.push('none')); // nothing drawn yet in this frame: no call, ever
    draw(r); r.volume.onFrameVolMs(ms => got.push(ms));
    expect(got).toEqual([]); // the read-back is asynchronous
    r.volume.markFrame(); await settle();
    expect(got).toHaveLength(1); expect(got[0]).toBeCloseTo(7.5, 3);
    r.dispose();
  }));
  it('without timestamp-query it never calls back (vlat stays "-")', withGpuGlobals(async () => {
    const { device } = mockDevice(); const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    let n = 0; draw(r); r.volume.onFrameVolMs(() => n++); r.volume.markFrame(); await settle();
    expect(n).toBe(0); r.dispose();
  }));
});

describe('WebGPU: the drawn region, its steps and the clip change', () => {
  it('bucketSize: steps of 64 up to 256, 128 up to 1024, 256 above; fitSlot keeps the held size while the need stays near it and never exceeds the full size', () => {
    expect([1, 64, 65, 256, 257, 1024, 1025, 2064].map(bucketSize)).toEqual([64, 64, 128, 256, 384, 1024, 1280, 2304]);
    expect(fitSlot(100, null, 2064)).toBe(128);
    expect(fitSlot(110, 128, 2064)).toBe(128); expect(fitSlot(90, 128, 2064)).toBe(128); expect(fitSlot(120, 128, 2064)).toBe(128); // stays
    expect(fitSlot(129, 128, 2064)).toBe(192); // grows at once
    expect(fitSlot(40, 128, 2064)).toBe(64); // 40 * 1.6 = 64 < 128: shrinks to the step of the need
    expect(fitSlot(2100, null, 2064)).toBe(2064); expect(fitSlot(5000, 2300, 2064)).toBe(2064); expect(fitSlot(2064, 2304, 2064)).toBe(2064); // never beyond the image
  });
  it('scaledRegion: the pixels whose centres can lie in the rect plus the margin, clipped to the image, at least 1 px, y flipped', () => {
    expect(scaledRegion([100, 200, 300, 400], 1000, 0.5, 500, 500, 2)).toEqual({ x0: 48, y0: 298, x1: 152, y1: 402 });
    expect(scaledRegion([0, 0, 1000, 1000], 1000, 0.5, 500, 500)).toEqual({ x0: 0, y0: 0, x1: 500, y1: 500 });
    const e = scaledRegion([2000, 0, 2000, 0], 1000, 1, 1000, 1000, 2); expect(e.x1 - e.x0).toBeGreaterThanOrEqual(1); expect(e.x1).toBeLessThanOrEqual(1000); expect(e.x0).toBeLessThan(1000);
    const z = scaledRegion([-50, -50, -10, -10], 1000, 1, 1000, 1000, 0); expect(z.x0).toBe(0); expect(z.x1 - z.x0).toBe(1); expect(z.y1 - z.y0).toBeGreaterThanOrEqual(1);
  });
  it('regionClip + regionMvp: the region fills the viewport and every pixel of it lands on the same pixel as in the whole image; z and w (the depth) are unchanged', () => {
    const Wu = 500, Hu = 400, reg = { x0: 120, y0: 60, x1: 300, y1: 250 }, rw = 180, rh = 190;
    const c = regionClip(reg, Wu, Hu), M = new THREEG.Matrix4().makePerspective(-0.9, 0.7, 0.5, -0.6, 0.1, 50).multiply(new THREEG.Matrix4().makeTranslation(0.2, -0.1, -2));
    const out = regionMvp(new THREEG.Matrix4(), M, c);
    const clip = (m, v) => { const q = new THREEG.Vector4(...v, 1).applyMatrix4(m); return q; };
    for (const v of [[0.1, 0.2, -1], [-0.4, 0.3, -3], [0.5, -0.5, -1.5]]) {
      const a = clip(M, v), b = clip(out, v);
      expect(b.z).toBeCloseTo(a.z, 9); expect(b.w).toBeCloseTo(a.w, 9);
      // the pixel in the eye's whole (scaled) image, and in the target slot of the region: framebuffer x = (ndc + 1) / 2 * size, y down = (1 - ndc) / 2 * size
      const px = (a.x / a.w + 1) / 2 * Wu, py = (1 - a.y / a.w) / 2 * Hu;
      const tx = (b.x / b.w + 1) / 2 * rw, ty = (1 - b.y / b.w) / 2 * rh;
      expect(tx).toBeCloseTo(px - reg.x0, 6); expect(ty).toBeCloseTo(py - reg.y0, 6);
    }
    const whole = regionClip({ x0: 0, y0: 0, x1: Wu, y1: Hu }, Wu, Hu); expect(whole.ax).toBe(1); expect(whole.ay).toBe(1); expect(whole.bx).toBeCloseTo(0, 12); expect(whole.by).toBeCloseTo(0, 12);
  });
  it('bandRects: four disjoint bands around the inner rect (shrunk by band + margin), or the whole region when the inner rect is empty or outside', () => {
    const r = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const b = bandRects(r, [40, 40, 60, 60], 100, 1, 0); // inner 40..60 both ways (y up = y down here)
    expect(b).toEqual([[0, 0, 100, 40], [0, 60, 100, 40], [0, 40, 40, 20], [60, 40, 40, 20]]);
    const cells = new Set(); for (const [x, y, w, h] of b) for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) { expect(cells.has(i + ',' + j)).toBe(false); cells.add(i + ',' + j); }
    expect(cells.size).toBe(100 * 100 - 20 * 20); // everything but the inner rect, nothing twice
    expect(bandRects(r, [40, 40, 60, 60], 100, 1, 15)).toEqual([[0, 0, 100, 100]]); // shrunk to nothing
    expect(bandRects(r, [200, 200, 300, 300], 100, 1, 0)).toEqual([[0, 0, 100, 100]]); // outside the region
    expect(bandRects(r, null, 100, 1, 0)).toEqual([[0, 0, 100, 100]]);
    expect(bandRects({ x0: 20, y0: 30, x1: 70, y1: 90 }, [0, 0, 50, 50], 100, 1, 0)[0]).toEqual([0, 0, 50, 20]); // partly overlapping region: bands are relative to the region's top-left (y 30..50 is the inner rect's top part)
  });
  it('a head that moves does not make a target every frame: the sizes of a moving box stay within a few steps (the pool is not churned)', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    for (let k = 0; k < 300; k++) {
      const w = 150 + 60 * Math.sin(k / 9) + k % 7, h = 120 + 40 * Math.cos(k / 11) + k % 5, x0 = 300 + 80 * Math.sin(k / 13);
      r.draw({ u: {}, cams: [eyeCam(1000, 1000), eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f: 1, boxes: [{ x0, y0: 400, x1: x0 + w, y1: 400 + h }, { x0: x0 - 10, y0: 400, x1: x0 + w - 10, y1: 400 + h }], variant: { cls4: false, events: false } });
    }
    expect(log.textures.filter(t => t.desc.format === 'rgba8unorm' && t.desc.usage & 4).length).toBeLessThanOrEqual(2 * 6); // colour + depth for at most 6 sizes over 300 frames
    r.dispose();
  }));
  it('the composite reads the eye\'s own region (per eye) and writes nothing outside it', withGpuGlobals(() => {
    const { device } = mockDevice();
    const comp = createComposite({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const t = device.createTexture({}), d = device.createTexture({});
    comp.update({ low: { target: { color: t, depth: d, w: 256, h: 128 }, scale: 0.5, stride: 130, regs: [[10, 20, 100, 60], [12, 22, 90, 50]] } });
    expect(comp.u.reg1a.value.toArray()).toEqual([10, 20, 100, 60]); expect(comp.u.reg1b.value.toArray()).toEqual([12, 22, 90, 50]);
    comp.update({ low: { target: { color: t, depth: d, w: 256, h: 128 }, scale: 1, stride: 130, usedW: 64, usedH: 32 } }); // the old form: the whole image
    expect(comp.u.reg1a.value.toArray()).toEqual([0, 0, 64, 32]); expect(comp.u.reg1b.value.toArray()).toEqual([0, 0, 64, 32]);
    expect(host).toContain('const inside = sx.greaterThanEqual(0).and(sx.lessThanEqual(reg.z)).and(sy.greaterThanEqual(0)).and(sy.lessThanEqual(reg.w));');
    expect(host).toContain('nodes.c1.sample(uv1).mul(q1.mask)');
    comp.dispose();
  }));
  it('B: at 100 % (f = 1) the periphery pass still runs when asked (fov): the centre at full size inside the centre rect, the bands around it at the periphery scale; the box limits both', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const st = r.draw({ u: {}, cams: [eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f: 1, fov: true, fp: 0.5, rects: [[300, 300, 700, 700]], band: 5, boxes: [{ x0: 100, y0: 100, x1: 900, y1: 900 }], variant: { cls4: false, events: false } });
    expect(st.regions.scale).toBe(1); expect(st.regions.periScale).toBe(0.5);
    expect(st.regions.low[0]).toEqual([404, 404]); // the centre rect 300..700 + 2 px each side at full size (not the box's 800)
    expect(st.regions.peri[0]).toEqual([404, 404]); // the box 100..900 at half size = 50..450 + 2 px each side
    expect(log.viewports[0]).toEqual([0, 0, 404, 404, 0, 1]); expect(log.viewports[1]).toEqual([0, 0, 404, 404, 0, 1]);
    // the periphery's bands leave the inner rect (300..700 shrunk by 5 + 4 + 1 = 10 -> 310..690 -> 155..345 at half size) undrawn: four scissors, none inside it
    const bands = log.scissors.slice(1); expect(bands).toHaveLength(4);
    const area = bands.reduce((a, b) => a + b[2] * b[3], 0); expect(area).toBe(404 * 404 - (345 - 155) * (345 - 155));
    r.dispose();
  }));
  it('B: vr-view.js asks for the periphery at 100 % in the WebGPU view only (gx), the conditions of the WebGL view (f < 1) and the guard / benchmark conditions are as before', () => {
    expect(vr).toContain('fovRaw=(f<1||gx)&&foveaWorth(rs.outside,rs.cover,kF,rs.per<1)&&!bench.active&&!anBench.active&&!!xrCam&&xrCam.cameras.length>0,fov=(f<1||gx)&&fovGuard.step(fovRaw,nowG),fp=fov?f*kF:f;');
  });
  it('vr-view.js: the box rects of this frame go to the pass and the record gets the drawn size once a second', () => {
    expect(vr).toContain("gxD.d.values['drawn region']={eye:[rs.w,rs.h],...gx.vol.stats.regions};");
    expect(vr).toContain('boxes:xrCam?rsEyes:null');
  });
});

describe('WebGPU: no bind points at a destroyed texture (A3)', () => {
  const target = (device, w = 64) => ({ target: { color: device.createTexture({}), depth: device.createTexture({}), w, h: w }, scale: 1, stride: w, usedW: w, usedH: w });
  it('after the periphery pass is switched off the second pair of nodes is the first one\'s, so the periphery target can be let go', withGpuGlobals(() => {
    const { device } = mockDevice();
    const comp = createComposite({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const low = target(device), peri = target(device);
    comp.update({ low, peri, fov: true, rects: [[0, 0, 10, 10]], band: 1 });
    expect(nodeTextures(comp)).toEqual([low.target.color, low.target.depth, peri.target.color, peri.target.depth]);
    comp.update({ low, peri: null, fov: false });
    expect(nodeTextures(comp)).toEqual([low.target.color, low.target.depth, low.target.color, low.target.depth]);
    comp.update({ low, peri, fov: false, rects: null }); // a periphery target given but not used
    expect(nodeTextures(comp)).not.toContain(peri.target.color);
    comp.dispose();
  }));
  it('forget(): a target the pool destroys is dropped from the nodes at once (they fall back to the 1 x 1 texture until the next update)', withGpuGlobals(() => {
    const { device } = mockDevice();
    const comp = createComposite({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const low = target(device), peri = target(device);
    comp.update({ low, peri, fov: true, rects: [[0, 0, 10, 10]], band: 1 });
    comp.forget(peri.target.color, peri.target.depth); peri.target.color.destroy(); peri.target.depth.destroy();
    expect(nodeTextures(comp).filter(t => t.destroyed)).toEqual([]);
    expect(nodeTextures(comp).slice(0, 2)).toEqual([low.target.color, low.target.depth]);
    comp.dispose();
  }));
  it('end to end: the pool lets targets go while the frames change size; no node and no bind group used in the passes points at a destroyed texture', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    let clock = 0; const now = vi.spyOn(performance, 'now').mockImplementation(() => ++clock);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    const frame = (W, fov) => {
      r.draw({ u: {}, cams: [eyeCam(W, W)], model: new THREEG.Matrix4(), f: 1, fov, fp: 0.5, rects: fov ? [[0, 0, W / 2, W / 2]] : null, band: 1, variant: { cls4: false, events: false } });
      expect(nodeTextures(r.composite).filter(t => t.destroyed), 'frame ' + W).toEqual([]);
    };
    frame(512, true); frame(512, false);
    for (let k = 1; k <= 14; k++) frame(64 * k + 640, k % 2 === 0); // more sizes than the pool keeps: the least recently used go
    expect(log.textures.some(t => t.destroyed)).toBe(true); // the pool did destroy some
    // between the pool's eviction and the next update() the nodes must not point at them either
    r.volume.beginFrame(); for (let k = 0; k < 12; k++) r.volume.getTarget(64 * (k + 30), 64 * (k + 30));
    expect(nodeTextures(r.composite).filter(t => t.destroyed)).toEqual([]);
    // a bind group of a volume pass holds only live textures
    for (const g of log.groups) for (const e of g.d.entries) if (e.resource?.texture) expect(e.resource.texture.destroyed).toBe(false);
    r.dispose(); now.mockRestore();
  }));
  it('the volume pass\'s cached bind groups are dropped with the texture they hold', () => {
    expect(host).toContain('const dropGroups = gpuTex =>'); expect(host).toContain('dropGroups(e.gpu); e.gpu.destroy();'); expect(host).toContain('dropGroups(x.gpu); x.gpu.destroy();');
    expect(host).toContain('onTargetFreed?.(old); old.color.destroy();');
  });
});

// a window with a requestAnimationFrame queue, three.js\' Animation (r186: start() calls the loop at once and asks window for the next frame; stop() cancels it) and the XR manager's setSession / onSessionEnd as in three.webgpu.js
const fakeXr = () => {
  let id = 0; const queue = new Map();
  const win = { requestAnimationFrame: cb => { queue.set(++id, cb); return id; }, cancelAnimationFrame: i => { queue.delete(i); }, pending: () => queue.size, tick() { const q = [...queue]; queue.clear(); q.forEach(([, cb]) => cb(0)); } };
  const anim = { ctx: win, loop: null, req: null,
    start() { const update = (t, f) => { this.req = this.ctx.requestAnimationFrame(update); this.loop?.(t, f); }; update(); },
    stop() { this.ctx?.cancelAnimationFrame(this.req); this.req = null; },
    setAnimationLoop(c) { this.loop = c; }, getAnimationLoop() { return this.loop; }, setContext(c) { this.ctx = c; }, getContext() { return this.ctx; } };
  const xr = { failWith: null, async setSession(session) {
    session.addEventListener('end', () => { anim.stop(); anim.setAnimationLoop(xr._currentAnimationLoop); anim.setContext(win); anim.start(); }); // onSessionEnd
    if (xr.failWith) throw xr.failWith;
    if (xr.endDuring) await session.end(); // the headset ends the session while the manager is still setting it up
    xr._currentAnimationLoop = anim.getAnimationLoop(); anim.stop(); anim.setAnimationLoop(() => {}); anim.setContext(session); anim.start();
  } };
  const renderer = { _animation: anim, xr, setAnimationLoop: c => anim.setAnimationLoop(c) };
  const mkSession = () => Object.assign(new EventTarget(), { ends: 0, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, end() { this.ends++; return new Promise(res => queueMicrotask(() => { this.dispatchEvent(new Event('end')); res(); })); } });
  return { win, renderer, session: mkSession(), mkSession };
};
describe('WebGPU: nothing keeps running after the session ends (A1)', () => {
  const run = async useFix => {
    const { win, renderer, session } = fakeXr();
    let bodyRuns = 0;
    renderer.setAnimationLoop(() => { bodyRuns++; }); // the app's loop: no guard (a call after the session is over runs on a renderer that is gone)
    session.addEventListener('end', () => { if (useFix !== 'noRelease') releaseXrLoop(renderer); renderer.setAnimationLoop(null); }); // the app's 'end' handler (cleanup): registered before the renderer takes the session
    if (useFix) expect(await bindGxSession(renderer, session, () => {})).toBe(true); else await renderer.xr.setSession(session);
    bodyRuns = 0; // (the frames before the end are not the question)
    await session.end(); // the headset ends the session
    for (let i = 0; i < 3; i++) win.tick();
    return { win, bodyRuns };
  };
  it('the control: with three.js\' XR manager alone a requestAnimationFrame loop is left on the page', async () => { expect((await run(false)).win.pending()).toBe(1); });
  it('with bindGxSession no loop is left: nothing pending on the page after the session ended and the frames after it, and the app\'s loop is not called again', async () => { const r = await run(true); expect(r.win.pending()).toBe(0); expect(r.bodyRuns).toBe(0); });
  it('the app\'s end handler\'s releaseXrLoop is what keeps the manager from calling the app\'s loop once more (the control without it: one call)', async () => { expect((await run('noRelease')).bodyRuns).toBe(1); });
  it('a session that ends while setSession is still awaiting: the loop the manager starts afterwards is stopped and the caller is told (false)', async () => {
    const { win, renderer, session } = fakeXr(); renderer.xr.endDuring = true; renderer.setAnimationLoop(() => {});
    let alive = true; session.addEventListener('end', () => { alive = false; }, { once: true });
    expect(await bindGxSession(renderer, session, () => {}, () => alive)).toBe(false);
    expect(renderer._animation.loop).toBe(null); expect(renderer._animation.req).toBe(null); expect(win.pending()).toBe(0);
  });
  it('disposeGxRenderer: only an initialised renderer is disposed (the dispose of one whose init failed would run init again), and a rejected dispose is handled', async () => {
    const calls = []; disposeGxRenderer({ initialized: false, dispose: () => { calls.push('x'); } }); expect(calls).toEqual([]);
    disposeGxRenderer({ initialized: true, dispose: () => { calls.push('a'); return Promise.reject(new Error('gone')); } }); expect(calls).toEqual(['a']);
    expect(() => disposeGxRenderer(null)).not.toThrow(); expect(() => disposeGxRenderer({ initialized: true, dispose() { throw new Error('sync'); } })).not.toThrow();
    await new Promise(r => setTimeout(r)); // (an unhandled rejection would fail the run)
  });
  it('again after entering twice: each session\'s loop is gone (they do not add up)', async () => {
    const { win, renderer, mkSession } = fakeXr();
    for (let n = 0; n < 3; n++) {
      const session = mkSession();
      renderer.setAnimationLoop(() => {}); await bindGxSession(renderer, session, () => {}); await session.end(); win.tick();
      expect(win.pending()).toBe(0);
    }
  });
  it('stopRenderLoop is safe on a renderer that is gone', () => { expect(() => stopRenderLoop(null)).not.toThrow(); expect(() => stopRenderLoop({})).not.toThrow(); });
  it('vr-view.js: the app\'s end handler lets the XR manager forget the loop (WebGPU only), and the renderer takes the session through bindGxSession', () => {
    expect(vr).toContain('if(gx)releaseXrLoop(renderer);'); expect(vr).toContain('bindGxSession(renderer,session,'); expect(vr).toContain('()=>!!running))return;');
  });
});

describe('WebGPU: a failure after the session opened ends it and the page says so (A4, B7)', () => {
  it('setSession fails: session.end() is called once, the page is told, nothing keeps running, and the caller stops (false)', async () => {
    const { win, renderer, session } = fakeXr(); renderer.xr.failWith = new Error('no projection layer');
    const told = []; renderer.setAnimationLoop(() => {});
    expect(await bindGxSession(renderer, session, e => told.push(e.message))).toBe(false);
    expect(session.ends).toBe(1); expect(told).toEqual(['no projection layer']);
    await new Promise(r => setTimeout(r)); win.tick(); expect(win.pending()).toBe(0);
  });
  it('failGxSession: the page line is written even if it throws, and an already ended session does not break it', () => {
    const s = { end() { throw new Error('ended'); } }; expect(() => failGxSession(s, () => { throw new Error('x'); }, new Error('e'))).not.toThrow();
    const s2 = { end: () => Promise.reject(new Error('ended')) }; expect(() => failGxSession(s2, null, 1)).not.toThrow();
  });
  it('a lost device (not our own destroy) is reported once; destroy() is not', async () => {
    const got = [];
    watchDeviceLost({ lost: Promise.resolve({ reason: 'unknown', message: 'gpu hang' }) }, i => got.push(i.reason));
    watchDeviceLost({ lost: Promise.resolve({ reason: 'destroyed' }) }, i => got.push(i.reason));
    await new Promise(r => setTimeout(r)); expect(got).toEqual(['unknown']);
  });
  it('vr-view.js: the failing places end the session through the same line (step gpu-closed), the page and the headset say the same words in both languages', () => {
    expect(vr).toContain("step('gpu-closed')"); expect(vr).toContain('gxFail(e);return}gx.ready=true'); expect(vr).toContain('watchDeviceLost(gx.device,');
    expect(app).toContain("tr(s==='gpu-closed'?'vrGpuClosed':'vrGpuFallback')");
    const i18n = read('i18n.js');
    expect(i18n).toContain("vrGpuClosed:'WebGPUでは開けませんでした'"); expect(i18n).toContain("vrGpuClosed:'Could not open with WebGPU'");
    expect(i18n).toContain("vrGpuFallback:'WebGPUでは開けなかったため、WebGL版で開きました'"); // unchanged
  });
  it('B7: a device or renderer made before a failure is let go', () => {
    expect(vr).toContain('disposeGxRenderer(r);try{d?.device.destroy()}catch{}');
    expect(vr).toContain('disposeGxRenderer(gx.renderer);try{gx.renderer.domElement.remove()}catch{}try{gx.device.destroy()}catch{}gxFail(e);return');
  });
});

describe('WebGPU: only the 256 grid, and what is not supported is said (A5, B5)', () => {
  it('the data setting reads 256 in the WebGPU view whatever is stored, and as stored otherwise', () => {
    expect(gxDataValue({}, 0)).toBe(1); expect(gxDataValue({}, 1)).toBe(1);
    expect(gxDataValue(null, 0)).toBe(0); expect(gxDataValue(null, 1)).toBe(1); expect(gxDataValue(null, undefined)).toBe(0);
  });
  it('the menu row: 256 lit, the 512 slot is disabled and carries the note', () => {
    const row = gxDataRow('WebGPU版は256のみ');
    expect(row[0]).toMatchObject({ label: '256³', value: 1, on: true, disabled: false });
    expect(row[1]).toMatchObject({ label: 'WebGPU版は256のみ', value: 0, on: false, disabled: true });
  });
  it('vr-view.js: useData and the data switch read the data setting through dataSel, the stored one is never written in the WebGPU view, the classification-off row is disabled', () => {
    expect(vr).toContain('const dataSel=()=>gxDataValue(gx,settings.data);');
    expect(vr).toContain('useData=i=>{\n   if(gx)i=dataSel();'); expect(vr).toContain('dataSetting:dataSel()'); expect(vr).toContain("(dataSel()?'256':'512')");
    expect(vr.match(/settings\.data=v/g)?.length).toBe(1); expect(vr).toContain("else choice(y0+180,L.dt,[{label:'256³',value:1},{label:'512³',value:0}],settings.data,v=>{settings.data=v;applyQuality()});");
    expect(vr).toContain('const r=gxDataRow(L.gxOnly256);'); expect(vr).toContain('{disabled:r[1].disabled,size:28}');
    expect(vr).toContain('btn(CX,y0+470,MENU_W-X-CX,L.gxNoDiag,false,()=>{},{disabled:true,size:28})');
    expect(vr).toContain("gxOnly256:'WebGPU版は256のみ'"); expect(vr).toContain("gxOnly256:'WebGPU: 256 only'");
  });
  it('B5: the unsupported results / child segments / hiding are said once, in the VR view, like the part cut-out note', () => {
    expect(vr).toContain("gxResults:'WebGPU版では結果の色・子セグメント・非表示は未対応です'");
    expect(vr).toContain("gxResults:'WebGPU: result colours, child segments and hiding are not supported'");
    expect(vr).toContain('if(gx&&!gxResultsNoted&&(regionList.length||childList.length)){gxResultsNoted=true;flashMsg(L.gxResults,20000)}');
  });
});

// ---- the session's diagnostic record (black view on the headset): recorder, error capture, heartbeat guard, colour test, wiring ----
const memStore = () => { const m = new Map(); return { m, setItem: (k, v) => m.set(k, v), getItem: k => m.get(k) ?? null }; };
const fakeSession = () => {
  const cbs = []; const ls = {};
  return { cbs, ended: 0, inputSources: [], enabledFeatures: ['webgpu', 'layers'], renderState: { layers: [{}] },
    requestAnimationFrame(cb) { cbs.push(cb); return cbs.length; }, end() { this.ended++; return Promise.resolve(); },
    addEventListener(t, f) { (ls[t] ||= []).push(f); }, removeEventListener() {}, fire(t) { for (const f of ls[t] || []) f({}); },
    frame(pose = { views: [] }) { const list = cbs.splice(0); for (const cb of list) cb(0, { getViewerPose: () => pose }); } };
};
describe('WebGPU diagnostics: the record', () => {
  it('stages, values, counters and errors are kept bounded, repeated errors are counted once, and the record is mirrored to the store', () => {
    let t = 0; const store = memStore();
    const g = createGxDiag({ now: () => t, store, maxErrors: 2, maxStages: 10 });
    g.stage('start', { mode: 'vr' }); t = 5; g.value('k', { a: 1 }); g.count('xrFrames'); g.count('xrFrames');
    for (let i = 0; i < 5; i++) g.error('loop', new TypeError('x is undefined'));
    expect(JSON.parse(store.getItem(GX_DIAG_KEY)).errors[0].n).toBe(1); g.flush(); expect(JSON.parse(store.getItem(GX_DIAG_KEY)).errors[0].n).toBe(5); // a repeat is saved with the next save
    g.error('gpu', { error: { message: 'Invalid texture view' } }); g.error('promise', { reason: new Error('third kind') });
    expect(g.d.counts.xrFrames).toBe(2);
    expect(g.d.errors).toHaveLength(2); expect(g.d.errors[0]).toMatchObject({ kind: 'loop', n: 5 }); expect(g.d.errors[0].msg).toBe('TypeError: x is undefined');
    expect(g.d.errors[1].msg).toContain('Invalid texture view'); expect(g.d.dropped).toBe(1);
    for (let i = 0; i < 30; i++) g.stage('s' + i);
    expect(g.d.stages.length).toBeLessThanOrEqual(10); expect(g.d.stages[0].name).toBe('start'); expect(g.d.stages.at(-1).name).toBe('s29');
    expect(JSON.parse(store.getItem(GX_DIAG_KEY)).errors).toHaveLength(2);
    const text = gxDiagReport(g.d, { build: '741', ua: 'UA' });
    expect(text).toContain(''); expect(text).toContain('[loop] x5'); expect(text).toContain('xrFrames=2'); expect(text).toContain('k: {"a":1}');
  });
  it('error text: Error, GPU error event, device-lost info, ErrorEvent without an error object, string', () => {
    expect(gxErrorText(new RangeError('bad')).msg).toBe('RangeError: bad');
    expect(gxErrorText({ error: { message: 'validation' } }).msg).toContain('validation');
    expect(gxErrorText({ reason: 'unknown', message: 'lost' }).msg).toContain('lost');
    expect(gxErrorText({ message: 'Script error.', filename: 'a.js', lineno: 3, colno: 4 }).stack).toBe('a.js:3:4');
    expect(gxErrorText('plain').msg).toBe('plain');
  });
  it('watchGxErrors: device uncaptured errors (a listener, three.js keeps onuncapturederror), window errors and rejections, three.js warn / error lines; stop() puts the console function back', () => {
    const g = createGxDiag({ store: null });
    const mk = () => { const ls = {}; return { ls, addEventListener: (t, f) => { (ls[t] ||= []).push(f); }, removeEventListener: (t, f) => { ls[t] = ls[t].filter(x => x !== f); } }; };
    const device = mk(), win = mk(); let cf = null; const prev = vi.fn();
    const three = { getConsoleFunction: () => prev, setConsoleFunction: f => { cf = f; } };
    device.onuncapturederror = 'three'; cf = prev;
    const stop = watchGxErrors({ device, diag: g, win, three });
    device.ls.uncapturederror[0]({ error: { message: 'GPUValidationError x' } });
    win.ls.error[0]({ error: new Error('frame threw') }); win.ls.unhandledrejection[0]({ reason: new Error('rejected') });
    cf('warn', 'THREE.XRManager: something', 1); cf('log', 'THREE.info');
    expect(g.d.errors.map(e => e.kind)).toEqual(['gpu', 'window', 'promise', 'three-warn']);
    expect(prev).toHaveBeenCalledTimes(2); expect(device.onuncapturederror).toBe('three');
    stop(); expect(cf).toBe(prev); expect(device.ls.uncapturederror).toHaveLength(0); expect(win.ls.error).toHaveLength(0);
  });
  it('the session values and the sub images are read without throwing, a failing read is written as its error', () => {
    const renderer = { outputColorSpace: 'srgb', currentColorSpace: 'srgb', needsFrameBufferTarget: true, samples: 0, backend: { compatibilityMode: false },
      xr: { getWebGPUBinding: () => ({ getPreferredColorFormat: () => 'rgba8unorm-srgb' }), _glProjLayer: { textureWidth: 1680, textureHeight: 1760, textureArrayLength: 2, ignoreDepthValues: true }, _xrRenderTarget: { width: 1680, height: 1760, depth: 2, samples: 0, depthBuffer: false } } };
    const v = gxSessionValues(renderer, fakeSession(), { features: new Set(['shader-f16']) });
    expect(v).toMatchObject({ preferredColorFormat: 'rgba8unorm-srgb', projectionLayer: { w: 1680, h: 1760, layers: 2 }, outputColorSpace: 'srgb', needsFrameBufferTarget: true, compatibilityMode: false, deviceFeatures: ['shader-f16'], enabledFeatures: ['webgpu', 'layers'] });
    const binding = { getViewSubImage: (l, view) => { if (view.eye === 'right') throw new Error('no sub image'); return { colorTexture: { format: 'rgba8unorm-srgb', width: 1680, height: 1760, depthOrArrayLayers: 2, sampleCount: 1, dimension: '2d', usage: 16 }, viewport: { x: 0, y: 0, width: 1680, height: 1760 }, getViewDescriptor: () => ({ baseArrayLayer: 0 }) }; } };
    const f = gxFrameValues(binding, {}, [{ eye: 'left' }, { eye: 'right' }]);
    expect(f[0]).toMatchObject({ eye: 'left', format: 'rgba8unorm-srgb', layers: 2, viewport: [0, 0, 1680, 1760], desc: { baseArrayLayer: 0 } });
    expect(f[1]).toEqual({ eye: 'right', error: 'Error: no sub image' });
  });
  it('the escape needs trigger and grip held on both controllers', () => {
    const c = (t, g) => ({ gamepad: { buttons: [{ pressed: t }, { pressed: g }] } });
    expect(gxEscapeHeld([c(true, true), c(true, true)])).toBe(true);
    expect(gxEscapeHeld([c(true, true), c(false, true)])).toBe(false); // two-hand scale (both grips) is not the escape
    expect(gxEscapeHeld([c(true, true)])).toBe(false); expect(gxEscapeHeld([{}, { gamepad: null }])).toBe(false);
  });
});
describe('WebGPU diagnostics: the heartbeat (a frame loop of its own on the session)', () => {
  it('counts frames and poses, reads the sub images once after the renderer has the session, and keeps running', () => {
    const s = fakeSession(), g = createGxDiag({ store: null }); const st = { bound: false, rendered: 0, ref: {}, binding: { getViewSubImage: () => ({ colorTexture: { format: 'bgra8unorm' }, viewport: { x: 0, y: 0, width: 1, height: 1 } }) }, layer: {} };
    const hb = startGxHeartbeat({ session: s, diag: g, state: () => st });
    s.frame(); expect(g.d.values.subImages).toBeUndefined();
    st.bound = true; st.rendered = 1; s.frame({ views: [{ eye: 'left' }] }); s.frame({ views: [{ eye: 'left' }] }); st.rendered = 2;
    expect(g.d.counts.xrFrames).toBe(3); expect(g.d.counts.poses).toBe(3); expect(g.d.values.subImages[0].format).toBe('bgra8unorm');
    expect(g.d.stages.filter(x => x.name.startsWith('first posed frame'))).toHaveLength(1);
    hb.stop(); s.frame(); expect(g.d.counts.xrFrames).toBe(3);
  });
  it('ends the session when frames come but no main render completes (counted in frames), once', () => {
    const s = fakeSession(), g = createGxDiag({ store: null }), st = { bound: true, rendered: 0 }; const onEnd = vi.fn();
    startGxHeartbeat({ session: s, diag: g, state: () => st, stallFrames: 5, onEnd });
    for (let i = 0; i < 4; i++) { st.rendered++; s.frame(); }
    expect(s.ended).toBe(0);
    for (let i = 0; i < 8; i++) s.frame();
    expect(s.ended).toBe(1); expect(onEnd).toHaveBeenCalledTimes(1); expect(g.d.stages.find(x => x.name === 'auto-end').info).toContain('without a completed main render');
  });
  it('no stall is counted before the renderer has the session', () => {
    const s = fakeSession(), g = createGxDiag({ store: null }), st = { bound: false, rendered: 0 };
    startGxHeartbeat({ session: s, diag: g, state: () => st, stallFrames: 3 });
    for (let i = 0; i < 20; i++) s.frame();
    expect(s.ended).toBe(0);
  });
  it('ends the session when the escape is held long enough (time), not on a short hold', () => {
    let t = 0; const s = fakeSession(), g = createGxDiag({ store: null, now: () => t }), st = { bound: true, rendered: 0 };
    const held = { gamepad: { buttons: [{ pressed: true }, { pressed: true }] } };
    startGxHeartbeat({ session: s, diag: g, state: () => st, now: () => t, escapeMs: 2000, stallFrames: 1e9 });
    s.inputSources = [held, held]; s.frame(); t = 1500; s.frame(); s.inputSources = []; t = 1600; s.frame();
    expect(s.ended).toBe(0);
    s.inputSources = [held, held]; t = 2000; s.frame(); t = 4100; s.frame();
    expect(s.ended).toBe(1); expect(g.d.stages.find(x => x.name === 'auto-end').info).toBe('escape held');
  });
  it('the WGSL compiler messages are recorded per variant (an error also as a stage)', async () => {
    const g = createGxDiag({ store: null });
    gxShaderInfo(g, { getCompilationInfo: async () => ({ messages: [] }) }, { f16: true, cls4: false, events: true });
    gxShaderInfo(g, { getCompilationInfo: async () => ({ messages: [{ type: 'error', lineNum: 3, linePos: 7, message: 'f16 not enabled' }] }) }, { cls4: true, events: false });
    gxShaderInfo(g, {}, { cls4: false, events: false });
    await new Promise(r => setTimeout(r, 0));
    expect(g.d.values['wgsl f16 c3e']).toBe('ok'); expect(g.d.values['wgsl c4n']).toEqual(['error 3:7 f16 not enabled']); expect(g.d.values['wgsl c3n']).toBe('no getCompilationInfo');
    expect(g.d.stages.some(x => x.name === 'WGSL compile error')).toBe(true);
  });
  it('the volume renderer hands each shader module it makes to onShader', withGpuGlobals(async () => {
    const { device } = mockDevice(); const seen = [];
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1], onShader: (m, v) => seen.push(v) });
    await r.preload({}, [{ cls4: false, events: false }, { cls4: true, events: true }]);
    expect(seen).toEqual([{ f16: false, cls4: false, events: false }, { f16: false, cls4: true, events: true }, { proxy: true, cls4: false }]); // the display variants, then the pre-pass of the first (a section variant has none)
    r.dispose();
  }));
});
describe('WebGPU diagnostics: the wiring in vr-view.js (the WebGL session is untouched)', () => {
  it('the record exists only when the WebGPU view is asked for and can be tried; the end listener that shows it is added before any WebGPU step after the session opens', () => {
    expect(vr).toContain("let gx=null,gxNote='',gxD=null,perfLog=null;");
    expect(vr).toContain("else{let d=null,r=null;gxD=createGxDiag();");
    const iEnd = vr.indexOf("session.addEventListener('end',()=>{if(gxLive?.session===session)gxLive=null;gxHb?.stop();"), iVol = vr.indexOf('try{gx.vol=createVrVolumeRenderer(');
    expect(iEnd).toBeGreaterThan(0); expect(iEnd).toBeLessThan(iVol);
    expect(vr).toContain('setTimeout(()=>showGxDiagPanel(ja,dg,pl),0)');
    expect(vr).toContain('const gxHb=gx?startGxHeartbeat(');
  });
  it('a throw of the start ends the open WebGPU session (the page catches the error; the headset would stay black) and is recorded; the WebGL start is the same function as before', () => {
    expect(vr).toContain('export async function startVrView(opts={}){\n try{return await startVrViewRun(opts)}');
    expect(vr).toContain("async function startVrViewRun({language='ja',mode='vr',onStep=()=>{}}={}){");
    expect(vr).toContain('if(gx)gxLive={session,diag:gxD};');
    expect(vr).toContain("g.diag.error('start',e)");
  });
  it('setSession has a timer of its own (no layer, no XR frame before it), cleared once the renderer has the session', () => {
    expect(vr).toContain("gxBindTimer=setTimeout(()=>{if(!gxS.bound&&running?.session===session)");
    expect(vr).toContain('clearTimeout(gxBindTimer);gxS.bound=true;');
  });
  it('the loop counts and the main render: only the WebGPU session takes gxRender, the WebGL one renders as before', () => {
    expect(vr).toContain("if(gx)gxRender();else timed('main',()=>renderer.render(scene,camera));");
    expect(vr).toContain("if(gx){gxD.count('loop');");
    expect(vr).not.toContain('outputColorSpace=');
    const iBind = vr.indexOf('if(gx&&!await bindGxSession(renderer,session,'), iDone = vr.indexOf("gxD.stage('setSession done')");
    expect(iDone).toBeGreaterThan(iBind);
  });
});
describe('WebGPU diagnostics: the save button of the page panel (the same text as the copy button, as one .txt download)', () => {
  const fakeDoc = () => {
    const made = [], body = { kids: [], append(n) { this.kids.push(n); } };
    return { made, body, createElement(tag) { const n = { tag, style: {}, clicks: 0, click() { this.clicks++; }, remove() { body.kids = body.kids.filter(k => k !== this); } }; made.push(n); return n; } };
  };
  it('the file name carries the build number and the local date and time (vrl-vr-gpu-diag-741-20261118-0915.txt)', () => {
    expect(gxDiagFileName('741', new Date(2026, 10, 18, 9, 15, 42))).toBe('vrl-vr-gpu-diag-741-20261118-0915.txt');
    expect(gxDiagFileName('741', new Date(2026, 0, 2, 3, 4))).toBe('vrl-vr-gpu-diag-741-20260102-0304.txt');
    expect(gxDiagFileName('', new Date(2026, 10, 18, 9, 15))).toBe('vrl-vr-gpu-diag-x-20261118-0915.txt');
  });
  it('one download: a text/plain Blob with exactly the given text, an a[download] with the file name clicked once and removed again', async () => {
    const doc = fakeDoc(), blobs = [], revoked = [];
    const urlApi = { createObjectURL: b => { blobs.push(b); return 'blob:x'; }, revokeObjectURL: u => revoked.push(u) };
    const g = createGxDiag(); g.stage('s'); g.error('loop', new Error('boom'));
    const text = gxDiagReport(g.d, { build: '741', ua: 'UA \u00e9\u65e5' });
    const name = saveGxDiagText(text, { build: '741', now: new Date(2026, 10, 18, 9, 15), doc, urlApi });
    expect(name).toBe('vrl-vr-gpu-diag-741-20261118-0915.txt');
    expect(blobs).toHaveLength(1); expect(blobs[0].type).toContain('text/plain');
    expect(await blobs[0].text()).toBe(text);
    expect(doc.made).toHaveLength(1);
    const a = doc.made[0];
    expect(a.tag).toBe('a'); expect(a.href).toBe('blob:x'); expect(a.download).toBe(name); expect(a.clicks).toBe(1); expect(doc.body.kids).toEqual([]);
  });
  it('the panel: the save button (ja 保存 / en Save) sits between copy and close and saves the text of the copy button; nothing else of the panel changed', () => {
    const i = vr.indexOf('function showGxDiagPanel(ja,diag,perf=null){'), body = vr.slice(i, vr.indexOf('function showShotsPanel(', i));
    expect(body).toContain("diag?gxDiagReport(diag.d,{build:APP_BUILD,ua}):''");
    expect(body).toContain("save.textContent=ja?'保存':'Save'");
    expect(body).toContain('saveGxDiagText(text,{build:APP_BUILD,name:diag?null:perfFileName(perf.kind,APP_BUILD)})');
    expect(body).toContain('navigator.clipboard?.writeText(text)');
    expect(body).toContain('row.append(copy,save,close,msg)');
    expect(body).toContain("diag?(ja?'WebGPU版VRの診断情報（「コピー」で全文をコピーできます）':'WebGPU VR diagnostics (Copy takes the full text)')");
  });
});

describe('WebGPU: the output is encoded inside each material, three.js\' frame buffer pass is not used (C)', () => {
  const getter = name => Object.getOwnPropertyDescriptor(THREEG.Renderer.prototype, name).get;
  const fakeRenderer = () => ({ outputColorSpace: THREEG.SRGBColorSpace, contextNode: THREEG.TSL.context({}) });
  it('the renderer\'s output colour space becomes the working one, so three.js needs no frame buffer target (checked with three.js\' own getters)', () => {
    const r = fakeRenderer();
    expect(getter('needsFrameBufferTarget').call({ currentToneMapping: THREEG.NoToneMapping, currentColorSpace: r.outputColorSpace })).toBe(true); // the control: sRGB output = the frame buffer pass
    const out = useMaterialSrgbOutput(r, THREEG);
    expect(out.materialSrgb).toBe(true); expect(out.text).toMatch(/each material/);
    expect(r.outputColorSpace).toBe(THREEG.LinearSRGBColorSpace);
    const cur = getter('currentColorSpace').call({ isOutputTarget: true, outputColorSpace: r.outputColorSpace });
    expect(getter('needsFrameBufferTarget').call({ currentToneMapping: THREEG.NoToneMapping, currentColorSpace: cur })).toBe(false);
    expect(cur === THREEG.SRGBColorSpace).toBe(false); // vr-view.js' decode flag (currentColorSpace === sRGB) is false: the composite writes display values as they are
  });
  it('the contextNode encodes every material\'s output to sRGB without tone mapping and keeps its premultiplied alpha (three.js\' own XR layer getOutput)', () => {
    const r = fakeRenderer(); useMaterialSrgbOutput(r, THREEG);
    expect(r.contextNode.isContextNode).toBe(true);
    for (const pm of [true, false]) {
      const n = r.contextNode.value.getOutput(THREEG.TSL.vec4(1, 0.5, 0.25, 1), { material: { premultipliedAlpha: pm } });
      expect(n.isRenderOutputNode).toBe(true); expect(n._toneMapping).toBe(THREEG.NoToneMapping); expect(n.outputColorSpace).toBe(THREEG.SRGBColorSpace); expect(n.premultipliedAlpha).toBe(pm);
    }
  });
  it('a renderer without the pieces is left as it was and the record says so', () => {
    const r = { outputColorSpace: THREEG.SRGBColorSpace, contextNode: {} };
    const out = useMaterialSrgbOutput(r, THREEG);
    expect(out.materialSrgb).toBe(false); expect(out.text).toMatch(/frame buffer pass/);
    expect(r.outputColorSpace).toBe(THREEG.SRGBColorSpace); expect(r.contextNode).toEqual({});
  });
  it('vr-view.js: the output is set right after the renderer\'s init, it goes into the record, the dome is still decoded (its plain material is encoded by the contextNode) and the WebGL renderer is untouched', () => {
    expect(vr).toContain("await r.init();gxD.stage('renderer init');const out=useMaterialSrgbOutput(r,THREEG);gxD.value('output path',out.text);");
    expect(vr).toContain('makeBackground(!!gx,!!gx&&(gx.out?.materialSrgb||renderer.currentColorSpace===THREE.SRGBColorSpace))');
    expect(vr).toContain('decode:renderer.currentColorSpace===THREE.SRGBColorSpace'); // unchanged: false once the output colour space is linear, true if the material route failed and three.js' pass encodes
    expect(vr.match(/useMaterialSrgbOutput\(/g)).toHaveLength(1);
    expect(vr.match(/outputColorSpace\s*=/g)).toBeNull(); // nothing in the page sets it
    expect(host).toContain('export function useMaterialSrgbOutput(renderer, THREE)');
  });
});
