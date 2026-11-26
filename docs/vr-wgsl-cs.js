// WGSL (text) of the compute-march variants of the VR / AR volume (the performance record's breakdown only; the display never uses them): the volume pass's march walked by a compute shader instead of the fragment shader.
// Every variant is made from the text of the display variant (volumeWgsl({f16, cls4, events: false}), docs/vr-wgsl-core.js) by exact substitutions, so the march, the surface search, the gradient and the shading are the display's own functions
// (every anchor must occur exactly the expected number of times, else this throws); the display text itself is never touched. A compute shader has no rasteriser: a small render pass with the display's own vertex stage (the same text, the same
// viewport / scissors / culling) writes, per pixel, the interpolated back-face point vPos and the fragment's depth into a float target (vposWgsl), and the compute shaders read that; so the ray (and the covered pixels) are exactly the fragment shader's.
// Variants (CS_MODES): full = one kernel (D-0 / D-1: 8 x 8 workgroup per tile, pixels in Morton order, writes the display's two targets as storage textures); march + shade = the same march that records its hits (D-5 csHit) and, with a
// limit of N loop iterations per dispatch, its unfinished rays (D-4 csWave) into lists, and a second kernel that searches / shades only the hits of the list (the dispatch sizes come from the counts through dispatchWorkgroupsIndirect);
// tile = the tile's 64 threads find the tile's start distance together (D-2 csTile); share = the neighbours' safe balls are shared in a lock-step march (D-3 csShare). tile / share have a subgroup form (sg: enable subgroups).
// What keeps the picture the same (plan 0-7): the march stays on its own grid t0 + k * stp (a skip is a jump of k only), every skipped sample lies inside a ball around a sample read with a distance dd >= 2.7 (the radius dd - 1.8 voxels, the
// jump's own bound, so no skipped sample is inside a shown segment), a start is the pre-pass rule (k = floor((tA - t0) / stp) - 1, never below 0), and the grid point before a hit is therefore always read normally. A ray that hits is
// searched with the state the loop leaves (hitLo / hitHi / f0 / f1 / hitNb / hitIso), which a list entry carries whole.
import { volumeWgsl, uniformLayout, uniformStruct, PROXY } from './vr-wgsl-core.js?v=20261126-build767';

export const CS_TILE = 8; // the workgroup is one 8 x 8 pixel tile (as the pre-pass's tile)
export const CS_MODES = ['full', 'march', 'shade', 'tile', 'share'];
// the variants the breakdown names -> how they are made (vr-perf-log.js BD_SPECS carries the same keys)
export const CS_VARIANTS = {
  cs: { mode: 'full' }, csHit: { mode: 'wave', waves: 1 }, csWave: { mode: 'wave' }, csTile: { mode: 'tile' }, csShare: { mode: 'share' }, csTileSg: { mode: 'tile', sg: true }, csShareSg: { mode: 'share', sg: true },
};
export const CS_NAMES = Object.keys(CS_VARIANTS);
// constants of the variants (shared by the shader text, the host and the CPU model of tests/unit/vr-wgsl-cs.test.js)
export const CS = {
  wave: { n: 24, waves: 3 }, // csWave: loop iterations per limited dispatch, number of march dispatches (the last one runs to the end of the loop); csHit = 1 dispatch
  coop: { samples: 64, rounds: 3, shrink: 8 }, // csTile: samples along the tile's cone axis per round (= the 64 threads), rounds, the window's shrink per round
  share: { neighbours: 4, margin: 0.02 }, // csShare: the neighbour lanes read, the safety taken off the radius (voxels)
  hitStride: 6, contStride: 6, // u32 per list entry: hit = pix, flags, lo, hi, f0, f1; continuation = pix, flags, k, iter, previousT, prevF
  listBytesMax: 64 * 1024 * 1024, // a list buffer larger than this makes the variant skip the frame (the device's storage binding limit is 128 MiB by default; 64 MiB of 24-byte entries is 43690 groups of 64, inside the 65535 of one dispatch)
  maxGroups: 65535,
};
// per eye and per dispatch, written by the host (the uniform buffer of the compute kernels, group 1 binding 3)
export const CS_FIELDS = [
  ['inv', 'mat4x4f'],
  ['org', 'vec3f'], ['vx', 'i32'],
  ['vy', 'i32'], ['vw', 'i32'], ['vh', 'i32'], ['stop', 'i32'],
  ['cap', 'i32'], ['wave', 'i32'], ['pad0', 'i32'], ['pad1', 'i32'],
];
export const csLayout = () => uniformLayout(CS_FIELDS);
export const CS_BINDINGS = { vpos: 0, outColor: 1, outDepth: 2, params: 3, cnt: 4, hits: 5, contOut: 6, contIn: 7 }; // group 1 of the compute kernels (group 0 = the display's bind group, visible to compute)
export const CS_ARGS_BINDINGS = { params: 0, cnt: 1, args: 2 };
export const CS_DIFF_BINDINGS = { colorA: 0, depthA: 1, colorB: 2, depthB: 3, count: 4, rect: 5 };

