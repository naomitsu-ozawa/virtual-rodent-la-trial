// VR brick occupancy of the mask-only segments (build 526, issue #132 for VR / AR). Pure helpers: no three.js, no DOM.
//
// The VR shader's brickClass() (vr-view.js) skips an 8^3 brick when no shown segment can be inside it. A mask-only segment
// (Closing / hole filling, build 459) is decided by its mask alone, so the brick's HU min/max say nothing about it and every brick
// used to count as "mixed" while such a segment was shown: no empty-space skipping at all. That only matters on the HU path of the
// shader (the 512^3 data setting, or the classification / distance-field diagnostics off): the default 256^3 path skips with the
// distance field, which is built from the classification bytes that already fold the mask in (point-cls.js).
//
// brickOccupancy() builds one nibble per brick of the rendered grid: bit s = the brick holds a voxel of segment s's mask, judged
// on the EDIT grid (the edit mask is rasterised once on the <= 256 grid and sampled by normalised coordinate, so at 512^3 one brick
// is 4^3 edit voxels). Conservative on purpose: a set edit voxel marks every brick whose cell overlaps the voxel's trilinear
// footprint (the shader samples editTex with linear filtering and a 0.5 threshold: one voxel each side) plus a margin of one more
// edit voxel (nearest-filter diagnostic, the brick-exit nudge of step*0.05). A brick without the bit never holds a mask voxel the
// shader could see; a brick with it is sampled as before. The nibble rides in the B channel of the brick texture (RGBA32F; R, G =
// HU min / max as before), so brickClass reads it with the fetch it already makes.

// edit: {data: Uint8Array RGBA (channel s = mask of segment s, >= 128 set) | null, dims: [ew, eh, ed], maskOnly: bits of the
// mask-only segments}; brickDims: [bx, by, bz] of the rendered grid (ceil(dim / 8), as computeBricks). Returns a Uint8Array of
// bx*by*bz nibbles (index (bz*by+by)*bx+bx, as the texture) or null when no mask-only segment is active (nothing to store).
// Fail-safe: a mask-only segment whose mask bytes are missing or short gets every brick (the pre-526 "mixed" behaviour: slower,
// never a hidden segment).
export function brickOccupancy(edit, brickDims) {
 const maskOnly = (edit?.maskOnly | 0) & 15;
 if (!maskOnly) return null;
 const [bx, by, bz] = brickDims || [];
 if (!(bx > 0 && by > 0 && bz > 0)) return null;
 const occ = new Uint8Array(bx * by * bz), [ew, eh, ed] = edit.dims || [], data = edit.data;
 if (!data || !(ew > 0 && eh > 0 && ed > 0) || data.length < ew * eh * ed * 4) return occ.fill(maskOnly);
 const rx = cellRange(ew, bx), ry = cellRange(eh, by), rz = cellRange(ed, bz);
 for (let z = 0; z < ed; z++) {
  const z0 = rz.lo[z], z1 = rz.hi[z];
  for (let y = 0; y < eh; y++) {
   const y0 = ry.lo[y], y1 = ry.hi[y];
   let o = (z * eh + y) * ew * 4;
   for (let x = 0; x < ew; x++, o += 4) {
    let bits = 0;
    for (let s = 0; s < 4; s++) if ((maskOnly >> s) & 1 && data[o + s] >= 128) bits |= 1 << s;
    if (!bits) continue;
    const x0 = rx.lo[x], x1 = rx.hi[x];
    for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) { const row = (k * by + j) * bx; for (let i = x0; i <= x1; i++) occ[row + i] |= bits; }
   }
  }
 }
 return occ;
}

// per edit voxel e of an axis with n edit voxels and cells brick cells: the first and last cell whose range (cell c = normalised
// coordinate [c/cells, (c+1)/cells)) meets the voxel's influence. The voxel centre is (e+0.5)/n; linear filtering reaches one voxel
// each side and the margin adds one more: [(e-1.5)/n, (e+2.5)/n], clamped to the grid.
export function cellRange(n, cells) {
 const lo = new Int32Array(n), hi = new Int32Array(n);
 for (let e = 0; e < n; e++) {
  lo[e] = Math.max(0, Math.min(cells - 1, Math.floor((e - 1.5) / n * cells)));
  hi[e] = Math.max(0, Math.min(cells - 1, Math.floor((e + 2.5) / n * cells)));
 }
 return { lo, hi };
}

// writes the nibbles into the B channel of a brick array (Float32Array, 4 floats per brick: min, max, occupancy, 0). A null
// occupancy clears the channel (no mask-only segment: brickClass never reads it then). Returns the number of occupied bricks.
export function writeBrickOccupancy(bricks, occ) {
 const n = bricks.length >> 2; let count = 0;
 for (let b = 0; b < n; b++) { const v = occ ? occ[b] : 0; bricks[b * 4 + 2] = v; if (v) count++; }
 return count;
}

// the shader's own test, for the unit test and tools: segment s of a mask-only segment is a candidate of brick b
export const brickHasMask = (occ, b, s) => !!occ && ((occ[b] >> s) & 1) === 1;
