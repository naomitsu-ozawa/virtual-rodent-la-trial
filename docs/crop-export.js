// Crop export orchestration (no DOM; unit-tested in tests/unit/crop-export.test.js).
// Reads the ORIGINAL stored values from the source files (crop-source.js), cuts / resamples them (crop-resample.js), writes one DICOM file
// per slice (crop-dicom.js) into a sink: a folder chosen with showDirectoryPicker (File System Access API) or a .zip (fflate, stored).
import { Zip, ZipPassThrough } from 'https://esm.sh/fflate@0.8.2';
import { parseDicomHeader } from './dicom.js?v=20261026-build672';
import { seriesGeometry, rotationBlockReason, syntheticGeometryReason, effectiveBox, boxAligned, exportGeometry, sourceBounds } from './crop-geometry.js?v=20261026-build672';
import { makeStoredReader, fillStoredValue, storedBitsOf, CropExportError } from './crop-source.js?v=20261026-build672';
import { createSampler, resampleSlice, copyAlignedSlice } from './crop-resample.js?v=20261026-build672';
import { extractTemplate, createSliceWriter, generateUid, seriesDescriptionFor, derivationDescriptionFor, namingFor } from './crop-dicom.js?v=20261026-build672';
import { frameYield } from './utils.js?v=20261026-build672';

export { CropExportError };
const MiB = 2 ** 20, GiB = 2 ** 30;
// the rotated crop holds the bounding sub-block of the source in memory: stored integers (1 or 2 bytes). Above this the export stops with a clear message.
export const ROTATED_BLOCK_LIMIT_BYTES = 1.5 * GiB;
const ROTATED_BLOCK_FLOOR_BYTES = 256 * MiB;
// The limit for this machine: a quarter of the device memory (navigator.deviceMemory, GiB, when known), and the memory the viewer already holds
// for the whole volume (residentBytes) is not available for the block.
export function rotatedBlockLimitFor({ deviceMemoryGB = 0, residentBytes = 0 } = {}) {
  let limit = ROTATED_BLOCK_LIMIT_BYTES;
  if (deviceMemoryGB > 0) limit = Math.min(limit, deviceMemoryGB * 0.25 * GiB);
  if (residentBytes > 0) limit = limit - residentBytes;
  return Math.max(ROTATED_BLOCK_FLOOR_BYTES, limit);
}

export function rotatedBlockBytes(series, box) {
  const geom = seriesGeometry(series), b = sourceBounds(effectiveBox(box), geom.spacing, geom.dims, 2);
  return b ? b.w * b.h * b.d * (series.slices[0].bits === 8 ? 1 : 2) : 0;
}

// Inputs the export cannot write correctly are refused up front (before any folder is created). Throws a CropExportError (codes: unsupported-samples,
// unsupported-multiframe, unsupported-bits, unsupported-photometric, unsupported-highbit, unsupported-rescale, mixed-storage, mixed-size).
export function checkExportable(series) {
  const sl = series?.slices || [];
  if (!sl.length) throw new CropExportError('unsupported-empty', 'The series has no slices');
  const f = sl[0], bitsOf = m => (m.bits === 8 ? 8 : m.bits === 16 ? 16 : 0), fb = storedBitsOf(f.bits, f.bitsStored);
  for (const m of sl) {
    if ((m.samples || 1) !== 1) throw new CropExportError('unsupported-samples', 'Colour images (SamplesPerPixel > 1) are not supported');
    if ((m.numberOfFrames || 1) > 1 && m.frameIndex == null) throw new CropExportError('unsupported-multiframe', 'Uncompressed multi-frame images are not supported');
    if (!bitsOf(m)) throw new CropExportError('unsupported-bits', 'Unsupported BitsAllocated=' + m.bits);
    if (!/^MONOCHROME[12]$/.test(m.photometricInterpretation || 'MONOCHROME2')) throw new CropExportError('unsupported-photometric', 'Unsupported PhotometricInterpretation ' + m.photometricInterpretation);
    if (m.highBit != null && m.highBit !== storedBitsOf(m.bits, m.bitsStored) - 1) throw new CropExportError('unsupported-highbit', 'HighBit is not BitsStored-1');
    if (!Number.isFinite(m.slope) || m.slope === 0 || !Number.isFinite(m.intercept)) throw new CropExportError('unsupported-rescale', 'Invalid RescaleSlope / RescaleIntercept');
    if (bitsOf(m) !== bitsOf(f) || !!m.signed !== !!f.signed || storedBitsOf(m.bits, m.bitsStored) !== fb) throw new CropExportError('mixed-storage', 'Slices with different BitsAllocated / BitsStored / PixelRepresentation');
    if (m.rows !== f.rows || m.columns !== f.columns) throw new CropExportError('mixed-size', 'Slices with different Rows / Columns');
  }
}

