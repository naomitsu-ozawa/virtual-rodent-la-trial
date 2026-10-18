import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
// The app's modules import each other with a ?v=<build> tag, which makes them different module instances from a plain import in a test. So everything
// here is imported WITH the same tag (read from version.json), and the comment store the measurements follow is then the same one.
const ver = JSON.parse(readFileSync(new URL('../../docs/version.json', import.meta.url), 'utf8')).version, tag = '?v=' + ver.replace(/\./g, '').replace(/-(\d+)$/, '-build$1');
const load = f => import(/* @vite-ignore */ '../../docs/' + f + '.js' + tag);
const {
  distanceMm, formatMm, measureLabel, seriesSpacing, spacingWarns, measurementMm, sanitizeMeasurements,
  getMeasurements, onMeasurementsChange, setLabelOffset, normalizeLabelOffset, addMeasurement, removeMeasurement, restoreMeasurements, measurementsOfPoint, measurementsForProject, loadProjectMeasurements,
  markMeasurementsSaved, hasUnsavedMeasurements, resetMeasurements, getMeasureStart, startMeasure, cancelMeasure, pickMeasureEnd, onMeasureStartChange,
  createLongPress, POINT_MENU_ITEMS, MEASURE_MAX,
} = await load('measurements');
const { setComments, addComment, removeComment, restoreComment, createComment, getComments, updateCommentPosition, updateCommentColor, setMarkersShown, loadProjectComments } = await load('comments');
const { datasetFingerprint, packProject, unpackProject } = await load('project-file');
const { createVrMeasure, labelScaleFor, MEASURE_LABEL_W_M, LABEL_LIT_SCALE } = await load('vr-measure');
const { LINE_SAMPLES, LABEL_MID, OCCLUDED_ALPHA, probeKey } = await load('measure-label');
const { createUndoStack, applyUndo, voxelToLocal, HAPTIC } = await load('vr-point');

// synthetic data only: a 16 x 16 x 12 grid, anisotropic spacing 0.1 x 0.2 x 0.5 mm
const series = (extra = {}) => ({ id: 's::1', description: 'synthetic', modality: 'CT', columns: 16, rows: 16, spacingX: 0.1, spacingY: 0.2, spacingZ: 0.5, slices: Array.from({ length: 12 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: '1' })), ...extra });
const fp = datasetFingerprint(series());
const pt = (id, i, j, k) => addComment(createComment({ text: id, position: { i, j, k }, series: fp, id }));
beforeEach(() => { setComments([]); resetMeasurements(); setMarkersShown(true); });

describe('distance in millimetres (anisotropic spacing)', () => {
  const sp = [0.1, 0.2, 0.5];
  it('uses x / y / z spacing for i / j / k', () => {
    expect(distanceMm({ i: 0, j: 0, k: 0 }, { i: 3, j: 0, k: 0 }, sp)).toBeCloseTo(0.3, 12);
    expect(distanceMm({ i: 0, j: 0, k: 0 }, { i: 0, j: 3, k: 0 }, sp)).toBeCloseTo(0.6, 12);
    expect(distanceMm({ i: 0, j: 0, k: 0 }, { i: 0, j: 0, k: 3 }, sp)).toBeCloseTo(1.5, 12);
    expect(distanceMm({ i: 1, j: 2, k: 3 }, { i: 4, j: 6, k: 9 }, sp)).toBeCloseTo(Math.hypot(0.3, 0.8, 3), 12);
    // a different axis order gives a different value: i is not j is not k
    expect(distanceMm({ i: 0, j: 0, k: 0 }, { i: 3, j: 4, k: 0 }, sp)).not.toBeCloseTo(distanceMm({ i: 0, j: 0, k: 0 }, { i: 3, j: 4, k: 0 }, [0.2, 0.1, 0.5]), 3);
  });
  it('is symmetric, zero for the same voxel, and null for a bad voxel', () => {
    const a = { i: 2, j: 5, k: 7 }, b = { i: 9, j: 1, k: 3 };
    expect(distanceMm(a, b, sp)).toBe(distanceMm(b, a, sp));
    expect(distanceMm(a, a, sp)).toBe(0);
    expect(distanceMm(a, { i: 'x', j: 0, k: 0 }, sp)).toBeNull(); expect(distanceMm(null, a, sp)).toBeNull();
  });
  it('a missing / zero / negative spacing counts as 1 mm', () => {
    expect(distanceMm({ i: 0, j: 0, k: 0 }, { i: 3, j: 4, k: 0 }, [undefined, 0, -1])).toBe(5);
    expect(distanceMm({ i: 0, j: 0, k: 0 }, { i: 3, j: 4, k: 0 }, null)).toBe(5);
  });
  it('1 decimal place, 2 below 10 mm, ⚠ with a slice-spacing warning', () => {
    expect(formatMm(12.345)).toBe('12.3 mm'); expect(formatMm(9.996)).toBe('10.00 mm'); expect(formatMm(3.456)).toBe('3.46 mm'); expect(formatMm(0)).toBe('0.00 mm'); expect(formatMm(100)).toBe('100.0 mm');
    expect(formatMm(NaN)).toBe('—');
    expect(measureLabel(12.345, true)).toBe('⚠ 12.3 mm'); expect(measureLabel(12.345, false)).toBe('12.3 mm');
  });
  it('the series spacing and the warn-level check (info-level notes do not count)', () => {
    expect(seriesSpacing(series())).toEqual([0.1, 0.2, 0.5]);
    expect(spacingWarns(series())).toBe(false);
    expect(spacingWarns(series({ spacingCheck: { warn: true, duplicates: 2, duplicateIndices: [1, 2], used: 0.5, tagZ: 0.5 } }))).toBe(true);
  });
  it('measurementMm reads the points of the list', () => {
    const cs = [createComment({ text: 'a', position: { i: 0, j: 0, k: 0 }, series: fp, id: 'a' }), createComment({ text: 'b', position: { i: 0, j: 0, k: 2 }, series: fp, id: 'b' })];
    expect(measurementMm({ a: 'a', b: 'b' }, cs, [0.1, 0.2, 0.5])).toBeCloseTo(1, 12);
    expect(measurementMm({ a: 'a', b: 'zz' }, cs, [1, 1, 1])).toBeNull();
  });
});

