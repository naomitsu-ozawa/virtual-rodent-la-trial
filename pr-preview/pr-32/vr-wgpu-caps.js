// What this headset's browser offers to the WebGPU VR view, checked on the device and written into the diagnostic record (vr-wgpu.js createGxDiag, the values section, ONE entry: 'device caps').
// Nothing here changes what is drawn. Four checks, each one reports into the same summary text:
//  1. the adapter's features and limits (all of them) against what the device was given, and whether subgroups / shader-f16 / timestamp-query / float32-filterable are usable;
//  2. whether the headset's fixed foveation (layer.fixedFoveation) shortens a heavy full-eye draw in the WebGPU XR eye pass: a few seconds at the start of the session, the draw is invisible
//     (blend: src x 0 + dst x 1) and its GPU time (timestamp-query on the pass) is compared at foveation 0 and 1, with the same draw into an off-screen texture as the control;
//  3. whether XRGPUBinding.createProjectionLayer takes a textureUsage (STORAGE_BINDING / COPY_DST / TEXTURE_BINDING with RENDER_ATTACHMENT): three.js' own call is wrapped here (on the prototype, for the duration of
//     setSession; vendor three.js is not edited). The layer the view uses is the one the plain call gives; the trial layers are made after it and let go. Debug switch gxLayerUsage = the 'trial launch': the
//     display layer itself is made with the usage (falling back to the plain call when that throws);
//  4. debug switch gxWait3: after the volume pass is submitted the frame waits 3 ms on purpose, on every 8th frame, and the time to queue.onSubmittedWorkDone is compared with the frames that do not wait
//     (a submit that reaches the GPU only when the frame callback returns finishes 3 ms later; one that reaches it at once does not). Off by default: no wait, no extra call.
// Pure of the page (no DOM, no three.js): the device, binding, layer and clock are passed in, so a mock can drive every part.

export const GXC_USAGE_BITS = [['COPY_SRC', 1], ['COPY_DST', 2], ['TEXTURE_BINDING', 4], ['STORAGE_BINDING', 8], ['RENDER_ATTACHMENT', 16]];
// textureUsage values tried for the projection layer (RENDER_ATTACHMENT is always in: a given textureUsage replaces the default, which is RENDER_ATTACHMENT only): all three, then the single additions
export const GXC_USAGE_LADDER = [16 | 8 | 2 | 4, 16 | 2, 16 | 4, 16 | 8];
export const GXC_FEATURES_OF_INTEREST = ['subgroups', 'subgroups-f16', 'chromium-experimental-subgroups', 'shader-f16', 'timestamp-query', 'chromium-experimental-timestamp-query-inside-passes', 'timestamp-query-inside-passes',
  'float32-filterable', 'float32-blendable', 'indirect-first-instance', 'rg11b10ufloat-renderable', 'bgra8unorm-storage', 'depth32float-stencil8', 'dual-source-blending', 'clip-distances', 'texture-compression-astc', 'core-features-and-limits'];
export const GXC_WAIT_MS = 3;

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
export const capsErrText = e => { try { return clip((e?.name && e.name !== 'Error' ? e.name + ': ' : '') + (e?.message ?? e), 300); } catch { return 'error'; } };
export const usageText = n => (Number.isFinite(n) ? GXC_USAGE_BITS.filter(([, b]) => n & b).map(([k]) => k.replace('_BINDING', '').replace('RENDER_ATTACHMENT', 'RENDER')).join('|') + ' (' + n + ')' : String(n));
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
export const capsMedian = a => { const v = a.filter(Number.isFinite).sort((p, q) => p - q); if (!v.length) return null; const m = v.length >> 1; return v.length & 1 ? v[m] : (v[m - 1] + v[m]) / 2; };

