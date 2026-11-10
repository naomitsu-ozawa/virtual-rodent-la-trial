import { describe, it, expect } from 'vitest';
import { MedicalVolumeRenderer, rawPixelBytes, packedRgSlice, widen8To16 } from '../../docs/medical-volume.js';
import { makeCtSlice, asFile } from '../helpers/synthetic-dicom.js';

// 8-bit uncompressed DICOM is widened to 16-bit words (unsigned: zero-extend, signed: sign-extend) before the packed rg8 texture,
// so the shaders and the VR preparation see the same bytes layout as for 16-bit data.
const LE = '1.2.840.10008.1.2.1', BE = '1.2.840.10008.1.2.2';
const words = (u8, little = true) => { const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); return Array.from({ length: u8.byteLength / 2 }, (_, i) => dv.getUint16(i * 2, little)); };
const meta = (over, pixels, withOffset = false) => {
  const bytes = makeCtSlice({ rows: 2, columns: 4, bitsAllocated: 8, bitsStored: 8, signed: 0, pixels });
  const m = { file: asFile(bytes), rows: 2, columns: 4, bits: 8, bitsStored: 8, samples: 1, ts: LE, signed: false, slope: 1, intercept: 0, ...over };
  if (withOffset) m.pixelOffset = bytes.length - pixels.length;
  return m;
};
const decode = (packed, signed, slope, intercept) => words(packed).map(w => (w - (signed ? 32768 : 0)) * slope + intercept); // what the shader does: stored = word - bias, HU = stored * slope + intercept

describe('8-bit widening (rawPixelBytes)', () => {
  const px = new Uint8Array([0, 1, 127, 128, 129, 200, 254, 255]);
  it('unsigned zero-extends (parsed Pixel Data and pixelOffset reads agree)', async () => {
    for (const withOffset of [false, true]) {
      const raw = await rawPixelBytes(meta({}, px, withOffset));
      expect(raw.byteLength).toBe(16);
      expect(words(raw)).toEqual([0, 1, 127, 128, 129, 200, 254, 255]);
    }
  });
  it('signed sign-extends (two\'s complement 8-bit -> int16)', async () => {
    for (const withOffset of [false, true]) {
      const raw = await rawPixelBytes(meta({ signed: true }, px, withOffset));
      expect(new Int16Array(raw.buffer, raw.byteOffset, 8)).toEqual(new Int16Array([0, 1, 127, -128, -127, -56, -2, -1]));
    }
  });
  it('big endian transfer syntax gets big endian words', () => {
    expect(Array.from(widen8To16(new Uint8Array([1, 255]), 2, true, false))).toEqual([0, 1, 255, 255]);
    expect(Array.from(widen8To16(new Uint8Array([1, 255]), 2, true, true))).toEqual([1, 0, 255, 255]);
    expect(Array.from(widen8To16(new Uint8Array([1, 255]), 2, false, false))).toEqual([0, 1, 0, 255]);
  });
  it('16-bit data is returned unchanged', async () => {
    const p16 = new Int16Array([5, -5, 300, -300, 0, 1, 2, 3]);
    const bytes = makeCtSlice({ rows: 2, columns: 4, bitsAllocated: 16, bitsStored: 16, signed: 1, pixels: p16 });
    const raw = await rawPixelBytes({ file: asFile(bytes), rows: 2, columns: 4, bits: 16, samples: 1, ts: LE });
    expect(Array.from(new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + 16)))).toEqual(Array.from(p16));
  });
  it('colour and compressed data keep their errors', async () => {
    await expect(rawPixelBytes({ ...meta({}, px), samples: 3 })).rejects.toThrow(/single-channel/);
    await expect(rawPixelBytes({ ...meta({}, px), ts: '1.2.840.10008.1.2.4.50' })).rejects.toThrow(/uncompressed/);
    await expect(rawPixelBytes({ ...meta({}, px), bits: 12 })).rejects.toThrow(/single-channel/);
  });
});

