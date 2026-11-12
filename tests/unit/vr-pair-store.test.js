import { describe, it, expect } from 'vitest';
import { createPairStore, isPairId, PAIR_ID_PREFIX, PAIR_POINT_MAX } from '../../docs/vr-pair-store.js';
import { createComment, getComments } from '../../docs/comments.js';
import { getMeasurements } from '../../docs/measurements.js';
import { recordVrPoint } from '../../docs/vr-point.js';

import { datasetFingerprint } from '../../docs/project-file.js';
const fp = datasetFingerprint({ id: 'partner', columns: 4, rows: 4, slices: [{ studyUid: '1', seriesUid: '2' }], spacingX: 1, spacingY: 1, spacingZ: 1 });
const add = (s, i = 1, j = 2, k = 3) => s.addComment(createComment({ text: 'p', position: { i, j, k }, series: fp }));

describe('the partner store keeps its points and distances apart from the project\'s', () => {
  it('a point added here gets an id of this store (whatever id the caller made) and never reaches comments.js / measurements.js', () => {
    const s = createPairStore(), before = getComments().length;
    const c = add(s);
    expect(isPairId(c.id)).toBe(true); expect(c.id.startsWith(PAIR_ID_PREFIX)).toBe(true);
    expect(s.getComments()).toHaveLength(1);
    expect(getComments()).toHaveLength(before); expect(getMeasurements()).toEqual([]);
    expect(isPairId('c1abc-1')).toBe(false); expect(isPairId(null)).toBe(false); expect(isPairId(7)).toBe(false);
  });
  it('recordVrPoint (the VR recording) takes the store: numbered by the partner\'s own points', () => {
    const s = createPairStore();
    const a = recordVrPoint({ voxel: { i: 1, j: 1, k: 1 }, series: fp, store: s }), b = recordVrPoint({ voxel: { i: 2, j: 2, k: 2 }, series: fp, store: s });
    expect(a.text).not.toBe(b.text); expect(a.autoKey).toBe(1); expect(b.autoKey).toBe(2); expect(s.getComments().map(c => c.id)).toEqual([a.id, b.id]);
    expect(isPairId(a.id)).toBe(true);
  });
  it('a point that is not a voxel is refused; the cap holds', () => {
    const s = createPairStore();
    expect(s.addComment(null)).toBe(null); expect(s.addComment({ position: { i: 'x', j: 1, k: 1 } })).toBe(null);
    for (let n = 0; n < PAIR_POINT_MAX; n++) expect(add(s, n, 0, 0)).not.toBe(null);
    expect(add(s)).toBe(null);
  });
  it('move and colour: a valid change goes through, a bad value is refused, the copies are not the store\'s own', () => {
    const s = createPairStore(), c = add(s);
    expect(s.updateCommentPosition(c.id, { i: 5, j: 6, k: 7 }).position).toEqual({ i: 5, j: 6, k: 7 });
    expect(s.updateCommentPosition(c.id, { i: 'a' })).toBe(null); expect(s.updateCommentPosition('nope', { i: 1, j: 1, k: 1 })).toBe(null);
    expect(s.updateCommentColor(c.id, '#ff0000').color).toBe('#ff0000'); expect(s.updateCommentColor(c.id, 'red')).toBe(null);
    expect(s.updateCommentColor(c.id, null).color).toBeUndefined();
    const g = s.getComments(); g[0].position.i = 99; expect(s.getComments()[0].position.i).toBe(5);
  });
  it('a distance joins two different points of the store; the same pair again is the existing one; a point\'s delete takes its distances along and the undo brings both back', () => {
    const s = createPairStore(), a = add(s, 1, 1, 1), b = add(s, 4, 5, 1), c = add(s, 9, 9, 9);
    expect(s.addMeasurement(a.id, a.id)).toBe(null); expect(s.addMeasurement(a.id, 'pp-c99')).toBe(null);
    const m = s.addMeasurement(a.id, b.id); expect(isPairId(m.id)).toBe(true);
    expect(s.addMeasurement(b.id, a.id)).toMatchObject({ id: m.id, existed: true });
    s.addMeasurement(b.id, c.id);
    const ms = s.measurementsOfPoint(b.id); expect(ms).toHaveLength(2);
    const all = s.getComments(), idx = all.findIndex(x => x.id === b.id), cb = all[idx];
    expect(s.removeComment(b.id)).toBe(true); expect(s.getMeasurements()).toEqual([]);
    expect(s.restoreComment(cb, idx)).toBe(true); expect(s.restoreComment(cb, idx)).toBe(false); // an id in use is refused
    expect(s.getComments().map(x => x.id)).toEqual([a.id, b.id, c.id]);
    expect(s.restoreMeasurements(ms)).toBe(true); expect(s.getMeasurements().map(x => x.id).sort()).toEqual(ms.map(x => x.id).sort());
    expect(s.restoreMeasurements(ms)).toBe(false); // nothing twice
  });
  it('the label offset: set, cleared, a bad value refused', () => {
    const s = createPairStore(), a = add(s), b = add(s, 2, 2, 2), m = s.addMeasurement(a.id, b.id);
    expect(s.setLabelOffset(m.id, { i: 3, j: -2, k: 0.5 })).toBe(true); expect(s.getMeasurements()[0].labelOffset).toEqual({ i: 3, j: -2, k: 0.5 });
    expect(s.setLabelOffset(m.id, { i: 'x' })).toBe(false); expect(s.getMeasurements()[0].labelOffset).toEqual({ i: 3, j: -2, k: 0.5 });
    expect(s.setLabelOffset(m.id, null)).toBe(true); expect(s.getMeasurements()[0].labelOffset).toBeUndefined();
    expect(s.setLabelOffset('nope', null)).toBe(false);
  });
  it('the distance flow: the start arms it, the end creates, the same point / a refused one keeps it armed, a deleted start drops it', () => {
    const s = createPairStore(), a = add(s), b = add(s, 2, 2, 2);
    expect(s.pickMeasureEnd(b.id)).toEqual({ kind: 'none' }); expect(s.startMeasure('nope')).toBe(false);
    expect(s.startMeasure(a.id)).toBe(true); expect(s.getMeasureStart()).toBe(a.id);
    expect(s.pickMeasureEnd(a.id)).toMatchObject({ kind: 'same' }); expect(s.pickMeasureEnd('pp-c99')).toMatchObject({ kind: 'refused' }); expect(s.getMeasureStart()).toBe(a.id);
    expect(s.pickMeasureEnd(b.id)).toMatchObject({ kind: 'created', a: a.id, b: b.id }); expect(s.getMeasureStart()).toBe(null);
    s.startMeasure(a.id); expect(s.pickMeasureEnd(b.id)).toMatchObject({ kind: 'existed' });
    s.startMeasure(a.id); s.removeComment(a.id); expect(s.getMeasureStart()).toBe(null);
    const c = add(s, 7, 7, 7); s.startMeasure(c.id); expect(s.cancelMeasure()).toBe(true); expect(s.cancelMeasure()).toBe(false);
  });
  it('onChange tells every change; clear empties everything and the listener can be removed', () => {
    const s = createPairStore(); let n = 0; const off = s.onChange(() => { n++; });
    const a = add(s); s.updateCommentPosition(a.id, { i: 9, j: 9, k: 9 }); expect(n).toBe(2);
    s.updateCommentPosition(a.id, { i: 9, j: 9, k: 9 }); expect(n).toBe(2); // unchanged: not a change
    s.startMeasure(a.id); s.clear(); expect(s.getComments()).toEqual([]); expect(s.getMeasureStart()).toBe(null);
    off(); const k = n; add(s); expect(n).toBe(k);
  });
});
