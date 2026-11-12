import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { boxCoversView, pairComposites } from '../../docs/vr-render-scale.js';
import { createAtlasIndex, atlasPrimary } from '../../docs/vr-pair-view.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

const persp = (l, r, b, t, n = 0.05, f = 100) => { // three.js makePerspective layout (column major); l r b t = tangents of the half angles
  const L = -l * n, R = r * n, B = -b * n, T = t * n;
  return [2 * n / (R - L), 0, 0, 0, 0, 2 * n / (T - B), 0, 0, (R + L) / (R - L), (T + B) / (T - B), -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0];
};
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const model = (s, x, y, z) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1];
const VW = 1680, VH = 1760, HALF = [1, 1, 1];

// the reference: what the rasterizer draws of a BackSide box. A pixel is drawn when its ray (through the pixel centre) leaves the box at an eye depth between near and far
function pixelDrawn(m, half, view, proj, vw, vh, px, py) {
  const P = new THREE.Matrix4().fromArray(proj), V = new THREE.Matrix4().fromArray(view), M = new THREE.Matrix4().fromArray(m);
  const inv = new THREE.Matrix4().multiplyMatrices(V, M).invert(), pInv = P.clone().invert();
  const ndc = new THREE.Vector3((px + 0.5) / vw * 2 - 1, (py + 0.5) / vh * 2 - 1, -1).applyMatrix4(pInv); // a point of the ray on the near plane (eye space)
  const dir = ndc.clone().divideScalar(-ndc.z); // eye space, depth 1
  const o = new THREE.Vector3(0, 0, 0).applyMatrix4(inv), d = dir.clone().applyMatrix4(inv).sub(o);
  let t0 = -Infinity, t1 = Infinity;
  for (const a of ['x', 'y', 'z']) {
    const h = half[a === 'x' ? 0 : a === 'y' ? 1 : 2];
    if (Math.abs(d[a]) < 1e-15) { if (Math.abs(o[a]) > h) return false; continue; }
    let ta = (-h - o[a]) / d[a], tb = (h - o[a]) / d[a]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  const n = proj[14] / (proj[10] - 1), f = proj[14] / (proj[10] + 1);
  return t1 >= t0 && t1 >= n && t1 <= f;
}
const allDrawn = (m, half, view, proj, vw, vh, step = 40) => {
  for (let y = 0; y < vh; y += step) for (let x = 0; x < vw; x += step) if (!pixelDrawn(m, half, view, proj, vw, vh, x, y)) return false;
  for (const [x, y] of [[0, 0], [vw - 1, 0], [0, vh - 1], [vw - 1, vh - 1]]) if (!pixelDrawn(m, half, view, proj, vw, vh, x, y)) return false;
  return true;
};

describe('boxCoversView: true only when the box draws every pixel of the eye viewport', () => {
  const P = persp(1.0, 0.9, 1.1, 0.95); // asymmetric, as the Quest eyes
  it('the eye inside the box (max zoom, inside the volume): every pixel', () => {
    const m = model(0.5, 0, 0, 0);
    expect(boxCoversView(m, HALF, I, P, VW, VH)).toBe(true);
    expect(allDrawn(m, HALF, I, P, VW, VH)).toBe(true);
  });
  it('a big box just in front of the eye: every pixel', () => {
    const m = model(1, 0, 0, -1.2);
    expect(boxCoversView(m, HALF, I, P, VW, VH)).toBe(true);
    expect(allDrawn(m, HALF, I, P, VW, VH)).toBe(true);
  });
  it('a box that covers part of the view (beside, small, far, behind the eye): false', () => {
    expect(boxCoversView(model(1, 1.5, 0, -1.2), HALF, I, P, VW, VH)).toBe(false); // half the view
    expect(boxCoversView(model(0.1, 0, 0, -1), HALF, I, P, VW, VH)).toBe(false);
    expect(boxCoversView(model(1, 0, 0, -50), HALF, I, P, VW, VH)).toBe(false);
    expect(boxCoversView(model(1, 0, 0, +5), HALF, I, P, VW, VH)).toBe(false);
  });
  it('a box whose back faces are nearer than the near plane is not drawn there: false', () => {
    expect(boxCoversView(model(0.01, 0, 0, -0.02), HALF, I, persp(1, 1, 1, 1, 0.05), VW, VH)).toBe(false);
  });
  it('a box reaching past the far plane: false (its back faces are clipped there)', () => {
    expect(boxCoversView(model(10, 0, 0, -8), HALF, I, persp(1, 1, 1, 1, 0.05, 15), VW, VH)).toBe(false);
  });
  it('not a plain perspective (orthographic, skewed): false (the caller then draws both, as before)', () => {
    const O = new THREE.Matrix4().makeOrthographic(-1, 1, 1, -1, 0.05, 100).elements;
    expect(boxCoversView(model(0.5, 0, 0, 0), HALF, I, O, VW, VH)).toBe(false);
    const S = P.slice(); S[4] = 0.01; expect(boxCoversView(model(0.5, 0, 0, 0), HALF, I, S, VW, VH)).toBe(false);
  });
  it('random poses (turned, non-uniform halves, moved eyes): whenever it says true, the rasterizer reference draws every pixel; it says true often near the box', () => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let trues = 0, falses = 0;
    for (let k = 0; k < 400; k++) {
      const half = [0.3 + rnd(), 0.3 + rnd(), 0.3 + rnd()];
      const M = new THREE.Matrix4().compose(new THREE.Vector3((rnd() - 0.5) * 2, (rnd() - 0.5) * 2, -rnd() * 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)), new THREE.Vector3(1, 1, 1).multiplyScalar(0.3 + rnd() * 2));
      const E = new THREE.Matrix4().compose(new THREE.Vector3((rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4, 0)), new THREE.Vector3(1, 1, 1));
      const view = E.clone().invert().elements, proj = persp(0.8 + rnd() * 0.4, 0.8 + rnd() * 0.4, 0.8 + rnd() * 0.4, 0.8 + rnd() * 0.4, 0.02 + rnd() * 0.08, 50);
      const r = boxCoversView(M.elements, half, view, proj, 900, 1000);
      if (r) { trues++; expect(allDrawn(M.elements, half, view, proj, 900, 1000, 60)).toBe(true); } else falses++;
    }
    expect(trues).toBeGreaterThan(20); expect(falses).toBeGreaterThan(20);
  });
  it('no allocation per call is needed: the same answer on repeated calls', () => {
    const m = model(0.5, 0, 0, 0); for (let i = 0; i < 5; i++) expect(boxCoversView(m, HALF, I, P, VW, VH)).toBe(true);
  });
});

