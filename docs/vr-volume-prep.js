// the heavy, pure steps of the VR data preparation, runnable off the main thread (switching the data inside a running VR session
// must not stall the headset's frames: vr-data-switch.js, vr-view.js swapData). Pure: no DOM, no GL; unit-tested (tests/unit/vr-volume-prep.test.js)
// to give byte-identical results to the synchronous versions they replace.
//   computeBricksOf   per brick HU min / max of an rg8-packed u16 volume (was computeBricks in vr-view.js)
//   halveData         2x2x2 average of such a volume (was the data part of halveVolume in vr-view.js)
//   halveRangeOf / applyThinCls / coverRunsOnGrid / thinKeepOf   n731: the block extremes the average forgets, and the rule that keeps every thin structure (value range, mask, child) one voxel thick on the 256 copy
//   buildDistanceBytesSync   the Euclidean distance of every classification channel (distance-field.js buildDistanceBytes without its yields)
//   buildEditMaskOf  the processing masks of the segments on the grid (RGBA, one channel per GPU slot; was buildEditMask in vr-view.js, which ran on the main thread)
//   smoothEditMaskOf the processing masks' bytes smoothed (n730 (rat brain voxel look), the strength 6 smoothing of the cut a mask leaves; partFieldOf of vr-part-view.js, the cut of a detached part)
//   buildRegionIndexOf   the analysis results' colour / id index on the grid (was buildRegionIndex in vr-view.js)
//   prepRun           one job of the worker: 'volume' (bricks of the full grid and the 256 copy) or 'cls' (the processing mask and the analysis index, classification bytes,
//                     distance field, the combined texture's bytes for the shown mask, brick occupancy of the mask-only segments)
// The worker is a Blob made from this site's own functions (the same way as vr-combo-rebuild.js); the data goes in and comes back by
// transfer (no second copy of a 512 MB array is ever held). Without a Worker (tests) the same job runs on the calling thread.
import { buildClsData } from './point-cls.js?v=20261113-build735';
import { partFieldOf } from './vr-part-view.js?v=20261113-build735';
import { euclideanDistanceBytes, morph3, combineClassificationDistance, fourthChannelBytes } from './distance-field.js?v=20261113-build735';
import { brickOccupancy, cellRange } from './vr-brick-occupancy.js?v=20261113-build735';
import { gpuRunsForTexture, gpuRunRowMapToSlice, gpuLowerBound, gpuUpperBound, gpuDilateRuns, gpuOwnerOrder, gpuOwnerSlices } from './gpu-runs.js?v=20261113-build735';

export const BRICK = 8;

// brick min / max in HU; one voxel of overlap so trilinear samples at a brick edge are covered. Four floats per brick (RGBA32F texture):
// min, max, mask-only occupancy (filled by the caller), unused. Self-contained (it is also the worker's source).
export function computeBricksOf(data, dims, calibration, brick) {
  const tw = dims[0], th = dims[1], td = dims[2], slope = calibration[0], intercept = calibration[1], bias = calibration[2];
  const bx = Math.ceil(tw / brick), by = Math.ceil(th / brick), bz = Math.ceil(td / brick), mm = new Float32Array(bx * by * bz * 4);
  // the rg8 words read as one u16 each when the platform is little-endian and the view is aligned (the same values, one load instead of two: the volume job's cost)
  const u16 = (data.byteOffset & 1) === 0 && new Uint8Array(Uint16Array.of(1).buffer)[0] === 1 ? new Uint16Array(data.buffer, data.byteOffset, tw * th * td) : null;
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    let lo = 65535, hi = 0;
    const z0 = Math.max(0, k * brick - 1), z1 = Math.min(td, (k + 1) * brick + 1), y0 = Math.max(0, j * brick - 1), y1 = Math.min(th, (j + 1) * brick + 1), x0 = Math.max(0, i * brick - 1), x1 = Math.min(tw, (i + 1) * brick + 1);
    if (u16) { for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) { let o = (z * th + y) * tw + x0; for (let x = x0; x < x1; x++, o++) { const w = u16[o]; if (w < lo) lo = w; if (w > hi) hi = w; } } }
    else for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) { let o = (z * th + y) * tw * 2 + x0 * 2; for (let x = x0; x < x1; x++, o += 2) { const w = data[o] | (data[o + 1] << 8); if (w < lo) lo = w; if (w > hi) hi = w; } }
    const b = ((k * by + j) * bx + i) * 4, a = (lo - bias) * slope + intercept, c = (hi - bias) * slope + intercept; mm[b] = Math.min(a, c); mm[b + 1] = Math.max(a, c);
  }
  return { bricks: mm, brickDims: [bx, by, bz] };
}

// half-size copy (2x2x2 average) of an rg8-packed u16 volume
export function halveData(src, dims, withRange) {
  const w = dims[0], h = dims[1], d = dims[2], tw = Math.max(1, w >> 1), th = Math.max(1, h >> 1), td = Math.max(1, d >> 1), out = new Uint8Array(tw * th * td * 2);
  // withRange (n731): also the smallest / largest source word of each block (halveRangeOf's result, with the odd last row / column / slice folded in), in the same loop (one read of the source instead of two)
  const lo = withRange ? new Uint16Array(tw * th * td).fill(65535) : null, hi = withRange ? new Uint16Array(tw * th * td) : null;
  const u16 = (src.byteOffset & 1) === 0 && w * h * d * 2 <= src.length && new Uint8Array(Uint16Array.of(1).buffer)[0] === 1 ? new Uint16Array(src.buffer, src.byteOffset, w * h * d) : null; // one u16 load per word (same values) where the platform allows
  if (u16 && w >= 2 && h >= 2 && d >= 2) {
    for (let z = 0; z < td; z++) for (let y = 0; y < th; y++) {
      const ob = (z * th + y) * tw;
      for (let x = 0; x < tw; x++) {
        const o00 = ((z * 2 * h + y * 2) * w + x * 2), o01 = o00 + w, o10 = o00 + w * h, o11 = o10 + w;
        const a0 = u16[o00], a1 = u16[o00 + 1], b0 = u16[o01], b1 = u16[o01 + 1], c0 = u16[o10], c1 = u16[o10 + 1], d0 = u16[o11], d1 = u16[o11 + 1];
        const v = Math.round((a0 + a1 + b0 + b1 + c0 + c1 + d0 + d1) / 8), q = (ob + x) * 2; out[q] = v & 255; out[q + 1] = v >> 8;
        if (withRange) { // smallest / largest of the eight words (a pairwise tournament: no variadic Math.min)
          const l1 = a0 < a1 ? a0 : a1, l2 = b0 < b1 ? b0 : b1, l3 = c0 < c1 ? c0 : c1, l4 = d0 < d1 ? d0 : d1, h1 = a0 < a1 ? a1 : a0, h2 = b0 < b1 ? b1 : b0, h3 = c0 < c1 ? c1 : c0, h4 = d0 < d1 ? d1 : d0;
          const l5 = l1 < l2 ? l1 : l2, l6 = l3 < l4 ? l3 : l4, h5 = h1 < h2 ? h2 : h1, h6 = h3 < h4 ? h4 : h3; lo[ob + x] = l5 < l6 ? l5 : l6; hi[ob + x] = h5 < h6 ? h6 : h5;
        }
      }
    }
  } else for (let z = 0; z < td; z++) for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let acc = 0, a = 65535, c = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) {
      const o = (((z * 2 + dz) * h + (y * 2 + dy)) * w + x * 2) * 2, v0 = src[o] | (src[o + 1] << 8), v1 = src[o + 2] | (src[o + 3] << 8); acc += v0 + v1;
      if (withRange) { a = Math.min(a, v0, v1); c = Math.max(c, v0, v1); }
    }
    const v = Math.round(acc / 8), o = ((z * th + y) * tw + x) * 2; out[o] = v & 255; out[o + 1] = v >> 8;
    if (withRange) { const i = (z * th + y) * tw + x; lo[i] = a; hi[i] = c; }
  }
  if (withRange && (w > 2 * tw || h > 2 * th || d > 2 * td)) { // the voxels halving drops (an odd last column / row / slice) belong to the last block along that axis
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x < 2 * tw && y < 2 * th && z < 2 * td) continue;
      const o = ((z * h + y) * w + x) * 2, v = src[o] | (src[o + 1] << 8), i = (Math.min(td - 1, z >> 1) * th + Math.min(th - 1, y >> 1)) * tw + Math.min(tw - 1, x >> 1);
      if (v < lo[i]) lo[i] = v; if (v > hi[i]) hi[i] = v;
    }
  }
  return withRange ? { data: out, dims: [tw, th, td], lo, hi } : { data: out, dims: [tw, th, td] };
}