// ---- 1. features and limits ----
// every limit of a GPUSupportedLimits (the values are getters on the prototype, so for...in, plus the prototype's own names): { name: number }, sorted by name
export function readLimits(limits) {
  const o = {};
  if (!limits) return o;
  const take = k => { if (k === 'constructor' || k in o) return; try { const v = limits[k]; if (typeof v === 'number' || typeof v === 'bigint') o[k] = Number(v); } catch { /* a getter that throws */ } };
  try { for (const k in limits) take(k); } catch { /* none */ }
  try { for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(limits) || {})) take(k); } catch { /* none */ }
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
export const readFeatures = set => { try { return [...(set || [])].map(String).sort(); } catch { return []; } };
// the adapter's and the device's features / limits / info; requested = the feature names asked of the device; nothing here throws
export function readAdapterCaps(adapter, device, requested = []) {
  const feats = readFeatures(adapter?.features), dfeats = readFeatures(device?.features);
  const al = readLimits(adapter?.limits), dl = readLimits(device?.limits);
  const differ = {};
  for (const k of Object.keys(al)) if (k in dl && dl[k] !== al[k]) differ[k] = [al[k], dl[k]]; // [what the adapter can, what the device got]
  let info = null;
  try { const a = device?.adapterInfo || adapter?.info; if (a) info = { vendor: a.vendor, architecture: a.architecture, device: a.device, description: a.description, subgroupMinSize: a.subgroupMinSize ?? null, subgroupMaxSize: a.subgroupMaxSize ?? null }; } catch { /* none */ }
  const interest = {};
  for (const f of GXC_FEATURES_OF_INTEREST) interest[f] = dfeats.includes(f) ? 'device' : feats.includes(f) ? 'adapter only' : 'no';
  return { features: feats, deviceFeatures: dfeats, requested: [...requested], notGranted: requested.filter(f => !dfeats.includes(f)), limits: al, deviceLimits: dl, limitsDiffer: differ, info, interest };
}

// ---- 3. the projection layer with a textureUsage ----
// Wraps createProjectionLayer on `proto` (XRGPUBinding.prototype) and returns restore(). Only the first call is wrapped (three.js makes one layer per session).
// probe (default): the display layer is made exactly as asked (an exception from that call goes on to the caller as it would have); after it, trial layers with a textureUsage are made one by one (until one works) and let go.
// launch: the display layer is made with the textureUsage (the first of the ladder that works); when every one throws, the plain call is made (and whatever that does is what the caller gets).
export function installLayerWrap(proto, rec, { launch = false, ladder = GXC_USAGE_LADDER } = {}) {
  const L = rec.layer = { mode: launch ? 'launch' : 'probe', tried: [], display: null, calls: 0, installed: false };
  const orig = proto?.createProjectionLayer;
  if (typeof orig !== 'function') { L.error = 'no createProjectionLayer on the binding'; return () => {}; }
  const props = l => { try { return { w: l.textureWidth, h: l.textureHeight, layers: l.textureArrayLength }; } catch { return {}; } };
  const wrapper = function (init, ...rest) {
    if (L.calls++ > 0) return orig.call(this, init, ...rest);
    const base = init && typeof init === 'object' ? init : {};
    if (launch) {
      for (const usage of ladder) {
        try { const layer = orig.call(this, { ...base, textureUsage: usage }, ...rest); L.tried.push({ usage, ok: true, ...props(layer) }); L.display = { usage, withUsage: true }; return layer; } catch (e) { L.tried.push({ usage, ok: false, error: capsErrText(e) }); }
      }
      L.display = { usage: null, withUsage: false };
      return orig.call(this, init, ...rest);
    }
    const real = orig.call(this, init, ...rest); // unchanged; a throw here is the caller's, as without the wrapper
    L.display = { usage: null, withUsage: false };
    try {
      for (const usage of ladder) {
        try {
          const trial = orig.call(this, { ...base, textureUsage: usage }, ...rest);
          L.tried.push({ usage, ok: true, ...props(trial) });
          if (!L.trial) L.trial = trial; else { try { trial.destroy?.(); } catch { /* let go */ } }
          break; // the first that works: the others are subsets
        } catch (e) { L.tried.push({ usage, ok: false, error: capsErrText(e) }); }
      }
    } catch (e) { L.error = capsErrText(e); }
    return real;
  };
  try { proto.createProjectionLayer = wrapper; L.installed = true; } catch (e) { L.error = capsErrText(e); return () => {}; }
  return () => { try { if (proto.createProjectionLayer === wrapper) proto.createProjectionLayer = orig; } catch { /* gone */ } };
}
// the sub image of the kept trial layer (one posed frame), then the trial layer is let go
export function probeTrialSubImage(rec, binding, views) {
  const L = rec.layer;
  if (!L?.trial) return;
  const trial = L.trial; L.trial = null;
  try {
    const out = [];
    for (const v of views || []) { const s = binding.getViewSubImage(trial, v), c = s.colorTexture; out.push({ eye: v.eye, usage: c?.usage, format: c?.format, w: c?.width, h: c?.height }); }
    L.trialSub = out;
  } catch (e) { L.trialSub = 'error: ' + capsErrText(e); }
  try { trial.destroy?.(); } catch { /* let go */ }
}