describe('pairComposites: the table (vr-view.js passes primaryOnly only, never partnerOnly)', () => {
  it('the table', () => {
    expect(pairComposites(true, true)).toEqual({ primary: true, partner: false });
    expect(pairComposites(true, false)).toEqual({ primary: true, partner: false });
    expect(pairComposites(false, true)).toEqual({ primary: false, partner: true });
    expect(pairComposites(false, false)).toEqual({ primary: true, partner: true }); // as before
    expect(pairComposites(false, false)).toBe(pairComposites(false, false)); // constant objects: nothing allocated per frame
  });
});

// the composite choice of the low-resolution path, run from its own source (vr-view.js) against mocks
const cStart = src.indexOf('    {const pt=pair&&pair.on&&pair.mesh.parent?pair:null;let pa=false;');
const cTail = 'compMaterial.visible=pc.primary;if(pt)pt.comp.visible=pc.partner}';
const cEnd = src.indexOf(cTail, cStart) + cTail.length;
const cSrc = src.slice(cStart, cEnd);
function runChoice({ pair, primaryM, cams }) {
  const compMaterial = { visible: 'unset', uniforms: { halfExt: { value: new THREE.Vector3(1, 1, 1) } } };
  const mesh = { matrixWorld: { elements: primaryM } };
  const env = { pair, cams, compMaterial, mesh, cmpHalf: [0, 0, 0], boxCoversView, pairComposites };
  new Function(...Object.keys(env), cSrc)(...Object.values(env));
  return compMaterial.visible;
}
const cam = (P = persp(1, 1, 1, 1)) => ({ viewport: { x: 0, y: 0, z: VW, w: VH }, matrixWorldInverse: { elements: I }, projectionMatrix: { elements: P } });
// nearer: the partner's box is nearer to the head than the primary's (pairFrame sets it; pairRender draws the nearer composite first)
const partner = (m, { on = true, nearer = false } = {}) => ({ on, nearer, mesh: { parent: {}, matrixWorld: { elements: m } }, comp: { visible: 'unset', uniforms: { halfExt: { value: new THREE.Vector3(1, 1, 1) } } } });

