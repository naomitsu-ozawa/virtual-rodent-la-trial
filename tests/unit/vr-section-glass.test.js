// The empty inside of a section frame (invisible "glass"): the laser meets the plane anywhere inside the frame and a press takes that section. It answers ONLY where nothing else does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { frameDepthTest } from '../../docs/vr-section-frame.js';
import { resolveTriggerTarget, squareContains, squareBandContains, rayLocalPlaneX } from '../../docs/vr-point.js';

const glass = (t, extra = {}) => ({ t, pl: { id: 'plane' }, glass: true, ...extra });
describe('hit area: the whole square of the frame', () => {
  it('squareContains: inside, on the edge, outside', () => {
    expect(squareContains(0, 0, 0.12)).toBe(true);
    expect(squareContains(0.11, -0.11, 0.12)).toBe(true);
    expect(squareContains(0.12, 0.12, 0.12)).toBe(true); // the frame line itself
    expect(squareContains(0.121, 0, 0.12)).toBe(false);
    expect(squareContains(0, -0.2, 0.12)).toBe(false);
  });
  it('the band is inside the square: whatever the band hits, the glass hits too', () => {
    for (const [y, z] of [[0.12, 0], [0.119, 0.05], [0.123, 0.1]]) if (squareBandContains(y, z, 0.12, 0.006)) expect(squareContains(y, z, 0.12 + 0.006)).toBe(true);
  });
  it('a ray at the plane (local X = 0) lands at (y, z); a parallel ray or one pointing away does not hit', () => {
    const r = rayLocalPlaneX({ x: -0.5, y: 0.05, z: -0.03 }, { x: 1, y: 0, z: 0 });
    expect(r.t).toBeCloseTo(0.5, 12); expect(squareContains(r.y, r.z, 0.12)).toBe(true);
    expect(rayLocalPlaneX({ x: -0.5, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    expect(rayLocalPlaneX({ x: 0.5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
    const out = rayLocalPlaneX({ x: -0.5, y: 0.3, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(squareContains(out.y, out.z, 0.12)).toBe(false);
  });
});

describe('priority: UI boards > labels / points > section plane > volume; the glass is last', () => {
  const g = glass(0.4);
  it('with nothing else: the glass is a section hit with the plane as its ref (the laser ends there, a press takes the section)', () => {
    const r = resolveTriggerTarget({ glass: g, canDrag: true });
    expect(r.kind).toBe('section'); expect(r.ref).toBe(g); expect(r.ref.glass).toBe(true);
    expect(resolveTriggerTarget({ glass: g, canDrag: false }).kind).toBe('section'); // also when nothing is draggable by the empty-space rule
  });
  it('without it nothing changes: empty / none as before', () => {
    expect(resolveTriggerTarget({ canDrag: true }).kind).toBe('empty');
    expect(resolveTriggerTarget({ canDrag: false }).kind).toBe('none');
    expect(resolveTriggerTarget({ glass: null, canDrag: true }).kind).toBe('empty');
  });
  it('boards, rings, a moving point and the number tag come first', () => {
    expect(resolveTriggerTarget({ board: { item: 1 }, glass: g }).kind).toBe('board');
    expect(resolveTriggerTarget({ ringOwnOpen: true, ringHighlight: null, glass: g }).kind).toBe('ring-close');
    expect(resolveTriggerTarget({ moving: true, placement: null, glass: g }).kind).toBe('move');
    expect(resolveTriggerTarget({ tab: { t: 9, pl: 'tab' }, glass: g }).ref.pl).toBe('tab');
  });
  it('points, distance labels, the frame band, tissue and the selected plane keep winning over the glass, even when the glass is nearer', () => {
    expect(resolveTriggerTarget({ glass: glass(0.1), point: { id: 'p1', distance: 0.9 } }).kind).toBe('point');
    expect(resolveTriggerTarget({ glass: glass(0.1), mlabel: { id: 'm1', distance: 0.9 } }).kind).toBe('mlabel');
    expect(resolveTriggerTarget({ glass: glass(0.1), band: { t: 0.9, pl: 'band' } }).ref.pl).toBe('band');
    expect(resolveTriggerTarget({ glass: glass(0.1), mode: 'surface', tissue: { t: 0.9 } }).kind).toBe('record');
    expect(resolveTriggerTarget({ glass: glass(0.1), mode: 'section', tissue: { t: 0.9 } }).kind).toBe('tissue');
    expect(resolveTriggerTarget({ glass: glass(0.1), mode: 'section', plane: { t: 0.9, voxel: { i: 1, j: 1, k: 1 } } }).kind).toBe('record'); // placing a point on the slice
    expect(resolveTriggerTarget({ glass: glass(0.1), analysis: true, tissue: { t: 0.9 } }).kind).toBe('label');
  });
  it('a glass hit never carries a voxel: a tap on it records nothing', () => {
    expect(resolveTriggerTarget({ glass: g }).ref.voxel).toBeUndefined();
  });
});

describe('wiring in vr-view.js (not runnable here)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('the glass is hit-tested analytically for the visible planes, and given to resolveTriggerTarget', () => {
    expect(src).toContain('const glassHit=(c,list)=>{');
    expect(src).toContain('if(r&&squareContains(r.y,r.z,pl.h)&&(!best||r.t<best.t))best={t:r.t,pl,y:r.y,z:r.z,glass:true};');
    expect(src).toContain('if(vis.length)gl=glassHit(c,vis);');
    expect(src).toContain('band,glass:gl,tissue:vh,plane:sh,');
  });
  it('the glass is not drawn when idle: hidden at creation, shown only while a laser is on it; it is never raycast', () => {
    expect(src).toContain('glass.renderOrder=1;glass.visible=false;obj.add(glass);');
    expect(src).toContain('pl.glass.visible=glassBy.has(pl)&&!fHide;');
    expect(src).toContain("if(rr?.kind==='section'&&rr.ref?.glass&&!c.userData.drag)glassBy.add(rr.ref.pl)");
    expect(src).toContain('pl.glass.material.dispose()');
    expect(src).not.toMatch(/intersectObjects?\([^)]*glass/);
  });
  it('the glass depth test follows the 「実際に隠す」 setting (not the lit state: it is only shown while lit), updated every frame like the frame', () => {
    expect(src).toContain('pl.glass.material.depthTest=frameDepthTest(occF,false);');
    expect(frameDepthTest(true, false)).toBe(true); expect(frameDepthTest(false, false)).toBe(false);
  });
  it('the 操作方法 board says a section can be grabbed anywhere inside its frame (ja / en), short enough for the board', () => {
    const ja = '枠の中ならどこでも：トリガーで選択／押したまま動かして移動・回転', en = 'Anywhere in a frame: trigger selects, hold and move to slide / rotate';
    expect(src).toContain("'" + ja + "'"); expect(src).toContain("'" + en + "'");
    expect(ja.length).toBeLessThanOrEqual('枠の細い線・番号札：トリガーで選択／押したまま動かして移動・回転'.length);
    expect(en.length).toBeLessThanOrEqual(76);
  });
  it('the press path is the band\'s: a section hit selects and drags that section (works with the slice toggled transparent: nothing here reads the slice opacity)', () => {
    expect(src).toContain("const pd=pressDragSection(res,{recordOk:!surfaceActive()&&!labelMode(),selected:section.selected});"); // a 'section' result (band / tag / the inside of a frame) is taken through pressDragSection
    const a = src.indexOf('const glassHit=(c,list)=>{'), b = src.indexOf('// number tag (the handle square)', a);
    expect(src.slice(a, b)).not.toMatch(/sliceOpacity|sliceClear/);
  });
  it('an armed HU line still starts on the empty inside of a frame (the glass does not take the trigger from it; a band / tag still does)', () => {
    expect(src).toContain("if(huLine.isArmed()&&(res.kind!=='section'||res.ref?.glass)&&res.kind!=='move'&&res.kind!=='mlabel'&&huLine.start(c))return;");
  });
  it('a tap on the empty inside of a frame cancels a distance being made, as a tap on empty space did (a band / tag tap does not)', () => {
    expect(src).toContain("k==='empty'||k==='none'||k==='tissue'||(k==='section'&&pr.res.ref?.glass))){endMeasureTap(c,");
  });
});
