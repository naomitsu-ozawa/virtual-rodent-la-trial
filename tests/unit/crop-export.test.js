import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import dicomParser from 'dicom-parser';
import { unzipSync } from 'fflate';
import { parseDicomHeader, parsedSliceMeta, groupSeries } from '../../docs/dicom.js';
import { decodeSourceSlice } from '../../docs/volume-io.js';
import { exportCrop, memorySink, zipSink, directorySink, rotatedBlockBytes, rotatedBlockLimitFor, checkExportable, ROTATED_BLOCK_LIMIT_BYTES, CropExportError } from '../../docs/crop-export.js';
import { generateUid, isValidUid, formatDS, namingFor } from '../../docs/crop-dicom.js';
import { makeStoredReader, fillStoredValue, storedRange, readNativeStoredSlice } from '../../docs/crop-source.js';
import { makeCtSlice, asFile } from '../helpers/synthetic-dicom.js';

const W = 20, H = 18, D = 12;
const valueAt = (i, j, k) => ((i * 131 + j * 71 + k * 997 + ((i * j) % 7) * 53) % 3001) - 700; // deterministic, all different, signed
async function makeSeries({ signed = 1, slope = 1, intercept = -1000, spacing = [0.2, 0.3], thickness = 0.5, dz = 0.5, perSlice = null, orientation = [-1, 0, 0, 0, -1, 0], bitsStored = 16, modality = 'CT', desc = 'Whole body', pixelAt = null, posAt = null, slopeAt = null, interceptAt = null, extra = [] } = {}) {
  const metas = [];
  for (let k = 0; k < D; k++) {
    const px = signed ? new Int16Array(W * H) : new Uint16Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) px[j * W + i] = pixelAt ? pixelAt(i, j, k) : signed ? valueAt(i, j, k) : valueAt(i, j, k) + 700;
    const o = { rows: H, columns: W, signed, bitsStored, modality, slope: slopeAt ? slopeAt(k) : slope, intercept: interceptAt ? interceptAt(k) : intercept, pixelSpacing: spacing, thickness, position: posAt ? posAt(k) : [10, 20, 5 + k * dz], orientation, instance: k + 1, seriesUid: '1.2.3.4', studyUid: '1.2.3',
      pixels: px, extra: [['00100010', 'PN', 'Sample^Rat'], ['00100020', 'LO', 'P-001'], ['00080070', 'LO', 'Rigaku'], ['00200052', 'UI', '1.2.3.77'], ['00200011', 'IS', '5'], ['0008103E', 'LO', desc], ...extra, ...(perSlice?.(k) || [])] };
    const f = asFile(makeCtSlice(o), `Test_20250101_${String(k + 1).padStart(4, '0')}.dcm`);
    metas.push(parsedSliceMeta(f, await parseDicomHeader(f)));
  }
  return groupSeries(metas)[0];
}
const stored = (k, j, i, signed = 1) => (signed ? valueAt(i, j, k) : valueAt(i, j, k) + 700);
const parseOut = bytes => dicomParser.parseDicom(bytes);
const pix = (ds, signed = 1) => { const e = ds.elements.x7fe00010, a = ds.byteArray.slice(e.dataOffset, e.dataOffset + e.length); return signed ? new Int16Array(a.buffer) : new Uint16Array(a.buffer); };
const box = (o = {}) => ({ n: 8, center: { i: 7.5, j: 8.5, k: 5.5 }, angles: { x: 0, y: 0, z: 0 }, interp: 'linear', ...o }); // aligned: i0=4 j0=5 k0=2
const sortedFiles = sink => [...sink.files.keys()].sort().map(k => [k, sink.files.get(k)]);

describe('(a) axis aligned crop is a bit-identical copy of the source sub-block', () => {
  for (const signed of [1, 0]) it(signed ? 'signed storage' : 'unsigned storage', async () => {
    const s = await makeSeries({ signed, slope: 2, intercept: -1000 }), sink = memorySink(), r = await exportCrop({ series: s, box: box(), sink });
    expect(r.aligned).toBe(true); expect(r.count).toBe(8);
    const files = sortedFiles(sink); expect(files.length).toBe(8);
    files.forEach(([, bytes], c) => {
      const p = pix(parseOut(bytes), signed);
      for (let b = 0; b < 8; b++) for (let a = 0; a < 8; a++) expect(p[b * 8 + a]).toBe(stored(2 + c, 5 + b, 4 + a, signed));
    });
  });
  it('is independent of the in-memory / display data (reads the files only) and applies no filter', async () => {
    const s = await makeSeries(); s.slices.forEach(m => { m.filtered = true; });
    const sink = memorySink(); await exportCrop({ series: s, box: box(), sink });
    expect(pix(parseOut(sortedFiles(sink)[0][1]))[0]).toBe(valueAt(4, 5, 2));
  });
  it('snaps a fractional position to the voxel grid', async () => {
    const s = await makeSeries(), sink = memorySink(); await exportCrop({ series: s, box: box({ center: { i: 7.9, j: 8.4, k: 5.6 } }), sink });
    expect(pix(parseOut(sortedFiles(sink)[0][1]))[0]).toBe(valueAt(4, 5, 2));
  });
  it('a box that leaves the volume is padded with the fill value (air, -1024 HU as a stored value) and keeps inside values', async () => {
    const s = await makeSeries({ slope: 1, intercept: -1000 }), sink = memorySink();
    const r = await exportCrop({ series: s, box: box({ n: 8, center: { i: 1.5, j: 8.5, k: 5.5 } }), sink }); // i0 = -2
    expect(r.fill).toMatchObject({ stored: -24, hu: -1024 });
    const p = pix(parseOut(sortedFiles(sink)[0][1]));
    expect(p[0]).toBe(-24); expect(p[1]).toBe(-24); expect(p[2]).toBe(valueAt(0, 5, 2)); expect(p[7]).toBe(valueAt(5, 5, 2));
  });
});

