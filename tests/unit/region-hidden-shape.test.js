import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import * as RV from '../../docs/region-visibility.js';
import * as TG from '../../docs/region-toggles.js';
import { buildSegmentTree } from '../../docs/segment-tree.js';

installDomStub();
const src = n => readFileSync('docs/' + n, 'utf8');
let S, ST, C, O, ER, I;
beforeAll(async () => { S = await importApp('segments'); ST = await importApp('state'); C = await importApp('child-segments'); O = await importApp('analysis-ops'); ER = await importApp('event-restore'); I = await importApp('i18n'); });
afterEach(() => {
  C.clearChildSegments(); ST.setAnalysisRegions([]); ST.setAnalysisFocusedRegionId(null); ST.setVolume(null);
  for (const k of S.SEGMENT_PRESET_ORDER) { S.segmentState[k].active = false; S.segmentState[k].enabled = false; }
});

describe('region.hidden (region-visibility.js): the shape flag, apart from the colour flag', () => {
  it('a region without the flag (a project saved before it) is not hidden', () => {
    expect(RV.regionHidden({ id: 1 })).toBe(false); expect(RV.regionHidden({ id: 1, hidden: false })).toBe(false); expect(RV.regionHidden(null)).toBe(false);
    expect(RV.regionHidden({ id: 1, hidden: true })).toBe(true);
    expect(RV.regionHidden({ id: 1, hidden: 'yes' })).toBe(false); // only a real true hides
  });
  it('setRegionHidden: true when it changed, a listener hears it, the colour flag is never touched', () => {
    const r = { id: 1, visible: true }, seen = [];
    const off = RV.onRegionHiddenChange((reg, h) => seen.push([reg.id, h]));
    expect(RV.setRegionHidden(r, true)).toBe(true); expect(r.hidden).toBe(true); expect(r.visible).toBe(true);
    expect(RV.setRegionHidden(r, true)).toBe(false); // already in that state
    expect(RV.setRegionHidden(r, false)).toBe(true); expect(r.hidden).toBe(false);
    expect(RV.setRegionHidden(null, true)).toBe(false);
    expect(seen).toEqual([[1, true], [1, false]]);
    off(); RV.setRegionHidden(r, true); expect(seen).toHaveLength(2);
  });
  it('the colour flag keeps its meaning and its own listeners (a hidden change is not a visible change)', () => {
    const r = { id: 2, visible: true }, vis = [];
    const off = RV.onRegionVisibleChange((reg, v) => vis.push(v));
    RV.setRegionHidden(r, true); expect(vis).toEqual([]);
    RV.setRegionVisible(r, false); expect(vis).toEqual([false]); expect(r.hidden).toBe(true); off();
  });
});