// ---- pure helpers (their JS twins are the tests' reference; the WGSL text below is built from the same expressions) ----
// Morton (Z) order inside the 8 x 8 tile: thread i -> (x, y) with x from the bits 0, 2, 4 of i and y from the bits 1, 3, 5; a subgroup of 16 / 32 / 64 consecutive threads is then a 4 x 4 / 8 x 4 / 8 x 8 block
export const MORTON_DECODE_WGSL = 'fn cMorton(i:u32)->vec2<u32>{return vec2<u32>((i&1u)|((i>>1u)&2u)|((i>>2u)&4u),((i>>1u)&1u)|((i>>2u)&2u)|((i>>3u)&4u));}';
export const MORTON_ENCODE_WGSL = 'fn cMortonEnc(x:u32,y:u32)->u32{return (x&1u)|((x&2u)<<1u)|((x&4u)<<2u)|((y&1u)<<1u)|((y&2u)<<2u)|((y&4u)<<3u);}';
export const mortonDecode = i => [(i & 1) | ((i >> 1) & 2) | ((i >> 2) & 4), ((i >> 1) & 1) | ((i >> 2) & 2) | ((i >> 3) & 4)];
export const mortonEncode = (x, y) => (x & 1) | ((x & 2) << 1) | ((x & 4) << 2) | ((y & 1) << 1) | ((y & 2) << 2) | ((y & 4) << 3);
// the dispatch arguments of a list pass: ceil(n / 64) workgroups (n = the list's count, never above the list's capacity), at most maxGroups in x. The args kernel (csArgsWgsl) computes the same
export const indirectArgs = (count, cap = Infinity) => [Math.min(Math.ceil(Math.min(count, cap) / 64), CS.maxGroups), 1, 1];
// column-major 4 x 4 inverse (the host inverts the region mvp for the tile's cone, as encodeProxy does with three.js)
export function invert4(m) {
  const a = m, o = new Array(16);
  const s0 = a[0] * a[5] - a[4] * a[1], s1 = a[0] * a[9] - a[8] * a[1], s2 = a[0] * a[13] - a[12] * a[1], s3 = a[4] * a[9] - a[8] * a[5], s4 = a[4] * a[13] - a[12] * a[5], s5 = a[8] * a[13] - a[12] * a[9];
  const c5 = a[10] * a[15] - a[14] * a[11], c4 = a[6] * a[15] - a[14] * a[7], c3 = a[6] * a[11] - a[10] * a[7], c2 = a[2] * a[15] - a[14] * a[3], c1 = a[2] * a[11] - a[10] * a[3], c0 = a[2] * a[7] - a[6] * a[3];
  const det = s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null;
  const d = 1 / det;
  o[0] = (a[5] * c5 - a[9] * c4 + a[13] * c3) * d; o[4] = (-a[4] * c5 + a[8] * c4 - a[12] * c3) * d;
  o[8] = (a[7] * s5 - a[11] * s4 + a[15] * s3) * d; o[12] = (-a[6] * s5 + a[10] * s4 - a[14] * s3) * d;
  o[1] = (-a[1] * c5 + a[9] * c2 - a[13] * c1) * d; o[5] = (a[0] * c5 - a[8] * c2 + a[12] * c1) * d;
  o[9] = (-a[3] * s5 + a[11] * s2 - a[15] * s1) * d; o[13] = (a[2] * s5 - a[10] * s2 + a[14] * s1) * d;
  o[2] = (a[1] * c4 - a[5] * c2 + a[13] * c0) * d; o[6] = (-a[0] * c4 + a[4] * c2 - a[12] * c0) * d;
  o[10] = (a[3] * s4 - a[7] * s2 + a[15] * s0) * d; o[14] = (-a[2] * s4 + a[6] * s2 - a[14] * s0) * d;
  o[3] = (-a[1] * c3 + a[5] * c1 - a[9] * c0) * d; o[7] = (a[0] * c3 - a[4] * c1 + a[8] * c0) * d;
  o[11] = (-a[3] * s3 + a[7] * s1 - a[11] * s0) * d; o[15] = (a[2] * s3 - a[6] * s1 + a[10] * s0) * d;
  return o;
}
// the flags word of a hit entry: segment index (2 bits), iso, simple, the search count 6 (else 2); of a continuation entry: prevValid, chk, lastIndex + 1 (3 bits)
export const packHitFlags = h => (h.idx & 3) | (h.iso ? 4 : 0) | (h.simple ? 8 : 0) | (h.nb === 6 ? 16 : 0);
export const unpackHitFlags = w => ({ idx: w & 3, iso: (w & 4) !== 0, simple: (w & 8) !== 0, nb: (w & 16) !== 0 ? 6 : 2 });
export const packContFlags = c => (c.prevValid ? 1 : 0) | (c.chk ? 2 : 0) | (((c.lastIndex + 1) & 7) << 2);
export const unpackContFlags = w => ({ prevValid: (w & 1) !== 0, chk: (w & 2) !== 0, lastIndex: ((w >> 2) & 7) - 1 });

