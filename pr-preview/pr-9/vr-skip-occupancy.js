// VR creep skip: the occupancy bits of the combined classification + distance texture (VR max-zoom cost). Pure helpers: no three.js, no DOM.
//
// What the VR volume shader (vr-view.js, the VRL_OPAQUE tight loop) spends its time on at max zoom: "creep" samples. The ray is within ~2.7
// voxels of a shown surface (so the distance field gives no jump: alpha byte <= 2) and not inside any shown segment: the sample fetches the
// classification texture (16-64 MB, one trilinear RGBA8 fetch) only to learn "outside, keep going". Those samples can be answered from one
// bit each: the trilinear value of a sample lies in its dual cell c0..c0+1 (c0 = floor(p), p = texCoord * dims - 0.5), and when
//   - every shown channel's byte is <= 127 at all eight corners (the filtered value stays below 0.5: not inside), and
//   - the alpha byte (the combined distance) is <= 2 at all eight corners (the filtered value stays below the jump threshold 2.7),
// the original loop classifies the sample as "outside, no jump" with certainty. That is the bit, one per dual cell, packed 4x4x4 = 64 bits
// per texel of an RG32UI texture (2 MB at 256^3; the shader reads one texel per block of 4^3 cells and tests bits for as long as the ray
// stays in the block).
//
// The bits depend on the SHOWN set (which channels count as inside) and on the alpha bytes (min distance over the shown segments), so they
// are built from the combined texture's final bytes for one mask and are valid only while the GPU holds exactly those bytes (vr-view.js: useSkip
// is 0 during a combo rebuild and until the bits of the new state are uploaded). A shown set that is a subset of the built mask stays valid
// (fewer channels can only make more cells empty); a larger one does not.
//
// Exactness is the contract: a bit may only be set when the original would have decided "outside, no jump" for every sample of the dual cell.
// Cells at the border of the grid (c0 < 0 or c0 >= dims - 1: the clamp-to-edge corner) never get a bit.

export const SKIP_INSIDE_BYTE = 128; // a classification byte >= 128 is >= 0.5 once divided by 255: inside (the shader tests q - 0.5 >= 0)
export const SKIP_MAX_DD = 2; // an alpha byte <= 2 never reaches the jump threshold (dd >= 2.7) after filtering
export const SKIP_BLOCK = 4;

// texels of the occupancy texture for a classification grid of `dims` [w, h, d]
export const skipGrid = dims => [Math.ceil(dims[0] / SKIP_BLOCK), Math.ceil(dims[1] / SKIP_BLOCK), Math.ceil(dims[2] / SKIP_BLOCK)];

// the channels (0..3) of the segments in `mask` (bit s = segment slot s), chan[s] = channel of slot s (-1: none)
export function skipChannels(chan, mask) {
 const on = [false, false, false, false];
 for (let s = 0; s < 4; s++) if (chan[s] >= 0 && chan[s] < 4 && ((mask >> s) & 1)) on[chan[s]] = true;
 return on;
}

