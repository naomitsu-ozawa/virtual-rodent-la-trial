import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from '../../docs/vendor/three@0.186.0/build/three.module.js';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
import { setRegionLabel, glowRid, glowPairOf, glowRegionOf } from '../../docs/analysis-label.js';
import { highlightColor, highlightIndex, anyLit, createHighlightTracker, HIGHLIGHT_WHITE_MIX, HIGHLIGHT_DIM_MIX } from '../../docs/region-highlight.js';

installDomStub();
const src = n => readFileSync('docs/' + n, 'utf8');
let C, L;
beforeAll(async () => { C = await importApp('child-segments'); L = await importApp('child-labels'); });
afterEach(() => C.clearChildSegments());
const mkChild = (extra = {}) => C.addChildSegment({ name: 'Femur', parentKey: 'bone', runsBySlice: [null, [1, 1, 2], null, null], color: '#ff0000', ...extra });
const A = { anchor: { i: 1, j: 1, k: 1 } };
const regionList = [{ rid: 7 }, { rid: 9 }];

describe('hitLabelRids: the targets of one laser hit, result first, child second', () => {
  it('a result and a child on the voxel: both (rid > 0 the result, rid < 0 the child)', () => {
    const c = mkChild();
    expect(L.hitLabelRids({ id: 2, childKey: c.key }, regionList)).toEqual([9, -c.id]);
  });
  it('a result only / a child only / nothing: as before (one or none)', () => {
    const c = mkChild();
    expect(L.hitLabelRids({ id: 1, childKey: '' }, regionList)).toEqual([7]);
    expect(L.hitLabelRids({ id: 0, childKey: c.key }, regionList)).toEqual([-c.id]);
    expect(L.hitLabelRids({ id: 0, childKey: '' }, regionList)).toEqual([]);
    expect(L.hitLabelRids({ id: 0, childKey: 's999' }, regionList)).toEqual([]);
    expect(L.hitLabelRids(null, regionList)).toEqual([]);
  });
  it('reuses the given array (no allocation per frame) and clears it first', () => {
    const c = mkChild(), out = [123, 456];
    expect(L.hitLabelRids({ id: 2, childKey: c.key }, regionList, undefined, out)).toBe(out);
    expect(out).toEqual([9, -c.id]);
    L.hitLabelRids(null, regionList, undefined, out); expect(out).toEqual([]);
  });
  it('hitLabelRid (the single "what the laser reads": the result wins) is unchanged', () => {
    const c = mkChild();
    expect(L.hitLabelRid({ id: 2, childKey: c.key }, regionList)).toBe(9);
    expect(L.hitLabelRid({ id: 0, childKey: c.key }, regionList)).toBe(-c.id);
  });
});