// ---- text helpers ----
const sub = (t, from, to, n = 1) => {
  const parts = t.split(from);
  if (parts.length - 1 !== n) throw new Error('csWgsl: anchor found ' + (parts.length - 1) + ' times, expected ' + n + ': ' + from.slice(0, 70));
  return parts.join(to);
};
const cutTo = (t, from, to, insert = '') => { // from the first character of `from` up to (not including) `to`, replaced by insert
  const i = t.indexOf(from), j = i < 0 ? -1 : t.indexOf(to, i + from.length);
  if (i < 0 || j < 0 || t.indexOf(from, i + 1) >= 0) throw new Error('csWgsl: region not found: ' + from.slice(0, 70));
  return t.slice(0, i) + insert + t.slice(j);
};
const tailFrom = (t, from, insert) => { const i = t.indexOf(from); if (i < 0 || t.indexOf(from, i + 1) >= 0) throw new Error('csWgsl: tail anchor: ' + from.slice(0, 70)); return t.slice(0, i) + insert; };
const F = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const cuStruct = () => uniformStruct(CS_FIELDS).replace('struct U{', 'struct CU{');

// the display variant's text with its fragment function turned into fsMain(vPosIn, posIn) for a compute shader: no rasteriser (vPos and pos come as arguments), `discard` = a flag, the creep skip off (the display's useSkip is 0)
function base(f16, cls4, enableSg) {
  let t = volumeWgsl({ f16, cls4, events: false });
  const fs = '@fragment fn fs(in:VOut)->FOut{';
  t = sub(t, fs, 'fn fsMain(vPosIn:vec3<f32>,posIn:vec4<f32>)->FOut{');
  t = sub(t, 'in.pos.z', 'posIn.z'); t = sub(t, 'in.vPos', 'vPosIn'); t = sub(t, 'in.pos.xy', 'posIn.xy');
  t = sub(t, 'discard;', 'gDiscard=true;', 4);
  t = sub(t, 'var<private> gInv:vec3<f32>=vec3<f32>(1.0);\n', 'var<private> gInv:vec3<f32>=vec3<f32>(1.0);\nvar<private> gDiscard:bool=false;\n');
  t = sub(t, 'let skipOn=u.useSkip>0&&u.diag!=4;', 'let skipOn=false;');
  t = t.replace(/(\/\/ VR \/ AR volume pass \(WGSL\), variant [^\n]*)\n/, '$1 (compute)\n');
  return (enableSg ? 'enable subgroups;\n' : '') + t;
}

// ---- group 1 declarations (every kernel module declares what it uses) ----
const G1_COMMON = () => `${cuStruct()}
@group(1) @binding(0) var vposTex:texture_2d<f32>;
@group(1) @binding(1) var outC:texture_storage_2d<rgba8unorm,write>;
@group(1) @binding(2) var outD:texture_storage_2d<rgba8unorm,write>;
@group(1) @binding(3) var<uniform> cp:CU;
${MORTON_DECODE_WGSL}
${MORTON_ENCODE_WGSL}
`;
const G1_LISTS = () => `@group(1) @binding(4) var<storage,read_write> cnt:array<atomic<u32>,8>;
@group(1) @binding(5) var<storage,read_write> hitL:array<u32>;
@group(1) @binding(6) var<storage,read_write> contOut:array<u32>;
@group(1) @binding(7) var<storage,read_write> contIn:array<u32>;
`;
// the pixel of thread li of workgroup wg (region-local rx, ry; the target pixel px), and whether it is inside the region
const PIX = `let mo=cMorton(li);let rx=wg.x*8u+mo.x;let ry=wg.y*8u+mo.y;let inside=rx<u32(cp.vw)&&ry<u32(cp.vh);
 let px=vec2<i32>(cp.vx+i32(rx),cp.vy+i32(ry));`;
const f32bits = e => `bitcast<u32>(${e})`;

// ---- the fused kernel (D-0 / D-1): the display's march for one pixel, per thread, the result stored as the display's two rgba8 targets ----
const FULL_MAIN = (pre = '', post = '') => `@compute @workgroup_size(8,8) fn csMain(@builtin(local_invocation_index) li:u32,@builtin(workgroup_id) wg:vec3<u32>${post}){
 ${PIX}
${pre} var c=vec4<f32>(0.0);var d=vec4<f32>(0.0);
 if(inside){
  let vp=textureLoad(vposTex,px,0);
  if(vp.w>=0.0){
   let fo=fsMain(vp.xyz,vec4<f32>(f32(px.x)+0.5,f32(px.y)+0.5,vp.w,1.0));
   if(!gDiscard){c=fo.color;d=fo.depth;}
  }
 }
 if(inside){textureStore(outC,px,c);textureStore(outD,px,d);}
}
`;

