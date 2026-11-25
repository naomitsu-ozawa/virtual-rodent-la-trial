// WebGPU (WGSL) core of the VR / AR volume: the body of the volume (no detached parts), the WGSL twin of the GLSL fragment shader of vr-view.js.
// Same march as the WebGL one: the combined classification + distance texture (rgba8: the classes of up to three segments, the distance field in alpha),
// the fourth segment's class bytes in their own texture (CLS4), the creep-skip bits, the jumps by the distance field, the opaque short loop (a hit ends the ray and is
// searched and shaded after the loop), the content box, the section planes with their slices and the cut face. The variants (the GLSL VRL_* defines) are built as text:
// volumeWgsl({f16, cls4, events}). Not in this core (the WebGL program keeps them): the analysis results' colours, the child segments, hidden parts, the detached parts,
// the sample pair's second volume, the general (non-combined) loop and the HU path.
// The ray: the box is drawn with its back faces (like the WebGL program), vPos is the back-face point, the ray starts at the eye (origin, object space).
// Output: colour 0 = the premultiplied colour, colour 1 = the depth of the first thing shown (NDC z, 24 bit in rgb) for the composite.
import { lightingWGSL } from './lighting.js?v=20261125-build763';
import { featParts, featKey, FEAT_FIELDS } from './vr-wgsl-feat.js?v=20261125-build763';

// ---- the uniform buffer: one struct, every member laid out by the WGSL rules (vec3 = 16-aligned, 12 bytes; arrays of vec4 only) ----
// [name, type, count]; the packer (vr-wgpu.js) writes by this table, the struct text is made from it, a unit test checks both against wgsl_reflect
export const UNIFORM_FIELDS = [
  ['mvp', 'mat4x4f'],
  ['origin', 'vec3f'], ['stepSize', 'f32'],
  ['lightOff', 'vec3f'], ['voxelMin', 'f32'],
  ['halfExt', 'vec3f'], ['diag', 'i32'],
  ['boxC', 'vec3f'], ['boxEntry', 'i32'],
  ['boxH', 'vec3f'], ['refine', 'i32'],
  ['texDims', 'vec3f'], ['useSkip', 'i32'],
  ['calib', 'vec3f'], ['editMask', 'i32'],
  ['voxelSize', 'vec3f'], ['editMaskOnly', 'i32'],
  ['clsChan', 'vec4i'],
  ['segA', 'vec4f', 4], ['segC', 'vec4f', 4], ['segM', 'vec4f', 4], ['ctShadeRange', 'vec4f', 4],
  ['cutPlanes', 'vec4f', 10],
  ['sliceWindow', 'vec2f'], ['sliceAir', 'f32'], ['sliceTint', 'f32'],
  ['sliceOpacity', 'f32'], ['sliceSegOnly', 'f32'], ['ctShade', 'f32'], ['ctShadeBright', 'f32'],
  ['ctShadeContrast', 'f32'], ['planeCount', 'i32'], ['planeCut', 'i32'], ['capOn', 'i32'],
  ['jumpOn', 'i32'], ['proxyOn', 'i32'], ['proxyOrg', 'vec2i'], ['pad1', 'i32'],
];
// the packer's members: the core's own and then the feature axis' (docs/vr-wgsl-feat.js): the offsets of the core's members are the same in both, a text without a feature declares only the core's
export const UNIFORM_FIELDS_ALL = [...UNIFORM_FIELDS, ...FEAT_FIELDS];
const TYPES = {
  f32: { a: 4, s: 4, n: 1, k: 'f', wgsl: 'f32' }, i32: { a: 4, s: 4, n: 1, k: 'i', wgsl: 'i32' },
  vec2f: { a: 8, s: 8, n: 2, k: 'f', wgsl: 'vec2<f32>' }, vec2i: { a: 8, s: 8, n: 2, k: 'i', wgsl: 'vec2<i32>' }, vec3f: { a: 16, s: 12, n: 3, k: 'f', wgsl: 'vec3<f32>' },
  vec4f: { a: 16, s: 16, n: 4, k: 'f', wgsl: 'vec4<f32>' }, vec4i: { a: 16, s: 16, n: 4, k: 'i', wgsl: 'vec4<i32>' },
  mat4x4f: { a: 16, s: 64, n: 16, k: 'f', wgsl: 'mat4x4<f32>' },
};
export function uniformLayout(fields = UNIFORM_FIELDS) {
  let at = 0, align = 16;
  const out = [];
  for (const [name, type, count] of fields) {
    const t = TYPES[type];
    const stride = count ? Math.max(16, t.s) : t.s; // an array element in a uniform buffer is 16-aligned
    const a = count ? 16 : t.a;
    at = Math.ceil(at / a) * a;
    out.push({ name, type, count: count || 0, offset: at, n: t.n, k: t.k, stride });
    at += count ? stride * count : t.s;
  }
  return { fields: out, byteSize: Math.ceil(at / align) * align };
}
export const uniformStruct = (fields = UNIFORM_FIELDS) =>
  'struct U{\n' + fields.map(([name, type, count]) => ' ' + name + ':' + (count ? 'array<' + TYPES[type].wgsl + ',' + count + '>' : TYPES[type].wgsl) + ',').join('\n') + '\n};\n';

// bindings of the volume pass (one bind group): 0 uniforms, 1 vol (rg8 HU), 2 clsTex (combined), 3 cls4Tex, 4 skipTex (rg32uint), 5 editTex, 6 sliceVol (rg8 HU, the 512 grid), 7 sampler (linear), 8 sampler of editTex (linear or nearest, the 詳細 setting),
// 9 proxyTex (r32float, one value per 8 x 8 pixel tile: the pre-pass's tA, read with textureLoad; a 1 x 1 dummy in a pass that has no pre-pass)
export const VOLUME_BINDINGS = { uniforms: 0, vol: 1, cls: 2, cls4: 3, skip: 4, edit: 5, slice: 6, sampler: 7, samplerEdit: 8, proxy: 9 };
export const BOX_VERTICES = (() => { // 12 triangles, counter-clockwise seen from outside; the pass draws the back faces (cull front)
  const q = (a, b, c, d) => [a, b, c, a, c, d], V = (x, y, z) => [x, y, z];
  const p = [V(-1, -1, -1), V(1, -1, -1), V(1, 1, -1), V(-1, 1, -1), V(-1, -1, 1), V(1, -1, 1), V(1, 1, 1), V(-1, 1, 1)];
  const faces = [q(p[4], p[5], p[6], p[7]), q(p[1], p[0], p[3], p[2]), q(p[5], p[1], p[2], p[6]), q(p[0], p[4], p[7], p[3]), q(p[7], p[6], p[2], p[3]), q(p[0], p[1], p[5], p[4])];
  return new Float32Array(faces.flat(2));
})();

