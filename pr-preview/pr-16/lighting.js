// One lighting model for every 3D view: the desktop WebGPU volume (medical-volume.js), the VR / AR volume (vr-view.js) and the
// 3D-view surface meshes (app.js, three.js lights). Before this the two volume shaders lit a surface with a light offset given in VOLUME
// coordinates (0.35, 0.5, 0.25): it turned with the volume, so a grabbed / flipped volume was lit from below (shadow on top), and
// abs(dot(n, l)) lit back faces as bright as front faces (far surfaces glowed).
//
//  - the light is a headlight a little above and to the right of the viewer: the direction to the light is
//    normalize(viewDir + LIGHT_UP * cameraUp + LIGHT_RIGHT * cameraRight); cameraUp / cameraRight are the VIEWER's axes (desktop camera /
//    the eye of the headset), brought into volume space every frame, so turning the volume never turns the light;
//  - one-sided diffuse: diffuse = AMBIENT + (1 - AMBIENT) * max(dot(n, l), 0); the ambient floor keeps every surface visible. The HU gradient has
//    no fixed orientation (it points INTO a segment at its lower threshold and OUT of it at the upper one), so for the first surface a ray meets
//    the normal is turned to face the viewer. Honest note: with a light this close to the view direction that is about what abs() did for a surface
//    that faces the viewer anyway; the one-sidedness only changes the picture where the outward normal faces AWAY from the viewer. That is the
//    case for a hit BEHIND a translucent layer (acc.a > 0) whose boundary the ray leaves (an inner / far wall): such a hit is shaded with the
//    OUTWARD normal of its segment (desktop: -inward from the previous sample's side of the range, VR: the side of the range the local mean HU is
//    on), never turned round, so an inner wall that faces away gets only the ambient floor instead of glowing like a front face (vrlShade keep = 1);
//  - Blinn-Phong highlight SPEC * pow(max(dot(n, h), 0), SHININESS);
//  - mild depth cue: diffuse and highlight are scaled by 1 - DEPTH_FADE * depth01, depth01 = 0 at the near side of the volume's bounding
//    sphere and 1 at its far side (measured along the ray from the eye: no extra texture fetch, no second ray);
//  - the surface meshes of the 3D view evaluate the SAME formula in their material (meshColorNode for WebGPU node materials, patchStandardFragment
//    for the WebGL fallback) with the light fixed in view space, and no scene lights: the volumes write display values, so the mesh result is
//    brought to linear with pow(., DISPLAY_GAMMA) and the sRGB output encoding gives back the same numbers (the same highlight, the same depth cue).
// The shader helpers below are generated from these constants (one source for all languages); shadePoint() is the same arithmetic in JS
// (unit tests, and the reference for the mesh material).
// per-segment material presets (MATERIALS): AMBIENT / SPEC / SHININESS are the 'standard' preset; vrlShade takes them as an argument
// mat = vec3(ambient, spec, shininess) per segment (the desktop uniform u.segMat, the VR uniform segM, the mesh uniform per segment); the light
// direction and DEPTH_FADE stay shared constants.
export const LIGHT_UP = 0.5;
export const LIGHT_RIGHT = 0.3;
export const AMBIENT = 0.28;
export const SPEC = 0.18;
export const SHININESS = 20;
export const DEPTH_FADE = 0.2;
// material presets of a segment (ambient floor, highlight strength, highlight sharpness). standard = the constants above (the default:
// renders exactly as before); solid: crisper, more contrast; plaster: matte and soft, no highlight; plastic: a strong, sharp highlight
export const MATERIALS = {
  standard: { ambient: AMBIENT, spec: SPEC, shininess: SHININESS },
  solid: { ambient: 0.16, spec: 0.12, shininess: 16 },
  plaster: { ambient: 0.42, spec: 0, shininess: 1 },
  plastic: { ambient: 0.24, spec: 0.5, shininess: 60 },
  // kind 1..3 selects the extended model below (REAL); ambient / spec / shininess are what the plain model
  // (analysis-result overlays, the cut face) uses for the same segment
  skin: { ambient: 0.3, spec: 0.14, shininess: 30, kind: 1 },
  muscle: { ambient: 0.26, spec: 0.3, shininess: 60, kind: 2 },
  fat: { ambient: 0.36, spec: 0.2, shininess: 30, kind: 3 },
};
export const MATERIAL_KEYS = Object.keys(MATERIALS);
// a preset key as stored on a segment (unknown / missing -> 'standard')
export const materialKey = k => (Object.prototype.hasOwnProperty.call(MATERIALS, k) ? k : 'standard');
// [ambient, spec, shininess, kind] of a preset key; kind 0 = the plain model (standard / solid / plaster / plastic), 1..3 = the extended model (skin / muscle / fat)
export function materialVec(k) {
  const m = MATERIALS[materialKey(k)];
  return [m.ambient, m.spec, m.shininess, m.kind || 0];
}

