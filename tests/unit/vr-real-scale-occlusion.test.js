// The 拡大率 tag (createScaleTag) follows the 「ラベルの隠れ方」 setting: depth tested + a faint GreaterDepth ghost when occluding, on top otherwise.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createScaleTag } from '../../docs/vr-real-scale.js';

const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

test('scale tag: occlusion on = depth test + ghost; off = on top', () => {
  const tag = createScaleTag(THREE);
  assert.equal(tag.mesh.material.depthTest, false);
  assert.equal(tag.ghost.visible, false);
  tag.setOcclusion(true, 0.15);
  assert.equal(tag.mesh.material.depthTest, true);
  assert.equal(tag.mesh.material.depthWrite, false);
  assert.equal(tag.ghost.visible, true);
  assert.equal(tag.ghost.material.depthFunc, THREE.GreaterDepth);
  assert.equal(tag.ghost.material.depthTest, true);
  assert.equal(tag.ghost.material.opacity, 0.15);
  assert.equal(tag.ghost.renderOrder, tag.mesh.renderOrder);
  tag.setOcclusion(false, 0.15);
  assert.equal(tag.mesh.material.depthTest, false);
  assert.equal(tag.ghost.visible, false);
});
