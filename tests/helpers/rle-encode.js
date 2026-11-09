// DICOM RLE encoder for tests and fixtures (PS3.5 Annex G): the independent counterpart of docs/dicom-native-codecs.js rleDecodeFrame, so the
// round trip decode(encode(x)) == x tests the decoder against code that shares nothing with it.
// Grey images: `bytes` = the native little-endian pixel bytes of one frame (rows * columns * bitsAllocated / 8). One segment per byte plane, the most
// significant first; every row is packed on its own (a run never crosses a row, as the standard requires).

// PackBits of one row: runs of 3 or more equal bytes are replicated, the rest is literal (at most 128 bytes at a time)
function packRow(row) {
  const out = [];
  let i = 0;
  while (i < row.length) {
    let run = 1;
    while (i + run < row.length && row[i + run] === row[i] && run < 128) run++;
    if (run >= 3) { out.push(257 - run, row[i]); i += run; continue; }
    const start = i;
    i += run;
    while (i < row.length && i - start < 128) {
      let r = 1;
      while (i + r < row.length && row[i + r] === row[i] && r < 3) r++;
      if (r >= 3) break;
      i++;
    }
    out.push(i - start - 1, ...row.subarray(start, i));
  }
  return out;
}

export function rleEncodeFrame(bytes, rows, columns, bitsAllocated) {
  const bytesPer = bitsAllocated / 8, n = rows * columns, segments = [];
  for (let plane = 0; plane < bytesPer; plane++) {
    const src = new Uint8Array(n); // plane 0 = the high byte of each little-endian word
    for (let i = 0; i < n; i++) src[i] = bytes[i * bytesPer + (bytesPer - 1 - plane)];
    const packed = [];
    for (let y = 0; y < rows; y++) packed.push(...packRow(src.subarray(y * columns, (y + 1) * columns)));
    if (packed.length % 2) packed.push(0); // segments start on even offsets
    segments.push(Uint8Array.from(packed));
  }
  const out = new Uint8Array(64 + segments.reduce((a, s) => a + s.length, 0)), dv = new DataView(out.buffer);
  dv.setUint32(0, segments.length, true);
  let o = 64;
  segments.forEach((s, k) => { dv.setUint32(4 + k * 4, o, true); out.set(s, o); o += s.length; });
  return out;
}
