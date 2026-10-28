// Position comments (stage 2): a comment = text + a place in the DATA (voxel indices {i,j,k}, like the linked
// crosshair in state.js: independent of zoom, pan or 3D rotation) + the series it was written on. Pure data and a small in-memory
// store, no DOM. They are saved in the project file (project.comments, see gatherProject / applyProject in data-load.js).
// A loaded project does NOT move any view by itself: a position is only used when the user presses "view this place".
import { clampVoxel, sliceIndexFor, planePointFromVoxel } from './crosshair.js?v=20261028-build683';
import { compareFingerprints } from './project-file.js?v=20261028-build683';
import { normalizeColor, pointColor, pointKey, normalizeAutoKey, textPointNumber } from './point-colors.js?v=20261028-build683';
export const COMMENT_MAX_TEXT=2000;
const isIdx=n=>Number.isFinite(+n)&&n!==null&&n!==''&&n!==true&&n!==false;
export const commentVoxel=v=>v&&isIdx(v.i)&&isIdx(v.j)&&isIdx(v.k)?{i:Math.round(+v.i),j:Math.round(+v.j),k:Math.round(+v.k)}:null;

let counter=0;
// autoKey: the stable number the auto colour comes from, fixed when the point is recorded (see point-colors.js pointKey)
export function createComment({text,position,series,now=Date.now(),id,autoKey}){
 const pos=commentVoxel(position);if(!pos)return null;
 return{id:id||('c'+now.toString(36)+'-'+(++counter)),text:String(text??'').slice(0,COMMENT_MAX_TEXT),createdAt:new Date(now).toISOString(),position:pos,series:series||null,...(normalizeAutoKey(autoKey)!==null?{autoKey}:{})};
}
// the next free key for a point added without a number (PC / iPad): one more than the highest key in use (stored keys and 「VR ポイント N」 numbers)
export const nextAutoKey=list=>1+Math.max(0,...(list||[]).map(c=>normalizeAutoKey(c?.autoKey)??textPointNumber(c?.text)??0));
// from a project file / anything untrusted: keep valid entries, drop the rest
export function sanitizeComments(list){
 if(!Array.isArray(list))return[];
 const out=[],seen=new Set();
 for(const c of list){
  const pos=commentVoxel(c?.position);if(!pos||!c||typeof c!=='object')continue;
  let id=typeof c.id==='string'&&c.id?c.id:'c-'+out.length;while(seen.has(id))id+='_';seen.add(id);
  const autoKey=normalizeAutoKey(c.autoKey),color=normalizeColor(c.color); // an optional colour chosen by the user; an invalid one is dropped (the point gets its auto colour)
  out.push({id,text:String(c.text??'').slice(0,COMMENT_MAX_TEXT),createdAt:typeof c.createdAt==='string'?c.createdAt:'',position:pos,series:c.series&&typeof c.series==='object'?c.series:null,...(autoKey!==null?{autoKey}:{}),...(color?{color}:{})});
 }
 return out;
}
// a comment can be shown only on the series it was written on (same fingerprint: seriesUid if both have one, size, spacing)
export const commentMatchesSeries=(comment,fingerprint)=>!!comment?.series&&!!fingerprint&&compareFingerprints(comment.series,fingerprint,{legacyZ:true}).ok;
// the voxel to move to: inside the volume (a position outside, e.g. from a coarser grid, is clamped, never rejected)
export const commentTarget=(comment,dims)=>{const p=commentVoxel(comment?.position);return p&&dims?clampVoxel(p,dims):null};

// Markers on the three MPR planes: the comments of the open series whose position lies on the slice on show (exact) or within
// `near` slices of it (faint, an aid to find the slice: a lesion spans several). The number is the place in the whole list (as in the panel).
export const COMMENT_NEAR_SLICES=3;
export function commentMarkers(plane,comments,fingerprint,sliceIdx,dims,near=COMMENT_NEAR_SLICES){
 const out=[];
 (comments||[]).forEach((c,n)=>{
  if(!commentMatchesSeries(c,fingerprint))return;
  const t=commentTarget(c,dims);if(!t)return;
  const delta=sliceIndexFor(plane,t)-Math.round(+sliceIdx);if(!(Math.abs(delta)<=near))return;
  const{fx,fy}=planePointFromVoxel(plane,t,dims);
  out.push({id:c.id,number:n+1,fx,fy,delta,exact:delta===0,color:pointColor(c)});
 });
 return out;
}

