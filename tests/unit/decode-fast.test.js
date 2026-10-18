import { describe, it, expect } from 'vitest';
import { decodeSourceSlice } from '../../docs/volume-io.js';

// build 294: the typed-array fast path must equal the DataView path
describe('decodeSourceSlice fast path', () => {
  for (const signed of [false, true]) it(signed ? 'signed' : 'unsigned', async () => {
    const rows = 3, columns = 5, n = rows * columns, head = 132, buf = new Uint8Array(head + n * 2), dv = new DataView(buf.buffer);
    const vals = Array.from({ length: n }, (_, i) => signed ? (i * 4099) % 65536 - 32768 : (i * 4099) % 65536);
    vals.forEach((v, i) => signed ? dv.setInt16(head + i * 2, v, true) : dv.setUint16(head + i * 2, v, true));
    const meta = { ts: '1.2.840.10008.1.2.1', bits: 16, signed, rows, columns, pixelOffset: head, slope: 0.5, intercept: -1024, file: new Blob([buf]) };
    const out = await decodeSourceSlice(meta);
    expect([...out]).toEqual(vals.map(v => v * 0.5 - 1024));
  });
});
