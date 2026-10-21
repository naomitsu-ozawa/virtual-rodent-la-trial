import { describe, it, expect } from 'vitest';
import { skipGrid, skipChannels, createSkipBuild, createSkipState, buildSkipOccupancy, skipUsable, SKIP_INSIDE_BYTE, SKIP_MAX_DD } from '../../docs/vr-skip-occupancy.js';

// VR creep skip: one bit per dual cell (the trilinear footprint c0..c0+1) of the combined classification + distance texture, set only when the
// original ray loop would classify every sample of that cell as "outside every shown segment, no distance-field jump".

const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const makeData = (dims, r, density) => { // RGBA combined bytes + channel 3 bytes: mostly "far" (alpha 255), with islands of near / inside voxels
 const [w, h, d] = dims, n = w * h * d, data = new Uint8Array(n * 4), cls4 = new Uint8Array(n);
 for (let i = 0; i < n; i++) {
  const o = i * 4, roll = r();
  data[o + 3] = roll < density ? Math.floor(r() * 3) : roll < density * 1.3 ? 3 + Math.floor(r() * 5) : 255;
  for (let c = 0; c < 3; c++) data[o + c] = r() < density * 0.15 ? 128 + Math.floor(r() * 127) : Math.floor(r() * 128);
  cls4[i] = r() < density * 0.1 ? 200 : 60;
 }
 return { data, cls4 };
};
// the brute-force rule: all eight corners empty (clamp-free cells only)
const reference = (data, cls4, dims, on) => {
 const [w, h, d] = dims, empty = (x, y, z) => {
  const i = (z * h + y) * w + x, o = i * 4;
  if (data[o + 3] > SKIP_MAX_DD) return false;
  for (let c = 0; c < 3; c++) if (on[c] && data[o + c] >= SKIP_INSIDE_BYTE) return false;
  if (on[3] && cls4[i] >= SKIP_INSIDE_BYTE) return false;
  return true;
 };
 const set = new Set();
 for (let z = 0; z < d - 1; z++) for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
  let ok = true;
  for (let k = 0; k < 8 && ok; k++) ok = empty(x + (k & 1), y + ((k >> 1) & 1), z + ((k >> 2) & 1));
  if (ok) set.add((z * h + y) * w + x);
 }
 return set;
};
const bitOf = (bits, dims, x, y, z) => { // the shader's lookup
 const [bx, by] = skipGrid(dims), blk = ((z >> 2) * by + (y >> 2)) * bx + (x >> 2), lz = z & 3, bit = (x & 3) + 4 * (y & 3) + 16 * lz;
 return (bits[blk * 2 + (bit >> 5)] >>> (bit & 31)) & 1;
};
const decode = (bits, dims) => {
 const [w, h, d] = dims, set = new Set();
 for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bitOf(bits, dims, x, y, z)) set.add((z * h + y) * w + x);
 return set;
};

