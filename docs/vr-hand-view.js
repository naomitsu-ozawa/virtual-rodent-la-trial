// build 625: hand tracking (Quest 3), phase 1: the three.js side. vr-view.js passes THREE, the renderer and a few callbacks; everything here acts
// on a controller group only while its input source is a hand (isHand(c.userData.source), state c.userData.hs) — controllers are never touched.
//  - the hand's target ray: the pose RAY_DELAY_MS ago (the pinch's own ray jump is left out), One Euro filtered, written back into the group's
//    matrix every frame and again before each select event (three refreshes it from the frame right before dispatching them)
//  - tracking loss: > LOSS_CANCEL_MS without a pose drops the hand's press / drag (the disconnect release); the first frame back is skipped
//  - the wrist menu (the back of the left wrist turned to the eyes) and the fingertip markers (index tip, thumb tip; white while pinched)
//  - pulse(): a hand has no haptics; the end dot and the fingertips swell for a moment instead
// Per frame: no allocation (reused vectors / typed arrays; the wrist menu's canvas is redrawn only when its state key changes).
import { isHand, createPoseFilter, createPoseHistory, createPinchHysteresis, createTrackingLoss, createWristMenuGate, wristMenuMetrics, createOneEuro, RAY_DELAY_MS, WRIST_ITEMS, wristSlotFromU, handTexts } from './vr-hand.js?v=20261018-build621';
import { DRAG_HAND, DRAG_RECORD_HAND, HAND_LABEL_MOVE_M } from './vr-point.js?v=20261018-build621';
export { HAND_LABEL_MOVE_M };

const TIP_R=0.0045,WRIST_W=0.20,WRIST_H=0.04,WRIST_LIFT=0.055,CW=1000,CH=200;

