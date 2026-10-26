
import { ledgerText } from './mem-ledger.js?v=20261026-build670';
import * as memVolumeIo from './volume-io.js?v=20261026-build670';
import * as memSourceFilters from './source-filters.js?v=20261026-build670';
import * as memState from './state.js?v=20261026-build670';
import * as memGpu from './gpu-compute.js?v=20261026-build670';
import { initSettingsDialog } from './settings-ui.js?v=20261026-build670';
import { initTutorialUi } from './tutorial-ui.js?v=20261026-build670';
import { initEventModeUi } from './event-mode-ui.js?v=20261026-build670';
import { logGpuError } from './gpu-diagnostics.js?v=20261026-build670';
import { initThemeUi } from './theme-ui.js?v=20261026-build670';
import { mark3DCurrent, mark3DStale, set3DState } from './three-state.js?v=20261026-build670';
import { gpuVolumeRefresh, set3DBusy } from './three-status.js?v=20261026-build670';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js';
import dicomParser from 'https://esm.sh/dicom-parser@1.8.21';
import { MedicalVolumeRenderer } from './medical-volume.js?v=20261026-build670';
import 'https://esm.sh/fflate@0.8.2';
import { rangeWheelSteps, installRangeEntry, setRangeEntryBounds } from './range-entry.js?v=20261026-build670';
import { clampRangeValue, esc, fmt, frameYield, isIPadRuntime, rangeNumber, rangeStep } from './utils.js?v=20261026-build670';
import { setMeshMaterialBackend, updateMeshDepth, setSegmentMeshMaterial } from './mesh-material.js?v=20261026-build670'; // the surface meshes evaluate the same lighting formula as the two volume shaders (lighting.js)
import { materialKey } from './lighting.js?v=20261026-build670';
import { groupSeries, parseFiles } from './dicom.js?v=20261026-build670';
import './mask-ops.js?v=20261026-build670';
import './run-length.js?v=20261026-build670';
import './mesh-geometry.js?v=20261026-build670';
import { applyLanguage, tr, I18N } from './i18n.js?v=20261026-build670';
import { installComments, refreshCommentsUi } from './comment-ui.js?v=20261026-build670';
import { installComment3d, updateComment3dMarkers } from './comment-3d.js?v=20261026-build670';
import { installHuLine3d, updateHuLine3d } from './hu-line-3d.js?v=20261026-build670';
import { installCrosshair, crosshairPointerDown, crosshairPointerMove, crosshairPointerEnd, setCrosshairMode, refreshCrosshairUi } from './crosshair-ui.js?v=20261026-build670';
import './gpu-shaders.js?v=20261026-build670';
import { analysisCutApplying, analysisCutScreen, analysisEditPreparing, analysisEditTargetKey, analysisEditTargetMode, analysisEditTool, analysisPendingCut, analysisRegions, ctRangeMode, current3DVolume, currentLanguage, cutControlPreviewRaf, filterRebuildTimer, incFilterRebuildRevision, incSourceRenderRevision, MPR3D_SURFACE_OPACITY_DEFAULT, mpr3DSurfaceOpacity, mpr3DVolumeOpacity, precisionRangeDrag, sceneState, sectionCapEnabled, sectionCapHatch, sectionCapOpacity, sectionSliceImageVisible, sectionViewOpen, sectionViewPlane, sectionViewReverse, setActiveId, setActiveSeries, setAnalysisCutApplying, setAnalysisCutScreen, setAnalysisCutStroke, setAnalysisEditPreparing, setAnalysisEditTargetKey, setAnalysisEditTargetMode, setAnalysisEditTool, setAnalysisPendingCut, setCtRangeMode, setCtRangeProfile, setCurrent3DVolume, setCutControlPreviewRaf, setFilterOrder, setMemoryGpuPreviewActive, setMpr3DSurfaceOpacity, setMpr3DVolumeOpacity, setPrecisionRangeDrag, setSceneState, setSectionCapEnabled, setSectionCapHatch, setSectionCapOpacity, setSectionSliceImageVisible, setSectionViewOpen, setSectionViewPlane, setSectionViewReverse, setSmoothingRefreshTimer, setSourceOrthogonalPlaneCacheBytes, setSourceVolume, setThreeDCancelRequested, setThreeRenderMode, setVolume, setVolumeAnalysisBusy, setVolumeAnalysisMode, smoothingRefreshTimer, sourceVolume, threeDApplying, threeDCancelRequested, threeDDirty, threeRenderMode, volume, volumeAnalysisBusy, volumeAnalysisMode, clearCrosshair } from './state.js?v=20261026-build670';
import { $, sampleDemoBtn, sampleDialog, sampleDialogClose, sampleChoiceButtons, vrViewBtn, arViewBtn, analysisClearButton, analysisCutApply, analysisCutButton, analysisCutCancel, analysisCutDepth, analysisCutOffset, analysisCutPitch, analysisCutWidth, analysisCutYaw, analysisEditRemoveSelected, analysisEditTargetSelect, analysisExportSelected, analysisKeepSelected, analysisLassoButton, analysisLassoDeselectButton, analysisDeselectAll, analysisEditDeselectAll, analysisLineCutButton, analysisMergeButton, analysisNavigateButton, analysisRedo, analysisRemoveSelected, analysisResetEdit, analysisSelectRegionButton, analysisUndo, anisotropicBtn, anisotropicIterations, anisotropicIterationsValue, anisotropicStrength, anisotropicStrengthValue, app, appVersionBadge, bar, bilateralBtn, bilateralIntensity, bilateralIntensityValue, bilateralPasses, bilateralPassesValue, bilateralSpatial, bilateralSpatialValue, bilateralStrength, bilateralStrengthValue, ctRangeAuto, ctRangeFull, filterRebuild3D, footer, gaussianBtn, gaussianStrength, gaussianStrengthValue, languageToggle, list, mainViewSlot, mpr3DSliceSliders, mprSurfaceOpacity, mprSurfaceOpacityValue, mprVolumeOpacity, mprVolumeOpacityValue, nlmBtn, nlmPatchRadius, nlmPatchRadiusValue, nlmSearchRadius, nlmSearchRadiusValue, nlmStrength, nlmStrengthValue, planes, prog, renderModeToggle, resetFilterBtn, sectionCapEnabledControl, sectionCapHatchControl, sectionCapOpacityControl, sectionCapOpacityValue, sectionPosition, sectionReverse, sectionSliceImageControl, sectionViewToggle, segmentAddButton, segmentAddSelect, selected, sigmoidBtn, sigmoidCenter, sigmoidCenterValue, sigmoidWidth, sigmoidWidthValue, sigmoidStrength, sigmoidStrengthValue, smoothingType, spatialPasses, spatialPassesValue, spikeHoleBtn, spikeHoleStrength, spikeHoleStrengthValue, spikeHoleThreshold, spikeHoleThresholdValue, state, status, surfaceSmoothEnabled, surfaceSmoothStrength, surfaceSmoothValue, threeBusyCancel, threeBusyLabel, threeEditOverlay, threeLabel, tvBtn, tvIterations, tvIterationsValue, tvWeight, tvWeightValue, unsharpAmount, unsharpAmountValue, unsharpBtn, unsharpRadius, unsharpRadiusValue, unsharpThreshold, unsharpThresholdValue, viewport, volumeAnalysisResult, volumeAnalysisToggle, volumeCacheClearBtn, wc, wcVal, ww, wwVal, anisotropicKappa, anisotropicKappaValue } from './ui-shell.js?v=20261026-build670';
import './latest-runner.js?v=20261026-build670';
import { saveDeviceSmoothing, applyDeviceSmoothing } from './settings.js?v=20261026-build670';
import { ensureGpuFilterDevice, setGpuComputeBackend, updateGpuStatus } from './gpu-compute.js?v=20261026-build670';
import { sourceSliceCache } from './volume-io.js?v=20261026-build670';
import './lasso.js?v=20261026-build670';
import { spacingWarningText } from './slice-spacing.js?v=20261026-build670';
import { resolveProjectMatch, datasetFingerprint, unpackProject } from './project-file.js?v=20261026-build670';
import './gpu-volume-cache.js?v=20261026-build670';
import { filterState, getFilteredSourceAxialBlock, currentFilterSignature } from './source-filters.js?v=20261026-build670';
import { sourceOrthogonalPlaneCache, sourceOrthogonalPlanePending } from './mpr-orthogonal.js?v=20261026-build670';
import { request3DRender } from './scene3d.js?v=20261026-build670';
import { makeAxisWidget, create3DRenderer, makeViewOverlays, makeViewRotation, makeCutTools } from './scene-view.js?v=20261026-build670';
import './cpu-filters.js?v=20261026-build670';
import { mpr3DOpacitySource, mpr3DOrthoSliding, mpr3DPreviewCache, mpr3DVisibility, recomposeSectionCaps, restoreSectionAutoPlane, setMpr3DOverlayVisible, showSectionPlaneOverlay, syncMpr3DOverlayPresentation, syncMpr3DSliceSliders, syncSectionCapPresentation, updateMpr3DPlanePositions } from './mpr3d-overlay.js?v=20261026-build670';
import { SEGMENT_PRESET_ORDER, gpuSegmentOrder, segmentEditActive, segmentEditState, segmentNeedsGlobalMask, segmentNeedsVoxelMask, segmentHasProcessedMask, segmentState, segmentExclusive, applyExclusiveRanges, commitExclusiveRanges } from './segments.js?v=20261026-build670';
import { rebindWebGpuSectionClipGroup, sectionPlaneLabel, updateSectionClipPlaneWorld, updateSectionViewUi } from './section-view.js?v=20261026-build670';
import { cancelSourceMprWarmup, renderAll, renderSectionPlaneLive, schedulePlaneRender, updateMprCanvasPhysicalAspect } from './mpr-render.js?v=20261026-build670';
import './busy.js?v=20261026-build670';
import { setBusySlot } from './progress-modal.js?v=20261026-build670';
import { createXrFeedback } from './xr-feedback.js?v=20261026-build670';
import { ensureSegmentBaseRuns, getFinalSegmentRuns, setSegmentStatus } from './segment-runs.js?v=20261026-build670';
import { dispose } from './surface-mesh.js?v=20261026-build670';
import { clearCutResultPreview, refreshCutControlReadouts, scheduleCutResultPreview, updateAnalysisEditorControls, updateCutPreview, updateThreeEditUi } from './edit-tools.js?v=20261026-build670';
import { applySectionClippingMaterials, ensureEditRaycastReady, ensureGpuResidentCpuPositions, refreshEditedSegmentSurface, segmentHasSurface, setSegmentSurfaceShown, syncSectionClipParent } from './surface-build.js?v=20261026-build670';
import { removeAnalysisRegion, renderAnalysisResults, setAnalysisFocusedRegion } from './analysis-results.js?v=20261026-build670';
import { syncGpuVolumeEdits, updateVolumeCacheControl, volumeCache } from './gpu-volume-data.js?v=20261026-build670';
import { clearMemoryFilterPreviewCache, progress, rebuildCurrent3D, surfaceEditsPending, surfaceRebuildPending } from './rebuild-3d.js?v=20261026-build670';
import { formatHU, restoreFilterUnitRange, resetFilterUnitControls, currentMainViewKey, installFilterReorder, invalidateSourceFilters, liveFilterState, renderFilterOrder, scheduleFilterRebuild, syncFilterControls } from './filter-pipeline.js?v=20261026-build670';
import { APP_BUILD, APP_VERSION } from './version.js?v=20261026-build670';
import { addSegmentPreset, refuseSegmentEnable, setSegmentEnabled, ctSliderFullBounds, installSegmentReorder, applyCtRangeMode, clearAnalysisHighlight, clearSegmentEditCache, removeSegmentPreset, renderSegmentPresets, scheduleSegment3D, updateSegmentOutputs, THIN_SLIDERS, formatMmVoxels, thinSliderValue } from './segment-ui.js?v=20261026-build670';
import { installSegmentHistogram } from './histogram-ui.js?v=20261026-build670';
import { installLineProfile, lineProfilePointerDown, lineProfilePointerMove, lineProfilePointerEnd } from './line-profile-ui.js?v=20261026-build670';
import { installCropExport, installCrop3d, updateCrop3d, cropPointerDown, cropPointerMove, cropPointerEnd } from './crop-ui.js?v=20261026-build670';
import { sampleProjectUrl } from './sample-sets.js?v=20261026-build670';
import { syncProcessedSegmentsToVolume, loadSampleDemo, activateMedicalVolume, applyPendingProject, busy, loadPhase, detectedSeries, enableProcessingControls, refreshSpacingWarning, pendingProject, requestIPadSettingsTab, selectSeries, setThreeVolumeOverlay, updateRenderModeControl, restoreProjectAnnotations } from './data-load.js?v=20261026-build670';
import { initIPadGpuQualityControl, initIPadWorkspaceUi } from './workspace-ui.js?v=20261026-build670';
import { installAnalysisDock } from './analysis-dock.js?v=20261026-build670';
import { installPaneResize } from './pane-resize.js?v=20261026-build670';
import { askInline, armConfirm } from './inline-ask.js?v=20261026-build670';
import { freshForEventSelection, resetUserState, EVENT_FRESH_EVENT } from './event-fresh.js?v=20261026-build670';
import { eventModeOn } from './event-mode.js?v=20261026-build670'; // 体験会モード: every practice dataset opens fresh from its project file
import { deselectAllAnalysisRegions, deselectRegionsInLasso, analysisRegionAtVoxel, analyzeEditRegionAtPointer, analyzeVolumeAtPointer, analyzeVolumeAtVoxel, applyCutStroke, applyEditKeepSelected, applyEditRemoveSelected, clearAllSegmentEdits, clearThreeEditOverlay, exportFocusedAnalysisRegionStl, exportSegmentStl, mergeSelectedAnalysisRegions, redoSegmentEdit, resetFocusedSegmentEdit, returnToNavigate, scheduleAnalysisRunPrewarm, selectRegionsInLasso, syncVolumeAnalysisOverlay, undoSegmentEdit } from './analysis-ops.js?v=20261026-build670';
import { makeDeferredEnd } from './deferred-end.js?v=20261026-build670';
async function ensureLatestDeployedBuild(){
 try{
  const res=await fetch('./version.json?t='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if(!res.ok)return;
  const latest=await res.json(),build=String(latest?.build||'');
  if(!build||build===String(APP_BUILD))return;
  const url=new URL(location.href),requested=url.searchParams.get('build');
  console.warn('Build marker differs from loaded app.',{loaded:String(APP_BUILD),published:build,requested});
  if(requested===build)return;
  url.searchParams.set('build',build);
  url.searchParams.set('_',Date.now().toString(36));
  location.replace(url.toString());
 }catch(e){console.warn('Version check failed.',e)}
}




// Unified range controls:
// - wheel works on every range input
// - pointer dragging is relative and intentionally slower than the browser default
const RANGE_DRAG_MOUSE_GAIN=.48,RANGE_DRAG_TOUCH_GAIN=.36;
const SLICE_SLIDER_SELECTOR='#axial-slider,#coronal-slider,#sagittal-slider,[id^="mpr3d-slider-"],#section-position';
function rangeValueAtPointer(el,clientX,min,max){const r=el.getBoundingClientRect(),t=r.width>0?(clientX-r.left)/r.width:0;return min+Math.max(0,Math.min(1,t))*(max-min)}
const setRangeValue=(el,value,commit=false)=>{
 const next=clampRangeValue(el,value);if(Number(el.value)===next)return false;
 el.value=String(next);el.dispatchEvent(new Event('input',{bubbles:true}));
 if(commit)el.dispatchEvent(new Event('change',{bubbles:true}));
 return true;
};
const rangeWheelState=new WeakMap();
// While a range slider is dragged or wheeled and the 3D view shows GPU volume
// rendering, render at the reduced resolution used for camera rotation, so
// sliders stay responsive. Overlays (cut preview, analysis mesh) stay visible.
const sliderFastInteraction={active:false,timer:null};
function beginSliderFastInteraction(){
 clearTimeout(sliderFastInteraction.timer);sliderFastInteraction.timer=null;
 if(sliderFastInteraction.active)return;
 if(!(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active&&sceneState.setFastInteraction))return;
 sliderFastInteraction.active=true;sceneState.setFastInteraction(true,true);
}
function endSliderFastInteraction(delay=0){
 if(!sliderFastInteraction.active)return;
 clearTimeout(sliderFastInteraction.timer);
 sliderFastInteraction.timer=setTimeout(()=>{sliderFastInteraction.timer=null;sliderFastInteraction.active=false;sceneState?.setFastInteraction?.(false)},delay);
}
document.addEventListener('wheel',e=>{
 const el=e.target?.closest?.('input[type="range"]');if(!el||el.disabled)return;
 e.preventDefault();
 const delta=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX;if(!delta)return;
 const state=rangeWheelState.get(el)||{acc:0,timer:null};rangeWheelState.set(el,state);
 const steps=rangeWheelSteps(state,delta,e.deltaMode);
 if(steps){
  beginSliderFastInteraction();endSliderFastInteraction(220);
  setRangeValue(el,Number(el.value)-steps*rangeStep(el)*(e.shiftKey?10:1),false);
  clearTimeout(state.timer);state.timer=setTimeout(()=>el.dispatchEvent(new Event('change',{bubbles:true})),140);
 }
},{passive:false,capture:true});
installRangeEntry();setRangeEntryBounds(ctSliderFullBounds);

document.addEventListener('pointerdown',e=>{
 const el=e.target?.closest?.('input[type="range"]');if(!el||el.disabled||e.button!==0)return;
 // a widened (old project) HU slider goes back to 10-300 before the drag remembers min / max
 if(el.dataset.widened){restoreFilterUnitRange(el);el.dispatchEvent(new Event('input',{bubbles:true}))}
 const min=rangeNumber(el,'min',0),max=rangeNumber(el,'max',100),step=rangeStep(el),steps=Math.max(1,(max-min)/step);
 const gain=steps<=12 ? 0.78 : (e.pointerType==='touch'?RANGE_DRAG_TOUCH_GAIN:RANGE_DRAG_MOUSE_GAIN);
 const absolute=el.matches(SLICE_SLIDER_SELECTOR);
 setPrecisionRangeDrag({el,id:e.pointerId,startX:e.clientX,startValue:Number(el.value),min,max,step,gain,moved:false,absolute});
 if(absolute){const value=rangeValueAtPointer(el,e.clientX,min,max);if(Math.round(value/step)!==Math.round(Number(el.value)/step)){precisionRangeDrag.moved=true;beginSliderFastInteraction();setRangeValue(el,value,false)}}
 el.focus({preventScroll:true});el.style.touchAction='none';
 try{el.setPointerCapture(e.pointerId)}catch{}
 e.preventDefault();
},{capture:true});
document.addEventListener('pointermove',e=>{
 const d=precisionRangeDrag;if(!d||d.id!==e.pointerId||d.el.disabled)return;
 const width=Math.max(80,d.el.getBoundingClientRect().width),dx=e.clientX-d.startX;
 if(Math.abs(dx)>1){d.moved=true;beginSliderFastInteraction()}
 const value=d.absolute?rangeValueAtPointer(d.el,e.clientX,d.min,d.max):d.startValue+(dx/width)*(d.max-d.min)*d.gain;
 setRangeValue(d.el,value,false);e.preventDefault();
},{capture:true});
const finishPrecisionRangeDrag=e=>{
 const d=precisionRangeDrag;if(!d||d.id!==e.pointerId)return;
 try{if(d.el.hasPointerCapture(e.pointerId))d.el.releasePointerCapture(e.pointerId)}catch{}
 d.el.style.touchAction='';if(d.moved)d.el.dispatchEvent(new Event('change',{bubbles:true}));
 setPrecisionRangeDrag(null);endSliderFastInteraction(120);e.preventDefault();
};
// iPad Safari still runs the native range behaviour for touches (the thumb
// jumps to and follows the finger) next to the precision drag above, so the
// value alternated between the two positions and 2D slices flickered (build
// 226, touch only; pen was fine). Suppress the native touch handling: on
// touchstart except in the scrollable sidebar (vertical scroll may start on a
// slider there), and on every touchmove of an active precision drag.
document.addEventListener('touchstart',e=>{
 const el=e.target?.closest?.('input[type="range"]');if(!el||el.disabled||el.closest('.sidebar-scroll'))return;
 e.preventDefault();
},{passive:false,capture:true});
document.addEventListener('touchmove',e=>{
 const d=precisionRangeDrag;if(!d||e.target?.closest?.('input[type="range"]')!==d.el)return;
 e.preventDefault();
},{passive:false,capture:true});
document.addEventListener('pointerup',finishPrecisionRangeDrag,{capture:true});
document.addEventListener('pointercancel',finishPrecisionRangeDrag,{capture:true});

const mprResizeObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>{if(volume)for(const p of Object.keys(planes))updateMprCanvasPhysicalAspect(p)}):null;
for(const p of Object.keys(planes))if(planes[p].canvas?.parentElement)mprResizeObserver?.observe(planes[p].canvas.parentElement);
languageToggle.onclick=()=>{applyLanguage(currentLanguage==='ja'?'en':'ja');renderAnalysisResults();refreshSpacingWarning();updateSectionViewUi();updateThreeEditUi();updateGpuStatus();updateRenderModeControl();refreshCrosshairUi();refreshCommentsUi()};
applyLanguage('ja');installCrosshair();installComments();;
if(appVersionBadge)appVersionBadge.textContent='Virtual Rodent Lab · v'+APP_VERSION+' · build '+APP_BUILD;
function updateSectionCapControls(){
 if(sectionSliceImageControl)sectionSliceImageControl.checked=sectionSliceImageVisible;
 if(sectionCapEnabledControl)sectionCapEnabledControl.checked=sectionCapEnabled;
 if(sectionCapOpacityControl)sectionCapOpacityControl.value=String(Math.round(sectionCapOpacity*100));
 if(sectionCapOpacityValue)sectionCapOpacityValue.value=Math.round(sectionCapOpacity*100)+'%';
 if(sectionCapHatchControl)sectionCapHatchControl.checked=sectionCapHatch;
}
if(sectionSliceImageControl)sectionSliceImageControl.onchange=()=>{setSectionSliceImageVisible(!!sectionSliceImageControl.checked);syncMpr3DOverlayPresentation();recomposeSectionCaps();request3DRender()};
if(sectionCapEnabledControl)sectionCapEnabledControl.onchange=()=>{setSectionCapEnabled(!!sectionCapEnabledControl.checked);updateSectionViewUi();recomposeSectionCaps();request3DRender()};
if(sectionCapOpacityControl)sectionCapOpacityControl.oninput=()=>{setSectionCapOpacity(Math.max(0,Math.min(1,+sectionCapOpacityControl.value/100)));updateSectionCapControls();recomposeSectionCaps();request3DRender()};
if(sectionCapHatchControl)sectionCapHatchControl.onchange=()=>{setSectionCapHatch(!!sectionCapHatchControl.checked);recomposeSectionCaps();request3DRender()};
updateSectionCapControls();
function updateMpr3DOpacityControls(){
 if(mprSurfaceOpacity){mprSurfaceOpacity.value=String(Math.round(mpr3DSurfaceOpacity*100));mprSurfaceOpacityValue.value=Math.round(mpr3DSurfaceOpacity*100)+'%'}
 if(mprVolumeOpacity){mprVolumeOpacity.value=String(Math.round(mpr3DVolumeOpacity*100));mprVolumeOpacityValue.value=Math.round(mpr3DVolumeOpacity*100)+'%'}
 // also called during startup, before the 3D slice panel is initialised
 if(mpr3DSlicePanelReady.value)syncMpr3DSliceSliders();
}
const mpr3DSlicePanelReady={value:false};
const sectionStats={last:0,ms:0,n:0};
function reportSectionRenderStats(r){
 if(!DRAW_TIMES_DEBUG()||!sectionViewOpen||!sectionViewPlane||threeRenderMode==='volume')return;
 const now=performance.now(),dt=sectionStats.last?now-sectionStats.last:0;sectionStats.last=now;
 if(dt>0&&dt<1000)sectionStats.ms=sectionStats.ms?sectionStats.ms*.9+dt*.1:dt;
 if(++sectionStats.n%20)return;
 const hw=sceneState.backend==='WEBGPU'?(r.hasFeature?.('clip-distances')?'HW':'discard'):'WebGL',info=r.info?.render||{};
 footer.textContent='section clip '+hw+' · calls '+(info.calls??info.drawCalls??'?')+' · tris '+(info.triangles??'?')+' · '+sectionStats.ms.toFixed(1)+' ms/frame';
}
const DRAW_TIMES_DEBUG=()=>!!globalThis.__vrlSettings?.debugOn?.()||(typeof location!=='undefined'&&/[?&]debug(\b|=|&|$)/.test(location.search));
function reportDrawTimes(ms2d=null){if(!DRAW_TIMES_DEBUG())return;const f=sceneState?.medicalVolume?.lastFrameMs,ja=currentLanguage==='ja';footer.textContent=(ms2d==null?'':(ja?'2D描画 ':'2D paint ')+Math.round(ms2d)+' ms · ')+(ja?'3D描画 ':'3D frame ')+(f==null?'—':Math.round(f)+' ms')}
if(mprSurfaceOpacity)mprSurfaceOpacity.oninput=()=>{setMpr3DSurfaceOpacity(Math.max(0,Math.min(1,+mprSurfaceOpacity.value/100)));updateMpr3DOpacityControls();syncMpr3DOverlayPresentation();recomposeSectionCaps();reportDrawTimes()};
if(mprVolumeOpacity)mprVolumeOpacity.oninput=()=>{setMpr3DVolumeOpacity(Math.max(0,Math.min(1,+mprVolumeOpacity.value/100)));updateMpr3DOpacityControls();syncMpr3DOverlayPresentation();reportDrawTimes()};
updateMpr3DOpacityControls();
function clearSectionView(){
 restoreSectionAutoPlane();setSectionViewPlane(null);setSectionViewReverse(true);
 if(threeRenderMode!=='volume'){syncSectionClipParent();applySectionClippingMaterials(sceneState?.obj)}
 updateSectionViewUi();request3DRender();
}
let planeSyncing=false,selectedPlane=null;
// the plane in use now — the last one chosen, else a 2D main view, else the workspace 2D tab, else axial
function currentPlane(){const ok=k=>['axial','coronal','sagittal'].includes(k)?k:null;return selectedPlane||ok(mainViewSlot?.querySelector('.view-card')?.dataset.viewKey)||ok(document.querySelector('[data-ipad-mpr].is-active')?.dataset.ipadMpr)||'axial'}
function selectPlane(p,source){
 if(planeSyncing||!['axial','coronal','sagittal'].includes(p))return;selectedPlane=p;planeSyncing=true;
 try{
  if(source!=='section'&&sectionViewOpen&&sectionViewPlane!==p)setSectionView(p);
  if(source!=='overlay')for(const k of ['axial','coronal','sagittal'])if(!!mpr3DVisibility[k]!==(k===p))setMpr3DOverlayVisible(k,k===p);
  const mainKey=mainViewSlot?.querySelector('.view-card')?.dataset.viewKey;
  if(source!=='main'&&mainKey&&mainKey!=='3d'&&mainKey!==p)moveViewToMain(p);
  sceneState?.setAxisView?.(p==='axial'?'z':p==='coronal'?'y':'x');
  document.dispatchEvent(new CustomEvent('vrl-plane-selected',{detail:{plane:p,source}}));
 }finally{planeSyncing=false}
}
document.addEventListener('vrl-plane-chosen',e=>selectPlane(e.detail?.plane,e.detail?.source||'workspace'));
function setSectionView(key){
 if(key==='off'){clearSectionView();return}
 if(!planes[key])return;
 setSectionViewOpen(true);setSectionViewPlane(key);showSectionPlaneOverlay(key);
 if(sectionPosition){sectionPosition.max=planes[key].slider.max;sectionPosition.value=planes[key].slider.value}
 if(threeRenderMode!=='volume'){updateSectionClipPlaneWorld();rebindWebGpuSectionClipGroup();syncSectionClipParent();applySectionClippingMaterials(sceneState?.obj)}
 updateMpr3DPlanePositions();updateSectionViewUi();request3DRender();
 if(threeRenderMode!=='volume'){syncMpr3DOverlayPresentation();renderSectionPlaneLive(key,true)} // the slice image switch and the mesh cap
}
function mprEventVoxel(p,event){
 if(!volume)return null;const c=planes[p],rect=c.canvas.getBoundingClientRect();
 const cx=Math.max(0,Math.min(c.canvas.width-1,Math.floor((event.clientX-rect.left)/Math.max(rect.width,1)*c.canvas.width)));
 const cy=Math.max(0,Math.min(c.canvas.height-1,Math.floor((event.clientY-rect.top)/Math.max(rect.height,1)*c.canvas.height)));
 const idx=+c.slider.value,d=volume.slices;
 if(p==='axial')return{x:cx,y:cy,z:idx};
 if(p==='coronal')return{x:cx,y:idx,z:d-1-cy};
 return{x:idx,y:cx,z:d-1-cy};
}
function selectAnalysisRegionFromMpr(p,event){
 if(!volumeAnalysisMode)return false;
 const voxel=mprEventVoxel(p,event);if(!voxel)return false;
 const region=analysisRegionAtVoxel(voxel.x,voxel.y,voxel.z);
 if(region){setAnalysisFocusedRegion(region.id,voxel);return true}
 void analyzeVolumeAtVoxel(voxel.x,voxel.y,voxel.z);return true;
}