describe('vr-view.js low-resolution path: the partner\'s composite is left out only where it cannot change a pixel (the real source, mocked inputs)', () => {
  it('the source was found, right after the composite material is put on the primary\'s box, inside the low-resolution branch', () => {
    expect(cStart).toBeGreaterThan(0); expect(cEnd).toBeGreaterThan(cStart);
    const low = src.indexOf('    mesh.material=compMaterial;\n'), dir = src.indexOf('   }else{mesh.material=(diagAn.noRegion?plainSets().vars:variants)[vk];pairRender(false);');
    expect(low).toBeGreaterThan(0); expect(cStart).toBeGreaterThan(low); expect(dir).toBeGreaterThan(cEnd);
  });
  it('no partner: the primary\'s composite is drawn (as before)', () => {
    expect(runChoice({ pair: null, primaryM: model(0.5, 0, 0, 0), cams: [cam(), cam()] })).toBe(true);
  });
  it('a partner that is not shown: the primary\'s is drawn, the partner\'s material is not touched', () => {
    const pt = partner(model(0.5, 0, 0, 0), { on: false });
    expect(runChoice({ pair: pt, primaryM: model(0.5, 0, 0, 0), cams: [cam(), cam()] })).toBe(true); expect(pt.comp.visible).toBe('unset');
  });
  it('one composite only when the primary is the nearer box AND covers every eye (max zoom, inside the primary): the partner\'s is not drawn', () => {
    const pt = partner(model(1, 0, 0, -0.5), { nearer: false }); // the partner also fills the view, behind
    expect(runChoice({ pair: pt, primaryM: model(0.5, 0, 0, 0), cams: [cam(), cam()] })).toBe(true); expect(pt.comp.visible).toBe(false);
  });
  it('the primary covers every eye but the partner is the nearer box: both (it draws first and the primary blends over it, as before)', () => {
    const pt = partner(model(0.2, 0, 0, -0.5), { nearer: true });
    expect(runChoice({ pair: pt, primaryM: model(0.5, 0, 0, 0), cams: [cam(), cam()] })).toBe(true); expect(pt.comp.visible).toBe(true);
  });
  it('inside the partner\'s box (it covers every eye, the primary beside it): both, as before (never the partner\'s alone)', () => {
    for (const nearer of [true, false]) {
      const pt = partner(model(0.5, 0, 0, 0), { nearer });
      expect(runChoice({ pair: pt, primaryM: model(1, 2.5, 0, -1.5), cams: [cam(), cam()] })).toBe(true); expect(pt.comp.visible).toBe(true);
    }
  });
  it('neither box covers the whole view (side by side, the usual size): both, as before', () => {
    const pt = partner(model(0.3, 0.4, 0, -2));
    expect(runChoice({ pair: pt, primaryM: model(0.3, -0.4, 0, -2), cams: [cam(), cam()] })).toBe(true); expect(pt.comp.visible).toBe(true);
  });
  it('one eye covered, the other not: both (every eye must be covered)', () => {
    const pt = partner(model(0.3, 0.4, 0, -2)), right = cam(); right.matrixWorldInverse.elements = new THREE.Matrix4().makeTranslation(-3, 0, 0).elements;
    expect(runChoice({ pair: pt, primaryM: model(1, 0, 0, -1.2), cams: [cam(), right] })).toBe(true); expect(pt.comp.visible).toBe(true);
  });
  it('no XR eye cameras: both (nothing is decided)', () => {
    const pt = partner(model(0.5, 0, 0, 0));
    expect(runChoice({ pair: pt, primaryM: model(0.5, 0, 0, 0), cams: [] })).toBe(true); expect(pt.comp.visible).toBe(true);
  });
  it('the premises the choice rests on are fixed: primary LessEqual (no depthFunc), partner Less, the draw order of pairRender, the shader, only one place sets visible', () => {
    const cm = src.slice(src.indexOf('    compMaterial=new THREE.ShaderMaterial({'), src.indexOf('uniforms:compositeUniforms(vd.halfExt)});', src.indexOf('    compMaterial=new THREE.ShaderMaterial({')));
    expect(cm.length).toBeGreaterThan(0); expect(cm).not.toContain('depthFunc'); // three.js default: LessEqualDepth
    expect(src).toContain('meshObj=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),st.base);meshObj.frustumCulled=false;meshObj.renderOrder=1;');
    expect(src).toContain('depthFunc:THREE.LessDepth, // where the two boxes overlap');
    expect(src).toContain('pt.mesh.renderOrder=low?(pt.nearer?0.5:1.5):(pt.nearer?1.5:0.5);');
    expect(src).toContain('if(low){pt.rayMesh.matrixWorld.copy(pt.mesh.matrixWorld);pt.rayMesh.material=pt.rays[pairVariant(pt)];pt.mesh.material=pt.comp}');
    expect(src).toContain(' if(c.a<=0.0)discard;gl_FragDepth=d;outColor=c;}`;');
    expect(cSrc).toContain('pairComposites(pa,false)'); expect(cSrc).toContain('!pt.nearer');
    expect(src.match(/compMaterial\.visible=/g)).toHaveLength(1);
    expect(src.match(/\.comp\.visible=/g)).toHaveLength(1);
  });
});

