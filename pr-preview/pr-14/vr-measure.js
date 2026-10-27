// occlusion by the GPU (update({occlusion:true})): the volume writes depth (vr-depth.js); the line, the leader and the label are drawn with a depth test (the part behind the tissue is clipped at its
// outline) and again as a faint "ghost" (a child object sharing the geometry, depthFunc GreaterDepth, GHOST_ALPHA) so the hidden part stays findable. A LIT label (the laser on it / grabbed) and its
// leader are drawn without a depth test, fully on top, so the laser target stays reachable. With occlusion off (setting 「薄くする」) nothing is depth tested and the fade is used.
// VR display of the distances between two points: a line A-B with the value in mm on a label (billboard) at its midpoint, and, while a
// distance is being made, the START point with a pulsing ring and the hint 「終点のポイントを選んでください」 next to it.
// vr-view.js calls createVrMeasure(THREE, scene) -> { update, probes, pickLabel, dragLabel, dispose } every frame and does everything else (the flow, haptics, undo) itself; the state is
// measurements.js (the same for the PC / iPad). The value follows the points: it is recomputed from their voxels each frame (a point being moved included, preview).
import { getComments, getMarkersShown, commentMatchesSeries, commentTarget } from './comments.js?v=20261026-build675';
import { getMeasurements, setLabelOffset, distanceMm, measureLabel } from './measurements.js?v=20261026-build675';
import { nearLabelWorld, stepDelta, offsetFromDelta, LINE_SAMPLES, probeKey, fadeAlpha, approachAlpha, OCCLUDED_ALPHA } from './measure-label.js?v=20261026-build675';
import { voxelToLocal } from './vr-point.js?v=20261026-build675';
import { GHOST_ALPHA, occludedPass } from './vr-depth.js?v=20261026-build675';
export const VR_MEASURE_COLOR=0xffd23d,MEASURE_LABEL_W_M=0.045,MEASURE_LABEL_H_M=0.0132,MEASURE_HINT_W_M=0.2,MEASURE_HINT_H_M=0.026;
export const HINT_DIST_M=0.7,HINT_ELEV=0.5,HINT_ALPHA=0.6,HINT_FADED_ALPHA=0.28,HINT_FADE_AFTER_MS=3000,HINT_FADE_MS=1200;
// pure: the hint's opacity after elapsedMs on screen
export function hintAlpha(elapsedMs){const t=Math.min(1,Math.max(0,((+elapsedMs||0)-HINT_FADE_AFTER_MS)/HINT_FADE_MS));return HINT_ALPHA+(HINT_FADED_ALPHA-HINT_ALPHA)*t}
// pure: the world place of the head-locked hint: from the head {x,y,z}, HINT_DIST_M along the gaze {x,y,z} turned HINT_ELEV towards the world's up (about the gaze's right-hand side: it stays at the top of the view
// when the head looks up or down); null when there is no usable gaze
export function hintPlace(head,gaze){
 if(!head||!gaze)return null;
 const L=Math.hypot(gaze.x,gaze.y,gaze.z);if(!(L>1e-6))return null;
 const f={x:gaze.x/L,y:gaze.y/L,z:gaze.z/L};
 let r={x:-f.z,y:0,z:f.x};let rl=Math.hypot(r.x,r.z);if(rl<1e-4){r={x:1,y:0,z:0};rl=1}r={x:r.x/rl,y:0,z:r.z/rl}; // right = forward x up (world up): horizontal
 const u={x:r.y*f.z-r.z*f.y,y:r.z*f.x-r.x*f.z,z:r.x*f.y-r.y*f.x}; // up' = right x forward
 const c=Math.cos(HINT_ELEV),sn=Math.sin(HINT_ELEV);
 return{x:head.x+(f.x*c+u.x*sn)*HINT_DIST_M,y:head.y+(f.y*c+u.y*sn)*HINT_DIST_M,z:head.z+(f.z*c+u.z*sn)*HINT_DIST_M};
}
export const HINT_HAND_UP_M=0.09,HINT_HAND_SCALE=0.7;
// pure: the world place of the hand-following hint, or null without a usable hand position {x,y,z}
export function hintHandPlace(hand){
 if(!hand||![hand.x,hand.y,hand.z].every(Number.isFinite))return null;
 return{x:hand.x,y:hand.y+HINT_HAND_UP_M,z:hand.z};
}
// the label's size factor from the head distance (m): about 1 at arm's length (0.6 m), bigger when far, never tiny
// the lit label (the laser on it / grabbed): like the ring menu's lit sector (vr-ring.js) it turns #ffe27a with dark text and a white rim, and grows a little
export const LABEL_LIT_SCALE=1.15;
export const labelScaleFor=dist=>Math.min(2.2,Math.max(0.7,(+dist||0.6)/0.6));

