// Deterministic synthetic phantom shared by the VR render guards and tests/unit/cls-parity.test.js (no browser, no app state; synthetic data only).
// HU volume (Int16) of N^3 voxels, index (z*N+y)*N+x, x and z up the index, y down (as the shader's texCoord).
// Ramps are gentle (about 100 HU per voxel at the bone edge) so that the byte threshold (128) moves the surface by whole voxels:
// a perturbed threshold is visible. complex=true adds what makes fat hard for the shader: thin sheets with holes and hashed single-voxel specks.
// four=true (build 528): a fourth segment with its own HU band (-800..-300, outside the other three ranges): a lung-like ball of -600 HU with a
// 3-voxel ramp, off-centre in the soft tissue, so that a four-channel classification (chan 0..3) can be rendered and checked
export function makePhantom(N, { complex = true, four = false } = {}) {
  const hu = new Int16Array(N * N * N), c = N / 2, sc = N / 64;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const cx = x + 0.5 - c, cy = y + 0.5 - c, cz = z + 0.5 - c;
    let v = -1000;
    const e = cx * cx / ((26 * sc) ** 2) + cy * cy / ((20 * sc) ** 2) + cz * cz / ((28 * sc) ** 2), r = Math.sqrt(e); // body ellipsoid
    if (r < 1) {
      v = 40;
      if (r > 0.05) {
        const rad = r * 28 * sc;
        if (complex) {
          const sheet = Math.abs(rad - 6 * sc * Math.round(rad / (6 * sc))) < 0.5 * sc, hole = ((x * 7 + y * 13 + z * 31) % 11) < 3;
          if (sheet && !hole) v = -150;
          let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) >>> 0;
          if ((h % 1000) < 15) v = -150;
        } else if (rad > 18 * sc && rad < 22 * sc) v = -150; // one fat shell, 4 voxels thick
      }
    } else if (r < 1 + 1 / (26 * sc) && !four) v = -1000 + (1 + 1 / (26 * sc) - r) * (26 * sc) * 1040; // one-voxel skin ramp (not with four: its -800..-300 part would be a one-voxel shell of the fourth segment)
    if (four && r < 1) { const rl = Math.hypot(cx - 11 * sc, cy + 7 * sc, cz - 6 * sc), Rl = 6 * sc; if (rl < Rl) v = -600; else if (rl < Rl + 3 && v === 40) v = Math.round(-600 + (rl - Rl) * 213); }
    const rb = Math.hypot(cx, cy, cz), Rb = 9 * sc; // central bone ball: HU = 300 at Rb, +100 per voxel inwards (ramp 2.6 voxels outside)
    if (rb < Rb + 2.6) v = Math.max(v, rb >= Rb ? 40 + 100 * (Rb + 2.6 - rb) : Math.min(1500, 300 + 100 * (Rb - rb)));
    if (Math.abs(cy - 6 * sc) < 1.5 * sc && Math.abs(cx) < 15 * sc && Math.abs(cz) < 15 * sc) v = Math.max(v, 900); // bone plate
    const rr = Math.hypot(cx + 12 * sc, cz); if (rr > 3 * sc && rr < 5 * sc && Math.abs(cy) < 15 * sc) v = Math.max(v, 900); // bone rod
    hu[(z * N + y) * N + x] = v;
  }
  return hu;
}
export const SEGMENTS = { bone: { active: true, enabled: true, min: 300, max: 3000 }, soft: { active: true, enabled: true, min: -200, max: 299 }, fat: { active: true, enabled: true, min: -250, max: -50 }, lung: { active: false, enabled: false, min: -950, max: -500 } };
export const SEGMENTS4 = { ...SEGMENTS, lung: { active: true, enabled: true, min: -800, max: -300 } }; // build 528: four enabled segments
export const SHOWN_MASK4 = 0b1111;
export const CALIB = [1, -1024, 0]; // slope, intercept, bias: u16 = HU + 1024
export const HALF_EXT = [1.65, 1.3, 1.0]; // anisotropic on purpose: an axis mix-up between the shader and vr-pick shows
export const SHOWN_MASK = 0b0111;