// the extended model of the tissue looks (kind 1 = skin, 2 = muscle, 3 = fat). Same inputs as the plain model (normal, view, the headlight, the depth cue) and one
// evaluation per surface hit, no texture look-up, no second ray, no scattering / translucency (the colour changes below only tint the picture):
//  - wrapped diffuse per colour channel: d_c = clamp((n.l + wrap_c) / (1 + wrap_c), 0, 1) with wrap_R > wrap_G > wrap_B, so the light-to-shade edge is soft and the
//    shaded side drifts red (the cheap stand-in for the red of blood-rich tissue in the shade);
//  - hemisphere ambient: ambient * mix(ground, sky, 0.5 + 0.5 n.u), u = the direction of the light offset (up and a little right of the viewer: no new uniform
//    is needed in any of the four shader paths), the ground colour warm / reddish;
//  - Schlick-style rim (1 - n.v)^5 * rim * rimTint, added as light on the colour of the surface (0 for a hit behind a translucent layer, keep = 1);
//  - wet double highlight: a broad lobe plus a sharp one from ONE log2 (exp2(log2(n.h) * shininess) twice), stronger at grazing angles (1 + 2 fres).
// diffuse light is white: diffuse = ambient colour + (1 - ambient) * d_c, lit = (colour * (diffuse + 0.5 rimC) + 0.5 rimC + spec) * depthFade.
export const REAL = {
  1: { wrap: [0.14, 0.27, 0.19], sky: [0.96, 1, 1], ground: [0.97, 0.64, 0.46], rim: 0.3, rimTint: [1, 0.9, 0.85], spec1: 0.05, sh1: 6, spec2: 0.05, sh2: 20 }, // skin
  2: { wrap: [0.12, 0.22, 0.16], sky: [0.95, 1, 0.99], ground: [0.95, 0.5, 0.4], rim: 0.14, rimTint: [1, 0.82, 0.78], spec1: 0.08, sh1: 5, spec2: 0.12, sh2: 28 }, // muscle: deep red, a broad soft highlight
  3: { wrap: [0.27, 0.37, 0.3], sky: [0.98, 1, 0.98], ground: [0.97, 0.8, 0.54], rim: 0.3, rimTint: [1, 0.95, 0.8], spec1: 0.07, sh1: 8, spec2: 0.07, sh2: 18 }, // fat: very soft, waxy, warm
};
// gloss trial: the highlight of a section's cut face / slice (vrlRealCut) as a fraction of the one on the surface: the cut face is a flat plane, a strong highlight on it would hide the CT shading
export const CUT_GLOSS = 0.5;
// and a gain on its colour: the lit cut face alone was ~10 % darker than the flat one it replaces (measured on the same view, mean of the cut face), the gain brings the mean back; CT shading stays in col
export const CUT_GAIN = 1.1;
// The older looks, kept selectable (設定 > 描画 > 質感の色味, tissueLook): the same model as REAL with the values of an earlier try. The shader's kind (the 4th number of a segment's material) then runs 1..3 = REAL (艶と断面, the
// look above, the only one with a lit cut face / slice), 4..6 = REAL_WEAK (3e5e45fd: the tints of the shade only), 7..9 = REAL_TRIAL (32bab049: the first try); 標準 = kind 0 (the plain model, the look of the app without these
// looks: the preset's ambient / spec / shininess). Only the chosen set's kinds are ever sent to a shader, the others are branches never taken.
export const REAL_WEAK = {
  1: { wrap: [0.14, 0.27, 0.19], sky: [0.96, 1, 1], ground: [0.97, 0.64, 0.46], rim: 0.3, rimTint: [1, 0.9, 0.85], spec1: 0.1, sh1: 9, spec2: 0.22, sh2: 55 },
  2: { wrap: [0.12, 0.22, 0.16], sky: [0.95, 1, 0.99], ground: [0.95, 0.5, 0.4], rim: 0.14, rimTint: [1, 0.82, 0.78], spec1: 0.16, sh1: 8, spec2: 0.55, sh2: 110 },
  3: { wrap: [0.27, 0.37, 0.3], sky: [0.98, 1, 0.98], ground: [0.97, 0.8, 0.54], rim: 0.3, rimTint: [1, 0.95, 0.8], spec1: 0.14, sh1: 12, spec2: 0.3, sh2: 45 },
};
export const REAL_TRIAL = {
  1: { wrap: [0.7, 0.42, 0.3], sky: [1, 0.97, 0.95], ground: [0.8, 0.62, 0.55], rim: 0.3, rimTint: [1, 0.82, 0.75], spec1: 0.1, sh1: 9, spec2: 0.22, sh2: 55 },
  2: { wrap: [0.55, 0.3, 0.25], sky: [1, 0.95, 0.95], ground: [0.75, 0.5, 0.48], rim: 0.14, rimTint: [1, 0.7, 0.65], spec1: 0.16, sh1: 8, spec2: 0.55, sh2: 110 },
  3: { wrap: [0.85, 0.7, 0.5], sky: [1, 1, 0.97], ground: [0.88, 0.8, 0.66], rim: 0.3, rimTint: [1, 0.92, 0.75], spec1: 0.14, sh1: 12, spec2: 0.3, sh2: 45 },
};
export const REAL_ALL = { 1: REAL[1], 2: REAL[2], 3: REAL[3], 4: REAL_WEAK[1], 5: REAL_WEAK[2], 6: REAL_WEAK[3], 7: REAL_TRIAL[1], 8: REAL_TRIAL[2], 9: REAL_TRIAL[3] };
export const REAL_KINDS = Object.keys(REAL_ALL).map(Number);
// 質感の色味 (the device setting tissueLook): standard = off (kind 0), trial / weak / gloss = the sets above; the default is standard
export const TISSUE_LOOKS = ['standard', 'trial', 'weak', 'gloss'];
export const TISSUE_LOOK_DEFAULT = 'standard';
export const tissueLookOf = v => (TISSUE_LOOKS.includes(v) ? v : TISSUE_LOOK_DEFAULT);
const LOOK_KIND_BASE = { trial: 6, weak: 3, gloss: 0 };
// the kind a preset's kind (0..3) is drawn with under a look: standard -> 0, else kind + the base of the set (REAL_ALL index)
export const tissueKindOf = (kind, look = TISSUE_LOOK_DEFAULT) => (kind > 0 && look !== 'standard' && look in LOOK_KIND_BASE ? kind + LOOK_KIND_BASE[tissueLookOf(look)] : 0);
// the look now chosen on this device (app-settings.js is on globalThis.__vrlSettings when the page / VR session has loaded it; none = the default)
export const tissueLookNow = () => tissueLookOf(globalThis.__vrlSettings?.get?.('tissueLook'));
// the kind of a MATERIALS entry as sent to a shader now
export const materialKind = m => tissueKindOf(m.kind || 0, tissueLookNow());
// the cut face / slice look (vrlRealCut) exists for REAL (1..3) only: the shader tests kind in (0.5, 3.5)
// materialVec as sent to a shader under the look chosen now (the kind 0..9 above); materialVec itself is the preset's own numbers
export function materialVecNow(k) {
  const m = MATERIALS[materialKey(k)];
  return [m.ambient, m.spec, m.shininess, materialKind(m)];
}
// JS twin of vrlReal() (kind >= 1): the lit colour [r, g, b] of a surface colour col; n, viewDir, off as in shadePoint (off = the light offset, same space as n)
export function realTone(col, n, viewDir, off, depth, keep, ambient, kind) {
  const P = REAL_ALL[kind], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const nf = !keep && dot(n, viewDir) < 0 ? [-n[0], -n[1], -n[2]] : n;
  const l = norm([viewDir[0] + off[0], viewDir[1] + off[1], viewDir[2] + off[2]]), h = norm([l[0] + viewDir[0], l[1] + viewDir[1], l[2] + viewDir[2]]);
  const nl = dot(nf, l), nv = Math.min(Math.max(dot(nf, viewDir), 0), 1), up = dot(nf, norm(off)) * 0.5 + 0.5;
  const x = 1 - nv, fres = x * x * x * x * x * (keep ? 0 : 1), lp = Math.log2(Math.max(dot(nf, h), 1e-4));
  const sp = (P.spec1 * Math.pow(2, lp * P.sh1) + P.spec2 * Math.pow(2, lp * P.sh2)) * (1 + 2 * fres), fade = 1 - DEPTH_FADE * depth;
  return [0, 1, 2].map(c => {
    const d = Math.min(Math.max((nl + P.wrap[c]) / (1 + P.wrap[c]), 0), 1), amb = ambient * (P.ground[c] + (P.sky[c] - P.ground[c]) * up), rimC = P.rimTint[c] * P.rim * fres;
    return (col[c] * (amb + (1 - ambient) * d + 0.5 * rimC) + 0.5 * rimC + sp) * fade;
  });
}