// ---- 2. the fixed foveation check ----
export const GXC_HEAVY_WGSL = `struct U { k: f32, n: u32, a: f32, b: f32 }
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  var a = pos.x * 0.0137 + pos.y * 0.0071 + u.k;
  var b = 0.5;
  for (var i = 0u; i < u.n; i = i + 1u) { a = fract(a * 1.6180339 + b); b = a * a + 0.37; }
  return vec4f(a, b, a, 1.0);
}`;
// the summary of one phase's samples: the median ms per frame (both eyes together), n, p95
const phaseStats = a => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return { n: v.length, ms: r2(capsMedian(v)), p95: v.length ? r2(v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)]) : null }; };
// the verdict from the medians: xr0 / xr1 = the XR eye pass at foveation 0 / 1, c0 / c1 = the off-screen control measured in the same frames
export function foveaVerdict({ xr0, xr1, c0, c1 }) {
  if (![xr0, xr1].every(v => Number.isFinite(v) && v > 0)) return 'not measurable (no usable GPU time of the XR pass)';
  const ratio = xr1 / xr0, cr = Number.isFinite(c0) && Number.isFinite(c1) && c0 > 0 ? c1 / c0 : null;
  if (cr !== null && (cr < 0.93 || cr > 1.07)) return 'unclear (the off-screen control moved by itself: ' + r2(cr) + ')';
  if (xr0 < 0.3 && (c0 ?? 1) < 0.3) return 'not measurable (the draw took under 0.3 ms: the compiler may have dropped it)';
  if (ratio <= 0.9) return 'EFFECTIVE (foveation 1 shortens the XR eye pass by ' + Math.round((1 - ratio) * 100) + ' %)';
  if (ratio >= 0.96 && ratio <= 1.04) return 'NO EFFECT on the XR eye pass (within 4 %)';
  return 'unclear (ratio ' + r2(ratio) + ')';
}
// the check as a per-frame machine: frame(xrFrame, pose) is called from the session's heartbeat (vr-wgpu.js startGxHeartbeat onFrame). It starts after `startAfter` posed frames, runs steps (foveation values, each
// `skip` frames to settle then `samples` frames measured), puts the foveation back, writes rec.fovea and calls rec.publish(). Any failure stops it with the error in rec.fovea.
// `done` (getter) = the check has ended (finished, unsupported, failed or aborted): the heartbeat reads the pose every frame until then (so the check ends within the first ~120 frames after the start, as it did when the heartbeat
// called it every frame) and every GX_POSE_EVERY-th frame after. Measurement of the check itself (performance.now() and counters only): F.events = the start / each step / the end (or abort / failure) with the time and the
// posed-frame number, rec.foveaDraws = the heavy draws submitted so far (the frame ring of vr-bench.js reads it as the column fv).
export function createFoveaProbe({ device, binding, layer, rec, startAfter = 100, skip = 6, samples = 24, steps = [0, 1, 0, 1], iters = 96, ring = 4, now = () => performance.now() }) {
  const F = rec.fovea = { state: 'waiting', initial: null, steps: [], error: null, events: [] };
  const ev = (k, more = null) => { if (F.events.length < 64) F.events.push({ k, t: now(), seen: st.seen, draws: rec.foveaDraws | 0, ...more }); }; // the check's own timeline (a few entries per session)
  const st = { seen: 0, init: false, step: 0, inStep: 0, done: false, slot: 0, busy: new Array(ring).fill(false), pend: 0, finishing: false, scopeChecked: false };
  const per = steps.map(() => ({ xr: [], ctrl: [] }));
  let res = null, orig = null, lastW = null;
  // the app may set the foveation itself while the check runs (its quality menu): a value that is not the one written last is the app's, and is the one put back at the end
  const adopt = () => { if (lastW === null) return; const cur = layer.fixedFoveation; if (typeof cur === 'number' && cur !== lastW) { orig = cur; F.changedByApp = (F.changedByApp | 0) + 1; lastW = cur; } };
  const setFov = v => { adopt(); layer.fixedFoveation = v; const rb = layer.fixedFoveation; lastW = typeof rb === 'number' ? rb : v; };
  const restore = () => { try { adopt(); if (orig !== null && typeof orig === 'number') { layer.fixedFoveation = orig; lastW = null; } } catch { /* gone */ } };
  const release = () => { const r = res; res = null; if (!r) return; for (const o of [r.qs, r.resolve, ...r.read, r.ubuf, r.ctrlTex]) { try { o?.destroy?.(); } catch { /* gone */ } } };
  const fail = e => { if (st.done && F.error) return; st.done = true; F.state = 'failed'; F.error = capsErrText(e); ev('fail'); restore(); if (!st.pend) release(); try { rec.publish(); } catch { /* the record is not worth a failure */ } };
  const finalize = () => {
    if (F.state === 'done') return;
    const by = v => { const idx = steps.map((s, i) => (s === v ? i : -1)).filter(i => i >= 0); return { xr: phaseStats(idx.flatMap(i => per[i].xr)), ctrl: phaseStats(idx.flatMap(i => per[i].ctrl)) }; };
    const lo = by(0), hi = by(1);
    F.result = { fov0: lo.xr, fov1: hi.xr, ctrl0: lo.ctrl, ctrl1: hi.ctrl, ratio: lo.xr.ms > 0 ? r2(hi.xr.ms / lo.xr.ms) : null };
    F.verdict = foveaVerdict({ xr0: lo.xr.ms, xr1: hi.xr.ms, c0: lo.ctrl.ms, c1: hi.ctrl.ms });
    F.state = 'done'; release();
    ev('result');
    try { rec.publish(); } catch { /* none */ }
  };
  const init = (subs, pose) => {
    st.init = true;
    const f0 = layer.fixedFoveation;
    F.initial = f0 ?? null;
    if (typeof f0 !== 'number') { st.done = true; ev('unsupported'); F.state = 'unsupported'; F.verdict = 'layer.fixedFoveation is ' + (f0 === undefined ? 'undefined' : String(f0)) + ' (the headset reports no fixed foveation for this layer)'; rec.publish(); return false; }
    orig = f0;
    if (!device.features?.has?.('timestamp-query')) { st.done = true; ev('unsupported'); F.state = 'unsupported'; F.verdict = 'not measured: the device has no timestamp-query'; rec.publish(); return false; }
    const colorTex = subs[0].colorTexture, vp = subs[0].viewport;
    const d0 = (typeof subs[0].getViewDescriptor === 'function' ? subs[0].getViewDescriptor() : null) || {}, format = d0.format || colorTex.format; // the pass renders into a view of this format
    F.format = format; F.textureFormat = colorTex.format; F.viewport = vp ? [vp.x, vp.y, vp.width, vp.height] : null; F.eyes = subs.length;
    const cw = Math.max(1, Math.floor(vp?.width || colorTex.width)), ch = Math.max(1, Math.floor(vp?.height || colorTex.height));
    device.pushErrorScope('validation');
    try {
      const module = device.createShaderModule({ code: GXC_HEAVY_WGSL });
      const off = { operation: 'add', srcFactor: 'zero', dstFactor: 'one' }; // the result is multiplied by 0 and the target by 1: nothing visible changes, the fragment shader still runs
      const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: off, alpha: off } }] }, primitive: { topology: 'triangle-list' } });
      const ubuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const ub = new ArrayBuffer(16); new Float32Array(ub)[0] = 0; new Uint32Array(ub)[1] = iters;
      device.queue.writeBuffer(ubuf, 0, ub);
      const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
      const ctrlTex = device.createTexture({ size: [cw, ch, 1], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const qs = device.createQuerySet({ type: 'timestamp', count: ring * 8 });
      const resolve = device.createBuffer({ size: ring * 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const read = Array.from({ length: ring }, () => device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
      res = { pipeline, bg, ubuf, ctrlTex, ctrlView: ctrlTex.createView(), qs, resolve, read, cw, ch };
    } catch (e) { device.popErrorScope().catch(() => {}); throw e; }
    device.popErrorScope().then(err => { if (err) fail(err); }, () => {});
    F.state = 'running'; F.iters = iters;
    setFov(steps[0]);
    ev('init', { step: 0, fov: steps[0] });
    try { rec.publish?.(); } catch { /* the record is not worth a failure */ } // the record shows 'running' from here (and the events: the start)
    return true;
  };
  const eyeView = (sub, i) => { const d = (typeof sub.getViewDescriptor === 'function' ? sub.getViewDescriptor() : null) || {}, t = sub.colorTexture, multi = (t.depthOrArrayLayers || 1) > 1; return t.createView({ ...d, dimension: '2d', arrayLayerCount: 1, baseArrayLayer: multi ? (d.baseArrayLayer ?? i) : 0 }); };
  const frame = (xrFrame, pose) => {
    if (st.done) return;
    let open = false; // a validation scope pushed by this call and not yet popped
    try {
      if (++st.seen < startAfter) return;
      const views = pose?.views || [];
      if (!views.length) return;
      const subs = views.slice(0, 2).map(v => binding.getViewSubImage(layer, v));
      if (!st.init && !init(subs, pose)) return;
      if (st.done || !res) return;
      const slot = st.slot; st.slot = (st.slot + 1) % ring;
      const collect = st.inStep >= skip && st.inStep < skip + samples, stepNo = st.step;
      if (!st.busy[slot]) {
        const scoped = !st.scopeChecked; st.scopeChecked = true; // the first frame's passes are checked for validation errors (a format the blend state or the view does not fit)
        if (scoped) { device.pushErrorScope('validation'); open = true; }
        const enc = device.createCommandEncoder(), base = slot * 8;
        const pass = (view, vp, w, h, q0) => {
          const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }], timestampWrites: { querySet: res.qs, beginningOfPassWriteIndex: base + q0, endOfPassWriteIndex: base + q0 + 1 } });
          p.setPipeline(res.pipeline); p.setBindGroup(0, res.bg);
          p.setViewport(vp ? vp.x : 0, vp ? vp.y : 0, vp ? vp.width : w, vp ? vp.height : h, 0, 1);
          p.draw(3); p.end();
        };
        for (let i = 0; i < 2; i++) { const s = subs[Math.min(i, subs.length - 1)]; pass(eyeView(s, i), s.viewport, 0, 0, i * 2); }
        for (let i = 0; i < 2; i++) pass(res.ctrlView, null, res.cw, res.ch, 4 + i * 2);
        enc.resolveQuerySet(res.qs, base, 8, res.resolve, slot * 256);
        enc.copyBufferToBuffer(res.resolve, slot * 256, res.read[slot], 0, 64);
        device.queue.submit([enc.finish()]);
        rec.foveaDraws = (rec.foveaDraws | 0) + 1; // the heavy draws submitted (the frame ring's column fv)
        if (scoped) { open = false; device.popErrorScope().then(err => { if (err) fail(err); }, () => {}); }
        st.busy[slot] = true; st.pend++;
        const buf = res.read[slot];
        buf.mapAsync(GPUMapMode.READ).then(() => {
          const t = new BigUint64Array(buf.getMappedRange().slice(0));
          buf.unmap();
          const d = (a, b) => (t[b] > t[a] && t[a] > 0n ? Number(t[b] - t[a]) / 1e6 : NaN);
          if (collect) { const xr = d(0, 1) + d(2, 3), ct = d(4, 5) + d(6, 7); if (Number.isFinite(xr)) per[stepNo].xr.push(xr); if (Number.isFinite(ct)) per[stepNo].ctrl.push(ct); }
        }, () => {}).finally(() => { st.busy[slot] = false; st.pend--; if (st.finishing && st.pend === 0) finalize(); else if (st.done && !st.pend) release(); });
      }
      if (++st.inStep >= skip + samples) { // this step is complete
        F.steps.push({ fov: steps[st.step], read: layer.fixedFoveation });
        st.step++; st.inStep = 0;
        if (st.step >= steps.length) { st.done = true; st.finishing = true; ev('end'); restore(); F.readBack = F.steps.map(s => s.read); if (st.pend === 0) finalize(); }
        else { setFov(steps[st.step]); ev('step', { step: st.step, fov: steps[st.step] }); }
      }
    } catch (e) { if (open) { try { device.popErrorScope().catch(() => {}); } catch { /* none */ } } fail(e); }
  };
  return { frame, get done() { return st.done; }, abort: () => { if (!st.done) { st.done = true; ev('abort'); restore(); F.state = F.state === 'waiting' ? 'not run' : F.state; if (!st.pend) release(); } } };
}

