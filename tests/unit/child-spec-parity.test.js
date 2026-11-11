import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { thinOverlaps, labelDisplay } from '../../docs/comment-3d-label-occlusion.js';
import { glowRid, glowRegionOf } from '../../docs/analysis-label.js';
import { createLabelThinner, cardLayout, pinLine, pushOut, CARD_W0, CARD_H0 } from '../../docs/vr-label-occlusion.js';

// Child segments (docs/child-segments.js, line 1): "every feature a preset card has (name, colour, show / hide, opacity, material, cut-face shading range, STL, section analysis, histogram, save / load)".
// One test group per item, run on a child segment built inside the test (a data set with ONLY child segments: no analysis result unless a test adds one). The views' frame loops (vr-view.js, comment-3d.js) cannot be run
// in Node: what they do with a child is checked through the pure functions they call (given a child's label item) and through the source (the child goes through the same arrays / calls as a result). Not a device test.
installDomStub();
const src = n => readFileSync('docs/' + n, 'utf8');
let S, ST, C, L, MR, SH, HU;
beforeAll(async () => {
  S = await importApp('segments'); ST = await importApp('state'); C = await importApp('child-segments'); L = await importApp('child-labels'); MR = await importApp('mpr-render');
  SH = await importApp('section-shade'); HU = await importApp('histogram-ui');
});
afterEach(() => {
  C.clearChildSegments(); ST.setAnalysisRegions([]); ST.setVolume(null); ST.setSceneState(null); ST.setSectionViewOpen(false); ST.setSectionViewPlane(null); ST.setSectionSliceImageVisible(true); ST.setSectionShadeMode(1); ST.setThreeRenderMode('surface');
  for (const k of S.SEGMENT_PRESET_ORDER) { S.segmentState[k].active = false; S.segmentState[k].enabled = false; }
  S.clearSegmentShadeRanges(); S.clearSegmentShadeAuto();
});
const tr = k => ({ childSegment: 'セグメント', bone: '骨' }[k] || k);
const D = 4;
const run1 = (y = 1, x0 = 1, x1 = 2, z = 1) => { const r = Array.from({ length: D }, () => null); r[z] = [y, x0, x1]; return r; }; // 2 voxels in one row of one slice
const vol = (fill = 500) => ({ columns: D, rows: D, slices: D, spacing: [0.5, 0.5, 1], min: -1000, max: 1000, data: new Int16Array(D * D * D).fill(fill) });
const mkChild = (extra = {}) => C.addChildSegment({ name: 'Femur', parentKey: 'bone', runsBySlice: run1(), color: '#ff0000', ...extra });
const showBone = () => { const b = S.segmentState.bone; b.active = true; b.enabled = true; b.min = 300; b.max = 1000; };

