import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';

// Child segments on the PC (the tree's child segment is an independent segment, not an analysis):
//  1. colour OFF (c.colorOff, saved as treeSegments[i].colorOff): only the colour goes - the shape stays, the voxels are drawn in the PARENT's colour and material; show / hide is a separate switch that stays
//  2. a row of the child tree focuses the child (the 2D slices move into it, its frame is drawn) and shows its volume in mm3
//  3. a click on a child in a 2D view chooses the child (no new analysis region on it); on an analysis region / elsewhere the click is as before
//  4. the 2D focus frame is drawn for a child too
// A DOM-less Node test (not a device test): the views' pure functions are run, the page's wiring is checked through the source.
installDomStub();
const src = n => readFileSync('docs/' + n, 'utf8');
let S, ST, C, MR, UI;
beforeAll(async () => { S = await importApp('segments'); ST = await importApp('state'); C = await importApp('child-segments'); MR = await importApp('mpr-render'); UI = await importApp('child-segments-ui'); });
afterEach(() => {
  C.clearChildSegments(); ST.setAnalysisRegions([]); ST.setAnalysisFocusedRegionId(null); ST.setVolume(null); ST.setVolumeAnalysisMode(false);
  for (const k of S.SEGMENT_PRESET_ORDER) { S.segmentState[k].active = false; S.segmentState[k].enabled = false; }
  S.segmentState.bone.color = '#f3f0e8'; S.segmentState.bone.material = 'standard';
});
const D = 6;
const run1 = (y = 1, x0 = 1, x1 = 2, z = 1) => { const r = Array.from({ length: D }, () => null); r[z] = [y, x0, x1]; return r; }; // 2 voxels
const vol = () => ({ columns: D, rows: D, slices: D, spacing: [0.5, 0.5, 2], min: -1000, max: 1000, data: new Int16Array(D * D * D) });
const mk = (extra = {}) => C.addChildSegment({ name: 'Femur', parentKey: 'bone', runsBySlice: run1(), color: '#ff0000', ...extra });
const showBone = () => { const b = S.segmentState.bone; b.active = true; b.enabled = true; };

