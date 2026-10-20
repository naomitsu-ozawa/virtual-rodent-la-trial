// hand tracking (Quest 3), phase 0 / 1 / 2 (phase 2: the fist = the grip, 断面 +/- on the wrist menu): the pure part — no DOM and no three.js (unit-tested in tests/unit/vr-hand.test.js).
// vr-hand-view.js does the three.js side (the filtered / delayed target ray written back into the controller group, the wrist menu, the
// fingertip markers); vr-view.js only routes its events there. Every hand branch is guarded by isHand(source): an XRInputSource with .hand
// (granted only with the optional 'hand-tracking' feature). Controllers never reach this code, and their behaviour is unchanged.
// Poses are plain arrays [px,py,pz,qx,qy,qz,qw] (metres, unit quaternion) in the XR reference space; times in ms (performance.now / XR time).

export const isHand=s=>!!(s&&s.hand);

// ---- One Euro filter (Casiez, Roussel, Vogel, CHI 2012) ----
// Low-pass whose cutoff rises with the speed: cutoff = minCutoff + beta * speed * speedScale (Hz). speed = the length of the filtered
// derivative over all n channels (units/s); speedScale converts it to the unit beta is tuned for (1000: metres -> mm, so beta 0.05 = +5 Hz
// per 100 mm/s). minCutoff: the hand's jitter at rest is smoothed; a fast move raises the cutoff so the ray does not trail.
// the speed itself is low-passed at dCutoff. At 1 Hz (the paper's value) the cutoff only opened ~160 ms after a move had started and a
// slow move (2-10 cm/s: fine placing) trailed by 35-70 ms; dCutoff 5 / beta 0.05 / minCutoff 1.2 halve that (tests/unit/vr-hand.test.js measures it) while
// the rest jitter stays ~0.2 mm rms. Tunable on the device: localStorage vrl-hand-filter (see parseFilterTune).
export const ONE_EURO={minCutoff:1.2,beta:0.05,dCutoff:5};
// the palm anchor (what a fist holds): a held object is compared with the real hand by the eye, so it is filtered much less than the ray
export const PALM_FILTER={minCutoff:5,beta:0.15,dCutoff:8};
export const euroAlpha=(cutoffHz,dtS)=>{const r=2*Math.PI*cutoffHz*dtS;return r/(r+1)};
export function createOneEuro(n,{minCutoff=ONE_EURO.minCutoff,beta=ONE_EURO.beta,dCutoff=ONE_EURO.dCutoff,speedScale=1}={}){
 const x=new Float64Array(n),dx=new Float64Array(n);let t=null;
 return{
  // v: n numbers (array-like) at time now (ms) -> the filtered values written into out (default: v itself), returned. No allocation.
  // A non-finite v[i] (a lost joint) is not fed to the filter (one NaN would stay in its state for good): the previous output, out untouched when there is none yet.
  filter(v,now,out=v){
   for(let i=0;i<n;i++)if(!(v[i]-v[i]===0)||!(now-now===0)){if(t!==null)for(let j=0;j<n;j++)out[j]=x[j];return out}
   if(t===null){for(let i=0;i<n;i++){x[i]=v[i];dx[i]=0;out[i]=v[i]}t=now;return out}
   const dt=(now-t)/1000;
   if(!(dt>0)){for(let i=0;i<n;i++)out[i]=x[i];return out} // same (or older) time stamp: the previous output
   t=now;const ad=euroAlpha(dCutoff,dt);let s=0;
   for(let i=0;i<n;i++){dx[i]+=ad*((v[i]-x[i])/dt-dx[i]);s+=dx[i]*dx[i]}
   const a=euroAlpha(minCutoff+beta*Math.sqrt(s)*speedScale,dt);
   for(let i=0;i<n;i++){x[i]+=a*(v[i]-x[i]);out[i]=x[i]}
   return out;
  },
  reset(){t=null},
  get primed(){return t!==null},
 };
}
// a pose (position + orientation): One Euro on the position (mm for beta) and on the quaternion components (x1000: about mm at a 0.5 m lever),
// the input quaternion flipped onto the hemisphere of the last output (q and -q are the same turn), the output normalised.
export function createPoseFilter({minCutoff=ONE_EURO.minCutoff,beta=ONE_EURO.beta,dCutoff=ONE_EURO.dCutoff,posScale=1000,rotScale=1000}={}){
 const pos=createOneEuro(3,{minCutoff,beta,dCutoff,speedScale:posScale}),rot=createOneEuro(4,{minCutoff,beta,dCutoff,speedScale:rotScale});
 const p=new Float64Array(3),q=new Float64Array(4),last=new Float64Array(4);let has=false;
 return{
  filter(inp,now,out){
   p[0]=inp[0];p[1]=inp[1];p[2]=inp[2];q[0]=inp[3];q[1]=inp[4];q[2]=inp[5];q[3]=inp[6];
   if(has&&q[0]*last[0]+q[1]*last[1]+q[2]*last[2]+q[3]*last[3]<0){q[0]=-q[0];q[1]=-q[1];q[2]=-q[2];q[3]=-q[3]}
   pos.filter(p,now);rot.filter(q,now);
   const l=Math.hypot(q[0],q[1],q[2],q[3])||1;
   out[0]=p[0];out[1]=p[1];out[2]=p[2];
   for(let i=0;i<4;i++){last[i]=q[i]/l;out[3+i]=last[i]}
   has=true;return out;
  },
  reset(){pos.reset();rot.reset();has=false},
 };
}

