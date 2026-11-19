// WebGPU (WGSL) core of the VR / AR volume: the body of the volume (no detached parts), the WGSL twin of the GLSL fragment shader of vr-view.js.
// Same march as the WebGL one: the combined classification + distance texture (rgba8: the classes of up to three segments, the distance field in alpha),
// the fourth segment's class bytes in their own texture (CLS4), the creep-skip bits, the jumps by the distance field, the opaque short loop (a hit ends the ray and is
// searched and shaded after the loop), the content box, the section planes with their slices and the cut face. The variants (the GLSL VRL_* defines) are built as text:
// volumeWgsl({f16, cls4, events}). Not in this core (the WebGL program keeps them): the analysis results' colours, the child segments, hidden parts, the detached parts,
// the sample pair's second volume, the general (non-combined) loop and the HU path.
// The ray: the box is drawn with its back faces (like the WebGL program), vPos is the back-face point, the ray starts at the eye (origin, object space).
// Output: colour 0 = the premultiplied colour, colour 1 = the depth of the first thing shown (NDC z, 24 bit in rgb) for the composite.
import { lightingWGSL } from './lighting.js?v=20261119-build750';

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
  ['jumpOn', 'i32'], ['pad0', 'i32'], ['pad1', 'i32'], ['pad2', 'i32'],
];
const TYPES = {
  f32: { a: 4, s: 4, n: 1, k: 'f', wgsl: 'f32' }, i32: { a: 4, s: 4, n: 1, k: 'i', wgsl: 'i32' },
  vec2f: { a: 8, s: 8, n: 2, k: 'f', wgsl: 'vec2<f32>' }, vec3f: { a: 16, s: 12, n: 3, k: 'f', wgsl: 'vec3<f32>' },
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

// bindings of the volume pass (one bind group): 0 uniforms, 1 vol (rg8 HU), 2 clsTex (combined), 3 cls4Tex, 4 skipTex (rg32uint), 5 editTex, 6 sliceVol (rg8 HU, the 512 grid), 7 sampler (linear), 8 sampler of editTex (linear or nearest, the 詳細 setting)
export const VOLUME_BINDINGS = { uniforms: 0, vol: 1, cls: 2, cls4: 3, skip: 4, edit: 5, slice: 6, sampler: 7, samplerEdit: 8 };
export const BOX_VERTICES = (() => { // 12 triangles, counter-clockwise seen from outside; the pass draws the back faces (cull front)
  const q = (a, b, c, d) => [a, b, c, a, c, d], V = (x, y, z) => [x, y, z];
  const p = [V(-1, -1, -1), V(1, -1, -1), V(1, 1, -1), V(-1, 1, -1), V(-1, -1, 1), V(1, -1, 1), V(1, 1, 1), V(-1, 1, 1)];
  const faces = [q(p[4], p[5], p[6], p[7]), q(p[1], p[0], p[3], p[2]), q(p[5], p[1], p[2], p[6]), q(p[0], p[4], p[7], p[3]), q(p[7], p[6], p[2], p[3]), q(p[0], p[1], p[5], p[4])];
  return new Float32Array(faces.flat(2));
})();

// the WGSL of one variant. f16: shader-f16 is on (the per-step values qc / f0..f3 / curF in half precision, the 0.5 test stays exact because q - 0.5 is taken in f32 first);
// cls4: the fourth segment's classes come from cls4Tex; events: the section planes / slices / cut face code is compiled (a session without a section leaves it out)
function volumeWgslBase({ f16, cls4, events }) {
  const C4 = (e, tc) => (cls4 ? `${e}.a=textureSampleLevel(cls4Tex,smp,clamp(${tc},vec3<f32>(0.0),vec3<f32>(0.999999)),0.0).r;` : '');
  const EV = s => (events ? s : '');
  const FM = f16 ? 'f16' : 'f32', FM4 = 'vec4<' + FM + '>'; // the half-precision type of the per-step values (written out: no alias)
  return `${f16 ? 'enable f16;\n' : ''}// VR / AR volume pass (WGSL), variant f16=${f16} cls4=${cls4} events=${events}
const SEG_OFF=${f16 ? 'f16(4.0)' : '1.0e9'};
const ACC_STOP:f32=0.95;
const DEPTH_BIAS_RAY:f32=0.5;
const DEPTH_BIAS_MIN:f32=1.5;
const CT_SHADE_MIN:f32=0.35;
const SEG_ALPHA:f32=0.95;
const NSEG:i32=4;
const SECTION_PLANES:i32=10;
${uniformStruct()}
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var vol:texture_3d<f32>;
@group(0) @binding(2) var clsTex:texture_3d<f32>;
@group(0) @binding(3) var cls4Tex:texture_3d<f32>;
@group(0) @binding(4) var skipTex:texture_3d<u32>;
@group(0) @binding(5) var editTex:texture_3d<f32>;
@group(0) @binding(6) var sliceVol:texture_3d<f32>;
@group(0) @binding(7) var smp:sampler;
@group(0) @binding(8) var smpE:sampler;
${lightingWGSL()}
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
// the slice fill's lit look (the plane's normal turned to the viewer: the cut face of a tissue-look segment), the rest keep col
fn sliceLook(p:vec3<f32>,col:vec3<f32>,si:i32,rd:vec3<f32>,ro:vec3<f32>)->vec3<f32>{
 let m=u.segM[si];
 if(m.w<0.5||m.w>3.5){return col;}
 var bi=0;var bd=1.0e30;
 for(var i=0;i<SECTION_PLANES;i++){if(i>=u.planeCount){break;}let dd=abs(dot(u.cutPlanes[i].xyz,p)-u.cutPlanes[i].w);if(dd<bd){bd=dd;bi=i;}}
 return vrlRealCut(col,u.cutPlanes[bi].xyz,-rd,u.lightOff,vrlDepth01(dot(p-ro,rd),ro,u.halfExt));
}
// the CT slice on a section plane (rgb, a): transparent at or below sliceAir, tinted where a shown segment is, or only the segments' region at 0 % opacity
fn sliceColor(p:vec3<f32>,rd:vec3<f32>,ro:vec3<f32>)->vec4<f32>{
 let hu=sliceHU(p);let a=smoothstep(u.sliceAir,u.sliceAir+10.0,hu);
 if(u.sliceSegOnly>0.5){
  var si=-1;if(u.ctShade>0.5||u.sliceTint>0.0){si=segIdxAt(texCoord(p));}
  if(si<0){return vec4<f32>(0.0);}
  var sr=vec4<f32>(u.segC[si].rgb*ctLumHU(hu,si),select(u.sliceTint,SEG_ALPHA,u.ctShade>0.5));
  sr=vec4<f32>(sliceLook(p,sr.rgb,si,rd,ro),sr.a);return sr;
 }
 if(a<=0.0){return vec4<f32>(0.0);}
 let g=clamp((hu-(u.sliceWindow.x-0.5*u.sliceWindow.y))/max(u.sliceWindow.y,1.0e-3),0.0,1.0);
 if(u.sliceTint>0.0){let si=segIdxAt(texCoord(p));if(si>=0){return vec4<f32>(mix(vec3<f32>(g),u.segC[si].rgb*ctLumHU(hu,si),vec3<f32>(u.sliceTint)),a);}}
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
 if(s>=0&&((u.editMask>>u32(s))&1)==1){
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
 let o=u.origin;let dir=normalize(in.vPos-u.origin);
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
 let t0=t;var jumpLen=0.0;var hitEnd=false;
 var prevValid=false;var prevF=0.0;
 var prevSkip=false;var skBlk=vec3<i32>(-1);var skBits=vec2<u32>(0u);
 var chk=false; // the creep check is made only while the ray is near a surface (see below): false at the ray start and after a jump
 var hitIdx=-1;var hitLo=0.0;var hitHi=0.0;var hitF0=0.0;var hitF1=0.0;var hitIso=false;var hitSimple=false;var hitNb=6;
 // per-ray constants: one-hot channel selectors per segment (no dynamic indexing of the fetched vector inside the march); a disabled segment's offset is SEG_OFF
 var sel0=${FM4}(0.0);var sel1=${FM4}(0.0);var sel2=${FM4}(0.0);var sel3=${FM4}(0.0);var off0=SEG_OFF;var off1=SEG_OFF;var off2=SEG_OFF;var off3=SEG_OFF;
 {let c=u.clsChan[0];if(c>=0&&u.segA[0].w>0.5){sel0[c]=${FM}(1.0);off0=${FM}(0.0);}}
 {let c=u.clsChan[1];if(c>=0&&u.segA[1].w>0.5){sel1[c]=${FM}(1.0);off1=${FM}(0.0);}}
 {let c=u.clsChan[2];if(c>=0&&u.segA[2].w>0.5){sel2[c]=${FM}(1.0);off2=${FM}(0.0);}}
 {let c=u.clsChan[3];if(c>=0&&u.segA[3].w>0.5){sel3[c]=${FM}(1.0);off3=${FM}(0.0);}}
 let skipOn=u.useSkip>0&&u.diag!=4;
 for(var iter=0;iter<4096;iter++){
  if(t>endT||acc.a>ACC_STOP){break;}
  iters++;
${EV(`  // slices up to t + step, then the cut face, then the sample (the order of the WebGL loop)
  while(nextSlice<nSlice&&sliceT[nextSlice]<=t+stp){
   let sc=sliceColor(o+dir*sliceT[nextSlice],dir,o);nextSlice++;
   let contribution=(1.0-acc.a)*u.sliceOpacity*sc.a;acc=vec4<f32>(acc.rgb+sc.rgb*contribution,acc.a+contribution);
  }
  if(capT>=0.0){
   let cp=o+dir*capT;let capAt=capT;let ci=segIdxAt(texCoord(cp));capT=-1.0;
   if(ci>=0){
    let n=u.cutPlanes[capPlane].xyz;let viewDir=-dir;
    let lit=vrlRealCut(mix(u.segC[ci].rgb,vec3<f32>(1.0),vec3<f32>(0.22)),n,viewDir,u.lightOff,vrlDepth01(capAt,o,u.halfExt));
    let contribution=(1.0-acc.a)*clamp(u.segA[ci].z,0.03,1.0);acc=vec4<f32>(acc.rgb+lit*contribution,acc.a+contribution);depthMark(capAt,contribution);
    lastIndex=ci;previousT=t;t+=stp;continue;
   }
  }
`)}
  // the creep skip: the sample's trilinear footprint is the dual cell fl..fl+1; its bit says "outside every shown segment, alpha <= 2": no fetch, no jump, move on (prevF is fetched at previousT only if a hit follows)
  // The bit is looked up only when chk: the previous sample was read with dd < 2.7 (no jump: near a surface) or was a creep step. At the ray start and right after a jump (the 4^3 block has changed, so
  // the lookup would cost a dependent skipTex read before the cls read) the sample is read as usual. Exactness (the contract of vr-skip-occupancy.js: a set bit means the read would find no segment and
  // dd <= 2, no jump): a sample read instead of skipped sets lastIndex = -1, prevValid = true, previousT = t, t += stp, exactly as the skip does; only prevSkip / prevF differ, and prevSkip = true only
  // makes the hit path fetch prevF at previousT, the same sample, so a hit, its bracket (hitLo, hitHi), hitNb, hitIso and the secant's outside value are those of the skip
  if(skipOn&&chk){
   let pp=(tcO+tcD*t)*u.texDims-vec3<f32>(0.5);let fl=floor(pp);let fr=pp-fl;
   if(all(fr>vec3<f32>(1.0/64.0))&&all(fr<vec3<f32>(63.0/64.0))&&all(fl>=vec3<f32>(0.0))&&all(fl<u.texDims-vec3<f32>(1.0))){
    let sc=vec3<i32>(fl);let sb=sc>>vec3<u32>(2u);
    if(any(sb!=skBlk)){skBlk=sb;skBits=textureLoad(skipTex,sb,0).rg;}
    let sl=sc&vec3<i32>(3);let sbit=sl.x+(sl.y<<2u)+(sl.z<<4u);
    let sw=select(skBits.y,skBits.x,sbit<32);
    if(((sw>>u32(sbit&31))&1u)!=0u){prevValid=true;prevSkip=true;lastIndex=-1;previousT=t;t+=stp;continue;}
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
  chk=dd<2.7;
  // a jump is never shorter than a normal step; it lands on the same t0 + k * step grid
  if(dd>=2.7){let nextJ=t+stp*max(1.0,floor((dd-1.8)*jkA/stp));jumpLen+=nextJ-t;previousT=nextJ-stp*0.05;prevValid=false;t=nextJ;continue;}
  ${C4('q', 'tcS')}
  let qc=${FM4}(q-vec4<f32>(0.5));
  let f0=dot(qc,sel0)-off0;let f1=dot(qc,sel1)-off1;let f2=dot(qc,sel2)-off2;let f3=dot(qc,sel3)-off3;
  var idx=-1;var curF:${FM}=${FM}(-1.0);
  if(f0>=${FM}(0.0)){idx=0;curF=f0;}else if(f1>=${FM}(0.0)){idx=1;curF=f1;}else if(f2>=${FM}(0.0)){idx=2;curF=f2;}else if(f3>=${FM}(0.0)){idx=3;curF=f3;}
  if(idx!=lastIndex){
   if(idx>=0){
    if(prevSkip&&prevValid){
     var qp=textureSampleLevel(clsTex,smp,cl(tcO+tcD*previousT),0.0);${C4('qp', '(tcO+tcD*previousT)')}
     let qpc=${FM4}(qp-vec4<f32>(0.5));
     let g0=dot(qpc,sel0)-off0;let g1=dot(qpc,sel1)-off1;let g2=dot(qpc,sel2)-off2;let g3=dot(qpc,sel3)-off3;
     prevF=f32(max(max(g0,g1),max(g2,g3)));
    }
    // segments are always opaque in VR: every hit ends the ray and is searched and shaded after the loop
    let simple=u.diag==3||u.segC[idx].w>0.5;
    hitIso=u.refine==1&&((u.editMask>>u32(idx))&1)==0&&prevValid&&prevF<0.0;
    hitIdx=idx;hitLo=previousT;hitHi=t;hitF0=prevF;hitF1=f32(curF);hitSimple=simple;hitNb=select(2,6,prevValid);lastIndex=idx;break;
   }
   lastIndex=idx;
  }
  prevSkip=false;prevValid=true;prevF=select(f32(max(max(f0,f1),max(f2,f3))),f32(curF),idx>=0);
  previousT=t;t+=stp;
 }
 if(hitIdx>=0){
  let idx=hitIdx;var lo=hitLo;var hi=hitHi;var f0=hitF0;var f1=hitF1;let cIdx=u.clsChan[idx];
  if(hitSimple){}
  else if(hitIso){ // two secant guesses and one bisection on the interpolated class value
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
    if(inside){hi=mid;}else{lo=mid;}
   }
  }
  let hp=o+dir*hi;let tc=texCoord(hp);
  let onFace=!hitSimple&&hi<=faceEnd;
  var n=-dir;
  if(!hitSimple){if(onFace){n=entryFaceNormal(o,dir);}else{n=gradientAtS(tc,idx);}}
  let viewDir=normalize(o-hp);let later=acc.a>0.0&&!hitSimple&&!onFace;
  let nn=select(n,select(n,-n,gHuMean<0.5*(u.segA[idx].x+u.segA[idx].y)),later);
  let shade=vrlShade(nn,viewDir,u.lightOff,vrlDepth01(hi,o,u.halfExt),select(0.0,1.0,later),u.segM[idx].xyz);
  let alpha=clamp(u.segA[idx].z,0.03,1.0);
  let lit=u.segC[idx].rgb*shade.x+vec3<f32>(shade.y);
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
// the eight u32 a counting pixel writes (index in the pixel's record); a pixel the pass did not cover keeps 0 (the buffer is cleared before the pass)
export const COUNTER_FIELDS = ['outcome', 'iters', 'creep', 'jumps', 'skipReads', 'clsReads', 'refineReads', 'gradReads'];
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
      + 'const CNT_W:u32=64u;\n@group(1) @binding(0) var<storage,read_write> cnt:array<u32>;\n');
    t = sub(t, 'if(acc.a<0.004){discard;return fo;}', 'if(acc.a<0.004){return fo;}');
    const early = t.split('discard;').length - 1;
    if (early < 3 || early > 4) throw new Error('volumeWgsl: ' + early + ' early discards');
    t = t.split('discard;').join('gOut=4u;');
    t = sub(t, 'iters++;', 'iters++;gIters+=1u;');
    t = sub(t, 'prevValid=true;prevSkip=true;lastIndex=-1;', 'gCreep+=1u;prevValid=true;prevSkip=true;lastIndex=-1;');
    t = sub(t, 'jumpLen+=nextJ-t;', 'jumpLen+=nextJ-t;gJumps+=1u;');
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
    t += '@fragment fn fs(in:VOut)->FOut{\n let fo=fsMain(in);\n let b=(u32(in.pos.y)*CNT_W+u32(in.pos.x))*8u;\n cnt[b]=gOut;cnt[b+1u]=gIters;cnt[b+2u]=gCreep;cnt[b+3u]=gJumps;cnt[b+4u]=gSkipRd;cnt[b+5u]=gClsRd;cnt[b+6u]=gRefRd;cnt[b+7u]=gGradRd;\n return fo;\n}\n';
  }
  return t.replace(/(\/\/ VR \/ AR volume pass \(WGSL\), variant [^\n]*)\n/, '$1 abl=' + (abl || 'none') + ' counters=' + counters + '\n');
}
// the WGSL of one variant; abl / counters only for the performance record's breakdown (see above): with the defaults the text is the display variant's, character for character
export function volumeWgsl({ f16 = false, cls4 = false, events = true, abl = '', counters = false } = {}) {
  const t = volumeWgslBase({ f16, cls4, events });
  return abl || counters ? ablate(t, abl, counters) : t;
}
