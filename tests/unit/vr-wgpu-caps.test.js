import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { requestVrGpuDevice, createGxDiag, gxDiagReport, startGxHeartbeat } from '../../docs/vr-wgpu.js';
import {
  readLimits, readFeatures, readAdapterCaps, usageText, installLayerWrap, probeTrialSubImage, foveaVerdict, createFoveaProbe, createWaitProbe, waitStats,
  formatCapsSummary, createCapsRecord, startGxCaps, capsFrameHook, GXC_USAGE_LADDER, GXC_HEAVY_WGSL,
} from '../../docs/vr-wgpu-caps.js';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { DEBUG_SWITCHES, DEBUG_SETTING_DEFAULTS, debugFlag } from '../../docs/debug-flags.js';
import { SETTINGS_DEFAULTS } from '../../docs/app-settings.js';
import { I18N } from '../../docs/i18n.js';

const src = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const flush = () => new Promise(r => setTimeout(r, 0));

// limits as WebIDL objects have them: getters on the prototype, not own properties
class FakeLimits { get maxTextureDimension3D() { return 2048; } get maxStorageBufferBindingSize() { return 1 << 30; } get maxBindGroups() { return 4; } }
class DeviceLimits { get maxTextureDimension3D() { return 2048; } get maxStorageBufferBindingSize() { return 1 << 27; } get maxBindGroups() { return 4; } }

describe('features and limits: the whole lists, in the record', () => {
  it('reads every limit of a prototype-getter object, sorted, and the features sorted', () => {
    expect(readLimits(new FakeLimits())).toEqual({ maxBindGroups: 4, maxStorageBufferBindingSize: 1073741824, maxTextureDimension3D: 2048 });
    expect(Object.keys(readLimits(new FakeLimits()))).toEqual(['maxBindGroups', 'maxStorageBufferBindingSize', 'maxTextureDimension3D']);
    expect(readLimits({ a: 1, b: 'x', c: 3 })).toEqual({ a: 1, c: 3 });
    expect(readLimits(null)).toEqual({});
    expect(readFeatures(new Set(['shader-f16', 'subgroups', 'timestamp-query']))).toEqual(['shader-f16', 'subgroups', 'timestamp-query']);
    expect(readFeatures(null)).toEqual([]);
  });
  it('says which of the features of interest the device has, which only the adapter lists, and which are missing; and which limits the device got lower', () => {
    const adapter = { features: new Set(['shader-f16', 'subgroups', 'timestamp-query', 'float32-filterable', 'depth32float-stencil8']), limits: new FakeLimits() };
    const device = { features: new Set(['shader-f16', 'timestamp-query']), limits: new DeviceLimits(), adapterInfo: { vendor: 'qualcomm', architecture: 'adreno-7xx', device: '', description: 'Adreno', subgroupMinSize: 64, subgroupMaxSize: 128 } };
    const c = readAdapterCaps(adapter, device, ['shader-f16', 'timestamp-query', 'subgroups']);
    expect(c.features).toEqual(['depth32float-stencil8', 'float32-filterable', 'shader-f16', 'subgroups', 'timestamp-query']);
    expect(c.deviceFeatures).toEqual(['shader-f16', 'timestamp-query']);
    expect(c.interest).toMatchObject({ subgroups: 'adapter only', 'shader-f16': 'device', 'timestamp-query': 'device', 'float32-filterable': 'adapter only', 'subgroups-f16': 'no' });
    expect(c.notGranted).toEqual(['subgroups']);
    expect(c.limitsDiffer).toEqual({ maxStorageBufferBindingSize: [1 << 30, 1 << 27] });
    expect(c.info).toMatchObject({ vendor: 'qualcomm', subgroupMinSize: 64, subgroupMaxSize: 128 });
    const text = formatCapsSummary({ adapter: c });
    expect(text).toContain('subgroups=adapter only');
    expect(text).toContain('NOT granted: subgroups');
    expect(text).toContain('maxStorageBufferBindingSize 1073741824->134217728');
    expect(text).toContain('subgroup size 64..128');
  });
  it('nothing throws on a device without limits / info', () => {
    expect(() => readAdapterCaps({ features: new Set() }, {}, [])).not.toThrow();
    expect(() => formatCapsSummary({ adapter: readAdapterCaps(null, null, []) })).not.toThrow();
  });
  it('the summary is ONE entry of the values section of the record', () => {
    const diag = createGxDiag({ store: null });
    const rec = startGxCaps(diag, { adapter: { features: new Set(['subgroups']), limits: new FakeLimits() }, device: { features: new Set(['subgroups']), limits: new FakeLimits() }, requested: ['subgroups'] });
    rec.fovea = { state: 'done', initial: 1, steps: [], result: { fov0: { ms: 4, n: 10, p95: 4.2 }, fov1: { ms: 2, n: 10, p95: 2.1 }, ctrl0: { ms: 3, n: 10, p95: 3 }, ctrl1: { ms: 3, n: 10, p95: 3 }, ratio: 0.5 }, verdict: 'EFFECTIVE' };
    rec.publish();
    expect(Object.keys(diag.d.values)).toEqual(['device caps']);
    const text = gxDiagReport(diag.d);
    expect(text).toContain('device caps:');
    expect(text).toContain('subgroups=device');
    expect(text).toContain('ratio 1 / 0 = 0.5');
  });
});