describe('sanitize / project round trip', () => {
  const ok = new Set(['p1', 'p2', 'p3']);
  it('keeps {id,a,b} with existing, different points; drops the malformed', () => {
    const out = sanitizeMeasurements([
      { id: 'm1', a: 'p1', b: 'p2' }, { id: 'm2', a: 'p1', b: 'gone' }, { id: 'm3', a: 'p2', b: 'p2' }, null, 7, 'x', { a: 'p1' }, { a: 1, b: 2 },
      { id: 'm1', a: 'p2', b: 'p3' }, { id: 'm4', a: 'p2', b: 'p1' }, { b: 'p3', a: 'p1', extra: 'ignored' },
    ], ok);
    expect(out).toEqual([{ id: 'm1', a: 'p1', b: 'p2' }, { id: 'm1_', a: 'p2', b: 'p3' }, { id: 'm-2', a: 'p1', b: 'p3' }]); // the reversed duplicate pair m4 is dropped, a duplicate id is renamed
    expect(sanitizeMeasurements('x', ok)).toEqual([]); expect(sanitizeMeasurements(undefined, ok)).toEqual([]);
    expect(sanitizeMeasurements(Array.from({ length: MEASURE_MAX + 50 }, (_, i) => ({ id: 'q' + i, a: 'p1', b: 'p2' })), ok).length).toBe(1); // one pair only once
  });
  it('round-trips through the .vrlab zip + JSON and does not need a version bump (the other fields are untouched)', () => {
    pt('p1', 1, 1, 1); pt('p2', 4, 5, 6); pt('p3', 0, 0, 0);
    addMeasurement('p1', 'p2', { id: 'm1' }); addMeasurement('p2', 'p3', { id: 'm2' });
    const ids = new Set(getComments().map(c => c.id));
    const project = { dataset: fp, comments: getComments(), measurements: measurementsForProject(ids) };
    const back = unpackProject(packProject(project, {})).project;
    expect(back.measurements).toEqual([{ id: 'm1', a: 'p1', b: 'p2' }, { id: 'm2', a: 'p2', b: 'p3' }]);
    expect(back.version).toBe(unpackProject(packProject({ dataset: fp }, {})).project.version); // the format version is not changed by the field
    resetMeasurements(); expect(getMeasurements()).toEqual([]);
    loadProjectMeasurements(back.measurements);
    expect(getMeasurements()).toEqual([{ id: 'm1', a: 'p1', b: 'p2' }, { id: 'm2', a: 'p2', b: 'p3' }]);
  });
  it('an old project (no field) loads nothing; entries of points that no longer exist are dropped on load', () => {
    pt('p1', 1, 1, 1); pt('p2', 2, 2, 2);
    loadProjectMeasurements(undefined); expect(getMeasurements()).toEqual([]);
    loadProjectMeasurements([{ id: 'm1', a: 'p1', b: 'p2' }, { id: 'm2', a: 'p1', b: 'nope' }, 'junk']);
    expect(getMeasurements()).toEqual([{ id: 'm1', a: 'p1', b: 'p2' }]);
    loadProjectMeasurements([{ id: 'm1', a: 'p2', b: 'p1' }]); expect(getMeasurements()).toHaveLength(1); // the same pair: not added twice
  });
  it('only the measurements whose two points are saved go to the file', () => {
    pt('p1', 1, 1, 1); pt('p2', 2, 2, 2); pt('p3', 3, 3, 3); addMeasurement('p1', 'p2'); addMeasurement('p2', 'p3');
    expect(measurementsForProject(new Set(['p1', 'p2']))).toHaveLength(1);
  });
  it('unsaved changes are noticed', () => {
    pt('p1', 1, 1, 1); pt('p2', 2, 2, 2);
    markMeasurementsSaved(fp, []); expect(hasUnsavedMeasurements()).toBe(false);
    const m = addMeasurement('p1', 'p2'); expect(hasUnsavedMeasurements()).toBe(true);
    markMeasurementsSaved(fp); expect(hasUnsavedMeasurements()).toBe(false);
    removeMeasurement(m.id); expect(hasUnsavedMeasurements()).toBe(true);
  });
});

