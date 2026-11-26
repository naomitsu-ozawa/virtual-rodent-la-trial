// The HU marks of the general loop's S / EvS for the classification-off diagnostic (the data's own value drawn: src 'hu' of docs/vr-wgsl-general.js; plan chapter 5-2).
//
// The display reads the data (the HU grid the app draws from: the thin-structure copy in the diagnostic) at every sample of every ray, and most of the reads find a point outside every shown segment. A grid of cells of 4 x 4 x 4 texels says, per cell,
// where a segment may be inside anywhere a trilinear read of the cell can reach (the footprint: the cell's own texels dilated by one texel on each side, clamped; the same footprint as the classification marks, docs/vr-wgpu-marks.js):
//   - the least and the greatest raw value (the two bytes of a texel, q.x + 256 q.y, the program's own sum) of the footprint. The program's HU is the linear sampler's read of the two bytes (a convex combination of footprint values, so within [min, max])
//     taken through the calibration (linear: (raw - z) * slope + intercept), so a cell's HU lies between the calibrated ends; the program widens the raw range by one unit (the sampler's rounding) and keeps the smaller / larger calibrated end.
//   - for each of the four slots the greatest byte of the edit texture over the footprint of the cell in the edit texture's own grid (the edit texture may have another size than the data: the footprint is that of the cell's texture-coordinate range, dilated by one texel). The
//     program's edit test is editTex[s] >= 0.5 of a linear (or nearest) read, a convex combination of footprint texels, so it can only pass when the greatest byte is not below 0.498 (a byte of 126 or more: 126 / 255 = 0.494, with the rounding margin).
// A sample is skipped when the cell has no shown slot s with (the slot does not gate on the edit mask or its edit maximum can pass) and (the slot is the processing mask alone, or the cell's HU range meets [segA.x, segA.y]): the display would read it and find idx = -1.
// One rgba16uint texel per cell: r = least raw, g = greatest raw, b = edit maxima of slots 0 | 1 << 8, a = slots 2 | 3 << 8.
import { uniformLayout, uniformStruct } from './vr-wgsl-core.js?v=20261126-build767';
import { COARSE, coarseDims } from './vr-wgpu-coarse-proxy.js?v=20261126-build767';
import { MARK_GROUP } from './vr-wgpu-marks.js?v=20261126-build767';

export const HU_FIELDS = [['dims', 'vec4i'], ['cdims', 'vec4i'], ['edims', 'vec4i']]; // dims = the data (w, h, d), cdims = the cells (x, y, z), edims = the edit texture
export const HU_BINDINGS = { params: 0, vol: 1, edit: 2, out: 3 };
export const HU_EDIT_THRESHOLD = 126; // a byte below it cannot read 0.5 or more through the sampler
const C = COARSE.cell;

export function huMarksBuildWgsl() {
  return `// VR / AR HU marks build (WGSL): per cell of ${C} x ${C} x ${C} texels the raw value range of the data and the edit maxima (see docs/vr-wgpu-humarks.js)
${uniformStruct(HU_FIELDS)}
@group(0) @binding(0) var<uniform> g:U;
@group(0) @binding(1) var vol:texture_3d<f32>;
@group(0) @binding(2) var editTex:texture_3d<f32>;
@group(0) @binding(3) var markOut:texture_storage_3d<rgba16uint,write>;
fn rawAt(p:vec3<i32>)->u32{let q=textureLoad(vol,p,0).rg*255.0;return u32(round(q.x))+256u*u32(round(q.y));}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let t=vec3<i32>(id);
 if(t.x>=g.cdims.x||t.y>=g.cdims.y||t.z>=g.cdims.z){return;}
 var lo=65535u;var hi=0u;
 for(var z=${C}*t.z-1;z<=${C}*t.z+${C};z++){
  if(z<0||z>=g.dims.z){continue;}
  for(var y=${C}*t.y-1;y<=${C}*t.y+${C};y++){
   if(y<0||y>=g.dims.y){continue;}
   for(var x=${C}*t.x-1;x<=${C}*t.x+${C};x++){
    if(x<0||x>=g.dims.x){continue;}
    let v=rawAt(vec3<i32>(x,y,z));lo=min(lo,v);hi=max(hi,v);
   }
  }
 }
 // the edit texture's texels the cell's texture-coordinate range [${C} t / dims, (${C} t + ${C}) / dims) can read: its own grid, dilated by one texel
 let e0=vec3<i32>(floor(vec3<f32>(t*${C})*vec3<f32>(g.edims.xyz)/vec3<f32>(g.dims.xyz)))-vec3<i32>(1);
 let e1=vec3<i32>(ceil(vec3<f32>(t*${C}+vec3<i32>(${C}))*vec3<f32>(g.edims.xyz)/vec3<f32>(g.dims.xyz)))+vec3<i32>(1);
 var em=vec4<u32>(0u);
 for(var z=max(e0.z,0);z<=min(e1.z,g.edims.z-1);z++){
  for(var y=max(e0.y,0);y<=min(e1.y,g.edims.y-1);y++){
   for(var x=max(e0.x,0);x<=min(e1.x,g.edims.x-1);x++){
    let q=textureLoad(editTex,vec3<i32>(x,y,z),0);
    em=max(em,vec4<u32>(vec4<f32>(round(q.x*255.0),round(q.y*255.0),round(q.z*255.0),round(q.w*255.0))));
   }
  }
 }
 textureStore(markOut,t,vec4<u32>(lo,hi,em.x|(em.y<<8u),em.z|(em.w<<8u)));
}
`;
}

