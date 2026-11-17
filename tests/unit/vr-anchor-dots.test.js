import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createAnchorDots, dotSets, dotBehindCard, ANCHOR_DOT_DIAMETER_M } from '../../docs/vr-anchor-dots.js';
import { GHOST_ALPHA } from '../../docs/vr-depth.js';

// the dot at the foot of a pinned label's leader (VR): 5 mm across (world, fixed), the result's colour, 2 InstancedMesh (body + ghost)
const dots = [{ x: 0, y: 1, z: -1, color: 0xff0000, hidden: false }, { x: 0.2, y: 1, z: -1, color: '#00ff00', hidden: true }, { x: 0.4, y: 1, z: -1, color: 0x0000ff, hidden: false }];

describe('dotSets', () => {
  it('GPU occlusion: every dot in both passes (depth test decides)', () => {
    expect(dotSets(dots, true)).toEqual({ body: [0, 1, 2], ghost: [0, 1, 2] });
  });
  it('薄くする: the hidden dots are the faint ones (ghost), the others the plain ones, nothing in both', () => {
    expect(dotSets(dots, false)).toEqual({ body: [0, 2], ghost: [1] });
    expect(dotSets([], false)).toEqual({ body: [], ghost: [] });
  });
});

describe('createAnchorDots', () => {
  it('two InstancedMesh (2 draw calls), a 5 mm sphere, the ghost at GHOST_ALPHA (0.15) with GreaterDepth', () => {
    const scene = new THREE.Scene(), d = createAnchorDots(THREE, scene);
    d.update(dots, true);
    const meshes = scene.children.filter(o => o.isInstancedMesh); expect(meshes.length).toBe(2);
    const [b, g] = [d.bodyMesh, d.ghostMesh];
    b.geometry.computeBoundingSphere(); expect(b.geometry.boundingSphere.radius).toBeCloseTo(ANCHOR_DOT_DIAMETER_M / 2, 6); expect(ANCHOR_DOT_DIAMETER_M).toBeCloseTo(0.005, 9);
    expect(g.material.opacity).toBe(GHOST_ALPHA); expect(GHOST_ALPHA).toBe(0.15);
    expect(g.material.depthFunc).toBe(THREE.GreaterDepth); expect(b.material.depthTest).toBe(true); expect(g.material.depthTest).toBe(true);
    expect(b.count).toBe(3); expect(g.count).toBe(3); expect(b.visible && g.visible).toBe(true);
  });
  it('the dot is where the anchor is, in the given colour; the size does not depend on anything but the constant', () => {
    const scene = new THREE.Scene(), d = createAnchorDots(THREE, scene); d.update(dots, true);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); d.bodyMesh.getMatrixAt(1, m); p.setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(0.2, 6); expect(p.y).toBeCloseTo(1, 6); expect(p.z).toBeCloseTo(-1, 6);
    expect(m.elements[0]).toBeCloseTo(1, 6); // no scale in the matrix: the 5 mm is the geometry
    const c = new THREE.Color(); d.bodyMesh.getColorAt(0, c); expect(c.getHex()).toBe(0xff0000); d.bodyMesh.getColorAt(1, c); expect(c.getHex()).toBe(0x00ff00);
  });
  it('薄くする: no depth test; the hidden dot is in the ghost only, the exposed ones in the body only', () => {
    const scene = new THREE.Scene(), d = createAnchorDots(THREE, scene); d.update(dots, false);
    expect(d.bodyMesh.material.depthTest).toBe(false); expect(d.ghostMesh.material.depthTest).toBe(false);
    expect(d.bodyMesh.count).toBe(2); expect(d.ghostMesh.count).toBe(1);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); d.ghostMesh.getMatrixAt(0, m); p.setFromMatrixPosition(m); expect(p.x).toBeCloseTo(0.2, 6);
  });
  it('a dot behind tissue turns faint when the anchor becomes hidden, and back; no dots = nothing drawn', () => {
    const scene = new THREE.Scene(), d = createAnchorDots(THREE, scene), one = hidden => [{ x: 0, y: 1, z: -1, color: 1, hidden }];
    d.update(one(false), false); expect([d.bodyMesh.count, d.ghostMesh.count]).toEqual([1, 0]);
    d.update(one(true), false); expect([d.bodyMesh.count, d.ghostMesh.count]).toEqual([0, 1]);
    d.update(one(false), false); expect([d.bodyMesh.count, d.ghostMesh.count]).toEqual([1, 0]);
    d.update([], false); expect(d.bodyMesh.visible || d.ghostMesh.visible).toBe(false);
  });
  it('more dots than the capacity: the meshes grow; dispose removes them', () => {
    const scene = new THREE.Scene(), d = createAnchorDots(THREE, scene), many = Array.from({ length: 70 }, (_, i) => ({ x: i * 0.01, y: 0, z: 0, color: 0xffffff, hidden: false }));
    d.update(many, true); expect(d.bodyMesh.count).toBe(70); expect(scene.children.filter(o => o.isInstancedMesh).length).toBe(2);
    d.dispose(); expect(scene.children.filter(o => o.isInstancedMesh).length).toBe(0);
  });
  it('an unchanged frame uploads nothing again (the key is the same)', () => {
    const scene = new THREE.Scene(), d = createAnchorDots(THREE, scene); d.update(dots, true);
    const v = d.bodyMesh.instanceMatrix.version; d.update(dots.map(x => ({ ...x })), true); expect(d.bodyMesh.instanceMatrix.version).toBe(v);
    d.update([{ ...dots[0], x: 0.5 }, dots[1], dots[2]], true); expect(d.bodyMesh.instanceMatrix.version).toBeGreaterThan(v);
  });
});

describe('a dot behind a card is not drawn at all (the cards write no depth)', () => {
  const eye = { x: 0, y: 0, z: 1 };
  it('dotBehindCard: behind the plane and the eye->dot line crosses the card', () => {
    expect(dotBehindCard(eye, { x: 0, y: 0, z: -0.1 }, 0.06, 0.018, 0.0025)).toBe(true);
    expect(dotBehindCard(eye, { x: 0.2, y: 0, z: -0.1 }, 0.06, 0.018, 0.0025)).toBe(false); // beside the card
    expect(dotBehindCard(eye, { x: 0, y: 0, z: 0.1 }, 0.06, 0.018, 0.0025)).toBe(false); // in front of the card
    expect(dotBehindCard({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -0.1 }, 0.06, 0.018, 0)).toBe(false); // the eye behind the card
  });
  it('dotSets: a covered dot is in neither pass, GPU or not, hidden or not', () => {
    const ds = [{ hidden: false, covered: true }, { hidden: true, covered: true }, { hidden: false }];
    expect(dotSets(ds, true)).toEqual({ body: [2], ghost: [2] });
    expect(dotSets(ds, false)).toEqual({ body: [2], ghost: [] });
  });
});
