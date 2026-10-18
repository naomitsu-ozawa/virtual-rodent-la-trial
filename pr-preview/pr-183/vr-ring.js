// VR ring menu, stage 1 (build 468): pure functions only (item catalog, settings, stick selection, button press); no three.js, no DOM.
// The drawing (createRingMenu) comes in a later stage. Angles: 0 = up, clockwise, in degrees.
export const WHEEL_SLOTS=6;
// id is saved in the settings: never change one. when: when the item is usable (checked by vr-view.js)
export const WHEEL_ITEMS=[
 {id:'mode-section',ja:'断面モード',en:'Section mode',when:'always'},
 {id:'mode-surface',ja:'表面モード',en:'Surface mode',when:'always'},
 {id:'undo',ja:'元に戻す',en:'Undo',when:'undo'},
 {id:'section-toggle',ja:'断面の表示／非表示',en:'Show/hide sections',when:'always'},
 {id:'section-add',ja:'断面を追加',en:'Add section',when:'planes<10'},
 {id:'point-delete',ja:'選んだ点を削除',en:'Delete selected point',when:'point-selected'},
 {id:'section-next',ja:'次の断面を選ぶ',en:'Next section',when:'planes>=2'},
 {id:'snap-axial',ja:'断面を軸位に',en:'Axial',when:'section-selected'},
 {id:'snap-coronal',ja:'断面を冠状に',en:'Coronal',when:'section-selected'},
 {id:'snap-sagittal',ja:'断面を矢状に',en:'Sagittal',when:'section-selected'},
 {id:'section-clip',ja:'断面で切る／切らない',en:'Clip on/off',when:'section-selected'},
 {id:'section-flip',ja:'切り口反転',en:'Flip cut',when:'section-flip'}, // build 496: the same action as the 向きを反転 button of the 断面 tab (one-side cut mode only)
 {id:'home',ja:'正面に戻す',en:'Bring to front',when:'always'},
 {id:'screenshot',ja:'スクリーンショット',en:'Screenshot',when:'always'},
 {id:'menu',ja:'全体メニュー',en:'Full menu',when:'always'},
];
export const WHEEL_IDS=WHEEL_ITEMS.map(i=>i.id);
export const DEFAULT_WHEEL=Object.freeze(['mode-section','mode-surface','undo','section-toggle','section-add','section-flip']);

