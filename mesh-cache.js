// Device-local cache of built surface meshes: the mesh of a segment (or of the whole base surface) shown in the
// 3D surface view is stored in the GPU volume cache database as ONE packed blob per entry (mesh-pack.js), so showing the
// same data with the same settings again skips building it. Same database, same LRU budget and the same "clear cache"
// buttons as the volume and segment-runs entries; browser storage can be evicted, so this is only a cache.
// DOM-free: the caller passes the opened cache (gpu-volume-data.js volumeCache()), so the unit tests use a fake IndexedDB.
import { packMeshes, packedMeshBytes, unpackMeshes } from './mesh-pack.js?v=20261022-build654';
import { MESH_FORMAT } from './mesh-cache-key.js?v=20261022-build654';
export const MESH_KIND='segment-mesh';
// share of the whole cache budget the meshes may hold, so a burst of large meshes cannot push the (slow to rebuild) GPU
// volume entries out; and the largest single entry (iPad: storage and memory are tight, the blob is built in memory once)
export const MESH_BUDGET_SHARE=.35;
export const MESH_ENTRY_MAX_BYTES={touch:96*2**20,desktop:256*2**20};
export function meshEntryLimit(budget,touch){return Math.min(touch?MESH_ENTRY_MAX_BYTES.touch:MESH_ENTRY_MAX_BYTES.desktop,Math.floor(budget*MESH_BUDGET_SHARE))}
// counters for the tests and the debug footer: builds = meshes generated (not restored)
export const meshCacheStats={hits:0,misses:0,stores:0,skipped:0,invalid:0,builds:0,lastStoreMs:0,lastLoadMs:0};
export function resetMeshCacheStats(){for(const k of Object.keys(meshCacheStats))meshCacheStats[k]=0}

// the stored meshes of the entry, or null (a miss, an entry of an older format, or a damaged blob, which is dropped)
export async function loadMeshEntry(cache,key){
 const t0=performance.now();
 const hit=await cache.lookup(key);
 if(!hit||hit.info?.kind!==MESH_KIND)return null;
 const drop=async()=>{meshCacheStats.invalid++;try{await cache.remove(key)}catch(e){console.warn('Mesh cache entry could not be dropped.',e)}return null};
 if(hit.info.meshFormat!==MESH_FORMAT)return drop();
 const bytes=await cache.read(key,0);
 if(!bytes||bytes.byteLength!==hit.bytes)return drop();
 const meshes=unpackMeshes(bytes);
 if(!meshes)return drop();
 // the layout in the blob must be what the entry says it is (a mismatch means the entry is not the mesh of this key)
 if(meshes.length!==hit.info.meshCount)return drop();
 meshCacheStats.lastLoadMs=(performance.now())-t0;
 return{meshes,info:hit.info};
}

// Packs at once (before the first await: the geometry may be disposed by the next rebuild) and stores in the background.
// Returns true when stored; every failure (too large, quota, eviction) is a quiet false: the mesh is already on screen.
export async function storeMeshEntry(cache,key,meshes,info,{budget,touch=false}={}){
 try{
  const size=packedMeshBytes(meshes),limit=meshEntryLimit(budget,touch);
  if(size>limit||size>budget){meshCacheStats.skipped++;return false}
  const t0=performance.now(),bytes=packMeshes(meshes);
  const writer=await cache.begin(key,{slices:1,bytesPerSlice:bytes.byteLength,info:{kind:MESH_KIND,meshFormat:MESH_FORMAT,meshCount:meshes.length,...info}});
  try{await writer.write(0,bytes);await writer.commit()}catch(e){await writer.abort();throw e}
  // entries of an older mesh format never match a key again; then keep the meshes within their share (oldest first)
  const all=(await cache.list()).filter(e=>e.info?.kind===MESH_KIND);
  for(const e of all)if(e.info.meshFormat!==MESH_FORMAT&&e.key!==key)await cache.remove(e.key);
  const live=all.filter(e=>e.complete&&e.info.meshFormat===MESH_FORMAT).sort((a,b)=>a.lastUsed-b.lastUsed),cap=Math.floor(budget*MESH_BUDGET_SHARE);
  let used=live.reduce((a,e)=>a+(e.bytes||0),0);
  for(const e of live){if(used<=cap)break;if(e.key===key)continue;await cache.remove(e.key);used-=e.bytes||0}
  await cache.prune(budget,{keep:key});
  meshCacheStats.stores++;meshCacheStats.lastStoreMs=(performance.now())-t0;
  return true;
 }catch(e){console.warn('Mesh cache store failed.',e);return false}
}