describe('labelToggle / the trigger tap: both cards can be pinned, one per tap', () => {
  it('pure rule: first not pinned gets pinned; all pinned -> the last is unpinned; no target -> null', () => {
    const pinned = new Set(), has = r => pinned.has(r);
    expect(L.labelToggle([], has)).toBe(null); expect(L.labelToggle(undefined, has)).toBe(null);
    expect(L.labelToggle([9, -3], has)).toEqual({ pin: 9 });
    pinned.add(9); expect(L.labelToggle([9, -3], has)).toEqual({ pin: -3 });
    pinned.add(-3); expect(L.labelToggle([9, -3], has)).toEqual({ unpin: [9, -3] }); // both pinned: back to none (never a loop that cannot reach none)
    pinned.delete(9); expect(L.labelToggle([9, -3], has)).toEqual({ pin: 9 }); // only the child is pinned (tree button / loaded project): the tap pins the result
  });
  it('one target: the tap it always was (pin, then unpin)', () => {
    const pinned = new Set(), has = r => pinned.has(r);
    expect(L.labelToggle([7], has)).toEqual({ pin: 7 }); pinned.add(7); expect(L.labelToggle([7], has)).toEqual({ unpin: [7] });
  });
  it('three taps on the overlap with the real labels: result, child, then both unpinned', () => {
    const c = mkChild(), res = { id: 9, label: null, segmentKeys: ['bone'] }, item = L.childLabelItem(c), byRid = rid => (rid < 0 ? L.childLabelItemById(rid) : rid === 9 ? res : null);
    const tap = () => { const t = L.labelToggle(L.hitLabelRids({ id: 2, childKey: c.key }, regionList), rid => !!byRid(rid)?.label); if (t.unpin) for (const rid of t.unpin) setRegionLabel(byRid(rid), null); else setRegionLabel(byRid(t.pin), A); return t; };
    expect(tap()).toEqual({ pin: 9 }); expect(!!res.label).toBe(true); expect(!!c.label).toBe(false);
    expect(tap()).toEqual({ pin: -c.id }); expect(!!res.label).toBe(true); expect(!!c.label).toBe(true); expect(item.label).toBe(c.label); // BOTH pinned
    expect(tap()).toEqual({ unpin: [9, -c.id] }); expect(!!res.label).toBe(false); expect(!!c.label).toBe(false);
    expect(tap()).toEqual({ pin: 9 }); // and round again
  });
  it('vr-view.js: togglePin is this rule (no result-only branch left)', () => {
    const v = src('vr-view.js'), i = v.indexOf('const togglePin='), t = v.slice(i, v.indexOf('const hovR='));
    expect(t).toContain('labelToggle(hitLabelRids(hit,regionList),rid=>!!regionByRid(rid)?.label)'); expect(t).not.toContain('hit.id');
  });
});

describe('the two hover cards (hoverCards cut out of vr-view.js and run against stubs)', () => {
  const v = src('vr-view.js'), i = v.indexOf('const hovR='), body = v.slice(i, v.indexOf(' let measureHintHand=null;', i));
  const make = pinsArr => {
    const calls = [], pins = new Map(pinsArr.map(r => [r, 1])), mk = n => ({ n, wr: n === 'lb2' ? 2 : 1, shift: 0, anchor: { copy() {} } }), labels = new Map();
    const lab = (c, n) => { if (!labels.has(n)) labels.set(n, mk(n)); return labels.get(n); };
    const f = new Function('pins', 'hoverLabelOf', 'hoverLabel2Of', 'drawLabel', 'placeLabel', 'hideLabel', 'labelScale', 'LABEL_W', 'pairShifts', body + '\n return {hoverCards};');
    const { hoverCards } = f(pins, c => lab(c, 'lb1'), c => lab(c, 'lb2'), (lb, h, faint) => calls.push(['draw', lb.n, h.id, h.childKey, faint]), lb => calls.push(['place', lb.n, lb.shift]), lb => lb && calls.push(['hide', lb.n]), () => 1, 0.1, L.pairShifts);
    return { hoverCards, calls };
  };
  const hit = { id: 2, childKey: 'K', key: 'bone', local: { x: 0 } };
  it('overlap, none pinned: the result card and the child card are both drawn (faint), side by side', () => {
    const { hoverCards, calls } = make([]), c = { userData: {} };
    hoverCards(c, hit, [9, -3]);
    expect(calls.filter(x => x[0] === 'draw')).toEqual([['draw', 'lb1', 2, '', true], ['draw', 'lb2', 0, 'K', true]]); // the child card is drawn from the CHILD (id 0), not the result
    const pl = calls.filter(x => x[0] === 'place');
    expect(pl.map(x => x[1])).toEqual(['lb1', 'lb2']); expect(pl[0][2]).toBeLessThan(0); expect(pl[1][2]).toBeGreaterThan(0); // result left, child right
  });
  it('the result pinned: only the child card is shown, alone (centred); the child pinned: only the result card', () => {
    let m = make([9]), c = { userData: {} }; m.hoverCards(c, hit, [9, -3]);
    expect(m.calls.filter(x => x[0] === 'draw')).toEqual([['draw', 'lb1', 0, 'K', true]]); expect(m.calls).toContainEqual(['place', 'lb1', 0]);
    m = make([-3]); c = { userData: {} }; m.hoverCards(c, hit, [9, -3]);
    expect(m.calls.filter(x => x[0] === 'draw')).toEqual([['draw', 'lb1', 2, '', true]]);
  });
  it('both pinned: no hover card; a hit with nothing to label keeps the plain segment card; no hit hides both', () => {
    let m = make([9, -3]), c = { userData: { hoverLabel: { n: 'a' }, hoverLabel2: { n: 'b' } } }; m.hoverCards(c, hit, [9, -3]);
    expect(m.calls.filter(x => x[0] === 'draw')).toEqual([]); expect(m.calls.filter(x => x[0] === 'hide').length).toBe(2);
    m = make([]); c = { userData: {} }; const plain = { id: 0, childKey: '', key: 'bone', local: {} }; m.hoverCards(c, plain, []);
    expect(m.calls.filter(x => x[0] === 'draw')).toEqual([['draw', 'lb1', 0, '', true]]);
    m = make([]); c = { userData: { hoverLabel: { n: 'a' }, hoverLabel2: { n: 'b' } } }; m.hoverCards(c, null, []); expect(m.calls).toEqual([['hide', 'a'], ['hide', 'b']]);
  });
  it('a result alone / a child alone: one centred card, the second one hidden (as before)', () => {
    const m = make([]), c = { userData: {} }; m.hoverCards(c, { ...hit, childKey: '' }, [9]);
    expect(m.calls.filter(x => x[0] === 'draw')).toEqual([['draw', 'lb1', 2, '', true]]); expect(m.calls).toContainEqual(['place', 'lb1', 0]);
  });
  it('pairShifts: the pair is centred, the gap is kept, no overlap', () => {
    const [a, b] = L.pairShifts(0.06, 0.12, 0.01);
    const total = 0.06 + 0.12 + 0.01;
    expect(a - 0.06 / 2).toBeCloseTo(-total / 2, 9); expect(b + 0.12 / 2).toBeCloseTo(total / 2, 9); // the pair is centred
    expect(b - 0.12 / 2 - (a + 0.06 / 2)).toBeCloseTo(0.01, 9);
  });
  it('the laser on a pinned card keeps its rule; both cards glow at the overlap', () => {
    const glow = (rids, blocked = false) => rids.map(r => glowRid(true, true, r, blocked)).filter(Boolean);
    expect(glow([9, -3])).toEqual([9, -3]); expect(glow([9, -3], true)).toEqual([]); expect(glow([])).toEqual([]);
    const v2 = src('vr-view.js'); expect(v2).toContain('for(const rid of u.hrids){const g=glowRid(on,x.visible!==false,rid,blocked)');
  });
});

