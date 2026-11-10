import { describe, it, expect, beforeAll } from 'vitest';
import { storedLayout, storedValue } from '../../docs/stored-bits.js';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

installDomStub(); // source-filters.js / segment-runs.js build the page at import time
let decodeSourceSlice, readSourceRows, readSourceColumn, readSourceSubregion, decodeSourceSegmentMasks, packedRgSlice;
beforeAll(async () => {
  ({ decodeSourceSlice, readSourceRows, readSourceColumn } = await importApp('volume-io'));
  ({ readSourceSubregion } = await importApp('source-filters'));
  ({ decodeSourceSegmentMasks } = await importApp('segment-runs'));
  ({ packedRgSlice } = await importApp('medical-volume'));
});

// One normalisation (stored-bits.js) for the GPU packing and every CPU reader: BitsStored bits ending at HighBit, sign-extended from that bit when signed.
// Data with junk above the stored bits, or a HighBit that is not BitsStored-1, must give the same HU on the GPU path (packedRgSlice) and on the CPU readers.
const LE = '1.2.840.10008.1.2.1', ROWS = 2, COLS = 4, SLOPE = 0.5, INTERCEPT = -30;
const cases = [
  { name: '16-bit unsigned, 12 stored, junk in the top 4 bits', bits: 16, bitsStored: 12, highBit: 11, signed: false, words: [0xF123, 0x0FFF, 0x0000, 0x8001, 0x1000, 0xFFFF, 0x0123, 0x0800], stored: [0x123, 4095, 0, 1, 0, 4095, 0x123, 2048] },
  { name: '16-bit signed, 12 stored, sign-extended and junk', bits: 16, bitsStored: 12, highBit: 11, signed: true, words: [0xF800, 0x07FF, 0x1801, 0xFFFF, 0x0000, 0x0001, 0x8800, 0x0800], stored: [-2048, 2047, -2047, -1, 0, 1, -2048, -2048] },
  { name: '16-bit unsigned, 12 stored in the high bits (HighBit 15)', bits: 16, bitsStored: 12, highBit: 15, signed: false, words: [0xABC0, 0xFFFF, 0x000F, 0x0010, 0x8000, 0x7FF0, 0x1230, 0x0000], stored: [0xABC, 4095, 0, 1, 0x800, 0x7FF, 0x123, 0] },
  { name: '16-bit signed, 12 stored in the high bits (HighBit 15)', bits: 16, bitsStored: 12, highBit: 15, signed: true, words: [0x8000, 0x7FF0, 0xFFF0, 0x0010, 0xABC5, 0x0000, 0x0020, 0xFFE0], stored: [-2048, 2047, -1, 1, 0xABC - 4096, 0, 2, -2] },
  { name: '16-bit with HighBit below BitsStored-1 (clamped up to 11)', bits: 16, bitsStored: 12, highBit: 3, signed: false, words: [0xF123, 0x0FFF, 0, 1, 2, 3, 4, 5], stored: [0x123, 4095, 0, 1, 2, 3, 4, 5] },
  { name: '8-bit unsigned, 6 stored, junk in the top 2 bits', bits: 8, bitsStored: 6, highBit: 5, signed: false, words: [0xC5, 0x3F, 0x00, 0x40, 0x80, 0xFF, 0x05, 0x20], stored: [5, 63, 0, 0, 0, 63, 5, 32] },
  { name: '8-bit signed, 6 stored, junk in the top 2 bits', bits: 8, bitsStored: 6, highBit: 5, signed: true, words: [0x3F, 0x20, 0xFF, 0xE0, 0x1F, 0x00, 0x41, 0x7F], stored: [-1, -32, -1, -32, 31, 0, 1, -1] },
  { name: '8-bit signed, plain, bogus HighBit 15 (clamped to 7)', bits: 8, bitsStored: 8, highBit: 15, signed: true, words: [0x80, 0x7F, 0xFF, 0x00, 0x01, 0xFE, 0x10, 0xF0], stored: [-128, 127, -1, 0, 1, -2, 16, -16] },
  { name: '8-bit unsigned, plain', bits: 8, bitsStored: 8, highBit: 7, signed: false, words: [0, 1, 127, 128, 129, 254, 255, 77], stored: [0, 1, 127, 128, 129, 254, 255, 77] },
];
const make = c => {
  const bpp = c.bits / 8, bytes = new Uint8Array(ROWS * COLS * bpp);
  c.words.forEach((w, i) => { if (bpp === 1) bytes[i] = w; else { bytes[i * 2] = w & 255; bytes[i * 2 + 1] = w >> 8; } });
  const meta = { ts: LE, bits: c.bits, bitsStored: c.bitsStored, highBit: c.highBit, signed: c.signed, samples: 1, rows: ROWS, columns: COLS, pixelOffset: 0, slope: SLOPE, intercept: INTERCEPT, file: new Blob([bytes]) };
  return { meta, hu: c.stored.map(v => v * SLOPE + INTERCEPT) };
};
// what the shaders do with the packed rg8 words: stored = word - bias (32768 when signed)
const gpuHu = (packed, c) => { const dv = new DataView(packed.buffer, packed.byteOffset, packed.byteLength); return c.words.map((_, i) => (dv.getUint16(i * 2, true) - (c.signed ? 32768 : 0)) * SLOPE + INTERCEPT); };

describe('stored-bits: junk high bits / HighBit != BitsStored-1', () => {
  for (const c of cases) {
    describe(c.name, () => {
      it('storedValue gives the expected stored integers', () => {
        const L = storedLayout(c);
        expect(c.words.map(w => storedValue(w, L))).toEqual(c.stored);
      });
      it('every CPU reader and the GPU packing agree on the HU', async () => {
        const { meta, hu } = make(c);
        expect([...await decodeSourceSlice(meta)]).toEqual(hu);
        expect([...await readSourceRows(meta, 0, ROWS)]).toEqual(hu);
        expect([...await readSourceRows(meta, 1, 1)]).toEqual(hu.slice(COLS));
        for (let x = 0; x < COLS; x++) expect([...await readSourceColumn(meta, x)]).toEqual([hu[x], hu[COLS + x]]);
        expect([...await readSourceSubregion(meta, 1, 0, 2, 2)]).toEqual([hu[1], hu[2], hu[COLS + 1], hu[COLS + 2]]);
        expect(gpuHu(await packedRgSlice(meta), c)).toEqual(hu);
      });
      it('the segment threshold mask (CPU) selects the same voxels as the HU says', async () => {
        const { meta, hu } = make(c), sorted = [...hu].sort((a, b) => a - b), lo = sorted[2], hi = sorted[5];
        const states = await decodeSourceSegmentMasks(meta, [{ key: 'k', seg: { min: lo, max: hi } }]);
        expect([...states.get('k').mask]).toEqual(hu.map(v => (v >= lo && v <= hi ? 1 : 0)));
      });
    });
  }
  it('clean 16-bit data (BitsStored = BitsAllocated) takes the plain layout', () => {
    expect(storedLayout({ bits: 16, bitsStored: 16, signed: true })).toMatchObject({ plain: true, lowBit: 0, highBit: 15 });
    expect(storedLayout({ bits: 16 })).toMatchObject({ plain: true });
    expect(storedLayout({ bits: 16, bitsStored: 12, highBit: 11 })).toMatchObject({ plain: false, lowBit: 0 });
    expect(storedLayout({ bits: 8, bitsStored: 8, highBit: 99 })).toMatchObject({ highBit: 7, plain: true });
  });
});