function deactivateMedicalVolume(){
 const mv=sceneState?.medicalVolume;if(mv)mv.setActive(false);setThreeVolumeOverlay(false);setThreeRenderMode('surface');syncMpr3DOverlayPresentation();updateRenderModeControl();
 threeLabel.textContent=sceneState?.backend||'3D';request3DRender();
 if(threeDDirty)mark3DStale();else mark3DCurrent();
}
function cancel3DRebuild(){
 if(!threeDApplying||threeDCancelRequested)return;
 setThreeDCancelRequested(true);gpuVolumeRefresh.token++;gpuVolumeRefresh.running=null;
 incFilterRebuildRevision(false);
 invalidateSourceFilters();
 if(threeBusyLabel)threeBusyLabel.textContent=tr('cancelling3D');
 if(threeBusyCancel)threeBusyCancel.disabled=true;
 filterRebuild3D.disabled=true;
 footer.textContent=tr('cancelling3D');
}
// Surface meshes left stale by a volume-only rebuild; rebuilt when switching
// back to surface mode.
segmentAddButton.onclick=()=>{addSegmentPreset(segmentAddSelect.value);syncProcessedSegmentsToVolume()};
analysisMergeButton.onclick=()=>void mergeSelectedAnalysisRegions();
analysisClearButton.onclick=()=>clearAnalysisHighlight();
analysisNavigateButton.onclick=()=>{if(analysisCutApplying||analysisPendingCut)return;setAnalysisEditTool('select');setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);setAnalysisCutStroke(null);setAnalysisCutScreen([]);clearThreeEditOverlay();updateAnalysisEditorControls();updateThreeEditUi(currentLanguage==='ja'?'通常操作':'Navigate');request3DRender()};
analysisSelectRegionButton.onclick=async()=>{if(analysisCutApplying||analysisPendingCut||analysisEditPreparing)return;if(analysisEditTool==='region'){setAnalysisEditTool('select');updateAnalysisEditorControls();updateThreeEditUi(currentLanguage==='ja'?'通常操作':'Navigate');return}setAnalysisEditPreparing(true);setAnalysisEditTool('region');setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);updateAnalysisEditorControls();try{if(threeRenderMode==='surface')await ensureGpuResidentCpuPositions(null,currentLanguage==='ja'?'領域選択データを準備中':'Preparing region selection');updateThreeEditUi(tr('editRegionHint'))}catch(e){setAnalysisEditTool('select');console.error(e);footer.textContent=(currentLanguage==='ja'?'領域選択の準備に失敗しました: ':'Region selection preparation failed: ')+String(e.message||e)}finally{setAnalysisEditPreparing(false);updateAnalysisEditorControls()}};
analysisLassoButton.onclick=async()=>{if(analysisCutApplying||analysisPendingCut||analysisEditPreparing)return;if(analysisEditTool==='lasso'){setAnalysisEditTool('select');updateAnalysisEditorControls();updateThreeEditUi(currentLanguage==='ja'?'通常操作':'Navigate');return}setAnalysisEditTool('lasso');setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);updateAnalysisEditorControls();updateThreeEditUi(tr('editLassoHint'))};
// lasso unselect (same loop as lasso select)
analysisLassoDeselectButton.onclick=async()=>{if(analysisCutApplying||analysisPendingCut||analysisEditPreparing)return;if(analysisEditTool==='unlasso'){setAnalysisEditTool('select');updateAnalysisEditorControls();updateThreeEditUi(currentLanguage==='ja'?'通常操作':'Navigate');return}setAnalysisEditTool('unlasso');setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);updateAnalysisEditorControls();updateThreeEditUi(tr('editLassoDeselectHint'))};
analysisDeselectAll.onclick=analysisEditDeselectAll.onclick=()=>deselectAllAnalysisRegions();
analysisCutButton.onclick=async()=>{if(analysisCutApplying||analysisPendingCut||analysisEditPreparing)return;if(analysisEditTool==='pen'){setAnalysisEditTool('select');updateAnalysisEditorControls();return}setAnalysisEditPreparing(true);setAnalysisEditTool('pen');updateAnalysisEditorControls();try{if(threeRenderMode==='surface')await ensureEditRaycastReady(null,currentLanguage==='ja'?'3D編集データを準備中':'Preparing 3D edit data');setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);updateThreeEditUi(tr('editPenHint'))}catch(e){setAnalysisEditTool('select');console.error(e);footer.textContent='3D edit preparation error: '+String(e.message||e)}finally{setAnalysisEditPreparing(false);updateAnalysisEditorControls()}};
analysisLineCutButton.onclick=async()=>{if(analysisCutApplying||analysisPendingCut||analysisEditPreparing)return;if(analysisEditTool==='line'){setAnalysisEditTool('select');updateAnalysisEditorControls();return}setAnalysisEditPreparing(true);setAnalysisEditTool('line');updateAnalysisEditorControls();try{if(threeRenderMode==='surface')await ensureEditRaycastReady(null,currentLanguage==='ja'?'3D編集データを準備中':'Preparing 3D edit data');setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);updateThreeEditUi(tr('editLineHint'))}catch(e){setAnalysisEditTool('select');console.error(e);footer.textContent='3D edit preparation error: '+String(e.message||e)}finally{setAnalysisEditPreparing(false);updateAnalysisEditorControls()}};
analysisEditTargetSelect.onchange=()=>{if(analysisCutApplying)return;const next=analysisEditTargetSelect.value;setAnalysisEditTargetMode(next);if(analysisPendingCut){if(next==='auto')setAnalysisEditTargetKey(analysisPendingCut.key||null);else{setAnalysisEditTargetKey(next);analysisPendingCut.key=next}}else setAnalysisEditTargetKey(next==='auto'?null:next);updateAnalysisEditorControls();updateThreeEditUi();request3DRender()};
analysisEditRemoveSelected.onclick=()=>void applyEditRemoveSelected();
analysisRemoveSelected.onclick=()=>void applyEditRemoveSelected();
analysisKeepSelected.onclick=()=>void applyEditKeepSelected();
analysisUndo.onclick=()=>void undoSegmentEdit();
analysisRedo.onclick=()=>void redoSegmentEdit();
analysisResetEdit.onclick=()=>void resetFocusedSegmentEdit();
const onCutControlInput=()=>{
 refreshCutControlReadouts();updateThreeEditUi();
 if(cutControlPreviewRaf)cancelAnimationFrame(cutControlPreviewRaf);
 setCutControlPreviewRaf(requestAnimationFrame(()=>{
  setCutControlPreviewRaf(0);
  updateCutPreview(sceneState?.editCutPreviewPoint);
  if(analysisPendingCut&&threeRenderMode==='volume'&&sceneState?.medicalVolume?.active)scheduleCutResultPreview(0);
  request3DRender();
 }));
};
for(const control of [analysisCutWidth,analysisCutDepth,analysisCutYaw,analysisCutPitch,analysisCutOffset]){
 control.oninput=onCutControlInput;
 control.onchange=onCutControlInput;
 control.onpointermove=e=>{if(e.buttons||e.pointerType==='touch'||e.pointerType==='pen')onCutControlInput()};
}
analysisCutApply.onclick=async()=>{if(!analysisPendingCut||analysisCutApplying)return;const pending=analysisPendingCut;setAnalysisPendingCut(null);setAnalysisCutApplying(true);setAnalysisCutStroke(null);setAnalysisCutScreen([]);clearThreeEditOverlay();if(sceneState)sceneState.editCutPreviewPoint=null;updateCutPreview(null);updateAnalysisEditorControls();updateThreeEditUi(currentLanguage==='ja'?'切断を反映中…':'Applying cut…');let ok=false;setBusySlot('edit',true,{label:currentLanguage==='ja'?'切断を反映中…':'Applying cut…',counted:true});try{ok=await applyCutStroke(pending.points,pending.key,pending.mode)}finally{setBusySlot('edit',false,{counted:true});clearCutResultPreview();setAnalysisCutApplying(false);setAnalysisEditTool('select');setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);if(sceneState)sceneState.editCutPreviewPoint=null;updateAnalysisEditorControls();const ready=ok?(currentLanguage==='ja'?'切断を反映しました · 操作モードに戻りました':'Cut applied · returned to Navigate'):(currentLanguage==='ja'?'切断結果を確認してください · 操作モードに戻りました':'Check cut result · returned to Navigate');updateThreeEditUi(ready);request3DRender()}};
analysisCutCancel.onclick=()=>{if(analysisCutApplying)return;setAnalysisPendingCut(null);setAnalysisCutStroke(null);setAnalysisCutScreen([]);clearThreeEditOverlay();clearCutResultPreview();if(sceneState)sceneState.editCutPreviewPoint=null;updateCutPreview(null);setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);updateAnalysisEditorControls();returnToNavigate();updateThreeEditUi(currentLanguage==='ja'?'切断をキャンセルしました':'Cut cancelled');request3DRender()};
analysisExportSelected.onclick=()=>void exportFocusedAnalysisRegionStl();
renderModeToggle.onclick=async()=>{
 if(threeRenderMode==='volume'){
  deactivateMedicalVolume();
  if(!current3DVolume||threeDDirty||surfaceRebuildPending.value){surfaceEditsPending.clear();await rebuildCurrent3D()}
  // edits made in the volume view only reached the GPU volume: rebuild those segments' run surfaces (the old mesh stayed)
  else{const v=current3DVolume||volume,keys=[...surfaceEditsPending];surfaceEditsPending.clear();
   for(const key of keys)try{await refreshEditedSegmentSurface(key,v)}catch(e){if(String(e?.message||e)!=='__SUPERSEDED__')console.warn('Surface refresh after volume edits failed for '+key,e)}}
  if(sectionViewOpen&&sectionViewPlane){updateSectionClipPlaneWorld();rebindWebGpuSectionClipGroup();syncSectionClipParent();applySectionClippingMaterials(sceneState?.obj);request3DRender()}
 }else await activateMedicalVolume();
};
sectionViewToggle.onclick=()=>{if(!volume)return;setSectionViewOpen(!sectionViewOpen);if(!sectionViewOpen)clearSectionView();else{requestIPadSettingsTab('analysis');const p=currentPlane();setSectionView(p);selectPlane(p,'section')}};
document.querySelectorAll('[data-section-view]').forEach(button=>button.addEventListener('click',()=>{const k=button.dataset.sectionView;setSectionView(k);if(k!=='off')selectPlane(k,'section')}));
sectionReverse.onclick=()=>{if(!sectionViewPlane)return;setSectionViewReverse(!sectionViewReverse);if(threeRenderMode!=='volume'){updateSectionClipPlaneWorld();rebindWebGpuSectionClipGroup();syncSectionClipParent();applySectionClippingMaterials(sceneState?.obj)}updateSectionViewUi();request3DRender()};
sectionPosition.oninput=()=>{if(!sectionViewPlane)return;const p=sectionViewPlane,idx=Math.max(0,Math.min(+planes[p].slider.max,+sectionPosition.value));planes[p].slider.value=idx;planes[p].label.textContent=idx+1;updateMpr3DPlanePositions();if(threeRenderMode!=='volume'){updateSectionClipPlaneWorld();rebindWebGpuSectionClipGroup()}updateSectionViewUi();request3DRender();if(threeRenderMode!=='volume')renderSectionPlaneLive(p)};
sectionPosition.onchange=()=>{if(sectionViewPlane)renderSectionPlaneLive(sectionViewPlane,true)};
volumeAnalysisToggle.onclick=async()=>{
 if(!volume)return;
 if(volumeAnalysisMode){
  setVolumeAnalysisMode(false);
  volumeAnalysisToggle.disabled=false;
  volumeAnalysisToggle.textContent=tr('volumeMode');
  volumeAnalysisToggle.classList.remove('is-active');
  volumeAnalysisResult.classList.add('is-hidden');
  request3DRender();
  return;
 }
 volumeAnalysisToggle.disabled=true;
 try{
  if(threeRenderMode!=='volume')await ensureGpuResidentCpuPositions(null,currentLanguage==='ja'?'体積解析用データを取得中':'Preparing volume analysis');
  if(!volume)return;
  setVolumeAnalysisMode(true);
  scheduleAnalysisRunPrewarm();
  requestIPadSettingsTab('analysis');
  volumeAnalysisToggle.textContent=tr('volumeOff');
  volumeAnalysisToggle.classList.add('is-active');
  volumeAnalysisResult.classList.remove('is-hidden');
  renderAnalysisResults();
 }catch(e){
  console.error(e);footer.textContent=(currentLanguage==='ja'?'体積解析の準備に失敗しました: ':'Volume analysis preparation failed: ')+String(e.message||e);
 }finally{
  volumeAnalysisToggle.disabled=volumeAnalysisMode?false:!(threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active||!threeDDirty&&!!sceneState?.obj&&threeRenderMode==='surface');
 }
};
// practice dataset on this site (docs/demo/sample1)
// VR prototype (WebXR + WebGL2, own module; loaded on first use)
{const vrModule=()=>import('./vr-view.js?v=20261026-build670');const xrShow=(kind,btn)=>navigator.xr?.isSessionSupported?navigator.xr.isSessionSupported(kind).then(ok=>{if(ok)btn.hidden=false},()=>{}):Promise.resolve();Promise.all([xrShow('immersive-vr',vrViewBtn),xrShow('immersive-ar',arViewBtn)]).then(()=>{globalThis.__vrlXrChecked=true}); // true once both support checks have answered (whether the AR button exists is only known then: the tutorial's guidance waits for it)
// prepared data for the same series / filter / segments / edits is
// reused and the session starts at once; otherwise a page panel prepares it
// with progress and ends with a start button (a session needs a click)
const xrFb=createXrFeedback({buttons:[vrViewBtn,arViewBtn],footer,tr});
const xrFail=e=>{xrFb.clear();console.error(e);footer.textContent=tr('vrFailed')+': '+String(e.message||e)};
// feedback from the press (button busy + a line of text on the page) until the headset shows the view. The busy state is synchronous
// and adds no await before the session request (go still runs inside the start click, as before)
const xrStart=mode=>async()=>{if(xrFb.step)return;const button=mode==='ar'?arViewBtn:vrViewBtn;xrFb.set('loading',{button,mode});
 try{const m=await vrModule(),go=async()=>{xrFb.set('starting',{button,mode});let inSession=false;
   try{await m.startVrView({language:currentLanguage,mode,onStep:s=>{if(s==='in-session'){inSession=true;xrFb.set('running',{button,mode})}else if(s==='ended')xrFb.clear()}})}
   catch(e){xrFail(e);return}
   if(!inSession)xrFb.clear()};
  if(m.vrReady())await go();else{xrFb.set('prepare',{button,mode});m.showPreparePanel({language:currentLanguage,mode,onStart:go,onStep:s=>{if(s.step==='prepare')xrFb.set('prepare',{button,mode,text:s.text});else xrFb.clear()}})}}catch(e){xrFail(e)}};vrViewBtn.onclick=xrStart('vr');arViewBtn.onclick=xrStart('ar');}
