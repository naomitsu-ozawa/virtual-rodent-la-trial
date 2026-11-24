// E0 + E1 (E0 + E1): the WebGPU view's frame work. E0: the volume timestamps of one frame in 8 unless the breakdown is recorded, the diagnostics heartbeat and the performance record saved only at the end of the session
// and when hidden, the heartbeat's thinner polls. E1: the work that feeds no pose and nothing the frame renders is posted after the XR frame callback (docs/vr-post-frame.js). Mock device (CI has no GPU) + source checks of vr-view.js.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREEG from 'three/webgpu';
import { uniformLayout, PROXY_FIELDS, PROXY, VOLUME_BINDINGS } from '../../docs/vr-wgsl-core.js';
import { createVrVolumeRenderer, createGxDiag, startGxHeartbeat, GX_DIAG_KEY, TS_SAMPLE_EVERY } from '../../docs/vr-wgpu.js';
import { createPerfLog, perfReport, PERF_KEY } from '../../docs/vr-perf-log.js';
import { createPostFrame, postFrameMode, flushOnHidden } from '../../docs/vr-post-frame.js';

const src = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const vr = src('vr-view.js'), host = src('vr-wgpu.js'), aq = src('vr-auto-quality.js'), perfsrc = src('vr-perf-log.js');

// ---- the host, driven with a mock device ----
const GPU_GLOBALS = () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
};
const withGpu = fn => async () => { GPU_GLOBALS(); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));
const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
// a device with timestamp-query: script = [[begin, end] ns ticks, ...] in the order the resolves are encoded (low pass, marker, shadow, ...); the log keeps the passes and the commands in the order of encoding
const mockGpu = (script, { timestamps = true } = {}) => {
  const log = { passes: [], cmds: [], buffers: [], textures: [], writes: [], queries: 0, shaders: [], pipelines: [], bindGroups: [], layouts: 0, computePipelines: [], computePasses: [] };
  const device = { features: new Set(timestamps ? ['timestamp-query'] : []), limits: {} };
  device.queue = { writeBuffer: (b, off, data) => { log.writes.push({ b, data: new Int32Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0)) }); }, writeTexture() {}, submit: l => { log.cmds.push('submit'); } };
  device.createQuerySet = d => { log.queries++; return { d, destroy() {} }; };
  device.createBuffer = d => { const b = { d, vals: [0n, 0n], destroyed: false, destroy() { b.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => (d.size > 16 ? new Uint32Array(d.size / 4).buffer : new BigUint64Array(b.vals).buffer), unmap() {} }; log.buffers.push(b); return b; };
  device.createTexture = d => { const t = { d, destroyed: false, destroy() { t.destroyed = true; }, createView: () => ({ t }) }; log.textures.push(t); return t; };
  device.createSampler = () => ({}); device.createBindGroupLayout = () => { log.layouts++; return {}; }; device.createPipelineLayout = () => ({});
  device.createShaderModule = d => { log.shaders.push(d.code); return {}; };
  device.createComputePipeline = d => { const p = { d, compute: true }; log.computePipelines.push(p); return p; }; device.createComputePipelineAsync = async d => device.createComputePipeline(d);
  device.createRenderPipeline = d => { const p = { d }; log.pipelines.push(p); return p; }; device.createRenderPipelineAsync = async d => { const p = { d }; log.pipelines.push(p); return p; };
  device.createBindGroup = d => { const g = { d }; log.bindGroups.push(g); return g; };
  device.createCommandEncoder = () => ({
    beginRenderPass: d => { const p = { d, pipeline: null, groups: {}, viewports: [], scissors: [], draws: 0 }; log.passes.push(p); log.cmds.push('pass'); return { setPipeline: x => { p.pipeline = x; }, setVertexBuffer() {}, setBindGroup: (i, g) => { p.groups[i] = g; }, setViewport: (...a) => p.viewports.push(a), setScissorRect: (...a) => p.scissors.push(a), draw: () => { p.draws++; }, end() {} }; },
    beginComputePass: d => { const p = { d, pipeline: null, groups: {}, dispatches: [], at: log.cmds.length }; log.computePasses.push(p); log.cmds.push('cpass'); return { setPipeline: x => { p.pipeline = x; }, setBindGroup: (i, g) => { p.groups[i] = g; }, dispatchWorkgroups: (...a) => p.dispatches.push(a), end() {} }; },
    resolveQuerySet() {}, copyBufferToBuffer: (_s, _o, dst, _d, n) => { if (n === 16) dst.vals = script.shift(); log.cmds.push('copyB' + n); }, clearBuffer: () => log.cmds.push('clear'), copyTextureToBuffer() {}, finish: () => ({}),
  });
  return { device, log };
};
const drawLow = (r, u = {}) => r.draw({ u, cams: [eyeCam(640, 480), eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false } });
const frame = (r, { u = {} } = {}) => { drawLow(r, u); return r.volume.markFrame(); };
const L = uniformLayout(), PL = uniformLayout(PROXY_FIELDS);
const at = n => L.fields.find(f => f.name === n).offset / 4, pat = n => PL.fields.find(f => f.name === n).offset / 4;
const isMain = w => w.data.length === L.byteSize / 4, isPx = w => w.data.length === PL.byteSize / 4;
// a session's uniforms that let the low pass use the pre-pass: jumps valid (distInCls, useCls), a combined texture on the GPU, no section, two shown slots
const proxyU = (over = {}) => {
  const tex = new THREEG.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4), 4, 4, 4); tex.format = THREEG.RGBAFormat; tex.type = THREEG.UnsignedByteType; tex.needsUpdate = true;
  return { distInCls: { value: 1 }, useCls: { value: 1 }, diag: { value: 0 }, planeCount: { value: 0 }, clsTex: { value: tex }, halfExt: { value: new THREEG.Vector3(1, 1, 1) }, voxelMin: { value: 0.02 }, clsChan: { value: new THREEG.Vector4(0, 1, -1, -1) },
    segA: { value: [0, 1, 2, 3].map(i => new THREEG.Vector4(0, 0, 1, i < 2 ? 1 : 0)) }, ...over };
};
const draw = (r, u, extra = {}) => r.draw({ u, cams: [eyeCam(640, 480), eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false }, ...extra });
const frameOf = (r, u, extra) => { draw(r, u, extra); return r.volume.markFrame(); };

