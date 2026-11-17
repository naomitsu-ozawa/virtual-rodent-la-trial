import { describe, it, expect } from 'vitest';
import { combineClassificationDistance, combinedAlphaRange } from '../../docs/distance-field.js';
import { createComboRebuild, comboWorkerMain, CHUNK } from '../../docs/vr-combo-rebuild.js';
import { hideFieldMin, hideBitsSame } from '../../docs/vr-hide-field.js';
import { euclideanDistanceBytes } from '../../docs/distance-field.js';

// the combined classification + distance texture is rebuilt off the frame (worker or main-thread chunks) and uploaded
// in z slices over several frames. The bytes at the end must equal the one-shot combineClassificationDistance result exactly.
const rnd = seed => () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
const scene = (dims, C, chan, seed = 7) => {
  const n = dims[0] * dims[1] * dims[2], r = rnd(seed);
  const cls = { data: Uint8Array.from({ length: n * C }, r), C, chan }, dist = { data: Uint8Array.from({ length: n * C }, r), C, chan };
  return { n, cls, dist };
};
// test doubles of a Worker: its two handler slots, and one delivery of a message to a handler
const workerSlots = () => ({ onmessage: null, onerror: null });
const deliver = (target, data) => target.onmessage({ data });
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
    const bad = () => { const w = { ...workerSlots(), postMessage(m) { if (m.t === 'build') setTimeout(() => w.onerror?.({ message: 'boom' }), 0); }, terminate() {} }; return w; };
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b01, upload: () => {}, makeWorker: bad, budgetMs: 1e9 });
    rb.request(0b11);
    await tickUntilDone(rb);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b11)))).toBe(0);
  });

  it('a worker that never answers (or reports an error) is dropped after workerFrames frames: the job ends on the main thread', async () => {
    const { cls, dist } = scene(dims, 2, [0, 1, -1, -1], 19), data = combineClassificationDistance(cls, dist, 0b01);
    const silent = () => ({ ...workerSlots(), postMessage() {}, terminate() {} });
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

// the rebuild with a hidden state (the visible-content field merged into the alpha by the worker, vr-hide-field.js); a small scene: tissue blobs, an item hiding a block of slot 0
const rndH = seed => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function hideScene(dims, seed) {
  const [w, h, d] = dims, n = w * h * d, r = rndH(seed), cls = new Uint8Array(n).fill(20), G = new Uint8Array(n);
  for (let b = 0; b < 3; b++) { const cx = r() * w, cy = r() * h, cz = r() * d, rad = 2 + r() * 3; for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy, z - cz) <= rad) cls[(z * h + y) * w + x] = 200; }
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.6); x++) G[(z * h + y) * w + x] = 1;
  const bits = new Uint8Array(256); bits[1] = 1; // item 1 hidden on slot 0
  return { cls: { data: cls, C: 1 }, G, bits };
}
describe('createComboRebuild with a hidden state', () => {
  const dims = [40, 36, 34], mk = fakeWorker; // the fake worker of the tests above: the real worker code on a scope with asynchronous messages
  const world = () => {
    const [w, h, d] = dims, n = w * h * d, { cls, G, bits } = hideScene(dims, 21), C = 2, c2 = new Uint8Array(n * C), dist = new Uint8Array(n * C);
    const o0 = euclideanDistanceBytes(Uint8Array.from(cls.data, v => (v >= 128 ? 1 : 0)), dims);
    for (let i = 0; i < n; i++) { c2[i * 2] = cls.data[i]; c2[i * 2 + 1] = 20; dist[i * 2] = o0[i]; dist[i * 2 + 1] = 255; }
    const rg = new Uint8Array(n * 2); for (let i = 0; i < n; i++) rg[i * 2 + 1] = G[i];
    return { n, C, cls: { data: c2, C, chan: [0, 1, -1, -1] }, dist: { data: dist, C }, rg, bits };
  };
  const tickDone = async rb => { let k = 0; while (rb.busy && k++ < 20000) { rb.tick(); await new Promise(r => setTimeout(r, 0)); } expect(rb.busy).toBe(false); };
  it('the worker merges the visible-content field: the bytes equal min(ordinary alpha, hideFieldMin); hideValid follows the state', async () => {
    const { n, cls, dist, rg, bits } = world(), data = combineClassificationDistance(cls, dist, 0b11), up = [];
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: (z0, z1) => up.push([z0, z1]), hide: { cls, rgs: [rg, null] }, makeWorker: mk(), slabBytes: 30000, uploadBytes: 40 * 36 * 4 * 5 });
    expect(rb.hideValid([bits, new Uint8Array(256)], 0b11)).toBe(false); // nothing built with a hidden state yet
    const cur = [bits, new Uint8Array(256)];
    rb.request(0b11, cur); expect(rb.busy).toBe(true); expect(rb.hideValid(cur, 0b11)).toBe(false); // a rebuild is running
    await tickDone(rb);
    const ref = new Uint8Array(n); { const full = combineClassificationDistance(cls, dist, 0b11); for (let i = 0; i < n; i++) ref[i] = full[i * 4 + 3]; }
    hideFieldMin(ref, { cls: { data: cls.data, C: 2 }, chan: cls.chan, dims, mask: 0b11, sources: [{ ids: Uint8Array.from({ length: n }, (_, i) => rg[i * 2 + 1]), bits }] });
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] !== ref[i]) throw new Error('alpha differs at ' + i);
    expect(rb.contentMask).toBe(0b11); expect(hideBitsSame(rb.contentHide, cur)).toBe(true);
    expect(rb.hideValid(cur, 0b11)).toBe(true);
    const more = [bits, (() => { const b = new Uint8Array(256); b[5] = 1; return b; })()]; expect(rb.hideValid(more, 0b11)).toBe(false); // hides MORE than built with: the newly hidden part is inside visible tissue in the bytes (the old rule)
    const moreSlot1 = [bits, (() => { const b = new Uint8Array(256); b[5] = 2; return b; })()]; expect(rb.hideValid(moreSlot1, 0b01)).toBe(true); expect(rb.hideValid(moreSlot1, 0b11)).toBe(false); // a difference on a slot that is not shown does not matter
    expect(rb.hideValid([new Uint8Array(256), new Uint8Array(256)], 0b11)).toBe(false); // the item is shown again: the old rule
    expect(rb.hideValid(cur, 0b111)).toBe(false); expect(rb.hideValid(cur, 0b01)).toBe(true); // a shown slot the bytes were not built for / fewer slots
    rb.request(0b11, cur); expect(rb.busy).toBe(false); // the same state: no rebuild
    // a mask change carries NO state (a segment just shown must not wait for the extra pass); the state is asked for again once the mask job is over, as hideTick does
    rb.request(0b01, cur); expect(rb.busy).toBe(true);
    await tickDone(rb); expect(rb.contentMask).toBe(0b01); expect(rb.contentHide).toBe(null); expect(rb.hideValid(cur, 0b01)).toBe(false);
    for (let i = 0; i < 3; i++) { rb.requestHide(cur); } expect(rb.busy).toBe(true); // asked every frame: one job (no restart while it is in flight, also while its bytes are being written)
    for (let k = 0; k < 4 && rb.busy; k++) { rb.tick(); await new Promise(r => setTimeout(r, 0)); rb.requestHide(cur); }
    await tickDone(rb); expect(rb.contentMask).toBe(0b01); expect(rb.hideValid(cur, 0b01)).toBe(true);
    rb.request(0b10, cur); await tickDone(rb); rb.requestHide(cur); expect(rb.busy).toBe(false); // slot 1 alone has no hidden part: nothing to merge, no job
    rb.dispose();
  });
  // n731 perf ③: while parts are out the body's cut is a third index source of ONE byte a voxel (vr-part-view.js partBodyHidOf, scattered on this grid): sent as it is, merged as the RG indexes are
  it('a one-byte index source (the body\'s cut) is sent and merged like the RG ones', async () => {
    const { n, cls, dist, rg, bits } = world(), data = combineClassificationDistance(cls, dist, 0b11), [w, h] = dims;
    const cut = new Uint8Array(n); for (let z = 8; z < 20; z++) for (let y = 6; y < 20; y++) for (let x = 2; x < 10; x++) cut[(z * h + y) * w + x] = 1; // channel 0 of the body's field hides this block
    const pb = new Uint8Array(256); for (let i = 1; i < 16; i++) if (i & 1) pb[i] = 0b01; // channel 0 is slot 0's
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg, null, cut] }, makeWorker: mk(), slabBytes: 30000, uploadBytes: 40 * 36 * 4 * 5 });
    const cur = [bits, new Uint8Array(256), pb]; rb.request(0b11, cur); await tickDone(rb);
    const ref = new Uint8Array(n); { const full = combineClassificationDistance(cls, dist, 0b11); for (let i = 0; i < n; i++) ref[i] = full[i * 4 + 3]; }
    hideFieldMin(ref, { cls: { data: cls.data, C: 2 }, chan: cls.chan, dims, mask: 0b11, sources: [{ ids: Uint8Array.from({ length: n }, (_, i) => rg[i * 2 + 1]), bits }, { ids: cut, bits: pb }] });
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] !== ref[i]) throw new Error('alpha differs at ' + i);
    expect(rb.hideValid(cur, 0b11)).toBe(true); expect(rb.hideValid([bits, new Uint8Array(256), new Uint8Array(256)], 0b11)).toBe(false); // the cut gone (the parts put back): the old rule until rebuilt
    rb.setHideSources(cls, [rg, null, null]); expect(rb.hideValid(cur, 0b11)).toBe(false); // a new field of the cut: what was built from the old one is dropped
    rb.dispose();
  });
  it('a state hiding nothing on a shown slot makes no merge; without a worker the ordinary alpha is written and hideValid stays false (no rebuild loop)', async () => {
    const { cls, dist, rg, bits } = world(), data = combineClassificationDistance(cls, dist, 0b11), cur = [bits, new Uint8Array(256)];
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg, null] }, makeWorker: () => null, budgetMs: 1e9, uploadBytes: 40 * 36 * 4 * 5 });
    rb.request(0b11, cur); await tickDone(rb);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b11)))).toBe(0);
    expect(rb.hideValid(cur, 0b11)).toBe(false);
    rb.requestHide(cur); expect(rb.busy).toBe(false); // the worker is gone: asking again does not start a job every frame
    const rb2 = createComboRebuild({ dist, chan: cls.chan, dims, data: Uint8Array.from(data), mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg, null] }, makeWorker: mk(), uploadBytes: 40 * 36 * 4 * 5 });
    rb2.request(0b11, [new Uint8Array(256), new Uint8Array(256)]); expect(rb2.busy).toBe(false); // nothing hidden: nothing to do
    const only1 = [new Uint8Array(256), new Uint8Array(256)]; only1[0][1] = 1; rb2.request(0b10, only1); // hidden on slot 0, only slot 1 shown: the state does not matter
    await tickDone(rb2); expect(rb2.contentHide).toBe(null); rb2.dispose();
  });
  it('setHideSources drops what was built (the child index was rebuilt)', async () => {
    const { cls, dist, rg, bits } = world(), data = combineClassificationDistance(cls, dist, 0b11), cur = [bits, new Uint8Array(256)];
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg, null] }, makeWorker: mk(), uploadBytes: 40 * 36 * 4 * 5 });
    rb.request(0b11, cur); await tickDone(rb); expect(rb.hideValid(cur, 0b11)).toBe(true);
    rb.setHideSources(cls, [rg, null]); expect(rb.hideValid(cur, 0b11)).toBe(false);
    rb.requestHide(cur); expect(rb.busy).toBe(true); await tickDone(rb); expect(rb.hideValid(cur, 0b11)).toBe(true); rb.dispose();
  });
});
describe('createComboRebuild with a hidden state: the worker takes its time, a missing index', () => {
  const dims = [40, 36, 34];
  const base = () => { const { cls: c1, G, bits } = hideScene(dims, 21), n = 40 * 36 * 34, cd = new Uint8Array(n * 2), dd = new Uint8Array(n * 2), o0 = euclideanDistanceBytes(Uint8Array.from(c1.data, v => (v >= 128 ? 1 : 0)), dims);
    for (let i = 0; i < n; i++) { cd[i * 2] = c1.data[i]; cd[i * 2 + 1] = 20; dd[i * 2] = o0[i]; dd[i * 2 + 1] = 255; }
    const rg = new Uint8Array(n * 2); for (let i = 0; i < n; i++) rg[i * 2 + 1] = G[i];
    return { cls: { data: cd, C: 2, chan: [0, 1, -1, -1] }, dist: { data: dd, C: 2 }, rg, bits }; };
  it('a worker that is busy for longer than workerFrames with a hidden state is not dropped (the pass is one blocking computation); without a state it still is', async () => {
    const { cls, dist, rg, bits } = base(), cur = [bits, new Uint8Array(256)];
    // a worker that takes the build and never answers (as a worker inside one long blocking pass does)
    const held = [], ws = []; const mk = () => { const w = { ...workerSlots(), terminated: false, sent: [], postMessage(m) { w.sent.push(m.t); if (m.t === 'build') held.push(m); }, terminate() { w.terminated = true; } }; ws.push(w); return w; };
    const data = combineClassificationDistance(cls, dist, 0b11), rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg, null] }, makeWorker: mk, workerFrames: 5, hideFrames: 50, slabBytes: 1 << 20, budgetMs: 1e9 });
    rb.request(0b11, cur); for (let i = 0; i < 40; i++) rb.tick(); // posted, no answer for 40 frames > workerFrames (5)
    expect(held.length).toBe(1); expect(held[0].hide).not.toBe(null); expect(ws[0].terminated).toBe(false); expect(rb.busy).toBe(true);
    for (let i = 0; i < 30; i++) rb.tick(); // past hideFrames (50): now it is dropped, the job goes on on the main thread (the ordinary alpha)
    expect(ws[0].terminated).toBe(true);
    for (let i = 0; i < 5000 && rb.busy; i++) rb.tick();
    expect(rb.busy).toBe(false); expect(rb.contentHide).toBe(null); expect(Buffer.compare(Buffer.from(data), Buffer.from(combineClassificationDistance(cls, dist, 0b11)))).toBe(0);
    // a worker that never saw a hidden state is dropped after workerFrames as before
    held.length = 0; const data2 = combineClassificationDistance(cls, dist, 0b11), rb2 = createComboRebuild({ dist, chan: cls.chan, dims, data: data2, mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg, null] }, makeWorker: mk, workerFrames: 5, hideFrames: 50, slabBytes: 1 << 20, budgetMs: 1e9 });
    rb2.request(0b01); for (let i = 0; i < 10; i++) rb2.tick(); expect(ws[1].terminated).toBe(true); for (let i = 0; i < 5000 && rb2.busy; i++) rb2.tick();
    expect(rb2.busy).toBe(false); expect(rb2.contentMask).toBe(0b01);
  });
  it('a hidden item whose index is not held makes no state (its voxels would stay tissue in the bytes: hideValid must never be true)', async () => {
    const { cls, dist, rg, bits } = base(), data = combineClassificationDistance(cls, dist, 0b11), only2nd = [new Uint8Array(256), bits]; // the hidden item is in the SECOND index, which was dropped (null)
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data, mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg, null] }, makeWorker: fakeWorker(), uploadBytes: 40 * 36 * 4 * 5 });
    rb.request(0b11, only2nd); expect(rb.busy).toBe(false); expect(rb.hideValid(only2nd, 0b11)).toBe(false);
    const wrongLen = createComboRebuild({ dist, chan: cls.chan, dims, data: Uint8Array.from(data), mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg.subarray(0, 100), null] }, makeWorker: fakeWorker() });
    wrongLen.request(0b11, [bits, new Uint8Array(256)]); expect(wrongLen.busy).toBe(false); rb.dispose(); wrongLen.dispose();
  });
});

