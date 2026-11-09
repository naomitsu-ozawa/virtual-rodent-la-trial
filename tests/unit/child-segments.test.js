import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  childSegNormalizeOpacity, childSegNormalizeMaterial, childSegNormalizeShade, childSegLookOf, childSegApplyLook, childSegLookToProject, childSegLookIsDefault, isChildKey, childSegColorCss, CHILD_SEG_MATERIALS,
} from '../../docs/segment-look.js';
import { createShadeHist, binShadeRuns, autoShadeRange, dataRangeOf } from '../../docs/cap-shade.js';
import { MATERIAL_KEYS } from '../../docs/lighting.js';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// a segment added under a preset in the tree is a REAL segment with every feature of a preset card. One interface for the presets and the children (segments.js segmentById /
// allSegmentKeys; never the analysis regions), the look fields saved on each entry of project.treeSegments, the atlas entries of an older project become children, the other region entries stay regions.
const src = n => readFileSync('docs/' + n, 'utf8');
installDomStub();
let S, ST, C;
beforeAll(async () => { S = await importApp('segments'); ST = await importApp('state'); C = await importApp('child-segments'); });
afterEach(() => { C.clearChildSegments(); ST.setAnalysisRegions([]); for (const k of ['bone', 'contrast']) { S.segmentState[k].active = false; S.segmentState[k].enabled = false; } S.clearSegmentShadeRanges(); S.clearSegmentShadeAuto(); S.shadeAutoPage.reset(); });
const DATA = dataRangeOf(-1000, 3000);
const runs = (n = 1, z = 0) => { const r = Array.from({ length: 4 }, () => null); r[z] = [1, 2, 2 + n]; return r; }; // n+1 voxels in one row of one slice
const mk = (extra = {}) => C.addChildSegment({ name: 'Femur', parentKey: 'bone', runsBySlice: runs(3), color: 0xff00cc, ...extra });

describe('segment-look.js: the look of a child segment', () => {
  it('defaults: opacity 1, material standard, shade null (auto)', () => {
    expect(childSegLookOf({})).toEqual({ opacity: 1, material: 'standard', shade: null });
    expect(childSegLookOf(null)).toEqual({ opacity: 1, material: 'standard', shade: null });
    expect(childSegLookIsDefault({})).toBe(true);
  });
  it('the material keys are the lighting.js MATERIALS (the preset card\'s display modes)', () => { expect([...CHILD_SEG_MATERIALS].sort()).toEqual([...MATERIAL_KEYS].sort()); });
  it('opacity is clamped to 0..1, a non-number is the default; a material that does not exist is standard', () => {
    expect([childSegNormalizeOpacity(0.4), childSegNormalizeOpacity(2), childSegNormalizeOpacity(-1), childSegNormalizeOpacity('x'), childSegNormalizeOpacity(null), childSegNormalizeOpacity(0)]).toEqual([0.4, 1, 0, 1, 1, 0]);
    expect([childSegNormalizeMaterial('plaster'), childSegNormalizeMaterial('nope'), childSegNormalizeMaterial(undefined)]).toEqual(['plaster', 'standard', 'standard']);
  });
  it('shade: {lower, upper} or the project spelling {min, max}; ordered; anything else is null (auto)', () => {
    expect(childSegNormalizeShade({ lower: 10, upper: 90 })).toEqual({ lower: 10, upper: 90 });
    expect(childSegNormalizeShade({ min: 90, max: 10 })).toEqual({ lower: 10, upper: 90 });
    for (const bad of [null, undefined, {}, { lower: 1 }, { lower: 'a', upper: 2 }, 5, { min: null, max: 3 }]) expect(childSegNormalizeShade(bad)).toBeNull();
  });
  it('save -> load round trip of every look field', () => {
    const r = childSegApplyLook({}, { opacity: 0.35, material: 'plastic', shade: { lower: -50, upper: 400 } });
    const entry = JSON.parse(JSON.stringify(childSegLookToProject(r)));
    expect(entry).toEqual({ opacity: 0.35, material: 'plastic', shade: { min: -50, max: 400 } });
    expect(childSegLookOf(entry)).toEqual({ opacity: 0.35, material: 'plastic', shade: { lower: -50, upper: 400 } });
  });
  it('key / colour helpers: a child key is s<id>, a region key r<id> or a preset key is not; colours become #rrggbb', () => {
    expect([isChildKey('s12'), isChildKey('bone'), isChildKey('r12'), isChildKey('s'), isChildKey(7), isChildKey('s1a')]).toEqual([true, false, false, false, false, false]);
    expect([childSegColorCss(0xff00cc), childSegColorCss('#AABBCC'), childSegColorCss(0x0000ff), childSegColorCss(undefined)]).toEqual(['#ff00cc', '#aabbcc', '#0000ff', '#00d8ff']);
  });
});

