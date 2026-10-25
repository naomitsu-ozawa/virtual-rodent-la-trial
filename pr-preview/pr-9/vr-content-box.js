// VR content box. Pure helpers: no three.js, no DOM. Unit-tested in tests/unit/vr-content-box.test.js.
//
// The VR volume used to be drawn with the full data box as its proxy (BoxGeometry 2x2x2 scaled by halfExt): every pixel the box covers ran
// the fragment shader, also where the rays cross nothing but air (a body is much thinner than its bounding grid, and zoomed in the air
// around it fills most of the view). contentBox() gives the axis-aligned box of what the shader can show, in the volume's object space:
//  - the shown segments: every 8^3 brick of the rendered grid that is a candidate of a shown segment, by the shader's own brickClass() test
//    (HU min / max of the brick, one voxel of overlap, against the segment's range; a mask-only segment by its occupancy bit, vr-brick-occupancy.js),
//  - the CT slices of the sections, where they draw (HU above sliceAir, from the full-resolution grid the slice is resampled from),
//  - the cut faces (caps) are painted only where a segment is (segmentIndexAt >= 0), so they lie inside the segment part already;
//    clipping planes only remove, so they never need the box to grow.
// Why it is a superset of every drawn point: a drawn sample p classifies inside a segment from the trilinear corners of its cell; the lowest
// corner's brick holds (with its one-voxel overlap) all eight corners, so its HU range contains the interpolated value and it passes the
// range test (the classification byte >= 128 of a corner implies the corner's HU is in range, the mask only removes). p lies within one voxel
// of those corners: each candidate brick b contributes the voxel range [8b - 2, 8b + 9] (voxel-centre units) plus its normalised cell
// [b / cells, (b + 1) / cells] (the mapping the occupancy and the shader's brick lookup use), clamped to the data box.
// the rebuild never blocks a frame. The segment part is a resumable scan (segScanStart / segScanStep, a time budget per frame;
// until it is done the last box stays only when it provably still covers everything (segsSubset), else the full box is drawn), the slice part
// comes from per-axis slab maxima of the slice grid (sliceIndex once per grid, sliceRange per sliceAir: O(slabs)).
// The shader keeps the full box for the ray parameter (entry, sample positions, texture coordinates): the content box only limits the
// rasterised pixels and the far end of the march, so a pixel it covers renders exactly what the full box rendered (tools/vr-render-golden.mjs proves it).

export const BRICK = 8;

// candidate test of one brick (the shader's brickClass(tc) > 0): segs = [{min, max, on, maskOnly, maskAny}] x 4, mm = [min, max, occupancy nibble].
// maskAny: the data holds the segment as mask-only but the shader's editMaskOnly bit is off (詳細 editDiag 2): the classification
// bytes may still carry the mask, so the brick counts by its HU range or its occupancy bit (conservative)
export function brickShown(segs, mn, mx, occ) {
  for (let s = 0; s < segs.length; s++) {
    const g = segs[s]; if (!g || !g.on) continue;
    if (g.maskOnly) { if (((occ >> s) & 1) === 1) return true; continue; }
    if (g.max >= mn && g.min <= mx) return true;
    if (g.maskAny && ((occ >> s) & 1) === 1) return true;
  }
  return false;
}

// the normalised range a brick b (along one axis: d voxels, c bricks) contributes: its voxels plus 1.5 voxel, and its normalised cell
const brickLo = (b, d, c) => Math.min((BRICK * b - 1.5) / d, b / c);
const brickHi = (b, d, c) => Math.max((BRICK * b + BRICK + 1.5) / d, (b + 1) / c);