// anything -> a new array of WHEEL_SLOTS ids / nulls (unknown ids and later duplicates become null; nothing usable = the default)
export function normalizeWheelItems(raw){
 if(!Array.isArray(raw))return[...DEFAULT_WHEEL];
 const out=[],seen=new Set();
 for(let k=0;k<WHEEL_SLOTS;k++){
  const id=raw[k];
  if(typeof id==='string'&&WHEEL_IDS.includes(id)&&!seen.has(id)){seen.add(id);out.push(id)}else out.push(null);
 }
 return out.some(Boolean)?out:[...DEFAULT_WHEEL];
}
// JSON text of the slots / back; any failure gives the default (settings are untrusted: storage can hold anything)
export function serializeWheelItems(items){
 try{return JSON.stringify(normalizeWheelItems(items))}catch{return JSON.stringify([...DEFAULT_WHEEL])}
}
export function parseWheelItems(text){
 try{return normalizeWheelItems(typeof text==='string'?JSON.parse(text):text)}catch{return[...DEFAULT_WHEEL]}
}
// put id in a slot; when it is in another slot the two swap (never twice in the ring). Unknown id / slot: a copy, unchanged.
export function setWheelItem(items,slot,id){
 const a=normalizeWheelItems(items);
 if(!Number.isInteger(slot)||slot<0||slot>=WHEEL_SLOTS)return a;
 if(id===null||id===undefined)return clearWheelItem(a,slot);
 if(!WHEEL_IDS.includes(id))return a;
 const at=a.indexOf(id);
 if(at===slot)return a;
 if(at>=0)a[at]=a[slot];
 a[slot]=id;return a;
}
// One-time migration (build 498): a layout saved before 切り口反転 existed never shows it. settings = the stored VR settings ({wheel, wheelMig}).
// When wheelMig < 1: set it to 1 and, if 'section-flip' is not in the ring and a slot is empty (null), put it in the first empty slot.
// No empty slot: the layout stays as it is. Once wheelMig >= 1 nothing is ever added again (a user who removed it keeps it removed).
export const WHEEL_MIGRATION=1;
export function migrateWheelSectionFlip(settings){
 const wheel=normalizeWheelItems(settings?.wheel),mig=Number(settings?.wheelMig)||0;
 if(mig>=WHEEL_MIGRATION)return{wheel,wheelMig:mig,changed:false};
 if(!wheel.includes('section-flip')){const e=wheel.indexOf(null);if(e>=0)wheel[e]='section-flip'}
 return{wheel,wheelMig:WHEEL_MIGRATION,changed:true};
}
// swap the slot with its neighbour (dir +1 / -1), wrapping round at the ends
export function moveWheelItem(items,from,dir){
 const a=normalizeWheelItems(items);
 if(!Number.isInteger(from)||from<0||from>=WHEEL_SLOTS)return a;
 const to=((from+(dir<0?-1:1))%WHEEL_SLOTS+WHEEL_SLOTS)%WHEEL_SLOTS;
 [a[from],a[to]]=[a[to],a[from]];return a;
}
export function clearWheelItem(items,slot){
 const a=normalizeWheelItems(items);
 if(Number.isInteger(slot)&&slot>=0&&slot<WHEEL_SLOTS)a[slot]=null;
 return a;
}

// ---- geometry ----
// centre angle of each item: 6 -> 0,60,..; 2 -> 270 (move, left), 90 (delete, right); 3 -> 0,120,240
export function wheelAngles(n){
 if(n===2)return[270,90];
 return Array.from({length:n},(_,k)=>k*360/n);
}
const angDiff=(a,b)=>{const d=Math.abs(a-b)%360;return d>180?360-d:d};
// angle (0..360, up = 0, clockwise) -> slot, or null (nearest item farther than 180/n, a disabled one, or an empty one).
// prev: the lit slot; it is kept until the angle is more than 180/n + hysDeg away from it.
export function wheelSlotFromAngle(theta,n,enabled,prev=null,{hysDeg=10}={}){
 const ang=wheelAngles(n),half=180/n;
 if(prev!==null&&prev!==undefined&&prev>=0&&prev<n&&enabled?.[prev]&&angDiff(theta,ang[prev])<=half+hysDeg)return prev;
 let k=-1,best=Infinity;
 for(let i=0;i<n;i++){const d=angDiff(theta,ang[i]);if(d<best){best=d;k=i}}
 return k>=0&&best<=half&&enabled?.[k]?k:null;
}
const toTheta=(x,y)=>{const t=Math.atan2(x,y)*180/Math.PI;return t<0?t+360:t};
// position on the board (x right, y up, metres from its centre) -> slot, only on the ring of items (0.55 R .. 1.5 R), else null
export function wheelSlotFromLocal(x,y,n,R){
 const r=Math.hypot(x,y);
 if(!(r>=0.55*R&&r<=1.5*R))return null;
 const th=toTheta(x,y),ang=wheelAngles(n);
 let k=0,best=Infinity;
 for(let i=0;i<n;i++){const d=angDiff(th,ang[i]);if(d<best){best=d;k=i}}
 return k;
}