describe('a child segment lights like a result (VR: its row of childLut; PC: its row, x 1.18)', () => {
  it('the same look: a lit child is the result\'s colour 45 % toward white, another one back toward its segment 35 %', () => {
    const rgb = [0.8, 0.2, 0.1], base = [0.5, 0.5, 0.5], on = highlightColor(rgb, null, 'on'), other = highlightColor(rgb, base, 'other');
    expect(on[0]).toBeCloseTo(0.8 + (1 - 0.8) * HIGHLIGHT_WHITE_MIX, 9); expect(on[1]).toBeCloseTo(0.2 + 0.8 * HIGHLIGHT_WHITE_MIX, 9);
    expect(other[0]).toBeCloseTo(0.8 + (0.5 - 0.8) * HIGHLIGHT_DIM_MIX, 9);
  });
  it('anyLit: a result and / or a child lit; nothing lit = nothing dims', () => {
    expect(anyLit(-1, -1)).toBe(false); expect(anyLit(0, -1)).toBe(true); expect(anyLit(-1, 2)).toBe(true); expect(anyLit(1, 0)).toBe(true);
  });
  it('the tracker works for child ids (negative) like for results; a card wins over the volume; two hands: the newer target wins', () => {
    const t = createHighlightTracker();
    expect(t.update([{ key: 'a', pin: 0, hover: -2 }, { key: 'b', pin: 0, hover: 0 }], true)).toBe(-2);
    expect(t.update([{ key: 'a', pin: -5, hover: -2 }], true)).toBe(-5);
    expect(t.update([{ key: 'a', pin: 0, hover: -2 }], false)).toBe(0); expect(t.update([], true)).toBe(0);
    const entries = [{ rid: -4, shown: true }, { rid: -2, shown: true }, { rid: -9, shown: false }];
    expect(highlightIndex(entries, -2)).toBe(1); expect(highlightIndex(entries, -9)).toBe(-1); expect(highlightIndex(entries, 0)).toBe(-1);
  });
  // the child table code of vr-view.js (childHlAt / childLit) cut out and run
  const v = src('vr-view.js'), i = v.indexOf(' const childHlAt='), cut = v.slice(i, v.indexOf(' const refreshChildLut=', i));
  const run = (litId, others) => {
    const lutColor = new THREE.Color(), seg = { bone: { color: '#808080' } };
    const ids = new Map([['k1', { id: 1 }], ['k2', { id: 2 }]]);
    const mk = new Function('highlightIndex', 'highlightColor', 'childList', 'childByKey', 'highlightChildRid', 'lutColor', 'segmentState', 'gpuSegmentOrder', cut + '\n return {childLit,childHlAt};');
    return mk(highlightIndex, highlightColor, [{ key: 'k1' }, { key: 'k2' }], k => ids.get(k), litId, lutColor, seg, () => ['bone']);
  };
  it('VR table: the lit child whitens, the other child goes back toward its parent\'s colour; only rgb (alpha kept)', () => {
    const { childLit, childHlAt } = run(-2), a = new Float32Array(256 * 4), red = [1, 0, 0];
    expect(childHlAt()).toBe(1);
    for (const j of [0, 1]) { const o = (j + 1) * 4; a.set([...red, 3], o); }
    childLit({ key: 'k1' }, 4, 1, a); childLit({ key: 'k2' }, 8, 1, a);
    const sg = new THREE.Color('#808080');
    expect(a[8]).toBeCloseTo(1, 5); expect(a[9]).toBeCloseTo(HIGHLIGHT_WHITE_MIX, 5); expect(a[10]).toBeCloseTo(HIGHLIGHT_WHITE_MIX, 5); // lit: toward white
    expect(a[4]).toBeCloseTo(1 + (sg.r - 1) * HIGHLIGHT_DIM_MIX, 5); expect(a[5]).toBeCloseTo(sg.g * HIGHLIGHT_DIM_MIX, 5); // not lit: toward the segment's colour
    expect(a[7]).toBe(3); expect(a[11]).toBe(3); // alpha (slot bits) untouched
  });
  it('VR: nothing is touched while nothing is lit (the plain path), and the shader is not changed (no new GLSL / WGSL)', () => {
    expect(v).toContain('childHlLit=highlightChildRid?childHlAt()>=0:false;'); // a lit result alone does not touch the child table
    expect(v).toContain('highlightChildRid?childHlAt():-1'); // the child's index list is built only while a child is lit
    expect(v).toContain('if(childHlLit)childLit(e,o,m,a);'); expect(v).toContain('if(hlLit){hlRgb[0]=a[o];');
    for (const f of ['vr-view.js', 'webgl-volume.js', 'medical-volume.js']) expect(src(f)).not.toMatch(/uniform[^\n]*(childGlow|childLit|hoverChild)/i);
  });
  it('PC webgl: applyChildFocus scales only the lit child\'s rgb by 1.18 (a focused result\'s gain); hidden / unknown / none: nothing', async () => {
    const W = await import('../../docs/webgl-volume.js'), list = [{ key: 'k1' }, { key: 'k2' }], a = new Float32Array(256 * 12);
    const entries = [{ key: 'k1', color: '#ff0000', shown: true }, { key: 'k2', color: '#00ff00', shown: false }];
    list.forEach((e, j) => { e.segMask = 1; });
    W.fillChildLut(a, list, entries, () => [0.5, 0.25, 0.1], () => ({ ambient: 0, spec: 0, shininess: 1 }));
    expect(W.CHILD_FOCUS_GAIN).toBe(1.18);
    expect(W.applyChildFocus(a, list, 'k1')).toBe(true);
    expect([a[4], a[5], a[6], a[7]].map(x => +x.toFixed(4))).toEqual([0.59, 0.295, 0.118, 1]);
    expect(W.applyChildFocus(a, list, 'k2')).toBe(false); expect(a[8]).toBe(0.5); // hidden (alpha 0)
    expect(W.applyChildFocus(a, list, 'zz')).toBe(false); expect(W.applyChildFocus(a, list, '')).toBe(false);
  });
  it('PC webgl: setHoverChildFocus rewrites the child table only when the key changes and only while there are children', async () => {
    const { WebGlVolumeRenderer } = await import('../../docs/webgl-volume.js'), p = WebGlVolumeRenderer.prototype;
    const self = { hoverChild: '', uniforms: {}, childArgs: {}, childTexture: {}, calls: 0, applyChildren() { this.calls++; } };
    p.setHoverChildFocus.call(self, 'k1'); expect(self.calls).toBe(1); p.setHoverChildFocus.call(self, 'k1'); expect(self.calls).toBe(1);
    p.setHoverChildFocus.call(self, ''); expect(self.calls).toBe(2); p.setHoverChildFocus.call(self, null); expect(self.calls).toBe(2);
    const none = { hoverChild: '', uniforms: {}, childArgs: null, childTexture: null, calls: 0, applyChildren() { this.calls++; } };
    p.setHoverChildFocus.call(none, 'k1'); expect(none.calls).toBe(0);
  });
  it('PC: the card of a child under the mouse lights ITS body (syncHoverFocus cut out of comment-3d.js); results as before', () => {
    const t = src('comment-3d.js'), i = t.indexOf('let hoverFocusRuns'), body = t.slice(i, t.indexOf('let hintEl', i));
    const mk = (key, items, mv) => {
      const f = new Function('labelFocus', 'alEls', 'regionOf', 'shownRegion', 'sceneState', body + '\n return {syncHoverFocus};');
      return f({ get: () => key }, { has: id => items.has(id) }, id => items.get(id), r => r.shown !== false, { medicalVolume: mv }).syncHoverFocus;
    };
    const log = [], mv = { setHoverFocus: r => log.push(['runs', r]), setHoverChildFocus: k => log.push(['child', k]) };
    const items = new Map([[-1, { child: {}, key: 'k1', label: {}, runsBySlice: 'cr' }], [5, { label: {}, runsBySlice: 'rr' }], [-2, { child: {}, key: 'k2', label: null }]]);
    mk('A:-1', items, mv)(); expect(log).toEqual([['child', 'k1']]); log.length = 0;
    mk('A:5', items, mv)(); expect(log).toEqual([['runs', 'rr']]); log.length = 0;
    mk('A:-2', items, mv)(); expect(log).toEqual([]); // a card without a label (not drawn) lights nothing
    mk(null, items, mv)(); expect(log).toEqual([]);
    expect(t).toContain("mv?.setHoverChildFocus?.(ck)");
  });
  it('PC: both cards of an overlap light (results and children are looked at separately: glowPairOf)', () => {
    const res = { id: 5, label: {}, segmentKeys: ['bone'], runsBySlice: 'R' }, ch = { id: -1, child: {}, label: {}, segmentKeys: ['bone'], runsBySlice: 'C' };
    const pick = { key: 'bone', x: 1, y: 1, z: 1 }, contains = () => true;
    expect(glowPairOf([res, ch], pick, contains)).toEqual([5, -1]);
    expect(glowPairOf([res], pick, contains)).toEqual([5, 0]); expect(glowPairOf([ch], pick, contains)).toEqual([0, -1]);
    expect(glowPairOf([res, ch], null, contains)).toEqual([0, 0]); expect(glowPairOf([res, ch], { ...pick, key: 'x' }, contains)).toEqual([0, 0]);
    expect(glowPairOf([res, ch], pick, (r) => r.runsBySlice === 'C')).toEqual([0, -1]); // the child's own runs decide
    expect(glowRegionOf([res, ch], pick, contains)).toBe(5); // the single rule is unchanged
    const t = src('comment-3d.js'); expect(t).toContain('glowPairOf(analysisLabelRegions(),hit,'); expect(t).toContain('childBoneGlow.settle(tokC,g[1])');
  });
});
