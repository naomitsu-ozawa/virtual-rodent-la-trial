import { describe, it, expect, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { MedicalVolumeRenderer } from '../../docs/medical-volume.js';
import { openVolumeCache, textureCacheHandle } from '../../docs/gpu-volume-cache.js';

// Drives MedicalVolumeRenderer.ensure() with a fake WebGPU device that records
// texture writes, to check the cache integration end to end without a GPU:
// miss -> filtered slices computed and stored; hit -> identical bytes uploaded
// without computing any filtered slice.
beforeAll(() => {
  globalThis.requestAnimationFrame ??= cb => setTimeout(cb, 0);
  // WebGPU usage flags referenced by the renderer (values are irrelevant here)
  globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
  globalThis.GPUMapMode ??= { READ: 1, WRITE: 2 };
  globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
});

function fakeRenderer() {
  const writes = [];
  const device = {
    limits: { maxTextureDimension3D: 2048 },
    createTexture: () => ({ destroy() {}, createView: () => ({}) }),
    createBuffer: () => ({ destroy() {} }),
    queue: { writeTexture: (dst, data) => writes.push({ z: dst.origin.z, bytes: new Uint8Array(data) }), writeBuffer() {}, onSubmittedWorkDone: async () => {} },
    pushErrorScope() {}, popErrorScope: async () => null,
  };
  const r = Object.create(MedicalVolumeRenderer.prototype);
  Object.assign(r, { device, context: {}, canvas: { style: {} }, onProgress() {}, onStatus() {}, writes });
  return r;
}

const meta = { bits: 16, samples: 1, ts: '1.2.840.10008.1.2.1', rows: 3, columns: 4, slope: 1, intercept: -1024, signed: 1 };
const series = { id: 'study::series', description: 'test', columns: 4, rows: 3, spacingX: 0.1, spacingY: 0.1, spacingZ: 0.2, slices: Array.from({ length: 5 }, () => ({ ...meta })) };
const base = { sourceBacked: true, series, columns: 4, rows: 3, slices: 5, spacing: [0.1, 0.1, 0.2] };

async function filteredTarget(cache, calls) {
  return {
    ...base, filterSignature: 'gaussian:1',
    sliceData: async z => { calls.push(z); return new Float32Array(12).fill(z * 10 - 5); },
    textureCache: info => textureCacheHandle(cache, 'key-1', info),
  };
}

describe('GPU volume texture cache in ensure()', () => {
  it('stores on a miss and uploads identical bytes on a hit without filtering', async () => {
    const cache = await openVolumeCache({ indexedDB: new IDBFactory() });
    const firstCalls = [], first = fakeRenderer();
    await first.ensure(await filteredTarget(cache, firstCalls), { prepareBricks: false });
    expect(first.lastCacheHit).toBe(false);
    expect(firstCalls).toEqual([0, 1, 2, 3, 4]);
    expect(first.writes).toHaveLength(5);
    expect(await cache.usage()).toBe(5 * 4 * 3 * 2);

    const secondCalls = [], second = fakeRenderer();
    await second.ensure(await filteredTarget(cache, secondCalls), { prepareBricks: false });
    expect(second.lastCacheHit).toBe(true);
    expect(secondCalls).toEqual([]); // no filtering on a hit
    expect(second.writes.map(w => [...w.bytes])).toEqual(first.writes.map(w => [...w.bytes]));
    // bytes decode back to the filtered CT values: (word - 32768) * 1 + (-1024)
    const w = second.writes[2].bytes, word = w[0] | (w[1] << 8);
    expect(word - 32768 - 1024).toBe(15);
  });

  it('works for the reduced (iPad) texture plan too', async () => {
    const cache = await openVolumeCache({ indexedDB: new IDBFactory() });
    const big = { ...base, columns: 8, rows: 6, slices: 5, series: { ...series, columns: 8, rows: 6, slices: series.slices.map(m => ({ ...m, rows: 6, columns: 8 })) } };
    const target = calls => ({ ...big, filterSignature: 'nlm:2', sliceData: async z => { calls.push(z); return new Float32Array(48).map((_, i) => i + z); }, textureCache: info => textureCacheHandle(cache, 'key-reduced', info) });
    const opts = { prepareBricks: false, targetInPlane: 4 }; // forces a reduced plan
    const a = fakeRenderer(), aCalls = [];
    await a.ensure(target(aCalls), opts);
    expect(a.lastCacheHit).toBe(false);
    expect(aCalls.length).toBeGreaterThan(0);
    const b = fakeRenderer(), bCalls = [];
    await b.ensure(target(bCalls), opts);
    expect(b.lastCacheHit).toBe(true);
    expect(bCalls).toEqual([]);
    expect(b.writes.map(w => [...w.bytes])).toEqual(a.writes.map(w => [...w.bytes]));
    // a different texture plan (e.g. iPad 768 vs 512) is a separate entry, not a hit
    const c = fakeRenderer();
    await c.ensure({ ...target([]), textureCache: info => textureCacheHandle(cache, 'key-reduced-other', info) }, { prepareBricks: false, targetInPlane: 6 });
    expect(c.lastCacheHit).toBe(false);
  });

  it('unfiltered uploads never touch the cache', async () => {
    const r = fakeRenderer();
    let asked = false;
    const v = { ...base, textureCache: () => { asked = true; return null; } };
    // original data path reads DICOM bytes; stub them via packedRgSlice's source
    series.slices.forEach(m => { m.file = { slice: () => ({ arrayBuffer: async () => new ArrayBuffer(24) }) }; m.pixelOffset = 0; m.pixelLength = 24; });
    await r.ensure(v, { prepareBricks: false });
    expect(r.writes).toHaveLength(5); // the original-data upload really ran
    expect(r.lastCacheHit).toBe(false);
    expect(asked).toBe(false);
  });
});
