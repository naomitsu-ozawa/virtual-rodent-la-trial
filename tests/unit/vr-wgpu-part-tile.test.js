// The parts' own tiles (docs/vr-wgpu-part-tile.js, way D of a part): the cone through the part's partOcc and the march it shortens.
// Model: the WGSL loop of docs/vr-wgsl-core.js for a part (feat P, events off) as far as the tiles can matter: the ray's start (hitBox, hitContent, boxEntry = 1), the 8^3 blocks of partOcc read at pfA + pfV * t (f32 maths, floor / clamp / >> 3 / min(size - 1)),
// the jump past a block that is left out (pm grid points, the state it rewrites: prevValid, previousT, lastIndex), and a read where the block is occupied (previousT = the sample, k++). The pre-pass start of the volume pass (the PX block: empty when tA > endT,
// else k = max(0, floor((tA - t0) / stp) - 1)) is applied exactly as the shader does. For every ray of every tile the sequence of reads (the grid point k, the state the read finds: prevValid, the grid point previousT lies on) from the tiles' start must be
// the sequence of reads from k = 0, and a ray of an empty tile (tA past its end) must have none. The rays and the tile's corner directions are made from the camera's own basis (not through the pre-pass' unprojection), on anisotropic dims, with a field that
// covers part of the volume only, the view along an axis, the eye inside the box. Negative controls that are not conservative (a cone of no extent, a start 12 grid points late) must show mismatches, or the comparison would be blind.
import { describe, it, expect, vi } from 'vitest';
import * as THREEG from 'three/webgpu';
import { createHash } from 'node:crypto';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { partTileWgsl, partTileCpu, PART_TILE, PART_TILE_FIELDS, PART_TILE_BINDINGS, partTileLayout, createPartTiles } from '../../docs/vr-wgpu-part-tile.js';
import { volumeWgsl, uniformLayout, PROXY, proxyWgsl } from '../../docs/vr-wgsl-core.js';
import { newPathText } from '../../docs/vr-wgpu-newpath.js';
import { createVrVolumeRenderer } from '../../docs/vr-wgpu.js';
import { UNIFORM_FIELDS_ALL } from '../../docs/vr-wgsl-core.js';
import { GPU_GLOBALS, recordingDevice, sceneUniforms, eyeCam } from '../helpers/gpu-call-log.js';

const f32 = Math.fround;
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------- the scene: a part's field (its own size, a map into the volume's texture coordinates), its blocks, its content box ----------
function makeScene(rand, { halfExt, pfD, scale, off, boxPad = 1, blobs = 3, specks = 4 }) {
  const od = pfD.map(n => Math.ceil(n / 8)), occ = new Uint8Array(od[0] * od[1] * od[2]);
  const at = (x, y, z) => (z * od[1] + y) * od[0] + x;
  for (let b = 0; b < blobs; b++) {
    const c = od.map(n => rand() * n), r = [0, 1, 2].map(() => 0.6 + rand() * 1.6);
    for (let z = 0; z < od[2]; z++) for (let y = 0; y < od[1]; y++) for (let x = 0; x < od[0]; x++) if (((x + 0.5 - c[0]) / r[0]) ** 2 + ((y + 0.5 - c[1]) / r[1]) ** 2 + ((z + 0.5 - c[2]) / r[2]) ** 2 < 1) occ[at(x, y, z)] = 1;
  }
  for (let i = 0; i < specks; i++) occ[at(Math.floor(rand() * od[0]), Math.floor(rand() * od[1]), Math.floor(rand() * od[2]))] = 1;
  // the object-space box of the field: tc = (x / (2 he) + 0.5, 0.5 - y / (2 he), z / (2 he) + 0.5), uu = tc * scale + off in [0, 1]  =>  tc in [-off / scale, (1 - off) / scale]
  const lo = [0, 1, 2].map(i => -off[i] / scale[i]), hi = [0, 1, 2].map(i => (1 - off[i]) / scale[i]);
  const xr = [(lo[0] - 0.5) * 2 * halfExt[0], (hi[0] - 0.5) * 2 * halfExt[0]], yr = [(0.5 - hi[1]) * 2 * halfExt[1], (0.5 - lo[1]) * 2 * halfExt[1]], zr = [(lo[2] - 0.5) * 2 * halfExt[2], (hi[2] - 0.5) * 2 * halfExt[2]];
  const boxC = [(xr[0] + xr[1]) / 2, (yr[0] + yr[1]) / 2, (zr[0] + zr[1]) / 2], boxH = [(xr[1] - xr[0]) / 2 * boxPad, (yr[1] - yr[0]) / 2 * boxPad, (zr[1] - zr[0]) / 2 * boxPad];
  return { halfExt, fieldDims: pfD, fieldScale: scale, fieldOff: off, boxC, boxH, occ: { dims: od, data: occ, r: (x, y, z) => occ[at(x, y, z)] } };
}

