import { describe, it, expect, beforeEach } from 'vitest';
import {
  createComment, sanitizeComments, commentMatchesSeries, commentTarget, commentVoxel,
  addComment, removeComment, getComments, setComments, onCommentsChange, commentsForProject, COMMENT_MAX_TEXT,
  updateCommentText, mergeComments, loadProjectComments, commentMarkers, COMMENT_NEAR_SLICES, markCommentsSaved, hasUnsavedComments, resetCommentsSaved, restoreComment,
} from '../../docs/comments.js';
import { datasetFingerprint, packProject, unpackProject } from '../../docs/project-file.js';

const mk = (uid, extra = {}) => ({ id: 's::' + uid, description: 'Mouse CT', modality: 'CT', columns: 16, rows: 16, spacingX: 0.1, spacingY: 0.1, spacingZ: 0.2, slices: Array.from({ length: 12 }, (_, i) => (i ? {} : { studyUid: 's', seriesUid: uid })), ...extra });
const fpA = datasetFingerprint(mk('1')), fpB = datasetFingerprint(mk('2'));

beforeEach(() => { setComments([]); resetCommentsSaved(); });

describe('create / save / restore a position', () => {
  it('keeps text, time, voxel position and the series', () => {
    const c = createComment({ text: 'nodule', position: { i: 3, j: 5, k: 4 }, series: fpA, now: Date.UTC(2026, 9, 5) });
    expect(c).toMatchObject({ text: 'nodule', position: { i: 3, j: 5, k: 4 }, createdAt: '2026-10-05T00:00:00.000Z', series: fpA });
    expect(typeof c.id).toBe('string');
  });
  it('rejects a missing / non-numeric position', () => {
    for (const p of [null, undefined, {}, { i: 1, j: 2 }, { i: 'a', j: 1, k: 1 }, { i: null, j: 1, k: 1 }]) expect(createComment({ text: 'x', position: p, series: fpA })).toBeNull();
    expect(commentVoxel({ i: 1.4, j: '2', k: 3 })).toEqual({ i: 1, j: 2, k: 3 });
  });
  it('limits the text length', () => {
    expect(createComment({ text: 'a'.repeat(COMMENT_MAX_TEXT + 50), position: { i: 0, j: 0, k: 0 }, series: fpA }).text).toHaveLength(COMMENT_MAX_TEXT);
  });
  it('round-trips through the project file (zip + JSON)', () => {
    addComment(createComment({ text: 'a', position: { i: 3, j: 5, k: 4 }, series: fpA, id: 'c1' }));
    addComment(createComment({ text: 'b', position: { i: 0, j: 15, k: 11 }, series: fpB, id: 'c2' }));
    const saved = commentsForProject(fpA);
    expect(saved.map(c => c.id)).toEqual(['c1']); // only the series being saved
    const { project } = unpackProject(packProject({ dataset: fpA, comments: saved }));
    setComments(project.comments);
    expect(getComments()).toEqual(saved);
    expect(getComments()[0].position).toEqual({ i: 3, j: 5, k: 4 });
  });
  it('sanitizeComments drops broken entries and fixes duplicate ids', () => {
    const out = sanitizeComments([{ id: 'x', position: { i: 1, j: 1, k: 1 } }, { id: 'x', text: 'y', position: { i: 2, j: 2, k: 2 } }, { position: { i: 'q' } }, null, 'str']);
    expect(out.map(c => c.position.i)).toEqual([1, 2]);
    expect(new Set(out.map(c => c.id)).size).toBe(2);
    expect(sanitizeComments('nope')).toEqual([]);
  });
});

describe('series match decides whether "view this place" is available', () => {
  const c = createComment({ text: 't', position: { i: 1, j: 1, k: 1 }, series: fpA });
  it('same series: enabled', () => expect(commentMatchesSeries(c, datasetFingerprint(mk('1')))).toBe(true));
  it('other series uid: disabled', () => expect(commentMatchesSeries(c, fpB)).toBe(false));
  it('other size: disabled', () => expect(commentMatchesSeries(c, datasetFingerprint(mk('1', { columns: 8 })))).toBe(false));
  it('no series on the comment or no open series: disabled', () => {
    expect(commentMatchesSeries({ ...c, series: null }, fpA)).toBe(false);
    expect(commentMatchesSeries(c, null)).toBe(false);
  });
});

describe('target position is clamped into the volume', () => {
  const dims = { columns: 16, rows: 16, slices: 12 };
  it('inside: unchanged', () => expect(commentTarget({ position: { i: 3, j: 5, k: 4 } }, dims)).toEqual({ i: 3, j: 5, k: 4 }));
  it('outside: clamped, not rejected', () => expect(commentTarget({ position: { i: 99, j: -4, k: 12 } }, dims)).toEqual({ i: 15, j: 0, k: 11 }));
  it('no volume: null', () => expect(commentTarget({ position: { i: 1, j: 1, k: 1 } }, null)).toBeNull());
});

