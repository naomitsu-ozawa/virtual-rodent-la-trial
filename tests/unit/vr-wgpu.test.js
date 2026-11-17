// WebGPU VR / AR trial (stage 1: the body volume): the WGSL core (docs/vr-wgsl-core.js), the host's pure parts (docs/vr-wgpu.js) and the wiring in vr-view.js.
// CI has no GPU: wgsl_reflect parses every variant (syntax / structure), the uniform layout of the host's packer is checked against the struct the reflection reads,
// the constants and maths shared with the GLSL program are checked against its source, and the WebGL path is checked to be still the default.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, uniformLayout, UNIFORM_FIELDS, BOX_VERTICES, VOLUME_BINDINGS } from '../../docs/vr-wgsl-core.js';
import { vrGpuRequested, eyeUniforms, createVrVolumeRenderer, createComposite, releaseXrLoop, disposeGxRenderer, gxDataValue, gxDataRow, stopRenderLoop, bindGxSession, failGxSession, watchDeviceLost } from '../../docs/vr-wgpu.js';
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
    const perEye = new Set(['mvp', 'origin', 'lightOff', 'jumpOn', 'pad0', 'pad1', 'pad2']); // made per eye / per pass by the host
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
    expect(vr).toContain('gx.vol.draw({u:material.uniforms,cams,model:mesh.matrixWorld,f:Math.min(1,f),fov,fp,rects:rsFov,band:rsFov[0][4],variant:{cls4:cls4On,events:material.uniforms.planeCount.value>0},decode:renderer.currentColorSpace===THREE.SRGBColorSpace});');
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
    createRenderPipeline: () => ({}), createRenderPipelineAsync: async () => ({}), createTexture: mkTex,
    createBindGroup: d => ({ d }), createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}), copyTextureToBuffer() {} }),
  };
  return { device, log };
};
const withGpuGlobals = fn => async () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
  try { await fn(); } finally { vi.unstubAllGlobals(); }
};
const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
const nodeTextures = comp => ['c1', 'd1', 'c2', 'd2'].map(k => comp.nodes[k].value.sourceTexture);

describe('WebGPU: the viewport is the whole eye, only the scissor is the centre (A2)', () => {
  it('with the periphery pass on, the centre pass has the eye\'s full viewport and a smaller scissor inside it; the periphery pass has both full', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.draw({ u: {}, cams: [eyeCam(1000, 1000), eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f: 0.5, fov: true, fp: 0.25, rects: [[300, 300, 700, 700]], band: 1, variant: { cls4: false, events: false } });
    // low pass (stride = 500 + 2): eyes 0 and 1; then the periphery pass (250 px eyes, stride 252)
    expect(log.viewports.slice(0, 2)).toEqual([[0, 0, 500, 500, 0, 1], [502, 0, 500, 500, 0, 1]]);
    expect(log.viewports.slice(2, 4)).toEqual([[0, 0, 250, 250, 0, 1], [252, 0, 250, 250, 0, 1]]);
    expect(log.scissors[0]).toEqual([149, 149, 202, 202]); // the centre rect x 0.5 with the 1 px margin, y flipped to the top-left origin
    expect(log.scissors[1]).toEqual([502 + 149, 149, 202, 202]);
    expect(log.scissors.slice(2, 4)).toEqual(log.viewports.slice(2, 4).map(v => v.slice(0, 4)));
    for (let i = 0; i < 2; i++) { const v = log.viewports[i], sc = log.scissors[i]; expect(sc[2] * sc[3]).toBeLessThan(v[2] * v[3]); expect(sc[0]).toBeGreaterThanOrEqual(v[0]); expect(sc[0] + sc[2]).toBeLessThanOrEqual(v[0] + v[2]); }
    r.dispose();
  }));
  it('without the periphery pass viewport and scissor are the eye\'s full image', withGpuGlobals(() => {
    const { device, log } = mockDevice();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.draw({ u: {}, cams: [eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 1, fov: false, rects: null, variant: { cls4: false, events: false } });
    expect(log.viewports).toEqual([[0, 0, 640, 480, 0, 1]]); expect(log.scissors).toEqual([[0, 0, 640, 480]]);
    r.dispose();
  }));
  it('the host passes viewport and scissor separately (the WebGL pass of vr-view.js sets the viewport to the eye and the scissor to the centre rect)', () => {
    expect(host).toContain('pass.setViewport(e.vx ?? e.x, e.vy ?? e.y, e.vw ?? e.w, e.vh ?? e.h, 0, 1);');
    expect(host).toContain('pass.setScissorRect(e.x, e.y, e.w, e.h);');
    expect(vr).toContain('lowTarget.viewport.set(x,y,vw,vh);'); expect(vr).toContain('lowTarget.scissor.set(sx,sy,');
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
