// The parts' own tiles (way D of a part taken out of the body; improvement 4-1 stage 1): per 8 x 8 pixel tile of the centre pass, one cone marched through the part's partOcc (the 8^3 blocks of its field) as a compute pass before the volume pass.
// Output (one r32float per tile, tiles of both eyes side by side, the layout and the origin of the body's pre-pass tiles: the volume text divides the fragment's position by 8): tA = the eye distance s such that every sample of every ray of the tile,
// at a distance below tA, lies in a block of partOcc that the loop's own test leaves out (ob.r < 0.5: the ray jumps past the block without a read); 3.0e38 = no ray of the tile can reach an occupied block (the volume text then runs no loop for it).
// The volume text is the display's own distSplit program: its proxyOn branch (docs/vr-wgsl-core.js, the PX block) starts a ray one grid point before the one tA falls on and runs no loop when tA lies past the ray's end. Nothing but the start moves:
// every iteration that is left out is one the loop would have ended with a jump (the jump's state is rewritten whole: previousT, prevF, prevHid, prevValid, lastIndex, prevSkip), and the start is always a grid point inside a block that is left out, so the
// first jump from it lands on the grid point the jumps from k = 0 land on (tests/unit/vr-wgpu-part-tile.test.js).
// The cone is the build-754 pre-pass' (docs/vr-wgsl-core.js PROXY): its axis a = the mean of the four corner pixel centres' directions, its chord coefficient c = the largest |corner direction - a| + epsTheta. A ray of the tile is at most c * s from the axis point
// o + s a at the same distance s, and in the field's texel space (a linear map of the object space: the fragment's pfA + pfV * t) at most c * s * |K| per axis from it. The blocks the loop reads are floor, clamp to the field, >> 3, min(occupancy size - 1)
// (a sample outside the field is read in the edge block), all monotone: the blocks between the clamped floors of the low and the high end of a box hold every block any point of the box is read in.
// A step of the axis point moves at most stepTexels texels along its widest axis; the box of a step covers the axis' points of [s, s + h] grown by the cone's radius at s + h and marginTexel; one occupied block in it stops the march (tA = s, the step's start).
// Constants shared by the shader text and by the CPU twin below.
import { uniformLayout, uniformStruct, PROXY } from './vr-wgsl-core.js?v=20261126-build767';

export const PART_TILE = { tile: PROXY.tile, epsTheta: PROXY.epsTheta, slack: 2.0e-4, marginTexel: 0.05, stepTexels: 8, maxIt: 256, empty: PROXY.empty };
// per job (one part of the frame): both eyes' inverse region matrices and origins, the region sizes in px, the volume's box and the part's content box, the field's map (the volume's texture coordinates -> the field's texels) and size,
// the tile layout of the pass (tilesPerEye columns per eye, tilesY rows) and, per eye, the tiles to make: [x0, y0, x1, y1) of its own tile grid (the tiles under the part's scissor rects)
export const PART_TILE_FIELDS = [
  ['inv0', 'mat4x4f'], ['inv1', 'mat4x4f'],
  ['org0', 'vec3f'], ['w0', 'i32'], ['org1', 'vec3f'], ['w1', 'i32'],
  ['halfExt', 'vec3f'], ['nEyes', 'i32'],
  ['boxC', 'vec3f'], ['h0', 'i32'], ['boxH', 'vec3f'], ['h1', 'i32'],
  ['fieldScale', 'vec3f'], ['tilesPerEye', 'i32'], ['fieldOff', 'vec3f'], ['tilesY', 'i32'],
  ['fieldDims', 'vec3f'], ['pad0', 'i32'],
  ['rect0', 'vec4i'], ['rect1', 'vec4i'],
];
export const PART_TILE_BINDINGS = { params: 0, occ: 1, out: 2 };
export const partTileLayout = () => uniformLayout(PART_TILE_FIELDS);