export function halveRangeOf(src, dims) {
  const w = dims[0], h = dims[1], d = dims[2], tw = Math.max(1, w >> 1), th = Math.max(1, h >> 1), td = Math.max(1, d >> 1), lo = new Uint16Array(tw * th * td).fill(65535), hi = new Uint16Array(tw * th * td);
  for (let z = 0; z < d; z++) {
    const tz = Math.min(td - 1, z >> 1);
    for (let y = 0; y < h; y++) {
      const base = (tz * th + Math.min(th - 1, y >> 1)) * tw; let o = (z * h + y) * w * 2;
      for (let x = 0; x < w; x++, o += 2) { const v = src[o] | (src[o + 1] << 8), i = base + Math.min(tw - 1, x >> 1); if (v < lo[i]) lo[i] = v; if (v > hi[i]) hi[i] = v; }
    }
  }
  return { lo, hi };
}

// n731: the same extremes when the grid the VR draws was REDUCED from the source on its way in (buildVolumeData in vr-view.js: a source wider than 512 is area-averaged in the plane and a nearest slice is taken per output slice), so the 2x2x2 blocks of
// halveRangeOf would only see the averaged words. Here the extremes are taken from the SOURCE voxels, mapped straight to the grid the classification is made on (`small`: the half copy of the drawn grid when that is wider than 256, else the drawn grid itself).
// sourceRangeInit(sourceDims, drawDims, smallDims, xs, ys): xs / ys = the area spans of the in-plane reduction (span i = source columns xs[i] .. xs[i + 1] - 1 make drawn voxel i; the slice axis: drawn slice floor(s td / sd)); small = drawn voxel >> 1 when it is the half copy.
// sourceRangeAdd(acc, packed, z): one source slice (rg8-packed u16, sw x sh). -> acc.{lo, hi}: Uint16Array of the small grid. Main thread (not part of the worker source).
export function sourceRangeInit(sourceDims, drawDims, smallDims, xs, ys) {
  const sw = sourceDims[0], sh = sourceDims[1], sd = sourceDims[2], halved = smallDims[0] !== drawDims[0] || smallDims[1] !== drawDims[1] || smallDims[2] !== drawDims[2];
  const fold = (v, a) => halved ? Math.min(smallDims[a] - 1, v >> 1) : v;
  const xm = new Uint16Array(sw), ym = new Uint16Array(sh), zm = new Uint16Array(sd);
  for (let i = 0; i + 1 < xs.length; i++) for (let x = xs[i]; x < xs[i + 1] && x < sw; x++) xm[x] = fold(i, 0);
  for (let i = 0; i + 1 < ys.length; i++) for (let y = ys[i]; y < ys[i + 1] && y < sh; y++) ym[y] = fold(i, 1);
  for (let z = 0; z < sd; z++) zm[z] = fold(Math.min(drawDims[2] - 1, Math.floor(z * drawDims[2] / sd)), 2);
  const n = smallDims[0] * smallDims[1] * smallDims[2];
  return { lo: new Uint16Array(n).fill(65535), hi: new Uint16Array(n), dims: smallDims.slice(), sw, sh, xm, ym, zm };
}
export function sourceRangeAdd(acc, packed, z) {
  const sw = acc.sw, sh = acc.sh, w = acc.dims[0], h = acc.dims[1], lo = acc.lo, hi = acc.hi, xm = acc.xm, ym = acc.ym, zb = acc.zm[z] * h;
  for (let y = 0; y < sh; y++) {
    const base = (zb + ym[y]) * w; let o = y * sw * 2;
    for (let x = 0; x < sw; x++, o += 2) { const v = packed[o] | (packed[o + 1] << 8), i = base + xm[x]; if (v < lo[i]) lo[i] = v; if (v > hi[i]) hi[i] = v; }
  }
}

// computeBricksOf for the half copy, from the block extremes of halveRangeOf instead of the averaged words: a brick that holds a voxel kept thin by applyThinCls must not be skipped because the AVERAGE never reaches the segment's range. Same layout as computeBricksOf. Self-contained.
export function computeBricksRangeOf(lo, hi, dims, calibration, brick) {
  const tw = dims[0], th = dims[1], td = dims[2], slope = calibration[0], intercept = calibration[1], bias = calibration[2];
  const bx = Math.ceil(tw / brick), by = Math.ceil(th / brick), bz = Math.ceil(td / brick), mm = new Float32Array(bx * by * bz * 4);
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    let a = 65535, c = 0;
    const z0 = Math.max(0, k * brick - 1), z1 = Math.min(td, (k + 1) * brick + 1), y0 = Math.max(0, j * brick - 1), y1 = Math.min(th, (j + 1) * brick + 1), x0 = Math.max(0, i * brick - 1), x1 = Math.min(tw, (i + 1) * brick + 1);
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) { let o = (z * th + y) * tw + x0; for (let x = x0; x < x1; x++, o++) { if (lo[o] < a) a = lo[o]; if (hi[o] > c) c = hi[o]; } }
    const b = ((k * by + j) * bx + i) * 4, u = (a - bias) * slope + intercept, v = (c - bias) * slope + intercept; mm[b] = Math.min(u, v); mm[b + 1] = Math.max(u, v);
  }
  return { bricks: mm, brickDims: [bx, by, bz] };
}