describe('(b) metadata', () => {
  it('copies patient / study / equipment, keeps rescale and storage, sets spacing, UIDs and positions', async () => {
    const s = await makeSeries({ slope: 2, intercept: -1000, spacing: [0.2, 0.3], thickness: 0.5, dz: 0.5 }), sink = memorySink(), now = new Date(2026, 9, 13, 12, 30, 45);
    const r = await exportCrop({ series: s, box: box(), sink, now }), files = sortedFiles(sink);
    expect(r.folder).toBe('Test_20250101_crop8'); expect(files[0][0]).toBe('Test_20250101_crop8/Test_20250101_crop8_0001.dcm');
    const ds = files.map(([, b]) => parseOut(b)), d0 = ds[0], str = (d, t) => d.string('x' + t.toLowerCase());
    expect(str(d0, '00100010')).toBe('Sample^Rat'); expect(str(d0, '00100020')).toBe('P-001'); expect(str(d0, '00080070')).toBe('Rigaku'); expect(str(d0, '00080060')).toBe('CT');
    expect(str(d0, '00200052')).toBe('1.2.3.77'); // same frame of reference
    expect(str(d0, '00080008')).toBe('DERIVED\\SECONDARY\\AXIAL'); expect(str(d0, '00080016')).toBe('1.2.840.10008.5.1.4.1.1.2');
    expect(d0.uint16('x00280010')).toBe(8); expect(d0.uint16('x00280011')).toBe(8); expect(d0.uint16('x00280100')).toBe(16); expect(d0.uint16('x00280101')).toBe(12 + 4); expect(d0.uint16('x00280103')).toBe(1); expect(str(d0, '00280004')).toBe('MONOCHROME2');
    expect(Number(str(d0, '00281052'))).toBe(-1000); expect(Number(str(d0, '00281053'))).toBe(2);
    expect(str(d0, '00280030')).toBe('0.2\\0.3'); expect(Number(str(d0, '00180050'))).toBe(0.5); expect(Number(str(d0, '00180088'))).toBe(0.5);
    // UIDs
    expect(str(d0, '0020000D')).toBe('1.2.3'); const series = new Set(ds.map(d => str(d, '0020000E'))), sops = new Set(ds.map(d => str(d, '00080018')));
    expect(series.size).toBe(1); expect([...series][0]).not.toBe('1.2.3.4'); expect(isValidUid([...series][0])).toBe(true); expect(sops.size).toBe(8); expect([...sops].every(isValidUid)).toBe(true);
    expect(str(d0, '00020003')).toBe(str(d0, '00080018')); // file meta matches
    expect(Number(str(d0, '00200011'))).toBe(1005); expect(ds.map(d => Number(str(d, '00200013')))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // geometry: IOP copied, IPP = source slice position + in-plane offset (i0=4, j0=5, k0=2), rowDir=-x colDir=-y
    expect(str(d0, '00200037').split('\\').map(Number)).toEqual([-1, 0, 0, 0, -1, 0]);
    ds.forEach((d, c) => { const p = str(d, '00200032').split('\\').map(Number); [10 - 4 * 0.3, 20 - 5 * 0.2, 5 + (2 + c) * 0.5].forEach((v, m) => expect(p[m]).toBeCloseTo(v, 9)); });
    // marked as a not resampled crop
    expect(str(d0, '0008103E')).toBe('Whole body crop 8 (not resampled)'); expect(str(d0, '00082111')).toMatch(/not resampled.*i0=4 j0=5 k0=2/);
    expect(str(d0, '00080021')).toBe('20261013'); expect(str(d0, '00080031')).toBe('123045');
    expect(d0.elements.x00280106).toBeUndefined(); // smallest / largest pixel value are not carried over
  });
  it('rotated output says resampled (interpolation) and its IOP / IPP describe the box', async () => {
    const s = await makeSeries({ spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 }), sink = memorySink();
    const r = await exportCrop({ series: s, box: box({ angles: { x: 0, y: 0, z: 90 }, interp: 'nearest' }), sink }), files = sortedFiles(sink), d0 = parseOut(files[0][1]), str = t => d0.string('x' + t.toLowerCase());
    expect(r.aligned).toBe(false);
    expect(str('0008103E')).toBe('Whole body crop 8 resampled (nearest)'); expect(str('00082111')).toMatch(/Resampled with nearest interpolation/);
    const iop = str('00200037').split('\\').map(Number);
    expect(iop).toEqual([0, -1, 0, 1, 0, 0]); // rowDir = source colDir (-y), colDir = -source rowDir (+x)
    const ipp0 = str('00200032').split('\\').map(Number);
    // centre (7.5,8.5,5.5) -> patient (10-7.5*.2, 20-8.5*.2, 5+5.5*.2); first voxel: -3.5 voxel steps along rowDir_out and colDir_out and slice
    const cen = [10 - 7.5 * 0.2, 20 - 8.5 * 0.2, 5 + 5.5 * 0.2], expect0 = [cen[0] - 3.5 * 0.2 * 0 - 3.5 * 0.2 * 1, cen[1] - 3.5 * 0.2 * -1 - 3.5 * 0.2 * 0, cen[2] - 3.5 * 0.2];
    expect0.forEach((v, m) => expect(ipp0[m]).toBeCloseTo(v, 9));
  });
});

describe('(c) rotation by 90 degrees with nearest interpolation reproduces exact source values', () => {
  // output(a,b,c) <- source(center + R * (a-h, b-h, c-h)) with R = Rz / Rx / Ry(90): worked out by hand below
  const h = 3.5, C = { i: 9.5, j: 8.5, k: 5.5 };
  const expected = {
    z: (a, b, c) => [C.i - (b - h), C.j + (a - h), C.k + (c - h)],
    x: (a, b, c) => [C.i + (a - h), C.j - (c - h), C.k + (b - h)],
    y: (a, b, c) => [C.i + (c - h), C.j + (b - h), C.k - (a - h)],
  };
  for (const axis of ['x', 'y', 'z']) for (const interp of ['nearest', 'linear', 'cubic']) it(`about ${axis}, ${interp}`, async () => {
    const s = await makeSeries({ spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 }), sink = memorySink();
    await exportCrop({ series: s, box: box({ center: C, angles: { x: 0, y: 0, z: 0, [axis]: 90 }, interp }), sink });
    sortedFiles(sink).forEach(([, bytes], c) => {
      const p = pix(parseOut(bytes));
      for (let b = 0; b < 8; b++) for (let a = 0; a < 8; a++) { const [i, j, k] = expected[axis](a, b, c); expect(p[b * 8 + a]).toBe(valueAt(i, j, k)); }
    });
  });
  it('180 degrees is exact too, and samples outside the volume are the fill value', async () => {
    const s = await makeSeries({ spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 }), sink = memorySink();
    await exportCrop({ series: s, box: box({ center: { i: 0.5, j: 8.5, k: 5.5 }, angles: { x: 0, y: 0, z: 180 }, interp: 'nearest' }), sink });
    const p = pix(parseOut(sortedFiles(sink)[0][1]));
    // a -> source i = 0.5 - (a-3.5) = 4 - a ; i = -1..-4 (a=5..7 and beyond) is outside
    expect(p[0 * 8 + 0]).toBe(valueAt(4, 12, 2)); // a=0,b=0 -> i = 0.5-(0-3.5) = 4, j = 8.5-(0-3.5) = 12, k = 2
    expect(p[0 * 8 + 5]).toBe(-24); expect(p[0 * 8 + 4]).toBe(valueAt(0, 12, 2));
  });
  it('linear interpolation between voxels is the rounded weighted mean; nearest keeps original values', async () => {
    const s = await makeSeries({ spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 }), a = memorySink(), b = memorySink();
    const base = { n: 4, center: { i: 8.5, j: 8, k: 5 }, angles: { x: 0, y: 0, z: 1e-7 } }; // 'rotated' by a negligible angle, shifted by half a voxel in x
    await exportCrop({ series: s, box: { ...base, interp: 'linear' }, sink: a }); await exportCrop({ series: s, box: { ...base, interp: 'nearest' }, sink: b });
    const pl = pix(parseOut(sortedFiles(a)[0][1])), pn = pix(parseOut(sortedFiles(b)[0][1]));
    // output (a=0,b=0,c=0) sits at source (8.5-1.5, 8-1.5, 5-1.5) = (7, 6.5, 3.5) -> mean of j 6,7 and k 3,4
    expect(pl[0]).toBe(Math.round((valueAt(7, 6, 3) + valueAt(7, 7, 3) + valueAt(7, 6, 4) + valueAt(7, 7, 4)) / 4));
    expect(new Set([valueAt(7, 6, 3), valueAt(7, 7, 3), valueAt(7, 6, 4), valueAt(7, 7, 4)]).has(pn[0])).toBe(true);
  });
  it('anisotropic source: spacing stays per axis (no resizing); rotating about z by 90 degrees is a physical resampling', async () => {
    const s = await makeSeries({ spacing: [0.2, 0.3], dz: 0.5, thickness: 0.5 }), sink = memorySink();
    await exportCrop({ series: s, box: box({ angles: { x: 0, y: 0, z: 90 }, interp: 'nearest' }), sink });
    const d0 = parseOut(sortedFiles(sink)[0][1]);
    expect(d0.string('x00280030')).toBe('0.2\\0.3'); expect(Number(d0.string('x00180088'))).toBe(0.5); // output axes carry the source axis spacings
  });
  it('refuses rotation for a gantry-tilted series and a too large rotated block', async () => {
    const s = await makeSeries(); s.slices.forEach((m, k) => { m.pos = [10, 20 + k * 0.3, 5 + k * 0.4]; });
    await expect(exportCrop({ series: s, box: box({ angles: { x: 0, y: 0, z: 30 } }), sink: memorySink() })).rejects.toMatchObject({ code: 'tilt' });
    const s2 = await makeSeries();
    await expect(exportCrop({ series: s2, box: box({ angles: { x: 0, y: 0, z: 30 } }), sink: memorySink(), blockLimit: 100 })).rejects.toBeInstanceOf(CropExportError);
    expect(rotatedBlockBytes(s2, box({ angles: { x: 0, y: 0, z: 30 } }))).toBeGreaterThan(100);
  });
});

describe('(d) export -> re-parse with the app parser round-trips', () => {
  it('series, geometry and calibrated values survive', async () => {
    const s = await makeSeries({ slope: 2, intercept: -1000, spacing: [0.2, 0.3], dz: 0.5, thickness: 0.5 }), sink = memorySink();
    await exportCrop({ series: s, box: box(), sink });
    const metas = [];
    for (const [name, bytes] of sortedFiles(sink)) { const f = asFile(bytes, name.split('/').pop()); metas.push(parsedSliceMeta(f, await parseDicomHeader(f))); }
    const out = groupSeries(metas);
    expect(out.length).toBe(1); const o = out[0];
    expect([o.columns, o.rows, o.slices.length]).toEqual([8, 8, 8]);
    expect([o.spacingX, o.spacingY]).toEqual([0.3, 0.2]); expect(o.spacingZ).toBeCloseTo(0.5, 9);
    expect(o.slices.map(m => m.instance)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(o.slices[0].slope).toBe(2); expect(o.slices[0].intercept).toBe(-1000);
    for (let c = 0; c < 8; c++) {
      const hu = await decodeSourceSlice(o.slices[c]);
      for (let b = 0; b < 8; b++) for (let a = 0; a < 8; a++) expect(hu[b * 8 + a]).toBe(valueAt(4 + a, 5 + b, 2 + c) * 2 - 1000);
    }
  });
  it('a rotated export re-parses with a consistent orthonormal orientation and spacing', async () => {
    const s = await makeSeries({ spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 }), sink = memorySink();
    await exportCrop({ series: s, box: box({ angles: { x: 10, y: 20, z: 30 }, interp: 'cubic' }), sink });
    const metas = [];
    for (const [name, bytes] of sortedFiles(sink)) { const f = asFile(bytes, name.split('/').pop()); metas.push(parsedSliceMeta(f, await parseDicomHeader(f))); }
    const o = groupSeries(metas)[0], iop = o.slices[0].orientation, r = iop.slice(0, 3), c = iop.slice(3);
    expect(Math.hypot(...r)).toBeCloseTo(1, 9); expect(Math.hypot(...c)).toBeCloseTo(1, 9); expect(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]).toBeCloseTo(0, 9);
    expect(o.spacingZ).toBeCloseTo(0.2, 6); expect(o.spacingCheck.warn).toBeFalsy();
  });
  it('zip sink keeps the folder and the bytes', async () => {
    const s = await makeSeries(), ms = memorySink(); await exportCrop({ series: s, box: box({ n: 4 }), sink: ms });
    let blob = null; await exportCrop({ series: s, box: box({ n: 4 }), sink: zipSink(b => { blob = b; }) });
    const z = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(z).sort()).toEqual([...ms.files.keys()].sort());
    expect(pix(parseOut(z['Test_20250101_crop4/Test_20250101_crop4_0001.dcm']))[0]).toBe(valueAt(6, 7, 4)); // i0 = round(7.5-1.5)=6, j0 = 7, k0 = 4
  });
});

