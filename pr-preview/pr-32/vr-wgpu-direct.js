// WebGPU VR / AR, the "direct draw" trial (diagnostic setting 「直接描く（試験）」, off by default): at a render scale of 1 the middle of the volume is drawn straight into the headset's eye image,
// by the volume's own pipeline (the same WGSL march, the same pre-pass tiles), instead of into the offscreen image that the composite material then copies into the eye image. Nothing offscreen is written or read for those pixels.
//
// Where it goes in (the two candidates of the task, chosen by reading three.js r187, vendor/three.webgpu.js):
//  (a) a NodeMaterial whose fragment is the march (TSL wgslFn): not chosen. The march text needs module-scope bindings (five 3D textures, the uniform struct, two samplers, the tiles), the `enable f16` directive and private
//      variables (a wgslFn is one function: that it cannot carry them is NOT CHECKED, the wgslFn code was not read beyond its definition). Checked in the code: three.js uploads a Data3DTexture itself (vendor three.webgpu.js 33337 / 33657,
//      texture creation and upload for isData3DTexture), so a TSL texture node on the volume's Data3DTexture would put a second copy of the 256^3 rgba8 + rg8 grids beside the GPUTextures vr-wgpu.js makes from the same arrays (gpuOf).
//      This path binds the existing GPUTextures: no second copy (by construction).
//  (b) a hook on the backend (the way discardXrDepth is hooked): used. three.js draws an XR frame per eye into a GPURenderBundleEncoder (backend.draw, the array-camera branch: renderContextData.bundleEncoders[i]) and
//      finishRender then begins ONE render pass per eye and executes that eye's bundle in it. This hook records the volume's draw into that same bundle, at the moment three.js is about to draw the composite's box:
//      so it is in the eye pass that three.js begins anyway (no extra pass, which matters on a tiled GPU), at the composite's place in the draw order (the other objects, the transparent ones included, are blended as before).
//      Passes cannot be injected in finishRender instead: the volume would come before or after every draw of three.js, not at the composite's place.
// A bundle encoder has no setViewport / setScissorRect, so the pixels are limited by an integer rect tested in the fragment wrapper (directFragmentWgsl), and the same rect is cut out of the centre pass (bandRects), so the
// composite finds nothing there (the centre target is cleared: alpha 0, it discards) and draws only the band around it, where it blends with the periphery. Nothing in the composite material changes.
//
// Exactness: the composite hands the blender the centre pass' colour at 8 bit per channel and its depth at 24 bit (the packed depth, decoded as the composite does); the wrapper quantises both in the same way, so the eye image
// gets the same values. A pixel of the rect is the pixel of the centre pass at the same eye pixel (render scale 1: the centre pass' region is the eye image's pixels); the pre-pass' tiles are the centre pass' own (same texture).
import { volumeWgsl, VOLUME_BINDINGS, PROXY } from './vr-wgsl-core.js?v=20261126-build766';

