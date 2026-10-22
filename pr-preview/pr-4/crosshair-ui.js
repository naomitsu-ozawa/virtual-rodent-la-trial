// Linked crosshair UI: the toolbar button / mode, the pointer handling on the three MPR canvases, the lines on their
// own overlay canvases (NOT the slice canvases: those must keep their pixels, tools/theme-image-check.mjs compares them) and the
// small HU / position readout. The position itself lives in state.js (setCrosshair / getCrosshair / clearCrosshair); the
// geometry is in crosshair.js. Scope of this stage: crosshair, HU readout and the position API only.
import { planes } from './ui-shell.js?v=20261022-build643';
import { volume, sourceVolume, getCrosshair, setCrosshair, clearCrosshair, onCrosshairChange } from './state.js?v=20261022-build643';
import { tr } from './i18n.js?v=20261022-build643';
import { schedulePlaneRender } from './mpr-render.js?v=20261022-build643';
import { sourceSliceCache } from './volume-io.js?v=20261022-build643';
import { sourceFilterStages, sourceFilterSignature, sourceFilterCacheGet } from './source-filters.js?v=20261022-build643';
import { CROSSHAIR_PLANES, clientToFraction, voxelFromPlanePoint, planePointFromVoxel, sliceIndexFor, voxelToMm, sampleHu, formatHu, formatMm } from './crosshair.js?v=20261022-build643';
let overlayPainter=null;
// other overlays (the comment markers) paint on the same canvases: fn(ctx,plane,{x0,y0,w,h,dpr,cssW,cssH}) with the transform set to CSS px
export const setOverlayPainter=fn=>{overlayPainter=fn};
// a second painter (the line profile line): drawn after the markers, under the crosshair
let extraPainter=null;export const setExtraOverlayPainter=fn=>{extraPainter=fn};
// a third painter (the crop box): drawn after the line, under the crosshair
let cropPainter=null;export const setCropOverlayPainter=fn=>{cropPainter=fn};
export const requestOverlayDraw=()=>scheduleDraw();
let mode=false,drag=null,activePlane='axial',drawQueued=false,huRetries=0,huTimer=null;
const COLOR='#ffe14d'; // drawn over a dark halo (same recipe as the cut stroke of an earlier change), so it reads on light and dark themes
const dimsOf=()=>volume?{columns:volume.columns,rows:volume.rows,slices:volume.slices}:null;
export const crosshairModeActive=()=>mode;

// ---- HU ----
// Original calibrated HU. A source-backed volume is not in memory: peek the slice cache only (never decode, never 0).
const peekSlice=meta=>sourceSliceCache.map.get(meta)||null;
export function crosshairOriginalHu(c){return sampleHu(sourceVolume||volume,c,peekSlice)}
// Auxiliary: the value after the active filters, only when it is already available (memory result or a cached filtered plane)
export function crosshairFilteredHu(c){
 try{
  if(!volume||!sourceVolume)return null;
  if(volume!==sourceVolume&&volume.data&&!volume.sourceBacked)return sampleHu(volume,c,null);
  const stages=sourceFilterStages();if(!stages.length||!volume.sourceBacked)return null;
  const plane=sourceFilterCacheGet(sourceFilterSignature(stages)+'|axial|'+c.k);
  const x=plane?plane[c.j*volume.columns+c.i]:null;return Number.isFinite(x)?x:null;
 }catch{return null}
}

