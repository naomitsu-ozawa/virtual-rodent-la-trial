// The coarse distance grid and the pre-pass that reads it (docs/vr-wgpu-coarse-proxy.js, group 2: A1' and A1): the grid is a lower bound of the fine distance field, tA / tB are safe for every ray of the tile, the variants are registered, the report lines, and the host
// (driven with a mock device: CI has no GPU; tools/vr-coarse-proxy-check.mjs runs the same shaders on a software WebGPU adapter). The display programs are not touched (their hashes are in vr-breakdown.test.js).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeWgsl, uniformLayout, PROXY, PROXY_FIELDS, proxyPixelDir } from '../../docs/vr-wgsl-core.js';
import * as C from '../../docs/vr-wgpu-coarse-proxy.js';
import { makeScene, rng, fetchTexel, insideAt } from '../helpers/coarse-proxy-scene.js';
import { BD_VARIANTS, BD_SPECS, COARSE_NAMES, createVolBreakdown, createPerfLog, perfReport } from '../../docs/vr-perf-log.js';

const host = readFileSync(new URL('../../docs/vr-wgpu.js', import.meta.url), 'utf8');
const SCENES = [
  { name: '37x29x45 / 2 slots, border blobs', dims: [37, 29, 45], halfExt: [1, 0.8, 1.4], slots: 2, seed: 11, border: true },
  { name: '40x32x24 / 3 slots', dims: [40, 32, 24], halfExt: [1, 0.9, 0.7], slots: 3, seed: 12, border: false },
  { name: '33x31x35 / 4 slots (cls4)', dims: [33, 31, 35], halfExt: [1, 1, 1.1], slots: 4, seed: 13, border: true },
  { name: '41x37x27 / 4 slots, slot 1 hidden', dims: [41, 37, 27], halfExt: [1.2, 1, 0.8], slots: 4, seed: 14, border: true, mask: 0b1101 },
];
const scenes = SCENES.map(s => ({ ...s, g: makeScene(rng(s.seed), { dims: s.dims, halfExt: s.halfExt, slots: s.slots, nBlobs: 5, border: s.border, mask: s.mask }) }));

describe('the coarse grid is a lower bound of the fine distance field', () => {
  it('sizes: 256^3 -> 64^3 cells, packed four cells along x into one rgba8uint texel = 256 KB; odd sizes round up', () => {
    expect(C.coarseDims([256, 256, 256])).toEqual([64, 64, 64]); expect(C.packedDims([256, 256, 256])).toEqual([16, 64, 64]); expect(16 * 64 * 64 * 4).toBe(262144);
    expect(C.coarseDims([37, 29, 45])).toEqual([10, 8, 12]); expect(C.packedDims([37, 29, 45])).toEqual([3, 8, 12]);
    expect(C.COARSE.cell).toBe(4);
  });
  it('every cell of every scene (anisotropic, sizes that are no multiple of 4): the value is the minimum of V over every texel a fetch of any point of the cell reads, and no fetch of a point of the cell (cell corners and boundaries included) is below it', () => {
    let cells = 0, points = 0, zero = 0, big = 0;
    for (const { name, g } of scenes) {
      const bytes = C.coarseGridCpu(g), cd = C.coarseDims(g.dims), V = C.texelValues(g), N = g.dims;
      expect(bytes.length, name).toBe(cd[0] * cd[1] * cd[2]);
      const at = (x, y, z) => V[(Math.min(Math.max(z, 0), N[2] - 1) * N[1] + Math.min(Math.max(y, 0), N[1] - 1)) * N[0] + Math.min(Math.max(x, 0), N[0] - 1)];
      for (let cz = 0; cz < cd[2]; cz++) for (let cy = 0; cy < cd[1]; cy++) for (let cx = 0; cx < cd[0]; cx++) {
        const c = [cx, cy, cz], value = bytes[(cz * cd[1] + cy) * cd[0] + cx]; cells++; if (value === 0) zero++; if (value >= 8) big++;
        // the positions along each axis inside the cell [4c, 4c + 4) of the texel coordinate (the clamp of the shader keeps v < N): both ends, the interior, and the last representable value
        const posOf = k => [4 * c[k], 4 * c[k] + 1, 4 * c[k] + 2.5, 4 * c[k] + 4 - 1e-4].map(v => Math.min(v, N[k] - 1e-4)).filter(v => v >= 4 * c[k] && v < N[k]);
        const px = posOf(0), py = posOf(1), pz = posOf(2);
        let brute = 255;
        for (const vz of pz) for (const vy of py) for (const vx of px) {
          const p = [vx - 0.5, vy - 0.5, vz - 0.5], f = p.map(Math.floor); points++;
          let m = 255; for (let d = 0; d < 8; d++) m = Math.min(m, at(f[0] + (d & 1), f[1] + ((d >> 1) & 1), f[2] + ((d >> 2) & 1)));
          brute = Math.min(brute, m);
          if (points % 3 === 0) { // the interpolated distance byte of this point (a third of the points: the fetch is the slow part)
            const { q } = fetchTexel(g, [vx / N[0], vy / N[1], vz / N[2]]);
            expect(q[3] * 255 + 1e-6, name + ' ' + c + ' at ' + [vx, vy, vz]).toBeGreaterThanOrEqual(value);
          }
        }
        expect(value, name + ' cell ' + c).toBe(brute); // the dilated block is exactly the union of the footprints of the points above
      }
    }
    expect(cells).toBeGreaterThan(2500); expect(points).toBeGreaterThan(100000); expect(zero, `zero ${zero} big ${big} cells ${cells}`).toBeGreaterThan(200); expect(big, `zero ${zero} big ${big} cells ${cells}`).toBeGreaterThan(100); // the grid is neither all zero nor all far
  }, 60000);
  it('a texel where a shown slot may be inside is 0, a hidden slot is ignored, and with nothing shown every cell is the alpha of 255 (no segment: nothing to be near)', () => {
    const { g } = scenes[3]; // slot 1 hidden
    const own = C.texelValues(g), hiddenOnly = C.texelValues({ ...g, segOn: [0, 1, 0, 0] }), none = C.coarseGridCpu({ ...g, segOn: [0, 0, 0, 0], data: g.data.map((v, i) => (i % 4 === 3 ? 255 : v)) });
    let a = 0, b = 0; for (let i = 0; i < own.length; i++) { if (g.data[i * 4 + 1] >= 127 && own[i] === g.data[i * 4 + 3]) a++; if (g.data[i * 4 + 1] >= 127 && hiddenOnly[i] === 0) b++; }
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(0); // slot 1's inside texels keep their distance byte when slot 1 is hidden, and are 0 when only slot 1 is shown
    expect(Array.from(new Set(none))).toEqual([255]);
    // the class threshold is 0.5 - classMargin on the byte / 255 (127 counts, 126 does not)
    const one = { data: new Uint8Array([127, 0, 0, 9, 126, 0, 0, 9]), dims: [2, 1, 1], chan: [0, -1, -1, -1], segOn: [1, 0, 0, 0] }, v = C.texelValues(one); expect([v[0], v[1]]).toEqual([0, 9]);
    const c4 = { data: new Uint8Array([0, 0, 0, 9, 0, 0, 0, 9]), cls4: new Uint8Array([200, 3]), dims: [2, 1, 1], chan: [-1, -1, -1, 3], segOn: [0, 0, 0, 1] }, v4 = C.texelValues(c4); expect([v4[0], v4[1]]).toEqual([0, 9]); // slot 3 reads cls4, not the alpha
  });
});

