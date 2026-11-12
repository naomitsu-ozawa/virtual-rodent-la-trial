// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { volume, activeSeries, incNextSegmentMaskVolumeId, childSegments, analysisRegions } from './state.js?v=20261112-build723';
import { isChildKey, childSegNormalizeName, childSegColorCss } from './segment-look.js?v=20261112-build723';
import { childByKey, childKeysOf, childDisplayName, onChildSegChange, emitChildSegChange, setChildRuns } from './child-segments.js?v=20261112-build723';
import { tr } from './i18n.js?v=20261112-build723';
import { HU_AXIS, axisFor, valueStepOf } from './histogram.js?v=20261112-build723';
import { hexRgb } from './utils.js?v=20261112-build723';
import { settings } from './app-settings.js?v=20261112-build723';
import { buildThresholdMask, morphMask, fillMaskHoles, removeSmallMaskComponents } from './mask-ops.js?v=20261112-build723';
import { thinSuppressActive, suppressThinMask } from './thin-suppress.js?v=20261112-build723';
import { effectiveRanges } from './segment-exclusive.js?v=20261112-build723';
import { regionHidden, setRegionHidden } from './region-visibility.js?v=20261112-build723';
import { maskFromAnalysisRuns, intersectRunArrays, subtractRunArrays } from './run-length.js?v=20261112-build723';
import { sourceFilterStages } from './source-filters.js?v=20261112-build723';
import { gpuSlotOrder, slotSignature } from './segment-slots.js?v=20261112-build723';
import { segmentPresetDefaults } from './dataset-reset.js?v=20261112-build723';
import { dataRangeOf, shadeRangeOf, moveShadeEnd, autoShadeRange, shadeSpanOf, createShadeAutoScheduler } from './cap-shade.js?v=20261112-build723';
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
// the cut-face shading range of each segment (cap-shade.js). AUTO unless the user set it: only the ranges the user set by hand (manual) are stored in segmentShadeRanges ({lower, upper}, data values; these are saved in the
// project file, data-load.js). An auto segment follows segmentShadeAuto[key] = {lower, upper, span} (2nd..98th percentile of the values of the voxels that belong to the segment, and the span of the sliders; cap-shade.js autoShadeRange, from a 4096-bin histogram over the data's own range), set by
// setSegmentShadeAuto when a computation is ready (the browser's: histogram-ui.js computeSegmentHistograms through shadeAutoPage below; VR's: vr-view.js) and never saved. Until it is ready (and for a segment without voxels / with one
// value) the initial value is used: the segment's min / max (the sliders' userMin / userMax, else min / max) cut to the data's actual min..max. Shared by VR / AR and the browser (one state, identical behaviour).
// look changes of a child segment (setChildLook below, the shading range ends): the renderers follow through onChildSegLookChange
const lookListeners=new Set();
const notifyLook=(c,changed)=>{for(const fn of [...lookListeners]){try{fn(c,changed)}catch(e){console.warn('[segment-look]',e)}}emitChildSegChange('look',c.key,changed)};
export function notifyChildrenOfParentLook(parentKey,changed){for(const c of childSegments)if(c.parentKey===parentKey)notifyLook(c,changed)}
export const segmentShadeRanges={};
export const segmentShadeAuto={};
export const shadeDataRange=()=>dataRangeOf(volume?.min,volume?.max);
// the histogram axis of the data open now (histogram.js axisFor: the CT axis, or equal bins over the data's range in whole value steps); the same object while the data and its range stay
let axisMemo=null;
export function dataAxis(v=volume){
 if(!v)return HU_AXIS;
 const m=axisMemo;if(m&&m.series===activeSeries&&m.min===v.min&&m.max===v.max)return m.axis;
 const axis=axisFor(v.min,v.max,valueStepOf(activeSeries?.slices));axisMemo={series:activeSeries,min:v.min,max:v.max,axis};return axis;
}
const shadeKeyOf=key=>isChildKey(key)?childByKey(key)?.parentKey:key;
export function segmentShadeRange(key,data=shadeDataRange()){
 key=shadeKeyOf(key);
 const s=segmentState[key];return shadeRangeOf(segmentShadeRanges[key],s?.userMin??s?.min,s?.userMax??s?.max,data,segmentShadeAuto[key])}
