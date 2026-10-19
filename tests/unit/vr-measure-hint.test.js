// The distance's first-point hint (「終点のポイントを選んでください」, vr-measure.js): out of the line of sight, translucent, fading; the information stays.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
const ver = JSON.parse(readFileSync(new URL('../../docs/version.json', import.meta.url), 'utf8')).version, tag = '?v=' + ver.replace(/\./g, '').replace(/-(\d+)$/, '-build$1');
const load = f => import(/* @vite-ignore */ '../../docs/' + f + '.js' + tag);
const M = await load('vr-measure');
const { createVrMeasure, hintAlpha, hintPlace, HINT_DIST_M, HINT_ELEV, HINT_ALPHA, HINT_FADED_ALPHA, HINT_FADE_AFTER_MS, HINT_FADE_MS } = M;
const { setComments, addComment, createComment, setMarkersShown } = await load('comments');
const { resetMeasurements } = await load('measurements');
const { datasetFingerprint } = await load('project-file');
const series = { id: 's::1', description: 'synthetic', modality: 'CT', columns: 16, rows: 16, spacingX: 0.1, spacingY: 0.2, spacingZ: 0.5, slices: Array.from({ length: 12 }, (_, i) => ({ id: 'sl' + i, instanceNumber: i + 1, position: [0, 0, i * 0.5] })) };
const fp = datasetFingerprint(series);
const pt = (id, i, j, k) => addComment(createComment({ text: id, position: { i, j, k }, series: fp, id }));
beforeEach(() => { setComments([]); resetMeasurements(); setMarkersShown(true); });

