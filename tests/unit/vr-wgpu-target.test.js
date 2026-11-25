// The offscreen targets of the WebGPU view (docs/vr-wgpu.js): one target per pass (centre / whole picture, periphery), made once at the largest size an eye can need; a region that changes size only changes which part of it
// is drawn (viewport / scissors) and read (the composite's uv). With a mock device (no GPU in CI): nothing is made, destroyed or bound again while the region's size changes, the part drawn and the part the composite reads agree,
// the pre-pass's tiles and the breakdown's scratch targets follow the same rule. The images themselves (754 against this build, byte for byte, on a real GPU) are not testable here.
import { describe, it, expect, vi } from 'vitest';
import * as THREEG from 'three/webgpu';
import { uniformLayout, PROXY_FIELDS } from '../../docs/vr-wgsl-core.js';
import { createVrVolumeRenderer } from '../../docs/vr-wgpu.js';
import { FOVEA_K } from '../../docs/vr-render-scale.js';
import { BD_SPECS } from '../../docs/vr-perf-log.js';

const withGpu = fn => async () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
  try { await fn(); } finally { vi.unstubAllGlobals(); }
};
const settle = () => new Promise(r => setTimeout(r, 0));
const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4(), matrixWorldInverse: new THREEG.Matrix4(), matrixWorld: new THREEG.Matrix4() });
// a device that logs what is made and what is drawn; timestamps on request (the breakdown needs them)
const mockGpu = ({ timestamps = false } = {}) => {
  const log = { passes: [], textures: [], bindGroups: [], computePasses: [], writes: [], destroyed: 0 };
  const device = { features: new Set(timestamps ? ['timestamp-query'] : []), limits: {} };
  device.queue = { writeBuffer: (b, off, data) => { log.writes.push(new Int32Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0))); }, writeTexture() {}, submit() {} };
  device.createQuerySet = d => ({ d, destroy() {} });
  device.createBuffer = d => { const b = { d, destroyed: false, destroy() { b.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => (d.size > 16 ? new Uint32Array(d.size / 4).buffer : new BigUint64Array([1n, 2n]).buffer), unmap() {} }; return b; };
  device.createTexture = d => { const t = { d, destroyed: false, destroy() { t.destroyed = true; log.destroyed++; }, createView: () => ({ t }) }; log.textures.push(t); return t; };
  device.createSampler = () => ({}); device.createBindGroupLayout = () => ({}); device.createPipelineLayout = () => ({}); device.createShaderModule = () => ({});
  device.createComputePipeline = d => ({ d }); device.createComputePipelineAsync = async d => ({ d }); device.createRenderPipeline = d => ({ d }); device.createRenderPipelineAsync = async d => ({ d });
  device.createBindGroup = d => { const g = { d }; log.bindGroups.push(g); return g; };
  device.createCommandEncoder = () => ({
    beginRenderPass: d => { const p = { d, viewports: [], scissors: [], groups: {} }; log.passes.push(p); return { setPipeline() {}, setVertexBuffer() {}, setBindGroup: (i, g) => { p.groups[i] = g; }, setViewport: (...a) => p.viewports.push(a), setScissorRect: (...a) => p.scissors.push(a), draw() {}, end() {} }; },
    beginComputePass: d => { const p = { d, dispatches: [] }; log.computePasses.push(p); return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups: (...a) => p.dispatches.push(a), end() {} }; },
    resolveQuerySet() {}, copyBufferToTexture() {}, copyBufferToBuffer() {}, clearBuffer() {}, copyTextureToBuffer() {}, finish: () => ({}),
  });
  return { device, log };
};
const attachments = log => log.textures.filter(t => t.d.format === 'rgba8unorm' && (t.d.usage & 4) && t.d.size[0] > 64); // the passes' colour / packed depth targets (not the 64 x 64 probes, the timer's 1 x 1 marker)
const tiles = log => log.textures.filter(t => t.d.format === 'r32float' && (t.d.usage & 16)); // the pre-pass's tiles (STORAGE_BINDING; not the 1 x 1 stand-in)
// a session's uniforms that let the low pass use the pre-pass (as in vr-wgpu-proxy.test.js)
const proxyU = () => {
  const tex = new THREEG.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4), 4, 4, 4); tex.format = THREEG.RGBAFormat; tex.type = THREEG.UnsignedByteType; tex.needsUpdate = true;
  return { distInCls: { value: 1 }, useCls: { value: 1 }, diag: { value: 0 }, planeCount: { value: 0 }, clsTex: { value: tex }, halfExt: { value: new THREEG.Vector3(1, 1, 1) }, voxelMin: { value: 0.02 }, clsChan: { value: new THREEG.Vector4(0, 1, -1, -1) },
    segA: { value: [0, 1, 2, 3].map(i => new THREEG.Vector4(0, 0, 1, i < 2 ? 1 : 0)) } };
};
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const EW = 1000, EH = 800, PERI_MAX = Math.max(...FOVEA_K.filter(k => k < 1)), VARIANT = { cls4: false, events: false };
// a frame of the sequence: a random box per eye (from a sliver to the whole eye, sometimes off to the side), a random scale, the periphery on or off at a random FOVEA_K
const randomFrame = rand => {
  const box = () => { const w = 1 + rand() * EW * (rand() < 0.15 ? 1.2 : 0.7), h = 1 + rand() * EH * (rand() < 0.15 ? 1.2 : 0.7), x0 = -50 + rand() * (EW - w + 100), y0 = -50 + rand() * (EH - h + 100); return { x0, y0, x1: x0 + w, y1: y0 + h }; };
  const f = rand() < 0.25 ? 1 : 0.3 + rand() * 0.7, fov = rand() < 0.6, kF = FOVEA_K[1 + (rand() * 2 | 0)], cx = 150 + rand() * 300, cy = 100 + rand() * 250;
  return { f, fov, fp: f * kF, rects: fov ? [[cx, cy, cx + 300, cy + 250], [cx + 20, cy, cx + 320, cy + 250]] : null, band: 6, boxes: [box(), box()] };
};
const drawFrame = (r, u, fr, W = EW, H = EH) => r.draw({ u, cams: [eyeCam(W, H), eyeCam(W, H)], model: new THREEG.Matrix4(), variant: VARIANT, ...fr });

