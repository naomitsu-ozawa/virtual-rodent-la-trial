// hand tracking (Quest 3), phase 1 / 2: the three.js side. vr-view.js passes THREE, the renderer and a few callbacks; everything here acts
// on a controller group only while its input source is a hand (isHand(c.userData.source), state c.userData.hs) — controllers are never touched.
//  - the hand's target ray:: the hand's own aim ray from the joints (aimRayPose: from the index knuckle along the index metacarpal, AIM_FILTER, the aim hold
//    while a pinch is closing), written back into the group's matrix every frame and again before each select event (three refreshes it from the frame right before
//    dispatching them). The system's target ray (the pose rayDelayMs() ago, 0 for an open hand, up to 60 ms while thumb and index are close, One Euro filtered) is
//    the fallback while the joints are missing (or with vrl-hand-ray joint 0)
//  - tracking loss: > LOSS_CANCEL_MS without a pose drops the hand's press / drag (the disconnect release); the first frame back is skipped
//  - the wrist menu (the back of the left wrist turned to the eyes) and the fingertip markers (index tip, thumb tip; white while pinched)
//  - pulse(): a hand has no haptics; the end dot and the fingertips swell for a moment instead
//  - phase 2: the fist (all four fingers curled) = the grip: its start / end go to vr-view.js (grab / ungrab = the squeezestart / squeezeend bodies); what a
//    grab holds (the volume, a board) is attached to the hand's palm anchor (holder(c)), not to the pinch ray (it does not follow the wrist's turn)
//  -: the pinch is the hand's own (thumb tip - index tip, createPinchFusion) OR the system's select, one press per pinch. vr-view.js sees only
//    the selectstart / selectend this file dispatches on the group ({handPinch:true}); the system's own select events of a hand are swallowed there.
//    While a pinch is held the group carries the press's ray with the palm anchor (createDragCarry: 1:1, the wrist's turn included, no 60 ms delay)
//    instead of the system's ray; after the release it blends back to the system's ray in blendMs.
// Per frame: no allocation (reused vectors / typed arrays; the wrist menu's canvas is redrawn only when its state key changes).
import { isHand, handAlive, fistForming, FIST_GUARD, createGrabHysteresis, grabScore, fingerCurl, GRAB_JOINT_NAMES, GRAB, palmPoint, createPoseFilter, createPoseHistory, createPinchFusion, createDragCarry, blendPose, DRAG_CARRY, parsePinchTune, parseDragTune, createTrackingLoss, createWristMenuGate, wristMenuMetrics, createOneEuro, RAY_DELAY, rayDelayMs, slewDelay, PALM_FILTER, ONE_EURO, parseFilterTune, parseGrabTune, WRIST_ITEMS, wristSlotFromU, handTexts, AIM_RAY, AIM_FILTER, AIM_HOLD, aimRayPose, thumbSideOf, createAimHold, turnToward, parseRayTune } from './vr-hand.js?v=20261020-build627';
import { DRAG_HAND, DRAG_RECORD_HAND, HAND_LABEL_MOVE_M } from './vr-point.js?v=20261020-build627';
export { HAND_LABEL_MOVE_M };

const TIP_R=0.0045,WRIST_W=0.28,WRIST_H=0.04,WRIST_LIFT=0.055,CW=1400,CH=200,GRAB_TIP=0xffa000,REACH_TIP=0x39ff6a; // 7 buttons of 4 cm; the fingertips: orange = holding, green = something is within reach of a fist