const f = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// the per-kind constants as shader statements (v3 = 'vec3' for GLSL, 'vec3<f32>' for WGSL): sets W (wrap), S (sky), G (ground), RT (rim tint), R (rim), P = (spec1, sh1, spec2, sh2)
function realParamsSrc(v3, v4) {
  const t = a => v3 + '(' + a.map(f).join(',') + ')';
  const one = p => `W=${t(p.wrap)};S=${t(p.sky)};G=${t(p.ground)};RT=${t(p.rimTint)};R=${f(p.rim)};P=${v4}(${[p.spec1, p.sh1, p.spec2, p.sh2].map(f).join(',')});`;
  return REAL_KINDS.map((i, n) => (n === REAL_KINDS.length - 1 ? `else{${one(REAL_ALL[i])}}` : `${n ? 'else ' : ''}if(k<${i + 0.5}){${one(REAL_ALL[i])}}`)).join('');
}

// direction to the light in VIEW space (x right, y up, z towards the viewer), unit length
export function viewLightDirection() {
  const x = LIGHT_RIGHT, y = LIGHT_UP, z = 1, l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
// the display gamma the volumes' numbers live in: the mesh material raises its display-referred colour to this power so that three.js's linear -> sRGB
// output encoding gives it back unchanged
export const DISPLAY_GAMMA = 2.2;
// the light offset of the meshes: three.js's view space is x right, y up (the camera only moves along z in the 3D view; the headlight is in view space)
export const VIEW_LIGHT_OFFSET = [LIGHT_RIGHT, LIGHT_UP, 0];

// light offset (volume space) from the viewer's right / up axes (both in volume space)
export function lightOffset(right, up) {
  return [right[0] * LIGHT_RIGHT + up[0] * LIGHT_UP, right[1] * LIGHT_RIGHT + up[1] * LIGHT_UP, right[2] * LIGHT_RIGHT + up[2] * LIGHT_UP];
}
// the same offset as source text for a shader: lightOffsetExpr('u.camRightTan.xyz', 'u.camUpAspect.xyz') -> 'u.camRightTan.xyz*0.3+u.camUpAspect.xyz*0.5'
export function lightOffsetExpr(rightExpr, upExpr) {
  return `${rightExpr}*${f(LIGHT_RIGHT)}+${upExpr}*${f(LIGHT_UP)}`;
}
export function depth01(t, camDist, radius) {
  return Math.min(Math.max((t - (camDist - radius)) / (2 * radius), 0), 1);
}
// JS twin of vrlShade(): { diffuse, spec } for a normal n, unit vector to the viewer, light offset (volume space). keep = false: n is turned to face the
// viewer (a first hit, whose gradient has no fixed orientation); keep = true: n is the OUTWARD normal and stays as it is (a hit behind a translucent layer).
// mat: { ambient, spec, shininess } (a MATERIALS entry; standard when omitted)
export function shadePoint(n, viewDir, off, depth, keep = false, mat = MATERIALS.standard) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const nf = !keep && dot(n, viewDir) < 0 ? [-n[0], -n[1], -n[2]] : n;
  const l = norm([viewDir[0] + off[0], viewDir[1] + off[1], viewDir[2] + off[2]]);
  const h = norm([l[0] + viewDir[0], l[1] + viewDir[1], l[2] + viewDir[2]]);
  const fade = 1 - DEPTH_FADE * depth;
  return { diffuse: (mat.ambient + (1 - mat.ambient) * Math.max(dot(nf, l), 0)) * fade, spec: mat.spec * Math.pow(Math.max(dot(nf, h), 0), mat.shininess) * fade };
}