describe('source reading and helpers', () => {
  it('slices with different rescale: axis aligned keeps the stored values and each slice its own rescale; rotated converts to the finest slope', async () => {
    const s = await makeSeries({ slope: 1, intercept: -1000, perSlice: null });
    s.slices[3].slope = 0.5; s.slices[3].intercept = -1000; // read as if slice 3 had a different calibration (only the metadata is changed here)
    const a = makeStoredReader(s); expect(a.info.converted).toBe(false); expect(a.info.perSliceRescale).toBe(true);
    expect((await a.read(3))[0]).toBe(valueAt(0, 0, 3)); expect(a.info.rescaleOf(3)).toEqual({ slope: 0.5, intercept: -1000 }); expect(a.info.rescaleOf(2)).toEqual({ slope: 1, intercept: -1000 });
    const r = makeStoredReader(s, { mode: 'rotated' }); expect(r.info.converted).toBe(true); expect(r.info.slope).toBe(0.5); expect(r.info.convertExact).toBe(true);
    expect((await r.read(2))[0]).toBe(valueAt(0, 0, 2) * 2); expect((await r.read(3))[0]).toBe(valueAt(0, 0, 3));
  });
  it('fill value: air for CT, series minimum otherwise, always inside the stored range', () => {
    const info = { slope: 1, intercept: -1024, range: [0, 65535] };
    expect(fillStoredValue(info, 'CT', -500)).toMatchObject({ stored: 0, hu: -1024 });
    const u = { slope: 0.5, intercept: 0, range: [0, 65535] };
    expect(fillStoredValue(u, 'MR', 40)).toMatchObject({ stored: 80 });
    expect(fillStoredValue({ slope: 1, intercept: -4000, range: [0, 65535] }, 'CT', 0).stored).toBe(2976);
  });
  it('UIDs: valid, unique; DS formatting; naming like the practice data', () => {
    const u = new Set(Array.from({ length: 50 }, () => generateUid())); expect(u.size).toBe(50); for (const x of u) expect(isValidUid(x)).toBe(true);
    expect(formatDS(-0.7071067811865476)).toBe('-0.707106781187'); expect(formatDS(1e-17)).toBe('0'); expect(formatDS(37.888)).toBe('37.888'); expect(formatDS(123456789012.5).length).toBeLessThanOrEqual(16);
    expect(namingFor('Sample_1_20250707_145722_0001.dcm', 256)).toMatchObject({ folder: 'Sample_1_20250707_145722_crop256' });
    expect(namingFor('Sample_1_20250707_145722_0001.dcm', 256).file(0)).toBe('Sample_1_20250707_145722_crop256_0001.dcm');
  });
});

