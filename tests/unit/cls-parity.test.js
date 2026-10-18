import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildClsData } from '../../docs/point-cls.js';
import { marchClassificationHitInfo } from '../../docs/vr-pick.js';
import { makePhantom, SEGMENTS, CALIB, HALF_EXT } from '../../tools/lib/vr-phantom.mjs';

// CPU side of the classification parity guard (the GPU side, which renders the real shader, is tools/vr-cls-parity.mjs, run in CI).
// The classification rule lives four times: WGSL / HU path (medical-volume.js), GLSL cls path (vr-view.js: byte / 255 >= 0.5), buildClsData (point-cls.js) and the CPU picks
// (vr-pick.js: byte >= 128). Here: buildClsData against the HU truth, the two thresholds against each other, and the pick march against an independent dense march.
const N = 16, hu = makePhantom(N, { complex: false }), n = N ** 3, vol = new Uint8Array(n * 2);
for (let i = 0; i < n; i++) { const q = hu[i] + 1024; vol[i * 2] = q & 255; vol[i * 2 + 1] = q >> 8; }
const edit = { data: null, dims: [N, N, N], active: 0, maskOnly: 0 };
const cls = buildClsData({ dims: [N, N, N], data: vol }, CALIB, edit, SEGMENTS);

describe('buildClsData against the HU rule', () => {
  it('layout: bone, soft, fat in channels 0..2 of four', () => { expect(cls.C).toBe(4); expect(cls.chan).toEqual([0, 1, 2, -1]); expect(cls.data.length).toBe(n * 4); });
  it('byte >= 128 exactly where the HU lies in the segment range (the shader\'s 0.5 = byte 127.5 -> 128)', () => {
    for (const [s, k] of [[0, 'bone'], [1, 'soft'], [2, 'fat']]) {
      const { min, max } = SEGMENTS[k]; let inside = 0;
      for (let i = 0; i < n; i++) { const want = hu[i] >= min && hu[i] <= max; if (want) inside++; expect(cls.data[i * 4 + s] >= 128, `${k} voxel ${i} HU ${hu[i]}`).toBe(want); }
      expect(inside, k + ' is present in the phantom').toBeGreaterThan(20);
    }
  });
  it('threshold boundary: the range edge and one HU outside', () => {
    const one = hu0 => { const v = new Uint8Array(2), q = hu0 + 1024; v[0] = q & 255; v[1] = q >> 8; return buildClsData({ dims: [1, 1, 1], data: v }, CALIB, { data: null, dims: [1, 1, 1], active: 0, maskOnly: 0 }, SEGMENTS).data[0]; };
    expect(one(300)).toBe(128); expect(one(299) < 128).toBe(true); expect(one(3000)).toBe(128); expect(one(3001) < 128).toBe(true);
    expect(one(300) / 255 >= 0.5).toBe(true); expect(one(299) / 255 >= 0.5).toBe(false); // the same decision as the shader's q >= 0.5
  });
  it('the processing mask zeroes excluded voxels and lifts mask-only ones to 191', () => {
    const maskData = new Uint8Array(n * 4); for (let i = 0; i < n; i++) maskData[i * 4] = i % 2 ? 255 : 0;
    const m = buildClsData({ dims: [N, N, N], data: vol }, CALIB, { data: maskData, dims: [N, N, N], active: 1, maskOnly: 1 }, SEGMENTS);
    for (let i = 0; i < n; i++) { const b = m.data[i * 4]; if (i % 2 === 0) expect(b).toBe(0); else expect(b).toBeGreaterThanOrEqual(191); }
  });
});

