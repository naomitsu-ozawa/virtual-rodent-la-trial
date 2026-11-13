import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { Worker as NodeWorker } from 'node:worker_threads';
import { PART_FIELD, partFieldBoxOf, partFieldOf, partFieldHaloOf, partFieldReach, partGroupLabelOf, partGroupSeamOf, partFieldNeedsOwn, partFieldSet, partGroupFieldsOf, partSetWorkerSource, runPartSet, createPartSetRunner, runPartGroup, partComputeWorkerSource, partFieldJointGroups, partFieldNearOf } from '../../docs/vr-part-view.js';

const W = 26, H = 16, D = 18, n = W * H * D;
const blob = (inside, lo = [0, 0, 0]) => { const c = new Uint8Array(n); for (let z = 1; z < D - 1; z++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (inside(x, y, z)) c[x + W * (y + H * z)] = 1; return { data: partFieldOf(c, [W, H, D], PART_FIELD), lo, size: [W, H, D], mask: 1, kind: 'region' }; };
const localRun = async (lab, size, nn, opt) => partGroupFieldsOf(lab, size, nn, opt);
const same = (a, b) => expect(Array.from(a)).toEqual(Array.from(b));
const view = x => ({ ...x, data: Array.from(x.data) });
// what the worker answers to one message, with the context a worker has (postMessage / onmessage, the typed arrays) and nothing else
const viaWorkerText = async (fields, plainOnly = false) => {
  const out = []; const ctx = { postMessage: m => out.push(m), console };
  vm.runInNewContext(partSetWorkerSource(), ctx);
  await ctx.onmessage({ data: { fields: fields.map(f => ({ bytes: f.data.slice().buffer, codes: false, lo: f.lo, size: f.size, mask: f.mask, kind: f.kind })), opt: PART_FIELD, plainOnly } });
  expect(out.length).toBe(1); expect(out[0].message).toBeUndefined(); expect(out[0].ok).toBe(true);
  return out[0].set;
};
describe('partFieldSet on a worker (runPartSet)', () => {
  const A = blob((x, y, z) => x < 12 && z < 12), B = blob((x, y, z) => x >= 12 && z < 12), C = blob((x, y, z) => z >= 14 && y < 6), lone = { ...C, lo: [60, 0, 0] };
  it('the worker text runs alone and answers what partFieldSet answers (parts that touch, a part alone, one part)', async () => {
    for (const fields of [[A, B], [A, B, lone], [A], [A, lone]]) {
      const want = await partFieldSet(fields, localRun), got = await viaWorkerText(fields);
      expect(got.plain).toBe(want.plain); expect(got.merged).toBe(want.merged);
      const slot = (x, f) => (x.same != null ? f[x.same].data : x.data);
      same(slot(got.body, fields), want.body.data); expect(got.body.C).toBe(want.body.C); expect(got.body.lo).toEqual(want.body.lo); expect(got.body.size).toEqual(want.body.size); expect(got.body.a).toEqual(want.body.a); expect(got.body.b).toEqual(want.body.b);
      expect(got.parts.length).toBe(want.parts.length);
      got.parts.forEach((p, i) => { same(slot(p, fields), want.parts[i].data); expect(p.C).toBe(want.parts[i].C); expect(p.a).toEqual(want.parts[i].a); expect(p.b).toEqual(want.parts[i].b); expect(p.same != null).toBe(want.parts[i].data === fields[i].data); });
    }
    expect(await (async () => { const out = []; const ctx = { postMessage: m => out.push(m) }; vm.runInNewContext(partSetWorkerSource(), ctx); await ctx.onmessage({ data: { fields: [], opt: PART_FIELD } }); return out[0]; })()).toEqual({ ok: true, set: null });
  }, 60000);
  it('plainOnly: every group unsmoothed and counted, as a failing group run is', async () => {
    const got = await viaWorkerText([A, B], true), want = await partFieldSet([A, B], async () => { throw new Error('x'); });
    expect(got.plain).toBe(1); expect(got.plain).toBe(want.plain);
    same(got.body.data, want.body.data); got.parts.forEach((p, i) => same(p.data, want.parts[i].data));
  }, 60000);
  it('runPartSet without a Worker is partFieldSet; a part alone keeps its own array (no copy)', async () => {
    const got = await runPartSet([A, B, lone]), want = await partFieldSet([A, B, lone], localRun);
    same(got.body.data, want.body.data); got.parts.forEach((p, i) => same(p.data, want.parts[i].data)); expect(got.parts[2].data).toBe(lone.data);
    expect(await runPartSet([])).toBe(null);
  }, 60000);
});

// D: a part in a group on every channel it has is cut by the group's joint field and seams, so its OWN smoothing is not read (the labels are its bytes >= 128: the unsmoothed field, 255 on the part and 0 elsewhere, has the same). Only a
// part alone on some channel is smoothed, and that when it is asked for (a part given as plain: true), with the bytes handed back in `own`
describe('a part in a group does not need its own smoothing', () => {
  const A = blob((x, y, z) => x < 12 && z < 12), B = blob((x, y, z) => x >= 12 && z < 12), lone = { ...blob((x, y, z) => z >= 14 && y < 6), lo: [60, 0, 0] };
  const plainOf = f => ({ ...f, data: f.data.map(v => (v >= 128 ? 255 : 0)), plain: true });
  const pick = set => ({ body: Array.from(set.body.data), parts: set.parts.map(p => ({ ...view(p), C: p.C })) });
  it('partFieldNeedsOwn: true for a part alone on a channel, false for those of a group; another slot is another channel', () => {
    expect(partFieldNeedsOwn([A, B, lone])).toEqual([false, false, true]);
    expect(partFieldNeedsOwn([A])).toEqual([true]);
    expect(partFieldNeedsOwn([A, { ...B, mask: 2 }])).toEqual([true, true]); // different slots: nothing shared
    expect(partFieldNeedsOwn([A, { ...B, mask: 3 }])).toEqual([false, true]); // A: slot 0 only, in a group with B there; B has slot 1 too, alone on it
  });
  it('parts of a group given as unsmoothed bytes: the same set as with their smoothed fields', async () => {
    const want = await partFieldSet([A, B, lone], localRun), got = await partFieldSet([plainOf(A), plainOf(B), lone], localRun);
    expect(pick(got)).toEqual(pick(want)); expect(got.own).toEqual([]);
    const gw = await viaWorkerText([A, B, lone]);
    expect(gw.own).toEqual([]);
  }, 60000);
  it('a part alone given as unsmoothed bytes is smoothed (and handed back); put it next to another and it is not', async () => {
    const want = await partFieldSet([A, lone], localRun), got = await partFieldSet([plainOf(A), plainOf(lone)], localRun);
    expect(pick(got)).toEqual(pick(want));
    expect(got.own.map(o => o.p)).toEqual([0, 1]); same(got.own[0].data, A.data); same(got.own[1].data, lone.data);
    const viaRun = await runPartSet([{ codes: A.data.map(v => (v >= 128 ? 1 : 0)), lo: A.lo, size: A.size, mask: 1, kind: 'region' }, lone]);
    same(viaRun.parts[0].data, A.data); expect(viaRun.own.map(o => o.p)).toEqual([0]);
  }, 60000);
  it('a part alone whose own smoothing fails keeps the unsmoothed bytes (the cut as its voxels, counted), is not handed back, and the set is made', async () => {
    const boom = { joint: async () => { throw new Error('x'); }, label: async () => { throw new Error('x'); }, smooth: async () => { throw new Error('out of memory'); } };
    const got = await partFieldSet([plainOf(A), plainOf(lone)], boom);
    expect(got.plain).toBe(2); expect(got.own).toEqual([]); same(got.parts[0].data, plainOf(A).data); same(got.parts[1].data, plainOf(lone).data);
    expect(got.body.C).toBe(1);
  });
  it('a group that could not be made (unsmoothed): the members given as unsmoothed bytes are smoothed, so the larger byte is that of their own smoothed fields', async () => {
    const fail = async () => { throw new Error('worker out of memory'); };
    const want = await partFieldSet([A, B], fail), got = await partFieldSet([plainOf(A), plainOf(B)], fail);
    expect(got.plain).toBe(1); expect(pick(got)).toEqual(pick(want)); expect(got.own.map(o => o.p).sort()).toEqual([0, 1]);
  }, 60000);
});

// C: the tasks of a group run on a pool of workers at once. Real threads here (a browser-like Worker / Blob / URL.createObjectURL over node:worker_threads), so the worker texts and the messages between the three kinds of thread are the real ones
const withThreads = async (fn, hook = null) => {
  const blobs = new Map(); let n = 0; const W0 = globalThis.Worker, B0 = globalThis.Blob, c0 = URL.createObjectURL, r0 = URL.revokeObjectURL, made = [];
  const prelude = "const {parentPort}=require('node:worker_threads');globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);parentPort.on('message',d=>{if(globalThis.onmessage)globalThis.onmessage({data:d})});\n";
  globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  URL.createObjectURL = b => { const id = 'blob:test/' + (++n); blobs.set(id, b.text); return id; }; URL.revokeObjectURL = id => { blobs.delete(id); };
  globalThis.Worker = class {
    constructor(url) {
      const src = blobs.get(url), role = src.includes('partFieldSet') ? 'set' : 'task'; made.push(role);
      this.w = new NodeWorker(prelude + (hook ? hook(src, role) : src), { eval: true });
      this.w.on('message', d => this.onmessage && this.onmessage({ data: d })); this.w.on('error', e => this.onerror && this.onerror({ message: e.message, preventDefault() {} }));
    }
    postMessage(m, t) { this.w.postMessage(m, t); }
    terminate() { this.w.terminate(); }
  };
  try { return await fn(made); } finally { globalThis.Worker = W0; globalThis.Blob = B0; URL.createObjectURL = c0; URL.revokeObjectURL = r0; }
};
describe('runPartSet on real threads: the tasks of a group on a pool', () => {
  const A = blob((x, y, z) => x < 12 && z < 12), B = blob((x, y, z) => x >= 12 && z < 12), Cc = blob((x, y, z) => z >= 12 && y < 8), lone = { ...blob((x, y, z) => z >= 14 && y < 6), lo: [60, 0, 0] };
  const pick = set => ({ body: Array.from(set.body.data), C: set.body.C, parts: set.parts.map(p => ({ ...view(p), C: p.C, sig: undefined })), merged: set.merged, plain: set.plain });
  it('the same bytes as on this thread (touching parts: J and the seams in parallel; a part alone given as codes: smoothed on the pool)', async () => {
    const codesOf = f => ({ codes: f.data.map(v => (v >= 128 ? 1 : 0)), lo: f.lo, size: f.size, mask: f.mask, kind: f.kind });
    const want = await partFieldSet([A, B, Cc, lone], localRun);
    await withThreads(async made => {
      const got = await runPartSet([A, B, Cc, codesOf(lone)]);
      expect(pick(got)).toEqual(pick(want)); expect(got.own.map(o => o.p)).toEqual([3]); same(got.own[0].data, lone.data);
      expect(made.filter(r => r === 'set').length).toBe(1); expect(made.filter(r => r === 'task').length).toBeGreaterThan(1); // the pool had several workers
    });
  }, 120000);
  it('a task that fails fails its group only: that group is made unsmoothed (counted), the answer still comes; a set worker that dies is retried by the same path (smoothed, not counted)', async () => {
    const hookTask = (src, role) => (role === 'task' ? 'onmessage=e=>postMessage({ok:false,id:e.data.id,message:"out of memory"});' : src);
    await withThreads(async () => {
      const got = await runPartSet([A, B, lone]), want = await partFieldSet([A, B, lone], async () => { throw new Error('x'); });
      expect(got.plain).toBe(1); expect(pick(got)).toEqual(pick(want));
    }, hookTask);
    const hookSet = (src, role) => (role === 'set' && !globalThis.__setDied ? (globalThis.__setDied = true, 'throw new Error("boom")') : src);
    const warn = console.warn; console.warn = () => {};
    try { await withThreads(async () => { const got = await runPartSet([A, B]); expect(got.plain).toBe(0); }, hookSet); } finally { console.warn = warn; delete globalThis.__setDied; }
  }, 120000);
});

// B: a group seen before (the same labels: the same parts in the same order, the same boxes) is not made again, and a task whose input did not change is not made again either (the joint field, the labels of a seam, a smoothing: each one's key is its
// input bytes); a part whose bytes did not change has the same sig (its texture is not uploaded again). The memory is bounded and is let go on clear()
describe('the memory of the answers of the tasks (createPartSetRunner)', () => {
  const A = blob((x, y, z) => x < 12 && z < 12), B = blob((x, y, z) => x >= 12 && z < 12), Cc = blob((x, y, z) => z >= 12 && y < 8), lone = { ...blob((x, y, z) => z >= 14 && y < 6), lo: [60, 0, 0] };
  it('this thread: the same group again is all hits with the same bytes; another group makes tasks; back to the first all hits; sigs follow the bytes', async () => {
    const r = createPartSetRunner(PART_FIELD, { cacheBytes: 50e6 });
    const s1 = await r.run([A, B]); expect(s1.cache.miss).toBeGreaterThan(1); expect(s1.cache.hit).toBe(0);
    const s2 = await r.run([A, B, lone]); expect(s2.cache.hit).toBeGreaterThan(1); expect(s2.cache.miss).toBe(0); // a part far away: the group of A and B is as it was
    expect(s2.parts[0].sig).toBe(s1.parts[0].sig); expect(s2.parts[1].sig).toBe(s1.parts[1].sig); expect(s2.body.sig).not.toBe(s1.body.sig);
    const s3 = await r.run([A, B, Cc]); expect(s3.cache.miss).toBeGreaterThan(0); expect(s3.parts[0].sig).not.toBe(s1.parts[0].sig); // the seams changed with the third part
    const s4 = await r.run([A, B]); expect(s4.cache.miss).toBe(0); expect(s4.cache.hit).toBeGreaterThan(1); expect(s4.body.sig).toBe(s1.body.sig);
    same(s4.body.data, s1.body.data); s4.parts.forEach((p, i) => same(p.data, s1.parts[i].data));
    expect(s4.cache.entries).toBeGreaterThan(2); r.clear(); const s5 = await r.run([A, B]); expect(s5.cache.hit).toBe(0); expect(s5.cache.miss).toBeGreaterThan(1);
    r.dispose(); await expect(r.run([A])).rejects.toThrow(/closed/);
  }, 120000);
  it('real threads: dispose while a set is being made rejects it (nobody waits for ever)', async () => {
    const silent = (src, role) => (role === 'task' ? 'onmessage=()=>{};' : src); // the pool's workers never answer: the set is being made until dispose
    await withThreads(async made => { const r = createPartSetRunner(PART_FIELD, {}), p = r.run([A, B]).then(() => "done", e => String(e.message)); await new Promise(res => setTimeout(res, 300)); r.dispose(); expect(await p).toMatch(/closed/); expect(made.filter(x => x === "set").length).toBe(1); }, silent);
  }, 60000);
  it('the memory is bounded: an answer larger than the limit is not kept, the least recently used goes first', async () => {
    const tiny = createPartSetRunner(PART_FIELD, { cacheBytes: 10 }); await tiny.run([A, B]); const t2 = await tiny.run([A, B]); expect(t2.cache.hit).toBe(0); expect(t2.cache.entries).toBe(0); tiny.dispose();
    const cap = 2 * 26 * 16 * 18 + 1, small = createPartSetRunner(PART_FIELD, { cacheBytes: cap }); // two arrays of the group's box at most
    await small.run([A, B]); await small.run([A, B, Cc]); const a = await small.run([A, B]); expect(a.cache.miss).toBeGreaterThan(0); expect(a.cache.bytes).toBeLessThanOrEqual(cap); small.dispose();
  }, 120000);
  it('real threads: the worker keeps its memory between sets, clear() lets it go, a dead worker starts over', async () => {
    await withThreads(async made => {
      const r = createPartSetRunner(PART_FIELD, { cacheBytes: 50e6 });
      const s1 = await r.run([A, B, lone]), s2 = await r.run([A, B, Cc, lone]), s3 = await r.run([A, B, lone]);
      expect(s1.cache.miss).toBeGreaterThan(1); expect(s2.cache.miss).toBeGreaterThan(0); expect(s3.cache.hit).toBeGreaterThan(1); expect(s3.cache.miss).toBe(0);
      expect(made.filter(x => x === 'set').length).toBe(1); // one worker for the three sets
      same(s3.body.data, s1.body.data); s3.parts.forEach((p, i) => { same(p.data, s1.parts[i].data); expect(p.sig).toBe(s1.parts[i].sig); });
      r.clear(); const s4 = await r.run([A, B, lone]); expect(s4.cache.miss).toBeGreaterThan(1); expect(s4.cache.hit).toBe(0);
      r.dispose();
    });
  }, 120000);
});

// F: a seam S_k is smoothed over the box of the parts that read it, grown by partFieldHaloOf on every side and cut to the group's box, instead of the group's whole box: inside the box of the readers the bytes are the same
describe('a seam smoothed on a part of the group\'s box (F)', () => {
  const rng = seed => { let st = seed >>> 0; return () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; }; };
  it('partFieldHaloOf: the bytes of a box cut out of a larger one and grown by the halo are those of the larger box (blobs, plates, noise; the cut at the edge and inside)', () => {
    const halo = partFieldHaloOf(PART_FIELD); expect(halo).toBeGreaterThan(8);
    for (let seed = 1; seed <= 6; seed++) {
      const r = rng(seed), w = 50, h = 44, d = 46, codes = new Uint8Array(w * h * d); // blobs + a few thin plates + speckle
      const blobs = Array.from({ length: 6 }, () => [r() * w, r() * h, r() * d, 3 + r() * 9]);
      for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) { let on = blobs.some(b => (x - b[0]) ** 2 + (y - b[1]) ** 2 + (z - b[2]) ** 2 < b[3] ** 2) || (z === 20 && x > 8 && x < 40 && y > 6 && y < 30) || r() < 0.04; if (on) codes[i] = 1; }
      const whole = partFieldOf(codes, [w, h, d], PART_FIELD);
      for (let t = 0; t < 3; t++) {
        const lo = [0, 1, 2].map(a => Math.floor(r() * ([w, h, d][a] - 12))), hi = [0, 1, 2].map(a => Math.min([w, h, d][a], lo[a] + 8 + Math.floor(r() * 20))); // the readers' box
        const g0 = [0, 1, 2].map(a => Math.max(0, lo[a] - halo)), g1 = [0, 1, 2].map(a => Math.min([w, h, d][a], hi[a] + halo)), gs = [0, 1, 2].map(a => g1[a] - g0[a]), sub = new Uint8Array(gs[0] * gs[1] * gs[2]);
        for (let z = 0, i = 0; z < gs[2]; z++) for (let y = 0; y < gs[1]; y++) for (let x = 0; x < gs[0]; x++, i++) sub[i] = codes[g0[0] + x + w * (g0[1] + y + h * (g0[2] + z))];
        const got = partFieldOf(sub, gs, PART_FIELD); let bad = 0;
        for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) for (let x = lo[0]; x < hi[0]; x++) if (got[x - g0[0] + gs[0] * (y - g0[1] + gs[1] * (z - g0[2]))] !== whole[x + w * (y + h * z)]) bad++;
        expect(bad).toBe(0);
      }
    }
  });
  it('partFieldReach: 1 where the voxel or one of its 26 neighbours in the box is > 0', () => {
    const r = rng(7), fw = 9, fh = 7, fd = 6, m = new Uint8Array(fw * fh * fd); for (let i = 0; i < m.length; i++) m[i] = r() < 0.06 ? 3 : 0;
    const got = partFieldReach(m, fw, fh, fd);
    for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) {
      let want = 0; for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy, zz = z + dz; if (xx >= 0 && xx < fw && yy >= 0 && yy < fh && zz >= 0 && zz < fd && m[xx + fw * (yy + fh * zz)] > 0) want = 1; }
      expect(got[i]).toBe(want);
    }
  });
  it('partGroupLabelOf is the voxels of partGroupSeamOf\'s inside (S_k >= 128 exactly there)', () => {
    const W = 20, H = 12, D = 10, lab = new Uint8Array(W * H * D); for (let z = 1; z < D - 1; z++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) lab[x + W * (y + H * z)] = x < 7 ? 1 : x < 13 ? 2 : 3;
    for (const k of [1, 2]) { const m = partGroupLabelOf(lab, [W, H, D], k), sBytes = partGroupSeamOf(lab, [W, H, D], k, PART_FIELD); for (let i = 0; i < m.length; i++) expect(sBytes[i] >= 128).toBe(m[i] === 1); }
  });
  it('the set a group makes on the pool equals the whole-box one: parts in a row (only neighbours read each other\'s seam), several widths', async () => {
    const mk = (x0, x1) => blob((x, y, z) => x >= x0 && x < x1 && z < 14), parts = [mk(1, 8), mk(8, 15), mk(15, 22), mk(22, 25)];
    const want = await partFieldSet(parts, localRun), got = await runPartSet(parts);
    expect(JSON.stringify({ ...view(got.body), sig: 0 })).toBe(JSON.stringify({ ...view(want.body), sig: 0 }));
    got.parts.forEach((p, i) => { same(p.data, want.parts[i].data); expect(p.a).toEqual(want.parts[i].a); expect(p.b).toEqual(want.parts[i].b); });
  }, 120000);
});

