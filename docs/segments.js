// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { volume, incNextSegmentMaskVolumeId } from './state.js?v=20261028-build687';
import { hexRgb } from './utils.js?v=20261028-build687';
import { settings } from './app-settings.js?v=20261028-build687';
import { buildThresholdMask, morphMask, fillMaskHoles, removeSmallMaskComponents } from './mask-ops.js?v=20261028-build687';
import { thinSuppressActive, suppressThinMask } from './thin-suppress.js?v=20261028-build687';
import { effectiveRanges } from './segment-exclusive.js?v=20261028-build687';
import { maskFromAnalysisRuns } from './run-length.js?v=20261028-build687';
import { sourceFilterStages } from './source-filters.js?v=20261028-build687';
import { gpuSlotOrder, slotSignature } from './segment-slots.js?v=20261028-build687';
import { segmentPresetDefaults } from './dataset-reset.js?v=20261028-build687';
// 'contrast' (造影領域) is the fifth preset; at most GPU_SEGMENT_SLOTS (4) are enabled at once (segment-slots.js)
export const SEGMENT_PRESET_ORDER=['bone','soft','fat','lung','contrast'];
export const segmentEditState=Object.fromEntries(SEGMENT_PRESET_ORDER.map(key=>[key,{baseRuns:null,baseSignature:'',keepRuns:null,excludeRuns:null,cutRuns:null,finalRuns:null,revision:0,undo:[],redo:[],surfaceGroup:null,rawCutSurface:false}]));
export const segmentState={
 bone:{active:false,enabled:false,color:'#f3f0e8',opacity:1,min:0,max:1,opening:0,closing:0,minComponent:0,holeFill:false,surfaceMm:0,thicknessMm:0,material:'standard',_maskCache:null,_maskCacheKey:''},
 soft:{active:false,enabled:false,color:'#f7a99c',opacity:1,min:0,max:1,opening:0,closing:0,minComponent:0,holeFill:false,surfaceMm:0,thicknessMm:0,material:'standard',_maskCache:null,_maskCacheKey:''},
 fat:{active:false,enabled:false,color:'#e7c85d',opacity:1,min:0,max:1,opening:0,closing:0,minComponent:0,holeFill:false,surfaceMm:0,thicknessMm:0,material:'standard',_maskCache:null,_maskCacheKey:''},
 lung:{active:false,enabled:false,color:'#6fb8d6',opacity:1,min:0,max:1,opening:0,closing:0,minComponent:0,holeFill:false,surfaceMm:0,thicknessMm:0,material:'standard',_maskCache:null,_maskCacheKey:''},
 contrast:{active:false,enabled:false,color:'#c026d3',opacity:1,min:0,max:1,opening:0,closing:0,minComponent:0,holeFill:false,surfaceMm:0,thicknessMm:0,material:'standard',_maskCache:null,_maskCacheKey:''}
};
// the presets' own settings as defined above (dataset-reset.js): a segment the next dataset does not use goes back to them
export const SEGMENT_PRESET_DEFAULTS=segmentPresetDefaults(segmentState);
export function analysisRegionSegmentsShown(r){return !r?.segmentKeys?.length||r.segmentKeys.some(k=>segmentState[k]?.enabled)}
export function analysisRegionShown(r){return !!r&&r.visible!==false&&analysisRegionSegmentsShown(r)}
// the segment slots the GPU views (WebGPU volume, VR / AR) use: slot i = the key at index i (segment-slots.js). Every call
// that hands the segment order to a renderer or a data builder passes this, never SEGMENT_PRESET_ORDER.
export function gpuSegmentOrder(){return gpuSlotOrder(SEGMENT_PRESET_ORDER,segmentState)}
export function gpuSegmentSignature(){return slotSignature(SEGMENT_PRESET_ORDER,segmentState)}
// non-overlapping segments (segment-exclusive.js). order = the segment cards top → bottom (priority);
// mode 'priority' (new data) or 'off' (projects saved before 438). seg.userMin / userMax = the sliders; seg.min / max =
// the range in use. pending = keys whose range in use changed since the last commit (invalidated on slider release).
export const segmentExclusive={order:['contrast','bone','fat','soft','lung'],mode:'priority',pending:new Set(),invalidate:null};
export const segmentEditGen=Object.fromEntries(SEGMENT_PRESET_ORDER.map(k=>[k,0]));
export function segmentAddsVoxels(seg){return seg.closing>0||!!seg.holeFill}
export function segmentIsVoxelTaker(key){const s=segmentState[key];return !!s&&(segmentNeedsGlobalMask(s)||segmentEditActive(key))}
export function segmentSourcesOf(key){return segmentState[key]?.exclusive?.sources||[]}
// the display / run / mask path decided voxel by voxel: own post-processing, manual edits, or voxel takers above
export function segmentNeedsVoxelMask(key){const s=segmentState[key];return !!s&&(segmentNeedsGlobalMask(s)||segmentEditActive(key)||segmentSourcesOf(key).length>0)}
// own post-processing or voxel takers above (manual edits are drawn from finalRuns separately)
export function segmentHasProcessedMask(key){const s=segmentState[key];return !!s&&(segmentNeedsGlobalMask(s)||segmentSourcesOf(key).length>0)}
export function segmentKeyOf(seg){for(const k of SEGMENT_PRESET_ORDER)if(segmentState[k]===seg)return k;return null}
// segments whose final voxels depend on this one's (transitively through their sources)
export function dependentsOf(key){
 const out=new Set(),visit=k=>{for(const o of SEGMENT_PRESET_ORDER)if(!out.has(o)&&o!==key&&segmentSourcesOf(o).includes(k)){out.add(o);visit(o)}};
 visit(key);return [...out];
}
// everything a segment's voxels depend on besides its own settings: the sources' ranges, post-processing and edit generations, recursively
// (withGen=false: the settings only, for the device cache key, which outlives the session's edit counters)
export function segmentSourceSignature(key,withGen=true,seen=new Set()){
 if(seen.has(key))return '';seen.add(key);
 return segmentSourcesOf(key).map(u=>{const g=segmentState[u];return u+':'+[g.min,g.max,g.opening,g.closing,g.minComponent,g.holeFill?1:0,g.surfaceMm,g.thicknessMm,withGen?segmentEditGen[u]|0:0].join(',')+'['+segmentSourceSignature(u,withGen,seen)+']'}).join(';');
}
export function segmentHasManualEditsUpstream(key,seen=new Set()){
 if(seen.has(key))return false;seen.add(key);
 return segmentSourcesOf(key).some(u=>segmentEditActive(u)||segmentHasManualEditsUpstream(u,seen));
}
export function applyExclusiveRanges(){
 const segs={};
 for(const key of SEGMENT_PRESET_ORDER){const s=segmentState[key];if(s.userMin==null){s.userMin=s.min;s.userMax=s.max}segs[key]={userMin:s.userMin,userMax:s.userMax,active:!!s.active,takes:!segmentIsVoxelTaker(key),adds:segmentAddsVoxels(s)}}
 const order=[...segmentExclusive.order.filter(k=>SEGMENT_PRESET_ORDER.includes(k)),...SEGMENT_PRESET_ORDER.filter(k=>!segmentExclusive.order.includes(k))];
 const r=effectiveRanges(segs,order,segmentExclusive.mode),changed=[];
 for(const key of SEGMENT_PRESET_ORDER){
  const s=segmentState[key],e=r[key],before=(s.exclusive?.sources||[]).join();s.exclusive=e;
  if(s.min!==e.min||s.max!==e.max||before!==e.sources.join()){s.min=e.min;s.max=e.max;s._maskCache=null;changed.push(key);segmentExclusive.pending.add(key)}
 }
 return changed;
}
// recompute and invalidate every segment whose range in use or voxel sources changed (and the given ones, and the segments
// below that depend on them). invalidate(full, dependent): the dependents' analysis results are dropped selectively.
export function commitExclusiveRanges(...keys){
 const before=new Set(keys.flatMap(k=>dependentsOf(k)));
 applyExclusiveRanges();
 const direct=new Set([...keys,...segmentExclusive.pending]),dependent=new Set();
 segmentExclusive.pending.clear();
 for(const k of direct){for(const o of dependentsOf(k))dependent.add(o)}
 for(const o of before)dependent.add(o);
 for(const k of direct)dependent.delete(k);
 const all=[...direct,...dependent];
 if(all.length)segmentExclusive.invalidate?.([...direct],[...dependent]);
 return all;
}
// a manual edit of the segment (keep / exclude / cut / undo / redo / reset; the caller bumps st.revision): its voxels changed, so the segments below
// that take its final voxels change too. The segment itself is handled by the caller (it knows its own refresh).
export function segmentEditsChanged(key){
 const st=segmentEditState[key];if(!st)return;
 st.finalRuns=null;segmentEditGen[key]=(segmentEditGen[key]|0)+1;
 const before=dependentsOf(key);
 const changed=applyExclusiveRanges();segmentExclusive.pending.clear();
 const all=new Set([...before,...dependentsOf(key),...changed]);all.delete(key);
 // the sources moved to a different set: the segment itself follows when its own sources changed
 if(all.size)segmentExclusive.invalidate?.([],[...all]);
}
export const segmentMaskVolumeIds=new WeakMap();
export function segmentMaskVolumeId(v){
 let id=segmentMaskVolumeIds.get(v);if(!id){id=incNextSegmentMaskVolumeId(false);segmentMaskVolumeIds.set(v,id)}return id;
}
export function segmentNeedsGlobalMask(seg){return seg.opening>0||seg.closing>0||seg.holeFill||seg.minComponent>0||thinSuppressActive(seg)}
// In-memory final voxels of a segment: the processed mask with its manual keep / exclude edits (what finalRuns holds)
function finalSegmentMask(v,key){
 const seg=segmentState[key],st=segmentEditState[key],base=getProcessedSegmentMask(v,seg,key);
 if(!segmentEditActive(key))return base;
 const out=new Uint8Array(base),keep=st.keepRuns?maskFromAnalysisRuns(v,st.keepRuns):null,ex=st.excludeRuns?maskFromAnalysisRuns(v,st.excludeRuns):null;
 for(let i=0;i<out.length;i++)if(out[i]&&((keep&&!keep[i])||(ex&&ex[i])))out[i]=0;
 return out;
}
// the voxels held by the voxel takers above (their final voxels, as drawn), subtracted from this segment
function sourceExclusionMask(v,key){
 const src=segmentSourcesOf(key);if(!src.length)return null;
 const E=new Uint8Array(v.columns*v.rows*v.slices);
 for(const u of src){const m=finalSegmentMask(v,u);for(let i=0;i<E.length;i++)if(m[i])E[i]=1}
 return E;
}
function clearMask(mask,E){for(let i=0;i<mask.length;i++)if(E[i])mask[i]=0}
export function getProcessedSegmentMask(v,seg,key=segmentKeyOf(seg)){
 const srcSig=key?segmentSourceSignature(key):'',ck=[segmentMaskVolumeId(v),seg.min,seg.max,seg.opening,seg.closing,seg.minComponent,seg.holeFill,seg.surfaceMm,seg.thicknessMm,srcSig].join('|');if(seg._maskCache&&seg._maskCacheKey===ck)return seg._maskCache;
 const w=v.columns,h=v.rows,d=v.slices;let mask=buildThresholdMask(v,seg);
 // the voxels the higher voxel takers hold are not available (their added and removed voxels both count);
 // taken out before the thin-part removal, as on the run path
 const E=key?sourceExclusionMask(v,key):null;if(E)clearMask(mask,E);
 if(thinSuppressActive(seg))mask=suppressThinMask(mask,v.data,w,h,d,v.spacing||[1,1,1],seg);
 if(seg.opening>0){mask=morphMask(mask,w,h,d,seg.opening,false);mask=morphMask(mask,w,h,d,seg.opening,true)}
 if(seg.closing>0){mask=morphMask(mask,w,h,d,seg.closing,true);mask=morphMask(mask,w,h,d,seg.closing,false)}
 if(seg.holeFill)mask=fillMaskHoles(mask,w,h,d);
 if(seg.minComponent>0)mask=removeSmallMaskComponents(mask,w,h,d,seg.minComponent);
 // what Closing or hole filling added may lie on a higher segment's voxels: the higher one keeps them
 if(E&&segmentAddsVoxels(seg))clearMask(mask,E);
 seg._maskCache=mask;seg._maskCacheKey=ck;return mask;
}
// the in-memory MPR copy holds the unfiltered CT; segments are defined on the filtered data,
// so it may stand in for the source only while no filter is active (before, Opening & co. ignored the filters)
export function sourceMemoryUsable(v){return !!v?.mprData&&!sourceFilterStages().length}
export function sourceMprMemoryView(v){
 if(!sourceMemoryUsable(v))return null;
 if(!v._mprMemoryView||v._mprMemoryView.data!==v.mprData)v._mprMemoryView={data:v.mprData,columns:v.columns,rows:v.rows,slices:v.slices,spacing:v.spacing,min:v.min,max:v.max};
 return v._mprMemoryView;
}
export function mprSegmentAlpha(seg){const s=+settings.get('mpr2dAlpha');const k=Number.isFinite(s)&&s>0?Math.min(1,s):0.65;return Math.min(Math.max(.75,k),seg.opacity*k)}
export function activeMprSegments(){
 const out=[],baseView=volume?.sourceBacked?sourceMprMemoryView(volume):volume;
 for(const key of ['lung','fat','soft','bone','contrast']){
  const seg=segmentState[key];if(!seg.active||!seg.enabled)continue;
  const edit=segmentEditState[key],voxel=segmentHasProcessedMask(key),processedMask=baseView&&voxel?getProcessedSegmentMask(baseView,seg,key):null,processedRuns=volume?.sourceBacked&&voxel?(edit.finalRuns||edit.baseRuns):null;
  out.push({key,seg,edit,processedMask,processedRuns,rgb:hexRgb(seg.color),alpha:mprSegmentAlpha(seg)});
 }
 return out;
}
export function segmentEditActive(key){const s=segmentEditState[key];return !!(s?.keepRuns||s?.excludeRuns)}