describe('requestVrGpuDevice asks for subgroups when the adapter lists it', () => {
  const setup = (adapter) => {
    const nav = { gpu: { requestAdapter: async () => adapter } };
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    globalThis.XRGPUBinding = function () {};
  };
  const adapterOf = (features, refuse = () => false) => {
    const a = { features: new Set(features), calls: [], async requestDevice(o) { a.calls.push(o?.requiredFeatures ? [...o.requiredFeatures] : null); if (o?.requiredFeatures && refuse(o.requiredFeatures)) throw new Error('refused'); return { features: new Set(o?.requiredFeatures || []) }; } };
    return a;
  };
  const nav0 = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  afterAll(() => { if (nav0) Object.defineProperty(globalThis, 'navigator', nav0); else delete globalThis.navigator; delete globalThis.XRGPUBinding; });
  it('adds subgroups to the three it asked for before', async () => {
    const a = adapterOf(['shader-f16', 'timestamp-query', 'float32-filterable', 'subgroups']); setup(a);
    const d = await requestVrGpuDevice();
    expect(a.calls).toEqual([['shader-f16', 'timestamp-query', 'float32-filterable', 'subgroups']]);
    expect(d).toMatchObject({ f16: true, timestamps: true, subgroups: true });
    expect(d.requested).toEqual(['shader-f16', 'timestamp-query', 'float32-filterable', 'subgroups']);
  });
  it('without subgroups on the adapter the request is the same three as before', async () => {
    const a = adapterOf(['shader-f16', 'timestamp-query']); setup(a);
    const d = await requestVrGpuDevice();
    expect(a.calls).toEqual([['shader-f16', 'timestamp-query']]); expect(d.subgroups).toBe(false);
  });
  it('a device that refuses subgroups is asked again with the three, then with none', async () => {
    const a = adapterOf(['shader-f16', 'timestamp-query', 'subgroups'], f => f.includes('subgroups')); setup(a);
    const d = await requestVrGpuDevice();
    expect(a.calls).toEqual([['shader-f16', 'timestamp-query', 'subgroups'], ['shader-f16', 'timestamp-query']]);
    expect(d).toMatchObject({ f16: true, subgroups: false });
    const b = adapterOf(['shader-f16'], f => f.length > 0); setup(b);
    const e = await requestVrGpuDevice();
    expect(b.calls).toEqual([['shader-f16'], null]); expect(e).toMatchObject({ f16: false, requested: [] });
  });
});