// GLSL (VR / AR shader): vrlShade(n, viewDir, lightOff, depth01, keep, mat) -> vec2(diffuse, spec); keep > 0.5: n is an outward normal and is not turned to the
// viewer; mat = vec3(ambient, spec, shininess) of the segment (materialVec). vrlDepth01(t, o, halfBox) with t the ray parameter of the hit (the ray direction is a unit vector) and o the eye in volume space (the box is
// centred on the origin); vrlDepthD(t, dist, r): the same with the eye's distance to the centre and the bounding radius given (the meshes)
export function lightingGLSL() {
  return `// shared lighting model (lighting.js)
vec2 vrlShade(vec3 n,vec3 viewDir,vec3 lightOff,float depth01,float keep,vec3 mat){
 if(keep<0.5&&dot(n,viewDir)<0.0)n=-n;
 vec3 l=normalize(viewDir+lightOff);
 float fade=1.0-${f(DEPTH_FADE)}*depth01;
 return vec2((mat.x+(1.0-mat.x)*max(dot(n,l),0.0))*fade,pow(max(dot(n,normalize(l+viewDir)),0.0),mat.z)*mat.y*fade);
}
float vrlDepthD(float t,float dist,float r){return clamp((t-(dist-r))/(2.0*r),0.0,1.0);}
float vrlDepth01(float t,vec3 o,vec3 halfBox){return vrlDepthD(t,length(o),length(halfBox));}
// the lit colour of a surface hit of colour col for mat.w = 1..3 (the extended model of lighting.js REAL); callers use it only where mat.w > 0.5, the plain model's col * diffuse + spec stays as it was for the rest
vec3 vrlRealG(vec3 col,vec3 n,vec3 viewDir,vec3 lightOff,float depth01,float keep,vec4 mat,float gloss){
 if(keep<0.5&&dot(n,viewDir)<0.0)n=-n;
 vec3 W,S,G,RT;float R;vec4 P;float k=mat.w;
 ${realParamsSrc('vec3', 'vec4')}
 vec3 l=normalize(viewDir+lightOff);
 vec3 d=clamp((vec3(dot(n,l))+W)/(vec3(1.0)+W),0.0,1.0);
 vec3 amb=mat.x*mix(G,S,dot(n,normalize(lightOff))*0.5+0.5);
 float x=1.0-clamp(dot(n,viewDir),0.0,1.0);float x2=x*x;float fres=x2*x2*x*(1.0-keep);
 float lp=log2(max(dot(n,normalize(l+viewDir)),1e-4));
 float sp=(P.x*exp2(lp*P.y)+P.z*exp2(lp*P.w))*(1.0+2.0*fres)*gloss;
 vec3 rimC=RT*(R*fres);
 return (col*(amb+(1.0-mat.x)*d+0.5*rimC)+0.5*rimC+vec3(sp))*(1.0-${f(DEPTH_FADE)}*depth01);
}
vec3 vrlReal(vec3 col,vec3 n,vec3 viewDir,vec3 lightOff,float depth01,float keep,vec4 mat){return vrlRealG(col,n,viewDir,lightOff,depth01,keep,mat,1.0);}
// gloss trial: the same look on a section's cut face / slice: the plane normal turned to the viewer, no rim light (keep = 1), the highlight at CUT_GLOSS of the surface's
vec3 vrlRealCut(vec3 col,vec3 n,vec3 viewDir,vec3 lightOff,float depth01,vec4 mat){if(dot(n,viewDir)<0.0)n=-n;return vrlRealG(col,n,viewDir,lightOff,depth01,1.0,mat,${f(CUT_GLOSS)})*${f(CUT_GAIN)};}
`;
}
// GLSL vertex stage (VR / AR): the statement that sets vLightOff (volume space) from the eye's axes. viewMatrix is the eye's (per eye in XR);
// camera right / up are its rotation's rows, brought into the volume's frame by the inverse model matrix, each normalised first (the model
// matrix carries the holder scale)
export function lightingVertexGLSL(invModel = 'invModel') {
  return `vLightOff=normalize(mat3(${invModel})*vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]))*${f(LIGHT_RIGHT)}+normalize(mat3(${invModel})*vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]))*${f(LIGHT_UP)};`;
}
// WGSL (desktop WebGPU volume): same functions
export function lightingWGSL() {
  return `// shared lighting model (lighting.js)
fn vrlShade(n0:vec3<f32>,viewDir:vec3<f32>,lightOff:vec3<f32>,depth01:f32,keep:f32,mat:vec3<f32>)->vec2<f32>{
 var n=n0;if(keep<0.5&&dot(n,viewDir)<0.0){n=-n;}
 let l=normalize(viewDir+lightOff);
 let fade=1.0-${f(DEPTH_FADE)}*depth01;
 return vec2<f32>((mat.x+(1.0-mat.x)*max(dot(n,l),0.0))*fade,pow(max(dot(n,normalize(l+viewDir)),0.0),mat.z)*mat.y*fade);
}
fn vrlDepthD(t:f32,dist:f32,r:f32)->f32{return clamp((t-(dist-r))/(2.0*r),0.0,1.0);}
fn vrlDepth01(t:f32,o:vec3<f32>,halfBox:vec3<f32>)->f32{return vrlDepthD(t,length(o),length(halfBox));}
// the lit colour of a surface hit of colour col for mat.w = 1..3 (the extended model of lighting.js REAL); callers use it only where mat.w > 0.5, the plain model's col * diffuse + spec stays as it was for the rest
fn vrlRealG(col:vec3<f32>,n0:vec3<f32>,viewDir:vec3<f32>,lightOff:vec3<f32>,depth01:f32,keep:f32,mat:vec4<f32>,gloss:f32)->vec3<f32>{
 var n=n0;if(keep<0.5&&dot(n,viewDir)<0.0){n=-n;}
 var W=vec3<f32>(0.0);var S=vec3<f32>(0.0);var G=vec3<f32>(0.0);var RT=vec3<f32>(0.0);var R=0.0;var P=vec4<f32>(0.0);let k=mat.w;
 ${realParamsSrc('vec3<f32>', 'vec4<f32>')}
 let l=normalize(viewDir+lightOff);
 let d=clamp((vec3<f32>(dot(n,l))+W)/(vec3<f32>(1.0)+W),vec3<f32>(0.0),vec3<f32>(1.0));
 let amb=mat.x*mix(G,S,vec3<f32>(dot(n,normalize(lightOff))*0.5+0.5));
 let x=1.0-clamp(dot(n,viewDir),0.0,1.0);let x2=x*x;let fres=x2*x2*x*(1.0-keep);
 let lp=log2(max(dot(n,normalize(l+viewDir)),1e-4));
 let sp=(P.x*exp2(lp*P.y)+P.z*exp2(lp*P.w))*(1.0+2.0*fres)*gloss;
 let rimC=RT*(R*fres);
 return (col*(amb+(1.0-mat.x)*d+0.5*rimC)+0.5*rimC+vec3<f32>(sp))*(1.0-${f(DEPTH_FADE)}*depth01);
}
fn vrlReal(col:vec3<f32>,n0:vec3<f32>,viewDir:vec3<f32>,lightOff:vec3<f32>,depth01:f32,keep:f32,mat:vec4<f32>)->vec3<f32>{return vrlRealG(col,n0,viewDir,lightOff,depth01,keep,mat,1.0);}
fn vrlRealCut(col:vec3<f32>,n0:vec3<f32>,viewDir:vec3<f32>,lightOff:vec3<f32>,depth01:f32,mat:vec4<f32>)->vec3<f32>{var n=n0;if(dot(n,viewDir)<0.0){n=-n;}return vrlRealG(col,n,viewDir,lightOff,depth01,1.0,mat,${f(CUT_GLOSS)})*${f(CUT_GAIN)};}
`;
}