// ---- pinch with hysteresis (index tip - thumb tip distance, metres) ----
// the hand's own pinch is the trigger (createPinchFusion below), the system's select is only a second input.
// on below PINCH.on for onFrames frames in a row, off again only above PINCH.off for offFrames frames in a row: a wrist swing that blurs the
// fingertips for a frame neither ends a pinch nor starts one. A missing distance (joints not tracked) keeps the state and the counters.
// on 1.8 cm: the fingertip joints sit inside the finger pads, so touching pads read ~1-1.5 cm; off 3 cm: clearly opened.
// Tunable on the device: localStorage vrl-hand-pinch (parsePinchTune).
export const PINCH={on:0.018,off:0.03,onFrames:2,offFrames:2};
export const PINCH_ON_M=PINCH.on,PINCH_OFF_M=PINCH.off;
export function createPinchHysteresis({on=PINCH.on,off=PINCH.off,onFrames=PINCH.onFrames,offFrames=PINCH.offFrames}={}){
 let pinched=false,n=0;
 return{
  update(d){
   if(!Number.isFinite(d))return pinched;
   const flip=pinched?d>off:d<on;
   if(!flip){n=0;return pinched}
   if(++n>=(pinched?offFrames:onFrames)){pinched=!pinched;n=0}
   return pinched;
  },
  reset(){pinched=false;n=0},
  get pinched(){return pinched},
 };
}

// ---- one pinch = one press: the hand's own pinch OR the system's select ----
// own(d, now, guard) once per frame with the fingertip distance; os(down, now, guard) on the system's selectstart / selectend. Each returns
// 'start' | 'end' | null, and the starts / ends alternate (one press per pinch, whichever input sees it first):
//  - a press starts on the first of the two; the other one joining it is absorbed
//  - once the own detector has seen the pinch (ownEngaged) only the own detector ends it: the system's selectend during a wrist swing does not
//  - a press only the system saw (fingertips not < on, e.g. joints poorly tracked) ends on the system's selectend
//  - guard (a fist forming / the hand holding something): no press; latched until both inputs are released (the pinch inside the fist never fires later)
//  - a system select that starts again within osGapMs after a press ended is the tail of the same pinch, not a new one
//  - cancel(): the press was dropped from outside (tracking lost, the fist took over): no 'end' is reported, latched as for guard
// own:false / os:false switch an input off (os:false: the system's select is ignored; own:false: the system's select alone, as before).
export const PINCH_FUSION={own:1,os:1,osGapMs:100};
export function createPinchFusion({own:useOwn=PINCH_FUSION.own,os:useOs=PINCH_FUSION.os,osGapMs=PINCH_FUSION.osGapMs,...hyst}={}){
 const h=createPinchHysteresis(hyst);
 let pressed=false,ownEngaged=false,osDown=false,latched=false,endAt=-Infinity,src=null;
 const begin=(by,now,guard)=>{if(guard){latched=true;return null}pressed=true;src=by;ownEngaged=by==='own';return'start'};
 const finish=now=>{pressed=false;ownEngaged=false;src=null;endAt=now;return'end'};
 return{
  own(d,now,guard=false){
   if(!useOwn)return null;
   const was=h.pinched,on=h.update(d);
   if(latched){if(!on&&!osDown)latched=false;return null}
   if(pressed){if(on)ownEngaged=true;else if(ownEngaged)return finish(now);return null}
   return on&&!was?begin('own',now,guard):null;
  },
  os(down,now,guard=false){
   osDown=!!down;
   if(!useOs)return null;
   if(down){
    if(latched||pressed)return null;
    if(now-endAt<osGapMs)return null;
    if(useOwn&&h.pinched)return null; // the own detector holds this pinch already (its press was dropped / refused): not a new one
    return begin('os',now,guard);
   }
   if(latched){if(!h.pinched||!useOwn)latched=false;return null}
   return pressed&&!ownEngaged?finish(now):null;
  },
  cancel(){if(pressed){pressed=false;ownEngaged=false;src=null}latched=true},
  reset(){h.reset();pressed=false;ownEngaged=false;osDown=false;latched=false;endAt=-Infinity;src=null},
  get pressed(){return pressed},
  get source(){return src},
  get pinched(){return h.pinched},
 };
}