describe('the projection layer with a textureUsage: three.js\' call is wrapped, the display layer stays the plain call', () => {
  const mkProto = ({ failUsage = () => false, failPlain = false } = {}) => {
    const calls = [], made = [];
    const proto = { createProjectionLayer(init) {
      calls.push(init);
      if (init?.textureUsage !== undefined && failUsage(init.textureUsage)) throw new TypeError('textureUsage ' + init.textureUsage + ' is not supported');
      if (init?.textureUsage === undefined && failPlain) throw new Error('plain failed');
      const l = { init, textureWidth: 1680, textureHeight: 1760, textureArrayLength: 2, destroyed: 0, destroy() { this.destroyed++; } }; made.push(l); return l;
    } };
    return { proto, calls, made, orig: proto.createProjectionLayer };
  };
  it('probe: the display layer is made with the init as given (no textureUsage); the trial layers come after it and are let go', () => {
    const { proto, calls, made, orig } = mkProto(), rec = {};
    const restore = installLayerWrap(proto, rec);
    const real = proto.createProjectionLayer({ colorFormat: 'rgba8unorm' });
    expect(calls[0]).toEqual({ colorFormat: 'rgba8unorm' }); expect(real).toBe(made[0]); expect(real.init.textureUsage).toBeUndefined();
    expect(calls[1]).toEqual({ colorFormat: 'rgba8unorm', textureUsage: GXC_USAGE_LADDER[0] }); expect(GXC_USAGE_LADDER[0]).toBe(16 | 8 | 2 | 4);
    expect(rec.layer).toMatchObject({ mode: 'probe', display: { withUsage: false }, tried: [{ usage: 30, ok: true, w: 1680, h: 1760, layers: 2 }] });
    expect(rec.layer.trial).toBe(made[1]);
    const binding = { getViewSubImage: (l, v) => ({ colorTexture: { usage: l === made[1] ? 30 : 16, format: 'rgba8unorm', width: 1680, height: 1760 } }) };
    probeTrialSubImage(rec, binding, [{ eye: 'left' }]);
    expect(rec.layer.trialSub).toEqual([{ eye: 'left', usage: 30, format: 'rgba8unorm', w: 1680, h: 1760 }]); expect(made[1].destroyed).toBe(1); expect(rec.layer.trial).toBeNull();
    expect(made[0].destroyed).toBe(0); // the display layer is never touched
    proto.createProjectionLayer({ colorFormat: 'x' }); expect(calls).toHaveLength(3); // a later call passes through
    restore(); expect(proto.createProjectionLayer).toBe(orig);
  });
  it('probe: a refused usage is recorded with its exception text and the next one is tried; the display layer is not affected', () => {
    const { proto, made } = mkProto({ failUsage: u => (u & 8) !== 0 }), rec = {};
    installLayerWrap(proto, rec);
    const real = proto.createProjectionLayer({ colorFormat: 'rgba8unorm' });
    expect(real).toBe(made[0]);
    expect(rec.layer.tried.map(t => [t.usage, t.ok])).toEqual([[30, false], [18, true]]);
    expect(rec.layer.tried[0].error).toContain('TypeError: textureUsage 30 is not supported');
    const text = formatCapsSummary({ layer: rec.layer });
    expect(text).toContain('EXCEPTION TypeError: textureUsage 30 is not supported'); expect(text).toContain('created 1680x1760x2');
  });
  it('probe: when every trial throws the layer is still the plain one, and a throw of the plain call itself is the caller\'s as before', () => {
    const a = mkProto({ failUsage: () => true }), ra = {}; installLayerWrap(a.proto, ra);
    expect(a.proto.createProjectionLayer({ colorFormat: 'c' })).toBe(a.made[0]); expect(ra.layer.tried).toHaveLength(4); expect(ra.layer.tried.every(t => !t.ok)).toBe(true);
    const b = mkProto({ failPlain: true }), rb = {}; installLayerWrap(b.proto, rb);
    expect(() => b.proto.createProjectionLayer({ colorFormat: 'c' })).toThrow('plain failed'); expect(b.calls).toHaveLength(1); // no trial after a failed display call
  });
  it('trial launch: the display layer is made with the usage; when all are refused the plain call is made (back to the old behaviour)', () => {
    const a = mkProto(), ra = {}; installLayerWrap(a.proto, ra, { launch: true });
    const l = a.proto.createProjectionLayer({ colorFormat: 'c' });
    expect(l.init).toEqual({ colorFormat: 'c', textureUsage: 30 }); expect(a.made).toHaveLength(1); expect(ra.layer.display).toEqual({ usage: 30, withUsage: true }); expect(ra.layer.mode).toBe('launch');
    const b = mkProto({ failUsage: () => true }), rb = {}; installLayerWrap(b.proto, rb, { launch: true });
    const m = b.proto.createProjectionLayer({ colorFormat: 'c' });
    expect(m.init).toEqual({ colorFormat: 'c' }); expect(rb.layer.display).toEqual({ usage: null, withUsage: false }); expect(rb.layer.tried).toHaveLength(4);
    const c = mkProto({ failUsage: () => true, failPlain: true }); installLayerWrap(c.proto, {}, { launch: true });
    expect(() => c.proto.createProjectionLayer({ colorFormat: 'c' })).toThrow('plain failed');
  });
  it('a binding without the method, or a prototype that cannot be written, leaves everything alone', () => {
    const rec = {}; const restore = installLayerWrap({}, rec); expect(rec.layer.error).toContain('no createProjectionLayer'); expect(() => restore()).not.toThrow();
    const frozen = Object.freeze({ createProjectionLayer() { return 1; } }), r2 = {}; installLayerWrap(frozen, r2); expect(frozen.createProjectionLayer()).toBe(1);
  });
  it('usage text names the bits', () => { expect(usageText(30)).toBe('TEXTURE|STORAGE|COPY_DST|RENDER (30)'.replace('TEXTURE|STORAGE|COPY_DST|RENDER', 'COPY_DST|TEXTURE|STORAGE|RENDER')); expect(usageText(16)).toBe('RENDER (16)'); });
  it('vr-view: the wrap is installed before setSession and put back after it (and at the end of the session); the debug switch picks the launch', () => {
    const vr = src('vr-view.js');
    const iWrap = vr.indexOf('installLayerWrap(globalThis.XRGPUBinding?.prototype,gxCaps,{launch:effectiveFlag(\'gxLayerUsage\',false)})'), iBind = vr.indexOf('if(gx&&!await bindGxSession(renderer,session,'), iUndo = vr.indexOf('gxUndoWrap?.();gxUndoWrap=null;');
    expect(iWrap).toBeGreaterThan(0); expect(iWrap).toBeLessThan(iBind); expect(iUndo).toBeGreaterThan(iBind);
    expect(vr).toContain("session.addEventListener('end',()=>{try{gxUndoWrap?.()}catch{}},{once:true})");
  });
});

