import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// The overlap settings as loaded (mode, order, the loaded segment's min / max / sources) are not touched by adding / removing another segment; only the added segment itself gets its own range / sources from the priority.
// sample7 (zebrafish, 8 regions) / sample8 (12 regions): analysis regions on the contrast preset, overlap rule 'priority' in the saved card order, bone / fat inactive with a default range that covers the whole data (0..255), the contrast preset edited (keep runs).
// Adding a preset (bone, then fat) and removing it again must leave the regions as they were: count, colour, name, label, ids. (The page: segment-ui.js addSegmentPreset / removeSegmentPreset, app.js invalidateSegment.)
installDomStub();
let S, ST, U, V;
beforeAll(async () => { S = await importApp('segments'); ST = await importApp('state'); U = await importApp('segment-ui'); V = await importApp('vr-volume-prep'); });
const saved = {};
afterEach(() => { ST.setAnalysisRegions([]); S.segmentExclusive.mode = 'priority'; S.segmentExclusive.invalidate = null; for (const k of S.SEGMENT_PRESET_ORDER) { const s = S.segmentState[k]; s.active = false; s.enabled = false; s.exclusive = undefined; s.userMin = s.userMax = null; const st = S.segmentEditState[k]; st.keepRuns = null; st.excludeRuns = null; } });
const runs = i => { const r = Array.from({ length: 4 }, () => null); r[1] = [i, 2, 9]; return r; };
const regions = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, key: 'contrast', segmentKeys: ['contrast'], color: 0x100000 + i * 0x1111, name: 'R' + i, label: 'L' + i, atlasId: 1000 + i, voxels: 8, mm3: 1, visible: true, runsBySlice: runs(i) }));
function load(n, order) {
  S.segmentExclusive.mode = 'priority'; S.segmentExclusive.order = order; // sample7 / sample8 as saved: rule priority, the saved card order
  for (const k of S.SEGMENT_PRESET_ORDER) { const s = S.segmentState[k]; s.active = k === 'contrast'; s.enabled = k === 'contrast'; s.min = 0; s.max = 255; s.userMin = 0; s.userMax = 255; s.opening = s.closing = s.minComponent = 0; s.holeFill = false; }
  S.segmentEditState.contrast.keepRuns = runs(1); // the project's edits/contrast-keep.bin: contrast is a voxel taker
  S.commitExclusiveRanges();
  ST.setAnalysisRegions(regions(n));
}
const snapshot = () => JSON.stringify(ST.analysisRegions.map(r => [r.id, r.color, r.name, r.label, r.atlasId, r.segmentKeys]));
const settings = () => JSON.stringify([S.segmentExclusive.mode, S.segmentExclusive.order, ['contrast'].map(k => { const s = S.segmentState[k]; return [k, s.min, s.max, s.userMin, s.userMax, s.exclusive?.sources || []]; })]);
// what the page does on "add segment" (segment-ui.js addSegmentPreset, without its DOM): the ranges, then the invalidation of the segments that changed (app.js invalidateSegment: only the results of that segment)
function add(key, calls) {
  const seg = S.segmentState[key]; seg.active = true; seg.enabled = true;
  S.segmentExclusive.invalidate = (keys, deps = []) => { for (const k of [...keys, ...deps]) { calls?.push(k); U.clearAnalysisRegionsOf(k); } };
  S.commitExclusiveRanges();
}

describe.each([[8, ['contrast', 'bone', 'fat', 'soft', 'lung']], [12, ['contrast', 'bone', 'soft', 'fat', 'lung']]])('%i regions on the contrast preset (rule priority, saved order)', (n, order) => {
  it('adding bone, then fat keeps every region (count, colour, name, label) and changes no overlap setting', () => {
    load(n, order); const before = snapshot(), set0 = settings();
    add('bone'); expect(ST.analysisRegions.length).toBe(n); expect(snapshot()).toBe(before); expect(settings()).toBe(set0);
    add('fat'); expect(ST.analysisRegions.length).toBe(n); expect(snapshot()).toBe(before); expect(settings()).toBe(set0);
    expect(S.segmentExclusive.mode).toBe('priority'); expect(S.segmentExclusive.order).toEqual(order);
  });
  it('VR path: regionItemsOf-style items (segMask from the GPU slot order) stay n separate results after the add, each pointing at the contrast slot', () => {
    load(n, order); add('bone'); add('fat');
    const slots = S.gpuSegmentOrder(), items = ST.analysisRegions.map(r => ({ color: r.color, segMask: r.segmentKeys.reduce((m, k) => (slots.indexOf(k) >= 0 ? m | (1 << slots.indexOf(k)) : m), 0), runsBySlice: r.runsBySlice, mm3: r.mm3, segmentKeys: [...r.segmentKeys], rid: r.id }));
    const idx = V.buildRegionIndexOf(items, [16, 16, 4], [16, 16, 4]);
    expect(idx.list.length).toBe(n); expect(idx.colors.length).toBe(n); expect(new Set(idx.list.map(l => l.rid)).size).toBe(n);
    for (const l of idx.list) expect(l.segMask).toBe(1 << slots.indexOf('contrast'));
  });
  it('removing the added segments leaves the contrast regions and the settings as they were', () => {
    load(n, order); const before = snapshot(), set0 = settings(); add('bone'); add('fat');
    for (const k of ['fat', 'bone']) { S.segmentState[k].active = false; S.segmentState[k].enabled = false; S.commitExclusiveRanges(); U.clearAnalysisRegionsOf(k); }
    expect(snapshot()).toBe(before); expect(settings()).toBe(set0);
  });
  it('a segment that changes clears its own results only (priority rule: bone follows the edited contrast; the contrast results stay)', () => {
    load(n, order); S.segmentExclusive.mode = 'priority'; S.commitExclusiveRanges(); const before = snapshot();
    ST.setAnalysisRegions([...ST.analysisRegions, { id: 99, key: 'bone', segmentKeys: ['bone'], color: 1, voxels: 1, mm3: 1, runsBySlice: runs(3) }]);
    const calls = []; add('bone', calls);
    expect(calls).toContain('bone'); expect(calls).not.toContain('contrast');
    expect(snapshot()).toBe(before); expect(ST.analysisRegions.some(r => r.key === 'bone')).toBe(false);
  });
});