describe('spec: name / colour / show-hide / opacity / material of a child', () => {
  it('name: custom name, else "<セグメント> <id>"; the card title and the segment interface follow a rename', () => {
    const c = mkChild({ name: '' }); expect(S.segmentById(c.key).name).toBe('セグメント ' + c.id); expect(L.childLabelTitle(c, tr)).toBe('セグメント ' + c.id);
    expect(S.setChildLook(c.key, { name: '右大腿骨' })).toBe(true); expect(S.segmentById(c.key).name).toBe('右大腿骨'); expect(L.childLabelTitle(c, tr)).toBe('右大腿骨');
    expect(S.setChildLook(c.key, { name: '右大腿骨' })).toBe(false); // no change = no event
  });
  it('colour: set, normalised to #rrggbb, handed to the renderers', () => {
    const c = mkChild(); S.setChildLook(c.key, { color: '#00ff80' }); expect(S.segmentById(c.key).color).toBe('#00ff80'); expect(S.childRenderEntries()[0].color).toBe('#00ff80');
    S.setChildLook(c.key, { color: 0x112233 }); expect(c.color).toBe('#112233');
  });
  it('show / hide: its own flag AND its parent shown; a hidden child is not enabled, not drawn (entry.visible), the hand-off keeps its own flag (shown)', () => {
    showBone(); const c = mkChild(); expect(S.segmentById(c.key).enabled).toBe(true); expect(S.shownSegmentKeys()).toContain(c.key);
    S.setChildLook(c.key, { visible: false }); let e = S.childRenderEntries()[0]; expect([S.segmentById(c.key).enabled, e.visible, e.shown]).toEqual([false, false, false]); expect(S.shownSegmentKeys()).not.toContain(c.key);
    S.setChildLook(c.key, { visible: true }); S.segmentState.bone.enabled = false; e = S.childRenderEntries()[0]; expect([e.visible, e.shown]).toEqual([false, true]); // the parent hidden hides the child
  });
  it('opacity and material are the PARENT\'s (a child inherits); setChildLook ignores them', () => {
    const c = mkChild(); S.segmentState.bone.opacity = 0.4; S.segmentState.bone.material = 'plastic'; let e = S.childRenderEntries()[0]; expect([e.opacity, e.material]).toEqual([0.4, 'plastic']);
    expect(S.setChildLook(c.key, { opacity: 0.9, material: 'solid' })).toBe(false); e = S.childRenderEntries()[0]; expect([e.opacity, e.material]).toEqual([0.4, 'plastic']);
    S.segmentState.bone.opacity = 1; S.segmentState.bone.material = 'standard'; e = S.childRenderEntries()[0]; expect([e.opacity, e.material]).toEqual([1, 'standard']);
  });
});

describe('spec: cut-face shading range of a child', () => {
  it('manual range, step buttons\' setSegmentShadeEnd, reset to auto, the auto range from the child\'s own voxels; the section panel and the hand-off read the same range', () => {
    ST.setVolume(vol()); showBone(); const c = mkChild();
    S.setSegmentShadeEnd(c.key, 'lower', 100); const r = S.segmentShadeRange(c.key); expect(r.touched).toBe(true); expect(S.childRenderEntries()[0].shade).toEqual({ lower: r.lower, upper: r.upper });
    expect(SH.sectionShadeParams().ranges[c.key]).toEqual({ lower: r.lower, upper: r.upper }); expect(SH.shownShadeSegments()).toContain(c.key);
    S.resetSegmentShadeRange(c.key); expect(S.childRenderEntries()[0].shade).toBeNull(); expect(S.segmentShadeRange(c.key).touched).toBeFalsy();
  });
  it('a hidden child is not in the panel\'s chooser', () => {
    showBone(); const c = mkChild(); S.setChildLook(c.key, { visible: false }); expect(SH.shownShadeSegments()).not.toContain(c.key);
  });
});