// grow the normalised (texture coordinate) range lo / hi (Float64Array(3) each, written) by every brick whose test(min, max, occ) holds.
// bricks: Float32Array 4 per brick (min, max, occupancy, 0) of a grid of dims voxels, brickDims bricks (ceil(dim / 8)). Returns the count
// (-1: the brick array is short). from / to: a linear brick range (resumable scans); no allocation per brick
export function growByBricks(bricks, brickDims, dims, test, lo, hi, from = 0, to = Infinity) {
  const bx = brickDims[0], by = brickDims[1], bz = brickDims[2], n = bx * by * bz; let count = 0;
  if (!bricks || bricks.length < n * 4) return -1;
  const dx = Math.max(1, dims[0]), dy = Math.max(1, dims[1]), dz = Math.max(1, dims[2]), end = Math.min(n, to);
  let i = from % bx, j = ((from / bx) | 0) % by, k = (from / (bx * by)) | 0;
  for (let q = from; q < end; q++) {
    const o = q * 4;
    if (test(bricks[o], bricks[o + 1], bricks[o + 2] | 0)) {
      count++;
      let l = brickLo(i, dx, bx), h = brickHi(i, dx, bx); if (l < lo[0]) lo[0] = l; if (h > hi[0]) hi[0] = h;
      l = brickLo(j, dy, by); h = brickHi(j, dy, by); if (l < lo[1]) lo[1] = l; if (h > hi[1]) hi[1] = h;
      l = brickLo(k, dz, bz); h = brickHi(k, dz, bz); if (l < lo[2]) lo[2] = l; if (h > hi[2]) hi[2] = h;
    }
    if (++i === bx) { i = 0; if (++j === by) { j = 0; k++; } }
  }
  return count;
}

// slice part: per-axis slab maxima of the slice grid's brick max (a brick is drawn by the slices when max > sliceAir, so along
// each axis the drawn bricks span exactly from the first to the last slab whose maximum is above the air level). Built once per grid (one
// pass, no sort; cached by the brick array); null when the grid has no bricks
const sliceCache = new WeakMap();
export function sliceIndex(grid) {
  if (!grid?.bricks || !grid.brickDims || !grid.dims) return null;
  const hit = sliceCache.get(grid.bricks); if (hit && hit.dims === grid.dims) return hit;
  const [bx, by, bz] = grid.brickDims, n = bx * by * bz, b = grid.bricks;
  if (b.length < n * 4) return null;
  const x = new Float32Array(bx).fill(-Infinity), y = new Float32Array(by).fill(-Infinity), z = new Float32Array(bz).fill(-Infinity);
  let q = 0;
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++, q++) {
    const m = b[q * 4 + 1];
    if (m > x[i]) x[i] = m; if (m > y[j]) y[j] = m; if (m > z[k]) z[k] = m;
  }
  const idx = { slab: [x, y, z], brickDims: grid.brickDims, dims: grid.dims };
  sliceCache.set(grid.bricks, idx);
  return idx;
}

// grow lo / hi by the slice bricks above air (the same range growByBricks gives for the test max > air); returns the number of bricks in
// that slab range (an upper bound of the bricks above air; 0 = none)
export function sliceRange(idx, air, lo, hi) {
  const a0 = Number.isFinite(+air) ? +air : -500;
  let count = 1;
  { const v = idx.slab[0]; let any = false; for (let f = 0; f < v.length; f++) if (v[f] > a0) { any = true; break; } if (!any) return 0; }
  for (let a = 0; a < 3; a++) {
    const v = idx.slab[a], c = v.length, d = Math.max(1, idx.dims[a]);
    let f = 0; while (f < c && !(v[f] > a0)) f++;
    let e = c - 1; while (e > f && !(v[e] > a0)) e--;
    count *= e - f + 1;
    const bl = brickLo(f, d, c), bh = brickHi(e, d, c); if (bl < lo[a]) lo[a] = bl; if (bh > hi[a]) hi[a] = bh;
  }
  return count;
}

