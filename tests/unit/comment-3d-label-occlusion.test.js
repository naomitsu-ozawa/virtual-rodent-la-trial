import { describe, it, expect } from 'vitest';
import { tissueAt, pushOutOfTissue, judgeLabelPlace, labelDisplay, thinOverlaps, putAttr, putStyle, PUSH_DIRS, LABEL_PUSH_MAX, frontMost, stackOrder, analysisLabelsInView, LABEL_LIT_Z } from '../../docs/comment-3d-label-occlusion.js';

// Occlusion rules of the analysis labels on the PC 3D view. Synthetic classification bytes: 16^3 grid, box +-1, a slab of tissue at x voxels 6..9
// (object x in [-0.25, 0.25]), one channel. A voxel is 0.125 wide.
const N = 16, dims = [N, N, N], halfExt = [1, 1, 1];
const data = new Uint8Array(N * N * N);
for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 6; x <= 9; x++) data[x + N * (y + N * z)] = 255;
const prep = { cls: { data, C: 1 }, dims, halfExt }, chs = [0];
const P = (x, y = 0, z = 0) => ({ x, y, z });

describe('tissueAt', () => {
  it('inside the slab yes, outside / outside the box / nothing shown no', () => {
    expect(tissueAt(P(0), prep, chs)).toBe(true);
    expect(tissueAt(P(0.5), prep, chs)).toBe(false);
    expect(tissueAt(P(5), prep, chs)).toBe(false);
    expect(tissueAt(P(0), prep, [])).toBe(false);
    expect(tissueAt(P(0), { cls: null }, chs)).toBe(false);
  });
  it('the cut-away side of the section plane is not tissue', () => {
    const keepLeft = { x: -1, y: 0, z: 0, w: 0 }; // keeps x <= 0
    expect(tissueAt(P(-0.1), prep, chs, keepLeft)).toBe(true);
    expect(tissueAt(P(0.1), prep, chs, keepLeft)).toBe(false);
  });
});

describe('pushOutOfTissue', () => {
  it('goes out by the nearest way, beyond the surface, to a place that is not tissue', () => {
    const r = pushOutOfTissue(P(0.1), prep, chs);
    expect(r).not.toBeNull();
    expect(r.point.x).toBeGreaterThan(0.25); expect(r.dist).toBeLessThan(0.25);
    expect(tissueAt(r.point, prep, chs)).toBe(false);
    const l = pushOutOfTissue(P(-0.1), prep, chs); // nearer to the left face
    expect(l.point.x).toBeLessThan(-0.25);
  });
  it('a point outside the tissue is not pushed', () => { expect(pushOutOfTissue(P(0.6), prep, chs)).toBeNull(); });
  it('no way out within the limit -> null', () => { expect(pushOutOfTissue(P(0), prep, chs, null, { maxDist: 0.05 })).toBeNull(); });
  it('the section plane opens a way: the cut face is a surface', () => {
    const keepLeft = { x: -1, y: 0, z: 0, w: 0 };
    const r = pushOutOfTissue(P(-0.1), prep, chs, keepLeft);
    expect(r.point.x).toBeGreaterThan(0); // out through the cut at x = 0, nearer than the left face (0.15)
    expect(tissueAt(r.point, prep, chs, keepLeft)).toBe(false);
  });
  it('26 unit directions, axes first', () => {
    expect(PUSH_DIRS.length).toBe(26);
    expect(PUSH_DIRS.slice(0, 6).every(d => Math.abs(Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z) - 1) < 1e-9)).toBe(true);
    expect(LABEL_PUSH_MAX).toBeGreaterThan(0);
  });
});

describe('judgeLabelPlace', () => {
  it('outside: not embedded, no push', () => { expect(judgeLabelPlace(P(0.6), prep, chs)).toEqual({ embedded: false, push: null }); });
  it('inside: embedded and pushed out', () => {
    const j = judgeLabelPlace(P(0.05), prep, chs);
    expect(j.embedded).toBe(true); expect(tissueAt(j.push, prep, chs)).toBe(false);
  });
  it('inside but no way out: embedded, no push', () => {
    expect(judgeLabelPlace(P(0), prep, chs, null, { maxDist: 0.05 })).toEqual({ embedded: true, push: null });
  });
  it('no classification bytes yet: nothing is embedded', () => { expect(judgeLabelPlace(P(0), null, chs)).toEqual({ embedded: false, push: null }); });
});