describe('the thresholds in the sources agree (a drift in one copy fails here)', () => {
  const view = readFileSync('docs/vr-view.js', 'utf8'), pick = readFileSync('docs/vr-pick.js', 'utf8'), pcls = readFileSync('docs/point-cls.js', 'utf8');
  const frag = view.match(/const fragmentShader=`([\s\S]*?)`;/)[1];
  it('GLSL: every classification test is q >= 0.5 and the tight loop tests the vector minus 0.5', () => {
    expect(frag).toContain('vec4 qc=q-0.5;');
    expect(frag).toContain('q[c]>=0.5');
    expect(frag).toContain('qm[c]>=0.5');
    expect(frag).toContain('qm[cIdx]>=0.5');
    expect(frag.match(/(?:q|qm|qc|\w+\[c\w*\])\s*>=\s*0\.\d+/g).every(t => t.endsWith('0.5'))).toBe(true);
  });
  it('vr-pick.js tests the byte against 128; point-cls.js encodes 0.5 + distance / 2048 and the mask lift 191', () => {
    expect(pick).toMatch(/data\[k\+ch\]>=128/);
    expect(pcls).toContain('(0.5+dd/2048)*255');
    expect(pcls).toContain('f<191');
  });
});

describe('marchClassificationHitInfo against an independent dense march', () => {
  const chs = [0, 1, 2], dims = [N, N, N], he = HALF_EXT;
  const voxel = (p) => [Math.min(N - 1, Math.max(0, Math.floor((p[0] / (2 * he[0]) + 0.5) * N))), Math.min(N - 1, Math.max(0, Math.floor((0.5 - p[1] / (2 * he[1])) * N))), Math.min(N - 1, Math.max(0, Math.floor((p[2] / (2 * he[2]) + 0.5) * N)))];
  // reference: step 1/20 voxel (not the production half voxel), the same nearest-voxel rule, plane side tested directly
  const reference = (o, q, planes) => {
    const len = Math.hypot(q.x, q.y, q.z), vmin = Math.min(...he.map(h => 2 * h / N));
    for (let t = 0; t < 12; t += vmin / 20 / len) {
      const p = [o.x + q.x * t, o.y + q.y * t, o.z + q.z * t];
      if (Math.abs(p[0]) > he[0] || Math.abs(p[1]) > he[1] || Math.abs(p[2]) > he[2]) continue;
      if (planes.some(pl => pl.x * p[0] + pl.y * p[1] + pl.z * p[2] - pl.w < 0)) continue;
      const v = voxel(p), k = (v[0] + N * (v[1] + N * v[2])) * 4;
      for (const ch of chs) if (cls.data[k + ch] >= 128) return { t, v, ch };
    }
    return null;
  };
  const o = { x: 2.0, y: 1.3, z: 2.5 }, plane = (() => { const l = Math.hypot(0.6, 0.3, 0.74); return { x: 0.6 / l, y: 0.3 / l, z: 0.74 / l, w: 0.05 }; })();
  for (const [name, planes] of [['no plane', []], ['one clipping plane', [plane]]]) {
    it(name + ': same segment channel, voxel within one, plane side respected', () => {
      let both = 0, same = 0, near = 0, rays = 0;
      for (let a = -12; a <= 12; a++) for (let b = -12; b <= 12; b++) {
        const q = { x: -2.0 + a * 0.05, y: -1.3 + b * 0.05, z: -2.5 };
        const cpu = marchClassificationHitInfo(o, q, he, dims, cls, chs, planes, planes.length, planes.length ? 1 : 0), ref = reference(o, q, planes);
        rays++;
        if (cpu) { const p = [o.x + q.x * cpu.t, o.y + q.y * cpu.t, o.z + q.z * cpu.t]; expect(planes.every(pl => pl.x * p[0] + pl.y * p[1] + pl.z * p[2] - pl.w >= -1e-9)).toBe(true); expect(cls.data[(cpu.x + N * (cpu.y + N * cpu.z)) * 4 + cpu.ch]).toBeGreaterThanOrEqual(128); }
        if (cpu && ref) { both++; if (cpu.ch === ref.ch) same++; if (Math.max(Math.abs(cpu.x - ref.v[0]), Math.abs(cpu.y - ref.v[1]), Math.abs(cpu.z - ref.v[2])) <= 1) near++; }
        else if (cpu || ref) near += 0;
      }
      expect(both).toBeGreaterThan(rays * 0.2);
      expect(same / both).toBeGreaterThan(0.97); expect(near / both).toBeGreaterThan(0.97);
    });
  }
});