describe('colour off: the child stops standing out, the shape stays', () => {
  it('a new child has its colour on; the data holds colorOff as a boolean', () => {
    const c = mk(); expect(c.colorOff).toBe(false); expect(mk({ colorOff: true }).colorOff).toBe(true); expect(mk({ colorOff: 'yes' }).colorOff).toBe(false);
  });
  it('turning it off: the voxels are drawn in the parent colour; turning it on brings the own colour back (the material is always the parent\'s: a child inherits)', () => {
    showBone(); S.segmentState.bone.color = '#abcdef'; S.segmentState.bone.material = 'skin';
    const c = mk();
    expect(S.childRenderEntries()[0]).toMatchObject({ color: '#ff0000', material: 'skin', colorOff: false });
    expect(S.setChildLook(c.key, { colorOff: true })).toBe(true);
    expect(S.childRenderEntries()[0]).toMatchObject({ color: '#abcdef', material: 'skin', colorOff: true });
    expect(S.childDrawLook(c.key)).toEqual({ color: '#abcdef', material: 'skin' });
    expect(S.setChildLook(c.key, { colorOff: true })).toBe(false); // no change, no event
    expect(S.setChildLook(c.key, { colorOff: false })).toBe(true);
    expect(S.childRenderEntries()[0]).toMatchObject({ color: '#ff0000', material: 'skin', colorOff: false });
  });
  it('the child follows its parent when the parent colour / material changes; the child own colour is kept (swatch, picker)', () => {
    showBone(); const c = mk(); S.setChildLook(c.key, { colorOff: true });
    S.segmentState.bone.color = '#102030'; S.segmentState.bone.material = 'solid';
    expect(S.childRenderEntries()[0]).toMatchObject({ color: '#102030', material: 'solid' });
    expect(c.color).toBe('#ff0000'); expect(S.segmentById(c.key).color).toBe('#ff0000');
  });
  it('the change event says colorOff (the mesh / 2D / tree follow); the opacity stays the parent\'s (a child inherits)', () => {
    showBone(); S.segmentState.bone.opacity = 0.4; const c = mk(); const seen = []; const off = S.onChildSegLookChange((x, ch) => seen.push([x.key, ch.slice()]));
    S.setChildLook(c.key, { colorOff: true }); off();
    expect(seen).toEqual([[c.key, ['colorOff']]]);
    expect(S.childRenderEntries()[0].opacity).toBe(0.4);
  });
  it('show / hide is another switch: colour off does not hide the child, hiding does not touch colour off', () => {
    showBone(); const c = mk(); S.setChildLook(c.key, { colorOff: true });
    expect(S.segmentById(c.key).enabled).toBe(true); expect(S.childRenderEntries()[0].visible).toBe(true);
    S.setChildLook(c.key, { visible: false });
    expect(S.childRenderEntries()[0]).toMatchObject({ visible: false, shown: false, colorOff: true });
    S.setChildLook(c.key, { visible: true, colorOff: false });
    expect(S.childRenderEntries()[0]).toMatchObject({ visible: true, colorOff: false });
  });
  it('save / load keeps it; a file without colorOff loads as colour on', () => {
    const a = mk({ colorOff: true }), b = mk({ name: 'B', colorOff: false });
    const entries = JSON.parse(JSON.stringify(C.childSegmentsForProject().map(o => o.entry)));
    expect(entries.map(e => e.colorOff)).toEqual([true, false]);
    const srcs = entries.map((e, i) => C.childSrcFromEntry(e, [a, b][i].runsBySlice));
    const { made } = C.restoreChildSegments(srcs);
    expect(made.map(c => c.colorOff)).toEqual([true, false]);
    const old = { ...entries[0] }; delete old.colorOff;
    expect(C.restoreChildSegments([C.childSrcFromEntry(old, a.runsBySlice)]).made[0].colorOff).toBe(false);
  });
  it('the page: the row has the colour off / on button (separate from show / hide), the parent card tells its colour-off children, the mesh uses the parent look', () => {
    const ui = src('segment-ui.js');
    expect(ui).toContain("colorBtn.dataset.childColorOff=c.key"); expect(ui).toContain('setChildLook(c.key,{colorOff:!(c.colorOff===true)})'); expect(ui).toContain('vis.dataset.childVisible=c.key'); expect(ui).toContain('vis.onclick=()=>setChildLook(c.key,{visible:');
    const app = src('app.js'); expect(app).toContain('color.oninput=()=>{segmentState[key].color=color.value;syncColorOffChildren(key);'); expect(app).toContain("k==='colorOff'");
    const u = src('child-segments-ui.js'); expect(u).toContain('childDrawLook(c).material'); expect(u).toContain('childDrawLook(c).color');
    expect(src('surface-mesh.js')).toContain('color:childDrawLook(key).color');
    expect(src('mpr-render.js')).toContain('hexRgb(childDrawLook(c).color)');
  });
  it('the new wording is in both languages', () => {
    const i = src('i18n.js'); for (const k of ['childColorOff', 'childColorOn', 'childColorOffHint', 'childColorOnHint']) expect(i.match(new RegExp(k + ":'", 'g'))).toHaveLength(2);
  });
});

