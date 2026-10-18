import { describe, it, expect } from 'vitest';
import { packMeshes, unpackMeshes, packedMeshBytes, MESH_PACK_FORMAT } from '../../docs/mesh-pack.js';

// one indexed + smoothed mesh (positions, normals, index, tight bounding sphere) and one raw triangle soup (no index, no normals)
const sample = () => [
  { key: 'bone', name: 'segment_bone_full_23', editSurface: false, displayScale: 0.0123, bounding: [0.5, -1, 2, 3.25],
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.5]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    index: new Uint32Array([0, 1, 2, 2, 1, 3]) },
  { key: 'fat', name: 'edited_segment_fat_7', editSurface: true, displayScale: 0.5, bounding: [0, 0, 0, 3],
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: null, index: null },
];

describe('mesh pack (mesh cache blob)', () => {
  it('round-trips whatever the header length (the JSON header is padded to 4 bytes)', () => {
    for (let n = 1; n <= 8; n++) {
      const m = [{ key: 'bone', name: 'x'.repeat(n), positions: new Float32Array(9).fill(1), normals: null, index: null }];
      expect(unpackMeshes(packMeshes(m))?.[0].name).toBe('x'.repeat(n));
    }
  });
  it('round-trips positions, normals, index and the mesh fields', () => {
    const meshes = sample(), bytes = packMeshes(meshes);
    expect(bytes.byteLength).toBe(packedMeshBytes(meshes));
    expect(bytes.byteLength % 4).toBe(0);
    const out = unpackMeshes(bytes);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ key: 'bone', name: 'segment_bone_full_23', editSurface: false, displayScale: 0.0123, bounding: [0.5, -1, 2, 3.25] });
    expect([...out[0].positions]).toEqual([...meshes[0].positions]);
    expect([...out[0].normals]).toEqual([...meshes[0].normals]);
    expect([...out[0].index]).toEqual([0, 1, 2, 2, 1, 3]);
    expect(out[1]).toMatchObject({ key: 'fat', name: 'edited_segment_fat_7', editSurface: true, normals: null, index: null });
    expect([...out[1].positions]).toEqual([...meshes[1].positions]);
  });

  it('accepts a 16-bit index (stored as 32-bit)', () => {
    const m = sample()[0]; m.index = new Uint16Array([0, 1, 2]);
    const out = unpackMeshes(packMeshes([m]));
    expect(out[0].index).toBeInstanceOf(Uint32Array);
    expect([...out[0].index]).toEqual([0, 1, 2]);
  });

  it('hands out views on the blob (no second copy of the geometry)', () => {
    const bytes = packMeshes(sample()), out = unpackMeshes(bytes);
    for (const m of out) {
      expect(m.positions.buffer).toBe(bytes.buffer);
      if (m.normals) expect(m.normals.buffer).toBe(bytes.buffer);
      if (m.index) expect(m.index.buffer).toBe(bytes.buffer);
    }
  });

  it('reads a blob that is not 4-byte aligned in its buffer', () => {
    const bytes = packMeshes(sample()), shifted = new Uint8Array(bytes.length + 3);
    shifted.set(bytes, 3);
    const out = unpackMeshes(shifted.subarray(3));
    expect(out).toHaveLength(2);
    expect([...out[0].index]).toEqual([0, 1, 2, 2, 1, 3]);
  });

  it('refuses to pack nothing or a malformed mesh', () => {
    expect(() => packMeshes([])).toThrow();
    expect(() => packMeshes([{ key: 'a', name: 'a', positions: new Float32Array(4) }])).toThrow();
    expect(() => packMeshes([{ key: 'a', name: 'a', positions: new Float32Array(9), normals: new Float32Array(6) }])).toThrow();
    expect(() => packMeshes([{ key: 'a', name: 'a', positions: new Float32Array(9), index: new Uint32Array(2) }])).toThrow();
  });

  describe('damaged data is detected (null: the caller drops the entry and builds the mesh)', () => {
    const good = () => packMeshes(sample());
    it('not a blob', () => {
      expect(unpackMeshes(null)).toBeNull();
      expect(unpackMeshes(undefined)).toBeNull();
      expect(unpackMeshes(new Uint8Array(0))).toBeNull();
      expect(unpackMeshes(new Uint8Array(10))).toBeNull();
      expect(unpackMeshes('mesh')).toBeNull();
      expect(unpackMeshes(new Uint8Array(200))).toBeNull();
    });
    it('truncated or extended', () => {
      const b = good();
      expect(unpackMeshes(b.slice(0, b.length - 4))).toBeNull();
      expect(unpackMeshes(b.slice(0, 40))).toBeNull();
      const longer = new Uint8Array(b.length + 4); longer.set(b);
      expect(unpackMeshes(longer)).toBeNull();
    });
    it('another magic or layout version', () => {
      const a = good(); new Uint32Array(a.buffer)[0] ^= 1; expect(unpackMeshes(a)).toBeNull();
      const b = good(); new Uint32Array(b.buffer)[1] = MESH_PACK_FORMAT + 1; expect(unpackMeshes(b)).toBeNull();
    });
    it('a flipped bit in the data (checksum)', () => {
      const b = good(); b[b.length - 5] ^= 0x10;
      expect(unpackMeshes(b)).toBeNull();
    });
    it('a damaged header', () => {
      const b = good(); b[26] = 0x7f; // inside the header JSON
      expect(unpackMeshes(b)).toBeNull();
      const c = good(); new Uint32Array(c.buffer)[3] += 4; // dataStart moved
      expect(unpackMeshes(c)).toBeNull();
    });
    it('an index that points outside its vertices', () => {
      const m = sample()[0]; m.index = new Uint32Array([0, 1, 4]); // only 4 vertices: 0..3
      expect(unpackMeshes(packMeshes([m]))).toBeNull();
    });
    it('a non-finite position or normal', () => {
      const m = sample()[0]; m.positions[2] = NaN;
      expect(unpackMeshes(packMeshes([m]))).toBeNull();
      const n = sample()[0]; n.normals[0] = Infinity;
      expect(unpackMeshes(packMeshes([n]))).toBeNull();
    });
    it('more vertices than allowed', () => {
      expect(unpackMeshes(good(), { maxVertices: 3 })).toBeNull();
      expect(unpackMeshes(good(), { maxVertices: 4 })).toHaveLength(2);
    });
  });
});
