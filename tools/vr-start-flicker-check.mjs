// VR start flicker check (safety; strobed over the whole view on Quest 3 right after entering VR).
// Opens an event-mode practice level in the real app on SwiftShader WebGL2, starts a VR session against a mocked WebXR device
// (XRWebGLLayer path with its own framebuffer, cleared to transparent black at every frame start as a compositor's fresh buffer;
// slight head bob), drives FRAMES frames and records per frame: the mean luminance of each eye, the render path (direct / offscreen),
// the scale in use, the program the volume is drawn with, the shader's shown-segment flags (segA.w) and the combined texture's safe mask.
// Fails when, within the first WINDOW_MS of the session, any of these alternates faster than MAX_PER_S changes in a second, or a
// frame after the first drawn one is left (nearly) black (nothing reached the headset's framebuffer).
//   PW_CHROMIUM=/opt/pw-browsers/chromium/chrome-linux/chrome node tools/vr-start-flicker-check.mjs
//   env: LEVEL=lv2 (lv0..lv3; lv2 starts with a hidden segment), FRAMES=260, WINDOW_MS=3000, MAX_PER_S=2, PORT=8781,
//        VRS='{"vres":1}' (VR settings JSON written before load: vres 1 = fixed 100 %, the direct path throughout), OUT=file.json
// Slow (the practice data is read and prepared like on the page: several minutes on SwiftShader). Not part of vr-guards.
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const LEVEL = process.env.LEVEL || 'lv2', FRAMES = +(process.env.FRAMES || 260), WINDOW_MS = +(process.env.WINDOW_MS || 3000), MAX_PER_S = +(process.env.MAX_PER_S || 2), PORT = +(process.env.PORT || 8781);
const root = path.resolve('docs'), nm = path.resolve('node_modules');
const ANCHOR = 'renderer.setAnimationLoop(xrTs=>{';
const DBG = 'globalThis.__vrDbg={get aq(){return aq},rs,get material(){return material},get mesh(){return mesh},get rayMesh(){return rayMesh},get comboT(){return comboT},shown:()=>shownMask()};';
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  fs.readFile(f, (e, b) => {
    if (e) { r.writeHead(404); return r.end(); }
    if (p === '/vr-view.js') { const s = b.toString('utf8'); if (!s.includes(ANCHOR)) { r.writeHead(500); return r.end('anchor missing'); } b = Buffer.from(s.replace(ANCHOR, DBG + ANCHOR)); }
    r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(b);
  });
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const map = u => {
  if (u.includes('three@0.186.0/build/three.module.js')) return nm + '/three/build/three.module.js';
  if (u.includes('three@0.186.0/build/three.webgpu.js')) return nm + '/three/build/three.webgpu.js';
  if (u.includes('three.core.js')) return nm + '/three/build/three.core.js';
  if (u.includes('dicom-parser')) return nm + '/dicom-parser/dist/dicomParser.min.js';
  if (u.includes('fflate')) return nm + '/fflate/esm/browser.js';
  return null;
};
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=6144'] });
const out = { level: LEVEL, frames: [], log: [] }, errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') out.log.push('error: ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => { errors.push(String(e)); console.log('PAGEERROR', String(e).slice(0, 400)); });
  await page.route(/^https:\/\//, rt => {
    const u = rt.request().url(), f = map(u);
    if (f) { let body = fs.readFileSync(f, 'utf8'); if (u.includes('dicom-parser')) body = 'const require=()=>({});const module={exports:{}};const exports=module.exports;\n' + body + '\nexport default (module.exports.default||module.exports);'; return rt.fulfill({ status: 200, contentType: 'text/javascript', body }); }
    if (u.includes('three-mesh-bvh') || u.includes('cornerstone')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const MeshBVH=class{};export const acceleratedRaycast=()=>{};export const computeBoundsTree=()=>{};export const disposeBoundsTree=()=>{};export default {};' });
    return rt.abort();
  });
  if (process.env.VRS) await page.addInitScript(v => { try { localStorage.setItem('vrl-vr-settings-5', v); } catch { /* none */ } }, process.env.VRS);
  await page.addInitScript(() => {
    try { const s = JSON.parse(localStorage.getItem('vrl.settings.v1') || '{}'); s.eventMode = true; localStorage.setItem('vrl.settings.v1', JSON.stringify(s)); } catch { /* none */ }
    delete window.XRWebGLBinding; // the XRWebGLLayer path of three.js
    const W = 480, H = 480; // per eye
    const og = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, a) { const c = og.call(this, t, a); if (c && t === 'webgl2') c.makeXRCompatible = async () => {}; return c; };
    const mat4 = (p, yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, p[0], p[1], p[2], 1]); };
    const inv = m => { const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]], t = [m[12], m[13], m[14]];
      return new Float32Array([r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, -(r[0] * t[0] + r[3] * t[1] + r[6] * t[2]), -(r[1] * t[0] + r[4] * t[1] + r[7] * t[2]), -(r[2] * t[0] + r[5] * t[1] + r[8] * t[2]), 1]); };
    const proj = (() => { const n = 0.01, f = 50, t = Math.tan(48 * Math.PI / 180); return new Float32Array([1 / t, 0, 0, 0, 0, 1 / t, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0]); })();
    const tf = m => ({ matrix: m, inverse: { matrix: inv(m) }, position: { x: m[12], y: m[13], z: m[14], w: 1 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    const st = { t: 0, fbo: null, gl: null, cbs: new Map(), id: 0, session: null };
    window.__xrh = st;
    class FakeLayer { constructor(session, gl) { st.gl = gl; this.framebufferWidth = 2 * W; this.framebufferHeight = H; this.ignoreDepthValues = false; this.fixedFoveation = 0;
      const fb = gl.createFramebuffer(), c = gl.createRenderbuffer(), d = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 2 * W, H); gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, 2 * W, H);
      const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, d); gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
      this.framebuffer = fb; st.fbo = fb; }
      getViewport(view) { return { x: view.eye === 'left' ? 0 : W, y: 0, width: W, height: H }; } }
    window.XRWebGLLayer = FakeLayer;
    class FakeSession extends EventTarget {
      constructor(mode) { super(); this.mode = mode; this.renderState = { baseLayer: null, depthNear: 0.1, depthFar: 1000 }; this.inputSources = []; this.enabledFeatures = ['local-floor']; this.environmentBlendMode = 'opaque'; this.visibilityState = 'visible'; this.supportedFrameRates = new Float32Array([72, 90]); this.frameRate = 72; st.session = this; }
      updateRenderState(o) { Object.assign(this.renderState, o); }
      async requestReferenceSpace() { const s = { getOffsetReferenceSpace: () => s, addEventListener() {} }; return s; }
      requestAnimationFrame(cb) { const id = ++st.id; st.cbs.set(id, cb); return id; }
      cancelAnimationFrame(id) { st.cbs.delete(id); }
      async updateTargetFrameRate(r) { this.frameRate = r; }
      async end() { this.dispatchEvent(new Event('end')); }
    }
    Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: async () => true, requestSession: async m => new FakeSession(m), addEventListener() {} } });
    const defs = m => (m && m.defines ? Object.keys(m.defines).filter(k => k !== 'VRL_MEDIUMP' && k !== 'VRL_REGIONS').sort().join('+') : '') || 'plain';
    // one XR frame: clear the layer (as the compositor's fresh buffer; the app's GL state is restored after, as a browser leaves it alone), run the callbacks, read back both eyes
    st.frame = () => {
      const gl = st.gl; st.t += 1000 / 72;
      const cbs = [...st.cbs.values()]; st.cbs.clear();
      const ph = st.t / 1000 * 2 * Math.PI * 1.5, head = [0.002 * Math.sin(ph), 1.6 + 0.002 * Math.cos(ph * 0.7), 0.003 * Math.sin(ph * 1.3)], yaw = 0.005 * Math.sin(ph);
      const view = (eye, dx) => ({ eye, projectionMatrix: proj, transform: tf(mat4([head[0] + dx, head[1], head[2]], yaw)), recommendedViewportScale: null, requestViewportScale() {} });
      const pose = { transform: tf(mat4(head, yaw)), views: [view('left', -0.032), view('right', 0.032)], emulatedPosition: false };
      const frame = { session: st.session, getViewerPose: () => pose, getPose: () => null, getJointPose: () => null, fillPoses: () => false, fillJointRadii: () => false, trackedAnchors: new Set(), detectedPlanes: undefined };
      if (gl && st.fbo) {
        const pfb = gl.getParameter(gl.FRAMEBUFFER_BINDING), psc = gl.isEnabled(gl.SCISSOR_TEST), pcc = gl.getParameter(gl.COLOR_CLEAR_VALUE), pcm = gl.getParameter(gl.COLOR_WRITEMASK);
        gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo); gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.colorMask(true, true, true, true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, pfb); if (psc) gl.enable(gl.SCISSOR_TEST); gl.clearColor(pcc[0], pcc[1], pcc[2], pcc[3]); gl.colorMask(pcm[0], pcm[1], pcm[2], pcm[3]);
      }
      let err = null;
      for (const cb of cbs) { try { cb(st.t, frame); } catch (e) { err = String(e && e.stack || e).slice(0, 300); } }
      let lum = null;
      if (gl && st.fbo) {
        const prevR = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, st.fbo); const px = new Uint8Array(2 * W * H * 4); gl.readPixels(0, 0, 2 * W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevR);
        let L = 0, R = 0, cL = 0, cR = 0; for (let y = 0; y < H; y += 2) for (let x = 0; x < 2 * W; x += 2) { const i = (y * 2 * W + x) * 4, v = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] + px[i + 3]; if (x < W) { L += v; cL++; } else { R += v; cR++; } }
        lum = [+(L / cL).toFixed(2), +(R / cR).toFixed(2)];
      }
      const d = globalThis.__vrDbg; let s = null;
      if (d && d.material) {
        const low = !!d.rs.low, drawn = low ? d.rayMesh?.material : d.mesh?.material;
        s = { f: +d.aq.f.toFixed(3), eff: +d.rs.eff.toFixed(3), low, per: d.rs.per, prog: (low ? 'low:' : 'direct:') + defs(drawn), segW: d.material.uniforms.segA.value.map(v => v.w).join(''),
          safe: d.comboT?.rb ? d.comboT.rb.safeMask : d.comboT?.comboMask ?? null, busy: !!d.comboT?.rb?.busy, shown: d.shown() };
      }
      return { t: Math.round(st.t), cbs: cbs.length, err, lum, s };
    };
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.locator(`[data-event-level="${LEVEL}"]`).click({ timeout: 60000 });
  await page.locator('.ready-badge').first().filter({ hasText: /ready/i }).waitFor({ timeout: 900000 });
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => { const b = document.getElementById('vr-view-button'); return b && !b.disabled && b.offsetParent !== null; }, null, { timeout: 900000 });
  await page.evaluate(() => document.getElementById('vr-view-button').click());
  await page.locator('#vr-prepare-panel .start:not([disabled])').waitFor({ timeout: 1800000 });
  await page.evaluate(() => document.querySelector('#vr-prepare-panel .start').click());
  for (let i = 0, idle = 0; i < FRAMES; i++) {
    await page.waitForTimeout(4);
    const r = await page.evaluate(() => window.__xrh.frame());
    if (!r.cbs) { i--; if (++idle > 20000) throw new Error('no XR frame callbacks'); continue; }
    r.i = i; out.frames.push(r);
    if (r.err) errors.push('frame ' + i + ': ' + r.err);
  }
} finally {
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out));
  await browser.close(); srv.close();
}

