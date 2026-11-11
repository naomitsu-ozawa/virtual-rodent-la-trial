// Position comments on the 3D view: a numbered dot per comment of the open series, drawn as small HTML elements in a layer
// over the 3D viewport, NOT inside the WebGPU / WebGL scene. One code path serves every 3D mode (GPU volume, surface mesh, WebGL
// fallback) because they all share the same scene object and camera; the dots cost no GPU work and stay crisp at any DPR.
// Position: the voxel {i,j,k} -> the scene's local coordinates with voxelToLocal3D (the mapping of the 3D MPR planes), then the
// object's world matrix and the camera, so rotation / zoom / pan follow by themselves. Updated after every 3D frame (the 3D loop only
// renders on request, so a change of the comments, the switch or the series asks for a render).
// Look: an EXPOSED point is a solid dot with a white rim; a point HIDDEN
// behind tissue is a smaller dot in the VR hidden colour (never removed: a lesion inside dense tissue must stay findable); the number is a
// small chip beside the dot. The hidden rule is VR's vr-point.js pointIsHidden over
// the classification bytes of the shown segments (vr-view.js hiddenClsFor, built lazily, in the background), eye = the camera, the section
// view's cut plane included; refreshed at most about 10 times a second while the view moves and once more when it stops
// (comment-3d-hidden.js). Until the bytes are ready, or when no segment is shown / no source data is in memory, every point is exposed.
import * as THREE from './vendor/three@0.186.0/build/three.webgpu.js';
import { sceneState, volume, activeSeries, volumeAnalysisMode, analysisEditTool, sectionViewOpen, sectionViewPlane, analysisRegions, threeRenderMode } from './state.js?v=20261111-build715';
import { tr } from './i18n.js?v=20261111-build715';
import { datasetFingerprint } from './project-file.js?v=20261111-build715';
import { voxelToLocal3D } from './crosshair.js?v=20261111-build715';
import { pointColor, darkFill, inkOn } from './point-colors.js?v=20261111-build715';
import { getComments, onCommentsChange, commentMatchesSeries, commentTarget, getMarkersShown, onMarkersShownChange } from './comments.js?v=20261111-build715';
import { getMeasurements, setLabelOffset, onMeasurementsChange, measurementMm, measureLabel, seriesSpacing, spacingLevel, getMeasureStart, onMeasureStartChange, createLongPress } from './measurements.js?v=20261111-build715';
import { openPointMenu, endMeasureAt, cancelMeasureUi } from './point-menu.js?v=20261111-build715';
import { request3DRender } from './scene3d.js?v=20261111-build715';
import { gpuVolumeTarget } from './gpu-volume-data.js?v=20261111-build715';
import { analysisRegionShown, segmentState, segmentEditState, SEGMENT_PRESET_ORDER, gpuSegmentOrder, segmentById } from './segments.js?v=20261111-build715';
import { sectionLocalPoint, sectionLocalNormal } from './section-view.js?v=20261111-build715';
import { planeLabelPlacement, clampLabelCenter, stepDelta, createFocusTracker, LINE_SAMPLES, probeKey, labelPart, lineSamplePoints, lineAlphas, lineStopOffsets, createIdMaker } from './measure-label.js?v=20261111-build715';
import { planeRelations, boxHalfExtent, clipSegmentNear } from './comment-3d-section.js?v=20261111-build715';
import { computeHiddenIds, shownChannels, sectionPlaneLocal, createHiddenThrottle } from './comment-3d-hidden.js?v=20261111-build715';
import { regionCustomName, regionChipTitle } from './region-name.js?v=20261111-build715'; // the shared region name rule (name, else ID <atlas id>), as the VR cards
import { judgeLabelPlace, tissueAt, PUSH_DIRS, LABEL_PUSH_MAX, LABEL_PUSH_MARGIN_VOX, labelDisplay, thinOverlaps, putAttr, putStyle } from './comment-3d-label-occlusion.js?v=20261111-build715'; // occlusion of the analysis labels (behind = hidden, embedded = translucent, pushed out, overlaps thinned)
import { childLabelItems, childLabelItemById, labelChipTitle, labelVolumeText } from './child-labels.js?v=20261111-build715'; // a child segment's name label is drawn / dragged by the code of the analysis labels (it has the shape of a region)
import { onChildSegChange } from './child-segments.js?v=20261111-build715';
import { setRegionLabelOffset, onAnalysisLabelsChange, leaderVisible, labelLocal, offsetForLocal, rectEdgePoint, pcVoxelStep, createBoneGlow, boneHoverPickable, glowPairOf, pcLeaderLimit, pcLengthFactor, pcDrawnLength, pcDragUncap, pushWithinLimit, PC_REF_DISTANCE } from './analysis-label.js?v=20261111-build715';
import { analysisRunsContain } from './run-length.js?v=20261111-build715';


// analysis result labels (analysis-label.js, region.label): a chip (colour, number, segments, volume) at its anchor, MOVABLE by a drag (mouse / pen / touch) in the camera-facing plane through the label's
// depth; a moved label keeps a leader line to its anchor and is judged hidden-behind-tissue like a dragged distance label (the same pass). Stored in voxel units: the same place in VR and on the PC, saved in the project.
let host=null,layer=null,bubble=null,bubbleId=null,bubbleTimer=0;
let rels=new Map(),relSig='',svg=null,cuesOn=false;
let hiddenIds=new Set(),hiddenSig='',hiddenTimer=0,vrMod=null,vrModLoading=false,vrModFailed=false;
const throttle=createHiddenThrottle();
let lastPrep=null,placeCtx='',clsSeq=0;const places=new Map(),clsIds=new WeakMap(); // the classification bytes of the last judgement; per analysis label its places (updateLabelPlaces)
const els=new Map(); // comment id -> {el,x,y,vis,no}
const v3=new THREE.Vector3(),c3=new THREE.Vector3(),eye3=new THREE.Vector3(),p3=new THREE.Vector3(),q3=new THREE.Vector3();

export function closeBubble3d(){clearTimeout(bubbleTimer);bubbleId=null;if(bubble)bubble.hidden=true}
function placeBubble(){
 if(!bubble||bubbleId==null)return;
 const m=els.get(bubbleId),c=getComments().find(x=>x.id===bubbleId);
 if(!m||!m.vis||!c){closeBubble3d();return}
 const n=getComments().findIndex(x=>x.id===bubbleId)+1;
 bubble.querySelector('.comment-bubble-no').textContent=n;bubble.querySelector('.comment-bubble-text').textContent=c.text||'—';
 const W=host.clientWidth,bw=Math.min(260,W-16);bubble.style.maxWidth=bw+'px';
 bubble.style.left=Math.max(8,Math.min(W-bw-8,m.x-bw/2))+'px';bubble.style.top=Math.max(8,m.y+20)+'px';
}
function showBubble3d(id){
 if(!bubble){bubble=document.createElement('div');bubble.className='comment-bubble comment-bubble-3d';bubble.setAttribute('role','status');bubble.innerHTML='<b class="comment-bubble-no"></b><span class="comment-bubble-text"></span>';host.appendChild(bubble)}
 bubbleId=id;bubble.hidden=false;placeBubble();
 clearTimeout(bubbleTimer);bubbleTimer=setTimeout(closeBubble3d,7000);
}


