// VR, WebGPU session: the three looks that the GLSL materials give the WebGL session and that a WebGPU renderer cannot run as GLSL, written in TSL (NodeMaterial) with the same values:
//  - the controller laser's ribbon (vr-view.js makeLaser, LASER_LOOKS 1 / 2): turns around the ray axis to face each eye (cameraPosition is per eye in WebXR), width tapering from `width` at the hand to
//    width * taper from 1 m on, a bright core, feathered edges, additive, fading toward the tip;
//  - the pinned label's leg ribbon (vr-anchor-dots.js createLegMesh / vr-label-batch.js): flat ribbon turning to face each eye, never thinner than minAngle rad, soft edges;
//  - the background dome (vr-view.js makeBackground): the gradient smoothstep(-0.1, 0.8, h) of a per-vertex height h, evaluated per pixel.
// The colour maths are the GLSL ones line by line (the pure twins below are what the unit tests pin). Colour output: a NodeMaterial's colour is a linear working-space value that three.js encodes to the output
// (the GLSL ribbons wrote the uniform colour through colorspace_fragment, so the same linear colour goes in here); the dome's GLSL wrote its display values raw, so with an encoding output they are decoded first.
// THREEG = the WebGPU build of three.js (THREE.TSL, THREE.MeshBasicNodeMaterial). This file only builds objects; vr-view.js decides where they are used.
import * as THREEG from './vendor/three@0.187.0/build/three.webgpu.js';

export const GX_THREE = THREEG;

// ---- the values (vr-view.js LASER_LOOKS, makeLaser; vr-anchor-dots.js LEG_WIDTH_M / LEG_MIN_ANGLE; makeBackground) ----
export const LASER_COLOR = 0x88ccff; // the beam's start colour (ray.material.color overrides it)
export const LASER_LOOKS = [{ line: true }, { w: 0.001, t: 0.3 }, { w: 0.0015, t: 1 }]; // 0 = the 1 px line, 1 = thin (1 mm half width, tip 0.3), 2 = thick (1.5 mm, no taper)
export const LASER_CORE_EDGE = 0.55, LASER_CORE_MIX = 0.6, LASER_TIP_ALPHA = 0.3, LASER_OPACITY_FLOOR = 0.05, LASER_POWER_BASE = 0.22, LASER_POWER_MIN = 0.3, LASER_POWER_OFFSET = 2;
export const LEG_WIDTH_M = 0.0024, LEG_MIN_ANGLE = 0.0025, LEG_FEATHER_FROM = 0.6;
export const DOME_RADIUS = 30, DOME_SEGMENTS = [32, 16], DOME_LO = [0.035, 0.045, 0.05], DOME_HI = [0.10, 0.14, 0.20], DOME_EDGE = [-0.1, 0.8];

// ---- pure twins of the shader maths (GLSL semantics: smoothstep with edge0 > edge1 is the reversed ramp) ----
const clamp01 = x => Math.min(1, Math.max(0, x));
export const smoothstepGlsl = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// the laser fragment: x = across (-1..1), y = along the beam (0 hand .. 1 tip), L = the beam's world length, opacity, colour [r, g, b] -> [r, g, b, alpha]
export function laserFragment(x, y, L, opacity, color) {
  const ax = Math.abs(x), e = 1 - smoothstepGlsl(0, 1, ax), core = smoothstepGlsl(LASER_CORE_EDGE, 0, ax);
  const p = Math.max(LASER_POWER_OFFSET - Math.log(Math.max(opacity, LASER_OPACITY_FLOOR)) / Math.log(LASER_POWER_BASE), LASER_POWER_MIN);
  const al = Math.pow(e, p) * (1 + (LASER_TIP_ALPHA - 1) * Math.min(y * L, 1)) * opacity;
  return [color[0] + (1 - color[0]) * core * LASER_CORE_MIX, color[1] + (1 - color[1]) * core * LASER_CORE_MIX, color[2] + (1 - color[2]) * core * LASER_CORE_MIX, al];
}
// the laser's half width at distance s (m) from the hand: width * mix(1, taper, min(s, 1))
export const laserHalfWidth = (width, taper, s) => width * (1 + (taper - 1) * Math.min(s, 1));
// the leg's width in the world at an end that is `dist` m from the eye
export const legWidthAt = (dist, width = LEG_WIDTH_M, minAngle = LEG_MIN_ANGLE) => Math.max(width, dist * minAngle);
// the leg's alpha across the ribbon (side = -1..1)
export const legAlpha = (side, opacity) => (1 - smoothstepGlsl(LEG_FEATHER_FROM, 1, Math.abs(side))) * opacity;
// the dome's display colour at the interpolated height h (-1..1)
export function domeColor(h) { const s = smoothstepGlsl(DOME_EDGE[0], DOME_EDGE[1], h); return DOME_LO.map((lo, i) => lo + (DOME_HI[i] - lo) * s); }