describe('createAtlasIndex: the primary\'s result of a bone, the same as a find, made again only when the list changed', () => {
  const find = (list, a) => (a == null ? null : list.find(r => r.atlasId === a) || null);
  it('the same answers as list.find (the first result with the ID; none for null / undefined / NaN / an unknown ID)', () => {
    const list = [{ id: 1, atlasId: 10 }, { id: 2, atlasId: 11 }, { id: 3, atlasId: 10 }, { id: 4 }, { id: 5, atlasId: '12' }, { id: 6, atlasId: NaN }];
    const ix = createAtlasIndex(), m = ix.get(list);
    for (const a of [10, 11, 12, '12', undefined, null, NaN, 99, '10']) expect(atlasPrimary(m, a)).toBe(find(list, a));
  });
  it('made once while the list stays the same; again after a push, a removal, a replaced result, a changed atlas ID or another array', () => {
    const list = [{ id: 1, atlasId: 10 }, { id: 2, atlasId: 11 }], ix = createAtlasIndex();
    ix.get(list); for (let i = 0; i < 100; i++) ix.get(list); expect(ix.builds).toBe(1);
    list.push({ id: 3, atlasId: 12 }); expect(atlasPrimary(ix.get(list), 12)).toBe(list[2]); expect(ix.builds).toBe(2);
    list.splice(0, 1); expect(atlasPrimary(ix.get(list), 10)).toBe(null); expect(ix.builds).toBe(3);
    list[0] = { id: 9, atlasId: 11 }; expect(atlasPrimary(ix.get(list), 11)).toBe(list[0]); expect(ix.builds).toBe(4);
    list[1].atlasId = 20; expect(atlasPrimary(ix.get(list), 20)).toBe(list[1]); expect(atlasPrimary(ix.get(list), 12)).toBe(null); expect(ix.builds).toBe(5);
    const copy = list.slice(); ix.get(copy); expect(ix.builds).toBe(6); ix.get(copy); expect(ix.builds).toBe(6);
  });
  it('random lists and edits: always the find answer', () => {
    let seed = 3; const rnd = n => (seed = (seed * 16807) % 2147483647) % n;
    const ix = createAtlasIndex(); let list = [];
    for (let s = 0; s < 300; s++) {
      const op = rnd(5);
      if (op === 0) list.push({ id: s, atlasId: rnd(8) }); else if (op === 1 && list.length) list.splice(rnd(list.length), 1);
      else if (op === 2 && list.length) list[rnd(list.length)].atlasId = rnd(8); else if (op === 3) list = list.slice();
      const m = ix.get(list); for (let a = 0; a < 9; a++) expect(atlasPrimary(m, a)).toBe(find(list, a));
    }
  });
  it('vr-view.js pairPins: the table is taken once per call, outside the loop; no find over the primary\'s list per result', () => {
    const a = src.indexOf('  const pairPins=()=>{'), b = src.indexOf('\n  };\n', a);
    const body = src.slice(a, b);
    expect(a).toBeGreaterThan(0);
    expect(body).toContain('am=pairAtlas.get(analysisRegions);\n   for(const reg of pt.regs){');
    expect(body).toContain('const p=atlasPrimary(am,pt.atlasOf.get(reg.id));');
    expect(body).toContain('pr:pairCard(pt,e,p)');
    expect(body).not.toContain('analysisRegions.find'); expect(body).not.toContain('pairPrimaryOf(');
    expect(src).toContain('const pairPrimaryOf=(pt,e)=>{const a=pt.atlasOf.get(e.rid);return a==null?null:analysisRegions.find(r=>r.atlasId===a)||null};'); // the other callers: unchanged
    expect(src).toContain('const p=p0===undefined?pairPrimaryOf(pt,e):p0;'); // pairCard without p (the hover chip): looked up as before
  });
});