describe('store', () => {
  it('add / remove notify listeners and getComments returns copies', () => {
    let n = 0; const off = onCommentsChange(() => n++);
    const c = addComment(createComment({ text: 'a', position: { i: 1, j: 2, k: 3 }, series: fpA }));
    getComments()[0].position.i = 99;
    expect(getComments()[0].position.i).toBe(1);
    expect(removeComment(c.id)).toBe(true); expect(removeComment(c.id)).toBe(false);
    expect(n).toBe(2); off();
  });
});

describe('loading a project merges, it never drops comments in memory', () => {
  const mkc = (id, series, text = id) => createComment({ id, text, position: { i: 1, j: 2, k: 3 }, series });
  it('keeps an unsaved comment of the same series and one of another series', () => {
    addComment(mkc('c1', fpA)); addComment(mkc('c2', fpA)); addComment(mkc('b1', fpB));
    loadProjectComments([mkc('c1', fpA)], fpA);
    expect(getComments().map(c => c.id).sort()).toEqual(['b1', 'c1', 'c2']);
  });
  it('adds what only the file has; a comment deleted since the save comes back (no data lost)', () => {
    addComment(mkc('c2', fpA));
    loadProjectComments([mkc('c1', fpA), mkc('c2', fpA)], fpA);
    expect(getComments().map(c => c.id).sort()).toEqual(['c1', 'c2']);
    expect(mergeComments([], [mkc('x', fpA)], fpA).map(c => c.id)).toEqual(['x']);
  });
  it('an incoming id used by a comment of another series gets a new id', () => {
    addComment(mkc('dup', fpB, 'mine on B'));
    loadProjectComments([mkc('dup', fpA, 'from file')], fpA);
    const l = getComments();
    expect(l).toHaveLength(2);
    expect(l.find(c => c.text === 'mine on B').id).toBe('dup');
    expect(l.find(c => c.text === 'from file').id).not.toBe('dup');
  });
});

describe('unsaved comment changes', () => {
  const mkc = (id, series) => createComment({ id, text: id, position: { i: 1, j: 1, k: 1 }, series });
  it('clean at start; add / delete make it dirty; save or load makes it clean', () => {
    expect(hasUnsavedComments()).toBe(false);
    addComment(mkc('c1', fpA)); expect(hasUnsavedComments()).toBe(true);
    markCommentsSaved(fpA); expect(hasUnsavedComments()).toBe(false);
    const c = getComments()[0]; removeComment('c1'); expect(hasUnsavedComments()).toBe(true);
    restoreComment(c, 0); expect(hasUnsavedComments()).toBe(false); // undo: back to what was saved
    removeComment('c1'); markCommentsSaved(fpA); expect(hasUnsavedComments()).toBe(false);
  });
  it('a comment of another series is never saved with this project: stays unsaved', () => {
    addComment(mkc('b1', fpB)); markCommentsSaved(fpA); expect(hasUnsavedComments()).toBe(true);
  });
  it('after loading, comments only in memory still count as unsaved', () => {
    addComment(mkc('c2', fpA)); loadProjectComments([mkc('c1', fpA)], fpA);
    expect(hasUnsavedComments()).toBe(true);
  });
  it('restoreComment puts the comment back at its place and refuses a duplicate', () => {
    addComment(mkc('a', fpA)); addComment(mkc('b', fpA)); addComment(mkc('c', fpA));
    const b = getComments()[1]; removeComment('b');
    expect(restoreComment(b, 1)).toBe(true);
    expect(getComments().map(c => c.id)).toEqual(['a', 'b', 'c']);
    expect(restoreComment(b, 1)).toBe(false);
  });
});

describe('markers on the planes', () => {
  const dims = { columns: 16, rows: 16, slices: 12 };
  const a = createComment({ text: 'a', position: { i: 3, j: 5, k: 4 }, series: fpA, id: 'a' });
  const b = createComment({ text: 'b', position: { i: 8, j: 8, k: 9 }, series: fpB, id: 'b' });
  const c = createComment({ text: 'c', position: { i: 3, j: 6, k: 6 }, series: fpA, id: 'c' });
  const all = [a, b, c];
  it('exact when the slice on show is the comment slice, numbered by the place in the whole list', () => {
    const m = commentMarkers('axial', all, fpA, 4, dims);
    expect(m.map(x => [x.id, x.number, x.exact])).toEqual([['a', 1, true], ['c', 3, false]]);
    expect(m[0].fx).toBeCloseTo(3.5 / 16); expect(m[0].fy).toBeCloseTo(5.5 / 16);
  });
  it('uses each plane\'s own axis (coronal: j, sagittal: i)', () => {
    expect(commentMarkers('coronal', all, fpA, 5, dims).map(x => [x.id, x.exact])).toEqual([['a', true], ['c', false]]);
    expect(commentMarkers('sagittal', all, fpA, 3, dims).filter(x => x.exact).map(x => x.id)).toEqual(['a', 'c']);
  });
  it('nothing beyond the near range; the boundary is inclusive', () => {
    expect(commentMarkers('axial', [a], fpA, 4 + COMMENT_NEAR_SLICES, dims)).toHaveLength(1);
    expect(commentMarkers('axial', [a], fpA, 4 + COMMENT_NEAR_SLICES + 1, dims)).toHaveLength(0);
    expect(commentMarkers('axial', [a], fpA, 4 - COMMENT_NEAR_SLICES - 1, dims)).toHaveLength(0);
  });
  it('another series, no open series or no volume: no markers', () => {
    expect(commentMarkers('axial', [b], fpA, 9, dims)).toEqual([]);
    expect(commentMarkers('axial', all, null, 4, dims)).toEqual([]);
    expect(commentMarkers('axial', all, fpA, 4, null)).toEqual([]);
  });
  it('a position outside the volume is clamped, not dropped', () => {
    const o = createComment({ text: 'o', position: { i: 99, j: 0, k: 50 }, series: fpA, id: 'o' });
    expect(commentMarkers('axial', [o], fpA, 11, dims)[0]).toMatchObject({ exact: true });
  });
});

