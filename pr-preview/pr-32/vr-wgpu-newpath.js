// The "new ways" of the WebGPU low pass (the centre pass) in the display and in the same-picture check (docs/vr-wgpu-ident.js): distSplit, proxyCoarse and both together. They are the performance record's variants of the shadow pass
// (docs/vr-wgpu-coarse-march.js: the distance byte in a texture of its own; docs/vr-wgpu-coarse-proxy.js: the coarse grid and the 4 x 4 pre-pass over it), drawn as the pass itself. Nothing in here exists until a switch (or the check) asks.
//   dist   : the display program with the distance read from a 16 MB r8 texture (distSplit), the 8 x 8 pre-pass of the display as it is.
//   coarse : the display program with the 4 x 4 tiles and the far end tB (coarseVolumeWgsl), the pre-pass over the coarse grid (256 KB).
//   both   : the two substitutions in one program (marchWgsl of the coarse program; group 1 = the march layout). Not measured before, and not the product of the two ratios.
// A frame uses a new way only when everything it needs is there and agrees with this frame (plan() below, the rules of 1-5 of the plan); any other frame is drawn the way it always was (the caller keeps its own path: plan() says use: false and why).
import { volumeWgsl } from './vr-wgsl-core.js?v=20261124-build761';
import { marchWgsl, createMarchHost } from './vr-wgpu-coarse-march.js?v=20261124-build761';
import { coarseVolumeWgsl, createCoarseDisplay, coarseGridKey, walkLimitOk } from './vr-wgpu-coarse-proxy.js?v=20261124-build761';

export const NEW_PATH_MODES = ['dist', 'coarse', 'both'];
// the display program text of a mode (f16 = half precision march as the display's; cls4 = the fourth segment's own texture)
export function newPathText({ f16 = false, cls4 = false, mode }) {
  if (mode === 'dist') return marchWgsl(volumeWgsl({ f16, cls4, events: false }), 'distSplit');
  if (mode === 'coarse') return coarseVolumeWgsl({ f16, cls4 }, 4);
  if (mode === 'both') return marchWgsl(coarseVolumeWgsl({ f16, cls4 }, 4), 'distSplit');
  throw new Error('new path: unknown mode ' + mode);
}
export const modeNeeds = mode => ({ dist: mode === 'dist' || mode === 'both', coarse: mode === 'coarse' || mode === 'both' });
// the mode of the two switches (null: none)
export const modeOfSwitches = (dist, coarse) => (dist && coarse ? 'both' : dist ? 'dist' : coarse ? 'coarse' : null);
// the part of the frame's rule that needs no GPU state: '' = may be used, else the reason it is not. c4 (the fourth segment's own texture) is not checked until a check passes it (allowC4); the coarse ways need a walk that cannot reach the loop's limit (walkLimitOk)
export function newPathGate({ mode, cls4 = false, allowC4 = false, halfExt = [1, 1, 1], stepSize = 0.01, failed = '' }) {
  if (failed) return 'failed';
  if (cls4 && !allowC4) return 'c4';
  if (modeNeeds(mode).coarse && !walkLimitOk(halfExt, stepSize)) return 'limit';
  return '';
}

