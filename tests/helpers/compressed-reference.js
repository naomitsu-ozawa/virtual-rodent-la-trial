// The reference series of the compressed-DICOM fixtures (tests/fixtures/dicom-compressed, tools/make-compressed-fixtures.mjs) and the tests that read
// them: 16 x 16 x 12 voxels, three storage kinds. The fixtures of every transfer syntax hold exactly these pixels, so the decoded values are known
// without opening the uncompressed twin (referenceSlice() makes that twin for the tests that want it).
import { makeCtSlice } from './synthetic-dicom.js';

export const ROWS = 16, COLUMNS = 16, SLICES = 12, SPACING = [0.1, 0.1], SLICE_STEP = 0.2, SERIES_UID = '1.2.3.77';
// kind: s16 = signed, BitsAllocated 16, BitsStored 12 (negative values); u16 = unsigned 16-bit (values above 32767); u8 = unsigned 8-bit
export const KINDS = {
  s16: { bits: 16, bitsStored: 12, signed: 1, slope: 1, intercept: -24, stored: (i, z) => ((i + z) % 7) * 300 - 900 },
  u16: { bits: 16, bitsStored: 16, signed: 0, slope: 1, intercept: -32768, stored: (i, z) => ((i + z) % 7) * 9000 },
  u8: { bits: 8, bitsStored: 8, signed: 0, slope: 2, intercept: -100, stored: (i, z) => ((i + z) % 7) * 30 + 5 },
};
export const storedAt = (kind, x, y, z) => KINDS[kind].stored(y * COLUMNS + x, z);
export const huAt = (kind, x, y, z) => storedAt(kind, x, y, z) * KINDS[kind].slope + KINDS[kind].intercept;

// the stored values of slice z as the typed array of the kind
export function storedSlice(kind, z) {
  const k = KINDS[kind], Ctor = k.bits === 8 ? Uint8Array : k.signed ? Int16Array : Uint16Array, a = new Ctor(ROWS * COLUMNS);
  for (let i = 0; i < a.length; i++) a[i] = k.stored(i, z);
  return a;
}
// the native little-endian bytes of slice z
export const storedBytes = (kind, z) => { const a = storedSlice(kind, z); return new Uint8Array(a.buffer, a.byteOffset, a.byteLength); };

export function sliceOptions(kind, z) {
  const k = KINDS[kind];
  return { seriesUid: SERIES_UID, description: 'Compressed ' + kind, rows: ROWS, columns: COLUMNS, bitsAllocated: k.bits, bitsStored: k.bitsStored, signed: k.signed, slope: k.slope, intercept: k.intercept,
    pixelSpacing: SPACING, position: [0, 0, z * SLICE_STEP], thickness: SLICE_STEP, instance: z + 1, windowCenter: 0, windowWidth: 2000 };
}
// the uncompressed twin of slice z (Explicit VR Little Endian)
export const referenceSlice = (kind, z) => makeCtSlice({ ...sliceOptions(kind, z), pixels: storedSlice(kind, z) });