// ---- the pose a pinch drags with ----
// The system's pinch ray of a hand is aimed from the shoulder (and lags it), so turning the wrist hardly turns it, and the 60 ms ray delay
// (rayDelayMs: thumb and index are close for the whole pinch) trailed every drag. While a pinch is held, the hand's group gets instead the
// ray of the press carried by the hand itself, like a controller: the palm anchor's motion since the press (its position and the turn of the
// wrist) is applied to the ray pose of the press. start() at the press (no jump: the output equals that ray until the hand moves), step()
// every frame. gain scales the hand's travel (1 = 1:1), rot the share of the wrist's turn (1 = all of it, 0 = the direction stays as pressed).
// Poses are [px,py,pz,qx,qy,qz,qw] in the same (XR reference) space. No allocation per step.
export const DRAG_CARRY={carry:1,gain:1,rot:1,blendMs:120};
const qMulA=(a,ai,b,bi,o,oi)=>{ // o[oi..] = a[ai..] * b[bi..] (quaternions x,y,z,w); o may alias neither input
 const ax=a[ai],ay=a[ai+1],az=a[ai+2],aw=a[ai+3],bx=b[bi],by=b[bi+1],bz=b[bi+2],bw=b[bi+3];
 o[oi]=aw*bx+ax*bw+ay*bz-az*by;o[oi+1]=aw*by-ax*bz+ay*bw+az*bx;o[oi+2]=aw*bz+ax*by-ay*bx+az*bw;o[oi+3]=aw*bw-ax*bx-ay*by-az*bz;return o;
};
// unit quaternion slerp from identity toward q by t (the shorter way); o: 4 numbers
const qPow=(q,t,o)=>{
 let x=q[0],y=q[1],z=q[2],w=q[3];if(w<0){x=-x;y=-y;z=-z;w=-w}
 if(t===1){o[0]=x;o[1]=y;o[2]=z;o[3]=w;return o}
 const s=Math.hypot(x,y,z);if(s<1e-12||t===0){o[0]=0;o[1]=0;o[2]=0;o[3]=1;return o}
 const a=Math.atan2(s,w)*t,k=Math.sin(a)/s;o[0]=x*k;o[1]=y*k;o[2]=z*k;o[3]=Math.cos(a);return o;
};
export function createDragCarry(){
 const r0=new Float64Array(7),a0=new Float64Array(7),ia=new Float64Array(4),d=new Float64Array(4),dr=new Float64Array(4),v=[0,0,0],tq=new Float64Array(4);let on=false;
 const take=(ray,anchor)=>{for(let i=0;i<7;i++){r0[i]=ray[i];a0[i]=anchor[i]}ia[0]=-a0[3];ia[1]=-a0[4];ia[2]=-a0[5];ia[3]=a0[6];on=true};
 return{
  start(ray,anchor){take(ray,anchor)},
  // the palm was lost and is back: the output stays where it is (cur) and follows the hand from this anchor on (no jump)
  rebase(cur,anchor){take(cur,anchor)},
  step(anchor,out,{gain=DRAG_CARRY.gain,rot=DRAG_CARRY.rot}={}){
   if(!on){for(let i=0;i<7;i++)out[i]=r0[i];return out}
   tq[0]=anchor[3];tq[1]=anchor[4];tq[2]=anchor[5];tq[3]=anchor[6];
   qMulA(tq,0,ia,0,d,0); // the wrist's turn since the press, in the reference space
   qPow(d,Math.max(0,Math.min(1,rot)),dr);
   // the ray origin's offset from the palm, turned with the hand
   const ox=r0[0]-a0[0],oy=r0[1]-a0[1],oz=r0[2]-a0[2],x=dr[0],y=dr[1],z=dr[2],w=dr[3],tx=2*(y*oz-z*oy),ty=2*(z*ox-x*oz),tz=2*(x*oy-y*ox);
   v[0]=ox+w*tx+y*tz-z*ty;v[1]=oy+w*ty+z*tx-x*tz;v[2]=oz+w*tz+x*ty-y*tx;
   for(let i=0;i<3;i++)out[i]=a0[i]+gain*(anchor[i]-a0[i])+v[i];
   qMulA(dr,0,r0,3,out,3);
   const l=Math.hypot(out[3],out[4],out[5],out[6])||1;for(let i=3;i<7;i++)out[i]/=l;
   return out;
  },
  stop(){on=false},
  get active(){return on},
 };
}
// a -> b by k (0: a, 1: b): positions lerped, orientations nlerp'd on one hemisphere (the release: the carried ray goes back to the system's)
export function blendPose(a,b,k,out){
 const t=Math.max(0,Math.min(1,k)),s=a[3]*b[3]+a[4]*b[4]+a[5]*b[5]+a[6]*b[6]<0?-1:1;
 for(let i=0;i<3;i++)out[i]=a[i]+(b[i]-a[i])*t;
 for(let i=3;i<7;i++)out[i]=a[i]+(s*b[i]-a[i])*t;
 const l=Math.hypot(out[3],out[4],out[5],out[6])||1;for(let i=3;i<7;i++)out[i]/=l;
 return out;
}