// the other worker texts run with real threads too (a helper missing from a text is a ReferenceError only inside the worker, which the callers take for "the worker failed")
describe('every worker text runs', () => {
  const lab = new Uint8Array(12 * 8 * 8); for (let i = 0; i < lab.length; i++) { const x = i % 12, z = (i / 96) | 0; if (z > 0 && z < 7) lab[i] = x < 4 ? 1 : x < 8 ? 2 : 3; }
  it('runPartGroup on a worker gives the bytes of partGroupFieldsOf', async () => {
    const want = partGroupFieldsOf(lab, [12, 8, 8], 3, PART_FIELD);
    await withThreads(async () => { const got = await runPartGroup(lab, [12, 8, 8], 3); same(got.J, want.J); same(got.S[0], want.S[0]); same(got.S[1], want.S[1]); });
  }, 60000);
  it('the pool\'s worker text: J, the labels of a seam, a smoothing', async () => {
    const ctx = {}, out = []; ctx.postMessage = m => out.push(m); vm.runInNewContext(partComputeWorkerSource(), ctx);
    const run = kind => { ctx.onmessage({ data: { id: 1, kind, k: 1, bytes: lab.slice().buffer, size: [12, 8, 8], opt: PART_FIELD } }); return out.pop(); };
    same(new Uint8Array(run('J').bytes), partGroupFieldsOf(lab, [12, 8, 8], 3, PART_FIELD).J);
    same(new Uint8Array(run('L').bytes), partGroupLabelOf(lab, [12, 8, 8], 1));
    same(new Uint8Array(run('F').bytes), partFieldOf(lab, [12, 8, 8], PART_FIELD));
  });
});

