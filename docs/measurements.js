// Two-point distances between recorded points. A measurement = {id, a, b}: the ids of two position comments (points).
// The distance is NOT stored: it is computed from the two voxel positions and the volume's voxel spacing (the adopted spacing, series.spacingX/Y/Z),
// so moving a point changes the value by itself. Pure data + a small in-memory store, no DOM / three.js (the VR and PC / iPad views share it).
// Saved in the project as `measurements` (an unknown field for older apps: they ignore it, so the project version is not bumped).
import { getComments, onCommentsChange, commentVoxel, commentMatchesSeries } from './comments.js?v=20261022-build653';
import { compareFingerprints } from './project-file.js?v=20261022-build653';
import { spacingWarningText } from './slice-spacing.js?v=20261022-build653';
export const MEASURE_MAX=500;

// ---- distance ----
// voxel centres a, b ({i,j,k}) and the spacing [sx,sy,sz] (mm) -> millimetres, or null (a bad voxel). A missing / non-positive spacing counts as 1 (the same fallback as the loaders).
export function distanceMm(a,b,spacing){
 const va=commentVoxel(a),vb=commentVoxel(b);if(!va||!vb)return null;
 const s=[0,1,2].map(n=>{const x=+(spacing?.[n]);return Number.isFinite(x)&&x>0?x:1});
 return Math.hypot((va.i-vb.i)*s[0],(va.j-vb.j)*s[1],(va.k-vb.k)*s[2]);
}
// 1 decimal, 2 below 10 mm ("3.46 mm", "12.3 mm")
export const formatMm=mm=>Number.isFinite(mm)?(mm<10?mm.toFixed(2):mm.toFixed(1))+' mm':'—';
// the label of a distance; warn = the series has a slice-spacing warning (z is approximate): "⚠ 12.3 mm"
export const measureLabel=(mm,warn)=>(warn?'⚠ ':'')+formatMm(mm);
// the series' voxel spacing [x,y,z] (mm); the comments' voxel grid is the series grid
export const seriesSpacing=s=>[s?.spacingX,s?.spacingY,s?.spacingZ];
// warn-level slice-spacing check only (the same split as vr-spacing-note.js / analysis-results.js)
export const spacingWarns=s=>spacingWarningText(s?.spacingCheck)?.level==='warn';
// the distance of a measurement over a list of comments (null when a point is missing)
export function measurementMm(m,comments,spacing){
 const a=(comments||[]).find(c=>c.id===m?.a),b=(comments||[]).find(c=>c.id===m?.b);
 return a&&b?distanceMm(a.position,b.position,spacing):null;
}

// two points belong to the same series (a distance between series makes no sense: different voxel grids, never saved)
export const pointsShareSeries=(a,b)=>!!a?.series&&!!b?.series&&compareFingerprints(a.series,b.series,{legacyZ:true}).ok;
// the note for a series' spacing check: 'warn' (z approximate: ⚠), 'info' (the tag spacing is unverified) or null
export const spacingLevel=s=>spacingWarningText(s?.spacingCheck)?.level||null;

// ---- the label offset ----
// The label of a distance starts NEAR the line (each view's default placement) and can be moved by the user at any time (a drag in the 3D / 2D views, a grab in VR).
// A moved label is stored as `labelOffset` {i,j,k}: the vector from the line's midpoint to the label, in VOXEL units (floats), so it is the same in every view and survives
// a reload; no field = the default placement. Anything invalid is dropped (-> default).
export const LABEL_OFFSET_MAX=1e4;
export function normalizeLabelOffset(o){
 if(!o||typeof o!=='object')return null;
 const v=[o.i,o.j,o.k].map(x=>typeof x==='number'?x:NaN);
 if(!v.every(x=>Number.isFinite(x)&&Math.abs(x)<=LABEL_OFFSET_MAX))return null;
 return{i:Math.round(v[0]*1000)/1000,j:Math.round(v[1]*1000)/1000,k:Math.round(v[2]*1000)/1000};
}
const withOffset=(m,o)=>{const lo=normalizeLabelOffset(o);return lo?{...m,labelOffset:lo}:m};
const cp=m=>withOffset({id:m.id,a:m.a,b:m.b},m.labelOffset);
const sigOf=m=>pairKey(m.a,m.b)+(m.labelOffset?'|'+m.labelOffset.i+','+m.labelOffset.j+','+m.labelOffset.k:'');

