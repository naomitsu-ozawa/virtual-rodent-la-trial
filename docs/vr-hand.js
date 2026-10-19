// build 625: hand tracking (Quest 3), phase 0 / 1: the pure part — no DOM and no three.js (unit-tested in tests/unit/vr-hand.test.js).
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
// (add a section), 取り消し (the ring's undo)
export const WRIST_ITEMS=['ring','menu','section','add','undo'];
export const wristSlotFromU=u=>Number.isFinite(u)?Math.max(0,Math.min(WRIST_ITEMS.length-1,Math.floor(u*WRIST_ITEMS.length))):null;

// ---- texts (hands only; the controller texts stay in vr-view.js) ----
export function handTexts(ja){
 return ja?{
  helpBasic:['ピンチ（短く）：点を記録／点を選択（点で長くつまむ：移動・削除・色・距離）','左手首の甲を顔に向ける：手首メニュー（A/X・B/Y の代わり）','手首メニュー：右手のレーザーで指してピンチ','つまんだまま2cm動かす：断面を動かす','ボリュームの移動・回転・拡大縮小：コントローラーで','手首メニューの「メニュー」：メニューの開閉'],
  helpSec:['枠の細い線・番号札：ピンチで選択／つまんだまま動かして移動・回転','ピンチ（短く）：断面や組織に点を記録／点に当てて選択','点で長くつまむ：移動・削除・色・距離のリング','左手首の甲を顔に向ける：手首メニュー（断面の表示／非表示・追加）','断面のスクロール・ボリュームの移動・拡大縮小：コントローラーで','手首メニューの「メニュー」：メニューの開閉'],
  helpMenu:'ピンチ：メニューのボタン・スライダー（板の移動はコントローラーで）',
  helpMenuSimple:'ピンチ：メニューのボタン（板の移動はコントローラーで）',
  wrist:on=>[['よく使う','（リング）'],['メニュー','開く／閉じる'],['断面',on?'非表示にする':'表示する'],['断面を','追加'],['取り消し','']],
 }:{
  helpBasic:['Pinch (short): record / select a point (hold on a point: move, delete, colour, distance)','Back of the left wrist to your eyes: wrist menu (replaces A/X, B/Y)','Wrist menu: point with the right hand and pinch','Pinch and move 2 cm: drag a section','Move / turn / scale the volume: with the controllers','Wrist menu “Menu”: open / close the menu'],
  helpSec:['Thin frame line / number tag: pinch selects, pinch and move to slide / rotate','Pinch (short): record a point on a section or tissue; on a point selects it','Hold the pinch on a point: ring with move / delete / colour / distance','Back of the left wrist to your eyes: wrist menu (show / hide / add sections)','Scroll a section, move / scale the volume: with the controllers','Wrist menu “Menu”: open / close the menu'],
  helpMenu:'Pinch: menu buttons and sliders (moving a board: with the controllers)',
  helpMenuSimple:'Pinch: menu buttons (moving a board: with the controllers)',
  wrist:on=>[['Quick','ring'],['Menu','open / close'],['Sections',on?'hide':'show'],['Add','section'],['Undo','']],
 };
}
