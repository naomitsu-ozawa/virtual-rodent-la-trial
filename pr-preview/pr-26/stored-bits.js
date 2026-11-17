// The ONE place that turns the raw words of an uncompressed DICOM Pixel Data into the stored integers: BitsStored bits, the top one at HighBit,
// sign-extended from that bit when PixelRepresentation = 1. The GPU packing (medical-volume.js packedRgSlice) and every CPU reader
// (volume-io.js, segment-runs.js, source-filters.js) use it, so the HU of a voxel is the same on both paths for data with junk high bits
// or a HighBit that is not BitsStored-1. 8-bit data is handled the same way (BitsAllocated 8: one byte per pixel).
export function storedLayout(meta) {
  const bits = meta.bits === 8 ? 8 : 16;
  const bitsStored = Math.max(1, Math.min(bits, meta.bitsStored || bits));
  const hb = Number.isFinite(meta.highBit) ? meta.highBit : bitsStored - 1;
  const highBit = Math.max(bitsStored - 1, Math.min(bits - 1, hb)); // never below BitsStored-1, never above the allocated bits
  const lowBit = highBit - bitsStored + 1;
  const signed = !!meta.signed;
  // plain: the whole allocated word is the value (nothing to mask or shift), the fast typed-array paths apply
  return { bits, bitsStored, highBit, lowBit, signed, mask: 2 ** bitsStored - 1, signBit: 2 ** (bitsStored - 1), plain: bitsStored === bits && lowBit === 0 };
}
// one raw word (0 .. 2^bits-1) -> the stored integer
export function storedValue(word, layout) {
  let w = layout.lowBit ? word >>> layout.lowBit : word;
  w &= layout.mask;
  return layout.signed && (w & layout.signBit) ? w - (layout.mask + 1) : w;
}
// the stored integer of the pixel whose first byte is at byteOffset of bytes / view
export function readStored(bytes, view, byteOffset, little, layout) {
  const w = layout.bits === 8 ? bytes[byteOffset] : view.getUint16(byteOffset, little);
  if (!layout.plain) return storedValue(w, layout);
  return layout.signed ? (layout.bits === 8 ? (w > 127 ? w - 256 : w) : (w > 32767 ? w - 65536 : w)) : w;
}
