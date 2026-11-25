// A recording WebGPU device and a fixed scenario (preload, three draws, the breakdown's begin / end, dispose) for docs/vr-wgpu.js: the unit tests pin the display's device calls to the log of with this
// (tests/unit/fixtures/vr-wgpu-display-off-calls.json), so a change that makes the display touch the GPU differently while the new ways' switches are off shows up as a line that differs.
// CI has no GPU: everything here is plain objects. The log is a list of short strings in the order of the calls; objects are named by kind and creation order (tex#3, buf#7, ...).
import { createHash } from 'node:crypto';
import * as THREEG from 'three/webgpu';

export const GPU_GLOBALS = { GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }, GPUBufferUsage: { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 }, GPUTextureUsage: { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }, GPUMapMode: { READ: 1 } };
export const sha16 = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const bytesOf = d => (ArrayBuffer.isView(d) ? Buffer.from(d.buffer, d.byteOffset, d.byteLength) : Buffer.from(d)); // the data of a write (typed array or buffer): hashed, so the log pins the contents too

// echo (the same-picture check's read-back): the comparison counters the mock hands back: { body (pixels with alpha, default 5000), badNonce (hand back another number), pixels }; errorScopes: the device has pushErrorScope / popErrorScope, and scopeError() (a function) says whether the next
// pair of pops reports an error (its message is returned by the first pop)
export function recordingDevice({ timestamps = false, hash = sha16, echo = null, errorScopes = null } = {}) {
  const log = [], ids = new Map(), named = new Map(); let n = 0;
  const id = (o, kind) => { if (!ids.has(o)) { ids.set(o, kind + '#' + (++n)); named.set(kind + '#' + n, o); } return ids.get(o); };
  const nm = o => (o && ids.has(o) ? ids.get(o) : o && o.__view ? 'view(' + nm(o.__view) + ')' : o && o.buffer && ids.has(o.buffer) ? ids.get(o.buffer) : '?');
  const stats = { shaders: [], textures: [], buffers: [], pipelines: [], groups: [], submits: 0 }, paramsOf = new Map(), lastParams = new Map(), rbSrc = new Map();
  const buffer = d => { const b = { desc: d, destroyed: false, destroy() { b.destroyed = true; log.push('destroy ' + id(b)); }, mapAsync: () => Promise.resolve(), getMappedRange: () => { if (echo && rbSrc.has(b)) { const a = new Uint32Array(d.size / 4), p = lastParams.get(paramsOf.get(rbSrc.get(b))); a[123] = echo.body ?? 5000; a[124] = echo.badNonce ? (p ? p[3] : 0) + 7 : (p ? p[3] : 0); a[0] = echo.pixels ?? 0; return a.buffer; } return d.size === 16 ? new BigUint64Array([1000n, 2000000n]).buffer : new ArrayBuffer(d.size); }, unmap() {} }; id(b, 'buf'); stats.buffers.push(b); log.push('createBuffer ' + id(b) + ' ' + d.size + ' ' + d.usage); return b; };
  const texture = d => { const t = { desc: d, destroyed: false, destroy() { t.destroyed = true; log.push('destroy ' + id(t)); }, createView() { return { __view: t }; } }; id(t, 'tex'); stats.textures.push(t); log.push('createTexture ' + id(t) + ' ' + JSON.stringify([d.size, d.format, d.dimension || '2d', d.usage])); return t; };
  const pass = (kind, d) => ({
    setPipeline: p => log.push(kind + '.setPipeline ' + id(p, 'pipe')), setVertexBuffer: (i, b) => log.push(kind + '.setVertexBuffer ' + i + ' ' + nm(b)), setBindGroup: (i, g) => log.push(kind + '.setBindGroup ' + i + ' ' + id(g, 'bg')),
    setViewport: (...a) => log.push(kind + '.setViewport ' + a.join(',')), setScissorRect: (...a) => log.push(kind + '.setScissorRect ' + a.join(',')), draw: n => log.push(kind + '.draw ' + n), dispatchWorkgroups: (...a) => log.push(kind + '.dispatch ' + a.join(',')),
    end: () => log.push(kind + '.end'),
  });
  const device = {
    features: new Set(timestamps ? ['timestamp-query'] : []),
    queue: { writeBuffer: (b, off, data) => { if (echo && data.byteLength === 16) lastParams.set(b, new Uint32Array(bytesOf(data).buffer.slice(bytesOf(data).byteOffset, bytesOf(data).byteOffset + 16))); log.push('writeBuffer ' + nm(b) + ' ' + off + ' ' + (data.byteLength ?? data.length) + ' ' + sha16(bytesOf(data))); }, writeTexture: (dst, data, lay, size) => log.push('writeTexture ' + nm(dst.texture) + ' ' + JSON.stringify([dst.origin || [0, 0, 0], size, data.byteLength]) + ' ' + sha16(bytesOf(data))), submit: cb => { stats.submits++; log.push('submit ' + cb.length); } },
    createBindGroupLayout: d => { const o = { d }; log.push('createBindGroupLayout ' + id(o, 'bgl') + ' ' + d.entries.map(e => e.binding + (e.texture ? 'T' + e.texture.sampleType : e.sampler ? 'S' : e.buffer ? 'B' + e.buffer.type : e.storageTexture ? 'X' + e.storageTexture.format : '')).join(',')); return o; },
    createPipelineLayout: d => { const o = { d }; log.push('createPipelineLayout ' + id(o, 'pl') + ' ' + d.bindGroupLayouts.map(l => id(l, 'bgl')).join(',')); return o; },
    createSampler: d => { const o = { d }; log.push('createSampler ' + id(o, 'smp')); return o; },
    createBuffer: buffer, createTexture: texture,
    createQuerySet: d => { const o = { d, destroy() {} }; log.push('createQuerySet ' + id(o, 'qs') + ' ' + d.count); return o; },
    createShaderModule: d => { const o = { code: d.code }; stats.shaders.push(d.code); log.push('createShaderModule ' + id(o, 'mod') + ' ' + hash(d.code)); return o; },
    createBindGroup: d => { const o = { d }; stats.groups.push(o); if (echo) { const c = d.entries.find(e => e.binding === 4 && e.resource.buffer), q = d.entries.find(e => e.binding === 5 && e.resource.buffer); if (c && q) paramsOf.set(c.resource.buffer, q.resource.buffer); } log.push('createBindGroup ' + id(o, 'bg') + ' ' + id(d.layout, 'bgl') + ' ' + d.entries.map(e => e.binding + '=' + (e.resource.__view ? 'view(' + nm(e.resource.__view) + ')' : e.resource.buffer ? nm(e.resource.buffer) : id(e.resource, 'smp'))).join(',')); return o; },
    createCommandEncoder: () => ({
      beginRenderPass: d => { log.push('beginRenderPass ' + d.colorAttachments.length + ' ts=' + !!d.timestampWrites); return pass('render', d); },
      beginComputePass: d => { log.push('beginComputePass ts=' + !!d?.timestampWrites); return pass('compute', d); },
      resolveQuerySet: (qs, a, b, dst, off) => log.push('resolveQuerySet ' + a + ',' + b + ' ' + nm(dst) + ' ' + off), copyBufferToBuffer: (a, ao, b, bo, sz) => { if (echo) rbSrc.set(b, a); log.push('copyBufferToBuffer ' + nm(a) + ' ' + nm(b) + ' ' + sz); }, copyTextureToBuffer: () => log.push('copyTextureToBuffer'), copyBufferToTexture: (src, dst, size) => log.push('copyBufferToTexture ' + nm(src.buffer) + ' ' + nm(dst.texture) + ' ' + [].concat(size).join(',') + ' z' + (dst.origin?.[2] ?? 0)),
      clearBuffer: b => log.push('clearBuffer ' + nm(b)), finish: () => { log.push('finish'); return {}; },
    }),
  };
  const mkPipe = kind => d => { const o = { d }; stats.pipelines.push(o); log.push(kind + ' ' + id(o, 'pipe') + ' layout=' + id(d.layout, 'pl') + ' module=' + id((d.vertex || d.compute).module, 'mod')); return o; };
  if (errorScopes) { device.pushErrorScope = f => log.push('pushErrorScope ' + f); device.popErrorScope = () => { log.push('popErrorScope'); return Promise.resolve(errorScopes.scopeError?.() ? { message: 'injected GPU error' } : null); }; }
  device.createRenderPipeline = mkPipe('createRenderPipeline'); device.createRenderPipelineAsync = async d => mkPipe('createRenderPipelineAsync')(d);
  device.createComputePipeline = mkPipe('createComputePipeline'); device.createComputePipelineAsync = async d => mkPipe('createComputePipelineAsync')(d);
  return { device, log, stats, named, codeOfPipe: name => { const p = named.get(name); return p ? (p.d.vertex || p.d.compute).module.code : null; } };
}

