// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { SAMPLE_CACHE, DEFAULT_SAMPLE, sampleIndexUrl, sampleSliceUrl, sampleCacheKey } from './sample-sets.js?v=20261022-build642';
import { mark3DStale, mark3DCurrent } from './three-state.js?v=20261022-build642';
import { updateVolumeFilterBadge, set3DBusy, gpuVolumeRefresh } from './three-status.js?v=20261022-build642';
import { analysisRegions, currentLanguage, current3DVolume, volume, activeSeries, threeRenderMode, sceneState, sourceVolume, setActiveId, setActiveSeries, activeId, setSourceVolume, setVolume, setThreeRenderMode, ipadGpuTargetSide, setResidentGpuUploadSeriesId, setResidentMprReadbackDisabled, residentGpuUploadSeriesId, gpuPrewarmScheduled, gpuPrewarmIndex, setGpuPrewarmScheduled, incGpuPrewarmIndex, setFilterOrder, setCtRangeMode, setCtRangeProfile, ctRangeProfile, incSourceRenderRevision, setThreeDCancelRequested, setCurrent3DVolume, setMemoryGpuPreviewActive, incResidentMprEpoch, ctRangeMode, filterOrder, threeDDirty } from './state.js?v=20261022-build642';
import { footer, resetFilterBtn, wc, ww, surfaceSmoothEnabled, surfaceSmoothStrength, planes, spikeHoleStrength, spikeHoleThreshold, nlmStrength, nlmSearchRadius, nlmPatchRadius, anisotropicStrength, anisotropicIterations, smoothingType, gaussianStrength, spatialPasses, sigmoidStrength, sigmoidCenter, sigmoidWidth, bilateralStrength, bilateralSpatial, bilateralIntensity, bilateralPasses, tvWeight, tvIterations, unsharpRadius, unsharpAmount, unsharpThreshold, list, selected, prog, volumeAnalysisToggle, threeLabel, state, renderModeToggle, gaussianBtn, spikeHoleBtn, nlmBtn, anisotropicBtn, sigmoidBtn, bilateralBtn, tvBtn, unsharpBtn, filterAddSelect, filterAddButton, ctRangeAuto, ctRangeFull, $, progLabel, bar, anisotropicKappa, tvEps } from './ui-shell.js?v=20261022-build642';
import { commentsForProject, loadProjectComments, markCommentsSaved } from './comments.js?v=20261022-build642';
import { normalizeAnalysisLabel, setRegionLabel } from './analysis-label.js?v=20261022-build642';
import { resetUserState } from './event-fresh.js?v=20261022-build642';
import { segmentVisibilityPlan } from './event-mode.js?v=20261022-build642';
import { measurementsForProject, loadProjectMeasurements, markMeasurementsSaved } from './measurements.js?v=20261022-build642';
import { compareFingerprints, resolveProjectMatch, resolveProjectMatchAsync, legacySpacingUpgrade, datasetFingerprint, decodeRuns, packProject, PROJECT_EXTENSION, encodeRuns } from './project-file.js?v=20261022-build642';
import { SEGMENT_PRESET_ORDER, segmentState, segmentEditState, segmentNeedsVoxelMask, segmentEditGen, segmentExclusive, applyExclusiveRanges, commitExclusiveRanges, SEGMENT_PRESET_DEFAULTS } from './segments.js?v=20261022-build642';
import { materialKey } from './lighting.js?v=20261022-build642';
import { FILTER_CATALOG_ORDER, addFilter, applyVolumeAfterFilterRebuild, invalidateSourceFilters, syncFilterControls, setFilterUnitControl, formatHU } from './filter-pipeline.js?v=20261022-build642';
import { sourceRangeFromMetadata } from './dicom.js?v=20261022-build642';
import { spacingCheckForProject, spacingWarningText, spacingWarningHtml as spacingHtml } from './slice-spacing.js?v=20261022-build642';
import { sizeWarningHtml } from './vr-real-scale.js?v=20261022-build642';
import { FILTER_UNITS, filterLegacyRange, resolveFilterParams } from './filter-units.js?v=20261022-build642';
import { smoothingSync, applyDeviceSmoothing } from './settings.js?v=20261022-build642';
import { setControlValue, applyCtRangeMode, removeSegmentPreset, addSegmentPreset, segmentControl, setControlChecked, clearAnalysisHighlight, scheduleSegment3D, updateSegmentOutputs, renderSegmentPresets, THIN_SLIDERS, configureThinSliders } from './segment-ui.js?v=20261022-build642';
import { syncGpuVolumeEdits, gpuVolumeApplied, gpuVolumeTarget, gpuVolumePlanOptions, updateVolumeCacheControl, gpuVolumeDataSignature } from './gpu-volume-data.js?v=20261022-build642';
import { renderAll, cancelSourceMprWarmup } from './mpr-render.js?v=20261022-build642';
import { updateAnalysisEditorControls } from './edit-tools.js?v=20261022-build642';
import { request3DRender } from './scene3d.js?v=20261022-build642';
import { downloadBlob, esc, fmt, isIPadRuntime, isIPhoneRuntime, isTabletRuntime, niceCtStep, withTimeout } from './utils.js?v=20261022-build642';
import { decode, prepareSourceMprCache } from './volume-io.js?v=20261022-build642';
import { progress, clearMemoryFilterPreviewCache, surfaceEditsPending } from './rebuild-3d.js?v=20261022-build642';
import { ensureMpr3DPreviewCache, syncMpr3DSliceSliders, syncMpr3DOverlayPresentation, disposeMprPlaneGroup } from './mpr3d-overlay.js?v=20261022-build642';
import { tr } from './i18n.js?v=20261022-build642';
import { setGpuComputeBackend, gpuFilterRuntime, gpuFilterPipeline } from './gpu-compute.js?v=20261022-build642';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { GPU_IDLE_PREWARM_KINDS } from './gpu-shaders.js?v=20261022-build642';
import { filterState, currentFilterSignature } from './source-filters.js?v=20261022-build642';
import { dispose } from './surface-mesh.js?v=20261022-build642';
import { residentMprJobs } from './mpr-orthogonal.js?v=20261022-build642';
import { ensureSegmentBaseRuns } from './segment-runs.js?v=20261022-build642';
import { APP_VERSION, APP_BUILD } from './version.js?v=20261022-build642';
import { askInline } from './inline-ask.js?v=20261022-build642';
import { setBusySlot, reportBusyProgress, setBusyLabel } from './progress-modal.js?v=20261022-build642';
import { analysisRegionsForProject, restoreAnalysisRegions, clearAllSegmentEdits } from './analysis-ops.js?v=20261022-build642';
import { resetLineProfileForDataset } from './line-profile-ui.js?v=20261022-build642';
import { resetSegmentStyles } from './dataset-reset.js?v=20261022-build642';
export function updateRenderModeControl(v=volume){
 updateVolumeFilterBadge();
 if(!renderModeToggle)return;
 const mv=sceneState?.medicalVolume,support=mv&&v?mv.support(v,gpuVolumePlanOptions()):{ok:false,reason:'WebGPU volume unavailable'};
 renderModeToggle.disabled=!support.ok;
 renderModeToggle.removeAttribute('data-i18n');renderModeToggle.textContent=threeRenderMode==='volume'?tr('surfaceRender'):tr('volumeRender');
 renderModeToggle.title=support.ok?'':(support.reason||'');
}
export function ensureVolumeTransformProxy(){
 if(sceneState?.obj)return sceneState.obj;
 const group=new THREE.Group();sceneState.obj=group;sceneState.scene.add(group);return group;
}
export function setSurfaceMeshesHiddenForVolume(hidden){
 if(!sceneState?.obj)return;
 sceneState.obj.traverse(o=>{
  if(!o.isMesh)return;
  const isSurface=!!o.userData?.segmentKey||Array.isArray(o.userData?.segmentRanges);
  if(!isSurface)return;
  if(hidden){
   if(o.userData._volumePrevVisible===undefined)o.userData._volumePrevVisible=o.visible;
   o.visible=false;
  }else if(o.userData._volumePrevVisible!==undefined){
   o.visible=!!o.userData._volumePrevVisible;delete o.userData._volumePrevVisible;
  }
 });
}
export function setThreeVolumeOverlay(active){
 const state=sceneState;if(!state?.renderer)return;
 const canvas=state.renderer.domElement;
 if(active){
  state._surfaceBackground=state.scene.background;
  state._surfaceClearAlpha=typeof state.renderer.getClearAlpha==='function'?state.renderer.getClearAlpha():1;
  state.scene.background=null;if(typeof state.renderer.setClearAlpha==='function')state.renderer.setClearAlpha(0);
  Object.assign(canvas.style,{position:'absolute',inset:'0',zIndex:'2',pointerEvents:'auto'});
  setSurfaceMeshesHiddenForVolume(true);
 }else{
  state.scene.background=state._surfaceBackground||new THREE.Color(0x090c0e);
  if(typeof state.renderer.setClearAlpha==='function')state.renderer.setClearAlpha(state._surfaceClearAlpha??1);
  canvas.style.position='';canvas.style.inset='';canvas.style.zIndex='';canvas.style.pointerEvents='';
  setSurfaceMeshesHiddenForVolume(false);
 }
}
// GPU volume view only thresholds: compute the post-processed runs of
// segments that need them (thin-region suppression, Opening, ...) in the
// background and show them as keep masks (gpuVolumeEditDescriptors).
export function syncProcessedSegmentsToVolume(){
 if(threeRenderMode!=='volume')return;
 const v=current3DVolume||volume,keys=SEGMENT_PRESET_ORDER.filter(key=>{const s=segmentState[key];return s?.active&&s.enabled&&segmentNeedsVoxelMask(key)});
 if(!v||!keys.length)return;
 setTimeout(async()=>{
  for(const key of keys){
   if((current3DVolume||volume)!==v||!segmentState[key]?.active)return;
   try{await ensureSegmentBaseRuns(key,v);syncGpuVolumeEdits(sourceVolume||volume)}
   catch(e){if(String(e.message||e)!=='__SUPERSEDED__')console.warn('Segment post-processing for the volume view failed for '+key,e);return}
  }
 },0);
}
export async function activateMedicalVolume(){
 const mv=sceneState?.medicalVolume,target=gpuVolumeTarget();if(!mv||!target)return;
 gpuVolumeRefresh.token++;gpuVolumeRefresh.running=null;
 const planOptions=gpuVolumePlanOptions(),support=mv.support(target,planOptions);if(!support.ok){footer.textContent='GPU Volume: '+support.reason;updateRenderModeControl(target);return}
 set3DBusy(true,currentLanguage==='ja'?'GPUボリューム準備中…':'Preparing GPU volume…');
 try{
  await mv.ensure(target,planOptions);if(mv.lastCacheHit)footer.textContent=tr('volumeCacheLoaded');void updateVolumeCacheControl();ensureVolumeTransformProxy();setThreeRenderMode('volume');mv.setActive(true);syncGpuVolumeEdits(target);syncProcessedSegmentsToVolume();setThreeVolumeOverlay(true);syncMpr3DOverlayPresentation();volumeAnalysisToggle.disabled=false;
  const reduced=!!mv.isReduced?.(target),dims=mv.textureDims||[],profile=gpuVolumeProfileLabel();
  threeLabel.textContent=(sceneState.backend||'3D')+(reduced?' · '+profile+' GPU volume':' · GPU volume');setGpuComputeBackend(reduced?'WEBGPU '+profile.toUpperCase()+' VOLUME RAYCAST · LINEAR':'WEBGPU VOLUME RAYCAST');updateRenderModeControl(target);request3DRender();
  footer.textContent=reduced?(profile+' GPUボリューム · '+dims.join('×')+' · '+fmt(mv.textureBytes)+' · MPR/元データはフル解像度'):(currentLanguage==='ja'?'GPUボリューム · 16-bit CTを3D textureから直接描画':'GPU Volume · direct 16-bit CT 3D-texture ray casting');
 }catch(e){console.error(e);mv.setActive(false);setThreeRenderMode('surface');setGpuComputeBackend('GPU VOLUME ERROR',e?.message||e);footer.textContent='GPU Volume error: '+String(e.message||e);updateRenderModeControl(target)}
 finally{set3DBusy(false)}
}
export function clear3DForSeriesChange(){
 incSourceRenderRevision(false);setThreeDCancelRequested(false);gpuVolumeRefresh.token++;gpuVolumeRefresh.running=null;setCurrent3DVolume(null);setMemoryGpuPreviewActive(false);setResidentMprReadbackDisabled(false);setResidentGpuUploadSeriesId(null);clearResidentMprJobs();sceneState?.medicalVolume?.resetData?.();setThreeRenderMode('surface');setThreeVolumeOverlay(false);clearMemoryFilterPreviewCache();set3DBusy(false);clearAnalysisHighlight();
 if(sceneState?.obj){sceneState.obj.parent?.remove(sceneState.obj);dispose(sceneState.obj);sceneState.obj=null}
 disposeMprPlaneGroup();request3DRender();mark3DStale();
}
// practice dataset hosted on this site (docs/demo/sample1, 512 DICOM slices
// listed in index.json). Same-origin, so it also opens on a Meta Quest without typing a
// URL. The browser HTTP cache keeps it for the next visit.
export async function loadSampleDemo(setId=DEFAULT_SAMPLE){
 loadPhase('練習データを取得中','practice data');progLabel.textContent='接続中…';bar.style.width='0%';
 const r=await fetch(sampleIndexUrl(setId),{credentials:'omit'});
 if(!r.ok)throw new Error('Sample index: HTTP '+r.status);
 const names=(await r.json()).files||[];if(!names.length)throw new Error('Sample index is empty');
 // slices kept in Cache Storage (like the public demo), so a
 // second open reads them from disk instead of downloading 260 MB again;
 // cache problems fall back to the network
 let cache=null;try{if('caches' in window)cache=await withTimeout(caches.open(SAMPLE_CACHE),1500,null)}catch{cache=null}
 const out=new Array(names.length);let next=0,done=0,bytes=0,cached=0;
 // the cache key does not contain the page path, so main and the
 // PR previews (same origin) share one copy; the write runs beside the read
 const puts=[];
 const lane=async()=>{while(next<names.length){const i=next++,url=new URL(sampleSliceUrl(setId,names[i]),location.href).href,key=sampleCacheKey(location.origin,setId,names[i]);
  let res=null;try{res=cache?await cache.match(key):null}catch{res=null}
  if(res)cached++;
  else{res=await fetch(url,{credentials:'omit'});if(!res.ok)throw new Error(names[i]+': HTTP '+res.status);if(cache)puts.push(cache.put(key,res.clone()).catch(()=>{}))}
  const b=await res.blob();bytes+=b.size;out[i]=new File([b],names[i]);done++;progress(done,names.length)}};
 await Promise.all(Array.from({length:6},lane));await Promise.all(puts);
 footer.textContent=tr('sampleDone')+' · '+names.length+' · '+fmt(bytes)+(cached?' · '+tr('sampleCached')+' '+cached:'');
 return out;
}
export const detectedSeries={list:[]};
export function useWorkspaceUi(){
 const q=new URLSearchParams(location.search).get('ui');
 if(q==='classic')return false;if(q==='workspace')return true;
 // the workspace UI everywhere but the iPhone (was iPad + Mac only)
 return !isIPhoneRuntime();
}
export function requestIPadSettingsTab(tab){
 if(!useWorkspaceUi())return;
 document.dispatchEvent(new CustomEvent('vrl-ipad-settings-tab',{detail:{tab}}));
}
// non-blocking slice-spacing warning shown with the selected series (wraps; fine on iPad)
function spacingWarningHtml(s){return spacingHtml(s.spacingCheck,currentLanguage,esc)+sizeWarningHtml(s,currentLanguage,esc)} // + the >30 cm note (item 3)
// language switch: redraw the warning in the selected-series overlay
export function refreshSpacingWarning(){
 for(const s of detectedSeries.list){const w=spacingWarningText(s.spacingCheck),mark=[...list.children].find(n=>n.dataset.id===s.id)?.querySelector('.spacing-mark');if(w&&mark)mark.title=currentLanguage==='ja'?w.ja:w.en}
 if(!activeSeries||!selected)return;
 selected.querySelectorAll('.spacing-warn,.size-warn').forEach(n=>n.remove());
 const html=spacingWarningHtml(activeSeries);if(!html)return;
 const badge=selected.querySelector('.ready-badge');
 if(badge)badge.insertAdjacentHTML('beforebegin',html);else selected.insertAdjacentHTML('beforeend',html);
}
// small series (<=256 MiB decoded, e.g. 256^3 / 128^3 crops) were decoded into memory and never got the GPU volume,
// so 3D waited for a rebuild; on PC they now take the source-backed path too (Mac / iPad / iPhone / Quest unchanged)
function smallSeriesGpuVolume(s){
 if(s.sourceBacked||isTabletRuntime()||isIPhoneRuntime()||/Mac/i.test(navigator.platform||''))return false;
 const mv=sceneState?.medicalVolume;return !!mv?.support(openSourceBackedVolume(s),gpuVolumePlanOptions()).ok;
}
// the ONE place where the per-dataset state is reset when another dataset is opened (another practice dataset without a page reload,
// another series card, the series a project points to). It runs at the start of selectSeries, before configure() and before the new data's
// project is applied (applyPendingProject at the end of selectSeries), so what that project sets wins; what it does not set is not inherited.
//   cleared here: the HU line (the shared model: 2D slices, 3D overlay, VR line + panel) with the line-profile panel and a pick in progress;
//     the segments' manual edits, undo / redo and the 3D edit tool / target (voxel runs in the old grid); the inactive segment presets'
//     own settings (colour, opacity, post-processing, material: dataset-reset.js)
//   cleared elsewhere on the same switch: crosshair (state.js setSourceVolume), analysis regions + their focus / selection (clear3DForSeriesChange;
//     a project restore still running for the old data stops: analysis-ops.js restoreAnalysisRegions), crop box, a measurement start and the
//     3D HU line pick (their 'vrl-serieschange' listeners), segment ranges / overlap order (configureSegments), window, slices, filters (configure,
//     app.js resetVolume on a new load), the section view (resetVolume)
//   kept on purpose: position comments and distances (stored per dataset fingerprint, merged by projects), settings, theme, language, the
//     histogram's display range, the analysis dock layout, the Filtered / Raw HU choice
export function resetDatasetState(){
 resetLineProfileForDataset();
 clearAllSegmentEdits();
 for(const key of resetSegmentStyles(segmentState,SEGMENT_PRESET_DEFAULTS)){const el=segmentControl('material',key);if(el)el.value=segmentState[key].material} // the other controls follow configureSegments
}
export async function selectSeries(s){
 // per-dataset reset only for another series (the same card again re-decodes the same data and keeps its edits, as before)
 const prevSeries=activeSeries;setActiveId(s.id);setActiveSeries(s);clear3DForSeriesChange();if(s!==prevSeries)resetDatasetState();const sourceBacked=s.sourceBacked||smallSeriesGpuVolume(s);
 requestIPadSettingsTab('display');
 for(const n of list.children)n.classList.toggle('is-selected',n.dataset.id===activeId);
 selected.innerHTML='<strong>'+esc(s.description)+'</strong><span>'+esc(s.modality)+' · '+s.slices.length+' slices · '+s.columns+'×'+s.rows+(sourceBacked?' · full resolution':'')+'</span>'+spacingWarningHtml(s)+'<span class="ready-badge">CT volume loading…</span>';
 prog.classList.remove('is-hidden');busy(true);loadPhase('スライスを展開中','decoding slices');let phase='decode';
 try{
  invalidateSourceFilters();
  setSourceVolume(sourceBacked?openSourceBackedVolume(s):await decode(s,(x,y)=>progress(x,y)));
  setVolume(sourceVolume);phase='configure';configure(volume);applyDeviceSmoothing();enableProcessingControls(true);scheduleGpuPrewarm();
  let gpuResident=false;
  if(sourceBacked){
   const badge=selected.querySelector('.ready-badge');if(badge)badge.textContent='GPU volume…';loadPhase('GPUボリュームを準備中','GPU volume');
   gpuResident=await prepareResidentGpuVolume(sourceVolume);
   // another series was opened during this upload (it was superseded): that selection does the rest
   if(!gpuResident&&activeSeries!==s)return;
   if(!gpuResident){
    if(badge)badge.textContent='MPR cache…';loadPhase('MPRキャッシュを作成中','MPR cache');
    await prepareSourceMprCache(sourceVolume,(x,y)=>{progress(x,y);const b=selected.querySelector('.ready-badge');if(b)b.textContent='MPR cache '+x+' / '+y});
   }
  }
  const badge=selected.querySelector('.ready-badge');
  if(!gpuResident){if(badge)badge.textContent='3D C/S cache…';loadPhase('3D断面キャッシュを作成中','3D section cache');await ensureMpr3DPreviewCache()}
  phase='render';renderAll();mark3DStale();
  if(gpuResident){await activateMedicalVolume();mark3DCurrent()}
  if(badge)badge.textContent=sourceBacked?(gpuResident?'CT source ready · GPU volume':(volume.mprData?'CT source ready · MPR cached':'CT source ready · streaming MPR')):'CT volume ready · 2D ready';
  footer.textContent=sourceBacked?(gpuResident?'Full-resolution source DICOM · GPU-resident MPR':(volume.mprData?'Full-resolution source DICOM · MPR memory cache '+fmt(volume.mprData.byteLength):'Full-resolution source-backed DICOM · streaming MPR')):'CT range: '+Math.round(volume.min)+' to '+Math.round(volume.max)+' · '+volume.data.constructor.name+' '+fmt(volume.data.byteLength);
  syncMpr3DSliceSliders();void applyPendingProject();
 }catch(e){
  console.error(e);const label=phase==='decode'?'Decode failed':phase==='configure'?'Configure failed':'Render failed';
  selected.querySelector('.ready-badge').textContent=label;footer.textContent=label+': '+String(e.message||e)
 }finally{prog.classList.add('is-hidden');busy(false);set3DBusy(false)}
}
export function openSourceBackedVolume(s){
 return{data:null,mprData:null,mprPlaneBuffers:null,mprSagittalDisplayAll:null,mprSagittalDisplayBuffer:null,mprSagittalDisplayMin:null,mprSagittalDisplayMax:null,sourceBacked:true,series:s,columns:s.columns,rows:s.rows,slices:s.slices.length,spacing:[s.spacingX,s.spacingY,s.spacingZ],min:s.min,max:s.max,windowCenter:s.windowCenter,windowWidth:s.windowWidth,storage:'DICOM source'};
}
export function gpuVolumeProfileLabel(){
 if(isIPhoneRuntime())return'iPhone';
 return(isIPadRuntime()?'iPad ':isTabletRuntime()?'tablet ':'GPU ')+(ipadGpuTargetSide||'full');
}
export function clearResidentMprJobs(){
 incResidentMprEpoch(false);
 for(const state of Object.values(residentMprJobs)){
  if(state.pending){for(const waiter of state.pending.waiters)waiter.reject(new Error('__SUPERSEDED__'));state.pending=null}
 }
}
export async function prepareResidentGpuVolume(v){
 const mv=sceneState?.medicalVolume;if(!mv||!v?.sourceBacked)return false;
 const planOptions=gpuVolumePlanOptions(),support=mv.support(v,planOptions);if(!support.ok)return false;
 const seriesId=v?.series?.id||null;setResidentGpuUploadSeriesId(seriesId);cancelSourceMprWarmup();
 try{
  const previewSide=(planOptions.maxTextureBytes||planOptions.targetInPlane)?0:384;
  await mv.ensure(v,{prepareBricks:false,previewSide,...planOptions});
  setResidentMprReadbackDisabled(!!mv.isReduced?.(v));
  if(mv.isReduced?.(v)){
   const dims=mv.textureDims||[],profile=gpuVolumeProfileLabel();
   setGpuComputeBackend('WEBGPU '+profile.toUpperCase()+' VOLUME · LINEAR');
   footer.textContent=profile+' GPUボリューム · '+dims.join('×')+' · '+fmt(mv.textureBytes)+' / 2D MPRは原寸ソース';
  }else setGpuComputeBackend('WEBGPU VOLUME RESIDENT');
  return true;
 }catch(e){
  console.warn('GPU resident volume unavailable; using source-backed MPR fallback.',e);setResidentMprReadbackDisabled(true);setGpuComputeBackend('GPU VOLUME FALLBACK',e?.message||e);return false;
 }finally{
  if(residentGpuUploadSeriesId===seriesId)setResidentGpuUploadSeriesId(null);
  set3DBusy(false);
 }
}
export function scheduleGpuPrewarm(){
 if(gpuPrewarmScheduled||gpuFilterRuntime.disabled||gpuPrewarmIndex>=GPU_IDLE_PREWARM_KINDS.length)return;
 setGpuPrewarmScheduled(true);
 const run=async()=>{
  setGpuPrewarmScheduled(false);
  if(gpuFilterRuntime.disabled||gpuPrewarmIndex>=GPU_IDLE_PREWARM_KINDS.length)return;
  const kind=GPU_IDLE_PREWARM_KINDS[incGpuPrewarmIndex(false)];
  try{await gpuFilterPipeline(kind)}catch(e){console.warn('GPU pipeline prewarm skipped:',kind,e)}
  if(gpuPrewarmIndex<GPU_IDLE_PREWARM_KINDS.length)scheduleGpuPrewarm();
 };
 if('requestIdleCallback' in window)requestIdleCallback(()=>void run(),{timeout:2500});
 else setTimeout(()=>void run(),180);
}
export function enableProcessingControls(enabled){
 if(!enabled){filterState.spikeHole=filterState.nlm=filterState.anisotropic=filterState.gaussian=filterState.sigmoid=filterState.bilateral=filterState.tv=filterState.unsharp=false;setFilterOrder([])}
 gaussianBtn.disabled=!enabled;smoothingType.disabled=!enabled||!filterState.gaussian;spikeHoleBtn.disabled=!enabled;nlmBtn.disabled=!enabled;anisotropicBtn.disabled=!enabled;sigmoidBtn.disabled=!enabled;bilateralBtn.disabled=!enabled;tvBtn.disabled=!enabled;unsharpBtn.disabled=!enabled;filterAddSelect.disabled=!enabled;filterAddButton.disabled=!enabled;
 filterAddSelect.title=volume?.sourceBacked?'フル解像度チャンク処理':'';filterAddButton.title='';
 resetFilterBtn.disabled=!enabled;
 surfaceSmoothEnabled.disabled=!enabled;
 surfaceSmoothStrength.disabled=!enabled||!surfaceSmoothEnabled.checked;
 syncFilterControls();
}
export function buildCtRangeProfile(v){
 const fullMin=Number.isFinite(v.min)?v.min:0,fullMax=Number.isFinite(v.max)&&v.max>fullMin?v.max:fullMin+1,fullSpan=Math.max(fullMax-fullMin,1e-6);
 const center=Number.isFinite(v.windowCenter)?v.windowCenter:(fullMin+fullMax)/2;
 const width=Number.isFinite(v.windowWidth)&&v.windowWidth>0?v.windowWidth:fullSpan;
 return{fullMin,fullMax,fullSpan,center,width,fullWidthMax:Math.max(fullSpan,width)};
}
export function configure(v){
 setCtRangeMode('auto');setCtRangeProfile(buildCtRangeProfile(v));
 const p=ctRangeProfile,center=p.center,initialWidth=p.width;
 wc.min=p.fullMin;wc.max=p.fullMax;wc.value=Math.max(p.fullMin,Math.min(p.fullMax,center));wc.disabled=false;
 ww.min=Math.max(niceCtStep(p.fullSpan),1e-6);ww.max=p.fullWidthMax;ww.value=Math.max(+ww.min,Math.min(p.fullWidthMax,initialWidth));ww.disabled=false;
 sigmoidCenter.min=p.fullMin;sigmoidCenter.max=p.fullMax;sigmoidCenter.value=Math.max(p.fullMin,Math.min(p.fullMax,0)); // 0 HU, between fat and soft tissue (was the window centre)
 sigmoidCenter.disabled=!filterState.sigmoid;
 const vals={axial:[v.slices,v.slices/2],coronal:[v.rows,v.rows/2],sagittal:[v.columns,v.columns/2]};for(const [plane,[max,mid]]of Object.entries(vals)){planes[plane].slider.max=max-1;planes[plane].slider.value=Math.floor(mid);planes[plane].slider.disabled=false}
 configureSegments(v);
 ctRangeAuto.disabled=ctRangeFull.disabled=false;applyCtRangeMode('auto');
 volumeAnalysisToggle.disabled=!(v.data||v.mprData||v.sourceBacked);updateRenderModeControl(v);
}
export function configureSegments(v){
 const huLike=v.min<=-500&&v.max>=1000;
 const defaults=huLike?{lung:[Math.max(v.min,-950),Math.min(v.max,-300)],fat:[Math.max(v.min,-250),Math.min(v.max,-50)],soft:[Math.max(v.min,-50),Math.min(v.max,350)],bone:[Math.max(v.min,350),v.max],contrast:[Math.max(v.min,300),v.max]}:{lung:[v.min+(v.max-v.min)*.03,v.min+(v.max-v.min)*.18],fat:[v.min,v.min+(v.max-v.min)*.22],soft:[v.min+(v.max-v.min)*.22,v.min+(v.max-v.min)*.58],bone:[v.min+(v.max-v.min)*.58,v.max],contrast:[v.min+(v.max-v.min)*.58,v.max]};
 for(const key of Object.keys(segmentState)){
  const cfg=segmentState[key],d=defaults[key];cfg.min=cfg.userMin=d[0];cfg.max=cfg.userMax=d[1];
  // thin-region suppression starts off: on large in-memory volumes the
  // processed mask is a whole-volume pass, so it runs only when asked for
  cfg.surfaceMm=0;cfg.thicknessMm=0;configureThinSliders(key,v);
  const enabled=$('[data-seg-enabled="'+key+'"]'),color=$('[data-seg-color="'+key+'"]'),min=$('[data-seg-min="'+key+'"]'),max=$('[data-seg-max="'+key+'"]'),opacity=$('[data-seg-opacity="'+key+'"]');
  const exportBtn=$('[data-seg-export="'+key+'"]'),removeBtn=$('[data-seg-remove="'+key+'"]'),opening=$('[data-seg-opening="'+key+'"]'),closing=$('[data-seg-closing="'+key+'"]'),minComponent=$('[data-seg-min-component="'+key+'"]'),holeFill=$('[data-seg-hole-fill="'+key+'"]');
  const usable=cfg.active;
  enabled.disabled=color.disabled=min.disabled=max.disabled=opacity.disabled=!usable;opening.disabled=closing.disabled=minComponent.disabled=holeFill.disabled=!usable;for(const [attr] of THIN_SLIDERS){const el=$('[data-seg-'+attr+'="'+key+'"]');if(el)el.disabled=!usable}if(exportBtn)exportBtn.disabled=!usable;if(removeBtn)removeBtn.disabled=!usable;enabled.checked=cfg.enabled;color.value=cfg.color;
  min.min=max.min=Math.floor(v.min);min.max=max.max=Math.ceil(v.max);min.value=cfg.min;max.value=cfg.max;opacity.value=cfg.opacity;opening.value=cfg.opening;closing.value=cfg.closing;minComponent.value=cfg.minComponent;holeFill.checked=cfg.holeFill;$('[data-seg-opening-out="'+key+'"]').value=cfg.opening;$('[data-seg-closing-out="'+key+'"]').value=cfg.closing;$('[data-seg-min-component-out="'+key+'"]').value=cfg.minComponent;cfg._maskCache=null;updateSegmentOutputs(key);
 }
 // new data: no overlaps, the default card order
 segmentExclusive.mode='priority';segmentExclusive.order=['contrast','bone','fat','soft','lung'];applyExclusiveRanges();segmentExclusive.pending.clear();
 for(const key of Object.keys(segmentState))updateSegmentOutputs(key);
 renderSegmentPresets();
}
export const FILTER_PARAM_INPUTS={spikeHole:{strength:spikeHoleStrength,thresholdHU:spikeHoleThreshold},nlm:{hHU:nlmStrength,searchRadius:nlmSearchRadius,patchRadius:nlmPatchRadius},anisotropic:{strength:anisotropicStrength,kappaHU:anisotropicKappa,iterations:anisotropicIterations},gaussian:{mode:smoothingType,strength:gaussianStrength,passes:spatialPasses},sigmoid:{strength:sigmoidStrength,center:sigmoidCenter,width:sigmoidWidth},bilateral:{strength:bilateralStrength,spatialSigma:bilateralSpatial,sigmaHU:bilateralIntensity,passes:bilateralPasses},tv:{weight:tvWeight,epsHU:tvEps,iterations:tvIterations},unsharp:{radius:unsharpRadius,amount:unsharpAmount,thresholdHU:unsharpThreshold}};
export const pendingProject={value:null};
// 447: set by applyProject when HU parameters were derived from an old project (no HU values saved); shown in the footer
export const filterLegacyNotes={value:[]};
export function gatherProject(){
 const series=activeSeries,slices=series.slices.length;
 const project={
  app:{version:APP_VERSION,build:APP_BUILD},savedAt:new Date().toISOString(),
  dataset:datasetFingerprint(series),
  display:{windowCenter:wc.value,windowWidth:ww.value,ctRangeMode,slices:Object.fromEntries(Object.keys(planes).map(p=>[p,+planes[p].slider.value]))},
  filters:{order:filterOrder.filter(k=>filterState[k]).map(key=>({key,params:Object.fromEntries(Object.entries(FILTER_PARAM_INPUTS[key]||{}).map(([name,el])=>[name,name in (FILTER_UNITS[key]?.params||{})?+el.value:el.value]))}))},
  // overlap rule and card order (priority); segment min / max below are the user (slider) ranges
  segmentOptions:{exclusive:segmentExclusive.mode,order:[...segmentExclusive.order]},
  segments:Object.fromEntries(SEGMENT_PRESET_ORDER.map(key=>{const g=segmentState[key];return[key,{active:!!g.active,enabled:!!g.enabled,color:g.color,opacity:g.opacity,min:g.userMin??g.min,max:g.userMax??g.max,opening:g.opening,closing:g.closing,minComponent:g.minComponent,holeFill:!!g.holeFill,surfaceMm:g.surfaceMm,thicknessMm:g.thicknessMm,material:materialKey(g.material)}]})),
  surfaceSmoothing:{enabled:!!surfaceSmoothEnabled?.checked,strength:surfaceSmoothStrength?.value??null},
  // were these filters applied to 3D (volume or surfaces) when saved? A loaded
  // project then restores the 3D state too, not only the 2D preview.
  threeD:{filtersApplied:!!currentFilterSignature()&&(gpuVolumeDataSignature()===currentFilterSignature()||!threeDDirty)},
  edits:{},
  // slice-spacing check (optional, informational; no project version bump)
  ...(series.spacingCheck?{spacingCheck:spacingCheckForProject(series.spacingCheck)}:{}),
  // stage 2: position comments of this series (voxel indices; never applied by loading, only by "view this place")
  comments:commentsForProject(datasetFingerprint(series)),
 };
 // distances between two of those points ({id,a,b}: point ids). Only written when there are some; an older app ignores the field (no project version bump)
 {const ms=measurementsForProject(new Set(project.comments.map(c=>c.id)));if(ms.length)project.measurements=ms}
 const binaries={};
 for(const key of SEGMENT_PRESET_ORDER){
  const st=segmentEditState[key],entry={};
  for(const kind of['keep','exclude']){const runs=st[kind+'Runs'];if(runs){const path='edits/'+key+'-'+kind+'.bin';binaries[path]=encodeRuns(runs,slices);entry[kind]=path}}
  if(Object.keys(entry).length)project.edits[key]=entry;
 }
 // analysis results (colour, flags, voxels as runs); volumes are recomputed on load
 const regions=analysisRegionsForProject();
 if(regions.length)project.analysis={regions:regions.map((r,i)=>{const path='analysis/region-'+(i+1)+'.bin';binaries[path]=encodeRuns(r.runsBySlice,slices);const{runsBySlice,...meta}=r;return{...meta,runs:path}})};
 return{project,binaries};
}
export async function applyPendingProject(){
 const pending=pendingProject.value;if(!pending)return;
 const ja=currentLanguage==='ja',ds=pending.project.dataset||{},label=(ds.description||'')+' · '+ds.columns+'×'+ds.rows+'×'+ds.slices;
 if(!volume||!activeSeries)return;
 if(!compareFingerprints(ds,datasetFingerprint(activeSeries)).ok){
  const match=detectedSeries.list.find(s=>s!==activeSeries&&compareFingerprints(ds,datasetFingerprint(s)).ok);
  if(match){await selectSeries(match);return}
  // a project saved with the old first-two-slices spacing may be opened with the new one after confirmation
  const accepted=pending.legacyAccepted!=null&&pending.legacyAccepted===activeSeries.id&&!!legacySpacingUpgrade(ds,datasetFingerprint(activeSeries)),
   r=accepted?{action:'apply'}:await resolveProjectMatchAsync(ds,datasetFingerprint(activeSeries),t=>askInline(t),currentLanguage);
  if(r.action==='cancel'){footer.textContent=ja?'プロジェクトの適用をキャンセルしました（スライス間隔が保存時と異なります）':'Project not applied (the slice spacing differs from the saved one)';return}
  if(r.action==='reject'){
   const issues=r.issues.join(', ');
   footer.textContent=r.reason?(ja?r.reason.ja:r.reason.en):ja?'このプロジェクトは別のデータ用です（'+label+'、不一致: '+issues+'）':'This project belongs to other data ('+label+'; mismatch: '+issues+')';
   return;
  }
 }
 pendingProject.value=null;
 try{await applyProject(pending);const ns=filterLegacyNotes.value,list=ns.map(n=>n.label+' '+formatHU(n.value)+' HU'+(n.fallback?(ja?'（範囲不明のため既定値）':' (range unknown: default)'):'')).join(', ');footer.textContent=(ja?'プロジェクトを適用しました':'Project applied')+(ns.length?(ja?' · 互換値: '+list+'（古いプロジェクト）':' · Compatibility values: '+list+' (old project)'):'')}
 catch(e){console.error(e);footer.textContent=(ja?'プロジェクトを適用できませんでした: ':'Could not apply project: ')+String(e.message||e)}
}
export async function applyProject({project,files}){
 filterLegacyNotes.value=[];
 // validate and decode edits first, so a broken file changes nothing
 const dims={slices:activeSeries.slices.length,columns:activeSeries.columns,rows:activeSeries.rows},edits={};
 for(const[key,entry]of Object.entries(project.edits||{})){
  if(!SEGMENT_PRESET_ORDER.includes(key))continue;edits[key]={};
  for(const kind of['keep','exclude'])if(entry?.[kind]){const bytes=files[entry[kind]];if(!bytes)throw new Error('missing '+entry[kind]);edits[key][kind]=decodeRuns(bytes,dims)}
 }
 // analysis results (projects before 408 have none)
 const analysis=[];
 for(const e of project.analysis?.regions||[]){
  const keys=(e.segmentKeys||[]).filter(k=>SEGMENT_PRESET_ORDER.includes(k));if(!keys.length)continue;
  const bytes=files[e.runs];if(!bytes)throw new Error('missing '+e.runs);
  analysis.push({key:e.key,segmentKeys:keys,color:Number(e.color),visible:e.visible!==false,selected:e.selected===true,merged:!!e.merged,groupId:e.groupId||null,label:normalizeAnalysisLabel(e.label)||undefined,runsBySlice:decodeRuns(bytes,dims)}); // the pinned label (projects before 523 have none)
 }
 // filters (replayed through the filter controls)
 resetFilterBtn.click();
 const legacyRange=filterLegacyRange(!!activeSeries.sourceBacked,sourceRangeFromMetadata(activeSeries.slices),{min:sourceVolume?.min,max:sourceVolume?.max});
 for(const{key,params}of project.filters?.order||[]){
  if(!FILTER_CATALOG_ORDER.includes(key))continue;addFilter(key);
  // the HU parameters are set from resolveFilterParams below; a saved HU value is used as it is, an older project (only the
  // old strength / ratio parameters, which have no control any more) gets old parameter x the range the old code used
  for(const[name,value]of Object.entries(params||{}))if(!(name in (FILTER_UNITS[key]?.params||{})))setControlValue(FILTER_PARAM_INPUTS[key]?.[name],value);
  const r=resolveFilterParams(key,params,legacyRange);
  for(const[name,value]of Object.entries(r.values))setFilterUnitControl(key,name,value);
  for(const d of r.derived)filterLegacyNotes.value.push({key,...d});
 }
 // display
 const display=project.display||{};
 if(display.ctRangeMode)applyCtRangeMode(display.ctRangeMode);
 setControlValue(wc,display.windowCenter);setControlValue(ww,display.windowWidth);
 // segments;: projects saved before 438 have no overlap rule: they keep overlaps ('off'), so their results stay
 const so=project.segmentOptions||{};segmentExclusive.mode=['off','priority'].includes(so.exclusive)?so.exclusive:'off';
 if(Array.isArray(so.order)&&so.order.length)segmentExclusive.order=[...so.order.filter(k=>SEGMENT_PRESET_ORDER.includes(k)),...['bone','fat','soft','lung','contrast'].filter(k=>!so.order.includes(k))];
 renderSegmentPresets();
 for(const key of SEGMENT_PRESET_ORDER){
  const g=project.segments?.[key];
  setControlValue(segmentControl('material',key),materialKey(g?.material)); // also for inactive / missing segments; projects saved before 620 have no material: standard
  if(!g)continue;
  if(!g.active){if(segmentState[key].active)removeSegmentPreset(key);continue}
  if(!segmentState[key].active)addSegmentPreset(key);
  setControlValue(segmentControl('color',key),g.color);
  setControlValue(segmentControl('max',key),g.max);setControlValue(segmentControl('min',key),g.min);setControlValue(segmentControl('max',key),g.max);
  setControlValue(segmentControl('opacity',key),g.opacity);setControlValue(segmentControl('opening',key),g.opening);
  setControlValue(segmentControl('closing',key),g.closing);setControlValue(segmentControl('min-component',key),g.minComponent);
  setControlValue(segmentControl('surface-mm',key),g.surfaceMm??0);setControlValue(segmentControl('thickness-mm',key),g.thicknessMm??0);
  setControlChecked(segmentControl('hole-fill',key),g.holeFill);setControlChecked(segmentControl('enabled',key),g.enabled);
  // the saved range exactly: the slider snaps a value to its step grid, which moves with the slider's
  // range, so each save → load moved a range by a step (measured on main: fat −249…82 → −245…86 → −241…90)
  if(Number.isFinite(+g.min)&&Number.isFinite(+g.max)){const s=segmentState[key];s.userMin=+g.min;s.userMax=+g.max}
 }
 commitExclusiveRanges();for(const key of SEGMENT_PRESET_ORDER)updateSegmentOutputs(key);
 // surface smoothing
 if(project.surfaceSmoothing){smoothingSync.busy=true;try{setControlChecked(surfaceSmoothEnabled,project.surfaceSmoothing.enabled);setControlValue(surfaceSmoothStrength,project.surfaceSmoothing.strength)}finally{smoothingSync.busy=false}}
 // 3D edits (voxel masks at original resolution)
 for(const key of SEGMENT_PRESET_ORDER){
  const st=segmentEditState[key],e=edits[key]||{};
  st.keepRuns=e.keep||null;st.excludeRuns=e.exclude||null;st.cutRuns=null;st.finalRuns=null;st.undo=[];st.redo=[];st.revision++;
  segmentEditGen[key]=(segmentEditGen[key]|0)+1;
 }
 // the restored edits make their segments voxel takers: the segments below follow
 commitExclusiveRanges();
 if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){syncGpuVolumeEdits(sourceVolume||volume);for(const key of SEGMENT_PRESET_ORDER){const st=segmentEditState[key];if(st.keepRuns||st.excludeRuns||st.surfaceGroup)surfaceEditsPending.add(key)}}
 // position comments: just stored (no view is moved)
 let commentIdMap={};
 if(Array.isArray(project.comments))commentIdMap=loadProjectComments(project.comments,datasetFingerprint(activeSeries)); // merged, never replaced (unsaved / other-series comments stay)
 // distances (after the points: entries whose points are missing are dropped; the other fields are never touched)
 if(Array.isArray(project.measurements))loadProjectMeasurements(project.measurements,commentIdMap);
 // slice positions
 for(const[p,idx]of Object.entries(display.slices||{}))if(planes[p]&&Number.isFinite(+idx))planes[p].slider.value=String(Math.max(0,Math.min(+planes[p].slider.max,+idx)));
 // 3D: projects without the flag (saved before) count as applied
 const applied=project.threeD?.filtersApplied??!!(project.filters?.order||[]).length;
 if(applied&&currentFilterSignature()&&(sourceVolume||volume)?.sourceBacked){
  gpuVolumeApplied.seriesId=(sourceVolume||volume)?.series?.id??null;gpuVolumeApplied.signature=currentFilterSignature();
  applyVolumeAfterFilterRebuild.value=true; // see rebuildActiveFilters
 }
 clearAnalysisHighlight();renderAll();scheduleSegment3D();updateAnalysisEditorControls();updateVolumeFilterBadge();
 if(analysis.length)await restoreAnalysisRegions(analysis);
}
// 体験会モード, the VR 「最初の状態に戻す」 button: the annotations of the open practice data go back to what its project file holds, IN PLACE (no decode, no GPU upload:
// the volume stays as it is, which is what a running XR session needs). resetUserState empties the points / distances / histogram / HU choice, then the project's
// own points, distances (with their moved labels) and the pinned analysis labels (with their moved places) are put back, and so are the segments' visibility (enabled flags) and the
// CT window the project file starts with (the VR menu can switch every segment and move its own window: those are VR-local and re-derived from the page's, vr-view.js resetToStart;
// the page's own flags / window are put back here so that both sides start from the same file). Filters are not touched: nothing in VR changes them. Returns false when no data is open.
export function restoreProjectAnnotations(parsed){
 if(!activeSeries)return false;
 resetUserState();
 const project=parsed?.project;if(!project)return true; // no project file for this data: everything the visitor added is cleared, nothing to put back
 let idMap={};
 if(Array.isArray(project.comments))idMap=loadProjectComments(project.comments,datasetFingerprint(activeSeries));
 if(Array.isArray(project.measurements))loadProjectMeasurements(project.measurements,idMap);
 // the regions come back in the project's order (applyProject / restoreAnalysisRegions): each takes the next entry with its key
 const entries=[...(project.analysis?.regions||[])];
 for(const r of analysisRegions){
  const i=entries.findIndex(e=>e.key===r.key&&!!e.merged===!!r.merged);if(i<0)continue;
  const [e]=entries.splice(i,1);setRegionLabel(r,normalizeAnalysisLabel(e.label)); // no label in the file = unpinned
 }
 // segment visibility: off first, then on (at most 4 shown); only what differs is touched (no needless 3D work)
 const plan=segmentVisibilityPlan(project.segments,segmentState,SEGMENT_PRESET_ORDER);
 for(const k of plan.off)setControlChecked(segmentControl('enabled',k),false);
 for(const k of plan.on)setControlChecked(segmentControl('enabled',k),true);
 // the CT window of the file
 const display=project.display||{};
 if(Number.isFinite(+display.windowCenter)&&+wc.value!==+display.windowCenter)setControlValue(wc,display.windowCenter);
 if(Number.isFinite(+display.windowWidth)&&+ww.value!==+display.windowWidth)setControlValue(ww,display.windowWidth);
 return true;
}
// moved to utils.js (analysis-ops.js needs it without importing data-load.js)
export { downloadBlob };
// loading (practice data, series decode) in the progress modal; calls are paired
// phase of the running load in the modal title (the side-panel texts sit behind the modal)
export function loadPhase(ja,en){setBusyLabel('load',currentLanguage==='en'?'Loading data · '+en:'データを読み込み中 · '+ja)}
export function busy(v){setBusySlot('load',v,{label:currentLanguage==='en'?'Loading data…':'データを読み込み中…',counted:true})}