const BLOCK_MESSAGES = { tilt: 'Gantry-tilted series can only be cropped axis aligned', geometry: 'Series without real position / orientation tags can only be cropped axis aligned', spacing: 'Series with missing or uneven slice spacing can only be cropped axis aligned' };

export async function exportCrop({ series, box, sink, volumeMinHu = NaN, decodeCompressed = null, onProgress = null, isCancelled = null, now = new Date(), random, blockLimit = ROTATED_BLOCK_LIMIT_BYTES }) {
  try {
    return await run({ series, box, sink, volumeMinHu, decodeCompressed, onProgress, isCancelled, now, random, blockLimit });
  } catch (err) { // never leave a half written series behind: the sink removes what it wrote, or reports that it could not (err.cleanup.removed === false)
    let cleanup = null;
    try { cleanup = (await sink?.abort?.()) ?? null; } catch { cleanup = { removed: false }; }
    if (err && typeof err === 'object') err.cleanup = cleanup;
    throw err;
  }
}

async function run({ series, box, sink, volumeMinHu, decodeCompressed, onProgress, isCancelled, now, random, blockLimit }) {
  checkExportable(series);
  const geom = seriesGeometry(series), eff = effectiveBox(box), aligned = boxAligned(eff), n = eff.n, d = geom.dims;
  if (!aligned) { const why = rotationBlockReason(geom); if (why) throw new CropExportError(why, BLOCK_MESSAGES[why]); }
  const cancelled = () => { if (isCancelled?.()) throw new CropExportError('cancelled', 'cancelled'); };
  const reader = makeStoredReader(series, { decodeCompressed, mode: aligned ? 'aligned' : 'rotated' }), info = reader.info, Ctor = info.Ctor;
  const tpl = extractTemplate(await parseDicomHeader(series.slices[0].file)); // template, storage info and spacing all come from the same source slice (slice 0)
  const geometry = exportGeometry(geom, eff), offset = geometry.offset, syntheticReason = syntheticGeometryReason(geom);
  // the source slice whose calibration output slice c carries (axis aligned: its own source slice; outside the volume: the nearest one)
  const k0 = aligned ? offset.k0 : 0, refSlice = c => Math.max(0, Math.min(d.slices - 1, k0 + c)), fillCache = new Map();
  const fillAt = c => {
    const rs = info.rescaleOf(aligned ? refSlice(c) : 0), key = rs.slope + '|' + rs.intercept;
    if (!fillCache.has(key)) fillCache.set(key, fillStoredValue({ range: info.range, slope: rs.slope, intercept: rs.intercept }, tpl.modality, volumeMinHu));
    return fillCache.get(key);
  };
  const fills = Array.from({ length: n }, (_, c) => fillAt(c)), distinct = [...fillCache.values()], differs = distinct.some(x => x.stored !== distinct[0].stored || x.hu !== distinct[0].hu);
  const fill = differs ? { ...fills[0], perSlice: true, huMin: Math.min(...distinct.map(x => x.hu)), huMax: Math.max(...distinct.map(x => x.hu)) } : { ...fills[0] };
  const seriesUid = generateUid(random), naming = namingFor(series.slices[0].file?.name, n);
  const writer = createSliceWriter({
    tpl, info, box: eff, geometry, seriesUid, seriesNumber: (Number.isFinite(tpl.seriesNumber) ? tpl.seriesNumber : 0) + 1000, now, spacing: geom.spacing,
    rescaleAt: c => info.rescaleOf(aligned ? refSlice(c) : 0), syntheticReason, frameOfReferenceUid: syntheticReason ? generateUid(random) : null,
    description: seriesDescriptionFor(tpl, eff, aligned),
    derivation: derivationDescriptionFor({ tpl, box: eff, aligned, offset, fill, info, geomSpacing: geom.spacing, syntheticReason }),
  });
  const uid = () => generateUid(random), out = new Ctor(n * n);
  const emit = async c => { await sink.add(naming.folder + '/' + naming.file(c), writer(c, out, uid())); onProgress?.(c + 1, n, 'write'); if ((c & 7) === 7) await frameYield(); };
  if (aligned) {
    const { i0, j0 } = offset;
    for (let c = 0; c < n; c++) {
      cancelled();
      const k = k0 + c, src = k >= 0 && k < d.slices && i0 < d.columns && i0 + n > 0 && j0 < d.rows && j0 + n > 0 ? await reader.read(k) : null;
      copyAlignedSlice(src, d.columns, d.rows, i0, j0, n, fills[c].stored, out);
      await emit(c);
    }
  } else {
    const bounds = sourceBounds(eff, geom.spacing, d, 2);
    let block = null;
    if (bounds) {
      const bytes = bounds.w * bounds.h * bounds.d * Ctor.BYTES_PER_ELEMENT;
      if (bytes > blockLimit) throw new CropExportError('too-large', `Rotated crop needs ${(bytes / MiB).toFixed(0)} MiB of source data (limit ${(blockLimit / MiB).toFixed(0)} MiB)`);
      let data;
      try { data = new Ctor(bounds.w * bounds.h * bounds.d); } catch { throw new CropExportError('too-large', `Not enough memory for the rotated crop (${(bytes / MiB).toFixed(0)} MiB of source data)`); }
      block = { x0: bounds.x0, y0: bounds.y0, z0: bounds.z0, w: bounds.w, h: bounds.h, d: bounds.d, data };
      let next = bounds.z0, done = 0;
      const lane = async () => {
        while (true) {
          cancelled();
          const z = next++; if (z > bounds.z1) return;
          const src = await reader.read(z), base = (z - bounds.z0) * bounds.h * bounds.w;
          for (let y = 0; y < bounds.h; y++) { const s = (bounds.y0 + y) * d.columns + bounds.x0; block.data.set(src.subarray(s, s + bounds.w), base + y * bounds.w); }
          onProgress?.(++done, bounds.d, 'read');
        }
      };
      await Promise.all(Array.from({ length: 4 }, lane));
    }
    const sampler = block ? createSampler(block, d, eff.interp, fill.stored, info.range) : () => fill.stored;
    for (let c = 0; c < n; c++) { cancelled(); resampleSlice(eff, geom.spacing, sampler, c, out); await emit(c); }
  }
  await sink.finish?.();
  return { folder: naming.folder, count: n, seriesUid, aligned, fill, geometry, converted: info.converted, perSliceRescale: info.perSliceRescale, compressed: info.compressed, lossy: info.lossy, syntheticGeometry: syntheticReason };
}