// ---- the hand's laser ----
// The hand's ray is the system's own target ray (the Quest's standard hand pointer: shoulder-anchored, filtered and stabilised across the pinch by the runtime),
// used as it is: no filter, no delay. Earlier builds replaced it (628 / 629 bone axes, 631 a shoulder -> knuckle ray) or delayed and smoothed it (626): all
// harder to use than the standard one. The only thing added is a short hold: when the system drops the ray for a moment, the last good one stays for
// RAY_HOLD_MS (vr-hand-view.js), so the laser does not flicker or jump.
export const RAY_HOLD_MS=200;

// ---- tracking loss ----
// update(hasPose, now) -> 'ok' | 'lost' | 'cancel' | 'recover'. 'cancel': once, on the first frame the pose has been missing for more than
// cancelMs (the hand's press / drag is dropped as on a disconnect); 'recover': the first frame with a pose after any loss (that sample is
// dropped and the filter starts again). Before the first pose ever seen: 'lost' without a timer.
export const LOSS_CANCEL_MS=200;
export function createTrackingLoss({cancelMs=LOSS_CANCEL_MS}={}){
 let lostAt=null,cancelled=false,seen=false;
 return{
  update(hasPose,now){
   if(!hasPose){
    if(!seen)return'lost';
    if(lostAt===null)lostAt=now;
    if(!cancelled&&now-lostAt>cancelMs){cancelled=true;return'cancel'}
    return'lost';
   }
   seen=true;
   if(lostAt!==null){lostAt=null;cancelled=false;return'recover'}
   return'ok';
  },
  reset(){lostAt=null;cancelled=false;seen=false},
 };
}