// ---- evaluation: from the first frame with the volume, within WINDOW_MS
const fr = out.frames.filter(f => f.s), t0 = fr.length ? fr[0].t : 0, win = fr.filter(f => f.t - t0 <= WINDOW_MS);
const fails = [...errors];
if (win.length < 60) fails.push(`only ${win.length} frames with the volume within ${WINDOW_MS} ms`);
const keys = { path: f => f.s.low, scale: f => f.s.eff, program: f => f.s.prog, segments: f => f.s.segW, safeMask: f => f.s.safe };
const report = {};
for (const [k, get] of Object.entries(keys)) {
  const ch = []; for (let i = 1; i < win.length; i++) if (get(win[i]) !== get(win[i - 1])) ch.push(win[i].t);
  let worst = 0; for (let i = 0; i < ch.length; i++) { let n = 0; for (let j = i; j < ch.length && ch[j] - ch[i] < 1000; j++) n++; worst = Math.max(worst, n); }
  report[k] = { changes: ch.length, worstPerSecond: worst, values: [...new Set(win.map(get))].slice(0, 6) };
  if (worst > MAX_PER_S) fails.push(`${k} changed ${worst} times within one second (limit ${MAX_PER_S}): ${ch.slice(0, 12).map(t => t - t0).join(', ')} ms`);
}
// a frame that left the framebuffer (nearly) empty: nothing was drawn (the background alone has alpha 255)
const ref = win.length ? Math.min(...win.slice(0, 5).map(f => Math.min(...f.lum))) : 0, dark = win.filter(f => Math.min(...f.lum) < ref * 0.5);
report.darkFrames = dark.length;
if (dark.length) fails.push(`${dark.length} frame(s) with (nearly) nothing drawn, first at ${dark[0].t - t0} ms`);
console.log(JSON.stringify({ level: LEVEL, frames: out.frames.length, window: win.length, report }, null, 1));
if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('OK: no render path, scale, program, shown-segment or safe-mask alternation and no empty frame in the first ' + WINDOW_MS + ' ms');