describe('the store and the cascade', () => {
  beforeEach(() => { pt('p1', 1, 1, 1); pt('p2', 2, 2, 2); pt('p3', 3, 3, 3); });
  it('adds between existing, different points; the same pair (either order) returns the existing one', () => {
    expect(addMeasurement('p1', 'p1')).toBeNull(); expect(addMeasurement('p1', 'zz')).toBeNull(); expect(addMeasurement('', 'p1')).toBeNull();
    const m = addMeasurement('p1', 'p2'); expect(m).toMatchObject({ a: 'p1', b: 'p2' });
    expect(addMeasurement('p2', 'p1')).toMatchObject({ id: m.id, existed: true }); expect(getMeasurements()).toHaveLength(1);
  });
  it('deleting a point removes its measurements (and a pending start); the others stay', () => {
    addMeasurement('p1', 'p2'); addMeasurement('p2', 'p3'); addMeasurement('p1', 'p3');
    startMeasure('p2');
    removeComment('p2');
    expect(getMeasurements().map(m => [m.a, m.b])).toEqual([['p1', 'p3']]);
    expect(getMeasureStart()).toBeNull();
  });
  it('restoring the point and its recorded measurements brings them back (undo)', () => {
    addMeasurement('p1', 'p2'); addMeasurement('p2', 'p3');
    const ms = measurementsOfPoint('p2'), index = getComments().findIndex(c => c.id === 'p2'), c = getComments()[index];
    removeComment('p2'); expect(getMeasurements()).toEqual([]);
    expect(restoreMeasurements(ms)).toBe(false); // the point is not back yet: nothing is restored
    restoreComment(c, index); expect(restoreMeasurements(ms)).toBe(true);
    expect(getMeasurements()).toHaveLength(2); expect(restoreMeasurements(ms)).toBe(false); // not twice
  });
  it('moving a point changes the value (computed, never stored)', () => {
    const m = addMeasurement('p1', 'p3'), sp = [0.1, 0.2, 0.5];
    const d0 = measurementMm(m, getComments(), sp);
    updateCommentPosition('p3', { i: 3, j: 3, k: 11 });
    expect(measurementMm(m, getComments(), sp)).toBeCloseTo(Math.hypot(2 * 0.1, 2 * 0.2, 10 * 0.5), 12);
    expect(measurementMm(m, getComments(), sp)).not.toBeCloseTo(d0, 3); expect(getMeasurements()[0]).toEqual({ id: m.id, a: 'p1', b: 'p3' });
  });
});

describe('the shared flow: 距離 on a point -> start -> the next point is the end', () => {
  beforeEach(() => { pt('p1', 1, 1, 1); pt('p2', 2, 2, 2); });
  it('start / pick / cancel', () => {
    const seen = []; const off = onMeasureStartChange(id => seen.push(id));
    expect(pickMeasureEnd('p2')).toEqual({ kind: 'none' }); // nothing armed
    expect(startMeasure('nope')).toBe(false); expect(getMeasureStart()).toBeNull();
    expect(startMeasure('p1')).toBe(true); expect(getMeasureStart()).toBe('p1');
    expect(pickMeasureEnd('p1').kind).toBe('same'); expect(getMeasureStart()).toBe('p1'); // the start again: still armed
    const r = pickMeasureEnd('p2'); expect(r.kind).toBe('created'); expect(r.m).toMatchObject({ a: 'p1', b: 'p2' }); expect(getMeasureStart()).toBeNull();
    startMeasure('p2'); expect(pickMeasureEnd('p1').kind).toBe('existed'); expect(getMeasurements()).toHaveLength(1);
    startMeasure('p1'); expect(cancelMeasure()).toBe(true); expect(cancelMeasure()).toBe(false);
    expect(seen).toEqual(['p1', null, 'p2', null, 'p1', null]); off();
  });
});

describe('PC / iPad long press (the menu opens; the release is then not a tap)', () => {
  it('a still press held for ms is "long"; a quick release is a tap', () => {
    const lp = createLongPress({ ms: 500, slop: 6 });
    expect(lp.up()).toBeNull();
    lp.down(10, 10, 0); expect(lp.active).toBe(true); expect(lp.tick(400)).toBeNull(); expect(lp.tick(500)).toBe('long'); expect(lp.tick(900)).toBeNull(); expect(lp.fired).toBe(true);
    expect(lp.up()).toBe('long'); expect(lp.active).toBe(false);
    lp.down(10, 10, 0); lp.move(12, 11); expect(lp.up()).toBe('tap');
  });
  it('moving beyond the slop (a swipe / drag) cancels the long press', () => {
    const lp = createLongPress({ ms: 500, slop: 6 });
    lp.down(0, 0, 0); lp.move(3, 4); expect(lp.tick(600)).toBe('long'); lp.up();
    lp.down(0, 0, 0); lp.move(8, 0); expect(lp.tick(600)).toBeNull(); expect(lp.up()).toBe('moved');
  });
  it('the menu items are the VR ring items that exist on the PC', () => {
    expect(POINT_MENU_ITEMS).toEqual(['distance', 'color', 'delete']);
  });
  it('the full flow on the PC: long press -> menu 距離 -> start -> tap another point -> a measurement; empty tap cancels', () => {
    pt('p1', 1, 1, 1); pt('p2', 5, 1, 1);
    const lp = createLongPress({ ms: 450 }); lp.down(100, 100, 0); expect(lp.tick(460)).toBe('long'); // (the view opens the menu here)
    expect(startMeasure('p1')).toBe(true); expect(lp.up()).toBe('long'); // 距離 chosen
    expect(pickMeasureEnd('p2').kind).toBe('created');
    expect(measurementMm(getMeasurements()[0], getComments(), [0.1, 0.2, 0.5])).toBeCloseTo(0.4, 12);
    startMeasure('p2'); cancelMeasure(); expect(getMeasurements()).toHaveLength(1); expect(getMeasureStart()).toBeNull();
  });
});

