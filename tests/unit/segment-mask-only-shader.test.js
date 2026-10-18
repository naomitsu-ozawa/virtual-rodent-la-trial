import { describe, it, expect, vi } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { MedicalVolumeRenderer, volumeShader, volumePickShader } from '../../docs/medical-volume.js';
import * as MV from '../../docs/medical-volume.js';
import { readFileSync } from 'node:fs';

globalThis.GPUBufferUsage ??= { STORAGE: 0x80, COPY_DST: 0x8 };
function fakeRenderer(textureDims) {
  const written = [];
  const device = { limits: { maxStorageBufferBindingSize: 1 << 20 }, createBuffer: ({ size }) => ({ size, destroy: vi.fn() }), queue: { writeBuffer: (b, _o, data) => written.push(new Uint32Array(data)) } };
  const r = Object.create(MedicalVolumeRenderer.prototype);
  Object.assign(r, { device, textureDims, reducedVolume: false, rebuildBindGroup: vi.fn(), setAppliedCutRuns: vi.fn(), clearEditRuns: vi.fn(), clearAppliedCutRuns: vi.fn() });
  return { r, written };
}
const runs = (d, perSlice) => Array.from({ length: d }, (_, z) => new Uint32Array(perSlice[z] || []));

describe('edit descriptors: maskOnly flag', () => {
  it('keep + maskOnly sets bits s and 4+s of the keep word; plain keep only bit s; exclude neither', () => {
    const { r, written } = fakeRenderer([4, 2, 1]);
    const v = { columns: 4, rows: 2, slices: 1 };
    r.setEditRuns({
      bone: { mode: 'keep', maskOnly: true, runs: runs(1, { 0: [0, 0, 1] }) },
      soft: { mode: 'keep', runs: runs(1, { 0: [1, 2, 3] }) },
      fat: { mode: 'exclude', runs: runs(1, { 0: [0, 0, 0] }) },
    }, ['bone', 'soft', 'fat', 'lung'], v);
    const head = written.at(-2); // the row-index buffer is written before the intervals
    expect(head[0]).toBe(0b0111); // active: bone, soft, fat
    expect(head[1]).toBe(0b0001 | 0b0010 | 0b00010000); // keep: bone, soft; maskOnly: bone
  });
  it('without maskOnly the keep word is unchanged from before (no high bits)', () => {
    const { r, written } = fakeRenderer([4, 2, 1]);
    r.setEditRuns({ bone: { mode: 'keep', runs: runs(1, { 0: [0, 0, 1] }) } }, ['bone', 'soft', 'fat', 'lung'], { columns: 4, rows: 2, slices: 1 });
    expect(written.at(-2)[1]).toBe(1);
  });
});

describe('shaders: membership tests honour the mask-only bit', () => {
  const src = [volumeShader(), volumePickShader()];
  it('both shaders define segMember and parse', () => {
    for (const s of src) { expect(s).toMatch(/fn segMember\(/); expect(() => new WgslReflect(s)).not.toThrow(); }
  });
  it('no membership test is HU range && editAllows any more (they all use segMember)', () => {
    for (const s of src) expect(s.replace(/fn segMember[\s\S]*?\n}\n/, '')).not.toMatch(/v>=a\.x&&v<=a\.y&&editAllows/);
  });
  it('the brick classification does not skip a mask-only segment on HU range alone: it uses the brick occupancy (build 525)', () => {
    const brickClass = src[0].match(/fn brickClass\([\s\S]*?\n}\n/)[0];
    expect(brickClass).toMatch(/var cand=a\.y>=mm\.x&&a\.x<=mm\.y;if\(\(editRows\[1\]&\(16u<<s\)\)!=0u\)\{cand=\(occ&\(1u<<s\)\)!=0u;\}/);
    // the nibble is read after the row index (2 + 4 * (rowCount + 1) words), eight bricks per word, only when a mask-only bit is set
    expect(brickClass).toMatch(/if\(\(editRows\[1\]&240u\)!=0u\)\{let w=editRows\[2u\+4u\*\(u32\(dims\.y\)\*u32\(dims\.z\)\+1u\)\+brick\/8u\];occ=\(w>>\(\(brick%8u\)\*4u\)\)&15u;\}/);
    // the uniform-brick return is still blocked for any masked segment
    expect(brickClass).toMatch(/\(masks&\(1u<<s\)\)==0u\)\{return 2\+i32\(s\);\}/);
  });
  it('the VR shader and classification data carry the same flag', () => {
    const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(vr).toMatch(/uniform int editMaskOnly;/);
    expect(vr).toMatch(/\(\(editMaskOnly>>s\)&1\)==1\|\|\(v>=a\.x&&v<=a\.y\)/);
    // the classification builder moved to point-cls.js (shared with the PC 3D point markers, build 465)
    const cls = readFileSync(new URL('../../docs/point-cls.js', import.meta.url), 'utf8');
    expect(cls).toMatch(/else if\(maskOnly&&f<191\)f=191/);
  });
});

