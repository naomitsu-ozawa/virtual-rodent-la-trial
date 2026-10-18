import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { I18N } from '../../docs/i18n.js';
import { lineSamples, bilinear, trilinear, neededSlices, sampleLine, profileStats, nearestSample } from '../../docs/line-profile.js';

// a 4x3x3 test volume whose HU is 10*i + 100*j + 1000*k (linear: trilinear interpolation must reproduce it exactly)
const dims = { columns: 4, rows: 3, slices: 3 };
const slices = [0, 1, 2].map(k => Float32Array.from({ length: 12 }, (_, n) => 10 * (n % 4) + 100 * Math.floor(n / 4) + 1000 * k));
const f = (x, y, z) => 10 * x + 100 * y + 1000 * z;

describe('lineSamples', () => {
  it('spaces samples at most the smallest voxel spacing apart and ends exactly on b', () => {
    const s = lineSamples({ i: 0, j: 0, k: 0 }, { i: 3, j: 0, k: 0 }, [0.5, 1, 2]);
    expect(s.length).toBeCloseTo(1.5); expect(s.n).toBe(4); expect(s.step).toBeCloseTo(0.5);
    expect(s.dist[3]).toBeCloseTo(1.5); expect(s.x[3]).toBe(3); expect(s.x[0]).toBe(0);
  });
  it('uses the real distance (anisotropic spacing) and a bad spacing counts as 1', () => {
    const s = lineSamples({ i: 0, j: 0, k: 0 }, { i: 0, j: 0, k: 2 }, [1, 1, 3]);
    expect(s.length).toBeCloseTo(6); expect(s.n).toBe(7);
    expect(lineSamples({ i: 0, j: 0, k: 0 }, { i: 0, j: 4, k: 0 }, null).length).toBe(4);
  });
  it('a zero-length line is one sample and the sample count is capped', () => {
    expect(lineSamples({ i: 1, j: 1, k: 1 }, { i: 1, j: 1, k: 1 }, [1, 1, 1]).n).toBe(1);
    expect(lineSamples({ i: 0, j: 0, k: 0 }, { i: 5000, j: 0, k: 0 }, [1, 1, 1], 100).n).toBe(100);
  });
  it('a non-integer ratio still ends on b with a step below the minimum spacing', () => {
    const s = lineSamples({ i: 0, j: 0, k: 0 }, { i: 1, j: 1, k: 0 }, [1, 1, 1]);
    expect(s.n).toBe(3); expect(s.step).toBeLessThanOrEqual(1); expect(s.x[2]).toBe(1); expect(s.y[2]).toBe(1);
  });
});

describe('interpolation', () => {
  it('bilinear reproduces voxel centres and midpoints, and clamps outside', () => {
    const sl = slices[0];
    expect(bilinear(sl, 4, 3, 2, 1)).toBe(f(2, 1, 0));
    expect(bilinear(sl, 4, 3, 1.5, 0.5)).toBeCloseTo(f(1.5, 0.5, 0));
    expect(bilinear(sl, 4, 3, -5, 99)).toBe(f(0, 2, 0));
  });
  it('trilinear blends the two slices', () => {
    expect(trilinear(slices[0], slices[1], 4, 3, 1.25, 0.5, 0.25)).toBeCloseTo(f(1.25, 0.5, 0.25));
    expect(trilinear(slices[2], null, 4, 3, 1, 1, 0)).toBe(f(1, 1, 2));
  });
});

describe('sampleLine', () => {
  it('samples an oblique line exactly (linear field) and reads the slices in ascending order', async () => {
    const s = lineSamples({ i: 0, j: 0, k: 0 }, { i: 3, j: 2, k: 2 }, [1, 1, 1]);
    const asked = [];
    const out = await sampleLine(s, dims, async z => { asked.push(z); return slices[z]; });
    for (let q = 0; q < s.n; q++) expect(out[q]).toBeCloseTo(f(s.x[q], s.y[q], s.z[q]), 3);
    expect(asked).toEqual([...asked].sort((a, b) => a - b)); // ascending, so a source slice is decoded once
    expect(neededSlices(s, 3)).toEqual([0, 1, 2]);
  });
  it('an in-plane line needs one slice only', async () => {
    const s = lineSamples({ i: 0, j: 1, k: 2 }, { i: 3, j: 1, k: 2 }, [1, 1, 1]);
    const asked = new Set();
    const out = await sampleLine(s, dims, z => { asked.add(z); return slices[z]; });
    expect([...asked]).toEqual([2]); expect(Array.from(out)).toEqual([2100, 2110, 2120, 2130]);
  });
  it('reports progress, can be cancelled, and fails on an unreadable slice', async () => {
    const s = lineSamples({ i: 0, j: 0, k: 0 }, { i: 3, j: 0, k: 0 }, [1, 1, 1]);
    let seen = 0; await sampleLine(s, dims, z => slices[z], { onProgress: (d, t) => { seen = d / t; } });
    expect(seen).toBe(1);
    expect(await sampleLine(s, dims, z => slices[z], { cancelled: () => true })).toBeNull();
    await expect(sampleLine(s, dims, () => null)).rejects.toThrow();
  });
});

describe('profileStats / nearestSample', () => {
  it('mean, SD, min, max exact; percentiles from the 1-HU bins', () => {
    const st = profileStats([10, 20, 30, 40, 50]);
    expect(st.count).toBe(5); expect(st.mean).toBe(30); expect(st.sd).toBeCloseTo(Math.sqrt(200)); expect(st.min).toBe(10); expect(st.max).toBe(50);
    expect(st.percentiles[50]).toBe(30); expect(st.percentiles[5]).toBe(10); expect(st.percentiles[95]).toBe(50);
  });
  it('empty / NaN values give nulls', () => {
    const st = profileStats([NaN]); expect(st.count).toBe(0); expect(st.mean).toBe(null);
  });
  it('finds the nearest sample by distance', () => {
    const d = Float64Array.from([0, 1, 2, 3]);
    expect(nearestSample(d, -4)).toBe(0); expect(nearestSample(d, 1.4)).toBe(1); expect(nearestSample(d, 1.6)).toBe(2); expect(nearestSample(d, 99)).toBe(3);
    expect(nearestSample(new Float64Array(0), 1)).toBe(-1);
  });
});

describe('line profile wiring (static)', () => {
  const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('every i18n key the panel uses exists in Japanese and English', () => {
    const used = new Set([...read('line-profile-ui.js').matchAll(/tr\('([A-Za-z]+)'\)/g)].map(m => m[1]));
    expect(used.size).toBeGreaterThan(8);
    for (const l of ['ja', 'en']) for (const k of used) expect(I18N[l][k], l + ':' + k).toBeTruthy();
  });
  it('is installed from app.js, hooked before the crosshair, with pointer-events re-enabled for its canvases', () => {
    expect(read('app.js')).toMatch(/installLineProfile\(\);/);
    expect(read('app.js')).toMatch(/lineProfilePointerDown\(p,e\)\|\|crosshairPointerDown\(p,e\)/);
    expect(read('ui-shell.js')).toContain('id="line-profile-toggle"'); expect(read('ui-shell.js')).toContain('id="line-profile-result"');
    expect(read('style.css')).toMatch(/\.lp-canvas\{[^}]*pointer-events:auto/);
    expect(read('line-profile-ui.js')).toContain('e.stopPropagation()');
  });
});
