import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { smoothEditMaskOf, smoothEditMaskMemoOf, buildEditMaskOf, prepRun, prepWorkerSource, buildDistanceBytesSync } from '../../docs/vr-volume-prep.js';
import { buildClsData } from '../../docs/point-cls.js';
import { PART_FIELD } from '../../docs/vr-part-view.js';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { shaderTemplate, preprocess } from '../helpers/glsl-preprocess.js';


const OPT = { band: PART_FIELD.band, sigma: PART_FIELD.sigma, margin: PART_FIELD.margin, pad: PART_FIELD.pad };
const idx = (x, y, z, w, h) => (z * h + y) * w + x;
// a half space whose boundary is a staircase of slope 1/3 (the mask is set where z < 4 + x / 3 + y / 5 as a plain voxel test), on the grid dims, as RGBA with the mask in channel `s`
function slope(dims, s = 0) {
  const [w, h, d] = dims, data = new Uint8Array(w * h * d * 4);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[idx(x, y, z, w, h) * 4 + s] = z + 0.5 < 6 + x / 3 + y / 5 ? 255 : 0;
  return data;
}
// the 0.5 level of the LINEAR read along z for every (x, y) column (a byte >= 127.5 is inside), z in voxel-centre units; null where the column does not cross
function crossings(data, dims, s = 0) {
  const [w, h, d] = dims, out = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    for (let z = 0; z < d - 1; z++) {
      const a = data[idx(x, y, z, w, h) * 4 + s], b = data[idx(x, y, z + 1, w, h) * 4 + s];
      if (a >= 127.5 && b < 127.5) { out.push({ x, y, z: z + (a - 127.5) / (a - b) }); break; }
    }
  }
  return out;
}
// the RMS distance of the crossings from their own best plane z = a x + b y + c
function planeRms(pts) {
  const n = pts.length; let sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sz += p.z; sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y; sxz += p.x * p.z; syz += p.y * p.z; }
  // normal equations (3 x 3, Cramer)
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [sxz, syz, sz];
  const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = det(A), col = k => A.map((r, i) => r.map((v, j) => (j === k ? B[i] : v))), [a, b, c] = [0, 1, 2].map(k => det(col(k)) / D);
  let e = 0; for (const p of pts) e += (p.z - (a * p.x + b * p.y + c)) ** 2;
  return Math.sqrt(e / n);
}

describe('smoothEditMaskOf: the mask bytes become the smoothed field of the part cut', () => {
  const dims = [24, 24, 20];
  it('every voxel keeps its side of 128 (the occupancy, the distance field and the picks read what they read before)', () => {
    const data = slope(dims), before = data.slice();
    expect(smoothEditMaskOf(data, dims, 1, OPT)).toBe(1);
    for (let i = 0; i < data.length; i += 4) expect(data[i] >= 128).toBe(before[i] >= 128);
  });
  it('the 0.5 level of the LINEAR read is a flatter surface than the 0 / 255 staircase (the plane fit residual drops by at least a third)', () => {
    const data = slope(dims), before = planeRms(crossings(data, dims));
    smoothEditMaskOf(data, dims, 1, OPT);
    const after = planeRms(crossings(data, dims));
    expect(after).toBeLessThan(before * 0.67);
  });
  it('other channels and a channel that is all on one side are not touched; a channel not asked for stays 0 / 255', () => {
    const data = slope(dims, 0), n = dims[0] * dims[1] * dims[2];
    for (let i = 0; i < n; i++) data[i * 4 + 1] = 255; // channel 1: all allowed
    const second = slope(dims, 2); for (let i = 0; i < n; i++) data[i * 4 + 2] = second[i * 4 + 2];
    const before = data.slice();
    expect(smoothEditMaskOf(data, dims, 0b011, OPT)).toBe(1); // channel 0 smoothed, 1 uniform (nothing to do), 2 not asked for
    for (let i = 0; i < n; i++) { expect(data[i * 4 + 1]).toBe(255); expect(data[i * 4 + 2]).toBe(before[i * 4 + 2]); expect(data[i * 4 + 3]).toBe(0); }
    expect(data.some((v, i) => i % 4 === 0 && v !== before[i] && v !== 0 && v !== 255)).toBe(true);
  });
  it('only a box round the boundary is computed: far from it the bytes are the saturated 0 / 255 the mask was', () => {
    const big = [40, 40, 40], data = new Uint8Array(big[0] * big[1] * big[2] * 4);
    for (let z = 0; z < 40; z++) for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) data[idx(x, y, z, 40, 40) * 4] = Math.hypot(x - 20, y - 20, z - 20) < 6 ? 255 : 0;
    smoothEditMaskOf(data, big, 1, OPT);
    expect(data[idx(20, 20, 20, 40, 40) * 4]).toBe(255);
    expect(data[idx(0, 0, 0, 40, 40) * 4]).toBe(0);
    expect(data[idx(39, 20, 20, 40, 40) * 4]).toBe(0);
    // and some voxel by the boundary really is in between
    expect(Array.from({ length: 14 }, (_, i) => data[idx(20 + i, 20, 20, 40, 40) * 4]).some(v => v > 0 && v < 255)).toBe(true);
  });
});

