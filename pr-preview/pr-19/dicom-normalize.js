// "Normalised slices": a compressed (or deflated) DICOM series is decoded ONCE when it is selected, slice by slice, into 16-bit little-endian
// pixel data held in RAM as a Blob per slice, and the slice's meta is rewritten to describe that Blob as a plain uncompressed slice:
//   meta.file = the Blob, meta.pixelOffset = 0, meta.bits = 16, meta.ts = Explicit VR Little Endian, meta.highBit = bitsStored - 1,
//   the values right aligned, masked to BitsStored and (signed) sign extended; the original is kept in meta.orig.
// Every reader that only knows uncompressed slices then works unchanged: the 2D readers (volume-io.js decodeSourceSlice), the GPU volume upload
// and its analysis (medical-volume.js rawPixelBytes / packedRgSlice), the VR preparation, MPR, filters, regions, trim and the crop export.
// The decoders: RLE and deflate here (dicom-native-codecs.js), JPEG baseline / lossless, JPEG-LS, JPEG 2000 and HTJ2K by the vendored cornerstone
// codecs in the codec worker pool (volume-io.js getDicomCodecModule) - handed in as `codec`, so this module has no DOM and no worker of its own.
// RAM only: nothing is written to disk; releaseNormalized gives the Blobs back (dataset switch: data-load.js, dataset-reset.js onDatasetChange).
// Out of scope, refused with a message (NormalizeError.key is an i18n key): colour, MONOCHROME1, slices with different calibration, a series that
// would be larger than the cap of a small device after normalisation.
// Unit-tested in tests/unit/dicom-normalize.test.js.
import dicomParser from './vendor/dicom-parser@1.8.21/index.js';
import { COMPRESSED_DICOM_TRANSFER_SYNTAXES, encapsulatedFrameBytes, dicomImageFrameInfo } from './dicom.js?v=20261113-build732';
import { DEFLATED_TS, RLE_TS, dicomInflater, rleDecodeFrame } from './dicom-native-codecs.js?v=20261113-build732';

export const NORMALIZED_TS = '1.2.840.10008.1.2.1'; // Explicit VR Little Endian
export const NORMALIZED_CAP_SMALL_DEVICE = 512 * 1024 * 1024;
export const DEFAULT_NORMALIZE_CONCURRENCY = 4;

export class NormalizeError extends Error {
  // code: color | mono1 | calibration | cap | cancelled | bits | decode;  key: the i18n key of the message shown to the user;  params: {size, limit, ...}
  constructor(code, key, params = {}, message = '') { super(message || key); this.name = 'NormalizeError'; this.code = code; this.key = key; this.params = params; }
}

export const needsNormalization = m => !!m && !m.orig && (COMPRESSED_DICOM_TRANSFER_SYNTAXES.has(m.ts) || m.ts === DEFLATED_TS);
export const seriesNeedsNormalization = s => !!s?.slices?.some(needsNormalization);
// bytes the Blobs of the series take (every slice is 16-bit): what the cap is checked against
export const normalizedBytes = s => (s?.slices || []).reduce((a, m) => a + (needsNormalization(m) ? m.rows * m.columns * 2 : 0), 0);
export const normalizedSeries = new Set(); // the series whose slices are normalised now (released on a dataset switch)

export function checkNormalizable(series, { capBytes = Infinity } = {}) {
  const sl = series.slices, f = sl[0];
  for (const m of sl) {
    if ((m.samples || 1) !== 1) throw new NormalizeError('color', 'dcmErrColor');
    if (/^MONOCHROME1$/i.test(m.photometricInterpretation || '')) throw new NormalizeError('mono1', 'dcmErrMono1');
    if (needsNormalization(m) && m.bits !== 8 && m.bits !== 16) throw new NormalizeError('bits', 'dcmErrFailed', { detail: 'BitsAllocated=' + m.bits }, 'Unsupported BitsAllocated=' + m.bits);
  }
  if (sl.some(m => m.slope !== f.slope || m.intercept !== f.intercept || !!m.signed !== !!f.signed || (m.bitsStored || m.bits) !== (f.bitsStored || f.bits))) throw new NormalizeError('calibration', 'dcmErrCalib');
  const size = normalizedBytes(series);
  if (size > capBytes) throw new NormalizeError('cap', 'dcmErrCap', { size, limit: capBytes });
}

// stored values of one frame -> the 16-bit words of the normalised slice
//   mode 'native': raw words of an uncompressed payload (RLE, deflate): shift right by the unused low bits, mask to BitsStored, sign extend
//   mode 'codec' : the values a codec returned (already right aligned): wrapped to BitsAllocated, then clamped to the BitsStored range (a lossy codec may overshoot)
export function toNormalizedWords(values, n, { signed, bitsAllocated, bitsStored, shift = 0, mode }) {
  const out = new Uint16Array(n), allocated = bitsAllocated === 8 ? 8 : 16, bs = Math.max(1, Math.min(allocated, bitsStored || allocated));
  if (values.length < n) throw new NormalizeError('decode', 'dcmErrFailed', { detail: 'the decoder returned incomplete pixel data' }, 'The decoder returned incomplete pixel data');
  if (mode === 'native') {
    const mask = bs === 16 ? 0xffff : (1 << bs) - 1, sh = 32 - bs;
    for (let i = 0; i < n; i++) {
      let v = values[i];
      if (shift) v = (v & 0xffff) >>> shift;
      v &= mask;
      out[i] = signed ? (v << sh) >> sh : v;
    }
    return out;
  }
  const lo = signed ? -(2 ** (bs - 1)) : 0, hi = signed ? 2 ** (bs - 1) - 1 : 2 ** bs - 1, wrapBits = 32 - allocated;
  for (let i = 0; i < n; i++) {
    let v = values[i];
    v = signed ? (v << wrapBits) >> wrapBits : (allocated === 8 ? v & 255 : v & 0xffff);
    out[i] = v < lo ? lo : v > hi ? hi : v;
  }
  return out;
}

