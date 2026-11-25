// The "new ways" of the WebGPU low pass (the centre pass) in the display and in the same-picture check (docs/vr-wgpu-ident.js): distSplit, proxyCoarse and both together. They are the performance record's variants of the shadow pass
// (docs/vr-wgpu-coarse-march.js: the distance byte in a texture of its own; docs/vr-wgpu-coarse-proxy.js: the coarse grid and the 4 x 4 pre-pass over it), drawn as the pass itself. Nothing in here exists until a switch (or the check) asks.
//   dist   : the display program with the distance read from a 16 MB r8 texture (distSplit), the 8 x 8 pre-pass of the display as it is.
//   coarse : the display program with the 4 x 4 tiles and the far end tB (coarseVolumeWgsl), the pre-pass over the coarse grid (256 KB).
//   both   : the two substitutions in one program (marchWgsl of the coarse program; group 1 = the march layout). Not measured before, and not the product of the two ratios.
// A frame uses a new way only when everything it needs is there and agrees with this frame (plan() below, the rules of 1-5 of the plan); any other frame is drawn the way it always was (the caller keeps its own path: plan() says use: false and why).
import { volumeWgsl } from './vr-wgsl-core.js?v=20261125-build762';
import { marchWgsl, createMarchHost } from './vr-wgpu-coarse-march.js?v=20261125-build762';
import { coarseVolumeWgsl, createCoarseDisplay, walkLimitOk } from './vr-wgpu-coarse-proxy.js?v=20261125-build762';
import { skipText, createMarkHost } from './vr-wgpu-marks.js?v=20261125-build762'; // S / OS / EvS: the skip marks and their programs

export const NEW_PATH_MODES = ['dist', 'coarse', 'both'];
// the display program text of a mode (f16 = half precision march as the display's; cls4 = the fourth segment's own texture)
export function newPathText({ f16 = false, cls4 = false, mode }) {
  if (mode === 'dist') return marchWgsl(volumeWgsl({ f16, cls4, events: false }), 'distSplit');
  if (mode === 'coarse') return coarseVolumeWgsl({ f16, cls4 }, 4);
  if (mode === 'both') return marchWgsl(coarseVolumeWgsl({ f16, cls4 }, 4), 'distSplit');
  if (mode === 'distEv') return marchWgsl(volumeWgsl({ f16, cls4, events: true }), 'distSplit'); // EvD: the section-plane program (slices, cut face) with the distance bytes from their own texture
  if (mode === 'skip') return skipText({ f16, cls4, events: false }); // S
  if (mode === 'skipEv') return skipText({ f16, cls4, events: true }); // EvS
  if (mode === 'tileSkip') return skipText({ f16, cls4, tiles: true }); // OS
  throw new Error('new path: unknown mode ' + mode);
}
export const modeNeeds = mode => ({ dist: mode === 'dist' || mode === 'both' || mode === 'distEv', coarse: mode === 'coarse' || mode === 'both' || mode === 'tileSkip', marks: mode === 'skip' || mode === 'skipEv' || mode === 'tileSkip' });
// the part of the frame's rule that needs no GPU state: '' = may be used, else the reason it is not (the check's explicit ways only; the display's frame never asks: its ways are chosen by chooseWay). The coarse ways need a walk that cannot reach the loop's limit (walkLimitOk)
export function newPathGate({ mode, halfExt = [1, 1, 1], stepSize = 0.01, failed = '' }) {
  if (failed) return 'failed';
  if (modeNeeds(mode).coarse && mode !== 'tileSkip' && !walkLimitOk(halfExt, stepSize)) return 'limit'; // (tileSkip keeps the loop's own limit in its program: k < 4096)
  return '';
}

