// The "new ways" of the WebGPU low pass (the centre pass) in the display and in the same-picture check (docs/vr-wgpu-ident.js): distSplit, proxyCoarse and both together. They are the performance record's variants of the shadow pass
// (docs/vr-wgpu-coarse-march.js: the distance byte in a texture of its own; docs/vr-wgpu-coarse-proxy.js: the coarse grid and the 4 x 4 pre-pass over it), drawn as the pass itself. Nothing in here exists until a switch (or the check) asks.
//   dist   : the display program with the distance read from a 16 MB r8 texture (distSplit), the 8 x 8 pre-pass of the display as it is.
//   coarse : the display program with the 4 x 4 tiles and the far end tB (coarseVolumeWgsl), the pre-pass over the coarse grid (256 KB).
//   both   : the two substitutions in one program (marchWgsl of the coarse program; group 1 = the march layout). Not measured before, and not the product of the two ratios.
// A frame uses a new way only when everything it needs is there and agrees with this frame (plan() below, the rules of 1-5 of the plan); any other frame is drawn the way it always was (the caller keeps its own path: plan() says use: false and why).
import { volumeWgsl } from './vr-wgsl-core.js?v=20261126-build764';
import { marchWgsl, createMarchHost } from './vr-wgpu-coarse-march.js?v=20261126-build764';
import { coarseVolumeWgsl, createCoarseDisplay, walkLimitOk } from './vr-wgpu-coarse-proxy.js?v=20261126-build764';
import { skipText, createMarkHost } from './vr-wgpu-marks.js?v=20261126-build764'; // S / OS / EvS: the skip marks and their programs
import { featOf, featKey } from './vr-wgsl-feat.js?v=20261126-build764';
import { createHuMarkHost } from './vr-wgpu-humarks.js?v=20261126-build764'; // the HU marks of the general loop's S for the classification-off diagnostic
import { depthWgsl } from './vr-wgsl-depth.js?v=20261126-build764'; // the depth axis (frames that draw several volumes into one target)
import { createCompileGate } from './vr-wgpu-gate.js?v=20261126-build764'; // the programs go to the GPU through the gate (a task of their own each, a few at a time), never all in one task
import { generalWgsl } from './vr-wgsl-general.js?v=20261126-build764'; // the general loop (bricks, no jumps) of the frames that do not use the combined texture // the feature axis of the texts (the results' colours, the child segments, hiding)

