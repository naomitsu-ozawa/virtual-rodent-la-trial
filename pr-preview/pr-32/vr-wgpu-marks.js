// The skip marks of the ways S, OS and EvS (the display's ways for a frame without jumps; the plan's P2) and their programs.
//
// What S does. Without jumps (jumpOn 0: diag 4, the diagnostic that takes the distance field away, data without one) the display's program reads the combined texture at EVERY sample of every ray (64 MB, trilinear), and
// most of those reads find a point outside every shown segment. A mark grid says, per cell of 4 x 4 x 4 texels, which classification channels (bit c = channel c, 0..3) may be inside anywhere a trilinear read of that cell can reach:
// the bit is set when a texel of the cell's footprint (the cell's own texels dilated by one texel on each side, clamped to the texture: the same footprint as the coarse grid, docs/vr-wgpu-coarse-proxy.js) has class channel c >= 0.5 - classMargin.
//   - A trilinear read at a point of the cell is a convex combination of footprint texels, so channel c of it is < 0.5 (the display's inside test is q[c] >= 0.5) when no footprint texel has it >= 0.5 - classMargin. The margin (0.002) is
//     the pre-pass's own and is far above the sampler's rounding.
//   - A sample is skipped when (the cell's marks & the shown channels) == 0: the display would read it, find idx = -1 (no shown segment inside), set lastIndex = -1, prevValid = true, previousT = t and step on (k++). The skip sets exactly
//     those, and prevSkip = true: when a hit follows, the hit path fetches the previous sample's value at previousT (the same read, the same point) for prevF: the contract of the display's creep skip (vr-skip-occupancy.js), which this is
//     the same shape of. iters, k, jumpLen, hit, bracket, search and shading are the display's own: the picture, the loop count (diag 2) and the probe (diag 5) are the same.
//   - The marks do not depend on which tissues are shown (the test with the shown channels is made in the program, from the uniforms): showing or hiding a tissue needs no rebuild.
//   - Channel 3 is the fourth class texture's byte (cls4) when there is one, else the texture's alpha; in a combined texture that alpha is the distance and no shown segment has channel 3 (the bit is set and never read), in a classification-only texture of a four-segment data set it is the fourth class.
// OS = S on the 4 x 4 pre-pass tiles' walk (the start and the end of the ray are moved by tA / tB: nothing before tA and after tB can be inside) with the loop's own limit kept: the display's loop ends after 4096 iterations from the grid
// point 0; a walk that starts at k0 > 0 ends at k = 4096, so a ray the limit would have ended ends at the same sample.
import { uniformLayout, uniformStruct, PROXY, volumeWgsl } from './vr-wgsl-core.js?v=20261125-build762';
import { coarseVolumeWgsl, COARSE, coarseDims, packedDims } from './vr-wgpu-coarse-proxy.js?v=20261125-build762';

