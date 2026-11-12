// The points and distances of the PARTNER volume of a sample pair (stage 3 of the sample pair work). Pure: no DOM, no three.js, no app state; unit-tested in tests/unit/vr-pair-store.test.js.
// The primary's points live in comments.js / measurements.js: ONE list shared with the PC / iPad page, saved with the project file. The partner's must not: they are only for this VR session (the partner is not part of the
// project), so they are kept here, in memory, in a store that belongs to the partner and is dropped with it (vr-view.js bindPair / unbindPair). Nothing in this module reads or writes comments.js / measurements.js state: it uses
// their PURE helpers only (createComment, commentVoxel, normalizeColor, normalizeLabelOffset).
// The store has the shape the VR code already uses for the primary's (so vr-point.js recordVrPoint, createVrPointMarkers and createVrMeasure take it as their `deps`):
//   points : getComments() / addComment(c) / removeComment(id) / restoreComment(c, index) / updateCommentPosition(id, voxel) / updateCommentColor(id, hex|null)
//   distances: getMeasurements() / addMeasurement(a, b) / removeMeasurement(id) / restoreMeasurements(list) / setLabelOffset(id, offset) / measurementsOfPoint(id)
//   the distance flow: startMeasure(id) / getMeasureStart() / cancelMeasure() / pickMeasureEnd(id) -> { kind: 'created' | 'existed' | 'same' | 'refused' | 'none', ... }
//   onChange(cb) -> off; clear() (everything, when the partner goes)
// Ids start with PAIR_ID_PREFIX, so an id says which store owns it (vr-view.js routes by it); a point added here gets its id here (whatever id the caller's createComment made).
import { commentVoxel } from './comments.js?v=20261112-build720';
import { normalizeColor } from './point-colors.js?v=20261112-build720';
import { normalizeLabelOffset } from './measurements.js?v=20261112-build720';

export const PAIR_ID_PREFIX = 'pp-';
export const isPairId = id => typeof id === 'string' && id.startsWith(PAIR_ID_PREFIX);
export const PAIR_POINT_MAX = 500, PAIR_MEASURE_MAX = 500; // the same cap as the primary's distances (measurements.js MEASURE_MAX)
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const copyPoint = c => ({ ...c, position: { ...c.position } });
const copyMeasure = m => { const lo = normalizeLabelOffset(m.labelOffset); return lo ? { id: m.id, a: m.a, b: m.b, labelOffset: lo } : { id: m.id, a: m.a, b: m.b }; };