describe('editing the text', () => {
  const mkc = (id, text = 'old') => createComment({ id, text, position: { i: 3, j: 4, k: 5 }, series: fpA, now: 1700000000000 });
  it('changes the text only and notifies listeners', () => {
    addComment(mkc('e1')); const before = getComments()[0]; let n = 0, seen = null;
    const off = onCommentsChange(l => { n++; seen = l; });
    const r = updateCommentText('e1', 'new text');
    off();
    expect(r.text).toBe('new text'); expect(n).toBe(1); expect(seen[0].text).toBe('new text');
    const after = getComments()[0];
    expect(after.position).toEqual(before.position); expect(after.createdAt).toBe(before.createdAt); expect(after.series).toEqual(before.series); expect(after.id).toBe('e1');
  });
  it('refuses blank text and unknown ids, and does not notify for unchanged text', () => {
    addComment(mkc('e1')); let n = 0; const off = onCommentsChange(() => n++);
    expect(updateCommentText('e1', '')).toBeNull(); expect(updateCommentText('e1', '  \n ')).toBeNull(); expect(updateCommentText('nope', 'x')).toBeNull();
    expect(updateCommentText('e1', 'old')).not.toBeNull();
    off(); expect(n).toBe(0); expect(getComments()[0].text).toBe('old');
  });
  it('is cut at the maximum length', () => {
    addComment(mkc('e1')); expect(updateCommentText('e1', 'x'.repeat(COMMENT_MAX_TEXT + 50)).text.length).toBe(COMMENT_MAX_TEXT);
  });
  it('marks the project unsaved, and editing back to the saved text is clean again', () => {
    addComment(mkc('e1')); markCommentsSaved(fpA); expect(hasUnsavedComments()).toBe(false);
    updateCommentText('e1', 'changed'); expect(hasUnsavedComments()).toBe(true);
    updateCommentText('e1', 'old'); expect(hasUnsavedComments()).toBe(false);
  });
  it('survives a save / load round trip with the position unchanged', () => {
    addComment(mkc('e1')); updateCommentText('e1', 'edited');
    const written = commentsForProject(fpA);
    const { project } = unpackProject(packProject({ dataset: fpA, comments: written }));
    const got = sanitizeComments(project.comments);
    expect(got[0].text).toBe('edited'); expect(got[0].position).toEqual({ i: 3, j: 4, k: 5 }); expect(got[0].createdAt).toBe(written[0].createdAt);
  });
});

import { updateCommentPosition } from '../../docs/comments.js';
describe('updateCommentPosition', () => {
  const add = () => addComment(createComment({ text: 'a', position: { i: 1, j: 2, k: 3 }, series: fpA, id: 'm1', now: Date.UTC(2026, 9, 5) }));
  it('changes the position only', () => {
    add(); const r = updateCommentPosition('m1', { i: 4, j: 5, k: 6 });
    expect(r).toMatchObject({ id: 'm1', text: 'a', createdAt: '2026-10-05T00:00:00.000Z', series: fpA, position: { i: 4, j: 5, k: 6 } });
    expect(getComments()[0].position).toEqual({ i: 4, j: 5, k: 6 });
  });
  it('null for an invalid voxel or unknown id', () => {
    add(); expect(updateCommentPosition('m1', { i: 'x', j: 1, k: 1 })).toBeNull(); expect(updateCommentPosition('m1', null)).toBeNull();
    expect(updateCommentPosition('nope', { i: 1, j: 1, k: 1 })).toBeNull(); expect(getComments()[0].position).toEqual({ i: 1, j: 2, k: 3 });
  });
  it('emits only when it changed, and counts as unsaved', () => {
    add(); markCommentsSaved(fpA); let n = 0; const off = onCommentsChange(() => n++);
    updateCommentPosition('m1', { i: 1, j: 2, k: 3 }); expect(n).toBe(0); expect(hasUnsavedComments()).toBe(false);
    updateCommentPosition('m1', { i: 2, j: 2, k: 3 }); expect(n).toBe(1); expect(hasUnsavedComments()).toBe(true); off();
  });
});