// the WGSL of one variant. f16: shader-f16 is on (the per-step values qc / f0..f3 / curF in half precision, the 0.5 test stays exact because q - 0.5 is taken in f32 first);
// cls4: the fourth segment's classes come from cls4Tex; events: the section planes / slices / cut face code is compiled (a session without a section leaves it out)
function volumeWgslBase({ f16, cls4, events, feat = null }) {
  const C4 = (e, tc) => (cls4 ? `${e}.a=textureSampleLevel(cls4Tex,smp,clamp(${tc},vec3<f32>(0.0),vec3<f32>(0.999999)),0.0).r;` : '');
  const EV = s => (events ? s : '');
  const PX = s => (events ? '' : s); // the pre-pass start: not in a variant with section planes (those run the march from k = 0, the text of)
  const FM = f16 ? 'f16' : 'f32', FM4 = 'vec4<' + FM + '>'; // the half-precision type of the per-step values (written out: no alias)
  const FT = featParts(feat), H = (s, e = '') => (FT.on ? s : e); // FT: the feature axis' pieces ('' / the core's own text for none); H(text, other): text only with a feature
  return `${f16 ? 'enable f16;\n' : ''}// VR / AR volume pass (WGSL), variant f16=${f16} cls4=${cls4} events=${events}${H(' feat=' + featKey(feat))}
const SEG_OFF=${f16 ? 'f16(4.0)' : '1.0e9'};
const ACC_STOP:f32=0.95;
const DEPTH_BIAS_RAY:f32=0.5;
const DEPTH_BIAS_MIN:f32=1.5;
const CT_SHADE_MIN:f32=0.35;
const SEG_ALPHA:f32=0.95;
const NSEG:i32=4;
const SECTION_PLANES:i32=10;
${uniformStruct(FT.on ? [...UNIFORM_FIELDS, ...FT.fields] : UNIFORM_FIELDS)}
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var vol:texture_3d<f32>;
@group(0) @binding(2) var clsTex:texture_3d<f32>;
@group(0) @binding(3) var cls4Tex:texture_3d<f32>;
@group(0) @binding(4) var skipTex:texture_3d<u32>;
@group(0) @binding(5) var editTex:texture_3d<f32>;
@group(0) @binding(6) var sliceVol:texture_3d<f32>;
@group(0) @binding(7) var smp:sampler;
@group(0) @binding(8) var smpE:sampler;
@group(0) @binding(9) var proxyTex:texture_2d<f32>;
${FT.bind}${lightingWGSL()}
struct VOut{@builtin(position) pos:vec4<f32>,@location(0) vPos:vec3<f32>};
@vertex fn vs(@location(0) p:vec3<f32>)->VOut{
 var o:VOut;let q=p*u.halfExt;o.vPos=q;o.pos=u.mvp*vec4<f32>(q,1.0);return o;
}
struct FOut{@location(0) color:vec4<f32>,@location(1) depth:vec4<f32>};
var<private> gDepthT:f32=-1.0;
var<private> gHuMean:f32=0.0;
var<private> gInv:vec3<f32>=vec3<f32>(1.0);
fn encDepth(d:f32)->vec4<f32>{
 let x=u32(round(clamp(d,0.0,1.0)*16777215.0));
 return vec4<f32>(f32((x>>16u)&255u)/255.0,f32((x>>8u)&255u)/255.0,f32(x&255u)/255.0,1.0);
}
fn depthMark(tt:f32,a:f32){if(gDepthT<0.0&&a>0.02){gDepthT=tt;}}
fn safeDir(d:vec3<f32>)->vec3<f32>{return select(d,vec3<f32>(1.0e-20),abs(d)<vec3<f32>(1.0e-20));}
fn hitBox(o:vec3<f32>,d:vec3<f32>)->vec2<f32>{
 let inv=1.0/safeDir(d);let a=(-u.halfExt-o)*inv;let b=(u.halfExt-o)*inv;
 let lo=min(a,b);let hi=max(a,b);
 return vec2<f32>(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));
}
fn hitContent(o:vec3<f32>,d:vec3<f32>)->vec2<f32>{
 let inv=1.0/safeDir(d);let a=(u.boxC-u.boxH-o)*inv;let b=(u.boxC+u.boxH-o)*inv;
 let lo=min(a,b);let hi=max(a,b);
 return vec2<f32>(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));
}
// the box face the ray enters through, as the outward unit normal (a hit on that face itself is flat shaded: no iso-surface there)
fn entryFaceNormal(o:vec3<f32>,d:vec3<f32>)->vec3<f32>{
 let inv=1.0/safeDir(d);let a=(-u.halfExt-o)*inv;let b=(u.halfExt-o)*inv;
 let lo=min(a,b);
 var n=vec3<f32>(0.0);
 if(lo.x>=lo.y&&lo.x>=lo.z){n.x=-sign(d.x);}else if(lo.y>=lo.z){n.y=-sign(d.y);}else{n.z=-sign(d.z);}
 return n;
}
fn texCoord(p:vec3<f32>)->vec3<f32>{return vec3<f32>(p.x*gInv.x+0.5,0.5-p.y*gInv.y,p.z*gInv.z+0.5);}
fn cl(tc:vec3<f32>)->vec3<f32>{return clamp(tc,vec3<f32>(0.0),vec3<f32>(0.999999));}
fn depthBias(d:vec3<f32>)->f32{return DEPTH_BIAS_RAY*dot(abs(d),u.voxelSize)+DEPTH_BIAS_MIN*u.voxelMin;}
fn huAt(tc0:vec3<f32>)->f32{
 let q=textureSampleLevel(vol,smp,cl(tc0),0.0).rg*255.0;
 return (q.x+q.y*256.0-u.calib.z)*u.calib.x+u.calib.y;
}
fn sliceHU(p:vec3<f32>)->f32{
 let q=textureSampleLevel(sliceVol,smp,cl(texCoord(p)),0.0).rg*255.0;
 return (q.x+q.y*256.0-u.calib.z)*u.calib.x+u.calib.y;
}
// brightness factor (CT_SHADE_MIN..1) at a HU through the segment's own shading range (slice fill, rules of the GLSL ctLumHU)
fn ctLumHU(hu:f32,s:i32)->f32{
 if(u.ctShade<0.5||u.diag==3||u.segC[s].w>0.5){return 1.0;}
 let rg=u.ctShadeRange[s].xy;let t=clamp((hu-rg.x)/max(rg.y-rg.x,1.0e-3),0.0,1.0);
 let g=1.0/max(u.ctShadeBright,0.1);let l=pow(mix(CT_SHADE_MIN,1.0,t),g);
 if(u.ctShadeContrast==1.0){return l;}
 let p=0.5*(pow(CT_SHADE_MIN,g)+1.0);return clamp(p+(l-p)*u.ctShadeContrast,0.05,1.0);
}
fn clsAt(tc:vec3<f32>)->vec4<f32>{
 var q=textureSampleLevel(clsTex,smp,cl(tc),0.0);
 ${C4('q', 'tc')}
 return q;
}
// the segment (slot) a classification vector is in, -1 = none: the first enabled slot whose channel is at or above 0.5
fn segIdxOfQ(q:vec4<f32>)->i32{
 for(var s=0;s<NSEG;s++){let c=u.clsChan[s];if(c>=0&&u.segA[s].w>0.5&&q[c]>=0.5){return s;}}
 return -1;
}
fn segIdxAt(tc:vec3<f32>)->i32{return segIdxOfQ(clsAt(tc));}
${FT.fns}// the slice fill's lit look (the plane's normal turned to the viewer: the cut face of a tissue-look segment), the rest keep col
fn sliceLook(p:vec3<f32>,col:vec3<f32>,si:i32,rd:vec3<f32>,ro:vec3<f32>)->vec3<f32>{
 ${FT.look}let m=${FT.segM}[si];
 if(m.w<0.5||m.w>3.5){return col;}
 var bi=0;var bd=1.0e30;
 for(var i=0;i<SECTION_PLANES;i++){if(i>=u.planeCount){break;}let dd=abs(dot(u.cutPlanes[i].xyz,p)-u.cutPlanes[i].w);if(dd<bd){bd=dd;bi=i;}}
 return vrlRealCut(col,u.cutPlanes[bi].xyz,-rd,u.lightOff,vrlDepth01(dot(p-ro,rd),ro,u.halfExt));
}
// the CT slice on a section plane (rgb, a): transparent at or below sliceAir, tinted where a shown segment is, or only the segments' region at 0 % opacity
fn sliceColor(p:vec3<f32>,rd:vec3<f32>,ro:vec3<f32>)->vec4<f32>{
 let hu=sliceHU(p);let a=smoothstep(u.sliceAir,u.sliceAir+10.0,hu);
 if(u.sliceSegOnly>0.5){
  var si=-1;if(u.ctShade>0.5||u.sliceTint>0.0){si=${FT.vis('segIdxAt(texCoord(p))', 'p')};}
  if(si<0){return vec4<f32>(0.0);}
  var sr=vec4<f32>(${FT.col('p', 'u.segC[si].rgb', 'si')}*${FT.lum('p', 'hu', 'si')},select(u.sliceTint,SEG_ALPHA,u.ctShade>0.5));
  sr=vec4<f32>(sliceLook(p,sr.rgb,si,rd,ro),sr.a);return sr;
 }
 if(a<=0.0){return vec4<f32>(0.0);}
 let g=clamp((hu-(u.sliceWindow.x-0.5*u.sliceWindow.y))/max(u.sliceWindow.y,1.0e-3),0.0,1.0);
 if(u.sliceTint>0.0){let si=${FT.vis('segIdxAt(texCoord(p))', 'p')};if(si>=0){return vec4<f32>(mix(vec3<f32>(g),${FT.col('p', 'u.segC[si].rgb', 'si')}*${FT.lum('p', 'hu', 'si')},vec3<f32>(u.sliceTint)),a);}}
 return vec4<f32>(vec3<f32>(g),a);
}
// the HU gradient normal (central differences, six fetches); gHuMean = the mean of them = the HU at the hit
fn gradientHU(tc:vec3<f32>)->vec3<f32>{
 let d=1.0/max(u.texDims,vec3<f32>(1.0));
 let xp=huAt(tc+vec3<f32>(d.x,0.0,0.0));let xm=huAt(tc-vec3<f32>(d.x,0.0,0.0));
 let yp=huAt(tc+vec3<f32>(0.0,d.y,0.0));let ym=huAt(tc-vec3<f32>(0.0,d.y,0.0));
 let zp=huAt(tc+vec3<f32>(0.0,0.0,d.z));let zm=huAt(tc-vec3<f32>(0.0,0.0,d.z));
 gHuMean=(xp+xm+yp+ym+zp+zm)*(1.0/6.0);
 let vx=2.0*u.halfExt/max(u.texDims,vec3<f32>(1.0));
 let g=vec3<f32>((xp-xm)/max(vx.x,1.0e-6),-(yp-ym)/max(vx.y,1.0e-6),(zp-zm)/max(vx.z,1.0e-6));
 let l=length(g);
 if(l<1.0e-6){return vec3<f32>(0.0,0.0,1.0);}
 return g/l;
}
// the normal of a hit on slot s: where the surface IS the processing mask the gradient of the mask's field (editTex channel s, read linear), else the HU gradient
fn gradientAtS(tc:vec3<f32>,s:i32)->vec3<f32>{
${FT.bake} if(s>=0&&((u.editMask>>u32(s))&1)==1){
  let dd=1.0/max(vec3<f32>(textureDimensions(editTex)),vec3<f32>(1.0));let tq=cl(tc);
  let md=((u.editMaskOnly>>u32(s))&1)==1;
  let e0=textureSampleLevel(editTex,smpE,tq,0.0);
  if(md||abs(e0[s] - 0.5)<0.3){
   var g=vec3<f32>(0.0);
   for(var k=0;k<3;k++){
    var o=vec3<f32>(0.0);o[k]=dd[k];
    let ep=textureSampleLevel(editTex,smpE,cl(tc+o),0.0);let em=textureSampleLevel(editTex,smpE,cl(tc-o),0.0);
    g[k]=ep[s]-em[s];
   }
   let vx=2.0*u.halfExt*dd;let n=vec3<f32>(g.x/max(vx.x,1.0e-6),-g.y/max(vx.y,1.0e-6),g.z/max(vx.z,1.0e-6));
   let l=length(n);gHuMean=-1.0e9;
   if(l>1.0e-6){return n/l;}
   return vec3<f32>(0.0,0.0,1.0);
  }
 }
 return gradientHU(tc);
}
@fragment fn fs(in:VOut)->FOut{
 var fo:FOut;fo.color=vec4<f32>(0.0);fo.depth=encDepth(in.pos.z);
${FT.init} let o=u.origin;let dir=normalize(in.vPos-u.origin);
 gInv=0.5/u.halfExt;
 let tcO=texCoord(o);let tcD=vec3<f32>(dir.x*gInv.x,-dir.y*gInv.y,dir.z*gInv.z);
 let bounds=hitBox(o,dir);
 if(bounds.x>bounds.y){discard;return fo;}
 // the length of one grid-index unit along this ray (the distance bytes are grid-index units): a jump of (dd - margin) * jkA is as safe on anisotropic data as on isotropic
 let jkA=max(1.0/max(0.5*length(dir*u.texDims/u.halfExt),1.0e-6),u.voxelMin);
 var t=max(bounds.x,0.0);var endT=bounds.y;let stp=max(u.stepSize,1.0e-5);
 if(u.boxH.x>0.0){let cb=hitContent(o,dir);if(cb.x>cb.y||cb.y<0.0){discard;return fo;}endT=min(endT,cb.y);if(u.boxEntry==1){t=max(t,cb.x);}}
 if(u.diag==1){fo.color=vec4<f32>(0.2,0.35,0.5,1.0);return fo;}
 var capT=-1.0;var capPlane=-1;
${EV(` var crossT:array<f32,10>;var sliceT:array<f32,10>;var nSlice=0;
 // the section work is per ray, never per sample, and only for the planeCount planes in use. A plane that neither clips nor shows a slice is skipped
 for(var i=0;i<SECTION_PLANES;i++){
  if(i>=u.planeCount){break;}
  crossT[i]=-1.0e30;let clip=((u.planeCut>>u32(i))&1)==1;if(!clip&&u.sliceOpacity<=0.0){continue;}
  let pl=u.cutPlanes[i];let side=dot(pl.xyz,o)-pl.w;let slope=dot(pl.xyz,dir);
  if(abs(slope)>1.0e-8){
   let cr=-side/slope;crossT[i]=cr;
   if(clip){if(slope>0.0){if(cr>t){t=cr;capT=cr;capPlane=i;}}else{endT=min(endT,cr);}}
  }else if(clip&&side<0.0){discard;return fo;}
 }
`)}
 if(t>endT+1.0e-6){discard;return fo;}
 if(u.capOn==0||capT>endT){capT=-1.0;capPlane=-1;}
 // an entry-face hit lies on the box face the ray entered through (the camera is outside, nothing moved the start): flat shaded; faceT = the entry sample (no jump from it inside a segment)
 let faceEnd=select(-1.0,bounds.x+stp,bounds.x>0.0&&t<=bounds.x+1.0e-4);
 let faceT=select(-1.0,t,faceEnd>=0.0);
${EV(` if(u.sliceOpacity>0.0){
  for(var i=0;i<SECTION_PLANES;i++){if(i>=u.planeCount){break;}if(crossT[i]>=t-1.0e-5&&crossT[i]<=endT+1.0e-5){sliceT[nSlice]=crossT[i];nSlice++;}}
  for(var i=1;i<SECTION_PLANES;i++){if(i>=nSlice){break;}let k=sliceT[i];var j=i-1;loop{if(!(j>=0&&sliceT[j]>k)){break;}sliceT[j+1]=sliceT[j];j--;}sliceT[j+1]=k;}
 }
 var nextSlice=0;
`)}
 var previousT=t;var lastIndex=-1;var acc=vec4<f32>(0.0);var iters=0;
 let t0=t;var k=0; // the ray's sample grid: every sample is t0 + k * stp (one expression, made at the top of the loop); a step is k++, a jump is k += m
${PX(` // the pre-pass: proxyTex holds, per 8 x 8 pixel tile, tA = the eye distance below which no sample inside the box, of any ray of the tile, lies in a shown segment (PROXY_WGSL below).
 // tA past the end of the ray: no sample can be inside, the loop is not run (the result of a ray that hits nothing); else the march starts one grid point before the one tA falls on: k = floor((tA - t0) / stp) - 1, never below 0.
 // t0, faceT and faceEnd above are the ray's own and stay: only k moves (a start after t0 is past the entry sample, so faceT never applies there).
 var emptyRay=false;
 if(u.proxyOn==1){
  let tA=textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/8,0).r;
  if(tA>endT){emptyRay=true;}else if(tA>t0){k=max(0,i32(floor((tA-t0)/stp))-1);}
 }
