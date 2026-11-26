// The feature axis of the WGSL texts of the volume pass (the m6 plan): the pieces of the WebGL program that the core text (docs/vr-wgsl-core.js) did not have, as text that is put into the core at fixed places.
//   feat = null (or every flag false) : the core text as it always was, byte for byte (tests/unit/wgsl-text-hash.test.js)
//   feat.R : the analysis results (the colour of a result on a surface, a result hidden)  = the GLSL define VRL_REGIONS
//   feat.C : the child segments (their colour, material, opacity, flat mode, hidden)       = VRL_CHILDREN
// R or C also compiles the hiding code (VRL_HIDE): a hit on a hidden voxel is no hit, the cut a hidden part leaves is lit by the part's border. Nothing here changes how many samples a ray takes: the programs of the display's ways
// (docs/vr-wgpu-newpath.js, vr-wgpu-marks.js, vr-wgpu-coarse-march.js) are made from the core text by substitutions at anchors that this text does not touch, so every way exists for every feat.
// The look-up tables are uniform buffers of their own (regionLut 256 x vec4 = 4 KB, childLut 3 rows x 256 x vec4 = 12 KB: texel i of row r at index r * 256 + i, the layout of the WebGL textures), the index textures are RG8 (R = the colour index,
// G = the hide index) read with textureLoad at the texel the nearest-filtered WebGL read finds. The uniform struct gets the members of FEAT_FIELDS after the core's own (every offset of the core's members stays).
//   feat.P (with R or C): the detached parts (the GLSL define VRL_PART, docs/vr-part-view.js PART_GLSL): the hidden tests of the march and of hideAt read the part's field (partKind 0 = the body while parts are out, 1 = a result's part,
//     2 = a child's part), the cut is lit by the field's gradient, and a ray leaves out the 8^3 blocks of the field where nothing can be a hit (partOcc). Binding 15 is the field, 16 its blocks.
//   R or C without P also lights a cut BAKED into the combined bytes by the parts' field (the GLSL VRL_BAKE_CUT: bakeCut, bakeField at binding 15); the general loop and a frame with a diagnostic (the WebGL 'full' program) do not.
// Every feature text declares all the members (one layout for the packer); a member a text does not read is never read.
export const FEAT_FIELDS = [['regionAnyHidden', 'i32'], ['childAnyHidden', 'i32'], ['hideVMode', 'i32'], ['pad2', 'i32'],
  ['bakeCut', 'i32'], ['partKind', 'i32'], ['partId', 'i32'], ['partMask', 'i32'],
  ['bakeFieldScale', 'vec3f'], ['bakeFieldOff', 'vec3f'], ['partFieldScale', 'vec3f'], ['partFieldOff', 'vec3f'],
  ['bakeFieldA', 'vec4f', 4], ['bakeFieldB', 'vec4f', 4], ['partFieldA', 'vec4f', 4], ['partFieldB', 'vec4f', 4]];
export const FEAT_BINDINGS = { regionTex: 10, childTex: 11, regionLut: 12, childLut: 13, field: 15, partOcc: 16 }; // field: the parts' field (a P text) or the baked cut's (an R / C text without P)
export const REGION_LUT_VEC4 = 256, CHILD_LUT_VEC4 = 768; // the uniform arrays' lengths (the table's rows: 1 and 3)

export const featOf = f => (f && (f.R || f.C) ? { R: !!f.R, C: !!f.C, ...(f.T && f.C ? { T: true } : {}), ...(f.P ? { P: true } : {}) } : null); // T (with C only): the non-opaque march of the WebGL 'full' program (a child's opacity below 1 lets the ray go on); P: the parts' programs
// the feature of a frame's uniforms: the index textures of the results / the child segments are real ones (the dummy of a data set without them is 1 x 1 x 1)
// (P: the uniforms are a part's or the body's while parts are out: they have the part's field, docs/vr-part-view.js PART_EXTRA)
export const featOfUniforms = u => { const real = t => !!t && t.isData3DTexture === true && (t.image?.width | 0) > 1; return featOf({ R: real(u?.regionTex?.value), C: real(u?.childTex?.value), P: !!u?.partField }); };
export const featKey = f => (f && (f.R || f.C) ? (f.R ? 'R' : '') + (f.C ? 'C' : '') + (f.T && f.C ? 'T' : '') + (f.P ? 'P' : '') : '-');

