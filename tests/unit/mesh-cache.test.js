import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openVolumeCache } from '../../docs/gpu-volume-cache.js';
import { loadMeshEntry, storeMeshEntry, meshEntryLimit, meshCacheStats, resetMeshCacheStats, MESH_KIND, MESH_BUDGET_SHARE, MESH_ENTRY_MAX_BYTES } from '../../docs/mesh-cache.js';
import { MESH_FORMAT } from '../../docs/mesh-cache-key.js';
import { packMeshes } from '../../docs/mesh-pack.js';

let idb, clock;
beforeEach(() => { idb = new IDBFactory(); clock = 1000; resetMeshCacheStats(); });
const open = () => openVolumeCache({ indexedDB: idb, now: () => clock++ });
const mesh = (n = 3, fill = 0) => ({
  key: 'bone', name: 'segment_bone_full_' + n, editSurface: false, displayScale: 0.01, bounding: [0, 0, 0, 3],
  positions: new Float32Array(n * 9).map((_, i) => i + fill), normals: null, index: null,
});
const info = { part: 'run-surface', dataset: '{}', filter: 'g:1', description: 'phantom', segments: ['bone'], triangles: 3 };
const MiB = 2 ** 20;

describe('mesh cache store / load', () => {
  it('a stored entry is read back with the same meshes, and is listed as a mesh entry', async () => {
    const c = await open(), meshes = [mesh(3), { ...mesh(2, 5), key: 'fat', index: new Uint32Array([0, 1, 2, 3, 4, 5]).map(i => i % 6), normals: new Float32Array(18) }];
    expect(await loadMeshEntry(c, 'k')).toBeNull();
    expect(await storeMeshEntry(c, 'k', meshes, info, { budget: 100 * MiB })).toBe(true);
    const hit = await loadMeshEntry(c, 'k');
    expect(hit.meshes).toHaveLength(2);
    expect([...hit.meshes[0].positions]).toEqual([...meshes[0].positions]);
    expect(hit.meshes[1]).toMatchObject({ key: 'fat', name: meshes[1].name });
    expect([...hit.meshes[1].index]).toEqual([...meshes[1].index]);
    expect(hit.info).toMatchObject({ kind: MESH_KIND, meshFormat: MESH_FORMAT, meshCount: 2, part: 'run-surface', description: 'phantom' });
    const listed = (await c.list()).filter(e => e.complete);
    expect(listed).toHaveLength(1);
    expect(listed[0].info.kind).toBe(MESH_KIND);
    expect(listed[0].bytes).toBe((await c.usage()));
    expect(meshCacheStats.stores).toBe(1);
  });

  it('an entry written as one blob is a single slice', async () => {
    const c = await open();
    await storeMeshEntry(c, 'k', [mesh()], info, { budget: 100 * MiB });
    const e = (await c.list())[0];
    expect(e.slices).toBe(1);
    expect(e.bytes).toBe(e.bytesPerSlice);
  });

  it('the cache clear (and a delete of one entry) removes mesh entries with the others', async () => {
    const c = await open();
    await storeMeshEntry(c, 'a', [mesh(3, 0)], info, { budget: 100 * MiB });
    await storeMeshEntry(c, 'b', [mesh(3, 1)], info, { budget: 100 * MiB });
    await c.remove('a');
    expect(await loadMeshEntry(c, 'a')).toBeNull();
    expect(await loadMeshEntry(c, 'b')).not.toBeNull();
    await c.clear();
    expect(await loadMeshEntry(c, 'b')).toBeNull();
    expect(await c.list()).toEqual([]);
  });

  describe('damaged or foreign entries are dropped and read as a miss', () => {
    const put = async (c, key, bytes, extra = {}) => {
      const w = await c.begin(key, { slices: 1, bytesPerSlice: bytes.byteLength, info: { kind: MESH_KIND, meshFormat: MESH_FORMAT, meshCount: 1, ...extra } });
      await w.write(0, bytes); await w.commit();
    };
    it('garbage bytes', async () => {
      const c = await open(); await put(c, 'k', new Uint8Array(64).fill(7));
      expect(await loadMeshEntry(c, 'k')).toBeNull();
      expect(await c.lookup('k')).toBeNull();
      expect(meshCacheStats.invalid).toBe(1);
    });
    it('a truncated blob', async () => {
      const c = await open(), good = packMeshes([mesh()]);
      await put(c, 'k', good.slice(0, good.length - 8));
      expect(await loadMeshEntry(c, 'k')).toBeNull();
      expect(await c.lookup('k')).toBeNull();
    });
    it('a blob whose size is not what the entry says', async () => {
      const c = await open(), good = packMeshes([mesh()]);
      const w = await c.begin('k', { slices: 1, bytesPerSlice: good.byteLength + 4, info: { kind: MESH_KIND, meshFormat: MESH_FORMAT, meshCount: 1 } });
      await w.write(0, good); await w.commit();
      expect(await loadMeshEntry(c, 'k')).toBeNull();
      expect(await c.lookup('k')).toBeNull();
    });
    it('a blob with another number of meshes than the entry', async () => {
      const c = await open(); await put(c, 'k', packMeshes([mesh(), mesh(2)]), { meshCount: 1 });
      expect(await loadMeshEntry(c, 'k')).toBeNull();
      expect(await c.lookup('k')).toBeNull();
    });
    it('an entry of an older mesh format', async () => {
      const c = await open(); await put(c, 'k', packMeshes([mesh()]), { meshFormat: MESH_FORMAT - 1 });
      expect(await loadMeshEntry(c, 'k')).toBeNull();
      expect(await c.lookup('k')).toBeNull();
    });
    it('an entry that is not a mesh entry is never read as one (and is left alone)', async () => {
      const c = await open(); await put(c, 'k', packMeshes([mesh()]), { kind: 'segment-runs' });
      expect(await loadMeshEntry(c, 'k')).toBeNull();
      expect(await c.lookup('k')).not.toBeNull();
    });
    it('an incomplete (interrupted) entry is a miss', async () => {
      const c = await open(), good = packMeshes([mesh()]);
      await c.begin('k', { slices: 1, bytesPerSlice: good.byteLength, info: { kind: MESH_KIND, meshFormat: MESH_FORMAT, meshCount: 1 } });
      expect(await loadMeshEntry(c, 'k')).toBeNull();
    });
  });

  describe('budget', () => {
    it('one entry may not exceed the per-entry cap (iPad smaller) or the mesh share of the budget', () => {
      expect(meshEntryLimit(10 * 2 ** 30, true)).toBe(MESH_ENTRY_MAX_BYTES.touch);
      expect(meshEntryLimit(10 * 2 ** 30, false)).toBe(MESH_ENTRY_MAX_BYTES.desktop);
      expect(MESH_ENTRY_MAX_BYTES.touch).toBeLessThan(MESH_ENTRY_MAX_BYTES.desktop);
      expect(meshEntryLimit(100 * MiB, false)).toBe(Math.floor(100 * MiB * MESH_BUDGET_SHARE));
    });
    it('a mesh over the limit is not stored (and nothing is left behind)', async () => {
      const c = await open();
      expect(await storeMeshEntry(c, 'k', [mesh(30000)], info, { budget: 1 * MiB })).toBe(false); // ~1 MB > 35 % of 1 MiB
      expect(await c.list()).toEqual([]);
      expect(meshCacheStats.skipped).toBe(1);
    });
    it('the oldest meshes go first when the meshes outgrow their share; other kinds are not touched by the share', async () => {
      const c = await open(), budget = 3 * MiB, each = mesh(10000); // ~360 KB each, share = 1.1 MB -> 3 fit
      // a segment-runs entry of the same database (not a mesh)
      const w = await c.begin('runs', { slices: 1, bytesPerSlice: 1000, info: { kind: 'segment-runs' } }); await w.write(0, new Uint8Array(1000)); await w.commit();
      for (const k of ['m1', 'm2', 'm3']) expect(await storeMeshEntry(c, k, [{ ...each }], info, { budget })).toBe(true);
      await loadMeshEntry(c, 'm1'); // m1 is now the most recently used; m2 the oldest
      expect(await storeMeshEntry(c, 'm4', [{ ...each }], info, { budget })).toBe(true);
      expect(await loadMeshEntry(c, 'm2')).toBeNull();
      for (const k of ['m1', 'm3', 'm4']) expect(await loadMeshEntry(c, k)).not.toBeNull();
      expect(await c.lookup('runs')).not.toBeNull();
    });
    it('entries of an older mesh format are deleted at the next store', async () => {
      const c = await open();
      const w = await c.begin('old', { slices: 1, bytesPerSlice: 8, info: { kind: MESH_KIND, meshFormat: MESH_FORMAT - 1 } }); await w.write(0, new Uint8Array(8)); await w.commit();
      await storeMeshEntry(c, 'new', [mesh()], info, { budget: 100 * MiB });
      expect((await c.list()).map(e => e.key)).toEqual(['new']);
    });
  });

  it('a storage failure is a quiet false', async () => {
    const c = await open();
    const broken = { ...c, begin: async () => { throw new Error('quota'); }, list: c.list, remove: c.remove, prune: c.prune };
    expect(await storeMeshEntry(broken, 'k', [mesh()], info, { budget: 100 * MiB })).toBe(false);
  });
  it('an invalid mesh set is a quiet false', async () => {
    const c = await open();
    expect(await storeMeshEntry(c, 'k', [], info, { budget: 100 * MiB })).toBe(false);
  });
});