describe('the classification fold (point-cls.js)', () => {
  // the fold as it was before n730 (rat brain voxel look), verbatim
  const oldFold = (f, mb, maskOnly) => { if (mb < 128) return 0; if (maskOnly && f < 191) return 191; return f; };
  it('a 0 / 255 mask gives exactly the old bytes (every f, masked or mask-only)', () => {
    for (const maskOnly of [false, true]) for (const mb of [0, 255]) for (let f = 0; f <= 255; f++) {
      // one voxel: hu such that f = round((0.5 + dd / 2048) * 255) is hit by dd = (f / 255 - 0.5) * 2048 inside the range [0, 4095]
      const dd = (f / 255 - 0.5) * 2048, hu = Math.round(dd) + 0, vol = new Uint8Array([hu & 255, (hu >> 8) & 255]);
      if (hu < 0) continue;
      const edit = { data: new Uint8Array([mb, 0, 0, 0]), dims: [1, 1, 1], active: 1, maskOnly: maskOnly ? 1 : 0 };
      const cls = buildClsData({ dims: [1, 1, 1], data: vol }, [1, 0, 0], edit, { soft: { active: true, enabled: true, min: 0, max: 100000 } }, ['soft', 'bone', 'fat', 'lung']);
      const f0 = Math.max(0, Math.min(255, Math.round((0.5 + Math.min(hu - 0, 100000 - hu) / 2048) * 255)));
      expect(cls.data[0]).toBe(oldFold(f0, mb, maskOnly));
    }
  });
  it('a smoothed byte: the smaller of the range value and the mask value; a mask-only segment is the mask field alone (floored at 191 far inside)', () => {
    const vol = new Uint8Array([0x00, 0x04]); // hu 1024: f = 255 (dd 1024 -> 0.5 + 0.5 = 1)
    const run = (mb, maskOnly) => buildClsData({ dims: [1, 1, 1], data: vol }, [1, 0, 0], { data: new Uint8Array([mb, 0, 0, 0]), dims: [1, 1, 1], active: 1, maskOnly: maskOnly ? 1 : 0 }, { soft: { active: true, enabled: true, min: 0, max: 100000 } }, ['soft', 'bone', 'fat', 'lung']).data[0];
    expect(run(140, false)).toBe(140);
    expect(run(100, false)).toBe(100);
    expect(run(140, true)).toBe(140);
    expect(run(100, true)).toBe(100);
    expect(run(255, true)).toBe(255);
  });
});