export function coverRunsOnGrid(runs, sourceDims, dims, U, bb) {
  if (!runs) return U;
  const w = dims[0], h = dims[1], d = dims[2], sw = sourceDims[0], sh = sourceDims[1], sd = sourceDims[2];
  const lo = (s, n, t) => Math.max(0, Math.floor(s * t / n)), hi = (s, n, t) => Math.min(t - 1, Math.floor(((s + 1) * t - 1) / n)), zn = Math.min(sd, runs.length);
  for (let z = 0; z < zn; z++) {
    const rec = runs[z]; if (!rec || !rec.length) continue;
    const z0 = lo(z, sd, d), z1 = hi(z, sd, d);
    for (let i = 0; i < rec.length; i += 3) {
      if (rec[i] >= sh) continue; const y0 = lo(rec[i], sh, h), y1 = hi(rec[i], sh, h), xa = Math.min(rec[i + 1], sw - 1), xb = Math.min(rec[i + 2], sw - 1); if (xb < xa) continue;
      const x0 = lo(xa, sw, w), x1 = hi(xb, sw, w);
      if (bb) { if (x0 < bb.x0) bb.x0 = x0; if (x1 > bb.x1) bb.x1 = x1; if (y0 < bb.y0) bb.y0 = y0; if (y1 > bb.y1) bb.y1 = y1; if (z0 < bb.z0) bb.z0 = z0; if (z1 > bb.z1) bb.z1 = z1; }
      for (let tz = z0; tz <= z1; tz++) for (let ty = y0; ty <= y1; ty++) U.fill(1, (tz * h + ty) * w + x0, (tz * h + ty) * w + x1 + 1);
    }
  }
  return U;
}
// -> Uint32Array of the voxel indexes to RESTORE (put to the extreme byte): EVERY voxel of U that the reduction did NOT set (isSet(i) false: judged before any change) and that has no set voxel in its 26 neighbours (the structure is not represented there at all: it has
// vanished). However small the piece is, it is kept: a voxel of U holds a source voxel that is really there (nothing is made up), so no size or isolation test is applied. Voxels the reduction set are never changed (no beads along a surface), and a voxel beside a set one
// is left as the reduction made it (the structure is still drawn there, and no new bump is made on a wall that is partly there: an earlier change); a thick body has no such voxel. box: optional {x0, x1, y0, y1, z0, z1} that holds every voxel of U. Self-contained.
export function thinKeepOf(U, isSet, dims, box) {
  const w = dims[0], h = dims[1], d = dims[2], lost = [];
  const x0 = box ? box.x0 : 0, x1 = box ? box.x1 : w - 1, y0 = box ? box.y0 : 0, y1 = box ? box.y1 : h - 1, z0 = box ? box.z0 : 0, z1 = box ? box.z1 : d - 1;
  if (x1 < x0 || y1 < y0 || z1 < z0) return new Uint32Array(0);
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0, i = (z * h + y) * w + x0; x <= x1; x++, i++) if (U[i] && !isSet(i)) lost.push(i);
  return thinKeepLostOf(lost, isSet, dims);
}
// the same from the list of the voxels of U that the reduction did not set (index order), without the scan of the grid: judged on isSet as it is. Self-contained.
export function thinKeepLostOf(lost, isSet, dims) {
  const w = dims[0], h = dims[1], d = dims[2], out = [];
  for (const i of lost) {
    const x = i % w, y = ((i / w) | 0) % h, z = (i / (w * h)) | 0; let beside = false;
    for (let dz = -1; dz <= 1 && !beside; dz++) { const zz = z + dz; if (zz < 0 || zz >= d) continue; for (let dy = -1; dy <= 1 && !beside; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if ((!dx && !dy && !dz) || xx < 0 || xx >= w) continue; if (isSet((zz * h + yy) * w + xx)) { beside = true; break; } } } }
    if (!beside) out.push(i);
  }
  return Uint32Array.from(out);
}

// the processing masks of the segments on the grid `dims` (RGBA, channel = GPU slot): the WebGPU edit runs mapped with gpuRunsForTexture (exclude runs dilated by one on a reduced
// grid, as the WebGPU volume does). descs: [{si: the slot, mode: 'exclude' | other, maskOnly, runs}] in slot order (only the segments that have runs); sourceDims: the volume's own grid.
// Returns {activeMask, maskOnly, data | null}. Self-contained (it is also the worker's source).
// opt.thinKeep (VR preparation only; the PC callers pass nothing, their bytes are unchanged): on a REDUCED grid a mask's region that the normal mapping would lose or leave thinner than one voxel is kept (coverRunsOnGrid / thinKeepOf above): an included region
// keeps byte 255 at the voxels of T, an excluded one 0; they are returned in `thin` ([{si, val, idx}]) so that forceThinMask can put them back after the smoothing, which pulls a lone voxel's byte to just over 128 (a surface of no width).
export function buildEditMaskOf(descs, sourceDims, dims, opt) {
  const w = dims[0], h = dims[1], d = dims[2], reduced = w !== sourceDims[0] || h !== sourceDims[1] || d !== sourceDims[2], thinOn = !!(opt && opt.thinKeep) && reduced, thin = [];
  let activeMask = 0, maskOnly = 0, data = null, cover = null;
  for (const desc of descs) {
    const si = desc.si, runs = gpuRunsForTexture(desc.runs, sourceDims, dims, { dilate: reduced && desc.mode === 'exclude' ? 1 : 0 });
    data = data || new Uint8Array(w * h * d * 4); activeMask |= 1 << si; if (desc.maskOnly) maskOnly |= 1 << si;
    const on = desc.mode === 'exclude' ? 0 : 255;
    if (desc.mode === 'exclude') for (let i = si; i < data.length; i += 4) data[i] = 255;
    for (let z = 0; z < d; z++) {
      const rec = runs ? runs[z] : null; if (!rec || !rec.length) continue;
      for (let i = 0; i < rec.length; i += 3) { const o = (z * h + rec[i]) * w; for (let x = rec[i + 1]; x <= rec[i + 2]; x++) data[(o + x) * 4 + si] = on; }
    }
    if (thinOn && desc.runs) {
      const inc = desc.mode !== 'exclude', ch = data; cover = cover ? cover.fill(0) : new Uint8Array(w * h * d); const bb = { x0: w, x1: -1, y0: h, y1: -1, z0: d, z1: -1 }; coverRunsOnGrid(desc.runs, sourceDims, dims, cover, bb);
      const idx = thinKeepOf(cover, inc ? i => ch[i * 4 + si] >= 128 : i => ch[i * 4 + si] < 128, dims, bb), val = inc ? 255 : 0;
      for (let k = 0; k < idx.length; k++) data[idx[k] * 4 + si] = val;
      if (idx.length) thin.push({ si, val, idx });
    }
  }
  return thinOn ? { activeMask, maskOnly, data, thin } : { activeMask, maskOnly, data };
}
// the voxels of T of buildEditMaskOf put back to their extreme byte (after smoothEditMaskOf; the smoothed field keeps its side of 0.5 but a thin region's own voxels sit at about 128, which is no width). Self-contained.
export function forceThinMask(data, thin) {
  if (!data || !thin) return 0; let n = 0;
  for (const t of thin) { const idx = t.idx; for (let k = 0; k < idx.length; k++) data[idx[k] * 4 + t.si] = t.val; n += idx.length; }
  return n;
}
export function thinMarksInit(sourceDims, drawDims, smallDims, xs, ys, calib, state, order, descs) {
  const sw = sourceDims[0], sh = sourceDims[1], sd = sourceDims[2], halved = smallDims[0] !== drawDims[0] || smallDims[1] !== drawDims[1] || smallDims[2] !== drawDims[2];
  const fold = (v, a) => halved ? Math.min(smallDims[a] - 1, v >> 1) : v;
  const xm = new Uint16Array(sw), ym = new Uint16Array(sh), zm = new Uint16Array(sd);
  if (xs) for (let i = 0; i + 1 < xs.length; i++) for (let x = xs[i]; x < xs[i + 1] && x < sw; x++) xm[x] = fold(i, 0); else for (let x = 0; x < sw; x++) xm[x] = fold(Math.min(drawDims[0] - 1, x), 0);
  if (ys) for (let i = 0; i + 1 < ys.length; i++) for (let y = ys[i]; y < ys[i + 1] && y < sh; y++) ym[y] = fold(i, 1); else for (let y = 0; y < sh; y++) ym[y] = fold(Math.min(drawDims[1] - 1, y), 1);
  for (let z = 0; z < sd; z++) zm[z] = fold(Math.min(drawDims[2] - 1, Math.floor(z * drawDims[2] / sd)), 2);
  const slope = calib[0], intercept = calib[1], bias = calib[2], lut = new Uint8Array(65536), mode = [0, 0, 0, 0], runs = [null, null, null, null];
  for (const dsc of descs || []) if (dsc && dsc.runs && !dsc.maskOnly && dsc.si >= 0 && dsc.si < 4) { mode[dsc.si] = dsc.mode === 'exclude' ? 2 : 1; runs[dsc.si] = dsc.runs; }
  let any = false;
  for (let si = 0; si < 4; si++) {
    const g = state[order[si]]; if (!g || !g.active || !g.enabled) continue;
    const masked = (descs || []).some(dsc => dsc && dsc.si === si && dsc.runs && dsc.maskOnly); if (masked) continue; // a mask-only slot: the mask is the structure (edit.thin)
    const lo = +g.min, hi = +g.max; any = true;
    for (let v = 0; v < 65536; v++) { const hu = (v - bias) * slope + intercept; if (hu >= lo && hu <= hi) lut[v] |= 1 << si; }
  }
  const n = smallDims[0] * smallDims[1] * smallDims[2];
  return { marks: new Uint8Array(n), dims: smallDims.slice(), sw, sh, xm, ym, zm, lut, mode, runs, any, allow: [null, null, null, null].map((_, si) => mode[si] ? new Uint8Array(sw * sh) : null) };
}
export function thinMarksAdd(acc, packed, z) {
  if (!acc.any) return;
  const sw = acc.sw, sh = acc.sh, w = acc.dims[0], h = acc.dims[1], marks = acc.marks, xm = acc.xm, ym = acc.ym, lut = acc.lut, zb = acc.zm[z] * h; let masked = 0;
  for (let si = 0; si < 4; si++) {
    if (!acc.mode[si]) continue; masked |= 1 << si; const al = acc.allow[si], keep = acc.mode[si] === 1; al.fill(keep ? 0 : 1);
    const rec = acc.runs[si][z]; if (rec) for (let i = 0; i < rec.length; i += 3) { if (rec[i] >= sh) continue; const o = rec[i] * sw; al.fill(keep ? 1 : 0, o + Math.min(rec[i + 1], sw - 1), o + Math.min(rec[i + 2], sw - 1) + 1); }
  }
  for (let y = 0; y < sh; y++) {
    const base = (zb + ym[y]) * w; let o = y * sw * 2;
    for (let x = 0; x < sw; x++, o += 2) {
      let m = lut[packed[o] | (packed[o + 1] << 8)]; if (!m) continue;
      if (m & masked) for (let si = 0; si < 4; si++) if (((m >> si) & 1) && acc.allow[si] && !acc.allow[si][y * sw + x]) m &= ~(1 << si);
      if (m) marks[base + xm[x]] |= m;
    }
  }
}
// The segments drawn by a VALUE range, and the masks' thin voxels, on the classification bytes `cls` (buildClsData's output on a reduced grid; FINAL bytes: after the mask fold).
//   a mask-only slot: its thin mask voxels (edit.thin, val 255) get byte 255 (the fold keeps a lone voxel at 191 at most);
//   any other slot: U = the grid voxels whose marks bit s is set (thinMarksAdd: exact, from the source voxels), S = bytes >= 128; thinKeepOf's voxels get 255, and where the slot has a processing mask its byte at them is put to 255 too (the source voxel is allowed by the mask).
// -> {done: the number of voxels set, thin: [{si, idx}] the voxels set on the value-range slots (the diagnostic HU view uses them)}. Self-contained apart from thinKeepOf (worker source).
export function applyThinCls(cls, dims, edit, state, order, marks) {
  if (!cls) return { done: 0, thin: [] };
  const n = dims[0] * dims[1] * dims[2], C = cls.C, out = cls.data, thin = [];
  const maskOk = !!(edit && edit.data && edit.dims.join() === dims.join()); let done = 0;
  for (let si = 0; si < 4; si++) {
    const ch = cls.chan[si]; if (ch < 0) continue;
    const masked = maskOk && ((edit.active >> si) & 1), maskOnly = masked && ((edit.maskOnly >> si) & 1);
    if (maskOnly) { for (const t of edit.thin || []) if (t.si === si && t.val === 255) for (let k = 0; k < t.idx.length; k++) out[t.idx[k] * C + ch] = 255, done++; continue; }
    if (!marks) continue;
    const lost = []; for (let i = 0; i < n; i++) if (((marks[i] >> si) & 1) && out[i * C + ch] < 128) lost.push(i); // U (marks) and not set: only these can vanish
    if (!lost.length) continue;
    const idx = thinKeepLostOf(lost, i => out[i * C + ch] >= 128, dims);
    for (let k = 0; k < idx.length; k++) { out[idx[k] * C + ch] = 255; if (masked) edit.data[idx[k] * 4 + si] = 255; }
    done += idx.length; if (idx.length) thin.push({ si, idx });
  }
  return { done, thin };
}

