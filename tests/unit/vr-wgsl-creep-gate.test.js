// The creep gate of the WGSL march (docs/vr-wgsl-core.js): the skipTex lookup is made only while `chk` (the previous sample was read with dd < 2.7, or crept); not at the ray start, not right after a jump.
// A CPU model of the march loop (the skip, the read, the jump, the hit bracket, the lazy prevF) is run on a synthetic classification grid with the skip bits of vr-skip-occupancy.js, once with the check at every
// sample (the text before the gate) and once gated: a ray must end with the same hit (bracket, prevF, hitNb, hitIso), the same samples and the same end. The counts of creep steps and skipTex reads are the
// only thing that may differ (creep falls by exactly the omitted samples whose bit was set). CI has no GPU: this checks the logic of the change, the shader text is tied to it by vr-breakdown.test.js.
import { describe, it, expect } from 'vitest';
import { buildSkipOccupancy, skipGrid } from '../../docs/vr-skip-occupancy.js';
import { volumeWgsl } from '../../docs/vr-wgsl-core.js';

const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const N = 24, DIMS = [N, N, N], SEG_OFF = 1.0e9;

// a grid: slot 0 = channel 0, slot 1 = channel 1 (spheres, a smooth band over the 0.5 level, a few punched voxels), alpha = whole voxels to the nearest shown segment, capped at 255
function makeGrid(rand, nSpheres) {
  const sp = []; for (let i = 0; i < nSpheres; i++) sp.push({ c: [3 + rand() * (N - 6), 3 + rand() * (N - 6), 3 + rand() * (N - 6)], r: 1 + rand() * 4, ch: i % 2 });
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = ((z * N + y) * N + x) * 4; let min = 1e9; const sd = [1e9, 1e9];
    for (const s of sp) { const d = Math.hypot(x - s.c[0], y - s.c[1], z - s.c[2]) - s.r; sd[s.ch] = Math.min(sd[s.ch], d); min = Math.min(min, d); }
    for (let ch = 0; ch < 2; ch++) data[o + ch] = Math.max(0, Math.min(255, Math.round(127.5 - sd[ch] * 50)));
    data[o + 3] = Math.max(0, Math.min(255, Math.floor(Math.max(min, 0))));
    if (rand() < 0.01) data[o + (rand() < 0.5 ? 0 : 1)] = 140; // a punched voxel: some bits stay clear
  }
  return data;
}

// the model of one ray; gate = 'always' (the check at every sample: the text before) | 'gated' (only while chk)
function march(grid, ray, gate, o = {}) {
  const { data, bits } = grid, stp = o.stp, useSkip = o.useSkip !== false, jumpOn = o.jumpOn !== false, refine = true;
  const [bx, by] = skipGrid(DIMS);
  const clampTc = v => Math.min(Math.max(v, 0), 0.999999);
  const fetch = tc => { // the linear sample (rgba, 0..1) of the texel grid, clamp to edge, texel centres at (i + 0.5) / N
    const p = tc.map((v, k) => clampTc(v) * N - 0.5), f = p.map(Math.floor), w = p.map((v, k) => v - f[k]), r = [0, 0, 0, 0];
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1, wt = (dx ? w[0] : 1 - w[0]) * (dy ? w[1] : 1 - w[1]) * (dz ? w[2] : 1 - w[2]);
      const ix = Math.min(Math.max(f[0] + dx, 0), N - 1), iy = Math.min(Math.max(f[1] + dy, 0), N - 1), iz = Math.min(Math.max(f[2] + dz, 0), N - 1), b = ((iz * N + iy) * N + ix) * 4;
      for (let k = 0; k < 4; k++) r[k] += wt * data[b + k] / 255;
    }
    return r;
  };
  const pos = t => ray.tcO.map((v, k) => v + ray.tcD[k] * t);
  const fOf = q => [q[0] - 0.5, q[1] - 0.5, -SEG_OFF, -SEG_OFF]; // slot s: channel s shown (slots 2, 3 off)
  const bitAt = t => { // the skip bit of the sample at t, null when the shader reads the sample instead (a face of the dual cell, the border)
    const pp = pos(t).map((v, k) => v * N - 0.5), fl = pp.map(Math.floor), fr = pp.map((v, k) => v - fl[k]);
    if (!(fr.every(v => v > 1 / 64 && v < 63 / 64) && fl.every(v => v >= 0) && fl.every(v => v < N - 1))) return null;
    const sb = fl.map(v => v >> 2), sl = fl.map(v => v & 3), sbit = sl[0] + (sl[1] << 2) + (sl[2] << 4), blk = (sb[2] * by + sb[1]) * bx + sb[0];
    return { sb, set: ((bits[blk * 2 + (sbit < 32 ? 0 : 1)] >>> (sbit & 31)) & 1) !== 0 };
  };
  let t = ray.t0, previousT = t, lastIndex = -1, iters = 0, prevValid = false, prevF = 0, prevSkip = false, skBlk = null, chk = false, hit = null;
  const st = { creep: 0, jumps: 0, skipRd: 0, omittedSet: 0, omitted: 0 };
  for (let iter = 0; iter < 4096; iter++) {
    if (t > ray.endT) break;
    iters++;
    if (useSkip && (gate === 'always' || chk)) {
      const b = bitAt(t);
      if (b) {
        if (!skBlk || b.sb.some((v, k) => v !== skBlk[k])) { skBlk = b.sb; st.skipRd++; }
        if (b.set) { st.creep++; prevValid = true; prevSkip = true; lastIndex = -1; previousT = t; t += stp; continue; }
      }
    } else if (useSkip) { st.omitted++; const b = bitAt(t); if (b && b.set) st.omittedSet++; } // statistics only: what the check would have found
    const q = fetch(pos(t)); let dd = q[3] * 255;
    if (!jumpOn) dd = 0;
    chk = dd < 2.7;
    if (dd >= 2.7) { const nextJ = t + stp * Math.max(1, Math.floor((dd - 1.8) / stp)); st.jumps++; previousT = nextJ - stp * 0.05; prevValid = false; t = nextJ; continue; }
    const f = fOf(q); let idx = -1, curF = -1;
    for (let s = 0; s < 4; s++) if (f[s] >= 0) { idx = s; curF = f[s]; break; }
    if (idx !== lastIndex) {
      if (idx >= 0) {
        if (prevSkip && prevValid) { const g = fOf(fetch(pos(previousT))); prevF = Math.max(...g); }
        hit = { idx, lo: previousT, hi: t, f0: prevF, f1: curF, nb: prevValid ? 6 : 2, iso: refine && prevValid && prevF < 0 };
        lastIndex = idx; break;
      }
      lastIndex = idx;
    }
    prevSkip = false; prevValid = true; prevF = idx >= 0 ? curF : Math.max(...f);
    previousT = t; t += stp;
  }
  return { out: { hit, iters, t, lastIndex, prevValid, previousT }, st };
}

