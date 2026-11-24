// The coarse distance grid and the pre-pass that reads only it (group 2: A1' and A1 of the plan), as variants of the performance record's shadow pass (docs/vr-wgpu.js shadowPass, docs/vr-perf-log.js BD_SPECS).
// Nothing here draws or changes the display: the display low pass keeps its own pre-pass (docs/vr-wgsl-core.js proxyWgsl, read with 8 x 8 pixel tiles from the 64 MB combined texture). The variants measured here are
//   proxyTB      : the display's pre-pass (fine reads of the combined texture, 8 x 8 tiles) + the far end tB
//   proxyCoarse8 : the coarse grid below instead of the combined texture, 8 x 8 tiles, tA + tB
//   proxyCoarse  : the coarse grid, 4 x 4 tiles, tA + tB
// Each runs its compute pass, then the volume pass with a program made from the display text (see coarseVolumeWgsl) into scratch targets, and counts the pixels that differ from the display's own low pass.
//
// ---- the coarse grid (A1') ----
// One byte per cell of 4 x 4 x 4 texels of the combined texture (256^3 -> 64^3, 256 KB: the bytes are packed four cells along x into one rgba8uint texel, the grid is a 3D texture of (cells x / 4) x cells y x cells z).
// The value of a cell = the minimum, over the texels a trilinear fetch at any point of the cell can read, of V, where V = 0 when a shown slot is (or may be, class >= 0.5 - classMargin) inside the texel, else the distance byte (alpha) of the texel.
// A trilinear fetch at a point whose texture coordinate lies in the cell (texel coordinate v in [4c, 4c + 4), p = v - 0.5, floor(p) in [4c - 1, 4c + 3]) reads the texels floor(p) and floor(p) + 1, i.e. texel indices 4c - 1 .. 4c + 4 (clamped to the texture: the sampler clamps
// to the edge). So the footprint of a cell is the cell's own texels dilated by one texel on each side. The sampled value of the distance field at any point of the cell is a convex combination of footprint texels, hence >= the cell's minimum:
//     D_c <= dd(x) for every x of the cell  (and D_c = 0 where an inside texel is in the footprint).
// The pre-pass reads D_c with textureLoad at the cell that contains the point (never filtered: an interpolated minimum is not a lower bound). A point that sits within float error of a cell boundary may read the neighbouring cell; that is still
// covered, because the dilation by one texel contains the footprint of both sides (a point at v = 4c - e reads texels 4c - 1 and 4c, both inside cell c's footprint 4c - 1 .. 4c + 4, and symmetrically for the other side).
// The reach it gives, rho = (D_c - ddMargin - slack) * voxelMin, is therefore never larger than the reach the display's pre-pass takes at the same point from the same field (rho = (dd(x) - ddMargin - slack) * voxelMin): a ball that is a subset of a ball
// the display's own pre-pass already trusts (docs/vr-wgsl-core.js PROXY; the margin 1.8 = 2 x the half diagonal of a texel, covers the distance of the point and of the sample to the texel centres). The coarse grid costs reach near a surface (D_c is 0 up to
// about a cell plus a texel from it), not safety: the volume pass walks that last stretch with its own jumps.
//
// ---- the cone ----
// Per tile (T x T pixels) one cone is marched twice from the eye. Forward from s = 0: every sample of every ray of the tile at a distance < tA, inside the box, is outside every shown segment (the display's tA). Backward from s = far (no point of the box is farther
// from the eye): every sample at a distance > tB is outside too (tB, the end of the walk). Each step at the axis point x = o + s a takes a ball of radius R around x tissue-free, where R = max(dBox - slack, rho(xc) - dBox) (xc = x clamped to the box, dBox = |x - xc|: outside
// the box the march has no samples), and covers the interval [s - h, s + h] of the axis with h = (R - s c) / (1 + c): a ray at an angle th from the axis, at distance sigma, is within sigma c + |sigma - s| of x (c = the chord coefficient of the tile: the largest
// |corner direction - axis| + epsTheta), so for sigma in [s - h, s + h] it is within (s + h) c + h <= R of x. (The display's pre-pass uses h = R - s c and leaves out the factor 1 + c, a 0.5 % effect that its slack covers; here it is kept.)
// A forward step stops when h < hMin voxels: tA = s (everything below is covered). A backward step stops likewise: tB = s (everything above is covered). When the backward walk goes below tA the two covered parts meet and the whole line is empty: tA = "empty".
//
// ---- what the volume pass does with (tA, tB) ----
// The march starts one grid point before the one tA falls on (k = floor((tA - t0) / stp) - 1, never below 0: the display's rule, so a hit k* >= k + 1) and its end is min(endT, tB): the loop ends when t > endT, and no sample past tB is inside a shown segment,
// so no hit, no accumulated colour and no depth mark happens there. Only the start and the end move; the samples, jumps, hit bracket, search and shading are the march's own.
import { uniformLayout, uniformStruct, PROXY, PROXY_FIELDS, PROXY_DIFF_BINDINGS, volumeWgsl } from './vr-wgsl-core.js?v=20261124-build759';