// ---- D-2 csTile: the tile's 64 threads find the tile's start distance tA together ----
// The pre-pass's cone (PROXY, one thread per tile marching the cone axis step by step, a chain of dependent reads) is replaced by a parallel search: in a round the 64 threads read the field at 64 points of a window of the cone axis
// (s_j = lo + (j + 0.5) / 64 * window), each gets the cone's reach h_j there (the pre-pass's own formula: the box clearance and the distance ball, both reduced by the cone's chord c * s), so [s_j - h_j, s_j + h_j] holds no sample of any ray of the tile.
// The union of these intervals that holds lo is safe: its right end (the smallest end e_j >= lo that no other interval reaches beyond, a min over the threads in shared memory) is the new lo. Rounds shrink the window by 8, so the last
// one resolves the end to a fraction of a voxel. tA = lo after the last round (every distance below it is certified empty; 3.0e38 once an interval covers past the far end of the box). The pixel's own start is then the pre-pass rule.
const COOP_WGSL = (cls4, sg) => {
  const C = PROXY, K = CS.coop;
  return `var<workgroup> tS:array<f32,${K.samples}>;
var<workgroup> tH:array<f32,${K.samples}>;
var<workgroup> tAxis:vec3<f32>;
var<workgroup> tCh:f32;
var<workgroup> tFar:f32;
var<workgroup> tLo:f32;
var<workgroup> tWin:f32;
var<workgroup> tEnd:atomic<u32>;
var<workgroup> tCov:atomic<u32>;
var<private> gTileA:f32=0.0;
fn cDirAt(px:f32,py:f32)->vec3<f32>{
 let nx=(px+0.5)/f32(cp.vw)*2.0-1.0;let ny=1.0-(py+0.5)/f32(cp.vh)*2.0;
 let c=cp.inv*vec4<f32>(nx,ny,0.5,1.0);
 return normalize(c.xyz/c.w-u.origin);
}
fn cTexCoord(q:vec3<f32>)->vec3<f32>{let g=0.5/u.halfExt;return vec3<f32>(q.x*g.x+0.5,0.5-q.y*g.y,q.z*g.z+0.5);}
fn cInside(q:vec4<f32>)->bool{
 for(var s=0;s<4;s++){let c=u.clsChan[s];if(c>=0&&u.segA[s].w>0.5&&q[c]>=0.5-${F(C.classMargin)}){return true;}}
 return false;
}
fn cReach(s:f32)->f32{
 let o=u.origin;let he=u.halfExt;let vm=u.voxelMin;
 let x=o+tAxis*s;let xc=clamp(x,-he,he);let dBox=length(x-xc);let rC=s*tCh;
 var hh=dBox-${F(C.slack)}*vm-rC;
 let tc=cl(cTexCoord(xc));
 var q=textureSampleLevel(clsTex,smp,tc,0.0);let dd=q.a*255.0;
 ${cls4 ? 'q.a=textureSampleLevel(cls4Tex,smp,tc,0.0).r;' : ''}
 if(!cInside(q)){let rho=(dd-${F(C.ddMargin)}-${F(C.slack)})*vm;hh=max(hh,rho-dBox-rC);}
 return hh;
}
// every thread of the workgroup calls this (barriers inside: no thread may leave before it); returns tA of the tile
fn coopTileA(li:u32,wg:vec3<u32>)->f32{
 if(li==0u){
  let x0=f32(wg.x*8u);let y0=f32(wg.y*8u);let x1=f32(min(u32(cp.vw),wg.x*8u+8u)-1u);let y1=f32(min(u32(cp.vh),wg.y*8u+8u)-1u);
  let d00=cDirAt(x0,y0);let d10=cDirAt(x1,y0);let d01=cDirAt(x0,y1);let d11=cDirAt(x1,y1);
  let a=normalize(d00+d10+d01+d11);
  tAxis=a;tCh=max(max(length(d00-a),length(d10-a)),max(length(d01-a),length(d11-a)))+${F(C.epsTheta)};
  tFar=length(u.origin)+length(u.halfExt);tLo=0.0;tWin=tFar;
 }
 workgroupBarrier();
 for(var r=0;r<${K.rounds};r++){
  let lo=tLo;let win=tWin;
  let s=lo+(f32(li)+0.5)/${F(K.samples)}*win;
  var h=-1.0;
  if(s>tFar){h=3.0e38;}else{h=cReach(s);}
  tS[li]=s;tH[li]=h;
  if(li==0u){atomicStore(&tEnd,0x7f7fffffu);atomicStore(&tCov,0u);}
  workgroupBarrier();
  let bj=s+h;
  var endV=bitcast<f32>(0x7f7fffffu);var covV=false;
  if(h>0.0){
   var beyond=false;
   for(var i=0;i<${K.samples};i++){if(tH[i]>0.0&&tS[i]-tH[i]<=bj&&tS[i]+tH[i]>bj){beyond=true;}}
   if(!beyond&&bj>=lo){endV=bj;}
   if(s-h<=lo&&lo<=bj){covV=true;}
  }
${sg ? `  let el=subgroupElect();let mn=subgroupMin(endV);let an=subgroupAny(covV);
  if(el){atomicMin(&tEnd,bitcast<u32>(mn));}
  if(an&&el){atomicOr(&tCov,1u);}` : `  atomicMin(&tEnd,bitcast<u32>(endV));
  if(covV){atomicOr(&tCov,1u);}`}
  workgroupBarrier();
  if(li==0u){
   if(atomicLoad(&tCov)!=0u){tLo=max(lo,bitcast<f32>(atomicLoad(&tEnd)));}
   tWin=win/${F(K.shrink)};
  }
  workgroupBarrier();
 }
 return tLo;
}
`;
};
// the volume pass's pre-pass start fed from the workgroup's own tA instead of the pre-pass's tile texture (the rule is the pre-pass's: tA past the ray's end = no march, else k = floor((tA - t0) / stp) - 1, never below 0)
const TILE_START = t => {
  t = sub(t, 'let tA=textureLoad(proxyTex,(vec2<i32>(posIn.xy)-u.proxyOrg)/8,0).r;', 'let tA=gTileA;');
  return sub(t, 'if(u.proxyOn==1){', 'if(true){');
};

