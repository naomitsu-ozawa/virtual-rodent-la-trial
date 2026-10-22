// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { mark3DStale } from './three-state.js?v=20261022-build652';
import { currentLanguage, volume, filterRebuildTimer, sourceVolume, setFilterRebuildTimer, incFilterRebuildRevision, setVolume, filterRebuildRevision, filterOrder, setDeferAutomatic3D, setMemoryGpuPreviewActive, incSourceRenderRevision } from './state.js?v=20261022-build652';
import { clearMemoryFilterPreviewCache, applyCpuFilter } from './rebuild-3d.js?v=20261022-build652';
import { scheduleSourceMprWarmup, renderPlane, renderAll } from './mpr-render.js?v=20261022-build652';
import { setProcessingBusy } from './busy.js?v=20261022-build652';
import { planes, footer, gaussianStrength, spatialPasses, smoothingType, spikeHoleStrength, spikeHoleThreshold, nlmStrength, nlmSearchRadius, nlmPatchRadius, anisotropicStrength, anisotropicIterations, sigmoidStrength, sigmoidCenter, sigmoidWidth, bilateralStrength, bilateralSpatial, bilateralIntensity, bilateralPasses, tvWeight, tvIterations, unsharpRadius, unsharpAmount, unsharpThreshold, gaussianBtn, spikeHoleBtn, nlmBtn, anisotropicBtn, sigmoidBtn, bilateralBtn, tvBtn, unsharpBtn, resetFilterBtn, mainViewSlot, filterControlList, filterAddButton, filterAddSelect, anisotropicKappa, tvEps } from './ui-shell.js?v=20261022-build652';
import { planeRenderRevision, sourceFilterStages, filterState, sourceFilterRuntime } from './source-filters.js?v=20261022-build652';
import { gpuFilterRuntime, gpuStagesSupported, setGpuComputeBackend } from './gpu-compute.js?v=20261022-build652';
import { tr } from './i18n.js?v=20261022-build652';
import { FILTER_UNITS, isValidUnitValue } from './filter-units.js?v=20261022-build652';
import { refreshGpuVolumeData } from './gpu-volume-data.js?v=20261022-build652';
import { render3D } from './surface-build.js?v=20261022-build652';
import { SEGMENT_PRESET_ORDER, segmentState, segmentHasProcessedMask } from './segments.js?v=20261022-build652';
export const FILTER_CATALOG_ORDER=['spikeHole','nlm','anisotropic','gaussian','sigmoid','bilateral','tv','unsharp'];
export const liveFilterState={timer:null,base:null,key:null};
export function renderFilterOrder(){
 if(!filterControlList)return;
 const active=new Set(filterOrder);
 for(const key of FILTER_CATALOG_ORDER){
  const card=filterControlList.querySelector('[data-filter-key="'+key+'"]');
  if(!card)continue;
  card.classList.toggle('is-hidden',!active.has(key));
  if(active.has(key))filterControlList.insertBefore(card,resetFilterBtn);
 }
 for(const card of filterControlList.querySelectorAll('[data-filter-key]')){
  const key=card.dataset.filterKey,index=filterOrder.indexOf(key);
  const up=card.querySelector('[data-filter-move="up"]'),down=card.querySelector('[data-filter-move="down"]');
  if(up)up.disabled=index<=0;
  if(down)down.disabled=index<0||index>=filterOrder.length-1;
 }
 for(const option of filterAddSelect.options)option.disabled=active.has(option.value);
 const next=[...filterAddSelect.options].find(o=>!o.disabled);
 if(next)filterAddSelect.value=next.value;
 filterAddButton.disabled=!next;
 resetFilterBtn.disabled=!sourceVolume||filterOrder.length===0;
}
export function addFilter(key){
 if(!FILTER_CATALOG_ORDER.includes(key)||filterOrder.includes(key))return;
 filterOrder.push(key);
 filterState[key]=true;
 const box={spikeHole:spikeHoleBtn,nlm:nlmBtn,anisotropic:anisotropicBtn,gaussian:gaussianBtn,sigmoid:sigmoidBtn,bilateral:bilateralBtn,tv:tvBtn,unsharp:unsharpBtn}[key];
 if(box)box.checked=true;
 renderFilterOrder();syncFilterControls();
 if(sourceVolume)scheduleFilterRebuild(0);
}
export function removeFilter(key){
 const index=filterOrder.indexOf(key);if(index<0)return;
 filterOrder.splice(index,1);filterState[key]=false;
 const box={spikeHole:spikeHoleBtn,nlm:nlmBtn,anisotropic:anisotropicBtn,gaussian:gaussianBtn,sigmoid:sigmoidBtn,bilateral:bilateralBtn,tv:tvBtn,unsharp:unsharpBtn}[key];
 if(box)box.checked=false;
 renderFilterOrder();syncFilterControls();
 if(sourceVolume)scheduleFilterRebuild(0);
}
export function moveFilter(key,delta){
 const from=filterOrder.indexOf(key),to=from+delta;
 if(from<0||to<0||to>=filterOrder.length)return;
 [filterOrder[from],filterOrder[to]]=[filterOrder[to],filterOrder[from]];
 renderFilterOrder();
 if(sourceVolume&&filterOrder.length)scheduleFilterRebuild(0);
}
export function installFilterReorder(){
 if(!filterControlList)return;
 filterAddButton.addEventListener('click',()=>addFilter(filterAddSelect.value));
 for(const card of filterControlList.querySelectorAll('[data-filter-key]')){
  card.querySelector('[data-filter-move="up"]')?.addEventListener('click',()=>moveFilter(card.dataset.filterKey,-1));
  card.querySelector('[data-filter-move="down"]')?.addEventListener('click',()=>moveFilter(card.dataset.filterKey,1));
  card.querySelector('[data-filter-remove]')?.addEventListener('click',()=>removeFilter(card.dataset.filterKey));
  let draggedKey=null;
  card.addEventListener('dragstart',e=>{
   draggedKey=card.dataset.filterKey;card.classList.add('is-dragging');
   if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedKey)}
  });
  card.addEventListener('dragend',()=>{draggedKey=null;card.classList.remove('is-dragging')});
  card.addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move'});
  card.addEventListener('drop',e=>{
   e.preventDefault();
   const fromKey=draggedKey||e.dataTransfer?.getData('text/plain'),targetKey=card.dataset.filterKey;
   if(!fromKey||fromKey===targetKey)return;
   const from=filterOrder.indexOf(fromKey),to=filterOrder.indexOf(targetKey);
   if(from<0||to<0)return;
   filterOrder.splice(from,1);filterOrder.splice(to,0,fromKey);
   renderFilterOrder();
   if(sourceVolume)scheduleFilterRebuild(0);
  });
 }
 renderFilterOrder();
}
export function syncFilterControls(){
 gaussianStrength.disabled=!sourceVolume||!filterState.gaussian;
 spatialPasses.disabled=!sourceVolume||!filterState.gaussian;
 smoothingType.disabled=!sourceVolume||!filterState.gaussian;
 spikeHoleStrength.disabled=!sourceVolume||!filterState.spikeHole;
 spikeHoleThreshold.disabled=!sourceVolume||!filterState.spikeHole;
 nlmStrength.disabled=!sourceVolume||!filterState.nlm;
 nlmSearchRadius.disabled=!sourceVolume||!filterState.nlm;
 nlmPatchRadius.disabled=!sourceVolume||!filterState.nlm;
 anisotropicStrength.disabled=!sourceVolume||!filterState.anisotropic;anisotropicKappa.disabled=!sourceVolume||!filterState.anisotropic;
 anisotropicIterations.disabled=!sourceVolume||!filterState.anisotropic;
 sigmoidStrength.disabled=!sourceVolume||!filterState.sigmoid;
 sigmoidCenter.disabled=sigmoidWidth.disabled=!sourceVolume||!filterState.sigmoid;
 bilateralStrength.disabled=!sourceVolume||!filterState.bilateral;bilateralSpatial.disabled=!sourceVolume||!filterState.bilateral;bilateralIntensity.disabled=!sourceVolume||!filterState.bilateral;bilateralPasses.disabled=!sourceVolume||!filterState.bilateral;
 tvWeight.disabled=!sourceVolume||!filterState.tv;tvIterations.disabled=!sourceVolume||!filterState.tv;
 unsharpRadius.disabled=!sourceVolume||!filterState.unsharp;unsharpAmount.disabled=!sourceVolume||!filterState.unsharp;unsharpThreshold.disabled=!sourceVolume||!filterState.unsharp;
 gaussianBtn.disabled=!sourceVolume;smoothingType.disabled=!sourceVolume||!filterState.gaussian;spikeHoleBtn.disabled=!sourceVolume;nlmBtn.disabled=!sourceVolume;anisotropicBtn.disabled=!sourceVolume;sigmoidBtn.disabled=!sourceVolume;bilateralBtn.disabled=!sourceVolume;tvBtn.disabled=!sourceVolume;unsharpBtn.disabled=!sourceVolume;
 gaussianBtn.checked=filterState.gaussian;spikeHoleBtn.checked=filterState.spikeHole;nlmBtn.checked=filterState.nlm;anisotropicBtn.checked=filterState.anisotropic;sigmoidBtn.checked=filterState.sigmoid;bilateralBtn.checked=filterState.bilateral;tvBtn.checked=filterState.tv;unsharpBtn.checked=filterState.unsharp;
 resetFilterBtn.disabled=!sourceVolume||filterOrder.length===0;
}
export function scheduleFilterRebuild(delay=120){
 clearTimeout(filterRebuildTimer);clearMemoryFilterPreviewCache();mark3DStale();
 const finalize3D=!(sourceVolume?.sourceBacked)||delay===0;
 // the segmentation is computed from the filtered data: after a filter change app.js recomputes the processed /
 // edited segments and clears the analysis results that no longer match ('vrl-filters-changed')
 setFilterRebuildTimer(setTimeout(()=>{setFilterRebuildTimer(null);void rebuildActiveFilters(finalize3D).finally(()=>document.dispatchEvent(new CustomEvent('vrl-filters-changed')))},delay));
}
export async function rebuildActiveFilters(finalize3D=true){
 if(!sourceVolume)return;
 const revision=incFilterRebuildRevision(true);
 clearTimeout(liveFilterState.timer);liveFilterState.base=null;liveFilterState.key=null;
 if(sourceVolume.sourceBacked){
  invalidateSourceFilters();setVolume(sourceVolume);scheduleSourceMprWarmup();setProcessingBusy(true,currentLanguage==='en'?'Applying filters…':'フィルターを適用中…',false);
  try{
   const mainKey=currentMainViewKey(),previewPlane=planes[mainKey]?mainKey:'axial';
   await renderPlane(previewPlane,++planeRenderRevision[previewPlane],+planes[previewPlane].slider.value);
   if(revision!==filterRebuildRevision)return;
   mark3DStale();
   footer.textContent=filterOrder.length?'Full-resolution filters · '+gpuFilterRuntime.lastBackend+' · '+filterOrder.length+' stage(s)':tr('original');
  }finally{setProcessingBusy(false,'Full-resolution filters',false);syncFilterControls()}
  if(applyVolumeAfterFilterRebuild.value&&revision===filterRebuildRevision){applyVolumeAfterFilterRebuild.value=false;void refreshGpuVolumeData()}
  return;
 }
 let base=sourceVolume;
 setDeferAutomatic3D(true);
 try{
  const stages=sourceFilterStages();
  if(!stages.length){
   setMemoryGpuPreviewActive(false);clearMemoryFilterPreviewCache();setVolume(sourceVolume);renderAll();mark3DStale();footer.textContent=tr('original');return;
  }
  if(gpuStagesSupported(stages)&&!hasGlobalSegmentProcessing()){
   setMemoryGpuPreviewActive(true);clearMemoryFilterPreviewCache();setVolume(sourceVolume);setProcessingBusy(true,currentLanguage==='en'?'Filter preview…':'フィルターのプレビューを作成中…',false);
   try{
    const mainKey=currentMainViewKey(),previewPlane=planes[mainKey]?mainKey:'axial';
    await renderPlane(previewPlane,++planeRenderRevision[previewPlane],+planes[previewPlane].slider.value);
    if(revision!==filterRebuildRevision)return;
    mark3DStale();footer.textContent='2D preview · WEBGPU COMPUTE · '+stages.length+' stage(s)';return;
   }catch(e){
    if(String(e.message||e)==='__SUPERSEDED__')return;
    setMemoryGpuPreviewActive(false);console.warn('In-memory WebGPU preview unavailable; using CPU stack.',e);setGpuComputeBackend('CPU STACK · GPU FAIL','preview: '+String(e?.message||e));
   }finally{setProcessingBusy(false,'WebGPU preview',false)}
  }
  setMemoryGpuPreviewActive(false);clearMemoryFilterPreviewCache();
  for(const key of filterOrder){
   if(!filterState[key])continue;
   await applyCpuFilter(key,base);
   if(revision!==filterRebuildRevision)return;
   base=volume;
  }
  if(!filterOrder.length){
   setVolume(sourceVolume);renderAll();render3D(volume);footer.textContent=tr('original');
  }
 }finally{setDeferAutomatic3D(false);mark3DStale();syncFilterControls()}
}
export function disposeSourceFilterWorkers(){
 const error=new Error('__SUPERSEDED__');
 for(const task of sourceFilterRuntime.queue)task.reject(error);sourceFilterRuntime.queue=[];
 for(const slot of sourceFilterRuntime.workers){if(slot.current)slot.current.reject(error);try{slot.worker.terminate()}catch{}}
 sourceFilterRuntime.workers=[];
}
export function invalidateSourceFilters(){
 sourceFilterRuntime.revision++;incSourceRenderRevision(false);
 sourceFilterRuntime.cache.clear();sourceFilterRuntime.cacheBytes=0;disposeSourceFilterWorkers();
}
export function hasGlobalSegmentProcessing(){
 return SEGMENT_PRESET_ORDER.some(key=>{const s=segmentState[key];return s.active&&s.enabled&&segmentHasProcessedMask(key)});
}
export function currentMainViewKey(){return mainViewSlot?.querySelector('.view-card')?.dataset.viewKey||'3d'}
export const applyVolumeAfterFilterRebuild={value:false};