`)} var jumpLen=0.0;var hitEnd=false;
 var prevValid=false;var prevF=0.0;
 var prevSkip=false;var skBlk=vec3<i32>(-1);var skBits=vec2<u32>(0u);
 var chk=false; // the creep check is made only while the ray is near a surface (see below): false at the ray start and after a jump
 var hitIdx=-1;var hitLo=0.0;var hitHi=0.0;var hitF0=0.0;var hitF1=0.0;var hitIso=false;var hitSimple=false;var hitNb=6;
${FT.hidInit} // per-ray constants: one-hot channel selectors per segment (no dynamic indexing of the fetched vector inside the march); a disabled segment's offset is SEG_OFF
 var sel0=${FM4}(0.0);var sel1=${FM4}(0.0);var sel2=${FM4}(0.0);var sel3=${FM4}(0.0);var off0=SEG_OFF;var off1=SEG_OFF;var off2=SEG_OFF;var off3=SEG_OFF;
 {let c=u.clsChan[0];if(c>=0&&u.segA[0].w>0.5){sel0[c]=${FM}(1.0);off0=${FM}(0.0);}}
 {let c=u.clsChan[1];if(c>=0&&u.segA[1].w>0.5){sel1[c]=${FM}(1.0);off1=${FM}(0.0);}}
 {let c=u.clsChan[2];if(c>=0&&u.segA[2].w>0.5){sel2[c]=${FM}(1.0);off2=${FM}(0.0);}}
 {let c=u.clsChan[3];if(c>=0&&u.segA[3].w>0.5){sel3[c]=${FM}(1.0);off3=${FM}(0.0);}}
 let skipOn=u.useSkip>0&&u.diag!=4;
${FT.P ? ` // the parts (P): pfA + pfV * t = the sample in the texel coordinates of the part's field (its trilinear cell = the floor), the map partFieldAt reads; the 8^3 blocks of partOcc are read only on a ray without slices or a cut face (the WebGL program's
 // narrow loop: its loop with those events has none)
 let pfD=vec3<f32>(textureDimensions(partField));let pfA=(tcO*u.partFieldScale+u.partFieldOff)*pfD-vec3<f32>(0.5);let pfV=tcD*u.partFieldScale*pfD;let pfOn=${events ? 'nSlice==0&&capT<0.0' : 'true'};
` : ''} for(var iter=${events ? '0' : 'select(0,4096,emptyRay)'};iter<4096;iter++){
  let t=t0+f32(k)*stp;
  if(t>endT||acc.a>ACC_STOP){break;}
  iters++;
${FT.P ? `  // a part's ray (partKind != 0) in an 8^3 block of its field where no point is in the part, the body's (partKind 0) in a block that every slot it draws cuts whole: no sample up to the block's far side can be a hit, the ray goes to the first grid point past it,
  // the loop's state is that after the last sample left out (previousT): lastIndex -1, prevHid = it was in a shown segment (hidden here), prevF = its value
  if(pfOn){
   let pp=pfA+pfV*t;let bk=min(clamp(vec3<i32>(floor(pp)),vec3<i32>(0),vec3<i32>(pfD)-vec3<i32>(1))>>vec3<u32>(3u),vec3<i32>(textureDimensions(partOcc))-vec3<i32>(1));
   let ob=textureLoad(partOcc,bk,0);
   var occOut=false;
   if(u.partKind!=0){occOut=ob.r<0.5;}else{occOut=(off0>${FM}(0.5)||ob.r>0.5)&&(off1>${FM}(0.5)||ob.g>0.5)&&(off2>${FM}(0.5)||ob.b>0.5)&&(off3>${FM}(0.5)||ob.a>0.5);}
   if(occOut){
    let lo3=vec3<f32>(bk*8);let bd=select(lo3,lo3+vec3<f32>(8.0),pfV>=vec3<f32>(0.0));let tx=abs(bd-pp)/max(abs(pfV),vec3<f32>(1.0e-9));
    let pm=i32(min(max(1.0,ceil(min(tx.x,min(tx.y,tx.z))/stp)),16777216.0));
    let pT=t0+f32(k+pm-1)*stp;previousT=pT;
    var qo=textureSampleLevel(clsTex,smp,cl(tcO+tcD*pT),0.0);${C4('qo', '(tcO+tcD*pT)')}
    let qoc=${FM4}(qo-vec4<f32>(0.5));
    let h0=dot(qoc,sel0)-off0;let h1=dot(qoc,sel1)-off1;let h2=dot(qoc,sel2)-off2;let h3=dot(qoc,sel3)-off3;
    var hf=max(max(h0,h1),max(h2,h3));if(h3>=${FM}(0.0)){hf=h3;}if(h2>=${FM}(0.0)){hf=h2;}if(h1>=${FM}(0.0)){hf=h1;}if(h0>=${FM}(0.0)){hf=h0;}
    prevF=f32(hf);prevHid=max(max(h0,h1),max(h2,h3))>=${FM}(0.0);
    prevValid=true;prevSkip=false;lastIndex=-1;k+=pm;continue;
   }
  }