describe('the wait after the submit: off by default, and what it tells', () => {
  it('the debug switches exist, are off by default, and are read when a VR session starts', () => {
    for (const id of ['gxWait3', 'gxLayerUsage']) {
      const sw = DEBUG_SWITCHES.find(d => d.id === id);
      expect(sw.when).toBe('vr'); expect(debugFlag(id, { getItem: () => null })).toBe(false); expect(SETTINGS_DEFAULTS[id]).toBe(false); expect(DEBUG_SETTING_DEFAULTS[id]).toBe(false);
      for (const lang of ['ja', 'en']) { expect(I18N[lang][sw.label]).toBeTruthy(); expect(I18N[lang][sw.note]).toBeTruthy(); }
    }
  });
  it('vr-view builds the wait probe only when the switch is on, so with it off the frame does what it did', () => {
    const vr = src('vr-view.js');
    expect(vr).toContain("if(effectiveFlag('gxWait3',false))gxWait=createWaitProbe({device:d.device,rec:gxCaps,volMs:cb=>gx?.vol?.volume.onFrameVolMs?.(cb)})");
    expect(vr).toContain('let gxCaps=null,gxWait=null,gxUndoWrap=null;');
    expect(vr).toContain('if(gxWait&&!gxMeasure())gxWait.afterSubmit();'); expect(vr).toContain('gxWait?.frameEnd(t1);');
    expect(vr.match(/createWaitProbe\(/g)).toHaveLength(2); // the session's own start and makeGxSide (the page's preparation of the GPU side): the same call
    expect(src('vr-wgpu-caps.js')).toContain('export const GXC_WAIT_MS = 3;');
  });
  it('only every 4th call samples, alternately without and with the 3 ms wait; the other calls do not wait or call the queue', async () => {
    let t = 1000; const now = () => (t += 0.001), calls = []; const rec = { publish() {} };
    const device = { queue: { onSubmittedWorkDone: () => { calls.push(t); return Promise.resolve(); } } };
    const probe = createWaitProbe({ device, rec, now });
    const spent = [];
    for (let i = 0; i < 16; i++) { const b = t; probe.afterSubmit(); spent.push(t - b); await flush(); }
    expect(calls).toHaveLength(4);
    expect(spent.map((s, i) => [i, s >= 3]).filter(([, w]) => w).map(([i]) => i)).toEqual([4, 12]);
    expect(rec.wait.no).toHaveLength(2); expect(rec.wait.wait).toHaveLength(2);
  });
  // the volume GPU ms varies from frame to frame (2 .. 10 ms): the frames that tell are chosen by vol and the callback's rest only, the same for both groups
  const simulate = async (mode, volOf = i => 2 + ((i * 7919) % 9)) => {
    let t = 1000; const now = () => (t += 0.001), resolvers = [], volCbs = []; const rec = { publish() {} };
    const device = { queue: { onSubmittedWorkDone: () => new Promise(r => resolvers.push(r)) } };
    const probe = createWaitProbe({ device, rec, now, every: 1, volMs: cb => volCbs.push(cb) });
    for (let i = 0; i < 300; i++) {
      const vol = volOf(i), before = t; probe.afterSubmit();
      const cbEnd = t + 2; probe.frameEnd(cbEnd); // 2 ms of the callback are left after the submit (and the wait)
      t = mode === 'immediate' ? Math.max(before + vol, cbEnd) : cbEnd + vol; // the volume pass takes vol ms, from the submit or from the end of the callback
      resolvers.shift()?.(); volCbs.shift()?.(vol); await flush(); t += 5;
    }
    return waitStats(rec.wait);
  };
  it('tells a submit that reaches the GPU at once (no extra time) from one that waits for the callback to return (+3 ms), with a volume time that varies', async () => {
    const a = await simulate('immediate'); expect(Math.abs(a.diff)).toBeLessThan(0.5); expect(a.verdict).toContain('reaches the GPU at once');
    const b = await simulate('deferred'); expect(b.diff).toBeGreaterThan(2.5); expect(b.verdict).toContain('only when the callback returns');
    expect(a.no.nTell).toBeGreaterThan(20); expect(a.wait.nTell).toBeGreaterThan(20);
    expect(a.no.nTell + 0).toBeGreaterThan(0); // the same rule for both groups: about the same share of both groups tells
    expect(Math.abs(a.no.nTell - a.wait.nTell)).toBeLessThanOrEqual(2);
  });
  it('without a volume time (no timestamp-query) it says it cannot decide; with too few samples it says so', () => {
    expect(waitStats({ waitMs: 3, hasVol: false, no: [], wait: [] }).verdict).toContain('not decided');
    const W = { waitMs: 3, hasVol: true, no: [{ d: 8, e: 5, r: 2, vol: 8 }], wait: [{ d: 8, e: 1, r: 2, vol: 8 }] };
    expect(waitStats(W).verdict).toContain('not enough samples');
  });
  it('the record shows both groups and the difference', async () => {
    let t = 1000; const now = () => (t += 0.001), resolvers = [], volCbs = []; const rec = { publish() {} };
    const probe = createWaitProbe({ device: { queue: { onSubmittedWorkDone: () => new Promise(r => resolvers.push(r)) } }, rec, now, every: 1, volMs: cb => volCbs.push(cb) });
    for (let i = 0; i < 40; i++) { const b = t; probe.afterSubmit(); const ce = t + 2; probe.frameEnd(ce); t = Math.max(b + 8, ce); resolvers.shift()?.(); volCbs.shift()?.(8); await flush(); t += 5; }
    const text = formatCapsSummary({ wait: rec.wait });
    expect(text).toContain('without wait:'); expect(text).toContain('with wait:'); expect(text).toContain('(d - vol) with wait - without wait');
  });
});

// ---- the fixed foveation check, with a mock device that times the eye pass by the layer's foveation ----
describe('the fixed foveation check in the XR eye pass', () => {
  const g0 = {};
  beforeAll(() => { for (const k of ['GPUBufferUsage', 'GPUTextureUsage', 'GPUMapMode']) g0[k] = globalThis[k]; globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8, QUERY_RESOLVE: 512, COPY_SRC: 4, MAP_READ: 1 }; globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 16 }; globalThis.GPUMapMode = { READ: 1 }; });
  afterAll(() => { for (const k of Object.keys(g0)) { if (g0[k] === undefined) delete globalThis[k]; else globalThis[k] = g0[k]; } });
  const mock = ({ gain = 0.4, features = ['timestamp-query'], pipelineThrows = false, layerFov = 0.5 } = {}) => {
    const layer = { fixedFoveation: layerFov }, bufs = [], sets = [];
    const device = { features: new Set(features), depth: 0, created: 0,
      pushErrorScope() { device.depth++; }, popErrorScope() { device.depth--; return Promise.resolve(null); },
      createShaderModule: () => ({}), createRenderPipeline: () => { if (pipelineThrows) throw new Error('no pipeline'); return { getBindGroupLayout: () => ({}) }; },
      createBuffer: ({ size }) => { device.created++; const b = { size, destroyed: false, data: new BigUint64Array(8), mapAsync: () => Promise.resolve(), getMappedRange: () => b.data.buffer, unmap() {}, destroy() { b.destroyed = true; } }; bufs.push(b); return b; },
      createBindGroup: () => ({}), createTexture: () => ({ createView: () => ({}), destroy() {} }), createQuerySet: () => ({ destroy() {} }),
      createCommandEncoder: () => { const e = { passes: [], copies: [], beginRenderPass(d) { e.passes.push(d); return { setPipeline() {}, setBindGroup() {}, setViewport() {}, draw() {}, end() {} }; }, resolveQuerySet() {}, copyBufferToBuffer(a, ao, b) { e.copies.push(b); }, finish: () => e }; return e; },
      queue: { writeBuffer() {}, submit(list) {
        for (const e of list) for (const b of e.copies) {
          for (const d of e.passes) { const w = d.timestampWrites, i = w.beginningOfPassWriteIndex % 8, isXr = i < 4, ms = isXr ? 2 * (1 - gain * layer.fixedFoveation) : 1.5; b.data[i] = 1000000n + BigInt(i) * 10000000n; b.data[i + 1] = b.data[i] + BigInt(Math.round(ms * 1e6)); }
        }
      } } };
    const binding = { getViewSubImage: (l, v) => { if (binding.throws) throw new Error('no sub image'); return { colorTexture: { format: 'rgba8unorm', width: 200, height: 200, depthOrArrayLayers: 2, createView: () => ({}) }, viewport: { x: v.eye === 'left' ? 0 : 100, y: 0, width: 100, height: 200 }, getViewDescriptor: () => ({ baseArrayLayer: v.eye === 'left' ? 0 : 1 }) }; } };
    return { device, binding, layer, bufs };
  };
  const pose = { views: [{ eye: 'left' }, { eye: 'right' }] };
  const run = async (m, rec, opts = {}) => { const p = createFoveaProbe({ device: m.device, binding: m.binding, layer: m.layer, rec, startAfter: 2, skip: 2, samples: 5, ...opts }); for (let i = 0; i < 80 && !p.done; i++) { p.frame({}, pose); await flush(); } await flush(); return p; };
  it('measures foveation 0 and 1 in the XR pass against an off-screen control, puts the layer\'s foveation back, and lets everything go', async () => {
    const m = mock({ gain: 0.4 }), rec = { publish: vi.fn() }, seen = [];
    const set = Object.getOwnPropertyDescriptor(m.layer, 'fixedFoveation'); let v = m.layer.fixedFoveation; Object.defineProperty(m.layer, 'fixedFoveation', { get: () => v, set: x => { seen.push(x); v = x; }, configurable: true }); void set;
    await run(m, rec);
    expect(rec.fovea.state).toBe('done'); expect(seen).toEqual([0, 1, 0, 1, 0.5]); expect(m.layer.fixedFoveation).toBe(0.5);
    expect(rec.fovea.result.fov0.ms).toBeCloseTo(4, 1); expect(rec.fovea.result.fov1.ms).toBeCloseTo(4 * 0.6, 1); expect(rec.fovea.result.ratio).toBeCloseTo(0.6, 1);
    expect(rec.fovea.result.fov0.n).toBe(10); expect(rec.fovea.result.ctrl0.ms).toBeCloseTo(3, 1);
    expect(rec.fovea.verdict).toContain('EFFECTIVE'); expect(rec.fovea.readBack).toEqual([0, 1, 0, 1]);
    expect(m.device.depth).toBe(0); expect(m.bufs.every(b => b.destroyed)).toBe(true); expect(rec.publish).toHaveBeenCalled();
    const text = formatCapsSummary({ fovea: rec.fovea });
    expect(text).toContain('foveation 0 = 4 ms'); expect(text).toContain('verdict: EFFECTIVE');
  });
  it('the draw is invisible: it loads the image and blends nothing (source x 0 + target x 1)', () => {
    const c = src('vr-wgpu-caps.js');
    expect(c).toContain("srcFactor: 'zero', dstFactor: 'one'"); expect(c).toContain("loadOp: 'load'"); expect(c).not.toContain("loadOp: 'clear'");
  });
  it('no effect shows as no effect', async () => {
    const m = mock({ gain: 0 }), rec = { publish() {} }; await run(m, rec);
    expect(rec.fovea.verdict).toContain('NO EFFECT');
  });
  it('a layer without fixed foveation, or a device without timestamps, is reported and nothing is created', async () => {
    const a = mock({ layerFov: null }), ra = { publish() {} }; await run(a, ra);
    expect(ra.fovea.state).toBe('unsupported'); expect(ra.fovea.verdict).toContain('fixedFoveation is null'); expect(a.device.created).toBe(0); expect(a.layer.fixedFoveation).toBeNull();
    const b = mock({ features: [] }), rb = { publish() {} }; await run(b, rb);
    expect(rb.fovea.verdict).toContain('no timestamp-query'); expect(b.device.created).toBe(0);
  });
  it('a failure stops it with the error in the record, the foveation as it was and the error scopes balanced', async () => {
    const a = mock({ pipelineThrows: true }), ra = { publish() {} }; await run(a, ra);
    expect(ra.fovea.state).toBe('failed'); expect(ra.fovea.error).toContain('no pipeline'); expect(a.device.depth).toBe(0); expect(a.layer.fixedFoveation).toBe(0.5);
    const b = mock(); b.binding.throws = true; const rb = { publish() {} }; await run(b, rb);
    expect(rb.fovea.state).toBe('failed'); expect(rb.fovea.error).toContain('no sub image'); expect(b.layer.fixedFoveation).toBe(0.5);
  });
  it('the heavy draw parses as WGSL: a vertex and a fragment entry, the uniform struct, one uniform binding', () => {
    const r = new WgslReflect(GXC_HEAVY_WGSL);
    expect(r.entry.vertex.map(e => e.name)).toEqual(['vs']); expect(r.entry.fragment.map(e => e.name)).toEqual(['fs']);
    expect(r.uniforms.map(u => [u.group, u.binding, u.type.name])).toEqual([[0, 0, 'U']]);
    expect(r.structs[0].members.map(m => m.name)).toEqual(['k', 'n', 'a', 'b']);
  });
  it('the pass renders in the format of the view descriptor when it differs from the texture\'s', async () => {
    const m = mock(), rec = { publish() {} }, gv = m.binding.getViewSubImage;
    m.binding.getViewSubImage = (l, v) => { const s = gv(l, v); s.getViewDescriptor = () => ({ baseArrayLayer: 0, format: 'rgba8unorm-srgb' }); return s; };
    await run(m, rec); expect(rec.fovea.format).toBe('rgba8unorm-srgb'); expect(rec.fovea.textureFormat).toBe('rgba8unorm');
  });
  it('a foveation the app sets during the check is the one put back (not the one read at the start), and the check says so', async () => {
    const m = mock(), rec = { publish() {} }; let v = 0.5; const writes = [];
    Object.defineProperty(m.layer, 'fixedFoveation', { get: () => v, set: x => { writes.push(x); v = x; }, configurable: true });
    const p = createFoveaProbe({ device: m.device, binding: m.binding, layer: m.layer, rec, startAfter: 2, skip: 2, samples: 5 });
    let n = 0; for (let i = 0; i < 80 && !p.done; i++) { p.frame({}, pose); if (++n === 12) v = 0; /* the app's quality menu */ await flush(); } await flush();
    expect(writes[writes.length - 1]).toBe(0); expect(v).toBe(0); expect(rec.fovea.changedByApp).toBeGreaterThanOrEqual(1);
    expect(formatCapsSummary({ fovea: rec.fovea })).toContain('the app set the foveation');
  });
  it('the timeline: init, each step, the end and the result are recorded with the clock and the frame count; every heavy draw is counted in rec.foveaDraws; the record is published at init (not run -> running)', async () => {
    const m = mock({ gain: 0.4 }); let tt = 5000; const states = []; const rec = { publish: vi.fn(() => { states.push(rec.fovea.state + ':' + rec.fovea.events.length); }) };
    const p = createFoveaProbe({ device: m.device, binding: m.binding, layer: m.layer, rec, startAfter: 2, skip: 2, samples: 5, now: () => (tt += 10) });
    expect(p.done).toBe(false); expect(rec.fovea.events).toEqual([]);
    for (let i = 0; i < 80 && !p.done; i++) { p.frame({}, pose); await flush(); } await flush();
    expect(p.done).toBe(true);
    expect(states[0]).toBe('running:1'); // published at init, with the start event in it
    const E = rec.fovea.events; expect(E.map(e => e.k)).toEqual(['init', 'step', 'step', 'step', 'end', 'result']);
    expect(E.slice(0, 4).map(e => e.fov)).toEqual([0, 1, 0, 1]); expect(E.slice(0, 4).map(e => e.step)).toEqual([0, 1, 2, 3]);
    expect(E.map(e => e.t)).toEqual([...E.map(e => e.t)].sort((a, b) => a - b)); expect(E[0].t).toBeGreaterThan(5000);
    expect(E[0].seen).toBe(2); expect(E[1].seen).toBe(2 + 6); expect(E[4].seen).toBe(2 + 27); // 7 frames per step (2 to settle, 5 measured), the first frame of the check is the 2nd call (seen 2)
    expect(E[0].draws).toBe(0); expect(rec.foveaDraws).toBe(28); expect(E[4].draws).toBe(28);
    const text = formatCapsSummary({ fovea: rec.fovea });
    expect(text).toContain('timeline'); expect(text).toContain('init 0 fov=0 t=+0 seen=2 draws=0'); expect(text).toContain('step 1 fov=1'); expect(text).toContain('end ');
  });
  it('done is true for an unsupported layer, a failure and an abort too, with the event recorded; abort of a check that has not started marks it not run', async () => {
    const a = mock({ layerFov: null }), ra = { publish() {} }; const pa = await run(a, ra);
    expect(pa.done).toBe(true); expect(ra.fovea.events.map(e => e.k)).toEqual(['unsupported']); expect(ra.foveaDraws | 0).toBe(0);
    const b = mock({ pipelineThrows: true }), rb = { publish() {} }; const pb = await run(b, rb);
    expect(pb.done).toBe(true); expect(rb.fovea.events.map(e => e.k)).toEqual(['fail']);
    const c = mock(), rc = { publish() {} }, pc = createFoveaProbe({ device: c.device, binding: c.binding, layer: c.layer, rec: rc, startAfter: 50 });
    expect(pc.done).toBe(false); pc.abort(); expect(pc.done).toBe(true); expect(rc.fovea.state).toBe('not run'); expect(rc.fovea.events.map(e => e.k)).toEqual(['abort']);
    const d = mock(), rd = { publish() {} }, pd = createFoveaProbe({ device: d.device, binding: d.binding, layer: d.layer, rec: rd, startAfter: 2, skip: 2, samples: 5 });
    for (let i = 0; i < 9; i++) { pd.frame({}, pose); await flush(); } expect(pd.done).toBe(false); pd.abort(); expect(pd.done).toBe(true); expect(rd.fovea.events.map(e => e.k)).toEqual(['init', 'step', 'abort']); expect(d.layer.fixedFoveation).toBe(0.5);
  });
  it('waits for the posed frames at the start of the session before it begins', async () => {
    const m = mock(), rec = { publish() {} }; const p = createFoveaProbe({ device: m.device, binding: m.binding, layer: m.layer, rec, startAfter: 10 });
    for (let i = 0; i < 8; i++) p.frame({}, pose);
    expect(rec.fovea.state).toBe('waiting'); expect(m.device.created).toBe(0);
  });
  it('verdicts: effective, no effect, control moved, too short', () => {
    expect(foveaVerdict({ xr0: 4, xr1: 2.4, c0: 3, c1: 3 })).toContain('EFFECTIVE'); expect(foveaVerdict({ xr0: 4, xr1: 4.05, c0: 3, c1: 3 })).toContain('NO EFFECT');
    expect(foveaVerdict({ xr0: 4, xr1: 2.4, c0: 3, c1: 2 })).toContain('unclear'); expect(foveaVerdict({ xr0: 0.1, xr1: 0.1, c0: 0.1, c1: 0.1 })).toContain('not measurable'); expect(foveaVerdict({ xr0: NaN, xr1: 1 })).toContain('not measurable');
  });
});

