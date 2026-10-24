// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { wc, ww, planes, footer, state, wcVal, wwVal } from './ui-shell.js?v=20261023-build664';
import { activeMprSegments, mprSegmentAlpha, analysisRegionShown, segmentEditActive, segmentState, segmentHasProcessedMask, getProcessedSegmentMask, segmentEditState } from './segments.js?v=20261023-build664';
import { volume, volumeAnalysisMode, analysisRegions, analysisFocusedRegionId, sectionViewPlane, memoryGpuPreviewActive, sourceVolume, setMemoryGpuPreviewActive, sceneState, incSourceMprWarmupToken, sourceMprWarmupPlane, setSourceMprWarmupPlane, residentGpuUploadSeriesId, sourceMprWarmupToken, setCrosshairSlice , sectionViewOpen, threeRenderMode} from './state.js?v=20261023-build664';
import { analysisRunsContain, runsPlaneMask } from './run-length.js?v=20261023-build664';
import { mpr3DVisibility, refreshMpr3DPlaneTexture, setSectionCapColors, updateMpr3DPlanePositions, syncMpr3DSliceSliders, mpr3DOrthoSliding, pushCachedMpr3DPlane, mpr3DPreviewCache, mpr3DPreviewSignature, paintMpr3DCacheSliceFast, ensureMpr3DPreviewCache } from './mpr3d-overlay.js?v=20261023-build664';
import { updateSectionClipPlaneWorld, rebindWebGpuSectionClipGroup, updateSectionViewUi } from './section-view.js?v=20261023-build664';
import { request3DRender } from './scene3d.js?v=20261023-build664';
import { planeRenderRevision, sourceFilterStages, getFilteredMemoryPlaneValues, getFilteredSourcePlaneValues, getCachedSourceSlice, sourceFilterSignature, sourceFilterCacheGet, memoryFilterPreviewGet, currentFilterSignature } from './source-filters.js?v=20261023-build664';
import { cachedSagittalDisplayPlane, cachedSourceMprPlane } from './volume-io.js?v=20261023-build664';
import { sourceOrthogonalCacheGet, residentGpuMprAvailable, buildSourceOrthogonalPlane } from './mpr-orthogonal.js?v=20261023-build664';
import { hexRgb, formatCtValue, frameYield } from './utils.js?v=20261023-build664';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { latestOnlyRunner } from './latest-runner.js?v=20261023-build664';
export function analysisColorCss(color){return '#'+Number(color??0x00d8ff).toString(16).padStart(6,'0')}
function resultPlaneLayers(p,idx,full){
 const out=[];if(!volume)return out;
 for(const r of analysisRegions){if(!analysisRegionShown(r)||!r.runsBySlice)continue;const c=Number(r.color??0x00d8ff);
  out.push({runs:r.runsBySlice,keys:r.segmentKeys||[],rgb:[(c>>16)&255,(c>>8)&255,c&255],mask:full?runsPlaneMask(r.runsBySlice,p,idx,volume.columns,volume.rows,volume.slices):null})}
 return out;
}
const sectionCapBuffers={axial:null,coronal:null,sagittal:null};
function paintSectionCap(p,idx,dims,values){
 if(!volume||!sectionViewOpen||sectionViewPlane!==p||threeRenderMode==='volume')return false;
 const [w,h]=dims,n=w*h,C=volume.columns,R=volume.rows,S=volume.slices;
 if(values&&values.length<n)return false;
 let buf=sectionCapBuffers[p];if(!buf||buf.pixels.length!==n)buf=sectionCapBuffers[p]={pixels:new Uint32Array(n),gray:new Uint8Array(n)};
 const out=buf.pixels,gray=buf.gray,low=+wc.value-(+ww.value)/2,scale=255/Math.max(+ww.value,1);
 const full=p==='axial'?w===C&&h===R:p==='coronal'?w===C&&h===S:w===R&&h===S;
 const segs=activeMprSegments();
 for(const item of segs){const runs=item.processedRuns||(segmentEditActive(item.key)&&item.edit.finalRuns)||null;item.planeMask=full&&runs?runsPlaneMask(runs,p,idx,C,R,S):null}
 const layers=resultPlaneLayers(p,idx,full),data=values?null:volume.data;
 for(let py=0,i=0;py<h;py++)for(let px=0;px<w;px++,i++){
  const ix=p==='sagittal'?idx:px,iy=p==='coronal'?idx:(p==='sagittal'?px:py),iz=p==='axial'?idx:S-1-py;
  const v=values?values[i]:data[iz*R*C+iy*C+ix];let c=null;
  gray[i]=Math.max(0,Math.min(255,Math.round((v-low)*scale)));
  for(const item of segs){const {key,seg,edit,processedMask,processedRuns,rgb,planeMask}=item,inside=planeMask?planeMask[i]===1:processedRuns?analysisRunsContain(processedRuns,ix,iy,iz):(segmentEditActive(key)&&edit.finalRuns?analysisRunsContain(edit.finalRuns,ix,iy,iz):(processedMask?processedMask[iz*R*C+iy*C+ix]===1:(v>=seg.min&&v<=seg.max)));if(inside)c=(layers.length&&resultRgbAt(layers,key,i,ix,iy,iz))||rgb}
  out[i]=c?(0xff000000|(Math.round(c[2]*.78+56.1)<<16)|(Math.round(c[1]*.78+56.1)<<8)|Math.round(c[0]*.78+56.1))>>>0:0;
 }
 setSectionCapColors(p,idx,w,h,out,gray);return true;
}
// the section face while sliding, without the 2D view (the GPU volume view does not repaint 2D while sliding either):
// unfiltered values at hand (the memory volume, or the source's cached planes); otherwise the 2D path paints it
function paintSectionFaceSliding(p,idx){
 if(!volume||sourceFilterStages().length||memoryGpuPreviewActive)return false;
 const dims=p==='axial'?[volume.columns,volume.rows]:p==='coronal'?[volume.columns,volume.slices]:[volume.rows,volume.slices];
 if(!volume.sourceBacked)return volume.data?paintSectionCap(p,idx,dims,null):false;
 const values=cachedSourceMprPlane(volume,p,idx);
 return values?paintSectionCap(p,idx,dims,values):false;
}
function resultRgbAt(layers,key,i,ix,iy,iz){let c=null;for(const L of layers){if(!L.keys.includes(key))continue;if(L.mask?L.mask[i]===1:analysisRunsContain(L.runs,ix,iy,iz))c=L.rgb}return c}
export function drawAnalysisOverlay(p,idx,ctx){
 if(!volumeAnalysisMode||!analysisRegions.length||!ctx)return;
 const d=volume?.slices||0;
 ctx.save();
 for(const region of analysisRegions){
  if(!analysisRegionShown(region))continue;
  const css=analysisColorCss(region.color),focused=region.id===analysisFocusedRegionId;
  if(!focused)continue;ctx.fillStyle='rgba(0,0,0,0)';ctx.strokeStyle=css;ctx.lineWidth=2;
  if(p==='axial'){
   const rec=region.runsBySlice?.[idx];if(!rec)continue;
   for(let i=0;i<rec.length;i+=3){const y=rec[i],x0=rec[i+1],x1=rec[i+2];ctx.strokeRect(x0-.5,y-.5,x1-x0+1,1)}
  }else if(p==='coronal'){
   for(let z=0;z<d;z++){const rec=region.runsBySlice?.[z];if(!rec)continue;const py=d-1-z;for(let i=0;i<rec.length;i+=3)if(rec[i]===idx){ctx.strokeRect(rec[i+1]-.5,py-.5,rec[i+2]-rec[i+1]+1,1)}}
  }else{
   for(let z=0;z<d;z++){const rec=region.runsBySlice?.[z];if(!rec)continue;const py=d-1-z;for(let i=0;i<rec.length;i+=3)if(idx>=rec[i+1]&&idx<=rec[i+2]){const y=rec[i];ctx.strokeRect(y-.5,py-.5,1,1)}}
  }
 }
 ctx.restore();
}
export const planeRenderTimers={axial:null,coronal:null,sagittal:null};
export const orthogonalHighResPrefetch={coronal:{running:false,next:null},sagittal:{running:false,next:null}};
export function prefetchOrthogonalHighRes(p,idx){
 if((p!=='coronal'&&p!=='sagittal')||!volume?.sourceBacked||sourceFilterStages().length||residentGpuMprAvailable(volume)||volume.mprData||(p==='sagittal'&&(volume.mprSagittalAll||volume.mprSagittalDisplayAll)))return;
 const state=orthogonalHighResPrefetch[p];state.next=idx;if(state.running)return;state.running=true;
 void(async()=>{
  try{
   while(state.next!=null&&volume?.sourceBacked){
    const target=state.next;state.next=null;
    try{await buildSourceOrthogonalPlane(p,target,volume.series,null)}catch(e){if(String(e.message||e)!=='__SUPERSEDED__')console.warn('MPR high-res prefetch failed.',p,e)}
   }
  }finally{state.running=false}
 })();
}
export function paintFastOrthogonalPreview(p,idx){
 if(p==='axial'||!volume?.sourceBacked||sourceFilterStages().length||volumeAnalysisMode)return false;
 if(mpr3DPreviewCache.signature!==mpr3DPreviewSignature(volume)||!mpr3DPreviewCache.planes[p])return false;
 const ok=paintMpr3DCacheSliceFast(p,idx,planes[p].canvas);
 if(ok)updateMprCanvasPhysicalAspect(p);
 return ok;
}
export function paintResidentCachedMprPreview(p,idx,filteredOk=false){
 // filteredOk: the GPU texture holds the current filters (see gpuVolumeShowsCurrentFilters)
 if((p==='axial'&&!filteredOk)||!residentGpuMprAvailable(volume)||(sourceFilterStages().length&&!filteredOk)||volumeAnalysisMode)return false;
 const mv=sceneState?.medicalVolume,result=mv?.previewPlane?.(volume,p,idx);if(!result?.values)return false;
 const dims=result.dims,canvas=planes[p].canvas,ctx=canvas.getContext('2d');
 if(canvas.width!==dims[0])canvas.width=dims[0];if(canvas.height!==dims[1])canvas.height=dims[1];
 const image=ctx.createImageData(dims[0],dims[1]),pixels=new Uint32Array(image.data.buffer),values=result.values,cal=result.calibration||{slope:1,intercept:0,signedBias:0},low=+wc.value-(+ww.value)/2,scale=255/Math.max(+ww.value,1);
 for(let i=0;i<values.length;i++){const hu=(values[i]-cal.signedBias)*cal.slope+cal.intercept,g=Math.max(0,Math.min(255,Math.round((hu-low)*scale)));pixels[i]=(255<<24)|(g<<16)|(g<<8)|g}
 ctx.putImageData(image,0,0);updateMprCanvasPhysicalAspect(p);
 const entry=sceneState?.mprPlaneEntries?.[p];
 if(entry&&mpr3DVisibility[p]){
  const [tw,th]=dims;
  if(!entry.liveTexture||entry.liveTexture.image?.width!==tw||entry.liveTexture.image?.height!==th){
   entry.liveTexture?.dispose?.();entry.liveData=new Uint8Array(tw*th*4);entry.livePixels=new Uint32Array(entry.liveData.buffer);
   entry.liveTexture=new THREE.DataTexture(entry.liveData,tw,th,THREE.RGBAFormat,THREE.UnsignedByteType);entry.liveTexture.minFilter=THREE.LinearFilter;entry.liveTexture.magFilter=THREE.LinearFilter;entry.liveTexture.generateMipmaps=false;entry.liveTexture.flipY=true;
  }
  entry.liveData.set(image.data);entry.liveTexture.needsUpdate=true;
  if(entry.mesh.material.map!==entry.liveTexture){entry.mesh.material.map=entry.liveTexture;entry.mesh.material.needsUpdate=true}
  request3DRender();
 }
 return true;
}
export function gpuVolumeShowsCurrentFilters(){const mv=sceneState?.medicalVolume,sig=currentFilterSignature();return!!sig&&mv?.dataSignature===sig}
export function filteredPlaneDims(p){
 const v=volume?.sourceBacked?{columns:volume.series.columns,rows:volume.series.rows,slices:volume.series.slices.length}:sourceVolume;
 if(!v)return null;return p==='axial'?[v.columns,v.rows]:p==='coronal'?[v.columns,v.slices]:[v.rows,v.slices];
}
export function paintInstantPlaneWhileSliding(p,idx){
 const v=volume;if(!v)return null;
 const key=sourceFilterSignature(sourceFilterStages())+'|'+p+'|'+idx;
 const hit=v.sourceBacked?sourceFilterCacheGet(key):(memoryGpuPreviewActive?memoryFilterPreviewGet(key):null),dims=filteredPlaneDims(p);
 if(hit&&dims){paintSourcePlane(planes[p],dims,hit,p,idx);return'filtered'}
 if(gpuVolumeShowsCurrentFilters()&&paintResidentCachedMprPreview(p,idx,true))return'filtered-gpu';
 if(p!=='axial'&&v.sourceBacked){
  for(const[sig,kind]of[[mpr3DPreviewSignature(v),'filtered-preview'],[mpr3DPreviewSignature(v,[]),'original-preview']]){
   if(mpr3DPreviewCache.signature===sig&&mpr3DPreviewCache.planes[p]&&paintMpr3DCacheSliceFast(p,idx,planes[p].canvas)){updateMprCanvasPhysicalAspect(p);return kind}
  }
 }
 if(v.sourceBacked&&(v.mprData||(p==='sagittal'&&(v.mprSagittalAll||v.mprSagittalDisplayAll)))){
  const values=p==='sagittal'&&v.mprSagittalDisplayAll&&!v.mprSagittalAll?cachedSagittalDisplayPlane(v,idx):cachedSourceMprPlane(v,p,idx);
  if(values&&dims){paintSourcePlane(planes[p],dims,values,p,idx);return'original'}
 }
 return null;
}
export function perSliceFilteredActive(){return!!sourceFilterStages().length&&(memoryGpuPreviewActive||!!volume?.sourceBacked)}
export const filteredPlaneRunners=Object.fromEntries(['axial','coronal','sagittal'].map(p=>[p,latestOnlyRunner(async()=>{
 const idx=+planes[p].slider.value,revision=++planeRenderRevision[p];await renderPlane(p,revision,idx);
},e=>{if(String(e.message||e)!=='__SUPERSEDED__')console.warn('MPR render failed.',e)})]));
// While a filtered plane's slider moves and nothing instant is cached, read the
// plane from the GPU volume when its texture holds the current filters (the
// same data the 3D view shows; reduced resolution on iPad). One latest-only
// read per plane; the full-resolution filtered slice is rendered on release.
export const gpuSlidePreviewRunners=Object.fromEntries(['axial','coronal','sagittal'].map(p=>[p,latestOnlyRunner(async()=>{
 const idx=+planes[p].slider.value,revision=++planeRenderRevision[p],target=sourceVolume||volume,mv=sceneState?.medicalVolume;
 const t0=performance.now(),result=await mv?.extractPlane?.(target,p,idx,{allowReduced:true});
 if(!result?.values){reportSlidePath(p,'gpu-read-empty');return}
 if(revision!==planeRenderRevision[p])return;
 const t1=performance.now();paintSourcePlane(planes[p],result.dims,result.values,p,idx);reportSlidePath(p,'gpu read '+Math.round(t1-t0)+' ms · paint '+Math.round(performance.now()-t1)+' ms');
},e=>{if(String(e.message||e)!=='__SUPERSEDED__')console.warn('GPU slide preview failed.',e)})]));
// Not gated on residentGpuMprAvailable: that flag is also set on purpose for
// reduced textures (exact readback must not use them), which is exactly the
// iPad case this preview is for; it never caches its values as exact.
function gpuSlidePreviewAvailable(){const target=sourceVolume||volume;return!!target?.sourceBacked&&gpuVolumeShowsCurrentFilters()&&!!sceneState?.medicalVolume?.hasResident?.(target)}
// Diagnostic for device checks (CI has no GPU; open with ?debug): while a filtered
// slider moves, the footer names the source of the 2D image, or why the GPU volume was not used.
function gpuSlideUnavailableReason(){
 const target=sourceVolume||volume,mv=sceneState?.medicalVolume;
 if(!target?.sourceBacked)return'not source-backed';
 if(!mv?.texture)return'no GPU volume';
 if(!mv.hasResident?.(target))return'GPU volume is another series';
 if((mv.dataSignature||'')!==currentFilterSignature())return'GPU volume filters differ ('+(mv.dataSignature?'other filters':'unfiltered')+')';
 return'?';
}
const SLIDE_PATH_DEBUG=()=>!!globalThis.__vrlSettings?.debugOn?.()||(typeof location!=='undefined'&&/[?&]debug(\b|=|&|$)/.test(location.search));
function reportSlidePath(p,path){if(SLIDE_PATH_DEBUG())footer.textContent='2D '+p+' while sliding: '+path}
export function schedulePlaneRender(p,immediate=false){
 cancelSourceMprWarmup();updateMpr3DPlanePositions();clearTimeout(planeRenderTimers[p]);
 const idx=+planes[p].slider.value;planes[p].label.textContent=idx+1;syncMpr3DSliceSliders();document.dispatchEvent(new Event('vrl-slicechange'));
 setCrosshairSlice(p,idx,'slider-'+p); // linked crosshair: a moved slider changes that coordinate (no-op while hidden)
 if(p==='coronal'||p==='sagittal'){mpr3DOrthoSliding[p]=!immediate;if(!immediate){pushCachedMpr3DPlane(p,idx);prefetchOrthogonalHighRes(p,idx)}}
 if(sectionViewPlane===p){updateSectionClipPlaneWorld();rebindWebGpuSectionClipGroup();updateSectionViewUi();request3DRender()}
 // Filtered planes are computed per slice on the GPU (expensive). While the
 // slider moves, render the latest slice one at a time: 2D and the 3D planes
 // (axial 3D copies the 2D canvas) keep following in real time, and no filter
 // work piles up. (A 90 ms debounce here,, froze them during drags.)
 if(!immediate&&perSliceFilteredActive()){
  // an instant image supersedes any older slice still being filtered (bumping
  // the revision makes that render skip its paint)
  // One source while sliding: when the GPU volume holds the current filters,
  // every drag step reads from it (mixing cached full-res, low-res preview and
  // unfiltered images step by step flickered).
  if(gpuSlidePreviewAvailable()){gpuSlidePreviewRunners[p]();return}
  const instant=paintInstantPlaneWhileSliding(p,idx);
  if(instant){planeRenderRevision[p]++;reportSlidePath(p,instant)}
  else{reportSlidePath(p,'full-resolution filter (GPU volume not used: '+gpuSlideUnavailableReason()+')');filteredPlaneRunners[p]()}
  return;
 }
 const revision=++planeRenderRevision[p];
 if(!immediate&&paintFastOrthogonalPreview(p,idx))return;
 if(!immediate&&paintResidentCachedMprPreview(p,idx))return;
 if(p==='axial')refreshMpr3DPlaneTexture(p);
 if(volume?.sourceBacked&&!sourceFilterStages().length&&(volume.mprData||(p==='sagittal'&&(volume.mprSagittalAll||volume.mprSagittalDisplayAll)))){
  const values=p==='sagittal'&&volume.mprSagittalDisplayAll&&!volume.mprSagittalAll?cachedSagittalDisplayPlane(volume,idx):cachedSourceMprPlane(volume,p,idx),dims=p==='axial'?[volume.columns,volume.rows]:p==='coronal'?[volume.columns,volume.slices]:[volume.rows,volume.slices];
  if(values){paintSourcePlane(planes[p],dims,values,p,idx);return}
 }
 if(volume?.sourceBacked&&p!=='axial'&&!sourceFilterStages().length){
  const cached=sourceOrthogonalCacheGet(p,idx);
  if(cached){paintSourcePlane(planes[p],p==='coronal'?[volume.columns,volume.slices]:[volume.rows,volume.slices],cached,p,idx);return}
 }
 const wait=immediate||p==='axial'?0:sourceFilterStages().length?16:residentGpuMprAvailable(volume)?16:0;
 planeRenderTimers[p]=setTimeout(()=>{planeRenderTimers[p]=null;if(revision===planeRenderRevision[p])safeRenderPlane(p,revision,idx)},wait);
}
export async function buildSourceOrthogonalNeighborhood(p,idx,series,revision){
 return buildSourceOrthogonalPlane(p,idx,series,revision);
}
export async function renderPlaneMemoryFiltered(p,revision,idx){
 const c=planes[p];c.label.textContent=idx+1;if(revision!==planeRenderRevision[p])return;
 try{
  const values=await getFilteredMemoryPlaneValues(p,idx,sourceVolume,revision);
  if(revision!==planeRenderRevision[p])return;
  const dims=p==='axial'?[sourceVolume.columns,sourceVolume.rows]:p==='coronal'?[sourceVolume.columns,sourceVolume.slices]:[sourceVolume.rows,sourceVolume.slices];
  paintSourcePlane(c,dims,values,p,idx);
 }catch(e){
  if(String(e.message||e)==='__SUPERSEDED__')return;
  console.warn('GPU MPR preview failed.',e);setMemoryGpuPreviewActive(false);throw e;
 }
}
export function cancelSourceMprWarmup(){
 incSourceMprWarmupToken(false);
 if(sourceMprWarmupPlane){planeRenderRevision[sourceMprWarmupPlane]++;setSourceMprWarmupPlane(null)}
}
export function safeRenderPlane(p,revision=null,idx=null){
 if(revision==null)revision=++planeRenderRevision[p];
 if(idx==null)idx=+planes[p].slider.value;
 void renderPlane(p,revision,idx).catch(e=>{if(String(e.message||e)!=='__SUPERSEDED__'){console.warn('MPR render failed.',e);footer.textContent='MPR error: '+String(e.message||e)}});
}
export async function renderPlane(p,revision,idx){
 if(!volume||revision!==planeRenderRevision[p])return;
 if(p!=='axial')sectionFaceEpoch[p]++;
 updateMprCanvasPhysicalAspect(p);
 if(volume.sourceBacked)return renderPlaneSourceBacked(p,revision,idx);
 if(memoryGpuPreviewActive&&sourceFilterStages().length)return renderPlaneMemoryFiltered(p,revision,idx);
 const c=planes[p];c.label.textContent=idx+1;
 const dims=p==='axial'?[volume.columns,volume.rows]:p==='coronal'?[volume.columns,volume.slices]:[volume.rows,volume.slices],ctx=c.canvas.getContext('2d');if(c.canvas.width!==dims[0])c.canvas.width=dims[0];if(c.canvas.height!==dims[1])c.canvas.height=dims[1];
 const img=reusableMprImage(p,ctx,dims),values=volume.mprData?cachedSourceMprPlane(volume,p,idx):null,low=+wc.value-(+ww.value)/2,scale=255/Math.max(+ww.value,1);let q=0;
 const layers=resultPlaneLayers(p,idx,true);
 const segOrder=['lung','fat','soft','bone','contrast'],segMasks={};for(const key of segOrder){const seg=segmentState[key];if(seg.active&&seg.enabled&&segmentHasProcessedMask(key))segMasks[key]=getProcessedSegmentMask(volume,seg,key)}
 for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
  let v;if(values)v=values[y*dims[0]+x];else if(p==='axial')v=volume.data[idx*volume.rows*volume.columns+y*volume.columns+x];else if(p==='coronal'){const z=volume.slices-1-y;v=volume.data[z*volume.rows*volume.columns+idx*volume.columns+x]}else{const z=volume.slices-1-y;v=volume.data[z*volume.rows*volume.columns+x*volume.columns+idx]}
  const g=Math.max(0,Math.min(255,Math.round((v-low)*scale)));let rr=g,gg=g,bb=g;
  const voxelIndex=p==='axial'?idx*volume.rows*volume.columns+y*volume.columns+x:p==='coronal'?(volume.slices-1-y)*volume.rows*volume.columns+idx*volume.columns+x:(volume.slices-1-y)*volume.rows*volume.columns+x*volume.columns+idx;
  const ix=p==='sagittal'?idx:x,iy=p==='coronal'?idx:(p==='sagittal'?x:y),iz=p==='axial'?idx:volume.slices-1-y;
  for(const key of segOrder){const seg=segmentState[key],mask=segMasks[key],edit=segmentEditState[key];if(!seg.active||!seg.enabled)continue;const inside=segmentEditActive(key)&&edit.finalRuns?analysisRunsContain(edit.finalRuns,ix,iy,iz):(mask?mask[voxelIndex]===1:(v>=seg.min&&v<=seg.max));if(!inside)continue;const rgb=(layers.length&&resultRgbAt(layers,key,q>>2,ix,iy,iz))||hexRgb(seg.color),a=mprSegmentAlpha(seg);rr=Math.round(rr*(1-a)+rgb[0]*a);gg=Math.round(gg*(1-a)+rgb[1]*a);bb=Math.round(bb*(1-a)+rgb[2]*a)}
  img.data[q++]=rr;img.data[q++]=gg;img.data[q++]=bb;img.data[q++]=255
 }
 ctx.putImageData(img,0,0);drawAnalysisOverlay(p,idx,ctx);refreshMpr3DPlaneTexture(p);paintSectionCap(p,idx,dims,values)
}
export const mprPaintCache={axial:null,coronal:null,sagittal:null};
export function reusableMprImage(p,ctx,dims){
 let cache=mprPaintCache[p];
 if(!cache||cache.width!==dims[0]||cache.height!==dims[1]){
  cache={width:dims[0],height:dims[1],image:ctx.createImageData(dims[0],dims[1])};mprPaintCache[p]=cache;
 }
 return cache.image;
}
export function paintSourcePlane(c,dims,values,p='axial',idx=0){
 const started=performance.now();updateMprCanvasPhysicalAspect(p);
 const ctx=c.canvas.getContext('2d');if(c.canvas.width!==dims[0])c.canvas.width=dims[0];if(c.canvas.height!==dims[1])c.canvas.height=dims[1];
 const img=reusableMprImage(p,ctx,dims),pixels=new Uint32Array(img.data.buffer),low=+wc.value-(+ww.value)/2,scale=255/Math.max(+ww.value,1),activeSegs=activeMprSegments(),simple=!analysisRegions.some(r=>r.visible!==false&&r.runsBySlice)&&activeSegs.every(item=>!item.processedMask&&!item.processedRuns&&!(segmentEditActive(item.key)&&item.edit.finalRuns));
 if(simple){
  const segs=activeSegs.map(item=>({min:item.seg.min,max:item.seg.max,a:item.alpha,ia:1-item.alpha,r:item.rgb[0],g:item.rgb[1],b:item.rgb[2]})),n=values.length;
  for(let i=0;i<n;i++){
   const v=values[i];let g=Math.max(0,Math.min(255,Math.round((v-low)*scale))),rr=g,gg=g,bb=g;
   for(let s=0;s<segs.length;s++){const q=segs[s];if(v<q.min||v>q.max)continue;rr=Math.round(rr*q.ia+q.r*q.a);gg=Math.round(gg*q.ia+q.g*q.a);bb=Math.round(bb*q.ia+q.b*q.a)}
   pixels[i]=(255<<24)|(bb<<16)|(gg<<8)|rr;
  }
 }else{
  // per-plane masks of the run sets (full-resolution planes only)
  const full=p==='axial'?dims[0]===volume.columns&&dims[1]===volume.rows:p==='coronal'?dims[0]===volume.columns&&dims[1]===volume.slices:dims[0]===volume.rows&&dims[1]===volume.slices;
  for(const item of activeSegs){const runs=item.processedRuns||(segmentEditActive(item.key)&&item.edit.finalRuns)||null;item.planeMask=full&&runs?runsPlaneMask(runs,p,idx,volume.columns,volume.rows,volume.slices):null}
  const layers=resultPlaneLayers(p,idx,full);
  let i=0;
  for(let py=0;py<dims[1];py++)for(let px=0;px<dims[0];px++,i++){
   const v=values[i],g=Math.max(0,Math.min(255,Math.round((v-low)*scale)));let rr=g,gg=g,bb=g;
   const ix=p==='sagittal'?idx:px,iy=p==='coronal'?idx:(p==='sagittal'?px:py),iz=p==='axial'?idx:(volume.slices-1-py);
   for(const item of activeSegs){const {key,seg,edit,processedMask,processedRuns,rgb,alpha,planeMask}=item,inside=planeMask?planeMask[i]===1:processedRuns?analysisRunsContain(processedRuns,ix,iy,iz):(segmentEditActive(key)&&edit.finalRuns?analysisRunsContain(edit.finalRuns,ix,iy,iz):(processedMask?processedMask[iz*volume.rows*volume.columns+iy*volume.columns+ix]===1:(v>=seg.min&&v<=seg.max)));if(!inside)continue;const cr=(layers.length&&resultRgbAt(layers,key,i,ix,iy,iz))||rgb;rr=Math.round(rr*(1-alpha)+cr[0]*alpha);gg=Math.round(gg*(1-alpha)+cr[1]*alpha);bb=Math.round(bb*(1-alpha)+cr[2]*alpha)}
   pixels[i]=(255<<24)|(bb<<16)|(gg<<8)|rr;
  }
 }
 ctx.putImageData(img,0,0);drawAnalysisOverlay(p,idx,ctx);
 if(p==='axial'||mpr3DVisibility[p])refreshMpr3DPlaneTexture(p);
 paintSectionCap(p,idx,dims,values);
 return performance.now()-started;
}
export async function renderPlaneSourceBacked(p,revision,idx){
 const c=planes[p],series=volume.series;c.label.textContent=idx+1;if(revision!==planeRenderRevision[p])return;
 try{
  if(!sourceFilterStages().length&&(volume.mprData||(p==='sagittal'&&(volume.mprSagittalAll||volume.mprSagittalDisplayAll)))){
   const values=p==='sagittal'&&volume.mprSagittalDisplayAll&&!volume.mprSagittalAll?cachedSagittalDisplayPlane(volume,idx):cachedSourceMprPlane(volume,p,idx);if(revision!==planeRenderRevision[p]||!values)return;
   const dims=p==='axial'?[series.columns,series.rows]:p==='coronal'?[series.columns,series.slices.length]:[series.rows,series.slices.length];
   paintSourcePlane(c,dims,values,p,idx);return;
  }
  if(sourceFilterStages().length){
   const values=await getFilteredSourcePlaneValues(p,idx,series,'mpr:'+p,revision);
   if(revision!==planeRenderRevision[p])return;
   const dims=p==='axial'?[series.columns,series.rows]:p==='coronal'?[series.columns,series.slices.length]:[series.rows,series.slices.length];
   paintSourcePlane(c,dims,values,p,idx);return;
  }
  if(p==='axial'){
   const values=await getCachedSourceSlice(series.slices[idx]);if(revision!==planeRenderRevision[p])return;
   paintSourcePlane(c,[series.columns,series.rows],values,p,idx);return;
  }
  const gpuStart=performance.now(),values=await buildSourceOrthogonalNeighborhood(p,idx,series,revision),gpuMs=performance.now()-gpuStart;if(revision!==planeRenderRevision[p]||!values)return;
  const paintMs=paintSourcePlane(c,p==='coronal'?[series.columns,series.slices.length]:[series.rows,series.slices.length],values,p,idx);
  if(p==='sagittal')console.debug('[VRL S MPR] extract='+gpuMs.toFixed(1)+'ms paint='+paintMs.toFixed(1)+'ms total='+(gpuMs+paintMs).toFixed(1)+'ms');
 }catch(e){if(String(e.message||e)!=='__SUPERSEDED__'){console.error(e);footer.textContent='MPR read error: '+String(e.message||e)}}
}
export function updateMprCanvasPhysicalAspect(p){
 if(!volume||!planes[p]?.canvas)return;
 const w=volume.columns,h=volume.rows,d=volume.slices,[sx,sy,sz]=volume.spacing;
 const physical=p==='axial'?[w*sx,h*sy]:p==='coronal'?[w*sx,d*sz]:[h*sy,d*sz];
 const canvas=planes[p].canvas,parent=canvas.parentElement,ratio=physical[0]/Math.max(physical[1],1e-12),rect=parent?.getBoundingClientRect?.();
 let displayW=rect?.width||0,displayH=displayW/Math.max(ratio,1e-12);
 if(rect?.height>0&&displayH>rect.height){displayH=rect.height;displayW=displayH*ratio}
 canvas.style.aspectRatio=String(ratio);canvas.style.position='absolute';canvas.style.inset='0';canvas.style.margin='auto';canvas.style.objectFit='fill';
 if(displayW>0&&displayH>0){canvas.style.width=displayW+'px';canvas.style.height=displayH+'px'}else{canvas.style.width='100%';canvas.style.height='100%'}
 canvas.style.maxWidth='100%';canvas.style.maxHeight='100%';
}
export function scheduleSourceMprWarmup(){
 if(!volume?.sourceBacked||residentGpuUploadSeriesId===volume?.series?.id||residentGpuMprAvailable(volume))return;
 const token=incSourceMprWarmupToken(true);
 const run=async()=>{
  if(token!==sourceMprWarmupToken||!volume?.sourceBacked)return;
  await ensureMpr3DPreviewCache();
  if(token!==sourceMprWarmupToken||!volume?.sourceBacked||sourceFilterStages().length)return;
  for(const p of ['coronal','sagittal']){
   if(token!==sourceMprWarmupToken)return;
   const idx=+planes[p].slider.value,max=p==='coronal'?volume.rows-1:volume.columns-1;
   setSourceMprWarmupPlane(p);
   if(!sourceOrthogonalCacheGet(p,idx)){
    const revision=++planeRenderRevision[p];
    try{await renderPlane(p,revision,idx)}catch(e){if(String(e.message||e)!=='__SUPERSEDED__')console.warn('MPR warmup failed.',e)}
   }
   if(sourceMprWarmupPlane===p)setSourceMprWarmupPlane(null);
   const idleRevision=planeRenderRevision[p];
   for(const offset of [-1,1,-2,2]){
    if(token!==sourceMprWarmupToken||idleRevision!==planeRenderRevision[p])return;
    const near=idx+offset;if(near<0||near>max||sourceOrthogonalCacheGet(p,near))continue;
    try{await buildSourceOrthogonalPlane(p,near,volume.series,idleRevision)}catch(e){if(String(e.message||e)==='__SUPERSEDED__')return;console.warn('MPR neighbor warmup failed.',e);break}
    await frameYield();
   }
  }
 };
 if('requestIdleCallback' in window)requestIdleCallback(()=>void run(),{timeout:900});
 else setTimeout(()=>void run(),180);
}
export function renderAll(){
 if(!volume)return;
 wcVal.value=formatCtValue(+wc.value,+wc.step);wwVal.value=formatCtValue(+ww.value,+ww.step);
 if(volume.sourceBacked&&!sourceFilterStages().length&&(volume.mprData||residentGpuMprAvailable(volume))){
  for(const p of Object.keys(planes))safeRenderPlane(p);
  return;
 }
 if(volume.sourceBacked&&!sourceFilterStages().length){
  safeRenderPlane('axial');
  for(const p of ['coronal','sagittal']){
   const idx=+planes[p].slider.value,cached=sourceOrthogonalCacheGet(p,idx);
   if(cached)paintSourcePlane(planes[p],p==='coronal'?[volume.columns,volume.slices]:[volume.rows,volume.slices],cached,p,idx);
  }
  scheduleSourceMprWarmup();return;
 }
 for(const p of Object.keys(planes))safeRenderPlane(p);
}
export function renderSectionPlaneLive(p,settle=false){
 if(!volume||!planes[p])return;
 cancelSourceMprWarmup();clearTimeout(planeRenderTimers[p]);planeRenderTimers[p]=null;
 const idx=+planes[p].slider.value,revision=++planeRenderRevision[p];planes[p].label.textContent=idx+1;document.dispatchEvent(new Event('vrl-slicechange'));
 setCrosshairSlice(p,idx,'section-'+p);
 if(sectionLiveFrame){cancelAnimationFrame(sectionLiveFrame);sectionLiveFrame=0}
 if(settle){paintSectionPlane(p,revision,idx,false);return}
 sectionLiveFrame=requestAnimationFrame(()=>{sectionLiveFrame=0;if(revision!==planeRenderRevision[p])return;
  const t0=performance.now();
  if(threeRenderMode!=='volume'&&paintSectionFaceSliding(p,idx)){reportSlidePath(p,'section face '+(performance.now()-t0).toFixed(1)+' ms');return}
  paintSectionPlane(p,revision,idx,true);reportSlidePath(p,'section 2D '+(performance.now()-t0).toFixed(1)+' ms')});
}
let sectionLiveFrame=0;
const sectionFaceEpoch={coronal:0,sagittal:0};
function sectionFaceLiveApplies(p){
 return(p==='coronal'||p==='sagittal')&&threeRenderMode!=='volume'&&sectionViewOpen&&sectionViewPlane===p&&!!volume?.sourceBacked&&!sourceFilterStages().length&&!memoryGpuPreviewActive;
}
const sectionFaceRunners=Object.fromEntries(['coronal','sagittal'].map(p=>[p,latestOnlyRunner(async()=>{
 if(!sectionFaceLiveApplies(p))return;
 const idx=+planes[p].slider.value,epoch=sectionFaceEpoch[p],series=volume.series,target=sourceVolume||volume,mv=sceneState?.medicalVolume,t0=performance.now();
 let values=null,dims=null;
 if(mv?.hasResident?.(target)&&mv.extractPlane){const result=await mv.extractPlane(target,p,idx,{allowReduced:true});values=result?.values||null;dims=result?.dims||null}
 if(!values){values=await buildSourceOrthogonalPlane(p,idx,series,0);dims=p==='coronal'?[series.columns,series.slices.length]:[series.rows,series.slices.length]}
 if(!values||epoch!==sectionFaceEpoch[p]||!sectionFaceLiveApplies(p))return;
 const t1=performance.now();paintSourcePlane(planes[p],dims,values,p,idx);reportSlidePath(p,'section face read '+Math.round(t1-t0)+' ms · paint '+Math.round(performance.now()-t1)+' ms');
 // the slider moved on while this was read: go on at once (not only on the next frame) with its position now
 if(+planes[p].slider.value!==idx)sectionFaceRunners[p]();
},e=>{if(String(e.message||e)!=='__SUPERSEDED__')console.warn('Section face live paint failed.',e)})]));
function paintSectionPlane(p,revision,idx,fast){
 if(p==='coronal'||p==='sagittal')pushCachedMpr3DPlane(p,idx);
 const live=fast&&sectionFaceLiveApplies(p);
 if(fast&&paintFastOrthogonalPreview(p,idx)){if(live)sectionFaceRunners[p]();return}
 if(live){sectionFaceRunners[p]();return}
 void renderPlane(p,revision,idx).catch(e=>{if(String(e.message||e)!=='__SUPERSEDED__'){console.warn('Live section render failed.',e);footer.textContent='MPR error: '+String(e.message||e)}});
}
