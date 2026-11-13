import { childSegments, setChildSegments, setNextChildSegmentId, incNextChildSegmentId } from './state.js?v=20261112-build729';
import { childSegColorCss, childSegNormalizeName, isChildKey } from './segment-look.js?v=20261112-build729';
import { analysisRunsVoxelCount, unionAnalysisRuns, intersectRunArrays, analysisRunsContain } from './run-length.js?v=20261112-build729';
import { normalizeAnalysisLabel, labelForProject } from './analysis-label.js?v=20261112-build729';
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
// a new child segment (not added to the list yet). src: {name?, parentKey, runsBySlice, color, visible??, colorOff?, label?, id?}; null when it holds no voxel or has no valid parent
export function makeChildSegment(src) {
  if (!src || !CHILD_PARENT_KEYS.includes(src.parentKey) || !Array.isArray(src.runsBySlice)) return null;
  const voxels = analysisRunsVoxelCount(src.runsBySlice); if (!voxels) return null;
  const id = src.id ?? incNextChildSegmentId(false);
  const c = { id, key: 's' + id, name: childSegNormalizeName(src.name), parentKey: src.parentKey, runsBySlice: src.runsBySlice, voxels, color: childSegColorCss(src.color), visible: src.visible !== false, colorOff: src.colorOff === true, hash: childRunsHash(src.runsBySlice) };
  const lb = normalizeAnalysisLabel(src.label); if (lb) c.label = lb; // the pinned name label (a project file: untrusted, cleaned)
  return c;
}
export function addChildSegment(src) {
  const c = makeChildSegment(src); if (!c) return null;
  childSegments.push(c); return c;
}
export function removeChildSegment(key) {
  const i = childSegments.findIndex(c => c.key === key); if (i < 0) return null;
  if (focusedChildKey === key) focusedChildKey = null;
  return childSegments.splice(i, 1)[0];
}
// the child's mask was edited (3D edit: segments.js segmentEditsChanged): the new final runs replace it; the voxel count and the hash (the cache key of the parent and of every renderer) follow. The listeners get kind 'edit'.
export function setChildRuns(key, runsBySlice) {
  const c = childByKey(key); if (!c || !Array.isArray(runsBySlice)) return null;
  c.runsBySlice = runsBySlice; c.voxels = analysisRunsVoxelCount(runsBySlice); c.hash = childRunsHash(runsBySlice);
  emitChildSegChange('edit', key, ['mask']);
  return c;
}
export function clearChildSegments() { const old = childSegments.slice(); focusedChildKey = null; setChildSegments([]); setNextChildSegmentId(1); return old; }

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

// ---- project file: project.treeSegments = [{name?, parentKey, color, visible, colorOff (boolean; a file without it = false), label?: {anchor, offset?}, runs: <path of the run file>}] ----
// the entries of the list without the runs (data-load.js writes each run file and puts its path in `runs`)
export function childSegmentsForProject() {
  return childSegments.filter(c => c.runsBySlice && c.voxels > 0).map(c => {
    const e = { parentKey: c.parentKey, color: c.color, visible: c.visible !== false, colorOff: c.colorOff === true };
    if (c.name) e.name = c.name;
    const lb = labelForProject(c); if (lb) e.label = lb; // the pinned name label (no label = not pinned: an older project file has none)
    return { entry: e, runsBySlice: c.runsBySlice };
  });
}
// an entry (and its decoded runs) -> the data of a child segment (makeChildSegment's src)
export function childSrcFromEntry(e, runsBySlice) {
  if (!e || typeof e !== 'object') return null;
  return { name: e.name, parentKey: e.parentKey, runsBySlice, color: e.color, visible: e.visible !== false, colorOff: e.colorOff === true, label: e.label };
}
// replace the list with the children of a project (a project without treeSegments leaves none); returns the made children
export function restoreChildSegments(srcs) {
  const old = clearChildSegments(), made = [];
  for (const s of srcs || []) { if (made.length >= CHILD_SEG_MAX) { console.warn('[child-segments] more than ' + CHILD_SEG_MAX + ' child segments in the project: the rest is left out'); break; } const c = addChildSegment(s); if (c) made.push(c); }
  return { old, made };
}

// ---- the FOCUSED child (a click on its row of the tree or on it in a 2D view): the 2D views draw its frame (mpr-render.js), like the focused analysis region's. null = none. Not saved. ----
let focusedChildKey = null;
export const getFocusedChildKey = () => focusedChildKey;
// -> true when the focus changed
export function setFocusedChildKey(key) { const k = key && childByKey(key) ? key : null; if (k === focusedChildKey) return false; focusedChildKey = k; return true; }
// a voxel of the child's mask in the middle of it (the place the focus moves the 2D slices to; the analysis regions' rule: the middle non-empty slice, the middle run, its middle voxel) -> {x, y, z} | null
export function childRepresentativeVoxel(c) {
  const runs = c?.runsBySlice; if (!runs) return null;
  const zs = []; for (let z = 0; z < runs.length; z++) if (runs[z]?.length) zs.push(z);
  if (!zs.length) return null;
  const z = zs[Math.floor(zs.length / 2)], rec = runs[z], i = Math.floor((rec.length / 3) / 2) * 3;
  return { x: Math.floor((rec[i + 1] + rec[i + 2]) / 2), y: rec[i], z };
}
// the child whose mask holds the voxel (x, y, z) among those the caller says are shown (isShown(c) -> boolean; null = all): the focused one first, then the last of the list (the one drawn on top in 2D); null when none
export function childAtVoxel(x, y, z, isShown = null) {
  const ok = c => c?.runsBySlice && (!isShown || isShown(c)) && analysisRunsContain(c.runsBySlice, x, y, z);
  const f = focusedChildKey ? childByKey(focusedChildKey) : null; if (ok(f)) return f;
  for (let i = childSegments.length - 1; i >= 0; i--) if (ok(childSegments[i])) return childSegments[i];
  return null;
}
// the volume of a child in mm3 (voxels x the voxel size; spacing = [x, y, z] in mm) -> number | null
export const childVolumeMm3 = (c, spacing) => (c && Array.isArray(spacing) && spacing.length >= 3 && spacing.every(v => Number.isFinite(+v) && +v > 0) ? c.voxels * spacing[0] * spacing[1] * spacing[2] : null);

// ---- the change event of the child segments: ONE bus for every renderer / list (kind: 'list' = a child came / went / the list was replaced, 'look' = opacity / material / shade / visible / colour / name of one, key = the child) ----
const changeListeners = new Set();
export const onChildSegChange = fn => { changeListeners.add(fn); return () => changeListeners.delete(fn); };
export function emitChildSegChange(kind, key = null, changed = []) { for (const fn of [...changeListeners]) { try { fn({ kind, key, changed }); } catch (e) { console.warn('[child-segments]', e); } } }