export const NEW_PATH_MODES = ['dist', 'coarse', 'both'];
// the display program text of a mode (f16 = half precision march as the display's; cls4 = the fourth segment's own texture)
export function newPathText({ f16 = false, cls4 = false, mode, feat = null }) {
  if (mode === 'dist') return marchWgsl(volumeWgsl({ f16, cls4, events: false, feat }), 'distSplit');
  if (mode === 'coarse') return coarseVolumeWgsl({ f16, cls4, feat }, 4);
  if (mode === 'both') return marchWgsl(coarseVolumeWgsl({ f16, cls4, feat }, 4), 'distSplit');
  if (mode === 'distEv') return marchWgsl(volumeWgsl({ f16, cls4, events: true, feat }), 'distSplit'); // EvD: the section-plane program (slices, cut face) with the distance bytes from their own texture
  if (mode === 'skip') return skipText({ f16, cls4, events: false, feat }); // S
  if (mode === 'skipEv') return skipText({ f16, cls4, events: true, feat }); // EvS
  if (mode === 'tileSkip') return skipText({ f16, cls4, tiles: true, feat }); // OS
  if (mode === 'genSkip') return generalWgsl({ f16, cls4, events: false, feat, src: 'cls', skip: true }); // S of the general loop (the combined texture is not in use: no distance field in the data, the diagnostic that takes it away)
  if (mode === 'genSkipEv') return generalWgsl({ f16, cls4, events: true, feat, src: 'cls', skip: true }); // EvS of the general loop
  if (mode === 'genSkipHu') return generalWgsl({ f16, cls4, events: false, feat, src: 'hu', skip: true }); // S of the general loop on the data's own value (the classification-off diagnostic): the HU marks
  if (mode === 'genSkipHuEv') return generalWgsl({ f16, cls4, events: true, feat, src: 'hu', skip: true });
  throw new Error('new path: unknown mode ' + mode);
}
export const modeNeeds = mode => ({ dist: mode === 'dist' || mode === 'both' || mode === 'distEv', coarse: mode === 'coarse' || mode === 'both' || mode === 'tileSkip', hu: mode === 'genSkipHu' || mode === 'genSkipHuEv', marks: mode === 'skip' || mode === 'skipEv' || mode === 'tileSkip' || mode === 'genSkip' || mode === 'genSkipEv' });
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
//   false while its rows are being made), boxed (bool: the volume is a part taken out of the body: its rays start at its own content box, so the tiles' start (tA) gains nothing, and a pre-pass over the whole pass would be work for a small box) }
export const WAYS = ['B', 'D', 'D0', 'EvD', 'S', 'OS', 'EvS'];
export function chooseWay(F) {
  const peri = F.pass === 'peri', probe = F.pass === 'probe' || (F.diag | 0) === 5, diag = F.diag | 0;
  if (F.general) return F.section ? 'EvS' : 'S'; // the general loop (the combined texture is not in use: no jumps, the bricks' walk): S / EvS whatever the diagnostic, the pass or the grid's state (the marks are all it needs)
  if (F.section) return F.jumpOn ? 'EvD' : 'EvS';
  if (!F.jumpOn) {
    // no jumps: S where the walk's ends cannot move (diag 2 counts the loop, the probe returns the count) or there are no distance bytes to start from (OS uses the tiles of the distance field: diag 4 with a field)
    if (diag === 2 || probe || F.boxed || !F.matrixOk || !F.gridReady || !(diag === 4 && F.distField)) return 'S';
    return 'OS';
  }
  if (probe || diag === 1) return 'D0'; // the probe has no tiles of its own; diag 1 returns before the loop (iters are 0 everywhere), nothing to walk
  if (!F.matrixOk) return 'D0';
  if (F.boxed) return 'D0'; // a part: its rays start at the box it is made of (boxEntry), the 4 x 4 / 8 x 8 pre-pass of the whole pass would only find starts that lie before it
  if (diag === 2) return 'D0'; // diag 2 draws the loop's count: the 8 x 8 pre-pass of D moves a ray's start (fewer iterations), so the picture would differ from the display's own loop count; D0 walks the display's loop
  if (peri) return !F.walkOk || !F.gridReady ? 'D0' : 'B';
  return !F.walkOk || !F.gridReady ? 'D' : 'B';
}
// the way's mode of the instance (the program that draws it) and whether it uses tiles
export const DISPLAY_MODES = ['both', 'dist', 'distEv', 'skip', 'skipEv', 'tileSkip'];
export const GENERAL_MODES = ['genSkip', 'genSkipEv', 'genSkipHu', 'genSkipHuEv']; // the general loop's programs (a data set's own list: compiled with the others at the start, see ensureAll)
// the programs a way may fall back through when the first is not ready (its grid is being made, its program is being compiled): [mode, the way that is drawn]
export const WAY_LADDER = { B: [['both', 'B'], ['dist', 'D']], D: [['dist', 'D']], D0: [['dist', 'D0']], EvD: [['distEv', 'EvD']], S: [['skip', 'S']], EvS: [['skipEv', 'EvS']], OS: [['tileSkip', 'OS'], ['skip', 'S']] };
export const wayMode = way => ({ B: 'both', D: 'dist', D0: 'dist', EvD: 'distEv', S: 'skip', EvS: 'skipEv', OS: 'tileSkip' }[way] || null);
export const GENERAL_LADDER = { S: [['genSkip', 'S']], EvS: [['genSkipEv', 'EvS']] };
export const GENERAL_HU_LADDER = { S: [['genSkipHu', 'S']], EvS: [['genSkipHuEv', 'EvS']] }; // the classification-off diagnostic: the data's own value, the HU marks