// ---- D-3 csShare: a lock-step march of the tile's threads that share the safe balls their reads gave ----
// A thread that read a distance dd >= 2.7 (the jump case) at the sample point P publishes the ball (P in grid-index units, dd - 1.8): no point of that ball is inside a shown segment (the jump's own bound). The next step every thread tests
// the balls of its neighbours (the 4 neighbours in the Morton tile): when its own sample point (clamped as the read clamps) lies in a ball, the whole stretch of its ray that stays in the ball is skipped like a jump
// (m = floor(remaining radius * jkA / stp) >= 1 grid points, landing on the grid, the next sample is read normally); the balls are checked on the thread's own sample point, so any ball is safe whoever published it.
// Barriers need uniform control flow: the loop runs until no thread of the workgroup is alive (workgroupUniformLoad of a counter), a finished thread only publishes an empty ball.
const SHARE_DECL = sg => `${sg ? '' : 'var<workgroup> shBall:array<array<vec4<f32>,64>,2>;\n'}var<workgroup> shAct:array<atomic<u32>,2>;
var<workgroup> shN:array<u32,2>;
`;
function shareLoop(t, sg) {
  const K = CS.share;
  // a thread may not leave before the loop (its barriers need every thread): the early discards before the loop only mark the thread (gDiscard) and the thread stays in the loop as a finished one
  const mark = ' var previousT=t;';
  const at = t.indexOf(mark);
  if (at < 0 || t.indexOf(mark, at + 1) >= 0) throw new Error('csWgsl: share anchor ' + mark);
  t = sub(t.slice(0, at), 'gDiscard=true;return fo;', 'gDiscard=true;', 3) + t.slice(at);
  t = sub(t, 'if(u.diag==1){fo.color=vec4<f32>(0.2,0.35,0.5,1.0);return fo;}\n', '');
  t = sub(t, 'for(var iter=select(0,4096,emptyRay);iter<4096;iter++){\n', `var shAlive=!emptyRay&&!gDiscard;var shIter=0;var shStep=0u;
 let shSpeed=length(tcD*u.texDims);
 let shMo=cMorton(li);
 let shNb=array<u32,4>(cMortonEnc(select(shMo.x,shMo.x-1u,shMo.x>0u),shMo.y),cMortonEnc(select(shMo.x,shMo.x+1u,shMo.x<7u),shMo.y),cMortonEnc(shMo.x,select(shMo.y,shMo.y-1u,shMo.y>0u)),cMortonEnc(shMo.x,select(shMo.y,shMo.y+1u,shMo.y<7u)));
${sg ? ' var nb0=vec4<f32>(0.0,0.0,0.0,-1.0);var nb1=nb0;var nb2=nb0;var nb3=nb0;\n' : ''} loop{
  let shPar=shStep&1u;
  var myBall=vec4<f32>(0.0,0.0,0.0,-1.0);
  if(shAlive&&shIter>=4096){shAlive=false;}
  if(shAlive){for(var once=0;once<1;once++){
`);
  t = sub(t, '  if(t>endT||acc.a>ACC_STOP){break;}\n  iters++;\n', `  if(t>endT||acc.a>ACC_STOP){shAlive=false;break;}
  iters++;
  if(t>faceT&&u.jumpOn!=0){
   var bestRem=0.0;
   let pS=cl(tcO+tcD*t)*u.texDims;
${sg ? '   var bl:vec4<f32>;\n' + [0, 1, 2, 3].map(i => `   bl=nb${i};if(bl.w>0.0){bestRem=max(bestRem,bl.w-length(pS-bl.xyz));}`).join('\n') + '\n'
      : '   for(var nb=0;nb<4;nb++){let bl=shBall[shPar^1u][shNb[nb]];if(bl.w>0.0){bestRem=max(bestRem,bl.w-length(pS-bl.xyz));}}\n'}   let m=i32(floor((bestRem-${F(K.margin)})*jkA/stp));
   if(m>=1){let nextJ=t0+f32(k+m)*stp;jumpLen+=nextJ-t;previousT=nextJ-stp*0.05;prevValid=false;chk=false;k+=m;continue;}
  }
`);
  t = sub(t, '  chk=dd<2.7;\n', '  chk=dd<2.7;\n  if(dd>=2.7&&u.jumpOn!=0){myBall=vec4<f32>(tcS*u.texDims,dd-1.8);}\n');
  t = sub(t, 'lastIndex=idx;break;', 'lastIndex=idx;shAlive=false;break;');
  // the loop's end: the original closing brace of the for is the one just before ' if(hitIdx>=0){'
  const tailEnd = `  if(shAlive){atomicAdd(&shAct[shPar],1u);}
  workgroupBarrier();
  if(li==0u){shN[shPar]=atomicLoad(&shAct[shPar]);atomicStore(&shAct[shPar^1u],0u);}
  let shNA=workgroupUniformLoad(&shN[shPar]);
  if(shNA==0u){break;}
  shStep++;
 }
`;
  const tail = sg
    ? `  }}
  if(shAlive){shIter++;}
  let emptyB=vec4<f32>(0.0,0.0,0.0,-1.0);
  nb0=select(emptyB,subgroupShuffleXor(myBall,1u),shOk1);nb1=select(emptyB,subgroupShuffleXor(myBall,2u),shOk2);nb2=select(emptyB,subgroupShuffleXor(myBall,4u),shOk4);nb3=select(emptyB,subgroupShuffleXor(myBall,8u),shOk8);
` + tailEnd
    : `  }}
  if(shAlive){shIter++;}
  shBall[shPar][li]=myBall;
` + tailEnd;
  return sub(t, ' }\n if(hitIdx>=0){', tail + ' if(hitIdx>=0){');
}

