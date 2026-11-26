// Measurement of the WebGPU volume pass of a frame that draws a body and a part taken out of it, against the same frame of the body alone (the page code of tools/wgpu-m6-check.mjs, run with M6_PERF=1).
// What is measured (software Vulkan, SwiftShader: a CPU renderer, so the milliseconds are not the headset's; the COUNTS and the BYTES are what the GPU is asked to do and do not depend on the adapter):
//   per frame: submits, render passes, compute passes, draws, dispatched workgroups, the bytes of every colour / depth attachment a render pass loads (loadOp 'load') and stores (storeOp 'store') (a tiling GPU reads and writes the whole attachment
//   for these, whatever the scissor says), and what was created (textures with their bytes, bind groups, buffers, pipelines, shader modules); the JS ms of draw() and the ms until the queue is idle; the GPU timestamps (takeGpuMs) when the adapter has them.
// The hitch scenario walks the states of a session (body alone, a part cut out, the part moved, the scale changed, the periphery switched, the part put back) and lists, per frame, what was created in it.
const BPP = { rgba8unorm: 4, depth32float: 4, r32float: 4, rg32float: 8, r8unorm: 1, rg8unorm: 2, rgba32float: 16, rgba16float: 8, r8uint: 1, depth24plus: 4, r32uint: 4 };
const bytesOf = (size, format) => { const s = Array.isArray(size) ? size : [size.width, size.height ?? 1, size.depthOrArrayLayers ?? 1]; return s[0] * (s[1] ?? 1) * (s[2] ?? 1) * (BPP[format] ?? 4); };
export function installCounters(patches = []) {
  const S = { sub: 0, rp: 0, cp: 0, draws: 0, groups: 0, dispatch: 0, load: 0, store: 0, loadDepth: 0, storeDepth: 0, bg: 0, tex: 0, texBytes: 0, buf: 0, pipe: 0, mod: 0, views: 0, writes: 0, writeBytes: 0, texWrites: 0, texWriteBytes: 0, log: [] };
  const P = (proto, name, fn) => { const o = proto[name]; proto[name] = function (...a) { return fn.call(this, o, a); }; };
  P(GPUTexture.prototype, 'createView', function (o, a) { const v = o.apply(this, a); v.__t = this; return v; });
  P(GPUDevice.prototype, 'createTexture', function (o, a) { const t = o.apply(this, a); S.tex++; S.texBytes += bytesOf(a[0].size, a[0].format); S.log.push('tex ' + a[0].format + ' ' + JSON.stringify(a[0].size)); return t; });
  P(GPUDevice.prototype, 'createBindGroup', function (o, a) { S.bg++; return o.apply(this, a); });
  P(GPUDevice.prototype, 'createBuffer', function (o, a) { S.buf++; return o.apply(this, a); });
  P(GPUDevice.prototype, 'createRenderPipeline', function (o, a) { S.pipe++; return o.apply(this, a); });
  P(GPUDevice.prototype, 'createRenderPipelineAsync', function (o, a) { S.pipe++; return o.apply(this, a); });
  P(GPUDevice.prototype, 'createComputePipeline', function (o, a) { S.pipe++; return o.apply(this, a); });
  P(GPUDevice.prototype, 'createComputePipelineAsync', function (o, a) { S.pipe++; return o.apply(this, a); });
  // an experiment (M6_PERF_PATCH): text of every shader module changed before it is compiled, [[from, to], ...] (what a piece of the program costs when it is taken away or replaced; the picture of such a run is not the display's)
  P(GPUDevice.prototype, 'createShaderModule', function (o, a) { S.mod++; if (patches.length && a[0]?.code) { let code = a[0].code; for (const [f, t] of patches) code = code.split(f).join(t); a = [{ ...a[0], code }]; } return o.apply(this, a); });
  P(GPUQueue.prototype, 'submit', function (o, a) { S.sub++; return o.apply(this, a); });
  P(GPUQueue.prototype, 'writeBuffer', function (o, a) { S.writes++; S.writeBytes += a[4] ?? (a[2]?.byteLength ?? 0); return o.apply(this, a); });
  P(GPUQueue.prototype, 'writeTexture', function (o, a) { S.texWrites++; const d = a[1], sz = a[3], l = a[2]; S.texWriteBytes += d?.byteLength ?? 0; return o.apply(this, a); });
  P(GPUCommandEncoder.prototype, 'beginRenderPass', function (o, a) {
    S.rp++;
    const d = a[0];
    for (const c of d.colorAttachments || []) { const t = c.view.__t; if (!t) continue; const b = bytesOf([t.width, t.height, 1], t.format); if (c.loadOp === 'load') S.load += b; if (c.storeOp === 'store') S.store += b; }
    const z = d.depthStencilAttachment; if (z) { const t = z.view.__t, b = t ? bytesOf([t.width, t.height, 1], t.format) : 0; if (z.depthLoadOp === 'load') S.loadDepth += b; if (z.depthStoreOp === 'store') S.storeDepth += b; }
    return o.apply(this, a);
  });
  P(GPUCommandEncoder.prototype, 'beginComputePass', function (o, a) { S.cp++; return o.apply(this, a); });
  P(GPURenderPassEncoder.prototype, 'draw', function (o, a) { S.draws++; return o.apply(this, a); });
  P(GPUComputePassEncoder.prototype, 'dispatchWorkgroups', function (o, a) { S.dispatch += (a[0] | 0) * (a[1] || 1) * (a[2] || 1); return o.apply(this, a); });
  const snap = () => { const r = { ...S, log: undefined }; return r; };
  const diff = (a, b) => { const r = {}; for (const k of Object.keys(a)) if (k !== 'log') r[k] = b[k] - a[k]; return r; };
  return { S, snap, diff };
}
const MB = x => (x / 1048576).toFixed(1);
export async function perfRun({ THREE, device, rv, mkU, eyeUniforms, a }) {
  const { PW, PH, cases } = a.perf;
  const { eyeMetrics } = await import(a.perf.rsUrl); // the rect each volume's box covers in each eye, as the app's frame loop computes them (vr-render-scale.js) and hands to draw()
  const C = installCounters(a.perf.patch || []);
  const uBody0 = mkU(cases.before), uBodyP = mkU(cases.body), uPart = mkU(cases.part);
  const camOf = x => { const c = new THREE.PerspectiveCamera(45, PW / PH, 0.01, 50); c.position.set(x, 1.3, 2.5); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); c.viewport = { z: PW, w: PH }; return c; };
  const cams = [camOf(1.97), camOf(2.03)];
  const I4 = new THREE.Matrix4(), MP = new THREE.Matrix4().makeTranslation(0.5, 0.12, -0.55);
  const variant = { cls4: false, events: false, multi: true };
  await rv.preload(uBody0, [{ cls4: false, events: false }]); await rv.preload(uBodyP, [variant]); await rv.preload(uPart, [variant]);
  const clone3 = t => { const x = new THREE.Data3DTexture(t.image.data, t.image.width, t.image.height, t.image.depth); x.format = t.format; x.type = t.type; x.minFilter = t.minFilter; x.magFilter = t.magFilter; x.unpackAlignment = 1; x.needsUpdate = true; return x; };
  const mkPart2 = () => { const u2 = { ...uPart }; for (const k of ['partField', 'partOcc']) u2[k] = { value: clone3(uPart[k].value) }; return u2; };
  const more = []; // parts 2 .. 6: each its own uniforms and field textures, as the app makes them
  const partsOf = (n, model, order) => { const out = [{ u: uPart, model, order, boxes: rectsOf(model, selfBox) }]; for (let k = 1; k < n; k++) { more[k] ||= mkPart2(); const mk = new THREE.Matrix4().makeTranslation(0.25 * k - 0.6, 0.1 * k - 0.3, 0.3 - 0.1 * k); out.push({ u: more[k], model: mk, order: k % 2 ? 0.5 : 1.5, boxes: rectsOf(mk, selfBox) }); } return out; };
  const rectsOf = (model, box) => cams.map(cm => { const o = {}; eyeMetrics(model.elements, a.he, [a.N, a.N, a.N], cm.matrixWorldInverse.elements, cm.projectionMatrix.elements, PW, PH, o, box); return { x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 }; });
  const selfBox = { c: a.selfBox.c, h: a.selfBox.h };
  const K = 0.5, band = 4, RECT = [[PW * 0.3, PH * 0.3, PW * 0.7, PH * 0.7], [PW * 0.28, PH * 0.3, PW * 0.68, PH * 0.7]];
  // cut: false = the body as drawn before a cut (no part programs), true = the body with the P programs and the part beside it, 'bodyP' = the body with the P programs alone, 'part' = the part alone as the main volume
  const frame = (cut, { f = 1, fov = false, model = I4, order = 1.5, extra = null, fresh = null } = {}) => rv.draw({ u: cut === 'part' ? uPart : cut === 'fresh' ? fresh.body : cut ? uBodyP : uBody0, cams, model: I4, f, fov, fp: K * f, periK: fov ? K : 1, rects: fov ? RECT : null, band, variant: cut ? variant : { cls4: false, events: false }, decode: false, boxes: cut === 'part' ? rectsOf(I4, selfBox) : rectsOf(I4, null), extras: cut === true || typeof cut === 'number' ? [...partsOf(cut === true ? 1 : cut, model, order), ...(extra || [])] : cut === 'fresh' ? [{ u: fresh.part, model, order, boxes: rectsOf(model, selfBox) }] : null });
  const idle = () => device.queue.onSubmittedWorkDone();
  const SC = [], only = a.perf.only ? new RegExp(a.perf.only) : null;
  for (const [ctag, o] of [['f 1 centre only', { f: 1, fov: false }], ['f 0.8 centre + periphery', { f: 0.8, fov: true }]]) for (const [name, cut, order] of [['body', false, 1.5], ['body P alone', 'bodyP', 1.5], ['part alone', 'part', 1.5], ['body + part (part farther)', true, 1.5], ['body + part (part nearer)', true, 0.5], ['body + 3 parts', 3, 1.5], ['body + 5 parts', 5, 1.5]]) { const key = ctag + ' | ' + name; if (!only || only.test(key) || name === 'body') SC.push({ key, cut, o: { ...o, order } }); }
  const MBf = x => +(x / 1048576).toFixed(2);
  const api = {
    keys: SC.map(x => x.key), caps: { timestamps: device.features.has('timestamp-query') },
    // n frames of one scenario: the mean per frame of the counters, the GPU timestamps' mean (ms), the JS ms of draw()
    async run(key, n) {
      const sc = SC.find(x => x.key === key); let js = 0; const s0 = C.snap(); rv.volume.takeGpuMs?.();
      for (let i = 0; i < n; i++) { const t0 = performance.now(); frame(sc.cut, sc.o); js += performance.now() - t0; await idle(); rv.volume.markFrame?.(false); }
      const d = C.diff(s0, C.snap()), g = rv.volume.takeGpuMs?.();
      return { submits: d.sub / n, renderPasses: d.rp / n, computePasses: d.cp / n, draws: d.draws / n, workgroups: d.dispatch / n, loadMB: MBf((d.load + d.loadDepth) / n), storeMB: MBf((d.store + d.storeDepth) / n), created: { tex: d.tex, bindGroups: d.bg, buffers: d.buf, pipelines: d.pipe, modules: d.mod }, jsMs: js / n, gpuMs: g ? g.ms / g.n : null };
    },
    // the walk through the states of a session: per frame what was created, and the JS ms
    async hitch() {
      const steps = [];
      const run = async (label, n, cut, o) => { for (let i = 0; i < n; i++) { const s0 = C.snap(), t0 = performance.now(); frame(cut, o); const t1 = performance.now(); await idle(); const d = C.diff(s0, C.snap()); steps.push({ label, i, jsMs: +(t1 - t0).toFixed(2), tex: d.tex, texMB: MBf(d.texBytes), bg: d.bg, buf: d.buf, pipe: d.pipe, mod: d.mod, rp: d.rp, cp: d.cp, load: MBf(d.load + d.loadDepth), store: MBf(d.store + d.storeDepth), wr: d.texWrites, wrMB: MBf(d.texWriteBytes) }); rv.volume.markFrame?.(false); } };
      const f0 = { f: 1, fov: true };
      await run('body alone', 6, false, f0);
      // the cut as the app makes it: the part's field and blocks are textures made for this part (and the body's field is another texture of the body's P uniforms): the first frames upload them
      const freshBody = { ...uBodyP }, freshPart = mkPart2(); for (const k of ['partField', 'partOcc']) freshBody[k] = { value: clone3(uBodyP[k].value) };
      await run('part cut out (first frames, new field / block textures)', 3, 'fresh', { ...f0, model: I4, fresh: { body: freshBody, part: freshPart } });
      await run('part cut out (steady)', 4, 'fresh', { ...f0, model: I4, fresh: { body: freshBody, part: freshPart } });
      const t = new THREE.Matrix4();
      for (let k = 0; k < 6; k++) { t.makeTranslation(0.02 * k, 0.01 * k, -0.02 * k); await run('part moved', 1, true, { ...f0, model: t.clone() }); }
      for (const f of [0.9, 0.8, 0.7, 0.8, 1]) await run('scale ' + f, 2, true, { f, fov: true, model: MP });
      await run('periphery off', 2, true, { f: 1, fov: false, model: MP });
      await run('periphery on', 2, true, { f: 1, fov: true, model: MP });
      const p2 = mkPart2();
      await run('a second part cut out (first frames)', 3, true, { ...f0, model: MP, extra: [{ u: p2, model: new THREE.Matrix4().makeTranslation(-0.5, 0.1, 0.3), order: 0.5, boxes: rectsOf(new THREE.Matrix4().makeTranslation(-0.5, 0.1, 0.3), selfBox) }] });
      await run('two parts (steady)', 3, true, { ...f0, model: MP, extra: [{ u: p2, model: new THREE.Matrix4().makeTranslation(-0.5, 0.1, 0.3), order: 0.5, boxes: rectsOf(new THREE.Matrix4().makeTranslation(-0.5, 0.1, 0.3), selfBox) }] });
      await run('part put back', 3, false, f0);
      return steps;
    },
  };
  window.__perf = api;
  return { perfReady: true, keys: api.keys };
}