describe('child-segments.js: the data of a child segment', () => {
  it('the parents are the presets of segments.js', () => { expect(C.CHILD_PARENT_KEYS).toEqual(S.SEGMENT_PRESET_ORDER); });
  it('a child has key s<id>, a name (custom), its parent, mask, voxel count, colour, visible, default look', () => {
    const c = mk();
    expect(c).toMatchObject({ key: 's' + c.id, name: 'Femur', parentKey: 'bone', voxels: 4, color: '#ff00cc', visible: true, opacity: 1, material: 'standard', shade: null });
    expect(c.hash).toMatch(/^[0-9a-f]+$/);
    expect(C.childByKey(c.key)).toBe(c); expect(C.childrenOf('bone')).toEqual([c]); expect(C.childKeysOf('contrast')).toEqual([]);
  });
  it('a child without voxels, without a valid parent or without runs is refused', () => {
    expect(mk({ runsBySlice: [null, []] })).toBeNull(); expect(mk({ parentKey: 'nope' })).toBeNull(); expect(mk({ runsBySlice: null })).toBeNull(); 
  });
  it('ids count up; remove drops one; the hash follows the runs', () => {
    const a = mk(), b = mk({ runsBySlice: runs(5, 1) });
    expect(b.id).toBe(a.id + 1); expect(a.hash).not.toBe(b.hash);
    expect(C.removeChildSegment(a.key)).toBe(a); expect(C.childByKey(a.key)).toBeNull(); expect(C.removeChildSegment('s999')).toBeNull();
  });
  it('the display name: the child\'s name, else the fallback (no atlas id, no "ID n")', () => {
    const a = mk({ name: 'Liver' }), b = mk({ name: '', atlasId: 2200 }), c = mk({ name: '' });
    expect([a, b, c].map(x => C.childDisplayName(x, 'Segment'))).toEqual(['Liver', 'Segment', 'Segment']);
    expect('atlasId' in b).toBe(false); // a child has no atlas id
  });
});

describe('a child segment can hang under ANY preset (nothing assumes bone)', () => {
  it.each(['bone', 'soft', 'fat', 'lung', 'contrast'])('parent %s: make, key, shown only with its parent, saved and loaded, its mask excluded from its own parent only', parent => {
    S.segmentState[parent].active = true;
    const c = mk({ parentKey: parent });
    expect(c).toMatchObject({ parentKey: parent }); expect(C.childrenOf(parent)).toEqual([c]); expect(C.childKeysOf(parent)).toEqual([c.key]);
    expect(S.segmentById(c.key)).toMatchObject({ parentKey: parent, enabled: false }); // the parent is not ticked
    S.segmentState[parent].enabled = true; expect(S.segmentById(c.key)).toMatchObject({ enabled: true });
    expect(S.shownSegmentKeys()).toEqual([parent, c.key]);
    const saved = C.childSegmentsForProject(); expect(saved[0].entry.parentKey).toBe(parent);
    const { made } = C.restoreChildSegments(saved.map(o => C.childSrcFromEntry(JSON.parse(JSON.stringify(o.entry)), o.runsBySlice))); expect(made[0].parentKey).toBe(parent);
    S.segmentState[parent].active = false; S.segmentState[parent].enabled = false;
  });
  it('children of two different parents stay apart (each parent excludes only its own children)', () => {
    const a = mk({ parentKey: 'fat' }), b = mk({ parentKey: 'lung' });
    expect([C.childKeysOf('fat'), C.childKeysOf('lung'), C.childKeysOf('soft')]).toEqual([[a.key], [b.key], []]);
    expect(S.segmentSourcesOf('fat')).toContain(a.key); expect(S.segmentSourcesOf('fat')).not.toContain(b.key); expect(S.segmentSourcesOf('lung')).toEqual([b.key]); expect(S.segmentSourcesOf('soft')).toEqual([]);
    expect(S.segmentHasProcessedMask('lung')).toBe(true); expect(S.segmentHasProcessedMask('soft')).toBe(false);
  });
});