describe('the VR ring and undo', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('the point ring has 距離 (id, label in ja and en, and the confirm starts the flow)', () => {
    expect(src).toContain("['move','delete','color','distance']"); expect(src).toContain("['move','delete','comment','color','distance']");
    expect(src).toContain("distance:L.ptDist"); expect((src.match(/ptDist:'/g) || []).length).toBe(2);
    expect(src).toContain("ptDist:'距離'"); expect(src).toContain("ptDistHint:'終点のポイントを選んでください'");
    expect(src).toContain("key==='distance'"); expect(src).toContain('startMeasure(id)');
    expect(src).toMatch(/A\/X cancels a distance/); // A/X cancels; a tap on empty space cancels (endMeasureTap(c,null))
    expect(src).toContain("endMeasureTap(c,k==='point'?pr.res.ref.id:null)");
  });
  it('haptics: start 1 pulse, end 1 pulse (like select / ringConfirm)', () => {
    expect(HAPTIC.measureStart).toMatchObject({ count: 1 }); expect(HAPTIC.measureEnd).toMatchObject({ count: 1 });
  });
  it('undo: a made distance is removed; a deleted point comes back with its distances', () => {
    pt('p1', 1, 1, 1); pt('p2', 2, 2, 2);
    const store = { removeComment, restoreComment, updateCommentPosition, updateCommentColor, removeMeasurement, restoreMeasurements };
    const undo = createUndoStack(), m = addMeasurement('p1', 'p2'); undo.push({ type: 'measure-add', id: m.id });
    expect(applyUndo(undo.pop(), store)).toBe(true); expect(getMeasurements()).toEqual([]);
    const m2 = addMeasurement('p1', 'p2'), ms = measurementsOfPoint('p1'), index = 0, c = getComments()[0];
    removeComment('p1'); undo.push({ type: 'delete', c, index, ms });
    expect(applyUndo(undo.pop(), store)).toBe(true);
    expect(getComments().map(x => x.id)).toEqual(['p1', 'p2']); expect(getMeasurements()).toEqual([{ id: m2.id, a: 'p1', b: 'p2' }]);
    expect(applyUndo({ type: 'measure-add', id: 'nope' }, store)).toBe(false);
  });
});

describe('VR display (vr-measure.js)', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
  beforeEach(() => vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }));
  afterEach(() => vi.unstubAllGlobals());
  const dims = { columns: 16, rows: 16, slices: 12 }, halfExt = [8, 8, 6];
  const setup = () => {
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), holder = new THREE.Group();
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.05); holder.add(mesh); scene.add(holder); scene.updateMatrixWorld(true);
    return { scene, mesh, holder, base: { fingerprint: fp, dims, halfExt, mesh, head: new THREE.Vector3(0, 1.6, 0), spacing: [0.1, 0.2, 0.5], hint: '終点' } };
  };
  it('a line A-B and a label at its midpoint; the start has a pulsing ring + hint; everything is removed with the measurement / the flow', () => {
    pt('p1', 2, 3, 1); pt('p2', 12, 9, 8);
    const { scene, mesh, base } = setup(), n0 = scene.children.length;
    const v = createVrMeasure(THREE, scene);
    v.update({ ...base }); expect(scene.children.length).toBe(n0); // nothing yet
    addMeasurement('p1', 'p2'); v.update({ ...base });
    const line = scene.children.find(o => o.isLine), l1 = voxelToLocal({ i: 2, j: 3, k: 1 }, halfExt, dims), l2 = voxelToLocal({ i: 12, j: 9, k: 8 }, halfExt, dims);
    const w1 = new THREE.Vector3(l1.x, l1.y, l1.z).applyMatrix4(mesh.matrixWorld), w2 = new THREE.Vector3(l2.x, l2.y, l2.z).applyMatrix4(mesh.matrixWorld);
    const pos = line.geometry.attributes.position;
    expect(new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)).distanceTo(w1)).toBeLessThan(1e-6); const nn = pos.count - 1; expect(nn).toBe(LINE_SAMPLES); expect(new THREE.Vector3(pos.getX(nn), pos.getY(nn), pos.getZ(nn)).distanceTo(w2)).toBeLessThan(1e-6); // 9 sample vertices A -> B (build 493: a depth cue per part)
    const label = scene.children.find(o => o.isMesh && o.renderOrder === 6);
    expect(label.visible).toBe(true);
    // the label starts NEAR the line (a small offset from the midpoint, beside it), 60 % size, and a leader joins them
    const mid = w1.clone().add(w2).multiplyScalar(0.5);
    expect(label.position.distanceTo(mid)).toBeLessThan(0.06); expect(label.position.distanceTo(mid)).toBeGreaterThan(0.005);
    expect(label.scale.x).toBeLessThan(0.075); // smaller than build 478 (0.075 m wide) at arm's length
    expect(scene.children.length).toBe(n0 + 3);
    v.update({ ...base, startId: 'p1' }); expect(scene.children.length).toBe(n0 + 5); // + ring + hint
    v.update({ ...base, startId: null }); expect(scene.children.length).toBe(n0 + 3);
    removeMeasurement(getMeasurements()[0].id); v.update({ ...base }); expect(scene.children.length).toBe(n0);
    addMeasurement('p1', 'p2'); v.update({ ...base }); v.dispose(); expect(scene.children.length).toBe(n0);
  });
  it('a point being moved (preview) updates the line live; a deleted point removes it', () => {
    pt('p1', 2, 3, 1); pt('p2', 12, 9, 8); addMeasurement('p1', 'p2');
    const { scene, mesh, base } = setup(), v = createVrMeasure(THREE, scene);
    v.update({ ...base, preview: { id: 'p2', voxel: { i: 4, j: 3, k: 1 } } });
    const pos = scene.children.find(o => o.isLine).geometry.attributes.position, l = voxelToLocal({ i: 4, j: 3, k: 1 }, halfExt, dims);
    expect(new THREE.Vector3(pos.getX(pos.count - 1), pos.getY(pos.count - 1), pos.getZ(pos.count - 1)).distanceTo(new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(mesh.matrixWorld))).toBeLessThan(1e-6);
    removeComment('p2'); v.update({ ...base }); expect(scene.children.some(o => o.isLine)).toBe(false); v.dispose();
  });
});

