// The pre-pass (tile cone) of the WGSL volume pass (docs/vr-wgsl-core.js PROXY / proxyWgsl): a CPU model of it and of the march it shortens, run on synthetic grids and cameras, plus ties from the model to the shader text.
// Model: the march of one ray (the WGSL loop: jumps by the distance field with the forced one-step jump, creep skip on / off, the entry-face override faceT / onFace, the surface search after the loop, anisotropic dims,
// a camera inside the box, t = t0 + k * stp from one expression), the grid made with the real docs/distance-field.js / docs/vr-skip-occupancy.js (alpha = the distance field of the shown slots), and the pre-pass cone of every 8 x 8 tile
// with the shader's constants (PROXY) and its coefficients (chord of the corner directions, class margin). For every ray of every camera the march from k = 0 is compared with the march from the pre-pass start (k = floor((tA - t0) / stp) - 1)
// or, for tA past the ray's end, no march: hit bracket (idx, lo, hi, f0, f1), hitNb, hitIso, the searched hi and onFace, or no hit, must be the same on every ray of every condition.
// Negative controls that are not conservative (a start 5 grid points later than allowed, the field over-trusted by 3 voxels, a cone of angle 0 with no margin) must show mismatches, or the comparison would be blind.
// The conditions: step 1.5 / 1.0 / 0.7 voxel, useSkip 0 / 1, jumps off, tile 16, GPU-like 8-bit filter weights, a main ray jittered against the pre-pass's, no specks, 2 x pixels per voxel, a wide field of view, a start one grid point later,
// and steps of 4 and 6 voxels (forced one-step jumps that land inside).
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { euclideanDistanceBytes, combineClassificationDistance } from '../../docs/distance-field.js';
import { buildSkipOccupancy, skipGrid } from '../../docs/vr-skip-occupancy.js';
import { volumeWgsl, proxyWgsl, proxyDiffWgsl, PROXY, PROXY_FIELDS, PROXY_BINDINGS, PROXY_DIFF_BINDINGS, proxyPixelDir, uniformLayout } from '../../docs/vr-wgsl-core.js';
import { regionClip, regionMvp } from '../../docs/vr-wgpu.js';

const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEG_OFF = 1.0e9;
const f32 = Math.fround;
const LOG = [], say = s => LOG.push(s);

// ---------- the grid: anisotropic dims and voxel sizes; slot 0 = channel 0, slot 1 = channel 1 ----------
function makeGrid(rand, { dims, halfExt, nBlobs, border, speck = 0.0003 }) {
  const [W, H, D] = dims, n = W * H * D;
  const bl = [];
  for (let i = 0; i < nBlobs; i++) { const rs = i < 2 ? 4 + rand() * 9 : 1 + rand() * 4; bl.push({ c: [8 + rand() * (W - 16), 8 + rand() * (H - 16), 8 + rand() * (D - 16)], r: [rs * (0.7 + rand() * 0.6), rs * (0.7 + rand() * 0.6), rs * (0.7 + rand() * 0.6)], ch: i % 2 }); }
  if (border) { // blobs cut by a box face: rays that enter the box inside a segment (the faceT override, onFace)
    bl.push({ c: [-1, H / 2, D / 2], r: [5, 6, 6], ch: 0 });
    bl.push({ c: [W / 2, H + 1, D / 3], r: [6, 4, 6], ch: 1 });
  }
  const cls = new Uint8Array(n * 2);
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (z * H + y) * W + x, sd = [1e9, 1e9];
    for (const b of bl) { const q = Math.hypot((x - b.c[0]) / b.r[0], (y - b.c[1]) / b.r[1], (z - b.c[2]) / b.r[2]); const d = (q - 1) * Math.min(...b.r); sd[b.ch] = Math.min(sd[b.ch], d); }
    for (let ch = 0; ch < 2; ch++) cls[i * 2 + ch] = Math.max(0, Math.min(255, Math.round(127.5 - sd[ch] * 40)));
    if (rand() < speck) cls[i * 2 + (rand() < 0.5 ? 0 : 1)] = 140; // a few isolated inside voxels (specks)
  }
  // the alpha: the real distance bytes per channel (euclideanDistanceBytes), combined as the VR view does (alpha = min over the shown slots)
  const dist = new Uint8Array(n * 2), inside = new Uint8Array(n);
  for (let ch = 0; ch < 2; ch++) { for (let i = 0; i < n; i++) inside[i] = cls[i * 2 + ch] >= 128 ? 1 : 0; const d = euclideanDistanceBytes(inside, dims); for (let i = 0; i < n; i++) dist[i * 2 + ch] = d[i]; }
  const data = combineClassificationDistance({ data: cls, C: 2, chan: [0, 1, -1, -1] }, { data: dist, C: 2 }, 0b11);
  const bits = buildSkipOccupancy({ data, dims, chan: [0, 1, -1, -1], mask: 0b11 });
  const vs = halfExt.map((h, k) => 2 * h / dims[k]);
  return { data, bits, dims, halfExt, vs, voxelMin: Math.min(...vs) };
}