// the range the segment's lower / upper sliders run over: {min, max} (the values present in the segment + 5 %, else the data's full range)
export function segmentShadeSpan(key,data=shadeDataRange()){return shadeSpanOf(segmentShadeAuto[shadeKeyOf(key)],data)}
// the user moves one end of the segment's range: it is manual from now on, both ends are kept (lower cannot pass upper)
export function setSegmentShadeEnd(key,which,value,data=shadeDataRange()){
 key=shadeKeyOf(key);
 if(!segmentState[key])return null;const r=moveShadeEnd(segmentShadeRange(key,data),which,value,data);segmentShadeRanges[key]=r;notifyChildrenOfParentLook(key,['shade']);return segmentShadeRange(key,data)}
// 「自動に戻す」: the manual value is dropped, the segment follows the auto value again
export function resetSegmentShadeRange(key){key=shadeKeyOf(key);if(segmentShadeRanges[key]){delete segmentShadeRanges[key];notifyChildrenOfParentLook(key,['shade'])}}
export function clearSegmentShadeRanges(){for(const k of Object.keys(segmentShadeRanges))delete segmentShadeRanges[k]}
// the auto value of a segment is ready (null: the segment has no usable values, the initial value is used); the listeners repaint
const shadeAutoListeners=new Set();
export const onShadeAutoChange=fn=>{shadeAutoListeners.add(fn);return()=>shadeAutoListeners.delete(fn)};
const sameAuto=(a,b)=>a===b||(!!a&&!!b&&a.lower===b.lower&&a.upper===b.upper&&a.span.min===b.span.min&&a.span.max===b.span.max);
export function setSegmentShadeAuto(key,auto){
 if(isChildKey(key)){
  const c=childByKey(key);if(!c||sameAuto(c.shadeAuto,auto||undefined))return false;
  if(auto)c.shadeAuto=auto;else delete c.shadeAuto;
  for(const fn of [...shadeAutoListeners]){try{fn(key)}catch(e){console.error(e)}}
  return true;
 }
 if(!segmentState[key]||sameAuto(segmentShadeAuto[key],auto||undefined))return false;
 if(auto)segmentShadeAuto[key]=auto;else delete segmentShadeAuto[key];
 for(const fn of [...shadeAutoListeners]){try{fn(key)}catch(e){console.error(e)}}
 return true;
}
// a computation's result {key: histogram | null} -> the auto values (the data's range at this moment cuts them)
export function applyShadeAutoHistograms(results,data=shadeDataRange()){for(const [key,hist] of Object.entries(results||{}))setSegmentShadeAuto(key,autoShadeRange(hist,data))}
export function clearSegmentShadeAuto(){const had=Object.keys(segmentShadeAuto);for(const k of had)delete segmentShadeAuto[k];for(const c of childSegments)if(c.shadeAuto){delete c.shadeAuto;had.push(c.key)}if(had.length)for(const fn of [...shadeAutoListeners]){try{fn(null)}catch(e){console.error(e)}}}
// the browser's computation: histogram-ui.js registers computeSegmentHistograms(keys, stale) -> {key: 4096-bin histogram over the data's range | null} (null = no voxels) when the app starts
let shadeAutoSource=null;
export const setShadeAutoSource=fn=>{shadeAutoSource=fn};
export const shadeAutoPage=createShadeAutoScheduler({compute:(keys,stale)=>shadeAutoSource&&volume?shadeAutoSource(keys,stale):null,apply:applyShadeAutoHistograms});
// the triggers (only these two): a dataset was opened (every segment), a segment's threshold min / max changed (its keys; applyExclusiveRanges below). Another dataset: the old values go.
export const requestShadeAuto=(keys=SEGMENT_PRESET_ORDER)=>shadeAutoPage.request(keys);
// a child segment was made / loaded / changed its voxels: its auto shading range is computed from child.runsBySlice (the same pass and scheduler as the presets')
export const requestChildShadeAuto=children=>{const keys=(Array.isArray(children)?children:[children]).map(c=>c?.key).filter(Boolean);if(keys.length)shadeAutoPage.request(keys)};
// while an XR session is on the browser's counting does not run (vr-view.js tells: true at the session start, false at its end); the requests made meanwhile are asked again when it ends
export const setShadeAutoPageHeld=on=>shadeAutoPage.hold(on);
export function resetShadeAutoForDataset(){shadeAutoPage.reset();clearSegmentShadeAuto()}
// the presets' own settings as defined above (dataset-reset.js): a segment the next dataset does not use goes back to them
export const SEGMENT_PRESET_DEFAULTS=segmentPresetDefaults(segmentState);
export function analysisRegionSegmentsShown(r){return !r?.segmentKeys?.length||r.segmentKeys.some(k=>segmentState[k]?.enabled||(childSegments.length>0&&isChildKey(k)&&!!segmentById(k)?.enabled))} // a selection region of a child segment (3D edit target) follows the child (shown AND its parent ticked)
export function analysisRegionShown(r){return !!r&&r.visible!==false&&analysisRegionSegmentsShown(r)}
export function analysisRegionCounted(r){return !!r&&!regionHidden(r)&&analysisRegionSegmentsShown(r)}
// 「隠れ N」「すべて表示」(the analysis list's header): what has its SHAPE hidden = the analysis regions with region.hidden and the child segments with visible:false. Colour-off ones (region.visible:false, child colorOff) are
// not counted: their shape is there. showAllHiddenShapes puts back only these shapes (nothing else: colours, places, cuts, settings stay); -> how many it changed.
export const hiddenShapeCount=(regions=analysisRegions,children=childSegments)=>regions.filter(regionHidden).length+children.filter(c=>c.visible===false).length;
export function showAllHiddenShapes(regions=analysisRegions,children=childSegments){
 let n=0;
 for(const r of [...regions])if(regionHidden(r)&&setRegionHidden(r,false))n++;
 for(const c of [...children])if(c.visible===false&&setChildLook(c.key,{visible:true}))n++;
 return n;
}