// ---------- a camera: the eye, the basis, the pinhole ----------
function makeCam(eye, target, fovY, w, h, up = [0, 1, 0]) {
  const fwd = norm(target.map((v, i) => v - eye[i])); let right = cross(fwd, up); if (Math.hypot(...right) < 1e-6) right = cross(fwd, [1, 0, 0]); right = norm(right); const upv = cross(right, fwd);
  const ty = Math.tan(fovY / 2), tx = ty * w / h;
  return { eye, w, h, dirAt: (px, py) => norm([0, 1, 2].map(i => fwd[i] + ((px + 0.5) / w * 2 - 1) * tx * right[i] + (1 - (py + 0.5) / h * 2) * ty * upv[i])) };
}

// ---------- the fragment: the part's loop in f32 as far as the tiles can matter ----------
const sd = x => (Math.abs(x) < 1e-20 ? 1e-20 : x);
function slab(o, d, lo, hi) { let a = -1e30, b = 1e30; for (let k = 0; k < 3; k++) { const inv = f32(1 / sd(d[k])), t1 = f32(f32(lo[k] - o[k]) * inv), t2 = f32(f32(hi[k] - o[k]) * inv); a = Math.max(a, Math.min(t1, t2)); b = Math.min(b, Math.max(t1, t2)); } return [a, b]; }
// tA: null = k from 0 (D0), else the pre-pass start; returns { discard } or { reads: [[k, prevValid, previousT's grid point]], iters, k0 }
function fragment(S, o, d, stp, tA) {
  const he = S.halfExt, [bx, by] = slab(o, d, he.map(x => -x), he);
  if (bx > by) return { discard: true };
  let t = Math.max(bx, 0), endT = by;
  const [cx, cy] = slab(o, d, S.boxC.map((v, i) => v - S.boxH[i]), S.boxC.map((v, i) => v + S.boxH[i]));
  if (cx > cy || cy < 0) return { discard: true };
  endT = Math.min(endT, cy); t = Math.max(t, cx);
  const t0 = f32(t); let k = 0, empty = false;
  if (tA !== null) { if (tA > endT) empty = true; else if (tA > t0) k = Math.max(0, Math.floor(f32(f32(tA - t0) / stp)) - 1); }
  const gInv = he.map(x => f32(0.5 / x)), tcO = [f32(o[0] * gInv[0] + 0.5), f32(0.5 - o[1] * gInv[1]), f32(o[2] * gInv[2] + 0.5)], tcD = [f32(d[0] * gInv[0]), f32(-d[1] * gInv[1]), f32(d[2] * gInv[2])];
  const pfD = S.fieldDims, pfA = [0, 1, 2].map(i => f32(f32(f32(tcO[i] * S.fieldScale[i] + S.fieldOff[i]) * pfD[i]) - 0.5)), pfV = [0, 1, 2].map(i => f32(f32(tcD[i] * S.fieldScale[i]) * pfD[i]));
  const od = S.occ.dims, reads = [];
  let prevValid = false, prevK = 0, iters = 0;
  for (let iter = empty ? 4096 : 0; iter < 4096; iter++) {
    const tt = f32(t0 + f32(k * stp));
    if (tt > endT) break;
    iters++;
    const pp = [0, 1, 2].map(i => f32(pfA[i] + f32(pfV[i] * tt)));
    const bk = [0, 1, 2].map(i => Math.min(Math.min(Math.max(Math.floor(pp[i]), 0), pfD[i] - 1) >> 3, od[i] - 1));
    if (S.occ.r(...bk) < 0.5) {
      const tx = [0, 1, 2].map(i => f32(Math.abs(f32((pfV[i] >= 0 ? bk[i] * 8 + 8 : bk[i] * 8) - pp[i])) / Math.max(Math.abs(pfV[i]), 1e-9)));
      const pm = Math.min(Math.max(1, Math.ceil(f32(Math.min(...tx) / stp))), 16777216);
      prevValid = true; prevK = k + pm - 1; k += pm; continue;
    }
    reads.push([k, prevValid, prevK]);
    prevValid = true; prevK = k; k++;
  }
  return { reads, iters, k0: k };
}