describe('vr-skip-occupancy', () => {
 it('matches the brute-force eight-corner rule, grids that are not multiples of 4 included', () => {
  for (const [dims, density, seed] of [[[16, 12, 8], 0.9, 1], [[13, 10, 9], 0.97, 2], [[9, 7, 5], 0.99, 3], [[20, 20, 20], 0.995, 4]]) {
   const { data, cls4 } = makeData(dims, rng(seed), density);
   for (const mask of [0b111, 0b001, 0b101, 0b1000, 0b1111, 0]) {
    const chan = [0, 1, 2, 3], on = skipChannels(chan, mask), bits = buildSkipOccupancy({ data, cls4, dims, chan, mask }), got = decode(bits, dims), want = reference(data, cls4, dims, on);
    expect([...got].sort((a, b) => a - b)).toEqual([...want].sort((a, b) => a - b));
    if (mask === 0b111 && density > 0.99) expect(want.size).toBeGreaterThan(0); // the test data does set bits
   }
  }
 });
 it('uses the slot -> channel map (a slot without a channel counts nothing; slot order is not channel order)', () => {
  const dims = [12, 12, 12], { data, cls4 } = makeData(dims, rng(7), 0.99), chan = [2, -1, 0, 1];
  for (const mask of [1, 2, 4, 8, 5, 15]) {
   const on = skipChannels(chan, mask);
   expect(on).toEqual([0, 1, 2, 3].map(c => chan.some((cc, s) => cc === c && ((mask >> s) & 1))));
   expect(decode(buildSkipOccupancy({ data, cls4, dims, chan, mask }), dims)).toEqual(reference(data, cls4, dims, on));
  }
 });
 it('a smaller shown set keeps every bit of a larger one (subset = still exact), a larger set may not', () => {
  const dims = [16, 16, 16], { data, cls4 } = makeData(dims, rng(11), 0.99), chan = [0, 1, 2, 3];
  const big = decode(buildSkipOccupancy({ data, cls4, dims, chan, mask: 0b1111 }), dims), small = decode(buildSkipOccupancy({ data, cls4, dims, chan, mask: 0b0101 }), dims);
  for (const k of big) expect(small.has(k)).toBe(true);
  expect(small.size).toBeGreaterThan(big.size);
 });
 it('never sets the cells at the border of the grid (the clamp-to-edge corner) or beyond it', () => {
  const dims = [10, 9, 11], n = 10 * 9 * 11, data = new Uint8Array(n * 4); // everything empty: alpha 0, class 0
  const bits = buildSkipOccupancy({ data, dims, chan: [0, 1, 2, -1], mask: 7 }), got = decode(bits, dims);
  expect(got.size).toBe(9 * 8 * 10);
  for (const k of got) { const x = k % 10, y = Math.floor(k / 10) % 9, z = Math.floor(k / 90); expect(x).toBeLessThan(9); expect(y).toBeLessThan(8); expect(z).toBeLessThan(10); }
 });
 it('fail-safe: a shown channel 3 without its bytes, or short data, gives no bit', () => {
  const dims = [8, 8, 8], data = new Uint8Array(512 * 4);
  expect(buildSkipOccupancy({ data, cls4: null, dims, chan: [0, 1, 2, 3], mask: 8 }).every(v => v === 0)).toBe(true);
  expect(buildSkipOccupancy({ data: data.subarray(0, 100), dims, chan: [0, 1, 2, -1], mask: 7 }).every(v => v === 0)).toBe(true);
  expect(decode(buildSkipOccupancy({ data, cls4: null, dims, chan: [0, 1, 2, 3], mask: 7 }), dims).size).toBe(7 * 7 * 7); // channel 3 not shown: not needed
 });
 it('the chunked job is byte-identical to the one-shot build, makes progress within a budget and reuses a buffer', () => {
  const dims = [24, 20, 18], { data, cls4 } = makeData(dims, rng(5), 0.99), chan = [0, 1, 2, 3], whole = buildSkipOccupancy({ data, cls4, dims, chan, mask: 15 });
  let clock = 0;
  const job = createSkipBuild({ data, cls4, dims, chan, mask: 15 });
  let ticks = 0;
  while (!job.tick(1, () => (clock += 0.6))) { ticks++; expect(job.progress).toBeGreaterThan(0); if (ticks > 1000) throw new Error('no progress'); }
  expect(ticks).toBeGreaterThan(2);
  expect(job.done).toBe(true);
  expect(Array.from(job.bits)).toEqual(Array.from(whole));
  const again = createSkipBuild({ data, cls4, dims, chan, mask: 15, out: job.bits }); // a dirty buffer is cleared
  expect(again.bits).toBe(job.bits); again.tick(Infinity, () => 0);
  expect(Array.from(again.bits)).toEqual(Array.from(whole));
 });
 it('the texture size is the 4^3 grid of the cells (2 MB at 256^3)', () => {
  expect(skipGrid([256, 256, 256])).toEqual([64, 64, 64]);
  expect(skipGrid([130, 33, 5])).toEqual([33, 9, 2]);
  expect(createSkipBuild({ data: new Uint8Array(256 ** 3 * 4), dims: [256, 256, 256], chan: [0, 1, 2, -1], mask: 7 }).bits.byteLength).toBe(2 << 20);
 });
 it('useSkip: only when the bits are the GPU\'s exact state and cover the shown set', () => {
  const ok = { built: 5, content: 5, busy: false, shown: 5, off: false };
  expect(skipUsable(ok)).toBe(1);
  expect(skipUsable({ ...ok, shown: 1 })).toBe(1); // a subset
  expect(skipUsable({ ...ok, shown: 7 })).toBe(0); // a segment the bits do not know
  expect(skipUsable({ ...ok, busy: true })).toBe(0); // a combo rebuild is running: the alpha on the GPU is in flux
  expect(skipUsable({ ...ok, content: -1 })).toBe(0);
  expect(skipUsable({ ...ok, content: 7 })).toBe(0); // the texture holds another mask than the bits were built for
  expect(skipUsable({ ...ok, built: -1 })).toBe(0); // still building
  expect(skipUsable({ ...ok, off: true })).toBe(0); // vrNoSkip / the 詳細 switch
 });
});