export const COARSE = { cell: 4, perTexel: 4, empty: PROXY.empty, rebuildEvery: 6 };
// the variants of the shadow pass (docs/vr-perf-log.js BD_SPECS carries the same table under `coarse`)
export const COARSE_VARIANTS = {
  proxyTB: { grid: false, tile: 8 },
  proxyCoarse8: { grid: true, tile: 8 },
  proxyCoarse: { grid: true, tile: 4 },
};
const F = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// ---- uniforms ----
// the pre-pass's own fields (PROXY_FIELDS, the same layout: the display pre-pass's bytes are copied into the front of this buffer) and the grid's
export const COARSE_FIELDS = [...PROXY_FIELDS, ['texDims', 'vec3f'], ['cdims', 'vec4i']];
export const BUILD_FIELDS = [['dims', 'vec4i'], ['cdims', 'vec4i'], ['clsChan', 'vec4i'], ['segOn', 'vec4i']];
export const BUILD_BINDINGS = { params: 0, cls: 1, cls4: 2, out: 3 };
export const FINE_BINDINGS = { params: 0, cls: 1, cls4: 2, sampler: 3, out: 4 };
export const COARSE_BINDINGS = { params: 0, grid: 1, out: 4 };

// the cells of a texture of dims [w, h, d], and the packed texture (4 cells along x per rgba8uint texel)
export const coarseDims = dims => dims.map(n => Math.ceil(n / COARSE.cell));
export const packedDims = dims => { const c = coarseDims(dims); return [Math.ceil(c[0] / COARSE.perTexel), c[1], c[2]]; };

// ---- the grid's build (compute): one thread per rgba8uint texel = four cells along x ----
export function coarseBuildWgsl({ cls4 = false } = {}) {
  const thr = 0.5 - PROXY.classMargin;
  return `// VR / AR coarse distance grid build (WGSL), cls4=${cls4}: min over the dilated footprint of every 4 x 4 x 4 cell (see docs/vr-wgpu-coarse-proxy.js)
${uniformStruct(BUILD_FIELDS)}
@group(0) @binding(0) var<uniform> g:U;
@group(0) @binding(1) var clsTex:texture_3d<f32>;
@group(0) @binding(2) var cls4Tex:texture_3d<f32>;
@group(0) @binding(3) var gridOut:texture_storage_3d<rgba8uint,write>;
fn vox(p:vec3<i32>)->u32{
 var q=textureLoad(clsTex,p,0);
 let d=u32(round(q.a*255.0));
 ${cls4 ? 'q.a=textureLoad(cls4Tex,p,0).r;' : ''}
 for(var s=0;s<4;s++){let c=g.clsChan[s];if(c>=0&&g.segOn[s]!=0&&q[c]>=${F(thr)}){return 0u;}}
 return min(d,255u);
}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let t=vec3<i32>(id);
 let px=(g.cdims.x+${COARSE.perTexel - 1})/${COARSE.perTexel};
 if(t.x>=px||t.y>=g.cdims.y||t.z>=g.cdims.z){return;}
 var m=vec4<u32>(255u);
 for(var z=${COARSE.cell}*t.z-1;z<=${COARSE.cell}*t.z+${COARSE.cell};z++){
  if(z<0||z>=g.dims.z){continue;}
  for(var y=${COARSE.cell}*t.y-1;y<=${COARSE.cell}*t.y+${COARSE.cell};y++){
   if(y<0||y>=g.dims.y){continue;}
   for(var xi=0;xi<${COARSE.cell * COARSE.perTexel + 2};xi++){
    let x=${COARSE.cell * COARSE.perTexel}*t.x-1+xi;
    if(x<0||x>=g.dims.x){continue;}
    let v=vox(vec3<i32>(x,y,z));
    if(xi<=5){m.x=min(m.x,v);}
    if(xi>=4&&xi<=9){m.y=min(m.y,v);}
    if(xi>=8&&xi<=13){m.z=min(m.z,v);}
    if(xi>=12){m.w=min(m.w,v);}
   }
  }
 }
 for(var j=0;j<${COARSE.perTexel};j++){if(${COARSE.perTexel}*t.x+j>=g.cdims.x){m[j]=0u;}}
 textureStore(gridOut,t,m);
}
`;
}

