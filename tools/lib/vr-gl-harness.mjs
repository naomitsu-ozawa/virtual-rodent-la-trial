// Shared harness of the VR render guards (tools/vr-render-golden.mjs, tools/vr-cls-parity.mjs):
//  - extracts the REAL shader strings from docs/vr-view.js (the template literals vertexShader, fragmentShader,
//    compositeVertex, compositeFragment) so a change to the shader is what gets rendered,
//  - builds a small deterministic synthetic phantom with the app's own buildClsData / distance-field code,
//  - renders it in headless Chromium on SwiftShader WebGL2 through three.js (the page function renderBatch),
//  - PNG encode / decode and a pixel comparison with thresholds.
// Synthetic data only. No network: three.js is served from node_modules.
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lightingGLSL, lightingVertexGLSL, materialVec } from '../../docs/lighting.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---- shader sources ----
// the shaders include the shared lighting helpers of docs/lighting.js through two template placeholders; the raw text grabbed from the
// source has to resolve them (the app does it when the template literal is evaluated). Any other placeholder left over is an error.
export function resolveLighting(text) {
  const out = text.replace('${lightingGLSL()}', lightingGLSL()).replace("${lightingVertexGLSL('invModel')}", lightingVertexGLSL('invModel'));
  if (out.includes('${')) throw new Error('unresolved template placeholder in a shader: ' + out.slice(out.indexOf('${'), out.indexOf('${') + 40));
  return out;
}
export function grabShaders(file = path.join(ROOT, 'docs/vr-view.js')) {
  const s = fs.readFileSync(file, 'utf8');
  const grab = name => { const m = s.match(new RegExp('const ' + name + '=`([\\s\\S]*?)`;')); if (!m) throw new Error('shader ' + name + ' not found in ' + file); return resolveLighting(m[1]); };
  return { vs: grab('vertexShader'), fs: grab('fragmentShader'), cvs: grab('compositeVertex'), cfs: grab('compositeFragment') };
}

import { makePhantom, SEGMENTS, SEGMENTS4, CALIB, HALF_EXT, SHOWN_MASK, SHOWN_MASK4 } from './vr-phantom.mjs';
export { makePhantom, SEGMENTS, SEGMENTS4, CALIB, HALF_EXT, SHOWN_MASK, SHOWN_MASK4 };