const parentLookOf=c=>{const p=segmentState[c.parentKey],m=segmentShadeRanges[c.parentKey];return{opacity:p?.opacity??1,material:p?.material||'standard',shade:m?{lower:m.lower,upper:m.upper}:null}};
export function segmentById(key){
 if(isChildKey(key)){
  const c=childByKey(key);if(!c)return null;
  const p=segmentState[c.parentKey],look=parentLookOf(c),parentOn=!!(p?.active&&p?.enabled);
  const g={key:c.key,kind:'child',name:childDisplayName(c,x=>tr('childSegment')+' '+x.id),color:c.color,opacity:look.opacity,visible:c.visible!==false,enabled:c.visible!==false&&parentOn,min:p?(p.userMin??p.min):null,max:p?(p.userMax??p.max):null,material:look.material,shade:look.shade,parentKey:c.parentKey,runs:c.runsBySlice||null};
  return g;
 }
 const s=segmentState[key];if(!s)return null;
 const m=segmentShadeRanges[key],on=!!(s.active&&s.enabled);
 return{key,kind:'preset',name:tr(key)||key,color:s.color,opacity:s.opacity,visible:on,enabled:on,min:s.min,max:s.max,material:s.material||'standard',shade:m?{lower:m.lower,upper:m.upper}:null,parentKey:null,runs:null};
}
// every segment that can be shown / edited / counted: the active presets, then the child segments (in the tree's order); NOT the analysis regions
export const allSegmentKeys=()=>[...SEGMENT_PRESET_ORDER.filter(k=>segmentState[k].active),...childSegments.map(c=>c.key)];
// the segments the views draw now (cut-face shading chooser, histogram): the ticked presets and the child segments that are shown
export const shownSegmentKeys=()=>childSegments.length?allSegmentKeys().filter(k=>segmentById(k)?.enabled):SEGMENT_PRESET_ORDER.filter(k=>segmentState[k].active&&segmentState[k].enabled); // no child segment: the filter it always was (integration-704)
// ---- the RENDER HAND-OFF of the child segments (the WebGPU volume, VR / AR and any other renderer consume ONLY this and the change event; they never read the analysis regions for it) ----
// childRenderEntries() -> [{key, runs (the mask: runsBySlice), color ('#rrggbb'), opacity, material, shade ({lower, upper} the user set | null = auto), shadeRange ({lower, upper} in use now: manual, else auto, else initial),
//   colorOff (the child's colour is switched off: color above is then the PARENT's; opacity / material / shade are always the parent's), visible (drawn now: the child's own flag AND its parent shown), shown (the child's own flag), parentKey, parentSlot (the parent's GPU slot, gpuSegmentOrder(); -1 when it has none), hash, voxels}] in the tree's order.
// The parent's own voxels already EXCLUDE the children's (the parent is built without them: segmentSourcesOf), so a renderer draws a child from its entry and the parent as it always did. onChildRenderChange(fn) calls fn({kind, key, changed})
// after the list changed ('list') or one child's look / visibility / colour / name changed ('look').
// the colour and material a child's voxels are DRAWN with: the colour is its own, or - while its colour is switched off (c.colorOff) - its parent's (the shape stays, the child only stops standing out); the material is always its parent's (a child inherits opacity, material and shade range). segmentById(...).color stays the child's own colour (the swatch, the picker, the histogram).
export function childDrawLook(cOrKey){
 const c=typeof cOrKey==='string'?childByKey(cOrKey):cOrKey,p=segmentState[c?.parentKey];
 return{color:c?.colorOff===true?(p?.color||c.color):c?.color,material:p?.material||'standard'}; // the material is always the parent's (a child inherits); only the colour is the child's own unless it is switched off
}
export function childRenderEntries(){
 if(!childSegments.length)return [];
 const slots=gpuSegmentOrder(),data=shadeDataRange();
 return childSegments.map(c=>{const g=segmentById(c.key),look=parentLookOf(c),r=segmentShadeRange(c.key,data);
  const dl=childDrawLook(c); // colorOff: the parent's colour (the material and opacity are always the parent's: a child inherits; VR reads the same entry)
  return{key:c.key,runs:c.runsBySlice,color:dl.color,opacity:look.opacity,material:dl.material,colorOff:c.colorOff===true,shade:look.shade,shadeRange:{lower:r.lower,upper:r.upper},visible:!!g?.enabled,shown:c.visible!==false,parentKey:c.parentKey,parentSlot:slots.indexOf(c.parentKey),hash:c.hash,voxels:c.voxels}});
}
export const onChildRenderChange=onChildSegChange;
export const onChildSegLookChange=fn=>{lookListeners.add(fn);return()=>{lookListeners.delete(fn)}};
export function setChildLook(key,patch){
 const c=childByKey(key);if(!c||!patch)return false;
 const changed=[];
 if('visible' in patch){const v=!!patch.visible;if(v!==(c.visible!==false)){c.visible=v;changed.push('visible')}}
 if('colorOff' in patch){const v=patch.colorOff===true;if(v!==(c.colorOff===true)){c.colorOff=v;changed.push('colorOff')}}
 if('color' in patch){const v=childSegColorCss(patch.color);if(v!==c.color){c.color=v;changed.push('color')}}
 if('name' in patch){const v=childSegNormalizeName(patch.name);if(v!==(c.name||'')){c.name=v;changed.push('name')}}
 if(!changed.length)return false;
 notifyLook(c,changed);
 return true;
}
// the segment slots the GPU views (WebGPU volume, VR / AR) use: slot i = the key at index i (segment-slots.js). Every call
// that hands the segment order to a renderer or a data builder passes this, never SEGMENT_PRESET_ORDER.
export function gpuSegmentOrder(){return gpuSlotOrder(SEGMENT_PRESET_ORDER,segmentState)}
export function gpuSegmentSignature(){return slotSignature(SEGMENT_PRESET_ORDER,segmentState)}
// non-overlapping segments (segment-exclusive.js). order = the segment cards top → bottom (priority);
// mode 'priority' (new data) or 'off' (projects saved before 438). seg.userMin / userMax = the sliders; seg.min / max =
// the range in use. pending = keys whose range in use changed since the last commit (invalidated on slider release).
export const segmentExclusive={order:['contrast','bone','fat','soft','lung'],mode:'priority',pending:new Set(),invalidate:null,invalidateParent:null}; // invalidateParent(key): a preset's child segments changed, its voxels with them (app.js: the analysis results are NOT cleared)
export const segmentEditGen=Object.fromEntries(SEGMENT_PRESET_ORDER.map(k=>[k,0]));
// a child has an edit state of the preset's shape, so the preset edit code (analysis-ops.js: keep / delete selected, cut, undo / redo / reset) runs on it unchanged. baseRuns = the child's mask before the edits;
// the child's own runsBySlice is always the FINAL one (base ∩ keep - exclude, segmentEditsChanged below), so every renderer, the STL, the measurement and the project file see the edited child. The undo stack is not saved (a project holds the final mask).
export function registerChildEditState(c){segmentEditState[c.key]={baseRuns:c.runsBySlice,baseSignature:'',keepRuns:c.runsBySlice,excludeRuns:null,cutRuns:null,finalRuns:null,revision:0,undo:[],redo:[],surfaceGroup:null,rawCutSurface:false,isChild:true};segmentEditGen[c.key]=0} // keepRuns = baseRuns = "edited, nothing taken yet": segmentEditActive stays the 704 expression
export function unregisterChildEditState(key){delete segmentEditState[key];delete segmentEditGen[key]}
function childEditsChanged(key,st){
 if(!childByKey(key))return;
 if(!st.keepRuns)st.keepRuns=st.baseRuns; // an undo / reset to "no edit" restores the marker (see registerChildEditState)
 let runs=st.baseRuns;const d=runs.length;
 if(st.keepRuns!==st.baseRuns)runs=intersectRunArrays(runs,st.keepRuns,d);
 if(st.excludeRuns)runs=subtractRunArrays(runs,st.excludeRuns,d);
 st.finalRuns=runs;segmentEditGen[key]=(segmentEditGen[key]|0)+1;
 setChildRuns(key,runs); // the listeners (child-segments-ui.js) rebuild the parent without / with the voxels, the surface, the GPU volume, the 2D views
}
export function segmentAddsVoxels(seg){return seg.closing>0||!!seg.holeFill}
export function segmentIsVoxelTaker(key){const s=segmentState[key];return !!s&&(segmentNeedsGlobalMask(s)||segmentEditActive(key))}
// the child segments of a preset are among its sources: their voxels belong to them, so the preset is built WITHOUT them (the same voxel-taker path as the segments above it: subtracted from the mask / runs, the run surface,
// the 2D painting) and hiding a child makes its voxels invisible. Without child segments (the usual data) this is the line it always was.
// The parent is ALWAYS built without its children (the mesh view, 2D, histogram, measurement and STL see it so, in every render mode). The GPU volume view needs the children's voxels inside the parent's mask (it draws a child
// from its own index texture): gpu-volume-data.js withChildRuns puts them back in the volume's edit descriptors only (VR: vr-view.js editDescsOf does the same).
export function segmentSourcesOf(key){if(!childSegments.length)return segmentState[key]?.exclusive?.sources||[]; /* no child segment: the line it always was (integration-704) */const ex=segmentState[key]?.exclusive?.sources||[],ck=childKeysOf(key);return ck.length?[...ex,...ck]:ex}
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
 return segmentSourcesOf(key).map(u=>{if(childSegments.length&&isChildKey(u)){const c=childByKey(u);return 'child:'+(c?c.hash+'.'+c.voxels:'')}const g=segmentState[u];return u+':'+[g.min,g.max,g.opening,g.closing,g.minComponent,g.holeFill?1:0,g.surfaceMm,g.thicknessMm,withGen?segmentEditGen[u]|0:0].join(',')+'['+segmentSourceSignature(u,withGen,seen)+']'}).join(';');
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
 if(changed.length)requestShadeAuto(changed); // a segment's threshold changed (its voxels with it): its auto shading range is computed again (300 ms after the last change)
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
 if(st.isChild){childEditsChanged(key,st);return} // a child segment: its mask follows its edit state; the parent is rebuilt through the child's change event, the analysis results are not cleared
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
 for(const u of src){
  if(isChildKey(u)){const c=childByKey(u),w=v.columns,h=v.rows;if(c)for(let z=0;z<v.slices;z++){const a=c.runsBySlice?.[z];if(!a)continue;for(let i=0;i<a.length;i+=3)E.fill(1,z*w*h+a[i]*w+a[i+1],z*w*h+a[i]*w+a[i+2]+1)}continue} // a child's mask goes straight into the exclusion
  const m=finalSegmentMask(v,u);for(let i=0;i<E.length;i++)if(m[i])E[i]=1}
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
export function segmentEditActive(key){const s=segmentEditState[key];return !!(s?.keepRuns||s?.excludeRuns)} // a child segment always counts as edited (its keepRuns is its baseRuns: registerChildEditState), so its voxels are its own runs, never a threshold