` : ''}${EV(`  // slices up to t + step, then the cut face, then the sample (the order of the WebGL loop)
  while(nextSlice<nSlice&&sliceT[nextSlice]<=t+stp){
   let sc=sliceColor(o+dir*sliceT[nextSlice],dir,o);nextSlice++;
   let contribution=(1.0-acc.a)*u.sliceOpacity*sc.a;acc=vec4<f32>(acc.rgb+sc.rgb*contribution,acc.a+contribution);
  }
  if(capT>=0.0){
   let cp=o+dir*capT;let capAt=capT;${H('var', 'let')} ci=segIdxAt(texCoord(cp));capT=-1.0;
${(FT.R ? '   ci=regionVis(cp,ci);\n' : '') + (FT.C ? '   ci=childVis(cp,ci);\n   if(ci>=0){childLook(childLookIdAt(texCoord(cp),ci),ci);}\n' : '')}   if(ci>=0){
    let n=u.cutPlanes[capPlane].xyz;let viewDir=-dir;
    let lit=vrlRealCut(mix(${FT.col('cp', 'u.segC[ci].rgb', 'ci')},vec3<f32>(1.0),vec3<f32>(0.22)),n,viewDir,u.lightOff,vrlDepth01(capAt,o,u.halfExt));
    let contribution=(1.0-acc.a)*clamp(${FT.segA}[ci].z,0.03,1.0);acc=vec4<f32>(acc.rgb+lit*contribution,acc.a+contribution);depthMark(capAt,contribution);
    lastIndex=ci;previousT=t;k++;continue;
   }
  }
`)}
  // the creep skip: the sample's trilinear footprint is the dual cell fl..fl+1; its bit says "outside every shown segment, alpha <= 2": no fetch, no jump, move on (prevF is fetched at previousT only if a hit follows)
  // The bit is looked up only when chk: the previous sample was read with dd < 2.7 (no jump: near a surface) or was a creep step. At the ray start and right after a jump (the 4^3 block has changed, so
  // the lookup would cost a dependent skipTex read before the cls read) the sample is read as usual. Exactness (the contract of vr-skip-occupancy.js: a set bit means the read would find no segment and
  // dd <= 2, no jump): a sample read instead of skipped sets lastIndex = -1, prevValid = true, previousT = t, k++ (the next grid point), exactly as the skip does; only prevSkip / prevF differ, and prevSkip = true only
  // makes the hit path fetch prevF at previousT, the same sample, so a hit, its bracket (hitLo, hitHi), hitNb, hitIso and the secant's outside value are those of the skip
  if(skipOn&&chk){
   let pp=(tcO+tcD*t)*u.texDims-vec3<f32>(0.5);let fl=floor(pp);let fr=pp-fl;
   if(all(fr>vec3<f32>(1.0/64.0))&&all(fr<vec3<f32>(63.0/64.0))&&all(fl>=vec3<f32>(0.0))&&all(fl<u.texDims-vec3<f32>(1.0))){
    let sc=vec3<i32>(fl);let sb=sc>>vec3<u32>(2u);
    if(any(sb!=skBlk)){skBlk=sb;skBits=textureLoad(skipTex,sb,0).rg;}
    let sl=sc&vec3<i32>(3);let sbit=sl.x+(sl.y<<2u)+(sl.z<<4u);
    let sw=select(skBits.y,skBits.x,sbit<32);
    if(((sw>>u32(sbit&31))&1u)!=0u){prevValid=true;prevSkip=true;lastIndex=-1;${H('prevHid=false;')}previousT=t;k++;continue;}
   }
  }
  let tcS=cl(tcO+tcD*t);
  var q=textureSampleLevel(clsTex,smp,tcS,0.0);var dd=q.a*255.0;
  if(dd>=2.7&&t<=faceT){
   var qf=q;${C4('qf', 'tcS')}
   let qfc=${FM4}(qf-vec4<f32>(0.5));
   if(max(max(dot(qfc,sel0)-off0,dot(qfc,sel1)-off1),max(dot(qfc,sel2)-off2,dot(qfc,sel3)-off3))>=${FM}(0.0)){dd=0.0;}
  }
  if(u.jumpOn==0){dd=0.0;}
${FT.T ? '  if((prevHid&&!hideFieldOk())||(lastIndex>=0&&hideAnyOn())){dd=0.0;}\n' : H('  if(prevHid&&!hideFieldOk()){dd=0.0;}\n')}  chk=dd<2.7;
  // a jump is never shorter than a normal step (m >= 1); it lands on the same t0 + k * step grid
  if(dd>=2.7){let m=max(1,i32(floor((dd-1.8)*jkA/stp)));let nextJ=t0+f32(k+m)*stp;jumpLen+=nextJ-t;previousT=nextJ-stp*0.05;prevValid=false;k+=m;continue;}
  ${C4('q', 'tcS')}
  let qc=${FM4}(q-vec4<f32>(0.5));
  let f0=dot(qc,sel0)-off0;let f1=dot(qc,sel1)-off1;let f2=dot(qc,sel2)-off2;let f3=dot(qc,sel3)-off3;
  var idx=-1;var curF:${FM}=${FM}(-1.0);
  if(f0>=${FM}(0.0)){idx=0;curF=f0;}else if(f1>=${FM}(0.0)){idx=1;curF=f1;}else if(f2>=${FM}(0.0)){idx=2;curF=f2;}else if(f3>=${FM}(0.0)){idx=3;curF=f3;}
${H('  var hidNow=false; // this sample is in a hidden part (-> prevHid of the next one)\n')}  if(idx!=lastIndex){
${H('   var passH=false; // a hit on a hidden part is no hit: the ray goes on (lastIndex stays -1, so the next sample inside the segment is a candidate again)\n')}   if(idx>=0){
    if(prevSkip&&prevValid){
     var qp=textureSampleLevel(clsTex,smp,cl(tcO+tcD*previousT),0.0);${C4('qp', '(tcO+tcD*previousT)')}
     let qpc=${FM4}(qp-vec4<f32>(0.5));
     let g0=dot(qpc,sel0)-off0;let g1=dot(qpc,sel1)-off1;let g2=dot(qpc,sel2)-off2;let g3=dot(qpc,sel3)-off3;
     prevF=f32(max(max(g0,g1),max(g2,g3)));
    }
    // segments are always opaque in VR: every hit ends the ray and is searched and shaded after the loop
    ${H('var', 'let')} simple=u.diag==3||u.segC[idx].w>0.5;
${FT.C ? `    {var chI=cIdx(tcO+tcD*t).x;var chE=vec4<f32>(0.0);if(chI>=1){chE=childLut[256+chI];}
     passH=${FT.chH}(tcO+tcD*t,idx);
     if(!passH&&((i32(chE.a+0.5)>>u32(idx))&1)==1){chI=cIdx(tcO+tcD*t).y;chE=vec4<f32>(0.0);if(chI>=1){chE=childLut[256+chI];}}
     if(((i32(chE.b+0.5)>>u32(idx))&1)==1){simple=true;}
     childLook(chI,idx);}
` : ''}${FT.R ? `    if(!passH&&u.regionAnyHidden!=0){passH=${FT.rgH}(tcO+tcD*t,idx);}\n` : ''}${H('    hidNow=passH;\n')}    hitIso=u.refine==1&&((u.editMask>>u32(idx))&1)==0&&prevValid&&prevF<0.0;
${FT.T ? `    hitHid=prevHid;
    if(!passH){
     let alphaT=clamp(gSegA[idx].z,0.03,1.0);
     if((1.0-acc.a)*alphaT+acc.a>ACC_STOP&&!simple){hitIdx=idx;hitLo=previousT;hitHi=t;hitF0=prevF;hitF1=f32(curF);hitSimple=simple;hitNb=select(2,6,prevValid);lastIndex=idx;break;}
     { // the non-opaque march: a hit that does not end the ray is searched and shaded here, the ray goes on behind it (the WebGL 'full' program's loop)
      var lo=previousT;var hi=t;var f0i=prevF;var f1i=f32(curF);let cI=u.clsChan[idx];let nb=select(2,6,prevValid);
      if(!simple&&hitIso&&!hideAnyOn()){
       for(var r=0;r<3;r++){
        var mid=(lo+hi)*0.5;if(r<2&&abs(f1i-f0i)>1.0e-6){mid=clamp(lo+(hi-lo)*(-f0i/(f1i-f0i)),lo+(hi-lo)*0.02,hi-(hi-lo)*0.02);}
        let qm=clsAt(tcO+tcD*mid);
        let fmv=qm[cI] - 0.5;var inside=fmv>=0.0;
        for(var s=0;s<NSEG;s++){if(s>=idx){break;}let c=u.clsChan[s];if(c>=0&&u.segA[s].w>0.5&&qm[c]>=0.5){inside=false;}}
        if(inside){hi=mid;f1i=fmv;}else{lo=mid;f0i=fmv;}
       }
      }else if(!simple){
       for(var r=0;r<6;r++){
        if(r>=nb){break;}
        let mid=(lo+hi)*0.5;let qm=clsAt(tcO+tcD*mid);
        var inside=qm[cI]>=0.5;
        for(var s=0;s<NSEG;s++){if(s>=idx){break;}let c=u.clsChan[s];if(c>=0&&u.segA[s].w>0.5&&qm[c]>=0.5){inside=false;}}
        if(inside&&hideAnyOn()&&hideAt(tcO+tcD*mid,idx)){inside=false;}
        if(inside){hi=mid;}else{lo=mid;}
       }
      }
      let hpT=o+dir*hi;let tcT=texCoord(hpT);
      var onFaceT=!simple&&hi<=faceEnd;
      var nT=-dir;var hcutT=false;
      if(!simple){if(onFaceT){nT=entryFaceNormal(o,dir);}else{if(prevHid){let hn=hideGrad(tcT,idx);if(dot(hn,hn)>0.0){nT=normalize(hn);hcutT=true;}}if(!hcutT){nT=gradientAtS(tcT,idx);}}}
      onFaceT=onFaceT||hcutT;
      let viewDirT=normalize(o-hpT);let laterT=acc.a>0.0&&!simple&&!onFaceT;
      let nnT=select(nT,select(nT,-nT,gHuMean<0.5*(u.segA[idx].x+u.segA[idx].y)),laterT);
      let shadeT=vrlShade(nnT,viewDirT,u.lightOff,vrlDepth01(hi,o,u.halfExt),select(0.0,1.0,laterT),gSegM[idx].xyz);
      let litT=colAt(hpT+dir*(0.75*u.voxelMin),u.segC[idx].rgb,idx)*shadeT.x+vec3<f32>(shadeT.y);
      let contributionT=(1.0-acc.a)*alphaT;acc=vec4<f32>(acc.rgb+litT*contributionT,acc.a+contributionT);depthMark(hi,contributionT);
     }
    }