// data: RGBA bytes of the combined texture (channels 0..2 = classification, alpha = distance), cls4: R bytes of channel 3 (or null),
// dims [w, h, d], chan / mask as skipChannels. Returns a job: tick(budgetMs, now) builds whole z slabs until the budget is spent and returns true
// when done; bits = Uint32Array (2 words per block, block index (bz * by + by) * bx + bx, word = (z & 3) >> 1, bit = x & 3 | (y & 3) << 2 | ((z & 3) & 1) << 4).
// A channel in the mask whose bytes are missing (channel 3 without cls4) makes nothing skippable (fail-safe: no bits).
export function createSkipBuild({ data, cls4 = null, dims, chan, mask, out = null }) {
 const [w, h, d] = dims, [bx, by, bz] = skipGrid(dims), nWords = bx * by * bz * 2, plane = w * h;
 const bits = out && out.length === nWords ? out.fill(0) : new Uint32Array(nWords), on = skipChannels(chan, mask);
 const ok = data && data.length >= plane * d * 4 && w >= 2 && h >= 2 && d >= 2 && !(on[3] && !(cls4 && cls4.length >= plane * d));
 const c0 = on[0], c1 = on[1], c2 = on[2], c3 = on[3];
 let ePrev = new Uint8Array(plane), eCur = new Uint8Array(plane), aPrev = new Uint8Array(plane), aCur = new Uint8Array(plane), z = 0, done = !ok;
 // empty texel: no shown channel inside, alpha within the creep range
 const fillE = (e, zz) => {
  const base = zz * plane;
  for (let i = 0; i < plane; i++) {
   const o = (base + i) * 4;
   let v = data[o + 3] <= SKIP_MAX_DD ? 1 : 0;
   if (v) {
    if (c0 && data[o] >= SKIP_INSIDE_BYTE) v = 0;
    else if (c1 && data[o + 1] >= SKIP_INSIDE_BYTE) v = 0;
    else if (c2 && data[o + 2] >= SKIP_INSIDE_BYTE) v = 0;
    else if (c3 && cls4[base + i] >= SKIP_INSIDE_BYTE) v = 0;
   }
   e[i] = v;
  }
 };
 // A[x, y] of slab zz = the four texels (x..x+1, y..y+1) empty
 const fillA = (a, e) => {
  for (let y = 0; y < h - 1; y++) {
   const r = y * w;
   for (let x = 0; x < w - 1; x++) a[r + x] = e[r + x] & e[r + x + 1] & e[r + w + x] & e[r + w + x + 1];
  }
 };
 const step = () => {
  // slab z: its E and A; the dual cells of slab z - 1 = A(z - 1) & A(z)
  fillE(eCur, z); fillA(aCur, eCur);
  if (z > 0) {
   const zc = z - 1, zl = zc & 3, word = zl >> 1, shift = (zl & 1) << 4, bzI = zc >> 2;
   for (let y = 0; y < h - 1; y++) {
    const r = y * w, rowBlk = ((bzI * by + (y >> 2)) * bx) * 2 + word, yb = (y & 3) << 2;
    for (let x = 0; x < w - 1; x++) {
     if (aPrev[r + x] & aCur[r + x]) bits[rowBlk + (x >> 2) * 2] |= 1 << (((x & 3) | yb) + shift);
    }
   }
  }
  let t = aPrev; aPrev = aCur; aCur = t; t = ePrev; ePrev = eCur; eCur = t;
  z++;
  if (z >= d) { done = true; ePrev = eCur = aPrev = aCur = null; }
 };
 return {
  bits,
  get done() { return done; },
  get progress() { return d ? z / d : 1; },
  tick(budgetMs = 2, now = () => performance.now()) {
   if (done) return true;
   const t0 = now();
   do step(); while (!done && now() - t0 < budgetMs);
   return done;
  },
 };
}

// the whole build at once (harness, tests, a synchronous first build)
export function buildSkipOccupancy(args) {
 const job = createSkipBuild(args);
 job.tick(Infinity, () => 0);
 return job.bits;
}

// useSkip for this frame (vr-view.js): 1 only when the bits describe exactly what the GPU holds and cover what the shader shows.
//  built: mask the bits were built for (-1: none / still building); content: the combined texture's mask once its upload is complete (-1: unknown / mixed);
//  busy: a combo rebuild is running; shown: the shader's shown set (bit s = segment slot s); off: the user's / URL's switch
export function skipUsable({ built, content, busy, shown, off }) {
 if (off || busy || built < 0 || content < 0 || built !== content) return 0;
 return (shown & ~built) === 0 ? 1 : 0;
}

// The per-session state of vr-view.js (one per grid texture): builds the bits for the mask the combined texture holds, a little per frame, and says
// each frame whether the shader may use them. step() once per frame with
//  data / cls4: the combined texture's bytes (read live: they are final whenever busy is false), busy: a combo rebuild is running, content: the mask
//  the texture holds (-1: unknown), shown: the shader's shown set, off: the switch.
// Returns {use, tex}: use = the useSkip uniform, tex = the bits' texture when use is 1. A rebuild (busy) or a mask change drops the bits at once (and
// the job in flight: its bytes may be stale), the new ones are built from the final bytes, useSkip 0 meanwhile. makeTexture(bits) creates the GPU
// texture once; touchTexture(tex) re-sends the same (rebuilt in place) bits.
export function createSkipState({ dims, chan, makeTexture, touchTexture, budgetMs = 1.5, now }) {
 let mask = -1, job = null, jobMask = -1, bits = null, tex = null;
 return {
  get mask() { return mask; },
  get building() { return !!job; },
  get tex() { return tex; },
  dispose() { job = null; jobMask = -1; mask = -1; tex?.dispose?.(); tex = null; }, // the GPU texture (the session's cleanup)
  step({ data, cls4 = null, busy, content, shown, off }) {
   const cont = busy ? -1 : content;
   if (busy || cont < 0 || off) { mask = -1; job = null; jobMask = -1; }
   else if (mask !== cont) {
    if (!job || jobMask !== cont) { mask = -1; job = createSkipBuild({ data, cls4, dims, chan, mask: cont, out: bits }); bits = job.bits; jobMask = cont; }
    if (job.tick(budgetMs, now)) { if (tex) touchTexture(tex); else tex = makeTexture(bits); mask = cont; job = null; jobMask = -1; }
   }
   const use = skipUsable({ built: mask, content: cont, busy, shown, off });
   return { use, tex: use ? tex : null };
  },
 };
}