// the reader of one frame for a series: { values, mode, shift } (see toNormalizedWords). `codec` = { decode(ts, frameInfo, pixelData) -> typed array } is
// needed only for the codec syntaxes (JPEG, JPEG-LS, JPEG 2000, HTJ2K); RLE and deflate never touch it. A multi-frame file is parsed once, not per frame.
export function createFrameReader(series, codec) {
  const left = new Map(), parsed = new Map();
  for (const m of series.slices) if (needsNormalization(m)) left.set(m.file, (left.get(m.file) || 0) + 1);
  const parse = meta => {
    if (!parsed.has(meta.file)) parsed.set(meta.file, meta.file.arrayBuffer().then(buf => { const bytes = new Uint8Array(buf); return { bytes, ds: dicomParser.parseDicom(bytes, { inflater: dicomInflater }) }; }));
    return parsed.get(meta.file);
  };
  const toBytes = (raw, bitsAllocated) => (bitsAllocated === 8 ? raw : new Uint16Array(raw.slice().buffer));
  return async function readFrame(meta) {
    try {
      const { ds } = await parse(meta), el = ds.elements.x7fe00010, n = meta.rows * meta.columns, bpp = meta.bits === 8 ? 1 : 2, frame = meta.frameIndex || 0;
      if (!el) throw new Error('Pixel Data missing');
      const bitsStored = meta.bitsStored || meta.bits, highBit = Number.isFinite(meta.highBit) ? meta.highBit : bitsStored - 1, shift = Math.max(0, highBit - bitsStored + 1);
      if (meta.ts === DEFLATED_TS) { // ds.byteArray is the inflated data set; the frames are the native pixel data
        const start = el.dataOffset + frame * n * bpp, raw = ds.byteArray.subarray(start, start + n * bpp);
        if (raw.length < n * bpp) throw new Error('Pixel Data is shorter than expected');
        return { values: toBytes(raw, meta.bits), mode: 'native', shift };
      }
      const pixelData = encapsulatedFrameBytes(ds, el, meta.ts, frame);
      if (meta.ts === RLE_TS) return { values: toBytes(rleDecodeFrame(pixelData, meta.rows, meta.columns, meta.bits), meta.bits), mode: 'native', shift };
      if (!codec) throw new Error('No codec for ' + meta.ts);
      return { values: await codec.decode(meta.ts, dicomImageFrameInfo(meta), pixelData), mode: 'codec', shift: 0 };
    } finally {
      const k = (left.get(meta.file) || 1) - 1;
      if (k <= 0) { left.delete(meta.file); parsed.delete(meta.file); } else left.set(meta.file, k);
    }
  };
}

async function normalizeOne(meta, readFrame) {
  const n = meta.rows * meta.columns, frame = await readFrame(meta);
  const words = toNormalizedWords(frame.values, n, { signed: !!meta.signed, bitsAllocated: meta.bits, bitsStored: meta.bitsStored || meta.bits, shift: frame.shift, mode: frame.mode });
  return new Blob([words.buffer], { type: 'application/octet-stream' });
}

// Decode every compressed slice of `series` (up to `concurrency` at a time) and, only when ALL succeeded, rewrite the metas (a failed or cancelled run
// leaves the series untouched). readFrame: createFrameReader(series, codec). onProgress(done, total). isCancelled(): true stops the run (NormalizeError 'cancelled').
export async function normalizeSeries(series, { readFrame, onProgress, isCancelled, concurrency = DEFAULT_NORMALIZE_CONCURRENCY, capBytes = Infinity } = {}) {
  checkNormalizable(series, { capBytes });
  const todo = series.slices.filter(needsNormalization), total = todo.length, blobs = new Array(total);
  let next = 0, done = 0, failure = null;
  const runner = async () => {
    while (!failure) {
      if (isCancelled?.()) { failure = new NormalizeError('cancelled', 'dcmCancelled'); return; }
      const i = next++;
      if (i >= total) return;
      try { blobs[i] = await normalizeOne(todo[i], readFrame); } catch (e) { failure = failure || e; return; }
      onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), total) }, runner));
  if (failure) throw failure;
  if (isCancelled?.()) throw new NormalizeError('cancelled', 'dcmCancelled');
  const bytes = normalizedBytes(series);
  todo.forEach((meta, i) => {
    const bitsStored = Math.min(16, meta.bitsStored || meta.bits);
    meta.orig = { file: meta.file, pixelOffset: meta.pixelOffset, pixelLength: meta.pixelLength, bits: meta.bits, bitsStored: meta.bitsStored, highBit: meta.highBit, ts: meta.ts };
    meta.file = blobs[i]; meta.pixelOffset = 0; meta.pixelLength = meta.rows * meta.columns * 2; meta.bits = 16; meta.ts = NORMALIZED_TS; meta.highBit = bitsStored - 1; meta.normalized = true;
  });
  normalizedSeries.add(series);
  return { slices: total, bytes };
}

// give the Blobs back: every normalised slice of the series is its compressed original again (a later selection normalises it anew)
export function releaseNormalized(series) {
  for (const m of series?.slices || []) {
    if (!m.orig) continue;
    Object.assign(m, m.orig); delete m.orig; delete m.normalized;
  }
  normalizedSeries.delete(series);
}
export function releaseNormalizedExcept(keep) {
  for (const s of [...normalizedSeries]) if (s !== keep) releaseNormalized(s);
}