// pairPose, run from its own source against a real three.js graph (as vr-pair-individual.test.js), with the scene's update counted
describe('pairPose: the scene\'s matrices are brought up to date only when the holder or the partner moved', () => {
  const a = src.indexOf('  const pairQa=new THREE.Quaternion()'), b = src.indexOf('  pairFrame=()=>{');
  const code = src.slice(a, b);
  const make = () => {
    const scene = new THREE.Scene(), holder = new THREE.Group(); scene.add(holder);
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); holder.add(mesh); mesh.position.set(3.4, 0, 0);
    const palm = new THREE.Object3D(); scene.add(palm);
    const o = new THREE.Group(); o.position.set(3.4, 0, 0); holder.add(o); const planes = [{ obj: o, own: true }];
    const pair = { on: true, mesh, delta: [3.4, 0, 0], apos: new THREE.Vector3(), aquat: new THREE.Quaternion() };
    scene.updateMatrixWorld(true);
    let n = 0; const up = scene.updateMatrixWorld.bind(scene); scene.updateMatrixWorld = f => { n++; return up(f); };
    const x = { THREE, scene, holder, planes, pair, pairHeld: null, pairHold: null, pairPose: null, pairAnchorReset: null, holdOf: c => c, draggedBy: () => false };
    new Function('ctx', 'with(ctx){' + code + '}')(x);
    x.pairAnchorReset(); n = 0; // pairAnchorReset updates the scene itself (an event, not a frame)
    return { x, scene, holder, mesh, palm, o, count: () => n, reset: () => { n = 0; } };
  };
  it('the first call updates the scene; still frames do not', () => {
    const { x, count, reset } = make();
    x.pairPose(); expect(count()).toBe(1); reset();
    for (let i = 0; i < 20; i++) x.pairPose();
    expect(count()).toBe(0);
  });
  it('the holder moved (a hand moves / scales the primary): the scene is updated and the partner\'s world matrix is the fresh one', () => {
    const { x, holder, mesh, count, reset } = make();
    x.pairPose(); reset();
    const at = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    holder.position.x += 0.3; holder.rotateY(0.4); x.pairPose(); expect(count()).toBe(1);
    // the partner stays in the room (its own pose), and the matrix a later reader takes without updating is already that one
    expect(new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).distanceTo(at)).toBeLessThan(1e-9);
    reset(); x.pairPose(); expect(count()).toBe(0);
    holder.scale.setScalar(0.2); x.pairPose(); expect(count()).toBe(1);
  });
  it('the partner\'s anchor changed (正面に戻す): updated once, then still', () => {
    const { x, holder, mesh, count, reset } = make();
    x.pairPose(); holder.rotateY(1); x.pairPose(); reset();
    x.pairAnchorReset(); reset(); x.pairPose(); expect(count()).toBe(1); expect(mesh.position.x).toBeCloseTo(3.4, 9);
    reset(); x.pairPose(); expect(count()).toBe(0);
  });
  it('a hand holds the partner: updated while the hand moves it, not while it is still; the frame on it goes with it', () => {
    const { x, scene, mesh, palm, o, count, reset } = make();
    x.pairPose(); palm.position.setFromMatrixPosition(mesh.matrixWorld); palm.updateMatrixWorld(true); x.pairHold(palm); reset();
    x.pairPose(); expect(count()).toBe(0);
    palm.position.x += 0.2; x.pairPose(); expect(count()).toBe(1);
    scene.updateMatrixWorld(true);
    expect(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).distanceTo(new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld))).toBeLessThan(1e-9);
    reset(); x.pairPose(); expect(count()).toBe(0);
  });
  it('no partner shown: nothing at all', () => {
    const { x, count, reset } = make(); x.pairPose(); reset(); x.pair.on = false; x.pairPose(); expect(count()).toBe(0);
  });
});
