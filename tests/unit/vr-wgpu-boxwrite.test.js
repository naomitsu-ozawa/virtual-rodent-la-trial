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
