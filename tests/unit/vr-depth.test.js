import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
// the volume writes depth (gl_FragDepth) and the distance labels / lines / leaders are depth tested + drawn again as a faint ghost behind the tissue.
// vr-depth.js is pure; vr-measure.js is checked with a three.js scene (no GL); vr-view.js (WebXR, not run in node) and its shader are checked on the source.
const ver = JSON.parse(readFileSync(new URL('../../docs/version.json', import.meta.url), 'utf8')).version, tag = '?v=' + ver.replace(/\./g, '').replace(/-(\d+)$/, '-build$1');
const load = f => import(/* @vite-ignore */ '../../docs/' + f + '.js' + tag);
const { LABEL_HIDE_REAL, LABEL_HIDE_FADE, LABEL_HIDE_DEFAULT, normalizeLabelHide, gpuOcclusionActive, GHOST_ALPHA, DEPTH_BIAS_RAY, DEPTH_BIAS_MIN, depthBias, depthVoxelSize, biasedT, boardVisible, clipDepth, perspectiveDepth } = await load('vr-depth');
const { createVrMeasure } = await load('vr-measure');
const { addMeasurement, getMeasurements, resetMeasurements } = await load('measurements');
const { setComments, addComment, createComment, setMarkersShown } = await load('comments');
const { datasetFingerprint } = await load('project-file');
const { probeKey, LABEL_MID } = await load('measure-label');
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
// source checks compare with all white space removed, so a reformatting (line breaks, indentation) of the shader / JS does not break them; a missing token still does
const squash = t => t.replace(/\s+/g, ''), has = (text, piece) => squash(text).includes(squash(piece));

