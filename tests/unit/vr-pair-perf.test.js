import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { eyeMetrics, capFromPpv, capFromBudget, nextCap, addVolumeEye, foveaRect, outsideFovea, foveaWorth, N_MAX, CAP_MIN } from '../../docs/vr-render-scale.js';
import { createContentBox, contentBox, BRICK } from '../../docs/vr-content-box.js';
import { createSkipState, skipGrid } from '../../docs/vr-skip-occupancy.js';

// the partner of a sample pair at max zoom. (1) its covered pixels count in the ray budget, (2) its rays that cross only air are discarded (content box), (3) its creep skip.
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const model = (s, x, y, z) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1];
const persp = (l, r, b, t, n = 0.05, f = 100) => {
  const L = -l * n, R = r * n, B = -b * n, T = t * n;
  return [2 * n / (R - L), 0, 0, 0, 0, 2 * n / (T - B), 0, 0, (R + L) / (R - L), (T + B) / (T - B), -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0];
};
const P = persp(1, 1, 1, 1), HALF = [1, 1, 1], DIMS = [256, 256, 256], VW = 1800, VH = 1800;

// what the frame loop of vr-view.js computes (the same calls, in the same order): the primary alone, or with the partner added through addVolumeEye
function frame(meshes, nMax = N_MAX) {
  const rs = { cover: 0, outside: 0 }; let raw = CAP_MIN, cov = 0, outF = 0; const fov = new Array(5), acc = { cover: 0, outside: 0, need: 0 };
  const eyes = [[{}, {}], [{}, {}]];
  for (let i = 0; i < 2; i++) {
    const e = eyeMetrics(meshes[0], HALF, DIMS, I(), P, VW, VH, eyes[0][i]);
    cov += e.cover; if (e.cover > 0) raw = Math.max(raw, capFromPpv(e.ppvCenter, e.ppvFar));
    foveaRect(e.cx, e.cy, VW, VH, fov); outF += outsideFovea(e, fov);
    if (meshes[1]) { const e2 = eyeMetrics(meshes[1], HALF, DIMS, I(), P, VW, VH, eyes[1][i]); acc.cover = cov; acc.outside = outF; acc.need = raw; addVolumeEye(acc, e2, fov); cov = acc.cover; outF = acc.outside; raw = acc.need; }
  }
  rs.cover = cov; rs.outside = outF; raw = Math.min(raw, capFromBudget(cov, nMax)); rs.cap = nextCap(0, raw);
  return rs;
}

describe('pair ray budget: the two volumes together stay within one volume\'s budget', () => {
  const near = 0.2; // max zoom at the face: both boxes cover (almost) the whole eye viewport
  it('the primary alone: unchanged by the partner code (cover = its own, cap from its own)', () => {
    const rs = frame([model(0.1, 0, 0, -near)]);
    const e = eyeMetrics(model(0.1, 0, 0, -near), HALF, DIMS, I(), P, VW, VH, {});
    expect(rs.cover).toBeCloseTo(2 * e.cover, 6);
    expect(rs.cap).toBe(nextCap(0, Math.min(capFromPpv(e.ppvCenter, e.ppvFar), capFromBudget(2 * e.cover))));
  });
  it('two volumes in view: the covered pixels add up and rays (cover x cap^2) fit the single volume budget', () => {
    const one = frame([model(0.3, 0, 0, -0.5)]), two = frame([model(0.3, 0, 0, -0.5), model(0.3, 0.1, 0, -0.5)]);
    expect(two.cover).toBeGreaterThan(one.cover * 1.9);
    const raysOne = one.cover * one.cap ** 2, raysTwo = two.cover * two.cap ** 2;
    // the cap is quantised UP (1/32): at most one step above the exact value
    const slack = (c, cover) => cover * ((c + 1 / 32) ** 2 - c ** 2);
    expect(raysTwo).toBeLessThanOrEqual(N_MAX + slack(Math.sqrt(N_MAX / two.cover), two.cover));
    expect(two.cap).toBeLessThan(one.cap); // the old code drew the pair at the single volume's scale: twice the rays
    expect(raysOne).toBeLessThanOrEqual(N_MAX + slack(Math.sqrt(N_MAX / one.cover), one.cover));
  });
  it('a partner out of view adds nothing (no cover, no need): the cap is the primary\'s', () => {
    const solo = frame([model(0.3, 0, 0, -0.5)]), withFar = frame([model(0.3, 0, 0, -0.5), model(0.3, 0, 0, +5)]); // behind the eye
    expect(withFar.cover).toBe(solo.cover); expect(withFar.cap).toBe(solo.cap);
  });
  it('addVolumeEye: cover and outside-fovea sum, need = the larger detail need of the two', () => {
    const acc = { cover: 10, outside: 4, need: 0.3 }, rF = foveaRect(900, 900, VW, VH, new Array(5));
    const e = eyeMetrics(model(0.3, 0, 0, -0.5), HALF, DIMS, I(), P, VW, VH, {});
    addVolumeEye(acc, e, rF);
    expect(acc.cover).toBeCloseTo(10 + e.cover, 6); expect(acc.outside).toBeCloseTo(4 + outsideFovea(e, rF), 6);
    expect(acc.need).toBeCloseTo(Math.max(0.3, capFromPpv(e.ppvCenter, e.ppvFar)), 9);
    const none = addVolumeEye({ cover: 1, outside: 0, need: 0.4 }, { cover: 0, ppvCenter: Infinity, ppvFar: Infinity, x0: 0, y0: 0, x1: 0, y1: 0 }, rF);
    expect(none).toMatchObject({ cover: 1, outside: 0, need: 0.4 });
  });
  it('the fovea decision sees the partner\'s pixels too', () => {
    const solo = frame([model(0.3, 0, 0, -0.5)]), two = frame([model(0.3, 0, 0, -0.5), model(0.3, 0.1, 0, -0.5)]);
    expect(foveaWorth(two.outside, two.cover, 0.5)).toBe(foveaWorth(solo.outside, solo.cover, 0.5)); // same layout: same verdict, from the summed numbers
    expect(two.outside).toBeGreaterThan(solo.outside);
  });
});