describe('review fixes: series, id renames, per-series saved state', () => {
  const fp2 = datasetFingerprint(series({ slices: Array.from({ length: 12 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: '2' })) }));
  it('a distance between points of different series is refused (the flow stays armed)', () => {
    pt('p1', 1, 1, 1); addComment(createComment({ text: 'o', position: { i: 2, j: 2, k: 2 }, series: fp2, id: 'o1' }));
    expect(addMeasurement('p1', 'o1')).toBeNull();
    startMeasure('p1'); expect(pickMeasureEnd('o1').kind).toBe('other-series'); expect(getMeasureStart()).toBe('p1'); expect(getMeasurements()).toEqual([]);
    expect(loadProjectMeasurements([{ id: 'x', a: 'p1', b: 'o1' }])).toBeUndefined(); expect(getMeasurements()).toEqual([]);
  });
  it('a measurement follows its points when loadProjectComments renames a colliding id', () => {
    addComment(createComment({ text: 'mem', position: { i: 0, j: 0, k: 0 }, series: fp2, id: 'p1' })); // another series already uses the id p1
    const map = loadProjectComments([{ id: 'p1', text: 'a', position: { i: 1, j: 1, k: 1 }, series: fp }, { id: 'p2', text: 'b', position: { i: 3, j: 3, k: 3 }, series: fp }], fp);
    expect(map).toEqual({ p1: 'p1_' });
    loadProjectMeasurements([{ id: 'm1', a: 'p1', b: 'p2' }], map);
    expect(getMeasurements()).toEqual([{ id: 'm1', a: 'p1_', b: 'p2' }]);
  });
  it('saved tracking is per series; a loaded pair that already exists in memory counts as saved', () => {
    pt('p1', 1, 1, 1); pt('p2', 2, 2, 2); addComment(createComment({ text: 'o', position: { i: 2, j: 2, k: 2 }, series: fp2, id: 'o1' })); addComment(createComment({ text: 'o', position: { i: 3, j: 3, k: 3 }, series: fp2, id: 'o2' }));
    addMeasurement('o1', 'o2'); addMeasurement('p1', 'p2');
    markMeasurementsSaved(fp); expect(hasUnsavedMeasurements()).toBe(true); // series 2 was never saved
    markMeasurementsSaved(fp2); expect(hasUnsavedMeasurements()).toBe(false);
    markMeasurementsSaved(fp); expect(hasUnsavedMeasurements()).toBe(false); // saving series 1 again does not forget series 2
    loadProjectMeasurements([{ id: 'other-id', a: 'p2', b: 'p1' }]); expect(getMeasurements()).toHaveLength(2); expect(hasUnsavedMeasurements()).toBe(false);
  });
});