// a ray from outside the box towards a random point inside: the slab entry / exit in voxel units (the ray in tc space, t in voxels)
function makeRay(rand) {
  const c = [N / 2, N / 2, N / 2], a = rand() * 2 * Math.PI, e = Math.acos(2 * rand() - 1), R = N * 1.2;
  const o = [c[0] + R * Math.sin(e) * Math.cos(a), c[1] + R * Math.sin(e) * Math.sin(a), c[2] + R * Math.cos(e)], to = [2 + rand() * (N - 4), 2 + rand() * (N - 4), 2 + rand() * (N - 4)];
  const d = to.map((v, k) => v - o[k]), l = Math.hypot(...d), dir = d.map(v => v / l);
  let lo = -1e9, hi = 1e9; for (let k = 0; k < 3; k++) { const inv = 1 / (Math.abs(dir[k]) < 1e-9 ? 1e-9 : dir[k]), t1 = (0 - o[k]) * inv, t2 = (N - o[k]) * inv; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); }
  return { tcO: o.map(v => v / N), tcD: dir.map(v => v / N), t0: Math.max(lo, 0), endT: hi };
}

describe('the creep gate: the result of a ray does not change', () => {
  for (const [name, opt] of [['step 1.5', { stp: 1.5 }], ['step 1.0', { stp: 1.0 }], ['step 0.7', { stp: 0.7 }], ['jumps off (noJump)', { stp: 1.0, jumpOn: false }]]) {
    it(name + ': the same hit bracket, prevF, hitNb, hitIso, samples and end as with the check at every sample; creep falls by the omitted samples that had a bit, skipTex reads do not rise', () => {
      const rand = rng(12345); let hits = 0, passes = 0, tot = { creep: 0, creepGated: 0, rd: 0, rdGated: 0, omittedSet: 0, omitted: 0, isoHits: 0, nb2: 0 };
      for (let g = 0; g < 4; g++) {
        const data = makeGrid(rand, 3 + g * 2), grid = { data, bits: buildSkipOccupancy({ data, dims: DIMS, chan: [0, 1, -1, -1], mask: 0b11 }) };
        for (let i = 0; i < 700; i++) {
          const ray = makeRay(rand), a = march(grid, ray, 'always', opt), b = march(grid, ray, 'gated', opt);
          expect(b.out).toEqual(a.out);
          expect(b.st.creep + b.st.omittedSet).toBe(a.st.creep); // the same path: a creep step of the check-everywhere run is a read step or a creep step of the gated one
          expect(b.st.jumps).toBe(a.st.jumps);
          expect(b.st.skipRd).toBeLessThanOrEqual(a.st.skipRd);
          if (a.out.hit) { hits++; if (a.out.hit.iso) tot.isoHits++; if (a.out.hit.nb === 2) tot.nb2++; } else passes++;
          tot.creep += a.st.creep; tot.creepGated += b.st.creep; tot.rd += a.st.skipRd; tot.rdGated += b.st.skipRd; tot.omittedSet += b.st.omittedSet; tot.omitted += b.st.omitted;
        }
      }
      // the test exercises what it claims: hits and passes, hits that use the lazily fetched prevF, creep steps, omitted samples with a set bit, and fewer skipTex reads
      expect(hits).toBeGreaterThan(300); expect(passes).toBeGreaterThan(100); expect(tot.creep).toBeGreaterThan(1000); expect(tot.omitted).toBeGreaterThan(500);
      if (opt.jumpOn !== false) { expect(tot.omittedSet).toBeGreaterThan(0); expect(tot.rdGated).toBeLessThan(tot.rd); expect(tot.isoHits).toBeGreaterThan(20); }
    });
  }
  it('the model is tied to the shader: the shader gates by `chk`, set from dd after the override, false at the start and after a jump', () => {
    const t = volumeWgsl();
    expect(t).toContain('var chk=false;'); expect(t).toContain('if(skipOn&&chk){'); expect(t).toContain('chk=dd<2.7;'); expect(t).toContain('if(dd>=2.7){let nextJ=');
  });
});
