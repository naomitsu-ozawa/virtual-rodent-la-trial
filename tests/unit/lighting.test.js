import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as L from '../../docs/lighting.js';
import { volumeShader } from '../../docs/medical-volume.js';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';

// one lighting model for the desktop WebGPU volume, the VR / AR volume and the 3D-view meshes (docs/lighting.js).
const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a); return a.map(c => c / l); };
// rotation about an axis (Rodrigues), the "volume is grabbed and turned" case: everything of the VOLUME turns, the viewer does not
const rot = (v, axis, ang) => { const k = norm(axis), c = Math.cos(ang), s = Math.sin(ang), kv = dot(k, v); const cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; return v.map((x, i) => x * c + cr[i] * s + k[i] * kv * (1 - c)); };

// viewer on +z looking down -z, right = +x, up = +y (view space); the volume space equals view space until the volume is turned
const VIEW = [0, 0, 1], RIGHT = [1, 0, 0], UP = [0, 1, 0];
const OFF = L.lightOffset(RIGHT, UP);

describe('lighting constants', () => {
  it('are sane: a headlight slightly above and to the right, an ambient floor, a mild depth cue', () => {
    expect(L.LIGHT_UP).toBeGreaterThan(0);
    expect(L.LIGHT_RIGHT).toBeGreaterThanOrEqual(0);
    expect(L.LIGHT_UP).toBeLessThan(1); // "slightly above the viewer": the view direction stays the main part of the light
    expect(L.AMBIENT).toBeGreaterThan(0.2);
    expect(L.AMBIENT).toBeLessThan(0.5);
    expect(L.DEPTH_FADE).toBeGreaterThan(0);
    expect(L.DEPTH_FADE).toBeLessThanOrEqual(0.4); // mild
  });
  it('viewLightDirection is a unit vector with the light above, to the right and in front', () => {
    const d = L.viewLightDirection();
    expect(Math.hypot(...d)).toBeCloseTo(1, 12);
    expect(d[0]).toBeGreaterThan(0);
    expect(d[1]).toBeGreaterThan(d[0]);
    expect(d[2]).toBeGreaterThan(d[1]);
  });
  it('the mesh result is brought from display values to linear with the gamma of the display, so the sRGB output gives the volume\'s numbers back', () => {
    expect(L.DISPLAY_GAMMA).toBe(2.2);
    // a display value v the volume writes: the mesh writes v^2.2 in linear, three.js's output encoding gives v^(2.2/2.2) = v (to the sRGB curve's own 2.2-ish)
    const srgbEncode = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    for (const v of [0.28, 0.46, 0.64, 0.9]) expect(Math.abs(srgbEncode(Math.pow(v, L.DISPLAY_GAMMA)) - v)).toBeLessThan(0.02);
  });
  it('the view-space light offset of the meshes is the same right / up offset (the camera of the 3D view is not rolled)', () => {
    expect(L.VIEW_LIGHT_OFFSET).toEqual([L.LIGHT_RIGHT, L.LIGHT_UP, 0]);
    expect(L.VIEW_LIGHT_OFFSET).toEqual(L.lightOffset([1, 0, 0], [0, 1, 0]));
  });
});

