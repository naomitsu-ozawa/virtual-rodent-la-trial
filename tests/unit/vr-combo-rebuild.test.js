import { describe, it, expect } from 'vitest';
import { combineClassificationDistance, combinedAlphaRange } from '../../docs/distance-field.js';
import { createComboRebuild, comboWorkerMain, CHUNK } from '../../docs/vr-combo-rebuild.js';

// the combined classification + distance texture is rebuilt off the frame (worker or main-thread chunks) and uploaded
// in z slices over several frames. The bytes at the end must equal the one-shot combineClassificationDistance result exactly.
const rnd = seed => () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
const scene = (dims, C, chan, seed = 7) => {
  const n = dims[0] * dims[1] * dims[2], r = rnd(seed);
  const cls = { data: Uint8Array.from({ length: n * C }, r), C, chan }, dist = { data: Uint8Array.from({ length: n * C }, r), C, chan };
  return { n, cls, dist };
};
// a fake worker: the real worker code (comboWorkerMain) on a scope whose messages are delivered asynchronously, as by a browser
const fakeWorker = (log = []) => () => {
  const w = { onmessage: null, onerror: null, terminated: false, postMessage(m) { log.push(m.t); const c = structuredClone(m); setTimeout(() => { if (!w.terminated) scope.onmessage({ data: c }); }, 0); }, terminate() { w.terminated = true; } };
  const scope = { postMessage(m) { const c = structuredClone(m); setTimeout(() => { if (!w.terminated) w.onmessage?.({ data: c }); }, 0); } };
  comboWorkerMain(scope);
  return w;
};
const tickUntilDone = async (rb, max = 5000) => { let k = 0; while (rb.busy && k++ < max) { rb.tick(); await new Promise(r => setTimeout(r, 0)); } expect(rb.busy).toBe(false); };
const LAYOUTS = [
  { name: 'two stored segments', C: 2, chan: [0, 1, -1, -1], four: false, masks: [0b11, 0b01, 0b10, 0] },
  { name: 'three stored segments (slot 2 unused)', C: 4, chan: [0, 1, -1, 2], four: false, masks: [0b1011, 0b0010, 0b1001, 0b1111] },
  { name: 'four stored segments', C: 4, chan: [0, 1, 2, 3], four: true, masks: [0b1111, 0b1000, 0b0111, 0b0101] },
];

describe('combinedAlphaRange', () => {
  for (const L of LAYOUTS) it('is the alpha of combineClassificationDistance in any ranges: ' + L.name, () => {
    const { n, cls, dist } = scene([9, 7, 5], L.C, L.chan);
    for (const mask of L.masks) {
      const ref = combineClassificationDistance(cls, dist, mask, null, { four: L.four }), a = new Uint8Array(n);
      for (let i = 0; i < n; i += 37) combinedAlphaRange(dist, L.chan, mask, a, i, Math.min(n, i + 37));
      for (let i = 0; i < n; i++) if (a[i] !== ref[i * 4 + 3]) throw new Error('voxel ' + i + ' mask ' + mask);
    }
  });
});