// ---- E0: the volume timestamps of one frame in N (setTimerEvery); the default stays every frame ----
// a device whose buffers count their mapAsync calls; hold = indexes (in call order) of mapAsync calls that stay pending until release()
const counted = (script, hold = []) => {
  const g = mockGpu(script); const c = { maps: 0, held: [], resolve: [] }; const mk = g.device.createBuffer;
  g.device.createBuffer = d => { const b = mk(d); const ma = b.mapAsync; b.mapAsync = (...a) => { const k = c.maps++; if (hold.includes(k)) return new Promise(res => { c.held.push(res); }).then(() => ma(...a)); return ma(...a); }; return b; };
  return { ...g, c };
};
const frameOff = (r, u) => { draw(r, u); return r.volume.markFrame(false); }; // the page is not recording: the frame's record is only rotated

describe('E0 host: the volume timestamps of one frame in N when the page asks (setTimerEvery); every frame by default and while recording', () => {
  it('the default (and setTimerEvery(1)) times every frame, exactly as before: one slot, one resolve and one mapAsync per frame', withGpu(async () => {
    const { device, c } = counted(Array.from({ length: 6 }, () => [1_000_000n, 11_000_000n]));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    for (let i = 0; i < 3; i++) { frameOff(r, {}); await settle(); }
    r.volume.setTimerEvery(1); for (let i = 0; i < 3; i++) { frameOff(r, {}); await settle(); }
    expect(c.maps).toBe(6); const g = r.volume.takeGpuMs(); expect(g.n).toBe(6); expect(g.ms).toBeCloseTo(60);
    r.dispose();
  }));
  it('one frame in 8: frames 1, 9, 17 take a slot and are read back (3 mapAsync in 24 frames, not 24); takeGpuMs is the sampled frames\' sum and count, the same mean per frame', withGpu(async () => {
    const { device, c, log } = counted(Array.from({ length: 6 }, () => [1_000_000n, 11_000_000n]));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.volume.setTimerEvery(8);
    for (let i = 0; i < 24; i++) { frameOff(r, {}); await settle(); }
    expect(c.maps).toBe(3); expect(log.passes).toHaveLength(24); // every frame is drawn, 3 are timed
    expect(log.passes.filter(p => p.d.timestampWrites).length).toBe(3);
    const g = r.volume.takeGpuMs(); expect(g.n).toBe(3); expect(g.ms).toBeCloseTo(30); expect(g.ms / g.n).toBeCloseTo(10);
    expect(r.volume.takeFrameStats()).toBeNull(); // no marker pass either
    r.dispose();
  }));
  it('a sampled frame with the pre-pass: compute + low pass are both timed or both not (the frame is one sample: 2 ms + 10 ms = 12 ms, n 1)', withGpu(async () => {
    const { device, c, log } = counted(Array.from({ length: 6 }, () => [1_000_000n, 3_000_000n]).flatMap(() => [[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n]]));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.volume.setTimerEvery(4); const u = proxyU();
    for (let i = 0; i < 8; i++) { frameOff(r, u); await settle(); }
    expect(log.computePasses).toHaveLength(8); expect(log.computePasses.filter(p => p.d?.timestampWrites).length).toBe(2); // the compute pass of an untimed frame has no slot
    expect(c.maps).toBe(4); // frames 1 and 5: two passes each
    const g = r.volume.takeGpuMs(); expect(g.n).toBe(2); expect(g.ms).toBeCloseTo(24);
    r.dispose();
  }));
  it('a sampled frame enters the numbers as a whole: while its low pass is still being read back neither its compute ms nor a count is taken', withGpu(async () => {
    const { device, c } = counted([[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n]], [1]); // the 2nd mapAsync (the low pass) stays pending
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.volume.setTimerEvery(8); frameOff(r, proxyU()); await settle();
    expect(c.maps).toBe(2); expect(r.volume.takeGpuMs()).toBeNull();
    c.held.forEach(f => f()); await settle();
    const g = r.volume.takeGpuMs(); expect(g.n).toBe(1); expect(g.ms).toBeCloseTo(12);
    r.dispose();
  }));
  it('with every frame timed (1) the passes enter the numbers one by one as before (the compute ms arrives without waiting for the low pass)', withGpu(async () => {
    const { device, c } = counted([[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n]], [1]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    frameOff(r, proxyU()); await settle();
    expect(c.maps).toBe(2); expect(r.volume.takeGpuMs()).toBeNull(); // sumMs holds the compute ms, count is 0: nothing to give yet, as before
    c.held.forEach(f => f()); await settle();
    const g = r.volume.takeGpuMs(); expect(g.n).toBe(1); expect(g.ms).toBeCloseTo(12);
    r.dispose();
  }));
  it('an invalid timestamp (end before start) in a sampled frame leaves the whole frame out of the numbers', withGpu(async () => {
    const { device } = counted([[5_000_000n, 1_000_000n], [1_000_000n, 11_000_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.volume.setTimerEvery(8); frameOff(r, proxyU()); await settle();
    expect(r.volume.takeGpuMs()).toBeNull(); r.dispose();
  }));
  it('recording (the page asks for 1): every frame is timed again, with its marker pass; going back to 8 samples again', withGpu(async () => {
    const { device, c } = counted(Array.from({ length: 40 }, () => [1_000_000n, 2_000_000n]));
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    r.volume.setTimerEvery(8); for (let i = 0; i < 4; i++) { frameOff(r, {}); await settle(); } // frame 1 is sampled
    r.volume.setTimerEvery(1); for (let i = 0; i < 4; i++) { draw(r, {}); r.volume.markFrame(); await settle(); } // recording: a volume pass slot + a marker slot per frame
    r.volume.setTimerEvery(8); for (let i = 0; i < 16; i++) { frameOff(r, {}); await settle(); }
    expect(c.maps).toBe(1 + 8 + 2); // 1 + (4 frames x 2) + 2 (frames 9 and 17 of the 24)
    r.dispose();
  }));
  it('the page asks before every draw: 1 while the breakdown is prepared / recorded, TS_SAMPLE_EVERY otherwise; the default of the host is 1', () => {
    expect(TS_SAMPLE_EVERY).toBe(8);
    const iSet = vr.indexOf('gx.vol.volume.setTimerEvery?.(gxMeasure()?1:TS_SAMPLE_EVERY);'), iDraw = vr.indexOf('gx.vol.draw({u:material.uniforms,cams,');
    expect(iSet).toBeGreaterThan(0); expect(iDraw).toBeGreaterThan(iSet);
    expect(vr.slice(iSet, iDraw)).not.toContain('renderer.render(');
  });
  it('the auto quality of the WebGPU view does not read vol: the frame-interval path only (the ladder is fed no main time, so the timer path of update() is off)', () => {
    // main is fed only by the WebGL timer query path (pollTimers), which does not exist in the WebGPU session (timerExt is null there)
    expect(vr).toContain("const gl=gx?null:renderer.getContext(),timerExt=gl?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;");
    expect(vr.match(/ctrl\[kind\]\+=ms/g)).toHaveLength(1);
    expect(vr).toContain('if(timerExt)pollTimers();');
    expect(aq).toContain('gpu = mainMs > 0');
    expect(aq).toContain('const isOver = gpu ? (total > budget * OVER || dropping) : interval > budget * 1.12;');
  });
});

// ---- E0: the diagnostics heartbeat and the performance record save only at the end and when hidden ----
const listeners = () => { const ls = {}; return { ls, addEventListener(t, f) { (ls[t] ||= []).push(f); }, removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); }, fire(t) { for (const f of [...(ls[t] || [])]) f({}); }, n: t => (ls[t] || []).length }; };
const memStore = () => { const m = new Map(), sets = []; return { m, sets, setItem: (k, v) => { sets.push(k); m.set(k, v); }, getItem: k => m.get(k) ?? null }; };
const hbSession = () => {
  const ev = listeners(), cbs = []; let getPose = 0;
  const s = Object.assign(ev, { cbs, inputSources: [], visibilityState: 'visible', ended: 0, requestAnimationFrame(cb) { cbs.push(cb); return cbs.length; }, end() { this.ended++; return Promise.resolve(); },
    frame() { const list = cbs.splice(0); for (const cb of list) cb(0, { getViewerPose: () => { getPose++; return { views: [{ eye: 'left' }] }; } }); } });
  Object.defineProperty(s, 'posesRead', { get: () => getPose });
  return s;
};
describe('E0: the diagnostics heartbeat does not save once a second; it saves when the page / the session is hidden, and its work per frame is small', () => {
  it('no localStorage write from the frames, however long the session runs; the stages and errors still write at once (the crash trail)', () => {
    let t = 0; const store = memStore(), s = hbSession(), doc = listeners(); doc.visibilityState = 'visible';
    const g = createGxDiag({ now: () => t, store }); g.stage('start'); const stageSets = store.sets.length;
    startGxHeartbeat({ session: s, diag: g, state: () => ({ bound: true, rendered: 1 }), now: () => t, doc });
    for (let i = 0; i < 400; i++) { t += 14; s.frame(); } // 5.6 s of frames
    expect(store.sets.length).toBe(stageSets); expect(g.d.counts.xrFrames).toBe(400);
    g.error('x', new Error('boom')); expect(store.sets.length).toBe(stageSets + 1);
  });
  it('the record is saved in full when the document or the session is hidden (not visible, not visible-blurred); stop() takes the listeners off', () => {
    const store = memStore(), s = hbSession(), doc = listeners(); doc.visibilityState = 'visible';
    const g = createGxDiag({ store }); const hb = startGxHeartbeat({ session: s, diag: g, state: () => ({ bound: true, rendered: 1 }), doc });
    for (let i = 0; i < 5; i++) s.frame(); const n0 = store.sets.length;
    doc.fire('visibilitychange'); s.fire('visibilitychange'); expect(store.sets.length).toBe(n0); // visible: nothing
    doc.visibilityState = 'hidden'; doc.fire('visibilitychange'); expect(store.sets.length).toBe(n0 + 1); expect(JSON.parse(store.getItem(GX_DIAG_KEY)).counts.xrFrames).toBe(5);
    doc.visibilityState = 'visible'; s.visibilityState = 'visible-blurred'; s.fire('visibilitychange'); expect(store.sets.length).toBe(n0 + 1); // the system menu over the session is not hidden
    s.visibilityState = 'hidden'; s.fire('visibilitychange'); expect(store.sets.length).toBe(n0 + 2);
    hb.stop(); expect(doc.n('visibilitychange')).toBe(0); expect(s.n('visibilitychange')).toBe(0); s.fire('visibilitychange'); expect(store.sets.length).toBe(n0 + 2);
  });
  it('a store that throws does not break the hidden save', () => {
    const s = hbSession(), doc = listeners(); doc.visibilityState = 'hidden'; const g = createGxDiag({ store: { setItem() { throw new Error('full'); } } });
    startGxHeartbeat({ session: s, diag: g, state: () => ({}), doc }); expect(() => doc.fire('visibilitychange')).not.toThrow();
  });
  it('the pose is read every frame until the sub images are read, then every poseEvery-th frame (poses counts poseEvery for each)', () => {
    let t = 0; const s = hbSession(), g = createGxDiag({ store: null, now: () => t }), doc = listeners();
    const st = { bound: true, rendered: 0, ref: {}, binding: { getViewSubImage: () => ({ colorTexture: { format: 'bgra8unorm' }, viewport: { x: 0, y: 0, width: 1, height: 1 } }) }, layer: {} };
    startGxHeartbeat({ session: s, diag: g, state: () => st, now: () => t, stallFrames: 1e9, poseEvery: 16, doc });
    for (let i = 0; i < 65; i++) { t += 14; st.rendered++; s.frame(); }
    expect(g.d.counts.xrFrames).toBe(65); expect(s.posesRead).toBe(1 + 4); // frame 1 (sub images read), then the 16th, 32nd, 48th, 64th
    expect(g.d.counts.poses).toBe(1 + 4 * 16); expect(g.d.values.subImages[0].format).toBe('bgra8unorm');
  });
  it('the escape: the controllers are read at most once per escapePollMs of TIME, so a slow frame rate still reads them every frame and the 2 s hold ends the session on time at any cadence', () => {
    const held = { gamepad: { buttons: [{ pressed: true }, { pressed: true }] } };
    for (const [step, poll] of [[14, 50], [200, 50], [1000, 50], [14, 0]]) {
      let t = 0, reads = 0; const s = hbSession(), g = createGxDiag({ store: null, now: () => t }), st = { bound: true, rendered: 0 };
      Object.defineProperty(s, 'inputSources', { get: () => { reads++; return [held, held]; } });
      startGxHeartbeat({ session: s, diag: g, state: () => st, now: () => t, escapeMs: 2000, stallFrames: 1e9, escapePollMs: poll, doc: listeners() });
      let frames = 0; while (!s.ended && frames < 100000) { t += step; st.rendered++; s.frame(); frames++; }
      expect(s.ended, 'step ' + step).toBe(1); expect(t, 'step ' + step).toBeLessThanOrEqual(2000 + Math.max(step, poll) + step + 1);
      if (step === 14 && poll === 50) expect(reads).toBeLessThan(frames); // thinned at a fast cadence
      if (step >= 50) expect(reads).toBe(frames); // every frame at a slow one
      expect(g.d.stages.find(x => x.name === 'auto-end').info).toBe('escape held');
    }
  });
  it('the stall guard still counts every frame (poseEvery / escapePollMs do not thin it)', () => {
    const s = hbSession(), g = createGxDiag({ store: null }), st = { bound: true, rendered: 0 }, doc = listeners();
    startGxHeartbeat({ session: s, diag: g, state: () => st, stallFrames: 10, poseEvery: 16, escapePollMs: 50, doc });
    for (let i = 0; i < 9; i++) s.frame(); expect(s.ended).toBe(0); s.frame(); s.frame(); expect(s.ended).toBe(1);
  });
  it('vr-view.js: the heartbeat is given the thinned polls; there is no other once-a-second flush in it', () => {
    expect(vr).toContain("onEnd:()=>step('gpu-closed'),poseEvery:GX_POSE_EVERY,escapePollMs:GX_ESCAPE_POLL_MS})");
    expect(host).not.toMatch(/n - lastSave >= 1000/); expect(host).not.toContain('lastSave');
    expect(vr).toContain("gxD.stage('session end',{frames:gxD.d.counts.xrFrames,rendered:gxD.d.counts.rendered});gxD.flush();"); // the end of the session still saves in full
  });
});
describe('E0: the performance record\'s mirror is written at the end of the session and when hidden, not every 5 s', () => {
  it('saveEveryMs Infinity: rows never write the mirror; flush() does (the end of the session, the hidden listener)', () => {
    let clock = 0; const st = memStore(), log = createPerfLog({ kind: 'webgpu', now: () => clock, store: st, saveEveryMs: Infinity });
    for (let i = 1; i <= 40; i++) { clock = i * 1000; log.row({ menu: 0 }); }
    expect(st.sets.length).toBe(0); log.flush(); expect(st.sets.length).toBe(1);
    expect(JSON.parse(st.m.get(PERF_KEY + '-webgpu')).rows.length).toBe(40);
  });
  it('vr-view.js: the record is made with no periodic save, flushed when hidden (listeners removed at the end of the session) and at the end', () => {
    expect(vr).toContain("perfLog=createPerfLog({kind:gx?'webgpu':'webgl',mode,saveEveryMs:Infinity});");
    expect(vr).toContain("const perfHideOff=flushOnHidden(()=>perfLog?.flush(),{session});");
    expect(vr).toContain('const cleanup=()=>{perfHideOff();post.clear();');
    expect(vr).toContain("if(!gxD)session.addEventListener('end',()=>{perfLog.flush();");
    expect(vr).toContain("gxD.flush();const dg=gxD;perfLog?.flush();");
  });
  it('the report text carries the meta lines: the `post frame` line and the GPU timers line reach the copied text / saved file', () => {
    const log = createPerfLog({ kind: 'webgpu', now: () => 0, store: null, saveEveryMs: Infinity });
    log.meta['post frame'] = 'task · jobs 3 in 2 runs · late 0'; log.meta['GPU timers'] = 'volume timestamp-query (one frame in 8 unless the breakdown is recorded)'; log.row({ menu: 0 }, 1000);
    const text = perfReport(log, { build: 'x' });
    expect(text).toContain('post frame: task · jobs 3 in 2 runs · late 0'); expect(text).toContain('GPU timers: volume timestamp-query (one frame in 8');
  });
  it('flushOnHidden: document hidden or session hidden call it; visible and visible-blurred do not; remove() takes both listeners off; a throwing fn is swallowed', () => {
    const doc = listeners(), s = listeners(); doc.visibilityState = 'visible'; const fn = vi.fn();
    const off = flushOnHidden(fn, { doc, session: s });
    doc.fire('visibilitychange'); s.fire('visibilitychange'); expect(fn).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden'; doc.fire('visibilitychange'); expect(fn).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible'; s.visibilityState = 'hidden'; s.fire('visibilitychange'); s.visibilityState = 'visible-blurred'; s.fire('visibilitychange'); expect(fn).toHaveBeenCalledTimes(2);
    off(); expect(doc.n('visibilitychange')).toBe(0); expect(s.n('visibilitychange')).toBe(0);
    const bad = flushOnHidden(() => { throw new Error('x'); }, { doc, session: s }); doc.visibilityState = 'hidden'; expect(() => doc.fire('visibilitychange')).not.toThrow(); bad();
  });
});

// ---- E1: the post-frame scheduler ----
const fakeChannel = () => { const q = []; const post = fn => q.push(fn); post.q = q; post.run = () => { const l = q.splice(0); l.forEach(f => f()); }; return post; };
describe('E1: createPostFrame (work after the XR frame callback)', () => {
  it('a requested job does not run in the callback; schedule() posts one task; the task runs it once with the latest argument (a second request coalesces)', () => {
    const ch = fakeChannel(), p = createPostFrame({ channel: ch }); const fn = vi.fn(); const j = p.job(fn);
    p.tail(2); p.tail(4); expect(p.stats()).toMatchObject({ cbN: 2, cbMs: 6, cbMax: 4 });
    p.request(j, 1); p.request(j, 2); expect(fn).not.toHaveBeenCalled(); expect(p.pending()).toBe(1);
    p.schedule(); p.schedule(); expect(ch.q).toHaveLength(1); // one task, however often it is asked
    ch.run(); expect(fn).toHaveBeenCalledTimes(1); expect(fn).toHaveBeenCalledWith(2); expect(p.pending()).toBe(0);
    p.request(j, 3); p.schedule(); ch.run(); expect(fn).toHaveBeenLastCalledWith(3); expect(p.stats()).toMatchObject({ ran: 2, runs: 2, late: 0 });
  });
  it('nothing queued = nothing posted; jobs run in the order they were requested', () => {
    const ch = fakeChannel(), p = createPostFrame({ channel: ch }), out = []; const a = p.job(() => out.push('a')), b = p.job(() => out.push('b'));
    p.schedule(); expect(ch.q).toHaveLength(0);
    p.request(b); p.request(a); p.schedule(); ch.run(); expect(out).toEqual(['b', 'a']);
  });
  it('drain() at the start of the next callback runs what the task has not run (late), and the task that comes after finds nothing', () => {
    const ch = fakeChannel(), p = createPostFrame({ channel: ch }); const fn = vi.fn(); const j = p.job(fn);
    p.request(j, 'x'); p.schedule(); expect(p.drain()).toBe(true); expect(fn).toHaveBeenCalledTimes(1);
    ch.run(); expect(fn).toHaveBeenCalledTimes(1); expect(p.stats().late).toBe(1); expect(p.drain()).toBe(false);
    p.request(j, 'y'); p.schedule(); expect(ch.q).toHaveLength(1); ch.run(); expect(fn).toHaveBeenCalledTimes(2); // the scheduler is not stuck after a late run
  });
  it('mode off runs the job on the spot (the order of the code before E1); micro uses the microtask queue; a throwing job does not stop the others', async () => {
    const off = createPostFrame({ mode: 'off' }); const f1 = vi.fn(); off.request(off.job(f1), 7); expect(f1).toHaveBeenCalledWith(7); off.schedule(); expect(off.pending()).toBe(0);
    const mq = []; const mic = createPostFrame({ mode: 'micro', micro: f => mq.push(f) }); const f2 = vi.fn(); mic.request(mic.job(f2)); mic.schedule(); expect(f2).not.toHaveBeenCalled(); mq.shift()(); expect(f2).toHaveBeenCalledTimes(1);
    const ch = fakeChannel(), p = createPostFrame({ channel: ch }), ok = vi.fn(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    p.request(p.job(() => { throw new Error('x'); })); p.request(p.job(ok)); p.schedule(); ch.run(); expect(ok).toHaveBeenCalled(); warn.mockRestore();
  });
  it('clear() drops what is waiting (a session\'s end); the default channel is a MessageChannel task (not a timer)', async () => {
    const ch = fakeChannel(), p = createPostFrame({ channel: ch }); const fn = vi.fn(); p.request(p.job(fn)); p.schedule(); p.clear(); ch.run(); expect(fn).not.toHaveBeenCalled();
    const real = createPostFrame(); const f = vi.fn(); real.request(real.job(f)); real.schedule(); expect(f).not.toHaveBeenCalled(); await new Promise(r => setTimeout(r, 20)); expect(f).toHaveBeenCalledTimes(1);
    expect(src('vr-post-frame.js')).toContain('new MessageChannel()');
  });
  it('the mode comes from ?vrpost=; anything else is the task', () => {
    expect(postFrameMode('?vrpost=off')).toBe('off'); expect(postFrameMode('?a=1&vrpost=micro')).toBe('micro'); expect(postFrameMode('?vrpost=task')).toBe('task');
    expect(postFrameMode('?vrpost=zzz')).toBe('task'); expect(postFrameMode('')).toBe('task'); expect(postFrameMode(undefined)).toBe('task');
  });
});

// ---- E1: the wiring in vr-view.js (a WebXR file, checked on its source) ----
const loopStart = vr.indexOf('renderer.setAnimationLoop(xrTs=>{'), loopEnd = vr.indexOf(' const cleanup=()=>{');
const loop = vr.slice(loopStart, loopEnd);
const secondFn = vr.slice(vr.indexOf(' const secondTick=now=>{'), loopStart);
const jobsAt = vr.indexOf(' const post=createPostFrame('), jobsText = vr.slice(jobsAt, loopStart);
describe('E1: what moved out of the frame callback (WebGPU session; the WebGL session keeps its order)', () => {
  it('the frame loop is where expected', () => { expect(loopStart).toBeGreaterThan(0); expect(loopEnd).toBeGreaterThan(loopStart); expect(jobsAt).toBeGreaterThan(0); expect(secondFn.length).toBeGreaterThan(500); });
  it('the once-a-second block (status lines, the record\'s row, the menu\'s probe / refresh) is not in the callback any more: the callback only decides it is due and posts it (WebGPU) or calls it (WebGL)', () => {
    for (const t of ['perfLog.row(', 'ui.fpsLine=', 'ui.sizeLine=', 'ui.diagLine=', 'if(ui.open&&(ui.tab===4||ui.flash))menu.refresh();', 'help.flush()', 'gxD.d.values[\'drawn region\']']) expect(loop, t).not.toContain(t);
    expect(loop).toContain('if(now-fpsAt>=1000){\n   fps=frames*1000/(now-fpsAt);frames=0;fpsAt=now;\n   if(gx)post.request(jSecond,now);else secondTick(now);\n  }');
    for (const t of ['perfLog.row({f:rs.eff', 'ui.fpsLine=', 'ui.sizeLine=', 'ui.diagLine=', 'if(ui.open&&ui.tab===4)try{measureSamples()}', 'for(const k in sums){sums[k]=0;counts[k]=0}']) expect(secondFn, t).toContain(t);
    expect(jobsText).toContain('const jSecond=post.job(now=>{if(running?.session!==session)return;secondTick(now)});');
  });
  it('the boards\' canvas redraws (menu, help board, loading board) are posted when the board was already up; a board that has just appeared is drawn in its first frame; the WebGL session flushes as before', () => {
    expect(loop).toContain('if(ui.open&&(!gx||!boardLive.menu))menu.flush();');
    expect(loop).toContain('if(!gx||!boardLive.help||!help.mesh.visible)helpTick();');
    expect(loop).toContain('if(!gx||!boardLive.load)loadBoard.flush()}else if(loadBoard.mesh.visible)loadBoard.mesh.visible=false;');
    expect(loop).toContain('if(gx){boardLive.menu=ui.open;boardLive.help=help.mesh.visible;boardLive.load=!!loadInfo;post.request(jBoards)}');
    expect(jobsText).toContain('const jBoards=post.job(()=>{if(running?.session!==session)return;if(boardLive.menu)menu.flush();if(boardLive.help)helpTick();if(boardLive.load)loadBoard.flush()});');
    expect(loop.match(/menu\.flush\(\)/g)).toHaveLength(1); expect(loop.match(/loadBoard\.flush\(\)/g)).toHaveLength(1); expect(loop).not.toContain('help.flush()');
    expect(jobsText).toContain("const hk=[section.on,ui.open,ui.open&&ui.tab===10,helpShow].join()+(tutVr?tutVr.drawKey():'')+(tutPreview&&helpShow==='detail'?tutPreview.drawKey():'');if(hk!==helpKey){helpKey=hk;help.refresh()}help.flush()");
  });
  it('none of the moved work is called in the callback: the jobs run only through post (and secondTick only in the WebGL branch)', () => {
    expect(loop.match(/secondTick\(/g)).toHaveLength(1); expect(loop.match(/post\.request\(jBoards\)/g)).toHaveLength(1); expect(loop.match(/post\.request\(jSecond,now\)/g)).toHaveLength(1);
    expect(vr.match(/secondTick\(now\)/g)).toHaveLength(2); // the WebGL branch of the callback, the WebGPU job
    expect(vr.match(/helpTick\(\)/g)).toHaveLength(2); // the first frame of the help board (callback), the job
  });
  it('the task is drained at the start of a callback and posted after the last submit of it (volume pass, main render, frame end), once', () => {
    const fa0 = loop.indexOf('const fa0=performance.now();'), drain = loop.indexOf('if(gx)post.drain();'), draw = loop.indexOf('gx.vol.draw({u:material.uniforms,cams,'), sub = loop.indexOf('gxVolSubmitted(fa0);'), render = loop.indexOf('if(gx)gxRender();else timed('), end = loop.indexOf('if(gx)gxFrameEnd(fa0);'), sched = loop.indexOf('if(gx){post.tail(performance.now()-fa0);post.schedule()}');
    expect(fa0).toBeGreaterThan(0); expect(drain).toBeGreaterThan(fa0); expect(drain - fa0).toBeLessThan(250);
    expect(draw).toBeGreaterThan(drain); expect(sub).toBeGreaterThan(draw); expect(render).toBeGreaterThan(sub); expect(end).toBeGreaterThan(render); expect(sched).toBeGreaterThan(end);
    expect(loop.match(/post\.schedule\(\)/g)).toHaveLength(1); expect(loop.match(/post\.tail\(/g)).toHaveLength(1); expect(loop.match(/post\.drain\(\)/g)).toHaveLength(1);
    expect(loop.indexOf('labelBatch.flush(renderer,camera);')).toBeLessThan(render); // the cards of this frame are still drawn before the render (their place comes from this frame's pose)
  });
  it('the volume pass is submitted where it was: its draw comes after the controller / placement work and before the late hands / cards / markers and the render (the order of)', () => {
    const draw = loop.indexOf('gx.vol.draw({u:material.uniforms,cams,'), late = loop.indexOf('if(gx){lateHints();lateScale();lateHud();lateCards();lateMarks()}');
    expect(draw).toBeGreaterThan(0); expect(late).toBeGreaterThan(draw);
  });
  it('the session\'s end drops what is waiting; the post object exists for both sessions (WebGL: mode off, never scheduled)', () => {
    expect(vr).toContain("const post=createPostFrame({mode:gx?'task':'off'})");
    expect(vr).toContain('const cleanup=()=>{perfHideOff();post.clear();');
    expect(loop.match(/post\./g).length).toBe(5); // drain, request x2 (jBoards, jSecond), schedule: all behind `gx`
    for (const t of ['if(gx)post.drain();', 'if(gx){boardLive.menu=ui.open;', 'if(gx)post.request(jSecond,now);else secondTick(now);', 'if(gx){post.tail(performance.now()-fa0);post.schedule()}']) expect(loop, t).toContain(t);
  });
  it('the record says which way the work runs and what it costs (header line `post frame`), the cpu and pre columns stay (the callback\'s length)', () => {
    expect(secondFn).toContain("perfLog.meta['post frame']=post.mode+' · jobs '"); expect(secondFn).toContain("· callback (whole) mean '");
    expect(vr).toContain("perfLog.add('cpu',t1-fa0)"); expect(vr).toContain("perfLog.add('pre',tv-fa0)");
    expect(perfsrc).toMatch(/\['cpu', 6\]/); expect(perfsrc).toMatch(/\['pre', 6\]/);
  });
});

// ---- the measurements of the timestamp path (gauges the page takes once a frame; performance.now() and numbers only) ----
describe('host gauges: ml (mapAsync latency), gd (GPU start gap minus CPU submit gap), vol, and the leftovers of the recording', () => {
  const clock = () => { const c = { T: 0 }; vi.spyOn(performance, 'now').mockImplementation(() => c.T); return c; };
  it('ml is the longest mapAsync (call to resolved) since the last take; gd compares the GPU start of two successive measured frames with their CPU submit times; vol is the frame\'s volume ms; a take clears them', withGpu(async () => {
    const c = clock();
    try {
      const { device } = counted([[1_000_000n, 11_000_000n], [21_000_000n, 31_000_000n], [61_000_000n, 69_000_000n]]);
      const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); const out = { ml: 0, gd: 0, vol: 0 };
      c.T = 100; frameOff(r, {}); c.T = 103; await settle();
      expect(r.volume.takeGauges(out)).toBe(out); expect(out.ml).toBeCloseTo(3, 5); expect(out.vol).toBeCloseTo(10, 5); expect(Number.isNaN(out.gd)).toBe(true); // the first measured frame has nothing to compare with
      r.volume.takeGauges(out); expect(Number.isNaN(out.ml) && Number.isNaN(out.gd) && Number.isNaN(out.vol)).toBe(true); // cleared by the take
      c.T = 116; frameOff(r, {}); c.T = 121; await settle(); // GPU start 20 ms after the first, submitted 16 ms after it
      r.volume.takeGauges(out); expect(out.ml).toBeCloseTo(5, 5); expect(out.gd).toBeCloseTo(4, 5); expect(out.vol).toBeCloseTo(10, 5);
      c.T = 130; frameOff(r, {}); c.T = 130.5; await settle(); // GPU start 40 ms after the second, submitted 14 ms after it
      r.volume.takeGauges(out); expect(out.gd).toBeCloseTo(26, 5); expect(out.ml).toBeCloseTo(0.5, 5); expect(out.vol).toBeCloseTo(8, 5);
      r.dispose();
    } finally { vi.restoreAllMocks(); }
  }));
  it('frames that are not timed give no gauge (one frame in 8): gd compares the successive MEASURED frames', withGpu(async () => {
    const c = clock();
    try {
      const { device } = counted([[1_000_000n, 11_000_000n], [101_000_000n, 111_000_000n]]);
      const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); r.volume.setTimerEvery(8); const out = {};
      for (let i = 0; i < 9; i++) { c.T = 1000 + i * 12; frameOff(r, {}); await settle(); }
      r.volume.takeGauges(out); expect(out.gd).toBeCloseTo(100 - 96, 5); // frames 1 and 9: GPU 100 ms apart, CPU 96 ms apart
      r.dispose();
    } finally { vi.restoreAllMocks(); }
  }));
  it('leftovers(): the timer period, the busy slots, whether the breakdown exists, bind groups, pipelines and uniform buffers', withGpu(async () => {
    const { device } = counted([[1_000_000n, 11_000_000n]], [0]); // the read-back stays pending: its slot stays in use
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    expect(r.volume.leftovers()).toMatchObject({ every: 1, slotsBusy: 0, bd: false, ubufs: 4 });
    frameOff(r, {}); await settle(); const o = r.volume.leftovers();
    expect(o.slotsBusy).toBe(1); expect(o.slots).toBeGreaterThan(1); expect(o.groups).toBeGreaterThan(0); expect(o.pipes).toBeGreaterThan(0);
    r.volume.setTimerEvery(8); expect(r.volume.leftovers().every).toBe(8);
    r.dispose();
  }));
  it('the sources: the gauges are numbers in a fixed object (no new promise or GPU command), the submit time is taken with performance.now()', () => {
    expect(host).toContain('const gauge = { ml: NaN, gd: NaN, vol: NaN }'); expect(host).toContain('if (rec && rec.sub === null) rec.sub = performance.now();');
    expect(host).toContain('const m0 = performance.now();'); expect(host).toContain('const ml = performance.now() - m0; if (!(ml <= gauge.ml)) gauge.ml = ml;');
    expect(host).toContain('const stats = { poseReads: 0, poseMs: 0 };'); expect(host).toContain('onFrame.done === false');
  });
});