// ---- the display's own choice of a way for one pass of one frame (the table of the plan's chapter 6: there is no branch that returns the old way) ----
// ways: B = distSplit + the 4 x 4 tiles over the coarse grid (the display's own tiles of the periphery pass are a texture of their own); D = distSplit + the 8 x 8 pre-pass of the display; D0 = distSplit without any pre-pass (proxyOn 0);
//   EvD = distSplit on the section-plane program (the slices and the cut face are visited at the same grid points as in the display's program); S / OS / EvS = the ways for a frame without jumps (the skip marks, docs/vr-wgpu-marks.js).
// F = { pass: 'low' | 'peri' | 'probe', jumpOn (bool: the distance bytes are valid and jumps are on), section (bool: a section plane is on or the program is the section one), diag (0..5, the diagnostic of the pass; the probe is 5),
//   distField (bool: the distance bytes are valid, whatever the diagnostic says), walkOk (walkLimitOk: no ray can reach the loop's 4096 iterations), matrixOk (both eyes' matrices can be inverted: the tiles can be made), gridReady (the coarse grid holds the shown set's marks;
//   false while its rows are being made) }
export const WAYS = ['B', 'D', 'D0', 'EvD', 'S', 'OS', 'EvS'];
export function chooseWay(F) {
  const peri = F.pass === 'peri', probe = F.pass === 'probe' || (F.diag | 0) === 5, diag = F.diag | 0;
  if (F.section) return F.jumpOn ? 'EvD' : 'EvS';
  if (!F.jumpOn) {
    // no jumps: S where the walk's ends cannot move (diag 2 counts the loop, the probe returns the count) or there are no distance bytes to start from (OS uses the tiles of the distance field: diag 4 with a field)
    if (diag === 2 || probe || !F.matrixOk || !F.gridReady || !(diag === 4 && F.distField)) return 'S';
    return 'OS';
  }
  if (probe || diag === 1) return 'D0'; // the probe has no tiles of its own; diag 1 returns before the loop (iters are 0 everywhere), nothing to walk
  if (!F.matrixOk) return 'D0';
  if (peri) return diag === 2 || !F.walkOk || !F.gridReady ? 'D0' : 'B';
  return diag === 2 || !F.walkOk || !F.gridReady ? 'D' : 'B';
}
// the way's mode of the instance (the program that draws it) and whether it uses tiles
export const DISPLAY_MODES = ['both', 'dist', 'distEv', 'skip', 'skipEv', 'tileSkip'];
// the programs a way may fall back through when the first is not ready (its grid is being made, its program is being compiled): [mode, the way that is drawn]
export const WAY_LADDER = { B: [['both', 'B'], ['dist', 'D']], D: [['dist', 'D']], D0: [['dist', 'D0']], EvD: [['distEv', 'EvD']], S: [['skip', 'S']], EvS: [['skipEv', 'EvS']], OS: [['tileSkip', 'OS'], ['skip', 'S']] };
export const wayMode = way => ({ B: 'both', D: 'dist', D0: 'dist', EvD: 'distEv', S: 'skip', EvS: 'skipEv', OS: 'tileSkip' }[way] || null);