describe('the setting 「ラベルの隠れ方」', () => {
  it('defaults to 実際に隠す (1); only an explicit 0 selects the fade; garbage / missing falls back to the default', () => {
    expect(LABEL_HIDE_DEFAULT).toBe(LABEL_HIDE_REAL); expect(LABEL_HIDE_REAL).toBe(1); expect(LABEL_HIDE_FADE).toBe(0);
    for (const v of [undefined, null, 1, '1', true, 'x', NaN, 2]) expect(normalizeLabelHide(v), String(v)).toBe(1);
    for (const v of [0, '0', false]) expect(normalizeLabelHide(v), String(v)).toBe(0);
  });
  it('vr-view.js: DEFAULTS carry it, the settings merge keeps a saved 0 and gives old saves the default, and the 位置 tab offers the two choices', () => {
    expect(src).toMatch(/const DEFAULTS=\{[^}]*labelHide:LABEL_HIDE_DEFAULT/);
    expect(has(src, "const st=JSON.parse(n||o||'{}'),v={...DEFAULTS,...st")).toBe(true); // a key missing in an old save takes the default, a saved 0 wins
    expect(has(src, "lbHide:'ラベルの隠れ方',lbHideV:['実際に隠す','薄くする']")).toBe(true);
    expect(src).toMatch(/choice\(y0\+104,L\.lbHide,L\.lbHideV\.map\(\(t,i\)=>\(\{label:t,value:1-i\}\)\),normalizeLabelHide\(settings\.labelHide\)/);
  });
  it('GPU occlusion runs for the default and for a standard depth buffer only; the fade setting or a log / reversed depth buffer falls back to the CPU fade', () => {
    expect(gpuOcclusionActive(undefined, {})).toBe(true); expect(gpuOcclusionActive(1, { logarithmicDepthBuffer: false, reversedDepthBuffer: false })).toBe(true);
    expect(gpuOcclusionActive(0, {})).toBe(false); expect(gpuOcclusionActive(1, { logarithmicDepthBuffer: true })).toBe(false); expect(gpuOcclusionActive(1, { reversedDepthBuffer: true })).toBe(false); expect(gpuOcclusionActive(1, null)).toBe(false);
  });
  it('vr-view.js: the CPU probes of the distances are skipped while the GPU occlusion is on', () => {
    expect(has(src, 'mps=gpuOcc?[]:vpMeasure.probes()')).toBe(true);
    expect(has(src, 'pts=gpuOcc?[]:vpMarkers.centres()')).toBe(true); // nor the point markers' (their depth test + ghost do it)
    expect(has(src, 'preview:previewArg,occlusion:occlusionGpu()})')).toBe(true); // the markers get the same switch
    expect(has(src, 'if(!mps.length){if(vpMeasHidden.size)vpMeasHidden=new Set();measGate.reset();return}')).toBe(true);
    expect(has(src, 'occlusion:occlusionGpu()})')).toBe(true);
  });
});

describe('the depth formula (the same as the fragment shader)', () => {
  const cam = new THREE.PerspectiveCamera(70, 1.1, 0.01, 50); cam.position.set(0.05, 1.5, 0.2); cam.lookAt(0, 1.3, -0.65); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const obj = new THREE.Object3D(); obj.position.set(0, 1.3, -0.65); obj.scale.setScalar(0.05); obj.rotation.set(0.3, -0.7, 0.1); obj.updateMatrixWorld();
  const mv = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, obj.matrixWorld);
  it('clipDepth = the window depth three.js gives the same point (project(): ndc z * 0.5 + 0.5)', () => {
    for (const p of [[0, 0, 0], [1, 0.5, -0.3], [-2, 1, 2], [0.1, -1.5, 0.8]]) {
      const w = new THREE.Vector3(...p).applyMatrix4(obj.matrixWorld).project(cam);
      expect(clipDepth(mv.elements, cam.projectionMatrix.elements, p)).toBeCloseTo(w.z * 0.5 + 0.5, 6);
    }
  });
  it('perspectiveDepth(zEye) agrees with the matrix, grows with the distance and is 0 / 1 at the near / far plane', () => {
    expect(perspectiveDepth(-0.01, 0.01, 50)).toBeCloseTo(0, 6); expect(perspectiveDepth(-50, 0.01, 50)).toBeCloseTo(1, 6);
    const w = new THREE.Vector3(0.2, 1.2, -1.0).project(cam), z = new THREE.Vector3(0.2, 1.2, -1.0).applyMatrix4(cam.matrixWorldInverse).z;
    expect(perspectiveDepth(z, 0.01, 50)).toBeCloseTo(w.z * 0.5 + 0.5, 6);
    expect(perspectiveDepth(-0.5, 0.01, 50)).toBeLessThan(perspectiveDepth(-0.6, 0.01, 50));
  });
  it('a point behind the camera plane has no depth (the shader keeps the box face depth); the result is clamped to 0..1', () => {
    expect(clipDepth(cam.matrixWorldInverse.elements, cam.projectionMatrix.elements, [0.05, 1.5, 5])).toBeNull();
    expect(clipDepth(cam.matrixWorldInverse.elements, cam.projectionMatrix.elements, [0, 1.3, -500])).toBe(1);
  });
  it('the bias = DEPTH_BIAS_RAY * the voxel extent along the ray + DEPTH_BIAS_MIN * voxelMin; the shader uses the same constants and formula', () => {
    expect(DEPTH_BIAS_RAY).toBe(0.5); expect(DEPTH_BIAS_MIN).toBe(1.5);
    expect(squash(src)).toMatch(new RegExp('constfloatDEPTH_BIAS_RAY=' + DEPTH_BIAS_RAY.toFixed(1) + ';'));
    expect(squash(src)).toMatch(new RegExp('constfloatDEPTH_BIAS_MIN=' + DEPTH_BIAS_MIN.toFixed(1) + ';'));
    expect(has(src, 'uniform vec3 voxelSize;')).toBe(true);
    expect(has(src, 'float depthBias(vec3 d){return DEPTH_BIAS_RAY*dot(abs(d),voxelSize)+DEPTH_BIAS_MIN*voxelMin;}')).toBe(true);
    expect(has(src, 'gDepthT+depthBias(dir)')).toBe(true);
    expect(biasedT(0.4, [0, 0, 1], [0.1, 0.1, 0.5], 0.1)).toBeCloseTo(0.4 + 0.5 * 0.5 + 1.5 * 0.1, 12);
  });
  it('isotropic data keeps at least the bias (2 voxels) along any ray; an anisotropic spacing grows it along the coarse axis (points sit at voxel centres)', () => {
    const v = 0.03, iso = [v, v, v], dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0, 0.8], [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)], [-0.48, 0.64, -0.6]];
    for (const d of dirs) { const b = depthBias(d, iso, v); expect(b, d.join()).toBeGreaterThanOrEqual(2 * v - 1e-12); expect(b, d.join()).toBeLessThanOrEqual(2.4 * v); }
    // 0.1 / 0.1 / 0.5 mm: voxelMin = 0.1, the z voxel is 5x. Along z a point at a voxel centre can lie 0.25 inside the surface: the bias must cover that (+ the 1.5 voxelMin of the march)
    const an = [0.02, 0.02, 0.1], z = depthBias([0, 0, 1], an, 0.02), x = depthBias([1, 0, 0], an, 0.02);
    expect(z).toBeGreaterThanOrEqual(0.5 * 0.1 + 1.5 * 0.02 - 1e-12); expect(z).toBeGreaterThan(x * 1.5); expect(x).toBeCloseTo(2 * 0.02, 12);
    expect(z).toBeGreaterThan(2 * 0.02); // more than the old 2 * voxelMin
  });
  it('depthVoxelSize: the object-space voxel size per axis, the coarser of the rendered grid and the data grid', () => {
    expect(depthVoxelSize([1, 2, 3], [100, 100, 60], [100, 100, 60])).toEqual([0.02, 0.04, 0.1]);
    expect(depthVoxelSize([1, 2, 3], [128, 128, 64], [100, 100, 60])).toEqual([0.02, 0.04, 0.1]); // the data grid is coarser than the rendered one
    expect(depthVoxelSize([1, 2, 3], [100, 100, 60], null)).toEqual([0.02, 0.04, 0.1]);
    expect(depthVoxelSize([1, 2, 3], [100, 100, 60], [200, 200, 120])).toEqual([0.02, 0.04, 0.1]); // finer data: the rendered grid decides
  });
  it('vr-view.js: the voxelSize uniform is declared, initialised and refreshed with voxelMin', () => {
    expect(has(src, 'voxelMin:{value:1},voxelSize:{value:new THREE.Vector3(1,1,1)}')).toBe(true);
    expect(has(src, 'material.uniforms.voxelSize.value.set(...depthVoxelSize(vd.halfExt,t.dims,')).toBe(true);
  });
});

