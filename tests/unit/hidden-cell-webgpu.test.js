import { describe, it, expect } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { volumeShader, volumeShaderChild, volumePickShader } from '../../docs/medical-volume.js';

// an earlier change. The WebGPU volume (docs/medical-volume.js) had the same cause as the VR shader (vr-view.js hideCellAt): a segment is a member where the TRILINEAR
// value is in range, the hidden test reads the NEAREST voxel, so a sample in the cell of the AIR voxel beside a hidden part (hidden: no; trilinear: in range) was a shown hit and left a thin skin of the hidden part.
// hiddenCellAt (one function, called from one wrapper, segmentIndexVis, which the march's sample and its bisection use; the previous-hidden bookkeeping reads the slot it refused) counts that sample as hidden. This is a CPU model of that march (the surface search = segmentIndexFor, 6 bisections) before and after,
// on a full-resolution grid (textureDims = source dims, no dilation of the hidden runs: a reduced grid dilates them by one texel, gpuDilateRuns, and is covered).
const N = 40;
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const cl = (v, a, b) => Math.min(b, Math.max(a, v));
function model(kind) {
  const cls = new Uint8Array(N ** 3), G = new Uint8Array(N ** 3), ix = (x, y, z) => x + N * (y + N * z), blobs = [];
  if (kind === 'ball-half') blobs.push({ c: [20, 20, 20], r: 13 });
  if (kind === 'two-balls') { blobs.push({ c: [13, 20, 20], r: 8 }); blobs.push({ c: [29.2, 20, 20], r: 8 }); } // a one-voxel air gap
  if (kind === 'lumps') for (let i = 0; i < 9; i++) blobs.push({ c: [8 + rnd() * 24, 8 + rnd() * 24, 8 + rnd() * 24], r: 3.5 + rnd() * 4.5 });
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let blobId = -1; blobs.forEach((b, i) => { if (blobId < 0 && Math.hypot(x + .5 - b.c[0], y + .5 - b.c[1], z + .5 - b.c[2]) <= b.r) blobId = i; });
    if (blobId < 0) continue;
    cls[ix(x, y, z)] = 255; // in range (HU 1000 against air -1000; the range's edge at 0: the trilinear value >= 0 where the interpolated classification >= 0.5)
    if ((kind === 'ball-half' && x + .5 > 20 + (Math.sin(y * .7) + Math.cos(z * .9)) * 1.2) || (kind === 'two-balls' && blobId === 1) || (kind === 'lumps' && blobId % 3 === 0)) G[ix(x, y, z)] = 1;
  }
  const tri = (tc, skipHidden) => { // the trilinear value (volumeTex, linear sampler)
    const u = tc.map(v => cl(v, 0, 0.999999) * N - 0.5), b = u.map(Math.floor), f = u.map((v, i) => v - b[i]); let s = 0;
    for (let k = 0; k < 8; k++) { let w = 1; const q = [0, 1, 2].map(i => { const o = (k >> i) & 1; w *= o ? f[i] : 1 - f[i]; return cl(b[i] + o, 0, N - 1); }); const j = ix(...q); s += w * (skipHidden && G[j] ? 0 : cls[j] / 255); }
    return s;
  };
  const voxelOf = tc => tc.map(v => Math.floor(cl(v, 0, 0.999999) * N));
  const hidden = tc => G[ix(...voxelOf(tc))] >= 1; // regionHiddenAt: the NEAREST voxel
  const cell = tc => { // medical-volume.js hiddenCellAt: the nearest voxel is air (huVoxel out of range), and one of the 8 voxels of the trilinear cell is hidden
    const tq = tc.map(v => cl(v, 0, 0.999999)); if (cls[ix(...voxelOf(tq))] >= 128) return false;
    const b = tq.map(v => Math.floor(v * N - 0.5));
    for (let k = 0; k < 8; k++) if (G[ix(...[0, 1, 2].map(i => cl(b[i] + ((k >> i) & 1), 0, N - 1)))] >= 1) return true;
    return false;
  };
  return { member: (tc, fix) => tri(tc) >= 0.5 && !hidden(tc) && !(fix && cell(tc)), hidden, cell, shown: tc => tri(tc, true) };
}
function march(M, o, d, step, fix, hits) { // segmentIndexFor + the surface search of the shader: a hit = the first member sample after a non-member one, refined by 6 bisections of member()
  let t0 = 0, t1 = 1e9;
  for (let i = 0; i < 3; i++) { if (Math.abs(d[i]) < 1e-9) { if (o[i] < 0 || o[i] > N) return; continue; } let a = -o[i] / d[i], b = (N - o[i]) / d[i]; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
  const tcAt = t => [0, 1, 2].map(i => (o[i] + d[i] * t) / N);
  let last = false, prevT = t0, k = 0;
  for (let t = t0; t < t1; t += step, k++) {
    const m = M.member(tcAt(t), fix);
    if (m && !last) {
      let lo = prevT, hi = t;
      for (let r = 0; r < 6; r++) { const mid = (lo + hi) / 2; if (M.member(tcAt(mid), fix)) hi = mid; else lo = mid; }
      hits.push({ k, p: tcAt(hi) });
    }
    last = m; prevT = t;
  }
}
describe('WebGPU volume: the hit search beside a hidden part (CPU model of segmentIndexFor + hiddenCellAt)', () => {
  for (const kind of ['ball-half', 'two-balls', 'lumps']) {
    it(`${kind}: no hit is left on a hidden part's skin; no hit on the shown tissue is lost`, () => {
      const M = model(kind), R = {};
      for (const fix of [false, true]) {
        seed = 777; const out = { hits: 0, skin: 0, rays: [] };
        for (let n = 0; n < 6000; n++) {
          let d = [rnd() - .5, rnd() - .5, rnd() - .5]; const L = Math.hypot(...d); d = d.map(v => v / L);
          const o = [0, 1, 2].map(i => (rnd() - .5) * 34 + 20 - d[i] * 70);
          const h = []; march(M, o, d, 0.5, fix, h);
          out.hits += h.length; out.skin += h.filter(x => M.hidden(x.p) || M.cell(x.p)).length; out.rays.push(h);
        }
        R[fix] = out;
      }
      expect(R[false].hits).toBeGreaterThan(500);
      expect(R[false].skin).toBeGreaterThan(5); // before: hits in the skin (the debris)
      expect(R[true].skin).toBe(0); // after: none
      // per ray: every hit of before that was not in the skin is still there after the change: at the same sample, or moved by at most 2 samples (one voxel: the sample the old search took first was itself in the skin cell
      // and the shown surface is the next sample or two behind it). The few that are gone (about 0.1 %: a sliver of one shown voxel between a hidden part and its skin cell, narrower than one step) all lie where the surface
      // stands on the hidden voxels' share of the trilinear value (the value of the SHOWN voxels alone < 0.5 there): none is a hit on the shown tissue itself.
      let lost = 0, onShown = 0; R[false].rays.forEach((h, i) => { const after = R[true].rays[i].map(x => x.k); for (const x of h) { if (M.hidden(x.p) || M.cell(x.p)) continue; const dk = Math.min(...after.map(a => Math.abs(a - x.k)), 99); if (dk > 2) { lost++; if (M.shown(x.p) >= 0.5) onShown++; } } });
      expect(onShown).toBe(0);
      expect(lost).toBeLessThan(R[false].hits * 0.01);
      expect(R[true].hits).toBeLessThanOrEqual(R[false].hits); // only skin hits go away (or move deeper to the shown surface)
    }, 60000);
  }
});
describe('the WGSL text (pinned)', () => {
  it('one hiddenCellAt in the volume shader, reached through segmentIndexVis only (the sample and the bisection; the previous-hidden lines read gSkin), gated by hiddenAnyKinds, only an air voxel is looked around', () => {
    const s = volumeShader();
    expect(s.match(/fn hiddenCellAt\(/g)).toHaveLength(1);
    expect(s.match(/hiddenCellAt\(/g)).toHaveLength(2); // the definition + segmentIndexVis
    expect(s).toContain('if(any==0u||(editRows[1]&(16u<<s))!=0u){return 0u;}');
    expect(s).toContain('if(v>=a.x&&v<=a.y){return 0u;}'); // a voxel of the segment's own tissue is never taken
    expect(s).toContain('let k=hiddenCellAt(u32(r),tc0);');
    expect(s).toContain('let idx=segmentIndexVis(hv,tc0);');
    expect(s).toContain('fn segmentIndexAt(tc0:vec3<f32>)->i32{return segmentIndexVis(huAt(tc0),tc0);}');
    expect(s.match(/segmentIndexVis\(/g)).toHaveLength(3); // the definition + the sample + the bisection (the iso-secant search runs only where nothing is hidden; the MPR plane tint keeps segmentIndexFor)
    expect(s.match(/\(\(gSkin>>u32\(rawIdx\)\)&1u\)!=0u/g)).toHaveLength(2);
    expect(s).toContain('let w=analysisOverlayRow(ctc);'); // the run rows, not analysisOverlayAt's section shortcut (compile time)
    expect(() => new WgslReflect(s)).not.toThrow();
  });
  it('the child shader: the same function; its hidden voxels and gate are bit 1 of the same loop; gSkin bit 4 + slot for the child bookkeeping', () => {
    const c = volumeShaderChild();
    expect(c.match(/fn hiddenCellAt\(/g)).toHaveLength(1);
    expect(c).toContain('|select(0u,2u,childHiddenAt(s,ctc));}');
    expect(c).toContain('|select(0u,2u,(u32(u.capShade.w)&16u)!=0u);}');
    expect(c.match(/\(\(gSkin>>\(4u\+u32\(rawIdx\)\)\)&1u\)!=0u/g)).toHaveLength(2);
    expect(() => new WgslReflect(c)).not.toThrow();
  });
  it('the pick shader does not call it', () => {
    expect(volumePickShader()).not.toContain('hiddenCellAt');
  });
});
