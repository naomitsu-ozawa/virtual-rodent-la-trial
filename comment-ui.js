// Position comments UI (stage 2): a small panel in the display drawer. "Add" records the current position (the linked
// crosshair, or the three slices on show) with the text; "View this place" moves the crosshair and the three sliders there. Nothing
// here runs by itself on load, and no pointer handler is added to the image canvases (the click / swipe on them is untouched).
import { eventModeOn } from './event-mode.js?v=20261025-build668';
import { planes } from './ui-shell.js?v=20261025-build668';
import { volume, activeSeries, getCrosshair, currentLanguage } from './state.js?v=20261025-build668';
import { tr } from './i18n.js?v=20261025-build668';
import { datasetFingerprint } from './project-file.js?v=20261025-build668';
import { COMMENT_MAX_TEXT, nextAutoKey, createComment, addComment, removeComment, restoreComment, updateCommentText, updateCommentColor, hasUnsavedComments, getComments, onCommentsChange, commentMatchesSeries, commentTarget, commentMarkers, getMarkersShown, setMarkersShown, onMarkersShownChange } from './comments.js?v=20261025-build668';
import { POINT_PALETTE, pointColor, autoPointColor, inkOn, paletteName } from './point-colors.js?v=20261025-build668';
import { showCrosshairAt, crosshairModeActive, setOverlayPainter, requestOverlayDraw } from './crosshair-ui.js?v=20261025-build668';
import { getMeasurements, setLabelOffset, onMeasurementsChange, removeMeasurement, measurementsOfPoint, restoreMeasurements, measurementMm, measureLabel, seriesSpacing, spacingLevel, getMeasureStart, onMeasureStartChange, cancelMeasure, createLongPress, hasUnsavedMeasurements } from './measurements.js?v=20261025-build668';
import { planeLabelPlacement, planeVoxelDelta, clampLabelCenter, createFocusTracker } from './measure-label.js?v=20261025-build668';
import { planePointFromVoxel } from './crosshair.js?v=20261025-build668';
import { openPointMenu, setPointMenuHandlers, installPointMenu, endMeasureAt, cancelMeasureUi, flashUndo } from './point-menu.js?v=20261025-build668';
let pop=null,popText=null,popPos=null,popStatus=null,popTimer=0,popFrom=null;
let root=null,listEl=null,textEl=null,addBtn=null,noteEl=null,undoEl=null,undoTimer=0,lastDeleted=null;
let showEl=null,bubble=null,bubbleTimer=0,measTitleEl=null,measListEl=null;
let colorOpenId=null; // the point whose colour palette is open in the list
let editId=null,editDraft='',editFocus=false; // the comment being edited in the list (the draft survives a re-render of the list)
const labelHits={axial:[],coronal:[],sagittal:[]}; // the distance labels last drawn per plane (CSS px on the overlay canvas), for the drag
const hits={axial:[],coronal:[],sagittal:[]}; // exact markers last drawn per plane (CSS px on the overlay canvas), for the tap test
const dimsOf=()=>volume?{columns:volume.columns,rows:volume.rows,slices:volume.slices}:null;
const fingerprint=()=>activeSeries?datasetFingerprint(activeSeries):null;
const ready=()=>!!volume&&!!activeSeries&&!!planes.axial?.slider&&!planes.axial.slider.disabled;

// where the comment goes: the crosshair, else the three slices on show
export function currentCommentPosition(){
 const c=getCrosshair();if(c)return c;
 if(!volume)return null;
 const s=p=>+planes[p].slider.value;return{i:s('sagittal'),j:s('coronal'),k:s('axial')};
}
export function addCommentHere(text){
 const position=currentCommentPosition(),series=fingerprint();if(!position||!series)return null;
 return addComment(createComment({text,position,series,autoKey:nextAutoKey(getComments())}));
}
// "View this place": only for a comment of the open series; the position is clamped into the volume
export function viewComment(id){
 const c=getComments().find(x=>x.id===id),fp=fingerprint();
 if(!c||!ready()||!commentMatchesSeries(c,fp))return null;
 const target=commentTarget(c,dimsOf());return target?showCrosshairAt(target,'comment'):null;
}