// ---- 4. the wait after the submit ----
// afterSubmit() is called right after the frame's volume pass was submitted, frameEnd(t) when the frame callback is about to return. Every `every`th call is a sample, alternately without and with a wait of waitMs (a busy wait:
// the callback keeps running, as the submit-time work of the frame would); one sample at a time. A sample is d = submit -> queue.onSubmittedWorkDone resolved, r = the rest of the callback after the wait, e = callback end -> resolved,
// and vol = the frame's volume GPU ms (volMs(cb): vr-wgpu.js onFrameVolMs; read back a few frames later). Which samples tell is decided by vol and r only (vol > waitMs + r + 1 ms: the volume pass is longer than the callback even with the wait),
// the same rule for both groups, so the wait cannot choose its own samples. In those, d - vol is ~r when the work goes to the GPU at the submit, and r + waitMs (without / with the wait) when it goes only after the callback returns.
export function createWaitProbe({ device, rec, waitMs = GXC_WAIT_MS, every = 4, volMs = null, now = () => performance.now(), publishEvery = 64 }) {
  const W = rec.wait = { on: true, waitMs, no: [], wait: [], skipped: 0, hasVol: !!volMs };
  let calls = 0, busy = false, pending = null, taken = 0;
  const afterSubmit = () => {
    const c = calls++;
    if (c % every !== 0) return;
    if (busy) { W.skipped++; return; }
    const wait = ((c / every) & 1) === 1;
    const t0 = now();
    if (wait) { while (now() - t0 < waitMs) { /* the deliberate wait */ } }
    const tAfter = now(), p = { wait, t0, tAfter, tEnd: null, d: null, vol: null, done: false };
    busy = true; pending = p;
    const fin = () => {
      if (p.done || p.d === null || (volMs && p.vol === null)) return;
      p.done = true;
      const g = p.wait ? W.wait : W.no; if (g.length < 600) g.push({ d: p.d, e: p.e, r: p.r, vol: p.vol });
      if (++taken === 16 || taken % publishEvery === 0) { try { rec.publish(); } catch { /* none */ } }
    };
    try { volMs?.(ms => { p.vol = Number.isFinite(ms) ? ms : null; if (p.vol === null) p.done = true; else fin(); }); } catch { /* no volume time: the sample is not used */ }
    device.queue.onSubmittedWorkDone().then(() => {
      const tDone = now(), tEnd = p.tEnd ?? tDone;
      p.d = tDone - p.t0; p.e = tDone - tEnd; p.r = tEnd - p.tAfter; fin();
    }, () => {}).finally(() => { busy = false; if (pending === p) pending = null; });
  };
  const frameEnd = t => { if (pending && pending.tEnd === null) pending.tEnd = t; };
  return { afterSubmit, frameEnd };
}
// per group: n, the samples that tell (see above), the median of d - vol in those, and the medians of d and e over all
export function waitStats(W) {
  if (!W) return null;
  const tell = x => Number.isFinite(x.vol) && x.vol > W.waitMs + x.r + 1;
  const sel = g => { const t = g.filter(tell); return { n: g.length, nTell: t.length, d: r2(capsMedian(g.map(x => x.d))), e: r2(capsMedian(g.map(x => x.e))), dv: r2(capsMedian(t.map(x => x.d - x.vol))), vol: r2(capsMedian(t.map(x => x.vol))) }; };
  const no = sel(W.no), wait = sel(W.wait);
  const diff = no.dv !== null && wait.dv !== null ? r2(wait.dv - no.dv) : null;
  let verdict;
  if (!W.hasVol) verdict = 'not decided: no volume GPU time (timestamp-query) to tell the samples by';
  else if (no.nTell < 6 || wait.nTell < 6) verdict = 'not enough samples where the volume pass is longer than the rest of the callback (need 6 per group)';
  else if (diff >= W.waitMs * 0.7) verdict = 'the wait is added to the completion time: the submit reaches the GPU only when the callback returns (or later)';
  else if (diff <= W.waitMs * 0.3) verdict = 'the wait is not added: the submit reaches the GPU at once, while the callback is still running';
  else verdict = 'in between (' + diff + ' ms of ' + W.waitMs + ' ms)';
  return { no, wait, diff, verdict };
}