// 447: HU-based filter parameters. Each slider is in HU with a fixed range and step (FILTER_UNITS). A saved value
// outside that grid (e.g. 1310.7 HU derived from an old project's ratio) is shown as it is: the slider is widened and its
// step released, so the value is neither clamped nor snapped, and a small note says so; the first user input puts the
// standard range back. The TV epsilon has no slider (hidden input, saved with the project).
export function filterUnitInputs(){
 return{spikeHole:{thresholdHU:spikeHoleThreshold},nlm:{hHU:nlmStrength},anisotropic:{kappaHU:anisotropicKappa},tv:{epsHU:tvEps},unsharp:{thresholdHU:unsharpThreshold},bilateral:{sigmaHU:bilateralIntensity}};
}
export function formatHU(v){return String(Math.round(+v*10)/10)}
function unitNote(el,show,def){
 let n=document.getElementById(el.id+'-legacy-note');
 if(!n){if(!show)return;n=document.createElement('div');n.id=el.id+'-legacy-note';n.className='segment-note is-hidden';(el.closest('label')||el).insertAdjacentElement('afterend',n)}
 n.textContent=show?(currentLanguage==='ja'?'古いプロジェクトの値です。動かすと '+def.min+'〜'+def.max+' HU に戻ります':'Value from an old project. Moving the slider returns it to '+def.min+'-'+def.max+' HU'):'';
 n.classList.toggle('is-hidden',!show);
}
export function setFilterUnitControl(key,name,value){
 const el=filterUnitInputs()[key]?.[name],def=FILTER_UNITS[key]?.params?.[name],v=+value;if(!el||!def||!isValidUnitValue(def,v))return;
 if(el.type!=='range'){el.value=String(v);return}
 const q=v/def.step,std=v>=def.min&&v<=def.max&&Math.abs(q-Math.round(q))<1e-9;
 if(std)restoreFilterUnitRange(el);else{el.dataset.unit=key+'.'+name;el.min=String(Math.min(def.min,v));el.max=String(Math.max(def.max,v));el.step='any';el.dataset.widened='1'}
 el.value=String(v);const out=document.getElementById(el.id+'-value');if(out)out.value=formatHU(v);unitNote(el,!std,def);
 el.dataset.loading='1';try{el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}finally{delete el.dataset.loading}
}
export function restoreFilterUnitRange(el){
 if(!el||!el.dataset.widened)return;
 const[key,name]=(el.dataset.unit||'').split('.'),def=FILTER_UNITS[key]?.params?.[name];if(!def)return;
 delete el.dataset.widened;unitNote(el,false,def);
 el.min=String(def.min);el.max=String(def.max);el.step=String(def.step);
 {const q=Math.round(+el.value/def.step)*def.step;el.value=String(Number.isFinite(q)?Math.max(def.min,Math.min(def.max,q)):def.def)}
}
// reset: widened sliders go back to the standard range and the default value; the hidden TV epsilon to its default
export function resetFilterUnitControls(){
 for(const[key,inputs]of Object.entries(filterUnitInputs()))for(const[name,el]of Object.entries(inputs)){
  const def=FILTER_UNITS[key].params[name];
  if(el.type!=='range'){el.value=String(def.def);continue}
  if(el.dataset.widened){restoreFilterUnitRange(el);el.value=String(def.def);const out=document.getElementById(el.id+'-value');if(out)out.value=formatHU(def.def)}
 }
}
