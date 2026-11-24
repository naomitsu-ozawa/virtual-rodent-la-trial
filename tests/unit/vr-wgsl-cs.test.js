// The compute-march variants of the WebGPU breakdown (docs/vr-wgsl-cs.js texts, docs/vr-wgpu-cs.js host, docs/vr-perf-log.js entries):
// (1) the generated WGSL: every variant parses, shares the display's march text, the table of variants agrees across the three files;
// (2) the pure helpers: Morton order, the indirect dispatch arguments, the inverse matrix, the list flags;
// (3) a CPU model of the march and of what each variant changes in it (the cooperative tile start, the neighbours' balls, the stopped and resumed march), run on synthetic grids and cameras: every variant must give the
//     same hit state (segment, bracket, f0 / f1, search count, iso, grid point k*) as the single ray's own march from k = 0 on every ray, with negative controls that are not conservative and must be caught;
// (4) the host with a mock device (nothing is made before the first compute shadow pass, the passes and dispatches of each variant, the indirect chain).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';
import * as THREEG from 'three/webgpu';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { euclideanDistanceBytes, combineClassificationDistance } from '../../docs/distance-field.js';
import { volumeWgsl, PROXY, uniformLayout } from '../../docs/vr-wgsl-core.js';
import { CS, CS_VARIANTS, CS_NAMES, CS_MODES, CS_FIELDS, csLayout, csWgsl, csArgsWgsl, csDiffWgsl, vposWgsl, MORTON_DECODE_WGSL, MORTON_ENCODE_WGSL, mortonDecode, mortonEncode, indirectArgs, invert4, packHitFlags, unpackHitFlags, packContFlags, unpackContFlags } from '../../docs/vr-wgsl-cs.js';
import { BD_VARIANTS, BD_SPECS, CS_BD_VARIANTS, createVolBreakdown } from '../../docs/vr-perf-log.js';
import { createVrVolumeRenderer, gxShaderInfo } from '../../docs/vr-wgpu.js';