// u16 rg8-packed volume, the app's classification bytes (point-cls.js buildClsData), distance bytes and the combined (cls + distance in alpha) texture
export async function buildScene(N, opts = {}) {
  const [{ buildClsData }, { buildDistanceBytes, combineClassificationDistance, fourthChannelBytes }, { brickOccupancy, writeBrickOccupancy }] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, 'docs/point-cls.js'))),
    import(pathToFileURL(path.join(ROOT, 'docs/distance-field.js'))),
    import(pathToFileURL(path.join(ROOT, 'docs/vr-brick-occupancy.js')))]);
  const hu = makePhantom(N, opts), n = N * N * N, vol = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) { const q = hu[i] + 1024; vol[i * 2] = q & 255; vol[i * 2 + 1] = q >> 8; }
  // opts.four: four enabled segments (SEGMENTS4): chan 0..3, the combined texture with {four:true} and the fourth channel's own bytes (cls4) for VRL_CLS4
  const four = !!opts.four, cls = buildClsData({ dims: [N, N, N], data: vol }, CALIB, { data: null, dims: [N, N, N], active: 0, maskOnly: 0 }, four ? SEGMENTS4 : SEGMENTS);
  if (cls.C !== 4 || cls.chan.join() !== (four ? '0,1,2,3' : '0,1,2,-1')) throw new Error('unexpected classification layout ' + cls.C + ' ' + cls.chan);
  const dist = await buildDistanceBytes(cls, [N, N, N]);
  const combo = combineClassificationDistance(cls, dist, four ? SHOWN_MASK4 : SHOWN_MASK, null, { four }), cls4 = four ? fourthChannelBytes(cls) : null;
  // bricks 8^3 with one voxel of overlap (vr-view computeBricks), HU min/max, for the general loop; four floats per brick (
  // the B channel is the mask-only occupancy nibble, the app's brickOccupancy on the edit grid below)
  const BS = 8, bx = N / BS, bricks = new Float32Array(bx * bx * bx * 4);
  for (let k = 0; k < bx; k++) for (let j = 0; j < bx; j++) for (let i = 0; i < bx; i++) {
    let lo = 1e9, hi = -1e9;
    for (let z = Math.max(0, k * BS - 1); z < Math.min(N, (k + 1) * BS + 1); z++) for (let y = Math.max(0, j * BS - 1); y < Math.min(N, (j + 1) * BS + 1); y++) for (let x = Math.max(0, i * BS - 1); x < Math.min(N, (i + 1) * BS + 1); x++) { const v = hu[(z * N + y) * N + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const o = ((k * bx + j) * bx + i) * 4; bricks[o] = lo; bricks[o + 1] = hi;
  }
  // mask-only edit of the bone segment on a HALF grid (the app rasterises the mask on the <= 256 grid and samples it by
  // normalised coordinate, so at 512^3 one brick is 4^3 edit voxels): the bone ball "closed" to a ball of 12 voxels (its ramp and a shell of
  // soft tissue filled in), plus a detached 8-voxel cube of soft tissue reaching bricks with no bone HU at all. With editMaskOnly the bone segment
  // is exactly this mask; a brick skip that ignored the mask would lose the cube and the shell.
  const M = N / 2, edit = new Uint8Array(M * M * M * 4), cM = M / 2, sM = M / 64;
  for (let z = 0; z < M; z++) for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const cx = x + 0.5 - cM, cy = y + 0.5 - cM, cz = z + 0.5 - cM;
    const ball = Math.hypot(cx, cy, cz) < 12 * sM, cube = cx >= 12 * sM && cx < 20 * sM && cy >= -8 * sM && cy < 0 && cz >= 2 * sM && cz < 10 * sM; // the cube: 8 full-grid voxels a side, partly in bricks with no bone HU
    if (ball || cube) edit[((z * M + y) * M + x) * 4] = 255;
  }
  const editInfo = { data: edit, dims: [M, M, M], active: 1, maskOnly: 1 }, occ = brickOccupancy(editInfo, [bx, bx, bx]);
  const occupied = writeBrickOccupancy(bricks, occ);
  // the pre-526 behaviour for comparison: every brick is a candidate of the mask-only segment
  const bricksMixed = bricks.slice(); for (let b = 0; b < bx * bx * bx; b++) bricksMixed[b * 4 + 2] = 15;
  return { N, hu, vol, cls, dist, combo, cls4, bricks, bricksMixed, brickN: bx, edit, editN: M, occupied, four };
}
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

// ---- headless Chromium ----
export async function withPage(fn) {
  const nm = path.join(ROOT, 'node_modules');
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><html><body></body></html>'); });
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const pg = await browser.newPage(), problems = [];
    pg.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message \(OpenGL, Performance/.test(m.text())) { // (Chromium's harmless 'GPU stall due to ReadPixels' notice is not a problem)
      problems.push(m.type() + ': ' + m.text().slice(0, 400)); console.log('console.' + m.type() + ':', m.text().slice(0, 400)); } });
    pg.on('pageerror', e => { problems.push('pageerror: ' + e); console.log('PAGEERROR', String(e).slice(0, 400)); });
    await pg.route(/^https:\/\//, rt => { const u = rt.request().url(); const f = u.includes('three.module.js') ? 'three.module.js' : u.includes('three.core.js') ? 'three.core.js' : null; if (f) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(nm, 'three/build', f), 'utf8') }); return rt.abort(); });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/');
    const version = browser.version();
    return await fn(pg, { problems, version });
  } finally { await browser.close(); srv.close(); }
}