// the start point of a distance: a pulsing ring and the hint next to it (the hint pill at the bottom of the page is always shown)
function paintStart(ctx,x,y,R,ipad){
 const ph=(performance.now()%1200)/1200,k=0.5+0.5*Math.sin(ph*Math.PI*2);
 ctx.beginPath();ctx.arc(x,y,R+4+k*6,0,Math.PI*2);ctx.lineWidth=3;ctx.strokeStyle='rgba(0,0,0,.7)';ctx.stroke();
 ctx.lineWidth=1.8;ctx.strokeStyle='#ffd23d';ctx.globalAlpha=.55+.45*k;ctx.stroke();ctx.globalAlpha=1;
 const text=tr('pmHint'),fs=ipad?14:12;ctx.font='700 '+fs+'px sans-serif';const w=ctx.measureText(text).width+12,h=fs+8,tx=Math.min(Math.max(4,x-w/2),Math.max(4,ctx.canvas.clientWidth-w-4)),ty=y+R+12;
 ctx.fillStyle='rgba(17,23,27,.88)';ctx.beginPath();ctx.roundRect(tx,ty,w,h,6);ctx.fill();ctx.strokeStyle='#ffd23d';ctx.lineWidth=1;ctx.stroke();
 ctx.fillStyle='#fff';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text,tx+6,ty+h/2+0.5);
}
// a distance is drawn on a plane only when BOTH of its points lie on the slice on show (a dashed line + the value at its midpoint); otherwise nothing
function paintMeasures(ctx,ms,g,p){
 const at=new Map();for(const m of ms)if(m.exact)at.set(m.id,{x:g.x0+m.fx*g.w,y:g.y0+m.fy*g.h});
 const mm=getMeasurements().filter(m=>at.has(m.a)&&at.has(m.b));if(!mm.length)return;
 const cs=getComments(),sp=seriesSpacing(activeSeries),lvl=spacingLevel(activeSeries),ipad=document.documentElement.classList.contains('vrl-ipad-ui'),dims=dimsOf();
 for(const m of mm){
  const A=at.get(m.a),B=at.get(m.b);
  ctx.setLineDash([6,4]);ctx.lineWidth=4;ctx.strokeStyle='rgba(0,0,0,.6)';ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();
  ctx.lineWidth=2;ctx.strokeStyle='#ffd23d';ctx.stroke();ctx.setLineDash([]);
  // a compact label, by default beside the line (perpendicular, the upper side); where the user dragged it (labelOffset: voxel units from the midpoint) otherwise
  const text=measureLabel(measurementMm(m,cs,sp),lvl==='warn'),fs=ipad?12:10;ctx.font='700 '+fs+'px sans-serif';
  const w=ctx.measureText(text).width+8,h=fs+6,mx=(A.x+B.x)/2,my=(A.y+B.y)/2;
  let pl;
  if(m.labelOffset&&dims){
   const ca=commentTarget(cs.find(c=>c.id===m.a),dims),cb=commentTarget(cs.find(c=>c.id===m.b),dims),o=m.labelOffset;
   const f=planePointFromVoxel(p,{i:(ca.i+cb.i)/2+o.i,j:(ca.j+cb.j)/2+o.j,k:(ca.k+cb.k)/2+o.k},dims),c=clampLabelCenter(g.x0+f.fx*g.w,g.y0+f.fy*g.h,{w,h,x0:g.x0,y0:g.y0,iw:g.w,ih:g.h}); // shown inside the image (the stored offset is unchanged)
   pl={x:c.x,y:c.y,mx,my};
  }else pl={...planeLabelPlacement(A,B,{w,h,gap:4,x0:g.x0,y0:g.y0,iw:g.w,ih:g.h})};
  const x=pl.x-w/2,y=pl.y-h/2;
  labelHits[p].push({id:m.id,x:x-4,y:y-4,w:w+8,h:h+8,lx:pl.x,ly:pl.y,mx,my,iw:g.w,ih:g.h}); // a little bigger than drawn: easier to grab
  ctx.lineWidth=1;ctx.strokeStyle='rgba(255,210,61,.8)';ctx.beginPath();ctx.moveTo(pl.mx,pl.my);ctx.lineTo(pl.x,pl.y);ctx.stroke();
  const lit=labelFocus2d.get()===m.id; // lit like the ring menu's focused sector: #ffe27a, dark text, white rim
  ctx.fillStyle=lit?'#ffe27a':'rgba(17,23,27,.88)';ctx.beginPath();ctx.roundRect(x,y,w,h,5);ctx.fill();ctx.strokeStyle=lit?'#fff':'#ffd23d';ctx.lineWidth=lit?2.5:1;ctx.stroke();
  ctx.fillStyle=lit?'#111':'#fff';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text,x+4,y+h/2+0.5);
 }
}
// dragging a label on a 2D plane. A listener on the plane's card in the CAPTURE phase, so a press on a label never reaches the slice swipe / crosshair /
// mark handlers of the canvas; everything else passes untouched. The new place is stored as labelOffset (shared with VR and 3D).
let lastLabelDown={id:null,t:0,x:0,y:0};
const labelFocus2d=createFocusTracker(()=>requestOverlayDraw()); // the lit label (hover / drag): the overlay is redrawn only when it changes
function installLabelDrag2d(){
 for(const p of Object.keys(labelHits)){
  const cv=planes[p].canvas,host=cv.closest('.view-card')||cv.parentElement;if(!host)continue;
  host.addEventListener('pointermove',e=>{ // hover (mouse / pen)
   if(e.pointerType==='touch'||e.buttons)return;
   const ov=document.getElementById(p+'-crosshair');if(!ov||!getMarkersShown()){labelFocus2d.hover(null);return}
   const o=ov.getBoundingClientRect(),x=e.clientX-o.left,y=e.clientY-o.top,L=labelHits[p].find(l=>x>=l.x&&x<=l.x+l.w&&y>=l.y&&y<=l.y+l.h);
   labelFocus2d.hover(L&&!hits[p].some(h=>Math.hypot(h.x-x,h.y-y)<=h.r)?L.id:null);
  });
  host.addEventListener('pointerleave',()=>labelFocus2d.hover(null));
  host.addEventListener('pointerdown',e=>{
   if(e.pointerType==='mouse'&&e.button!==0)return;
   const ov=document.getElementById(p+'-crosshair');if(!ov||!getMarkersShown())return;
   const o=ov.getBoundingClientRect(),x=e.clientX-o.left,y=e.clientY-o.top,L=labelHits[p].find(l=>x>=l.x&&x<=l.x+l.w&&y>=l.y&&y<=l.y+l.h);
   if(!L)return;
   if(hits[p].some(h=>Math.hypot(h.x-x,h.y-y)<=h.r))return; // a point under the press wins (its tap / long press / menu)
   const dims=dimsOf(),m=getMeasurements().find(q=>q.id===L.id);if(!dims||!m)return;
   e.stopPropagation();e.preventDefault();
   if(lastLabelDown.id===L.id&&e.timeStamp-lastLabelDown.t<350&&Math.hypot(e.clientX-lastLabelDown.x,e.clientY-lastLabelDown.y)<12){lastLabelDown={id:null,t:0,x:0,y:0};setLabelOffset(L.id,null);return} // double tap / click: back to the default place
   lastLabelDown={id:L.id,t:e.timeStamp,x:e.clientX,y:e.clientY};
   const project=v=>planePointFromVoxel(p,v,dims);
   // the offset the label stands at now (a default label: from where it is drawn), then every move adds the voxel change of the pixel change
   labelFocus2d.drag(L.id);
   const off0=m.labelOffset||planeVoxelDelta(project,(L.lx-L.mx)/L.iw,(L.ly-L.my)/L.ih),sx=e.clientX,sy=e.clientY,pid=e.pointerId;
   const move=ev=>{if(ev.pointerId!==pid)return;const d=planeVoxelDelta(project,(ev.clientX-sx)/L.iw,(ev.clientY-sy)/L.ih);ev.stopPropagation();setLabelOffset(L.id,{i:off0.i+d.i,j:off0.j+d.j,k:off0.k+d.k})};
   const up=ev=>{if(ev.pointerId!==pid)return;labelFocus2d.drag(null);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true)};
   document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);
  },true);
 }
}
let pulseTimer=0;
function syncPulse(){
 const on=!!getMeasureStart();
 if(on&&!pulseTimer)pulseTimer=setInterval(requestOverlayDraw,90);
 else if(!on&&pulseTimer){clearInterval(pulseTimer);pulseTimer=0}
 requestOverlayDraw();
}

