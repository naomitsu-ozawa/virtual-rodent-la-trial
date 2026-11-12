import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { triggerMode, triggerModeRow, labelTargets } from '../../docs/event-mode.js';
import { setRegionLabel, setRegionLabelOffset, onAnalysisLabelsChange, labelForProject, hasOffset, leaderVisible } from '../../docs/analysis-label.js';
import { childVolumeMm3, childKeyAtHit, labelVolumeText } from '../../docs/child-labels.js';
import { regionChipTitle } from '../../docs/region-name.js';

// (child segment parity): the 3D name label of a child segment (PC + VR) is the analysis label kept on the child (c.label), saved in project.treeSegments, with the volume / name / hover / event-mode pieces
// the views need. A child is NOT an analysis region: nothing here makes one, and the regions' own labels behave exactly as before.
installDomStub();
let ST, C, L;
beforeAll(async () => { ST = await importApp('state'); C = await importApp('child-segments'); L = await importApp('child-labels'); });
afterEach(() => { C.clearChildSegments(); ST.setAnalysisRegions([]); ST.setVolume(null); });
const runs = (n = 1, z = 0) => { const r = Array.from({ length: 4 }, () => null); r[z] = [1, 2, 2 + n]; return r; }; // n+1 voxels
const mk = (extra = {}) => C.addChildSegment({ name: '', parentKey: 'bone', runsBySlice: runs(3), color: 0xff00cc, ...extra });
const tr = k => ({ childSegment: 'セグメント' }[k] || k);
const A = { anchor: { i: 3, j: 4, k: 1 } };

describe('child label item (the child, in the shape of a region)', () => {
  it('has a negative id (never an analysis region id), the child key, the colour as a number, its parent as the segment', () => {
    const c = mk({ color: '#10ff80' }), it = L.childLabelItem(c);
    expect(it.id).toBe(-c.id); expect(it.id).toBeLessThan(0); expect(it.key).toBe(c.key);
    expect(it.color).toBe(0x10ff80); expect(it.segmentKeys).toEqual(['bone']); expect(it.voxels).toBe(4); expect(it.runsBySlice).toBe(c.runsBySlice); expect(it.visible).toBe(true);
    expect(L.childLabelItem(c)).toBe(it); // the same object for the same child
    expect(L.isChildLabelId(it.id)).toBe(true); expect(L.isChildLabelId(3)).toBe(false);
    expect(L.childLabelItem(null)).toBeNull();
  });
  it('its volume is voxels x spacing in mm3; unknown spacing = NaN (no made-up number), the card then shows no volume', () => {
    const c = mk();
    expect(Number.isNaN(L.childLabelItem(c).mm3)).toBe(true);
    ST.setVolume({ spacing: [0.5, 0.5, 2], columns: 8, rows: 8, slices: 4 });
    expect(L.childLabelItem(c).mm3).toBeCloseTo(4 * 0.5 * 0.5 * 2, 9);
    expect(childVolumeMm3(10, [0.1, 0.1, 0.25])).toBeCloseTo(0.025, 9);
    for (const bad of [null, [], [1, 1], [0, 1, 1], [NaN, 1, 1]]) expect(Number.isNaN(childVolumeMm3(5, bad))).toBe(true);
    expect(labelVolumeText(2)).toBe('2.00 mm³'); expect(labelVolumeText(NaN)).toBe('');
  });
  it('the card title is the child name (else the default name "<セグメント> <id>"); a result keeps "<number>. <name>"', () => {
    const named = mk({ name: 'Femur' }), plain = mk();
    expect(L.labelChipTitle(L.childLabelItem(named), tr)).toBe('Femur');
    expect(L.labelChipTitle(L.childLabelItem(plain), tr)).toBe('セグメント ' + plain.id);
    const region = { id: 7, segmentKeys: ['bone'], name: 'Lesion' };
    expect(L.labelChipTitle(region, tr)).toBe(regionChipTitle(region, tr)); expect(L.labelChipTitle(region, tr)).toBe('7. Lesion');
  });
});

