// Analysis result labels: the label of an analysis result (colour, number, segments, volume) pinned at a point of the volume, in VR and on the PC / iPad 3D view,
// and MOVABLE in both. Pure functions (no DOM, no three.js); the label lives on the analysis region itself (region.label), so it is saved in the project with the
// region, follows the region's removal for free and is the same object for every view.
//   label = { anchor:{i,j,k}, offset?:{i,j,k} }
//   anchor : the point the label refers to, in VOXEL units of the data (floats, voxel centres at +.5 as in voxelToLocal / voxelToLocal3D)
//   offset : where the user left the label, as the vector from the anchor in VOXEL units (the same convention as a distance label's labelOffset in measurements.js), so it does not
//            depend on the model's move / rotation / scale and is the same in VR and on the PC. No offset = the view's default placement (beside the anchor, facing the viewer).
// A leader line joins a moved label to its anchor (leaderVisible).
import { stepDelta, offsetFromDelta } from './measure-label.js?v=20261112-build720';

export const ANALYSIS_LABEL_MAX=1e4; // |component| limit (voxels): anything beyond is a corrupt file, dropped
const num=(x)=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=ANALYSIS_LABEL_MAX;
const r3=x=>Math.round(x*1000)/1000;
const vec=o=>{if(!o||typeof o!=='object')return null;const{i,j,k}=o;return num(i)&&num(j)&&num(k)?{i:r3(i),j:r3(j),k:r3(k)}:null};
// untrusted input (a project file) or a fresh label -> a clean label, or null (no / invalid anchor = no label; an invalid offset = the default placement)
export function normalizeAnalysisLabel(l){
 const anchor=vec(l?.anchor);if(!anchor)return null;
 const offset=vec(l?.offset);
 return offset?{anchor,offset}:{anchor};
}
export const sameVec=(a,b)=>(a?a.i+','+a.j+','+a.k:'')===(b?b.i+','+b.j+','+b.k:'');
export const sameLabel=(a,b)=>sameVec(a?.anchor,b?.anchor)&&sameVec(a?.offset,b?.offset);
export const hasOffset=l=>!!vec(l?.offset);
// the leader (label -> anchor) is shown once the label was moved away from its default place (a zero offset has nothing to lead)
export const leaderVisible=l=>{const o=vec(l?.offset);return !!o&&(Math.abs(o.i)>1e-6||Math.abs(o.j)>1e-6||Math.abs(o.k)>1e-6)};
// a label with a new offset (null = back to the default); the anchor is kept. Returns the clean label (a new object) or null for an invalid label.
export function withOffset(l,offset){
 const a=vec(l?.anchor);if(!a)return null;
 const o=offset==null?null:vec(offset);if(offset!=null&&!o)return null; // an invalid offset is refused, not "reset"
 return o?{anchor:a,offset:o}:{anchor:a};
}

// ---- data space <-> a view's local space ----
// step = the view's change per voxel along i / j / k: PC 3D [sx*k,-sy*k,sz*k] (comment-3d.js voxelStep3d), VR [2hx/cols,-2hy/rows,2hz/slices] (vr-measure.js voxelStep)
// the label's place in the view's local space: the anchor's local point + the offset in that view's units
export function labelLocal(anchorLocal,offset,step){
 const d=offset?stepDelta(offset,step):{x:0,y:0,z:0};
 return{x:anchorLocal.x+d.x,y:anchorLocal.y+d.y,z:anchorLocal.z+d.z};
}
// the offset (voxel units) that puts the label at `p` (the view's local space), given the anchor's local point
export const offsetForLocal=(anchorLocal,p,step)=>offsetFromDelta({x:p.x-anchorLocal.x,y:p.y-anchorLocal.y,z:p.z-anchorLocal.z},step);

// VR local (vr-point.js voxelToLocal) -> voxel (floats). halfExt = half extents of the box; dims {columns,rows,slices}
export function voxelFromLocalVr(p,halfExt,dims){
 return{i:(p.x/(2*halfExt[0])+.5)*dims.columns-.5,j:(.5-p.y/(2*halfExt[1]))*dims.rows-.5,k:(p.z/(2*halfExt[2])+.5)*dims.slices-.5};
}
// PC 3D local (crosshair.js voxelToLocal3D) -> voxel (floats)
export function voxelFromLocal3d(p,dims,spacing){
 const[sx,sy,sz]=spacing||[1,1,1],px=dims.columns*sx,py=dims.rows*sy,pz=dims.slices*sz,scale=3.3/Math.max(px,py,pz,1);
 return{i:(p.x/scale+px/2)/sx-.5,j:(-p.y/scale+py/2)/sy-.5,k:(p.z/scale+pz/2)/sz-.5};
}
// a voxel inside the dims (anchors are clamped so a label whose region was edited / a corrupt value never lies far outside the volume)
export function clampVoxel(v,dims){
 const c=(x,n)=>Math.min(Math.max(x,-.5),n-.5);
 return{i:c(v.i,dims.columns),j:c(v.j,dims.rows),k:c(v.k,dims.slices)};
}

