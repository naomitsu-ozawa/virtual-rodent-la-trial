// WebGPU side of the VR / AR volume (the WGSL core is vr-wgsl-core.js): the GPU device (an XR-compatible adapter), the textures made from the same arrays the WebGL session uses
// (the three.js Data3DTexture objects stay the holders of the data, a GPUTexture is made from one on first use and again when its version changes), the volume render pass per eye,
// the offscreen targets (colour + depth packed in rgba8, both eyes side by side, reduced scale and the periphery target), and the composite material (three.js NodeMaterial, TSL) that
// puts the offscreen image into the headset's frame with the volume's depth. Plain WebGPU; three.js (the WebGPU build) is passed in.
import { volumeWgsl, uniformLayout, BOX_VERTICES, VOLUME_BINDINGS } from './vr-wgsl-core.js?v=20261118-build748';

export const VRGPU_STORE_KEY = 'vrl-vr-gpu';
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
// the device is lost for another reason than our own destroy(): onLost(info) once
export function watchDeviceLost(device, onLost) { device?.lost?.then(info => { if (info?.reason !== 'destroyed') onLost(info); }); }

// an XR-compatible adapter and a device with the optional features this renderer can use (shader-f16 for the half-precision march, timestamp-query for the volume pass time)
export async function requestVrGpuDevice() {
  if (!vrGpuAvailable()) throw new Error('WebGPU XR is not available (no navigator.gpu or XRGPUBinding)');
  const adapter = await navigator.gpu.requestAdapter({ xrCompatible: true });
  if (!adapter) throw new Error('no WebGPU adapter that can be used in XR (xrCompatible)');
  const want = ['shader-f16', 'timestamp-query', 'float32-filterable'].filter(f => adapter.features.has(f));
  let device;
  try { device = await adapter.requestDevice({ requiredFeatures: want }); } catch { device = await adapter.requestDevice(); want.length = 0; }
  return { adapter, device, f16: device.features.has('shader-f16'), timestamps: device.features.has('timestamp-query') };
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

export function createVolumeGpu({ device, THREE, f16 = false, onTargetFreed = null, onShader = null }) {
  const layout = uniformLayout();
  const bgl = device.createBindGroupLayout({ entries: [
    { binding: VOLUME_BINDINGS.uniforms, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ...[VOLUME_BINDINGS.vol, VOLUME_BINDINGS.cls, VOLUME_BINDINGS.cls4, VOLUME_BINDINGS.edit, VOLUME_BINDINGS.slice].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } })),
    { binding: VOLUME_BINDINGS.skip, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint', viewDimension: '3d' } },
    { binding: VOLUME_BINDINGS.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: VOLUME_BINDINGS.samplerEdit, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
  ] });
  const pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const nearest = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const boxBuf = device.createBuffer({ size: BOX_VERTICES.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(boxBuf, 0, BOX_VERTICES);
  const ubufs = [0, 1, 2, 3].map(() => device.createBuffer({ size: layout.byteSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const uAb = new ArrayBuffer(layout.byteSize), uF = new Float32Array(uAb), uI = new Int32Array(uAb);
  const pipes = new Map(), pipePending = new Map();
  const makeModule = v => { const m = device.createShaderModule({ code: volumeWgsl({ f16, ...v }) }); try { onShader?.(m, { f16, ...v }); } catch { /* diagnostics only */ } return m; }; // onShader: the session's diagnostics read the compiler's messages
  const pipeDesc = v => {
    const module = makeModule(v);
    return { layout: pipeLayout, vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' } };
  };
  const vkey = v => (v.cls4 ? 'c4' : 'c3') + (v.events ? 'e' : 'n');
  // compiled ahead (the session start waits for these): the four variants a session can ask for (four stored segments x a section on or off)
  const warm = async (variants = [{ cls4: false, events: false }, { cls4: false, events: true }]) => {
    await Promise.all(variants.map(async v => { const k = vkey(v); if (!pipes.has(k)) { const p = await device.createRenderPipelineAsync(pipeDesc(v)); pipes.set(k, p); } }));
  };
  const pipeFor = v => { const k = vkey(v); let p = pipes.get(k); if (!p) { p = device.createRenderPipeline(pipeDesc(v)); pipes.set(k, p); } return p; }; // an unexpected variant compiles on the spot (a hitch, once)

  // ---- textures made from three.js Data3DTexture objects ----
  const entries = new WeakMap();
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
  const writeRange = (e, data, z0, z1) => {
    const rowBytes = e.w * e.bpp, sliceBytes = rowBytes * e.h, per = Math.max(1, Math.floor(CHUNK_BYTES / sliceBytes));
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let z = z0; z < z1; z += per) {
      const n = Math.min(per, z1 - z);
      device.queue.writeTexture({ texture: e.gpu, origin: [0, 0, z] }, bytes.subarray(z * sliceBytes, (z + n) * sliceBytes), { bytesPerRow: rowBytes, rowsPerImage: e.h }, [e.w, e.h, n]);
    }
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
      tex.addEventListener('dispose', () => { const x = entries.get(tex); if (x) { dropGroups(x.gpu); x.gpu.destroy(); entries.delete(tex); } });
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
    writeRange(e, data, box.min.z, box.max.z);
  };
  const initTexture = tex => { gpuOf(tex); };

  // ---- offscreen targets: a pool keyed by size (a few sizes over a session; the scale changes by steps), colour + packed depth ----
  const pool = [];
  let frameNo = 0; // a target used in this frame is never let go in it
  const beginFrame = () => { frameNo++; };
  const getTarget = (w, h) => {
    const W = upTo(w, 64), H = upTo(h, 64);
    let t = pool.find(x => x.w === W && x.h === H);
    if (!t) {
      const mk = () => device.createTexture({ size: [W, H, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      t = { w: W, h: H, color: mk(), depth: mk(), stamp: 0 };
      t.colorView = t.color.createView(); t.depthView = t.depth.createView();
      pool.push(t);
      // the least recently used sizes go first while the pool holds more than ~200 MB (colour + packed depth, 4 + 4 bytes a texel) or 8 sizes; the one just made and the last used stay
      const bytes = x => x.w * x.h * 8;
      while (pool.length > 2 && (pool.length > 8 || pool.reduce((a, x) => a + bytes(x), 0) > (200 << 20))) { const old = pool.filter(x => x !== t && x.frame !== frameNo).sort((a, b) => a.stamp - b.stamp)[0]; if (!old) break; pool.splice(pool.indexOf(old), 1); onTargetFreed?.(old); old.color.destroy(); old.depth.destroy(); old.dead = true; }
    }
    t.stamp = performance.now(); t.frame = frameNo;
    return t;
  };

  // ---- the uniforms ----
  const put = (fd, v) => {
    if (v === undefined || v === null) return;
    const at = fd.offset / 4, F = fd.k === 'f' ? uF : uI;
    if (fd.count) {
      for (let i = 0; i < fd.count; i++) { const it = v[i]; if (!it) continue; const b = at + i * fd.stride / 4; F[b] = it.x ?? it[0] ?? 0; F[b + 1] = it.y ?? it[1] ?? 0; if (fd.n > 2) { F[b + 2] = it.z ?? it[2] ?? 0; F[b + 3] = it.w ?? it[3] ?? 0; } }
    } else if (fd.n === 1) F[at] = +v;
    else if (fd.n === 16) { const m = v.elements || v; for (let i = 0; i < 16; i++) F[at + i] = m[i]; }
    else { F[at] = v.x ?? v[0] ?? 0; F[at + 1] = v.y ?? v[1] ?? 0; if (fd.n > 2) F[at + 2] = v.z ?? v[2] ?? 0; if (fd.n > 3) F[at + 3] = v.w ?? v[3] ?? 0; }
  };
  const packUniforms = (u, extra, index) => {
    uF.fill(0);
    for (const fd of layout.fields) put(fd, fd.name in extra ? extra[fd.name] : u[fd.name]?.value);
    device.queue.writeBuffer(ubufs[index], 0, uAb);
  };

  // the bind group of the textures in use (rebuilt when one of them is another GPUTexture)
  const groups = new Map();
  const bindGroup = (index, u) => {
    const tv = (t, kind) => (gpuOf(t) || dummy(kind));
    const tex = [tv(u.vol?.value, 'f'), tv(u.clsTex?.value, 'f'), tv(u.cls4Tex?.value, 'f'), tv(u.skipTex?.value, 'uint'), tv(u.editTex?.value, 'f'), tv(u.sliceVol?.value, 'f')];
    const editNearest = u.editTex?.value?.minFilter === THREE.NearestFilter;
    const ids = tex.map(t => { if (!t.__id) t.__id = ++idSeq; return t.__id; }).join('.') + (editNearest ? 'n' : 'l') + ':' + index;
    let g = groups.get(ids)?.g;
    if (!g) {
      if (groups.size > 32) groups.clear();
      g = device.createBindGroup({ layout: bgl, entries: [
        { binding: VOLUME_BINDINGS.uniforms, resource: { buffer: ubufs[index] } },
        ...[VOLUME_BINDINGS.vol, VOLUME_BINDINGS.cls, VOLUME_BINDINGS.cls4, VOLUME_BINDINGS.skip, VOLUME_BINDINGS.edit, VOLUME_BINDINGS.slice].map((binding, i) => ({ binding, resource: tex[i].createView({ dimension: '3d' }) })),
        { binding: VOLUME_BINDINGS.sampler, resource: linear }, { binding: VOLUME_BINDINGS.samplerEdit, resource: editNearest ? nearest : linear },
      ] });
      groups.set(ids, { g, ids: tex.map(t => t.__id) });
    }
    return g;
  };
  let idSeq = 0;
  // a GPUTexture that is destroyed is in no cached bind group any more
  const dropGroups = gpuTex => { const id = gpuTex?.__id; if (!id) return; for (const [k, v] of groups) if (v.ids.includes(id)) groups.delete(k); };

  // the GPU time of the volume pass (timestamp-query, when the device has it): a few slots, each read back a frame or two later; takeGpuMs() = { ms, n } summed over the frames since the last call
  // The same slots give the frame's GPU timeline (performance record only): per XR frame the first volume pass's start and the end of a marker pass that markFrame() submits after the frame's last submit
  // (tiny render pass, no draw). span = marker end - first start; gap = first start - the previous frame's marker end (the GPU idle between two frames). All values are this device's own timestamps (one clock);
  // three.js' own timestamps (trackTimestamp) are durations only and are not placed on this clock. takeFrameStats() = { gaps, spans } in ms since the last call.
  const TS_SLOTS = 12; // per frame: up to 2 volume passes + the marker; a result is read back a frame or two later
  const ts = device.features.has('timestamp-query') ? {
    qs: device.createQuerySet({ type: 'timestamp', count: 2 * TS_SLOTS }), resolve: device.createBuffer({ size: 256 * TS_SLOTS, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    slots: Array.from({ length: TS_SLOTS }, () => ({ buf: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false })), sumMs: 0, count: 0,
    markTex: device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    seq: 0, cur: null, q: [], prev: null, gaps: [], spans: [],
  } : null;
  const newRec = () => ({ id: ++ts.seq, pend: 0, vols: 0, b: null, e: null, bad: false, closed: false, vpend: 0, vms: 0, vbad: false, vcb: null }); // one XR frame: b = first start, e = last end (BigInt ticks, ns), pend = readbacks still to come
  if (ts) ts.cur = newRec();
  // the frames whose readbacks are all in, oldest first: a frame with every timestamp valid gives its span; its gap needs the frame before it to be valid too
  const finishFrames = () => {
    while (ts.q.length && ts.q[0].closed && ts.q[0].pend === 0) {
      const r = ts.q.shift();
      if (r.bad || r.vols === 0 || r.b === null || r.e === null || r.e < r.b) { ts.prev = null; continue; }
      const span = Number(r.e - r.b) / 1e6;
      if (!(span < 1000)) { ts.prev = null; continue; }
      ts.spans.push(span);
      if (ts.prev && ts.prev.id === r.id - 1) { const g = Number(r.b - ts.prev.e) / 1e6; if (g > -5 && g < 1000) ts.gaps.push(g); }
      ts.prev = r;
    }
  };
  // read one slot back: rec = the frame it belongs to; marker = its end only counts (the begin of the marker is not work); onMs(ms) = the pass duration
  const readSlot = (slot, rec, marker, onMs) => {
    const sl = ts.slots[slot];
    sl.buf.mapAsync(GPUMapMode.READ).then(() => {
      const a = new BigUint64Array(sl.buf.getMappedRange().slice(0)); sl.buf.unmap();
      onMs?.(Number(a[1] - a[0]) / 1e6);
      if (a[0] === 0n || a[1] < a[0]) rec.bad = true;
      else { if (!marker && (rec.b === null || a[0] < rec.b)) rec.b = a[0]; if (rec.e === null || a[1] > rec.e) rec.e = a[1]; }
      rec.pend--; sl.busy = false; finishFrames();
    }).catch(() => { rec.bad = true; rec.pend--; sl.busy = false; finishFrames(); });
  };
  // the volume passes of one XR frame have all been read back (performance record only): volDone is called per pass; the callback of onFrameVolMs gets the frame's volume GPU ms (the sum of its passes, as the vol column)
  const volDone = rec => { if (--rec.vpend > 0 || !rec.vcb) return; const cb = rec.vcb; rec.vcb = null; if (!rec.vbad) cb(rec.vms); };
  // cb(ms) once the volume passes drawn so far in the CURRENT frame (call after draw(), before markFrame()) have been read back; never called without a timer, when a pass was not timed or a read-back failed
  const onFrameVolMs = cb => { if (!ts || !ts.cur || ts.cur.vpend === 0 || ts.cur.bad) return; ts.cur.vcb = cb; };
  const takeGpuMs = () => { if (!ts || !ts.count) return null; const r = { ms: ts.sumMs, n: ts.count }; ts.sumMs = 0; ts.count = 0; return r; };
  const takeFrameStats = () => { if (!ts || !(ts.spans.length || ts.gaps.length)) return null; const r = { gaps: ts.gaps, spans: ts.spans }; ts.gaps = []; ts.spans = []; return r; };
  // the end of this XR frame's GPU work (call after the frame's last submit, three.js' main render included): closes the frame record with a marker pass. No volume pass in the frame (nothing drawn) = no sample.
  const markFrame = () => {
    if (!ts) return;
    const rec = ts.cur; ts.cur = newRec();
    ts.q.push(rec); if (ts.q.length > 16) { ts.q.shift(); ts.prev = null; }
    const slot = rec.vols > 0 ? ts.slots.findIndex(x => !x.busy) : -1;
    if (slot < 0) { if (rec.vols > 0) rec.bad = true; rec.closed = true; finishFrames(); return; }
    const enc = device.createCommandEncoder();
    enc.beginRenderPass({ timestampWrites: { querySet: ts.qs, beginningOfPassWriteIndex: 2 * slot, endOfPassWriteIndex: 2 * slot + 1 }, colorAttachments: [{ view: ts.markTex.createView(), loadOp: 'clear', storeOp: 'discard', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] }).end();
    enc.resolveQuerySet(ts.qs, 2 * slot, 2, ts.resolve, 256 * slot); enc.copyBufferToBuffer(ts.resolve, 256 * slot, ts.slots[slot].buf, 0, 16);
    ts.slots[slot].busy = true; rec.pend++; rec.closed = true;
    device.queue.submit([enc.finish()]);
    readSlot(slot, rec, true, null);
  };
  // one render pass into a target: every eye's viewport (vx, vy, vw, vh in target px; x, y, w, h when absent) with its own uniforms, drawn once per scissor rect (e.scissors, else x, y, w, h).
  // eyes[i] = { x, y, w, h, vx, vy, vw, vh, scissors, mvp, origin, lightOff }; variant = { cls4, events }
  const drawPass = (target, eyes, u, variant, slot0, overrides = null, readback = null) => {
    const enc = device.createCommandEncoder();
    const slot = ts && !overrides ? ts.slots.findIndex(x => !x.busy) : -1; // the probe (overrides) and a pass with no free slot are not timed
    const rec = ts && !overrides ? ts.cur : null; // the frame this pass belongs to (a pass that is not timed makes the frame's span / gap unusable)
    if (rec && slot < 0) rec.bad = true;
    const pass = enc.beginRenderPass({ ...(slot >= 0 ? { timestampWrites: { querySet: ts.qs, beginningOfPassWriteIndex: 2 * slot, endOfPassWriteIndex: 2 * slot + 1 } } : {}), colorAttachments: [
      { view: target.colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: target.depthView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    ] });
    pass.setPipeline(pipeFor(variant));
    pass.setVertexBuffer(0, boxBuf);
    const jumpOn = (u.distInCls?.value > 0 && u.useCls?.value > 0 && (u.diag?.value | 0) !== 4) ? 1 : 0;
    eyes.forEach((e, i) => {
      packUniforms(u, { mvp: e.mvp, origin: e.origin, lightOff: e.lightOff, jumpOn, useSkip: (u.diag?.value | 0) === 4 ? 0 : u.useSkip?.value | 0, ...overrides }, slot0 + i);
      pass.setBindGroup(0, bindGroup(slot0 + i, u));
      pass.setViewport(e.vx ?? e.x, e.vy ?? e.y, e.vw ?? e.w, e.vh ?? e.h, 0, 1);
      for (const sc of e.scissors || [[e.x, e.y, e.w, e.h]]) { pass.setScissorRect(sc[0], sc[1], sc[2], sc[3]); pass.draw(36); } // e.scissors: several rects (the periphery's bands), each inside the target
    });
    pass.end();
    if (readback) enc.copyTextureToBuffer({ texture: target.color }, { buffer: readback.buffer, bytesPerRow: readback.bytesPerRow }, [readback.w, readback.h, 1]);
    if (slot >= 0) { enc.resolveQuerySet(ts.qs, 2 * slot, 2, ts.resolve, 256 * slot); enc.copyBufferToBuffer(ts.resolve, 256 * slot, ts.slots[slot].buf, 0, 16); ts.slots[slot].busy = true; rec.pend++; rec.vols++; rec.vpend++; } // (a query resolve lands on a 256-byte offset)
    device.queue.submit([enc.finish()]);
    if (slot >= 0) {
      const isLow = slot0 === 0;
      readSlot(slot, rec, false, ms => { if (ms >= 0 && ms < 1000) { ts.sumMs += ms; rec.vms += ms; if (isLow) ts.count++; } else rec.vbad = true; volDone(rec); });
    }
  };

  const dispose = () => {
    for (const t of pool) { t.color.destroy(); t.depth.destroy(); }
    pool.length = 0; boxBuf.destroy(); ubufs.forEach(b => b.destroy());
    for (const k of Object.keys(dummies)) dummies[k].destroy();
    if (ts) { try { ts.qs.destroy(); ts.resolve.destroy(); ts.slots.forEach(x => x.buf.destroy()); ts.markTex.destroy(); } catch { /* gone */ } }
  };
  return { device, f16, layout, warm, pipeFor, gpuOf, copySlab, initTexture, getTarget, drawPass, dispose, takeGpuMs, takeFrameStats, onFrameVolMs, markFrame, beginFrame, hasTimer: !!ts, poolSize: () => pool.length };
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
  // one frame's parameters: low / peri = { target (getTarget), scale, stride, regs: [[x0, y0, w, h] of the left eye, of the right eye] (px of the scaled image) }. Without regs the region is the whole image (usedW x usedH), as before.
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
// the centre rect) into a target of that size, in steps (bucketSize); without boxes the whole eye image, as before.
export function createVrVolumeRenderer({ THREE, device, f16 = false, halfExt = [1, 1, 1], onShader = null }) {
  const composite = createComposite({ THREE, halfExt, device });
  const volume = createVolumeGpu({ device, THREE, f16, onShader, onTargetFreed: t => composite.forget(t.color, t.depth) });
  const tmpEye = [{}, {}], tmpPeri = [{}, {}];
  const stats = { w: 0, h: 0, lowW: 0, lowH: 0, regions: null };
  const held = { low: null, peri: null }; // the slot size of each pass (fitSlot keeps it while the need stays near it)
  const variantOf = u => ({ cls4: !!u.cls4Tex?.value?.isData3DTexture && u.cls4Tex.value.image?.width > 1, events: (u.planeCount?.value | 0) > 0 });
  let probeBuf = null;
  const okRect = b => b && Number.isFinite(b.x0) && Number.isFinite(b.y0) && Number.isFinite(b.x1) && Number.isFinite(b.y1);
  const draw = ({ u, cams, model, f, fov = false, fp = f, rects = null, band = 1, variant = null, decode = false, boxes = null }) => {
    volume.beginFrame();
    const n = Math.min(2, cams.length);
    const v0 = cams[0].viewport, W = Math.max(1, Math.round(v0.z)), H = Math.max(1, Math.round(v0.w));
    const vr = variant || variantOf(u);
    const fovOn = !!(fov && rects);
    const wholeEye = [0, 0, W, H];
    const boxOf = i => (okRect(boxes?.[i]) ? [boxes[i].x0, boxes[i].y0, boxes[i].x1, boxes[i].y1] : wholeEye);
    const rectOf = i => rects[i] || rects[0];
    // one pass: want(i) = the y-up rect of eye i to cover, inner(i) = a y-up rect not drawn (or null), at `scale`
    const pass = (name, scale, bucket, want, inner, shrink) => {
      const Wu = Math.max(1, Math.ceil(W * scale)), Hu = Math.max(1, Math.ceil(H * scale));
      const regs = [], regions = [];
      let needW = 1, needH = 1;
      for (let i = 0; i < n; i++) { const r = scaledRegion(want(i), H, scale, Wu, Hu); regions.push(r); needW = Math.max(needW, r.x1 - r.x0); needH = Math.max(needH, r.y1 - r.y0); }
      const slotW = fitSlot(needW, held[name]?.w, Wu), slotH = fitSlot(needH, held[name]?.h, Hu);
      held[name] = { w: slotW, h: slotH };
      const stride = slotW + 2;
      const target = volume.getTarget(stride * n, slotH);
      const eyes = [];
      for (let i = 0; i < n; i++) {
        const e = eyeUniforms(THREE, model, cams[i], bucket[i]), r = regions[i], rw = r.x1 - r.x0, rh = r.y1 - r.y0;
        const mvp = regionMvp(bucket[i].rmvp ||= new THREE.Matrix4(), e.mvp, regionClip(r, Wu, Hu)); // the region of the eye's image fills the viewport below (the same pixels as the whole image would have; the depth is unchanged)
        const vx = i * stride;
        eyes.push({ x: vx, y: 0, w: rw, h: rh, vx, vy: 0, vw: rw, vh: rh, scissors: bandRects(r, inner?.(i) ?? null, H, scale, shrink).map(c => [vx + c[0], c[1], c[2], c[3]]), mvp, origin: e.origin, lightOff: e.lightOff });
        regs.push([r.x0, r.y0, rw, rh]);
      }
      return { target, eyes, scale, stride, regs, usedW: slotW, usedH: slotH };
    };
    // the centre (or the whole picture): the box's rect, in the fovea mode only its part inside the centre rect
    const low = pass('low', f, tmpEye, i => (fovOn ? rectsMeet(boxOf(i), rectOf(i)) : boxOf(i)), null, 0);
    volume.drawPass(low.target, low.eyes, u, vr, 0);
    let peri = null;
    if (fovOn) { // the periphery: the box's rect at the lower scale, only outside the centre rect shrunk by the blend band (what the composite reads from it) and the bilinear margin
      peri = pass('peri', fp, tmpPeri, boxOf, i => rectOf(i), band + Math.ceil(2 / Math.max(fp, 0.05)) + 1);
      volume.drawPass(peri.target, peri.eyes, u, vr, 2);
    }
    const topLeft = fovOn ? rects.map(R => [R[0], H - R[3], R[2], H - R[1]]) : null;
    composite.update({ low, peri, fov: fovOn, rects: topLeft, band, decode });
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
      volume.drawPass(target, [{ x: 0, y: 0, w: 48, h: 48, mvp: e.mvp, origin: e.origin, lightOff: e.lightOff }], u, variantOf(u), 3, { diag: 5 }, probeBuf);
      await probeBuf.buffer.mapAsync(GPUMapMode.READ);
      const raw = new Uint8Array(probeBuf.buffer.getMappedRange()), out = new Uint8Array(48 * 48 * 4);
      for (let y = 0; y < 48; y++) out.set(raw.subarray(y * 256, y * 256 + 192), y * 192);
      probeBuf.buffer.unmap();
      return out;
    } finally { probeBuf.busy = false; }
  };
  // every texture the uniforms point at goes to the GPU now (not on the first drawn frame); the programs are made too
  const preload = async (u, variants) => {
    for (const k of ['vol', 'clsTex', 'cls4Tex', 'skipTex', 'editTex', 'sliceVol']) volume.gpuOf(u[k]?.value);
    await volume.warm(variants);
  };
  const dispose = () => { composite.dispose(); volume.dispose(); try { probeBuf?.buffer.destroy(); } catch { /* gone */ } };
  return { volume, composite, draw, probe, preload, dispose, material: composite.material, stats };
}

// ---- the WebGPU session's diagnostic record (the trial: what happened in a session the headset showed black) ----
// Bounded: the stages (start, device, layer, first frame, ...), a few counters (no string per frame), the first distinct errors with their stack and how often each came,
// the values a black view depends on (formats, colour spaces, layer size). Mirrored to localStorage on every stage / error and once a second (heartbeat), shown on the page after the session.
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
  const save = () => { try { store?.setItem(GX_DIAG_KEY, JSON.stringify(d)); } catch { /* private window / full */ } };
  const stage = (name, info) => {
    if (d.stages.length >= maxStages) d.stages.splice(8, 1); // the first ones (the start) and the latest stay
    const s = { at: ms(), name }; if (info !== undefined) s.info = clip(typeof info === 'string' ? info : JSON.stringify(info), 300);
    d.stages.push(s); save();
  };
  const value = (k, v) => { d.values[k] = v; save(); };
  const error = (kind, e) => {
    const { msg, stack } = gxErrorText(e), key = kind + '|' + msg;
    const hit = d.errors.find(x => x.key === key);
    if (hit) { hit.n++; hit.last = ms(); return; } // a repeat is saved with the next stage / the heartbeat's once-a-second save
    if (d.errors.length < maxErrors) d.errors.push({ key, kind, msg, stack, n: 1, at: ms(), last: ms() }); else d.dropped++;
    save();
  };
  const count = k => { d.counts[k] = (d.counts[k] | 0) + 1; };
  return { d, stage, value, error, count, flush: save, ms };
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
// reads the sub images once (first posed frame after the renderer took the session), saves the record once a second, and ends the session
// (a) when the escape (gxEscapeHeld) is held for escapeMs, (b) when stallFrames frames came after the renderer took the session without one completed main render
// (counted in frames, not time: a long synchronous step brings no frames and is no stall). Before the renderer takes the session there is no layer and no frame comes (vr-view.js has a timer for that).
// state(): { bound, rendered, binding, layer, ref }, read each frame.
export function startGxHeartbeat({ session, diag, state, now = () => performance.now(), escapeMs = 2000, stallFrames = 720, onEnd = null }) {
  let alive = true, lastSave = now(), escAt = null, inspected = false, lastRendered = -1, stall = 0, ending = false;
  const end = why => { if (ending) return; ending = true; diag.stage('auto-end', why); try { onEnd?.(why); } catch { /* the line is not worth a failure */ } try { session.end()?.catch?.(() => {}); } catch { /* ended */ } };
  const tick = (t, frame) => {
    if (!alive) return;
    try { session.requestAnimationFrame(tick); } catch { alive = false; return; }
    const n = now(), s = state() || {};
    diag.count('xrFrames');
    let pose = null;
    try { if (s.ref) pose = frame.getViewerPose(s.ref); } catch (e) { diag.error('pose', e); }
    if (pose) diag.count('poses');
    if (pose && s.bound && !inspected && s.binding && s.layer) { inspected = true; diag.value('subImages', gxFrameValues(s.binding, s.layer, pose.views)); diag.stage('first posed frame (sub images read)'); }
    if (gxEscapeHeld(session.inputSources)) { if (escAt === null) escAt = n; else if (n - escAt >= escapeMs) end('escape held'); } else escAt = null;
    const r = s.rendered | 0;
    if (r !== lastRendered) { lastRendered = r; stall = 0; } else if (s.bound) stall++;
    if (stall >= stallFrames) end(stall + ' frames without a completed main render');
    if (n - lastSave >= 1000) { lastSave = n; diag.flush(); }
  };
  try { session.requestAnimationFrame(tick); } catch (e) { diag.error('heartbeat', e); }
  return { stop() { alive = false; } };
}
// the compiler's messages of one WGSL module into the record (errors and warnings, the first few), keyed by its variant
export function gxShaderInfo(diag, module, v) {
  const key = 'wgsl ' + (v.f16 ? 'f16 ' : '') + (v.cls4 ? 'c4' : 'c3') + (v.events ? 'e' : 'n');
  const p = module?.getCompilationInfo?.();
  if (!p?.then) { diag.value(key, 'no getCompilationInfo'); return; }
  p.then(info => {
    const m = [...(info?.messages || [])].filter(x => x.type !== 'info');
    diag.value(key, m.length ? m.slice(0, 3).map(x => x.type + ' ' + x.lineNum + ':' + x.linePos + ' ' + clip(x.message, 200)) : 'ok');
    if (m.some(x => x.type === 'error')) diag.stage('WGSL compile error', key);
  }, e => diag.error('wgsl-info', e));
}