describe('one target per pass, made once at the largest size', () => {
  it('300 frames of boxes of every size, scales 0.3 - 1 and the periphery at either FOVEA_K make no texture, no bind group and no target after the first frames, and destroy nothing', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU(), rand = rng(755);
    drawFrame(r, u, { f: 1, fov: false, boxes: [{ x0: 0, y0: 0, x1: EW, y1: EH }, { x0: 0, y0: 0, x1: EW, y1: EH }] });
    drawFrame(r, u, { f: 0.5, fov: true, fp: 0.375, rects: [[300, 300, 700, 700], [300, 300, 700, 700]], band: 6, boxes: [{ x0: 100, y0: 100, x1: 900, y1: 700 }, { x0: 100, y0: 100, x1: 900, y1: 700 }] });
    const made = { tex: log.textures.length, rt: attachments(log).length, tiles: tiles(log).length, groups: log.bindGroups.length };
    expect(made.rt).toBe(4); expect(made.tiles).toBe(1); // colour + packed depth of the centre pass and of the periphery pass; one tiles texture
    const slots = new Set(); let regs = new Set();
    for (let k = 0; k < 300; k++) { const st = drawFrame(r, u, randomFrame(rand)); slots.add(st.regions.slot.join('x')); regs.add(st.regions.low.map(x => x.join('x')).join()); }
    expect(slots.size).toBeGreaterThan(5); expect(regs.size).toBeGreaterThan(50); // the sizes did change (slots step, regions every frame)
    expect(log.textures.length).toBe(made.tex); expect(attachments(log).length).toBe(made.rt); expect(tiles(log).length).toBe(made.tiles); expect(log.bindGroups.length).toBe(made.groups); expect(log.destroyed).toBe(0);
    r.dispose();
  }));
  it('the sizes: the centre pass for two eyes of the eye\'s full size (+ the 2 px gap), the periphery pass for the largest scale below 1; both rounded up to 64; 8 bytes a texel (colour + packed depth)', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] });
    drawFrame(r, proxyU(), { f: 0.4, fov: true, fp: 0.2, rects: [[300, 300, 700, 700], [300, 300, 700, 700]], band: 6, boxes: [{ x0: 100, y0: 100, x1: 300, y1: 200 }, { x0: 100, y0: 100, x1: 300, y1: 200 }] });
    const up = n => Math.ceil(n / 64) * 64, a = attachments(log);
    expect(a.map(t => t.d.size.slice(0, 2).join('x'))).toEqual([up((EW + 2) * 2) + 'x' + up(EH), up((EW + 2) * 2) + 'x' + up(EH), up((Math.ceil(EW * PERI_MAX) + 2) * 2) + 'x' + up(Math.ceil(EH * PERI_MAX)), up((Math.ceil(EW * PERI_MAX) + 2) * 2) + 'x' + up(Math.ceil(EH * PERI_MAX))]);
    const bytes = a.reduce((s, t) => s + t.d.size[0] * t.d.size[1] * 4, 0);
    expect(bytes).toBe(8 * (up(2004) * up(800) + up(1504) * up(600))); // 2048 x 832 and 1536 x 640 texels, 8 bytes each (about 13.6 MB + 7.9 MB for these 1000 x 800 eyes)
    r.dispose();
  }));
  it('the composite\'s nodes keep one ExternalTexture each over all the frames (the centre pass\'s pair, the periphery\'s pair, or the first pair again when there is none): nothing for three.js to bind again', withGpu(() => {
    const { device } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU(), rand = rng(7);
    const seen = { c1: new Set(), d1: new Set(), c2: new Set(), d2: new Set() }, srcs = new Set();
    for (let k = 0; k < 120; k++) {
      drawFrame(r, u, randomFrame(rand));
      for (const key of Object.keys(seen)) { seen[key].add(r.composite.nodes[key].value); srcs.add(r.composite.nodes[key].value.sourceTexture); }
    }
    expect(seen.c1.size).toBe(1); expect(seen.d1.size).toBe(1); expect(seen.c2.size).toBeLessThanOrEqual(2); expect(seen.d2.size).toBeLessThanOrEqual(2); // c2 / d2: the periphery's, or the centre's when the periphery is off
    expect(srcs.size).toBe(4);
    r.dispose();
  }));
  it('what is drawn and what the composite reads agree: the viewport of each eye is its region at the slot\'s offset inside the target, the scissors lie inside the viewport, and every uv the composite makes (the shader\'s own formula, the uniforms the renderer set) falls inside the region', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU(), rand = rng(99), cu = r.composite.u, sizes = [];
    const uvX = (px, py, eye, scale, stride, reg, inv, tw, th) => { // the composite's uvOf (vr-wgpu.js), in target texels
      const sx = px * scale - reg[0], sy = py * scale - reg[1], cl = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
      return { x: (cl(sx, 0.5, Math.max(reg[2] - 0.5, 0.5)) + eye * stride) * inv[0] * tw, y: cl(sy, 0.5, Math.max(reg[3] - 0.5, 0.5)) * inv[1] * th, inside: sx >= 0 && sx <= reg[2] && sy >= 0 && sy <= reg[3] };
    };
    for (let k = 0; k < 150; k++) {
      const np = log.passes.length, fr = randomFrame(rand); drawFrame(r, u, fr);
      const passes = log.passes.slice(np), stride1 = cu.stride1.value, tl = cu.inv1.value, tw = Math.round(1 / tl.x), th = Math.round(1 / tl.y);
      if (!sizes[0]) sizes[0] = [tw, th]; if (fr.fov && !sizes[1]) sizes[1] = [Math.round(1 / cu.inv2.value.x), Math.round(1 / cu.inv2.value.y)];
      const sets = [{ pass: passes[0], stride: stride1, scale: cu.scale1.value, regs: [cu.reg1a.value.toArray(), cu.reg1b.value.toArray()], inv: [cu.inv1.value.x, cu.inv1.value.y] }];
      if (fr.fov) sets.push({ pass: passes[1], stride: cu.stride2.value, scale: cu.scale2.value, regs: [cu.reg2a.value.toArray(), cu.reg2b.value.toArray()], inv: [cu.inv2.value.x, cu.inv2.value.y] });
      expect(passes.length).toBe(sets.length);
      for (const [si, s] of sets.entries()) {
        const W = si === 0 ? tw : Math.round(1 / cu.inv2.value.x), H = si === 0 ? th : Math.round(1 / cu.inv2.value.y);
        expect(W).toBe(sizes[si][0]); expect(H).toBe(sizes[si][1]); // the target is the same size every frame (inv is 1 / its size): the one of the first frame
        s.pass.viewports.forEach((vp, i) => {
          const reg = s.regs[i];
          expect(vp.slice(0, 4)).toEqual([i * s.stride, 0, reg[2], reg[3]]); // the region at the eye's slot (eye i at i * stride)
          expect(vp[0] + vp[2]).toBeLessThanOrEqual(W); expect(vp[1] + vp[3]).toBeLessThanOrEqual(H);
          for (const sc of s.pass.scissors.slice(0)) if (sc[0] >= vp[0] && sc[0] < vp[0] + vp[2]) { expect(sc[0] + sc[2]).toBeLessThanOrEqual(vp[0] + vp[2] + (i === 0 ? s.stride : 0)); expect(sc[1] + sc[3]).toBeLessThanOrEqual(vp[1] + vp[3]); }
          for (let n = 0; n < 40; n++) { // pixels of the eye's image, in and outside the region
            const q = uvX(rand() * EW, rand() * EH, i, s.scale, s.stride, reg, s.inv, W, H);
            expect(q.x).toBeGreaterThanOrEqual(vp[0] + 0.5 - 1e-6); expect(q.x).toBeLessThanOrEqual(vp[0] + Math.max(vp[2] - 0.5, 0.5) + 1e-6); // inside this eye's slot: never the other eye's, never a texel that was not drawn this frame
            expect(q.y).toBeGreaterThanOrEqual(0.5 - 1e-6); expect(q.y).toBeLessThanOrEqual(Math.max(vp[3] - 0.5, 0.5) + 1e-6);
          }
        });
      }
    }
    r.dispose();
  }));
  it('the scissors of every pass lie inside its viewport (the periphery\'s bands too), whatever the region', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU(), rand = rng(5);
    for (let k = 0; k < 100; k++) {
      const np = log.passes.length; drawFrame(r, u, randomFrame(rand));
      for (const p of log.passes.slice(np)) {
        // the draws of eye i come after its viewport: pair them in order (the mock logs viewports and scissors apart, so check the union of the scissors per eye against the viewport of the eye with the same x range)
        for (const sc of p.scissors) { const vp = p.viewports.find(v => sc[0] >= v[0] && sc[0] < v[0] + v[2]); expect(vp, 'a viewport holds the scissor').toBeTruthy(); expect(sc[0] + sc[2]).toBeLessThanOrEqual(vp[0] + vp[2]); expect(sc[1] + sc[3]).toBeLessThanOrEqual(vp[1] + vp[3]); expect(sc[2]).toBeGreaterThan(0); expect(sc[3]).toBeGreaterThan(0); }
      }
    }
    r.dispose();
  }));
  it('the eye\'s size changing (a bigger XR framebuffer) makes the targets once more and lets the old ones go; no node points at a destroyed texture; a smaller eye after it makes nothing', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU(), rand = rng(3);
    const fr = () => ({ ...randomFrame(rand), fov: true, fp: 0.5, rects: [[300, 300, 700, 700], [300, 300, 700, 700]] });
    drawFrame(r, u, fr()); const first = attachments(log).slice();
    expect(first).toHaveLength(4);
    drawFrame(r, u, fr(), 1200, 900);
    const second = attachments(log).slice(4); expect(second).toHaveLength(4); expect(first.every(t => t.destroyed)).toBe(true);
    const live = [r.composite.nodes.c1, r.composite.nodes.d1, r.composite.nodes.c2, r.composite.nodes.d2].map(n => n.value.sourceTexture); expect(live.every(t => !t.destroyed)).toBe(true);
    const n = log.textures.length; for (let k = 0; k < 20; k++) drawFrame(r, u, fr(), k % 2 ? 1000 : 1200, k % 2 ? 800 : 900);
    expect(log.textures.length).toBe(n); // 1000 x 800 again, and back: the larger target is kept, nothing is made
    r.dispose();
  }));
  it('both targets are made at the first draw, also when no periphery is drawn, and are kept for the whole session', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU();
    drawFrame(r, u, { f: 1, fov: false, boxes: [{ x0: 0, y0: 0, x1: 100, y1: 100 }, { x0: 0, y0: 0, x1: 100, y1: 100 }] }); expect(attachments(log)).toHaveLength(4);
    drawFrame(r, u, { f: 1, fov: true, fp: 0.75, rects: [[0, 0, 500, 500], [0, 0, 500, 500]], band: 6, boxes: [{ x0: 0, y0: 0, x1: 900, y1: 700 }, { x0: 0, y0: 0, x1: 900, y1: 700 }] }); expect(attachments(log)).toHaveLength(4);
    for (let k = 0; k < 10; k++) drawFrame(r, u, { f: 0.6, fov: false, boxes: [{ x0: 0, y0: 0, x1: 100 + k * 20, y1: 100 }, { x0: 0, y0: 0, x1: 100, y1: 100 }] });
    expect(attachments(log)).toHaveLength(4); expect(log.destroyed).toBe(0);
    const mine = attachments(log); r.dispose(); expect(mine.every(t => t.destroyed)).toBe(true);
  }));
});