// build 525 (issue #132): while a mask-only segment is shown, every brick used to be "mixed" (no empty-space skip at all).
// setEditRuns now appends one nibble per 8^3 texture-grid brick after the row index: bit s = the brick holds a voxel of
// segment s's final mask. brickClass gates the mask-only candidates with it. Non-mask-only edits get no tail (unchanged).
describe('mask-only brick occupancy (build 525)', () => {
  const { editBrickOccupancy, gpuRunsForTexture } = MV;
  const nibble = (words, b) => (words[b >> 3] >>> ((b & 7) * 4)) & 15;
  it('is null without a mask-only segment', () => {
    expect(editBrickOccupancy([{ mode: 'keep', runs: runs(1, { 0: [0, 0, 1] }) }, null], [16, 16, 16])).toBeNull();
    expect(editBrickOccupancy([null, null, null, null], [16, 16, 16])).toBeNull();
  });
  it('sets bit s on exactly the bricks a run touches (texture grid 24x16x16, 3x2x2 bricks)', () => {
    // segment 2 (fat): z 9 (brick z 1), y 3 (brick y 0), x 5..17 (bricks x 0..2); segment 0 (bone, mask-only too): z 0, y 8, x 0
    const descs = [
      { mode: 'keep', maskOnly: true, runs: runs(16, { 0: [8, 0, 0] }) },
      { mode: 'keep', runs: runs(16, { 5: [0, 0, 23] }) }, // plain keep: not counted
      { mode: 'keep', maskOnly: true, runs: runs(16, { 9: [3, 5, 17] }) },
      null,
    ];
    const words = editBrickOccupancy(descs, [24, 16, 16], 8);
    expect(words.length).toBe(Math.ceil(12 / 8));
    const seen = {};
    for (let b = 0; b < 12; b++) if (nibble(words, b)) seen[b] = nibble(words, b);
    // brick index (bz*bcy+by)*bcx+bx with bcx 3, bcy 2
    expect(seen).toEqual({ [(0 * 2 + 1) * 3 + 0]: 1, [(1 * 2 + 0) * 3 + 0]: 4, [(1 * 2 + 0) * 3 + 1]: 4, [(1 * 2 + 0) * 3 + 2]: 4 });
  });
  it('ragged edge: a run ending at the last column fills the partial last brick and no further', () => {
    const words = editBrickOccupancy([null, null, { mode: 'keep', maskOnly: true, runs: runs(1, { 0: [0, 0, 19] }) }], [20, 8, 8], 8);
    expect(words.length).toBe(1);
    expect([0, 1, 2].map(b => nibble(words, b))).toEqual([4, 4, 4]);
  });
  it('a downscaled volume: the occupancy follows the texture-grid runs of gpuRunsForTexture, not the source grid', () => {
    // source 64^3 with a plate at z 38..42, y 18..22, x 10..50; texture 32^3 (every other voxel) => z 19..20, y 9..11, x 5..24
    const plate = {};
    for (let z = 38; z <= 42; z++) plate[z] = [18, 10, 50, 19, 10, 50, 20, 10, 50, 21, 10, 50, 22, 10, 50];
    const source = runs(64, plate);
    const tex = gpuRunsForTexture(source, [64, 64, 64], [32, 32, 32]);
    const words = editBrickOccupancy([{ mode: 'keep', maskOnly: true, runs: tex }], [32, 32, 32], 8);
    const occupied = [];
    for (let b = 0; b < 64; b++) if (nibble(words, b)) occupied.push(b);
    // bz 2, by 1, bx 0..3 (bcx = bcy = 4): (2*4+1)*4 + bx
    expect(occupied).toEqual([36, 37, 38, 39]);
    expect(nibble(words, 36)).toBe(1);
    // and it is NOT what the source-grid runs would give (bz 5, by 2 on a 64^3 grid) — guards against mixing the grids
    const wrong = editBrickOccupancy([{ mode: 'keep', maskOnly: true, runs: source }], [64, 64, 64], 8);
    expect(nibble(wrong, (5 * 8 + 2) * 8 + 1)).toBe(1);
    expect(nibble(wrong, 36)).toBe(0);
  });
  it('setEditRuns appends the nibbles after the row index only when a mask-only segment is present', () => {
    const v = { columns: 16, rows: 8, slices: 8 }, order = ['bone', 'soft', 'fat', 'lung'];
    const plain = fakeRenderer([16, 8, 8]);
    plain.r.brickSize = 8;
    plain.r.setEditRuns({ soft: { mode: 'keep', runs: runs(8, { 0: [0, 0, 3] }) } }, order, v);
    const rowCount = 8 * 8;
    expect(plain.written.at(-2).length).toBe(2 + 4 * (rowCount + 1)); // unchanged layout
    const mo = fakeRenderer([16, 8, 8]);
    mo.r.brickSize = 8;
    mo.r.setEditRuns({ soft: { mode: 'keep', runs: runs(8, { 0: [0, 0, 3] }) }, fat: { mode: 'keep', maskOnly: true, runs: runs(8, { 7: [7, 9, 9] }) } }, order, v);
    const head = mo.written.at(-2);
    expect(head.length).toBe(2 + 4 * (rowCount + 1) + 1); // 2 bricks => one word
    expect(head[1] & 0xf0).toBe(16 << 2);
    // brick (bz 0, by 0, bx 1) holds the fat voxel: nibble 1 = bit 2
    expect(nibble(head.subarray(2 + 4 * (rowCount + 1)), 1)).toBe(4);
    expect(nibble(head.subarray(2 + 4 * (rowCount + 1)), 0)).toBe(0);
  });
});
