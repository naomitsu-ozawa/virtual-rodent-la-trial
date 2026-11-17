import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { highlightColor, highlightIndex, createHighlightTracker, HIGHLIGHT_WHITE_MIX, HIGHLIGHT_DIM_MIX } from '../../docs/region-highlight.js';

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

describe('region-highlight: the table colours', () => {
  it('named constants: 0.45 toward white, 0.35 back toward the segment colour', () => {
    expect(HIGHLIGHT_WHITE_MIX).toBe(0.45);
    expect(HIGHLIGHT_DIM_MIX).toBe(0.35);
  });
  it('no highlight: the colour is returned unchanged (the plain table)', () => {
    expect(highlightColor([0.2, 0.4, 0.6], [1, 0, 0], 'none')).toEqual([0.2, 0.4, 0.6]);
  });
  it('the highlighted result moves toward white, the others toward their segment colour', () => {
    expect(near(highlightColor([0.2, 0.4, 0.6], [0, 0, 0], 'on'), [0.2 + 0.8 * 0.45, 0.4 + 0.6 * 0.45, 0.6 + 0.4 * 0.45])).toBe(true);
    expect(near(highlightColor([0.2, 0.4, 0.6], [0.6, 0.4, 0.2], 'other'), [0.2 + 0.4 * 0.35, 0.4, 0.6 - 0.4 * 0.35])).toBe(true);
    const on = highlightColor([0.2, 0.4, 0.6], null, 'on');
    expect(on.every((v, i) => v > [0.2, 0.4, 0.6][i])).toBe(true);
  });
  it('another result without a known segment colour is left alone', () => {
    expect(highlightColor([0.2, 0.4, 0.6], null, 'other')).toEqual([0.2, 0.4, 0.6]);
  });
  it('highlightIndex: only an existing SHOWN result is highlighted (0 / unknown / hidden = none)', () => {
    const e = [{ rid: 5, shown: true }, { rid: 7, shown: false }];
    expect(highlightIndex(e, 0)).toBe(-1);
    expect(highlightIndex(e, 5)).toBe(0);
    expect(highlightIndex(e, 7)).toBe(-1);
    expect(highlightIndex(e, 9)).toBe(-1);
  });
});

describe('region-highlight: the tracker (every way the highlight is released)', () => {
  const L = { key: 'L' }, R = { key: 'R' };
  const h = (key, pin = 0, hover = 0) => ({ key, pin, hover });
  it('the volume hover highlights, and the laser leaving releases', () => {
    const t = createHighlightTracker();
    expect(t.update([h(L, 0, 3)], true)).toBe(3);
    expect(t.update([h(L, 0, 4)], true)).toBe(4); // another result
    expect(t.update([h(L, 0, 0)], true)).toBe(0); // the laser left
  });
  it('a pinned label (laser on it / held) beats a volume hover', () => {
    const t = createHighlightTracker();
    expect(t.update([h(L, 0, 3), h(R, 8, 0)], true)).toBe(8);
    expect(t.update([h(L, 2, 3)], true)).toBe(2);
    expect(t.update([h(L, 0, 3)], true)).toBe(3); // off the label: the hover again
  });
  it('another pinned label: the one that changed last wins; releasing it hands over to the other hand', () => {
    const t = createHighlightTracker();
    expect(t.update([h(L, 2), h(R, 0)], true)).toBe(2);
    expect(t.update([h(L, 2), h(R, 5)], true)).toBe(5);
    expect(t.update([h(L, 2), h(R, 5)], true)).toBe(5); // nothing changed: stays
    expect(t.update([h(L, 6), h(R, 5)], true)).toBe(6); // the left changed last
    expect(t.update([h(L, 0), h(R, 5)], true)).toBe(5);
    expect(t.update([h(L, 0), h(R, 0)], true)).toBe(0);
  });
  it('analysis state off (point mode, tab changed): nothing, and it does not come back by itself', () => {
    const t = createHighlightTracker();
    expect(t.update([h(L, 0, 3)], true)).toBe(3);
    expect(t.update([h(L, 0, 3)], false)).toBe(0);
    expect(t.update([h(L, 0, 3)], true)).toBe(3); // the inputs still say so
    expect(t.update([h(L, 0, 0)], true)).toBe(0);
  });
  it('a hand that disappears (controller switched, hand tracking <-> controllers) releases its target', () => {
    const t = createHighlightTracker();
    expect(t.update([h(L, 0, 3), h(R, 0, 4)], true)).toBe(4);
    expect(t.update([h(L, 0, 3)], true)).toBe(3);
    expect(t.update([], true)).toBe(0);
    expect(t.update(undefined, true)).toBe(0);
  });
  it('reset forgets everything; no hands = none', () => {
    const t = createHighlightTracker();
    t.update([h(L, 0, 3)], true);
    t.reset();
    expect(t.update([], true)).toBe(0);
  });
});

