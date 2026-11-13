import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { itemLess, keyOf, planRuns, createLabelBatch } from '../../docs/vr-label-batch.js';

// the name cards and legs drawn in a few calls (VR): the draw order of three's transparent sort is kept (renderOrder, far to near, older first), a run takes up to `slots` different card textures
const card = (ro, z, id, tex, dt = true) => ({ ro, z, id, tex, dt });
const leg = (ro, z, id, dt = true) => ({ ro, z, id, tex: null, dt });
const sorted = items => items.slice().sort(itemLess);

describe('itemLess: the order three sorted the cards and legs in', () => {
  it('renderOrder first, then the farther one (smaller key) first, then the older one', () => {
    const a = card(5, -2, 1, 'a'), b = card(5, -1, 2, 'b'), c = card(6, -9, 3, 'c'), d = card(5, -2, 4, 'd');
    expect(sorted([b, c, d, a]).map(x => x.tex)).toEqual(['a', 'd', 'b', 'c']);
  });
});

describe('keyOf: three\'s transparent sort key (projected z / w, the larger first)', () => {
  it('minus that: a point farther in front of the camera has the smaller key; one behind the camera sorts as in three (projected z jumps there)', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100); cam.position.set(0, 1.6, 0); cam.updateMatrixWorld(true);
    const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements, ndc = p => new THREE.Vector3(...p).applyMatrix4(cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse)).z;
    const pts = [[0, 1.6, -0.5], [0, 1.6, -2], [0, 1.6, -20], [0, 0, 0.3], [0.2, 1.2, 1]];
    for (const p of pts) expect(keyOf(V, P, ...p)).toBeCloseTo(-ndc(p), 5);
    expect(keyOf(V, P, 0, 1.6, -2)).toBeLessThan(keyOf(V, P, 0, 1.6, -0.5));
  });
});

describe('planRuns', () => {
  it('one run while the textures fit the slots and renderOrder / depthTest stay; a new texture past the slots starts the next run (the order is never changed)', () => {
    const items = sorted(Array.from({ length: 10 }, (_, i) => card(5, -10 + i, i, 't' + i)));
    const runs = planRuns(items, 4);
    expect(runs.map(r => [r.from, r.to, r.texs.length])).toEqual([[0, 4, 4], [4, 8, 4], [8, 10, 2]]);
    expect(planRuns(items, 16)).toHaveLength(1);
  });
  it('the same texture again does not take a slot; a leg takes none', () => {
    const items = [card(5, -4, 1, 'x'), leg(5, -3, 2), card(5, -2, 3, 'y'), card(5, -1, 4, 'x'), leg(5, 0, 5), card(5, 1, 6, 'z')];
    expect(planRuns(items, 2).map(r => [r.from, r.to, r.texs])).toEqual([[0, 5, ['x', 'y']], [5, 6, ['z']]]);
  });
  it('legs between the cards stay between them: legs and cards of one depth sequence are one run (not one draw each)', () => {
    const items = sorted(Array.from({ length: 20 }, (_, i) => (i % 2 ? leg(5, i, 100 + i) : card(5, i, i, 't' + i))));
    const runs = planRuns(items, 16); expect(runs).toHaveLength(1); expect(runs[0].texs).toHaveLength(10);
  });
  it('a change of renderOrder (a lit card / leg) or depthTest ends the run: the lit ones are drawn after the others', () => {
    const items = sorted([card(5, -3, 1, 'a'), card(6, -2, 2, 'b'), leg(6, -2.5, 6, false), card(5, -1, 3, 'c', false), card(5, -5, 4, 'd'), leg(5, -4, 5)]);
    expect(planRuns(items, 16).map(r => [r.ro, r.dt, r.from, r.to])).toEqual([[5, true, 0, 3], [5, false, 3, 4], [6, false, 4, 5], [6, true, 5, 6]]);
  });
  it('nothing: no run', () => { expect(planRuns([], 8)).toEqual([]); });
});