describe('the newest part first (G): the older seams are kept, every point still drawn once', () => {
  const triBox = (f, c, x, y, z) => {
    const [w, h, d] = f.size, u = x - f.lo[0] - 0.5, v = y - f.lo[1] - 0.5, s = z - f.lo[2] - 0.5, X = Math.floor(u), Y = Math.floor(v), Z = Math.floor(s), fx = u - X, fy = v - Y, fz = s - Z; let r = 0;
    for (let q = 0; q < 8; q++) { const a = q & 1, b = (q >> 1) & 1, e = (q >> 2) & 1; r += (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (e ? fz : 1 - fz) * f.data[(Math.min(w - 1, Math.max(0, X + a)) + w * (Math.min(h - 1, Math.max(0, Y + b)) + h * Math.min(d - 1, Math.max(0, Z + e)))) * f.C + c]; }
    return r / 255;
  };
  const cutAt = (f, s, x, y, z) => { if ([x, y, z].some((v, k) => v < f.lo[k] || v > f.lo[k] + f.size[k])) return 0; let m = Infinity; for (let c = 0; c < 4; c++) m = Math.min(m, Math.fround(f.a[s][c] * Math.fround(c < f.C ? triBox(f, c, x, y, z) : 0) + f.b[s][c])); return m; };
  const count = (set, cls) => { let pts = 0, none = 0, twice = 0; for (let z = 1.2; z < D - 1.2; z += 0.45) for (let y = 1.2; y < H - 1.2; y += 0.41) for (let x = 1.2; x < W - 1.2; x += 0.43) {
    const u = x - 0.5, v = y - 0.5, w2 = z - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), z0 = Math.floor(w2); let t = 0; for (let q = 0; q < 8; q++) { const a = q & 1, b = (q >> 1) & 1, e = (q >> 2) & 1; t += (a ? u - x0 : 1 - (u - x0)) * (b ? v - y0 : 1 - (v - y0)) * (e ? w2 - z0 : 1 - (w2 - z0)) * cls[Math.min(W - 1, x0 + a) + W * (Math.min(H - 1, y0 + b) + H * Math.min(D - 1, z0 + e))]; }
    if (t < 0.5) continue; pts++; let k = cutAt(set.body, 0, x, y, z) >= 0.5 ? 0 : 1; for (const P of set.parts) if (cutAt(P, 0, x, y, z) >= 0.5) k++; if (k === 0) none++; else if (k > 1) twice++; } return { pts, none, twice }; };
  const bl = [(x, z) => x < 8 && z < 12, (x, z) => x >= 8 && x < 16 && z < 12, (x, z) => x >= 16 && z < 12, (x, z) => x < 12 && z >= 12, (x, z) => x >= 12 && z >= 12].map(f => blob((x, y, z) => f(x, z)));
  const cls = new Uint8Array(n); bl.forEach(b => { for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const X = x - b.lo[0], Y = y - b.lo[1], Z = z - b.lo[2]; if (X >= 0 && Y >= 0 && Z >= 0 && X < b.size[0] && Y < b.size[1] && Z < b.size[2] && b.data[X + b.size[0] * (Y + b.size[1] * Z)] >= 128) cls[x + W * (y + H * z)] = 1; } });
  it('part after part: the answers of the older seams are remembered (hits), and every step draws every point once', async () => {
    const r = createPartSetRunner(PART_FIELD, { cacheBytes: 100e6 }), out = []; let lastMiss = 0, hits = 0;
    for (let i = 0; i < bl.length; i++) {
      out.push({ ...bl[i], id: 'p' + i }); const set = await r.run(out.map(f => ({ ...f }))), c = count(set, cls);
      expect(c.pts).toBeGreaterThan(500); expect(c.none).toBe(0); expect(c.twice).toBe(0);
      if (i >= 2) { expect(set.cache.miss).toBeLessThanOrEqual(lastMiss + 1); hits += set.cache.hit; } if (i >= 1) lastMiss = set.cache.miss;
    }
    expect(hits).toBeGreaterThan(2); // the older seams were taken from the memory
    // put the middle one back: the rest is a set seen before or a new one, still drawn once
    out.splice(2, 1); const set = await r.run(out.map(f => ({ ...f }))), c = count(set, cls); expect(set.parts.length).toBe(4); expect(c.none).toBe(0); expect(c.twice).toBe(0);
    r.dispose();
  }, 180000);
  it('the order is the newest first, unless it asks the parts more channels than the smallest-last order', async () => {
    const r = createPartSetRunner(PART_FIELD, {}), seen = [];
    // parts in a row, added left to right then right to left: each answer is a set the stateless call also makes (draw once), the seams read are of the neighbours only
    const row = [0, 1, 2].map(i => blob((x, y, z) => x >= i * 8 + 1 && x < i * 8 + 9 && z < 12));
    for (const order of [[0, 1, 2], [2, 1, 0]]) { const rr = createPartSetRunner(PART_FIELD, {}); const o = []; for (const i of order) { o.push({ ...row[i], id: 'r' + i }); seen.push(await rr.run(o.map(f => ({ ...f })))); } rr.dispose(); }
    for (const set of seen) for (const p of set.parts) expect(p.C).toBeLessThanOrEqual(4);
    r.dispose();
  }, 120000);
});