// ---- the list kernels: a march that records its hits (and, with a limit, its unfinished rays), a kernel that searches and shades the hits ----
function marchFn(t) {
  t = sub(t, 'fn fsMain(', 'fn marchMain(');
  t = sub(t, 'var<private> gDiscard:bool=false;\n', `var<private> gDiscard:bool=false;
var<private> gResume:bool=false;var<private> gStop:i32=4096;var<private> gRk:i32=0;var<private> gRiter:i32=0;var<private> gRprev:f32=0.0;var<private> gRF:f32=0.0;var<private> gRflags:u32=0u;
var<private> gDone:bool=false;var<private> gKind:u32=0u;
var<private> gHIdx:i32=-1;var<private> gHLo:f32=0.0;var<private> gHHi:f32=0.0;var<private> gHF0:f32=0.0;var<private> gHF1:f32=0.0;var<private> gHFlags:u32=0u;
var<private> gCk:i32=0;var<private> gCiter:i32=0;var<private> gCprev:f32=0.0;var<private> gCF:f32=0.0;var<private> gCflags:u32=0u;
`);
  t = sub(t, 'for(var iter=select(0,4096,emptyRay);iter<4096;iter++){\n', `if(gResume){k=gRk;previousT=gRprev;prevF=gRF;prevValid=(gRflags&1u)!=0u;chk=(gRflags&2u)!=0u;lastIndex=i32((gRflags>>2u)&7u)-1;}
 var iterO=select(select(0,4096,emptyRay),gRiter,gResume);
 let iterStop=min(4096,gStop);
 for(;iterO<iterStop;iterO++){
`);
  t = sub(t, '  if(t>endT||acc.a>ACC_STOP){break;}\n', '  if(t>endT||acc.a>ACC_STOP){gDone=true;break;}\n');
  t = sub(t, 'lastIndex=idx;break;', 'lastIndex=idx;gDone=true;break;');
  return tailFrom(t, '\n if(hitIdx>=0){\n  let idx=hitIdx;', `
 if(hitIdx>=0){
  gKind=1u;gHIdx=hitIdx;gHLo=hitLo;gHHi=hitHi;gHF0=hitF0;gHF1=hitF1;gHFlags=${'(u32(hitIdx)&3u)|select(0u,4u,hitIso)|select(0u,8u,hitSimple)|select(0u,16u,hitNb==6)'};
 }else if(!gDone&&iterO<4096){
  gKind=2u;gCk=k;gCiter=iterO;gCprev=previousT;gCF=prevF;gCflags=select(0u,1u,prevValid)|select(0u,2u,chk)|(u32(lastIndex+1)<<2u);
 }else{gDiscard=true;}
 return fo;
}
`);
}
function shadeFn(t) {
  t = sub(t, 'fn fsMain(', 'fn shadeMain(');
  t = sub(t, 'var<private> gDiscard:bool=false;\n', `var<private> gDiscard:bool=false;
var<private> gSIdx:i32=-1;var<private> gSLo:f32=0.0;var<private> gSHi:f32=0.0;var<private> gSF0:f32=0.0;var<private> gSF1:f32=0.0;var<private> gSFlags:u32=0u;
`);
  // the loop is not run: the hit state comes from the list (the part before it, the ray's set-up, is the same code as the march's and gives the same o, dir, faceEnd)
  return cutTo(t, ' for(var iter=select(0,4096,emptyRay);iter<4096;iter++){\n', '\n if(hitIdx>=0){\n  let idx=hitIdx;',
    ' hitIdx=gSIdx;hitLo=gSLo;hitHi=gSHi;hitF0=gSF0;hitF1=gSF1;hitIso=(gSFlags&4u)!=0u;hitSimple=(gSFlags&8u)!=0u;hitNb=select(2,6,(gSFlags&16u)!=0u);');
}
// the module text of one kernel set
// opts: { f16, cls4, mode: 'full' | 'tile' | 'share' | 'march' | 'shade', sg }
export function csWgsl({ f16 = false, cls4 = false, mode = 'full', sg = false } = {}) {
  if (!CS_MODES.includes(mode)) throw new Error('csWgsl: unknown mode ' + mode);
  let t = base(f16, cls4, sg);
  const head = '// compute variant: mode=' + mode + (sg ? ' sg' : '') + '\n';
  if (mode === 'full') return t + head + G1_COMMON() + FULL_MAIN();
  if (mode === 'tile') {
    t = TILE_START(t);
    return t + head + G1_COMMON() + COOP_WGSL(cls4, sg) + FULL_MAIN(`
 let tileA=coopTileA(li,wg);gTileA=tileA;
`);
  }
  if (mode === 'share') {
    t = shareLoop(t, sg);
    t = sub(t, 'fn fsMain(vPosIn:vec3<f32>,posIn:vec4<f32>)->FOut{', 'fn fsMain(vPosIn:vec3<f32>,posIn:vec4<f32>,li:u32)->FOut{');
    const main = `@compute @workgroup_size(8,8) fn csMain(@builtin(local_invocation_index) li:u32,@builtin(workgroup_id) wg:vec3<u32>${sg ? ',@builtin(subgroup_invocation_id) sgId:u32,@builtin(subgroup_size) sgSize:u32' : ''}){
 ${PIX}
 var c=vec4<f32>(0.0);var d=vec4<f32>(0.0);
 var vp=vec4<f32>(0.0,0.0,0.0,-1.0);
 if(inside){vp=textureLoad(vposTex,px,0);}
 ${sg ? 'gSg=vec2<u32>(sgId,sgSize);' : ''}
 // every thread calls fsMain (the lock-step loop has barriers): an uncovered thread sets the ray to a miss (vp.w < 0 -> no march, alive = false)
 let fo=fsMain(vp.xyz,vec4<f32>(f32(px.x)+0.5,f32(px.y)+0.5,vp.w,1.0),li);
 if(inside&&vp.w>=0.0&&!gDiscard){c=fo.color;d=fo.depth;}
 if(inside){textureStore(outC,px,c);textureStore(outD,px,d);}
}
`;
    if (sg) {
      // subgroup form: the neighbour values come from shuffles; a lane whose partner is outside the subgroup gets an empty ball
      t = sub(t, 'var<private> gDiscard:bool=false;\n', 'var<private> gDiscard:bool=false;\nvar<private> gSg:vec2<u32>=vec2<u32>(0u,1u);\n');
      t = sub(t, ' let shMo=cMorton(li);\n', ' let shMo=cMorton(li);\n let shOk1=(gSg.x^1u)<gSg.y;let shOk2=(gSg.x^2u)<gSg.y;let shOk4=(gSg.x^4u)<gSg.y;let shOk8=(gSg.x^8u)<gSg.y;\n');
    }
    return t + head + G1_COMMON() + SHARE_DECL(sg) + main;
  }
  if (mode === 'march') {
    t = marchFn(t);
    return t + head + G1_COMMON() + G1_LISTS() + `
const CAP_ERR:u32=7u;
fn recordResult(px:vec2<i32>){
 if(gKind==1u){
  let s=atomicAdd(&cnt[0],1u);
  if(s<u32(cp.cap)){let b=s*${CS.hitStride}u;hitL[b]=u32(px.x)|(u32(px.y)<<16u);hitL[b+1u]=gHFlags;hitL[b+2u]=${f32bits('gHLo')};hitL[b+3u]=${f32bits('gHHi')};hitL[b+4u]=${f32bits('gHF0')};hitL[b+5u]=${f32bits('gHF1')};}
  else{atomicAdd(&cnt[CAP_ERR],1u);textureStore(outC,px,vec4<f32>(0.0));textureStore(outD,px,vec4<f32>(0.0));}
 }else if(gKind==2u){
  let s=atomicAdd(&cnt[1u+u32(cp.wave)],1u);
  if(s<u32(cp.cap)){let b=s*${CS.contStride}u;contOut[b]=u32(px.x)|(u32(px.y)<<16u);contOut[b+1u]=gCflags;contOut[b+2u]=bitcast<u32>(gCk);contOut[b+3u]=bitcast<u32>(gCiter);contOut[b+4u]=${f32bits('gCprev')};contOut[b+5u]=${f32bits('gCF')};}
  else{atomicAdd(&cnt[CAP_ERR],1u);textureStore(outC,px,vec4<f32>(0.0));textureStore(outD,px,vec4<f32>(0.0));}
 }else{textureStore(outC,px,vec4<f32>(0.0));textureStore(outD,px,vec4<f32>(0.0));}
}
@compute @workgroup_size(8,8) fn csMarchPix(@builtin(local_invocation_index) li:u32,@builtin(workgroup_id) wg:vec3<u32>){
 ${PIX}
 if(!inside){return;}
 let vp=textureLoad(vposTex,px,0);
 if(vp.w<0.0){textureStore(outC,px,vec4<f32>(0.0));textureStore(outD,px,vec4<f32>(0.0));return;}
 gStop=cp.stop;
 let fo=marchMain(vp.xyz,vec4<f32>(f32(px.x)+0.5,f32(px.y)+0.5,vp.w,1.0));
 recordResult(px);
}
@compute @workgroup_size(64) fn csMarchList(@builtin(global_invocation_id) g:vec3<u32>){
 let i=g.x;
 let n=min(atomicLoad(&cnt[u32(cp.wave)]),u32(cp.cap));
 if(i>=n){return;}
 let b=i*${CS.contStride}u;
 let pk=contIn[b];let px=vec2<i32>(i32(pk&65535u),i32(pk>>16u));
 gResume=true;gRflags=contIn[b+1u];gRk=bitcast<i32>(contIn[b+2u]);gRiter=bitcast<i32>(contIn[b+3u]);gRprev=bitcast<f32>(contIn[b+4u]);gRF=bitcast<f32>(contIn[b+5u]);gStop=cp.stop;
 let vp=textureLoad(vposTex,px,0);
 let fo=marchMain(vp.xyz,vec4<f32>(f32(px.x)+0.5,f32(px.y)+0.5,vp.w,1.0));
 recordResult(px);
}
`;
  }
  // shade
  t = shadeFn(t);
  return t + head + G1_COMMON() + G1_LISTS() + `
@compute @workgroup_size(64) fn csShadeList(@builtin(global_invocation_id) g:vec3<u32>){
 let i=g.x;
 let n=min(atomicLoad(&cnt[0]),u32(cp.cap));
 if(i>=n){return;}
 let b=i*${CS.hitStride}u;
 let pk=hitL[b];let px=vec2<i32>(i32(pk&65535u),i32(pk>>16u));
 gSFlags=hitL[b+1u];gSIdx=i32(gSFlags&3u);gSLo=bitcast<f32>(hitL[b+2u]);gSHi=bitcast<f32>(hitL[b+3u]);gSF0=bitcast<f32>(hitL[b+4u]);gSF1=bitcast<f32>(hitL[b+5u]);
 let vp=textureLoad(vposTex,px,0);
 let fo=shadeMain(vp.xyz,vec4<f32>(f32(px.x)+0.5,f32(px.y)+0.5,vp.w,1.0));
 var c=vec4<f32>(0.0);var d=vec4<f32>(0.0);
 if(!gDiscard){c=fo.color;d=fo.depth;}
 textureStore(outC,px,c);textureStore(outD,px,d);
}
`;
}

