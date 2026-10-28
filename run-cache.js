// Device-local cache of per-segment filtered runs for volume analysis, so the
// first analysis click after reopening the same data with the same filter and
// segment settings needs no re-filtering. Stored in the GPU volume cache
// database (same LRU budget, cleared by the same "clear cache" button) as one
// packed blob per entry. Browser storage can be evicted; this is only a cache.
import { datasetFingerprint } from './project-file.js?v=20261027-build680';
import { volumeCache, volumeCacheBudget, pruneOtherFilterSettings } from './gpu-volume-data.js?v=20261027-build680';
import { packRuns, unpackRuns } from './run-pack.js?v=20261027-build680';
import { segmentRunsCacheKey } from './segment-cache-key.js?v=20261027-build680';
export { segmentRunsCacheKey };

// Stable across sessions: dataset identity + filter + segment settings.
export function segmentRunsCacheInfo(series,filterSignature){return{kind:'segment-runs',dataset:datasetFingerprint(series),filter:filterSignature||''}}
export async function loadCachedSegmentRuns(key,slices){
 const cache=await volumeCache();if(!cache)return null;
 const hit=await cache.lookup(key);if(!hit||hit.info?.kind!=='segment-runs')return null;
 const bytes=await cache.read(key,0);if(!bytes)return null;
 const runs=unpackRuns(bytes,slices);if(!runs){try{await cache.remove(key)}catch{}}
 return runs;
}
export async function storeCachedSegmentRuns(key,runs,info=null){
 try{
  const cache=await volumeCache();if(!cache)return false;
  const bytes=packRuns(runs),writer=await cache.begin(key,{slices:1,bytesPerSlice:bytes.byteLength,info:{kind:'segment-runs',...(info||{})}});
  try{await writer.write(0,bytes);await writer.commit()}catch(e){await writer.abort();throw e}
  if(info)await pruneOtherFilterSettings(cache,info,key);
  await cache.prune(await volumeCacheBudget(),{keep:key});return true;
 }catch(e){console.warn('Segment runs cache store failed.',e);return false}
}