export function createPairStore() {
  let points = [], dists = [], start = null, nPoint = 0, nDist = 0;
  const listeners = new Set();
  const emit = () => { for (const cb of [...listeners]) { try { cb(); } catch (e) { console.warn('pair store listener failed', e); } } };
  const dropStartIfGone = () => { if (start !== null && !points.some(c => c.id === start)) start = null; };
  const self = {
    getComments: () => points.map(copyPoint),
    addComment(c) {
      if (!c || !commentVoxel(c.position) || points.length >= PAIR_POINT_MAX) return null;
      const p = { ...c, id: PAIR_ID_PREFIX + 'c' + (++nPoint), position: commentVoxel(c.position) };
      points = [...points, p]; emit(); return copyPoint(p);
    },
    removeComment(id) {
      const n = points.length; points = points.filter(c => c.id !== id); if (points.length === n) return false;
      dists = dists.filter(m => m.a !== id && m.b !== id); dropStartIfGone(); emit(); return true; // a point's distances go with it
    },
    // put a deleted point back where it was (the undo of a delete); false when the id is in use
    restoreComment(c, index = points.length) {
      if (!c || !isPairId(c.id) || points.some(x => x.id === c.id) || !commentVoxel(c.position)) return false;
      const at = Math.max(0, Math.min(+index || 0, points.length));
      points = [...points.slice(0, at), copyPoint(c), ...points.slice(at)]; emit(); return true;
    },
    // move a point: the position only; an invalid voxel or an unknown id is refused (null), an unchanged place is not a change
    updateCommentPosition(id, position) {
      const pos = commentVoxel(position), i = points.findIndex(c => c.id === id); if (!pos || i < 0) return null;
      const o = points[i].position;
      if (o.i !== pos.i || o.j !== pos.j || o.k !== pos.k) { points = points.map((c, n) => (n === i ? { ...c, position: pos } : c)); emit(); }
      return copyPoint(points[i]);
    },
    // set / clear the colour: a valid '#rrggbb' sets it, null / '' goes back to the auto colour, anything else is refused (null)
    updateCommentColor(id, color) {
      const none = color === null || color === undefined || color === '', col = none ? null : normalizeColor(color);
      if (!none && !col) return null;
      const i = points.findIndex(c => c.id === id); if (i < 0) return null;
      if ((points[i].color || null) !== col) { points = points.map((c, n) => { if (n !== i) return c; const { color: _o, ...rest } = c; return col ? { ...rest, color: col } : rest; }); emit(); }
      return copyPoint(points[i]);
    },
    getMeasurements: () => dists.map(copyMeasure),
    measurementsOfPoint: id => dists.filter(m => m.a === id || m.b === id).map(copyMeasure),
    // a new distance between two existing, different points; the same pair again returns the existing one ({existed: true}); null = refused
    addMeasurement(a, b) {
      if (!a || !b || a === b || dists.length >= PAIR_MEASURE_MAX || !points.some(c => c.id === a) || !points.some(c => c.id === b)) return null;
      const same = dists.find(m => pairKey(m.a, m.b) === pairKey(a, b)); if (same) return { ...copyMeasure(same), existed: true };
      const m = { id: PAIR_ID_PREFIX + 'm' + (++nDist), a, b }; dists = [...dists, m]; emit(); return copyMeasure(m);
    },
    removeMeasurement(id) { const n = dists.length; dists = dists.filter(m => m.id !== id); if (dists.length === n) return false; emit(); return true; },
    // the undo of a delete: only those whose points exist, not duplicating an id or a pair
    restoreMeasurements(list) {
      const ids = new Set(points.map(c => c.id)), have = new Set(dists.map(m => m.id)), pairs = new Set(dists.map(m => pairKey(m.a, m.b))); let n = 0;
      for (const m of list || []) {
        if (!m || !isPairId(m.id) || !ids.has(m.a) || !ids.has(m.b) || m.a === m.b || have.has(m.id) || pairs.has(pairKey(m.a, m.b))) continue;
        dists = [...dists, copyMeasure(m)]; have.add(m.id); pairs.add(pairKey(m.a, m.b)); n++;
      }
      if (n) emit(); return n > 0;
    },
    // move the label (offset {i,j,k} in voxel units from the midpoint) or null = the default place; a value that is not an offset is refused
    setLabelOffset(id, offset) {
      const i = dists.findIndex(m => m.id === id); if (i < 0) return false;
      const lo = normalizeLabelOffset(offset); if (offset !== null && offset !== undefined && !lo) return false;
      const old = dists[i].labelOffset, same = (old ? old.i + ',' + old.j + ',' + old.k : '') === (lo ? lo.i + ',' + lo.j + ',' + lo.k : ''); if (same) return true;
      const { labelOffset: _o, ...rest } = dists[i]; dists = dists.map((m, n) => (n === i ? (lo ? { ...rest, labelOffset: lo } : rest) : m)); emit(); return true;
    },
    getMeasureStart: () => start,
    startMeasure(id) { if (!id || !points.some(c => c.id === id)) return false; start = id; emit(); return true; },
    cancelMeasure() { if (start === null) return false; start = null; emit(); return true; },
    // the END point was chosen: the start again changes nothing (still armed); a refused pair keeps it armed too; a created / existing pair finishes the flow
    pickMeasureEnd(id) {
      const a = start; if (!a) return { kind: 'none' };
      if (id === a) return { kind: 'same', a };
      const m = self.addMeasurement(a, id); if (!m) return { kind: 'refused', a };
      start = null; emit(); return m.existed ? { kind: 'existed', a, b: id, m } : { kind: 'created', a, b: id, m };
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    clear() { points = []; dists = []; start = null; emit(); },
  };
  return self; // (the methods are handed out one by one as deps of the markers / the distances: none of them uses `this`)
}