export function createHandInput(THREE,{renderer,scene,controllers,ja,getHead,colorOf,release,handInHolder,sectionOn,avail}){
 const texts=handTexts(ja);
 const one=new THREE.Vector3(1,1,1),tP=new THREE.Vector3(),tQ=new THREE.Quaternion(),tS=new THREE.Vector3(),tM=new THREE.Matrix4(),tC=new THREE.Color(),tW=new THREE.Vector3(),tWq=new THREE.Quaternion(),tD=new THREE.Vector3();
 const qI=new THREE.Quaternion(),zero=new THREE.Vector3(0,0,0),wp=[0,0,0],wq=[0,0,0,1],met={facing:0,across:0,dist:0},w3=new Float64Array(3);
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
 // the filter can be tuned on the device without a new build: localStorage vrl-hand-filter = '{"minCutoff":1,"beta":0.01}' (read once per session)
 const tune=(()=>{try{const v=JSON.parse(localStorage.getItem('vrl-hand-filter')||'null');return v&&typeof v==='object'?{minCutoff:+v.minCutoff||undefined,beta:Number.isFinite(+v.beta)?+v.beta:undefined}:{}}catch{return{}}})();
 const newState=hand=>({hand,filter:createPoseFilter(tune),hist:createPoseHistory(),loss:createTrackingLoss(),pinch:createPinchHysteresis(),raw:new Float64Array(7),del:new Float64Array(7),out:new Float64Array(7),has:false,flashAt:0,flashMs:0,flashAmp:0,rebased:null});
 // the group gets the hand's pose o = [px,py,pz,qx,qy,qz,qw] (target-ray space: -z along the ray); children (the laser) follow
 const apply=(c,o)=>{tP.set(o[0],o[1],o[2]);tQ.set(o[3],o[4],o[5],o[6]);c.position.copy(tP);c.quaternion.copy(tQ);c.matrix.compose(tP,tQ,one);c.matrixWorldNeedsUpdate=true;c.updateMatrixWorld(true)};
 const tick=(c,hs,now)=>{
  const st=hs.loss.update(!!c.visible,now);
  if(st==='cancel'){release(c);hs.rebased=null}
  if(st!=='ok'){if(st==='recover'){hs.filter.reset();hs.hist.reset()}if(hs.has)apply(c,hs.out);return}
  c.matrix.decompose(tP,tQ,tS);const r=hs.raw;r[0]=tP.x;r[1]=tP.y;r[2]=tP.z;r[3]=tQ.x;r[4]=tQ.y;r[5]=tQ.z;r[6]=tQ.w; // three wrote the raw ray pose this frame
  hs.hist.push(now,r);const t=hs.hist.at(now-RAY_DELAY_MS,hs.del);hs.filter.filter(hs.del,t,hs.out);hs.has=true;apply(c,hs.out);
  // the drag reference of a press is taken again once the delayed ray has passed the pinch itself (until then the hand's press does not drag)
  const pr=c.userData.press;if(pr&&hs.rebased!==pr&&now-pr.t0>=RAY_DELAY_MS){const hp=handInHolder(c);pr.p0=hp.p;pr.q0=hp.q;hs.rebased=pr}
 };
 const flashK=(hs,now)=>{const e=Math.max(0,now-hs.flashAt);return hs.flashMs&&e<hs.flashMs?1-e/hs.flashMs:0}; // 1 at the pulse, 0 after flashMs
 const joint=(hs,name)=>{const j=hs.hand?.joints?.[name];return j&&j.visible?j:null};
 const setTip=(i,j,col,s)=>{if(j){tS.set(s,s,s);tM.compose(j.position,qI,tS)}else tM.compose(zero,qI,zero);tips.setMatrixAt(i,tM);tips.setColorAt(i,tC.set(col))};
 const api={
  texts,
  anyHand:()=>controllers.some(c=>isHand(c.userData.source)),
  // 'connected' with a hand: per-hand state; renderer.xr.getHand(i) only now (three updates its joints from then on, while a hand is in slot i)
  connect(c,i){if(!isHand(c.userData.source))return;c.userData.hs=newState(renderer.xr.getHand(i))},
  // 'disconnected' of a hand / a controller in a slot a hand had
  drop(c){c.userData.hs=null;c.userData.dot?.scale.setScalar(1);if(leftC===c){leftC=null;gate.reset();wrist.visible=false}},
  // before the select handlers of vr-view.js: three has just written the raw pose of the event's frame; the hand's filtered / delayed pose goes back
  eventPose(c){if(!isHand(c.userData.source))return;const hs=c.userData.hs;if(hs?.has)apply(c,hs.out)},
  // the drag threshold of a hand's press (vr-view.js updatePress): none until the reference was taken after the delay
  dragTh(c,pr){const hs=c.userData.hs;return hs&&hs.rebased===pr?(pr.dragRec?DRAG_RECORD_HAND:DRAG_HAND):null},
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
    const hs=c.userData.hs;if(!hs)continue;anyH=true;tick(c,hs,now);if(s.handedness==='left')left=c;
    const k=flashK(hs,now);c.userData.dot?.scale.setScalar(1+2.5*hs.flashAmp*k);
   }
   // fingertips
   tips.visible=anyH;
   if(anyH){
    for(let i=0;i<2;i++){
     const c=controllers[i],hs=isHand(c?.userData.source)?c.userData.hs:null,ok=hs&&c.visible;
     const it=ok?joint(hs,'index-finger-tip'):null,th=ok?joint(hs,'thumb-tip'):null;
     const pin=it&&th?hs.pinch.update(it.position.distanceTo(th.position)):false,k=hs?flashK(hs,now):0;
     const col=pin?0xffffff:hs?colorOf(c):0xffffff,s=1+1.5*(hs?hs.flashAmp:0)*k;
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
    show=gate.update(wristMenuMetrics(wp,wq,head,met),now,!!(left.userData.press||left.userData.drag));
    if(show){
     if(!wrist.visible)wristF.reset();
     w3[0]=tW.x;w3[1]=tW.y;w3[2]=tW.z;wristF.filter(w3,now);
     tD.set(0,1,0).applyQuaternion(tWq); // the back of the hand (WebXR: +Y of the wrist joint)
     wrist.position.set(w3[0],w3[1],w3[2]).addScaledVector(tD,WRIST_LIFT);wrist.lookAt(head);
     const on=!!sectionOn();draw((hover??7)+8*(on?1:0)+16*(avail('undo')?1:0)+32*(avail('add')?1:0),on);
    }
   }else gate.update(null,now,true);
   if(!show)hover=null;
   wrist.visible=show;
  },
  dispose(){scene.remove(tips);scene.remove(wrist);tips.geometry.dispose();tips.material.dispose();tips.dispose?.();wrist.geometry.dispose();wrist.material.dispose();tex.dispose()},
 };
 return api;
}
