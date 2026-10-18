import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { brickOccupancy, cellRange, writeBrickOccupancy, brickHasMask } from '../../docs/vr-brick-occupancy.js';

// build 526 (issue #132 for VR / AR): while a mask-only segment (Closing / hole filling) was shown, the VR shader's brickClass() made every
// brick "mixed" on the HU path (512^3 data, or the classification diagnostics off): no empty-space skipping. The occupancy nibble per brick
// (B channel of the brick texture) now says which bricks can hold a voxel of such a segment's mask, judged conservatively on the edit grid.

const edit = (dims, maskOnly, set) => { // set: (x, y, z) -> bits of the channels to switch on
 const [w, h, d] = dims, data = new Uint8Array(w * h * d * 4);
 for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const bits = set(x, y, z) | 0; for (let s = 0; s < 4; s++) if ((bits >> s) & 1) data[((z * h + y) * w + x) * 4 + s] = 255; }
 return { data, dims, active: maskOnly, maskOnly };
};
const idx = ([bx, by], i, j, k) => (k * by + j) * bx + i;

describe('brickOccupancy: nothing to store without a mask-only segment', () => {
 it('null when no mask-only bit, no data or odd dims', () => {
  expect(brickOccupancy({ data: new Uint8Array(8 * 4), dims: [2, 2, 2], maskOnly: 0 }, [1, 1, 1])).toBeNull();
  expect(brickOccupancy(null, [1, 1, 1])).toBeNull();
  expect(brickOccupancy({ data: new Uint8Array(8 * 4), dims: [2, 2, 2], maskOnly: 1 }, null)).toBeNull(); // no brick grid to fill
 });
 it('fail-safe: a mask-only segment without usable mask bytes marks every brick with its bits (mixed, never hidden)', () => {
  expect(Array.from(brickOccupancy({ data: null, dims: [2, 2, 2], maskOnly: 0b0101 }, [2, 1, 2]))).toEqual([5, 5, 5, 5]);
  expect(Array.from(brickOccupancy({ data: new Uint8Array(4), dims: [2, 2, 2], maskOnly: 1 }, [1, 1, 1]))).toEqual([1]); // too short
  expect(Array.from(brickOccupancy({ data: new Uint8Array(32), dims: null, maskOnly: 0b1000 }, [1, 2, 1]))).toEqual([8, 8]); // no dims
  expect(Array.from(brickOccupancy({ data: new Uint8Array(32), dims: [0, 2, 2], maskOnly: 1 }, [1, 1, 1]))).toEqual([1]);
 });
 it('a mask of a segment that is not mask-only is ignored; an empty mask-only mask gives all zero', () => {
  const e = edit([16, 16, 16], 0b0001, (x, y, z) => (x === 3 && y === 3 && z === 3 ? 0b0010 : 0)); // segment 1 set, only segment 0 is mask-only
  const occ = brickOccupancy(e, [2, 2, 2]);
  expect(Array.from(occ)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
 });
});

describe('cellRange: the cells a set edit voxel marks (linear footprint of one voxel plus one voxel of margin)', () => {
 it('same grid as the bricks (64 voxels, 8 cells of 8): a voxel well inside a cell marks that cell only, one near the edge marks the neighbour too', () => {
  const r = cellRange(64, 8);
  expect([r.lo[20], r.hi[20]]).toEqual([2, 2]); // (20-1.5)/64*8 = 2.31, (20+2.5)/64*8 = 2.81
  expect([r.lo[23], r.hi[23]]).toEqual([2, 3]); // 2.69 .. 3.19: its footprint reaches voxel 24 = cell 3
  expect([r.lo[16], r.hi[16]]).toEqual([1, 2]); // 1.81 .. 2.31: the margin reaches cell 1
  expect([r.lo[0], r.hi[0]]).toEqual([0, 0]);
  expect([r.lo[63], r.hi[63]]).toEqual([7, 7]);
 });
 it('half-size edit grid (the 512^3 case: 32 edit voxels for 8 cells, one cell = 4 edit voxels)', () => {
  const r = cellRange(32, 8);
  expect([r.lo[10], r.hi[10]]).toEqual([2, 3]); // 8.5/32*8 = 2.1, 12.5/32*8 = 3.1
  expect([r.lo[9], r.hi[9]]).toEqual([1, 2]);
 });
 it('one cell for everything (a tiny texture)', () => {
  const r = cellRange(16, 1);
  for (let e = 0; e < 16; e++) expect([r.lo[e], r.hi[e]]).toEqual([0, 0]);
 });
});

describe('brickOccupancy: bits per segment and brick index as the texture', () => {
 it('segment bits land in the bricks around the voxel, in the (bz*by+by)*bx+bx order', () => {
  const dims = [64, 32, 16], brickDims = [8, 4, 2]; // 8 voxels per cell on every axis
  const e = edit(dims, 0b0101, (x, y, z) => (x === 20 && y === 12 && z === 4 ? 0b0001 : 0) | (x === 63 && y === 31 && z === 15 ? 0b0100 : 0) | (x === 1 && y === 1 && z === 1 ? 0b0010 : 0));
  const occ = brickOccupancy(e, brickDims);
  expect(occ.length).toBe(64);
  expect(occ[idx(brickDims, 2, 1, 0)]).toBe(1); // (20, 12, 4): cells 2, 1, 0
  expect(occ[idx(brickDims, 7, 3, 1)]).toBe(4); // the last voxel: last cell, segment 2
  expect(Array.from(occ).filter(Boolean).length).toBe(2); // segment 1 is not mask-only: no mark at (1,1,1)
  expect(brickHasMask(occ, idx(brickDims, 2, 1, 0), 0)).toBe(true);
  expect(brickHasMask(occ, idx(brickDims, 2, 1, 0), 2)).toBe(false);
  expect(brickHasMask(null, 0, 0)).toBe(false);
 });
 it('a full mask marks every brick', () => {
  const occ = brickOccupancy(edit([16, 16, 16], 1, () => 1), [2, 2, 2]);
  expect(Array.from(occ)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
 });
});

// the shader samples editTex (linear filter, clamp to edge) at any point of a brick cell and takes >= 0.5 as "inside": wherever that
// is true the cell must carry the bit, and also one edit voxel beyond the cell (the margin)
const trilinear = (data, [w, h, d], s, tc) => {
 const e = [tc[0] * w - 0.5, tc[1] * h - 0.5, tc[2] * d - 0.5], i0 = e.map(Math.floor), f = e.map((v, k) => v - i0[k]), lim = [w - 1, h - 1, d - 1];
 const at = (x, y, z) => data[((Math.min(lim[2], Math.max(0, z)) * h + Math.min(lim[1], Math.max(0, y))) * w + Math.min(lim[0], Math.max(0, x))) * 4 + s] / 255;
 let v = 0;
 for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) v += at(i0[0] + dx, i0[1] + dy, i0[2] + dz) * (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
 return v;
};
describe('brickOccupancy is conservative: every point the shader could classify as inside lies in a marked brick', () => {
 const check = (dims, brickDims, density, seed) => {
  let h = seed; const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
  const e = edit(dims, 0b0011, () => (rnd() < density ? 1 : 0) | (rnd() < density ? 2 : 0)), occ = brickOccupancy(e, brickDims);
  const [bx, by, bz] = brickDims, S = 7; let inside = 0, cells = 0, tested = 0;
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
   const b = idx(brickDims, i, j, k); if (occ[b] !== 3) cells++; // only unmarked cells can fail
   for (let s = 0; s < 2; s++) {
    if ((occ[b] >> s) & 1) continue;
    // sample points: the cell itself plus one edit voxel beyond its faces (the margin)
    const m = [1 / dims[0], 1 / dims[1], 1 / dims[2]];
    const axis = (cell, n, step, q) => Math.min(0.999999, Math.max(0, (cell + step / S) / n + (step === 0 ? -m[q] : step === S ? m[q] : 0)));
    for (let a = 0; a <= S; a++) for (let c = 0; c <= S; c++) for (let g = 0; g <= S; g++) {
     const tc = [axis(i, bx, a, 0), axis(j, by, c, 1), axis(k, bz, g, 2)];
     tested++; if (trilinear(e.data, dims, s, tc) >= 0.5) inside++;
    }
   }
  }
  return { inside, cells, tested, marked: Array.from(occ).filter(Boolean).length, bricks: occ.length };
 };
 it('same grid, sparse mask', () => { const r = check([32, 32, 32], [4, 4, 4], 0.002, 7); expect(r.inside).toBe(0); expect(r.marked).toBeGreaterThan(0); expect(r.marked).toBeLessThan(r.bricks); });
 it('half-size edit grid under the bricks (512^3 data with the 256 mask), sparse mask', () => { const r = check([16, 16, 16], [4, 4, 4], 0.002, 11); expect(r.inside).toBe(0); expect(r.marked).toBeGreaterThan(0); expect(r.marked).toBeLessThan(r.bricks); });
 it('anisotropic grids', () => { const r = check([24, 12, 6], [6, 3, 2], 0.01, 3); expect(r.inside).toBe(0); expect(r.cells).toBeGreaterThan(0); });
 it('dense mask (most bricks marked, the unmarked ones are still clean)', () => { const r = check([16, 16, 16], [4, 4, 4], 0.03, 5); expect(r.inside).toBe(0); });
 it('non-integer voxels per cell (edit 37 under 5 bricks, 7.4 each; edit 50 under 8 bricks, 6.25 each)', () => {
  const a = check([37, 37, 37], [5, 5, 5], 0.0008, 13); expect(a.inside).toBe(0); expect(a.marked).toBeGreaterThan(0); expect(a.marked).toBeLessThan(a.bricks);
  const b = check([50, 20, 11], [8, 3, 2], 0.0015, 17); expect(b.inside).toBe(0); expect(b.marked).toBeGreaterThan(0); expect(b.marked).toBeLessThan(b.bricks);
 });
});

describe('writeBrickOccupancy: the B channel of the RGBA32F brick array', () => {
 it('writes the nibble, keeps min / max, clears with null', () => {
  const bricks = new Float32Array([-1000, 2000, 9, 0, -500, 300, 9, 0]);
  expect(writeBrickOccupancy(bricks, new Uint8Array([5, 0]))).toBe(1);
  expect(Array.from(bricks)).toEqual([-1000, 2000, 5, 0, -500, 300, 0, 0]);
  expect(writeBrickOccupancy(bricks, null)).toBe(0);
  expect(Array.from(bricks)).toEqual([-1000, 2000, 0, 0, -500, 300, 0, 0]);
 });
});

describe('vr-view.js uses the occupancy (static)', () => {
 const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
 it('brickClass takes the occupancy bit instead of the HU test for a mask-only segment, the HU test otherwise', () => {
  const brickClass = src.match(/int brickClass\(vec3 tc\)\{[\s\S]*?\n\}/)[0];
  expect(brickClass).toContain('vec3 mm=texture(bricks,clamp(tc,vec3(0.0),vec3(0.999999))).rgb;int occ=int(mm.z+0.5);');
  expect(brickClass).toContain('(((editMaskOnly>>s)&1)==1?((occ>>s)&1)==1:(a.y>=mm.x&&a.x<=mm.y))');
  expect(brickClass).toContain('((editMask>>s)&1)==0)return 2+s;return 1;'); // the uniform-brick return is still blocked for a masked segment
 });
 it('the brick texture is RGBA32F with four floats per brick, filled once in prepareVrData for both grids', () => {
  expect(src).toContain('b.format=THREE.RGBAFormat;b.type=THREE.FloatType;');
  expect(src).toContain('mm=new Float32Array(bx*by*bz*4)');
  expect(src).toContain('const b=((k*by+j)*bx+i)*4,a=(lo-bias)*slope+intercept');
  expect(src).toContain("from './vr-brick-occupancy.js?v=");
  expect(src).toContain('for(const g of [vd,half])if(g?.bricks)writeBrickOccupancy(g.bricks,brickOccupancy(edit,g.brickDims));');
  expect(src).not.toContain('b.format=THREE.RGFormat;b.type=THREE.FloatType;');
 });
 it('the membership test of the march is unchanged (the mask alone decides a mask-only segment)', () => {
  expect(src).toMatch(/\(\(editMaskOnly>>s\)&1\)==1\|\|\(v>=a\.x&&v<=a\.y\)/);
 });
});