describe('project file: project.treeSegments (the only source of child segments)', () => {
  it('save: one entry per child with name, parentKey, colour, visible, opacity, material, shade {min, max} | null, atlasId; the run mask is kept for the loader', () => {
    const a = mk({ opacity: 0.4, material: 'plaster', shade: { lower: 5, upper: 50 }, visible: false }), b = mk({ name: '', color: '#112233', parentKey: 'contrast' });
    const out = C.childSegmentsForProject();
    expect(out.map(o => o.entry)).toEqual([
      { parentKey: 'bone', color: '#ff00cc', visible: false, opacity: 0.4, material: 'plaster', shade: { min: 5, max: 50 }, name: 'Femur' },
      { parentKey: 'contrast', color: '#112233', visible: true, opacity: 1, material: 'standard', shade: null },
    ]);
    expect(out[0].runsBySlice).toBe(a.runsBySlice); expect(out[1].runsBySlice).toBe(b.runsBySlice);
  });
  it('save -> load round-trips every field', () => {
    mk({ opacity: 0.4, material: 'plastic', shade: { lower: 5, upper: 50 }, visible: false }); mk({ name: 'Tibia', color: '#112233', parentKey: 'contrast', opacity: 0.9 });
    const saved = C.childSegmentsForProject(), json = JSON.parse(JSON.stringify(saved.map(o => o.entry)));
    const before = ST.childSegments.map(c => ({ name: c.name, parentKey: c.parentKey, color: c.color, visible: c.visible, opacity: c.opacity, material: c.material, shade: c.shade, voxels: c.voxels }));
    const { made } = C.restoreChildSegments(json.map((e, i) => C.childSrcFromEntry(e, saved[i].runsBySlice)));
    expect(made.map(c => ({ name: c.name, parentKey: c.parentKey, color: c.color, visible: c.visible, opacity: c.opacity, material: c.material, shade: c.shade, voxels: c.voxels }))).toEqual(before);
    expect(ST.childSegments.map(c => c.key)).toEqual(['s1', 's2']); // the list was replaced, ids restart
  });
  it('an old project without treeSegments and without atlas entries leaves no child', () => {
    mk(); C.restoreChildSegments([]); expect(ST.childSegments.length).toBe(0);
  });
  it('PROJECT_VERSION stays 1; data-load writes / reads the field', () => {
    expect(src('project-file.js')).toContain('export const PROJECT_VERSION=1;');
    const d = src('data-load.js'); expect(d).toContain('project.treeSegments=kids.map'); expect(d).toContain('project.treeSegments||[]'); expect(d).not.toContain('splitAtlasEntries'); expect(d).toContain('for(const e of project.analysis?.regions||[]){');
  });
});