describe('labelDisplay', () => {
  it('embedded and not pushed = faint, even when "behind" (it lies inside the tissue)', () => {
    expect(labelDisplay({ embedded: true, pushed: false, behind: true })).toBe('faint');
    expect(labelDisplay({ embedded: true, pushed: false })).toBe('faint');
  });
  it('behind a volume = hidden completely (also a pushed one); exposed = shown', () => {
    expect(labelDisplay({ behind: true })).toBe('hide');
    expect(labelDisplay({ embedded: true, pushed: true, behind: true })).toBe('hide');
    expect(labelDisplay({ embedded: true, pushed: true })).toBe('show');
    expect(labelDisplay({})).toBe('show');
  });
  it('a card that is being dragged is not hidden', () => { expect(labelDisplay({ behind: true, dragging: true })).toBe('show'); });
});

describe('thinOverlaps', () => {
  const c = (id, x, y, z, keep = false) => ({ id, x, y, w: 80, h: 16, z, keep });
  it('of two overlapping cards the farther is hidden', () => {
    expect([...thinOverlaps([c(1, 100, 100, 0.9), c(2, 110, 104, 0.4)])]).toEqual([1]);
  });
  it('a lit card stays even when it is the farther one, and the nearer one gives way', () => {
    expect([...thinOverlaps([c(1, 100, 100, 0.9, true), c(2, 110, 104, 0.4)])]).toEqual([2]);
  });
  it('cards that do not overlap all stay; a chain keeps the nearer of each clash', () => {
    expect(thinOverlaps([c(1, 0, 0, 0.5), c(2, 200, 0, 0.5), c(3, 0, 100, 0.5)]).size).toBe(0);
    const h = thinOverlaps([c(1, 0, 0, 0.3), c(2, 70, 0, 0.5), c(3, 140, 0, 0.7)]); // 2 clashes with 1 and is hidden; 3 clashes only with 2 (hidden): stays
    expect([...h]).toEqual([2]);
  });
  it('two lit cards both stay', () => { expect(thinOverlaps([c(1, 0, 0, 0.5, true), c(2, 10, 0, 0.4, true)]).size).toBe(0); });
  it('empty input', () => { expect(thinOverlaps([]).size).toBe(0); });
});

describe('putAttr / putStyle (no DOM write when nothing changed)', () => {
  const fake = () => { const el = { writes: 0, style: new Proxy({}, { set(t, k, v) { el.writes++; t[k] = v; return true; } }), setAttribute() { el.writes++; } }; return el; };
  it('writes once, then not again for the same value; writes again when it changes', () => {
    const el = fake();
    expect(putAttr(el, 'cx', '10.0')).toBe(true); expect(putAttr(el, 'cx', '10.0')).toBe(false); expect(el.writes).toBe(1);
    expect(putAttr(el, 'cx', '11.0')).toBe(true); expect(el.writes).toBe(2);
    expect(putStyle(el, 'transform', 'a')).toBe(true); expect(putStyle(el, 'transform', 'a')).toBe(false); expect(el.writes).toBe(3);
    expect(putStyle(el, 'display', 'none')).toBe(true); expect(el.writes).toBe(4);
  });
  it('a still frame (the same values for 100 frames) writes exactly the first time', () => {
    const el = fake();
    for (let f = 0; f < 100; f++) { putAttr(el, 'x1', '1.0'); putAttr(el, 'y1', '2.0'); putStyle(el, 'transform', 't'); putStyle(el, 'display', ''); }
    expect(el.writes).toBe(4);
  });
  it('attribute and style of the same name do not share a cache', () => {
    const el = fake(); putAttr(el, 'display', 'a'); expect(putStyle(el, 'display', 'a')).toBe(true);
  });
});

