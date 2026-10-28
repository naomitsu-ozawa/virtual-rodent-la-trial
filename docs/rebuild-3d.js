// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { mark3DStale, mark3DCurrent, set3DState } from './three-state.js?v=20261028-build686';
import { updateVolumeFilterBadge, set3DBusy } from './three-status.js?v=20261028-build686';
import { currentLanguage, volume, threeDApplying, threeRenderMode, sceneState, sourceVolume, setThreeDCancelRequested, threeDCancelRequested, filterRebuildRevision, setCurrent3DVolume, deferAutomatic3D, setDeferAutomatic3D, setMemoryGpuPreviewActive, setVolume, filterOrder, analysisRegions, analysisFilterSignature } from './state.js?v=20261028-build686';
import { setGpuComputeBackend } from './gpu-compute.js?v=20261028-build686';
import { gpuVolumeApplied, refreshGpuVolumeData, syncGpuVolumeEdits } from './gpu-volume-data.js?v=20261028-build686';
import { SEGMENT_PRESET_ORDER, segmentState, segmentNeedsVoxelMask } from './segments.js?v=20261028-build686';
import { ensureSegmentBaseRuns } from './segment-runs.js?v=20261028-build686';
import { renderAll } from './mpr-render.js?v=20261028-build686';
import { sourceFilterStages, filterState, memoryFilterPreviewCache, sourceFilterHalo, fitSourceTile, processMemoryRegion, currentFilterSignature } from './source-filters.js?v=20261028-build686';
import { footer, threeLabel, smoothingType, spikeHoleStrength, spikeHoleThreshold, nlmStrength, nlmSearchRadius, nlmPatchRadius, anisotropicStrength, anisotropicIterations, gaussianStrength, spatialPasses, sigmoidStrength, sigmoidCenter, sigmoidWidth, bilateralStrength, bilateralSpatial, bilateralIntensity, bilateralPasses, tvWeight, tvIterations, unsharpRadius, unsharpAmount, unsharpThreshold, bar, progLabel, anisotropicKappa, tvEps } from './ui-shell.js?v=20261028-build686';
import { tr } from './i18n.js?v=20261028-build686';
import { render3D, gpuMeshBlockDepth } from './surface-build.js?v=20261028-build686';
import { resetAnalysisRegistryAfterRebuild, keepAnalysisRegionsAfterRebuild } from './analysis-results.js?v=20261028-build686';
import { setProcessingBusy } from './busy.js?v=20261028-build686';
import { reportBusyProgress } from './progress-modal.js?v=20261028-build686';
import { cpuSpikeHole, cpuNlm3D, cpuAnisotropicDiffusion, cpuGaussian3D, cpuMedian3D, cpuSigmoid, cpuBilateral3D, cpuTvDenoising3D, cpuUnsharpMask3D } from './cpu-filters.js?v=20261028-build686';
import { isDesktopRuntime, frameYield } from './utils.js?v=20261028-build686';
export function mark3DUpdating(){set3DState('updating')}
export async function buildCpuFilteredVolumeFor3D(){
 const previousDefer=deferAutomatic3D;setDeferAutomatic3D(true);setMemoryGpuPreviewActive(false);clearMemoryFilterPreviewCache();setVolume(sourceVolume);
 let base=sourceVolume;
 try{
  for(const key of filterOrder){
   if(!filterState[key])continue;
   await applyCpuFilter(key,base);
   base=volume;
  }
  return base;
 }finally{setDeferAutomatic3D(previousDefer)}
}
export const surfaceRebuildPending={value:false};
// segments edited in the GPU volume view: their run surfaces are refreshed when switching back to surface mode
export const surfaceEditsPending=new Set();
export async function rebuildCurrent3D(){
 if(!volume||threeDApplying)return;
 // Volume mode: "Rebuild 3D" applies the current filters to the GPU volume
 // only. Building surface meshes here was slow and the new meshes were drawn
 // over the volume (they are created after the volume hid the old ones).
 if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active&&(sourceVolume||volume)?.sourceBacked){
  setThreeDCancelRequested(false);mark3DUpdating();
  gpuVolumeApplied.seriesId=(sourceVolume||volume)?.series?.id??null;gpuVolumeApplied.signature=currentFilterSignature();
  surfaceRebuildPending.value=true;
  await refreshGpuVolumeData();
  if(!threeDCancelRequested)await resyncSegmentMasksToVolume();
  if(threeDCancelRequested){setThreeDCancelRequested(false);mark3DStale()}else mark3DCurrent();
  updateVolumeFilterBadge();return;
 }
 setThreeDCancelRequested(false);mark3DUpdating();const settingsRevision=filterRebuildRevision,appliedSignature=currentFilterSignature();
 try{
  let buildVolume=sourceVolume||volume;
  if(!buildVolume.sourceBacked){
   const stages=sourceFilterStages();
   if(stages.length){
    set3DBusy(true,'3D再構築 · GPUフィルター処理…');
    try{
     const data=await applyGpuFiltersToMemoryVolume(sourceVolume,stages,settingsRevision);
     if(threeDCancelRequested||settingsRevision!==filterRebuildRevision)throw new Error('__SUPERSEDED__');
     buildVolume=cloneVolumeWithData(sourceVolume,data);
    }catch(e){
     if(String(e.message||e)==='__SUPERSEDED__'){
      set3DBusy(false);mark3DStale();
      if(threeDCancelRequested){footer.textContent=tr('threeCancelled');threeLabel.textContent=(sceneState?.backend||'3D')+(sceneState?.obj?' · previous 3D':'')}
      return;
     }
     console.warn('Full GPU filter rebuild failed; using exact CPU filter stack.',e);setGpuComputeBackend('CPU STACK · GPU FAIL','rebuild: '+String(e?.message||e));
     buildVolume=await buildCpuFilteredVolumeFor3D();
     if(threeDCancelRequested){set3DBusy(false);mark3DStale();footer.textContent=tr('threeCancelled');return}
    }
   }
  }
  const ok=await render3D(buildVolume,true);
  if(threeDCancelRequested||!ok){
   set3DBusy(false);mark3DStale();
   if(threeDCancelRequested){footer.textContent=tr('threeCancelled');threeLabel.textContent=(sceneState?.backend||'3D')+(sceneState?.obj?' · previous 3D':'')}
   return;
  }
  // regions made on the filters this rebuild applies (null: no filter change since they were made, a change clears them) stay
  if(analysisRegions.length&&(analysisFilterSignature==null||analysisFilterSignature===appliedSignature))keepAnalysisRegionsAfterRebuild();else resetAnalysisRegistryAfterRebuild();
  setCurrent3DVolume(buildVolume);surfaceRebuildPending.value=false;
  gpuVolumeApplied.seriesId=(sourceVolume||volume)?.series?.id??null;gpuVolumeApplied.signature=appliedSignature;
  // the masks too (as the source-backed branch above)
  if(threeRenderMode==='volume')void refreshGpuVolumeData().then(()=>resyncSegmentMasksToVolume()).catch(e=>console.warn('GPU volume mask resync failed.',e));
 }catch(e){
  if(String(e.message||e)!=='__SUPERSEDED__')console.error(e);
  set3DBusy(false);mark3DStale();
  if(threeDCancelRequested)footer.textContent=tr('threeCancelled');
 }
}
// the processed / edited voxels of every shown segment that needs a mask, computed when missing or stale (a current one
// is returned at once), then sent to the GPU volume
export async function resyncSegmentMasksToVolume(){
 const v=sourceVolume||volume;if(!v)return;
 for(const key of SEGMENT_PRESET_ORDER){
  const s=segmentState[key];if(!s?.active||!s.enabled||!segmentNeedsVoxelMask(key))continue;
  try{await ensureSegmentBaseRuns(key,v)}catch(e){if(String(e?.message||e)!=='__SUPERSEDED__')console.warn('Segment mask for the GPU volume failed for '+key,e)}
 }
 syncGpuVolumeEdits(v);
}
export async function applyGpuFiltersToMemoryVolume(v,stages,revision){
 const w=v.columns,h=v.rows,d=v.slices,out=new Float32Array(w*h*d),halo=sourceFilterHalo(stages),coreDepth=gpuMeshBlockDepth(),[tx,ty]=fitSourceTile(w,h,coreDepth,halo,navigator.maxTouchPoints>0?256:(isDesktopRuntime()?512:384),navigator.maxTouchPoints>0?96:(isDesktopRuntime()?160:128));
 for(let z=0;z<d;z+=coreDepth){
  const td=Math.min(coreDepth,d-z);
  for(let y=0;y<h;y+=ty)for(let x=0;x<w;x+=tx){
   if(revision!==filterRebuildRevision)throw new Error('__SUPERSEDED__');
   const tw=Math.min(tx,w-x),th=Math.min(ty,h-y),tile=await processMemoryRegion(v,{x,y,z,width:tw,height:th,depth:td},stages);
   for(let zz=0;zz<td;zz++)for(let yy=0;yy<th;yy++){
    const src=(zz*th+yy)*tw,dst=((z+zz)*h+y+yy)*w+x;out.set(tile.subarray(src,src+tw),dst);
   }
  }
  progress(Math.min(d,z+td),d);await frameYield();
 }
 if(revision!==filterRebuildRevision)throw new Error('__SUPERSEDED__');
 return out;
}
export function cloneVolumeWithData(base,data){
 return{data,columns:base.columns,rows:base.rows,slices:base.slices,spacing:[...base.spacing],min:base.min,max:base.max,storage:data.constructor.name,sourceBacked:false};
}
export const CPU_FILTERS={
 spikeHole:{label:'Spike / Hole',error:'Spike/Hole',run:v=>{const p={strength:+spikeHoleStrength.value,thresholdHU:+spikeHoleThreshold.value};return[p,cpuSpikeHole(v,p,progress)]},footer:(p,r)=>'Spike / Hole · '+p.strength.toFixed(2)+' · threshold '+Math.round(p.thresholdHU)+' HU'+' · '+r.corrected.toLocaleString()+' voxels'},
 nlm:{label:'Fast NLM 3D',error:'NLM',run:v=>{const p={hHU:+nlmStrength.value,searchRadius:+nlmSearchRadius.value,patchRadius:+nlmPatchRadius.value};return[p,cpuNlm3D(v,p,progress)]},footer:(p,r)=>'Fast NLM 3D · h '+Math.round(p.hHU)+' HU'+' · search '+r.searchRadius+' · patch '+r.patchRadius},
 anisotropic:{label:'Anisotropic Diffusion',error:'Anisotropic',run:v=>{const p={strength:+anisotropicStrength.value,kappaHU:+anisotropicKappa.value,iterations:+anisotropicIterations.value};return[p,cpuAnisotropicDiffusion(v,p,progress)]},footer:(p,r)=>'Anisotropic Diffusion · '+p.strength.toFixed(2)+' · κ '+Math.round(p.kappaHU)+' HU'+' · '+r.iterations+' iterations'},
 gaussian:{label:'Gaussian 3D',error:'Gaussian',run:v=>{const p={strength:+gaussianStrength.value,passes:+spatialPasses.value};return[p,cpuGaussian3D(v,p,progress)]},footer:p=>'Gaussian 3D · live '+p.strength.toFixed(2)},
 median:{label:'Median 3D',error:'Median',run:v=>{const p={strength:+gaussianStrength.value,passes:+spatialPasses.value};return[p,cpuMedian3D(v,p,progress)]},footer:p=>'Median 3D · live '+p.strength.toFixed(2)},
 sigmoid:{label:'Sigmoid',error:'Sigmoid',run:v=>{const p={strength:+sigmoidStrength.value,center:+sigmoidCenter.value,width:+sigmoidWidth.value};return[p,cpuSigmoid(v,p,progress)]},footer:(p,r)=>'Sigmoid · '+p.strength.toFixed(2)+' · center '+Math.round(r.centerValue)+' · width '+Math.round(p.width)},
 bilateral:{label:'Bilateral 3D',error:'Bilateral',run:v=>{const p={strength:+bilateralStrength.value,spatialSigma:+bilateralSpatial.value,sigmaHU:+bilateralIntensity.value,passes:+bilateralPasses.value};return[p,cpuBilateral3D(v,p,progress)]},footer:p=>'Bilateral 3D · '+p.strength.toFixed(2)+' · σ '+(+p.sigmaHU).toFixed(0)+' HU'},
 tv:{label:'TV Denoising 3D',error:'TV',run:v=>{const p={weight:+tvWeight.value,epsHU:+tvEps.value,iterations:+tvIterations.value};return[p,cpuTvDenoising3D(v,p,progress)]},footer:(p,r)=>'TV Denoising 3D · '+p.weight.toFixed(2)+' · '+r.iterations+' iterations'},
 unsharp:{label:'Unsharp Mask 3D',error:'Unsharp',run:v=>{const p={radius:+unsharpRadius.value,amount:+unsharpAmount.value,thresholdHU:+unsharpThreshold.value};return[p,cpuUnsharpMask3D(v,p,progress)]},footer:p=>'Unsharp Mask 3D · amount '+p.amount.toFixed(2)}
};
export function cpuFilterKind(key){return key==='gaussian'&&smoothingType.value==='median'?'median':key}
export async function applyCpuFilter(key,baseVolume=volume){
 const f=CPU_FILTERS[cpuFilterKind(key)];if(!baseVolume||!f)return;setProcessingBusy(true,f.label+(currentLanguage==='en'?' · filtering…':' を適用中…'));
 try{
  const [params,pending]=f.run(baseVolume),result=await pending;
  setVolume(cloneVolumeWithData(baseVolume,result.data));renderAll();render3D(volume);footer.textContent=f.footer(params,result);
 }catch(e){console.error(e);footer.textContent=f.error+' error: '+String(e.message||e)}
 finally{setProcessingBusy(false)}
}
export function clearMemoryFilterPreviewCache(){memoryFilterPreviewCache.map.clear();memoryFilterPreviewCache.bytes=0}
// also the bar of the job shown in the progress modal
export function progress(a,b){bar.style.width=(b?Math.round(a/b*100):0)+'%';progLabel.textContent=a+' / '+b;reportBusyProgress(null,a,b,a+' / '+b)}