describe('segments.js: segmentById / allSegmentKeys (one interface for the presets and the child segments; never the regions)', () => {
  it('a preset and a child have the same shape', () => {
    S.segmentState.bone.active = true; S.segmentState.bone.enabled = true;
    const c = mk(), p = S.segmentById('bone'), g = S.segmentById(c.key);
    expect(Object.keys(p).sort()).toEqual(['color', 'enabled', 'key', 'kind', 'material', 'max', 'min', 'name', 'opacity', 'parentKey', 'runs', 'shade', 'visible']);
    expect(Object.keys(g).sort()).toEqual(Object.keys(p).sort());
    expect(g).toMatchObject({ key: c.key, kind: 'child', name: 'Femur', color: '#ff00cc', opacity: 1, visible: true, enabled: true, material: 'standard', shade: null, parentKey: 'bone' });
    expect(g.runs).toBe(c.runsBySlice); expect(g.min).toBe(S.segmentState.bone.min);
  });
  it('enabled = visible AND the parent shown; hidden = not enabled', () => {
    S.segmentState.bone.active = true; S.segmentState.bone.enabled = true;
    const a = mk(), b = mk({ visible: false });
    expect(S.segmentById(a.key)).toMatchObject({ visible: true, enabled: true }); expect(S.segmentById(b.key)).toMatchObject({ visible: false, enabled: false });
    S.segmentState.bone.enabled = false; expect(S.segmentById(a.key)).toMatchObject({ visible: true, enabled: false });
  });
  it('unknown keys give null; an analysis region key is not a segment', () => {
    ST.setAnalysisRegions([{ id: 3, regionId: 'r3', segmentKeys: ['bone'], runsBySlice: [], visible: true }]);
    expect([S.segmentById('s9'), S.segmentById('r3'), S.segmentById('nope'), S.segmentById(undefined)]).toEqual([null, null, null, null]);
  });
  it('allSegmentKeys = the active presets, then the child segments (list order), never regions', () => {
    expect(S.allSegmentKeys()).toEqual([]);
    S.segmentState.bone.active = true; S.segmentState.contrast.active = true;
    const a = mk(), b = mk({ parentKey: 'contrast' });
    ST.setAnalysisRegions([{ id: 1, regionId: 'r1', segmentKeys: ['bone'], runsBySlice: [], visible: true }]);
    expect(S.allSegmentKeys()).toEqual(['bone', 'contrast', a.key, b.key]);
    expect(S.shownSegmentKeys()).toEqual([]);
    S.segmentState.bone.enabled = true; expect(S.shownSegmentKeys()).toEqual(['bone', a.key]);
  });
  it('setChildLook: opacity / material / shade / visible are normalised, a change is announced once with the fields that changed, a no-op is not', () => {
    const c = mk(); const seen = []; const off = S.onChildSegLookChange((x, ch) => seen.push([x.key, ch]));
    expect(S.setChildLook(c.key, { opacity: 0.25 })).toBe(true); expect(S.setChildLook(c.key, { opacity: 0.25 })).toBe(false);
    expect(S.setChildLook(c.key, { material: 'solid', shade: { lower: 3, upper: 1 } })).toBe(true);
    expect(S.setChildLook(c.key, { material: 'bogus', visible: false })).toBe(true);
    expect(S.setChildLook('s99', { opacity: 0 })).toBe(false); off();
    expect(seen).toEqual([[c.key, ['opacity']], [c.key, ['material', 'shade']], [c.key, ['material', 'visible']]]);
    expect(childSegLookOf(c)).toEqual({ opacity: 0.25, material: 'standard', shade: { lower: 1, upper: 3 } }); expect(c.visible).toBe(false);
  });
});