describe('the periphery target follows the foveation setting', () => {
  const up = n => Math.ceil(n / 64) * 64, periSize = k => (up((Math.ceil(EW * k) + 2) * 2)) + 'x' + up(Math.ceil(EH * k)), lowSize = up((EW + 2) * 2) + 'x' + up(EH);
  const boxes = [{ x0: 0, y0: 0, x1: 900, y1: 700 }, { x0: 0, y0: 0, x1: 900, y1: 700 }];
  const periFrame = (k, f = 1) => ({ f, fov: true, fp: f * k, periK: k, rects: [[200, 200, 600, 600], [200, 200, 600, 600]], band: 6, boxes });
  const sizes = log => attachments(log).map(t => t.d.size.slice(0, 2).join('x'));
  it.each(FOVEA_K.map((k, i) => [i, k]))('setting %i (FOVEA_K %f): the periphery target is made for that scale (none when the setting has no periphery pass)', (i, k) => withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU();
    drawFrame(r, u, { f: 1, fov: false, periK: k, boxes });
    expect(sizes(log)).toEqual(k < 1 ? [lowSize, lowSize, periSize(k), periSize(k)] : [lowSize, lowSize]);
    r.dispose();
  })());
  it('a periphery drawn at 100 % (fp = periK) fits the target of the setting', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU();
    drawFrame(r, u, periFrame(0.5)); const made = log.textures.length;
    for (let k = 0; k < 30; k++) drawFrame(r, u, periFrame(0.5, 1 - k * 0.02));
    expect(log.textures.length).toBe(made); expect(log.destroyed).toBe(0); expect(sizes(log)).toEqual([lowSize, lowSize, periSize(0.5), periSize(0.5)]);
    r.dispose();
  }));
  it('the target is made again only when the setting changes (not for a hold, a head move, a box or the periphery going on / off); the old one goes through onTargetFreed and no node points at it', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU(), rand = rng(756);
    drawFrame(r, u, periFrame(0.5)); const first = attachments(log).slice(), made = log.textures.length;
    for (let k = 0; k < 120; k++) { const fr = randomFrame(rand); drawFrame(r, u, { ...fr, fp: fr.f * 0.5, periK: 0.5 }); } // f 0.3 - 1 (a hold lowers it), boxes everywhere, periphery on / off
    expect(log.textures.length).toBe(made); expect(log.destroyed).toBe(0);
    drawFrame(r, u, periFrame(0.75)); // 強 -> 中
    const a = attachments(log); expect(a).toHaveLength(6); expect(a[4].d.size.slice(0, 2).join('x')).toBe(periSize(0.75));
    expect(first.slice(2).every(t => t.destroyed)).toBe(true); expect(first.slice(0, 2).every(t => !t.destroyed)).toBe(true); // only the periphery's pair went; the centre's stays
    const live = [r.composite.nodes.c1, r.composite.nodes.d1, r.composite.nodes.c2, r.composite.nodes.d2].map(n => n.value.sourceTexture); expect(live.every(t => !t.destroyed)).toBe(true);
    const made2 = log.textures.length, d2 = log.destroyed;
    for (let k = 0; k < 60; k++) { const fr = randomFrame(rand); drawFrame(r, u, { ...fr, fp: fr.f * 0.75, periK: 0.75 }); }
    expect(log.textures.length).toBe(made2); expect(log.destroyed).toBe(d2);
    drawFrame(r, u, periFrame(0.5)); // 中 -> 強: smaller again (the target does not stay at the larger size)
    expect(attachments(log).slice(6).map(t => t.d.size.slice(0, 2).join('x'))).toEqual([periSize(0.5), periSize(0.5)]);
    r.dispose();
  }));
  it('なし: no periphery target; going to a setting with one makes it, going back drops it (destroyed after onTargetFreed), and the centre target is untouched', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU();
    drawFrame(r, u, { f: 0.6, fov: false, periK: 1, boxes }); expect(attachments(log)).toHaveLength(2);
    for (let k = 0; k < 10; k++) drawFrame(r, u, { f: 0.5 + k * 0.05, fov: false, periK: 1, boxes });
    expect(attachments(log)).toHaveLength(2); expect(log.destroyed).toBe(0);
    drawFrame(r, u, periFrame(0.75)); expect(attachments(log)).toHaveLength(4);
    drawFrame(r, u, { f: 0.6, fov: false, periK: 1, boxes });
    const a = attachments(log); expect(a.slice(2).every(t => t.destroyed)).toBe(true); expect(a.slice(0, 2).every(t => !t.destroyed)).toBe(true);
    const live = [r.composite.nodes.c1, r.composite.nodes.d1, r.composite.nodes.c2, r.composite.nodes.d2].map(n => n.value.sourceTexture); expect(live.every(t => !t.destroyed)).toBe(true);
    r.dispose();
  }));
  it('vr-view.js hands the setting\'s FOVEA_K (kF) to the renderer', async () => {
    const { readFileSync } = await import('node:fs');
    const view = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(view).toContain('fov,fp,periK:kF,rects:rsFov');
    expect(view).toContain('const kF=FOVEA_K[settings.foveation|0]??1');
  });
});
describe('the pre-pass\'s tiles and the breakdown\'s scratch targets follow the same rule', () => {
  it('the tiles are one texture for the largest slot; each frame\'s dispatch and the tile of every pixel of a region (eye i\'s tile columns start at i x tilesPerEye) lie inside it', withGpu(() => {
    const { device, log } = mockGpu();
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU(), rand = rng(11), PL = uniformLayout(PROXY_FIELDS), pat = n => PL.fields.find(f => f.name === n).offset / 4;
    for (let k = 0; k < 120; k++) {
      const nc = log.computePasses.length, nw = log.writes.length, fr = randomFrame(rand), st = drawFrame(r, u, fr);
      expect(log.computePasses.length - nc).toBe(1); // the low pass only (the periphery runs none)
      const [tx, ty] = log.computePasses[nc].dispatches[0], d = log.writes.slice(nw).find(w => w.length === PL.byteSize / 4), tilesPerEye = d[pat('tilesPerEye')], tilesY = d[pat('tilesY')], t = tiles(log)[0].d.size;
      expect(tiles(log)).toHaveLength(1);
      expect(t.slice(0, 2)).toEqual([Math.ceil((EW) / 8) * 2, Math.ceil(EH / 8)]); // the largest slot: 125 x 2 columns, 100 rows
      expect([tx, ty]).toEqual([Math.ceil(tilesPerEye * 2 / 8), Math.ceil(tilesY / 8)]); // the dispatch is the used slot's tiles, not the texture's
      expect(tilesPerEye * 2).toBeLessThanOrEqual(t[0]); expect(tilesY).toBeLessThanOrEqual(t[1]);
      for (const [i, reg] of st.regions.low.entries()) expect(i * tilesPerEye + Math.ceil(reg[0] / 8)).toBeLessThanOrEqual(t[0]); // the last tile column an eye's pixel reads
    }
    r.dispose();
  }));
  it('the breakdown\'s scratch targets (shadow passes and the proxy comparison) are made once while the regions change; the comparison runs over the part that was drawn', withGpu(async () => {
    const { device, log } = mockGpu({ timestamps: true });
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }), u = proxyU(), rand = rng(21);
    await r.preload(u, [VARIANT]); // (the session start: the display's own program is the shadow passes' reference, the ways' are the display's)
    await r.breakdown.begin(VARIANT, () => {});
    const shadow = async () => { const fr = { ...randomFrame(rand), fov: false, rects: null }; drawFrame(r, u, fr); const rec = r.volume.markFrame(); let ok = false; for (let t = 0; t < 20 && !ok; t++) { ok = r.breakdown.shadow(rec, BD_SPECS.noProxy); await settle(); } return ok; };
    expect(await shadow()).toBe(true);
    const made = { rt: attachments(log).length, tex: log.textures.length, groups: log.bindGroups.length }, diffs = [];
    for (let k = 0; k < 40; k++) { const nc = log.computePasses.length; await shadow(); for (const p of log.computePasses.slice(nc)) if (p.dispatches.length === 1 && p.dispatches[0][1] <= 800 / 8 && !p.dispatches[0].some(v => v === 0)) diffs.push(p.dispatches[0]); }
    expect(attachments(log).length).toBe(made.rt); expect(log.textures.length).toBe(made.tex); expect(log.bindGroups.length).toBe(made.groups); expect(log.destroyed).toBe(0);
    expect(made.rt).toBe(2 + 2 + 2 + 2); // the centre pass's pair + the periphery pass's pair + the scratch pair + the comparison's second scratch pair (the 64 x 64 probe's pair is not counted)
    expect(new Set(diffs.map(d => d.join('x'))).size).toBeGreaterThan(3); // the comparison's dispatch follows the drawn part (it was not the scratch targets' 2004 x 800 every time)
    r.breakdown.end(); r.dispose();
  }));
  it('vr-wgpu.js: the targets of the two passes come from fixedTarget (not the pool), sized by the pass\'s scale cap; the pool is left for the 48 x 48 probe', async () => {
    const { readFileSync } = await import('node:fs');
    const host = readFileSync(new URL('../../docs/vr-wgpu.js', import.meta.url), 'utf8');
    expect(host).toContain("const target = volume.fixedTarget(name, Math.ceil(W * Math.max(scale, scaleMax[name])), Math.ceil(H * Math.max(scale, scaleMax[name])));");
    expect(host).toContain('const scaleMax = { low: 1, peri: Math.max(...FOVEA_K.filter(k => k < 1)) };');
    expect(host).toContain('const target = volume.getTarget(64, 64), e = eyeUniforms(THREE, model, cam, {});');
    expect(host).not.toContain('volume.getTarget(stride * n, slotH)');
  });
});