describe('save / load / copy / split / put back keep region.hidden', () => {
  const runs = [[1, 0, 4], [1, 0, 4]];
  const vol = { columns: 4, rows: 4, slices: 2, spacing: [1, 1, 1] };
  const entry = extra => ({ key: 'contrast', segmentKeys: ['contrast'], color: 0xff0000, visible: true, runsBySlice: runs, ...extra });
  it('written to analysis.regions[] and read back; an old entry (no flag) loads as not hidden; colour and shape stay apart', async () => {
    ST.setActiveSeries({ id: 's1', slices: [{}, {}], rows: 4, columns: 4 }); ST.setAnalysisRegions([]); ST.setSceneState({ medicalVolume: { active: true } }); ST.setThreeRenderMode('volume');
    await O.restoreAnalysisRegions([entry({ hidden: true }), entry({ visible: false }), entry({}), entry({ hidden: true, visible: false })], vol);
    const regs = ST.analysisRegions;
    expect(regs.map(r => [r.visible, r.hidden])).toEqual([[true, true], [false, false], [true, false], [false, true]]);
    const saved = JSON.parse(JSON.stringify(O.analysisRegionsForProject()));
    expect(saved.map(e => [e.visible, e.hidden])).toEqual([[true, true], [false, false], [true, false], [false, true]]);
    const snap = O.snapshotAnalysisRegionsForSegment('contrast');
    expect(snap.map(e => [e.visible, e.hidden])).toEqual([[true, true], [false, false], [true, false], [false, true]]);
    ST.setSceneState(null); ST.setThreeRenderMode('surface');
  });
  it('the places that copy or rebuild a region carry the flag (a split, a keep / delete rebuild, a project entry, the saved snapshot)', () => {
    const o = src('analysis-ops.js');
    for (const t of ['hidden:r.hidden===true,meshGroup:null,color:r.color', 'hidden:ref.hidden===true,meshGroup', 'hidden:e.hidden===true,meshGroup', 'hidden:primary.hidden===true,meshGroup', 'visible:r.visible!==false,hidden:r.hidden===true,selected', 'visible:r.visible,hidden:r.hidden===true,selected', 'existing.visible=true;existing.hidden=false;'])
      expect(o).toContain(t);
    expect(src('data-load.js')).toContain('visible:e.visible!==false,hidden:e.hidden===true,selected');
  });
  it('「最初の状態に戻す」 (restoreRegionState) puts the saved shape flag back; a file without it = shown', () => {
    const r = { id: 1, visible: true, hidden: true, color: 1 };
    ER.restoreRegionState(r, { visible: true, color: 1 }); expect(r.hidden).toBe(false);
    ER.restoreRegionState(r, { visible: false, hidden: true, color: 2 }); expect([r.visible, r.hidden, r.color]).toEqual([false, true, 2]);
  });
});

describe('what still counts for the label and the volume totals (the shape rule, not the colour flag)', () => {
  const tickBone = () => { const b = S.segmentState.bone; b.active = true; b.enabled = true; };
  it('a colour-off region counts; a hidden-shape region and a region of an unticked segment do not', () => {
    tickBone();
    const reg = x => ({ id: 1, segmentKeys: ['bone'], visible: true, ...x });
    expect(S.analysisRegionCounted(reg({}))).toBe(true);
    expect(S.analysisRegionCounted(reg({ visible: false }))).toBe(true); // colour off: label and totals stay
    expect(S.analysisRegionCounted(reg({ hidden: true }))).toBe(false);
    expect(S.analysisRegionCounted(reg({ hidden: true, visible: false }))).toBe(false);
    S.segmentState.bone.enabled = false; expect(S.analysisRegionCounted(reg({}))).toBe(false);
    expect(S.analysisRegionCounted(null)).toBe(false);
  });
  it('the colour rule (analysisRegionShown: what is DRAWN in colour) is left as it was', () => {
    tickBone();
    expect(S.analysisRegionShown({ id: 1, segmentKeys: ['bone'], visible: false })).toBe(false);
    expect(S.analysisRegionShown({ id: 1, segmentKeys: ['bone'], visible: true, hidden: true })).toBe(true); // stage 2 draws the hidden shape away; the colour rule does not know it
  });
  it('a child: colour off still counts (its label and volume stay), shape hidden does not', () => {
    tickBone();
    const c = C.addChildSegment({ name: 'Femur', parentKey: 'bone', runsBySlice: Array.from({ length: 6 }, (_, z) => (z === 1 ? [1, 1, 2] : null)), color: '#ff0000' });
    S.setChildLook(c.key, { colorOff: true }); expect(S.segmentById(c.key).enabled).toBe(true);
    S.setChildLook(c.key, { visible: false }); expect(S.segmentById(c.key).enabled).toBe(false);
  });
  it('the PC 3D labels use the shape rule (comment-3d.js), and the colour rule stays with the drawing', () => {
    expect(src('comment-3d.js')).toContain('r.child?!!segmentById(r.key)?.enabled:analysisRegionCounted(r)');
    expect(src('segments.js')).toContain('export function analysisRegionCounted(r){return !!r&&!regionHidden(r)&&analysisRegionSegmentsShown(r)}');
  });
});

