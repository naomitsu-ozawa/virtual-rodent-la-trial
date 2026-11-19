// The sample grid of the WGSL march (docs/vr-wgsl-core.js): every sample position is t = t0 + f32(k) * step, made in ONE place at the top of the loop; a step is k++, a creep step is k++, a jump is k += m.
// Before t was accumulated: t += step, t = nextJ. Both walk the same grid in exact arithmetic; in f32 the accumulated t carries the rounding of every addition, so the new text can differ from the old
// by a few ulp of t. The sample at a grid point must not depend on the way the ray got there (so that a march started at a later grid point, and a march from k = 0, read the same samples).
// A CPU model of the march (classification + distance grid made with the real distance-field.js / vr-skip-occupancy.js, anisotropic dims, entry-face override, creep skip, forced one-step jumps,
// the surface search after the loop) is run on every pixel of synthetic cameras with t accumulated and with t from the step index, both with f32 rounding of t, and with exact (double) arithmetic.
// Checks: the hit's grid point, segment, hitNb, hitIso and onFace are the same on every ray; only the searched hi may move. hiNoise counts every hit whose hi differs at all (dv > 0). Measured in f32 at step 1.5 voxel: 70 % of the hits differ (dv > 0), 7.3 % of them by 1e-6 to 1e-4 voxel, and 0.08 % by more than 1e-4 voxel (at most 0.0132 voxel);
// a shift above 1e-4 voxel (hiShift: a branch of the secant / bisection search taken the other way at a tie) may be at most 0.03 voxel and on at most 3 % of the hits.
// The shader text is tied to the model by the second part (the expressions of the model are in the generated WGSL, once, in this order).
import { describe, it, expect } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { euclideanDistanceBytes, combineClassificationDistance } from '../../docs/distance-field.js';
import { buildSkipOccupancy, skipGrid } from '../../docs/vr-skip-occupancy.js';
import { volumeWgsl, ABLATIONS } from '../../docs/vr-wgsl-core.js';

const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEG_OFF = 1.0e9, f32 = Math.fround;

