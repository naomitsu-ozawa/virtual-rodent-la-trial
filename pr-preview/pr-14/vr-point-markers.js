// VR display of the position comments (stages 3-4): one real 3D sphere per comment of the open series (right parallax in stereo)
// plus a small number chip. Number = the place in the whole comment list; colour = the point's own colour or its auto colour
// (point-colors.js, the same in the 2D panel, the 3D overlay and the lists). The cyan constants below are only the fallback / the old look. vr-view.js calls createVrPointMarkers(THREE, scene) -> { update, pick, dispose } and does everything else
// (hidden test, laser, selection) itself; the look is decided here and nowhere else.
//
// Look:
//  - EXPOSED point (nothing of a shown segment between it and the head): a dark filled sphere with a white rim.
//  - HIDDEN point (behind tissue; the rule is vr-point.js pointIsHidden, refreshed about 10 times a second by vr-view.js): a small dot.
//  -: every marker has the same small size (0.4 x the base radius) in all states. A point off the active section also gets a thin line
//    (the perpendicular) down to the section; no active section: no line.
//  - laser on a point: a white halo; the selected point: a yellow halo (kept until it is deselected or deleted).
// Spheres are drawn after the volume without a depth test, so a hidden point is still visible (as the small dot).
// (GPU occlusion, update({occlusion:true}), vr-depth.js): the sphere, its rim, the chip (number) and the perpendicular are drawn with a real depth test (clipped at the tissue outline) plus a faint
// ghost child (depthFunc GreaterDepth, GHOST_ALPHA), and the CPU "hidden" look (small dot) is not used. A hovered / selected / moved point (and its chip) stays fully on top, so it can be operated.
// With occlusion off (「薄くする」, or no usable GPU depth) nothing changes: no depth test, the CPU hidden look.
import { getComments, getMarkersShown, commentMatchesSeries, commentTarget } from './comments.js?v=20261028-build681';
import { voxelToLocal, sectionRelation, pickPoint } from './vr-point.js?v=20261028-build681';
import { pointColor, colorToInt, darkFill, inkOn } from './point-colors.js?v=20261028-build681';
import { GHOST_ALPHA, occludedPass } from './vr-depth.js?v=20261028-build681';
export const VR_MARKER_COLOR=0x4dd8ff,VR_MARKER_FILL=0x0b6f8c,VR_RIM_COLOR=0xffffff,VR_HALO_HOVER=0xffffff,VR_HALO_SELECTED=0xffd23d;
export const PICK_MIN_M=0.004,MARKER_SCALE=0.4; // MARKER_SCALE: the drawn radius as a factor of the base radius, the same in every state
const RADIUS_UNITS=0.045,MIN_RADIUS_M=0.003; // radius in volume units (the longest side is 3.3) and the least radius in metres

// pure: how a point looks. Factors of the base radius. section: 'on' (the active section passes through the point's voxel), 'off', or null
// (no active section: no emphasis and no line).
export function markerStyle({hidden=false,section=null,selected=false,hover=false}={}){
 const on=section==='on';
 return{
  scale:MARKER_SCALE,rim:!hidden,fill:hidden?'dot':'solid',chipScale:2, // every state is drawn small; hidden / visible differ by look only
  halo:selected?'selected':hover?'hover':null,
  perpendicular:section==='off',
 };
}

