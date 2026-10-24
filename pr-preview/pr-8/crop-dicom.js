// DICOM writer + metadata of the crop export (pure: no DOM; unit-tested in tests/unit/crop-export.test.js).
// Output: one Part 10 file per slice, Explicit VR Little Endian (uncompressed), CT-style single frame images.
// Patient / study / equipment attributes are copied as VERBATIM BYTES from the source header (whitelist below, VR fixed here because a
// source may be Implicit VR; sequences and private tags are not copied). Everything about the new series is set explicitly.
const enc = new TextEncoder();
const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);
export const EXPLICIT_LE = '1.2.840.10008.1.2.1';
export const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2', MR_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.4', SC_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.7';
export const IMPLEMENTATION_CLASS_UID = '2.25.285379462890214581266384956371849216', IMPLEMENTATION_VERSION = 'VRL_CROP_1';
const SINGLE_FRAME_IMAGE_CLASSES = new Set([CT_IMAGE_STORAGE, MR_IMAGE_STORAGE, SC_IMAGE_STORAGE, '1.2.840.10008.5.1.4.1.1.128', '1.2.840.10008.5.1.4.1.1.20', '1.2.840.10008.5.1.4.1.1.1', '1.2.840.10008.5.1.4.1.1.1.1']);

// attributes copied from the source (verbatim bytes). [tag, VR]
export const COPY_TAGS = [
  ['00080005', 'CS'], ['00080020', 'DA'], ['00080022', 'DA'], ['00080030', 'TM'], ['00080032', 'TM'], ['00080050', 'SH'], ['00080060', 'CS'], ['00080070', 'LO'], ['00080080', 'LO'], ['00080081', 'ST'],
  ['00080090', 'PN'], ['00081010', 'SH'], ['00081030', 'LO'], ['00081040', 'LO'], ['00081070', 'PN'], ['00081090', 'LO'],
  ['00100010', 'PN'], ['00100020', 'LO'], ['00100030', 'DA'], ['00100040', 'CS'], ['00101010', 'AS'], ['00101020', 'DS'], ['00101030', 'DS'], ['00104000', 'LT'],
  ['00180010', 'LO'], ['00180015', 'CS'], ['00180020', 'CS'], ['00180021', 'CS'], ['00180022', 'CS'], ['00180023', 'CS'], ['00180024', 'SH'],
  ['00180080', 'DS'], ['00180081', 'DS'], ['00180082', 'DS'], ['00180083', 'DS'], ['00180084', 'DS'], ['00180085', 'SH'], ['00180086', 'IS'], ['00180087', 'DS'], ['00180091', 'IS'], ['00180093', 'DS'], ['00180094', 'DS'], ['00180095', 'DS'], ['00181314', 'DS'],
  // (the 0018,0020..0095 / 1314 entries above: MR type 1 / 2 attributes and the usual sequence parameters, copied when present)
  ['00180050', 'DS'], ['00180060', 'DS'], ['00180090', 'DS'], ['00181000', 'LO'], ['00181020', 'LO'], ['00181030', 'LO'],
  ['00181100', 'DS'], ['00181110', 'DS'], ['00181111', 'DS'], ['00181140', 'CS'], ['00181150', 'IS'], ['00181151', 'IS'], ['00181152', 'IS'], ['00181160', 'SH'], ['00181190', 'DS'], ['00181210', 'SH'], ['00185100', 'CS'],
  ['0020000D', 'UI'], ['00200010', 'SH'], ['00200012', 'IS'], ['00200052', 'UI'], ['00201040', 'LO'],
  ['00280004', 'CS'], ['00280030', 'DS'], ['00281050', 'DS'], ['00281051', 'DS'], ['00281054', 'LO'], ['00282110', 'CS'],
];
const COPY_VR = new Map(COPY_TAGS);