export const MARK_FIELDS = [['dims', 'vec4i'], ['cdims', 'vec4i']]; // dims = (w, h, d, the first row of cells of this build), cdims = the cells (x, y, z)
export const MARK_BINDINGS = { params: 0, cls: 1, cls4: 2, out: 3, alpha: 4 }; // out = the channel marks, alpha = the least distance byte of the footprint (both packed four cells along x an rgba8uint texel)
export const MARK_GROUP = { group: 1, tex: 0 }; // the volume pass's group 1 for S / OS / EvS: the marks (rgba8uint, 3d: four cells along x a texel)
const F = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// the build (compute): one thread per rgba8uint texel = four cells along x; the value of a cell = the OR of the channel bits of the texels of its dilated footprint, and (second output) the least distance byte (alpha) over the same footprint.
// The tiles' pre-pass takes the cell's reach from them as D = (marks & shown channels) ? 0 : least alpha: the value of the older grid (the least over the footprint of V, V = 0 where a shown segment may be inside, else the alpha) for any shown set, so a tissue switch makes nothing again.
export function marksBuildWgsl({ cls4 = false } = {}) {
  const thr = 0.5 - PROXY.classMargin, nCh = 4; // (all four channels: with a fourth class texture channel 3 is its byte; without one it is the alpha of the texture, which is a class only in the classification-only texture of a four-segment data set (the diagnostic that takes the distance field away); in the combined texture no shown channel is 3 and the bit is never read)
  return `// VR / AR skip marks build (WGSL), cls4=${cls4}: per cell of 4 x 4 x 4 texels the channels that may be inside (see docs/vr-wgpu-marks.js)
${uniformStruct(MARK_FIELDS)}
@group(0) @binding(0) var<uniform> g:U;
@group(0) @binding(1) var clsTex:texture_3d<f32>;
@group(0) @binding(2) var cls4Tex:texture_3d<f32>;
@group(0) @binding(3) var markOut:texture_storage_3d<rgba8uint,write>;
@group(0) @binding(4) var alphaOut:texture_storage_3d<rgba8uint,write>;
fn alp(p:vec3<i32>)->u32{return min(u32(round(textureLoad(clsTex,p,0).a*255.0)),255u);}
fn vox(p:vec3<i32>)->u32{
 var q=textureLoad(clsTex,p,0);
 ${cls4 ? 'q.a=textureLoad(cls4Tex,p,0).r;' : ''}
 var m=0u;
 for(var c=0;c<${nCh};c++){if(q[c]>=${F(thr)}){m=m|(1u<<u32(c));}}
 return m;
}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let t=vec3<i32>(id)+vec3<i32>(0,0,g.dims.w);
 let px=(g.cdims.x+${COARSE.perTexel - 1})/${COARSE.perTexel};
 if(t.x>=px||t.y>=g.cdims.y||t.z>=g.cdims.z){return;}
 var m=vec4<u32>(0u);var al=vec4<u32>(255u);
 for(var z=${COARSE.cell}*t.z-1;z<=${COARSE.cell}*t.z+${COARSE.cell};z++){
  if(z<0||z>=g.dims.z){continue;}
  for(var y=${COARSE.cell}*t.y-1;y<=${COARSE.cell}*t.y+${COARSE.cell};y++){
   if(y<0||y>=g.dims.y){continue;}
   for(var xi=0;xi<${COARSE.cell * COARSE.perTexel + 2};xi++){
    let x=${COARSE.cell * COARSE.perTexel}*t.x-1+xi;
    if(x<0||x>=g.dims.x){continue;}
    let p3=vec3<i32>(x,y,z);let v=vox(p3);let d=alp(p3);
    if(xi<=5){m.x=m.x|v;al.x=min(al.x,d);}
    if(xi>=4&&xi<=9){m.y=m.y|v;al.y=min(al.y,d);}
    if(xi>=8&&xi<=13){m.z=m.z|v;al.z=min(al.z,d);}
    if(xi>=12){m.w=m.w|v;al.w=min(al.w,d);}
   }
  }
 }
 for(var j=0;j<${COARSE.perTexel};j++){if(${COARSE.perTexel}*t.x+j>=g.cdims.x){m[j]=0u;al[j]=0u;}}
 textureStore(markOut,t,m);
 textureStore(alphaOut,t,al);
}
`;
}

// ---- the programs: exact substitutions in the display text (an anchor that is not found exactly once throws) ----
const subOnce = (t, from, to) => {
  const parts = t.split(from);
  if (parts.length !== 2) throw new Error('skip marks: anchor found ' + (parts.length - 1) + ' times, expected 1: ' + from.slice(0, 70));
  return parts.join(to);
};
export const SKIP_ANCHORS = {
  decl: '@group(0) @binding(9) var proxyTex:texture_2d<f32>;\n',
  perRay: ' let skipOn=u.useSkip>0&&u.diag!=4;\n',
  sample: '  let tcS=cl(tcO+tcD*t);\n',
  loopHead: '  let t=t0+f32(k)*stp;\n  if(t>endT||acc.a>ACC_STOP){break;}\n',
};
// the skip, after the sample's coordinate and before its read. The cell is the one that contains the point (the coarse grid's own rule: v = tc * dims, cell = v / 4 clamped); a frame with jumps (jumpOn 1) never skips: its sample's read also gives the distance
export function skipSub(t, { limit = false } = {}) {
  let o = subOnce(t, SKIP_ANCHORS.decl, SKIP_ANCHORS.decl + '@group(' + MARK_GROUP.group + ') @binding(' + MARK_GROUP.tex + ') var markTex:texture_3d<u32>;\n');
  o = subOnce(o, SKIP_ANCHORS.perRay, SKIP_ANCHORS.perRay
    + ' var shownMask=0u;\n'
    + ' {for(var s=0;s<4;s++){let c=u.clsChan[s];if(c>=0&&u.segA[s].w>0.5){shownMask=shownMask|(1u<<u32(c));}}}\n'
    + ' let markDims=vec3<f32>(textureDimensions(clsTex));\n'
    + ' let markCells=vec3<i32>(ceil(markDims/' + F(COARSE.cell) + '));\n');
  o = subOnce(o, SKIP_ANCHORS.sample, SKIP_ANCHORS.sample
    + '  if(u.jumpOn==0){\n'
    + '   let mc=min(vec3<i32>(tcS*markDims)/' + COARSE.cell + ',markCells-vec3<i32>(1));\n' // (the texture's own size: the marks are made from it, not from a uniform)
    + '   let mt=textureLoad(markTex,vec3<i32>(mc.x/' + COARSE.perTexel + ',mc.y,mc.z),0);\n'
    + '   if((mt[mc.x%' + COARSE.perTexel + ']&shownMask)==0u){prevValid=true;prevSkip=true;lastIndex=-1;previousT=t;k++;continue;}\n'
    + '  }\n');
  if (limit) o = subOnce(o, SKIP_ANCHORS.loopHead, SKIP_ANCHORS.loopHead + '  if(k>=4096){break;}\n'); // OS: the display's loop ends after 4096 iterations from k = 0; a walk that starts later ends at the same sample
  return o.replace(/(\/\/ VR \/ AR volume pass \(WGSL\), variant [^\n]*)\n/, '$1 skip-marks' + (limit ? ' tile-walk' : '') + '\n');
}
// S (no section planes), EvS (with), OS (the 4 x 4 tiles' walk, no section planes)
export function skipText({ f16 = false, cls4 = false, events = false, tiles = false } = {}) {
  if (tiles && events) throw new Error('skip marks: the tiles\' walk is not made for the section-plane program');
  const base = tiles ? coarseVolumeWgsl({ f16, cls4 }, 4) : volumeWgsl({ f16, cls4, events });
  return skipSub(base, { limit: tiles });
}