describe('the menu / help boards: a board covered by the tissue is not hit', () => {
  it('boardVisible: a hit is visible unless the volume surface along the same ray is nearer; no board hit = not visible', () => {
    expect(boardVisible({ distance: 1.0 }, null)).toBe(true); expect(boardVisible({ distance: 1.0 }, undefined)).toBe(true);
    expect(boardVisible({ distance: 1.0 }, 1.5)).toBe(true); // the board is in front of the tissue
    expect(boardVisible({ distance: 1.0 }, 0.6)).toBe(false); // the tissue is nearer: the board is inside / behind it (hidden by the depth test)
    expect(boardVisible({ distance: 1.0 }, 1.0)).toBe(true); // a tie keeps the board
    expect(boardVisible(null, 0.5)).toBe(false); expect(boardVisible(null, null)).toBe(false);
  });
  it('vr-view.js: boardHits drops the menu / help / histogram-board hit by that rule (rings keep theirs: no depth test); the boards stay depth tested', () => {
    const bh = src.slice(src.indexOf('const boardHits=c=>{'), src.indexOf('help.onDraw('));
    expect(has(bh, 'o.menu=menuHit(c);o.help=helpHit(c);o.hist=histHit(c);o.wheel=ringHit(c,wheel);o.pwheel=ringHit(c,pointWheel);')).toBe(true);
    expect(has(bh, 'if(o.menu||o.help||o.hist||o.ev){const tv=volumeHit(c)?.distance;if(!boardVisible(o.menu,tv))o.menu=null;if(!boardVisible(o.help,tv))o.help=null;if(!boardVisible(o.hist,tv))o.hist=null;if(!boardVisible(o.ev,tv))o.ev=null}')).toBe(true);
    expect(bh.indexOf('boardVisible(o.menu')).toBeLessThan(bh.indexOf('let bd=Infinity')); // before the nearest board is chosen
    expect(bh).not.toMatch(/boardVisible\(o\.(wheel|pwheel)/);
    expect(has(src, 'new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false}));let widgets=[]')).toBe(true);
  });
});

describe('the fragment shader writes depth (source checks)', () => {
  const fs = src.slice(src.indexOf('const fragmentShader=`'), src.indexOf('// brick min/max in HU'));
  it('every path has a value (default = the box face), a surface hit / the cut face set the first-hit depth with the two matrices, a miss still discards', () => {
    expect(has(fs, 'void main(){\n gl_FragDepth=gl_FragCoord.z;')).toBe(true);
    expect(has(fs, 'uniform mat4 projectionMatrix;')).toBe(true); expect(has(fs, 'uniform mat4 modelViewMatrix;')).toBe(true);
    expect(has(fs, 'projectionMatrix*(modelViewMatrix*vec4(o+dir*(gDepthT+depthBias(dir)),1.0))')).toBe(true);
    expect(has(fs, 'if(acc.a<0.004)discard;')).toBe(true);
    expect((fs.match(/depthMark\(/g) || []).length).toBe(1 + 5 + 1); // the function + 3 non-opaque hits + 2 cut faces + the post-loop hit (a slice writes no depth: the section frame lies in front of what is behind it, see vr-section-frame.test.js)
    expect(fs.indexOf('if(acc.a<0.004)discard;')).toBeLessThan(fs.indexOf('gl_FragDepth=clamp('));
  });
  it('the parity anchor of the harness (the post-loop hit shading) is intact', () => {
    expect(has(fs, 'float contribution=(1.0-acc.a)*alpha;acc=vec4(acc.rgb+lit*contribution,acc.a+contribution);hitEnd=true;')).toBe(true);
  });
  it('the volume and composite materials write depth in the opaque pass (CustomBlending is kept), the low-res target has a depth texture the composite writes back', () => {
    expect(has(src, 'material.transparent=false;material.depthWrite=true;material.blending=THREE.CustomBlending;')).toBe(true);
    expect(has(src, 'base.transparent=false;base.depthWrite=true;base.blending=THREE.CustomBlending;')).toBe(true);
    expect(has(src, 'depthBuffer:true,depthTexture:new THREE.DepthTexture(w,h)')).toBe(true); // both offscreen targets (centre / periphery) come from newLowTarget
    expect(has(src, 'renderer.clear(true,true,false)')).toBe(true);
    expect(has(src, 'd=texture(depthImg,uv).r;')).toBe(true); expect(has(src, 'gl_FragDepth=d;')).toBe(true); // the depth of the sample that is shown (centre or periphery)
    expect(has(src, 'cu.depthImg.value=lowTarget.depthTexture')).toBe(true); expect(has(src, 'cu.depthImg2.value=periTarget.depthTexture')).toBe(true);
    expect((src.match(/toneMapped:false,depthWrite:true,transparent:false/g) || []).length).toBe(2); // both composite materials (warm-up and session)
  });
});

describe('collateral: what lies inside the volume stays visible (source checks)', () => {
  it('the section frame starts without a depth test and never writes depth; the glow has no depth test; all are drawn after the volume; the boards (menu / help), the hand cue and the laser keep the depth test (they are outside the volume)', () => {
    expect(has(src, "new THREE.LineBasicMaterial({color,transparent:true,depthTest:false,depthWrite:false}),h=0.12")).toBe(true);
    expect(has(src, 'frameLine.renderOrder=2')).toBe(true); expect(has(src, 'arrow.renderOrder=2')).toBe(true); expect(has(src, 'glow.renderOrder=3')).toBe(true);
    expect(src).toMatch(/MeshBasicMaterial\(\{color:0xffffff,transparent:true,opacity:0\.95,side:THREE\.DoubleSide,depthTest:false,depthWrite:false/);
    expect(has(src, 'new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false}));let widgets=[]')).toBe(true); // the boards: a board BEHIND the volume must stay covered by it
    expect(has(src, "{const top=!!rh||res.kind==='point'||res.kind==='mlabel'||res.kind==='section'||!!bd.hu;ray.renderOrder=dot.renderOrder=bd.hu?11:top?8:0;")).toBe(true); // the laser ends on a point / label / frame inside the volume: drawn on top
  });
  it('the cursors, rings and the scale tag already have no depth test (the point markers do, only with the GPU occlusion: see vr-point-markers.test.js)', () => {
    for (const f of ['vr-ring', 'vr-real-scale']) {
      const t = readFileSync(new URL('../../docs/' + f + '.js', import.meta.url), 'utf8');
      expect(t.includes('depthTest:false') || t.includes('depthTest: false'), f).toBe(true);
      expect(t.includes('depthTest:true') || t.includes('depthTest: true'), f).toBe(false);
    }
  });
});

describe('vr-measure.js: depth test + ghost, lit on top, fade mode unchanged', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
  beforeEach(() => { vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }); setComments([]); resetMeasurements(); setMarkersShown(true); });
  afterEach(() => vi.unstubAllGlobals());
  const series = { id: 's::1', description: 'synthetic', modality: 'CT', columns: 16, rows: 16, spacingX: 0.1, spacingY: 0.2, spacingZ: 0.5, slices: Array.from({ length: 12 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: 'q', instanceUid: 'i0' })) };
  const fp = datasetFingerprint(series);
  const make = () => {
    for (const [id, i, j, k] of [['p1', 2, 3, 1], ['p2', 12, 9, 8]]) addComment(createComment({ text: id, position: { i, j, k }, series: fp, id }));
    const m = addMeasurement('p1', 'p2'), scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), holder = new THREE.Group();
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.05); holder.add(mesh); scene.add(holder); scene.updateMatrixWorld(true);
    const base = { fingerprint: fp, dims: { columns: 16, rows: 16, slices: 12 }, halfExt: [8, 8, 6], mesh, head: new THREE.Vector3(0, 1.6, 0), spacing: [0.1, 0.2, 0.5], hint: '' };
    const v = createVrMeasure(THREE, scene), settle = args => { let t = 1000; for (let i = 0; i < 30; i++) v.update({ ...args, now: (t += 50) }) };
    v.update(base);
    const label = scene.children.find(o => o.isMesh && o.renderOrder === 6), line = scene.children.find(o => o.isLine && o.geometry.attributes.position.count > 2), leader = scene.children.find(o => o.isLine && o.geometry.attributes.position.count === 2);
    return { m, scene, base, v, label, line, leader, settle };
  };
  it('occlusion on: line / leader / label are depth tested without writing depth; each has a ghost child (GreaterDepth, GHOST_ALPHA) sharing the geometry', () => {
    const { v, base, label, line, leader, settle } = make();
    settle({ ...base, occlusion: true });
    for (const o of [label, line, leader]) {
      expect(o.material.depthTest, o.type).toBe(true); expect(o.material.depthWrite, o.type).toBe(false);
      expect(o.children.length).toBe(1); const g = o.children[0];
      expect(g.geometry).toBe(o.geometry); expect(g.material.depthFunc).toBe(THREE.GreaterDepth); expect(g.material.depthTest).toBe(true); expect(g.material.depthWrite).toBe(false); expect(g.material.visible).toBe(true); expect(g.renderOrder).toBe(o.renderOrder);
    }
    expect(label.children[0].material.opacity).toBeCloseTo(GHOST_ALPHA, 6); expect(line.children[0].material.opacity).toBeCloseTo(0.95 * GHOST_ALPHA, 6); expect(leader.children[0].material.opacity).toBeCloseTo(0.6 * GHOST_ALPHA, 6);
    expect(label.material.opacity).toBe(1); v.dispose();
  });
  it('a lit (laser on it / grabbed) label and its leader are fully on top (no depth test, no ghost); the line keeps the depth test', () => {
    const { m, v, base, label, line, leader, settle } = make();
    settle({ ...base, occlusion: true, lit: new Set([m.id]) });
    expect(label.material.depthTest).toBe(false); expect(label.children[0].material.visible).toBe(false); expect(leader.material.depthTest).toBe(false); expect(leader.children[0].material.visible).toBe(false);
    expect(line.material.depthTest).toBe(true); expect(line.children[0].material.visible).toBe(true);
    settle({ ...base, occlusion: true }); expect(label.material.depthTest).toBe(true); expect(label.children[0].material.visible).toBe(true);
    v.dispose();
  });
  it('occlusion on ignores the CPU judgement (hidden): nothing fades; picking is still geometric', () => {
    const { m, v, base, label, line, settle } = make(), hid = new Set([probeKey(m.id, LABEL_MID), probeKey(m.id, 3)]);
    settle({ ...base, occlusion: true, hidden: hid }); expect(label.material.opacity).toBe(1); expect(line.geometry.attributes.color.getW(3)).toBe(1);
    const o = label.position.clone().add(new THREE.Vector3(0, 0, 0.5)); expect(v.pickLabel(o, new THREE.Vector3(0, 0, -1))?.id).toBe(m.id); v.dispose();
  });
  it('occlusion off (薄くする): no depth test, no ghost, the CPU fade-494', () => {
    const { m, v, base, label, line, leader, settle } = make();
    settle({ ...base, occlusion: true }); settle({ ...base, occlusion: false, hidden: new Set([probeKey(m.id, LABEL_MID)]) });
    for (const o of [label, line, leader]) { expect(o.material.depthTest, o.type).toBe(false); expect(o.children[0].material.visible, o.type).toBe(false); }
    expect(label.material.opacity).toBeCloseTo(0.3, 6); v.dispose();
  });
  it('dispose removes everything (ghosts are children: nothing is left in the scene)', () => {
    const { scene, v } = make(); expect(getMeasurements().length).toBe(1); v.dispose(); expect(scene.children.filter(o => o.renderOrder >= 4).length).toBe(0);
  });
});