describe('pin / move / unpin: the analysis label code writes the label onto the child', () => {
  it('setRegionLabel on the item pins it on the CHILD (not the item), same ids as the views use', () => {
    const c = mk(), it = L.childLabelItem(c), seen = [];
    const off = onAnalysisLabelsChange(e => seen.push(e));
    expect(it.label).toBeUndefined();
    expect(setRegionLabel(it, A)).toBe(true);
    expect(c.label).toEqual(A); expect(it.label).toEqual(A); expect(Object.prototype.hasOwnProperty.call(it, 'label')).toBe(false);
    expect(seen).toEqual([{ id: it.id }]);
    expect(setRegionLabel(it, A)).toBe(true); expect(seen).toHaveLength(1); // unchanged: not a change
    expect(setRegionLabelOffset(it, { i: 5, j: 0, k: 0 })).toBe(true);
    expect(c.label).toEqual({ anchor: A.anchor, offset: { i: 5, j: 0, k: 0 } }); expect(hasOffset(c.label)).toBe(true); expect(leaderVisible(c.label)).toBe(true);
    expect(seen[1]).toEqual({ id: it.id, labelOnly: true, moveToggled: true });
    expect(setRegionLabelOffset(it, null)).toBe(true); expect(c.label).toEqual(A); // back to the default place
    expect(setRegionLabel(it, null)).toBe(true); expect(c.label).toBeUndefined(); expect('label' in c).toBe(false);
    expect(setRegionLabel(it, { anchor: { i: 'x' } })).toBe(false); expect(c.label).toBeUndefined(); // an invalid anchor pins nothing
    expect(setRegionLabelOffset(it, { i: 1, j: 1, k: 1 })).toBe(false); // nothing pinned: nothing to move
    off();
  });
  it('childLabelItems = only the children with a label (and a mask); childLabelItemById finds one by its negative id', () => {
    const a = mk(), b = mk(), c3 = mk();
    expect(L.childLabelItems()).toEqual([]); expect(L.hasChildLabels()).toBe(false);
    setRegionLabel(L.childLabelItem(b), A);
    expect(L.childLabelItems().map(x => x.key)).toEqual([b.key]); expect(L.hasChildLabels()).toBe(true);
    expect(L.childLabelItemById(-b.id)).toBe(L.childLabelItem(b));
    expect(L.childLabelItemById(-999)).toBeNull(); expect(L.childLabelItemById(b.id)).toBeNull(); // a positive id is a region's
    expect(a.label).toBeUndefined(); expect(c3.label).toBeUndefined();
  });
  it('an analysis region with the same number is untouched (its label is its own)', () => {
    const c = mk(), region = { id: c.id, label: { anchor: { i: 9, j: 9, k: 9 } } };
    setRegionLabel(L.childLabelItem(c), A);
    expect(region.label).toEqual({ anchor: { i: 9, j: 9, k: 9 } }); expect(c.label).toEqual(A);
    setRegionLabel(region, null); expect(region.label).toBeUndefined(); expect(c.label).toEqual(A); // the region's label removed: the child's stays
  });
  it('a child is never turned into an analysis region by pinning', () => {
    const c = mk(); setRegionLabel(L.childLabelItem(c), A);
    expect(ST.analysisRegions).toHaveLength(0);
  });
});

describe('save / load: project.treeSegments[i].label', () => {
  const roundTrip = () => { const saved = C.childSegmentsForProject(), json = JSON.parse(JSON.stringify(saved.map(o => o.entry))); C.restoreChildSegments(saved.map((o, i) => C.childSrcFromEntry(json[i], o.runsBySlice))); return json; };
  it('a pinned (and moved) label comes back; an unpinned child has no `label` in its entry', () => {
    const a = mk({ name: 'A' }), b = mk({ name: 'B' }), c = mk({ name: 'C' });
    setRegionLabel(L.childLabelItem(a), A);
    setRegionLabel(L.childLabelItem(b), { anchor: { i: 1, j: 2, k: 3 }, offset: { i: -4, j: 5, k: 0.25 } });
    const json = roundTrip();
    expect(json[0].label).toEqual(A); expect(json[1].label).toEqual({ anchor: { i: 1, j: 2, k: 3 }, offset: { i: -4, j: 5, k: 0.25 } }); expect('label' in json[2]).toBe(false);
    const back = ST.childSegments;
    expect(back.map(x => x.name)).toEqual(['A', 'B', 'C']);
    expect(back[0].label).toEqual(A); expect(back[1].label.offset).toEqual({ i: -4, j: 5, k: 0.25 }); expect(back[2].label).toBeUndefined();
    expect(labelForProject(back[1])).toEqual(back[1].label);
  });
  it('a project written before (no label) loads as not pinned; a corrupt label is dropped, the child stays', () => {
    const old = { parentKey: 'bone', color: '#ff00cc', visible: true, opacity: 1, material: 'standard', shade: null };
    const { made } = C.restoreChildSegments([C.childSrcFromEntry(old, runs(2)), C.childSrcFromEntry({ ...old, label: { anchor: { i: 'x', j: 1, k: 1 } } }, runs(2)), C.childSrcFromEntry({ ...old, label: 'abc' }, runs(2)), C.childSrcFromEntry({ ...old, label: { anchor: { i: 1e9, j: 0, k: 0 } } }, runs(2))]);
    expect(made).toHaveLength(4); for (const c of made) expect(c.label).toBeUndefined();
  });
  it('the analysis regions\' own labels still save with the regions (analysis-ops), the child entries carry theirs next to them', () => {
    const d = readFileSync('docs/data-load.js', 'utf8'), ops = readFileSync('docs/analysis-ops.js', 'utf8');
    expect(d).toContain('project.treeSegments=kids.map(({entry,runsBySlice},i)=>'); expect(d).toContain('childSrcFromEntry(e,decodeRuns(bytes,dims))'); // the entry (with label) is written as it is, and read back as it is
    expect(ops).toContain('label:labelForProject(r)');
  });
});