describe('spec: section analysis (the PC cut face of the 3D view) with a child', () => {
  const capCtx = { createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
  const paint = (opts = {}) => { // -> the 4 x 4 cut face (axial slice 1) as [r, g, b, a] per pixel
    ST.setSectionViewOpen(true); ST.setSectionViewPlane('axial'); ST.setSectionCapEnabled(true); ST.setThreeRenderMode('surface');
    if ('image' in opts) ST.setSectionSliceImageVisible(opts.image);
    ST.setSceneState({ mprPlaneEntries: { axial: { cap: { visible: false, material: {} }, mesh: { visible: false }, highlight: null, capCanvas: { width: 0, height: 0, getContext: () => capCtx }, capTexture: {} } }, obj: null });
    expect(MR.paintSectionCap('axial', 1, [D, D], null)).toBe(true);
    const d = ST.sceneState.mprPlaneEntries.axial.capImage.data; return Array.from({ length: D * D }, (_, i) => Array.from(d.slice(i * 4, i * 4 + 4)));
  };
  const CHILD_PX = [5, 6], BONE_PX = [0, 1, 4, 7];
  it('the child\'s voxels show the CHILD colour on the cut face, the rest of the parent its own colour (the parent is built without the child)', () => {
    ST.setVolume(vol()); showBone(); mkChild(); const px = paint();
    for (const i of CHILD_PX) expect(px[i][0]).toBeGreaterThan(px[i][2] + 60); // red
    for (const i of BONE_PX) expect(Math.abs(px[i][0] - px[i][2])).toBeLessThan(40); // the bone's off-white
  });
  it('a hidden child leaves no cut face of its own: its voxels are not drawn as the parent either', () => {
    ST.setVolume(vol()); showBone(); const c = mkChild(); S.setChildLook(c.key, { visible: false }); const px = paint({ image: false }); // slice image off: nothing but a segment's colour is drawn
    for (const i of CHILD_PX) expect(px[i][3]).toBe(0);
    for (const i of BONE_PX) expect(px[i][3]).toBeGreaterThan(0);
  });
  it('the parent\'s opacity scales the child\'s cut face (the child has none of its own)', () => {
    ST.setVolume(vol()); showBone(); mkChild(); const a1 = paint()[5][3]; S.segmentState.bone.opacity = 0.4; const a2 = paint()[5][3]; S.segmentState.bone.opacity = 1;
    expect(a2).toBeLessThan(a1); expect(a2).toBeGreaterThan(0);
  });
  it('slice image hidden + CT shading: the brightness follows the value through the range of the child\'s PARENT (the child has none of its own; set here through the child key) (a narrow range makes the same value brighter)', () => {
    const v = vol(); ST.setVolume(v); showBone(); const c = mkChild(); ST.setSectionShadeMode(1);
    S.setSegmentShadeEnd(c.key, 'lower', 0); S.setSegmentShadeEnd(c.key, 'upper', 1000); const wide = paint({ image: false })[5][0];
    S.setSegmentShadeEnd(c.key, 'lower', 0); S.setSegmentShadeEnd(c.key, 'upper', 520); const narrow = paint({ image: false })[5][0];
    expect(narrow).toBeGreaterThan(wide);
  });
  it('an analysis result over the child\'s voxels is drawn on top (the result colour, never erased by the child)', () => {
    ST.setVolume(vol()); showBone(); mkChild(); const r = { id: 1, color: 0x00ff00, segmentKeys: ['bone'], visible: true, runsBySlice: run1(1, 1, 1), voxels: 1 }; ST.setAnalysisRegions([r]);
    const px = paint(); expect(px[5][1]).toBeGreaterThan(px[5][0] + 60); expect(px[6][0]).toBeGreaterThan(px[6][1] + 60); // x = 1: green (result), x = 2: still the child's red
  });
  it('the 3D surface of a child is cut by the section plane too (clipping materials applied to the child group), the shaders cut the volume view', () => {
    expect(src('child-segments-ui.js')).toContain('sceneState.obj.add(group); applySectionClippingMaterials(group);');
    expect(src('medical-volume.js')).toContain('var capChild=0u;'); expect(src('webgl-volume.js')).toContain("name: 'child-cap-shade'");
  });
});

describe('spec: histogram of a child', () => {
  it('counts the values of the child\'s own voxels only (not its parent\'s other voxels); the cut-face range is the parent\'s, not counted from them', async () => {
    const v = vol(100); const idx = (x, y, z) => x + D * (y + D * z); v.data[idx(1, 1, 1)] = 700; v.data[idx(2, 1, 1)] = 900; ST.setVolume(v); showBone();
    const c = mkChild(); const out = await HU.computeSegmentHistograms([c.key], () => false);
    expect(out && out[c.key]).toBeTruthy(); const h = out[c.key], total = Array.from(h).reduce((a, b) => a + b, 0); expect(total).toBe(2);
    S.applyShadeAutoHistograms(out); expect(S.segmentShadeRange(c.key)).toEqual(S.segmentShadeRange('bone'));
  });
  it('the histogram panel lists a child by its name and colour, with its own runs', () => {
    const h = src('histogram-ui.js'); expect(h).toContain("const nameOf = key => isChildKey(key) ? (segmentById(key)?.name || key)"); expect(h).toContain('for (const k of childKeys) runs[k] = childByKey(k).runsBySlice;');
  });
});

describe('spec: save / load of a child', () => {
  it('every field of the child (name, colour, visible, pinned label with its moved place, the mask; no opacity / material / shade: the parent\'s are used) survives a project round trip; the parent comes back without the child\'s voxels', () => {
    ST.setVolume(vol()); const c = mkChild({ opacity: 0.5, material: 'plaster', shade: { lower: 10, upper: 800 }, visible: false, label: { anchor: { i: 1, j: 1, k: 1 }, offset: { i: 2, j: 0, k: 1 } } });
    const saved = C.childSegmentsForProject(); expect(saved.length).toBe(1);
    const srcs = saved.map(s => C.childSrcFromEntry(JSON.parse(JSON.stringify(s.entry)), s.runsBySlice)); const { made } = C.restoreChildSegments(srcs); expect(made.length).toBe(1);
    const k = made[0]; expect(S.segmentById(k.key)).toMatchObject({ name: 'Femur', color: '#ff0000', visible: false, opacity: 1, material: 'standard', shade: null, parentKey: 'bone' });
    expect(JSON.stringify(saved[0].entry)).not.toMatch(/opacity|material|shade/);
    expect(k.label).toEqual({ anchor: { i: 1, j: 1, k: 1 }, offset: { i: 2, j: 0, k: 1 } }); expect(k.voxels).toBe(c.voxels); expect([...k.runsBySlice[1]]).toEqual([1, 1, 2]);
    expect(S.segmentSourcesOf('bone')).toContain(k.key);
  });
  it('the file writer / reader (data-load.js) and the shade ranges of the presets are the ones the round trip uses', () => {
    const d = src('data-load.js'); expect(d).toContain("binaries[path]=encodeRuns(runsBySlice,slices)"); expect(d).toContain('project.treeSegments');
  });
});

// ---- the name label of a child: the SAME mechanisms as an analysis result's (VR + PC) ----
const labelled = (extra = {}) => mkChild({ label: { anchor: { i: 1, j: 1, k: 1 } }, ...extra });
describe('VR: the card of a pinned child lights under the laser like a result\'s', () => {
  it('hitLabelRid: a result covers the voxel -> its rid; no result but a child -> -(child id); nothing -> 0', () => {
    const c = labelled(), regionList = [{ rid: 7 }, { rid: 9 }];
    expect(L.hitLabelRid({ id: 2, childKey: '' }, regionList)).toBe(9); expect(L.hitLabelRid({ id: 0, childKey: c.key }, regionList)).toBe(-c.id);
    expect(L.hitLabelRid({ id: 0, childKey: '' }, regionList)).toBe(0); expect(L.hitLabelRid({ id: 0, childKey: 's999' }, regionList)).toBe(0); expect(L.hitLabelRid(null, regionList)).toBe(0);
  });
  it('glowRid with that rid: the child\'s card id glows while the laser is on the child; not while a hand is on / holds a card, nor with the laser off or the controller hidden', () => {
    const c = labelled(), rid = L.hitLabelRid({ id: 0, childKey: c.key }, []);
    expect(glowRid(true, true, rid, false)).toBe(-c.id); expect(glowRid(true, true, rid, true)).toBe(0); expect(glowRid(false, true, rid, false)).toBe(0); expect(glowRid(true, false, rid, false)).toBe(0);
    expect(L.childLabelItemById(-c.id).key).toBe(c.key); // the pin map's key leads back to the child (lineGlow takes its colour)
  });
  it('vr-view.js: the hover card skip and the glow both read hitLabelRid; pinned child cards are drawn with pinGlow like results; the unused fitText is gone', () => {
    const v = src('vr-view.js');
    expect(v).toContain('hoverCards(c,hit,ph?u.hrids:hitLabelRids(hit,regionList,childByKey,u.hrids||(u.hrids=[])))'); expect(v).toContain('for(const rid of u.hrids){const g=glowRid(on,x.visible!==false,rid,blocked)');
    expect(v).toContain("drawLabel(lb,{id:0,key:'',childKey:reg.key},false,pinLit.has(reg.id)||pinGlow.has(reg.id));"); expect(v).toContain('lb.glow=!pinLit.has(lb.rid)&&pinGlow.has(lb.rid)');
    expect(v).toContain('const e=lb.rid<0?childLabelItemById(lb.rid):regionList['); expect(v).not.toContain('fitText');
  });
});

describe('the name label of a child goes through the machinery of 711 like a result\'s label', () => {
  it('VR: a child\'s card is a pin in the same map; leader limit (pinPlace), push out (embedLabel), hiding (pinOcclusion), thinning (thinPins) and the card layout run over `pins`, with no result-only branch', () => {
    const v = src('vr-view.js');
    expect(v).toContain('for(const lb of pins.values()){lb.lit=pinLit.has(lb.rid);embedLabel(lb,occ,pinHeld.has(lb.rid));placeLabel(lb)}thinPins(occ);for(const lb of pins.values())pinOcclusion(lb,lb.lit||lb.glow)');
    expect(v).toContain('lb.rid=reg.id;pins.set(reg.id,lb)'); expect((v.match(/lb\.rid=reg\.id;pins\.set\(reg\.id,lb\)/g) || []).length).toBe(2); // results and children
    expect(v).toContain('const cl=cardLayout((i,t)=>measureText(i?FT2:FT1,t)'); // one drawLabel for result, child and plain hover cards
    const place = v.slice(v.indexOf('const pinPlace=lb=>'), v.indexOf('const placeLabel=lb=>')), thin = v.slice(v.indexOf('const thinCompute=()=>'), v.indexOf('const spacingNote='));
    for (const t of [place, thin]) expect(t).not.toMatch(/analysisRegions|regionList|rid\s*[<>]/);
  });
  it('PC: the child labels are appended to the list every label code (place judgement, leader limit, display, probes, thinning, drag, glow) loops over', () => {
    const t = src('comment-3d.js');
    expect(t).toContain('for(const it of childLabelItems())if(shownRegion(it))out.push(it)'); expect(t).toContain('als=obj&&camera&&volume&&fp?analysisLabelRegions():[]');
    expect(t).toContain('glowPairOf(analysisLabelRegions(),hit,'); expect(t).toContain("e.disp=labelDisplay({embedded:!!pl?.embedded,pushed,behind:hiddenIds.has('A|'+r.id)");
    const draw = t.slice(t.indexOf('function drawAnalysisLabels'), t.indexOf('// the three looks of a label')); expect(draw).not.toMatch(/analysisRegions\b/);
  });
  it('thinning (PC thinOverlaps / VR createLabelThinner): a child\'s card and a result\'s overlap the same way; the nearer stays, the lit / looked-at one stays', () => {
    const a = labelled(), r = { x: 100, y: 100, w: 80, h: 16 };
    const items = (ida, idb, z) => [{ id: ida, ...r, z: 0.2, keep: false }, { id: idb, ...r, z, keep: false }];
    expect([...thinOverlaps(items(7, -a.id, 0.5))]).toEqual([-a.id]); expect([...thinOverlaps(items(-a.id, 7, 0.5))]).toEqual([7]); // the farther one gives way, child or result
    expect([...thinOverlaps([{ id: 7, ...r, z: 0.2, keep: true }, { id: -a.id, ...r, z: 0.5, keep: true }])]).toEqual([]); // both lit / kept
    const head = { x: 0, y: 0, z: 0 }, gaze = { x: 0, y: 0, z: -1 }, card = (id, z, extra = {}) => ({ id, x: -0.4 * z, y: 0, z, halfW: 0.03, halfH: 0.009, lit: false, ...extra });
    expect([...createLabelThinner().update([card(7, -1.0), card(-a.id, -0.5)], { head, gaze })]).toEqual([7]); expect([...createLabelThinner().update([card(-a.id, -1.0), card(7, -0.5)], { head, gaze })]).toEqual([-a.id]);
    expect([...createLabelThinner().update([card(-a.id, -1.5, { lit: true }), card(7, -1.0)], { head, gaze })]).toEqual([7]);
  });
  it('hiding behind tissue / translucent when embedded (PC labelDisplay) does not depend on whose label it is', () => {
    expect(labelDisplay({ behind: true })).toBe(labelDisplay({ behind: true })); expect(labelDisplay({ embedded: true })).not.toBe(labelDisplay({}));
    expect(labelDisplay({ behind: true, dragging: true })).not.toBe(labelDisplay({ behind: true }));
  });
  it('push out of the tissue (VR pushOut) is a function of the place only; the glow of the mouse on a bone finds a child by its runs like a result', () => {
    const inBox = p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1, ball = p => Math.hypot(p.x, p.y, p.z) <= 0.5;
    expect(pushOut({ x: 0, y: 0, z: 0 }, ball, inBox, 0.02).pushed).toBe(true);
    const a = labelled(), it = L.childLabelItem(a), res = { id: 3, label: { anchor: {} }, segmentKeys: ['bone'], runsBySlice: run1(3, 0, 0, 0) };
    const contains = (r, x, y, z) => { const row = r.runsBySlice[z]; return !!row && row[0] === y && x >= row[1] && x <= row[2]; };
    expect(glowRegionOf([res, it], { key: 'bone', x: 1, y: 1, z: 1 }, contains)).toBe(-a.id); expect(glowRegionOf([res, it], { key: 'bone', x: 0, y: 3, z: 0 }, contains)).toBe(3);
    expect(glowRegionOf([res, it], { key: 'fat', x: 1, y: 1, z: 1 }, contains)).toBe(0);
  });
  it('the leader\'s length limit is a function of the geometry (pinLine), the card of a long child name is widened and wrapped by cardLayout (the one of 712)', () => {
    const a = labelled({ name: 'とても長い名前の子セグメントとても長い名前の子セグメントとても長い名前の子セグメント' }), title = L.childLabelTitle(a, tr), measure = (i, t) => t.length * (i ? 20 : 26);
    const short = cardLayout(measure, { text: 'あ', x: 118 }, { text: '1.00 mm³', x: 118 }), long = cardLayout(measure, { text: title, x: 118 }, { text: '1.00 mm³', x: 118 });
    expect([short.w, short.h]).toEqual([CARD_W0, CARD_H0]); expect(long.w).toBeGreaterThan(CARD_W0); expect(long.lines.length).toBeGreaterThan(short.lines.length - 1);
    const p = pinLine({ x: 0, y: 0, z: -1 }, { x: 0.1, y: 0.1, z: -1 }, { x: 0, y: 0, z: 0 }, { off: true, hw: 0.03, hh: 0.01, fwd: 0.012, rise: 0 }); expect(p).toBeTruthy();
  });
});

describe('a child card follows its colour / volume; the pin button follows the language', () => {
  it('VR drawLabel: the key that decides "already drawn" holds the child\'s colour and volume, so a recolour / an edit redraws the card (the cached face is keyed the same way)', () => {
    const v = src('vr-view.js');
    expect(v).toContain("kc?'k'+hit.childKey+'|'+childLabelTitle(kc,tr)+'|'+kc.color+'|'+kmm:'n'+hit.key)"); expect(v).toContain("const ck=key+(r?'|'+r.color+'|'+r.mm3:kc?'|'+kc.color+'|'+kmm:'')");
  });
  it('PC tree row: the pin / unpin button carries data-i18n (the key follows the pinned state), so a language switch re-words it', () => {
    const u = src('segment-tree-ui.js');
    expect(u).toContain("pin.dataset.i18n = k; pin.textContent = tr(k);"); expect(u).toContain("const k = it?.label ? 'analysisLabelUnpin' : 'analysisLabelPin'");
  });
});

describe('spec table: what is stated, what is not', () => {
  it('VR: where a result covers a child\'s voxel the laser reads BOTH (the child is looked up with or without a result; two overlapping results keep the later one)', () => {
    const v = src('vr-view.js'); expect(v).toContain("if(ch?.ids&&childList.length&&ch.dims.join()===vp.dims.join())childKey=childKeyAtHit("); // where a result covers a child both get a card (hitLabelRids); the result is first
    expect(src('vr-volume-prep.js')).toContain('a later result wins where two overlap');
  });
});