// the worker source as the browser builds it (joined function texts), run in a fresh scope: every name it uses must be in it. Under vitest the imported names appear as __vite_ssr_import_N__.name; in the browser they are plain
import { comboWorkerSource } from '../../docs/vr-combo-rebuild.js';
describe('the combined-texture worker source runs on its own', () => {
  it('init, slabs, a hide init, a build with a hidden state: the same bytes as the functions called directly', async () => {
    const src = comboWorkerSource().replace(/__vite_ssr_import_\d+__\.(\w+)/g, '$1'), out = [];
    const self = { postMessage: m => out.push(m) }; new Function('self', src)(self);
    const dims = [20, 18, 16], n = 20 * 18 * 16, { cls: c1, G, bits } = hideScene(dims, 5), cd = new Uint8Array(n * 2), dd = new Uint8Array(n * 2), o0 = euclideanDistanceBytes(Uint8Array.from(c1.data, v => (v >= 128 ? 1 : 0)), dims);
    for (let i = 0; i < n; i++) { cd[i * 2] = c1.data[i]; cd[i * 2 + 1] = 20; dd[i * 2] = o0[i]; dd[i * 2 + 1] = 255; }
    deliver(self, { t: 'init', bytes: n * 2, C: 2 }); deliver(self, { t: 'slab', at: 0, buf: dd.buffer.slice(0) });
    deliver(self, { t: 'hinit', n, C: 2, dims, chan: [0, 1, -1, -1], sources: 1 }); deliver(self, { t: 'harr', name: 'cls', at: 0, buf: cd.buffer.slice(0) }); deliver(self, { t: 'harr', name: 's0', at: 0, buf: G.buffer.slice(0) });
    await deliver(self, { t: 'build', id: 1, mask: 0b11, chan: [0, 1, -1, -1], chunk: 1 << 20, hide: [bits] });
    expect(out.at(-1).t).toBe('alpha'); expect(out.at(-1).hide).toBe(true);
    const ref = new Uint8Array(n); combinedAlphaRange({ data: dd, C: 2 }, [0, 1, -1, -1], 0b11, ref, 0, n);
    hideFieldMin(ref, { cls: { data: cd, C: 2 }, chan: [0, 1, -1, -1], dims, mask: 0b11, sources: [{ ids: G, bits }] });
    expect(Buffer.compare(Buffer.from(new Uint8Array(out.at(-1).buf)), Buffer.from(ref))).toBe(0);
  });
});

