// voxel bit mask of the edit / applied-cut intervals for the desktop WebGPU volume shader (medical-volume.js
// volumeShader: editAllows, editInsidePair, appliedCutContains). The shader binary-searched a row's interval list at every
// sample of a masked segment (mask-only segments: every sample in a mixed brick, plus the surface search,
// excludeMaskedInside's four rows and insideVoxelTc); one texture load now answers it. Pure: no GPU calls here.
//
// Planes: one bit plane per edited segment slot (editRows[0] bit s, in slot order) and then one per slot with an applied
// cut (appliedCutRows[0] bit s). B = bits per voxel = the next power of two >= plane count (1, 2, 4, 8), 32 / B voxels
// per u32 along x. Each slice is the dense word list of its rows (word i = y * wordsPerRow + (x >> log2(32 / B))),
// folded into a texture row of W words (W a power of two >= 64 and >= wordsPerRow): texel (i & (W - 1), i >> log2 W, z).
// The fold keeps the staging buffer at the 256-byte row pitch copyBufferToTexture needs without padding every voxel row
// (a 16-word row at 512 wide would have been padded 4x), and its height stays <= the grid height.
// Plane table (8 entries x 3 bits, exact in an f32): entry s = plane of edit slot s, entry 4 + s = plane of cut slot s. An unused
// slot's entry is 0 (plane 0 belongs to another slot): the shader reads it only after the slot's activeMask bit.
// Bytes: 512^3 16 / 32 / 64 / 128 MiB for B = 1 / 2 / 4 / 8; 256^3 2 / 4 / 8 / 16 MiB.

export const EDIT_MASK_MAX_BYTES = 128 * 1024 * 1024;

export function editMaskPlanes(editActive, cutActive) {
  let count = 0, table = 0;
  for (let s = 0; s < 4; s++) if (editActive & (1 << s)) { table |= count << (3 * s); count++; }
  for (let s = 0; s < 4; s++) if (cutActive & (1 << s)) { table |= count << (3 * (4 + s)); count++; }
  return { count, table };
}

export function editMaskLayout(gridDims, planeCount) {
  if (!(planeCount > 0) || planeCount > 8) return null;
  const [w, h, d] = gridDims, bits = planeCount <= 1 ? 1 : planeCount <= 2 ? 2 : planeCount <= 4 ? 4 : 8;
  const log2Bits = Math.log2(bits), log2Vpw = 5 - log2Bits, wordsPerRow = Math.ceil(w / (1 << log2Vpw));
  let width = 64; while (width < wordsPerRow) width *= 2;
  const log2Width = Math.log2(width), height = Math.max(1, Math.ceil(h * wordsPerRow / width));
  return { dims: [w, h, d], bits, log2Bits, log2Vpw, wordsPerRow, width, log2Width, height, depth: d, bytesPerRow: width * 4, bytes: width * 4 * height * d };
}

// the uniform word the shader decodes (mprWindow.z): B + 256 * log2 W; 0 = no texture (binary search)
export const editMaskInfoWord = layout => layout ? layout.bits + 256 * layout.log2Width : 0;

function fillPlane(words, layout, plane, offsets, intervals, base) {
  const [w, h, d] = layout.dims, rowCount = h * d, B = layout.bits, lv = layout.log2Vpw, vpw = 1 << lv, sliceWords = layout.width * layout.height;
  let pattern = 0; for (let k = 0; k < vpw; k++) pattern |= 1 << (k * B + plane);
  for (let r = 0; r < rowCount; r++) {
    const start = offsets[base + r], finish = offsets[base + r + 1];
    if (finish <= start) continue;
    const y = r % h, z = (r - y) / h, rowBase = z * sliceWords + y * layout.wordsPerRow;
    for (let c = start; c < finish; c++) {
      const iv = intervals[c], x0 = iv & 65535, x1 = Math.min(iv >>> 16, w - 1);
      let x = x0;
      // head voxels up to a word boundary, whole words with the replicated plane bit, then the tail
      while (x <= x1 && (x & (vpw - 1))) { words[rowBase + (x >> lv)] |= 1 << (((x & (vpw - 1)) * B) + plane); x++; }
      while (x + vpw - 1 <= x1) { words[rowBase + (x >> lv)] |= pattern; x += vpw; }
      while (x <= x1) { words[rowBase + (x >> lv)] |= 1 << (((x & (vpw - 1)) * B) + plane); x++; }
    }
  }
}

// edit: {offsets, intervals, activeMask} as setEditRuns uploads them (offsets[0] = activeMask, rows of slot s at 2 + s * (rowCount + 1));
// cut: the same for setAppliedCutRuns (rows of slot s at 1 + s * (rowCount + 1)). words: optional target (a mapped staging range), zeroed.
export function fillEditMaskWords(layout, table, edit, cut, words = new Uint32Array(layout.bytes / 4)) {
  const [, h, d] = layout.dims, rowCount = h * d;
  for (let s = 0; s < 4; s++) {
    if (edit && (edit.activeMask & (1 << s))) fillPlane(words, layout, (table >> (3 * s)) & 7, edit.offsets, edit.intervals, 2 + s * (rowCount + 1));
    if (cut && (cut.activeMask & (1 << s))) fillPlane(words, layout, (table >> (3 * (4 + s))) & 7, cut.offsets, cut.intervals, 1 + s * (rowCount + 1));
  }
  return words;
}

// CPU copy of the shader's lookup (medical-volume.js editMaskBit)
export function editMaskBit(words, layout, plane, x, y, z) {
  const lv = layout.log2Vpw, i = y * layout.wordsPerRow + (x >>> lv);
  const word = words[(z * layout.height + (i >>> layout.log2Width)) * layout.width + (i & (layout.width - 1))];
  return ((word >>> (((x & ((1 << lv) - 1)) << layout.log2Bits) + plane)) & 1) !== 0;
}

// the interval decision the shader made before (binary search for the last interval starting at or before x)
export function intervalContains(offsets, intervals, base, row, x) {
  let lo = offsets[base + row], hi = offsets[base + row + 1];
  const start = lo;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if ((intervals[mid] & 65535) <= x) lo = mid + 1; else hi = mid; }
  return lo > start && x <= (intervals[lo - 1] >>> 16);
}

export function sameU32(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