// near(c, nearM): the object a fist would take directly now ({kind,...}) or null; grab(c, target): target = that object (direct) or null (the laser decides)
export function createHandInput(THREE,{renderer,scene,controllers,ja,getHead,colorOf,release,handInHolder,sectionOn,avail,grab,ungrab,busy,near}){
 const texts=handTexts(ja);
 const one=new THREE.Vector3(1,1,1),tP=new THREE.Vector3(),tQ=new THREE.Quaternion(),tS=new THREE.Vector3(),tM=new THREE.Matrix4(),tC=new THREE.Color(),pj=Array.from({length:5},()=>null),curls=[0,0,0,0],pw=[0,0,0],pk=[0,0,0],pp=[0,0,0],pose7=new Float64Array(7),tW=new THREE.Vector3(),tWq=new THREE.Quaternion(),tD=new THREE.Vector3();
 const qI=new THREE.Quaternion(),zero=new THREE.Vector3(0,0,0),wp=[0,0,0],wq=[0,0,0,1],met={facing:0,across:0,dist:0},w3=new Float64Array(3);
 const jp7=new Float64Array(7),jq=[0,0,0,1],ip=[0,0,0],tp=[0,0,0],ak=[0,0,0]; // the aim ray's temporaries
 // fingertip markers: 2 per slot (index tip, thumb tip), at most 4 instances; hidden when no hand is there
 const tips=new THREE.InstancedMesh(new THREE.SphereGeometry(TIP_R,10,6),new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}),4);
 tips.frustumCulled=false;tips.visible=false;tips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 tM.compose(zero,qI,zero);for(let i=0;i<4;i++){tips.setMatrixAt(i,tM);tips.setColorAt(i,tC.set(0xffffff))}
 scene.add(tips);
 // wrist menu: one row of buttons, drawn without a depth test (like the rings), facing the head
 const canvas=document.createElement('canvas');canvas.width=CW;canvas.height=CH;const ctx=canvas.getContext('2d');
 const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
 const wrist=new THREE.Mesh(new THREE.PlaneGeometry(WRIST_W,WRIST_H),new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false,depthTest:false,depthWrite:false,side:THREE.DoubleSide})); // both sides: the other hand's ray often comes from behind the plane (it faces the eyes)
 wrist.renderOrder=7;wrist.visible=false;scene.add(wrist);
 const gate=createWristMenuGate(),wristF=createOneEuro(3,{speedScale:1000});
 let wristKey=-1,hover=null,hoverNext=null,leftC=null;
 const lsGet=k=>{try{return localStorage.getItem(k)}catch{return null}};
 const grabTune=parseGrabTune(lsGet('vrl-hand-grab')),nearM=grabTune.near??GRAB.near; // vrl-hand-grab = '{"on":0.55,"off":0.7,"holdMs":60,"near":0.05}' (read once per session)
 const draw=(key,on)=>{
  if(key===wristKey)return;wristKey=key;
  const labels=texts.wrist(on),n=WRIST_ITEMS.length,bw=CW/n;
  ctx.clearRect(0,0,CW,CH);
  for(let i=0;i<n;i++){
   const ok=avail(WRIST_ITEMS[i]);
   ctx.globalAlpha=ok?1:0.4;ctx.fillStyle=hover===i&&ok?'#2d6cdf':'rgba(31,42,54,.92)';ctx.beginPath();ctx.roundRect(i*bw+6,6,bw-12,CH-12,26);ctx.fill();
   ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
   const [a,b]=labels[i];ctx.font='bold 40px system-ui,sans-serif';ctx.fillText(a,i*bw+bw/2,b?78:CH/2,bw-24);
   if(b){ctx.font='30px system-ui,sans-serif';ctx.fillText(b,i*bw+bw/2,136,bw-24)}
  }
  ctx.globalAlpha=1;tex.needsUpdate=true;
 };
 // the filters / the ray delay can be tuned on the device without a new build: localStorage vrl-hand-filter = '{"minCutoff":1.2,"beta":0.05,"dCutoff":5,"aMinCutoff":5,"aBeta":0.15,"aDCutoff":8,"delayMs":60,"delayFar":0.06,"delayNear":0.03}' (read once per session)
 const ft=parseFilterTune(lsGet('vrl-hand-filter')),tune={minCutoff:ft.minCutoff??ONE_EURO.minCutoff,beta:ft.beta??ONE_EURO.beta,dCutoff:ft.dCutoff??ONE_EURO.dCutoff};
 const palmTune={minCutoff:ft.aMinCutoff??PALM_FILTER.minCutoff,beta:ft.aBeta??PALM_FILTER.beta,dCutoff:ft.aDCutoff??PALM_FILTER.dCutoff},delayTune={maxMs:ft.delayMs??RAY_DELAY.maxMs,farM:ft.delayFar??RAY_DELAY.farM,nearM:ft.delayNear??RAY_DELAY.nearM};
 // the pinch (vrl-hand-pinch) and the pinch drag (vrl-hand-drag), read once per session as the others
 const pt=parsePinchTune(lsGet('vrl-hand-pinch')),guardTune={index:pt.guardIndex??FIST_GUARD.index,others:pt.guardOthers??FIST_GUARD.others};
 const dk=parseDragTune(lsGet('vrl-hand-drag')),carryOn=(dk.carry??DRAG_CARRY.carry)>0,carryTune={gain:dk.gain??DRAG_CARRY.gain,rot:dk.rot??DRAG_CARRY.rot},blendMs=dk.blendMs??DRAG_CARRY.blendMs;
 // the hand's own aim ray (vrl-hand-ray = '{"joint":1,"pitch":8,"yaw":4,"minCutoff":2,"beta":0.15,"dCutoff":5,"holdDeg":10,"holdSpeed":0.12,"holdMs":60,"rampMs":120}', read once per session)
 const rt=parseRayTune(lsGet('vrl-hand-ray')),aimOn=(rt.joint??AIM_RAY.joint)>0,aimOff={pitchDeg:rt.pitch??AIM_RAY.pitchDeg,yawDeg:rt.yaw??AIM_RAY.yawDeg};
 const aimTune={minCutoff:rt.minCutoff??AIM_FILTER.minCutoff,beta:rt.beta??AIM_FILTER.beta,dCutoff:rt.dCutoff??AIM_FILTER.dCutoff},holdTune={degPerS:rt.holdDeg??AIM_HOLD.degPerS,speed:rt.holdSpeed??AIM_HOLD.speed,tailMs:rt.holdMs??AIM_HOLD.tailMs,rampMs:rt.rampMs??AIM_HOLD.rampMs};
 const newState=hand=>({hand,filter:createPoseFilter(tune),hist:createPoseHistory(),loss:createTrackingLoss(),pinch:createPinchFusion(pt),raw:new Float64Array(7),del:new Float64Array(7),out:new Float64Array(7),has:false,flashAt:0,flashMs:0,flashAmp:0,rebased:null,
  grab:createGrabHysteresis(grabTune),aFilter:createPoseFilter(palmTune),anchor:null,anchorOk:false,pd:NaN,delay:0,lastNow:0,near:null,
  palm7:new Float64Array(7),palmAt:-1,carry:createDragCarry(),cout:new Float64Array(7),bout:new Float64Array(7),shown:null,carryLost:false,blendAt:-Infinity,
  aim:createPoseFilter(aimTune),hold:createAimHold(holdTune),jr:new Float64Array(7),lastQ:new Float64Array(4),src:null,side:0}); // the joint aim ray (src: 'joint' | 'sys', the ray the group shows)
 // the group gets the hand's pose o = [px,py,pz,qx,qy,qz,qw] (target-ray space: -z along the ray); children (the laser) follow
 const apply=(c,o)=>{tP.set(o[0],o[1],o[2]);tQ.set(o[3],o[4],o[5],o[6]);c.position.copy(tP);c.quaternion.copy(tQ);c.matrix.compose(tP,tQ,one);c.matrixWorldNeedsUpdate=true;c.updateMatrixWorld(true)};
 // the pose on the group: the carried press ray while a pinch is held (and the blend back after it), else the system's filtered / delayed ray
 const shownPose=hs=>hs.shown||hs.out;
 const dropPinch=hs=>{hs.pinch.cancel();hs.carry.stop();hs.shown=null}; // the press was dropped from outside: no selectend, the pinch must open first
 const tick=(c,hs,now)=>{
  const holding=hs.grab.active||hs.pinch.pressed,wristOk=holding&&!!joint(hs,'wrist'); // a fist / pinch holding something: the wrist joint decides (a palm turned to the face or a fast swing can lose the target ray)
  const st=hs.loss.update(handAlive(c.visible,wristOk,holding),now);
  if(st==='cancel'){release(c);hs.rebased=null;hs.grab.release();dropPinch(hs)} // release() also lets go of what the fist held; the fist must open before it grabs again
  if(st!=='ok'){if(st==='recover'){hs.filter.reset();hs.hist.reset();hs.aFilter.reset();hs.aim.reset();hs.hold.reset();hs.delay=0}if(hs.has)apply(c,shownPose(hs));return false}
  const it=joint(hs,'index-finger-tip'),th=joint(hs,'thumb-tip');hs.pd=it&&th?it.position.distanceTo(th.position):NaN; // also while the ray is lost (the pinch goes on)
  if(!c.visible){if(hs.has)apply(c,shownPose(hs));return true} // alive by the wrist only: the stale raw ray is not fed to the filter
  c.matrix.decompose(tP,tQ,tS);const r=hs.raw;r[0]=tP.x;r[1]=tP.y;r[2]=tP.z;r[3]=tQ.x;r[4]=tQ.y;r[5]=tQ.z;r[6]=tQ.w; // three wrote the raw ray pose this frame
  // the ray is delayed only while the thumb and index are close (a pinch forming / ending); an open hand has the live ray
  hs.delay=slewDelay(hs.delay,rayDelayMs(hs.pd,delayTune),now-hs.lastNow);hs.lastNow=now;
  hs.hist.push(now,r); // every frame, whatever ray is shown: the fallback finds a record when it takes over
  const jr=aimOn?aimRay(hs,c):null; // the hand's own aim ray from the joints, no delay; the system's ray only while the joints are missing
  if(jr){
   if(hs.src!=='joint'){hs.aim.reset();hs.hold.reset();hs.src='joint'} // a switch of the ray model: the filter starts from the new ray (one step, not a slew from a stale pose)
   hs.aim.filter(jr,now,hs.out);
   const lim=hs.hold.update(hs.pd,now);if(hs.has&&lim<Infinity)turnToward(hs.lastQ,0,hs.out,3,lim,hs.out,3); // the pinch is closing: the direction is held
  }else{
   if(hs.src!=='sys'){hs.filter.reset();hs.src='sys'}
   const t=hs.hist.at(now-hs.delay,hs.del);hs.filter.filter(hs.del,t,hs.out);
  }
  for(let i=0;i<4;i++)hs.lastQ[i]=hs.out[3+i];
  hs.has=true;apply(c,shownPose(hs));
  // the drag reference of a press is taken again once the delayed ray has passed the pinch itself (until then the hand's press does not drag).
  // not for a carried press (its reference is right at the press: the carried ray has no pinch jump and no delay).: the joint ray has no delay either
  const pr=c.userData.press;if(pr&&hs.rebased!==pr&&!hs.carry.active&&now-pr.t0>=(hs.src==='joint'?0:delayTune.maxMs)){const hp=handInHolder(c);pr.p0=hp.p;pr.q0=hp.q;hs.rebased=pr}
  return true;
 };
 // the hand's own aim ray (aimRayPose) from this frame's joints, or null when they are missing: the index metacarpal's bone axis (the wrist's as
 // fallback) from the index knuckle; which side the thumb lies on (the yaw toward it) is read from the thumb's base joint, else from the handedness
 const aimRay=(hs,c)=>{
  const kn=joint(hs,'index-finger-phalanx-proximal'),mc=joint(hs,'index-finger-metacarpal')||joint(hs,'wrist');if(!kn||!mc)return null;
  mc.matrix.decompose(tW,tWq,tS);const j=jp7;j[0]=tW.x;j[1]=tW.y;j[2]=tW.z;j[3]=tWq.x;j[4]=tWq.y;j[5]=tWq.z;j[6]=tWq.w;
  const tb=joint(hs,'thumb-metacarpal')||joint(hs,'thumb-phalanx-proximal');
  if(tb){jq[0]=j[3];jq[1]=j[4];jq[2]=j[5];jq[3]=j[6];ip[0]=j[0];ip[1]=j[1];ip[2]=j[2];tp[0]=tb.position.x;tp[1]=tb.position.y;tp[2]=tb.position.z;const s=thumbSideOf(jq,ip,tp);if(s)hs.side=s}
  if(!hs.side)hs.side=c.userData.source?.handedness==='left'?1:-1; // WebXR joint axes: +X runs across the hand toward the little finger of a right hand
  ak[0]=kn.position.x;ak[1]=kn.position.y;ak[2]=kn.position.z;
  return aimRayPose(j,ak,hs.side,aimOff,hs.jr);
 };
 // the carried press ray, every frame while a pinch is held and during the blend back to the system's ray after the release
 const carryStep=(c,hs,now)=>{
  if(!hs.carry.active)return;
  const fresh=hs.palmAt===now;
  if(fresh){if(hs.carryLost){hs.carry.rebase(hs.cout,hs.palm7);hs.carryLost=false}hs.carry.step(hs.palm7,hs.cout,carryTune)}else hs.carryLost=true; // no palm this frame: the ray stays, then follows on from where it is
  if(hs.pinch.pressed){hs.shown=hs.cout;if(fresh)c.visible=true} // the carried ray is the hand's own: its laser shows even while the system's ray is lost
  else{const k=blendMs>0?(now-hs.blendAt)/blendMs:1;if(k>=1){hs.carry.stop();hs.shown=null}else hs.shown=blendPose(hs.cout,hs.out,k,hs.bout)}
  apply(c,shownPose(hs));
 };
 const guardNow=(c,hs)=>hs.grab.active||(fistScore(hs),fistForming(curls,guardTune)); // a fist (forming): no press
 // a press starts / ends (own pinch or the system's select): vr-view.js's select handlers run now, on the group, with the pose shown
 const pinchEdge=(c,hs,ev,now)=>{
  if(ev==='start'){
   if(carryOn&&hs.palmAt>=0&&now-hs.palmAt<100){hs.carry.start(shownPose(hs),hs.palm7);hs.carry.step(hs.palm7,hs.cout,carryTune);hs.carryLost=hs.palmAt!==now;hs.shown=hs.cout}else{hs.carry.stop();hs.shown=null}
   apply(c,shownPose(hs));c.dispatchEvent({type:'selectstart',handPinch:true,data:c.userData.source});
   const pr=c.userData.press;if(pr&&hs.carry.active)hs.rebased=pr; // the reference selectstart took is final (no pinch jump to wait for)
  }else{
   apply(c,shownPose(hs));c.dispatchEvent({type:'selectend',handPinch:true,data:c.userData.source});
   hs.blendAt=now;if(!hs.carry.active)hs.shown=null;
  }
 };
 const pinchStep=(c,hs,now)=>{const ev=hs.pinch.own(hs.pd,now,!hs.pinch.pressed&&guardNow(c,hs));if(ev)pinchEdge(c,hs,ev,now)};
 // the palm anchor (the wrist's orientation, the palm centre, lightly filtered: what a fist holds) and the fist detector (curl of the 4 fingers)
 const palm=(hs,now)=>{
  const w=joint(hs,'wrist'),k=joint(hs,'middle-finger-phalanx-proximal');if(!w||!k)return;
  w.matrix.decompose(tW,tWq,tS);pw[0]=tW.x;pw[1]=tW.y;pw[2]=tW.z;pk[0]=k.position.x;pk[1]=k.position.y;pk[2]=k.position.z;palmPoint(pw,pk,pp);
  const r=pose7;r[0]=pp[0];r[1]=pp[1];r[2]=pp[2];r[3]=tWq.x;r[4]=tWq.y;r[5]=tWq.z;r[6]=tWq.w;
  hs.aFilter.filter(r,now,r);hs.palm7.set(r);hs.palmAt=now; // also what a pinch carries its ray with
  const a=hs.anchor;a.position.set(r[0],r[1],r[2]);a.quaternion.set(r[3],r[4],r[5],r[6]);a.updateMatrixWorld(true);hs.anchorOk=true;
 };
 const fistScore=hs=>{
  for(let f=0;f<4;f++){const nm=GRAB_JOINT_NAMES[f];for(let i=0;i<5;i++){const j=joint(hs,nm[i]);pj[i]=j?j.position:null}curls[f]=fingerCurl(pj)}
  return grabScore(curls);
 };
 const grabStep=(c,hs,now)=>{
  palm(hs,now);
  if(!hs.anchorOk)return;
  const ev=hs.grab.update(fistScore(hs),now,!!busy(c));
  if(ev==='start'){
   if(c.userData.press)release(c); // a pinch that stays in a fist (the thumb lies on the index): the fist wins, the press is dropped
   if(hs.pinch.pressed)dropPinch(hs); // and the pinch must open before it presses again
   // what the palm is in / near is taken directly (no laser); the anchor starts exactly at the palm so the object keeps its offset (no snap by the filter's lag)
   hs.aFilter.reset();palm(hs,now);hs.near=near?near(c,nearM):null;
   if(grab(c,hs.near)===false)hs.grab.release(); // refused (e.g. the fist is on the wrist menu): the fist must open first
   hs.near=null;
  }else if(ev==='end')ungrab(c);
  else hs.near=hs.grab.active||!near?null:near(c,nearM); // the thing a fist would take now (lights the fingertips / the frame)
 };
 const flashK=(hs,now)=>{const e=Math.max(0,now-hs.flashAt);return hs.flashMs&&e<hs.flashMs?1-e/hs.flashMs:0}; // 1 at the pulse, 0 after flashMs
 const joint=(hs,name)=>{const j=hs.hand?.joints?.[name];return j&&j.visible?j:null};
 const setTip=(i,j,col,s)=>{if(j){tS.set(s,s,s);tM.compose(j.position,qI,tS)}else tM.compose(zero,qI,zero);tips.setMatrixAt(i,tM);tips.setColorAt(i,tC.set(col))};
 const api={
  texts,
  anyHand:()=>controllers.some(c=>isHand(c.userData.source)),
  // 'connected' with a hand: per-hand state; renderer.xr.getHand(i) only now (three updates its joints from then on, while a hand is in slot i)
  connect(c,i){if(!isHand(c.userData.source))return;const hs=c.userData.hs=newState(renderer.xr.getHand(i));hs.anchor=new THREE.Object3D();scene.add(hs.anchor)},
  // 'disconnected' of a hand / a controller in a slot a hand had
  drop(c){const a=c.userData.hs?.anchor;if(a)scene.remove(a);c.userData.hs=null;c.userData.dot?.scale.setScalar(1);if(leftC===c){leftC=null;gate.reset();wrist.visible=false}},
  // before the select handlers of vr-view.js: three has just written the raw pose of the event's frame; the hand's filtered / delayed pose goes back.
  // the system's own select of a hand (not ours: no handPinch) is one input of the pinch (createPinchFusion); vr-view.js ignores it itself
  eventPose(c,e){if(!isHand(c.userData.source))return;const hs=c.userData.hs;if(!hs)return;if(hs.has)apply(c,shownPose(hs));if(e?.handPinch||(e?.type!=='selectstart'&&e?.type!=='selectend'))return;
   const now=performance.now(),down=e.type==='selectstart',ev=hs.pinch.os(down,now,down&&!hs.pinch.pressed&&guardNow(c,hs));if(ev)pinchEdge(c,hs,ev,now)},
  // the drag threshold of a hand's press (vr-view.js updatePress): none until the reference was taken after the delay
  dragTh(c,pr){const hs=c.userData.hs;return hs&&hs.rebased===pr?(pr.dragRec?DRAG_RECORD_HAND:DRAG_HAND):null},
  // what a fist holds is attached here: the hand's palm anchor (a controller: the controller group itself, as before)
  holder(c){const hs=c.userData.hs;return isHand(c.userData.source)&&hs?.anchorOk?hs.anchor:c},
  // a pinch that starts while middle / ring / little are already curled = a fist forming (vr-view.js selectstart ignores it); false for a controller
  fistLike(c){const hs=c.userData.hs;if(!isHand(c.userData.source)||!hs)return false;fistScore(hs);return fistForming(curls,guardTune)},
  grabbing(c){return isHand(c.userData.source)&&!!c.userData.hs?.grab.active},
  // the object this hand's fist would take directly (null for a controller / a hand holding something)
  reach(c){return isHand(c.userData.source)?c.userData.hs?.near??null:null},
  // pulse() of a hand: the end dot and the fingertips swell (amp 0..1) for a moment
  flash(c,amp,ms){const hs=c.userData.hs;if(!isHand(c.userData.source)||!hs)return;hs.flashAt=performance.now();hs.flashMs=Math.max(120,(ms|0)*4);hs.flashAmp=Math.max(0.08,Math.min(1,+amp||0.35))},
  // the wrist button under this hand's ray (the caller set the raycaster to it): {distance,slot} or null; only the other hand's ray
  wristHit(c,raycaster,setRay){
   if(!isHand(c.userData.source)||!wrist.visible||c===leftC)return null;
   setRay(c);const x=raycaster.intersectObject(wrist,false)[0];if(!x||!x.uv)return null;
   const slot=wristSlotFromU(x.uv.x);return slot===null?null:{distance:x.distance,slot};
  },
  wristId:slot=>WRIST_ITEMS[slot]??null,
  hover(slot){hoverNext=slot},
  get wristShown(){return wrist.visible},
  // once per frame, before the controller loop of vr-view.js
  frame(now){
   let anyH=false,left=null,ctrl=false;
   for(const c of controllers){
    const s=c.userData.source;if(!s)continue;
    if(!isHand(s)){ctrl=true;continue}
    const hs=c.userData.hs;if(!hs)continue;anyH=true;if(tick(c,hs,now)&&(c.visible||hs.grab.active||hs.pinch.pressed)){grabStep(c,hs,now);carryStep(c,hs,now);pinchStep(c,hs,now)}else hs.near=null;if(s.handedness==='left')left=c;
    const k=flashK(hs,now);c.userData.dot?.scale.setScalar(1+2.5*hs.flashAmp*k);
   }
   // fingertips
   tips.visible=anyH;
   if(anyH){
    for(let i=0;i<2;i++){
     const c=controllers[i],hs=isHand(c?.userData.source)?c.userData.hs:null,ok=hs&&(c.visible||hs.grab.active);
     const it=ok?joint(hs,'index-finger-tip'):null,th=ok?joint(hs,'thumb-tip'):null;
     const pin=!!hs?.pinch.pressed,k=hs?flashK(hs,now):0; // white = a press is held (the own pinch or the system's)
     const col=hs?.grab.active?GRAB_TIP:pin?0xffffff:hs?.near?REACH_TIP:hs?colorOf(c):0xffffff,s=1+1.5*(hs?hs.flashAmp:0)*k;
     setTip(2*i,it,col,s);setTip(2*i+1,th,col,s);
    }
    tips.instanceMatrix.needsUpdate=true;if(tips.instanceColor)tips.instanceColor.needsUpdate=true;
   }
   // wrist menu: the left hand's wrist, only without a controller in the session (a controller has A/X and B/Y)
   leftC=left;hover=hoverNext;hoverNext=null;
   const hs=left?.userData.hs,wj=hs&&left.visible?joint(hs,'wrist'):null;
   let show=false;
   if(wj&&!ctrl){
    wj.matrix.decompose(tW,tWq,tS);wp[0]=tW.x;wp[1]=tW.y;wp[2]=tW.z;wq[0]=tWq.x;wq[1]=tWq.y;wq[2]=tWq.z;wq[3]=tWq.w;
    const head=getHead();
    show=gate.update(wristMenuMetrics(wp,wq,head,met),now,!!(left.userData.press||left.userData.drag||hs.grab.active));
    if(show){
     if(!wrist.visible)wristF.reset();
     w3[0]=tW.x;w3[1]=tW.y;w3[2]=tW.z;wristF.filter(w3,now);
     tD.set(0,1,0).applyQuaternion(tWq); // the back of the hand (WebXR: +Y of the wrist joint)
     wrist.position.set(w3[0],w3[1],w3[2]).addScaledVector(tD,WRIST_LIFT);wrist.lookAt(head);
     const on=!!sectionOn();draw((hover??15)+16*(on?1:0)+32*(avail('undo')?1:0)+64*(avail('add')?1:0)+128*(avail('secUp')?1:0),on);
    }
   }else gate.update(null,now,true);
   if(!show)hover=null;
   wrist.visible=show;
  },
  dispose(){for(const c of controllers){const a=c.userData.hs?.anchor;if(a)scene.remove(a)}scene.remove(tips);scene.remove(wrist);tips.geometry.dispose();tips.material.dispose();tips.dispose?.();wrist.geometry.dispose();wrist.material.dispose();tex.dispose()},
 };
 return api;
}
