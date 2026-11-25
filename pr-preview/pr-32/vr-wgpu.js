// WebGPU side of the VR / AR volume (the WGSL core is vr-wgsl-core.js): the GPU device (an XR-compatible adapter), the textures made from the same arrays the WebGL session uses
// (the three.js Data3DTexture objects stay the holders of the data, a GPUTexture is made from one on first use and again when its version changes), the volume render pass per eye,
// the offscreen targets (colour + depth packed in rgba8, both eyes side by side, reduced scale and the periphery target), and the composite material (three.js NodeMaterial, TSL) that
// puts the offscreen image into the headset's frame with the volume's depth. Plain WebGPU; three.js (the WebGPU build) is passed in.
import { volumeWgsl, uniformLayout, BOX_VERTICES, VOLUME_BINDINGS, COUNTER_FIELDS, ABLATIONS, COUNTER_CFG_BINDING, PROXY, PROXY_FIELDS, PROXY_BINDINGS, PROXY_DIFF_BINDINGS, proxyWgsl, proxyDiffWgsl } from './vr-wgsl-core.js?v=20261125-build762';
import { FOVEA_K } from './vr-render-scale.js?v=20261125-build762';
import { MARCH_VARIANTS, marchWgsl, createMarchHost } from './vr-wgpu-coarse-march.js?v=20261125-build762';
import { createCoarseProxy, tileLayout, tilePxOrg, walkLimitOk } from './vr-wgpu-coarse-proxy.js?v=20261125-build762'; // the coarse distance grid and its pre-pass variants of the shadow pass (group 2); the 4 x 4 tiles' layout of the display's new way
import { createNewPath, chooseWay, newPathText } from './vr-wgpu-newpath.js?v=20261125-build762'; // distSplit / proxyCoarse / both as the display's own low pass (the switches below, off); the same code is what the same-picture check draws
import { createIdentGpu } from './vr-wgpu-ident.js?v=20261125-build762'; // the same-picture check's GPU side (nothing is made until the page starts a check)
import { createCsShadow } from './vr-wgpu-cs.js?v=20261125-build762';
import { createDirectApi, directRegion } from './vr-wgpu-direct.js?v=20261125-build762'; // the direct draw trial (the centre of the volume drawn straight into the eye image; off unless the diagnostic setting asks)
import { createSpecPipelines, specSigOfPacked } from './vr-wgsl-spec.js?v=20261125-build762'; // A4: the specialised program (override constants for the settings that do not change per frame)
// run-time switch of the comparison bench (docs/vr-bench.js createIsolation): the volume pass's own GPU timestamps (the per-frame timestamp read-back: one mapAsync per pass) can be turned off for an isolation run. Default = as always (on).
export const GX_SWITCH = { timers: true };
export const VRGPU_STORE_KEY = 'vrl-vr-gpu';
export const TS_SAMPLE_EVERY = 8; // E0: while no breakdown is prepared or recorded the page asks for the volume timestamps on one frame in 8 (volume.setTimerEvery); a recording asks for every frame
// the choice of the page's 「WebGPUで開く」 button (kept per browser; no URL parameter: the public build's gate takes no unknown URL keys). Default: the WebGL view.
export function vrGpuRequested(stored = null) {
  if (stored === null) { try { stored = globalThis.localStorage?.getItem(VRGPU_STORE_KEY); } catch { stored = null; } }
  return stored === '1';
}
export function setVrGpuChoice(on) { try { globalThis.localStorage?.setItem(VRGPU_STORE_KEY, on ? '1' : '0'); } catch { /* private window */ } }
// can this browser start a WebGPU XR session at all (the page checks isSessionSupported separately: the 'webgpu' feature is only known at requestSession)
export function vrGpuAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.gpu && typeof globalThis.XRGPUBinding === 'function';
}

// ---- the session's life on the WebGPU side (the helpers vr-view.js calls; plain functions so a mock session can drive them) ----
// 512^3 is not drawn by the WGSL pass (its classification + distance grid exists at 256^3 only): the WebGPU view always uses the 256^3 grid, whatever the stored data setting says (the stored setting itself is left alone)
export const gxDataValue = (gx, v) => (gx ? 1 : (v | 0));
// the buttons of the menu's data row in the WebGPU view: 256^3 (lit) and a disabled 512^3 slot that carries the note
export const gxDataRow = noteText => [{ label: '256\u00b3', value: 1, on: true, disabled: false }, { label: noteText, value: 0, on: false, disabled: true }];
// three.js' XR manager (r186) restores the animation loop that existed when the session was set and starts it again on `window` when the session ends (its own 'end' listener, added inside setSession).
// The app's 'end' handler runs before that one, so it cannot stop the loop; this runs after it: the restored loop is removed and the requestAnimationFrame it started is cancelled.
export function stopRenderLoop(renderer) {
  const a = renderer?._animation;
  try { if (a) { a.setAnimationLoop(null); a.stop(); } else renderer?.setAnimationLoop?.(null); } catch { /* gone */ }
}
// the loop the XR manager saved when the session was set (it puts it back, and starts it, when the session ends): forgotten by the app's 'end' handler, which runs first, so that nothing is called on the renderer that handler let go of
export function releaseXrLoop(renderer) { try { if (renderer?.xr) renderer.xr._currentAnimationLoop = null; } catch { /* gone */ } }
// the XR manager's own 'end' listener is added when setSession starts, so a listener added after setSession was called (it returns, or throws) runs after it
export function stopLoopAfterXrEnd(session, renderer) { session.addEventListener('end', () => stopRenderLoop(renderer), { once: true }); }
// the session is open but the WebGPU side failed: end it (an immersive view that draws nothing is no use) and let the page say so (onFail(e))
export function failGxSession(session, onFail, e) {
  try { onFail?.(e); } catch { /* the page's line is not worth a second failure */ }
  try { const p = session.end(); p?.catch?.(() => {}); } catch { /* already ended */ }
}
// three.js' XR manager takes the session (renderer.xr.setSession): a failure ends the session and is reported; true = the session is in use. The loop stop is armed in every case (see stopLoopAfterXrEnd).
// alive(): false when the session ended while setSession was still awaiting (the 'end' listener below was added too late to hear it): the loop the manager started afterwards is stopped here.
export async function bindGxSession(renderer, session, onFail, alive = () => true) {
  let ok = false;
  try { await renderer.xr.setSession(session); ok = true; } catch (e) { failGxSession(session, onFail, e); } finally { stopLoopAfterXrEnd(session, renderer); }
  if (ok && !alive()) { stopRenderLoop(renderer); ok = false; }
  return ok;
}
// a renderer made here is let go: only one whose init() finished (dispose() of one that did not would run init() again through setAnimationLoop), and its async dispose is not left unhandled
export function disposeGxRenderer(r) { try { if (r?.initialized) r.dispose()?.catch?.(() => {}); } catch { /* gone */ } }
// The output of the WebGPU view without three.js' frame buffer. By default three.js (r187) draws the scene into an RGBA16F copy of the frame and encodes it to sRGB in a second pass per eye over the whole image
// (needsFrameBufferTarget: the output colour space is not the working one). Here the output colour space is the working (linear) one, so the frame is drawn straight into the headset's image, and each material encodes its own
// result to sRGB (the contextNode below: the same getOutput that three.js' XR layers use, three.webgpu.js XRManager). Consequences the callers rely on: (1) a material with a fragmentNode of its own (the composite) is NOT encoded,
// it must write display values (decode 0); (2) a plain material's output is encoded, so values that are meant as display values (the dome's vertex colours) are decoded first; (3) blending happens on the encoded values.
// Returns { materialSrgb, text }: text = the line of the diagnostic record. Nothing here throws: on a failure the renderer is left as three.js made it (the frame buffer pass).
export function useMaterialSrgbOutput(renderer, THREE) {
  const was = { outputColorSpace: renderer?.outputColorSpace, contextNode: renderer?.contextNode };
  try {
    const T = THREE.TSL, base = renderer.contextNode;
    if (!T?.context || !T?.renderOutput || !base?.getFlowContextData) throw new Error('no context / renderOutput in this three.js build');
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.contextNode = T.context({
      getOutput: (outputNode, builder) => { const n = T.renderOutput(outputNode, THREE.NoToneMapping, THREE.SRGBColorSpace); n.premultipliedAlpha = builder.material.premultipliedAlpha; return n; },
      ...base.getFlowContextData(),
    });
    return { materialSrgb: true, text: 'sRGB in each material (no frame buffer pass: output colour space linear, getOutput = renderOutput(NoToneMapping, sRGB))' };
  } catch (e) {
    try { renderer.outputColorSpace = was.outputColorSpace; renderer.contextNode = was.contextNode; } catch { /* gone */ }
    return { materialSrgb: false, text: 'three.js frame buffer pass (sRGB over an RGBA16F copy; the material route failed: ' + gxErrorText(e).msg + ')' };
  }
}
// the depth of the headset's image is not stored (the WebGPU view only). three.js (r187, WebGPUBackend.finishRender) draws an XR frame as one render pass per eye (layered render of an array camera) into its own depth array
// texture, and stores that depth at the end of each pass (the store op is Store whenever the target is not multisampled). Nothing reads it: the projection layer is made without a depth format (ignoreDepthValues: the compositor
// takes no depth), the volume's low / peri / shadow passes (below) have colour attachments of their own and are not touched, the composite and the labels only depth-test inside this pass, and the next frame clears the depth first.
// The hook sits on the backend instance's finishRender (node_modules / vendor three.js is not edited): just before the passes are begun it sets depthStoreOp = 'discard' on the layer descriptors of the XR render target when this frame
// clears the depth (depthLoadOp 'clear'; a frame that loads the depth of the last one keeps the store). The last stage of a multi-stage layer (a framebuffer copy in between) is the one three.js gives the op to, the stages before keep Store.
// Returns { installed, text } (text = the line of the diagnostic record). Nothing here throws: on a failure (no backend, another three.js build) the renderer keeps three.js' own store op.
export function discardXrDepth(renderer) {
  try {
    const backend = renderer?.backend, xr = renderer?.xr;
    if (typeof backend?.finishRender !== 'function' || typeof backend.get !== 'function' || !xr) throw new Error('no backend.finishRender / get or xr on this renderer');
    if (backend._vrlXrDepthDiscard) return { installed: true, text: backend._vrlXrDepthDiscard };
    const orig = backend.finishRender;
    backend.finishRender = function (renderContext) {
      try {
        const target = xr._xrRenderTarget, data = renderContext?.renderTarget === target && target ? this.get(renderContext) : null;
        if (data && Array.isArray(data.arrayCameraRenderStages) && Array.isArray(data.layerDescriptors)) { // the layered XR pass of this frame (finishRender takes its array-camera branch)
          for (const ld of data.layerDescriptors) { const da = ld?.depthStencilAttachment; if (da) da.depthStoreOp = da.depthLoadOp === 'clear' && !da.depthReadOnly ? 'discard' : 'store'; } // written every frame: three.js keeps the layer descriptors, so a frame that loads the depth after one that cleared it must not keep the last frame's op
        }
      } catch { /* the store op stays three.js' own */ }
      return orig.apply(this, arguments);
    };
    backend._vrlXrDepthDiscard = "XR depth: not stored (depthStoreOp 'discard' on the per-eye passes of three.js' XR target, the other passes keep their ops)";
    return { installed: true, text: backend._vrlXrDepthDiscard };
  } catch (e) {
    return { installed: false, text: 'XR depth: stored as three.js does (the hook failed: ' + gxErrorText(e).msg + ')' };
  }
}
// the device is lost for another reason than our own destroy(): onLost(info) once
export function watchDeviceLost(device, onLost) { device?.lost?.then(info => { if (info?.reason !== 'destroyed') onLost(info); }); }

// an XR-compatible adapter and a device with the optional features this renderer can use (shader-f16 for the half-precision march, timestamp-query for the volume pass time)
export async function requestVrGpuDevice() {
  if (!vrGpuAvailable()) throw new Error('WebGPU XR is not available (no navigator.gpu or XRGPUBinding)');
  const adapter = await navigator.gpu.requestAdapter({ xrCompatible: true });
  if (!adapter) throw new Error('no WebGPU adapter that can be used in XR (xrCompatible)');
  const wanted = ['shader-f16', 'timestamp-query', 'float32-filterable'].filter(f => adapter.features.has(f));
  // subgroups (the compute passes may use the subgroup operations): asked for when the adapter lists it; a device that refuses it is asked again with the three above, and then with none
  let want = adapter.features.has('subgroups') ? [...wanted, 'subgroups'] : wanted, device;
  try { device = await adapter.requestDevice({ requiredFeatures: want }); } catch {
    if (want.length > wanted.length) { want = wanted; try { device = await adapter.requestDevice({ requiredFeatures: want }); } catch { /* none below */ } }
    if (!device) { device = await adapter.requestDevice(); want = []; }
  }
  return { adapter, device, f16: device.features.has('shader-f16'), timestamps: device.features.has('timestamp-query'), subgroups: device.features.has('subgroups'), requested: want };
}

const TEX_FORMATS = { // three.js format -> [GPU format, bytes per texel]
  1028: ['r8unorm', 1], 1030: ['rg8unorm', 2], 1023: ['rgba8unorm', 4], // RedFormat, RGFormat, RGBAFormat (unsigned byte)
};
const upTo = (n, m) => Math.ceil(n / m) * m;
const CHUNK_BYTES = 8 << 20;

// ---- the drawn area of one eye: the volume pass draws only where the box can be seen, not the eye's whole image ----
// Rects here are [x0, y0, x1, y1] in px of the eye's full-size image with y UP (eyeMetrics of vr-render-scale.js / foveaRect); regions are in px of the SCALED image with y DOWN (the top-left origin of the targets).
// The steps a region's size is rounded up to: 64 px up to 256, 128 px up to 1024, 256 px above (a few sizes over a session: the pool of targets is keyed by size).
export function bucketSize(n) { n = Math.max(1, Math.ceil(n)); return n <= 256 ? upTo(n, 64) : n <= 1024 ? upTo(n, 128) : upTo(n, 256); }
// the size of a target slot for a needed size: the held one while it still holds the need and is not much bigger (a head that moves does not make a target every frame), else the next step; never beyond the full size
export function fitSlot(need, held, full) {
  need = Math.min(Math.max(1, Math.ceil(need)), full);
  if (held && held <= full && need <= held && need * 1.6 >= held) return held;
  return Math.min(bucketSize(need), full);
}
export const rectsMeet = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; // the common part (an empty one has x1 <= x0 or y1 <= y0)
// the integer region of a y-up rect in the scaled image (Wu x Hu px, scale = Wu / W): the pixels whose centres can lie in the rect, plus `margin` px each side (the bilinear upscale), clipped to the image, at least 1 px
export function scaledRegion(rect, H, scale, Wu, Hu, margin = 2) {
  let x0 = Math.floor(rect[0] * scale) - margin, x1 = Math.ceil(rect[2] * scale) + margin, y0 = Math.floor((H - rect[3]) * scale) - margin, y1 = Math.ceil((H - rect[1]) * scale) + margin;
  x0 = Math.min(Math.max(0, x0), Wu - 1); y0 = Math.min(Math.max(0, y0), Hu - 1);
  x1 = Math.min(Wu, Math.max(x1, x0 + 1)); y1 = Math.min(Hu, Math.max(y1, y0 + 1));
  return { x0, y0, x1, y1 };
}
// the clip-space change that lets one pass draw only a region of the eye's image into a target that is the size of the region: ndc' = a * ndc + b on x and y (z and w stay, so the depth is the same),
// for the region [x0, x1) x [y0, y1) (scaled px, y down) of an image Wu x Hu. mvp' = T * mvp (T acts on the clip x / y: x' = ax x + bx w, y' = ay y + by w).
export function regionClip(r, Wu, Hu) {
  const rw = r.x1 - r.x0, rh = r.y1 - r.y0;
  return { ax: Wu / rw, bx: (Wu - 2 * r.x0 - rw) / rw, ay: Hu / rh, by: 1 - Hu / rh + 2 * r.y0 / rh };
}
export function regionMvp(out, mvp, c) {
  const e = mvp.elements, o = out.elements;
  for (let k = 0; k < 4; k++) { const r0 = e[4 * k], r1 = e[4 * k + 1], r3 = e[4 * k + 3]; o[4 * k] = c.ax * r0 + c.bx * r3; o[4 * k + 1] = c.ay * r1 + c.by * r3; o[4 * k + 2] = e[4 * k + 2]; o[4 * k + 3] = r3; }
  return out;
}
// the scissor rects (region px -> offset into the slot) that cover the region except an inner rect: up to four disjoint bands (top, bottom, left, right); the whole region when the inner rect is empty or outside.
// inner = a y-up rect in full-size px (the part the periphery is never read in), shrunk here so that what the composite may still read is drawn. Returns [[x, y, w, h], ...] relative to the region's top-left.
export function bandRects(r, inner, H, scale, shrink) {
  const whole = [[0, 0, r.x1 - r.x0, r.y1 - r.y0]];
  if (!inner) return whole;
  const ex0 = Math.max(r.x0, Math.ceil((inner[0] + shrink) * scale)), ex1 = Math.min(r.x1, Math.floor((inner[2] - shrink) * scale));
  const ey0 = Math.max(r.y0, Math.ceil((H - inner[3] + shrink) * scale)), ey1 = Math.min(r.y1, Math.floor((H - inner[1] - shrink) * scale));
  if (ex1 <= ex0 || ey1 <= ey0) return whole;
  const out = [], add = (x0, y0, x1, y1) => { if (x1 > x0 && y1 > y0) out.push([x0 - r.x0, y0 - r.y0, x1 - x0, y1 - y0]); };
  add(r.x0, r.y0, r.x1, ey0); add(r.x0, ey1, r.x1, r.y1); add(r.x0, ey0, ex0, ey1); add(ex1, ey0, r.x1, ey1);
  return out;
}

