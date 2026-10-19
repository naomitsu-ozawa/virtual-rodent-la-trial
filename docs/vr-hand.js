// build 625: hand tracking (Quest 3), phase 0 / 1 / 2 (phase 2: the fist = the grip, 断面 +/- on the wrist menu): the pure part — no DOM and no three.js (unit-tested in tests/unit/vr-hand.test.js).
// vr-hand-view.js does the three.js side (the filtered / delayed target ray written back into the controller group, the wrist menu, the
// fingertip markers); vr-view.js only routes its events there. Every hand branch is guarded by isHand(source): an XRInputSource with .hand
// (granted only with the optional 'hand-tracking' feature). Controllers never reach this code, and their behaviour is unchanged.
// Poses are plain arrays [px,py,pz,qx,qy,qz,qw] (metres, unit quaternion) in the XR reference space; times in ms (performance.now / XR time).

export const isHand=s=>!!(s&&s.hand);

// ---- One Euro filter (Casiez, Roussel, Vogel, CHI 2012) ----
// Low-pass whose cutoff rises with the speed: cutoff = minCutoff + beta * speed * speedScale (Hz). speed = the length of the filtered
// derivative over all n channels (units/s); speedScale converts it to the unit beta is tuned for (1000: metres -> mm, so beta 0.01 = +1 Hz
// per 100 mm/s). minCutoff 1 Hz: the hand's jitter at rest is smoothed; a fast move raises the cutoff so the ray does not trail.
export const ONE_EURO={minCutoff:1,beta:0.01,dCutoff:1};
export const euroAlpha=(cutoffHz,dtS)=>{const r=2*Math.PI*cutoffHz*dtS;return r/(r+1)};
export function createOneEuro(n,{minCutoff=ONE_EURO.minCutoff,beta=ONE_EURO.beta,dCutoff=ONE_EURO.dCutoff,speedScale=1}={}){
 const x=new Float64Array(n),dx=new Float64Array(n);let t=null;
 return{
  // v: n numbers (array-like) at time now (ms) -> the filtered values written into out (default: v itself), returned. No allocation.
  filter(v,now,out=v){
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
// on below PINCH_ON_M, off again only above PINCH_OFF_M (no flicker at the edge). A missing distance keeps the state.
export const PINCH_ON_M=0.015,PINCH_OFF_M=0.025;
export function createPinchHysteresis({on=PINCH_ON_M,off=PINCH_OFF_M}={}){
 let pinched=false;
 return{
  update(d){if(!Number.isFinite(d))return pinched;if(pinched){if(d>off)pinched=false}else if(d<on)pinched=true;return pinched},
  reset(){pinched=false},
  get pinched(){return pinched},
 };
}

// ---- delayed ray ----
// Closing / opening the fingers moves the system's pinch ray just before the pinch is recognised (and just after it ends). The hand's ray is
// therefore taken RAY_DELAY_MS in the past: the target under the ray at selectstart / selectend is where the ray was before the fingers moved.
// A ring of the last `size` poses; at(t) = the newest pose at or before t (the oldest one when the record is shorter than the delay).
export const RAY_DELAY_MS=60;
export function createPoseHistory(size=24){
 const T=new Float64Array(size),P=new Float64Array(size*7);let head=0,count=0;
 return{
  push(t,pose){const k=head*7;T[head]=t;for(let i=0;i<7;i++)P[k+i]=pose[i];head=(head+1)%size;if(count<size)count++},
  // writes the pose into out and returns its time, or null when nothing was recorded
  at(t,out){
   if(!count)return null;
   let k=(head-count+size)%size; // the oldest
   for(let j=1;j<=count;j++){const m=(head-j+size)%size;if(T[m]<=t){k=m;break}}
   for(let i=0;i<7;i++)out[i]=P[k*7+i];
   return T[k];
  },
  reset(){head=0;count=0},
  get length(){return count},
 };
}

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
// the wrist menu's buttons, left to right: A/X short (the quick ring), A/X long (the menu), B/Y short (sections shown / hidden), B/Y long
// (add a section), 取り消し (the ring's undo), then 断面 － / ＋ (the selected section along its normal = the thumbstick up / down: hold to repeat)
export const WRIST_ITEMS=['ring','menu','section','add','undo','secDown','secUp'];
export const wristSlotFromU=u=>Number.isFinite(u)?Math.max(0,Math.min(WRIST_ITEMS.length-1,Math.floor(u*WRIST_ITEMS.length))):null;
// 断面 －/＋ held on the wrist menu: the thumbstick's deflection (1 = full) after heldMs. A tap nudges (0.4), holding speeds up to full in 1 s.
// ＋ = the thumbstick pushed up (the plane moves along +X, its normal), － = pulled back; the sign is returned by wristScrollSign.
export const WRIST_SCROLL={start:0.4,rampMs:1000};
export const wristScrollGain=heldMs=>{const f=Math.max(0,Math.min(1,(heldMs||0)/WRIST_SCROLL.rampMs));return WRIST_SCROLL.start+(1-WRIST_SCROLL.start)*f};
// 断面 －/＋ keeps scrolling only while the ray stays on the SAME button, the hand is not a fist, and nothing the scroll needs went away
export const wristScrollKeep=(heldId,hitId,fist)=>!!heldId&&hitId===heldId&&!fist;
export const wristScrollSign=id=>id==='secUp'?-1:id==='secDown'?1:0; // the `scroll` sum of vr-view.js: thumbstick down = +, up = -

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
// Tunable on the device: localStorage vrl-hand-grab = '{"on":0.55,"off":0.7,"holdMs":100}'
export const GRAB={on:0.55,off:0.7,holdMs:100};
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
// a hand holding something (a grab) is alive while its WRIST is tracked: turning the palm to the face can drop the target-ray pose (the pinch ray
// needs the fingers' view) although the hand is still there; without a grab the target ray decides as before (it is the pointer)
export const handAlive=(rayVisible,wristTracked,grabbing)=>!!rayVisible||(!!grabbing&&!!wristTracked);
// the fist guard of a pinch: the thumb touches the index while the hand is still closing into a fist. middle / ring / little (curls[1..3]) already
// below `max` = a fist is forming -> the pinch is not a trigger (an aiming pinch keeps those fingers open / relaxed, 0.7-1). Unknown curl: not forming.
export const FIST_GUARD_CURL=0.6;
export function fistForming(curls,max=FIST_GUARD_CURL){
 if(!curls||curls.length<4)return false;
 for(let i=1;i<4;i++){const c=curls[i];if(!Number.isFinite(c)||!(c<max))return false}
 return true;
}
// the point a fist holds the volume at (and the distance of two fists = the scale, vr-view.js: pinchScale(s0, d0, handDist())): the palm centre
export const PALM_FROM_WRIST=0.55; // palm centre = wrist + this * (middle-finger knuckle - wrist)
export const palmPoint=(w,k,out=[0,0,0])=>{for(let i=0;i<3;i++)out[i]=w[i]+PALM_FROM_WRIST*(k[i]-w[i]);return out};

// ---- texts (hands only; the controller texts stay in vr-view.js) ----
export function handTexts(ja){
 return ja?{
  helpBasic:['ピンチ（短く）：点を記録／点を選択（点で長くつまむ：移動・削除・色・距離）','グー（拳を握る）：ボリュームを掴んで移動・回転／板に向けて握ると板を移動','両手でグー：2つの拳の間隔で拡大・縮小','左手首の甲を顔に向ける：手首メニュー（A/X・B/Y・断面＋／－の代わり）','手首メニュー：右手のレーザーで指してピンチ','手首メニューの「メニュー」：メニューの開閉'],
  helpSec:['枠の細い線・番号札：ピンチで選択／つまんだまま動かして移動・回転','ピンチ（短く）：断面や組織に点を記録／点に当てて選択、点で長くつまむ：リング','手首メニューの「断面＋／－」：選んだ断面を法線方向へ送る（押し続ける）','グー：ボリュームの移動・回転・板の移動／両手でグー：拡大・縮小','左手首の甲を顔に向ける：手首メニュー（断面の表示／非表示・追加）','手首メニューの「メニュー」：メニューの開閉'],
  helpMenu:'ピンチ：メニューのボタン・スライダー／グー：メニュー板を移動',
  helpMenuSimple:'ピンチ：メニューのボタン／グー：メニュー板を移動',
  wrist:on=>[['よく使う','（リング）'],['メニュー','開く／閉じる'],['断面',on?'非表示にする':'表示する'],['断面を','追加'],['取り消し',''],['断面','－'],['断面','＋']],
 }:{
  helpBasic:['Pinch (short): record / select a point (hold on a point: move, delete, colour, distance)','Fist: grab the volume and move / turn it; a fist aimed at a board moves the board','Two fists: the distance between them scales the volume','Back of the left wrist to your eyes: wrist menu (replaces A/X, B/Y, section + / -)','Wrist menu: point with the right hand and pinch','Wrist menu “Menu”: open / close the menu'],
  helpSec:['Thin frame line / number tag: pinch selects, pinch and move to slide / rotate','Pinch (short): record a point on a section or tissue; on a point selects it; hold on a point: ring','Wrist menu “Section + / -”: slides the selected section along its normal (hold)','Fist: move / turn the volume, move a board; two fists: scale','Back of the left wrist to your eyes: wrist menu (show / hide / add sections)','Wrist menu “Menu”: open / close the menu'],
  helpMenu:'Pinch: menu buttons and sliders; fist: move the menu board',
  helpMenuSimple:'Pinch: menu buttons; fist: move the menu board',
  wrist:on=>[['Quick','ring'],['Menu','open / close'],['Sections',on?'hide':'show'],['Add','section'],['Undo',''],['Section','-'],['Section','+']],
 };
}