// a project shipped next to the practice data (demo/sample1/project.vrlab) is
// applied when the sample opens, through the usual pending-project path (fingerprint
// checked in applyPendingProject). Not kept in the sample Cache Storage: always
// revalidated so the developer can update it; a missing file is silent.
// the project of the practice data open now (kept after it was applied): the VR 「最初の状態に戻す」 button puts its points / distances / labels back (data-load.js restoreProjectAnnotations)
const sampleProjectNow={value:null};
// 体験会モード: the practice dataset open now (null = none, or other data opened afterwards). The データ panel's 「最初の状態に戻す」 (event-mode-ui.js) replays it through startSample, the
// one route the level cards and the chooser use (nothing new is loaded from anywhere else); 'vrl-event-sample-open' tells the panel whether the button has something to reset.
const openSample={id:null};
// the tutorial's captions name the first tissue of the open data (its row in the VR menu): tutorial-ui.js (2D card) reads it from here
globalThis.__vrlTissueName=lang=>{const k=SEGMENT_PRESET_ORDER.find(k=>segmentState[k]?.active&&segmentState[k]?.enabled);return k?(lang==='en'?I18N.en?.[k]||tr(k):tr(k)):''}; // lang 'en' = the English name (the 2D card's English line)
function setOpenSample(id){openSample.id=id;globalThis.__vrlOpenSample=id;globalThis.__vrlVolumeReady=false;try{document.dispatchEvent(new CustomEvent('vrl-event-sample-open',{detail:{id}}))}catch{}}
async function loadSampleProject(setId){
 if(pendingProject.value)return null; // a project the user opened for other data stays pending
 let res=null;try{res=await fetch(sampleProjectUrl(setId),{credentials:'omit',cache:'no-cache'})}catch{return null}
 if(!res.ok)return null;
 try{return sampleProjectNow.value=pendingProject.value=unpackProject(new Uint8Array(await res.arrayBuffer()))}catch(e){console.warn('Sample project ignored:',e);return null}
}
{let pending=false;document.addEventListener('vrl-gpu-edits-synced',()=>{if(pending)return;pending=true;setTimeout(async()=>{pending=false;
 const v=current3DVolume||volume;if(!v)return;let changed=false;
 for(const key of SEGMENT_PRESET_ORDER){if(!segmentState[key]?.active||!segmentEditActive(key)||segmentEditState[key].finalRuns)continue;
  try{await getFinalSegmentRuns(key,v);changed=true}catch(e){if(String(e?.message||e)!=='__SUPERSEDED__')console.warn('2D edit refresh failed for '+key,e)}}
 if(changed)renderAll();},0)})}