describe('review fixes: the long limit is per job, a re-sent job has a new number, the worker checks what it holds', () => {
  const dims = [40, 36, 34], n = 40 * 36 * 34;
  const base = () => { const { cls: c1, G, bits } = hideScene(dims, 21), cd = new Uint8Array(n * 2), dd = new Uint8Array(n * 2), o0 = euclideanDistanceBytes(Uint8Array.from(c1.data, v => (v >= 128 ? 1 : 0)), dims);
    for (let i = 0; i < n; i++) { cd[i * 2] = c1.data[i]; cd[i * 2 + 1] = 20; dd[i * 2] = o0[i]; dd[i * 2 + 1] = 255; }
    const rg = new Uint8Array(n * 2); for (let i = 0; i < n; i++) rg[i * 2 + 1] = G[i];
    return { cls: { data: cd, C: 2, chan: [0, 1, -1, -1] }, dist: { data: dd, C: 2 }, rg, bits }; };
  const silent = () => { const held = [], ws = []; const mk = () => { const w = { ...workerSlots(), terminated: false, postMessage(m) { if (m.t === 'build') held.push(m); }, terminate() { w.terminated = true; } }; ws.push(w); return w; }; return { held, ws, mk }; };
  const mkRb = (b, mk, extra = {}) => createComboRebuild({ dist: b.dist, chan: b.cls.chan, dims, data: combineClassificationDistance(b.cls, b.dist, 0b11), mask: 0b11, upload: () => {}, hide: { cls: b.cls, rgs: [b.rg, null] }, makeWorker: mk, workerFrames: 5, hideFrames: 50, slabBytes: 1 << 20, budgetMs: 1e9, ...extra });
  const ZERO = [new Uint8Array(256), new Uint8Array(256)];
  it('a mask job is dropped after workerFrames once the hide build has answered; behind an unanswered hide build it keeps the long limit', () => {
    const b = base(), cur = [b.bits, new Uint8Array(256)], { held, ws, mk } = silent(), rb = mkRb(b, mk);
    rb.request(0b11, cur); for (let i = 0; i < 3; i++) rb.tick(); expect(held[0].hide).not.toBe(null);
    // a mask change while the hide build has not answered: cancelled, a new job queued behind it: the worker may still be inside its pass
    rb.request(0b01); for (let i = 0; i < 20; i++) rb.tick(); expect(ws[0].terminated).toBe(false); // 20 frames > workerFrames (5) and still alive
    // the hide build answers (with its bytes: the stale answer is for another job and is ignored); from then on the ordinary limit holds
    deliver(ws[0], { t: 'alpha', id: held[0].id, buf: new Uint8Array(n).buffer, hide: true });
    for (let i = 0; i < 8; i++) rb.tick(); expect(ws[0].terminated).toBe(true);
  });
  it('setHideSources gives the job in flight a new number: the answer of the build already posted is not taken', () => {
    const b = base(), cur = [b.bits, new Uint8Array(256)], { held, ws, mk } = silent(), rb = mkRb(b, mk);
    rb.request(0b11, cur); for (let i = 0; i < 3; i++) rb.tick(); expect(held.length).toBe(1);
    rb.setHideSources(b.cls, [b.rg, null]);
    deliver(ws[0], { t: 'alpha', id: held[0].id, buf: new Uint8Array(n).buffer, hide: true }); // the old build's answer
    expect(rb.busy).toBe(true); expect(rb.contentHide).toBe(null);
    for (let i = 0; i < 3; i++) rb.tick(); // re-posted: another number, without the state (the sources were dropped; hideTick asks again)
    expect(held.length).toBe(2); expect(held[1].id).not.toBe(held[0].id); expect(held[1].hide).toBe(null);
  });
  it('the worker uses a hidden state only when it holds the classification bytes and as many indexes as tables came', async () => {
    const out = [], scope = { postMessage: m => out.push(m) }; comboWorkerMain(scope);
    const b = base(), send = m => deliver(scope, m);
    send({ t: 'init', bytes: n * 2, C: 2 }); send({ t: 'slab', at: 0, buf: b.dist.data.buffer.slice(0) });
    await send({ t: 'build', id: 1, mask: 0b11, chan: [0, 1, -1, -1], chunk: 1 << 20, hide: [b.bits] }); expect(out.at(-1).hide).toBe(false); // nothing was sent for the state
    send({ t: 'hinit', n, C: 2, dims, chan: [0, 1, -1, -1], sources: 1 }); send({ t: 'harr', name: 'cls', at: 0, buf: b.cls.data.buffer.slice(0) });
    await send({ t: 'build', id: 2, mask: 0b11, chan: [0, 1, -1, -1], chunk: 1 << 20, hide: [b.bits, b.bits] }); expect(out.at(-1).hide).toBe(false); // two tables, one index
    await send({ t: 'build', id: 3, mask: 0b11, chan: [0, 1, -1, -1], chunk: 1 << 20, hide: [b.bits] }); expect(out.at(-1).hide).toBe(true);
    send({ t: 'hinit', n: 0, C: 1, dims: [0, 0, 0], chan: [0, 1, -1, -1], sources: 0 }); // the reset of setHideSources
    await send({ t: 'build', id: 4, mask: 0b11, chan: [0, 1, -1, -1], chunk: 1 << 20, hide: [b.bits] }); expect(out.at(-1).hide).toBe(false);
  });
});

