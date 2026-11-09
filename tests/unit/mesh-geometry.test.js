import { describe, it, expect } from 'vitest';
import { indexedGeometryFromTrianglePositions } from '../../docs/mesh-geometry.js';

describe('indexedGeometryFromTrianglePositions', () => {
  it('welds shared vertices', () => {
    // two triangles sharing an edge -> 4 unique vertices, 6 indices
    const g = indexedGeometryFromTrianglePositions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
    expect(g.getAttribute('position').count).toBe(4);
    expect(g.index.count).toBe(6);
  });
});
