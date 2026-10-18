import { describe, it, expect, beforeEach } from 'vitest';
import { POINT_PALETTE, POINT_RESERVED_LIST, normalizeColor, pointKey, autoPointColor, pointColor, darkFill, inkOn } from '../../docs/point-colors.js';
import { setComments, getComments, addComment, createComment, removeComment, sanitizeComments, updateCommentColor, commentsForProject, commentMarkers, restoreComment, hasUnsavedComments, markCommentsSaved, resetCommentsSaved } from '../../docs/comments.js';
import { recordVrPoint, createUndoStack, applyUndo } from '../../docs/vr-point.js';
import { createRingMenu, wheelSlotFromAngle } from '../../docs/vr-ring.js';
import { datasetFingerprint } from '../../docs/project-file.js';

// CIE Lab distance (D65), to say "not confusable" with a number
const lab = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) };
const mk = uid => ({ id: 's::' + uid, description: 'synthetic', modality: 'CT', columns: 10, rows: 8, spacingX: 1, spacingY: 1, spacingZ: 2, slices: Array.from({ length: 6 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: uid })) });
const fp = datasetFingerprint(mk('1'));
const dims = { columns: 10, rows: 8, slices: 6 };

describe('point palette', () => {
  it('has 8 valid, distinct colours', () => {
    expect(POINT_PALETTE).toHaveLength(8);
    for (const p of POINT_PALETTE) expect(normalizeColor(p.hex)).toBe(p.hex);
    expect(new Set(POINT_PALETTE.map(p => p.hex)).size).toBe(8);
  });
  it('keeps away from the reserved colours (selection yellow, white, sections, hands, cursor lime)', () => {
    expect(POINT_RESERVED_LIST).toContain('#ffd23d');
    expect(POINT_RESERVED_LIST).toContain('#8dff4a');
    for (const p of POINT_PALETTE) for (const r of POINT_RESERVED_LIST) expect(dE(p.hex, r), p.hex + ' vs ' + r).toBeGreaterThan(20);
  });
  it('the colours differ from each other', () => {
    for (const a of POINT_PALETTE) for (const b of POINT_PALETTE) if (a !== b) expect(dE(a.hex, b.hex), a.hex + ' vs ' + b.hex).toBeGreaterThan(24);
  });
  it('derived dark fill and ink', () => {
    expect(darkFill('#ffffff')).toBe(0xcccccc);
    expect(inkOn('#ffffff')).toBe('#04202a');
    expect(inkOn('#1e88ff') === '#04202a' || inkOn('#1e88ff') === '#ffffff').toBe(true);
  });
});

describe('stable auto colour', () => {
  it('follows the recorded number, not the list position', () => {
    setComments([]);
    const store = { getComments, addComment };
    const recs = [1, 2, 3, 4].map(() => recordVrPoint({ voxel: { i: 1, j: 1, k: 1 }, series: fp, store }));
    const before = recs.map(r => pointColor(r));
    expect(new Set(before).size).toBe(4);
    removeComment(recs[0].id); // the others are renumbered in the list, but keep their colour
    expect(getComments().map(pointColor)).toEqual(before.slice(1));
    // the next one is 5, the colour of number 5 (never a repeat of a deleted one's number)
    const r5 = recordVrPoint({ voxel: { i: 2, j: 2, k: 2 }, series: fp, store });
    expect(pointKey(r5)).toBe(5);
    expect(pointColor(r5)).toBe(POINT_PALETTE[4].hex);
  });
  it('wraps round the palette and handles other texts (hash of the id)', () => {
    expect(autoPointColor({ text: 'VR ポイント 9', id: 'x' })).toBe(POINT_PALETTE[0].hex);
    expect(autoPointColor({ text: 'VR point 3', id: 'x' })).toBe(POINT_PALETTE[2].hex);
    const a = autoPointColor({ text: 'my note', id: 'c-abc' });
    expect(autoPointColor({ text: 'changed note', id: 'c-abc' })).toBe(a); // stable for the same id
    expect(POINT_PALETTE.map(p => p.hex)).toContain(a);
  });
  it('an own colour wins; markers carry the colour', () => {
    const c = createComment({ text: 'VR ポイント 1', position: { i: 2, j: 3, k: 1 }, series: fp });
    setComments([c]);
    updateCommentColor(c.id, '#A64DFF');
    expect(getComments()[0].color).toBe('#a64dff');
    expect(commentMarkers('axial', getComments(), fp, 1, dims)[0].color).toBe('#a64dff');
    updateCommentColor(c.id, null);
    expect('color' in getComments()[0]).toBe(false);
    expect(commentMarkers('axial', getComments(), fp, 1, dims)[0].color).toBe(POINT_PALETTE[0].hex);
  });
});