` : H('    hitHid=prevHid;\n    if(!passH){')}${FT.T ? '' : "    hitIdx=idx;hitLo=previousT;hitHi=t;hitF0=prevF;hitF1=f32(curF);hitSimple=simple;hitNb=select(2,6,prevValid);lastIndex=idx;break;" + H('}') + "\n"}   }\n   lastIndex=${H('select(idx,-1,passH)', 'idx')};
  }${FT.T ? ' else if(idx>=0&&hideAnyOn()&&hideAt(tcO+tcD*t,idx)){lastIndex=-1;hidNow=true;} // a see-through segment: a hidden part met inside it is left like one met from outside, the shown part after it is a hit again' : ''}
${H('  prevHid=hidNow;\n')}  prevSkip=false;prevValid=true;prevF=select(f32(max(max(f0,f1),max(f2,f3))),f32(curF),idx>=0);
  previousT=t;k++;
 }
 if(hitIdx>=0){
  ${FT.P ? 'var' : 'let'} idx=hitIdx;var lo=hitLo;var hi=hitHi;var f0=hitF0;var f1=hitF1;${FT.P ? 'var' : 'let'} cIdx=u.clsChan[idx];
  if(hitSimple){}
  else if(hitIso${FT.P ? '&&!hitHid' : ''}${H('&&!hideAnyOn()')}){ // two secant guesses and one bisection on the interpolated class value
   for(var r=0;r<3;r++){
    var mid=(lo+hi)*0.5;if(r<2&&abs(f1-f0)>1.0e-6){mid=clamp(lo+(hi-lo)*(-f0/(f1-f0)),lo+(hi-lo)*0.02,hi-(hi-lo)*0.02);}
    let qm=clsAt(tcO+tcD*mid);
    let fmv=qm[cIdx] - 0.5;var inside=fmv>=0.0;
    for(var s=0;s<NSEG;s++){if(s>=idx){break;}let c=u.clsChan[s];if(c>=0&&u.segA[s].w>0.5&&qm[c]>=0.5){inside=false;}}
    if(inside){hi=mid;f1=fmv;}else{lo=mid;f0=fmv;}
   }
  }else{
   for(var r=0;r<6;r++){
    if(r>=hitNb){break;}
    let mid=(lo+hi)*0.5;let qm=clsAt(tcO+tcD*mid);
    var inside=qm[cIdx]>=0.5;
    for(var s=0;s<NSEG;s++){if(s>=idx){break;}let c=u.clsChan[s];if(c>=0&&u.segA[s].w>0.5&&qm[c]>=0.5){inside=false;}}
${FT.P ? `    { // after a hidden part: the first point where ANY shown segment is and it is not hidden (its own slot): the cut face, whatever segment it meets
     var hs=idx;var hc=inside&&hideAnyOn();
     if(hitHid&&u.diag!=4){let qmc=${FM4}(qm-vec4<f32>(0.5));hs=-1;if(dot(qmc,sel0)-off0>=${FM}(0.0)){hs=0;}else if(dot(qmc,sel1)-off1>=${FM}(0.0)){hs=1;}else if(dot(qmc,sel2)-off2>=${FM}(0.0)){hs=2;}else if(dot(qmc,sel3)-off3>=${FM}(0.0)){hs=3;}inside=hs>=0;hc=inside;}
     if(hc&&hideAt(tcO+tcD*mid,hs)){inside=false;}
    }
` : H('    if(inside&&hideAnyOn()&&hideAt(tcO+tcD*mid,idx)){inside=false;} // the surface is not in a hidden part: after a hidden part it is where the shown part starts\n')}    if(inside){hi=mid;}else{lo=mid;}
   }
  }
${FT.P ? `  if(hitHid&&!hitSimple&&u.diag!=4){ // the segment of the point found (the cut face's), not the sample's one step on (not at diag 4: the WebGL program's general loop, which draws that diagnostic, keeps the sample's own segment)
   let tb=tcO+tcD*hi;var qb=textureSampleLevel(clsTex,smp,cl(tb),0.0);${C4('qb', 'tb')}
   let qbc=${FM4}(qb-vec4<f32>(0.5));var sb=-1;if(dot(qbc,sel0)-off0>=${FM}(0.0)){sb=0;}else if(dot(qbc,sel1)-off1>=${FM}(0.0)){sb=1;}else if(dot(qbc,sel2)-off2>=${FM}(0.0)){sb=2;}else if(dot(qbc,sel3)-off3>=${FM}(0.0)){sb=3;}
   if(sb>=0&&sb!=idx){idx=sb;cIdx=u.clsChan[idx];hitSimple=u.diag==3||u.segC[idx].w>0.5;
${FT.C ? `    {var chI=chIdxP(tb).x;var chE=vec4<f32>(0.0);if(chI>=1){chE=childLut[256+chI];}if(((i32(chE.a+0.5)>>u32(idx))&1)==1){chI=chIdxP(tb).y;chE=vec4<f32>(0.0);if(chI>=1){chE=childLut[256+chI];}}if(((i32(chE.b+0.5)>>u32(idx))&1)==1){hitSimple=true;}childLook(chI,idx);}
` : ''}   }
  }
` : ''}  let hp=o+dir*hi;let tc=texCoord(hp);
${FT.on ? `  var onFace=!hitSimple&&hi<=faceEnd;
  var n=-dir;
  var hcut=false;
  if(!hitSimple){if(onFace){n=entryFaceNormal(o,dir);}else{if(hitHid){let hn=hideGrad(tc,idx);if(dot(hn,hn)>0.0){n=normalize(hn);hcut=true;}}if(!hcut){n=gradientAtS(tc,idx);}}}
  onFace=onFace||hcut; // the cut a hidden part leaves is lit by its border, as the box face (not flipped)
` : `  let onFace=!hitSimple&&hi<=faceEnd;
  var n=-dir;
  if(!hitSimple){if(onFace){n=entryFaceNormal(o,dir);}else{n=gradientAtS(tc,idx);}}
`}  let viewDir=normalize(o-hp);let later=acc.a>0.0&&!hitSimple&&!onFace;
  let nn=select(n,select(n,-n,gHuMean<0.5*(u.segA[idx].x+u.segA[idx].y)),later);
  let shade=vrlShade(nn,viewDir,u.lightOff,vrlDepth01(hi,o,u.halfExt),select(0.0,1.0,later),${FT.segM}[idx].xyz);
  let alpha=clamp(${FT.segA}[idx].z,0.03,1.0);
  let lit=${FT.col('hp+dir*(0.75*u.voxelMin)', 'u.segC[idx].rgb', 'idx')}*shade.x+vec3<f32>(shade.y);
  let contribution=(1.0-acc.a)*alpha;acc=vec4<f32>(acc.rgb+lit*contribution,acc.a+contribution);hitEnd=true;
  depthMark(hi,1.0);
 }
${EV(` while(nextSlice<nSlice&&acc.a<=ACC_STOP){
  let sc=sliceColor(o+dir*sliceT[nextSlice],dir,o);nextSlice++;
  let contribution=(1.0-acc.a)*u.sliceOpacity*sc.a;acc=vec4<f32>(acc.rgb+sc.rgb*contribution,acc.a+contribution);
 }
`)}
 if(u.diag==2){let h=clamp(f32(iters)/1024.0,0.0,1.0);fo.color=vec4<f32>(h,1.0-abs(h*2.0-1.0),1.0-h,1.0);return fo;}
 if(acc.a>ACC_STOP){hitEnd=true;}
 // the probe (diag 5): R = samples / 1024, G = ray ended by a hit, B = share of the path skipped by jumps
 if(u.diag==5){fo.color=vec4<f32>(clamp(f32(iters)/1024.0,0.0,1.0),select(0.0,1.0,hitEnd),clamp(jumpLen/max(endT-t0,1.0e-6),0.0,1.0),1.0);return fo;}
 if(acc.a<0.004){discard;return fo;}
 // a ray stopped at ACC_STOP is made fully opaque (AR passthrough would show the real world through the last 5 %)
 if(acc.a>ACC_STOP){acc=acc/acc.a;}
 if(gDepthT>=0.0){let cp=u.mvp*vec4<f32>(o+dir*(gDepthT+depthBias(dir)),1.0);if(cp.w>1.0e-6){fo.depth=encDepth(cp.z/cp.w);}}
 fo.color=acc;
 return fo;
}
`;
}