// ---- the cone: tA and tB certified for every ray of the tile ----
// ground truth: the march's own samples t0 + k * stp of a ray through a pixel centre and its own inside test (a trilinear class value >= 0.5 of a shown slot). The march from K = max(0, floor((tA - t0) / stp) - 1) to tB is the march of the display when
// no inside sample lies before K + 1 (the display's rule: k* >= K + 1, or K = 0) and none past tB (the loop ends at t > tB); a ray with an inside sample whose tile is certified empty (tA past the end of the ray) is a failure as well.
const CAMS = [
  { o: [0.2, 0.1, 3.4], tgt: [0, 0, 0] }, { o: [2.6, 1.2, 2.2], tgt: [0.1, 0, 0.2] }, { o: [0.1, 0.05, 0.3], tgt: [0.8, 0.2, -1] }, { o: [-2.5, -1.4, -2.0], tgt: [0, 0, 0] }, { o: [0.05, 2.9, 0.1], tgt: [0, 0, 0] },
];
const lookAt = (eye, tgt, fpx, W, H) => {
  let fw = tgt.map((v, k) => v - eye[k]); const lf = Math.hypot(...fw); fw = fw.map(v => v / lf);
  const up0 = Math.abs(fw[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let rt = cr(fw, up0); const lr = Math.hypot(...rt); rt = rt.map(v => v / lr); const up = cr(rt, fw);
  return (px, py) => { const u = (px + 0.5 - W / 2) / fpx, v = -(py + 0.5 - H / 2) / fpx, d = [0, 1, 2].map(k => fw[k] + u * rt[k] + v * up[k]), l = Math.hypot(...d); return d.map(x => x / l); };
};
// the reach of the fine pre-pass (proxyTB: the display's reads of the combined texture, a filtered fetch at the nearest box point): none where a shown slot may be inside, else (alpha - ddMargin - slack) x voxelMin
const fineReach = (g, opt = {}) => xc => {
  const { q, c4 } = fetchTexel(g, C.texCoordOf(xc, g.halfExt).map(v => Math.min(Math.max(v, 0), 0.999999)));
  for (let s = 0; s < 4; s++) { const c = g.chan[s]; if (c < 0 || !g.segOn[s]) continue; if ((c === 3 && g.cls4 ? c4 : q[c]) >= 0.5 - PROXY.classMargin) return -Infinity; }
  return (q[3] * 255 - (opt.ddMargin ?? PROXY.ddMargin) - PROXY.slack) * g.voxelMin;
};
function runCone({ g, bytes, tile, cam, fine = false, W = 48, H = 36, fpx = 40, opt = {}, reachOpt = {}, tBShift = 0, tAShift = 0, stepVox = 1.5, seed = 1 }) {
  const eye = cam.o.map((v, k) => v * g.halfExt[k]), tgt = cam.tgt.map((v, k) => v * g.halfExt[k]), dirOf = lookAt(eye, tgt, fpx, W, H), R = rng(seed);
  const reach = fine ? fineReach(g, reachOpt) : C.coarseReachCpu(bytes, g.dims, g.halfExt, g.voxelMin, reachOpt), stp = stepVox * g.voxelMin;
  const st = { tiles: 0, empty: 0, rays: 0, hit: 0, viol: 0, started: 0, cutTail: 0, first: '' };
  for (let ty = 0; ty * tile < H; ty++) for (let tx = 0; tx * tile < W; tx++) {
    const r = C.coneCpu({ halfExt: g.halfExt, voxelMin: g.voxelMin, o: eye, W, H, dirOf, reach }, tile, tx, ty, opt); st.tiles++;
    const tA = r.tA + tAShift * stp, tB = r.tB - tBShift * stp; if (r.tA === Infinity) st.empty++;
    const px0 = tx * tile, py0 = ty * tile, px1 = Math.min(W, px0 + tile) - 1, py1 = Math.min(H, py0 + tile) - 1, pts = [[px0, py0], [px1, py0], [px0, py1], [px1, py1]];
    for (let i = 0; i < 3; i++) pts.push([px0 + Math.floor(R() * (px1 - px0 + 1)), py0 + Math.floor(R() * (py1 - py0 + 1))]);
    for (const [px, py] of pts) {
      const d = dirOf(px, py); let lo = -1e30, hi = 1e30;
      for (let k = 0; k < 3; k++) { const dk = Math.abs(d[k]) < 1e-20 ? 1e-20 : d[k], iv = 1 / dk, a = (-g.halfExt[k] - eye[k]) * iv, b = (g.halfExt[k] - eye[k]) * iv; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
      if (lo > hi) continue; st.rays++;
      const t0 = Math.max(lo, 0); let kFirst = -1, kLast = -1;
      for (let k = 0; t0 + k * stp <= hi; k++) { const t = t0 + k * stp; if (insideAt(g, C.texCoordOf([0, 1, 2].map(c => eye[c] + d[c] * t), g.halfExt))) { if (kFirst < 0) kFirst = k; kLast = k; } }
      if (kFirst < 0) continue; st.hit++;
      const K = tA > hi ? Infinity : Math.max(0, Math.floor((tA - t0) / stp) - 1);
      if (K > 0 && K > kFirst - 1 || tA > hi || t0 + kLast * stp > tB) { st.viol++; st.first ||= `tile ${tx},${ty} tA ${tA} tB ${tB} kFirst ${kFirst} K ${K} tLast ${t0 + kLast * stp}`; }
      else { if (K > 0) st.started++; if (tB < hi) st.cutTail++; }
    }
  }
  return st;
}
// ---- the march of one ray (the WGSL loop of vr-wgsl-core.js, events off, hitSimple off, refine 1, creep skip off: the display's), to compare the march from the start tA to the end tB with the march from k = 0 to the end of the ray ----
// o = { stp, kStart, cap } (cap = tB: the loop ends at t > min(endT, cap))
const SEG_OFF = 1.0e9;
function marchRay(g, ray, o) {
  const { stp } = o, N = g.dims, he = g.halfExt;
  let lo = -1e30, hi = 1e30;
  for (let k = 0; k < 3; k++) { const dk = Math.abs(ray.d[k]) < 1e-20 ? 1e-20 : ray.d[k], iv = 1 / dk, a = (-he[k] - ray.o[k]) * iv, b = (he[k] - ray.o[k]) * iv; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
  if (lo > hi) return { discard: true };
  const t0 = Math.max(lo, 0), endT = Math.min(hi, o.cap ?? Infinity), faceEnd = (lo > 0 && t0 <= lo + 1e-4) ? lo + stp : -1, faceT = faceEnd >= 0 ? t0 : -1;
  const tcO = C.texCoordOf(ray.o, he), tcD = [ray.d[0] / (2 * he[0]), -ray.d[1] / (2 * he[1]), ray.d[2] / (2 * he[2])], pos = t => tcO.map((v, k) => v + tcD[k] * t);
  const jkA = Math.max(1 / Math.max(0.5 * Math.hypot(...ray.d.map((v, k) => v * N[k] / he[k])), 1e-6), g.voxelMin);
  const fOf = tc => { const { q, c4 } = fetchTexel(g, tc); return { q, f: [0, 1, 2, 3].map(s => { const c = g.chan[s]; return c < 0 || !g.segOn[s] ? -SEG_OFF : (c === 3 && g.cls4 ? c4 : q[c]) - 0.5; }) }; };
  let k = o.kStart || 0, t = t0 + k * stp, previousT = t, lastIndex = -1, prevValid = false, prevF = 0, hit = null, iters = 0;
  const T = kk => t0 + kk * stp;
  for (let iter = 0; iter < 4096; iter++) {
    if (t > endT) break; iters++;
    const { q, f } = fOf(pos(t)); let dd = q[3] * 255;
    if (dd >= 2.7 && t <= faceT) { if (Math.max(...f) >= 0) dd = 0; }
    if (dd >= 2.7) { const m = Math.max(1, Math.floor((dd - 1.8) * jkA / stp)), nextJ = T(k + m); previousT = nextJ - stp * 0.05; prevValid = false; k += m; t = nextJ; continue; }
    let idx = -1, curF = -1; for (let s = 0; s < 4; s++) if (f[s] >= 0) { idx = s; curF = f[s]; break; }
    if (idx !== lastIndex) {
      if (idx >= 0) { hit = { idx, lo: previousT, hi: t, f0: prevF, f1: curF, nb: prevValid ? 6 : 2, iso: prevValid && prevF < 0, k }; lastIndex = idx; break; }
      lastIndex = idx;
    }
    prevValid = true; prevF = idx >= 0 ? curF : Math.max(...f); previousT = t; k++; t = T(k);
  }
  let fin = null;
  if (hit) { // the surface search after the loop
    let l = hit.lo, h = hit.hi, f0 = hit.f0, f1 = hit.f1; const idx = hit.idx;
    const insideAt2 = tc => { const { q, c4 } = fetchTexel(g, tc), val = s => { const c = g.chan[s]; return c === 3 && g.cls4 ? c4 : q[c]; }; if (!(val(idx) >= 0.5)) return false; for (let s = 0; s < idx; s++) if (g.chan[s] >= 0 && g.segOn[s] && val(s) >= 0.5) return false; return true; };
    if (hit.iso) {
      for (let r = 0; r < 3; r++) {
        let mid = (l + h) * 0.5; if (r < 2 && Math.abs(f1 - f0) > 1e-6) mid = Math.min(Math.max(l + (h - l) * (-f0 / (f1 - f0)), l + (h - l) * 0.02), h - (h - l) * 0.02);
        const { q, c4 } = fetchTexel(g, pos(mid)), c = g.chan[idx], fmv = (c === 3 && g.cls4 ? c4 : q[c]) - 0.5; let inside = fmv >= 0; if (!insideAt2(pos(mid))) inside = false;
        if (inside) { h = mid; f1 = fmv; } else { l = mid; f0 = fmv; }
      }
    } else for (let r = 0; r < 6; r++) { if (r >= hit.nb) break; const mid = (l + h) * 0.5; if (insideAt2(pos(mid))) h = mid; else l = mid; }
    fin = { idx, hi: h, onFace: h <= faceEnd };
  }
  return { discard: false, t0, endT: hi, hit, fin, iters };
}
const sameMarch = (a, b) => {
  if (a.discard !== b.discard) return false; if (a.discard) return true;
  if (!a.hit !== !b.hit) return false; if (!a.hit) return true;
  const h = a.hit, i = b.hit; return h.idx === i.idx && h.lo === i.lo && h.hi === i.hi && h.f0 === i.f0 && h.f1 === i.f1 && h.nb === i.nb && h.iso === i.iso && a.fin.hi === b.fin.hi && a.fin.onFace === b.fin.onFace && a.fin.idx === b.fin.idx;
};
// every ray of every tile of every camera: the march from the start (tA) to the end (tB) of its tile gives the hit of the march from k = 0 to the end of the ray (bracket, flags, searched point, face), or no hit
function runMarch({ tile, fine = false, grids = scenes, cams = CAMS, W = 48, H = 36, fpx = 40, stepVox = 1.5, reachOpt = {}, tAShift = 0, tBShift = 0, seed = 3 }) {
  const st = { rays: 0, hits: 0, mism: 0, later: 0, cut: 0, emptyRays: 0, fewer: 0, first: '' };
  grids.forEach(({ g }, si) => {
    const bytes = C.coarseGridCpu(g), reach = fine ? fineReach(g, reachOpt) : C.coarseReachCpu(bytes, g.dims, g.halfExt, g.voxelMin, reachOpt), stp = stepVox * g.voxelMin, R = rng(seed + si);
    cams.forEach(cam => {
      const eye = cam.o.map((v, k) => v * g.halfExt[k]), dirOf = lookAt(eye, cam.tgt.map((v, k) => v * g.halfExt[k]), fpx, W, H);
      for (let ty = 0; ty * tile < H; ty++) for (let tx = 0; tx * tile < W; tx++) {
        const r = C.coneCpu({ halfExt: g.halfExt, voxelMin: g.voxelMin, o: eye, W, H, dirOf, reach }, tile, tx, ty), tA = r.tA + tAShift * stp, tB = r.tB - tBShift * stp;
        const px0 = tx * tile, py0 = ty * tile, px1 = Math.min(W, px0 + tile) - 1, py1 = Math.min(H, py0 + tile) - 1, pts = [[px0, py0], [px1, py0], [px0, py1], [px1, py1], [px0 + Math.floor(R() * (px1 - px0 + 1)), py0 + Math.floor(R() * (py1 - py0 + 1))]];
        for (const [px, py] of pts) {
          const ray = { o: eye, d: dirOf(px, py) }, A = marchRay(g, ray, { stp, kStart: 0 }); if (A.discard) continue; st.rays++;
          let B;
          if (tA > A.endT) { B = { discard: false, hit: null, fin: null, iters: 0 }; st.emptyRays++; }
          else { const K = Math.max(0, Math.floor((tA - A.t0) / stp) - 1); if (K > 0) st.later++; if (tB < A.endT) st.cut++; B = marchRay(g, ray, { stp, kStart: K, cap: tB }); }
          if (A.hit) st.hits++; if (B.iters < A.iters) st.fewer++;
          if (!sameMarch(A, B)) { st.mism++; st.first ||= `scene ${si} tile ${tx},${ty} px ${px},${py} A ${JSON.stringify(A.hit)} B ${JSON.stringify(B.hit)} tA ${tA} tB ${tB}`; }
        }
      }
    });
  });
  return st;
}
describe('the march from tA to tB gives the same ray result as the march from k = 0 to the end of the ray', () => {
  for (const tile of [8, 4]) {
    it(`tile ${tile}: every ray of every tile (hit bracket, search flags, searched point, face; or no hit) over the scenes and cameras; the walk is shorter on many rays`, () => {
      const r = runMarch({ tile });
      expect(r.mism, r.first).toBe(0); expect(r.hits, JSON.stringify(r)).toBeGreaterThan(300); expect(r.later, JSON.stringify(r)).toBeGreaterThan(20); expect(r.fewer, JSON.stringify(r)).toBeGreaterThan(tile === 4 ? r.rays * 0.1 : 20);
    }, 120000);
  }
  it('proxyTB (the display\'s fine reads, 8 x 8 tiles, with tB): the same result on every ray', () => {
    const r = runMarch({ tile: 8, fine: true });
    expect(r.mism, r.first).toBe(0); expect(r.hits, JSON.stringify(r)).toBeGreaterThan(300); expect(r.later, JSON.stringify(r)).toBeGreaterThan(20); expect(r.cut, JSON.stringify(r)).toBeGreaterThan(5);
  }, 120000);
  it('negative controls: a start 6 grid points too late and an end 6 grid points too early change the result on some ray (the comparison is not blind)', () => {
    expect(runMarch({ tile: 4, tAShift: 6 }).mism).toBeGreaterThan(0);
    expect(runMarch({ tile: 4, tBShift: 6 }).mism).toBeGreaterThan(0);
    expect(runMarch({ tile: 8, fine: true, tBShift: 6 }).mism).toBeGreaterThan(0);
  }, 120000);
});
describe('tA and tB are safe (the march from tA to tB sees every sample inside a shown segment, and the first inside sample is never before the start)', () => {
  const total = a => a.reduce((s, x) => ({ tiles: s.tiles + x.tiles, empty: s.empty + x.empty, rays: s.rays + x.rays, hit: s.hit + x.hit, viol: s.viol + x.viol, started: s.started + x.started, cutTail: s.cutTail + x.cutTail, first: s.first || x.first }), { tiles: 0, empty: 0, rays: 0, hit: 0, viol: 0, started: 0, cutTail: 0, first: '' });
  const all = (tile, extra = {}) => { const out = []; scenes.forEach(({ g }, si) => { const bytes = extra.bytes ? extra.bytes(g) : extra.run?.fine ? null : C.coarseGridCpu(g); CAMS.forEach((cam, ci) => out.push(runCone({ g, bytes, tile, cam, seed: 100 * si + ci, ...extra.run }))); }); return total(out); };
  for (const tile of [8, 4]) {
    it(`tile ${tile}: no violation over ${scenes.length} scenes x ${CAMS.length} cameras (eyes outside, inside and close to the box); the walk starts later and ends earlier than the ray's own for many rays`, () => {
      const r = all(tile);
      expect(r.viol, r.first).toBe(0);
      expect(r.hit, JSON.stringify(r)).toBeGreaterThan(300); expect(r.started, JSON.stringify(r)).toBeGreaterThan(10); if (tile === 4) expect(r.cutTail, JSON.stringify(r)).toBeGreaterThan(10); expect(r.empty).toBeGreaterThan(r.tiles * 0.05); // the controls below are not blind: there are start moves, end cuts and empty tiles to break
    });
  }
  it('proxyTB (the display\'s fine reads, 8 x 8 tiles, with tB): no violation either, and its controls are caught (the early end, which the coarse tile of 8 never gets to cut, is cut here)', () => {
    const r = all(8, { run: { fine: true } });
    expect(r.viol, r.first).toBe(0); expect(r.hit, JSON.stringify(r)).toBeGreaterThan(300); expect(r.started, JSON.stringify(r)).toBeGreaterThan(10); expect(r.cutTail, JSON.stringify(r)).toBeGreaterThan(5);
    expect(all(8, { run: { fine: true, reachOpt: { ddMargin: PROXY.ddMargin - 4 } } }).viol, 'over-trusted field').toBeGreaterThan(0);
    expect(all(8, { run: { fine: true, tAShift: 8 } }).viol, 'late start').toBeGreaterThan(0);
    expect(all(8, { run: { fine: true, tBShift: 8 } }).viol, 'early end').toBeGreaterThan(0);
  }, 60000);
  it('negative controls: a field trusted 4 voxels too far, a start 8 grid points too late, an end 8 grid points too early must each be caught', () => {
    for (const tile of [8, 4]) {
      expect(all(tile, { run: { reachOpt: { ddMargin: PROXY.ddMargin - 4 } } }).viol, 'over-trusted field, tile ' + tile).toBeGreaterThan(0);
      expect(all(tile, { run: { tAShift: 8 } }).viol, 'late start, tile ' + tile).toBeGreaterThan(0);
      if (tile === 4) expect(all(tile, { run: { tBShift: 8 } }).viol, 'early end, tile ' + tile).toBeGreaterThan(0);
    }
  }, 60000);
  it('the tile of 4 x 4 starts later and ends earlier than the tile of 8 x 8 on the same rays (a narrower cone certifies more), and its empty share is not smaller', () => {
    const a = all(8), b = all(4); expect(b.empty / b.tiles).toBeGreaterThanOrEqual(a.empty / a.tiles - 0.02); expect(b.cutTail / b.hit).toBeGreaterThanOrEqual(a.cutTail / a.hit * 0.9);
  });
  it('the two certified parts meeting means the whole line is empty (tA = infinity), and a tile that sees tissue never gets tB below the last tissue sample (checked above); an empty grid (nothing shown) makes every tile empty', () => {
    const g = scenes[0].g, bytes = C.coarseGridCpu({ ...g, segOn: [0, 0, 0, 0], data: g.data.map((v, i) => (i % 4 === 3 ? 255 : v)) });
    const r = runCone({ g, bytes, tile: 4, cam: CAMS[0] }); expect(r.empty).toBe(r.tiles);
  });
  it('the CPU twin of the cone and the table of constants: the same hMin, slack, ddMargin, maxIt as the display\'s pre-pass; the chord term carries the factor 1 + c that the display\'s leaves out', () => {
    const t = C.coarseProxyWgsl({ mode: 'coarse', tile: 4 });
    for (const [k, v] of Object.entries({ hMin: PROXY.hMin, slack: PROXY.slack, ddMargin: PROXY.ddMargin, epsTheta: PROXY.epsTheta })) expect(t, k).toContain(String(v).includes('.') ? String(v) : String(v) + '.0');
    expect(t).toContain(`it<${PROXY.maxIt}`); expect(t).toContain('let k1=1.0/(1.0+ch);'); expect(t).toContain('let hh=(reachAt(o+a*sA)-sA*ch)*k1;'); expect(t).toContain('let hh=(reachAt(o+a*sB)-sB*ch)*k1;');
    expect(C.coneCpu.toString()).toContain('1 / (1 + ch)');
  });
});

describe('the WGSL texts', () => {
  const texts = [];
  for (const cls4 of [false, true]) {
    texts.push(['build', C.coarseBuildWgsl({ cls4 }), cls4]);
    for (const [mode, tile] of [['fine', 8], ['coarse', 8], ['coarse', 4]]) texts.push(['proxy ' + mode + ' ' + tile, C.coarseProxyWgsl({ cls4, mode, tile }), cls4]);
  }
  it('wgsl_reflect parses them; the uniform members are at the packer\'s offsets (the display pre-pass\'s layout is a prefix of the coarse one: its bytes are copied in); the bindings are the host\'s', () => {
    const P = uniformLayout(PROXY_FIELDS), L = uniformLayout(C.COARSE_FIELDS), B = uniformLayout(C.BUILD_FIELDS);
    for (const f of P.fields) expect(L.fields.find(x => x.name === f.name).offset, f.name).toBe(f.offset);
    expect(L.fields.find(x => x.name === 'texDims').offset).toBe(P.byteSize); // the extras begin where the display's bytes end
    for (const [name, t, cls4] of texts) {
      expect(t, name).not.toMatch(/undefined|NaN|\$\{/);
      const r = new WgslReflect(t), isBuild = name === 'build', uni = r.uniforms[0], Lay = isBuild ? B : L, fields = isBuild ? C.BUILD_FIELDS : C.COARSE_FIELDS;
      expect(r.entry.compute.map(e => e.name), name).toEqual(['main']);
      expect(uni.members.map(m => m.name), name).toEqual(fields.map(f => f[0]));
      for (const m of uni.members) expect(Lay.fields.find(f => f.name === m.name).offset, name + ' ' + m.name).toBe(m.offset);
      expect(Lay.byteSize).toBe(Math.ceil(uni.size / 16) * 16);
      const got = Object.fromEntries(r.getBindGroups()[0].filter(Boolean).map(b => [b.name || b.resource?.name, b.binding])); // (the list is indexed by binding: 0, 1, 4 here)
      if (isBuild) expect(got).toMatchObject({ g: C.BUILD_BINDINGS.params, clsTex: C.BUILD_BINDINGS.cls, cls4Tex: C.BUILD_BINDINGS.cls4, gridOut: C.BUILD_BINDINGS.out });
      else if (name.includes('fine')) expect(got).toMatchObject({ p: C.FINE_BINDINGS.params, clsTex: C.FINE_BINDINGS.cls, cls4Tex: C.FINE_BINDINGS.cls4, smp: C.FINE_BINDINGS.sampler, tilesOut: C.FINE_BINDINGS.out });
      else expect(got).toMatchObject({ p: C.COARSE_BINDINGS.params, gridTex: C.COARSE_BINDINGS.grid, tilesOut: C.COARSE_BINDINGS.out });
    }
  });
  it('the coarse pre-pass binds the grid only: no combined texture, no sampler, no filtered fetch (that is the point of it); the fine one reads the combined texture like the display\'s', () => {
    for (const [name, t] of texts.filter(x => x[0].startsWith('proxy coarse'))) { expect(t, name).not.toMatch(/clsTex|cls4Tex|textureSample|sampler/); expect(t, name).toContain('textureLoad(gridTex'); expect(t, name).toContain('texture_storage_2d<rg32float,write>'); }
    for (const [name, t] of texts.filter(x => x[0] === 'proxy fine 8')) { expect(t, name).toContain('textureSampleLevel(clsTex'); expect(t, name).not.toContain('gridTex'); }
  });
  it('the tile size is the text\'s (8 or 4) in the cone and in the pixel->tile maths of the volume variant; the grid cell is 4 texels, four cells to a texel', () => {
    expect(C.coarseProxyWgsl({ mode: 'coarse', tile: 4 })).toContain('lx*4<w&&ty*4<h'); expect(C.coarseProxyWgsl({ mode: 'coarse', tile: 8 })).toContain('lx*8<w&&ty*8<h');
    expect(C.coarseVolumeWgsl({}, 4)).toContain('/4,0).rg'); expect(C.coarseVolumeWgsl({}, 8)).toContain('/8,0).rg');
    expect(C.coarseProxyWgsl({ mode: 'coarse', tile: 4 })).toContain('vec3<i32>(v)/4'); expect(C.coarseProxyWgsl({ mode: 'coarse', tile: 4 })).toContain('c.x/4'); expect(C.coarseProxyWgsl({ mode: 'coarse', tile: 4 })).toContain('c.x%4');
    expect(() => C.coarseProxyWgsl({ mode: 'x' })).toThrow();
  });
  it('the build reads every texel of the dilated block once per cell (the window of xi: 0..5, 4..9, 8..13, 12..17 = cell x * 4 - 1 .. cell x * 4 + 4), the cells beyond the grid are 0, hidden slots are not read as inside', () => {
    const t = C.coarseBuildWgsl({ cls4: true });
    for (const s of ['if(xi<=5){m.x=min(m.x,v);}', 'if(xi>=4&&xi<=9){m.y=min(m.y,v);}', 'if(xi>=8&&xi<=13){m.z=min(m.z,v);}', 'if(xi>=12){m.w=min(m.w,v);}', 'for(var xi=0;xi<18;xi++)', 'let x=16*t.x-1+xi;', 'g.segOn[s]!=0', 'm[j]=0u;', 'q.a=textureLoad(cls4Tex,p,0).r;']) expect(t, s).toContain(s);
    expect(t).toContain('u32(round(q.a*255.0))'); expect(t.indexOf('u32(round(q.a*255.0))')).toBeLessThan(t.indexOf('q.a=textureLoad(cls4Tex')); // the distance byte is read before alpha is replaced by the fourth class
    expect(C.coarseBuildWgsl({ cls4: false })).not.toContain('textureLoad(cls4Tex');
  });
  it('the volume variants are the display text with exactly two lines changed (and the header): the tile size, the second channel, the end of the walk; the display\'s own text is not changed', () => {
    for (const cls4 of [false, true]) for (const f16 of [false, true]) for (const tile of [8, 4]) {
      const base = volumeWgsl({ f16, cls4, events: false }), v = C.coarseVolumeWgsl({ f16, cls4 }, tile), a = base.split('\n'), b = v.split('\n');
      expect(b.length, 'same line count').toBe(a.length);
      const diff = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y);
      expect(diff.length, `f16 ${f16} cls4 ${cls4} tile ${tile}`).toBe(3);
      expect(diff[0][1]).toContain('coarse-tile=' + tile); expect(diff[1][1]).toContain(`/${tile},0).rg;let tA=tt.r;`); expect(diff[2][1]).toBe('  if(tA>endT){emptyRay=true;}else{if(tA>t0){k=max(0,i32(floor((tA-t0)/stp))-1);}endT=min(endT,tt.g);}');
      expect(new WgslReflect(v).entry.vertex.length).toBe(1);
    }
    const v = C.coarseVolumeWgsl({}, 4);
    expect(v.indexOf('let faceT=')).toBeLessThan(v.indexOf('let tt=')); expect(v.indexOf('endT=min(endT,tt.g)')).toBeLessThan(v.indexOf('for(var iter=select(0,4096,emptyRay)')); // endT only changes before the loop
    expect(v.split('endT=').length - 1).toBe(volumeWgsl({ events: false }).split('endT=').length - 1 + 1); // one assignment more than the display's (the new one)
  });
  it('an anchor that is not found exactly once makes the variant throw (the display text changed: the variant must not silently be the display)', () => {
    expect(C.VOLUME_ANCHORS).toHaveLength(2); for (const a of C.VOLUME_ANCHORS) expect(volumeWgsl({ events: false }).split(a).length - 1).toBe(1);
  });
});

describe('the variants of the shadow pass', () => {
  it('registered after the nine of the display-step variants, with a spec each that has no override, no abl and no proxy flag (the host routes them by `coarse`); the module and the table agree', () => {
    expect(COARSE_NAMES).toEqual(['proxyTB', 'proxyCoarse8', 'proxyCoarse']); expect(BD_VARIANTS.filter(v => COARSE_NAMES.includes(v))).toEqual(COARSE_NAMES); expect(BD_VARIANTS.indexOf('proxyTB')).toBeGreaterThan(BD_VARIANTS.indexOf('noProxy')); // (the other groups' variants may lie between)
    for (const n of COARSE_NAMES) { const s = BD_SPECS[n]; expect(s).toEqual({ name: n, coarse: C.COARSE_VARIANTS[n], diff: true }); expect(s.name).toBe(n); expect(s.coarse).toEqual(C.COARSE_VARIANTS[n]); expect(s.overrides).toBeUndefined(); expect(s.abl).toBeUndefined(); expect(s.proxy).toBeUndefined(); }
    expect(C.COARSE_VARIANTS).toEqual({ proxyTB: { grid: false, tile: 8 }, proxyCoarse8: { grid: true, tile: 8 }, proxyCoarse: { grid: true, tile: 4 } });
  });
  it('the host: the shadow pass hands `coarse` specs over before anything else, the snapshot keeps what the variants need (the uniforms and the pre-pass bytes), end() lets the grid go, and the display\'s own pre-pass text and uniforms are not touched', () => {
    const a = host.indexOf('const shadowPass ='); expect(host.slice(a, a + 260)).toContain('if (spec.coarse) return coarse.shadow(rec, spec);');
    const b = host.indexOf('const bdSnapshot ='); expect(host.slice(b, a)).toContain('s.u = u; s.pxAb = px ? pxSnapshot() : null;');
    expect(host.slice(host.indexOf('function endBreakdown()'), host.indexOf('const coarse = createCoarseProxy')).includes('coarse.end()')).toBe(true);
    expect(host).toContain("import { createCoarseProxy } from './vr-wgpu-coarse-proxy.js?v="); expect(host).toContain('const pxSnapshot = () => px.ab.slice(0);');
    expect(host).toContain("v.coarse ? 'wgsl coarse ' + v.coarse"); // the compiler messages of these programs have a key of their own
    const prefix = host.slice(host.indexOf('const writeRange ='), host.indexOf('const writeRange =') + 80); expect(prefix).toContain('uploadGen++'); // any texture write changes the stamp the grid's key holds
  });
});

describe('the collector and the report lines', () => {
  it('a variant\'s own samples: the volume pass ratio like any variant, its compute ms, grid build ms, the differing pixels and compile failures under per-variant kinds; bad samples are no samples', () => {
    const vb = createVolBreakdown();
    for (let i = 0; i < 4; i++) { vb.add('same', 5, 5); vb.add('proxyCoarse', 3, 5); vb.add('proxyMs:proxyCoarse', 0.3, 1); vb.add('diff:proxyCoarse', 0, 24576); }
    vb.add('proxyBuild:proxyCoarse', 1.2, 1); vb.add('diff:proxyCoarse', 7, 24576); vb.add('proxyMs:proxyTB', 0.8, 1); vb.add('diff:proxyTB', 0, 24576); vb.add('proxyFail:proxyCoarse8', 1, 1);
    expect(vb.add('proxyMs:nope', 1, 1)).toBe(false); expect(vb.add('diff:proxyTB', -1, 5)).toBe(false); expect(vb.add('diff:proxyTB', 1, 0)).toBe(false); expect(vb.add('proxyMs:proxyTB', NaN, 1)).toBe(false); expect(vb.add('proxyFoo:proxyTB', 1, 1)).toBe(false);
    const s = vb.summary();
    expect(s.variants.proxyCoarse.n).toBe(4); expect(s.variants.proxyCoarse.R).toBeCloseTo(0.6);
    expect(s.proxyVariants.proxyCoarse).toMatchObject({ comparisons: 5, withDifference: 1, maxDiffPx: 7, pixels: 24576, computeMs: 0.3, computeN: 4, buildMs: 1.2, buildN: 1, failed: 0 });
    expect(s.proxyVariants.proxyTB).toMatchObject({ comparisons: 1, withDifference: 0, maxDiffPx: 0, computeMs: 0.8, computeN: 1 }); expect(s.proxyVariants.proxyCoarse8.failed).toBe(1);
    expect(s.proxy).toMatchObject({ comparisons: 0, withDifference: 0 }); // the noProxy comparison is not mixed with these
  });
  it('the report: one line per variant after the proxy diff line: compute vs the display\'s pre-pass, the net saving = est - (compute - display compute), the differing pixels, the grid build; a note says what the variants are', () => {
    const log = createPerfLog({ kind: 'webgpu', now: () => 0, store: null }); const vb = log.vb = createVolBreakdown(); vb.seconds = 30;
    for (let i = 0; i < 4; i++) { vb.add('same', 5, 5); vb.add('noProxy', 6, 5); vb.add('proxyMs', 0.8, 1); vb.add('proxyCoarse', 3, 5); vb.add('proxyMs:proxyCoarse', 0.5, 1); vb.add('diff:proxyCoarse', 0, 24576); }
    vb.add('proxyBuild:proxyCoarse', 1.25, 1); vb.add('proxyFail:proxyTB', 1, 1);
    log.row({ menu: 1, rec: 1, fps: 40 }, 1000); log.rows[0].vol = 10;
    const t = perfReport(log, {}).split('\n'), i = t.findIndex(l => l.startsWith('proxy diff px:'));
    expect(i).toBeGreaterThan(0);
    expect(t[i + 1]).toMatch(/^proxy proxyTB: compute median - vs the display's pre-pass 0\.80 ms · net saving - · diff px - \(no comparison\).* · NOT COMPILED \(1\)$/);
    expect(t[i + 2]).toMatch(/^proxy proxyCoarse8: compute median -/); expect(t[i + 3]).toBe("proxy proxyCoarse: compute median 0.50 ms (4) vs the display's pre-pass 0.80 ms · net saving 2.3 ms · diff px max 0 of 24576 px · 0 of 4 comparisons had a differing pixel · grid build median 1.25 ms (1)");
    expect(t.some(l => l.startsWith('abl proxyCoarse n=4 ratio 0.60'))).toBe(true); // the est (2.0 ms of the volume pass) is on the generic line; net = 2.0 - (0.5 - 0.8) = 2.3
    const notes = t.filter(l => l.startsWith('note: ') && /proxyCoarse8/.test(l)); expect(notes).toHaveLength(1); expect(notes[0]).toMatch(/tB/); expect(notes[0]).not.toMatch(/[぀-ヿ一-鿿]/);
  });
});

// ---- the host, driven with a mock device ----
const GPU_GLOBALS = () => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
};
const withGpu = fn => async () => { GPU_GLOBALS(); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));
function mockHost({ cls4 = false, failCompute = false } = {}) {
  const log = { cpasses: [], rpasses: [], writes: [], textures: [], buffers: [], submits: 0, bindGroups: [], computePipes: [], renderPipes: [], pairs: [], events: [], shaders: [], dropped: [], cpassPipes: [] };
  const buf = d => { const b = { d, destroyed: false, destroy() { b.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => (d.size === 4 ? new Uint32Array([0]).buffer : d.size > 16 ? new Uint32Array(d.size / 4).buffer : new BigUint64Array([1000n, 2000000n]).buffer), unmap() {} }; log.buffers.push(b); return b; };
  const device = {
    queue: { writeBuffer: (b, off, data) => log.writes.push({ b, data: new Int32Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0)) }), submit: () => { log.submits++; } },
    createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}), createShaderModule: d => { log.shaders.push(d.code); return {}; },
    createComputePipelineAsync: async d => { if (failCompute) throw new Error('boom'); const p = { d, compute: true }; log.computePipes.push(p); return p; }, createRenderPipelineAsync: async d => { const p = { d }; log.renderPipes.push(p); return p; },
    createTexture: d => { const t = { d, destroyed: false, destroy() { t.destroyed = true; }, createView: () => ({}) }; log.textures.push(t); return t; }, createBuffer: buf,
    createBindGroup: d => { log.bindGroups.push(d); return { d }; },
    createCommandEncoder: () => ({
      beginComputePass: d => { const p = { d, pipe: null, disp: [] }; log.cpasses.push(p); return { setPipeline: x => { p.pipe = x; }, setBindGroup() {}, dispatchWorkgroups: (...a) => p.disp.push(a), end() {} }; },
      beginRenderPass: d => { const p = { d, pipe: null, draws: 0, viewports: [], groups: [] }; log.rpasses.push(p); return { setPipeline: x => { p.pipe = x; }, setVertexBuffer() {}, setBindGroup: (i, g) => p.groups.push(g), setViewport: (...a) => p.viewports.push(a), setScissorRect() {}, draw: () => { p.draws++; }, end() {} }; },
      resolveQuerySet() {}, copyBufferToBuffer() {}, clearBuffer() {}, finish: () => ({}),
    }),
  };
  const layout = uniformLayout(); const P = uniformLayout(PROXY_FIELDS);
  const pxAb = new ArrayBuffer(P.byteSize), I = new Int32Array(pxAb), at = n => P.fields.find(f => f.name === n).offset / 4;
  I[at('nEyes')] = 2; I[at('w0')] = 128; I[at('h0')] = 96; I[at('w1')] = 128; I[at('h1')] = 96; [0, 1, -1, -1].forEach((c, k) => { I[at('clsChan') + k] = c; }); [1, 1, 0, 0].forEach((c, k) => { I[at('segOn') + k] = c; });
  const tex = () => ({ image: { width: 64, height: 64, depth: 64 } });
  const bd = { snap: null, shadowOk: true, slots: Array.from({ length: 4 }, () => ({ buf: buf({ size: 16 }), busy: false })), qs: {}, resolve: {}, tgt: null, tgt2: null, diff: { busy: false, pipe: {}, bgl: {}, group: null, gA: null, gB: null, cnt: buf({ size: 4 }), rb: buf({ size: 4 }) }, tmp: new Int32Array(layout.byteSize / 4), onShadow: (...a) => log.events.push(a), failed: [] };
  const rec = { vols: 1, shadowed: false, pairs: null, lowMs: 2 };
  bd.snap = { rec, target: { w: 320, h: 128 }, variant: { cls4, events: false }, px: { tex: {} }, pxAb, u: { clsTex: { value: tex() }, cls4Tex: { value: tex() } },
    eyes: [0, 1].map(i => ({ x: i * 130, y: 0, w: 128, h: 96, vx: i * 130, vy: 0, vw: 128, vh: 96, scissors: [[i * 130, 0, 128, 96]] })), ab: [0, 1].map(() => new Int32Array(layout.byteSize / 4)), bgOn: [{}, {}] };
  const state = { gen: 1 };
  const ctx = {
    device, f16: false, layout, getBd: () => bd, ubufOf: i => ({ ubuf: i }), bindGroup: (i, u, t) => ({ bg: i, t }), dummy: () => ({ createView: () => ({}) }), gpuOf: t => (t ? (t.gpu ||= { createView: () => ({}), id: Math.random() }) : null), dropGroups: t => log.dropped.push(t), linear: {}, boxBuf: {},
    pipeDescFor: m => ({ m }), displayPipe: () => ({ display: true }), uploadGen: () => state.gen, pair: (r, name, slot) => log.pairs.push([name, slot]), onShader: undefined,
  };
  return { C, ctx, bd, rec, log, state, cp: C.createCoarseProxy(ctx), I, at };
}
describe('host: the shadow pass of a coarse variant (mock device)', () => {
  const ready = async (h, spec) => { expect(h.cp.shadow(h.rec, spec)).toBeNull(); await settle(); await settle(); await settle(); }; // the programs (all three variants) are made asynchronously at the first ask: stepped past (null), then ready
  it('first use compiles the programs (stepped past), then one submit: the grid build, the pre-pass compute, the volume pass of the variant and the display\'s own pass drawn again, the pixel count; its ms is paired with the low pass and the compute ms comes through its own kind', withGpu(async () => {
    const h = mockHost(); const spec = BD_SPECS.proxyCoarse;
    await ready(h, spec);
    expect(h.cp.shadow(h.rec, spec)).toBe(true);
    expect(h.log.submits).toBe(1); expect(h.log.cpasses).toHaveLength(3); expect(h.log.rpasses).toHaveLength(2); // build + pre-pass + the pixel count; the variant's pass and the display's again
    const [build, pre, count] = h.log.cpasses; expect(build.pipe.compute).toBe(true); expect(build.disp).toEqual([[1, 4, 4]]); // 64^3 texels = 16^3 cells = 4 x 16 x 16 packed texels / workgroups of 4
    expect(pre.disp).toEqual([[Math.ceil(32 * 2 / 8), Math.ceil(24 / 8)]]); // 4 x 4 tiles: 32 x 24 per eye, two eyes side by side
    expect(count.disp.length).toBe(1);
    expect(h.log.rpasses[0].draws).toBe(2); expect(h.log.rpasses[1].draws).toBe(2);
    expect(h.log.pairs).toHaveLength(1); expect(h.log.pairs[0][0]).toBe('proxyCoarse');
    expect(h.log.renderPipes).toHaveLength(3); expect(h.log.computePipes).toHaveLength(4); // all three variants at the first ask: their volume programs, their pre-pass programs and the one grid build
    await settle(); await settle();
    const kinds = h.log.events.map(e => e[0]).sort(); expect(kinds).toEqual(['diff:proxyCoarse', 'proxyBuild:proxyCoarse', 'proxyMs:proxyCoarse']);
    expect(h.log.events.find(e => e[0] === 'diff:proxyCoarse').slice(1)).toEqual([0, 128 * 96 * 2]); expect(h.log.events.find(e => e[0] === 'proxyMs:proxyCoarse')[1]).toBeCloseTo(1.999);
  }));
  it('the pixel -> tile mapping of each eye: proxyOrg x = vx - tile * eye * tilesPerEye (tile 4: 32 tiles an eye), written over the snapshot\'s own uniforms of that eye', withGpu(async () => {
    const h = mockHost(), org = uniformLayout().fields.find(f => f.name === 'proxyOrg').offset / 4;
    h.bd.snap.ab[0][org] = 99; h.bd.snap.ab[1][org] = 99;
    await ready(h, BD_SPECS.proxyCoarse); h.cp.shadow(h.rec, BD_SPECS.proxyCoarse);
    const w = h.log.writes.filter(x => x.data.length === h.bd.tmp.length && x.b.ubuf !== undefined);
    expect(w.map(x => [x.b.ubuf, x.data[org], x.data[org + 1]])).toEqual([[4, 0, 0], [5, 130 - 4 * 32, 0], [7, 99, 0], [8, 99, 0]]); // the variant's passes (uniform slots 4, 5), then the display's own again (7, 8: its tiles, its proxyOrg)
  }));
  it('the grid is made again when the data changes (the upload stamp), not for every shadow pass, and now and then so that its cost has samples; the fine variant makes none', withGpu(async () => {
    const h = mockHost(), spec = BD_SPECS.proxyCoarse8, builds = () => h.log.cpasses.filter(p => p.disp.length && p.disp[0].length === 3).length;
    await ready(h, spec); h.cp.shadow(h.rec, spec); expect(builds()).toBe(1);
    for (const slot of h.bd.slots) slot.busy = false;
    h.cp.shadow(h.rec, spec); expect(builds()).toBe(1); for (const s of h.bd.slots) s.busy = false; // same stamp, same shown set: reused
    h.state.gen++; h.cp.shadow(h.rec, spec); expect(builds()).toBe(2); for (const s of h.bd.slots) s.busy = false; // another upload: made again
    h.I[h.at('segOn')] = 0; h.bd.snap.pxAb = h.bd.snap.pxAb; h.cp.shadow(h.rec, spec); expect(builds()).toBe(3); for (const s of h.bd.slots) s.busy = false; // another shown set (read from the pre-pass bytes): made again
    for (let i = 0; i < 5; i++) { h.cp.shadow(h.rec, spec); for (const s of h.bd.slots) s.busy = false; }
    expect(builds()).toBe(4); // every 6th use of the grid
    const f = mockHost(); await ready(f, BD_SPECS.proxyTB); expect(f.cp.shadow(f.rec, BD_SPECS.proxyTB)).toBe(true); expect(f.log.cpasses.filter(p => p.disp[0]?.length === 3)).toHaveLength(0); expect(f.log.textures.some(t => t.d.format === 'rgba8uint')).toBe(false);
    expect(f.log.cpasses[0].disp).toEqual([[Math.ceil(16 * 2 / 8), Math.ceil(12 / 8)]]); // 8 x 8 tiles: 16 x 12 per eye
  }));
  it('nothing is submitted when there is nothing to compare with or the resources are not there: no pre-pass in the display\'s low pass, a section variant, other sizes of the two textures (null: the caller steps past); no free timer slot (false: asked again)', withGpu(async () => {
    const spec = BD_SPECS.proxyCoarse;
    let h = mockHost(); h.bd.snap.px = null; expect(h.cp.shadow(h.rec, spec)).toBeNull();
    h = mockHost(); h.bd.snap.variant = { cls4: false, events: true }; expect(h.cp.shadow(h.rec, spec)).toBeNull();
    h = mockHost({ cls4: true }); h.bd.snap.u.cls4Tex.value = { image: { width: 32, height: 64, depth: 64 } }; expect(h.cp.shadow(h.rec, spec)).toBeNull();
    h = mockHost(); expect(h.cp.shadow({}, spec)).toBe(false); // not the snapshot's record
    h = mockHost(); await ready(h, spec); for (const s of h.bd.slots.slice(0, 3)) s.busy = true; expect(h.cp.shadow(h.rec, spec)).toBe(false); expect(h.log.submits).toBe(0);
  }));
  it('a program that does not compile is listed once and the variant is stepped past (null), never retried in a loop; all three variants are compiled at the first ask', withGpu(async () => {
    const h = mockHost({ failCompute: true }); const spec = BD_SPECS.proxyTB;
    expect(h.cp.shadow(h.rec, spec)).toBeNull(); await settle(); await settle(); await settle();
    expect(h.cp.shadow(h.rec, spec)).toBeNull(); expect(h.cp.shadow(h.rec, spec)).toBeNull();
    expect(h.bd.failed).toHaveLength(3); expect(h.bd.failed.every(x => x.includes('boom'))).toBe(true); expect(h.bd.failed[0]).toContain('proxyTB'); expect(h.log.events.filter(e => e[0] === 'proxyFail:proxyTB')).toHaveLength(1); // one line per variant, each once
    expect(h.log.submits).toBe(0);
  }));
  it('the diff is made only when the comparison\'s buffer is free, and is the same count as the noProxy turn\'s (the display\'s own bind groups and the shared pixel counter); end() lets the grid, the tiles and the buffers go and the programs are made again next time', withGpu(async () => {
    const h = mockHost(), spec = BD_SPECS.proxyCoarse; await ready(h, spec);
    h.bd.diff.busy = true; expect(h.cp.shadow(h.rec, spec)).toBe(true); expect(h.log.rpasses).toHaveLength(1); expect(h.log.cpasses).toHaveLength(2); // no display copy, no count
    for (const s of h.bd.slots) s.busy = false; h.bd.diff.busy = false;
    h.cp.shadow(h.rec, spec); expect(h.log.rpasses).toHaveLength(3);
    expect(h.log.textures.filter(t => ['rg32float', 'rgba8uint'].includes(t.d.format) && !t.destroyed).length).toBe(2); // the tiles and the grid
    h.cp.end(); expect(h.log.textures.filter(t => ['rg32float', 'rgba8uint'].includes(t.d.format)).every(t => t.destroyed)).toBe(true); expect(h.log.dropped.length).toBeGreaterThanOrEqual(2);
    for (const s of h.bd.slots) s.busy = false; expect(h.cp.shadow(h.rec, spec)).toBeNull(); // compiles again (stepped past meanwhile)
  }));
});