describe('「隠れ N」 and 「すべて表示」: only the hidden shapes are counted and put back', () => {
  it('counts regions with hidden and children with visible:false; colour-off ones are not counted', () => {
    const mkc = () => C.addChildSegment({ name: 'k', parentKey: 'bone', runsBySlice: Array.from({ length: 6 }, (_, z) => (z === 1 ? [1, 1, 2] : null)), color: '#ff0000' });
    const a = mkc(), b = mkc(), d = mkc();
    const regions = [{ id: 1, visible: true, hidden: true, color: 1 }, { id: 2, visible: false, color: 2 }, { id: 3, visible: true, hidden: false, color: 3 }];
    expect(S.hiddenShapeCount(regions, C.childSegments ?? ST.childSegments)).toBe(1);
    S.setChildLook(a.key, { visible: false }); S.setChildLook(b.key, { colorOff: true });
    expect(S.hiddenShapeCount(regions, ST.childSegments)).toBe(2);
    expect(d.visible !== false).toBe(true);
  });
  it('showAllHiddenShapes puts back the shapes only: colours, the colour-off flags and everything else stay', () => {
    const mkc = () => C.addChildSegment({ name: 'k', parentKey: 'bone', runsBySlice: Array.from({ length: 6 }, (_, z) => (z === 1 ? [1, 1, 2] : null)), color: '#ff0000' });
    const a = mkc(), b = mkc(); S.setChildLook(a.key, { visible: false, colorOff: true }); S.setChildLook(b.key, { colorOff: true });
    const regions = [{ id: 1, visible: false, hidden: true, color: 7, label: { anchor: { i: 1, j: 1, k: 1 } } }, { id: 2, visible: false, color: 8 }];
    expect(S.showAllHiddenShapes(regions, ST.childSegments)).toBe(2);
    expect(regions.map(r => [r.visible, r.hidden === true, r.color])).toEqual([[false, false, 7], [false, false, 8]]);
    expect(regions[0].label).toEqual({ anchor: { i: 1, j: 1, k: 1 } });
    expect([a.visible, a.colorOff, b.visible, b.colorOff]).toEqual([true, true, true, true]);
    expect(S.hiddenShapeCount(regions, ST.childSegments)).toBe(0);
    expect(S.showAllHiddenShapes(regions, ST.childSegments)).toBe(0); // nothing hidden: nothing to do
  });
});

describe('the segment tree rows: the row is dimmed for the shape only', () => {
  it('rows carry visible (colour) and hidden (shape) apart', () => {
    const regs = [{ id: 1, segmentKeys: ['bone'], color: 1, visible: false }, { id: 2, segmentKeys: ['bone'], color: 2, visible: true, hidden: true }, { id: 3, segmentKeys: ['bone'], color: 3 }];
    const rows = buildSegmentTree(regs, { segmentKeys: ['bone'], nameOf: r => 'r' + r.id })[0].rows;
    expect(rows.map(r => [r.visible, r.hidden])).toEqual([[false, false], [true, true], [true, false]]);
    const ui = src('segment-ui.js');
    expect(ui).toContain("(r.hidden?' is-off':'')"); // a region row
    expect(ui).toContain("(r.visible?'':' is-off')"); // a child row: r.visible there is the child's shape flag (visible)
  });
});

