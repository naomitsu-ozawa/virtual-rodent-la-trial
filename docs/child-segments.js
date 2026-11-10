// CHILD SEGMENTS: the segments a user adds under a preset segment in the tree (e.g. 34 bones under 骨, organs under 造影領域). A child segment is a REAL segment: it has every feature a preset card has
// (name, colour, show / hide, opacity, material, cut-face shading range, STL, section analysis, histogram, save / load); it is NOT an analysis region (analysis-ops.js regions are a separate list with their own meaning).
// Data: {id, key:'s<id>', name (custom, '' = default), parentKey (a preset), runsBySlice (the mask, the analysis run format: triples y, x0, x1 per slice), voxels, color ('#rrggbb'), visible,
//        opacity, material, shade ({lower, upper} | null = auto), hash (of the runs: the device cache key of the parent), shadeAuto? (never saved)}.
// The child's voxels belong to it: the parent segment is built WITHOUT them (segments.js: the child keys are among the parent's "sources", the voxel takers that are subtracted), so hiding a child makes its voxels
// invisible instead of showing the parent's surface there. Pure data + project (de)serialisation, no DOM, no three.js: unit-tested (tests/unit/child-segments.test.js).
import { childSegments, setChildSegments, setNextChildSegmentId, incNextChildSegmentId } from './state.js?v=20261110-build709';
import { childSegApplyLook, childSegLookToProject, childSegColorCss, childSegNormalizeName, isChildKey } from './segment-look.js?v=20261110-build709';
import { analysisRunsVoxelCount, unionAnalysisRuns, intersectRunArrays } from './run-length.js?v=20261110-build709';
// the parents a child can hang under = the preset keys (segments.js SEGMENT_PRESET_ORDER; asserted equal in the unit test: segments.js imports this module, so it cannot be imported here)
export const CHILD_PARENT_KEYS = ['bone', 'soft', 'fat', 'lung', 'contrast'];
// at most this many child segments (the GPU volume's index texture is r8uint: 0 = none, 1..255 = the child); more are refused by the button and left out of a project that has more
export const CHILD_SEG_MAX = 255;
export const childByKey = key => (isChildKey(key) ? childSegments.find(c => c.key === key) || null : null);
export const childrenOf = parentKey => childSegments.filter(c => c.parentKey === parentKey);
export const childKeysOf = parentKey => { const out = []; for (const c of childSegments) if (c.parentKey === parentKey) out.push(c.key); return out; };
export const hasChildSegments = () => childSegments.length > 0;
// FNV-1a over the runs (the cache key of a parent built without this child; also the revision of the mask)
export function childRunsHash(runsBySlice) {
  let h = 0x811c9dc5 | 0;
  for (let z = 0; z < (runsBySlice?.length || 0); z++) {
    const r = runsBySlice[z]; if (!r || !r.length) continue;
    h = Math.imul(h ^ (z + 1), 16777619);
    for (let i = 0; i < r.length; i++) h = Math.imul(h ^ r[i], 16777619);
  }
  return (h >>> 0).toString(16);
}
// the display name: the child's name, else the fallback (a string or a function of the child: "セグメント N")
export function childDisplayName(c, fallback = '') {
  const n = childSegNormalizeName(c?.name); if (n) return n;
  return typeof fallback === 'function' ? fallback(c) : fallback;
}
// a new child segment (not added to the list yet). src: {name?, parentKey, runsBySlice, color, visible??, material?, shade?, id?}; null when it holds no voxel or has no valid parent
export function makeChildSegment(src) {
  if (!src || !CHILD_PARENT_KEYS.includes(src.parentKey) || !Array.isArray(src.runsBySlice)) return null;
  const voxels = analysisRunsVoxelCount(src.runsBySlice); if (!voxels) return null;
  const id = src.id ?? incNextChildSegmentId(false);
  const c = { id, key: 's' + id, name: childSegNormalizeName(src.name), parentKey: src.parentKey, runsBySlice: src.runsBySlice, voxels, color: childSegColorCss(src.color), visible: src.visible !== false, hash: childRunsHash(src.runsBySlice) };
  return childSegApplyLook(c, src);
}
export function addChildSegment(src) {
  const c = makeChildSegment(src); if (!c) return null;
  childSegments.push(c); return c;
}
export function removeChildSegment(key) {
  const i = childSegments.findIndex(c => c.key === key); if (i < 0) return null;
  return childSegments.splice(i, 1)[0];
}
// the child's mask was edited (3D edit: segments.js segmentEditsChanged): the new final runs replace it; the voxel count and the hash (the cache key of the parent and of every renderer) follow. The listeners get kind 'edit'.
export function setChildRuns(key, runsBySlice) {
  const c = childByKey(key); if (!c || !Array.isArray(runsBySlice)) return null;
  c.runsBySlice = runsBySlice; c.voxels = analysisRunsVoxelCount(runsBySlice); c.hash = childRunsHash(runsBySlice);
  emitChildSegChange('edit', key, ['mask']);
  return c;
}
export function clearChildSegments() { const old = childSegments.slice(); setChildSegments([]); setNextChildSegmentId(1); return old; }