// ---- state (on the region) ----
// regions: the analysisRegions array (or any list of {id,label?}). Changes are announced to the views (onAnalysisLabelsChange), which redraw.
const listeners=new Set();
export const onAnalysisLabelsChange=cb=>{listeners.add(cb);return()=>listeners.delete(cb)};
export const emitAnalysisLabelsChange=info=>{for(const cb of [...listeners])cb(info)};
const ownerOf=r=>r.labelOwner||r;
export function setRegionLabel(region,label){
 if(!region)return false;
 const o=ownerOf(region);
 if(label==null){if(!o.label)return true;delete o.label;emitAnalysisLabelsChange({id:region.id});return true}
 const l=normalizeAnalysisLabel(label);if(!l)return false;
 if(sameLabel(o.label,l))return true;
 o.label=l;emitAnalysisLabelsChange({id:region.id});return true;
}
// move the label (offset in voxel units from the anchor) or null = the default place; an unchanged value is not a change. labelOnly: only the place changed (a redraw, no re-judgement of anything else)
export function setRegionLabelOffset(region,offset){
 if(!region?.label)return false;
 const o=ownerOf(region),next=withOffset(o.label,offset);if(!next)return false;
 if(sameLabel(o.label,next))return true;
 const toggled=leaderVisible(o.label)!==leaderVisible(next);
 o.label=next;emitAnalysisLabelsChange({id:region.id,labelOnly:true,moveToggled:toggled}); // moveToggled: moved <-> default changed (a button state follows it)
 return true;
}
// the label of a region for the project file (a clean copy) / for a snapshot, or undefined
export const labelForProject=region=>normalizeAnalysisLabel(region?.label)||undefined;

// a result's label follows its segments' visibility (VR; the PC 3D view gets it through analysisRegionShown): shown while the result has no segment, or at least one of its segments
// is shown (`isShown(key)`); hidden while all of them are hidden. Nothing about the label changes (its anchor / moved place stay), so showing the segment again brings it back where it was.
export const labelSegmentsShown=(segmentKeys,isShown)=>!segmentKeys?.length||segmentKeys.some(k=>isShown(k));

export const glowRid=(enabled,visible,hitRid,onLabel)=>enabled&&visible&&!onLabel&&hitRid?hitRid:0;

export function createBoneGlow(onChange){
 let seq=0,cur=0;
 const set=v=>{if(v!==cur){const p=cur;cur=v;if(onChange)onChange(v,p)}};
 return{get:()=>cur,ticket:()=>++seq,clear(){seq++;set(0)},settle(tok,rid){if(tok===seq)set(rid||0)}};
}
// may a bone pick run for this pointer state? touch / a pressed button (rotate, pan, a drag) / a target that is not the 3D canvas (menu, panel, dock) / a label card under the pointer (that card is lit by its own rule) /
// the gate (analysis select mode with a volume pick available) / no shown result with a label: no.
export const boneHoverPickable=({touch,buttons,onCanvas,overLabel,gate,labelled})=>!touch&&!buttons&&!!onCanvas&&!overLabel&&!!gate&&!!labelled;
// the shown result with a label that owns a picked voxel (the pick's segment key must be one of the result's segments, as the click-to-select rule); regions = [{id,segmentKeys,label}] in the shown order
export const glowRegionOf=(regions,picked,runsContain)=>{if(!picked)return 0;const r=regions.find(q=>q.label&&q.segmentKeys?.includes(picked.key)&&runsContain(q,picked.x,picked.y,picked.z));return r?r.id:0};
// OVERLAP: the shown labelled results and the shown labelled children (r.child) are looked at SEPARATELY, so a voxel a result and a child cover lights both cards (the result's id, the child's id; 0 = none each)
export const glowPairOf=(regions,picked,runsContain)=>[glowRegionOf(regions.filter(r=>!r.child),picked,runsContain),glowRegionOf(regions.filter(r=>r.child),picked,runsContain)];