// ---- the record: one summary entry in the diagnostic record's values ----
const kv = (o, f = v => v) => Object.entries(o).map(([k, v]) => k + '=' + f(v)).join(' ');
export function formatCapsSummary(s, { subImages = null } = {}) {
  const L = [];
  const c = s.adapter;
  if (c) {
    if (c.info) L.push('  adapter: ' + [c.info.vendor, c.info.architecture, c.info.device, c.info.description].filter(Boolean).join(' / ') + (c.info.subgroupMinSize != null ? ' · subgroup size ' + c.info.subgroupMinSize + '..' + c.info.subgroupMaxSize : ''));
    L.push('  usable here (device): ' + kv(c.interest, v => v));
    L.push('  requested of the device: ' + (c.requested.join(', ') || 'none') + (c.notGranted.length ? ' · NOT granted: ' + c.notGranted.join(', ') : ' · all granted'));
    L.push('  adapter features (' + c.features.length + '): ' + c.features.join(', '));
    L.push('  device features (' + c.deviceFeatures.length + '): ' + c.deviceFeatures.join(', '));
    L.push('  adapter limits: ' + kv(c.limits));
    const dif = Object.entries(c.limitsDiffer);
    L.push('  device limits that are lower than the adapter\'s (adapter -> device): ' + (dif.length ? dif.map(([k, [a, d]]) => k + ' ' + a + '->' + d).join(', ') : 'none (the device got the adapter\'s)'));
  } else L.push('  adapter caps: not read');
  const l = s.layer;
  L.push('  projection layer with textureUsage (three.js\' createProjectionLayer wrapped; mode ' + (l ? l.mode : '-') + (l?.mode === 'launch' ? ' = the display layer is made with the usage' : ' = the display layer is the plain call, trial layers are made after it and let go') + '):');
  if (!l) L.push('    not run');
  else {
    if (l.error) L.push('    wrapper: ' + l.error);
    L.push('    display layer: ' + (l.display ? (l.display.withUsage ? 'made with usage ' + usageText(l.display.usage) : 'plain call (colorFormat only)') : 'not made through the wrapper'));
    for (const t of l.tried) L.push('    textureUsage ' + usageText(t.usage) + ': ' + (t.ok ? 'created ' + [t.w, t.h, t.layers].join('x') : 'EXCEPTION ' + t.error));
    if (!l.tried.length && !l.error) L.push('    (no trial: the plain call came first and gave no layer, or the switch is on and it went through the display call)');
    if (l.trialSub !== undefined) L.push('    sub image of the trial layer: ' + (typeof l.trialSub === 'string' ? l.trialSub : l.trialSub.map(x => 'eye ' + x.eye + ' usage ' + usageText(x.usage) + ' ' + x.format + ' ' + x.w + 'x' + x.h).join(' · ')));
  }
  if (Array.isArray(subImages) && subImages.length) L.push('    sub image of the display layer: ' + subImages.map(x => (x.error ? 'error ' + x.error : 'eye ' + x.eye + ' usage ' + usageText(x.usage) + ' ' + x.format + ' ' + x.w + 'x' + x.h + 'x' + x.layers)).join(' · '));
  const F = s.fovea;
  L.push('  fixed foveation in the XR eye pass (heavy invisible full-eye draw, GPU ms per frame for both eyes; at the start of the session):');
  if (!F) L.push('    not run');
  else {
    L.push('    state: ' + F.state + (F.error ? ' · ' + F.error : '') + (F.initial !== null && F.initial !== undefined ? ' · layer.fixedFoveation was ' + F.initial : '') + (F.format ? ' · ' + F.format + (F.viewport ? ' eye viewport ' + F.viewport.join(',') : '') : ''));
    if (F.result) {
      const r = F.result, p = x => (x.ms === null ? '-' : x.ms + ' ms (n ' + x.n + ', p95 ' + x.p95 + ')');
      L.push('    XR eye pass: foveation 0 = ' + p(r.fov0) + ' · foveation 1 = ' + p(r.fov1) + ' · ratio 1 / 0 = ' + (r.ratio ?? '-'));
      L.push('    off-screen control (same draw, no foveation possible): in the foveation 0 frames ' + p(r.ctrl0) + ' · in the foveation 1 frames ' + p(r.ctrl1));
      if (F.readBack) L.push('    layer.fixedFoveation read back after each step: ' + F.readBack.join(', '));
    }
    if (F.events?.length) { const t0 = F.events[0].t; L.push('    timeline (t = ms from the first entry' + (Number.isFinite(t0) ? ', first at ' + Math.round(t0) + ' ms on the page clock' : '') + '; seen = frames the check was called for; draws = heavy draws submitted so far): ' + F.events.map(e => e.k + (e.step !== undefined ? ' ' + e.step : '') + (e.fov !== undefined ? ' fov=' + e.fov : '') + ' t=+' + Math.round(e.t - t0) + ' seen=' + e.seen + ' draws=' + e.draws).join(' · ')); }
    if (F.changedByApp) L.push('    the app set the foveation ' + F.changedByApp + ' time(s) during the check (its own value was put back at the end; the phases around it are not clean)');
    if (F.verdict) L.push('    verdict: ' + F.verdict);
  }
  const W = s.wait;
  if (!W) L.push('  wait after the submit (debug switch, off): off');
  else {
    const ws = waitStats(W);
    L.push('  wait of ' + W.waitMs + ' ms after the volume submit (debug switch on; every 8th frame waits, every 8th other frame does not): d = submit -> onSubmittedWorkDone, vol = the frame\'s volume GPU ms, e = callback end -> onSubmittedWorkDone; medians in ms');
    const row = (n, x) => '    ' + n + ' n ' + x.n + ' · samples with vol longer than the rest of the callback + wait: ' + x.nTell + ' · d - vol in them ' + x.dv + ' (vol ' + x.vol + ') · d ' + x.d + ' · e ' + x.e;
    L.push(row('without wait:', ws.no)); L.push(row('with wait:   ', ws.wait));
    L.push('    (d - vol) with wait - without wait = ' + (ws.diff ?? '-') + ' ms · ' + ws.verdict + (W.skipped ? ' · ' + W.skipped + ' samples skipped (one at a time)' : ''));
  }
  return '\n' + L.join('\n');
}
// the one place the results are gathered: s = { adapter, layer, fovea, wait }; publish() rewrites the single entry in the diagnostic record
export function createCapsRecord(diag, key = 'device caps') {
  const rec = { adapter: null, layer: null, fovea: null, wait: null, foveaDraws: 0, key };
  // set in the record only (the heartbeat's once-a-second flush saves it): diag.value() would write localStorage in the middle of a timing check
  rec.publish = () => { try { if (diag.d?.values) diag.d.values[key] = formatCapsSummary(rec, { subImages: diag.d.values.subImages }); } catch { /* the record is not worth a failure */ } };
  return rec;
}

