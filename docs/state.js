import { clampVoxel, sameVoxel, withSliceIndex } from './crosshair.js?v=20261020-build633';
// Shared mutable application state, moved out of app.js by
// tools/state-codemod.mjs. Read these bindings directly (imports are live);
// write them only through the setters (imported bindings are read-only).

export let currentLanguage='ja';
export function setCurrentLanguage(v){return currentLanguage=v}
export let precisionRangeDrag=null;
export function setPrecisionRangeDrag(v){return precisionRangeDrag=v}
export let volume=null;
export function setVolume(v){const prev=volume;volume=v;crosshairVolumeChanged(prev,v);return v}
export let sourceVolume=null;
export function setSourceVolume(v){if(v!==sourceVolume)clearCrosshair('series');return sourceVolume=v}
export let sceneState=null;
export function setSceneState(v){return sceneState=v}
export let activeId=null;
export function setActiveId(v){return activeId=v}
export let activeSeries=null;
export function setActiveSeries(v){const changed=v!==activeSeries;activeSeries=v;if(changed)try{if(typeof document!=='undefined'&&typeof CustomEvent!=='undefined')document.dispatchEvent(new CustomEvent('vrl-serieschange'))}catch{}return activeSeries}
export let volumeAnalysisMode=false;
export function setVolumeAnalysisMode(v){return volumeAnalysisMode=v}
export let volumeAnalysisBusy=false;
export function setVolumeAnalysisBusy(v){return volumeAnalysisBusy=v}
export let sourceRenderRevision=0;
export function incSourceRenderRevision(prefix){return prefix?++sourceRenderRevision:sourceRenderRevision++}
export let sectionViewOpen=false;
export function setSectionViewOpen(v){return sectionViewOpen=v}
export let sectionViewPlane=null;
export function setSectionViewPlane(v){return sectionViewPlane=v}
export let sectionViewReverse=true;
export function setSectionViewReverse(v){return sectionViewReverse=v}
export let sectionAutoPlane=null;
export function setSectionAutoPlane(v){return sectionAutoPlane=v}
export let sectionSliceImageVisible=true;
export function setSectionSliceImageVisible(v){return sectionSliceImageVisible=v}
export let sectionCapEnabled=true;
export function setSectionCapEnabled(v){return sectionCapEnabled=v}
export let sectionCapOpacity=.85;
export function setSectionCapOpacity(v){return sectionCapOpacity=v}
export let sectionCapHatch=true;
export function setSectionCapHatch(v){return sectionCapHatch=v}
// the slice (section / MPR plane) opacity at start = the VR start value (vr-view.js DEFAULTS.sliceOpacity); 体験会モードのリセットもここへ戻す
export const MPR3D_SURFACE_OPACITY_DEFAULT=.6;
export let mpr3DSurfaceOpacity=MPR3D_SURFACE_OPACITY_DEFAULT;
export function setMpr3DSurfaceOpacity(v){return mpr3DSurfaceOpacity=v}
export let mpr3DVolumeOpacity=.24;
export function setMpr3DVolumeOpacity(v){return mpr3DVolumeOpacity=v}
export let analysisRegions=[];
export function setAnalysisRegions(v){return analysisRegions=v}
// the filter signature of the data the results were made on (null: none known); a 'vrl-filters-changed' with
// the same signature (the rebuild a project load starts) keeps them, a different one clears them
export let analysisFilterSignature=null;
export function setAnalysisFilterSignature(v){return analysisFilterSignature=v}
export let nextAnalysisRegionId=1;
export function setNextAnalysisRegionId(v){return nextAnalysisRegionId=v}
export function incNextAnalysisRegionId(prefix){return prefix?++nextAnalysisRegionId:nextAnalysisRegionId++}
export let nextAnalysisColorIndex=0;
export function setNextAnalysisColorIndex(v){return nextAnalysisColorIndex=v}
export function incNextAnalysisColorIndex(prefix){return prefix?++nextAnalysisColorIndex:nextAnalysisColorIndex++}
export let analysisFocusedRegionId=null;
export function setAnalysisFocusedRegionId(v){return analysisFocusedRegionId=v}
export let analysisEditTool='select';
export function setAnalysisEditTool(v){return analysisEditTool=v}
export let analysisEditTargetKey=null;
export function setAnalysisEditTargetKey(v){return analysisEditTargetKey=v}
export let analysisEditTargetMode='auto';
export function setAnalysisEditTargetMode(v){return analysisEditTargetMode=v}
export let analysisCutStroke=null;
export function setAnalysisCutStroke(v){return analysisCutStroke=v}
export let analysisCutScreen=[];
export function setAnalysisCutScreen(v){return analysisCutScreen=v}
export let analysisPendingCut=null;
export function setAnalysisPendingCut(v){return analysisPendingCut=v}
export let analysisCutApplying=false;
export function setAnalysisCutApplying(v){return analysisCutApplying=v}
export let analysisEditPreparing=false;
export function setAnalysisEditPreparing(v){return analysisEditPreparing=v}
export let deferAutomatic3D=false;
export function setDeferAutomatic3D(v){return deferAutomatic3D=v}
export let threeDDirty=false;
export function setThreeDDirty(v){return threeDDirty=v}
export let threeDApplying=false;
export function setThreeDApplying(v){return threeDApplying=v}
export let threeDCancelRequested=false;
export function setThreeDCancelRequested(v){return threeDCancelRequested=v}
export let current3DVolume=null;
export function setCurrent3DVolume(v){return current3DVolume=v}
export let memoryGpuPreviewActive=false;
export function setMemoryGpuPreviewActive(v){return memoryGpuPreviewActive=v}
export let ctRangeMode='auto';
export function setCtRangeMode(v){return ctRangeMode=v}
export let ctRangeProfile=null;
export function setCtRangeProfile(v){return ctRangeProfile=v}
export let filterOrder=[];
export function setFilterOrder(v){return filterOrder=v}
export let filterRebuildTimer=null;
export function setFilterRebuildTimer(v){return filterRebuildTimer=v}
export let filterRebuildRevision=0;
export function incFilterRebuildRevision(prefix){return prefix?++filterRebuildRevision:filterRebuildRevision++}
export let segmentRenderTimer=null;
export let threeRenderMode='surface';
export function setThreeRenderMode(v){return threeRenderMode=v}
export let cutControlPreviewRaf=0;
export function setCutControlPreviewRaf(v){return cutControlPreviewRaf=v}
export let smoothingRefreshTimer=null;
export function setSmoothingRefreshTimer(v){return smoothingRefreshTimer=v}
import { settings } from './app-settings.js?v=20261020-build633';
// 3D volume in-plane size, remembered in the settings; full size
// (0) is desktop-only, so an iPad falls back to 512
export let ipadGpuTargetSide=(()=>{const v=+settings.get('gpuSide');const touch=typeof navigator!=='undefined'&&/Android|OculusBrowser|Quest/i.test(navigator.userAgent||''),ipad=typeof navigator!=='undefined'&&(/iPad/i.test(navigator.userAgent||'')||((navigator.maxTouchPoints||0)>1&&/Mac/i.test(navigator.platform||'')));return v===768?768:v===0&&!ipad&&!touch?0:512})(); // full size stays desktop-only; iPad, Android tablets and the Quest browser fall back to 512
export function setIpadGpuTargetSide(v){return ipadGpuTargetSide=v}
export let residentMprReadbackDisabled=false;
export function setResidentMprReadbackDisabled(v){return residentMprReadbackDisabled=v}
export let residentMprEpoch=0;
export function incResidentMprEpoch(prefix){return prefix?++residentMprEpoch:residentMprEpoch++}
export let residentGpuUploadSeriesId=null;
export function setResidentGpuUploadSeriesId(v){return residentGpuUploadSeriesId=v}
export let dicomCodecModulePromise=null;
export function setDicomCodecModulePromise(v){return dicomCodecModulePromise=v}
export let gpuPrewarmScheduled=false;
export function setGpuPrewarmScheduled(v){return gpuPrewarmScheduled=v}
export let gpuPrewarmIndex=0;
export function setGpuPrewarmIndex(v){return gpuPrewarmIndex=v}
export function incGpuPrewarmIndex(prefix){return prefix?++gpuPrewarmIndex:gpuPrewarmIndex++}
export let sourceOrthogonalPlaneCacheBytes=0;
export function setSourceOrthogonalPlaneCacheBytes(v){return sourceOrthogonalPlaneCacheBytes=v}
export let mpr3DWindowLutKey='';
export function setMpr3DWindowLutKey(v){return mpr3DWindowLutKey=v}
export let mpr3DWindowLutTable=new Uint32Array(256);
export let nextSegmentMaskVolumeId=1;
export function incNextSegmentMaskVolumeId(prefix){return prefix?++nextSegmentMaskVolumeId:nextSegmentMaskVolumeId++}
export let sourceMprWarmupToken=0;
export function incSourceMprWarmupToken(prefix){return prefix?++sourceMprWarmupToken:sourceMprWarmupToken++}
export let sourceMprWarmupPlane=null;
export function setSourceMprWarmupPlane(v){return sourceMprWarmupPlane=v}
export let cutResultPreviewRevision=0;
export function incCutResultPreviewRevision(prefix){return prefix?++cutResultPreviewRevision:cutResultPreviewRevision++}
export let cutResultPreviewTimer=null;
export function setCutResultPreviewTimer(v){return cutResultPreviewTimer=v}

