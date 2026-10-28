// The material of every surface mesh of the 3D view: the SAME lighting formula as the two volume shaders (lighting.js), evaluated in the material
// with the light fixed in view space and no scene lights. WebGPU: a MeshStandardNodeMaterial with lights off whose colourNode is the lit colour
// (meshColorNode, linear working space; the emissive highlight of edited / selected regions is still added by the material); WebGL fallback: a core
// MeshStandardMaterial whose fragment shader is patched (patchStandardFragment). Segment colour / opacity / transparency / flatShading / side / clipping
// planes / emissive are the material's own properties as before.
// each segment's material preset (lighting.js MATERIALS) is a uniform shared by every mesh of that segment (one per segment key), so
// changing the preset (setSegmentMeshMaterial) updates the meshes in place, no rebuild; meshes without a segment key use the standard material.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { meshColorNode, patchStandardFragment, boxRadius, materialVec } from './lighting.js?v=20261028-build688';

const TSL = THREE.TSL; // the TSL namespace of the webgpu build (three/tsl itself imports a bare specifier the app has no import map for)
let backend = 'WEBGPU';
// the depth cue's two numbers, shared by every mesh material: distance of the eye to the volume's centre, bounding radius of the volume (updateMeshDepth)
const depth = { center: TSL.uniform(5.2), radius: TSL.uniform(2.86) };
const glDepth = { value: new THREE.Vector2(5.2, 2.86) };
const matOf = new Map(); // segment key ('' = none) -> { node: vec3 TSL uniform, gl: { value: Vector3 }, colorNode }
function segmentMat(key = '') {
  let m = matOf.get(key);
  if (!m) { const v = materialVec('standard'); m = { node: TSL.uniform(new THREE.Vector3(v[0], v[1], v[2])), gl: { value: new THREE.Vector3(v[0], v[1], v[2]) }, colorNode: null }; matOf.set(key, m); }
  return m;
}
// the material preset of a segment's meshes (a MATERIALS key; unknown -> standard)
export function setSegmentMeshMaterial(key, preset) {
  const v = materialVec(preset), m = segmentMat(key);
  m.node.value.set(v[0], v[1], v[2]); m.gl.value.set(v[0], v[1], v[2]);
}

// 'WEBGPU' (node materials) or 'WEBGL' (the fallback renderer): set once when the renderer of the 3D view exists, before any mesh is built
export function setMeshMaterialBackend(name) { backend = name === 'WEBGL' ? 'WEBGL' : 'WEBGPU'; }
export function meshMaterialBackend() { return backend; }

// segmentKey: the segment the mesh belongs to (its material preset); omitted: standard
export function createSurfaceMaterial(params, segmentKey = '') {
  const sm = segmentMat(segmentKey || '');
  if (backend === 'WEBGPU' && THREE.MeshStandardNodeMaterial) {
    const m = new THREE.MeshStandardNodeMaterial(params);
    sm.colorNode ??= meshColorNode(TSL, depth, sm.node);
    m.lights = false; m.colorNode = sm.colorNode;
    return m;
  }
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = shader => { shader.uniforms.vrlMeshDepth = glDepth; shader.uniforms.vrlMeshMat = sm.gl; shader.fragmentShader = patchStandardFragment(shader.fragmentShader); };
  m.customProgramCacheKey = () => 'vrl-mesh-light-612';
  return m;
}

// every frame before the 3D view renders: the eye's distance to the volume's centre (the origin of the transform proxy) and the bounding radius of its box
// in world units, so the depth cue spans the volume's own extent as in the volume shaders. volume = { columns, rows, slices, spacing } or null (kept)
let radius0 = 2.86;
export function updateMeshDepth(camera, obj, volume) {
  if (volume?.spacing) radius0 = boxRadius(volume.columns, volume.rows, volume.slices, volume.spacing);
  if (!camera || !obj) return;
  const e = obj.matrixWorld.elements, scale = Math.hypot(e[0], e[1], e[2]) || 1;
  const dx = camera.position.x - e[12], dy = camera.position.y - e[13], dz = camera.position.z - e[14];
  const dist = Math.hypot(dx, dy, dz), r = radius0 * scale;
  if (depth.center.value !== dist) depth.center.value = dist;
  if (depth.radius.value !== r) depth.radius.value = r;
  glDepth.value.set(dist, r);
}