// deps: the comment store to read (the app's by default; a test passes its own, as module URLs carry a ?v= build tag)
export function createVrPointMarkers(THREE,scene,deps={getComments,getMarkersShown}){
 const geo=new THREE.SphereGeometry(1,16,12);
 const mk=(color,extra={})=>new THREE.MeshBasicMaterial({color,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,...extra});
 // the occlusion variants of a material: D = depth tested (the part in front of the tissue), G = the ghost pass (only where the volume's depth is nearer: GreaterDepth, GHOST_ALPHA)
 const depthOf=m=>{const c=m.clone();c.depthTest=true;c.depthWrite=false;return c};
 const ghostOf=m=>{const c=m.clone();c.depthFunc=THREE.GreaterDepth;c.depthTest=true;c.depthWrite=false;c.opacity=m.opacity*GHOST_ALPHA;return c};
 const mats={rim:mk(VR_RIM_COLOR,{side:THREE.BackSide}),hover:mk(VR_HALO_HOVER,{side:THREE.BackSide,opacity:0.9}),selected:mk(VR_HALO_SELECTED,{side:THREE.BackSide,opacity:0.95})};
 mats.rimD=depthOf(mats.rim);mats.rimG=ghostOf(mats.rim);
 // per-colour materials: dot = the colour, solid = its dark body, ghost = the faint copy while moving, line = the perpendicular; made on first use.
 // ...D = depth tested, ...G = the ghost pass (see depthOf / ghostOf)
 const byColor=new Map();
 const colored=hex=>{
  let m=byColor.get(hex);
  if(!m){
   m={dot:mk(colorToInt(hex)),solid:mk(darkFill(hex)),ghost:mk(darkFill(hex),{opacity:0.35}),line:new THREE.LineBasicMaterial({color:colorToInt(hex),transparent:true,opacity:0.6,depthTest:false,depthWrite:false,toneMapped:false})};
   for(const k of ['dot','solid','line']){m[k+'D']=depthOf(m[k]);m[k+'G']=ghostOf(m[k])}
   byColor.set(hex,m);
  }
  return m;
 };
 const chipGeo=new THREE.PlaneGeometry(1,1),items=new Map(); // comment id -> {sphere,rim,halo,line,chip,no}
 const v=new THREE.Vector3(),f=new THREE.Vector3(),s=new THREE.Vector3();
 const drawChip=(item,no,hex)=>{
  const c=item.chip.material.map.image,ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle=hex;ctx.beginPath();ctx.roundRect(3,3,c.width-6,c.height-6,24);ctx.fill();
  ctx.lineWidth=5;ctx.strokeStyle='rgba(0,0,0,.75)';ctx.stroke();
  ctx.fillStyle=inkOn(hex);ctx.font='800 56px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(no),c.width/2,c.height/2+3);
  item.chip.material.map.needsUpdate=true;item.no=no;item.hex=hex;
 };
 const make=()=>{
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const sphere=new THREE.Mesh(geo,colored('#19d3ee').solid);sphere.renderOrder=4;sphere.frustumCulled=false;
  const rim=new THREE.Mesh(geo,mats.rim);rim.renderOrder=3;rim.frustumCulled=false;
  const halo=new THREE.Mesh(geo,mats.hover);halo.renderOrder=2;halo.frustumCulled=false;halo.visible=false;
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),colored('#19d3ee').line);line.renderOrder=3;line.frustumCulled=false;line.visible=false;
  const chip=new THREE.Mesh(chipGeo,new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));chip.renderOrder=5;chip.frustumCulled=false;
  // the ghost pass of each part is a child (shares the geometry, moves / scales / hides with it); shown only while the part is depth tested (occlusion on, not lit)
  const kid=(parent,o)=>{o.renderOrder=parent.renderOrder;o.frustumCulled=false;o.visible=false;parent.add(o);return o};
  const sphereG=kid(sphere,new THREE.Mesh(geo,colored('#19d3ee').solidG));
  const rimG=kid(rim,new THREE.Mesh(geo,mats.rimG));
  const lineG=kid(line,new THREE.Line(line.geometry,colored('#19d3ee').lineG));
  const chipG=kid(chip,new THREE.Mesh(chipGeo,Object.assign(chip.material.clone(),{depthFunc:THREE.GreaterDepth,depthTest:true,depthWrite:false,opacity:GHOST_ALPHA})));
  for(const o of [halo,rim,sphere,line,chip])scene.add(o);
  return{sphere,rim,halo,line,chip,sphereG,rimG,lineG,chipG,no:0,hex:'',radius:0};
 };
 const drop=(id,it)=>{for(const o of [it.sphere,it.rim,it.halo,it.line,it.chip])scene.remove(o);it.line.geometry.dispose();it.chip.material.map.dispose();it.chip.material.dispose();it.chipG.material.dispose();items.delete(id)};
 return{
  // every frame: positions follow the volume (mesh = the volume's box mesh) and the chips face the head.
  // hidden: Set of comment ids that are hidden behind tissue (vr-view.js, ~10 Hz); section: the active section's plane in object space
  // ({x,y,z,w}, unit normal) or null; selectedId; hover: Set of ids a laser points at.
  // preview: {id, voxel} - the point is drawn at that voxel while it is being moved; voxel null = at its old place, faint (opacity 0.35)
  // occlusion: true = the volume's depth hides the points (see the top of this file; hidden is then not used)
  update({fingerprint,dims,halfExt,mesh,head,hidden=null,section=null,selectedId=null,hover=null,preview=null,occlusion=false}){
   const all=fingerprint&&dims&&halfExt&&mesh&&deps.getMarkersShown()?deps.getComments():[],keep=new Set();
   if(all.length){
    mesh.updateWorldMatrix(true,false);mesh.getWorldScale(s);const unit=s.x||1,r0=Math.max(MIN_RADIUS_M,RADIUS_UNITS*unit);
    all.forEach((c,n)=>{
     if(!commentMatchesSeries(c,fingerprint))return;
     const t=commentTarget(c,dims);if(!t)return;
     keep.add(c.id);let it=items.get(c.id);if(!it){it=make();items.set(c.id,it)}
     const hex=pointColor(c),col=colored(hex);
     if(it.no!==n+1||it.hex!==hex)drawChip(it,n+1,hex);
     const pv=preview&&preview.id===c.id?preview:null,ghost=!!pv&&!pv.voxel,l=voxelToLocal(pv&&pv.voxel?pv.voxel:t,halfExt,dims),rel=section?sectionRelation(l,section,halfExt,dims):null;
     const lit=c.id===selectedId||!!hover?.has(c.id)||!!pv, // selected / laser on it / being moved: fully on top (operable), never ghosted
      deep=occludedPass(occlusion,lit); // depth tested + ghost
     const st=markerStyle({hidden:!occlusion&&!!hidden?.has(c.id),section:rel?(rel.onSection?'on':'off'):null,selected:c.id===selectedId,hover:!!hover?.has(c.id)}); // with the GPU depth the CPU judgement is not used
     v.set(l.x,l.y,l.z);mesh.localToWorld(v);
     const r=r0*st.scale;it.radius=Math.max(PICK_MIN_M,r0*1.3*1.2); // the hit radius stays what the normal-size disc had (base radius, rim included, +20 %), independent of the smaller drawn size; the least is PICK_MIN_M
     const fk=st.fill==='dot'?'dot':'solid';
     it.sphere.material=ghost?col.ghost:col[deep?fk+'D':fk];it.sphereG.visible=deep&&!ghost;it.sphereG.material=col[fk+'G'];
     it.sphere.position.copy(v);it.sphere.scale.setScalar(r);
     it.rim.visible=st.rim&&!ghost;it.rim.material=deep?mats.rimD:mats.rim;it.rimG.visible=deep;it.rim.position.copy(v);it.rim.scale.setScalar(r*1.3);
     it.halo.visible=!!st.halo;if(st.halo){it.halo.material=mats[st.halo];it.halo.position.copy(v);it.halo.scale.setScalar(r*1.9)}
     it.chip.material.depthTest=deep;it.chipG.visible=deep;
     const showLine=st.perpendicular&&!!rel;it.line.visible=showLine;it.line.material=deep?col.lineD:col.line;it.lineG.visible=deep;it.lineG.material=col.lineG;
     if(showLine){f.set(rel.foot.x,rel.foot.y,rel.foot.z);mesh.localToWorld(f);const a=it.line.geometry.attributes.position;a.setXYZ(0,v.x,v.y,v.z);a.setXYZ(1,f.x,f.y,f.z);a.needsUpdate=true}
     it.chip.position.set(v.x,v.y+r*1.6+r0*st.chipScale*0.6,v.z);it.chip.scale.setScalar(r0*st.chipScale);if(head)it.chip.lookAt(head);
    });
   }
   for(const [id,it] of [...items])if(!keep.has(id))drop(id,it);
  },
  // the nearest point a world-space ray (unit direction) touches: {id,distance} or null (as of the last update)
  pick(o,d,tolRad=0){return pickPoint(o,d,[...items].map(([id,it])=>({id,center:it.sphere.position,radius:it.radius})),tolRad)}, // tolRad: a hand's laser (vr-point.js HAND_PICK_TOL), 0 for a controller
  // world centres of the points shown: [{id,world:Vector3}] (for the hidden test)
  centres(){return[...items].map(([id,it])=>({id,world:it.sphere.position}))},
  dispose(){for(const [id,it] of [...items])drop(id,it);geo.dispose();for(const m of Object.values(mats))m.dispose();for(const m of byColor.values())for(const x of Object.values(m))x.dispose();chipGeo.dispose()},
 };
}

