// Glue between the surface builders and the mesh cache (mesh-cache.js): which builds may use it, the keys from the app state,
// meshes -> blob descriptors and back to three.js meshes. Everything here only decides WHETHER a stored mesh is used; a
// disabled, unavailable or failing cache always leaves the normal build untouched.
import { segmentState, segmentEditState, segmentEditActive, segmentHasManualEditsUpstream, segmentSourceSignature, segmentExclusive, sourceMemoryUsable } from './segments.js?v=20261020-build630';
import { sourceFilterSignature, sourceFilterStages } from './source-filters.js?v=20261020-build630';
import { ipadGpuTargetSide } from './state.js?v=20261020-build630';
import { surfaceSmoothEnabled, surfaceSmoothStrength } from './ui-shell.js?v=20261020-build630';
import { volumeCache, volumeCacheBudget } from './gpu-volume-data.js?v=20261020-build630';
import { datasetFingerprint } from './project-file.js?v=20261020-build630';
import { loadMeshEntry, storeMeshEntry } from './mesh-cache.js?v=20261020-build630';
import { runSurfaceMeshKey, baseMeshKey, runsDigest, sliceContentDigest } from './mesh-cache-key.js?v=20261020-build630';
import { runSurfaceRoute, surfaceMaterialParams } from './surface-mesh.js?v=20261020-build630';
import { describeMeshes, meshesFromEntry } from './mesh-three.js?v=20261020-build630';
export { meshCacheStats } from './mesh-cache.js?v=20261020-build630';

// ?meshcache=off turns the whole feature off (no lookup, no store) for diagnosing a suspect mesh
export function meshCacheEnabled(){
 try{return !(typeof location!=='undefined'&&/[?&]meshcache=off(&|$)/.test(location.search))}catch{return true}
}
// the opened cache and the budget, once per build (the budget is read before the build so the store needs no await first)
export async function meshCacheContext(){
 if(!meshCacheEnabled())return null;
 try{const cache=await volumeCache();if(!cache)return null;return{cache,budget:await volumeCacheBudget(),touch:(navigator.maxTouchPoints||0)>0}}
 catch(e){console.warn('Mesh cache unavailable.',e);return null}
}
// inputs shared by every key: smoothing, 3D resolution, overlap mode / order
export function meshKeyCommon(){
 return{smoothing:{enabled:!!surfaceSmoothEnabled?.checked,strength:+surfaceSmoothStrength?.value||0},resolution:ipadGpuTargetSide,exclusive:{mode:segmentExclusive.mode,order:[...segmentExclusive.order]}};
}
// A run surface may be cached when its voxels come from settings alone: not for a segment with manual edits (its own, or in a
// segment above it whose voxels it takes), nor with raw cut faces. Those are interactive and rarely seen twice, and a miss is
// always safe. Volumes without a DICOM series (no dataset fingerprint) are never cached.
export function runSurfaceCacheable(key,v){
 const st=segmentEditState[key];
 return!!(v?.sourceBacked&&v.series&&segmentState[key]&&st&&!segmentEditActive(key)&&!st.cutRuns&&!st.rawCutSurface&&!segmentHasManualEditsUpstream(key));
}
export async function runSurfaceCacheKey(v,key,runs){
 return runSurfaceMeshKey({series:v.series,content:await sliceContentDigest(v.series),filter:sourceFilterSignature(sourceFilterStages()),key,seg:segmentState[key],sources:segmentSourceSignature(key,false),memoryPath:sourceMemoryUsable(v),runsHash:await runsDigest(runs),route:runSurfaceRoute(v),...meshKeyCommon()});
}
export async function baseCacheKey(series,streamActive,route){
 return baseMeshKey({series,content:await sliceContentDigest(series),filter:sourceFilterSignature(sourceFilterStages()),segments:streamActive.map(({key,seg})=>({key,seg})),route,...meshKeyCommon()});
}
export function meshEntryInfo(series,part,segments,descs){
 let triangles=0;for(const d of descs)triangles+=(d.index?d.index.length:d.positions.length/3)/3;
 return{part,dataset:JSON.stringify(datasetFingerprint(series)),filter:sourceFilterSignature(sourceFilterStages()),description:series.description||'',segments:[...segments],triangles};
}

// lookup + restore; any failure is a miss (the caller builds the mesh)
export async function loadCachedMeshes(ctx,cacheKey){
 if(!ctx)return null;
 try{const entry=await loadMeshEntry(ctx.cache,cacheKey),meshes=entry&&meshesFromEntry(entry,(key)=>segmentState[key]?surfaceMaterialParams(segmentState[key],key):null);return meshes?{entry,meshes}:null}
 catch(e){console.warn('Mesh cache read failed.',e);return null}
}
// packs the meshes under root at once and stores them in the background; never throws, never blocks the display
export function storeBuiltMeshes(ctx,cacheKey,root,info){
 if(!ctx)return;
 try{const descs=describeMeshes(root);if(descs)void storeMeshEntry(ctx.cache,cacheKey,descs,info(descs),{budget:ctx.budget,touch:ctx.touch})}
 catch(e){console.warn('Mesh cache store failed.',e)}
}
