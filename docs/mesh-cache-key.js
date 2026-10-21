// Cache keys of the built surface meshes (mesh-cache.js). Kept free of DOM-bound imports so the unit tests can use it directly:
// everything the app state decides (smoothing, device path, ...) is passed in as plain values by mesh-cache-apply.js.
//
// A key must hold EVERY input that can change the mesh: a missing input would show an old mesh for new settings, which is a
// wrong result, not a slow one. The functions below therefore throw on a missing input instead of leaving it out of the key.
import { cacheKey } from './gpu-volume-cache.js?v=20261021-build634';
import { datasetFingerprint } from './project-file.js?v=20261021-build634';
import { segmentKeyFields } from './segment-cache-key.js?v=20261021-build634';
import { packRuns } from './run-pack.js?v=20261021-build634';

// Version of the mesh GENERATION. Raise it whenever a change makes the same inputs build a different mesh: the surface
// extraction (GPU surface nets / run faces), the smoothing (constrained-smooth.js), the chunking and halo, the vertex merge or
// the normals (surface-mesh.js, mesh-geometry.js, the GPU mesh kernel in gpu-compute.js / gpu-shaders.js).
// Entries of an older version are never read and are deleted at the next store.
// 2: the constrained smoothing replaced Taubin / the isosurface / the GPU blur, halos by strength, seam copy.
// 3: the normals of a smoothed chunk from the whole chunk with its halo (no one-sided normals at the seams).
export const MESH_FORMAT=3;

// What the dataset fingerprint (ids, size, spacing) does not tell: the size of every slice file and how its pixels are decoded.
// A different file set with the same UIDs (re-exported, cropped, edited) gives another digest.
export async function sliceContentDigest(series){
 const rows=(series?.slices||[]).map(s=>[s?.file?.size??null,s?.slope??null,s?.intercept??null,s?.bits??null,s?.signed?1:0,s?.ts??null]);
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows))));
 return[...hash].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const need=(i,names)=>{for(const n of names)if(i[n]==null)throw new Error('mesh cache key: missing '+n)};
function common(i,part){
 need(i,['series','content','smoothing','route','exclusive']);need(i.smoothing,['enabled','strength']);need(i.exclusive,['mode','order']);
 return{kind:'segment-mesh',meshFormat:MESH_FORMAT,part,
  dataset:datasetFingerprint(i.series),content:i.content,filter:i.filter||'',
  // surface smoothing: on / off and its strength (the strength moves every smoothed vertex)
  smoothing:{enabled:!!i.smoothing.enabled,strength:+i.smoothing.strength||0},
  // 3D resolution setting (the GPU volume plan; the surface itself is built from the full data, but the setting is part of the key)
  resolution:i.resolution??null,
  // how this device builds the mesh (touch / desktop, chunk sizes, GPU or CPU, ...): a different route can give a different mesh
  route:i.route,
  // segment overlap mode and priority order (they decide the effective ranges / voxel takers)
  exclusive:{mode:i.exclusive.mode,order:[...i.exclusive.order]}};
}
// the run surface of one segment (processed and plain segments drawn from their final runs, buildEditableRunsGroup)
//   key, seg, sources (segmentSourceSignature(key,false)), memoryPath, runsHash (runsDigest of the final runs it is built from)
export function runSurfaceMeshKey(i){
 need(i,['key','seg','runsHash']);
 return cacheKey({...common(i,'run-surface'),segmentKey:i.key,segment:segmentKeyFields(i.seg),sources:i.sources||'',memoryPath:!!i.memoryPath,runsHash:i.runsHash});
}
// the whole base surface (every segment streamed as plain HU-range meshes by render3DSourceBacked), all in one entry because the
// chunking of one segment follows the size of the others'
//   segments: [{key, seg}] in build order
export function baseMeshKey(i){
 need(i,['segments']);
 if(!Array.isArray(i.segments)||!i.segments.length)throw new Error('mesh cache key: no segments');
 return cacheKey({...common(i,'base'),segments:i.segments.map(s=>{need(s,['key','seg']);return{key:s.key,segment:segmentKeyFields(s.seg)}})});
}
// content hash of the final runs a run surface is built from: with it the key covers the voxels themselves, whatever settings
// or edits produced them
export async function runsDigest(runs){
 const bytes=packRuns(runs),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return[...hash].map(b=>b.toString(16).padStart(2,'0')).join('');
}