function run(scenes, { cams, tilesPer, mode }) {
  const st = { rays: 0, tiles: 0, emptyTiles: 0, emptyRays: 0, startedLate: 0, readsD0: 0, readsD: 0, mismatches: 0, itersD0: 0, itersD: 0, firstMismatch: null };
  for (const S of scenes) {
    const stp = f32(0.85 * Math.min(...S.halfExt.map((x, i) => 2 * x / (S.fieldDims[i] / S.fieldScale[i]))));
    for (const cam of cams(S)) {
      const tw = Math.ceil(cam.w / 8), th = Math.ceil(cam.h / 8), pick = tilesPer(tw, th);
      for (const [lx, ty] of pick) {
        const x0 = lx * 8, y0 = ty * 8, x1 = Math.min(cam.w, x0 + 8) - 1, y1 = Math.min(cam.h, y0 + 8) - 1;
        let corners = [cam.dirAt(x0, y0), cam.dirAt(x1, y0), cam.dirAt(x0, y1), cam.dirAt(x1, y1)];
        if (mode === 'noCone') { const c = norm(corners[0].map((_, i) => corners.reduce((s, v) => s + v[i], 0))); corners = [c, c, c, c]; }
        let tA = partTileCpu(S, cam.eye, corners);
        if (mode === 'late' && tA < 1e30) tA += 12 * stp;
        st.tiles++; if (tA > 1e30) st.emptyTiles++;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const d = cam.dirAt(x, y).map(f32), o = cam.eye.map(f32), a = fragment(S, o, d, stp, null), b = fragment(S, o, d, stp, tA);
          if (a.discard || b.discard) { if (!!a.discard !== !!b.discard) st.mismatches++; continue; }
          st.rays++; st.readsD0 += a.reads.length; st.readsD += b.reads.length; st.itersD0 += a.iters; st.itersD += b.iters;
          if (!a.reads.length) st.emptyRays++;
          if (b.iters < a.iters) st.startedLate++;
          if (JSON.stringify(a.reads) !== JSON.stringify(b.reads)) { st.mismatches++; st.firstMismatch ||= { x, y, tA, a: a.reads.slice(0, 3), b: b.reads.slice(0, 3) }; }
        }
      }
    }
  }
  return st;
}

const SCENES = () => {
  const rand = rng(7);
  return [
    makeScene(rand, { halfExt: [0.30, 0.22, 0.26], pfD: [88, 72, 96], scale: [0.55, 0.5, 0.6], off: [0.2, 0.25, 0.15] }),
    makeScene(rand, { halfExt: [0.20, 0.35, 0.15], pfD: [64, 120, 40], scale: [0.4, 0.35, 0.7], off: [0.5, 0.3, 0.1], blobs: 2 }),
    makeScene(rand, { halfExt: [0.25, 0.25, 0.25], pfD: [96, 96, 96], scale: [0.3, 0.3, 0.3], off: [0.35, 0.4, 0.3], boxPad: 0.8, blobs: 4, specks: 8 }), // a content box smaller than the field
    makeScene(rand, { halfExt: [0.28, 0.18, 0.32], pfD: [40, 30, 50], scale: [0.9, 0.9, 0.9], off: [0.05, 0.05, 0.05], boxPad: 1.2, blobs: 1, specks: 2 }), // a content box larger than the field (the edge blocks are read outside it)
  ];
};
const CAMS = S => {
  const rand = rng(11), out = [], c = S.boxC, r = Math.hypot(...S.halfExt);
  for (let i = 0; i < 6; i++) { const th = rand() * 6.283, ph = (rand() - 0.5) * 2.4, R = r * (1.4 + rand() * 1.2); out.push(makeCam([c[0] + R * Math.cos(th) * Math.cos(ph), c[1] + R * Math.sin(ph), c[2] + R * Math.sin(th) * Math.cos(ph)], c.map(v => v + (rand() - 0.5) * 0.1), (0.7 + rand() * 0.8), 120, 88)); }
  for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 0]]) out.push(makeCam(c.map((v, i) => v + e[i] * r * 2), c, 0.9, 120, 88, e[1] ? [0, 0, 1] : [0, 1, 0])); // the view along an axis: the rays' directions pass through the axis (the extremum of a component)
  out.push(makeCam([c[0] + 0.02, c[1] - 0.01, c[2] + 0.03], [c[0] + 0.3, c[1], c[2] - 0.2], 1.2, 120, 88)); // the eye inside the box
  return out;
};
const PICK = (tw, th) => { const rand = rng(3), l = [[0, 0], [tw - 1, 0], [0, th - 1], [tw - 1, th - 1]]; for (let i = 0; i < 20; i++) l.push([Math.floor(rand() * tw), Math.floor(rand() * th)]); return l; };

