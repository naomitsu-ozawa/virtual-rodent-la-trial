import { describe, it, expect } from 'vitest';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { describeMeshes, meshesFromEntry } from '../../docs/mesh-three.js';
import { packMeshes, unpackMeshes } from '../../docs/mesh-pack.js';

const params = () => ({ color: '#e7c85d', roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
function indexedMesh() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 2, 1, 3]), 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial(params()));
  m.name = 'segment_fat_isosurface'; m.userData.segmentKey = 'fat'; m.userData.editSurface = true; m.userData.displayScale = 0.37;
  return m;
}
function soupMesh() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial(params()));
  m.name = 'segment_bone_full_23'; m.userData.segmentKey = 'bone'; m.userData.displayScale = 0.37;
  return m;
}
const restore = bytes => meshesFromEntry({ meshes: unpackMeshes(bytes) }, key => (key === 'bone' || key === 'fat') ? params() : null);

describe('mesh <-> cache descriptors', () => {
  it('a built group survives pack -> unpack -> restore with the same geometry, userData and bounding sphere', () => {
    const group = new THREE.Group(); group.add(indexedMesh(), soupMesh());
    const out = restore(packMeshes(describeMeshes(group)));
    expect(out).toHaveLength(2);
    const [a, b] = out;
    expect(a.name).toBe('segment_fat_isosurface');
    expect(a.userData).toEqual({ segmentKey: 'fat', editSurface: true, displayScale: 0.37 });
    expect([...a.geometry.getAttribute('position').array]).toEqual([...group.children[0].geometry.getAttribute('position').array]);
    expect([...a.geometry.getAttribute('normal').array]).toEqual([...group.children[0].geometry.getAttribute('normal').array]);
    expect([...a.geometry.index.array]).toEqual([0, 1, 2, 2, 1, 3]);
    expect(a.geometry.boundingSphere.radius).toBeCloseTo(group.children[0].geometry.boundingSphere.radius, 6);
    expect(a.material.isMeshStandardNodeMaterial || a.material.isMeshStandardMaterial).toBe(true); // build 612: the shared lighting material (mesh-material.js)
    // the raw soup: no index, no normals, no editSurface flag, the fixed bounding sphere of the builder
    expect(b.userData).toEqual({ segmentKey: 'bone', displayScale: 0.37 });
    expect(b.geometry.index).toBeNull();
    expect(b.geometry.getAttribute('normal')).toBeUndefined();
    expect(b.geometry.boundingSphere.radius).toBe(3);
  });

  it('the restored attributes are views on the blob (no second copy)', () => {
    const group = new THREE.Group(); group.add(indexedMesh());
    const bytes = packMeshes(describeMeshes(group)), out = restore(bytes);
    expect(out[0].geometry.getAttribute('position').array.buffer).toBe(bytes.buffer);
    expect(out[0].geometry.index.array.buffer).toBe(bytes.buffer);
  });

  it('a 16-bit index of a built mesh is stored and restored as 32-bit', () => {
    const m = indexedMesh(); m.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    const group = new THREE.Group(); group.add(m);
    const out = restore(packMeshes(describeMeshes(group)));
    expect([...out[0].geometry.index.array]).toEqual([0, 1, 2]);
  });

  it('a segment this session does not have is a miss, not a crash', () => {
    const group = new THREE.Group(); group.add(indexedMesh());
    expect(meshesFromEntry({ meshes: unpackMeshes(packMeshes(describeMeshes(group))) }, () => null)).toBeNull();
  });

  describe('meshes the cache cannot reproduce exactly are not described (nothing is stored)', () => {
    const only = m => { const g = new THREE.Group(); g.add(m); return describeMeshes(g); };
    it('plain meshes are', () => { expect(only(indexedMesh())).not.toBeNull(); expect(only(soupMesh())).not.toBeNull(); });
    it('GPU-resident positions', () => { const m = soupMesh(); m.userData.gpuResident = true; expect(only(m)).toBeNull(); });
    it('several materials / geometry groups / a draw range', () => {
      const a = soupMesh(); a.material = [a.material]; expect(only(a)).toBeNull();
      const b = soupMesh(); b.geometry.addGroup(0, 3, 0); expect(only(b)).toBeNull();
      const c = soupMesh(); c.geometry.setDrawRange(0, 3); expect(only(c)).toBeNull();
    });
    it('another attribute', () => {
      const m = soupMesh(); m.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2)); expect(only(m)).toBeNull();
    });
    it('no segment key', () => { const m = soupMesh(); delete m.userData.segmentKey; expect(only(m)).toBeNull(); });
    it('an empty group', () => { expect(describeMeshes(new THREE.Group())).toBeNull(); });
    it('one unsupported mesh among good ones', () => {
      const g = new THREE.Group(), bad = soupMesh(); bad.userData.gpuResident = true; g.add(indexedMesh(), bad);
      expect(describeMeshes(g)).toBeNull();
    });
  });
});