describe('the lit / dragged exception lives in the CSS and the draw code uses the write cache (source check)', () => {
  it('behind and faint rules exclude .is-lit and .is-dragging', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../docs/style.css', import.meta.url), 'utf8');
    expect(css).toContain('.analysis-label-3d.is-behind:not(.is-lit):not(.is-dragging)');
    expect(css).toContain('.analysis-leader-3d.is-behind:not(.is-lit)');
    expect(css).not.toContain('.analysis-anchor-3d.is-behind'); // the anchor dot is never hidden by tissue: translucent (.is-faint), hidden only under a thinned card (.is-overlapped)
    expect(css).toContain('.analysis-anchor-3d.is-faint:not(.is-lit)'); expect(css).toContain('.analysis-anchor-3d.is-overlapped:not(.is-lit)');
    expect(css).toContain('.analysis-label-3d.is-faint:not(.is-lit):not(.is-dragging)');
    const js = readFileSync(new URL('../../docs/comment-3d.js', import.meta.url), 'utf8');
    expect(js).toContain("putStyle(e.label,'transform'"); expect(js).toContain("putAttr(e.dot,'cx'"); expect(js).toContain("putAttr(svg,'width',W)");
  });
});

describe('overlapping cards: the nearer is picked and drawn on top (labelOverlap)', () => {
  it('frontMost: the nearest (smallest z) among the cards under the point; a lit card first; the first of equals; nothing = null', () => {
    expect(frontMost([{ id: 1, z: 0.5 }, { id: 2, z: 0.2 }, { id: 3, z: 0.9 }])).toBe(2);
    expect(frontMost([{ id: 1, z: 0.2 }, { id: 2, z: 0.5 }])).toBe(1); // insertion order does not decide
    expect(frontMost([{ id: 1, z: 0.1 }, { id: 2, z: 0.9, lit: true }])).toBe(2); // a lit card is on top of all
    expect(frontMost([{ id: 1, z: 0.4, lit: true }, { id: 2, z: 0.3, lit: true }])).toBe(2);
    expect(frontMost([{ id: 7, z: 0.3 }, { id: 8, z: 0.3 }])).toBe(7);
    expect(frontMost([{ id: 0, z: -0.5 }])).toBe(0); // id 0 is an id, not "none"
    expect(frontMost([])).toBeNull();
  });
  it('stackOrder: the farther card gets the lower z-index, a lit card is above all', () => {
    const m = stackOrder([{ id: 'a', z: 0.2 }, { id: 'b', z: 0.8 }, { id: 'c', z: 0.5 }, { id: 'd', z: 0.99, lit: true }]);
    expect(m.get('b')).toBeLessThan(m.get('c')); expect(m.get('c')).toBeLessThan(m.get('a'));
    expect(m.get('d')).toBeGreaterThan(m.get('a')); expect(m.get('d')).toBeGreaterThan(LABEL_LIT_Z);
    expect(stackOrder([]).size).toBe(0);
  });
  it('analysisLabelsInView counts the cards that meet the view rectangle (the labels the user sees)', () => {
    const c = (x, y) => ({ x, y, w: 40, h: 16 });
    // in: (100,50) (500,300) (100,400: its top edge is at 392) (100,-7: its bottom edge is at +1); out: x -30 and -21 (right edge -10 / -1), y -9 (bottom edge -1)
    expect(analysisLabelsInView([c(100, 50), c(500, 300), c(-30, 50), c(-21, 50), c(100, 400), c(100, -9), c(100, -7)], 800, 400)).toBe(4);
    expect(analysisLabelsInView([c(-19, 50), c(819, 50), c(821, 50)], 800, 400)).toBe(2); // -19: right edge +1 (in); 819: left edge 799 (in); 821: left edge 801 (out)
    expect(analysisLabelsInView([], 800, 400)).toBe(0);
  });
  it('the 3D view picks with frontMost, counts the labels in view, thins only by the mode and stacks the cards (source)', async () => {
    const { readFileSync } = await import('node:fs');
    const js = readFileSync(new URL('../../docs/comment-3d.js', import.meta.url), 'utf8');
    expect(js).toContain("frontMost(c)"); expect(js).toContain("thinActive(settings.get('labelOverlap'),analysisLabelsInView(items,W,H))?thinOverlaps(items):NO_OVER");
    expect(js).toContain("putStyle(e.label,'zIndex'"); expect(js).toContain("id:'AA|'+r.id,local:pl.al"); // the anchor is its own probe of the hidden judgement
    expect(js).toContain("e.dot.classList.toggle('is-faint',dotBehind)");
  });
});