describe('the parts\' tiles: the march from the tile start against the march from k = 0, on every ray of every tile', () => {
  let good, noCone, late;
  it('zero mismatches on every ray of every tile (anisotropic field, a field over part of the volume, a content box smaller and larger than it, axis views, the eye inside)', () => {
    good = run(SCENES(), { cams: CAMS, tilesPer: PICK, mode: 'good' });
    expect(good.firstMismatch).toBeNull(); expect(good.mismatches).toBe(0);
  });
  it('the comparison means something: empty tiles, rays that start late, reads, rays with no read, and the loop is shorter', () => {
    expect(good.rays).toBeGreaterThan(20000); expect(good.emptyTiles).toBeGreaterThan(50); expect(good.emptyRays).toBeGreaterThan(5000);
    expect(good.startedLate).toBeGreaterThan(3000); expect(good.readsD0).toBeGreaterThan(5000); expect(good.readsD).toBe(good.readsD0);
    expect(good.itersD).toBeLessThan(good.itersD0 * 0.8);
  });
  it('negative controls: a cone of no extent and a start 12 grid points late each show mismatches (the comparison is not blind)', () => {
    noCone = run(SCENES(), { cams: CAMS, tilesPer: PICK, mode: 'noCone' }); late = run(SCENES(), { cams: CAMS, tilesPer: PICK, mode: 'late' });
    expect(noCone.mismatches).toBeGreaterThan(20); expect(late.mismatches).toBeGreaterThan(20);
  });
});

