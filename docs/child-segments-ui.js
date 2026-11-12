// The child segments in the page: the lifecycle (a project load installs them, another dataset drops them, the user deletes one), their SURFACES in the mesh view and the follow-up of every look change.
// A child segment is drawn as a run surface of its own (surface-mesh.js buildEditableRunsGroup on its mask, its own colour / opacity / material), added to the scene beside the presets' surfaces; the parent preset is built WITHOUT the
// child's voxels (segments.js: the child keys are among the parent's sources), so hiding a child (group.visible = false) leaves those voxels EMPTY instead of showing the parent's surface there.
// Nothing here runs for data without child segments (every entry point returns at once when the list is empty).
import { childSegments, analysisRegions, analysisFocusedRegionId, sceneState, threeRenderMode, current3DVolume, volume, sourceVolume, currentLanguage } from './state.js?v=20261112-build727';
import { restoreChildSegments, clearChildSegments, removeChildSegment, childByKey, emitChildSegChange, onChildSegChange, addChildSegmentFromRegions, CHILD_SEG_MAX, setFocusedChildKey, childRepresentativeVoxel, childAtVoxel } from './child-segments.js?v=20261112-build727';
import { getFinalSegmentRuns } from './segment-runs.js?v=20261112-build727';
import { segmentExclusive, segmentById, childRenderEntries, childDrawLook, gpuSegmentSignature, requestChildShadeAuto, onChildSegLookChange, setChildLook, registerChildEditState, unregisterChildEditState } from './segments.js?v=20261112-build727';
import { buildEditableRunsGroup, dispose } from './surface-mesh.js?v=20261112-build727';
import { setSegmentMeshMaterial } from './mesh-material.js?v=20261112-build727';
import { childSurfaceHooks, inCurrentScene, applySectionClippingMaterials } from './surface-build.js?v=20261112-build727';
import { request3DRender } from './scene3d.js?v=20261112-build727';
import { makeSource3DCoordinates, makeVolume3DCoordinates } from './mesh-geometry.js?v=20261112-build727';
import { footer, planes } from './ui-shell.js?v=20261112-build727';
import { schedulePlaneRender } from './mpr-render.js?v=20261112-build727';
import { setAnalysisFocusedRegion } from './analysis-results.js?v=20261112-build727';
import { tr } from './i18n.js?v=20261112-build727';

const groups = new Map(); // child key -> { group, hash }
const listeners = new Set();
// fn() runs after the list of child segments changed (the tree rows redraw)
export const onChildSegmentsChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.warn('[child-segments]', e); } } emitChildSegChange('list'); };
// 2D / cut-face / histogram follow through hooks of their own (registered by their modules: no import of the painters here)
const repaint = { fn: null };
export const setChildRepaint = fn => { repaint.fn = fn; };

// a child's group is shown while the child is shown AND its parent is (segments.js segmentById.enabled)
export const childShownNow = c => !!segmentById(c.key)?.enabled;
function dropGroup(key) {
  const e = groups.get(key); if (!e) return;
  groups.delete(key); const g = e.group;
  if (g) { if (g.parent) g.parent.remove(g); dispose(g); }
}
export function disposeChildSurfaces() { for (const k of [...groups.keys()]) dropGroup(k); request3DRender(); }
const alive = c => childSegments.includes(c);
let building = Promise.resolve();
// build the missing surfaces (a child whose group is not in the current scene, or whose mask changed); sets the visibility of the others. Mesh view only: the GPU volume draws children from its own table.
export function ensureChildSurfaces(v = current3DVolume || volume) {
  if (!childSegments.length) { if (groups.size) disposeChildSurfaces(); return building; }
  building = building.then(async () => {
    if (!sceneState?.obj || !v || threeRenderMode === 'volume') return;
    for (const key of [...groups.keys()]) if (!childByKey(key)) dropGroup(key);
    for (const c of [...childSegments]) {
      const have = groups.get(c.key);
      if (groups.has(c.key)) setSegmentMeshMaterial(c.key, segmentById(c.key)?.material || 'standard');
      if (have && have.hash === c.hash && (!have.group || inCurrentScene(have.group))) { if (have.group) have.group.visible = childShownNow(c); continue; }
      dropGroup(c.key);
      setSegmentMeshMaterial(c.key, childDrawLook(c).material);
      let group = null;
      try { group = await buildEditableRunsGroup(v, c.runsBySlice, c.key, () => alive(c) && !!sceneState?.obj); }
      catch (e) { if (String(e?.message || e) !== '__SUPERSEDED__') console.error(e); continue; }
      if (!alive(c) || !sceneState?.obj) { if (group) dispose(group); continue; }
      groups.set(c.key, { group, hash: c.hash });
      if (group) { group.name = 'child_segment_' + c.key; group.visible = childShownNow(c); for (const m of group.children) m.userData.childKey = c.key; sceneState.obj.add(group); applySectionClippingMaterials(group); } // the section view (断面解析) cuts the child's surface too (a child built while the section is open / after it was moved: the WebGL clipping planes; WebGPU clips through the clip group)
      request3DRender();
    }
  }).catch(e => console.error(e));
  return building;
}
childSurfaceHooks.restore = v => (childSegments.length || groups.size ? ensureChildSurfaces(v) : null);
// the 3D edit of a child (analysis-ops.js, through surface-build.js refreshEditedSegmentSurface): its mask changed, so its hash did: the surface is rebuilt from the edited runs (mesh view; the GPU volume follows its own hand-off)
childSurfaceHooks.refresh = () => ensureChildSurfaces();
// the 3D edit changed a child's mask (segments.js segmentEditsChanged -> setChildRuns, kind 'edit'): the parent is built without / with the voxels again, the cut-face range is counted again, the tree rows and the views repaint
onChildSegChange(ev => {
  if (ev.kind !== 'edit') return;
  const c = childByKey(ev.key); if (!c) return;
  requestChildShadeAuto([c]); invalidateParents([c.parentKey]);
  for (const fn of [...listeners]) { try { fn(); } catch (e) { console.warn('[child-segments]', e); } }
  void ensureChildSurfaces(); repaint.fn?.(c, ['edited']); request3DRender();
});
// the parent preset was shown / hidden: its children follow (a child shown with a hidden parent is not drawn)
childSurfaceHooks.parentShown = (parentKey, on) => {
  if (!groups.size) return;
  for (const c of childSegments) { if (c.parentKey !== parentKey) continue; const e = groups.get(c.key); if (e?.group) e.group.visible = !!on && c.visible !== false; }
  request3DRender();
};