// ctx = { device, f16, bgl (the volume pass's group 0 layout), renderDesc(module, pipelineLayout | null) (the display's render pipeline descriptor), onShader, dropGroups, dummy(kind), entryOf(three texture) (the host's entry: its write number),
//   tag ('display' | 'check'), onFail(text) }
// The programs are made asynchronously (warm / the first frame that asks): until one is ready a frame is drawn the old way ('prep').
export function createNewPath(ctx) {
  const { device } = ctx;
  let cd = null;
  // the data-derived resources (the distance texture, the skip marks, the HU marks) are per data SOURCE (the combined texture a pass reads: the body's, a part's original, the pair partner's); the programs and layouts are shared by all of them (made once)
  const share = { march: {}, marks: {}, hu: {} };
  const srcs = new Map(); // key (the source's three.js texture; '*' = none given: the check's, the programs' own) -> { key, host, mk, hk }
  const srcOf = key => { let S = srcs.get(key); if (!S) srcs.set(key, S = { key, host: null, mk: null, hk: null }); return S; };
  const BASE = srcOf('*');
  const keyOf = F => (F.hu?.vol?.tex ?? F.cls?.tex ?? '*');
  const firstOf = f => { for (const S of srcs.values()) { const h = S[f]; if (h && (f === 'host' ? h.state : h.state.grid)) return h; } return BASE[f]; }; // the first source that holds data (the programs' own source holds none)
  const pipes = new Map(); // 'mode:c3' -> { state, pipe, msg }
  const inst = { tag: ctx.tag, failed: '', failLog: [], counts: { used: 0, notUsed: 0, reasons: {}, byMode: {}, byWay: {} }, rebuilds: 0, readyAt: -1 };
  const fail = text => { if (inst.failed) return; inst.failed = text; inst.failLog.push(text); try { ctx.onFail?.(text); } catch { /* the host's line */ } };
  const hostOf = (S = BASE) => S.host ||= createMarchHost({ device, bgl0: ctx.bgl, cells: [], share: share.march });
  const mkOf = (S = BASE) => S.mk ||= createMarkHost({ device, bgl0: ctx.bgl, onShader: ctx.onShader, dropGroups: ctx.dropGroups, dummy: ctx.dummy, entryOf: ctx.entryOf, tag: ctx.tag, share: share.marks });
  const hkOf = (S = BASE) => S.hk ||= createHuMarkHost({ device, bgl: mkOf().layouts().bgl, onShader: ctx.onShader, tag: ctx.tag, share: share.hu });
  const cdOf = () => cd ||= createCoarseDisplay({ device, onShader: ctx.onShader, dropGroups: ctx.dropGroups, name: ctx.tag });
  const pipeKey = (mode, cls4, feat = null, z = false) => mode + (cls4 ? ':c4' : ':c3') + (featOf(feat) ? ':' + featKey(feat) : '') + (z ? ':z' : '');
  const pipeOf = (mode, cls4, feat = null, z = false) => {
    const key = pipeKey(mode, cls4, feat, z), have = pipes.get(key);
    if (have) return have;
    const p = { state: 'pending', pipe: null, msg: '' };
    pipes.set(key, p);
    try {
      const module = device.createShaderModule({ code: z ? depthWgsl(newPathText({ f16: !!ctx.f16, cls4, mode, feat })) : newPathText({ f16: !!ctx.f16, cls4, mode, feat }) });
      try { ctx.onShader?.(module, { f16: !!ctx.f16, cls4, events: false, coarse: ctx.tag + ' ' + mode + (featOf(feat) ? ' ' + featKey(feat) : '') + (z ? ' z' : '') }); } catch { /* diagnostics only */ }
      const lay = modeNeeds(mode).marks || modeNeeds(mode).hu ? mkOf().layouts().pipeLayout : modeNeeds(mode).dist ? hostOf().layouts().pipeLayout : null;
      Promise.resolve(device.createRenderPipelineAsync(ctx.renderDesc(module, lay, z))).then(pipe => { p.pipe = pipe; p.state = 'ready'; }, e => { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); fail(mode + ' program: ' + p.msg); });
    } catch (e) { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); fail(mode + ' program: ' + p.msg); }
    return p;
  };
  // the programs of a mode for a display variant, started now (the compute programs of the coarse ways too)
  // returns the records of the programs it asked for (each has a `state`: 'pending' until the compile is over)
  const ensure = (mode, cls4, feat = null, z = false) => { const r = [pipeOf(mode, cls4, feat, z)]; if (modeNeeds(mode).coarse) r.push(cdOf().progs(cls4)); if (modeNeeds(mode).dist) r.push(hostOf().gpuProg()); if (modeNeeds(mode).marks || modeNeeds(mode).coarse) r.push(mkOf().prog(cls4)); if (modeNeeds(mode).hu) r.push(hkOf().prog()); return r.filter(Boolean); };
  // the display: every program a way of this variant can ask for is made at once (B and its fallback D / D0 share the distSplit program of 'dist'; the section program joins when EvD is made)
  const ensureAll = (cls4, feat = null, z = false) => { for (const m of DISPLAY_MODES) ensure(m, cls4, feat, z); for (const m of GENERAL_MODES) ensure(m, cls4, feat, z); };
  // the same through the gate: one job per program (a task of its own, a few compiling at once, the frames go on between them); a program that is already made or asked for is not queued again. front: before the jobs that wait.
  // The data set's programs a session cannot draw without are queued with front, the others (the other fourth-segment variant) behind them. The gate counts the programs of this instance that are compiling (compiling()) against its limit; a promise of queueAll settles when the programs its job asked for have (ready or failed);
  // queueAll returns those promises, so that a caller can wait for exactly these (waitFor) and not for the background ones queued before.
  const gate = ctx.gate || createCompileGate();
  const queuedKeys = new Set(); // the programs whose job waits in the gate (a background request for one of them is not queued twice)
  const settled = recs => new Promise(res => { const look = () => (recs.every(r => r.state !== 'pending') ? res() : setTimeout(look, 8)); look(); });
  // force: every job runs, also for a program that is there (the retry after a failure: the tools' programs a failed one took away are asked for again by the same calls)
  const queueAll = (cls4, feat = null, z = false, front = false, force = false) => {
    const waits = []; // a program that is made but still compiling (started by an earlier call, e.g. as a background one), or whose tools (marks, grids, distance texture) are, is waited for too: the caller's promises cover everything its frames need
    const list = [...DISPLAY_MODES, ...GENERAL_MODES].filter(m => { if (force) return true; if (!front && queuedKeys.has(pipeKey(m, cls4, feat, z))) return false; const have = pipes.get(pipeKey(m, cls4, feat, z)); if (!have) return true; waits.push(settled(ensure(m, cls4, feat, z))); return false; }); // (the program is there: ensure makes nothing new, it hands back the records of the program and its tools, some of which may still be compiling from an earlier call)
    if (front) list.reverse(); // each job goes to the front: the reversed list keeps the order of the modes
    return waits.concat(list.map(m => { let recs = []; const key = pipeKey(m, cls4, feat, z); queuedKeys.add(key); return gate.queue(() => { queuedKeys.delete(key); recs = ensure(m, cls4, feat, z); }, { front, label: key }).then(() => settled(recs)).catch(e => fail('program ' + m + ': ' + String(e?.message ?? e).slice(0, 160))); }));
  };
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
    const pipe = pipeOf(mode, F.cls4, F.feat, !!F.z);
    if (pipe.state === 'failed') return no('failed');
    const S = srcOf(keyOf(F)), ci = F.cls;
    if (!need.hu && (!ci || (ci.format !== 'rgba8unorm' && !(need.marks && !need.coarse)))) return no('nodata'); // (S / EvS read class channels only: a class texture of one or two channels is as good as an rgba one; the coarse grid and the distance texture need the alpha's distance)
    let dState = 'ready', g1 = null, cState = 'ready', mState = 'ready';
    if (need.hu) { // the HU marks (the classification-off diagnostic): made whole from the data's and the edit texture's GPU bytes, again when either was written
      const hp = hkOf(S).prog();
      if (hp.state === 'failed') { fail('HU marks program: ' + hp.msg); return no('failed'); }
      if (!F.hu?.vol || !F.hu?.edit) return no('nodata');
      const s = hkOf(S).prepare({ enc, vol: F.hu.vol, edit: F.hu.edit });
      mState = s === 'ready' ? 'ready' : s === 'failed' ? 'failed' : 'prep';
      if (mState === 'ready') g1 = S.hk.group();
    }
    if (need.marks || need.coarse) { // the skip marks (S, EvS, OS) and the two grids of the tiles (B, OS): made whole here from the GPU's bytes the first time, followed row by row on every write after
      const mp = mkOf(S).prog(!!F.cls4);
      if (mp.state === 'failed') { fail('skip marks program: ' + mp.msg); return no('failed'); }
      const s = mkOf(S).prepare({ enc, clsObj: ci.tex, c4Obj: F.cls4 ? F.c4?.tex : null, clsTex: ci.gpu, c4Tex: F.cls4 ? F.c4?.gpu : ctx.dummy('f'), dims: ci.dims, cls4: !!F.cls4, clsGen: ci.gen, c4Gen: F.cls4 ? F.c4?.gen : 0 });
      mState = s === 'ready' ? 'ready' : s === 'failed' ? 'failed' : 'prep';
      if (mState === 'ready') { const mk = S.mk; g1 = mk.group(); if (inst.readyAt !== F.frame && mk.state.builds !== inst.rebuilds) { inst.rebuilds = mk.state.builds; inst.readyAt = F.frame; } }
    }
    if (need.dist) {
      // the distance texture is made on the GPU from the combined texture's own GPU bytes (docs/vr-wgpu-coarse-march.js prepareGpu): whatever the CPU's copy holds (a rebuild still going up, a bake) is of no matter
      const hp = hostOf(S).gpuProg();
      if (hp.state === 'failed') { fail('distance program: ' + hp.msg); return no('failed'); }
      const s = hostOf(S).prepareGpu(ci.tex, ci.gen, ci.gpu, ci.dims);
      dState = s === null ? 'nodata' : s === 'wait' ? 'prep' : 'ready';
      if (dState === 'ready') g1 = S.host.group('distSplit');
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
      pxTex = cd.tiles(enc, { slot: F.tileSlot || F.slot || 'low', grid: { alpha: S.mk.alphaTex, marks: S.mk.markTex }, bytes, nEyes: F.tiles.nEyes, tilesPerEye: F.tiles.tilesPerEye, tilesY: F.tiles.tilesY, texCols: F.tiles.texCols, texRows: F.tiles.texRows, dims: ci.dims, cls4: !!F.cls4, tsw: F.tswTiles || null });
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
    for (const [mode, label] of (F.general ? (F.hu ? GENERAL_HU_LADDER : GENERAL_LADDER) : WAY_LADDER)[way]) { // the way itself, then the ones it falls back to while its program or its grid is not ready (the periphery has no 8 x 8 pre-pass of its own: its D is D0)
      const lab = label === 'D' && peri ? 'D0' : label, tiles = lab === 'B' || lab === 'OS' || lab === 'D';
      r = tryMode(enc, { ...F, mode, noTiles: !tiles });
      if (r.use) { got = lab; break; }
    }
    if (r.use) inst.counts.byWay[got] = (inst.counts.byWay[got] | 0) + 1;
    return note({ ...r, way: r.use ? got : way }, r.use ? r.mode : way);
  };
  // bytes of the combined texture [z0, z1) were just written to the GPU (docs/vr-wgpu.js writeRange): the distance texture of the host follows (only a host that holds that texture, complete)
  const onWrite = (e, bytes, z0, z1) => {
    for (const S of srcs.values()) {
      try { S.mk?.onWrite(e, z0, z1); } catch { /* the marks are made whole at the next use */ } // the skip marks' rows follow from the GPU's bytes (the same queue, after the write itself)
      const s = S.host?.state;
      if (!s || ctx.entryOf(s.tex) !== e) continue;
      S.host.writeRangeGpu(s.tex, e.gen, e.gpu, z0, z1); // the distance texture follows from the GPU's bytes (the same queue, after the write itself)
    }
  };
  // the bind group layout of a mode's group 1 (the distance texture's, or the skip marks'): what the direct draw's pipeline layouts are made from
  // is a program of this instance still being compiled (the render programs, the distance texture's, the marks', the grid's and the tiles')?
  const compiling = () => { let n = 0; for (const p of pipes.values()) if (p.state === 'pending') n++; if (share.march.gp?.state === 'pending') n++; for (const p of share.marks.progs?.values() || []) if (p.state === 'pending') n++; if (share.hu.prog?.state === 'pending') n++; for (const p of cd?.state.progs.values() || []) if (p.state === 'pending') n++; return n; };
  const removeSource = gate.addSource(compiling); // the gate counts the programs of this instance that are being compiled (it starts the next job when there is room)
  const pending = () => compiling() > 0 || gate.queued > 0;
  // resolves when nothing is queued or being compiled any more (a failure counts: the frame says so itself). stallMs: how long NOTHING changes (no program started or finished) before it gives up and returns false: a compile that hangs must not hold the
  // session's start for ever; a long list that goes on steadily is waited for however long it takes. onProgress({ done, total, fraction }) is called every poll.
  const whenReady = async (stallMs = 60000, onProgress = null) => {
    await new Promise(r => setTimeout(r, 0));
    let sig = '', at = Date.now();
    while (pending()) {
      const g = gate.stats(), now = g.started + ':' + g.queued + ':' + compiling();
      if (now !== sig) { sig = now; at = Date.now(); } else if (Date.now() - at > stallMs) break;
      try { onProgress?.(gate.progress()); } catch { /* the page's callback */ }
      await new Promise(r => setTimeout(r, 10));
    }
    try { onProgress?.(gate.progress()); } catch { /* the page's callback */ }
    return !pending();
  };
  // resolves true when every promise of `ps` (from queueAll) has settled, false when nothing started or finished for stallMs; onProgress({ done, total, fraction }) every poll
  const waitFor = async (ps, stallMs = 60000, onProgress = null) => {
    let left = ps.length; for (const p of ps) p.then(() => { left--; });
    let sig = '', at = Date.now();
    const call = () => { try { onProgress?.(gate.progress()); } catch { /* the page's callback */ } };
    while (left > 0) {
      const now = gate.stats().started + ':' + left + ':' + gate.queued;
      if (now !== sig) { sig = now; at = Date.now(); } else if (Date.now() - at > stallMs) { call(); return false; }
      call(); await new Promise(r => setTimeout(r, 10));
    }
    call(); return true;
  };
  const layoutOf = mode => (modeNeeds(mode).marks || modeNeeds(mode).hu ? mkOf().layouts().bgl : hostOf().layouts().bgl);
  // P3: what the first frame needs of the data is made at the session start (and at a data switch's bind), not in the first frame: the distance texture and the marks / grids of the combined texture, from the GPU's bytes
  // F = { cls (clsInfoOf), c4 ({ tex, gen, gpu } | null), cls4 }. Nothing is made for a texture that is not on the GPU or whose programs are not ready (the frame then does the same).
  const prime = F => {
    const ci = F.cls; if (!ci || ci.format !== 'rgba8unorm') return;
    const S = srcOf(keyOf(F));
    if (hostOf(S).gpuProg().state === 'ready') hostOf(S).prepareGpu(ci.tex, ci.gen, ci.gpu, ci.dims);
    if (mkOf(S).prog(!!F.cls4).state === 'ready') { const enc = device.createCommandEncoder(); mkOf(S).prepare({ enc, clsObj: ci.tex, c4Obj: F.cls4 ? F.c4?.tex : null, clsTex: ci.gpu, c4Tex: F.cls4 ? F.c4?.gpu : ctx.dummy('f'), dims: ci.dims, cls4: !!F.cls4, clsGen: ci.gen, c4Gen: F.cls4 ? F.c4?.gen : 0 }); device.queue.submit([enc.finish()]); }
  };
  // 8-1: the resources made from the GPU's bytes are let go (the distance texture, the marks and the two grids, the tiles) and made again at the next frame that asks; the compiled programs stay
  const reset = () => { for (const S of srcs.values()) { try { S.host?.reset(); } catch { /* gone */ } try { S.mk?.reset(); } catch { /* gone */ } try { S.hk?.reset(); } catch { /* gone */ } } try { cd?.reset(); } catch { /* gone */ } inst.readyAt = -1; };
  // the texture is disposed (a data switch that is cancelled half way lets its textures go): what was made from it goes with it
  const onTexGone = tex => { for (const S of [...srcs.values()]) { try { if (S.host?.state && S.host.state.tex === tex) S.host.reset(); } catch { /* gone */ } try { S.mk?.onTexGone(tex); } catch { /* gone */ } try { S.hk?.onTexGone(tex); } catch { /* gone */ } if (S.key === tex && S !== BASE) { try { S.host?.destroy(); S.mk?.destroy(); S.hk?.destroy(); } catch { /* gone */ } srcs.delete(S.key); } } };
  // 8-2: the programs that failed and that no other way can stand in for: the distance texture's and the marks' compute programs, and the render programs of D, EvD, S and EvS (B falls to D, OS to S; the tiles' compute program belongs to those two only)
  const failedRequired = () => {
    const out = [];
    for (const [k, p] of pipes) { const m = k.split(':')[0]; if (p.state === 'failed' && ['dist', 'distEv', 'skip', 'skipEv', 'genSkip', 'genSkipEv', 'genSkipHu', 'genSkipHuEv'].includes(m)) out.push(k + ' (' + p.msg + ')'); }
    const g = share.march.gp; if (g?.state === 'failed') out.push('distance texture program (' + g.msg + ')');
    for (const [k, p] of share.marks.progs || []) if (p.state === 'failed') out.push('marks program ' + k + ' (' + p.msg + ')');
    if (share.hu.prog?.state === 'failed') out.push('HU marks program (' + share.hu.prog.msg + ')');
    return out;
  };
  // the failed programs are asked for again (once, at the session start)
  const retryFailed = () => {
    for (const [k, p] of [...pipes]) if (p.state === 'failed') pipes.delete(k);
    if (share.march.gp?.state === 'failed') share.march.gp = null;
    for (const [k, p] of [...(share.marks.progs || [])]) if (p.state === 'failed') share.marks.progs.delete(k);
    if (share.hu.prog?.state === 'failed') { share.hu.prog = null; for (const S of srcs.values()) if (S.hk) S.hk.state.prog = null; }
    for (const [k, p] of [...(cd?.state.progs || [])]) if (p.state === 'failed') cd.state.progs.delete(k);
    inst.failed = '';
  };
  const destroy = () => {
    removeSource();
    for (const S of srcs.values()) { try { S.host?.destroy(); } catch { /* gone */ } try { S.mk?.destroy(); } catch { /* gone */ } try { S.hk?.destroy(); } catch { /* gone */ } }
    try { share.march.gp?.buf?.destroy(); share.march.gp?.ubuf?.destroy(); } catch { /* gone */ }
    try { cd?.destroy(); } catch { /* gone */ }
    srcs.clear(); srcOf('*'); cd = null; pipes.clear();
  };
  return { plan, planWay, ensure, ensureAll, queueAll, waitFor, gate, progress: () => gate.progress(), prime, reset, onTexGone, failedRequired, retryFailed, whenReady, pending, layoutOf, onWrite, destroy, count: (reason, mode) => note({ use: false, reason, mode }, mode), stats: () => ({ tag: inst.tag, used: inst.counts.used, notUsed: inst.counts.notUsed, reasons: { ...inst.counts.reasons }, byMode: { ...inst.counts.byMode }, byWay: { ...inst.counts.byWay }, failed: inst.failed, failLog: inst.failLog.slice() }),
    fail, get failed() { return inst.failed; }, get readyAt() { return inst.readyAt; }, get host() { return firstOf('host'); }, get cd() { return cd; }, get marks() { return firstOf('mk'); }, get huMarks() { return firstOf('hk'); }, get sources() { return srcs.size; }, get pipes() { return pipes; } };
}