describe('the parts\' tiles: the shader text and the volume text', () => {
  const T = partTileWgsl();
  it('wgsl_reflect parses it, the entry is the compute main, the struct members are at the packer\'s offsets, the bindings are the host\'s', () => {
    const r = new WgslReflect(T), u = r.uniforms.find(x => x.name === 'p'), L = uniformLayout(PART_TILE_FIELDS);
    expect(r.entry.compute.map(e => e.name)).toEqual(['main']);
    expect(u.members.map(m => m.name)).toEqual(PART_TILE_FIELDS.map(f => f[0]));
    for (const m of u.members) expect(L.fields.find(f => f.name === m.name).offset, m.name).toBe(m.offset);
    expect(u.size).toBeLessThanOrEqual(L.byteSize); expect(partTileLayout().byteSize).toBe(L.byteSize);
    expect(r.getBindGroups()[0].map(b => b.binding).sort()).toEqual([PART_TILE_BINDINGS.params, PART_TILE_BINDINGS.occ, PART_TILE_BINDINGS.out].sort());
    expect(T).toContain('@workgroup_size(8,8,1)');
  });
  it('the pixel to direction is the pre-pass\' own text (the one pixel-to-direction test of tests/unit/vr-wgsl-proxy.test.js ties it to proxyPixelDir): the same fn dirAt, the same corner pixel centres and chord', () => {
    const grab = (t, name) => { const a = t.indexOf('fn ' + name + '('); let d = 0, i = t.indexOf('{', a); for (; i < t.length; i++) { if (t[i] === '{') d++; else if (t[i] === '}' && --d === 0) break; } return t.slice(a, i + 1); };
    const PX = proxyWgsl({});
    expect(grab(T, 'dirAt')).toBe(grab(PX, 'dirAt'));
    const a = T.slice(T.indexOf('fn cone('), T.indexOf('let he=p.halfExt')), b = PX.slice(PX.indexOf('fn cone('), PX.indexOf('let he=p.halfExt'));
    expect(a).toBe(b);
  });
  it('the text is pinned (change it on purpose: the CPU twin and the model above must follow)', () => {
    expect(createHash('sha256').update(T).digest('hex').slice(0, 16)).toBe('85b434508f500928');
  });
  it('the constants are the shader\'s; the tile is the pre-pass\' 8', () => {
    expect(PART_TILE.tile).toBe(PROXY.tile); expect(PART_TILE.tile).toBe(8); expect(PART_TILE.empty).toBe(PROXY.empty);
    for (const [k, v] of [['epsTheta', PART_TILE.epsTheta], ['slack', PART_TILE.slack], ['marginTexel', PART_TILE.marginTexel]]) expect(T, k).toContain(String(v));
    expect(T).toContain('3.0e+38'); expect(T).toContain('let hs=8.0/vmax');
  });
  it('the blocks are read as the volume pass reads them: textureLoad at min(clamp(floor, 0, dims - 1) >> 3, size - 1), a block is occupied when its r is not below 0.5; the field\'s map is the fragment\'s (tcO, the y flip, scale, off, dims, -0.5)', () => {
    const V = volumeWgsl({ events: false, feat: { R: true, P: true } });
    expect(V).toContain('let bk=min(clamp(vec3<i32>(floor(pp)),vec3<i32>(0),vec3<i32>(pfD)-vec3<i32>(1))>>vec3<u32>(3u),vec3<i32>(textureDimensions(partOcc))-vec3<i32>(1));');
    expect(T).toContain('clamp(vec3<i32>(floor(min(c0,c1)-R)),vec3<i32>(0),fd-vec3<i32>(1))>>vec3<u32>(3u),od-vec3<i32>(1))');
    expect(V).toContain('if(u.partKind!=0){occOut=ob.r<0.5;}'); expect(T).toContain('if(!(textureLoad(occ,vec3<i32>(x,y,z),0).r<0.5)){return s;}');
    expect(V).toContain('let pfD=vec3<f32>(textureDimensions(partField));let pfA=(tcO*u.partFieldScale+u.partFieldOff)*pfD-vec3<f32>(0.5);let pfV=tcD*u.partFieldScale*pfD;');
    expect(T).toContain('let pfA=(tcO*p.fieldScale+p.fieldOff)*pfD-vec3<f32>(0.5);'); expect(T).toContain('let K=vec3<f32>(gInv.x,-gInv.y,gInv.z)*p.fieldScale*pfD;');
    expect(V).toContain('let tcO=texCoord(o);let tcD=vec3<f32>(dir.x*gInv.x,-dir.y*gInv.y,dir.z*gInv.z);'); expect(V).toContain('gInv=0.5/u.halfExt;');
    expect(T).toContain('let gInv=0.5/he;let tcO=vec3<f32>(o.x*gInv.x+0.5,0.5-o.y*gInv.y,o.z*gInv.z+0.5);');
  });
  it('the program of a part in D is the display\'s own distSplit program (no new volume text): it takes its start from the tile of its own pixel, tile = (pixel - proxyOrg) / 8, empty when tA > endT, else k = max(0, floor((tA - t0) / stp) - 1)', () => {
    for (const feat of [{ R: true, P: true }, { C: true, P: true }, { R: true, C: true, T: true, P: true }]) {
      const t = newPathText({ f16: false, cls4: false, mode: 'dist', feat });
      expect(t).toContain('let tA=textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/8,0).r;'); expect(t).toContain('if(tA>endT){emptyRay=true;}else if(tA>t0){k=max(0,i32(floor((tA-t0)/stp))-1);}');
      expect(t).toContain('select(0,4096,emptyRay)'); expect(t).toContain('if(u.boxH.x>0.0){let cb=hitContent(o,dir);'); expect(t).toContain('if(u.boxEntry==1){t=max(t,cb.x);}');
    }
  });
});

