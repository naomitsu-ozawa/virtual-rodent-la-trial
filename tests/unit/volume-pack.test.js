import { describe, it, expect } from 'vitest';
import { packCtSlice } from '../../docs/medical-volume.js';

// The volume shaders decode each texel as (lo + hi*256 - signedBias)*slope + intercept
// (see volumeShader / brickShader in medical-volume.js). packCtSlice must be the
// exact inverse so filtered slices display with the series calibration unchanged.
const decode = (bytes, { slope, intercept, signed }) =>
  Array.from({ length: bytes.length / 2 }, (_, i) => (bytes[2 * i] + bytes[2 * i + 1] * 256 - (signed ? 32768 : 0)) * slope + intercept);

describe('packCtSlice', () => {
  it('round-trips signed CT data (slope 1, intercept -1024)', () => {
    const cal = { slope: 1, intercept: -1024, signed: 1 };
    const ct = new Float32Array([-1024, -1000, 0, 40, 400, 3071]);
    expect(decode(packCtSlice(ct, cal), cal)).toEqual(Array.from(ct));
  });

  it('round-trips unsigned data with a non-unit slope, rounding to stored precision', () => {
    const cal = { slope: 0.5, intercept: -1000, signed: 0 };
    const ct = new Float32Array([-1000, -999.6, 0, 12.3]);
    const back = decode(packCtSlice(ct, cal), cal);
    back.forEach((v, i) => expect(Math.abs(v - ct[i])).toBeLessThanOrEqual(cal.slope / 2 + 1e-6));
  });

  it('matches the raw-DICOM encoding for unfiltered values (signed: stored + 32768)', () => {
    const cal = { slope: 1, intercept: -1024, signed: 1 };
    const stored = [-2000, -1, 0, 1, 2047];
    const out = packCtSlice(new Float32Array(stored.map(v => v * cal.slope + cal.intercept)), cal);
    stored.forEach((v, i) => expect(out[2 * i] | (out[2 * i + 1] << 8)).toBe((v + 32768) & 0xffff));
  });

  it('clamps values outside the 16-bit stored range', () => {
    const cal = { slope: 1, intercept: 0, signed: 0 };
    const out = packCtSlice(new Float32Array([-5, 70000]), cal);
    expect([out[0] | (out[1] << 8), out[2] | (out[3] << 8)]).toEqual([0, 65535]);
  });
});