// the kernel that turns a list's count into dispatch arguments (indirect dispatch: no read-back); its bindings must not be bound in the dispatch that consumes the arguments
export function csArgsWgsl() {
  return `// compute variant: dispatch arguments of a list pass (JS twin: indirectArgs)
struct AU{src:u32,dst:u32,cap:u32,pad:u32};
@group(0) @binding(0) var<uniform> au:AU;
@group(0) @binding(1) var<storage,read_write> cnt:array<atomic<u32>,8>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(1) fn main(){
 let n=min(atomicLoad(&cnt[au.src]),au.cap);
 let x=min((n+63u)/64u,${CS.maxGroups}u);
 args[au.dst*4u]=x;args[au.dst*4u+1u]=1u;args[au.dst*4u+2u]=1u;
}
`;
}

// the render pass that writes the fragment shader's inputs: vPos (the interpolated back-face point, as the display's fragment shader receives it) and the fragment's depth, into an rgba32float target cleared to w = -1 (= not covered).
// The vertex stage is the display's own text, copied out of the display variant (so the points and the covered pixels are the fragment shader's)
export function vposWgsl() {
  const d = volumeWgsl({ f16: false, cls4: false, events: false });
  const i = d.indexOf('struct VOut{'), j = d.indexOf('struct FOut{');
  if (i < 0 || j < i) throw new Error('csWgsl: vertex stage not found');
  return `// compute variant: the fragment shader's inputs (vPos, pos.z) as a float image
${uniformStruct()}
@group(0) @binding(0) var<uniform> u:U;
${d.slice(i, j)}@fragment fn fsPos(in:VOut)->@location(0) vec4<f32>{return vec4<f32>(in.vPos,in.pos.z);}
`;
}

// the count of pixels where colour or packed depth differ between two images, inside one rect (x0, y0, x1, y1 in px), per dispatch (the host runs one per eye)
export function csDiffWgsl() {
  return `// compute variant: pixels where colour or depth differ between the display's targets and the compute variant's, inside a rect
struct DU{x0:u32,y0:u32,x1:u32,y1:u32};
@group(0) @binding(0) var cA:texture_2d<f32>;
@group(0) @binding(1) var dA:texture_2d<f32>;
@group(0) @binding(2) var cB:texture_2d<f32>;
@group(0) @binding(3) var dB:texture_2d<f32>;
@group(0) @binding(4) var<storage,read_write> cnt:atomic<u32>;
@group(0) @binding(5) var<uniform> du:DU;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let p=g.xy+vec2<u32>(du.x0,du.y0);
 if(p.x>=du.x1||p.y>=du.y1){return;}
 let q=vec2<i32>(p);
 if(any(textureLoad(cA,q,0)!=textureLoad(cB,q,0))||any(textureLoad(dA,q,0)!=textureLoad(dB,q,0))){atomicAdd(&cnt,1u);}
}
`;
}
