// A label of the partner (the data read second in a side-by-side pair) can be moved and put back, like the first data's.
// The code under test lives inside vr-view.js's closure, so the pieces are cut out of the source and run with stand-ins.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withOffset, offsetForLocal, labelLocal, vrVoxelStep, leaderVisible } from '../../docs/analysis-label.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from); expect(i).toBeGreaterThan(0); const j = src.indexOf(to, i); expect(j).toBeGreaterThan(i); return src.slice(i, j); };
const dragSrc = cut('const pairDragCard=', 'const pairPins=');
const dragPinSrc = cut('const dragPin=(rid,P)=>{', 'const resetPin=');
const resetPinSrc = cut('const resetPin=c=>{', '// new plane:');

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
// a partner whose mesh sits at +10 in x (world = local + 10 in x), a different box / dims from the primary's
const makePartner = (lab) => {
  const pt = {
    on: true,
    regs: [{ id: 3 }, { id: 4 }],
    halfExt: [1, 2, 3], srcDims: { columns: 100, rows: 200, slices: 60 },
    mesh: { parent: {}, worldToLocal: v => { v.x -= 10; return v; } },
    sess: new Map(), pins: new Map(),
  };
  pt.pins.set(3, { lab, anchor: V(0.1, 0.2, 0.3) });
  return pt;
};
const build = (pt) => {
  const state = { px: null, flashed: null, pulsed: 0 };
  const L = { lbReset: 'reset!' };
  const body = `
    const tmpPl=new Vec();const pairLive=()=>{const p=pair;return p&&p.on&&p.mesh.parent?p:null};
    let pair=PT;
    ${dragSrc}
    const px={drag:pairDragCard,reset:pairResetCard};
    const regionByRid=()=>null,pins=new Map(),mesh=null,vrHalfExt=null,vrDims=null,labelStep=()=>[1,1,1],pulseTwice=()=>{S.pulsed++},flashMsg=t=>{S.flashed=t};
    ${dragPinSrc}
    ${resetPinSrc}
    return {dragPin,resetPin,px};`;
  class Vec { constructor() { this.x = 0; this.y = 0; this.z = 0; } set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } }
  const api = new Function('PT', 'S', 'L', 'Vec', 'withOffset', 'offsetForLocal', 'vrVoxelStep', 'setRegionLabelOffset', body)(pt, state, L, Vec, withOffset, offsetForLocal, vrVoxelStep, () => false);
  return { state, ...api };
};

describe('dragging the partner\'s label', () => {
  it('a card id "pp<n>" is sent to the partner\'s own rule; the label goes to the world point (in the PARTNER\'s space and step)', () => {
    const lab = { anchor: { i: 10, j: 20, k: 5 } }, pt = makePartner(lab), t = build(pt);
    const P = V(10.4, 0.7, -0.5); // world; partner local (0.4, 0.7, -0.5)
    expect(t.dragPin('pp3', P)).toBe(true);
    const got = pt.sess.get(3).lab;
    expect(got.anchor).toEqual(lab.anchor);
    expect(leaderVisible(got)).toBe(true);
    const back = labelLocal(pt.pins.get(3).anchor, got.offset, vrVoxelStep(pt.halfExt, pt.srcDims)); // what placePairLabel draws it at
    expect(back.x).toBeCloseTo(0.4, 2); expect(back.y).toBeCloseTo(0.7, 2); expect(back.z).toBeCloseTo(-0.5, 2);
  });
  it('the partner\'s .vrlab label (reg.label) is not written: a new object goes to the session copy', () => {
    const lab = Object.freeze({ anchor: Object.freeze({ i: 1, j: 2, k: 3 }) }), pt = makePartner(lab), t = build(pt);
    expect(t.dragPin('pp3', V(11, 1, 1))).toBe(true);
    expect(pt.sess.get(3).lab).not.toBe(lab);
    expect(lab.offset).toBeUndefined();
  });
  it('a second drag keeps the anchor and replaces the offset', () => {
    const pt = makePartner({ anchor: { i: 1, j: 2, k: 3 } }), t = build(pt);
    t.dragPin('pp3', V(11, 1, 1));
    pt.pins.get(3).lab = pt.sess.get(3).lab; // pairPins takes the new object
    t.dragPin('pp3', V(9, -1, 2));
    const o = pt.sess.get(3).lab;
    expect(o.anchor).toEqual({ i: 1, j: 2, k: 3 });
    const back = labelLocal(pt.pins.get(3).anchor, o.offset, vrVoxelStep(pt.halfExt, pt.srcDims));
    expect(back.x).toBeCloseTo(-1, 2); expect(back.y).toBeCloseTo(-1, 2); expect(back.z).toBeCloseTo(2, 2);
  });
  it('nothing happens for a card that is not there / no partner', () => {
    const pt = makePartner({ anchor: { i: 1, j: 2, k: 3 } }), t = build(pt);
    expect(t.dragPin('pp4', V())).toBe(false); // result 4 has no card
    expect(t.dragPin('pp9', V())).toBe(false);
    pt.on = false;
    expect(t.dragPin('pp3', V())).toBe(false);
    expect(pt.sess.size).toBe(0);
  });
});

describe('putting the partner\'s label back (long press)', () => {
  const press = id => ({ userData: { lblDrag: { id, pin: true, moved: false } } });
  it('a moved card loses its offset in the session copy only; the press is spent, a toast and a double pulse', () => {
    const lab = { anchor: { i: 1, j: 2, k: 3 }, offset: { i: 5, j: 5, k: 5 } }, pt = makePartner(lab), t = build(pt), c = press('pp3');
    expect(t.resetPin(c)).toBe(true);
    expect(pt.sess.get(3).lab).toEqual({ anchor: { i: 1, j: 2, k: 3 } });
    expect(lab.offset).toEqual({ i: 5, j: 5, k: 5 }); // .vrlab label untouched
    expect(c.userData.lblDrag.done).toBe(true);
    expect(t.state.flashed).toBe('reset!'); expect(t.state.pulsed).toBe(1);
  });
  it('a card that was not moved: nothing (the press is not spent)', () => {
    const pt = makePartner({ anchor: { i: 1, j: 2, k: 3 } }), t = build(pt), c = press('pp3');
    expect(t.resetPin(c)).toBe(false);
    expect(c.userData.lblDrag.done).toBeUndefined();
    expect(pt.sess.size).toBe(0);
  });
});

describe('wiring in vr-view.js', () => {
  it('the partner\'s drag / reset are in px, and the drag is sent there from dragPin / resetPin', () => {
    expect(src).toContain('Object.assign(px,{drag:pairDragCard,reset:pairResetCard});');
    expect(dragPinSrc).toContain("rid.startsWith('pp')");
    expect(resetPinSrc).toContain("ld.id.startsWith('pp')");
  });
  it('the partner\'s step is the same one placePairLabel draws with (not the primary\'s labelStep)', () => {
    expect(dragSrc).toContain('vrVoxelStep(pt.halfExt,pt.srcDims)');
    expect(dragSrc).not.toContain('labelStep');
    expect(cut('const placePairLabel=', 'const tmpSa=')).toContain('vrVoxelStep(pt.halfExt,pt.srcDims)');
  });
  it('unbindPair lets go of a held partner card (its id "pp<n>" is not isPairId)', () => {
    expect(cut('const unbindPair=', 'const bindPair=')).toContain("(ld.pin&&typeof ld.id==='string')");
  });
});
