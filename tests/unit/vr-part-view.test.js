// (first prototype): a region / child segment taken out of the body (docs/vr-part-view.js) and its wiring in docs/vr-view.js.
// vr-view.js is not runnable here: the wiring is checked on its source, the rules run for real.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PART_GLSL, PART_CALL_SITES, hideIndexPlane, PART_OWN, PART_EXTRA, partUniforms, partTargetOf, partSame, regionSlotMask, patchRegionLut, patchChildLut, patchRegionLutMany, patchChildLutMany, anyHiddenIn, partBoundsOf, partProxyBox, partRayRange, partKeepVoxelOf, PART_TEXT, PART_BTN_X, PART_RESTORE_W, PART_OUT_M, PART_ANIM_MS } from '../../docs/vr-part-view.js';
import { regionLutAlpha, regionLutHiddenSlots } from '../../docs/region-visibility.js';
import { marchClassificationHitInfo } from '../../docs/vr-pick.js';
import { simpleMenuLayout } from '../../docs/event-mode.js';
import { ringState, regionRingItems, partRingItems, applyRingItem } from '../../docs/region-ring.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const menuSrc = readFileSync(new URL('../../docs/event-mode.js', import.meta.url), 'utf8');

describe('the shader block', () => {
  it('is compiled only with VRL_PART and takes over exactly the two "is this a hidden shape" functions', () => {
    expect(PART_GLSL).toContain('#ifdef VRL_PART');
    expect(PART_GLSL).toContain('#define regionHiddenAt(tc,s) regionHiddenAtP(tc,s)');
    expect(PART_GLSL).toContain('#define childHiddenAt(tc,s) childHiddenAtP(tc,s)');
    // nothing outside the guard: every line of the block sits inside #ifdef VRL_PART ... #endif
    const body = PART_GLSL.split('\n').filter(l => l.trim() && !l.startsWith('//'));
    expect(body[0]).toBe('#ifdef VRL_PART');
    expect(body[body.length - 1]).toBe('#endif');
    let depth = 0;
    for (const l of body) { if (/^#if/.test(l)) depth++; else if (/^#endif/.test(l)) depth--; expect(depth).toBeGreaterThanOrEqual(0); }
    expect(depth).toBe(0);
    // an earlier change: the part's own test goes by the hide index (G), as the body's hiding does
    expect(PART_GLSL).toContain('regionTex,clamp(tc,vec3(0.0),vec3(0.999999))).g*255.0');
    expect(PART_GLSL).toContain('childHideIdAt(tc)!=partId');
    expect(PART_GLSL).not.toContain('childIdAt(tc)');
    expect(PART_GLSL).not.toContain(').r*255.0');
    expect(PART_GLSL).not.toContain('`');
    expect(PART_GLSL).not.toContain('${');
  });
  it('the replaced functions are defined BEFORE the block and the block sits before the marching loops (so the loops see the re-pointed ones)', () => {
    const at = s => src.indexOf(s);
    const block = at('${PART_GLSL}');
    expect(block).toBeGreaterThan(0);
    expect(at('bool regionHiddenAt(vec3 tc,int s){')).toBeLessThan(block);
    expect(at('bool childHiddenAt(vec3 tc,int s){')).toBeLessThan(block);
    expect(at('#define VRL_HIDE')).toBeLessThan(block);
    // the an earlier change hide helpers come AFTER the block: hideAt / hideGrad (prevHid, hitHid, the far cut face) read the re-pointed functions, in the part's box and in the body
    expect(at('bool hideAnyOn(){')).toBeGreaterThan(block);
    expect(at('bool hideAt(vec3 tc,int s){')).toBeGreaterThan(block);
    expect(at('vec3 hideGrad(vec3 tc,int s){')).toBeGreaterThan(block);
    expect(block).toBeLessThan(at('void main(){\n gl_FragDepth=gl_FragCoord.z;'));
    // one splice only
    expect(src.split('${PART_GLSL}').length).toBe(2);
  });
  it('every call site the block takes over is still in the shader (a merge that renames one would make the part draw the whole body)', () => {
    for (const s of PART_CALL_SITES) expect(src.includes(s), s).toBe(true);
    // and the marching loops ask only through them: after the block, before main, the two functions are used only by hideAt (regionVis / childVis, defined before the block, read the body's own table by design: the part has no sections)
    const after = src.slice(src.indexOf('${PART_GLSL}'), src.indexOf('void main(){\n gl_FragDepth=gl_FragCoord.z;'));
    expect([...after.matchAll(/childHiddenAt\(/g)].length).toBe(1);
    expect([...after.matchAll(/regionHiddenAt\(/g)].length).toBe(1);
    const loops = src.slice(src.indexOf('void main(){\n gl_FragDepth=gl_FragCoord.z;'));
    const uses = [...loops.matchAll(/(regionHiddenAt|childHiddenAt)\(/g)].map(m => m[1]);
    expect(uses.filter(u => u === 'childHiddenAt').length).toBe(3); // the tight loop, the events loop, the general loop
    expect(uses.filter(u => u === 'regionHiddenAt').length).toBe(3);
  });
  it('the body\'s program text does not change: only the part\'s materials carry VRL_PART (one define in vr-view.js)', () => {
    expect((src.match(/VRL_PART:''/g) || []).length).toBe(1);
    expect(src).not.toMatch(/VRL_PART[^:']/.source.length ? /#define VRL_PART/ : /x/);
  });
});

describe('the hide index plane (an earlier change: the part goes by G)', () => {
  it('takes every second byte (G) of the RG8 index', () => {
    const rg = new Uint8Array([1, 9, 2, 0, 3, 7, 0, 5]);
    expect([...hideIndexPlane(rg)]).toEqual([9, 0, 7, 5]);
    expect(hideIndexPlane(null)).toBe(null);
  });
  it('the cut-out reads the plane of the kept RG array (P.region.rg / P.child.rg: the index has no ids field any more)', () => {
    expect(src).toContain('ids=hideIndexPlane(src?.rg)');
  });
});

describe('the part\'s uniforms', () => {
  const block = (() => { const i = src.indexOf('const volumeUniforms=(vd,full,settings)=>({'); const j = src.indexOf('// ---- GPU preparation before the session', i); return src.slice(i, j); })();
  const keys = [...block.matchAll(/(?:^|[,{ \n])([A-Za-z0-9]+):\{value:/g)].map(m => m[1]);
  it('the part owns only keys volumeUniforms makes, and its own extras are NOT in volumeUniforms (the body\'s uniform set, and the partner\'s classification, are untouched)', () => {
    for (const k of PART_OWN) expect(keys, k).toContain(k);
    for (const k of PART_EXTRA) expect(keys, k).not.toContain(k);
  });
  it('partUniforms: every key but the owned ones is the body\'s own object (by reference)', () => {
    const primary = Object.fromEntries(keys.map(k => [k, { value: 'p' + k }]));
    const own = Object.fromEntries([...PART_OWN, ...PART_EXTRA].map(k => [k, { value: 'o' + k }]));
    const u = partUniforms(primary, own);
    for (const k of keys) expect(u[k]).toBe(PART_OWN.includes(k) ? own[k] : primary[k]);
    for (const k of PART_EXTRA) expect(u[k]).toBe(own[k]);
    expect(Object.keys(u).length).toBe(keys.length + PART_EXTRA.length);
  });
});

describe('which part a pull-out takes', () => {
  const regions = [{ rid: 'r1', segMask: 1 }, { rid: 'r2', segMask: 2 }, { rid: 'r3' }], kids = [{ key: 'k1' }, { key: 'k2' }];
  it('a result: its 1-based id is the index texture\'s value', () => {
    expect(partTargetOf({ id: 2, childKey: '' }, regions, kids)).toEqual({ kind: 'region', index: 1, id: 2, rid: 'r2' });
  });
  it('a child segment (also where a result covers it: the child is the smaller, more specific thing)', () => {
    expect(partTargetOf({ id: 2, childKey: 'k2' }, regions, kids)).toEqual({ kind: 'child', index: 1, id: 2, key: 'k2' });
    expect(partTargetOf({ id: 0, childKey: 'k1' }, regions, kids)).toEqual({ kind: 'child', index: 0, id: 1, key: 'k1' });
  });
  it('nothing: no hit, no region / child under the laser, an unknown child, an id past the list', () => {
    expect(partTargetOf(null, regions, kids)).toBeNull();
    expect(partTargetOf({ id: 0, childKey: '' }, regions, kids)).toBeNull();
    expect(partTargetOf({ id: 9, childKey: '' }, regions, kids)).toBeNull();
    expect(partTargetOf({ id: 0, childKey: 'nope' }, regions, kids)).toBeNull();
  });
  it('the same target is recognised (by kind, id and its own name)', () => {
    const a = partTargetOf({ id: 1 }, regions, kids), b = partTargetOf({ id: 1 }, regions, kids), c = partTargetOf({ id: 2 }, regions, kids);
    expect(partSame(a, b)).toBe(true); expect(partSame(a, c)).toBe(false); expect(partSame(a, null)).toBe(false);
  });
  it('a result\'s slot bits: the prepared mask, else from its segment keys in the runtime slot order (the rule of refreshRegionLut)', () => {
    expect(regionSlotMask({ segMask: 5 }, ['a', 'b', 'c'])).toBe(5);
    expect(regionSlotMask({ segmentKeys: ['c', 'a', 'zz'] }, ['a', 'b', 'c'])).toBe(5);
    expect(regionSlotMask({}, ['a'])).toBe(0);
  });
});

describe('the look-up tables: the body loses the target, the part keeps it as it looks', () => {
  it('result table: the body\'s texel gets the hide bits of the part\'s slots and no colour bits; the part\'s copy has the colour bits and no hide bits; every other texel is as it was in both', () => {
    const a = new Float32Array(256 * 4), out = new Float32Array(256 * 4);
    for (let i = 1; i < 6; i++) { a[4 * i] = i / 10; a[4 * i + 3] = regionLutAlpha(1 << (i % 4), { shown: true }); }
    const before = a.slice();
    expect(patchRegionLut(a, out, 2, 0b0101, true)).toBe(true); // list index 2 = texel 3
    expect(a[4 * 3 + 3]).toBe(0b0101 << 8);
    expect(regionLutHiddenSlots(a[4 * 3 + 3])).toBe(0b0101);
    expect(out[4 * 3 + 3]).toBe(0b0101);
    expect(regionLutHiddenSlots(out[4 * 3 + 3])).toBe(0);
    for (let i = 0; i < 256; i++) if (i !== 3) for (let k = 0; k < 4; k++) { expect(a[4 * i + k]).toBe(before[4 * i + k]); expect(out[4 * i + k]).toBe(before[4 * i + k]); }
    expect(a[4 * 3]).toBe(before[4 * 3]); expect(out[4 * 3]).toBe(before[4 * 3]); // the colour itself stays
  });
  it('result table: a result whose colour is OFF comes out in the tissue\'s own colour (no colour bits) in the part too, and the body still hides it', () => {
    const a = new Float32Array(256 * 4), out = new Float32Array(256 * 4);
    patchRegionLut(a, out, 0, 3, false);
    expect(out[3 + 4 * 1 - 4 + 4]).toBe(0); // texel 1, alpha
    expect(a[4 + 3]).toBe(3 << 8);
  });
  it('result table: an index past the table is refused (nothing is written to the body\'s table)', () => {
    const a = new Float32Array(256 * 4), out = new Float32Array(256 * 4);
    expect(patchRegionLut(a, out, 255, 1, true)).toBe(false);
    expect(a.every(v => v === 0)).toBe(true);
  });
  it('child table: the body\'s row 1 hides the child on its parent slot and its colour bits go; the part\'s copy shows it with its colour (or none when its colour is off)', () => {
    const R = 1024, a = new Float32Array(256 * 12), out = new Float32Array(256 * 12);
    a[R + 4 * 2 + 2] = 7; a[2 * R + 4 * 2] = 0.3; a[4 * 2] = 0.9; // child 1 (texel 2): a flat mask, a material, a colour
    patchChildLut(a, out, 1, 0b10, true);
    expect(a[4 * 2 + 3]).toBe(0); expect(a[R + 4 * 2 + 3]).toBe(0b10);
    expect(out[4 * 2 + 3]).toBe(0b10); expect(out[R + 4 * 2 + 3]).toBe(0);
    expect(a[R + 4 * 2 + 2]).toBe(7); expect(out[R + 4 * 2 + 2]).toBe(7); expect(a[2 * R + 4 * 2]).toBeCloseTo(0.3, 6); expect(out[4 * 2]).toBeCloseTo(0.9, 6);
    patchChildLut(a, out, 1, 0b10, false);
    expect(out[4 * 2 + 3]).toBe(0);
  });
  it('anyHiddenIn: the uniform regionAnyHidden of a table', () => {
    const a = new Float32Array(256 * 4);
    expect(anyHiddenIn(a, 5)).toBe(0);
    a[4 * 3 + 3] = 2 << 8; expect(anyHiddenIn(a, 5)).toBe(1); expect(anyHiddenIn(a, 2)).toBe(0);
    a[4 * 3 + 3] = 5; expect(anyHiddenIn(a, 5)).toBe(0); // colour bits are not hide bits
  });
  it('the patch is applied after the tables are written, by one new line in each refresh (the existing hidden / hid expressions are not touched)', () => {
    const r = src.slice(src.indexOf(' const refreshRegionLut=()=>{'), src.indexOf(' const hlTracker='));
    expect(r).toContain('partPatchRegion(a)');
    expect(r.indexOf('partPatchRegion(a)')).toBeGreaterThan(r.indexOf('regionList.forEach('));
    expect(r.indexOf('partPatchRegion(a)')).toBeLessThan(r.indexOf('regionLut.needsUpdate=true'));
    expect(r).toContain('hidden:regionHiddenVr(e.rid)'); // the existing expression, unchanged
    const c = src.slice(src.indexOf(' const refreshChildLut=()=>{'), src.indexOf(' const msets=new Map()'));
    expect(c).toContain('partPatchChild(a)');
    expect(c.indexOf('partPatchChild(a)')).toBeGreaterThan(c.indexOf('childList.forEach('));
    expect(c.indexOf('partPatchChild(a)')).toBeLessThan(c.indexOf('lut.needsUpdate=true'));
    expect(c).toContain('hid=!en.shown'); // unchanged
  });
});

describe('the part\'s own box', () => {
  // a 4 x 3 x 2 grid, x fastest: the target (id 7) at voxels (1,1,0) and (2,2,1)
  const dims = [4, 3, 2], ids = new Uint8Array(24);
  const at = (x, y, z) => x + 4 * (y + 3 * z);
  ids[at(1, 1, 0)] = 7; ids[at(2, 2, 1)] = 7; ids[at(0, 0, 0)] = 3;
  it('covers exactly the voxels of the id (pad 0), in object space: x right, y UP (the texture\'s y runs down), z', () => {
    const b = partBoundsOf(ids, dims, 7, [2, 1.5, 1], 0);
    expect(b.count).toBe(2);
    // x: voxels 1..2 of 4 -> [-0.5, 1.0] * 2 ... in object units: (1/4-0.5)*4 = -1 .. (3/4-0.5)*4 = 1
    expect(b.c[0]).toBeCloseTo(0, 12); expect(b.h[0]).toBeCloseTo(1, 12);
    // y: voxel rows 1..2 of 3 -> tc [1/3, 1] -> y = (0.5 - tc) * 3 -> [-1.5, 0.5]
    expect(b.c[1]).toBeCloseTo(-0.5, 12); expect(b.h[1]).toBeCloseTo(1, 12);
    // z: slices 0..1 of 2 -> the whole depth
    expect(b.c[2]).toBeCloseTo(0, 12); expect(b.h[2]).toBeCloseTo(1, 12);
  });
  it('the pad grows it (clamped to the data box), the box of a single voxel is that voxel plus the pad', () => {
    const one = new Uint8Array(8 * 8 * 8); one[3 + 8 * (4 + 8 * 5)] = 9;
    const b0 = partBoundsOf(one, [8, 8, 8], 9, [4, 4, 4], 0), b2 = partBoundsOf(one, [8, 8, 8], 9, [4, 4, 4], 2);
    expect(b0.h).toEqual([0.5, 0.5, 0.5]);
    expect(b2.h[0]).toBeCloseTo(0.5 + 2, 12);
    const edge = new Uint8Array(8 * 8 * 8); edge[0] = 9;
    const be = partBoundsOf(edge, [8, 8, 8], 9, [4, 4, 4], 2);
    expect(be.c[0] - be.h[0]).toBeCloseTo(-4, 12); // clamped at the box's face
  });
  it('an id nothing has: null (the target is gone); no data: null', () => {
    expect(partBoundsOf(ids, dims, 99, [1, 1, 1])).toBeNull();
    expect(partBoundsOf(null, dims, 7, [1, 1, 1])).toBeNull();
  });
  it('the box of the whole grid is full', () => {
    expect(partBoundsOf(new Uint8Array(8).fill(4), [2, 2, 2], 4, [1, 2, 3], 0).full).toBe(true);
  });
});

describe('the laser\'s rule on the part (the shader\'s keep-only rule on the CPU)', () => {
  const w = 8, h = 4, d = 4, n = w * h * d, ids = new Uint8Array(n), data = new Uint8Array(n * 4);
  const at = (x, y, z) => x + w * (y + h * z);
  // channel 0 (slot 0) tissue everywhere; id 1 = x in 2..3, id 2 = x in 5..6
  for (let k = 0; k < n; k++) data[k * 4] = 200;
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) { ids[at(2, y, z)] = ids[at(3, y, z)] = 1; ids[at(5, y, z)] = ids[at(6, y, z)] = 2; }
  const chan = [0, -1, -1, -1], cls = { data, C: 4, chan };
  const ray = (skip, ox = -5) => marchClassificationHitInfo({ x: ox, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, [4, 2, 2], [w, h, d], cls, [0], [], 0, 0, 0, Infinity, skip);
  it('a voxel that is not the target is skipped; the first target voxel on the ray is the hit', () => {
    const keep1 = partKeepVoxelOf({ ids, idims: [w, h, d], cdims: [w, h, d], id: 1, mask: 1, chan });
    expect(keep1(0, 0, 0, 0)).toBe(true); expect(keep1(2, 0, 0, 0)).toBe(false);
    expect(ray(keep1).x).toBe(2);
    const keep2 = partKeepVoxelOf({ ids, idims: [w, h, d], cdims: [w, h, d], id: 2, mask: 1, chan });
    expect(ray(keep2).x).toBe(5);
    expect(ray(keep2, 5.9)).toBeNull(); // past it
  });
  it('a voxel of the target on a slot the target does not belong to is not part of it (a result is the shape of ITS segments\' tissue only)', () => {
    const keep = partKeepVoxelOf({ ids, idims: [w, h, d], cdims: [w, h, d], id: 1, mask: 0b10, chan });
    expect(keep(2, 0, 0, 0)).toBe(true);
    expect(ray(keep)).toBeNull();
  });
  it('another grid size: the voxel is mapped by position', () => {
    const keep = partKeepVoxelOf({ ids, idims: [w, h, d], cdims: [16, 8, 8], id: 1, mask: 1, chan });
    expect(keep(4, 0, 0, 0)).toBe(false); expect(keep(7, 0, 0, 0)).toBe(false); expect(keep(8, 0, 0, 0)).toBe(true); expect(keep(3, 0, 0, 0)).toBe(true);
  });
  it('the body no longer picks the target once its table hides it: the hidden-shape rule of vr-pick reads the patched table', async () => {
    const { hiddenRegionVoxelOf } = await import('../../docs/region-visibility.js');
    const a = new Float32Array(256 * 4), out = new Float32Array(256 * 4);
    a[4 * 1 + 3] = regionLutAlpha(1, { shown: true }); a[4 * 2 + 3] = regionLutAlpha(1, { shown: true });
    expect(hiddenRegionVoxelOf(ids, [w, h, d], a, chan)).toBeNull(); // nothing hidden: nothing to skip
    patchRegionLut(a, out, 0, 1, true);
    const hid = hiddenRegionVoxelOf(ids, [w, h, d], a, chan);
    expect(hid(2, 0, 0, 0)).toBe(true); expect(hid(5, 0, 0, 0)).toBe(false);
    expect(ray(null, -2).x).toBe(2); expect(ray(hid, -2).x).toBe(4); // from inside the box: before the patch the laser meets the result, after it goes through it to the next tissue
  });
});

describe('the wiring in the menu and the session', () => {
  it('the texts exist in both languages with the same keys', () => {
    expect(Object.keys(PART_TEXT.ja).sort()).toEqual(Object.keys(PART_TEXT.en).sort());
    for (const k of Object.keys(PART_TEXT.ja)) { expect(PART_TEXT.ja[k].length).toBeGreaterThan(0); expect(PART_TEXT.en[k].length).toBeGreaterThan(0); }
  });
  it('the grip stays the body\'s grab: the part\'s grip is tried first and only for a laser that meets a part nearer than the body', () => {
    expect(src).toContain('if(partGripStart(c))return;');
    const gs = src.slice(src.indexOf(' const gripStart=c=>{'), src.indexOf(' const gripKind='));
    expect(gs.indexOf('partGripStart(c)')).toBeLessThan(gs.indexOf('if(!gripOnVolume(c))return false;'));
    expect(gs.indexOf('partGripStart(c)')).toBeGreaterThan(gs.indexOf('boardHits(c).hu'));
    const ge = src.slice(src.indexOf(' const gripEnd=c=>{'), src.indexOf(' for(const c of controllers){\n  for(const t of [\'selectstart\''));
    expect(ge).toContain('partGripEnd(c)');
  });
  it('everything goes back with the data: a data switch, the reset, the unbind, a pair, the child list change, the session end', () => {
    for (const needle of ['partRestoreAll(', 'partDispose(']) expect(src).toContain(needle);
    const sw = src.slice(src.indexOf(' swapData=async setId=>{'), src.indexOf('vrHold(true);const gen=swapGuard.next()'));
    expect(sw).toContain('partDispose(');
    const ub = src.slice(src.indexOf(' const unbindData=()=>{'), src.indexOf(' const dropWarmRefs='));
    expect(ub).toContain('partRestoreAll(');
    const rs = src.slice(src.indexOf(' const resetToStart=()=>{'), src.indexOf(' const pressReset='));
    expect(rs).toContain('partRestoreAll(');
    const cl = src.slice(src.indexOf(' const cleanup=()=>{'), src.indexOf(' const cleanup=()=>{') + 900);
    expect(cl).toContain('partDispose();renderer.setAnimationLoop(null)');
    const cs = src.slice(src.indexOf(' syncChildSegments=()=>{'), src.indexOf(' // binds the prepared data Pn'));
    expect(cs).toContain('partDispose(');
    const bp = src.slice(src.indexOf(' const bindPair=async('), src.indexOf(' const bindPair=async(') + 400);
    expect(bp).toContain('partRestoreAll(');
  });
  it('nothing is drawn, uploaded or compiled while no part is out: every frame hook returns at once on an empty list', () => {
    for (const fn of ['partPose', 'partFrame', 'partRender', 'partPatchRegion', 'partPatchChild', 'partRestoreAll']) {
      const i = src.indexOf('   ' + fn + '=');
      expect(i, fn).toBeGreaterThan(0);
      expect(src.slice(i, i + 160), fn).toMatch(/if\(!parts\.length\)return/);
    }
    expect(src).toContain(' let parts=[],partPatchRegion=');
    expect(src).not.toMatch(/\bpm\b[.?]/); // the one-part state is gone
  });

});

describe('すべて元に戻す: one button in the header, no list row gives up its room', () => {
  const text = { show: 'Show', hide: 'Hide', color: '色', shape: '表示', section: '断面', sliceOpacity: '不透明度', scale: '拡大率', trigger: 'モード', trigPoint: 'P', trigLabel: 'L', trigHintPoint: 'hp', trigHintLabel: 'hl', results: '解析結果', kids: 'セグメント', total: '合計', page: 'ページ', noSeg: 'なし', home: '正面', undo: '戻', reset: 'リセット', resetAgain: 'もう一度', all: '設定', exit: '終了' };
  const board = (nr, nk) => simpleMenuLayout({ segments: ['bone', 'soft', 'fat', 'lung'].map(k => ({ key: k, name: k, color: '#fff', on: true })), sectionOn: true, scale: { pos: 0.3, text: 'x1', locked: false }, trigger: { show: true, label: false },
    results: Array.from({ length: nr }, (_, i) => ({ hex: '#fff', name: 'r' + i, text: '1 mm³' })), kids: Array.from({ length: nk }, (_, i) => ({ hex: '#fff', name: 'k' + i })), total: '1', showAll: { n: 0, label: 'すべて表示' },
    levels: { items: [{ id: 'a', label: 'A', on: true }, { id: 'b', label: 'B' }], busy: false, hint: '', text: { title: 'データ', again: 'again' } }, pair: { label: 'pair', on: false, busy: false }, text });
  it('the かんたん board is the board of before: event-mode.js is not changed (the real boards are already tight)', () => {
    for (const [nr, nk] of [[4, 0], [12, 5], [8, 1], [0, 40]]) expect(board(nr, nk).some(x => /^detach:/.test(x.id || ''))).toBe(false);
    expect(menuSrc).not.toMatch(/detach/);
  });
  it('it sits between the title (ends near x 400) and 「閉じる」 (x 780) in the header row (y 18, 72 px like 閉じる), over nothing of the board; the 取り出す button is gone (the ring does it)', () => {
    expect(PART_BTN_X).toBeGreaterThanOrEqual(400);
    expect(PART_BTN_X + PART_RESTORE_W).toBeLessThanOrEqual(780);
    for (const [nr, nk] of [[4, 0], [12, 5]]) for (const o of board(nr, nk)) if (o.type !== 'label') expect(o.y, o.id).toBeGreaterThanOrEqual(90);
    expect(src).toMatch(/btn\(PART_BTN_X,18,PART_RESTORE_W,dm\.text\.restore,false,\(\)=>partRestorePress\(\)/);
    expect(src).not.toContain('partArmPress'); expect(src).not.toContain('PART_ARM_W');
  });
  it('drawn on every page of both menus, except where 「かんたん」 sits in the same place (the full menu of 体験会モード); only with results / child segments (or a part out); disabled while nothing is out', () => {
    expect(src).toContain('if(dm&&!(evMenu&&ui.tab!==10))btn(PART_BTN_X');
    expect(src).toContain('disabled:!dm.active||dm.busy');
    expect(src).toContain('partMenuInfo=()=>regionList.length||childList.length||parts.length?{active:parts.length>0,busy:partBusy,text:{restore:PT.restore}}:null;');
    const hdr = src.slice(src.indexOf("btn(780,18,200,L.close,false,()=>setMenuOpen(false),{size:28});"), src.indexOf('// tabs\n'));
    expect(hdr).toContain("btn(560,18,200,tr('evSimple')");
  });
});

describe('several parts at once', () => {
  const entry = (rid, mask) => ({ rid, segMask: mask });
  it('result table: every part\'s target is hidden in the body and keeps its colour in the parts\' ONE copy; adding a part and taking one back is a re-patch of the normal table', () => {
    const base = new Float32Array(256 * 4);
    for (let i = 1; i <= 5; i++) { base[4 * i] = i / 10; base[4 * i + 3] = regionLutAlpha(1 << (i % 4), { shown: true }); }
    const patch = parts => { const a = base.slice(), out = new Float32Array(256 * 4), n = patchRegionLutMany(a, out, parts.map(([i, m]) => ({ i, mask: m, colorShown: true }))); return { a, out, n }; };
    const p3 = patch([[0, 1], [2, 4], [3, 8]]);
    expect(p3.n).toBe(3);
    for (const [i, m] of [[0, 1], [2, 4], [3, 8]]) { expect(regionLutHiddenSlots(p3.a[4 * (i + 1) + 3])).toBe(m); expect(regionLutHiddenSlots(p3.out[4 * (i + 1) + 3])).toBe(0); expect(p3.out[4 * (i + 1) + 3]).toBe(m); }
    for (const i of [2, 5]) expect(p3.a[4 * i + 3]).toBe(base[4 * i + 3]); // the others are the normal table
    expect(anyHiddenIn(p3.out, 5)).toBe(0); expect(anyHiddenIn(p3.a, 5)).toBe(1);
    // one part put back: the table is patched again for the two that stay; the put-back one is the normal entry again
    const p2 = patch([[0, 1], [3, 8]]);
    expect(p2.a[4 * 3 + 3]).toBe(base[4 * 3 + 3]); expect(regionLutHiddenSlots(p2.a[4 * 1 + 3])).toBe(1);
    // all put back: the table is the normal one, bit for bit
    const p0 = patch([]); expect(p0.n).toBe(0); expect(Array.from(p0.a)).toEqual(Array.from(base));
  });
  it('child table: the same for children (row 0 colour bits, row 1 hidden mask), and out-of-range entries are skipped', () => {
    const R = 1024, base = new Float32Array(256 * 12);
    for (let j = 0; j < 3; j++) { base[(j + 1) * 4 + 3] = 1; base[R + (j + 1) * 4 + 2] = 5; }
    const a = base.slice(), out = new Float32Array(256 * 12);
    expect(patchChildLutMany(a, out, [{ j: 0, mask: 1, colorOn: true }, { j: 2, mask: 2, colorOn: false }, { j: 300, mask: 1, colorOn: true }])).toBe(2);
    expect(a[R + 4 * 1 + 3]).toBe(1); expect(a[4 * 1 + 3]).toBe(0); expect(out[R + 4 * 1 + 3]).toBe(0); expect(out[4 * 1 + 3]).toBe(1);
    expect(out[4 * 3 + 3]).toBe(0); expect(a[R + 4 * 3 + 3]).toBe(2); expect(a[R + 4 * 2 + 3]).toBe(0); // child 1 untouched
    expect(a[R + 4 * 1 + 2]).toBe(5); // other rows are as they were
  });
  it('the single-part functions are the many-part ones with one target', () => {
    const a1 = new Float32Array(256 * 4), o1 = new Float32Array(256 * 4), a2 = a1.slice(), o2 = o1.slice();
    patchRegionLut(a1, o1, 3, 5, true); patchRegionLutMany(a2, o2, [{ i: 3, mask: 5, colorShown: true }]);
    expect(Array.from(a1)).toEqual(Array.from(a2)); expect(Array.from(o1)).toEqual(Array.from(o2));
  });
  it('every part has its own bounding box: the voxels of ITS id only', () => {
    const dims = [16, 16, 16], ids = new Uint8Array(16 * 16 * 16), at = (x, y, z) => x + 16 * (y + 16 * z);
    for (let z = 2; z < 5; z++) for (let y = 3; y < 6; y++) for (let x = 1; x < 4; x++) ids[at(x, y, z)] = 1;
    for (let z = 10; z < 14; z++) for (let y = 8; y < 12; y++) for (let x = 9; x < 15; x++) ids[at(x, y, z)] = 2;
    const he = [8, 8, 8], b1 = partBoundsOf(ids, dims, 1, he, 0), b2 = partBoundsOf(ids, dims, 2, he, 0);
    expect(b1.count).toBe(27); expect(b2.count).toBe(96);
    expect(b1.h).toEqual([1.5, 1.5, 1.5]); expect(b2.h[0]).toBeCloseTo(3, 12); expect(b2.h[1]).toBeCloseTo(2, 12); expect(b2.h[2]).toBeCloseTo(2, 12);
    expect(b1.c[0]).not.toBeCloseTo(b2.c[0], 3);
    const k1 = partKeepVoxelOf({ ids, idims: dims, cdims: dims, id: 1, mask: 1, chan: [0, -1, -1, -1] }), k2 = partKeepVoxelOf({ ids, idims: dims, cdims: dims, id: 2, mask: 1, chan: [0, -1, -1, -1] });
    expect(k1(2, 4, 3, 0)).toBe(false); expect(k2(2, 4, 3, 0)).toBe(true); expect(k2(10, 9, 11, 0)).toBe(false); expect(k1(10, 9, 11, 0)).toBe(true);
  });
  it('the proxy box (what the GPU rasterises) is the content box grown by a few voxels, clamped to the data box: far smaller than the whole box for a small part', () => {
    const he = [4, 4, 4], dims = [64, 64, 64], box = { c: [0, 0, 0], h: [0.25, 0.25, 0.25] };
    const p = partProxyBox(box, he, dims, 4), v = 2 * 4 / 64;
    expect(p.h[0]).toBeCloseTo(0.25 + 4 * v, 12); expect(p.c).toEqual([0, 0, 0]);
    const edge = partProxyBox({ c: [3.8, 0, 0], h: [0.2, 0.2, 0.2] }, he, dims, 4);
    expect(edge.c[0] + edge.h[0]).toBeCloseTo(4, 12); // clamped at the data box's face
    // the rays a part runs: the proxy's silhouette is a tiny share of the full box's
    const share = (p.h[0] * p.h[1]) / (he[0] * he[1]); expect(share).toBeLessThan(0.05);
    expect(partProxyBox({ c: [0, 0, 0], h: [4, 4, 4] }, he, dims, 4).h).toEqual([4, 4, 4]); // a part as big as the data: the full box
  });
  it('the laser march of a part runs only inside its box: partRayRange', () => {
    const box = { c: [1, 0, 0], h: [0.5, 0.5, 0.5] };
    expect(partRayRange({ x: -5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toEqual([5.5, 6.5]);
    expect(partRayRange({ x: -5, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBeNull(); // misses
    expect(partRayRange({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, box)).toEqual([0, 0.5]); // starts inside
    expect(partRayRange({ x: 3, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, box)).toEqual([1.5, 2.5]);
    expect(partRayRange({ x: -5, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, box)).toBeNull(); // pointing away
  });
  it('the part\'s box is its own: the proxy geometry is made per part from its box, never the body\'s box; its programs are shared', () => {
    expect(src).toContain('const geo=new THREE.BoxGeometry(2*prox.h[0]/he[0],2*prox.h[1]/he[1],2*prox.h[2]/he[2]);geo.translate(prox.c[0]/he[0],prox.c[1]/he[1],prox.c[2]/he[2]);');
    expect(src).toContain('const m=new THREE.Mesh(geo,mats.vars[partFull()])');
    expect(src).toContain('const r=new THREE.Mesh(geo,mats.rays[partFull()])');
    expect(src).not.toMatch(/new THREE\.Mesh\(meshObj\.geometry,(mats|res\.|q\.)/); // no part is drawn on the body's box
    expect(src).toContain('u.boxEntry'.slice(0, 0) + 'boxEntry:{value:1}'); // the march starts at the content box
    expect(src).toContain('partFree=q=>{partHide(q);q.held=null;'); expect(src).toContain('q.geo.dispose()');
    expect(src).toContain('partMaterials=own=>'); // one material set per part, the compiled programs shared (template compiled once)
    expect((src.match(/compileVariantPrograms\(renderer,wanted/g) || []).length).toBe(1);
  });
  it('every part has its own grip: a hand holds one part; the laser takes the NEAREST part that is not held and is nearer than the body', () => {
    expect(src).toContain('const u=c.userData,ph=partHitOf(c,true);if(!ph)return false;');
    expect(src).toContain('if(vh&&vh.distance<=ph.distance)return false;');
    expect(src).toContain('partHold(ph.part,c);pulse(c);return true;');
    expect(src).toContain('if(hi&&(!best||hi.t<best.distance))best={part:q,distance:hi.t};');
    expect(src).toContain('partGripEnd=c=>{let r=false;for(const q of parts)if(q.held?.c===c){q.held=null;');
  });
  it('a part that was cut out starts where the target is, comes PART_OUT_M toward the viewer and glides there; a grip stops the glide', () => {
    expect(PART_OUT_M).toBeGreaterThan(0); expect(PART_OUT_M).toBeLessThanOrEqual(0.1); expect(PART_ANIM_MS).toBeGreaterThan(0);
    expect(src).toContain('const to=apos.clone().addScaledVector(partV.subVectors(head,apos).normalize(),PART_OUT_M);');
    expect(src).toContain('anim:{from:apos.clone(),to,t0:performance.now()}');
    expect(src).toContain('const partHold=(q,c)=>{const a=holdOf(c);q.anim=null;');
  });
  it('a second cut-out of the same target is refused; one at a time while the programs prepare; none while a pair is shown', () => {
    expect(src).toContain('if(parts.some(q=>partSame(q.target,tg)))return false;');
    expect(src).toContain('if(partBusy){flashMsg(PT.busy,2500);return false}');
    expect(src).toContain("if(pair?.on){flashMsg(PT.pairBusy,3000);return false}");
  });
  it('個別の戻し / 全部戻し: one part back = its own free + a re-patch of the tables; all back = every part freed, the tables are the normal ones', () => {
    expect(src).toContain('parts.splice(i,1);partFree(q);');
    expect(src).toContain('const all=parts.splice(0);for(const q of all)partFree(q);');
    const one = src.slice(src.indexOf('const partRestoreOne=q=>{'), src.indexOf('   partRestoreAll=()=>{'));
    expect(one).toContain('refreshRegionLut();refreshChildLut()');
    const all = src.slice(src.indexOf('   partRestoreAll=()=>{'), src.indexOf('   partDispose=()=>{'));
    expect(all).toContain('refreshRegionLut();refreshChildLut()');
  });
});

describe('the ring: 切り出す on the laser\'s target, 戻す on a part', () => {
  const ringSrc = readFileSync(new URL('../../docs/region-ring.js', import.meta.url), 'utf8');
  it('a long press on a part opens its ring BEFORE the body\'s rules (a part nearer than the body\'s hit); the point ring and the body\'s region ring are as before', () => {
    const up = src.slice(src.indexOf(' const updatePress=(c,now)=>{'), src.indexOf(' const updatePress=(c,now)=>{') + 1500);
    expect(up.indexOf('partRingStart(c,pr.res)')).toBeGreaterThan(0);
    expect(up.indexOf('partRingStart(c,pr.res)')).toBeLessThan(up.indexOf("else if(pr.res.kind==='point')"));
    expect(up).toContain("else if(pr.res.kind==='record'||pr.res.kind==='label'||pr.res.kind==='tissue'){");
    const rs = src.slice(src.indexOf('partRingStart=(c,res)=>{'), src.indexOf('partBackPress=uid=>'));
    expect(rs).toContain("if(k!=='record'&&k!=='label'&&k!=='tissue'&&k!=='empty'&&k!=='none')return false;");
    expect(rs).toContain('if(Number.isFinite(bd)&&bd<ph.distance)return false;'); // the body's hit is nearer: the body's ring
  });
  it('切り出す is the target the laser was on, as it is: the ring was opened on it, nothing is chosen again, no arm', () => {
    expect(src).toContain('detachRegion:g=>{partDetachRing(g,null);return true},detachChild:key=>{partDetachRing(null,childByKey(key));return true}');
    expect(src).toContain('partDetachRing=(reg,child)=>{void partDetach(partTargetOfRing(reg,child))};');
    expect(src).toContain('const i=regionList.findIndex(e=>e.rid===reg.id);');
    // region = the region's own item (top half), child = the child's (bottom half)
    const calls = [];
    const ops = { detachRegion: r => { calls.push(['r', r.id]); return true; }, detachChild: k => { calls.push(['c', k]); return true; } };
    expect(applyRingItem('rdetach', { reg: { id: 7 }, child: { key: 'k1' } }, ops)).toBe(true);
    expect(applyRingItem('cdetach', { reg: { id: 7 }, child: { key: 'k1' } }, ops)).toBe(true);
    expect(calls).toEqual([['r', 7], ['c', 'k1']]);
    expect(applyRingItem('rdetach', { reg: null, child: { key: 'k1' } }, ops)).toBe(false); // no region there
    expect(applyRingItem('cdetach', { reg: { id: 7 }, child: null }, ops)).toBe(false);
    expect(applyRingItem('rdetach', { reg: { id: 7 } }, {})).toBe(false); // an old caller without the op
  });
  it('the part\'s ring has one item, 戻す; it puts back that part only', () => {
    const items = partRingItems({ back: '戻す' });
    expect(items).toEqual([{ id: 'pback', label: '戻す', on: false, enabled: true }]);
    let n = 0; expect(applyRingItem('pback', {}, { partBack: () => { n++; return true; } })).toBe(true); expect(n).toBe(1);
    expect(src).toContain('const partUid=pw.partUid;closePointWheel();');
    expect(src).toContain('partBack:()=>partBackPress(partUid)');
    expect(src).toContain("pw={c,kind:'region',id:null,rid:0,childKey:'',partUid:ph.part.uid,mode:'main',items,name:''};");
    expect(src).toContain('partBackPress=uid=>{const q=parts.find(x=>x.uid===uid);return q?partRestoreOne(q):false};');
  });
  it('切り出す is dark while a pair is shown (the ring item is disabled and the stick skips it)', () => {
    const text = { color: 'c', shape: 's', detach: 'd', regionColor: 'rc', regionShape: 'rs', regionDetach: 'rd', childColor: 'cc', childShape: 'cs', childDetach: 'cd' };
    for (const st of [ringState({ id: 1 }, null), ringState(null, { key: 'a' }), ringState({ id: 1 }, { key: 'a' })]) {
      expect(regionRingItems(st, text, false).filter(i => /detach/.test(i.id)).every(i => i.enabled === false)).toBe(true);
      expect(regionRingItems(st, text, false).filter(i => !/detach/.test(i.id)).every(i => i.enabled === true)).toBe(true);
      expect(regionRingItems(st, text).every(i => i.enabled === true)).toBe(true);
    }
    expect(src).toContain('ringText(),!pair?.on);');
    expect(src).toContain("pw.kind==='region'?pw.items.map(i=>i.enabled!==false):pwIds().map(()=>true),pw.kind==='region'&&(pw.items.length===3||pw.items.length===6)");
  });
  it('the existing 色 / 表示 items act as before (the two flags, the stick press); 切り出す writes no flag', () => {
    const calls = [];
    const ops = { setRegionVisible: (r, on) => { calls.push(['rv', on]); return true; }, setRegionHidden: (r, on) => { calls.push(['rh', on]); return true; }, setChildLook: (k, o) => { calls.push(['cl', k, o]); return true; }, detachRegion: () => true, detachChild: () => true };
    applyRingItem('rcolor', { reg: { id: 1, visible: true } }, ops); applyRingItem('rshape', { reg: { id: 1 } }, ops); applyRingItem('cshape', { child: { key: 'a', visible: true } }, ops);
    applyRingItem('rdetach', { reg: { id: 1 } }, ops); applyRingItem('cdetach', { child: { key: 'a' } }, ops);
    expect(calls).toEqual([['rv', false], ['rh', true], ['cl', 'a', { visible: false }]]);
  });
  it('the words: 切り出す / 戻す in both languages, no emoji', () => {
    for (const l of ['ja', 'en']) for (const k of ['ringDetach', 'ringRegionDetach', 'ringChildDetach', 'ringBack']) { expect(PART_TEXT[l][k]).toBeTruthy(); expect(PART_TEXT[l][k]).not.toMatch(/\p{Extended_Pictographic}/u); }
    expect([PART_TEXT.ja.ringDetach, PART_TEXT.ja.ringRegionDetach, PART_TEXT.ja.ringChildDetach, PART_TEXT.ja.ringBack]).toEqual(['切り出す', '領域の切り出す', '子の切り出す', '戻す']);
    expect(ringSrc).toContain("'pback'");
  });
});