// ---- TSL ----
const tsl = () => {
  const T = THREEG.TSL;
  if (!T || !THREEG.MeshBasicNodeMaterial) throw new Error('vr-gx-looks: the WebGPU build of three.js (TSL / MeshBasicNodeMaterial) is missing');
  return T;
};

// The laser ribbon material. Geometry = the ribbon of makeLaser (position: x = -1 / 1 across, z = 0 .. -1 along). The returned material carries `uniforms` {color, opacity, width, taper} whose `.value`s are
// used like the GLSL material's (color: a THREE.Color, the others numbers), and `color` (= uniforms.color.value) as makeLaser expects.
export function createGxLaserMaterial() {
  const T = tsl(), { uniform, positionGeometry, modelWorldMatrix, cameraProjectionMatrix, cameraViewMatrix, cameraPosition, vec3, vec4, float, select, mix, min, max, length, cross, smoothstep, pow, log, abs } = T;
  const uniforms = { color: uniform(new THREEG.Color(LASER_COLOR)), opacity: uniform(1), width: uniform(LASER_LOOKS[1].w), taper: uniform(LASER_LOOKS[1].t) };
  const t = positionGeometry.z.negate();
  const a = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz, b = modelWorldMatrix.mul(vec4(0, 0, -1, 1)).xyz, dRaw = b.sub(a), L = length(dRaw);
  const d = select(L.greaterThan(1e-6), dRaw.div(L), vec3(0, 0, -1));
  const c = mix(a, b, t), sRaw = cross(d, cameraPosition.sub(c)), sl = length(sRaw);
  const s = select(sl.greaterThan(1e-9), sRaw.div(sl), vec3(1, 0, 0));
  const off = s.mul(positionGeometry.x).mul(uniforms.width).mul(mix(float(1), uniforms.taper, min(t.mul(L), 1)));
  const vX = positionGeometry.x.toVarying('vLaserX'), vT = t.toVarying('vLaserT'), vL = L.toVarying('vLaserL');
  const x = abs(vX), e = float(1).sub(smoothstep(0, 1, x)), core = float(1).sub(smoothstep(0, LASER_CORE_EDGE, x)); // smoothstep(0.55, 0, x) of the GLSL = 1 - smoothstep(0, 0.55, x) (the ramp is symmetric)
  const p = max(float(LASER_POWER_OFFSET).sub(log(max(uniforms.opacity, LASER_OPACITY_FLOOR)).div(Math.log(LASER_POWER_BASE))), LASER_POWER_MIN);
  const al = pow(e, p).mul(mix(float(1), float(LASER_TIP_ALPHA), min(vT.mul(vL), 1))).mul(uniforms.opacity);
  const m = new THREEG.MeshBasicNodeMaterial({ transparent: true, blending: THREEG.AdditiveBlending, depthWrite: false, side: THREEG.DoubleSide, toneMapped: false });
  m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(c.add(off), 1));
  m.colorNode = mix(uniforms.color, vec3(1, 1, 1), core.mul(LASER_CORE_MIX));
  m.opacityNode = al;
  m.uniforms = uniforms; m.color = uniforms.color.value;
  return m;
}

