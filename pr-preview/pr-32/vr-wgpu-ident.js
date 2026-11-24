// The GPU side of the same-picture check (the page's button 「同じ絵の検査」, docs/vr-ident-log.js is its record and its run): while it runs, every frame draws the centre pass once more with ONE of the ways below into targets of its own, right after
// the display drew its own centre pass the old way (the display ignores its switches while a check runs), and counts where and by how much the two pictures differ (docs/vr-wgsl-core.js identDiffWgsl). Nothing is made until begin(); end() lets everything go.
//   same     : the display's own way again (a control: the difference must be 0)
//   dist / coarse / both : the new ways (docs/vr-wgpu-newpath.js, the same code the display's switches use: drawPass with `np`)
//   pos      : the positive control (every 20th comparison): the display's program without the shading maths (the performance record's noShade, abl 'shade'): every pixel of the body that is drawn is lit differently, whatever tissues are shown and whatever the surface search setting: the difference must be there (a picture with no body in it is not counted at all)
// The check shares nothing with the performance record's breakdown: own instance of the new ways (own distance texture, grid, tiles, uniform buffers 9 and up), own targets, own comparison pipeline / counters, own timestamp query sets.
import { identDiffWgsl, identDiffDecode, IDENT_DIFF, IDENT_DIFF_BINDINGS } from './vr-wgsl-core.js?v=20261124-build761';

export const IDENT_ROTATION = ['same', 'dist', 'coarse', 'both']; // the order the ways take turns in
export const IDENT_CONTROL_EVERY = 20; // every 20th comparison is the positive control (the rotation goes on without it)
export const IDENT_RING = 4; // comparisons in flight (counters and timestamps are read back a frame or two later)
export const IDENT_UBUF = 9; // the check's uniform buffers (vr-wgpu.js ubufOf: 9 and 10)
export const IDENT_PENDING_FRAMES = 40; // a comparison whose display times have not come back after this many frames is recorded without them

// the way of the n-th comparison (0-based) and the rotation cursor after it: pure
export function identNextMode(n, cursor) {
  if ((n + 1) % IDENT_CONTROL_EVERY === 0) return { mode: 'pos', cursor };
  return { mode: IDENT_ROTATION[cursor % IDENT_ROTATION.length], cursor: cursor + 1 };
}