// trilinear fetch (rgba 0..1) at a texture coordinate, clamp to edge; q8 = filter weights rounded to 1/256 (a GPU's fixed-point weights)
function fetchAt(g, tc, q8) {
  const N = g.dims, r = [0, 0, 0, 0];
  const p = tc.map((v, k) => Math.min(Math.max(v, 0), 0.999999) * N[k] - 0.5), f = p.map(Math.floor);
  let w = p.map((v, k) => v - f[k]); if (q8) w = w.map(v => Math.round(v * 256) / 256);
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

// ---------- the march of one ray (the WGSL loop of vr-wgsl-core.js, events off, hitSimple off, refine 1, editMask 0) ----------
// o = { stp (object units), useSkip, jumpOn, kStart, tMode: 'idx' (t = t0 + k*stp) | 'acc' (t += stp, t = nextJ: the text of), f32: emulate f32 rounding of t, q8 }
function march(g, ray, o) {
  const { stp, q8 } = o, R = o.f32 ? f32 : (x => x);
  const [bx, by] = hitBox(g, ray.o, ray.d);
  if (bx > by) return { discard: true };
  const t0 = R(Math.max(bx, 0)), endT = by;
  const faceEnd = (bx > 0 && t0 <= bx + 1e-4) ? bx + stp : -1, faceT = faceEnd >= 0 ? t0 : -1;
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
  const T = k => R(t0 + R(k * stp)); // the one expression of t (tMode idx)
  let k = o.kStart || 0, t = o.tMode === 'acc' ? t0 : T(k);
  let previousT = t, lastIndex = -1, prevValid = false, prevF = 0, prevSkip = false, chk = false, hit = null, iters = 0, lastJumpM = 0, creep = 0; const near = [0, 0, 0];
  for (let iter = 0; iter < 4096; iter++) {
    if (t > endT) break;
    iters++;
    if (o.useSkip && chk) { const b = bitAt(t); if (b) { creep++; prevValid = true; prevSkip = true; lastIndex = -1; previousT = t; k++; t = o.tMode === 'acc' ? R(t + stp) : T(k); lastJumpM = 0; continue; } }
    const q = fetchAt(g, pos(t), q8); let dd = q[3] * 255;
    if (dd >= 2.7 && t <= faceT) { if (Math.max(...fOf(q)) >= 0) dd = 0; }
    [4, 8, 16].forEach((R, i) => { if (near[i] === 0 && dd <= R) near[i] = iters; });
    if (!o.jumpOn) dd = 0;
    chk = dd < 2.7;
    if (dd >= 2.7) {
      const m = Math.max(1, Math.floor((dd - 1.8) * jkA / stp));
      const nextJ = o.tMode === 'acc' ? R(t + R(stp * m)) : T(k + m);
      previousT = R(nextJ - stp * 0.05); prevValid = false; k += m; t = nextJ; lastJumpM = m; continue;
    }
    const f = fOf(q); let idx = -1, curF = -1;
    for (let s = 0; s < 4; s++) if (f[s] >= 0) { idx = s; curF = f[s]; break; }
    if (idx !== lastIndex) {
      if (idx >= 0) {
        if (prevSkip && prevValid) prevF = Math.max(...fOf(fetchAt(g, pos(previousT), q8)));
        hit = { idx, lo: previousT, hi: t, f0: prevF, f1: curF, nb: prevValid ? 6 : 2, iso: prevValid && prevF < 0, k, viaJump: lastJumpM, first: iters === 1 };
        lastIndex = idx; break;
      }
      lastIndex = idx;
    }
    prevSkip = false; prevValid = true; prevF = idx >= 0 ? curF : Math.max(...f);
    previousT = t; k++; t = o.tMode === 'acc' ? R(t + stp) : T(k); lastJumpM = 0;
  }
  let fin = null;
  if (hit) { // the surface search (vr-wgsl-core.js after the loop): secant x2 + bisection when iso, else hitNb bisections
    let lo = hit.lo, hi = hit.hi, f0 = hit.f0, f1 = hit.f1; const idx = hit.idx;
    const insideAt = (qm) => { if (!(qm[idx] >= 0.5)) return false; for (let s = 0; s < idx; s++) if (qm[s] >= 0.5) return false; return true; };
    if (hit.iso) {
      for (let r = 0; r < 3; r++) {
        let mid = (lo + hi) * 0.5; if (r < 2 && Math.abs(f1 - f0) > 1e-6) mid = Math.min(Math.max(lo + (hi - lo) * (-f0 / (f1 - f0)), lo + (hi - lo) * 0.02), hi - (hi - lo) * 0.02);
        const qm = fetchAt(g, pos(mid), q8), fmv = qm[idx] - 0.5; let inside = fmv >= 0; if (!insideAt(qm)) inside = false;
        if (inside) { hi = mid; f1 = fmv; } else { lo = mid; f0 = fmv; }
      }
    } else {
      for (let r = 0; r < 6; r++) { if (r >= hit.nb) break; const mid = (lo + hi) * 0.5, qm = fetchAt(g, pos(mid), q8); if (insideAt(qm)) hi = mid; else lo = mid; }
    }
    fin = { idx, hi, onFace: hi <= faceEnd };
  }
  return { discard: false, t0, endT, hit, fin, iters, creep, near };
}

// ---------- the pre-pass: one cone per tile (the rays through the tile's pixel centres), marched from the eye ----------
// Certifies tA: every sample of every ray of the tile at a distance s < tA from the eye, inside the box, is outside every shown segment.
// p = { tile, epsTheta, ddMargin (voxels subtracted from dd: the jump's 1.8), slack (voxels), hMin (voxels), maxIt, q8 }
function coneTile(g, cam, tx, ty, p) {
  const T = p.tile, x0 = tx * T, y0 = ty * T, x1 = Math.min(cam.W, x0 + T) - 1, y1 = Math.min(cam.H, y0 + T) - 1;
  const cs = [cam.dirOf(x0, y0), cam.dirOf(x1, y0), cam.dirOf(x0, y1), cam.dirOf(x1, y1)];
  let a = [0, 0, 0]; for (const d of cs) for (let k = 0; k < 3; k++) a[k] += d[k];
  const la = Math.hypot(...a); a = a.map(v => v / la);
  let chord = 0; for (const d of cs) chord = Math.max(chord, Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2])); // the shader's coefficient: the largest |corner direction - axis| + epsTheta
  const c = p.zeroAngle ? 0 : chord + p.epsTheta, vm = g.voxelMin, he = g.halfExt, o = cam.o;
  const far = Math.hypot(...o) + Math.hypot(...he); // no point of the box is farther from the eye
  let s = 0, it = 0;
  for (; it < p.maxIt; it++) {
    if (s > far) return { tA: Infinity, it };
    const x = o.map((v, k) => v + a[k] * s), xc = x.map((v, k) => Math.min(Math.max(v, -he[k]), he[k]));
    const dBox = Math.hypot(...x.map((v, k) => v - xc[k])), rC = s * c;
    let h = dBox - p.slack * vm - rC; // outside the box: no sample there (the march samples only between its own box entry and exit)
    const q = fetchAt(g, texCoord(g, xc), p.q8);
    if (Math.max(...fOf(q)) < -p.classMargin) { // xc is outside every shown segment: the ball of radius (dd - margin) voxels (x voxelMin: anisotropy) around it is outside too
      const rho = (q[3] * 255 - p.ddMargin - p.slack) * vm;
      h = Math.max(h, rho - dBox - rC);
    }
    if (h < p.hMin * vm) return { tA: s, it };
    s += h;
  }
  return { tA: s, it };
}