export function partTileWgsl() {
  const C = PART_TILE, F = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));
  return `// VR / AR parts' pre-pass (WGSL): one cone per ${C.tile} x ${C.tile} pixel tile through the part's partOcc (see docs/vr-wgpu-part-tile.js)
${uniformStruct(PART_TILE_FIELDS)}
@group(0) @binding(0) var<uniform> p:U;
@group(0) @binding(1) var occ:texture_3d<f32>;
@group(0) @binding(2) var tilesOut:texture_storage_2d<r32float,write>;
fn eyeOrg(e:i32)->vec3<f32>{if(e==1){return p.org1;}return p.org0;}
fn dirAt(e:i32,px:f32,py:f32,w:f32,h:f32)->vec3<f32>{
 let nx=(px+0.5)/w*2.0-1.0;let ny=1.0-(py+0.5)/h*2.0;
 var m=p.inv0;if(e==1){m=p.inv1;}
 let c=m*vec4<f32>(nx,ny,0.5,1.0);
 return normalize(c.xyz/c.w-eyeOrg(e));
}
fn safeDir(d:vec3<f32>)->vec3<f32>{return select(d,vec3<f32>(1.0e-20),abs(d)<vec3<f32>(1.0e-20));}
fn cone(e:i32,lx:i32,ty:i32,w:i32,h:i32)->f32{
 let x0=f32(lx*${C.tile});let y0=f32(ty*${C.tile});let x1=f32(min(w,lx*${C.tile}+${C.tile})-1);let y1=f32(min(h,ty*${C.tile}+${C.tile})-1);
 let fw=f32(w);let fh=f32(h);
 let d00=dirAt(e,x0,y0,fw,fh);let d10=dirAt(e,x1,y0,fw,fh);let d01=dirAt(e,x0,y1,fw,fh);let d11=dirAt(e,x1,y1,fw,fh);
 let o=eyeOrg(e);let a=normalize(d00+d10+d01+d11);
 let ch=max(max(length(d00-a),length(d10-a)),max(length(d01-a),length(d11-a)))+${F(C.epsTheta)};
 let he=p.halfExt;let far=length(o)+length(he);
 // the samples lie inside the volume's box and the part's content box: the axis point is further than c * far from that box (every ray of the tile is within c * s of the axis at distance s <= far) before the first sample of any ray
 let lo=max(p.boxC-p.boxH,-he);let hi=min(p.boxC+p.boxH,he);
 if(any(lo>hi)){return ${C.empty.toExponential(1)};}
 let ex=vec3<f32>(ch*far+${F(C.slack)}*length(he));
 let inv=1.0/safeDir(a);let t1=(lo-ex-o)*inv;let t2=(hi+ex-o)*inv;
 let tmn=min(t1,t2);let tmx=max(t1,t2);
 var s=max(0.0,max(tmn.x,max(tmn.y,tmn.z)));let sEnd=min(far,min(tmx.x,min(tmx.y,tmx.z)));
 if(s>sEnd){return ${C.empty.toExponential(1)};}
 // the fragment's map: tcO = texCoord(o), pfA = (tcO * scale + off) * dims - 0.5, pfV = tcD * scale * dims (tcD = (dir.x, -dir.y, dir.z) / (2 halfExt))
 let gInv=0.5/he;let tcO=vec3<f32>(o.x*gInv.x+0.5,0.5-o.y*gInv.y,o.z*gInv.z+0.5);
 let pfD=p.fieldDims;let pfA=(tcO*p.fieldScale+p.fieldOff)*pfD-vec3<f32>(0.5);
 let K=vec3<f32>(gInv.x,-gInv.y,gInv.z)*p.fieldScale*pfD;
 let V=a*K;let rK=abs(K)*ch;
 let vmax=max(max(abs(V.x),abs(V.y)),max(abs(V.z),1.0e-6));let hs=${F(C.stepTexels)}/vmax;
 let fd=vec3<i32>(pfD);let od=vec3<i32>(textureDimensions(occ));
 for(var it=0;it<${C.maxIt};it++){
  if(s>sEnd){return ${C.empty.toExponential(1)};}
  let s1=s+hs;
  let c0=pfA+V*s;let c1=pfA+V*s1;let R=rK*s1+vec3<f32>(${F(C.marginTexel)});
  let bl=min(clamp(vec3<i32>(floor(min(c0,c1)-R)),vec3<i32>(0),fd-vec3<i32>(1))>>vec3<u32>(3u),od-vec3<i32>(1));
  let bh=min(clamp(vec3<i32>(floor(max(c0,c1)+R)),vec3<i32>(0),fd-vec3<i32>(1))>>vec3<u32>(3u),od-vec3<i32>(1));
  for(var z=bl.z;z<=bh.z;z++){for(var y=bl.y;y<=bh.y;y++){for(var x=bl.x;x<=bh.x;x++){
   if(!(textureLoad(occ,vec3<i32>(x,y,z),0).r<0.5)){return s;}
  }}}
  s=s1;
 }
 return s;
}
@compute @workgroup_size(${C.tile},${C.tile},1) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let e=i32(g.z);
 if(e>=p.nEyes){return;}
 var r=p.rect0;if(e==1){r=p.rect1;}
 let lx=r.x+i32(g.x);let ty=r.y+i32(g.y);
 if(lx>=r.z||ty>=r.w){return;}
 var w=p.w0;var h=p.h0;if(e==1){w=p.w1;h=p.h1;}
 var res=0.0;
 if(lx*${C.tile}<w&&ty*${C.tile}<h){res=cone(e,lx,ty,w,h);}
 textureStore(tilesOut,vec2<i32>(e*p.tilesPerEye+lx,ty),vec4<f32>(res,0.0,0.0,0.0));
}
`;
}