// ---- the pre-pass (compute): one cone per tile, forward (tA) and backward (tB), into an rg32float texture (tiles of both eyes side by side) ----
// mode 'fine' reads the combined texture like the display's pre-pass (a filtered fetch at the nearest box point); mode 'coarse' reads the grid (textureLoad of the cell).
export function coarseProxyWgsl({ cls4 = false, mode = 'coarse', tile = 4 } = {}) {
  const C = PROXY;
  if (mode !== 'fine' && mode !== 'coarse') throw new Error('coarseProxyWgsl: unknown mode ' + mode);
  const bindings = mode === 'fine'
    ? `@group(0) @binding(1) var clsTex:texture_3d<f32>;
@group(0) @binding(2) var cls4Tex:texture_3d<f32>;
@group(0) @binding(3) var smp:sampler;`
    : '@group(0) @binding(1) var gridTex:texture_3d<u32>;';
  const ball = mode === 'fine'
    ? `fn anyInside(q:vec4<f32>)->bool{
 for(var s=0;s<4;s++){let c=p.clsChan[s];if(c>=0&&p.segOn[s]!=0&&q[c]>=0.5-${F(C.classMargin)}){return true;}}
 return false;
}
// the radius of a tissue-free ball around xc (a point of the box), from the distance byte of a filtered fetch there; none (a very negative value) when xc is inside a shown segment
fn ballAt(xc:vec3<f32>)->f32{
 let tc=cl(texCoord(xc));
 var q=textureSampleLevel(clsTex,smp,tc,0.0);let dd=q.a*255.0;
 ${cls4 ? 'q.a=textureSampleLevel(cls4Tex,smp,tc,0.0).r;' : ''}
 if(anyInside(q)){return -1.0e30;}
 return (dd-${F(C.ddMargin)}-${F(C.slack)})*p.voxelMin;
}`
    : `// the radius of a tissue-free ball around xc (a point of the box), from the grid's cell that contains it (the value is the minimum over everything a fetch of the cell can read)
fn ballAt(xc:vec3<f32>)->f32{
 let tc=cl(texCoord(xc));
 let v=tc*p.texDims;
 let c=min(vec3<i32>(v)/${COARSE.cell},p.cdims.xyz-vec3<i32>(1));
 let t=textureLoad(gridTex,vec3<i32>(c.x/${COARSE.perTexel},c.y,c.z),0);
 let d=f32(t[c.x%${COARSE.perTexel}]);
 return (d-${F(C.ddMargin)}-${F(C.slack)})*p.voxelMin;
}`;
  const T = tile;
  return `// VR / AR volume pre-pass (WGSL), mode=${mode} cls4=${cls4} tile=${T}: tA and tB per ${T} x ${T} pixel tile (see docs/vr-wgpu-coarse-proxy.js)
${uniformStruct(COARSE_FIELDS)}
@group(0) @binding(0) var<uniform> p:U;
${bindings}
@group(0) @binding(4) var tilesOut:texture_storage_2d<rg32float,write>;
const EMPTY:f32=${C.empty.toExponential(1)};
fn texCoord(q:vec3<f32>)->vec3<f32>{let g=0.5/p.halfExt;return vec3<f32>(q.x*g.x+0.5,0.5-q.y*g.y,q.z*g.z+0.5);}
fn cl(tc:vec3<f32>)->vec3<f32>{return clamp(tc,vec3<f32>(0.0),vec3<f32>(0.999999));}
fn eyeOrg(e:i32)->vec3<f32>{if(e==1){return p.org1;}return p.org0;}
fn dirAt(e:i32,px:f32,py:f32,w:f32,h:f32)->vec3<f32>{
 let nx=(px+0.5)/w*2.0-1.0;let ny=1.0-(py+0.5)/h*2.0;
 var m=p.inv0;if(e==1){m=p.inv1;}
 let c=m*vec4<f32>(nx,ny,0.5,1.0);
 return normalize(c.xyz/c.w-eyeOrg(e));
}
${ball}
// the radius R of a ball around the axis point x that holds no sample of a shown segment: outside the box the march has no samples (the ball of the box distance), inside the ball of the field around the nearest box point
fn reachAt(x:vec3<f32>)->f32{
 let he=p.halfExt;let xc=clamp(x,-he,he);let dBox=length(x-xc);
 return max(dBox-${F(C.slack)}*p.voxelMin,ballAt(xc)-dBox);
}
fn cone(e:i32,lx:i32,ty:i32,w:i32,h:i32)->vec2<f32>{
 let x0=f32(lx*${T});let y0=f32(ty*${T});let x1=f32(min(w,lx*${T}+${T})-1);let y1=f32(min(h,ty*${T}+${T})-1);
 let fw=f32(w);let fh=f32(h);
 let d00=dirAt(e,x0,y0,fw,fh);let d10=dirAt(e,x1,y0,fw,fh);let d01=dirAt(e,x0,y1,fw,fh);let d11=dirAt(e,x1,y1,fw,fh);
 let o=eyeOrg(e);let a=normalize(d00+d10+d01+d11);
 let ch=max(max(length(d00-a),length(d10-a)),max(length(d01-a),length(d11-a)))+${F(C.epsTheta)};
 let k1=1.0/(1.0+ch);let hMin=${F(C.hMin)}*p.voxelMin;let far=length(o)+length(p.halfExt);
 var sA=0.0;
 for(var it=0;it<${C.maxIt};it++){
  if(sA>far){return vec2<f32>(EMPTY,0.0);}
  let hh=(reachAt(o+a*sA)-sA*ch)*k1;
  if(hh<hMin){break;}
  sA+=hh;
 }
 var sB=far;
 for(var it=0;it<${C.maxIt};it++){
  let hh=(reachAt(o+a*sB)-sB*ch)*k1;
  if(hh<hMin){break;}
  sB-=hh;
  if(sB<sA){return vec2<f32>(EMPTY,0.0);}
 }
 return vec2<f32>(sA,sB);
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let tx=i32(g.x);let ty=i32(g.y);
 if(tx>=p.tilesPerEye*p.nEyes||ty>=p.tilesY){return;}
 let e=tx/p.tilesPerEye;let lx=tx-e*p.tilesPerEye;
 var w=p.w0;var h=p.h0;if(e==1){w=p.w1;h=p.h1;}
 var res=vec2<f32>(EMPTY,0.0);
 if(lx*${T}<w&&ty*${T}<h){res=cone(e,lx,ty,w,h);}
 textureStore(tilesOut,vec2<i32>(tx,ty),vec4<f32>(res,0.0,0.0));
}
`;
}

