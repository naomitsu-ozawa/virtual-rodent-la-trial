// Lossless JPEG (ITU T.81 process 14, DICOM 1.2.840.10008.1.2.4.70) encoder for fixtures: one component, predictor 1 (the left neighbour; the sample
// above for the first sample of a row; 2^(P-1) for the very first), point transform 0, a fixed Huffman table (every category 0..16 as a 5-bit code).
// Written independently of the vendored decoder (jpeg-lossless-decoder-js) it is checked against. `words` = Uint16Array of the raw samples
// (two's complement bit patterns for signed data, as the DICOM pixel data holds them), precision = the sample precision P (2..16).
export function jpegLosslessEncode(words, rows, columns, precision = 16) {
  const out = [], bytes = (...b) => out.push(...b), u16 = v => bytes(v >> 8, v & 255);
  const mod = 1 << precision, half = mod >> 1;
  bytes(0xff, 0xd8); // SOI
  bytes(0xff, 0xc3); u16(11); bytes(precision); u16(rows); u16(columns); bytes(1, 1, 0x11, 0); // SOF3: 1 component, 1x1 sampling
  bytes(0xff, 0xc4); u16(2 + 1 + 16 + 17); bytes(0x00); // DHT: DC table 0, 17 symbols of 5 bits
  for (let l = 1; l <= 16; l++) bytes(l === 5 ? 17 : 0);
  for (let s = 0; s <= 16; s++) bytes(s);
  bytes(0xff, 0xda); u16(8); bytes(1, 1, 0x00, 1, 0, 0); // SOS: predictor 1, Ah/Al 0
  let acc = 0, nbits = 0;
  const put = (value, n) => {
    for (let b = n - 1; b >= 0; b--) {
      acc = (acc << 1) | ((value >> b) & 1); nbits++;
      if (nbits === 8) { bytes(acc); if (acc === 0xff) bytes(0); acc = 0; nbits = 0; }
    }
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const cur = words[y * columns + x] & (mod - 1);
      const pred = y === 0 && x === 0 ? half : x === 0 ? words[(y - 1) * columns] & (mod - 1) : words[y * columns + x - 1] & (mod - 1);
      let d = (cur - pred) & (mod - 1);
      if (d > half) d -= mod; // -(half-1) .. half
      const mag = Math.abs(d);
      let ssss = 0;
      while ((1 << ssss) <= mag) ssss++;
      put(ssss, 5); // the 5-bit code of category ssss is ssss itself
      if (ssss && ssss < 16) put(d < 0 ? d + (1 << ssss) - 1 : d, ssss);
    }
  }
  if (nbits) put((1 << (8 - nbits)) - 1, 8 - nbits); // pad with 1 bits
  bytes(0xff, 0xd9); // EOI
  return Uint8Array.from(out);
}