describe('colour in the store, the project and the undo', () => {
  beforeEach(() => { setComments([]); resetCommentsSaved() });
  const base = { position: { i: 1, j: 2, k: 3 }, series: fp };
  it('normalisation keeps a valid colour and drops an invalid one', () => {
    const out = sanitizeComments([
      { id: 'a', text: 'a', ...base, color: '#19D3EE' }, { id: 'b', text: 'b', ...base, color: 'red' }, { id: 'c', text: 'c', ...base, color: 5 },
      { id: 'd', text: 'd', ...base, color: '#12345' }, { id: 'e', text: 'e', ...base },
    ]);
    expect(out.map(c => c.color)).toEqual(['#19d3ee', undefined, undefined, undefined, undefined]);
    expect(out.slice(1).every(c => !('color' in c))).toBe(true);
  });
  it('updateCommentColor refuses garbage, keeps the other fields, and an unchanged colour is not a change', () => {
    const c = createComment({ text: 't', ...base });
    setComments([c]);
    expect(updateCommentColor(c.id, 'blue')).toBeNull();
    expect(updateCommentColor('nope', '#19d3ee')).toBeNull();
    updateCommentColor(c.id, '#19d3ee');
    const first = getComments()[0];
    expect(first).toMatchObject({ text: 't', position: base.position, color: '#19d3ee' });
  });
  it('round-trips through the project (JSON) and old projects without colour get the auto colour', () => {
    const a = createComment({ text: 'VR ポイント 2', ...base }), b = createComment({ text: 'VR ポイント 3', ...base });
    setComments([a, b]);
    updateCommentColor(a.id, '#e23fe0');
    const json = JSON.parse(JSON.stringify(commentsForProject(fp)));
    const back = sanitizeComments(json);
    expect(back.find(c => c.id === a.id).color).toBe('#e23fe0');
    expect('color' in back.find(c => c.id === b.id)).toBe(false);
    expect(pointColor(back.find(c => c.id === b.id))).toBe(POINT_PALETTE[2].hex);
  });
  it('a colour change counts as an unsaved change; restoring a deleted point keeps its colour', () => {
    const a = createComment({ text: 'VR ポイント 1', ...base });
    setComments([a]); markCommentsSaved(fp);
    expect(hasUnsavedComments()).toBe(false);
    updateCommentColor(a.id, '#2fbf4f');
    expect(hasUnsavedComments()).toBe(true);
    const c = getComments()[0]; removeComment(a.id); restoreComment(c, 0);
    expect(getComments()[0].color).toBe('#2fbf4f');
  });
  it('the undo of a colour change puts the old colour (or auto) back', () => {
    const a = createComment({ text: 'VR ポイント 1', ...base });
    setComments([a]);
    const undo = createUndoStack(), store = { updateCommentColor };
    updateCommentColor(a.id, '#1e88ff'); undo.push({ type: 'color', id: a.id, from: null, to: '#1e88ff' });
    updateCommentColor(a.id, '#ff3d8b'); undo.push({ type: 'color', id: a.id, from: '#1e88ff', to: '#ff3d8b' });
    expect(applyUndo(undo.pop(), store)).toBe(true);
    expect(getComments()[0].color).toBe('#1e88ff');
    expect(applyUndo(undo.pop(), store)).toBe(true);
    expect('color' in getComments()[0]).toBe(false);
  });
});

