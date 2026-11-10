import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeCtSlice } from './synthetic-dicom.js';

// A synthetic CT phantom with KNOWN values (16-bit, slope 1, intercept 0, HU stored as is) for the no-WebGPU tests:
//   air   -1000 HU outside,
//   soft     40 HU in a ball (radius 0.42 of the smallest side, the z side counted in voxels),
//   bone   1200 HU in a cube of 8 x 8 x 8 voxels around the centre, i.e. exactly 512 voxels: the "volume analysis" of the bone region is 512 voxels.
// phantomHu(x, y, z, o) gives the HU of a voxel, so a test can compare what the page shows with what was written.
export function phantomHu(x, y, z, { cols, rows, slices }) {
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2, cz = (slices - 1) / 2, R = Math.min(cols, rows, slices) * 0.42;
  if (Math.abs(x - cx) < 4 && Math.abs(y - cy) < 4 && Math.abs(z - cz) < 4) return 1200;
  return Math.hypot(x - cx, y - cy, z - cz) <= R ? 40 : -1000;
}
export const phantomBoneVoxels = 512;
export function phantomFolder({ cols = 32, rows = 32, slices = 32, spacing = [0.1, 0.1, 0.2] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vrl-phantom-')), o = { cols, rows, slices };
  for (let z = 0; z < slices; z++) {
    const px = new Int16Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) px[y * cols + x] = phantomHu(x, y, z, o);
    writeFileSync(join(dir, `p${String(z).padStart(4, '0')}.dcm`), makeCtSlice({
      seriesUid: `1.2.9.${cols}.${rows}.${slices}`, description: `Phantom ${cols}x${rows}x${slices}`, rows, columns: cols, pixelSpacing: [spacing[1], spacing[0]],
      position: [0, 0, z * spacing[2]], thickness: spacing[2], instance: z + 1, pixels: px, intercept: 0, slope: 1, bitsStored: 16, windowCenter: 300, windowWidth: 1600,
    }));
  }
  return dir;
}