describe('8-bit packed slice (packedRgSlice): values, slope / intercept', () => {
  const px = new Uint8Array([0, 1, 100, 127, 128, 200, 254, 255]);
  it('unsigned: the shader value is the stored byte, HU = stored * slope + intercept', async () => {
    const m = meta({ slope: 2, intercept: -100 }, px, true), packed = await packedRgSlice(m);
    expect(packed.byteLength).toBe(16);
    expect(words(packed)).toEqual(Array.from(px));
    expect(decode(packed, false, 2, -100)).toEqual(Array.from(px, v => v * 2 - 100));
  });
  it('signed: biased by 32768 like 16-bit signed, HU = (word - bias) * slope + intercept', async () => {
    const m = meta({ signed: true, slope: 0.5, intercept: 10 }, px, true), packed = await packedRgSlice(m);
    const stored = Array.from(px, v => (v > 127 ? v - 256 : v));
    expect(decode(packed, true, 0.5, 10)).toEqual(stored.map(v => v * 0.5 + 10));
    expect(words(packed)[4]).toBe(32768 - 128);
  });
  it('is the same packed bytes as a 16-bit series with the same stored values', async () => {
    for (const signed of [false, true]) {
      const stored = signed ? [-128, -1, 0, 1, 127, -50, 60, 99] : [0, 1, 127, 128, 255, 10, 20, 250];
      const p8 = new Uint8Array(stored.map(v => v & 255)), p16 = signed ? new Int16Array(stored) : new Uint16Array(stored);
      const a = await packedRgSlice(meta({ signed }, p8, true));
      const b16 = makeCtSlice({ rows: 2, columns: 4, bitsAllocated: 16, bitsStored: 16, signed: signed ? 1 : 0, pixels: p16 });
      const b = await packedRgSlice({ file: asFile(b16), rows: 2, columns: 4, bits: 16, bitsStored: 16, samples: 1, ts: LE, signed, pixelOffset: b16.length - 16 });
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });
  it('signed with bitsStored below 8: sign from bit bitsStored-1', async () => {
    const s = meta({ bitsStored: 7, highBit: 6, signed: true }, new Uint8Array([0, 5, 63, 64, 127, 0, 0, 0]), true);
    expect(decode(await packedRgSlice(s), true, 1, 0).slice(0, 5)).toEqual([0, 5, 63, -64, -1]);
  });
  it('big endian 8-bit unsigned / signed packs the same values', async () => {
    const m = meta({ ts: BE, signed: true }, px, true), packed = await packedRgSlice(m);
    expect(decode(packed, true, 1, 0)).toEqual(Array.from(px, v => (v > 127 ? v - 256 : v)));
  });
});

describe('MedicalVolumeRenderer.support: 8-bit', () => {
  const series = (bits, over = {}) => ({ rows: 16, columns: 16, slices: Array.from({ length: 4 }, () => ({ rows: 16, columns: 16, bits, samples: 1, ts: LE, slope: 1, intercept: 0, signed: false, ...over })), spacingX: 1, spacingY: 1, spacingZ: 1 });
  const renderer = () => { const r = Object.create(MedicalVolumeRenderer.prototype); r.device = { limits: { maxTextureDimension3D: 2048 } }; r.context = {}; return r; };
  it('accepts 8-bit and 16-bit uncompressed single channel; refuses colour / compressed / other depths', () => {
    const r = renderer();
    expect(r.support({ sourceBacked: true, series: series(8) }).ok).toBe(true);
    expect(r.support({ sourceBacked: true, series: series(16) }).ok).toBe(true);
    expect(r.support({ sourceBacked: true, series: series(8, { signed: true }) }).ok).toBe(true);
    expect(r.support({ sourceBacked: true, series: series(8, { samples: 3 }) })).toMatchObject({ ok: false });
    expect(r.support({ sourceBacked: true, series: series(8, { ts: '1.2.840.10008.1.2.4.50' }) })).toMatchObject({ ok: false });
    expect(r.support({ sourceBacked: true, series: series(32) })).toMatchObject({ ok: false });
  });
  it('still refuses a per-slice calibration difference for 8-bit', () => {
    const s = series(8); s.slices[2].slope = 2;
    expect(renderer().support({ sourceBacked: true, series: s })).toMatchObject({ ok: false, reason: 'Per-slice calibration differs' });
  });
});