// the record of a session whose device was just made (d = what vr-wgpu.js requestVrGpuDevice returned): the adapter's features and limits are in the record at once
export function startGxCaps(diag, d) {
  const rec = createCapsRecord(diag);
  rec.adapter = readAdapterCaps(d.adapter, d.device, d.requested || []);
  rec.publish();
  return rec;
}
// the per-frame hook of the session's heartbeat (vr-wgpu.js startGxHeartbeat onFrame): the trial layer's sub image once, then the foveation check. Nothing here throws into the heartbeat's own work.
// hook.done (getter) = the foveation check has ended (finished / unsupported / failed / aborted); false until it exists. The heartbeat calls the hook every frame until then.
// the foveation check draws invisible heavy full-eye passes for about 4 s (120 frames) at the start of every WebGPU session, so it runs only when the debug switch gxFovea is on (opts.fovea = true;
// the page passes effectiveFlag('gxFovea')). Without it the hook reads the trial layer's sub image once, the record says the check is off, and hook.done is true from the first call (no per-frame pose reads, no draws).
export function capsFrameHook(rec, device, opts = {}) {
  const { fovea = false, ...probeOpts } = opts;
  let fov = null, trialDone = false;
  const hook = (frame, pose, s) => {
    if (fovea && !fov) fov = createFoveaProbe({ device, binding: s.binding, layer: s.layer, rec, ...probeOpts }); // rec.fovea is there (state 'waiting') before the first publish: the record never says 'not run' for a check that is about to run
    if (!fovea && !rec.fovea) rec.fovea = { state: 'off', initial: null, steps: [], error: null, events: [], verdict: 'not run: the debug switch gxFovea is off, so no heavy full-eye draw was made in this session' };
    if (!trialDone) { trialDone = true; try { probeTrialSubImage(rec, s.binding, pose.views); rec.publish(); } catch { /* none */ } }
    fov?.frame(frame, pose);
  };
  Object.defineProperty(hook, 'done', { get: () => (fovea ? !!fov && fov.done : trialDone) });
  return hook;
}