describe('hint opacity and place (pure)', () => {
  it('translucent from the start, full length for 3 s, then fades to a faint value and stays (still readable)', () => {
    expect(HINT_ALPHA).toBeLessThan(0.8);
    expect(hintAlpha(0)).toBe(HINT_ALPHA);
    expect(hintAlpha(HINT_FADE_AFTER_MS)).toBe(HINT_ALPHA);
    const mid = hintAlpha(HINT_FADE_AFTER_MS + HINT_FADE_MS / 2);
    expect(mid).toBeLessThan(HINT_ALPHA); expect(mid).toBeGreaterThan(HINT_FADED_ALPHA);
    expect(hintAlpha(HINT_FADE_AFTER_MS + HINT_FADE_MS)).toBeCloseTo(HINT_FADED_ALPHA, 12);
    expect(hintAlpha(60000)).toBeCloseTo(HINT_FADED_ALPHA, 12);
    expect(HINT_FADED_ALPHA).toBeGreaterThan(0.15); // the information stays available
    expect(hintAlpha(-5)).toBe(HINT_ALPHA); expect(hintAlpha(NaN)).toBe(HINT_ALPHA);
  });
  it('the place is HINT_DIST_M from the head, above the gaze (top edge of the view), straight ahead sideways', () => {
    const head = { x: 0.2, y: 1.6, z: 0.1 };
    for (const gaze of [{ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, { x: 0.6, y: -0.3, z: -0.74 }, { x: 0, y: 0.8, z: -0.6 }, { x: 0, y: -1, z: 0 }]) {
      const p = hintPlace(head, gaze), L = Math.hypot(gaze.x, gaze.y, gaze.z), f = new THREE.Vector3(gaze.x, gaze.y, gaze.z).divideScalar(L);
      const d = new THREE.Vector3(p.x - head.x, p.y - head.y, p.z - head.z);
      expect(d.length()).toBeCloseTo(HINT_DIST_M, 9);
      expect(d.angleTo(f)).toBeCloseTo(HINT_ELEV, 6); // the elevation above the gaze
    }
    const p = hintPlace(head, { x: 0, y: 0, z: -1 }), d = new THREE.Vector3(p.x - head.x, p.y - head.y, p.z - head.z);
    expect(d.y).toBeGreaterThan(0.2); expect(Math.abs(d.x)).toBeLessThan(1e-9); expect(d.z).toBeLessThan(0);
    // looking down: the hint is turned towards the world's up, i.e. nearer the horizon than the gaze, never under the gaze
    const down = hintPlace(head, { x: 0, y: -0.7, z: -0.7 }); expect(down.y - head.y).toBeGreaterThan(-0.7 * HINT_DIST_M);
  });
  it('no usable gaze: null (the caller falls back)', () => {
    expect(hintPlace({ x: 0, y: 0, z: 0 }, null)).toBeNull();
    expect(hintPlace({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBeNull();
    expect(hintPlace(null, { x: 0, y: 0, z: -1 })).toBeNull();
  });
});

describe('the hint in the scene', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
  beforeEach(() => vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }));
  afterEach(() => vi.unstubAllGlobals());
  const dims = { columns: 16, rows: 16, slices: 12 }, halfExt = [8, 8, 6];
  const setup = () => {
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), holder = new THREE.Group();
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.05); holder.add(mesh); scene.add(holder); scene.updateMatrixWorld(true);
    const head = new THREE.Vector3(0, 1.6, 0);
    return { scene, base: { fingerprint: fp, dims, halfExt, mesh, head, spacing: [0.1, 0.2, 0.5], hint: '終点', gaze: new THREE.Vector3(0, -0.3, -1).normalize() } };
  };
  const hintOf = (scene, n0) => scene.children.slice(n0).filter(o => o.isMesh && o.renderOrder === 6)[0];
  it('head-locked at the top of the view, not above the start point; translucent; fades; restarts with another start; removed with the flow', () => {
    pt('p1', 2, 3, 1); pt('p2', 12, 9, 8);
    const { scene, base } = setup(), n0 = scene.children.length, v = createVrMeasure(THREE, scene);
    v.update({ ...base, startId: 'p1', now: 1000 });
    const ring = scene.children.find(o => o.isMesh && o.renderOrder === 2), hint = hintOf(scene, n0);
    expect(hint.visible).toBe(true);
    const want = hintPlace(base.head, base.gaze);
    expect(hint.position.distanceTo(new THREE.Vector3(want.x, want.y, want.z))).toBeLessThan(1e-9);
    expect(hint.position.distanceTo(ring.position)).toBeGreaterThan(0.2); // far from the start point: nothing in front of the target
    expect(hint.material.opacity).toBe(HINT_ALPHA);
    v.update({ ...base, startId: 'p1', now: 1000 + HINT_FADE_AFTER_MS + HINT_FADE_MS + 10 });
    expect(hint.material.opacity).toBeCloseTo(HINT_FADED_ALPHA, 9); expect(hint.visible).toBe(true);
    // moving the head moves the hint with it
    v.update({ ...base, startId: 'p1', head: new THREE.Vector3(0.5, 1.5, 0.2), now: 9000 });
    expect(hint.position.distanceTo(base.head)).toBeGreaterThan(0.4);
    // another start point: read again at full strength
    v.update({ ...base, startId: 'p2', now: 9100 });
    expect(hint.material.opacity).toBe(HINT_ALPHA);
    v.update({ ...base, startId: null, now: 9200 }); expect(scene.children.length).toBe(n0);
    v.dispose(); expect(scene.children.length).toBe(n0);
  });
  it('without a gaze it falls back above the start point, still translucent and fading', () => {
    pt('p1', 2, 3, 1);
    const { scene, base } = setup(), n0 = scene.children.length, v = createVrMeasure(THREE, scene);
    v.update({ ...base, gaze: null, startId: 'p1', now: 0 });
    const ring = scene.children.find(o => o.isMesh && o.renderOrder === 2), hint = hintOf(scene, n0);
    expect(hint.position.x).toBeCloseTo(ring.position.x, 9); expect(hint.position.y).toBeGreaterThan(ring.position.y);
    expect(hint.material.opacity).toBe(HINT_ALPHA);
    v.update({ ...base, gaze: null, startId: 'p1', now: 20000 }); expect(hint.material.opacity).toBeCloseTo(HINT_FADED_ALPHA, 9);
    v.dispose();
  });
});

describe('vr-view.js passes the true gaze', () => {
  it('headGaze is the camera\'s view direction (headFwd stays horizontal for the boards) and goes to the measure update', () => {
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toContain('headGaze.set(0,0,-1).applyQuaternion(tmpQh);headFwd.copy(headGaze);headFwd.y=0;');
    expect(src).toContain('hint:L.ptDistHint,gaze:headGaze,');
  });
});