describe('the child row: focus and volume', () => {
  it('the volume is voxels x the voxel size (mm3); unknown spacing gives nothing', () => {
    const c = mk(); expect(c.voxels).toBe(2);
    expect(C.childVolumeMm3(c, [0.5, 0.5, 2])).toBeCloseTo(1, 10); expect(C.childVolumeMm3(c, null)).toBeNull(); expect(C.childVolumeMm3(c, [0, 1, 1])).toBeNull();
  });
  it('the place the focus moves to is a voxel of the child (middle slice, middle run)', () => {
    const r = Array.from({ length: D }, () => null); r[1] = [2, 0, 1]; r[2] = [3, 2, 4]; r[3] = [4, 4, 5];
    const c = mk({ runsBySlice: r }), v = C.childRepresentativeVoxel(c);
    expect(v).toEqual({ x: 3, y: 3, z: 2 }); expect(c.runsBySlice[v.z].slice(0, 3)).toEqual([v.y, 2, 4]);
    expect(C.childRepresentativeVoxel({ runsBySlice: Array(D).fill(null) })).toBeNull();
  });
  it('focusing a child sets the focus (one child), a second one moves it, deleting it drops it', () => {
    ST.setVolume(vol()); const a = mk(), b = mk({ runsBySlice: run1(2, 3, 4, 3) });
    expect(C.getFocusedChildKey()).toBeNull();
    expect(UI.focusChildSegment(a.key)).toBe(true); expect(C.getFocusedChildKey()).toBe(a.key);
    expect(UI.focusChildSegment(b.key, { x: 3, y: 2, z: 3 })).toBe(true); expect(C.getFocusedChildKey()).toBe(b.key);
    expect(UI.focusChildSegment('s999')).toBe(false); expect(C.getFocusedChildKey()).toBe(b.key);
    UI.deleteChildSegment(b.key); expect(C.getFocusedChildKey()).toBeNull();
  });
  it('focusing a child lets go of the focused analysis region (one focus at a time)', () => {
    ST.setVolume(vol()); const c = mk();
    ST.setAnalysisRegions([{ id: 7, segmentKeys: ['bone'], runsBySlice: run1(), visible: true, focused: true, voxels: 2, mm3: 1 }]); ST.setAnalysisFocusedRegionId(7);
    UI.focusChildSegment(c.key); expect(ST.analysisFocusedRegionId).toBeNull(); expect(C.getFocusedChildKey()).toBe(c.key);
  });
  it('the page: a click on the child row (not on its buttons / opened controls) focuses it; the row shows mm3; the analysis results panel has no child', () => {
    const ui = src('segment-ui.js');
    expect(ui).toContain("e.target.closest('button,input,select,label,.segment-tree-detail')"); expect(ui).toContain('focusChildSegment(c.key)'); expect(ui).toContain("' mm³'"); expect(ui).toContain("vol.dataset.childVolume=c.key");
    expect(src('analysis-results.js')).not.toMatch(/childSeg|childByKey|isChildKey|child-segments/);
    expect(src('analysis-ops.js')).not.toMatch(/childSeg|childSegments|isChildKey|childByKey|child-segments/);
    expect(src('app.js')).toContain('focusChildSegment(child.key,voxel)');
  });
});

describe('a click on a child in a 2D view chooses the child', () => {
  const vox = (x, y, z) => C.childAtVoxel(x, y, z, UI.childShownNow);
  it('on a shown child: the child; elsewhere: none (the click analyses as before)', () => {
    showBone(); const c = mk(); // voxels (1,1,1) (2,1,1)
    expect(vox(1, 1, 1)?.key).toBe(c.key); expect(vox(2, 1, 1)?.key).toBe(c.key); expect(vox(3, 1, 1)).toBeNull(); expect(vox(1, 1, 2)).toBeNull();
  });
  it('a hidden child, or a child of a hidden parent, is not chosen', () => {
    showBone(); const c = mk(); S.setChildLook(c.key, { visible: false }); expect(vox(1, 1, 1)).toBeNull();
    S.setChildLook(c.key, { visible: true }); expect(vox(1, 1, 1)?.key).toBe(c.key); S.segmentState.bone.enabled = false; expect(vox(1, 1, 1)).toBeNull();
  });
  it('colour off does not stop it: the child is still chosen', () => {
    showBone(); const c = mk({ colorOff: true }); expect(vox(1, 1, 1)?.key).toBe(c.key);
  });
  it('overlapping children: the focused one first, else the one drawn on top (the last)', () => {
    showBone(); const a = mk(), b = mk();
    expect(vox(1, 1, 1)?.key).toBe(b.key); C.setFocusedChildKey(a.key); expect(vox(1, 1, 1)?.key).toBe(a.key);
  });
  it('the page: an analysis region under the click is chosen first (as before), then the child, then the analysis of the voxel', () => {
    const a = src('app.js'), i = a.indexOf('function selectAnalysisRegionFromMpr'), body = a.slice(i, a.indexOf('\n}', i));
    const r = body.indexOf('if(region){'), c = body.indexOf('shownChildAtVoxel('), z = body.indexOf('void analyzeVolumeAtVoxel');
    expect(r).toBeGreaterThan(-1); expect(c).toBeGreaterThan(r); expect(z).toBeGreaterThan(c);
    expect(body).toMatch(/if\(child\)\{focusChildSegment\(child\.key,voxel\);return true\}/);
  });
});

