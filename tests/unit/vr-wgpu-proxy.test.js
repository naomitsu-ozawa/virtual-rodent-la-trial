// The pre-pass in the host (docs/vr-wgpu.js), driven with a mock device (no GPU in CI): when the low pass runs it (and when it does not), what the compute pass is given, where it sits in the encoder,
// how its time is counted, what the uniforms of the volume pass carry (proxyOn, proxyOrg), what the breakdown's shadow passes carry, and the proxy comparison (on / off copies, the count read back).
// The maths of the pre-pass and its start are tested in vr-wgsl-proxy.test.js; the text of the passes in vr-breakdown.test.js / vr-wgpu.test.js.
import { describe, it, expect, vi } from 'vitest';
import * as THREEG from 'three/webgpu';
import { uniformLayout, UNIFORM_FIELDS_ALL, PROXY_FIELDS, PROXY, VOLUME_BINDINGS, COUNTER_FIELDS, proxyWgsl } from '../../docs/vr-wgsl-core.js';
import { createVrVolumeRenderer, registerShadowEncoder } from '../../docs/vr-wgpu.js';
import { BD_SPECS, BD_VARIANTS, defineBdVariant } from '../../docs/vr-perf-log.js';

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
    resolveQuerySet() {}, copyBufferToTexture() {}, copyBufferToBuffer: (_s, _o, dst, _d, n) => { if (n === 16 && !(_s.d.usage & 64)) dst.vals = script.shift(); log.cmds.push('copyB' + n); }, clearBuffer: () => log.cmds.push('clear'), copyTextureToBuffer() {}, finish: () => ({}),
  });
  return { device, log };
};
const drawLow = (r, u = {}) => r.draw({ u, cams: [eyeCam(640, 480), eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false } });
const frame = (r, { u = {} } = {}) => { drawLow(r, u); return r.volume.markFrame(); };
const L = uniformLayout(UNIFORM_FIELDS_ALL), PL = uniformLayout(PROXY_FIELDS);
const at = n => L.fields.find(f => f.name === n).offset / 4, pat = n => PL.fields.find(f => f.name === n).offset / 4;
const isMain = w => w.data.length === L.byteSize / 4, isPx = w => w.data.length === PL.byteSize / 4;
// a session's uniforms that let the low pass use the pre-pass: jumps valid (distInCls, useCls), a combined texture on the GPU, no section, two shown slots
let sharedTex = null; // (one combined texture for every uniform set of a test file: a renderer made in one test finds its textures on the GPU as a session does)
const proxyU = (over = {}) => {
  const tex = sharedTex ||= (() => { const t = new THREEG.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4), 4, 4, 4); t.format = THREEG.RGBAFormat; t.type = THREEG.UnsignedByteType; t.needsUpdate = true; return t; })();
  return { distInCls: { value: 1 }, useCls: { value: 1 }, diag: { value: 0 }, planeCount: { value: 0 }, clsTex: { value: tex }, halfExt: { value: new THREEG.Vector3(1, 1, 1) }, voxelMin: { value: 0.02 }, clsChan: { value: new THREEG.Vector4(0, 1, -1, -1) },
    segA: { value: [0, 1, 2, 3].map(i => new THREEG.Vector4(0, 0, 1, i < 2 ? 1 : 0)) }, ...over };
};
const draw = (r, u, extra = {}) => r.draw({ u, cams: [eyeCam(640, 480), eyeCam(640, 480)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false }, ...extra });
const frameOf = (r, u, extra) => { draw(r, u, extra); return r.volume.markFrame(); };
const begin = (r, cb) => r.breakdown.begin({ cls4: false, events: false }, cb);
// the region of the mock frame: 640 x 480 eyes at scale 0.5 -> 320 x 240 per eye, the slot 320 x 240, stride 322; tiles: 40 per eye, 30 rows (dispatched,: the tiles' texture is made once for the target's largest slot: 640 x 480 -> 80 per eye, 60 rows)
const TILES = { perEye: 40, rows: 30, texCols: 160, texRows: 60 };
const bind9 = g => g.d.entries.find(e => e.binding === VOLUME_BINDINGS.proxy).resource.t;

