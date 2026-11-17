// WebGPU side of the VR / AR volume (the WGSL core is vr-wgsl-core.js): the GPU device (an XR-compatible adapter), the textures made from the same arrays the WebGL session uses
// (the three.js Data3DTexture objects stay the holders of the data, a GPUTexture is made from one on first use and again when its version changes), the volume render pass per eye,
// the offscreen targets (colour + depth packed in rgba8, both eyes side by side, reduced scale and the periphery target), and the composite material (three.js NodeMaterial, TSL) that
// puts the offscreen image into the headset's frame with the volume's depth. Plain WebGPU; three.js (the WebGPU build) is passed in.
import { volumeWgsl, uniformLayout, BOX_VERTICES, VOLUME_BINDINGS } from './vr-wgsl-core.js?v=20261117-build739';

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

export function createVolumeGpu({ device, THREE, f16 = false, onTargetFreed = null }) {
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
  const makeModule = v => device.createShaderModule({ code: volumeWgsl({ f16, ...v }) });
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
  const TS_SLOTS = 6;
  const ts = device.features.has('timestamp-query') ? {
    qs: device.createQuerySet({ type: 'timestamp', count: 2 * TS_SLOTS }), resolve: device.createBuffer({ size: 256 * TS_SLOTS, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    slots: Array.from({ length: TS_SLOTS }, () => ({ buf: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false })), sumMs: 0, count: 0,
  } : null;
  const takeGpuMs = () => { if (!ts || !ts.count) return null; const r = { ms: ts.sumMs, n: ts.count }; ts.sumMs = 0; ts.count = 0; return r; };
  // one render pass into a target: every eye's viewport (x, y, w, h in target px) with its own uniforms. eyes[i] = { x, y, w, h, mvp, origin, lightOff }; variant = { cls4, events }
  const drawPass = (target, eyes, u, variant, slot0, overrides = null, readback = null) => {
    const enc = device.createCommandEncoder();
    const slot = ts && !overrides ? ts.slots.findIndex(x => !x.busy) : -1; // the probe (overrides) and a pass with no free slot are not timed
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
      pass.setScissorRect(e.x, e.y, e.w, e.h);
      pass.draw(36);
    });
    pass.end();
    if (readback) enc.copyTextureToBuffer({ texture: target.color }, { buffer: readback.buffer, bytesPerRow: readback.bytesPerRow }, [readback.w, readback.h, 1]);
    if (slot >= 0) { enc.resolveQuerySet(ts.qs, 2 * slot, 2, ts.resolve, 256 * slot); enc.copyBufferToBuffer(ts.resolve, 256 * slot, ts.slots[slot].buf, 0, 16); ts.slots[slot].busy = true; } // (a query resolve lands on a 256-byte offset)
    device.queue.submit([enc.finish()]);
    if (slot >= 0) {
      const sl = ts.slots[slot], isLow = slot0 === 0;
      sl.buf.mapAsync(GPUMapMode.READ).then(() => {
        const a = new BigUint64Array(sl.buf.getMappedRange().slice(0)); sl.buf.unmap();
        const ms = Number(a[1] - a[0]) / 1e6; if (ms >= 0 && ms < 1000) { ts.sumMs += ms; if (isLow) ts.count++; }
        sl.busy = false;
      }).catch(() => { sl.busy = false; });
    }
  };

  const dispose = () => {
    for (const t of pool) { t.color.destroy(); t.depth.destroy(); }
    pool.length = 0; boxBuf.destroy(); ubufs.forEach(b => b.destroy());
    for (const k of Object.keys(dummies)) dummies[k].destroy();
    if (ts) { try { ts.qs.destroy(); ts.resolve.destroy(); ts.slots.forEach(x => x.buf.destroy()); } catch { /* gone */ } }
  };
  return { device, f16, layout, warm, pipeFor, gpuOf, copySlab, initTexture, getTarget, drawPass, dispose, takeGpuMs, beginFrame, hasTimer: !!ts, poolSize: () => pool.length };
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
// TSL = THREE.TSL of the WebGPU build. The offscreen layout: eye i's image sits at x = i * stride (px of the target), scaled by `scale`; the periphery target (a lower scale, optional) is blended in outside the fovea rect.
export function createComposite({ THREE, halfExt = [1, 1, 1], device }) {
  const T = THREE.TSL, { sRGBTransferEOTF, Fn, uniform, texture, vec2, vec3, vec4, float, If, Discard, screenCoordinate, cameraIndex, clamp, min, max, select, positionLocal, mix } = T;
  const mkExt = () => { const t = new THREE.ExternalTexture(null); t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
  const mkNear = () => { const t = new THREE.ExternalTexture(null); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; };
  const u = {
    halfExt: uniform(new THREE.Vector3(...halfExt)),
    inv1: uniform(new THREE.Vector2(1, 1)), scale1: uniform(1), stride1: uniform(1), used1: uniform(new THREE.Vector2(1, 1)),
    inv2: uniform(new THREE.Vector2(1, 1)), scale2: uniform(1), stride2: uniform(1), used2: uniform(new THREE.Vector2(1, 1)),
    decode: uniform(0), // 1 = three.js encodes the frame to sRGB at the end (the headset pass): the volume's display values are decoded first, so they come out unchanged (the WebGL volume writes them raw)
    fovOn: uniform(0), rect0: uniform(new THREE.Vector4()), rect1: uniform(new THREE.Vector4()), band: uniform(1),
  };
  // before the first frame the nodes point at a 1 x 1 texture each (a binding needs a real GPUTexture)
  const blank = device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const first = near => { const t = near ? mkNear() : mkExt(); t.sourceTexture = blank; return t; };
  const blankExt = { c: first(false), d: first(true) }; // what a node falls back to when its target is let go (shared: a node's value is only ever compared by identity)
  const nodes = { c1: texture(first(false)), d1: texture(first(true)), c2: texture(first(false)), d2: texture(first(true)) };
  const eye = float(cameraIndex);
  const p = screenCoordinate.xy; // the pixel in the eye's own image (top-left origin)
  const uvOf = (inv, scale, stride, used) => { // the sampling coordinate in the offscreen target
    const x0 = eye.mul(stride), st = vec2(p.x.mul(scale).add(x0), p.y.mul(scale));
    return vec2(clamp(st.x, x0.add(0.5), x0.add(used.x)), min(st.y, used.y)).mul(inv);
  };
  const uv1 = uvOf(u.inv1, u.scale1, u.stride1, u.used1), uv2 = uvOf(u.inv2, u.scale2, u.stride2, u.used2);
  const rect = select(eye.greaterThan(0.5), u.rect1, u.rect0);
  const wt = clamp(min(min(p.x.sub(rect.x), p.y.sub(rect.y)), min(rect.z.sub(p.x), rect.w.sub(p.y))).div(u.band), 0, 1);
  const decode = c => c.r.mul(255 * 65536).add(c.g.mul(255 * 256)).add(c.b.mul(255)).div(16777215);
  const colorNode = Fn(() => {
    const c1 = nodes.c1.sample(uv1).toVar();
    const out = vec4(c1).toVar();
    If(u.fovOn.greaterThan(0.5).and(wt.lessThan(1)), () => {
      const c2 = nodes.c2.sample(uv2);
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
  // one frame's parameters: low / peri = { target (getTarget), scale, stride, usedW, usedH }
  const update = ({ low, peri = null, fov = false, rects = null, band = 1, decode = false }) => {
    u.decode.value = decode ? 1 : 0;
    nodes.c1.value = extOf(low.target.color, false); nodes.d1.value = extOf(low.target.depth, true);
    if (!(fov && peri)) { nodes.c2.value = nodes.c1.value; nodes.d2.value = nodes.d1.value; } // no periphery pass this frame: the second pair is the first one's (it must not keep pointing at a target that may be let go of)
    u.inv1.value.set(1 / low.target.w, 1 / low.target.h); u.scale1.value = low.scale; u.stride1.value = low.stride; u.used1.value.set(low.usedW - 0.5, low.usedH - 0.5);
    u.fovOn.value = fov && peri ? 1 : 0;
    if (fov && peri) {
      nodes.c2.value = extOf(peri.target.color, false); nodes.d2.value = extOf(peri.target.depth, true);
      u.inv2.value.set(1 / peri.target.w, 1 / peri.target.h); u.scale2.value = peri.scale; u.stride2.value = peri.stride; u.used2.value.set(peri.usedW - 0.5, peri.usedH - 0.5);
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
// (a second target at scale fp, outside the centre rect), rects = the centre rect per eye in px of the eye image, y up (vr-render-scale.js foveaRect), band = the blend band in px.
export function createVrVolumeRenderer({ THREE, device, f16 = false, halfExt = [1, 1, 1] }) {
  const composite = createComposite({ THREE, halfExt, device });
  const volume = createVolumeGpu({ device, THREE, f16, onTargetFreed: t => composite.forget(t.color, t.depth) });
  const tmpEye = [{}, {}], tmpPeri = [{}, {}];
  const stats = { w: 0, h: 0, lowW: 0, lowH: 0 };
  const variantOf = u => ({ cls4: !!u.cls4Tex?.value?.isData3DTexture && u.cls4Tex.value.image?.width > 1, events: (u.planeCount?.value | 0) > 0 });
  let probeBuf = null;
  const draw = ({ u, cams, model, f, fov = false, fp = f, rects = null, band = 1, variant = null, decode = false }) => {
    volume.beginFrame();
    const n = Math.min(2, cams.length);
    const v0 = cams[0].viewport, W = Math.max(1, Math.round(v0.z)), H = Math.max(1, Math.round(v0.w));
    const vr = variant || variantOf(u);
    const pass = (scale, bucket, scissors) => {
      const Wu = Math.max(1, Math.ceil(W * scale)), Hu = Math.max(1, Math.ceil(H * scale)), stride = Wu + 2;
      const target = volume.getTarget(stride * n, Hu);
      const eyes = [];
      for (let i = 0; i < n; i++) {
        const e = eyeUniforms(THREE, model, cams[i], bucket[i]);
        const vx = i * stride, vy = 0; // the viewport is the whole eye's image (the same mapping as the periphery pass and as the WebGL pass); only the scissor is the centre rect
        let x = vx, y = vy, w = Wu, h = Hu;
        if (scissors) { // the centre rect only (1 px margin for the bilinear upscale), image px, y flipped to the top-left origin
          const R = scissors[i] || scissors[0], x0 = Math.max(0, Math.floor(R[0] * scale) - 1), x1 = Math.min(Wu, Math.ceil(R[2] * scale) + 1);
          const y0 = Math.max(0, Math.floor((H - R[3]) * scale) - 1), y1 = Math.min(Hu, Math.ceil((H - R[1]) * scale) + 1);
          x += x0; y = y0; w = Math.max(1, x1 - x0); h = Math.max(1, y1 - y0);
        }
        eyes.push({ x, y, w, h, vx, vy, vw: Wu, vh: Hu, mvp: e.mvp, origin: e.origin, lightOff: e.lightOff });
      }
      return { target, eyes, scale, stride, usedW: Wu, usedH: Hu };
    };
    const low = pass(f, tmpEye, fov ? rects : null);
    volume.drawPass(low.target, low.eyes, u, vr, 0);
    let peri = null;
    if (fov) { peri = pass(fp, tmpPeri, null); volume.drawPass(peri.target, peri.eyes, u, vr, 2); }
    const topLeft = rects ? rects.map(R => [R[0], H - R[3], R[2], H - R[1]]) : null;
    composite.update({ low, peri, fov, rects: topLeft, band, decode });
    stats.w = W; stats.h = H; stats.lowW = low.usedW; stats.lowH = low.usedH;
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