export function thinHuData(src, dims, thin, calib) {
  const w = dims[0], h = dims[1], d = dims[2], wh = w * h, slope = calib[0], intercept = calib[1], bias = calib[2], out = src.slice();
  if (!slope) return out;
  for (const t of thin || []) {
    const lo = +t.lo, hi = +t.hi, raw = Math.max(0, Math.min(65535, Math.round(((lo + hi) / 2 - intercept) / slope + bias)));
    const inR = i => { const hu = ((out[i * 2] | (out[i * 2 + 1] << 8)) - bias) * slope + intercept; return hu >= lo && hu <= hi; }, put = i => { if (!inR(i)) { out[i * 2] = raw & 255; out[i * 2 + 1] = raw >> 8; } };
    const idx = t.idx;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], x = i % w, y = ((i / w) | 0) % h, z = (i / wh) | 0;
      put(i); if (x > 0) put(i - 1); if (x < w - 1) put(i + 1); if (y > 0) put(i - w); if (y < h - 1) put(i + w); if (z > 0) put(i - wh); if (z < d - 1) put(i + wh);
    }
  }
  return out;
}

export function smoothEditMaskOf(data, dims, slots, opt) {
  const w = dims[0], h = dims[1], d = dims[2], wh = w * h, pad = opt && opt.pad != null ? opt.pad | 0 : 5; let done = 0;
  if (!data || !slots) return 0;
  for (let s = 0; s < 4; s++) {
    if (!((slots >> s) & 1)) continue;
    let x0 = w, y0 = h, z0 = d, x1 = -1, y1 = -1, z1 = -1;
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) {
      let o = (z * h + y) * w * 4 + s;
      for (let x = 0; x < w; x++, o += 4) {
        const v = data[o] >= 128; let diff = false;
        if (x + 1 < w && (data[o + 4] >= 128) !== v) { diff = true; if (x + 1 > x1) x1 = x + 1; }
        if (y + 1 < h && (data[o + w * 4] >= 128) !== v) { diff = true; if (y + 1 > y1) y1 = y + 1; }
        if (z + 1 < d && (data[o + wh * 4] >= 128) !== v) { diff = true; if (z + 1 > z1) z1 = z + 1; }
        if (diff) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z; }
      }
    }
    if (x1 < 0) continue; // all one side: nothing to smooth
    // (a boundary found only through a +1 neighbour extended the max side above; the min side is the voxel itself, so the box holds both voxels of every boundary pair)
    const lx = Math.max(0, x0 - pad), ly = Math.max(0, y0 - pad), lz = Math.max(0, z0 - pad), bw = Math.min(w - 1, x1 + pad) - lx + 1, bh = Math.min(h - 1, y1 + pad) - ly + 1, bd = Math.min(d - 1, z1 + pad) - lz + 1;
    const codes = new Uint8Array(bw * bh * bd);
    for (let z = 0, i = 0; z < bd; z++) for (let y = 0; y < bh; y++) { let o = (((lz + z) * h + ly + y) * w + lx) * 4 + s; for (let x = 0; x < bw; x++, i++, o += 4) codes[i] = data[o] >= 128 ? 1 : 0; }
    const field = partFieldOf(codes, [bw, bh, bd], opt);
    for (let z = 0, i = 0; z < bd; z++) for (let y = 0; y < bh; y++) { let o = (((lz + z) * h + ly + y) * w + lx) * 4 + s; for (let x = 0; x < bw; x++, i++, o += 4) data[o] = field[i]; }
    done++;
  }
  return done;
}