window.addEventListener('vrl-settings',e=>{if(e.detail?.key==='mpr2dAlpha'&&volume)renderAll()});
document.addEventListener('vrl-filters-changed',async()=>{
 const v=current3DVolume||volume;if(!v)return;
 const keys=SEGMENT_PRESET_ORDER.filter(k=>segmentState[k]?.active&&segmentState[k]?.enabled&&segmentNeedsVoxelMask(k));
 const sig=currentFilterSignature();if(analysisRegions.length&&sig!==memState.analysisFilterSignature)clearAnalysisHighlight();memState.setAnalysisFilterSignature(sig);if(!keys.length)return;
 for(const key of keys){
  try{await refreshSegmentVoxels(key,v)}
  catch(e){if(String(e?.message||e)!=='__SUPERSEDED__')console.warn('Segment update after the filter change failed for '+key,e)}
 }
 renderAll();
});
const startSample=async setId=>{if(freshForEventSelection())pendingProject.value=null;sampleProjectNow.value=null;setOpenSample(setId);busy(true);resetVolume();list.replaceChildren();state.classList.remove('is-hidden');prog.classList.remove('is-hidden');state.innerHTML='<strong>'+tr('sampleLoading')+'</strong>';try{const files=await loadSampleDemo(setId),bundled=await loadSampleProject(setId);await inspect(files,true);if(bundled&&pendingProject.value===bundled){pendingProject.value=null;console.warn('Sample project ignored: it does not match the practice data')}}catch(e){console.error(e);state.innerHTML='<strong>'+tr('demoFailed')+'</strong><span>'+esc(e.message||e)+'</span>';footer.textContent='Demo error: '+String(e.message||e)}finally{busy(false);prog.classList.add('is-hidden')}};
const samplePicker=()=>document.getElementById('ws-sample-picker');
const setSamplePicker=open=>{const pk=samplePicker();if(!pk)return;pk.classList.toggle('is-open',open);pk.inert=!open;sampleDemoBtn.setAttribute('aria-expanded',String(open));sampleDemoBtn.classList.toggle('is-active',open);if(open)pk.querySelector('.sample-choice')?.focus({preventScroll:true})};
sampleDemoBtn.onclick=()=>{const pk=samplePicker();if(pk){setSamplePicker(!pk.classList.contains('is-open'));return}sampleDialog.showModal?sampleDialog.showModal():sampleDialog.setAttribute('open','')};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&samplePicker()?.classList.contains('is-open'))setSamplePicker(false)});
sampleDialogClose.onclick=()=>sampleDialog.close?sampleDialog.close():sampleDialog.removeAttribute('open');
sampleDialog.addEventListener('click',e=>{if(e.target===sampleDialog)sampleDialog.close?.()});
for(const b of sampleChoiceButtons)b.onclick=()=>{const id=b.dataset.sampleSet;setSamplePicker(false);if(sampleDialog.open){if(sampleDialog.close)sampleDialog.close();else sampleDialog.removeAttribute('open')}void startSample(id)};
// 体験会モード - a level card (event-mode-ui.js) opens its practice dataset through the same startSample as the chooser; done lets the card wait for it
document.addEventListener('vrl-event-sample',e=>{const id=e.detail?.sampleSet;if(typeof id==='string'&&/^sample\d+$/.test(id))e.detail.done=startSample(id)});
// 体験会モード: the VR menu's 「最初の状態に戻す」 (vr-view.js): the open practice data's points / distances / pinned labels go back to its project file, in place (event mode only); detail.done = true when it ran
// 体験会モード, the データ panel's 「最初の状態に戻す」: the open practice dataset is opened again from its project file (startSample = the same fresh start as choosing it again: every state of the page, the points /
// distances, the VR view settings, ... back to the project's); detail.done = its promise, or stays null when no practice data is open / the mode is off
document.addEventListener('vrl-event-reset-request',e=>{if(eventModeOn()&&e.detail&&openSample.id)e.detail.done=startSample(openSample.id)});
document.addEventListener('vrl-event-project-reset',e=>{if(eventModeOn()&&e.detail)e.detail.done=restoreProjectAnnotations(sampleProjectNow.value)});
wc.oninput=ww.oninput=()=>{renderMainMprPreview();if(threeRenderMode==='volume')request3DRender()};
wc.onchange=ww.onchange=()=>renderAll();
// auto range: a slider is no longer re-centred after every release (it jumped to mid-track); it is re-centred only when
// its value reaches the current track edge, so values beyond the window stay reachable
function recenterCtSliderAtEdge(...els){
 if(ctRangeMode!=='auto')return;
 if(els.some(el=>el&&(+el.value<=+el.min||+el.value>=+el.max)))applyCtRangeMode('auto');
}
ctRangeAuto.onclick=()=>applyCtRangeMode('auto');
ctRangeFull.onclick=()=>applyCtRangeMode('full');
// segment cards collapse to their header row (name, visibility, colour); collapsed by
// default, the choice is remembered per device
for(const btn of document.querySelectorAll('[data-seg-collapse]')){
 const key=btn.dataset.segCollapse,card=btn.closest('.segment-card'),storeKey='vrl.segCollapsed.'+key;
 const apply=collapsed=>{card?.classList.toggle('is-collapsed',collapsed);btn.setAttribute('aria-expanded',String(!collapsed))};
 // collapsed by default; only an explicit "open" is remembered as open
 let open=false;try{open=localStorage.getItem(storeKey)==='0'}catch{}apply(!open);
 btn.onclick=()=>{const collapsed=!card?.classList.contains('is-collapsed');apply(collapsed);try{localStorage.setItem(storeKey,collapsed?'1':'0')}catch{}};
}
// per-segment invalidation, used when the card priority changes several segments' ranges at once
const segmentInvalidators={};
// invalidate(keys, dependents): the dependents are segments below that follow a higher segment's voxels; only
// their own analysis results are dropped, the other results stay
segmentExclusive.invalidate=(keys,dependents=[])=>{for(const k of keys)segmentInvalidators[k]?.(true);for(const k of dependents)segmentInvalidators[k]?.(true,true);for(const k of SEGMENT_PRESET_ORDER)updateSegmentOutputs(k)};
function clearAnalysisResultsFor(key){for(const r of [...analysisRegions])if(r.segmentKeys?.includes(key))removeAnalysisRegion(r.id)}
installSegmentReorder(()=>{renderSegmentPresets();commitExclusiveRanges();for(const k of SEGMENT_PRESET_ORDER)updateSegmentOutputs(k);renderAll();scheduleSegment3D()});
installSegmentHistogram();installLineProfile();installCropExport();
{const sel=document.getElementById('segment-exclusive-mode');if(sel)sel.onchange=()=>{segmentExclusive.mode=sel.value==='off'?'off':'priority';commitExclusiveRanges();for(const k of SEGMENT_PRESET_ORDER)updateSegmentOutputs(k);renderAll();scheduleSegment3D()}}
for(const key of Object.keys(segmentState)){
 const enabled=$('[data-seg-enabled="'+key+'"]'),color=$('[data-seg-color="'+key+'"]'),min=$('[data-seg-min="'+key+'"]'),max=$('[data-seg-max="'+key+'"]'),opacity=$('[data-seg-opacity="'+key+'"]'),exportBtn=$('[data-seg-export="'+key+'"]'),removeBtn=$('[data-seg-remove="'+key+'"]'),opening=$('[data-seg-opening="'+key+'"]'),closing=$('[data-seg-closing="'+key+'"]'),minComponent=$('[data-seg-min-component="'+key+'"]'),holeFill=$('[data-seg-hole-fill="'+key+'"]');
 enabled.onchange=()=>{if(enabled.checked&&refuseSegmentEnable(key)){enabled.checked=false;return}setSegmentEnabled(key,enabled.checked);renderAll();
  // the analysis regions of this segment follow its checkbox (analysisRegionShown): the next 3D frame applies it, the list greys their button
  renderAnalysisResults();request3DRender();
  if(threeRenderMode!=='volume'&&!threeDDirty&&!threeDApplying&&segmentHasSurface(key)&&(!enabled.checked||!segmentNeedsVoxelMask(key)||segmentEditState[key].baseRuns)){setSegmentSurfaceShown(key,enabled.checked);return}
  scheduleSegment3D();
  if(enabled.checked&&segmentNeedsVoxelMask(key)){const v=current3DVolume||volume;if(v)void refreshSegmentVoxels(key,v).catch(e=>{if(String(e?.message||e)!=='__SUPERSEDED__')console.warn('Segment update on show failed for '+key,e)})}}; // at most 4 enabled (segment-slots.js)
 color.oninput=()=>{segmentState[key].color=color.value;renderMainMprPreview();scheduleSegment3D()};
 color.onchange=()=>renderAll();
 // the sliders set the user range; the range in use (seg.min / max) follows the card priority, so a move can
 // change other segments too: every changed one is previewed now and invalidated on release
 const rangeInput=()=>{const s=segmentState[key];s._maskCache=null;clearSegmentEditCache(key,false);for(const k of applyExclusiveRanges()){segmentState[k]._maskCache=null;clearSegmentEditCache(k,false);updateSegmentOutputs(k)}updateSegmentOutputs(key);renderMainMprPreview();scheduleSegment3D()};
 min.oninput=()=>{const s=segmentState[key];s.userMin=Math.min(+min.value,s.userMax??s.max);min.value=s.userMin;rangeInput()};
 max.oninput=()=>{const s=segmentState[key];s.userMax=Math.max(+max.value,s.userMin??s.min);max.value=s.userMax;rangeInput()};
 min.onchange=max.onchange=()=>{recenterCtSliderAtEdge(min,max);commitExclusiveRanges(key)};
 // opacity is a render setting: in the GPU volume view only redraw 3D while the
 // slider moves (the 2D planes, hidden there, were repainted on every tick);
 // the 2D view repaints on release (onchange)
 opacity.oninput=()=>{segmentState[key].opacity=+opacity.value;updateSegmentOutputs(key);
  if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){request3DRender();reportDrawTimes();return}
  const t2=performance.now();renderMainMprPreview();reportDrawTimes(performance.now()-t2);scheduleSegment3D()};
 opacity.onchange=()=>renderAll();
 // the material preset (lighting.js MATERIALS) is a render setting only: the volume (desktop / VR) reads it every frame, the segment's meshes share one uniform
 const material=$('[data-seg-material="'+key+'"]');
 if(material)material.onchange=()=>{const k=materialKey(material.value);material.value=k;segmentState[key].material=k;setSegmentMeshMaterial(key,k);request3DRender()};
 const invalidateSegment=(full=false,dependent=false)=>{segmentState[key]._maskCache=null;segmentState[key]._maskCacheKey='';clearSegmentEditCache(key,false);if(dependent)clearAnalysisResultsFor(key);else clearAnalysisHighlight();if(full)renderAll();else renderMainMprPreview();scheduleSegment3D();if(full&&threeRenderMode==='volume')syncGpuVolumeEdits(sourceVolume||volume);if(full&&(volume?.sourceBacked||threeRenderMode==='volume')&&segmentHasProcessedMask(key))void prepareSourceSegmentPostprocess(key);
  // an edited plain segment draws its edits in 2D from finalRuns: rebuild them for the new settings
  else if(full&&segmentNeedsVoxelMask(key))void getFinalSegmentRuns(key,current3DVolume||volume).then(()=>renderAll(),e=>{if(String(e?.message||e)!=='__SUPERSEDED__')console.warn(e)})};
 segmentInvalidators[key]=invalidateSegment;
 // a processing setting changes what the segment holds (and whether it is a voxel taker), so the segments
 // below follow: commit recomputes the exclusion and invalidates this segment and the ones that depend on it
 const processingInput=()=>{invalidateSegment(false);for(const k of applyExclusiveRanges()){segmentState[k]._maskCache=null;clearSegmentEditCache(k,false);updateSegmentOutputs(k)}};
 opening.oninput=()=>{segmentState[key].opening=+opening.value;$('[data-seg-opening-out="'+key+'"]').value=opening.value;processingInput()};
 opening.onchange=()=>commitExclusiveRanges(key);
 closing.oninput=()=>{segmentState[key].closing=+closing.value;$('[data-seg-closing-out="'+key+'"]').value=closing.value;processingInput()};
 closing.onchange=()=>commitExclusiveRanges(key);
 minComponent.oninput=()=>{segmentState[key].minComponent=+minComponent.value;$('[data-seg-min-component-out="'+key+'"]').value=minComponent.value;processingInput()};
 minComponent.onchange=()=>commitExclusiveRanges(key);
 holeFill.onchange=()=>{segmentState[key].holeFill=holeFill.checked;commitExclusiveRanges(key)};
 // thin-region sliders: whole-volume distance fields, so recompute on release only
 for(const [attr,field] of THIN_SLIDERS){
  const el=$('[data-seg-'+attr+'="'+key+'"]'),out=$('[data-seg-'+attr+'-out="'+key+'"]');if(!el)continue;
  el.oninput=()=>{out.value=formatMmVoxels(thinSliderValue(el))};
  el.onchange=()=>{const mm=thinSliderValue(el);if(mm===segmentState[key][field])return;segmentState[key][field]=mm;out.value=formatMmVoxels(mm);if(!segmentNeedsGlobalMask(segmentState[key]))setSegmentStatus(key,'');commitExclusiveRanges(key)};
 }
 // STL export in the progress modal
 exportBtn.onclick=async()=>{setBusySlot('export',true,{label:currentLanguage==='ja'?'STL を書き出し中…':'Exporting STL…',counted:true});try{await exportSegmentStl(key)}finally{setBusySlot('export',false,{counted:true})}};
 removeBtn.onclick=()=>removeSegmentPreset(key);
}
// the processed / edited voxels of one segment, recomputed when stale (cheap when still valid) and pushed to 3D
async function refreshSegmentVoxels(key,v=current3DVolume||volume){
 if(segmentHasProcessedMask(key)&&(v.sourceBacked||threeRenderMode==='volume'))await prepareSourceSegmentPostprocess(key);else{await getFinalSegmentRuns(key,v);if(threeRenderMode==='volume')syncGpuVolumeEdits(sourceVolume||volume)}
}
async function prepareSourceSegmentPostprocess(key){
 const v=current3DVolume||volume;if(!(v?.sourceBacked||threeRenderMode==='volume')||!segmentState[key]?.active||!segmentState[key]?.enabled||!segmentHasProcessedMask(key))return;
 try{
  await ensureSegmentBaseRuns(key,v);
  // with edits, the 2D views draw finalRuns (base ∩ keep − exclude); rebuild it from the new base, in every view
  if(segmentEditActive(key))await getFinalSegmentRuns(key,v);
  // the GPU volume may be active even while the 2D view is shown; always resync
  if(sceneState?.medicalVolume?.active||threeRenderMode==='volume')syncGpuVolumeEdits(sourceVolume||volume);
  // no mesh while working in the volume view (meshes are built only for STL
  // export); a run surface built here stayed on screen as streaks
  if(sceneState?.obj&&threeRenderMode!=='volume')await refreshEditedSegmentSurface(key,v);
  renderAll();footer.textContent=currentLanguage==='ja'?(tr(key)||key)+'のセグメント処理を更新しました':'Updated segment processing for '+(tr(key)||key);
 }catch(e){if(String(e.message||e)!=='__SUPERSEDED__'){console.error(e);footer.textContent='Segment processing error: '+String(e.message||e)}}
}
function markSmoothingSettingsChanged(){
 clearTimeout(smoothingRefreshTimer);setSmoothingRefreshTimer(null);
 mark3DStale();
}
surfaceSmoothEnabled.onchange=()=>{
 surfaceSmoothStrength.disabled=!surfaceSmoothEnabled.checked||!volume;
 saveDeviceSmoothing();
 markSmoothingSettingsChanged();
};
surfaceSmoothStrength.oninput=()=>{
 surfaceSmoothValue.value=(+surfaceSmoothStrength.value).toFixed(2);
 saveDeviceSmoothing();
 markSmoothingSettingsChanged();
};
surfaceSmoothStrength.onchange=()=>{
 surfaceSmoothValue.value=(+surfaceSmoothStrength.value).toFixed(2);
 saveDeviceSmoothing();
 markSmoothingSettingsChanged();
};
applyDeviceSmoothing();
smoothingType.onchange=()=>{if(filterState.gaussian)scheduleFilterRebuild(0)};
for(const [input,output,key] of [[spikeHoleStrength,spikeHoleStrengthValue,'spikeHole'],[anisotropicStrength,anisotropicStrengthValue,'anisotropic'],[gaussianStrength,gaussianStrengthValue,'gaussian'],[sigmoidStrength,sigmoidStrengthValue,'sigmoid']]){
 input.oninput=()=>{output.value=(+input.value).toFixed(2);if(filterState[key])scheduleFilterRebuild(360)};
 input.onchange=()=>{if(filterState[key])scheduleFilterRebuild(0)};
}
sigmoidCenter.oninput=()=>{sigmoidCenterValue.value=Math.round(+sigmoidCenter.value);if(filterState.sigmoid)scheduleFilterRebuild(360)};
sigmoidWidth.oninput=()=>{sigmoidWidthValue.value=Math.round(+sigmoidWidth.value);if(filterState.sigmoid)scheduleFilterRebuild(360)};
sigmoidWidth.onchange=()=>{if(filterState.sigmoid)scheduleFilterRebuild(0)};
sigmoidCenter.onchange=()=>{recenterCtSliderAtEdge(sigmoidCenter);if(filterState.sigmoid)scheduleFilterRebuild(0)};
anisotropicIterations.oninput=()=>{anisotropicIterationsValue.value=Math.round(+anisotropicIterations.value);if(filterState.anisotropic)scheduleFilterRebuild(360)};
anisotropicIterations.onchange=()=>{if(filterState.anisotropic)scheduleFilterRebuild(0)};
spatialPasses.oninput=()=>{spatialPassesValue.value=Math.round(+spatialPasses.value);if(filterState.gaussian)scheduleFilterRebuild(360)};
spatialPasses.onchange=()=>{if(filterState.gaussian)scheduleFilterRebuild(0)};
nlmSearchRadius.oninput=()=>{nlmSearchRadiusValue.value=Math.round(+nlmSearchRadius.value);if(filterState.nlm)scheduleFilterRebuild(380)};
nlmSearchRadius.onchange=()=>{if(filterState.nlm)scheduleFilterRebuild(0)};
nlmPatchRadius.oninput=()=>{nlmPatchRadiusValue.value=Math.round(+nlmPatchRadius.value);if(filterState.nlm)scheduleFilterRebuild(380)};
nlmPatchRadius.onchange=()=>{if(filterState.nlm)scheduleFilterRebuild(0)};