describe('GHOST_ALPHA and the pass rule', () => {
  it('the ghost is 0.15 (fainter than-500: 0.3); one constant, every ghosted object takes it', async () => {
    expect(GHOST_ALPHA).toBe(0.15);
    const { occludedPass } = await load('vr-depth');
    expect(occludedPass(true, false)).toBe(true); expect(occludedPass(true, true)).toBe(false); expect(occludedPass(false, false)).toBe(false); expect(occludedPass(false, true)).toBe(false); expect(occludedPass(undefined, false)).toBe(false);
    for (const f of ['vr-measure', 'vr-point-markers']) { const t = readFileSync(new URL('../../docs/' + f + '.js', import.meta.url), 'utf8'); expect(t, f).toMatch(/GHOST_ALPHA/); expect(t, f).not.toMatch(/[^_A-Z]0\.15\b|opacity:0\.3\b/); }
  });
  it('vr-view.js: pinned result labels (card + leader) have a ghost too and follow the setting; the hand labels are untouched', () => {
    expect(has(src, 'const makeLabel=(pin=false)=>{')).toBe(true); expect(has(src, 'lb=makeLabel(true);lb.rid=reg.id;pins.set(reg.id,lb)')).toBe(true);
    expect(has(src, 'syncPins();for(const lb of pins.values()){lb.lit=pinLit.has(lb.rid);placeLabel(lb);pinOcclusion(lb,lb.lit)}')).toBe(true);
    expect(has(src, 'const occ=occludedPass(occlusionGpu(),lit);')).toBe(true);
    expect(has(src, 'const hoverLabelOf=c=>c.userData.hoverLabel||=Object.assign(makeLabel(),{hand:c});')).toBe(true);
  });
});