// what the hidden judgement depends on, as a string: the series and its filter, the view (object + camera matrices), the points, the shown
// segments and their edits, the section plane. A change of it makes the judgement due (throttled); the same string = nothing to do.
function hiddenSignature(obj,camera,ids,plane,fp){
 const segs=SEGMENT_PRESET_ORDER.map(k=>{const g=segmentState[k]||{};return(g.active?1:0)+''+(g.enabled?1:0)+','+g.min+','+g.max+','+(segmentEditState[k]?.revision|0)}).join(';');
 return fp+'|'+gpuSegmentOrder().join('>')+'|'+(gpuVolumeTarget()?.filterSignature||'')+'|'+obj.matrixWorld.elements.join(',')+'|'+camera.matrixWorld.elements.join(',')+'|'+ids.join(',')+'|'+segs+'|'+(plane?[plane.x,plane.y,plane.z,plane.w].join(','):'');
}
const refreshSoon=()=>request3DRender();
// frees the classification bytes (series change, markers hidden): the next judgement builds them again
function releaseHidden(){lastPrep=null;placeCtx='';places.clear();clearTimeout(capTimer);capTimer=0;clearTimeout(hiddenTimer);hiddenTimer=0;hiddenIds=new Set();hiddenSig='';throttle.reset();vrMod?.releaseHiddenCls?.()}
// the throttled judgement: returns true when the hidden set changed
function refreshHidden(obj,camera,pts,plane){
 const anyShown=SEGMENT_PRESET_ORDER.some(k=>segmentState[k]?.active&&segmentState[k]?.enabled);
 if(!anyShown||!pts.length){const had=hiddenIds.size>0;hiddenIds=new Set();if(lastPrep){lastPrep=null;refreshSoon()}return had}
 if(vrModFailed)return false; // the builder could not be loaded: every point stays exposed
 if(!vrMod){ // the classification builder lives in vr-view.js: loaded once, on the first need; until then the previous judgement stays
  if(!vrModLoading){vrModLoading=true;import('./vr-view.js?v=20261111-build715').then(m=>{vrMod=m;throttle.reset();refreshSoon()},()=>{vrModFailed=true;if(hiddenIds.size){hiddenIds=new Set();refreshSoon()}})}
  return false;
 }
 const prep=vrMod.hiddenClsFor(()=>{throttle.reset();refreshSoon()});
 if(!prep)return false; // still being built: keep the previous judgement
 if(lastPrep?.cls!==prep.cls){lastPrep=prep;refreshSoon()} // the embedded / push-out judgement of the analysis labels uses the same bytes (updateLabelPlaces)
 const chs=shownChannels(prep?.cls,segmentState,gpuSegmentOrder());
 eye3.setFromMatrixPosition(camera.matrixWorld);obj.worldToLocal(eye3);
 const eye={x:eye3.x,y:eye3.y,z:eye3.z};
 const next=computeHiddenIds(pts,eye,prep,{chs,plane});
 const changed=next.size!==hiddenIds.size||[...next].some(id=>!hiddenIds.has(id));
 hiddenIds=next;return changed;
}