// pure: the pulse of the start ring, 0..1, a period of 1.2 s
export const pulsePhase=nowMs=>0.5+0.5*Math.sin((+nowMs||0)/1200*Math.PI*2);

export function createVrMeasure(THREE,scene,deps={getComments,getMarkersShown,getMeasurements,setLabelOffset}){
 const planeGeo=new THREE.PlaneGeometry(1,1),sphereGeo=new THREE.SphereGeometry(1,16,12);
 // the line and the leader carry a per-vertex alpha (vertexColors, RGBA, rgb = 1 so the colour stays the material's): the part of the line that lies behind the
 // visible surface of the volume is drawn faint (measure-label.js "depth cue"; the volume writes no depth, so this is judged on the CPU by vr-view.js, see probes()).
 const LINE_OPACITY=0.95,LEADER_OPACITY=0.6,lineOpts={color:VR_MEASURE_COLOR,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,vertexColors:true};
 const lineMat=new THREE.LineBasicMaterial({...lineOpts,opacity:LINE_OPACITY});
 // the ghost pass: only where something nearer is in the depth buffer (GreaterDepth), faint. Hidden (visible=false) unless occlusion is on.
 const ghostOf=(m,opacity)=>{const g=m.clone();g.depthFunc=THREE.GreaterDepth;g.depthTest=true;g.depthWrite=false;g.opacity=opacity;g.visible=false;return g};
 const lineGhost=ghostOf(lineMat,LINE_OPACITY*GHOST_ALPHA);
 const makeLeaderMat=()=>new THREE.LineBasicMaterial({...lineOpts,opacity:LEADER_OPACITY}); // one per measurement: a lit label puts its own leader on top
 const addGhost=(obj,mat)=>{const g=obj.isLine?new THREE.Line(obj.geometry,mat):new THREE.Mesh(obj.geometry,mat);g.renderOrder=obj.renderOrder;g.frustumCulled=false;obj.add(g);return g};
 const makeLine=n=>{const g=new THREE.BufferGeometry().setFromPoints(Array.from({length:n},()=>new THREE.Vector3())),c=new Float32Array(n*4).fill(1);g.setAttribute('color',new THREE.BufferAttribute(c,4));return g};
 const pulseMat=new THREE.MeshBasicMaterial({color:VR_MEASURE_COLOR,transparent:true,opacity:0.9,side:THREE.BackSide,depthTest:false,toneMapped:false});
 const makeLabel=(cw,ch,w,h,ghostMesh=false)=>{
  const canvas=document.createElement('canvas');canvas.width=cw;canvas.height=ch;
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const mesh=new THREE.Mesh(planeGeo,new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
  mesh.scale.set(w,h,1);mesh.renderOrder=6;mesh.frustumCulled=false;mesh.visible=false;scene.add(mesh);
  const ghost=ghostMesh?addGhost(mesh,Object.assign(mesh.material.clone(),{depthFunc:THREE.GreaterDepth,depthTest:true,depthWrite:false,opacity:GHOST_ALPHA,visible:false})):null; // a child of the label: moves, scales and hides with it
  return{mesh,canvas,tex,text:null,lit:false,ghost};
 };
 const drawText=(lb,text,font,lit=false)=>{
  if(lb.text===text&&lb.lit===lit)return;lb.text=text;lb.lit=lit; // the canvas is redrawn (and re-uploaded) only when the text or the lit state changes
  const c=lb.canvas,ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle=lit?'#ffe27a':'rgba(17,23,27,.92)';ctx.beginPath();ctx.roundRect(3,3,c.width-6,c.height-6,c.height/2.4);ctx.fill();
  ctx.lineWidth=lit?7:5;ctx.strokeStyle=lit?'#ffffff':'#ffd23d';ctx.stroke();
  ctx.fillStyle=lit?'#111111':'#ffffff';ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,c.width/2,c.height/2+2);
  lb.tex.needsUpdate=true;
 };
 const disposeLabel=lb=>{scene.remove(lb.mesh);lb.tex.dispose();lb.mesh.material.dispose();lb.ghost?.material.dispose()};
 const items=new Map(); // measurement id -> {line,leader,label,va,la,t,probes,lprobe}
 const probeList=[]; // the places to judge (hidden behind the volume's surface), rebuilt by update: [{id:probeKey,world:Vector3}]
 let start=null; // {ring,hint}
 const a=new THREE.Vector3(),b=new THREE.Vector3(),mid=new THREE.Vector3(),s=new THREE.Vector3(),lab=new THREE.Vector3(),inv=new THREE.Matrix4(),lo=new THREE.Vector3(),ld=new THREE.Vector3(),hit=new THREE.Vector3();
 const mv={i:0,j:0,k:0};
 const voxelStep=(h,d)=>[2*h[0]/d.columns,-2*h[1]/d.rows,2*h[2]/d.slices]; // object-space change per voxel along i / j / k (vr-point.js voxelToLocal)
 const dropItem=(id,it)=>{scene.remove(it.line);scene.remove(it.leader);it.line.geometry.dispose();it.leader.geometry.dispose();it.leader.material.dispose();it.leaderGhost.material.dispose();disposeLabel(it.label);items.delete(id)};
 const dropStart=()=>{if(!start)return;scene.remove(start.ring);disposeLabel(start.hint);start=null};
 return{
  // fingerprint / dims / halfExt / mesh: as vpMarkers.update; head: the head's world position; spacing: [sx,sy,sz] mm; warn: the series has a slice-spacing warning;
  // startId: the point a distance starts at (or null); hint: its text; now: ms; preview: {id,voxel} a point being moved (voxel null = still at its place)
  update({fingerprint,dims,halfExt,mesh,head,gaze=null,handPos=null,spacing,warn=false,startId=null,hint='',now=performance.now(),preview=null,lit=null,hidden=null,occlusion=false}){ // occlusion: true = the volume's depth hides. lit: a Set of measurement ids whose label is lit (laser on it / grabbed), or null. hidden: a Set of probe keys behind the volume's surface (probes()), or null
   const all=fingerprint&&dims&&halfExt&&mesh&&deps.getMarkersShown()?deps.getComments():[],byId=new Map();
   for(const c of all){
    if(!commentMatchesSeries(c,fingerprint))continue;
    const t=commentTarget(c,dims);if(!t)continue;
    const vox=preview&&preview.id===c.id&&preview.voxel?preview.voxel:t;
    byId.set(c.id,{vox,local:voxelToLocal(vox,halfExt,dims)});
   }
   const keep=new Set();
   if(occlusion)hidden=null;lineMat.depthTest=occlusion;lineGhost.visible=occlusion; // the line material is shared: depth tested + ghost, or the plain line
   if(byId.size){
    mesh.updateWorldMatrix(true,false);mesh.getWorldScale(s);const unit=s.x||1,r0=Math.max(0.003,0.045*unit),step=voxelStep(halfExt,dims);
    for(const m of deps.getMeasurements()){
     const A=byId.get(m.a),B=byId.get(m.b);if(!A||!B)continue;
     keep.add(m.id);let it=items.get(m.id);
     if(!it){
      const line=new THREE.Line(makeLine(LINE_SAMPLES+1),lineMat);line.renderOrder=4;line.frustumCulled=false;scene.add(line);addGhost(line,lineGhost);
      const lm=makeLeaderMat(),leader=new THREE.Line(makeLine(2),lm);leader.renderOrder=4;leader.frustumCulled=false;scene.add(leader);const leaderGhost=addGhost(leader,ghostOf(lm,LEADER_OPACITY*GHOST_ALPHA));
      it={line,leader,leaderGhost,label:makeLabel(256,72,MEASURE_LABEL_W_M,MEASURE_LABEL_H_M,true),va:new Array(LINE_SAMPLES+1).fill(1),la:1,t:0,dragged:false,probes:Array.from({length:LINE_SAMPLES+1},(_,i)=>({id:probeKey(m.id,i),world:new THREE.Vector3()})),lprobe:{id:probeKey(m.id,'L'),world:new THREE.Vector3()}};items.set(m.id,it);
     }
     a.set(A.local.x,A.local.y,A.local.z);mesh.localToWorld(a);b.set(B.local.x,B.local.y,B.local.z);mesh.localToWorld(b);
     const pos=it.line.geometry.attributes.position;
     for(let i=0;i<=LINE_SAMPLES;i++){const f=i/LINE_SAMPLES,pr=it.probes[i].world;pr.set(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,a.z+(b.z-a.z)*f);pos.setXYZ(i,pr.x,pr.y,pr.z)}
     pos.needsUpdate=true;
     const isLit=!!lit&&lit.has(m.id);drawText(it.label,measureLabel(distanceMm(A.vox,B.vox,spacing),warn),'bold 40px system-ui,sans-serif',isLit);
     // the label (60 % size, scaled with the head distance): where the user left it (labelOffset: voxel units from the midpoint) or, by default, NEAR the line
     // (beside it as seen from the head); a thin leader joins it to the midpoint
     mid.addVectors(a,b).multiplyScalar(0.5);
     const k=labelScaleFor(head?head.distanceTo(mid):0.6)*(isLit?LABEL_LIT_SCALE:1),ctx=it.ctx||(it.ctx={mesh:null,step:null,ml:{x:0,y:0,z:0}}),ml=ctx.ml;
     mv.i=(A.vox.i+B.vox.i)/2;mv.j=(A.vox.j+B.vox.j)/2;mv.k=(A.vox.k+B.vox.k)/2;ml.x=((mv.i+.5)/dims.columns-.5)*2*halfExt[0];ml.y=(.5-(mv.j+.5)/dims.rows)*2*halfExt[1];ml.z=((mv.k+.5)/dims.slices-.5)*2*halfExt[2]; // = voxelToLocal(mv), without a new object per frame
     ctx.mesh=mesh;ctx.step=step; // for dragLabel
     if(m.labelOffset){const d=stepDelta(m.labelOffset,step);lab.set(ml.x+d.x,ml.y+d.y,ml.z+d.z);mesh.localToWorld(lab)}
     else{const p=nearLabelWorld(a,b,head||{x:mid.x,y:mid.y+1,z:mid.z+1},(MEASURE_LABEL_W_M*0.35+0.008)*k);lab.set(p.x,p.y,p.z)}
     it.label.mesh.position.copy(lab);it.label.mesh.scale.set(MEASURE_LABEL_W_M*k,MEASURE_LABEL_H_M*k,1);if(head)it.label.mesh.lookAt(head);it.label.mesh.visible=true;it.label.mesh.updateMatrixWorld(true);
     const lg=it.leader.geometry.attributes.position;lg.setXYZ(0,mid.x,mid.y,mid.z);lg.setXYZ(1,lab.x,lab.y,lab.z);lg.needsUpdate=true;
     it.lprobe.world.copy(lab);it.dragged=!!m.labelOffset;
     // depth cue: the parts behind the surface fade towards OCCLUDED_ALPHA (smoothly: the judgement is ~10 Hz); the label and its leader follow the dragged label's own
     // place, or (not dragged) the line's midpoint; a LIT label (laser on it / grabbed) stays fully visible so it can still be used
     const dt=it.t?Math.min(250,now-it.t):0;it.t=now;
     const col=it.line.geometry.attributes.color;let ch=false;
     for(let i=0;i<=LINE_SAMPLES;i++){const v=approachAlpha(it.va[i],hidden&&hidden.has(it.probes[i].id)?OCCLUDED_ALPHA:1,dt);if(v!==it.va[i]){it.va[i]=v;col.setW(i,v);ch=true}}
     if(ch)col.needsUpdate=true;
     const lh=!!hidden&&hidden.has(m.labelOffset?it.lprobe.id:it.probes[LINE_SAMPLES/2].id),la=approachAlpha(it.la,fadeAlpha(lh,isLit),dt);
     // occlusion: a lit label and its leader are drawn on top (no depth test, no ghost); the others are depth tested + ghost
     {const top=!occludedPass(occlusion,isLit);it.label.mesh.material.depthTest=!top;it.label.ghost.material.visible=!top;it.leader.material.depthTest=!top;it.leaderGhost.material.visible=!top}
     if(la!==it.la){it.la=la;it.label.mesh.material.opacity=la;it.label.ghost.material.opacity=la*GHOST_ALPHA;const lc=it.leader.geometry.attributes.color;lc.setW(0,la);lc.setW(1,la);lc.needsUpdate=true}
    }
    const S=startId?byId.get(startId):null;
    if(S){
     if(!start){
      const ring=new THREE.Mesh(sphereGeo,pulseMat);ring.renderOrder=2;ring.frustumCulled=false;scene.add(ring);
      start={ring,hint:makeLabel(512,64,MEASURE_HINT_W_M,MEASURE_HINT_H_M),id:startId,t0:now};
     }
     if(start.id!==startId){start.id=startId;start.t0=now} // another start point: the hint is read again (full strength, then fades)
     a.set(S.local.x,S.local.y,S.local.z);mesh.localToWorld(a);
     start.ring.position.copy(a);start.ring.scale.setScalar(r0*0.4*(2.1+0.9*pulsePhase(now)));
     drawText(start.hint,hint,'bold 30px system-ui,sans-serif');
     const hh=hintHandPlace(handPos),hp=hh||hintPlace(head,gaze);
     {const hk=hh?HINT_HAND_SCALE:1;start.hint.mesh.scale.set(MEASURE_HINT_W_M*hk,MEASURE_HINT_H_M*hk,1)} // keep the plane's real width x height (a uniform setScalar made it a 0.7 m square: the 512x64 text stretched into vertical streaks)
     if(hp)start.hint.mesh.position.set(hp.x,hp.y,hp.z);else start.hint.mesh.position.set(a.x,a.y+0.045+r0,a.z);
     if(head)start.hint.mesh.lookAt(head);start.hint.mesh.material.opacity=hintAlpha(now-start.t0);start.hint.mesh.visible=true;
    }else dropStart();
   }else dropStart();
   for(const [id,it] of [...items])if(!keep.has(id))dropItem(id,it);
   probeList.length=0;for(const it of items.values()){for(const p of it.probes)probeList.push(p);if(it.dragged)probeList.push(it.lprobe)}
  },
  // the places whose "hidden behind the volume" is judged by vr-view.js (about 10 times a second, vr-point.js pointIsHidden): the 9 samples of every line and the label that was dragged.
  // [{id:probeKey,world:Vector3}] of the last update (the list is reused: read it, do not keep it)
  probes:()=>probeList,
  // the label a ray (world origin o, unit direction d) points at: {id,distance,hit,pos} (hit / pos: world points) or null (as of the last update)
  pickLabel(o,d){
   let best=null;
   for(const [id,it] of items){
    const lm=it.label.mesh;if(!lm.visible)continue;
    inv.copy(lm.matrixWorld).invert();lo.set(o.x,o.y,o.z).applyMatrix4(inv);ld.set(d.x,d.y,d.z).transformDirection(inv);
    if(Math.abs(ld.z)<1e-9)continue;const t=-lo.z/ld.z;if(!(t>0))continue;
    hit.copy(lo).addScaledVector(ld,t); // on the label's plane, in its unit square (+-0.5): a little generous (the label is small)
    if(Math.abs(hit.x)>0.6||Math.abs(hit.y)>1.0)continue;
    hit.applyMatrix4(lm.matrixWorld);const dist=Math.hypot(hit.x-o.x,hit.y-o.y,hit.z-o.z);
    if(!best||dist<best.distance)best={id,distance:dist,hit:hit.clone(),pos:lm.position.clone()};
   }
   return best;
  },
  // move the label so that it sits at the world point P: stored as labelOffset (voxel units from the midpoint). false when the measurement is not shown.
  dragLabel(id,P){
   const it=items.get(id);if(!it||!it.ctx)return false;
   lo.set(P.x,P.y,P.z);it.ctx.mesh.worldToLocal(lo);
   return deps.setLabelOffset(id,offsetFromDelta({x:lo.x-it.ctx.ml.x,y:lo.y-it.ctx.ml.y,z:lo.z-it.ctx.ml.z},it.ctx.step));
  },
  dispose(){for(const [id,it] of [...items])dropItem(id,it);dropStart();planeGeo.dispose();sphereGeo.dispose();lineMat.dispose();lineGhost.dispose();pulseMat.dispose()},
 };
}
