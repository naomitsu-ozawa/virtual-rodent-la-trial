// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { setAnalysisRegions, setAnalysisFocusedRegionId, setNextAnalysisRegionId, setNextAnalysisColorIndex, sceneState, analysisRegions, analysisFocusedRegionId, currentLanguage, volumeAnalysisBusy, volume, current3DVolume, activeSeries } from './state.js?v=20261112-build723';
import { analysisSummary, analysisRegionList, analysisMergeButton, analysisClearButton, planes } from './ui-shell.js?v=20261112-build723';
import { tr } from './i18n.js?v=20261112-build723';
import { REGION_NAME_MAX, normalizeRegionName, regionDisplayName } from './region-name.js?v=20261112-build723';
import { spacingWarningHtml } from './slice-spacing.js?v=20261112-build723';
import { analysisRegionById, updateAnalysisEditorControls } from './edit-tools.js?v=20261112-build723';
import { analysisColorCss, schedulePlaneRender } from './mpr-render.js?v=20261112-build723';
import { analysisRegionShown, analysisRegionSegmentsShown, hiddenShapeCount, showAllHiddenShapes, onChildSegLookChange } from './segments.js?v=20261112-build723';
import { buildShowToggles } from './region-toggles.js?v=20261112-build723';
import { request3DRender } from './scene3d.js?v=20261112-build723';
import { dispose } from './surface-mesh.js?v=20261112-build723';
import { setRegionLabel, setRegionLabelOffset, hasOffset, clampVoxel, onAnalysisLabelsChange, surfaceAnchor, voxelFromLocal3d } from './analysis-label.js?v=20261112-build723';
import { analysisRunsContain } from './run-length.js?v=20261112-build723';
import { setRegionVisible, onRegionVisibleChange, regionVisible, regionHidden, setRegionHidden, onRegionHiddenChange } from './region-visibility.js?v=20261112-build723';
export function analysisRegionRepresentativeVoxel(region){
 if(!region?.runsBySlice)return null;
 const nonEmpty=[];for(let z=0;z<region.runsBySlice.length;z++)if(region.runsBySlice[z]?.length)nonEmpty.push(z);
 if(!nonEmpty.length)return null;
 const z=nonEmpty[Math.floor(nonEmpty.length/2)],rec=region.runsBySlice[z],i=Math.floor((rec.length/3)/2)*3;
 return{x:Math.floor((rec[i+1]+rec[i+2])/2),y:rec[i],z};
}
// move=false keeps the slice positions
export function setAnalysisFocusedRegion(id,voxel=null,move=true){
 const region=analysisRegionById(id);setAnalysisFocusedRegionId(region?.id??null);
 for(const r of analysisRegions){
  r.focused=r.id===analysisFocusedRegionId;
  if(r.meshGroup)r.meshGroup.traverse(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(!m)continue;m.opacity=r.focused?.98:.46;m.emissiveIntensity=r.focused?.9:.28}});
 }
 if(region&&move){
  const v=voxel||analysisRegionRepresentativeVoxel(region);
  if(v&&volume){
   planes.axial.slider.value=Math.max(0,Math.min(+planes.axial.slider.max,v.z));
   planes.coronal.slider.value=Math.max(0,Math.min(+planes.coronal.slider.max,v.y));
   planes.sagittal.slider.value=Math.max(0,Math.min(+planes.sagittal.slider.max,v.x));
  }
 }
 for(const p of Object.keys(planes))schedulePlaneRender(p);
 request3DRender();renderAnalysisResults();
}
// pin the label of a result / remove it; the place is then moved by dragging it (3D view, VR).
// the anchor is on the result's SURFACE as the 3D camera sees it (the entry point of the ray from the eye to a voxel inside the result), not inside it: in VR a card inside bone is a ghost behind the tissue.
// Without a 3D camera / object (or when the ray finds nothing) it falls back to the representative voxel.
export function labelAnchorFor(region,vol=current3DVolume||volume){
 const v=analysisRegionRepresentativeVoxel(region);if(!v)return null;
 const inside={i:v.x,j:v.y,k:v.z},dims=vol?{columns:vol.columns,rows:vol.rows,slices:vol.slices}:null,obj=sceneState?.obj,cam=sceneState?.camera;
 let a=null;
 if(dims&&obj&&cam&&vol.spacing){
  try{
   obj.updateMatrixWorld(true);cam.updateMatrixWorld(true);
   const eyeWorld=cam.position.clone();if(cam.parent)eyeWorld.applyMatrix4(cam.parent.matrixWorld);
   const e=obj.worldToLocal(eyeWorld),eye=voxelFromLocal3d({x:e.x,y:e.y,z:e.z},dims,vol.spacing);
   a=surfaceAnchor({contains:(i,j,k)=>analysisRunsContain(region.runsBySlice,i,j,k),eye,target:inside});
  }catch{a=null}
 }
 return clampVoxel(a||inside,dims||{columns:1e9,rows:1e9,slices:1e9});
}
export function toggleAnalysisLabel(region){
 if(!region)return false;
 if(region.label){setRegionLabel(region,null);return true}
 const anchor=labelAnchorFor(region);if(!anchor)return false;
 return setRegionLabel(region,{anchor});
}
// the buttons follow a change made elsewhere (VR pins / unpins; a drag only matters when the label becomes moved / unmoved)
onAnalysisLabelsChange(e=>{if(!e?.labelOnly||e.moveToggled)renderAnalysisResults()});
// the one place that applies a region's shown flag in the browser (region-visibility.js: the analysis list, the segment tree and VR all set it through setRegionVisible): the mesh follows
// (analysisRegionShown: also its segments), the 3D and the 2D views redraw, the lists follow
onRegionVisibleChange(region=>{
 if(region.meshGroup)region.meshGroup.visible=analysisRegionShown(region);
 request3DRender();for(const p of Object.keys(planes))schedulePlaneRender(p);renderAnalysisResults();
});
onRegionHiddenChange(()=>{request3DRender();for(const p of Object.keys(planes))schedulePlaneRender(p);renderAnalysisResults()});
// 「隠れ N」 counts the child segments too (their shape flag is child.visible): a child shown / hidden / removed redraws the header only
onChildSegLookChange((c,changed)=>{if(changed.some(k=>k==='visible'||k==='removed'))syncHiddenSummary()});
// views that list the regions elsewhere (the segment cards' tree, segment-ui.js) redraw with the list
const renderHooks=[];
export function onAnalysisResultsRendered(fn){renderHooks.push(fn)}
export function analysisRegionName(region){
 return regionDisplayName(region,r=>r.merged?(tr('mergedRegion')+' '+r.id):(tr('analysisRegion')+' '+r.id));
}
function syncHiddenSummary(){
 const head=analysisSummary?.querySelector('.analysis-summary-head');if(!head)return;
 const n=hiddenShapeCount(),text=head.querySelector('.analysis-hidden-count'),btn=head.querySelector('.analysis-show-all');
 if(text)text.textContent=tr('hiddenShapeCount').replace('{n}',String(n));
 if(btn){btn.disabled=n===0;btn.title=tr('showAllHiddenHint')}
}
export function renderAnalysisResults(statusText=null){
 if(!analysisSummary||!analysisRegionList)return;
 analysisSummary.replaceChildren();
 if(statusText){
  analysisSummary.textContent=statusText;
 }else if(!analysisRegions.length){
  analysisSummary.textContent=tr('volumeHint');
 }else{
  const focused=analysisRegionById(analysisFocusedRegionId)||analysisRegions[analysisRegions.length-1];
  // the header: the count, then 「隠れ N」 (regions whose shape is hidden + child segments hidden) and 「すべて表示」 (puts back those shapes only; resting while N is 0)
  const count=document.createElement('div');count.className='analysis-summary-head';count.style.cssText='font-size:11px;color:rgb(var(--ui-t2))';
  const countText=document.createElement('span');countText.textContent=tr('analysisRegions')+': '+analysisRegions.length;
  const hiddenText=document.createElement('span');hiddenText.className='analysis-hidden-count';
  const showAll=document.createElement('button');showAll.type='button';showAll.className='analysis-region-button analysis-show-all';showAll.dataset.i18n='showAllHidden';showAll.textContent=tr('showAllHidden');showAll.onclick=()=>{showAllHiddenShapes()};
  count.append(countText,hiddenText,showAll);
  analysisSummary.appendChild(count);syncHiddenSummary();
  if(focused){
   const card=document.createElement('div');card.style.cssText='display:grid;gap:7px;padding:9px 10px;border:1px solid rgb(var(--ui-b3));border-radius:9px;background:rgb(var(--ui-s1));margin-bottom:8px';
   const title=document.createElement('strong');title.textContent=(currentLanguage==='ja'?'解析結果 · ':'Result · ')+analysisRegionName(focused);title.style.cssText='font-size:11px;color:rgb(var(--ui-t1))';
   const volumeRow=document.createElement('div');volumeRow.style.cssText='display:flex;align-items:baseline;justify-content:space-between;gap:10px';
   const volumeLabel=document.createElement('span');volumeLabel.textContent=currentLanguage==='ja'?'体積':'Volume';volumeLabel.style.cssText='font-size:10px;color:rgb(var(--ui-t4))';
   const volumeValue=document.createElement('strong');volumeValue.textContent=focused.mm3.toFixed(2)+' mm³';volumeValue.style.cssText='font-size:18px;line-height:1;color:rgb(var(--ui-t1));font-variant-numeric:tabular-nums;white-space:nowrap';
   volumeRow.append(volumeLabel,volumeValue);
   const meta=document.createElement('div');meta.textContent=focused.segmentKeys.map(k=>tr(k)||k).join(' + ')+' · '+focused.voxels.toLocaleString()+' voxels';meta.style.cssText='font-size:10px;line-height:1.35;color:rgb(var(--ui-t4));overflow-wrap:anywhere';
   card.append(title);
   {const nameRow=document.createElement('label');nameRow.className='analysis-region-name';
    const nameText=document.createElement('span');nameText.textContent=tr('regionNameLabel');
    const inp=document.createElement('input');inp.type='text';inp.maxLength=REGION_NAME_MAX;inp.value=focused.name||'';inp.placeholder=tr('regionNameLabel');inp.autocomplete='off';
    // the pinned 3D chip shows the name: redraw it now (the 3D view renders on demand)
    const commit=()=>{const nv=normalizeRegionName(inp.value);inp.value=nv;if(nv===(focused.name||''))return;if(nv)focused.name=nv;else delete focused.name;request3DRender();renderAnalysisResults()};
    inp.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();inp.blur()}});inp.addEventListener('keyup',e=>e.stopPropagation());
    inp.addEventListener('blur',commit);
    nameRow.append(nameText,inp);card.append(nameRow)}
   card.append(volumeRow,meta);
   // spacing used for the volume, plus the slice-spacing warning whenever one applies
   const v=current3DVolume||volume,sp=v?.spacing;
   if(sp){const used=document.createElement('div');used.textContent=(currentLanguage==='ja'?'ボクセル間隔 (x, y, z): ':'Voxel spacing (x, y, z): ')+sp.map(n=>(+n).toFixed(4).replace(/0+$/,'').replace(/\.$/,'')).join(' × ')+' mm';used.className='analysis-spacing-used';used.style.cssText='font-size:10px;line-height:1.35;color:rgb(var(--ui-t4));overflow-wrap:anywhere';card.append(used)}
   const warnHtml=spacingWarningHtml((v?.series||activeSeries)?.spacingCheck,currentLanguage,s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
   if(warnHtml)card.insertAdjacentHTML('beforeend',warnHtml);
   // the label of this result on the 3D view (and in VR): pinned here or in VR, moved by a drag, put back here or by a double click / tap
   {const actions=document.createElement('div');actions.className='analysis-label-actions';
    const pin=document.createElement('button');pin.type='button';pin.className='analysis-label-pin';pin.textContent=tr(focused.label?'analysisLabelUnpin':'analysisLabelPin');pin.onclick=()=>toggleAnalysisLabel(focused);actions.append(pin);
    if(focused.label&&hasOffset(focused.label)){const rs=document.createElement('button');rs.type='button';rs.className='analysis-label-reset';rs.textContent=tr('analysisLabelReset');rs.onclick=()=>setRegionLabelOffset(focused,null);actions.append(rs)}
    card.append(actions);
    if(focused.label){const hint=document.createElement('div');hint.className='analysis-label-hint';hint.textContent=tr('analysisLabelHint');card.append(hint)}}
   analysisSummary.appendChild(card);
  }
 }
 analysisMergeButton.disabled=analysisRegions.filter(r=>r.selected).length<2||volumeAnalysisBusy;
 analysisClearButton.disabled=!analysisRegions.length||volumeAnalysisBusy;updateAnalysisEditorControls();
 analysisRegionList.replaceChildren();
 for(const region of analysisRegions){
  const row=document.createElement('div');row.className='analysis-region-row'+(region.id===analysisFocusedRegionId?' is-focused':'');row.dataset.regionId=String(region.id);row.onclick=e=>{if(e.target.closest('button,input'))return;setAnalysisFocusedRegion(region.id)};
  const select=document.createElement('input');select.type='checkbox';select.checked=!!region.selected;select.className='analysis-region-select';select.title=tr('mergeSelected');select.onchange=()=>{region.selected=select.checked;renderAnalysisResults()};
  const swatch=document.createElement('span');swatch.className='analysis-region-swatch';swatch.style.background=analysisColorCss(region.color);swatch.title=analysisColorCss(region.color);
  const info=document.createElement('div');info.className='analysis-region-info';
  const title=document.createElement('strong');title.textContent=analysisRegionName(region);
  const keys=document.createElement('span');keys.textContent=region.segmentKeys.map(k=>tr(k)||k).join(' + ');
  const value=document.createElement('span');value.textContent=region.mm3.toFixed(2)+' mm³ · '+region.voxels.toLocaleString()+' voxels';value.style.cssText='white-space:normal;overflow:visible;text-overflow:clip';
  info.append(title,keys,value);
  // 色 (the colour only: region.visible) and 表示 (the whole shape: region.hidden), two toggles with fixed wording (region-toggles.js). Its segments all unticked: the region is hidden with them, so both rest (greyed, says why) until a segment is ticked
  const toggles=buildShowToggles({colorOn:regionVisible(region),shapeOn:!regionHidden(region),canToggle:analysisRegionSegmentsShown(region)},{color:{attr:['regionVisible',String(region.id)],onClick:()=>setRegionVisible(region,!regionVisible(region))},shape:{attr:['regionHidden',String(region.id)],onClick:()=>setRegionHidden(region,!regionHidden(region))}});
  const remove=document.createElement('button');remove.type='button';remove.className='analysis-region-button analysis-region-delete';remove.textContent=tr('deleteRegion');remove.onclick=()=>removeAnalysisRegion(region.id);
  row.append(select,swatch,info,toggles,remove);analysisRegionList.append(row);
 }
 for(const fn of renderHooks){try{fn()}catch(e){console.warn('[analysis-results] hook',e)}}
}
export function disposeAnalysisRegionMesh(region){
 if(!region?.meshGroup)return;if(region.meshGroup.parent)region.meshGroup.parent.remove(region.meshGroup);dispose(region.meshGroup);region.meshGroup=null;
}
export function removeAnalysisRegion(id){
 const idx=analysisRegions.findIndex(r=>r.id===id);if(idx<0)return;
 disposeAnalysisRegionMesh(analysisRegions[idx]);analysisRegions.splice(idx,1);
 if(analysisFocusedRegionId===id)setAnalysisFocusedRegionId(null);
 if(!analysisRegions.length&&sceneState?.analysisMesh){if(sceneState.analysisMesh.parent)sceneState.analysisMesh.parent.remove(sceneState.analysisMesh);sceneState.analysisMesh=null}
 request3DRender();renderAnalysisResults();for(const p of Object.keys(planes))schedulePlaneRender(p);
}
export function keepAnalysisRegionsAfterRebuild(){
 for(const region of analysisRegions)region.meshGroup=null;
 if(sceneState)sceneState.analysisMesh=null;renderAnalysisResults();request3DRender();
}
export function resetAnalysisRegistryAfterRebuild(){
 setAnalysisRegions([]);setAnalysisFocusedRegionId(null);setNextAnalysisRegionId(1);setNextAnalysisColorIndex(0);if(sceneState)sceneState.analysisMesh=null;renderAnalysisResults();
}