// the strings put into the core (all '' / the core's own expressions for no feat). Each piece of text has its own line ends and is put at the start of a line of the core.
export function featParts(feat) {
  const f = featOf(feat);
  if (!f) return { on: false, T: false, P: false, fields: [], bind: '', fns: '', init: '', hidInit: '', segA: 'u.segA', segM: 'u.segM', col: (p, base) => base, vis: e => e, lum: (p, hu, si) => `ctLumHU(${hu},${si})`, look: '', bake: '', rgH: 'regionHiddenAt', chH: 'childHiddenAt' };
  const R = f.R, C = f.C, T = !!f.T, P = !!f.P;
  const sizeTex = C ? 'childTex' : 'regionTex';
  const bind = (R ? `@group(0) @binding(${FEAT_BINDINGS.regionTex}) var regionTex:texture_3d<f32>;\n@group(0) @binding(${FEAT_BINDINGS.regionLut}) var<uniform> regionLut:array<vec4<f32>,${REGION_LUT_VEC4}>;\n` : '')
    + (C ? `@group(0) @binding(${FEAT_BINDINGS.childTex}) var childTex:texture_3d<f32>;\n@group(0) @binding(${FEAT_BINDINGS.childLut}) var<uniform> childLut:array<vec4<f32>,${CHILD_LUT_VEC4}>;\n` : '')
    + (P ? `@group(0) @binding(${FEAT_BINDINGS.field}) var partField:texture_3d<f32>;\n@group(0) @binding(${FEAT_BINDINGS.partOcc}) var partOcc:texture_3d<f32>;\n` : `@group(0) @binding(${FEAT_BINDINGS.field}) var bakeField:texture_3d<f32>;\n`);
  const idxFn = (name, tex) => `fn ${name}(tc:vec3<f32>)->vec2<i32>{let d=vec3<f32>(textureDimensions(${tex}));let q=textureLoad(${tex},vec3<i32>(clamp(tc,vec3<f32>(0.0),vec3<f32>(0.999999))*d),0);return vec2<i32>(i32(q.r*255.0+0.5),i32(q.g*255.0+0.5));}\n`;
  // gSegA / gSegM (below): the per-fragment copies of segA / segM; a child's own opacity and material are written into them by childLook, the shown look is read through them
  let fns = `// ---- the results (R) and the child segments (C) of the WebGL program (docs/vr-view.js, the VRL_REGIONS / VRL_CHILDREN blocks) and hiding (VRL_HIDE) ----\n`
    + (C ? `var<private> gSegA:array<vec4<f32>,4>;var<private> gSegM:array<vec4<f32>,4>;\n` : '');
  if (R) {
    fns += idxFn('rIdx', 'regionTex')
      + `fn regionColor(p:vec3<f32>,base:vec3<f32>,s:i32)->vec3<f32>{
 let ij=rIdx(texCoord(p));let i=ij.x;
 if(i<1){return base;}
 var e=regionLut[i];
 if(u.regionAnyHidden!=0&&((i32(e.a+0.5)>>u32(8+s))&1)==1){let j=ij.y;if(j<1||j==i){return base;}e=regionLut[j];}
 return select(base,e.rgb,((i32(e.a+0.5)>>u32(s))&1)==1);
}
fn regionHiddenAt(tc:vec3<f32>,s:i32)->bool{
 let i=rIdx(tc).y;if(i<1){return false;}
 return ((i32(regionLut[i].a+0.5)>>u32(8+s))&1)==1;
}
fn regionVis(p:vec3<f32>,si:i32)->i32{if(si<0||u.regionAnyHidden==0){return si;}if(regionHiddenAt(texCoord(p),si)){return -1;}return si;}
`;
  }
  if (C) {
    fns += idxFn('cIdx', 'childTex')
      + `fn childBase(p:vec3<f32>,base:vec3<f32>,s:i32)->vec3<f32>{
 let ij=cIdx(texCoord(p));let i=ij.x;
 if(i<1){return base;}
 var e=childLut[i];
 if(((i32(e.a+0.5)>>u32(s))&1)==0&&((i32(childLut[256+i].a+0.5)>>u32(s))&1)==1){let j=ij.y;if(j<1||j==i){return base;}e=childLut[j];}
 return select(base,e.rgb,((i32(e.a+0.5)>>u32(s))&1)==1);
}
fn childHiddenAt(tc:vec3<f32>,s:i32)->bool{
 let i=cIdx(tc).y;if(i<1){return false;}
 return ((i32(childLut[256+i].a+0.5)>>u32(s))&1)==1;
}
fn childVis(p:vec3<f32>,si:i32)->i32{if(si<0){return si;}if(childHiddenAt(texCoord(p),si)){return -1;}return si;}
fn childLookIdAt(tc:vec3<f32>,s:i32)->i32{
 let ij=cIdx(tc);let i=ij.x;
 if(i>=1&&((i32(childLut[i].a+0.5)>>u32(s))&1)==0&&((i32(childLut[256+i].a+0.5)>>u32(s))&1)==1){let j=ij.y;return select(j,0,j==i);}
 return i;
}
fn childLook(ci:i32,s:i32){
 if(ci>0&&((i32(childLut[ci].a+0.5)>>u32(s))&1)==1){let m=childLut[512+ci];gSegA[s].z=m.w;gSegM[s]=vec4<f32>(m.xyz,0.0);}
 else{gSegA[s].z=u.segA[s].z;gSegM[s]=u.segM[s];}
}
fn ctLumAt(p:vec3<f32>,hu:f32,s:i32)->f32{
 let i=cIdx(texCoord(p)).x;
 if(i<1){return ctLumHU(hu,s);}
 if(((i32(childLut[i].a+0.5)>>u32(s))&1)==0){return ctLumHU(hu,s);}
 let e=childLut[256+i];
 if(u.ctShade<0.5||u.diag==3||((i32(e.b+0.5)>>u32(s))&1)==1){return 1.0;}
 let t=clamp((hu-e.x)/max(e.y-e.x,1.0e-3),0.0,1.0);
 let g=1.0/max(u.ctShadeBright,0.1);let l=pow(mix(CT_SHADE_MIN,1.0,t),g);
 if(u.ctShadeContrast==1.0){return l;}
 let p0=0.5*(pow(CT_SHADE_MIN,g)+1.0);return clamp(p0+(l-p0)*u.ctShadeContrast,0.05,1.0);
}
`;
  }
  // the field of a cut (read LINEAR, 0.5 = the cut, 0 outside its box): slot s is cut where min over the channels of A[s] * texel + B[s] is >= 0.5 (docs/vr-part-view.js partFieldSet)
  const fieldFn = (name, tex, pre) => `fn ${name}(tc:vec3<f32>,a:vec4<f32>,b:vec4<f32>)->f32{
 let uu=tc*u.${pre}Scale+u.${pre}Off;if(any(uu<vec3<f32>(0.0))||any(uu>vec3<f32>(1.0))){return 0.0;}
 let m=textureSampleLevel(${tex},smp,uu,0.0)*a+b;return min(min(m.x,m.y),min(m.z,m.w));
}
`;
  // the field's gradient over one voxel of the index grid (central differences, object space)
  const fieldGrad = fn => `vec3<f32>(${fn}(tc+vec3<f32>(d.x,0.0,0.0),a,b)-${fn}(tc-vec3<f32>(d.x,0.0,0.0),a,b),${fn}(tc+vec3<f32>(0.0,d.y,0.0),a,b)-${fn}(tc-vec3<f32>(0.0,d.y,0.0),a,b),${fn}(tc+vec3<f32>(0.0,0.0,d.z),a,b)-${fn}(tc-vec3<f32>(0.0,0.0,d.z),a,b))`;
  const voxD = ` let d=1.0/max(vec3<f32>(textureDimensions(${sizeTex})),vec3<f32>(1.0));\n`;
  if (P) { // the hidden tests of the parts' programs (PART_GLSL regionHiddenAtP / childHiddenAtP): the march's hidden tests and hideAt call these; regionVis / childVis (the slices, the cut face) keep the ones above, as in the WebGL program
    fns += `// ---- the detached parts (feat.P = VRL_PART, docs/vr-part-view.js PART_GLSL) ----
${fieldFn('partFieldAt', 'partField', 'partField')}fn partFieldIn(tc:vec3<f32>,s:i32)->bool{return partFieldAt(tc,u.partFieldA[s],u.partFieldB[s])>=0.5;}
` + (R ? `fn regionHiddenAtP(tc:vec3<f32>,s:i32)->bool{
 let f=u.partKind!=2&&partFieldIn(tc,s);
 if(u.partKind==1&&!f){return true;}
 let i=rIdx(tc).y;
 var a=0;if(i>=1){a=i32(regionLut[i].a+0.5);}
 let h=((a>>u32(8+s))&1)==1;
 if(u.partKind!=0){return h;}
 if(((a>>16u)&1)==1){return f;}
${C ? '' : ' if(f){return true;}\n'} return h;
}
` : '') + (C ? `fn childHiddenAtP(tc:vec3<f32>,s:i32)->bool{
 let f=u.partKind!=1&&partFieldIn(tc,s);
 if(u.partKind==2&&!f){return true;}
 let i=cIdx(tc).y;
 var a=0;if(i>=1){a=i32(childLut[256+i].a+0.5);}
 let h=((a>>u32(s))&1)==1;
 if(u.partKind!=0){return h;}
 if(((a>>8u)&1)==1){return f;}
 return f||h;
}
fn chIdxP(tc:vec3<f32>)->vec2<i32>{return cIdx(tc);}
` : '');
  } else { // the baked cut's light (VRL_BAKE_CUT bakeGrad): the parts' field where the hit is within 0.08 of its 0.5 level, pointing into the cut; 0 elsewhere
    fns += `${fieldFn('bakeFieldAt', 'bakeField', 'bakeField')}fn bakeGrad(tc:vec3<f32>,s:i32)->vec3<f32>{
${voxD} let a=u.bakeFieldA[s];let b=u.bakeFieldB[s];if(abs(bakeFieldAt(tc,a,b)-0.5)>=0.08){return vec3<f32>(0.0);}
 let g=${fieldGrad('bakeFieldAt')};
 let vx=2.0*u.halfExt*d;return vec3<f32>(g.x/max(vx.x,1.0e-6),-g.y/max(vx.y,1.0e-6),g.z/max(vx.z,1.0e-6));
}
`;
  }
  const rgH = P ? 'regionHiddenAtP' : 'regionHiddenAt', chH = P ? 'childHiddenAtP' : 'childHiddenAt';
  fns += (R && C ? 'fn colAt(p:vec3<f32>,base:vec3<f32>,s:i32)->vec3<f32>{return regionColor(p,childBase(p,base,s),s);}\n' : R ? 'fn colAt(p:vec3<f32>,base:vec3<f32>,s:i32)->vec3<f32>{return regionColor(p,base,s);}\n' : 'fn colAt(p:vec3<f32>,base:vec3<f32>,s:i32)->vec3<f32>{return childBase(p,base,s);}\n')
    + `fn hideFieldOk()->bool{return ${P ? 'u.partKind==0&&' : ''}u.hideVMode>0;}
fn hideAnyOn()->bool{
${R ? ' if(u.regionAnyHidden!=0){return true;}\n' : ''}${C ? ' if(u.childAnyHidden!=0){return true;}\n' : ''} return false;
}
fn hideAt(tc:vec3<f32>,s:i32)->bool{
${C ? ` if(${chH}(tc,s)){return true;}\n` : ''}${R ? ` if(u.regionAnyHidden!=0&&${rgH}(tc,s)){return true;}\n` : ''} return false;
}
// the gradient of the hidden indicator over one voxel of the index grid (central differences, pointing INTO the hidden part, object space): the cut a hidden part leaves is lit by it
fn hideGrad(tc:vec3<f32>,s:i32)->vec3<f32>{
 let d=1.0/max(vec3<f32>(textureDimensions(${sizeTex})),vec3<f32>(1.0));
${P ? ` { // at the cut of a part (the field near its 0.5 level) the field's gradient, pointing into what is hidden (its rise in the body, its fall in a part)
  let a=u.partFieldA[s];let b=u.partFieldB[s];let f0=partFieldAt(tc,a,b);
  if(abs(f0-0.5)<0.08){var g=${fieldGrad('partFieldAt')};
   if(u.partKind!=0){g=-g;}let vx=2.0*u.halfExt*d;return vec3<f32>(g.x/max(vx.x,1.0e-6),-g.y/max(vx.y,1.0e-6),g.z/max(vx.z,1.0e-6));}
 }
` : ''} var g=vec3<f32>(0.0);
 for(var a=0;a<6;a++){
  var e=vec3<f32>(0.0,0.0,1.0);if(a<2){e=vec3<f32>(1.0,0.0,0.0);}else if(a<4){e=vec3<f32>(0.0,1.0,0.0);}
  let pos=(a&1)==0;
  if(hideAt(select(tc-e*d,tc+e*d,pos),s)){g+=select(-e,e,pos);}
 }
 let voxel=2.0*u.halfExt*d;
 return vec3<f32>(g.x/max(voxel.x,1.0e-6),-g.y/max(voxel.y,1.0e-6),g.z/max(voxel.z,1.0e-6));
}
`;
  // the visible-segment test of a slice pixel / the cut face: a hidden result / child has no fill (R: regionVis, C: childVis)
  const vis = (e, p) => (R && C ? `childVis(${p},regionVis(${p},${e}))` : R ? `regionVis(${p},${e})` : `childVis(${p},${e})`);
  return {
    on: true, R, C, T, P, rgH, chH, fields: FEAT_FIELDS,
    // the baked cut's normal, first in gradientAtS (a text without P; a frame with a diagnostic draws the WebGL 'full' program, which has none: diag 0 only)
    bake: P ? '' : ' if(u.diag==0&&s>=0&&((u.bakeCut>>u32(s))&1)==1){let bn=bakeGrad(tc,s);if(dot(bn,bn)>0.0){gHuMean=1.0e9;return normalize(bn);}}\n', bind, fns, segA: C ? 'gSegA' : 'u.segA', segM: C ? 'gSegM' : 'u.segM', lum: (p, hu, si) => (C ? `ctLumAt(${p},${hu},${si})` : `ctLumHU(${hu},${si})`),
    init: C ? ' for(var i=0;i<4;i++){gSegA[i]=u.segA[i];gSegM[i]=u.segM[i];}\n' : '', // per fragment, at the start of fs
    // the first sample of the ray in a hidden part (a hidden cap point, the eye inside the box): no jump from it either, as from a sample after a hidden one. Tested once per ray, only while something is hidden
    hidInit: ' var prevHid=false;var hitHid=false;\n if(hideAnyOn()){let tcH=tcO+tcD*t;let si=segIdxAt(tcH);if(si>=0&&hideAt(tcH,si)){prevHid=true;}}\n',
    col: (p, base, s) => `colAt(${p},${base},${s})`,
    vis,
    look: C ? 'childLook(childLookIdAt(texCoord(p),si),si);\n ' : '',
  };
}
