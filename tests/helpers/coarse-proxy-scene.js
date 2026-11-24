// Synthetic scenes for the coarse-grid pre-pass (docs/vr-wgpu-coarse-proxy.js): used by tests/unit/vr-wgpu-coarse-proxy.test.js (node) and tools/vr-coarse-proxy-check.mjs (a WebGPU page), so the module is plain ES with no node-only names.
// A scene = the combined classification + distance texture as the VR view builds it (rgba8: class bytes of slots 0..2 in rgb, the smallest distance byte over the shown slots in alpha; slot 3's class bytes in cls4), with the real
// docs/distance-field.js bytes, anisotropic dims and voxel sizes, blobs cut by the box faces and a few isolated inside voxels (specks).
import { euclideanDistanceBytes, combineClassificationDistance, fourthChannelBytes } from '../../docs/distance-field.js';

export const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// slots = 2..4 stored segments (channel s for slot s; slot 3 lives in cls4); mask = the shown slots (bit s); border: blobs cut by box faces
export function makeScene(rand, { dims, halfExt, slots = 2, nBlobs = 4, border = false, speck = 0.0003, mask = (1 << slots) - 1, blobScale = 1 }) {
  const [W, H, D] = dims, n = W * H * D, bl = [], m = Math.min(W, H, D);
  for (let i = 0; i < nBlobs; i++) {
    const rs = (i < 2 ? m * 0.15 + rand() * m * 0.2 : m * 0.04 + rand() * m * 0.1) * blobScale;
    bl.push({ c: [m * 0.1 + rand() * (W - m * 0.2), m * 0.1 + rand() * (H - m * 0.2), m * 0.1 + rand() * (D - m * 0.2)], r: [rs * (0.7 + rand() * 0.6), rs * (0.7 + rand() * 0.6), rs * (0.7 + rand() * 0.6)], ch: i % slots });
  }
  if (border) {
    bl.push({ c: [-1, H / 2, D / 2], r: [m * 0.12, m * 0.15, m * 0.15], ch: 0 });
    bl.push({ c: [W / 2, H + 1, D / 3], r: [m * 0.15, m * 0.1, m * 0.15], ch: 1 % slots });
  }
  const cls = new Uint8Array(n * slots);
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (z * H + y) * W + x, sd = new Array(slots).fill(1e9);
    for (const b of bl) { const q = Math.hypot((x - b.c[0]) / b.r[0], (y - b.c[1]) / b.r[1], (z - b.c[2]) / b.r[2]); const d = (q - 1) * Math.min(...b.r); sd[b.ch] = Math.min(sd[b.ch], d); }
    for (let ch = 0; ch < slots; ch++) cls[i * slots + ch] = Math.max(0, Math.min(255, Math.round(127.5 - sd[ch] * 40)));
    if (rand() < speck) cls[i * slots + (rand() * slots | 0)] = 140;
  }
  const dist = new Uint8Array(n * slots), inside = new Uint8Array(n);
  for (let ch = 0; ch < slots; ch++) { for (let i = 0; i < n; i++) inside[i] = cls[i * slots + ch] >= 128 ? 1 : 0; const d = euclideanDistanceBytes(inside, dims); for (let i = 0; i < n; i++) dist[i * slots + ch] = d[i]; }
  const chan = [0, 1, 2, 3].map(s => (s < slots ? s : -1)), clsO = { data: cls, C: slots, chan };
  const data = combineClassificationDistance(clsO, { data: dist, C: slots }, mask, null, { four: slots === 4 });
  const cls4 = slots === 4 ? fourthChannelBytes(clsO) : null, segOn = [0, 1, 2, 3].map(s => ((mask >> s) & 1) && chan[s] >= 0 ? 1 : 0);
  const vs = halfExt.map((h, k) => 2 * h / dims[k]);
  return { dims, halfExt, vs, voxelMin: Math.min(...vs), data, cls4, chan, segOn, mask };
}

// the trilinear fetch of the combined texture at a texture coordinate (clamp to edge), as the sampler does; returns [r, g, b, a] in 0..1 and the cls4 value (0..1) or 0
export function fetchTexel(g, tc) {
  const N = g.dims, r = [0, 0, 0, 0];
  let c4 = 0;
  const p = tc.map((v, k) => Math.min(Math.max(v, 0), 0.999999) * N[k] - 0.5), f = p.map(Math.floor), w = p.map((v, k) => v - f[k]);
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1, wt = (dx ? w[0] : 1 - w[0]) * (dy ? w[1] : 1 - w[1]) * (dz ? w[2] : 1 - w[2]);
    const ix = Math.min(Math.max(f[0] + dx, 0), N[0] - 1), iy = Math.min(Math.max(f[1] + dy, 0), N[1] - 1), iz = Math.min(Math.max(f[2] + dz, 0), N[2] - 1), i = (iz * N[1] + iy) * N[0] + ix;
    for (let k = 0; k < 4; k++) r[k] += wt * g.data[i * 4 + k] / 255;
    if (g.cls4) c4 += wt * g.cls4[i] / 255;
  }
  return { q: r, c4 };
}
// the march's own inside test at a texture coordinate: some shown slot's trilinear class value is at or above 0.5
export function insideAt(g, tc) {
  const { q, c4 } = fetchTexel(g, tc);
  for (let s = 0; s < 4; s++) { const c = g.chan[s]; if (c < 0 || !g.segOn[s]) continue; const v = c === 3 && g.cls4 ? c4 : q[c]; if (v - 0.5 >= 0) return true; }
  return false;
}