// the colours of new child segments (their own palette: the analysis regions' colour counter is never advanced by a child)
export const CHILD_SEG_COLORS = ['#00d8ff', '#ff9f1c', '#7ae582', '#ff4d8d', '#f4e409', '#9b5cff', '#ff5a5f', '#2ec4b6', '#4361ee', '#f15bb5', '#b5e48c', '#c08552', '#80ffdb', '#e0aaff'];
export const nextChildSegColor = () => CHILD_SEG_COLORS[childSegments.length % CHILD_SEG_COLORS.length];
// the ONE way a child comes to be (the user presses 「子セグメントを追加」 on a parent's row): a COPY of the mask of the given analysis regions (several = their union), under parentKey. The regions are not changed or removed.
// parentRuns (the parent's FINAL runs, per slice, without the voxels of its other children): the child's mask is cut to the voxels that really are the parent's (a child outside its parent's range would not be drawn by the volume
// shader and would show nothing). null = no cut (unit tests of the pure data). -> the child (added to the list) or null (no voxel left / no valid parent / already CHILD_SEG_MAX children)
export function addChildSegmentFromRegions(parentKey, regions, slices, parentRuns = null) {
  const list = (regions || []).filter(r => r?.runsBySlice);
  if (!list.length || !CHILD_PARENT_KEYS.includes(parentKey) || childSegments.length >= CHILD_SEG_MAX) return null;
  let union = list.length === 1 ? list[0].runsBySlice : unionAnalysisRuns(list, slices);
  if (parentRuns) union = intersectRunArrays(union, parentRuns, slices);
  const runsBySlice = Array.from(union, a => (a ? (a.slice ? a.slice() : Array.from(a)) : a)); // a copy: a later edit of the region never reaches the child
  return addChildSegment({ name: '', parentKey, runsBySlice, color: nextChildSegColor() });
}

// ---- project file: project.treeSegments = [{name?, parentKey, color, visible, opacity, material, shade, runs: <path of the run file>}] ----
// the entries of the list without the runs (data-load.js writes each run file and puts its path in `runs`)
export function childSegmentsForProject() {
  return childSegments.filter(c => c.runsBySlice && c.voxels > 0).map(c => {
    const e = { parentKey: c.parentKey, color: c.color, visible: c.visible !== false, ...childSegLookToProject(c) };
    if (c.name) e.name = c.name;
    return { entry: e, runsBySlice: c.runsBySlice };
  });
}
// an entry (and its decoded runs) -> the data of a child segment (makeChildSegment's src)
export function childSrcFromEntry(e, runsBySlice) {
  if (!e || typeof e !== 'object') return null;
  return { name: e.name, parentKey: e.parentKey, runsBySlice, color: e.color, visible: e.visible !== false, opacity: e.opacity, material: e.material, shade: e.shade };
}
// replace the list with the children of a project (a project without treeSegments leaves none); returns the made children
export function restoreChildSegments(srcs) {
  const old = clearChildSegments(), made = [];
  for (const s of srcs || []) { if (made.length >= CHILD_SEG_MAX) { console.warn('[child-segments] more than ' + CHILD_SEG_MAX + ' child segments in the project: the rest is left out'); break; } const c = addChildSegment(s); if (c) made.push(c); }
  return { old, made };
}

// ---- the change event of the child segments: ONE bus for every renderer / list (kind: 'list' = a child came / went / the list was replaced, 'look' = opacity / material / shade / visible / colour / name of one, key = the child) ----
const changeListeners = new Set();
export const onChildSegChange = fn => { changeListeners.add(fn); return () => changeListeners.delete(fn); };
export function emitChildSegChange(kind, key = null, changed = []) { for (const fn of [...changeListeners]) { try { fn({ kind, key, changed }); } catch (e) { console.warn('[child-segments]', e); } } }
