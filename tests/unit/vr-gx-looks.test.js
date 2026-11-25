import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import * as G from '../../docs/vr-gx-looks.js';
import { createPlainLabelBatch, setLegEnds } from '../../docs/vr-label-batch.js';
import { LEG_WIDTH_M, LEG_MIN_ANGLE } from '../../docs/vr-anchor-dots.js';

// The WebGPU session's looks (laser ribbon, label legs, background dome) in TSL: the values are the production GLSL's (docs/vr-view.js makeLaser / makeBackground, docs/vr-anchor-dots.js createLegMesh).
// The GLSL texts are read from the source files here, so a change of a value there that is not made in docs/vr-gx-looks.js fails this file.
const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const view = read('vr-view.js'), dots = read('vr-anchor-dots.js');
const num = s => +s;

describe('the values are the GLSL ones', () => {
  it('LASER_LOOKS is the table of vr-view.js (look 0 = the line, 1 = thin 1 mm tip 0.3, 2 = thick 1.5 mm no taper)', () => {
    const m = view.match(/const LASER_LOOKS=\[\{line:true\},\{w:([\d.]+),t:([\d.]+)\},\{w:([\d.]+),t:([\d.]+)\}\]/);
    expect(m).toBeTruthy();
    expect(G.LASER_LOOKS).toEqual([{ line: true }, { w: num(m[1]), t: num(m[2]) }, { w: num(m[3]), t: num(m[4]) }]);
    expect(G.LASER_LOOKS[1]).toEqual({ w: 0.001, t: 0.3 }); expect(G.LASER_LOOKS[2]).toEqual({ w: 0.0015, t: 1 });
  });
  it('the laser fragment constants (core 0.55, white mix 0.6, tip alpha 0.3, opacity floor 0.05, exponent 2 - log(op)/log(0.22) >= 0.3) are in the GLSL', () => {
    expect(view).toContain('core=smoothstep(0.55,0.,x)');
    expect(view).toContain('mix(color,vec3(1.),core*0.6)');
    expect(view).toContain('mix(1.,0.3,min(vU.y*vL,1.))');
    expect(view).toContain('max(2.-log(max(opacity,0.05))/log(0.22),0.3)');
    expect(view).toContain('mix(1.,taper,min(t*L,1.))');
    expect(view).toContain('new THREE.Color(0x88ccff)');
    expect([G.LASER_CORE_EDGE, G.LASER_CORE_MIX, G.LASER_TIP_ALPHA, G.LASER_OPACITY_FLOOR, G.LASER_POWER_BASE, G.LASER_POWER_MIN, G.LASER_POWER_OFFSET, G.LASER_COLOR]).toEqual([0.55, 0.6, 0.3, 0.05, 0.22, 0.3, 2, 0x88ccff]);
  });
  it('the leg: width 2.4 mm, minimum angle 0.0025 rad, feather from 0.6 (vr-anchor-dots.js)', () => {
    expect([G.LEG_WIDTH_M, G.LEG_MIN_ANGLE]).toEqual([LEG_WIDTH_M, LEG_MIN_ANGLE]);
    expect(dots).toContain('smoothstep(0.6,1.,abs(vS))');
    expect(dots).toContain('max(width,length(cameraPosition-position)*minAngle)');
    expect(dots).toContain('position+s*aux.x*w*0.5');
    expect(G.LEG_FEATHER_FROM).toBe(0.6);
  });
  it('the dome: sphere 30 x 32 x 16, lo (0.035, 0.045, 0.05), hi (0.10, 0.14, 0.20), smoothstep(-0.1, 0.8, h)', () => {
    expect(view).toContain('new THREE.SphereGeometry(30,32,16)');
    expect(view).toContain('vec3 lo=vec3(0.035,0.045,0.05);vec3 hi=vec3(0.10,0.14,0.20);');
    expect(view).toContain('mix(lo,hi,smoothstep(-0.1,0.8,h))');
    expect([G.DOME_RADIUS, ...G.DOME_SEGMENTS, ...G.DOME_LO, ...G.DOME_HI, ...G.DOME_EDGE]).toEqual([30, 32, 16, 0.035, 0.045, 0.05, 0.10, 0.14, 0.20, -0.1, 0.8]);
  });
});