// ctx = { device, f16, bgl (the volume pass's group 0 layout), renderDesc(module, pipelineLayout | null) (the display's render pipeline descriptor), onShader, dropGroups, dummy(kind), entryOf(three texture) (the host's entry: its write number),
//   tag ('display' | 'check'), allowC4, onFail(text) }
// The programs are made asynchronously (warm / the first frame that asks): until one is ready a frame is drawn the old way ('prep').
export function createNewPath(ctx) {
  const { device } = ctx;
  let host = null, cd = null;
  const pipes = new Map(); // 'mode:c3' -> { state, pipe, msg }
  const inst = { tag: ctx.tag, failed: '', failLog: [], counts: { used: 0, notUsed: 0, reasons: {}, byMode: {} }, rebuilds: 0, readyAt: -1 };
  const fail = text => { if (inst.failed) return; inst.failed = text; inst.failLog.push(text); try { ctx.onFail?.(text); } catch { /* the host's line */ } };
  const hostOf = () => host ||= createMarchHost({ device, bgl0: ctx.bgl, cells: [] });
  const cdOf = () => cd ||= createCoarseDisplay({ device, onShader: ctx.onShader, dropGroups: ctx.dropGroups, name: ctx.tag });
  const pipeOf = (mode, cls4) => {
    const key = mode + (cls4 ? ':c4' : ':c3'), have = pipes.get(key);
    if (have) return have;
    const p = { state: 'pending', pipe: null, msg: '' };
    pipes.set(key, p);
    try {
      const module = device.createShaderModule({ code: newPathText({ f16: !!ctx.f16, cls4, mode }) });
      try { ctx.onShader?.(module, { f16: !!ctx.f16, cls4, events: false, coarse: ctx.tag + ' ' + mode }); } catch { /* diagnostics only */ }
      const lay = modeNeeds(mode).dist ? hostOf().layouts().pipeLayout : null;
      Promise.resolve(device.createRenderPipelineAsync(ctx.renderDesc(module, lay))).then(pipe => { p.pipe = pipe; p.state = 'ready'; }, e => { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); fail(mode + ' program: ' + p.msg); });
    } catch (e) { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); fail(mode + ' program: ' + p.msg); }
    return p;
  };
  // the programs of a mode for a display variant, started now (the compute programs of the coarse ways too)
  const ensure = (mode, cls4) => { pipeOf(mode, cls4); if (modeNeeds(mode).coarse) cdOf().progs(cls4); };
  const note = (res, mode) => {
    const c = inst.counts;
    if (res.use) { c.used++; c.byMode[mode] = (c.byMode[mode] | 0) + 1; } else { c.notUsed++; c.reasons[res.reason] = (c.reasons[res.reason] | 0) + 1; }
    return res;
  };
  // one frame's decision (and the work it needs encoded in `enc`, in front of the volume pass): F = { mode, skip ('' or the reason the caller already knows), cls4, halfExt, stepSize, cls: { tex, gen, dims, data, gpu } | null, c4: { gen, gpu } | null, segOn, clsChan,
  //   (cls.untrusted: the CPU bytes are not the GPU's now: distSplit's reason is 'nodata'),
  //   proxyBytes() -> the PROXY_FIELDS bytes of this pass for 4 x 4 tiles (null: a matrix that cannot be inverted), tiles: { tilesPerEye, tilesY, texCols, texRows, nEyes }, tswTiles, tswBuild, frame (a frame number) }
  // -> { use: true, mode, pipeline, group1 (null or the march's), pxTex (null: the display's own 8 x 8 tiles are used) } or { use: false, reason, mode }
  const plan = (enc, F) => {
    const mode = F.mode, need = modeNeeds(mode), no = reason => note({ use: false, reason, mode }, mode);
    if (F.skip) return no(F.skip);
    const gate = newPathGate({ mode, cls4: F.cls4, allowC4: !!ctx.allowC4, halfExt: F.halfExt, stepSize: F.stepSize, failed: inst.failed });
    if (gate) return no(gate);
    const pipe = pipeOf(mode, F.cls4);
    if (pipe.state === 'failed') return no('failed');
    const ci = F.cls;
    if (!ci || ci.format !== 'rgba8unorm') return no('nodata');
    let dState = 'ready', g1 = null, cState = 'ready';
    if (need.dist) {
      // the distance texture is made from the texture's CPU bytes: while they are not what is on the GPU (a bake, a rebuild of the combined texture still going up) distSplit is not used and nothing is built from them
      const s = ci.untrusted ? null : hostOf().prepare(ci.tex, ci.gen, ci.data, ci.dims);
      dState = s === null ? 'nodata' : s === 'wait' ? 'prep' : 'ready';
      if (dState === 'ready') g1 = host.group('distSplit');
    }
    if (need.coarse) {
      const key = coarseGridKey({ clsGen: ci.gen, cls4Gen: F.cls4 ? F.c4?.gen : 0, segOn: F.segOn, clsChan: F.clsChan, dims: ci.dims });
      const s = cdOf().build(enc, { key, clsTex: ci.gpu, c4Tex: F.cls4 ? F.c4?.gpu : ctx.dummy('f'), dims: ci.dims, segOn: F.segOn, clsChan: F.clsChan, cls4: !!F.cls4, tsw: F.tswBuild || null });
      if (s === 'failed') { fail('coarse programs: ' + cd.progs(!!F.cls4).msg); cState = 'failed'; } else cState = s === 'ready' ? 'ready' : s === 'building' ? 'rebuild' : 'prep';
      if (s === 'ready' && inst.readyAt !== F.frame && cd.state.builds !== inst.rebuilds) { inst.rebuilds = cd.state.builds; inst.readyAt = F.frame; }
    }
    if (pipe.state !== 'ready') return no('prep');
    if (dState !== 'ready') return no(dState);
    if (cState !== 'ready') return no(cState);
    let pxTex = null;
    if (need.coarse) {
      const bytes = F.proxyBytes();
      if (!bytes) return no('matrix');
      pxTex = cd.tiles(enc, { bytes, nEyes: F.tiles.nEyes, tilesPerEye: F.tiles.tilesPerEye, tilesY: F.tiles.tilesY, texCols: F.tiles.texCols, texRows: F.tiles.texRows, dims: ci.dims, cls4: !!F.cls4, tsw: F.tswTiles || null });
      if (!pxTex) return no('prep');
    }
    return note({ use: true, mode, pipeline: pipe.pipe, group1: g1, pxTex }, mode);
  };
  // bytes of the combined texture [z0, z1) were just written to the GPU (docs/vr-wgpu.js writeRange): the distance texture of the host follows (only a host that holds that texture, complete)
  const onWrite = (e, bytes, z0, z1) => {
    const s = host?.state;
    if (!s || ctx.entryOf(s.tex) !== e) return;
    host.writeRange(s.tex, e.gen, bytes, z0, z1);
  };
  const destroy = () => {
    try { host?.destroy(); } catch { /* gone */ }
    try { cd?.destroy(); } catch { /* gone */ }
    host = null; cd = null; pipes.clear();
  };
  return { plan, ensure, onWrite, destroy, count: (reason, mode) => note({ use: false, reason, mode }, mode), stats: () => ({ tag: inst.tag, used: inst.counts.used, notUsed: inst.counts.notUsed, reasons: { ...inst.counts.reasons }, byMode: { ...inst.counts.byMode }, failed: inst.failed, failLog: inst.failLog.slice() }),
    fail, get failed() { return inst.failed; }, get readyAt() { return inst.readyAt; }, get host() { return host; }, get cd() { return cd; }, get pipes() { return pipes; } };
}