// ctx = { device, f16, hasTimer, drawPass, makeNp(tag, note), controlPipeDesc(cls4) -> a render pipeline descriptor of the display program without the surface search, setIdentOn(bool), curRec() -> this frame's record (or null), frameNo() }
export function createIdentGpu(ctx) {
  const { device } = ctx;
  let st = null;
  const kill = x => { try { x?.destroy(); } catch { /* gone */ } };
  const mkTarget = (w, h) => {
    const mk = () => device.createTexture({ size: [w, h, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    const t = { w, h, color: mk(), depth: mk() }; t.colorView = t.color.createView(); t.depthView = t.depth.createView();
    return t;
  };
  // cls4 = whether the session's display variant uses the fourth segment's own texture; onResult(r) is called once per finished comparison (the record's fields are in finish() below); returns { ok, failed }
  const begin = async ({ cls4 = false, onResult = null, timeoutMs = 30000 } = {}) => {
    if (st) end();
    ctx.setIdentOn(true);
    const me = st = { cls4: !!cls4, onResult, notes: [], np: null, cmp: null, ctl: null, ring: [], tgt: null, seq: 0, nonce: 0, cursor: 0, pending: [], dead: false, qsOk: !!ctx.hasTimer, unavailable: [] };
    me.np = ctx.makeNp('check', text => me.notes.push(text));
    const failed = [];
    try {
      if (!me.cls4) for (const m of ['dist', 'coarse', 'both']) me.np.ensure(m, false); // (a c4 session draws the old way in every new way: there is nothing to make)
      const module = device.createShaderModule({ code: identDiffWgsl() });
      const bgl = device.createBindGroupLayout({ entries: [
        ...[IDENT_DIFF_BINDINGS.colorA, IDENT_DIFF_BINDINGS.depthA, IDENT_DIFF_BINDINGS.colorB, IDENT_DIFF_BINDINGS.depthB].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } })),
        { binding: IDENT_DIFF_BINDINGS.count, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: IDENT_DIFF_BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ] });
      const [pipe, ctl] = await Promise.all([
        device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module, entryPoint: 'main' } }),
        device.createRenderPipelineAsync(ctx.controlPipeDesc(me.cls4)).catch(e => { failed.push('control program: ' + String(e?.message ?? e).slice(0, 160)); return null; }),
      ]);
      if (me.dead) return { ok: false, failed: ['ended while preparing'] };
      me.cmp = { pipe, bgl }; me.ctl = ctl;
      me.ring = Array.from({ length: IDENT_RING }, () => ({
        busy: false, cnt: device.createBuffer({ size: IDENT_DIFF.total * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }),
        rb: device.createBuffer({ size: IDENT_DIFF.total * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), params: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        qs: me.qsOk ? device.createQuerySet({ type: 'timestamp', count: 6 }) : null, resolve: me.qsOk ? device.createBuffer({ size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null,
        trb: me.qsOk ? device.createBuffer({ size: 48, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null, bg: null, keyObjs: null,
      }));
    } catch (e) { failed.push(String(e?.message ?? e).slice(0, 160)); }
    // wait for the programs of the new ways (made in the background): ready, failed, or out of time
    const t0 = Date.now();
    while (!me.dead && Date.now() - t0 < timeoutMs) {
      const ps = [...me.np.pipes.values()];
      if (ps.every(p => p.state !== 'pending')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    for (const [k, p] of me.np.pipes) if (p.state === 'failed') failed.push(k + ': ' + p.msg);
    if (me.cmp === null) failed.push('no comparison program');
    return { ok: !failed.length && !me.dead, failed, notes: me.notes.slice() };
  };
  const end = () => {
    const me = st; st = null; ctx.setIdentOn(false);
    if (!me) return;
    me.dead = true;
    try { me.np?.destroy(); } catch { /* gone */ }
    for (const r of me.ring) { kill(r.cnt); kill(r.rb); kill(r.params); kill(r.qs); kill(r.resolve); kill(r.trb); }
    if (me.tgt) { kill(me.tgt.color); kill(me.tgt.depth); }
    me.ring = []; me.tgt = null; me.pending.length = 0;
  };
  // the state the page's run reads: the programs and the distance texture / grid of the new ways are there (the first comparisons of a way are made before that and are not used)
  const ready = () => {
    const me = st; if (!me || me.dead || !me.cmp) return false;
    if ([...me.np.pipes.values()].some(p => p.state === 'pending')) return false;
    if (me.cls4) return true;
    const h = me.np.host?.state, g = me.np.cd?.state?.grid;
    return !!h?.ready && !!g?.readyKey;
  };
  const msOf = (a, i) => { const b = a[2 * i], e = a[2 * i + 1]; if (b === 0n || e === 0n || e < b) return null; const ms = Number(e - b) / 1e6; return ms < 1000 ? ms : null; };
  const finish = (me, p) => {
    if (p.done) return;
    p.done = true;
    const rec = p.rec, err = p.gpuError || (p.diff && p.diff.nonce !== p.nonce ? 'read-back is not this comparison\'s (number ' + p.diff.nonce + ', expected ' + p.nonce + ')' : '') || (!p.diff ? 'no counters read back' : '');
    const r = { error: err, nonce: p.nonce, mode: p.mode, used: p.used, why: p.why, diff: p.diff, compared: p.compared, ms: p.ms, disp: { vol: rec && rec.lowMs > 0 ? rec.lowMs : null, pre: p.dispPre ? (rec && rec.preMs > 0 ? rec.preMs : null) : null }, frame: p.frame, sinceRebuild: p.sinceRebuild, ctx: p.ctx, unavailable: !!p.unavailable };
    try { me.onResult?.(r); } catch { /* the page's callback */ }
  };
  const settle = me => { // a comparison is recorded when its own read-backs are in and the display's times of the same frame are (or are given up)
    const now = ctx.frameNo();
    for (const p of me.pending) { if (p.done || !p.read) continue; const rec = p.rec, have = !rec || (rec.lowMs !== null && (!p.dispPre || rec.preMs !== null)); if (have || now - p.frame >= IDENT_PENDING_FRAMES) finish(me, p); }
    for (let i = me.pending.length - 1; i >= 0; i--) if (me.pending[i].done) me.pending.splice(i, 1);
  };
  // F = { low (the centre pass: target, eyes, px), lowDraw (what its drawPass returned), u, vr (the display variant), dReq, n (eyes), cx (the page's context of this frame: a plain object, kept) }; called right after the display's low drawPass
  const frame = F => {
    const me = st;
    if (!me || me.dead || !me.cmp) return;
    settle(me);
    if (F.dReq || !F.low?.eyes?.length) return;
    const slot = me.ring.find(r => !r.busy);
    if (!slot) return;
    const { mode, cursor } = identNextMode(me.seq, me.cursor);
    let ctlUnavail = false;
    if (mode === 'pos' && !me.ctl) ctlUnavail = true; // the control's program did not compile: no positive control can be made (the run says so)
    me.seq++; me.cursor = cursor;
    const low = F.low, eyes = low.eyes, W = low.target.w, H = low.target.h;
    if (!me.tgt || me.tgt.w !== W || me.tgt.h !== H) { if (me.tgt) { kill(me.tgt.color); kill(me.tgt.depth); } me.tgt = mkTarget(W, H); for (const r of me.ring) { r.bg = null; r.keyObjs = null; } }
    let cw = 1, ch = 1, total = 0; for (const e of eyes) { cw = Math.max(cw, (e.vx ?? e.x) + (e.vw ?? e.w)); ch = Math.max(ch, (e.vy ?? e.y) + (e.vh ?? e.h)); total += (e.vw ?? e.w) * (e.vh ?? e.h); }
    cw = Math.min(cw, W); ch = Math.min(ch, H);
    const split = eyes.length > 1 ? (eyes[1].vx ?? eyes[1].x) : cw;
    const tsw = (a, b) => (slot.qs ? { querySet: slot.qs, beginningOfPassWriteIndex: a, endOfPassWriteIndex: b } : null);
    const nonce = ++me.nonce; // this comparison's number: it goes to the shader in params.w and must come back in the counters
    const keyObjs = [low.target.color, low.target.depth, me.tgt.color, me.tgt.depth];
    const after = enc => {
      if (!slot.bg || !slot.keyObjs || slot.keyObjs.some((x, i) => x !== keyObjs[i])) { // the ring's bind group is for these very textures (the objects themselves, not a number a texture was given)
        slot.keyObjs = keyObjs;
        slot.bg = device.createBindGroup({ layout: me.cmp.bgl, entries: [
          { binding: IDENT_DIFF_BINDINGS.colorA, resource: low.target.color.createView() }, { binding: IDENT_DIFF_BINDINGS.depthA, resource: low.target.depth.createView() },
          { binding: IDENT_DIFF_BINDINGS.colorB, resource: me.tgt.color.createView() }, { binding: IDENT_DIFF_BINDINGS.depthB, resource: me.tgt.depth.createView() },
          { binding: IDENT_DIFF_BINDINGS.count, resource: { buffer: slot.cnt } }, { binding: IDENT_DIFF_BINDINGS.params, resource: { buffer: slot.params } },
        ] });
      }
      device.queue.writeBuffer(slot.params, 0, new Uint32Array([cw, ch, split, nonce]));
      enc.clearBuffer(slot.cnt);
      const cp = enc.beginComputePass(); cp.setPipeline(me.cmp.pipe); cp.setBindGroup(0, slot.bg); cp.dispatchWorkgroups(Math.ceil(cw / 8), Math.ceil(ch / 8)); cp.end();
      enc.copyBufferToBuffer(slot.cnt, 0, slot.rb, 0, IDENT_DIFF.total * 4);
      if (slot.qs) { enc.resolveQuerySet(slot.qs, 0, 6, slot.resolve, 0); enc.copyBufferToBuffer(slot.resolve, 0, slot.trb, 0, 48); }
    };
    const o = { proxy: low.px, timed: false, tsw: tsw(2, 3), proxyTsw: tsw(0, 1), after };
    if (mode === 'pos') { if (!ctlUnavail) o.pipeline = me.ctl; }
    else if (mode !== 'same') o.np = { inst: me.np, mode, skip: '', buildTsw: tsw(4, 5) };
    slot.busy = true;
    const frameNo = ctx.frameNo(), rec = ctx.curRec(), builds0 = me.np.cd?.state?.builds | 0;
    let res;
    // a failed submit, a validation error or an allocation that did not fit must not read as a clean comparison (the same guard as docs/vr-wgpu-cs.js): the draw and the comparison are inside two error scopes, answered with the counters
    const guarded = typeof device.pushErrorScope === 'function';
    if (guarded) { device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory'); }
    try { res = ctx.drawPass(me.tgt, eyes, F.u, F.vr, IDENT_UBUF, null, null, o); } catch (e) { if (guarded) { try { device.popErrorScope(); device.popErrorScope(); } catch { /* none */ } } slot.busy = false; me.notes.push('draw threw: ' + String(e?.message ?? e).slice(0, 160)); return; }
    const scopes = guarded ? Promise.all([device.popErrorScope(), device.popErrorScope()]) : Promise.resolve([null, null]);
    const used = mode === 'same' ? true : mode === 'pos' ? !ctlUnavail : !!res?.np?.use;
    const why = mode === 'same' ? '' : mode === 'pos' ? (ctlUnavail ? 'control' : '') : (res?.np?.use ? '' : res?.np?.reason || 'unknown');
    const built = (me.np.cd?.state?.builds | 0) !== builds0; // the grid's build compute was in this frame's submit (its timestamps are there)
    const p = { mode, used, why, built, frame: frameNo, rec, dispPre: !!F.lowDraw?.proxy, compared: total, cw, ch, ms: { pre: null, vol: null, build: null }, diff: null, sinceRebuild: me.np.readyAt >= 0 ? frameNo - me.np.readyAt : null, ctx: F.cx || null, unavailable: ctlUnavail, done: false, read: false, nonce, gpuError: '' };
    me.pending.push(p);
    const jobs = [scopes.then(([oom, val]) => { const e = oom || val; if (e) p.gpuError = String(e.message ?? e).slice(0, 160) || 'GPU error'; }), slot.rb.mapAsync(GPUMapMode.READ).then(() => { const a = new Uint32Array(slot.rb.getMappedRange().slice(0)); slot.rb.unmap(); p.diff = identDiffDecode(a, cw, ch); })];
    if (slot.qs) jobs.push(slot.trb.mapAsync(GPUMapMode.READ).then(() => { const a = new BigUint64Array(slot.trb.getMappedRange().slice(0)); slot.trb.unmap(); p.ms = { pre: msOf(a, 0), vol: msOf(a, 1), build: p.built ? msOf(a, 2) : null }; }));
    Promise.all(jobs).then(() => { p.read = true; slot.busy = false; if (!me.dead) settle(me); }, () => { slot.busy = false; p.done = true; });
  };
  return { begin, end, frame, ready, get active() { return !!st && !st.dead; }, get np() { return st?.np ?? null; }, notes: () => (st ? st.notes.slice() : []), info: () => (st ? { control: !!st.ctl, cls4: st.cls4, seq: st.seq } : null) };
}