// the meshes follow a look change in place (the material preset is a uniform per key, the opacity / colour are the material's own)
function applyLookToMesh(c, changed) {
  const e = groups.get(c.key);
  if (changed.includes('material') || changed.includes('colorOff')) setSegmentMeshMaterial(c.key, childDrawLook(c).material);
  if (e?.group) {
    const look = segmentById(c.key) || { opacity: 1 }; // opacity: the parent's
    if (changed.includes('visible')) e.group.visible = childShownNow(c);
    e.group.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        if (changed.includes('opacity')) { m.opacity = look.opacity; const t = look.opacity < 0.999; if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; } m.depthWrite = look.opacity > 0.55; }
        if (changed.includes('color') || changed.includes('colorOff')) m.color?.set?.(childDrawLook(c).color); // colorOff: the parent's colour
      }
    });
  }
  request3DRender();
}
onChildSegLookChange((c, changed) => { applyLookToMesh(c, changed); repaint.fn?.(c, changed); });
// the parent's colour / material changed (its card): its colour-off children draw with it, so their meshes follow (the GPU volume follows through the signature of syncChildSegmentsToVolume, 2D reads the colour at each paint)
export function syncColorOffChildren(parentKey) {
  if (!childSegments.length) return;
  for (const c of childSegments) if (c.parentKey === parentKey && c.colorOff === true) applyLookToMesh(c, ['color', 'material']);
}

// the parents' voxels changed (a child came, went or changed its mask): they are rebuilt without / with it (the analysis results are not cleared)
function invalidateParents(parents) { for (const k of parents) { try { segmentExclusive.invalidateParent?.(k); } catch (e) { console.warn(e); } } }
// a project load: the list is replaced (srcs = makeChildSegment sources); the old surfaces go, the new ones are built with the 3D
export function installChildSegments(srcs) {
  const { old, made } = restoreChildSegments(srcs);
  for (const c of old) { dropGroup(c.key); unregisterChildEditState(c.key); }
  for (const c of made) registerChildEditState(c);
  if (made.length) requestChildShadeAuto(made);
  const parents = new Set([...old, ...made].map(c => c.parentKey));
  if (parents.size) invalidateParents(parents);
  emit();
  if (made.length) void ensureChildSurfaces();
  return made;
}
// FOCUS a child (its tree row, or a click on it in a 2D view; as setAnalysisFocusedRegion does for an analysis region): the focused analysis region is let go (one focus at a time), the three 2D slices move to the voxel (the one clicked, else the middle of the
// child; move = false keeps them) and the 2D views draw the child's frame (mpr-render.js drawAnalysisOverlay). false when the key is no child.
export function focusChildSegment(key, voxel = null, move = true) {
  const c = childByKey(key); if (!c) return false;
  if (analysisFocusedRegionId != null) setAnalysisFocusedRegion(null, null, false); // the region's focus look goes (it redraws the 2D views itself)
  setFocusedChildKey(key);
  const v = voxel || childRepresentativeVoxel(c);
  if (move && v && volume) {
    planes.axial.slider.value = Math.max(0, Math.min(+planes.axial.slider.max, v.z));
    planes.coronal.slider.value = Math.max(0, Math.min(+planes.coronal.slider.max, v.y));
    planes.sagittal.slider.value = Math.max(0, Math.min(+planes.sagittal.slider.max, v.x));
  }
  for (const p of Object.keys(planes)) schedulePlaneRender(p);
  request3DRender(); emit();
  return true;
}
// the shown child at a voxel of the 2D views (a click on it focuses it: app.js); null = none (shown = visible AND its parent shown, childShownNow)
export const shownChildAtVoxel = (x, y, z) => childAtVoxel(x, y, z, childShownNow);
// the user deletes a child: its voxels go back to the parent
export function deleteChildSegment(key) {
  const c = removeChildSegment(key); if (!c) return false;
  unregisterChildEditState(key); dropGroup(key); invalidateParents([c.parentKey]); emit(); request3DRender(); repaint.fn?.(c, ['removed']);
  return true;
}
// another dataset: no child segments (their meshes are gone with the scene; the list and the ids restart)
export function resetChildSegmentsForDataset() {
  if (!childSegments.length && !groups.size) return;
  for (const k of [...groups.keys()]) dropGroup(k);
  for (const c of childSegments) unregisterChildEditState(c.key);
  clearChildSegments(); emit();
}
export { setChildLook };

