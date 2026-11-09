import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// smallSeriesGpuVolume (data-load.js): a small series takes the source-backed GPU-volume path on EVERY runtime (PC, Mac, iPad, iPhone, Quest).
// The module imports the browser stack, so the function is cut out of the source and run against fakes.
const src = readFileSync('docs/data-load.js', 'utf8');
const start = src.indexOf('function smallSeriesGpuVolume(s){');
const body = src.slice(start, src.indexOf('\n}\n', start) + 3);
const make = ({ support, medicalVolume = { support } } = {}) => {
  const calls = [];
  const fn = new Function('sceneState', 'openSourceBackedVolume', 'gpuVolumePlanOptions', body + 'return smallSeriesGpuVolume;')(
    { medicalVolume }, s => ({ sourceBacked: true, series: s }), () => ({ maxTextureBytes: 123 }));
  return { fn, calls };
};

describe('smallSeriesGpuVolume', () => {
  it('the function was found', () => { expect(start).toBeGreaterThan(0); expect(body).toContain('support('); });
  it('does not look at the device (no tablet / iPhone / Mac / Quest exclusion)', () => {
    expect(body).not.toMatch(/isTabletRuntime|isIPhoneRuntime|isIPadRuntime|navigator|userAgent|platform/);
  });
  it('a series that is already source-backed is left to the large-series path', () => {
    const { fn } = make({ support: () => { throw new Error('not asked'); } });
    expect(fn({ sourceBacked: true })).toBe(false);
  });
  it('a small series gets the GPU volume when the WebGPU volume supports it (the device is never asked)', () => {
    const seen = [];
    const { fn } = make({ support: (v, o) => { seen.push([v.sourceBacked, o.maxTextureBytes]); return { ok: true }; } });
    expect(fn({ sourceBacked: false, slices: [] })).toBe(true);
    expect(seen).toEqual([[true, 123]]);
  });
  it('without a supporting WebGPU volume the series keeps the in-memory decode', () => {
    expect(make({ support: () => ({ ok: false, reason: 'WebGPU device unavailable' }) }).fn({ sourceBacked: false })).toBe(false);
    expect(make({ medicalVolume: null }).fn({ sourceBacked: false })).toBe(false);
  });
});