// ---- review fixes: one regression test per finding ----
const strOf = (ds, t) => ds.string('x' + t.toLowerCase());
const rot = (o = {}) => box({ angles: { x: 0, y: 0, z: 30 }, interp: 'cubic', ...o });
const rawPx = (ds, Ctor = Uint16Array) => { const e = ds.elements.x7fe00010; return new Ctor(ds.byteArray.slice(e.dataOffset, e.dataOffset + e.length).buffer); };

describe('(1) the stored range follows BitsStored, not BitsAllocated', () => {
  it('storedRange', () => {
    expect(storedRange(16, false, 12)).toEqual([0, 4095]); expect(storedRange(16, true, 12)).toEqual([-2048, 2047]); expect(storedRange(16, false)).toEqual([0, 65535]); expect(storedRange(8, true, 8)).toEqual([-128, 127]);
  });
  it('a cubic resample of 12-bit data never leaves 0..4095 (an overshoot is clamped to the BitsStored range)', async () => {
    const s = await makeSeries({ signed: 0, bitsStored: 12, intercept: 0, modality: 'MR', pixelAt: i => (i < 12 ? 0 : 4095), spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 }), sink = memorySink();
    await exportCrop({ series: s, box: rot({ center: { i: 11.5, j: 9.5, k: 5.5 } }), sink });
    let max = 0, min = 65535, sawClamp = false;
    for (const [, bytes] of sink.files) { const ds = parseOut(bytes), p = rawPx(ds); for (const v of p) { max = Math.max(max, v); min = Math.min(min, v); if (v === 0 || v === 4095) sawClamp = true; } expect(ds.uint16('x00280101')).toBe(12); }
    expect(max).toBeLessThanOrEqual(4095); expect(min).toBeGreaterThanOrEqual(0); expect(sawClamp).toBe(true);
  });
  it('rotated reading masks to BitsStored (unsigned) and sign-extends (signed); the axis aligned copy stays raw', async () => {
    const dirty = (i, j, k) => 0xf000 | (valueAt(i, j, k) + 700) & 0x0fff; // high bits set in the source
    const u = await makeSeries({ signed: 0, bitsStored: 12, pixelAt: dirty, spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 });
    const a = memorySink(), b = memorySink();
    await exportCrop({ series: u, box: box(), sink: a }); await exportCrop({ series: u, box: box({ angles: { x: 0, y: 0, z: 90 }, interp: 'nearest' }), sink: b });
    expect(rawPx(parseOut(sortedFiles(a)[0][1]))[0]).toBe(dirty(4, 5, 2)); // byte copy
    const pb = rawPx(parseOut(sortedFiles(b)[0][1])); expect(Math.max(...pb)).toBeLessThanOrEqual(4095);
    const sg = await makeSeries({ signed: 1, bitsStored: 12, pixelAt: () => 0x0fff, spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 }), c = memorySink(); // 12 bit two's complement: 0x0fff = -1
    await exportCrop({ series: sg, box: box({ angles: { x: 0, y: 0, z: 90 }, interp: 'nearest' }), sink: c });
    expect(rawPx(parseOut(sortedFiles(c)[0][1]), Int16Array)[0]).toBe(-1);
  });
  it('the fill value is clamped to the BitsStored range', () => {
    expect(fillStoredValue({ slope: 1, intercept: -1500, range: [0, 4095] }, 'CT', -900).stored).toBe(476);
    const lowest = fillStoredValue({ slope: 1, intercept: -1000, range: [0, 65535] }, 'CT', NaN); // -1024 HU is below the unsigned range: the lowest stored value, described as such
    expect(lowest).toMatchObject({ stored: 0, hu: -1000 }); expect(lowest.rule).toMatch(/not representable/);
  });
});

