import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { labelSegmentsShown, surfaceAnchor, rectEdgePoint, vrVoxelStep, pcVoxelStep, normalizeAnalysisLabel, hasOffset, leaderVisible, withOffset, labelLocal, offsetForLocal, voxelFromLocalVr, voxelFromLocal3d, clampVoxel, setRegionLabel, setRegionLabelOffset, onAnalysisLabelsChange, labelForProject, sameLabel, ANALYSIS_LABEL_MAX, keepLengthFactor, pcLeaderCap, pcLeaderUncap, pcDragUncap, pcLeaderLimit, pcLengthFactor, pcScreenLength, pcDrawnLength, pushWithinLimit, scaledStep, PC_REF_DISTANCE, LABEL_LEADER_MAX_GROWTH } from '../../docs/analysis-label.js';
import { voxelToLocal } from '../../docs/vr-point.js';
import { voxelToLocal3D } from '../../docs/crosshair.js';
import { packProject, unpackProject } from '../../docs/project-file.js';
import { startHolderScale, scaleLimits } from '../../docs/vr-real-scale.js';
import { stepDelta } from '../../docs/measure-label.js';
import { PUSH_DIRS } from '../../docs/comment-3d-label-occlusion.js';

const dims = { columns: 120, rows: 80, slices: 200 }, spacing = [0.1, 0.1, 0.25], halfExt = [0.6, 0.4, 1.4];
const vrStep = vrVoxelStep(halfExt, dims);
const pcStep = pcVoxelStep(dims, spacing);

describe('analysis label model', () => {
  it('normalizes: anchor required, offset optional, junk dropped, numbers rounded', () => {
    expect(normalizeAnalysisLabel(null)).toBeNull();
    expect(normalizeAnalysisLabel({})).toBeNull();
    expect(normalizeAnalysisLabel({ anchor: { i: 1, j: 2 } })).toBeNull();
    expect(normalizeAnalysisLabel({ anchor: { i: '1', j: 2, k: 3 } })).toBeNull();
    expect(normalizeAnalysisLabel({ anchor: { i: 1, j: 2, k: NaN } })).toBeNull();
    expect(normalizeAnalysisLabel({ anchor: { i: ANALYSIS_LABEL_MAX + 1, j: 0, k: 0 } })).toBeNull();
    expect(normalizeAnalysisLabel({ anchor: { i: 1.23456, j: 2, k: 3 } })).toEqual({ anchor: { i: 1.235, j: 2, k: 3 } });
    // an invalid offset is the default placement, the anchor survives
    expect(normalizeAnalysisLabel({ anchor: { i: 1, j: 2, k: 3 }, offset: { i: 1, j: 'x', k: 0 } })).toEqual({ anchor: { i: 1, j: 2, k: 3 } });
    expect(normalizeAnalysisLabel({ anchor: { i: 1, j: 2, k: 3 }, offset: { i: 4, j: -5, k: 6.0004 }, extra: 1 })).toEqual({ anchor: { i: 1, j: 2, k: 3 }, offset: { i: 4, j: -5, k: 6 } });
  });
  it('leader line only when the label was moved', () => {
    const a = { i: 5, j: 5, k: 5 };
    expect(leaderVisible({ anchor: a })).toBe(false);
    expect(leaderVisible({ anchor: a, offset: { i: 0, j: 0, k: 0 } })).toBe(false);
    expect(leaderVisible({ anchor: a, offset: { i: 0, j: 0, k: 3 } })).toBe(true);
    expect(leaderVisible(null)).toBe(false);
    expect(hasOffset({ anchor: a, offset: { i: 1, j: 0, k: 0 } })).toBe(true);
    expect(hasOffset({ anchor: a })).toBe(false);
  });
  it('withOffset: set, reset (null), refuse an invalid one', () => {
    const l = { anchor: { i: 1, j: 2, k: 3 } };
    expect(withOffset(l, { i: 1, j: 1, k: 1 })).toEqual({ anchor: l.anchor, offset: { i: 1, j: 1, k: 1 } });
    expect(withOffset({ ...l, offset: { i: 1, j: 1, k: 1 } }, null)).toEqual(l);
    expect(withOffset(l, { i: NaN, j: 0, k: 0 })).toBeNull();
    expect(withOffset({ anchor: null }, null)).toBeNull();
  });
});

describe('data space <-> view space (independent of model move / rotate / scale)', () => {
  it('VR and PC local mappings invert to the same voxel', () => {
    const v = { i: 33.4, j: 70.25, k: 120.5 };
    const a = voxelFromLocalVr(voxelToLocal(v, halfExt, dims), halfExt, dims), b = voxelFromLocal3d(voxelToLocal3D(v, dims, spacing), dims, spacing);
    for (const k of ['i', 'j', 'k']) { expect(a[k]).toBeCloseTo(v[k], 9); expect(b[k]).toBeCloseTo(v[k], 9); }
  });
  it('the same offset (voxel units) puts the label at the same DATA place in VR and in the PC view', () => {
    const anchor = { i: 40, j: 30, k: 90 }, off = { i: 12, j: -7, k: 25 };
    const vr = labelLocal(voxelToLocal(anchor, halfExt, dims), off, vrStep), pc = labelLocal(voxelToLocal3D(anchor, dims, spacing), off, pcStep);
    const dv = voxelFromLocalVr(vr, halfExt, dims), dp = voxelFromLocal3d(pc, dims, spacing);
    for (const k of ['i', 'j', 'k']) { expect(dv[k]).toBeCloseTo(anchor[k] + off[k], 9); expect(dp[k]).toBeCloseTo(anchor[k] + off[k], 9); }
  });
  it('offsetForLocal inverts labelLocal (a drag stores what it shows)', () => {
    const al = { x: 0.1, y: -0.2, z: 0.3 }, off = { i: -3.5, j: 8, k: 14.25 };
    for (const step of [vrStep, pcStep]) {
      const back = offsetForLocal(al, labelLocal(al, off, step), step);
      expect(back.i).toBeCloseTo(off.i, 9); expect(back.j).toBeCloseTo(off.j, 9); expect(back.k).toBeCloseTo(off.k, 9);
    }
    expect(labelLocal(al, null, vrStep)).toEqual(al); // no offset: at the anchor
  });
  it('a model move / rotation / scale does not enter the stored offset (only local-space deltas do)', () => {
    // the drag converts world -> mesh local (worldToLocal) before offsetForLocal: the model transform cancels. Emulated with a uniform scale s and a shift.
    const al = { x: 0.2, y: 0.1, z: -0.3 }, target = { x: 0.35, y: 0.05, z: -0.1 };
    const off = offsetForLocal(al, target, vrStep);
    for (const s of [0.5, 1, 3]) {
      const toWorld = p => ({ x: p.x * s + 5, y: p.y * s - 2, z: p.z * s + 1 }), toLocal = p => ({ x: (p.x - 5) / s, y: (p.y + 2) / s, z: (p.z - 1) / s });
      const off2 = offsetForLocal(al, toLocal(toWorld(target)), vrStep);
      expect(off2.i).toBeCloseTo(off.i, 9); expect(off2.j).toBeCloseTo(off.j, 9); expect(off2.k).toBeCloseTo(off.k, 9);
    }
    expect(stepDelta(off, vrStep).x).toBeCloseTo(target.x - al.x, 9);
  });
  it('clampVoxel keeps an anchor inside the volume', () => {
    expect(clampVoxel({ i: -50, j: 1000, k: 10 }, dims)).toEqual({ i: -.5, j: dims.rows - .5, k: 10 });
  });
});

