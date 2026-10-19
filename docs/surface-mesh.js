// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { indexedGeometryFromTrianglePositions, makeSource3DCoordinates, makeVolume3DCoordinates, Float32FaceBuilder, appendAnalysisRunBoundaryFaces } from './mesh-geometry.js?v=20261019-build625';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { createSurfaceMaterial } from './mesh-material.js?v=20261019-build625';
import { list, surfaceSmoothStrength } from './ui-shell.js?v=20261019-build625';
import { segmentState, segmentEditState } from './segments.js?v=20261019-build625';
import { surfaceSmoothingActive } from './settings.js?v=20261019-build625';
import { frameYield } from './utils.js?v=20261019-build625';
import { constrainedSmoothPositions, constrainedSmoothSchedule } from './constrained-smooth.js?v=20261019-build625';
import { smoothChunkHalo, createSeamLinker, OrderedChunkSmoother } from './smooth-chunks.js?v=20261019-build625';
import { smoothMethod } from './smooth-workers.js?v=20261019-build625';
// ignoreCut: runs that are not the segment itself (an analysis region), so the
// segment's raw cut faces do not apply
// slices of the neighbouring chunks smoothed with a chunk: smoothChunkHalo
// chunk size of the run surface in floats; tests set override to make small volumes take the chunked path (as a 512³ one)
export const runSurfaceChunkFloats={override:0};
// twice as large on a desktop while smoothing (each chunk is smoothed with halo slices on both sides)
export function runSurfaceChunkLimit(smooth=surfaceSmoothingActive()){return runSurfaceChunkFloats.override||((navigator.maxTouchPoints||0)>0?4:smooth?16:8)*1024*1024}
// material of a segment surface (the mesh cache rebuilds materials from the CURRENT segment settings, never from storage)
export function surfaceMaterialParams(seg,key,smooth=surfaceSmoothingActive()){
 return{color:seg.color,transparent:seg.opacity<.999,opacity:seg.opacity,roughness:key==='bone'?.55:.8,metalness:0,side:THREE.DoubleSide,depthWrite:seg.opacity>.55,flatShading:!smooth};
}
// everything about HOW the run surface of volume v is built that the segment settings do not say (mesh cache key): the
// smoothing path taken, chunk size and halo, where the chunks are smoothed (GPU / CPU), device class and the volume's geometry
export function runSurfaceRoute(v){
 const touch=(navigator.maxTouchPoints||0)>0;
 return{smooth:surfaceSmoothingActive(),chunkFloats:runSurfaceChunkLimit(),halo:surfaceSmoothingActive()?smoothChunkHalo(+surfaceSmoothStrength.value):0,touch,method:surfaceSmoothingActive()?smoothMethod():'',
  grid:[v.columns,v.rows,v.slices],spacing:[...(v.spacing||[])].map(Number),sourceBacked:!!v.sourceBacked};
}
export async function buildEditableRunsGroup(v,runs,key,shouldContinue=null,forceRaw=false,ignoreCut=false){
 const seg=segmentState[key],st=segmentEditState[key],smooth=!forceRaw&&surfaceSmoothingActive(),hasRawCut=!ignoreCut&&!!(st?.rawCutSurface&&st?.cutRuns);
 // no one-piece isosurface any more (a blurred field and marching tetrahedra, then Taubin): every run surface is
 // the voxel faces, smoothed by the constrained smoothing (constrained-smooth.js) chunk by chunk
 const coords=v.sourceBacked?makeSource3DCoordinates(v.series):makeVolume3DCoordinates(v),group=new THREE.Group(),builder=new Float32FaceBuilder(),limit=runSurfaceChunkLimit(smooth),pinnedKeys=hasRawCut?new Set():null;
 const params=surfaceMaterialParams(seg,key,smooth);
 const perChunkSmooth=smooth,halo=perChunkSmooth?smoothChunkHalo(+surfaceSmoothStrength.value):0;
 const addMesh=(geometry,z)=>{const mesh=new THREE.Mesh(geometry,createSurfaceMaterial(params,key));mesh.name='edited_segment_'+key+'_'+z;mesh.userData.segmentKey=key;mesh.userData.editSurface=true;mesh.userData.displayScale=coords.scale;group.add(mesh)};
 const smoother=perChunkSmooth?new OrderedChunkSmoother({strength:+surfaceSmoothStrength.value,coords,seams:createSeamLinker(),onGeometry:addMesh,isCurrent:shouldContinue}):null;
 let coreFrom=0,chunkZ0=0;
 const flush=(z,from,to)=>{const positions=builder.take();if(!positions||to<=from){if(pinnedKeys)pinnedKeys.clear();return}
  if(smoother)smoother.submit(positions,{coreFrom:from,coreTo:to,pinnedKeys,zLow:chunkZ0>0?chunkZ0:null,zHigh:z+1<v.slices?z+1:null,tag:z});
  else addMesh(geometryFromSourcePositions(positions,false),z);
  if(pinnedKeys)pinnedKeys.clear()};
 const appendSlice=z=>appendAnalysisRunBoundaryFaces(builder,runs[z],z?runs[z-1]:null,z+1<v.slices?runs[z+1]:null,coords,z,hasRawCut?st.cutRuns[z]:null,hasRawCut&&z?st.cutRuns[z-1]:null,hasRawCut&&z+1<v.slices?st.cutRuns[z+1]:null,pinnedKeys);
 const beginChunk=z0=>{chunkZ0=z0;for(let z=Math.max(0,z0-halo);z<z0;z++)appendSlice(z);coreFrom=builder.length};
 const endChunk=z=>{const coreTo=builder.length;for(let k=z+1;k<=Math.min(v.slices-1,z+halo);k++)appendSlice(k);flush(z,coreFrom,coreTo)};
 try{
  beginChunk(0);
  for(let z=0;z<v.slices;z++){
   if(shouldContinue&&!shouldContinue())throw new Error('__SUPERSEDED__');
   appendSlice(z);if(builder.length-coreFrom>=limit&&z+1<v.slices){endChunk(z);beginChunk(z+1);if(smoother)await smoother.throttle()}
   if((z&15)===0){await frameYield();if(shouldContinue&&!shouldContinue())throw new Error('__SUPERSEDED__')}
  }
  endChunk(v.slices-1);
  if(smoother){await smoother.drain();if(shouldContinue&&!shouldContinue())throw new Error('__SUPERSEDED__')}
  return group.children.length?group:null;
 }catch(e){smoother?.cancel();dispose(group);throw e}
}
export function geometryFromSourcePositions(positions,applySmoothing=true,pinnedKeys=null){
 if(!positions||!positions.length)return null;
 let geometry;
 if(surfaceSmoothingActive()&&applySmoothing){
  geometry=indexedGeometryFromTrianglePositions(positions);
  let pinned=null;
  if(pinnedKeys?.size){pinned=new Set();const p=geometry.getAttribute('position');for(let i=0;i<p.count;i++){const k=Math.fround(p.getX(i))+','+Math.fround(p.getY(i))+','+Math.fround(p.getZ(i));if(pinnedKeys.has(k))pinned.add(i)}}
  constrainedSmoothGeometry(geometry,+surfaceSmoothStrength.value,pinned);
 }else{
  geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,0,0),3);
 }
 return geometry;
}
// the constrained smoothing of a welded voxel-face geometry (constrained-smooth.js) replaces Taubin: every vertex
// stays within half a voxel of its lattice point, so the steps of a staircase relax but no 1-voxel structure is lost.
// pinned: Set of vertex indices that keep their place (the raw cut faces)
export function constrainedSmoothGeometry(geometry,strength,pinned=null,box=null){
 const pos=geometry.getAttribute('position'),index=geometry.index;
 if(!pos||!index||!(strength>0))return null;
 let flags=null;if(pinned?.size){flags=new Uint8Array(pos.count);for(const i of pinned)flags[i]=1}
 const r=constrainedSmoothPositions(pos.array,index.array,{...constrainedSmoothSchedule(strength),pinned:flags,box});
 pos.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();return r;
}
export function dispose(o){o.traverse(c=>{const release=()=>{c.geometry?.dispose?.();if(Array.isArray(c.material))c.material.forEach(m=>m.dispose());else c.material?.dispose?.()};const pending=c.userData?.gpuCompletion;if(pending?.then)pending.then(release,release);else release()})}