// ---- wrist menu: when the back of the LEFT wrist faces the eyes ----
// WebXR Hand Input joint axes: -Y points into the palm (so +Y = the back of the hand), -Z along the bones to the fingers. The OS keeps the
// palm-up gesture toward the face (the system menu pinch), so the wrist menu uses the opposite side: the back of the wrist turned to the eyes,
// fingers across the view (a watch check). facing = cos(angle between the back of the hand and wrist->head); across = |cos| between the finger
// direction and wrist->head (small = fingers across the view, large = pointing at / away from the face, as when aiming forward).
export const WRIST_DORSAL=[0,1,0],WRIST_FINGERS=[0,0,-1];
export const WRIST_MENU={showFacing:0.7,hideFacing:0.45,maxAcross:0.6,hideAcross:0.75,minDist:0.12,maxDist:0.8,showMs:150,hideMs:150};
const rotV=(q,v,o)=>{ // the vector v turned by the unit quaternion q=[x,y,z,w] (o: 3 numbers out)
 const x=q[0],y=q[1],z=q[2],w=q[3],tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);
 o[0]=v[0]+w*tx+y*tz-z*ty;o[1]=v[1]+w*ty+z*tx-x*tz;o[2]=v[2]+w*tz+x*ty-y*tx;return o;
};
const tD=[0,0,0],tF=[0,0,0];
// wp: [x,y,z] wrist position, wq: [x,y,z,w] wrist orientation, head: [x,y,z] (or {x,y,z}); out (reused): {facing,across,dist}
export function wristMenuMetrics(wp,wq,head,out={facing:0,across:0,dist:0}){
 const hx=(head.x??head[0])-wp[0],hy=(head.y??head[1])-wp[1],hz=(head.z??head[2])-wp[2],d=Math.hypot(hx,hy,hz);
 out.dist=d;
 if(!(d>1e-6)){out.facing=-1;out.across=1;return out}
 rotV(wq,WRIST_DORSAL,tD);rotV(wq,WRIST_FINGERS,tF);
 out.facing=(tD[0]*hx+tD[1]*hy+tD[2]*hz)/d;out.across=Math.abs(tF[0]*hx+tF[1]*hy+tF[2]*hz)/d;
 return out;
}
// shown after the pose is held showMs, hidden after it is lost hideMs (looser limits while shown); blocked (no left hand, the left hand busy
// with a press, tracking lost) hides it at once
export function createWristMenuGate(opts={}){
 const o={...WRIST_MENU,...opts};let shown=false,since=null;
 const ok=(m,f,a)=>m.facing>=f&&m.across<=a&&m.dist>=o.minDist&&m.dist<=o.maxDist;
 return{
  update(m,now,blocked=false){
   if(blocked||!m){shown=false;since=null;return false}
   const want=shown?ok(m,o.hideFacing,o.hideAcross):ok(m,o.showFacing,o.maxAcross);
   if(want===shown){since=null;return shown}
   if(since===null)since=now;
   if(now-since>=(shown?o.hideMs:o.showMs)){shown=want;since=null}
   return shown;
  },
  reset(){shown=false;since=null},
  get shown(){return shown},
 };
}
// the wrist menu's buttons, in slot order: A/X short (the quick ring), A/X long (the menu), B/Y short (sections shown / hidden), B/Y long
// (add a section), 取り消し (the ring's undo), then 断面 － / ＋ (the selected section along its normal = the thumbstick up / down: hold to repeat)
export const WRIST_ITEMS=['ring','menu','section','add','undo','secDown','secUp'];
// a compact grid panel instead of the 28 cm strip (labelled buttons -> a grid; the 7 items fit 3 columns x 3 rows). WRIST_GRID.cells[slot] = [col,row]
// (row 0 on top): the three view buttons on the first row, add / undo on the second, the 断面 － / ＋ pair together on the last; two cells stay empty.
// size: a cell is 5 x 3.5 cm (the same 5000 px / m of text as before), the panel 15 x 10.5 cm: readable at arm's length, and it does not cover the hand.
export const WRIST_GRID={cols:3,rows:3,cellW:0.05,cellH:0.035,cells:[[0,0],[1,0],[2,0],[0,1],[1,1],[0,2],[1,2]]};
// the slot under the texture coordinates (u to the right, v up: three's plane uv) or null (outside / an empty cell / not a number)
export function wristSlotFromUv(u,v){
 if(!Number.isFinite(u)||!Number.isFinite(v))return null;
 const g=WRIST_GRID,c=Math.max(0,Math.min(g.cols-1,Math.floor(u*g.cols))),r=Math.max(0,Math.min(g.rows-1,Math.floor((1-v)*g.rows)));
 for(let i=0;i<g.cells.length;i++)if(g.cells[i][0]===c&&g.cells[i][1]===r)return i;
 return null;
}
// 断面 －/＋ held on the wrist menu: the thumbstick's deflection (1 = full) after heldMs. A tap nudges (0.4), holding speeds up to full in 1 s.
// ＋ = the thumbstick pushed up (the plane moves along +X, its normal), － = pulled back; the sign is returned by wristScrollSign.
export const WRIST_SCROLL={start:0.4,rampMs:1000};
export const wristScrollGain=heldMs=>{const f=Math.max(0,Math.min(1,(heldMs||0)/WRIST_SCROLL.rampMs));return WRIST_SCROLL.start+(1-WRIST_SCROLL.start)*f};
// 断面 －/＋ keeps scrolling only while the ray stays on the SAME button, the hand is not a fist, and nothing the scroll needs went away
export const wristScrollKeep=(heldId,hitId,fist)=>!!heldId&&hitId===heldId&&!fist;
export const wristScrollSign=id=>id==='secUp'?-1:id==='secDown'?1:0; // the `scroll` sum of vr-view.js: thumbstick down = +, up = -

// ---- empty-space pinch actions ----
// A pinch whose laser hits nothing interactive does what a controller button does: the RIGHT hand = B/Y (short: sections shown / hidden, long: add one), the LEFT hand
// held = the thumbstick click's hold (the section frames hidden while held). It is dropped when the hand moves more than moveM (a missed aim, not a press) or the
// laser reaches a target. A palm turned to the face is the system menu / home gesture: never. Two quick pinches (doubleMs) on a section = the slice transparent / back.
export const EMPTY_PINCH={moveM:0.05,palmFacingCos:0.5,doubleMs:300};
// the palm faces the head: the palm normal (-Y of the wrist joint, WebXR) within acos(minCos) of wrist -> head. wp [x,y,z], wq [x,y,z,w], head [x,y,z] | {x,y,z}.
// A missing / non-finite input: false (the pinch is then judged by the other conditions).
const pfD=[0,0,0],pfN=[0,-1,0];
export function palmFacesHead(wp,wq,head,minCos=EMPTY_PINCH.palmFacingCos){
 if(!wp||!wq||!head)return false;
 const hx=(head.x??head[0])-wp[0],hy=(head.y??head[1])-wp[1],hz=(head.z??head[2])-wp[2],d=Math.hypot(hx,hy,hz);
 if(!(d>1e-6)||!(wq[0]-wq[0]===0)||!(wq[1]-wq[1]===0)||!(wq[2]-wq[2]===0)||!(wq[3]-wq[3]===0))return false;
 rotV(wq,pfN,pfD);
 return (pfD[0]*hx+pfD[1]*hy+pfD[2]*hz)/d>=minCos;
}