// the program's side: may a segment be inside anywhere in the cell whose texel is mt (the same test as the CPU twin's huCellMay)
export const HU_MAY_WGSL = `fn huCellMay(mt:vec4<u32>)->bool{
 let h0=(f32(mt.x)-1.0-u.calib.z)*u.calib.x+u.calib.y;let h1=(f32(mt.y)+1.0-u.calib.z)*u.calib.x+u.calib.y;
 let hlo=min(h0,h1);let hhi=max(h0,h1);
 for(var s=0;s<NSEG;s++){
  let a=u.segA[s];
  if(a.w>0.5){
   var ok=true;
   if(((u.editMask>>u32(s))&1)!=0){ok=((mt[2+s/2]>>(8u*u32(s%2)))&255u)>=${HU_EDIT_THRESHOLD}u;}
   if(ok&&(((u.editMaskOnly>>u32(s))&1)==1||(hhi>=a.x&&hlo<=a.y))){return true;}
  }
 }
 return false;
}
`;

// the CPU twin of the build: vol = the data's bytes (two a texel, low byte first), edit = { data (C bytes a texel), C (1, 2 or 4 channels), dims } or null (no edit texture: a 1 x 1 x 1 texture of zeros except the missing channels' fixed values); per cell [lo, hi, em0, em1, em2, em3]
export function huMarksCpu({ vol, dims, edit = null }) {
  const [W, H, D] = dims, cd = coarseDims(dims), out = new Uint16Array(cd[0] * cd[1] * cd[2] * 6);
  const ed = edit ? edit.dims : [1, 1, 1], eC = edit ? edit.C : 4;
  const ev = (x, y, z, c) => edit ? (c < eC ? edit.data[((z * ed[1] + y) * ed[0] + x) * eC + c] : c === 3 ? 255 : 0) : (c === 3 ? 255 : 0); // (an r8 / rg8 texture reads (r, g, 0, 1))
  for (let cz = 0; cz < cd[2]; cz++) for (let cy = 0; cy < cd[1]; cy++) for (let cx = 0; cx < cd[0]; cx++) {
    let lo = 65535, hi = 0;
    for (let z = Math.max(0, cz * C - 1); z <= Math.min(D - 1, cz * C + C); z++) for (let y = Math.max(0, cy * C - 1); y <= Math.min(H - 1, cy * C + C); y++) for (let x = Math.max(0, cx * C - 1); x <= Math.min(W - 1, cx * C + C); x++) {
      const i = (z * H + y) * W + x, v = vol[i * 2] + 256 * vol[i * 2 + 1]; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    const e0 = [cx, cy, cz].map((c, k) => Math.floor(c * C * ed[k] / dims[k]) - 1), e1 = [cx, cy, cz].map((c, k) => Math.ceil((c * C + C) * ed[k] / dims[k]) + 1), em = [0, 0, 0, 0];
    for (let z = Math.max(e0[2], 0); z <= Math.min(e1[2], ed[2] - 1); z++) for (let y = Math.max(e0[1], 0); y <= Math.min(e1[1], ed[1] - 1); y++) for (let x = Math.max(e0[0], 0); x <= Math.min(e1[0], ed[0] - 1); x++) for (let c = 0; c < 4; c++) em[c] = Math.max(em[c], ev(x, y, z, c));
    const o = ((cz * cd[1] + cy) * cd[0] + cx) * 6;
    out[o] = lo; out[o + 1] = hi; out[o + 2] = em[0]; out[o + 3] = em[1]; out[o + 4] = em[2]; out[o + 5] = em[3];
  }
  return out;
}
// the CPU twin of the program's test (cell = 6 values of huMarksCpu; segA = [[lo, hi, , on], ...], calib = [slope, intercept, bias], editMask / editMaskOnly = bit masks)
export function huCellMay(cell, { segA, calib, editMask = 0, editMaskOnly = 0 }) {
  const f = Math.fround, h0 = f(f(f(f(cell[0]) - 1) - calib[2]) * calib[0]) + calib[1], h1 = f(f(f(f(cell[1]) + 1) - calib[2]) * calib[0]) + calib[1], lo = Math.min(h0, h1), hi = Math.max(h0, h1);
  for (let s = 0; s < 4; s++) {
    const a = segA[s]; if (!(a[3] > 0.5)) continue;
    let ok = true; if ((editMask >> s) & 1) ok = cell[2 + s] >= HU_EDIT_THRESHOLD;
    if (ok && (((editMaskOnly >> s) & 1) || (hi >= a[0] && lo <= a[1]))) return true;
  }
  return false;
}

// ---- the GPU side: the marks of one (data, edit texture) pair, made whole at the first use and again whenever either's bytes changed (their write numbers differ) ----
// ctx = { device, bgl (the group-1 layout of the marks' kind: a uint 3d texture), onShader, tag }
export function createHuMarkHost(ctx) {
  const { device } = ctx;
  const layout = uniformLayout(HU_FIELDS), fld = n => layout.fields.find(f => f.name === n);
  const sh = ctx.share || {}; // the compiled program and the layout are shared by the hosts of several data sources (ctx.share)
  const st = { prog: sh.prog || null, buildBgl: sh.buildBgl || null, grid: null, ubuf: null, key: '', builds: 0, group: null, dead: false };
  const buildBgl = () => st.buildBgl ||= sh.buildBgl ||= device.createBindGroupLayout({ entries: [
    { binding: HU_BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: HU_BINDINGS.vol, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: HU_BINDINGS.edit, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: HU_BINDINGS.out, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16uint', viewDimension: '3d' } },
  ] });
  const prog = () => {
    if (st.prog || sh.prog) return st.prog ||= sh.prog;
    const p = st.prog = sh.prog = { state: 'pending', pipe: null, msg: '' };
    try {
      const module = device.createShaderModule({ code: huMarksBuildWgsl() });
      try { ctx.onShader?.(module, { marks: true, hu: true }); } catch { /* diagnostics only */ }
      Promise.resolve(device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [buildBgl()] }), compute: { module, entryPoint: 'main' } })).then(pipe => { if (!st.dead || ctx.share) { p.pipe = pipe; p.state = 'ready'; } }, e => { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); });
    } catch (e) { p.state = 'failed'; p.msg = String(e?.message ?? e).slice(0, 160); }
    return p;
  };
  const gridFor = dims => {
    const cd = coarseDims(dims);
    let g = st.grid;
    if (g && g.cd.join() === cd.join()) return g;
    if (g) { g.tex.destroy(); st.group = null; }
    g = st.grid = { cd, tex: device.createTexture({ size: cd, dimension: '3d', format: 'rgba16uint', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }) };
    st.key = '';
    return g;
  };
  // F = { enc, vol: { tex (three), gen, gpu, dims }, edit: { tex, gen, gpu, dims } }: 'ready' (the marks hold exactly these versions; made whole now, in enc, when they do not), 'wait' (the build program is being compiled), 'failed'
  const prepare = F => {
    const p = prog();
    if (p.state === 'failed') return 'failed';
    if (p.state !== 'ready') return 'wait';
    const key = [F.vol.gen | 0, F.edit.gen | 0, F.vol.dims.join('x'), F.edit.dims.join('x')].join(':'), g = gridFor(F.vol.dims);
    if (st.key === key) return 'ready';
    const bb = new ArrayBuffer(layout.byteSize), BI = new Int32Array(bb);
    [...F.vol.dims, 0].forEach((x, k) => { BI[fld('dims').offset / 4 + k] = x; }); [...g.cd, 0].forEach((x, k) => { BI[fld('cdims').offset / 4 + k] = x; }); [...F.edit.dims, 0].forEach((x, k) => { BI[fld('edims').offset / 4 + k] = x; });
    st.ubuf ||= device.createBuffer({ size: layout.byteSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(st.ubuf, 0, bb);
    const bg = device.createBindGroup({ layout: buildBgl(), entries: [
      { binding: HU_BINDINGS.params, resource: { buffer: st.ubuf } }, { binding: HU_BINDINGS.vol, resource: F.vol.gpu.createView({ dimension: '3d' }) },
      { binding: HU_BINDINGS.edit, resource: F.edit.gpu.createView({ dimension: '3d' }) }, { binding: HU_BINDINGS.out, resource: g.tex.createView({ dimension: '3d' }) },
    ] });
    const own = !F.enc, e = F.enc || device.createCommandEncoder(), cp = e.beginComputePass();
    cp.setPipeline(p.pipe); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(Math.ceil(g.cd[0] / 4), Math.ceil(g.cd[1] / 4), Math.ceil(g.cd[2] / 4)); cp.end();
    if (own) device.queue.submit([e.finish()]);
    st.builds++; st.key = key; st.src = { vol: F.vol.tex, edit: F.edit.tex };
    return 'ready';
  };
  const group = () => {
    if (!st.grid) return null;
    return st.group ||= device.createBindGroup({ layout: ctx.bgl, entries: [{ binding: MARK_GROUP.tex, resource: st.grid.tex.createView({ dimension: '3d' }) }] });
  };
  const reset = () => { try { st.grid?.tex.destroy(); st.ubuf?.destroy(); } catch { /* gone */ } st.grid = null; st.ubuf = null; st.group = null; st.key = ''; st.src = null; };
  const onTexGone = tex => { if (st.src && (st.src.vol === tex || st.src.edit === tex)) reset(); };
  const destroy = () => { st.dead = true; reset(); };
  return { prog, prepare, group, reset, onTexGone, destroy, get state() { return st; }, get markTex() { return st.grid?.tex ?? null; } };
}