// Linked crosshair. One shared position in VOXEL indices {i,j,k} (integers inside volume.columns/rows/slices; see
// crosshair.js for why not millimetres). JSON-ready: a later stage can store it in a comment or the project file.
// The three MPR views listen with onCrosshairChange (or the 'vrl-crosshairchange' DOM event on document).
//   setCrosshair({i,j,k}[,source]) -> the stored (clamped) position, or null when there is no volume / bad input
//   getCrosshair()                 -> a copy {i,j,k}, or null when hidden
//   clearCrosshair([source])       -> hides it
//   setCrosshairSlice(plane,idx)   -> a slice slider moved: change that plane's coordinate (does nothing while hidden)
// Event detail: {crosshair:{i,j,k}|null, previous, source}. No event when nothing changed.
export const CROSSHAIR_EVENT='vrl-crosshairchange';
let crosshair=null;
const crosshairListeners=new Set();
function emitCrosshair(previous,source){
 const detail={crosshair:getCrosshair(),previous,source};
 for(const cb of [...crosshairListeners]){try{cb(detail)}catch(e){console.warn('crosshair listener failed',e)}}
 try{if(typeof document!=='undefined'&&typeof CustomEvent!=='undefined')document.dispatchEvent(new CustomEvent(CROSSHAIR_EVENT,{detail}))}catch{}
}
export function getCrosshair(){return crosshair?{i:crosshair.i,j:crosshair.j,k:crosshair.k}:null}
export function setCrosshair(v,source='api'){
 const next=clampVoxel(v,volume);if(!next)return null;
 if(sameVoxel(crosshair,next))return getCrosshair();
 const previous=getCrosshair();crosshair=next;emitCrosshair(previous,source);return getCrosshair();
}
export function clearCrosshair(source='clear'){
 if(!crosshair)return;const previous=getCrosshair();crosshair=null;emitCrosshair(previous,source);
}
export function setCrosshairSlice(plane,idx,source='slider'){
 if(!crosshair)return null;
 const next=withSliceIndex(crosshair,plane,idx,volume||{});return next?setCrosshair(next,source):null;
}
export function onCrosshairChange(cb){crosshairListeners.add(cb);return()=>crosshairListeners.delete(cb)}
// another series (or a volume of a different size) must not keep an old index: hide it; the same size just re-clamps
function crosshairVolumeChanged(prev,v){
 if(!crosshair)return;
 if(!v||!prev||v.columns!==prev.columns||v.rows!==prev.rows||v.slices!==prev.slices){clearCrosshair('series');return}
 const next=clampVoxel(crosshair,v);if(!sameVoxel(crosshair,next))setCrosshair(next,'clamp');
}
