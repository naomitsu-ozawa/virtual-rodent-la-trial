// The two "compressions" of DICOM whose decoders are tiny and live in the page itself (no codec worker, no wasm):
//   * DICOM RLE (1.2.840.10008.1.2.5): the PackBits-style byte-plane format of PS3.5 Annex G, decoded by rleDecodeFrame below.
//   * Deflated Explicit VR Little Endian (1.2.840.10008.1.2.1.99): the whole data set after the file meta group is a raw deflate stream,
//     inflated with the vendored fflate (dicomInflater, handed to dicom-parser as its `inflater` option).
// No DOM, no state: used by dicom.js (header parsing of deflated files) and dicom-normalize.js, unit-tested in tests/unit/dicom-normalize.test.js.
import { Inflate } from './vendor/fflate@0.8.2/index.js';

export const DEFLATED_TS = '1.2.840.10008.1.2.1.99';
export const RLE_TS = '1.2.840.10008.1.2.5';

// dicom-parser inflater: (byteArray, position) -> the file with the data set (from `position`) inflated. A deflate stream that ends early
// (a header-only read of the first 256 KiB of a file) gives what was inflated so far: dicom-parser then stops at the pixel data tag or fails
// (and parseDicomHeader reads more), never mistakes the cut for a complete file.
export function dicomInflater(byteArray, position) {
  const chunks = []; let total = 0;
  const inflate = new Inflate(chunk => { chunks.push(chunk); total += chunk.length; });
  // pushed in pieces, not as one final chunk: a stream that ends early then still yields every block completed so far (a final push of cut data
  // throws before it hands out anything); the end of the stream is only declared after the last piece
  const PIECE = 64 * 1024, end = byteArray.length;
  try {
    for (let o = position; o < end; o += PIECE) inflate.push(byteArray.subarray(o, Math.min(end, o + PIECE)), false);
    inflate.push(new Uint8Array(0), true);
  } catch (e) { if (!total) throw e; }
  const out = new Uint8Array(position + total);
  out.set(byteArray.subarray(0, position), 0);
  let o = position;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// One PackBits segment -> exactly `count` bytes (a shorter segment is an error; extra bytes of a run are ignored)
function unpackSegment(src, start, end, count, out, outStart) {
  let i = start, o = 0;
  while (o < count && i < end) {
    const n = src[i++];
    if (n < 128) { // literal run of n + 1 bytes
      const len = Math.min(n + 1, count - o);
      if (i + n + 1 > end) throw new Error('RLE: literal run runs past the end of its segment');
      for (let k = 0; k < len; k++) out[outStart + o++] = src[i + k];
      i += n + 1;
    } else if (n > 128) { // the next byte repeated 257 - n times
      const len = Math.min(257 - n, count - o), v = src[i++];
      if (i > end) throw new Error('RLE: replicate run runs past the end of its segment');
      out.fill(v, outStart + o, outStart + o + len); o += len;
    } // 128: no operation
  }
  if (o < count) throw new Error('RLE: segment decodes to ' + o + ' bytes, expected ' + count);
}

// One frame of DICOM RLE (the bytes of its fragment: 64-byte header of 16 little-endian uint32 [segment count, offsets] + the segments)
// -> the native little-endian pixel bytes (rows * columns * bitsAllocated / 8), as an uncompressed Explicit VR Little Endian frame holds them.
// Grey images only: one segment per byte plane, the most significant plane first (PS3.5 G.2).
export function rleDecodeFrame(frame, rows, columns, bitsAllocated) {
  const bytesPer = bitsAllocated === 8 ? 1 : bitsAllocated === 16 ? 2 : 0;
  if (!bytesPer) throw new Error('RLE: unsupported BitsAllocated=' + bitsAllocated);
  if (frame.length < 64) throw new Error('RLE: frame shorter than its 64-byte header');
  const head = new DataView(frame.buffer, frame.byteOffset, frame.byteLength), segments = head.getUint32(0, true);
  if (segments !== bytesPer) throw new Error('RLE: ' + segments + ' segments, expected ' + bytesPer + ' for a grey ' + bitsAllocated + '-bit image');
  const n = rows * columns, offsets = [];
  for (let s = 0; s < segments; s++) offsets.push(head.getUint32(4 + s * 4, true));
  offsets.push(frame.length);
  const planes = new Uint8Array(n * bytesPer);
  for (let s = 0; s < segments; s++) {
    if (offsets[s] < 64 || offsets[s] > frame.length) throw new Error('RLE: segment offset out of range');
    if (offsets[s + 1] < offsets[s]) throw new Error('RLE: segment offsets are not ascending');
    unpackSegment(frame, offsets[s], offsets[s + 1], n, planes, s * n);
  }
  if (bytesPer === 1) return planes;
  const out = new Uint8Array(n * 2); // plane 0 = high bytes, plane 1 = low bytes -> little endian words
  for (let i = 0; i < n; i++) { out[i * 2] = planes[n + i]; out[i * 2 + 1] = planes[i]; }
  return out;
}