// ---- readout ----
function readoutLines(c){
 const mm=voxelToMm(c,volume.spacing),hu=crosshairOriginalHu(c),f=crosshairFilteredHu(c);
 const rows=[[tr('crosshairVoxel')+' ','i ',c.i,' · j ',c.j,' · k ',c.k],[tr('crosshairMm')+' ','x ',formatMm(mm.x),' · y ',formatMm(mm.y),' · z ',formatMm(mm.z),' mm']];
 const huRow=[tr('crosshairHu')+' '];
 huRow.push({b:formatHu(hu)});if(hu!=null)huRow.push(' HU');
 if(f!=null&&f!==hu)huRow.push(' · '+tr('crosshairFiltered')+' '+formatHu(f)+' HU');
 return{rows:[...rows,huRow],hu};
}
const planeShown=p=>{const r=planes[p]?.canvas?.getBoundingClientRect?.();return!!r&&r.width>1&&r.height>1};
// one readout at a time: on the plane last used if it is on screen, else on the first plane on screen (the workspace UI shows one plane)
function placeReadout(c){
 const shown=CROSSHAIR_PLANES.filter(planeShown),target=!c||!volume?null:planeShown(activePlane)?activePlane:(shown[0]||null);
 for(const p of CROSSHAIR_PLANES){const el=document.getElementById('crosshair-readout-'+p);if(el)el.hidden=p!==target}
}
export function updateCrosshairReadout(){
 clearTimeout(huTimer);huTimer=null;
 const c=getCrosshair();
 if(c&&volume){
  const{rows,hu}=readoutLines(c);
  for(const p of CROSSHAIR_PLANES){
   const el=document.getElementById('crosshair-readout-'+p);if(!el)continue;el.replaceChildren();
   for(const parts of rows){
    const d=document.createElement('div');
    for(const x of parts){if(typeof x==='object'){const b=document.createElement('b');b.textContent=x.b;d.appendChild(b)}else d.appendChild(document.createTextNode(String(x)))}
    el.appendChild(d);
   }
   el.dataset.hu=hu==null?'':String(hu);
  }
  // the axial slice of the point is the one being drawn, so it lands in the cache a moment later: look again (no decoding here)
  if(hu==null&&huRetries<16){huRetries++;huTimer=setTimeout(updateCrosshairReadout,250)}else if(hu!=null)huRetries=0;
 }
 placeReadout(c);
}

// ---- overlay lines ----
function drawPlane(p){
 const cv=document.getElementById(p+'-crosshair'),img=planes[p]?.canvas;if(!cv||!img)return;
 const dpr=window.devicePixelRatio||1,W=Math.max(1,Math.round(cv.clientWidth*dpr)),H=Math.max(1,Math.round(cv.clientHeight*dpr));
 if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;
 const ctx=cv.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);
 const c=getCrosshair(),dims=dimsOf();
 const cr=cv.getBoundingClientRect(),ir=img.getBoundingClientRect();
 if(!dims||ir.width<2||ir.height<2){overlayPainter?.(null,p);extraPainter?.(null,p);cropPainter?.(null,p);return}
 const x0=ir.left-cr.left,y0=ir.top-cr.top;
 ctx.setTransform(dpr,0,0,dpr,0,0);
 const geo={x0,y0,w:ir.width,h:ir.height,dpr};
 if(overlayPainter)overlayPainter(ctx,p,geo); // markers first: the crosshair stays on top
 if(extraPainter)extraPainter(ctx,p,geo);
 if(cropPainter)cropPainter(ctx,p,geo);
 if(!c)return;
 const{fx,fy}=planePointFromVoxel(p,c,dims),x=x0+fx*ir.width,y=y0+fy*ir.height;
 ctx.lineCap='butt';
 const path=()=>{ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x,y0+ir.height);ctx.moveTo(x0,y);ctx.lineTo(x0+ir.width,y);ctx.stroke()};
 ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=7;path(); // dark outline: readable on a light background too
 ctx.strokeStyle=COLOR;ctx.lineWidth=3;path();
 ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle=COLOR;ctx.lineWidth=2.5;ctx.stroke();
}
export function drawCrosshairs(){drawQueued=false;for(const p of CROSSHAIR_PLANES)drawPlane(p);placeReadout(getCrosshair())}
function scheduleDraw(){if(drawQueued)return;drawQueued=true;requestAnimationFrame(drawCrosshairs)}