const parse = t => new WgslReflect(t);
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ======================================================================================================
describe('the generated WGSL', () => {
  const combos = [];
  for (const f16 of [false, true]) for (const cls4 of [false, true]) for (const [mode, sg] of [['full', false], ['tile', false], ['tile', true], ['share', false], ['share', true], ['march', false], ['shade', false]]) combos.push({ f16, cls4, mode, sg });
  it.each(combos.map(c => [JSON.stringify(c), c]))('%s: parses, has its entry points, no fragment-only statement', (_l, c) => {
    const t = csWgsl(c), r = parse(t);
    expect(t).not.toMatch(/\bdiscard\b/);
    expect(t).not.toMatch(/undefined|NaN/);
    const entries = r.entry.compute.map(e => e.name);
    if (c.mode === 'march') expect(entries).toEqual(['csMarchPix', 'csMarchList']); else if (c.mode === 'shade') expect(entries).toEqual(['csShadeList']); else expect(entries).toEqual(['csMain']);
    expect(t.startsWith((c.sg ? 'enable subgroups;\n' : '') + (c.f16 ? 'enable f16;\n' : ''))).toBe(true);
    if (!c.sg) expect(t).not.toMatch(/subgroup/);
  });
  it('the args kernel, the vPos pass and the comparison parse; the args text has the arguments rule of indirectArgs, the vPos pass has the display\'s vertex stage byte for byte', () => {
    const a = csArgsWgsl(); expect(parse(a).entry.compute.map(e => e.name)).toEqual(['main']);
    expect(a).toContain('let n=min(atomicLoad(&cnt[au.src]),au.cap);'); expect(a).toContain('let x=min((n+63u)/64u,65535u);'); expect(a).toContain('args[au.dst*4u]=x;args[au.dst*4u+1u]=1u;args[au.dst*4u+2u]=1u;');
    const v = vposWgsl(), r = parse(v); expect(r.entry.vertex.map(e => e.name)).toEqual(['vs']); expect(r.entry.fragment.map(e => e.name)).toEqual(['fsPos']);
    const d = volumeWgsl({ events: false }), vs = d.slice(d.indexOf('struct VOut{'), d.indexOf('struct FOut{')); expect(vs).toContain('@vertex fn vs('); expect(v).toContain(vs);
    expect(v).toContain('return vec4<f32>(in.vPos,in.pos.z);');
    expect(parse(csDiffWgsl()).entry.compute.map(e => e.name)).toEqual(['main']);
  });
  it('the compute march is the display\'s march text: the ray set-up through the loop and the hit search / shading are the same lines (only the fragment inputs, the discards and the creep skip switch differ)', () => {
    const disp = volumeWgsl({ events: false }), full = csWgsl({ mode: 'full' });
    const seg = (t, a, b) => t.slice(t.indexOf(a), t.indexOf(b));
    const sub = x => x.split('in.pos.z').join('posIn.z').split('in.vPos').join('vPosIn').split('in.pos.xy').join('posIn.xy').split('discard;').join('gDiscard=true;').split('let skipOn=u.useSkip>0&&u.diag!=4;').join('let skipOn=false;');
    expect(seg(full, ' var fo:FOut', '\n if(hitIdx>=0){')).toBe(sub(seg(disp, ' var fo:FOut', '\n if(hitIdx>=0){')));
    expect(seg(full, '\n if(hitIdx>=0){', '// compute variant: mode=')).toBe(sub(disp.slice(disp.indexOf('\n if(hitIdx>=0){'))));
    // the functions above the fragment function (march helpers, gradient, lighting) are the display's too
    expect(full.slice(full.indexOf('fn encDepth('), full.indexOf('fn fsMain('))).toBe(disp.slice(disp.indexOf('fn encDepth('), disp.indexOf('@fragment fn fs(')));
    expect(full).toContain('let skipOn=false;');
  });
  it('the display text itself is not touched by making the compute texts', () => {
    const before = volumeWgsl({ events: false }); for (const c of combos) csWgsl(c); expect(volumeWgsl({ events: false })).toBe(before);
  });
  it('the variants are events: false only (a section run takes the display\'s own text from k = 0): the generator is made from that text and says so', () => {
    expect(csWgsl({ mode: 'full' })).toContain('variant f16=false cls4=false events=false (compute)');
  });
  it('csTile: the pre-pass\'s start rule is kept (tA past the ray\'s end = no march, else k = floor((tA - t0) / stp) - 1) but tA is the workgroup\'s own; the cone constants are the pre-pass\'s (one table PROXY)', () => {
    const t = csWgsl({ mode: 'tile' }), disp = volumeWgsl({ events: false });
    expect(disp).toContain('let tA=textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/8,0).r;');
    expect(t).toContain('let tA=gTileA;'); expect(t).not.toContain('textureLoad(proxyTex'); expect(t).toContain('if(true){');
    expect(t).toContain('if(tA>endT){emptyRay=true;}else if(tA>t0){k=max(0,i32(floor((tA-t0)/stp))-1);}');
    expect(t).toContain('var hh=dBox-0.05*vm-rC;'); expect(t).toContain('let rho=(dd-1.8-0.05)*vm;hh=max(hh,rho-dBox-rC);'); expect(t).toContain('q[c]>=0.5-0.002');
    expect(t).toContain('tCh=max(max(length(d00-a),length(d10-a)),max(length(d01-a),length(d11-a)))+0.0001;');
    expect(t).toContain('let x1=f32(min(u32(cp.vw),wg.x*8u+8u)-1u);');
    expect(t).toContain('let nx=(px+0.5)/f32(cp.vw)*2.0-1.0;let ny=1.0-(py+0.5)/f32(cp.vh)*2.0;'); expect(t).toContain('let c=cp.inv*vec4<f32>(nx,ny,0.5,1.0);');
    expect(t).toContain('let s=lo+(f32(li)+0.5)/64.0*win;'); expect(t).toContain('for(var r=0;r<3;r++){'); expect(t).toContain('tWin=win/8.0;'); expect(t).toContain('var<workgroup> tS:array<f32,64>;');
    // barriers: every thread of the workgroup runs them (the kernel has no early return before them)
    expect(t.slice(t.indexOf('@compute'))).not.toMatch(/return;/);
    expect(csWgsl({ mode: 'tile', sg: true })).toContain('let el=subgroupElect();let mn=subgroupMin(endV);let an=subgroupAny(covV);');
  });
  it('csShare: the loop is a lock-step loop the workgroup leaves together (barrier + workgroupUniformLoad), the threads that end early stay in it, the early discards before it only mark the thread; the skip rule is the jump\'s (m = floor(rem * jkA / stp) >= 1, on the thread\'s own sample point, never on the entry sample)', () => {
    for (const sg of [false, true]) {
      const t = csWgsl({ mode: 'share', sg });
      expect(t.split('gDiscard=true;return fo;')).toHaveLength(2); // only the one after the loop is left
      expect(t).toContain('let shNA=workgroupUniformLoad(&shN[shPar]);'); expect(t).toContain('workgroupBarrier();');
      expect(t).toContain('if(t>faceT&&u.jumpOn!=0){'); expect(t).toContain('let m=i32(floor((bestRem-0.02)*jkA/stp));');
      expect(t).toContain('if(m>=1){let nextJ=t0+f32(k+m)*stp;jumpLen+=nextJ-t;previousT=nextJ-stp*0.05;prevValid=false;chk=false;k+=m;continue;}');
      expect(t).toContain('if(dd>=2.7&&u.jumpOn!=0){myBall=vec4<f32>(tcS*u.texDims,dd-1.8);}');
      expect(t).toContain('let pS=cl(tcO+tcD*t)*u.texDims;');
      expect(t.includes('shBall')).toBe(!sg); expect(t.includes('subgroupShuffleXor')).toBe(sg);
      expect(t.slice(t.indexOf('@compute'))).not.toMatch(/return;/);
    }
  });
  it('csMarch / csShade: the hit state crosses the list whole (flags carry idx, iso, simple, nb), the continuation carries k, iter, previousT, prevF, prevValid, chk, lastIndex; the shade kernel does not run the loop', () => {
    const m = csWgsl({ mode: 'march' }), s = csWgsl({ mode: 'shade' });
    expect(m).toContain('(u32(hitIdx)&3u)|select(0u,4u,hitIso)|select(0u,8u,hitSimple)|select(0u,16u,hitNb==6)');
    expect(m).toContain('select(0u,1u,prevValid)|select(0u,2u,chk)|(u32(lastIndex+1)<<2u)');
    expect(m).toContain('if(gResume){k=gRk;previousT=gRprev;prevF=gRF;prevValid=(gRflags&1u)!=0u;chk=(gRflags&2u)!=0u;lastIndex=i32((gRflags>>2u)&7u)-1;}');
    expect(m).toContain('for(;iterO<iterStop;iterO++){'); expect(m).toContain('let iterStop=min(4096,gStop);');
    expect(s).not.toMatch(/for\(var iter/); expect(s).toContain('hitIdx=gSIdx;hitLo=gSLo;hitHi=gSHi;hitF0=gSF0;hitF1=gSF1;'); expect(s).toContain('hitNb=select(2,6,(gSFlags&16u)!=0u);');
    expect(s).toContain('if(i>=n){return;}'); expect(m).toContain('if(i>=n){return;}');
    expect(m).toContain('if(s<u32(cp.cap))'); // an append past the capacity is counted, not written
  });
  it('the table of variants agrees: the shader file, the breakdown\'s table (specs) and the collector\'s names', () => {
    expect(CS_NAMES).toEqual(CS_BD_VARIANTS); expect(BD_VARIANTS.slice(-CS_NAMES.length)).toEqual(CS_NAMES);
    for (const n of CS_NAMES) { expect(BD_SPECS[n].name).toBe(n); expect(BD_SPECS[n].cs).toBeTruthy(); expect(BD_SPECS[n].abl).toBeUndefined(); expect(BD_SPECS[n].overrides).toBeUndefined(); expect(!!BD_SPECS[n].sg).toBe(!!CS_VARIANTS[n].sg); }
    expect(CS_MODES).toEqual(['full', 'march', 'shade', 'tile', 'share']);
    expect(CS_VARIANTS.csHit.waves).toBe(1); expect(CS.wave.waves).toBeGreaterThanOrEqual(2);
  });
  it('the compiler messages of a compute module have a key of their own in the diagnostics', async () => {
    const d = { values: {}, value(k, v) { this.values[k] = v; }, stage() {}, error() {} }; const mod = { getCompilationInfo: async () => ({ messages: [] }) };
    gxShaderInfo(d, mod, { cs: 'full', f16: false, cls4: false }); gxShaderInfo(d, mod, { cs: 'tile', sg: true, f16: false, cls4: true }); gxShaderInfo(d, mod, { f16: false, cls4: false, events: false });
    await new Promise(r => setTimeout(r, 0)); expect(Object.keys(d.values)).toEqual(['wgsl cs full', 'wgsl cs tile sg c4', 'wgsl c3n']);
  });
  it('the uniform block of the compute kernels is laid out by the WGSL rules and its struct is declared in the module', () => {
    const l = csLayout(); expect(l.byteSize % 16).toBe(0); expect(l.fields.find(f => f.name === 'inv').offset).toBe(0);
    expect(l.fields.find(f => f.name === 'org').offset).toBe(64); expect(l.fields.find(f => f.name === 'vx').offset).toBe(76);
    const r = parse(csWgsl({ mode: 'tile' })), st = r.structs.find(x => x.name === 'CU');
    expect(st.members.map(m => m.name)).toEqual(CS_FIELDS.map(f => f[0])); expect(st.size).toBe(l.byteSize);
    expect(l.byteSize).toBe(uniformLayout(CS_FIELDS).byteSize);
  });
});

// ======================================================================================================
describe('Morton order, the indirect arguments, the inverse, the list flags', () => {
  it('Morton: a bijection of the 64 threads onto the 8 x 8 tile, x from the even bits and y from the odd bits, and the inverse', () => {
    const seen = new Set();
    for (let i = 0; i < 64; i++) { const [x, y] = mortonDecode(i); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(8); expect(y).toBeLessThan(8); seen.add(y * 8 + x); expect(mortonEncode(x, y)).toBe(i); }
    expect(seen.size).toBe(64);
    // Z order: the first 4 threads are a 2 x 2 block, the first 16 a 4 x 4 block, the first 32 an 8 x 4 block
    const box = n => { const p = Array.from({ length: n }, (_, i) => mortonDecode(i)), xs = p.map(a => a[0]), ys = p.map(a => a[1]); return [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1]; };
    expect(box(4)).toEqual([2, 2]); expect(box(16)).toEqual([4, 4]); expect(box(32)).toEqual([8, 4]); expect(box(64)).toEqual([8, 8]);
  });
  it('the WGSL text of the two Morton functions computes what the JS twins compute (the text is turned into JS and run over all 64 inputs)', () => {
    const dec = MORTON_DECODE_WGSL.replace('fn cMorton(i:u32)->vec2<u32>{return vec2<u32>(', 'return [').replace(/\);\}$/, '];').replace(/(\d)u/g, '$1');
    const fd = new Function('i', dec), enc = MORTON_ENCODE_WGSL.replace('fn cMortonEnc(x:u32,y:u32)->u32{return ', 'return ').replace(/;\}$/, ';').replace(/(\d)u/g, '$1');
    const fe = new Function('x', 'y', enc);
    for (let i = 0; i < 64; i++) { expect(fd(i)).toEqual(mortonDecode(i)); const [x, y] = mortonDecode(i); expect(fe(x, y)).toBe(i); }
  });
  it('indirectArgs: ceil(n / 64) workgroups in x, 1, 1; the count is clamped to the capacity first and the groups to 65535', () => {
    expect(indirectArgs(0)).toEqual([0, 1, 1]); expect(indirectArgs(1)).toEqual([1, 1, 1]); expect(indirectArgs(64)).toEqual([1, 1, 1]); expect(indirectArgs(65)).toEqual([2, 1, 1]); expect(indirectArgs(128)).toEqual([2, 1, 1]);
    expect(indirectArgs(1000, 100)).toEqual([2, 1, 1]); // 100 entries fit: 2 groups, not 16
    expect(indirectArgs(64 * 65535 + 1)).toEqual([65535, 1, 1]); expect(indirectArgs(1e9)).toEqual([65535, 1, 1]);
    // a list of one eye's pixels (the largest region the host allows: listBytesMax / 24 bytes) is within the group limit
    expect(Math.ceil(CS.listBytesMax / (CS.hitStride * 4) / 64)).toBeLessThanOrEqual(65535);
  });
  it('invert4 is the matrix inverse (column-major): against three.js on projection * view products; a singular matrix gives null', () => {
    const r = rng(5);
    for (let i = 0; i < 20; i++) {
      const P = new THREE.Matrix4().makePerspective(-r() - 0.2, r() + 0.2, r() + 0.2, -r() - 0.2, 0.1, 40 + r() * 10), V = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)).setPosition(r() * 4, r() * 4, r() * 4 + 2);
      const M = new THREE.Matrix4().multiplyMatrices(P, V), I = M.clone().invert(), mine = invert4(M.elements);
      for (let k = 0; k < 16; k++) expect(mine[k]).toBeCloseTo(I.elements[k], 6);
    }
    expect(invert4(new Array(16).fill(0))).toBeNull(); expect(invert4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])).toBeNull();
  });
  it('the flags words: hit (idx, iso, simple, nb 2 / 6) and continuation (prevValid, chk, lastIndex -1..3) round-trip', () => {
    for (const idx of [0, 1, 2, 3]) for (const iso of [false, true]) for (const simple of [false, true]) for (const nb of [2, 6]) expect(unpackHitFlags(packHitFlags({ idx, iso, simple, nb }))).toEqual({ idx, iso, simple, nb });
    for (const prevValid of [false, true]) for (const chk of [false, true]) for (const lastIndex of [-1, 0, 1, 2, 3]) expect(unpackContFlags(packContFlags({ prevValid, chk, lastIndex }))).toEqual({ prevValid, chk, lastIndex });
  });
});