// ---- the variants of the performance record's volume breakdown (docs/vr-wgpu.js: shadow passes and the counting probe); the display pipelines never use them ----
// They are made from the text of the display variant by exact substitutions (every anchor must occur exactly the expected number of times, else this throws), so the display text itself is not touched:
// abl 'grad' = no gradient (n = -dir, the search stays), 'refine' = no surface search (hi = hitHi, no fetches), 'shade' = no shading maths (lit = segC; the normal still feeds the result through a term
// that is 0 at run time, f32(u.pad1), so the gradient and the search are not removed by the optimiser), counters = a twin that counts (see COUNTER_FIELDS) into a storage buffer instead of discarding.
export const ABLATIONS = ['grad', 'refine', 'shade'];
// the u32 a counting pixel writes (COUNTER_FIELDS.length of them; index in the pixel's record); a pixel the pass did not cover keeps 0 (the buffer is cleared before the pass)
// near4 / near8 / near16 (Steps, Jumps) = the approach: at the first sample whose distance byte dd (grid-index units = voxels of the texture; read before the jumpOn override) is <= R, the loop iterations used so far (this sample included) and the jumps made before it; 0 steps = no sample of the ray came within R
// The place counts (appended, so the indices above stay): toTA = the loop iterations whose grid index k lies before the index the pre-pass would start the ray at (all of them for a ray the pre-pass calls empty; 0 when the tile of the pixel is not known to the twin
// or the pass runs with the pre-pass on, which starts there); last4Steps / last8Steps / last16Steps = the iteration number (1-based, the sample counted) of the LAST sample whose distance byte dd was <= R (0 = none); with near<R>Steps (the first one) they cut the ray into approach / near / tail (vr-perf-log.js).
export const COUNTER_FIELDS = ['outcome', 'iters', 'creep', 'jumps', 'skipReads', 'clsReads', 'refineReads', 'gradReads', 'near4Steps', 'near4Jumps', 'near8Steps', 'near8Jumps', 'near16Steps', 'near16Jumps', 'toTA', 'last4Steps', 'last8Steps', 'last16Steps'];
// group 1 binding 1 of the counting twin (one uniform, 8 f32): sc = (sx, sy, ox, oy): the probe pixel p reads the tile of the low pass's region pixel floor(p * (sx, sy)) + (ox, oy) (the window's place in the region); lim = (w, h, mode, 0): the region's size in px (a pixel outside it has no tile: tA 0 = the ray starts as it would without the pre-pass), mode 1 = the host bound the display's tiles (proxyTex, the same tiles the low pass read) and the twin may read tA, 0 = no tiles
export const COUNTER_CFG_BINDING = { group: 1, binding: 1, floats: 8 };
export const COUNTER_OUTCOME = { none: 0, hit: 1, pass: 2, accstop: 3, discard: 4 }; // 0 = not covered; hit = the ray ended on a surface; pass = marched to its end with nothing; accstop = stopped at the opacity limit; discard = left before the march (outside the box / content / section)
export const COUNTER_BINDING = { group: 1, binding: 0 };
const sub = (t, from, to, n = 1) => {
  const parts = t.split(from);
  if (parts.length - 1 !== n) throw new Error('volumeWgsl: anchor found ' + (parts.length - 1) + ' times, expected ' + n + ': ' + from.slice(0, 60));
  return parts.join(to);
};
const cut = (t, from, to) => {
  const i = t.indexOf(from), j = i < 0 ? -1 : t.indexOf(to, i + from.length);
  if (i < 0 || j < 0 || t.indexOf(from, i + 1) >= 0) throw new Error('volumeWgsl: region not found: ' + from.slice(0, 60));
  return t.slice(0, i) + t.slice(j);
};
function ablate(t, abl, counters) {
  if (abl && !ABLATIONS.includes(abl)) throw new Error('volumeWgsl: unknown abl ' + abl);
  if (abl === 'grad') t = sub(t, 'if(!hitSimple){if(onFace){n=entryFaceNormal(o,dir);}else{n=gradientAtS(tc,idx);}}', 'if(!hitSimple){if(onFace){n=entryFaceNormal(o,dir);}}');
  else if (abl === 'refine') t = cut(t, '  if(hitSimple){}\n  else if(hitIso){', '  let hp=o+dir*hi;');
  else if (abl === 'shade') t = sub(t, 'let shade=vrlShade(nn,viewDir,u.lightOff,vrlDepth01(hi,o,u.halfExt),select(0.0,1.0,later),u.segM[idx].xyz);', 'let shade=vec2<f32>(1.0+f32(u.pad1)*(nn.x+nn.y+nn.z+viewDir.x+viewDir.y+viewDir.z),0.0);');
  if (counters) {
    t = sub(t, 'var<private> gInv:vec3<f32>=vec3<f32>(1.0);\n', 'var<private> gInv:vec3<f32>=vec3<f32>(1.0);\n'
      + 'var<private> gOut:u32=2u;var<private> gIters:u32=0u;var<private> gCreep:u32=0u;var<private> gJumps:u32=0u;var<private> gSkipRd:u32=0u;var<private> gClsRd:u32=0u;var<private> gRefRd:u32=0u;var<private> gGradRd:u32=0u;\n'
      + 'var<private> gN4:u32=0u;var<private> gJ4:u32=0u;var<private> gN8:u32=0u;var<private> gJ8:u32=0u;var<private> gN16:u32=0u;var<private> gJ16:u32=0u;\n'
      + 'var<private> gA:u32=0u;var<private> gKs:i32=0;var<private> gL4:u32=0u;var<private> gL8:u32=0u;var<private> gL16:u32=0u;\n'
      + 'fn cntNear(dd:f32){if(gN4==0u&&dd<=4.0){gN4=gIters;gJ4=gJumps;}if(gN8==0u&&dd<=8.0){gN8=gIters;gJ8=gJumps;}if(gN16==0u&&dd<=16.0){gN16=gIters;gJ16=gJumps;}if(dd<=4.0){gL4=gIters;}if(dd<=8.0){gL8=gIters;}if(dd<=16.0){gL16=gIters;}}\n'
      + 'struct CntCfg{sc:vec4<f32>,lim:vec4<f32>};\n@group(1) @binding(1) var<uniform> cntCfg:CntCfg;\n'
      + 'fn cntTileA(p:vec2<f32>)->f32{\n if(cntCfg.lim.z<0.5){return 0.0;}\n let q=vec2<i32>(floor(p*cntCfg.sc.xy))+vec2<i32>(cntCfg.sc.zw);\n if(q.x<0||q.y<0||q.x>=i32(cntCfg.lim.x)||q.y>=i32(cntCfg.lim.y)){return 0.0;}\n return textureLoad(proxyTex,q/8,0).r;\n}\n'
      + 'const CNT_W:u32=64u;\n@group(1) @binding(0) var<storage,read_write> cnt:array<u32>;\n');
    t = sub(t, 'if(acc.a<0.004){discard;return fo;}', 'if(acc.a<0.004){return fo;}');
    const early = t.split('discard;').length - 1;
    if (early < 3 || early > 4) throw new Error('volumeWgsl: ' + early + ' early discards');
    t = t.split('discard;').join('gOut=4u;');
    t = sub(t, 'iters++;', 'iters++;gIters+=1u;if(k<gKs){gA+=1u;}');
    // the pre-pass start of the twin: the tile comes from cntTileA (the window's place in the low pass's region: the display's own tiles, bound by the host), tA is read in every run (toTA needs it with the pre-pass off); only proxyOn == 1 moves k, exactly as the display text does
    const PXSTART = ' if(u.proxyOn==1){\n  let tA=textureLoad(proxyTex,(vec2<i32>(in.pos.xy)-u.proxyOrg)/8,0).r;\n  if(tA>endT){emptyRay=true;}else if(tA>t0){k=max(0,i32(floor((tA-t0)/stp))-1);}\n }\n';
    if (t.includes(PXSTART)) t = sub(t, PXSTART, ' {\n  let tA=cntTileA(in.pos.xy);var kS=0;var em=false;\n  if(tA>endT){em=true;}else if(tA>t0){kS=max(0,i32(floor((tA-t0)/stp))-1);}\n  if(cntCfg.lim.z>0.5){gKs=select(kS,1073741824,em);}\n  if(u.proxyOn==1){if(em){emptyRay=true;}else{k=kS;}}\n }\n'); // (a text without the pre-pass start, the section variant, has no toTA: 0)
    t = sub(t, 'prevValid=true;prevSkip=true;lastIndex=-1;', 'gCreep+=1u;prevValid=true;prevSkip=true;lastIndex=-1;');
    t = sub(t, 'jumpLen+=nextJ-t;', 'jumpLen+=nextJ-t;gJumps+=1u;');
    t = sub(t, 'if(u.jumpOn==0){dd=0.0;}', 'cntNear(dd);if(u.jumpOn==0){dd=0.0;}'); // the approach counts read the distance the march jumps by, before the jumpOn override
    t = sub(t, 'skBlk=sb;skBits=textureLoad(skipTex,sb,0).rg;', 'skBlk=sb;gSkipRd+=1u;skBits=textureLoad(skipTex,sb,0).rg;');
    t = sub(t, 'var q=textureSampleLevel(clsTex,smp,tcS,0.0);var dd=q.a*255.0;', 'gClsRd+=1u;var q=textureSampleLevel(clsTex,smp,tcS,0.0);var dd=q.a*255.0;');
    t = sub(t, 'var qp=textureSampleLevel(clsTex,smp,cl(tcO+tcD*previousT),0.0);', 'gClsRd+=1u;var qp=textureSampleLevel(clsTex,smp,cl(tcO+tcD*previousT),0.0);');
    t = sub(t, 'let qm=clsAt(tcO+tcD*mid);', 'gRefRd+=1u;let qm=clsAt(tcO+tcD*mid);', abl === 'refine' ? 0 : 2);
    t = sub(t, 'let d=1.0/max(u.texDims,vec3<f32>(1.0));\n', 'gGradRd+=6u;let d=1.0/max(u.texDims,vec3<f32>(1.0));\n');
    t = sub(t, 'let e0=textureSampleLevel(editTex,smpE,tq,0.0);', 'gGradRd+=1u;let e0=textureSampleLevel(editTex,smpE,tq,0.0);');
    t = sub(t, 'let ep=textureSampleLevel(editTex,smpE,cl(tc+o),0.0);', 'gGradRd+=2u;let ep=textureSampleLevel(editTex,smpE,cl(tc+o),0.0);');
    t = sub(t, 'depthMark(hi,1.0);', 'gOut=1u;depthMark(hi,1.0);');
    t = sub(t, 'if(acc.a>ACC_STOP){hitEnd=true;}', 'if(acc.a>ACC_STOP){hitEnd=true;if(gOut!=1u){gOut=3u;}}');
    t = sub(t, '@fragment fn fs(in:VOut)->FOut{', 'fn fsMain(in:VOut)->FOut{');
    t += '@fragment fn fs(in:VOut)->FOut{\n let fo=fsMain(in);\n let b=(u32(in.pos.y)*CNT_W+u32(in.pos.x))*'+COUNTER_FIELDS.length+'u;\n cnt[b]=gOut;cnt[b+1u]=gIters;cnt[b+2u]=gCreep;cnt[b+3u]=gJumps;cnt[b+4u]=gSkipRd;cnt[b+5u]=gClsRd;cnt[b+6u]=gRefRd;cnt[b+7u]=gGradRd;cnt[b+8u]=gN4;cnt[b+9u]=gJ4;cnt[b+10u]=gN8;cnt[b+11u]=gJ8;cnt[b+12u]=gN16;cnt[b+13u]=gJ16;cnt[b+14u]=gA;cnt[b+15u]=gL4;cnt[b+16u]=gL8;cnt[b+17u]=gL16;\n return fo;\n}\n';
  }
  return t.replace(/(\/\/ VR \/ AR volume pass \(WGSL\), variant [^\n]*)\n/, '$1 abl=' + (abl || 'none') + ' counters=' + counters + '\n');
}
// the WGSL of one variant; abl / counters only for the performance record's breakdown (see above): with the defaults the text is the display variant's, character for character
export function volumeWgsl({ f16 = false, cls4 = false, events = true, abl = '', counters = false, feat = null } = {}) {
  const t = volumeWgslBase({ f16, cls4, events, feat });
  return abl || counters ? ablate(t, abl, counters) : t;
}