// the volume pass's uniforms as the page has them (values only what the passes read): a 16^3 grid, 4 slots of which 2 are shown, the jumps on, no section
export function sceneUniforms(size = 16, seg = [1, 1, 0, 0]) {
  const T = THREEG, n = size * size * size;
  const t3 = (data, w, h, d, format, type) => { const t = new T.Data3DTexture(data, w, h, d); t.format = format; t.type = type; t.needsUpdate = true; return t; };
  const cls = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const x = i % size, y = Math.floor(i / size) % size, z = Math.floor(i / (size * size)); const inside = (x - 8) ** 2 + (y - 8) ** 2 + (z - 8) ** 2 < 16; cls[i * 4] = inside ? 255 : 0; cls[i * 4 + 1] = 0; cls[i * 4 + 3] = Math.min(255, Math.round(Math.abs(Math.sqrt((x - 8) ** 2 + (y - 8) ** 2 + (z - 8) ** 2) - 4) * 8)); }
  return {
    vol: { value: t3(new Uint8Array(n * 2), size, size, size, T.RGFormat, T.UnsignedByteType) }, clsTex: { value: t3(cls, size, size, size, T.RGBAFormat, T.UnsignedByteType) },
    cls4Tex: { value: t3(new Uint8Array(1), 1, 1, 1, T.RedFormat, T.UnsignedByteType) }, skipTex: { value: t3(new Uint32Array(2), 1, 1, 1, T.RGIntegerFormat, T.UnsignedIntType) },
    editTex: { value: t3(new Uint8Array(4), 1, 1, 1, T.RGBAFormat, T.UnsignedByteType) }, sliceVol: { value: t3(new Uint8Array(2), 1, 1, 1, T.RGFormat, T.UnsignedByteType) },
    planeCount: { value: 0 }, diag: { value: 0 }, useSkip: { value: 0 }, distInCls: { value: 1 }, useCls: { value: 1 }, refine: { value: 1 }, stepSize: { value: 0.02 }, halfExt: { value: { x: 1, y: 1, z: 1 } }, voxelMin: { value: 0.1 },
    clsChan: { value: [0, 1, -1, -1] }, segA: { value: seg.map(w => ({ x: 0, y: 0, z: 1, w })) },
  };
}
export const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });

