import { describe, it, expect } from 'vitest';

// an earlier change. A CPU model of the shader's see-through march (vr-view.js, the loops' candidate hit, the hit search after a hidden
// part, hideAt / hideCellAt): the hit search after a hidden part took a point in the AIR cell beside the hidden part (hide index 0 there, but the trilinear classification >= 0.5) as "inside and not hidden", so the cut face
// landed in that skin. With hideCellAt in the search (the three see-through search sites) no cut-face hit is left in the skin. The same for a hit NOT after a hidden part (a ray from the air that meets the shown tissue at a corner of a hidden
// part: its surface crossing lay in the hidden part's skin; about half of them were off the shown body, clsShownAt < 0.4): the search never accepts a point of a hidden part or of its air cell (hideAnyOn(), every search site, opaque and
// see-through; n730: one call, hideSkinAt = hideAt || hideCellAt, and no secant search while something is hidden). The shader text itself is pinned by hidden-neighbour.test.js.
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
    cls[ix(x, y, z)] = 255;
    if ((kind === 'ball-half' && x + .5 > 20 + (Math.sin(y * .7) + Math.cos(z * .9)) * 1.2) || (kind === 'two-balls' && blobId === 1) || (kind === 'lumps' && blobId % 3 === 0)) G[ix(x, y, z)] = 1;
  }
  const clsAt = tc => { // the classification texture, trilinear
    const u = tc.map(v => cl(v, 0, 0.999999) * N - 0.5), b = u.map(Math.floor), f = u.map((v, i) => v - b[i]); let s = 0;
    for (let k = 0; k < 8; k++) { let w = 1; const q = [0, 1, 2].map(i => { const o = (k >> i) & 1; w *= o ? f[i] : 1 - f[i]; return cl(b[i] + o, 0, N - 1); }); s += w * cls[ix(...q)] / 255; }
    return s;
  };
  const gNear = tc => G[ix(...tc.map(v => Math.floor(cl(v, 0, 0.999999) * N)))]; // the hide index, nearest
  const hideAt = tc => gNear(tc) >= 1;
  const hideCellAt = tc => { // vr-view.js hideCellAt: G 0 here, this voxel is air, one of the 8 voxels of the trilinear cell is hidden
    const tq = tc.map(v => cl(v, 0, 0.999999)); if (gNear(tq) >= 1) return false;
    const u = tq.map(v => v * N); if (cls[ix(...u.map(Math.floor))] / 255 >= 0.5) return false;
    const b = u.map(v => Math.floor(v - 0.5));
    for (let k = 0; k < 8; k++) if (G[ix(...[0, 1, 2].map(i => cl(b[i] + ((k >> i) & 1), 0, N - 1)))] >= 1) return true;
    return false;
  };
  const clsShownAt = tc => { // the classification with the hidden voxels removed: what the shown part alone is
    const u = tc.map(v => cl(v, 0, 0.999999) * N - 0.5), b = u.map(Math.floor), f = u.map((v, i) => v - b[i]); let s = 0;
    for (let k = 0; k < 8; k++) { let w = 1; const q = [0, 1, 2].map(i => { const o = (k >> i) & 1; w *= o ? f[i] : 1 - f[i]; return cl(b[i] + o, 0, N - 1); }); const j = ix(...q); s += w * (G[j] >= 1 ? 0 : cls[j] / 255); }
    return s;
  };
  const hideSkinAt = tc => { // vr-view.js hideSkinAt (without a part): the hide index read once: G >= 1 = hidden (one kind in this model: always hidden), G 0 = the cell test as hideCellAt
    const tq = tc.map(v => cl(v, 0, 0.999999)); if (gNear(tq) >= 1) return true;
    const u = tq.map(v => v * N); if (cls[ix(...u.map(Math.floor))] / 255 >= 0.5) return false;
    const b = u.map(v => Math.floor(v - 0.5));
    for (let k = 0; k < 8; k++) if (G[ix(...[0, 1, 2].map(i => cl(b[i] + ((k >> i) & 1), 0, N - 1)))] >= 1) return true;
    return false;
  };
  return { clsAt, hideAt, hideCellAt, hideSkinAt, clsShownAt };
}
function march(M, o, d, step, fix, out, opaque) { // one ray; fix 0 = (hideAt after a hidden part only), 1 = + hideCellAt there, 2 = + every hit; a see-through ray goes on after a hit, an opaque one ends
  let t0 = 0, t1 = 1e9;
  for (let i = 0; i < 3; i++) { if (Math.abs(d[i]) < 1e-9) { if (o[i] < 0 || o[i] > N) return; continue; } let a = -o[i] / d[i], b = (N - o[i]) / d[i]; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
  const tcAt = t => [0, 1, 2].map(i => (o[i] + d[i] * t) / N);
  let lastIndex = -1, prevHid = false, previousT = t0;
  for (let t = t0; t < t1; t += step) {
    const tc = tcAt(t), idx = M.clsAt(tc) >= 0.5 ? 0 : -1; let hidNow = false;
    if (idx !== lastIndex) {
      let passH = false;
      if (idx >= 0) {
        passH = M.hideAt(tc) || M.hideCellAt(tc); hidNow = passH; // the candidate hit
        if (!passH) {
          let lo = previousT, hi = t;
          for (let r = 0; r < 6; r++) {
            const mid = (lo + hi) / 2, tm = tcAt(mid); let inside = M.clsAt(tm) >= 0.5;
            if (fix === 2 ? inside && M.hideSkinAt(tm) : inside && prevHid && (M.hideAt(tm) || (fix && M.hideCellAt(tm)))) inside = false; // the hit search (fix 2: hideSkinAt, the one call of every search site while something is hidden)
            if (inside) hi = mid; else lo = mid;
          }
          out.hits++; const th = tcAt(hi), inSkin = M.hideAt(th) || M.hideCellAt(th);
          if (prevHid) { out.cut++; if (inSkin) out.skin++; } else if (inSkin) { out.plainSkin++; if (M.clsShownAt(th) < 0.4) out.off++; }
          if (opaque) return;
        }
      }
      lastIndex = passH ? -1 : idx;
    } else if (idx >= 0 && M.hideAt(tc)) { lastIndex = -1; hidNow = true; }
    prevHid = hidNow; previousT = t;
  }
}
describe('the hit search beside a hidden part (CPU model of the shader)', () => {
  it('hideSkinAt (the hide index read once) is exactly hideAt || hideCellAt', () => {
    for (const kind of ['ball-half', 'two-balls', 'lumps']) {
      const M = model(kind); seed = 99; let n1 = 0, bad = 0;
      for (let n = 0; n < 200000; n++) { const tc = [rnd(), rnd(), rnd()].map(v => v * 1.02 - 0.01), a = M.hideSkinAt(tc); if (a !== (M.hideAt(tc) || M.hideCellAt(tc))) bad++; if (a) n1++; }
      expect(bad).toBe(0); expect(n1).toBeGreaterThan(1000);
    }
  });
  for (const kind of ['ball-half', 'two-balls', 'lumps']) for (const opaque of [false, true]) {
    it(`${kind}, ${opaque ? 'opaque' : 'see-through'}: no hit is left on a hidden part's skin (after a hidden part: hideCellAt in the search; any other hit: the search never accepts the skin), same hits`, () => {
      const M = model(kind), R = [];
      for (const fix of [0, 1, 2]) {
        seed = 777; const out = { hits: 0, cut: 0, skin: 0, plainSkin: 0, off: 0 };
        for (let n = 0; n < 9000; n++) {
          let d = [rnd() - .5, rnd() - .5, rnd() - .5]; const L = Math.hypot(...d); d = d.map(v => v / L);
          const o = [0, 1, 2].map(i => (rnd() - .5) * 34 + 20 - d[i] * 70);
          march(M, o, d, 0.5, fix, out, opaque);
        }
        R.push(out);
      }
      expect(R[0].hits).toBeGreaterThan(500);
      expect(R[0].skin + R[0].plainSkin).toBeGreaterThan(5); // hits in the skin (the debris / stripes)
      expect(R[1].skin).toBe(0); // the hit after a hidden part
      expect(R[2].skin).toBe(0); expect(R[2].plainSkin).toBe(0); expect(R[2].off).toBe(0); // every hit: none on a hidden part's skin, none off the shown body
      expect(R[2].hits).toBe(R[0].hits); expect(R[1].hits).toBe(R[0].hits); // the search only moves a hit inside its bracket: no hit is added or lost
    });
  }
});
