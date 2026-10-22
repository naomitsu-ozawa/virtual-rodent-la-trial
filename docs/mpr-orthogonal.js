// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { sourceVolume, volume, sceneState, residentMprEpoch, setResidentMprReadbackDisabled, residentMprReadbackDisabled, setSourceOrthogonalPlaneCacheBytes, sourceOrthogonalPlaneCacheBytes } from './state.js?v=20261022-build645';
import { state } from './ui-shell.js?v=20261022-build645';
import { sourceFilterStages } from './source-filters.js?v=20261022-build645';
import { frameYield, isIPhoneRuntime, isTabletRuntime } from './utils.js?v=20261022-build645';
import { readSourceRows, readSourceColumn } from './volume-io.js?v=20261022-build645';
export const residentMprJobs={axial:{running:false,current:null,pending:null},coronal:{running:false,current:null,pending:null},sagittal:{running:false,current:null,pending:null}};
export function residentGpuMprAvailable(v=sourceVolume||volume){
 const mv=sceneState?.medicalVolume;return !!(!residentMprReadbackDisabled&&mv?.hasResident?.(v));
}
export function readResidentGpuMprPlane(p,idx,series,{maxSide=0}={}){
 const target=sourceVolume||volume,mv=sceneState?.medicalVolume,state=residentMprJobs[p];
 if(!state||!target?.sourceBacked||target.series!==series||sourceFilterStages().length||!residentGpuMprAvailable(target)||!mv?.extractPlane)return Promise.resolve(null);
 return new Promise((resolve,reject)=>{
  const waiter={resolve,reject},same=job=>job&&job.idx===idx&&job.series===series&&job.target===target&&job.maxSide===maxSide;
  if(same(state.current)){state.current.waiters.push(waiter);return}
  if(same(state.pending)){state.pending.waiters.push(waiter);return}
  if(state.pending){for(const old of state.pending.waiters)old.reject(new Error('__SUPERSEDED__'))}
  state.pending={idx,series,target,maxSide,epoch:residentMprEpoch,waiters:[waiter]};
  if(state.running)return;
  state.running=true;
  void(async()=>{
   try{
    while(state.pending){
     const job=state.pending;state.pending=null;state.current=job;
     if(job.epoch!==residentMprEpoch||job.target!==sourceVolume){for(const w of job.waiters)w.reject(new Error('__SUPERSEDED__'));state.current=null;continue}
     try{
      const result=await mv.extractPlane(job.target,p,job.idx,{maxSide:job.maxSide});
      for(const w of job.waiters)w.resolve(result);
     }catch(e){
      if(String(e.message||e)==='__SUPERSEDED__'){for(const w of job.waiters)w.reject(e)}
      else{
       setResidentMprReadbackDisabled(true);console.warn('GPU resident MPR readback failed; using source DICOM fallback.',e);
       for(const w of job.waiters)w.resolve(null);
       if(state.pending){for(const pending of state.pending.waiters)pending.resolve(null);state.pending=null}
      }
     }finally{state.current=null}
    }
   }finally{state.running=false}
  })();
 });
}
export const sourceOrthogonalPlaneCache=new Map(),sourceOrthogonalPlanePending=new Map();
export function sourceOrthogonalCacheLimit(){return isIPhoneRuntime()?64*1024*1024:isTabletRuntime()?256*1024*1024:512*1024*1024}
export function sourceOrthogonalCacheGet(p,idx){
 const key=p+':'+idx,v=sourceOrthogonalPlaneCache.get(key);if(!v)return null;sourceOrthogonalPlaneCache.delete(key);sourceOrthogonalPlaneCache.set(key,v);return v;
}
export function sourceOrthogonalCacheSet(p,idx,v){
 const key=p+':'+idx,old=sourceOrthogonalPlaneCache.get(key);if(old)setSourceOrthogonalPlaneCacheBytes(sourceOrthogonalPlaneCacheBytes-(old.byteLength));
 sourceOrthogonalPlaneCache.delete(key);sourceOrthogonalPlaneCache.set(key,v);setSourceOrthogonalPlaneCacheBytes(sourceOrthogonalPlaneCacheBytes+(v.byteLength));
 const limit=sourceOrthogonalCacheLimit();
 while(sourceOrthogonalPlaneCacheBytes>limit&&sourceOrthogonalPlaneCache.size>1){
  const first=sourceOrthogonalPlaneCache.keys().next().value,item=sourceOrthogonalPlaneCache.get(first);sourceOrthogonalPlaneCache.delete(first);setSourceOrthogonalPlaneCacheBytes(sourceOrthogonalPlaneCacheBytes-(item.byteLength));
 }
}
export async function readSourceOrthogonalStrip(p,meta,idx){
 if(p==='coronal'){
  const row=await readSourceRows(meta,idx,1);return row.subarray(0,meta.columns);
 }
 return readSourceColumn(meta,idx);
}
export async function buildSourceOrthogonalPlane(p,idx,series,revision){
 const cached=sourceOrthogonalCacheGet(p,idx);if(cached)return cached;
 const key=p+':'+idx,pending=sourceOrthogonalPlanePending.get(key);if(pending)return pending;
 const promise=(async()=>{
  const gpuResult=await readResidentGpuMprPlane(p,idx,series);
  const gpuPlane=gpuResult?.values||null;if(gpuPlane){sourceOrthogonalCacheSet(p,idx,gpuPlane);return gpuPlane}
  const dims=p==='coronal'?[series.columns,series.slices.length]:[series.rows,series.slices.length],out=new Float32Array(dims[0]*dims[1]),d=series.slices.length;
  let next=0,completed=0;
  const workers=Math.min(d,navigator.maxTouchPoints>0?Math.max(2,Math.min(4,(navigator.hardwareConcurrency||4)-1)):Math.max(4,Math.min(8,(navigator.hardwareConcurrency||8)-1)));
  const run=async()=>{
   while(true){
    const z=next++;if(z>=d)return;
    const strip=await readSourceOrthogonalStrip(p,series.slices[z],idx);
    out.set(strip,(d-1-z)*dims[0]);
    completed++;if((completed&15)===0)await frameYield();
   }
  };
  await Promise.all(Array.from({length:workers},()=>run()));
  if(volume?.series!==series)throw new Error('__SUPERSEDED__');
  sourceOrthogonalCacheSet(p,idx,out);return out;
 })();
 sourceOrthogonalPlanePending.set(key,promise);
 try{return await promise}finally{if(sourceOrthogonalPlanePending.get(key)===promise)sourceOrthogonalPlanePending.delete(key)}
}