for(const [input,output,key,digits] of [
 [bilateralStrength,bilateralStrengthValue,'bilateral',2],[bilateralSpatial,bilateralSpatialValue,'bilateral',2],
 [tvWeight,tvWeightValue,'tv',2],[unsharpAmount,unsharpAmountValue,'unsharp',2]
]){
 input.oninput=()=>{output.value=(+input.value).toFixed(digits);if(filterState[key])scheduleFilterRebuild(380)};
 input.onchange=()=>{if(filterState[key])scheduleFilterRebuild(0)};
}
// 447: HU-based filter parameters (integer-ish steps; a widened old-project value goes back to the normal range on the first input)
for(const [input,output,key] of [[spikeHoleThreshold,spikeHoleThresholdValue,'spikeHole'],[nlmStrength,nlmStrengthValue,'nlm'],[anisotropicKappa,anisotropicKappaValue,'anisotropic'],[unsharpThreshold,unsharpThresholdValue,'unsharp'],[bilateralIntensity,bilateralIntensityValue,'bilateral']]){
 input.oninput=()=>{if(!input.dataset.loading)restoreFilterUnitRange(input);output.value=formatHU(input.value);if(filterState[key])scheduleFilterRebuild(380)};
 input.onchange=()=>{if(filterState[key])scheduleFilterRebuild(0)};
}
for(const [input,output,key] of [[bilateralPasses,bilateralPassesValue,'bilateral'],[tvIterations,tvIterationsValue,'tv'],[unsharpRadius,unsharpRadiusValue,'unsharp']]){
 input.oninput=()=>{output.value=Math.round(+input.value);if(filterState[key])scheduleFilterRebuild(380)};
 input.onchange=()=>{if(filterState[key])scheduleFilterRebuild(0)};
}
resetFilterBtn.onclick=()=>{resetFilterUnitControls();filterState.spikeHole=filterState.nlm=filterState.anisotropic=filterState.gaussian=filterState.sigmoid=filterState.bilateral=filterState.tv=filterState.unsharp=false;smoothingType.value='gaussian';setFilterOrder([]);for(const box of [spikeHoleBtn,nlmBtn,anisotropicBtn,gaussianBtn,sigmoidBtn,bilateralBtn,tvBtn,unsharpBtn])box.checked=false;renderFilterOrder();syncFilterControls();resetProcessing()};
filterRebuild3D.onclick=()=>{if(threeDApplying)cancel3DRebuild();else void rebuildCurrent3D()};
threeBusyCancel.onclick=()=>cancel3DRebuild();
installFilterReorder();

