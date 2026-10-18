import { describe, it, expect } from 'vitest';
import { reduceSliceArea } from '../../docs/medical-volume.js';

const pack = vals => { const o = new Uint8Array(vals.length * 2); vals.forEach((v, i) => { o[i * 2] = v & 255; o[i * 2 + 1] = v >> 8; }); return o; };
const read = (buf, stride, tw, th) => { const r = []; for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) r.push(buf[y * stride + x * 2] | (buf[y * stride + x * 2 + 1] << 8)); return r; };

describe('reduceSliceArea (build 281)', () => {
  it('averages each target voxel over its source footprint', () => {
    const sw = 4, sh = 2, vals = [1000, 2000, 30000, 40000, 3000, 4000, 50000, 60000];
    const out = new Uint8Array(4 * 1);
    reduceSliceArea(pack(vals), sw, Uint32Array.from([0, 2, 4]), Uint32Array.from([0, 2]), 2, 1, 4, out);
    expect(read(out, 4, 2, 1)).toEqual([2500, 45000]);
  });
  it('covers every source column with uneven spans (1024 -> 768 style)', () => {
    const sw = 4, vals = [100, 200, 300, 400];
    const out = new Uint8Array(6);
    reduceSliceArea(pack(vals), sw, Uint32Array.from([0, 1, 3, 4]), Uint32Array.from([0, 1]), 3, 1, 6, out);
    expect(read(out, 6, 3, 1)).toEqual([100, 250, 400]);
  });
});