// ---- the volume pass of a variant: the display text with the tile size, the tB channel and the end of the walk (exact substitutions: every anchor must occur once, else this throws) ----
const sub = (t, from, to) => {
  const parts = t.split(from);
  if (parts.length - 1 !== 1) throw new Error('coarseVolumeWgsl: anchor found ' + (parts.length - 1) + ' times, expected 1: ' + from.slice(0, 70));
  return parts.join(to);
};
export const VOLUME_ANCHORS = [
  'let tA=textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/8,0).r;',
  'if(tA>endT){emptyRay=true;}else if(tA>t0){k=max(0,i32(floor((tA-t0)/stp))-1);}',
];
export function coarseVolumeWgsl({ f16 = false, cls4 = false } = {}, tile = 4) {
  let t = volumeWgsl({ f16, cls4, events: false });
  t = sub(t, VOLUME_ANCHORS[0], `let tt=textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/${tile},0).rg;let tA=tt.r;`);
  t = sub(t, VOLUME_ANCHORS[1], 'if(tA>endT){emptyRay=true;}else{if(tA>t0){k=max(0,i32(floor((tA-t0)/stp))-1);}endT=min(endT,tt.g);}');
  return t.replace(/(\/\/ VR \/ AR volume pass \(WGSL\), variant [^\n]*)\n/, '$1 coarse-tile=' + tile + '\n');
}

// ---- the CPU twins (the unit tests and the SwiftShader check compare the GPU with these) ----
// the combined texture's data: rgba8 (class of up to three slots in rgb, the distance byte in alpha); cls4 = the fourth slot's class bytes (one per texel) or null; chan = the channel of each slot (-1 none), segOn = 1 where the slot is shown
export function insideTexel({ data, cls4 = null }, i, chan, segOn, classMargin = PROXY.classMargin) {
  const thr = Math.fround(0.5 - classMargin);
  for (let s = 0; s < 4; s++) {
    const c = chan[s];
    if (c < 0 || !segOn[s]) continue;
    const byte = c === 3 && cls4 ? cls4[i] : data[i * 4 + c];
    if (Math.fround(byte / 255) >= thr) return true;
  }
  return false;
}
// V of every texel: 0 where a shown slot is (may be) inside, else the distance byte
export function texelValues(grid) {
  const { data, dims, chan, segOn, cls4 = null, classMargin = PROXY.classMargin } = grid, n = dims[0] * dims[1] * dims[2], v = new Uint8Array(n);
  for (let i = 0; i < n; i++) v[i] = insideTexel({ data, cls4 }, i, chan, segOn, classMargin) ? 0 : data[i * 4 + 3];
  return v;
}
// the grid bytes, x fastest, dims coarseDims(dims); the minimum of V over the cell's texels dilated by one texel per side (clamped to the texture)
export function coarseGridCpu(grid) {
  const dims = grid.dims, [W, H, D] = dims, cd = coarseDims(dims), V = texelValues(grid), out = new Uint8Array(cd[0] * cd[1] * cd[2]);
  for (let cz = 0; cz < cd[2]; cz++) for (let cy = 0; cy < cd[1]; cy++) for (let cx = 0; cx < cd[0]; cx++) {
    let m = 255;
    for (let z = Math.max(0, cz * 4 - 1); z <= Math.min(D - 1, cz * 4 + 4); z++) for (let y = Math.max(0, cy * 4 - 1); y <= Math.min(H - 1, cy * 4 + 4); y++) for (let x = Math.max(0, cx * 4 - 1); x <= Math.min(W - 1, cx * 4 + 4); x++) m = Math.min(m, V[(z * H + y) * W + x]);
    out[(cz * cd[1] + cy) * cd[0] + cx] = m;
  }
  return out;
}
// the packed texture's bytes: rows of (texels x) * 4 bytes (the cells beyond the grid are 0), as the build shader writes them
export function packGrid(bytes, dims) {
  const cd = coarseDims(dims), pd = packedDims(dims), rowBytes = pd[0] * COARSE.perTexel, out = new Uint8Array(rowBytes * cd[1] * cd[2]);
  for (let z = 0; z < cd[2]; z++) for (let y = 0; y < cd[1]; y++) for (let x = 0; x < cd[0]; x++) out[(z * cd[1] + y) * rowBytes + x] = bytes[(z * cd[1] + y) * cd[0] + x];
  return out;
}
// the world point -> texture coordinate map of the shader (y is flipped)
export const texCoordOf = (p, halfExt) => [p[0] / (2 * halfExt[0]) + 0.5, 0.5 - p[1] / (2 * halfExt[1]), p[2] / (2 * halfExt[2]) + 0.5];
// m = { halfExt, voxelMin, o, W, H, dirOf(px, py), reach(xc) -> radius of a tissue-free ball around xc (-Infinity: none) }; opt overrides the constants (negative controls)
// returns { tA, tB } (tA = Infinity: the tile is empty) and the iteration counts
export function coneCpu(m, tile, tx, ty, opt = {}) {
  const c = { slack: PROXY.slack, hMin: PROXY.hMin, maxIt: PROXY.maxIt, epsTheta: PROXY.epsTheta, noOnePlusC: false, ...opt };
  const { W, H, halfExt: he, voxelMin: vm, o } = m;
  const x0 = tx * tile, y0 = ty * tile, x1 = Math.min(W, x0 + tile) - 1, y1 = Math.min(H, y0 + tile) - 1;
  const cs = [m.dirOf(x0, y0), m.dirOf(x1, y0), m.dirOf(x0, y1), m.dirOf(x1, y1)];
  let a = [0, 0, 0]; for (const d of cs) for (let k = 0; k < 3; k++) a[k] += d[k];
  const la = Math.hypot(...a); a = a.map(v => v / la);
  let ch = 0; for (const d of cs) ch = Math.max(ch, Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]));
  ch += c.epsTheta;
  const k1 = c.noOnePlusC ? 1 : 1 / (1 + ch), hMin = c.hMin * vm, far = Math.hypot(...o) + Math.hypot(...he);
  const R = s => {
    const x = o.map((v, k) => v + a[k] * s), xc = x.map((v, k) => Math.min(Math.max(v, -he[k]), he[k])), dBox = Math.hypot(...x.map((v, k) => v - xc[k]));
    return Math.max(dBox - c.slack * vm, m.reach(xc) - dBox);
  };
  let sA = 0, itA = 0, itB = 0;
  for (; itA < c.maxIt; itA++) {
    if (sA > far) return { tA: Infinity, tB: 0, itA, itB };
    const hh = (R(sA) - sA * ch) * k1;
    if (hh < hMin) break;
    sA += hh;
  }
  let sB = far;
  for (; itB < c.maxIt; itB++) {
    const hh = (R(sB) - sB * ch) * k1;
    if (hh < hMin) break;
    sB -= hh;
    if (sB < sA) return { tA: Infinity, tB: 0, itA, itB };
  }
  return { tA: sA, tB: sB, itA, itB };
}
// the reach of the coarse grid at xc: (D_c - ddMargin - slack) x voxelMin of the cell that contains it (the shader's ballAt)
export function coarseReachCpu(bytes, dims, halfExt, voxelMin, opt = {}) {
  const cd = coarseDims(dims), ddMargin = opt.ddMargin ?? PROXY.ddMargin, slack = opt.slack ?? PROXY.slack;
  return xc => {
    const tc = texCoordOf(xc, halfExt).map(v => Math.min(Math.max(v, 0), 0.999999)), c = tc.map((v, k) => Math.min(Math.floor(Math.fround(v * dims[k])) / COARSE.cell | 0, cd[k] - 1));
    return (bytes[(c[2] * cd[1] + c[1]) * cd[0] + c[0]] - ddMargin - slack) * voxelMin;
  };
}

