import { describe, it, expect, vi } from 'vitest';
import { MedicalVolumeRenderer } from '../../docs/medical-volume.js';

// setAnalysisRuns packs the analysis regions into the single storage buffer
// the volume shader reads (analysisOverlayAt): [0]=colour table start,
// [1..rows+1]=offsets, then (x0|x1<<16, rgb|focused<<24|valid<<31) pairs per
// texture row, then the colour table (word for region k at [table+k]).
// Build 374 also uploads a region index texture: 4 bits per voxel, 8 voxels
// per u32 along x, k = region index + 1.
globalThis.GPUBufferUsage ??= { STORAGE: 0x80, COPY_DST: 0x8 };
globalThis.GPUTextureUsage ??= { TEXTURE_BINDING: 0x4, COPY_DST: 0x2 };
globalThis.GPUBufferUsage.COPY_SRC ??= 0x4;
function fakeRenderer(textureDims) {
  const written = [], textures = [];
  const device = {
    limits: { maxStorageBufferBindingSize: 1 << 20 },
    createBuffer: ({ size, mappedAtCreation }) => {
      const data = new ArrayBuffer(size);
      return { size, destroy: vi.fn(), mapped: !!mappedAtCreation, getMappedRange: () => data, unmap: vi.fn() };
    },
    createTexture: (desc) => ({ desc, destroy: vi.fn() }),
    // build 376: the region texture is filled in a staging buffer and copied with copyBufferToTexture
    createCommandEncoder: () => ({
      copyBufferToTexture: (src, dst, size) => textures.push({ texture: dst.texture, words: new Uint32Array(src.buffer.getMappedRange()), layout: { bytesPerRow: src.bytesPerRow, rowsPerImage: src.rowsPerImage }, size }),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (buffer, _offset, data) => written.push({ buffer, data: new Uint32Array(data) }),
      submit: vi.fn(),
      onSubmittedWorkDone: () => Promise.resolve(),
    },
  };
  const r = Object.create(MedicalVolumeRenderer.prototype);
  Object.assign(r, { device, textureDims, analysisOverlaySignature: '', rebuildBindGroup: vi.fn() });
  return { r, written, textures };
}
const runs = (d, perSlice) => Array.from({ length: d }, (_, z) => new Uint32Array(perSlice[z] || []));

describe('MedicalVolumeRenderer.setAnalysisRuns', () => {
  it('packs row offsets and coloured intervals for each region', () => {
    const { r, written, textures } = fakeRenderer([8, 2, 2]);
    const v = { columns: 8, rows: 2, slices: 2 };
    r.setAnalysisRuns([
      { runs: runs(2, { 0: [1, 2, 4] }), color: 0x112233, focused: false },
      { runs: runs(2, { 0: [1, 6, 7], 1: [0, 0, 0] }), color: 0xabcdef, focused: true },
    ], v, 'sig');
    const data = written.at(-1).data, rows = 2 * 2, header = 2 + rows, table = header + 6;
    expect(data[0]).toBe(table);
    // rows: (z0,y0) empty, (z0,y1) two intervals, (z1,y0) one, (z1,y1) empty
    expect([...data.slice(1, 2 + rows)]).toEqual([header, header, header + 4, header + 6, header + 6]);
    expect(data[header]).toBe((4 << 16) | 2);
    expect(data[header + 1]).toBe((0x112233 | 0x80000000) >>> 0);
    expect(data[header + 2]).toBe((7 << 16) | 6);
    expect(data[header + 3]).toBe((0xabcdef | 0x1000000 | 0x80000000) >>> 0);
    expect(data[header + 4]).toBe(0);
    expect(data[table]).toBe(0xff); // no segment indices given: every segment
    expect(data[table + 1]).toBe((0x112233 | 0x80000000) >>> 0);
    expect(data[table + 2]).toBe((0xabcdef | 0x1000000 | 0x80000000) >>> 0);
    // region index texture: width 1 word (8 voxels), rows (z0,y1): x2..4 -> k=1, x6..7 -> k=2; (z1,y0): x0 -> k=2
    const t = textures.at(-1);
    expect(t.size).toEqual({ width: 1, height: 2, depthOrArrayLayers: 2 });
    expect(t.layout).toEqual({ bytesPerRow: 256, rowsPerImage: 2 }); // rows padded to the 256-byte pitch copyBufferToTexture requires
    const row = (i) => t.words[i * 64];
    expect([row(0), row(1), row(2), row(3)]).toEqual([0, (1 << 8) | (1 << 12) | (1 << 16) | (2 << 24) | (2 << 28), 2, 0].map(x => x >>> 0));
    expect(t.words.length).toBe(64 * 4);
    expect(r.regionTexture).toBe(t.texture);
    expect(r.analysisOverlaySignature).toBe('sig');
    expect(r.rebuildBindGroup).toHaveBeenCalled();
  });

  it('skips the upload when the signature is unchanged and clears when empty', () => {
    const { r, written } = fakeRenderer([4, 1, 1]);
    const v = { columns: 4, rows: 1, slices: 1 };
    r.setAnalysisRuns([{ runs: runs(1, { 0: [0, 1, 2] }), color: 1, segments: [2] }], v, 's1');
    expect(written.at(-1).data[written.at(-1).data[0]]).toBe(1 << 2); // segment mask (build 375)
    const n = written.length;
    r.setAnalysisRuns([{ runs: runs(1, { 0: [0, 1, 2] }), color: 1 }], v, 's1');
    expect(written.length).toBe(n);
    r.setAnalysisRuns([], v, 's2');
    expect([...written.at(-1).data]).toEqual([0, 0]);
  });

  it('keeps the region index texture when only colour or focus change (build 377)', () => {
    const { r, written, textures } = fakeRenderer([8, 1, 1]);
    const v = { columns: 8, rows: 1, slices: 1 };
    const regions = (color, focused) => [{ runs: runs(1, { 0: [0, 1, 2] }), color, focused }];
    r.setAnalysisRuns(regions(1, false), v, 'a|1:1:0:3', 'a|1:3');
    const tex = r.regionTexture, n = textures.length, w = written.length;
    r.setAnalysisRuns(regions(2, true), v, 'a|1:2:1:3', 'a|1:3');
    expect(textures.length).toBe(n); // no new upload
    expect(r.regionTexture).toBe(tex);
    expect(written.length).toBe(w + 1); // the overlay buffer (colour table) was rewritten
    expect(written.at(-1).data[written.at(-1).data[0] + 1]).toBe((2 | 0x1000000 | 0x80000000) >>> 0);
    r.setAnalysisRuns(regions(2, true), v, 'a|9:2:1:5', 'a|9:5');
    expect(textures.length).toBe(n + 1); // a different region set rebuilds it
    expect(r.regionTexture).not.toBe(tex);
  });
});