describe('the parts\' tiles: the host', () => {
  const mkHost = () => {
    const log = [], mk = k => { const o = { k, n: log.length }; return o; };
    const device = {
      queue: { writeBuffer: (b, off, d) => log.push(['write', b.n, off, d.byteLength]) },
      createShaderModule: d => ({ code: d.code }), createBindGroupLayout: d => mk('bgl'), createPipelineLayout: d => mk('pl'),
      createComputePipelineAsync: async d => ({ k: 'pipe', d }),
      createBuffer: d => { const b = { k: 'buf', n: log.length, d, destroy() { log.push(['destroy', this.n]); } }; log.push(['buf', b.n, d.size]); return b; },
      createBindGroup: d => { const g = { k: 'bg', n: log.length, d }; log.push(['bg', g.n]); return g; },
    };
    const pass = { setPipeline: p => log.push(['pipe']), setBindGroup: (i, g, off) => log.push(['bind', g.n, off]), dispatchWorkgroups: (...a) => log.push(['dispatch', ...a]), end: () => log.push(['end']) };
    const enc = { beginComputePass: d => { log.push(['pass', !!d?.timestampWrites]); return pass; } };
    return { device, log, enc };
  };
  const THREEM = class { constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; } determinant() { return 1; } copy(m) { this.elements = m.elements.slice(); return this; } invert() { return this; } };
  const view = () => ({ createView: () => ({}), width: 96, height: 72, depthOrArrayLayers: 80 });
  const job = (scissors, n = 2) => ({ u: { halfExt: { value: { x: 0.3, y: 0.2, z: 0.25 } }, boxC: { value: { x: 0, y: 0, z: 0 } }, boxH: { value: { x: 0.1, y: 0.1, z: 0.1 } }, partFieldScale: { value: { x: 0.5, y: 0.5, z: 0.5 } }, partFieldOff: { value: { x: 0.25, y: 0.25, z: 0.25 } } },
    eyes: Array.from({ length: n }, (_, i) => ({ x: i * 202, y: 0, w: 200, h: 160, vx: i * 202, vy: 0, vw: 200, vh: 160, scissors: scissors.map(c => [i * 202 + c[0], c[1], c[2], c[3]]), mvp: new THREEM(), origin: [0, 0, 1] })), info: { tilesPerEye: 25, tilesY: 20 }, occ: view(), field: view(), out: view() });
  it('one compute pass for all the parts of a frame, a dispatch per part over the tiles under its scissor rects (not the whole slot), each part with its own uniform slot at a 256-multiple dynamic offset; not ready = nothing encoded', async () => {
    const { device, log, enc } = mkHost(); globalThis.GPUShaderStage = { COMPUTE: 4 }; globalThis.GPUBufferUsage = { UNIFORM: 4, COPY_DST: 2 };
    const pt = createPartTiles({ device, THREE: { Matrix4: THREEM } });
    expect(pt.ready).toBe(false); expect(pt.encode(enc, [job([[16, 8, 40, 24]])])).toBe(-1); expect(log.some(l => l[0] === 'pass')).toBe(false);
    expect(await pt.warm()).toBe(true); expect(pt.ready).toBe(true);
    const missing = [], n = pt.encode(enc, [job([[16, 8, 40, 24]]), job([[0, 0, 200, 160]], 2), job([[8, 8, 8, 8]], 1)], { querySet: 1 }, missing);
    expect(n).toBe(3); expect(missing).toEqual([]);
    expect(log.filter(l => l[0] === 'pass')).toEqual([['pass', true]]); expect(log.filter(l => l[0] === 'end').length).toBe(1);
    const disp = log.filter(l => l[0] === 'dispatch'), binds = log.filter(l => l[0] === 'bind');
    expect(disp).toEqual([['dispatch', 1, 1, 2], ['dispatch', 4, 3, 2], ['dispatch', 1, 1, 1]]); // (a 24 x 16 px rect = 3 x 2 tiles: one group; the whole 200 x 160 region = 25 x 20 tiles: 4 x 3 groups; one eye)
    expect(binds.map(b => b[2])).toEqual([[0], [pt.STRIDE], [2 * pt.STRIDE]]); expect(pt.STRIDE % 256).toBe(0);
    expect(log.filter(l => l[0] === 'write').length).toBe(1); // all the parts' uniforms in one write: no slot of one part is another's
    const w = log.find(l => l[0] === 'write'); expect(w[3]).toBe(3 * pt.STRIDE);
  });
  it('the tiles of a part are made for the pass\'s own tile grid: rect = the tiles under the scissors, relative to the eye\'s own origin, clipped to the grid; a part with no rect makes no dispatch', async () => {
    const { device, log, enc } = mkHost(); globalThis.GPUShaderStage = { COMPUTE: 4 }; globalThis.GPUBufferUsage = { UNIFORM: 4, COPY_DST: 2 };
    const pt = createPartTiles({ device, THREE: { Matrix4: THREEM } }); await pt.warm();
    expect(pt.encode(enc, [job([])])).toBe(1); expect(log.filter(l => l[0] === 'dispatch').length).toBe(0);
    log.length = 0; pt.encode(enc, [job([[-8, 0, 300, 400]])]); expect(log.find(l => l[0] === 'dispatch')).toEqual(['dispatch', 4, 3, 2]); // (clipped to 25 x 20 tiles)
  });
});

