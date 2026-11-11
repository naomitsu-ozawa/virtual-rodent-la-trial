// 3D EDIT OF A CHILD SEGMENT (the cut tools). The child has an edit state of the preset's shape (segments.js registerChildEditState), so keep / delete selected, undo / redo / reset run through analysis-ops.js unchanged (the edits are applied to the
// child's own runs by segments.js segmentEditsChanged). The one thing analysis-ops.js applyCutStroke refuses is a key that is not a preset: this is its twin for a child key (the same steps and the same cut voxels, the same messages), used by the
// cut plan's apply button (app.js) for a child target. The history fallback of undo / redo (a child with a history when no preset target is known) is here too. Imported only by app.js: analysis-ops.js does not import this file.
import { sceneState, threeRenderMode, current3DVolume, volume, sourceVolume, currentLanguage, childSegments, analysisEditTargetKey, setAnalysisEditTargetKey, analysisFocusedRegionId } from './state.js?v=20261111-build715';
import { SEGMENT_PRESET_ORDER, segmentEditState, segmentEditsChanged, segmentById } from './segments.js?v=20261111-build715';
import { isChildKey } from './segment-look.js?v=20261111-build715';
import { childByKey } from './child-segments.js?v=20261111-build715';
import { cutRunsFromVoxelStroke, cutWidthMm, updateThreeEditUi, analysisRegionById, childHistoryKey } from './edit-tools.js?v=20261111-build715';
import { pushEditUndo, snapshotAnalysisRegionsForSegment, trimAnalysisRegionsAfterEdit, rebuildEditedAnalysisForSegment, clearThreeEditOverlay } from './analysis-ops.js?v=20261111-build715';
import { refreshEditedSegmentSurface } from './surface-build.js?v=20261111-build715';
import { syncGpuVolumeEdits } from './gpu-volume-data.js?v=20261111-build715';
import { surfaceEditsPending } from './rebuild-3d.js?v=20261111-build715';
import { analysisCutDepth, analysisCutYaw, analysisCutPitch, analysisCutOffset, footer } from './ui-shell.js?v=20261111-build715';
import { analysisRunsVoxelCount, unionRunArrays } from './run-length.js?v=20261111-build715';
import { request3DRender } from './scene3d.js?v=20261111-build715';

// the cut plan of the pen / line tool is applied to the child: its cut voxels leave the child (they go back to its parent). true = applied
export async function applyChildCutStroke(points, key, mode = 'pen') {
  if (!childSegments.length || !isChildKey(key) || !points?.length) return false;
  const v = current3DVolume || volume, c = childByKey(key); if (!v || !c) return false;
  const ja = currentLanguage === 'ja', label = segmentById(key)?.name || key, st = segmentEditState[key], refs = snapshotAnalysisRegionsForSegment(key);
  try {
    const cut = cutRunsFromVoxelStroke(v, points, cutWidthMm(), +analysisCutDepth.value || 5, +analysisCutYaw.value || 0, +analysisCutPitch.value || 0, mode, +analysisCutOffset.value || 0);
    if (!analysisRunsVoxelCount(cut)) throw new Error(ja ? '切断空間のボクセル化に失敗しました' : 'Cut volume voxelization produced no voxels');
    pushEditUndo(key);
    st.excludeRuns = unionRunArrays(st.excludeRuns, cut, v.slices); st.cutRuns = unionRunArrays(st.cutRuns, cut, v.slices); st.rawCutSurface = true; st.finalRuns = null; st.revision++;
    segmentEditsChanged(key); setAnalysisEditTargetKey(key);
    const revision = st.revision;
    if (threeRenderMode === 'volume' && sceneState?.medicalVolume?.active) {
      syncGpuVolumeEdits(sourceVolume || volume); surfaceEditsPending.add(key); if (refs.length) await trimAnalysisRegionsAfterEdit(key, refs);
      footer.textContent = ja ? label + 'の切断をGPUボリュームへ反映しました' : 'Cut applied to GPU volume: ' + label;
      updateThreeEditUi(ja ? '切断済み · GPUボリューム更新済み' : 'Cut applied · GPU volume updated'); return true;
    }
    footer.textContent = ja ? label + 'を切断しました · 3D更新中…' : 'Cut ' + label + ' · updating 3D…';
    updateThreeEditUi(ja ? '切断済み · 3D更新中…' : 'Cut applied · updating 3D…');
    const current = await refreshEditedSegmentSurface(key, v, revision);
    if (!current || st.revision !== revision) return false;
    if (refs.length) { updateThreeEditUi(ja ? '3D更新済み · 解析更新中…' : '3D updated · refreshing analysis…'); await rebuildEditedAnalysisForSegment(key, refs); if (st.revision !== revision) return false; }
    footer.textContent = ja ? label + 'の切断を反映しました' : 'Cut applied to ' + label; return true;
  } catch (e) {
    if (String(e.message || e) !== '__SUPERSEDED__') { console.error(e); footer.textContent = (ja ? '切断後の更新に失敗しました: ' : 'Cut refresh failed: ') + String(e.message || e); updateThreeEditUi(ja ? '切断後の更新に失敗しました' : 'Cut refresh failed'); }
    return false;
  } finally { clearThreeEditOverlay(); request3DRender(); }
}

// undo / redo / reset act on the target, else the focused region's segment, else the first PRESET with a history (analysis-ops.js). When none of those exists but a child segment has a history, the child becomes the target first.
// kind: 'undo' | 'redo' | 'reset'. No child segment: nothing happens (the preset path as it was).
export function prepareChildHistoryTarget(kind) {
  if (!childSegments.length || analysisEditTargetKey) return;
  const region = analysisRegionById(analysisFocusedRegionId);
  if (region?.segmentKeys?.length === 1) return;
  const field = kind === 'redo' ? 'redo' : 'undo';
  if (kind === 'reset') { for (const c of childSegments) { const st = segmentEditState[c.key]; if (st && (st.keepRuns !== st.baseRuns || st.excludeRuns)) { if (!SEGMENT_PRESET_ORDER.some(k => segmentEditState[k].keepRuns || segmentEditState[k].excludeRuns)) setAnalysisEditTargetKey(c.key); return; } } return; }
  if (SEGMENT_PRESET_ORDER.some(k => segmentEditState[k][field].length)) return;
  const key = childHistoryKey(field); if (key) setAnalysisEditTargetKey(key);
}