// G must not break the 4 channels a part can read: where the newest first asks the parts more seams than the smallest-last order (counted from what each part really reads), the smallest-last order is kept. Histories of detaches of random blobs
// (a mixed-slot part among them) make no more merges than the stateless call at any step (a check over many such histories found steps where the newest first made one more; tools outside the repo)
describe('the newest first does not raise the merges (the 4-channel limit)', () => {
  const build = seed => {
    let st = seed * 2654435761 >>> 0; const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
    const DIM = 52, dims = [DIM, DIM, DIM], seeds = Array.from({ length: 6 }, () => [10 + rnd() * 32, 10 + rnd() * 32, 10 + rnd() * 32, 4 + rnd() * 5]);
    return seeds.map((sd, i) => {
      const ids = new Uint8Array(DIM ** 3), lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
      for (let z = 0, k = 0; z < DIM; z++) for (let y = 0; y < DIM; y++) for (let x = 0; x < DIM; x++, k++) if ((x - sd[0]) ** 2 + (y - sd[1]) ** 2 + (z - sd[2]) ** 2 < sd[3] ** 2) { ids[k] = 1; [x, y, z].forEach((v, a) => { lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); }); }
      const box = partFieldBoxOf({ lo, hi }, dims), [bw, bh, bd] = box.size, codes = new Uint8Array(bw * bh * bd);
      for (let z = 0, o = 0; z < bd; z++) for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++, o++) codes[o] = ids[box.lo[0] + x + DIM * (box.lo[1] + y + DIM * (box.lo[2] + z))];
      return { lo: box.lo, size: box.size, mask: [1, 1, 1, 1, 3, 1][(i + seed) % 6], kind: (i + seed) % 3 === 0 ? 'child' : 'region', data: partFieldOf(codes, box.size, PART_FIELD) };
    });
  };
  it('detach orders of random blobs (mixed slots / kinds): the merges are never above the stateless call\'s, the answers never throw', async () => {
    for (const [seed, order] of [[3, [0, 3, 1, 5, 2]], [3, [3, 0, 5, 2, 1]], [1, [3, 0, 5, 2]], [5, [4, 0, 2, 3, 1, 5]]]) {
      const parts = build(seed), r = createPartSetRunner(PART_FIELD, {}), cur = [];
      for (const i of order) {
        cur.push({ ...parts[i], id: 'b' + i }); const got = await r.run(cur.map(f => ({ ...f }))), want = await runPartSet(cur.map(f => ({ ...f })));
        expect(got.merged).toBeLessThanOrEqual(want.merged);
        got.parts.forEach(p => expect(p.C).toBeLessThanOrEqual(4));
      }
      r.dispose();
    }
  }, 300000);
});

