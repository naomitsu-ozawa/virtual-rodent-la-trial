// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import './three-state.js?v=20261023-build659';
import { labelForProject, normalizeAnalysisLabel } from './analysis-label.js?v=20261023-build659';
import { set3DBusy, set3DBusyLabel } from './three-status.js?v=20261023-build659';
import { meshSegmentRanges, refreshEditedSegmentSurface, segmentUsesRunSurface, ensureGpuResidentCpuPositions } from './surface-build.js?v=20261023-build659';
import { activeSeries, sceneState, setAnalysisFilterSignature, currentLanguage, setAnalysisEditTool, setAnalysisEditTargetKey, setAnalysisEditTargetMode, setAnalysisCutStroke, setAnalysisCutScreen, setAnalysisPendingCut, current3DVolume, volume, volumeAnalysisMode, analysisRegions, threeRenderMode, threeDDirty, analysisFocusedRegionId, volumeAnalysisBusy, setVolumeAnalysisBusy, setAnalysisRegions, incNextAnalysisRegionId, nextAnalysisColorIndex, incNextAnalysisColorIndex, setNextAnalysisColorIndex, analysisEditTargetKey, sourceVolume, setAnalysisFocusedRegionId, analysisEditTool, analysisEditTargetMode } from './state.js?v=20261023-build659';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { createSurfaceMaterial } from './mesh-material.js?v=20261023-build659';
import { eachGeometryTriangleRange, makeSource3DCoordinates, makeVolume3DCoordinates, Float32FaceBuilder, appendAnalysisRunBoundaryFaces, groupToBinaryStl } from './mesh-geometry.js?v=20261023-build659';
import { surfaceSmoothingActive } from './settings.js?v=20261023-build659';
import { SEGMENT_PRESET_ORDER, gpuSegmentOrder, analysisRegionShown, segmentState, getProcessedSegmentMask, segmentEditState, segmentEditActive, segmentHasProcessedMask, segmentEditsChanged } from './segments.js?v=20261023-build659';
import { request3DRender } from './scene3d.js?v=20261023-build659';
import { footer, surfaceSmoothStrength, analysisEditTargetSelect, selected, analysisCutDepth, analysisCutYaw, analysisCutPitch, analysisCutOffset, threeEditOverlay, volumeAnalysisResult, analysisSummary } from './ui-shell.js?v=20261023-build659';
import { dispose, geometryFromSourcePositions, buildEditableRunsGroup } from './surface-mesh.js?v=20261023-build659';
import { ensureSegmentBaseRuns, getFinalSegmentRuns, sourceAnalysisBlockDepth, sourceSegmentRunBlockGpu, sourceSegmentMaskBlock } from './segment-runs.js?v=20261023-build659';
import { unionAnalysisRuns, analysisRunsVoxelCount, unionRunArrays, intersectRunArrays, subtractRunArrays, componentsFromRuns, analysisRunsOverlap, componentsFromRunsAsync, analysisRunsContain, sourceResultToAnalysisRuns, maskToAnalysisRuns, RunUnionFind, consumeGpuAnalysisRuns, sourceRunSlice } from './run-length.js?v=20261023-build659';
import { frameYield } from './utils.js?v=20261023-build659';
import { smoothChunkHalo, createSeamLinker, OrderedChunkSmoother } from './smooth-chunks.js?v=20261023-build659';
import './section-view.js?v=20261023-build659';
import { setGpuComputeBackend, ensureGpuFilterDevice, gpuValidationScope, runGpuSourceFilters, gpuFilterRuntime } from './gpu-compute.js?v=20261023-build659';
import { clearSegmentEditCache } from './segment-ui.js?v=20261023-build659';
import { clearCutResultPreview, updateThreeEditUi, analysisRegionById, editTargetRegions, cutRunsFromVoxelStroke, cutWidthMm, updateAnalysisEditorControls } from './edit-tools.js?v=20261023-build659';
import { currentFilterSignature, sourceFilterStages, readMemoryRegion, sourceFilterRuntime, getFilteredSourcePlaneValues, getCachedSourceSlice } from './source-filters.js?v=20261023-build659';
import { downloadBlob } from './utils.js?v=20261023-build659';
import { renderAnalysisResults, disposeAnalysisRegionMesh, setAnalysisFocusedRegion } from './analysis-results.js?v=20261023-build659';
import { tr } from './i18n.js?v=20261023-build659';
import { syncGpuVolumeEdits } from './gpu-volume-data.js?v=20261023-build659';
import { surfaceEditsPending } from './rebuild-3d.js?v=20261023-build659';
import { renderAll } from './mpr-render.js?v=20261023-build659';
import { makeVoxelProjector, polygonBounds, componentFullyInside } from './lasso.js?v=20261023-build659';
export function clearThreeEditOverlay(){const ctx=threeEditOverlay?.getContext('2d');ctx?.clearRect(0,0,threeEditOverlay.width,threeEditOverlay.height)}
export const ANALYSIS_REGION_COLORS=[0x00d8ff,0xff9f1c,0x7ae582,0xff4d8d,0xf4e409,0x9b5cff,0xff5a5f,0x2ec4b6,0x4361ee,0xf15bb5,0xb5e48c,0xc08552,0x80ffdb,0xe0aaff];
export function nextAnalysisColor(){
 const color=ANALYSIS_REGION_COLORS[nextAnalysisColorIndex%ANALYSIS_REGION_COLORS.length];
 incNextAnalysisColorIndex(false);return color;
}
export function analysisRegionAtVoxel(x,y,z){
 const focused=analysisRegionById(analysisFocusedRegionId);
 if(analysisRegionShown(focused)&&analysisRunsContain(focused.runsBySlice,x,y,z))return focused;
 return analysisRegions.find(r=>analysisRegionShown(r)&&analysisRunsContain(r.runsBySlice,x,y,z))||null;
}
export async function connectedComponentVolumeGpuRuns(v,key,seg,x0,y0,z0){
 const device=await ensureGpuFilterDevice();if(!device||segmentHasProcessedMask(key))return null;
 const w=v.columns,h=v.rows,d=v.slices,uf=new RunUnionFind(),sliceRuns=new Array(d),seed={x:Math.max(0,Math.min(w-1,x0)),y:Math.max(0,Math.min(h-1,y0)),z:Math.max(0,Math.min(d-1,z0)),label:null,bestDist2:Infinity},plane=w*h;
 let prevRows=null,done=0;const blockDepth=sourceAnalysisBlockDepth(w,h);
 try{
  for(let z0b=0;z0b<d;z0b+=blockDepth){
   const coreDepth=Math.min(blockDepth,d-z0b),data=readMemoryRegion(v,{x:0,y:0,z:z0b,width:w,height:h,depth:coreDepth}),target={x:0,y:0,z:0,width:w,height:h,depth:coreDepth};
   const result=await gpuValidationScope(device,'analysis RLE',()=>runGpuSourceFilters(data,w,h,coreDepth,[],target,[{key,seg}],{analysisRuns:true}));
   if(!result?.analysisRuns)return null;
   prevRows=consumeGpuAnalysisRuns(result.items,z0b,coreDepth,w,h,seed,uf,prevRows,sliceRuns);done=z0b+coreDepth;
   analysisSummary.textContent=(currentLanguage==='ja'?'GPU連結成分解析中… ':'GPU connected-component analysis… ')+done+' / '+d;await frameYield();
  }
 }catch(e){setGpuComputeBackend('CPU ANALYSIS · GPU ERROR',e?.message||e);console.warn('GPU connected-component run extraction failed; CPU analysis will be used.',e);return null}
 if(seed.label==null)throw new Error(currentLanguage==='ja'?'選択位置から連結成分を特定できませんでした':'Could not identify a connected component at the selected point');
 const root=uf.find(seed.label),voxels=uf.size[root],mm3=voxels*v.spacing[0]*v.spacing[1]*v.spacing[2];setGpuComputeBackend('WEBGPU ANALYSIS RLE · CPU CONNECTIVITY');return{voxels,mm3,root,uf,sliceRuns};
}
export async function connectedComponentVolumeSource(v,key,seg,x0,y0,z0){
 const w=v.columns,h=v.rows,d=v.slices,analysisRevision=sourceFilterRuntime.revision,uf=new RunUnionFind(),sliceRuns=new Array(d);
 const seed={x:Math.max(0,Math.min(w-1,x0)),y:Math.max(0,Math.min(h-1,y0)),z:Math.max(0,Math.min(d-1,z0)),label:null,bestDist2:Infinity};
 let prevRows=null,done=0,gpuUsed=false,hadCpuPath=false;const blockDepth=sourceAnalysisBlockDepth(w,h);
 analysisSummary.textContent=(currentLanguage==='ja'?'連結成分を解析中… ':'Analyzing connected component… ')+'0 / '+d;
 for(let z0b=0;z0b<d;z0b+=blockDepth){
  if(analysisRevision!==sourceFilterRuntime.revision)throw new Error('__SUPERSEDED__');
  let gpuBlock=null;
  try{gpuBlock=await sourceSegmentRunBlockGpu(v,key,seg,z0b,blockDepth,analysisRevision)}catch(e){if(String(e.message||e)!=='__GPU_ANALYSIS_UNAVAILABLE__'){gpuFilterRuntime.lastError=String(e.message||e);console.warn('GPU source analysis block failed; using CPU mask block.',e)}}
  if(gpuBlock){
   gpuUsed=true;prevRows=consumeGpuAnalysisRuns(gpuBlock.items,z0b,gpuBlock.coreDepth,w,h,seed,uf,prevRows,sliceRuns);done=z0b+gpuBlock.coreDepth;
  }else{
   hadCpuPath=true;setGpuComputeBackend('CPU ANALYSIS · GPU ERROR',gpuFilterRuntime.lastError||'GPU analysis unavailable');
   const masks=await sourceSegmentMaskBlock(v,key,seg,z0b,blockDepth,analysisRevision);
   for(let local=0;local<masks.length;local++){const z=z0b+local,result=sourceRunSlice(masks[local],w,h,z,seed,uf,prevRows);sliceRuns[z]=result.records;prevRows=result.rows;done=z+1}
   setGpuComputeBackend('CPU ANALYSIS · GPU ERROR',gpuFilterRuntime.lastError||'GPU analysis unavailable');
  }
  analysisSummary.textContent=((gpuUsed&&!hadCpuPath)?(currentLanguage==='ja'?'GPU連結成分解析中… ':'GPU connected-component analysis… '):(currentLanguage==='ja'?'連結成分を解析中… ':'Analyzing connected component… '))+done+' / '+d;await frameYield();
 }
 if(seed.label==null)throw new Error(currentLanguage==='ja'?'選択位置から連結成分を特定できませんでした':'Could not identify a connected component at the selected point');
 const root=uf.find(seed.label),voxels=uf.size[root],mm3=voxels*v.spacing[0]*v.spacing[1]*v.spacing[2];
 if(gpuUsed&&!hadCpuPath)setGpuComputeBackend(sourceFilterStages().length?'WEBGPU ANALYSIS FILTER+RLE · CPU CONNECTIVITY':'WEBGPU ANALYSIS RLE · CPU CONNECTIVITY');
 else if(gpuUsed&&hadCpuPath)setGpuComputeBackend('GPU+CPU ANALYSIS',gpuFilterRuntime.lastError||'Some analysis blocks used the exact CPU path');
 return{voxels,mm3,root,uf,sliceRuns};
}
export function surfacePointerVoxel(event,canvas,camera,preferredKey=null){
 if(!sceneState?.obj||!volume)return null;
 const rect=canvas.getBoundingClientRect(),mouse=new THREE.Vector2(((event.clientX-rect.left)/Math.max(rect.width,1))*2-1,-((event.clientY-rect.top)/Math.max(rect.height,1))*2+1),raycaster=new THREE.Raycaster();raycaster.setFromCamera(mouse,camera);
 const hits=raycaster.intersectObjects(sceneState.obj.children,true);
 const hit=hits.find(h=>h.object?.userData?.analysisRegionId===analysisFocusedRegionId)||(preferredKey?hits.find(h=>segmentKeyFromIntersection(h)===preferredKey&&surfaceHitVisible(h)):null)||hits.find(h=>segmentKeyFromIntersection(h)?surfaceHitVisible(h):h.object?.userData?.analysisRegionId);
 if(!hit)return null;
 const v=current3DVolume||volume,[vx,vy,vz]=v.spacing,w=v.columns,h=v.rows,d=v.slices,px=w*vx,py=h*vy,pz=d*vz,scale=3.3/Math.max(px,py,pz,1),local=sceneState.obj.worldToLocal(hit.point.clone());
 return{x:Math.max(0,Math.min(w-1,Math.round((local.x/scale+px/2)/vx))),y:Math.max(0,Math.min(h-1,Math.round((-local.y/scale+py/2)/vy))),z:Math.max(0,Math.min(d-1,Math.round((local.z/scale+pz/2)/vz))),hit};
}
export function surfaceSegmentPointerVoxel(event,canvas,camera,preferredKey=null){
 if(!sceneState?.obj||!volume)return null;
 sceneState.obj.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 const rect=canvas.getBoundingClientRect(),mouse=new THREE.Vector2(((event.clientX-rect.left)/Math.max(rect.width,1))*2-1,-((event.clientY-rect.top)/Math.max(rect.height,1))*2+1),raycaster=new THREE.Raycaster();raycaster.setFromCamera(mouse,camera);
 const targets=cutRaycastSourceMeshes(preferredKey),hits=raycaster.intersectObjects(targets,false),hit=preferredKey?hits.find(h=>segmentKeyFromIntersection(h)===preferredKey&&surfaceHitVisible(h)):hits.find(h=>segmentKeyFromIntersection(h)&&surfaceHitVisible(h));
 if(!hit)return null;
 const key=segmentKeyFromIntersection(hit);if(!key)return null;
 const v=current3DVolume||volume,[vx,vy,vz]=v.spacing,w=v.columns,h=v.rows,d=v.slices,px=w*vx,py=h*vy,pz=d*vz,scale=3.3/Math.max(px,py,pz,1),local=sceneState.obj.worldToLocal(hit.point.clone()),inv=sceneState.obj.matrixWorld.clone().invert(),toVoxelDir=vec=>{const q=vec.clone().transformDirection(inv).normalize();return{x:q.x,y:-q.y,z:q.z}},localRay=toVoxelDir(raycaster.ray.direction),cameraRight=toVoxelDir(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0)),cameraUp=toVoxelDir(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1));
 return{x:Math.max(0,Math.min(w-1,Math.round((local.x/scale+px/2)/vx))),y:Math.max(0,Math.min(h-1,Math.round((-local.y/scale+py/2)/vy))),z:Math.max(0,Math.min(d-1,Math.round((local.z/scale+pz/2)/vz))),ray:localRay,right:cameraRight,up:cameraUp,hit,key};
}
const NEAR_OFFSETS=(()=>{const o=[];for(let dz=-2;dz<=2;dz++)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)o.push([dx,dy,dz,dx*dx+dy*dy+dz*dz]);return o.sort((a,b)=>a[3]-b[3])})();
export async function nearestSegmentVoxel(v,x,y,z,key=null){
 for(const [dx,dy,dz] of NEAR_OFFSETS){
  const k=await segmentKeyAtVoxel(v,x+dx,y+dy,z+dz);
  if(k&&(!key||k===key))return{x:x+dx,y:y+dy,z:z+dz,key:k};
 }
 return null;
}
export async function segmentKeyAtVoxel(v,x,y,z){
 const w=v.columns,h=v.rows,d=v.slices;if(x<0||y<0||z<0||x>=w||y>=h||z>=d)return null;
 for(const key of SEGMENT_PRESET_ORDER){
  const seg=segmentState[key];if(!seg.active||!seg.enabled||!(segmentEditActive(key)||(v.sourceBacked&&segmentHasProcessedMask(key))))continue;
  const runs=await getFinalSegmentRuns(key,v);if(analysisRunsContain(runs,x,y,z))return key;
 }
 let value=null;
 if(v.sourceBacked){
  if(sourceFilterStages().length){
   const values=await getFilteredSourcePlaneValues('axial',z,v.series,'analysis-pick');value=values[y*w+x];
  }else{
   const values=await getCachedSourceSlice(v.series.slices[z]);value=values[y*w+x];
  }
 }else value=v.data[z*h*w+y*w+x];
 for(const key of SEGMENT_PRESET_ORDER){
  const seg=segmentState[key];if(!seg.active||!seg.enabled||segmentEditActive(key)||(v.sourceBacked&&segmentHasProcessedMask(key)))continue;
  if(!v.sourceBacked&&segmentHasProcessedMask(key)){const mask=getProcessedSegmentMask(v,seg,key);if(mask[z*h*w+y*w+x]===1)return key}
  else if(value>=seg.min&&value<=seg.max)return key;
 }
 return null;
}
export async function analyzeVolumeComponentAtVoxel(analysisVolume,key,x,y,z){
 const [vx,vy,vz]=analysisVolume.spacing,w=analysisVolume.columns,h=analysisVolume.rows,d=analysisVolume.slices,seg=segmentState[key];
 // Filtered source-backed volumes: analyse the cached filtered runs of the
 // segment (built once per filter/segment setting, shared with the edit
 // tools) instead of re-filtering the whole volume on every click.
 if(segmentEditActive(key)||(analysisVolume.sourceBacked&&(segmentHasProcessedMask(key)||sourceFilterStages().length>0))){
  const showRunProgress=(done,total)=>{const text=(currentLanguage==='ja'?'フィルター適用済みの領域を準備中… ':'Preparing filtered segment… ')+done+' / '+total;analysisSummary.textContent=text;set3DBusyLabel(text)};
  const runs=await getFinalSegmentRuns(key,analysisVolume,showRunProgress),comps=await componentsFromRunsAsync(runs,w,h,d,(phase,done,total)=>{set3DBusyLabel((currentLanguage==='ja'?'領域を解析中… ':'Analyzing region… ')+done+' / '+total)});let comp=comps.find(item=>analysisRunsContain(item.runsBySlice,x,y,z));
  if(!comp){for(let r=1;r<=2&&!comp;r++)for(let dz=-r;dz<=r&&!comp;dz++)for(let dy=-r;dy<=r&&!comp;dy++)for(let dx=-r;dx<=r;dx++){const ix=x+dx,iy=y+dy,iz=z+dz;if(ix<0||iy<0||iz<0||ix>=w||iy>=h||iz>=d)continue;comp=comps.find(item=>analysisRunsContain(item.runsBySlice,ix,iy,iz));if(comp)break}}
  if(!comp)throw new Error(currentLanguage==='ja'?'処理後の領域を特定できませんでした':'Could not identify the processed component');
  const mm3=comp.voxels*vx*vy*vz;setGpuComputeBackend('PROCESSED RLE · CPU CONNECTIVITY');return addAnalysisRegion(analysisVolume,{key,segmentKeys:[key],runsBySlice:comp.runsBySlice,voxels:comp.voxels,mm3});
 }
 if(analysisVolume.sourceBacked){
  const result=await connectedComponentVolumeSource(analysisVolume,key,seg,x,y,z),runsBySlice=sourceResultToAnalysisRuns(result,d);
  return addAnalysisRegion(analysisVolume,{key,segmentKeys:[key],runsBySlice,voxels:result.voxels,mm3:result.mm3});
 }
 const gpuResult=await connectedComponentVolumeGpuRuns(analysisVolume,key,seg,x,y,z);
 if(gpuResult){
  const runsBySlice=sourceResultToAnalysisRuns(gpuResult,d);return addAnalysisRegion(analysisVolume,{key,segmentKeys:[key],runsBySlice,voxels:gpuResult.voxels,mm3:gpuResult.mm3});
 }
 setGpuComputeBackend('CPU ANALYSIS');
 const processedMask=getProcessedSegmentMask(analysisVolume,seg,key),inside=(ix,iy,iz)=>ix>=0&&iy>=0&&iz>=0&&ix<w&&iy<h&&iz<d&&processedMask[iz*h*w+iy*w+ix]===1;
 if(!inside(x,y,z)){
  let found=null;for(let r=1;r<=2&&!found;r++)for(let dz=-r;dz<=r&&!found;dz++)for(let dy=-r;dy<=r&&!found;dy++)for(let dx=-r;dx<=r;dx++){const ix=x+dx,iy=y+dy,iz=z+dz;if(inside(ix,iy,iz)){found=[ix,iy,iz];break}}
  if(!found)throw new Error(currentLanguage==='ja'?'選択位置から領域を特定できませんでした':'Could not identify a component at the selected point');
  [x,y,z]=found;
 }
 const result=await connectedComponentVolume(analysisVolume,seg,x,y,z,processedMask),runsBySlice=maskToAnalysisRuns(result.mask,w,h,d);
 return addAnalysisRegion(analysisVolume,{key,segmentKeys:[key],runsBySlice,voxels:result.voxels,mm3:result.mm3});
}
export async function analyzeVolumeAtVoxel(x,y,z,keyHint=null,showResult=true){
 if(!volume||volumeAnalysisBusy)return false;const analysisVolume=current3DVolume||volume;
 setVolumeAnalysisBusy(true);
 if(showResult){volumeAnalysisResult.classList.remove('is-hidden');set3DBusy(true,currentLanguage==='ja'?'体積解析中…':'Analyzing volume…',false);await frameYield()}
 renderAnalysisResults(currentLanguage==='ja'?'解析中…':'Analyzing…');
 try{
  // a tap on the smoothed surface can land in the voxel just outside the segment (the surface lies up to about
  // half a voxel off the voxel faces): the nearest voxel of the segment within two voxels is analysed
  const near=await nearestSegmentVoxel(analysisVolume,x,y,z,keyHint);if(near){x=near.x;y=near.y;z=near.z}
  const key=keyHint||near?.key||await segmentKeyAtVoxel(analysisVolume,x,y,z);
  if(!key){renderAnalysisResults(currentLanguage==='ja'?'選択位置に解析対象の領域がありません':'No analyzable segment at the selected point');return false}
  await analyzeVolumeComponentAtVoxel(analysisVolume,key,x,y,z);return true;
 }catch(e){
  if(String(e.message||e)!=='__SUPERSEDED__'){console.error(e);renderAnalysisResults((currentLanguage==='ja'?'体積解析エラー: ':'Volume analysis error: ')+String(e.message||e))}
  return false;
 }finally{
  setVolumeAnalysisBusy(false);
  if(showResult)set3DBusy(false,'',false);
  renderAnalysisResults();
 }
}
export function returnToNavigate(){
 if(analysisEditTool==='select')return;
 setAnalysisEditTool('select');setAnalysisEditTargetKey(analysisEditTargetMode==='auto'?null:analysisEditTargetMode);updateAnalysisEditorControls();
}
export async function selectRegionsInLasso(poly,canvas,camera){
 if(!volume||!sceneState?.obj||volumeAnalysisBusy)return;
 const analysisVolume=current3DVolume||volume,[vx,vy,vz]=analysisVolume.spacing,w=analysisVolume.columns,h=analysisVolume.rows,d=analysisVolume.slices;
 const keys=analysisEditTargetMode==='auto'?SEGMENT_PRESET_ORDER.filter(k=>segmentState[k]?.active&&segmentState[k]?.enabled):[analysisEditTargetMode];
 sceneState.obj.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 const rect=canvas.getBoundingClientRect(),viewProjection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 const project=makeVoxelProjector(analysisVolume,sceneState.obj.matrixWorld.elements,viewProjection.elements,rect.width,rect.height),bounds=polygonBounds(poly);
 setVolumeAnalysisBusy(true);set3DBusy(true,currentLanguage==='ja'?'囲み範囲の領域を解析中…':'Analyzing lasso selection…',false);await frameYield();
 let pieces=0,failed=false;const notes=[]; // diagnostics: per segment, components fully inside the loop / all components
 try{
  for(const key of keys){
   const runs=await getFinalSegmentRuns(key,analysisVolume);if(!runs){notes.push(key+': 0');continue}
   const comps=await componentsFromRunsAsync(runs,w,h,d,(phase,done,total)=>{set3DBusyLabel((currentLanguage==='ja'?'囲み範囲の領域を解析中… ':'Analyzing lasso selection… ')+(total?Math.round(done/total*100)+'%':''))});
   const inside=[];
   for(let i=0;i<comps.length;i++){
    if(componentFullyInside(comps[i].runsBySlice,project,poly,{bounds}))inside.push(comps[i]);
    if(i%200===199)await frameYield();
   }
   notes.push(key+': '+inside.length+'/'+comps.length);
   if(!inside.length)continue;
   let merged=inside[0].runsBySlice,voxels=inside[0].voxels;
   for(let i=1;i<inside.length;i++){merged=unionRunArrays(merged,inside[i].runsBySlice,d);voxels+=inside[i].voxels}
   await addAnalysisRegion(analysisVolume,{key,segmentKeys:[key],runsBySlice:merged,voxels,mm3:voxels*vx*vy*vz,merged:inside.length>1});
   pieces+=inside.length;
  }
  setGpuComputeBackend('PROCESSED RLE · LASSO SELECTION');
 }catch(e){failed=true;if(String(e.message||e)!=='__SUPERSEDED__'){console.error(e);renderAnalysisResults((currentLanguage==='ja'?'囲み選択エラー: ':'Lasso selection error: ')+String(e.message||e))}}
 finally{setVolumeAnalysisBusy(false);set3DBusy(false,'',false);renderAnalysisResults()}
 updateAnalysisEditorControls();
 if(failed)return;
 footer.textContent=(currentLanguage==='ja'?'囲んで選択（輪の中に完全に入った部品 / 全部品）: ':'Lasso (components fully inside / all): ')+notes.join(', ')+(pieces?'':(currentLanguage==='ja'?' — 選択なし':' — nothing selected'));
 if(pieces)returnToNavigate();
 updateThreeEditUi(pieces?(currentLanguage==='ja'?pieces+'個の塊を選択しました · 「選択領域を削除」で削除できます':pieces+' piece(s) selected · use Delete selected region'):(currentLanguage==='ja'?'囲みの中に完全に入っている領域がありません':'No piece lies completely inside the loop'));
}
// "n selected" after a selection change (the 3D view shows no tick, only the list does)
export function selectionCountText(message){
 const n=analysisRegions.filter(r=>r.selected).length;
 return message+(currentLanguage==='ja'?' · 選択中 '+n+' 件':' · '+n+' selected');
}
export function deselectAllAnalysisRegions(){
 for(const r of analysisRegions)r.selected=false;
 setAnalysisFocusedRegion(null);updateAnalysisEditorControls();
 updateThreeEditUi(selectionCountText(currentLanguage==='ja'?'選択をすべて外しました':'All regions unselected'));
}
export async function deselectRegionsInLasso(poly,canvas,camera){
 if(!volume||!sceneState?.obj||volumeAnalysisBusy)return;
 const v=current3DVolume||volume,[vx,vy,vz]=v.spacing,w=v.columns,h=v.rows,d=v.slices,vox=vx*vy*vz;
 const keys=analysisEditTargetMode==='auto'?SEGMENT_PRESET_ORDER:[analysisEditTargetMode];
 sceneState.obj.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 const rect=canvas.getBoundingClientRect(),viewProjection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 const project=makeVoxelProjector(v,sceneState.obj.matrixWorld.elements,viewProjection.elements,rect.width,rect.height),bounds=polygonBounds(poly);
 setVolumeAnalysisBusy(true);set3DBusy(true,currentLanguage==='ja'?'囲み範囲の選択を外しています…':'Unselecting inside the loop…',false);await frameYield();
 let pieces=0,failed=false;
 try{
  for(const r of analysisRegions.filter(r=>r.selected&&r.runsBySlice&&r.segmentKeys.some(k=>keys.includes(k)))){
   const comps=await componentsFromRunsAsync(r.runsBySlice,w,h,d,(phase,done,total)=>{set3DBusyLabel((currentLanguage==='ja'?'囲み範囲の選択を外しています… ':'Unselecting inside the loop… ')+(total?Math.round(done/total*100)+'%':''))});
   const inside=[],outside=[];
   for(let i=0;i<comps.length;i++){(componentFullyInside(comps[i].runsBySlice,project,poly,{bounds})?inside:outside).push(comps[i]);if(i%200===199)await frameYield()}
   if(!inside.length)continue;
   pieces+=inside.length;
   if(!outside.length){r.selected=false;if(analysisFocusedRegionId===r.id)setAnalysisFocusedRegionId(null);continue}
   const union=list=>{let runs=list[0].runsBySlice,voxels=list[0].voxels;for(let i=1;i<list.length;i++){runs=unionRunArrays(runs,list[i].runsBySlice,d);voxels+=list[i].voxels}return{runs,voxels}};
   const kept=union(outside),left=union(inside);
   disposeAnalysisRegionMesh(r);r.runsBySlice=kept.runs;r.voxels=kept.voxels;r.mm3=kept.voxels*vox;r.merged=outside.length>1;
   const id=incNextAnalysisRegionId(false),split={id,regionId:'r'+id,groupId:inside.length>1?'g'+id:null,key:r.key,segmentKeys:[...r.segmentKeys],runsBySlice:left.runs,voxels:left.voxels,mm3:left.voxels*vox,merged:inside.length>1,selected:false,focused:false,visible:r.visible,meshGroup:null,color:r.color};
   // the label goes with the piece that holds its anchor voxel (the kept piece when neither does)
   if(r.label){const a=r.label.anchor,ai=Math.round(a.i),aj=Math.round(a.j),ak=Math.round(a.k);if(!analysisRunsContain(kept.runs,ai,aj,ak)&&analysisRunsContain(left.runs,ai,aj,ak)){split.label=r.label;delete r.label}}
   analysisRegions.splice(analysisRegions.indexOf(r)+1,0,split);
   await attachAnalysisRegion(r,v);await attachAnalysisRegion(split,v);
  }
 }catch(e){failed=true;if(String(e.message||e)!=='__SUPERSEDED__'){console.error(e);renderAnalysisResults((currentLanguage==='ja'?'囲み解除エラー: ':'Lasso unselect error: ')+String(e.message||e))}}
 finally{setVolumeAnalysisBusy(false);set3DBusy(false,'',false)}
 setAnalysisFocusedRegion(analysisFocusedRegionId,null,false);syncVolumeAnalysisOverlay();updateAnalysisEditorControls();
 if(failed)return;
 if(pieces)returnToNavigate();
 updateThreeEditUi(selectionCountText(pieces?(currentLanguage==='ja'?pieces+'個の塊の選択を外しました':'Unselected '+pieces+' piece(s)'):(currentLanguage==='ja'?'囲みの中に完全に入っている選択中の塊がありません':'No selected piece lies completely inside the loop')));
}
export function toggleAnalysisRegionSelection(region,voxel=null){
 if(region.selected){
  region.selected=false;if(analysisFocusedRegionId===region.id)setAnalysisFocusedRegion(null);else renderAnalysisResults();
  updateAnalysisEditorControls();returnToNavigate();updateThreeEditUi(selectionCountText(currentLanguage==='ja'?'選択を外しました':'Region unselected'));return false;
 }
 region.selected=true;setAnalysisFocusedRegion(region.id,voxel);updateAnalysisEditorControls();returnToNavigate();updateThreeEditUi(selectionCountText(currentLanguage==='ja'?'領域を選択しました · 「選択領域を削除」で削除できます':'Region selected · use Delete selected region'));return true;
}
export async function analyzeEditRegionAtPointer(event,canvas,camera){
 if(!volume||!sceneState?.obj||volumeAnalysisBusy)return;
 const preferredKey=analysisEditTargetMode==='auto'?null:analysisEditTargetMode;
 let picked=null;
 if(threeRenderMode==='volume'&&sceneState.medicalVolume?.active){
  setGpuComputeBackend('WEBGPU VOLUME PICK');
  if(preferredKey){const rect=canvas.getBoundingClientRect(),items=await sceneState.medicalVolume.pickMany([{clientX:event.clientX,clientY:event.clientY}],camera,sceneState.obj,segmentState,gpuSegmentOrder(),preferredKey);picked=items?.[0]||null}
  else picked=await sceneState.medicalVolume.pick(event.clientX,event.clientY,camera,sceneState.obj,segmentState,gpuSegmentOrder());
  if(!picked){updateThreeEditUi(currentLanguage==='ja'?'選択できる領域がありません':'No selectable region');return}
 }else{
  picked=surfaceSegmentPointerVoxel(event,canvas,camera,preferredKey);
  if(!picked){updateThreeEditUi(currentLanguage==='ja'?'選択できる領域がありません':'No selectable region');return}
 }
 const key=preferredKey||picked.key;if(!key)return;
 const existing=analysisRegionAtVoxel(picked.x,picked.y,picked.z);
 // a result already there toggles its tick (also after a project load)
 if(existing?.segmentKeys?.includes(key)){toggleAnalysisRegionSelection(existing,{x:picked.x,y:picked.y,z:picked.z});return}
 set3DBusy(true,currentLanguage==='ja'?'領域を解析中…':'Analyzing region…',false);await frameYield();
 let ok=false;try{ok=await analyzeVolumeAtVoxel(picked.x,picked.y,picked.z,key,false)}finally{set3DBusy(false,'',false)}
 if(ok){updateAnalysisEditorControls();returnToNavigate();updateThreeEditUi(currentLanguage==='ja'?'領域を選択しました · 「選択領域を削除」で削除できます':'Region selected · use Delete selected region')}
}
export async function analyzeVolumeAtPointer(event,canvas,camera){
 if(!volume||!sceneState?.obj||volumeAnalysisBusy)return;
 const analysisVolume=current3DVolume||volume,[vx,vy,vz]=analysisVolume.spacing,w=analysisVolume.columns,h=analysisVolume.rows,d=analysisVolume.slices,px=w*vx,py=h*vy,pz=d*vz;
 let key,x,y,z;
 if(threeRenderMode==='volume'&&sceneState.medicalVolume?.active){
  setGpuComputeBackend('WEBGPU VOLUME PICK');
  const picked=await sceneState.medicalVolume.pick(event.clientX,event.clientY,camera,sceneState.obj,segmentState,gpuSegmentOrder());
  if(!picked){renderAnalysisResults(tr('volumeHint'));return}
  key=picked.key;x=picked.x;y=picked.y;z=picked.z;
 }else{
  const rect=canvas.getBoundingClientRect(),mouse=new THREE.Vector2(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1),raycaster=new THREE.Raycaster();raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(sceneState.obj.children,true),analysisHit=hits.find(h=>h.object?.userData?.analysisRegionId!=null&&analysisRegionShown(analysisRegionById(h.object.userData.analysisRegionId)));
  if(analysisHit){const region=analysisRegionById(analysisHit.object.userData.analysisRegionId);if(region){const picked=surfacePointerVoxel(event,canvas,camera,region.segmentKeys[0]);setAnalysisFocusedRegion(region.id,picked?{x:picked.x,y:picked.y,z:picked.z}:null);return}}
  const hit=hits.find(h=>segmentKeyFromIntersection(h)&&surfaceHitVisible(h));
  if(!hit){renderAnalysisResults(tr('volumeHint'));return}
  key=segmentKeyFromIntersection(hit);const scale=hit.object.userData.displayScale,local=hit.object.worldToLocal(hit.point.clone());
  x=Math.round((local.x/scale+px/2)/vx);y=Math.round((-local.y/scale+py/2)/vy);z=Math.round((local.z/scale+pz/2)/vz);
 }
 await analyzeVolumeAtVoxel(x,y,z,key);
}
export async function connectedComponentVolume(v,seg,x0,y0,z0,mask=getProcessedSegmentMask(v,seg)){
 const w=v.columns,h=v.rows,d=v.slices,n=w*h*d,data=v.data,visited=new Uint8Array(n);
 let queue=new Int32Array(65536),head=0,tail=0;
 const grow=()=>{const next=new Int32Array(queue.length*2);next.set(queue);queue=next};
 const start=z0*h*w+y0*w+x0;queue[tail++]=start;visited[start]=1;
 let count=0,steps=0;
 const tryPush=i=>{if(i<0||i>=n||visited[i]||!mask[i])return;visited[i]=1;if(tail>=queue.length)grow();queue[tail++]=i};
 while(head<tail){
  const i=queue[head++];count++;
  const z=Math.floor(i/(h*w)),rem=i-z*h*w,y=Math.floor(rem/w),x=rem-y*w;
  if(x>0)tryPush(i-1);if(x<w-1)tryPush(i+1);if(y>0)tryPush(i-w);if(y<h-1)tryPush(i+w);if(z>0)tryPush(i-h*w);if(z<d-1)tryPush(i+h*w);
  if((++steps&0x3ffff)===0)await frameYield();
 }
 return{voxels:count,mm3:count*v.spacing[0]*v.spacing[1]*v.spacing[2],mask:visited};
}
export function createAnalysisMaterial(color=0x00d8ff,segmentKey=''){
 // the region is drawn on the segment's own surface (same geometry), so a depth bias in units is enough; the
 // slope factor (-2) let it show through a thin layer in front at grazing angles (the subcutaneous fat through the skin
 // whose air boundary was removed: "the removed rim comes back")
 return createSurfaceMaterial({
  color,emissive:color,emissiveIntensity:.55,transparent:true,opacity:.92,
  roughness:.35,metalness:0,side:THREE.DoubleSide,depthWrite:false,
  polygonOffset:true,polygonOffsetFactor:0,polygonOffsetUnits:-4,flatShading:!surfaceSmoothingActive()
 },segmentKey); // the segment's material, like its surface
}
export function clearAllSegmentEdits(){
 for(const key of SEGMENT_PRESET_ORDER){const st=segmentEditState[key];if(st.surfaceGroup?.parent)st.surfaceGroup.parent.remove(st.surfaceGroup);st.surfaceGroup=null;clearSegmentEditCache(key,true)}
 setAnalysisEditTool('select');setAnalysisEditTargetKey(null);setAnalysisEditTargetMode('auto');if(analysisEditTargetSelect)analysisEditTargetSelect.value='auto';setAnalysisCutStroke(null);setAnalysisCutScreen([]);setAnalysisPendingCut(null);clearCutResultPreview();updateThreeEditUi();
}
export function scheduleAnalysisRunPrewarm(){
 const v=current3DVolume||volume;
 if(!v?.sourceBacked||!sourceFilterStages().length)return;
 const keys=SEGMENT_PRESET_ORDER.filter(key=>segmentState[key]?.active&&segmentState[key]?.enabled);
 setTimeout(async()=>{
  for(const key of keys){
   if(!volumeAnalysisMode||(current3DVolume||volume)!==v||!segmentState[key]?.active)return;
   try{await ensureSegmentBaseRuns(key,v,null,true)}catch(e){if(String(e.message||e)!=='__SUPERSEDED__')console.warn('Background analysis prewarm failed for '+key+'; analysis will compute on demand.',e);return}
   // runs computed here are the segment's mask too: the GPU volume shows them (it kept the old / no mask)
   if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active)syncGpuVolumeEdits(sourceVolume||volume);
  }
 },300);
}
export async function trimAnalysisRegionsAfterEdit(key,refs){
 const v=current3DVolume||volume;if(!v)return;const st=segmentEditState[key],d=v.slices,vox=v.spacing[0]*v.spacing[1]*v.spacing[2];
 const own=r=>r.segmentKeys.length===1&&r.segmentKeys[0]===key;
 for(const region of analysisRegions.filter(own))disposeAnalysisRegionMesh(region);
 setAnalysisRegions(analysisRegions.filter(r=>!own(r)));setAnalysisFocusedRegionId(null);
 let focusId=null;
 for(const ref of refs||[]){
  let runs=ref.runsBySlice;if(st.keepRuns)runs=intersectRunArrays(runs,st.keepRuns,d);if(st.excludeRuns)runs=subtractRunArrays(runs,st.excludeRuns,d);
  const voxels=analysisRunsVoxelCount(runs);if(!voxels)continue;
  const id=incNextAnalysisRegionId(false),region={id,regionId:'r'+id,groupId:ref.groupId||null,key,segmentKeys:[key],runsBySlice:runs,voxels,mm3:voxels*vox,merged:!!ref.merged,selected:!!ref.selected,focused:false,visible:ref.visible!==false,meshGroup:null,color:ref.color};
  {const lb=normalizeAnalysisLabel(ref.label);if(lb)region.label=lb}
  analysisRegions.push(region);await attachAnalysisRegion(region,v);if(ref.focused&&focusId==null)focusId=id;
 }
 if(focusId!=null)setAnalysisFocusedRegionId(focusId);
 renderAnalysisResults();syncVolumeAnalysisOverlay();renderAll();request3DRender();
}
// analysis results in the project file (kept like an edit): meta + runs per region
// the tick (selection) is saved too; projects saved before 441 load with every result unticked, as before
export function analysisRegionsForProject(){
 return analysisRegions.filter(r=>r.runsBySlice&&r.voxels>0).map(r=>({key:r.key,segmentKeys:[...(r.segmentKeys||[])],color:Number(r.color??ANALYSIS_REGION_COLORS[0]),visible:r.visible!==false,selected:!!r.selected,merged:!!r.merged,groupId:r.groupId||null,label:labelForProject(r),runsBySlice:r.runsBySlice})); // label = the pinned label {anchor,offset?} (voxel units); omitted when there is none
}
export async function restoreAnalysisRegions(list,v=current3DVolume||volume){
 if(!v||!list?.length)return;const vox=v.spacing[0]*v.spacing[1]*v.spacing[2],series=activeSeries;
 for(const e of list){
  const voxels=analysisRunsVoxelCount(e.runsBySlice);if(!voxels)continue;
  const id=incNextAnalysisRegionId(false),region={id,regionId:'r'+id,groupId:e.groupId||null,key:e.key,segmentKeys:e.segmentKeys,runsBySlice:e.runsBySlice,voxels,mm3:voxels*vox,merged:!!e.merged,selected:!!e.selected,focused:false,visible:e.visible!==false,meshGroup:null,color:e.color};
  {const lb=normalizeAnalysisLabel(e.label);if(lb)region.label=lb}
  analysisRegions.push(region);await attachAnalysisRegion(region,v);
  if(activeSeries!==series)return; // another dataset was opened meanwhile (its reset emptied the list): the rest belongs to the old data
 }
 // the project's filters are already replayed: the results belong to them
 setAnalysisFilterSignature(currentFilterSignature());
 setNextAnalysisColorIndex(analysisRegions.length);
 renderAnalysisResults();syncVolumeAnalysisOverlay();renderAll();request3DRender();
}
export function snapshotAnalysisRegionsForSegment(key){
 return analysisRegions.filter(r=>r.segmentKeys.length===1&&r.segmentKeys[0]===key).map(r=>({
  runsBySlice:r.runsBySlice,color:r.color,visible:r.visible,selected:r.selected,focused:r.id===analysisFocusedRegionId,merged:r.merged,groupId:r.groupId||null,label:labelForProject(r)
 }));
}
export function editSnapshot(key){const st=segmentEditState[key];return{keepRuns:st.keepRuns,excludeRuns:st.excludeRuns,cutRuns:st.cutRuns,rawCutSurface:!!st.rawCutSurface,analysisRefs:snapshotAnalysisRegionsForSegment(key)}}
export function pushEditUndo(key){const st=segmentEditState[key];st.undo.push(editSnapshot(key));if(st.undo.length>20)st.undo.shift();st.redo=[]}
export function restoreEditSnapshot(key,snap){const st=segmentEditState[key];st.keepRuns=snap?.keepRuns||null;st.excludeRuns=snap?.excludeRuns||null;st.cutRuns=snap?.cutRuns||null;st.rawCutSurface=!!snap?.rawCutSurface;st.finalRuns=null;st.revision++;segmentEditsChanged(key)}
export async function rebuildEditedAnalysisForSegment(key,referenceRegions=null){
 const v=current3DVolume||volume;if(!v)return;
 const refs=referenceRegions||snapshotAnalysisRegionsForSegment(key);
 for(const region of analysisRegions.filter(r=>r.segmentKeys.includes(key)))disposeAnalysisRegionMesh(region);
 setAnalysisRegions(analysisRegions.filter(r=>!r.segmentKeys.includes(key)));setAnalysisFocusedRegionId(null);
 if(!refs.length){renderAnalysisResults();renderAll();return}
 const runs=await getFinalSegmentRuns(key,v),comps=componentsFromRuns(runs,v.columns,v.rows,v.slices),usedRefs=new Map();let focusId=null,created=0;
 for(const comp of comps){
  const matches=refs.filter(ref=>analysisRunsOverlap(comp.runsBySlice,ref.runsBySlice));if(!matches.length)continue;
  const primary=matches[0],used=usedRefs.get(primary)||0;usedRefs.set(primary,used+1);
  const id=incNextAnalysisRegionId(false),voxels=comp.voxels,mm3=voxels*v.spacing[0]*v.spacing[1]*v.spacing[2];
  const region={id,regionId:'r'+id,groupId:used===0?primary.groupId:null,key,segmentKeys:[key],runsBySlice:comp.runsBySlice,voxels,mm3,merged:used===0&&!!primary.merged,selected:!!primary.selected,focused:false,visible:primary.visible!==false,meshGroup:null,color:used===0?primary.color:nextAnalysisColor()};
  if(used===0){const lb=normalizeAnalysisLabel(primary.label);if(lb)region.label=lb} // the first piece keeps the pinned label
  analysisRegions.push(region);await attachAnalysisRegion(region,v);if(primary.focused&&focusId==null)focusId=id;
  created++;if(created>=64)break;
 }
 if(focusId!=null)setAnalysisFocusedRegion(focusId);else{renderAnalysisResults();renderAll()}
}
// Group the edit targets by segment: keep / delete apply per segment.
function editTargetsBySegment(){
 const byKey=new Map();for(const r of editTargetRegions()){const key=r.segmentKeys[0];if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(r)}
 return byKey;
}
export async function applyEditKeepSelected(){
 const byKey=editTargetsBySegment();if(!byKey.size)return;const v=current3DVolume||volume;
 const plans=[...byKey].map(([key,regions])=>{
  const runs=regions.reduce((acc,r)=>acc?unionRunArrays(acc,r.runsBySlice,v.slices):r.runsBySlice,null);
  return{key,runs,refs:snapshotAnalysisRegionsForSegment(key).filter(ref=>analysisRunsOverlap(ref.runsBySlice,runs))};
 });
 for(const {key,runs} of plans){const st=segmentEditState[key];pushEditUndo(key);st.keepRuns=runs;st.excludeRuns=null;st.finalRuns=null;st.revision++;segmentEditsChanged(key)}
 if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){syncGpuVolumeEdits(sourceVolume||volume);for(const {key,refs} of plans){surfaceEditsPending.add(key);await trimAnalysisRegionsAfterEdit(key,refs)}}else{for(const {key,refs} of plans){await refreshEditedSegmentSurface(key);await rebuildEditedAnalysisForSegment(key,refs)}}
 footer.textContent=currentLanguage==='ja'?'選択領域だけを残しました':'Kept the selected region only';
 returnToNavigate();
}
export async function applyEditRemoveSelected(){
 const byKey=editTargetsBySegment();if(!byKey.size)return;const v=current3DVolume||volume;
 const plans=[...byKey].map(([key,regions])=>{
  const runs=regions.reduce((acc,r)=>acc?unionRunArrays(acc,r.runsBySlice,v.slices):r.runsBySlice,null);
  return{key,runs,refs:snapshotAnalysisRegionsForSegment(key).filter(ref=>!analysisRunsOverlap(ref.runsBySlice,runs))};
 });
 set3DBusy(true,currentLanguage==='ja'?'選択領域を削除中…':'Deleting selected region…',false);await frameYield();
 try{
  for(const {key,runs} of plans){const st=segmentEditState[key];pushEditUndo(key);st.excludeRuns=unionRunArrays(st.excludeRuns,runs,v.slices);st.finalRuns=null;st.revision++;segmentEditsChanged(key)}
  if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){syncGpuVolumeEdits(sourceVolume||volume);for(const {key,refs} of plans){surfaceEditsPending.add(key);await trimAnalysisRegionsAfterEdit(key,refs)}}else{for(const {key,refs} of plans){await refreshEditedSegmentSurface(key,v);await rebuildEditedAnalysisForSegment(key,refs)}}
  footer.textContent=currentLanguage==='ja'?'選択領域を削除しました':'Deleted the selected region';
  returnToNavigate();
 }finally{set3DBusy(false,'',false)}
}
export async function undoSegmentEdit(){
 const region=analysisRegionById(analysisFocusedRegionId),key=analysisEditTargetKey||(region?.segmentKeys?.length===1?region.segmentKeys[0]:null)||SEGMENT_PRESET_ORDER.find(k=>segmentEditState[k].undo.length);if(!key)return;setAnalysisEditTargetKey(key);const st=segmentEditState[key],snap=st.undo.pop();if(!snap)return;st.redo.push(editSnapshot(key));restoreEditSnapshot(key,snap);
 if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){syncGpuVolumeEdits(sourceVolume||volume);surfaceEditsPending.add(key);await trimAnalysisRegionsAfterEdit(key,snap.analysisRefs||[])}else{await refreshEditedSegmentSurface(key);await rebuildEditedAnalysisForSegment(key,snap.analysisRefs||[])}
 updateAnalysisEditorControls();footer.textContent='Undo';
}
export async function redoSegmentEdit(){
 const key=analysisEditTargetKey&&segmentEditState[analysisEditTargetKey].redo.length?analysisEditTargetKey:SEGMENT_PRESET_ORDER.find(k=>segmentEditState[k].redo.length);if(!key)return;setAnalysisEditTargetKey(key);const st=segmentEditState[key],snap=st.redo.pop();if(!snap)return;st.undo.push(editSnapshot(key));restoreEditSnapshot(key,snap);
 if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){syncGpuVolumeEdits(sourceVolume||volume);surfaceEditsPending.add(key);await trimAnalysisRegionsAfterEdit(key,snap.analysisRefs||[])}else{await refreshEditedSegmentSurface(key);await rebuildEditedAnalysisForSegment(key,snap.analysisRefs||[])}
 updateAnalysisEditorControls();footer.textContent='Redo';
}
export async function resetFocusedSegmentEdit(){
 const region=analysisRegionById(analysisFocusedRegionId),key=analysisEditTargetKey||(region?.segmentKeys?.length===1?region.segmentKeys[0]:null)||SEGMENT_PRESET_ORDER.find(k=>segmentEditActive(k));if(!key)return;setAnalysisEditTargetKey(key);const refs=snapshotAnalysisRegionsForSegment(key);pushEditUndo(key);const st=segmentEditState[key];st.keepRuns=null;st.excludeRuns=null;st.cutRuns=null;st.rawCutSurface=false;st.finalRuns=null;st.revision++;segmentEditsChanged(key);
 if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){syncGpuVolumeEdits(sourceVolume||volume);surfaceEditsPending.add(key);await trimAnalysisRegionsAfterEdit(key,refs)}else{await refreshEditedSegmentSurface(key);if(refs.length)await rebuildEditedAnalysisForSegment(key,refs)}
 updateAnalysisEditorControls();footer.textContent=currentLanguage==='ja'?'編集をリセットしました':'Edits reset';
}
export async function applyCutStroke(points,key=analysisEditTargetKey,mode='pen'){
 if(!key||!SEGMENT_PRESET_ORDER.includes(key)||!points?.length)return false;
 const v=current3DVolume||volume;if(!v)return false;
 const label=tr(key)||key,st=segmentEditState[key],refs=snapshotAnalysisRegionsForSegment(key);
 try{
  const cut=cutRunsFromVoxelStroke(v,points,cutWidthMm(),+analysisCutDepth.value||5,+analysisCutYaw.value||0,+analysisCutPitch.value||0,mode,+analysisCutOffset.value||0);
  const cutVoxels=analysisRunsVoxelCount(cut);
  if(!cutVoxels)throw new Error(currentLanguage==='ja'?'切断空間のボクセル化に失敗しました':'Cut volume voxelization produced no voxels');
  pushEditUndo(key);st.excludeRuns=unionRunArrays(st.excludeRuns,cut,v.slices);st.cutRuns=unionRunArrays(st.cutRuns,cut,v.slices);st.rawCutSurface=true;st.finalRuns=null;st.revision++;segmentEditsChanged(key);setAnalysisEditTargetKey(key);
  console.info('[VRL CUT] solid voxel mask',{key,cutVoxels,widthMm:cutWidthMm(),depthMm:+analysisCutDepth.value||5});
  const revision=st.revision;
  if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){
   syncGpuVolumeEdits(sourceVolume||volume);surfaceEditsPending.add(key);if(refs.length)await trimAnalysisRegionsAfterEdit(key,refs);
   footer.textContent=currentLanguage==='ja'?label+'の切断をGPUボリュームへ反映しました':'Cut applied to GPU volume: '+label;
   updateThreeEditUi(currentLanguage==='ja'?'切断済み · GPUボリューム更新済み':'Cut applied · GPU volume updated');return true;
  }
  footer.textContent=currentLanguage==='ja'?label+'を切断しました · 3D更新中…':'Cut '+label+' · updating 3D…';
  updateThreeEditUi(currentLanguage==='ja'?'切断済み · 3D更新中…':'Cut applied · updating 3D…');
  const current=await refreshEditedSegmentSurface(key,v,revision);
  if(!current||st.revision!==revision)return false;
  if(refs.length){updateThreeEditUi(currentLanguage==='ja'?'3D更新済み · 解析更新中…':'3D updated · refreshing analysis…');await rebuildEditedAnalysisForSegment(key,refs);if(st.revision!==revision)return false}
  footer.textContent=currentLanguage==='ja'?label+'の切断を反映しました':'Cut applied to '+label;return true;
 }catch(e){
  if(String(e.message||e)!=='__SUPERSEDED__'){console.error(e);footer.textContent=(currentLanguage==='ja'?'切断後の更新に失敗しました: ':'Cut refresh failed: ')+String(e.message||e);updateThreeEditUi(currentLanguage==='ja'?'切断後の更新に失敗しました':'Cut refresh failed')}
  return false;
 }finally{clearThreeEditOverlay();request3DRender()}
}
export function ensureAnalysisRoot(){
 if(sceneState?.analysisMesh?.parent===sceneState?.obj)return sceneState.analysisMesh;
 const root=new THREE.Group();root.name='analysis_regions';sceneState.analysisMesh=root;sceneState?.obj?.add(root);return root;
}
export async function buildAnalysisRunsGroup(v,runsBySlice,key,id,color){
 const d=v.slices,coords=v.sourceBacked?makeSource3DCoordinates(v.series):makeVolume3DCoordinates(v);
 // with surface smoothing the region is built like the segment's run surface (same smoothing), so it lies on
 // the shown surface; the raw voxel faces stood out of it by up to half a voxel and showed through a thin layer in front
 if(surfaceSmoothingActive()&&segmentState[key]){
  const smooth=await buildEditableRunsGroup(v,runsBySlice,key);
  if(smooth){
   let n=0;smooth.traverse(o=>{if(!o.isMesh)return;const old=o.material;for(const m of Array.isArray(old)?old:[old])m?.dispose?.();o.material=createAnalysisMaterial(color,key);o.name='analysis_'+key+'_'+id+'_'+(n++);o.renderOrder=20;o.userData={analysisRegionId:id,displayScale:coords.scale}});
   return smooth;
  }
 }
 const group=new THREE.Group(),builder=new Float32FaceBuilder(),floatLimit=(navigator.maxTouchPoints>0?4:8)*1024*1024;
 const addMesh=(geometry,z)=>{if(!geometry)return;const mesh=new THREE.Mesh(geometry,createAnalysisMaterial(color,key));mesh.name='analysis_'+key+'_'+id+'_'+z;mesh.renderOrder=20;mesh.userData.analysisRegionId=id;mesh.userData.displayScale=coords.scale;group.add(mesh)};
 const appendSlice=z=>appendAnalysisRunBoundaryFaces(builder,runsBySlice[z],z>0?runsBySlice[z-1]:null,z+1<d?runsBySlice[z+1]:null,coords,z);
 if(surfaceSmoothingActive()){
  // smoothed like a run surface (buildEditableRunsGroup): chunks with halo slices on both sides and the seam copy,
  // so the chunks meet without a crack (each chunk smoothed on its own left an open edge where it ended)
  const halo=smoothChunkHalo(+surfaceSmoothStrength.value),smoother=new OrderedChunkSmoother({strength:+surfaceSmoothStrength.value,coords,seams:createSeamLinker(),onGeometry:addMesh});
  let coreFrom=0,chunkZ0=0;
  const beginChunk=z0=>{chunkZ0=z0;for(let z=Math.max(0,z0-halo);z<z0;z++)appendSlice(z);coreFrom=builder.length};
  const endChunk=z=>{const coreTo=builder.length;for(let k=z+1;k<=Math.min(d-1,z+halo);k++)appendSlice(k);const positions=builder.take();if(positions&&coreTo>coreFrom)smoother.submit(positions,{coreFrom,coreTo,zLow:chunkZ0>0?chunkZ0:null,zHigh:z+1<d?z+1:null,tag:z})};
  try{
   beginChunk(0);
   for(let z=0;z<d;z++){appendSlice(z);if(builder.length-coreFrom>=floatLimit&&z+1<d){endChunk(z);beginChunk(z+1);await smoother.throttle()}if((z&31)===0)await frameYield()}
   endChunk(d-1);await smoother.drain();
  }catch(e){smoother.cancel();dispose(group);throw e}
  return group.children.length?group:null;
 }
 const flush=z=>{const positions=builder.take();if(!positions)return;addMesh(geometryFromSourcePositions(positions),z)};
 for(let z=0;z<d;z++){
  appendSlice(z);
  if(builder.length>=floatLimit)flush(z);if((z&31)===0)await frameYield();
 }
 flush(d-1);return group.children.length?group:null;
}
export async function attachAnalysisRegion(region,v,forExport=false){
 // GPU volume view: regions are coloured inside the volume (syncVolumeAnalysisOverlay), no mesh.
 // STL export still needs the mesh (built on demand, kept hidden in volume view).
 if(!forExport&&volumeAnalysisOverlayActive()){request3DRender();return}
 const group=await buildAnalysisRunsGroup(v,region.runsBySlice,region.key,region.id,region.color);region.meshGroup=group;if(group){group.visible=analysisRegionShown(region);ensureAnalysisRoot().add(group)}request3DRender();
}
export async function addAnalysisRegion(v,{key,segmentKeys,runsBySlice,voxels,mm3,merged=false}){
 const existing=analysisRegions.find(r=>r.segmentKeys.includes(key)&&analysisRunsOverlap(r.runsBySlice,runsBySlice));
 if(existing){existing.selected=true;existing.visible=true;if(existing.meshGroup)existing.meshGroup.visible=analysisRegionShown(existing);renderAnalysisResults();request3DRender();return existing}
 const id=incNextAnalysisRegionId(false),region={id,regionId:'r'+id,groupId:merged?'g'+id:null,key,segmentKeys:[...new Set(segmentKeys)],runsBySlice,voxels,mm3,merged,selected:true,focused:false,visible:true,meshGroup:null,color:nextAnalysisColor()};
 analysisRegions.push(region);await attachAnalysisRegion(region,v);setAnalysisFocusedRegion(region.id);return region;
}
export async function mergeSelectedAnalysisRegions(){
 if(volumeAnalysisBusy)return;const selected=analysisRegions.filter(r=>r.selected);if(selected.length<2){renderAnalysisResults(tr('mergeNeedsTwo'));return}
 const v=current3DVolume||volume;if(!v)return;setVolumeAnalysisBusy(true);renderAnalysisResults(tr('mergingRegions'));
 try{
  const runsBySlice=unionAnalysisRuns(selected,v.slices),voxels=analysisRunsVoxelCount(runsBySlice),mm3=voxels*v.spacing[0]*v.spacing[1]*v.spacing[2],segmentKeys=[...new Set(selected.flatMap(r=>r.segmentKeys))],key=segmentKeys.length===1?segmentKeys[0]:'merged';
  for(const region of selected)disposeAnalysisRegionMesh(region);
  const ids=new Set(selected.map(r=>r.id));setAnalysisRegions(analysisRegions.filter(r=>!ids.has(r.id)));
  const id=incNextAnalysisRegionId(false),region={id,regionId:'r'+id,groupId:'g'+id,key,segmentKeys,runsBySlice,voxels,mm3,merged:true,selected:true,focused:false,visible:true,meshGroup:null,color:nextAnalysisColor()};
  {const lb=normalizeAnalysisLabel(selected.find(r=>r.label)?.label);if(lb)region.label=lb} // the merged result inherits the (first) label of the results it was made of
  analysisRegions.push(region);await attachAnalysisRegion(region,v);setAnalysisFocusedRegion(region.id);
 }finally{setVolumeAnalysisBusy(false);renderAnalysisResults()}
}
export function volumeAnalysisOverlayActive(){return threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active}
export function syncVolumeAnalysisOverlay(){
 const mv=sceneState?.medicalVolume,v=current3DVolume||volume;
 if(volumeAnalysisOverlayActive()){
  for(const r of analysisRegions)if(r.meshGroup)r.meshGroup.visible=false;
  const shown=analysisRegions.filter(r=>analysisRegionShown(r)&&r.runsBySlice);
  const slotOrder=gpuSegmentOrder(),base=(mv.seriesId||'')+'|'+(mv.textureDims||[]).join('x')+'|',signature=base+slotOrder.join('>')+'|'+shown.map(r=>r.id+':'+r.color+':'+(r.focused?1:0)+':'+r.voxels).join(','),textureSignature=base+shown.map(r=>r.id+':'+r.voxels).join(',');
  try{mv.setAnalysisRuns(shown.map(r=>({runs:r.runsBySlice,color:Number(r.color??0x00d8ff),focused:!!r.focused,segments:(r.segmentKeys||[]).map(k=>slotOrder.indexOf(k))})),v,signature,textureSignature)}
  // volume view never falls back to meshes (meshes only for STL export): report instead
  catch(e){console.warn('GPU volume analysis overlay failed.',e);mv.clearAnalysisRuns?.();footer.textContent=(currentLanguage==='ja'?'体積解析の3D表示エラー: ':'Volume analysis 3D overlay error: ')+String(e?.message||e)}
  return;
 }
 if(mv?.analysisOverlaySignature)mv.clearAnalysisRuns();
 if(!v||!sceneState?.obj)return;
 for(const r of analysisRegions){
  // a region of an unticked segment keeps (or still gets) its mesh, hidden: ticking the segment shows it at once
  if(r.meshGroup){r.meshGroup.visible=analysisRegionShown(r);continue}
  if(r.visible&&!r.meshPending){r.meshPending=true;attachAnalysisRegion(r,v).finally(()=>{r.meshPending=false})}
 }
}
export function segmentKeyFromIntersection(hit){
 const direct=hit?.object?.userData?.segmentKey;if(direct)return direct;
 const mi=hit?.face?.materialIndex,ranges=hit?.object?.userData?.segmentRanges;
 if(Array.isArray(ranges)&&Number.isInteger(mi)){const match=ranges.find(r=>r.materialIndex===mi);if(match)return match.key}
 return null;
}
// A segment surface hidden by its checkbox stays in the scene (visible=false, or the base mesh's material hidden), and a
// Raycaster still hits it: a pick must only land on what is shown.
export function surfaceHitVisible(hit){
 for(let p=hit?.object;p;p=p.parent)if(p.visible===false)return false;
 const o=hit?.object,mi=hit?.face?.materialIndex;
 if(!o?.userData?.segmentKey&&Array.isArray(o?.material)&&Array.isArray(o?.userData?.segmentRanges)&&Number.isInteger(mi)){
  const range=o.userData.segmentRanges.find(r=>r.materialIndex===mi);
  if(range&&o.material[range.materialIndex]?.visible===false)return false;
 }
 return true;
}
export function cutRaycastSourceMeshes(key=null){
 const meshes=[];sceneState?.obj?.traverse?.(o=>{
  if(!o.isMesh||o.userData?.cutResultPreview)return;
  for(let p=o;p;p=p.parent)if(p.visible===false)return;
  const hasSegment=!!o.userData?.segmentKey||Array.isArray(o.userData?.segmentRanges)&&o.userData.segmentRanges.length;
  if(!hasSegment)return;
  if(key&&meshSegmentRanges(o,key).length===0)return;
  meshes.push(o);
 });return meshes;
}
export function currentSegmentMeshes(key){
 const meshes=[];sceneState?.obj?.traverse?.(o=>{if(o.isMesh&&o.geometry&&meshSegmentRanges(o,key).length)meshes.push(o)});return meshes;
}
export function currentSegmentDisplayScale(key){
 const mesh=currentSegmentMeshes(key)[0];return Number(mesh?.userData?.displayScale)||1;
}
export function currentSegmentTriangleCount(key){
 let count=0;for(const mesh of currentSegmentMeshes(key))for(const range of meshSegmentRanges(mesh,key))count+=Math.floor(range.count/3);return count;
}
export async function exportFocusedAnalysisRegionStl(){
 const region=analysisRegionById(analysisFocusedRegionId),v=current3DVolume||volume;if(!region||!v)return;
 // export the same surface the segment shows (surface smoothing
 // setting), not the raw voxel-face display mesh of the region
 footer.textContent=currentLanguage==='ja'?'STL用メッシュを作成中…':'Building STL mesh…';
 let group=null;
 try{group=await buildEditableRunsGroup(v,region.runsBySlice,region.key,null,false,true)}catch(e){console.error(e);footer.textContent='STL error: '+String(e.message||e);return}
 if(!group){footer.textContent='STL: region is empty';return}
 const scale=(v.sourceBacked?makeSource3DCoordinates(v.series):makeVolume3DCoordinates(v)).scale,blob=groupToBinaryStl(group,'region-'+region.id,1/Math.max(scale,1e-12));dispose(group);if(!blob)return;
 const filename='virtual-rodent-region-'+region.id+'.stl';downloadBlob(blob,filename);footer.textContent=(currentLanguage==='ja'?'STLを書き出しました: ':'STL exported: ')+filename;
}
export function currentSegmentToBinaryStl(key){
 const meshes=currentSegmentMeshes(key);if(!meshes.length)return null;
 const triCount=currentSegmentTriangleCount(key),buffer=new ArrayBuffer(84+triCount*50),view=new DataView(buffer),header=new TextEncoder().encode('Virtual Rodent Lab '+key);
 new Uint8Array(buffer,0,Math.min(80,header.length)).set(header.slice(0,80));view.setUint32(80,triCount,true);
 const scale=currentSegmentDisplayScale(key),inverseScale=1/Math.max(scale,1e-12),ab=new THREE.Vector3(),ac=new THREE.Vector3(),n=new THREE.Vector3();let off=84;
 for(const mesh of meshes)for(const range of meshSegmentRanges(mesh,key))eachGeometryTriangleRange(mesh.geometry,range.start,range.count,(aa,bb,cc)=>{
  const a=aa.clone().multiplyScalar(inverseScale),b=bb.clone().multiplyScalar(inverseScale),c=cc.clone().multiplyScalar(inverseScale);
  ab.subVectors(b,a);ac.subVectors(c,a);n.crossVectors(ab,ac).normalize();
  for(const v of [n,a,b,c]){view.setFloat32(off,v.x,true);view.setFloat32(off+4,v.y,true);view.setFloat32(off+8,v.z,true);off+=12}
  view.setUint16(off,0,true);off+=2;
 });
 return new Blob([buffer],{type:'model/stl'});
}
export async function exportSegmentStl(key){
 if(!sceneState?.obj||threeDDirty){footer.textContent=currentLanguage==='ja'?'STL: 先に3Dを再構築してください':'STL: rebuild 3D first';return}
 let blob=null;
 if(segmentUsesRunSurface(key)){
  if(!segmentEditState[key].surfaceGroup)await refreshEditedSegmentSurface(key);
  const v=current3DVolume||volume,scale=(v.sourceBacked?makeSource3DCoordinates(v.series):makeVolume3DCoordinates(v)).scale;blob=groupToBinaryStl(segmentEditState[key].surfaceGroup,'edited-'+key,1/Math.max(scale,1e-12));
 }else{
  try{await ensureGpuResidentCpuPositions(key,currentLanguage==='ja'?'STL用メッシュを取得中':'Preparing STL mesh')}catch(e){console.error(e);footer.textContent='STL readback error: '+String(e.message||e);return}
  blob=currentSegmentToBinaryStl(key);
 }
 if(!blob){footer.textContent='STL: segment is empty';return}
 const names={bone:'bone',soft:'soft-tissue',fat:'fat',lung:'lung',contrast:'contrast'},filename='virtual-rodent-'+(names[key]||key)+'.stl';downloadBlob(blob,filename);footer.textContent=(currentLanguage==='ja'?'STLを書き出しました: ':'STL exported: ')+filename;
}
export function cutPointerVoxel(event,canvas,camera,preferredKey=null){
 return surfaceSegmentPointerVoxel(event,canvas,camera,preferredKey);
}
