import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { pointInPolygon, makeVoxelProjector, componentFullyInside } from '../../docs/lasso.js';

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('pointInPolygon', () => {
  it('handles convex and concave loops', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    const u = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 7, y: 10 }, { x: 7, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon(5, 8, u)).toBe(false); // inside the notch
    expect(pointInPolygon(1, 8, u)).toBe(true);
  });
});

describe('makeVoxelProjector', () => {
  it('matches three.js Vector3.project for the voxel placement used by the viewer', () => {
    const v = { columns: 20, rows: 10, slices: 5, spacing: [0.1, 0.2, 0.3] };
    const obj = new THREE.Object3D(); obj.position.set(0.3, -0.2, 0.1); obj.rotation.set(0.4, -0.7, 0.2); obj.scale.setScalar(1.3); obj.updateMatrixWorld(true);
    const cam = new THREE.PerspectiveCamera(45, 1.5, 0.01, 100); cam.position.set(0.5, 0.8, 6); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const W = 600, H = 400, project = makeVoxelProjector(v, obj.matrixWorld.elements, vp.elements, W, H);
    const [sx, sy, sz] = v.spacing, px = v.columns * sx, py = v.rows * sy, pz = v.slices * sz, scale = 3.3 / Math.max(px, py, pz);
    for (const [x, y, z] of [[0, 0, 0], [19, 9, 4], [7, 3, 2]]) {
      const ref = new THREE.Vector3((x * sx - px / 2) * scale, -(y * sy - py / 2) * scale, (z * sz - pz / 2) * scale).applyMatrix4(obj.matrixWorld).project(cam);
      const p = project(x, y, z);
      expect(p.x).toBeCloseTo((ref.x + 1) / 2 * W, 6);
      expect(p.y).toBeCloseTo((1 - ref.y) / 2 * H, 6);
    }
  });

  it('returns null for points behind the camera', () => {
    const v = { columns: 2, rows: 2, slices: 2, spacing: [1, 1, 1] };
    const cam = new THREE.PerspectiveCamera(45, 1, 0.01, 100); cam.position.set(0, 0, -5); cam.lookAt(0, 0, -10); cam.updateMatrixWorld(true);
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    expect(makeVoxelProjector(v, new THREE.Matrix4().elements, vp.elements, 100, 100)(0, 0, 0)).toBeNull();
  });
});

describe('componentFullyInside', () => {
  const identity = (x, y) => ({ x, y }); // voxel (x,y) -> screen (x,y)
  const runs = (...t) => new Uint32Array(t);

  it('selects a component entirely inside the loop', () => {
    expect(componentFullyInside([runs(2, 2, 4, 3, 2, 4)], identity, square)).toBe(true);
  });
  it('rejects a component that crosses the loop (keeps the main body)', () => {
    expect(componentFullyInside([runs(5, 2, 30)], identity, square)).toBe(false);
  });
  it('samples inside long runs, so a concave notch is detected', () => {
    const u = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 3 }, { x: 8, y: 3 }, { x: 8, y: 10 }, { x: 0, y: 10 }];
    expect(componentFullyInside([runs(8, 1, 19)], identity, u)).toBe(false); // ends inside, middle in the notch
  });
  it('rejects components with any point behind the camera, and empty components', () => {
    expect(componentFullyInside([runs(2, 2, 4)], (x, y) => (x === 4 ? null : { x, y }), square)).toBe(false);
    expect(componentFullyInside([runs()], identity, square)).toBe(false);
  });
});