describe('the cut-face shading range of a child (the same functions as the presets)', () => {
  it('before the auto value is ready: the parent\'s min / max cut to the data; a manual end keeps both ends; reset goes back to auto; the presets\' map is untouched', () => {
    S.segmentState.bone.active = true; S.segmentState.bone.min = 100; S.segmentState.bone.max = 5000;
    const c = mk(), k = c.key;
    expect(S.segmentShadeRange(k, DATA)).toEqual({ lower: 100, upper: 3000, touched: false });
    const seen = []; const off = S.onChildSegLookChange((x, ch) => seen.push(ch.join()));
    expect(S.setSegmentShadeEnd(k, 'lower', 400, DATA)).toEqual({ lower: 400, upper: 3000, touched: true });
    expect(c.shade).toEqual({ lower: 400, upper: 3000 }); expect(S.segmentShadeRanges[k]).toBeUndefined();
    S.setSegmentShadeEnd(k, 'upper', 200, DATA); expect(S.segmentShadeRange(k, DATA)).toMatchObject({ lower: 400, upper: 400 });
    S.resetSegmentShadeRange(k); expect(S.segmentShadeRange(k, DATA).touched).toBe(false); expect(c.shade).toBeNull();
    off(); expect(seen).toEqual(['shade', 'shade', 'shade']);
  });
  it('the auto range comes from the child\'s own runs (binShadeRuns -> autoShadeRange), per child', () => {
    S.segmentState.bone.active = true;
    const a = mk({ runsBySlice: [[0, 0, 31]] }), b = mk({ runsBySlice: [[0, 32, 63]] });
    const w = 64, values = Float64Array.from({ length: w }, (_, i) => -1000 + i * 60);
    const hist = r => binShadeRuns(createShadeHist(), values, r, w, DATA.min, DATA.max);
    const h1 = hist(a.runsBySlice[0]), h2 = hist(b.runsBySlice[0]);
    S.applyShadeAutoHistograms({ [a.key]: h1, [b.key]: h2, contrast: null }, DATA);
    const ra = S.segmentShadeRange(a.key, DATA), rb = S.segmentShadeRange(b.key, DATA);
    expect(ra.touched).toBe(false); expect(ra.upper).toBeLessThan(rb.lower + 1); expect(ra.lower).toBeLessThan(ra.upper);
    expect(ra.lower).toBe(Math.min(autoShadeRange(h1, DATA).lower, autoShadeRange(h1, DATA).upper));
    expect(S.segmentShadeSpan(a.key, DATA).max).toBeLessThan(S.segmentShadeSpan(b.key, DATA).max);
    S.setSegmentShadeEnd(a.key, 'lower', 0, DATA); S.applyShadeAutoHistograms({ [a.key]: null }, DATA); expect(S.segmentShadeRange(a.key, DATA).touched).toBe(true);
    expect(S.segmentShadeRange(b.key, DATA).touched).toBe(false);
  });
  it('an auto range of a child that is gone is ignored; the auto value is announced', () => {
    expect(S.setSegmentShadeAuto('s404', { lower: 1, upper: 2, span: { min: 0, max: 3 } })).toBe(false);
    const c = mk(), seen = []; const off = S.onShadeAutoChange(k => seen.push(k));
    S.setSegmentShadeAuto(c.key, { lower: 1, upper: 2, span: { min: 0, max: 3 } }); S.setSegmentShadeAuto(c.key, { lower: 1, upper: 2, span: { min: 0, max: 3 } }); off();
    expect(seen).toEqual([c.key]);
  });
});

describe('the render hand-off: childRenderEntries() and the change event', () => {
  it('no child: an empty list', () => { expect(S.childRenderEntries()).toEqual([]); });
  it('one entry per child with key, runs, colour, opacity, material, shade, shadeRange, visible (drawn now), shown, parentKey, parentSlot', () => {
    S.segmentState.bone.active = true; S.segmentState.bone.enabled = true; S.segmentState.contrast.active = true; S.segmentState.contrast.enabled = false;
    const a = mk({ opacity: 0.4, material: 'plaster', shade: { lower: 5, upper: 50 }, color: '#112233' }), b = mk({ parentKey: 'contrast', visible: false });
    const e = S.childRenderEntries();
    expect(e.map(x => Object.keys(x).sort())).toEqual(Array(2).fill(['color', 'hash', 'key', 'material', 'opacity', 'parentKey', 'parentSlot', 'runs', 'shade', 'shadeRange', 'shown', 'visible', 'voxels']));
    expect(e[0]).toMatchObject({ key: a.key, runs: a.runsBySlice, color: '#112233', opacity: 0.4, material: 'plaster', shade: { lower: 5, upper: 50 }, shadeRange: { lower: 5, upper: 50 }, visible: true, shown: true, parentKey: 'bone', parentSlot: S.gpuSegmentOrder().indexOf('bone'), hash: a.hash, voxels: 4 });
    expect(e[1]).toMatchObject({ key: b.key, visible: false, shown: false, parentKey: 'contrast' });
    S.segmentState.bone.enabled = false; expect(S.childRenderEntries()[0]).toMatchObject({ visible: false, shown: true }); // a child shown with a hidden parent is not drawn
  });
  it('the change event: a look change and a list change reach onChildRenderChange', () => {
    const c = mk(), seen = []; const off = S.onChildRenderChange(ev => seen.push(ev));
    S.setChildLook(c.key, { opacity: 0.3 }); C.emitChildSegChange('list'); off();
    expect(seen).toEqual([{ kind: 'look', key: c.key, changed: ['opacity'] }, { kind: 'list', key: null, changed: [] }]);
  });
});