describe('n731 perf: one smoothing per seam, the joint field once, the same bytes from the last joint field', () => {
  const blobsOf = (DIM, seeds) => seeds.map(sd => {
    const ids = new Uint8Array(DIM[0] * DIM[1] * DIM[2]), lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
    for (let z = 0, k = 0; z < DIM[2]; z++) for (let y = 0; y < DIM[1]; y++) for (let x = 0; x < DIM[0]; x++, k++) if ((x - sd[0]) ** 2 + (y - sd[1]) ** 2 + (z - sd[2]) ** 2 < sd[3] ** 2) { ids[k] = 1; [x, y, z].forEach((v, a) => { lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); }); }
    const box = partFieldBoxOf({ lo, hi }, DIM), [bw, bh, bd] = box.size, codes = new Uint8Array(bw * bh * bd);
    for (let z = 0, o = 0; z < bd; z++) for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++, o++) codes[o] = ids[box.lo[0] + x + DIM[0] * (box.lo[1] + y + DIM[1] * (box.lo[2] + z))];
    return { lo: box.lo, size: box.size, mask: 1, kind: 'child', data: partFieldOf(codes, box.size, PART_FIELD) };
  });
  const eqSet = (got, want) => {
    expect(got.merged).toBe(want.merged); expect(got.plain).toBe(want.plain); expect(got.parts.length).toBe(want.parts.length);
    same(got.body.data, want.body.data); expect([got.body.C, got.body.lo, got.body.size, got.body.a, got.body.b]).toEqual([want.body.C, want.body.lo, want.body.size, want.body.a, want.body.b]);
    got.parts.forEach((p, i) => { const w = want.parts[i]; same(p.data, w.data); expect([p.C, p.lo, p.size, p.a, p.b]).toEqual([w.C, w.lo, w.size, w.a, w.b]); });
  };
  it('a chain of parts detached, put back and detached again: the runner (the joint field from the last one, the seams over their voxels) gives the bytes of the whole computation at every step', async () => {
    // spheres along x that touch their neighbours: the group's box grows at one end, or stays and changes inside (then only the box around the change is made again: cache.near)
    const DIM = [200, 30, 30], parts = blobsOf(DIM, Array.from({ length: 12 }, (_, i) => [10 + 15 * i, 15 + (i % 3) - 1, 15 - (i % 2), 7 + (i % 2)]));
    const r = createPartSetRunner(PART_FIELD, {}), st = { rank: new Map(), next: 0 }; let cur = [], near = 0;
    for (const step of ['+0', '+1', '+2', '+3', '+4', '+5', '+6', '+7', '-3', '+3', '-6', '+9', '+8', '+6']) {
      const i = +step.slice(1); cur = step[0] === '+' ? [...cur, i] : cur.filter(x => x !== i);
      const fields = cur.map(k => ({ ...parts[k], id: 'c' + k })), got = await r.run(fields.map(f => ({ ...f }))), want = await partFieldSet(fields.map(f => ({ ...f })), localRun, PART_FIELD, st);
      eqSet(got, want); near += got.cache.near || 0;
    }
    expect(near).toBeGreaterThan(2); // the joint field was made from the last one
    r.dispose();
  }, 300000);
  it('the joint field is asked once for a group, and each seam is smoothed at most once (never for two orders)', async () => {
    // seed 18, the parts in order: at the fifth, made the group twice (the joint field asked twice, 8 seams smoothed for the 4 of the group)
    let st = 18; const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
    const DIM = [52, 52, 52], parts = blobsOf(DIM, Array.from({ length: 7 }, () => [12 + rnd() * 28, 12 + rnd() * 28, 12 + rnd() * 28, 5 + rnd() * 5]));
    for (const order of [[0, 1, 2, 3, 4, 5, 6], [6, 4, 2, 0, 1, 3, 5], [3, 0, 5, 2, 6, 1, 4]]) {
      const state = { rank: new Map(), next: 0 }, cur = [];
      for (const i of order) {
        cur.push({ ...parts[i], id: 'q' + i }); const calls = { J: 0, S: 0 };
        const ops = { joint: async (lab, size, opt) => { calls.J++; return partGroupFieldsOf(lab, size, 2, opt).J; }, label: async (lab, size, k) => partGroupLabelOf(lab, size, k), smooth: async (codes, size, opt, ctx) => { if (!(ctx && ctx.own)) calls.S++; return partFieldOf(codes, size, opt); } };
        const set = await partFieldSet(cur.map(f => ({ ...f })), ops, PART_FIELD, state), want = await runPartSet(cur.map(f => ({ ...f })));
        const groups = partFieldJointGroups(cur, partFieldNearOf(cur, PART_FIELD.pad));
        expect(calls.J).toBeLessThanOrEqual(groups.length); expect(calls.S).toBeLessThanOrEqual(groups.reduce((t, g) => t + g.parts.length - 1, 0));
        expect(set.merged).toBeLessThanOrEqual(want.merged); expect(set.plain).toBe(0);
      }
    }
  }, 300000);
});