// ---- mode / button ----
function updateButtons(){
 const ready=!!volume&&!!planes.axial?.slider&&!planes.axial.slider.disabled;
 if(mode&&!ready){mode=false;drag=null;clearCrosshair('mode-off')}
 document.querySelectorAll('[data-crosshair-toggle]').forEach(b=>{b.disabled=!ready;b.classList.toggle('is-active',mode);b.setAttribute('aria-pressed',mode?'true':'false');b.title=tr('crosshairTitle')});
}
export function setCrosshairMode(on,plane=null){
 on=!!on&&!!volume;if(plane)activePlane=plane;
 if(on===mode){updateButtons();return}
 mode=on;drag=null;
 if(on){const s=p=>+planes[p].slider.value;setCrosshair({i:s('sagittal'),j:s('coronal'),k:s('axial')},'mode-on')} // start at the three slices on show
 else clearCrosshair('mode-off');
 updateButtons();updateCrosshairReadout();scheduleDraw();
}
// Move the linked crosshair (and so the three slice sliders) to a voxel, e.g. from a position comment. Turns the crosshair mode on first
// so the lines and the readout are shown; returns the clamped position, or null without a volume.
export function showCrosshairAt(v,source='api'){
 if(!volume)return null;
 if(!mode)setCrosshairMode(true);
 const at=setCrosshair(v,source);updateCrosshairReadout();scheduleDraw();return at;
}
export function refreshCrosshairUi(){updateButtons();updateCrosshairReadout();scheduleDraw()}

// ---- pointer (called first by installMprTouch in app.js; true = handled, the slider swipe / region pick must not run) ----
function place(p,e){
 const dims=dimsOf();if(!dims)return;
 const{fx,fy}=clientToFraction(planes[p].canvas.getBoundingClientRect(),e.clientX,e.clientY);
 setCrosshair(voxelFromPlanePoint(p,fx,fy,dims,+planes[p].slider.value),'pointer-'+p);
}
export function crosshairPointerDown(p,e){
 if(!mode||!volume)return false;
 if(drag||(e.pointerType==='mouse'&&e.button!==0))return true;
 drag={p,id:e.pointerId};activePlane=p;
 try{planes[p].canvas.setPointerCapture(e.pointerId)}catch{}
 e.preventDefault();place(p,e);updateCrosshairReadout();return true;
}
export function crosshairPointerMove(p,e){
 if(!mode)return false;
 if(drag&&drag.id===e.pointerId&&drag.p===p)place(p,e);
 return true;
}
export function crosshairPointerEnd(p,e){
 if(!mode)return false;
 if(!drag||drag.id!==e.pointerId)return true;
 const was=drag;drag=null;
 try{if(planes[was.p].canvas.hasPointerCapture(e.pointerId))planes[was.p].canvas.releasePointerCapture(e.pointerId)}catch{}
 if(e.type==='pointerup')place(was.p,e); // released: the position is final
 for(const q of CROSSHAIR_PLANES)if(q!==was.p)schedulePlaneRender(q,true); // full-quality slices of the other two planes
 updateCrosshairReadout();return true;
}

// ---- linking ----
function onChange(detail){
 const c=detail.crosshair;huRetries=0; // a new position: look for its HU again
 if(c&&volume){
  for(const q of CROSSHAIR_PLANES){ // Axial (i,j) -> Coronal slice j, Sagittal slice i; Coronal (i,k) -> Axial k, Sagittal i; Sagittal (j,k) -> Axial k, Coronal j
   const s=planes[q].slider,idx=sliceIndexFor(q,c);
   if(!s.disabled&&+s.value!==idx){s.value=String(idx);schedulePlaneRender(q,!drag)}
  }
 }
 if(!c&&mode&&detail.source==='series'){mode=false;drag=null;updateButtons()}
 updateCrosshairReadout();scheduleDraw();
}

export function installCrosshair(){
 onCrosshairChange(onChange);
 document.querySelectorAll('[data-crosshair-toggle]').forEach(b=>b.addEventListener('click',()=>setCrosshairMode(!mode,b.dataset.crosshairToggle)));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode)setCrosshairMode(false)});
 const ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(scheduleDraw):null;
 const mo=typeof MutationObserver!=='undefined'?new MutationObserver(updateButtons):null;
 for(const p of CROSSHAIR_PLANES){ro?.observe(planes[p].canvas);ro?.observe(document.getElementById(p+'-crosshair'));mo?.observe(planes[p].slider,{attributes:true,attributeFilter:['disabled']})}
 window.addEventListener('resize',scheduleDraw,{passive:true});
 for(const name of ['vrl-plane-selected','vrl-plane-chosen','vrl-themechange','vrl-slicechange'])document.addEventListener(name,scheduleDraw);
 updateButtons();
}