describe('the label: size, default placement near the line, offset (move) persistence', () => {
  it('about 60 % of build 478 in size, growing with the head distance', () => {
    expect(MEASURE_LABEL_W_M).toBeCloseTo(0.075 * 0.6, 6);
    expect(labelScaleFor(0.6)).toBeCloseTo(1, 9); expect(labelScaleFor(1.2)).toBeCloseTo(2, 9); expect(labelScaleFor(0.1)).toBe(0.7); expect(labelScaleFor(5)).toBe(2.2);
  });
  it('normalizeLabelOffset: finite numbers only, rounded to 3 decimals; anything else = no offset (default placement)', () => {
    expect(normalizeLabelOffset({ i: 1.23456, j: -2, k: 0 })).toEqual({ i: 1.235, j: -2, k: 0 });
    for (const bad of [null, undefined, 5, 'x', {}, { i: 1, j: 2 }, { i: '1', j: 2, k: 3 }, { i: NaN, j: 0, k: 0 }, { i: Infinity, j: 0, k: 0 }, { i: 1e9, j: 0, k: 0 }]) expect(normalizeLabelOffset(bad)).toBeNull();
  });
  it('setLabelOffset: stored, unchanged is a no-op, null = back to default, invalid refused', () => {
    pt('p1', 1, 1, 1); pt('p2', 5, 5, 5); const m = addMeasurement('p1', 'p2');
    expect(getMeasurements()[0].labelOffset).toBeUndefined(); expect('labelOffset' in m).toBe(false);
    expect(setLabelOffset(m.id, { i: 2, j: -1, k: 0.5 })).toBe(true); expect(getMeasurements()[0].labelOffset).toEqual({ i: 2, j: -1, k: 0.5 });
    expect(setLabelOffset(m.id, { i: 'x', j: 0, k: 0 })).toBe(false); expect(getMeasurements()[0].labelOffset).toEqual({ i: 2, j: -1, k: 0.5 });
    expect(setLabelOffset('nope', { i: 1, j: 1, k: 1 })).toBe(false);
    expect(setLabelOffset(m.id, null)).toBe(true); expect(getMeasurements()[0]).toEqual({ id: m.id, a: 'p1', b: 'p2' });
  });
  it('persistence: sanitize keeps a valid offset and drops an invalid one; the project file round-trips it; an old entry without it loads with the default', () => {
    const ok = new Set(['p1', 'p2', 'p3']);
    const out = sanitizeMeasurements([{ id: 'm1', a: 'p1', b: 'p2', labelOffset: { i: 3, j: 4, k: 5 } }, { id: 'm2', a: 'p2', b: 'p3', labelOffset: { i: 'bad' } }, { id: 'm3', a: 'p1', b: 'p3' }], ok);
    expect(out).toEqual([{ id: 'm1', a: 'p1', b: 'p2', labelOffset: { i: 3, j: 4, k: 5 } }, { id: 'm2', a: 'p2', b: 'p3' }, { id: 'm3', a: 'p1', b: 'p3' }]);
    pt('p1', 1, 1, 1); pt('p2', 5, 5, 5); const m = addMeasurement('p1', 'p2'); setLabelOffset(m.id, { i: -3.5, j: 2, k: 1 });
    const ids = new Set(getComments().map(c => c.id)), project = { dataset: fp, comments: getComments(), measurements: measurementsForProject(ids) };
    const back = unpackProject(packProject(project, {})).project;
    expect(back.measurements).toEqual([{ id: m.id, a: 'p1', b: 'p2', labelOffset: { i: -3.5, j: 2, k: 1 } }]);
    resetMeasurements(); loadProjectMeasurements(back.measurements);
    expect(getMeasurements()).toEqual([{ id: m.id, a: 'p1', b: 'p2', labelOffset: { i: -3.5, j: 2, k: 1 } }]);
    // the offset is a restorable part of the measurement (undo of a point deletion)
    const ms = measurementsOfPoint('p1'), c = getComments()[0]; removeComment('p1'); restoreComment(c, 0); restoreMeasurements(ms);
    expect(getMeasurements()[0].labelOffset).toEqual({ i: -3.5, j: 2, k: 1 });
  });
  it('moving a label is an unsaved change', () => {
    pt('p1', 1, 1, 1); pt('p2', 5, 5, 5); const m = addMeasurement('p1', 'p2'); markMeasurementsSaved(fp); expect(hasUnsavedMeasurements()).toBe(false);
    setLabelOffset(m.id, { i: 1, j: 1, k: 1 }); expect(hasUnsavedMeasurements()).toBe(true); markMeasurementsSaved(fp); expect(hasUnsavedMeasurements()).toBe(false);
  });
});