// ---- the CPU twin of cone() (tests/unit/vr-wgpu-part-tile.test.js): the same maths in double precision; the shader's f32 differences are inside epsTheta, slack and marginTexel ----
// P = { halfExt, boxC, boxH, fieldScale, fieldOff, fieldDims, occ: { dims: [x, y, z], r: (bx, by, bz) => number } }, o = the eye in object space, corners = the four corner pixel centres' directions (unit, object space)
export function partTileCpu(P, o, corners) {
  const C = PART_TILE, sum = [0, 0, 0];
  for (const d of corners) for (let i = 0; i < 3; i++) sum[i] += d[i];
  const nl = Math.hypot(...sum), a = sum.map(x => x / nl);
  const ch = Math.max(...corners.map(d => Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]))) + C.epsTheta;
  const he = P.halfExt, far = Math.hypot(...o) + Math.hypot(...he), len = Math.hypot(...he);
  const lo = [0, 1, 2].map(i => Math.max(P.boxC[i] - P.boxH[i], -he[i])), hi = [0, 1, 2].map(i => Math.min(P.boxC[i] + P.boxH[i], he[i]));
  if ([0, 1, 2].some(i => lo[i] > hi[i])) return C.empty;
  const ex = ch * far + C.slack * len, sd = x => (Math.abs(x) < 1e-20 ? 1e-20 : x);
  let sIn = 0, sEnd = far;
  for (let i = 0; i < 3; i++) { const iv = 1 / sd(a[i]), t1 = (lo[i] - ex - o[i]) * iv, t2 = (hi[i] + ex - o[i]) * iv; sIn = Math.max(sIn, Math.min(t1, t2)); sEnd = Math.min(sEnd, Math.max(t1, t2)); }
  if (sIn > sEnd) return C.empty;
  const gInv = he.map(x => 0.5 / x), tcO = [o[0] * gInv[0] + 0.5, 0.5 - o[1] * gInv[1], o[2] * gInv[2] + 0.5];
  const pfD = P.fieldDims, pfA = [0, 1, 2].map(i => (tcO[i] * P.fieldScale[i] + P.fieldOff[i]) * pfD[i] - 0.5);
  const K = [gInv[0] * P.fieldScale[0] * pfD[0], -gInv[1] * P.fieldScale[1] * pfD[1], gInv[2] * P.fieldScale[2] * pfD[2]];
  const V = [0, 1, 2].map(i => a[i] * K[i]), rK = K.map(x => Math.abs(x) * ch);
  const vmax = Math.max(Math.abs(V[0]), Math.abs(V[1]), Math.abs(V[2]), 1e-6), hs = C.stepTexels / vmax, od = P.occ.dims;
  const blk = (x, i) => Math.min(Math.min(Math.max(Math.floor(x), 0), pfD[i] - 1) >> 3, od[i] - 1); // the fragment's: clamp(floor, 0, dims - 1) >> 3, min(occupancy size - 1)
  let s = sIn;
  for (let it = 0; it < C.maxIt; it++) {
    if (s > sEnd) return C.empty;
    const s1 = s + hs, c0 = [0, 1, 2].map(i => pfA[i] + V[i] * s), c1 = [0, 1, 2].map(i => pfA[i] + V[i] * s1), R = rK.map(x => x * s1 + C.marginTexel);
    const bl = [0, 1, 2].map(i => blk(Math.min(c0[i], c1[i]) - R[i], i)), bh = [0, 1, 2].map(i => blk(Math.max(c0[i], c1[i]) + R[i], i));
    for (let z = bl[2]; z <= bh[2]; z++) for (let y = bl[1]; y <= bh[1]; y++) for (let x = bl[0]; x <= bh[0]; x++) if (!(P.occ.r(x, y, z) < 0.5)) return s;
    s = s1;
  }
  return s;
}