// ---- the pre-pass: per 8 x 8 pixel tile of the low pass, one cone marched from the eye, as a compute pass before the volume pass ----
// Output (one r32float per tile, tiles of both eyes side by side): tA = the eye distance s such that every sample inside the box, of every ray through a pixel centre of the tile, at a distance below tA, lies outside every shown segment
// (3.0e38 = the whole tile is empty). The volume pass starts a ray one grid point before the one tA falls on, and does not march a ray whose tA is past its end. Nothing but the start moves: the ray's samples, jumps, hit and search are the march's own.
// The cone: its axis a = the mean of the four corner pixel centres' directions, its chord coefficient c = the largest |corner direction - a| + epsTheta (a ray at angle th from the axis is 2 sin(th/2) <= c * s from it at distance s).
// A step from the axis point x = o + s a: outside the box the march has no samples, so every sample within (distance of x to the box) - slack - c s is empty of segments; inside, the class vector at the box point nearest to x
// (the clamp: the grid clamps to its edge) is read once, and when no shown slot is inside (class < 0.5 - classMargin) the field's distance dd gives a ball of (dd - ddMargin - slack) voxelMin around it (ddMargin = the jump's 1.8). h = the larger of the two
// reaches; h < hMin voxelMin stops (tA = s), else s += h. The union of the intervals [s - h, s + h] covers [0, tA) because a ray's sample at distance sigma lies within c s + |sigma - s| of x. Reads: the combined texture (class + distance alpha) and cls4Tex, as the march does.
// Constants shared by the shader text and by the CPU model of tests/unit/vr-wgsl-proxy.test.js.
export const PROXY = { tile: 8, epsTheta: 1.0e-4, ddMargin: 1.8, slack: 0.05, hMin: 0.25, maxIt: 128, classMargin: 0.002, empty: 3.0e38 };
// per frame, written by the host: both eyes' inverse region matrices and origins, the region sizes in px, the tiles' layout (tilesPerEye columns per eye, tilesY rows), the grid constants of the volume pass
export const PROXY_FIELDS = [
  ['inv0', 'mat4x4f'], ['inv1', 'mat4x4f'],
  ['org0', 'vec3f'], ['w0', 'i32'], ['org1', 'vec3f'], ['w1', 'i32'],
  ['halfExt', 'vec3f'], ['nEyes', 'i32'],
  ['voxelMin', 'f32'], ['h0', 'i32'], ['h1', 'i32'], ['tilesPerEye', 'i32'],
  ['clsChan', 'vec4i'], ['segOn', 'vec4i'],
  ['tilesY', 'i32'],
];
export const PROXY_BINDINGS = { params: 0, cls: 1, cls4: 2, sampler: 3, out: 4 };
// the direction of the ray through the centre of pixel (px, py) of a w x h region, in object space: the point at NDC z 0.5 (never the near / far plane, which can be at infinity) through the inverse of the region's mvp, minus the eye.
// inv = the inverse of the volume pass's mvp (column-major, 16); org = the eye in object space. The WGSL twin is dirAt in proxyWgsl (a test ties the two).
export function proxyPixelDir(inv, org, px, py, w, h) {
  const nx = (px + 0.5) / w * 2 - 1, ny = 1 - (py + 0.5) / h * 2, v = [nx, ny, 0.5, 1], c = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) c[i] += inv[j * 4 + i] * v[j];
  const d = [c[0] / c[3] - org[0], c[1] / c[3] - org[1], c[2] / c[3] - org[2]], l = Math.hypot(...d);
  return d.map(x => x / l);
}
export function proxyWgsl({ cls4 = false } = {}) {
  const C = PROXY, F = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));
  return `// VR / AR volume pre-pass (WGSL), cls4=${cls4}: one cone per ${C.tile} x ${C.tile} pixel tile (see docs/vr-wgsl-core.js PROXY)
${uniformStruct(PROXY_FIELDS)}
@group(0) @binding(0) var<uniform> p:U;
@group(0) @binding(1) var clsTex:texture_3d<f32>;
@group(0) @binding(2) var cls4Tex:texture_3d<f32>;
@group(0) @binding(3) var smp:sampler;
@group(0) @binding(4) var tilesOut:texture_storage_2d<r32float,write>;
fn texCoord(q:vec3<f32>)->vec3<f32>{let g=0.5/p.halfExt;return vec3<f32>(q.x*g.x+0.5,0.5-q.y*g.y,q.z*g.z+0.5);}
fn cl(tc:vec3<f32>)->vec3<f32>{return clamp(tc,vec3<f32>(0.0),vec3<f32>(0.999999));}
fn eyeOrg(e:i32)->vec3<f32>{if(e==1){return p.org1;}return p.org0;}
fn dirAt(e:i32,px:f32,py:f32,w:f32,h:f32)->vec3<f32>{
 let nx=(px+0.5)/w*2.0-1.0;let ny=1.0-(py+0.5)/h*2.0;
 var m=p.inv0;if(e==1){m=p.inv1;}
 let c=m*vec4<f32>(nx,ny,0.5,1.0);
 return normalize(c.xyz/c.w-eyeOrg(e));
}
fn anyInside(q:vec4<f32>)->bool{
 for(var s=0;s<4;s++){let c=p.clsChan[s];if(c>=0&&p.segOn[s]!=0&&q[c]>=0.5-${F(C.classMargin)}){return true;}}
 return false;
}
fn cone(e:i32,lx:i32,ty:i32,w:i32,h:i32)->f32{
 let x0=f32(lx*${C.tile});let y0=f32(ty*${C.tile});let x1=f32(min(w,lx*${C.tile}+${C.tile})-1);let y1=f32(min(h,ty*${C.tile}+${C.tile})-1);
 let fw=f32(w);let fh=f32(h);
 let d00=dirAt(e,x0,y0,fw,fh);let d10=dirAt(e,x1,y0,fw,fh);let d01=dirAt(e,x0,y1,fw,fh);let d11=dirAt(e,x1,y1,fw,fh);
 let o=eyeOrg(e);let a=normalize(d00+d10+d01+d11);
 let ch=max(max(length(d00-a),length(d10-a)),max(length(d01-a),length(d11-a)))+${F(C.epsTheta)};
 let he=p.halfExt;let vm=p.voxelMin;let far=length(o)+length(he);
 var s=0.0;
 for(var it=0;it<${C.maxIt};it++){
  if(s>far){return ${C.empty.toExponential(1)};}
  let x=o+a*s;let xc=clamp(x,-he,he);let dBox=length(x-xc);let rC=s*ch;
  var hh=dBox-${F(C.slack)}*vm-rC;
  var q=textureSampleLevel(clsTex,smp,cl(texCoord(xc)),0.0);let dd=q.a*255.0;
  ${cls4 ? 'q.a=textureSampleLevel(cls4Tex,smp,cl(texCoord(xc)),0.0).r;' : ''}
  if(!anyInside(q)){let rho=(dd-${F(C.ddMargin)}-${F(C.slack)})*vm;hh=max(hh,rho-dBox-rC);}
  if(hh<${F(C.hMin)}*vm){return s;}
  s+=hh;
 }
 return s;
}
@compute @workgroup_size(${C.tile},${C.tile}) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let tx=i32(g.x);let ty=i32(g.y);
 if(tx>=p.tilesPerEye*p.nEyes||ty>=p.tilesY){return;}
 let e=tx/p.tilesPerEye;let lx=tx-e*p.tilesPerEye;
 var w=p.w0;var h=p.h0;if(e==1){w=p.w1;h=p.h1;}
 var res=0.0;
 if(lx*${C.tile}<w&&ty*${C.tile}<h){res=cone(e,lx,ty,w,h);}
 textureStore(tilesOut,vec2<i32>(tx,ty),vec4<f32>(res,0.0,0.0,0.0));
}
`;
}
// the comparison of the performance record's variants (docs/vr-perf-log.js BD_SPECS, diff / proxy): the pixels whose colour or packed depth differ between two render targets of the same size, and by how much
// (cnt, 4 u32: [0] = pixels that differ (colour or packed depth), [1] = the largest colour channel difference (0..255, rgba8), [2] = the largest difference of a byte of the packed depth (0..255; a packed byte is no magnitude: it only says "not equal"), [3] = pixels whose colour differs); the host reads 16 bytes back
export const PROXY_DIFF_BINDINGS = { colorA: 0, depthA: 1, colorB: 2, depthB: 3, count: 4 };
export const DIFF_FIELDS = ['pixels', 'maxColor', 'maxDepthByte', 'colorPixels'];
export function proxyDiffWgsl() {
  return `// VR / AR volume variant comparison (WGSL): pixels where colour or depth differ between two targets, and the largest colour channel difference
@group(0) @binding(0) var cA:texture_2d<f32>;
@group(0) @binding(1) var dA:texture_2d<f32>;
@group(0) @binding(2) var cB:texture_2d<f32>;
@group(0) @binding(3) var dB:texture_2d<f32>;
@group(0) @binding(4) var<storage,read_write> cnt:array<atomic<u32>,4>;
fn chan(a:vec4<f32>,b:vec4<f32>)->u32{let d=abs(a-b)*255.0;return u32(round(max(max(d.x,d.y),max(d.z,d.w))));}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let d=textureDimensions(cA);
 if(g.x>=d.x||g.y>=d.y){return;}
 let p=vec2<i32>(g.xy);
 let ca=textureLoad(cA,p,0);let cb=textureLoad(cB,p,0);let da=textureLoad(dA,p,0);let db=textureLoad(dB,p,0);
 let cd=any(ca!=cb);let dd=any(da!=db);
 if(cd||dd){atomicAdd(&cnt[0],1u);}
 if(cd){atomicAdd(&cnt[3],1u);atomicMax(&cnt[1],max(chan(ca,cb),1u));}
 if(dd){atomicMax(&cnt[2],max(chan(da,db),1u));}
}
`;
}