mpr3DSlicePanelReady.value=true;
$('#mpr3d-opacity')?.addEventListener('input',e=>{const src=mpr3DOpacitySource();if(!src)return;src.value=e.target.value;src.dispatchEvent(new Event('input'));syncMpr3DSliceSliders()});
for(const[p,el]of Object.entries(mpr3DSliceSliders)){
 if(!el)continue;
 const toReal=()=>String(+planes[p].slider.max-(+el.value)); // reversed direction
 el.addEventListener('input',()=>{planes[p].slider.value=toReal();planes[p].slider.dispatchEvent(new Event('input'))});
 el.addEventListener('change',()=>{planes[p].slider.value=toReal();planes[p].slider.dispatchEvent(new Event('change'))});
}
for(const p of Object.keys(planes)){planes[p].slider.oninput=()=>schedulePlaneRender(p);planes[p].slider.onchange=()=>{if(p==='coronal'||p==='sagittal')mpr3DOrthoSliding[p]=false;schedulePlaneRender(p,true)};installMprTouch(p)}

async function inspect(files,auto){
 setActiveId(null);resetVolume();list.replaceChildren();state.classList.remove('is-hidden');state.innerHTML='<strong>'+tr('dicomChecking')+'</strong><span>'+tr('pixelDeferred')+'</span>';prog.classList.remove('is-hidden');busy(true);loadPhase('DICOMを確認中','checking DICOM');
 try{const slices=await parseFiles(files,(a,b)=>progress(a,b));const series=groupSeries(slices);if(!series.length){state.innerHTML='<strong>'+tr('noSeries')+'</strong>';return}state.classList.add('is-hidden');renderSeries(series);if(auto){const ct=series.find(s=>s.modality.toUpperCase()==='CT')||series[0];await selectSeries(ct)}}finally{busy(false);prog.classList.add('is-hidden')}
}



function renderSeries(series){detectedSeries.list=series;list.replaceChildren();for(const s of series){const b=document.createElement('button');b.className='series-card';b.innerHTML='<div class="series-card-header"><div><span class="modality-badge">'+esc(s.modality)+'</span><strong>'+esc(s.description)+'</strong>'+(s.spacingCheck?.warn?'<span class="spacing-mark" title="'+esc(spacingWarningText(s.spacingCheck)?.[currentLanguage==='ja'?'ja':'en']||'')+'" aria-label="スライス間隔に不整合 / slice spacing issue"> ⚠</span>':'')+'</div><strong class="memory-estimate">'+fmt(s.bytes)+'</strong></div><dl class="series-meta-grid"><div><dt>Slices</dt><dd>'+s.slices.length+'</dd></div><div><dt>Matrix</dt><dd>'+s.columns+' × '+s.rows+'</dd></div><div><dt>Voxel</dt><dd>'+s.spacingX.toFixed(4)+' × '+s.spacingY.toFixed(4)+' × '+s.spacingZ.toFixed(4)+' mm</dd></div><div><dt>Stored</dt><dd>'+s.bits+'-bit</dd></div></dl><p class="series-note">推定展開サイズ: '+fmt(s.decodedBytes)+' · '+(s.sourceBacked?'フル解像度・ストリーミング':(s.compact?'Int16':'Float32'))+'</p>';b.onclick=()=>selectSeries(s);b.dataset.id=s.id;list.appendChild(b)}}



initIPadWorkspaceUi();installAnalysisDock();installPaneResize();
initIPadGpuQualityControl();initSettingsDialog();initThemeUi();initEventModeUi();initTutorialUi({resetUserState});


/* Full-resolution source-backed filters: exact local processing in bounded tiles. */

function clearMpr3DPreviewCache(){
 mpr3DPreviewCache.token++;mpr3DPreviewCache.signature='';mpr3DPreviewCache.buildingSignature='';mpr3DPreviewCache.building=false;mpr3DPreviewCache.planes={axial:null,coronal:null,sagittal:null};mpr3DPreviewCache.dims={axial:null,coronal:null,sagittal:null};
}
function clearSourceSliceCache(){cancelSourceMprWarmup();sourceSliceCache.map.clear();sourceSliceCache.bytes=0;sourceOrthogonalPlaneCache.clear();sourceOrthogonalPlanePending.clear();setSourceOrthogonalPlaneCacheBytes(0);clearMpr3DPreviewCache()}

// CPU filter stack (fallback when WebGPU compute is not used): read the
// slider parameters, run the kernel from cpu-filters.js, then show the result.
function resetProcessing(){
 clearTimeout(liveFilterState.timer);clearTimeout(filterRebuildTimer);incFilterRebuildRevision(false);setMemoryGpuPreviewActive(false);clearMemoryFilterPreviewCache();if(sourceVolume?.sourceBacked)invalidateSourceFilters();liveFilterState.base=null;liveFilterState.key=null;
 filterState.spikeHole=filterState.nlm=filterState.anisotropic=filterState.gaussian=filterState.sigmoid=filterState.bilateral=filterState.tv=filterState.unsharp=false;syncFilterControls();
 if(!sourceVolume)return;setVolume(sourceVolume);renderAll();mark3DStale();footer.textContent=tr('processingReset');
}

function renderMainMprPreview(){
 if(!volume)return;
 const key=currentMainViewKey(),p=planes[key]?key:'axial';
 schedulePlaneRender(p);
}


const mprWheelFinalizeTimers={axial:null,coronal:null,sagittal:null};
function installMprTouch(p){const c=planes[p];let id=null,startX=0,startY=0,start=0,moved=false;c.canvas.onpointerdown=e=>{if(!volume||c.slider.disabled)return;if(cropPointerDown(p,e)||lineProfilePointerDown(p,e)||crosshairPointerDown(p,e))return;id=e.pointerId;startX=e.clientX;startY=e.clientY;start=+c.slider.value;moved=false;c.canvas.setPointerCapture(id)};c.canvas.onpointermove=e=>{if(cropPointerMove(p,e)||lineProfilePointerMove(p,e)||crosshairPointerMove(p,e))return;if(id!==e.pointerId)return;const dx=e.clientX-startX,dy=e.clientY-startY;if(Math.hypot(dx,dy)>5)moved=true;if(volumeAnalysisMode&&!moved)return;const max=+c.slider.max,sens=Math.max(1,c.canvas.clientWidth/(max+1)),next=Math.round(start+dx/sens);c.slider.value=Math.max(0,Math.min(max,next));schedulePlaneRender(p)};const end=e=>{if(cropPointerEnd(p,e)||lineProfilePointerEnd(p,e)||crosshairPointerEnd(p,e))return;if(id!==e.pointerId)return;const wasClick=!moved&&e.type==='pointerup';if(c.canvas.hasPointerCapture(id))c.canvas.releasePointerCapture(id);id=null;if(moved)schedulePlaneRender(p,true);if(wasClick&&selectAnalysisRegionFromMpr(p,e))e.preventDefault()};c.canvas.onpointerup=end;c.canvas.onpointercancel=end;c.canvas.addEventListener('wheel',e=>{if(!volume||c.slider.disabled)return;e.preventDefault();const max=+c.slider.max,delta=e.deltaY===0?e.deltaX:e.deltaY,step=delta>0?1:-1;c.slider.value=Math.max(0,Math.min(max,+c.slider.value+step));schedulePlaneRender(p,false);clearTimeout(mprWheelFinalizeTimers[p]);mprWheelFinalizeTimers[p]=setTimeout(()=>schedulePlaneRender(p,true),48)},{passive:false})}