// ---- the host: the compute passes and the shadow pass of the variants (made by docs/vr-wgpu.js inside createVolumeGpu; ctx = what it lends) ----
// ctx: device, f16, getBd() (the breakdown's state: snap, slots, qs, resolve, tgt, tgt2, diff, tmp, onShadow, failed), layout (the volume uniform layout), ubufOf(i), bindGroup(index, u, pxTex), dummy(kind), gpuOf(texture), dropGroups(gpuTexture),
// linear (the sampler), boxBuf, pipeDescFor(module), displayPipe(variant), uploadGen() (a stamp that changes whenever any texture's contents are written), pair(rec, name, slot) (pairs a shadow pass's ms with the frame's low pass), onShader(module, info)
export function createCoarseProxy(ctx) {
  const { device } = ctx;
  const cpLayout = uniformLayout(COARSE_FIELDS), pxLayout = uniformLayout(PROXY_FIELDS), buildLayout = uniformLayout(BUILD_FIELDS), volField = n => ctx.layout.fields.find(f => f.name === n);
  const fld = (L, n) => L.fields.find(f => f.name === n);
  const st = { progs: new Map(), build: new Map(), buildJob: new Map(), layouts: null, grid: null, tiles: [], cpBuf: null, buildBuf: null, uses: 0, ids: new WeakMap(), seq: 0 };
  const idOf = t => { let i = st.ids.get(t); if (!i) { i = ++st.seq; st.ids.set(t, i); } return i; };
  const stage = (b, name, text) => { try { b.failed.push(name + ': ' + text); } catch { /* gone */ } try { b.onShadow?.('proxyFail:' + name, 1, 1); } catch { /* the page's callback */ } };
  const layouts = () => st.layouts ||= {
    build: device.createBindGroupLayout({ entries: [
      { binding: BUILD_BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: BUILD_BINDINGS.cls, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: BUILD_BINDINGS.cls4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: BUILD_BINDINGS.out, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8uint', viewDimension: '3d' } },
    ] }),
    fine: device.createBindGroupLayout({ entries: [
      { binding: FINE_BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: FINE_BINDINGS.cls, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: FINE_BINDINGS.cls4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: FINE_BINDINGS.sampler, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: FINE_BINDINGS.out, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rg32float', viewDimension: '2d' } },
    ] }),
    coarse: device.createBindGroupLayout({ entries: [
      { binding: COARSE_BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: COARSE_BINDINGS.grid, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint', viewDimension: '3d' } },
      { binding: COARSE_BINDINGS.out, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rg32float', viewDimension: '2d' } },
    ] }),
  };
  const computeDesc = (L, code, info) => {
    const module = device.createShaderModule({ code });
    try { ctx.onShader?.(module, info); } catch { /* diagnostics only */ }
    return { layout: device.createPipelineLayout({ bindGroupLayouts: [L] }), compute: { module, entryPoint: 'main' } };
  };
  // the programs of one variant for the display variant in use: made once, asynchronously; 'pending' until then (the caller retries), 'failed' (the caller steps past the variant)
  const progsOf = (name, spec, cls4, b) => {
    const key = name + (cls4 ? ':c4' : ':c3'), have = st.progs.get(key);
    if (have) return have;
    const p = { state: 'pending', render: null, proxy: null, msg: '' };
    st.progs.set(key, p);
    (async () => {
      const L = layouts(), mode = spec.grid ? 'coarse' : 'fine';
      const vmod = device.createShaderModule({ code: coarseVolumeWgsl({ f16: ctx.f16, cls4 }, spec.tile) });
      try { ctx.onShader?.(vmod, { coarse: name, cls4 }); } catch { /* diagnostics only */ }
      const jobs = [device.createRenderPipelineAsync(ctx.pipeDescFor(vmod)), device.createComputePipelineAsync(computeDesc(mode === 'fine' ? L.fine : L.coarse, coarseProxyWgsl({ cls4, mode, tile: spec.tile }), { coarse: name + ' proxy', cls4 }))];
      if (spec.grid) { // the grid's build program is shared by the grid variants: made once
        if (!st.buildJob.has(cls4)) st.buildJob.set(cls4, device.createComputePipelineAsync(computeDesc(L.build, coarseBuildWgsl({ cls4 }), { coarse: 'grid build', cls4 })).then(x => { st.build.set(cls4, x); }));
        jobs.push(st.buildJob.get(cls4));
      }
      const [render, proxy] = await Promise.all(jobs);
      p.render = render; p.proxy = proxy; p.state = 'ready';
    })().catch(e => { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); stage(b, name, p.msg); });
    return p;
  };
  const makeTex = (size, format, usage, dimension) => device.createTexture({ size, format, usage, ...(dimension ? { dimension } : {}) });
  const gridFor = dimsP => {
    const g = st.grid;
    if (g && g.dims.join() === dimsP.join()) return g;
    if (g) { ctx.dropGroups(g.tex); g.tex.destroy(); }
    st.grid = { dims: dimsP, key: '', tex: makeTex(dimsP, 'rgba8uint', GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING, '3d'), uses: 0 };
    return st.grid;
  };
  const tilesFor = (cols, rows) => {
    let t = st.tiles.find(x => x.cols === cols && x.rows === rows);
    if (!t) {
      t = { cols, rows, tex: makeTex([cols, rows, 1], 'rg32float', GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING) };
      st.tiles.push(t);
      while (st.tiles.length > 4) { const old = st.tiles.shift(); ctx.dropGroups(old.tex); old.tex.destroy(); }
    }
    return t.tex;
  };
  const ensureTargets = (b, W, H) => { // the scratch targets of the breakdown (the same fields and sizes as docs/vr-wgpu.js shadowPass makes)
    const mk = () => device.createTexture({ size: [W, H, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    for (const k of ['tgt', 'tgt2']) {
      if (b[k] && b[k].w === W && b[k].h === H) continue;
      if (b[k]) { b[k].color.destroy(); b[k].depth.destroy(); }
      b[k] = { w: W, h: H, color: mk(), depth: mk() }; b[k].colorView = b[k].color.createView(); b[k].depthView = b[k].depth.createView();
    }
  };
  const readMs = (slot, name, kind) => {
    slot.buf.mapAsync(GPUMapMode.READ).then(() => {
      const a = new BigUint64Array(slot.buf.getMappedRange().slice(0)); slot.buf.unmap(); slot.busy = false;
      const ms = Number(a[1] - a[0]) / 1e6;
      if (a[0] !== 0n && a[1] >= a[0] && ms < 1000) { try { ctx.getBd()?.onShadow?.(kind + ':' + name, ms, 1); } catch { /* the page's callback */ } }
    }).catch(() => { slot.busy = false; });
  };
  // the proxy parameters of the display's low pass (its pre-pass uniform bytes, kept by the snapshot) with this variant's tile layout
  const proxyBytes = (s, spec, dimsTex, cd) => {
    const I = new Int32Array(s.pxAb), n = Math.min(2, Math.max(1, I[fld(pxLayout, 'nEyes').offset / 4]));
    const wOf = e => I[fld(pxLayout, e ? 'w1' : 'w0').offset / 4], hOf = e => I[fld(pxLayout, e ? 'h1' : 'h0').offset / 4];
    const tpe = Math.max(1, ...Array.from({ length: n }, (_, e) => Math.ceil(wOf(e) / spec.tile))), rows = Math.max(1, ...Array.from({ length: n }, (_, e) => Math.ceil(hOf(e) / spec.tile)));
    const ab = new ArrayBuffer(cpLayout.byteSize), CI = new Int32Array(ab), CF = new Float32Array(ab);
    new Uint8Array(ab).set(new Uint8Array(s.pxAb).subarray(0, pxLayout.byteSize));
    CI[fld(cpLayout, 'tilesPerEye').offset / 4] = tpe; CI[fld(cpLayout, 'tilesY').offset / 4] = rows;
    dimsTex.forEach((v, k) => { CF[fld(cpLayout, 'texDims').offset / 4 + k] = v; });
    cd.forEach((v, k) => { CI[fld(cpLayout, 'cdims').offset / 4 + k] = v; });
    return { ab, n, tpe, rows, segOn: [0, 1, 2, 3].map(k => I[fld(pxLayout, 'segOn').offset / 4 + k]), clsChan: [0, 1, 2, 3].map(k => I[fld(pxLayout, 'clsChan').offset / 4 + k]) };
  };
  const dimsOf = tex => { const d = tex?.image; return d?.width ? [d.width, d.height, d.depth] : null; };

  // one shadow pass of a variant (docs/vr-wgpu.js shadowPass hands the spec over): true = submitted; false = not now (no free timer slot, no snapshot of this frame: asked again); null = no program yet (being compiled), failed to compile or not applicable (the caller steps past it)
  const shadow = (rec, spec) => {
    const b = ctx.getBd(), s = b?.snap, v = spec.coarse;
    if (!b || !b.shadowOk || !rec || s.rec !== rec || rec.vols === 0 || !s.target || !s.eyes.length) return false;
    if (!s.px || !s.pxAb || !s.u || s.variant.events) return null; // the display's low pass did not use the pre-pass (no distance field, sections, ...): nothing to compare with
    const cls4 = !!s.variant.cls4, u = s.u, clsTex = ctx.gpuOf(u.clsTex?.value), c4Tex = cls4 ? ctx.gpuOf(u.cls4Tex?.value) : null;
    if (!clsTex || (cls4 && !c4Tex)) return null;
    const dimsTex = dimsOf(u.clsTex.value);
    if (!dimsTex || (cls4 && dimsOf(u.cls4Tex.value)?.join() !== dimsTex.join())) return null; // the build reads both textures at the same texel
    for (const [n, sp] of Object.entries(COARSE_VARIANTS)) progsOf(n, sp, cls4, b); // all of them are made at the first ask (asynchronously): the rotation of variants goes on meanwhile (null), the next round finds them ready
    const pr = progsOf(spec.name, v, cls4, b);
    if (pr.state !== 'ready' || (v.grid && !st.build.get(cls4))) return null;
    const displayPipe = ctx.displayPipe(s.variant);
    const free = b.slots.map((x, i) => (x.busy ? -1 : i)).filter(i => i >= 0);
    if (free.length < 2) return false;
    const L = layouts(), cd = coarseDims(dimsTex), pd = packedDims(dimsTex), proxy = proxyBytes(s, v, dimsTex, cd);
    const enc = device.createCommandEncoder();
    const used = []; // [slot index, name, kind] of the compute passes that are timed
    // the grid, when the shown set or the data changed (and now and then, so that its cost has samples): its own compute pass
    let gridTex = null;
    if (v.grid) {
      const g = gridFor(pd), key = [idOf(clsTex), c4Tex ? idOf(c4Tex) : 0, ctx.uploadGen(), proxy.clsChan.join(), proxy.segOn.join()].join(':');
      gridTex = g.tex; g.uses++;
      if (g.key !== key || g.uses % COARSE.rebuildEvery === 0) {
        g.key = key;
        const bb = new ArrayBuffer(buildLayout.byteSize), BI = new Int32Array(bb);
        [...dimsTex, 0].forEach((x, k) => { BI[fld(buildLayout, 'dims').offset / 4 + k] = x; }); [...cd, 0].forEach((x, k) => { BI[fld(buildLayout, 'cdims').offset / 4 + k] = x; });
        proxy.clsChan.forEach((x, k) => { BI[fld(buildLayout, 'clsChan').offset / 4 + k] = x; }); proxy.segOn.forEach((x, k) => { BI[fld(buildLayout, 'segOn').offset / 4 + k] = x; });
        st.buildBuf ||= device.createBuffer({ size: buildLayout.byteSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(st.buildBuf, 0, bb);
        const bg = device.createBindGroup({ layout: L.build, entries: [
          { binding: BUILD_BINDINGS.params, resource: { buffer: st.buildBuf } }, { binding: BUILD_BINDINGS.cls, resource: clsTex.createView({ dimension: '3d' }) },
          { binding: BUILD_BINDINGS.cls4, resource: (c4Tex || ctx.dummy('f')).createView({ dimension: '3d' }) }, { binding: BUILD_BINDINGS.out, resource: g.tex.createView({ dimension: '3d' }) },
        ] });
        const sl = free.length > 2 ? free.pop() : -1;
        const cp = enc.beginComputePass(sl >= 0 ? { timestampWrites: { querySet: b.qs, beginningOfPassWriteIndex: 2 * sl, endOfPassWriteIndex: 2 * sl + 1 } } : {});
        cp.setPipeline(st.build.get(cls4)); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(Math.ceil(pd[0] / 4), Math.ceil(pd[1] / 4), Math.ceil(pd[2] / 4)); cp.end();
        if (sl >= 0) used.push([sl, spec.name, 'proxyBuild']);
      }
    }
    // the tiles
    const tilesTex = tilesFor(proxy.tpe * proxy.n, proxy.rows);
    st.cpBuf ||= device.createBuffer({ size: cpLayout.byteSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(st.cpBuf, 0, proxy.ab);
    const cpGroup = v.grid
      ? device.createBindGroup({ layout: L.coarse, entries: [{ binding: COARSE_BINDINGS.params, resource: { buffer: st.cpBuf } }, { binding: COARSE_BINDINGS.grid, resource: gridTex.createView({ dimension: '3d' }) }, { binding: COARSE_BINDINGS.out, resource: tilesTex.createView() }] })
      : device.createBindGroup({ layout: L.fine, entries: [{ binding: FINE_BINDINGS.params, resource: { buffer: st.cpBuf } }, { binding: FINE_BINDINGS.cls, resource: clsTex.createView({ dimension: '3d' }) },
        { binding: FINE_BINDINGS.cls4, resource: (c4Tex || ctx.dummy('f')).createView({ dimension: '3d' }) }, { binding: FINE_BINDINGS.sampler, resource: ctx.linear }, { binding: FINE_BINDINGS.out, resource: tilesTex.createView() }] });
    const sc = free.pop(), sv = free.pop();
    const cpass = enc.beginComputePass({ timestampWrites: { querySet: b.qs, beginningOfPassWriteIndex: 2 * sc, endOfPassWriteIndex: 2 * sc + 1 } });
    cpass.setPipeline(pr.proxy); cpass.setBindGroup(0, cpGroup); cpass.dispatchWorkgroups(Math.ceil(proxy.tpe * proxy.n / 8), Math.ceil(proxy.rows / 8)); cpass.end();
    used.push([sc, spec.name, 'proxyMs']);
    // the volume pass of the variant into scratch targets of the low target's size
    const W = s.target.w, H = s.target.h;
    ensureTargets(b, W, H);
    const org = volField('proxyOrg').offset / 4;
    const pass = enc.beginRenderPass({ timestampWrites: { querySet: b.qs, beginningOfPassWriteIndex: 2 * sv, endOfPassWriteIndex: 2 * sv + 1 }, colorAttachments: [
      { view: b.tgt.colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: b.tgt.depthView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    ] });
    pass.setPipeline(pr.render); pass.setVertexBuffer(0, ctx.boxBuf);
    s.eyes.forEach((e, i) => {
      b.tmp.set(s.ab[i]); b.tmp[org] = e.vx - v.tile * i * proxy.tpe; b.tmp[org + 1] = 0; // pixel of the target - proxyOrg = (pixel in the eye's region) + the eye's tile columns, over the tile size
      device.queue.writeBuffer(ctx.ubufOf(4 + i), 0, b.tmp);
      pass.setBindGroup(0, ctx.bindGroup(4 + i, u, tilesTex));
      pass.setViewport(e.vx, e.vy, e.vw, e.vh, 0, 1);
      for (const sc2 of e.scissors) { pass.setScissorRect(sc2[0], sc2[1], sc2[2], sc2[3]); pass.draw(36); }
    });
    pass.end();
    enc.resolveQuerySet(b.qs, 2 * sv, 2, b.resolve, 256 * sv); enc.copyBufferToBuffer(b.resolve, 256 * sv, b.slots[sv].buf, 0, 16); b.slots[sv].busy = true;
    for (const [sl] of used) { enc.resolveQuerySet(b.qs, 2 * sl, 2, b.resolve, 256 * sl); enc.copyBufferToBuffer(b.resolve, 256 * sl, b.slots[sl].buf, 0, 16); b.slots[sl].busy = true; }
    // the comparison with the display: its own low pass drawn again with its own tiles (the snapshot's 'on' bind groups) into the second target, then the pixels that differ are counted (not timed)
    const d = b.diff, wantsDiff = !!d && !d.busy && !!displayPipe && s.bgOn.every(x => !!x);
    let diffTotal = 0;
    if (wantsDiff) {
      const on = enc.beginRenderPass({ colorAttachments: [
        { view: b.tgt2.colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        { view: b.tgt2.depthView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      ] });
      on.setPipeline(displayPipe); on.setVertexBuffer(0, ctx.boxBuf);
      s.eyes.forEach((e, i) => {
        device.queue.writeBuffer(ctx.ubufOf(7 + i), 0, s.ab[i]);
        on.setBindGroup(0, s.bgOn[i]); on.setViewport(e.vx, e.vy, e.vw, e.vh, 0, 1); diffTotal += e.vw * e.vh;
        for (const sc2 of e.scissors) { on.setScissorRect(sc2[0], sc2[1], sc2[2], sc2[3]); on.draw(36); }
      });
      on.end();
      if (!d.group || d.gA !== b.tgt || d.gB !== b.tgt2) {
        d.gA = b.tgt; d.gB = b.tgt2;
        d.group = device.createBindGroup({ layout: d.bgl, entries: [
          { binding: PROXY_DIFF_BINDINGS.colorA, resource: b.tgt.color.createView() }, { binding: PROXY_DIFF_BINDINGS.depthA, resource: b.tgt.depth.createView() },
          { binding: PROXY_DIFF_BINDINGS.colorB, resource: b.tgt2.color.createView() }, { binding: PROXY_DIFF_BINDINGS.depthB, resource: b.tgt2.depth.createView() },
          { binding: PROXY_DIFF_BINDINGS.count, resource: { buffer: d.cnt } },
        ] });
      }
      enc.clearBuffer(d.cnt);
      let cw = 1, ch = 1; for (const e of s.eyes) { cw = Math.max(cw, e.vx + e.vw); ch = Math.max(ch, e.vy + e.vh); }
      const cp = enc.beginComputePass(); cp.setPipeline(d.pipe); cp.setBindGroup(0, d.group); cp.dispatchWorkgroups(Math.ceil(Math.min(W, cw) / 8), Math.ceil(Math.min(H, ch) / 8)); cp.end();
      enc.copyBufferToBuffer(d.cnt, 0, d.rb, 0, 4);
      d.busy = true;
    }
    device.queue.submit([enc.finish()]);
    if (wantsDiff) d.rb.mapAsync(GPUMapMode.READ).then(() => { const n = new Uint32Array(d.rb.getMappedRange().slice(0))[0]; d.rb.unmap(); d.busy = false; try { b.onShadow?.('diff:' + spec.name, n, diffTotal); } catch { /* the page's callback */ } }).catch(() => { d.busy = false; });
    for (const [sl, name, kind] of used) readMs(b.slots[sl], name, kind);
    ctx.pair(rec, spec.name, b.slots[sv]);
    return true;
  };
  const end = () => {
    const kill = x => { try { x?.destroy(); } catch { /* gone */ } };
    if (st.grid) { ctx.dropGroups(st.grid.tex); kill(st.grid.tex); }
    for (const t of st.tiles) { ctx.dropGroups(t.tex); kill(t.tex); }
    kill(st.cpBuf); kill(st.buildBuf);
    st.grid = null; st.tiles = []; st.cpBuf = null; st.buildBuf = null; st.progs.clear(); st.build.clear(); st.buildJob.clear(); st.layouts = null; st.uses = 0;
  };
  return { shadow, end };
}