// the scenario: the module `mod` = docs/vr-wgpu.js (any build), `opts` = extra options of createVrVolumeRenderer; returns the log. The calls of the display: a session's preload, the centre + periphery pass, a 100 % pass, the probe, the breakdown's begin and end, dispose.
export async function runScenario(mod, { timestamps = false, opts = {}, u = sceneUniforms() } = {}) {
  const { device, log } = recordingDevice({ timestamps });
  const r = mod.createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1], ...opts });
  const frame = (f, fov) => r.draw({ u, cams: [eyeCam(1000, 1000), eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f, fov, fp: f / 2, rects: [[300, 300, 700, 700]], band: 1, variant: { cls4: false, events: false } });
  await r.preload(u, [{ cls4: false, events: false }, { cls4: false, events: true }]);
  r.volume.setTimerEvery?.(1);
  frame(0.5, true); r.volume.markFrame(true); await new Promise(res => setTimeout(res, 0));
  frame(1, false); r.volume.markFrame(true); await new Promise(res => setTimeout(res, 0));
  frame(0.5, false); r.volume.markFrame(false);
  await r.probe({ u, cam: eyeCam(48, 48), model: new THREEG.Matrix4() });
  await r.breakdown.begin({ cls4: false, events: false }, () => {});
  frame(0.5, true); r.volume.markFrame(true); await new Promise(res => setTimeout(res, 0));
  r.breakdown.end();
  frame(0.5, true); r.volume.markFrame(true); await new Promise(res => setTimeout(res, 0));
  r.dispose();
  return log;
}