// ---- sinks ----
// every sink: add(path, bytes), finish(), abort() -> { removed } (removes what was written; removed:false = the folder is left incomplete)
export function memorySink() {
  const files = new Map();
  return { files, aborted: false, add: async (path, bytes) => { files.set(path, bytes); }, finish: async () => {}, abort: async function () { files.clear(); this.aborted = true; return { removed: true }; } };
}
// parent: a FileSystemDirectoryHandle (showDirectoryPicker); the series goes into a NEW sub folder (an existing one is never overwritten)
export async function directorySink(parent, folder) {
  let name = folder, dir = null;
  for (let i = 2; !dir; i++) {
    try { await parent.getDirectoryHandle(name); name = folder + '_' + i; } catch (e) { if (e?.name === 'NotFoundError') dir = await parent.getDirectoryHandle(name, { create: true }); else throw e; }
  }
  const written = [];
  return {
    folderName: name,
    add: async (path, bytes) => {
      const file = path.split('/').pop(); written.push(file); // listed before the write: a file that failed half way is removed as well
      const fh = await dir.getFileHandle(file, { create: true }), w = await fh.createWritable();
      try { await w.write(bytes); await w.close(); } catch (e) { try { await w.abort(); } catch { /* already closed */ } throw e; }
    },
    finish: async () => {},
    abort: async () => {
      let removed = true;
      for (const f of written) { try { await dir.removeEntry(f); } catch (e) { if (e?.name !== 'NotFoundError') removed = false; } }
      try { await parent.removeEntry(name); } catch (e) { if (e?.name !== 'NotFoundError') removed = false; } // an empty folder only
      return { removed, folder: name };
    },
  };
}
// deps: for tests only (a stand-in for fflate's Zip / ZipPassThrough)
export function zipSink(onDone, { ZipCtor = Zip, PassThrough = ZipPassThrough } = {}) {
  const chunks = []; let failure = null, finished = null, settle = null;
  const done = new Promise((res, rej) => { settle = { res, rej }; });
  done.catch(() => {}); // the caller sees the failure through add() / finish(); no unhandled rejection
  const zip = new ZipCtor((err, chunk, final) => { // a callback cannot throw to the awaiting caller: the error is kept and re-thrown by add() / finish()
    if (err) { failure = err; settle.rej(err); return; }
    chunks.push(chunk);
    if (final) { finished = new Blob(chunks, { type: 'application/zip' }); settle.res(); }
  });
  return {
    add: async (path, bytes) => { if (failure) throw failure; const f = new PassThrough(path); zip.add(f); f.push(bytes, true); if (failure) throw failure; },
    finish: async () => { if (failure) throw failure; zip.end(); await done; onDone(finished); },
    abort: async () => { try { zip.terminate(); } catch { /* nothing to stop */ } chunks.length = 0; return { removed: true }; }, // nothing was handed to the user
  };
}
