import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// Child segments, 3D edit: a child has an edit state of the preset's shape (segments.js registerChildEditState), so the preset edit code (keep / exclude / undo / redo / reset on segmentEditState) works on it;
// segmentEditsChanged writes base ∩ keep - exclude into the child's OWN runsBySlice (voxels, hash follow; kind 'edit' is announced), never outside its base (= the parent's range), and the presets' behaviour is untouched.
installDomStub();
let S, ST, C, R;
beforeAll(async () => { S = await importApp('segments'); ST = await importApp('state'); C = await importApp('child-segments'); R = await importApp('run-length'); });
afterEach(() => { for (const c of ST.childSegments) S.unregisterChildEditState(c.key); C.clearChildSegments(); for (const k of S.SEGMENT_PRESET_ORDER) { const st = S.segmentEditState[k]; st.keepRuns = null; st.excludeRuns = null; st.undo = []; st.redo = []; } });
const D = 4;
// slice 1: row 5 holds x 2..9 (8 voxels), row 6 holds x 2..5 (4); slice 2: row 5 holds x 2..9 (8): 20 voxels
const baseRuns = () => { const r = Array.from({ length: D }, () => null); r[1] = [5, 2, 9, 6, 2, 5]; r[2] = [5, 2, 9]; return r; };
const mk = () => { const c = C.addChildSegment({ name: 'Femur', parentKey: 'bone', runsBySlice: baseRuns(), color: 0x00d8ff }); S.registerChildEditState(c); return c; };
const edit = (key, fn) => { const st = S.segmentEditState[key]; fn(st); st.finalRuns = null; st.revision++; S.segmentEditsChanged(key); };

