import { describe, it, expect, beforeAll } from 'vitest';
import { MedicalVolumeRenderer } from '../../docs/medical-volume.js';

beforeAll(() => {
  globalThis.requestAnimationFrame ??= cb => setTimeout(cb, 0);
  globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

function mockDevice(log) {
  const scopes = [];
  let nextId = 0;
  return {
    limits: { maxStorageBufferBindingSize: 1 << 24, maxTextureDimension3D: 2048 },
    textures: [],
    createBuffer: ({ size }) => ({ size, destroy() {} }),
    createTexture(desc) {
      const t = { id: ++nextId, label: desc.label, destroyed: false, destroy() { t.destroyed = true; }, createView: () => ({}) };
      this.textures.push(t);
      return t;
    },
    pushErrorScope(filter) { scopes.push({ filter, errors: [] }); },
    async popErrorScope() { const s = scopes.pop(); return s?.errors.length ? { message: s.errors[0] } : null; },
    queue: {
      writeBuffer() {},
      writeTexture({ texture }) {
        if (!texture.destroyed) return;
        const msg = 'Destroyed texture #' + texture.id + ' used in a submit';
        log.push(msg);
        if (scopes.length) scopes.at(-1).errors.push(msg);
      },
      async onSubmittedWorkDone() {},
    },
  };
}

function series(id, n, d) {
  const file = { slice: () => ({ arrayBuffer: async () => { await sleep(5); return new ArrayBuffer(n * n * 2); } }) };
  const meta = { bits: 16, bitsStored: 16, highBit: 15, samples: 1, ts: '1.2.840.10008.1.2.1', rows: n, columns: n, slope: 1, intercept: -4000, signed: false, pixelOffset: 0, file };
  return { id, columns: n, rows: n, spacingX: 0.1, spacingY: 0.1, spacingZ: 0.1, slices: Array.from({ length: d }, () => ({ ...meta })) };
}
const vol = s => ({ sourceBacked: true, series: s, columns: s.columns, rows: s.rows, slices: s.slices.length, spacing: [0.1, 0.1, 0.1] });
// A's project has filtersApplied: refreshGpuVolumeData rewrites the resident texture in place with slow filtered slices
const filtered = s => ({ ...vol(s), filterSignature: 'bilateral', sliceData: async () => { await sleep(15); return new Float32Array(s.columns * s.rows); } });

function renderer(log) {
  const r = Object.create(MedicalVolumeRenderer.prototype);
  Object.assign(r, {
    device: mockDevice(log), context: {}, canvas: { style: {} }, onStatus() {}, onProgress() {},
    brickSize: 8, brickDims: [1, 1, 1], textureDims: [1, 1, 1],
    rebuildBindGroup() { r.bindGroup = r.texture && !r.texture.destroyed ? {} : null; },
    async ensureBricks() { if (!r.texture) throw new Error('GPU volume texture is not resident'); r.bricksReady = true; r.rebuildBindGroup(); },
    clearEditRuns() {}, clearPreviewRuns() {}, clearAppliedCutRuns() {}, setActive(a) { r.active = !!a; },
  });
  return r;
}

describe('MedicalVolumeRenderer.ensure() across a series switch', () => {
  it('in-place filtered refresh of A in flight, then resetData() and ensure(B): B succeeds and stays resident', async () => {
    const log = [], r = renderer(log), A = series('A', 8, 6), B = series('B', 8, 6);
    await r.ensure(vol(A), { prepareBricks: false });
    expect(r.seriesId).toBe('A');
    const refreshA = r.ensure(filtered(A), {});
    let refreshErr = null; refreshA.catch(e => { refreshErr = e; });
    await sleep(20);
    // series change: resetVolume()/clear3DForSeriesChange() -> resetData(); then prepareResidentGpuVolume -> ensure(B)
    r.resetData();
    let bErr = null;
    try { await r.ensure(vol(B), { prepareBricks: false }); } catch (e) { bErr = e; }
    await refreshA.catch(() => {});
    await sleep(5);
    const textureB = r.device.textures.at(-1);
    expect(bErr).toBeNull();
    expect(r.seriesId).toBe('B');
    expect(r.texture).toBe(textureB);
    expect(r.texture.destroyed).toBe(false);
    expect(refreshErr?.message).toBe('__SUPERSEDED__');
    expect(log).toEqual([]);
  });

  it('fresh upload of A in flight, then resetData() and ensure(B): A never takes over the renderer', async () => {
    // B is short, so an unserialized B would finish first and A's tail would then overwrite texture / seriesId
    const log = [], r = renderer(log), A = series('A', 8, 12), B = series('B', 8, 2);
    const uploadA = r.ensure(vol(A), { prepareBricks: false });
    let aErr = null; uploadA.catch(e => { aErr = e; });
    await sleep(12);
    r.resetData();
    const uploadB = r.ensure(vol(B), { prepareBricks: false });
    await uploadA.catch(() => {});
    await uploadB;
    const [textureA, textureB] = r.device.textures;
    expect(r.seriesId).toBe('B');
    expect(r.texture).toBe(textureB);
    expect(aErr?.message).toBe('__SUPERSEDED__');
    expect(textureA.destroyed).toBe(true);
    expect(textureB.destroyed).toBe(false);
    expect(log).toEqual([]);
  });
});
