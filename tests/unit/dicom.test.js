import { describe, it, expect } from 'vitest';
import {
  parseDicomHeader, parsedSliceMeta, groupSeries, canDecodeToInt16,
  sourceRangeFromMetadata, expandParsedFrames, isNativeDicomTransferSyntax,
} from '../../docs/dicom.js';
import { makeCtSlice, asFile } from '../helpers/synthetic-dicom.js';

async function metaOf(opts, name) {
  const f = asFile(makeCtSlice(opts), name);
  return parsedSliceMeta(f, await parseDicomHeader(f));
}

describe('parseDicomHeader + parsedSliceMeta', () => {
  it('reads geometry, calibration and pixel data location', async () => {
    const m = await metaOf({ rows: 3, columns: 5, pixelSpacing: [0.2, 0.1], position: [1, 2, 3.5], slope: 2, intercept: -1000, instance: 7 });
    expect(m).toMatchObject({
      seriesUid: '1.2.3.4', studyUid: '1.2.3', modality: 'CT', description: 'Test CT',
      rows: 3, columns: 5, bits: 16, bitsStored: 12, signed: 1,
      pixelSpacing: [0.2, 0.1], pos: [1, 2, 3.5], slope: 2, intercept: -1000, instance: 7,
      windowCenter: 40, windowWidth: 400, ts: '1.2.840.10008.1.2.1',
    });
    expect(m.pixelLength).toBe(3 * 5 * 2);
    expect(m.pixelOffset).toBeGreaterThan(132);
  });

  it('returns null for files without a Series Instance UID', async () => {
    const f = asFile(makeCtSlice({ seriesUid: '' }));
    expect(parsedSliceMeta(f, await parseDicomHeader(f))).toBeNull();
  });

  it('defaults RescaleSlope/Intercept to 1/0 when absent', () => {
    const ds = { string: () => undefined, uint16: () => undefined, elements: {} };
    ds.string = tag => (tag === 'x0020000e' ? '9.9' : undefined);
    const m = parsedSliceMeta({}, ds);
    expect(m.slope).toBe(1);
    expect(m.intercept).toBe(0);
  });
});

describe('groupSeries', () => {
  it('groups slices by study+series and sorts each series by z position', async () => {
    const a = await Promise.all([2, 0, 1].map(z => metaOf({ position: [0, 0, z * 0.5], instance: z + 1 })));
    const b = await Promise.all([0, 1].map(z => metaOf({ seriesUid: '5.6.7', position: [0, 0, z] })));
    const series = groupSeries([...a, ...b]);
    expect(series).toHaveLength(2);
    expect(series[0].slices.map(s => s.pos[2])).toEqual([0, 0.5, 1]); // largest series first
    expect(series[0].spacingZ).toBeCloseTo(0.5);
    expect(series[1].slices).toHaveLength(2);
  });

  it('derives spacing, window and memory estimate', async () => {
    const s = groupSeries(await Promise.all([0, 1].map(z => metaOf({ rows: 4, columns: 8, pixelSpacing: [0.3, 0.1], position: [0, 0, z * 0.25] }))))[0];
    expect(s.spacingX).toBeCloseTo(0.1); // column spacing
    expect(s.spacingY).toBeCloseTo(0.3); // row spacing
    expect(s.spacingZ).toBeCloseTo(0.25);
    expect(s.windowCenter).toBe(40);
    expect(s.compact).toBe(true);
    expect(s.decodedBytes).toBe(4 * 8 * 2 * 2);
    expect(s.sourceBacked).toBe(false);
  });

  it('falls back to thickness when positions are missing', () => {
    const base = { studyUid: 's', seriesUid: 'x', rows: 1, columns: 1, bits: 16, bitsStored: 16, signed: 1, slope: 1, intercept: 0, thickness: 0.7, pos: null };
    const s = groupSeries([{ ...base, instance: 2 }, { ...base, instance: 1 }])[0];
    expect(s.slices.map(x => x.instance)).toEqual([1, 2]);
    expect(s.spacingZ).toBeCloseTo(0.7);
  });

  // Known limitation: sorting uses ImagePositionPatient z only, ignoring
  // ImageOrientationPatient, so sagittal/coronal acquisitions sort wrongly.
  it.todo('sorts non-axial acquisitions along the slice normal (IOP cross product)');
});

describe('value range and Int16 packing', () => {
  const meta = o => ({ bits: 16, bitsStored: 12, signed: 1, slope: 1, intercept: -1024, ...o });

  it('canDecodeToInt16 accepts integer calibration within Int16', () => {
    expect(canDecodeToInt16([meta()])).toBe(true);
  });
  it('canDecodeToInt16 rejects fractional slope and overflow', () => {
    expect(canDecodeToInt16([meta({ slope: 0.5 })])).toBe(false);
    expect(canDecodeToInt16([meta({ bitsStored: 16, signed: 0, intercept: 0 })])).toBe(false); // 0..65535
    expect(canDecodeToInt16([meta({ bits: 32 })])).toBe(false);
  });
  it('sourceRangeFromMetadata applies calibration to the stored-bit range', () => {
    expect(sourceRangeFromMetadata([meta()])).toEqual({ min: -2048 - 1024, max: 2047 - 1024 });
  });
  it('sourceRangeFromMetadata reinterprets signed Smallest/Largest values', () => {
    expect(sourceRangeFromMetadata([meta({ smallest: 65535, largest: 100, intercept: 0 })])).toEqual({ min: -1, max: 100 });
  });
});

describe('transfer syntaxes and multi-frame', () => {
  it('recognises native (uncompressed) transfer syntaxes', () => {
    expect(isNativeDicomTransferSyntax('1.2.840.10008.1.2.1')).toBe(true);
    expect(isNativeDicomTransferSyntax('1.2.840.10008.1.2.4.50')).toBe(false);
  });
  it('expands compressed multi-frame objects into per-frame slices', () => {
    const frames = expandParsedFrames({ numberOfFrames: 3, ts: '1.2.840.10008.1.2.4.50', pos: [0, 0, 10], thickness: 2, instance: 5 });
    expect(frames.map(f => f.frameIndex)).toEqual([0, 1, 2]);
    expect(frames.map(f => f.pos[2])).toEqual([10, 12, 14]);
  });
  it('leaves native multi-frame objects as a single entry', () => {
    expect(expandParsedFrames({ numberOfFrames: 3, ts: '1.2.840.10008.1.2.1' })).toHaveLength(1);
  });
});