// the ONE way to make a child segment: the user presses 「子セグメントを追加」 on a parent's row. The mask = a COPY of the selected (ticked) analysis regions (several = their union); the regions stay as they are.
export const regionsSelectedForChild = () => analysisRegions.filter(r => r.selected && r.runsBySlice && r.voxels > 0);
// The child's mask is the selected regions' voxels that are the PARENT's (its final runs: its range, post-processing and edits, without its other children): what lies outside the parent is not taken. Refused (with a message in the footer) at CHILD_SEG_MAX children
// and when none of the selected voxels is the parent's.
export async function addChildSegmentFromSelectedRegions(parentKey) {
  const v = current3DVolume || volume, regs = regionsSelectedForChild(); if (!v || !regs.length) return null;
  if (childSegments.length >= CHILD_SEG_MAX) { footer.textContent = tr('childLimit'); return null; }
  let parentRuns = null;
  try { parentRuns = await getFinalSegmentRuns(parentKey, v); } catch (e) { if (String(e?.message || e) !== '__SUPERSEDED__') console.error(e); return null; }
  if (!parentRuns) return null;
  const c = addChildSegmentFromRegions(parentKey, regs, v.slices, parentRuns);
  if (!c) { footer.textContent = tr('childNoVoxels'); return null; }
  registerChildEditState(c); requestChildShadeAuto([c]); invalidateParents([parentKey]); emit(); void ensureChildSurfaces(); repaint.fn?.(c, ['added']);
  return c;
}
// ---- the GPU volume (medical-volume.js setChildSegments): the render hand-off childRenderEntries() goes to the volume whenever anything of a child changed; called once per rendered frame (app.js, beside syncVolumeAnalysisOverlay) and does
// nothing without child segments. The signature carries every look field, the mask hash, the parent's slot and the shown flags, so the volume rebuilds its index texture only when a mask changed. The cut face's shading range of a child comes
// from section.shade.ranges[key] (section-shade.js sectionShadeParams: allSegmentKeys, the children included).
let gpuSig = '';
export function syncChildSegmentsToVolume() {
  if (!childSegments.length && !gpuSig) return; // no child segment, none handed over: nothing to do (the usual data)
  const mv = sceneState?.medicalVolume;
  if (!mv || typeof mv.setChildSegments !== 'function') return;
  if (!childSegments.length) { gpuSig = ''; try { mv.setChildSegments([], null, ''); } catch (e) { console.warn(e); } return; }
  if (threeRenderMode !== 'volume' || !mv.active) return;
  const v = sourceVolume || volume; if (!v) return;
  const entries = childRenderEntries();
  // the grid the index texture is made for (as syncVolumeAnalysisOverlay's signature): another dataset / texture size / a reset of the volume sends the entries again
  const sig = (mv.seriesId || '') + '|' + (mv.textureDims || []).join('x') + '|' + (mv.dataGeneration | 0) + '|' + gpuSegmentSignature() + '|' + entries.map(e => [e.key, e.hash, e.color, e.opacity, e.material, e.shade ? e.shade.lower + ',' + e.shade.upper : '-', e.visible ? 1 : 0, e.parentSlot].join(':')).join(';');
  if (sig === gpuSig) return;
  gpuSig = sig;
  mv.onChildError = msg => { footer.textContent = tr('childGpuMemory') + msg; };
  try { mv.setChildSegments(entries, v, sig); } catch (e) { console.warn('GPU child segments failed.', e); mv.childError = String(e?.message || e); }
  if (mv.childError) mv.onChildError(mv.childError);
}