// ---- grab (a fist) = the grip ----
// A grip is a closed hand: all four fingers (index, middle, ring, pinky) curled into the palm. Pointing (index out) and pinching (thumb to index,
// the index stays bent out) are not a fist, so the pinch stays the trigger and aiming never grabs.
// curl of a finger = the straight distance metacarpal -> tip / the length of its bones (metacarpal -> proximal -> intermediate -> distal -> tip):
// ~1 extended, ~0.5 half bent, ~0.3-0.45 curled into the palm. Independent of the hand's size and of the pose in space.
export const GRAB_FINGERS=['index-finger','middle-finger','ring-finger','pinky-finger'];
export const GRAB_JOINT_NAMES=GRAB_FINGERS.map(f=>[f+'-metacarpal',f+'-phalanx-proximal',f+'-phalanx-intermediate',f+'-phalanx-distal',f+'-tip']);
const dist3=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
// j: 5 points {x,y,z} (a missing joint: null / undefined) -> curl, NaN when a joint is missing or the finger has no length
export function fingerCurl(j){
 if(!j)return NaN;
 let len=0;
 for(let i=1;i<5;i++){if(!j[i]||!j[i-1])return NaN;len+=dist3(j[i-1],j[i])}
 return len>1e-4?dist3(j[0],j[4])/len:NaN;
}
// the grab score of a hand = its least curled finger (NaN as soon as one finger is unknown): a fist needs all four
export function grabScore(curls){
 let m=-Infinity;
 for(let i=0;i<curls.length;i++){const c=curls[i];if(!Number.isFinite(c))return NaN;if(c>m)m=c}
 return Number.isFinite(m)?m:NaN;
}
// GRAB: start below `on` held for holdMs (a hand passing through a fist while a pinch opens does not grab), end above `off` (hysteresis: no flicker).
// holdMs 100 -> 60 (a closing hand passes through `on` only while it is really closing; the fist guard of the pinch is separate);
// near: the reach (m) of the direct grab (nearGrab below). Tunable on the device: localStorage vrl-hand-grab = '{"on":0.55,"off":0.7,"holdMs":60,"near":0.05}'
export const GRAB={on:0.55,off:0.7,holdMs:60,near:0.05};
// update(score, now, blocked) -> 'start' | 'end' | null. NaN keeps the state (a start that was pending is dropped). blocked (the hand is busy: it drags
// something) never starts a grab. release(): the grab was ended from outside (tracking lost / refused / ungrabbed): latched until the hand has opened
// (score above off) once, so a hand that comes back as a fist does not take the volume at once.
export function createGrabHysteresis({on=GRAB.on,off=GRAB.off,holdMs=GRAB.holdMs}={}){
 let active=false,since=null,latched=false;
 return{
  update(score,now,blocked=false){
   if(!Number.isFinite(score)){since=null;return null}
   if(active){if(score>off){active=false;since=null;return'end'}return null}
   if(latched){if(score>off)latched=false;since=null;return null}
   if(blocked||!(score<on)){since=null;return null}
   if(since===null)since=now;
   if(now-since>=holdMs){active=true;since=null;return'start'}
   return null;
  },
  release(){active=false;since=null;latched=true},
  reset(){active=false;since=null;latched=false},
  get active(){return active},
  get pending(){return since!==null},
 };
}
// a hand holding something (a grab,: or a pinch) is alive while its WRIST is tracked: turning the palm to the face / a fast wrist swing can
// drop the target-ray pose (the pinch ray needs the fingers' view) although the hand is still there; otherwise the target ray decides as before
export const handAlive=(rayVisible,wristTracked,holding)=>!!rayVisible||(!!holding&&!!wristTracked);
// the fist guard of a pinch: the thumb touches the index while the hand is closing into a fist. A fist is forming when the index AND middle /
// ring / little are all curled: curls[0] < index and curls[1..3] < others. Unknown curl: not forming.
// was middle / ring / little < 0.6 whatever the index did, which refused a normal pinch: those three fingers relax / tuck while
// pinching (MCP 50 / PIP 70 / DIP 35 deg gives ~0.57) — measured in tests/unit/vr-hand.test.js. The index of a tip-to-tip pinch stays ~0.65-0.8
// (it reaches out to the thumb), while closing into a fist it curls with the others (< 0.55 = GRAB.on). Tunable: vrl-hand-pinch guardIndex / guardOthers.
export const FIST_GUARD={index:0.6,others:0.5};
export function fistForming(curls,{index=FIST_GUARD.index,others=FIST_GUARD.others}={}){
 if(!curls||curls.length<4)return false;
 if(!Number.isFinite(curls[0])||!(curls[0]<index))return false;
 for(let i=1;i<4;i++){const c=curls[i];if(!Number.isFinite(c)||!(c<others))return false}
 return true;
}
// the point a fist holds the volume at (and the distance of two fists = the scale, vr-view.js: pinchScale(s0, d0, handDist())): the palm centre
export const PALM_FROM_WRIST=0.55; // palm centre = wrist + this * (middle-finger knuckle - wrist)
export const palmPoint=(w,k,out=[0,0,0])=>{for(let i=0;i<3;i++)out[i]=w[i]+PALM_FROM_WRIST*(k[i]-w[i]);return out};

