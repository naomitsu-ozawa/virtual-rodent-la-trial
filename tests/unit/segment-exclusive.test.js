import { describe, it, expect } from 'vitest';
import { effectiveRanges, nextUp, nextDown } from '../../docs/segment-exclusive.js';

const segs = o => Object.fromEntries(Object.entries(o).map(([k, [a, b, active = true]]) => [k, { userMin: a, userMax: b, active }]));
const inSeg = (r, v) => v >= r.min && v <= r.max;

describe('non-overlapping segments (build 438)', () => {
  it('off keeps the user ranges', () => {
    const r = effectiveRanges(segs({ fat: [-250, 81], soft: [-93, 248] }), ['fat', 'soft'], 'off');
    expect(r.fat).toMatchObject({ min: -250, max: 81 });
    expect(r.soft).toMatchObject({ min: -93, max: 248 });
  });
  it('priority: the upper card takes the overlap, no gap and no double value', () => {
    const r = effectiveRanges(segs({ bone: [354, 61530], fat: [-250, 81], soft: [-93, 248] }), ['bone', 'fat', 'soft'], 'priority');
    expect(r.fat).toMatchObject({ min: -250, max: 81 });
    expect(r.soft.min).toBe(nextUp(81));
    expect(r.soft.max).toBe(248);
    for (const v of [-250, -93, 0, 81, 81.00001, 81.5, 82, 248]) {
      const n = ['bone', 'fat', 'soft'].filter(k => inSeg(r[k], v)).length;
      expect(n).toBe(1);
    }
  });
  it('soft above fat gives the overlap to soft', () => {
    const r = effectiveRanges(segs({ fat: [-250, 81], soft: [-93, 248] }), ['soft', 'fat'], 'priority');
    expect(r.soft).toMatchObject({ min: -93, max: 248 });
    expect(r.fat.max).toBe(nextDown(-93));
  });
  it('a range inside a lower one: the piece with the middle stays, the other is reported', () => {
    const r = effectiveRanges(segs({ fat: [-250, 81], soft: [-300, 300] }), ['fat', 'soft'], 'priority');
    expect(r.soft.min).toBe(nextUp(81));
    expect(r.soft.max).toBe(300);
    expect(r.soft.dropped).toEqual([[-300, nextDown(-250)]]);
  });
  it('a fully covered range is empty', () => {
    const r = effectiveRanges(segs({ fat: [-250, 81], soft: [-100, 0] }), ['fat', 'soft'], 'priority');
    expect(r.soft.empty).toBe(true);
    expect(r.soft.max).toBeLessThan(r.soft.min);
  });
  it('inactive segments neither take nor lose values', () => {
    const r = effectiveRanges(segs({ fat: [-250, 81, false], soft: [-93, 248] }), ['fat', 'soft'], 'priority');
    expect(r.soft).toMatchObject({ min: -93, max: 248 });
  });
  it('a dropped piece stays free for the segments below', () => {
    const r = effectiveRanges(segs({ fat: [-250, 81], soft: [-300, 300], lung: [-950, -260] }), ['fat', 'soft', 'lung'], 'priority');
    expect(r.lung.max).toBe(-260);
    expect(inSeg(r.lung, -280)).toBe(true);
  });
});

// build 459: voxel takers (post-processing / manual edits) are not taken by range; the segments below list them as sources
const segsT = o => Object.fromEntries(Object.entries(o).map(([k, [a, b, opt = {}]]) => [k, { userMin: a, userMax: b, active: true, ...opt }]));
describe('voxel takers and sources (build 459)', () => {
  it('takes omitted: every segment is plain and the result is the old one, with no sources', () => {
    const r = effectiveRanges(segs({ bone: [354, 61530], fat: [-250, 81], soft: [-93, 248] }), ['bone', 'fat', 'soft'], 'priority');
    for (const k of ['bone', 'fat', 'soft']) { expect(r[k].sources).toEqual([]); expect(r[k]).toMatchObject({ min: r[k].legacy.min, max: r[k].legacy.max }); }
  });
  it('a voxel taker does not cut the ranges below; the overlapping lower segment lists it as a source', () => {
    const r = effectiveRanges(segsT({ bone: [300, 2000, { takes: false }], soft: [0, 1000] }), ['bone', 'soft'], 'priority');
    expect(r.soft).toMatchObject({ min: 0, max: 1000, empty: false });
    expect(r.soft.sources).toEqual(['bone']);
    expect(r.soft.legacy.max).toBe(nextDown(300)); // the old rule cut it
    expect(r.bone.sources).toEqual([]);
  });
  it('a taker whose range does not overlap is no source, unless it can add voxels (Closing / hole filling)', () => {
    const base = adds => effectiveRanges(segsT({ bone: [300, 2000, { takes: false, adds }], fat: [-250, 81] }), ['bone', 'fat'], 'priority');
    expect(base(false).fat.sources).toEqual([]);
    expect(base(true).fat.sources).toEqual(['bone']);
  });
  it('a segment that adds voxels subtracts every active upper segment, plain ones too', () => {
    const r = effectiveRanges(segsT({ bone: [300, 2000], fat: [-250, 81, { takes: false }], soft: [0, 200, { takes: false, adds: true }] }), ['bone', 'fat', 'soft'], 'priority');
    expect(r.soft.sources).toEqual(['bone', 'fat']);
    expect(r.soft.max).toBe(200);
    expect(r.soft.min).toBe(0); // range cut by bone is outside; fat is a taker so not cut by range
  });
  it('plain uppers still cut by range while takers do not, in the same chain', () => {
    const r = effectiveRanges(segsT({ fat: [-250, 81], bone: [300, 2000, { takes: false }], soft: [-93, 400] }), ['fat', 'bone', 'soft'], 'priority');
    expect(r.soft.min).toBe(nextUp(81));
    expect(r.soft.max).toBe(400);
    expect(r.soft.sources).toEqual(['bone']);
  });
  it('an inactive segment is never a source, and takes nothing from the ones below', () => {
    const r = effectiveRanges(segsT({ bone: [300, 2000, { takes: false, active: false }], soft: [0, 1000] }), ['bone', 'soft'], 'priority');
    expect(r.soft.sources).toEqual([]);
    expect(r.soft.max).toBe(1000);
  });
  it('reordering the cards changes the sources: the lower one lists the upper one only', () => {
    const s = segsT({ bone: [300, 2000, { takes: false }], soft: [0, 1000, { takes: false }] });
    expect(effectiveRanges(s, ['bone', 'soft'], 'priority').soft.sources).toEqual(['bone']);
    const r = effectiveRanges(s, ['soft', 'bone'], 'priority');
    expect(r.soft.sources).toEqual([]);
    expect(r.bone.sources).toEqual(['soft']);
  });
  it('off mode has no sources', () => {
    const r = effectiveRanges(segsT({ bone: [300, 2000, { takes: false }], soft: [0, 1000] }), ['bone', 'soft'], 'off');
    expect(r.soft.sources).toEqual([]);
  });
  it('a segment fully covered by plain uppers is empty and has no sources', () => {
    const r = effectiveRanges(segsT({ fat: [-250, 81], bone: [300, 2000, { takes: false }], soft: [-100, 0] }), ['fat', 'bone', 'soft'], 'priority');
    expect(r.soft.empty).toBe(true);
    expect(r.soft.sources).toEqual([]);
  });
});