describe('shadePoint (the JS twin of vrlShade)', () => {
  it('is one-sided in the normal: n and -n shade the same (the gradient points in or out depending on the range side)', () => {
    for (const n of [norm([0.2, 0.9, 0.3]), norm([-0.5, -0.2, 0.8]), norm([0.1, -0.7, -0.6]), [0, 0, 1]]) {
      const a = L.shadePoint(n, VIEW, OFF, 0.4), b = L.shadePoint(n.map(c => -c), VIEW, OFF, 0.4);
      expect(a.diffuse).toBeCloseTo(b.diffuse, 12);
      expect(a.spec).toBeCloseTo(b.spec, 12);
    }
  });
  it('keep: an outward normal that faces away from the viewer (an inner wall seen through a translucent layer) gets only the ambient floor and no highlight', () => {
    const away = norm([0.2, 0.5, -1]); // outward normal pointing away from the viewer on +z
    const kept = L.shadePoint(away, VIEW, OFF, 0.3, true), turned = L.shadePoint(away, VIEW, OFF, 0.3, false);
    expect(kept.diffuse).toBeCloseTo(L.AMBIENT * (1 - L.DEPTH_FADE * 0.3), 12);
    expect(kept.spec).toBe(0);
    expect(turned.diffuse).toBeGreaterThan(kept.diffuse + 0.2); // turned round it would glow like a front face
    // an outward normal that faces the viewer is the same either way
    const front = norm([0.1, 0.2, 1]);
    expect(L.shadePoint(front, VIEW, OFF, 0.3, true)).toEqual(L.shadePoint(front, VIEW, OFF, 0.3, false));
  });
  it('a surface facing up is lit more than one facing down (viewer on +z): no light from below, no abs() glow', () => {
    const up = L.shadePoint(norm([0, 1, 1]), VIEW, OFF, 0), down = L.shadePoint(norm([0, -1, 1]), VIEW, OFF, 0);
    expect(up.diffuse).toBeGreaterThan(down.diffuse);
    // the old model (abs of the cosine) lit them about the same way round: |n.l| of the down face is not small
    const l = norm([VIEW[0] + 0.35, VIEW[1] + 0.5, VIEW[2] + 0.25]);
    expect(Math.abs(dot(norm([0, -1, 1]), l))).toBeGreaterThan(0.3);
  });
  it('keeps the ambient floor: no surface goes darker than AMBIENT * fade', () => {
    for (const n of [[0, 0, 1], [0, -1, 0], norm([-1, -1, 0.1]), norm([0.3, -0.9, 0.05])]) {
      for (const depth of [0, 0.5, 1]) {
        const s = L.shadePoint(n, VIEW, OFF, depth);
        expect(s.diffuse).toBeGreaterThanOrEqual(L.AMBIENT * (1 - L.DEPTH_FADE * depth) - 1e-12);
        expect(s.diffuse).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });
  it('a face-on surface is bright, a grazing one is near the ambient floor', () => {
    expect(L.shadePoint([0, 0, 1], VIEW, OFF, 0).diffuse).toBeGreaterThan(0.85);
    expect(L.shadePoint([1, 0, 0], VIEW, [0, 0, 0], 0).diffuse).toBeCloseTo(L.AMBIENT, 12);
  });
  it('a far surface is darker than the same surface near, by DEPTH_FADE at the far side; the highlight fades too', () => {
    const n = norm([0.1, 0.3, 1]);
    const near = L.shadePoint(n, VIEW, OFF, 0), far = L.shadePoint(n, VIEW, OFF, 1);
    expect(far.diffuse).toBeCloseTo(near.diffuse * (1 - L.DEPTH_FADE), 12);
    expect(far.spec).toBeCloseTo(near.spec * (1 - L.DEPTH_FADE), 12);
  });
  it('the highlight is white-ish and bounded by SPEC', () => {
    const l = norm([VIEW[0] + OFF[0], VIEW[1] + OFF[1], VIEW[2] + OFF[2]]);
    const h = norm([l[0] + VIEW[0], l[1] + VIEW[1], l[2] + VIEW[2]]);
    const s = L.shadePoint(h, VIEW, OFF, 0); // normal along the half vector: the peak
    expect(s.spec).toBeCloseTo(L.SPEC, 12);
  });
  it('turning the volume does not turn the light: the picture of a turned volume equals the shading done in the volume frame with the viewer axes brought into it', () => {
    const n = norm([0.3, 0.8, 0.5]), axis = [0.4, 1, 0.2], ang = 2.4;
    // world: the surface (normal n in the volume frame) is turned with the volume, the viewer keeps VIEW / RIGHT / UP
    const world = L.shadePoint(rot(n, axis, ang), VIEW, OFF, 0.3);
    // volume frame (what the shaders do): the viewer's axes are the inverse-turned ones, the normal is the gradient as stored
    const viewV = rot(VIEW, axis, -ang), offV = L.lightOffset(rot(RIGHT, axis, -ang), rot(UP, axis, -ang));
    const vol = L.shadePoint(n, viewV, offV, 0.3);
    expect(vol.diffuse).toBeCloseTo(world.diffuse, 12);
    expect(vol.spec).toBeCloseTo(world.spec, 12);
  });
  it('an upside-down volume (turned half a circle about the view axis) is still lit from above in the picture; the old fixed offset lit it from below', () => {
    const flip = v => rot(v, VIEW, Math.PI);
    // the volume's own +y points down on the screen now; a surface facing screen-up has the volume-frame normal flip(screen normal)
    const nScreenUp = flip(norm([0, 1, 1])), nScreenDown = flip(norm([0, -1, 1]));
    const offNew = L.lightOffset(flip(RIGHT), flip(UP)); // the viewer's right / up in the volume frame
    expect(L.shadePoint(nScreenUp, VIEW, offNew, 0).diffuse).toBeGreaterThan(L.shadePoint(nScreenDown, VIEW, offNew, 0).diffuse);
    const offOld = [0.35, 0.5, 0.25]; // volume coordinates, as before
    expect(L.shadePoint(nScreenUp, VIEW, offOld, 0).diffuse).toBeLessThan(L.shadePoint(nScreenDown, VIEW, offOld, 0).diffuse);
  });
});

describe('depth01', () => {
  it('is 0 at the near side of the bounding sphere, 1 at the far side, linear between and clamped', () => {
    expect(L.depth01(8, 10, 2)).toBeCloseTo(0, 12);
    expect(L.depth01(12, 10, 2)).toBeCloseTo(1, 12);
    expect(L.depth01(10, 10, 2)).toBeCloseTo(0.5, 12);
    expect(L.depth01(-5, 10, 2)).toBe(0);
    expect(L.depth01(99, 10, 2)).toBe(1);
    let prev = -1;
    for (let t = 7; t <= 13; t += 0.25) { const d = L.depth01(t, 10, 2); expect(d).toBeGreaterThanOrEqual(prev); prev = d; }
  });
});

describe('generated shader helpers', () => {
  const g = L.lightingGLSL(), w = L.lightingWGSL();
  it('carry the shared constants and take the material (ambient, spec, shininess) as an argument', () => {
    for (const src of [g, w]) {
      expect(src).toContain('mat.x+(1.0-mat.x)*max(dot(n,l),0.0)');
      expect(src).toContain(String(L.DEPTH_FADE));
      expect(src).toContain(',mat.z)*mat.y*fade');
      expect(src).not.toMatch(/0\.28|0\.72|0\.18/); // no material literal left
      expect(src).toContain('vrlShade');
      expect(src).toContain('vrlDepth01');
    }
  });
  it('flip the normal towards the viewer unless keep is set, and use no abs() on the cosine', () => {
    expect(g).toMatch(/if\(keep<0\.5&&dot\(n,viewDir\)<0\.0\)n=-n;/);
    expect(w).toMatch(/if\(keep<0\.5&&dot\(n,viewDir\)<0\.0\)\{n=-n;\}/);
    expect(g + w).not.toMatch(/abs\(dot/);
  });
  it('the vertex statement takes the eye axes from viewMatrix, normalises each after the inverse model matrix and uses both constants', () => {
    const v = L.lightingVertexGLSL('invModel');
    expect(v).toContain('viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]'); // right
    expect(v).toContain('viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]'); // up
    expect(v.match(/normalize\(mat3\(invModel\)/g)).toHaveLength(2);
    expect(v).toContain('*' + String(L.LIGHT_RIGHT));
    expect(v).toContain('*' + String(L.LIGHT_UP));
  });
  it('lightOffsetExpr uses the same two constants', () => {
    expect(L.lightOffsetExpr('r', 'u')).toBe(`r*${L.LIGHT_RIGHT}+u*${L.LIGHT_UP}`);
  });
});

describe('every view uses the shared lighting (static)', () => {
  const OLD = /0\.35,\s*0\.5,\s*0\.25|abs\(dot\(n,lightDir\)\)|HemisphereLight/;
  it('medical-volume.js (desktop WebGPU volume): imports lighting.js, embeds the WGSL helpers, shades the hit with vrlShade from the camera axes', () => {
    const src = read('medical-volume.js');
    expect(src).toMatch(/from '\.\/lighting\.js\?v=/);
    expect(src).toContain('${lightingWGSL()}');
    expect(src).toContain("${lightOffsetExpr('u.camRightTan.xyz','u.camUpAspect.xyz')}");
    expect(src).not.toMatch(OLD);
    const wgsl = volumeShader();
    expect(wgsl).toContain('fn vrlShade(');
    expect(wgsl).toMatch(/let shade=vrlShade\(select\(n,-inward,later\),viewDir,u\.camRightTan\.xyz\*[\d.]+\+u\.camUpAspect\.xyz\*[\d.]+,vrlDepth01\(hi,u\.camOrigin\.xyz,u\.halfStep\.xyz\),select\(0\.0,1\.0,later\),u\.segMat\[u32\(idx\)\]\.xyz\);/);
    expect(wgsl).toContain('segMat:array<vec4<f32>,4>\n};'); // appended at the END of the struct (the pick shader's struct is a prefix of it)
    expect(wgsl).toContain('let later=acc.a>0.0;');
    // n itself is not flipped; the outward normal of a later hit is -inward, so inward must be defined before the shading
    expect(wgsl).toContain('let inward=select(-n,n,hvPrev<-1e8||hvPrev<a.x);');
    expect(wgsl.indexOf('let inward=')).toBeLessThan(wgsl.indexOf('let shade=vrlShade('));
    expect(wgsl).not.toMatch(/\$\{/);
  });
  it('vr-view.js (VR / AR volume): imports lighting.js, the helpers and the per-eye light are in the shaders, every hit and cap site uses vrlShade', () => {
    const src = read('vr-view.js');
    expect(src).toMatch(/from '\.\/lighting\.js\?v=/);
    expect(src).toContain('${lightingGLSL()}');
    expect(src).toContain("${lightingVertexGLSL('invModel')}");
    expect(src).toContain('out vec3 vLightOff;');
    expect(src).toContain('in vec3 vLightOff;');
    expect(src).not.toMatch(OLD);
    // 4 surface hits (tight loop opaque / semi-transparent, the post-loop hit of the opaque variant, the general loop) + 2 cut faces
    expect(src.match(/vrlShade\(later\?\(gHuMean<0\.5\*\(segA\[idx\]\.x\+segA\[idx\]\.y\)\?-n:n\):n,viewDir,vLightOff,vrlDepth01\(hi,o,halfExt\),later\?1\.0:0\.0,segM\[idx\]\.xyz\)/g)).toHaveLength(4);
    expect(src.match(/vrlShade\(n,viewDir,vLightOff,vrlDepth01\(capAt,o,halfExt\),0\.0,segM\[ci\]\.xyz\)/g)).toHaveLength(2);
    expect(src).toContain('uniform vec4 segM[4];');
    expect(src.match(/vrlShade\(/g)).toHaveLength(6); // every call site passes the segment's material
    expect(src.match(/bool later=acc\.a>0\.0&&!(simple|hitSimple)&&!face;/g)).toHaveLength(4);
    // entry face: a hit within one step of the box face the ray enters through takes the flat face normal (the gradient is one-sided noise there) at all 4 surface-hit sites, no gradient fetches for it
    expect(src.match(/bool face=!(simple|hitSimple)&&hi<=faceEnd;vec3 n=(simple|hitSimple)\?-dir:\(face\?entryFaceNormal\(o,dir\):gradientAt\(tc\)\);/g)).toHaveLength(4);
    expect(src).toContain('float faceEnd=(bounds.x>0.0&&t<=bounds.x+1e-4)?bounds.x+step:-1.0;');
    // the local mean HU the outward side is judged by costs no extra fetch: it is the mean of the fetches of the gradient itself
    expect(src).toMatch(/gHuMean=\(xp\+xm\+yp\+ym\+zp\+zm\)\*\(1\.0\/6\.0\);/);
    expect(src.match(/vec3 viewDir=/g)).toHaveLength(6);
    expect(src.match(/\bdiffuse=/g) || []).toHaveLength(6);
  });
  it('app.js and the mesh builders (3D-view meshes): every surface material comes from mesh-material.js, no scene lights', () => {
    const app = read('app.js');
    expect(app).toMatch(/import \{ setMeshMaterialBackend, updateMeshDepth, setSegmentMeshMaterial \} from '\.\/mesh-material\.js\?v=/);
    expect(app).toContain('setMeshMaterialBackend(backend);');
    expect(app).toContain('updateMeshDepth(camera,sceneState.obj,current3DVolume)');
    expect(app).not.toMatch(/HemisphereLight|AmbientLight|DirectionalLight|keyLight|addMeshLights/);
    for (const f of ['mesh-three.js', 'surface-build.js', 'surface-mesh.js', 'analysis-ops.js']) {
      expect(read(f), f).toContain('createSurfaceMaterial(');
      expect(read(f), f).not.toMatch(/new THREE\.MeshStandardMaterial\(/);
    }
  });
  it('no other source draws with its own light offset', () => {
    for (const f of ['scene-view.js', 'surface-mesh.js', 'mesh-three.js', 'mpr3d-overlay.js']) expect(read(f), f).not.toMatch(/DirectionalLight|HemisphereLight|AmbientLight/);
  });
});

describe('the mesh material (WebGPU node material and WebGL fallback)', () => {
  it('boxRadius is the bounding radius of the volume\'s box in the 3D scene (longest side 3.3), as the volume renderer\'s halfExtents', () => {
    expect(L.boxRadius(512, 512, 512, [1, 1, 1])).toBeCloseTo(0.5 * 3.3 * Math.sqrt(3), 12);
    const he = [100 * 0.2, 80 * 0.2, 400 * 0.1].map(v => v * (3.3 / 40) * 0.5);
    expect(L.boxRadius(100, 80, 400, [0.2, 0.2, 0.1])).toBeCloseTo(Math.hypot(...he), 12);
  });
  it('meshColorNode builds a TSL graph with the real three.js TSL (the lit colour in linear working space)', () => {
    const TSL = THREE.TSL;
    const node = L.meshColorNode(TSL, { center: TSL.uniform(5.2), radius: TSL.uniform(2.86) });
    expect(node.isNode).toBe(true);
    const m = new THREE.MeshStandardNodeMaterial({ color: '#f3f0e8', side: THREE.DoubleSide, flatShading: true, transparent: true, opacity: 0.5 });
    m.lights = false; m.colorNode = node;
    expect(m.colorNode).toBe(node);
    expect(m.opacity).toBe(0.5); expect(m.transparent).toBe(true); expect(m.flatShading).toBe(true); expect(m.side).toBe(THREE.DoubleSide);
  });
  it('patchStandardFragment puts the shared lighting in place of the lights of the standard fragment shader of three.js', async () => {
    const THREEcore = await import('three');
    const out = L.patchStandardFragment(THREEcore.ShaderLib.standard.fragmentShader);
    expect(out).toContain('uniform vec2 vrlMeshDepth;');
    expect(out).toContain('vec2 vrlShade(');
    expect(out).toContain('uniform vec3 vrlMeshMat;');
    expect(out).toMatch(/vrlShade\(normal,vrlV,vec3\(0\.3,0\.5,0\.0\),vrlDepthD\(length\(vViewPosition\),vrlMeshDepth\.x,vrlMeshDepth\.y\),0\.0,vrlMeshMat\)/);
    expect(out).toContain('outgoingLight=pow(max(diffuseColor.rgb*vrlS.x+vec3(vrlS.y),0.0),vec3(2.2))+totalEmissiveRadiance;');
    expect(out.indexOf('outgoingLight=pow(')).toBeLessThan(out.indexOf('#include <opaque_fragment>'));
    expect(() => L.patchStandardFragment('void main(){}')).toThrow();
  });
  it('mesh-material.js builds node materials for the WebGPU renderer and patched standard materials for the WebGL fallback', async () => {
    const M = await import('../../docs/mesh-material.js');
    M.setMeshMaterialBackend('WEBGPU');
    const a = M.createSurfaceMaterial({ color: '#f3f0e8', roughness: 0.55, metalness: 0, side: THREE.DoubleSide, flatShading: true });
    expect(a.isMeshStandardNodeMaterial).toBe(true); expect(a.lights).toBe(false); expect(a.colorNode?.isNode).toBe(true);
    expect(a.clone().colorNode).toBe(a.colorNode);
    M.setMeshMaterialBackend('WEBGL');
    const b = M.createSurfaceMaterial({ color: '#f3f0e8', side: THREE.DoubleSide });
    expect(b.isMeshStandardMaterial).toBe(true); expect(b.isNodeMaterial).toBeUndefined();
    const THREEcore = await import('three');
    const shader = { uniforms: {}, fragmentShader: THREEcore.ShaderLib.standard.fragmentShader };
    b.onBeforeCompile(shader);
    expect(shader.uniforms.vrlMeshDepth.value.isVector2).toBe(true);
    expect(shader.fragmentShader).toContain('vrlShade(');
    M.setMeshMaterialBackend('WEBGPU');
    expect(() => M.updateMeshDepth({ position: { x: 0, y: 0, z: 5 } }, { matrixWorld: { elements: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 1, 1] } }, { columns: 100, rows: 100, slices: 100, spacing: [1, 1, 1] })).not.toThrow();
  });
});


// per-segment material presets (標準 / ソリッド / 石膏 / プラスチック)
describe('segment material presets', () => {
  it('standard is exactly the constants every view used before (the default renders as before)', () => {
    expect(L.MATERIALS.standard).toEqual({ ambient: 0.28, spec: 0.18, shininess: 20 });
    expect(L.MATERIALS.standard).toEqual({ ambient: L.AMBIENT, spec: L.SPEC, shininess: L.SHININESS });
    expect(L.materialVec('standard')).toEqual([L.AMBIENT, L.SPEC, L.SHININESS, 0]);
  });
  it('has the four presets; an unknown or missing key is standard', () => {
    expect(L.MATERIAL_KEYS).toEqual(['standard', 'solid', 'plaster', 'plastic']);
    for (const k of [undefined, null, '', 'glass', 'toString', '__proto__', 42]) {
      expect(L.materialKey(k)).toBe('standard');
      expect(L.materialVec(k)).toEqual(L.materialVec('standard'));
    }
    for (const k of L.MATERIAL_KEYS) expect(L.materialKey(k)).toBe(k);
    for (const k of L.MATERIAL_KEYS) { const m = L.MATERIALS[k]; expect(m.ambient).toBeGreaterThan(0); expect(m.ambient).toBeLessThan(1); expect(m.spec).toBeGreaterThanOrEqual(0); expect(m.shininess).toBeGreaterThan(0); }
  });
  it('shadePoint: no material = standard; the presets differ the way they are meant to', () => {
    const n = norm([0.2, 0.4, 1]);
    expect(L.shadePoint(n, VIEW, OFF, 0.3)).toEqual(L.shadePoint(n, VIEW, OFF, 0.3, false, L.MATERIALS.standard));
    const l = norm([VIEW[0] + OFF[0], VIEW[1] + OFF[1], VIEW[2] + OFF[2]]), h = norm([l[0] + VIEW[0], l[1] + VIEW[1], l[2] + VIEW[2]]);
    const peak = k => L.shadePoint(h, VIEW, OFF, 0, false, L.MATERIALS[k]).spec;
    expect(peak('plastic')).toBeCloseTo(L.MATERIALS.plastic.spec, 12);
    expect(peak('plastic')).toBeGreaterThan(peak('standard') * 2); // a strong highlight
    expect(peak('plaster')).toBe(0); // matte
    const grazing = k => L.shadePoint([1, 0, 0], VIEW, [0, 0, 0], 0, false, L.MATERIALS[k]).diffuse; // the ambient floor
    expect(grazing('plaster')).toBeCloseTo(L.MATERIALS.plaster.ambient, 12);
    expect(grazing('plaster')).toBeGreaterThan(grazing('standard')); // soft
    expect(grazing('solid')).toBeLessThan(grazing('standard')); // more contrast
    // plastic's highlight is sharper: off the peak it falls faster than standard's
    const off = norm([h[0] + 0.25, h[1], h[2]]), fall = k => L.shadePoint(off, VIEW, OFF, 0, false, L.MATERIALS[k]).spec / peak(k);
    expect(fall('plastic')).toBeLessThan(fall('standard'));
    // a face-on surface is lit fully whatever the preset (diffuse = 1 at n = l)
    for (const k of L.MATERIAL_KEYS) expect(L.shadePoint(l, VIEW, OFF, 0, false, L.MATERIALS[k]).diffuse).toBeCloseTo(1, 12);
  });
  it('the segment state carries a material, standard by default, and the project save / load keeps it (old projects: standard)', () => {
    const seg = read('segments.js');
    expect(seg.match(/material:'standard'/g)).toHaveLength(5);
    const dl = read('data-load.js');
    expect(dl).toContain('material:materialKey(g.material)}'); // gatherProject
    expect(dl).toContain("setControlValue(segmentControl('material',key),materialKey(g?.material));"); // applyProject: before the inactive / missing skips; no field -> standard
    expect(dl.indexOf("materialKey(g?.material)")).toBeLessThan(dl.indexOf('if(!g)continue;'));
    const ui = read('ui-shell.js');
    for (const k of ['bone', 'soft', 'fat', 'lung', 'contrast']) expect(ui).toContain(`data-seg-material="${k}"`);
    expect(ui.match(/<option value="(standard|solid|plaster|plastic)" data-i18n="mat\w+">/g)).toHaveLength(20);
    expect(read('app.js')).toMatch(/material\.onchange=\(\)=>\{const k=materialKey\(material\.value\);material\.value=k;segmentState\[key\]\.material=k;setSegmentMeshMaterial\(key,k\);request3DRender\(\)\};/);
  });
  it('round-trips through a project archive', async () => {
    const { packProject, unpackProject } = await import('../../docs/project-file.js');
    const project = { format: 'virtual-rodent-lab-project', version: 1, segments: { bone: { active: true, material: 'plastic' }, soft: { active: true, material: 'plaster' }, fat: { active: true } } };
    const back = unpackProject(packProject(project)).project;
    expect(back.segments.bone.material).toBe('plastic');
    expect(L.materialKey(back.segments.soft.material)).toBe('plaster');
    expect(L.materialKey(back.segments.fat.material)).toBe('standard'); // saved before
  });
  it('the mesh material of a segment follows its preset in place (one shared uniform per segment, WebGPU and WebGL)', async () => {
    const M = await import('../../docs/mesh-material.js');
    const THREEcore = await import('three');
    M.setMeshMaterialBackend('WEBGL');
    const m = M.createSurfaceMaterial({ color: '#f3f0e8' }, 'bone'), other = M.createSurfaceMaterial({ color: '#f3f0e8' }, 'soft');
    const sh = () => ({ uniforms: {}, fragmentShader: THREEcore.ShaderLib.standard.fragmentShader });
    const a = sh(), b = sh(); m.onBeforeCompile(a); other.onBeforeCompile(b);
    expect(a.uniforms.vrlMeshMat.value.toArray()).toEqual([L.AMBIENT, L.SPEC, L.SHININESS]);
    M.setSegmentMeshMaterial('bone', 'plastic');
    expect(a.uniforms.vrlMeshMat.value.toArray()).toEqual(L.materialVec('plastic').slice(0, 3));
    expect(b.uniforms.vrlMeshMat.value.toArray()).toEqual([L.AMBIENT, L.SPEC, L.SHININESS]); // another segment is not touched
    M.setSegmentMeshMaterial('bone', 'nonsense');
    expect(a.uniforms.vrlMeshMat.value.toArray()).toEqual([L.AMBIENT, L.SPEC, L.SHININESS]);
    M.setMeshMaterialBackend('WEBGPU');
    const g1 = M.createSurfaceMaterial({ color: '#fff' }, 'fat'), g2 = M.createSurfaceMaterial({ color: '#fff' }, 'fat'), g3 = M.createSurfaceMaterial({ color: '#fff' }, 'lung');
    expect(g1.colorNode).toBe(g2.colorNode); // one node per segment
    expect(g1.colorNode).not.toBe(g3.colorNode);
    expect(L.meshColorNode(THREE.TSL, { center: THREE.TSL.uniform(5), radius: THREE.TSL.uniform(2) }, THREE.TSL.uniform(new THREE.Vector3(0.24, 0.5, 60))).isNode).toBe(true);
  });
});