// ---- low level ----
const tagNum = tag => parseInt(tag, 16) >>> 0;
const evenPad = (bytes, padByte) => { if (bytes.length % 2 === 0) return bytes; const o = new Uint8Array(bytes.length + 1); o.set(bytes); o[bytes.length] = padByte; return o; };
function encodeElement(tag, vr, value) { // value: Uint8Array | string | number | number[] (for US / UL)
  let v;
  if (value instanceof Uint8Array) v = value;
  else if (vr === 'US') { const a = [].concat(value); v = new Uint8Array(a.length * 2); const dv = new DataView(v.buffer); a.forEach((x, i) => dv.setUint16(i * 2, x, true)); }
  else if (vr === 'UL') { v = new Uint8Array(4); new DataView(v.buffer).setUint32(0, value, true); }
  else v = enc.encode(String(value));
  v = evenPad(v, vr === 'UI' || vr === 'OB' || vr === 'OW' || vr === 'UN' ? 0 : 0x20);
  const long = LONG_VRS.has(vr), head = new Uint8Array(long ? 12 : 8), dv = new DataView(head.buffer), t = tagNum(tag);
  dv.setUint16(0, t >>> 16, true); dv.setUint16(2, t & 0xffff, true); head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1);
  if (long) dv.setUint32(8, v.length, true); else dv.setUint16(6, v.length, true);
  return { t, head, v };
}
const concat = parts => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// A DS value: at most 16 characters, no exponent
export function formatDS(x) {
  if (!Number.isFinite(x)) throw new Error('DS value is not finite');
  if (Math.abs(x) < 1e-12) return '0';
  for (let p = 12; p >= 1; p--) {
    let s = Number(x.toPrecision(p)).toString();
    if (/e/i.test(s)) s = Number(x.toPrecision(p)).toFixed(10).replace(/\.?0+$/, '');
    if (s.length <= 16 && !/e/i.test(s)) return s === '-0' ? '0' : s;
  }
  return String(Math.round(x));
}
export const formatDSList = a => a.map(formatDS).join('\\');

// RFC 4122 version 4 UUID -> 2.25.<decimal> (DICOM PS3.5 B.2)
export function generateUid(random = bytes => globalThis.crypto.getRandomValues(bytes)) {
  const b = random(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
  return '2.25.' + n.toString(10);
}
export const isValidUid = s => typeof s === 'string' && s.length <= 64 && /^[0-2](\.(0|[1-9][0-9]*))+$/.test(s);

// ---- the template of the source header ----
// ds: a dicom-parser DataSet of the source slice header (parsed until pixel data is fine)
export function extractTemplate(ds) {
  const copied = new Map();
  for (const [tag] of COPY_TAGS) {
    const el = ds.elements['x' + tag.toLowerCase()];
    if (!el || el.items || el.length == null || el.length === 0xffffffff) continue; // missing, a sequence, or undefined length
    copied.set(tag, new Uint8Array(ds.byteArray.slice(el.dataOffset, el.dataOffset + el.length)));
  }
  const str = tag => (ds.string('x' + tag.toLowerCase()) || '').trim();
  const sop = str('00080016'), descEl = ds.elements.x0008103e, descBytes = descEl && !descEl.items && descEl.length != null && descEl.length !== 0xffffffff ? ds.byteArray.slice(descEl.dataOffset, descEl.dataOffset + descEl.length) : new Uint8Array(0);
  // a description with bytes outside printable ASCII is in the source's SpecificCharacterSet: it is not re-encoded here (the generated description then omits it)
  const descAscii = descBytes.every(b => (b >= 0x20 && b < 0x7f) || b === 0);
  return {
    copied, sopClassUid: sop, modality: str('00080060'), seriesNumber: parseInt(str('00200011'), 10), seriesDescription: descAscii ? str('0008103E') : '', seriesDescriptionNonAscii: !descAscii,
    seriesUid: str('0020000E'), studyUid: str('0020000D'), frames: Number(str('00280008') || 1), imageType: str('00080008').split('\\').map(x => x.trim()),
  };
}
export function outputSopClass(tpl) {
  if (tpl.frames <= 1 && SINGLE_FRAME_IMAGE_CLASSES.has(tpl.sopClassUid)) return tpl.sopClassUid;
  // MR Image Storage needs ScanningSequence and SequenceVariant (type 1); without them in the source the output is a Secondary Capture image
  if (tpl.modality === 'MR' && tpl.copied.has('00180020') && tpl.copied.has('00180021')) return MR_IMAGE_STORAGE;
  return tpl.modality === 'CT' ? CT_IMAGE_STORAGE : SC_IMAGE_STORAGE;
}
// ImageType: DERIVED\SECONDARY (+ \AXIAL for a CT image: value 3 of the source when it has one)
export function imageTypeFor(tpl, sopClass) {
  const v3 = (tpl.imageType?.[2] || '').replace(/[^A-Z0-9_ ]/gi, '');
  return sopClass === CT_IMAGE_STORAGE ? 'DERIVED\\SECONDARY\\' + (v3 || 'AXIAL') : 'DERIVED\\SECONDARY';
}

// ---- descriptions ----
const trunc = (s, n) => (s.length > n ? s.slice(0, n) : s);
const asciiOnly = s => s.replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '/');
export const INTERP_LABEL = { nearest: 'nearest', linear: 'linear', cubic: 'cubic (Catmull-Rom)' };
export function seriesDescriptionFor(tpl, box, aligned) {
  const tail = ' crop ' + box.n + (aligned ? ' (not resampled)' : ' resampled (' + box.interp + ')'), base = asciiOnly(tpl.seriesDescription || '');
  const head = trunc(base, Math.max(0, 64 - tail.length)).trimEnd();
  return head ? head + tail : tail.trimStart();
}
// DerivationDescription (ST, at most 1024 characters), generated text only (ASCII, English). fill: { stored, hu, rule, perSlice?, huMin?, huMax? }
// info: crop-source info (converted / convertExact / perSliceRescale / slope / intercept / compressed / lossy); syntheticReason: see crop-geometry syntheticGeometryReason
export function derivationDescriptionFor({ tpl, box, aligned, offset, fill, info = {}, geomSpacing, syntheticReason = null }) {
  const n = box.n, sp = geomSpacing.map(formatDS).join('\\');
  const head = `Cropped sub-volume ${n}x${n}x${n} voxels of series ${tpl.seriesUid || '(unknown)'}; voxel spacing unchanged (${sp} mm, x\\y\\z of the source).`;
  const pad = fill.perSlice
    ? `Positions outside the source volume were set, per slice, to the stored value meaning ${fill.huMin === fill.huMax ? +fill.huMin.toFixed(3) : +fill.huMin.toFixed(3) + '..' + +fill.huMax.toFixed(3)} HU in that slice's own scale (${fill.rule}).`
    : `Positions outside the source volume were set to the stored value ${fill.stored} (${fill.rule}).`;
  const per = info.perSliceRescale ? ' The source slices have different RescaleSlope/Intercept: every output slice keeps the RescaleSlope/Intercept of its own source slice (stored values unchanged).' : '';
  const conv = info.converted ? ` Source slices with different RescaleSlope/Intercept were converted to slope ${formatDS(info.slope)} intercept ${formatDS(info.intercept)} (the finest slope)${info.convertExact ? ' without rounding' : ', rounded to the nearest stored value (max error ' + formatDS(Math.abs(info.slope) / 2) + ' HU)'} before resampling.` : '';
  const dec = info.compressed ? ` Source slices were decompressed (output is uncompressed${info.lossy ? '; the source compression was lossy, LossyImageCompression=01' : ''}).` : '';
  const syn = syntheticReason ? ` Geometry is synthetic (${syntheticReason}): ImagePositionPatient/ImageOrientationPatient are placeholders and FrameOfReferenceUID is a new UID unrelated to the source, so this series does not register with other series.` : '';
  let body;
  if (aligned) body = `${head} Axis-aligned, not resampled: original stored pixel values copied without interpolation, voxel offset i0=${offset.i0} j0=${offset.j0} k0=${offset.k0}. ${pad}${per}${dec}${syn} Filters not applied.`;
  else {
    const a = box.angles, c = box.center;
    body = `${head} Resampled with ${INTERP_LABEL[box.interp]} interpolation of the original stored values; box rotated about its centre (index ${c.i.toFixed(2)},${c.j.toFixed(2)},${c.k.toFixed(2)}) by x=${a.x} y=${a.y} z=${a.z} deg, R=Rz*Ry*Rx in the source voxel-mm frame. ${pad}${conv}${dec}${syn} Filters not applied.`;
  }
  return trunc(asciiOnly(body), 1024);
}