describe('state on the region: set / move / reset / events', () => {
  it('pin, move, reset, unpin and notify', () => {
    const r = { id: 7 }, events = [], off = onAnalysisLabelsChange(e => events.push(e));
    expect(setRegionLabelOffset(r, { i: 1, j: 1, k: 1 })).toBe(false); // nothing pinned yet
    expect(setRegionLabel(r, { anchor: { i: 10, j: 20, k: 30 } })).toBe(true);
    expect(r.label).toEqual({ anchor: { i: 10, j: 20, k: 30 } });
    expect(setRegionLabelOffset(r, { i: 4, j: 0, k: -2 })).toBe(true);
    expect(r.label.offset).toEqual({ i: 4, j: 0, k: -2 });
    expect(events).toEqual([{ id: 7 }, { id: 7, labelOnly: true, moveToggled: true }]);
    expect(setRegionLabelOffset(r, { i: 4, j: 0, k: -2 })).toBe(true); expect(events.length).toBe(2); // unchanged: no event
    expect(setRegionLabelOffset(r, { i: NaN, j: 0, k: 0 })).toBe(false); expect(r.label.offset).toEqual({ i: 4, j: 0, k: -2 });
    expect(setRegionLabelOffset(r, null)).toBe(true); expect(r.label).toEqual({ anchor: { i: 10, j: 20, k: 30 } }); expect(leaderVisible(r.label)).toBe(false);
    expect(setRegionLabel(r, null)).toBe(true); expect(r.label).toBeUndefined();
    expect(setRegionLabel(r, { anchor: { i: 'a' } })).toBe(false);
    expect(setRegionLabel(null, { anchor: { i: 1, j: 1, k: 1 } })).toBe(false);
    off();
  });
  it('sameLabel / labelForProject', () => {
    expect(labelForProject({})).toBeUndefined();
    expect(labelForProject({ label: { anchor: { i: 1, j: 2, k: 3 }, offset: { i: 0, j: 0, k: 9 } } })).toEqual({ anchor: { i: 1, j: 2, k: 3 }, offset: { i: 0, j: 0, k: 9 } });
    expect(sameLabel({ anchor: { i: 1, j: 2, k: 3 } }, { anchor: { i: 1, j: 2, k: 3 } })).toBe(true);
    expect(sameLabel({ anchor: { i: 1, j: 2, k: 3 } }, { anchor: { i: 1, j: 2, k: 3 }, offset: { i: 1, j: 0, k: 0 } })).toBe(false);
  });
});

describe('project file roundtrip (project.analysis.regions[].label)', () => {
  const region = (extra = {}) => ({ key: 'bone', segmentKeys: ['bone'], color: 0xff0000, visible: true, selected: false, merged: false, groupId: null, runs: 'analysis/region-1.bin', ...extra });
  // what applyProject does with each saved entry
  const load = e => normalizeAnalysisLabel(e.label);
  it('a moved label survives pack -> unpack -> load; the others stay unmoved', () => {
    const lb = { anchor: { i: 11.5, j: 22.25, k: 33 }, offset: { i: -5, j: 2.5, k: 0.125 } };
    const saved = [region({ label: labelForProject({ label: lb }) }), region({ label: labelForProject({ label: { anchor: lb.anchor } }) }), region({ label: labelForProject({}) })];
    const un = unpackProject(packProject({ analysis: { regions: saved } }, {}));
    const back = un.project.analysis.regions.map(load);
    expect(back[0]).toEqual(lb); expect(back[1]).toEqual({ anchor: lb.anchor }); expect(back[2]).toBeNull();
    expect('label' in un.project.analysis.regions[2]).toBe(false); // nothing written when there is no label
  });
  it('an old project (no label field) and a project with a corrupt label load unchanged / without a label', () => {
    const un = unpackProject(packProject({ analysis: { regions: [region(), region({ label: { anchor: 'x' } }), region({ label: 5 })] } }, {}));
    expect(un.project.version).toBe(1); // optional field, no version bump (like comments / measurements)
    expect(un.project.analysis.regions.map(load)).toEqual([null, null, null]);
  });
});

describe('leader line end on the card edge', () => {
  it('rectEdgePoint: on the rectangle boundary, towards the anchor', () => {
    expect(rectEdgePoint(100, 0, 10, 4)).toEqual({ x: 10, y: 0 });
    expect(rectEdgePoint(-100, 0, 10, 4)).toEqual({ x: -10, y: 0 });
    expect(rectEdgePoint(0, -50, 10, 4)).toEqual({ x: 0, y: -4 });
    const e = rectEdgePoint(30, -30, 10, 4); expect(e.x).toBeCloseTo(4, 9); expect(e.y).toBeCloseTo(-4, 9);
    const f = rectEdgePoint(3, 1, 10, 4); expect(Math.abs(f.x)).toBeCloseTo(10, 9); expect(f.y).toBeCloseTo(10 / 3, 9); // keeps the direction
    expect(rectEdgePoint(0, 0, 10, 4)).toEqual({ x: 0, y: -4 }); // no direction: the bottom edge
  });
  it('steps: a flipped j axis, anisotropic spacing', () => {
    expect(vrStep[1]).toBeLessThan(0); expect(pcStep[1]).toBeLessThan(0);
    expect(pcStep[2] / pcStep[0]).toBeCloseTo(spacing[2] / spacing[0], 9);
    expect(vrStep[0]).toBeCloseTo(2 * halfExt[0] / dims.columns, 12);
  });
});

describe('PC pin: the anchor is on the result surface facing the camera', () => {
  const box = { x0: 10, x1: 29, y0: 20, y1: 29, z0: 30, z1: 39 }; // a result: voxels of this box
  const contains = (i, j, k) => i >= box.x0 && i <= box.x1 && j >= box.y0 && j <= box.y1 && k >= box.z0 && k <= box.z1;
  const inside = { i: 20, j: 25, k: 35 };
  it('from the +k side the anchor is on the top (k) face, from -k on the bottom face, from +i on the +i face', () => {
    const a = surfaceAnchor({ contains, eye: { i: 20, j: 25, k: 500 }, target: inside });
    expect(a.k).toBeGreaterThanOrEqual(38.9); expect(a.k).toBeLessThanOrEqual(39.5 + 1e-9); expect(a.i).toBeCloseTo(20, 6);
    const b = surfaceAnchor({ contains, eye: { i: 20, j: 25, k: -400 }, target: inside });
    expect(b.k).toBeLessThanOrEqual(30.1); expect(b.k).toBeGreaterThanOrEqual(29.5 - 1e-9);
    const c = surfaceAnchor({ contains, eye: { i: 600, j: 25, k: 35 }, target: inside });
    expect(c.i).toBeGreaterThanOrEqual(28.9); expect(c.i).toBeLessThanOrEqual(29.5 + 1e-9);
    expect(contains(Math.round(a.i), Math.round(a.j), Math.round(a.k))).toBe(true); // always a voxel of the result
  });
  it('deterministic, cheap for a far eye (at most maxSteps tests), null when nothing is met', () => {
    let n = 0; const counted = (i, j, k) => { n++; return contains(i, j, k); };
    const a1 = surfaceAnchor({ contains: counted, eye: { i: 20, j: 25, k: 1e6 }, target: inside }), tests = n;
    expect(tests).toBeLessThanOrEqual(6001);
    expect(surfaceAnchor({ contains, eye: { i: 20, j: 25, k: 1e6 }, target: inside })).toEqual(a1);
    expect(surfaceAnchor({ contains: () => false, eye: { i: 0, j: 0, k: 100 }, target: inside })).toBeNull();
    expect(surfaceAnchor({ contains, eye: inside, target: inside })).toBeNull(); // no direction
  });
  it('an eye inside the result gives the first sample, never a point outside', () => {
    const a = surfaceAnchor({ contains, eye: { i: 15, j: 25, k: 33 }, target: inside });
    expect(contains(Math.round(a.i), Math.round(a.j), Math.round(a.k))).toBe(true);
  });
});