describe('separation: the analysis regions are never touched by a child segment', () => {
  const regionList = () => [
    { id: 1, regionId: 'r1', key: 'contrast', segmentKeys: ['contrast'], color: 0xff00cc, visible: true, selected: false, merged: false, name: 'Left kidney', runsBySlice: [[1, 2, 3]], voxels: 2 },
    { id: 2, regionId: 'r2', key: 'bone', segmentKeys: ['bone'], color: 0x00b4ff, visible: false, selected: true, merged: false, atlasId: 2200, runsBySlice: [[0, 0, 5]], voxels: 6 },
  ];
  it('analysisRegions is byte-identical before / after add, look change, hide, shade, auto range, project save / load, delete, clear of child segments (same parents as the regions\')', () => {
    const regs = regionList(); ST.setAnalysisRegions(regs);
    const before = JSON.stringify(ST.analysisRegions); S.segmentState.bone.active = true; S.segmentState.contrast.active = true;
    const a = mk({ parentKey: 'bone', name: 'Femur' }), b = mk({ parentKey: 'contrast', name: 'Kidney' });
    S.setChildLook(a.key, { opacity: 0.2, material: 'solid', shade: { lower: 1, upper: 9 }, visible: false, color: '#010203', name: 'F2' }); S.setChildLook(b.key, { visible: true });
    S.setSegmentShadeEnd(a.key, 'lower', 3, DATA); S.resetSegmentShadeRange(a.key); S.applyShadeAutoHistograms({ [a.key]: null }, DATA);
    S.segmentById(a.key); S.allSegmentKeys(); S.shownSegmentKeys(); S.childRenderEntries();
    const saved = C.childSegmentsForProject(); C.restoreChildSegments(saved.map(o => C.childSrcFromEntry(JSON.parse(JSON.stringify(o.entry)), o.runsBySlice)));
    C.removeChildSegment(ST.childSegments[0].key); C.clearChildSegments();
    expect(JSON.stringify(ST.analysisRegions)).toBe(before);
    expect(ST.analysisRegions).toBe(regs); // not even replaced
    expect(S.allSegmentKeys().some(k => /^r\d/.test(k))).toBe(false);
  });
  it('the project\'s region entries (analysis-ops.js analysisRegionsForProject) do not know the child segments, and no frozen file mentions them', () => {
    const a = src('analysis-ops.js'); expect(a).not.toMatch(/childSeg|childSegments|isChildKey|childByKey|childRender|child-segments/);
    for (const f of ['region-visibility.js', 'region-name.js', 'segment-tree.js']) expect(src(f)).not.toMatch(/childSeg|childSegments|isChildKey/);
    expect(src('analysis-results.js')).not.toMatch(/childSeg/);
  });
  it('the child code does not reuse the region helpers (own names, own name rule)', () => {
    for (const f of ['child-segments.js', 'segment-look.js', 'segment-tree-ui.js', 'child-segments-ui.js']) expect(src(f)).not.toMatch(/from '\.\/region-name\.js|from '\.\/region-visibility\.js|regionDisplayName|regionChipTitle|setRegionVisible/);
  });
});