// The leg ribbon material (one leg = one mesh with geometry attributes position (4 vertices: A, B, A, B), other (the opposite end of each), aux (side, sign): vr-anchor-dots.js createLegMesh).
// uniforms {color, opacity, width, minAngle}; the same vertex maths as the GLSL (d = (other - p) * sign, the ribbon turns around d to face each eye, w = max(width, eyeDistance * minAngle)).
export function createGxLegMaterial({ width = LEG_WIDTH_M, minAngle = LEG_MIN_ANGLE } = {}) {
  const T = tsl(), { uniform, attribute, positionGeometry, cameraProjectionMatrix, cameraViewMatrix, cameraPosition, vec3, vec4, float, select, max, length, cross, smoothstep, abs } = T;
  const uniforms = { color: uniform(new THREEG.Color(0xffffff)), opacity: uniform(1), width: uniform(width), minAngle: uniform(minAngle) };
  const other = attribute('other', 'vec3'), aux = attribute('aux', 'vec2'), p = positionGeometry;
  const dRaw = other.sub(p).mul(aux.y), L = length(dRaw);
  const d = select(L.greaterThan(1e-7), dRaw.div(L), vec3(0, 1, 0));
  const sRaw = cross(d, cameraPosition.sub(p)), sl = length(sRaw);
  const s = select(sl.greaterThan(1e-9), sRaw.div(sl), vec3(1, 0, 0));
  const w = max(uniforms.width, length(cameraPosition.sub(p)).mul(uniforms.minAngle));
  const vS = aux.x.toVarying('vLegS');
  const m = new THREEG.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREEG.DoubleSide, toneMapped: false });
  m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p.add(s.mul(aux.x).mul(w).mul(0.5)), 1));
  m.colorNode = uniforms.color;
  m.opacityNode = float(1).sub(smoothstep(LEG_FEATHER_FROM, 1, abs(vS))).mul(uniforms.opacity);
  m.uniforms = uniforms; m.color = uniforms.color.value;
  Object.defineProperty(m, 'opacity', { get() { return uniforms.opacity.value; }, set(v) { uniforms.opacity.value = v; }, configurable: true });
  return m;
}

// A leg's geometry (the ribbon of createLegMesh): position and other are 4 x 3 floats written by the caller (A, B, A, B / the opposite ends), aux the corners.
export function createGxLegGeometry() {
  const g = new THREEG.BufferGeometry();
  g.setAttribute('position', new THREEG.Float32BufferAttribute(12, 3));
  g.setAttribute('other', new THREEG.Float32BufferAttribute(12, 3));
  g.setAttribute('aux', new THREEG.Float32BufferAttribute([-1, 1, -1, -1, 1, 1, 1, -1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}

// The background dome: SphereGeometry(30, 32, 16) seen from inside, the gradient per pixel from the interpolated height h = normalize(position).y (the GLSL's varying). encoded = the output is
// encoded to sRGB by three.js, so the display values (which the GLSL dome wrote raw) are decoded first.
export function createGxDome({ encoded = false } = {}) {
  const T = tsl(), { positionGeometry, vec3, mix, smoothstep, normalize, sRGBTransferEOTF } = T;
  const h = normalize(positionGeometry).y.toVarying('vDomeH');
  const lo = vec3(...DOME_LO), hi = vec3(...DOME_HI), col = mix(lo, hi, smoothstep(DOME_EDGE[0], DOME_EDGE[1], h));
  const m = new THREEG.MeshBasicNodeMaterial({ side: THREEG.BackSide, depthWrite: false, toneMapped: false });
  m.colorNode = encoded ? sRGBTransferEOTF(col) : col;
  return new THREEG.Mesh(new THREEG.SphereGeometry(DOME_RADIUS, DOME_SEGMENTS[0], DOME_SEGMENTS[1]), m);
}