describe('wiring (static): fixes', () => {
  const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('VR: a tap on a pinned card unpins, cards are hit-testable only in the analysis tab and not through tissue, same numbers as the panel, no flicker, scratch objects', () => {
    const vr = read('vr-view.js');
    expect(vr).toContain("if(ld0?.pin&&pr.res.kind==='mlabel'){if(rel==='tap'&&!ld0.moved&&!ld0.done)"); expect(vr).toContain('setRegionLabel(reg,null);pulse(c,0.2)');
    expect(vr).toContain('if(analysisOn()&&(pins.size||px.cards().size))mlb=nearerLabel('); expect(vr).toContain('tagBehindTissue(occlusionGpu(),mlb.distance,vx.distance,occEps))mlb=null');
    expect(vr).toContain("cardPlain(ctx,l.text,l.x,l.y,l.maxWidth)"); expect(vr).toContain("cardLayout((i,t)=>measureText(i?FT2:FT1,t),{text:t1,x:x0},{text:t2,x:x0})"); expect(vr).toContain("t1=r?(r.title||vrChipTitle(r)):kc?childLabelTitle(kc,tr):seg"); expect(vr).toContain("label(X+76,y+34,vrChipTitle(r),"); // the same \"N. name\" text through vrChipTitle
    expect(vr).toContain('lb.m.position.y+=labelRise(lb);'); expect(vr).toContain('const labelRise=lb=>labelScale()*0.045+'); // the unlit size: the card does not move when lit
    expect(vr).toContain('const ridIndex=()=>'); expect(vr).toContain('spacingNoteF'); expect(vr).not.toContain('[...pins]'); expect(vr).not.toContain('hit:tmpPh.clone()');
    expect(vr).toContain('ld.done=true');
  });
  it('PC / project: the chip number is the region id; the surface anchor; merge and split keep the label; a second finger cannot rotate during a label drag', () => {
    const d3 = read('comment-3d.js'), ops = read('analysis-ops.js'), res = read('analysis-results.js');
    expect(d3).toContain('e.t1.textContent=labelChipTitle(r,tr);'); /* the number is r.id (region-name.js regionChipTitle; child-labels.js labelChipTitle, which gives a result exactly that) */ expect(d3).toContain('if(labelDragging){'); expect(d3).toContain('labelDragging=true;');
    expect(res).toContain('surfaceAnchor({contains:(i,j,k)=>analysisRunsContain(region.runsBySlice,i,j,k)');
    expect(ops).toContain('selected.find(r=>r.label)?.label'); expect(ops).toContain('split.label=r.label;delete r.label');
  });
});

describe('wiring (static): VR pins and the PC chips use the shared region.label', () => {
  const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('VR: pins are rebuilt from region.label every frame, can be grabbed (pin ref), long press resets, lit pins draw on top; the project carries the label', () => {
    const vr = read('vr-view.js');
    expect(vr).toContain('const syncPins=()=>'); expect(vr).toContain('for(const lb of pins.values()){lb.lit=pinLit.has(lb.rid);embedLabel(lb,occ,pinHeld.has(lb.rid));placeLabel(lb)}thinPins(occ);for(const lb of pins.values())pinOcclusion(lb,lb.lit||lb.glow)');
    expect(vr).toContain('mlb=nearerLabel(mlb,pickPin('); expect(vr).toContain('if(ld.pin){'); expect(vr).toContain('resetPin(c)');
    expect(vr).toContain('pinMaterialState(occlusionGpu(),lit,lb.trans)');
    expect(read('vr-prep-inputs.js')).toContain('rid: r.id'); // stage 1 of the sample pairs: regionItemsOf moved to vr-prep-inputs.js (over the input object)
    const ops = read('analysis-ops.js'); expect(ops).toContain('label:labelForProject(r)'); expect(ops).toContain('normalizeAnalysisLabel(e.label)');
    expect(read('data-load.js')).toContain('label:normalizeAnalysisLabel(e.label)||undefined');
  });
  it('PC: the chips are drawn in the comment layer, moved by the capture-phase drag, the leader only when moved (or pushed out of the tissue), hidden-behind judged for every shown label (comment-3d-label-occlusion.js)', () => {
    const d3 = read('comment-3d.js');
    expect(d3).toContain('function drawAnalysisLabels('); expect(d3).toContain('analysisProbes(als)'); expect(d3).toContain('if(moved&&aOk){const ed=rectEdgePoint(ax-c.x,ay-c.y,e.w/2,e.h/2);let x2=c.x+ed.x,y2=c.y+ed.y;'); expect(d3).toContain('if(len>T){x2=ax+(x2-ax)*T/len;y2=ay+(y2-ay)*T/len}'); // the line whenever the card was moved (as 708); under the card it is cut at T
    expect(d3).toContain('setRegionLabelOffset(regionOf(h.id),off)'); expect(d3).toContain('onAnalysisLabelsChange(again)');
    expect(d3).toContain("const analysisGate=()=>analysisEditTool==='select';"); // movable in the analysis mode too, not while an edit tool owns the pointer
  });
});