export function createVolumeGpu({ device, THREE, f16 = false, onTargetFreed = null, onShader = null, onFatal = null }) {
  const layout = uniformLayout();
  const bgl = device.createBindGroupLayout({ entries: [
    { binding: VOLUME_BINDINGS.uniforms, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ...[VOLUME_BINDINGS.vol, VOLUME_BINDINGS.cls, VOLUME_BINDINGS.cls4, VOLUME_BINDINGS.edit, VOLUME_BINDINGS.slice].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } })),
    { binding: VOLUME_BINDINGS.skip, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint', viewDimension: '3d' } },
    { binding: VOLUME_BINDINGS.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: VOLUME_BINDINGS.samplerEdit, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: VOLUME_BINDINGS.proxy, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } }, // the pre-pass's tiles (r32float, read with textureLoad)
  ] });
  const pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const nearest = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const boxBuf = device.createBuffer({ size: BOX_VERTICES.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(boxBuf, 0, BOX_VERTICES);
  const mkUbuf = () => device.createBuffer({ size: layout.byteSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ubufs = [0, 1, 2, 3].map(mkUbuf);
  const xbufs = []; // the same-picture check's uniform buffers (9 and up: the breakdown's end lets 4..8 go and cuts `ubufs` back to four, these are not its to let go)
  const ubufOf = i => (i >= 9 ? xbufs[i] || (xbufs[i] = mkUbuf()) : ubufs[i] || (ubufs[i] = mkUbuf())); // frames 4..6 (the breakdown's shadow passes and counting probe) are made on first use
  const uAb = new ArrayBuffer(layout.byteSize), uF = new Float32Array(uAb), uI = new Int32Array(uAb);
  const pipes = new Map(), pipePending = new Map();
  const mx = createMarchHost({ device, bgl0: bgl }); // the shadow variants of the march (distSplit / march2: docs/vr-wgpu-coarse-march.js): their own group-1 layout, the grids they read
  const makeModule = v => { const m = device.createShaderModule({ code: v.march ? marchWgsl(volumeWgsl({ f16, cls4: v.cls4, events: v.events }), v.march) : volumeWgsl({ f16, ...v }) }); try { onShader?.(m, { f16, ...v }); } catch { /* diagnostics only */ } return m; }; // onShader: the session's diagnostics read the compiler's messages
  let pipeLayoutCnt = null, bglCnt = null; // the counting variants (abl / counters of the performance record's breakdown) have a second bind group: the storage buffer the counts go to
  const cntLayouts = () => {
    bglCnt ||= device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } }, { binding: COUNTER_CFG_BINDING.binding, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] }); // the counts, and the twin's window / tile mapping (vr-wgsl-core.js COUNTER_CFG_BINDING)
    pipeLayoutCnt ||= device.createPipelineLayout({ bindGroupLayouts: [bgl, bglCnt] });
    return { bglCnt, pipeLayoutCnt };
  };
  const pipeDesc = (v, mod = null, constants = null, lay = null) => { // mod / constants (A4): the specialised program's module and its pipeline constants (the fragment stage's); lay: a pipeline layout of its own (the new ways of the centre pass)
    const module = mod || makeModule(v);
    return { layout: lay || (v.counters ? cntLayouts().pipeLayoutCnt : v.march ? mx.layouts().pipeLayout : pipeLayout), vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module, entryPoint: 'fs', ...(constants ? { constants } : {}), targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' } };
  };
  const vkey = v => (v.cls4 ? 'c4' : 'c3') + (v.events ? 'e' : 'n') + (v.abl ? '-' + v.abl : '') + (v.counters ? '-cnt' : '') + (v.march ? '-' + v.march : '');
  // compiled ahead (the session start waits for these): the four variants a session can ask for (four stored segments x a section on or off)
  const warm = async (variants = [{ cls4: false, events: false }, { cls4: false, events: true }]) => {
    await Promise.all(variants.map(async v => {
      const k = vkey(v); if (!pipes.has(k)) { const p = await device.createRenderPipelineAsync(pipeDesc(v)); pipes.set(k, p); }
      if (!v.events) await warmProxy(!!v.cls4); // the pre-pass of the same display variant (a variant with section planes never uses it)
    }));
    await warmWays(variants);
  };
  // the display's ways (docs/vr-wgpu-newpath.js): the programs of every way of the listed variants are made and WAITED for (the session's first frame, and the data switch's compile stage, find them ready: no frame is drawn another way while they compile);
  // the programs of the other fourth-segment variant (a data switch to or from four stored segments) are started and not waited for
  const warmWays = async variants => {
    const want = new Set(variants.map(v => !!v.cls4)), np = dispNp();
    for (const c of want) np.ensureAll(c);
    await np.whenReady();
    let bad = np.failedRequired(); // a program that no other way can stand in for (the ones of B and OS have a fallback in the ladder: D, S)
    if (bad.length) { np.retryFailed(); for (const c of want) np.ensureAll(c); await np.whenReady(); bad = np.failedRequired(); } // once more
    if (bad.length) throw new Error('the display programs did not compile: ' + bad.join(', ')); // the session start (preload) fails: nothing could be drawn
    for (const c of [false, true]) if (!want.has(c)) np.ensureAll(c);
  };
  // P3: the data of the first frame is made at the start too (the distance texture, the marks and grids): the frame finds them
  const primeWays = (u, variants) => { const np = dispNp(); for (const c of new Set(variants.map(v => !!v.cls4))) { try { np.prime({ cls: clsInfoOf(u?.clsTex?.value), c4: c ? (() => { const i = clsInfoOf(u?.cls4Tex?.value); return i && { tex: u.cls4Tex.value, gen: i.gen, gpu: i.gpu }; })() : null, cls4: c }); } catch (e) { dnpNotes.push('prime threw: ' + String(e?.message ?? e).slice(0, 120)); } } };
  const pipeFor = v => { const k = vkey(v); let p = pipes.get(k); if (!p) { p = device.createRenderPipeline(pipeDesc(v)); pipes.set(k, p); } return p; }; // an unexpected variant compiles on the spot (a hitch, once)
  // ---- the specialised program (A4, docs/vr-wgsl-spec.js): a pipeline per (display variant, the settings that are override constants), made asynchronously when asked for; the breakdown's 'specCfg' shadow pass draws with it.
  // (the display never draws with a specialised pipeline: the breakdown's 'specCfg' shadow pass is the only user)
  const specs = createSpecPipelines({ device, f16, onShader, makeDesc: (module, constants, v) => pipeDesc(v, module, constants),
    onBuild: info => { try { bd?.onShadow?.(info.ok ? 'specMs' : 'specFail', info.ms, 1); if (!info.ok) bd?.onShadow?.('specErr:' + info.key + ' ' + info.error, 0, 1); } catch { /* the page's callback */ } } });

  // ---- the ways of the display (docs/vr-wgpu-newpath.js): B, D, D0, EvD, S, OS, EvS. The display draws every pass with one of them; the same-picture check (docs/vr-wgpu-ident.js) draws with its own instance of the same code (and, as its ruler, the display's own
  // program into a work image of its own). Each instance keeps its own distance texture, marks, grids, tiles and uniform buffers, none of the breakdown's (mx, coarse, bd.tgt / tgt2 / diff, uniform buffers 4..8).
  const npWriters = new Set(); // the instances that follow the combined texture's writes (their distance texture and marks are written from the same GPU bytes, the same range)
  const npDroppers = new Set(); // the instances that let go of what they made from a texture when it is disposed (a data switch cancelled half way)
  const makeNp = (tag, note) => { const np = createNewPath({ device, f16, bgl, renderDesc: (module, lay) => pipeDesc({}, module, null, lay), onShader, dropGroups: t => dropGroups(t), dummy: k => dummy(k), entryOf: t => entries.get(t), tag, onFail: note }); npWriters.add(np.onWrite); npDroppers.add(np.onTexGone); const destroy0 = np.destroy; np.destroy = () => { npWriters.delete(np.onWrite); npDroppers.delete(np.onTexGone); destroy0(); }; return np; }; // (a destroyed instance no longer follows the writes)
  let dnp = null; const dnpNotes = []; // the display's instance (made when a frame first asks, or by warm), the lines for the record
  const dispNp = () => { if (!dnp) dnp = makeNp('display', text => { dnpNotes.push(text); }); return dnp; };
  // the display's choice for a pass of this frame: always an instance (a way is chosen in drawPass for every frame). The breakdown and the check do not switch it off: they draw their own work images.
  let identOn = false; // (the check is running: kept for the record)
  const displayNp = () => ({ inst: dispNp() });
  // GPU errors of the display's own submits (an error scope around each pass), and what a pass that has no way does (8-1, 8-2 of the plan): an own error makes the next frame make the display's resources again and draw on with the ways; the third error in a row
  // (the first and two rebuilds that did not help) ends the session; so does a pass with no way that lasts, or whose program failed
  const FATAL = { errors: 2, noWayFrames: 600, cleanFrames: 90 };
  let fatalSent = false, rebuildPending = false, errRun = 0, errClean = 0; const noWayRun = { low: 0, peri: 0, probe: 0 };
  const fatal = why => { dnpNotes.push('session ended: ' + why); if (fatalSent) return; fatalSent = true; try { onFatal?.(new Error(why)); } catch { /* the page's callback */ } };
  let rebuiltAt = -1, lastErrFrame = -1; // the last frame drawn before the latest rebuild (an error recorded in it or before it is the old resources'), the last frame an error was counted for (the frame's passes count once)
  // (rebuiltAt below: every frame drawn so far was drawn with the resources that are about to be made again, their late answers are not new errors)
  const noteOwnError = (text, frame = frameNo) => { dnpNotes.push('GPU error in a display pass: ' + text); if (frame <= rebuiltAt || frame === lastErrFrame) return; lastErrFrame = frame; errRun++; errClean = 0; rebuiltAt = Math.max(rebuiltAt, frameNo); if (errRun > FATAL.errors) fatal('GPU errors again after ' + FATAL.errors + ' rebuilds of the display\'s resources: ' + text); else rebuildPending = true; };
  const noteDeviceError = text => { dnpNotes.push('device error outside a display submit (recorded only): ' + String(text).slice(0, 160)); };
  const rebuildDisplay = () => { rebuiltAt = frameNo - 1; try { dnp?.reset(); } catch (e) { dnpNotes.push('reset threw: ' + String(e?.message ?? e).slice(0, 120)); } groups.clear(); dnpNotes.push('the display\'s resources made again after a GPU error (' + errRun + ')'); };
  const noteNoWay = (pass, reason) => { noWayRun[pass] = (noWayRun[pass] | 0) + 1; if (reason === 'failed') fatal('no way of drawing the ' + pass + ' pass is usable: ' + (dnp?.failed || 'a program failed')); else if (noWayRun[pass] > FATAL.noWayFrames) fatal('the ' + pass + ' pass has had no way to draw with for ' + FATAL.noWayFrames + ' frames (' + reason + ')'); };
  const newPathStats = () => ({ stopped: '', notes: dnpNotes.slice(), errors: errRun, ...(dnp ? dnp.stats() : { used: 0, notUsed: 0, reasons: {}, byMode: {}, byWay: {} }) });

  // ---- textures made from three.js Data3DTexture objects ----
  const entries = new WeakMap();
  let uploadGen = 0; // a stamp that changes whenever any texture's contents are written (the coarse grid is made again then)
  const dummies = {};
  const dummy = (kind) => dummies[kind] || (dummies[kind] = (() => {
    const uint = kind === 'uint', t = device.createTexture({ size: [1, 1, 1], dimension: '3d', format: uint ? 'rg32uint' : 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, new Uint8Array(uint ? 8 : 4), { bytesPerRow: uint ? 8 : 4, rowsPerImage: 1 }, [1, 1, 1]);
    return t;
  })());
  const describe = tex => {
    const img = tex.image || {}, w = img.width, h = img.height, d = img.depth;
    if (!w || !h || !d) return null;
    if (tex.format === THREE.RGIntegerFormat && tex.type === THREE.UnsignedIntType) return { w, h, d, format: 'rg32uint', bpp: 8, uint: true };
    const f = TEX_FORMATS[tex.format];
    if (!f || tex.type !== THREE.UnsignedByteType) return null;
    return { w, h, d, format: f[0], bpp: f[1], uint: false };
  };
  let genSeq = 0;
  const writeRange = (e, data, z0, z1) => {
    uploadGen++; // a stamp that changes whenever any texture's contents are written (the coarse grid of the pre-pass variants is made again then)
    e.gen = ++genSeq; // the bytes on the GPU changed (the march variants' grids are made again from the texture's bytes)
    const rowBytes = e.w * e.bpp, sliceBytes = rowBytes * e.h, per = Math.max(1, Math.floor(CHUNK_BYTES / sliceBytes));
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let z = z0; z < z1; z += per) {
      const n = Math.min(per, z1 - z);
      device.queue.writeTexture({ texture: e.gpu, origin: [0, 0, z] }, bytes.subarray(z * sliceBytes, (z + n) * sliceBytes), { bytesPerRow: rowBytes, rowsPerImage: e.h }, [e.w, e.h, n]);
    }
    if (npWriters.size) for (const w of npWriters) w(e, bytes, z0, z1); // the new ways' distance textures follow this write (same bytes, same range)
  };
  // the GPUTexture of a three.js texture; made (and filled unless the texture is storage-only: source.dataReady false) on first ask, filled again when needsUpdate was set
  const gpuOf = tex => {
    if (!tex || !tex.isData3DTexture) return null;
    if (tex.format === THREE.RGFormat && tex.minFilter === THREE.NearestFilter) return null; // the analysis results' / child segments' index textures (RG8, nearest): this renderer does not read them, so they are not put on the GPU
    let e = entries.get(tex);
    const d = describe(tex);
    if (!d) return null;
    if (!e || e.w !== d.w || e.h !== d.h || e.d !== d.d || e.format !== d.format) {
      if (e) { dropGroups(e.gpu); e.gpu.destroy(); }
      e = { ...d, gpu: device.createTexture({ size: [d.w, d.h, d.d], dimension: '3d', format: d.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }), version: -1 };
      entries.set(tex, e);
      tex.addEventListener('dispose', () => { for (const f of npDroppers) { try { f(tex); } catch { /* gone */ } } const x = entries.get(tex); if (x) { dropGroups(x.gpu); x.gpu.destroy(); entries.delete(tex); } });
    }
    if (e.version !== tex.version) {
      e.version = tex.version;
      if (tex.source?.dataReady !== false && tex.image.data) writeRange(e, tex.image.data, 0, e.d);
    }
    return e.gpu;
  };
  // z slices [z0, z1) of src's array into dst at the same z (the uploads of a switch and the combined texture's rebuilt slices)
  const copySlab = (src, dst, box) => {
    gpuOf(dst);
    const e = entries.get(dst), data = src.image.data;
    if (!e || !data) return;
    if (data !== dst.image?.data) e.cpuOff = true; // bytes that are not the texture's own array went up (a bake): the texture's CPU bytes are not what is on the GPU, the new ways that build from them (distSplit's distance texture) leave it alone
    writeRange(e, data, box.min.z, box.max.z);
  };
  const initTexture = tex => { gpuOf(tex); };
  // the 1 x 1 stand-in of the pre-pass's tiles for a pass that has none (proxyOn is 0 there: it is never read)
  let proxyDummy = null;
  const proxyDummyTex = () => proxyDummy ||= device.createTexture({ size: [1, 1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING });

  // ---- small offscreen targets on demand: a pool keyed by size (the 48 x 48 probe's), colour + packed depth; the two passes' own targets are fixedTarget (below) ----
  const counts = { target: 0, tex: 0, group: 0, slot: 0, peri: 0, maps: 0 }; // running totals of what was made (the performance record reads the differences once a frame: target = offscreen target, tex = tile texture, group = bind group; slot / peri are counted by createVrVolumeRenderer)
  const pool = [];
  let frameNo = 0; // a target used in this frame is never let go in it
  const beginFrame = () => { frameNo++; if (rebuildPending) { rebuildPending = false; rebuildDisplay(); } else if (errRun > 0 && ++errClean >= FATAL.cleanFrames) { errRun = 0; errClean = 0; } };
  const getTarget = (w, h) => {
    const W = upTo(w, 64), H = upTo(h, 64);
    let t = pool.find(x => x.w === W && x.h === H);
    if (!t) {
      const mk = () => device.createTexture({ size: [W, H, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      t = { w: W, h: H, color: mk(), depth: mk(), stamp: 0 }; counts.target++;
      t.colorView = t.color.createView(); t.depthView = t.depth.createView();
      pool.push(t);
      // the least recently used sizes go first while the pool holds more than ~200 MB (colour + packed depth, 4 + 4 bytes a texel) or 8 sizes; the one just made and the last used stay
      const bytes = x => x.w * x.h * 8;
      while (pool.length > 2 && (pool.length > 8 || pool.reduce((a, x) => a + bytes(x), 0) > (200 << 20))) { const old = pool.filter(x => x !== t && x.frame !== frameNo).sort((a, b) => a.stamp - b.stamp)[0]; if (!old) break; pool.splice(pool.indexOf(old), 1); onTargetFreed?.(old); old.color.destroy(); old.depth.destroy(); old.dead = true; }
    }
    t.stamp = performance.now(); t.frame = frameNo;
    return t;
  };

  // ---- the two pass targets: the centre / whole-picture pass ('low') and the periphery pass ('peri') each have ONE target, made at the largest size the pass can need and kept (a region that grows or shrinks, in whatever step, only
  // changes which part of it the pass draws and the composite reads: the viewport / scissors / the composite's uv; nothing is made, destroyed or bound again; the way the WebGL view's offscreen targets are).
  // slotW x slotH = the largest slot of one eye (px of the pass's scaled image); the target holds two eyes side by side, a slot being at most that wide plus the 2 px gap (stride = slot + 2), so it is (slotW + 2) x 2 wide. It is made larger
  // only when a pass asks for a slot bigger than any before (the eye's size changed: not expected within a session); the old one goes through onTargetFreed first. Not part of the pool (the pool's limit never lets one of these go).
  const fixed = new Map();
  // exact = true (the periphery's target when the foveation setting changes): the target is made again at exactly this size, smaller or larger than the one before (otherwise it only ever grows).
  const fixedTarget = (name, slotW, slotH, exact = false) => {
    let t = fixed.get(name);
    if (t && (exact ? t.slotW === slotW && t.slotH === slotH : t.slotW >= slotW && t.slotH >= slotH)) return t;
    if (t && !exact) { slotW = Math.max(slotW, t.slotW); slotH = Math.max(slotH, t.slotH); }
    const W = upTo((slotW + 2) * 2, 64), H = upTo(slotH, 64);
    const mk = () => device.createTexture({ size: [W, H, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    const n = { w: W, h: H, slotW, slotH, color: mk(), depth: mk(), stamp: 0 };
    n.colorView = n.color.createView(); n.depthView = n.depth.createView();
    fixed.set(name, n); counts.target++;
    if (t) { onTargetFreed?.(t); t.color.destroy(); t.depth.destroy(); t.dead = true; }
    return n;
  };
  // a pass without a target (the periphery pass when the setting uses none): the old one goes through onTargetFreed first; a pass that asks again makes it again
  const dropTarget = name => { const t = fixed.get(name); if (!t) return; fixed.delete(name); onTargetFreed?.(t); t.color.destroy(); t.depth.destroy(); t.dead = true; };

  // ---- the uniforms ----
  const put = (fd, v, fArr = uF, iArr = uI) => {
    if (v === undefined || v === null) return;
    const at = fd.offset / 4, F = fd.k === 'f' ? fArr : iArr;
    if (fd.count) {
      for (let i = 0; i < fd.count; i++) { const it = v[i]; if (!it) continue; const b = at + i * fd.stride / 4; F[b] = it.x ?? it[0] ?? 0; F[b + 1] = it.y ?? it[1] ?? 0; if (fd.n > 2) { F[b + 2] = it.z ?? it[2] ?? 0; F[b + 3] = it.w ?? it[3] ?? 0; } }
    } else if (fd.n === 1) F[at] = +v;
    else if (fd.n === 16) { const m = v.elements || v; for (let i = 0; i < 16; i++) F[at + i] = m[i]; }
    else { F[at] = v.x ?? v[0] ?? 0; F[at + 1] = v.y ?? v[1] ?? 0; if (fd.n > 2) F[at + 2] = v.z ?? v[2] ?? 0; if (fd.n > 3) F[at + 3] = v.w ?? v[3] ?? 0; }
  };
  const fillUniforms = (u, extra) => {
    uF.fill(0);
    for (const fd of layout.fields) put(fd, fd.name in extra ? extra[fd.name] : u[fd.name]?.value);
  };
  const packUniforms = (u, extra, index) => {
    fillUniforms(u, extra);
    device.queue.writeBuffer(ubufOf(index), 0, uAb);
  };
  // the values of the uniforms every volume pass of the session gets besides the eye's matrices (the jump switch follows the diagnostics); `overrides` of a pass go over them.
  // useSkip is 0 for every pass of this renderer: the creep skip (the skipTex lookup) only omits reads that would find nothing (the contract of vr-skip-occupancy.js), so the image is the same either way,
  // and on the headset the lookup was measured to cost more than the reads it saves (the breakdown's creep pair). The host's own switch (u.useSkip: the bits describe the texture exactly) is kept apart as skipHostOn; the breakdown's withCreep pass uses it.
  const skipHostOn = u => ((u.diag?.value | 0) !== 4 && (u.useSkip?.value | 0) > 0) ? 1 : 0;
  const passExtra = u => ({ jumpOn: (u.distInCls?.value > 0 && u.useCls?.value > 0 && (u.diag?.value | 0) !== 4) ? 1 : 0, useSkip: 0 });

  // the bind group of the textures in use (rebuilt when one of them is another GPUTexture)
  const groups = new Map();
  const bindGroup = (index, u, pxTex = null) => { // pxTex = the pre-pass's tiles this pass reads (a pass without one gets the dummy)
    const tv = (t, kind) => (gpuOf(t) || dummy(kind));
    const tex = [tv(u.vol?.value, 'f'), tv(u.clsTex?.value, 'f'), tv(u.cls4Tex?.value, 'f'), tv(u.skipTex?.value, 'uint'), tv(u.editTex?.value, 'f'), tv(u.sliceVol?.value, 'f'), pxTex || proxyDummyTex()];
    const editNearest = u.editTex?.value?.minFilter === THREE.NearestFilter;
    const ids = tex.map(t => { if (!t.__id) t.__id = ++idSeq; return t.__id; }).join('.') + (editNearest ? 'n' : 'l') + ':' + index;
    let g = groups.get(ids)?.g;
    if (!g) {
      if (groups.size > 32) groups.clear();
      counts.group++;
      g = device.createBindGroup({ layout: bgl, entries: [
        { binding: VOLUME_BINDINGS.uniforms, resource: { buffer: ubufOf(index) } },
        ...[VOLUME_BINDINGS.vol, VOLUME_BINDINGS.cls, VOLUME_BINDINGS.cls4, VOLUME_BINDINGS.skip, VOLUME_BINDINGS.edit, VOLUME_BINDINGS.slice].map((binding, i) => ({ binding, resource: tex[i].createView({ dimension: '3d' }) })),
        { binding: VOLUME_BINDINGS.sampler, resource: linear }, { binding: VOLUME_BINDINGS.samplerEdit, resource: editNearest ? nearest : linear },
        { binding: VOLUME_BINDINGS.proxy, resource: tex[6].createView({ dimension: '2d' }) },
      ] });
      groups.set(ids, { g, ids: tex.map(t => t.__id) });
    }
    return g;
  };
  let idSeq = 0;
  // what a compute variant of the breakdown needs of a pass's bind group (the textures of the pass, the proxy tiles, the samplers), taken when the breakdown snapshots the low pass (vr-wgpu-cs.js builds its own bind groups from these)
  const resourcesOf = (u, pxTex) => ({ tex: [u.vol?.value, u.clsTex?.value, u.cls4Tex?.value, u.skipTex?.value, u.editTex?.value, u.sliceVol?.value].map((t, i) => gpuOf(t) || dummy(i === 3 ? 'uint' : 'f')).concat([pxTex || proxyDummyTex()]), editNearest: u.editTex?.value?.minFilter === THREE.NearestFilter, linear, nearest });
  // a GPUTexture that is destroyed is in no cached bind group any more
  const dropGroups = gpuTex => { const id = gpuTex?.__id; if (!id) return; for (const [k, v] of groups) if (v.ids.includes(id)) groups.delete(k); };

  // ---- the pre-pass: a compute pass in the low pass's command encoder, before its render pass: one cone per 8 x 8 pixel tile of the low pass -> the tile's tA (r32float), which the volume pass reads (proxyTex) ----
  // What tA means, and why a ray may start at it, is in docs/vr-wgsl-core.js (PROXY) and tests/unit/vr-wgsl-proxy.test.js. Everything here is made on first use (a session without a distance field never makes any of it).
  const pxLayout = uniformLayout(PROXY_FIELDS);
  const px = { bgl: null, layout: null, ubuf: null, ab: new ArrayBuffer(pxLayout.byteSize), pipes: new Map(), pool: [], inv: [new THREE.Matrix4(), new THREE.Matrix4()] };
  px.f = new Float32Array(px.ab); px.i = new Int32Array(px.ab);
  const pxLayouts = () => {
    px.bgl ||= device.createBindGroupLayout({ entries: [
      { binding: PROXY_BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: PROXY_BINDINGS.cls, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: PROXY_BINDINGS.cls4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: PROXY_BINDINGS.sampler, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: PROXY_BINDINGS.out, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float', viewDimension: '2d' } },
    ] });
    px.layout ||= device.createPipelineLayout({ bindGroupLayouts: [px.bgl] });
    return px;
  };
  const pxDesc = cls4 => {
    const module = device.createShaderModule({ code: proxyWgsl({ cls4 }) });
    try { onShader?.(module, { proxy: true, cls4 }); } catch { /* diagnostics only */ }
    return { layout: pxLayouts().layout, compute: { module, entryPoint: 'main' } };
  };
  const pxPipe = cls4 => { const k = cls4 ? 'pc4' : 'pc3'; let p = px.pipes.get(k); if (!p) { p = device.createComputePipeline(pxDesc(cls4)); px.pipes.set(k, p); } return p; }; // not warmed: compiles on the spot (a hitch, once)
  const warmProxy = async cls4 => { const k = cls4 ? 'pc4' : 'pc3'; if (!px.pipes.has(k)) { const p = await device.createComputePipelineAsync(pxDesc(cls4)); if (!px.pipes.has(k)) px.pipes.set(k, p); } };
  // the pass may use the pre-pass when: a display variant without section planes, the jumps are on (their validity of the distance field is the pre-pass's too: distInCls, useCls), the session's probe (diag 5) is not the pass, and the textures it reads are on the GPU
  const proxyUsable = (u, variant, base, overrides) => !variant.events && base.jumpOn === 1 && (u.planeCount?.value | 0) === 0 && (u.diag?.value | 0) !== 5 && (overrides?.diag | 0) !== 5
    && !!gpuOf(u.clsTex?.value) && (!variant.cls4 || !!gpuOf(u.cls4Tex?.value));
  // the tiles of both eyes side by side: (columns per eye x 2 eyes) x rows of the target's largest slot; the least recently used go first
  const pxTexture = (cols, rows) => {
    let t = px.pool.find(x => x.cols === cols && x.rows === rows);
    if (!t) {
      t = { cols, rows, gpu: device.createTexture({ size: [cols, rows, 1], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }), stamp: 0, frame: 0 }; counts.tex++;
      px.pool.push(t);
      while (px.pool.length > 6) { const old = px.pool.filter(x => x !== t && x.frame !== frameNo).sort((a, b) => a.stamp - b.stamp)[0]; if (!old) break; px.pool.splice(px.pool.indexOf(old), 1); dropGroups(old.gpu); old.gpu.destroy(); }
    }
    t.stamp = performance.now(); t.frame = frameNo;
    return t.gpu;
  };
  const pxGroup = (u, cls4, tex) => {
    const cls = gpuOf(u.clsTex.value), c4 = cls4 ? gpuOf(u.cls4Tex.value) : dummy('f');
    const ids = [cls, c4, tex].map(t => (t.__id ||= ++idSeq)), key = 'px:' + ids.join('.');
    let e = groups.get(key);
    if (!e) {
      if (groups.size > 32) groups.clear();
      counts.group++;
      e = { ids, g: device.createBindGroup({ layout: pxLayouts().bgl, entries: [
        { binding: PROXY_BINDINGS.params, resource: { buffer: px.ubuf } }, { binding: PROXY_BINDINGS.cls, resource: cls.createView({ dimension: '3d' }) }, { binding: PROXY_BINDINGS.cls4, resource: c4.createView({ dimension: '3d' }) },
        { binding: PROXY_BINDINGS.sampler, resource: linear }, { binding: PROXY_BINDINGS.out, resource: tex.createView() },
      ] }) };
      groups.set(key, e);
    }
    return e.g;
  };
  // encodes the compute pass for eyes (the low pass's, regions already in mvp): info = { tilesPerEye, tilesY }; returns the tiles' texture, or null (nothing encoded: a matrix that cannot be inverted)
  const encodeProxy = (enc, u, eyes, variant, info, tsw) => {
    const n = Math.min(2, eyes.length), cls4 = !!variant.cls4;
    for (let k = 0; k < n; k++) { const m = eyes[k].mvp, d = m.determinant(); if (!Number.isFinite(d) || Math.abs(d) < 1e-30) return null; px.inv[k].copy(m).invert(); if (!px.inv[k].elements.every(Number.isFinite)) return null; }
    const e0 = eyes[0], e1 = eyes[n - 1], W = e => e.vw ?? e.w, H = e => e.vh ?? e.h, segOn = [0, 1, 2, 3].map(s => ((u.segA?.value?.[s]?.w ?? u.segA?.value?.[s]?.[3] ?? 0) > 0.5 ? 1 : 0));
    const ex = { inv0: px.inv[0], inv1: px.inv[n - 1], org0: e0.origin, w0: W(e0), h0: H(e0), org1: e1.origin, w1: n > 1 ? W(e1) : 0, h1: n > 1 ? H(e1) : 0, nEyes: n, tilesPerEye: info.tilesPerEye, tilesY: info.tilesY, segOn };
    px.f.fill(0);
    for (const fd of pxLayout.fields) put(fd, fd.name in ex ? ex[fd.name] : u[fd.name]?.value, px.f, px.i);
    px.ubuf ||= device.createBuffer({ size: pxLayout.byteSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(px.ubuf, 0, px.ab);
    const tex = pxTexture(info.texCols ?? info.tilesPerEye * n, info.texRows ?? info.tilesY); // the tiles' texture is made once for the largest slot (texCols x texRows); a smaller slot uses its top-left part
    const pass = enc.beginComputePass(tsw ? { timestampWrites: tsw } : {});
    pass.setPipeline(pxPipe(cls4)); pass.setBindGroup(0, pxGroup(u, cls4, tex));
    pass.dispatchWorkgroups(Math.ceil(info.tilesPerEye * n / PROXY.tile), Math.ceil(info.tilesY / PROXY.tile));
    pass.end();
    return tex;
  };

  const pxSnapshot = () => px.ab.slice(0); // the pre-pass's uniform bytes of the low pass just drawn (the breakdown's coarse variants start from them)

  // the GPU time of the volume pass (timestamp-query, when the device has it): a few slots, each read back a frame or two later; takeGpuMs() = { ms, n } summed over the frames since the last call
  // The same slots give the frame's GPU timeline (performance record only): per XR frame the first volume pass's start and the end of a marker pass that markFrame() submits after the frame's last submit
  // (tiny render pass, no draw). span = marker end - first start; gap = first start - the previous frame's marker end (the GPU idle between two frames). All values are this device's own timestamps (one clock);
  // three.js' own timestamps (trackTimestamp) are durations only and are not placed on this clock. takeFrameStats() = { gaps, spans } in ms since the last call.
  // per frame up to 5 slots: the pre-pass (compute) of the centre, the low pass, the periphery's tiles (compute), the periphery pass, the marker. A slot is free again once its result has been mapped, which takes a frame or two (more when the GPU is behind);
  // a frame that finds no free slot is no sample (rec.bad) and its low pass is not timed. 30 = 6 frames of 5 slots, so the read-back may lag up to 5 frames behind before a frame loses its timestamps.
  // The query set (2 per slot) and the resolve buffer (256 bytes per slot, the offset a resolve needs) follow this number.
  const TS_SLOTS = 30;
  // E0: the page may ask for the volume timestamps on one XR frame in `every` (setTimerEvery; 1 = every frame, the default and what a recording uses). Which frames: the frame records with (id - 1) % every === 0,
  // decided once per frame record, so the pre-pass, the low pass and the periphery pass of a frame are all timed or all untimed (no slot, no resolve / copy, no mapAsync for an untimed frame). In a sampled frame
  // (every > 1) the frame enters sumMs / count as a whole (rec.atomic: when its last pass is read back, and only if every pass was timed and valid), so takeGpuMs = { ms, n } stays the mean per drawn frame, n = sampled frames.
  const timedFrame = () => !!ts && (ts.every <= 1 || (ts.cur.id - 1) % ts.every === 0);
  const ts = device.features.has('timestamp-query') ? {
    qs: device.createQuerySet({ type: 'timestamp', count: 2 * TS_SLOTS }), resolve: device.createBuffer({ size: 256 * TS_SLOTS, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    slots: Array.from({ length: TS_SLOTS }, () => ({ buf: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false })), sumMs: 0, count: 0,
    markTex: device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    seq: 0, cur: null, q: [], prev: null, gaps: [], spans: [], every: 1,
  } : null;
  // Measurement of the timestamp path itself (performance.now() and numbers in a fixed object only; read by the page once a frame with takeGauges, which also clears them):
  // ml = the longest mapAsync (call -> resolved) among the read-backs that completed since the last take; gd = for the frame whose volume passes were all read back: (GPU start of its first volume pass - the previous measured
  // frame's) - (CPU time of its first submit - the previous measured frame's), in ms; vol = that frame's volume GPU ms. NaN = none since the last take.
  const gauge = { ml: NaN, gd: NaN, vol: NaN }, gdPrev = { b: null, sub: 0 };
  // called from readSlot once the last volume pass of the frame has been read back AND its start is in rec.b
  const frameGd = rec => {
    if (rec.bad || rec.b === null || rec.sub === null) { gdPrev.b = null; return; } // a frame with a pass that was not timed: no start to compare
    if (gdPrev.b !== null) { const g = Number(rec.b - gdPrev.b) / 1e6 - (rec.sub - gdPrev.sub); if (Number.isFinite(g) && g > -1e4 && g < 1e4) gauge.gd = g; }
    gdPrev.b = rec.b; gdPrev.sub = rec.sub;
  };
  const takeGauges = out => { out.ml = gauge.ml; out.gd = gauge.gd; out.vol = gauge.vol; gauge.ml = gauge.gd = gauge.vol = NaN; return out; };
  const newRec = () => ({ id: ++ts.seq, pend: 0, sub: null, vols: 0, b: null, e: null, bad: false, closed: false, vpend: 0, vms: 0, vbad: false, vcb: null, lowMs: null, pairs: null, shadowed: false, atomic: false, hadLow: false, preMs: null }); // one XR frame: b = first start, e = last end (BigInt ticks, ns), pend = readbacks still to come
  if (ts) ts.cur = newRec();
  // the frames whose readbacks are all in, oldest first: a frame with every timestamp valid gives its span; its gap needs the frame before it to be valid too
  const finishFrames = () => {
    while (ts.q.length && ts.q[0].closed && ts.q[0].pend === 0) {
      const r = ts.q.shift();
      if (r.bad || r.vols === 0 || r.b === null || r.e === null || r.e < r.b) { ts.prev = null; continue; }
      const span = Number(r.e - r.b) / 1e6;
      if (!(span < 1000)) { ts.prev = null; continue; }
      ts.spans.push(span);
      if (ts.prev && ts.prev.id === r.id - 1 && !ts.prev.shadowed) { const g = Number(r.b - ts.prev.e) / 1e6; if (g > -5 && g < 1000) ts.gaps.push(g); }
      ts.prev = r;
    }
  };
  // read one slot back: rec = the frame it belongs to; marker = its end only counts (the begin of the marker is not work); onMs(ms) = the pass duration
  const readSlot = (slot, rec, marker, onMs) => {
    const sl = ts.slots[slot]; counts.maps++; // maps = timestamp read-backs started (a running total, read by the frame ring of docs/vr-bench.js)
    const m0 = performance.now(); // ml: the time from the mapAsync call to its resolution
    sl.buf.mapAsync(GPUMapMode.READ).then(() => {
      { const ml = performance.now() - m0; if (!(ml <= gauge.ml)) gauge.ml = ml; }
      const a = new BigUint64Array(sl.buf.getMappedRange().slice(0)); sl.buf.unmap();
      onMs?.(Number(a[1] - a[0]) / 1e6);
      if (a[0] === 0n || a[1] < a[0]) rec.bad = true;
      else { if (!marker && (rec.b === null || a[0] < rec.b)) rec.b = a[0]; if (rec.e === null || a[1] > rec.e) rec.e = a[1]; }
      if (!marker && rec.vpend === 0 && !rec.gdDone) { rec.gdDone = true; frameGd(rec); }
      rec.pend--; sl.busy = false; finishFrames();
    }).catch(() => { rec.bad = true; gdPrev.b = null; rec.pend--; sl.busy = false; finishFrames(); });
  };
  // the volume passes of one XR frame have all been read back (performance record only): volDone is called per pass; the callback of onFrameVolMs gets the frame's volume GPU ms (the sum of its passes, as the vol column)
  const volDone = rec => {
    if (--rec.vpend > 0) return;
    if (!rec.vbad) gauge.vol = rec.vms;
    if (rec.atomic && !rec.vbad && rec.hadLow) { ts.sumMs += rec.vms; ts.count++; } // a sampled frame (every > 1): the whole frame, once all its passes are back
    if (!rec.vcb) return; const cb = rec.vcb; rec.vcb = null; if (!rec.vbad) cb(rec.vms);
  };
  // cb(ms) once the volume passes drawn so far in the CURRENT frame (call after draw(), before markFrame()) have been read back; never called without a timer, when a pass was not timed or a read-back failed
  const onFrameVolMs = cb => { if (!ts || !ts.cur || ts.cur.vpend === 0 || ts.cur.bad) return; ts.cur.vcb = cb; };
  // n = 1: the volume timestamps of every frame (the default, and what a recording asks for); n > 1: of one frame in n (E0 + E1). The page sets it before the frame's draw (a recording: 1, else TS_SAMPLE_EVERY).
  const setTimerEvery = n => { if (ts) ts.every = Math.max(1, Math.floor(n) || 1); };
  const takeGpuMs = () => { if (!ts || !ts.count) return null; const r = { ms: ts.sumMs, n: ts.count }; ts.sumMs = 0; ts.count = 0; return r; };
  const takeFrameStats = () => { if (!ts || !(ts.spans.length || ts.gaps.length)) return null; const r = { gaps: ts.gaps, spans: ts.spans }; ts.gaps = []; ts.spans = []; return r; };
  // the end of this XR frame's GPU work (call after the frame's last submit, three.js' main render included): closes the frame record with a marker pass. No volume pass in the frame (nothing drawn) = no sample.
  // record = false (the page is not recording the breakdown): no marker pass, no resolve / copy / read-back for the frame's timeline; only the frame record is rotated (the volume passes' own slots and takeGpuMs / onFrameVolMs are not touched), returns null
  const markFrame = (record = true) => {
    if (!ts) return null;
    if (!record) { ts.cur = newRec(); ts.prev = null; return null; }
    const rec = ts.cur; ts.cur = newRec();
    ts.q.push(rec); if (ts.q.length > 16) { ts.q.shift(); ts.prev = null; }
    const slot = rec.vols > 0 ? ts.slots.findIndex(x => !x.busy) : -1;
    if (slot < 0) { if (rec.vols > 0) rec.bad = true; rec.closed = true; finishFrames(); return rec; }
    const enc = device.createCommandEncoder();
    enc.beginRenderPass({ timestampWrites: { querySet: ts.qs, beginningOfPassWriteIndex: 2 * slot, endOfPassWriteIndex: 2 * slot + 1 }, colorAttachments: [{ view: ts.markTex.createView(), loadOp: 'clear', storeOp: 'discard', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] }).end();
    enc.resolveQuerySet(ts.qs, 2 * slot, 2, ts.resolve, 256 * slot); enc.copyBufferToBuffer(ts.resolve, 256 * slot, ts.slots[slot].buf, 0, 16);
    ts.slots[slot].busy = true; rec.pend++; rec.closed = true;
    device.queue.submit([enc.finish()]);
    readSlot(slot, rec, true, null);
    return rec; // the record this call closed (the breakdown's shadow pass is paired with it)
  };
  // ---- the new ways of the centre pass: what a frame hands the instance (docs/vr-wgpu-newpath.js plan) ----
  const vget = (v, k) => (v === undefined || v === null ? 0 : (v['xyzw'[k]] ?? v[k] ?? 0));
  const cpuBusy = new WeakSet(); // textures whose CPU bytes run ahead of the GPU's right now (the page marks the combined texture while its rebuild is being uploaded: docs/vr-combo-rebuild.js writes the alpha into the bytes before the slab goes up)
  const markCpuBusy = (tex, on) => { if (!tex || typeof tex !== 'object') return; if (on) cpuBusy.add(tex); else cpuBusy.delete(tex); };
  const clsInfoOf = tex => { const e = tex && gpuOf(tex) ? entries.get(tex) : null; return e ? { tex, gen: e.gen | 0, dims: [e.w, e.h, e.d], data: tex.image?.data, gpu: e.gpu, format: e.format, untrusted: !!(e.cpuOff || cpuBusy.has(tex)) } : null; };
  const px4ab = new ArrayBuffer(pxLayout.byteSize), px4f = new Float32Array(px4ab), px4i = new Int32Array(px4ab);
  // the pre-pass parameters of this pass for the 4 x 4 tiles (the bytes encodeProxy would have packed, with this tile layout); null: a matrix that cannot be inverted
  const proxyBytes4 = (u, eyes, t4) => {
    const n = Math.min(2, eyes.length);
    for (let k = 0; k < n; k++) { const m = eyes[k].mvp, d = m.determinant(); if (!Number.isFinite(d) || Math.abs(d) < 1e-30) return null; px.inv[k].copy(m).invert(); if (!px.inv[k].elements.every(Number.isFinite)) return null; }
    const e0 = eyes[0], e1 = eyes[n - 1], W = e => e.vw ?? e.w, H = e => e.vh ?? e.h, segOn = [0, 1, 2, 3].map(s => ((u.segA?.value?.[s]?.w ?? u.segA?.value?.[s]?.[3] ?? 0) > 0.5 ? 1 : 0));
    const ex = { inv0: px.inv[0], inv1: px.inv[n - 1], org0: e0.origin, w0: W(e0), h0: H(e0), org1: e1.origin, w1: n > 1 ? W(e1) : 0, h1: n > 1 ? H(e1) : 0, nEyes: n, tilesPerEye: t4.tilesPerEye, tilesY: t4.tilesY, segOn };
    px4f.fill(0);
    for (const fd of pxLayout.fields) put(fd, fd.name in ex ? ex[fd.name] : u[fd.name]?.value, px4f, px4i);
    return new Uint8Array(px4ab);
  };
  const matrixOkOf = eyes => {
    const n = Math.min(2, eyes.length);
    for (let k = 0; k < n; k++) { const m = eyes[k].mvp, d = m.determinant(); if (!Number.isFinite(d) || Math.abs(d) < 1e-30) return false; px.inv[k].copy(m).invert(); if (!px.inv[k].elements.every(Number.isFinite)) return false; }
    return true;
  };
  // np.auto (the display): the frame's way is chosen here (docs/vr-wgpu-newpath.js chooseWay) from what the pass is and what the frame holds; np.mode (the check) names the way itself
  const planNewPath = (enc, np, u, variant, eyes, pinfo, tsw, base = null, overrides = null) => {
    const cls4 = !!variant.cls4, he = u.halfExt?.value, cc = u.clsChan?.value, t4 = pinfo?.tile4;
    const cls = clsInfoOf(u.clsTex?.value), c4i = cls4 ? clsInfoOf(u.cls4Tex?.value) : null;
    const auto = np.auto ? { way: chooseWay({ pass: np.pass || 'low', jumpOn: base?.jumpOn === 1, section: !!variant.events || (u.planeCount?.value | 0) !== 0, diag: (overrides?.diag ?? u.diag?.value) | 0,
      distField: (u.distInCls?.value > 0 && u.useCls?.value > 0), walkOk: walkLimitOk([vget(he, 0), vget(he, 1), vget(he, 2)], +u.stepSize?.value), matrixOk: matrixOkOf(eyes), gridReady: true }),
      slot: np.pass === 'peri' ? 'peri' : 'low' } : null;
    const frame = { mode: np.mode, skip: np.skip || '', cls4, halfExt: [vget(he, 0), vget(he, 1), vget(he, 2)], stepSize: +u.stepSize?.value, cls, c4: c4i && { gen: c4i.gen, gpu: c4i.gpu },
      segOn: [0, 1, 2, 3].map(s => ((u.segA?.value?.[s]?.w ?? u.segA?.value?.[s]?.[3] ?? 0) > 0.5 ? 1 : 0)), clsChan: [0, 1, 2, 3].map(k => vget(cc, k) | 0),
      proxyBytes: () => proxyBytes4(u, eyes, t4), tiles: t4 ? { nEyes: Math.min(2, eyes.length), tilesPerEye: t4.tilesPerEye, tilesY: t4.tilesY, texCols: t4.texCols, texRows: t4.texRows } : null, tswTiles: tsw, tswBuild: np.buildTsw || null, frame: frameNo, ...(auto || {}) };
    return auto ? np.inst.planWay(enc, frame) : np.inst.plan(enc, frame);
  };
  // why a frame that asked for a new way could not even try (the pre-pass is not usable in it)
  const npReasonOf = (u, variant, base, overrides, o) => (o.np.skip ? o.np.skip : !o.proxy ? 'noproxy' : variant.events || (u.planeCount?.value | 0) !== 0 ? 'section' : base.jumpOn !== 1 ? 'nojump' : (u.diag?.value | 0) === 5 || (overrides?.diag | 0) === 5 ? 'probe' : 'textures');
  // one render pass into a target: every eye's viewport (vx, vy, vw, vh in target px; x, y, w, h when absent) with its own uniforms, drawn once per scissor rect (e.scissors, else x, y, w, h).
  // eyes[i] = { x, y, w, h, vx, vy, vw, vh, scissors, mvp, origin, lightOff }; variant = { cls4, events }; overrides = uniform values that replace the session's (a diagnostic pass).
  // o (optional, the performance record's breakdown only): timed = whether the pass takes a timestamp slot of the frame record (default: not when it has overrides, as before),
  // pipeline = a pipeline of its own, tsw = timestampWrites of its own, group1 = a second bind group, before(enc) / after(enc) = commands encoded before / after the pass,
  // proxy = { tilesPerEye, tilesY }: the pre-pass runs first (its compute pass has a timestamp slot of its own; its ms is in the vol numbers, not in rec.lowMs) when the pass may use it (proxyUsable).
  // Returns { proxy: { tex } | null }: the tiles the pass read (the breakdown's snapshot carries them to its shadow passes).
  const drawPassInner = (target, eyes, u, variant, slot0, overrides = null, readback = null, o = null) => {
    const timed = (o?.timed ?? !overrides) && GX_SWITCH.timers; // GX_SWITCH.timers = false (an isolation run of the comparison bench): no timestamp slot, no read-back
    const stamped = timed && timedFrame(); // E0: a frame the page does not sample (setTimerEvery) takes no timestamp slot at all (and is no `bad` frame)
    const enc = device.createCommandEncoder();
    const slot = ts && stamped ? ts.slots.findIndex(x => !x.busy) : -1; // the probe (overrides) and a pass with no free slot are not timed
    const rec = ts && stamped ? ts.cur : null; // the frame this pass belongs to (a pass that is not timed makes the frame's span / gap unusable)
    const sampled = !!rec && ts.every > 1; // a sampled frame enters the vol numbers as a whole (volDone)
    if (rec && sampled) rec.atomic = true;
    if (rec && slot < 0) { rec.bad = true; if (sampled) rec.vbad = true; }
    const base = passExtra(u);
    let pxTex = null, slotC = -1, npd = null; // npd: this frame's decision of a new way of the centre pass (o.np: the display's switch, or the same-picture check); null = none asked: everything below is the old way
    const autoNp = o?.np?.auto ? o.np : null; // the display's pass: a way is chosen for every frame (docs/vr-wgpu-newpath.js chooseWay), also where the pre-pass cannot be used (D0, the probe, the periphery)
    const pu = !!o?.proxy && proxyUsable(u, variant, base, overrides);
    if (pu || autoNp) {
      slotC = ts && stamped ? ts.slots.findIndex((x, i) => !x.busy && i !== slot) : -1;
      if (rec && slotC < 0) { rec.bad = true; if (sampled) rec.vbad = true; }
      const tswC = o.proxyTsw ?? (slotC >= 0 ? { querySet: ts.qs, beginningOfPassWriteIndex: 2 * slotC, endOfPassWriteIndex: 2 * slotC + 1 } : null);
      if (o.np) npd = planNewPath(enc, o.np, u, variant, eyes, o.proxy, tswC, base, overrides);
      pxTex = npd?.pxTex ?? (npd?.use && npd.noTiles ? null : pu && !(autoNp && autoNp.pass !== 'low') ? encodeProxy(enc, u, eyes, variant, o.proxy, tswC) : null); // D0 (use, noTiles): no pre-pass at all; the periphery drawn the old way keeps its old form (no pre-pass)
      if (!pxTex) slotC = -1;
      else if (slotC >= 0) { enc.resolveQuerySet(ts.qs, 2 * slotC, 2, ts.resolve, 256 * slotC); enc.copyBufferToBuffer(ts.resolve, 256 * slotC, ts.slots[slotC].buf, 0, 16); ts.slots[slotC].busy = true; rec.pend++; rec.vpend++; }
    }
    if (!pxTex && o?.pxTex) pxTex = o.pxTex; // the counting probe: the display's own tiles of the frame (no compute pass of its own); proxyOn is 1 then, an override of 0 leaves them to the counting twin to read tA
    o?.before?.(enc);
    const tsw = o?.tsw ?? (slot >= 0 ? { querySet: ts.qs, beginningOfPassWriteIndex: 2 * slot, endOfPassWriteIndex: 2 * slot + 1 } : null);
    const pass = enc.beginRenderPass({ ...(tsw ? { timestampWrites: tsw } : {}), colorAttachments: [
      { view: target.colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: target.depthView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    ] });
    // the display's pass (auto) draws with its way's program or not at all (noWay: nothing a way can draw is ready: the pass is cleared, the reason is counted and, if it lasts, the session is ended); every other pass (the check's and the breakdown's own) draws the display's own program
    const noWay = !!autoNp && !npd?.use;
    if (!noWay) pass.setPipeline(o?.pipeline ?? (npd?.use ? npd.pipeline : null) ?? pipeFor(variant));
    pass.setVertexBuffer(0, boxBuf);
    if (o?.group1) pass.setBindGroup(1, o.group1); else if (npd?.use && npd.group1) pass.setBindGroup(1, npd.group1);
    if (noWay) eyes.forEach(e => { pass.setViewport(e.vx ?? e.x, e.vy ?? e.y, e.vw ?? e.w, e.vh ?? e.h, 0, 1); for (const sc of e.scissors || [[e.x, e.y, e.w, e.h]]) pass.setScissorRect(sc[0], sc[1], sc[2], sc[3]); }); // (nothing is drawn: the region is still set, so the pass is the same cleared image)
    else eyes.forEach((e, i) => {
      packUniforms(u, { mvp: e.mvp, origin: e.origin, lightOff: e.lightOff, ...base, proxyOn: pxTex ? 1 : 0, proxyOrg: pxTex ? (npd?.pxTex ? e.pxOrg4 : e.pxOrg) : [0, 0], ...overrides }, slot0 + i);
      pass.setBindGroup(0, bindGroup(slot0 + i, u, pxTex));
      pass.setViewport(e.vx ?? e.x, e.vy ?? e.y, e.vw ?? e.w, e.vh ?? e.h, 0, 1);
      for (const sc of e.scissors || [[e.x, e.y, e.w, e.h]]) { pass.setScissorRect(sc[0], sc[1], sc[2], sc[3]); pass.draw(36); } // e.scissors: several rects (the periphery's bands), each inside the target
    });
    pass.end();
    if (readback) enc.copyTextureToBuffer({ texture: target.color }, { buffer: readback.buffer, bytesPerRow: readback.bytesPerRow }, [readback.w, readback.h, 1]);
    o?.after?.(enc);
    if (slot >= 0) { enc.resolveQuerySet(ts.qs, 2 * slot, 2, ts.resolve, 256 * slot); enc.copyBufferToBuffer(ts.resolve, 256 * slot, ts.slots[slot].buf, 0, 16); ts.slots[slot].busy = true; rec.pend++; rec.vols++; rec.vpend++; } // (a query resolve lands on a 256-byte offset)
    device.queue.submit([enc.finish()]);
    if (autoNp) { const pn = autoNp.pass || 'low'; if (npd?.use) noWayRun[pn] = 0; else noteNoWay(pn, npd?.reason || 'unknown'); }
    if (rec && rec.sub === null) rec.sub = performance.now(); // the CPU time of the frame's first timed submit (gd above)
    if (slotC >= 0) readSlot(slotC, rec, false, ms => { if (ms >= 0 && ms < 1000) { if (!rec.atomic) ts.sumMs += ms; rec.vms += ms; if (slot0 === 0) { rec.preMs = ms; try { bd?.onShadow?.('proxyMs', ms, 1); } catch { /* the page's callback */ } } } else rec.vbad = true; volDone(rec); });
    if (slot >= 0) {
      const isLow = slot0 === 0;
      readSlot(slot, rec, false, ms => { if (ms >= 0 && ms < 1000) { if (!rec.atomic) ts.sumMs += ms; rec.vms += ms; if (isLow) { if (!rec.atomic) ts.count++; rec.hadLow = true; rec.lowMs = ms; lowDone(rec); } } else { rec.vbad = true; if (isLow) { rec.lowMs = -1; lowDone(rec); } } volDone(rec); });
    }
    let npr = null; // what the new way did this frame (the check and the display's counts read it)
    if (npd) npr = { use: !!npd.use, reason: npd.reason || '', mode: npd.mode, way: npd.way || '', group1: npd.use ? npd.group1 || null : null, tiles4: !!(npd.use && npd.pxTex) };
    else if (o?.np) { const reason = npReasonOf(u, variant, base, overrides, o); o.np.inst.count(reason, o.np.mode); npr = { use: false, reason, mode: o.np.mode }; } // the frame cannot use the pre-pass at all (sections, no jumps, the probe, ...): the old way, counted
    return { proxy: pxTex ? { tex: pxTex } : null, np: npr };
  };
  // the display's own pass (o.np.auto) runs inside a validation and an out-of-memory error scope (8-1): an error of its commands is its own, counted against the frame it was recorded in (the answer comes a frame or two later), and the scopes are closed whatever happens inside
  const drawPass = (target, eyes, u, variant, slot0, overrides = null, readback = null, o = null) => {
    if (!(o?.np?.auto && typeof device.pushErrorScope === 'function')) return drawPassInner(target, eyes, u, variant, slot0, overrides, readback, o);
    const frame = frameNo; device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
    try { return drawPassInner(target, eyes, u, variant, slot0, overrides, readback, o); } finally {
      Promise.all([device.popErrorScope(), device.popErrorScope()]).then(([oom, val]) => { const e = oom || val; if (e) noteOwnError(String(e.message ?? e).slice(0, 160) || 'GPU error', frame); }, () => {});
    }
  };

  // ---- the volume breakdown (performance record only; nothing here exists until beginBreakdown, the button of the detail tab) ----
  // Method A, shadow passes: after a frame's marker pass (markFrame) one more pass draws the frame's low pass again, the same eyes, regions and scissors, with the eye uniforms the low pass had, into scratch targets that
  // are never shown; its variant takes a step out (abl: another program text; overrides: another uniform value). Its GPU ms comes from a query set of its own and is paired with the same frame's low pass ms (rec.lowMs):
  // the callback gets (name, shadowMs, lowMs). The shadow ms is not added to sumMs / rec.vms / rec.vols / rec.vpend (the vol column and the frame's span are the session's own). The frame after a shadow pass has no gap sample.
  // Method B, the counting probe: a 64 x 64 pass of the counting variant (counters) writes COUNTER_FIELDS.length u32 per pixel into a storage buffer that is read back, one probe at a time (probeCounters).
  const BD_SLOTS = 4, BD_PROBE = 64, BD_PROBE_BYTES = BD_PROBE * BD_PROBE * COUNTER_FIELDS.length * 4;
  let bd = null;
  const finPair = p => {
    if (p.done || p.shadow === null || p.low === null) return;
    p.done = true;
    if (p.shadow >= 0 && p.low > 0) { try { p.cb?.(p.name, p.shadow, p.low); } catch { /* the page's callback */ } }
  };
  const lowDone = rec => { if (!rec.pairs) return; for (const p of rec.pairs) { p.low = rec.lowMs; finPair(p); } };
  // variant = the display variant in use ({cls4, events}): the abl variants and the counting variant of it are compiled now (async). Resolves { shadow, probe, failed: [text, ...] }; a variant that fails to compile is left out and listed.
  const beginBreakdown = async (variant, onShadow) => {
    endBreakdown();
    const b = bd = { variant: { cls4: !!variant.cls4, events: !!variant.events }, onShadow, pipes: new Map(), snap: { rec: null, target: null, variant: null, px: null, eyes: [], ab: [new Int32Array(layout.byteSize / 4), new Int32Array(layout.byteSize / 4)], bg: [null, null], bgOn: [null, null] }, tgt: null, tgt2: null, diff: null, shadowOk: !!ts, probeOk: false, probe: null, qs: null, resolve: null, slots: [], tmp: new Int32Array(layout.byteSize / 4), failed: [] };
    specs.replay((name, a, c) => onShadow?.(name, a, c)); // A4: the specialised pipelines made before this recording (their build ms and failures)
    if (ts) {
      b.qs = device.createQuerySet({ type: 'timestamp', count: 2 * BD_SLOTS });
      b.resolve = device.createBuffer({ size: 256 * BD_SLOTS, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      b.slots = Array.from({ length: BD_SLOTS }, () => ({ buf: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false }));
    }
    const jobs = ABLATIONS.map(abl => ({ v: { ...b.variant, abl }, what: 'abl ' + abl })).concat([{ v: { ...b.variant, counters: true }, what: 'counters' }]);
    if (!b.variant.events) for (const kind of Object.keys(MARCH_VARIANTS)) jobs.push({ v: { ...b.variant, march: kind }, what: 'march ' + kind }); // distSplit / march2 (vr-wgpu-coarse-march.js): the display variant's text with the march's reads changed; none for a variant with section planes
    await Promise.all(jobs.map(async j => {
      try { const p = await device.createRenderPipelineAsync(pipeDesc(j.v)); if (bd === b) b.pipes.set(vkey(j.v), p); }
      catch (e) { b.failed.push(j.what + ': ' + String(e?.message ?? e).slice(0, 160)); }
    }));
    if (ts) { // the pixel comparison's compute (every variant with diff in the table of vr-perf-log.js: the noProxy turn of a session whose low pass uses the pre-pass, and the new ones); a failure is listed and the turn then runs without the comparison
      try {
        const module = device.createShaderModule({ code: proxyDiffWgsl() }); try { onShader?.(module, { proxyDiff: true }); } catch { /* diagnostics only */ }
        const bgl = device.createBindGroupLayout({ entries: [
          ...[PROXY_DIFF_BINDINGS.colorA, PROXY_DIFF_BINDINGS.depthA, PROXY_DIFF_BINDINGS.colorB, PROXY_DIFF_BINDINGS.depthB].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } })),
          { binding: PROXY_DIFF_BINDINGS.count, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ] });
        const pipe = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module, entryPoint: 'main' } });
        if (bd === b) b.diff = { pipe, bgl, group: null, gA: null, gB: null, busy: false, cnt: device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }), rb: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) }; // 4 u32: pixels that differ, largest colour channel difference, largest packed depth byte difference, pixels whose colour differs
      } catch (e) { b.failed.push('proxy diff: ' + String(e?.message ?? e).slice(0, 160)); }
    }
    if (bd !== b) return null; // ended while compiling
    if (b.pipes.has(vkey({ ...b.variant, counters: true }))) {
      const mk = () => device.createTexture({ size: [BD_PROBE, BD_PROBE, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      const t = { w: BD_PROBE, h: BD_PROBE, color: mk(), depth: mk() }; t.colorView = t.color.createView(); t.depthView = t.depth.createView();
      const cfg = device.createBuffer({ size: COUNTER_CFG_BINDING.floats * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const run = () => { const cnt = device.createBuffer({ size: BD_PROBE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }); return { cnt, rb: device.createBuffer({ size: BD_PROBE_BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
        group: device.createBindGroup({ layout: cntLayouts().bglCnt, entries: [{ binding: 0, resource: { buffer: cnt } }, { binding: COUNTER_CFG_BINDING.binding, resource: { buffer: cfg } }] }) }; };
      const r1 = run(), r2 = run(); // r1 = the run without the pre-pass (the probe's result), r2 = the run with the display's tiles (delivered through onShadow); each its own buffers: the second is submitted before the first is read
      b.probe = { target: t, cnt: r1.cnt, rb: r1.rb, group: r1.group, run2: r2, cfg, busy: false };
      b.probeOk = true;
    }
    return { shadow: b.shadowOk && ABLATIONS.every(a => b.pipes.has(vkey({ ...b.variant, abl: a }))), probe: b.probeOk, failed: b.failed.slice() };
  };
  function endBreakdown() {
    const b = bd; if (!b) return; bd = null;
    const kill = x => { try { x?.destroy(); } catch { /* gone */ } };
    try { coarse.end(); } catch { /* gone */ }
    try { b.cs?.dispose(); } catch { /* gone */ }
    kill(b.qs); kill(b.resolve); b.slots.forEach(x => kill(x.buf)); kill(b.tgt?.color); kill(b.tgt?.depth); kill(b.tgt2?.color); kill(b.tgt2?.depth); kill(b.diff?.cnt); kill(b.diff?.rb);
    if (b.probe) { kill(b.probe.target.color); kill(b.probe.target.depth); kill(b.probe.cnt); kill(b.probe.rb); kill(b.probe.run2.cnt); kill(b.probe.run2.rb); kill(b.probe.cfg); }
    for (const i of [4, 5, 6, 7, 8]) { kill(ubufs[i]); ubufs[i] = undefined; for (const k of [...groups.keys()]) if (k.endsWith(':' + i)) groups.delete(k); } // the bind groups made on those buffers go with them (a second recording must not bind a destroyed buffer)
    ubufs.length = Math.min(ubufs.length, 4);
    mx.destroy();
    bglCnt = null; pipeLayoutCnt = null; // (layouts and pipelines have no destroy: they are let go for the garbage collector)
  }
  // the coarse-grid variants of the shadow pass (docs/vr-wgpu-coarse-proxy.js): what they borrow of this renderer
  const pairShadow = (rec, name, slot) => { // a shadow pass of a variant made elsewhere: its ms is paired with the same frame's low pass ms, as shadowPass does
    rec.shadowed = true;
    const p = { name, shadow: null, low: rec.lowMs, done: false, cb: bd?.onShadow };
    (rec.pairs ||= []).push(p);
    slot.buf.mapAsync(GPUMapMode.READ).then(() => {
      const a = new BigUint64Array(slot.buf.getMappedRange().slice(0)); slot.buf.unmap(); slot.busy = false;
      const ms = Number(a[1] - a[0]) / 1e6;
      p.shadow = a[0] !== 0n && a[1] >= a[0] && ms < 1000 ? ms : -1;
      finPair(p);
    }).catch(() => { slot.busy = false; p.shadow = -1; finPair(p); });
    if (p.low !== null) finPair(p);
  };
  const coarse = createCoarseProxy({
    device, f16, layout, getBd: () => bd, ubufOf, bindGroup, dummy, gpuOf, dropGroups, linear, boxBuf, onShader, pair: pairShadow,
    pipeDescFor: module => ({ layout: pipeLayout, vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' } }),
    displayPipe: v => pipes.get(vkey(v)), uploadGen: () => uploadGen,
  });
  const bdActive = () => !!bd;
  // P7: while the breakdown records, the display draws its own way; the shadow passes and the native-pitch probe are the old way's and read the display's own 8 x 8 pre-pass tiles. This makes them in an encoder of its own (the recording's, not the display's frame):
  // the pre-pass of the frame's low pass when it already is the 8 x 8 one (the way D), else a compute pass of the old pre-pass over the same eyes. null = the old way would not have used the pre-pass in this frame (no jumps, sections, the probe, ...).
  const bdTiles = (u, eyes, variant, pinfo, lowDraw) => {
    if (lowDraw?.np?.use && lowDraw.proxy && !lowDraw.np.tiles4) return lowDraw.proxy;
    if (!pinfo || !proxyUsable(u, variant, passExtra(u), null)) return null;
    const enc = device.createCommandEncoder(), tex = encodeProxy(enc, u, eyes, variant, pinfo, null);
    if (!tex) return null;
    device.queue.submit([enc.finish()]);
    return { tex };
  };
  // after the low pass of the frame (same frame, before markFrame): what the shadow pass needs of it (geometry, the packed uniforms of each eye as the low pass had them, the textures' bind groups)
  // px = what drawPass returned as proxy ({ tex }) when the low pass used the pre-pass, else null: the shadow passes then run with the same proxyOn / proxyOrg / tiles as the low pass had (without them every shadow pass would run with the pre-pass off)
  const bdSnapshot = (target, eyes, u, variant, px = null) => {
    const b = bd; if (!b || !ts) return;
    const s = b.snap, base = passExtra(u);
    s.rec = ts.cur; s.target = target; s.variant = variant; s.px = px; s.eyes.length = 0; s.skipHostOn = skipHostOn(u); s.clsTex = u.clsTex?.value ?? null; // clsTex: what the march variants' grids are made from
    s.res = resourcesOf(u, px?.tex ?? null); // res: what the compute variants bind (vr-wgpu-cs.js)
    s.u = u; s.pxAb = px ? pxSnapshot() : null; // for the coarse variants (docs/vr-wgpu-coarse-proxy.js)
    eyes.forEach((e, i) => {
      if (i > 1) return;
      s.eyes.push({ x: e.x, y: e.y, w: e.w, h: e.h, vx: e.vx ?? e.x, vy: e.vy ?? e.y, vw: e.vw ?? e.w, vh: e.vh ?? e.h, scissors: (e.scissors || [[e.x, e.y, e.w, e.h]]).map(c => c.slice()) });
      fillUniforms(u, { mvp: e.mvp, origin: e.origin, lightOff: e.lightOff, ...base, proxyOn: px ? 1 : 0, proxyOrg: px ? e.pxOrg : [0, 0] });
      s.ab[i].set(uI); s.bg[i] = bindGroup(4 + i, u, px?.tex);
      s.bgOn[i] = bindGroup(7 + i, u, px?.tex); // the display's own copy of the frame's uniforms (the reference of a comparison: its own uniform buffer, a write goes before the whole submit, so two draws of one submit never share a buffer)
    });
  };
  // one shadow pass for the record closed by markFrame; spec = a BD_SPECS entry ({ name, abl, overrides, proxy, diff }, docs/vr-perf-log.js defineBdVariant); a variant with a function registered by registerShadowEncoder(name, fn) draws itself (see there).
  // spec.diff (or proxy): the display's own pass is drawn too (display program, the snapshot's own uniforms and tiles) into the second scratch target and a compute counts the pixels that differ from the variant's target: delivered as ('diff:<name>', pixels, compared), ('diffMax:<name>', max colour channel diff, max packed depth byte diff), ('diffColor:<name>', pixels whose colour differs, 1); noProxy's count keeps the name 'proxyDiff'.
  // (The rest of this comment is the one it had.) true = submitted; false = not now (no timer slot free, no snapshot of this frame: try again later);
  // null = this variant has no program for the display variant in use (its compile failed, or the display variant changed since the recording began: it will not come back, the caller steps past it)
  const shadowPass = (rec, spec) => {
    if (spec.coarse) return coarse.shadow(rec, spec); // the coarse-grid pre-pass variants (docs/vr-wgpu-coarse-proxy.js)
    if (spec.spec) return specShadowPass(rec, spec); // 'specCfg' (A4)
    const b = bd, s = b?.snap;
    if (!b || !b.shadowOk || !rec || s.rec !== rec || rec.vols === 0 || !s.target || !s.eyes.length) return false;
    if (spec.cs) { b.cs ||= createCsShadow({ device, f16, cls4: !!s.variant.cls4, onShader }); return b.cs.run(rec, spec, s, b); } // a compute variant (vr-wgpu-cs.js): made on the first ask, its programs compile in the background (null until they exist)
    const custom = shadowEncoders.get(spec.name) || null;
    const displayPipe = pipes.get(vkey(s.variant)); // never compiled here: a variant the display changed to meanwhile is skipped
    const pipeline = custom ? null : spec.march ? b.pipes.get(vkey({ ...s.variant, march: spec.march })) : spec.abl ? b.pipes.get(vkey({ ...s.variant, abl: spec.abl })) : displayPipe;
    if (!pipeline && !custom) return null;
    const wantsCreep = (spec.overrides?.useSkip | 0) > 0; // withCreep: the creep skip over the display's 0, only where the host's bits are valid for the texture (else the pass would read a dummy skipTex): no program, the caller steps past it
    if (wantsCreep && !s.skipHostOn) return null;
    if (spec.proxy && !s.px) return null; // noProxy: the low pass of this frame did not use the pre-pass (no distance field, sections, ...): its shadow would be the same pass (a silent zero), no program: the caller steps past it
    let mxGroup = null;
    if (spec.march) { // distSplit / march2: the grids come from the combined texture's bytes (a little per call: not now until they are made); no bytes on the CPU = no program
      const tex = s.clsTex, e = tex && gpuOf(tex) ? entries.get(tex) : null;
      const st = e && e.format === 'rgba8unorm' ? mx.prepare(tex, e.gen, tex.image?.data, [e.w, e.h, e.d]) : null;
      if (st === null) return null;
      if (st === 'wait') return false;
      mxGroup = mx.group(spec.march);
    }
    const sl = b.slots.findIndex(x => !x.busy);
    if (sl < 0) return false;
    const wantsDiff = !!(spec.proxy || spec.diff) && !!b.diff && !!displayPipe && !b.diff.busy; // the comparison runs on the turn of a diff variant (noProxy among them), one at a time
    const W = s.target.w, H = s.target.h; // scratch targets of exactly the low target's size (another size would change the clear / store work)
    if (!b.tgt || b.tgt.w !== W || b.tgt.h !== H) {
      if (b.tgt) { b.tgt.color.destroy(); b.tgt.depth.destroy(); }
      const mk = () => device.createTexture({ size: [W, H, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      b.tgt = { w: W, h: H, color: mk(), depth: mk() }; b.tgt.colorView = b.tgt.color.createView(); b.tgt.depthView = b.tgt.depth.createView();
    }
    const enc = device.createCommandEncoder();
    if (custom) { // a variant that draws itself (registerShadowEncoder): it gets the scratch target of the frame's size and the begin / end timestamps; null = no program for this frame (the caller steps past it)
      let made;
      try {
        made = custom({ device, enc, target: b.tgt, eyes: s.eyes, snap: s, ubufOf, overrides: spec.overrides || null, tsw: { querySet: b.qs, beginningOfPassWriteIndex: 2 * sl, endOfPassWriteIndex: 2 * sl + 1 }, tswBegin: { querySet: b.qs, beginningOfPassWriteIndex: 2 * sl }, tswEnd: { querySet: b.qs, endOfPassWriteIndex: 2 * sl + 1 } });
      } catch (e) { b.failed.push(spec.name + ': ' + String(e?.message ?? e).slice(0, 160)); made = null; }
      if (made === null || made === false) return null;
    } else {
    const pass = enc.beginRenderPass({ timestampWrites: { querySet: b.qs, beginningOfPassWriteIndex: 2 * sl, endOfPassWriteIndex: 2 * sl + 1 }, colorAttachments: [
      { view: b.tgt.colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: b.tgt.depthView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    ] });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, boxBuf);
    s.eyes.forEach((e, i) => {
      b.tmp.set(s.ab[i]);
      for (const [k, v] of Object.entries(spec.overrides || {})) { const fd = layout.fields.find(f => f.name === k); if (fd) b.tmp[fd.offset / 4] = v | 0; }
      device.queue.writeBuffer(ubufOf(4 + i), 0, b.tmp);
      pass.setBindGroup(0, s.bg[i]);
      if (mxGroup) pass.setBindGroup(1, mxGroup);
      pass.setViewport(e.vx, e.vy, e.vw, e.vh, 0, 1);
      for (const sc of e.scissors) { pass.setScissorRect(sc[0], sc[1], sc[2], sc[3]); pass.draw(36); }
    });
    pass.end();
    }
    enc.resolveQuerySet(b.qs, 2 * sl, 2, b.resolve, 256 * sl); enc.copyBufferToBuffer(b.resolve, 256 * sl, b.slots[sl].buf, 0, 16);
    b.slots[sl].busy = true;
    let diffTotal = 0;
    if (wantsDiff) { // the same region, uniforms and tiles with the pre-pass ON (the snapshot's own uniforms) into a second scratch target, then a small compute counts the pixels whose colour or depth differ from the off copy above (this pass is not timed)
      const d = b.diff;
      if (!b.tgt2 || b.tgt2.w !== W || b.tgt2.h !== H) {
        if (b.tgt2) { b.tgt2.color.destroy(); b.tgt2.depth.destroy(); }
        const mk = () => device.createTexture({ size: [W, H, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
        b.tgt2 = { w: W, h: H, color: mk(), depth: mk() }; b.tgt2.colorView = b.tgt2.color.createView(); b.tgt2.depthView = b.tgt2.depth.createView();
      }
      const on = enc.beginRenderPass({ colorAttachments: [
        { view: b.tgt2.colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        { view: b.tgt2.depthView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      ] });
      on.setPipeline(displayPipe); on.setVertexBuffer(0, boxBuf);
      s.eyes.forEach((e, i) => {
        if (!spec.march) device.queue.writeBuffer(ubufOf(7 + i), 0, s.ab[i]);
        on.setBindGroup(0, spec.march ? s.bg[i] : s.bgOn[i]); on.setViewport(e.vx, e.vy, e.vw, e.vh, 0, 1); diffTotal += e.vw * e.vh;
        for (const sc of e.scissors) { on.setScissorRect(sc[0], sc[1], sc[2], sc[3]); on.draw(36); }
      });
      on.end();
      if (!d.group || d.gA !== b.tgt || d.gB !== b.tgt2) {
        d.gA = b.tgt; d.gB = b.tgt2;
        d.group = device.createBindGroup({ layout: d.bgl, entries: [
          { binding: PROXY_DIFF_BINDINGS.colorA, resource: b.tgt.color.createView() }, { binding: PROXY_DIFF_BINDINGS.depthA, resource: b.tgt.depth.createView() },
          { binding: PROXY_DIFF_BINDINGS.colorB, resource: b.tgt2.color.createView() }, { binding: PROXY_DIFF_BINDINGS.depthB, resource: b.tgt2.depth.createView() },
          { binding: PROXY_DIFF_BINDINGS.count, resource: { buffer: d.cnt } },
        ] });
      }
      enc.clearBuffer(d.cnt);
      let cw = 1, ch = 1; for (const e of s.eyes) { cw = Math.max(cw, e.vx + e.vw); ch = Math.max(ch, e.vy + e.vh); } // only the part the passes drew (the scratch targets are the largest size now; both are cleared, so outside it they agree)
      const cp = enc.beginComputePass(); cp.setPipeline(d.pipe); cp.setBindGroup(0, d.group); cp.dispatchWorkgroups(Math.ceil(Math.min(W, cw) / 8), Math.ceil(Math.min(H, ch) / 8)); cp.end();
      enc.copyBufferToBuffer(d.cnt, 0, d.rb, 0, 16);
      d.busy = true;
    }
    device.queue.submit([enc.finish()]);
    if (wantsDiff) { // delivered through the same callback as the timings: ('proxyDiff' | 'diff:<name>', pixels that differ, pixels compared), then the largest differences and the pixels whose colour differs
      const d = b.diff, diffName = spec.name === 'noProxy' ? 'proxyDiff' : 'diff:' + spec.name;
      d.rb.mapAsync(GPUMapMode.READ).then(() => {
        const a = new Uint32Array(d.rb.getMappedRange().slice(0)); d.rb.unmap(); d.busy = false;
        try { b.onShadow?.(diffName, a[0], diffTotal); b.onShadow?.('diffMax:' + spec.name, a[1], a[2]); b.onShadow?.('diffColor:' + spec.name, a[3], 1); } catch { /* the page's callback */ }
      }).catch(() => { d.busy = false; });
    }
    rec.shadowed = true;
    const p = { name: spec.name, shadow: null, low: rec.lowMs, done: false, cb: b.onShadow };
    (rec.pairs ||= []).push(p);
    const slot = b.slots[sl];
    slot.buf.mapAsync(GPUMapMode.READ).then(() => {
      const a = new BigUint64Array(slot.buf.getMappedRange().slice(0)); slot.buf.unmap(); slot.busy = false;
      const ms = Number(a[1] - a[0]) / 1e6;
      p.shadow = a[0] !== 0n && a[1] >= a[0] && ms < 1000 ? ms : -1;
      finPair(p);
    }).catch(() => { slot.busy = false; p.shadow = -1; finPair(p); });
    if (p.low !== null) finPair(p);
    return true;
  };
  // the 'specCfg' shadow pass (A4): the frame's low pass drawn with the specialised program (docs/vr-wgsl-spec.js: the pipeline made for the settings the low pass packed), timed like the other variants (the callback gets
  // ('specCfg', its ms, the low pass ms)); then the generic program once more into a second scratch target (same region, same uniforms: both passes share the snapshot's bind groups, no override is applied) and the proxy comparison's
  // compute counts the pixels whose colour or packed depth differ (4 bytes read back; delivered as ('diff:specCfg', pixels that differ, pixels compared); the expected value is 0). The comparison's counter buffer is the noProxy turn's: one at a time.
  // Returns like shadowPass; null (not false: the rotation must go on) while the pipeline of this frame's settings is not ready (its creation is started here, the next round finds it) or when it failed to compile.
  const specShadowPass = (rec, spec) => {
    const b = bd, s = b?.snap;
    if (!b || !b.shadowOk || !rec || s.rec !== rec || rec.vols === 0 || !s.target || !s.eyes.length) return false;
    const generic = pipes.get(vkey(s.variant));
    if (!generic) return null;
    const sig = specSigOfPacked(s.ab[0], (s.abF ||= s.ab.map(a => new Float32Array(a.buffer)))[0], layout);
    const st = specs.status(s.variant, sig);
    if (st === 'none') specs.request(s.variant, sig);
    if (st !== 'ready') return null;
    const pipeline = specs.get(s.variant, sig);
    const sl = b.slots.findIndex(x => !x.busy);
    if (sl < 0) return false;
    const wantsDiff = !!b.diff && !b.diff.busy;
    const W = s.target.w, H = s.target.h;
    const target = k => { // the scratch targets of exactly the low target's size: b.tgt (the timed pass) and b.tgt2 (the generic copy)
      const t = b[k];
      if (t && t.w === W && t.h === H) return t;
      if (t) { t.color.destroy(); t.depth.destroy(); }
      const mk = () => device.createTexture({ size: [W, H, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      const n = b[k] = { w: W, h: H, color: mk(), depth: mk() }; n.colorView = n.color.createView(); n.depthView = n.depth.createView();
      return n;
    };
    const tA = target('tgt'), tB = wantsDiff ? target('tgt2') : null;
    const enc = device.createCommandEncoder();
    const draw = (pass, pipe) => {
      pass.setPipeline(pipe); pass.setVertexBuffer(0, boxBuf);
      s.eyes.forEach((e, i) => { pass.setBindGroup(0, s.bg[i]); pass.setViewport(e.vx, e.vy, e.vw, e.vh, 0, 1); for (const sc of e.scissors) { pass.setScissorRect(sc[0], sc[1], sc[2], sc[3]); pass.draw(36); } });
      pass.end();
    };
    s.eyes.forEach((e, i) => device.queue.writeBuffer(ubufOf(4 + i), 0, s.ab[i])); // the low pass's own uniforms, unchanged (a write goes before the whole submit: both passes see it)
    const clear = { r: 0, g: 0, b: 0, a: 0 };
    draw(enc.beginRenderPass({ timestampWrites: { querySet: b.qs, beginningOfPassWriteIndex: 2 * sl, endOfPassWriteIndex: 2 * sl + 1 }, colorAttachments: [
      { view: tA.colorView, loadOp: 'clear', storeOp: 'store', clearValue: clear }, { view: tA.depthView, loadOp: 'clear', storeOp: 'store', clearValue: clear }] }), pipeline);
    enc.resolveQuerySet(b.qs, 2 * sl, 2, b.resolve, 256 * sl); enc.copyBufferToBuffer(b.resolve, 256 * sl, b.slots[sl].buf, 0, 16);
    b.slots[sl].busy = true;
    let diffTotal = 0;
    if (wantsDiff) {
      const d = b.diff;
      draw(enc.beginRenderPass({ colorAttachments: [{ view: tB.colorView, loadOp: 'clear', storeOp: 'store', clearValue: clear }, { view: tB.depthView, loadOp: 'clear', storeOp: 'store', clearValue: clear }] }), generic);
      for (const e of s.eyes) diffTotal += e.vw * e.vh;
      if (!d.group || d.gA !== tA || d.gB !== tB) {
        d.gA = tA; d.gB = tB;
        d.group = device.createBindGroup({ layout: d.bgl, entries: [
          { binding: PROXY_DIFF_BINDINGS.colorA, resource: tA.color.createView() }, { binding: PROXY_DIFF_BINDINGS.depthA, resource: tA.depth.createView() },
          { binding: PROXY_DIFF_BINDINGS.colorB, resource: tB.color.createView() }, { binding: PROXY_DIFF_BINDINGS.depthB, resource: tB.depth.createView() },
          { binding: PROXY_DIFF_BINDINGS.count, resource: { buffer: d.cnt } },
        ] });
      }
      enc.clearBuffer(d.cnt);
      let cw = 1, ch = 1; for (const e of s.eyes) { cw = Math.max(cw, e.vx + e.vw); ch = Math.max(ch, e.vy + e.vh); }
      const cp = enc.beginComputePass(); cp.setPipeline(d.pipe); cp.setBindGroup(0, d.group); cp.dispatchWorkgroups(Math.ceil(Math.min(W, cw) / 8), Math.ceil(Math.min(H, ch) / 8)); cp.end();
      enc.copyBufferToBuffer(d.cnt, 0, d.rb, 0, 4);
      d.busy = true;
    }
    device.queue.submit([enc.finish()]);
    try { b.onShadow?.('specKey:' + specs.keyOf(s.variant, sig), 0, 1); b.onShadow?.('specDisplay', 0, 1); } catch { /* the page's callback */ }
    if (wantsDiff) {
      const d = b.diff;
      d.rb.mapAsync(GPUMapMode.READ).then(() => { const n = new Uint32Array(d.rb.getMappedRange().slice(0))[0]; d.rb.unmap(); d.busy = false; try { b.onShadow?.('diff:specCfg', n, diffTotal); } catch { /* the page's callback */ } }).catch(() => { d.busy = false; });
    }
    rec.shadowed = true;
    const p = { name: spec.name, shadow: null, low: rec.lowMs, done: false, cb: b.onShadow };
    (rec.pairs ||= []).push(p);
    const slot = b.slots[sl];
    slot.buf.mapAsync(GPUMapMode.READ).then(() => {
      const a = new BigUint64Array(slot.buf.getMappedRange().slice(0)); slot.buf.unmap(); slot.busy = false;
      const ms = Number(a[1] - a[0]) / 1e6;
      p.shadow = a[0] !== 0n && a[1] >= a[0] && ms < 1000 ? ms : -1;
      finPair(p);
    }).catch(() => { slot.busy = false; p.shadow = -1; finPair(p); });
    if (p.low !== null) finPair(p);
    return true;
  };
  // the counting probe: eye = { mvp, origin, lightOff } of the 64 x 64 window (the caller made the matrix); resolves the Uint32Array (64 x 64 x COUNTER_FIELDS.length: COUNTER_FIELDS per pixel, 0 where nothing was covered) or null.
  // tile = where the window lies in the low pass's region { sx, sy, ox, oy, w, h } (a probe pixel p reads the display's tile of the region pixel floor(p * (sx, sy)) + (ox, oy); w, h = the region's size: outside it there is no tile). With it, and while the frame's low pass used the pre-pass
  // (the snapshot of this frame, rec the same), the probe is made twice from the same frame: the run WITHOUT the pre-pass (proxyOn 0, tA read from the display's tiles for the to-tA count) is the result, as the probe always was (the upper bound), and the run WITH the display's tiles
  // (what the display marches) is delivered through onShadow as ('probeOn:<kind>', counters, 64) (the kind is the caller's: opts.kind). mode 'off' / 'on' = only that run (the 'on' result is then the one returned), 'both' (default). Without tiles there is one run, the old one.
  const probeCounters = async (u, eye, variant, rec = null, tile = null, opts = null) => { // rec = the frame record just closed (markFrame): the frame after it has no gap sample, as after a shadow pass
    const b = bd, pr = b?.probe;
    if (!pr || pr.busy) return null;
    const pipeline = b.pipes.get(vkey({ ...b.variant, counters: true }));
    if (!pipeline || vkey(variant) !== vkey(b.variant)) return null;
    const pxTex = tile && b.snap.px?.tex && (!rec || b.snap.rec === rec) && b.snap.target ? b.snap.px.tex : null; // the tiles of the frame the window was cut from; none = the frame's low pass did not use the pre-pass (or it is not this frame's)
    const mode = !pxTex ? 'off' : opts?.mode === 'on' || opts?.mode === 'off' ? opts.mode : 'both';
    pr.busy = true;
    try {
      if (rec) rec.shadowed = true;
      const cfg = new Float32Array(COUNTER_CFG_BINDING.floats);
      if (pxTex) cfg.set([tile.sx, tile.sy, tile.ox, tile.oy, tile.w, tile.h, 1, 0]);
      device.queue.writeBuffer(pr.cfg, 0, cfg);
      const run = (r, on) => { // one pass of the window into the probe's own target and the run's own buffer; submitted at once
        drawPass(pr.target, [{ x: 0, y: 0, w: BD_PROBE, h: BD_PROBE, mvp: eye.mvp, origin: eye.origin, lightOff: eye.lightOff, pxOrg: [0, 0] }], u, variant, 6, pxTex && !on ? { proxyOn: 0 } : null, null,
          { timed: false, pipeline, group1: r.group, pxTex, before: enc => enc.clearBuffer(r.cnt), after: enc => enc.copyBufferToBuffer(r.cnt, 0, r.rb, 0, BD_PROBE_BYTES) });
        return r.rb.mapAsync(GPUMapMode.READ).then(() => { const out = new Uint32Array(r.rb.getMappedRange().slice(0)); r.rb.unmap(); return out; });
      };
      const first = run(mode === 'on' ? pr.run2 : pr, mode === 'on'), second = mode === 'both' ? run(pr.run2, true) : null; // (the unread one never leaves a rejected promise: see below; both submitted before either is read; each draw writes its own uniform copy before its own submit)
      second?.catch(() => {});
      const out = await first;
      if (second) { const on = await second; try { b.onShadow?.('probeOn:' + (opts?.kind ?? 'whole'), on, BD_PROBE); } catch { /* the page's callback */ } }
      return out;
    } finally { pr.busy = false; }
  };

  // the direct draw trial (vr-wgpu-direct.js): the pieces it needs of this renderer; nothing of it runs until the page installs its hook and asks for it per frame
  const directWay = { text: (mode, cls4) => newPathText({ f16, cls4, mode }), group1Layout: mode => dispNp().layoutOf(mode), modes: v => (v.events ? ['distEv', 'skipEv'] : ['both', 'dist', 'skip', 'tileSkip']) }; // the display's ways, for the direct draw's programs (vr-wgpu-direct.js h.way)
  const direct = createDirectApi({ way: directWay, device, THREE, layout, bgl, f16, onShader, boxBuf, gpuOf, dummy, proxyDummyTex, linear, nearest, texId: t => (t.__id ||= ++idSeq), fillUniforms: (u, extra) => { fillUniforms(u, extra); return uAb; }, passExtra, pipeFor, bindGroup, dropSnapshot: () => { if (bd) bd.snap.rec = null; } });

  // the same-picture check (vr-wgpu-ident.js): nothing is made until the page's button starts it
  const ident = createIdentGpu({ device, f16, hasTimer: !!ts, drawPass, makeNp, controlPipeDesc: cls4 => pipeDesc({ cls4: !!cls4, events: false, abl: 'shade' }), setIdentOn: v => { identOn = !!v; }, curRec: () => (ts ? ts.cur : null), frameNo: () => frameNo });

  const dispose = () => {
    ident.end(); try { dnp?.destroy(); } catch { /* gone */ }
    endBreakdown(); direct.dispose();
    for (const t of pool) { t.color.destroy(); t.depth.destroy(); }
    for (const t of fixed.values()) { t.color.destroy(); t.depth.destroy(); }
    fixed.clear(); pool.length = 0; boxBuf.destroy(); ubufs.forEach(b => b?.destroy()); xbufs.forEach(b => b?.destroy());
    for (const k of Object.keys(dummies)) dummies[k].destroy();
    mx.destroy();
    for (const t of px.pool) t.gpu.destroy();
    px.pool.length = 0; px.ubuf?.destroy(); proxyDummy?.destroy();
    if (ts) { try { ts.qs.destroy(); ts.resolve.destroy(); ts.slots.forEach(x => x.buf.destroy()); ts.markTex.destroy(); } catch { /* gone */ } }
  };
  return { counts, device, f16, layout, warm, pipeFor, gpuOf, copySlab, initTexture, getTarget, fixedTarget, dropTarget, drawPass, dispose, takeGpuMs, takeFrameStats, takeGauges, leftovers: () => ({ every: ts ? ts.every : null, slots: ts ? ts.slots.length : 0, slotsBusy: ts ? ts.slots.reduce((n, x) => n + (x.busy ? 1 : 0), 0) : 0, bd: !!bd, groups: groups.size, pipes: pipes.size, ubufs: ubufs.reduce((n, x) => n + (x ? 1 : 0), 0) }), onFrameVolMs, markFrame, setTimerEvery, beginFrame, hasTimer: !!ts, poolSize: () => pool.length,
    primeWays, beginBreakdown, endBreakdown, bdActive, bdTiles, bdSnapshot, shadowPass, probeCounters, direct, ident, displayNp, markCpuBusy, warmWays,
    newPath: { stats: newPathStats, noteDeviceError, writers: () => npWriters.size, rebuild: () => { rebuildPending = true; } },
    spec: { pipelines: specs } };
}

// ---- the per-eye matrices of one volume pass: mvp = projection * view * model; origin = the eye in the volume's object space; lightOff = the shared headlight (lighting.js) in object space ----
export function eyeUniforms(THREE, model, sub, out = {}) {
  out.mvp ||= new THREE.Matrix4(); out.origin ||= new THREE.Vector3(); out.lightOff ||= new THREE.Vector3();
  const view = sub.matrixWorldInverse, inv = (out.inv ||= new THREE.Matrix4()).copy(model).invert();
  out.mvp.multiplyMatrices(sub.projectionMatrix, view).multiply(model);
  const e = sub.matrixWorld.elements;
  out.origin.set(e[12], e[13], e[14]).applyMatrix4(inv);
  const m = inv.elements, ve = view.elements;
  const row = (a, b, c) => { const x = m[0] * a + m[4] * b + m[8] * c, y = m[1] * a + m[5] * b + m[9] * c, z = m[2] * a + m[6] * b + m[10] * c, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const r = row(ve[0], ve[4], ve[8]), uu = row(ve[1], ve[5], ve[9]);
  out.lightOff.set(r[0] * 0.3 + uu[0] * 0.5, r[1] * 0.3 + uu[1] * 0.5, r[2] * 0.3 + uu[2] * 0.5); // LIGHT_RIGHT, LIGHT_UP (lighting.js)
  return out;
}

// ---- the composite: a box mesh (the volume's box, back faces) whose material reads the offscreen colour + packed depth, upscales them (bilinear colour, nearest depth) inside the box and writes the volume's depth ----
// TSL = THREE.TSL of the WebGPU build. The offscreen layout: eye i's slot starts at x = i * stride (px of the target) and holds the REGION of the eye's image that was drawn (where the box can be seen, scaled by `scale`;
// reg = [x0, y0, w, h] in px of the scaled image, per eye); outside the region nothing was drawn (the composite writes nothing there). The periphery target (a lower scale, optional) is blended in outside the fovea rect.
export function createComposite({ THREE, halfExt = [1, 1, 1], device }) {
  const T = THREE.TSL, { sRGBTransferEOTF, Fn, uniform, texture, vec2, vec3, vec4, float, If, Discard, screenCoordinate, cameraIndex, clamp, min, max, select, positionLocal, mix } = T;
  const mkExt = () => { const t = new THREE.ExternalTexture(null); t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
  const mkNear = () => { const t = new THREE.ExternalTexture(null); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; };
  const u = {
    halfExt: uniform(new THREE.Vector3(...halfExt)),
    inv1: uniform(new THREE.Vector2(1, 1)), scale1: uniform(1), stride1: uniform(1), reg1a: uniform(new THREE.Vector4(0, 0, 1, 1)), reg1b: uniform(new THREE.Vector4(0, 0, 1, 1)),
    inv2: uniform(new THREE.Vector2(1, 1)), scale2: uniform(1), stride2: uniform(1), reg2a: uniform(new THREE.Vector4(0, 0, 1, 1)), reg2b: uniform(new THREE.Vector4(0, 0, 1, 1)),
    decode: uniform(0), // 1 = three.js encodes the frame to sRGB at the end (a frame buffer pass over the whole frame): the volume's display values are decoded first, so they come out unchanged (the WebGL volume writes them raw). 0 = the frame is not converted afterwards
    fovOn: uniform(0), rect0: uniform(new THREE.Vector4()), rect1: uniform(new THREE.Vector4()), band: uniform(1),
  };
  // before the first frame the nodes point at a 1 x 1 texture each (a binding needs a real GPUTexture)
  const blank = device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const first = near => { const t = near ? mkNear() : mkExt(); t.sourceTexture = blank; return t; };
  const blankExt = { c: first(false), d: first(true) }; // what a node falls back to when its target is let go (shared: a node's value is only ever compared by identity)
  const nodes = { c1: texture(first(false)), d1: texture(first(true)), c2: texture(first(false)), d2: texture(first(true)) };
  const eye = float(cameraIndex);
  const p = screenCoordinate.xy; // the pixel in the eye's own image (top-left origin)
  const isRight = eye.greaterThan(0.5);
  // the sampling coordinate in the offscreen target (+ whether the pixel lies in the drawn region: a pixel outside it was not drawn, it is transparent)
  const uvOf = (inv, scale, stride, regA, regB) => {
    const reg = select(isRight, regB, regA), sx = p.x.mul(scale).sub(reg.x), sy = p.y.mul(scale).sub(reg.y);
    const inside = sx.greaterThanEqual(0).and(sx.lessThanEqual(reg.z)).and(sy.greaterThanEqual(0)).and(sy.lessThanEqual(reg.w));
    const uv = vec2(clamp(sx, 0.5, max(reg.z.sub(0.5), 0.5)).add(eye.mul(stride)), clamp(sy, 0.5, max(reg.w.sub(0.5), 0.5))).mul(inv);
    return { uv, mask: select(inside, float(1), float(0)) };
  };
  const q1 = uvOf(u.inv1, u.scale1, u.stride1, u.reg1a, u.reg1b), q2 = uvOf(u.inv2, u.scale2, u.stride2, u.reg2a, u.reg2b), uv1 = q1.uv, uv2 = q2.uv;
  const rect = select(isRight, u.rect1, u.rect0);
  const wt = clamp(min(min(p.x.sub(rect.x), p.y.sub(rect.y)), min(rect.z.sub(p.x), rect.w.sub(p.y))).div(u.band), 0, 1);
  const decode = c => c.r.mul(255 * 65536).add(c.g.mul(255 * 256)).add(c.b.mul(255)).div(16777215);
  const colorNode = Fn(() => {
    const c1 = nodes.c1.sample(uv1).mul(q1.mask).toVar();
    const out = vec4(c1).toVar();
    If(u.fovOn.greaterThan(0.5).and(wt.lessThan(1)), () => {
      const c2 = nodes.c2.sample(uv2).mul(q2.mask);
      out.assign(select(wt.lessThanEqual(0), c2, mix(c2, c1, wt)));
    });
    If(out.a.lessThanEqual(0), () => { Discard(); });
    If(u.decode.greaterThan(0.5), () => { const a = max(out.a, 1e-4); out.assign(vec4(sRGBTransferEOTF(out.rgb.div(a)).mul(a), out.a)); });
    return out;
  })();
  const depthNode = Fn(() => {
    const d1 = decode(nodes.d1.sample(uv1)), d2 = decode(nodes.d2.sample(uv2));
    const d = float(d1).toVar();
    If(u.fovOn.greaterThan(0.5).and(wt.lessThan(1)), () => { d.assign(select(wt.greaterThanEqual(0.5), d1, d2)); });
    return d;
  })();
  const material = new THREE.NodeMaterial();
  material.side = THREE.BackSide; material.toneMapped = false; material.depthWrite = true; material.depthTest = true; material.transparent = false;
  material.blending = THREE.CustomBlending; material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.positionNode = positionLocal.mul(u.halfExt);
  material.fragmentNode = colorNode;
  material.depthNode = depthNode;
  const exts = new WeakMap(); // GPUTexture -> its ExternalTexture (one per target texture; the node's value is switched per frame)
  const extOf = (gpuTex, nearestFilter) => {
    let e = exts.get(gpuTex);
    if (!e) { e = nearestFilter ? mkNear() : mkExt(); e.sourceTexture = gpuTex; exts.set(gpuTex, e); }
    return e;
  };
  // one frame's parameters: low / peri = { target (fixedTarget: one per pass, made once), scale, stride, regs: [[x0, y0, w, h] of the left eye, of the right eye] (px of the scaled image) }. Without regs the region is the whole image (usedW x usedH), as before.
  const regsOf = x => x.regs || [[0, 0, x.usedW, x.usedH], [0, 0, x.usedW, x.usedH]];
  const setRegs = (a, b, regs) => { a.value.set(...regs[0]); b.value.set(...(regs[1] || regs[0])); };
  const update = ({ low, peri = null, fov = false, rects = null, band = 1, decode = false }) => {
    u.decode.value = decode ? 1 : 0;
    nodes.c1.value = extOf(low.target.color, false); nodes.d1.value = extOf(low.target.depth, true);
    if (!(fov && peri)) { nodes.c2.value = nodes.c1.value; nodes.d2.value = nodes.d1.value; } // no periphery pass this frame: the second pair is the first one's (it must not keep pointing at a target that may be let go of)
    u.inv1.value.set(1 / low.target.w, 1 / low.target.h); u.scale1.value = low.scale; u.stride1.value = low.stride; setRegs(u.reg1a, u.reg1b, regsOf(low));
    u.fovOn.value = fov && peri ? 1 : 0;
    if (fov && peri) {
      nodes.c2.value = extOf(peri.target.color, false); nodes.d2.value = extOf(peri.target.depth, true);
      u.inv2.value.set(1 / peri.target.w, 1 / peri.target.h); u.scale2.value = peri.scale; u.stride2.value = peri.stride; setRegs(u.reg2a, u.reg2b, regsOf(peri));
      u.rect0.value.set(...rects[0]); u.rect1.value.set(...(rects[1] || rects[0])); u.band.value = band;
    }
  };
  // targets are being destroyed (the pool let them go): no node points at them afterwards; they go to the 1 x 1 texture until the next update()
  const forget = (...gpuTextures) => {
    const gone = new Set(gpuTextures);
    for (const k of ['c1', 'd1', 'c2', 'd2']) if (gone.has(nodes[k].value?.sourceTexture)) nodes[k].value = blankExt[k[0]];
    for (const t of gpuTextures) exts.delete(t);
  };
  const dispose = () => { material.dispose(); blank.destroy(); };
  return { material, update, forget, nodes, u, dispose };
}

// ---- the session's volume renderer: what the frame loop of vr-view.js calls (instead of the WebGL ray pass + composite) ----
// draw(): one frame of the body volume for the cameras of the XR frame. f = the render scale of the centre (1 = the eye's full size, no offscreen reduction), fov / fp = the periphery pass
// (a second target at scale fp, only the bands around the centre rect), rects = the centre rect per eye in px of the eye image, y up (vr-render-scale.js foveaRect), band = the blend band in px.
// boxes = the covered rect of the box per eye (eyeMetrics: x0 y0 x1 y1, px of the eye image, y up; the whole image when the box reaches the eye).: a pass draws only that rect (and, for the centre, only its part inside
// the centre rect) into a part of the pass's target of that size, in steps (bucketSize); without boxes the whole eye image, as before.: the two targets are made once, at the first draw (both eyes at the largest scale), and a region only changes
// the part of them that is drawn and read.
// ---- variants that draw themselves (the performance record's shadow passes) ----
// A variant of docs/vr-perf-log.js BD_SPECS that a program text (abl) or a uniform value (overrides) cannot make (its own pipeline, bind group, extra compute passes) registers a function here under its table name:
//   registerShadowEncoder(name, ({ device, enc, target, eyes, snap, ubufOf, overrides, tsw, tswBegin, tswEnd }) => ...)
// It is called when the variant's turn comes, with the command encoder of the shadow pass (nothing is submitted by it), the scratch target of the low pass's size ({ w, h, color, depth, colorView, depthView }: rgba8, clear to 0 and draw the same region the low pass drew),
// eyes = the snapshot's eyes ({ x, y, w, h, vx, vy, vw, vh, scissors } of the low pass; the frame's own uniforms are snap.ab[i], the bind groups of the display's uniforms snap.bgOn[i] with its tiles snap.px?.tex), and the timestamps of the pass: tsw = begin and end on ONE pass,
// tswBegin on the first pass and tswEnd on the last when it draws more than one. It returns nothing (done), or null / false = no program for this frame (the caller steps past it); a throw is listed as a failure of the variant. The turn then compares the target with the display's own pass if the table entry says diff: true.
const shadowEncoders = new Map();
export function registerShadowEncoder(name, fn) { if (typeof fn === 'function') shadowEncoders.set(name, fn); else shadowEncoders.delete(name); }
export function createVrVolumeRenderer({ THREE, device, f16 = false, halfExt = [1, 1, 1], onShader = null, onFatal = null }) {
  const composite = createComposite({ THREE, halfExt, device });
  const volume = createVolumeGpu({ device, THREE, f16, onShader, onFatal, onTargetFreed: t => composite.forget(t.color, t.depth) });
  const tmpEye = [{}, {}], tmpPeri = [{}, {}];
  const stats = { w: 0, h: 0, lowW: 0, lowH: 0, lowPx: 0, regions: null, direct: 0, np: null }; // direct = px the direct draw takes this frame (0 = the offscreen path drew the whole centre)
  const held = { low: null, peri: null }; // the slot size of each pass (fitSlot keeps it while the need stays near it)
  const scaleMax = { low: 1, peri: Math.max(...FOVEA_K.filter(k => k < 1)) }; // the largest scale a pass is drawn at (the caller's f is at most 1, the periphery's f x the setting's FOVEA_K below 1): what its target is made for.: the periphery's follows the setting (draw's periK; 0 = the setting has no periphery pass: no target)
  let periSet = null; // the periphery scale cap the target was made for (null before the first frame)
  const variantOf = u => ({ cls4: !!u.cls4Tex?.value?.isData3DTexture && u.cls4Tex.value.image?.width > 1, events: (u.planeCount?.value | 0) > 0 });
  let probeBuf = null, periSeen = null;
  const bdLow = { r: null, Wu: 1, Hu: 1, variant: null, ok: false }; // the left eye's drawn region of the last low pass while the breakdown records (eyes' matrices stay in tmpEye[0])
  const bdMat = new THREE.Matrix4();
  const okRect = b => b && Number.isFinite(b.x0) && Number.isFinite(b.y0) && Number.isFinite(b.x1) && Number.isFinite(b.y1);
  const draw = ({ u, cams, model, f, fov = false, fp = f, rects = null, band = 1, variant = null, decode = false, boxes = null, periK = null, identCtx = null }) => {
    volume.beginFrame(); volume.direct.beginFrame();
    const n = Math.min(2, cams.length);
    const v0 = cams[0].viewport, W = Math.max(1, Math.round(v0.z)), H = Math.max(1, Math.round(v0.w));
    const vr = variant || variantOf(u);
    const fovOn = !!(fov && rects);
    if (periSeen !== null && periSeen !== fovOn) volume.counts.peri++; periSeen = fovOn; // the periphery pass switched on / off
    const wholeEye = [0, 0, W, H];
    // periK = the foveation setting's FOVEA_K (below 1: the periphery pass's largest scale; 1: no periphery pass, no target); without it (older callers) the largest FOVEA_K below 1. The periphery's target is made again only when this changes (a menu action), never for a hold or a head move.
    const periCap = periK === null ? Math.max(...FOVEA_K.filter(k => k < 1)) : periK < 1 ? Math.max(0, periK) : 0, periChanged = periSet !== null && periSet !== periCap;
    periSet = periCap; scaleMax.peri = periCap; if (periChanged) held.peri = null;
    volume.fixedTarget('low', Math.ceil(W * scaleMax.low), Math.ceil(H * scaleMax.low)); // the targets at the first frame (the pass below only asks again, for the same size)
    if (periCap > 0) volume.fixedTarget('peri', Math.ceil(W * periCap), Math.ceil(H * periCap), periChanged); else if (periChanged) volume.dropTarget('peri');
    const boxOf = i => (okRect(boxes?.[i]) ? [boxes[i].x0, boxes[i].y0, boxes[i].x1, boxes[i].y1] : wholeEye);
    const rectOf = i => rects[i] || rects[0];
    // one pass: want(i) = the y-up rect of eye i to cover, inner(i) = a y-up rect not drawn (or null), at `scale`
    const pass = (name, scale, bucket, want, inner, shrink) => {
      const Wu = Math.max(1, Math.ceil(W * scale)), Hu = Math.max(1, Math.ceil(H * scale));
      const regs = [], regions = [];
      let needW = 1, needH = 1;
      for (let i = 0; i < n; i++) { const r = scaledRegion(want(i), H, scale, Wu, Hu); regions.push(r); needW = Math.max(needW, r.x1 - r.x0); needH = Math.max(needH, r.y1 - r.y0); }
      const slotW = fitSlot(needW, held[name]?.w, Wu), slotH = fitSlot(needH, held[name]?.h, Hu);
      if (held[name] && (held[name].w !== slotW || held[name].h !== slotH)) volume.counts.slot++; // the slot size changed (only the part of the target that is drawn and read changes; no target is made)
      held[name] = { w: slotW, h: slotH };
      const stride = slotW + 2;
      const target = volume.fixedTarget(name, Math.ceil(W * Math.max(scale, scaleMax[name])), Math.ceil(H * Math.max(scale, scaleMax[name]))); // one target per pass, the largest an eye can need (the pass's scale cap; the slot below is a part of it)
      const tilesPerEye = Math.ceil(slotW / PROXY.tile), tilesY = Math.ceil(slotH / PROXY.tile); // the pre-pass's tiles: eye i's tile columns start at i * tilesPerEye (the slot, not the region, sets them)
      const t4 = tileLayout(slotW, slotH); // the new ways' 4 x 4 tiles (the same rule: the slot sets them)
      const eyes = [];
      for (let i = 0; i < n; i++) {
        const e = eyeUniforms(THREE, model, cams[i], bucket[i]), r = regions[i], rw = r.x1 - r.x0, rh = r.y1 - r.y0;
        const mvp = regionMvp(bucket[i].rmvp ||= new THREE.Matrix4(), e.mvp, regionClip(r, Wu, Hu)); // the region of the eye's image fills the viewport below (the same pixels as the whole image would have; the depth is unchanged)
        const vx = i * stride;
        eyes.push({ x: vx, y: 0, w: rw, h: rh, vx, vy: 0, vw: rw, vh: rh, scissors: bandRects(r, inner?.(i, r) ?? null, H, scale, shrink).map(c => [vx + c[0], c[1], c[2], c[3]]), mvp, origin: e.origin, lightOff: e.lightOff,
          pxOrg: [vx - PROXY.tile * i * tilesPerEye, 0], pxOrg4: tilePxOrg(vx, i, t4.tilesPerEye) }); // pxOrg: (pixel of the target - pxOrg) / 8 = the pixel's tile in the pre-pass's texture (pxOrg4: / 4, the new ways')
        regs.push([r.x0, r.y0, rw, rh]);
      }
      return { target, eyes, scale, stride, regs, usedW: slotW, usedH: slotH, px: { tilesPerEye, tilesY, texCols: Math.ceil(target.slotW / PROXY.tile) * 2, texRows: Math.ceil(target.slotH / PROXY.tile), tile4: { ...t4, texCols: Math.ceil(target.slotW / 4) * 2, texRows: Math.ceil(target.slotH / 4) } } };
    };
    // the direct draw trial (vr-wgpu-direct.js; only when the page asks: direct, at scale 1, everything ready): the full-weight part of the centre rect is drawn straight into the eye image by three.js' eye pass (the hook there)
    // and cut out of the centre pass here (the same rect: the pass keeps the band around it, where the composite blends it with the periphery). Without it innerLow is null: the call below is the one of before.
    const dReq = volume.direct.asked && volume.direct.canUse({ f, cams, decode, model, variant: vr });
    const dReg = [null, null], dRect = [null, null];
    const innerLow = dReq ? (i, r) => { dReg[i] = r; const D = directRegion(r, fovOn ? rectOf(i) : null, band, H); dRect[i] = D; return D ? [D.x0, H - D.y1, D.x1, H - D.y0] : null; } : null;
    // the centre (or the whole picture): the box's rect, in the fovea mode only its part inside the centre rect
    const low = pass('low', f, tmpEye, i => (fovOn ? rectsMeet(boxOf(i), rectOf(i)) : boxOf(i)), innerLow, 0);
    const dnp = volume.displayNp(); // the display's new way (a code switch, off: null) for this frame; the breakdown and the same-picture check leave the display as it was
    const lowDraw = volume.drawPass(low.target, low.eyes, u, vr, 0, null, null, dnp ? { proxy: low.px, np: { ...dnp, auto: true, pass: 'low', skip: '' } } : { proxy: low.px }); // the low pass (and no other) runs the pre-pass; the periphery and the probes do not
    stats.np = lowDraw?.np ?? null;
    if (volume.ident.active) volume.ident.frame({ low, lowDraw, u, vr, dReq, n, cx: identCtx }); // the same-picture check: this frame's centre pass once more with one of the ways, compared with the picture just drawn
    let directPx = 0;
    if (dReq) { // the uniforms and bind groups of the direct draw (the tiles of the pre-pass are the centre pass' own); a centre pass that had no way this frame (nothing is drawn) has nothing to record either: the display's own program is never drawn
      try {
        const wy = lowDraw?.np?.use && lowDraw.np.group1 ? { mode: lowDraw.np.mode, group1: lowDraw.np.group1, tile: lowDraw.np.tiles4 ? 4 : 8 } : null; // the centre pass' way this frame (its program, its group 1, the size of its tiles); null = the display's own program
        const tpe = wy && wy.tile === 4 ? low.px.tile4.tilesPerEye : low.px.tilesPerEye;
        const rs = []; for (let i = 0; i < n; i++) if (dRect[i]) rs.push({ i, D: dRect[i], region: dReg[i], eye: tmpEye[i], tilesPerEye: tpe });
        if (rs.length && wy) directPx = volume.direct.setFrame({ u, variant: vr, model, rects: rs, pxTex: lowDraw?.proxy?.tex ?? null, way: wy });
      } catch (e) { volume.direct.fail('setting up the frame threw: ' + String(e?.message ?? e).slice(0, 160)); }
    }
    stats.direct = directPx;
    const bdPx = volume.bdActive() ? volume.bdTiles(u, low.eyes, vr, low.px, lowDraw) : null; // the 8 x 8 tiles of the old way, for the recording's shadow passes (the display's own way may have none or 4 x 4)
    if (volume.bdActive() && f >= 1 - 1e-6 && n > 0) { // the recording's check of the direct material against the centre pass (eye 0, this frame's camera): whatever the switch is
      const r0 = low.regs[0], reg = { x0: r0[0], y0: r0[1], x1: r0[0] + r0[2], y1: r0[1] + r0[3] }, D0 = dRect[0] || directRegion(reg, fovOn ? rectOf(0) : null, band, H), e0 = tmpEye[0];
      if (D0) volume.direct.noteForCheck({ u, variant: vr, W, H, eye: { mvp: e0.mvp.clone(), origin: e0.origin.clone(), lightOff: e0.lightOff.clone() }, region: reg, D: D0, pxTex: bdPx?.tex ?? null });
    }
    if (volume.bdActive()) { // the performance record's breakdown is recording: what its shadow pass and its native-pitch probe need of this frame's low pass
      try { volume.bdSnapshot(low.target, low.eyes, u, vr, bdPx); } catch (e) { console.warn('WebGPU breakdown snapshot:', e); } // never lets the frame's drawing throw
      bdLow.r = low.regs[0]; bdLow.Wu = Math.max(1, Math.ceil(W * f)); bdLow.Hu = Math.max(1, Math.ceil(H * f)); bdLow.variant = vr; bdLow.ok = n > 0;
    }
    if (directPx) volume.direct.dropSnapshot(); // a direct frame's centre pass holds the band only: no shadow pass is taken of it
    let peri = null;
    if (fovOn) { // the periphery: the box's rect at the lower scale, only outside the centre rect shrunk by the blend band (what the composite reads from it) and the bilinear margin
      peri = pass('peri', fp, tmpPeri, boxOf, i => rectOf(i), band + Math.ceil(2 / Math.max(fp, 0.05)) + 1);
      volume.drawPass(peri.target, peri.eyes, u, vr, 2, null, null, dnp ? { proxy: peri.px, np: { ...dnp, auto: true, pass: 'peri', skip: '' } } : null);
    }
    const topLeft = fovOn ? rects.map(R => [R[0], H - R[3], R[2], H - R[1]]) : null;
    composite.update({ low, peri, fov: fovOn, rects: topLeft, band, decode });
    let lowPx = 0; for (const e of low.eyes) for (const c of e.scissors) lowPx += c[2] * c[3]; stats.lowPx = lowPx; // px the low pass drew (its scissor rects, all eyes)
    stats.w = W; stats.h = H; stats.lowW = low.regs[0][2]; stats.lowH = low.regs[0][3];
    stats.regions = { low: low.regs.map(r => [r[2], r[3]]), slot: [low.usedW, low.usedH], peri: peri ? peri.regs.map(r => [r[2], r[3]]) : null, periSlot: peri ? [peri.usedW, peri.usedH] : null, scale: f, periScale: peri ? fp : null };
    return stats;
  };
  // the samples-per-ray probe (diag 5) of one eye into a 48 x 48 image, read back (the result arrives later): resolves to the rgba bytes
  const probe = async ({ u, cam, model }) => {
    if (probeBuf?.busy) return null;
    probeBuf ||= { buffer: device.createBuffer({ size: 256 * 48, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), bytesPerRow: 256, w: 48, h: 48, busy: false };
    probeBuf.busy = true;
    try {
      const target = volume.getTarget(64, 64), e = eyeUniforms(THREE, model, cam, {});
      const pnp = volume.displayNp(); // the probe is the display's own pass too: D0 (it has no tiles)
      volume.drawPass(target, [{ x: 0, y: 0, w: 48, h: 48, mvp: e.mvp, origin: e.origin, lightOff: e.lightOff }], u, variantOf(u), 3, { diag: 5 }, probeBuf, pnp ? { np: { ...pnp, auto: true, pass: 'probe', skip: '' } } : null);
      await probeBuf.buffer.mapAsync(GPUMapMode.READ);
      const raw = new Uint8Array(probeBuf.buffer.getMappedRange()), out = new Uint8Array(48 * 48 * 4);
      for (let y = 0; y < 48; y++) out.set(raw.subarray(y * 256, y * 256 + 192), y * 192);
      probeBuf.buffer.unmap();
      return out;
    } finally { probeBuf.busy = false; }
  };
  // the performance record's breakdown (see createVolumeGpu): begin(variant, onShadow) before, shadow(rec, spec) / probe(u, kind) while it records, end() after.
  // probe windows (left eye, 64 x 64 px): 'whole' = the eye's whole image shrunk into the window (the distribution of the work), 'native' = the centre of the region the low pass drew, at the pass's own pixel pitch (how the heavy pixels lie together)
  let bdProbeMode = 'both'; // the counting probe's runs: 'both' (without the pre-pass, the result as always, and with the display's tiles, to the report), 'off' or 'on' (only that one)
  const breakdown = {
    setProbeMode: m => { bdProbeMode = m === 'on' || m === 'off' ? m : 'both'; },
    begin: (variant, onShadow) => volume.beginBreakdown(variant, onShadow),
    end: () => { volume.endBreakdown(); volume.direct.releaseCheck(); },
    shadow: (rec, spec) => volume.shadowPass(rec, spec),
    probe: async (u, kind, rec = null) => {
      if (!bdLow.ok || !bdLow.variant) return null;
      const e0 = tmpEye[0];
      if (!e0.mvp || !e0.origin) return null;
      let mvp = e0.mvp;
      const rg = bdLow.r; // where the window lies in the low pass's region (its pixel (x, y) is the region's (x - x0, y - y0)): the probe reads the display's tile of the pixel it stands for (vr-wgpu.js probeCounters)
      let tile = rg ? { sx: bdLow.Wu / 64, sy: bdLow.Hu / 64, ox: 0 - rg[0], oy: 0 - rg[1], w: rg[2], h: rg[3] } : null; // whole: the eye's whole image shrunk into the window
      if (kind === 'native') {
        const r = bdLow.r; if (!r) return null;
        const wx0 = Math.max(0, Math.min(Math.max(0, bdLow.Wu - 64), Math.floor(r[0] + (r[2] - 64) / 2))), wy0 = Math.max(0, Math.min(Math.max(0, bdLow.Hu - 64), Math.floor(r[1] + (r[3] - 64) / 2)));
        mvp = regionMvp(bdMat, e0.mvp, regionClip({ x0: wx0, y0: wy0, x1: wx0 + 64, y1: wy0 + 64 }, bdLow.Wu, bdLow.Hu));
        tile = { sx: 1, sy: 1, ox: wx0 - r[0], oy: wy0 - r[1], w: r[2], h: r[3] }; // the window's pixels are the low pass's own
      }
      const counters = await volume.probeCounters(u, { mvp, origin: e0.origin, lightOff: e0.lightOff }, bdLow.variant, rec, tile, { kind, mode: bdProbeMode });
      return counters ? { kind, counters, w: 64, h: 64 } : null;
    },
  };
  // every texture the uniforms point at goes to the GPU now (not on the first drawn frame); the programs are made too
  const preload = async (u, variants) => {
    for (const k of ['vol', 'clsTex', 'cls4Tex', 'skipTex', 'editTex', 'sliceVol']) volume.gpuOf(u[k]?.value);
    await volume.warm(variants);
    volume.primeWays(u, variants);
  };
  const dispose = () => { composite.dispose(); volume.dispose(); try { probeBuf?.buffer.destroy(); } catch { /* gone */ } };
  return { volume, composite, draw, probe, preload, warmWays: variants => volume.warmWays(variants), dispose, breakdown, material: composite.material, stats, direct: volume.direct, installDirect: renderer => volume.direct.install(renderer, composite.material) };
}

// ---- the WebGPU session's diagnostic record (the trial: what happened in a session the headset showed black) ----
// Bounded: the stages (start, device, layer, first frame, ...), a few counters (no string per frame), the first distinct errors with their stack and how often each came,
// the values a black view depends on (formats, colour spaces, layer size). Mirrored to localStorage on every stage / error (the trail a crash leaves), and in full (counters, repeated errors, values) when the session ends or the page / headset is hidden
// (flush: startGxHeartbeat and the session's end listener; E0: no longer once a second). Shown on the page after the session.
export const GX_DIAG_KEY = 'vrl-vr-gpu-diag';
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
// one line for an Error, a GPUError, a GPUDeviceLostInfo, an ErrorEvent, a PromiseRejectionEvent or a plain value; stack = the first lines of the stack when there is one
export function gxErrorText(e) {
  if (e == null) return { msg: String(e), stack: '' };
  const inner = e.error ?? e.reason ?? null; // ErrorEvent.error / PromiseRejectionEvent.reason / GPUUncapturedErrorEvent.error
  const x = inner && typeof inner === 'object' ? inner : e;
  let msg = '';
  if (typeof x === 'string') msg = x;
  else {
    const name = x?.constructor?.name && x.constructor.name !== 'Object' ? x.constructor.name : (x?.name || '');
    msg = (name ? name + ': ' : '') + (x?.message ?? (x?.reason ? 'reason=' + x.reason : '') ?? '');
    if (!x?.message && inner == null && typeof e.message === 'string') msg = (name ? name + ': ' : '') + e.message;
    if (!msg.replace(/^[^:]*:\s*/, '')) { try { msg = (name ? name + ': ' : '') + JSON.stringify(x); } catch { msg = String(x); } }
  }
  const stack = typeof x?.stack === 'string' ? x.stack.split('\n').slice(0, 6).join('\n') : (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '');
  return { msg: clip(msg, 400), stack: clip(stack, 700) };
}
export function createGxDiag({ now = () => performance.now(), store = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(), maxErrors = 10, maxStages = 48 } = {}) {
  const t0 = now();
  const d = { stages: [], values: {}, counts: { xrFrames: 0, poses: 0, loop: 0, render: 0, rendered: 0, vol: 0 }, errors: [], dropped: 0 };
  const ms = () => Math.round(now() - t0);
  let saves = 0; // how many times the record was written to the store (the frame ring of docs/vr-bench.js reads it)
  const save = () => { saves++; try { store?.setItem(GX_DIAG_KEY, JSON.stringify(d)); } catch { /* private window / full */ } };
  const stage = (name, info) => {
    if (d.stages.length >= maxStages) d.stages.splice(8, 1); // the first ones (the start) and the latest stay
    const s = { at: ms(), name }; if (info !== undefined) s.info = clip(typeof info === 'string' ? info : JSON.stringify(info), 300);
    d.stages.push(s); save();
  };
  const value = (k, v) => { d.values[k] = v; save(); };
  const error = (kind, e) => {
    const { msg, stack } = gxErrorText(e), key = kind + '|' + msg;
    const hit = d.errors.find(x => x.key === key);
    if (hit) { hit.n++; hit.last = ms(); return; } // a repeat is saved with the next stage / save (flush: at the end of the session, or when it is hidden)
    if (d.errors.length < maxErrors) d.errors.push({ key, kind, msg, stack, n: 1, at: ms(), last: ms() }); else d.dropped++;
    save();
  };
  const count = k => { d.counts[k] = (d.counts[k] | 0) + 1; };
  return { d, stage, value, error, count, flush: save, ms, get saves() { return saves; } };
}
// the file name of the saved record: build number and local date / time (the same clock as the screenshot names), e.g. vrl-vr-gpu-diag-741-20261118-0915.txt
export function gxDiagFileName(build, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return 'vrl-vr-gpu-diag-' + (String(build ?? '').replace(/[^\w.-]/g, '') || 'x') + '-' + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + '-' + p(now.getHours()) + p(now.getMinutes()) + '.txt';
}
// the save button of the page panel: the text of the copy button as one .txt download (Blob + a[download]); the browser decides where the file goes. Returns the file name.
export function saveGxDiagText(text, { build = '', now = new Date(), doc = globalThis.document, urlApi = globalThis.URL, name: fixed = null } = {}) {
  const name = fixed || gxDiagFileName(build, now); // fixed: the WebGL session's record has a name of its own (vr-perf-log.js perfFileName)
  const url = urlApi.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = doc.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => urlApi.revokeObjectURL(url), 30000);
  return name;
}
// the text of the page panel / the copy button
export function gxDiagReport(d, { build = '', ua = '' } = {}) {
  const L = [];
  L.push('WebGPU VR diagnostics' + (build ? ' · build ' + build : ''));
  if (ua) L.push('UA: ' + ua);
  L.push('counts: ' + Object.entries(d.counts).map(([k, v]) => k + '=' + v).join(' '));
  L.push('-- stages (ms since start)');
  for (const s of d.stages) L.push(String(s.at).padStart(6) + '  ' + s.name + (s.info ? '  ' + s.info : ''));
  L.push('-- values');
  for (const [k, v] of Object.entries(d.values)) L.push(k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));
  L.push('-- errors' + (d.errors.length ? '' : ': none') + (d.dropped ? ' (+' + d.dropped + ' more kinds)' : ''));
  for (const x of d.errors) L.push('[' + x.kind + '] x' + x.n + ' @' + x.at + (x.n > 1 ? '..' + x.last : '') + ' ms: ' + x.msg + (x.stack ? '\n    ' + x.stack.replace(/\n/g, '\n    ') : ''));
  return L.join('\n');
}
// errors from outside the app's own try blocks while the session lives: the device's uncaptured errors (added as a listener: three.js keeps its own onuncapturederror),
// the window's error / unhandledrejection (a throw inside three.js' XR frame callback lands there), three.js' own warn / error lines (setConsoleFunction; the previous one is put back).
// Returns stop().
export function watchGxErrors({ device = null, diag, win = globalThis, three = null }) {
  const offs = [];
  const on = (t, type, fn) => { try { t?.addEventListener?.(type, fn); offs.push(() => t.removeEventListener(type, fn)); } catch { /* none */ } };
  on(device, 'uncapturederror', ev => diag.error('gpu', ev));
  on(win, 'error', ev => diag.error('window', ev));
  on(win, 'unhandledrejection', ev => diag.error('promise', ev));
  if (three?.setConsoleFunction) {
    const prev = three.getConsoleFunction?.() ?? null;
    three.setConsoleFunction((type, message, ...params) => {
      if (type === 'warn' || type === 'error') diag.error('three-' + type, [message, ...params.map(p => (p && typeof p === 'object' ? (p.message || p.constructor?.name || '') : String(p)))].join(' '));
      if (prev) prev(type, message, ...params); else (console[type] || console.log)(message, ...params);
    });
    offs.push(() => three.setConsoleFunction(prev));
  }
  return () => { for (const f of offs.splice(0)) { try { f(); } catch { /* gone */ } } };
}
// the projection layer and the GPU side as the session sees them (read once the renderer has the session; nothing here throws)
export function gxSessionValues(renderer, session, device) {
  const v = {}, xr = renderer?.xr, t = (f, k) => { try { v[k] = f(); } catch (e) { v[k] = 'error: ' + gxErrorText(e).msg; } };
  t(() => [...(session.enabledFeatures || [])], 'enabledFeatures');
  t(() => (session.renderState?.layers || []).map(l => l?.constructor?.name || typeof l), 'renderStateLayers');
  t(() => !!session.renderState?.baseLayer, 'baseLayer');
  t(() => xr.getWebGPUBinding?.()?.getPreferredColorFormat?.() ?? null, 'preferredColorFormat');
  t(() => { const l = xr._glProjLayer; return l ? { w: l.textureWidth, h: l.textureHeight, layers: l.textureArrayLength, ignoreDepth: l.ignoreDepthValues, fixedFoveation: l.fixedFoveation ?? null } : null; }, 'projectionLayer');
  t(() => { const r = xr._xrRenderTarget; return r ? { w: r.width, h: r.height, depth: r.depth, samples: r.samples, depthBuffer: r.depthBuffer } : null; }, 'xrRenderTarget');
  t(() => renderer.outputColorSpace, 'outputColorSpace');
  t(() => renderer.currentColorSpace, 'currentColorSpace');
  t(() => renderer.needsFrameBufferTarget, 'needsFrameBufferTarget');
  t(() => renderer.samples, 'samples');
  t(() => renderer.backend?.compatibilityMode, 'compatibilityMode');
  t(() => [...(device?.features || [])].sort(), 'deviceFeatures');
  t(() => { const a = device?.adapterInfo; return a ? { vendor: a.vendor, architecture: a.architecture, device: a.device, description: a.description } : null; }, 'adapterInfo');
  t(() => navigator.gpu?.getPreferredCanvasFormat?.() ?? null, 'canvasFormat');
  return v;
}
// what the headset hands out for one posed frame: the sub image of each view (format, size, array layers, sample count, usage), its viewport and view descriptor
export function gxFrameValues(binding, layer, views) {
  const out = [];
  for (const view of views || []) {
    try {
      const s = binding.getViewSubImage(layer, view), c = s.colorTexture, vp = s.viewport;
      out.push({ eye: view.eye, format: c?.format, w: c?.width, h: c?.height, layers: c?.depthOrArrayLayers, samples: c?.sampleCount, dim: c?.dimension, usage: c?.usage, depthTex: !!s.depthStencilTexture,
        viewport: vp ? [vp.x, vp.y, vp.width, vp.height] : null, desc: s.getViewDescriptor ? s.getViewDescriptor() : null });
    } catch (e) { out.push({ eye: view?.eye, error: gxErrorText(e).msg }); }
  }
  return out;
}
// the way out that needs nothing drawn: both controllers' trigger (button 0) and grip (button 1) held together
export function gxEscapeHeld(sources) {
  let n = 0;
  for (const s of sources || []) { const b = s?.gamepad?.buttons; if (b?.[0]?.pressed && b?.[1]?.pressed) n++; }
  return n >= 2;
}
// a frame loop of its own on the session (independent of three.js and of the app's loop): counts the frames the headset gives and the posed ones,
// reads the sub images once (first posed frame after the renderer took the session), and ends the session
// (a) when the escape (gxEscapeHeld) is held for escapeMs, (b) when stallFrames frames came after the renderer took the session without one completed main render
// (counted in frames, not time: a long synchronous step brings no frames and is no stall). Before the renderer takes the session there is no layer and no frame comes (vr-view.js has a timer for that).
// state(): { bound, rendered, binding, layer, ref }, read each frame.
// E0: the frame's work is small. The record is no longer saved once a second: diag.flush() runs when the page or the headset session is hidden (visibilitychange on the document and on the session; the
// session's own end listener flushes at the end), the stage / error saves are unchanged. The pose is read each frame until the sub images are read; after that every poseEvery-th frame (counts.poses counts poseEvery
// for each pose seen then: the headset still gives poses), and the controllers are read for the escape at most once per escapePollMs (time, not frames: at a slow frame rate every frame still reads them).
// poseEvery 1 / escapePollMs 0 = every frame (as before). doc = where the page's visibilitychange comes from (null: none).
// The posed-frame hook (onFrame) may have a `done` property (vr-wgpu-caps.js capsFrameHook: the foveation check): while it is exactly false the pose is read and the hook called EVERY frame (the check, which runs
// in the first ~120 frames, ends in seconds), after it is true (or when the hook has no `done`, or there is no hook) the pose is read every poseEvery-th frame as above. stats = { poseReads, poseMs } (running totals:
// getViewerPose calls made here and the ms they took; the frame ring of docs/vr-bench.js reads the differences as the columns pz / pms); returned as hb.stats.
export const GX_POSE_EVERY = 16, GX_ESCAPE_POLL_MS = 50;
export function startGxHeartbeat({ session, diag, state, now = () => performance.now(), escapeMs = 2000, stallFrames = 720, onEnd = null, onFrame = null, saveOn = () => true, poseEvery = 1, escapePollMs = 0, doc = globalThis.document }) { // onFrame(frame, pose, s): the posed frames' hook (vr-wgpu-caps.js). saveOn(): false = no save when hidden either (an isolation run of the comparison bench); the default saves
  let alive = true, escAt = null, inspected = false, lastRendered = -1, stall = 0, ending = false, nf = 0, escPolled = -Infinity;
  const stats = { poseReads: 0, poseMs: 0 };
  const end = why => { if (ending) return; ending = true; diag.stage('auto-end', why); try { onEnd?.(why); } catch { /* the line is not worth a failure */ } try { session.end()?.catch?.(() => {}); } catch { /* ended */ } };
  const tick = (t, frame) => {
    if (!alive) return;
    try { session.requestAnimationFrame(tick); } catch { alive = false; return; }
    const s = state() || {};
    nf++;
    diag.count('xrFrames');
    const checking = !inspected || (onFrame !== null && onFrame.done === false); // the pose is read every frame: until the sub images are read, and while the foveation check (the hook) has not ended
    if (checking || nf % Math.max(1, poseEvery) === 0) {
      let pose = null;
      const p0 = now();
      try { if (s.ref) { pose = frame.getViewerPose(s.ref); stats.poseReads++; stats.poseMs += now() - p0; } } catch (e) { diag.error('pose', e); }
      if (pose) { const w = checking ? 1 : Math.max(1, poseEvery); diag.d.counts.poses = (diag.d.counts.poses | 0) + w; }
      if (pose && s.bound && !inspected && s.binding && s.layer) { inspected = true; diag.value('subImages', gxFrameValues(s.binding, s.layer, pose.views)); diag.stage('first posed frame (sub images read)'); }
      if (onFrame && pose && s.bound && s.binding && s.layer) { try { onFrame(frame, pose, s); } catch (e) { diag.error('frame-hook', e); } } // vr-wgpu-caps.js: the checks that run on the posed frames of the session's start (read in the frames that read the pose)
    }
    const n = now();
    if (n - escPolled >= escapePollMs) { // the controllers are read at most once per escapePollMs of time (0: every frame); a slow cadence still polls at each frame, so the hold is never judged later than escapeMs plus one frame
      escPolled = n;
      if (gxEscapeHeld(session.inputSources)) { if (escAt === null) escAt = n; else if (n - escAt >= escapeMs) end('escape held'); } else escAt = null;
    }
    const r = s.rendered | 0;
    if (r !== lastRendered) { lastRendered = r; stall = 0; } else if (s.bound) stall++;
    if (stall >= stallFrames) end(stall + ' frames without a completed main render');
  };
  // the page / the headset session is hidden: the record is saved in full now (the one save besides the stages' and errors' own). Removed by stop().
  const onHide = () => { try { if ((doc?.visibilityState === 'hidden' || session?.visibilityState === 'hidden') && saveOn()) diag.flush(); } catch { /* the save is best effort */ } };
  try { doc?.addEventListener?.('visibilitychange', onHide); } catch { /* none */ }
  try { session.addEventListener?.('visibilitychange', onHide); } catch { /* none */ }
  try { session.requestAnimationFrame(tick); } catch (e) { diag.error('heartbeat', e); }
  return { stats, stop() { alive = false; try { doc?.removeEventListener?.('visibilitychange', onHide); } catch { /* gone */ } try { session.removeEventListener?.('visibilitychange', onHide); } catch { /* gone */ } } };
}
// the compiler's messages of one WGSL module into the record (errors and warnings, the first few), keyed by its variant
export function gxShaderInfo(diag, module, v) {
  const key = v.cs ? 'wgsl cs ' + v.cs + (v.sg ? ' sg' : '') + (v.cls4 ? ' c4' : '') : v.coarse ? 'wgsl coarse ' + v.coarse + (v.cls4 ? ' c4' : ' c3') : v.proxyDiff ? 'wgsl proxy-diff' : v.proxy ? 'wgsl proxy ' + (v.cls4 ? 'c4' : 'c3') : 'wgsl ' + (v.f16 ? 'f16 ' : '') + (v.cls4 ? 'c4' : 'c3') + (v.events ? 'e' : 'n') + (v.abl ? ' abl-' + v.abl : '') + (v.counters ? ' counters' : '') + (v.spec ? ' spec' : ''); // the breakdown's variants have keys of their own (they must not replace the display variant's entry)
  const p = module?.getCompilationInfo?.();
  if (!p?.then) { diag.value(key, 'no getCompilationInfo'); return; }
  p.then(info => {
    const m = [...(info?.messages || [])].filter(x => x.type !== 'info');
    diag.value(key, m.length ? m.slice(0, 3).map(x => x.type + ' ' + x.lineNum + ':' + x.linePos + ' ' + clip(x.message, 200)) : 'ok');
    if (m.some(x => x.type === 'error')) diag.stage('WGSL compile error', key);
  }, e => diag.error('wgsl-info', e));
}