describe('a child is made ONLY by the user (「子セグメントを追加」): a copy of the selected regions\' mask; nothing converts regions, atlas entries or presets', () => {
  const reg = (id, runsBySlice, extra = {}) => ({ id, regionId: 'r' + id, key: 'bone', segmentKeys: ['bone'], color: 0xff00cc, visible: true, selected: true, runsBySlice, voxels: 4, ...extra });
  it('one selected region: the child is a COPY of its mask under the given parent; the region is unchanged and stays in the list', () => {
    const r = reg(1, [new Uint32Array([1, 2, 4]), null, new Uint32Array([0, 0, 1])], { name: 'Left tibia', atlasId: 2200 }), regs = [r]; ST.setAnalysisRegions(regs);
    const before = JSON.stringify(ST.analysisRegions.map(x => ({ ...x, runsBySlice: x.runsBySlice.map(a => (a ? Array.from(a) : a)) })));
    const c = C.addChildSegmentFromRegions('fat', [r], 3);
    expect(c).toMatchObject({ parentKey: 'fat', name: '', voxels: 5, visible: true, opacity: 1, material: 'standard', shade: null }); expect('atlasId' in c).toBe(false);
    expect(c.runsBySlice[0]).not.toBe(r.runsBySlice[0]); expect(Array.from(c.runsBySlice[0])).toEqual([1, 2, 4]); // a copy
    expect(JSON.stringify(ST.analysisRegions.map(x => ({ ...x, runsBySlice: x.runsBySlice.map(a => (a ? Array.from(a) : a)) })))).toBe(before);
    expect(ST.analysisRegions).toBe(regs); expect(ST.childSegments).toEqual([c]);
  });
  it('several selected regions: the union of their masks; no region or no voxel: no child', () => {
    const a = reg(1, [new Uint32Array([0, 0, 2])]), b = reg(2, [new Uint32Array([0, 2, 5])]);
    const c = C.addChildSegmentFromRegions('bone', [a, b], 1);
    expect(c.voxels).toBe(6); expect(Array.from(c.runsBySlice[0])).toEqual([0, 0, 5]);
    expect(C.addChildSegmentFromRegions('bone', [], 1)).toBeNull(); expect(C.addChildSegmentFromRegions('bone', [reg(3, [null])], 1)).toBeNull(); expect(C.addChildSegmentFromRegions('nope', [a], 1)).toBeNull();
  });
  it('the child colours come from its own palette (the analysis regions\' colour counter is not used)', () => {
    const a = reg(1, [new Uint32Array([0, 0, 1])]); const c1 = C.addChildSegmentFromRegions('bone', [a], 1), c2 = C.addChildSegmentFromRegions('bone', [a], 1);
    expect([c1.color, c2.color]).toEqual([C.CHILD_SEG_COLORS[0], C.CHILD_SEG_COLORS[1]]);
    expect(src('child-segments.js')).not.toMatch(/nextAnalysisColor|incNextAnalysisColorIndex/);
  });
  it('NOTHING makes a child by itself: no atlas / region / preset conversion exists, atlasId regions stay regions, a load only reads project.treeSegments', () => {
    for (const f of ['child-segments.js', 'child-segments-ui.js', 'data-load.js', 'segments.js', 'segment-ui.js']) expect(src(f)).not.toMatch(/splitAtlasEntries|childSrcFromAtlasEntry|isAtlasEntry|parentKeyOfEntry/);
    expect(src('child-segments.js')).not.toMatch(/atlasId|atlas/i);
    expect(src('data-load.js')).not.toMatch(/addChildSegmentFromRegions|addChildSegment\(/);
    // the only callers of the add function: the button's handler (child-segments-ui.js addChildSegmentFromSelectedRegions, called from segment-ui.js on a click)
    expect(src('segment-ui.js')).toContain('btn.onclick=()=>{void addChildSegmentFromSelectedRegions(key)}');
    ST.setAnalysisRegions([reg(1, [new Uint32Array([0, 0, 1])], { atlasId: 2200 })]); expect(ST.childSegments.length).toBe(0); // a region with an atlasId is a region
    expect(S.allSegmentKeys()).toEqual([]);
  });
});

describe('the GPU volume gets the children from the hand-off; the parent is built without them in EVERY view (the volume\'s edit descriptors put them back)', () => {
  it('the parent excludes its children in the mesh view and in the volume view alike (2D, histogram, measurement, STL see it so); the volume gets them back in its descriptors only', () => {
    S.segmentState.bone.active = true; const c = mk();
    for (const mode of ['surface', 'volume']) { ST.setThreeRenderMode(mode); expect(S.segmentSourcesOf('bone')).toContain(c.key); expect(S.segmentHasProcessedMask('bone')).toBe(true); }
    const sigVolume = S.segmentSourceSignature('bone'); ST.setThreeRenderMode('surface'); expect(S.segmentSourceSignature('bone')).toBe(sigVolume); // no view in the key any more
    expect(src('segments.js')).not.toMatch(/function segmentSourcesOf[^\n]*threeRenderMode/);
    const g = src('gpu-volume-data.js');
    expect(g).toContain('function withChildRuns(descs,v)'); expect(g).toContain("d.mode==='keep'?unionRunArrays(d.runs,kr,v.slices):subtractRunArrays(d.runs,kr,v.slices)"); expect(g).toContain('withChildRuns(gpuVolumeEditDescriptors(v),v)');
    expect(g).toContain('if(!childSegments.length)return descs;'); // no child: the descriptors as they were
  });
  it('a child is made only from the voxels that are the parent\'s (the selected regions cut to the parent\'s final runs), at most 255 of them', () => {
    const d = 3, run = (y, x0, x1) => [y, x0, x1], slices = a => Array.from({ length: d }, (_, z) => a[z] || []);
    const region = { runsBySlice: slices({ 0: [...run(1, 0, 5)], 1: [...run(1, 0, 5)] }) }, parent = slices({ 0: [...run(1, 2, 7)], 1: [] });
    const c = C.addChildSegmentFromRegions('bone', [region], d, parent);
    expect(c.voxels).toBe(4); expect([...c.runsBySlice[0]]).toEqual([1, 2, 5]); expect([...(c.runsBySlice[1] || [])]).toEqual([]);
    expect(C.addChildSegmentFromRegions('bone', [region], d, slices({}))).toBeNull(); // none of it is the parent's: no child
    expect(C.CHILD_SEG_MAX).toBe(255);
    ST.setChildSegments([]); for (let i = 0; i < 255; i++) ST.childSegments.push({ id: 1000 + i, key: 's' + (1000 + i), parentKey: 'bone' });
    expect(C.addChildSegmentFromRegions('bone', [region], d)).toBeNull(); // the 256th is refused
    ST.setChildSegments([]);
  });
  it('syncChildSegmentsToVolume hands childRenderEntries() to mv.setChildSegments(entries, v, signature) once per change, from the frame loop', () => {
    const u = src('child-segments-ui.js'), a = src('app.js');
    expect(u).toContain('export function syncChildSegmentsToVolume()'); expect(u).toContain('mv.setChildSegments(entries, v, sig)'); expect(u).toContain('childRenderEntries()');
    expect(u).toContain('e.hash, e.color, e.opacity, e.material'); expect(u).toContain('e.parentSlot'); expect(u).toContain('gpuSegmentSignature()');
    expect(a).toContain('syncVolumeAnalysisOverlay();syncChildSegmentsToVolume();');
    expect(src('section-shade.js')).toContain('for (const key of childSegments.length ? allSegmentKeys() : SEGMENT_PRESET_ORDER)'); // section.shade.ranges[child key]
  });
});

describe('an analysis region over a child\'s voxels is drawn on top (a child never erases a region\'s colour)', () => {
  it('2D painters and the cut face look up the region at the child\'s parent key and take its colour; the cap does not shade it as the child\'s', () => {
    const r = src('mpr-render.js');
    expect(r).toContain('const rr=layers.length?resultRgbAt(layers,L.parentKey,i,ix,iy,iz):null;c=rr||L.rgb;isSeg=rr?0:capIndex.get(L.key)||0');
    expect((r.match(/resultRgbAt\(layers,L\.parentKey/g) || []).length).toBe(3);
    expect(src('mpr3d-overlay.js')).toContain('isChildKey(k)?segmentById(k)?.opacity:1'); expect(src('mpr3d-overlay.js')).not.toContain('/^s\\d+$/');
  });
});