// ---- direct grab: a fist that forms with the palm in / near an object takes that object itself (no laser) ----
// Distances in metres. Plain {x,y,z} (or three Vector3) in, numbers out; no allocation.
// the distance from p to the box [min,max] (0 inside or on it); a flat board (min.z == max.z) is its rectangle
export function boxDist(p,min,max){
 const dx=Math.max(min.x-p.x,0,p.x-max.x),dy=Math.max(min.y-p.y,0,p.y-max.y),dz=Math.max(min.z-p.z,0,p.z-max.z);
 return Math.sqrt(dx*dx+dy*dy+dz*dz);
}
// the distance from p to the box centred at the origin with half extents h = [hx,hy,hz]
export function centeredBoxDist(p,h){
 const dx=Math.max(Math.abs(p.x)-h[0],0),dy=Math.max(Math.abs(p.y)-h[1],0),dz=Math.max(Math.abs(p.z)-h[2],0);
 return Math.sqrt(dx*dx+dy*dy+dz*dz);
}
// the distance from p (in the section frame's own space: local X = the plane normal, the square |y|,|z| <= h) to the square's OUTLINE (the thin frame
// line): inside the square it is the distance to the nearest edge (and the offset off the plane), outside it is the distance to the square. The face of
// the square is not a target: the volume it cuts through is, so the volume stays grabbable with the sections on.
export function squareOutlineDist(p,h){
 const ay=Math.abs(p.y),az=Math.abs(p.z),ax=Math.abs(p.x);
 if(ay<=h&&az<=h){const e=h-Math.max(ay,az);return Math.sqrt(ax*ax+e*e)}
 const dy=Math.max(ay-h,0),dz=Math.max(az-h,0);
 return Math.sqrt(ax*ax+dy*dy+dz*dz);
}
// What a fist takes when several things are within `near`: the boards (menu, help, histogram, HU panel: the nearest, the listed order on a tie), else a
// section (its frame / number tag; the nearest), else the volume (inside its box or within near). Sections rank above the volume on purpose: a palm inside the
// box is at distance 0 from the volume and a section 2 cm away would never win otherwise. Each candidate is {kind,d,ref}; d = Infinity / NaN: not a candidate.
export const NEAR_KINDS=['menu','help','hist','hu','section','volume'];
const nearGroup=k=>k==='volume'?2:k==='section'?1:0;
export function pickNearGrab(cands,near=GRAB.near){
 let best=null,bg=9,bd=Infinity,bi=9;
 for(let i=0;i<cands.length;i++){
  const c=cands[i];if(!c||!(c.d<=near))continue;
  const g=nearGroup(c.kind),oi=NEAR_KINDS.indexOf(c.kind);
  if(!best||g<bg||(g===bg&&(c.d<bd-1e-6||(c.d<=bd+1e-6&&oi<bi)))){best=c;bg=g;bd=c.d;bi=oi}
 }
 return best;
}