export const DIRECT_MIN_PX = 16; // a rect smaller than this (either side) is not worth a path of its own: the offscreen path draws it
const intersect = (a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const nonEmpty = r => r && r.x1 - r.x0 >= DIRECT_MIN_PX && r.y1 - r.y0 >= DIRECT_MIN_PX;

// The integer rect (px of the eye image, y DOWN, x1 / y1 exclusive) that the direct path draws for one eye. region = the centre pass' region of the eye ({x0, y0, x1, y1}, the pixels it draws, at scale 1 = eye pixels);
// rect = the foveation's centre rect of the eye (y UP, [x0, y0, x1, y1] in px of the eye image, as the composite takes it) or null when there is no periphery pass (the whole region is the centre);
// band = the composite's blend band in px; H = the eye image's height. With a periphery the rect is the part of the centre rect where the composite's weight is 1 (wt = min(distance to the rect's sides) / band >= 1), taken one pixel
// further in on each side (a pixel centre is x + 0.5), so no pixel of it is blended with the periphery. Returns null when there is nothing worth drawing.
export function directRegion(region, rect, band, H) {
  if (!region || !(region.x1 > region.x0) || !(region.y1 > region.y0)) return null;
  let inner = region;
  if (rect) {
    const b = Math.max(band, 1), top = H - rect[3], bottom = H - rect[1];
    inner = { x0: Math.ceil(rect[0] + b) + 1, y0: Math.ceil(top + b) + 1, x1: Math.floor(rect[2] - b) - 1, y1: Math.floor(bottom - b) - 1 };
  }
  const d = intersect(inner, region);
  return nonEmpty(d) ? d : null;
}

// ---- the fragment wrapper of the volume's WGSL (text only) ----
// The volume's own text is kept as it is: its entry point is renamed fsMain and a new entry point `fs` is added (the way the counting variant of vr-wgsl-core.js does it). The wrapper (1) discards what lies outside the integer rect
// of @group(1) (a bundle cannot scissor), (2) runs the march, (3) quantises the colour to 8 bit (round to nearest, as writing it to an rgba8unorm target does) and discards where the quantised alpha is 0 (the composite's Discard),
// (4) writes the depth the composite writes: the 24-bit packed depth decoded with the composite's own expression. check = the variant of the verification pass: the same rect test and colour, but it writes the packed depth to a
// second colour output (a scratch image) instead of frag_depth, so a pass can be compared pixel for pixel with the volume's centre pass.
// group = the bind group index of the rect (1 for the display's own text; 2 for the new ways' texts, whose group 1 is the distance texture / the skip marks)
export function directFragmentWgsl(text, { check = false, group = 1 } = {}) {
  const from = '@fragment fn fs(in:VOut)->FOut{';
  if (text.split(from).length !== 2) throw new Error('directFragmentWgsl: the fragment entry was not found exactly once');
  const t = text.split(from).join('fn fsMain(in:VOut)->FOut{');
  const rectTest = ' let ip=vec2<i32>(floor(in.pos.xy));\n if(ip.x<dp.rect.x||ip.y<dp.rect.y||ip.x>=dp.rect.z||ip.y>=dp.rect.w){discard;return o;}\n';
  const quant = ' let fo=fsMain(in);\n let c=round(clamp(fo.color,vec4<f32>(0.0),vec4<f32>(1.0))*255.0)/255.0;\n if(c.a<=0.0){discard;return o;}\n';
  const head = '\n// the direct draw (vr-wgpu-direct.js): the volume\'s fragment inside an integer rect of the eye image\nstruct DP{rect:vec4<i32>};\n@group(' + group + ') @binding(0) var<uniform> dp:DP;\n';
  return t + head + (check
    ? '@fragment fn fs(in:VOut)->FOut{\n var o:FOut;o.color=vec4<f32>(0.0);o.depth=vec4<f32>(0.0);\n' + rectTest + quant + ' o.color=c;o.depth=fo.depth;return o;\n}\n'
    : 'struct FOutD{@location(0) color:vec4<f32>,@builtin(frag_depth) depth:f32};\n@fragment fn fs(in:VOut)->FOutD{\n var o:FOutD;o.color=vec4<f32>(0.0);o.depth=1.0;\n' + rectTest + quant
      + ' o.color=c;\n o.depth=(fo.depth.r*(255.0*65536.0)+fo.depth.g*(255.0*256.0)+fo.depth.b*255.0)/16777215.0;\n return o;\n}\n');
}

// the comparison of the check: two pairs of images (colour, packed depth), pixel (x, y) of the rect: A at (x - org.x, y - org.y) (the centre pass' region image), B at (x, y) (the eye-sized image of the direct material).
// cnt (16 u32; colour = the 8-bit values of the rgba8unorm image, depth = the packed 24-bit value r * 65536 + g * 256 + b; "covered" = alpha > 0; "both" = covered in A and in B; "differs" = the colour differs, or the pixel is covered and its packed depth differs):
// [0] colour differs  [1] covered and depth differs  [2] covered in either  [3] largest colour difference (0..255, over the 4 channels)  [4] largest depth difference (both covered)
// [5] A covers  [6] B covers  [7] both cover  [8] colour difference of exactly 1 (largest channel)  [9] both covered, depth difference 1..2  [10] both covered, depth difference >= 256
// [11] differs, within 2 px of the rect's edge  [12] both covered, A nearer (smaller depth)  [13] both covered, B nearer  [14] differs, but equal to B once A is read one pixel up / down / left / right (the neighbour clamped into the rect)
export const DIRECT_DIFF_COUNTERS = 16;
export const DIRECT_DIFF_BINDINGS = { colorA: 0, depthA: 1, colorB: 2, depthB: 3, count: 4, params: 5 };
export function directDiffWgsl() {
  return `// the direct draw's check: colour / depth differences between the centre pass' image and the direct material's image over one rect
struct P{rect:vec4<i32>,org:vec2<i32>,pad:vec2<i32>};
@group(0) @binding(0) var colA:texture_2d<f32>;
@group(0) @binding(1) var depA:texture_2d<f32>;
@group(0) @binding(2) var colB:texture_2d<f32>;
@group(0) @binding(3) var depB:texture_2d<f32>;
@group(0) @binding(4) var<storage,read_write> cnt:array<atomic<u32>>;
@group(0) @binding(5) var<uniform> pr:P;
fn q8(v:vec4<f32>)->vec4<i32>{return vec4<i32>(round(v*255.0));}
fn d24(v:vec4<f32>)->i32{let t=vec3<i32>(round(v.rgb*255.0));return t.x*65536+t.y*256+t.z;}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let p=pr.rect.xy+vec2<i32>(g.xy);
 if(p.x>=pr.rect.z||p.y>=pr.rect.w){return;}
 let a=textureLoad(colA,p-pr.org,0);let b=textureLoad(colB,p,0);
 let da=textureLoad(depA,p-pr.org,0);let db=textureLoad(depB,p,0);
 let ai=q8(a);let bi=q8(b);let cdv=abs(ai-bi);
 let cd=max(max(cdv.x,cdv.y),max(cdv.z,cdv.w));
 let covA=a.a>0.0;let covB=b.a>0.0;let cov=covA||covB;let both=covA&&covB;
 let dA=d24(da);let dB=d24(db);let dd=abs(dA-dB);
 let colDiff=any(a!=b);let depDiff=cov&&any(da.rgb!=db.rgb);
 if(cov){atomicAdd(&cnt[2],1u);if(depDiff){atomicAdd(&cnt[1],1u);}}
 if(colDiff){atomicAdd(&cnt[0],1u);}
 atomicMax(&cnt[3],u32(cd));
 if(both){atomicMax(&cnt[4],u32(dd));}
 if(covA){atomicAdd(&cnt[5],1u);}
 if(covB){atomicAdd(&cnt[6],1u);}
 if(both){atomicAdd(&cnt[7],1u);}
 if(cd==1){atomicAdd(&cnt[8],1u);}
 if(both&&dd>=1&&dd<=2){atomicAdd(&cnt[9],1u);}
 if(both&&dd>=256){atomicAdd(&cnt[10],1u);}
 if(colDiff||depDiff){
  let lo=p-pr.rect.xy;let hi=pr.rect.zw-p-vec2<i32>(1,1);
  if(min(min(lo.x,lo.y),min(hi.x,hi.y))<2){atomicAdd(&cnt[11],1u);}
  if(both&&dd>0){if(dA<dB){atomicAdd(&cnt[12],1u);}else{atomicAdd(&cnt[13],1u);}}
  var fit=false;
  for(var k=0;k<4;k=k+1){
   var o=vec2<i32>(1,0);
   if(k==1){o=vec2<i32>(-1,0);}else if(k==2){o=vec2<i32>(0,1);}else if(k==3){o=vec2<i32>(0,-1);}
   let pn=clamp(p+o,pr.rect.xy,pr.rect.zw-vec2<i32>(1,1))-pr.org;
   let a2=textureLoad(colA,pn,0);let d2=textureLoad(depA,pn,0);
   let cov2=a2.a>0.0||b.a>0.0;
   if(all(a2==b)&&(!cov2||all(d2.rgb==db.rgb))){fit=true;}
  }
  if(fit){atomicAdd(&cnt[14],1u);}
 }
}
`;
}

const vkeyOf = v => (v.cls4 ? 'c4' : 'c3') + (v.events ? 'e' : 'n') + (v.feat ? '-' + (v.feat.R ? 'R' : '') + (v.feat.C ? 'C' : '') : '');
const errText = e => String(e?.message ?? e?.error?.message ?? e).slice(0, 200);

// p.way (setFrame) = { mode, group1 (the way's bind group 1), tile (the tiles' size) } of the centre pass' way this frame, or null (the display's own program)
// h = the pieces of createVolumeGpu (vr-wgpu.js) this needs: device, THREE, layout (the volume's uniform layout), bgl (its bind group layout), f16, onShader, boxBuf, gpuOf, dummy, proxyDummyTex, linear, nearest,
// texId (the id of a GPUTexture, for the bind group cache keys), fillUniforms(u, extra) -> the packed ArrayBuffer, passExtra(u), pipeFor(variant) (the volume's own pipeline), bindGroup(index, u, pxTex) (the centre pass' bind group)
export function createDirectApi(h) {
  const { device, THREE, layout, bgl, f16, boxBuf } = h;
  const st = { asked: false, installed: false, disabled: null, seen: null, frame: null, material: null, xr: null, frameNo: 0, lastUse: -100, notify: null, text: 'not installed', onErr: null };
  const note = (k, v) => { try { st.notify?.(k, v); } catch { /* the log's callback */ } };
  const fail = why => { if (!st.disabled) { st.disabled = String(why); st.frame = null; note('direct draw', 'switched off for the session: ' + st.disabled); } };
  // the second bind group (the rect) and the pipeline layout with it: made on first use (a session that never turns the setting on makes nothing here)
  let lay = null;
  const layouts = () => lay ||= (() => { const dBgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] }); return { dBgl, pipeLayout: device.createPipelineLayout({ bindGroupLayouts: [bgl, dBgl] }) }; })();
  const BUF_U = () => GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  const mkEye = () => { const ubuf = device.createBuffer({ size: layout.byteSize, usage: BUF_U() }), dbuf = device.createBuffer({ size: 16, usage: BUF_U() }); return { ubuf, dbuf, dgroup: device.createBindGroup({ layout: layouts().dBgl, entries: [{ binding: 0, resource: { buffer: dbuf } }] }), rect: new Int32Array(4) }; };
  let eyes = null; // [eye 0, eye 1]: their own uniform buffers (not the volume's numbered slots: the breakdown lets those go and rebuilds them)
  const groups = new Map();
  // the bind group of the volume pass (the same layout and textures as the centre pass'), on this path's own uniform buffer
  const makeGroup = (tag, buf, u, pxTex) => {
    const tv = (t, kind) => (h.gpuOf(t) || h.dummy(kind));
    const tex = [tv(u.vol?.value, 'f'), tv(u.clsTex?.value, 'f'), tv(u.cls4Tex?.value, 'f'), tv(u.skipTex?.value, 'uint'), tv(u.editTex?.value, 'f'), tv(u.sliceVol?.value, 'f'), pxTex || h.proxyDummyTex()];
    const editNearest = u.editTex?.value?.minFilter === THREE.NearestFilter;
    const fb = h.featBind(u), key = tag + ':' + tex.map(t => h.texId(t)).join('.') + (editNearest ? 'n' : 'l') + '/' + fb.ids.join('.');
    let g = groups.get(key);
    if (!g) {
      if (groups.size > 24) groups.clear();
      g = device.createBindGroup({ layout: bgl, entries: [
        { binding: VOLUME_BINDINGS.uniforms, resource: { buffer: buf } },
        ...[VOLUME_BINDINGS.vol, VOLUME_BINDINGS.cls, VOLUME_BINDINGS.cls4, VOLUME_BINDINGS.skip, VOLUME_BINDINGS.edit, VOLUME_BINDINGS.slice].map((binding, i) => ({ binding, resource: tex[i].createView({ dimension: '3d' }) })),
        { binding: VOLUME_BINDINGS.sampler, resource: h.linear }, { binding: VOLUME_BINDINGS.samplerEdit, resource: editNearest ? h.nearest : h.linear },
        { binding: VOLUME_BINDINGS.proxy, resource: tex[6].createView({ dimension: '2d' }) },
        ...fb.entries,
      ] });
      groups.set(key, g);
    }
    return g;
  };

  // ---- the pipelines: one per (variant, the eye pass' colour format, depth format, sample count); made asynchronously, used when ready (until then the offscreen path draws everything) ----
  const pipes = new Map();
  const sigOf = s => s.colorFormat + '|' + s.depthFormat + '|' + s.samples;
  const moduleFor = (variant, check) => {
    const module = device.createShaderModule({ code: directFragmentWgsl(volumeWgsl({ f16, ...variant }), { check }) });
    try { h.onShader?.(module, { f16, ...variant, abl: check ? 'direct-check' : 'direct' }); } catch { /* diagnostics only */ }
    return module;
  };
  // the new ways (the display's own, docs/vr-wgpu-newpath.js): h.way = { text(mode, cls4) -> the way's WGSL, group1Layout(mode) -> the bind group layout of the way's group 1, modes(variant) -> the modes a frame of the variant may be drawn with }; the rect is @group(2) there
  const wayLays = new Map();
  const wayLayout = mode => { const g1 = h.way.group1Layout(mode); let l = wayLays.get(g1); if (!l) { l = device.createPipelineLayout({ bindGroupLayouts: [bgl, g1, layouts().dBgl] }); wayLays.set(g1, l); } return l; };
  const wayPipe = (variant, mode) => {
    const s = st.seen; if (!s || !s.colorFormat || !s.depthFormat || !h.way) return null;
    const key = 'way:' + mode + ':' + (variant.cls4 ? 'c4' : 'c3') + (variant.feat ? '-' + (variant.feat.R ? 'R' : '') + (variant.feat.C ? 'C' : '') : '') + '|' + sigOf(s);
    let e = pipes.get(key);
    if (!e) {
      e = { state: 'pending', pipe: null }; pipes.set(key, e);
      try {
        const module = device.createShaderModule({ code: directFragmentWgsl(h.way.text(mode, !!variant.cls4, variant.feat), { group: 2 }) });
        try { h.onShader?.(module, { f16, cls4: !!variant.cls4, events: !!variant.events, abl: 'direct', coarse: 'direct ' + mode }); } catch { /* diagnostics only */ }
        device.createRenderPipelineAsync({ layout: wayLayout(mode), vertex: vertex(module), fragment: { module, entryPoint: 'fs', targets: [{ format: s.colorFormat, blend: { color: ONE, alpha: ONE }, writeMask: 0xf }] },
          primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' }, depthStencil: { format: s.depthFormat, depthWriteEnabled: true, depthCompare: 'less-equal' }, multisample: { count: s.samples } })
          .then(p => { e.pipe = p; e.state = 'ready'; note('direct draw pipeline', 'compiled (' + key + ')'); }, err => { e.state = 'error'; note('direct draw pipeline', 'failed (' + key + '): ' + errText(err)); });
      } catch (err) { e.state = 'error'; note('direct draw pipeline', 'failed (' + key + '): ' + errText(err)); }
    }
    return e.state === 'ready' ? e.pipe : null;
  };
  // every way's program a frame of the variant may be drawn with is compiled (a frame that asks for the path must find the one it is drawn with: the centre pass has already left the rect out)
  const waysReady = variant => { if (!h.way) return true; let ok = true; for (const m of h.way.modes(variant)) if (!wayPipe(variant, m)) ok = false; return ok; };
  const vertex = module => ({ module, entryPoint: 'vs', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] });
  const ONE = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }; // the composite's blend (CustomBlending One / OneMinusSrcAlpha, the alpha with the same factors: three.js takes them when no alpha factors are given)
  const getPipe = variant => {
    const s = st.seen; if (!s || !s.colorFormat || !s.depthFormat) return null;
    const key = vkeyOf(variant) + '|' + sigOf(s);
    let e = pipes.get(key);
    if (!e) {
      e = { state: 'pending', pipe: null }; pipes.set(key, e);
      try {
        const module = moduleFor(variant, false);
        device.createRenderPipelineAsync({ layout: layouts().pipeLayout, vertex: vertex(module), fragment: { module, entryPoint: 'fs', targets: [{ format: s.colorFormat, blend: { color: ONE, alpha: ONE }, writeMask: 0xf }] },
          primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' }, depthStencil: { format: s.depthFormat, depthWriteEnabled: true, depthCompare: 'less-equal' }, multisample: { count: s.samples } })
          .then(p => { e.pipe = p; e.state = 'ready'; note('direct draw pipeline', 'compiled (' + vkeyOf(variant) + ', ' + sigOf(s) + ')'); }, err => { e.state = 'error'; note('direct draw pipeline', 'failed (' + vkeyOf(variant) + '): ' + errText(err)); });
      } catch (err) { e.state = 'error'; note('direct draw pipeline', 'failed (' + vkeyOf(variant) + '): ' + errText(err)); }
    }
    return e.state === 'ready' ? e.pipe : null;
  };

  // ---- the hook on the backend ----
  // what the hook learns about the eye pass the composite is drawn in (formats, viewport), once per render context object; the layered flag is read at every draw (three.js makes the bundle encoders in beginRender)
  const ctxInfo = new WeakMap();
  const observe = (backend, ro) => {
    const ctx = ro.context, data = backend.get(ctx);
    let s = ctxInfo.get(ctx);
    if (!s) {
      const u = backend.utils, vp = ctx.viewportValue;
      s = { colorFormat: u.getCurrentColorFormat(ctx), depthFormat: ctx.depth ? u.getCurrentDepthStencilFormat(ctx) : null, samples: u.getSampleCountRenderContext(ctx), view: vp ? [vp.x, vp.y, vp.width, vp.height] : null, size: [ctx.width, ctx.height], layered: false };
      ctxInfo.set(ctx, s);
      note('direct draw eye pass', 'colour ' + s.colorFormat + ', depth ' + s.depthFormat + ', samples ' + s.samples + ', viewport ' + (s.view ? s.view.join(',') : '-') + ', size ' + s.size.join('x'));
    }
    s.layered = Array.isArray(data.bundleEncoders) && Array.isArray(data.bundleSets);
    st.seen = s;
    return { s, data };
  };
  const onDraw = (backend, ro) => {
    if (ro.material !== st.material) return;
    const target = st.xr?._xrRenderTarget;
    if (!target || ro.context?.renderTarget !== target) return;
    const { s, data } = observe(backend, ro);
    const f = st.frame;
    if (!f || !f.on || st.disabled) return;
    if (ro.object?.matrixWorld !== f.model) { f.other = true; return; } // the composite drawn by an object that is not the volume's mesh: noted (afterRender: if the volume's own never came, that frame has a hole)
    f.on = false; // once per frame
    const cams = ro.camera?.cameras;
    if (!ro.camera?.isArrayCamera || !cams?.length || !s.layered) { f.miss = 'not a layered pass'; return; }
    const wy = f.way, pipe = wy ? wayPipe(f.variant, wy.mode) : getPipe(f.variant);
    if (!pipe) { f.miss = 'no pipeline'; return; }
    for (let i = 0; i < cams.length && i < 2; i++) if (f.eyes[i] && !(data.bundleEncoders[i] && data.bundleSets[i])) { f.miss = 'no bundle for eye ' + i; return; } // everything is checked before the first command is recorded
    for (let i = 0; i < cams.length && i < 2; i++) {
      const e = f.eyes[i]; if (!e) continue;
      const enc = data.bundleEncoders[i], sets = data.bundleSets[i];
      enc.setPipeline(pipe); enc.setBindGroup(0, e.group); if (wy) { enc.setBindGroup(1, wy.group1); enc.setBindGroup(2, e.dgroup); } else enc.setBindGroup(1, e.dgroup); enc.setVertexBuffer(0, boxBuf); enc.draw(36);
      sets.pipeline = null; sets.index = null; sets.attributes = {}; sets.bindingGroups.length = 0; // three.js' state cache of this encoder no longer holds: its next draw sets everything again
    }
    f.drawn = true; st.lastUse = st.frameNo;
  };
  // renderer = the WebGPURenderer, material = the composite's material (its render object is the place in the draw order). Nothing here throws: { installed, text } (text = the line of the diagnostic record)
  const install = (renderer, material) => {
    try {
      if (st.installed) return { installed: true, text: st.text };
      const backend = renderer?.backend, xr = renderer?.xr;
      if (typeof backend?.draw !== 'function' || typeof backend.get !== 'function' || !xr || !material) throw new Error('no backend.draw / get, xr or material on this renderer');
      const u = backend.utils;
      if (typeof u?.getCurrentColorFormat !== 'function' || typeof u.getCurrentDepthStencilFormat !== 'function' || typeof u.getSampleCountRenderContext !== 'function') throw new Error('no backend.utils formats on this three.js build');
      if (renderer.reversedDepthBuffer === true || backend.parameters?.reversedDepthBuffer === true) throw new Error('reversed depth buffer');
      if (backend._vrlDirectDraw) throw new Error('hooked already');
      const orig = backend.draw;
      backend.draw = function (renderObject, info) {
        try { onDraw(this, renderObject); } catch (e) { fail('the hook threw: ' + errText(e)); } // the composite then draws what the path would have: from the next frame on
        return orig.apply(this, arguments);
      };
      backend._vrlDirectDraw = true;
      st.material = material; st.xr = xr;
      st.onErr = ev => { if (st.frame || st.frameNo - st.lastUse <= 3) fail('a GPU error while the path was in use: ' + errText(ev)); };
      device.addEventListener?.('uncapturederror', st.onErr);
      st.installed = true;
      st.text = "direct draw: hooked on the backend's draw of the composite (the volume's draw is recorded into three.js' per-eye bundle)";
      return { installed: true, text: st.text };
    } catch (e) {
      st.disabled = 'not installed: ' + errText(e);
      st.text = 'direct draw: not available (' + errText(e) + ')';
      return { installed: false, text: st.text };
    }
  };

  // ---- one frame ----
  // the page says per frame whether it asks for the path (draw() of the renderer reads it; the flicker guard has already had its say)
  const ask = v => { st.asked = !!v; };
  const beginFrame = () => { st.frameNo++; st.frame = null; };
  // may this frame ask for the path? (the checks that do not depend on the frame's regions)
  const why = ({ f, cams, decode, model, variant }) => {
    if (!st.installed) return 'not installed';
    if (st.disabled) return st.disabled;
    if (!(f >= 1 - 1e-6)) return 'render scale below 1';
    if (decode) return 'three.js encodes the frame (sRGB decode on)';
    if (!cams?.length) return 'no eye';
    if (!(model?.determinant?.() > 0)) return 'the volume is mirrored';
    const s = st.seen;
    if (!s) return 'the eye pass has not been seen yet';
    if (!s.layered) return 'the eye pass is not layered';
    if (!s.colorFormat || !s.depthFormat) return 'no colour / depth format';
    for (let i = 0; i < Math.min(2, cams.length); i++) { const v = cams[i].viewport; if (Math.abs(v.x) > 0.5 || Math.abs(v.y) > 0.5) return 'the eye is not at the origin of its image'; }
    const v0 = cams[0].viewport, sv = s.view;
    if (sv && (sv[0] !== 0 || sv[1] !== 0 || Math.round(v0.z) !== sv[2] || Math.round(v0.w) !== sv[3])) return 'the eye pass viewport ' + sv.join(',') + ' is not the eye ' + Math.round(v0.z) + 'x' + Math.round(v0.w);
    const own = h.way ? true : !!getPipe(variant), ways = waysReady(variant); // (with the display's ways the path draws with their programs only: the display's own program is not made for it)
    if (!own || !ways) return 'the pipeline is not compiled yet';
    return null;
  };
  let lastWhy = null;
  const canUse = p => { const w = why(p); if (w !== lastWhy) { lastWhy = w; note('direct draw now', w ? 'offscreen path (' + w + ')' : 'ready'); } return !w; };
  // the frame's eyes: p = { u, variant, model, rects: [{ i, D (the rect, eye px y down), region (the centre pass' region), eye ({ mvp, origin, lightOff } of the whole eye), tilesPerEye }], pxTex (the centre pass' tiles, or null) }.
  // Writes this path's uniforms (the same values the centre pass' draw had, but the matrix of the whole eye and the pre-pass tiles' origin relative to the region), makes the bind groups. Returns the pixels it will draw.
  const setFrame = p => {
    eyes ||= [mkEye(), mkEye()];
    const base = h.passExtra(p.u), out = []; let px = 0;
    for (const r of p.rects) {
      const e = eyes[r.i], proxyOrg = p.pxTex ? [r.region.x0 - (p.way?.tile ?? PROXY.tile) * r.i * r.tilesPerEye, r.region.y0] : [0, 0]; // (the tiles' size: 8 for the display's own pre-pass, 4 for the new ways' tiles)
      const ab = h.fillUniforms(p.u, { mvp: r.eye.mvp, origin: r.eye.origin, lightOff: r.eye.lightOff, ...base, proxyOn: p.pxTex ? 1 : 0, proxyOrg });
      device.queue.writeBuffer(e.ubuf, 0, ab);
      e.rect[0] = r.D.x0; e.rect[1] = r.D.y0; e.rect[2] = r.D.x1; e.rect[3] = r.D.y1; device.queue.writeBuffer(e.dbuf, 0, e.rect);
      out[r.i] = { group: makeGroup('d' + r.i, e.ubuf, p.u, p.pxTex), dgroup: e.dgroup };
      px += (r.D.x1 - r.D.x0) * (r.D.y1 - r.D.y0);
    }
    st.frame = { on: true, model: p.model, variant: p.variant, eyes: out, drawn: false, miss: null, way: p.way ? { mode: p.way.mode, group1: p.way.group1 } : null };
    return px;
  };
  // after the frame's main render: a frame that was set up, whose composite was drawn but whose direct draw could not be recorded, has a hole in the centre for that one frame: the path is switched off for the session at once.
  // (A frame whose composite was not drawn at all, the volume hidden, has no hole: nothing is made of it.) Returns what the frame did: 'direct' / 'miss' / 'none'
  const afterRender = () => {
    const f = st.frame; st.frame = null;
    if (!f) return 'none';
    if (f.drawn) return 'direct';
    if (f.miss) { if (!st.disabled) fail('not recorded: ' + f.miss); return 'miss'; }
    if (f.other) { if (!st.disabled) fail('not recorded: the composite was drawn only by an object that is not the volume\'s mesh'); return 'miss'; }
    return 'none';
  };

  // ---- the check (the performance record's recording only) ----
  // noteForCheck(p) after the centre pass of a frame at scale 1 (p = { u, variant, W, H, eye, region, D, pxTex }); check(cb) once from the same frame draws (A) the centre pass over the rect D again (the reference) and
  // (B) the direct material over the same rect into an eye-sized scratch image, then a compute pass counts the pixels that differ (cb({ total, covered, colour, depth, text })). One at a time; false = not now.
  const ck = { note: null, busy: false, pipes: new Map(), diff: null, A: null, B: null, cnt: null, rb: null, par: null, ubuf: null, dbuf: null, dgroup: null, gD: null, gKey: '' };
  const noteForCheck = p => { ck.note = { ...p, noteNo: st.frameNo }; };
  const mkTarget = (w, hh) => { const mk = () => device.createTexture({ size: [w, hh, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }); const t = { w, h: hh, color: mk(), depth: mk() }; t.cv = t.color.createView(); t.dv = t.depth.createView(); return t; };
  const killTarget = t => { try { t?.color.destroy(); t?.depth.destroy(); } catch { /* gone */ } };
  const checkPipe = variant => {
    const key = vkeyOf(variant); let e = ck.pipes.get(key);
    if (!e) {
      e = { state: 'pending', pipe: null }; ck.pipes.set(key, e);
      try {
        const module = moduleFor(variant, true);
        device.createRenderPipelineAsync({ layout: layouts().pipeLayout, vertex: vertex(module), fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' } })
          .then(pp => { e.pipe = pp; e.state = 'ready'; }, err => { e.state = 'error'; note('direct draw check', 'the check pipeline failed (' + key + '): ' + errText(err)); });
      } catch (err) { e.state = 'error'; note('direct draw check', 'the check pipeline failed (' + key + '): ' + errText(err)); }
    }
    return e.state === 'ready' ? e.pipe : null;
  };
  const diffPipe = () => {
    if (!ck.diff) {
      ck.diff = { state: 'pending' };
      try {
        const module = device.createShaderModule({ code: directDiffWgsl() }); try { h.onShader?.(module, { f16: false, cls4: false, events: false, abl: 'direct-diff' }); } catch { /* diagnostics only */ }
        const tex = binding => ({ binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } });
        const bg = device.createBindGroupLayout({ entries: [tex(0), tex(1), tex(2), tex(3), { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }] });
        device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bg] }), compute: { module, entryPoint: 'main' } })
          .then(pp => { ck.diff = { state: 'ready', pipe: pp, bgl: bg }; }, err => { ck.diff = { state: 'error' }; note('direct draw check', 'the comparison pipeline failed: ' + errText(err)); });
      } catch (err) { ck.diff = { state: 'error' }; note('direct draw check', 'the comparison pipeline failed: ' + errText(err)); }
    }
    return ck.diff.state === 'ready' ? ck.diff : null;
  };
  const check = (cb, rec = null) => { // rec = the frame record markFrame closed (the frame after it has no gap sample, as after a shadow pass)
    const n = ck.note;
    if (ck.busy || !n || !n.D) return false;
    const refPipe = h.pipeFor(n.variant), chkPipe = checkPipe(n.variant), dp = diffPipe();
    if (!refPipe || !chkPipe || !dp) return false;
    ck.busy = true;
    try {
      const r = n.region, D = n.D, rw = r.x1 - r.x0, rh = r.y1 - r.y0, dw = D.x1 - D.x0, dh = D.y1 - D.y0;
      if (!ck.A || ck.A.w !== rw || ck.A.h !== rh) { killTarget(ck.A); ck.A = mkTarget(rw, rh); }
      if (!ck.B || ck.B.w !== n.W || ck.B.h !== n.H) { killTarget(ck.B); ck.B = mkTarget(n.W, n.H); }
      ck.cnt ||= device.createBuffer({ size: DIRECT_DIFF_COUNTERS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      ck.rb ||= device.createBuffer({ size: DIRECT_DIFF_COUNTERS * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      ck.par ||= device.createBuffer({ size: 32, usage: BUF_U() });
      ck.ubuf ||= device.createBuffer({ size: layout.byteSize, usage: BUF_U() });
      ck.dbuf ||= device.createBuffer({ size: 16, usage: BUF_U() });
      ck.dgroup ||= device.createBindGroup({ layout: layouts().dBgl, entries: [{ binding: 0, resource: { buffer: ck.dbuf } }] });
      // B's uniforms: the whole eye's matrix and the tiles' origin relative to the region (what the real path writes for eye 0)
      const pxOrg = n.pxTex ? [r.x0, r.y0] : [0, 0], checkNo = st.frameNo;
      const ab = h.fillUniforms(n.u, { mvp: n.eye.mvp, origin: n.eye.origin, lightOff: n.eye.lightOff, ...h.passExtra(n.u), proxyOn: n.pxTex ? 1 : 0, proxyOrg: pxOrg });
      device.queue.writeBuffer(ck.ubuf, 0, ab);
      device.queue.writeBuffer(ck.dbuf, 0, new Int32Array([D.x0, D.y0, D.x1, D.y1]));
      device.queue.writeBuffer(ck.par, 0, new Int32Array([D.x0, D.y0, D.x1, D.y1, r.x0, r.y0, 0, 0]));
      const clear = { r: 0, g: 0, b: 0, a: 0 }, att = t => [{ view: t.cv, loadOp: 'clear', storeOp: 'store', clearValue: clear }, { view: t.dv, loadOp: 'clear', storeOp: 'store', clearValue: clear }];
      const enc = device.createCommandEncoder();
      const pa = enc.beginRenderPass({ colorAttachments: att(ck.A) }); // A: the centre pass over the rect (its own bind group, its uniforms of this frame, the same tiles)
      pa.setPipeline(refPipe); pa.setVertexBuffer(0, boxBuf); pa.setBindGroup(0, h.bindGroup(0, n.u, n.pxTex));
      pa.setViewport(0, 0, rw, rh, 0, 1); pa.setScissorRect(D.x0 - r.x0, D.y0 - r.y0, dw, dh); pa.draw(36); pa.end();
      const pb = enc.beginRenderPass({ colorAttachments: att(ck.B) }); // B: the direct material (the check variant of its fragment) over the same rect, with the whole eye's matrix
      pb.setPipeline(chkPipe); pb.setVertexBuffer(0, boxBuf); pb.setBindGroup(0, makeGroup('chk', ck.ubuf, n.u, n.pxTex)); pb.setBindGroup(1, ck.dgroup);
      pb.setViewport(0, 0, n.W, n.H, 0, 1); pb.setScissorRect(D.x0, D.y0, dw, dh); pb.draw(36); pb.end();
      const key = [ck.A.color, ck.B.color].map(t => h.texId(t)).join('.');
      if (ck.gKey !== key) {
        ck.gKey = key;
        ck.gD = device.createBindGroup({ layout: dp.bgl, entries: [{ binding: 0, resource: ck.A.cv }, { binding: 1, resource: ck.A.dv }, { binding: 2, resource: ck.B.cv }, { binding: 3, resource: ck.B.dv }, { binding: 4, resource: { buffer: ck.cnt } }, { binding: 5, resource: { buffer: ck.par } }] });
      }
      enc.clearBuffer(ck.cnt);
      const cp = enc.beginComputePass(); cp.setPipeline(dp.pipe); cp.setBindGroup(0, ck.gD); cp.dispatchWorkgroups(Math.ceil(dw / 8), Math.ceil(dh / 8)); cp.end();
      enc.copyBufferToBuffer(ck.cnt, 0, ck.rb, 0, DIRECT_DIFF_COUNTERS * 4);
      device.queue.submit([enc.finish()]);
      if (rec) rec.shadowed = true;
      ck.rb.mapAsync(GPUMapMode.READ).then(() => {
        const a = new Uint32Array(ck.rb.getMappedRange().slice(0)); ck.rb.unmap(); ck.busy = false; if (ck.release) { ck.release = false; releaseCheck(); }
        const meta = { checkNo, noteNo: n.noteNo ?? null, D: [D.x0, D.y0, D.x1, D.y1], region: [r.x0, r.y0, r.x1, r.y1], W: n.W, H: n.H, pre: !!n.pxTex, orgA: [0, 0], orgB: pxOrg };
        try { cb?.({ total: dw * dh, covered: a[2], colour: a[0], depth: a[1], cmax: a[3], dmax: a[4], covA: a[5], covB: a[6], both: a[7], c1: a[8], d2: a[9], d256: a[10], edge: a[11], aFront: a[12], bFront: a[13], shift: a[14], ...meta, text: 'rect ' + D.x0 + ',' + D.y0 + '-' + D.x1 + ',' + D.y1 + ' of the eye: colour ' + a[0] + ' depth ' + a[1] + ' of ' + a[2] + ' covered px' }); } catch { /* the page's callback */ }
      }).catch(() => { ck.busy = false; if (ck.release) { ck.release = false; releaseCheck(); } });
      return true;
    } catch (e) { ck.busy = false; note('direct draw check', 'the check threw: ' + errText(e)); return false; }
  };
  // the scratch images and buffers of the check (after the recording)
  const releaseCheck = () => {
    if (ck.busy) { ck.release = true; return; } // a read-back is still to come: the next call (dispose) lets go
    killTarget(ck.A); killTarget(ck.B); ck.A = ck.B = null; ck.gKey = ''; ck.gD = null; ck.note = null;
    for (const k of ['cnt', 'rb', 'par', 'ubuf', 'dbuf']) { try { ck[k]?.destroy(); } catch { /* gone */ } ck[k] = null; }
    ck.dgroup = null;
  };
  const dispose = () => {
    try { if (st.onErr) device.removeEventListener?.('uncapturederror', st.onErr); } catch { /* gone */ }
    ck.busy = false; releaseCheck();
    if (eyes) for (const e of eyes) { try { e.ubuf.destroy(); e.dbuf.destroy(); } catch { /* gone */ } }
    eyes = null; groups.clear(); st.frame = null;
  };
  const dropSnapshot = () => { try { h.dropSnapshot?.(); } catch { /* the breakdown's own */ } };
  return { install, canUse, why, ask, beginFrame, setFrame, dropSnapshot, afterRender, noteForCheck, check, releaseCheck, dispose, fail, setNotifier: fn => { st.notify = fn; },
    get asked() { return st.asked; }, get installed() { return st.installed; }, get disabled() { return st.disabled; }, get text() { return st.text; }, get seen() { return st.seen; }, _st: st };
}
