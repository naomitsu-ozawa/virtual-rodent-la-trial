// One lighting model for every 3D view (build 612): the desktop WebGPU volume (medical-volume.js), the VR / AR volume (vr-view.js) and the
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
// build 620: per-segment material presets (MATERIALS): AMBIENT / SPEC / SHININESS are the 'standard' preset; vrlShade takes them as an argument
// mat = vec3(ambient, spec, shininess) per segment (the desktop uniform u.segMat, the VR uniform segM, the mesh uniform per segment); the light
// direction and DEPTH_FADE stay shared constants.
export const LIGHT_UP = 0.5;
export const LIGHT_RIGHT = 0.3;
export const AMBIENT = 0.28;
export const SPEC = 0.18;
export const SHININESS = 20;
export const DEPTH_FADE = 0.2;
// build 620: material presets of a segment (ambient floor, highlight strength, highlight sharpness). standard = the constants above (the default:
// renders exactly as before); solid: crisper, more contrast; plaster: matte and soft, no highlight; plastic: a strong, sharp highlight
export const MATERIALS = {
  standard: { ambient: AMBIENT, spec: SPEC, shininess: SHININESS },
  solid: { ambient: 0.16, spec: 0.12, shininess: 16 },
  plaster: { ambient: 0.42, spec: 0, shininess: 1 },
  plastic: { ambient: 0.24, spec: 0.5, shininess: 60 },
};
export const MATERIAL_KEYS = Object.keys(MATERIALS);
// a preset key as stored on a segment (unknown / missing -> 'standard')
export const materialKey = k => (Object.prototype.hasOwnProperty.call(MATERIALS, k) ? k : 'standard');
// [ambient, spec, shininess, 0] of a preset key (the 4th component is spare)
export function materialVec(k) {
  const m = MATERIALS[materialKey(k)];
  return [m.ambient, m.spec, m.shininess, 0];
}

const f = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));

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
  return `// build 612: shared lighting model (lighting.js)
vec2 vrlShade(vec3 n,vec3 viewDir,vec3 lightOff,float depth01,float keep,vec3 mat){
 if(keep<0.5&&dot(n,viewDir)<0.0)n=-n;
 vec3 l=normalize(viewDir+lightOff);
 float fade=1.0-${f(DEPTH_FADE)}*depth01;
 return vec2((mat.x+(1.0-mat.x)*max(dot(n,l),0.0))*fade,pow(max(dot(n,normalize(l+viewDir)),0.0),mat.z)*mat.y*fade);
}
float vrlDepthD(float t,float dist,float r){return clamp((t-(dist-r))/(2.0*r),0.0,1.0);}
float vrlDepth01(float t,vec3 o,vec3 halfBox){return vrlDepthD(t,length(o),length(halfBox));}
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
  return `// build 612: shared lighting model (lighting.js)
fn vrlShade(n0:vec3<f32>,viewDir:vec3<f32>,lightOff:vec3<f32>,depth01:f32,keep:f32,mat:vec3<f32>)->vec2<f32>{
 var n=n0;if(keep<0.5&&dot(n,viewDir)<0.0){n=-n;}
 let l=normalize(viewDir+lightOff);
 let fade=1.0-${f(DEPTH_FADE)}*depth01;
 return vec2<f32>((mat.x+(1.0-mat.x)*max(dot(n,l),0.0))*fade,pow(max(dot(n,normalize(l+viewDir)),0.0),mat.z)*mat.y*fade);
}
fn vrlDepthD(t:f32,dist:f32,r:f32)->f32{return clamp((t-(dist-r))/(2.0*r),0.0,1.0);}
fn vrlDepth01(t:f32,o:vec3<f32>,halfBox:vec3<f32>)->f32{return vrlDepthD(t,length(o),length(halfBox));}
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
// build 620: mat = a vec3 uniform node (ambient, spec, shininess) of the mesh's segment (materialVec), so the mesh matches its volume; standard when omitted.
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
  const display = materialColor.mul(diffuse).add(spec);
  return vec4(pow(max(display, 0), DISPLAY_GAMMA), 1);
}
// WebGL fallback (a core MeshStandardMaterial, onBeforeCompile): the fragment source of the standard material with the same evaluation in place of its
// lights (there are none in the scene). Declares the vec2 uniform vrlMeshDepth (eye distance to the centre, bounding radius) and (build 620) the vec3 uniform
// vrlMeshMat (the segment's material: ambient, spec, shininess). The emissive part
// (the highlight of edited / selected regions) is added after, in linear, as before.
export function patchStandardFragment(src) {
  const anchor = '#include <opaque_fragment>';
  if (!src.includes(anchor) || !src.includes('void main()')) throw new Error('lighting.js: the standard fragment shader has no opaque_fragment / main anchor');
  const code = `{ // build 612: the shared lighting model in place of the scene lights
 vec3 vrlV=normalize(vViewPosition);
 vec2 vrlS=vrlShade(normal,vrlV,vec3(${f(VIEW_LIGHT_OFFSET[0])},${f(VIEW_LIGHT_OFFSET[1])},0.0),vrlDepthD(length(vViewPosition),vrlMeshDepth.x,vrlMeshDepth.y),0.0,vrlMeshMat);
 outgoingLight=pow(max(diffuseColor.rgb*vrlS.x+vec3(vrlS.y),0.0),vec3(${f(DISPLAY_GAMMA)}))+totalEmissiveRadiance;
 }
 `;
  return src.replace('void main()', 'uniform vec2 vrlMeshDepth;\nuniform vec3 vrlMeshMat;\n' + lightingGLSL() + 'void main()').replace(anchor, code + anchor);
}