describe('the heartbeat hands the posed frames to the hook, and the hook cannot break it', () => {
  const fakeSession = () => { const cbs = []; return { cbs, ended: 0, inputSources: [], requestAnimationFrame(cb) { cbs.push(cb); }, end() { this.ended++; return Promise.resolve(); }, frame(pose) { const list = cbs.splice(0); for (const cb of list) cb(0, { getViewerPose: () => pose }); } }; };
  it('onFrame is called only with a pose, after the layer is bound; a throw is recorded as an error and the loop goes on', () => {
    const s = fakeSession(), g = createGxDiag({ store: null }), st = { bound: false, rendered: 0, ref: {}, binding: { getViewSubImage: () => ({ colorTexture: {}, viewport: { x: 0, y: 0, width: 1, height: 1 } }) }, layer: {} };
    const hook = vi.fn(() => { throw new Error('hook broke'); });
    startGxHeartbeat({ session: s, diag: g, state: () => st, onFrame: hook });
    s.frame({ views: [] }); expect(hook).not.toHaveBeenCalled(); // not bound yet
    st.bound = true; s.frame(null); expect(hook).not.toHaveBeenCalled(); // no pose
    s.frame({ views: [{ eye: 'left' }] }); s.frame({ views: [{ eye: 'left' }] });
    expect(hook).toHaveBeenCalledTimes(2); expect(hook.mock.calls[0][2]).toBe(st); expect(g.d.errors[0].kind).toBe('frame-hook'); expect(g.d.counts.xrFrames).toBe(4);
  });
  it('without a hook nothing changes', () => {
    const s = fakeSession(), g = createGxDiag({ store: null }), st = { bound: true, rendered: 1, ref: {}, binding: { getViewSubImage: () => ({ colorTexture: {} }) }, layer: {} };
    startGxHeartbeat({ session: s, diag: g, state: () => st }); s.frame({ views: [{}] }); expect(g.d.counts.poses).toBe(1); expect(g.d.errors).toHaveLength(0);
  });
  it('the hook of the page reads the trial layer\'s sub image once, then runs the foveation check on the frames', () => {
    const rec = { publish: vi.fn(), layer: { trial: { destroy: vi.fn() } } };
    const binding = { getViewSubImage: vi.fn(() => ({ colorTexture: { usage: 30 } })) };
    const hook = capsFrameHook(rec, { features: new Set() }, { startAfter: 1000 });
    hook({}, { views: [{ eye: 'left' }] }, { binding, layer: {} }); hook({}, { views: [{ eye: 'left' }] }, { binding, layer: {} });
    expect(rec.layer.trialSub[0].usage).toBe(30); expect(binding.getViewSubImage).toHaveBeenCalledTimes(1); expect(rec.fovea.state).toBe('waiting');
  });
  const bound = () => ({ bound: true, rendered: 0, ref: {}, binding: { getViewSubImage: () => ({ colorTexture: {}, viewport: { x: 0, y: 0, width: 1, height: 1 } }) }, layer: {} });
  it('the page\'s hook: not done = called on every frame (the check ends within its first frames); done = only on every poseEvery-th frame again; the record never says "not run" once the hook has run', () => {
    const s = fakeSession(), g = createGxDiag({ store: null }), st = bound(); let t = 0; const states = [];
    const rec = { publish: vi.fn(() => states.push(rec.fovea ? rec.fovea.state : 'none')), layer: { trial: { destroy: vi.fn() } } };
    const hook = capsFrameHook(rec, { features: new Set() }, { startAfter: 3 }); expect(hook.done).toBe(false);
    const hb = startGxHeartbeat({ session: s, diag: g, state: () => st, onFrame: hook, poseEvery: 16, now: () => (t += 0.5), stallFrames: 1e9 });
    for (let i = 0; i < 40; i++) s.frame({ views: [{ eye: 'left' }] });
    expect(hook.done).toBe(true); expect(rec.fovea.state).toBe('unsupported'); expect(rec.fovea.events.map(e => e.k)).toEqual(['unsupported']);
    expect(states[0]).toBe('waiting'); // the first publish (the trial layer's sub image) already has the check's record
    expect(g.d.counts.xrFrames).toBe(40); expect(hb.stats.poseReads).toBe(3 + 2); // frames 1-3 (the check runs), then the 16th and 32nd
    expect(hb.stats.poseMs).toBeCloseTo(0.5 * 5, 5); expect(g.d.counts.poses).toBe(3 + 2 * 16);
  });
  it('a hook with done = false is called every frame, with done = true every poseEvery-th, a hook without done (or no hook) as before; the pose reads and their ms are counted', () => {
    const mk = done => { const s = fakeSession(), g = createGxDiag({ store: null }), st = bound(); let t = 0; const hook = vi.fn(); if (done !== undefined) hook.done = done; const hb = startGxHeartbeat({ session: s, diag: g, state: () => st, onFrame: hook, poseEvery: 16, now: () => (t += 0.25), stallFrames: 1e9 }); return { s, g, hook, hb }; };
    const a = mk(false); for (let i = 0; i < 64; i++) { a.s.frame({ views: [{}] }); if (i === 19) a.hook.done = true; }
    expect(a.hook).toHaveBeenCalledTimes(20 + 3); expect(a.hb.stats.poseReads).toBe(23); expect(a.hb.stats.poseMs).toBeCloseTo(0.25 * 23, 5); expect(a.g.d.counts.poses).toBe(20 + 3 * 16);
    const b = mk(true); for (let i = 0; i < 64; i++) b.s.frame({ views: [{}] }); expect(b.hook).toHaveBeenCalledTimes(5); expect(b.hb.stats.poseReads).toBe(5); // the first frame (the sub images are read), then the 16th, 32nd, 48th, 64th
    const c = mk(undefined); for (let i = 0; i < 64; i++) c.s.frame({ views: [{}] }); expect(c.hook).toHaveBeenCalledTimes(5); expect(c.hb.stats.poseReads).toBe(5);
    const s = fakeSession(), g = createGxDiag({ store: null }), hb = startGxHeartbeat({ session: s, diag: g, state: () => bound(), poseEvery: 16, stallFrames: 1e9 }); for (let i = 0; i < 33; i++) s.frame({ views: [{}] }); expect(hb.stats.poseReads).toBe(1 + 2); expect(g.d.counts.poses).toBe(1 + 2 * 16);
  });
  it('vr-view hands the hook to the heartbeat', () => { expect(src('vr-view.js')).toContain("onFrame:gxCaps?capsFrameHook(gxCaps,gx.device):null"); });
});