describe('the worker job', () => {
  const dims = [20, 20, 20], n = 8000;
  const src = new Uint8Array(n * 2); for (let i = 0; i < n; i++) { src[2 * i] = 1000 & 255; src[2 * i + 1] = 1000 >> 8; }
  const runsOf = () => { const runs = []; for (let z = 0; z < 20; z++) { const r = []; for (let y = 0; y < 20; y++) if (z < 12 + (y >> 2)) r.push(y, 0, 19); runs.push(Uint32Array.from(r)); } return runs; };
  const job = extra => ({ t: 'cls', id: 1, src: src.slice().buffer, dims, calib: [1, 0, 0], editDescs: [{ si: 0, mode: 'keep', maskOnly: false, runs: runsOf() }], editSourceDims: dims, regionItems: [], childItems: [], order: ['soft', 'bone', 'fat', 'lung'], state: { soft: { active: true, enabled: true, min: 0, max: 4095 } }, brickDimsFull: [3, 3, 3], brickDimsHalf: null, mask: 1, ...extra });
  const run = m => { let out = null; prepRun(m, r => { if (r.t === 'cls' || r.t === 'error') out = r; }); return out; };
  it('without maskField the answer is what it was (0 / 255 bytes); with it the sides, the distance field and the combined texture are the same, the bytes between are smooth', () => {
    const a = run(job({})), b = run(job({ maskField: OPT }));
    expect(a.edit.data.every((v, i) => i % 4 !== 0 || v === 0 || v === 255)).toBe(true);
    expect(b.edit.data.some((v, i) => i % 4 === 0 && v > 0 && v < 255)).toBe(true);
    for (let i = 0; i < n; i++) { expect(b.edit.data[i * 4] >= 128).toBe(a.edit.data[i * 4] >= 128); expect(b.cls.data[i * a.cls.C] >= 128).toBe(a.cls.data[i * a.cls.C] >= 128); }
    expect(Array.from(b.dist.data)).toEqual(Array.from(a.dist.data));
    expect(b.warnings).toEqual([]);
  });
  it('after the thin-keep / #239 merge: editTex (what gradientAtS reads) is still the SMOOTHED field, while the classification bytes of the shape are hard 0 / 255 on the mask side', () => {
    const b = run(job({ maskField: OPT }));
    const mid = b.edit.data.filter((v, i) => i % 4 === 0 && v > 0 && v < 255).length;
    expect(mid).toBeGreaterThan(50); // the field a normal can be taken from
    for (let i = 0; i < n; i++) expect(b.edit.data[i * 4] >= 128).toBe(b.cls.data[i * b.cls.C] >= 128); // the shape's sides are the mask's
    const gsrc = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    const fn = gsrc.slice(gsrc.indexOf('vec3 gradientAtS('), gsrc.indexOf('#define gradientAt(tc)'));
    expect(fn).toContain('texture(editTex,');
  });
  it('only the classified slots are smoothed: a mask on a slot that is not active stays 0 / 255', () => {
    const b = run(job({ maskField: OPT, state: { soft: { active: false, enabled: false, min: 0, max: 4095 } } }));
    expect(b.edit.data.every((v, i) => i % 4 !== 0 || v === 0 || v === 255)).toBe(true);
  });
  it('the worker source carries the smoothing (self-contained: partFieldOf and smoothEditMaskOf are in it)', () => {
    const text = prepWorkerSource();
    expect(text).toMatch(/function partFieldOf\(/);
    expect(text).toMatch(/function smoothEditMaskOf\(/);
    expect(typeof buildEditMaskOf).toBe('function');
    expect(typeof buildDistanceBytesSync).toBe('function');
  });
});

describe('the VR shader: the normal at a mask-defined surface', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('gradientAtS is compiled in EVERY program (n731 fix2: VR and AR, useCls 1 and 0, with and without child segments / results, VRL_PART, mediump) and the call sites are re-pointed by one #define', () => {
    expect(src).not.toContain('#ifdef VRL_CHILDREN\nvec3 gradientAtS(vec3 tc,int s){');
    expect(src).toContain('\nvec3 gradientAtS(vec3 tc,int s){');
    expect(src).toContain('#define gradientAt(tc) gradientAtS(tc,idx)\nvoid main(){');
    expect(src.match(/gradientAt\(tc\)/g).length).toBeGreaterThanOrEqual(8); // the two ternary forms x four sites (tests/unit/lighting.test.js / hidden-neighbour.test.js count them)
    const t = shaderTemplate(src); let n = 0;
    for (const med of [0, 1]) for (const reg of [0, 1]) for (const ch of [0, 1]) for (const part of [0, 1]) for (const cls4 of [0, 1]) for (const v of [[], ['VRL_NO_GENERAL', 'VRL_OPAQUE'], ['VRL_NO_GENERAL', 'VRL_NO_EVENTS', 'VRL_OPAQUE']]) {
      const text = preprocess(t, new Set([...v, ...(med ? ['VRL_MEDIUMP'] : []), ...(reg ? ['VRL_REGIONS'] : []), ...(ch ? ['VRL_CHILDREN'] : []), ...(part ? ['VRL_PART'] : []), ...(cls4 ? ['VRL_CLS4'] : [])]));
      expect(text, 'program ' + [...v, med, reg, ch, part, cls4].join(',')).toContain('vec3 gradientAtS(vec3 tc,int s){');
      expect(text).toContain('#define gradientAt(tc) gradientAtS(tc,idx)');
      n++;
    }
    expect(n).toBe(96);
  });
  it('it reads editTex (the smoothed field, LINEAR) within 0.3 of its 0.5 level (a mask-only slot: always, and a zero gradient is the flat normal, never the HU gradient) and falls back to the HU gradient only for a HU-range surface', () => {
    const fn = src.slice(src.indexOf('vec3 gradientAtS('), src.indexOf('#define gradientAt(tc)'));
    expect(fn).toContain(' if(s>=0&&((editMask>>s)&1)==1){');
    expect(fn).not.toContain('useCls>0');
    expect(fn).toContain('bool md=((editMaskOnly>>s)&1)==1;');
    expect(fn).toContain('if(md||abs(texture(editTex,tq)[s]-0.5)<0.3){');
    expect(fn).toContain('return vec3(0.0,0.0,1.0);');
    expect(fn.indexOf('return gradientAt(tc);')).toBeGreaterThan(fn.indexOf('return vec3(0.0,0.0,1.0);'));
    expect(fn.match(/highp/g).length).toBeGreaterThanOrEqual(5); // Quest mediump / fp16: the normal is computed in explicit highp
    expect(fn).toContain('return gradientAt(tc);');
    expect(fn).toContain('gHuMean=-1e9');
  });
  it('the preparation asks for the smoothing (maskField) and the cache version is bumped', () => {
    expect(src).toMatch(/maskField:\{band:PART_FIELD\.band,sigma:PART_FIELD\.sigma,margin:PART_FIELD\.margin,pad:PART_FIELD\.pad\}/);
    expect(+/const VR_PREP_VERSION=(\d+);/.exec(src)[1]).toBeGreaterThanOrEqual(11);
  });
});

describe('n731 fix2 (item 4): a hit on the mask surface is always inside the +-0.3 band of the field, so the HU gradient is never reached there', () => {
  it('a curved (sphere) mask: at both voxel centres of every boundary pair (the hit lies between them) |field - 0.5| stays well under 0.3', () => {
    const dims = [24, 24, 24], [w, h, d] = dims, data = new Uint8Array(w * h * d * 4);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[idx(x, y, z, w, h) * 4] = Math.hypot(x - 11.5, y - 11.5, z - 11.5) < 8 ? 255 : 0;
    const plain = data.slice(); smoothEditMaskOf(data, dims, 1, OPT);
    let mx = 0, pairs = 0;
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      if (x + dx >= w || y + dy >= h || z + dz >= d) continue;
      const a = idx(x, y, z, w, h) * 4, b = idx(x + dx, y + dy, z + dz, w, h) * 4;
      if ((plain[a] >= 128) !== (plain[b] >= 128)) { pairs++; mx = Math.max(mx, Math.abs(data[a] / 255 - 0.5), Math.abs(data[b] / 255 - 0.5)); }
    }
    expect(pairs).toBeGreaterThan(100);
    expect(mx).toBeLessThan(0.2); // measured 0.124
  });
});

