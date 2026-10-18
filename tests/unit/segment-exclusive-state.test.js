import { describe, it, expect, beforeAll } from 'vitest';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { segmentRunsCacheKey } from '../../docs/segment-cache-key.js';

// build 459: dependencies between segments (which segments follow a higher one) and the keys that must change with them
installDomStub();
let S, R;
beforeAll(async () => { S = await importApp('segments'); R = await importApp('segment-runs'); });

function setup(spec, order = ['bone', 'fat', 'soft', 'lung']) {
  S.segmentExclusive.mode = 'priority'; S.segmentExclusive.order = order;
  for (const k of ['bone', 'soft', 'fat', 'lung']) {
    const p = spec[k], g = S.segmentState[k], st = S.segmentEditState[k];
    Object.assign(g, { active: !!p, enabled: true, opening: 0, closing: 0, holeFill: false, minComponent: 0, surfaceMm: 0, thicknessMm: 0, _maskCache: null, exclusive: undefined, ...(p || {}), userMin: p?.min ?? 0, userMax: p?.max ?? 1 });
    Object.assign(st, { baseRuns: null, baseSignature: '', pendingBase: null, finalRuns: null, keepRuns: null, excludeRuns: null, cutRuns: null, undo: [], redo: [] });
    S.segmentEditGen[k]++;
  }
  S.applyExclusiveRanges(); S.segmentExclusive.pending.clear();
}

describe('dependents, signatures and invalidation', () => {
  it('dependentsOf follows the sources transitively', () => {
    setup({ bone: { min: 300, max: 2000, minComponent: 2 }, fat: { min: -250, max: 400, minComponent: 2 }, soft: { min: -93, max: 1000 } });
    expect(S.segmentSourcesOf('fat')).toEqual(['bone']);
    expect(S.segmentSourcesOf('soft')).toEqual(['bone', 'fat']);
    expect(S.dependentsOf('bone').sort()).toEqual(['fat', 'soft']);
    expect(S.dependentsOf('fat')).toEqual(['soft']);
    expect(S.dependentsOf('soft')).toEqual([]);
  });
  it('the base signature of a lower segment follows the sources\' processing, range and edit generation', () => {
    setup({ bone: { min: 300, max: 2000, minComponent: 2 }, soft: { min: 0, max: 1000 } });
    const v = { columns: 4, rows: 4, slices: 2 };
    const a = R.segmentBaseSignature('soft', v);
    expect(R.segmentBaseSignature('soft', v)).toBe(a);
    S.segmentState.bone.minComponent = 5;
    const b = R.segmentBaseSignature('soft', v);
    expect(b).not.toBe(a);
    S.segmentState.bone.minComponent = 2;
    expect(R.segmentBaseSignature('soft', v)).toBe(a);
    S.segmentEditGen.bone++;
    expect(R.segmentBaseSignature('soft', v)).not.toBe(a);
  });
  it('commitExclusiveRanges invalidates the segments that depend on a changed one, as dependents', () => {
    setup({ bone: { min: 300, max: 2000, minComponent: 2 }, soft: { min: 0, max: 1000 } });
    const calls = [];
    S.segmentExclusive.invalidate = (keys, deps) => calls.push([[...keys], [...deps]]);
    S.segmentState.bone.minComponent = 4;
    S.commitExclusiveRanges('bone');
    expect(calls).toEqual([[['bone'], ['soft']]]);
    S.segmentExclusive.invalidate = null;
  });
  it('a manual edit makes the segment a voxel taker and invalidates the segments below', () => {
    setup({ bone: { min: 300, max: 2000 }, soft: { min: 0, max: 1000 } });
    expect(S.segmentSourcesOf('soft')).toEqual([]);
    const calls = [];
    S.segmentExclusive.invalidate = (keys, deps) => calls.push([[...keys], [...deps]]);
    S.segmentEditState.bone.excludeRuns = [new Uint32Array([0, 0, 0])];
    S.segmentEditsChanged('bone');
    expect(S.segmentSourcesOf('soft')).toEqual(['bone']);
    expect(S.segmentState.soft.min).toBe(0); // no longer cut by bone's range
    expect(calls).toEqual([[[], ['soft']]]);
    S.segmentExclusive.invalidate = null;
  });
  it('a hidden (not shown) upper segment still counts as a source', () => {
    setup({ bone: { min: 300, max: 2000, minComponent: 2 }, soft: { min: 0, max: 1000 } });
    S.segmentState.bone.enabled = false; S.applyExclusiveRanges();
    expect(S.segmentSourcesOf('soft')).toEqual(['bone']);
  });
  it('manual edits upstream are reported (they cannot be part of a device cache entry)', () => {
    setup({ bone: { min: 300, max: 2000 }, fat: { min: -250, max: 400, minComponent: 2 }, soft: { min: -93, max: 1000, minComponent: 2 } });
    expect(S.segmentHasManualEditsUpstream('soft')).toBe(false);
    S.segmentEditState.bone.excludeRuns = [new Uint32Array([0, 0, 0])]; S.segmentEditsChanged('bone');
    expect(S.segmentHasManualEditsUpstream('soft')).toBe(true);
  });
  it('the device cache key changes with the sources (their settings), but not with a session edit counter', async () => {
    const series = { id: 's', slices: [{}], columns: 2, rows: 2, bits: 16 };
    const seg = { min: 0, max: 1000, opening: 0, closing: 0, minComponent: 0, holeFill: false, surfaceMm: 0, thicknessMm: 0 };
    setup({ bone: { min: 300, max: 2000, minComponent: 2 }, soft: { min: 0, max: 1000 } });
    const sig = () => S.segmentSourceSignature('soft', false);
    const k0 = await segmentRunsCacheKey(series, 'f', seg, { sources: sig() });
    S.segmentEditGen.bone++;
    expect(await segmentRunsCacheKey(series, 'f', seg, { sources: sig() })).toBe(k0);
    S.segmentState.bone.minComponent = 9;
    const k1 = await segmentRunsCacheKey(series, 'f', seg, { sources: sig() });
    expect(k1).not.toBe(k0);
    expect(await segmentRunsCacheKey(series, 'f', seg, null)).not.toBe(k0);
  });
});