describe('colour ring', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
  it('a swatch ring of auto + the palette is drawn and hit-tested as nine annular sectors', async () => {
    const THREE = await import('three');
    const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    globalThis.document = doc;
    try {
      const ring = createRingMenu(THREE);
      const items = [{ color: '#26313b', text: '自動', name: '自動' }, ...POINT_PALETTE.map(p => ({ color: p.hex, name: p.ja }))];
      ring.setItems(items, items.map(() => true), items.map((_, k) => k === 2));
      expect(ring.n()).toBe(9);
      ring.setHighlight(3);
      // the top item's centre is at uv (0.5, 0.5 + radius): hit; a point between two items is not
      const R = 0.055 / 0.16;
      expect(ring.slotFromUv({ x: 0.5, y: 0.5 + R })).toBe(0);
      const at = (deg, px) => ({ x: 0.5 + px / 512 * Math.sin(deg * Math.PI / 180), y: 0.5 + px / 512 * Math.cos(deg * Math.PI / 180) });
      expect(ring.slotFromUv(at(30, 170))).toBe(1);   // nine sectors of 40 deg: 30 deg is inside the second one
      expect(ring.slotFromUv(at(20, 170))).toBe(null); // the gap between the first and the second
      expect(wheelSlotFromAngle(0, 9, items.map(() => true))).toBe(0);
      expect(wheelSlotFromAngle(80, 9, items.map(() => true))).toBe(2);
    } finally { delete globalThis.document }
  });
});

describe('the point ring offers 色 (static check of vr-view.js)', () => {
  it('the point ring has a colour item that opens a palette ring, and the change is undoable', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toContain("['move','delete','color','distance']");
    expect(src).toContain("const COLOR_IDS=['auto',...POINT_PALETTE.map(p=>p.hex)]");
    expect(src).toContain("undo.push({type:'color'");
    expect(src).toContain('updateCommentPosition,updateCommentColor,removeMeasurement,restoreMeasurements}');
  });
});

describe('the auto colour is fixed when the point is recorded (autoKey)', () => {
  beforeEach(() => { setComments([]); resetCommentsSaved() });
  it('editing the text of a VR point keeps its colour; typing another number does not adopt that colour', async () => {
    const { updateCommentText, nextAutoKey } = await import('../../docs/comments.js');
    const store = { getComments, addComment };
    const r3 = [1, 2, 3].map(() => recordVrPoint({ voxel: { i: 1, j: 1, k: 1 }, series: fp, store }))[2];
    expect(r3.autoKey).toBe(3);
    const c3 = pointColor(r3);
    updateCommentText(r3.id, '腫瘍');
    expect(pointColor(getComments().find(c => c.id === r3.id))).toBe(c3);
    // a PC-added point gets the next free key; typing 「VR ポイント 2」 as its text changes nothing
    const pc = addComment(createComment({ id: 'pc-1', text: 'memo', position: { i: 2, j: 2, k: 2 }, series: fp, autoKey: nextAutoKey(getComments()) }));
    expect(pc.autoKey).toBe(4);
    const before = pointColor(pc);
    updateCommentText(pc.id, 'VR ポイント 2');
    expect(pointColor(getComments().find(c => c.id === pc.id))).toBe(before);
    expect(before).toBe(POINT_PALETTE[3].hex);
  });
  it('a legacy point (no autoKey) keeps its colour after an edit; the key is stored then', async () => {
    const { updateCommentText } = await import('../../docs/comments.js');
    const legacy = [
      { id: 'a', text: 'VR ポイント 2', position: { i: 1, j: 1, k: 1 }, series: fp, createdAt: '' },
      { id: 'b', text: 'note', position: { i: 1, j: 1, k: 1 }, series: fp, createdAt: '' },
    ];
    setComments(legacy);
    const want = getComments().map(pointColor);
    updateCommentText('a', 'xyz'); updateCommentText('b', 'VR ポイント 7');
    expect(getComments().map(pointColor)).toEqual(want);
    expect(getComments().map(c => c.autoKey)).toEqual([2, expect.any(Number)]);
  });
  it('sanitize keeps a valid autoKey, drops invalid ones; it round-trips and is part of the dirty signature', () => {
    const b = { text: 't', position: { i: 1, j: 1, k: 1 }, series: fp };
    const out = sanitizeComments([{ id: 'a', ...b, autoKey: 5 }, { id: 'b', ...b, autoKey: -1 }, { id: 'c', ...b, autoKey: 1.5 }, { id: 'd', ...b, autoKey: '3' }, { id: 'e', ...b, autoKey: 0 }]);
    expect(out.map(c => c.autoKey)).toEqual([5, undefined, undefined, undefined, 0]);
    setComments(out);
    expect(sanitizeComments(JSON.parse(JSON.stringify(commentsForProject(fp)))).map(c => c.autoKey)).toEqual([5, undefined, undefined, undefined, 0]);
    markCommentsSaved(fp); expect(hasUnsavedComments()).toBe(false);
  });
});