// ---- the cards of labels that overlap (device setting labelOverlap, 設定 > 描画 / the VR menu's 解析 tab; PC / iPad and VR share the rule, not the judgement) ----
// What happens to a label card that lies BEHIND another card on the screen (the nearer card covers it): 'keep' = not hidden (default; the nearer card is drawn on top and is the one a
// click / the laser picks), 'always' = hidden, 'many' = hidden only while LABEL_MANY_COUNT or more labels are in sight. The number is the labels the user SEES (not hidden by a segment / the
// label switch / tissue, on the screen), counted before any card is thinned. The leader and the anchor dot of a thinned card go with it.
export const LABEL_OVERLAP_MODES=['keep','always','many'];
export const LABEL_MANY_COUNT=15;
export const normalizeLabelOverlap=v=>LABEL_OVERLAP_MODES.includes(v)?v:'keep'; // anything else (a missing / odd stored value) is 'keep'
// is the thinning of overlapped cards on for this mode and this number of labels in sight?
export const thinActive=(mode,n)=>{const m=normalizeLabelOverlap(mode);return m==='always'||(m==='many'&&Number.isFinite(n)&&n>=LABEL_MANY_COUNT)};

// ---- the views' per-voxel steps ----
// VR: object-space change per voxel along i / j / k (vr-point.js voxelToLocal); PC 3D: crosshair.js voxelToLocal3D (the longest side is 3.3 units)
export const vrVoxelStep=(halfExt,dims)=>[2*halfExt[0]/dims.columns,-2*halfExt[1]/dims.rows,2*halfExt[2]/dims.slices];
export function pcVoxelStep(dims,spacing){
 const[sx,sy,sz]=spacing||[1,1,1],k=3.3/Math.max(dims.columns*sx,dims.rows*sy,dims.slices*sz,1);
 return[sx*k,-sy*k,sz*k];
}
export const LABEL_LEADER_MAX_GROWTH=1;
// VR: the model's enlargement is the holder scale (world metres per local unit). -> the factor of a label's vector: 1 up to the initial scale, initial / current beyond it
// (world vector anchor -> card = stored vector * min(cur, MAX_GROWTH * ref)).
export const keepLengthFactor=(refScale,curScale,maxGrowth=LABEL_LEADER_MAX_GROWTH)=>refScale>0&&curScale>0&&Number.isFinite(refScale)&&Number.isFinite(curScale)?Math.min(1,maxGrowth*refScale/curScale):1;
// PC 3D. a = the anchor, d = the label's vector, both in camera space (three.js: the camera looks down -z); fx, fy = px per unit of x / depth and y / depth (W/2 * projection[0],
// H/2 * projection[5]; both are H / (2 tan(fov/2)): the view's height only); hw, hh = the card's half size (px, the same at every zoom). Drawn with the factor k, the card's centre
// is L(k) = |N| k / (za (za + k e)) px from the anchor: za = the anchor's depth, e = the vector's depth component, N = (fx (dx za - ax e), fy (dy za - ay e)). The direction on the
// screen is N's for every k (a 3D line through the anchor is a line on the screen), so the way from the card's centre to its edge along the line, c = min(hw |N| / |Nx|,
// hh |N| / |Ny|), does not depend on k either. The line runs from the anchor to the card's edge (rectEdgePoint):
//   L >= c: the anchor is outside the card, the line is L - c long;
//   L <  c: the anchor is UNDER its own card. The line runs under the card from the anchor towards that edge, c - L long (as drew it), and is cut at T
//           (comment-3d.js drawAnalysisLabels), because c - L grows when the model is drawn smaller.
export const PC_REF_DISTANCE=5.2;
const pcGeo=(a,d,fx,fy,hw,hh)=>{
 const za=-a.z,e=-d.z,nx=fx*(d.x*za-a.x*e),ny=fy*(d.y*za-a.y*e),N=Math.hypot(nx,ny),ax=Math.abs(nx),ay=Math.abs(ny);
 return{za,e,N,c:N>0?Math.min(ax>1e-12*N?hw*N/ax:Infinity,ay>1e-12*N?hh*N/ay:Infinity):hh}; // no direction on the screen (N = 0): rectEdgePoint takes the middle of an edge hh away
};
const pcOver=(g,k)=>g.za>0&&g.za+k*g.e>0?g.N*k/(g.za*(g.za+k*g.e))-g.c:Infinity; // L - c: how far the card's edge is from the anchor (negative: the anchor is under the card). Infinity: the anchor or the card is not in front of the camera
// the card centre's distance from its anchor on the screen (px)
export const pcScreenLength=(a,d,fx,fy,k=1)=>pcOver(pcGeo(a,d,fx,fy,0,0),k);
// the line as drawn (px): anchor -> the card's edge; under the card it is cut at T (T = Infinity: the whole way to the edge)
export const pcDrawnLength=(a,d,k,fx,fy,hw=0,hh=0,T=Infinity)=>{const o=pcOver(pcGeo(a,d,fx,fy,hw,hh),k);return o>=0?o:Math.min(-o,T)};
// -> T (px): the limit of a label = the line the initial display draws for it (anchor -> the card's edge, |L - c|). ar, dr = its anchor and vector seen from the reference (the
// initial display, above). Infinity when the reference cannot draw it (the card would lie behind the reference camera: only an offset longer than the camera's distance does that);
// such a label is not limited.
export const pcLeaderLimit=(ar,dr,fx,fy,{hw=0,hh=0,maxGrowth=LABEL_LEADER_MAX_GROWTH}={})=>maxGrowth*Math.abs(pcOver(pcGeo(ar,dr,fx,fy,hw,hh),1));
const PC_LEN_EPS=1e-6; // px: a line this much over the limit counts as on it (the initial display itself must give exactly 1, whatever the rounding of the two matrices)
// -> k in [0,1]: the largest factor of the vector d for which the card's edge is at most T px beyond the anchor in the current view (a, d). One formula, no search, nothing about
// the window: L(k) = T + c  <=>  k = (T + c) za^2 / (|N| - (T + c) za e). 1 when it is so as it is (zoomed out, as at the start, or the anchor under the card), or when there is
// nothing to limit.
export function pcLengthFactor(a,d,T,fx,fy,hw=0,hh=0){
 const g=pcGeo(a,d,fx,fy,hw,hh);
 if(!(g.za>0)||!(T<Infinity)||!(g.N>0))return 1; // an anchor behind the camera draws nothing; an unlimited label; a vector along the line of sight has no length on the screen
 if(pcOver(g,1)<=T*(1+1e-12)+PC_LEN_EPS)return 1;
 const Lt=Math.max(0,T)+g.c,den=g.N-Lt*g.za*g.e;
 return den>0?Math.min(1,Lt*g.za*g.za/den):1; // den <= 0 would mean the line never reaches Lt (it is then within T at k = 1, handled above)
}
// -> k in [0,1]: the factor of this label's vector in the current view: pcLengthFactor against its own limit. opts = {hw, hh, maxGrowth}
export function pcLeaderCap(a,d,ar,dr,fx,fy,opts={}){
 return pcLengthFactor(a,d,pcLeaderLimit(ar,dr,fx,fy,opts),fx,fy,opts.hw||0,opts.hh||0);
}
// the drag's inverse: the card is put at the displacement u from its anchor (camera space; ur = the same local vector seen from the reference). -> {s, short}; s >= 1: the stored
// offset is s*u (local), so that pcLeaderCap of s*u, times s, draws the card exactly at u. s = 1 when u is within the limit as it is (the view is not enlarged past the start, or
// the anchor is under the card). Enlarged, the stored offset is the one whose line at the initial display is as long as the line the user sees now (one formula:
// Lr(s) = line now + cr). short = no offset does that well: a vector running away from the reference camera (er > 0) draws a line there that levels off at |Nr| / (zr er) - cr,
// and an offset is taken only up to 75 % of that level (s <= 3 zr / er); beyond, s is that bound and the card would stop short of u, on the same line of the screen.
function pcUncap(a,u,ar,ur,fx,fy,{hw=0,hh=0,maxGrowth=LABEL_LEADER_MAX_GROWTH}={}){
 const g=pcGeo(a,u,fx,fy,hw,hh),gr=pcGeo(ar,ur,fx,fy,hw,hh),now=pcOver(g,1);
 if(!(now<Infinity)||!(gr.za>0)||!(gr.N>0)||!(maxGrowth>0))return{s:1,short:false};
 if(now<=maxGrowth*Math.abs(pcOver(gr,1))+PC_LEN_EPS)return{s:1,short:false};
 const Lg=now/maxGrowth+gr.c,den=gr.N-Lg*gr.za*gr.e,top=gr.e>0?Math.max(1,3*gr.za/gr.e):Infinity;
 const s=den>0?Lg*gr.za*gr.za/den:Infinity;
 return s<=top?{s:Math.max(1,s),short:false}:{s:top<Infinity?top:1,short:true};
}
export const pcLeaderUncap=(a,u,ar,ur,fx,fy,opts={})=>pcUncap(a,u,ar,ur,fx,fy,opts).s;
// the drag (comment-3d.js): the card must be drawn where the pointer is. Every point of the pointer's line of sight is drawn there, so its depth is free: view(t) -> {a,u,ar,ur}
// for the point of that line whose depth, measured from the anchor's, is t times the depth of the card as it is drawn now (t = 1: the card keeps its depth, the drag of;
// t = 0: the anchor's depth, where the line at the initial display grows without a level, so an offset always exists). -> {t, s}: the largest t in [0,1] that pcUncap does not
// call short (t = 1 whenever the card's own depth does; otherwise found by halving, 30 steps, on a pointer move only), and its s. The stored offset is s * u of view(t).
export function pcDragUncap(view,fx,fy,opts={}){
 const at=t=>{const v=view(t);return pcUncap(v.a,v.u,v.ar,v.ur,fx,fy,opts)};
 let r=at(1);if(!r.short)return{t:1,s:r.s};
 let lo=0,hi=1,best=at(0);if(best.short)return{t:1,s:r.s}; // cannot happen with a card in front of both cameras; the old answer then
 for(let i=0;i<30;i++){const m=(lo+hi)/2,rm=at(m);if(rm.short)hi=m;else{lo=m;best=rm}}
 return{t:lo,s:best.s};
}
// PC: a free place WITHIN THE LIMIT for a card that lies in the tissue. The march of comment-3d-label-occlusion.js pushOutOfTissue (from p0 along each of dirs, unit vectors, in
// steps of `step` up to maxDist; the first sample outside the tissue is the way out and the card goes `margin` beyond it; a candidate that is tissue again, a thin wall, is
// skipped), plus one condition: accept(point) must be true (comment-3d.js: the leader drawn to that point is within T). The shortest accepted way out wins (the order of dirs
// breaks a tie). -> {point:{x,y,z}, dist} or null (no free place within the limit: the card stays where it is, translucent).
export function pushWithinLimit(p0,isTissue,dirs,{step,margin=0,maxDist=Infinity,accept=null}={}){
 if(!(step>0)||!isTissue(p0))return null;
 let best=null;
 for(const d of dirs){
  const limit=Math.min(maxDist,best?best.dist:Infinity);let exit=-1;
  for(let t=step;t<=limit;t+=step){if(!isTissue({x:p0.x+d.x*t,y:p0.y+d.y*t,z:p0.z+d.z*t})){exit=t;break}}
  if(exit<0)continue;
  const q={x:p0.x+d.x*(exit+margin),y:p0.y+d.y*(exit+margin),z:p0.z+d.z*(exit+margin)};
  if(isTissue(q)||(accept&&!accept(q)))continue;
  if(!best||exit<best.dist)best={point:q,dist:exit};
 }
 return best;
}
export const scaledStep=(step,k)=>[step[0]*k,step[1]*k,step[2]*k];
// where a leader line meets the edge of a label card: (dx,dy) = the direction from the card's centre to the anchor in the card's plane, (hw,hh) = the card's half size.
// Returns the point on the card's rectangle in that direction (the centre when there is no direction -> the bottom edge's middle).
export function rectEdgePoint(dx,dy,hw,hh){
 const ax=Math.abs(dx),ay=Math.abs(dy);
 if(ax<1e-12&&ay<1e-12)return{x:0,y:-hh};
 const s=Math.min(ax>1e-12?hw/ax:Infinity,ay>1e-12?hh/ay:Infinity);
 return{x:dx*s,y:dy*s};
}

