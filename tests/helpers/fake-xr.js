// A fake WebXR device for the browser tests (no headset in CI): navigator.xr answers an immersive session whose XRWebGLLayer has its own framebuffer (the path three.js takes
// without XRGPUBinding), a viewer pose with a slight head bob, and no input sources. The frames are driven by window.__xrh: frame() runs one XR frame (the callbacks of
// session.requestAnimationFrame), start(periodMs) / stop() pump them from a timer (a block of the main thread then shows as a gap between two frames: __xrh.times has the
// performance.now() of every frame). Use as page.addInitScript(fakeXrInit, { size: 160 }) before the page loads (options: size = pixels per eye, clear = clear the layer each frame, holdRaf = while the session runs the window's requestAnimationFrame / requestIdleCallback callbacks are HELD back and run only when it ends, as in a headset browser: code that awaits the page's rAF then stands still). Same device as tools/vr-start-flicker-check.mjs.
export function fakeXrInit(opts = {}) {
  delete window.XRWebGLBinding; // the XRWebGLLayer path of three.js
  const W = opts.size || 160, H = W; // per eye
  const og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) { const c = og.call(this, t, a); if (c && t === 'webgl2') c.makeXRCompatible = async () => {}; return c; };
  const mat4 = (p, yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, p[0], p[1], p[2], 1]); };
  const inv = m => { const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]], t = [m[12], m[13], m[14]];
    return new Float32Array([r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, -(r[0] * t[0] + r[3] * t[1] + r[6] * t[2]), -(r[1] * t[0] + r[4] * t[1] + r[7] * t[2]), -(r[2] * t[0] + r[5] * t[1] + r[8] * t[2]), 1]); };
  const proj = (() => { const n = 0.01, f = 50, t = Math.tan(48 * Math.PI / 180); return new Float32Array([1 / t, 0, 0, 0, 0, 1 / t, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0]); })();
  const tf = m => ({ matrix: m, inverse: { matrix: inv(m) }, position: { x: m[12], y: m[13], z: m[14], w: 1 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  const st = { rafHeld: 0, rafCalls: 0, t: 0, fbo: null, gl: null, cbs: new Map(), id: 0, session: null, times: [], errors: [], timer: 0, ended: 0 };
  window.__xrh = st;
  class FakeLayer { constructor(session, gl) { st.gl = gl; this.framebufferWidth = 2 * W; this.framebufferHeight = H; this.ignoreDepthValues = false; this.fixedFoveation = 0;
    const fb = gl.createFramebuffer(), c = gl.createRenderbuffer(), d = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 2 * W, H); gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, 2 * W, H);
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, d); gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    this.framebuffer = fb; st.fbo = fb; }
    getViewport(view) { return { x: view.eye === 'left' ? 0 : W, y: 0, width: W, height: H }; } }
  window.XRWebGLLayer = FakeLayer;
  // holdRaf: the page's window rAF / rIC do not run while an immersive session is presented
  const held = [], realRaf = window.requestAnimationFrame.bind(window), realCancel = window.cancelAnimationFrame.bind(window), realRic = window.requestIdleCallback?.bind(window), realCic = window.cancelIdleCallback?.bind(window);
  let hold = false, hid = 1e9;
  st.holdOn = () => {
    if (hold) return; hold = true;
    window.requestAnimationFrame = cb => { const id = ++hid; held.push({ id, cb, raf: true }); st.rafHeld = held.length; st.rafCalls++; return id; };
    window.cancelAnimationFrame = id => { const i = held.findIndex(h => h.id === id); if (i >= 0) held.splice(i, 1); else realCancel(id); };
    if (realRic) { window.requestIdleCallback = (cb, o) => { const id = ++hid; held.push({ id, cb: () => cb({ didTimeout: false, timeRemaining: () => 10 }), raf: false }); st.rafHeld = held.length; return id; }; window.cancelIdleCallback = id => { const i = held.findIndex(h => h.id === id); if (i >= 0) held.splice(i, 1); else realCic(id); }; }
  };
  st.holdOff = () => {
    if (!hold) return; hold = false;
    window.requestAnimationFrame = realRaf; window.cancelAnimationFrame = realCancel; if (realRic) { window.requestIdleCallback = realRic; window.cancelIdleCallback = realCic; }
    const list = held.splice(0); st.rafHeld = 0; for (const h of list) realRaf(t => h.cb(t));
  };
  class FakeSession extends EventTarget {
    constructor(mode) { super(); this.mode = mode; this.renderState = { baseLayer: null, depthNear: 0.1, depthFar: 1000 }; this.inputSources = []; this.enabledFeatures = ['local-floor']; this.environmentBlendMode = 'opaque'; this.visibilityState = 'visible'; this.supportedFrameRates = new Float32Array([72, 90]); this.frameRate = 72; st.session = this; if (opts.holdRaf) st.holdOn(); }
    updateRenderState(o) { Object.assign(this.renderState, o); }
    async requestReferenceSpace() { const s = { getOffsetReferenceSpace: () => s, addEventListener() {} }; return s; }
    requestAnimationFrame(cb) { const id = ++st.id; st.cbs.set(id, cb); return id; }
    cancelAnimationFrame(id) { st.cbs.delete(id); }
    async updateTargetFrameRate(r) { this.frameRate = r; }
    async end() { st.ended++; st.stop(); st.holdOff(); this.dispatchEvent(new Event('end')); }
  }
  Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: async () => true, requestSession: async m => new FakeSession(m), addEventListener() {} } });
  // one XR frame: the layer is cleared (as the compositor's fresh buffer; the app's GL state is restored after), then the callbacks run
  st.frame = () => {
    const gl = st.gl; st.t += 1000 / 72;
    const cbs = [...st.cbs.values()]; st.cbs.clear();
    st.times.push(performance.now()); if (st.times.length > 200000) st.times.shift();
    const ph = st.t / 1000 * 2 * Math.PI * 1.5, head = [0.002 * Math.sin(ph), 1.6 + 0.002 * Math.cos(ph * 0.7), 0.003 * Math.sin(ph * 1.3)], yaw = 0.005 * Math.sin(ph);
    const view = (eye, dx) => ({ eye, projectionMatrix: proj, transform: tf(mat4([head[0] + dx, head[1], head[2]], yaw)), recommendedViewportScale: null, requestViewportScale() {} });
    const pose = { transform: tf(mat4(head, yaw)), views: [view('left', -0.032), view('right', 0.032)], emulatedPosition: false };
    const frame = { session: st.session, getViewerPose: () => pose, getPose: () => null, getJointPose: () => null, fillPoses: () => false, fillJointRadii: () => false, trackedAnchors: new Set(), detectedPlanes: undefined };
    // opts.clear: the layer is cleared like a compositor's fresh buffer. It reads the GL state back (getParameter), which WAITS for the GPU process when that is busy (software GL compiling a shader
    // or running the page's compute): a wait a headset's frame callback does not make. So it is off by default: the frame timings then show only what the page's own JS blocks.
    if (opts.clear && gl && st.fbo) {
      const pfb = gl.getParameter(gl.FRAMEBUFFER_BINDING), psc = gl.isEnabled(gl.SCISSOR_TEST), pcc = gl.getParameter(gl.COLOR_CLEAR_VALUE), pcm = gl.getParameter(gl.COLOR_WRITEMASK);
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo); gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.colorMask(true, true, true, true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pfb); if (psc) gl.enable(gl.SCISSOR_TEST); gl.clearColor(pcc[0], pcc[1], pcc[2], pcc[3]); gl.colorMask(pcm[0], pcm[1], pcm[2], pcm[3]);
    }
    for (const cb of cbs) { try { cb(st.t, frame); } catch (e) { st.errors.push(String((e && e.stack) || e).slice(0, 400)); } }
    return cbs.length;
  };
  // a timer pump: one frame every periodMs (setTimeout, corrected for drift; a blocked main thread delays the next frame, which is the point)
  st.start = (periodMs = 1000 / 72) => {
    st.stop(); let next = performance.now();
    const tick = () => { st.frame(); next += periodMs; const now = performance.now(); if (next < now - 50) next = now; st.timer = setTimeout(tick, Math.max(0, next - now)); };
    st.timer = setTimeout(tick, 0);
  };
  st.stop = () => { clearTimeout(st.timer); st.timer = 0; };
}