// ---------- the display: a frame of the body and a part ----------
const withGpu = fn => async () => { for (const [k, v] of Object.entries(GPU_GLOBALS)) vi.stubGlobal(k, v); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const settle = () => new Promise(r => setTimeout(r, 0));
describe('the parts\' tiles in the display (a recording device: no GPU in CI)', () => {
  const tex = (w, d = w) => { const t = new THREEG.Data3DTexture(new Uint8Array(w * w * d * 4), w, w, d); t.format = THREEG.RGBAFormat; t.type = THREEG.UnsignedByteType; t.needsUpdate = true; return t; };
  const partU = (u, over = {}) => { const o = sceneUniforms(16); for (const k of Object.keys(u)) if (!(k in o)) o[k] = u[k]; return Object.assign(o, { regionTex: { value: tex(4) }, partField: { value: tex(16) }, partOcc: { value: tex(2) }, partKind: { value: 1 }, partId: { value: 7 }, partMask: { value: 1 }, partFieldScale: { value: new THREEG.Vector3(0.5, 0.5, 0.5) }, partFieldOff: { value: new THREEG.Vector3(0.25, 0.25, 0.25) },
    boxC: { value: new THREEG.Vector3(0, 0, 0) }, boxH: { value: new THREEG.Vector3(0.5, 0.5, 0.5) }, boxEntry: { value: 1 }, ...over }); };
  const mk = (opts = {}) => { const rec = recordingDevice({ timestamps: !!opts.timestamps }), writes = []; const w = rec.device.queue.writeBuffer; rec.device.queue.writeBuffer = (b, off, d) => { writes.push({ b, off, d: ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d?.slice ? d.slice(0) : d }); return w(b, off, d); }; return { rec, writes, r: createVrVolumeRenderer({ THREE: THREEG, device: rec.device, halfExt: [1, 1, 1], bgDelayMs: 0 }) }; };
  const V = [{ cls4: false, events: false, multi: true, parts: true, feat: { R: true } }];
  const frame = (r, u, extras, over = {}) => { r.draw({ u, cams: [eyeCam(1000, 1000), eyeCam(1000, 1000)], model: new THREEG.Matrix4(), f: 0.5, fov: false, fp: 0.5, rects: null, band: 1, variant: { cls4: false, events: false }, extras, ...over }); return r.volume.markFrame(); };
  const PU = UNIFORM_FIELDS_ALL, off = n => { let at = 0; const L = uniformLayout(PU); return L.fields.find(f => f.name === n).offset; };
  const M2 = () => new THREEG.Matrix4().makeTranslation(0.5, 0, 0);
  const writesOfParts = (writes, L) => writes.filter(w => w.d?.byteLength === L.byteSize).slice(-2).map(w => { const i = new Int32Array(w.d); return { on: i[off('proxyOn') / 4], org: [i[off('proxyOrg') / 4], i[off('proxyOrg') / 4 + 1]] }; }); // the last two uniform writes of the frame: the part's two eyes
  it('a part in the centre pass is D with tiles of its own: ONE compute pass per frame for its parts (before the render pass), a dispatch for the part; the volume pass reads them with the 8 x 8 origin of the body\'s pre-pass (proxyOn 1), not the new ways\' 4 x 4', withGpu(async () => {
    const { rec, writes, r } = mk(), u = sceneUniforms(16), pu = partU(u), L = uniformLayout(PU);
    await r.preload(u, V); await r.preload(pu, V);
    expect(rec.stats.shaders.some(c => c.includes('parts\' pre-pass (WGSL)'))).toBe(true); // made ahead with the others
    for (let i = 0; i < 3; i++) frame(r, u, [{ u: pu, model: M2(), order: 1.5, boxes: null }]);
    const s0 = r.volume.partTilesStats(); writes.length = 0; const n0 = rec.log.length;
    frame(r, u, [{ u: pu, model: M2(), order: 1.5, boxes: null }]);
    const s1 = r.volume.partTilesStats();
    expect(r.stats.vways).toEqual([expect.stringMatching(/^body /), 'part D']);
    expect(s1.state).toBe('ready'); expect(s1.passes - s0.passes).toBe(1); expect(s1.jobs - s0.jobs).toBe(1); expect(s1.tiles).toBeGreaterThan(s0.tiles);
    const lines = rec.log.slice(n0), rp = lines.findIndex(l => l.startsWith('beginRenderPass')), dispatches = lines.slice(0, rp).filter(l => l.startsWith('compute.dispatch'));
    expect(rp).toBeGreaterThan(0); expect(dispatches.length).toBeGreaterThan(0); // (the compute work is encoded in front of the render pass)
    expect(lines.filter(l => l.startsWith('beginRenderPass')).length).toBe(1); // one render pass for the frame: the part's tiles add no render pass
    const sl = r.stats.regions.slot[0], org1 = (sl + 2) - 8 * Math.ceil(sl / 8), eyes = writesOfParts(writes, L);
    expect(eyes).toEqual([{ on: 1, org: [0, 0] }, { on: 1, org: [org1, 0] }]); // (the 4 x 4 origin of eye 1 would be (sl + 2) - 4 * ceil(sl / 4))
    expect(org1).not.toBe((sl + 2) - 4 * Math.ceil(sl / 4));
    r.dispose();
  }));
  it('the periphery draws a part D0 (it has no 8 x 8 pre-pass there) and makes no tiles for it; a part whose blocks are not on the GPU is D0 in the centre pass (nothing to cone through)', withGpu(async () => {
    const { r } = mk(), u = sceneUniforms(16), pu = partU(u), pn = partU(u, { partOcc: { value: undefined } });
    await r.preload(u, V); await r.preload(pu, V);
    for (let i = 0; i < 3; i++) frame(r, u, [{ u: pu, model: M2(), order: 1.5, boxes: null }], { fov: true, rects: [[300, 300, 700, 700]] });
    const w0 = { ...r.volume.displayNp().inst.stats().byWay }, s0 = r.volume.partTilesStats();
    frame(r, u, [{ u: pu, model: M2(), order: 1.5, boxes: null }], { fov: true, rects: [[300, 300, 700, 700]] });
    const w1 = r.volume.displayNp().inst.stats().byWay, s1 = r.volume.partTilesStats();
    expect(w1.D - w0.D).toBe(1); expect(w1.D0 - w0.D0).toBe(1); expect(s1.passes - s0.passes).toBe(1); // the centre's part is D (a pass of tiles), the periphery's part D0 (none)
    frame(r, u, [{ u: pn, model: M2(), order: 1.5, boxes: null }]); expect(r.stats.vways).toEqual([expect.stringMatching(/^body /), 'part D0']); expect(r.volume.partTilesStats().passes).toBe(s1.passes);
    r.dispose();
  }));
  it('the tile program is made at the start and WAITED for: a program that does not compile ends the start with the error (a frame never falls back to drawing the part without tiles); a part frame before the program is made has no way (nothing drawn, counted)', withGpu(async () => {
    const { rec, r } = mk(), u = sceneUniforms(16), pu = partU(u), cp = rec.device.createComputePipelineAsync;
    rec.device.createComputePipelineAsync = d => (d.compute.module.code.includes('parts\' pre-pass (WGSL)') ? Promise.reject(new Error('no thanks')) : cp(d));
    await expect(r.preload(u, V)).rejects.toThrow(/tile program did not compile: no thanks/);
    rec.device.createComputePipelineAsync = cp;
    const { rec: rec2, r: r2 } = mk(), u2 = sceneUniforms(16), pu2 = partU(u2);
    await r2.preload(u2, [{ cls4: false, events: false, multi: true, feat: { R: true } }]); // (no parts flag: the data set said nothing of parts at the start: the tile program is not made ahead)
    expect(r2.volume.partTilesStats().state).toBe('none'); expect(rec2.stats.shaders.some(c => c.includes('parts\' pre-pass (WGSL)'))).toBe(false);
    frame(r2, u2, [{ u: pu2, model: M2(), order: 1.5, boxes: null }]);
    expect(r2.stats.vways[1]).toBe('part none:parttile'); expect(r2.volume.partTilesStats().passes).toBe(0); // no way for the part this frame: nothing drawn for it, no tile pass, the reason counted (never D0)
    expect(r2.volume.displayNp().inst.stats().byWay.D0 | 0).toBe(0);
    let way = ''; for (let i = 0; i < 40 && way !== 'part D'; i++) { await settle(); await new Promise(res => setTimeout(res, 5)); frame(r2, u2, [{ u: pu2, model: M2(), order: 1.5, boxes: null }]); way = r2.stats.vways[1]; }
    expect(way).toBe('part D'); expect(rec2.stats.shaders.filter(c => c.includes('parts\' pre-pass (WGSL)')).length).toBe(1); expect(r2.volume.partTilesStats().passes).toBeGreaterThan(0); expect(r2.volume.displayNp().inst.stats().byWay.D0 | 0).toBe(0);
    r.dispose(); r2.dispose();
  }));
});