describe('child segment edit state', () => {
  it('a registered child has an edit state like a preset (its base = the mask) and counts as edited for the preset edit code', () => {
    const c = mk(), st = S.segmentEditState[c.key];
    expect(st.baseRuns).toBe(c.runsBySlice); expect(st.undo).toEqual([]); expect(st.keepRuns).toBe(st.baseRuns); expect(S.segmentEditGen[c.key]).toBe(0); // keepRuns = baseRuns: the marker that makes segmentEditActive (the 704 expression) true
    expect(S.segmentEditActive(c.key)).toBe(true); // a child's voxels are its own runs, never a threshold
    expect(S.segmentEditActive('bone')).toBe(false); // the preset: unchanged (no keep / exclude)
    edit(c.key, s => { s.keepRuns = null; }); expect(st.keepRuns).toBe(st.baseRuns); expect(S.segmentEditActive(c.key)).toBe(true); // an undo / reset to "no edit" (keepRuns null) puts the marker back
    S.unregisterChildEditState(c.key); expect(S.segmentEditState[c.key]).toBeUndefined();
  });
  it('delete (exclude) takes voxels out of the CHILD: runs, voxel count and hash follow, the base is kept', () => {
    const c = mk(), h0 = c.hash, events = [], off = C.onChildSegChange(e => events.push(e.kind + ':' + e.key));
    edit(c.key, st => { st.excludeRuns = [null, [5, 4, 5], null, null]; });
    off();
    expect(c.voxels).toBe(20 - 2); expect(c.hash).not.toBe(h0);
    expect(R.analysisRunsContain(c.runsBySlice, 4, 5, 1)).toBe(false); expect(R.analysisRunsContain(c.runsBySlice, 3, 5, 1)).toBe(true);
    expect(R.analysisRunsVoxelCount(S.segmentEditState[c.key].baseRuns)).toBe(20);
    expect(events).toContain('edit:' + c.key);
  });
  it('keep (intersect) leaves only the kept voxels; a keep outside the child adds nothing (never outside the parent\'s range)', () => {
    const c = mk();
    edit(c.key, st => { st.keepRuns = [null, [5, 0, 3, 7, 0, 20], [9, 0, 20], null]; }); // rows 7 / 9 are not the child's
    expect(c.voxels).toBe(2); expect(R.analysisRunsContain(c.runsBySlice, 2, 5, 1)).toBe(true); expect(R.analysisRunsContain(c.runsBySlice, 7, 7, 1)).toBe(false); expect(R.analysisRunsContain(c.runsBySlice, 5, 9, 2)).toBe(false);
  });
  it('undo / reset: restoring the snapshot gives the first mask back, the hash too', () => {
    const c = mk(), h0 = c.hash, st = S.segmentEditState[c.key];
    st.undo.push({ keepRuns: st.keepRuns, excludeRuns: st.excludeRuns, cutRuns: st.cutRuns, rawCutSurface: false, analysisRefs: [] });
    edit(c.key, s => { s.excludeRuns = [null, [5, 2, 9], [5, 2, 9], null]; });
    expect(c.voxels).toBe(4); // only row 6 of slice 1 is left
    const snap = st.undo.pop(); st.keepRuns = snap.keepRuns; st.excludeRuns = snap.excludeRuns; st.revision++; S.segmentEditsChanged(c.key); // what analysis-ops.js restoreEditSnapshot does
    expect(c.voxels).toBe(20); expect(c.hash).toBe(h0);
  });
  it('a child edit does not touch the preset edit state, and the parent sees the child through its hash (the voxels come back to it)', () => {
    const c = mk(); S.segmentState.bone.min = 300; S.segmentState.bone.max = 1500;
    const sig0 = S.segmentSourceSignature('bone'), gen0 = S.segmentEditGen.bone;
    edit(c.key, st => { st.excludeRuns = [null, [5, 2, 9], null, null]; });
    expect(S.segmentSourceSignature('bone')).not.toBe(sig0); expect(S.segmentEditGen.bone).toBe(gen0); expect(S.segmentEditState.bone.excludeRuns).toBeNull(); expect(S.segmentEditState.bone.undo).toEqual([]);
  });
  it('the edit state of a deleted child is gone (its selection regions and target are cleaned up by app.js on the list change)', () => {
    const c = mk(); S.unregisterChildEditState(c.key); C.removeChildSegment(c.key);
    expect(S.segmentEditState[c.key]).toBeUndefined(); expect(S.segmentEditActive(c.key)).toBe(false); expect(S.segmentEditGen[c.key]).toBeUndefined();
  });
  it('a selection region of a child follows the child (shown while the child and its parent are shown)', () => {
    const c = mk(), r = { segmentKeys: [c.key] };
    S.segmentState.bone.active = true; S.segmentState.bone.enabled = true; expect(S.analysisRegionSegmentsShown(r)).toBe(true);
    C.childByKey(c.key).visible = false; expect(S.analysisRegionSegmentsShown(r)).toBe(false);
    C.childByKey(c.key).visible = true; S.segmentState.bone.enabled = false; expect(S.analysisRegionSegmentsShown(r)).toBe(false);
    S.segmentState.bone.active = false;
    expect(S.analysisRegionSegmentsShown({ segmentKeys: ['nosuch'] })).toBe(false); // the preset rule as it was: an unknown / unticked key shows nothing
  });
  it('a child whose edit left nothing is empty (undoable), and the project file leaves it out', () => {
    const c = mk(); edit(c.key, st => { st.excludeRuns = [null, [5, 0, 99, 6, 0, 99], [5, 0, 99], null]; });
    expect(c.voxels).toBe(0); expect(C.childSegmentsForProject()).toEqual([]);
  });
  it('save -> load: the edited mask is what the project holds (the edit stack is not saved)', () => {
    const c = mk(); edit(c.key, st => { st.excludeRuns = [null, [5, 4, 5], null, null]; });
    const saved = C.childSegmentsForProject(); expect(saved.length).toBe(1);
    const back = C.addChildSegment(C.childSrcFromEntry(saved[0].entry, saved[0].runsBySlice.map(a => (a ? Array.from(a) : a))));
    S.registerChildEditState(back);
    expect(back.voxels).toBe(18); expect(back.hash).toBe(c.hash); expect(S.segmentEditState[back.key].undo).toEqual([]);
  });
});
