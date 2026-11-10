import { describe, it, expect, vi } from 'vitest';
import { buildSegmentTree, treePage, treeParentKey, treeDefaultExpanded, pageTreeLines, ellipsize, TREE_COLLAPSE_OVER } from '../../docs/segment-tree.js';
import { regionDisplayName } from '../../docs/region-name.js';
import { setRegionVisible, onRegionVisibleChange, regionVisible } from '../../docs/region-visibility.js';

const ORDER = ['bone', 'soft', 'fat', 'lung', 'contrast'];
const nameOf = r => regionDisplayName(r, x => (x.merged ? 'Merged ' : 'Region ') + x.id);
const mk = (id, extra = {}) => ({ id, segmentKeys: ['contrast'], color: 0x112233 + id, visible: true, ...extra });

describe('buildSegmentTree', () => {
  it('groups the regions under their segment, in the order of the segments and of the list', () => {
    const regions = [mk(1, { name: 'Liver' }), mk(2, { segmentKeys: ['bone'] }), mk(3, { atlasId: 2200 }), mk(4)];
    const tree = buildSegmentTree(regions, { segmentKeys: ORDER, nameOf });
    expect(tree.map(g => [g.key, g.count])).toEqual([['bone', 1], ['contrast', 3]]);
    expect(tree[1].rows.map(r => r.id)).toEqual([1, 3, 4]);
  });
  it('names a row by the region-name rule: name, then "ID <atlasId>", then the default', () => {
    const tree = buildSegmentTree([mk(1, { name: 'Liver', atlasId: 7 }), mk(2, { atlasId: 2200 }), mk(3)], { segmentKeys: ORDER, nameOf });
    expect(tree[0].rows.map(r => r.name)).toEqual(['Liver', 'ID 2200', 'Region 3']);
  });
  it('carries colour, shown flag, focus and whether the toggle can be used', () => {
    const regions = [mk(1, { visible: false }), mk(2, { visible: undefined }), mk(3)];
    const tree = buildSegmentTree(regions, { segmentKeys: ORDER, nameOf, focusedId: 3, segmentsShown: r => r.id !== 3 });
    expect(tree[0].rows.map(r => [r.visible, r.focused, r.canToggle])).toEqual([[false, false, true], [true, false, true], [true, true, false]]);
    expect(tree[0].rows[0].color).toBe(0x112234);
  });
  it('lists a region of several segments once, under the first segment the tree knows; a region without a known segment is left out', () => {
    const regions = [mk(1, { segmentKeys: ['fat', 'bone'] }), mk(2, { segmentKeys: ['nope', 'soft'] }), mk(3, { segmentKeys: [] }), mk(4, { segmentKeys: undefined }), mk(5, { segmentKeys: ['nope'] })];
    const tree = buildSegmentTree(regions, { segmentKeys: ORDER, nameOf });
    expect(tree.map(g => [g.key, g.rows.map(r => r.id)])).toEqual([['soft', [2]], ['fat', [1]]]);
    expect(treeParentKey(regions[0], ORDER)).toBe('fat');
    expect(treeParentKey(regions[4], ORDER)).toBe(null);
  });
  it('with only the segments that have a card as candidates, a merged region falls to its next segment', () => {
    const regions = [mk(1, { segmentKeys: ['bone', 'contrast'] }), mk(2)];
    expect(buildSegmentTree(regions, { segmentKeys: ['contrast'], nameOf })[0].rows.map(r => r.id)).toEqual([1, 2]);
    expect(buildSegmentTree(regions, { segmentKeys: ORDER, nameOf }).map(g => g.key)).toEqual(['bone', 'contrast']); // with a card for bone it stays under bone
  });
  it('is empty without regions, and a segment without regions has no group', () => {
    expect(buildSegmentTree([], { segmentKeys: ORDER, nameOf })).toEqual([]);
    expect(buildSegmentTree(null, { segmentKeys: ORDER, nameOf })).toEqual([]);
  });
});