describe('region-highlight: the wiring (source checks)', () => {
  const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('vr-view.js: the table gets the highlight in rgb only (never the alpha); nothing is added to the shader', () => {
    expect(vr).toContain("from './region-highlight.js");
    expect(vr).toContain('highlightIndex(hlEntries,highlightRid)');
    expect(vr).toContain("highlightColor(hlRgb,base,i===hlAt?'on':'other')");
    expect(vr).toContain('a[o]=c[0];a[o+1]=c[1];a[o+2]=c[2]');
    expect(vr).not.toMatch(/a\[o\+3\]=c\[/);
  });
  it('vr-view.js: the table is rewritten only when the highlighted result changes', () => {
    expect(vr).toContain('if(rid===highlightRid&&crid===highlightChildRid)return;highlightRid=rid;highlightChildRid=crid;');
    expect(vr).toContain('setRegionHighlight(hlTracker.update(hh,true),childList.length?hlChildTracker.update(hc,true):0)');
  });
  it('vr-view.js: the pinned card (analysis state only) wins; the hover is any shown result under the laser, pinned or not', () => {
    expect(vr).toContain('pinOk=analysisOn()');
    expect(vr).toContain('for(const rid of x.userData.hrids)if(rid>0)hover=rid;else hoverC=rid;');
    expect(vr).not.toContain('hover=hrid&&!pins.has(hrid)');
  });
  it('comment-3d.js: the label hover drives the volume\'s temporary focus; released on every redraw check', () => {
    const c = readFileSync(new URL('../../docs/comment-3d.js', import.meta.url), 'utf8');
    expect(c).toContain('mv?.setHoverFocus?.(runs)');
    expect(c).toContain('syncHoverFocus();refreshSoon()');
    expect(c).toMatch(/pruneAnalysisLabels\(keepA\);\n syncHoverFocus\(\);/);
  });
});

describe('webgl-volume: the temporary hover focus', () => {
  it('ORs into the focus bit only, leaves the page focus alone, and releases back to it', async () => {
    const { WebGlVolumeRenderer } = await import('../../docs/webgl-volume.js');
    const proto = WebGlVolumeRenderer.prototype;
    const runsA = [1], runsB = [2];
    const self = { hoverRuns: null, previewRuns: null, uniforms: {}, regionTexture: {}, regionsArgs: { regions: [{ runs: runsA, color: 1, focused: true, segments: [0] }, { runs: runsB, color: 2, focused: false, segments: [0] }] }, calls: 0, applyRegions() { this.calls++; } };
    const f = () => proto.regionItems.call(self).map(i => i.focused);
    expect(f()).toEqual([true, false]);
    proto.setHoverFocus.call(self, runsB);
    expect(f()).toEqual([true, true]); // the page's selection stays
    expect(self.calls).toBe(1);
    proto.setHoverFocus.call(self, runsB);
    expect(self.calls).toBe(1); // unchanged: no rewrite
    proto.setHoverFocus.call(self, null);
    expect(f()).toEqual([true, false]); // back to the page's selection
    expect(self.calls).toBe(2);
    self.previewRuns = {};
    proto.setHoverFocus.call(self, runsB);
    expect(self.calls).toBe(2); // a cut preview: the index is not rebuilt for a hover
  });
});