// lo / hi (normalised) -> the box in object space, written into out ({ c, h, full, empty }); he = the data box half extents
export function boxFromRange(he, lo, hi, out = { c: [0, 0, 0], h: [0, 0, 0] }) {
  out.full = false; out.empty = false;
  if (!(lo[0] <= hi[0] && lo[1] <= hi[1] && lo[2] <= hi[2])) { out.c[0] = out.c[1] = out.c[2] = 0; out.h[0] = out.h[1] = out.h[2] = 0; out.empty = true; return out; }
  const l0 = Math.max(0, lo[0]), l1 = Math.max(0, lo[1]), l2 = Math.max(0, lo[2]), h0 = Math.min(1, hi[0]), h1 = Math.min(1, hi[1]), h2 = Math.min(1, hi[2]);
  if (l0 <= 0 && l1 <= 0 && l2 <= 0 && h0 >= 1 && h1 >= 1 && h2 >= 1) { out.c[0] = out.c[1] = out.c[2] = 0; out.h[0] = he[0]; out.h[1] = he[1]; out.h[2] = he[2]; out.full = true; return out; }
  // texture coordinate -> object space: x = (tc - 0.5) * 2 hx, y = (0.5 - tc) * 2 hy (texture y runs down), z = (tc - 0.5) * 2 hz
  const x0 = (l0 - 0.5) * 2 * he[0], x1 = (h0 - 0.5) * 2 * he[0];
  const y0 = (0.5 - h1) * 2 * he[1], y1 = (0.5 - l1) * 2 * he[1];
  const z0 = (l2 - 0.5) * 2 * he[2], z1 = (h2 - 0.5) * 2 * he[2];
  out.c[0] = (x0 + x1) / 2; out.c[1] = (y0 + y1) / 2; out.c[2] = (z0 + z1) / 2; out.h[0] = (x1 - x0) / 2; out.h[1] = (y1 - y0) / 2; out.h[2] = (z1 - z0) / 2;
  return out;
}

// the content box (synchronous: tests, tools/vr-render-golden.mjs). opts:
//  halfExt: [x, y, z] the data box half extents (object space; texture x = +x, texture y = -y, texture z = +z)
//  grid: { bricks, brickDims, dims } the rendered grid (the 256 or 512 data in use)
//  segs: [{ min, max, on, maskOnly, maskAny }] x 4 in the shader's slot order (segsFromUniforms)
//  slices: true when CT slices are drawn (sections on with slice opacity > 0); sliceGrid: { bricks, brickDims, dims } of the slice data
//  (the full-resolution grid), sliceAir: HU at or below which the slice is transparent
// Returns { c: [3], h: [3], full, empty, bricks, sliceBricks } in object space; full = the box equals the data box (nothing to gain:
// the caller draws the full box), empty = nothing can be drawn. Missing data -> full (fail-safe: never hides anything).
export function contentBox({ halfExt, grid, segs, slices = false, sliceGrid = null, sliceAir = -500 } = {}) {
  const he = halfExt || [1, 1, 1], FULL = { c: [0, 0, 0], h: [he[0], he[1], he[2]], full: true, empty: false, bricks: -1, sliceBricks: -1 };
  if (!grid?.bricks || !grid.brickDims || !grid.dims || !Array.isArray(segs)) return FULL;
  const lo = new Float64Array([Infinity, Infinity, Infinity]), hi = new Float64Array([-Infinity, -Infinity, -Infinity]);
  const nb = growByBricks(grid.bricks, grid.brickDims, grid.dims, (mn, mx, occ) => brickShown(segs, mn, mx, occ), lo, hi);
  if (nb < 0) return FULL;
  let ns = 0;
  if (slices) {
    const idx = sliceIndex(sliceGrid || grid);
    if (!idx) return FULL;
    ns = sliceRange(idx, sliceAir, lo, hi);
  }
  const out = boxFromRange(he, lo, hi);
  out.bricks = nb; out.sliceBricks = ns;
  return out;
}