describe('hideOnly / skipContent (the creep-skip bits stay valid through a rebuild of the hidden state only)', () => {
  const dims = [40, 36, 34];
  it('a rebuild for the mask the bytes already have is hideOnly for its whole life (also while its bytes are written); a mask change is not', async () => {
    const { cls: c1, G, bits } = hideScene(dims, 21), n = 40 * 36 * 34, cd = new Uint8Array(n * 2), dd = new Uint8Array(n * 2), o0 = euclideanDistanceBytes(Uint8Array.from(c1.data, v => (v >= 128 ? 1 : 0)), dims);
    for (let i = 0; i < n; i++) { cd[i * 2] = c1.data[i]; cd[i * 2 + 1] = 20; dd[i * 2] = o0[i]; dd[i * 2 + 1] = 255; }
    const rg = new Uint8Array(n * 2); for (let i = 0; i < n; i++) rg[i * 2 + 1] = G[i];
    const cls = { data: cd, C: 2, chan: [0, 1, -1, -1] }, dist = { data: dd, C: 2 }, cur = [bits, new Uint8Array(256)];
    const rb = createComboRebuild({ dist, chan: cls.chan, dims, data: combineClassificationDistance(cls, dist, 0b11), mask: 0b11, upload: () => {}, hide: { cls, rgs: [rg, null] }, makeWorker: fakeWorker(), slabBytes: 30000, uploadBytes: 40 * 36 * 4 * 3 });
    expect(rb.hideOnly).toBe(false); expect(rb.skipContent).toBe(0b11);
    rb.request(0b11, cur); expect(rb.busy).toBe(true); expect(rb.hideOnly).toBe(true);
    let wrote = false; for (let k = 0; k < 20000 && rb.busy; k++) { rb.tick(); if (rb.busy) { expect(rb.hideOnly).toBe(true); expect(rb.skipContent).toBe(0b11); if (rb.contentMask === -1) wrote = true; } await new Promise(r => setTimeout(r, 0)); }
    expect(wrote).toBe(true); expect(rb.busy).toBe(false); expect(rb.hideOnly).toBe(false);
    rb.request(0b01); expect(rb.busy).toBe(true); expect(rb.hideOnly).toBe(false); // another mask: the skip bits must go
    rb.dispose();
  });
});
