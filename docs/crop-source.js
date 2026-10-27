// Original STORED pixel values for the crop export (no DOM; unit-tested in tests/unit/crop-export.test.js).
// The export never reads the display data: not the GPU texture (it may be reduced to fit the GPU limit), not the filter pipeline output,
// not the rescaled float planes of decodeSourceSlice. It re-reads the slices from the source files (series.slices[k].file) and keeps the
// integers exactly as stored (before RescaleSlope / RescaleIntercept), so an axis-aligned crop is a byte-for-byte copy of the source pixels.
//
// Storage: the range of a stored value follows BitsStored (not BitsAllocated): 12-bit unsigned = 0..4095, 12-bit signed = -2048..2047.
// Other readers (pydicom, ITK, ...) mask the stored value to BitsStored, so a value outside that range would be read back wrong.
//
// Per-slice rescale (RescaleSlope / RescaleIntercept differ between slices):
// - axis aligned: the stored values are copied unchanged and every output slice gets the RescaleSlope / Intercept of its OWN source slice
//   (these are per-instance attributes, so this is legal and exact);
// - rotated: the interpolation needs ONE scale, so all slices are converted to the finest |slope| of the series; a value that does not fit
//   the stored range after the conversion aborts the export (never clamped).
import dicomParser from 'https://esm.sh/dicom-parser@1.8.21';
import { isNativeDicomTransferSyntax } from './dicom.js?v=20261027-build678';

export class CropExportError extends Error { constructor(code, message) { super(message); this.code = code; } }

const BE_TS = '1.2.840.10008.1.2.2';
const hostLittle = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
export const storedCtor = (bits, signed) => (bits === 8 ? (signed ? Int8Array : Uint8Array) : signed ? Int16Array : Uint16Array);
// BitsStored as a usable number (1..BitsAllocated); falls back to BitsAllocated
export const storedBitsOf = (bits, bitsStored) => { const b = bits === 8 ? 8 : 16; return Number.isInteger(bitsStored) && bitsStored >= 1 && bitsStored <= b ? bitsStored : b; };
// range of a stored value from BitsStored (bitsStored defaults to BitsAllocated)
export const storedRange = (bits, signed, bitsStored = bits) => { const s = storedBitsOf(bits, bitsStored); return signed ? [-(2 ** (s - 1)), 2 ** (s - 1) - 1] : [0, 2 ** s - 1]; };
// Lossy transfer syntaxes: JPEG baseline / extended, JPEG-LS near-lossless, JPEG 2000 (lossy-capable, incl. Part 2) and HTJ2K (lossy-capable)
export const LOSSY_TRANSFER_SYNTAXES = new Set(['1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.51', '1.2.840.10008.1.2.4.81', '1.2.840.10008.1.2.4.91', '1.2.840.10008.1.2.4.93', '1.2.840.10008.1.2.4.203']);
export const isLossyTransferSyntax = ts => LOSSY_TRANSFER_SYNTAXES.has(ts);

// In place: keep only the BitsStored low bits (unsigned) / sign-extend from bit BitsStored-1 (signed). No-op when BitsStored == BitsAllocated.
export function normalizeStored(arr, bits, bitsStored, signed) {
  const s = storedBitsOf(bits, bitsStored), b = bits === 8 ? 8 : 16;
  if (s >= b) return arr;
  if (signed) { const sh = 32 - s; for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] << sh) >> sh; }
  else { const m = 2 ** s - 1; for (let i = 0; i < arr.length; i++) arr[i] &= m; }
  return arr;
}

// one slice as stored integers (rows*columns), native uncompressed transfer syntaxes (raw: no masking, no conversion)
export async function readNativeStoredSlice(meta) {
  const bits = meta.bits, bpp = bits === 8 ? 1 : bits === 16 ? 2 : 0;
  if (!bpp) throw new CropExportError('unsupported-bits', 'Unsupported BitsAllocated=' + bits);
  const n = meta.rows * meta.columns;
  let ab, offset = meta.pixelOffset;
  if (offset != null) ab = await meta.file.slice(offset, offset + n * bpp).arrayBuffer();
  else {
    const all = new Uint8Array(await meta.file.arrayBuffer()), el = dicomParser.parseDicom(all).elements.x7fe00010;
    if (!el) throw new Error('Pixel Data missing');
    ab = all.slice(el.dataOffset, el.dataOffset + n * bpp).buffer;
  }
  if (ab.byteLength < n * bpp) throw new Error('Pixel Data shorter than Rows*Columns');
  const Ctor = storedCtor(bits, !!meta.signed);
  if (bpp === 1) return new Ctor(ab, 0, n);
  const little = meta.ts !== BE_TS;
  if (little === hostLittle) return new Ctor(ab, 0, n);
  const out = new Ctor(n), dv = new DataView(ab);
  for (let i = 0; i < n; i++) out[i] = meta.signed ? dv.getInt16(i * 2, little) : dv.getUint16(i * 2, little);
  return out;
}