describe('n731 fix2: the PC volumes light a mask-defined surface by the smoothed mask field (normal only; the shape stays the plain mask)', () => {
  const mv = readFileSync(new URL('../../docs/medical-volume.js', import.meta.url), 'utf8');
  const wv = readFileSync(new URL('../../docs/webgl-volume.js', import.meta.url), 'utf8');
  it('WebGPU: the hit normal takes editFieldNormal (binding 15) where the slot has a mask, turned so that inward is the field rise; membership still reads the voxel mask', () => {
    expect(mv).toContain('@group(0) @binding(15) var editFieldTex:texture_3d<f32>;');
    expect(mv).toContain('let fv=editFieldNormal(u32(idx),tc,dir);if(fv.w>0.5){n=select(-fv.xyz,fv.xyz,hvPrev<-1e8||hvPrev<a.x);}');
    // never the HU gradient on a masked slot: no field bound yet (or a zero gradient) = the ray (flat); a mask-only slot has no band
    expect(mv).toContain('if(fd.x<2.0){return editBlurNormal(seg,tc,dir);}');
    expect(mv).toContain('fn editBlurNormal(seg:u32,tc:vec3<f32>,dir:vec3<f32>)->vec4<f32>{');
    expect(mv).toContain('let md=(editRows[1]&(16u<<seg))!=0u;');
    expect(mv).toContain('if(!md&&abs(editFieldAt(seg,tc)-0.5)>=0.3){return vec4<f32>(0.0);}');
    expect(mv).toContain('if(l<1e-6){return vec4<f32>(dir,1.0);}');
    expect(mv).not.toContain('the plain mask is the field');
    expect(mv).toContain("{binding:15,resource:(this.editFieldTexture||this.editFieldDummy()).createView({dimension:'3d'})}");
    const allows = mv.slice(mv.indexOf('fn editAllows(seg:u32'), mv.indexOf('\n}', mv.indexOf('fn editAllows(seg:u32')));
    expect(allows.length).toBeGreaterThan(100);
    expect(allows).not.toContain('editFieldTex');
  });
  it('WebGL: gradientAtS reads editFieldTex (the smoothed copy), editTex stays the plain mask', async () => {
    installDomStub();
    const { FIELD_SHADER_PATCHES, patchFragmentShader } = await importApp('webgl-volume');
    const { fragmentShader: frag } = await importApp('vr-view');
    const names = FIELD_SHADER_PATCHES.map(p => p.name);
    for (const n of ['child-field-uniform', 'child-field-size', 'child-field-md', 'child-field-band', 'child-field-grad']) expect(names).toContain(n);
    // applied to EVERY shader, with and without child segments (n731 fix2)
    for (const children of [false, true]) {
      const out = patchFragmentShader(frag, { children });
      const fn = out.slice(out.indexOf('vec3 gradientAtS('), out.indexOf('#define gradientAt(tc)'));
      expect(fn, 'children=' + children).toContain('editFieldTex');
      expect(fn).not.toMatch(/texture\(editTex|textureSize\(editTex/); // the normal reads the smoothed copy only
      expect(fn).toContain('||editFieldReady<1;'); // no field yet / failed: the blurred plain mask, not the HU gradient
      expect(fn).toContain('maskBlurGrad(k,tc,dd,s)');
      expect(out).toContain('highp float maskBlurGrad(int k,');
    }
    expect(wv).toContain('runEditMaskField(smoothEditMaskOf, data, dims, slots, PART_FIELD)');
    expect(wv).toContain('u.editFieldTex.value = this.editFieldTexture || this.editTexture || this.dummy; u.editFieldReady.value = this.editFieldTexture ? 1 : 0;');
    expect(wv).toContain('this.uniforms.editFieldReady.value = 1;');
  });
});

describe('smoothEditMaskMemoOf (#239 (3)): the smoothing remembered per slot by the raw bytes', () => {
  const dims = [24, 24, 20], n = dims[0] * dims[1] * dims[2];
  const make = () => { const d = slope(dims, 0), second = slope(dims, 2); for (let i = 0; i < n; i++) { d[i * 4 + 2] = second[i * 4 + 2]; d[i * 4 + 1] = 255; } return d; };
  it('the first call makes the very bytes of smoothEditMaskOf; the second, from the memory, makes them again without smoothing', () => {
    const ref = make(); smoothEditMaskOf(ref, dims, 0b111, OPT);
    const a = make(), r1 = smoothEditMaskMemoOf(a, dims, 0b111, OPT, []);
    expect(Buffer.from(a).equals(Buffer.from(ref))).toBe(true);
    expect(r1.fresh.length).toBe(2); // slots 0 and 2 hold the same bytes: one entry
    const b = make(), r2 = smoothEditMaskMemoOf(b, dims, 0b111, OPT, r1.fresh);
    expect(Buffer.from(b).equals(Buffer.from(ref))).toBe(true);
    expect(r2.fresh.length).toBe(0);
    const c = make(), r3 = smoothEditMaskMemoOf(c, dims, 0b101, OPT, r1.fresh); // another set of slots: the same per-slot bytes
    const ref3 = make(); smoothEditMaskOf(ref3, dims, 0b101, OPT);
    expect(Buffer.from(c).equals(Buffer.from(ref3))).toBe(true); expect(r3.fresh.length).toBe(0);
  });
  it('a changed mask is not taken from the memory', () => {
    const a = make(), r1 = smoothEditMaskMemoOf(a, dims, 1, OPT, []);
    const b = make(); b[0] = 255 - b[0]; const ref = b.slice(); smoothEditMaskOf(ref, dims, 1, OPT);
    const r2 = smoothEditMaskMemoOf(b, dims, 1, OPT, r1.fresh);
    expect(r2.fresh.length).toBe(1); expect(Buffer.from(b).equals(Buffer.from(ref))).toBe(true);
  });
});
