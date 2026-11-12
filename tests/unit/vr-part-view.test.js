// (first prototype): a region / child segment taken out of the body (docs/vr-part-view.js) and its wiring in docs/vr-view.js.
// vr-view.js is not runnable here: the wiring is checked on its source, the rules run for real.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PART_GLSL, PART_CALL_SITES, PART_OWN, PART_EXTRA, partUniforms, partTargetOf, partSame, regionSlotMask, patchRegionLut, patchChildLut, anyHiddenIn, partBoundsOf, partKeepVoxelOf, armPress, armed, ARM_MS, PART_TEXT, PART_BTN_X, PART_ARM_W, PART_BTN_GAP, PART_RESTORE_W } from '../../docs/vr-part-view.js';
import { regionLutAlpha, regionLutHiddenSlots } from '../../docs/region-visibility.js';
import { marchClassificationHitInfo } from '../../docs/vr-pick.js';
import { simpleMenuLayout } from '../../docs/event-mode.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const menuSrc = readFileSync(new URL('../../docs/event-mode.js', import.meta.url), 'utf8');

describe('the shader block', () => {
  it('is compiled only with VRL_PART and takes over exactly the two "is this a hidden shape" functions', () => {
    expect(PART_GLSL).toContain('#ifdef VRL_PART');
    expect(PART_GLSL).toContain('#define regionHiddenAt(tc,s) regionHiddenAtP(tc,s)');
    expect(PART_GLSL).toContain('#define childHiddenAt(tc,s,e) childHiddenAtP(tc,s,e)');
    // nothing outside the guard: every line of the block sits inside #ifdef VRL_PART ... #endif
    const body = PART_GLSL.split('\n').filter(l => l.trim() && !l.startsWith('//'));
    expect(body[0]).toBe('#ifdef VRL_PART');
    expect(body[body.length - 1]).toBe('#endif');
    let depth = 0;
    for (const l of body) { if (/^#if/.test(l)) depth++; else if (/^#endif/.test(l)) depth--; expect(depth).toBeGreaterThanOrEqual(0); }
    expect(depth).toBe(0);
    expect(PART_GLSL).not.toContain('`');
    expect(PART_GLSL).not.toContain('${');
  });
  it('the replaced functions are defined BEFORE the block and the block sits before the marching loops (so the loops see the re-pointed ones)', () => {
    const at = s => src.indexOf(s);
    const block = at('${PART_GLSL}');
    expect(block).toBeGreaterThan(0);
    expect(at('bool regionHiddenAt(vec3 tc,int s){')).toBeLessThan(block);
    expect(at('bool childHiddenAt(vec3 tc,int s,vec4 e){')).toBeLessThan(block);
    expect(at('#define VRL_HIDE')).toBeLessThan(block);
    expect(block).toBeLessThan(at('void main(){\n gl_FragDepth=gl_FragCoord.z;'));
    // one splice only
    expect(src.split('${PART_GLSL}').length).toBe(2);
  });
  it('every call site the block takes over is still in the shader (a merge that renames one would make the part draw the whole body)', () => {
    for (const s of PART_CALL_SITES) expect(src.includes(s), s).toBe(true);
    // and the marching loops ask only through them: no other use of the two functions after the block (regionVis / childVis, defined before it, read the body's own table by design: the part has no sections)
    const after = src.slice(src.indexOf('${PART_GLSL}'), src.indexOf('void main(){\n gl_FragDepth=gl_FragCoord.z;'));
    expect(after.includes('regionHiddenAt(') || after.includes('childHiddenAt(')).toBe(false);
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

describe('the one-shot arm', () => {
  it('off by default; a press arms for ARM_MS; a second press disarms; it ends by itself', () => {
    expect(armed(0, 1000)).toBe(false);
    const u = armPress(0, 1000);
    expect(u).toBe(1000 + ARM_MS); expect(armed(u, 1000)).toBe(true); expect(armed(u, 1000 + ARM_MS - 1)).toBe(true); expect(armed(u, 1000 + ARM_MS)).toBe(false);
    expect(armPress(u, 2000)).toBe(0);
    expect(armPress(u, 1000 + ARM_MS + 5)).toBe(1000 + ARM_MS + 5 + ARM_MS); // expired: a press arms again
  });
});

describe('the wiring in the menu and the session', () => {
  it('the texts exist in both languages with the same keys', () => {
    expect(Object.keys(PART_TEXT.ja).sort()).toEqual(Object.keys(PART_TEXT.en).sort());
    for (const k of Object.keys(PART_TEXT.ja)) { expect(PART_TEXT.ja[k].length).toBeGreaterThan(0); expect(PART_TEXT.en[k].length).toBeGreaterThan(0); }
  });
  it('the grip stays the body\'s grab: the part\'s grip is tried first and only for a laser on the part, or right after 取り出す was pressed', () => {
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
  it('nothing is drawn, uploaded or compiled for the part while none is out: every frame hook returns at once on a null part', () => {
    for (const fn of ['partPose', 'partFrame', 'partRender']) {
      const i = src.indexOf(' ' + fn + '=');
      expect(i, fn).toBeGreaterThan(0);
      expect(src.slice(i, i + 220), fn).toMatch(/if\(!pm[^)]*\)return/);
    }
  });
});

describe('the two buttons: in the header, no list row gives up its room', () => {
  const text = { show: 'Show', hide: 'Hide', color: '色', shape: '表示', section: '断面', sliceOpacity: '不透明度', scale: '拡大率', trigger: 'モード', trigPoint: 'P', trigLabel: 'L', trigHintPoint: 'hp', trigHintLabel: 'hl', results: '解析結果', kids: 'セグメント', total: '合計', page: 'ページ', noSeg: 'なし', home: '正面', undo: '戻', reset: 'リセット', resetAgain: 'もう一度', all: '設定', exit: '終了' };
  const board = (nr, nk) => simpleMenuLayout({ segments: ['bone', 'soft', 'fat', 'lung'].map(k => ({ key: k, name: k, color: '#fff', on: true })), sectionOn: true, scale: { pos: 0.3, text: 'x1', locked: false }, trigger: { show: true, label: false },
    results: Array.from({ length: nr }, (_, i) => ({ hex: '#fff', name: 'r' + i, text: '1 mm³' })), kids: Array.from({ length: nk }, (_, i) => ({ hex: '#fff', name: 'k' + i })), total: '1', showAll: { n: 0, label: 'すべて表示' },
    levels: { items: [{ id: 'a', label: 'A', on: true }, { id: 'b', label: 'B' }], busy: false, hint: '', text: { title: 'データ', again: 'again' } }, pair: { label: 'pair', on: false, busy: false }, text });
  it('the かんたん board is the board of before: event-mode.js is not changed, so no list loses a row (the real boards are already tight: the lists would have lost rows to a new row)', () => {
    for (const [nr, nk] of [[4, 0], [12, 5], [8, 1], [0, 40]]) expect(board(nr, nk).some(x => /^detach:/.test(x.id || ''))).toBe(false);
    expect(menuSrc).not.toMatch(/detach/);
  });
  it('they sit between the title (ends near x 400) and 「閉じる」 (x 780) in the header row (y 18, the same 72 px as 閉じる), 取り出す left of すべて元に戻す, and over no widget of the board', () => {
    expect(PART_BTN_X).toBeGreaterThanOrEqual(400);
    expect(PART_BTN_X + PART_ARM_W + PART_BTN_GAP + PART_RESTORE_W).toBeLessThanOrEqual(780);
    for (const [nr, nk] of [[4, 0], [12, 5]]) for (const o of board(nr, nk)) if (o.type !== 'label') expect(o.y, o.id).toBeGreaterThanOrEqual(90); // nothing of the board is in the header's band
    expect(src).toMatch(/btn\(PART_BTN_X,18,PART_ARM_W,dm\.text\.arm,dm\.armed,\(\)=>partArmPress\(\)/);
    expect(src).toMatch(/btn\(PART_BTN_X\+PART_ARM_W\+PART_BTN_GAP,18,PART_RESTORE_W,dm\.text\.restore,false,\(\)=>partRestorePress\(\)/);
  });
  it('drawn on every page of both menus (a normal session has no かんたん board), except where 「かんたん」 sits in the same place (the full menu of 体験会モード)', () => {
    expect(src).toContain('if(dm&&!(evMenu&&ui.tab!==10))');
    const hdr = src.slice(src.indexOf("btn(780,18,200,L.close,false,()=>setMenuOpen(false),{size:28});"), src.indexOf('// tabs\n'));
    expect(hdr).toContain('partMenuInfo()');
    expect(hdr).toContain("btn(560,18,200,tr('evSimple')"); // the header's other button that is there only in 体験会モード outside tab 10 (560..760: the same place)
  });
  it('the buttons are drawn only when the data has results or child segments, and the restore is disabled while nothing is out', () => {
    expect(src).toContain('partMenuInfo=()=>regionList.length||childList.length?{armed:partArmed(),active:!!pm,busy:partBusy,text:{arm:PT.arm,restore:PT.restore}}:null;');
    expect(src).toContain('disabled:!dm.active||dm.busy');
  });
});