// ---------- the grid: anisotropic dims and voxel sizes; slot 0 = channel 0, slot 1 = channel 1 ----------
function makeGrid(rand, { dims, halfExt, nBlobs, border }) {
  const [W, H, D] = dims, n = W * H * D, bl = [];
  for (let i = 0; i < nBlobs; i++) { const rs = i < 2 ? 4 + rand() * 9 : 1 + rand() * 4; bl.push({ c: [8 + rand() * (W - 16), 8 + rand() * (H - 16), 8 + rand() * (D - 16)], r: [rs * (0.7 + rand() * 0.6), rs * (0.7 + rand() * 0.6), rs * (0.7 + rand() * 0.6)], ch: i % 2 }); }
  if (border) { bl.push({ c: [-1, H / 2, D / 2], r: [5, 6, 6], ch: 0 }); bl.push({ c: [W / 2, H + 1, D / 3], r: [6, 4, 6], ch: 1 }); } // blobs cut by a box face: rays that enter the box inside a segment (faceT, onFace)
  const cls = new Uint8Array(n * 2);
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (z * H + y) * W + x, sd = [1e9, 1e9];
    for (const b of bl) { const q = Math.hypot((x - b.c[0]) / b.r[0], (y - b.c[1]) / b.r[1], (z - b.c[2]) / b.r[2]); sd[b.ch] = Math.min(sd[b.ch], (q - 1) * Math.min(...b.r)); }
    for (let ch = 0; ch < 2; ch++) cls[i * 2 + ch] = Math.max(0, Math.min(255, Math.round(127.5 - sd[ch] * 40)));
    if (rand() < 0.0003) cls[i * 2 + (rand() < 0.5 ? 0 : 1)] = 140; // a few isolated inside voxels (specks)
  }
  const dist = new Uint8Array(n * 2), inside = new Uint8Array(n);
  for (let ch = 0; ch < 2; ch++) { for (let i = 0; i < n; i++) inside[i] = cls[i * 2 + ch] >= 128 ? 1 : 0; const d = euclideanDistanceBytes(inside, dims); for (let i = 0; i < n; i++) dist[i * 2 + ch] = d[i]; }
  const data = combineClassificationDistance({ data: cls, C: 2, chan: [0, 1, -1, -1] }, { data: dist, C: 2 }, 0b11);
  const bits = buildSkipOccupancy({ data, dims, chan: [0, 1, -1, -1], mask: 0b11 });
  const vs = halfExt.map((h, k) => 2 * h / dims[k]);
  return { data, bits, dims, halfExt, voxelMin: Math.min(...vs) };
}
function fetchAt(g, tc) { // the trilinear sample (rgba 0..1), clamp to edge
  const N = g.dims, r = [0, 0, 0, 0], p = tc.map((v, k) => Math.min(Math.max(v, 0), 0.999999) * N[k] - 0.5), f = p.map(Math.floor), w = p.map((v, k) => v - f[k]);
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1, wt = (dx ? w[0] : 1 - w[0]) * (dy ? w[1] : 1 - w[1]) * (dz ? w[2] : 1 - w[2]);
    const ix = Math.min(Math.max(f[0] + dx, 0), N[0] - 1), iy = Math.min(Math.max(f[1] + dy, 0), N[1] - 1), iz = Math.min(Math.max(f[2] + dz, 0), N[2] - 1), b = ((iz * N[1] + iy) * N[0] + ix) * 4;
    for (let k = 0; k < 4; k++) r[k] += wt * g.data[b + k] / 255;
  }
  return r;
}
const texCoord = (g, p) => p.map((v, k) => v / (2 * g.halfExt[k]) + 0.5);
const fOf = q => [q[0] - 0.5, q[1] - 0.5, -SEG_OFF, -SEG_OFF];
function hitBox(g, o, d) {
  let lo = -1e30, hi = 1e30;
  for (let k = 0; k < 3; k++) { const dk = Math.abs(d[k]) < 1e-20 ? 1e-20 : d[k], inv = 1 / dk, a = (-g.halfExt[k] - o[k]) * inv, b = (g.halfExt[k] - o[k]) * inv; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
  return [lo, hi];
}

// ---------- the march of one ray (the WGSL loop, events off, hitSimple off, refine 1, editMask 0) ----------
// o = { stp, useSkip, tMode: 'idx' (t = t0 + k * stp: this text) | 'acc' (t += stp, t = nextJ: the text of to 752), R: the rounding of t (f32 or identity) }
function march(g, ray, o) {
  const { R } = o, stp = R(o.stp);
  const [bx, by] = hitBox(g, ray.o, ray.d);
  if (bx > by) return { discard: true };
  const t0 = R(Math.max(bx, 0)), endT = by;
  const faceEnd = (bx > 0 && t0 <= bx + 1e-4) ? bx + stp : -1, faceT = faceEnd >= 0 ? t0 : -1; // from the ray's own start, never from a later grid point
  const N = g.dims, tcO = texCoord(g, ray.o), tcD = ray.d.map((v, k) => v / (2 * g.halfExt[k]));
  const jkA = Math.max(1 / Math.max(0.5 * Math.hypot(...ray.d.map((v, k) => v * N[k] / g.halfExt[k])), 1e-6), g.voxelMin);
  const pos = t => tcO.map((v, k) => v + tcD[k] * t);
  const [sbx, sby] = skipGrid(N);
  const bitAt = t => {
    const pp = pos(t).map((v, k) => v * N[k] - 0.5), fl = pp.map(Math.floor), fr = pp.map((v, k) => v - fl[k]);
    if (!(fr.every(v => v > 1 / 64 && v < 63 / 64) && fl.every(v => v >= 0) && fl.every((v, k) => v < N[k] - 1))) return null;
    const sb = fl.map(v => v >> 2), sl = fl.map(v => v & 3), sbit = sl[0] + (sl[1] << 2) + (sl[2] << 4), blk = (sb[2] * sby + sb[1]) * sbx + sb[0];
    return ((g.bits[blk * 2 + (sbit < 32 ? 0 : 1)] >>> (sbit & 31)) & 1) !== 0;
  };
  const T = k => R(t0 + R(k * stp)); // the one expression of t: t = t0 + f32(k) * stp
  let k = 0, t = t0, previousT = t, lastIndex = -1, prevValid = false, prevF = 0, prevSkip = false, chk = false, hit = null, iters = 0, lastJumpM = 0, creep = 0;
  for (let iter = 0; iter < 4096; iter++) {
    if (o.tMode === 'idx') t = T(k); // the top of the loop
    if (t > endT) break;
    iters++;
    const step = () => { k++; if (o.tMode === 'acc') t = R(t + stp); }; // a step: k++ (idx), t += stp (acc; k only counts for the report)
    if (o.useSkip && chk) { if (bitAt(t)) { creep++; prevValid = true; prevSkip = true; lastIndex = -1; previousT = t; step(); lastJumpM = 0; continue; } }
    const q = fetchAt(g, pos(t)); let dd = q[3] * 255;
    if (dd >= 2.7 && t <= faceT) { if (Math.max(...fOf(q)) >= 0) dd = 0; }
    chk = dd < 2.7;
    if (dd >= 2.7) {
      const m = Math.max(1, Math.floor((dd - 1.8) * jkA / stp)), nextJ = o.tMode === 'acc' ? R(t + R(stp * m)) : T(k + m);
      previousT = R(nextJ - stp * 0.05); prevValid = false; k += m; t = nextJ; lastJumpM = m; continue;
    }
    const f = fOf(q); let idx = -1, curF = -1;
    for (let s = 0; s < 4; s++) if (f[s] >= 0) { idx = s; curF = f[s]; break; }
    if (idx !== lastIndex) {
      if (idx >= 0) {
        if (prevSkip && prevValid) prevF = Math.max(...fOf(fetchAt(g, pos(previousT))));
        hit = { idx, lo: previousT, hi: t, f0: prevF, f1: curF, nb: prevValid ? 6 : 2, iso: prevValid && prevF < 0, k, viaJump: lastJumpM };
        lastIndex = idx; break;
      }
      lastIndex = idx;
    }
    prevSkip = false; prevValid = true; prevF = idx >= 0 ? curF : Math.max(...f);
    previousT = t; step(); lastJumpM = 0;
  }
  let fin = null;
  if (hit) { // the surface search after the loop: two secant guesses + one bisection when iso, else hitNb bisections
    let lo = hit.lo, hi = hit.hi, f0 = hit.f0, f1 = hit.f1; const idx = hit.idx;
    const insideAt = qm => { if (!(qm[idx] >= 0.5)) return false; for (let s = 0; s < idx; s++) if (qm[s] >= 0.5) return false; return true; };
    if (hit.iso) {
      for (let r = 0; r < 3; r++) {
        let mid = (lo + hi) * 0.5; if (r < 2 && Math.abs(f1 - f0) > 1e-6) mid = Math.min(Math.max(lo + (hi - lo) * (-f0 / (f1 - f0)), lo + (hi - lo) * 0.02), hi - (hi - lo) * 0.02);
        const qm = fetchAt(g, pos(mid)), fmv = qm[idx] - 0.5; let inside = fmv >= 0; if (!insideAt(qm)) inside = false;
        if (inside) { hi = mid; f1 = fmv; } else { lo = mid; f0 = fmv; }
      }
    } else {
      for (let r = 0; r < 6; r++) { if (r >= hit.nb) break; const mid = (lo + hi) * 0.5, qm = fetchAt(g, pos(mid)); if (insideAt(qm)) hi = mid; else lo = mid; }
    }
    fin = { idx, hi, onFace: hi <= faceEnd };
  }
  return { discard: false, hit, fin, iters, creep };
}

function makeCam(rand, g, { W, H, fpx, inside, face }) {
  const he = g.halfExt; let o;
  if (face) o = [-2.2 * he[0], 0.1 * he[1], 0]; // in front of the x = 0 face, where a blob cut by that face is (rays that enter the box inside a segment)
  else if (inside) o = he.map(h => (rand() * 1.2 - 0.6) * h);
  else { const a = rand() * 2 * Math.PI, e = Math.acos(2 * rand() - 1), R = Math.hypot(...he) * (1.15 + rand() * 1.5); o = [R * Math.sin(e) * Math.cos(a), R * Math.sin(e) * Math.sin(a), R * Math.cos(e)]; }
  const tgt = face ? [0, 0, 0] : he.map(h => (rand() - 0.5) * h);
  let fw = tgt.map((v, k) => v - o[k]); const lf = Math.hypot(...fw); fw = fw.map(v => v / lf);
  let up = Math.abs(fw[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let rt = cr(fw, up); const lr = Math.hypot(...rt); rt = rt.map(v => v / lr); up = cr(rt, fw);
  const dirOf = (px, py) => { const u = (px + 0.5 - W / 2) / fpx, v = -(py + 0.5 - H / 2) / fpx, d = [0, 1, 2].map(k => fw[k] + u * rt[k] + v * up[k]), l = Math.hypot(...d); return d.map(x => x / l); };
  return { o, W, H, dirOf };
}

// ---------- the scenes: the same grids and cameras for every run ----------
const shapes = [{ dims: [80, 64, 96], halfExt: [1.0, 0.8, 1.5] }, { dims: [96, 96, 48], halfExt: [1.0, 1.0, 0.75] }, { dims: [72, 72, 72], halfExt: [1, 1, 1] }];
const scene = (() => {
  const rand = rng(20261119), grids = [];
  for (let i = 0; i < 4; i++) grids.push(makeGrid(rand, { ...shapes[i % 3], nBlobs: 3 + i, border: i % 2 === 0 }));
  const camRand = rng(7), cams = grids.map((g, gi) => [0, 1, 2, 3].slice(0, gi % 2 === 0 ? 4 : 3).map(i => makeCam(camRand, g, i === 3 ? { W: 16, H: 16, fpx: 300, face: true } : { W: 48, H: 48, fpx: i === 2 ? 90 : 180, inside: i === 0 })));
  return { grids, cams };
})();

// one comparison: every pixel of every camera, the march with t accumulated against the march with t from the step index (both with the rounding R)
function compare({ R, stepVox, useSkip }) {
  const st = { rays: 0, hits: 0, sameGrid: 0, diffGrid: 0, diffSeg: 0, diffNb: 0, diffIso: 0, diffFace: 0, diffHitNoHit: 0, hiNoise: 0, hiShift: 0, hiMax: 0, creep: 0, forced: 0, face: 0, iso: 0, nb2: 0, viaJump: 0, itersEqual: 0 };
  scene.grids.forEach((g, gi) => {
    const stp = stepVox * g.voxelMin;
    for (const cam of scene.cams[gi]) for (let py = 0; py < cam.H; py++) for (let px = 0; px < cam.W; px++) {
      const ray = { o: cam.o, d: cam.dirOf(px, py) };
      const A = march(g, ray, { stp, useSkip, tMode: 'acc', R }), B = march(g, ray, { stp, useSkip, tMode: 'idx', R });
      if (A.discard) { expect(B.discard).toBe(true); continue; }
      st.rays++; st.creep += A.creep;
      if (A.iters === B.iters) st.itersEqual++;
      if (!A.hit !== !B.hit) { st.diffHitNoHit++; continue; }
      if (!A.hit) continue;
      st.hits++;
      if (A.hit.viaJump === 1) st.forced++; if (A.hit.viaJump > 1) st.viaJump++; if (A.fin.onFace) st.face++; if (A.hit.iso) st.iso++; if (A.hit.nb === 2) st.nb2++;
      if (A.hit.k !== B.hit.k) st.diffGrid++; else st.sameGrid++;
      if (A.fin.idx !== B.fin.idx) st.diffSeg++;
      if (A.hit.nb !== B.hit.nb) st.diffNb++;
      if (A.hit.iso !== B.hit.iso) st.diffIso++;
      if (A.fin.onFace !== B.fin.onFace) st.diffFace++;
      const dv = Math.abs(A.fin.hi - B.fin.hi) / g.voxelMin; if (dv > 0) st.hiNoise++; if (dv > 1e-4) st.hiShift++; st.hiMax = Math.max(st.hiMax, dv);
    }
  });
  return st;
}
const sameRayResult = st => { expect(st.diffHitNoHit).toBe(0); expect(st.diffGrid).toBe(0); expect(st.diffSeg).toBe(0); expect(st.diffNb).toBe(0); expect(st.diffIso).toBe(0); expect(st.diffFace).toBe(0); };

describe('the sample grid t = t0 + k * step: the result of a ray against the accumulated t of to 752 (CPU model)', () => {
  it('step 1.5 (the low pass), the WebGPU display (useSkip 0), t rounded to f32: the hit grid point, segment, hitNb, hitIso and onFace are the same on every ray; hi moves by more than 1e-4 voxel on at most 3 % of the hits, by at most 0.03 voxel', () => {
    const st = compare({ R: f32, stepVox: 1.5, useSkip: false });
    sameRayResult(st);
    expect(st.rays).toBeGreaterThan(20000); expect(st.hits).toBeGreaterThan(1500); expect(st.hits).toBeLessThan(st.rays); // hits and passes
    expect(st.iso).toBeGreaterThan(800); expect(st.face).toBeGreaterThan(50); expect(st.hiMax).toBeLessThanOrEqual(0.03); expect(st.hiShift / st.hits).toBeLessThanOrEqual(0.03);
  });
  it('the same with the creep skip on (useSkip 1: creep steps are k++ too): same ray results, hi shifted on at most 3 % of the hits, by at most 0.03 voxel', () => {
    const st = compare({ R: f32, stepVox: 1.5, useSkip: true });
    sameRayResult(st);
    expect(st.creep).toBeGreaterThan(5000); expect(st.hits).toBeGreaterThan(1500); expect(st.hiMax).toBeLessThanOrEqual(0.03); expect(st.hiShift / st.hits).toBeLessThanOrEqual(0.03);
  });
  it('step 4.0 and 6.0 (the forced one-step jumps that land inside are exercised): same ray results, hi shifted on at most 3 % of the hits, by at most 0.03 voxel', () => {
    for (const stepVox of [4.0, 6.0]) {
      const st = compare({ R: f32, stepVox, useSkip: false });
      sameRayResult(st);
      expect(st.hits, 'step ' + stepVox).toBeGreaterThan(1500); expect(st.hiMax).toBeLessThanOrEqual(0.03); expect(st.hiShift / st.hits).toBeLessThanOrEqual(0.03);
      if (stepVox === 6.0) expect(st.forced).toBeGreaterThan(0);
    }
  });
  it('in exact arithmetic (no f32 rounding) the two ways of making t give the same ray results and the same search to within the noise of doubles (a tie in the search may take the other branch on a rare ray): the change is the rounding of t, nothing else', () => {
    const st = compare({ R: x => x, stepVox: 1.5, useSkip: true });
    sameRayResult(st);
    expect(st.hits).toBeGreaterThan(1500); expect(st.hiMax).toBeLessThanOrEqual(1.5); expect(st.hiShift / st.hits).toBeLessThanOrEqual(0.01); // a search stays inside the bracket (one step)
    expect(st.hiNoise).toBeLessThan(st.hits * 0.3); // f64: only the last bits of t differ
  });
  it('the comparison is sensitive: the accumulated f32 t does move the search on most hits (at the noise of f32), and the same hits in exact arithmetic much less (the model sees the rounding the change removes)', () => {
    const st = compare({ R: f32, stepVox: 1.5, useSkip: false }), ex = compare({ R: x => x, stepVox: 1.5, useSkip: false });
    expect(st.hiNoise).toBeGreaterThan(st.hits * 0.2); expect(ex.hiNoise).toBeLessThan(st.hiNoise); // if f32 moved nothing the comparison above would prove nothing about the rounding
  });
});

describe('the shader text is the model: t made once at the top of the loop, every step k++, a jump k += m from t0, the face rule from the ray start', () => {
  const BASES = []; for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const events of [false, true]) BASES.push({ f16, cls4, events });
  const VARIANTS = BASES.flatMap(b => [b, { ...b, counters: true }, ...ABLATIONS.flatMap(abl => [{ ...b, abl }, { ...b, abl, counters: true }])]);
  const count = (t, s) => t.split(s).length - 1;
  it.each(BASES)('%o: the expressions of the model are in the display text, once, in the order of the model', b => {
    const t = volumeWgsl(b);
    const T = '  let t=t0+f32(k)*stp;\n', J = 'let m=max(1,i32(floor((dd-1.8)*jkA/stp)));let nextJ=t0+f32(k+m)*stp;jumpLen+=nextJ-t;previousT=nextJ-stp*0.05;prevValid=false;k+=m;continue;';
    expect(count(t, T)).toBe(1); expect(count(t, J)).toBe(1); expect(count(t, 'let t0=t;var k=0;')).toBe(1); expect(count(t, 'let t0=t;')).toBe(1);
    const iFace = t.indexOf('let faceEnd=select(-1.0,bounds.x+stp,bounds.x>0.0&&t<=bounds.x+1.0e-4);'), iFaceT = t.indexOf('let faceT=select(-1.0,t,faceEnd>=0.0);'), iT0 = t.indexOf('let t0=t;'), iK = t.indexOf('let t0=t;var k=0;'), iLoop = t.indexOf('for(var iter=0;iter<4096;iter++){'), iTop = t.indexOf(T), iBreak = t.indexOf('if(t>endT||acc.a>ACC_STOP){break;}'), iJump = t.indexOf(J), iHit = t.indexOf('if(hitIdx>=0){');
    expect(iFace).toBeGreaterThan(0); expect(iFaceT).toBeGreaterThan(iFace); expect(iT0).toBeGreaterThan(iFaceT); // faceEnd / faceT are made from the ray's own start, before the grid is set up
    expect(iK).toBe(iT0); expect(iLoop).toBeGreaterThan(iK); expect(iTop).toBeGreaterThan(iLoop); expect(iBreak).toBe(iTop + T.length + 2); // the break test reads the t just made
    expect(iJump).toBeGreaterThan(iBreak); expect(iHit).toBeGreaterThan(iJump);
    // inside the loop t is never assigned: no t += / t = (the declaration is the only place), every advance is on k
    const loop = t.slice(iLoop, iHit).replace(T, '').replace(/\/\/[^\n]*/g, ''); // without the comments
    expect(loop).not.toMatch(/(^|[^A-Za-z0-9_])t\s*(\+|-|\*)?=[^=]/); expect(loop).not.toContain('t+=stp'); expect(loop).not.toContain('t=nextJ');
    expect(count(loop, 'k++;')).toBe(b.events ? 3 : 2); // the creep step, the normal step (and the cut face's step with the section code)
    expect(count(loop, 'k+=m;')).toBe(1); expect(count(loop, 'k++;continue;')).toBe(b.events ? 2 : 1);
    expect(count(loop, 'previousT=t;k++;')).toBe(b.events ? 3 : 2);
    expect(t).toContain('let jkA=max(1.0/max(0.5*length(dir*u.texDims/u.halfExt),1.0e-6),u.voxelMin);');
    expect(() => new WgslReflect(t)).not.toThrow();
  });
  it.each(VARIANTS)('%o: the breakdown variants (the shadow passes, the counting twin) march on the same grid', v => {
    const t = volumeWgsl(v);
    expect(count(t, '  let t=t0+f32(k)*stp;\n')).toBe(1); expect(count(t, 'k+=m;')).toBe(1); expect(t).not.toContain('t+=stp'); expect(t).not.toContain('t=nextJ');
    if (v.counters) { expect(t).toContain('jumpLen+=nextJ-t;gJumps+=1u;'); expect(t).toContain('gCreep+=1u;prevValid=true;prevSkip=true;lastIndex=-1;'); expect(t).toContain('iters++;gIters+=1u;'); }
    expect(() => new WgslReflect(t)).not.toThrow();
  });
});
