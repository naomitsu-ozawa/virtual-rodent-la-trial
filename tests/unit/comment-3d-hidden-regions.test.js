import { describe, it, expect } from 'vitest';
import { computeHiddenIds, hiddenRegionSignature, hiddenRegionSkipOf, withHiddenRegionSkip } from '../../docs/comment-3d-hidden.js';
import { tissueAt } from '../../docs/comment-3d-label-occlusion.js';
import { buildClsData } from '../../docs/point-cls.js';

const N = 16, dims = [N, N, N], halfExt = [1, 1, 1], order = ['bone', 'soft', 'fat', 'lung'];
const packed = new Uint8Array(N * N * N * 2);
for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = x === 8 || x === 9 ? 1000 : 0, o = (x + N * (y + N * z)) * 2; packed[o] = v & 255; packed[o + 1] = v >> 8; }
const state = { bone: { active: true, enabled: true, min: 500, max: 3000 }, soft: { active: false, enabled: false, min: 0, max: 1 }, fat: { active: false, enabled: false, min: 0, max: 1 }, lung: { active: false, enabled: false, min: 0, max: 1 } };
const cls = buildClsData({ dims, data: packed }, [1, 0, 0], { dims, data: null, active: 0, maskOnly: 0 }, state);
const raw = { cls, dims, halfExt }, chs = [0], P = (x, y = 0, z = 0) => ({ x, y, z });
// a region that covers the x voxels x0..x1 of the whole grid
const region = (id, x0, x1, o = {}) => { const runsBySlice = []; for (let z = 0; z < N; z++) { const r = []; for (let y = 0; y < N; y++) r.push(y, x0, x1); runsBySlice.push(new Uint32Array(r)); } return { id, color: 0xff0000, runsBySlice, voxels: (x1 - x0 + 1) * N * N, segmentKeys: ['bone'], visible: true, hidden: false, ...o }; };
const prepWith = regions => withHiddenRegionSkip(raw, regions, order, dims);
const pts = [{ id: 'a', local: P(-0.5) }];
const hiddenBy = regions => computeHiddenIds(pts, P(0.9), prepWith(regions), { chs }).has('a');

describe('PC position comments: a hidden shape is see-through, a colour-off one still hides', () => {
  it('no result: the wall hides the point', () => { expect(hiddenBy([])).toBe(true); });
  it('the wall is a result whose COLOUR is off: still drawn, still hides', () => { expect(hiddenBy([region(1, 8, 9, { visible: false })])).toBe(true); });
  it('the wall is a result whose SHAPE is hidden: nothing hides the point', () => { expect(hiddenBy([region(1, 8, 9, { hidden: true })])).toBe(false); });
  it('a hidden result that covers only a part of the wall: the drawn rest still hides (a drawn result next to a hidden one occludes)', () => {
    expect(hiddenBy([region(1, 8, 8, { hidden: true }), region(2, 9, 9)])).toBe(true);
    expect(hiddenBy([region(1, 8, 8, { hidden: true })])).toBe(true);
    expect(hiddenBy([region(1, 8, 9, { hidden: true }), region(2, 9, 9)])).toBe(true); // a later, drawn result wins where they overlap
  });
  it('a hidden result on other segments only does not hide the wall of this slot', () => {
    expect(hiddenBy([region(1, 8, 9, { hidden: true, segmentKeys: ['soft'] })])).toBe(true);
  });
  it('the label places (tissueAt): the wall of a hidden result is no tissue, a colour-off one is', () => {
    expect(tissueAt(P(0), prepWith([region(1, 8, 9, { hidden: true })]), chs)).toBe(false);
    expect(tissueAt(P(0), prepWith([region(1, 8, 9, { visible: false })]), chs)).toBe(true);
    expect(tissueAt(P(0), raw, chs)).toBe(true);
  });
});

describe('the skip and its signature', () => {
  it('nothing hidden: signature "", no skip, the same prep object (nothing to build)', () => {
    const rs = [region(1, 8, 9)];
    expect(hiddenRegionSignature(rs, order)).toBe(''); expect(hiddenRegionSkipOf(raw, rs, order, dims)).toBeNull(); expect(prepWith(rs)).toBe(raw);
    expect(hiddenRegionSignature([], order)).toBe('');
  });
  it('the signature changes with the hidden flag, and the same inputs give the same prep object (cached)', () => {
    const a = region(1, 8, 9, { hidden: true }), s1 = hiddenRegionSignature([a], order);
    expect(s1).not.toBe(''); a.hidden = false; expect(hiddenRegionSignature([a], order)).toBe('');
    a.hidden = true; const p1 = prepWith([a]), p2 = prepWith([a]); expect(p1).toBe(p2); expect(typeof p1.skip).toBe('function');
    expect(hiddenRegionSignature([a], order)).toBe(s1);
  });
  it('the skip is true on the hidden voxels of the slot\'s channel only', () => {
    const skip = prepWith([region(1, 8, 9, { hidden: true })]).skip;
    expect(skip(8, 3, 3, 0)).toBe(true); expect(skip(2, 3, 3, 0)).toBe(false); expect(skip(8, 3, 3, 1)).toBe(false);
  });
  it('no data / no source grid: nothing is skipped', () => {
    expect(withHiddenRegionSkip(null, [region(1, 8, 9, { hidden: true })], order, dims)).toBeNull();
    expect(hiddenRegionSkipOf(raw, [region(1, 8, 9, { hidden: true })], order, null)).toBeNull();
  });
});