describe('label moves do not rebuild lists; point priority and reset are wired (static)', () => {
  it('an offset-only change is announced as labelOnly; add / remove are not; an unchanged value is silent', () => {
    pt('p1', 1, 1, 1); pt('p2', 5, 5, 5); const seen = [], off = onMeasurementsChange((_, info) => seen.push(info?.labelOnly === true));
    const m = addMeasurement('p1', 'p2'); setLabelOffset(m.id, { i: 1, j: 1, k: 1 }); setLabelOffset(m.id, { i: 1, j: 1, k: 1 }); setLabelOffset(m.id, null); removeMeasurement(m.id);
    expect(seen).toEqual([false, true, true, false]); off();
  });
  it('the views let a point under the press win over a label, reset on double tap, rebuild the list only for real changes', () => {
    const ui = readFileSync(new URL('../../docs/comment-ui.js', import.meta.url), 'utf8'), d3 = readFileSync(new URL('../../docs/comment-3d.js', import.meta.url), 'utf8'), pm = readFileSync(new URL('../../docs/point-menu.js', import.meta.url), 'utf8');
    expect(ui).toContain('hits[p].some(h=>Math.hypot(h.x-x,h.y-y)<=h.r))return;'); // 2D: a mark under the press wins
    expect(d3).toContain('gate()&&nearestDot(x,y)==null'); // 3D: a dot under the press wins (build 523: via allowed(), for both kinds of label)
    expect(ui).toContain('setLabelOffset(L.id,null)'); expect(d3).toContain('setLabelOffset(h.id,off)'); expect(d3).toContain('setOff(null)'); // double tap / click
    expect(ui).toContain('if(!info?.labelOnly)renderMeasures()');
    expect(pm).toContain("'point-menu-labelreset'"); expect(pm).toContain('setLabelOffset(m.id,null)');
  });
});

describe('VR label: default near the line, grab and drag (vr-measure.js)', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
  beforeEach(() => vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }));
  afterEach(() => vi.unstubAllGlobals());
  it('pickLabel finds the label on the ray; dragLabel stores an offset that puts the label where it was dragged to; it survives a rebuild', () => {
    pt('p1', 2, 3, 1); pt('p2', 12, 9, 8); const m = addMeasurement('p1', 'p2');
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), holder = new THREE.Group();
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.05); holder.add(mesh); scene.add(holder); scene.updateMatrixWorld(true);
    const base = { fingerprint: fp, dims: { columns: 16, rows: 16, slices: 12 }, halfExt: [8, 8, 6], mesh, head: new THREE.Vector3(0, 1.6, 0), spacing: [0.1, 0.2, 0.5], hint: '' };
    const v = createVrMeasure(THREE, scene); v.update(base);
    const label = scene.children.find(o => o.isMesh && o.renderOrder === 6), from = label.position.clone();
    const o = new THREE.Vector3(from.x, from.y, from.z + 0.5), d = new THREE.Vector3(0, 0, -1);
    const hit = v.pickLabel(o, d); expect(hit.id).toBe(m.id); expect(hit.distance).toBeCloseTo(0.5, 3);
    expect(v.pickLabel(new THREE.Vector3(from.x + 0.3, from.y, from.z + 0.5), d)).toBeNull(); // a ray beside it
    const target = new THREE.Vector3(from.x + 0.04, from.y + 0.05, from.z - 0.03);
    expect(v.dragLabel(m.id, target)).toBe(true); expect(getMeasurements()[0].labelOffset).toBeTruthy();
    v.update(base); expect(label.position.distanceTo(target)).toBeLessThan(1e-4);
    // a new view (as after a reload: the offset comes from the project) puts it at the same place
    v.dispose(); const v2 = createVrMeasure(THREE, scene); v2.update(base);
    expect(scene.children.find(o => o.isMesh && o.renderOrder === 6).position.distanceTo(target)).toBeLessThan(1e-4); v2.dispose();
  });
  it('a lit label (laser on it / grabbed) is drawn once with the lit style and grows; the canvas is redrawn only when the lit state changes', () => {
    pt('p1', 2, 3, 1); pt('p2', 12, 9, 8); const m = addMeasurement('p1', 'p2');
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), holder = new THREE.Group();
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.05); holder.add(mesh); scene.add(holder); scene.updateMatrixWorld(true);
    const base = { fingerprint: fp, dims: { columns: 16, rows: 16, slices: 12 }, halfExt: [8, 8, 6], mesh, head: new THREE.Vector3(0, 1.6, 0), spacing: [0.1, 0.2, 0.5], hint: '' };
    const v = createVrMeasure(THREE, scene); v.update(base);
    const label = scene.children.find(o => o.isMesh && o.renderOrder === 6), tex = label.material.map, w0 = label.scale.x;
    const v0 = tex.version; v.update(base); v.update({ ...base, lit: new Set() }); expect(tex.version).toBe(v0); // unchanged: no redraw
    v.update({ ...base, lit: new Set([m.id]) }); const v1 = tex.version; expect(v1).toBeGreaterThan(v0);
    expect(label.scale.x).toBeCloseTo(w0 * LABEL_LIT_SCALE, 9);
    v.update({ ...base, lit: new Set([m.id]) }); v.update({ ...base, lit: new Set([m.id]) }); expect(tex.version).toBe(v1); // still lit: no redraw
    v.update(base); expect(tex.version).toBeGreaterThan(v1); expect(label.scale.x).toBeCloseTo(w0, 9); // back to normal
    v.dispose();
  });
});