// ---- point cursor ----
// Where a trigger press would record: a small dot (lime by default; the caller passes the pointing hand's laser colour to set(), so each hand's cursor has its own colour) (about one voxel, centred EXACTLY on the voxel that will be recorded). No ring, no
// glow. Used by 表面 mode (on the tissue surface) and by 断面 mode (the voxel projected onto the selected section) alike, so both look the
// same. Clearly different from the point markers (cyan sphere with a white rim / yellow halo) and from the laser tip (a small dot in the
// hand colour). Drawn without a depth test, like the markers.
// Size: one voxel wide in the world but never smaller than MIN_CORE_RAD angular radius seen from the head.
export const SURFACE_CURSOR_COLOR=0x8dff4a,SURFACE_CURSOR_MIN_CORE_RAD=0.0022;
// pure: dot radius (world metres). dist: head -> cursor distance (m); voxelM: the voxel's world size (m).
export function surfaceCursorSizes(dist,voxelM){
 const d=Math.max(1e-3,+dist||0);
 return{core:Math.max(0.5*(+voxelM||0),d*SURFACE_CURSOR_MIN_CORE_RAD)};
}
export function createSurfaceCursor(THREE,scene){
 const core=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial({color:SURFACE_CURSOR_COLOR,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
 core.renderOrder=6;core.frustumCulled=false;
 const group=new THREE.Group();group.add(core);group.visible=false;scene.add(group);
 const d=new THREE.Vector3();
 return{
  group,core,
  // centre: the centre of the voxel that will be recorded (world); head: the head's world position; voxelM: the voxel's world size; color: optional hex (the hand's laser colour; omitted = SURFACE_CURSOR_COLOR). null = hidden
  set(centre,head,voxelM=0,color=SURFACE_CURSOR_COLOR){
   group.visible=!!centre;if(!centre)return;core.material.color.setHex(color);
   group.position.set(centre.x,centre.y,centre.z);
   const dist=head?d.set(head.x-centre.x,head.y-centre.y,head.z-centre.z).length():1;
   core.scale.setScalar(surfaceCursorSizes(dist,voxelM).core);
  },
  dispose(){scene.remove(group);core.geometry.dispose();core.material.dispose()},
 };
}