// the cues of the active section: bigger dots on it, lines from the other points to their foot on it
function ensureSvg(){
 if(svg)return svg;
 svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','comment-lines-3d');svg.setAttribute('aria-hidden','true');
 layer.insertBefore(svg,layer.firstChild); // under the dots
 return svg;
}
function projectPair(obj,camera,W,H,a,b,out){
 // both ends to camera space, clipped to the front of the camera, then projected: out = [x1,y1,x2,y2] in px, or false when nothing is in front
 p3.set(a.x,a.y,a.z).applyMatrix4(obj.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
 q3.set(b.x,b.y,b.z).applyMatrix4(obj.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
 pairDepth[0]=-p3.z;pairDepth[1]=-q3.z; // the depths of the unclipped ends (the gradient of a measure line places its stops with them)
 const seg=clipSegmentNear({x:p3.x,y:p3.y,z:p3.z},{x:q3.x,y:q3.y,z:q3.z},camera.near||0.01);if(!seg)return false;
 p3.set(seg[0].x,seg[0].y,seg[0].z).applyMatrix4(camera.projectionMatrix);q3.set(seg[1].x,seg[1].y,seg[1].z).applyMatrix4(camera.projectionMatrix);
 out[0]=(p3.x+1)/2*W;out[1]=(1-p3.y)/2*H;out[2]=(q3.x+1)/2*W;out[3]=(1-q3.y)/2*H;
 return out.every(Number.isFinite);
}
const seg4=[0,0,0,0],pairDepth=[0,0],nextGradId=createIdMaker('mg3d-');
// distances. A line between the two points (the SVG layer, clipped at the near plane) and the value at its midpoint (a small label); the start of a
// distance in the making gets a pulsing ring (.is-measure-start) and a hint next to it. Follows the points live (they are recomputed every frame).
const measEls=new Map(); // measurement id -> {line,label,text}
// the lit label (mouse hover / a drag, touch included): the class is toggled only when the lit label changes
// keys 'M:<measurement id>' / 'A:<region id>' (distance labels and analysis labels share the tracker)
const alEls=new Map(); // region id -> {label,leader,dot,...}
const litEntry=key=>key==null?null:key.startsWith('A:')?alEls.get(+key.slice(2)):measEls.get(key.slice(2));
// a card is lit by the label hover / drag (labelFocus) OR by the mouse resting on its bone (boneGlow, below): litKey = either
const isLitKey=key=>key!=null&&(labelFocus.get()===key||(!!boneGlow.get()&&'A:'+boneGlow.get()===key)||(!!childBoneGlow.get()&&'A:'+childBoneGlow.get()===key)); // OVERLAP: a result and a child under the mouse both light (two trackers: results / child segments)
const setLitClass=key=>{const e=litEntry(key);if(e){const on=isLitKey(key);e.label.classList.toggle('is-lit',on);e.leader.classList.toggle('is-lit',on);e.dot?.classList.toggle('is-lit',on)}};
const labelFocus=createFocusTracker((n,p)=>{setLitClass(p);setLitClass(n);syncHoverFocus();refreshSoon()});
const litChange=(n,p)=>{if(p)setLitClass('A:'+p);if(n)setLitClass('A:'+n);refreshSoon()};
const boneGlow=createBoneGlow(litChange),childBoneGlow=createBoneGlow(litChange); // only when the glowing result changes (no volume focus: the bone itself is not touched) // a lit card always stays: the overlap thinning is redone
// the result under the mouse (its label is lit) gets the volume's temporary focus (webgl-volume.js setHoverFocus: only the look-up table's focus bit, the page's selection stays). Synced when the lit label changes and after every redraw,
// so it is released when the mouse leaves, the label disappears (hidden result, label removed), or the 3D view is closed (no entry left).
let hoverFocusRuns=null,hoverFocusChild='';
function syncHoverFocus(){
 const k=labelFocus.get(),r=k&&k.startsWith('A:')&&alEls.has(+k.slice(2))?regionOf(+k.slice(2)):null,on=!!r&&shownRegion(r)&&!!r.label,runs=on&&!r.child?r.runsBySlice:null,ck=on&&r.child?r.key:'',mv=sceneState?.medicalVolume; // a child segment's card lights ITS body the same way (setHoverChildFocus: its row of the child table, a result is not touched)
 if(!(runs===hoverFocusRuns&&(runs||!mv?.hoverRuns))){hoverFocusRuns=runs;try{mv?.setHoverFocus?.(runs)}catch(e){console.warn(e)}}
 if(!(ck===hoverFocusChild&&(ck||!mv?.hoverChild))){hoverFocusChild=ck;try{mv?.setHoverChildFocus?.(ck)}catch(e){console.warn(e)}}
}
let hintEl=null;
// object-space change per voxel along i / j / k in this view (voxelToLocal3D: the longest side is 3.3 units)
function voxelStep3d(dims,spacing){const[sx,sy,sz]=spacing||[1,1,1],k=3.3/Math.max(dims.columns*sx,dims.rows*sy,dims.slices*sz,1);return[sx*k,-sy*k,sz*k]}
function drawMeasures(obj,camera,W,H,pts,keep,dims){
 const byId=new Map(pts.map(p=>[p.id,p])),ms=getMeasurements().filter(m=>byId.has(m.a)&&byId.has(m.b));
 if(!ms.length)return;
 ensureSvg();svg.setAttribute('width',W);svg.setAttribute('height',H);
 const cs=getComments(),sp=seriesSpacing(activeSeries),warn=spacingLevel(activeSeries)==='warn',step=voxelStep3d(dims,volume.spacing);
 for(const m of ms){
  keep.add(m.id);let e=measEls.get(m.id);
  if(!e){
   const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('class','measure-line-3d');svg.appendChild(line);
   const leader=document.createElementNS('http://www.w3.org/2000/svg','line');leader.setAttribute('class','measure-leader-3d');svg.appendChild(leader);
   const label=document.createElement('div');label.className='measure-label-3d';layer.appendChild(label);
   if(labelFocus.get()==='M:'+m.id){label.classList.add('is-lit');leader.classList.add('is-lit')}e={line,leader,label,text:'',w:60,h:16,sx:0,sy:0,ctx:null,lh:false,lsig:'',grad:null};measEls.set(m.id,e);
  }
  const text=measureLabel(measurementMm(m,cs,sp),warn);if(e.text!==text){e.text=text;e.label.textContent=text;if(warn)e.label.title=tr('measureWarn');e.label.hidden=false;e.w=e.label.offsetWidth||60;e.h=e.label.offsetHeight||16}
  const A=byId.get(m.a),B=byId.get(m.b);
  if(projectPair(obj,camera,W,H,A.local,B.local,seg4)){
   e.line.setAttribute('x1',seg4[0].toFixed(1));e.line.setAttribute('y1',seg4[1].toFixed(1));e.line.setAttribute('x2',seg4[2].toFixed(1));e.line.setAttribute('y2',seg4[3].toFixed(1));e.line.style.display='';
   const mx=(seg4[0]+seg4[2])/2,my=(seg4[1]+seg4[3])/2;
   // the midpoint in object space (voxel units: the mean of the two voxels) and its depth: what a drag of the label works from
   const ml=voxelToLocal3D({i:(A.vox.i+B.vox.i)/2,j:(A.vox.j+B.vox.j)/2,k:(A.vox.k+B.vox.k)/2},dims,volume.spacing);
   v3.set(ml.x,ml.y,ml.z).applyMatrix4(obj.matrixWorld).project(camera);e.ctx={ml,step,ndcZ:v3.z};
   let lx,ly;
   if(m.labelOffset){ // where the user left it
    const d=stepDelta(m.labelOffset,step);v3.set(ml.x+d.x,ml.y+d.y,ml.z+d.z).applyMatrix4(obj.matrixWorld).project(camera);
    const c=clampLabelCenter((v3.x+1)/2*W,(1-v3.y)/2*H,{w:e.w,h:e.h,x0:0,y0:0,iw:W,ih:H}); // shown inside the view (the stored offset is unchanged: it can never be lost off-screen)
    lx=c.x;ly=c.y;
   }else{ // by default NEAR the line: beside it (perpendicular, the upper side), inside the view
    const pl=planeLabelPlacement({x:seg4[0],y:seg4[1]},{x:seg4[2],y:seg4[3]},{w:e.w,h:e.h,gap:4,x0:0,y0:0,iw:W,ih:H});lx=pl.x;ly=pl.y;
   }
   depthCue(e,m,seg4,camera);
   if(Number.isFinite(lx)&&Number.isFinite(ly)){
    e.sx=lx;e.sy=ly;e.label.hidden=false;
    e.label.style.transform='translate('+lx.toFixed(1)+'px,'+ly.toFixed(1)+'px) translate(-50%,-50%)';
    e.leader.setAttribute('x1',mx.toFixed(1));e.leader.setAttribute('y1',my.toFixed(1));e.leader.setAttribute('x2',lx.toFixed(1));e.leader.setAttribute('y2',ly.toFixed(1));e.leader.style.display='';
   }else{e.leader.style.display='none';e.label.hidden=true}
  }else{e.line.style.display='none';e.leader.style.display='none';e.label.hidden=true}
 }
}
// ---- analysis result labels ----
const shownRegion=r=>(r.child?!!segmentById(r.key)?.enabled:analysisRegionShown(r))&&!!r.runsBySlice&&r.voxels>0; // a child's label is shown while the child is (its own flag and its parent's: segments.js segmentById)
const regionCss=c=>'#'+((Number(c)>>>0)&0xffffff).toString(16).padStart(6,'0');
function analysisLabelRegions(){const out=analysisRegions.filter(r=>r.label&&shownRegion(r));for(const it of childLabelItems())if(shownRegion(it))out.push(it);return out} // + the child segments' name labels (negative ids)
// where each analysis label's card is drawn, in object space (places: region id -> pl). Two judgements of "embedded" (the card's place lies inside the tissue shown now) and of
// the push out of the tissue, and one length limit:
//  (1) the place of the initial display, pl.v0 = anchor -> the anchor + the stored label.offset, or where that card is pushed out of the tissue (judgeLabelPlace). As:
//      redone per label only when its anchor / offset change, and for all labels when the shown segments, the classification bytes, the section plane or the volume change. Never
//      with the camera. The label's limit T (px) is the line this place draws at the initial display (pcLeaderLimit: the camera PC_REF_DISTANCE in front, not panned, scale 1, the
//      turn and the view's height as they are now; the window's width is not read).
//  (2) every frame: k = pcLengthFactor (one formula per label) puts the card's edge at most T beyond the anchor. k = 1 (zoomed out / as at the start / the anchor under the card): the card is at the place of (1), the place computes (708 then held it inside the view; that hold is gone, drawAnalysisLabels).
//      A line under the card (the anchor is under its own card) is cut at T when it is drawn (drawAnalysisLabels), so no drawn line is longer than T.
//  (3) k < 1 (enlarged / panned past the limit): the card is at anchor + k * v0. That place can lie in the tissue, so it is judged again, but ONLY WHEN THE VIEW HAS STOPPED
//      (LABEL_SETTLE_MS without a camera / object / view size change; a timer asks for one more frame, only when a limited card waits for its judgement), never while it moves. An embedded card is pushed out only to a free place whose
//      line is within T (analysis-label.js pushWithinLimit: the march of pushOutOfTissue plus that condition); when there is none it stays at the limited place, translucent. While the view moves, the pushed place of the last judgement is kept
//      and goes through pcLengthFactor too, so no frame draws a line longer than T (its translucent / hidden look can be one stop late).
// capViews sets the two camera-space matrices of the object once per frame (and before a drag step): now (capMv) and at the initial display (capMr).
const LABEL_SETTLE_MS=150;
const capMv=new THREE.Matrix4(),capMr=new THREE.Matrix4(),capV=new THREE.Vector3(),capLast=new Float64Array(18);let capFx=0,capFy=0,capSeq=0,capAt=0,capTimer=0;
function capViews(obj,camera,W,H,now=-1){
 capMv.multiplyMatrices(camera.matrixWorldInverse,obj.matrixWorld);capMr.extractRotation(capMv);capMr.setPosition(0,0,-PC_REF_DISTANCE);const pe=camera.projectionMatrix.elements;capFx=W/2*pe[0];capFy=H/2*pe[5];
 if(now<0)return; // a drag step: the matrices only
 const m=capMv.elements;let moved=capLast[16]!==capFx||capLast[17]!==capFy;for(let i=0;i<16&&!moved;i++)moved=capLast[i]!==m[i];
 if(moved){capLast.set(m);capLast[16]=capFx;capLast[17]=capFy;capSeq++;capAt=now} // the view moved: the judgement (3) waits until it has stood still for LABEL_SETTLE_MS
}
const camPt=(m,p)=>{capV.set(p.x,p.y,p.z).applyMatrix4(m);return{x:capV.x,y:capV.y,z:capV.z}};
function camPair(m,al,dl){const a=camPt(m,al),c=camPt(m,{x:al.x+dl.x,y:al.y+dl.y,z:al.z+dl.z});return[a,{x:c.x-a.x,y:c.y-a.y,z:c.z-a.z}]} // the anchor and the displacement dl (object space) in camera space
// a drag under the limit: P = the pointer's point at the depth of the card as drawn (object space). -> the place to store (object space) whose limited card is drawn at the pointer
// (analysis-label.js pcDragUncap). The card keeps its depth whenever an offset exists for it; a card deeper than its anchor that is dragged further than such an offset can draw
// is brought nearer the anchor's depth along the pointer's line of sight, just as far as needed (the place on the screen is the pointer's either way; the stored offset is then less deep).
const capEye=new THREE.Vector3();
function labelDragPlace(al,P,w,h,obj,camera){
 if(!(capFx>0&&capFy>0))return P;
 capEye.setFromMatrixPosition(camera.matrixWorld);obj.worldToLocal(capEye);
 const za=-camPt(capMv,al).z,zp=-camPt(capMv,P).z,lamA=zp>1e-9&&za>0?za/zp:1,ex=capEye.x,ey=capEye.y,ez=capEye.z; // the point of the pointer's line of sight at the anchor's depth: the eye + lamA * (P - the eye)
 const view=t=>{const lam=lamA+(1-lamA)*t,ul={x:ex+lam*(P.x-ex)-al.x,y:ey+lam*(P.y-ey)-al.y,z:ez+lam*(P.z-ez)-al.z},[a,u]=camPair(capMv,al,ul),[ar,ur]=camPair(capMr,al,ul);return{a,u,ar,ur,ul}};
 const r=pcDragUncap(view,capFx,capFy,{hw:w/2,hh:h/2}),ul=view(r.t).ul;
 return{x:al.x+ul.x*r.s,y:al.y+ul.y*r.s,z:al.z+ul.z*r.s};
}
function updateLabelPlaces(regs,dims,plane,now){
 const prep=lastPrep,chs=prep?.cls?shownChannels(prep.cls,segmentState,gpuSegmentOrder()):[];
 let cid=0;if(prep?.cls){cid=clsIds.get(prep.cls);if(!cid){cid=++clsSeq;clsIds.set(prep.cls,cid)}}
 const ctx=cid+'|'+chs.join()+'|'+(plane?[plane.x,plane.y,plane.z,plane.w].join(','):'')+'|'+dims.columns+','+dims.rows+','+dims.slices+'|'+(volume.spacing||[1,1,1]).join(',');
 if(ctx!==placeCtx){placeCtx=ctx;places.clear()}
 const step0=pcVoxelStep(dims,volume.spacing),can=!!prep?.cls&&chs.length>0,live=new Set(),settled=now-capAt>=LABEL_SETTLE_MS,capOk=capFx>0&&capFy>0;let waiting=false;
 for(const r of regs){
  live.add(r.id);const lab=r.label,o=lab.offset,key=lab.anchor.i+','+lab.anchor.j+','+lab.anchor.k+'|'+(o?o.i+','+o.j+','+o.k:'');
  let pl=places.get(r.id);
  if(pl?.key!==key){ // (1) the place of the initial display
   const al=voxelToLocal3D(lab.anchor,dims,volume.spacing),base=labelLocal(al,o,step0),j=can?judgeLabelPlace(base,prep,chs,plane):{embedded:false,push:null},p0=j.push||base,v0={x:p0.x-al.x,y:p0.y-al.y,z:p0.z-al.z};
   pl={key,al,p0,v0,moved:Math.hypot(v0.x,v0.y,v0.z)>1e-12,emb0:j.embedded,push0:!!j.push,j1:null,place:p0,embedded:j.embedded,pushed:!!j.push,T:Infinity};places.set(r.id,pl);
  }
  if(!pl.moved||!capOk){pl.place=pl.p0;pl.embedded=pl.emb0;pl.pushed=pl.push0;pl.j1=null;pl.T=Infinity;continue} // the default place at the anchor: nothing to limit
  const al=pl.al,ce=alEls.get(r.id),hw=(ce?.w||90)/2,hh=(ce?.h||16)/2,[a,d]=camPair(capMv,al,pl.v0),[ar,dr]=camPair(capMr,al,pl.v0),T=pcLeaderLimit(ar,dr,capFx,capFy,{hw,hh}),k=pcLengthFactor(a,d,T,capFx,capFy,hw,hh); // (2)
  pl.T=T;
  if(k>=1){pl.place=pl.p0;pl.embedded=pl.emb0;pl.pushed=pl.push0;pl.j1=null;continue}
  const base={x:al.x+pl.v0.x*k,y:al.y+pl.v0.y*k,z:al.z+pl.v0.z*k};
  const fresh=pl.j1&&pl.j1.seq===capSeq&&pl.j1.hw===hw&&pl.j1.hh===hh; // judged in this very view, with the card's size as drawn
  if(can&&settled&&!fresh){ // (3) the view stands still: is the limited place in the tissue, and is there a free place within the limit?
   let v=null,emb=false;
   if(tissueAt(base,prep,chs,plane)){emb=true;const vm=Math.min(2*prep.halfExt[0]/prep.dims[0],2*prep.halfExt[1]/prep.dims[1],2*prep.halfExt[2]/prep.dims[2]); // the smallest classification voxel edge, the march's unit (as pushOutOfTissue)
    const q=pushWithinLimit(base,pt=>tissueAt(pt,prep,chs,plane),PUSH_DIRS,{step:vm/2,margin:LABEL_PUSH_MARGIN_VOX*vm,maxDist:LABEL_PUSH_MAX,accept:pt=>{const c=camPt(capMv,pt);return pcDrawnLength(a,{x:c.x-a.x,y:c.y-a.y,z:c.z-a.z},1,capFx,capFy,hw,hh,T)<=T+1e-6}});if(q)v={x:q.point.x-al.x,y:q.point.y-al.y,z:q.point.z-al.z}}
   pl.j1={seq:capSeq,hw,hh,v,embedded:emb};
  }else if(can&&!fresh)waiting=true;
  if(pl.j1?.v){const v=pl.j1.v,[,dv]=camPair(capMv,al,v),kv=pcLengthFactor(a,dv,T,capFx,capFy,hw,hh);pl.place={x:al.x+v.x*kv,y:al.y+v.y*kv,z:al.z+v.z*kv};pl.embedded=true;pl.pushed=true} // a pushed place, limited again in this frame's view
  else{pl.place=base;pl.embedded=!!pl.j1?.embedded;pl.pushed=pl.j1?false:pl.push0} // the limited place itself: translucent when the last judgement found it in the tissue with no free place within the limit; never judged while limited (the view is moving) = drawn as a card in the open until the view stops
 }
 clearTimeout(capTimer);capTimer=waiting?setTimeout(refreshSoon,Math.max(0,LABEL_SETTLE_MS-(now-capAt))+20):0; // one more frame once the view has stopped, for the judgement (3)
 for(const id of [...places.keys()])if(!live.has(id))places.delete(id);
}
// the places of ALL shown labels' cards (object space), judged hidden-behind-tissue with the points; an embedded card that could not be pushed out is not judged (it is drawn translucent)
function analysisProbes(regs){
 const out=[];
 for(const r of regs){const pl=places.get(r.id);if(!pl||(pl.embedded&&!pl.pushed))continue;out.push({id:'A|'+r.id,local:pl.place})}
 return out;
}
// DOM writes only when the value changed (a frame in which nothing moved writes nothing: the camera / the labels / the display are unchanged); the last written value sits on the element
function putHidden(el,v){if(el.hidden!==v)el.hidden=v}
function drawAnalysisLabels(obj,camera,W,H,regs,keep,dims){
 if(!regs.length)return;
 ensureSvg();putAttr(svg,'width',W);putAttr(svg,'height',H);
 const step0=pcVoxelStep(dims,volume.spacing),warn=spacingLevel(activeSeries)==='warn'; // the chip's number is the result's number in the panel (analysisRegionName: the region id)
 for(const r of regs){
  keep.add(r.id);let e=alEls.get(r.id);
  if(!e){
   const leader=document.createElementNS('http://www.w3.org/2000/svg','line');leader.setAttribute('class','analysis-leader-3d');svg.appendChild(leader);
   const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('class','analysis-anchor-3d');dot.setAttribute('r','3.5');svg.appendChild(dot);
   const label=document.createElement('div');label.className='analysis-label-3d';
   const sw=document.createElement('i'),t1=document.createElement('b'),t2=document.createElement('span');label.append(sw,t1,t2);layer.appendChild(label);
   if(isLitKey('A:'+r.id)){label.classList.add('is-lit');leader.classList.add('is-lit')}
   e={label,leader,dot,sw,t1,t2,sig:'',w:90,h:16,sx:0,sy:0,ctx:null,lh:false,disp:'off',z:0,st:'',over:false};alEls.set(r.id,e);
  }
  const sig=r.id+'|'+(r.segmentKeys||[]).join()+'|'+r.mm3+'|'+r.color+'|'+(warn?1:0)+'|'+tr('analysisRegion')+'|'+regionCustomName(r)+(r.child?'|'+labelChipTitle(r,tr):''); // a rename (or atlas ID) redraws the chip
  if(e.sig!==sig){
   e.sig=sig;const col=regionCss(r.color);
   e.sw.style.background=col;e.label.style.borderColor=col;e.leader.style.stroke=col;e.dot.style.fill=col;
   e.t1.textContent=labelChipTitle(r,tr);e.t2.textContent=(warn?'⚠ ':'')+labelVolumeText(r.mm3);
   if(warn)e.label.title=tr('measureWarn');
   e.label.hidden=false;e.w=e.label.offsetWidth||90;e.h=e.label.offsetHeight||16;
  }
  const lab=r.label,al=voxelToLocal3D(lab.anchor,dims,volume.spacing),pl=places.get(r.id),pushed=!!pl?.pushed,moved=pl?pl.moved:leaderVisible(lab); // a card pushed out of the tissue gets a leader to its anchor too
  v3.set(al.x,al.y,al.z).applyMatrix4(obj.matrixWorld).project(camera);
  const ax=(v3.x+1)/2*W,ay=(1-v3.y)/2*H,az=v3.z,aOk=az>-1&&az<1&&Number.isFinite(ax)&&Number.isFinite(ay);
  let lx=ax,ly=ay-(e.h/2+10),lz=az,lOk=aOk; // default: just above its anchor, on the screen
  if(moved){ // where the user left it (anchor + offset, voxel units), or where it was pushed to (out of the tissue);: within the leader's length limit (updateLabelPlaces)
   const p=pl?pl.place:labelLocal(al,lab.offset,step0);v3.set(p.x,p.y,p.z).applyMatrix4(obj.matrixWorld).project(camera);
   lx=(v3.x+1)/2*W;ly=(1-v3.y)/2*H;lz=v3.z;lOk=lz>-1&&lz<1&&Number.isFinite(lx)&&Number.isFinite(ly);
  }
  if(!lOk){e.disp='off';putHidden(e.label,true);putStyle(e.leader,'display','none');putStyle(e.dot,'display','none');e.ctx=null;continue}
  const c={x:lx,y:ly}; // the card is drawn where its place is seen and is NOT held inside the view: a card that does not fit is cut by the view's edge (like the model) and comes into sight with a pan / zoom out. Holding it in made its line longer on a pan (analysis-label.js THE RULE)
  e.sx=c.x;e.sy=c.y;e.ctx={ml:al,step:step0,ndcZ:lz,cap:true}; // what a drag works from: the anchor (object space), the stored size's step (the cap is solved back on the drag) and the depth of the label
  putHidden(e.label,false);putStyle(e.label,'transform','translate('+c.x.toFixed(1)+'px,'+c.y.toFixed(1)+'px) translate(-50%,-50%)');
  if(aOk){putAttr(e.dot,'cx',ax.toFixed(1));putAttr(e.dot,'cy',ay.toFixed(1));putStyle(e.dot,'display','')}else putStyle(e.dot,'display','none');
  // the line: anchor -> the card's edge facing it (rectEdgePoint), as.: when the anchor is under its own card that line (it runs under the card, from the anchor to the
  // edge) is cut at the label's limit T, because it grows when the model is drawn smaller; outside the card the line is within T by the card's place (updateLabelPlaces)
  if(moved&&aOk){const ed=rectEdgePoint(ax-c.x,ay-c.y,e.w/2,e.h/2);let x2=c.x+ed.x,y2=c.y+ed.y;
   if(Math.abs(ax-c.x)<=e.w/2&&Math.abs(ay-c.y)<=e.h/2){const T=pl?pl.T:Infinity,len=Math.hypot(x2-ax,y2-ay);if(len>T){x2=ax+(x2-ax)*T/len;y2=ay+(y2-ay)*T/len}}
   putAttr(e.leader,'x1',ax.toFixed(1));putAttr(e.leader,'y1',ay.toFixed(1));putAttr(e.leader,'x2',x2.toFixed(1));putAttr(e.leader,'y2',y2.toFixed(1));putStyle(e.leader,'display','')}
  else putStyle(e.leader,'display','none');
  e.z=lz;e.disp=labelDisplay({embedded:!!pl?.embedded,pushed,behind:hiddenIds.has('A|'+r.id),dragging:e.label.classList.contains('is-dragging')});
 }
 // of the cards that overlap on the screen only the nearest stays (the lit one always); hidden-behind cards take no room
 const lit=labelFocus.get(),bg=boneGlow.get(),bgc=childBoneGlow.get(),items=[];
 for(const r of regs){const e=alEls.get(r.id);if(e&&e.ctx&&e.disp!=='off'&&(e.disp!=='hide'||r.id===bg||r.id===bgc)&&!e.label.hidden)items.push({id:r.id,x:e.sx,y:e.sy,w:e.w,h:e.h,z:e.z,keep:lit==='A:'+r.id||r.id===bg||r.id===bgc})} // the card of the bone under the mouse always stays (even one judged behind the tissue), nearer cards that overlap it give way
 const over=thinOverlaps(items);
 for(const r of regs){const e=alEls.get(r.id);if(e)setAlState(e,e.disp,over.has(r.id))}
}
// the three looks of a label, its leader and its anchor dot (CSS): .is-behind = hidden completely, .is-faint = translucent (embedded), .is-overlapped = hidden under a nearer card
function setAlState(e,disp,over){
 const sig=disp+(over?'o':'');e.over=over;if(e.st===sig)return;e.st=sig;
 for(const n of [e.label,e.leader,e.dot]){n.classList.toggle('is-behind',disp==='hide');n.classList.toggle('is-faint',disp==='faint');n.classList.toggle('is-overlapped',over)}
}
function pruneAnalysisLabels(keep){for(const [id,e] of [...alEls])if(!keep.has(id)){e.label.remove();e.leader.remove();e.dot.remove();alEls.delete(id)}}
function pruneMeasures(keep){for(const [id,e] of [...measEls])if(!keep.has(id)){e.line.remove();e.leader.remove();e.label.remove();e.grad?.remove();measEls.delete(id)}}
// depth cue. The overlay is drawn over the 3D canvas, so what lies behind the volume's surface is drawn FAINT (x-ray; judged with the points' rule, see refreshHidden): the label and
// its leader as a whole (CSS .is-behind; .is-lit / .is-dragging keep them fully visible), the line part by part (an SVG gradient along it, stop-opacity per sample).
function depthCue(e,m,s4,camera){
 const lh=hiddenIds.has(probeKey(m.id,labelPart(m.labelOffset)));
 if(e.lh!==lh){e.lh=lh;e.label.classList.toggle('is-behind',lh);e.leader.classList.toggle('is-behind',lh)}
 const al=lineAlphas(m.id,hiddenIds),any=al.some(v=>v<1),sig=any?al.join(''):'';
 if(!any){if(e.lsig){e.lsig='';e.line.style.stroke=''}return}
 if(!e.grad){
  const g=document.createElementNS('http://www.w3.org/2000/svg','linearGradient');g.setAttribute('id',nextGradId()); // a counter, not the measurement id (ids come from project files: not unique once made safe for an attribute)
  g.setAttribute('gradientUnits','userSpaceOnUse');
  for(let i=0;i<=LINE_SAMPLES;i++){const st=document.createElementNS('http://www.w3.org/2000/svg','stop');st.setAttribute('offset',String(i/LINE_SAMPLES));st.setAttribute('stop-color','#ffd23d');g.appendChild(st)}
  (svg.querySelector('defs')||svg.insertBefore(document.createElementNS('http://www.w3.org/2000/svg','defs'),svg.firstChild)).appendChild(g);e.grad=g;
 }
 e.grad.setAttribute('x1',s4[0].toFixed(1));e.grad.setAttribute('y1',s4[1].toFixed(1));e.grad.setAttribute('x2',s4[2].toFixed(1));e.grad.setAttribute('y2',s4[3].toFixed(1)); // same ends as the line (zero-length / axis-aligned lines have no bounding box: userSpaceOnUse)
 // the stops sit where the 3D samples fall on the DRAWN segment (perspective, near-plane clip), so they follow the camera, not only the hidden set
 const offs=lineStopOffsets(pairDepth[0],pairDepth[1],camera.near||0.01,!!camera.isOrthographicCamera);
 if(offs){const os=offs.map(v=>v.toFixed(4));const osig=os.join(',');if(e.osig!==osig){e.osig=osig;[...e.grad.children].forEach((st,i)=>st.setAttribute('offset',os[i]))}}
 if(e.lsig!==sig){e.lsig=sig;[...e.grad.children].forEach((st,i)=>st.setAttribute('stop-opacity',String(al[i])));e.line.style.stroke='url(#'+e.grad.getAttribute('id')+')'}
}
// the places of the distances judged with the points (object space): the samples of every line (A -> B) and the label that was dragged (the midpoint + its offset)
function measureProbes(pts,dims){
 const ms=getMeasurements();if(!ms.length)return[];
 const byId=new Map(pts.map(p=>[p.id,p])),step=voxelStep3d(dims,volume.spacing),out=[];
 for(const m of ms){
  const A=byId.get(m.a),B=byId.get(m.b);if(!A||!B)continue;
  lineSamplePoints(A.local,B.local).forEach((q,i)=>out.push({id:probeKey(m.id,i),local:q}));
  if(m.labelOffset){const ml=voxelToLocal3D({i:(A.vox.i+B.vox.i)/2,j:(A.vox.j+B.vox.j)/2,k:(A.vox.k+B.vox.k)/2},dims,volume.spacing),d=stepDelta(m.labelOffset,step);out.push({id:probeKey(m.id,'L'),local:{x:ml.x+d.x,y:ml.y+d.y,z:ml.z+d.z}})}
 }
 return out;
}
function placeHint(){
 const id=getMeasureStart(),m=id?els.get(id):null;
 if(!id||!m||!m.vis||!layer){if(hintEl)hintEl.hidden=true;return}
 if(!hintEl){hintEl=document.createElement('div');hintEl.className='measure-hint-3d';layer.appendChild(hintEl)}
 const t=tr('pmHint');if(hintEl.textContent!==t)hintEl.textContent=t;
 hintEl.hidden=false;hintEl.style.transform='translate('+m.x.toFixed(1)+'px,'+(m.y+22).toFixed(1)+'px) translate(-50%,0)';
}
function drawSectionCues(obj,camera,W,H,pts){
 const hasPlane=rels.size>0;
 if(!hasPlane&&!cuesOn)return; // no active section and nothing left to clear
 cuesOn=hasPlane;
 if(hasPlane)ensureSvg();
 if(svg){putAttr(svg,'width',W);putAttr(svg,'height',H)}
 for(const p of pts){
  const m=els.get(p.id),r=rels.get(p.id);if(!m)continue;
  const on=!!r&&r.on;if(m.on!==on){m.on=on;m.el.classList.toggle('is-on-section',on)}
  const want=!!r&&!r.on;
  if(want){
   if(!m.line){m.line=document.createElementNS('http://www.w3.org/2000/svg','line');if(m.hex)m.line.style.stroke=m.hex;svg.appendChild(m.line)}
   if(projectPair(obj,camera,W,H,p.local,r.foot,seg4)){m.line.setAttribute('x1',seg4[0].toFixed(1));m.line.setAttribute('y1',seg4[1].toFixed(1));m.line.setAttribute('x2',seg4[2].toFixed(1));m.line.setAttribute('y2',seg4[3].toFixed(1));m.line.style.display=''}
   else m.line.style.display='none';
  }else if(m.line){m.line.remove();m.line=null}
 }
}

// called after each 3D frame (and when the camera / object / comments may have changed)
export function updateComment3dMarkers(){
 if(!layer)return;
 const s=sceneState,obj=s?.obj,camera=s?.camera;
 const fp=activeSeries?datasetFingerprint(activeSeries):null;
 const list=obj&&camera&&volume&&fp&&getMarkersShown()?getComments():[],als=obj&&camera&&volume&&fp?analysisLabelRegions():[];
 const W=host.clientWidth,H=host.clientHeight,keep=new Set(),keepM=new Set(),keepA=new Set();
 if((list.length||als.length)&&W>=8&&H>=8){
  const dims={columns:volume.columns,rows:volume.rows,slices:volume.slices};
  obj.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const pts=[];
  list.forEach((c,n)=>{
   if(!commentMatchesSeries(c,fp))return;
   const t=commentTarget(c,dims);if(!t)return;
   const l=voxelToLocal3D(t,dims,volume.spacing);
   pts.push({id:c.id,local:{x:l.x,y:l.y,z:l.z},vox:t});
   v3.set(l.x,l.y,l.z).applyMatrix4(obj.matrixWorld);
   v3.project(camera);
   const x=(v3.x+1)/2*W,y=(1-v3.y)/2*H,vis=v3.z>-1&&v3.z<1&&x>-12&&x<W+12&&y>-12&&y<H+12;
   keep.add(c.id);
   let m=els.get(c.id);
   if(!m){const el=document.createElement('div');el.className='comment-marker-3d';el.setAttribute('role','img');layer.appendChild(el);m={el,x:0,y:0,vis:false,no:0,label:'',back:null,on:false,line:null,hex:''};els.set(c.id,m)}
   m.x=x;m.y=y;m.vis=vis;
   const hex=pointColor(c);if(m.hex!==hex){ // the point's colour (own or auto) overrides the CSS variables of this one element; the number chip inherits them
    m.hex=hex;const st=m.el.style,fill='#'+darkFill(hex).toString(16).padStart(6,'0');st.setProperty('--vr-point-dot',hex);st.setProperty('--vr-point-fill',fill);st.setProperty('--vr-point-ink',inkOn(hex));if(m.line)m.line.style.stroke=hex}
   if(m.no!==n+1){m.no=n+1;m.el.textContent='';const sp=document.createElement('span');sp.className='comment-marker-3d-no';sp.textContent=String(n+1);m.el.appendChild(sp)} // the dot is the element (its centre = the point); the number sits beside it
   const label=tr('commentMarker3d')+' '+(n+1);if(m.label!==label){m.label=label;m.el.setAttribute('aria-label',label)}
   m.el.hidden=!vis;
   const isStart=c.id===getMeasureStart();if(m.start!==isStart){m.start=isStart;m.el.classList.toggle('is-measure-start',isStart)}
   if(vis)m.el.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px) translate(-50%,-50%)';
  });
  // hidden behind tissue: judged at most ~10 times a second (the positions above follow every frame), plus once more after the view stops
  const plane=sectionViewOpen&&sectionViewPlane?sectionPlaneLocal(sectionLocalPoint(),sectionLocalNormal()):null;
  // the distances' probes (line samples, a dragged label) are judged in the same pass; their places are part of the signature (a moved point / label is judged again)
  {const t=performance.now();capViews(obj,camera,W,H,t);updateLabelPlaces(als,dims,plane,t)}
  const probes=measureProbes(pts,dims).concat(analysisProbes(als)),judged=probes.length?pts.concat(probes):pts;
  const sig=hiddenSignature(obj,camera,pts.map(p=>p.id).concat(probes.map(p=>p.id+'@'+p.local.x.toFixed(3)+','+p.local.y.toFixed(3)+','+p.local.z.toFixed(3))),plane,fp),now=performance.now(),st=throttle.step(now,sig!==hiddenSig);
  clearTimeout(hiddenTimer);hiddenTimer=0;
  if(st.run){hiddenSig=sig;refreshHidden(obj,camera,judged,plane)}
  else if(st.wait>0)hiddenTimer=setTimeout(refreshSoon,st.wait);
  for(const [id,m] of els){const back=hiddenIds.has(id);if(m.back!==back){m.back=back;m.el.classList.toggle('is-behind',back)}}
  // position cues relative to the active section (VR's rule): on it = bigger (.is-on-section); off it = a thin line to its foot (SVG layer).
  // The relation only changes with the plane / points, so it is recomputed then; the lines follow the camera every frame.
  const rsig=(plane?[plane.x,plane.y,plane.z,plane.w].join(','):'')+'|'+pts.map(p=>p.id+':'+p.local.x+','+p.local.y+','+p.local.z).join(';');
  if(rsig!==relSig){relSig=rsig;rels=planeRelations(pts,plane,boxHalfExtent(dims,volume.spacing),dims)}
  drawSectionCues(obj,camera,W,H,pts);
  drawMeasures(obj,camera,W,H,pts,keepM,dims);
  drawAnalysisLabels(obj,camera,W,H,als,keepA,dims);
 }
 pruneMeasures(keepM);pruneAnalysisLabels(keepA);
 syncHoverFocus();
 {const bg=boneGlow.get(),bgc=childBoneGlow.get();if(bg&&(!alEls.has(bg)||!boneGate()))boneGlow.clear();if(bgc&&(!alEls.has(bgc)||!boneGate()))childBoneGlow.clear()} // the glowing result lost its card (hidden / deleted / label removed) or the mode changed: out
 if(!list.length&&!als.length){clearTimeout(hiddenTimer);hiddenTimer=0}
 for(const [id,m] of [...els])if(!keep.has(id)){m.el.remove();m.line?.remove();els.delete(id)}
 if(bubbleId!=null)placeBubble();
 placeHint();
}
// tap on a dot (not a drag): the pointer handlers of the 3D view are untouched (listeners are only added, nothing is stopped); taps in
// the analysis / edit modes, where a tap already means something, and taps that moved are ignored.
// dragging a distance label. The labels do not take pointer events themselves: a CAPTURE-phase listener on the view finds the label under a press on the 3D canvas, so
// (1) a point under the press always wins (its tap / long press / menu), (2) a press on a label never reaches the 3D view's own rotate / pan handlers, (3) no label element
// sits over a dot. The new place is stored as labelOffset (voxel units from the midpoint: the same in VR and the 2D views, saved in the project). A double tap / click on a label
// puts it back at its default place.
let lastLabelDown={key:null,t:0,x:0,y:0};
const inLabel=(e,x,y)=>!e.label.hidden&&Math.abs(x-e.sx)<=e.w/2+4&&Math.abs(y-e.sy)<=e.h/2+4;
// the label under (x,y) (view px): {kind:'m'|'a',id,key} (a distance label or an analysis label), or null
function labelAt(x,y){
 for(const [id,e] of alEls)if(!e.over&&e.disp!=='hide'&&inLabel(e,x,y))return{kind:'a',id,key:'A:'+id}; // a shown card wins; a card hidden under a nearer one or behind a volume can still be reached (it comes to the front while lit: the old behaviour)
 for(const [id,e] of alEls)if(inLabel(e,x,y))return{kind:'a',id,key:'A:'+id};
 for(const [id,e] of measEls)if(inLabel(e,x,y))return{kind:'m',id,key:'M:'+id};
 return null;
}
// the analysis labels can be moved in the analysis mode too (a press on a label wins over the analysis click), but not while an edit tool owns the pointer
const analysisGate=()=>analysisEditTool==='select';
const regionOf=id=>childLabelItemById(id)||analysisRegions.find(r=>r.id===id)||null; // a negative id is a child segment's label
let labelDragging=false; // while a label is dragged every other pointerdown on the canvas (a second finger) is stopped at the capture phase, so it cannot rotate / pan the camera
// ---- the mouse resting on a bone lights that result's card (like the VR laser) ----
// The bone is found with the volume pick a click already uses (medicalVolume.pick: GPU compute, or the CPU march of the WebGL volume), the voxel -> result by the shown labelled results' runs (the click-to-select rule).
// Cost rule: no work while the mouse moves; one pick when it rests (80 ms), at most one in flight and one per 200 ms while it keeps moving; none when no shown result has a label, in the surface mode (a mesh ray cast
// per move would be heavy), with a button down / touch / off the canvas. Not part of the click picks: nothing is selected or changed.
const boneGate=()=>analysisEditTool==='select'&&threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active&&!!volume;
const bonePick={x:0,y:0,timer:0,at:0,busy:false,again:false,live:false};
function bonePickRun(){
 bonePick.timer=0;if(!bonePick.live||bonePick.busy||!boneGate())return;
 const s=sceneState,mv=s.medicalVolume,regs=analysisLabelRegions();if(!regs.length||!s.obj||!s.camera){boneGlow.clear();childBoneGlow.clear();return}
 const tok=boneGlow.ticket(),tokC=childBoneGlow.ticket();bonePick.busy=true;bonePick.at=performance.now();
 let p;try{p=mv.pick(bonePick.x,bonePick.y,s.camera,s.obj,segmentState,gpuSegmentOrder())}catch(e){p=Promise.reject(e)}
 Promise.resolve(p).then(hit=>{const g=glowPairOf(analysisLabelRegions(),hit,(r,x,y,z)=>analysisRunsContain(r.runsBySlice,x,y,z));boneGlow.settle(tok,g[0]);childBoneGlow.settle(tokC,g[1])},()=>{boneGlow.settle(tok,0);childBoneGlow.settle(tokC,0)}).finally(()=>{bonePick.busy=false;if(bonePick.again){bonePick.again=false;bonePickSchedule()}});
}
function bonePickSchedule(){
 clearTimeout(bonePick.timer);if(!bonePick.live)return;
 if(bonePick.busy){bonePick.again=true;return} // one pick at a time; the newest position is asked for when it returns
 const wait=performance.now()-bonePick.at>=200?0:80;bonePick.timer=setTimeout(bonePickRun,wait);
}
function boneHoverOff(){bonePick.live=false;bonePick.again=false;clearTimeout(bonePick.timer);bonePick.timer=0;boneGlow.clear();childBoneGlow.clear()}
function installBoneHover(){
 // capture phase: the dock / menus stop their own pointer events, so only the capture on the host sees every move over the view (target != the canvas = off the bone)
 host.addEventListener('pointermove',ev=>{
  const onCanvas=ev.target?.tagName==='CANVAS'&&ev.target.parentElement===host;
  const r=onCanvas?host.getBoundingClientRect():null,h=r?labelAt(ev.clientX-r.left,ev.clientY-r.top):null;
  const ok=boneHoverPickable({touch:ev.pointerType==='touch',buttons:ev.buttons,onCanvas,overLabel:!!(h&&h.kind==='a'&&analysisGate()),gate:boneGate(),labelled:analysisLabelRegions().length>0});
  if(!ok){boneHoverOff();return}
  bonePick.x=ev.clientX;bonePick.y=ev.clientY;bonePick.live=true;bonePickSchedule();
 },true);
 host.addEventListener('pointerleave',boneHoverOff);host.addEventListener('pointerdown',boneHoverOff,true);host.addEventListener('pointercancel',boneHoverOff);
 host.addEventListener('wheel',()=>{if(bonePick.live){boneGlow.ticket();childBoneGlow.ticket();bonePickSchedule()}},{passive:true}); // the view zooms under a resting mouse: the old answer is stale, ask again
 window.addEventListener('blur',boneHoverOff);document.addEventListener('keydown',e=>{if(e.key==='Escape')boneHoverOff()});
}
function installLabelDrag(nearestDot,gate){
 const allowed=(h,x,y)=>h.kind==='a'?analysisGate()&&!(gate()&&nearestDot(x,y)!=null):gate()&&nearestDot(x,y)==null; // a point wins over a label
 host.addEventListener('pointermove',ev=>{ // hover (mouse / pen): the label under the pointer lights up
  if(ev.pointerType==='touch'||ev.buttons)return;
  const r=host.getBoundingClientRect(),h=labelAt(ev.clientX-r.left,ev.clientY-r.top);
  labelFocus.hover(h&&allowed(h,ev.clientX,ev.clientY)?h.key:null);
 });
 host.addEventListener('pointerleave',()=>labelFocus.hover(null));
 host.addEventListener('pointerdown',ev=>{
  if(labelDragging){if(ev.target?.tagName==='CANVAS'){ev.stopPropagation();ev.preventDefault()}return}
  if(ev.target?.tagName!=='CANVAS'||(ev.pointerType==='mouse'&&ev.button!==0))return;
  const r=host.getBoundingClientRect(),h=labelAt(ev.clientX-r.left,ev.clientY-r.top);
  if(!h||!allowed(h,ev.clientX,ev.clientY))return;
  const e=h.kind==='a'?alEls.get(h.id):measEls.get(h.id);if(!e||!e.ctx)return;
  const setOff=off=>h.kind==='a'?setRegionLabelOffset(regionOf(h.id),off):setLabelOffset(h.id,off);
  ev.stopPropagation();ev.preventDefault();closeBubble3d();
  if(lastLabelDown.key===h.key&&ev.timeStamp-lastLabelDown.t<350&&Math.hypot(ev.clientX-lastLabelDown.x,ev.clientY-lastLabelDown.y)<12){lastLabelDown={key:null,t:0,x:0,y:0};setOff(null);return}
  lastLabelDown={key:h.key,t:ev.timeStamp,x:ev.clientX,y:ev.clientY};
  const dx=ev.clientX-r.left-e.sx,dy=ev.clientY-r.top-e.sy,pid=ev.pointerId;e.label.classList.add('is-dragging');labelFocus.drag(h.key);labelDragging=true;
  const move=m=>{
   if(m.pointerId!==pid||!e.ctx)return;m.stopPropagation();
   const{obj,camera}=sceneState,W=host.clientWidth,H=host.clientHeight;if(!obj||!camera)return;
   obj.updateMatrixWorld(true);camera.updateMatrixWorld(true);
   v3.set((m.clientX-r.left-dx)/W*2-1,1-(m.clientY-r.top-dy)/H*2,e.ctx.ndcZ).unproject(camera);obj.worldToLocal(v3); // the screen point, in the plane facing the camera at the label's depth
   let px=v3.x,py=v3.y,pz=v3.z;
   if(e.ctx.cap){capViews(obj,camera,W,H);const q=labelDragPlace(e.ctx.ml,{x:px,y:py,z:pz},e.w,e.h,obj,camera);px=q.x;py=q.y;pz=q.z} // the offset whose limited place is the pointer's (labelDragPlace)
   setOff(offsetForLocal(e.ctx.ml,{x:px,y:py,z:pz},e.ctx.step));
  };
  const up=m=>{if(m.pointerId!==pid)return;labelDragging=false;e.label.classList.remove('is-dragging');labelFocus.drag(null);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true)};
  document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);
 },true);
}
function installTap(){
 let d=null;
 const gate=()=>!volumeAnalysisMode&&analysisEditTool==='select'&&getMarkersShown();
 const nearest=(cx,cy)=>{
  const r=host.getBoundingClientRect(),x=cx-r.left,y=cy-r.top,reach=24;
  let best=null,bd=1e9;for(const [id,m] of els){if(!m.vis)continue;const dd=Math.hypot(m.x-x,m.y-y);if(dd<=reach&&dd<bd){best=id;bd=dd}}
  return best;
 };
 host.addEventListener('pointerdown',e=>{
  closeBubble3d();clearTimeout(d?.timer);
  d=e.target?.tagName==='CANVAS'?{id:e.pointerId,x:e.clientX,y:e.clientY,lp:createLongPress({ms:450}),timer:0}:null;
  if(!d)return;d.lp.down(e.clientX,e.clientY,performance.now());
  // long press on a dot (touch long press / mouse press-and-hold; a right-click opens it too) = the point menu
  const hit=(e.button===0||e.pointerType==='touch')&&gate()?nearest(e.clientX,e.clientY):null;
  if(hit!=null){const mine=d;mine.timer=setTimeout(()=>{if(d===mine&&mine.lp.tick(performance.now())==='long')openPointMenu({id:hit,x:mine.x,y:mine.y})},500)}
 });
 installLabelDrag(nearest,gate);
 host.addEventListener('pointermove',e=>{if(d&&d.id===e.pointerId)d.lp.move(e.clientX,e.clientY)});
 host.addEventListener('pointerup',e=>{
  const s=d;d=null;if(s)clearTimeout(s.timer);if(!s||s.id!==e.pointerId||!gate())return;
  const r=s.lp.up();if(r==='long'||r==='moved')return; // the long press opened the menu: the release is not a tap
  if(Math.hypot(e.clientX-s.x,e.clientY-s.y)>6)return;
  const best=nearest(e.clientX,e.clientY);
  if(getMeasureStart()){if(best!=null)endMeasureAt(best);else cancelMeasureUi();return} // a distance is being measured: a dot = its END, empty space = cancel
  if(best!=null)showBubble3d(best);
 });
 host.addEventListener('pointercancel',()=>{if(d)clearTimeout(d.timer);d=null});
 host.addEventListener('contextmenu',e=>{
  if(!gate())return;const best=nearest(e.clientX,e.clientY);if(best==null)return;
  e.preventDefault();if(d){clearTimeout(d.timer);d=null}openPointMenu({id:best,x:e.clientX,y:e.clientY});
 });
 host.addEventListener('wheel',closeBubble3d,{passive:true});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeBubble3d()});
}
export function installComment3d(viewportEl){
 if(layer||!viewportEl)return;
 host=viewportEl;layer=document.createElement('div');layer.className='comment-layer-3d';layer.setAttribute('aria-hidden','false');host.appendChild(layer);
 installTap();installBoneHover();
 const again=()=>{request3DRender()};
 onCommentsChange(again);onMeasurementsChange(again);onAnalysisLabelsChange(again);onChildSegChange(again);onMeasureStartChange(again);onMarkersShownChange(()=>{closeBubble3d();if(!getMarkersShown())releaseHidden();again()});
 document.addEventListener('vrl-serieschange',()=>{releaseHidden();again()});
}