describe('(2) per-slice rescale', () => {
  const slopeAt = k => (k % 2 ? 0.5 : 1), interceptAt = k => (k % 2 ? -1024 : -1000);
  it('axis aligned: stored values bit-identical, every output slice carries the rescale of its own source slice, HU exact', async () => {
    const s = await makeSeries({ slopeAt, interceptAt, signed: 0 }), sink = memorySink(), r = await exportCrop({ series: s, box: box(), sink });
    expect(r.perSliceRescale).toBe(true); expect(r.converted).toBe(false);
    sortedFiles(sink).forEach(([, bytes], c) => {
      const ds = parseOut(bytes), k = 2 + c, p = pix(ds, 0);
      expect(Number(strOf(ds, '00281053'))).toBe(slopeAt(k)); expect(Number(strOf(ds, '00281052'))).toBe(interceptAt(k));
      for (let b = 0; b < 8; b++) for (let a = 0; a < 8; a++) { expect(p[b * 8 + a]).toBe(stored(k, 5 + b, 4 + a, 0)); expect(p[b * 8 + a] * slopeAt(k) + interceptAt(k)).toBe(stored(k, 5 + b, 4 + a, 0) * slopeAt(k) + interceptAt(k)); }
    });
    expect(strOf(parseOut(sortedFiles(sink)[0][1]), '00082111')).toMatch(/keeps the RescaleSlope\/Intercept of its own source slice/);
  });
  it('padding outside the volume means the same HU in every slice (the fill follows each slice\'s own rescale)', async () => {
    const s = await makeSeries({ slopeAt: k => (k % 2 ? 0.5 : 1), intercept: -1000 }), sink = memorySink();
    const r = await exportCrop({ series: s, box: box({ center: { i: 1.5, j: 8.5, k: 5.5 } }), sink }); // i0 = -2: the first two columns are padding
    sortedFiles(sink).forEach(([, bytes], c) => { const ds = parseOut(bytes), v = pix(ds)[0]; expect(v * Number(strOf(ds, '00281053')) + Number(strOf(ds, '00281052'))).toBe(-1024); });
    expect(r.fill.perSlice).toBe(true); expect(strOf(parseOut(sortedFiles(sink)[0][1]), '00082111')).toMatch(/per slice, to the stored value meaning -1024 HU in that slice's own scale/);
  });
  it('rotated: converted to the finest slope (exact here), described; an unrepresentable value aborts instead of clamping', async () => {
    const s = await makeSeries({ slopeAt, interceptAt: () => -1000, signed: 0, spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 }), sink = memorySink();
    const r = await exportCrop({ series: s, box: rot({ interp: 'nearest', angles: { x: 0, y: 0, z: 90 } }), sink });
    expect(r.converted).toBe(true); const d0 = parseOut(sortedFiles(sink)[0][1]);
    expect(Number(strOf(d0, '00281053'))).toBe(0.5); expect(strOf(d0, '00082111')).toMatch(/converted to slope 0\.5 intercept -1000 \(the finest slope\) without rounding/);
    // 12 bit data near the top at slope 1 does not fit at slope 0.25: abort, never clamp
    const t = await makeSeries({ slopeAt: k => (k % 2 ? 0.25 : 1), intercept: 0, signed: 0, bitsStored: 12, pixelAt: () => 4000, spacing: [0.2, 0.2], dz: 0.2, thickness: 0.2 });
    await expect(exportCrop({ series: t, box: rot({ interp: 'nearest' }), sink: memorySink() })).rejects.toMatchObject({ code: 'rescale-overflow' });
    // axis aligned is still fine for the same series
    await expect(exportCrop({ series: t, box: box(), sink: memorySink() })).resolves.toBeTruthy();
  });
  it('compressed source: stored values (any array type, Float32 included) are never treated as HU; non-integers are refused', async () => {
    const s = await makeSeries({ signed: 0, slope: 0.5, intercept: -1000 });
    s.slices.forEach(m => { m.ts = '1.2.840.10008.1.2.4.70'; });
    const native = m => readNativeStoredSlice({ ...m, ts: '1.2.840.10008.1.2.1' });
    const a = memorySink(); await exportCrop({ series: s, box: box(), sink: a, decodeCompressed: async m => native(m) });
    expect(pix(parseOut(sortedFiles(a)[0][1]), 0)[0]).toBe(stored(2, 5, 4, 0));
    const b = memorySink(); await exportCrop({ series: s, box: box(), sink: b, decodeCompressed: async m => Float32Array.from(await native(m)) }); // stored values handed back as floats: still stored values
    expect(pix(parseOut(sortedFiles(b)[0][1]), 0)[0]).toBe(stored(2, 5, 4, 0));
    await expect(exportCrop({ series: s, box: box(), sink: memorySink(), decodeCompressed: async m => Float32Array.from(await native(m), v => v + 0.2) })).rejects.toMatchObject({ code: 'not-exact' });
  });
});

describe('(3) synthetic geometry never claims the source frame of reference', () => {
  const frame = ds => strOf(ds, '00200052');
  it('real geometry keeps FrameOfReferenceUID', async () => {
    const s = await makeSeries(), sink = memorySink(); await exportCrop({ series: s, box: box(), sink });
    expect(frame(parseOut(sortedFiles(sink)[0][1]))).toBe('1.2.3.77');
  });
  for (const [name, mutate, text] of [
    ['IPP missing', s => s.slices.forEach(m => { m.pos = null; }), /ImagePositionPatient missing/],
    ['IOP missing', s => s.slices.forEach(m => { m.orientation = null; }), /ImageOrientationPatient missing/],
    ['multi-frame positions made up by the viewer', s => s.slices.forEach(m => { m.syntheticPos = true; }), /multi-frame/],
  ]) it(name + ': new FrameOfReferenceUID, description says synthetic, rotation refused, axis aligned still works', async () => {
    const s = await makeSeries(); mutate(s);
    const sink = memorySink(), r = await exportCrop({ series: s, box: box(), sink }), d0 = parseOut(sortedFiles(sink)[0][1]);
    expect(r.syntheticGeometry).toMatch(text); expect(frame(d0)).not.toBe('1.2.3.77'); expect(isValidUid(frame(d0))).toBe(true); expect(strOf(d0, '00082111')).toMatch(/Geometry is synthetic/);
    expect(new Set(sortedFiles(sink).map(([, b]) => frame(parseOut(b)))).size).toBe(1);
    await expect(exportCrop({ series: s, box: rot(), sink: memorySink() })).rejects.toMatchObject({ code: 'geometry' });
  });
});

describe('(4) unsupported input is refused before anything is created', () => {
  const spy = () => { const calls = []; return { calls, add: async () => { calls.push('add'); }, finish: async () => { calls.push('finish'); }, abort: async () => ({ removed: true }) }; };
  for (const [name, mutate, code] of [
    ['RGB (SamplesPerPixel 3)', s => { s.slices[0].samples = 3; }, 'unsupported-samples'],
    ['uncompressed multi-frame', s => { s.slices.forEach(m => { m.numberOfFrames = 4; }); }, 'unsupported-multiframe'],
    ['BitsAllocated 32', s => { s.slices.forEach(m => { m.bits = 32; }); }, 'unsupported-bits'],
    ['palette colour', s => { s.slices.forEach(m => { m.photometricInterpretation = 'PALETTE COLOR'; }); }, 'unsupported-photometric'],
    ['mixed storage', s => { s.slices[4].signed = s.slices[4].signed ? 0 : 1; }, 'mixed-storage'],
  ]) it(name, async () => {
    const s = await makeSeries(); mutate(s);
    expect(() => checkExportable(s)).toThrowError(expect.objectContaining({ code }));
    const sink = spy(); await expect(exportCrop({ series: s, box: box(), sink })).rejects.toMatchObject({ code }); expect(sink.calls).toEqual([]);
  });
  it('the UI checks before the folder picker', () => {
    const ui = readFileSync(new URL('../../docs/crop-ui.js', import.meta.url), 'utf8');
    expect(ui.indexOf('checkExportable(series)')).toBeGreaterThan(0); expect(ui.indexOf('checkExportable(series)')).toBeLessThan(ui.indexOf('showDirectoryPicker({'));
  });
});

describe('(5) the fill value is described truthfully', () => {
  it('-1024 HU not representable (unsigned, intercept 0): falls back to the series minimum and says so', async () => {
    const f = fillStoredValue({ slope: 1, intercept: 0, range: [0, 4095] }, 'CT', 12);
    expect(f.stored).toBe(12); expect(f.hu).toBe(12); expect(f.rule).toMatch(/series minimum.*not representable/); expect(f.rule).not.toMatch(/^air/);
    const s = await makeSeries({ signed: 0, intercept: 0, bitsStored: 12, pixelAt: () => 100 }), sink = memorySink();
    const r = await exportCrop({ series: s, box: box({ center: { i: 1.5, j: 8.5, k: 5.5 } }), sink, volumeMinHu: 7 });
    expect(r.fill).toMatchObject({ stored: 7, hu: 7 }); const d0 = parseOut(sortedFiles(sink)[0][1]);
    expect(strOf(d0, '00082111')).toMatch(/stored value 7 \(series minimum, 7 HU; -1024 HU is not representable\)/); expect(strOf(d0, '00082111')).not.toMatch(/air, -1024/);
    expect(pix(d0, 0)[0]).toBe(7);
  });
  it('rounding of air is reported: hu is what the stored value means', () => {
    const f = fillStoredValue({ slope: 5, intercept: -1000, range: [-32768, 32767] }, 'CT', NaN);
    expect(f.stored).toBe(-5); expect(f.hu).toBe(-1025); expect(f.rule).toMatch(/nearest representable to -1024 HU: -1025 HU/);
  });
  it('exact air stays "air, -1024 HU"', () => { expect(fillStoredValue({ slope: 1, intercept: -1000, range: [-32768, 32767] }, 'CT', NaN)).toMatchObject({ stored: -24, hu: -1024, rule: 'air, -1024 HU' }); });
});

describe('(6) rotation needs uniform slice spacing', () => {
  it('a missing slice blocks rotation, axis aligned still uses the real positions', async () => {
    const s = await makeSeries({ posAt: k => [10, 20, 5 + (k < 6 ? k : k + 1) * 0.5] });
    expect(s.spacingCheck.missing).toBeGreaterThan(0);
    await expect(exportCrop({ series: s, box: rot(), sink: memorySink() })).rejects.toMatchObject({ code: 'spacing' });
    const sink = memorySink(); await exportCrop({ series: s, box: box({ center: { i: 7.5, j: 8.5, k: 6.5 } }), sink }); // slices 3..10 straddle the gap
    const z = sortedFiles(sink).map(([, b]) => Number(strOf(parseOut(b), '00200032').split('\\')[2]));
    expect(z[2]).toBeCloseTo(5 + 5 * 0.5, 9); expect(z[3]).toBeCloseTo(5 + 7 * 0.5, 9); expect(z[4] - z[3]).toBeCloseTo(0.5, 9); // source k = 5 -> 6 is a gap of two steps: the real position of every slice is kept
  });
  it('non-uniform spacing blocks rotation', async () => {
    const s = await makeSeries({ posAt: k => [10, 20, 5 + k * 0.5 + (k % 2) * 0.1] });
    expect(s.spacingCheck.nonUniform).toBe(true); await expect(exportCrop({ series: s, box: rot(), sink: memorySink() })).rejects.toMatchObject({ code: 'spacing' });
  });
});

describe('(7) attributes, descriptions and sinks', () => {
  it('ImageType: DERIVED\\SECONDARY\\AXIAL for CT, value 3 of the source is kept', async () => {
    const a = await makeSeries(), sa = memorySink(); await exportCrop({ series: a, box: box(), sink: sa });
    expect(strOf(parseOut(sortedFiles(sa)[0][1]), '00080008')).toBe('DERIVED\\SECONDARY\\AXIAL');
    const b = await makeSeries({ extra: [['00080008', 'CS', 'ORIGINAL\\PRIMARY\\LOCALIZER']] }), sb = memorySink(); await exportCrop({ series: b, box: box(), sink: sb });
    expect(strOf(parseOut(sortedFiles(sb)[0][1]), '00080008')).toBe('DERIVED\\SECONDARY\\LOCALIZER');
  });
  it('MR: the MR type 1 / 2 attributes are copied; without them the output is a Secondary Capture image', async () => {
    const mr = await makeSeries({ modality: 'MR', extra: [['00180020', 'CS', 'GR'], ['00180021', 'CS', 'SP'], ['00180023', 'CS', '3D'], ['00180080', 'DS', '500'], ['00180081', 'DS', '12.5'], ['00180091', 'IS', '8'], ['00180087', 'DS', '3'], ['00180022', 'CS', 'FAST_GRADIENT']] });
    const a = memorySink(); await exportCrop({ series: mr, box: box(), sink: a }); const d = parseOut(sortedFiles(a)[0][1]);
    expect(strOf(d, '00080016')).toBe('1.2.840.10008.5.1.4.1.1.4'); expect(strOf(d, '00180020')).toBe('GR'); expect(strOf(d, '00180021')).toBe('SP'); expect(strOf(d, '00180023')).toBe('3D');
    expect(strOf(d, '00180080')).toBe('500'); expect(strOf(d, '00180081')).toBe('12.5'); expect(strOf(d, '00180091')).toBe('8'); expect(strOf(d, '00180087')).toBe('3'); expect(strOf(d, '00080008')).toBe('DERIVED\\SECONDARY');
    const bare = await makeSeries({ modality: 'MR' }), b = memorySink(); await exportCrop({ series: bare, box: box(), sink: b }); const e = parseOut(sortedFiles(b)[0][1]);
    expect(strOf(e, '00080016')).toBe('1.2.840.10008.5.1.4.1.1.7'); expect(strOf(e, '00080064')).toBe('WSD');
  });
  it('template attributes, storage info and spacing all come from the same source slice (slice 0)', async () => {
    const s = await makeSeries({ perSlice: k => [['00180015', 'CS', k === 0 ? 'HEAD' : 'CHEST']] }), sink = memorySink(); await exportCrop({ series: s, box: box(), sink });
    expect(strOf(parseOut(sortedFiles(sink)[0][1]), '00180015')).toBe('HEAD');
  });
  it('a non-ASCII source description is not mangled into ????: the generated text is ASCII, SpecificCharacterSet and the patient name bytes stay', async () => {
    const s = await makeSeries({ desc: '胸部CT', extra: [['00080005', 'CS', 'ISO_IR 192'], ['00100010', 'PN', '山田^太郎']] });
    s.slices.forEach(m => { m.description = '胸部CT'; });
    const sink = memorySink(); await exportCrop({ series: s, box: box(), sink }); const d = parseOut(sortedFiles(sink)[0][1]);
    expect(strOf(d, '0008103E')).toBe('crop 8 (not resampled)'); expect(strOf(d, '00082111')).not.toMatch(/\?/); expect(strOf(d, '00080005')).toBe('ISO_IR 192');
    const e = d.elements.x00100010; expect(new TextDecoder().decode(d.byteArray.slice(e.dataOffset, e.dataOffset + e.length)).trim()).toBe('山田^太郎');
  });
  it('the UI imports the rotated block limit instead of hardcoding it, and the limit follows the machine', () => {
    const ui = readFileSync(new URL('../../docs/crop-ui.js', import.meta.url), 'utf8');
    expect(ui).not.toMatch(/1\.5\s*\*\s*1024/); expect(ui).toMatch(/rotatedBlockLimitFor/);
    expect(rotatedBlockLimitFor()).toBe(ROTATED_BLOCK_LIMIT_BYTES); expect(rotatedBlockLimitFor({ deviceMemoryGB: 2 })).toBe(0.5 * 2 ** 30); expect(rotatedBlockLimitFor({ residentBytes: 1 * 2 ** 30 })).toBe(0.5 * 2 ** 30);
    expect(rotatedBlockLimitFor({ residentBytes: 100 * 2 ** 30 })).toBe(256 * 2 ** 20);
  });
  it('an error inside the zip callback reaches the awaiting caller', async () => {
    class FakePass { constructor(name) { this.name = name; } }
    const failing = when => class { constructor(cb) { this.cb = cb; } add(f) { f.push = () => { if (when === 'add') this.cb(new Error('zip boom'), null, false); }; } end() { if (when === 'end') this.cb(new Error('zip boom'), null, true); } terminate() {} };
    await expect(zipSink(() => {}, { ZipCtor: failing('add'), PassThrough: FakePass }).add('a', new Uint8Array(1))).rejects.toThrow('zip boom');
    const sink = zipSink(() => {}, { ZipCtor: failing('end'), PassThrough: FakePass }); await sink.add('a', new Uint8Array(1)); await expect(sink.finish()).rejects.toThrow('zip boom');
    await expect(exportCrop({ series: await makeSeries(), box: box({ n: 4 }), sink: zipSink(() => {}, { ZipCtor: failing('add'), PassThrough: FakePass }) })).rejects.toThrow('zip boom');
  });
  // a minimal FileSystemDirectoryHandle
  const fakeDir = (opts = {}) => {
    const dirs = new Map(), mk = () => { const files = new Map(); return { files, getFileHandle: async (n, o) => { if (!files.has(n) && !o?.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); files.set(n, files.get(n) || new Uint8Array(0)); return { createWritable: async () => ({ write: async b => { if (opts.failAt != null && files.size >= opts.failAt) throw new Error('disk full'); files.set(n, b); }, close: async () => {}, abort: async () => {} }) }; }, removeEntry: async n => { if (opts.noRemove) throw new Error('denied'); if (!files.delete(n)) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); } }; };
    return { dirs, getDirectoryHandle: async (n, o) => { if (!dirs.has(n)) { if (!o?.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); dirs.set(n, mk()); } return dirs.get(n); }, removeEntry: async n => { if (opts.noRemove) throw new Error('denied'); const d = dirs.get(n); if (!d) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); if (d.files.size) throw new Error('not empty'); dirs.delete(n); } };
  };
  it('on cancel / error the partly written folder is removed', async () => {
    const parent = fakeDir(), s = await makeSeries(); let n = 0;
    const p = exportCrop({ series: s, box: box(), sink: await directorySink(parent, 'out'), isCancelled: () => ++n > 4 });
    await expect(p).rejects.toMatchObject({ code: 'cancelled', cleanup: { removed: true } }); expect(parent.dirs.size).toBe(0);
    const parent2 = fakeDir({ failAt: 3 }); await expect(exportCrop({ series: s, box: box(), sink: await directorySink(parent2, 'out') })).rejects.toThrow('disk full'); expect(parent2.dirs.size).toBe(0);
  });
  it('when the files cannot be removed the caller is told the folder is incomplete', async () => {
    const parent = fakeDir({ failAt: 3 }), s = await makeSeries(), sink = await directorySink(parent, 'out');
    parent.dirs.get('out').removeEntry = async () => { throw new Error('denied'); }; // the files cannot be deleted
    await expect(exportCrop({ series: s, box: box(), sink })).rejects.toMatchObject({ cleanup: { removed: false, folder: 'out' } });
  });
  it('LossyImageCompression is 01 when the source transfer syntax is lossy, not for lossless', async () => {
    const s = await makeSeries({ extra: [['00282110', 'CS', '00']] }), native = m => readNativeStoredSlice({ ...m, ts: '1.2.840.10008.1.2.1' });
    for (const [ts, expected] of [['1.2.840.10008.1.2.4.50', '01'], ['1.2.840.10008.1.2.4.51', '01'], ['1.2.840.10008.1.2.4.81', '01'], ['1.2.840.10008.1.2.4.91', '01'], ['1.2.840.10008.1.2.4.70', '00'], ['1.2.840.10008.1.2.4.90', '00']]) {
      s.slices.forEach(m => { m.ts = ts; }); const sink = memorySink(); await exportCrop({ series: s, box: box({ n: 4 }), sink, decodeCompressed: async m => native(m) });
      const d = parseOut(sortedFiles(sink)[0][1]); expect(strOf(d, '00282110')).toBe(expected); expect(strOf(d, '00020010')).toBe('1.2.840.10008.1.2.1');
      if (expected === '01') expect(strOf(d, '00082111')).toMatch(/lossy/);
    }
  });
});