// ---- file assembly ----
const fileMeta = (sopClass, sopInstance) => {
  const els = [encodeElement('00020001', 'OB', new Uint8Array([0, 1])), encodeElement('00020002', 'UI', sopClass), encodeElement('00020003', 'UI', sopInstance), encodeElement('00020010', 'UI', EXPLICIT_LE), encodeElement('00020012', 'UI', IMPLEMENTATION_CLASS_UID), encodeElement('00020013', 'SH', IMPLEMENTATION_VERSION)];
  const body = concat(els.flatMap(e => [e.head, e.v])), group = encodeElement('00020000', 'UL', body.length);
  return concat([group.head, group.v, body]);
};
const two = n => String(n).padStart(2, '0');
export const dicomDate = d => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
export const dicomTime = d => `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;

// series: everything that is the same for every slice. Returns a function slice(c, pixels) -> file bytes.
// params: { tpl, info (crop-source info), box (effective), geometry (exportGeometry), seriesUid, seriesNumber, now, derivation, description, spacing,
//   rescaleAt(c) -> {slope, intercept} of output slice c (default: info), syntheticReason (geometry not from the source: new FrameOfReferenceUID), frameOfReferenceUid }
export function createSliceWriter(params) {
  const { tpl, info, box, geometry, seriesUid, now, description, derivation } = params, n = box.n, sopClass = outputSopClass(tpl);
  const common = new Map(); // tag -> {vr, value}
  for (const [tag, bytes] of tpl.copied) common.set(tag, { vr: COPY_VR.get(tag), value: bytes });
  const set = (tag, vr, value) => common.set(tag, { vr, value });
  set('00080008', 'CS', imageTypeFor(tpl, sopClass)); set('00080016', 'UI', sopClass);
  if (sopClass === SC_IMAGE_STORAGE) set('00080064', 'CS', 'WSD'); // ConversionType (type 1 of the SC Equipment module)
  if (info.lossy) set('00282110', 'CS', '01'); // LossyImageCompression: the source was lossy compressed (the output itself is uncompressed)
  if (params.syntheticReason) { // geometry not taken from the source headers: never claim the source's frame of reference
    set('00200052', 'UI', params.frameOfReferenceUid || generateUid()); common.delete('00201040');
  }
  set('00080012', 'DA', dicomDate(now)); set('00080013', 'TM', dicomTime(now));
  set('00080021', 'DA', dicomDate(now)); set('00080031', 'TM', dicomTime(now)); set('00080023', 'DA', dicomDate(now)); set('00080033', 'TM', dicomTime(now));
  if (!common.has('00080060')) set('00080060', 'CS', tpl.modality || 'OT');
  set('0008103E', 'LO', description); set('00082111', 'ST', derivation);
  set('0020000E', 'UI', seriesUid); set('00200011', 'IS', String(params.seriesNumber));
  set('00200037', 'DS', formatDSList(geometry.orientation));
  if (!common.has('0020000D')) throw new Error('StudyInstanceUID missing in the source');
  set('00280002', 'US', 1); if (!common.has('00280004')) set('00280004', 'CS', info.photometric);
  set('00280010', 'US', n); set('00280011', 'US', n);
  set('00280100', 'US', info.bits); set('00280101', 'US', info.bitsStored); set('00280102', 'US', info.highBit); set('00280103', 'US', info.signed ? 1 : 0);
  const rescaleAt = params.rescaleAt || (() => info);
  set('00180088', 'DS', formatDS(params.spacing[2]));
  if (!common.has('00280030')) set('00280030', 'DS', formatDSList([params.spacing[1], params.spacing[0]])); // PixelSpacing: slice 0's original bytes (copied above, like SliceThickness) so the metadata is byte-identical; formatted only when the source lacks it
  const pixelVr = info.bits === 8 ? 'OB' : 'OW', o = geometry.orientation, nrm = [o[1] * o[5] - o[2] * o[4], o[2] * o[3] - o[0] * o[5], o[0] * o[4] - o[1] * o[3]]; // SliceLocation: position along the DICOM normal (row x column)
  return (c, pixels, sopInstanceUid) => {
    const pos = geometry.ipp[c], elems = new Map(common), rs = rescaleAt(c);
    elems.set('00281052', { vr: 'DS', value: formatDS(rs.intercept) });
    elems.set('00281053', { vr: 'DS', value: formatDS(rs.slope) });
    elems.set('00080018', { vr: 'UI', value: sopInstanceUid });
    elems.set('00200013', { vr: 'IS', value: String(c + 1) });
    elems.set('00200032', { vr: 'DS', value: formatDSList(pos) });
    elems.set('00201041', { vr: 'DS', value: formatDS(pos[0] * nrm[0] + pos[1] * nrm[1] + pos[2] * nrm[2]) });
    const items = [...elems].map(([tag, { vr, value }]) => encodeElement(tag, vr, value));
    const px = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const little = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
    let pxBytes = px;
    if (!little && info.bits === 16) { pxBytes = new Uint8Array(px.length); const dv = new DataView(pxBytes.buffer); for (let i = 0; i < pixels.length; i++) dv.setUint16(i * 2, pixels[i] & 0xffff, true); }
    items.push(encodeElement('7FE00010', pixelVr, pxBytes));
    items.sort((a, b) => a.t - b.t);
    const preamble = new Uint8Array(132); preamble.set(enc.encode('DICM'), 128);
    return concat([preamble, fileMeta(sopClass, sopInstanceUid), ...items.flatMap(e => [e.head, e.v])]);
  };
}

// file naming like the practice data (Sample_1_20250707_145722_0001.dcm): <prefix>_crop<N>_<0001>.dcm, in a folder <prefix>_crop<N>
export function namingFor(firstSourceName, n) {
  const m = /^(.*?)[_-]?\d+(\.[A-Za-z0-9]+)?$/.exec(firstSourceName || ''), prefix = (m?.[1] || (firstSourceName || '').replace(/\.[^.]*$/, '') || 'slice').replace(/[^A-Za-z0-9._-]+/g, '_');
  const folder = `${prefix}_crop${n}`, width = Math.max(4, String(n).length);
  return { folder, file: i => `${folder}_${String(i + 1).padStart(width, '0')}.dcm` };
}