// the comparison of the same-picture check (docs/vr-wgpu-ident.js): like proxyDiffWgsl, and in the same compute pass it also counts WHERE the two targets differ. A = the low pass the display really drew (the reference), B = the check's own draw of the same frame.
// P = (cw, ch, split, nonce): the compared range (px of the target: both eyes' viewports side by side) and the x where the right eye's viewport starts. cnt (IDENT_DIFF.total u32, cleared by the host before each run):
//   pixels (colour or packed depth differ), maxColor (the largest colour channel difference, 0..255), maxDepth (the largest difference of a byte of the packed depth), colourPixels (pixels whose colour differs),
//   x / y extent as `size - coordinate` maxima (a minimum without an initial value; 0 = none), eye0 / eye1 (differing pixels of each eye), cells (the differing pixels of each of the 4 x 4 blocks of the compared range, row by row), listN (differences met, the list holds the first 16 of them in the order the GPU got to them)
//   and per listed pixel 6 u32: x, y, colour A, colour B, packed depth A, packed depth B (each as 4 bytes, r in the low byte); body = the pixels of A (the display's picture) whose alpha is not 0 (is the body in the picture at all);
//   nonce = P.w, written back by one thread (the host checks that the read-back is this run's: a comparison whose number does not come back is not counted).
export const IDENT_DIFF = { pixels: 0, maxColor: 1, maxDepth: 2, colorPixels: 3, minX: 4, minY: 5, maxX: 6, maxY: 7, eye0: 8, eye1: 9, cells: 10, listN: 26, list: 27, listMax: 16, listStride: 6, body: 123, nonce: 124, total: 125 };
export const IDENT_DIFF_BINDINGS = { colorA: 0, depthA: 1, colorB: 2, depthB: 3, count: 4, params: 5 };
export function identDiffWgsl() {
  const D = IDENT_DIFF;
  return `// VR / AR same-picture check comparison (WGSL): where and by how much the check's picture differs from the one the display drew
@group(0) @binding(0) var cA:texture_2d<f32>;
@group(0) @binding(1) var dA:texture_2d<f32>;
@group(0) @binding(2) var cB:texture_2d<f32>;
@group(0) @binding(3) var dB:texture_2d<f32>;
@group(0) @binding(4) var<storage,read_write> cnt:array<atomic<u32>,${D.total}>;
@group(0) @binding(5) var<uniform> P:vec4<u32>;
fn chan(a:vec4<f32>,b:vec4<f32>)->u32{let d=abs(a-b)*255.0;return u32(round(max(max(d.x,d.y),max(d.z,d.w))));}
fn pack4(v:vec4<f32>)->u32{let b=vec4<u32>(round(clamp(v,vec4<f32>(0.0),vec4<f32>(1.0))*255.0));return b.x|(b.y<<8u)|(b.z<<16u)|(b.w<<24u);}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 if(g.x>=P.x||g.y>=P.y){return;}
 let p=vec2<i32>(g.xy);
 if(g.x==0u&&g.y==0u){atomicStore(&cnt[${D.nonce}],P.w);}
 let ca=textureLoad(cA,p,0);let cb=textureLoad(cB,p,0);let da=textureLoad(dA,p,0);let db=textureLoad(dB,p,0);
 if(ca.a!=0.0){atomicAdd(&cnt[${D.body}],1u);}
 let cd=any(ca!=cb);let dd=any(da!=db);
 if(!(cd||dd)){return;}
 atomicAdd(&cnt[${D.pixels}],1u);
 if(cd){atomicAdd(&cnt[${D.colorPixels}],1u);atomicMax(&cnt[${D.maxColor}],max(chan(ca,cb),1u));}
 if(dd){atomicMax(&cnt[${D.maxDepth}],max(chan(da,db),1u));}
 atomicMax(&cnt[${D.minX}],P.x-g.x);atomicMax(&cnt[${D.minY}],P.y-g.y);atomicMax(&cnt[${D.maxX}],g.x+1u);atomicMax(&cnt[${D.maxY}],g.y+1u);
 if(g.x<P.z){atomicAdd(&cnt[${D.eye0}],1u);}else{atomicAdd(&cnt[${D.eye1}],1u);}
 let cx=min(3u,g.x*4u/P.x);let cy=min(3u,g.y*4u/P.y);
 atomicAdd(&cnt[${D.cells}u+cy*4u+cx],1u);
 let n=atomicAdd(&cnt[${D.listN}],1u);
 if(n<${D.listMax}u){let b=${D.list}u+n*${D.listStride}u;atomicStore(&cnt[b],g.x);atomicStore(&cnt[b+1u],g.y);atomicStore(&cnt[b+2u],pack4(ca));atomicStore(&cnt[b+3u],pack4(cb));atomicStore(&cnt[b+4u],pack4(da));atomicStore(&cnt[b+5u],pack4(db));}
}
`;
}
// the host's decoding of the counters (a Uint32Array of IDENT_DIFF.total); cw / ch = the compared range
export function identDiffDecode(a, cw, ch) {
  const D = IDENT_DIFF, n = a[D.pixels];
  const rect = n ? { x0: cw - a[D.minX], y0: ch - a[D.minY], x1: a[D.maxX], y1: a[D.maxY] } : null;
  const list = [];
  for (let i = 0; i < Math.min(D.listMax, a[D.listN]); i++) { const b = D.list + i * D.listStride; list.push({ x: a[b], y: a[b + 1], colA: a[b + 2], colB: a[b + 3], depA: a[b + 4], depB: a[b + 5] }); }
  return { pixels: n, body: a[D.body], nonce: a[D.nonce], maxColor: a[D.maxColor], maxDepth: a[D.maxDepth], colorPixels: a[D.colorPixels], rect, eyes: [a[D.eye0], a[D.eye1]], cells: Array.from(a.subarray(D.cells, D.cells + 16)), list };
}
