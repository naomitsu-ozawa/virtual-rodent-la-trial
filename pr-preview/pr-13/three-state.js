// 3D state (stale / updating / current) and the controls it enables,
// including the edit tools; kept apart from scene3d.js/three-status.js so
// low-level modules never import edit-tools.js (no import cycles).
// Depends only on the imports below; never imports from app.js.
import { sceneState, threeRenderMode, volume, setThreeDDirty, setThreeDApplying, volumeAnalysisMode } from './state.js?v=20261026-build673';
import { filter3DState, filterRebuild3D, volumeAnalysisToggle, sectionViewToggle, $ } from './ui-shell.js?v=20261026-build673';
import { tr } from './i18n.js?v=20261026-build673';
import { SEGMENT_PRESET_ORDER, segmentState } from './segments.js?v=20261026-build673';
import { updateAnalysisEditorControls } from './edit-tools.js?v=20261026-build673';
import { updateVolumeFilterBadge } from './three-status.js?v=20261026-build673';
export function set3DState(mode){
 setThreeDDirty(mode==='stale');setThreeDApplying(mode==='updating');
 updateVolumeFilterBadge();
 if(!filter3DState||!filterRebuild3D)return;
 filter3DState.classList.toggle('is-stale',mode==='stale');
 filter3DState.classList.toggle('is-updating',mode==='updating');
 filter3DState.classList.toggle('is-current',mode==='current');
 const key=mode==='stale'?'threeStale':mode==='updating'?'threeUpdating':'threeCurrent';filter3DState.dataset.i18n=key;filter3DState.textContent=tr(key);
 const actionKey=mode==='updating'?'cancel3D':'rebuild3D';
 filterRebuild3D.dataset.i18n=actionKey;filterRebuild3D.textContent=tr(actionKey);
 filterRebuild3D.classList.toggle('is-cancel',mode==='updating');
 filterRebuild3D.disabled=!volume||mode==='current';
 const chip=rebuildChip();if(chip)chip.hidden=!volume||mode!=='stale';
 const volumeCurrent=threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active,hasSurface3D=mode==='current'&&!!sceneState?.obj&&threeRenderMode==='surface';
 if(volumeAnalysisToggle)volumeAnalysisToggle.disabled=volumeAnalysisMode?false:!(volumeCurrent||hasSurface3D);
 if(sectionViewToggle)sectionViewToggle.disabled=!volume;
 for(const key of SEGMENT_PRESET_ORDER){
  const exportBtn=$('[data-seg-export="'+key+'"]');
  if(exportBtn)exportBtn.disabled=!hasSurface3D||!segmentState[key].active||!segmentState[key].enabled;
 }
 updateAnalysisEditorControls();
}
function rebuildChip(){
 let chip=document.getElementById('three-rebuild-chip');if(chip)return chip;
 const host=document.getElementById('viewport-3d')?.parentElement;if(!host)return null;
 chip=document.createElement('button');chip.type='button';chip.id='three-rebuild-chip';chip.className='three-rebuild-chip';chip.hidden=true;
 chip.dataset.i18n='rebuild3D';chip.textContent=tr('rebuild3D');chip.onclick=()=>filterRebuild3D?.click();host.append(chip);return chip;
}
export function mark3DStale(){if(volume)set3DState('stale')}
export function mark3DCurrent(){set3DState('current')}