// ctx = { device, f16, bgl (the volume pass's group 0 layout), renderDesc(module, pipelineLayout | null) (the display's render pipeline descriptor), onShader, dropGroups, dummy(kind), entryOf(three texture) (the host's entry: its write number),
//   tag ('display' | 'check'), onFail(text) }
// The programs are made asynchronously (warm / the first frame that asks): until one is ready a frame is drawn the old way ('prep').
export function createNewPath(ctx) {
  const { device } = ctx;
  let host = null, cd = null, mk = null;
  const pipes = new Map(); // 'mode:c3' -> { state, pipe, msg }
  const inst = { tag: ctx.tag, failed: '', failLog: [], counts: { used: 0, notUsed: 0, reasons: {}, byMode: {}, byWay: {} }, rebuilds: 0, readyAt: -1 };
  const fail = text => { if (inst.failed) return; inst.failed = text; inst.failLog.push(text); try { ctx.onFail?.(text); } catch { /* the host's line */ } };
  const hostOf = () => host ||= createMarchHost({ device, bgl0: ctx.bgl, cells: [] });
  const mkOf = () => mk ||= createMarkHost({ device, bgl0: ctx.bgl, onShader: ctx.onShader, dropGroups: ctx.dropGroups, dummy: ctx.dummy, entryOf: ctx.entryOf, tag: ctx.tag });
  const cdOf = () => cd ||= createCoarseDisplay({ device, onShader: ctx.onShader, dropGroups: ctx.dropGroups, name: ctx.tag });
  const pipeOf = (mode, cls4) => {
    const key = mode + (cls4 ? ':c4' : ':c3'), have = pipes.get(key);
    if (have) return have;
    const p = { state: 'pending', pipe: null, msg: '' };
    pipes.set(key, p);
    try {
      const module = device.createShaderModule({ code: newPathText({ f16: !!ctx.f16, cls4, mode }) });
      try { ctx.onShader?.(module, { f16: !!ctx.f16, cls4, events: false, coarse: ctx.tag + ' ' + mode }); } catch { /* diagnostics only */ }
      const lay = modeNeeds(mode).marks ? mkOf().layouts().pipeLayout : modeNeeds(mode).dist ? hostOf().layouts().pipeLayout : null;
      Promise.resolve(device.createRenderPipelineAsync(ctx.renderDesc(module, lay))).then(pipe => { p.pipe = pipe; p.state = 'ready'; }, e => { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); fail(mode + ' program: ' + p.msg); });
    } catch (e) { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); fail(mode + ' program: ' + p.msg); }
    return p;
  };
  // the programs of a mode for a display variant, started now (the compute programs of the coarse ways too)
  const ensure = (mode, cls4) => { pipeOf(mode, cls4); if (modeNeeds(mode).coarse) cdOf().progs(cls4); if (modeNeeds(mode).dist) hostOf().gpuProg(); if (modeNeeds(mode).marks || modeNeeds(mode).coarse) mkOf().prog(cls4); };
  // the display: every program a way of this variant can ask for is made at once (B and its fallback D / D0 share the distSplit program of 'dist'; the section program joins when EvD is made)
  const ensureAll = cls4 => { for (const m of DISPLAY_MODES) ensure(m, cls4); };
  const note = (res, mode) => {
    const c = inst.counts;
    if (res.use) { c.used++; c.byMode[mode] = (c.byMode[mode] | 0) + 1; } else { c.notUsed++; c.reasons[res.reason] = (c.reasons[res.reason] | 0) + 1; }
    return res;
  };
  // one frame's decision (and the work it needs encoded in `enc`, in front of the volume pass): F = { mode, skip ('' or the reason the caller already knows), cls4, halfExt, stepSize, cls: { tex, gen, dims, data, gpu } | null, c4: { gen, gpu } | null, segOn, clsChan,
  //   (cls.untrusted: the CPU bytes are not the GPU's now: distSplit's reason is 'nodata'),
  //   proxyBytes() -> the PROXY_FIELDS bytes of this pass for 4 x 4 tiles (null: a matrix that cannot be inverted), tiles: { tilesPerEye, tilesY, texCols, texRows, nEyes }, tswTiles, tswBuild, frame (a frame number) }
  // -> { use: true, mode, pipeline, group1 (null or the march's), pxTex (null: the display's own 8 x 8 tiles are used) } or { use: false, reason, mode }
  const tryMode = (enc, F) => {
    const mode = F.mode, need = modeNeeds(mode), no = reason => ({ use: false, reason, mode });
    if (F.skip) return no(F.skip); // (the check's own: a reason it already knows)
    const gate = F.way ? '' : newPathGate({ mode, halfExt: F.halfExt, stepSize: F.stepSize, failed: inst.failed }); // (the display's frame: a program that failed fails its own ways only, each mode is judged by its own pipeline and programs; the check keeps its all-or-nothing)
    if (gate) return no(gate);
    const pipe = pipeOf(mode, F.cls4);
    if (pipe.state === 'failed') return no('failed');
    const ci = F.cls;
    if (!ci || (ci.format !== 'rgba8unorm' && !(need.marks && !need.coarse))) return no('nodata'); // (S / EvS read class channels only: a class texture of one or two channels is as good as an rgba one; the coarse grid and the distance texture need the alpha's distance)
    let dState = 'ready', g1 = null, cState = 'ready', mState = 'ready';
    if (need.marks || need.coarse) { // the skip marks (S, EvS, OS) and the two grids of the tiles (B, OS): made whole here from the GPU's bytes the first time, followed row by row on every write after
      const mp = mkOf().prog(!!F.cls4);
      if (mp.state === 'failed') { fail('skip marks program: ' + mp.msg); return no('failed'); }
      const s = mkOf().prepare({ enc, clsObj: ci.tex, c4Obj: F.cls4 ? F.c4?.tex : null, clsTex: ci.gpu, c4Tex: F.cls4 ? F.c4?.gpu : ctx.dummy('f'), dims: ci.dims, cls4: !!F.cls4, clsGen: ci.gen, c4Gen: F.cls4 ? F.c4?.gen : 0 });
      mState = s === 'ready' ? 'ready' : s === 'failed' ? 'failed' : 'prep';
      if (mState === 'ready') { g1 = mk.group(); if (inst.readyAt !== F.frame && mk.state.builds !== inst.rebuilds) { inst.rebuilds = mk.state.builds; inst.readyAt = F.frame; } }
    }
    if (need.dist) {
      // the distance texture is made on the GPU from the combined texture's own GPU bytes (docs/vr-wgpu-coarse-march.js prepareGpu): whatever the CPU's copy holds (a rebuild still going up, a bake) is of no matter
      const hp = hostOf().gpuProg();
      if (hp.state === 'failed') { fail('distance program: ' + hp.msg); return no('failed'); }
      const s = hostOf().prepareGpu(ci.tex, ci.gen, ci.gpu, ci.dims);
      dState = s === null ? 'nodata' : s === 'wait' ? 'prep' : 'ready';
      if (dState === 'ready') g1 = host.group('distSplit');
    }
    if (need.coarse) { const cp = cdOf().progs(!!F.cls4); cState = cp.state === 'failed' ? 'failed' : cp.state === 'ready' ? 'ready' : 'prep'; if (cState === 'failed') { fail('coarse programs: ' + cp.msg); return no('failed'); } }
    if (pipe.state !== 'ready') return no('prep');
    if (dState !== 'ready') return no(dState);
    if (mState !== 'ready') return no(mState);
    if (cState !== 'ready') return no(cState);
    let pxTex = null;
    if (need.coarse) {
      const bytes = F.proxyBytes();
      if (!bytes) return no('matrix');
      pxTex = cd.tiles(enc, { slot: F.slot || 'low', grid: { alpha: mk.alphaTex, marks: mk.markTex }, bytes, nEyes: F.tiles.nEyes, tilesPerEye: F.tiles.tilesPerEye, tilesY: F.tiles.tilesY, texCols: F.tiles.texCols, texRows: F.tiles.texRows, dims: ci.dims, cls4: !!F.cls4, tsw: F.tswTiles || null });
      if (!pxTex) return no('prep');
    }
    return { use: true, mode, pipeline: pipe.pipe, group1: g1, pxTex, noTiles: !!F.noTiles };
  };
  const plan = (enc, F) => { const r = tryMode(enc, F); return note(r, F.mode); };
  // the display's frame: F.way is a way of chooseWay; a way whose program or grid is not ready (or failed) falls down its ladder (WAY_LADDER: B to D, OS to S); a frame no ladder can draw is { use: false, reason } and the caller draws nothing and counts it (it never draws the display's own text)
  const planWay = (enc, F) => {
    const way = F.way;
    const peri = F.slot === 'peri';
    let r = null, got = way;
    for (const [mode, label] of WAY_LADDER[way]) { // the way itself, then the ones it falls back to while its program or its grid is not ready (the periphery has no 8 x 8 pre-pass of its own: its D is D0)
      const lab = label === 'D' && peri ? 'D0' : label, tiles = lab === 'B' || lab === 'OS' || lab === 'D';
      r = tryMode(enc, { ...F, mode, noTiles: !tiles });
      if (r.use) { got = lab; break; }
    }
    if (r.use) inst.counts.byWay[got] = (inst.counts.byWay[got] | 0) + 1;
    return note({ ...r, way: r.use ? got : way }, r.use ? r.mode : way);
  };
  // bytes of the combined texture [z0, z1) were just written to the GPU (docs/vr-wgpu.js writeRange): the distance texture of the host follows (only a host that holds that texture, complete)
  const onWrite = (e, bytes, z0, z1) => {
    try { mk?.onWrite(e, z0, z1); } catch { /* the marks are made whole at the next use */ } // the skip marks' rows follow from the GPU's bytes (the same queue, after the write itself)
    const s = host?.state;
    if (!s || ctx.entryOf(s.tex) !== e) return;
    host.writeRangeGpu(s.tex, e.gen, e.gpu, z0, z1); // the distance texture follows from the GPU's bytes (the same queue, after the write itself)
  };
  // the bind group layout of a mode's group 1 (the distance texture's, or the skip marks'): what the direct draw's pipeline layouts are made from
  // is a program of this instance still being compiled (the render programs, the distance texture's, the marks', the grid's and the tiles')?
  const pending = () => [...pipes.values()].some(p => p.state === 'pending') || host?.gpuProg?.().state === 'pending' || [...(mk?.state.progs.values() || [])].some(p => p.state === 'pending') || [...(cd?.state.progs.values() || [])].some(p => p.state === 'pending');
  // resolves when nothing is being compiled any more (a failure counts: the frame says so itself), or after timeoutMs (a compile that hangs must not hold the session's start for ever: the frames then use what is ready)
  const whenReady = async (timeoutMs = 30000) => { const t0 = Date.now(); await new Promise(r => setTimeout(r, 0)); while (pending() && Date.now() - t0 < timeoutMs) await new Promise(r => setTimeout(r, 10)); return !pending(); };
  const layoutOf = mode => (modeNeeds(mode).marks ? mkOf().layouts().bgl : hostOf().layouts().bgl);
  // P3: what the first frame needs of the data is made at the session start (and at a data switch's bind), not in the first frame: the distance texture and the marks / grids of the combined texture, from the GPU's bytes
  // F = { cls (clsInfoOf), c4 ({ tex, gen, gpu } | null), cls4 }. Nothing is made for a texture that is not on the GPU or whose programs are not ready (the frame then does the same).
  const prime = F => {
    const ci = F.cls; if (!ci || ci.format !== 'rgba8unorm') return;
    if (hostOf().gpuProg().state === 'ready') hostOf().prepareGpu(ci.tex, ci.gen, ci.gpu, ci.dims);
    if (mkOf().prog(!!F.cls4).state === 'ready') { const enc = device.createCommandEncoder(); mkOf().prepare({ enc, clsObj: ci.tex, c4Obj: F.cls4 ? F.c4?.tex : null, clsTex: ci.gpu, c4Tex: F.cls4 ? F.c4?.gpu : ctx.dummy('f'), dims: ci.dims, cls4: !!F.cls4, clsGen: ci.gen, c4Gen: F.cls4 ? F.c4?.gen : 0 }); device.queue.submit([enc.finish()]); }
  };
  // 8-1: the resources made from the GPU's bytes are let go (the distance texture, the marks and the two grids, the tiles) and made again at the next frame that asks; the compiled programs stay
  const reset = () => { try { host?.reset(); } catch { /* gone */ } try { cd?.reset(); } catch { /* gone */ } try { mk?.reset(); } catch { /* gone */ } inst.readyAt = -1; };
  // the texture is disposed (a data switch that is cancelled half way lets its textures go): what was made from it goes with it
  const onTexGone = tex => { try { if (host?.state && host.state.tex === tex) host.reset(); } catch { /* gone */ } try { mk?.onTexGone(tex); } catch { /* gone */ } };
  // 8-2: the programs that failed and that no other way can stand in for: the distance texture's and the marks' compute programs, and the render programs of D, EvD, S and EvS (B falls to D, OS to S; the tiles' compute program belongs to those two only)
  const failedRequired = () => {
    const out = [];
    for (const [k, p] of pipes) { const m = k.split(':')[0]; if (p.state === 'failed' && ['dist', 'distEv', 'skip', 'skipEv'].includes(m)) out.push(k + ' (' + p.msg + ')'); }
    const g = host?.gpuProg?.(); if (g?.state === 'failed') out.push('distance texture program (' + g.msg + ')');
    for (const [k, p] of mk?.state.progs || []) if (p.state === 'failed') out.push('marks program ' + k + ' (' + p.msg + ')');
    return out;
  };
  // the failed programs are asked for again (once, at the session start)
  const retryFailed = () => {
    for (const [k, p] of [...pipes]) if (p.state === 'failed') pipes.delete(k);
    host?.retryProg?.();
    for (const [k, p] of [...(mk?.state.progs || [])]) if (p.state === 'failed') mk.state.progs.delete(k);
    for (const [k, p] of [...(cd?.state.progs || [])]) if (p.state === 'failed') cd.state.progs.delete(k);
    inst.failed = '';
  };
  const destroy = () => {
    try { host?.destroy(); } catch { /* gone */ }
    try { cd?.destroy(); } catch { /* gone */ }
    try { mk?.destroy(); } catch { /* gone */ }
    host = null; cd = null; mk = null; pipes.clear();
  };
  return { plan, planWay, ensure, ensureAll, prime, reset, onTexGone, failedRequired, retryFailed, whenReady, pending, layoutOf, onWrite, destroy, count: (reason, mode) => note({ use: false, reason, mode }, mode), stats: () => ({ tag: inst.tag, used: inst.counts.used, notUsed: inst.counts.notUsed, reasons: { ...inst.counts.reasons }, byMode: { ...inst.counts.byMode }, byWay: { ...inst.counts.byWay }, failed: inst.failed, failLog: inst.failLog.slice() }),
    fail, get failed() { return inst.failed; }, get readyAt() { return inst.readyAt; }, get host() { return host; }, get cd() { return cd; }, get marks() { return mk; }, get pipes() { return pipes; } };
}