describe('review fixes', () => {
  it('PixelSpacing is copied verbatim from slice 0 (16-char DS values are not re-formatted)', async () => {
    const sp = '1.23456789012345', s = await makeSeries({ spacing: [sp, sp], thickness: 0.5, dz: 0.5 }), sink = memorySink();
    await exportCrop({ series: s, box: box(), sink });
    const src = dicomParser.parseDicom(new Uint8Array(await s.slices[0].file.arrayBuffer())), el = src.elements.x00280030, want = src.byteArray.slice(el.dataOffset, el.dataOffset + el.length);
    for (const [, bytes] of sortedFiles(sink)) {
      const d = parseOut(bytes), o = d.elements.x00280030, got = d.byteArray.slice(o.dataOffset, o.dataOffset + o.length);
      expect(Array.from(got)).toEqual(Array.from(want));
      expect(d.string('x00280030')).toBe(`${sp}\\${sp}`);
    }
  });
  it('a decoder asked for stored values (opts.stored) returning Float32 is not inverse-rescaled', async () => {
    const s = await makeSeries({ signed: 0, slope: 1, intercept: -1024 });
    s.slices.forEach(m => { m.ts = '1.2.840.10008.1.2.4.70'; });
    const seen = [], dec = async (m, opts) => { seen.push(opts); return Float32Array.from(await readNativeStoredSlice({ ...m, ts: '1.2.840.10008.1.2.1' })); };
    const r = makeStoredReader(s, { decodeCompressed: dec }), got = await r.read(3), want = await readNativeStoredSlice({ ...s.slices[3], ts: '1.2.840.10008.1.2.1' });
    expect(seen[0]).toEqual({ stored: true }); expect(got).toBeInstanceOf(Uint16Array); expect(Array.from(got)).toEqual(Array.from(want)); // no +1024 shift
    const bad = makeStoredReader(s, { decodeCompressed: async m => Float32Array.from(await readNativeStoredSlice({ ...m, ts: '1.2.840.10008.1.2.1' }), v => v + 0.5) });
    await expect(bad.read(0)).rejects.toMatchObject({ code: 'not-exact' });
  });
});