describe('the pure twins of the shader maths', () => {
  it('smoothstepGlsl: the reversed ramp (edge0 > edge1) equals 1 - the forward ramp (the TSL uses the forward one)', () => {
    for (const x of [0, 0.1, 0.3, 0.55, 0.8, 1]) expect(G.smoothstepGlsl(0.55, 0, x)).toBeCloseTo(1 - G.smoothstepGlsl(0, 0.55, x), 12);
    expect(G.smoothstepGlsl(0, 1, 0.5)).toBe(0.5);
  });
  it('laser: opaque core in the middle, white mixed in 0.6, transparent at the edge, fading to 0.3 at 1 m or more', () => {
    const c = [0.2, 0.4, 0.6];
    const mid = G.laserFragment(0, 0, 1, 1, c);
    expect(mid[3]).toBeCloseTo(1, 12); expect(mid[0]).toBeCloseTo(0.2 + 0.8 * 0.6, 12);
    expect(G.laserFragment(1, 0, 1, 1, c)[3]).toBeCloseTo(0, 12);
    expect(G.laserFragment(0, 1, 1, 1, c)[3]).toBeCloseTo(0.3, 12);
    expect(G.laserFragment(0, 0.5, 2, 1, c)[3]).toBeCloseTo(0.3, 12); // 0.5 * 2 m = 1 m
    expect(G.laserFragment(0, 0, 1, 0.5, c)[3]).toBeCloseTo(0.5, 12);
    expect(G.laserFragment(0.3, 0, 1, 1, c)[0]).toBeGreaterThan(c[0]); expect(G.laserFragment(0.6, 0, 1, 1, c)[0]).toBeCloseTo(c[0], 12); // no core beyond 0.55
  });
  it('laser width: width at the hand, tapering linearly to width * taper at 1 m, constant after', () => {
    expect(G.laserHalfWidth(0.001, 0.3, 0)).toBeCloseTo(0.001, 12); expect(G.laserHalfWidth(0.001, 0.3, 1)).toBeCloseTo(0.0003, 12); expect(G.laserHalfWidth(0.001, 0.3, 5)).toBeCloseTo(0.0003, 12);
    expect(G.laserHalfWidth(0.0015, 1, 0.7)).toBeCloseTo(0.0015, 12);
  });
  it('leg: never thinner than the angle, feathered edges', () => {
    expect(G.legWidthAt(0.5)).toBeCloseTo(0.0024, 12); expect(G.legWidthAt(2)).toBeCloseTo(0.005, 12);
    expect(G.legAlpha(0, 0.8)).toBeCloseTo(0.8, 12); expect(G.legAlpha(0.6, 1)).toBeCloseTo(1, 12); expect(G.legAlpha(-1, 1)).toBeCloseTo(0, 12);
  });
  it('dome: lo below -0.1, hi above 0.8, the smoothstep between', () => {
    expect(G.domeColor(-1)).toEqual([0.035, 0.045, 0.05]); expect(G.domeColor(1)).toEqual([0.10, 0.14, 0.20]);
    const m = G.domeColor(0.35); for (let i = 0; i < 3; i++) expect(m[i]).toBeCloseTo((G.DOME_LO[i] + G.DOME_HI[i]) / 2, 12);
  });
});