describe('createLabelBatch', () => {
  const fakeRenderer = { capabilities: { maxTextures: 16 }, xr: { isPresenting: false } };
  const OPT = { w: 0.12, h: 0.036, legWidth: 0.0024, legMinAngle: 0.0025 };
  const mkLb = (scene, tex) => {
    const m = Object.assign(new THREE.Object3D(), { material: { map: tex, opacity: 1, depthTest: false } }); m.renderOrder = 5; m.visible = true; scene.add(m);
    const line = { geometry: { attributes: { position: new THREE.Float32BufferAttribute(12, 3), other: new THREE.Float32BufferAttribute(12, 3) } }, material: { color: new THREE.Color(1, 1, 1), opacity: 1, depthTest: false }, renderOrder: 5, visible: true };
    return { m, line };
  };
  const mkCam = (z = 0.5) => { const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 1.6, z); cam.updateMatrixWorld(true); return cam; };
  const runsOf = scene => scene.children.filter(o => o.isInstancedMesh);
  it('33 cards (33 textures) and 33 legs: 3 draws (not 66); the instances carry the matrices, slots, kinds, ends and alpha', () => {
    const scene = new THREE.Scene(), cam = mkCam(), b = createLabelBatch(THREE, scene, OPT);
    const lbs = Array.from({ length: 33 }, (_, i) => { const lb = mkLb(scene, new THREE.Texture()); lb.m.position.set(i * 0.01, 0, -1 - i * 0.01); lb.m.material.opacity = i % 2 ? 0.85 : 1; b.add(lb); return lb; });
    lbs[4].line.geometry.attributes.position.setXYZ(0, 1, 2, 3); lbs[4].line.geometry.attributes.position.setXYZ(1, 4, 5, 6); lbs[4].line.geometry.attributes.other.setXYZ(0, 7, 8, 9);
    b.flush(fakeRenderer, cam);
    expect(b.stats).toMatchObject({ cards: 33, legs: 33, draws: 3 });
    const runs = runsOf(scene).filter(r => r.visible); expect(runs).toHaveLength(3);
    expect(runs.reduce((s, r) => s + r.count, 0)).toBe(66);
    const kinds = runs.flatMap(r => [...r.geometry.attributes.iKind.array.slice(0, r.count)]); expect(kinds.filter(k => k === 0)).toHaveLength(33); expect(kinds.filter(k => k === 1)).toHaveLength(33);
    // the leg of lbs[4]: its ends and the `other` written to its first vertex
    let found = false;
    for (const r of runs) for (let i = 0; i < r.count; i++) if (r.geometry.attributes.iKind.array[i] === 1 && r.geometry.attributes.iA.array[3 * i] === 1) { found = true; expect([...r.geometry.attributes.iB.array.slice(3 * i, 3 * i + 3)]).toEqual([4, 5, 6]); expect([...r.geometry.attributes.iOA.array.slice(3 * i, 3 * i + 3)]).toEqual([7, 8, 9]); }
    expect(found).toBe(true);
    // a card: its own matrix, its texture slot and alpha
    const far = lbs[32]; far.m.updateWorldMatrix(true, false);
    let card = false;
    for (const r of runs) for (let i = 0; i < r.count; i++) if (r.geometry.attributes.iKind.array[i] === 0 && JSON.stringify([...r.instanceMatrix.array.slice(16 * i, 16 * i + 16)]) === JSON.stringify([...new Float32Array(far.m.matrixWorld.elements)])) {
      card = true; expect(r.material.uniforms['t' + r.geometry.attributes.iTex.array[i]].value).toBe(far.m.material.map); expect(r.geometry.attributes.iAlpha.array[i]).toBeCloseTo(far.m.material.opacity, 6);
    }
    expect(card).toBe(true);
    // hiding cards / legs shrinks the draws; nothing visible = nothing drawn
    for (const lb of lbs) { lb.m.visible = false; lb.line.visible = false; }
    b.flush(fakeRenderer, cam);
    expect(b.stats).toMatchObject({ cards: 0, legs: 0, draws: 0 }); expect(runsOf(scene).filter(r => r.visible)).toHaveLength(0);
    b.dispose(); expect(runsOf(scene)).toHaveLength(0);
  });
  it('a lit card (renderOrder 6, no depth test) and an unlit one (depth test) are in runs of their own: the lit one is drawn after, each with its own alpha', () => {
    const scene = new THREE.Scene(), cam = mkCam(), b = createLabelBatch(THREE, scene, OPT);
    const a = mkLb(scene, new THREE.Texture()), l = mkLb(scene, new THREE.Texture());
    a.m.position.set(0, 0, -1); l.m.position.set(0, 0, -2); l.m.renderOrder = l.line.renderOrder = 6; l.m.material.depthTest = l.line.material.depthTest = false; a.m.material.depthTest = a.line.material.depthTest = true;
    a.line.visible = l.line.visible = false;
    b.add(a); b.add(l); b.flush(fakeRenderer, cam);
    expect(b.stats).toMatchObject({ draws: 2 });
    const ros = runsOf(scene).filter(o => o.visible).map(o => [o.renderOrder, o.material.depthTest]);
    expect(ros.map(r => r[1])).toEqual([true, false]); expect(ros[0][0]).toBeCloseTo(4.99, 6); expect(ros[1][0]).toBeCloseTo(5.99 + 0.0001, 6); // before the anchor dots (renderOrder 5) and the other things of renderOrder 6
    b.dispose();
  });
});

describe('vr-view.js wiring', () => {
  const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('every label is registered in the batch, dropped from it with its card, the batch is flushed once before the main render and disposed with the session', () => {
    expect(vr).toContain('labelBatch.add(lb);return lb;');
    expect(vr).toContain('pins.delete(rid);labelBatch.remove(lb);');
    expect(vr).toContain("labelBatch.flush(renderer,camera);");
    expect(vr).toContain('anchorDots.dispose();labelBatch.dispose();');
    expect(vr).not.toContain('createLegMesh(THREE)');
    expect(vr).not.toContain('new THREE.PlaneGeometry(LABEL_W,LABEL_H)');
  });
  it('the leg maths is the ribbon of vr-anchor-dots.js (same), the card fragment is MeshBasicMaterial\'s (alpha x opacity, output colour space)', () => {
    const batch = readFileSync(new URL('../../docs/vr-label-batch.js', import.meta.url), 'utf8');
    expect(batch).toContain('length(cameraPosition-p)*minAngle');
    expect(batch).toContain('(1.-smoothstep(0.6,1.,abs(vS)))*vA');
    expect(batch).toContain('#include <colorspace_fragment>');
    expect(batch).toContain('textureGrad');
  });
});