describe('createComboRebuild', () => {
  const dims = [48, 48, 40], SLICE = 48 * 48 * 4; // more voxels than one CHUNK: the main-thread path needs several frames; uploads of 6 slices
  for (const L of LAYOUTS) for (const via of ['main thread', 'worker']) it('ends byte-identical to the synchronous rebuild, ' + via + ', ' + L.name, async () => {
    const { n, cls, dist } = scene(dims, L.C, L.chan, 11);
    expect(n).toBeGreaterThan(CHUNK);
    const [m0, m1] = L.masks, data = combineClassificationDistance(cls, dist, m0, null, { four: L.four }), uploads = [];
    let clock = 0;
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: m0, upload: (z0, z1) => uploads.push([z0, z1]), makeWorker: via === 'worker' ? fakeWorker() : () => null, now: () => (clock += 5), slabBytes: 20000, uploadBytes: SLICE * 6 });
    rb.request(m1); expect(rb.busy).toBe(true);
    let frames = 0; while (rb.busy && frames < 5000) { rb.tick(); frames++; await new Promise(r => setTimeout(r, 0)); }
    expect(rb.busy).toBe(false);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, m1, null, { four: L.four })))).toBe(0);
    // every slice uploaded once, in order, a few per frame (never the whole texture in one call)
    expect(uploads[0][0]).toBe(0); expect(uploads.at(-1)[1]).toBe(dims[2]); for (let i = 1; i < uploads.length; i++) expect(uploads[i][0]).toBe(uploads[i - 1][1]);
    expect(uploads.length).toBeGreaterThan(1);
    expect(rb.contentMask).toBe(m1); expect(rb.safeMask).toBe(m1);
    if (via === 'main thread') expect(frames).toBeGreaterThan(Math.ceil(n / CHUNK)); // one chunk per frame with this clock
  });

  it('keeps the jumps only while every alpha in the texture is a min over a superset of the shown segments', async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 3), data = combineClassificationDistance(cls, dist, 0b11), uploads = [];
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: (z0, z1) => uploads.push([z0, z1]), makeWorker: () => null, budgetMs: 1e9, uploadBytes: SLICE * 6 });
    expect(rb.jumpsSafe(0b11)).toBe(true);
    rb.request(0b01); // hide segment 1: the old alpha (min over both) is a lower bound for segment 0 alone
    expect(rb.jumpsSafe(0b01)).toBe(true);
    rb.tick(); rb.tick(); // alpha computed, the first slices uploaded: the texture is mixed (0b11 and 0b01)
    expect(uploads.length).toBe(1); expect(rb.contentMask).toBe(-1); expect(rb.safeMask).toBe(0b01);
    rb.request(0b10); // show segment 1 only: slices holding the 0b01 alpha say nothing about segment 1
    expect(rb.jumpsSafe(0b10)).toBe(false); expect(rb.jumpsSafe(0b01)).toBe(true);
    await tickUntilDone(rb);
    expect(rb.jumpsSafe(0b10)).toBe(true); expect(rb.jumpsSafe(0b11)).toBe(false);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b10)))).toBe(0);
  });

  it('a request back to the mask the texture holds cancels the rebuild before anything is written or uploaded', async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 5), data = combineClassificationDistance(cls, dist, 0b11), before = data.slice(), uploads = [], log = [];
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: (z0, z1) => uploads.push([z0, z1]), makeWorker: fakeWorker(log), slabBytes: 1 << 20 });
    rb.request(0b10); rb.tick(); rb.tick(); await new Promise(r => setTimeout(r, 0));
    rb.request(0b11);
    expect(rb.busy).toBe(false); expect(rb.contentMask).toBe(0b11); expect(rb.jumpsSafe(0b11)).toBe(true);
    for (let k = 0; k < 20; k++) { rb.tick(); await new Promise(r => setTimeout(r, 0)); }
    expect(uploads.length).toBe(0); expect(Buffer.compare(Buffer.from(data), Buffer.from(before))).toBe(0);
    expect(log).toContain('cancel');
  });

  it('a newer request replaces the one in flight (worker): only the last mask ends in the texture', async () => {
    const { cls, dist } = scene(dims, 4, [0, 1, 2, 3], 9), data = combineClassificationDistance(cls, dist, 0b1111, null, { four: true });
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b1111, upload: () => {}, makeWorker: fakeWorker(), slabBytes: 50000 });
    rb.request(0b0001); for (let k = 0; k < 3; k++) { rb.tick(); await new Promise(r => setTimeout(r, 0)); }
    rb.request(0b0110); for (let k = 0; k < 2; k++) { rb.tick(); await new Promise(r => setTimeout(r, 0)); }
    rb.request(0b1010);
    await tickUntilDone(rb);
    expect(rb.contentMask).toBe(0b1010);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b1010, null, { four: true })))).toBe(0);
  });

  it('a worker that fails goes on on the main thread', async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 13), data = combineClassificationDistance(cls, dist, 0b01);
    const bad = () => { const w = { onmessage: null, onerror: null, postMessage(m) { if (m.t === 'build') setTimeout(() => w.onerror?.({ message: 'boom' }), 0); }, terminate() {} }; return w; };
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b01, upload: () => {}, makeWorker: bad, budgetMs: 1e9 });
    rb.request(0b11);
    await tickUntilDone(rb);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b11)))).toBe(0);
  });

  it('a worker that never answers (or reports an error) is dropped after workerFrames frames: the job ends on the main thread', async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 19), data = combineClassificationDistance(cls, dist, 0b01);
    const silent = () => ({ onmessage: null, onerror: null, postMessage() {}, terminate() {} });
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b01, upload: () => {}, makeWorker: silent, budgetMs: 1e9, workerFrames: 10 });
    rb.request(0b10);
    await tickUntilDone(rb, 200);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b10)))).toBe(0);
    // the real worker code reports an exception of its async handler as a message
    const posted = [], scope = { postMessage: m => posted.push(m) }; comboWorkerMain(scope);
    await scope.onmessage({ data: { t: 'build', id: 1, mask: 1, chan: [0, -1, -1, -1], chunk: 4 } }); // no init: dist is null
    expect(posted[0]?.t).toBe('error'); expect(posted[0]?.id).toBe(1);
  });

  it('the distance bytes go to the worker in slabs (no single large copy), once per session', async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 17), data = combineClassificationDistance(cls, dist, 0b11), log = [];
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: () => {}, makeWorker: fakeWorker(log), slabBytes: 40000 });
    rb.request(0b01); await tickUntilDone(rb); rb.request(0b10); await tickUntilDone(rb);
    expect(log.filter(t => t === 'init').length).toBe(1);
    expect(log.filter(t => t === 'slab').length).toBe(Math.ceil(dist.data.length / 40000));
    expect(log.filter(t => t === 'build').length).toBe(3); // 0b01 -> 0b10 is a swap: the union 0b11 first
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b10)))).toBe(0);
  });

  // every per-frame step within budgetMs; the worker's alpha buffer is reused
  it('sends distance slabs and writes alpha within the frame budget, at most one upload per frame', async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 23), data = combineClassificationDistance(cls, dist, 0b11), log = [];
    let clock = 0, calls = 0;
    const perTick = [], rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: () => { calls++; }, makeWorker: fakeWorker(log), slabBytes: 10000, uploadBytes: SLICE * 6, budgetMs: 4, now: () => (clock += 0.75) }); // every clock read advances it: two slabs fit in 4 ms, a third would not
    rb.request(0b01);
    while (rb.busy && perTick.length < 5000) { const s0 = log.filter(t => t === 'slab').length, u0 = calls; rb.tick(); perTick.push({ slabs: log.filter(t => t === 'slab').length - s0, uploads: calls - u0 }); await new Promise(r => setTimeout(r, 0)); }
    expect(rb.busy).toBe(false);
    expect(Math.max(...perTick.map(p => p.slabs))).toBeGreaterThan(1); // several slabs while time is left ...
    expect(Math.max(...perTick.map(p => p.slabs))).toBeLessThanOrEqual(2); // ... none started that would overrun the budget
    expect(Math.max(...perTick.map(p => p.uploads))).toBe(1);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b01)))).toBe(0);
  });

  it('a slab that cannot be written within the budget is finished on the next frames, then uploaded once', async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 29), data = combineClassificationDistance(cls, dist, 0b11), uploads = [];
    let clock = 0;
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: (z0, z1) => uploads.push([z0, z1]), makeWorker: () => null, uploadBytes: 48 * 48 * 4 * 40, budgetMs: 2, now: () => (clock += 5) });
    rb.request(0b10);
    let frames = 0; while (rb.busy && frames < 5000) { rb.tick(); frames++; }
    expect(uploads).toEqual([[0, 40]]); // the whole texture is one slab here: one upload, after several frames of writing
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b10)))).toBe(0);
  });

  it('a swap (a set disjoint from the texture) goes through the union first: something drawable all along, the exact bytes at the end', async () => {
    for (const via of ['main thread', 'worker']) {
      const { cls, dist } = scene(dims, 4, [0, 1, 2, -1], 37), data = combineClassificationDistance(cls, dist, 0b001), safes = [];
      const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b001, upload: () => {}, makeWorker: via === 'worker' ? fakeWorker() : () => null, budgetMs: 1e9, uploadBytes: SLICE * 6 });
      rb.request(0b010); // bone only -> soft only
      let k = 0; while (rb.busy && k++ < 5000) { safes.push(rb.safeMask); rb.tick(); await new Promise(r => setTimeout(r, 0)); }
      expect(rb.busy).toBe(false);
      expect(safes.every(m => m !== 0)).toBe(true); // never nothing to draw with the jumps
      expect(safes).toContain(0b001); expect(safes).toContain(0b011); // the old set while the union uploads, then the union
      expect(rb.contentMask).toBe(0b010); expect(rb.safeMask).toBe(0b010);
      expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b010)))).toBe(0);
      // a request during the union step replaces the target; the same target again changes nothing
      rb.request(0b100); rb.tick(); rb.request(0b100); rb.request(0b001); rb.request(0b100);
      await tickUntilDone(rb);
      expect(rb.contentMask).toBe(0b100);
      expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b100)))).toBe(0);
    }
  });

  it("the worker's alpha buffer goes back to it after the upload and serves the next build", async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 31), data = combineClassificationDistance(cls, dist, 0b11), log = [];
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: () => {}, makeWorker: fakeWorker(log), slabBytes: 1 << 20 });
    rb.request(0b01); await tickUntilDone(rb);
    expect(log.filter(t => t === 'spare').length).toBe(1);
    rb.request(0b10); await tickUntilDone(rb); rb.request(0b11); await tickUntilDone(rb);
    expect(log.filter(t => t === 'spare').length).toBe(4); // 0b01 -> 0b10 is a swap: two builds
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b11)))).toBe(0);
  });
});