// ---- markers (drawn on the crosshair overlay canvases, never on the slice canvases) ----
function paintMarkers(ctx,p,g){
 hits[p]=[];labelHits[p]=[];if(!ctx||!getMarkersShown()||!volume)return;
 const fp=fingerprint(),dims=dimsOf();if(!fp||!dims)return;
 const ms=commentMarkers(p,getComments(),fp,+planes[p].slider.value,dims);if(!ms.length)return;
 const ipad=document.documentElement.classList.contains('vrl-ipad-ui'),R=ipad?10:8,r=R*0.7; // smaller marks (were 11 / 13 px, like the small VR markers); the tap area below stays at least 16 / 22 px
 ms.sort((a,b)=>a.exact-b.exact); // faint ones first, exact ones on top
 paintMeasures(ctx,ms,g,p);
 for(const m of ms){
  const x=g.x0+m.fx*g.w,y=g.y0+m.fy*g.h;
  if(m.exact){
   ctx.beginPath();ctx.arc(x,y,R,0,Math.PI*2);ctx.fillStyle=m.color;ctx.fill();ctx.lineWidth=2.5;ctx.strokeStyle='rgba(0,0,0,.75)';ctx.stroke();
   ctx.fillStyle=inkOn(m.color);ctx.font='800 '+(R*1.05)+'px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(m.number),x,y+0.5);
   hits[p].push({id:m.id,x,y,r:Math.max(R,ipad?22:16)});
   if(m.id===getMeasureStart())paintStart(ctx,x,y,R,ipad); // the START of a distance (pulsing ring + hint)
  }else{ // a few slices away: a thin ring (dark halo under a light one), no number
   ctx.globalAlpha=.55;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.lineWidth=4;ctx.strokeStyle='rgba(0,0,0,.6)';ctx.stroke();ctx.lineWidth=1.8;ctx.strokeStyle=m.color;ctx.stroke();ctx.globalAlpha=1;
  }
 }
}
function closeBubble(){clearTimeout(bubbleTimer);if(bubble)bubble.hidden=true;listEl?.querySelectorAll('.is-highlight').forEach(e=>e.classList.remove('is-highlight'))}
function showBubble(p,hit){
 const c=getComments().find(x=>x.id===hit.id);if(!c)return;
 const card=planes[p].canvas.closest('.view-card');if(!card)return;
 if(!bubble){bubble=document.createElement('div');bubble.className='comment-bubble';bubble.setAttribute('role','status');bubble.innerHTML='<b class="comment-bubble-no"></b><span class="comment-bubble-text"></span>'}
 if(bubble.parentNode!==card)card.appendChild(bubble);
 const n=getComments().findIndex(x=>x.id===hit.id)+1;
 bubble.querySelector('.comment-bubble-no').textContent=n;bubble.querySelector('.comment-bubble-text').textContent=c.text||'—';
 bubble.hidden=false;
 const cv=document.getElementById(p+'-crosshair'),cr=cv.getBoundingClientRect(),kr=card.getBoundingClientRect();
 const bw=Math.min(260,kr.width-16);bubble.style.maxWidth=bw+'px';
 bubble.style.left=Math.max(8,Math.min(kr.width-bw-8,hit.x+cr.left-kr.left-bw/2))+'px';
 const y=hit.y+cr.top-kr.top;bubble.style.top=Math.max(8,y+22)+'px';
 listEl?.querySelectorAll('.is-highlight').forEach(e=>e.classList.remove('is-highlight'));
 listEl?.querySelector('[data-comment-id="'+CSS.escape(hit.id)+'"]')?.classList.add('is-highlight');
 clearTimeout(bubbleTimer);bubbleTimer=setTimeout(closeBubble,7000);
}
// Tap on a marker: listeners are ADDED (app.js keeps its own pointer handlers), nothing is prevented or stopped, and a tap that moved
// (a swipe) or is made in crosshair mode is ignored, so slice swiping and crosshair placement behave as before.
function installMarkerTap(){
 for(const p of Object.keys(hits)){
  const cv=planes[p].canvas;let d=null;
  const hitAt=(cx,cy)=>{
   const o=document.getElementById(p+'-crosshair').getBoundingClientRect(),x=cx-o.left,y=cy-o.top;
   let best=null,bd=1e9;for(const h of hits[p]){const dd=Math.hypot(h.x-x,h.y-y);if(dd<=h.r&&dd<bd){best=h;bd=dd}}
   return best;
  };
  cv.addEventListener('pointerdown',e=>{
   clearTimeout(d?.timer);
   const lp=createLongPress({ms:450}),hit=e.button===0||e.pointerType==='touch'?hitAt(e.clientX,e.clientY):null;lp.down(e.clientX,e.clientY,performance.now());
   d={id:e.pointerId,x:e.clientX,y:e.clientY,lp,timer:0,hit};
   // long press on a mark (touch long press / mouse press-and-hold) opens the point menu
   if(hit&&!crosshairModeActive()&&getMarkersShown()){const mine=d;mine.timer=setTimeout(()=>{if(d===mine&&mine.lp.tick(performance.now())==='long')openPointMenu({id:mine.hit.id,x:mine.x,y:mine.y})},500)}
  });
  cv.addEventListener('pointermove',e=>{if(d&&d.id===e.pointerId)d.lp.move(e.clientX,e.clientY)});
  cv.addEventListener('pointerup',e=>{
   const s=d;d=null;if(s)clearTimeout(s.timer);if(!s||s.id!==e.pointerId||crosshairModeActive()||!getMarkersShown())return;
   const r=s.lp.up();if(r==='long'||r==='moved')return; // the long press opened the menu: the release is not a tap
   if(Math.hypot(e.clientX-s.x,e.clientY-s.y)>6)return;
   const best=hitAt(e.clientX,e.clientY);
   if(getMeasureStart()){ // a distance is being measured: a point = its END, empty space = cancel (no bubble)
    if(best)endMeasureAt(best.id);else cancelMeasureUi();
    return;
   }
   if(best)showBubble(p,{...best});else if(bubble&&!bubble.hidden)closeBubble();
  });
  cv.addEventListener('pointercancel',()=>{if(d)clearTimeout(d.timer);d=null});
  // right-click on a mark: the same menu (the browser's own menu only when no mark is under the pointer)
  cv.addEventListener('contextmenu',e=>{
   if(crosshairModeActive()||!getMarkersShown())return;
   const best=hitAt(e.clientX,e.clientY);if(!best)return;
   e.preventDefault();if(d){clearTimeout(d.timer);d=null}openPointMenu({id:best.id,x:e.clientX,y:e.clientY});
  });
 }
}
// delete = remove + an "undo" that stays until the next add / delete / view (or 20 s): a click on a 6-12 px neighbour must not lose data
function clearUndo(){clearTimeout(undoTimer);lastDeleted=null;if(undoEl){undoEl.hidden=true}}
function deleteWithUndo(id){
 const index=getComments().findIndex(c=>c.id===id),c=getComments()[index];if(!c)return;
 const ms=measurementsOfPoint(id);removeComment(id);lastDeleted={c,index,ms}; // its distances are deleted with it (the cascade) and come back with the undo
 undoEl.querySelector('.comment-undo-text').textContent=tr('commentDeleted');undoEl.querySelector('.comment-undo-btn').textContent=tr('commentUndo');
 undoEl.hidden=false;noteEl.textContent='';clearTimeout(undoTimer);undoTimer=setTimeout(clearUndo,20000);
 undoEl.querySelector('.comment-undo-btn').focus(); // the delete button is gone: keep the keyboard focus inside the panel
}
function undoDelete(){
 const d=lastDeleted;if(!d)return;clearUndo();
 if(restoreComment(d.c,d.index)){restoreMeasurements(d.ms);listEl.querySelector('[data-comment-id="'+CSS.escape(d.c.id)+'"] .comment-view')?.focus()}
}
// edit = the text of that list item turns into an input in place; save keeps position / time / series (comments.js updateCommentText)
function startEdit(id){const c=getComments().find(x=>x.id===id);if(!c)return;clearUndo();noteEl.textContent='';editId=id;editDraft=c.text;editFocus=true;render()}
function stopEdit(id){const had=editId;editId=null;editDraft='';render();if(had)listEl.querySelector('[data-comment-id="'+CSS.escape(id||had)+'"] .comment-edit')?.focus()}
function saveEdit(id){
 if(updateCommentText(id,editDraft)===null){noteEl.textContent=tr('commentEmptyNotSaved');return} // blank: nothing changes, stay in the editor
 noteEl.textContent='';stopEdit(id); // (a changed text re-rendered the list already; an unchanged one did not)
}
// the 「距離」 section under the point list: "1 – 3  12.3 mm" + delete (the value follows the points' positions; ⚠ = slice spacing issue)
function renderMeasures(){
 if(!measListEl)return;
 measTitleEl.textContent=tr('measureTitle');measListEl.replaceChildren();
 const ms=getMeasurements(),cs=getComments(),fp=fingerprint(),sp=seriesSpacing(activeSeries),lvl=spacingLevel(activeSeries),warn=lvl==='warn';
 const mine=ms.filter(m=>{const a=cs.find(c=>c.id===m.a),b=cs.find(c=>c.id===m.b);return a&&b&&commentMatchesSeries(a,fp)&&commentMatchesSeries(b,fp)});
 measTitleEl.hidden=!mine.length&&!getMeasureStart();
 if(!mine.length){measListEl.hidden=true;return}
 measListEl.hidden=false;
 for(const m of mine){
  const li=document.createElement('li');li.className='measure-item';li.dataset.measureId=m.id;
  const badge=id=>{const c=cs.find(x=>x.id===id),b=document.createElement('span'),pc=pointColor(c);b.className='comment-no';b.textContent=String(cs.indexOf(c)+1);b.style.background=pc;b.style.borderColor=pc;b.style.color=inkOn(pc);return b};
  const sep=document.createElement('span');sep.className='measure-sep';sep.textContent='–';
  const val=document.createElement('strong');val.className='measure-value';val.textContent=measureLabel(measurementMm(m,cs,sp),warn);if(warn)val.title=tr('measureWarn');
  const note=lvl?document.createElement('span'):null;if(note){note.className='measure-note';note.textContent=warn?tr('measureWarnShort'):tr('measureUnverifiedShort');note.title=warn?tr('measureWarn'):tr('measureUnverified')}
  const del=document.createElement('button');del.type='button';del.className='tool-chip measure-delete';del.textContent=tr('commentDelete');del.title=tr('measureDeleteTitle');
  del.addEventListener('click',()=>removeMeasurement(m.id));
  li.append(badge(m.a),sep,badge(m.b),val);if(note)li.appendChild(note);li.appendChild(del);measListEl.appendChild(li);
 }
}
function fmtTime(iso){try{const d=new Date(iso);return isNaN(d)?'':d.toLocaleString(currentLanguage==='ja'?'ja-JP':'en-US',{dateStyle:'short',timeStyle:'short'})}catch{return''}}
function render(){
 if(!root)return;
 renderMeasures();
 const fp=fingerprint(),list=getComments(),ok=ready();
 addBtn.disabled=!ok;
 document.querySelectorAll('[data-comment-toggle]').forEach(b=>{b.disabled=!ok;b.title=tr('commentAddTitle')});
 if(!ok)closePopover();
 requestOverlayDraw();closeBubble();
 if(editId&&!list.some(c=>c.id===editId)){editId=null;editDraft=''}
 if(colorOpenId&&!list.some(c=>c.id===colorOpenId))colorOpenId=null;
 listEl.replaceChildren();
 if(!list.length){const e=document.createElement('p');e.className='comment-empty';e.textContent=tr('commentEmpty');listEl.appendChild(e);return}
 for(const c of list){
  const same=commentMatchesSeries(c,fp),li=document.createElement('li');li.className='comment-item';li.dataset.commentId=c.id;
  const body=document.createElement('div');body.className='comment-body';
  const no=document.createElement('span');no.className='comment-no';no.textContent=String(list.indexOf(c)+1);no.setAttribute('aria-hidden','true');
  const pc=pointColor(c);no.style.background=pc;no.style.borderColor=pc;no.style.color=inkOn(pc); // the number badge wears the point's colour
  const t=document.createElement('p');t.className='comment-text';t.textContent=c.text;
  const m=document.createElement('p');m.className='comment-meta';
  m.textContent=`i ${c.position.i} · j ${c.position.j} · k ${c.position.k}`+(c.createdAt?' · '+fmtTime(c.createdAt):'')+(same?'':' · '+tr('commentOtherSeries')+' · '+tr('commentNotSaved'));
  const editing=c.id===editId;
  if(editing){
   const ta=document.createElement('textarea');ta.className='comment-input comment-edit-input';ta.rows=2;ta.maxLength=COMMENT_MAX_TEXT;ta.value=editDraft;
   ta.setAttribute('aria-label',tr('commentEditLabel'));
   ta.addEventListener('input',()=>{editDraft=ta.value;if(noteEl.textContent===tr('commentEmptyNotSaved'))noteEl.textContent=''});
   // Esc cancels only this edit (not the crosshair mode / drawer); Ctrl/Cmd+Enter saves
   ta.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();noteEl.textContent='';stopEdit(c.id)}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();saveEdit(c.id)}});
   body.append(no,ta,m);
   const ea=document.createElement('div');ea.className='comment-actions';
   const sv=document.createElement('button');sv.type='button';sv.className='tool-chip comment-edit-save';sv.textContent=tr('commentSave');sv.addEventListener('click',()=>saveEdit(c.id));
   const cn=document.createElement('button');cn.type='button';cn.className='tool-chip comment-edit-cancel';cn.textContent=tr('commentCancel');cn.addEventListener('click',()=>{noteEl.textContent='';stopEdit(c.id)});
   ea.append(sv,cn);li.append(body,ea);listEl.appendChild(li);
   if(editFocus){editFocus=false;ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length)}
   continue;
  }
  body.append(no,t,m);
  const acts=document.createElement('div');acts.className='comment-actions';
  const view=document.createElement('button');view.type='button';view.className='tool-chip comment-view';view.textContent=tr('commentView');
  view.disabled=!same||!ok;view.title=same?'':tr('commentOtherSeriesTitle');
  view.addEventListener('click',()=>{clearUndo();const wasOn=crosshairModeActive(),at=viewComment(c.id);noteEl.textContent=at?tr('commentViewed')+(wasOn?'':tr('commentViewedModeOn')):''});
  const del=document.createElement('button');del.type='button';del.className='tool-chip comment-delete';del.textContent=tr('commentDelete');
  del.addEventListener('click',()=>deleteWithUndo(c.id));
  const ed=document.createElement('button');ed.type='button';ed.className='tool-chip comment-edit';ed.textContent=tr('commentEdit');
  ed.addEventListener('click',()=>startEdit(c.id));
  // colour swatch (tap = a small palette: 8 colours + back to auto); the choice is saved in the project with the point
  const sw=document.createElement('button');sw.type='button';sw.className='comment-color';sw.style.background=pc;sw.setAttribute('aria-haspopup','true');sw.setAttribute('aria-expanded',colorOpenId===c.id?'true':'false');
  const lang=currentLanguage==='ja'?'ja':'en';sw.setAttribute('aria-label',tr('commentColor')+' '+paletteName(pc,lang));sw.title=tr('commentColor');
  sw.addEventListener('click',()=>{colorOpenId=colorOpenId===c.id?null:c.id;render()});
  acts.append(view,ed,del,sw);li.append(body,acts);
  if(colorOpenId===c.id){
   const pal=document.createElement('div');pal.className='comment-color-palette';pal.setAttribute('role','group');pal.setAttribute('aria-label',tr('commentColor'));
   for(const p of POINT_PALETTE){
    const b=document.createElement('button');b.type='button';b.className='comment-color-opt'+(p.hex===pc?' is-current':'');b.style.background=p.hex;b.setAttribute('aria-label',lang==='ja'?p.ja:p.en);b.title=lang==='ja'?p.ja:p.en;
    b.addEventListener('click',()=>{colorOpenId=null;if(updateCommentColor(c.id,p.hex)===null)render()});pal.appendChild(b);
   }
   const au=document.createElement('button');au.type='button';au.className='tool-chip comment-color-auto';au.textContent=tr('commentColorAuto');au.title=autoPointColor(c);
   au.addEventListener('click',()=>{colorOpenId=null;if(updateCommentColor(c.id,null)===null)render()});pal.appendChild(au);
   li.appendChild(pal);
  }
  listEl.appendChild(li);
 }
}
export function refreshCommentsUi(){
 if(!root)return;
 root.querySelector('summary').textContent=tr('commentsTitle');
 root.querySelector('.comment-hint').textContent=tr('commentsHint');
 textEl.placeholder=tr('commentPlaceholder');textEl.setAttribute('aria-label',tr('commentPlaceholder'));addBtn.textContent=tr('commentAdd');
 if(pop){pop.setAttribute('aria-label',tr('commentAddShort'));popText.placeholder=tr('commentPlaceholder');popText.setAttribute('aria-label',tr('commentPlaceholder'));pop.querySelector('.comment-pop-save').textContent=tr('commentSave');pop.querySelector('.comment-pop-cancel').textContent=tr('commentCancel')}
 if(showEl)showEl.nextElementSibling.textContent=tr('commentShowMarkers');
 render();
}
// Toolbar "add comment" button (next to the crosshair button of each MPR card): a small popover inside that card, so it works on the iPad
// workspace UI without opening the drawer. Saving, the list and "view this place" stay in the panel. It records the position at the
// moment of saving (the same rule as the panel).
function closePopover(restoreFocus){
 clearTimeout(popTimer);if(!pop||pop.hidden)return;
 pop.hidden=true;document.querySelectorAll('[data-comment-toggle]').forEach(b=>b.setAttribute('aria-expanded','false'));
 if(restoreFocus&&popFrom?.isConnected)popFrom.focus();
}
function openPopover(btn){
 clearTimeout(popTimer);
 const card=btn.closest('.view-card');if(!card||!ready())return;
 if(pop.parentNode!==card)card.appendChild(pop);
 document.querySelectorAll('[data-comment-toggle]').forEach(b=>b.setAttribute('aria-expanded',b===btn?'true':'false'));
 popFrom=btn;popStatus.textContent='';popStatus.hidden=true;pop.querySelector('.comment-pop-form').hidden=false;
 const c=currentCommentPosition();popPos.textContent=c?tr('commentAtPos')+' i '+c.i+' · j '+c.j+' · k '+c.k:'';
 pop.hidden=false;popText.focus();
}
function savePopover(){
 const saved=addCommentHere(popText.value);if(!saved)return;
 popText.value='';clearUndo();
 pop.querySelector('.comment-pop-form').hidden=true;popStatus.textContent=tr('commentSaved')+' · i '+saved.position.i+' · j '+saved.position.j+' · k '+saved.position.k;popStatus.hidden=false;
 popTimer=setTimeout(()=>closePopover(true),1800);
}
function installPopover(){
 pop=document.createElement('div');pop.className='comment-popover';pop.setAttribute('role','dialog');pop.hidden=true;
 pop.innerHTML='<div class="comment-pop-form" style="display:grid;gap:6px"><p class="comment-pop-pos"></p><textarea class="comment-input" rows="2" maxlength="2000"></textarea><div class="comment-pop-actions"><button type="button" class="tool-chip comment-pop-save"></button><button type="button" class="tool-chip comment-pop-cancel"></button></div></div><p class="comment-pop-pos" role="status" hidden></p>';
 popText=pop.querySelector('.comment-input');popPos=pop.querySelector('.comment-pop-pos');popStatus=pop.querySelector('[role=status]');
 pop.querySelector('.comment-pop-save').addEventListener('click',savePopover);
 pop.querySelector('.comment-pop-cancel').addEventListener('click',()=>closePopover(true));
 // Esc closes only this popover (the crosshair mode keeps its own Esc); the key never reaches the document handler while typing
 pop.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closePopover(true)}});
 document.querySelectorAll('[data-comment-toggle]').forEach(b=>b.addEventListener('click',()=>{if(!pop.hidden&&popFrom===b)closePopover();else openPopover(b)}));
}
export function installComments(){
 const host=document.querySelector('.sidebar-scroll > .panel.compact-panel')||document.querySelector('.sidebar-scroll');
 if(!host||root)return;
 root=document.createElement('details');root.id='comment-panel';root.className='comment-panel';
 root.innerHTML='<summary></summary><p class="comment-hint"></p><label class="comment-show"><input type="checkbox" class="comment-show-input" checked><span></span></label><textarea class="comment-input" rows="2" maxlength="2000"></textarea><button type="button" class="tool-chip comment-add"></button><p class="comment-note" role="status"></p><div class="comment-undo" hidden role="status"><span class="comment-undo-text"></span> <button type="button" class="tool-chip comment-undo-btn"></button></div><ul class="comment-list"></ul><h4 class="measure-title"></h4><ul class="measure-list"></ul>';
 host.appendChild(root);
 showEl=root.querySelector('.comment-show-input');showEl.addEventListener('change',()=>setMarkersShown(showEl.checked));onMarkersShownChange(on=>{if(showEl.checked!==on)showEl.checked=on;closeBubble();requestOverlayDraw()});
 // the colour palette of a list row closes on a tap / click outside it and on Escape
 document.addEventListener('pointerdown',e=>{if(colorOpenId&&!e.target?.closest?.('.comment-color-palette,.comment-color')){colorOpenId=null;render()}},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&colorOpenId){colorOpenId=null;render()}});
 setOverlayPainter(paintMarkers);installMarkerTap();installLabelDrag2d();document.addEventListener('keydown',e=>{if(e.key==='Escape')closeBubble()});
 measTitleEl=root.querySelector('.measure-title');measListEl=root.querySelector('.measure-list');listEl=root.querySelector('.comment-list');textEl=root.querySelector('.comment-input');addBtn=root.querySelector('.comment-add');noteEl=root.querySelector('.comment-note');undoEl=root.querySelector('.comment-undo');
 undoEl.querySelector('.comment-undo-btn').addEventListener('click',undoDelete);
 addBtn.addEventListener('click',()=>{if(addCommentHere(textEl.value)){textEl.value='';clearUndo()}});
 onCommentsChange(render);onMeasurementsChange((_,info)=>{if(!info?.labelOnly)renderMeasures();requestOverlayDraw()}); // a label drag changes no list row: no DOM rebuild per move
 onMeasureStartChange(()=>{syncPulse();renderMeasures()});
 installPointMenu();setPointMenuHandlers({delete:id=>{deleteWithUndo(id);flashUndo(tr('commentDeleted'),tr('commentUndo'),undoDelete)}}); // the panel's own undo button is inside a closed <details>: the pill carries one too
  // (render() rebuilds the buttons: never on pointerdown, it would swallow the click that follows)
 root.addEventListener('toggle',render);
 // (no render on vrl-crosshairchange: the list does not depend on it, and rebuilding it made "view this place" lose the focus)
 document.addEventListener('vrl-serieschange',()=>{cancelMeasure();render()}); // a start set on the old series must not end on the new one
 const mo=typeof MutationObserver!=='undefined'?new MutationObserver(render):null;
 mo?.observe(planes.axial.slider,{attributes:true,attributeFilter:['disabled']});
 installPopover();
 refreshCommentsUi();
}
