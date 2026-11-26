// The host of the compute-march variants of the performance record's breakdown (vr-wgsl-cs.js has the shader texts and the constants). Not the display: the display's low pass is a fragment pass; these shadow passes draw the SAME frame's low pass
// once more with a compute shader walking the rays instead, into scratch images, and report (a) the GPU time of the compute work next to the same frame's real low pass time, (b) how many pixels of the scratch image differ from the
// display's own image (colour or packed depth, inside the eyes' regions; the display's image is still in the low pass's target when the shadow runs).
// The fragment shader's inputs are made by a small render pass with the display's own vertex stage (vPos and the depth into an rgba32float image: the covered pixels and the rays are the fragment shader's, not a reconstruction);
// that pass is timed apart (callback 'csVposMs'), so the compute ratio is the march alone.
// Created lazily by vr-wgpu.js on the first shadow pass that names a compute variant (spec.cs); the compute programs compile in the background, a variant answers null (step past) until its programs exist.
// onShadow kinds added here (same callback as the timings): ('csVposMs', ms, 1), ('diff:<variant>', differing px, compared px), ('csStat:<variant>', hits listed, list overflow), ('csFail:<variant>', 0, 0).
import { BOX_VERTICES, uniformLayout } from './vr-wgsl-core.js?v=20261126-build767';
import { CS, CS_VARIANTS, CS_BINDINGS, CS_ARGS_BINDINGS, CS_DIFF_BINDINGS, csLayout, csWgsl, csArgsWgsl, vposWgsl, csDiffWgsl, invert4 } from './vr-wgsl-cs.js?v=20261126-build767';

const ARGS_SLOT_HITS = 7; // slot of the hit list's arguments in the args buffer (slots 1..waves-1 are the continuation lists')
const up = (n, m) => Math.ceil(n / m) * m;