function setMpr3DInteractive(active){
 if(!sceneState)return;sceneState.mprInteractionActive=!!active;
 if(sceneState.mprPlaneGroup)sceneState.mprPlaneGroup.visible=!!sceneState.obj;
 request3DRender();
}
function installMpr3DOverlayControls(){
 document.querySelectorAll('[data-3d-overlay]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset['3dOverlay'];const on=!mpr3DVisibility[key];setMpr3DOverlayVisible(key,on);if(on&&key!=='axes')selectPlane(key,'overlay')}));
}
installMpr3DOverlayControls();


function swapViewCards(a,b){
 if(!a||!b||a===b)return;
 const placeholder=document.createComment('view-swap'),aParent=a.parentNode;
 aParent.replaceChild(placeholder,a);b.parentNode.replaceChild(a,b);placeholder.replaceWith(b);
 requestAnimationFrame(()=>{sceneState?.resize?.();request3DRender()});
 // a 2D plane brought to the main view is the selected plane
 const mainKey=mainViewSlot?.querySelector('.view-card')?.dataset.viewKey;if(mainKey&&mainKey!=='3d')selectPlane(mainKey,'main');
}
function moveViewToMain(key){
 const card=document.querySelector('.view-card[data-view-key="'+key+'"]'),mainCard=mainViewSlot?.querySelector('.view-card');
 if(card&&mainCard&&card!==mainCard)swapViewCards(card,mainCard);
}
function installViewSwapping(){
 document.querySelectorAll('[data-view-main]').forEach(button=>button.addEventListener('click',()=>moveViewToMain(button.dataset.viewMain)));
 let dragCard=null,targetCard=null,pointerId=null;
 const clearTarget=()=>{targetCard?.classList.remove('is-view-drop-target');targetCard=null};
 for(const handle of document.querySelectorAll('[data-view-drag-handle]')){
  handle.addEventListener('pointerdown',e=>{
   dragCard=handle.closest('.view-card');pointerId=e.pointerId;if(!dragCard)return;
   handle.setPointerCapture?.(pointerId);dragCard.classList.add('is-view-dragging');e.preventDefault();
  });
  handle.addEventListener('pointermove',e=>{
   if(!dragCard||e.pointerId!==pointerId)return;clearTarget();
   const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('.view-card');
   if(hit&&hit!==dragCard){targetCard=hit;targetCard.classList.add('is-view-drop-target')}
  });
  const end=e=>{
   if(!dragCard||e.pointerId!==pointerId)return;
   const from=dragCard,to=targetCard;clearTarget();from.classList.remove('is-view-dragging');dragCard=null;pointerId=null;
   if(to)swapViewCards(from,to);
  };
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
 }
}
installViewSwapping();
async function start3D(){
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x090c0e);const camera=new THREE.PerspectiveCamera(38,1,.005,100);camera.position.z=5.2;scene.add(camera);
 const {axisWidget,updateAxisWidget}=makeAxisWidget(camera);

 let {renderer,backend}=await create3DRenderer();
 setMeshMaterialBackend(backend);
 threeLabel.textContent=backend;
 viewport.appendChild(renderer.domElement);
 installComment3d(viewport);installHuLine3d(viewport);installCrop3d(viewport);
 const sectionClipPlane=new THREE.Plane(new THREE.Vector3(1,0,0),0),sectionClipGroup=backend==='WEBGPU'&&THREE.ClippingGroup?new THREE.ClippingGroup():null;
 if(sectionClipGroup){sectionClipGroup.name='section_clip_group';sectionClipGroup.enabled=false;scene.add(sectionClipGroup)}
 setSceneState({scene,camera,renderer,obj:null,analysisMesh:null,backend,needsRender:true,medicalVolume:null,mprPlaneGroup:null,mprPlaneEntries:null,mprPlaneSignature:'',mprInteractionActive:false,editCutPreview:null,editCutPreviewPoint:null,cutResultPreviewGroup:null,cutResultPreviewKey:null,axisWidget,sectionClipPlane,sectionClipGroup});
 if(backend==='WEBGPU')try{sceneState.medicalVolume=new MedicalVolumeRenderer({device:renderer.backend.device,host:viewport,rendererCanvas:renderer.domElement,onProgress:(a,b)=>set3DBusy(true,(currentLanguage==='ja'?'GPUボリューム準備中… ':'Preparing GPU volume… ')+a+' / '+b),onStatus:label=>setGpuComputeBackend(label),onRedraw:request3DRender})}catch(e){console.warn('Medical volume renderer unavailable.',e)}
 if(sceneState.medicalVolume)void updateVolumeCacheControl();
 updateGpuStatus();updateRenderModeControl();void ensureGpuFilterDevice().then(()=>updateGpuStatus());
 const pointers=new Map();const pointerStarts=new Map();const MIN_3D_DISTANCE=.05,MAX_3D_DISTANCE=12;let distance=5.2,lastPinch=0,lastCenter=null,lastTwist=null;
 document.addEventListener(EVENT_FRESH_EVENT,()=>{distance=5.2;camera.position.z=distance;request3DRender()});
 document.addEventListener(EVENT_FRESH_EVENT,()=>{setMpr3DSurfaceOpacity(MPR3D_SURFACE_OPACITY_DEFAULT);updateMpr3DOpacityControls();syncMpr3DOverlayPresentation();recomposeSectionCaps()}); // 体験会モード: the slice opacity of the previous visitor goes back to the start value (60%) // 体験会モード: the zoom of the previous visitor
 const full3DPixelRatio=Math.min(devicePixelRatio,2);let active3DPixelRatio=full3DPixelRatio,wheelQualityTimer=null,fastKeepOverlays=false,mpr3DHideDuringCameraMoves=false,fastInteractionActive=false,fastInteractionTier=-1;
 const {pivotIndicator,makeViewButton,showViewPivot,hideViewPivot}=makeViewOverlays(renderer);
 const setHeavyOverlayInteraction=active=>{
  for(const group of [sceneState?.cutResultPreviewGroup]){
   if(!group)continue;
   if(active){
    if(group.userData._interactionPrevVisible===undefined)group.userData._interactionPrevVisible=group.visible;
    group.visible=false;
   }else if(group.userData._interactionPrevVisible!==undefined){
    group.visible=!!group.userData._interactionPrevVisible;delete group.userData._interactionPrevVisible;
   }
  }
 };
 // the end of a drag waits DRAG_END_DELAY_MS before the full resolution comes back (the heavy frame at the moment of release); a new
 // drag / wheel / slider interaction cancels it (setFastInteraction(true)), the wheel passes its own 120 ms and ends at once
 const DRAG_END_DELAY_MS=200;
 const dragEnd=makeDeferredEnd(()=>{setMpr3DInteractive(false);setFastInteraction(false);hideViewPivot()});
 const interactionQualityTier=()=>distance<2.15?2:distance<3.45?1:0;
 const setFastInteraction=(active,keepOverlays=false)=>{
  const next=!!active,tier=next?interactionQualityTier():-1;
  if(next)dragEnd.cancel();
  // slider drags (keepOverlays) must keep MPR planes visible in the volume:
  // the render loop hides them during fast camera moves only
  fastKeepOverlays=next&&!!keepOverlays;
  if(fastInteractionActive===next&&fastInteractionTier===tier){request3DRender();return}
  fastInteractionActive=next;fastInteractionTier=tier;
  const touch=(navigator.maxTouchPoints||0)>0,ratios=touch?[0.75,0.60,0.48]:[1.0,0.78,0.58];
  const lowerRes=globalThis.__vrlSettings?.get?.('dragLowerRes')!==false;
  // volume view: the three.js canvas only draws light overlays, so keep its
  // size; the volume renderer lowers its own resolution
  const nextRatio=next&&lowerRes&&!(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active)?Math.min(full3DPixelRatio,ratios[tier]||ratios[0]):full3DPixelRatio;
  if(nextRatio!==active3DPixelRatio){active3DPixelRatio=nextRatio;renderer.setPixelRatio(active3DPixelRatio);if(viewport.clientWidth>=8&&viewport.clientHeight>=8){renderer.setSize(viewport.clientWidth,viewport.clientHeight,false);globalThis.__vrlThreeResizes=(globalThis.__vrlThreeResizes||0)+1}}
  sceneState?.medicalVolume?.setInteractive?.(next,next?tier:0);setHeavyOverlayInteraction(next&&!keepOverlays);request3DRender();
 };
 const begin3DInteraction=()=>{dragEnd.cancel();setFastInteraction(true);setMpr3DInteractive(true)};
 const end3DInteraction=(delay=0)=>dragEnd.end(delay);
 sceneState.setFastInteraction=setFastInteraction;
 const isMousePanStart=e=>e.pointerType==='mouse'&&(e.button===1||e.button===2||e.shiftKey);
 const {viewCenterPivot,rotateAroundViewCenter,applyQuaternionAroundViewCenter,rollAroundViewCenter}=makeViewRotation(camera);
 const setAxisView=axis=>{
  const obj=sceneState.obj;if(!obj)return;
  const pivot=viewCenterPivot(),localPivot=obj.worldToLocal(pivot.clone()),target=new THREE.Quaternion();
  if(axis==='x')target.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,-1),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0)));
  else if(axis==='y')target.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0)));
  else target.identity();
  obj.quaternion.copy(target).normalize();obj.updateMatrixWorld(true);
  const moved=localPivot.clone().applyMatrix4(obj.matrixWorld);obj.position.add(pivot.clone().sub(moved));obj.updateMatrixWorld(true);
  showViewPivot();request3DRender();clearTimeout(wheelQualityTimer);wheelQualityTimer=setTimeout(hideViewPivot,380);
 };
 sceneState.setAxisView=setAxisView; // the shared plane selection turns the 3D view to face the plane
 makeViewButton('↶','平面回転 左へ15°',()=>{showViewPivot();rollAroundViewCenter(-Math.PI/12);request3DRender()});
 makeViewButton('↷','平面回転 右へ15°',()=>{showViewPivot();rollAroundViewCenter(Math.PI/12);request3DRender()});
 makeViewButton('X','Sagittal 正面（2D と同じ向き）',()=>setAxisView('x'));
 makeViewButton('Y','Coronal 正面（2D と同じ向き）',()=>setAxisView('y'));
 makeViewButton('Z','Axial 正面（2D と同じ向き）',()=>setAxisView('z'));
 const pan3D=(dx,dy)=>{if(!sceneState.obj)return;const h=Math.max(renderer.domElement.clientHeight,1),worldPerPixel=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))/h;sceneState.obj.position.x+=dx*worldPerPixel;sceneState.obj.position.y-=dy*worldPerPixel};
 const clear3DPointerState=(pointerId=null)=>{
  if(pointerId!=null){
   pointers.delete(pointerId);pointerStarts.delete(pointerId);
   try{if(renderer.domElement.hasPointerCapture(pointerId))renderer.domElement.releasePointerCapture(pointerId)}catch{}
  }else{
   for(const id of [...pointers.keys()]){try{if(renderer.domElement.hasPointerCapture(id))renderer.domElement.releasePointerCapture(id)}catch{}}
   pointers.clear();pointerStarts.clear();
  }
  if(pointers.size<2){lastPinch=0;lastCenter=null;lastTwist=null}
 };
 sceneState.clearPointerState=clear3DPointerState;
 if(threeEditOverlay&&threeEditOverlay.parentElement!==viewport)viewport.appendChild(threeEditOverlay);
 const resizeEditOverlay=(width=null,height=null)=>{if(!threeEditOverlay)return;const w=Math.round(width??viewport.clientWidth),h=Math.round(height??viewport.clientHeight);if(w<8||h<8)return;if(threeEditOverlay.width!==w)threeEditOverlay.width=w;if(threeEditOverlay.height!==h)threeEditOverlay.height=h};
 const editPoint=e=>{const rect=renderer.domElement.getBoundingClientRect();return{x:e.clientX-rect.left,y:e.clientY-rect.top}};
 const {cutSamplesToSurfaceStroke,sectionDragHit,sectionScreenStep,dragSectionPlane,drawEditStroke,appendCutScreenPoints,resampleCutScreenCurve,collectCutSurfaceSamples}=makeCutTools(renderer,camera);
 renderer.domElement.oncontextmenu=e=>e.preventDefault();
 renderer.domElement.onpointerdown=e=>{const cutTool=analysisEditTool==='pen'||analysisEditTool==='line',editViewReady=!!sceneState.obj&&(threeRenderMode==='surface'||(threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active)),cutReady=cutTool&&!analysisPendingCut&&!analysisCutApplying&&!analysisEditPreparing&&e.button===0&&!e.altKey&&editViewReady,lassoReady=(analysisEditTool==='lasso'||analysisEditTool==='unlasso')&&!analysisPendingCut&&!analysisCutApplying&&!analysisEditPreparing&&!volumeAnalysisBusy&&e.button===0&&!e.altKey&&editViewReady,sectionHit=!cutReady&&!lassoReady&&e.button===0&&!e.altKey?sectionDragHit(e):null,mode=cutReady?(analysisEditTool==='line'?'cut-line':'cut-pen'):lassoReady?'lasso':sectionHit?'section-drag':isMousePanStart(e)?'pan':(e.altKey?'roll':'rotate'),point={x:e.clientX,y:e.clientY,mode,pointerType:e.pointerType};if(lassoReady){setAnalysisCutScreen([editPoint(e)]);drawEditStroke('lasso')}if(!cutReady&&!lassoReady&&!sectionHit){begin3DInteraction();if(mode==='rotate'||mode==='roll')showViewPivot()}pointers.set(e.pointerId,point);pointerStarts.set(e.pointerId,{x:e.clientX,y:e.clientY,mode,sectionPlane:sectionHit?sectionViewPlane:null,sectionIndex:sectionHit?+planes[sectionViewPlane].slider.value:null,sectionScreenStep:sectionHit?sectionScreenStep():null,cutFrame:null});if(sectionHit){renderer.domElement.style.cursor='grabbing';footer.textContent=(currentLanguage==='ja'?sectionPlaneLabel(sectionViewPlane)+'断面をドラッグ中':'Dragging '+sectionPlaneLabel(sectionViewPlane)+' section')}if(cutReady){setAnalysisCutStroke([]);setAnalysisCutScreen([editPoint(e)]);pointerStarts.get(e.pointerId).cutSamples=[];setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);updateThreeEditUi(analysisEditTargetKey?(tr(analysisEditTargetKey)||analysisEditTargetKey)+' · '+(analysisEditTool==='pen'?tr('cutRegion'):tr('lineCutRegion')):(currentLanguage==='ja'?'切断線を描画中':'Drawing cut stroke'));footer.textContent=currentLanguage==='ja'?'切断線を描画中':'Drawing cut stroke';drawEditStroke(analysisEditTool)}renderer.domElement.setPointerCapture(e.pointerId);if(pointers.size>=2){const[a,b]=[...pointers.values()];lastPinch=Math.hypot(b.x-a.x,b.y-a.y);lastCenter={x:(a.x+b.x)/2,y:(a.y+b.y)/2};lastTwist=Math.atan2(b.y-a.y,b.x-a.x)}};
 renderer.domElement.onpointermove=e=>{const prev=pointers.get(e.pointerId),start=pointerStarts.get(e.pointerId);if(!prev)return;pointers.set(e.pointerId,{...prev,x:e.clientX,y:e.clientY});if(!sceneState.obj)return;if(pointers.size===1){const dx=e.clientX-prev.x,dy=e.clientY-prev.y;if(prev.mode==='section-drag'){dragSectionPlane(start,e);return}if(prev.mode==='lasso'){appendCutScreenPoints(e,'lasso');return}if(prev.mode==='cut-pen'||prev.mode==='cut-line'){appendCutScreenPoints(e,prev.mode==='cut-line'?'line':'pen');return}if(prev.mode==='pan'){pan3D(dx,dy);request3DRender();return}if(prev.mode==='roll'){const rect=renderer.domElement.getBoundingClientRect(),cx=rect.left+rect.width*.5,cy=rect.top+rect.height*.5,a0=Math.atan2(prev.y-cy,prev.x-cx),a1=Math.atan2(e.clientY-cy,e.clientX-cx);let da=a1-a0;if(da>Math.PI)da-=Math.PI*2;if(da<-Math.PI)da+=Math.PI*2;if(Math.hypot(prev.x-cx,prev.y-cy)<24)da=dx*.008;showViewPivot();rollAroundViewCenter(da);request3DRender();return}showViewPivot();rotateAroundViewCenter(dx,dy);request3DRender();return}const[a,b]=[...pointers.values()],d=Math.hypot(b.x-a.x,b.y-a.y),center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},twist=Math.atan2(b.y-a.y,b.x-a.x);if(lastPinch){showViewPivot();distance=THREE.MathUtils.clamp(distance*(lastPinch/Math.max(d,1)),MIN_3D_DISTANCE,MAX_3D_DISTANCE);camera.position.z=distance;setFastInteraction(true)}if(lastCenter){pan3D(center.x-lastCenter.x,center.y-lastCenter.y)}if(lastTwist!=null){let da=twist-lastTwist;if(da>Math.PI)da-=Math.PI*2;if(da<-Math.PI)da+=Math.PI*2;if(Math.abs(da)>.001){showViewPivot();rollAroundViewCenter(da)}}lastPinch=d;lastCenter=center;lastTwist=twist;request3DRender()};
 const endPointer=async e=>{const start=pointerStarts.get(e.pointerId),wasSingle=pointers.size===1,isCut=start?.mode==='cut-pen'||start?.mode==='cut-line',isSectionDrag=start?.mode==='section-drag';
  const isLasso=start?.mode==='lasso';
  if(isCut&&e.type==='pointerup')appendCutScreenPoints(e,start.mode==='cut-line'?'line':'pen');
  if(isLasso&&e.type==='pointerup')appendCutScreenPoints(e,'lasso');
  const screenCurve=isCut||isLasso?[...analysisCutScreen]:null;
  clear3DPointerState(e.pointerId);
  if(!pointers.size&&!isCut&&!isLasso&&!isSectionDrag)end3DInteraction(DRAG_END_DELAY_MS);
  if(isLasso){
   setAnalysisCutScreen([]);clearThreeEditOverlay();
   if(e.type!=='pointerup'||!screenCurve||screenCurve.length<3){updateThreeEditUi(currentLanguage==='ja'?'囲みをキャンセルしました':'Lasso cancelled');return}
   if(analysisEditTool==='unlasso')void deselectRegionsInLasso(screenCurve,renderer.domElement,camera);else void selectRegionsInLasso(screenCurve,renderer.domElement,camera);return;
  }
  if(isSectionDrag){renderer.domElement.style.cursor='';if(start?.sectionPlane===sectionViewPlane)schedulePlaneRender(sectionViewPlane,true);footer.textContent=currentLanguage==='ja'?sectionPlaneLabel(sectionViewPlane)+'断面 '+(+planes[sectionViewPlane].slider.value+1)+' / '+(+planes[sectionViewPlane].slider.max+1):sectionPlaneLabel(sectionViewPlane)+' section '+(+planes[sectionViewPlane].slider.value+1)+' / '+(+planes[sectionViewPlane].slider.max+1);return}
  if(isCut){
   setAnalysisCutStroke(null);
   if(e.type!=='pointerup'||!screenCurve||screenCurve.length<2){setAnalysisCutScreen([]);clearThreeEditOverlay();updateThreeEditUi(currentLanguage==='ja'?'切断線をキャンセルしました':'Cut stroke cancelled');return}
   updateThreeEditUi(currentLanguage==='ja'?'切断面を確定中…':'Resolving cut surface…');footer.textContent=currentLanguage==='ja'?'切断面を確定中…':'Resolving cut surface…';
   await frameYield();
   const cutMode=start.mode==='cut-line'?'line':'pen',cutSamples=await collectCutSurfaceSamples(screenCurve),surfaceStroke=cutSamplesToSurfaceStroke(cutSamples,cutMode,screenCurve),finalStroke=surfaceStroke.length>=2?surfaceStroke:[];
   if(finalStroke.length>=2&&analysisEditTargetKey){
    setAnalysisPendingCut({points:finalStroke,key:analysisEditTargetKey,mode:cutMode});setAnalysisCutScreen([]);clearThreeEditOverlay();sceneState.editCutPreviewPoint=finalStroke[finalStroke.length-1];updateCutPreview(sceneState.editCutPreviewPoint);footer.textContent=currentLanguage==='ja'?'切断予定を作成しました。深さ・幅・角度を調整してください':'Cut plan created. Adjust depth, width and angles.';updateThreeEditUi(tr('cutPendingHint'));
   }else{setAnalysisCutScreen([]);clearThreeEditOverlay();updateThreeEditUi(currentLanguage==='ja'?'切断線が対象表面にありません':'The cut stroke did not hit the target surface')}
   return;
  }
  if(e.type==='pointerup'&&e.button===0&&wasSingle&&start?.mode==='rotate'&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<6&&!volumeAnalysisBusy){if(analysisEditTool==='region')void analyzeEditRegionAtPointer(e,renderer.domElement,camera);else if(volumeAnalysisMode)void analyzeVolumeAtPointer(e,renderer.domElement,camera)}
 };
 renderer.domElement.onpointerup=endPointer;renderer.domElement.onpointercancel=endPointer;
 renderer.domElement.onlostpointercapture=e=>{const start=pointerStarts.get(e.pointerId);pointers.delete(e.pointerId);pointerStarts.delete(e.pointerId);if(!analysisPendingCut){setAnalysisCutScreen([]);clearThreeEditOverlay()}renderer.domElement.style.cursor='';if(pointers.size<2){lastPinch=0;lastCenter=null;lastTwist=null}if(!pointers.size&&start?.mode!=='section-drag')end3DInteraction(DRAG_END_DELAY_MS)};
 renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();begin3DInteraction();showViewPivot();clearTimeout(wheelQualityTimer);distance=THREE.MathUtils.clamp(distance+e.deltaY*.004,MIN_3D_DISTANCE,MAX_3D_DISTANCE);camera.position.z=distance;setFastInteraction(true);request3DRender();wheelQualityTimer=setTimeout(()=>end3DInteraction(),120)},{passive:false});
 let appliedSize='';const resize=()=>{const rect=viewport.getBoundingClientRect(),w=Math.round(rect.width),h=Math.round(rect.height);if(w<8||h<8)return;const key=w+'x'+h+'@'+active3DPixelRatio;if(key===appliedSize)return;appliedSize=key; // unchanged size: nothing to do (renderer.setSize clears the canvas even for the same size, and the render that follows is a full volume pass): the panel switches of the workspace UI call this without moving the view
 camera.aspect=w/h;camera.updateProjectionMatrix();updateAxisWidget();renderer.setPixelRatio(active3DPixelRatio);renderer.setSize(w,h,false);resizeEditOverlay(w,h);sceneState?.medicalVolume?.resize();request3DRender()};sceneState.resize=resize;new ResizeObserver(resize).observe(viewport);resize();
 {const draw=renderer.render.bind(renderer);renderer.render=(sc,cam)=>{const t=performance.now();draw(sc,cam);globalThis.__vrlThreeRenderMs=performance.now()-t}} // diagnostics
 renderer.setAnimationLoop(()=>{if(!sceneState?.needsRender)return;if(viewport.clientWidth<8||viewport.clientHeight<8)return;sceneState.needsRender=false;// 3D hidden (2D-only layout): keep the request until it is shown again
if(sceneState.obj){sceneState.obj.updateMatrixWorld(true);updateMeshDepth(camera,sceneState.obj,current3DVolume)}syncVolumeAnalysisOverlay();if(sceneState.obj){axisWidget.quaternion.copy(sceneState.obj.quaternion);if(sectionViewOpen&&sectionViewPlane)updateSectionClipPlaneWorld();syncSectionCapPresentation();if(sceneState.mprPlaneGroup){sceneState.mprPlaneGroup.visible=true;sceneState.mprPlaneGroup.position.copy(sceneState.obj.position);sceneState.mprPlaneGroup.quaternion.copy(sceneState.obj.quaternion);sceneState.mprPlaneGroup.scale.copy(sceneState.obj.scale)}}else if(sceneState.mprPlaneGroup)sceneState.mprPlaneGroup.visible=false;if(threeRenderMode==='volume'&&sceneState.medicalVolume?.active){const interactiveVisible=mpr3DHideDuringCameraMoves&&fastInteractionActive&&!fastKeepOverlays?[sectionViewOpen&&sectionViewPlane==='axial'&&sectionSliceImageVisible?1:0,sectionViewOpen&&sectionViewPlane==='coronal'&&sectionSliceImageVisible?1:0,sectionViewOpen&&sectionViewPlane==='sagittal'&&sectionSliceImageVisible?1:0]:[sectionViewOpen&&sectionViewPlane==='axial'?(sectionSliceImageVisible?1:0):(mpr3DVisibility.axial?1:0),sectionViewOpen&&sectionViewPlane==='coronal'?(sectionSliceImageVisible?1:0):(mpr3DVisibility.coronal?1:0),sectionViewOpen&&sectionViewPlane==='sagittal'?(sectionSliceImageVisible?1:0):(mpr3DVisibility.sagittal?1:0)];sceneState.medicalVolume.render(camera,sceneState.obj,segmentState,gpuSegmentOrder(),{indices:[+planes.axial.slider.value,+planes.coronal.slider.value,+planes.sagittal.slider.value],visible:interactiveVisible,opacity:mpr3DVolumeOpacity,windowCenter:+wc.value,windowWidth:+ww.value,section:{active:sectionViewOpen&&!!sectionViewPlane,plane:sectionViewPlane,index:sectionViewPlane?+planes[sectionViewPlane].slider.value:0,reverse:sectionViewReverse,capEnabled:sectionCapEnabled,capOpacity:sectionCapOpacity,hatch:sectionCapHatch}});renderer.render(scene,camera)}else renderer.render(scene,camera);reportSectionRenderStats(renderer);updateComment3dMarkers();updateHuLine3d();updateCrop3d()});
}
armConfirm(volumeCacheClearBtn,async()=>{
 const cache=await volumeCache();if(!cache)return;
 try{await cache.clear();footer.textContent=tr('volumeCacheCleared')}catch(e){console.warn(e)}
 void updateVolumeCacheControl();
});

