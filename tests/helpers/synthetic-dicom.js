// Minimal Explicit VR Little Endian DICOM writer for tests. Produces valid
// Part 10 files (preamble + DICM + meta group) that dicom-parser can read.
const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);
const enc = new TextEncoder();

function valueBytes(vr, value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof Int16Array || value instanceof Uint16Array) return new Uint8Array(value.buffer.slice(0));
  if (vr === 'US') { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value, true); return b; }
  if (vr === 'UL') { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value, true); return b; }
  let s = String(value);
  if (s.length % 2) s += vr === 'UI' ? '\0' : ' ';
  return enc.encode(s);
}

function element(tag, vr, value) {
  const group = parseInt(tag.slice(0, 4), 16), elem = parseInt(tag.slice(4), 16);
  let v = valueBytes(vr, value);
  if (v.length % 2) { const p = new Uint8Array(v.length + 1); p.set(v); v = p; }
  const long = LONG_VRS.has(vr), head = new Uint8Array(long ? 12 : 8), dv = new DataView(head.buffer);
  dv.setUint16(0, group, true); dv.setUint16(2, elem, true);
  head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1);
  if (long) dv.setUint32(8, v.length, true); else dv.setUint16(6, v.length, true);
  return [head, v];
}

const concat = parts => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/**
 * @param {object} o
 * @returns {Uint8Array}
 */
export function makeCtSlice({
  studyUid = '1.2.3', seriesUid = '1.2.3.4', description = 'Test CT', modality = 'CT',
  rows = 4, columns = 4, bitsAllocated = 16, bitsStored = 12, signed = 1,
  pixelSpacing = [0.1, 0.1], position = [0, 0, 0], orientation = null, thickness = 0.1,
  instance = 1, slope = 1, intercept = -1024, windowCenter = 40, windowWidth = 400,
  pixels = null, extra = [],
} = {}) {
  const meta = [['00020010', 'UI', '1.2.840.10008.1.2.1']];
  const body = [
    ['00080060', 'CS', modality],
    ['0008103E', 'LO', description],
    ['00180050', 'DS', thickness],
    ['0020000D', 'UI', studyUid],
    ['0020000E', 'UI', seriesUid],
    ['00200013', 'IS', instance],
    ['00200032', 'DS', position.join('\\')],
    ...(orientation ? [['00200037', 'DS', orientation.join('\\')]] : []),
    ['00280002', 'US', 1],
    ['00280004', 'CS', 'MONOCHROME2'],
    ['00280010', 'US', rows],
    ['00280011', 'US', columns],
    ['00280030', 'DS', pixelSpacing.join('\\')],
    ['00280100', 'US', bitsAllocated],
    ['00280101', 'US', bitsStored],
    ['00280103', 'US', signed],
    ['00281050', 'DS', windowCenter],
    ['00281051', 'DS', windowWidth],
    ['00281052', 'DS', intercept],
    ['00281053', 'DS', slope],
    ['7FE00010', 'OW', pixels ?? new Int16Array(rows * columns)],
    ...extra, // optional additional elements [tag, vr, value]; the whole body is written in ascending tag order
  ].sort((a, b) => parseInt(a[0], 16) - parseInt(b[0], 16));
  const metaBytes = concat(meta.flatMap(e => element(...e)));
  const groupLen = concat(element('00020000', 'UL', metaBytes.length));
  const preamble = new Uint8Array(132); preamble.set(enc.encode('DICM'), 128);
  return concat([preamble, groupLen, metaBytes, ...body.flatMap(e => element(...e))]);
}

export const asFile = (bytes, name = 'slice.dcm') => new File([bytes], name);
