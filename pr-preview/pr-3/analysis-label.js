// Analysis result labels: the label of an analysis result (colour, number, segments, volume) pinned at a point of the volume, in VR and on the PC / iPad 3D view,
// and MOVABLE in both. Pure functions (no DOM, no three.js); the label lives on the analysis region itself (region.label), so it is saved in the project with the
// region, follows the region's removal for free and is the same object for every view.
//   label = { anchor:{i,j,k}, offset?:{i,j,k} }
//   anchor : the point the label refers to, in VOXEL units of the data (floats, voxel centres at +.5 as in voxelToLocal / voxelToLocal3D)
//   offset : where the user left the label, as the vector from the anchor in VOXEL units (the same convention as a distance label's labelOffset in measurements.js), so it does not
//            depend on the model's move / rotation / scale and is the same in VR and on the PC. No offset = the view's default placement (beside the anchor, facing the viewer).
// A leader line joins a moved label to its anchor (leaderVisible).
import { stepDelta, offsetFromDelta } from './measure-label.js?v=20261023-build659';

export const ANALYSIS_LABEL_MAX=1e4; // |component| limit (voxels): anything beyond is a corrupt file, dropped
const num=(x)=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=ANALYSIS_LABEL_MAX;
const r3=x=>Math.round(x*1000)/1000;
const vec=o=>{if(!o||typeof o!=='object')return null;const{i,j,k}=o;return num(i)&&num(j)&&num(k)?{i:r3(i),j:r3(j),k:r3(k)}:null};
// untrusted input (a project file) or a fresh label -> a clean label, or null (no / invalid anchor = no label; an invalid offset = the default placement)
export function normalizeAnalysisLabel(l){
 const anchor=vec(l?.anchor);if(!anchor)return null;
 const offset=vec(l?.offset);
 return offset?{anchor,offset}:{anchor};
}
export const sameVec=(a,b)=>(a?a.i+','+a.j+','+a.k:'')===(b?b.i+','+b.j+','+b.k:'');
export const sameLabel=(a,b)=>sameVec(a?.anchor,b?.anchor)&&sameVec(a?.offset,b?.offset);
export const hasOffset=l=>!!vec(l?.offset);
// the leader (label -> anchor) is shown once the label was moved away from its default place (a zero offset has nothing to lead)
export const leaderVisible=l=>{const o=vec(l?.offset);return !!o&&(Math.abs(o.i)>1e-6||Math.abs(o.j)>1e-6||Math.abs(o.k)>1e-6)};
// a label with a new offset (null = back to the default); the anchor is kept. Returns the clean label (a new object) or null for an invalid label.
export function withOffset(l,offset){
 const a=vec(l?.anchor);if(!a)return null;
 const o=offset==null?null:vec(offset);if(offset!=null&&!o)return null; // an invalid offset is refused, not "reset"
 return o?{anchor:a,offset:o}:{anchor:a};
}

// ---- data space <-> a view's local space ----
// step = the view's change per voxel along i / j / k: PC 3D [sx*k,-sy*k,sz*k] (comment-3d.js voxelStep3d), VR [2hx/cols,-2hy/rows,2hz/slices] (vr-measure.js voxelStep)
// the label's place in the view's local space: the anchor's local point + the offset in that view's units
export function labelLocal(anchorLocal,offset,step){
 const d=offset?stepDelta(offset,step):{x:0,y:0,z:0};
 return{x:anchorLocal.x+d.x,y:anchorLocal.y+d.y,z:anchorLocal.z+d.z};
}
// the offset (voxel units) that puts the label at `p` (the view's local space), given the anchor's local point
export const offsetForLocal=(anchorLocal,p,step)=>offsetFromDelta({x:p.x-anchorLocal.x,y:p.y-anchorLocal.y,z:p.z-anchorLocal.z},step);

// VR local (vr-point.js voxelToLocal) -> voxel (floats). halfExt = half extents of the box; dims {columns,rows,slices}
export function voxelFromLocalVr(p,halfExt,dims){
 return{i:(p.x/(2*halfExt[0])+.5)*dims.columns-.5,j:(.5-p.y/(2*halfExt[1]))*dims.rows-.5,k:(p.z/(2*halfExt[2])+.5)*dims.slices-.5};
}
// PC 3D local (crosshair.js voxelToLocal3D) -> voxel (floats)
export function voxelFromLocal3d(p,dims,spacing){
 const[sx,sy,sz]=spacing||[1,1,1],px=dims.columns*sx,py=dims.rows*sy,pz=dims.slices*sz,scale=3.3/Math.max(px,py,pz,1);
 return{i:(p.x/scale+px/2)/sx-.5,j:(-p.y/scale+py/2)/sy-.5,k:(p.z/scale+pz/2)/sz-.5};
}
// a voxel inside the dims (anchors are clamped so a label whose region was edited / a corrupt value never lies far outside the volume)
export function clampVoxel(v,dims){
 const c=(x,n)=>Math.min(Math.max(x,-.5),n-.5);
 return{i:c(v.i,dims.columns),j:c(v.j,dims.rows),k:c(v.k,dims.slices)};
}