// resumable segment scan: segScanStart copies the segments and resets; segScanStep scans up to budgetMs (checked every chunk
// bricks) and returns true when done. scan.lo / scan.hi / scan.count hold the result, scan.ms the total scan time, scan.frames the steps
export function createSegScan() {
  return { grid: null, segs: [{}, {}, {}, {}], test: null, q: 0, n: 0, lo: new Float64Array(3), hi: new Float64Array(3), count: 0, done: true, ms: 0, frames: 0 };
}
export function segScanStart(scan, grid, segs) {
  for (let s = 0; s < 4; s++) { const a = segs[s] || {}, o = scan.segs[s]; o.min = a.min; o.max = a.max; o.on = !!a.on; o.maskOnly = !!a.maskOnly; o.maskAny = !!a.maskAny; }
  scan.test ||= (mn, mx, occ) => brickShown(scan.segs, mn, mx, occ);
  scan.grid = grid; scan.q = 0; scan.count = 0; scan.ms = 0; scan.frames = 0; scan.done = false;
  scan.n = grid?.brickDims ? grid.brickDims[0] * grid.brickDims[1] * grid.brickDims[2] : 0;
  scan.lo.fill(Infinity); scan.hi.fill(-Infinity);
  return scan;
}
export function segScanStep(scan, budgetMs = 0.75, chunk = 1024, now = () => performance.now()) {
  if (scan.done) return true;
  const g = scan.grid, t0 = now();
  if (!g?.bricks) { scan.count = -1; scan.done = true; return true; }
  do {
    const to = Math.min(scan.n, scan.q + chunk), c = growByBricks(g.bricks, g.brickDims, g.dims, scan.test, scan.lo, scan.hi, scan.q, to);
    if (c < 0) { scan.count = -1; scan.q = scan.n; break; }
    scan.count += c; scan.q = to;
  } while (scan.q < scan.n && now() - t0 < budgetMs);
  scan.ms += now() - t0; scan.frames++;
  scan.done = scan.q >= scan.n;
  return scan.done;
}

// does a box built for old still cover everything new can draw? (each shown segment of new was shown in old with the same mask flags and
// a range inside the old range: every brick new accepts, old accepted)
export function segsSubset(next, old) {
  for (let s = 0; s < 4; s++) {
    const a = next[s], b = old[s]; if (!a?.on) continue;
    if (!b?.on || !!a.maskOnly !== !!b.maskOnly || !!a.maskAny !== !!b.maskAny) return false;
    if (!a.maskOnly && !(a.min >= b.min && a.max <= b.max)) return false;
  }
  return true;
}

// the shader's per-segment inputs from the material uniforms: segA (vec4 min, max, opacity, shown) x 4, the editMaskOnly bits the shader
// uses and dataMaskOnly = the mask-only bits of the edit data (P.edit.maskOnly; maskAny when the shader's bit is off). out: reused (no allocation)
export function segsFromUniforms(segA, editMaskOnly, out = [{}, {}, {}, {}], dataMaskOnly = 0) {
  for (let s = 0; s < 4; s++) {
    const v = segA[s], o = out[s]; o.min = v.x; o.max = v.y; o.on = v.w > 0.5;
    o.maskOnly = ((editMaskOnly >> s) & 1) === 1; o.maskAny = !o.maskOnly && ((dataMaskOnly >> s) & 1) === 1;
  }
  return out;
}

// has anything the segment part depends on changed since the last call? prev = a reused Float64Array(KEY_LEN) (written): the grid, per
// segment shown, min, max, mask flags. Compared every frame without allocating; the scan restarts only when this returns true
export const KEY_LEN = 3 + 4 * 4;
function put(prev, i, v) { if (prev[i] === v) return false; prev[i] = v; return true; }
export function contentKeyChanged(prev, segs, gridDims) {
  let changed = put(prev, 0, gridDims[0]); changed = put(prev, 1, gridDims[1]) || changed; changed = put(prev, 2, gridDims[2]) || changed;
  for (let s = 0; s < 4; s++) {
    const g = segs[s], o = 3 + s * 4, on = !!g.on;
    changed = put(prev, o, on ? 1 : 0) || changed; changed = put(prev, o + 1, on ? g.min : 0) || changed;
    changed = put(prev, o + 2, on ? g.max : 0) || changed; changed = put(prev, o + 3, on ? (g.maskOnly ? 1 : 0) + (g.maskAny ? 2 : 0) : 0) || changed;
  }
  return changed;
}