describe('a result label follows its segments (VR)', () => {
  it('no segments = always shown; any shown segment shows it; all hidden hides it; showing again restores (pure function of visibility)', () => {
    const shown = new Set(['fat']);
    const f = k => shown.has(k);
    expect(labelSegmentsShown(undefined, f)).toBe(true);
    expect(labelSegmentsShown([], f)).toBe(true);
    expect(labelSegmentsShown(['fat'], f)).toBe(true);
    expect(labelSegmentsShown(['bone', 'fat'], f)).toBe(true);
    shown.delete('fat');
    expect(labelSegmentsShown(['fat'], f)).toBe(false);
    expect(labelSegmentsShown(['bone', 'fat'], f)).toBe(false);
    shown.add('fat');
    expect(labelSegmentsShown(['fat'], f)).toBe(true);
  });
  it('hiding never touches the label itself (position kept), and vr-view hides without hit-testing', () => {
    const reg = { id: 3, segmentKeys: ['fat'], label: { anchor: { i: 1, j: 2, k: 3 }, offset: { i: 4, j: 5, k: 6 } } };
    const before = JSON.stringify(reg.label);
    labelSegmentsShown(reg.segmentKeys, () => false);
    expect(JSON.stringify(reg.label)).toBe(before);
    const vv = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(vv).toContain("const vrSegShown=key=>segAvail(segmentState[key])&&segMode[key]!==2;");
    expect(vv).toContain('lb.hid=!labelSegmentsShown(reg.segmentKeys,vrSegShown);');
    expect(vv).toMatch(/const placeLabel=lb=>\{\n  if\(lb\.hid\)\{lb\.m\.visible=false;lb\.line\.visible=false;return\}/);
    expect(vv).toMatch(/for\(const lb of pins\.values\(\)\)\{\s*if\(!lb\.m\.visible\)continue;/); // pickPin skips hidden cards
  });
  it('the PC 3D view already hides labels of unticked segments (analysisRegionShown)', () => {
    const c3 = readFileSync(new URL('../../docs/comment-3d.js', import.meta.url), 'utf8');
    expect(c3).toContain('r.label&&shownRegion(r)');
    expect(c3).toContain('analysisRegionShown(r)'); // a child's label follows the child's own shown rule (r.child?...:analysisRegionShown(r))
  });
});

// the leader is capped at its initial-display length when the model is enlarged (shorter when shrunk)
describe('leader length cap', () => {
  const len = v => Math.hypot(v.x, v.y, v.z), sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const anchor = { i: 40, j: 30, k: 90 }, off = { i: 12, j: -7, k: 25 };
  // sample7 hind leg: about 12 mm longest side -> starts enlarged to 5 cm (startHolderScale), limits 1x .. 0.30 m
  const LONG_MM = 12, s0 = startHolderScale(LONG_MM, 0.05), lim = scaleLimits(LONG_MM);
  const vrWorldOffset = (scale, o = off) => { // the card's world offset from its anchor: local delta * holder scale (the mesh sits in the holder)
    const step = scaledStep(vrStep, keepLengthFactor(s0, scale));
    const al = voxelToLocal(anchor, halfExt, dims), p = labelLocal(al, o, step), d = sub(p, al);
    return { x: d.x * scale, y: d.y * scale, z: d.z * scale };
  };
  it('LABEL_LEADER_MAX_GROWTH is one named constant: 1 = never longer than at the initial display', () => {
    expect(LABEL_LEADER_MAX_GROWTH).toBe(1);
    const src = readFileSync(new URL('../../docs/analysis-label.js', import.meta.url), 'utf8');
    expect(src.match(/LABEL_LEADER_MAX_GROWTH\s*=/g)).toHaveLength(1);
  });
  it('VR: enlarged past the start the world length stays at the initial length (up to the 0.30 m maximum); shrunk it follows the scale', () => {
    expect(s0).toBeCloseTo(0.05 / 3.3, 9); expect(lim.min).toBeLessThan(s0); expect(lim.max).toBeGreaterThan(s0);
    const L0 = len(vrWorldOffset(s0)), ref = len(stepDelta(off, vrStep)) * s0;
    expect(L0).toBeCloseTo(ref, 9);
    for (let i = 0; i <= 40; i++) { // a continuous sweep (log) = no jump between neighbours
      const s = lim.min * Math.pow(lim.max / lim.min, i / 40), L = len(vrWorldOffset(s));
      expect(L).toBeLessThanOrEqual(L0 * (1 + 1e-9)); // never longer than at the initial display
      expect(L / L0).toBeCloseTo(Math.min(1, s / s0), 9); // initial length when enlarged, proportional when shrunk
    }
    expect(len(vrWorldOffset(lim.max)) / L0).toBeCloseTo(1, 9); // sample 7 enlarged to 30 cm: still the initial length
    expect(len(vrWorldOffset(lim.min)) / L0).toBeCloseTo(lim.min / s0, 9);
  });
  it('VR: sample 7 geometry (346x306x408, 0.0348/0.0348/0.0174 mm) enlarged to 30 cm: the world leader is its initial (5 cm display) length', () => {
    const sp = [0.0347998, 0.0347998, 0.017398459], dm = { columns: 346, rows: 306, slices: 408 };
    const ext = [dm.columns * sp[0], dm.rows * sp[1], dm.slices * sp[2]], longMm = Math.max(...ext);
    const he = ext.map(e => 3.3 * e / longMm / 2), st = vrVoxelStep(he, dm), a0 = startHolderScale(longMm, 0.05), l7 = scaleLimits(longMm);
    const o7 = { i: 242.4, j: -269, k: -316.3 }; // a stored leader of the sample's project.vrlab (14 mm in the specimen)
    const worldLen = sc => { const d = stepDelta(o7, scaledStep(st, keepLengthFactor(a0, sc))); return len(d) * sc; };
    const initial = Math.hypot(o7.i * sp[0], o7.j * sp[1], o7.k * sp[2]) / 1000 * (0.05 / (longMm / 1000));
    expect(a0).toBeCloseTo(0.05 / 3.3, 9); expect(l7.max).toBeCloseTo(0.3 / 3.3, 9);
    expect(worldLen(a0)).toBeCloseTo(initial, 6);
    expect(worldLen(l7.max)).toBeCloseTo(worldLen(a0), 9); // 30 cm: not longer than at 5 cm
    expect(worldLen(l7.max)).toBeLessThanOrEqual(worldLen(a0) * (1 + 1e-9));
    expect(worldLen(l7.min)).toBeCloseTo(worldLen(a0) * l7.min / a0, 9); // real size: proportionally shorter
  });
  it('VR: the direction is the offset direction at every scale; at the initial scale nothing changed from before', () => {
    const d0 = vrWorldOffset(s0), old = stepDelta(off, vrStep);
    expect(d0.x).toBeCloseTo(old.x * s0, 12); expect(d0.y).toBeCloseTo(old.y * s0, 12); expect(d0.z).toBeCloseTo(old.z * s0, 12);
    for (const s of [lim.min, lim.max, s0 * 2]) {
      const d = vrWorldOffset(s), L = len(d), L0 = len(d0);
      expect(d.x / L).toBeCloseTo(d0.x / L0, 9); expect(d.y / L).toBeCloseTo(d0.y / L0, 9); expect(d.z / L).toBeCloseTo(d0.z / L0, 9);
    }
  });
  it('VR: a drag stores what it shows at any scale (offsetForLocal inverts labelLocal with the same step)', () => {
    const al = voxelToLocal(anchor, halfExt, dims);
    for (const s of [lim.min, s0, lim.max]) {
      const step = scaledStep(vrStep, keepLengthFactor(s0, s));
      const back = offsetForLocal(al, labelLocal(al, off, step), step);
      expect(back.i).toBeCloseTo(off.i, 9); expect(back.j).toBeCloseTo(off.j, 9); expect(back.k).toBeCloseTo(off.k, 9);
    }
  });
  it('keepLengthFactor: bad input falls back to 1 (no change)', () => {
    expect(keepLengthFactor(0, 1)).toBe(1); expect(keepLengthFactor(1, 0)).toBe(1); expect(keepLengthFactor(NaN, 1)).toBe(1);
    expect(keepLengthFactor(0.02, 0.04)).toBeCloseTo(0.5, 12); // enlarged x2: the leader is capped at the initial length
    expect(keepLengthFactor(0.02, 0.01)).toBe(1); expect(keepLengthFactor(0.02, 0.02)).toBe(1); // shrunk / initial: proportional (factor 1)
  });
  // PC: a camera looking down -z (app.js: the camera stays on the z axis; the wheel / pinch moves it, a pan moves the object, a turn turns the object). Camera space = R*p + t;
  // the screen point = (W/2 + f*x/-z, H/2 - f*y/-z) px, f = H / (2 tan 19 deg) (fov 38 degrees, square pixels: the view's height only). The reference = the same turn R,
  // t = (0,0,-PC_REF_DISTANCE). The functions under test never get the window: W is used here only to look at what a window would show.
  const tan = Math.tan(19 * Math.PI / 180), fOf = H => H / 2 / tan;
  const rotY = t => p => ({ x: Math.cos(t) * p.x + Math.sin(t) * p.z, y: p.y, z: -Math.sin(t) * p.x + Math.cos(t) * p.z });
  const rotX = t => p => ({ x: p.x, y: Math.cos(t) * p.y - Math.sin(t) * p.z, z: Math.sin(t) * p.y + Math.cos(t) * p.z });
  const cam = (R, t) => p => { const q = R(p); return { x: q.x + t[0], y: q.y + t[1], z: q.z + t[2] }; };
  const add = (p, d, k = 1) => ({ x: p.x + k * d.x, y: p.y + k * d.y, z: p.z + k * d.z });
  const REF = [0, 0, -PC_REF_DISTANCE];
  // one label in one view: the camera-space anchor / vector now and at the reference, as comment-3d.js updateLabelPlaces builds them (camPair)
  const pair = (R, t, al, dl) => { const V = cam(R, t), Rf = cam(R, REF), a = V(al), ar = Rf(al); return { a, d: sub(V(add(al, dl)), a), ar, dr: sub(Rf(add(al, dl)), ar) }; };
  const capOf = (R, t, al, dl, card, f) => { const { a, d, ar, dr } = pair(R, t, al, dl); return pcLeaderCap(a, d, ar, dr, f, f, { hw: card[0] / 2, hh: card[1] / 2 }); };
  // the line as comment-3d.js drawAnalysisLabels draws it, computed apart from the formula: both ends projected, the card NOT held inside the window, the line from the anchor to
  // the card's edge (rectEdgePoint); when the anchor is under its card that line (under the card) is cut at T. -> {A, C, E, len, under} (px, in a view W x H)
  const drawnLine = (R, t, al, dl, k, card, W, H, T = Infinity) => {
    const f = fOf(H), V = cam(R, t), scr = p => ({ x: W / 2 + f * p.x / -p.z, y: H / 2 - f * p.y / -p.z }), A = scr(V(al)), C = scr(V(add(al, dl, k)));
    const ed = rectEdgePoint(A.x - C.x, A.y - C.y, card[0] / 2, card[1] / 2), under = Math.abs(A.x - C.x) <= card[0] / 2 && Math.abs(A.y - C.y) <= card[1] / 2;
    let E = { x: C.x + ed.x, y: C.y + ed.y }, len = Math.hypot(E.x - A.x, E.y - A.y);
    if (under && len > T) { E = { x: A.x + (E.x - A.x) * T / len, y: A.y + (E.y - A.y) * T / len }; len = T; }
    return { A, C, E, len, under };
  };
  const clipLen = (x1, y1, x2, y2, W, H) => { let t0 = 0, t1 = 1; const dx = x2 - x1, dy = y2 - y1; for (const [p, q] of [[-dx, x1], [dx, W - x1], [-dy, y1], [dy, H - y1]]) { if (p === 0) { if (q < 0) return 0; continue; } const t = q / p; if (p < 0) { if (t > t1) return 0; if (t > t0) t0 = t; } else { if (t < t0) return 0; if (t < t1) t1 = t; } } return Math.hypot(dx, dy) * Math.max(0, t1 - t0); };
  const dims7 = { columns: 346, rows: 306, slices: 408 }, sp7 = [0.0347998, 0.0347998, 0.017398459], pcStep7 = pcVoxelStep(dims7, sp7);
  const pcCases = () => { // anchors over the whole box (3.3 long) and offsets up to the box's size, as sample 7's radial labels
    const out = [];
    for (const ai of [5, 120, 300]) for (const ak of [10, 200, 400]) for (const o of [off, { i: 242.4, j: -269, k: -316.3 }, { i: -300, j: 40, k: 380 }, { i: 0, j: 0, k: 400 }, { i: 40, j: -20, k: 0 }, { i: 60, j: -67, k: -79 }]) {
      const al = voxelToLocal3D({ i: ai, j: 150, k: ak }, dims7, sp7), dl = stepDelta(o, pcStep7); out.push({ al, dl });
    }
    return out;
  };
  const turns = [p => p, rotY(0.7), rotX(-1.05)], cards = [[211, 19], [283, 19], [90, 16]];
  const WINDOWS = [[368, 550], [768, 550], [1184, 775]]; // the 3D view of a browser window 784x775 / 1184x775 / 1600x1000
  const ZOOMS = [12, 8, 5.2, 4.16, 3.4667, 2.6, 1.7333, 0.8667, 0.3], PANS = [[0, 0], [0.5, -0.4], [-1.2, 0], [0.9, 0.5], [2, 1], [-0.3, 1.4]];
  let seed = 20261110; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  it('PC: at the initial display the factor is exactly 1 for every label, turn and card: the card is at its stored place (nothing is pulled in, whatever the window)', () => {
    for (const R of turns) for (const { al, dl } of pcCases()) for (const card of cards) for (const [, H] of WINDOWS) expect(capOf(R, REF, al, dl, card, fOf(H))).toBe(1);
  });
  it('PC: zoomed (x0.43 .. x17) and panned, the drawn line is never longer than at the initial display; where it is limited it is exactly as long (the largest factor)', () => {
    let capped = 0, checked = 0, under = 0;
    for (const [, H] of WINDOWS) for (const R of turns) for (const { al, dl } of pcCases()) for (const card of cards) {
      const f = fOf(H), ref = pair(R, REF, al, dl), T = pcLeaderLimit(ref.ar, ref.dr, f, f, { hw: card[0] / 2, hh: card[1] / 2 });
      if (!(T < Infinity)) continue; // an offset that passes the reference camera: not limited (covered below)
      expect(drawnLine(R, REF, al, dl, 1, card, 1000, H).len).toBeCloseTo(T, 6); // T is the line the initial display draws
      for (const z of ZOOMS) for (const pan of PANS) {
        const t = [pan[0], pan[1], -z], V = cam(R, t);
        if (!(V(al).z < -0.05)) continue; // the anchor behind / at the camera: not drawn
        const k = capOf(R, t, al, dl, card, f); expect(k).toBeGreaterThan(0); expect(k).toBeLessThanOrEqual(1);
        const l = drawnLine(R, t, al, dl, k, card, 1000, H, T), L = l.len; checked++; if (l.under) under++;
        expect(L).toBeLessThanOrEqual(T + 1e-6);
        const { a, d } = pair(R, t, al, dl); expect(pcDrawnLength(a, d, k, f, f, card[0] / 2, card[1] / 2, T)).toBeCloseTo(L, 6); // the formula is the line as drawn
        if (k < 1) { capped++; expect(L).toBeCloseTo(T, 6); expect(l.under).toBe(false); } // limited: exactly at the limit, not shorter than needed
      }
    }
    expect(checked).toBeGreaterThan(20000); expect(capped).toBeGreaterThan(8000); expect(under).toBeGreaterThan(100); // views with the anchor under its card are among them
  });
  it('PC: random labels, turns, cards, zooms and pans (seeded): drawn line <= T, the factor in (0, 1], T does not depend on anything but the reference and the view height', () => {
    let capped = 0;
    for (let n = 0; n < 4000; n++) {
      const R = (ry => (rx => p => rotX(rx)(rotY(ry)(p)))((rnd() - 0.5) * 3.1))(rnd() * 6.283), H = 300 + rnd() * 900, f = fOf(H), card = [60 + rnd() * 240, 14 + rnd() * 26];
      const al = { x: (rnd() - 0.5) * 2.8, y: (rnd() - 0.5) * 2.4, z: (rnd() - 0.5) * 3.3 }, dl = { x: (rnd() - 0.5) * 3, y: (rnd() - 0.5) * 3, z: (rnd() - 0.5) * 3 };
      const ref = pair(R, REF, al, dl), T = pcLeaderLimit(ref.ar, ref.dr, f, f, { hw: card[0] / 2, hh: card[1] / 2 }); if (!(T < Infinity)) continue;
      const z = 0.3 * Math.pow(40, rnd()), t = [(rnd() - 0.5) * 3 * z * tan, (rnd() - 0.5) * 3 * z * tan, -z]; if (!(cam(R, t)(al).z < -0.05)) continue;
      const k = capOf(R, t, al, dl, card, f), L = drawnLine(R, t, al, dl, k, card, 1000, H, T).len;
      expect(k).toBeGreaterThan(0); expect(k).toBeLessThanOrEqual(1); expect(L).toBeLessThanOrEqual(T + 1e-6);
      if (k < 1) { capped++; expect(L).toBeCloseTo(T, 5); }
    }
    expect(capped).toBeGreaterThan(1000);
  });
  it('PC: zoomed out the factor stays 1: the card keeps its place on the model and the line gets shorter with it (as before 709)', () => {
    for (const R of turns) for (const { al, dl } of pcCases()) for (const z of [6, 10.4, 12]) {
      const f = fOf(775); expect(capOf(R, [0, 0, -z], al, dl, cards[0], f)).toBe(1);
      const ref = pair(R, REF, al, dl), T = pcLeaderLimit(ref.ar, ref.dr, f, f, { hw: cards[0][0] / 2, hh: cards[0][1] / 2 });
      if (T < Infinity) expect(drawnLine(R, [0, 0, -z], al, dl, 1, cards[0], 1000, 775, T).len).toBeLessThanOrEqual(T + 1e-6);
    }
  });
  it('PC: the window. The card is not held in, so in every window the part of the line in sight is never more than the whole line of the initial display; a label shown whole at the start never shows more', () => {
    let whole = 0, cut = 0;
    for (const [W, H] of WINDOWS) for (const R of turns) for (const { al, dl } of pcCases()) for (const card of cards) {
      const f = fOf(H), ref = pair(R, REF, al, dl), T = pcLeaderLimit(ref.ar, ref.dr, f, f, { hw: card[0] / 2, hh: card[1] / 2 }); if (!(T < Infinity)) continue;
      const b = drawnLine(R, REF, al, dl, 1, card, W, H), vis0 = clipLen(b.A.x, b.A.y, b.E.x, b.E.y, W, H);
      const inWin = b.C.x - card[0] / 2 >= 0 && b.C.x + card[0] / 2 <= W && b.C.y - card[1] / 2 >= 0 && b.C.y + card[1] / 2 <= H && b.A.x >= 0 && b.A.x <= W && b.A.y >= 0 && b.A.y <= H;
      if (inWin) { whole++; expect(vis0).toBeCloseTo(b.len, 9); } else cut++; // a card that does not fit is cut by the window's edge at the start (not moved)
      for (const z of ZOOMS) for (const pan of PANS) {
        const t = [pan[0], pan[1], -z]; if (!(cam(R, t)(al).z < -0.05)) continue;
        const k = capOf(R, t, al, dl, card, f), l = drawnLine(R, t, al, dl, k, card, W, H, T), vis = l.len > 0 ? clipLen(l.A.x, l.A.y, l.E.x, l.E.y, W, H) : 0;
        expect(vis).toBeLessThanOrEqual(T + 1e-6); // B: never more than the whole line of the initial display
        if (inWin) expect(vis).toBeLessThanOrEqual(vis0 + 1e-6); // C: shown whole at the start: never more in sight than then
      }
      // the card's place at the start is the same in every window: (card centre - anchor) / the view height does not depend on the window
      const o = drawnLine(R, REF, al, dl, 1, card, 2000, H * 2); expect((b.C.x - b.A.x) / H).toBeCloseTo((o.C.x - o.A.x) / (H * 2), 9); expect((b.C.y - b.A.y) / H).toBeCloseTo((o.C.y - o.A.y) / (H * 2), 9);
    }
    expect(whole).toBeGreaterThan(50); expect(cut).toBeGreaterThan(50); // both kinds are in the cases
  });
  it('PC: a place pushed out of the tissue goes through the same limit: any vector from the anchor, limited by pcLengthFactor, draws a line <= T', () => {
    for (let n = 0; n < 3000; n++) {
      const R = rotY(rnd() * 6.283), f = fOf(550), card = cards[n % 3], al = { x: (rnd() - 0.5) * 2.8, y: (rnd() - 0.5) * 2.4, z: (rnd() - 0.5) * 3.3 }, v0 = { x: (rnd() - 0.5) * 2, y: (rnd() - 0.5) * 2, z: (rnd() - 0.5) * 2 };
      const ref = pair(R, REF, al, v0), T = pcLeaderLimit(ref.ar, ref.dr, f, f, { hw: card[0] / 2, hh: card[1] / 2 }); if (!(T < Infinity)) continue;
      const z = 0.3 * Math.pow(40, rnd()), t = [(rnd() - 0.5) * z, (rnd() - 0.5) * z, -z], V = cam(R, t), a = V(al); if (!(a.z < -0.05)) continue;
      const push = { x: (rnd() - 0.5) * 1.6, y: (rnd() - 0.5) * 1.6, z: (rnd() - 0.5) * 1.6 }, dv = sub(V(add(al, push)), a); // where a (stale) judgement pushed the card, in any direction
      const kv = pcLengthFactor(a, dv, T, f, f, card[0] / 2, card[1] / 2);
      expect(kv).toBeLessThanOrEqual(1); expect(drawnLine(R, t, al, push, kv, card, 1000, 550, T).len).toBeLessThanOrEqual(T + 1e-6);
    }
  });
  it('pushWithinLimit: the march of pushOutOfTissue plus the limit: only a free place that accept allows, the shortest way out among them; none = null', () => {
    const tissue = p => p.z <= 0 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1, opt = { step: 0.01, margin: 0.03, maxDist: 0.8 }; // a slab below z = 0
    const p0 = { x: 0, y: 0, z: -0.1 }, free = pushWithinLimit(p0, tissue, PUSH_DIRS, opt);
    expect(free.point.x).toBeCloseTo(0, 12); expect(free.point.z).toBeCloseTo(0.01 + 0.03, 9); expect(free.dist).toBeCloseTo(0.11, 9); // straight up, the first free sample + the margin
    expect(pushWithinLimit({ x: 0, y: 0, z: 0.2 }, tissue, PUSH_DIRS, opt)).toBeNull(); // not in the tissue: nothing to do
    const anchor = { x: 0.3, y: 0, z: -0.1 }, d = q => Math.hypot(q.x - anchor.x, q.y - anchor.y, q.z - anchor.z);
    expect(pushWithinLimit(p0, tissue, PUSH_DIRS, { ...opt, accept: q => d(q) <= 0.05 })).toBeNull(); // no free place within the limit: stays (translucent)
    const near = pushWithinLimit(p0, tissue, PUSH_DIRS, { ...opt, accept: q => d(q) <= 0.25 && q.x > 0.05 }); // straight up is refused: a diagonal towards the anchor is taken
    expect(near).not.toBeNull(); expect(tissue(near.point)).toBe(false); expect(d(near.point)).toBeLessThanOrEqual(0.25); expect(near.point.x).toBeGreaterThan(0.05); expect(near.dist).toBeGreaterThan(free.dist);
    let offered = 0; pushWithinLimit(p0, tissue, PUSH_DIRS, { ...opt, accept: q => { offered++; expect(tissue(q)).toBe(false); return false; } }); expect(offered).toBeGreaterThan(0); // only free places are offered
    const wall = p => (p.z <= 0 || (p.z > 0.02 && p.z < 0.2)) && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1; // tissue again just beyond the exit: that way is skipped
    const w = pushWithinLimit(p0, wall, PUSH_DIRS, opt); if (w) expect(wall(w.point)).toBe(false);
    expect(pushWithinLimit(p0, tissue, PUSH_DIRS, { ...opt, maxDist: 0.05 })).toBeNull(); // no way out within maxDist
  });
  it('PC: a drag stores the offset whose limited place is exactly where the card was put, at any zoom / pan / turn; pcLeaderUncap alone (the card\'s own depth) stops short of an unreachable place, on the pointer\'s line', () => {
    let solved = 0, enlarged = 0, stopped = 0;
    for (const R of turns) for (const { al, dl } of pcCases()) for (const z of [8, 5.2, 2.6, 0.8667]) for (const pan of [[0, 0], [0.6, -0.3]]) for (const fr of [0.1, 0.3, 1]) {
      const f = fOf(775), t = [pan[0], pan[1], -z], V = cam(R, t), Rf = cam(R, REF), card = cards[0], o = { hw: card[0] / 2, hh: card[1] / 2 };
      if (!(V(al).z < -0.05)) continue;
      const ul = { x: dl.x * fr, y: dl.y * fr, z: dl.z * fr }; // where the hand put the card (object space, from the anchor)
      const a = V(al), u = sub(V(add(al, ul)), a), ar = Rf(al), ur = sub(Rf(add(al, ul)), ar);
      if (!(a.z + u.z < -0.005)) continue; // the drag puts the card in the plane at the card's depth: always in front of the camera
      const s = pcLeaderUncap(a, u, ar, ur, f, f, o), P = m => m * capOf(R, t, al, { x: ul.x * m, y: ul.y * m, z: ul.z * m }, card, f), p = P(s);
      expect(s).toBeGreaterThanOrEqual(1); expect(p).toBeLessThanOrEqual(1 + 1e-9);
      if (p > 1 - 1e-9) { solved++; if (s > 1 + 1e-9) enlarged++; } // drawn back exactly where it was put
      else { stopped++; expect(ur.z).toBeLessThan(0); expect(s).toBeCloseTo(Math.max(1, 3 * -ar.z / -ur.z), 9); } // a vector running away from the reference camera whose line levels off there
    }
    expect(solved).toBeGreaterThan(500); expect(enlarged).toBeGreaterThan(100);
    // the unreachable case, built by hand: straight away from the reference camera, off the axis; enlarged x6 the line asked for is longer than the reference can ever draw
    const al = { x: 1.2, y: 0, z: 0 }, ul = { x: 0, y: 0, z: -3 }, f = fOf(775), a = cam(turns[0], [0, 0, -0.8667])(al), ar = cam(turns[0], REF)(al);
    const s = pcLeaderUncap(a, ul, ar, ul, f, f); expect(s).toBeCloseTo(3 * 5.2 / 3, 9); expect(s * pcLeaderCap(a, add({ x: 0, y: 0, z: 0 }, ul, s), ar, add({ x: 0, y: 0, z: 0 }, ul, s), f, f)).toBeLessThan(1); stopped++;
    expect(stopped).toBeGreaterThan(0);
  });
  it('PC: the drag (pcDragUncap) draws the card at the pointer at every zoom / pan / turn, also a card deeper than its anchor dragged far while enlarged; the depth is kept whenever an offset exists for it', () => {
    let kept = 0, moved = 0, deep = 0, n = 0;
    for (const R of turns) for (const { al, dl } of pcCases()) for (const z of [8, 5.2, 2.6, 0.8667]) for (const pan of [[0, 0], [0.6, -0.3]]) for (const fr of [0.1, 0.3, 1, 2.5]) {
      const H = 775, f = fOf(H), t = [pan[0], pan[1], -z], V = cam(R, t), Rf = cam(R, REF), card = cards[0], o = { hw: card[0] / 2, hh: card[1] / 2 };
      const a = V(al), Pc = V(add(al, dl, fr)); if (!(a.z < -0.05) || !(Pc.z < -0.005)) continue; // the pointer's point at the card's depth (camera space), in front of the camera
      const lamA = a.z / Pc.z, scr = p => ({ x: f * p.x / -p.z, y: -f * p.y / -p.z }), ptr = scr(Pc);
      // the pointer's line of sight passes through the camera (the origin of camera space): its points are lam * Pc; object space vectors come back through the inverse turn
      const ex = R({ x: 1, y: 0, z: 0 }), ey = R({ x: 0, y: 1, z: 0 }), ez = R({ x: 0, y: 0, z: 1 }), inv = q => ({ x: q.x * ex.x + q.y * ex.y + q.z * ex.z, y: q.x * ey.x + q.y * ey.y + q.z * ey.z, z: q.x * ez.x + q.y * ez.y + q.z * ez.z });
      const view = tt => { const lam = lamA + (1 - lamA) * tt, u = sub({ x: Pc.x * lam, y: Pc.y * lam, z: Pc.z * lam }, a), ul = inv(u), ar = Rf(al); return { a, u, ar, ur: sub(Rf(add(al, ul)), ar), ul }; };
      const r = pcDragUncap(view, f, f, o), v = view(r.t), st = { x: v.ul.x * r.s, y: v.ul.y * r.s, z: v.ul.z * r.s }, k = capOf(R, t, al, st, card, f), got = scr(V(add(al, st, k))); n++;
      expect(r.s).toBeGreaterThanOrEqual(1); expect(r.t).toBeGreaterThanOrEqual(0); expect(r.t).toBeLessThanOrEqual(1);
      expect(Math.hypot(got.x - ptr.x, got.y - ptr.y)).toBeLessThan(1e-4); // the card is drawn at the pointer (px)
      const v1 = view(1); if (-v1.u.z > 1e-9) deep++;
      if (r.t === 1) kept++; else { moved++; expect(-v1.u.z).toBeGreaterThan(0); expect(z).toBeLessThan(5.2); expect(pcLeaderUncap(v1.a, v1.u, v1.ar, v1.ur, f, f, o)).toBeCloseTo(Math.max(1, 3 * -v1.ar.z / -v1.ur.z), 9); } // only a card deeper than its anchor, enlarged, whose own depth has no offset
    }
    expect(n).toBeGreaterThan(1000); expect(kept).toBeGreaterThan(800); expect(moved).toBeGreaterThan(20); expect(deep).toBeGreaterThan(200);
  });
  it('pcLeaderCap / pcLengthFactor / pcLeaderLimit: nothing to limit (zero offset, an anchor behind the camera, a vector along the line of sight, an unlimited label); the card\'s edge', () => {
    const f = fOf(775), a = { x: 0.2, y: 0.1, z: -1 }, ar = { x: 0.2, y: 0.1, z: -5.2 };
    expect(pcLeaderCap(a, { x: 0, y: 0, z: 0 }, ar, { x: 0, y: 0, z: 0 }, f, f)).toBe(1);
    expect(pcLeaderCap({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, ar, { x: 1, y: 0, z: 0 }, f, f)).toBe(1);
    expect(pcLeaderCap({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: -5.2 }, { x: 0, y: 0, z: -2 }, f, f)).toBe(1); // on the axis, along it: a point on the screen
    expect(pcLeaderCap(a, { x: 1, y: 0, z: 0 }, ar, { x: 1, y: 0, z: 0 }, f, f)).toBeCloseTo(1 / 5.2, 9); // no card: on the axis, along the screen, the depth ratio
    expect(pcScreenLength(a, { x: 1, y: 0, z: 0 }, f, f, 1 / 5.2)).toBeCloseTo(pcScreenLength(ar, { x: 1, y: 0, z: 0 }, f, f), 9);
    const o = { x: 0, y: 0, z: -5.2 };
    expect(pcDrawnLength(o, { x: 1, y: 0, z: 0 }, 1, f, f, 50, 10)).toBeCloseTo(pcScreenLength(o, { x: 1, y: 0, z: 0 }, f, f) - 50, 9); // the line stops at the card's edge
    expect(pcDrawnLength(o, { x: 0.01, y: 0, z: 0 }, 1, f, f, 50, 10)).toBeCloseTo(50 - pcScreenLength(o, { x: 0.01, y: 0, z: 0 }, f, f), 9); // the anchor under its own card: the line under the card, from the anchor to the card's edge (as) ...
    expect(pcDrawnLength(o, { x: 0.01, y: 0, z: 0 }, 1, f, f, 50, 10, 3)).toBe(3); // ... cut at T
    expect(pcLeaderLimit(o, { x: 0.01, y: 0, z: 0 }, f, f, { hw: 50, hh: 10 })).toBeCloseTo(50 - pcScreenLength(o, { x: 0.01, y: 0, z: 0 }, f, f), 9); // and that line is its limit T
    expect(pcLeaderLimit(o, { x: 0, y: 0, z: 6 }, f, f)).toBe(Infinity); // the card behind the reference camera: no limit ...
    expect(pcLeaderCap({ x: 0.5, y: 0, z: -9 }, { x: 0.3, y: 0, z: 6 }, { x: 0.5, y: 0, z: -5.2 }, { x: 0.3, y: 0, z: 6 }, f, f)).toBe(1); // ... so the label is drawn as stored
    expect(pcLengthFactor(a, { x: 1, y: 0, z: 0 }, 0, f, f)).toBe(0); // a limit of nothing, no card: the card on its anchor
    const k0 = pcLengthFactor(a, { x: 1, y: 0, z: 0 }, 0, f, f, 50, 10); expect(pcScreenLength(a, { x: 1, y: 0, z: 0 }, f, f, k0)).toBeCloseTo(50, 9); // with a card: its edge at the anchor
    expect(pcLeaderLimit(o, { x: 1, y: 0, z: 0 }, 2 * f, 2 * f)).toBeCloseTo(2 * pcLeaderLimit(o, { x: 1, y: 0, z: 0 }, f, f), 9); // a view twice as high: the model and the limit twice as large
  });
  it('PC: the camera starts at PC_REF_DISTANCE (app.js camera.position.z = 5.2)', () => {
    const app = readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8');
    expect(app).toContain('camera.position.z=5.2');
  });
  it('wiring: the limit is applied where the card is placed, in both views; nothing about the limit reads the window; the PC judges the tissue again only when the view has stopped', () => {
    const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8'), c3 = readFileSync(new URL('../../docs/comment-3d.js', import.meta.url), 'utf8'), al = readFileSync(new URL('../../docs/analysis-label.js', import.meta.url), 'utf8');
    expect(vr).toContain('keepLengthFactor(startHolderScale('); expect(vr).toContain('const labelStep=()=>scaledStep(vrVoxelStep(vrHalfExt,vrDims),labelK())');
    expect(vr).toContain('offsetForLocal(lb.anchor,tmpPl,labelStep())'); // a drag converts back with the scaled step
    expect(vr).toContain('return pinPlaceLimited(a,v0,K,em?em.v:null,lineOf,tmpPp);'); expect(vr).toContain('const pp=pinPlace(lb);'); expect(vr).not.toContain('lb.ext'); // every place a card is drawn at goes through the cap
    expect(c3).toContain('T=pcLeaderLimit(ar,dr,capFx,capFy,{hw,hh}),k=pcLengthFactor(a,d,T,capFx,capFy,hw,hh)'); expect(c3).toContain('kv=pcLengthFactor(a,dv,T,capFx,capFy,hw,hh)'); // the stored place and a pushed place, every frame
    expect(c3).toContain('const p=pl?pl.place:labelLocal(al,lab.offset,step0);'); expect(c3).toContain('local:pl.place'); // drawn and judged hidden at the same limited place
    expect(c3).toContain('const q=labelDragPlace(e.ctx.ml,{x:px,y:py,z:pz},e.w,e.h,obj,camera)'); expect(c3).toContain('pcDragUncap(view,capFx,capFy,{hw:w/2,hh:h/2})'); // a drag: the offset whose limited card is at the pointer
    expect(c3).toContain('const c={x:lx,y:ly};'); expect(c3.split('clampLabelCenter(').length - 1).toBe(1); // the analysis cards are not held inside the view; the one call left is the distance label's
    expect(c3).toContain("lab.anchor.i+','+lab.anchor.j+','+lab.anchor.k+'|'+(o?o.i+','+o.j+','+o.k:'')"); // the place of the initial display: judged per anchor / offset, never with the camera (as 708)
    expect(c3).toContain('if(can&&settled&&!fresh){'); expect(c3).toContain('settled=now-capAt>=LABEL_SETTLE_MS'); expect(c3).toContain('pushWithinLimit(base,'); // the limited place: judged when the view has stopped, pushed only within T
    for (const gone of ['capBin', 'capK', 'pcKeepFactor', 'pcFrameFactor', 'pcShownLength', 'PC_LABEL_FRAME', 'capW', 'capH']) expect(c3).not.toContain(gone);
    for (const gone of ['clampLabelCenter', 'pcFrameFactor', 'pcShownLength', 'PC_LABEL_FRAME']) expect(al).not.toContain(gone);
    expect(al).not.toMatch(/pc(LeaderCap|LengthFactor|LeaderLimit|LeaderUncap|DragUncap|Uncap)\([^)]*\bW\b/); // no window in the signatures
  });
});