// ---- the anchor of a label pinned on the PC ----
// A result's inside voxel would put its card INSIDE the tissue in VR (a ghost behind bone), so the PC pins on the result's SURFACE as the current camera sees it: march from the eye
// (voxel units, {i,j,k}) towards a voxel inside the result and take the first sample that lies in it (contains(i,j,k) on rounded voxel indices). Deterministic, at most maxSteps tests
// (a long ray is cut to its last maxSteps samples, the part nearest the target). Returns the entry point {i,j,k} (floats), or null when the ray never meets the result.
export function surfaceAnchor({contains,eye,target,step=.5,maxSteps=6000}){
 const dx=target.i-eye.i,dy=target.j-eye.j,dz=target.k-eye.k,len=Math.hypot(dx,dy,dz);
 if(!(len>1e-9)||typeof contains!=='function')return null;
 const ux=dx/len,uy=dy/len,uz=dz/len,n=Math.min(Math.ceil(len/step)+1,maxSteps),t0=Math.max(0,len-(n-1)*step);
 for(let s=0;s<n;s++){
  const t=t0+s*step,p={i:eye.i+ux*t,j:eye.j+uy*t,k:eye.k+uz*t};
  if(contains(Math.round(p.i),Math.round(p.j),Math.round(p.k)))return p;
 }
 return contains(Math.round(target.i),Math.round(target.j),Math.round(target.k))?{i:target.i,j:target.j,k:target.k}:null;
}
