// Hidden / exposed judgement of the 3D position-comment markers in the PC / iPad view. Pure (no three.js, no DOM): comment-3d.js
// feeds it the points, the camera and the classification bytes. The RULE is VR's, not a copy: vr-point.js pointIsHidden (march half a voxel at a
// time from the point towards the eye; a voxel of a shown segment (>= 128) on the kept side of every cutting plane before the eye = hidden;
// the point's own voxel is skipped; segment opacity ignored; nothing shown = exposed). On PC the eye is the camera position.
import { pointIsHidden } from './vr-point.js?v=20261112-build723';
import { regionHidden, regionLutAlpha, hiddenRegionVoxelOf } from './region-visibility.js?v=20261112-build723';
import { buildRegionIndexOf } from './vr-volume-prep.js?v=20261112-build723';

export const HIDDEN_INTERVAL_MS=100; // while the view moves the judgement is refreshed about 10 times a second, never every frame

// The cutting plane of the PC section view in object space for pointIsHidden: kept side n.p - w >= 0 (n unit). point / normal = the
// section's plane point and normal in object space (section-view.js sectionLocalPoint / sectionLocalNormal; the normal already follows
// "reverse"). null / missing -> no plane.
export function sectionPlaneLocal(point,normal){
 if(!point||!normal)return null;
 const len=Math.hypot(normal.x,normal.y,normal.z);if(!(len>1e-9))return null;
 const n={x:normal.x/len,y:normal.y/len,z:normal.z/len};
 return{x:n.x,y:n.y,z:n.z,w:n.x*point.x+n.y*point.y+n.z*point.z};
}

// channels of the segments that are shown now (cls.chan[segment] is the channel, -1 none); shown = active && enabled, like the 3D view
export function shownChannels(cls,segmentState,order=['bone','soft','fat','lung']){ // order = the GPU slots (segments.js gpuSegmentOrder)
 const chs=[];if(!cls)return chs;
 order.slice(0,4).forEach((k,i)=>{const g=segmentState?.[k],c=cls.chan[i];if(g?.active&&g.enabled&&c>=0)chs.push(c)});
 return chs;
}

const indexed=regions=>(regions||[]).filter(r=>r&&r.runsBySlice&&r.voxels>0);
export function hiddenRegionSignature(regions,order){
 const all=indexed(regions);if(!all.some(regionHidden))return '';
 return (order||[]).join('>')+'|'+all.map(r=>r.id+':'+r.voxels+':'+(regionHidden(r)?'h':'v')+':'+(r.segmentKeys||[]).join('+')).join(',');
}
// -> (x,y,z,c) -> true for a voxel of a hidden result on the slot of channel c (null = no hidden result). The same index / table rule as VR (buildRegionIndexOf on the classification grid + regionLutAlpha's hide bits + hiddenRegionVoxelOf).
export function hiddenRegionSkipOf(prep,regions,order,sourceDims){
 if(!prep?.cls||!prep.dims||!sourceDims)return null;
 const all=indexed(regions);if(!all.some(regionHidden))return null;
 const slots=order||[],items=all.map(r=>({color:Number(r.color??0x00d8ff),segMask:(r.segmentKeys||[]).reduce((m,k)=>{const sl=slots.indexOf(k);return sl>=0&&sl<4?m|(1<<sl):m},0),runsBySlice:r.runsBySlice,mm3:0,segmentKeys:[...(r.segmentKeys||[])],rid:r.id}));
 const idx=buildRegionIndexOf(items,sourceDims,prep.dims);if(!idx.ids)return null;
 const lut=new Float32Array(4*(idx.list.length+1));idx.list.forEach((e,i)=>{const r=all.find(x=>x.id===e.rid);if(r&&regionHidden(r))lut[4*(i+1)+3]=regionLutAlpha(e.segMask,{hidden:true})});
 return hiddenRegionVoxelOf(idx.ids,prep.dims,lut,prep.cls.chan);
}
// prep + the skip of the hidden results, as one object ({cls,dims,halfExt,skip}; the same prep when nothing is hidden). Cached on (the bytes, the signature, the source grid), so a frame in which nothing changed builds nothing.
let skipCache={cls:null,sig:'',dimsKey:'',prep:null};
export function withHiddenRegionSkip(prep,regions,order,sourceDims){
 if(!prep?.cls)return prep;
 const sig=hiddenRegionSignature(regions,order);if(!sig)return prep;
 const dimsKey=(sourceDims||[]).join(',');
 if(skipCache.prep&&skipCache.cls===prep.cls&&skipCache.sig===sig&&skipCache.dimsKey===dimsKey)return skipCache.prep;
 const skip=hiddenRegionSkipOf(prep,regions,order,sourceDims),out=skip?{...prep,skip}:prep;
 skipCache={cls:prep.cls,sig,dimsKey,prep:out};return out;
}

// -> Set of the ids of the hidden points. points: [{id,local:{x,y,z}}] (object space); eyeLocal: the camera in object space;
// prep: {cls,dims:[w,h,d],halfExt} (null / no cls = nothing to hide behind: all exposed); plane: sectionPlaneLocal() or null
export function computeHiddenIds(points,eyeLocal,prep,{chs=[],plane=null}={}){
 const out=new Set();
 if(!prep?.cls||!chs.length||!points?.length||!eyeLocal)return out;
 const opt={cls:prep.cls,dims:prep.dims,halfExt:prep.halfExt,chs,planes:plane?[plane]:[],count:plane?1:0,cut:plane?1:0,skip:prep.skip||null};
 for(const p of points)if(pointIsHidden(p.local,eyeLocal,opt))out.add(p.id);
 return out;
}

// Throttle state: step(now,dirty) -> {run,wait}. run: do the judgement now. wait: ms until a trailing pass is due (0 = none), so the last
// camera position after the motion stops always gets a pass. dirty = the inputs changed (comments, segments, section, camera): a change
// is judged at once when the interval has passed, otherwise at the end of it; an idle frame with nothing changed does nothing.
export function createHiddenThrottle(intervalMs=HIDDEN_INTERVAL_MS){
 let last=-Infinity,pending=true; // the first call always runs
 return{
  step(now,dirty=false){
   if(dirty)pending=true;
   if(!pending)return{run:false,wait:0};
   const since=now-last;
   if(since>=intervalMs){last=now;pending=false;return{run:true,wait:0}}
   return{run:false,wait:Math.ceil(intervalMs-since)};
  },
  reset(){last=-Infinity;pending=true},
 };
}
