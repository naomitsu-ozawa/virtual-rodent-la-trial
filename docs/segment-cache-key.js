// Cache key of a segment's runs. Kept free of DOM-bound imports so the unit tests can use it directly.
// `filterSignature` (sourceFilterSignature) already carries every filter parameter, including the bilateral
// sigmaHU and the algorithm version, so changing either gives a different key.
import { cacheKey } from './gpu-volume-cache.js?v=20261022-build655';
import { datasetFingerprint } from './project-file.js?v=20261022-build655';
import { RUNS_FORMAT } from './run-pack.js?v=20261022-build655';
// the segment settings that decide its voxels (shared with the mesh cache key, mesh-cache-key.js)
export function segmentKeyFields(seg){
 return{min:seg.min,max:seg.max,opening:seg.opening,closing:seg.closing,minComponent:seg.minComponent,holeFill:!!seg.holeFill,surfaceMm:+seg.surfaceMm||0,thicknessMm:+seg.thicknessMm||0};
}
export function segmentRunsCacheKey(series,filterSignature,seg,extra=null){
 return cacheKey({kind:'segment-runs',runsFormat:RUNS_FORMAT,dataset:datasetFingerprint(series),filter:filterSignature||'',...(extra?{extra}:{}),
  segment:segmentKeyFields(seg)});
}