describe('the two toggles 色 / 表示: fixed wording, the state is aria-pressed', () => {
  it('the labels are the same in every state', () => {
    const labels = st => TG.showToggleSpec(st).map(s => s.labelKey);
    const all = [[true, true], [true, false], [false, true], [false, false]].map(([c, s]) => labels({ colorOn: c, shapeOn: s, canToggle: true }));
    for (const l of all) expect(l).toEqual(['regionColorToggle', 'regionShapeToggle']);
    expect(labels({ colorOn: false, shapeOn: false, canToggle: false })).toEqual(['regionColorToggle', 'regionShapeToggle']);
  });
  it('pressed = colour on / shape shown; both rest while the parent tissue is off', () => {
    expect(TG.showToggleSpec({ colorOn: true, shapeOn: false }).map(s => [s.id, s.pressed, s.disabled])).toEqual([['color', true, false], ['shape', false, false]]);
    expect(TG.showToggleSpec({ colorOn: false, shapeOn: true, canToggle: false }).map(s => [s.pressed, s.disabled])).toEqual([[false, true], [true, true]]);
  });
  it('the words: 色 / 表示 (ja), Color / Show (en); no old per-state wording, no emoji', () => {
    expect(I.I18N.ja.regionColorToggle).toBe('色'); expect(I.I18N.ja.regionShapeToggle).toBe('表示');
    expect(I.I18N.en.regionColorToggle).toBe('Color'); expect(I.I18N.en.regionShapeToggle).toBe('Show');
    for (const k of ['regionColorToggle', 'regionColorToggleHint', 'regionShapeToggle', 'regionShapeToggleHint', 'hiddenShapeCount', 'showAllHidden', 'showAllHiddenHint']) {
      expect(typeof I.I18N.ja[k]).toBe('string'); expect(typeof I.I18N.en[k]).toBe('string');
      expect(I.I18N.ja[k]).not.toMatch(/\p{Extended_Pictographic}/u); expect(I.I18N.en[k]).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(I.I18N.ja.hiddenShapeCount).toContain('{n}'); expect(I.I18N.ja.hiddenShapeCount).toMatch(/^隠れ/); expect(I.I18N.ja.showAllHidden).toBe('すべて表示');
  });
  it('the built buttons: same text and data-i18n whatever the state, aria-pressed follows it, the data hooks and the click work', () => {
    const mkEl = () => { const e = { dataset: {}, attrs: {}, children: [], style: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); } }; return e; };
    const doc = { createElement: tag => Object.assign(mkEl(), { tag }) };
    const clicks = [];
    const build = (c, s) => TG.buildShowToggles({ colorOn: c, shapeOn: s, canToggle: true }, { color: { attr: ['childColorOff', 's1'], onClick: () => clicks.push('c') }, shape: { attr: ['childVisible', 's1'], onClick: () => clicks.push('s') } }, doc);
    const a = build(true, true).children, b = build(false, false).children;
    expect(a.map(x => x.textContent)).toEqual(b.map(x => x.textContent)); expect(a.map(x => x.textContent)).toEqual([I.tr('regionColorToggle'), I.tr('regionShapeToggle')]);
    expect(a.map(x => x.dataset.i18n)).toEqual(['regionColorToggle', 'regionShapeToggle']);
    expect(a.map(x => x.attrs['aria-pressed'])).toEqual(['true', 'true']); expect(b.map(x => x.attrs['aria-pressed'])).toEqual(['false', 'false']);
    expect(a[0].dataset.childColorOff).toBe('s1'); expect(a[1].dataset.childVisible).toBe('s1');
    a[0].onclick(); a[1].onclick(); expect(clicks).toEqual(['c', 's']);
  });
  it('all three views build the toggles with region-toggles.js; the existing data hooks and flag setters are kept', () => {
    const ui = src('segment-ui.js'), ar = src('analysis-results.js');
    expect(ui.match(/buildShowToggles\(/g).length).toBe(2); expect(ar.match(/buildShowToggles\(/g).length).toBe(1);
    expect(ui).toContain("attr:['regionVisible',String(r.id)]"); expect(ui).toContain("attr:['regionHidden',String(r.id)]");
    expect(ui).toContain('setRegionHidden(g,!regionHidden(g))'); expect(ar).toContain('setRegionHidden(region,!regionHidden(region))');
    expect(ar).toContain('setRegionVisible(region,!regionVisible(region))');
    expect(ar).toContain('showAllHiddenShapes()'); expect(ar).toContain('hiddenShapeCount()'); expect(ar).toContain('btn.disabled=n===0');
  });
});