// ---- the host: the program, the uniform slots, the bind groups; one compute pass with one dispatch per part (docs/vr-wgpu.js drawVolumesInner) ----
// ctx = { device, THREE (the Matrix4), onShader(module, info) }. A part is a job { u (the part's uniforms: halfExt, boxC, boxH, partFieldScale, partFieldOff), eyes (the pass's eyes seen from the part: mvp, origin, w / h or vw / vh, vx, scissors), info ({ tilesPerEye, tilesY }),
// occ, field, out (GPU textures: its blocks, its field, its tiles' r32float texture) }
export function createPartTiles(ctx) {
  const { device } = ctx, C = PART_TILE, lay = partTileLayout(), STRIDE = Math.ceil(lay.byteSize / 256) * 256; // (the uniform slots of the jobs: dynamic offsets, a multiple of 256)
  const st = { pipe: null, state: 'none', msg: '', bgl: null, pl: null, ubuf: null, cap: 0, groups: new Map(), ids: new WeakMap(), seq: 0, inv: [new ctx.THREE.Matrix4(), new ctx.THREE.Matrix4()], passes: 0, jobs: 0, tiles: 0 };
  const idOf = o => { let i = st.ids.get(o); if (!i) st.ids.set(o, i = ++st.seq); return i; };
  const layouts = () => {
    st.bgl ||= device.createBindGroupLayout({ entries: [
      { binding: PART_TILE_BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: lay.byteSize } },
      { binding: PART_TILE_BINDINGS.occ, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: PART_TILE_BINDINGS.out, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float', viewDimension: '2d' } },
    ] });
    st.pl ||= device.createPipelineLayout({ bindGroupLayouts: [st.bgl] });
    return st;
  };
  const desc = () => {
    const module = device.createShaderModule({ code: partTileWgsl() });
    try { ctx.onShader?.(module, { partTile: true }); } catch { /* diagnostics only */ }
    return { layout: layouts().pl, compute: { module, entryPoint: 'main' } };
  };
  // made ahead through the gate (docs/vr-wgpu.js warmWays), or on the first part frame that finds it missing (the data set said nothing of parts at the start): one compile at a time, whoever asks gets the same promise.
  // A frame that finds it not ready has no way for the part (it never draws the part the old way: it comes right once the program is there)
  const warm = () => {
    if (st.pipe) return Promise.resolve(true);
    if (st.state === 'failed') return Promise.resolve(false);
    return st.p ||= (async () => {
      st.state = 'pending';
      try { st.pipe = await device.createComputePipelineAsync(desc()); st.state = 'ready'; return true; } catch (e) { st.state = 'failed'; st.msg = String(e?.message ?? e).slice(0, 160); return false; } finally { st.p = null; }
    })();
  };
  const dimsOf = t => [t.width ?? t.desc?.size?.[0] ?? 1, t.height ?? t.desc?.size?.[1] ?? 1, t.depthOrArrayLayers ?? t.desc?.size?.[2] ?? 1];
  const v3 = (v, d = 0) => [v?.x ?? v?.[0] ?? d, v?.y ?? v?.[1] ?? d, v?.z ?? v?.[2] ?? d];
  // the tiles under a pass's scissor rects of one eye: [x0, y0, x1, y1) of the eye's tile grid, clipped to the grid ([0, 0, 0, 0] = none)
  const tileRect = (e, tilesPerEye, tilesY) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const c of e.scissors || [[e.x, e.y, e.w, e.h]]) { if (!(c[2] > 0 && c[3] > 0)) continue; const lx = c[0] - (e.vx ?? e.x), ly = c[1]; x0 = Math.min(x0, Math.floor(lx / C.tile)); y0 = Math.min(y0, Math.floor(ly / C.tile)); x1 = Math.max(x1, Math.ceil((lx + c[2]) / C.tile)); y1 = Math.max(y1, Math.ceil((ly + c[3]) / C.tile)); }
    if (x1 < 0) return [0, 0, 0, 0];
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(tilesPerEye, x1); y1 = Math.min(tilesY, y1);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [0, 0, 0, 0];
  };
  // false: a matrix that cannot be inverted (the caller's chooseWay has checked: matrixOk)
  const fill = (f, i32, base, j) => {
    const { u, eyes, info, field, occ } = j, n = Math.min(2, eyes.length);
    for (let k = 0; k < n; k++) { const m = eyes[k].mvp, d = m.determinant(); if (!Number.isFinite(d) || Math.abs(d) < 1e-30) return null; st.inv[k].copy(m).invert(); if (!st.inv[k].elements.every(Number.isFinite)) return null; }
    const e0 = eyes[0], e1 = eyes[n - 1], W = e => e.vw ?? e.w, H = e => e.vh ?? e.h, r0 = tileRect(e0, info.tilesPerEye, info.tilesY), r1 = n > 1 ? tileRect(e1, info.tilesPerEye, info.tilesY) : [0, 0, 0, 0];
    const ex = { inv0: st.inv[0], inv1: st.inv[n - 1], org0: v3(e0.origin), w0: W(e0), h0: H(e0), org1: v3(e1.origin), w1: n > 1 ? W(e1) : 0, h1: n > 1 ? H(e1) : 0, nEyes: n,
      halfExt: v3(u.halfExt?.value, 1), boxC: v3(u.boxC?.value), boxH: v3(u.boxH?.value), fieldScale: v3(u.partFieldScale?.value, 1), tilesPerEye: info.tilesPerEye, fieldOff: v3(u.partFieldOff?.value), tilesY: info.tilesY, fieldDims: dimsOf(field), rect0: r0, rect1: r1 };
    for (const fd of lay.fields) {
      const v = ex[fd.name]; if (v === undefined) continue;
      const at = (base + fd.offset) / 4, A = fd.k === 'f' ? f : i32;
      if (fd.n === 1) A[at] = +v; else if (fd.n === 16) { const m = v.elements || v; for (let i = 0; i < 16; i++) A[at + i] = m[i]; } else for (let i = 0; i < fd.n; i++) A[at + i] = v[i] ?? 0;
    }
    return { n, r0, r1, occ };
  };
  // one compute pass for the jobs (each its own uniform slot, bind group and dispatch over the tiles under its scissor rects); tsw = timestampWrites of the pass or null. Returns the number of jobs encoded, or -1 when the program is not ready
  // (nothing is encoded then); a job whose matrix cannot be inverted is not encoded and its index is in `missing`
  const encode = (enc, jobs, tsw = null, missing = []) => {
    if (!st.pipe) return -1;
    if (!jobs.length) return 0;
    if (st.cap < jobs.length) { st.ubuf?.destroy(); st.cap = Math.max(8, jobs.length); st.ubuf = device.createBuffer({ size: st.cap * STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); st.groups.clear(); }
    const ab = new ArrayBuffer(jobs.length * STRIDE), f = new Float32Array(ab), i32 = new Int32Array(ab), todo = [];
    jobs.forEach((j, i) => { const r = fill(f, i32, i * STRIDE, j); if (!r) { missing.push(i); return; } todo.push({ j, i, r }); });
    if (!todo.length) return 0;
    device.queue.writeBuffer(st.ubuf, 0, ab);
    if (st.groups.size > 64) st.groups.clear();
    const pass = enc.beginComputePass(tsw ? { timestampWrites: tsw } : {});
    pass.setPipeline(st.pipe);
    for (const { j, i, r } of todo) {
      const key = idOf(st.ubuf) + '.' + idOf(j.occ) + '.' + idOf(j.out);
      let g = st.groups.get(key);
      if (!g) st.groups.set(key, g = device.createBindGroup({ layout: layouts().bgl, entries: [
        { binding: PART_TILE_BINDINGS.params, resource: { buffer: st.ubuf, offset: 0, size: lay.byteSize } },
        { binding: PART_TILE_BINDINGS.occ, resource: j.occ.createView({ dimension: '3d' }) },
        { binding: PART_TILE_BINDINGS.out, resource: j.out.createView() }] }));
      const nx = Math.max(r.r0[2] - r.r0[0], r.r1[2] - r.r1[0]), ny = Math.max(r.r0[3] - r.r0[1], r.r1[3] - r.r1[1]);
      if (nx <= 0 || ny <= 0) continue;
      pass.setBindGroup(0, g, [i * STRIDE]);
      pass.dispatchWorkgroups(Math.ceil(nx / C.tile), Math.ceil(ny / C.tile), r.n);
      st.tiles += (Math.max(0, r.r0[2] - r.r0[0]) * Math.max(0, r.r0[3] - r.r0[1])) + (r.n > 1 ? Math.max(0, r.r1[2] - r.r1[0]) * Math.max(0, r.r1[3] - r.r1[1]) : 0);
    }
    pass.end();
    st.passes++; st.jobs += todo.length;
    return todo.length;
  };
  const destroy = () => { try { st.ubuf?.destroy(); } catch { /* gone */ } st.ubuf = null; st.cap = 0; st.groups.clear(); };
  return { warm, encode, destroy, get state() { return st.state; }, get ready() { return !!st.pipe; }, get msg() { return st.msg; }, stats: () => ({ state: st.state, passes: st.passes, jobs: st.jobs, tiles: st.tiles }), STRIDE };
}
