import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { geometryToBinaryStl, indexedGeometryFromTrianglePositions } from '../../docs/mesh-geometry.js';

describe('geometryToBinaryStl', () => {
  it('writes a valid binary STL (header, count, normal, vertices)', async () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2]);
    const blob = geometryToBinaryStl(g, 'bone');
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe('model/stl');
    expect(view.byteLength).toBe(84 + 50);
    expect(new TextDecoder().decode(new Uint8Array(view.buffer, 0, 23))).toBe('Virtual Rodent Lab bone');
    expect(view.getUint32(80, true)).toBe(1);
    expect([0, 4, 8].map(o => view.getFloat32(84 + o, true))).toEqual([0, 0, 1]); // +Z normal
    expect([12, 16, 20, 24, 28, 32].map(o => view.getFloat32(84 + o, true))).toEqual([0, 0, 0, 1, 0, 0]);
  });

  it('requires indexed geometry', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(() => geometryToBinaryStl(g)).toThrow(/Indexed geometry/);
  });
});

describe('indexedGeometryFromTrianglePositions', () => {
  it('welds shared vertices', () => {
    // two triangles sharing an edge -> 4 unique vertices, 6 indices
    const g = indexedGeometryFromTrianglePositions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
    expect(g.getAttribute('position').count).toBe(4);
    expect(g.index.count).toBe(6);
  });
});
