// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { beginSharedMpr3DPreview } from './mpr3d-overlay.js?v=20261019-build623';
import { gpuStepTimes, gpuFilterRuntime, gpuCounts } from './gpu-compute.js?v=20261019-build623';
import { gpuVolumeRefresh, updateVolumeFilterBadge, set3DBusy } from './three-status.js?v=20261019-build623';
import { sourceVolume, volume, sceneState, currentLanguage, threeRenderMode, ipadGpuTargetSide } from './state.js?v=20261019-build623';
import { SEGMENT_PRESET_ORDER, gpuSegmentOrder, segmentEditState, segmentState, segmentHasProcessedMask, segmentAddsVoxels } from './segments.js?v=20261019-build623';
import { request3DRender } from './scene3d.js?v=20261019-build623';
import { footer, volumeCacheClearBtn } from './ui-shell.js?v=20261019-build623';
import { subtractRunArrays, intersectRunArrays } from './run-length.js?v=20261019-build623';
import { tr } from './i18n.js?v=20261019-build623';
import { fmt, isTabletRuntime, isIPhoneRuntime } from './utils.js?v=20261019-build623';
import { openVolumeCache, cacheKey, textureCacheHandle, pruneOtherFilterSettings } from './gpu-volume-cache.js?v=20261019-build623';
import { datasetFingerprint } from './project-file.js?v=20261019-build623';
import { getFilteredSourceAxialBlock, currentFilterSignature, volumeBlockDepth, volumeBlockBudget } from './source-filters.js?v=20261019-build623';
export const gpuVolumeApplied={seriesId:null,signature:''};
export function gpuVolumeDataSignature(){
 const id=(sourceVolume||volume)?.series?.id??null,applied=gpuVolumeApplied.seriesId===id?gpuVolumeApplied.signature:'';
 return applied&&applied===currentFilterSignature()?applied:'';
}
// build 305: the next block is started while the current one is used, so its
// file reads overlap this block's GPU filtering and upload (one block ahead:
// ~2 blocks of memory, within the swap-safe block budget)
export function filteredSourceSliceProvider(series,blockDepth=null,onBlock=null){
 let block=null,start=-1,depth=blockDepth;const pending=new Map(),total=series.slices.length;
 const request=s=>{if(s<0||s>=total)return null;let p=pending.get(s);if(!p){p=getFilteredSourceAxialBlock(s,depth,series,'gpu-volume',volumeBlockBudget());p.catch(()=>{});pending.set(s,p)}return p};
 return async z=>{
  depth=depth||volumeBlockDepth(series);
  if(!block||z<start||z>=start+block.coreDepth){
   start=Math.floor(z/depth)*depth;block=null;
   for(const k of [...pending.keys()])if(k<start)pending.delete(k);
   const current=request(start);request(start+depth);
   block=await current;pending.delete(start);
   if(onBlock&&block){const n=series.rows*series.columns;for(let k=0;k<block.coreDepth;k++)onBlock(start+k,block.data.subarray(k*n,(k+1)*n))}
  }
  const n=series.rows*series.columns,off=(z-start)*n;return block.data.subarray(off,off+n);
 };
}
// build 311: reduced GPU volume upload straight from GPU-packed blocks.
// plan: {tw,th,xs,ys,zMap,rowStride,slope,intercept,bias}; returns tz -> packed
// texture slice (or null to fall back to the float path). preview (optional)
// gets full-res float planes for the z it needs.
export function filteredPackedSliceProvider(series,plan,preview=null){
 const depth=volumeBlockDepth(series),total=series.slices.length,pending=new Map(),need=preview?.needZ||new Set();
 let block=null,start=-1,failed=false;
 const request=s=>{
  if(s<0||s>=total)return null;let p=pending.get(s);if(p)return p;
  const core=Math.min(depth,total-s),tzs=[],rel=[],pz=[];
  for(let tz=0;tz<plan.zMap.length;tz++){const z=plan.zMap[tz];if(z>=s&&z<s+core){tzs.push(tz);rel.push(z-s)}}
  for(let z=s;z<s+core;z++)if(need.has(z))pz.push(z-s);
  p=getFilteredSourceAxialBlock(s,depth,series,'gpu-volume',volumeBlockBudget(),{tw:plan.tw,th:plan.th,xs:plan.xs,ys:plan.ys,rowStride:plan.rowStride,slope:plan.slope,intercept:plan.intercept,bias:plan.bias,zList:rel,previewZ:pz}).then(b=>b&&b.packed?{...b,tzs,pzRel:pz}:null);
  p.catch(()=>{});pending.set(s,p);return p;
 };
 return async tz=>{
  if(failed)return null;
  const z=plan.zMap[tz];
  if(!block||z<start||z>=start+block.coreDepth){
   start=Math.floor(z/depth)*depth;block=null;
   for(const k of [...pending.keys()])if(k<start)pending.delete(k);
   const cur=request(start);request(start+depth);block=await cur;pending.delete(start);
   if(!block){failed=true;return null}
   if(preview){const n=series.rows*series.columns;block.pzRel.forEach((lz,i)=>preview.feed(start+lz,block.preview.subarray(i*n,(i+1)*n)))}
  }
  const i=block.tzs.indexOf(tz);if(i<0)return null;
  return block.packed.subarray(i*block.sliceBytes,(i+1)*block.sliceBytes);
 };
}
export const volumeCacheState={cache:null,failed:false,persistAsked:false};
export async function volumeCache(){
 if(volumeCacheState.cache||volumeCacheState.failed)return volumeCacheState.cache;
 try{volumeCacheState.cache=await openVolumeCache()}catch(e){volumeCacheState.failed=true;console.warn('GPU volume cache unavailable.',e)}
 return volumeCacheState.cache;
}
export async function volumeCacheBudget(){
 // settings > cache: a fixed limit, or auto (below)
 const fixed=+globalThis.__vrlSettings?.get?.('cacheLimit');if(fixed>0)return fixed*2**30;
 const cap=(isTabletRuntime()?1.5:4)*2**30;
 try{const q=(await navigator.storage?.estimate?.())?.quota||0;return Math.max(256*2**20,Math.min(cap,q?q*.3:cap))}catch{return 512*2**20}
}
export function gpuVolumeCacheFor(series,signature){
 return async info=>{
  const cache=await volumeCache();if(!cache)return null;
  const size=info.slices*info.bytesPerSlice,budget=await volumeCacheBudget();
  if(size>budget)return null;
  if(!volumeCacheState.persistAsked){volumeCacheState.persistAsked=true;try{await navigator.storage?.persist?.()}catch{}}
  const key=await cacheKey({dataset:datasetFingerprint(series),filter:signature,plan:info.planSignature,reduced:info.reduced});
  const dataset=datasetFingerprint(series);
  await pruneOtherFilterSettings(cache,{kind:'volume',dataset,plan:info.planSignature,filter:signature},key);
  await cache.prune(budget-size,{keep:key});
  return textureCacheHandle(cache,key,{slices:info.slices,bytesPerSlice:info.bytesPerSlice,info:{kind:'volume',dataset,filter:signature,plan:info.planSignature,description:series.description||''}});
 };
}
export { pruneOtherFilterSettings };
export async function updateVolumeCacheControl(){
 if(!volumeCacheClearBtn)return;
 const available=!!sceneState?.medicalVolume,cache=available?await volumeCache():null,bytes=cache?await cache.usage().catch(()=>0):0;
 volumeCacheClearBtn.classList.toggle('is-hidden',!cache);
 volumeCacheClearBtn.textContent=tr('volumeCacheClear')+(bytes?' · '+fmt(bytes):'');
 volumeCacheClearBtn.disabled=!bytes;
}
export function gpuVolumeTarget(){
 const base=sourceVolume||volume,signature=gpuVolumeDataSignature();
 if(!signature||!base?.sourceBacked||!base.series)return base;
 return{...base,filterSignature:signature,sliceData:filteredSourceSliceProvider(base.series),textureCache:gpuVolumeCacheFor(base.series,signature)};
}
export async function refreshGpuVolumeData(){
 const mv=sceneState?.medicalVolume;
 if(!(threeRenderMode==='volume'&&mv?.active))return;
 const wanted=gpuVolumeDataSignature();
 if((mv.dataSignature||'')===wanted||gpuVolumeRefresh.running===wanted){updateVolumeFilterBadge();return}
 const token=++gpuVolumeRefresh.token,target={...gpuVolumeTarget(),isCancelled:()=>token!==gpuVolumeRefresh.token};
 // build 308: the 3D C/S preview is filled from these filtered blocks
 const preview=target.sliceData&&target.series?beginSharedMpr3DPreview():null;
 if(preview)target.sliceData=filteredSourceSliceProvider(target.series,null,(z,src)=>preview.feed(z,src));
 // build 311: reduced plans upload GPU-packed slices (falls back to sliceData)
 if(target.sliceData&&target.series)target.packedSliceProvider=plan=>filteredPackedSliceProvider(target.series,plan,preview);
 gpuVolumeRefresh.running=wanted;updateVolumeFilterBadge();
 // debug (build 285): total time and per-filter GPU times of the 3D rebuild
 const t0=performance.now();gpuStepTimes.clear();gpuCounts.clear();const errBefore=gpuFilterRuntime.lastError||'';footer.textContent=currentLanguage==='ja'?'3D再構築中…':'Rebuilding 3D…';
 try{await mv.ensure(target,gpuVolumePlanOptions());preview?.finish(true);syncGpuVolumeEdits(target);request3DRender();if(mv.lastCacheHit)footer.textContent=tr('volumeCacheLoaded');void updateVolumeCacheControl()
  // build 306: always replace the start message (it stayed as '3D再構築中…' when debug was off)
  if(!mv.lastCacheHit)footer.textContent=(currentLanguage==='ja'?'3D再構築 完了 ':'3D rebuild done ')+((performance.now()-t0)/1000).toFixed(1)+'s';
  if(globalThis.__vrlSettings?.debugOn?.()&&!mv.lastCacheHit){const steps=[...gpuStepTimes].map(([n,ms])=>n+' '+(ms/1000).toFixed(1)+'s').join(', ');footer.textContent=(currentLanguage==='ja'?'3D再構築 ':'3D rebuild ')+((performance.now()-t0)/1000).toFixed(1)+'s'+(steps?' · ['+steps+']':'')+(gpuCounts.size?' · '+[...gpuCounts].map(([n,c])=>n+' '+c).join(', '):'')}
  // build 291: a GPU filter failure falls back to the CPU worker silently; say so
  const errNow=gpuFilterRuntime.lastError||'';if(errNow&&errNow!==errBefore)footer.textContent+=(currentLanguage==='ja'?' · GPUフィルター失敗→CPU: ':' · GPU filter failed -> CPU: ')+errNow}
 catch(e){preview?.finish(false);if(String(e.message||e)==='__SUPERSEDED__')footer.textContent=currentLanguage==='ja'?'3D再構築: 新しい設定でやり直し中':'3D rebuild: restarted with newer settings';if(String(e.message||e)!=='__SUPERSEDED__'){console.warn('GPU volume filter refresh failed.',e);
  footer.textContent=(currentLanguage==='ja'?'3D再構築エラー（表示は途中まで更新）: ':'3D rebuild error (volume partly updated): ')+String(e?.message||e)+(gpuFilterRuntime.lastError?' · GPU: '+gpuFilterRuntime.lastError:'')}}
 finally{if(token===gpuVolumeRefresh.token){gpuVolumeRefresh.running=null;set3DBusy(false)}updateVolumeFilterBadge()}
}
export function gpuVolumeEditDescriptors(v=sourceVolume||volume){
 const out={};if(!v)return out;
 for(const key of SEGMENT_PRESET_ORDER){
  const st=segmentEditState[key],seg=segmentState[key];if(!st)continue;
  // post-processed segments (Opening, thin-region suppression, ...) and segments below a voxel taker (build 459): the
  // volume shader only thresholds, so show the final voxels as a keep mask. maskOnly (Closing / hole filling can add
  // voxels outside the HU range): the shader decides by the mask alone, as the 2D views do.
  if(seg?.active&&seg.enabled&&segmentHasProcessedMask(key)&&st.baseRuns?.length===v.slices){
   let runs=st.keepRuns?intersectRunArrays(st.baseRuns,st.keepRuns,v.slices):st.baseRuns;
   if(st.excludeRuns)runs=subtractRunArrays(runs,st.excludeRuns,v.slices);
   out[key]={mode:'keep',runs,cutRuns:st.cutRuns,maskOnly:segmentAddsVoxels(seg)};continue;
  }
  if(st.keepRuns){out[key]={mode:'keep',runs:st.excludeRuns?subtractRunArrays(st.keepRuns,st.excludeRuns,v.slices):st.keepRuns,cutRuns:st.cutRuns}}
  else if(st.excludeRuns){out[key]={mode:'exclude',runs:st.excludeRuns,cutRuns:st.cutRuns}}
 }
 return out;
}
// Appends the 3D state to the segment's status line (segment-runs.js owns it;
// DOM access here avoids an import cycle through run-cache.js).
function noteSegment3D(key,text,error){
 const el=typeof document!=='undefined'?document.querySelector('[data-seg-status="'+key+'"]'):null;if(!el||el.classList.contains('is-hidden'))return;
 el.textContent=el.textContent.replace(/ · (3D反映済み|shown in 3D|3D反映エラー: .*|3D error: .*)$/,'')+' · '+text;if(error)el.classList.add('is-error');
}
export function syncGpuVolumeEdits(v=sourceVolume||volume){
 // build 414: the 2D views draw the edited segment from finalRuns, which the volume-view edits reset and nothing
 // rebuilt (2D kept showing deleted voxels): app.js rebuilds them and repaints 2D on this event
 if(v&&typeof document!=='undefined')document.dispatchEvent(new CustomEvent('vrl-gpu-edits-synced'));
 const mv=sceneState?.medicalVolume;if(!mv||!v)return;
 const descs=gpuVolumeEditDescriptors(v),processed=Object.keys(descs).filter(key=>segmentHasProcessedMask(key));
 try{mv.setEditRuns(descs,gpuSegmentOrder(),v);request3DRender();for(const key of processed)noteSegment3D(key,currentLanguage==='ja'?'3D反映済み':'shown in 3D',false)}
 catch(e){console.error(e);footer.textContent=(currentLanguage==='ja'?'GPU編集マスク更新エラー: ':'GPU edit mask error: ')+String(e.message||e);for(const key of processed)noteSegment3D(key,(currentLanguage==='ja'?'3D反映エラー: ':'3D error: ')+String(e.message||e),true)}
}
export function gpuVolumePlanOptions(){
 if(isIPhoneRuntime())return{maxTextureBytes:96*1024*1024,targetInPlane:0};
 // iPad and desktop: 512 by default (Mac GPUs are no faster than an iPad Air
 // for 3D); 768 or full size (0, desktop only) are explicit choices
 return{maxTextureBytes:0,targetInPlane:ipadGpuTargetSide};
}