// The page function. Self-contained (Playwright serialises it). args: {sh, N, scene:{vol,bricks,cls,combo}, W, H, cases, mode, filter}
// A case: {name, defines:[...], f, u:{...uniform overrides}, region?, cam?}. mode 'color': RGBA8 (premultiplied over the background, the low-resolution
// path through the app's composite pass when f < 1). mode 'hit': a Float RGBA target, every pixel (hp.xyz, segment + 1) or 0, with the shader
// patched at its hit point (the same GLSL otherwise); also returns the camera ray of every pixel.
export async function renderBatch(args) {
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js');
  const { sh, N, W, H, mode, filter } = args, he = args.halfExt;
  const un = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  const tex3 = (data, w, h, d, format, type, f) => { const t = new THREE.Data3DTexture(data, w, h, d); t.format = format; t.type = type; t.minFilter = t.magFilter = f; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
  const L = THREE.LinearFilter, NN = THREE.NearestFilter, clsF = filter === 'nearest' ? NN : L;
  const vol = tex3(un(args.scene.vol), N, N, N, THREE.RGFormat, THREE.UnsignedByteType, L);
  const bx = args.scene.brickN, bricks = tex3(new Float32Array(un(args.scene.bricks).buffer), bx, bx, bx, THREE.RGBAFormat, THREE.FloatType, NN);
  const bricksMixed = args.scene.bricksMixed ? tex3(new Float32Array(un(args.scene.bricksMixed).buffer), bx, bx, bx, THREE.RGBAFormat, THREE.FloatType, NN) : null;
  const M = args.scene.editN, editTex = args.scene.edit ? tex3(un(args.scene.edit), M, M, M, THREE.RGBAFormat, THREE.UnsignedByteType, L) : null;
  const clsRaw = tex3(un(args.scene.cls), N, N, N, THREE.RGBAFormat, THREE.UnsignedByteType, clsF);
  const combo = tex3(un(args.scene.combo), N, N, N, THREE.RGBAFormat, THREE.UnsignedByteType, clsF);
  // the fourth segment's classification bytes (R8, VRL_CLS4) and the separate distance texture of the general loop (useDist), when the scene has them
  const cls4 = args.scene.cls4 ? tex3(un(args.scene.cls4), N, N, N, THREE.RedFormat, THREE.UnsignedByteType, clsF) : null;
  const distT = args.scene.dist ? tex3(un(args.scene.dist), N, N, N, THREE.RGBAFormat, THREE.UnsignedByteType, NN) : null;
  const dummy = tex3(new Uint8Array(4), 1, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType, L);
  const regData = new Uint8Array(N * N * N); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++) regData[(z * N + y) * N + x] = 1;
  const regionTex = tex3(regData, N, N, N, THREE.RedFormat, THREE.UnsignedByteType, NN);
  const V4 = (...a) => new THREE.Vector4(...a), half = new THREE.Vector3(...he), voxelMin = Math.min(2 * he[0] / N, 2 * he[1] / N, 2 * he[2] / N);
  const baseUniforms = () => ({
    vol: { value: vol }, bricks: { value: bricks }, halfExt: { value: half }, boxC: { value: new THREE.Vector3() }, boxH: { value: new THREE.Vector3() }, boxEntry: { value: 0 }, texDims: { value: new THREE.Vector3(N, N, N) }, brickDims: { value: new THREE.Vector3(bx, bx, bx) },
    stepSize: { value: voxelMin * 0.85 }, diag: { value: 0 }, calib: { value: new THREE.Vector3(1, -1024, 0) },
    segA: { value: [V4(300, 3000, 1, 1), V4(-200, 299, 0.35, 1), V4(-250, -50, 1, 1), args.scene.four ? V4(-800, -300, 1, 1) : V4()] }, segC: { value: [V4(0.91, 0.86, 0.72, 0), V4(0.85, 0.55, 0.42, 0), V4(0.95, 0.85, 0.35, 0), V4(0.44, 0.72, 0.84, 0)] }, segM: { value: [0, 1, 2, 3].map(() => V4(...args.segM)) },
    cutPlanes: { value: Array.from({ length: 10 }, () => V4(0, 0, 1, 0)) }, planeCount: { value: 0 }, planeCut: { value: 0 }, capOn: { value: 1 }, sliceTint: { value: 0.5 }, sliceOpacity: { value: 0 },
    sliceWindow: { value: new THREE.Vector2(40, 400) }, sliceAir: { value: -500 }, sliceVol: { value: vol }, refine: { value: 1 }, useCls: { value: 1 }, clsTex: { value: combo }, clsChan: { value: V4(0, 1, 2, -1) },
    editMask: { value: 0 }, editMaskOnly: { value: 0 }, editTex: { value: dummy }, useDist: { value: 0 }, distInCls: { value: 1 }, distTex: { value: dummy }, cls4Tex: { value: cls4 || dummy }, voxelMin: { value: voxelMin }, voxelSize: { value: new THREE.Vector3(2 * he[0] / N, 2 * he[1] / N, 2 * he[2] / N) },
    regionTex: { value: regionTex }, regionC: { value: Array.from({ length: 14 }, (_, i) => new THREE.Vector3(...(i ? [1, 1, 1] : [0, 0.85, 1]))) }, regionSeg: { value: Array.from({ length: 14 }, () => 15) },
  });
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.01, 50); cam.position.set(2.0, 1.3, 2.5); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const BG = [0.04, 0.06, 0.09];
  const geo = new THREE.BoxGeometry(2, 2, 2), out = {};
  const hitFs = src => { const a = ' float contribution=(1.0-acc.a)*alpha;acc=vec4(acc.rgb+lit*contribution,acc.a+contribution);hitEnd=true;'.trim(), i = src.indexOf(a); if (i < 0) throw new Error('parity anchor (the hit shading of the tight loop) not found in the fragment shader'); return src.replace(a, 'outColor=vec4(hp,float(idx)+1.0);return;'); };
  const mkMat = (c, ray, hit) => {
    const u = baseUniforms();
    for (const [k, v] of Object.entries(c.u || {})) { if (Array.isArray(v) && v.length && typeof v[0] === 'object') { const arr = v.map(a => V4(...a)); if (k === 'cutPlanes') while (arr.length < 10) arr.push(V4(0, 0, 1, 0)); /* the uniform array has 10 entries (three.js reads all of them) */ u[k] = { value: arr }; } else if (Array.isArray(v)) u[k] = { value: v.length === 4 ? V4(...v) : new THREE.Vector3(...v) }; else u[k] = { value: v }; }
    if (c.useClsRaw) u.clsTex = { value: clsRaw };
    if (c.useDistTex) { if (!distT) throw new Error('useDistTex needs the scene distance bytes'); u.useDist = { value: 1 }; u.distInCls = { value: 0 }; u.distTex = { value: distT }; } // the general loop with its separate field
    if (args.scene.four) u.clsChan = { value: V4(0, 1, 2, 3) };
    if (c.noCls) { u.useCls = { value: 0 }; u.distInCls = { value: 0 }; }
    if (c.maskOnly) { if (!editTex) throw new Error('case ' + c.name + ' needs the scene edit mask'); u.editMask = { value: 1 }; u.editMaskOnly = { value: 1 }; u.editTex = { value: editTex }; } // bone decided by the mask alone
    if (c.bricksMixed) { if (!bricksMixed) throw new Error('case ' + c.name + ' needs the scene bricksMixed'); u.bricks = { value: bricksMixed }; } // every brick a mask-only candidate (pre-526)
    const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: sh.vs, fragmentShader: hit ? hitFs(sh.fs) : sh.fs, side: THREE.BackSide, toneMapped: false, uniforms: u, defines: Object.fromEntries((c.defines || []).map(d => [d, ''])) });
    if (ray || hit) { m.blending = THREE.NoBlending; m.transparent = false; } else { m.transparent = false; m.depthWrite = true; m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; }
    return m;
  };
  const draw = (mat, target, clear, alpha) => {
    const sc = new THREE.Scene(), mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; sc.add(mesh);
    renderer.setRenderTarget(target); renderer.setClearColor(new THREE.Color(...clear), alpha); renderer.clear(true, true, false); renderer.render(sc, cam); mat.dispose();
  };
  const read = (rt, Type) => { const px = new Type(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, px); return px; };
  // mode 'depth': the window depth (0..1, the depth buffer's own value; 1 = nothing drawn) of every pixel after the volume pass (f >= 1) or after the composite pass (f < 1), as W*H Float32
  // (row 0 = bottom). The depth texture is copied to a float colour target by a full-screen pass and read back.
  const readDepth = rt => {
    const fr = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, type: THREE.FloatType, minFilter: NN, magFilter: NN });
    const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}', fragmentShader: 'uniform highp sampler2D dTex;out highp vec4 outColor;void main(){outColor=vec4(texelFetch(dTex,ivec2(gl_FragCoord.xy),0).r,0.0,0.0,1.0);}', uniforms: { dTex: { value: rt.depthTexture } }, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false; const sc = new THREE.Scene(); sc.add(q);
    renderer.setRenderTarget(fr); renderer.setClearColor(new THREE.Color(0, 0, 0), 1); renderer.clear(true, true, false); renderer.render(sc, cam);
    const px = read(fr, Float32Array), d = new Float32Array(W * H); for (let i = 0; i < W * H; i++) d[i] = px[i * 4];
    fr.dispose(); m.dispose(); return d;
  };
  for (const c of args.cases) {
    // c.camUp rolls the viewer about its view axis (the equivalent of turning the volume): the shared headlight must stay above the VIEWER; no camUp = the default up, the same matrix as before
    cam.up.set(...(c.camUp || [0, 1, 0])); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    if (mode === 'hit') {
      const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, type: THREE.FloatType, minFilter: NN, magFilter: NN });
      draw(mkMat(c, true, true), rt, [0, 0, 0], 0); out[c.name] = b64f(read(rt, Float32Array)); rt.dispose();
    } else if (!(c.f < 1)) {
      const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, ...(mode === 'depth' ? { depthTexture: new THREE.DepthTexture(W, H) } : {}) }); // the volume writes depth (gl_FragDepth), as in the app
      draw(mkMat(c, false, false), rt, BG, 1);
      if (c.arrow && mode !== 'depth') { // an optional overlay drawn after the volume into the same target (LineSegments, pure green, never writes depth), as the app draws the section arrow: c.arrow = {pts: [[x,y,z],...] segment end points (object space), depthTest}
        const g = new THREE.BufferGeometry().setFromPoints(c.arrow.pts.map(p => new THREE.Vector3(...p))), lm = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, depthTest: !!c.arrow.depthTest, depthWrite: false, toneMapped: false }), ls = new THREE.LineSegments(g, lm), osc = new THREE.Scene();
        ls.frustumCulled = false; ls.renderOrder = 2; osc.add(ls); renderer.setRenderTarget(rt); renderer.autoClear = false; renderer.render(osc, cam); renderer.autoClear = true; g.dispose(); lm.dispose();
      }
      out[c.name] = mode === 'depth' ? b64f(readDepth(rt)) : b64f(read(rt, Uint8Array)); rt.dispose();
    } else {
      // the low-resolution path of vr-view.js: the ray material into a small target (cleared to transparent), then the composite pass over the background
      // c.fullAlloc = the target allocated at the full size and only its corner used (as the app does now: no reallocation when f changes; the rest holds
      // garbage that must never be sampled); c.fov = {k, rect: [x0, y0, x1, y1] output px, band px}: offscreen foveation (the centre rect at f, the whole view at f * k into a second target)
      const f = c.f, tw = Math.max(1, Math.ceil(W * f)), th = Math.max(1, Math.ceil(H * f)), full = !!(c.fullAlloc || c.fov);
      const mkT = (w, h) => new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, depthTexture: new THREE.DepthTexture(w, h), minFilter: L, magFilter: L });
      const low = mkT(full ? W : tw, full ? H : th), rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, ...(mode === 'depth' ? { depthTexture: new THREE.DepthTexture(W, H) } : {}) });
      const renderCorner = (mat, t, fs, sc) => { // the app's clearCorner + per-eye viewport (one eye here)
        const cw = Math.max(1, Math.ceil(W * fs)), ch = Math.max(1, Math.ceil(H * fs)), scn = new THREE.Scene(), mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scn.add(mesh);
        t.scissorTest = false; renderer.setRenderTarget(t); renderer.setClearColor(new THREE.Color(1, 0, 1), 1); renderer.clear(true, true, false); // garbage outside the used corner
        t.scissor.set(0, 0, Math.min(t.width, cw + 2), Math.min(t.height, ch + 2)); t.scissorTest = true; renderer.setRenderTarget(t); renderer.setClearColor(new THREE.Color(0, 0, 0), 0); renderer.clear(true, true, false);
        t.viewport.set(0, 0, cw, ch); if (sc) t.scissor.set(...sc); else t.scissor.set(0, 0, cw, ch); renderer.setRenderTarget(t); renderer.render(scn, cam); t.scissorTest = false; mat.dispose();
      };
      let peri = null;
      if (!full) draw(mkMat(c, true, false), low, [0, 0, 0], 0);
      else if (!c.fov) renderCorner(mkMat(c, true, false), low, f, null);
      else {
        const R = c.fov.rect, sx = Math.floor(R[0] * f) - 1, sy = Math.floor(R[1] * f) - 1; renderCorner(mkMat(c, true, false), low, f, [sx, sy, Math.ceil(R[2] * f) + 1 - sx, Math.ceil(R[3] * f) + 1 - sy]);
        peri = mkT(Math.ceil(W * 0.75), Math.ceil(H * 0.75)); renderCorner(mkMat(c, true, false), peri, f * c.fov.k, null);
      }
      const cu = { img: { value: low.texture }, depthImg: { value: low.depthTexture }, invSize: { value: new THREE.Vector2(f / low.width, f / low.height) }, halfExt: { value: half }, uvMax: { value: new THREE.Vector2((Math.ceil(W * f) - 0.5) / low.width, (Math.ceil(H * f) - 0.5) / low.height) }, uvMax2: { value: new THREE.Vector2(1, 1) } }; // the app's used-corner clamp
      if (peri) Object.assign(cu, { img2: { value: peri.texture }, depthImg2: { value: peri.depthTexture }, invSize2: { value: new THREE.Vector2(f * c.fov.k / peri.width, f * c.fov.k / peri.height) }, uvMax2: { value: new THREE.Vector2((Math.ceil(W * f * c.fov.k) - 0.5) / peri.width, (Math.ceil(H * f * c.fov.k) - 0.5) / peri.height) }, fovOn: { value: 1 }, rectL: { value: new THREE.Vector4(...c.fov.rect) }, rectR: { value: new THREE.Vector4() }, splitX: { value: 1e9 }, band: { value: c.fov.band } });
      const comp = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: sh.cvs, fragmentShader: sh.cfs, side: THREE.BackSide, toneMapped: false, depthWrite: true, transparent: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, uniforms: cu });
      draw(comp, rt, BG, 1); out[c.name] = mode === 'depth' ? b64f(readDepth(rt)) : b64f(read(rt, Uint8Array)); rt.dispose(); low.dispose(); peri?.dispose();
    }
  }
  function b64f(a) { const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  const gl = renderer.getContext(), err = gl.getError();
  let rays = null;
  if (mode === 'hit') { const r = new Float32Array(W * H * 3), v = new THREE.Vector3(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { v.set((x + 0.5) / W * 2 - 1, (y + 0.5) / H * 2 - 1, 0.5).unproject(cam).sub(cam.position).normalize(); const o = (y * W + x) * 3; r[o] = v.x; r[o + 1] = v.y; r[o + 2] = v.z; } rays = b64f(r); }
  return { out, glError: err, cam: cam.position.toArray(), rays };
}

export async function runBatch(pg, args) {
  const r = await pg.evaluate(renderBatch, { segM: materialVec('standard'), ...args }); // every segment at the standard material unless a case says otherwise
  const dec = s => Buffer.from(s, 'base64');
  return { ...r, out: Object.fromEntries(Object.entries(r.out).map(([k, v]) => [k, dec(v)])), raysBuf: r.rays ? new Float32Array(new Uint8Array(dec(r.rays)).buffer) : null };
}
export const sceneArgs = s => ({ vol: b64(s.vol), bricks: b64(s.bricks), cls: b64(s.cls.data), combo: b64(s.combo), brickN: s.brickN, ...(s.edit ? { edit: b64(s.edit), editN: s.editN, bricksMixed: b64(s.bricksMixed) } : {}), ...(s.four ? { four: true, cls4: b64(s.cls4), dist: b64(s.dist.data) } : {}) });

// ---- PNG (RGBA8, filter 0 only: written and read by this tool) ----
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = ~0; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return ~c >>> 0; };
export function encodePng(px, w, h) { // px: RGBA bytes, row 0 = bottom (GL readback order); the PNG is written top-down
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + (h - 1 - y) * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
export function decodePng(buf) { // back to GL order (row 0 = bottom)
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[9] !== 6) throw new Error('golden PNG must be RGBA8'); } else if (type === 'IDAT') idat.push(d); p += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) { if (raw[y * (w * 4 + 1)] !== 0) throw new Error('golden PNG uses a filter this reader does not support'); px.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), (h - 1 - y) * w * 4); }
  return { px, w, h };
}
// changed pixels (any channel differs) and the largest channel difference
export function diffPixels(a, b) {
  if (a.length !== b.length) return { pixels: Infinity, maxDiff: 255 };
  let pixels = 0, maxDiff = 0;
  for (let i = 0; i < a.length; i += 4) { let m = 0; for (let j = 0; j < 4; j++) { const d = Math.abs(a[i + j] - b[i + j]); if (d > m) m = d; } if (m) pixels++; if (m > maxDiff) maxDiff = m; }
  return { pixels, maxDiff };
}
