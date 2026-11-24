// WebGPU VR, the direct draw trial (docs/vr-wgpu-direct.js, docs/vr-direct-log.js): the rect, the fragment wrapper's text, the hook on the backend's draw (a mock backend with bundle encoders; CI has no GPU), the host's
// frame (what the centre pass is cut by, what the uniforms carry), the off state (the draw path is the one of before), the page's switch (default off, the flicker guard) and the record.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import * as THREEG from 'three/webgpu';
import { volumeWgsl, uniformLayout, PROXY } from '../../docs/vr-wgsl-core.js';
import { createVrVolumeRenderer, bandRects, scaledRegion, fitSlot } from '../../docs/vr-wgpu.js';
import { directRegion, directFragmentWgsl, directDiffWgsl, createDirectApi, DIRECT_MIN_PX, DIRECT_DIFF_COUNTERS } from '../../docs/vr-wgpu-direct.js';
import { createDirectLog, directReport, CHECK_ROWS, CHECK_CLASSES } from '../../docs/vr-direct-log.js';
import { createFlapGuard } from '../../docs/vr-flicker-guard.js';
import { createPerfLog, perfReport } from '../../docs/vr-perf-log.js';

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const vrView = read('vr-view.js'), host = read('vr-wgpu.js');
const parse = src => new WgslReflect(src);

describe('directRegion: the integer rect the direct path draws', () => {
  const region = { x0: 178, y0: 128, x1: 462, y1: 352 }, rect = [180, 130, 460, 350], H = 480; // the centre rect y UP (y 130..350 of 480)
  it('with a periphery: the centre rect shrunk by the band and one pixel, inside the region; every pixel of it has full weight in the composite', () => {
    const D = directRegion(region, rect, 10, H);
    expect(D).toEqual({ x0: 191, y0: 141, x1: 449, y1: 339 });
    // the composite's own weight: wt = clamp(min(min(px - rect.x, py - rect.y), min(rect.z - px, rect.w - py)) / band) on the pixel centre, in top-left px
    const top = H - rect[3], bottom = H - rect[1];
    for (const [x, y] of [[D.x0, D.y0], [D.x1 - 1, D.y0], [D.x0, D.y1 - 1], [D.x1 - 1, D.y1 - 1], [D.x0, 240], [D.x1 - 1, 240]]) {
      const px = x + 0.5, py = y + 0.5, wt = Math.min(Math.min(px - rect[0], py - top), Math.min(rect[2] - px, bottom - py)) / 10;
      expect(wt).toBeGreaterThanOrEqual(1);
    }
  });
  it('a non-integer band and rect edges are rounded inwards', () => {
    const D = directRegion({ x0: 0, y0: 0, x1: 700, y1: 700 }, [100.4, 100.2, 600.6, 500.9], 7.3, 700);
    expect(D.x0).toBe(Math.ceil(100.4 + 7.3) + 1); expect(D.x1).toBe(Math.floor(600.6 - 7.3) - 1);
    expect(D.y0).toBe(Math.ceil((700 - 500.9) + 7.3) + 1); expect(D.y1).toBe(Math.floor((700 - 100.2) - 7.3) - 1);
  });
  it('without a periphery pass the whole region is the centre', () => {
    expect(directRegion(region, null, 1, H)).toEqual(region);
  });
  it('is clipped to the region (a box that covers only part of the rect) and null when nothing worth drawing is left', () => {
    expect(directRegion({ x0: 200, y0: 150, x1: 300, y1: 250 }, rect, 10, H)).toEqual({ x0: 200, y0: 150, x1: 300, y1: 250 });
    expect(directRegion({ x0: 178, y0: 128, x1: 182, y1: 352 }, rect, 10, H)).toBeNull(); // a sliver (< DIRECT_MIN_PX)
    expect(directRegion({ x0: 0, y0: 0, x1: DIRECT_MIN_PX - 1, y1: 500 }, null, 1, H)).toBeNull();
    expect(directRegion(null, rect, 10, H)).toBeNull();
    expect(directRegion({ x0: 5, y0: 5, x1: 5, y1: 9 }, null, 1, H)).toBeNull();
  });
  it('the centre pass keeps exactly what the rect leaves of its region (the band ring), the two together are the region', () => {
    const D = directRegion(region, rect, 10, H), ring = bandRects(region, [D.x0, H - D.y1, D.x1, H - D.y0], H, 1, 0);
    let px = 0; for (const [, , w, h] of ring) px += w * h;
    expect(px + (D.x1 - D.x0) * (D.y1 - D.y0)).toBe((region.x1 - region.x0) * (region.y1 - region.y0));
    for (const [x, y, w, h] of ring) { // no ring rect overlaps D (rects are relative to the region's top-left)
      const rx0 = x + region.x0, ry0 = y + region.y0;
      expect(rx0 + w <= D.x0 || rx0 >= D.x1 || ry0 + h <= D.y0 || ry0 >= D.y1).toBe(true);
    }
  });
});