// ---- state (on the region) ----
// regions: the analysisRegions array (or any list of {id,label?}). Changes are announced to the views (onAnalysisLabelsChange), which redraw.
const listeners=new Set();
export const onAnalysisLabelsChange=cb=>{listeners.add(cb);return()=>listeners.delete(cb)};
export const emitAnalysisLabelsChange=info=>{for(const cb of [...listeners])cb(info)};
// pin / replace the label of a region at an anchor (voxel units); keeps an existing offset only when keepOffset. false when the region is missing / the anchor is invalid.
export function setRegionLabel(region,label){
 if(!region)return false;
 if(label==null){if(!region.label)return true;delete region.label;emitAnalysisLabelsChange({id:region.id});return true}
 const l=normalizeAnalysisLabel(label);if(!l)return false;
 if(sameLabel(region.label,l))return true;
 region.label=l;emitAnalysisLabelsChange({id:region.id});return true;
}
// move the label (offset in voxel units from the anchor) or null = the default place; an unchanged value is not a change. labelOnly: only the place changed (a redraw, no re-judgement of anything else)
export function setRegionLabelOffset(region,offset){
 if(!region?.label)return false;
 const next=withOffset(region.label,offset);if(!next)return false;
 if(sameLabel(region.label,next))return true;
 const toggled=leaderVisible(region.label)!==leaderVisible(next);
 region.label=next;emitAnalysisLabelsChange({id:region.id,labelOnly:true,moveToggled:toggled}); // moveToggled: moved <-> default changed (a button state follows it)
 return true;
}
// the label of a region for the project file (a clean copy) / for a snapshot, or undefined
export const labelForProject=region=>normalizeAnalysisLabel(region?.label)||undefined;

// a result's label follows its segments' visibility (VR; the PC 3D view gets it through analysisRegionShown): shown while the result has no segment, or at least one of its segments
// is shown (`isShown(key)`); hidden while all of them are hidden. Nothing about the label changes (its anchor / moved place stay), so showing the segment again brings it back where it was.
export const labelSegmentsShown=(segmentKeys,isShown)=>!segmentKeys?.length||segmentKeys.some(k=>isShown(k));

// ---- the views' per-voxel steps ----
// VR: object-space change per voxel along i / j / k (vr-point.js voxelToLocal); PC 3D: crosshair.js voxelToLocal3D (the longest side is 3.3 units)
export const vrVoxelStep=(halfExt,dims)=>[2*halfExt[0]/dims.columns,-2*halfExt[1]/dims.rows,2*halfExt[2]/dims.slices];
export function pcVoxelStep(dims,spacing){
 const[sx,sy,sz]=spacing||[1,1,1],k=3.3/Math.max(dims.columns*sx,dims.rows*sy,dims.slices*sz,1);
 return[sx*k,-sy*k,sz*k];
}
// where a leader line meets the edge of a label card: (dx,dy) = the direction from the card's centre to the anchor in the card's plane, (hw,hh) = the card's half size.
// Returns the point on the card's rectangle in that direction (the centre when there is no direction -> the bottom edge's middle).
export function rectEdgePoint(dx,dy,hw,hh){
 const ax=Math.abs(dx),ay=Math.abs(dy);
 if(ax<1e-12&&ay<1e-12)return{x:0,y:-hh};
 const s=Math.min(ax>1e-12?hw/ax:Infinity,ay>1e-12?hh/ay:Infinity);
 return{x:dx*s,y:dy*s};
}

// ---- the anchor of a label pinned on the PC ----
// A result's inside voxel would put its card INSIDE the tissue in VR (a ghost behind bone), so the PC pins on the result's SURFACE as the current camera sees it: march from the eye
// (voxel units, {i,j,k}) towards a voxel inside the result and take the first sample that lies in it (contains(i,j,k) on rounded voxel indices). Deterministic, at most maxSteps tests
// (a long ray is cut to its last maxSteps samples, the part nearest the target). Returns the entry point {i,j,k} (floats), or null when the ray never meets the result.
export function surfaceAnchor({contains,eye,target,step=.5,maxSteps=6000}){
 const dx=target.i-eye.i,dy=target.j-eye.j,dz=target.k-eye.k,len=Math.hypot(dx,dy,dz);
 if(!(len>1e-9)||typeof contains!=='function')return null;
 const ux=dx/len,uy=dy/len,uz=dz/len,n=Math.min(Math.ceil(len/step)+1,maxSteps),t0=Math.max(0,len-(n-1)*step);
 for(let s=0;s<n;s++){
  const t=t0+s*step,p={i:eye.i+ux*t,j:eye.j+uy*t,k:eye.k+uz*t};
  if(contains(Math.round(p.i),Math.round(p.j),Math.round(p.k)))return p;
 }
 return contains(Math.round(target.i),Math.round(target.j),Math.round(target.k))?{i:target.i,j:target.j,k:target.k}:null;
}