// Stored integers of ONE storage type (slice 0: BitsAllocated, BitsStored, PixelRepresentation) for all slices.
// mode 'aligned' (default): every slice is returned exactly as stored (raw copy), `info.rescaleOf(k)` is the slice's own slope / intercept.
// mode 'rotated': the values are masked to BitsStored (sign-extended when signed) and, when the slices have different rescale, converted to
// the finest |slope| (`info.converted`); a value that does not fit the stored range aborts with a CropExportError('rescale-overflow').
// Slices of different storage (bits / signedness / BitsStored) cannot share one output and are refused earlier (crop-export checkExportable).
export function makeStoredReader(series, { decodeCompressed = null, mode = 'aligned' } = {}) {
  const sl = series.slices, f = sl[0], bits = f.bits === 8 ? 8 : 16, signed = !!f.signed, Ctor = storedCtor(bits, signed), bitsStored = storedBitsOf(f.bits, f.bitsStored), [lo, hi] = storedRange(bits, signed, bitsStored);
  const rescaleOf = k => ({ slope: sl[k].slope, intercept: sl[k].intercept });
  const sameStorage = m => (m.bits === 8 ? 8 : 16) === bits && !!m.signed === signed && storedBitsOf(m.bits, m.bitsStored) === bitsStored;
  if (!sl.every(sameStorage)) throw new CropExportError('mixed-storage', 'Slices with different BitsAllocated / BitsStored / PixelRepresentation cannot be cropped together');
  const perSlice = sl.some(m => m.slope !== f.slope || m.intercept !== f.intercept), rotated = mode === 'rotated';
  let target = { slope: f.slope, intercept: f.intercept };
  if (rotated && perSlice) { let best = 0; sl.forEach((m, k) => { if (Math.abs(m.slope) < Math.abs(sl[best].slope)) best = k; }); target = { slope: sl[best].slope, intercept: sl[best].intercept }; }
  const converted = rotated && perSlice, exactInt = x => Math.abs(x - Math.round(x)) < 1e-9;
  const convertExact = !converted || sl.every(m => exactInt(m.slope / target.slope) && exactInt((m.intercept - target.intercept) / target.slope));
  const info = {
    bits, signed, Ctor, range: [lo, hi], slope: target.slope, intercept: target.intercept, bitsStored, highBit: f.highBit ?? bitsStored - 1,
    photometric: f.photometricInterpretation || 'MONOCHROME2', converted, convertExact, perSliceRescale: perSlice && !rotated, compressed: sl.some(m => !isNativeDicomTransferSyntax(m.ts)),
    lossy: sl.some(m => isLossyTransferSyntax(m.ts)), rescaleOf: k => (converted ? target : rescaleOf(k)),
  };
  async function readRaw(meta) { // the slice in ITS OWN stored scale
    if (isNativeDicomTransferSyntax(meta.ts)) return readNativeStoredSlice(meta);
    if (!decodeCompressed) throw new Error('Compressed DICOM needs a decoder');
    const n = meta.rows * meta.columns, out = new Ctor(n), dec = await decodeCompressed(meta, { stored: true }); // a decoder may hand back the stored integers (exact) ...
    // opts.stored was requested: whatever the array type (Float32 / Float64 included) the values are STORED values, never HU. They must be exact integers inside the stored range.
    for (let i = 0; i < n; i++) {
      const x = dec[i], v = Math.round(x);
      if (!(Math.abs(x - v) <= 1e-3) || v < lo || v > hi) throw new CropExportError('not-exact', 'The compressed source cannot be converted back to its stored integers exactly');
      out[i] = v;
    }
    return out;
  }
  async function read(k) {
    const meta = sl[k], raw = await readRaw(meta);
    if (!rotated) return raw; // axis aligned: the stored values exactly as they are
    normalizeStored(raw, bits, bitsStored, signed);
    if (!converted || (meta.slope === target.slope && meta.intercept === target.intercept)) return raw;
    const out = new Ctor(raw.length), a = meta.slope / target.slope, b = (meta.intercept - target.intercept) / target.slope;
    for (let i = 0; i < raw.length; i++) {
      const v = Math.round(raw[i] * a + b);
      if (v < lo || v > hi) throw new CropExportError('rescale-overflow', `Slice ${k + 1}: a value does not fit the ${bitsStored}-bit stored range after converting to RescaleSlope ${target.slope} (use an axis-aligned crop)`);
      out[i] = v;
    }
    return out;
  }
  return { info, read };
}

// Fill value for samples outside the source volume: air. CT: -1024 HU as a stored value; when that cannot be represented (the stored range
// does not reach it) the series minimum is used instead (or the lowest stored value). Other modalities: the series minimum.
// Always inside the stored range; `hu` is the HU the stored value really means (reported in DerivationDescription).
export function fillStoredValue(info, modality, seriesMinHu) {
  const [lo, hi] = info.range, toStored = hu => Math.min(hi, Math.max(lo, Math.round((hu - info.intercept) / info.slope))), huOf = s => s * info.slope + info.intercept, tol = Math.abs(info.slope) / 2 + 1e-9;
  if (modality === 'CT') {
    const s = toStored(-1024);
    if (Math.abs(huOf(s) + 1024) <= tol) return { stored: s, hu: huOf(s), rule: Math.abs(huOf(s) + 1024) < 1e-9 ? 'air, -1024 HU' : `air, nearest representable to -1024 HU: ${+huOf(s).toFixed(3)} HU` };
    const m = Number.isFinite(seriesMinHu) ? toStored(seriesMinHu) : (info.slope >= 0 ? lo : hi);
    return { stored: m, hu: huOf(m), rule: `series minimum, ${+huOf(m).toFixed(3)} HU; -1024 HU is not representable` };
  }
  const s = toStored(Number.isFinite(seriesMinHu) ? seriesMinHu : info.slope >= 0 ? huOf(lo) : huOf(hi));
  return { stored: s, hu: huOf(s), rule: 'series minimum' };
}