describe('collapse rule and paging', () => {
  it('is expanded up to 8 regions and collapsed above', () => {
    expect(TREE_COLLAPSE_OVER).toBe(8);
    expect(treeDefaultExpanded(1)).toBe(true); expect(treeDefaultExpanded(8)).toBe(true);
    expect(treeDefaultExpanded(9)).toBe(false); expect(treeDefaultExpanded(12)).toBe(false);
  });
  it('treePage cuts a list into pages and clamps the page', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(treePage(items, 0, 5)).toMatchObject({ items: [0, 1, 2, 3, 4], page: 0, pages: 3, from: 0, to: 5 });
    expect(treePage(items, 2, 5)).toMatchObject({ items: [10, 11], page: 2, pages: 3, from: 10, to: 12 });
    expect(treePage(items, 9, 5).page).toBe(2); expect(treePage(items, -3, 5).page).toBe(0);
    expect(treePage([], 0, 5)).toMatchObject({ items: [], page: 0, pages: 1 });
  });
});

describe('pageTreeLines (the VR menu)', () => {
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const shape = pages => pages.map(p => p.map(l => (l.type === 'seg' ? (l.cont ? 'S*' : 'S') : 'r' + l.row.id)).join(' '));
  it('puts the children right under their segment on one page when they fit', () => {
    const pages = pageTreeLines([{ key: 'bone', rows: [] }, { key: 'contrast', rows: rows(3) }], { segH: 76, rowH: 62, avail: 690 });
    expect(shape(pages)).toEqual(['S S r1 r2 r3']);
    expect(pages[0][2]).toMatchObject({ type: 'row', key: 'contrast' });
  });
  it('pages many children and repeats the parent line at the top of a continued page', () => {
    const pages = pageTreeLines([{ key: 'contrast', rows: rows(12) }], { segH: 76, rowH: 62, avail: 76 + 62 * 5 });
    expect(shape(pages)).toEqual(['S r1 r2 r3 r4 r5', 'S* r6 r7 r8 r9 r10', 'S* r11 r12']);
    expect(pages.flat().filter(l => l.type === 'row').length).toBe(12);
  });
  it('never ends a page with a segment line whose children follow', () => {
    const pages = pageTreeLines([{ key: 'bone', rows: [] }, { key: 'soft', rows: [] }, { key: 'contrast', rows: rows(2) }], { segH: 76, rowH: 62, avail: 76 * 3 + 20 });
    for (const p of pages) { const last = p.at(-1); if (last.type === 'seg') expect(last.key).not.toBe('contrast'); }
    expect(pages.flat().filter(l => l.type === 'row').map(l => l.row.id)).toEqual([1, 2]);
  });
  it('collapsed: only the segment lines', () => {
    expect(shape(pageTreeLines([{ key: 'contrast', rows: rows(5) }], { segH: 76, rowH: 62, avail: 690, expanded: false }))).toEqual(['S']);
  });
  it('always yields at least one page', () => {
    expect(pageTreeLines([], { segH: 76, rowH: 62, avail: 690 })).toEqual([[]]);
  });
});

describe('ellipsize', () => {
  const m = t => t.length * 10;
  it('keeps a text that fits, cuts a long one with an ellipsis within the width', () => {
    expect(ellipsize('Liver', 100, m)).toBe('Liver');
    const cut = ellipsize('A very long region name', 100, m);
    expect(cut.endsWith('…')).toBe(true); expect(m(cut)).toBeLessThanOrEqual(100);
  });
});

describe('region-visibility', () => {
  it('sets the flag once, tells the listeners, and ignores a no-op', () => {
    const r = { id: 1, visible: true }, seen = [];
    const off = onRegionVisibleChange((reg, v) => seen.push([reg.id, v]));
    expect(setRegionVisible(r, false)).toBe(true); expect(r.visible).toBe(false); expect(regionVisible(r)).toBe(false);
    expect(setRegionVisible(r, false)).toBe(false);
    expect(setRegionVisible(r, true)).toBe(true);
    expect(seen).toEqual([[1, false], [1, true]]);
    off(); setRegionVisible(r, false); expect(seen.length).toBe(2);
    expect(setRegionVisible(null, true)).toBe(false);
  });
  it('treats a region with no flag as shown and a failing listener does not stop the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = { id: 2 }, ok = vi.fn();
    const a = onRegionVisibleChange(() => { throw new Error('x'); }), b = onRegionVisibleChange(ok);
    expect(regionVisible(r)).toBe(true);
    expect(setRegionVisible(r, false)).toBe(true); expect(ok).toHaveBeenCalledTimes(1);
    a(); b(); warn.mockRestore();
  });
});