// the per-session state vr-view.js steps once per frame
describe('createSkipState', () => {
 const dims = [16, 16, 16], chan = [0, 1, 2, 3], mk = seed => { const { data, cls4 } = makeData(dims, rng(seed), 0.99); return { data, cls4 }; };
 const harness = (extra = {}) => {
  let clock = 0; const made = [], touched = [];
  const st = createSkipState({ dims, chan, makeTexture: bits => { const t = { bits, id: made.length }; made.push(t); return t; }, touchTexture: t => touched.push(t.id), budgetMs: 1, now: () => (clock += 0.4), ...extra });
  return { st, made, touched };
 };
 const frame = (st, base, over = {}) => st.step({ ...base, busy: false, content: 0b0111, shown: 0b0111, off: false, ...over });
 it('useSkip is 0 until the bits are built (a few frames, never in the frame they start), then 1 with the texture', () => {
  const { st, made } = harness(), base = mk(1);
  const uses = []; for (let i = 0; i < 40 && !uses.includes(1); i++) uses.push(frame(st, base).use);
  expect(uses[0]).toBe(0); expect(uses.at(-1)).toBe(1); expect(uses.length).toBeGreaterThan(2);
  expect(made).toHaveLength(1);
  const r = frame(st, base); expect(r.use).toBe(1); expect(r.tex).toBe(made[0]); expect(st.mask).toBe(0b0111);
  expect(Array.from(made[0].bits)).toEqual(Array.from(buildSkipOccupancy({ ...base, dims, chan, mask: 0b0111 })));
 });
 it('a running rebuild switches it off at once, drops a job in flight, and the bits are rebuilt from the final bytes', () => {
  const { st, made, touched } = harness(), base = mk(2);
  for (let i = 0; i < 60; i++) frame(st, base);
  expect(frame(st, base).use).toBe(1);
  expect(frame(st, base, { busy: true, content: -1 }).use).toBe(0); expect(st.mask).toBe(-1);
  // the rebuild changed the bytes (alpha) and the mask; a build started by a premature frame is cancelled by the next busy one
  const after = mk(3);
  frame(st, after, { content: 0b0101, shown: 0b0101 }); expect(st.building || st.mask === 0b0101).toBe(true);
  expect(frame(st, after, { busy: true, content: -1 }).use).toBe(0); expect(st.building).toBe(false);
  let r; for (let i = 0; i < 80; i++) { r = frame(st, after, { content: 0b0101, shown: 0b0101 }); if (r.use) break; }
  expect(r.use).toBe(1); expect(st.mask).toBe(0b0101);
  expect(made).toHaveLength(1); expect(touched.length).toBeGreaterThanOrEqual(1); // the texture object is kept, its bits re-sent
  expect(Array.from(r.tex.bits)).toEqual(Array.from(buildSkipOccupancy({ ...after, dims, chan, mask: 0b0101 })));
 });
 it('a shown set the bits do not cover, an unknown content mask and the switch each give 0; the bits survive a subset', () => {
  const { st } = harness(), base = mk(4);
  for (let i = 0; i < 60; i++) frame(st, base);
  expect(frame(st, base).use).toBe(1);
  expect(frame(st, base, { shown: 0b0011 }).use).toBe(1); // subset
  expect(frame(st, base, { shown: 0b1111 }).use).toBe(0); // a segment the bits do not know (the texture holds 0b0111 until a rebuild)
  expect(frame(st, base, { content: -1 }).use).toBe(0);
  expect(frame(st, base).use).toBe(0); // the bits were dropped with the unknown content: rebuilding
  for (let i = 0; i < 60; i++) frame(st, base);
  expect(frame(st, base, { off: true }).use).toBe(0); expect(st.mask).toBe(-1);
  for (let i = 0; i < 60; i++) frame(st, base);
  expect(frame(st, base).use).toBe(1); // switched on again: rebuilt
 });
 it('exposes the texture and disposes it', () => {
  let disposed = 0; const { st } = harness({ makeTexture: bits => ({ bits, dispose() { disposed++; } }) }), base = mk(6);
  expect(st.tex).toBe(null);
  for (let i = 0; i < 60; i++) frame(st, base);
  expect(st.tex).not.toBe(null); expect(frame(st, base).tex).toBe(st.tex);
  st.dispose(); expect(disposed).toBe(1); expect(st.tex).toBe(null); expect(st.mask).toBe(-1);
  expect(frame(st, base).use).toBe(0); // rebuilds from scratch
 });
 it('channel 3 needs its bytes: without them nothing is skipped', () => {
  const { st } = harness(), base = mk(5);
  let r; for (let i = 0; i < 60; i++) r = frame(st, { data: base.data, cls4: null }, { content: 0b1000, shown: 0b1000 });
  expect(r.use).toBe(1); expect(Array.from(r.tex.bits).every(v => v === 0)).toBe(true); // fail-safe: all bits clear
 });
});
