// Where the distance label goes (build 480): by default NEAR its line (a small offset from the midpoint, perpendicular to the line), and wherever the user dragged it
// (measurements.js labelOffset: voxel units from the midpoint). Pure functions (no DOM, no three.js); screen coordinates in px (x right, y down).
const norm=(x,y)=>{const l=Math.hypot(x,y);return l>1e-9?{x:x/l,y:y/l}:null};

// keep a label (w x h, centre x,y) inside the rect (x0,y0,iw,ih): at DISPLAY time only (the stored offset is untouched), so a label moved far away can never be lost off-screen
export function clampLabelCenter(x,y,{w=60,h=16,x0=-1e9,y0=-1e9,iw=2e9,ih=2e9,pad=2}={}){
 const cx=Math.min(Math.max(x,x0+w/2+pad),Math.max(x0+w/2+pad,x0+iw-w/2-pad)),cy=Math.min(Math.max(y,y0+h/2+pad),Math.max(y0+h/2+pad,y0+ih-h/2-pad));
 return{x:cx,y:cy};
}
// The default label of the PC views (3D and 2D MPR): beside the line a-b, perpendicular to it (the upper side), just clear of the line, clamped into the rect (x0,y0,iw,ih) (the image / the view). -> {x,y} the label's centre, {mx,my} the midpoint.
export function planeLabelPlacement(a,b,{w=48,h=14,gap=4,x0=-1e9,y0=-1e9,iw=2e9,ih=2e9}={}){
 const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,u=norm(b.x-a.x,b.y-a.y)||{x:1,y:0};
 let n={x:-u.y,y:u.x};if(n.y>0||(n.y===0&&n.x<0))n={x:-n.x,y:-n.y};
 const d=gap+Math.abs(n.x)*w/2+Math.abs(n.y)*h/2; // the rectangle's half extent along n: its edge just clears the line
 const c=clampLabelCenter(mx+n.x*d,my+n.y*d,{w,h,x0,y0,iw,ih,pad:1});
 return{x:c.x,y:c.y,mx,my};
}

// ---- focus (build 485) ----
// Which distance label is lit (the PC hover / the touch or mouse drag): hover and drag are kept apart so a drag keeps the label lit when the pointer leaves it.
// onChange(now,prev) is called ONLY when the lit label changes (so a redraw / class toggle happens once per change, never per move event). Pure: no DOM.
export function createFocusTracker(onChange){
 let hov=null,drg=null,cur=null;
 const sync=()=>{const n=drg!==null?drg:hov;if(n!==cur){const p=cur;cur=n;if(onChange)onChange(n,p)}};
 return{hover(id){hov=id==null?null:id;sync()},drag(id){drg=id==null?null:id;sync()},get:()=>cur};
}

// ---- moving the label ----
// a voxel offset {i,j,k} -> a vector in the view's space, and back; step = the space's change per voxel along i / j / k, e.g. VR [2hx/cols, -2hy/rows, 2hz/slices]
export const stepDelta=(off,step)=>({x:off.i*step[0],y:off.j*step[1],z:off.k*step[2]});
export const offsetFromDelta=(d,step)=>({i:step[0]?d.x/step[0]:0,j:step[1]?d.y/step[1]:0,k:step[2]?d.z/step[2]:0});
// 2D MPR: a drag of (dfx,dfy) (fractions of the image width / height) -> the voxel offset it stands for. project(v) -> {fx,fy} is the plane's mapping
// (crosshair.js planePointFromVoxel); the two voxel axes lying in the plane are found by probing, the out-of-plane one gets 0.
export function planeVoxelDelta(project,dfx,dfy){
 const o=project({i:0,j:0,k:0}),cols=['i','j','k'].map(ax=>{const p=project({i:ax==='i'?1:0,j:ax==='j'?1:0,k:ax==='k'?1:0});return{ax,x:p.fx-o.fx,y:p.fy-o.fy}});
 const inPlane=cols.filter(c=>Math.abs(c.x)>1e-12||Math.abs(c.y)>1e-12);
 const out={i:0,j:0,k:0};
 if(inPlane.length<2)return out;
 const[A,B]=inPlane,det=A.x*B.y-B.x*A.y;if(Math.abs(det)<1e-18)return out;
 out[A.ax]=(dfx*B.y-B.x*dfy)/det;out[B.ax]=(A.x*dfy-dfx*A.y)/det;
 return out;
}
// VR: the default label position (world metres) beside the line a-b: perpendicular to the line AND to the view direction (so it sits beside the line as seen), on the upper side,
// offset from the midpoint by `dist` (m). head: the head's world position.
export function nearLabelWorld(a,b,head,dist){
 const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2},u=[b.x-a.x,b.y-a.y,b.z-a.z],v=[head.x-mid.x,head.y-mid.y,head.z-mid.z];
 let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(n[0],n[1],n[2]);
 if(l<1e-9){n=[0,1,0];l=1}
 n=n.map(x=>x/l);if(n[1]<0||(n[1]===0&&n[0]<0))n=n.map(x=>-x);
 return{x:mid.x+n[0]*dist,y:mid.y+n[1]*dist,z:mid.z+n[2]*dist};
}