// ---- store ----
let list=[];
const listeners=new Set();
const emit=()=>{for(const cb of [...listeners]){try{cb(getComments())}catch(e){console.warn('comment listener failed',e)}}};
export const getComments=()=>list.map(c=>({...c,position:{...c.position}}));
export function addComment(c){if(!c)return null;list=[...list,c];emit();return c}
// edit the text only: position, createdAt and series stay as they are. Blank text is refused (null), unchanged text is not a change.
export function updateCommentText(id,text){
 const t=String(text??'').slice(0,COMMENT_MAX_TEXT);if(!t.trim())return null;
 const i=list.findIndex(c=>c.id===id);if(i<0)return null;
 if(list[i].text!==t){list=list.map((c,n)=>n===i?{...c,text:t,autoKey:pointKey(c)}:c);emit()} // the key is stored first, so the colour does not follow the new text
 return getComments()[i];
}
// move a point: the position only (id, text, createdAt and series stay). An invalid voxel or unknown id gives null, an unchanged position is not a change.
export function updateCommentPosition(id,position){
 const pos=commentVoxel(position);if(!pos)return null;
 const i=list.findIndex(c=>c.id===id);if(i<0)return null;
 const o=list[i].position;
 if(o.i!==pos.i||o.j!==pos.j||o.k!==pos.k){list=list.map((c,n)=>n===i?{...c,position:pos}:c);emit()}
 return getComments()[i];
}
// set / clear the colour of a point: a valid "#rrggbb" sets it, null / '' goes back to the auto colour; anything else is refused (null).
// Text, position, createdAt and series stay. An unchanged colour is not a change.
export function updateCommentColor(id,color){
 const none=color===null||color===undefined||color==='',col=none?null:normalizeColor(color);
 if(!none&&!col)return null;
 const i=list.findIndex(c=>c.id===id);if(i<0)return null;
 if((list[i].color||null)!==col){list=list.map((c,n)=>{if(n!==i)return c;const{color:_o,...rest}=c;return col?{...rest,color:col}:rest});emit()}
 return getComments()[i];
}
export function removeComment(id){const n=list.length;list=list.filter(c=>c.id!==id);if(list.length!==n)emit();return list.length!==n}
export function setComments(next){list=sanitizeComments(next);emit()}
// put a deleted comment back where it was (the "undo" of the delete button)
export function restoreComment(c,index=list.length){if(!c||list.some(x=>x.id===c.id))return false;const at=Math.max(0,Math.min(+index||0,list.length));list=[...list.slice(0,at),{...c,position:{...c.position}},...list.slice(at)];emit();return true}
// Loading a project must not throw away what is in memory and not in that file (a comment added after the last save, or one written on
// another series): other series stay as they are; for the project's own series the two sets are united by id (a comment deleted in
// memory since the save comes back: the side that loses no data). An id already used by a comment of another series gets a new one.
// idMap (optional object): filled with {fileId: newId} for every incoming comment that had to be renamed, so things that refer to a point by id (distances) can follow
export function mergeComments(current,incoming,fingerprint,idMap=null){
 const keep=current.filter(c=>!commentMatchesSeries(c,fingerprint)),same=current.filter(c=>commentMatchesSeries(c,fingerprint));
 const ids=new Set(current.map(c=>c.id)),add=[];
 for(const c of sanitizeComments(incoming)){
  if(same.some(x=>x.id===c.id))continue;
  let id=c.id;while(ids.has(id))id+='_';ids.add(id);if(idMap&&id!==c.id)idMap[c.id]=id;add.push({...c,id});
 }
 return[...keep,...same,...add];
}
// returns the id map of renamed comments ({fileId: newId}, usually empty)
export function loadProjectComments(incoming,fingerprint){
 const inc=sanitizeComments(incoming),idMap={};
 list=mergeComments(list,inc,fingerprint,idMap);
 // what the file now holds for this series (other files' comments stay as they were)
 for(const [id,e] of [...saved])if(commentMatchesSeries({series:e.series},fingerprint))saved.delete(id);
 for(const c of inc)saved.set(c.id,{sig:sigOf(c),series:c.series});
 emit();
 return idMap;
}
// ---- unsaved changes: what was last written to / read from a project file, against what is in memory now ----
const sigOf=c=>[c.id,c.text,c.position.i,c.position.j,c.position.k,c.color||'',pointKey(c)].join('|');
const saved=new Map();
export function markCommentsSaved(fingerprint,written=commentsForProject(fingerprint)){
 for(const [id,e] of [...saved])if(commentMatchesSeries({series:e.series},fingerprint))saved.delete(id);
 for(const c of written)saved.set(c.id,{sig:sigOf(c),series:c.series});
}
export function hasUnsavedComments(){
 const now=getComments();
 if(now.some(c=>saved.get(c.id)?.sig!==sigOf(c)))return true;
 const ids=new Set(now.map(c=>c.id));
 for(const id of saved.keys())if(!ids.has(id))return true;
 return false;
}
export const resetCommentsSaved=()=>saved.clear();
// "show the positions on the images": one switch for the 2D overlays and the 3D markers (a view setting, not saved in the project)
let markersShown=true;
const shownListeners=new Set();
export const getMarkersShown=()=>markersShown;
export function setMarkersShown(on){const v=!!on;if(v===markersShown)return;markersShown=v;for(const cb of [...shownListeners]){try{cb(v)}catch(e){console.warn('marker listener failed',e)}}}
export const onMarkersShownChange=cb=>{shownListeners.add(cb);return()=>shownListeners.delete(cb)};
export const onCommentsChange=cb=>{listeners.add(cb);return()=>listeners.delete(cb)};
// for the project file: only what belongs to the series being saved
export const commentsForProject=fingerprint=>getComments().filter(c=>commentMatchesSeries(c,fingerprint));