describe('the TSL materials are built', () => {
  it('laser: additive, double sided, no depth write, uniforms like the GLSL material (color / opacity / width / taper), node outputs set', () => {
    const m = G.createGxLaserMaterial();
    expect(m.blending).toBe(THREE.AdditiveBlending); expect(m.side).toBe(THREE.DoubleSide); expect(m.depthWrite).toBe(false); expect(m.transparent).toBe(true); expect(m.toneMapped).toBe(false);
    expect(m.uniforms.color.value.getHex()).toBe(0x88ccff); expect(m.uniforms.opacity.value).toBe(1); expect(m.uniforms.width.value).toBe(0.001); expect(m.uniforms.taper.value).toBe(0.3);
    expect(m.color).toBe(m.uniforms.color.value);
    expect(m.vertexNode && m.colorNode && m.opacityNode).toBeTruthy();
    m.uniforms.width.value = 0.0015; expect(m.uniforms.width.value).toBe(0.0015);
  });
  it('leg: a transparent double-sided node material with the leg\'s uniforms; geometry like createLegMesh (4 vertices, position / other / aux, 6 indices)', () => {
    const m = G.createGxLegMaterial(), g = G.createGxLegGeometry();
    expect(m.side).toBe(THREE.DoubleSide); expect(m.depthWrite).toBe(false); expect(m.transparent).toBe(true);
    expect([m.uniforms.width.value, m.uniforms.minAngle.value]).toEqual([LEG_WIDTH_M, LEG_MIN_ANGLE]);
    m.opacity = 0.4; expect(m.uniforms.opacity.value).toBe(0.4); expect(m.opacity).toBe(0.4);
    expect(g.attributes.position.count).toBe(4); expect(g.attributes.other.count).toBe(4); expect(Array.from(g.attributes.aux.array)).toEqual([-1, 1, -1, -1, 1, 1, 1, -1]); expect(g.index.count).toBe(6);
  });
  it('dome: a sphere (30, 32, 16) seen from inside, no depth write; encoded output gets a different colour node (decoded) than the raw one', () => {
    const a = G.createGxDome({ encoded: false }), b = G.createGxDome({ encoded: true });
    expect(a.geometry.parameters).toMatchObject({ radius: 30, widthSegments: 32, heightSegments: 16 });
    expect(a.material.side).toBe(THREE.BackSide); expect(a.material.depthWrite).toBe(false); expect(a.material.toneMapped).toBe(false);
    expect(a.material.colorNode).toBeTruthy(); expect(b.material.colorNode).not.toBe(a.material.colorNode);
  });
});

describe('createPlainLabelBatch: the legs are ribbons', () => {
  const mkLb = () => {
    const m = new THREE.Object3D(); m.material = { map: null, opacity: 0.9, depthTest: true }; m.visible = true;
    const pos = new Float32Array([0, 0, 0, 1, 2, 3, 0, 0, 0, 0, 0, 0]), oth = new Float32Array([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const line = { visible: true, renderOrder: 6, geometry: { attributes: { position: { array: pos }, other: { array: oth } } }, material: { color: new THREE.Color(0xff8000), opacity: 0.7, depthTest: false } };
    return { m, line };
  };
  it('setLegEnds writes A, B, A, B and the opposite ends (the corners of createLegMesh)', () => {
    const pos = new Float32Array(12), oth = new Float32Array(12);
    setLegEnds(pos, oth, [1, 2, 3, 4, 5, 6], [4, 5, 6, 1, 2, 3]);
    expect(Array.from(pos)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]); expect(Array.from(oth)).toEqual([4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3]);
  });
  it('defaults: the leg width and angle of vr-anchor-dots.js', () => {
    const scene = new THREE.Scene(), b = createPlainLabelBatch(THREE, scene, { w: 0.12, h: 0.036 }), lb = mkLb();
    b.add(lb); b.flush();
    const leg = scene.children.find(o => o.isMesh && o.geometry.attributes.other);
    expect(leg).toBeTruthy(); expect(leg.material.uniforms.width.value).toBe(LEG_WIDTH_M); expect(leg.material.uniforms.minAngle.value).toBe(LEG_MIN_ANGLE);
    expect(scene.children.some(o => o.isLine)).toBe(false);
  });
  it('flush: a shown leg gets its ends, colour, opacity, depthTest, renderOrder; a hidden one is not drawn; remove takes it out', () => {
    const scene = new THREE.Scene(), b = createPlainLabelBatch(THREE, scene, { w: 0.12, h: 0.036, legWidth: 0.004, legMinAngle: 0.003 }), lb = mkLb();
    b.add(lb); b.flush();
    const leg = scene.children.find(o => o.geometry.attributes.other);
    expect(leg.material.uniforms.width.value).toBe(0.004); expect(leg.material.uniforms.minAngle.value).toBe(0.003);
    expect(leg.visible).toBe(true); expect(Array.from(leg.geometry.attributes.position.array.slice(0, 6))).toEqual([0, 0, 0, 1, 2, 3]); expect(Array.from(leg.geometry.attributes.other.array.slice(0, 6))).toEqual([1, 2, 3, 0, 0, 0]);
    expect(leg.material.color.getHex()).toBe(new THREE.Color(0xff8000).getHex()); expect(leg.material.opacity).toBe(0.7); expect(leg.material.depthTest).toBe(false); expect(leg.renderOrder).toBe(6);
    expect(b.stats.legs).toBe(1);
    lb.line.visible = false; b.flush(); expect(leg.visible).toBe(false); expect(b.stats.legs).toBe(0);
    b.remove(lb); expect(scene.children.length).toBe(0);
  });
});
