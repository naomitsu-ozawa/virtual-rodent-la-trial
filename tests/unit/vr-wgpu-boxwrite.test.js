// The WebGPU volume's copy of a box of one array into a texture (copySlab: WebGL's copyTextureToTexture(src, dst, srcBox, dstPos), the bake's boxes) and the writeRange it goes through.
import { describe, it, expect, vi } from 'vitest';
import * as THREEG from 'three/webgpu';
import { createVrVolumeRenderer } from '../../docs/vr-wgpu.js';
import { GPU_GLOBALS, recordingDevice, sceneUniforms } from '../helpers/gpu-call-log.js';

const withGpu = fn => async () => { for (const [k, v] of Object.entries(GPU_GLOBALS)) vi.stubGlobal(k, v); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const box = (lo, hi) => ({ min: { x: lo[0], y: lo[1], z: lo[2] }, max: { x: hi[0], y: hi[1], z: hi[2] } });

describe('copySlab writes a box of the source array at a position of the texture', () => {
  it('a sub-box (x, y and z) goes up with the source\'s own row pitch, from the box\'s first texel, to the position asked; a whole-slice box is the slices as before', withGpu(async () => {
    const rec = recordingDevice({}), writes = [], wt = rec.device.queue.writeTexture;
    rec.device.queue.writeTexture = (dst, data, lay, size) => { writes.push({ origin: dst.origin, offset: lay.offset ?? 0, start: data.byteOffset, bpr: lay.bytesPerRow, rpi: lay.rowsPerImage, size, len: data.byteLength }); return wt(dst, data, lay, size); };
    const r = createVrVolumeRenderer({ THREE: THREEG, device: rec.device, halfExt: [1, 1, 1] }), u = sceneUniforms(32), t = u.clsTex.value, src = { image: { data: t.image.data, width: 32, height: 32, depth: 32 } };
    r.volume.gpuOf(t); writes.length = 0;
    r.volume.copySlab(src, t, box([4, 6, 8], [20, 14, 11]), { x: 4, y: 6, z: 8 });
    expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ origin: [4, 6, 8], size: [16, 8, 3], bpr: 32 * 4, rpi: 32, offset: 0, start: ((8 * 32 + 6) * 32 + 4) * 4, len: ((2 * 32 + 7) * 32 + 16) * 4 }); // the view starts at the box's first texel and holds exactly the rows the copy reads
    writes.length = 0;
    r.volume.copySlab(src, t, box([4, 6, 8], [20, 14, 11]), { x: 0, y: 0, z: 2 }); // another place in the texture
    expect(writes[0]).toMatchObject({ origin: [0, 0, 2], size: [16, 8, 3], start: ((8 * 32 + 6) * 32 + 4) * 4 });
    writes.length = 0;
    r.volume.copySlab(src, t, box([0, 0, 10], [32, 32, 12]), { x: 0, y: 0, z: 10 }); // the whole slices
    expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ origin: [0, 0, 10], size: [32, 32, 2], bpr: 32 * 4 });
    writes.length = 0;
    r.volume.copySlab(src, t, { min: { z: 10 }, max: { z: 12 } }); // a z range only (the callers that name no x / y)
    expect(writes[0]).toMatchObject({ origin: [0, 0, 10], size: [32, 32, 2] });
    writes.length = 0;
    r.volume.copySlab(src, t, box([4, 6, 8], [4, 14, 11])); // an empty box writes nothing
    expect(writes).toHaveLength(0);
    r.dispose();
  }));
});

describe('perf2 (4-5): copyGpu copies a whole texture into another on the GPU', () => {
  it('one copyTextureToTexture of the whole size per pair in one submit, nothing written from the CPU; the source is filled first, the destination only made; false (and nothing done) for a pair that differs in size or format; the entries have COPY_SRC', withGpu(async () => {
    const rec = recordingDevice({}), copies = [], submits = [], writes = [], made = [];
    const ce = rec.device.createCommandEncoder; rec.device.createCommandEncoder = () => { const e = ce(); e.copyTextureToTexture = (a, b, size) => copies.push({ a: a.texture, b: b.texture, size }); return e; };
    rec.device.queue.submit = c => { submits.push(c); }; const wt = rec.device.queue.writeTexture; rec.device.queue.writeTexture = (...a) => { writes.push(a); return wt(...a); };
    const ct = rec.device.createTexture; rec.device.createTexture = d => { made.push(d); return ct(d); };
    const r = createVrVolumeRenderer({ THREE: THREEG, device: rec.device, halfExt: [1, 1, 1] }), u = sceneUniforms(16), t = u.clsTex.value;
    const mk = (w, h, d, fmt, data) => { const x = new THREEG.Data3DTexture(data, w, h, d); x.format = fmt; x.type = THREEG.UnsignedByteType; x.source.dataReady = false; return x; };
    const dst = mk(16, 16, 16, THREEG.RGBAFormat, t.image.data), c4 = new THREEG.Data3DTexture(new Uint8Array(16 * 16 * 16), 16, 16, 16); c4.format = THREEG.RedFormat; c4.type = THREEG.UnsignedByteType; c4.needsUpdate = true;
    const d4 = mk(16, 16, 16, THREEG.RedFormat, c4.image.data);
    r.volume.initTexture(dst); r.volume.initTexture(d4);
    const g0 = r.volume.gpuOf(t); writes.length = 0; submits.length = 0; copies.length = 0;
    expect(r.volume.copyGpu([[t, dst], [c4, d4]])).toBe(true);
    expect(copies).toHaveLength(2); expect(copies[0].a).toBe(g0); expect(copies[0].b).toBe(r.volume.gpuOf(dst)); expect(copies[0].size).toEqual([16, 16, 16]); expect(copies[1].size).toEqual([16, 16, 16]);
    expect(submits).toHaveLength(1); expect(writes.filter(w => w[0].texture === copies[0].b)).toHaveLength(0); // the destination got nothing from the CPU
    expect(writes.some(w => w[0].texture === copies[1].a)).toBe(true); // the source that had not been sent yet was (c4: first use)
    expect(made.every(d => (d.usage & 1) === 1 || d.dimension !== '3d')).toBe(true); // every 3D data texture can be a copy source (COPY_SRC = 1)
    copies.length = 0; submits.length = 0;
    const small = mk(8, 8, 8, THREEG.RGBAFormat, new Uint8Array(8 * 8 * 8 * 4)); r.volume.initTexture(small);
    expect(r.volume.copyGpu([[t, dst], [t, small]])).toBe(false); expect(copies).toHaveLength(0); expect(submits).toHaveLength(0); // all or nothing
    const bad = mk(16, 16, 16, THREEG.RedFormat, new Uint8Array(16 * 16 * 16)); expect(r.volume.copyGpu([[t, bad]])).toBe(false);
    r.dispose();
  }));
});