// the rows of cells [a, b) whose footprint touches the texels' slices [z0, z1): the cells cz with 4 cz - 1 <= z1 - 1 and 4 cz + 4 >= z0
export const marksRowsOf = (z0, z1, dims) => { const n = coarseDims(dims)[2]; return [Math.max(0, Math.ceil((z0 - COARSE.cell) / COARSE.cell)), Math.min(n, Math.floor(z1 / COARSE.cell) + 1)]; };
// the CPU twin of the build (the unit tests tie the marks to a brute-force reading): data = the combined texture's rgba bytes (x fastest), cls4 = the fourth class texture's bytes (or null); one byte per cell, x fastest
export function marksCpu({ data, dims, cls4 = null, classMargin = PROXY.classMargin }) {
  const [W, H, D] = dims, cd = coarseDims(dims), out = new Uint8Array(cd[0] * cd[1] * cd[2]), thr = Math.fround(0.5 - classMargin), nCh = 4;
  const vox = i => { let m = 0; for (let c = 0; c < nCh; c++) { const byte = c === 3 && cls4 ? cls4[i] : data[i * 4 + c]; if (Math.fround(byte / 255) >= thr) m |= 1 << c; } return m; };
  for (let cz = 0; cz < cd[2]; cz++) for (let cy = 0; cy < cd[1]; cy++) for (let cx = 0; cx < cd[0]; cx++) {
    let m = 0;
    for (let z = Math.max(0, cz * 4 - 1); z <= Math.min(D - 1, cz * 4 + 4); z++) for (let y = Math.max(0, cy * 4 - 1); y <= Math.min(H - 1, cy * 4 + 4); y++) for (let x = Math.max(0, cx * 4 - 1); x <= Math.min(W - 1, cx * 4 + 4); x++) m |= vox((z * H + y) * W + x);
    out[(cz * cd[1] + cy) * cd[0] + cx] = m;
  }
  return out;
}

// the CPU twin of the alpha grid: the least distance byte (alpha) over each cell's dilated footprint, one byte per cell, x fastest
export function alphaGridCpu({ data, dims }) {
  const [W, H, D] = dims, cd = coarseDims(dims), out = new Uint8Array(cd[0] * cd[1] * cd[2]);
  for (let cz = 0; cz < cd[2]; cz++) for (let cy = 0; cy < cd[1]; cy++) for (let cx = 0; cx < cd[0]; cx++) {
    let m = 255;
    for (let z = Math.max(0, cz * 4 - 1); z <= Math.min(D - 1, cz * 4 + 4); z++) for (let y = Math.max(0, cy * 4 - 1); y <= Math.min(H - 1, cy * 4 + 4); y++) for (let x = Math.max(0, cx * 4 - 1); x <= Math.min(W - 1, cx * 4 + 4); x++) m = Math.min(m, data[((z * H + y) * W + x) * 4 + 3]);
    out[(cz * cd[1] + cy) * cd[0] + cx] = m;
  }
  return out;
}