// ---- sanitize ----
// from a project file / anything untrusted: keep {id,a,b} entries whose two points exist (validIds: a Set / array of point ids) and differ, drop the rest, no duplicate id or pair
export function sanitizeMeasurements(list,validIds){
 if(!Array.isArray(list))return[];
 const ok=validIds instanceof Set?validIds:new Set(validIds||[]),out=[],ids=new Set(),pairs=new Set();
 for(const m of list){
  if(!m||typeof m!=='object'||typeof m.a!=='string'||typeof m.b!=='string'||!m.a||!m.b||m.a===m.b||!ok.has(m.a)||!ok.has(m.b))continue;
  const pair=pairKey(m.a,m.b);if(pairs.has(pair))continue;
  let id=typeof m.id==='string'&&m.id?m.id:'m-'+out.length;while(ids.has(id))id+='_';
  ids.add(id);pairs.add(pair);out.push(withOffset({id,a:m.a,b:m.b},m.labelOffset));
  if(out.length>=MEASURE_MAX)break;
 }
 return out;
}
const pairKey=(a,b)=>a<b?a+'\n'+b:b+'\n'+a;

// ---- store ----
let list=[],counter=0;
const listeners=new Set();
// info {labelOnly:true}: only a label offset changed (a drag): a list view need not rebuild, a drawing view redraws
const emit=info=>{for(const cb of [...listeners]){try{cb(getMeasurements(),info)}catch(e){console.warn('measurement listener failed',e)}}};
export const getMeasurements=()=>list.map(cp);
export const onMeasurementsChange=cb=>{listeners.add(cb);return()=>listeners.delete(cb)};
export const measurementsOfPoint=id=>list.filter(m=>m.a===id||m.b===id).map(cp);
// a new measurement between two existing, different points; the same pair again returns the existing one (no duplicates). null = refused.
export function addMeasurement(a,b,{now=Date.now(),id}={}){
 if(!a||!b||a===b||list.length>=MEASURE_MAX)return null;
 const cs=getComments(),ca=cs.find(c=>c.id===a),cb=cs.find(c=>c.id===b);if(!ca||!cb||!pointsShareSeries(ca,cb))return null;
 const same=list.find(m=>pairKey(m.a,m.b)===pairKey(a,b));if(same)return{...cp(same),existed:true};
 const m={id:id||('m'+now.toString(36)+'-'+(++counter)),a,b};
 list=[...list,m];emit();return cp(m);
}
export function removeMeasurement(id){const n=list.length;list=list.filter(m=>m.id!==id);if(list.length!==n)emit();return list.length!==n}
// put measurements back (the undo of a delete / of a point's deletion): only those whose points exist, not duplicating an id or pair
export function restoreMeasurements(ms){
 const cs=getComments(),ids=new Set(cs.map(c=>c.id)),have=new Set(list.map(m=>m.id)),pairs=new Set(list.map(m=>pairKey(m.a,m.b)));let n=0;
 for(const m of ms||[]){
  if(!m||!ids.has(m.a)||!ids.has(m.b)||m.a===m.b||have.has(m.id)||pairs.has(pairKey(m.a,m.b)))continue;
  if(!pointsShareSeries(cs.find(c=>c.id===m.a),cs.find(c=>c.id===m.b)))continue;
  list=[...list,cp(m)];have.add(m.id);pairs.add(pairKey(m.a,m.b));n++;
 }
 if(n)emit();return n>0;
}
// move the label (offset {i,j,k} in voxel units from the midpoint) or null = back to the default placement; an unchanged value is not a change
export function setLabelOffset(id,offset){
 const i=list.findIndex(m=>m.id===id);if(i<0)return false;
 const lo=normalizeLabelOffset(offset),old=list[i].labelOffset;
 if(offset!==null&&offset!==undefined&&!lo)return false;
 if((old?old.i+','+old.j+','+old.k:'')===(lo?lo.i+','+lo.j+','+lo.k:''))return true;
 const{labelOffset:_o,...rest}=list[i];list=list.map((m,n)=>n===i?withOffset(rest,lo):m);emit({labelOnly:true});return true;
}
// deleting a point deletes its measurements (the 2D list, VR and a project load all end here); a pending start that vanished is dropped too
onCommentsChange(cs=>{
 const ids=new Set(cs.map(c=>c.id)),n=list.length;
 list=list.filter(m=>ids.has(m.a)&&ids.has(m.b));
 const lostStart=!!measureStart&&!ids.has(measureStart);if(lostStart)measureStart=null;
 if(list.length!==n)emit();
 if(lostStart)emitStart();
});