describe('host: the low pass runs the pre-pass first, with the tiles it reads', () => {
  it('a compute pass is encoded before the low render pass (one submit), dispatched over both eyes\' tiles, with a timestamp slot of its own; the tiles are r32float (storage + binding), (80 x 2) x 60: the tiles of the largest slot, the pass dispatches (40 x 2) x 30 of the used slot', withGpu(async () => {
    const { device, log } = mockGpu([[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n], [13_100_000n, 13_200_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    const rec = frameOf(r, proxyU());
    expect(log.computePasses).toHaveLength(1); expect(log.passes).toHaveLength(2); // the compute pass, the low pass, the marker pass
    const c = log.computePasses[0];
    expect(log.cmds.indexOf('cpass')).toBeLessThan(log.cmds.indexOf('pass'));
    expect(c.dispatches).toEqual([[Math.ceil(TILES.perEye * 2 / 8), Math.ceil(TILES.rows / 8)]]);
    expect(c.pipeline.compute).toBe(true); expect(log.computePipelines[0].d.compute.entryPoint).toBe('main');
    expect(log.shaders).toContain(proxyWgsl({ cls4: false }));
    const low = log.passes[0];
    expect(c.d.timestampWrites.querySet).toBe(low.d.timestampWrites.querySet); // one query set, two different slots
    expect([c.d.timestampWrites.beginningOfPassWriteIndex, c.d.timestampWrites.endOfPassWriteIndex]).not.toEqual([low.d.timestampWrites.beginningOfPassWriteIndex, low.d.timestampWrites.endOfPassWriteIndex]);
    const tiles = log.textures.find(t => t.d.format === 'r32float' && t.d.size[0] === TILES.texCols);
    expect(tiles.d.size).toEqual([TILES.texCols, TILES.texRows, 1]); expect(tiles.d.usage & 16).toBe(16); expect(tiles.d.usage & 1).toBe(1); // STORAGE_BINDING | TEXTURE_BINDING
    expect(bind9(low.groups[0])).toBe(tiles); expect(bind9(low.groups[0])).toBe(tiles); // the volume pass reads the texture the compute pass writes
    expect(c.groups[0].d.entries.find(e => e.binding === 4).resource.t).toBe(tiles); // the compute writes the same texture
    await settle(); expect(rec.lowMs).toBeCloseTo(10); r.dispose();
  }));
  it('the volume pass of each eye gets proxyOn 1 and proxyOrg = (its viewport x - 8 x its first tile column, 0); the compute pass gets both eyes\' inverse matrices, origins, region sizes and tile layout', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n], [3n, 4n], [5n, 6n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    frameOf(r, proxyU());
    const w = log.writes.filter(isMain); expect(w).toHaveLength(2);
    expect(w.map(x => x.data[at('proxyOn')])).toEqual([1, 1]);
    expect(w.map(x => [x.data[at('proxyOrg')], x.data[at('proxyOrg') + 1]])).toEqual([[0, 0], [322 - 8 * TILES.perEye, 0]]); // eye 1's viewport starts at the stride 322
    expect(w.map(x => x.data[at('jumpOn')])).toEqual([1, 1]);
    const p = log.writes.filter(isPx); expect(p).toHaveLength(1);
    const d = p[0].data, f = new Float32Array(d.buffer);
    expect([d[pat('nEyes')], d[pat('w0')], d[pat('h0')], d[pat('w1')], d[pat('h1')], d[pat('tilesPerEye')], d[pat('tilesY')]]).toEqual([2, 320, 240, 320, 240, TILES.perEye, TILES.rows]);
    expect(Array.from(d.slice(pat('segOn'), pat('segOn') + 4))).toEqual([1, 1, 0, 0]); expect(Array.from(d.slice(pat('clsChan'), pat('clsChan') + 4))).toEqual([0, 1, -1, -1]);
    expect(f[pat('voxelMin')]).toBeCloseTo(0.02, 6); expect(f[pat('halfExt')]).toBe(1);
    // the region matrix is the identity scaled by the region clip: its inverse times it is the identity (the first columns carry the factors Wu / rw)
    const inv = Array.from(f.slice(pat('inv0'), pat('inv0') + 16)); expect(inv.every(Number.isFinite)).toBe(true); expect(inv[0] * 1).toBeGreaterThan(0);
    r.dispose();
  }));
  it('a pass that may not use it makes no compute pass and has proxyOn 0 with the 1 x 1 stand-in bound: jumps off, sections (the variant and the plane count), the probe\'s diag 5 (diag 4 is OS now: its tiles are the 4 x 4 ones, tests/unit/vr-wgpu-display-ident.test.js; a missing combined texture draws nothing)', withGpu(async () => {
    for (const [what, u, extra] of [['no jumps (distInCls 0)', proxyU({ distInCls: { value: 0 } }), {}], ['section variant', proxyU({ planeCount: { value: 2 } }), { variant: { cls4: false, events: true } }],
      ['diag 5', proxyU({ diag: { value: 5 } }), {}], ['cls4 variant without cls4Tex', proxyU(), { variant: { cls4: true, events: false } }]]) {
      const { device, log } = mockGpu([[1n, 2n], [3n, 4n]]);
      const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
      draw(r, u, extra);
      expect(log.computePasses, what).toHaveLength(0);
      expect(log.writes.filter(isMain).map(x => x.data[at('proxyOn')]), what).toEqual([0, 0]); expect(log.writes.filter(isPx), what).toHaveLength(0);
      expect(bind9(log.passes[0].groups[0]).d.size, what).toEqual([1, 1, 1]); r.dispose();
    }
  }));
  it('the periphery pass (slot 2 / 3) and the probes never run the pre-pass: proxyOn 0 in them, one compute pass for the frame', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n], [3n, 4n], [5n, 6n], [7n, 8n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    draw(r, proxyU(), { fov: true, fp: 0.25, rects: [[160, 120, 480, 360]], band: 8 });
    expect(log.computePasses).toHaveLength(1);
    const w = log.writes.filter(isMain); expect(w).toHaveLength(4); // low x 2, periphery x 2
    expect(w.map(x => x.data[at('proxyOn')])).toEqual([1, 1, 0, 0]);
    const peri = log.passes[1]; expect(bind9(peri.groups[0]).d.size).toEqual([1, 1, 1]);
    r.dispose();
  }));
  it('the compute pass\'s ms is in the volume numbers (vol column, the frame\'s span) and not in the low pass ms the shadow ratios are made against', withGpu(async () => {
    const { device, log } = mockGpu([[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n], [13_100_000n, 13_200_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    const rec = frameOf(r, proxyU()); await settle();
    const gm = r.volume.takeGpuMs(); expect(gm.n).toBe(1); expect(gm.ms).toBeCloseTo(12); // 2 ms compute + 10 ms low pass, one low pass
    expect(rec.lowMs).toBeCloseTo(10); expect(rec.vms).toBeCloseTo(12); expect(rec.vols).toBe(1);
    expect(r.volume.takeFrameStats().spans.map(x => +x.toFixed(3))).toEqual([12.2]); // from the compute pass's start to the marker's end
    r.dispose();
  }));
  it('the tiles are one texture for the session (a frame reuses it) and dispose lets it go', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n], [3n, 4n], [5n, 6n], [7n, 8n], [9n, 10n], [11n, 12n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */ const u = proxyU();
    frameOf(r, u); const n = log.textures.filter(t => t.d.format === 'r32float').length; frameOf(r, u);
    const tiles = log.textures.filter(t => t.d.format === 'r32float' && t.d.size[0] === TILES.texCols); expect(tiles).toHaveLength(1); expect(log.computePasses).toHaveLength(2);
    expect(log.textures.filter(t => t.d.format === 'r32float').length).toBe(n);
    r.dispose(); expect(tiles[0].destroyed).toBe(true);
  }));
});