// ---- thumbstick selection (spec 5.2) ----
// update(ax, ay, enabled[]) with the xr-standard axes[2], axes[3] -> {highlight, changed, confirm}
//  - after opening nothing happens until the stick has once been below `release`
//  - lights an item when the stick is beyond `enter`; leaving it dark when the sector is empty / disabled
//  - between release and enter the lit item is kept; back below `release` with an item lit = confirm (once), and the highlight clears
//  - changed: the lit item became another (non-null) item (a light pulse)
export function createWheelStick({enter=0.5,release=0.25,hysDeg=10}={}){
 let armed=false,hl=null;
 return{
  update(ax,ay,enabled){
   const n=enabled?.length||0,x=+ax||0,y=-(+ay||0),m=Math.hypot(x,y);
   if(!armed){if(m<release)armed=true;return{highlight:null,changed:false,confirm:null}}
   let changed=false,confirm=null;
   if(m>=enter&&n>0){
    const k=wheelSlotFromAngle(toTheta(x,y),n,enabled,hl,{hysDeg});
    if(k!==hl){hl=k;changed=k!==null}
   }else if(m<release&&hl!==null){confirm=hl;hl=null}
   return{highlight:hl,changed,confirm};
  },
  reset(){armed=false;hl=null},
  get armed(){return armed},
 };
}

// ---- A/X button (spec 5.5) ----
// update(pressed, now) -> 'long' once when held for longMs | 'short' when released before it | null
export function createButtonPress({longMs=500}={}){
 let t0=null,fired=false;
 return{
  update(pressed,now){
   if(pressed){
    if(t0===null){t0=now;fired=false;return null}
    if(!fired&&now-t0>=longMs){fired=true;return'long'}
    return null;
   }
   if(t0===null)return null;
   const short=!fired&&now-t0<longMs;t0=null;fired=false;
   return short?'short':null;
  },
  reset(){t0=null;fired=false},
 };
}