// a small volume: a block of tissue (HU 300) inside air (HU -1000)
const D = [64, 64, 64];
function bricksOf(hu, [w, h, d]) {
  const bx = Math.ceil(w / BRICK), by = Math.ceil(h / BRICK), bz = Math.ceil(d / BRICK), mm = new Float32Array(bx * by * bz * 4);
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let z = Math.max(0, k * BRICK - 1); z < Math.min(d, (k + 1) * BRICK + 1); z++) for (let y = Math.max(0, j * BRICK - 1); y < Math.min(h, (j + 1) * BRICK + 1); y++) for (let x = Math.max(0, i * BRICK - 1); x < Math.min(w, (i + 1) * BRICK + 1); x++) { const v = hu[(z * h + y) * w + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const o = ((k * by + j) * bx + i) * 4; mm[o] = lo; mm[o + 1] = hi;
  }
  return { bricks: mm, brickDims: [bx, by, bz], dims: [w, h, d] };
}
const hu = new Float32Array(64 ** 3).fill(-1000);
for (let z = 20; z < 36; z++) for (let y = 24; y < 40; y++) for (let x = 8; x < 30; x++) hu[(z * 64 + y) * 64 + x] = 300;
const grid = bricksOf(hu, D), HE = [0.5, 0.5, 0.5];
const segA = on => [{ x: 100, y: 1000, z: 1, w: on ? 1 : 0 }, { x: 0, y: 0, z: 1, w: 0 }, { x: 0, y: 0, z: 1, w: 0 }, { x: 0, y: 0, z: 1, w: 0 }];

describe('createContentBox (the partner\'s content box): the primary\'s steps on the partner\'s own grid', () => {
  const run = (cb, o) => { let r; for (let i = 0; i < 200; i++) { r = cb.step({ grid, halfExt: HE, ...o }); if (cb.scan.done) break; } return r; };
  it('the box of the shown tissue = contentBox() (the synchronous reference), smaller than the data box', () => {
    const cb = createContentBox(), r = run(cb, { segA: segA(true) });
    expect(r.on).toBe(true); expect(r.changed).toBe(true);
    const ref = contentBox({ halfExt: HE, grid, segs: [{ min: 100, max: 1000, on: true }, { on: false }, { on: false }, { on: false }] });
    for (let a = 0; a < 3; a++) { expect(r.c[a]).toBeCloseTo(ref.c[a], 9); expect(r.h[a]).toBeCloseTo(ref.h[a], 9); expect(r.h[a]).toBeLessThanOrEqual(HE[a] + 1e-12); }
    expect(r.h[0] < HE[0] || r.h[1] < HE[1] || r.h[2] < HE[2]).toBe(true);
    // the next frame, nothing changed: not written again
    expect(cb.step({ grid, halfExt: HE, segA: segA(true) }).changed).toBe(false);
  });
  it('no segment shown: nothing can be drawn = no content box (boxH 0: the full box, as the primary)', () => {
    const cb = createContentBox(), r = run(cb, { segA: segA(false) });
    expect(r.on).toBe(false); expect(r.h).toEqual([0, 0, 0]);
  });
  it('the switch (off) and a missing grid give no box; the box comes back when the switch is released', () => {
    const cb = createContentBox(); run(cb, { segA: segA(true) });
    expect(cb.step({ grid, halfExt: HE, segA: segA(true), off: true })).toMatchObject({ changed: true, on: false });
    expect(run(cb, { segA: segA(true) }).on).toBe(true);
    expect(createContentBox().step({ grid: null, halfExt: HE, segA: segA(true) })).toMatchObject({ changed: true, on: false });
  });
  it('a new segment that the old box does not cover: the full box until the scan is done, never a box that hides it', () => {
    const cb = createContentBox(); run(cb, { segA: segA(true) });
    const wide = segA(true); wide[0].x = -2000; // now the air counts too
    const r1 = cb.step({ grid, halfExt: HE, segA: wide });
    if (!cb.scan.done) expect(r1).toMatchObject({ changed: true, on: false });
    const r = run(cb, { segA: wide }); expect(r.on === false || r.h.every((h, a) => h >= HE[a] - 1e-9)).toBe(true);
  });
  it('sections with a slice: the slice bricks above sliceAir join the box', () => {
    const cb = createContentBox(), seg = run(cb, { segA: segA(true) }), sl = run(cb, { segA: segA(true), slices: true, air: -500 });
    for (let a = 0; a < 3; a++) expect(sl.h[a] + Math.abs(sl.c[a])).toBeGreaterThanOrEqual(seg.h[a] + Math.abs(seg.c[a]) - 1e-9);
  });
});