describe('host: the breakdown\'s shadow passes carry the low pass\'s pre-pass (proxyOn, proxyOrg, the tiles); noProxy leaves it out; the comparison counts the pixels that differ', () => {
  it('same / box carry proxyOn 1 and the low pass\'s proxyOrg and tiles; noProxy and noJump carry 0; noProxy has no program for a frame whose low pass did not use the pre-pass (a silent zero is not made)', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n], [3n, 4n], [5n, 6n], [7n, 8n], [9n, 10n], [11n, 12n], [13n, 14n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    const got = []; await begin(r, (...a) => got.push(a));
    const rec = frameOf(r, proxyU()); const tiles = log.textures.find(t => t.d.format === 'r32float' && t.d.size[0] === TILES.texCols);
    const pxOf = (spec, i = 0) => { const n0 = log.writes.length, np = log.passes.length; const x = r.breakdown.shadow(rec, spec); const w = log.writes.slice(n0).filter(isMain); return { x, w, passes: log.passes.slice(np) }; };
    let o = pxOf(BD_SPECS.same); expect(o.x).toBe(true);
    expect(o.w.map(x => x.data[at('proxyOn')])).toEqual([1, 1]); expect(o.w.map(x => x.data[at('proxyOrg')])).toEqual([0, 2]); expect(bind9(o.passes[0].groups[0])).toBe(tiles);
    await settle();
    const rec2 = frameOf(r, proxyU()); r.breakdown.shadow(rec2, BD_SPECS.noJump); // (the first frame's record has its shadow already)
    o = pxOf(BD_SPECS.noJump); expect(o.x === true || o.x === false).toBe(true);
    const lastTwo = log.writes.filter(isMain).slice(-2); expect(lastTwo.map(x => x.data[at('proxyOn')])).toEqual([0, 0]); expect(lastTwo.map(x => x.data[at('jumpOn')])).toEqual([0, 0]);
    // a frame without the pre-pass (jumps off): noProxy has no program for it
    const rec3 = frameOf(r, proxyU({ distInCls: { value: 0 } })); const np = log.passes.length;
    expect(r.breakdown.shadow(rec3, BD_SPECS.noProxy)).toBeNull(); expect(log.passes.length).toBe(np);
    r.dispose();
  }));
  it('the noProxy turn: the shadow pass with proxyOn 0 (timed), then the same region with the snapshot\'s own uniforms (proxyOn 1, buffers of its own) into a second target, a compute that counts the differing pixels (and the largest colour difference), 16 bytes read back and delivered as (proxyDiff, count, pixels compared), then (diffMax:noProxy, ..) and (diffColor:noProxy, ..)', withGpu(async () => {
    const { device, log } = mockGpu([[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n], [13_100_000n, 13_200_000n], [20_000_000n, 28_000_000n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    const got = []; const res = await begin(r, (...a) => got.push(a)); expect(res.failed).toEqual([]);
    const rb = log.buffers.filter(b => b.d.size === 16 && (b.d.usage & 32)).at(-1), cnt = log.buffers.find(b => b.d.size === 16 && (b.d.usage & 64)); expect(rb && cnt).toBeTruthy();
    rb.vals = [7n | (4n << 32n), 9n | (2n << 32n)]; // the 4 u32: 7 pixels differ, the largest colour channel difference 4, the largest packed depth byte difference 9, 2 pixels whose colour differs
    const rec = frameOf(r, proxyU()); const n0 = log.writes.length, np = log.passes.length, nc = log.computePasses.length;
    expect(r.breakdown.shadow(rec, BD_SPECS.noProxy)).toBe(true);
    const w = log.writes.slice(n0).filter(isMain); expect(w).toHaveLength(4); expect(w.map(x => x.data[at('proxyOn')])).toEqual([0, 0, 1, 1]); // off x 2 (buffers 4, 5), on x 2 (buffers 7, 8)
    expect(w.map(x => x.data[at('proxyOrg')])).toEqual([0, 2, 0, 2]);
    const [off, on] = log.passes.slice(np); expect(off.d.timestampWrites).toBeTruthy(); expect(on.d.timestampWrites).toBeUndefined(); // only the off pass is timed
    expect(on.viewports).toEqual(off.viewports); expect(on.scissors).toEqual(off.scissors); expect(on.draws).toBe(off.draws); expect(on.pipeline).toBe(off.pipeline);
    expect(on.d.colorAttachments[0].view.t).not.toBe(off.d.colorAttachments[0].view.t);
    expect(bind9(on.groups[0])).toBe(bind9(off.groups[0])); expect(on.groups[0]).not.toBe(off.groups[0]); // the same tiles, other uniform buffers
    const cp = log.computePasses[nc]; expect(cp).toBeTruthy(); expect(cp.dispatches).toEqual([[Math.ceil(642 / 8), Math.ceil(240 / 8)]]); // the part the passes drew, not the scratch targets' size
    const ent = cp.groups[0].d.entries; expect(ent.map(e => e.binding)).toEqual([0, 1, 2, 3, 4]);
    expect(ent[0].resource.t).toBe(off.d.colorAttachments[0].view.t); expect(ent[1].resource.t).toBe(off.d.colorAttachments[1].view.t); expect(ent[2].resource.t).toBe(on.d.colorAttachments[0].view.t); expect(ent[3].resource.t).toBe(on.d.colorAttachments[1].view.t); expect(ent[4].resource.buffer).toBe(cnt);
    expect(log.cmds.slice(-4)).toEqual(['clear', 'cpass', 'copyB16', 'submit']);
    await settle();
    expect(got.filter(x => x[0] === 'proxyDiff')).toEqual([['proxyDiff', 7, 2 * 320 * 240]]);
    expect(got.filter(x => x[0] === 'diffMax:noProxy')).toEqual([['diffMax:noProxy', 4, 9]]); expect(got.filter(x => x[0] === 'diffColor:noProxy')).toEqual([['diffColor:noProxy', 2, 1]]);
    expect(got.find(x => x[0] === 'proxyMs')).toEqual(['proxyMs', 2, 1]); // the compute pass of the frame drawn while recording: 2 ms
    expect(got.find(x => x[0] === 'noProxy')[1]).toBeCloseTo(8); expect(got.find(x => x[0] === 'noProxy')[2]).toBeCloseTo(10);
    // one comparison at a time: while its read-back is out the next noProxy turn is timed without it
    r.breakdown.end(); expect(rb.destroyed).toBe(true); expect(cnt.destroyed).toBe(true);
    r.dispose();
  }));
  it('the other shadow variants make no comparison and the display passes make none: no compute pass but the frame\'s own', withGpu(async () => {
    const { device, log } = mockGpu([[1n, 2n], [3n, 4n], [5n, 6n], [7n, 8n]]);
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    await begin(r, () => {}); const rec = frameOf(r, proxyU()); const nc = log.computePasses.length;
    expect(r.breakdown.shadow(rec, BD_SPECS.same)).toBe(true); expect(log.computePasses.length).toBe(nc);
    r.dispose();
  }));
});

describe('host: the pixel comparison of any variant (diff in the table), a variant that draws itself (registerShadowEncoder)', () => {
  const withVariant = async (spec, fn) => { defineBdVariant(spec); try { await fn(); } finally { delete BD_SPECS[spec.name]; BD_VARIANTS.splice(BD_VARIANTS.indexOf(spec.name), 1); } };
  const script = () => [[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n], [13_100_000n, 13_200_000n], [20_000_000n, 28_000_000n], [30_000_000n, 31_000_000n]];
  it('a program-text variant with diff: the variant pass is timed with its own program, the display\'s own pass (the DISPLAY program, the snapshot\'s uniforms and tiles) goes to the second target, the compute counts and the numbers come as diff:<name>, diffMax:<name>, diffColor:<name>', withGpu(async () => {
    await withVariant({ name: 'gen', abl: 'grad', diff: true }, async () => {
      const { device, log } = mockGpu(script());
      const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
      const got = []; await begin(r, (...a) => got.push(a));
      const rb = log.buffers.filter(b => b.d.size === 16 && (b.d.usage & 32)).at(-1); rb.vals = [3n | (9n << 32n), 6n | (1n << 32n)]; // 3 px differ, max colour diff 9, max depth byte diff 6, 1 px colour differs
      const rec = frameOf(r, proxyU()); const np = log.passes.length, nc = log.computePasses.length;
      expect(r.breakdown.shadow(rec, BD_SPECS.gen)).toBe(true);
      const [vari, ref] = log.passes.slice(np); expect(vari.d.timestampWrites).toBeTruthy(); expect(ref.d.timestampWrites).toBeUndefined();
      expect(ref.pipeline).toBe(r.volume.pipeFor({ cls4: false, events: false })); expect(vari.pipeline).not.toBe(ref.pipeline); // the reference is the display program, not the variant's
      expect(ref.viewports).toEqual(vari.viewports); expect(ref.scissors).toEqual(vari.scissors); expect(log.computePasses.length).toBe(nc + 1);
      await settle();
      expect(got.filter(x => x[0] === 'diff:gen')).toEqual([['diff:gen', 3, 2 * 320 * 240]]); expect(got.filter(x => x[0] === 'diffMax:gen')).toEqual([['diffMax:gen', 9, 6]]); expect(got.filter(x => x[0] === 'diffColor:gen')).toEqual([['diffColor:gen', 1, 1]]);
      expect(got.some(x => x[0] === 'proxyDiff')).toBe(false); // noProxy's name is its own
      r.dispose();
    });
  }));
  it('a variant with diff in a frame whose low pass did not use the pre-pass still compares (the reference has bind groups of its own); a variant without diff makes no comparison; the table\'s noProxy has no program there (as before)', withGpu(async () => {
    await withVariant({ name: 'ovr', overrides: { diag: 1 }, diff: true }, async () => {
      const { device, log } = mockGpu(script());
      const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
      const got = []; await begin(r, (...a) => got.push(a));
      const rec = frameOf(r, {}); const np = log.passes.length, nc = log.computePasses.length; // u = {}: no pre-pass in the low pass
      expect(r.breakdown.shadow(rec, BD_SPECS.ovr)).toBe(true); expect(log.passes.length).toBe(np + 2); expect(log.computePasses.length).toBe(nc + 1);
      await settle(); expect(got.filter(x => x[0] === 'diff:ovr')).toHaveLength(1);
      const rec2 = frameOf(r, {}); const nc2 = log.computePasses.length; expect(r.breakdown.shadow(rec2, BD_SPECS.same)).toBe(true); expect(log.computePasses.length).toBe(nc2);
      const rec3 = frameOf(r, {}); expect(r.breakdown.shadow(rec3, BD_SPECS.noProxy)).toBeNull();
      r.dispose();
    });
  }));
  it('a registered encoder draws the variant: it is given the encoder, the scratch target and the timestamps and nothing else is drawn for it; its result is compared with the display\'s pass; null = no program, nothing submitted', withGpu(async () => {
    await withVariant({ name: 'enc', diff: true }, async () => {
      const { device, log } = mockGpu(script());
      const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
      const got = []; await begin(r, (...a) => got.push(a));
      const seen = [];
      registerShadowEncoder('enc', ctx => { seen.push(ctx); ctx.enc.beginRenderPass({ timestampWrites: ctx.tsw, colorAttachments: [{ view: ctx.target.colorView }, { view: ctx.target.depthView }] }).end(); });
      try {
        const rec = frameOf(r, proxyU()); const np = log.passes.length, nsub = log.cmds.filter(c => c === 'submit').length;
        expect(r.breakdown.shadow(rec, BD_SPECS.enc)).toBe(true);
        expect(seen).toHaveLength(1); const c = seen[0]; expect(c.target.w).toBeGreaterThan(0); expect(c.target.colorView).toBeTruthy(); expect(c.eyes).toHaveLength(2); expect(c.tsw.beginningOfPassWriteIndex + 1).toBe(c.tsw.endOfPassWriteIndex); expect(c.tswBegin.endOfPassWriteIndex).toBeUndefined(); expect(c.tswEnd.beginningOfPassWriteIndex).toBeUndefined();
        const [mine, ref] = log.passes.slice(np); expect(log.passes.length).toBe(np + 2); expect(mine.d.timestampWrites).toBe(c.tsw); expect(ref.pipeline).toBe(r.volume.pipeFor({ cls4: false, events: false })); // its own pass, then the display's reference
        expect(log.cmds.filter(x => x === 'submit').length).toBe(nsub + 1);
        await settle(); expect(got.filter(x => x[0] === 'diff:enc')).toHaveLength(1);
        registerShadowEncoder('enc', () => null); const rec2 = frameOf(r, proxyU()); const np2 = log.passes.length, ns2 = log.cmds.filter(x => x === 'submit').length;
        expect(r.breakdown.shadow(rec2, BD_SPECS.enc)).toBeNull(); expect(log.cmds.filter(x => x === 'submit').length).toBe(ns2); expect(log.passes.length).toBe(np2);
        registerShadowEncoder('enc', () => { throw new Error('boom'); }); expect(r.breakdown.shadow(rec2, BD_SPECS.enc)).toBeNull(); expect(log.cmds.filter(x => x === 'submit').length).toBe(ns2);
      } finally { registerShadowEncoder('enc', null); }
      r.dispose();
    });
  }));
});

describe('host: the counting probe with the display\'s pre-pass tiles', () => {
  const script = () => [[1_000_000n, 3_000_000n], [3_000_000n, 13_000_000n], [13_100_000n, 13_200_000n]];
  const cfgOf = w => Array.from(new Float32Array(w.data.buffer));
  const cfgWrites = (log, n0) => log.writes.slice(n0).filter(w => w.data.length === 8);
  it('both runs from the frame of the window: the run without the pre-pass (proxyOn 0, the tiles bound, the result) and the one with the display\'s tiles (proxyOn 1, the same tiles, delivered as probeOn:<kind>); each with its own buffer, the cfg says which tile each pixel reads', withGpu(async () => {
    const { device, log } = mockGpu(script());
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    const got = []; await begin(r, (...a) => got.push(a));
    const u = proxyU(), rec = frameOf(r, u); const tiles = log.textures.find(t => t.d.format === 'r32float' && t.d.size[0] === TILES.texCols);
    const np = log.passes.length, n0 = log.writes.length, nCmd = log.cmds.length;
    const res = await r.breakdown.probe(u, 'whole', rec);
    expect(res.kind).toBe('whole'); expect(res.counters).toBeInstanceOf(Uint32Array); expect(res.counters.length).toBe(64 * 64 * COUNTER_FIELDS.length);
    const [off, on] = log.passes.slice(np); expect(log.passes.length).toBe(np + 2);
    const w = log.writes.slice(n0).filter(isMain); expect(w.map(x => x.data[at('proxyOn')])).toEqual([0, 1]);
    expect(bind9(off.groups[0])).toBe(tiles); expect(bind9(on.groups[0])).toBe(tiles); // the display's tiles of this frame in both runs
    expect(off.groups[1]).not.toBe(on.groups[1]); expect(off.d.timestampWrites).toBeUndefined(); expect(on.d.timestampWrites).toBeUndefined();
    const cw = cfgWrites(log, n0); expect(cw).toHaveLength(1); expect(cfgOf(cw[0])).toEqual([5, 3.75, 0, 0, 320, 240, 1, 0]); // whole: the eye's 320 x 240 image in 64 x 64: a window pixel stands for 5 x 3.75 region pixels
    const cmds = log.cmds.slice(nCmd); expect(cmds.filter(c => c === 'clear')).toHaveLength(2); expect(cmds.filter(c => c === 'copyB' + 64 * 64 * COUNTER_FIELDS.length * 4)).toHaveLength(2);
    expect(got.filter(x => x[0] === 'probeOn:whole')).toHaveLength(1); expect(got.find(x => x[0] === 'probeOn:whole')[1]).toBeInstanceOf(Uint32Array); expect(got.find(x => x[0] === 'probeOn:whole')[2]).toBe(64);
    const n1 = log.writes.length; await r.breakdown.probe(u, 'native', rec);
    expect(cfgOf(cfgWrites(log, n1)[0])).toEqual([1, 1, 128, 88, 320, 240, 1, 0]); // native: the window (128, 88) of the 320 x 240 region at the region's own pixels
    r.dispose();
  }));
  it('a frame whose low pass used no pre-pass, or a probe of another frame: one run as before, no tiles bound (cfg mode 0), nothing delivered as probeOn; the mode switch picks one run', withGpu(async () => {
    const { device, log } = mockGpu(script());
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    const got = []; await begin(r, (...a) => got.push(a));
    let rec = frameOf(r, {}), np = log.passes.length, n0 = log.writes.length;
    const res = await r.breakdown.probe({}, 'whole', rec); expect(res.counters.length).toBe(64 * 64 * COUNTER_FIELDS.length); expect(log.passes.length).toBe(np + 1);
    expect(cfgOf(cfgWrites(log, n0)[0])[6]).toBe(0); expect(got.some(x => x[0] === 'probeOn:whole')).toBe(false);
    const u = proxyU(); const rec2 = frameOf(r, u); const other = frameOf(r, u); // the snapshot is of `other`: a probe with rec2 does not borrow its tiles
    np = log.passes.length; await r.breakdown.probe(u, 'whole', rec2); expect(log.passes.length).toBe(np + 1);
    r.breakdown.setProbeMode('off'); const rec4 = frameOf(r, u); np = log.passes.length; n0 = log.writes.length; await r.breakdown.probe(u, 'whole', rec4);
    expect(log.passes.length).toBe(np + 1); expect(log.writes.slice(n0).filter(isMain).map(x => x.data[at('proxyOn')])).toEqual([0]);
    r.breakdown.setProbeMode('on'); const rec5 = frameOf(r, u); np = log.passes.length; n0 = log.writes.length; const on = await r.breakdown.probe(u, 'whole', rec5);
    expect(log.passes.length).toBe(np + 1); expect(log.writes.slice(n0).filter(isMain).map(x => x.data[at('proxyOn')])).toEqual([1]); expect(on.counters.length).toBe(64 * 64 * COUNTER_FIELDS.length); expect(other).toBeTruthy();
    r.dispose();
  }));
  it('end() lets the second run\'s buffers and the cfg go with the others', withGpu(async () => {
    const { device, log } = mockGpu(script());
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    const nb = log.buffers.length; await begin(r, () => {}); const big = log.buffers.slice(nb).filter(b => b.d.size === 64 * 64 * COUNTER_FIELDS.length * 4), cfg = log.buffers.slice(nb).filter(b => b.d.size === 32 && (b.d.usage & 4));
    expect(big).toHaveLength(4); expect(cfg).toHaveLength(1); r.breakdown.end(); expect(big.every(b => b.destroyed)).toBe(true); expect(cfg[0].destroyed).toBe(true);
    r.dispose();
  }));
});

describe('host: the timestamp slots hold the frames of a slow read-back (30 slots: 5 per frame when the periphery has tiles of its own, 4 when it has none: pre-pass, low pass, periphery pass, marker)', () => {
  it('with every read-back still pending, the first 7 frames of 4 timed passes each get their slots (no frame is bad); the 8th finds too few and is no sample', withGpu(async () => {
    const { device, log } = mockGpu([]);
    const mk = device.createBuffer; device.createBuffer = d => { const b = mk(d); b.mapAsync = () => new Promise(() => {}); return b; }; // a read-back that has not come back yet
    const r = createVrVolumeRenderer({ THREE: THREEG, device, halfExt: [1, 1, 1] }); await r.preload(proxyU(), [{ cls4: false, events: false }]); log.computePasses.length = 0; log.passes.length = 0; log.cmds.length = 0; /* the session start: the display's ways are compiled and the data's grids made before the first frame (what the test counts is what a frame does) */
    const recs = [];
    for (let i = 0; i < 8; i++) { const n0 = log.passes.length; draw(r, proxyU(), { fov: true, fp: 0.25, rects: [[160, 120, 480, 360]], band: 8 }); recs.push(r.volume.markFrame()); if (i === 0) expect(log.passes.slice(n0).length).toBe(3); }
    expect(log.computePasses).toHaveLength(8);
    expect(recs.slice(0, 7).map(x => x.bad)).toEqual([false, false, false, false, false, false, false]);
    expect(recs.slice(0, 7).map(x => x.pend)).toEqual([4, 4, 4, 4, 4, 4, 4]); // pre-pass, low pass, periphery pass, marker: all four timed in each frame
    expect(recs[7].bad).toBe(true);
    r.dispose();
  }));
});
