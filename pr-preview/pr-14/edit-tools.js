// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { analysisFocusedRegionId, sceneState, threeRenderMode, analysisEditTargetKey, analysisEditTool, setAnalysisEditTool, analysisEditTargetMode, analysisCutApplying, analysisPendingCut, setAnalysisEditTargetMode, setAnalysisEditTargetKey, currentLanguage, current3DVolume, volume, cutResultPreviewTimer, incCutResultPreviewRevision, setCutResultPreviewTimer, cutResultPreviewRevision, sourceVolume, analysisRegions } from './state.js?v=20261027-build677';
import { SEGMENT_PRESET_ORDER, gpuSegmentOrder, segmentState, segmentEditState, segmentEditActive } from './segments.js?v=20261027-build677';
import { analysisNavigateButton, analysisSelectRegionButton, analysisLassoButton, analysisLassoDeselectButton, analysisDeselectAll, analysisEditDeselectAll, analysisCutButton, analysisLineCutButton, analysisEditRemoveSelected, analysisRemoveSelected, analysisKeepSelected, analysisUndo, analysisRedo, analysisResetEdit, analysisExportSelected, analysisEditTargetSelect, threeEditStatus, analysisCutWidth, analysisCutDepth, analysisCutYaw, analysisCutPitch, analysisCutApply, analysisCutCancel, analysisCutConfirm, analysisCutOffset, threeEditHelp, viewport, state, analysisCutWidthValue, analysisCutDepthValue, analysisCutYawValue, analysisCutPitchValue, analysisCutOffsetValue } from './ui-shell.js?v=20261027-build677';
import { tr } from './i18n.js?v=20261027-build677';
import { dispose, buildEditableRunsGroup } from './surface-mesh.js?v=20261027-build677';
import { request3DRender } from './scene3d.js?v=20261027-build677';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { getFinalSegmentRuns } from './segment-runs.js?v=20261027-build677';
import { intersectRunArrays, rowsToRunSlice } from './run-length.js?v=20261027-build677';
export function analysisRegionById(id){return analysisRegions.find(r=>r.id===id)||null}
export function configureCutControlRanges(v=current3DVolume||volume){
 if(!v||!analysisCutWidth)return;
 const [sx,sy,sz]=v.spacing,w=v.columns,h=v.rows,d=v.slices,dims=[w*sx,h*sy,d*sz],diag=Math.hypot(...dims),minSpacing=Math.min(sx,sy,sz),minDim=Math.min(...dims);
 const clamp=(el,min,max,step)=>{el.min=String(min);el.max=String(max);el.step=String(step);el.value=String(Math.max(min,Math.min(max,+el.value)))};
 const widthMax=Math.max(2,Math.min(8,minDim*.22));
 clamp(analysisCutWidth,0,widthMax,.05);
 clamp(analysisCutDepth,Math.max(.1,minSpacing*.5),Math.max(5,diag),.1);
 clamp(analysisCutYaw,-90,90,.25);clamp(analysisCutPitch,-90,90,.25);
 const offsetMax=Math.max(5,diag*.6);clamp(analysisCutOffset,-offsetMax,offsetMax,.1);
}
export function cutWidthMm(){
 const value=Number(analysisCutWidth?.value);return Number.isFinite(value)?Math.max(0,value):.8;
}
export function refreshCutControlReadouts(){
 analysisCutWidthValue.value=cutWidthMm().toFixed(2)+' mm';
 analysisCutDepthValue.value=(+analysisCutDepth.value).toFixed(1)+' mm';
 analysisCutYawValue.value=(+analysisCutYaw.value).toFixed(1)+'°';
 analysisCutPitchValue.value=(+analysisCutPitch.value).toFixed(1)+'°';
 analysisCutOffsetValue.value=(+analysisCutOffset.value).toFixed(1)+' mm';
}
export function cutDirectionFromPoint(p,yawDeg=0,pitchDeg=0){
 const norm=q=>{const n=Math.hypot(q.x,q.y,q.z)||1;return{x:q.x/n,y:q.y/n,z:q.z/n}};
 const base=norm(p?.ray||{x:0,y:0,z:1}),right=norm(p?.right||{x:1,y:0,z:0}),up=norm(p?.up||{x:0,y:1,z:0});
 const yaw=yawDeg*Math.PI/180,pitch=pitchDeg*Math.PI/180,cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 return norm({x:base.x*cy*cp+right.x*sy*cp+up.x*sp,y:base.y*cy*cp+right.y*sy*cp+up.y*sp,z:base.z*cy*cp+right.z*sy*cp+up.z*sp});
}
export function cutSurfaceStroke(points,mode='pen',offsetMm=0,v=current3DVolume||volume){
 if(!points?.length)return[];
 const src=mode==='line'&&points.length>1?[points[0],points[points.length-1]]:points;
 if(!v||!offsetMm)return src;
 const [sx,sy,sz]=v.spacing,anchor=src[0],r=anchor?.ray||{x:0,y:0,z:1};
 return src.map(p=>({...p,x:p.x+r.x*offsetMm/sx,y:p.y+r.y*offsetMm/sy,z:p.z+r.z*offsetMm/sz}));
}
export function cutPlanDirection(points,yawDeg=0,pitchDeg=0){
 return cutDirectionFromPoint(points?.[0]||null,yawDeg,pitchDeg);
}
export function cutSurfaceFrameData(points,mode='pen',offsetMm=0,v=current3DVolume||volume,yawDeg=0,pitchDeg=0){
 const curve=cutSurfaceStroke(points,mode,offsetMm,v),dir=cutPlanDirection(points,yawDeg,pitchDeg);
 if(!v||!curve.length)return{curve,dir,normals:[]};
 const [sx,sy,sz]=v.spacing,norm=q=>{const n=Math.hypot(q.x,q.y,q.z)||1;return{x:q.x/n,y:q.y/n,z:q.z/n}},cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x}),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z,neg=q=>({x:-q.x,y:-q.y,z:-q.z}),delta=(a,b)=>({x:(b.x-a.x)*sx,y:(b.y-a.y)*sy,z:(b.z-a.z)*sz});
 const normals=[];let previous=null;
 for(let i=0;i<curve.length;i++){
  let tangent;
  if(curve.length===1)tangent=norm(curve[0]?.right||{x:1,y:0,z:0});
  else if(i===0)tangent=norm(delta(curve[0],curve[1]));
  else if(i===curve.length-1)tangent=norm(delta(curve[i-1],curve[i]));
  else tangent=norm(delta(curve[i-1],curve[i+1]));
  let normal=cross(tangent,dir),len=Math.hypot(normal.x,normal.y,normal.z);
  if(len<1e-6&&previous)normal={...previous},len=1;
  if(len<1e-6){normal=cross(tangent,curve[i]?.up||curve[0]?.up||{x:0,y:1,z:0});len=Math.hypot(normal.x,normal.y,normal.z)}
  if(len<1e-6){normal=cross(tangent,curve[i]?.right||curve[0]?.right||{x:1,y:0,z:0});len=Math.hypot(normal.x,normal.y,normal.z)}
  if(len<1e-6)normal={x:1,y:0,z:0};else normal=norm(normal);
  if(previous&&dot(normal,previous)<0)normal=neg(normal);
  normals.push(normal);previous=normal;
 }
 return{curve,dir,normals};
}
export function cutRunsFromVoxelStroke(v,points,kerfMm,depthMm,yawDeg=0,pitchDeg=0,mode='pen',offsetMm=0){
 const d=v.slices,w=v.columns,h=v.rows,[sx,sy,sz]=v.spacing,rows=Array.from({length:d},()=>new Map()),frame=cutSurfaceFrameData(points,mode,offsetMm,v,yawDeg,pitchDeg),curve=frame.curve,dir=frame.dir,normals=frame.normals;
 if(!curve.length)return rows.map(rowsToRunSlice);
 const norm=q=>{const n=Math.hypot(q.x,q.y,q.z)||1;return{x:q.x/n,y:q.y/n,z:q.z/n}};
 const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
 const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
 const addInterval=(z,y,x0,x1)=>{
  if(z<0||y<0||z>=d||y>=h||x1<0||x0>=w)return;
  x0=Math.max(0,x0);x1=Math.min(w-1,x1);if(x1<x0)return;
  const map=rows[z],arr=map.get(y)||[];arr.push([x0,x1]);map.set(y,arr);
 };
 const addSingle=p=>{
  const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z);addInterval(z,y,x,x);
 };
 if(curve.length<2){addSingle(curve[0]);return rows.map(rowsToRunSlice)}

 const halfKerf=Math.max(0,Number.isFinite(+kerfMm)?+kerfMm*.5:0);
 const depth=Math.max(.1,+depthMm||.1);
 // Conservative solid voxelization: if a voxel cell intersects the swept cut prism,
 // that voxel is included in the cut mask. This deliberately avoids the pinholes that
 // point-sampling produced in GPU volume mode.
 const voxelMargin=.5*Math.hypot(sx,sy,sz)+1e-6;
 const dvec=norm(dir);

 for(let seg=0;seg<curve.length-1;seg++){
  const a=curve[seg],b=curve[seg+1];
  const A={x:a.x*sx,y:a.y*sy,z:a.z*sz},B={x:b.x*sx,y:b.y*sy,z:b.z*sz};
  const e0={x:B.x-A.x,y:B.y-A.y,z:B.z-A.z};
  const segLen=Math.hypot(e0.x,e0.y,e0.z);if(segLen<1e-7)continue;
  const n0=normals[seg]||{x:1,y:0,z:0},n1=normals[seg+1]||n0;
  let nvec=norm({x:n0.x+n1.x,y:n0.y+n1.y,z:n0.z+n1.z});
  // Keep the width axis perpendicular to both the stroke and cut depth.
  const exactN=cross(norm(e0),dvec);if(Math.hypot(exactN.x,exactN.y,exactN.z)>1e-7)nvec=norm(exactN);

  const dn=cross(dvec,nvec),det=dot(e0,dn);
  if(Math.abs(det)<1e-9)continue;

  const corners=[];
  for(const u of [0,1])for(const dep of [0,depth])for(const side of [-halfKerf,halfKerf]){
   const base=u?B:A;
   corners.push({
    x:base.x+dvec.x*dep+nvec.x*side,
    y:base.y+dvec.y*dep+nvec.y*side,
    z:base.z+dvec.z*dep+nvec.z*side
   });
  }
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const p of corners){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);minZ=Math.min(minZ,p.z);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);maxZ=Math.max(maxZ,p.z)}
  minX-=voxelMargin;minY-=voxelMargin;minZ-=voxelMargin;maxX+=voxelMargin;maxY+=voxelMargin;maxZ+=voxelMargin;
  const x0=Math.max(0,Math.floor(minX/sx)),x1=Math.min(w-1,Math.floor(maxX/sx));
  const y0=Math.max(0,Math.floor(minY/sy)),y1=Math.min(h-1,Math.floor(maxY/sy));
  const z0=Math.max(0,Math.floor(minZ/sz)),z1=Math.min(d-1,Math.floor(maxZ/sz));
  const alphaMargin=voxelMargin/segLen;

  for(let z=z0;z<=z1;z++){
   const pz=(z+.5)*sz;
   for(let y=y0;y<=y1;y++){
    const py=(y+.5)*sy;let runStart=-1;
    for(let x=x0;x<=x1;x++){
     const q={x:(x+.5)*sx-A.x,y:py-A.y,z:pz-A.z};
     const alpha=dot(q,dn)/det;
     const beta=dot(e0,cross(q,nvec))/det;
     const gamma=dot(e0,cross(dvec,q))/det;
     const inside=alpha>=-alphaMargin&&alpha<=1+alphaMargin&&beta>=-voxelMargin&&beta<=depth+voxelMargin&&gamma>=-halfKerf-voxelMargin&&gamma<=halfKerf+voxelMargin;
     if(inside){if(runStart<0)runStart=x}
     else if(runStart>=0){addInterval(z,y,runStart,x-1);runStart=-1}
    }
    if(runStart>=0)addInterval(z,y,runStart,x1);
   }
  }
 }
 return rows.map(rowsToRunSlice);
}
export function setEditTargetHighlight(key=null){
 if(!sceneState?.obj)return;
 sceneState.obj.traverse(o=>{
  if(!o.isMesh)return;
  const direct=o.userData?.segmentKey||null,ranges=Array.isArray(o.userData?.segmentRanges)?o.userData.segmentRanges:null;
  const mats=Array.isArray(o.material)?o.material:[o.material];
  if(direct){
   for(const m of mats){if(!m)continue;if(m.userData._editBaseEmissive===undefined){m.userData._editBaseEmissive=m.emissiveIntensity??0;m.userData._editBaseOpacity=m.opacity}
    m.emissiveIntensity=key&&direct===key?Math.max(.55,m.userData._editBaseEmissive):m.userData._editBaseEmissive;
    if(key)m.opacity=direct===key?Math.max(.92,m.userData._editBaseOpacity??1):Math.min(.42,m.userData._editBaseOpacity??1);else if(m.userData._editBaseOpacity!==undefined)m.opacity=m.userData._editBaseOpacity;
   }
  }else if(ranges&&Array.isArray(o.material)){
   for(const r of ranges){const m=o.material[r.materialIndex];if(!m)continue;if(m.userData._editBaseEmissive===undefined){m.userData._editBaseEmissive=m.emissiveIntensity??0;m.userData._editBaseOpacity=m.opacity}
    m.emissiveIntensity=key&&r.key===key?Math.max(.55,m.userData._editBaseEmissive):m.userData._editBaseEmissive;
    if(key)m.opacity=r.key===key?Math.max(.92,m.userData._editBaseOpacity??1):Math.min(.42,m.userData._editBaseOpacity??1);else if(m.userData._editBaseOpacity!==undefined)m.opacity=m.userData._editBaseOpacity;
   }
  }
 });
 request3DRender();
}
export function setCutResultSourceHidden(key,hidden){
 const root=sceneState?.obj;if(!root||!key)return;
 root.traverse(o=>{
  if(!o.isMesh||o.userData?.cutResultPreview)return;
  const direct=o.userData?.segmentKey||null;
  if(direct===key){
   if(hidden){if(o.userData._cutPreviewVisible===undefined)o.userData._cutPreviewVisible=o.visible;o.visible=false}
   else if(o.userData._cutPreviewVisible!==undefined){o.visible=!!o.userData._cutPreviewVisible;delete o.userData._cutPreviewVisible}
  }
  const ranges=Array.isArray(o.userData?.segmentRanges)?o.userData.segmentRanges:null;
  if(ranges&&Array.isArray(o.material))for(const r of ranges)if(r.key===key){
   const m=o.material[r.materialIndex];if(!m)continue;
   if(hidden){if(m.userData._cutPreviewVisible===undefined)m.userData._cutPreviewVisible=m.visible;m.visible=false}
   else if(m.userData._cutPreviewVisible!==undefined){m.visible=!!m.userData._cutPreviewVisible;delete m.userData._cutPreviewVisible}
  }
 });
}
export function clearCutResultPreview(){
 incCutResultPreviewRevision(false);clearTimeout(cutResultPreviewTimer);setCutResultPreviewTimer(null);
 const state=sceneState;if(!state)return;
 state.medicalVolume?.clearPreviewRuns?.();
 const key=state.cutResultPreviewKey,group=state.cutResultPreviewGroup;
 if(group){if(group.parent)group.parent.remove(group);dispose(group)}
 state.cutResultPreviewGroup=null;state.cutResultPreviewKey=null;
 if(key)setCutResultSourceHidden(key,false);
 request3DRender();
}
export function scheduleCutResultPreview(delay=180){
 clearTimeout(cutResultPreviewTimer);const pending=analysisPendingCut;
 if(!pending?.key||analysisCutApplying||!sceneState?.obj){sceneState?.medicalVolume?.clearPreviewRuns?.();return}
 const revision=incCutResultPreviewRevision(true);
 if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){
  setCutResultPreviewTimer(setTimeout(()=>{
   setCutResultPreviewTimer(null);
   if(revision!==cutResultPreviewRevision||pending!==analysisPendingCut||analysisCutApplying)return;
   try{
    const v=sourceVolume||current3DVolume||volume;
    const cut=cutRunsFromVoxelStroke(v,pending.points,cutWidthMm(),+analysisCutDepth.value||5,+analysisCutYaw.value||0,+analysisCutPitch.value||0,pending.mode,+analysisCutOffset.value||0);
    if(revision!==cutResultPreviewRevision||pending!==analysisPendingCut)return;
    sceneState.medicalVolume.setPreviewRuns(pending.key,cut,gpuSegmentOrder(),v);request3DRender();
   }catch(e){console.warn('GPU cut preview failed.',e);sceneState?.medicalVolume?.clearPreviewRuns?.()}
  },Math.min(delay,90)));return;
 }
 setCutResultPreviewTimer(setTimeout(()=>{setCutResultPreviewTimer(null);void rebuildCutResultPreview(revision,pending)},delay));
}
export async function rebuildCutResultPreview(revision,pending){
 const state=sceneState,v=current3DVolume||volume,key=pending?.key;
 if(!state?.obj||!v||!key||analysisCutApplying||pending!==analysisPendingCut)return;
 try{
  const current=await getFinalSegmentRuns(key,v);
  if(revision!==cutResultPreviewRevision||pending!==analysisPendingCut)return;
  const cut=cutRunsFromVoxelStroke(v,pending.points,cutWidthMm(),+analysisCutDepth.value||5,+analysisCutYaw.value||0,+analysisCutPitch.value||0,pending.mode,+analysisCutOffset.value||0);
  const removedRuns=intersectRunArrays(current,cut,v.slices),isCurrent=()=>revision===cutResultPreviewRevision&&pending===analysisPendingCut&&!analysisCutApplying;
  let group=await buildEditableRunsGroup(v,removedRuns,key,isCurrent,true);
  if(!isCurrent()){if(group)dispose(group);return}
  if(!group)group=new THREE.Group();
  group.name='cut_remove_preview';
  group.traverse?.(o=>{
   if(!o.isMesh)return;
   o.userData.cutResultPreview=true;
   const mats=Array.isArray(o.material)?o.material:[o.material];
   for(const m of mats){
    if(!m)continue;
    if(m.color?.set)m.color.set(0xff5a36);
    if(m.emissive?.set)m.emissive.set(0xff3b12);
    m.emissiveIntensity=1.15;m.transparent=true;m.opacity=.88;m.depthTest=false;m.depthWrite=false;
    if('polygonOffset' in m){m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2}
   }
   o.renderOrder=120;
  });
  const old=state.cutResultPreviewGroup;
  if(old){if(old.parent)old.parent.remove(old);dispose(old)}
  if(state.cutResultPreviewKey)setCutResultSourceHidden(state.cutResultPreviewKey,false);
  setCutResultSourceHidden(key,false);
  state.cutResultPreviewKey=key;state.cutResultPreviewGroup=group;state.obj.add(group);request3DRender();
 }catch(e){
  if(String(e.message||e)!=='__SUPERSEDED__')console.warn('Cut removal preview failed.',e);
 }
}
export function updateCutPreview(point=null){
 const state=sceneState,obj=state?.obj;if(!state||!obj)return;
 if(state.editCutPreview){if(state.editCutPreview.parent)state.editCutPreview.parent.remove(state.editCutPreview);dispose(state.editCutPreview);state.editCutPreview=null}
 const pending=analysisPendingCut;
 if(!pending){state.editCutPreviewPoint=point||null;if(!analysisCutApplying)clearCutResultPreview();request3DRender();return}
 const v=current3DVolume||volume,frame=cutSurfaceFrameData(pending.points,pending.mode,+analysisCutOffset.value||0,v,+analysisCutYaw.value||0,+analysisCutPitch.value||0),curve=frame.curve,normals=frame.normals;
 scheduleCutResultPreview();if(!v||curve.length<2){request3DRender();return}
 const [sx,sy,sz]=v.spacing,w=v.columns,h=v.rows,d=v.slices,px=w*sx,py=h*sy,pz=d*sz,scale=3.3/Math.max(px,py,pz,1),depthMm=Math.max(.1,+analysisCutDepth.value||5),depthWorld=depthMm*scale,halfKerfMm=Math.max(0,cutWidthMm())*.5,halfKerfWorld=halfKerfMm*scale,dir=new THREE.Vector3(frame.dir.x,-frame.dir.y,frame.dir.z).normalize();
 const localPoint=p=>new THREE.Vector3((p.x*sx-px/2)*scale,-(p.y*sy-py/2)*scale,(p.z*sz-pz/2)*scale);
 const localNormal=(n,i)=>{
  if(n){const q=new THREE.Vector3(n.x,-n.y,n.z);if(q.lengthSq()>1e-12)return q.normalize()}
  const a=curve[Math.max(0,i-1)],b=curve[Math.min(curve.length-1,i+1)],t=new THREE.Vector3((b.x-a.x)*sx,-(b.y-a.y)*sy,(b.z-a.z)*sz).normalize(),q=new THREE.Vector3().crossVectors(t,dir);
  return q.lengthSq()>1e-12?q.normalize():new THREE.Vector3(0,1,0);
 };
 // Exact requested geometry:
 // upper = drawn/contact curve; lower = same curve translated by configured depth.
 const upper=curve.map(localPoint),lower=upper.map(p=>p.clone().addScaledVector(dir,depthWorld)),normalVecs=upper.map((_,i)=>localNormal(normals?.[i],i));
 const offsetRow=(row,sign)=>row.map((p,i)=>p.clone().addScaledVector(normalVecs[i],halfKerfWorld*sign));
 const upperNeg=offsetRow(upper,-1),upperPos=offsetRow(upper,1),lowerNeg=offsetRow(lower,-1),lowerPos=offsetRow(lower,1);
 const quad=(arr,a,b,c,d)=>arr.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,a.x,a.y,a.z,c.x,c.y,c.z,d.x,d.y,d.z);
 const curtainFaces=(aRow,bRow)=>{const out=[];for(let i=0;i<aRow.length-1;i++)quad(out,aRow[i],aRow[i+1],bRow[i+1],bRow[i]);return out};
 const ribbonFaces=(aRow,bRow)=>{const out=[];for(let i=0;i<aRow.length-1;i++)quad(out,aRow[i],bRow[i],bRow[i+1],aRow[i+1]);return out};
 const group=new THREE.Group();group.name='cut_preview';

 // Active CAD curtain: always visible, including the part inside the 3D model.
 const activeGeom=new THREE.BufferGeometry();activeGeom.setAttribute('position',new THREE.Float32BufferAttribute(curtainFaces(upper,lower),3));activeGeom.computeVertexNormals();
 const active=new THREE.Mesh(activeGeom,new THREE.MeshBasicMaterial({color:0x00d8ff,transparent:true,opacity:.16,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
 active.name='cut_preview_active_surface';active.renderOrder=124;group.add(active);

 // Exact cut-width prism, built from the same +/- width/2 geometry used by cutRunsFromVoxelStroke().
 if(halfKerfWorld>1e-7){
  const volumeFaces=[];
  const pushFaces=faces=>volumeFaces.push(...faces);
  pushFaces(curtainFaces(upperNeg,lowerNeg));
  pushFaces(curtainFaces(lowerPos,upperPos));
  pushFaces(ribbonFaces(upperNeg,upperPos));
  pushFaces(ribbonFaces(lowerPos,lowerNeg));
  const first=0,last=upper.length-1;
  quad(volumeFaces,upperNeg[first],lowerNeg[first],lowerPos[first],upperPos[first]);
  quad(volumeFaces,upperNeg[last],upperPos[last],lowerPos[last],lowerNeg[last]);
  const vg=new THREE.BufferGeometry();vg.setAttribute('position',new THREE.Float32BufferAttribute(volumeFaces,3));vg.computeVertexNormals();
  const vm=new THREE.Mesh(vg,new THREE.MeshBasicMaterial({color:0x16c8e8,transparent:true,opacity:.075,depthTest:false,depthWrite:false,side:THREE.FrontSide}));
  vm.name='cut_preview_width_volume';vm.renderOrder=122;group.add(vm);
 }

 const lineMat=(color,opacity=1)=>new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthTest:false,depthWrite:false});
 const addLineSegments=(points,material,name,order)=>{if(!points.length)return;const g=new THREE.BufferGeometry().setFromPoints(points),line=new THREE.LineSegments(g,material);line.name=name;line.renderOrder=order;group.add(line)};
 const addCurve=(dst,row)=>{for(let i=0;i<row.length-1;i++)dst.push(row[i],row[i+1])};

 // Upper/lower outlines are exact copies of the same curve.
 const outline=[];addCurve(outline,upper);addCurve(outline,lower);outline.push(upper[0],lower[0],upper[upper.length-1],lower[lower.length-1]);
 addLineSegments(outline,lineMat(0x00e5ff,.98),'cut_preview_active_outline',130);

 // Contact edge is explicit.
 const contact=[];addCurve(contact,upper);
 addLineSegments(contact,lineMat(0xffffff,1),'cut_preview_contact_edge',133);

 // Exact width boundary curves.
 if(halfKerfWorld>1e-7){
  const widthEdges=[];addCurve(widthEdges,upperNeg);addCurve(widthEdges,upperPos);addCurve(widthEdges,lowerNeg);addCurve(widthEdges,lowerPos);
  widthEdges.push(upperNeg[0],upperPos[0],lowerNeg[0],lowerPos[0],upperNeg[upperNeg.length-1],upperPos[upperPos.length-1],lowerNeg[lowerNeg.length-1],lowerPos[lowerPos.length-1]);
  addLineSegments(widthEdges,lineMat(0x65efff,.90),'cut_preview_width_outline',129);
 }

 // CAD hatch only on the active curtain.
 const sampleCurve=t=>{const u=THREE.MathUtils.clamp(t,0,1)*(upper.length-1),i=Math.min(upper.length-2,Math.floor(u)),f=u-i;return upper[i].clone().lerp(upper[i+1],f)};
 const hatchPoints=[],hatchCount=Math.max(7,Math.min(15,Math.round(upper.length/3))),steps=8,slope=.055;
 for(let hIdx=0;hIdx<hatchCount;hIdx++){
  const base=(hIdx+.5)/hatchCount;let prev=null;
  for(let k=0;k<=steps;k++){
   const dv=k/steps,t=base+slope*(dv-.5);
   if(t<0||t>1){prev=null;continue}
   const p=sampleCurve(t).addScaledVector(dir,dv*depthWorld);
   if(prev)hatchPoints.push(prev,p.clone());
   prev=p;
  }
 }
 addLineSegments(hatchPoints,lineMat(0x91f4ff,.72),'cut_preview_hatch',131);

 obj.add(group);state.editCutPreview=group;state.editCutPreviewPoint=curve[curve.length-1];request3DRender();
}
export function updateThreeEditUi(message=null){
 configureCutControlRanges();refreshCutControlReadouts();
 const enabledKeys=SEGMENT_PRESET_ORDER.filter(k=>segmentState[k].active&&segmentState[k].enabled);
 const surfaceUsable=!!sceneState?.obj&&enabledKeys.length>0&&(threeRenderMode==='surface'||(threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active));
 const modeLabel=analysisEditTool==='lasso'?tr('lassoSelectRegion'):analysisEditTool==='unlasso'?tr('lassoDeselectRegion'):analysisEditTool==='region'?tr('selectEditRegion'):analysisEditTool==='pen'?tr('cutRegion'):analysisEditTool==='line'?tr('lineCutRegion'):tr('editNavigate');
 const targetLabel=analysisEditTargetMode==='auto'?tr('editAuto'):(tr(analysisEditTargetMode)||analysisEditTargetMode);
 analysisNavigateButton?.classList.toggle('is-active',analysisEditTool==='select');
 analysisSelectRegionButton?.classList.toggle('is-active',analysisEditTool==='region');
 analysisLassoButton?.classList.toggle('is-active',analysisEditTool==='lasso');
 analysisLassoDeselectButton?.classList.toggle('is-active',analysisEditTool==='unlasso');
 analysisCutButton?.classList.toggle('is-active',analysisEditTool==='pen');
 analysisLineCutButton?.classList.toggle('is-active',analysisEditTool==='line');
 if(analysisNavigateButton)analysisNavigateButton.disabled=!sceneState?.obj||analysisCutApplying||!!analysisPendingCut;
 if(analysisSelectRegionButton)analysisSelectRegionButton.disabled=!surfaceUsable||analysisCutApplying||!!analysisPendingCut;
 if(analysisLassoButton)analysisLassoButton.disabled=!surfaceUsable||analysisCutApplying||!!analysisPendingCut;
 if(analysisLassoDeselectButton)analysisLassoDeselectButton.disabled=!surfaceUsable||analysisCutApplying||!!analysisPendingCut;
 if(analysisCutButton)analysisCutButton.disabled=!surfaceUsable||analysisCutApplying||!!analysisPendingCut;
 if(analysisLineCutButton)analysisLineCutButton.disabled=!surfaceUsable||analysisCutApplying||!!analysisPendingCut;
 if(analysisEditTargetSelect){
  for(const option of analysisEditTargetSelect.options){if(option.value==='auto'){option.disabled=false;continue}option.disabled=!(segmentState[option.value]?.active&&segmentState[option.value]?.enabled)}
  if(analysisEditTargetMode!=='auto'&&analysisEditTargetSelect.querySelector('option[value="'+analysisEditTargetMode+'"]')?.disabled){setAnalysisEditTargetMode('auto');setAnalysisEditTargetKey(analysisPendingCut?.key||null)}
  analysisEditTargetSelect.value=analysisEditTargetMode;analysisEditTargetSelect.disabled=!surfaceUsable||analysisCutApplying||!!(analysisPendingCut&&analysisPendingCut.key);
 }
 if(threeEditStatus){
  if(message)threeEditStatus.textContent=message;
  else if(!sceneState?.obj)threeEditStatus.textContent=currentLanguage==='ja'?'3Dを構築すると編集できます':'Build the 3D surface to edit';
  else if(!enabledKeys.length)threeEditStatus.textContent=currentLanguage==='ja'?'編集する組織セグメントを追加してください':'Add a tissue segment to edit';
  else threeEditStatus.textContent=modeLabel+' · '+targetLabel+' · '+(+analysisCutWidth.value).toFixed(2)+' mm × '+(+analysisCutDepth.value).toFixed(1)+' mm · '+(+analysisCutYaw.value).toFixed(1)+'° / '+(+analysisCutPitch.value).toFixed(1)+'°';
 }
 if(analysisCutApply)analysisCutApply.disabled=analysisCutApplying||!analysisPendingCut||!analysisPendingCut.key;
 if(analysisCutCancel)analysisCutCancel.disabled=analysisCutApplying||!analysisPendingCut;
 if(analysisCutConfirm)analysisCutConfirm.classList.toggle('is-hidden',!analysisPendingCut||analysisCutApplying);
 for(const control of [analysisCutWidth,analysisCutDepth,analysisCutYaw,analysisCutPitch,analysisCutOffset])if(control)control.disabled=analysisCutApplying;
 if(threeEditHelp){
  if(analysisCutApplying)threeEditHelp.textContent=currentLanguage==='ja'?'切断結果を3Dへ反映しています…':'Applying cut result to 3D…';
  else if(analysisPendingCut)threeEditHelp.textContent=tr('cutPendingHint');
  else if(analysisEditTool==='region')threeEditHelp.textContent=tr('editRegionHint');
  else if(analysisEditTool==='lasso')threeEditHelp.textContent=tr('editLassoHint');
  else if(analysisEditTool==='unlasso')threeEditHelp.textContent=tr('editLassoDeselectHint');
  else if(analysisEditTool==='pen')threeEditHelp.textContent=tr('editPenHint');
  else if(analysisEditTool==='line')threeEditHelp.textContent=tr('editLineHint');
  else if(surfaceUsable)threeEditHelp.textContent=currentLanguage==='ja'?'ペン切断または直線切断を選択してください。対象「自動」は最初に触れた組織を編集します。':'Choose Pen cut or Line cut. Auto targets the first tissue you touch.';
  else threeEditHelp.textContent=tr('editAutoHint');
 }
 const cutInteractionReady=(analysisEditTool==='pen'||analysisEditTool==='line')&&!analysisPendingCut&&!analysisCutApplying&&!!sceneState?.obj&&(threeRenderMode==='surface'||(threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active));
 viewport?.classList.toggle('is-editing-3d',cutInteractionReady);
 viewport?.classList.toggle('is-editing-pen',cutInteractionReady&&analysisEditTool==='pen');
 viewport?.classList.toggle('is-editing-line',cutInteractionReady&&analysisEditTool==='line');
 const visualTarget=(analysisEditTool==='select'||analysisEditTool==='region')?null:(analysisEditTargetMode==='auto'?analysisEditTargetKey:analysisEditTargetMode);
 setEditTargetHighlight(visualTarget);
 if(analysisEditTool==='select')updateCutPreview(null);
 else if(sceneState?.editCutPreviewPoint)updateCutPreview(sceneState.editCutPreviewPoint);
}
export function editTargetRegions(){
 const ticked=analysisRegions.filter(r=>r.selected&&r.segmentKeys?.length===1);
 if(ticked.length)return ticked;
 const focused=analysisRegionById(analysisFocusedRegionId);return focused?.segmentKeys?.length===1?[focused]:[];
}
export function updateAnalysisEditorControls(){
 const region=analysisRegionById(analysisFocusedRegionId),single=region?.segmentKeys?.length===1,regionKey=single?region.segmentKeys[0]:null;
 const surfaceUsable=!!sceneState?.obj&&SEGMENT_PRESET_ORDER.some(k=>segmentState[k].active&&segmentState[k].enabled)&&(threeRenderMode==='surface'||(threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active));
 const historyKey=analysisEditTargetKey||regionKey||SEGMENT_PRESET_ORDER.find(k=>segmentEditState[k].undo.length||segmentEditState[k].redo.length||segmentEditActive(k)),historyState=historyKey?segmentEditState[historyKey]:null;
 if(!surfaceUsable&&(analysisEditTool==='region'||analysisEditTool==='lasso'||analysisEditTool==='unlasso'||analysisEditTool==='pen'||analysisEditTool==='line'))setAnalysisEditTool('select');
 if(analysisNavigateButton)analysisNavigateButton.disabled=!sceneState?.obj;
 if(analysisSelectRegionButton)analysisSelectRegionButton.disabled=!surfaceUsable;
 if(analysisLassoButton)analysisLassoButton.disabled=!surfaceUsable;
 if(analysisLassoDeselectButton)analysisLassoDeselectButton.disabled=!surfaceUsable;
 if(analysisCutButton)analysisCutButton.disabled=!surfaceUsable;
 if(analysisLineCutButton)analysisLineCutButton.disabled=!surfaceUsable;
 const hasEditTargets=editTargetRegions().length>0;
 if(analysisEditRemoveSelected)analysisEditRemoveSelected.disabled=!hasEditTargets;
 if(analysisRemoveSelected)analysisRemoveSelected.disabled=!hasEditTargets;
 if(analysisKeepSelected)analysisKeepSelected.disabled=!hasEditTargets;
 const anyTicked=analysisRegions.some(r=>r.selected);
 for(const b of [analysisDeselectAll,analysisEditDeselectAll])if(b)b.disabled=!anyTicked&&!analysisRegionById(analysisFocusedRegionId);
 if(analysisUndo)analysisUndo.disabled=!historyState?.undo?.length;
 if(analysisRedo)analysisRedo.disabled=!historyState?.redo?.length;
 if(analysisResetEdit)analysisResetEdit.disabled=!historyKey||!segmentEditActive(historyKey);
 if(analysisExportSelected)analysisExportSelected.disabled=!region;
 updateThreeEditUi();
}