describe('VR depth cue: behind the volume surface = faint (vr-measure.js, build 493)', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
  beforeEach(() => vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }));
  afterEach(() => vi.unstubAllGlobals());
  const make = () => {
    pt('p1', 2, 3, 1); pt('p2', 12, 9, 8); const m = addMeasurement('p1', 'p2');
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), holder = new THREE.Group();
    holder.position.set(0, 1.3, -0.6); holder.scale.setScalar(0.05); holder.add(mesh); scene.add(holder); scene.updateMatrixWorld(true);
    const base = { fingerprint: fp, dims: { columns: 16, rows: 16, slices: 12 }, halfExt: [8, 8, 6], mesh, head: new THREE.Vector3(0, 1.6, 0), spacing: [0.1, 0.2, 0.5], hint: '' };
    const v = createVrMeasure(THREE, scene); v.update(base);
    return { m, scene, base, v, label: scene.children.find(o => o.isMesh && o.renderOrder === 6), line: scene.children.find(o => o.isLine && o.geometry.attributes.position.count > 2), leader: scene.children.find(o => o.isLine && o.geometry.attributes.position.count === 2) };
  };
  // run enough time for the smooth fade to arrive
  const settle = (v, args) => { let t = 1000; for (let i = 0; i < 30; i++) v.update({ ...args, now: (t += 50) }) };
  it('probes: the 9 samples of every line (the label follows the midpoint) + the label only when it was dragged; they sit on the line in world space', () => {
    const { m, v, base, line } = make(), p = v.probes();
    expect(p.map(x => x.id)).toEqual(Array.from({ length: LINE_SAMPLES + 1 }, (_, i) => probeKey(m.id, i)));
    const pos = line.geometry.attributes.position;
    p.forEach((x, i) => expect(x.world.distanceTo(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)))).toBeLessThan(1e-6));
    expect(LABEL_MID).toBe(LINE_SAMPLES / 2);
    expect(v.dragLabel(m.id, new THREE.Vector3(0.1, 1.5, -0.55))).toBe(true); v.update(base);
    const q = v.probes(); expect(q.length).toBe(LINE_SAMPLES + 2); expect(q[q.length - 1].id).toBe(probeKey(m.id, 'L'));
    expect(q[q.length - 1].world.distanceTo(new THREE.Vector3(0.1, 1.5, -0.55))).toBeLessThan(1e-4);
    removeMeasurement(m.id); v.update(base); expect(v.probes()).toEqual([]); v.dispose();
  });
  it('nothing hidden: everything stays fully visible; the label behind the surface (the midpoint, not dragged) fades with its leader; lit = full again', () => {
    const { m, v, base, label, leader } = make();
    settle(v, base); expect(label.material.opacity).toBe(1); expect(leader.geometry.attributes.color.getW(0)).toBe(1);
    const hid = new Set([probeKey(m.id, LABEL_MID)]);
    settle(v, { ...base, hidden: hid }); expect(label.material.opacity).toBeCloseTo(OCCLUDED_ALPHA, 6); expect(leader.geometry.attributes.color.getW(1)).toBeCloseTo(OCCLUDED_ALPHA, 6);
    settle(v, { ...base, hidden: hid, lit: new Set([m.id]) }); expect(label.material.opacity).toBe(1); // grabbed / laser on it: operable
    settle(v, { ...base, hidden: hid }); expect(label.material.opacity).toBeCloseTo(OCCLUDED_ALPHA, 6);
    settle(v, { ...base, hidden: new Set() }); expect(label.material.opacity).toBe(1);
    v.dispose();
  });
  it('the line fades only where it is hidden (per vertex); a dragged label follows its own probe, not the midpoint', () => {
    const { m, v, base, line, label } = make(), col = line.geometry.attributes.color;
    settle(v, { ...base, hidden: new Set([2, 3, 4].map(i => probeKey(m.id, i))) });
    const f = Math.fround(OCCLUDED_ALPHA); // the attribute is a Float32Array
    expect(Array.from({ length: LINE_SAMPLES + 1 }, (_, i) => col.getW(i))).toEqual([1, 1, f, f, f, 1, 1, 1, 1]);
    expect(label.material.opacity).toBeCloseTo(OCCLUDED_ALPHA, 6); // the midpoint (4) is hidden and the label was not dragged
    v.dragLabel(m.id, new THREE.Vector3(0.1, 1.5, -0.55)); settle(v, { ...base, hidden: new Set([probeKey(m.id, LABEL_MID)]) });
    expect(label.material.opacity).toBe(1); // dragged: its own place is exposed
    settle(v, { ...base, hidden: new Set([probeKey(m.id, 'L')]) }); expect(label.material.opacity).toBeCloseTo(OCCLUDED_ALPHA, 6);
    // a faint label can still be picked by the laser (the pick is geometric)
    const o = label.position.clone().add(new THREE.Vector3(0, 0, 0.5)); expect(v.pickLabel(o, new THREE.Vector3(0, 0, -1))?.id).toBe(m.id);
    v.dispose();
  });
  it('the volume shader is untouched by the depth cue: no depth is written for the labels, they stay depthTest:false (the judgement is CPU)', () => {
    const { v, label, line } = make(); expect(label.material.depthTest).toBe(false); expect(line.material.depthTest).toBe(false); expect(line.material.vertexColors).toBe(true); v.dispose();
  });
});