// ---- tunables (localStorage), parsed from the JSON text (null / malformed / not an object: nothing) ----
const numOr=(v,min,max)=>{if(v===null||v===undefined||v==='')return undefined;const n=+v;return Number.isFinite(n)&&n>=min&&n<=max?n:undefined};
const pick=(v,spec)=>{const o={};if(!v||typeof v!=='object')return o;for(const k in spec){const n=numOr(v[k],spec[k][0],spec[k][1]);if(n!==undefined)o[k]=n}return o};
const jsonOf=t=>{try{return typeof t==='string'?JSON.parse(t):t}catch{return null}};
// vrl-hand-filter = '{"aMinCutoff":5,"aBeta":0.15,"aDCutoff":8}' (the palm anchor only: the ray is the system's, unfiltered)
export const parseFilterTune=t=>pick(jsonOf(t),{aMinCutoff:[0.05,60],aBeta:[0,5],aDCutoff:[0.1,60]});
// vrl-hand-grab = '{"on":0.55,"off":0.7,"holdMs":60,"near":0.05}'
export const parseGrabTune=t=>pick(jsonOf(t),{on:[0,1.5],off:[0,1.5],holdMs:[0,2000],near:[0,0.3]});
// vrl-hand-pinch = '{"on":0.018,"off":0.03,"onFrames":2,"offFrames":2,"own":1,"os":1,"osGapMs":100,"guardIndex":0.6,"guardOthers":0.5}'
// (own 0: the system's select alone, as before; os 0: the own pinch alone; guardIndex 0: no fist guard)
export const parsePinchTune=t=>pick(jsonOf(t),{on:[0.003,0.08],off:[0.003,0.12],onFrames:[1,10],offFrames:[1,10],own:[0,1],os:[0,1],osGapMs:[0,1000],guardIndex:[0,1.5],guardOthers:[0,1.5]});
// vrl-hand-drag = '{"carry":1,"gain":1,"rot":1,"blendMs":120}' (carry 0: a pinch drags with the system's (delayed) ray, as before)
export const parseDragTune=t=>pick(jsonOf(t),{carry:[0,1],gain:[0,5],rot:[0,1],blendMs:[0,1000]});

// ---- texts (hands only; the controller texts stay in vr-view.js) ----
export function handTexts(ja){
 return ja?{
  helpBasic:['ピンチ（短く）：点を記録／選択（点で長く：移動・削除・色・距離）','グー：ボリューム・板・メニューを掴む／両手でグー：拡大縮小','何もない所で右手ピンチ：断面の表示／非表示（長押し：追加）','何もない所で左手ピンチ長押し：断面の枠を隠す','断面の上で2回ピンチ：断面を透明／元に戻す','左手首の甲を顔へ：手首メニュー（「メニュー」で開閉）'],
  helpSec:['枠の細い線・番号札：ピンチで選択／つまんだまま動かして移動・回転','ピンチ（短く）：断面や組織に点を記録／点に当てて選択、点で長く：リング','手首メニューの「断面＋／－」：選んだ断面を法線方向へ送る（押し続ける）','何もない所で右手ピンチ：表示／非表示（長押し：追加）','何もない所で左手長押し：枠を隠す／断面の上で2回ピンチ：透明／戻す','グー：枠・ボリュームを掴む／両手グー：拡大縮小'],
  helpMenu:'ピンチ：メニューのボタン・スライダー／グー：メニュー板に手を重ねて移動',
  helpMenuSimple:'ピンチ：メニューのボタン・スライダー／グー：メニュー板に手を重ねて移動',
  wrist:on=>[['よく使う','（リング）'],['メニュー','開く／閉じる'],['断面',on?'非表示にする':'表示する'],['断面を','追加'],['取り消し',''],['断面','－'],['断面','＋']],
 }:{
  helpBasic:['Pinch (short): record / select a point (hold on a point: move, delete, colour, distance)','Fist on / near the volume, a board or the menu: grab it. Two fists: scale','Right pinch in empty space: sections show / hide (hold: add a section)','Left pinch held in empty space: hide the section frames','Two quick pinches on a section: slice transparent / back','Back of the left wrist to your eyes: wrist menu (“Menu” opens / closes the menu)'],
  helpSec:['Thin frame line / number tag: pinch selects, pinch and move to slide / rotate','Pinch (short): record a point on a section or tissue; on a point selects it; hold on a point: ring','Wrist menu “Section + / -”: slides the selected section along its normal (hold)','Right pinch in empty space: show / hide sections (hold: add)','Left pinch held in empty space: hide frames; 2 quick pinches on a section: slice clear / back','Fist on a section frame or the volume: grab, move / turn; two fists: scale'],
  helpMenu:'Pinch: menu buttons and sliders; fist on the menu board: move it',
  helpMenuSimple:'Pinch: menu buttons and sliders; fist on the menu board: move it',
  wrist:on=>[['Quick','ring'],['Menu','open / close'],['Sections',on?'hide':'show'],['Add','section'],['Undo',''],['Section','-'],['Section','+']],
 };
}