function makeCam(rand, g, { W, H, fpx, inside }) {
  const he = g.halfExt;
  let o;
  if (inside) o = he.map(h => (rand() * 1.2 - 0.6) * h);
  else { const a = rand() * 2 * Math.PI, e = Math.acos(2 * rand() - 1), R = Math.hypot(...he) * (1.15 + rand() * 1.5); o = [R * Math.sin(e) * Math.cos(a), R * Math.sin(e) * Math.sin(a), R * Math.cos(e)]; }
  const tgt = he.map(h => (rand() - 0.5) * h);
  let fw = tgt.map((v, k) => v - o[k]); const lf = Math.hypot(...fw); fw = fw.map(v => v / lf);
  let up = Math.abs(fw[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let rt = cr(fw, up); const lr = Math.hypot(...rt); rt = rt.map(v => v / lr); up = cr(rt, fw);
  const dirOf = (px, py) => { const u = (px + 0.5 - W / 2) / fpx, v = -(py + 0.5 - H / 2) / fpx, d = [0, 1, 2].map(k => fw[k] + u * rt[k] + v * up[k]), l = Math.hypot(...d); return d.map(x => x / l); };
  return { o, W, H, dirOf };
}

const sameHit = (a, b) => {
  if (a.discard !== b.discard) return false;
  if (a.discard) return true;
  if (!a.hit !== !b.hit) return false;
  if (!a.hit) return true;
  const h = a.hit, i = b.hit;
  return h.idx === i.idx && h.lo === i.lo && h.hi === i.hi && h.f0 === i.f0 && h.f1 === i.f1 && h.nb === i.nb && h.iso === i.iso && a.fin.hi === b.fin.hi && a.fin.onFace === b.fin.onFace && a.fin.idx === b.fin.idx;
};

// one comparison run: every pixel of every camera, the march from k = 0 against the march from the pre-pass start (or none when the tile is certified empty)
function run(label, { grids, cams, stepVox, useSkip, jumpOn = true, tile = PROXY.tile, q8 = false, jitter = 0, cone = {}, startShift = 0, report = true }) {
  const cp = { tile, epsTheta: PROXY.epsTheta, ddMargin: PROXY.ddMargin, slack: PROXY.slack, hMin: PROXY.hMin, maxIt: PROXY.maxIt, classMargin: PROXY.classMargin, q8, ...cone };
  const st = { rays: 0, mism: 0, hits: 0, passes: 0, emptyTile: 0, emptyRays: 0, stepsA: 0, stepsB: 0, viaForced: 0, viaJumpHits: 0, faceHits: 0, isoHits: 0, nb2: 0, startedLater: 0, coneIt: 0, tiles: 0, firstMism: null, gap: [0, 0, 0, 0], viaForcedLater: 0, creep: 0, agg: { hit: { n: 0, steps: 0, saved: 0, nr: [0, 0, 0], sr: [0, 0, 0], nevSteps: [0, 0, 0] }, pass: { n: 0, steps: 0, saved: 0, nr: [0, 0, 0], sr: [0, 0, 0], nevSteps: [0, 0, 0] } } };
  const jr = rng(99);
  for (const g of grids) for (const cam of cams(g)) {
    const stp = stepVox * g.voxelMin;
    for (let ty = 0; ty * tile < cam.H; ty++) for (let tx = 0; tx * tile < cam.W; tx++) {
      const pr = coneTile(g, cam, tx, ty, cp); st.tiles++; st.coneIt += pr.it;
      let tileEmpty = true;
      for (let py = ty * tile; py < Math.min(cam.H, (ty + 1) * tile); py++) for (let px = tx * tile; px < Math.min(cam.W, (tx + 1) * tile); px++) {
        let d = cam.dirOf(px, py);
        if (jitter) { d = d.map(v => v + (jr() - 0.5) * jitter); const l = Math.hypot(...d); d = d.map(v => v / l); } // the main pass's ray differs slightly from the pre-pass's (float)
        const ray = { o: cam.o, d };
        const base = { stp, useSkip, jumpOn, q8, tMode: 'idx' };
        const A = march(g, ray, { ...base, kStart: 0 });
        let B;
        if (A.discard) B = A;
        else if (pr.tA > A.endT) { B = { discard: false, hit: null, fin: null, iters: 0 }; st.emptyRays++; } // certified: nothing to hit on this ray, the loop is not run
        else { const K = Math.max(0, Math.floor((pr.tA - A.t0) / stp) - 1 + startShift); if (K > 0) { st.startedLater++; if (A.hit) { st.gap[Math.min(3, Math.max(0, A.hit.k - K))]++; if (A.hit.viaJump === 1) st.viaForcedLater++; } } B = march(g, ray, { ...base, kStart: K }); }
        if (A.discard) continue;
        st.rays++; st.stepsA += A.iters; st.stepsB += B.iters; st.creep += A.creep;
        { const ag = st.agg[A.hit ? 'hit' : 'pass']; ag.n++; ag.steps += A.iters; ag.saved += A.iters - B.iters; A.near.forEach((v, i) => { if (v > 0) { ag.nr[i]++; ag.sr[i] += v; } else ag.nevSteps[i] += A.iters; }); }
                if (A.hit) { st.hits++; tileEmpty = false; if (A.hit.viaJump === 1) st.viaForced++; if (A.hit.viaJump > 1) st.viaJumpHits++; if (A.fin.onFace) st.faceHits++; if (A.hit.iso) st.isoHits++; if (A.hit.nb === 2) st.nb2++; } else st.passes++;
        if (!sameHit(A, B)) { st.mism++; if (!st.firstMism) st.firstMism = { px, py, a: A.hit, b: B.hit, tA: pr.tA, t0: A.t0 }; }
      }
      if (pr.tA === Infinity) st.emptyTile++;
    }
  }
  if (report) say(`${label.padEnd(44)} rays ${st.rays} hits ${st.hits} (iso ${st.isoHits}, nb2 ${st.nb2}, via forced 1-jump ${st.viaForced}, via jump>=2 ${st.viaJumpHits}, on face ${st.faceHits}) passes ${st.passes} | mismatches ${st.mism} | steps ${st.stepsA} -> ${st.stepsB} (${(100 * (1 - st.stepsB / st.stepsA)).toFixed(1)} % fewer) | empty tiles ${st.emptyTile}/${st.tiles}, rays skipped ${st.emptyRays}, started later ${st.startedLater} | cone steps/tile ${(st.coneIt / st.tiles).toFixed(1)} | hits started later, by k* - K: <=0 ${st.gap[0]}, 1 ${st.gap[1]}, 2 ${st.gap[2]}, >=3 ${st.gap[3]}; of them arrived by a forced 1-jump ${st.viaForcedLater}`);
  // the 752 approach numbers of this run and E_R by the design's formula (never-rays' steps replaced by the pass mean S_p), and the exact E_R (their own steps); eta = the actual reduction / E_R
  const H = st.agg.hit, P = st.agg.pass, tot = H.steps + P.steps, h = H.n / st.rays, p = P.n / st.rays, Sh = H.steps / Math.max(1, H.n), Sp = P.steps / Math.max(1, P.n);
  st.E = [0, 1, 2].map(i => {
    const ShR = H.nr[i] ? H.sr[i] / H.nr[i] : 0, SpR = P.nr[i] ? P.sr[i] / P.nr[i] : 0, nev = P.n ? (P.n - P.nr[i]) / P.n : 0;
    const hn = H.n ? H.nr[i] / H.n : 0; // hit rays always reach R in practice
    const formula = (h * hn * (ShR - 1) + p * ((1 - nev) * (SpR - 1) + nev * Sp)) / (h * Sh + p * Sp);
    const exact = ((H.sr[i] - H.nr[i]) + H.nevSteps[i] + (P.sr[i] - P.nr[i]) + P.nevSteps[i]) / tot;
    return { R: [4, 8, 16][i], formula, exact, never: nev };
  });
  st.actual = 1 - st.stepsB / st.stepsA;
  if (report) say('    approach: ' + st.E.map(e => `R=${e.R} E(formula) ${e.formula.toFixed(3)} E(exact) ${e.exact.toFixed(3)} pass never ${(100 * e.never).toFixed(0)}% eta ${(st.actual / e.formula).toFixed(2)}`).join(' | ') + ` | creep steps ${st.creep}`);
  return st;
}


function runAll() {
  // ---------- the scenes ----------
  const rand = rng(20261119);
  const grids = [];
  const shapes = [{ dims: [80, 64, 96], halfExt: [1.0, 0.8, 1.5] }, { dims: [96, 96, 48], halfExt: [1.0, 1.0, 0.75] }, { dims: [72, 72, 72], halfExt: [1, 1, 1] }];
  for (let i = 0; i < 6; i++) grids.push(makeGrid(rand, { ...shapes[i % 3], nBlobs: 3 + i, border: i % 2 === 0 }));
  const gridsClean = []; { const r2 = rng(424242); for (let i = 0; i < 6; i++) gridsClean.push(makeGrid(r2, { ...shapes[i % 3], nBlobs: 3 + i, border: i % 2 === 0, speck: 0 })); }
  const camsFor = (n, inside, opt = {}) => { const camRand = rng(7); const memo = new Map(); return g => { if (!memo.has(g)) { const out = []; for (let i = 0; i < n; i++) out.push(makeCam(camRand, g, { W: 64, H: 64, fpx: opt.fpx || 240, inside: inside && i === 0 })); memo.set(g, out); } return memo.get(g); }; };

  const results = [];
  say('== positive: the march from the pre-pass start gives the same ray result (hit bracket, prevF, hitNb, hitIso, final hi, onFace; or no hit) ==');
  for (const [lab, o] of [
    ['step 1.5, useSkip 0 (752 display)', { stepVox: 1.5, useSkip: false }],
    ['step 1.5, useSkip 1', { stepVox: 1.5, useSkip: true }],
    ['step 1.0, useSkip 0', { stepVox: 1.0, useSkip: false }],
    ['step 0.7, useSkip 1', { stepVox: 0.7, useSkip: true }],
    ['step 1.5, jumps off', { stepVox: 1.5, useSkip: false, jumpOn: false }],
    ['step 1.5, tile 16', { stepVox: 1.5, useSkip: false, tile: 16 }],
    ['step 1.5, GPU-like 8-bit filter weights', { stepVox: 1.5, useSkip: false, q8: true }],
    ['step 1.5, main ray jitter 1e-5 (float)', { stepVox: 1.5, useSkip: false, jitter: 1e-5 }],
    ['step 1.5, no specks', { stepVox: 1.5, useSkip: false, grids: gridsClean }],
    ['step 1.5, no specks, fpx 480 (2x pixels per voxel)', { stepVox: 1.5, useSkip: false, grids: gridsClean, cams: camsFor(3, true, { fpx: 480 }) }],
    ['step 1.5, wider fov (fpx 80)', { stepVox: 1.5, useSkip: false, cams: camsFor(3, true, { fpx: 80 }) }],
    ['no step back (K = floor((tA-t0)/stp))', { stepVox: 1.5, useSkip: false, startShift: 1 }],
    ['step 4.0 (stress: forced 1-jumps land inside)', { stepVox: 4.0, useSkip: false }],
    ['step 6.0 (stress: forced 1-jumps land inside)', { stepVox: 6.0, useSkip: true }],
  ]) results.push({ lab, pos: true, st: run(lab, { cams: o.cams || camsFor(3, true), ...o, grids: o.grids || grids }) });

  say('\n== information: how much room the conservative start leaves (not a control: it may or may not differ) ==');
  results.push({ lab: 'start 3 later', info: true, st: run('start 3 grid steps later than allowed', { grids, cams: camsFor(3, true), stepVox: 1.5, useSkip: false, startShift: 3 }) });

  say('\n== negative controls: a pre-pass or start that is not conservative must be caught ==');
  for (const [lab, o] of [
    ['start 5 grid steps later than allowed', { stepVox: 1.5, useSkip: false, startShift: 5 }],
    ['field over-trusted by 3 voxels (ddMargin -3)', { stepVox: 1.5, useSkip: false, cone: { ddMargin: -3, slack: 0 } }],
    ['cone angle 0 and no margin', { stepVox: 1.5, useSkip: false, cone: { zeroAngle: true, ddMargin: 0, slack: 0 } }],
  ]) results.push({ lab, pos: false, st: run(lab, { grids, cams: camsFor(3, true), ...o }) });


  return results;
}

describe('the pre-pass: CPU model, march from the pre-pass start against the march from k = 0', () => {
  let results = [];
  beforeAll(() => { results = runAll(); }, 400_000);
  it('every positive condition is identical on every ray (0 mismatches), and there are 14 of them', () => {
    const pos = results.filter(r => r.pos);
    expect(pos).toHaveLength(14);
    for (const r of pos) expect(r.st.mism, r.lab + (r.st.firstMism ? ' ' + JSON.stringify(r.st.firstMism) : '')).toBe(0);
  });
  it('the negative controls are caught: a start 5 grid points late, the field over-trusted by 3 voxels, a cone of angle 0 with no margin each show mismatches', () => {
    const neg = results.filter(r => r.pos === false);
    expect(neg).toHaveLength(3);
    for (const r of neg) expect(r.st.mism, r.lab).toBeGreaterThan(0);
  });
  it('the cases that make the comparison mean something were exercised: hits, passes, forced one-step arrivals, face hits, iso hits, creep steps (useSkip 1), later starts and skipped rays', () => {
    const pos = results.filter(r => r.pos);
    expect(pos.every(r => r.st.hits > 300 && r.st.passes > 100)).toBe(true);
    expect(pos.some(r => r.st.viaForcedLater > 0)).toBe(true);
    expect(pos.some(r => r.st.faceHits > 0)).toBe(true);
    expect(pos.some(r => r.st.isoHits > 0)).toBe(true);
    expect(pos.filter(r => /useSkip 1/.test(r.lab)).every(r => r.st.creep > 0)).toBe(true);
    expect(pos.some(r => r.st.startedLater > 1000)).toBe(true);
    expect(pos.some(r => r.st.emptyRays > 1000)).toBe(true);
  });
  it('the start after the pre-pass is not a no-op: in the 1.5 voxel condition a good part of the steps is saved', () => {
    const r = results.find(x => x.lab === 'step 1.5, useSkip 0 (752 display)');
    expect(r.st.actual).toBeGreaterThan(0.05);
  });
});

// ---- the shader text is the model ----
describe('the pre-pass shader text is tied to the model and to the volume pass', () => {
  const t3 = proxyWgsl({ cls4: false }), t4 = proxyWgsl({ cls4: true }), vol = volumeWgsl({ events: false }), volE = volumeWgsl({ events: true });
  it('the constants of the model are the shader\'s (one table PROXY)', () => {
    expect(PROXY).toEqual({ tile: 8, epsTheta: 1.0e-4, ddMargin: 1.8, slack: 0.05, hMin: 0.25, maxIt: 128, classMargin: 0.002, empty: 3.0e38 });
    for (const t of [t3, t4]) {
      expect(t).toContain('@workgroup_size(8,8)'); expect(t).toContain('for(var it=0;it<128;it++){');
      expect(t).toContain('if(s>far){return 3.0e+38;}'); expect(t).toContain('let far=length(o)+length(he);');
      expect(t).toContain('var hh=dBox-0.05*vm-rC;'); expect(t).toContain('let rho=(dd-1.8-0.05)*vm;hh=max(hh,rho-dBox-rC);'); expect(t).toContain('if(hh<0.25*vm){return s;}\n  s+=hh;');
      expect(t).toContain('let ch=max(max(length(d00-a),length(d10-a)),max(length(d01-a),length(d11-a)))+0.0001;');
      expect(t).toContain('q[c]>=0.5-0.002');
    }
  });
  it('the class and the distance are read as the march reads them: the distance byte of clsTex before cls4 overwrites alpha, the same texCoord (the y flip) and clamp, the enabled-slot rule (clsChan >= 0 and segA.w > 0.5, passed as segOn)', () => {
    expect(vol).toContain('fn texCoord(p:vec3<f32>)->vec3<f32>{return vec3<f32>(p.x*gInv.x+0.5,0.5-p.y*gInv.y,p.z*gInv.z+0.5);}');
    for (const t of [t3, t4]) expect(t).toContain('fn texCoord(q:vec3<f32>)->vec3<f32>{let g=0.5/p.halfExt;return vec3<f32>(q.x*g.x+0.5,0.5-q.y*g.y,q.z*g.z+0.5);}');
    expect(vol).toContain('gInv=0.5/u.halfExt;'); // the pass's gInv
    expect(vol).toContain('fn cl(tc:vec3<f32>)->vec3<f32>{return clamp(tc,vec3<f32>(0.0),vec3<f32>(0.999999));}');
    for (const t of [t3, t4]) expect(t).toContain('fn cl(tc:vec3<f32>)->vec3<f32>{return clamp(tc,vec3<f32>(0.0),vec3<f32>(0.999999));}');
    expect(t3).not.toContain('cls4Tex,smp'); expect(t4).toContain('q.a=textureSampleLevel(cls4Tex,smp,cl(texCoord(xc)),0.0).r;');
    expect(t4.indexOf('let dd=q.a*255.0;')).toBeGreaterThan(0); expect(t4.indexOf('let dd=q.a*255.0;')).toBeLessThan(t4.indexOf('q.a=textureSampleLevel(cls4Tex'));
    expect(t3).toContain('let c=p.clsChan[s];if(c>=0&&p.segOn[s]!=0&&q[c]>=0.5-0.002){return true;}');
    expect(vol).toContain('if(c>=0&&u.segA[s].w>0.5&&q[c]>=0.5){return s;}'); // the march's own rule, which segOn is made from (vr-wgpu.js encodeProxy: segA.w > 0.5)
  });
  it('the pixel to direction: the pixel centre (px + 0.5, py + 0.5) of a w x h region, y down, the point at NDC z 0.5 through the inverse of the region mvp, minus the eye', () => {
    for (const t of [t3, t4]) {
      expect(t).toContain('let nx=(px+0.5)/w*2.0-1.0;let ny=1.0-(py+0.5)/h*2.0;');
      expect(t).toContain('let c=m*vec4<f32>(nx,ny,0.5,1.0);'); expect(t).toContain('return normalize(c.xyz/c.w-eyeOrg(e));');
      expect(t).toContain('let x0=f32(lx*8);let y0=f32(ty*8);let x1=f32(min(w,lx*8+8)-1);let y1=f32(min(h,ty*8+8)-1);'); // the tile's corner pixel centres, the last tile inside the region only
    }
  });
  it('the volume pass takes the start from the tile of its own pixel: tile = (pixel - proxyOrg) / 8, empty when tA > endT, else k = max(0, floor((tA - t0) / stp) - 1); t0, faceT and faceEnd are made before and never assigned after; the section variant has none of it', () => {
    expect(vol).toContain('let tA=textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/8,0).r;');
    expect(vol).toContain('if(tA>endT){emptyRay=true;}else if(tA>t0){k=max(0,i32(floor((tA-t0)/stp))-1);}');
    expect(vol).toContain('for(var iter=select(0,4096,emptyRay);iter<4096;iter++){');
    expect(vol.indexOf('let faceEnd=')).toBeLessThan(vol.indexOf('let tA=')); expect(vol.indexOf('let faceT=')).toBeLessThan(vol.indexOf('let tA='));
    expect(vol.split('faceT=').length - 1).toBe(1); expect(vol.split('faceEnd=').length - 1).toBe(1); expect(vol.split('t0=').length - 1).toBe(1);
    expect(vol.indexOf('if(u.diag==1)')).toBeLessThan(vol.indexOf('let tA=')); // the box view returns before it
    expect(volE).not.toContain('proxyTex,('); expect(volE).not.toContain('emptyRay'); expect(volE).toContain('for(var iter=0;iter<4096;iter++){');
  });
  it('the compute text and the uniform struct: wgsl_reflect finds the entry, the struct members are at the packer\'s offsets, the bindings are the host\'s', () => {
    for (const t of [t3, t4]) {
      expect(t).not.toMatch(/undefined|NaN|\$\{/);
      const r = new WgslReflect(t), u = r.uniforms.find(x => x.name === 'p'), L = uniformLayout(PROXY_FIELDS);
      expect(r.entry.compute.map(e => e.name)).toEqual(['main']);
      expect(u.members.map(m => m.name)).toEqual(PROXY_FIELDS.map(f => f[0]));
      for (const m of u.members) expect(L.fields.find(f => f.name === m.name).offset, m.name).toBe(m.offset);
      expect(L.byteSize).toBe(Math.ceil(u.size / 16) * 16);
      const got = Object.fromEntries(r.getBindGroups()[0].map(b => [b.name || b.resource?.name, b.binding]));
      expect(got).toMatchObject({ p: PROXY_BINDINGS.params, clsTex: PROXY_BINDINGS.cls, cls4Tex: PROXY_BINDINGS.cls4, smp: PROXY_BINDINGS.sampler, tilesOut: PROXY_BINDINGS.out });
    }
    const d = new WgslReflect(proxyDiffWgsl());
    expect(d.entry.compute.map(e => e.name)).toEqual(['main']);
    const got = Object.fromEntries(d.getBindGroups()[0].map(b => [b.name || b.resource?.name, b.binding]));
    expect(got).toMatchObject({ cA: PROXY_DIFF_BINDINGS.colorA, dA: PROXY_DIFF_BINDINGS.depthA, cB: PROXY_DIFF_BINDINGS.colorB, dB: PROXY_DIFF_BINDINGS.depthB, cnt: PROXY_DIFF_BINDINGS.count });
  });
});

// ---- the pixel to direction maths on real matrices ----
describe('proxyPixelDir: the direction of the ray through a pixel centre, on the region mvp the volume pass is drawn with', () => {
  const project = (m, p) => { const e = m.elements, v = [p[0], p[1], p[2], 1], c = [0, 1, 2, 3].map(i => e[i] * v[0] + e[4 + i] * v[1] + e[8 + i] * v[2] + e[12 + i] * v[3]); return [c[0] / c[3], c[1] / c[3]]; };
  const cases = [['GL clip depth', THREE.WebGLCoordinateSystem], ['WebGPU clip depth', THREE.WebGPUCoordinateSystem]];
  it.each(cases)('%s: regionMvp * (eye + dir * s) lands on the pixel centre (y down) for the tile corners of a region, at several distances', (_n, cs) => {
    const cam = new THREE.PerspectiveCamera(70, 1.25, 0.05, 40); cam.coordinateSystem = cs; cam.position.set(0.3, -0.2, 2.4); cam.lookAt(0.1, 0.05, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const model = new THREE.Matrix4().compose(new THREE.Vector3(0.1, 0.05, -0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 0.2)), new THREE.Vector3(0.9, 0.9, 0.9));
    const mvp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(model);
    const Wu = 640, Hu = 512, r = { x0: 100, y0: 60, x1: 530, y1: 470 }, rw = r.x1 - r.x0, rh = r.y1 - r.y0;
    const m2 = regionMvp(new THREE.Matrix4(), mvp, regionClip(r, Wu, Hu)); // the pass's mvp: the region fills the viewport
    const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(model).invert());
    const inv = new THREE.Matrix4().copy(m2).invert().elements;
    for (const [px, py] of [[0, 0], [rw - 1, 0], [0, rh - 1], [rw - 1, rh - 1], [7, 7], [200, 123], [rw - 3, 4]]) {
      const d = proxyPixelDir(inv, eye.toArray(), px, py, rw, rh);
      for (const s of [0.5, 2, 3.7]) {
        const [nx, ny] = project(m2, [eye.x + d[0] * s, eye.y + d[1] * s, eye.z + d[2] * s]);
        expect((nx + 1) / 2 * rw - 0.5, 'x ' + px + ',' + py + ' s ' + s).toBeCloseTo(px, 2);
        expect((1 - ny) / 2 * rh - 0.5, 'y ' + px + ',' + py + ' s ' + s).toBeCloseTo(py, 2);
      }
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    }
  });
  it('a pixel to the right and below has a direction that moves the same way as in the image (x right, y down)', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 20); cam.position.set(0, 0, 3); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const mvp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), inv = new THREE.Matrix4().copy(mvp).invert().elements;
    const a = proxyPixelDir(inv, [0, 0, 3], 10, 10, 64, 64), b = proxyPixelDir(inv, [0, 0, 3], 50, 50, 64, 64);
    expect(b[0]).toBeGreaterThan(a[0]); expect(b[1]).toBeLessThan(a[1]); // +x = right, +y = up in the world, pixel y grows downward
  });
});
