// Long-press progress ring at the laser's tip.
// While a button is held, a ring fills from 0 to 360 degrees (clockwise from the top) in the hand's laser colour; at 100 % the action fires and the ring goes.
// Released before it is full: the ring just goes. Pure parts (createHoldTracker, ringDrawCount) are unit tested; createHoldRing draws (THREE is passed in, no DOM).

export const HOLD_RING_SEGMENTS=64;
export const HOLD_RING_RADIUS=0.05; // outer radius in metres per metre of laser length (a constant visual size)
export const HOLD_RING_MIN_DIST=0.25; // a laser that ends very close does not get a pin-head ring

// update(pressed, now) -> the fill 0..1 while the ring is shown, else null. Shown from showMs after the press (a plain short click does not flash a ring),
// the fill is elapsed / longMs (so it is already part-full when it appears), and it ends (null) when the hold reaches longMs (the action fires there) or on release.
export function createHoldTracker({longMs=300,showMs=80}={}){
 let t0=null;
 return{
  update(pressed,now){
   if(!pressed){t0=null;return null}
   if(t0===null)t0=now;
   const el=now-t0;
   if(el<showMs||el>=longMs)return null;
   return el/longMs;
  },
  reset(){t0=null},
 };
}

// index count to draw for a fill (two triangles = 6 indices per segment); at least one segment while shown
export const ringDrawCount=f=>Math.max(1,Math.min(HOLD_RING_SEGMENTS,Math.round(f*HOLD_RING_SEGMENTS)))*6;

export function createHoldRing(THREE){
 const mkGeo=()=>new THREE.RingGeometry(0.72,1,HOLD_RING_SEGMENTS,1,Math.PI/2,-Math.PI*2); // clockwise from the top
 const mk=(g,op)=>{const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:op,side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false}));m.renderOrder=9;m.frustumCulled=false;return m};
 const fillGeo=mkGeo(),track=mk(mkGeo(),0.3),fill=mk(fillGeo,1); // the faint full circle, and the part that fills
 const group=new THREE.Group();group.add(track,fill);group.visible=false;
 return{
  group,
  // f: fill 0..1; hex: the laser colour; pos: world position of the laser's tip; radiusM: ring radius in metres
  show(f,hex,pos,radiusM){
   track.material.color.setHex(hex);fill.material.color.setHex(hex);fillGeo.setDrawRange(0,ringDrawCount(f));
   group.position.copy(pos);group.scale.setScalar(radiusM);group.visible=true;
  },
  hide(){group.visible=false},
 };
}