describe('vr-point-markers.js: depth test + ghost, lit on top, fade mode unchanged', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
  beforeEach(() => { vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }); setComments([]); setMarkersShown(true) });
  afterEach(() => vi.unstubAllGlobals());
  const make = async () => {
    const { createVrPointMarkers } = await load('vr-point-markers');
    const ser = { id: 's::1', description: 'synthetic', modality: 'CT', columns: 10, rows: 8, spacingX: 1, spacingY: 1, spacingZ: 2, slices: Array.from({ length: 6 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: '1' })) }, fp = datasetFingerprint(ser);
    const c = addComment(createComment({ text: 'a', position: { i: 3, j: 3, k: 2 }, series: fp, id: 'p1' }));
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)); scene.add(mesh); scene.updateMatrixWorld(true);
    const m = createVrPointMarkers(THREE, scene), base = { fingerprint: fp, dims: { columns: 10, rows: 8, slices: 6 }, halfExt: [5, 4, 6], mesh, head: new THREE.Vector3(0, 0, 3) };
    m.update(base);
    const by = ro => scene.children.find(o => o.renderOrder === ro && o.geometry?.type === 'SphereGeometry'), sphere = by(4), rim = by(3), halo = by(2), line = scene.children.find(o => o.isLine), chip = scene.children.find(o => o.renderOrder === 5);
    return { m, scene, base, sphere, rim, halo, line, chip, id: c.id };
  };
  const ghostOk = (o, opacity) => { expect(o.children.length, o.type).toBe(1); const g = o.children[0]; expect(g.geometry).toBe(o.geometry); expect(g.material.depthFunc).toBe(THREE.GreaterDepth); expect(g.material.depthTest).toBe(true); expect(g.material.depthWrite).toBe(false); expect(g.material.opacity).toBeCloseTo(opacity * GHOST_ALPHA, 6); expect(g.renderOrder).toBe(o.renderOrder); return g };
  const SEC = { x: 1, y: 0, z: 0, w: 0 }; // an active section the point is off: the perpendicular is drawn
  it('occlusion on: sphere, rim, chip and perpendicular are depth tested (no depth write) with a ghost child each at GHOST_ALPHA; the CPU hidden look is not used', async () => {
    const { m, base, sphere, rim, line, chip, id } = await make();
    m.update({ ...base, occlusion: true, section: SEC, hidden: new Set([id]) });
    for (const o of [sphere, rim, line, chip]) { expect(o.material.depthTest, o.type).toBe(true); expect(o.material.depthWrite, o.type).toBe(false); }
    expect(line.visible).toBe(true); expect(rim.visible).toBe(true); // hidden is ignored: the exposed look (white rim), not the small dot
    expect(ghostOk(sphere, 1).visible).toBe(true); expect(rim.children[0].visible).toBe(true); expect(line.children[0].visible).toBe(true); expect(chip.children[0].visible).toBe(true);
    ghostOk(rim, 1); ghostOk(line, 0.6); ghostOk(chip, 1);
    expect(sphere.material.color.getHex()).toBe(sphere.children[0].material.color.getHex());
    m.dispose();
  });
  it('the same marker without hidden and with hidden looks the same under occlusion (the CPU judgement is not read)', async () => {
    const { m, base, sphere, rim, id } = await make();
    m.update({ ...base, occlusion: true }); const a = [sphere.material.color.getHex(), rim.visible]; m.update({ ...base, occlusion: true, hidden: new Set([id]) });
    expect([sphere.material.color.getHex(), rim.visible]).toEqual(a); m.dispose();
  });
  it('a hovered / selected / moved point is fully on top: no depth test, no ghost, halo drawn; the neighbours stay depth tested', async () => {
    const { m, base, sphere, rim, line, chip, halo, id } = await make();
    for (const extra of [{ hover: new Set([id]) }, { selectedId: id }, { preview: { id, voxel: { i: 4, j: 3, k: 2 } } }]) {
      m.update({ ...base, occlusion: true, section: SEC, ...extra });
      for (const o of [sphere, rim, line, chip]) { expect(o.material.depthTest, Object.keys(extra)[0] + ' ' + o.type).toBe(false); expect(o.children[0].visible, Object.keys(extra)[0] + ' ' + o.type).toBe(false); }
    }
    m.update({ ...base, occlusion: true, hover: new Set([id]) }); expect(halo.visible).toBe(true);
    m.update({ ...base, occlusion: true, hover: new Set(['other']) }); expect(sphere.material.depthTest).toBe(true); expect(sphere.children[0].visible).toBe(true);
    m.dispose();
  });
  it('occlusion off (薄くする / no usable GPU depth): nothing depth tested, no ghost, the CPU hidden look as before', async () => {
    const { m, base, sphere, rim, line, chip, id } = await make();
    m.update({ ...base, occlusion: true, section: SEC }); m.update({ ...base, occlusion: false, section: SEC, hidden: new Set([id]) });
    for (const o of [sphere, rim, line, chip]) { expect(o.material.depthTest, o.type).toBe(false); expect(o.children[0].visible, o.type).toBe(false); }
    expect(rim.visible).toBe(false); // hidden = the small dot without the rim
    m.update({ ...base, section: SEC }); expect(rim.visible).toBe(true); expect(sphere.material.depthTest).toBe(false); m.dispose();
  });
  it('dispose leaves nothing in the scene', async () => {
    const { m, scene } = await make(); const n = scene.children.length; m.dispose(); expect(scene.children.length).toBe(n - 5);
  });
});