// an earlier change (3): the smoothing above is the heaviest step of the preparation (the cat: ~1.5 s of 3.4 s) and a change of the state (the shown / enabled segments) ran it again over masks that had not changed. smoothEditMaskOf itself is untouched; this
// is its caller's memory: per slot, a hash of the slot's RAW bytes (before smoothing) + dims + opt is the key of what the smoothing changed there (the box of the changed bytes, the bytes smoothEditMaskOf wrote: outside that box the smoothed
// byte is the raw one, so putting the box back is the very bytes). memo = [{key, lx, ly, lz, bw, bh, bd, block}] (block: ArrayBuffer | null when the smoothing changed nothing); -> {done, fresh: the entries made now}. Self-contained apart from smoothEditMaskOf (it is also the worker's source).
export function smoothEditMaskMemoOf(data, dims, slots, opt, memo) {
  const w = dims[0], h = dims[1], d = dims[2], n = w * h * d, fresh = [], known = new Map((memo || []).map(e => [e.key, e])); let done = 0;
  if (!data || !slots) return { done: 0, fresh };
  const raw = new Uint8Array(n), ok = opt || {};
  for (let s = 0; s < 4; s++) {
    if (!((slots >> s) & 1)) continue;
    for (let i = 0, o = s; i < n; i++, o += 4) raw[i] = data[o];
    let a = 0x811c9dc5 | 0, b = 0x1b873593 | 0; const n4 = n >> 2, u = new Uint32Array(raw.buffer, 0, n4);
    for (let i = 0; i < n4; i++) { a = Math.imul(a ^ u[i], 0x01000193); b = Math.imul(b + u[i], 0x85ebca6b) ^ (b >>> 13); }
    for (let i = n4 << 2; i < n; i++) { a = Math.imul(a ^ raw[i], 0x01000193); b = Math.imul(b + raw[i], 0x85ebca6b) ^ (b >>> 13); }
    const key = [dims.join('x'), ok.band, ok.sigma, ok.margin, ok.pad, (a >>> 0).toString(16), (b >>> 0).toString(16)].join('|');
    let e = known.get(key);
    if (!e) {
      smoothEditMaskOf(data, dims, 1 << s, opt);
      let x0 = w, y0 = h, z0 = d, x1 = -1, y1 = -1, z1 = -1;
      for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (data[i * 4 + s] !== raw[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      e = { key, lx: 0, ly: 0, lz: 0, bw: 0, bh: 0, bd: 0, block: null };
      if (x1 >= 0) {
        e = { key, lx: x0, ly: y0, lz: z0, bw: x1 - x0 + 1, bh: y1 - y0 + 1, bd: z1 - z0 + 1, block: null };
        const blk = new Uint8Array(e.bw * e.bh * e.bd);
        for (let z = 0, i = 0; z < e.bd; z++) for (let y = 0; y < e.bh; y++) { let o = (((z0 + z) * h + y0 + y) * w + x0) * 4 + s; for (let x = 0; x < e.bw; x++, i++, o += 4) blk[i] = data[o]; }
        e.block = blk.buffer;
      }
      fresh.push(e); known.set(key, e); done++;
    } else if (e.block) {
      const blk = new Uint8Array(e.block);
      for (let z = 0, i = 0; z < e.bd; z++) for (let y = 0; y < e.bh; y++) { let o = (((e.lz + z) * h + e.ly + y) * w + e.lx) * 4 + s; for (let x = 0; x < e.bw; x++, i++, o += 4) data[o] = blk[i]; }
      done++;
    } else done++;
  }
  return { done, fresh };
}

export function hideIndexOf(srcRuns, sourceDims, dims) {
  const w = dims[0], h = dims[1], d = dims[2], sw = sourceDims[0], sh = sourceDims[1], sd = sourceDims[2], wh = w * h, own = new Uint8Array(wh * d), items = srcRuns.slice(0, 255);
  const same = w === sw && h === sh && d === sd, finer = w > sw || h > sh || d > sd;
  if (same || finer) {
    for (const k of gpuOwnerOrder(items, sourceDims)) { // the last painted owns a voxel
      const runs = same ? items[k] : gpuRunsForTexture(items[k], sourceDims, dims, { dilate: 0 }); if (!runs) continue;
      for (let z = 0; z < d && z < runs.length; z++) { const rec = runs[z]; if (!rec || !rec.length) continue; for (let i = 0; i < rec.length; i += 3) { if (rec[i] >= h) continue; const o = (z * h + rec[i]) * w; own.fill(k + 1, o + rec[i + 1], o + Math.min(rec[i + 2], w - 1) + 1); } }
    }
    return own;
  }
  gpuOwnerSlices(items, sourceDims, dims, (z, sl) => { own.set(sl, z * wh); }); // ids <= 255: the Uint16 slice fits
  return own;
}

// the analysis results on the grid: item = {color, segMask: bit s = the result belongs to GPU slot s, runsBySlice, mm3, segmentKeys, rid}. Colour index per voxel
// (0 none, 1..14 = the distinct colours in list order, at most 14; a later result wins where two overlap), the result's id (list position + 1, up to 255) per voxel, the colours, the
// slot bits per colour and the list. Self-contained (it is also the worker's source).
export function buildRegionIndexOf(items, sourceDims, dims) {
  if (!items.length) return { data: null, colors: [], segs: [], list: [] };
  const w = dims[0], h = dims[1], d = dims[2], colors = [], segs = [], data = new Uint8Array(w * h * d), ids = new Uint8Array(w * h * d), list = [];
  // ids = the result's list position + 1 per voxel (up to 255 results; a later result wins where two overlap) = what the GPU reads;
  // data = the colour index (1..14 distinct colours) per voxel, only for the label histogram, which counts by colour (a result whose colour is the 15th is in ids but not in data)
  // on a REDUCED grid the nearest-voxel mapping below picks ONE source voxel per coarse voxel, which on a thin bone often lies outside the result (index 0 = the base colour, grey streaks and specks).
  // So there is a second pass (after the loop): a coarse voxel that is still 0 takes the result(s) that have ANY voxel in the source block it covers. Voxels the first pass painted are never overwritten
  // (a neighbouring bone is not eaten); among several results in one block the later one in the list wins (the same rule as the first pass), in ids and in data alike. Same grid: no second pass, output unchanged.
  const reduced = w !== sourceDims[0] || h !== sourceDims[1] || d !== sourceDims[2], placed = [];
  for (const r of items) {
    if (list.length >= 255) break; const id = list.length + 1;
    const c = Number(r.color) >>> 0; let k = colors.indexOf(c); if (k < 0 && colors.length < 14) { colors.push(c); segs.push(0); k = colors.length - 1; }
    if (k >= 0) segs[k] |= r.segMask | 0;
    if (reduced && r.runsBySlice) placed.push({ src: r.runsBySlice, id, k });
    const runs = gpuRunsForTexture(r.runsBySlice, sourceDims, dims, { dilate: 0 });
    for (let z = 0; z < d; z++) { const rec = runs ? runs[z] : null; if (!rec || !rec.length) continue; for (let i = 0; i < rec.length; i += 3) { const o = (z * h + rec[i]) * w; if (k >= 0) data.fill(k + 1, o + rec[i + 1], o + rec[i + 2] + 1); ids.fill(id, o + rec[i + 1], o + rec[i + 2] + 1); } }
    list.push({ color: c, mm3: r.mm3, segmentKeys: r.segmentKeys.slice(), rid: r.rid, segMask: r.segMask | 0 }); // segMask: the slot bits as prepared (the session's look-up table / histogram use these, not the runtime slot order)
  }
  if (placed.length) {
    const sw = sourceDims[0], sh = sourceDims[1], sd = sourceDims[2], hole = new Uint8Array(w * h * d); // hole = still 0 after the first pass (judged on ids: a 15th-colour result is in ids only)
    for (let i = 0; i < hole.length; i++) if (ids[i] === 0) hole[i] = 1;
    // source voxel s of n lies in the coarse voxels floor(s*t/n) .. floor(((s+1)*t-1)/n) of t (2:1: s >> 1); clamped, so an odd or non-integer ratio never writes outside the grid
    const lo = (s, n, t) => Math.max(0, Math.floor(s * t / n)), hi = (s, n, t) => Math.min(t - 1, Math.floor(((s + 1) * t - 1) / n));
    for (const p of placed) { // list order: a later result overwrites an earlier one's second-pass voxels (never a first-pass voxel: not a hole)
      const src = p.src, zn = Math.min(sd, src.length);
      for (let z = 0; z < zn; z++) {
        const rec = src[z]; if (!rec || !rec.length) continue;
        const z0 = lo(z, sd, d), z1 = hi(z, sd, d);
        for (let i = 0; i < rec.length; i += 3) {
          if (rec[i] >= sh) continue; const y0 = lo(rec[i], sh, h), y1 = hi(rec[i], sh, h), xa = Math.min(rec[i + 1], sw - 1), xb = Math.min(rec[i + 2], sw - 1); if (xb < xa) continue;
          const x0 = lo(xa, sw, w), x1 = hi(xb, sw, w);
          for (let tz = z0; tz <= z1; tz++) for (let ty = y0; ty <= y1; ty++) { const o = (tz * h + ty) * w; for (let x = x0; x <= x1; x++) if (hole[o + x]) { ids[o + x] = p.id; if (p.k >= 0) data[o + x] = p.k + 1; } }
        }
      }
    }
  }
  // (VR_PREP_VERSION 8, 9): the hide index (hideIndexOf, above: an overlap goes to the item with fewer voxels, a reduced grid counts the source owners), from the source runs on every grid
  const hide = !colors.length ? null : hideIndexOf(items.slice(0, list.length).map(r => r.runsBySlice || null), sourceDims, dims);
  // VR_PREP_VERSION 7 (one-voxel growth): the shader reads the result's colour NEAREST at 0.75 x the SMALLEST voxel side behind the surface hit; the 0.5 iso-surface of hard-edged data lies inside the AIR
  // voxel's cell, and on anisotropic data (sample7: x / y voxels twice the z one) that read point often stays there: index 0 = the base colour, grey streaks along the voxel grid on obliquely seen surfaces.
  // So ids (only ids: the colour index `data`, which the label histogram counts, is NOT grown) is grown by ONE voxel into its 6 face neighbours, on every grid: a voxel still 0 takes the LARGEST id among
  // its face neighbours as they were before this pass (largest id = the latest result in the list = the rule of the passes above: a later result wins); a voxel that already has an id is never changed,
  // and a grown voxel never grows further. One pass, in place; the original ids of slices z - 1 and z are kept in two slice buffers (2 * w * h bytes), so neighbours are read as they were before the pass.
  // rowAny (d * h bytes, from the ids before the growth): a row whose own row and four neighbouring rows are all 0 cannot grow and is skipped (most of the grid is air).
  if (colors.length) {
    const wh = w * h, rowAny = new Uint8Array(d * h); let prev = new Uint8Array(wh), cur = new Uint8Array(wh);
    for (let r = 0, o = 0; r < d * h; r++, o += w) for (let x = 0; x < w; x++) if (ids[o + x]) { rowAny[r] = 1; break; }
    for (let z = 0; z < d; z++) {
      const t = prev; prev = cur; cur = t; const base = z * wh; cur.set(ids.subarray(base, base + wh)); // prev = slice z - 1 (original), cur = slice z (original); slice z + 1 is not written yet
      for (let y = 0; y < h; y++) {
        const r = z * h + y; if (!rowAny[r] && !(y > 0 && rowAny[r - 1]) && !(y < h - 1 && rowAny[r + 1]) && !(z > 0 && rowAny[r - h]) && !(z < d - 1 && rowAny[r + h])) continue;
        const ro = y * w;
        for (let x = 0; x < w; x++) {
          const i = ro + x; if (cur[i]) continue;
          let m = 0, v;
          if (x > 0 && (v = cur[i - 1]) > m) m = v;
          if (x < w - 1 && (v = cur[i + 1]) > m) m = v;
          if (y > 0 && (v = cur[i - w]) > m) m = v;
          if (y < h - 1 && (v = cur[i + w]) > m) m = v;
          if (z > 0 && (v = prev[i]) > m) m = v;
          if (z < d - 1 && (v = ids[base + wh + i]) > m) m = v;
          if (m) ids[base + i] = m;
        }
      }
    }
  }
  return { data: colors.length ? data : null, ids: colors.length ? ids : null, hide, colors, segs, list }; // hide: the index the hidden-result test reads (the texture's G channel, the picks), ids: the colour / label index (R)
}

// an earlier change: the bytes of an RG8 index texture: R = the colour index (ids), G = the hide index (hide; absent: ids, the old rule). The VR / PC WebGL shader reads regionColor / childIdAt from R and the hidden tests from G.
export function rgIndexBytes(ids, hide) {
  const n = ids.length, out = new Uint8Array(n * 2), g = hide && hide.length === n ? hide : ids;
  for (let i = 0, o = 0; i < n; i++, o += 2) { out[o] = ids[i]; out[o + 1] = g[i]; }
  return out;
}
// (VR_PREP_VERSION 9): an index as the ONE array that is kept: rg (rgIndexBytes: rg[2 i] = R, the colour index, rg[2 i + 1] = G, the hide index), what the texture is made of and what the picks read
// (two bytes apart); ids and hide are not kept beside it (the returned object has no such fields). Made once, where the index is built (the worker, the child rebuild, the PC WebGL volume). Self-contained.
export function packIndexRg(idx) {
  if (!idx) return idx;
  const { ids, hide, ...rest } = idx;
  return { ...rest, rg: ids ? rgIndexBytes(ids, hide) : null };
}

// the CHILD SEGMENTS of the tree on the grid, in an index of their own (never the results' ids): items = [{key, segMask (bit s = the parent's GPU slot), runsBySlice}] -> {ids: 1..N per voxel (a later child wins where
// two overlap; up to 255), list: [{key, segMask, hash}] (hash = the mask's revision, to tell later whether the prepared list still matches the page's) (entry i + 1 of the child look-up table)}. Only the masks are prepared: colour, range and the shown flag are read at run time. Self-contained (also the worker's source).
// opt.thinKeep (VR preparation only; PC callers pass nothing): on a REDUCED grid a child the nearest-voxel mapping misses or leaves thinner than one voxel (a one to three voxel thick child lies between the sampled voxels, and the one-voxel dilation only
// grows what was sampled) keeps the grid voxels of T (coverRunsOnGrid / thinKeepOf above) in its id (finishChildIndex). A thick child's own voxels are not changed; but the voxels a thin child keeps overwrite another earlier child's id there (the later child wins, as everywhere), also where that earlier child is thick.
export function buildChildIndexOf(items, sourceDims, dims, opt) {
  if (!items || !items.length) return null;
  const w = dims[0], h = dims[1], d = dims[2], ids = new Uint8Array(w * h * d), list = [];
  // on a REDUCED grid the mask is dilated by one voxel (as the processing mask's exclude runs are): a coarse voxel the child only touches still belongs to it, so a hidden child leaves no sliver of its surface; same grid: no dilation
  const dilate = sourceDims[0] !== dims[0] || sourceDims[1] !== dims[1] || sourceDims[2] !== dims[2] ? 1 : 0;
  for (const r of items) {
    if (list.length >= 255) break; const id = list.length + 1;
    const runs = gpuRunsForTexture(r.runsBySlice, sourceDims, dims, { dilate });
    for (let z = 0; z < d; z++) { const rec = runs ? runs[z] : null; if (!rec || !rec.length) continue; for (let i = 0; i < rec.length; i += 3) { const o = (z * h + rec[i]) * w; ids.fill(id, o + rec[i + 1], o + rec[i + 2] + 1); } }
    list.push({ key: r.key, segMask: r.segMask | 0, hash: r.hash || '' });
  }
  return finishChildIndex(items, list, ids, sourceDims, dims, opt);
}
// (split out: the thin-keep pass sits between the loop and the hide index) Self-contained apart from hideIndexOf / coverRunsOnGrid / thinKeepOf (worker source).
export function finishChildIndex(items, list, ids, sourceDims, dims, opt) {
  const w = dims[0], h = dims[1], d = dims[2];
  if (opt && opt.thinKeep && (w !== sourceDims[0] || h !== sourceDims[1] || d !== sourceDims[2])) {
    const cov = new Uint8Array(w * h * d), keep = [];
    for (let k = 0; k < list.length; k++) { // T of each child (coverRunsOnGrid / thinKeepOf: judged on the ids as the loop above left them), applied afterwards in list order: where two children both keep a voxel the later one wins, as everywhere
      const r = items[k]; if (!r || !r.runsBySlice) continue;
      const bb = { x0: w, x1: -1, y0: h, y1: -1, z0: d, z1: -1 }; coverRunsOnGrid(r.runsBySlice, sourceDims, dims, cov, bb); if (bb.x1 < 0) continue; // only the child's own box is scanned and cleared (a session rebuilds this on the page's thread)
      keep.push({ id: k + 1, idx: thinKeepOf(cov, i => ids[i] === k + 1, dims, bb) });
      for (let z = bb.z0; z <= bb.z1; z++) for (let y = bb.y0; y <= bb.y1; y++) cov.fill(0, (z * h + y) * w + bb.x0, (z * h + y) * w + bb.x1 + 1);
    }
    for (const t of keep) for (let q = 0; q < t.idx.length; q++) if (!ids[t.idx[q]]) ids[t.idx[q]] = t.id; // only a voxel nobody owns: a voxel of another child (a tooth, a bone) is never taken
  }
  // an earlier change: the hide index (hideIndexOf: never dilated; an overlap goes to the child with fewer voxels) beside the colour / material index ids (dilated on a reduced grid as before); the hidden-child test reads it (the texture's G channel, the picks)
  const hide = hideIndexOf(items.slice(0, list.length).map(r => r.runsBySlice || null), sourceDims, dims);
  return { dims, ids, hide, list, dropped: Math.max(0, items.length - list.length) }; // dropped: children past the 255th (the look-up table has 255 rows): the caller warns, never silently
}

// distance-field.js buildDistanceBytes without the yields (it runs in the worker); progress(done, total) between channels
export function buildDistanceBytesSync(cls, dims, progress) {
  const n = dims[0] * dims[1] * dims[2], C = cls.C, out = new Uint8Array(n * C), inside = new Uint8Array(n);
  const scratch = { D: new Int32Array(n), a: new Uint8Array(n), b: new Uint8Array(n), dil: new Uint8Array(n) };
  for (let c = 0; c < C; c++) {
    if (progress) progress(c, C);
    for (let i = 0; i < n; i++) inside[i] = cls.data[i * C + c] >= 128 ? 1 : 0;
    const dist = euclideanDistanceBytes(inside, dims, scratch);
    for (let i = 0; i < n; i++) out[i * C + c] = dist[i];
  }
  if (progress) progress(C, C);
  return { data: out, C, chan: cls.chan };
}

// One worker job. m.t 'volume': {data: ArrayBuffer of the rg8 volume, dims, calib, brick, half: also the 256 copy} -> {data (returned), bricks, brickDims, half: {data, dims, bricks, brickDims} | null}.
// m.t 'cls': {src: ArrayBuffer of the grid the classification is built on, dims, calib, editDescs / editSourceDims (the processing masks, built here on `dims`), regionItems (the analysis index, built
// here on `dims`), order, state: {key: {active, enabled, min, max}}, brickDimsFull, brickDimsHalf | null, mask: the shown-segment mask of the combined texture (-1: none), maskField: {band, sigma, margin, pad} the smoothing of the classified slots' processing masks (smoothEditMaskOf; absent: the masks stay 0 / 255)}
// -> {cls, dist, combo, cls4, occFull, occHalf, src (comes back), edit: {data | null, active, maskOnly}, region}.
// post(message, transferList). Self-contained apart from the functions listed in prepWorkerSource.
export function prepRun(m, post) {
  try {
    if (m.t === 'volume') {
      const data = new Uint8Array(m.data), own = !m.half && m.rangeLo && m.rangeHi ? { lo: new Uint16Array(m.rangeLo), hi: new Uint16Array(m.rangeHi) } : null; // own: a drawn grid of at most 256 that was reduced on its way in: the classification is made on it, its bricks come from the source extremes too
      // the grid's own bricks: from the source extremes (a reduced drawn grid of at most 256), else from the 2x2x2 block extremes of the halving when the grid has a 256 copy and every side is even (brick k of 8 voxels with one voxel of overlap = the blocks 4k - 1 .. 4k + 4: at most one voxel wider
      // on each side than the exact brick, never narrower: a safe superset, and one pass over the blocks instead of the whole grid), else exactly as before (computeBricksOf)
      const evenAll = m.half && !(m.rangeLo && m.rangeHi) && m.dims.every(v => v >= 2 && (v & 1) === 0) && m.brick % 2 === 0;
      const hh = m.half ? halveData(data, m.dims, !(m.rangeLo && m.rangeHi)) : null, hr = !m.half ? null : m.rangeLo && m.rangeHi ? { lo: new Uint16Array(m.rangeLo), hi: new Uint16Array(m.rangeHi) } : { lo: hh.lo, hi: hh.hi };
      const b = computeBricksOf(data, m.dims, m.calib, m.brick);
      const out = { t: 'volume', id: m.id, data: m.data, bricks: b.bricks, brickDims: b.brickDims, half: null }, tr = [m.data, b.bricks.buffer]; // the extremes (m.rangeLo / rangeHi, or the halving's) only make the bricks: they are not kept (applyThinCls reads exact marks of the source voxels)
      if (m.half) {
        // n731: the half copy's bricks come from the block extremes (not the averaged words), (a brick that holds a voxel kept thin must not be skipped because the AVERAGE never reaches the range)
        const hb = computeBricksOf(hh.data, hh.dims, m.calib, m.brick); // m.rangeLo / rangeHi: the extremes of the SOURCE voxels when the drawn grid was reduced on its way in (sourceRangeInit)
        out.half = { data: hh.data, dims: hh.dims, bricks: hb.bricks, brickDims: hb.brickDims }; tr.push(hh.data.buffer, hb.bricks.buffer);
      }
      post(out, tr);
    } else if (m.t === 'cls') {
      // a failure of the mask or the index is reported and the picture goes on without it (as it did when they were built on the page)
      let maskMemoOut = []; const src = new Uint8Array(m.src), warnings = [], thinKeep = m.thinKeep !== false; // n731: thin structures are kept on a reduced grid (m.thinKeep === false only in the tests that pin the older reduction)
      let em; try { em = buildEditMaskOf(m.editDescs, m.editSourceDims, m.dims, { thinKeep }); } catch (e) { em = { activeMask: 0, maskOnly: 0, data: null }; warnings.push('processing mask: ' + String((e && e.message) || e)); }
      // n730 (rat brain voxel look): the masks of the slots that are classified (active and enabled) are smoothed before anything reads them (the classification fold, the occupancy, the texture); m.maskField absent: as before
      if (em.data && m.maskField) { try { let sl = 0; (m.order || []).slice(0, 4).forEach((k, si) => { const g = m.state && m.state[k]; if (g && g.active && g.enabled && ((em.activeMask >> si) & 1)) sl |= 1 << si; }); const sm = smoothEditMaskMemoOf(em.data, m.dims, sl, m.maskField, m.maskMemo); maskMemoOut = sm.fresh; } catch (e) { warnings.push('mask smoothing: ' + String((e && e.message) || e)); } }
      try { forceThinMask(em.data, em.thin); } catch (e) { warnings.push('thin mask: ' + String((e && e.message) || e)); } // n731: after the smoothing, the thin regions' own voxels are put back to 255 / 0 (a lone voxel the smoothing left at about 128 has no width)
      const edit = { data: em.data, dims: m.dims, active: em.activeMask, maskOnly: em.maskOnly, thin: em.thin || null, hard: true }; // hard: buildClsData folds the mask as 0 / 255 (>= 128 of the smoothed field: its sides are the mask's), as, so the shape bytes keep their strength; the smoothed field stays in edit.data (the texture) for the shading normals
      let region; try { region = packIndexRg(buildRegionIndexOf(m.regionItems, m.editSourceDims, m.dims)); } catch (e) { region = { data: null, rg: null, colors: [], segs: [], list: [] }; warnings.push('analysis index: ' + String((e && e.message) || e)); }
      let child = null; try { child = packIndexRg(buildChildIndexOf(m.childItems, m.editSourceDims, m.dims, { thinKeep })); } catch (e) { warnings.push('child index: ' + String((e && e.message) || e)); } // an earlier change: each index as its one RG array (packIndexRg)
      const cls = buildClsData({ dims: m.dims, data: src }, m.calib, edit, m.state, m.order);
      // n731: the thin structures of the segments (a value range's block extremes of the 256 copy, the masks' thin voxels) keep their one voxel in the FINAL classification bytes; the distance field, the combined texture and the occupancy below are made from them
      // marks: m.thinMarks (made on the page from the slices of a source that was reduced on its way in), or made here from m.body (the source grid's rg8 words, m.bodyDims = the editSourceDims) when this grid is the half copy of it; the body comes back
      let thinInfo = { done: 0, thin: [] };
      try {
        if (thinKeep && cls) {
          const marks = null;
          thinInfo = applyThinCls(cls, m.dims, edit, m.state, m.order, marks);
        }
      } catch (e) { warnings.push('thin structures: ' + String((e && e.message) || e)); }
      let dist = null, combo = null, cls4 = null;
      if (cls) {
        dist = buildDistanceBytesSync(cls, m.dims, (done, total) => post({ t: 'progress', id: m.id, done, total }, []));
        const four = cls.chan.includes(3);
        if (m.mask >= 0) combo = combineClassificationDistance(cls, dist, m.mask, null, { four });
        if (four) cls4 = fourthChannelBytes(cls);
      }
      const occFull = brickOccupancy(edit, m.brickDimsFull), occHalf = m.brickDimsHalf ? brickOccupancy(edit, m.brickDimsHalf) : null;
      const tr = [m.src, ...(m.body ? [m.body] : [])], bufs = [cls?.data, dist?.data, combo, cls4, occFull, occHalf, em.data, region.data, region.rg, child?.rg];
      for (const a of bufs) if (a && !tr.includes(a.buffer)) tr.push(a.buffer);
      post({ t: 'cls', id: m.id, cls, dist, combo, cls4, occFull, occHalf, src: m.src, ...(m.body ? { body: m.body } : {}), thin: thinInfo.thin, edit: { data: em.data, active: em.activeMask, maskOnly: em.maskOnly }, region, ...(child ? { child } : {}), warnings, maskMemo: maskMemoOut }, tr);
    } else post({ t: 'error', id: m.id, message: 'unknown job ' + m.t }, []);
  } catch (e) { post({ t: 'error', id: m.id, message: String((e && e.message) || e) }, []); }
}

const SEGMENT_ORDER_SRC = "const SEGMENT_ORDER=['bone','soft','fat','lung'];const INF=0x3fffffff;";
export const prepWorkerSource = () => [SEGMENT_ORDER_SRC, computeBricksOf, halveData, halveRangeOf, computeBricksRangeOf, coverRunsOnGrid, thinKeepOf, thinKeepLostOf, thinMarksInit, thinMarksAdd, buildClsData, morph3, euclideanDistanceBytes, combineClassificationDistance, fourthChannelBytes, cellRange, brickOccupancy, gpuRunRowMapToSlice, gpuLowerBound, gpuUpperBound, gpuDilateRuns, gpuRunsForTexture, gpuOwnerOrder, gpuOwnerSlices, buildEditMaskOf, forceThinMask, applyThinCls, partFieldOf, smoothEditMaskOf, smoothEditMaskMemoOf, hideIndexOf, buildRegionIndexOf, rgIndexBytes, packIndexRg, buildChildIndexOf, finishChildIndex, buildDistanceBytesSync, prepRun]
  .map(f => typeof f === 'string' ? f : f.toString()).join('\n') + '\nself.onmessage=e=>prepRun(e.data,(msg,tr)=>self.postMessage(msg,tr));';
const blobWorker = () => {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
  try {
    const url = URL.createObjectURL(new Blob([prepWorkerSource()], { type: 'text/javascript' })), w = new Worker(url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return w;
  } catch { return null; }
};

// The main-thread side: one worker for the life of one preparation. volume(job) / cls(job, onProgress) resolve with the worker's answer (or reject with its error);
// dispose() ends the worker and rejects what is still pending. Without a Worker the same job runs on this thread (slower, never wrong); a worker that dies fails its job.
export function createVolumePrep({ makeWorker = blobWorker } = {}) {
  let wk = null, started = false, seq = 0, dead = false;
  const pending = new Map(), stats = { worker: 0, local: 0 }; // stats: how many jobs ran in the worker / on this thread (a worker that could not start must be visible on the device)
  const start = () => {
    if (started) return wk; started = true;
    wk = makeWorker();
    if (!wk) return null;
    wk.onmessage = e => {
      const m = e.data, p = pending.get(m.id); if (!p) return;
      if (m.t === 'progress') { p.progress?.(m.done, m.total); return; }
      pending.delete(m.id);
      if (m.t === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    };
    wk.onerror = ev => { const err = new Error('prep worker: ' + (ev?.message || 'error')); for (const p of pending.values()) p.fail(err); pending.clear(); try { wk.terminate(); } catch { /* none */ } wk = null; };
    return wk;
  };
  const run = (job, transfer, progress) => new Promise((resolve, reject) => {
    if (dead) { reject(new Error('disposed')); return; }
    const id = ++seq, w = start();
    const local = () => { // the same job on this thread
      stats.local++; let out = null; prepRun({ ...job, id }, (m, tr) => { if (m.t === 'progress') progress?.(m.done, m.total); else out = m; });
      if (out && out.t === 'error') reject(new Error(out.message)); else resolve(out);
    };
    if (!w) { setTimeout(local, 0); return; }
    stats.worker++; pending.set(id, { resolve, reject, progress, fail: reject }); // a worker that dies took the transferred buffers with it: the job fails (no retry on stale data)
    try { w.postMessage({ ...job, id }, transfer); } catch (e) { pending.delete(id); reject(e); }
  });
  return {
    volume: job => run({ ...job, t: 'volume' }, [job.data, ...(job.rangeLo ? [job.rangeLo, job.rangeHi] : [])]),
    cls: (job, progress) => run({ ...job, t: 'cls' }, [job.src, ...(job.body ? [job.body] : []), ...(job.thinMarks ? [job.thinMarks] : [])], progress),
    get stats() { return { ...stats }; },
    get disposed() { return dead; },
    dispose() { dead = true; for (const p of pending.values()) p.reject(new Error('disposed')); pending.clear(); try { wk?.terminate(); } catch { /* none */ } wk = null; },
  };
}