export function createCsShadow({ device, f16 = false, cls4 = false, onShader = null }) {
  const L = uniformLayout(), CL = csLayout();
  const sgOk = device.features.has('subgroups');
  const fieldU = n => L.fields.find(f => f.name === n), fieldC = n => CL.fields.find(f => f.name === n);
  const C = GPUShaderStage.COMPUTE;
  const tex3 = binding => ({ binding, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } });
  // group 0 of the compute kernels = the display's bind group layout, visible to compute (the uniform buffer here is the cs variant's own copy of an eye's uniforms)
  const bgl0 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } }, tex3(1), tex3(2), tex3(3), tex3(5), tex3(6),
    { binding: 4, visibility: C, texture: { sampleType: 'uint', viewDimension: '3d' } },
    { binding: 7, visibility: C, sampler: { type: 'filtering' } }, { binding: 8, visibility: C, sampler: { type: 'filtering' } },
    { binding: 9, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
  ] });
  const bglC = device.createBindGroupLayout({ entries: [
    { binding: CS_BINDINGS.vpos, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    { binding: CS_BINDINGS.outColor, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' } },
    { binding: CS_BINDINGS.outDepth, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' } },
    { binding: CS_BINDINGS.params, visibility: C, buffer: { type: 'uniform' } },
    ...[CS_BINDINGS.cnt, CS_BINDINGS.hits, CS_BINDINGS.contOut, CS_BINDINGS.contIn].map(binding => ({ binding, visibility: C, buffer: { type: 'storage' } })),
  ] });
  const bglV = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const bglA = device.createBindGroupLayout({ entries: [
    { binding: CS_ARGS_BINDINGS.params, visibility: C, buffer: { type: 'uniform' } },
    { binding: CS_ARGS_BINDINGS.cnt, visibility: C, buffer: { type: 'storage' } }, { binding: CS_ARGS_BINDINGS.args, visibility: C, buffer: { type: 'storage' } },
  ] });
  const bglD = device.createBindGroupLayout({ entries: [
    ...[CS_DIFF_BINDINGS.colorA, CS_DIFF_BINDINGS.depthA, CS_DIFF_BINDINGS.colorB, CS_DIFF_BINDINGS.depthB].map(binding => ({ binding, visibility: C, texture: { sampleType: 'float', viewDimension: '2d' } })),
    { binding: CS_DIFF_BINDINGS.count, visibility: C, buffer: { type: 'storage' } }, { binding: CS_DIFF_BINDINGS.rect, visibility: C, buffer: { type: 'uniform' } },
  ] });
  const lay = (...g) => device.createPipelineLayout({ bindGroupLayouts: g });
  const layMain = lay(bgl0, bglC);
  const boxBuf = device.createBuffer({ size: BOX_VERTICES.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(boxBuf, 0, BOX_VERTICES);
  const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const nearest = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });

  // ---- programs (compiled in the background; pipes.get(key) is undefined until then) ----
  const pipes = new Map(), failed = new Map(); // key -> pipeline; variant -> message
  const mod = (code, info) => { const m = device.createShaderModule({ code }); try { onShader?.(m, info); } catch { /* diagnostics only */ } return m; };
  const need = name => {
    const v = CS_VARIANTS[name], o = { f16, cls4 };
    if (v.mode === 'full') return [['full', () => mod(csWgsl({ ...o, mode: 'full' }), { cs: 'full', ...o }), 'csMain']];
    if (v.mode === 'tile' || v.mode === 'share') return [[v.mode + (v.sg ? 'Sg' : ''), () => mod(csWgsl({ ...o, mode: v.mode, sg: !!v.sg }), { cs: v.mode, sg: !!v.sg, ...o }), 'csMain']];
    return [['march', () => mod(csWgsl({ ...o, mode: 'march' }), { cs: 'march', ...o }), 'csMarchPix'], ['march', null, 'csMarchList'], ['shade', () => mod(csWgsl({ ...o, mode: 'shade' }), { cs: 'shade', ...o }), 'csShadeList']];
  };
  const mods = new Map();
  const compile = async name => {
    try {
      const jobs = need(name);
      await Promise.all(jobs.map(async ([key, make, entry]) => {
        const pk = key + ':' + entry;
        if (pipes.has(pk)) return;
        if (make && !mods.has(key)) mods.set(key, make());
        pipes.set(pk, await device.createComputePipelineAsync({ layout: layMain, compute: { module: mods.get(key), entryPoint: entry } }));
      }));
      if (CS_VARIANTS[name].mode === 'wave' && !pipes.has('args')) pipes.set('args', await device.createComputePipelineAsync({ layout: lay(bglA), compute: { module: mod(csArgsWgsl(), { cs: 'args' }), entryPoint: 'main' } }));
    } catch (e) { failed.set(name, String(e?.message ?? e).slice(0, 160)); }
  };
  const ready = name => !failed.has(name) && need(name).every(([key, , entry]) => pipes.has(key + ':' + entry)) && (CS_VARIANTS[name].mode !== 'wave' || pipes.has('args')) && !!pipes.get('vpos') && !!pipes.get('diff');
  let started = false;
  const start = async () => {
    started = true;
    try {
      const vm = mod(vposWgsl(), { cs: 'vpos' });
      pipes.set('vpos', await device.createRenderPipelineAsync({ layout: lay(bglV), vertex: { module: vm, entryPoint: 'vs', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
        fragment: { module: vm, entryPoint: 'fsPos', targets: [{ format: 'rgba32float' }] }, primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' } }));
    } catch (e) { for (const n of Object.keys(CS_VARIANTS)) failed.set(n, 'vpos pass: ' + String(e?.message ?? e).slice(0, 140)); }
    try { pipes.set('diff', await device.createComputePipelineAsync({ layout: lay(bglD), compute: { module: mod(csDiffWgsl(), { cs: 'diff' }), entryPoint: 'main' } })); } catch (e) { for (const n of Object.keys(CS_VARIANTS)) failed.set(n, 'diff: ' + String(e?.message ?? e).slice(0, 140)); }
    const names = Object.keys(CS_VARIANTS).filter(n => !(CS_VARIANTS[n].sg && !sgOk));
    // csHit and csWave share their programs: the first makes them, the second finds them
    await Promise.all([...names.filter(n => CS_VARIANTS[n].mode !== 'wave').map(compile), (async () => { for (const n of names.filter(x => CS_VARIANTS[x].mode === 'wave')) await compile(n); })()]);
  };

  // ---- resources (made for the size of the low pass's target; the lists for the largest eye region) ----
  const R = { w: 0, h: 0, vpos: null, color: null, depth: null, cap: 0, cnt: null, hits: null, cont: [null, null], args: null, au: [], cpBufs: [], uBufs: [], vBind: [], dBufs: [], cntD: null, rbD: null, rbCnt: [], pending: 0 };
  const kill = x => { try { x?.destroy(); } catch { /* gone */ } };
  const ensureTargets = (w, h) => {
    if (R.vpos && R.w >= w && R.h >= h) return; // only ever grows (a smaller region draws into the corner of the held image)
    w = Math.max(w, R.w); h = Math.max(h, R.h);
    kill(R.vpos); kill(R.color); kill(R.depth);
    R.vpos = device.createTexture({ size: [w, h, 1], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const mk = () => device.createTexture({ size: [w, h, 1], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    R.color = mk(); R.depth = mk(); R.w = w; R.h = h;
  };
  const buf = (size, usage) => device.createBuffer({ size: Math.max(16, size), usage });
  const ensureLists = cap => {
    if (R.cap >= cap && R.cnt) return;
    kill(R.hits); kill(R.cont[0]); kill(R.cont[1]);
    const S = GPUBufferUsage.STORAGE;
    R.hits = buf(cap * CS.hitStride * 4, S); R.cont = [buf(cap * CS.contStride * 4, S), buf(cap * CS.contStride * 4, S)]; R.cap = cap;
    R.cnt ||= buf(32, S | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    R.args ||= buf(8 * 16, S | GPUBufferUsage.INDIRECT);
    if (!R.rbCnt.length) R.rbCnt = [0, 1].map(() => buf(32, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ));
    for (let i = 0; i < 8; i++) if (!R.au[i]) R.au[i] = buf(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  };
  const ensureDiff = () => {
    R.cntD ||= device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }); // [differing px, the run's number: written by the queue, copied back with the count, so a submit that failed leaves the old number and the sample is dropped]
    R.rbD ||= device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    for (let i = 0; i < 2; i++) R.dBufs[i] ||= buf(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  };
  const ubuf = (arr, i, size, usage) => (arr[i] ||= buf(size, usage));
  const UU = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

  // the per-eye numbers of one dispatch (CS_FIELDS), from the eye's uniform words (the display's own: s.ab[i]) and the pass's region
  const cpData = (words, e, stop, wave, cap) => {
    const f = new Float32Array(words.buffer, words.byteOffset, words.length), ab = new ArrayBuffer(CL.byteSize), cf = new Float32Array(ab), ci = new Int32Array(ab);
    const mvp = Array.from(f.subarray(0, 16)), inv = invert4(mvp);
    if (!inv) return null;
    cf.set(inv, fieldC('inv').offset / 4);
    const o = fieldU('origin').offset / 4; cf.set(f.subarray(o, o + 3), fieldC('org').offset / 4);
    ci[fieldC('vx').offset / 4] = e.vx; ci[fieldC('vy').offset / 4] = e.vy; ci[fieldC('vw').offset / 4] = e.vw; ci[fieldC('vh').offset / 4] = e.vh;
    ci[fieldC('stop').offset / 4] = stop; ci[fieldC('cap').offset / 4] = cap; ci[fieldC('wave').offset / 4] = wave;
    return ab;
  };

  const bindGroup0 = (res, ub) => {
    const t = res.tex, v = x => x.createView({ dimension: '3d' });
    return device.createBindGroup({ layout: bgl0, entries: [
      { binding: 0, resource: { buffer: ub } },
      { binding: 1, resource: v(t[0]) }, { binding: 2, resource: v(t[1]) }, { binding: 3, resource: v(t[2]) }, { binding: 4, resource: v(t[3]) }, { binding: 5, resource: v(t[4]) }, { binding: 6, resource: v(t[5]) },
      { binding: 7, resource: res.linear }, { binding: 8, resource: res.editNearest ? res.nearest : res.linear }, { binding: 9, resource: t[6].createView({ dimension: '2d' }) },
    ] });
  };

  // one shadow pass of the compute variant spec.name for the record `rec` closed by markFrame. s = the breakdown's snapshot of the frame's low pass, b = the breakdown's state (timer slots, query set, callback).
  // true = submitted; false = not now (no free timer slots / a read-back of the last one still pending); null = no program for this variant (still compiling, failed, not supported here)
  let runSeq = 0;
  const failSent = new Set();
  const sendFail = (b, name, msg) => { if (failSent.has(name)) return; failSent.add(name); try { console.warn('WebGPU compute variant ' + name + ': ' + msg); } catch { /* no console */ } try { b.onShadow?.('csFail:' + name, 0, 0); } catch { /* the page's callback */ } };
  const run = (rec, spec, s, b) => {
    const name = spec.name, v = CS_VARIANTS[name];
    if (!v) return null;
    if (!started) { start(); return null; }
    if (failed.has(name)) { sendFail(b, name, failed.get(name)); return null; }
    if (v.sg && !sgOk) return null;
    if (s.variant.events || !s.px || !s.res || !ready(name)) return null;
    const words0 = s.ab[0], at = n => words0[fieldU(n).offset / 4];
    if (at('diag') !== 0 || at('jumpOn') !== 1) return null; // the march of the display (the diagnostic passes and a session without jumps are not compared)
    const n = Math.min(2, s.eyes.length); if (!n) return null;
    const wave = v.mode === 'wave';
    let cap = 1; for (let i = 0; i < n; i++) cap = Math.max(cap, s.eyes[i].vw * s.eyes[i].vh);
    if (wave && cap * CS.hitStride * 4 > CS.listBytesMax) return null;
    if (R.pending > 0) return false;
    const sl = [b.slots.findIndex(x => !x.busy)]; sl.push(b.slots.findIndex((x, i) => !x.busy && i !== sl[0]));
    if (sl[0] < 0 || sl[1] < 0) return false;
    const cps = [];
    const waves = v.mode === 'wave' ? (v.waves ?? CS.wave.waves) : 1;
    for (let i = 0; i < n; i++) {
      const e = s.eyes[i]; cps[i] = [];
      for (let w = 0; w < waves; w++) { const d = cpData(s.ab[i], e, w < waves - 1 ? (w + 1) * CS.wave.n : 4096, w, cap); if (!d) return null; cps[i].push(d); }
    }
    const seq = ++runSeq, guarded = typeof device.pushErrorScope === 'function';
    if (guarded) { device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory'); } // a failed submit or an allocation that did not fit must not read as a clean comparison
    let total = 0;
    try {
    let cw = 1, ch = 1; for (let i = 0; i < n; i++) { cw = Math.max(cw, s.eyes[i].vx + s.eyes[i].vw); ch = Math.max(ch, s.eyes[i].vy + s.eyes[i].vh); }
    ensureTargets(Math.min(s.target.w, cw), Math.min(s.target.h, ch)); ensureDiff(); if (wave) ensureLists(cap); device.queue.writeBuffer(R.cntD, 4, new Uint32Array([seq])); // only the part of the target the eyes' regions cover (the rgba32float image of vPos is 16 bytes a pixel)
    const enc = device.createCommandEncoder();
    // (1) the fragment shader's inputs: vPos + depth by the display's vertex stage and rasteriser (timed apart)
    for (let i = 0; i < n; i++) {
      device.queue.writeBuffer(ubuf(R.uBufs, i, L.byteSize, UU), 0, s.ab[i]);
      R.vBind[i] = device.createBindGroup({ layout: bglV, entries: [{ binding: 0, resource: { buffer: R.uBufs[i] } }] });
    }
    const vp = enc.beginRenderPass({ timestampWrites: { querySet: b.qs, beginningOfPassWriteIndex: 2 * sl[0], endOfPassWriteIndex: 2 * sl[0] + 1 }, colorAttachments: [{ view: R.vpos.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: -1 } }] });
    vp.setPipeline(pipes.get('vpos')); vp.setVertexBuffer(0, boxBuf);
    s.eyes.slice(0, n).forEach((e, i) => { vp.setBindGroup(0, R.vBind[i]); vp.setViewport(e.vx, e.vy, e.vw, e.vh, 0, 1); for (const sc of e.scissors) { vp.setScissorRect(sc[0], sc[1], sc[2], sc[3]); vp.draw(36); } });
    vp.end();
    // (2) the compute work (timed: first pass's beginning to the last pass's end)
    const vposView = R.vpos.createView(), cView = R.color.createView(), dView = R.depth.createView();
    const passes = []; // [eye, fn(pass)] in order
    const g0 = [], g1 = [];
    for (let i = 0; i < n; i++) {
      g0[i] = bindGroup0(s.res, R.uBufs[i]); g1[i] = [];
      for (let w = 0; w < waves; w++) {
        const cpb = ubuf(R.cpBufs, i * 8 + w, CL.byteSize, UU); device.queue.writeBuffer(cpb, 0, cps[i][w]);
        g1[i][w] = device.createBindGroup({ layout: bglC, entries: [
          { binding: CS_BINDINGS.vpos, resource: vposView }, { binding: CS_BINDINGS.outColor, resource: cView }, { binding: CS_BINDINGS.outDepth, resource: dView }, { binding: CS_BINDINGS.params, resource: { buffer: cpb } },
          { binding: CS_BINDINGS.cnt, resource: { buffer: wave ? R.cnt : dummyBuf(0) } }, { binding: CS_BINDINGS.hits, resource: { buffer: wave ? R.hits : dummyBuf(1) } },
          { binding: CS_BINDINGS.contOut, resource: { buffer: wave ? R.cont[w & 1] : dummyBuf(2) } }, { binding: CS_BINDINGS.contIn, resource: { buffer: wave ? R.cont[(w + 1) & 1] : dummyBuf(3) } },
        ] });
      }
    }
    if (wave) {
      const cntIdx = w => w, slotOf = w => w; // the count that feeds wave w >= 1 is the output count of wave w - 1 = cnt[w]; its arguments slot = w
      const au = (slot, src) => { device.queue.writeBuffer(R.au[slot], 0, new Uint32Array([src, slot, cap, 0])); return device.createBindGroup({ layout: bglA, entries: [{ binding: 0, resource: { buffer: R.au[slot] } }, { binding: 1, resource: { buffer: R.cnt } }, { binding: 2, resource: { buffer: R.args } }] }); };
      const gA = []; for (let w = 1; w < waves; w++) gA[w] = au(slotOf(w), cntIdx(w)); const gH = au(ARGS_SLOT_HITS, 0);
      for (let i = 0; i < n; i++) {
        const e = s.eyes[i];
        passes.push([i, pass => {
          pass.setPipeline(pipes.get('march:csMarchPix')); pass.setBindGroup(0, g0[i]); pass.setBindGroup(1, g1[i][0]); pass.dispatchWorkgroups(Math.ceil(e.vw / 8), Math.ceil(e.vh / 8));
          for (let w = 1; w < waves; w++) {
            pass.setPipeline(pipes.get('args')); pass.setBindGroup(0, gA[w]); pass.dispatchWorkgroups(1);
            pass.setPipeline(pipes.get('march:csMarchList')); pass.setBindGroup(0, g0[i]); pass.setBindGroup(1, g1[i][w]); pass.dispatchWorkgroupsIndirect(R.args, slotOf(w) * 16);
          }
          pass.setPipeline(pipes.get('args')); pass.setBindGroup(0, gH); pass.dispatchWorkgroups(1);
          pass.setPipeline(pipes.get('shade:csShadeList')); pass.setBindGroup(0, g0[i]); pass.setBindGroup(1, g1[i][0]); pass.dispatchWorkgroupsIndirect(R.args, ARGS_SLOT_HITS * 16);
        }]);
      }
    } else {
      const key = v.mode === 'full' ? 'full:csMain' : (v.mode + (v.sg ? 'Sg' : '')) + ':csMain';
      for (let i = 0; i < n; i++) { const e = s.eyes[i]; passes.push([i, pass => { pass.setPipeline(pipes.get(key)); pass.setBindGroup(0, g0[i]); pass.setBindGroup(1, g1[i][0]); pass.dispatchWorkgroups(Math.ceil(e.vw / 8), Math.ceil(e.vh / 8)); }]); }
    }
    passes.forEach(([i, fn], k) => {
      if (wave) { enc.clearBuffer(R.cnt); }
      const tsw = {}; if (k === 0) { tsw.querySet = b.qs; tsw.beginningOfPassWriteIndex = 2 * sl[1]; } if (k === passes.length - 1) { tsw.querySet = b.qs; tsw.endOfPassWriteIndex = 2 * sl[1] + 1; }
      const pass = enc.beginComputePass(tsw.querySet ? { timestampWrites: tsw } : {});
      fn(pass); pass.end();
      if (wave) enc.copyBufferToBuffer(R.cnt, 0, R.rbCnt[i], 0, 32);
    });
    // (3) the comparison with the display's own image (colour + packed depth), inside each eye's region
    const gD = [];
    for (let i = 0; i < n; i++) {
      const e = s.eyes[i]; device.queue.writeBuffer(R.dBufs[i], 0, new Uint32Array([e.vx, e.vy, e.vx + e.vw, e.vy + e.vh]));
      gD[i] = device.createBindGroup({ layout: bglD, entries: [
        { binding: CS_DIFF_BINDINGS.colorA, resource: s.target.color.createView() }, { binding: CS_DIFF_BINDINGS.depthA, resource: s.target.depth.createView() }, { binding: CS_DIFF_BINDINGS.colorB, resource: cView }, { binding: CS_DIFF_BINDINGS.depthB, resource: dView },
        { binding: CS_DIFF_BINDINGS.count, resource: { buffer: R.cntD } }, { binding: CS_DIFF_BINDINGS.rect, resource: { buffer: R.dBufs[i] } },
      ] });
    }
    enc.clearBuffer(R.cntD, 0, 4);
    const dp = enc.beginComputePass(); dp.setPipeline(pipes.get('diff'));
    for (let i = 0; i < n; i++) { const e = s.eyes[i]; dp.setBindGroup(0, gD[i]); dp.dispatchWorkgroups(Math.ceil(e.vw / 8), Math.ceil(e.vh / 8)); total += e.vw * e.vh; }
    dp.end(); enc.copyBufferToBuffer(R.cntD, 0, R.rbD, 0, 8);
    for (const k of [0, 1]) { enc.resolveQuerySet(b.qs, 2 * sl[k], 2, b.resolve, 256 * sl[k]); enc.copyBufferToBuffer(b.resolve, 256 * sl[k], b.slots[sl[k]].buf, 0, 16); b.slots[sl[k]].busy = true; }
    device.queue.submit([enc.finish()]);
    } catch (e) { if (guarded) { device.popErrorScope(); device.popErrorScope(); } for (const k of [0, 1]) b.slots[sl[k]].busy = false; sendFail(b, name, 'threw: ' + String(e?.message ?? e).slice(0, 140)); return null; }
    rec.shadowed = true; R.pending = 1;
    const popP = guarded ? Promise.all([device.popErrorScope(), device.popErrorScope()]) : Promise.resolve([null, null]);
    // the read-backs (the two timers, the count + number, the lists' counts) are delivered together once the error scopes have answered: a pass that did not run gives no sample of any kind
    const slotRead = k => b.slots[sl[k]].buf.mapAsync(GPUMapMode.READ).then(() => { const a = new BigUint64Array(b.slots[sl[k]].buf.getMappedRange().slice(0)); b.slots[sl[k]].buf.unmap(); b.slots[sl[k]].busy = false; return a[0] !== 0n && a[1] >= a[0] ? Number(a[1] - a[0]) / 1e6 : -1; }, () => { b.slots[sl[k]].busy = false; return -1; });
    const p = { name, shadow: null, low: rec.lowMs, done: false, cb: b.onShadow };
    (rec.pairs ||= []).push(p);
    const finPair = q => { if (q.done || q.shadow === null || q.low === null) return; q.done = true; if (q.shadow >= 0 && q.low > 0) { try { q.cb?.(q.name, q.shadow, q.low); } catch { /* the page's callback */ } } };
    const diffRead = R.rbD.mapAsync(GPUMapMode.READ).then(() => { const c = new Uint32Array(R.rbD.getMappedRange().slice(0)); R.rbD.unmap(); return [c[0], c[1]]; }, () => [0, 0]);
    const cntReads = wave ? [0, 1].slice(0, n).map(i => R.rbCnt[i].mapAsync(GPUMapMode.READ).then(() => { const c = new Uint32Array(R.rbCnt[i].getMappedRange().slice(0)); R.rbCnt[i].unmap(); return c; }, () => new Uint32Array(8))) : [];
    Promise.all([popP, slotRead(0), slotRead(1), diffRead, ...cntReads]).then(([errs, vMs, sMs, dres, ...cnts]) => {
      R.pending = 0;
      const err = (errs || []).find(Boolean);
      if (err || dres[1] !== seq || !(sMs >= 0 && sMs < 1000)) { p.shadow = -1; finPair(p); sendFail(b, name, err ? 'GPU error: ' + String(err.message ?? err).slice(0, 140) : 'the pass did not run (stale read-back)'); return; }
      const call = (k, a, c) => { try { b.onShadow?.(k, a, c); } catch { /* the page's callback */ } };
      if (vMs >= 0 && vMs < 1000) call('csVposMs', vMs, 1);
      p.shadow = sMs; finPair(p);
      call('diff:' + name, dres[0], total);
      if (wave) call('csStat:' + name, cnts.reduce((x, c) => x + c[0], 0), cnts.reduce((x, c) => x + c[7], 0));
    }, () => { R.pending = 0; });
    if (p.low !== null) finPair(p);
    return true;
  };
  const dummies = [];
  const dummyBuf = k => dummies[k] ||= buf(16, GPUBufferUsage.STORAGE); // four distinct buffers: one buffer bound as writable storage twice in a dispatch is a usage conflict
  const dispose = () => {
    kill(R.vpos); kill(R.color); kill(R.depth); kill(R.hits); kill(R.cont[0]); kill(R.cont[1]); kill(R.cnt); kill(R.args); kill(R.cntD); kill(R.rbD); kill(boxBuf); dummies.forEach(kill);
    R.rbCnt.forEach(kill); R.au.forEach(kill); R.cpBufs.forEach(kill); R.uBufs.forEach(kill); R.dBufs.forEach(kill);
  };
  return { run, dispose, ready, failed: () => [...failed].map(([k, m]) => k + ': ' + m), sgOk };
}