describe('the fragment wrapper (text)', () => {
  const base = { f16: false, cls4: false, events: false };
  it('renames the volume\'s entry to fsMain once and adds the rect test, the 8-bit colour and the composite\'s depth decode', () => {
    const t = volumeWgsl(base), d = directFragmentWgsl(t);
    expect(d.split('fn fsMain(in:VOut)->FOut{').length).toBe(2);
    expect(d.startsWith(t.split('@fragment fn fs(in:VOut)->FOut{').join('fn fsMain(in:VOut)->FOut{'))).toBe(true); // the volume's own text is untouched
    expect(d).toContain('@group(1) @binding(0) var<uniform> dp:DP;');
    expect(d).toContain('ip.x<dp.rect.x||ip.y<dp.rect.y||ip.x>=dp.rect.z||ip.y>=dp.rect.w');
    expect(d).toContain('round(clamp(fo.color,vec4<f32>(0.0),vec4<f32>(1.0))*255.0)/255.0');
    expect(d).toContain('if(c.a<=0.0){discard;return o;}');
    expect(d).toContain('@builtin(frag_depth)');
    expect(d).toContain('(fo.depth.r*(255.0*65536.0)+fo.depth.g*(255.0*256.0)+fo.depth.b*255.0)/16777215.0'); // the composite's decode (docs/vr-wgpu.js createComposite)
  });
  it('the check variant writes the packed depth to a second colour output (no frag_depth)', () => {
    const d = directFragmentWgsl(volumeWgsl(base), { check: true });
    expect(d).toContain('@fragment fn fs(in:VOut)->FOut{'); expect(d).not.toContain('frag_depth'); expect(d).toContain('o.depth=fo.depth;');
  });
  it('an entry that is not there exactly once is an error (a changed volume text must not pass silently)', () => {
    expect(() => directFragmentWgsl('fn nothing(){}')).toThrow(/not found exactly once/);
  });
  it.each([[false, false, false], [false, true, false], [true, false, true], [true, true, true]])('parses as WGSL: f16=%s cls4=%s events=%s (display and check variants)', (f16, cls4, events) => {
    for (const check of [false, true]) {
      const src = directFragmentWgsl(volumeWgsl({ f16, cls4, events }), { check });
      expect(() => parse(src)).not.toThrow();
      const r = parse(src);
      expect(r.entry.fragment.map(e => e.name)).toEqual(['fs']);
      expect(r.entry.vertex.map(e => e.name)).toEqual(['vs']);
    }
  });
  it('the comparison compute parses and counts 16 values (colour / depth / covered, the largest differences, the classes)', () => {
    const src = directDiffWgsl(), r = parse(src);
    expect(r.entry.compute.map(e => e.name)).toEqual(['main']);
    expect(DIRECT_DIFF_COUNTERS).toBe(16);
    for (const i of [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) expect(src).toContain('atomicAdd(&cnt[' + i + '],1u)');
    for (const i of [3, 4]) expect(src).toContain('atomicMax(&cnt[' + i + '],');
    const used = [...src.matchAll(/cnt\[(\d+)\]/g)].map(m => +m[1]); expect(Math.max(...used)).toBeLessThan(DIRECT_DIFF_COUNTERS);
  });
});

// ---- the hook, on a mock backend whose draw records into per-eye bundle encoders (what three.js r187's WebGPUBackend.draw does in the layered XR pass) ----
const GPU_GLOBALS = () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
};
const withGpu = fn => async () => { GPU_GLOBALS(); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));
const eyeCam = (W, H) => ({ viewport: { x: 0, y: 0, z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
const mockGpu = () => {
  const log = { passes: [], writes: [], buffers: [], bindGroups: [], layouts: 0, pipelines: [], asyncPipelines: [], shaders: [], listeners: {}, submits: 0 };
  const device = { features: new Set(), limits: {} };
  device.queue = { writeBuffer: (b, off, data) => { log.writes.push({ b, data: new Int32Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0)) }); }, writeTexture() {}, submit: () => { log.submits++; } };
  device.createQuerySet = () => ({ destroy() {} });
  device.createBuffer = d => { const b = { d, destroyed: false, destroy() { b.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => new Uint32Array(Math.max(4, d.size / 4)).buffer, unmap() {} }; log.buffers.push(b); return b; };
  device.createTexture = d => { const t = { d, destroy() {}, createView: () => ({ t }) }; return t; };
  device.createSampler = () => ({}); device.createBindGroupLayout = () => { log.layouts++; return {}; }; device.createPipelineLayout = () => ({});
  device.createShaderModule = d => { log.shaders.push(d.code); return {}; };
  device.createComputePipeline = d => ({ d }); device.createComputePipelineAsync = async d => ({ d });
  device.createRenderPipeline = d => { const p = { d }; log.pipelines.push(p); return p; }; device.createRenderPipelineAsync = async d => { const p = { d, async: true }; log.asyncPipelines.push(p); return p; };
  device.createBindGroup = d => { const g = { d }; log.bindGroups.push(g); return g; };
  device.addEventListener = (type, fn) => { (log.listeners[type] ||= []).push(fn); }; device.removeEventListener = (type, fn) => { log.listeners[type] = (log.listeners[type] || []).filter(x => x !== fn); };
  device.createCommandEncoder = () => ({
    beginRenderPass: d => { const p = { d, pipeline: null, groups: {}, viewports: [], scissors: [], draws: 0 }; log.passes.push(p); return { setPipeline: x => { p.pipeline = x; }, setVertexBuffer() {}, setBindGroup: (i, g) => { p.groups[i] = g; }, setViewport: (...a) => p.viewports.push(a), setScissorRect: (...a) => p.scissors.push(a), draw: () => { p.draws++; }, end() {} }; },
    beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), resolveQuerySet() {}, copyBufferToBuffer() {}, clearBuffer() {}, copyTextureToBuffer() {}, finish: () => ({}),
  });
  return { device, log };
};
// a backend with the pieces the hook uses: draw (the original records what it did), get(context), utils, and a layered context with a bundle encoder per eye
function mockBackend({ layered = true, formats = { colorFormat: 'rgba8unorm', depthFormat: 'depth24plus', samples: 1 }, view = [0, 0, 640, 480] } = {}) {
  const xrTarget = { isXr: true }, store = new Map(), calls = [];
  const enc = i => { const e = { i, cmds: [], setPipeline: p => e.cmds.push(['setPipeline', p]), setBindGroup: (n, g) => e.cmds.push(['setBindGroup', n, g]), setVertexBuffer: (n, b) => e.cmds.push(['setVertexBuffer', n, b]), draw: n => e.cmds.push(['draw', n]) }; return e; };
  const ctx = { renderTarget: xrTarget, depth: true, stencil: false, viewportValue: { x: view[0], y: view[1], width: view[2], height: view[3] }, width: view[2], height: view[3] };
  const data = layered ? { bundleEncoders: [enc(0), enc(1)], bundleSets: [0, 1].map(() => ({ attributes: { 0: 'x' }, bindingGroups: ['a', 'b'], pipeline: 'p', index: null })) } : {};
  store.set(ctx, data);
  const backend = {
    draw(ro) { calls.push(ro.material?.label || 'draw'); for (const e of data.bundleEncoders || []) e.cmds.push(['threeDraw']); }, // the original draw: three.js sets what it needs after the hook's commands
    get: o => store.get(o) || {}, parameters: {},
    utils: { getCurrentColorFormat: () => formats.colorFormat, getCurrentDepthStencilFormat: () => formats.depthFormat, getSampleCountRenderContext: () => formats.samples },
  };
  const cams = [eyeCam(640, 480), eyeCam(640, 480)];
  const model = new THREEG.Matrix4();
  const material = { label: 'composite' };
  const ro = (over = {}) => ({ material, object: { matrixWorld: model }, context: ctx, camera: { isArrayCamera: true, cameras: cams }, ...over });
  return { backend, renderer: { backend, xr: { _xrRenderTarget: xrTarget } }, data, ctx, ro, cams, model, material, calls, xrTarget };
}
// a frame set up the way the host does it
const setUpFrame = (api, m, { eyesOn = [0, 1], pxTex = null } = {}) => {
  api.beginFrame();
  const rects = eyesOn.map(i => ({ i, D: { x0: 191, y0: 141, x1: 449, y1: 339 }, region: { x0: 178, y0: 128, x1: 462, y1: 352 }, eye: { mvp: new THREEG.Matrix4(), origin: new THREEG.Vector3(0, 0, 3), lightOff: new THREEG.Vector3(0.1, 0.2, 0.3) }, tilesPerEye: 36 }));
  return api.setFrame({ u: {}, variant: { cls4: false, events: false }, model: m.model, rects, pxTex });
};
const makeApi = ({ notes = [] } = {}) => {
  const { device, log } = mockGpu(), m = mockBackend();
  const layout = uniformLayout();
  const api = createDirectApi({ device, THREE: THREEG, layout, bgl: {}, f16: false, onShader: null, boxBuf: { id: 'box' }, gpuOf: () => null, dummy: kind => ({ kind, createView: () => ({}), __id: 1 }), proxyDummyTex: () => ({ createView: () => ({}), __id: 2 }),
    linear: {}, nearest: {}, texId: t => (t.__id ||= Math.floor(Math.random() * 1e9)), fillUniforms: (u, extra) => { const ab = new ArrayBuffer(layout.byteSize), I = new Int32Array(ab), at = n => layout.fields.find(f => f.name === n).offset / 4; I[at('proxyOn')] = extra.proxyOn; I[at('proxyOrg')] = extra.proxyOrg[0]; I[at('proxyOrg') + 1] = extra.proxyOrg[1]; new Float32Array(ab).set(extra.mvp.elements, at('mvp')); return ab; }, passExtra: () => ({ jumpOn: 0, useSkip: 0 }), pipeFor: () => ({}), bindGroup: () => ({}) });
  api.setNotifier((k, v) => notes.push([k, v]));
  return { api, log, m, device, notes };
};

describe('the hook on the backend draw', () => {
  it('install: wraps backend.draw once, says so, and refuses what it cannot hook (no throw)', withGpu(async () => {
    const { api, m } = makeApi(), orig = m.backend.draw;
    const r = api.install(m.renderer, m.material);
    expect(r.installed).toBe(true); expect(r.text).toMatch(/hooked on the backend/);
    expect(m.backend.draw).not.toBe(orig); expect(m.backend._vrlDirectDraw).toBe(true);
    expect(api.install(m.renderer, m.material).installed).toBe(true); // again: the same, not wrapped twice
    const { api: api2, m: m2 } = makeApi(); m2.renderer.backend.utils = {};
    const bad = api2.install(m2.renderer, m2.material);
    expect(bad.installed).toBe(false); expect(bad.text).toMatch(/not available/); expect(api2.canUse({ f: 1, cams: m2.cams, decode: false, model: m2.model, variant: { cls4: false, events: false } })).toBe(false);
    const { api: api3, m: m3 } = makeApi(); m3.renderer.reversedDepthBuffer = true;
    expect(api3.install(m3.renderer, m3.material).installed).toBe(false);
  }));

  it('off (no frame set up): the original draw runs and nothing is recorded into the bundles; the formats of the eye pass are learned', withGpu(async () => {
    const { api, m, log } = makeApi(); api.install(m.renderer, m.material);
    m.backend.draw(m.ro());
    expect(m.data.bundleEncoders.map(e => e.cmds)).toEqual([[['threeDraw']], [['threeDraw']]]); // only three.js' own
    expect(m.data.bundleSets[0].pipeline).toBe('p'); // its state cache is left alone
    expect(api.seen).toMatchObject({ colorFormat: 'rgba8unorm', depthFormat: 'depth24plus', samples: 1, layered: true, view: [0, 0, 640, 480] });
    expect(log.layouts).toBe(0); expect(log.asyncPipelines).toHaveLength(0); // nothing is made for a session that never asks
  }));

  it('on: the volume\'s draw is recorded into each eye\'s bundle before three.js\' own draw of the composite, then the cache is reset; the pipeline is the one made for the eye pass\' formats (blend, depth, cull)', withGpu(async () => {
    const { api, m, log } = makeApi(); api.install(m.renderer, m.material);
    m.backend.draw(m.ro()); // learns the formats
    const variant = { cls4: false, events: false }, ask = () => api.canUse({ f: 1, cams: m.cams, decode: false, model: m.model, variant });
    expect(ask()).toBe(false); // not compiled yet: the offscreen path draws everything
    await settle();
    expect(ask()).toBe(true);
    const d = log.asyncPipelines[0].d;
    expect(d.fragment.targets).toEqual([{ format: 'rgba8unorm', blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }, writeMask: 0xf }]);
    expect(d.depthStencil).toEqual({ format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' });
    expect(d.primitive).toEqual({ topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' }); expect(d.multisample).toEqual({ count: 1 });
    expect(log.shaders[0]).toContain('@builtin(frag_depth)');
    m.data.bundleEncoders.forEach(e => { e.cmds.length = 0; });
    setUpFrame(api, m);
    m.backend.draw(m.ro());
    for (const e of m.data.bundleEncoders) {
      expect(e.cmds.map(c => c[0])).toEqual(['setPipeline', 'setBindGroup', 'setBindGroup', 'setVertexBuffer', 'draw', 'threeDraw']); // the volume first, three.js' draw after it
      expect(e.cmds[0][1]).toBe(log.asyncPipelines[0]); expect(e.cmds[1][1]).toBe(0); expect(e.cmds[2][1]).toBe(1); expect(e.cmds[3][2]).toEqual({ id: 'box' }); expect(e.cmds[4][1]).toBe(36);
    }
    for (const s of m.data.bundleSets) expect(s).toEqual({ attributes: {}, bindingGroups: [], pipeline: null, index: null }); // three.js sets its pipeline, bind groups and buffers again
    expect(api.afterRender()).toBe('direct');
  }));

  it('once per frame; only the eyes that have a rect; not another material, not another object, not another render target', withGpu(async () => {
    const { api, m, log } = makeApi(); api.install(m.renderer, m.material);
    m.backend.draw(m.ro()); api.canUse({ f: 1, cams: m.cams, decode: false, model: m.model, variant: { cls4: false, events: false } }); await settle();
    const rec = () => m.data.bundleEncoders.map(e => e.cmds.filter(c => c[0] === 'draw').length);
    m.data.bundleEncoders.forEach(e => { e.cmds.length = 0; });
    setUpFrame(api, m, { eyesOn: [1] });
    m.backend.draw(m.ro({ material: { label: 'other' } })); m.backend.draw(m.ro({ object: { matrixWorld: new THREEG.Matrix4() } }));
    expect(rec()).toEqual([0, 0]);
    m.backend.draw(m.ro({ context: { ...m.ctx, renderTarget: {} } })); expect(rec()).toEqual([0, 0]);
    m.backend.draw(m.ro()); expect(rec()).toEqual([0, 1]); // eye 1 only
    m.backend.draw(m.ro()); expect(rec()).toEqual([0, 1]); // the second draw of the frame is three.js' alone
    expect(api.afterRender()).toBe('direct'); expect(log.asyncPipelines).toHaveLength(1);
  }));

  it('an exception while recording gives the original behaviour back: the original draw still runs, the path is off for the session, the next frame records nothing and canUse says no', withGpu(async () => {
    const { api, m, notes } = makeApi(); api.install(m.renderer, m.material);
    const variant = { cls4: false, events: false }, ask = () => api.canUse({ f: 1, cams: m.cams, decode: false, model: m.model, variant });
    m.backend.draw(m.ro()); ask(); await settle(); expect(ask()).toBe(true);
    m.data.bundleEncoders.forEach(e => { e.cmds.length = 0; });
    m.data.bundleEncoders[0].setPipeline = () => { throw new Error('encoder is gone'); };
    setUpFrame(api, m);
    expect(() => m.backend.draw(m.ro())).not.toThrow();
    expect(m.calls.at(-1)).toBe('composite'); // the original ran
    expect(m.data.bundleEncoders[1].cmds.map(c => c[0])).toEqual(['threeDraw']); // nothing of the path in eye 1 either (eye 0 threw before anything was recorded)
    expect(api.disabled).toMatch(/the hook threw: encoder is gone/);
    expect(ask()).toBe(false);
    expect(notes.some(([k, v]) => k === 'direct draw' && /switched off for the session/.test(v))).toBe(true);
    m.data.bundleEncoders[0].setPipeline = p => m.data.bundleEncoders[0].cmds.push(['setPipeline', p]);
    setUpFrame(api, m); m.data.bundleEncoders.forEach(e => { e.cmds.length = 0; }); m.backend.draw(m.ro());
    expect(m.data.bundleEncoders.map(e => e.cmds.map(c => c[0]))).toEqual([['threeDraw'], ['threeDraw']]);
  }));

  it('a frame set up but not recordable (not a layered pass) is a miss: the path is switched off at once; a hidden volume (the composite never drawn) is not', withGpu(async () => {
    const { api, m } = makeApi(); api.install(m.renderer, m.material);
    const variant = { cls4: false, events: false }, ask = () => api.canUse({ f: 1, cams: m.cams, decode: false, model: m.model, variant });
    m.backend.draw(m.ro()); ask(); await settle();
    setUpFrame(api, m); expect(api.afterRender()).toBe('none'); expect(api.disabled).toBeNull(); // the composite was not drawn
    setUpFrame(api, m); delete m.data.bundleEncoders; m.data.bundleSets = undefined;
    m.backend.draw(m.ro());
    expect(api.afterRender()).toBe('miss'); expect(api.disabled).toMatch(/not recorded: not a layered pass/);
  }));

  it('the composite drawn only by an object that is not the volume\'s mesh, in a frame that was set up, is a miss that switches the path off (the centre would be missing every frame); the volume\'s own draw after it is fine', withGpu(async () => {
    const { api, m } = makeApi(); api.install(m.renderer, m.material);
    const variant = { cls4: false, events: false }, ask = () => api.canUse({ f: 1, cams: m.cams, decode: false, model: m.model, variant });
    m.backend.draw(m.ro()); ask(); await settle();
    setUpFrame(api, m); m.backend.draw(m.ro({ object: { matrixWorld: new THREEG.Matrix4() } }));
    expect(api.afterRender()).toBe('miss'); expect(api.disabled).toMatch(/not recorded: the composite was drawn only by an object that is not the volume's mesh/);
    const b = makeApi(); b.api.install(b.m.renderer, b.m.material);
    b.m.backend.draw(b.m.ro()); b.api.canUse({ f: 1, cams: b.m.cams, decode: false, model: b.m.model, variant }); await settle();
    setUpFrame(b.api, b.m); b.m.backend.draw(b.m.ro({ object: { matrixWorld: new THREEG.Matrix4() } })); b.m.backend.draw(b.m.ro());
    expect(b.api.afterRender()).toBe('direct'); expect(b.api.disabled).toBeNull();
  }));

  it('a GPU error while the path is in use switches it off (validation errors do not throw); one long after is not its doing', withGpu(async () => {
    const { api, m, log } = makeApi(); api.install(m.renderer, m.material);
    const variant = { cls4: false, events: false }, ask = () => api.canUse({ f: 1, cams: m.cams, decode: false, model: m.model, variant });
    m.backend.draw(m.ro()); ask(); await settle();
    setUpFrame(api, m); m.backend.draw(m.ro()); api.afterRender();
    expect(log.listeners.uncapturederror).toHaveLength(1);
    log.listeners.uncapturederror[0]({ error: { message: 'bundle is invalid' } });
    expect(api.disabled).toMatch(/a GPU error while the path was in use: bundle is invalid/);
    const b = makeApi(); b.api.install(b.m.renderer, b.m.material);
    for (let i = 0; i < 10; i++) b.api.beginFrame(); // frames without the path
    b.log.listeners.uncapturederror[0]({ error: { message: 'another' } });
    expect(b.api.disabled).toBeNull();
    b.api.dispose(); expect(b.log.listeners.uncapturederror).toHaveLength(0);
  }));

  it('canUse says why not: scale below 1, three.js encoding the frame, mirrored volume, an eye not at the origin, a viewport that is not the eye, a pipeline not compiled', withGpu(async () => {
    const { api, m } = makeApi(); api.install(m.renderer, m.material);
    const variant = { cls4: false, events: false }, p = (o = {}) => ({ f: 1, cams: m.cams, decode: false, model: m.model, variant, ...o });
    expect(api.why(p())).toMatch(/not been seen/);
    m.backend.draw(m.ro());
    expect(api.why(p())).toMatch(/pipeline is not compiled/); await settle();
    expect(api.why(p())).toBeNull();
    expect(api.why(p({ f: 0.9 }))).toMatch(/below 1/); expect(api.why(p({ decode: true }))).toMatch(/encodes the frame/);
    expect(api.why(p({ model: new THREEG.Matrix4().makeScale(-1, 1, 1) }))).toMatch(/mirrored/);
    expect(api.why(p({ cams: [{ ...m.cams[0], viewport: { x: 3, y: 0, z: 640, w: 480 } }] }))).toMatch(/origin/);
    expect(api.why(p({ cams: [eyeCam(1000, 480)] }))).toMatch(/viewport 0,0,640,480 is not the eye 1000x480/);
    expect(api.why(p({ cams: [] }))).toMatch(/no eye/);
  }));

  it('a non-layered eye pass (single camera) is not used', withGpu(async () => {
    const { api } = makeApi(), m = mockBackend({ layered: false }); api.install(m.renderer, m.material);
    m.backend.draw(m.ro());
    expect(api.why({ f: 1, cams: m.cams, decode: false, model: m.model, variant: { cls4: false, events: false } })).toMatch(/not layered/);
  }));
});

describe('the check (the recording only): the centre pass again over the rect, the direct material over the same rect, a comparison', () => {
  const note = () => ({ u: {}, variant: { cls4: false, events: false }, W: 640, H: 480, eye: { mvp: new THREEG.Matrix4(), origin: new THREEG.Vector3(0, 0, 3), lightOff: new THREEG.Vector3() }, region: { x0: 178, y0: 128, x1: 462, y1: 352 }, D: { x0: 191, y0: 141, x1: 449, y1: 339 }, pxTex: null });
  it('draws A (region-sized, the rect as a region-relative scissor) and B (eye-sized, the rect as an absolute scissor, whole-eye viewport), compares, reports the counts, marks the frame', withGpu(async () => {
    const { api, log } = makeApi(), got = [];
    expect(api.check(r => got.push(r))).toBe(false); // nothing noted yet
    api.noteForCheck(note());
    expect(api.check(r => got.push(r))).toBe(false); // the check pipelines are being compiled
    await settle();
    const rec = { shadowed: false };
    expect(api.check(r => got.push(r), rec)).toBe(true); expect(rec.shadowed).toBe(true);
    expect(log.passes).toHaveLength(2);
    expect(log.passes[0].viewports).toEqual([[0, 0, 284, 224, 0, 1]]); expect(log.passes[0].scissors).toEqual([[13, 13, 258, 198]]); expect(log.passes[0].draws).toBe(1);
    expect(log.passes[1].viewports).toEqual([[0, 0, 640, 480, 0, 1]]); expect(log.passes[1].scissors).toEqual([[191, 141, 258, 198]]); expect(log.passes[1].draws).toBe(1);
    expect(log.passes[1].d.colorAttachments).toHaveLength(2);
    const par = log.writes.filter(w => w.data.length === 8).map(w => [...w.data]); expect(par).toEqual([[191, 141, 449, 339, 178, 128, 0, 0]]); // the comparison's rect and the region origin (A's pixel = pixel - origin)
    expect(log.buffers.filter(b => b.d.size === 64)).toHaveLength(2); // the counters and their read-back: 16 u32
    expect(api.check(() => {})).toBe(false); // one at a time
    await settle();
    expect(got).toEqual([{ total: 258 * 198, covered: 0, colour: 0, depth: 0, cmax: 0, dmax: 0, covA: 0, covB: 0, both: 0, c1: 0, d2: 0, d256: 0, edge: 0, aFront: 0, bFront: 0, shift: 0,
      checkNo: 0, noteNo: 0, D: [191, 141, 449, 339], region: [178, 128, 462, 352], W: 640, H: 480, pre: false, orgA: [0, 0], orgB: [0, 0], text: expect.stringContaining('rect 191,141-449,339') }]);
    expect(api.check(() => {})).toBe(true); // free again; the same sizes: the images are kept
    expect(log.passes).toHaveLength(4);
  }));
  it('releaseCheck lets the scratch images and buffers go (after the recording), and a read-back still pending is not cut off', withGpu(async () => {
    const { api, log } = makeApi();
    api.noteForCheck(note()); api.check(() => {}); await settle(); api.check(() => {});
    const nBuf = log.buffers.length; expect(nBuf).toBeGreaterThan(0);
    api.releaseCheck(); // a read-back is pending: released when it arrives
    expect(log.buffers.some(b => b.destroyed)).toBe(false);
    await settle();
    expect(log.buffers.filter(b => b.destroyed).length).toBeGreaterThan(0);
  }));
});

describe('the host: what draw() does with and without the path', () => {
  const rects = [[180, 130, 460, 350, 10], [180, 130, 460, 350, 10]], variant = { cls4: false, events: false };
  const setup = async ({ install = true } = {}) => {
    const { device, log } = mockGpu(), m = mockBackend();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    m.material.label = 'composite'; // the hook compares the material it was given
    const inst = install ? r.installDirect({ backend: m.backend, xr: m.renderer.xr, reversedDepthBuffer: false }) : null;
    return { r, log, m, device, inst };
  };
  const drawArgs = (m, over = {}) => ({ u: {}, cams: m.cams, model: m.model, f: 1, fov: true, fp: 0.5, rects, band: 10, periK: 0.5, variant, ...over });
  const go = (r, m, direct, over = {}) => { r.direct.ask(direct); return r.draw(drawArgs(m, over)); }; // the page asks, then calls draw as before
  const lowPass = log => log.passes[0]; // the first render pass of the frame (the centre pass; the periphery pass is the second)

  it('off (never asked, or asked false): the centre pass keeps the whole region as before, nothing of the path is made or recorded', withGpu(async () => {
    const { r, log, m } = await setup();
    const reg = scaledRegion([180, 130, 460, 350], 480, 1, 640, 480), whole = [0, 0, reg.x1 - reg.x0, reg.y1 - reg.y0], stride = fitSlot(reg.x1 - reg.x0, null, 640) + 2;
    r.draw(drawArgs(m));
    expect(lowPass(log).scissors).toEqual([whole, [stride, 0, whole[2], whole[3]]]); // one scissor per eye: the whole region (bandRects with no inner rect)
    const nBuf = log.buffers.length, nBg = log.bindGroups.length, nWrite = log.writes.length, nLay = log.layouts;
    log.passes.length = 0;
    go(r, m, false);
    expect(lowPass(log).scissors).toEqual([whole, [stride, 0, whole[2], whole[3]]]);
    expect(r.stats.direct).toBe(0); expect(r.direct.disabled).toBeNull();
    expect(log.buffers.length).toBe(nBuf); expect(log.layouts).toBe(nLay); // the second frame made nothing new (the path's buffers, bind groups and layouts are made only when it is asked for)
    expect(log.asyncPipelines).toHaveLength(0);
    expect(log.writes.length - nWrite).toBeGreaterThan(0); // (the passes' own uniforms are written each frame)
    expect(log.writes.some(w => w.data.length === 4)).toBe(false); // no rect of the path
    expect(r.direct.seen).toBeNull();
  }));

  it('asked, but the hook is not installed: the same as off', withGpu(async () => {
    const { r, log, m } = await setup({ install: false });
    go(r, m, true);
    expect(r.stats.direct).toBe(0);
    const reg = scaledRegion([180, 130, 460, 350], 480, 1, 640, 480);
    expect(lowPass(log).scissors[0]).toEqual([0, 0, reg.x1 - reg.x0, reg.y1 - reg.y0]);
  }));

  it('asked at scale 1 with everything ready: the centre pass keeps only the band ring; the uniforms carry the whole eye\'s matrix, proxyOn / proxyOrg relative to the region; the frame is recorded by the hook', withGpu(async () => {
    const { r, log, m } = await setup();
    m.backend.draw(m.ro({ material: r.material, object: { matrixWorld: m.model } })); // the first composite draw: the formats are learned
    go(r, m, true); await settle(); // compiles the pipeline (not ready in this frame)
    expect(r.stats.direct).toBe(0);
    log.passes.length = 0; log.writes.length = 0;
    go(r, m, true);
    const D = { x0: 191, y0: 141, x1: 449, y1: 339 }, reg = scaledRegion([180, 130, 460, 350], 480, 1, 640, 480);
    expect(reg).toMatchObject({ x0: 178, y0: 128, x1: 462, y1: 352 });
    expect(r.stats.direct).toBe(2 * (D.x1 - D.x0) * (D.y1 - D.y0));
    // the centre pass: the ring of the region around D (4 rects each eye; the eyes' slots are stride apart)
    const ring = bandRects(reg, [D.x0, 480 - D.y1, D.x1, 480 - D.y0], 480, 1, 0);
    expect(ring).toHaveLength(4);
    const sc = lowPass(log).scissors, stride = fitSlot(reg.x1 - reg.x0, null, 640) + 2;
    expect(sc).toHaveLength(8);
    expect(sc.slice(0, 4)).toEqual(ring.map(c => [c[0], c[1], c[2], c[3]])); expect(sc.slice(4)).toEqual(ring.map(c => [stride + c[0], c[1], c[2], c[3]]));
    // the path's rect of each eye is written for the hook to read (the rect test of the fragment wrapper)
    expect(log.writes.filter(w => w.data.length === 4).map(w => [...w.data])).toEqual([[191, 141, 449, 339], [191, 141, 449, 339]]);
    // the hook records it in the next three.js draw
    m.data.bundleEncoders.forEach(e => { e.cmds.length = 0; });
    m.backend.draw(m.ro({ material: r.material, object: { matrixWorld: m.model } }));
    for (const e of m.data.bundleEncoders) expect(e.cmds.map(c => c[0])).toEqual(['setPipeline', 'setBindGroup', 'setBindGroup', 'setVertexBuffer', 'draw', 'threeDraw']);
    expect(r.direct.afterRender()).toBe('direct');
  }));

  it('the proxy origin of the path: the pre-pass\' tiles are the centre pass\' own, addressed relative to the region (eye 1 starts tilesPerEye tiles later)', withGpu(async () => {
    const { api, m, log } = makeApi(); api.install(m.renderer, m.material);
    const pxTex = { createView: () => ({}), __id: 77 };
    setUpFrame(api, m, { pxTex });
    const L = uniformLayout(), at = n => L.fields.find(f => f.name === n).offset / 4, U = log.writes.filter(w => w.data.length === L.byteSize / 4);
    expect(U).toHaveLength(2);
    expect(U.map(w => [w.data[at('proxyOn')], w.data[at('proxyOrg')], w.data[at('proxyOrg') + 1]])).toEqual([[1, 178 - PROXY.tile * 0 * 36, 128], [1, 178 - PROXY.tile * 1 * 36, 128]]);
    log.writes.length = 0; setUpFrame(api, m, { pxTex: null });
    expect(log.writes.filter(w => w.data.length === L.byteSize / 4).map(w => [w.data[at('proxyOn')], w.data[at('proxyOrg')], w.data[at('proxyOrg') + 1]])).toEqual([[0, 0, 0], [0, 0, 0]]); // a centre pass without tiles: none here either
  }));

  it('below scale 1 the path is not asked of the renderer (the page asks only at f = 1) and the renderer itself refuses: the whole region is drawn offscreen', withGpu(async () => {
    const { r, log, m } = await setup();
    m.backend.draw(m.ro({ material: r.material, object: { matrixWorld: m.model } })); go(r, m, true); await settle();
    log.passes.length = 0;
    go(r, m, true, { f: 0.8, fp: 0.4 });
    expect(r.stats.direct).toBe(0);
    expect(lowPass(log).scissors.length).toBe(2); // one per eye
  }));

  it('no periphery pass (fov off): the whole centre region is the rect; the centre pass draws nothing of it', withGpu(async () => {
    const { r, log, m } = await setup();
    m.backend.draw(m.ro({ material: r.material, object: { matrixWorld: m.model } })); go(r, m, true, { fov: false, rects: null, periK: 1 }); await settle();
    log.passes.length = 0;
    go(r, m, true, { fov: false, rects: null, periK: 1 });
    expect(r.stats.direct).toBe(2 * 640 * 480);
    expect(lowPass(log).scissors).toEqual([]); // nothing drawn offscreen (the pass is still begun: the pre-pass and the timers hang on it)
  }));
});

describe('the flicker guard of the switch (the way the WebGL view guards its path switches)', () => {
  const run = (wants, step = 100) => { // the loop's expression of vr-view.js: asked = want && guard.step(want) && !frozen
    const g = createFlapGuard({ fallback: () => false }), out = [];
    wants.forEach((w, i) => { const now = i * step, ok = g.step(w, now); out.push(w && ok && !g.frozenAt(now)); });
    return out;
  };
  it('a steady on stays on; a change that goes back and forth faster than 3 times a second freezes it, and while frozen the offscreen path is drawn', () => {
    expect(run([true, true, true, true]).every(Boolean)).toBe(true);
    const flapping = run([true, false, true, false, true, false, true, false, true, true, true, true], 50);
    expect(flapping.slice(-3)).toEqual([false, false, false]); // frozen: offscreen, whatever the proposals
    expect(run([true, false, false, false, false, true], 700)).toEqual([true, false, false, false, false, true]); // slow changes pass
  });
  it('the source: the loop asks only at scale 1 with the setting on and the hook installed, through such a guard, and gives the guard\'s answer to the renderer', () => {
    expect(vrView).toMatch(/gxDirGuard=createFlapGuard\(\{fallback:\(\)=>false\}\)/);
    expect(vrView).toMatch(/const want=!!settings\.gxDirect&&f>=1-1e-6&&!!gx\.vol\.direct\?\.installed,ok=gxDirGuard\.step\(want,nowG\);gxDirAsked=want&&ok&&!gxDirGuard\.frozenAt\(nowG\)/);
    expect(vrView).toContain('gx.vol.direct.ask(gxDirAsked);');
    expect(vrView).toContain('boxes:xrCam?rsEyes:null});'); // the draw call itself is the one of before
  });
});

describe('the setting: off by default, in the diagnostics page, both languages', () => {
  it('is reset to off at every session start (like the other diagnostics) and is not among the stored defaults', () => {
    expect(vrView).toMatch(/settings\.boxDiag=0;settings\.gxDirect=0;/);
    expect(vrView.match(/const DEFAULTS=\{[^}]*\}/)[0]).not.toMatch(/gxDirect/);
    expect(vrView.match(/settings\.gxDirect=/g)).toHaveLength(2); // the reset and the menu's own press
  });
  it('the row is on the diagnostics page (tab 4), WebGPU only, with a Japanese and an English label, and its press does not save', () => {
    const i = vrView.indexOf('choice(y0+920,GXD.row'), seg = vrView.slice(vrView.lastIndexOf('\n', i), vrView.indexOf('\n', i));
    expect(seg).toMatch(/^\s*if\(gx\)\{/); expect(seg).toContain('settings.gxDirect=v;menu.refresh()'); expect(seg).not.toContain('saveSettings');
    expect(vrView).toContain("row:'直接描く（試験）'"); expect(vrView).toContain("row:'Direct draw (trial)'");
    const tab4 = vrView.indexOf('}else if(ui.tab===4){'), end = vrView.indexOf('return w;', tab4);
    expect(i).toBeGreaterThan(tab4); expect(i).toBeLessThan(end); // inside the diagnostics page's block
  });
  it('the host draw path: with the path not asked the centre pass is called as before (no inner rect), and the new pieces are called only when asked', () => {
    expect(host).toContain("const low = pass('low', f, tmpEye, i => (fovOn ? rectsMeet(boxOf(i), rectOf(i)) : boxOf(i)), innerLow, 0);");
    expect(host).toContain('const innerLow = dReq ? (i, r) =>');
    expect(host).toContain('const dReq = volume.direct.asked && volume.direct.canUse(');
    expect(host).toContain('if (dReq) {'); // the uniforms of the path only for a frame that asked
    expect(host).toContain('scissors: bandRects(r, inner?.(i, r) ?? null, H, scale, shrink)');
    expect(host).toContain("peri = pass('peri', fp, tmpPeri, boxOf, i => rectOf(i), band + Math.ceil(2 / Math.max(fp, 0.05)) + 1);");
    expect(host).toContain('volume.drawPass(low.target, low.eyes, u, vr, 0, null, null, { proxy: low.px })');
  });
});

describe('the record', () => {
  it('counts the frames, the second\'s row, the check; the report says what the path is and what it did not check', () => {
    const d = createDirectLog();
    d.frame(false, false); d.frame(true, true); d.frame(true, true); d.frame(true, false);
    expect(d.totals).toMatchObject({ frames: 4, asked: 3, used: 2, miss: 1 });
    expect(d.takeRow()).toEqual({ dir: 2, dmiss: 1 }); expect(d.takeRow()).toEqual({ dir: 0, dmiss: 0 });
    d.check({ total: 1000, covered: 800, colour: 0, depth: 0 }); d.check({ total: 1000, covered: 700, colour: 3, depth: 1, text: 'rect 1,2-3,4' }); d.check(null); d.check({ total: 0 });
    expect(d.checks).toMatchObject({ n: 2, px: 2000, covered: 1500, colour: 3, depth: 1, bad: 1 });
    d.note('direct draw', 'hooked');
    const p = { direct: d, rows: [{ t: 1, dir: 2, dmiss: 1, f: 1, vol: 1.234, main: 5.5, span: 7, oth: 0.2 }, { t: 2, dir: null }, { t: 3 }] };
    const text = directReport(p).join('\n');
    expect(text).toContain('direct draw: hooked'); expect(text).toContain('4 drawn, 3 asked'); expect(text).toContain('2 went through it'); expect(text).toContain('colour differs in 3 px, depth differs in 1 px, 1 checks with a difference');
    expect(text).toContain('-- direct draw checks (one line per check, the first 400'); expect(text.split('\n').filter(l => l.startsWith('  chk ')).length).toBe(2); expect(text).toMatch(/not checked/);
    expect(text).toMatch(/1 +2 +1 +1 +1\.2 +5\.5 +7 +0\.2/);
    const cmp = directReport({ direct: d, rows: [{ t: 1, dir: 3, fps: 72, g1: 70, g2: 2, g3: 0, vol: 2, main: 6, span: 8 }, { t: 2, dir: 0, fps: 72, g1: 71, g2: 1, g3: 0, vol: 9, main: 1, span: 11 }, { t: 3, dir: 0, fps: 72, menu: 1, g1: 72, g2: 0, g3: 0, vol: 99 }] }).join('\n');
    expect(cmp).toContain('with direct frames (dir > 0): 1 rows, vol 2 ms, main 6 ms, span 8 ms, frame intervals over 1.5 periods (g2 + g3) 2 of 72');
    expect(cmp).toContain('without (dir = 0): 1 rows, vol 9 ms, main 1 ms, span 11 ms, over 1.5 periods 1 of 72'); // the row with the menu open is left out
    expect(directReport({ direct: createDirectLog() })).toEqual([]); // never asked: no section
    expect(directReport({})).toEqual([]);
  });
  it('aggregates the 16 values of the checks: the largest differences, the sums and the checks per class, one line per check (at most 400)', () => {
    const d = createDirectLog();
    const base = { total: 1000, covered: 800, colour: 0, depth: 0, cmax: 0, dmax: 0, covA: 790, covB: 800, both: 780, c1: 0, d2: 0, d256: 0, edge: 0, aFront: 0, bFront: 0, shift: 0 };
    const meta = { noteNo: 10, checkNo: 11, D: [191, 141, 449, 339], region: [178, 128, 462, 352], W: 640, H: 480, pre: true, orgA: [0, 0], orgB: [178, 128] };
    d.check({ ...base, ...meta, colour: 5, depth: 4, cmax: 3, dmax: 70, c1: 2, d2: 1, d256: 0, edge: 3, aFront: 1, bFront: 3, shift: 2, text: 'x' }, { t: 12.34, per: 1, hold: 0.8 });
    d.check({ ...base, ...meta, noteNo: 18, checkNo: 19, colour: 1, depth: 0, cmax: 9, dmax: 300, c1: 0, d2: 0, d256: 2, edge: 0, aFront: 2, bFront: 0, shift: 0 }, { t: 13.5, per: 0.9, hold: 1 });
    d.check({ ...base, ...meta }, { t: 14, per: 1, hold: 1 });
    const c = d.checks;
    expect(c).toMatchObject({ n: 3, colour: 6, depth: 4, bad: 2, cmaxMax: 9, dmaxMax: 300, omitted: 0 });
    expect(c.sum).toMatchObject({ covered: 2400, colour: 6, depth: 4, covA: 2370, covB: 2400, both: 2340, c1: 2, d2: 1, d256: 2, edge: 3, aFront: 3, bFront: 3, shift: 2 });
    expect(c.nz).toMatchObject({ covered: 3, colour: 2, depth: 1, c1: 1, d2: 1, d256: 1, edge: 1, aFront: 2, bFront: 1, shift: 1 });
    expect(Object.keys(c.sum)).toEqual(CHECK_CLASSES.map(x => x[0]));
    expect(c.rows).toHaveLength(3); expect(c.rows[0]).toMatchObject({ t: 12.34, per: 1, hold: 0.8, noteNo: 10, checkNo: 11 });
    const text = directReport({ direct: d, rows: [] }).join('\n'), lines = text.split('\n');
    expect(text).toContain('largest colour difference of any check 9 (0..255), largest depth difference of any check 300 (24-bit units)');
    expect(text).toContain('depth differs by 256 or more (both covered): 2 px in total, in 1 of 3 checks');
    expect(text).toContain('differs but equals B with A shifted by 1 px: 2 px in total, in 1 of 3 checks');
    const rows = lines.filter(l => l.startsWith('  chk '));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe('  chk t=12.3 per=1 hold=0.8 note#10 chk#11 D=191,141,449,339 R=178,128,462,352 640x480 pre=1 orgA=0,0 orgB=178,128 | col 5 dep 4 of 800 cmax 3 dmax 70 A 790 B 800 both 780 c1 2 d2 1 d256 0 edge 3 Af 1 Bf 3 sh 2 (1000 px)');
    // more than 400 checks: the rows stop at 400, the totals go on
    const e = createDirectLog();
    for (let i = 0; i < CHECK_ROWS + 25; i++) e.check({ ...base, ...meta, colour: 1, cmax: 1 }, { t: i, per: 1, hold: 1 });
    expect(e.checks.rows).toHaveLength(CHECK_ROWS); expect(e.checks.omitted).toBe(25); expect(e.checks.n).toBe(CHECK_ROWS + 25); expect(e.checks.sum.colour).toBe(CHECK_ROWS + 25);
    expect(directReport({ direct: e, rows: [] }).filter(l => l.startsWith('  chk ')).length).toBe(CHECK_ROWS);
    expect(directReport({ direct: e, rows: [] }).join('\n')).toContain('25 more checks are in the totals only');
    // a check without the new values (an older result) is still counted, with zeros
    const o = createDirectLog(); o.check({ total: 10, covered: 4, colour: 1, depth: 0 }); expect(o.checks).toMatchObject({ n: 1, cmaxMax: 0, bad: 1 }); expect(directReport({ direct: o, rows: [] }).join('\n')).toContain('  chk t=- per=- hold=-');
  });
  it('perfReport prints the section only when the log has one; the report without it is unchanged', () => {
    const base = createPerfLog({ kind: 'webgpu', mode: 'vr' }); base.row({ f: 1 });
    const without = perfReport(base);
    expect(without).not.toContain('direct draw');
    const d = createDirectLog(); d.frame(true, true);
    const withIt = createPerfLog({ kind: 'webgpu', mode: 'vr' }); withIt.row({ f: 1, ...d.takeRow() }); withIt.direct = d;
    const text = perfReport(withIt);
    expect(text).toContain('-- direct draw (trial)'); expect(text).toContain('-- direct draw rows');
    expect(perfReport(withIt).split('-- direct draw (trial)')[0].length).toBeGreaterThan(0);
    const noAsk = createPerfLog({ kind: 'webgpu', mode: 'vr' }); noAsk.row({ f: 1 }); noAsk.direct = createDirectLog();
    expect(perfReport(noAsk).split('\n').filter(l => /^-- direct draw/.test(l))).toEqual([]);
  });
  it('the page feeds it: one frame call after the main render, the check while recording, the row, the log on the perf log', () => {
    expect(vrView).toContain('gxDirLog.frame(gxDirAsked,gxDirUsed)');
    expect(vrView).toContain('else if(ph===2&&(gxS.rendered&7)===2){try{const cx={t:(tn-gxRec.t0)/1000,per:rs.per,hold:hkMin};gx.vol.direct.check(r=>gxDirLog.check(r,cx),frec)}'); // the context (time, per, hold) is taken when the check starts; after the frame's marker, in a frame of neither the shadow pass (phase 1) nor the probe (phase 3)
    expect(vrView).toContain('perfLog.row=(snap,at)=>row0({...snap,...gxDirLog.takeRow()},at)');
    expect(vrView).toContain('perfLog.direct=gxDirLog;');
  });
});
