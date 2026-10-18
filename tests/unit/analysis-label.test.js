import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { surfaceAnchor, rectEdgePoint, vrVoxelStep, pcVoxelStep, normalizeAnalysisLabel, hasOffset, leaderVisible, withOffset, labelLocal, offsetForLocal, voxelFromLocalVr, voxelFromLocal3d, clampVoxel, setRegionLabel, setRegionLabelOffset, onAnalysisLabelsChange, labelForProject, sameLabel, ANALYSIS_LABEL_MAX } from '../../docs/analysis-label.js';
import { voxelToLocal } from '../../docs/vr-point.js';
import { voxelToLocal3D } from '../../docs/crosshair.js';
import { packProject, unpackProject } from '../../docs/project-file.js';
import { stepDelta } from '../../docs/measure-label.js';

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

describe('PC pin: the anchor is on the result surface facing the camera (build 524)', () => {
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

describe('wiring (static): build 524 fixes', () => {
  const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('VR: a tap on a pinned card unpins, cards are hit-testable only in the analysis tab and not through tissue, same numbers as the panel, no flicker, scratch objects', () => {
    const vr = read('vr-view.js');
    expect(vr).toContain("if(ld0?.pin&&pr.res.kind==='mlabel'){if(rel==='tap'&&!ld0.moved&&!ld0.done)"); expect(vr).toContain('setRegionLabel(reg,null);pulse(c,0.2)');
    expect(vr).toContain('if(ui.open&&ui.tab===5&&pins.size)mlb=nearerLabel('); expect(vr).toContain('tagBehindTissue(occlusionGpu(),mlb.distance,vh.distance,occEps))mlb=null');
    expect(vr).toContain("ctx.fillText(r.rid+'. '+"); expect(vr).toContain("label(X+76,y+34,String(r.rid)+'. '+");
    expect(vr).toContain('lb.m.position.y+=labelScale()*0.045'); // the unlit size: the card does not move when lit
    expect(vr).toContain('const ridIndex=()=>'); expect(vr).toContain('spacingNoteF'); expect(vr).not.toContain('[...pins]'); expect(vr).not.toContain('hit:tmpPh.clone()');
    expect(vr).toContain('ld.done=true');
  });
  it('PC / project: the chip number is the region id; the surface anchor; merge and split keep the label; a second finger cannot rotate during a label drag', () => {
    const d3 = read('comment-3d.js'), ops = read('analysis-ops.js'), res = read('analysis-results.js');
    expect(d3).toContain("e.t1.textContent=r.id+'. '+"); expect(d3).toContain('if(labelDragging){'); expect(d3).toContain('labelDragging=true;');
    expect(res).toContain('surfaceAnchor({contains:(i,j,k)=>analysisRunsContain(region.runsBySlice,i,j,k)');
    expect(ops).toContain('selected.find(r=>r.label)?.label'); expect(ops).toContain('split.label=r.label;delete r.label');
  });
});

describe('wiring (static): VR pins and the PC chips use the shared region.label', () => {
  const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
  it('VR: pins are rebuilt from region.label every frame, can be grabbed (pin ref), long press resets, lit pins draw on top; the project carries the label', () => {
    const vr = read('vr-view.js');
    expect(vr).toContain('const syncPins=()=>'); expect(vr).toContain('syncPins();for(const lb of pins.values()){lb.lit=pinLit.has(lb.rid);placeLabel(lb);pinOcclusion(lb,lb.lit)}');
    expect(vr).toContain('mlb=nearerLabel(mlb,pickPin('); expect(vr).toContain('if(ld.pin){'); expect(vr).toContain('resetPin(c)');
    expect(vr).toContain('occludedPass(occlusionGpu(),lit)');
    expect(vr).toContain('rid:r.id');
    const ops = read('analysis-ops.js'); expect(ops).toContain('label:labelForProject(r)'); expect(ops).toContain('normalizeAnalysisLabel(e.label)');
    expect(read('data-load.js')).toContain('label:normalizeAnalysisLabel(e.label)||undefined');
  });
  it('PC: the chips are drawn in the comment layer, moved by the capture-phase drag, the leader only when moved, hidden-behind judged for moved labels only', () => {
    const d3 = read('comment-3d.js');
    expect(d3).toContain('function drawAnalysisLabels('); expect(d3).toContain('analysisProbes(als,dims)'); expect(d3).toContain('if(moved&&aOk)');
    expect(d3).toContain('setRegionLabelOffset(regionOf(h.id),off)'); expect(d3).toContain('onAnalysisLabelsChange(again)');
    expect(d3).toContain("const analysisGate=()=>analysisEditTool==='select';"); // movable in the analysis mode too, not while an edit tool owns the pointer
  });
});
