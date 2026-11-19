// WebGPU VR: the depth of the headset's image is not stored (discardXrDepth, docs/vr-wgpu.js). The real three.js WebGPUBackend.finishRender runs on a mock device (CI has no GPU):
// the descriptors of the passes it begins are recorded.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREEG from 'three/webgpu';
import { discardXrDepth } from '../../docs/vr-wgpu.js';

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const vr = read('vr-view.js'), host = read('vr-wgpu.js');

// a backend with the prototype's real finishRender; the encoder records a snapshot of each descriptor at the moment the pass is begun
function mockBackend(stages = 1) {
  const passes = [], submits = [];
  const encoder = {
    beginRenderPass(d) {
      passes.push({ label: d.label, colorLoad: d.colorAttachments[0].loadOp, colorStore: d.colorAttachments[0].storeOp, depthLoad: d.depthStencilAttachment?.depthLoadOp, depthStore: d.depthStencilAttachment?.depthStoreOp, view: d.depthStencilAttachment?.view });
      return { setViewport() {}, setScissorRect() {}, executeBundles() {}, end() {} };
    },
    finish: () => ({}),
  };
  const b = Object.create(THREEG.WebGPUBackend.prototype);
  const store = new Map();
  b.get = o => { if (!store.has(o)) store.set(o, {}); return store.get(o); };
  b.getOcclusionData = () => ({});
  b.device = { queue: { submit: c => submits.push(c) } };
  b._finishArrayCameraBundleEncoders = () => [{}, {}];
  b._copyFramebufferToTexture = () => {};
  // what beginRender leaves for an XR frame (layered render of an array camera): layer descriptors, the stages, the encoder
  const layer = i => ({ label: 'eye' + i, colorAttachments: [{ view: 'c' + i, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: 'd' + i, depthLoadOp: 'clear', depthStoreOp: 'store' } });
  const xrTarget = { isXr: true }, ctx = { renderTarget: xrTarget, depth: true, stencil: false, occlusionQueryCount: 0, textures: null, camera: { isArrayCamera: true, cameras: [{}, {}] }, depthTexture: { isArrayTexture: true } };
  const data = b.get(ctx);
  Object.assign(data, { renderBundles: [], encoder, layerDescriptors: [layer(0), layer(1)], arrayCameraRenderStages: Array.from({ length: stages - 1 }, () => ({ bundles: [{}, {}] })) }); // finishRender adds the last stage itself
  b._finishArrayCameraBundleEncoders = () => [{}, {}];
  const nextFrame = () => Object.assign(data, { encoder, renderBundles: [], arrayCameraRenderStages: [] }); // what the next beginRender does (the layer descriptors are kept)
  return { b, ctx, data, nextFrame, passes, submits, xrTarget, layer };
}

describe('WebGPU: the XR passes do not store the depth', () => {
  it('control: three.js alone begins both eye passes with depthStoreOp store (and the clear is kept)', () => {
    const m = mockBackend();
    m.b.finishRender(m.ctx);
    expect(m.passes.map(p => [p.label, p.depthLoad, p.depthStore])).toEqual([['eye0', 'clear', 'store'], ['eye1', 'clear', 'store']]);
  });
  it('with the hook: both eye passes discard the depth, clear it first, and keep the colour ops', () => {
    const m = mockBackend();
    const r = { backend: m.b, xr: { _xrRenderTarget: m.xrTarget } };
    expect(discardXrDepth(r).installed).toBe(true);
    m.b.finishRender(m.ctx);
    expect(m.passes.map(p => [p.label, p.depthLoad, p.depthStore, p.colorLoad, p.colorStore])).toEqual([['eye0', 'clear', 'discard', 'clear', 'store'], ['eye1', 'clear', 'discard', 'clear', 'store']]);
    expect(m.passes.map(p => p.view)).toEqual(['d0', 'd1']); // the depth attachments are the same views
    expect(m.submits).toHaveLength(1);
  });
  it('the next frame too (three.js reuses the layer descriptors), and the descriptor is left with discard', () => {
    const m = mockBackend(); discardXrDepth({ backend: m.b, xr: { _xrRenderTarget: m.xrTarget } });
    m.b.finishRender(m.ctx); m.passes.length = 0; m.nextFrame(); m.b.finishRender(m.ctx);
    expect(m.passes).toHaveLength(2);
    expect(m.passes.map(p => p.depthStore)).toEqual(['discard', 'discard']);
  });
  it('a clear frame, then a frame that loads the depth, then a clear frame again: discard / store / discard (the descriptors are reused, the op follows the frame)', () => {
    const m = mockBackend(); discardXrDepth({ backend: m.b, xr: { _xrRenderTarget: m.xrTarget } });
    const ops = []; for (const load of ['clear', 'load', 'clear']) { m.nextFrame(); for (const ld of m.data.layerDescriptors) ld.depthStencilAttachment.depthLoadOp = load; m.passes.length = 0; m.b.finishRender(m.ctx); ops.push(m.passes.map(p => p.depthStore).join('+')); }
    expect(ops).toEqual(['discard+discard', 'store+store', 'discard+discard']);
  });
  it('a multi-stage layer (a framebuffer copy in between): the stages before the last keep store and load, only the last one discards', () => {
    const m = mockBackend(2); discardXrDepth({ backend: m.b, xr: { _xrRenderTarget: m.xrTarget } });
    m.b.finishRender(m.ctx);
    // three.js orders the passes layer by layer: eye0 stage0, eye0 stage1, eye1 stage0, eye1 stage1
    expect(m.passes.map(p => [p.depthLoad, p.depthStore])).toEqual([['clear', 'store'], ['load', 'discard'], ['clear', 'store'], ['load', 'discard']]);
  });
  it('a frame that loads the depth of the last one (no clear) keeps store, and a read-only depth is left alone', () => {
    const m = mockBackend(); discardXrDepth({ backend: m.b, xr: { _xrRenderTarget: m.xrTarget } });
    m.data.layerDescriptors[0].depthStencilAttachment.depthLoadOp = 'load';
    m.data.layerDescriptors[1].depthStencilAttachment.depthReadOnly = true;
    m.b.finishRender(m.ctx);
    expect(m.passes.map(p => p.depthStore)).toEqual(['store', 'store']);
  });
  it('any other render context keeps store: another render target (layered), the XR target without the layered branch (one pass, never touched), no layer descriptors', () => {
    const m1 = mockBackend(); discardXrDepth({ backend: m1.b, xr: { _xrRenderTarget: m1.xrTarget } });
    m1.ctx.renderTarget = { other: true }; m1.b.finishRender(m1.ctx);
    expect(m1.passes.map(p => p.depthStore)).toEqual(['store', 'store']);
    const m2 = mockBackend(); discardXrDepth({ backend: m2.b, xr: { _xrRenderTarget: m2.xrTarget } });
    m2.ctx.camera = { isArrayCamera: false }; m2.data.arrayCameraRenderStages = undefined; let ended = 0; m2.data.currentPass = { end() { ended++; } };
    m2.b.finishRender(m2.ctx);
    expect(ended).toBe(1); expect(m2.passes).toEqual([]);
    for (const ld of m2.data.layerDescriptors) expect(ld.depthStencilAttachment.depthStoreOp).toBe('store'); // stale layer descriptors are not touched
    const m3 = mockBackend(); discardXrDepth({ backend: m3.b, xr: { _xrRenderTarget: m3.xrTarget } });
    m3.data.layerDescriptors = undefined; m3.ctx.camera = { isArrayCamera: false }; m3.data.arrayCameraRenderStages = undefined; m3.data.currentPass = { end() {} };
    expect(() => m3.b.finishRender(m3.ctx)).not.toThrow();
  });
  it('the passes of the volume (vr-wgpu.js) are not changed: their depth is a colour attachment that stays "store", and the only depthStoreOp in the file is the hook\'s', () => {
    expect(host.match(/\{ view: [\w.]+\.depthView, loadOp: 'clear', storeOp: 'store'/g)).toHaveLength(3); // low / peri target, the breakdown's shadow and probe passes
    const hook = host.slice(host.indexOf('// the depth of the headset'), host.indexOf('// the device is lost for another reason'));
    expect(host.replace(hook, '')).not.toMatch(/depthStoreOp|depthStencilAttachment/);
    expect(host.replace(hook, '').match(/storeOp: 'discard'/g)).toHaveLength(1); // the frame marker's colour attachment, as before
  });
  it('installed once (a second call returns the same record, the hook is not stacked), and a renderer without a backend is left alone with a record that says so', () => {
    const m = mockBackend(), r = { backend: m.b, xr: { _xrRenderTarget: m.xrTarget } };
    discardXrDepth(r); const f = m.b.finishRender; expect(discardXrDepth(r).installed).toBe(true); expect(m.b.finishRender).toBe(f);
    const bad = discardXrDepth({ xr: {} });
    expect(bad.installed).toBe(false); expect(bad.text).toMatch(/stored as three\.js does/);
  });
  it('vr-view.js: the hook is set once, right after the output path, on the WebGPU renderer only', () => {
    expect(vr).toContain("const out=useMaterialSrgbOutput(r,THREEG);gxD.value('output path',out.text);gxD.value('xr depth',discardXrDepth(r).text);const mainTs=");
    expect(vr.match(/discardXrDepth\(/g)).toHaveLength(1);
    expect(host).toContain('export function discardXrDepth(renderer)');
  });
});