// ---- the GPU side: the marks of one (combined texture, fourth class texture) pair, made whole at the first use and followed row by row when either is written ----
// ctx = { device, bgl0 (the volume pass's group-0 layout), onShader, dropGroups(gpuTexture), dummy(kind) -> a 1 x 1 x 1 stand-in texture, entryOf(three texture) -> the host's entry (gpu, gen), tag }
export function createMarkHost(ctx) {
  const { device } = ctx;
  const layout = uniformLayout(MARK_FIELDS), fld = n => layout.fields.find(f => f.name === n);
  const st = { bgl: null, pipeLayout: null, progs: new Map(), grid: null, ubuf: null, key: null, dead: false, groups: new Map(), builds: 0, bg: new Map() };
  const layouts = () => {
    if (!st.bgl) {
      st.bgl = device.createBindGroupLayout({ entries: [{ binding: MARK_GROUP.tex, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint', viewDimension: '3d' } }] });
      st.pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [ctx.bgl0, st.bgl] });
    }
    return st;
  };
  const buildBgl = () => st.buildBgl ||= device.createBindGroupLayout({ entries: [
    { binding: MARK_BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: MARK_BINDINGS.cls, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: MARK_BINDINGS.cls4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: MARK_BINDINGS.out, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8uint', viewDimension: '3d' } },
    { binding: MARK_BINDINGS.alpha, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8uint', viewDimension: '3d' } },
  ] });
  // the build program of a variant (made once, asynchronously): { state: 'pending' | 'ready' | 'failed', pipe, msg }
  const prog = cls4 => {
    const k = cls4 ? 'c4' : 'c3', have = st.progs.get(k);
    if (have) return have;
    const p = { state: 'pending', pipe: null, msg: '' };
    st.progs.set(k, p);
    try {
      const module = device.createShaderModule({ code: marksBuildWgsl({ cls4 }) });
      try { ctx.onShader?.(module, { marks: true, cls4 }); } catch { /* diagnostics only */ }
      Promise.resolve(device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [buildBgl()] }), compute: { module, entryPoint: 'main' } })).then(pipe => { if (!st.dead) { p.pipe = pipe; p.state = 'ready'; } }, e => { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); });
    } catch (e) { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); }
    return p;
  };
  const gridFor = dims => {
    const pd = packedDims(dims);
    let g = st.grid;
    if (g && g.pd.join() === pd.join()) return g;
    if (g) { ctx.dropGroups?.(g.tex); ctx.dropGroups?.(g.alpha); g.tex.destroy(); g.alpha.destroy(); st.groups.clear(); st.bg.clear(); }
    const mk3 = () => device.createTexture({ size: pd, dimension: '3d', format: 'rgba8uint', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    g = st.grid = { pd, tex: mk3(), alpha: mk3() };
    st.key = null;
    return g;
  };
  // the cells' rows [cz0, cz1) of the marks from the textures as they are on the GPU now; enc = an encoder to add the pass to (null: a submit of its own, the way a write of the texture is followed)
  const encodeRows = (enc, { clsTex, c4Tex, dims, cls4, cz0, cz1 }) => {
    const p = prog(cls4), cd = coarseDims(dims), g = gridFor(dims), pd = g.pd, n = cz1 - cz0;
    if (n <= 0) return;
    const bb = new ArrayBuffer(layout.byteSize), BI = new Int32Array(bb);
    [...dims, cz0].forEach((x, k) => { BI[fld('dims').offset / 4 + k] = x; }); [...cd, 0].forEach((x, k) => { BI[fld('cdims').offset / 4 + k] = x; });
    st.ubuf ||= device.createBuffer({ size: layout.byteSize * 1, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(st.ubuf, 0, bb);
    const bg = device.createBindGroup({ layout: buildBgl(), entries: [
      { binding: MARK_BINDINGS.params, resource: { buffer: st.ubuf } }, { binding: MARK_BINDINGS.cls, resource: clsTex.createView({ dimension: '3d' }) },
      { binding: MARK_BINDINGS.cls4, resource: c4Tex.createView({ dimension: '3d' }) }, { binding: MARK_BINDINGS.out, resource: g.tex.createView({ dimension: '3d' }) },
      { binding: MARK_BINDINGS.alpha, resource: g.alpha.createView({ dimension: '3d' }) },
    ] });
    const own = !enc, e = enc || device.createCommandEncoder(), cp = e.beginComputePass();
    cp.setPipeline(p.pipe); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(Math.ceil(pd[0] / 4), Math.ceil(pd[1] / 4), Math.ceil(n / 4)); cp.end();
    if (own) device.queue.submit([e.finish()]);
    st.builds++;
  };
  // the marks for these textures: 'ready' (they hold exactly this version: made whole now if they do not, in `enc`), 'wait' (the build program is still being compiled), 'failed'.
  // F = { clsObj, c4Obj (the three.js textures), clsTex, c4Tex (their GPUTextures), dims, cls4, clsGen, c4Gen (the entries' write numbers), enc }
  const prepare = F => {
    const p = prog(F.cls4);
    if (p.state === 'failed') return 'failed';
    if (p.state !== 'ready') return 'wait';
    const key = [F.clsGen | 0, F.cls4 ? F.c4Gen | 0 : 0, F.dims.join('x'), F.cls4 ? 4 : 3].join(':');
    gridFor(F.dims);
    if (st.key === key) { st.pair = { clsObj: F.clsObj, c4Obj: F.cls4 ? F.c4Obj : null, clsGen: F.clsGen | 0, c4Gen: F.c4Gen | 0, dims: F.dims.slice(), cls4: !!F.cls4 }; return 'ready'; }
    // made whole in one dispatch: the grid is 256 KB and the pass reads each texel of the combined texture about 20 times (a one-off at the first use of a texture; the writes that follow only redo the rows they touch)
    encodeRows(F.enc, { clsTex: F.clsTex, c4Tex: F.c4Tex, dims: F.dims, cls4: F.cls4, cz0: 0, cz1: coarseDims(F.dims)[2] });
    st.key = key; st.pair = { clsObj: F.clsObj, c4Obj: F.cls4 ? F.c4Obj : null, clsGen: F.clsGen | 0, c4Gen: F.c4Gen | 0, dims: F.dims.slice(), cls4: !!F.cls4 };
    return 'ready';
  };
  // the entry e (a combined texture's or a fourth class texture's, of the pair the marks were made for) had slices [z0, z1) just written to the GPU (the same call, the same queue): the rows of cells whose footprint touches them are made again from the GPU's bytes.
  // false = the marks are not for this entry (nothing to follow: they are made whole at the next use if the pair changes)
  const onWrite = (e, z0, z1) => {
    const pr = st.pair;
    if (!st.key || !pr || st.dead) return false;
    const ec = ctx.entryOf(pr.clsObj), e4 = pr.cls4 ? ctx.entryOf(pr.c4Obj) : null;
    if (e !== ec && e !== e4) return false;
    if (!ec || (pr.cls4 && !e4) || prog(pr.cls4).state !== 'ready' || z1 <= z0 || z0 < 0 || z1 > pr.dims[2]) return false;
    const [a, b] = marksRowsOf(z0, z1, pr.dims);
    encodeRows(null, { clsTex: ec.gpu, c4Tex: pr.cls4 ? e4.gpu : ctx.dummy('f'), dims: pr.dims, cls4: pr.cls4, cz0: a, cz1: b });
    if (e === ec) pr.clsGen = e.gen | 0; if (e === e4) pr.c4Gen = e.gen | 0;
    st.key = [pr.clsGen, pr.cls4 ? pr.c4Gen : 0, pr.dims.join('x'), pr.cls4 ? 4 : 3].join(':');
    return true;
  };
  const group = () => {
    if (!st.grid) return null;
    layouts();
    let g = st.groups.get('g');
    if (!g) { g = device.createBindGroup({ layout: st.bgl, entries: [{ binding: MARK_GROUP.tex, resource: st.grid.tex.createView({ dimension: '3d' }) }] }); st.groups.set('g', g); }
    return g;
  };
  const destroy = () => {
    st.dead = true;
    try { if (st.grid) { ctx.dropGroups?.(st.grid.tex); st.grid.tex.destroy(); st.grid.alpha.destroy(); } st.ubuf?.destroy(); } catch { /* gone */ }
    st.grid = null; st.ubuf = null; st.groups.clear(); st.progs.clear(); st.key = null;
  };
  // the textures and buffers let go, the programs and layouts kept (a rebuild after a GPU error: the next prepare makes the marks whole again from the GPU's bytes, nothing is compiled again)
  const reset = () => {
    try { if (st.grid) { ctx.dropGroups?.(st.grid.tex); ctx.dropGroups?.(st.grid.alpha); st.grid.tex.destroy(); st.grid.alpha.destroy(); } st.ubuf?.destroy(); } catch { /* gone */ }
    st.grid = null; st.ubuf = null; st.groups.clear(); st.key = null; st.pair = null;
  };
  // the entry's texture is let go of (its three.js texture was disposed): the marks made from it go with it
  const onTexGone = tex => { const pr = st.pair; if (pr && (pr.clsObj === tex || pr.c4Obj === tex)) reset(); };
  return { layouts, prog, prepare, onWrite, group, reset, onTexGone, destroy, get state() { return st; }, get alphaTex() { return st.grid?.alpha ?? null; }, get markTex() { return st.grid?.tex ?? null; } };
}