describe('VR: the child under the laser, and the event mode switch', () => {
  const ids = new Uint8Array(10); ids[3] = 2; ids[4] = 1;
  const list = [{ key: 's1', segMask: 1 }, { key: 's2', segMask: 2 }];
  it('the child index at the hit voxel gives the child (its key), only when it hangs under the hit segment\'s slot', () => {
    expect(childKeyAtHit(ids, list, 3, 1)).toBe('s2'); // slot 1 = the bit of s2's parent
    expect(childKeyAtHit(ids, list, 4, 0)).toBe('s1');
    expect(childKeyAtHit(ids, list, 3, 0)).toBe(''); // the laser hit another segment's voxel
    expect(childKeyAtHit(ids, list, 5, 0)).toBe(''); // no child there
    expect(childKeyAtHit(null, list, 3, 1)).toBe(''); expect(childKeyAtHit(ids, [], 3, 1)).toBe(''); expect(childKeyAtHit(ids, list, 3, -1)).toBe('');
  });
  it('体験会モード: data with only child segments (no analysis result) has the label switch; neither = point mode only', () => {
    expect(labelTargets(0, 0)).toBe(0); expect(labelTargets(2, 0)).toBe(2); expect(labelTargets(0, 3)).toBe(3);
    expect(triggerModeRow(labelTargets(0, 3))).toBe(true); expect(triggerMode(true, labelTargets(0, 3))).toBe('label'); expect(triggerMode(false, labelTargets(0, 3))).toBe('point');
    expect(triggerModeRow(labelTargets(0, 0))).toBe(false); expect(triggerMode(true, labelTargets(0, 0))).toBe('point');
    expect(triggerMode(true, labelTargets(1, 0))).toBe('label'); // unchanged for results
  });
  it('vr-view.js wiring: the hit carries childKey, the hover card and the pin use the child, the switch counts the children', () => {
    const v = readFileSync('docs/vr-view.js', 'utf8');
    expect(v).toContain('childKey=childKeyAtHit(ch.rg,childList,'); expect(v).toContain('return{distance:hi.t,key:gpuSegmentOrder()[si]||\'\',id,childKey,'); // an earlier change: the one RG index array (R at 2 k; a hidden child there: G at 2 k + 1)
    expect(v).toContain("kc=!r&&hit.childKey?childByKey(hit.childKey):null"); expect(v).toContain('childLabelTitle(kc,tr)');
    expect(v).toContain("triggerMode(evLabels,labelTargets(regionList.length,childList.length))==='label'"); expect(v).toContain('hasRes=labelTargets(regionList.length,childList.length)>0');
    expect(v).toContain('for(const reg of childLabelItems())'); expect(v).toContain('const regionByRid=rid=>rid<0?childLabelItemById(rid):');
    expect(v).toContain('labelToggle(hitLabelRids(hit,regionList),rid=>!!regionByRid(rid)?.label)'); // a tap pins the first card not pinned yet: result, then child (overlap)
    expect(v).not.toMatch(/\bimport\(\s*['"]\.\/child-labels/); // no dynamic import of the new module
  });
});

describe('PC 3D view and the tree row', () => {
  it('comment-3d.js draws the child labels with the results\' code (negative ids, the shown rule of the child, the chip title)', () => {
    const t = readFileSync('docs/comment-3d.js', 'utf8');
    expect(t).toContain('for(const it of childLabelItems())if(shownRegion(it))out.push(it)'); expect(t).toContain('r.child?!!segmentById(r.key)?.enabled:analysisRegionCounted(r)'); // an earlier change: was analysisRegionShown (the colour flag)
    expect(t).toContain('const regionOf=id=>childLabelItemById(id)||analysisRegions.find'); expect(t).toContain('labelChipTitle(r,tr)'); expect(t).toContain('onChildSegChange(again)');
  });
  it('the child\'s tree row has the pin / put-back buttons, app.js injects the pin (the analysis result\'s anchor rule)', () => {
    const u = readFileSync('docs/segment-tree-ui.js', 'utf8'), a = readFileSync('docs/app.js', 'utf8');
    expect(u).toContain('childLabelPin'); expect(u).toContain('setChildLabelPin');
    expect(a).toContain('setChildLabelPin(item=>toggleAnalysisLabel(item))');
  });
  it('the section view (断面解析) clips a child\'s surface built while it is open', () => {
    const s = readFileSync('docs/child-segments-ui.js', 'utf8');
    expect(s).toContain('sceneState.obj.add(group); applySectionClippingMaterials(group);');
  });
});