describe('the 2D focus frame', () => {
  const ctxLog = () => { const rects = []; return { rects, save() {}, restore() {}, strokeRect: (...a) => rects.push(a), set fillStyle(v) {}, set strokeStyle(v) { this.color = v; }, set lineWidth(v) {} }; };
  it('a focused child gets its frame (in the child colour) in the 2D views, with no analysis region at all', () => {
    showBone(); ST.setVolume(vol()); ST.setVolumeAnalysisMode(true); const c = mk({ color: '#00ff00' });
    const none = ctxLog(); MR.drawAnalysisOverlay('axial', 1, none); expect(none.rects).toEqual([]); // not focused: no frame
    UI.focusChildSegment(c.key);
    const g = ctxLog(); MR.drawAnalysisOverlay('axial', 1, g); expect(g.rects).toEqual([[0.5, 0.5, 2, 1]]); expect(g.color).toBe('#00ff00');
    const off = ctxLog(); MR.drawAnalysisOverlay('axial', 3, off); expect(off.rects).toEqual([]); // another slice: the child is not there
    const cor = ctxLog(); MR.drawAnalysisOverlay('coronal', 1, cor); expect(cor.rects.length).toBe(1); // y = 1 cuts the child
  });
  it('colour off keeps the frame (it is the child own colour); a hidden child has none', () => {
    showBone(); ST.setVolume(vol()); ST.setVolumeAnalysisMode(true); const c = mk({ colorOff: true, color: '#00ff00' });
    UI.focusChildSegment(c.key);
    const g = ctxLog(); MR.drawAnalysisOverlay('axial', 1, g); expect(g.rects.length).toBe(1); expect(g.color).toBe('#00ff00');
    S.setChildLook(c.key, { visible: false }); const h = ctxLog(); MR.drawAnalysisOverlay('axial', 1, h); expect(h.rects).toEqual([]);
  });
  it('outside the analysis mode there is no frame; the analysis region frame is as before (focused one only)', () => {
    showBone(); ST.setVolume(vol()); const c = mk(); UI.focusChildSegment(c.key);
    const a = ctxLog(); MR.drawAnalysisOverlay('axial', 1, a); expect(a.rects).toEqual([]);
    ST.setVolumeAnalysisMode(true);
    ST.setAnalysisRegions([{ id: 1, segmentKeys: ['bone'], runsBySlice: run1(4, 0, 0, 1), visible: true, color: 0x00d8ff, voxels: 1, mm3: 1 }, { id: 2, segmentKeys: ['bone'], runsBySlice: run1(5, 0, 0, 1), visible: true, color: 0xff0000, voxels: 1, mm3: 1 }]);
    ST.setAnalysisFocusedRegionId(2);
    const r = ctxLog(); MR.drawAnalysisOverlay('axial', 1, r); expect(r.rects).toEqual([[-0.5, 4.5, 1, 1]]); // only the focused region (id 2): a focused region takes the frame, the child's is not drawn
  });
  it('without a child or a region (the usual data) nothing is drawn', () => {
    ST.setVolume(vol()); ST.setVolumeAnalysisMode(true); const a = ctxLog(); MR.drawAnalysisOverlay('axial', 1, a); expect(a.rects).toEqual([]);
  });
});