// ---- the surface meshes of the 3D view (three.js) ----
// bounding-sphere radius of the volume's box in the units of the 3D scene (the longest side is 3.3, as makeVolume3DCoordinates / the volume renderer): the radius
// the volumes use for their depth cue (length(halfExtents)), so a mesh and the volume fade over the same distance
export function boxRadius(columns, rows, slices, spacing) {
  const px = columns * spacing[0], py = rows * spacing[1], pz = slices * spacing[2], scale = 3.3 / Math.max(px, py, pz, 1e-9);
  return 0.5 * scale * Math.hypot(px, py, pz);
}
// TSL node (WebGPU node materials): the display colour of the lit surface in LINEAR working space, = pow(colour * diffuse + spec, DISPLAY_GAMMA).
// TSL is the module three/tsl passed in (this file imports nothing); depth = { center, radius } uniform nodes: the distance of the eye to the volume's centre
// and its bounding radius, updated every frame. The normal is normalView (view space, flat shading and DoubleSide handled by three.js), turned to face the viewer.
// mat = a vec4 uniform node (ambient, spec, shininess, kind) of the mesh's segment (materialVec), so the mesh matches its volume; standard when omitted.
export function meshColorNode(TSL, depth, mat = null) {
  const { materialColor, positionView, normalView, positionViewDirection, vec3, vec4, float, dot, normalize, max, pow, clamp, select, length } = TSL;
  const v = positionViewDirection, n0 = normalView;
  const n = select(dot(n0, v).lessThan(0), n0.negate(), n0);
  const l = normalize(v.add(vec3(VIEW_LIGHT_OFFSET[0], VIEW_LIGHT_OFFSET[1], VIEW_LIGHT_OFFSET[2])));
  const d = clamp(length(positionView).sub(depth.center.sub(depth.radius)).div(depth.radius.mul(2)), 0, 1);
  const fade = float(1).sub(d.mul(DEPTH_FADE));
  const amb = mat ? mat.x : float(AMBIENT), sp = mat ? mat.y : float(SPEC), sh = mat ? mat.z : float(SHININESS);
  const diffuse = amb.add(max(dot(n, l), 0).mul(float(1).sub(amb))).mul(fade);
  const spec = pow(max(dot(n, normalize(l.add(v))), 0), sh).mul(sp).mul(fade);
  const plain = materialColor.mul(diffuse).add(spec);
  // the extended model (REAL) of the tissue looks, picked by the segment's kind (mat.w); the plain result is returned untouched for kind 0
  let display = plain;
  if (mat) {
    const k = mat.w, pick = (...v) => v.reduceRight((rest, x, n) => (rest === null ? x : select(k.lessThan(REAL_KINDS[n] + 0.5), x, rest)), null);
    const V3 = key => pick(...REAL_KINDS.map(i => vec3(...REAL_ALL[i][key]))), F = key => pick(...REAL_KINDS.map(i => float(REAL_ALL[i][key])));
    const W = V3('wrap'), S = V3('sky'), G = V3('ground'), RT = V3('rimTint');
    const d = clamp(vec3(dot(n, l)).add(W).div(W.add(1)), 0, 1);
    const ambC = TSL.mix(G, S, dot(n, normalize(vec3(VIEW_LIGHT_OFFSET[0], VIEW_LIGHT_OFFSET[1], VIEW_LIGHT_OFFSET[2]))).mul(0.5).add(0.5)).mul(mat.x);
    const x = float(1).sub(clamp(dot(n, v), 0, 1)), x2 = x.mul(x), fres = x2.mul(x2).mul(x);
    const lp = TSL.log2(max(dot(n, normalize(l.add(v))), 1e-4));
    const spL = F('spec1').mul(TSL.exp2(lp.mul(F('sh1')))).add(F('spec2').mul(TSL.exp2(lp.mul(F('sh2'))))).mul(fres.mul(2).add(1));
    const rimC = RT.mul(F('rim').mul(fres));
    const real = materialColor.mul(ambC.add(d.mul(float(1).sub(mat.x))).add(rimC.mul(0.5))).add(rimC.mul(0.5)).add(spL).mul(fade);
    display = TSL.mix(plain, real, TSL.step(0.5, k));
  }
  return vec4(pow(max(display, 0), DISPLAY_GAMMA), 1);
}
// WebGL fallback (a core MeshStandardMaterial, onBeforeCompile): the fragment source of the standard material with the same evaluation in place of its
// lights (there are none in the scene). Declares the vec2 uniform vrlMeshDepth (eye distance to the centre, bounding radius) and the vec4 uniform
// vrlMeshMat (the segment's material: ambient, spec, shininess, kind). The emissive part
// (the highlight of edited / selected regions) is added after, in linear, as before.
export function patchStandardFragment(src) {
  const anchor = '#include <opaque_fragment>';
  if (!src.includes(anchor) || !src.includes('void main()')) throw new Error('lighting.js: the standard fragment shader has no opaque_fragment / main anchor');
  const code = `{ // the shared lighting model in place of the scene lights
 vec3 vrlV=normalize(vViewPosition);
 vec2 vrlS=vrlShade(normal,vrlV,vec3(${f(VIEW_LIGHT_OFFSET[0])},${f(VIEW_LIGHT_OFFSET[1])},0.0),vrlDepthD(length(vViewPosition),vrlMeshDepth.x,vrlMeshDepth.y),0.0,vrlMeshMat.xyz);
 outgoingLight=pow(max(vrlMeshMat.w>0.5?vrlReal(diffuseColor.rgb,normal,vrlV,vec3(${f(VIEW_LIGHT_OFFSET[0])},${f(VIEW_LIGHT_OFFSET[1])},0.0),vrlDepthD(length(vViewPosition),vrlMeshDepth.x,vrlMeshDepth.y),0.0,vrlMeshMat):diffuseColor.rgb*vrlS.x+vec3(vrlS.y),0.0),vec3(${f(DISPLAY_GAMMA)}))+totalEmissiveRadiance;
 }
 `;
  return src.replace('void main()', 'uniform vec2 vrlMeshDepth;\nuniform vec4 vrlMeshMat;\n' + lightingGLSL() + 'void main()').replace(anchor, code + anchor);
}