// ---- depth cue (build 493) ----
// The distance line, its leader and its label are drawn over the volume without a depth test (the volume writes no depth), so what lies BEHIND the visible surface of
// the volume looked as if it floated in front of it. The surface is judged on the CPU, with the rule the point markers already use (vr-point.js pointIsHidden: march
// from the thing towards the eye over the classification of the shown segments), and a hidden part is drawn FAINT ("x-ray"), never removed, so it stays findable.
// The thing judged is a probe: {id:probeKey(measurementId,part),pos}. part = a sample index 0..LINE_SAMPLES along the line (A -> B), or 'L' for a label the user dragged.
// A label that was not dragged stays with its line: it follows the midpoint sample (LABEL_MID).
export const OCCLUDED_ALPHA=0.3,LINE_SAMPLES=8,LABEL_MID=LINE_SAMPLES/2;
export const probeKey=(id,part)=>id+'|'+part;
export const labelPart=labelOffset=>labelOffset?'L':LABEL_MID;
// the sample points a->b (n segments, n+1 points) of any {x,y,z}
export function lineSamplePoints(a,b,n=LINE_SAMPLES){
 const out=[];for(let i=0;i<=n;i++){const t=i/n;out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t})}
 return out;
}
// the opacity factor of a label / leader: faint when hidden, but a lit one (the laser on it / grabbed / hovered / dragged) stays fully visible so it can still be used
export const fadeAlpha=(hidden,lit=false)=>hidden&&!lit?OCCLUDED_ALPHA:1;
// the per-sample opacity factors of the line: hidden:Set of probe keys (null = nothing hidden)
export const lineAlphas=(id,hidden,n=LINE_SAMPLES)=>{const out=[];for(let i=0;i<=n;i++)out.push(hidden&&hidden.has(probeKey(id,i))?OCCLUDED_ALPHA:1);return out};
// build 494: where the 3D samples (i/n along the line in 3D) fall along the DRAWN 2D segment. With a perspective camera the screen fraction is not the 3D fraction
// (f = u*wb / ((1-u)*wa + u*wb), w = the depth in front of the camera), and the drawn segment is the part in front of the near plane (clipSegmentNear), so the
// gradient stops of the line must sit at these offsets, not at i/n. da / db = the camera depths (-z, camera space) of the UNCLIPPED ends a / b. -> n+1 offsets in
// [0,1], non-decreasing (samples outside the clipped range snap to 0 / 1), or null when the whole segment is behind the near plane. ortho: the screen fraction is linear.
export function lineStopOffsets(da,db,near=0.01,ortho=false,n=LINE_SAMPLES){
 if(!(Number.isFinite(da)&&Number.isFinite(db)))return null;
 if(da<near&&db<near)return null;
 let t0=0,t1=1;
 if(da<near)t0=(near-da)/(db-da);else if(db<near)t1=(da-near)/(da-db);
 const wa=da+(db-da)*t0,wb=da+(db-da)*t1,out=[];
 for(let i=0;i<=n;i++){
  const t=i/n,u=t1>t0?Math.min(1,Math.max(0,(t-t0)/(t1-t0))):0;
  let f=u;
  if(!ortho){const d=(1-u)*wa+u*wb;f=d>0?u*wb/d:u}
  out.push(Math.min(1,Math.max(0,f)));
 }
 for(let i=1;i<out.length;i++)if(out[i]<out[i-1])out[i]=out[i-1]; // rounding only: keep the offsets monotonic
 return out;
}
// a fresh element id with a prefix: a counter (ids of measurements come from project files: any characters, not unique after sanitising)
export function createIdMaker(prefix){let n=0;return()=>prefix+(++n)}
// build 494: skip the judgement of the distances' probes while nothing it depends on changed (VR, vr-view.js updateHidden: pointIsHidden over the shown segments' classification,
// from the probe to the eye). The inputs: key = a string of everything discrete (the probes' places, the volume's matrix, the shown segments, the section planes ...), refs =
// objects compared by identity (the classification bytes), eye = {x,y,z} (world): re-judged once it moved by more than eyeTol (m) from where it was LAST judged
// (a slow drift adds up), so the small sway of a still head costs nothing. reset() makes the next check run.
export function createProbeGate(eyeTol=0.005){
 let key=null,refs=null,eye=null;
 return{
  shouldRun(nextKey,nextRefs,e){
   let run=key===null||nextKey!==key||!refs||nextRefs.length!==refs.length||nextRefs.some((r,i)=>r!==refs[i]);
   if(!run&&eye){const dx=e.x-eye.x,dy=e.y-eye.y,dz=e.z-eye.z;run=dx*dx+dy*dy+dz*dz>eyeTol*eyeTol}
   if(run){key=nextKey;refs=nextRefs.slice();eye={x:e.x,y:e.y,z:e.z}}
   return run;
  },
  reset(){key=null;refs=null;eye=null},
 };
}
// a smooth step towards the target (so the 10 Hz judgement fades in / out instead of flickering); dtMs = time since the last call; snaps when almost there
export function approachAlpha(cur,target,dtMs){
 const k=1-Math.exp(-Math.max(0,+dtMs||0)/70),n=cur+(target-cur)*k;
 return Math.abs(target-n)<0.01?target:n;
}