function resetVolume(){setCrosshairMode(false);clearCrosshair('series');incSourceRenderRevision(false);setThreeDCancelRequested(false);gpuVolumeRefresh.token++;gpuVolumeRefresh.running=null;setCurrent3DVolume(null);setAnalysisEditPreparing(false);setAnalysisEditTool('select');setAnalysisEditTargetKey(null);setAnalysisEditTargetMode('auto');setAnalysisCutStroke(null);setAnalysisCutScreen([]);setAnalysisPendingCut(null);if(analysisEditTargetSelect)analysisEditTargetSelect.value='auto';setMemoryGpuPreviewActive(false);clearMemoryFilterPreviewCache();invalidateSourceFilters();clearSourceSliceCache();setActiveSeries(null);setSectionViewOpen(false);clearSectionView();updateSectionViewUi();if(threeRenderMode==='volume')setThreeVolumeOverlay(false);setThreeRenderMode('surface');sceneState?.medicalVolume?.resetData();clearAllSegmentEdits();clearAnalysisHighlight();smoothingType.value='gaussian';setFilterOrder([]);for(const box of [spikeHoleBtn,nlmBtn,anisotropicBtn,gaussianBtn,sigmoidBtn,bilateralBtn,tvBtn,unsharpBtn])box.checked=false;renderFilterOrder();for(const key of SEGMENT_PRESET_ORDER){segmentState[key].active=false;segmentState[key].enabled=false;const enabled=$('[data-seg-enabled="'+key+'"]');if(enabled)enabled.checked=false}renderSegmentPresets();setVolumeAnalysisMode(false);setVolumeAnalysisBusy(false);volumeAnalysisToggle.disabled=true;volumeAnalysisToggle.classList.remove('is-active');volumeAnalysisToggle.textContent=tr('volumeMode');sectionViewToggle.disabled=true;volumeAnalysisResult.classList.add('is-hidden');clearAnalysisHighlight();incFilterRebuildRevision(false);filterState.spikeHole=filterState.nlm=filterState.anisotropic=filterState.gaussian=filterState.sigmoid=filterState.bilateral=filterState.tv=filterState.unsharp=false;setVolume(null);setSourceVolume(null);enableProcessingControls(false);surfaceSmoothEnabled.disabled=true;surfaceSmoothStrength.disabled=true;gaussianStrength.disabled=true;spatialPasses.disabled=true;spikeHoleStrength.disabled=true;spikeHoleThreshold.disabled=true;nlmStrength.disabled=true;nlmSearchRadius.disabled=true;nlmPatchRadius.disabled=true;anisotropicStrength.disabled=true;anisotropicIterations.disabled=true;bilateralStrength.disabled=true;bilateralSpatial.disabled=true;bilateralIntensity.disabled=true;bilateralPasses.disabled=true;tvWeight.disabled=true;tvIterations.disabled=true;unsharpRadius.disabled=true;unsharpAmount.disabled=true;unsharpThreshold.disabled=true;wc.disabled=ww.disabled=true;setCtRangeProfile(null);setCtRangeMode('auto');ctRangeAuto.disabled=ctRangeFull.disabled=true;ctRangeAuto.classList.add('is-active');ctRangeFull.classList.remove('is-active');for(const key of Object.keys(segmentState)){for(const sel of ['enabled','color','min','max','opacity','opening','closing','min-component','hole-fill','surface-mm','thickness-mm']){const el=$('[data-seg-'+sel+'="'+key+'"]');if(el)el.disabled=true}const exportBtn=$('[data-seg-export="'+key+'"]');if(exportBtn)exportBtn.disabled=true;const removeBtn=$('[data-seg-remove="'+key+'"]');if(removeBtn)removeBtn.disabled=true;setSegmentStatus(key,'')}wcVal.value=wwVal.value='—';for(const p of Object.values(planes)){p.slider.disabled=true;p.label.textContent='—';p.canvas.getContext('2d')?.clearRect(0,0,p.canvas.width,p.canvas.height)}if(sceneState?.obj){sceneState.obj.parent?.remove(sceneState.obj);dispose(sceneState.obj);sceneState.obj=null}set3DBusy(false);updateRenderModeControl(null);updateAnalysisEditorControls();updateThreeEditUi();request3DRender();set3DState('current');threeLabel.textContent=sceneState?.backend||'3D'}
void ensureLatestDeployedBuild();
start3D().catch(e=>{console.error(e);logGpuError('start3D',e);status.textContent='3D RENDERER ERROR';status.className='status status-error';{const bar=document.getElementById('gpu-status-bar'),t=document.getElementById('gpu-status-text');if(bar&&t){t.textContent='3D RENDERER ERROR';bar.classList.add('is-warning')}}threeLabel.textContent='MPR ONLY';footer.textContent='3D初期化に失敗しました。DICOM/MPRは利用できます: '+String(e.message||e)});

// debug: what the app holds in memory, every 2 s in the status bar
setInterval(()=>{
 const el=document.getElementById('gpu-mem-ledger');if(!el)return;
 if(!globalThis.__vrlSettings?.debugOn?.()){el.textContent='';return}
 const v=memState.sourceVolume,arr=x=>x?.byteLength||0;
 el.textContent=' · '+ledgerText({slices:memVolumeIo.sourceSliceCache?.bytes,ortho:memState.sourceOrthogonalPlaneCacheBytes,filter:memSourceFilters.sourceFilterRuntime?.cacheBytes,preview:memSourceFilters.memoryFilterPreviewCache?.bytes,pool:memGpu.gpuFilterRuntime?.bufferPoolBytes,mpr:arr(v?.mprData)+arr(v?.mprSagittalDisplayAll)+arr(v?.data)});
},2000);