// ======================================================================================================
// the CPU model: the march of one ray (docs/vr-wgsl-core.js, events off, hitSimple off, refine 1, useSkip 0, jumps on) as a state machine, one loop iteration per step, and what each variant changes in it
const SEG_OFF = 1.0e9;
function makeGrid(rand, { dims, halfExt, nBlobs, border }) {
  const [W, H, D] = dims, n = W * H * D, bl = [];
  for (let i = 0; i < nBlobs; i++) { const rs = i < 2 ? 3 + rand() * 6 : 1 + rand() * 3; bl.push({ c: [6 + rand() * (W - 12), 6 + rand() * (H - 12), 6 + rand() * (D - 12)], r: [rs * (0.7 + rand() * 0.6), rs * (0.7 + rand() * 0.6), rs * (0.7 + rand() * 0.6)], ch: i % 2 }); }
  if (border) { bl.push({ c: [-1, H / 2, D / 2], r: [5, 6, 6], ch: 0 }); bl.push({ c: [W / 2, H + 1, D / 3], r: [6, 4, 6], ch: 1 }); }
  const cls = new Uint8Array(n * 2);
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (z * H + y) * W + x, sd = [1e9, 1e9];
    for (const b of bl) { const q = Math.hypot((x - b.c[0]) / b.r[0], (y - b.c[1]) / b.r[1], (z - b.c[2]) / b.r[2]); sd[b.ch] = Math.min(sd[b.ch], (q - 1) * Math.min(...b.r)); }
    for (let ch = 0; ch < 2; ch++) cls[i * 2 + ch] = Math.max(0, Math.min(255, Math.round(127.5 - sd[ch] * 40)));
  }
  const dist = new Uint8Array(n * 2), inside = new Uint8Array(n);
  for (let ch = 0; ch < 2; ch++) { for (let i = 0; i < n; i++) inside[i] = cls[i * 2 + ch] >= 128 ? 1 : 0; const d = euclideanDistanceBytes(inside, dims); for (let i = 0; i < n; i++) dist[i * 2 + ch] = d[i]; }
  const data = combineClassificationDistance({ data: cls, C: 2, chan: [0, 1, -1, -1] }, { data: dist, C: 2 }, 0b11);
  const vs = halfExt.map((h, k) => 2 * h / dims[k]);
  return { data, dims, halfExt, vs, voxelMin: Math.min(...vs) };
}
const clamp01 = v => Math.min(Math.max(v, 0), 0.999999);
function fetchAt(g, tc) {
  const N = g.dims, r = [0, 0, 0, 0];
  const p = tc.map((v, k) => clamp01(v) * N[k] - 0.5), f = p.map(Math.floor), w = p.map((v, k) => v - f[k]);
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
// the ray: everything the WGSL computes before its loop; null when the ray is discarded
function rayOf(g, o, d, stp) {
  const [bx, by] = hitBox(g, o, d);
  if (bx > by) return null;
  const t0 = Math.max(bx, 0), endT = by, faceEnd = (bx > 0 && t0 <= bx + 1e-4) ? bx + stp : -1, faceT = faceEnd >= 0 ? t0 : -1, N = g.dims;
  const tcO = texCoord(g, o), tcD = d.map((v, k) => v / (2 * g.halfExt[k])), jkA = Math.max(1 / Math.max(0.5 * Math.hypot(...d.map((v, k) => v * N[k] / g.halfExt[k])), 1e-6), g.voxelMin);
  return { g, o, d, stp, t0, endT, faceEnd, faceT, tcO, tcD, jkA, speed: Math.hypot(...tcD.map((v, k) => v * N[k])) };
}
const posAt = (R, t) => R.tcO.map((v, k) => v + R.tcD[k] * t);
const newState = k => ({ k, previousT: 0, lastIndex: -1, prevValid: false, prevF: 0, chk: false, hit: null, done: false, iter: 0, first: true });
// one iteration of the loop; balls = the neighbours' balls of the previous step (csShare) or null; returns this iteration's own ball (or null)
function step(R, S, balls, opt = {}) {
  const { g, stp } = R, t = R.t0 + S.k * stp;
  if (S.first) { S.previousT = t; S.first = false; }
  if (t > R.endT) { S.done = true; return null; }
  if (balls && t > R.faceT) {
    const pS = posAt(R, t).map((v, k) => clamp01(v) * g.dims[k]);
    let best = 0; for (const b of balls) if (b && b.r > 0) best = Math.max(best, b.r - Math.hypot(pS[0] - b.c[0], pS[1] - b.c[1], pS[2] - b.c[2]));
    const m = Math.floor((best - (opt.margin ?? CS.share.margin)) * R.jkA / stp);
    if (m >= 1) { const nextJ = R.t0 + (S.k + m) * stp; S.previousT = nextJ - stp * 0.05; S.prevValid = false; S.chk = false; S.k += m; S.skipped = (S.skipped || 0) + 1; return null; }
  }
  const tc = posAt(R, t), q = fetchAt(g, tc); let dd = q[3] * 255;
  if (dd >= 2.7 && t <= R.faceT && Math.max(...fOf(q)) >= 0) dd = 0;
  S.chk = dd < 2.7;
  if (dd >= 2.7) {
    const ball = { c: tc.map((v, k) => clamp01(v) * g.dims[k]), r: dd - 1.8 };
    const m = Math.max(1, Math.floor((dd - 1.8) * R.jkA / stp)), nextJ = R.t0 + (S.k + m) * stp;
    S.previousT = nextJ - stp * 0.05; S.prevValid = false; S.k += m; return ball;
  }
  const f = fOf(q); let idx = -1, curF = -1;
  for (let s = 0; s < 4; s++) if (f[s] >= 0) { idx = s; curF = f[s]; break; }
  if (idx !== S.lastIndex) {
    if (idx >= 0) { S.hit = { idx, lo: S.previousT, hi: t, f0: S.prevF, f1: curF, nb: S.prevValid ? 6 : 2, iso: S.prevValid && S.prevF < 0, k: S.k }; S.lastIndex = idx; S.done = true; return null; }
    S.lastIndex = idx;
  }
  S.prevValid = true; S.prevF = idx >= 0 ? curF : Math.max(...f); S.previousT = t; S.k++;
  return null;
}
const runSolo = (R, k0 = 0) => { const S = newState(k0); for (let it = 0; it < 4096 && !S.done; it++) { step(R, S, null); S.iter++; } return S; };
const sameHit = (a, b) => (!a.hit && !b.hit) || (a.hit && b.hit && ['idx', 'lo', 'hi', 'f0', 'f1', 'nb', 'iso', 'k'].every(f => a.hit[f] === b.hit[f]));

function makeCam(rand, g, { W, H, fpx, inside }) {
  const he = g.halfExt; let o;
  if (inside) o = he.map(h => (rand() * 1.2 - 0.6) * h);
  else { const a = rand() * 2 * Math.PI, e = Math.acos(2 * rand() - 1), Rr = Math.hypot(...he) * (1.15 + rand() * 1.5); o = [Rr * Math.sin(e) * Math.cos(a), Rr * Math.sin(e) * Math.sin(a), Rr * Math.cos(e)]; }
  const tgt = he.map(h => (rand() - 0.5) * h); let fw = tgt.map((v, k) => v - o[k]); const lf = Math.hypot(...fw); fw = fw.map(v => v / lf);
  const up0 = Math.abs(fw[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let rt = cr(fw, up0); const lr = Math.hypot(...rt); rt = rt.map(v => v / lr); const up = cr(rt, fw);
  const dirOf = (px, py) => { const u = (px + 0.5 - W / 2) / fpx, v = -(py + 0.5 - H / 2) / fpx, d = [0, 1, 2].map(k => fw[k] + u * rt[k] + v * up[k]), l = Math.hypot(...d); return d.map(x => x / l); };
  return { o, W, H, dirOf };
}

// the cooperative tile start (the JS twin of coopTileA in vr-wgsl-cs.js): returns tA of the tile (3.0e38 = empty); over = a voxel count the field is over-trusted by (a negative control)
function coopTile(g, cam, tx, ty, { over = 0, samples = CS.coop.samples, rounds = CS.coop.rounds, shrink = CS.coop.shrink } = {}) {
  const T = 8, x0 = tx * T, y0 = ty * T, x1 = Math.min(cam.W, x0 + T) - 1, y1 = Math.min(cam.H, y0 + T) - 1;
  const cs = [cam.dirOf(x0, y0), cam.dirOf(x1, y0), cam.dirOf(x0, y1), cam.dirOf(x1, y1)];
  let a = [0, 0, 0]; for (const d of cs) for (let k = 0; k < 3; k++) a[k] += d[k];
  const la = Math.hypot(...a); a = a.map(v => v / la);
  let ch = 0; for (const d of cs) ch = Math.max(ch, Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2])); ch += PROXY.epsTheta;
  const o = cam.o, he = g.halfExt, vm = g.voxelMin, far = Math.hypot(...o) + Math.hypot(...he);
  const reach = s => {
    const x = o.map((v, k) => v + a[k] * s), xc = x.map((v, k) => Math.min(Math.max(v, -he[k]), he[k])), dBox = Math.hypot(...x.map((v, k) => v - xc[k])), rC = s * ch;
    let hh = dBox - PROXY.slack * vm - rC; const q = fetchAt(g, texCoord(g, xc)), dd = q[3] * 255;
    if (!(Math.max(...fOf(q)) >= -PROXY.classMargin)) { const rho = (dd - PROXY.ddMargin - PROXY.slack + over) * vm; hh = Math.max(hh, rho - dBox - rC); }
    return hh;
  };
  let lo = 0, win = far;
  for (let r = 0; r < rounds; r++) {
    const S = [], Hh = [];
    for (let j = 0; j < samples; j++) { const s = lo + (j + 0.5) / samples * win; S.push(s); Hh.push(s > far ? 3.0e38 : reach(s)); }
    let end = Infinity, cov = false;
    for (let j = 0; j < samples; j++) {
      const h = Hh[j], bj = S[j] + h; if (!(h > 0)) continue;
      let beyond = false; for (let i = 0; i < samples; i++) if (Hh[i] > 0 && S[i] - Hh[i] <= bj && S[i] + Hh[i] > bj) beyond = true;
      if (!beyond && bj >= lo) end = Math.min(end, bj);
      if (S[j] - h <= lo && lo <= bj) cov = true;
    }
    if (cov) lo = Math.max(lo, end);
    win /= shrink;
  }
  return lo;
}

const STEPS = [1.5, 1.0];
let scenes = null;
const build = () => {
  const rand = rng(20261124), grids = [];
  const shapes = [{ dims: [48, 40, 56], halfExt: [1.0, 0.8, 1.5] }, { dims: [56, 56, 32], halfExt: [1.0, 1.0, 0.75] }, { dims: [44, 44, 44], halfExt: [1, 1, 1] }];
  for (let i = 0; i < 4; i++) grids.push(makeGrid(rand, { ...shapes[i % 3], nBlobs: 3 + i, border: i % 2 === 0 }));
  const camRand = rng(7), cams = new Map();
  for (const g of grids) cams.set(g, [0, 1, 2].map(i => makeCam(camRand, g, { W: 32, H: 32, fpx: 150, inside: i === 0 })));
  return { grids, cams };
};
// every ray of every camera: f(g, cam, tx, ty, px, py, ray) for rays that are not discarded
function eachRay(stepVox, f) {
  scenes ||= build();
  for (const g of scenes.grids) for (const cam of scenes.cams.get(g)) {
    const stp = stepVox * g.voxelMin;
    for (let ty = 0; ty * 8 < cam.H; ty++) for (let tx = 0; tx * 8 < cam.W; tx++) f(g, cam, tx, ty, stp);
  }
}

describe('CPU model: what each variant changes in the march gives the same hit state as the march from k = 0', () => {
  const res = {};
  beforeAll(() => {
    for (const sv of STEPS) {
      // --- csTile: the march from the cooperative start against from k = 0 (and the control: the field over-trusted by 3 voxels) ---
      for (const [label, over, shift] of [['tile', 0, 0], ['tileOver', 12, 0], ['tileLate', 0, 5]]) {
        const st = res[label + sv] = { rays: 0, hits: 0, mism: 0, later: 0, emptyTiles: 0, tiles: 0, emptyRays: 0, first: null };
        eachRay(sv, (g, cam, tx, ty, stp) => {
          const tA = coopTile(g, cam, tx, ty, { over }); st.tiles++; if (tA > 1e30) st.emptyTiles++;
          for (let py = ty * 8; py < Math.min(cam.H, ty * 8 + 8); py++) for (let px = tx * 8; px < Math.min(cam.W, tx * 8 + 8); px++) {
            const R = rayOf(g, cam.o, cam.dirOf(px, py), stp); if (!R) continue;
            const A = runSolo(R); let B;
            if (tA > R.endT) { B = { hit: null }; st.emptyRays++; } else { const K = Math.max(0, Math.floor((tA - R.t0) / stp) - 1 + shift); if (K > 0) st.later++; B = runSolo(R, K); }
            st.rays++; if (A.hit) st.hits++;
            if (!sameHit(A, B)) { st.mism++; st.first ||= { px, py, a: A.hit, b: B.hit, tA }; }
          }
        });
      }
      // --- csShare: the 64 threads of a tile in lock step, each step reading the 4 neighbours' balls of the step before; against the single ray (and the control: the balls trusted 4 voxels beyond their radius) ---
      for (const [label, margin] of [['share', CS.share.margin], ['shareOver', -4]]) {
        const st = res[label + sv] = { rays: 0, hits: 0, mism: 0, skipped: 0, first: null };
        eachRay(sv, (g, cam, tx, ty, stp) => {
          const lanes = [];
          for (let li = 0; li < 64; li++) {
            const [mx, my] = mortonDecode(li), px = tx * 8 + mx, py = ty * 8 + my;
            const R = px < cam.W && py < cam.H ? rayOf(g, cam.o, cam.dirOf(px, py), stp) : null;
            lanes.push({ R, S: R ? newState(0) : null, li });
          }
          const nbOf = li => { const [mx, my] = mortonDecode(li); return [mortonEncode(Math.max(mx - 1, 0), my), mortonEncode(Math.min(mx + 1, 7), my), mortonEncode(mx, Math.max(my - 1, 0)), mortonEncode(mx, Math.min(my + 1, 7))]; };
          let prev = Array(64).fill(null);
          for (let stepNo = 0; stepNo < 4096; stepNo++) {
            const next = Array(64).fill(null); let alive = 0;
            for (const L of lanes) { if (!L.R || L.S.done || L.S.iter >= 4096) continue; alive++; next[L.li] = step(L.R, L.S, nbOf(L.li).map(i => prev[i]), { margin }); L.S.iter++; }
            prev = next; if (!alive) break;
          }
          for (const L of lanes) {
            if (!L.R) continue; const A = runSolo(L.R); st.rays++; st.skipped += L.S.skipped || 0; if (A.hit) st.hits++;
            if (!sameHit(A, L.S)) { st.mism++; st.first ||= { a: A.hit, b: L.S.hit, li: L.li }; }
          }
        });
      }
      // --- csWave: the march stopped every N iterations, the state carried through the list's words (flags packed, k / iter as ints), resumed; against the single ray (and the controls: a word that is not carried) ---
      for (const [label, drop, waveN] of [['wave', null, CS.wave.n], ['wave1', null, 1], ['waveNoValid', 'prevValid', 1], ['waveNoChk', 'chk', 1], ['waveNoPrevF', 'prevF', 1]]) {
        const st = res[label + sv] = { rays: 0, hits: 0, mism: 0, resumed: 0, first: null };
        eachRay(sv, (g, cam, tx, ty, stp) => {
          for (let py = ty * 8; py < Math.min(cam.H, ty * 8 + 8); py += 3) for (let px = tx * 8; px < Math.min(cam.W, tx * 8 + 8); px += 3) {
            const R = rayOf(g, cam.o, cam.dirOf(px, py), stp); if (!R) continue;
            const A = runSolo(R); let S = newState(0);
            for (let w = 0; w < 4200 && !S.done && S.iter < 4096; w++) {
              const stop = Math.min(4096, (w + 1) * waveN);
              while (!S.done && S.iter < stop) { step(R, S, null); S.iter++; }
              if (!S.done && S.iter < 4096) { // the list entry: pix (not needed here), flags, k, iter, previousT, prevF
                const words = { flags: packContFlags({ prevValid: drop === 'prevValid' ? false : S.prevValid, chk: drop === 'chk' ? false : S.chk, lastIndex: S.lastIndex }), k: S.k | 0, iter: S.iter | 0, previousT: S.previousT, prevF: drop === 'prevF' ? 0 : S.prevF };
                const c = unpackContFlags(words.flags); S = { ...newState(words.k), first: false, previousT: words.previousT, prevF: words.prevF, prevValid: c.prevValid, chk: c.chk, lastIndex: c.lastIndex, iter: words.iter }; st.resumed++;
              }
            }
            st.rays++; if (A.hit) st.hits++;
            if (!sameHit(A, S)) { st.mism++; st.first ||= { px, py, a: A.hit, b: S.hit }; }
          }
        });
      }
    }
  }, 300_000);
  for (const sv of STEPS) {
    it(`csTile (step ${sv}): the march from the cooperative start gives the same hit state on every ray, with starts that really are later and tiles that are certified empty`, () => {
      const s = res['tile' + sv]; expect(s.mism, JSON.stringify(s.first)).toBe(0); expect(s.rays).toBeGreaterThan(2000); expect(s.hits).toBeGreaterThan(300); expect(s.later).toBeGreaterThan(300); expect(s.emptyRays).toBeGreaterThan(100);
    });
    it(`csTile (step ${sv}): the controls are caught: a start 5 grid points later than the rule, and a search that trusts the distance field 12 voxels too far`, () => { expect(res['tileLate' + sv].mism).toBeGreaterThan(0); expect(res['tileOver' + sv].mism, 'over-trust').toBeGreaterThan(0); });
    it(`csShare (step ${sv}): the lock-step march with the neighbours' balls gives the same hit state on every ray, and skips really happen`, () => {
      const s = res['share' + sv]; expect(s.mism, JSON.stringify(s.first)).toBe(0); expect(s.rays).toBeGreaterThan(2000); expect(s.hits).toBeGreaterThan(300); expect(s.skipped).toBeGreaterThan(100);
    });
    it(`csShare (step ${sv}): the control (the balls trusted 4 voxels beyond their radius) is caught`, () => { expect(res['shareOver' + sv].mism).toBeGreaterThan(0); });
    it(`csWave (step ${sv}): the march stopped every ${CS.wave.n} iterations and resumed from the words of a list entry gives the same hit state; each word is needed (stopped every iteration: dropping prevValid or prevF is caught)`, () => {
      for (const l of ['wave', 'wave1']) { const s = res[l + sv]; expect(s.mism, JSON.stringify(s.first)).toBe(0); expect(s.rays).toBeGreaterThan(200); expect(s.resumed).toBeGreaterThan(l === 'wave' ? 50 : 1000); }
      expect(res['waveNoValid' + sv].mism).toBeGreaterThan(0); expect(res['waveNoPrevF' + sv].mism).toBeGreaterThan(0);
      // chk is only read by the creep skip (off in the display): carrying it is free and harmless; dropping it changes nothing the display can see
      expect(res['waveNoChk' + sv].mism).toBe(0);
    });
  }
});

// ======================================================================================================
describe('the host (mock device)', () => {
  const GLOBALS = () => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }); vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4, QUERY_RESOLVE: 8, COPY_SRC: 16, MAP_READ: 32, STORAGE: 64, INDIRECT: 128 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8, STORAGE_BINDING: 16 }); vi.stubGlobal('GPUMapMode', { READ: 1 });
  };
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
  const eyeCam = (W, H) => ({ viewport: { z: W, w: H }, projectionMatrix: new THREEG.Matrix4().makePerspective(-0.5, 0.5, 0.5, -0.5, 0.1, 20), matrixWorldInverse: new THREEG.Matrix4().makeTranslation(0, 0, -3), matrixWorld: new THREEG.Matrix4().makeTranslation(0, 0, 3) });
  // a device with timestamp-query (and subgroups): the readbacks answer like a device that ran the passes (the count word and the run's number copied back from the buffer the queue wrote); popErrors = what the two error scopes answer
  const mock = ({ subgroups = true, popErrors = null, stale = false } = {}) => {
    const log = { passes: [], cpasses: [], cmds: [], shaders: [], cpipes: [], rpipes: [], buffers: [], textures: [], bindGroups: [], writes: [], scopes: [] };
    const device = { features: new Set(['timestamp-query', ...(subgroups ? ['subgroups'] : [])]), limits: {} };
    device.queue = { writeBuffer: (b, off, data) => { log.writes.push({ b, off, n: data.byteLength }); if (b.d.size === 8 && off === 4) b.nonce = new Uint32Array(data.buffer ?? data)[0]; }, writeTexture() {}, submit: () => log.cmds.push('submit') };
    if (popErrors !== undefined) { device.pushErrorScope = f => log.scopes.push(f); device.popErrorScope = async () => (popErrors ? popErrors.shift() ?? null : null); }
    device.createQuerySet = d => ({ d, destroy() {} });
    device.createBuffer = d => { const b = { d, destroyed: false, nonce: 0, destroy() { b.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => (d.size === 8 ? new Uint32Array([777, stale ? 0 : b.nonce]).buffer : d.size > 16 ? new Uint32Array(d.size / 4).buffer : new BigUint64Array([1000000n, 2000000n]).buffer), unmap() {} }; log.buffers.push(b); return b; };
    device.createTexture = d => { const t = { d, destroyed: false, destroy() { t.destroyed = true; }, createView: () => ({ t }) }; log.textures.push(t); return t; };
    device.createSampler = () => ({}); device.createBindGroupLayout = d => ({ d }); device.createPipelineLayout = d => ({ d });
    device.createShaderModule = d => { log.shaders.push(d.code); return { code: d.code }; };
    device.createComputePipeline = d => { const p = { d, compute: true }; log.cpipes.push(p); return p; }; device.createComputePipelineAsync = async d => device.createComputePipeline(d);
    device.createRenderPipeline = d => { const p = { d }; log.rpipes.push(p); return p; }; device.createRenderPipelineAsync = async d => device.createRenderPipeline(d);
    device.createBindGroup = d => { const g = { d }; log.bindGroups.push(g); return g; };
    device.createCommandEncoder = () => ({
      beginRenderPass: d => { const p = { d, draws: 0, viewports: [], scissors: [] }; log.passes.push(p); log.cmds.push('rpass'); return { setPipeline: x => { p.pipeline = x; }, setVertexBuffer() {}, setBindGroup() {}, setViewport: (...a) => p.viewports.push(a), setScissorRect: (...a) => p.scissors.push(a), draw: () => { p.draws++; }, end() {} }; },
      beginComputePass: d => { const p = { d, seq: [] }; log.cpasses.push(p); log.cmds.push('cpass'); return { setPipeline: x => p.seq.push(['pipe', x]), setBindGroup: (i, g) => p.seq.push(['bg', i, g]), dispatchWorkgroups: (...a) => p.seq.push(['dispatch', ...a]), dispatchWorkgroupsIndirect: (b, o) => p.seq.push(['indirect', b, o]), end() {} }; },
      resolveQuerySet() {}, copyBufferToBuffer: (src, _so, dst) => { if (src.nonce !== undefined) dst.nonce = src.nonce; log.cmds.push('copy'); }, clearBuffer: () => log.cmds.push('clear'), copyTextureToBuffer() {}, finish: () => ({}),
    });
    return { device, log };
  };
  const withGpu = fn => async () => { GLOBALS(); try { await fn(); } finally { vi.unstubAllGlobals(); } };
  const clsTex = () => { const t = new THREEG.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4), 4, 4, 4); t.format = THREEG.RGBAFormat; t.type = THREEG.UnsignedByteType; return t; };
  const u0 = () => ({ jumpOn: { value: 1 }, distInCls: { value: 1 }, useCls: { value: 1 }, diag: { value: 0 }, clsTex: { value: clsTex() }, planeCount: { value: 0 }, segA: { value: [] } });
  const frame = (r, u) => { r.draw({ u, cams: [eyeCam(256, 256), eyeCam(256, 256)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: false } }); return r.volume.markFrame(); };
  const prepared = async (o = {}) => {
    const g = mock(o), got = [], r = createVrVolumeRenderer({ THREE: THREEG, device: g.device, halfExt: [1, 1, 1] });
    await r.breakdown.begin({ cls4: false, events: false }, (...a) => got.push(a));
    return { ...g, r, got, u: o.u || u0() };
  };
  // the first ask starts the compile (null); once the programs exist the variant answers
  const ask = async (a, spec) => { let rec, x; for (let i = 0; i < 3; i++) { rec = frame(a.r, a.u); x = a.r.breakdown.shadow(rec, spec); if (x !== null) break; await settle(); } return { rec, x }; };

  it('begin and a frame make no compute-variant resource; the first compute ask starts the compile and answers null, the next one runs', withGpu(async () => {
    const a = await prepared(), rec = frame(a.r, a.u);
    expect(a.log.shaders.some(t => /\(compute\)|compute variant/.test(t))).toBe(false);
    expect(a.r.breakdown.shadow(rec, BD_SPECS.cs)).toBeNull(); await settle();
    expect(a.log.shaders.some(t => /\(compute\)/.test(t))).toBe(true);
    const { x } = await ask(a, BD_SPECS.cs); expect(x).toBe(true);
    a.r.dispose();
  }));
  it('a frame whose low pass had no pre-pass (sections, no distance field) makes no compute pass: the variants step past (null)', withGpu(async () => {
    const u = u0(); delete u.clsTex; const a = await prepared({ u });
    const { x } = await ask(a, BD_SPECS.cs); expect(x).toBeNull(); expect(a.log.cpasses.length).toBe(1 /* the display's pre-pass is not made either */ - 1);
    a.r.dispose();
  }));
  it('cs: the vPos render pass (the display\'s cull and scissors, one draw of the 36 vertices per eye), one compute pass per eye (a 8 x 8 tile each), the comparison, the timers, the count + run number back', withGpu(async () => {
    const a = await prepared(), nP = a.log.passes.length, nC = a.log.cpasses.length; const { x } = await ask(a, BD_SPECS.cs); expect(x).toBe(true);
    const rp = a.log.passes.slice(a.log.passes.length - 1)[0]; expect(rp.d.colorAttachments[0].clearValue.a).toBe(-1); expect(rp.draws).toBe(2); expect(rp.d.timestampWrites.beginningOfPassWriteIndex).toBeDefined();
    const cps = a.log.cpasses.slice(-3); // eye 0, eye 1, the comparison
    expect(cps[0].d.timestampWrites.beginningOfPassWriteIndex).toBeDefined(); expect(cps[0].d.timestampWrites.endOfPassWriteIndex).toBeUndefined(); expect(cps[1].d.timestampWrites.endOfPassWriteIndex).toBeDefined(); expect(cps[1].d.timestampWrites.beginningOfPassWriteIndex).toBeUndefined();
    for (const c of cps.slice(0, 2)) { const d = c.seq.filter(q => q[0] === 'dispatch'); expect(d).toHaveLength(1); expect(d[0][1]).toBe(Math.ceil(rp.viewports[0][2] / 8)); expect(d[0][2]).toBe(Math.ceil(rp.viewports[0][3] / 8)); }
    expect(cps[2].seq.filter(q => q[0] === 'dispatch')).toHaveLength(2);
    await settle();
    expect(a.got.some(g => g[0] === 'csVposMs')).toBe(true); expect(a.got.find(g => g[0] === 'cs')[1]).toBeCloseTo(1, 5); const dd = a.got.find(g => g[0] === 'diff:cs'); expect(dd[1]).toBe(777); expect(dd[2]).toBeGreaterThan(0);
    expect(nP).toBeLessThan(a.log.passes.length); expect(nC).toBeLessThan(a.log.cpasses.length);
    a.r.dispose();
  }));
  it('csHit: per eye one chain in one compute pass: the march over the tiles, the args kernel, the shade kernel dispatched INDIRECT from the args buffer (slot 7), the args buffer is in no bind group of the dispatch that consumes it; csWave: a list pass per extra wave, indirect, slots 1.. in order', withGpu(async () => {
    const a = await prepared(), { x } = await ask(a, BD_SPECS.csHit); expect(x).toBe(true);
    const chain = a.log.cpasses.slice(-3).slice(0, 2); const kinds = c => c.seq.map(q => q[0] === 'dispatch' ? 'D' + q.slice(1).join('x') : q[0] === 'indirect' ? 'I' + q[2] : null).filter(Boolean);
    for (const c of chain) { const k = kinds(c); expect(k).toHaveLength(3); expect(k[0]).toMatch(/^D\d+x\d+$/); expect(k[1]).toBe('D1'); expect(k[2]).toBe('I112'); }
    const argsBuf = a.log.buffers.find(b => b.d.usage & 128); expect(argsBuf).toBeTruthy();
    for (const c of chain) for (const q of c.seq) if (q[0] === 'indirect') { expect(q[1]).toBe(argsBuf); const lastBg = c.seq.slice(0, c.seq.indexOf(q)).filter(z => z[0] === 'bg'); for (const g of lastBg.slice(-2)) expect(g[2].d.entries.some(en => en.resource?.buffer === argsBuf)).toBe(false); }
    await settle(); expect(a.got.find(g => g[0] === 'csStat:csHit')).toBeTruthy(); expect(a.got.find(g => g[0] === 'diff:csHit')).toBeTruthy();
    a.r.dispose();
    const w = await prepared(), y = await ask(w, BD_SPECS.csWave); expect(y.x).toBe(true);
    const k = kinds(w.log.cpasses.slice(-3)[0]); expect(CS.wave.waves).toBe(3); expect(k.filter(z => z[0] === 'I')).toEqual(['I16', 'I32', 'I112']); expect(k.filter(z => z === 'D1')).toHaveLength(CS.wave.waves); // an args dispatch per extra wave + one for the hits
    w.r.dispose();
  }));
  it('a variant\'s compile failure is reported once (csFail) and answers null from then on', withGpu(async () => {
    const a = await prepared(), real = a.device.createComputePipelineAsync; a.device.createComputePipelineAsync = async d => { if (/mode=full/.test(d.compute.module.code)) throw new Error('compile error x'); return real(d); };
    let rec = frame(a.r, a.u); a.r.breakdown.shadow(rec, BD_SPECS.cs); await settle(); rec = frame(a.r, a.u);
    expect(a.r.breakdown.shadow(rec, BD_SPECS.cs)).toBeNull(); expect(a.r.breakdown.shadow(rec, BD_SPECS.cs)).toBeNull();
    expect(a.got.filter(g => g[0] === 'csFail:cs')).toHaveLength(1); expect(a.r.breakdown.shadow(rec, BD_SPECS.csHit)).toBe(true);
    a.r.dispose();
  }));
  it('a submit that raised a GPU error (the error scopes answer) or whose read-back is stale gives no timing and no comparison, only csFail', withGpu(async () => {
    const e = await prepared({ popErrors: [{ message: 'validation error y' }, null] }); const r1 = await ask(e, BD_SPECS.cs); expect(r1.x).toBe(true); await settle();
    expect(e.log.scopes.slice(-2)).toEqual(['validation', 'out-of-memory']); expect(e.got.filter(g => g[0] === 'csFail:cs')).toHaveLength(1); expect(e.got.some(g => g[0] === 'cs' || g[0] === 'diff:cs' || g[0] === 'csVposMs')).toBe(false);
    e.r.dispose();
    const st = await prepared({ stale: true }); const r2 = await ask(st, BD_SPECS.cs); expect(r2.x).toBe(true); await settle();
    expect(st.got.filter(g => g[0] === 'csFail:cs')).toHaveLength(1); expect(st.got.some(g => g[0] === 'cs' || g[0] === 'diff:cs')).toBe(false);
    st.r.dispose();
  }));
  it('the Sg forms need the device\'s subgroups feature: without it no module with `enable subgroups` is made and they answer null', withGpu(async () => {
    const a = await prepared({ subgroups: false }); const { x } = await ask(a, BD_SPECS.csTileSg); expect(x).toBeNull();
    expect(a.log.shaders.filter(t => /enable subgroups/.test(t))).toHaveLength(0); expect((await ask(a, BD_SPECS.csTile)).x).toBe(true);
    a.r.dispose();
    const b = await prepared({ subgroups: true }); expect((await ask(b, BD_SPECS.csTileSg)).x).toBe(true); expect(b.log.shaders.some(t => /^enable subgroups;/.test(t))).toBe(true);
    b.r.dispose();
  }));
  it('events: true (a section run) or an unusable low pass: every variant steps past', withGpu(async () => {
    const a = await prepared(), rec = (() => { a.r.draw({ u: { ...a.u, planeCount: { value: 1 } }, cams: [eyeCam(256, 256)], model: new THREEG.Matrix4(), f: 0.5, fov: false, rects: null, variant: { cls4: false, events: true } }); return a.r.volume.markFrame(); })();
    expect(a.r.breakdown.shadow(rec, BD_SPECS.cs)).toBeNull(); a.r.dispose();
  }));
});
