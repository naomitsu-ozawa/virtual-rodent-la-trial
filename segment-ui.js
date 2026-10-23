// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { mark3DStale } from './three-state.js?v=20261022-build656';
import { $, footer, threeLabel, ctRangeAuto, ctRangeFull, wc, ww, sigmoidCenter, wcVal, wwVal, sigmoidCenterValue, segmentControls, segmentAddSelect, segmentAddButton } from './ui-shell.js?v=20261022-build656';
import { sceneState, setAnalysisRegions, setAnalysisFocusedRegionId, setNextAnalysisRegionId, setNextAnalysisColorIndex, volume, segmentRenderTimer, incSourceRenderRevision, threeRenderMode, ctRangeMode, ctRangeProfile, setCtRangeMode, sourceVolume } from './state.js?v=20261022-build656';
import { dispose } from './surface-mesh.js?v=20261022-build656';
import { request3DRender } from './scene3d.js?v=20261022-build656';
import { renderAnalysisResults } from './analysis-results.js?v=20261022-build656';
import { segmentEditState, segmentEditGen, SEGMENT_PRESET_ORDER, segmentState, segmentExclusive, commitExclusiveRanges, gpuSegmentSignature } from './segments.js?v=20261022-build656';
import { canEnableSegment } from './segment-slots.js?v=20261022-build656';
import { tr } from './i18n.js?v=20261022-build656';
import { niceCtStep, formatCtValue } from './utils.js?v=20261022-build656';
import { syncGpuVolumeEdits } from './gpu-volume-data.js?v=20261022-build656';
import { renderAll } from './mpr-render.js?v=20261022-build656';
export function installSegmentReorder(onCommit){
 let drag=null;
 const cards=()=>[...segmentControls.querySelectorAll('[data-segment]')];
 for(const handle of segmentControls.querySelectorAll('[data-seg-drag]')){
  handle.addEventListener('pointerdown',e=>{
   const card=handle.closest('[data-segment]');if(!card)return;
   drag={card,handle,id:e.pointerId,before:cards().map(c=>c.dataset.segment).join()};handle.setPointerCapture?.(e.pointerId);card.classList.add('is-dragging');e.preventDefault();
  });
  // moving the card in the DOM drops the handle's pointer capture: move / up are followed on the window
  window.addEventListener('pointermove',e=>{
   if(!drag||e.pointerId!==drag.id||drag.handle!==handle)return;
   const over=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-segment]');
   if(!over||over===drag.card||over.classList.contains('is-hidden')||over.parentElement!==drag.card.parentElement)return;
   const r=over.getBoundingClientRect(),after=e.clientY>r.top+r.height/2;
   over.parentElement.insertBefore(drag.card,after?over.nextSibling:over);
  });
  const end=e=>{
   if(!drag||e.pointerId!==drag.id)return;const d=drag;drag=null;d.card.classList.remove('is-dragging');
   const order=cards().map(c=>c.dataset.segment);if(order.join()===d.before)return;
   segmentExclusive.order=order.filter(k=>SEGMENT_PRESET_ORDER.includes(k));onCommit?.();
  };
  window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
 }
}
// at most 4 segments are enabled (shown) at once (the GPU views have 4 slots, segment-slots.js). True = refused (a message is shown,
// nothing changes: the user turns one off first; nothing is switched off automatically)
export function refuseSegmentEnable(key){
 if(canEnableSegment(SEGMENT_PRESET_ORDER,segmentState,key))return false;
 footer.textContent=tr('segmentLimit');return true;
}
// sets the shown flag; the contrast preset moves between GPU slots, so the GPU edit masks follow when the slot assignment changed
// (a processed segment shown again is resynced by its refresh in app.js; hiding needs no upload)
export function setSegmentEnabled(key,on){
 const before=gpuSegmentSignature();segmentState[key].enabled=!!on;
 if(gpuSegmentSignature()!==before&&threeRenderMode==='volume')syncGpuVolumeEdits(sourceVolume||volume);
}
export function renderSegmentPresets(){
 const active=new Set(SEGMENT_PRESET_ORDER.filter(key=>segmentState[key].active));
 // the cards stand in the priority order (top = first), see segment-exclusive.js
 for(const key of segmentExclusive.order){const card=segmentControls.querySelector('[data-segment="'+key+'"]');if(card)card.parentElement.append(card)}
 const modeSel=document.getElementById('segment-exclusive-mode');if(modeSel)modeSel.value=segmentExclusive.mode;
 for(const key of SEGMENT_PRESET_ORDER){
  const card=segmentControls.querySelector('[data-segment="'+key+'"]');
  if(card)card.classList.toggle('is-hidden',!active.has(key));
  const option=[...segmentAddSelect.options].find(o=>o.value===key);
  if(option)option.disabled=active.has(key);
 }
 const next=[...segmentAddSelect.options].find(o=>!o.disabled);
 if(next)segmentAddSelect.value=next.value;
 segmentAddSelect.disabled=!volume||!next;
 segmentAddButton.disabled=!volume||!next;
}
export function addSegmentPreset(key){
 if(!volume||!SEGMENT_PRESET_ORDER.includes(key)||segmentState[key].active)return;
 const seg=segmentState[key];seg.active=true;
 // a fifth enabled segment is refused: the card is added, its checkbox stays off (turn another one off, then tick it)
 const allowed=!refuseSegmentEnable(key);setSegmentEnabled(key,allowed);
 const enabled=$('[data-seg-enabled="'+key+'"]'),color=$('[data-seg-color="'+key+'"]'),min=$('[data-seg-min="'+key+'"]'),max=$('[data-seg-max="'+key+'"]'),opacity=$('[data-seg-opacity="'+key+'"]'),exportBtn=$('[data-seg-export="'+key+'"]'),removeBtn=$('[data-seg-remove="'+key+'"]'),opening=$('[data-seg-opening="'+key+'"]'),closing=$('[data-seg-closing="'+key+'"]'),minComponent=$('[data-seg-min-component="'+key+'"]'),holeFill=$('[data-seg-hole-fill="'+key+'"]');
 enabled.checked=allowed;enabled.disabled=false;color.disabled=false;min.disabled=false;max.disabled=false;opacity.disabled=false;
 opening.disabled=false;closing.disabled=false;minComponent.disabled=false;holeFill.disabled=false;
 for(const [attr] of THIN_SLIDERS){const el=$('[data-seg-'+attr+'="'+key+'"]');if(el)el.disabled=false}
 if(exportBtn)exportBtn.disabled=true;if(removeBtn)removeBtn.disabled=false;
 // a new card takes part in the priority: the segments below it may lose part of their range
 renderSegmentPresets();commitExclusiveRanges();renderAll();scheduleSegment3D();
}
export function removeSegmentPreset(key){
 if(!SEGMENT_PRESET_ORDER.includes(key)||!segmentState[key].active)return;
 const seg=segmentState[key];seg.active=false;seg.enabled=false;clearSegmentEditCache(key,true);if(threeRenderMode==='volume')syncGpuVolumeEdits(sourceVolume||volume);
 const enabled=$('[data-seg-enabled="'+key+'"]'),removeBtn=$('[data-seg-remove="'+key+'"]');
 if(enabled)enabled.checked=false;if(removeBtn)removeBtn.disabled=true;
 renderSegmentPresets();commitExclusiveRanges();clearAnalysisHighlight();renderAll();scheduleSegment3D();
}
export function ctSliderUnit(p){
 return Number.isInteger(p.fullMin)&&Number.isInteger(p.fullMax)?1:niceCtStep(p.fullSpan)/10;
}
// a typed CT value may widen its slider up to the data's full range (range-entry.js)
export function ctSliderFullBounds(el){
 const p=ctRangeProfile;if(!p||!el)return null;
 if(el===ww)return[Math.max(niceCtStep(p.fullSpan),1e-6),p.fullWidthMax];
 if(el===wc||el===sigmoidCenter||el.matches?.('[data-seg-min],[data-seg-max]'))return[p.fullMin,p.fullMax];
 return null;
}
export function setCtSliderRange(el,min,max,step){
 if(!el)return;
 // the ends on the step grid (multiples of the step), so the slider stops on whole values whatever the
 // window (an auto window can start at a fraction); before, the grid started at the window's own minimum
 const value=+el.value,lo=Math.floor(Math.min(min,value)/step)*step,hi=Math.ceil(Math.max(max,value)/step)*step;
 el.min=String(+lo.toFixed(8));el.max=String(+Math.max(lo+step,hi).toFixed(8));el.step=String(step);
 el.value=String(value);
}
export function autoAround(value,halfSpan,fullMin,fullMax){
 const v=Number.isFinite(+value)?+value:(fullMin+fullMax)/2;
 let lo=Math.max(fullMin,v-halfSpan),hi=Math.min(fullMax,v+halfSpan);
 if(hi<=lo){lo=fullMin;hi=fullMax}
 return[lo,hi];
}
export function applyCtRangeMode(mode=ctRangeMode){
 if(!ctRangeProfile||!volume)return;
 setCtRangeMode(mode==='full'?'full':'auto');
 ctRangeAuto.classList.toggle('is-active',ctRangeMode==='auto');
 ctRangeFull.classList.toggle('is-active',ctRangeMode==='full');
 const p=ctRangeProfile,unit=ctSliderUnit(p),fullStep=unit,autoStep=unit,wwFloor=niceCtStep(p.fullSpan),wwAutoFloor=niceCtStep(Math.max(p.width*2,p.fullSpan/20));
 if(ctRangeMode==='full'){
  setCtSliderRange(wc,p.fullMin,p.fullMax,fullStep);
  setCtSliderRange(ww,Math.max(wwFloor,1e-6),p.fullWidthMax,fullStep);
  setCtSliderRange(sigmoidCenter,p.fullMin,p.fullMax,fullStep);
  for(const key of SEGMENT_PRESET_ORDER){
   setCtSliderRange($('[data-seg-min="'+key+'"]'),p.fullMin,p.fullMax,fullStep);
   setCtSliderRange($('[data-seg-max="'+key+'"]'),p.fullMin,p.fullMax,fullStep);
  }
 }else{
  const half=Math.max(p.width,p.fullSpan/200);
  let r=autoAround(+wc.value,half,p.fullMin,p.fullMax);setCtSliderRange(wc,r[0],r[1],autoStep);
  const currentWidth=Math.max(+ww.value,wwAutoFloor),wwLo=Math.max(wwAutoFloor,currentWidth-p.width),wwHi=Math.min(p.fullWidthMax,Math.max(currentWidth+p.width,currentWidth*1.5));
  setCtSliderRange(ww,wwLo,Math.max(wwLo+wwAutoFloor,wwHi),autoStep);
  r=autoAround(+sigmoidCenter.value,half,p.fullMin,p.fullMax);setCtSliderRange(sigmoidCenter,r[0],r[1],autoStep);
  for(const key of SEGMENT_PRESET_ORDER){
   const minEl=$('[data-seg-min="'+key+'"]'),maxEl=$('[data-seg-max="'+key+'"]');
   let rr=autoAround(+minEl.value,half,p.fullMin,p.fullMax);setCtSliderRange(minEl,rr[0],rr[1],autoStep);
   rr=autoAround(+maxEl.value,half,p.fullMin,p.fullMax);setCtSliderRange(maxEl,rr[0],rr[1],autoStep);
  }
 }
 wcVal.value=formatCtValue(+wc.value,+wc.step);wwVal.value=formatCtValue(+ww.value,+ww.step);
 sigmoidCenterValue.value=formatCtValue(+sigmoidCenter.value,+sigmoidCenter.step);
 for(const key of SEGMENT_PRESET_ORDER)updateSegmentOutputs(key);
}
export function updateSegmentOutputs(key){
 const minEl=$('[data-seg-min="'+key+'"]'),maxEl=$('[data-seg-max="'+key+'"]');
 const s=segmentState[key],st=+minEl?.step||1;
 $('[data-seg-min-out="'+key+'"]').value=formatCtValue(s.userMin??s.min,st);
 $('[data-seg-max-out="'+key+'"]').value=formatCtValue(s.userMax??s.max,+maxEl?.step||1);
 // the range in use when the card priority trims the user range
 const note=$('[data-seg-effective="'+key+'"]');
 if(note){const e=s.exclusive,trimmed=s.active&&e&&(e.empty||e.min!==(s.userMin??s.min)||e.max!==(s.userMax??s.max)),srcs=s.active&&e&&!e.empty?(e.sources||[]):[];note.classList.toggle('is-hidden',!trimmed&&!srcs.length);
  // the segments above that hold voxels (post-processing / edits) are subtracted voxel by voxel, not by range
  const names=srcs.map(k=>tr(k)||k).join(', '),from=srcs.length?tr('segExcludesUpper')+' ('+names+')':'';
  if(trimmed||srcs.length){const f=v=>formatCtValue(v,st);note.textContent=(trimmed?(e.empty?tr('segEffectiveEmpty'):tr('segEffective')+' '+f(e.min)+' 〜 '+f(e.max)+(e.dropped?.length?' · '+tr('segEffectiveDropped')+' '+e.dropped.map(([a,b])=>f(a)+'〜'+f(b)).join(', '):'')):'')+(trimmed&&from?' · ':'')+from}}
 $('[data-seg-opacity-out="'+key+'"]').value=segmentState[key].opacity.toFixed(2);
 for(const [attr,field] of THIN_SLIDERS){const out=$('[data-seg-'+attr+'-out="'+key+'"]');if(out)out.value=formatMmVoxels(segmentState[key][field])}
}
// Thin-region sliders hold mm; the step is one in-plane source voxel and the
// output shows the voxel equivalent.
export const THIN_SLIDERS=[['surface-mm','surfaceMm',8],['thickness-mm','thicknessMm',8]];
export function thinVoxelMm(v=volume){const s=v?.spacing||[1,1,1];return Math.max(1e-6,Math.min(+s[0]||1,+s[1]||1))}
export function formatMmVoxels(mm){
 mm=+mm||0;if(mm<=0)return '0';
 const vox=thinVoxelMm(),digits=vox<.1?2:vox<1?1:0;
 return mm.toFixed(digits+(vox<.01?1:0))+' mm ≈ '+Math.round(mm/vox)+' vox';
}
export function configureThinSliders(key,v){
 const vox=thinVoxelMm(v),cfg=segmentState[key];
 for(const [attr,field,maxVox] of THIN_SLIDERS){
  const el=$('[data-seg-'+attr+'="'+key+'"]');if(!el)continue;
  el.min='0';el.step=String(vox);el.max=String(vox*maxVox);
  cfg[field]=Math.min(vox*maxVox,Math.max(0,+cfg[field]||0));el.value=String(cfg[field]);
 }
}
export function thinSliderValue(el){const vox=thinVoxelMm();return Math.round((+el.value||0)/vox)*vox}
export function scheduleSegment3D(){if(!volume)return;clearTimeout(segmentRenderTimer);incSourceRenderRevision(false);mark3DStale();if(threeRenderMode==='volume'&&sceneState?.medicalVolume?.active){request3DRender();threeLabel.textContent=(sceneState.backend||'3D')+' · GPU volume'}}
export function clearSegmentEditCache(key,clearEdits=false){
 const st=segmentEditState[key];if(!st)return;
 // a removed or reset segment must not leave its run surface in the scene
 if(clearEdits&&st.surfaceGroup){const old=st.surfaceGroup;if(old.parent)old.parent.remove(old);dispose(old);st.surfaceGroup=null;request3DRender()}st.baseRuns=null;st.baseSignature='';st.finalRuns=null;st.pendingBase=null;
 if(clearEdits){segmentEditGen[key]=(segmentEditGen[key]|0)+1;st.keepRuns=null;st.excludeRuns=null;st.cutRuns=null;st.rawCutSurface=false;st.undo=[];st.redo=[];st.revision=0}
}
export function clearAnalysisHighlight(){
 if(sceneState?.analysisMesh){const root=sceneState.analysisMesh;if(root.parent)root.parent.remove(root);dispose(root);sceneState.analysisMesh=null}
 setAnalysisRegions([]);setAnalysisFocusedRegionId(null);setNextAnalysisRegionId(1);setNextAnalysisColorIndex(0);request3DRender();renderAnalysisResults();
}
export const segmentControl=(attr,key)=>$('[data-seg-'+attr+'="'+key+'"]');
export function setControlValue(el,value){if(!el||value==null)return;el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}
export function setControlChecked(el,checked){if(!el||el.checked===!!checked)return;el.checked=!!checked;el.dispatchEvent(new Event('change',{bubbles:true}))}
