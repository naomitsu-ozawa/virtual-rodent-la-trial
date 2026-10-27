// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { sectionViewPlane, volume, sectionViewReverse, sceneState, sectionViewOpen, sectionCapEnabled } from './state.js?v=20261027-build679';
import { planes, sectionViewToggle, sectionViewResult, sectionPosition, sectionPositionValue, sectionReverse, sectionSliceImageControl, sectionCapEnabledControl, sectionCapOpacityControl, sectionCapHatchControl, sectionViewReadout } from './ui-shell.js?v=20261027-build679';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { tr } from './i18n.js?v=20261027-build679';
export function sectionPlaneLabel(p){return p?p[0].toUpperCase()+p.slice(1):''}
export function updateSectionViewUi(){
 if(!sectionViewToggle)return;
 sectionViewToggle.removeAttribute('data-i18n');sectionViewToggle.textContent=sectionViewOpen?tr('sliceAnalysisOff'):tr('sliceAnalysis');sectionViewToggle.classList.toggle('is-active',sectionViewOpen);
 sectionViewResult?.classList.toggle('is-hidden',!sectionViewOpen);
 const active=!!sectionViewPlane&&!!planes[sectionViewPlane],idx=active?+planes[sectionViewPlane].slider.value:0,max=active?+planes[sectionViewPlane].slider.max:0;
 if(sectionPosition){sectionPosition.disabled=!active;sectionPosition.max=String(max);sectionPosition.value=String(idx)}
 if(sectionPositionValue)sectionPositionValue.value=active?(idx+1)+' / '+(max+1):'—';
 if(sectionReverse)sectionReverse.disabled=!active;
 if(sectionSliceImageControl)sectionSliceImageControl.disabled=!active;
 if(sectionCapEnabledControl)sectionCapEnabledControl.disabled=!active;
 if(sectionCapOpacityControl)sectionCapOpacityControl.disabled=!active||!sectionCapEnabled;
 if(sectionCapHatchControl)sectionCapHatchControl.disabled=!active||!sectionCapEnabled;
 if(sectionViewReadout)sectionViewReadout.textContent=active?sectionPlaneLabel(sectionViewPlane)+' · '+(idx+1)+' / '+(max+1)+(sectionViewReverse?' · '+tr('sectionReverse'):''):tr('sliceAnalysisHint');
}
export function sectionLocalPoint(p=sectionViewPlane,idx=p?+planes[p].slider.value:0){
 if(!volume||!p)return null;
 const w=volume.columns,h=volume.rows,d=volume.slices,[sx,sy,sz]=volume.spacing,px=w*sx,py=h*sy,pz=d*sz,scale=3.3/Math.max(px,py,pz,1);
 if(p==='axial')return new THREE.Vector3(0,0,((idx+.5)*sz-pz/2)*scale);
 if(p==='coronal')return new THREE.Vector3(0,-((idx+.5)*sy-py/2)*scale,0);
 return new THREE.Vector3(((idx+.5)*sx-px/2)*scale,0,0);
}
export function sectionLocalNormal(p=sectionViewPlane){
 if(!p)return null;
 // the 3D plane views now face each plane as 2D draws it (app.js setAxisView), so for coronal and sagittal the
 // camera sits on the other side than before; the base normals follow, so that the default (reversed) cut keeps the half
 // behind the plane and the cut face is seen, upright as in 2D, for every plane
 const normal=p==='axial'?new THREE.Vector3(0,0,1):p==='coronal'?new THREE.Vector3(0,-1,0):new THREE.Vector3(-1,0,0);
 if(sectionViewReverse)normal.negate();return normal;
}
const sectionObjWorld=new THREE.Matrix4(),sectionNormalMatrix=new THREE.Matrix3();
export function updateSectionClipPlaneWorld(){
 if(!sceneState?.obj||!sectionViewOpen||!sectionViewPlane)return;
 const localPoint=sectionLocalPoint(),localNormal=sectionLocalNormal();if(!localPoint||!localNormal)return;
 // called every frame; the object's own world matrix only (updateMatrixWorld(true) recomputed every chunk
 // mesh's matrix each frame)
 const obj=sceneState.obj,world=sectionObjWorld.compose(obj.position,obj.quaternion,obj.scale);if(obj.parent)world.premultiply(obj.parent.matrixWorld);
 const worldPoint=localPoint.clone().applyMatrix4(world),normalMatrix=sectionNormalMatrix.getNormalMatrix(world),worldNormal=localNormal.clone().applyMatrix3(normalMatrix).normalize();
 sceneState.sectionClipPlane.setFromNormalAndCoplanarPoint(worldNormal,worldPoint);
 if(sceneState.backend==='WEBGPU'&&sceneState.sectionClipGroup){
  const g=sceneState.sectionClipGroup;g.clippingPlanes=[sceneState.sectionClipPlane];g.enabled=true;
 }
}
export function rebindWebGpuSectionClipGroup(){
 if(!sceneState?.obj||sceneState.backend!=='WEBGPU'||!THREE.ClippingGroup||!sectionViewOpen||!sectionViewPlane)return;
 const obj=sceneState.obj,old=sceneState.sectionClipGroup;
 // moving the section only moves the plane. three.js re-projects the group's planes every frame, so the group
 // is kept; a new group gives every mesh a new clipping cache key, i.e. new pipelines, which made each slider step on a
 // large mesh (iPad) very slow
 if(old&&obj.parent===old&&old.parent===sceneState.scene){old.clippingPlanes=[sceneState.sectionClipPlane];old.enabled=true;return}
 const next=new THREE.ClippingGroup();
 next.name='section_clip_group';next.enabled=true;next.clippingPlanes=[sceneState.sectionClipPlane];
 if(old&&obj.parent===old)old.remove(obj);else obj.parent?.remove?.(obj);
 if(old?.parent)old.parent.remove(old);
 sceneState.scene.add(next);next.add(obj);sceneState.sectionClipGroup=next;obj.updateMatrixWorld(true);
}
export function sectionLocalStep(p=sectionViewPlane){
 if(!volume||!p)return null;const[sx,sy,sz]=volume.spacing,w=volume.columns,h=volume.rows,d=volume.slices,scale=3.3/Math.max(w*sx,h*sy,d*sz,1);
 return p==='axial'?new THREE.Vector3(0,0,sz*scale):p==='coronal'?new THREE.Vector3(0,-sy*scale,0):new THREE.Vector3(sx*scale,0,0);
}
