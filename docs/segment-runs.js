// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { segmentState, segmentNeedsGlobalMask, sourceMprMemoryView, sourceMemoryUsable, getProcessedSegmentMask, segmentEditState, segmentSourcesOf, segmentSourceSignature, segmentHasManualEditsUpstream, segmentEditGen, segmentKeyOf, segmentAddsVoxels } from './segments.js?v=20261023-build661';
import { activeId, filterRebuildRevision, current3DVolume, volume, currentLanguage } from './state.js?v=20261023-build661';
import { sourceFilterRuntime, sourceFilterSignature, sourceFilterStages, sourceFilterHalo, readSourceRegion, runSourceFilterWorker, fitSourceTile, getCachedSourceSlice } from './source-filters.js?v=20261023-build661';
import { gpuOpenRuns, gpuCounts, gpuStepTimes, gpuRunInfo, addGpuStepTime, ensureGpuFilterDevice, gpuValidationScope, setGpuComputeBackend, runGpuSourceFilters, gpuFilterRuntime, gpuStagesSupported, beginGpuBufferRetention, endGpuBufferRetention } from './gpu-compute.js?v=20261023-build661';
import { isNativeDicomTransferSyntax } from './dicom.js?v=20261023-build661';
import { extractSourceThresholdRuns } from './medical-volume.js?v=20261023-build661';
import { valuesToSegmentBits } from './mask-ops.js?v=20261023-build661';
import { state } from './ui-shell.js?v=20261023-build661';
import dicomParser from 'https://esm.sh/dicom-parser@1.8.21';
import { analysisRunsVoxelCount, unionRunArrays, maskToAnalysisRuns, postprocessSourceRuns, thinSuppressSourceRuns, intersectRunArrays, subtractRunArrays } from './run-length.js?v=20261023-build661';
import { frameYield } from './utils.js?v=20261023-build661';
import { BODY_MIN_HU } from './thin-suppress.js?v=20261023-build661';
import { setProcessingBusy } from './busy.js?v=20261023-build661';
import { reportBusyProgress } from './progress-modal.js?v=20261023-build661';
import { segmentRunsCacheKey, segmentRunsCacheInfo, loadCachedSegmentRuns, storeCachedSegmentRuns } from './run-cache.js?v=20261023-build661';
export async function processSourceRegionMasks(series,target,stages,key,revision,segments){
 const halo=sourceFilterHalo(stages),x0=Math.max(0,target.x-halo),y0=Math.max(0,target.y-halo),z0=Math.max(0,target.z-halo),x1=Math.min(series.columns,target.x+target.width+halo),y1=Math.min(series.rows,target.y+target.height+halo),z1=Math.min(series.slices.length,target.z+target.depth+halo);
 const box={x:x0,y:y0,z:z0,width:x1-x0,height:y1-y0,depth:z1-z0},data=await readSourceRegion(series,box,revision,true);
 if(revision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');
 const localTarget={x:target.x-x0,y:target.y-y0,z:target.z-z0,width:target.width,height:target.height,depth:target.depth};
 if(gpuStagesSupported(stages)){
  try{
   const bits=await runGpuSourceFilters(data,box.width,box.height,box.depth,stages,localTarget,segments);
   if(bits instanceof Uint32Array){if(revision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');return bits}
  }catch(e){
   gpuFilterRuntime.lastError='mask: '+String(e?.message||e);if(!gpuFilterRuntime.warned){console.warn('WebGPU mask execution failed; using exact CPU mask path.',e);gpuFilterRuntime.warned=true}
  }
 }
 setGpuComputeBackend(gpuFilterRuntime.lastError?'CPU WORKER · GPU FAIL':'CPU WORKER',gpuFilterRuntime.lastError);
 const message={type:'process',id:++sourceFilterRuntime.nextId,buffer:data.buffer,w:box.width,h:box.height,d:box.depth,stages,target:localTarget};
 const values=await runSourceFilterWorker(message,key);
 if(revision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');
 return valuesToSegmentBits(values,segments);
}
export async function getFilteredSourceAxialMaskBlock(zStart,coreDepth,series,segments,keyPrefix='3d-mask-block'){
 const stages=sourceFilterStages();if(!stages.length)return null;
 const revision=sourceFilterRuntime.revision,w=series.columns,h=series.rows,d=series.slices.length,halo=sourceFilterHalo(stages),outDepth=Math.min(d-zStart,coreDepth+(zStart+coreDepth<d?1:0));
 const out=new Uint32Array(w*h*outDepth),[tx,ty]=fitSourceTile(w,h,outDepth,halo,384,128);
 for(let y=0;y<h;y+=ty)for(let x=0;x<w;x+=tx){
  if(revision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');
  const tw=Math.min(tx,w-x),th=Math.min(ty,h-y),tile=await processSourceRegionMasks(series,{x,y,z:zStart,width:tw,height:th,depth:outDepth},stages,keyPrefix+':'+zStart,revision,segments);
  for(let zz=0;zz<outDepth;zz++)for(let yy=0;yy<th;yy++){
   const src=(zz*th+yy)*tw,dst=(zz*h+y+yy)*w+x;
   out.set(tile.subarray(src,src+tw),dst);
  }
 }
 if(revision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');
 return{data:out,depth:outDepth,coreDepth:Math.min(coreDepth,d-zStart)};
}
export async function sourceSegmentMaskBlock(v,key,seg,zStart,depth,analysisRevision){
 const series=v.series,stages=sourceFilterStages(),coreDepth=Math.min(depth,series.slices.length-zStart);
 if(stages.length){
  const block=await getFilteredSourceAxialMaskBlock(zStart,coreDepth,series,[{key,seg}],'analysis:'+key+':'+analysisRevision);
  if(analysisRevision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');
  const masks=[];
  for(let z=0;z<block.coreDepth;z++){
   const bits=block.data.subarray(z*series.columns*series.rows,(z+1)*series.columns*series.rows),mask=new Uint8Array(bits.length);
   for(let i=0;i<bits.length;i++)mask[i]=(bits[i]&1)?1:0;
   masks.push(mask);
  }
  return masks;
 }
 const masks=[];
 for(let z=0;z<coreDepth;z++){
  if(analysisRevision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');
  const state=(await decodeSourceSegmentMasks(series.slices[zStart+z],[{key,seg}])).get(key);masks.push(state.mask);
 }
 return masks;
}
export function sourceAnalysisBlockDepth(w,h){
 const preferred=navigator.maxTouchPoints>0?4:16,maxGroups=65535,workgroupSize=256,plane=Math.max(1,w*h),safe=Math.max(1,Math.floor(maxGroups*workgroupSize/plane));
 return Math.max(1,Math.min(preferred,safe));
}
const segmentReadAhead=new Map();
async function timedRead(series,box,revision){const t=performance.now(),data=await readSourceRegion(series,box,revision,true);addGpuStepTime('read',performance.now()-t);return data}
export async function sourceSegmentRunBlockGpu(v,key,seg,zStart,depth,analysisRevision,extraSegs=[],airLayers=null){
 const series=v.series,stages=sourceFilterStages(),coreDepth=Math.min(depth,series.slices.length-zStart),device=await ensureGpuFilterDevice();if(!device)throw new Error('__GPU_ANALYSIS_UNAVAILABLE__');
 // no workgroup-count limit here: the filter and RLE passes dispatch 2D grids
 let rawError=null;
 if(!airLayers&&!stages.length&&series.slices.slice(zStart,zStart+coreDepth).every(meta=>isNativeDicomTransferSyntax(meta.ts))){
  try{
   const raw=await gpuValidationScope(device,'raw DICOM analysis RLE',()=>extractSourceThresholdRuns(device,series,zStart,coreDepth,seg));
   if(raw){
    const itemsList=[raw.items];
    for(const extra of extraSegs){const r=await gpuValidationScope(device,'raw DICOM analysis RLE',()=>extractSourceThresholdRuns(device,series,zStart,coreDepth,extra));if(!r)throw new Error('__GPU_ANALYSIS_UNAVAILABLE__');itemsList.push(r.items)}
    setGpuComputeBackend('WEBGPU ANALYSIS RAW-RLE');return{...raw,itemsList};
   }
  }catch(e){rawError=e;console.warn('Raw DICOM GPU RLE unavailable; retrying decoded CT on WebGPU.',e)}
 }
 const halo=sourceFilterHalo(stages)+(airLayers?airLayers.n[2]:0),boxFor=zs=>{const c=Math.min(depth,series.slices.length-zs),a=Math.max(0,zs-halo),b=Math.min(series.slices.length,zs+c+halo);return{x:0,y:0,z:a,width:series.columns,height:series.rows,depth:b-a}},box=boxFor(zStart),z0=box.z;
 // the next block's slices are read while this block runs on the GPU
 const keyOf=bx=>series.id+'|'+analysisRevision+'|'+bx.z+'|'+bx.depth;let data;
 const ahead=segmentReadAhead.get(keyOf(box));segmentReadAhead.clear();
 data=ahead?await ahead:await timedRead(series,box,analysisRevision);
 const nextStart=zStart+coreDepth;if(nextStart<series.slices.length){const nb=boxFor(nextStart),p=timedRead(series,nb,analysisRevision);p.catch(()=>{});segmentReadAhead.set(keyOf(nb),p)}
 if(analysisRevision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');
 const target={x:0,y:0,z:zStart-z0,width:series.columns,height:series.rows,depth:coreDepth};
 try{
  const result=await gpuValidationScope(device,'decoded CT analysis RLE',()=>runGpuSourceFilters(data,box.width,box.height,box.depth,stages,target,[{key,seg},...extraSegs.map((s,i)=>({key:key+':extra'+i,seg:s}))],{analysisRuns:true,airLayers}));
  if(!result?.analysisRuns)throw new Error('__GPU_ANALYSIS_UNAVAILABLE__');
  setGpuComputeBackend(stages.length?'WEBGPU ANALYSIS FILTER+RLE':'WEBGPU ANALYSIS DECODED-RLE',rawError?.message||null);
  if(airLayers&&!result.itemsList)throw new Error('__GPU_ANALYSIS_UNAVAILABLE__');
  return{items:result.items,itemsList:result.itemsList||[result.items],coreDepth};
 }catch(e){
  if(rawError&&String(e.message||e)==='__GPU_ANALYSIS_UNAVAILABLE__')gpuFilterRuntime.lastError='raw RLE: '+String(rawError.message||rawError);
  throw e;
 }
}
export function segmentBaseSignature(key,v){
 const s=segmentState[key];return [activeId,key,s.min,s.max,s.opening,s.closing,s.minComponent,s.holeFill,s.surfaceMm,s.thicknessMm,filterRebuildRevision,sourceFilterRuntime.revision,v?.columns,v?.rows,v?.slices,segmentSourceSignature(key)].join('|');
}
export function thresholdRunsFromMemory(v,seg,key=segmentKeyOf(seg)){
 const w=v.columns,h=v.rows,d=v.slices,out=new Array(d),plane=w*h;
 // with voxel takers above the runs are the mask minus their final voxels
 if(segmentNeedsGlobalMask(seg)||(key&&segmentSourcesOf(key).length))return maskToAnalysisRuns(getProcessedSegmentMask(v,seg,key),w,h,d);
 for(let z=0;z<d;z++){const rec=[],base=z*plane;for(let y=0;y<h;y++){let x=0,row=base+y*w;while(x<w){while(x<w&&(v.data[row+x]<seg.min||v.data[row+x]>seg.max))x++;if(x>=w)break;const x0=x;while(x+1<w&&v.data[row+x+1]>=seg.min&&v.data[row+x+1]<=seg.max)x++;rec.push(y,x0,x);x++}}out[z]=new Uint32Array(rec)}
 return out;
}
// excludeRuns: the final voxels of the voxel takers above (run arrays); the segment's own range is not cut by
// them, so they are subtracted here, after the air-boundary exclusion (a per-voxel test) and before the shape-dependent
// processing, and once more after Closing / hole filling, which can add voxels the higher segment holds.
export async function sourceRunsForSegment(v,key,seg,onProgress=null,alive=()=>true,excludeRuns=null){
 if((segmentNeedsGlobalMask(seg)||(key&&segmentSourcesOf(key).length))&&sourceMemoryUsable(v)){
  const memoryView=sourceMprMemoryView(v);
  return thresholdRunsFromMemory(memoryView,seg,key);
 }
 const E=excludeRuns,addsVoxels=segmentAddsVoxels(seg),minusE=r=>E?subtractRunArrays(r,E,v.slices):r;
 const d=v.slices,w=v.columns,h=v.rows,revision=sourceFilterRuntime.revision,blockDepth=sourceAnalysisBlockDepth(w,h);
 // thresholded runs before post-processing, kept per segment so changing only
 // a post-processing setting (thin-region sliders, Opening, ...) skips this pass
 // Air-boundary exclusion on the GPU: one pass computes each segment
 // voxel's distance to air and returns the segment split into distance layers
 // (1..AIR_LAYERS voxels, and farther). A slider change then only unions layers,
 // with no GPU pass. Falls back to the CPU route when the GPU is unavailable.
 const surfaceMm=(+seg.surfaceMm||0)>0&&key!=='body'?+seg.surfaceMm:0;
 if(surfaceMm){
  const sp=(v.spacing||[1,1,1]).map(Number),vox=Math.max(1e-6,Math.min(sp[0],sp[1])),maxMm=AIR_LAYERS*vox;
  const layerSig=[activeId,filterRebuildRevision,revision,key,seg.min,seg.max,w,h,d,maxMm].join('|'),hit=airLayersMemo.get(key);
  let layers=hit?.signature===layerSig?hit.layers:null;
  if(layers)onProgress?.(d,d,'threshold');
  // device cache (same data, filters and segment range): no GPU pass at all
  const layerKeys=v.series?Promise.all(Array.from({length:AIR_LAYERS+1},(_,i)=>segmentRunsCacheKey(v.series,sourceFilterSignature(sourceFilterStages()),{min:seg.min,max:seg.max},{airLayer:i,of:AIR_LAYERS,maxMm}))).catch(()=>null):Promise.resolve(null);
  if(!layers){
   const keys=await layerKeys;
   if(keys)try{const hits=await Promise.all(keys.map(k=>loadCachedSegmentRuns(k,d)));if(hits.every(Boolean)){layers=hits;airLayersMemo.set(key,{signature:layerSig,layers});onProgress?.(d,d,'threshold')}}catch{}
  }
  if(layers){/* from memory or the device cache */}
  else try{
   const hiOf=k=>(k*vox)**2*(1+1e-5),ranges=[];
   for(let k=1;k<=AIR_LAYERS;k++)ranges.push({min:k===1?0:hiOf(k-1)*(1+1e-6),max:hiOf(k)});
   ranges.push({min:hiOf(AIR_LAYERS)*(1+1e-6),max:1e31});
   const airLayers={min:seg.min,max:seg.max,spacing:sp,n:sp.map(s=>Math.floor(maxMm/s+1e-9))};
   layers=await thresholdSourceRuns(v,key,ranges[0],onProgress,alive,ranges.slice(1),airLayers);
   airLayersMemo.set(key,{signature:layerSig,layers});
   void layerKeys.then(keys=>{if(keys)for(let i=0;i<keys.length;i++)void storeCachedSegmentRuns(keys[i],layers[i])});
  }
  catch(e){if(!String(e?.message||e).startsWith('__AIR_GPU_UNAVAILABLE__'))throw e;airGpuFailure.set(key,String(e.message).replace(/^__AIR_GPU_UNAVAILABLE__:?\s*/,'')||'?');console.warn('GPU air layers unavailable; using the CPU route.',e.message);layers=null}
  if(layers){
   // kept = voxels farther from air than the slider value
   let tl=performance.now();const k=Math.min(AIR_LAYERS,Math.round(surfaceMm/vox));let air=layers[AIR_LAYERS];
   for(let i=k;i<AIR_LAYERS;i++)air=unionRunArrays(air,layers[i],d);
   tl=timeStep(key,ja0()?'層の合成':'layer union',tl);
   // layers are disjoint: the unprocessed count is the sum of the layer counts
   let before=0;for(const layer of layers)before+=analysisRunsVoxelCount(layer);
   const airE=minusE(air),rest={...seg,surfaceMm:0};let processed=segmentNeedsGlobalMask(rest)?await postprocessWithGpuOpen(airE,v,rest,null,alive,(a,b)=>onProgress?.(a,b,'thin')):airE;
   if(E&&addsVoxels)processed=minusE(processed);
   postprocessStats.set(key,{before,after:analysisRunsVoxelCount(processed),body:null,insideBody:null,total:w*h*d,dims:[w,h,d],spacing:v.spacing,surfaceApplied:true,gpuAir:true});
   timeStep(key,ja0()?'数える':'count',tl);
   return processed;
  }
 }
 const rawSig=[activeId,filterRebuildRevision,revision,key,seg.min,seg.max,w,h,d].join('|'),memo=rawRunsMemo.get(key);
 let out=memo?.signature===rawSig?memo.runs:null;
 if(out)onProgress?.(d,d,'threshold');
 else{
  // the air-boundary exclusion needs the body mask; when it is not known yet,
  // read it from the same filtered blocks instead of filtering the volume twice
  const surface=(+seg.surfaceMm||0)>0&&key!=='body',bodySeg=bodySegment(seg.min);
  let withBody=surface&&bodyRunsMemo.signature!==bodySignature(v,seg.min);
  if(withBody){const hit=await loadCachedBodyRuns(v,bodySeg);if(hit){seedBodyRuns(v,seg.min,hit);withBody=false}}
  const sets=await thresholdSourceRuns(v,key,seg,onProgress,alive,withBody?[bodySeg]:[]);
  out=sets[0];
  if(withBody){seedBodyRuns(v,seg.min,sets[1]);void storeBodyRuns(v,bodySeg,sets[1])}
 }
 if(key!=='body')rawRunsMemo.set(key,{signature:rawSig,runs:out});
 const outE=minusE(out);
 if(!segmentNeedsGlobalMask(seg))return outE;
 let bodyRuns=(+seg.surfaceMm||0)>0?await sourceBodyRuns(v,(a,b)=>onProgress?.(a,b,'body'),seg.min):null;
 // guard: an empty body mask would mark every voxel as air and remove the
 // whole segment; skip the air-boundary exclusion instead
 const bodyVoxels=bodyRuns?analysisRunsVoxelCount(bodyRuns):null,insideBody=bodyRuns?analysisRunsVoxelCount(intersectRunArrays(outE,bodyRuns,d)):null;
 if(bodyRuns&&!bodyVoxels){console.warn('Body mask is empty; skipping air-boundary exclusion.');bodyRuns=null}
 if(!alive())throw new Error('__SUPERSEDED__');
 let processed=await postprocessWithGpuOpen(outE,v,seg,bodyRuns,alive,(a,b)=>onProgress?.(a,b,'thin'));
 if(E&&addsVoxels)processed=minusE(processed);
 postprocessStats.set(key,{before:analysisRunsVoxelCount(outE),after:analysisRunsVoxelCount(processed),body:bodyVoxels,insideBody,total:w*h*d,dims:[w,h,d],spacing:v.spacing,surfaceApplied:!!bodyRuns});
 return processed;
}
// voxels before/after post-processing of the last computation, per segment
// (shown in the segment status so a wrong result is visible at once)
export const postprocessStats=new Map();
// step timings of the last computation per segment (diagnostic, shown in the status)
export const segmentTimings=new Map();
function timeStep(key,name,t0){const list=segmentTimings.get(key);if(list)list.push([name,performance.now()-t0]);return performance.now()}
// Post-processing with the thin-part removal (B) on the GPU when available:
// A (CPU route, when bodyRuns is given), then B via gpuOpenRuns, then the rest
// (Opening, Closing, Hole Filling, Min Component). Falls back to the CPU kernels.
async function postprocessWithGpuOpen(runs,v,seg,bodyRuns,alive,onProgress){
 const t=+seg.thicknessMm||0;
 if(t>0){
  const w=v.columns,h=v.rows,d=v.slices,sp=v.spacing||[1,1,1];
  let pre=runs;
  if(bodyRuns&&(+seg.surfaceMm||0)>0)pre=await thinSuppressSourceRuns(runs,w,h,d,sp,{...seg,thicknessMm:0},bodyRuns,alive,onProgress);
  let opened=null;
  try{opened=await gpuOpenRuns(pre,w,h,d,sp,t,onProgress,alive)}
  catch(e){if(String(e?.message||e)==='__SUPERSEDED__')throw e;console.warn('GPU thin-part removal unavailable; using the CPU kernel.',e)}
  if(opened){const rest={...seg,surfaceMm:0,thicknessMm:0};return segmentNeedsGlobalMask(rest)?postprocessSourceRuns(opened,v,rest,null,alive,onProgress):opened}
 }
 return postprocessSourceRuns(runs,v,seg,bodyRuns,alive,onProgress);
}
const rawRunsMemo=new Map(),airLayersMemo=new Map(),airGpuFailure=new Map();let lastBlockGpuError='';
// distance layers kept for the air-boundary exclusion (the slider maximum, segment-ui.js)
const AIR_LAYERS=8;
const ja0=()=>currentLanguage==='ja';
// GPU RLE records arrive in atomic-append order; the GPU edit upload and the
// run-set operations expect rows (then x) ascending.
function sortedRunSlice(flat){
 const n=flat.length/3;if(n<2)return new Uint32Array(flat);
 const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>(flat[a*3]-flat[b*3])||(flat[a*3+1]-flat[b*3+1])),out=new Uint32Array(flat.length);
 for(let i=0;i<n;i++){const j=order[i]*3;out[i*3]=flat[j];out[i*3+1]=flat[j+1];out[i*3+2]=flat[j+2]}
 return out;
}
// extraSegs: further threshold ranges read from the same (filtered) blocks;
// returns [runs, ...extraRuns].
async function thresholdSourceRuns(v,key,seg,onProgress,alive,extraSegs=[],airLayers=null){
 const d=v.slices,w=v.columns,h=v.rows,sets=[seg,...extraSegs].map(()=>Array.from({length:d},()=>new Uint32Array(0))),revision=sourceFilterRuntime.revision;
 let blockDepth=sourceAnalysisBlockDepth(w,h);
 // air layers: the z halo (filters + ball) dwarfs a 4-slice core on the iPad, so
 // take as many slices as the storage-buffer limit allows (2D dispatch)
 if(airLayers){
  const device=await ensureGpuFilterDevice(),limit=Number(device?.limits?.maxStorageBufferBindingSize)||134217728,halo=sourceFilterHalo(sourceFilterStages())+airLayers.n[2];
  const fit=Math.floor(limit/(w*h*4))-2*halo-1;if(fit>blockDepth)blockDepth=Math.min(32,fit);
  Object.assign(gpuRunInfo,{core:blockDepth,halo,filters:sourceFilterStages().map(s=>s.key).join('+')||'none'});
 }
 onProgress?.(0,d,'threshold');
 beginGpuBufferRetention();try{
 for(let z0=0;z0<d;z0+=blockDepth){
  if(!alive())throw new Error('__SUPERSEDED__');
  let gpu=null;lastBlockGpuError='';try{gpu=await sourceSegmentRunBlockGpu(v,key,seg,z0,blockDepth,revision,extraSegs,airLayers)}catch(e){lastBlockGpuError=String(e?.message||e);console.warn('Edit base GPU RLE failed; using exact CPU RLE path.',e)}
  // the GPU air exclusion must cover every block; otherwise use the CPU route
  if(airLayers&&!gpu)throw new Error('__AIR_GPU_UNAVAILABLE__: '+(lastBlockGpuError||'no result'));
  if(gpu&&(gpu.itemsList||[gpu.items]).length===sets.length){
   const tSort=performance.now();
   (gpu.itemsList||[gpu.items]).forEach((items,si)=>{
    const per=Array.from({length:gpu.coreDepth},()=>[]);
    for(let i=0;i<items.length;i+=4){const lz=items[i];if(lz<per.length)per[lz].push(items[i+1],items[i+2],items[i+3])}
    for(let z=0;z<gpu.coreDepth;z++)sets[si][z0+z]=sortedRunSlice(per[z]);
   });
   addGpuStepTime('sort',performance.now()-tSort);
  }else{
   for(let si=0;si<sets.length;si++){
    const masks=await sourceSegmentMaskBlock(v,key,si?extraSegs[si-1]:seg,z0,blockDepth,revision);
    for(let z=0;z<masks.length;z++)sets[si][z0+z]=maskToAnalysisRuns(masks[z],w,h,1)[0];
   }
  }
  onProgress?.(Math.min(d,z0+blockDepth),d,'threshold');
  if((z0&63)===0)await frameYield();
 }
 }finally{endGpuBufferRetention()}
 return sets;
}
// Body mask runs (voxels at or above the segment's lower bound, filters applied) for the
// surface exclusion; one per data/filter state, also cached on the device.
const bodyRunsMemo={signature:'',promise:null};
function bodySignature(v,minValue){return[activeId,filterRebuildRevision,sourceFilterRuntime.revision,v.columns,v.rows,v.slices,minValue].join('|')}
// max is a fixed large value: v.max of a source-backed series can be an
// estimate or missing, and a NaN bound would make the whole volume "air"
function bodySegment(minValue){return{min:minValue,max:1e30,opening:0,closing:0,minComponent:0,holeFill:false,surfaceMm:0,thicknessMm:0}}
function bodyCacheKey(v,body){return v.series?segmentRunsCacheKey(v.series,sourceFilterSignature(sourceFilterStages()),body).catch(()=>null):Promise.resolve(null)}
async function loadCachedBodyRuns(v,body){const k=await bodyCacheKey(v,body);if(!k)return null;try{return await loadCachedSegmentRuns(k,v.slices)}catch{return null}}
async function storeBodyRuns(v,body,runs){const k=await bodyCacheKey(v,body);if(k)await storeCachedSegmentRuns(k,runs)}
function seedBodyRuns(v,minValue,runs){bodyRunsMemo.signature=bodySignature(v,minValue);bodyRunsMemo.promise=Promise.resolve(runs)}
export function sourceBodyRuns(v,onProgress=null,minValue=BODY_MIN_HU){
 const sig=bodySignature(v,minValue);
 if(bodyRunsMemo.signature===sig&&bodyRunsMemo.promise)return bodyRunsMemo.promise;
 const body=bodySegment(minValue);
 const promise=(async()=>{
  const hit=await loadCachedBodyRuns(v,body);if(hit)return hit;
  const runs=await sourceRunsForSegment(v,'body',body,onProgress);
  void storeBodyRuns(v,body,runs);
  return runs;
 })();
 bodyRunsMemo.signature=sig;bodyRunsMemo.promise=promise;
 promise.catch(()=>{if(bodyRunsMemo.promise===promise){bodyRunsMemo.signature='';bodyRunsMemo.promise=null}});
 return promise;
}
// Visible per-segment status in the segment card (the global progress bar
// lives on the data tab and is not visible while the segment settings are).
const PHASE_LABELS={ja:{threshold:'しきい値',body:'空気の判定',thin:'薄い領域の除去'},en:{threshold:'threshold',body:'air mask',thin:'thin-region removal'}};
export function setSegmentStatus(key,text,kind=''){
 const el=document.querySelector('[data-seg-status="'+key+'"]');if(!el)return;
 el.textContent=text||'';el.classList.toggle('is-hidden',!text);el.classList.toggle('is-error',kind==='error');el.classList.toggle('is-done',kind==='done');
}
// ?debug or the settings dialog's debug switch
const STATUS_DEBUG=()=>!!globalThis.__vrlSettings?.debugOn?.()||(typeof location!=='undefined'&&/[?&]debug(\b|=|&|$)/.test(location.search));
function timingTextBase(key){const list=segmentTimings.get(key),steps=[...gpuStepTimes];return (list?.length?' · '+list.map(([n,ms])=>n+' '+(ms/1000).toFixed(1)+'s').join(', '):'')+(steps.length?' · ['+steps.map(([n,ms])=>n+' '+(ms/1000).toFixed(1)+'s').join(', ')+']':'')+(gpuRunInfo.core?' · core '+gpuRunInfo.core+' halo '+gpuRunInfo.halo+' · '+gpuRunInfo.filters:'')}
function timingText(key){return timingTextBase(key)+(gpuCounts.size?' · '+[...gpuCounts].map(([n,c])=>n+' '+c).join(', '):'')}
function segmentStatusProgress(key,seg){
 const ja=currentLanguage==='ja',labels=PHASE_LABELS[ja?'ja':'en'],t0=performance.now();
 const phases=['threshold',...((+seg.surfaceMm||0)>0?['body']:[]),...(((+seg.surfaceMm||0)>0||(+seg.thicknessMm||0)>0)?['thin']:[])];
 return (done,total,phase='threshold')=>{
  const i=Math.max(0,phases.indexOf(phase)),pct=total?Math.round(100*done/total):0,sec=Math.round((performance.now()-t0)/1000);
  setSegmentStatus(key,(ja?'処理中 ':'Processing ')+(i+1)+'/'+phases.length+' '+(labels[phase]||phase)+' '+pct+'% · '+sec+(ja?'秒':'s'));
  // the same phase in the progress modal (only while a visible job holds the 'processing' slot)
  reportBusyProgress('processing',done,total,(i+1)+'/'+phases.length+' '+(labels[phase]||phase));
 };
}
export async function ensureSegmentBaseRuns(key,v=current3DVolume||volume,onProgress=null,quiet=false){
 if(!v||!segmentState[key])return null;const st=segmentEditState[key],sig=segmentBaseSignature(key,v);
 if(st.baseRuns&&st.baseSignature===sig)return st.baseRuns;
 // One computation per signature: a click during the background prewarm
 // waits for it (and receives its progress) instead of starting a second pass.
 if(st.pendingBase?.signature===sig){if(onProgress)st.pendingBase.listeners.add(onProgress);return st.pendingBase.promise}
 const pending={signature:sig,listeners:new Set(onProgress?[onProgress]:[]),promise:null},report=(done,total,phase)=>{for(const fn of pending.listeners)fn(done,total,phase)};
 // registered before it starts: an in-memory pass has no await and finishes inside this call (its result was
 // then never stored as baseRuns and the pending entry stayed, so the GPU volume never got the processed mask)
 st.pendingBase=pending;
 pending.promise=(async()=>{
  if(!quiet)setProcessingBusy(true,currentLanguage==='ja'?'編集領域を準備中':'Preparing editable segment',false);
  const ja=currentLanguage==='ja',t0=performance.now(),statusProgress=segmentNeedsGlobalMask(segmentState[key])?segmentStatusProgress(key,segmentState[key]):null;
  if(statusProgress){pending.listeners.add(statusProgress);statusProgress(0,1,'threshold')}
  try{
   // Source-backed volumes: reuse runs stored on the device by an earlier
   // session with the same data, filters and segment settings (run-cache.js).
   // the final voxels of the voxel takers above are subtracted (Ref = what they finally hold, as drawn)
   const seg=segmentState[key],sources=segmentSourcesOf(key),needExclude=sources.length>0&&v.sourceBacked&&!sourceMemoryUsable(v);
   // the device cache cannot hold a result that depends on manual edits (they are not part of its key)
   const cacheable=!segmentHasManualEditsUpstream(key),extra=sources.length?{sources:segmentSourceSignature(key,false)}:null;
   const cacheKeyPromise=cacheable&&v.sourceBacked&&v.series?segmentRunsCacheKey(v.series,sourceFilterSignature(sourceFilterStages()),seg,extra).catch(()=>null):null;

   let runs=null;postprocessStats.delete(key);airGpuFailure.delete(key);segmentTimings.set(key,[]);gpuStepTimes.clear();gpuCounts.clear();for(const k of Object.keys(gpuRunInfo))delete gpuRunInfo[k];let tt=performance.now();
   if(cacheKeyPromise){const k=await cacheKeyPromise;tt=timeStep(key,ja?'キー':'key',tt);if(k)try{runs=await loadCachedSegmentRuns(k,v.slices);if(runs)report(v.slices,v.slices,'thin')}catch{runs=null}tt=timeStep(key,ja?'キャッシュ読込':'cache read',tt)}
   if(!runs){
    // settings changed meanwhile: stop instead of finishing a stale pass
    const alive=()=>segmentBaseSignature(key,v)===sig;
    let excludeRuns=null;
    if(needExclude){
     for(const u of sources){const f=await getFinalSegmentRuns(u,v);if(!f)continue;excludeRuns=excludeRuns?unionRunArrays(excludeRuns,f,v.slices):f}
     if(!alive())throw new Error('__SUPERSEDED__');
    }
    runs=v.sourceBacked?await sourceRunsForSegment(v,key,seg,report,alive,excludeRuns):thresholdRunsFromMemory(v,seg,key);
    tt=timeStep(key,ja?'計算':'compute',tt);
    if(cacheKeyPromise&&st.pendingBase===pending)void cacheKeyPromise.then(k=>k&&storeCachedSegmentRuns(k,runs,segmentRunsCacheInfo(v.series,sourceFilterSignature(sourceFilterStages()))));
   }
   if(st.pendingBase===pending){st.baseRuns=runs;st.baseSignature=sig}
   if(statusProgress){
    const stats=postprocessStats.get(key),pct=(a,b)=>(100*a/Math.max(1,b)).toFixed(1)+'%',sec=Math.round((performance.now()-t0)/1000)+(ja?'秒':'s');
    let text=(ja?'処理完了 · ':'Done · ')+sec+(stats?.before?' · '+(ja?'残り ':'kept ')+pct(stats.after,stats.before):'');
    // device-check numbers only with ?debug
    if(STATUS_DEBUG()&&stats){
     text+=' · '+stats.after+'/'+stats.before+' vox'+(stats.gpuAir?' · GPU':'')
      +(stats.body!=null?' · '+(ja?'体 ':'body ')+pct(stats.body,stats.total)+' · '+(ja?'体内 ':'in body ')+(stats.insideBody==null?'—':pct(stats.insideBody,stats.before)):'')
      +(stats.spacing?' · '+stats.spacing.map(s=>(+s).toPrecision(3)).join('×')+' mm':'')+(stats.dims?' · '+stats.dims.join('×'):'')
      +(airGpuFailure.has(key)?' · CPU ('+(ja?'GPU不可: ':'no GPU: ')+airGpuFailure.get(key)+')':'')+timingText(key);
    }
    setSegmentStatus(key,text,'done');
   }
   return runs;
  }
  catch(e){
   if(statusProgress){
    if(String(e?.message||e)==='__SUPERSEDED__')setSegmentStatus(key,ja?'設定が変わったため中断（新しい設定で再計算）':'Stopped: settings changed (recomputing)');
    else setSegmentStatus(key,(ja?'エラー: ':'Error: ')+String(e?.message||e),'error');
   }
   throw e;
  }
  finally{if(st.pendingBase===pending)st.pendingBase=null;if(!quiet)setProcessingBusy(false,'',false)}
 })();
 return pending.promise;
}
// base (already without the voxels the higher takers hold) ∩ keep − exclude. A manual edit only ever removes voxels from
// the base, so nothing a higher segment holds can come back through it. The result is stored only while its base is
// still the segment's current one (a recompute that overtook this call must not be overwritten with stale runs).
export async function getFinalSegmentRuns(key,v=current3DVolume||volume,onProgress=null){
 const st=segmentEditState[key],gen=segmentEditGen[key]|0,base=await ensureSegmentBaseRuns(key,v,onProgress);if(!base)return null;let runs=base,d=v.slices;
 if(st.keepRuns)runs=intersectRunArrays(runs,st.keepRuns,d);
 if(st.excludeRuns)runs=subtractRunArrays(runs,st.excludeRuns,d);
 if(st.baseRuns===base&&(segmentEditGen[key]|0)===gen)st.finalRuns=runs;
 return runs;
}
export async function decodeSourceSegmentMasks(meta,segments){
 if(!isNativeDicomTransferSyntax(meta.ts)){
  const values=await getCachedSourceSlice(meta),n=meta.rows*meta.columns,blockSize=16384,states=new Map(segments.map(({key,seg})=>[key,{mask:new Uint8Array(n),blocks:[],block:new Uint32Array(blockSize),used:0,min:seg.min,max:seg.max}]));
  for(let i=0;i<n;i++){const value=values[i];for(const state of states.values())if(value>=state.min&&value<=state.max){state.mask[i]=1;if(state.used===state.block.length){state.blocks.push(state.block);state.block=new Uint32Array(blockSize);state.used=0}state.block[state.used++]=i}}
  for(const state of states.values()){if(state.used)state.blocks.push(state.block.subarray(0,state.used));state.block=null;delete state.used;delete state.min;delete state.max}
  return states;
 }
 const bpp=meta.bits===8?1:meta.bits===16?2:0;
 if(!bpp)throw new Error('Unsupported BitsAllocated='+meta.bits);
 let bytes,offset=meta.pixelOffset;
 if(offset!=null){
  bytes=new Uint8Array(await meta.file.slice(offset,offset+meta.rows*meta.columns*bpp).arrayBuffer());
  offset=0;
 }else{
  const all=new Uint8Array(await meta.file.arrayBuffer()),ds=dicomParser.parseDicom(all),el=ds.elements.x7fe00010;
  if(!el)throw new Error('Pixel Data missing');bytes=all;offset=el.dataOffset;
 }
 const little=meta.ts!=='1.2.840.10008.1.2.2',view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=meta.rows*meta.columns,blockSize=16384;
 const states=new Map(segments.map(({key,seg})=>[key,{mask:new Uint8Array(n),blocks:[],block:new Uint32Array(blockSize),used:0,min:seg.min,max:seg.max}]));
 const pushIndex=(state,i)=>{
  if(state.used===state.block.length){state.blocks.push(state.block);state.block=new Uint32Array(blockSize);state.used=0}
  state.block[state.used++]=i;
 };
 for(let i=0;i<n;i++){
  let raw;
  if(meta.bits===8){raw=bytes[offset+i];if(meta.signed&&raw>127)raw-=256}
  else raw=meta.signed?view.getInt16(offset+i*2,little):view.getUint16(offset+i*2,little);
  const value=Math.fround(raw*meta.slope+meta.intercept);
  for(const state of states.values()){
   if(value>=state.min&&value<=state.max){state.mask[i]=1;pushIndex(state,i)}
  }
 }
 for(const state of states.values()){
  if(state.used)state.blocks.push(state.block.subarray(0,state.used));
  state.block=null;delete state.used;delete state.min;delete state.max;
 }
 return states;
}