// ---- project file ----
// the measurements whose two points are both in `ids` (the points saved with the file: the open series' comments)
export const measurementsForProject=ids=>{const s=ids instanceof Set?ids:new Set(ids||[]);return list.filter(m=>s.has(m.a)&&s.has(m.b)).map(cp)};
// merged with what is in memory (by id and by pair), never replacing: entries of other series stay. Call it AFTER the comments are loaded (it checks the point ids).
// idMap: {fileId: newId} of the points loadProjectComments had to rename, so an entry follows its points.
export function loadProjectMeasurements(incoming,idMap=null){
 const remap=id=>idMap&&typeof id==='string'&&Object.prototype.hasOwnProperty.call(idMap,id)?idMap[id]:id;
 const cs=getComments(),ok=new Set(cs.map(c=>c.id));
 const inc=sanitizeMeasurements((Array.isArray(incoming)?incoming:[]).map(m=>m&&typeof m==='object'?{...m,a:remap(m.a),b:remap(m.b)}:m),ok)
  .filter(m=>pointsShareSeries(cs.find(c=>c.id===m.a),cs.find(c=>c.id===m.b)));
 const have=new Set(list.map(m=>m.id)),pairs=new Set(list.map(m=>pairKey(m.a,m.b))),add=[];
 for(const m of inc){
  const exist=list.find(x=>pairKey(x.a,x.b)===pairKey(m.a,m.b));
  if(exist){markSaved(exist);continue} // the pair is already in memory (maybe under another id): that one counts as saved
  let id=m.id;while(have.has(id))id+='_';have.add(id);pairs.add(pairKey(m.a,m.b));add.push({...m,id});
 }
 if(add.length)list=[...list,...add].slice(0,MEASURE_MAX);
 for(const m of add)markSaved(m);
 if(add.length)emit();
}
// unsaved changes, per series like comments.js: what the file last held {pair, series} against what is in memory
const saved=new Map();
const seriesOf=m=>getComments().find(c=>c.id===m.a)?.series||null;
const markSaved=m=>saved.set(m.id,{pair:sigOf(m),series:seriesOf(m)});
export function markMeasurementsSaved(fingerprint,written=measurementsForProject(new Set(getComments().filter(c=>commentMatchesSeries(c,fingerprint)).map(c=>c.id)))){
 for(const [id,e] of [...saved])if(commentMatchesSeries({series:e.series},fingerprint))saved.delete(id);
 for(const m of written)markSaved(m);
}
export function hasUnsavedMeasurements(){
 if(list.some(m=>saved.get(m.id)?.pair!==sigOf(m)))return true;
 const ids=new Set(list.map(m=>m.id));
 for(const id of saved.keys())if(!ids.has(id))return true;
 return false;
}

// ---- the shared flow: 距離 on a point -> that point is the START -> the next point picked is the END ----
// One state for the VR and the PC / iPad views (the same UX). start(id) arms it; pick(id) -> {kind:'created'|'existed'|'same'|'refused', ...}; cancel().
let measureStart=null;
const startListeners=new Set();
const emitStart=()=>{for(const cb of [...startListeners]){try{cb(measureStart)}catch(e){console.warn('measure start listener failed',e)}}};
export const getMeasureStart=()=>measureStart;
export const onMeasureStartChange=cb=>{startListeners.add(cb);return()=>startListeners.delete(cb)};
export function startMeasure(id){
 if(!id||!getComments().some(c=>c.id===id))return false;
 if(measureStart!==id){measureStart=id;emitStart()}
 return true;
}
export function cancelMeasure(){if(measureStart===null)return false;measureStart=null;emitStart();return true}
// the END point was chosen. Choosing the start again changes nothing (still armed); a refused / failed pair keeps it armed too. A created / existing pair finishes the flow.
export function pickMeasureEnd(id){
 const a=measureStart;if(!a)return{kind:'none'};
 if(id===a)return{kind:'same',a};
 {const cs=getComments(),ca=cs.find(c=>c.id===a),cb=cs.find(c=>c.id===id);if(ca&&cb&&!pointsShareSeries(ca,cb))return{kind:'other-series',a};} // another series: refused, still armed
 const m=addMeasurement(a,id);if(!m)return{kind:'refused',a};
 measureStart=null;emitStart();
 return m.existed?{kind:'existed',a,b:id,m}:{kind:'created',a,b:id,m};
}
// listeners for the cascade above are registered at import; this is only for tests / a series reset
export const resetMeasurements=()=>{list=[];saved.clear();if(measureStart!==null){measureStart=null;emitStart()}emit()};

// ---- the point menu of the PC / iPad (the same items as the VR point ring, minus 移動 which has no placement tool on the PC) ----
export const POINT_MENU_ITEMS=Object.freeze(['distance','color','delete']);
// long press on a point (touch long press, or mouse press-and-hold; right-click opens the menu directly). Pure state machine:
//   down(x,y,t) -> arms;  move(x,y) -> a move beyond `slop` px cancels the long press (a drag / swipe);  tick(t) -> 'long' once after `ms`;
//   up() -> 'long' (the menu was opened: the release must not act as a tap) | 'tap' | 'moved' | null (nothing was pressed).
export function createLongPress({ms=500,slop=6}={}){
 let s=null;
 return{
  down(x,y,t){s={x,y,t,moved:false,fired:false}},
  move(x,y){if(s&&Math.hypot(x-s.x,y-s.y)>slop)s.moved=true},
  tick(t){if(!s||s.fired||s.moved||t-s.t<ms)return null;s.fired=true;return'long'},
  up(){const r=s;s=null;return!r?null:r.fired?'long':r.moved?'moved':'tap'},
  cancel(){s=null},
  get active(){return s!==null},
  get fired(){return !!s&&s.fired},
 };
}