// ---- drawing (three.js): a square board with the items as annular sectors (a doughnut cut into N equal slices), facing the head ----
// THREE is passed in (no import, no DOM at module level). size: board side in metres (0.16). Canvas 512 x 512 px.
export const WHEEL_BOARD_M=0.16,WHEEL_RADIUS_M=0.055;
const RING_OUT_PX=236,RING_IN_PX=Math.round(RING_OUT_PX*0.4),GAP_DEG=4,HL_GROW=6,DISC_PX=RING_OUT_PX+14; // outer / inner radius of the sectors, gap between sectors, lit sector grows, the base disc
const rad=th=>(th-90)*Math.PI/180; // wheel angle (0 = up, clockwise) -> canvas angle
export function createRingMenu(THREE,{size=WHEEL_BOARD_M}={}){
 const N=512,canvas=document.createElement('canvas');canvas.width=N;canvas.height=N;
 const ctx=canvas.getContext('2d'),tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
 mesh.renderOrder=7;mesh.frustumCulled=false;mesh.visible=false;
 let labels=[],enabled=[],on=[],hl=null;
 const isSw=t=>!!t&&typeof t==='object',C=N/2,MID=(RING_IN_PX+RING_OUT_PX)/2;
 const sector=(a0,a1,ro)=>{ctx.beginPath();ctx.arc(C,C,ro,rad(a0),rad(a1));ctx.arc(C,C,RING_IN_PX,rad(a1),rad(a0),true);ctx.closePath()};
 const draw=()=>{
  ctx.clearRect(0,0,N,N);
  const n=labels.length,ang=wheelAngles(n),half=n?180/n:180;
  ctx.fillStyle='rgba(10,15,22,.62)';ctx.beginPath();ctx.arc(C,C,DISC_PX,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.18)';ctx.lineWidth=3;ctx.stroke();
  ctx.fillStyle='rgba(10,15,22,.5)';ctx.beginPath();ctx.arc(C,C,RING_IN_PX-8,0,Math.PI*2);ctx.fill();
  ctx.textAlign='center';ctx.textBaseline='middle';
  let centre='';
  labels.forEach((t,k)=>{
   const a0=ang[k]-half+GAP_DEG/2,a1=ang[k]+half-GAP_DEG/2,lit=k===hl,ro=RING_OUT_PX+(lit?HL_GROW:0),am=ang[k]*Math.PI/180,cx=C+Math.sin(am)*MID,cy=C-Math.cos(am)*MID;
   sector(a0,a1,ro);
   if(t===null||t===undefined){ctx.setLineDash([8,8]);ctx.strokeStyle='rgba(159,179,195,.45)';ctx.lineWidth=3;ctx.stroke();ctx.setLineDash([]);return}
   if(isSw(t)){
    ctx.fillStyle=t.color;ctx.fill();if(lit){ctx.fillStyle='rgba(255,255,255,.28)';ctx.fill()} // the focused colour is brightened too
    ctx.strokeStyle=lit?'#fff':'rgba(255,255,255,.3)';ctx.lineWidth=lit?7:2;ctx.stroke();
    if(lit)centre=t.name||t.text||'';
    if(t.text){ctx.fillStyle='#fff';ctx.font='bold 28px system-ui,sans-serif';ctx.fillText(t.text,cx,cy+(on[k]?-14:1))} // a text swatch (the 自動 sector)
    if(on[k]){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(cx,t.text?cy+20:cy,10,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(0,0,0,.7)';ctx.lineWidth=3;ctx.stroke()} // the current colour
    return;
   }
   const ok=!!enabled[k];ctx.fillStyle=lit?'#ffe27a':!ok?'#141a21':on[k]?'#2d6cdf':'#26313b';ctx.fill();
   ctx.strokeStyle=lit?'#fff':'rgba(255,255,255,.3)';ctx.lineWidth=lit?5:2;ctx.stroke();
   if(lit)centre=t;
   ctx.fillStyle=lit?'#111':!ok?'#6b7885':'#fff';ctx.font='bold 28px system-ui,sans-serif';
   // two lines when the name is long (split at the middle)
   const lim=n>6?4:6;
   if(t.length>lim){const m=Math.ceil(t.length/2);ctx.font='bold 25px system-ui,sans-serif';ctx.fillText(t.slice(0,m),cx,cy-14);ctx.fillText(t.slice(m),cx,cy+14)}else ctx.fillText(t,cx,cy+1);
  });
  if(centre){ctx.fillStyle='#fff';ctx.font='bold '+(centre.length>5?26:32)+'px system-ui,sans-serif';ctx.fillText(centre,C,C+1)}
  tex.needsUpdate=true;
 };
 return{
  mesh,n:()=>labels.length,
  // labels: names (null = empty slot), enabled: usable, on: shown as "on" (e.g. the current mode)
  setItems(l,e,o){labels=l;enabled=e;on=o||[];draw()},
  setHighlight(k){if(k!==hl){hl=k;draw()}},
  // build 474: the slot under a uv of the board: an annular sector (RING_IN_PX..RING_OUT_PX, within its angular share minus the gap) of a filled, usable item; else null
  slotFromUv(uv){
   const dx=uv.x*N-N/2,dy=(1-uv.y)*N-N/2,r=Math.hypot(dx,dy),n=labels.length;
   if(!n||r<RING_IN_PX||r>RING_OUT_PX+HL_GROW)return null;
   const th=toTheta(dx,-dy),ang=wheelAngles(n),half=180/n;
   let k=-1,best=Infinity;for(let i=0;i<n;i++){const d=angDiff(th,ang[i]);if(d<best){best=d;k=i}}
   if(k<0||best>half-GAP_DEG/2||labels[k]===null||labels[k]===undefined||!enabled[k])return null;
   return k;
  },
  // a uv inside everything drawn (the dark base disc incl. the centre and the gaps): every hand's laser stops here
  inDisk(uv){return Math.hypot(uv.x*N-N/2,(1-uv.y)*N-N/2)<=DISC_PX},
  // matrixWorld is refreshed here: the hit test runs before the next render, and used to see the ring one frame late (at the origin in the frame it opened)
  placeAt(center,head){mesh.position.set(center.x,center.y,center.z);if(head)mesh.lookAt(head.x,head.y,head.z);mesh.updateMatrixWorld(true)},
  dispose(){tex.dispose();mesh.geometry.dispose();mesh.material.dispose()},
 };
}