// pairBoxSkip: the real source (cut out of vr-view.js) against mocks of what it reads
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const start = src.indexOf('  const pairBoxSkip=pt=>{'), end = src.indexOf('\n  };\n', start) + 5;
const fnSrc = src.slice(start, end).replace('const pairBoxSkip=', '').trim().replace(/;$/, '');
const V3 = () => ({ v: [0, 0, 0], set(x, y, z) { this.v = [x, y, z]; } });
function rig(over = {}) {
  const n = 12 ** 3, dims = [12, 12, 12], data = new Uint8Array(n * 4); for (let i = 0; i < n; i++) data[i * 4 + 3] = 1;
  const t = { combo: { image: { data } }, dims, cls4: null, rb: null, comboMask: 0b0001, skip: null };
  const u2 = { segA: { value: segA(true) }, editMaskOnly: { value: 0 }, planeCount: { value: 0 }, sliceOpacity: { value: 0 }, sliceAir: { value: -500 }, boxC: { value: V3() }, boxH: { value: V3() }, clsTex: { value: t.combo }, useSkip: { value: 7 }, skipTex: { value: null } };
  const dummy = { dummy: true }, made = [], settings = { boxDiag: 0, skipDiag: 1 };
  const pt = { u: u2, t, grid, halfExt: HE, cb: createContentBox(), cls: { chan: [0, 1, 2, -1] }, four: false };
  const env = { settings, createSkipState, skipGrid, makeSkipTexture: (bits, g) => { const x = { bits, g }; made.push(x); return x; }, skipDummy: () => dummy, ...over };
  const names = Object.keys(env), f = new Function(...names, 'return (' + fnSrc + ')')(...names.map(k => env[k]));
  return { pt, u2, t, dummy, made, settings, tick: () => f(pt) };
}
describe('vr-view.js pairBoxSkip (the real source, mocked inputs)', () => {
  it('the source was found', () => { expect(start).toBeGreaterThan(0); expect(fnSrc.startsWith('pt=>{') || fnSrc.startsWith('(pt)=>{') || fnSrc.includes('=>{')).toBe(true); });
  it('the partner\'s boxC / boxH are written (a box smaller than the data box) and useSkip comes on once its bits are built', () => {
    const { u2, made, dummy, tick } = rig();
    let first = null; for (let i = 0; i < 400; i++) { tick(); if (u2.useSkip.value === 1) { first = i; break; } if (i === 0) expect(u2.skipTex.value).toBe(dummy); }
    expect(first).not.toBeNull(); expect(made).toHaveLength(1); expect(u2.skipTex.value).toBe(made[0]);
    expect(u2.boxH.value.v.some(h => h > 0)).toBe(true);
    expect(u2.boxH.value.v.every((h, a) => h <= HE[a] + 1e-12)).toBe(true);
  });
  it('the 詳細 switches turn them off at once; a rebuild (rb.busy) and another texture give useSkip 0', () => {
    const { u2, t, settings, tick } = rig();
    for (let i = 0; i < 400; i++) tick();
    expect(u2.useSkip.value).toBe(1);
    settings.boxDiag = 1; tick(); expect(u2.boxH.value.v).toEqual([0, 0, 0]); settings.boxDiag = 0; for (let i = 0; i < 400; i++) tick(); expect(u2.boxH.value.v.some(h => h > 0)).toBe(true);
    settings.skipDiag = 0; tick(); expect(u2.useSkip.value).toBe(0); settings.skipDiag = 1; for (let i = 0; i < 400; i++) tick(); expect(u2.useSkip.value).toBe(1);
    t.rb = { busy: true }; tick(); expect(u2.useSkip.value).toBe(0); t.rb = null; for (let i = 0; i < 400; i++) tick(); expect(u2.useSkip.value).toBe(1);
    const other = u2.clsTex.value; u2.clsTex.value = { image: {} }; tick(); expect(u2.useSkip.value).toBe(0); u2.clsTex.value = other;
  });
  it('wired: the frame loop adds the partner to the budget and pairFrame calls pairBoxSkip; the partner has its own state', () => {
    expect(src).toContain('addVolumeEye(rsAcc,e2,rsFov[i])');
    expect(src).toMatch(/pairBoxSkip\(pt\);[^\n]*\n  \};\n  pairRender=/);
    expect(src).toContain('cb:createContentBox()');
    expect(src).toContain('pt.t.skip?.dispose()');
  });
});
