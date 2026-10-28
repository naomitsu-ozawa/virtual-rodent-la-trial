// The point menu of the PC / iPad: opened by a long press on a point (touch, or press-and-hold with the mouse) or a right-click, on the 2D
// marks and on the 3D dots. The same items as the VR point ring (距離 / 色 / 削除; 移動 has no placement tool on the PC) and the same flow:
// 距離 makes the point the START (a pulsing mark + 「終点のポイントを選んでください」), the next point picked is the END, a tap on empty space / Esc / 取消 cancels.
// This module is the shared DOM part (the menu + a small hint pill that is always visible while a start is armed); the views (comment-ui.js 2D, comment-3d.js 3D)
// detect the long press (measurements.js createLongPress) and call openPointMenu.
import { tr } from './i18n.js?v=20261028-build685';
import { getComments, updateCommentColor, onCommentsChange } from './comments.js?v=20261028-build685';
import { POINT_PALETTE, pointColor, autoPointColor, inkOn, paletteName } from './point-colors.js?v=20261028-build685';
import { currentLanguage } from './state.js?v=20261028-build685';
import { POINT_MENU_ITEMS, startMeasure, cancelMeasure, getMeasureStart, onMeasureStartChange, pickMeasureEnd, measurementsOfPoint, setLabelOffset } from './measurements.js?v=20261028-build685';
let menu=null,openId=null,pill=null,pillText=null,installed=false;
const handlers={delete:null};
export const setPointMenuHandlers=h=>Object.assign(handlers,h);
const numberOf=id=>getComments().findIndex(c=>c.id===id)+1;

export function closePointMenu(){
 openId=null;if(menu){menu.hidden=true;menu.replaceChildren()}
}
const btn=(cls,text,fn)=>{const b=document.createElement('button');b.type='button';b.className='tool-chip point-menu-btn '+cls;b.textContent=text;b.addEventListener('click',fn);return b};
function build(id,withPalette){
 const c=getComments().find(x=>x.id===id);if(!c){closePointMenu();return}
 menu.replaceChildren();
 const head=document.createElement('div');head.className='point-menu-head';
 const no=document.createElement('span');no.className='comment-no';no.textContent=String(numberOf(id));const pc=pointColor(c);no.style.background=pc;no.style.borderColor=pc;no.style.color=inkOn(pc);
 const t=document.createElement('span');t.className='point-menu-title';t.textContent=tr('pmTitle')+' '+numberOf(id);
 head.append(no,t);
 const row=document.createElement('div');row.className='point-menu-row';
 for(const key of POINT_MENU_ITEMS){
  if(key==='distance')row.appendChild(btn('point-menu-distance',tr('pmDistance'),()=>{closePointMenu();startMeasure(id)}));
  else if(key==='color')row.appendChild(btn('point-menu-color',tr('pmColor'),()=>build(id,!withPalette)));
  else if(key==='delete')row.appendChild(btn('point-menu-delete',tr('pmDelete'),()=>{closePointMenu();handlers.delete?.(id)}));
 }
 // a moved distance label of this point: bring it back to its default place (near the line)
 const moved=measurementsOfPoint(id).filter(m=>m.labelOffset);
 if(moved.length)row.appendChild(btn('point-menu-labelreset',tr('pmLabelReset'),()=>{closePointMenu();for(const m of moved)setLabelOffset(m.id,null)}));
 menu.append(head,row);
 if(withPalette){
  const lang=currentLanguage==='ja'?'ja':'en',pal=document.createElement('div');pal.className='comment-color-palette point-menu-palette';pal.setAttribute('role','group');pal.setAttribute('aria-label',tr('commentColor'));
  for(const p of POINT_PALETTE){
   const b=document.createElement('button');b.type='button';b.className='comment-color-opt'+(p.hex===pc?' is-current':'');b.style.background=p.hex;b.title=paletteName(p.hex,lang);b.setAttribute('aria-label',b.title);
   b.addEventListener('click',()=>{closePointMenu();updateCommentColor(id,p.hex)});pal.appendChild(b);
  }
  const au=btn('comment-color-auto',tr('commentColorAuto'),()=>{closePointMenu();updateCommentColor(id,null)});au.title=autoPointColor(c);pal.appendChild(au);
  menu.appendChild(pal);
 }
}
// x / y: viewport (client) coordinates of the press
export function openPointMenu({id,x,y}){
 if(!installed)installPointMenu();
 if(!getComments().some(c=>c.id===id))return false;
 openId=id;build(id,false);menu.hidden=false;
 const r=menu.getBoundingClientRect(),W=document.documentElement.clientWidth,H=document.documentElement.clientHeight;
 menu.style.left=Math.max(6,Math.min(W-r.width-6,x+6))+'px';menu.style.top=Math.max(6,Math.min(H-r.height-6,y+6))+'px';
 menu.querySelector('.point-menu-distance')?.focus({preventScroll:true});
 return true;
}
let flashTimer=0,undoBtn=null,undoFn=null;
// a short message in the pill (no start armed): the result of picking the END
function flash(text,ms=2200){
 clearTimeout(flashTimer);pillText.textContent=text;pill.hidden=false;pill.querySelector('.measure-pill-cancel').hidden=true;undoBtn.hidden=true;
 flashTimer=setTimeout(renderPill,ms);
}
// a message with an undo button (the delete from the point menu: the undo button of the panel sits in a closed <details>)
export function flashUndo(text,label,fn,ms=9000){
 if(!installed)installPointMenu();
 flash(text,ms);undoBtn.textContent=label;undoBtn.hidden=false;undoFn=fn;
}
// the END of a distance was picked on a 2D mark or a 3D dot (the same call for both): the result is shown in the pill
export function endMeasureAt(id){
 if(!installed)installPointMenu();
 const r=pickMeasureEnd(id);
 if(r.kind==='created')flash(tr('measureCreated'));else if(r.kind==='existed')flash(tr('measureExisted'));
 else if(r.kind==='other-series')flash(tr('measureOtherSeries'),2800);else if(r.kind==='refused')flash(tr('measureRefused'),2800);else if(r.kind==='same')flash(tr('measureSame'),2000);
 return r;
}
export function cancelMeasureUi(){if(cancelMeasure()){flash(tr('measureCancelled'));return true}return false}
function renderPill(){
 clearTimeout(flashTimer);pill.querySelector('.measure-pill-cancel').hidden=false;undoBtn.hidden=true;
 const id=getMeasureStart();pill.hidden=!id;if(!id)return;
 pillText.textContent=tr('measureStartedAt')+' '+numberOf(id)+' — '+tr('pmHint');
 pill.querySelector('.measure-pill-cancel').textContent=tr('pmCancel');
}
export function installPointMenu(){
 if(installed||typeof document==='undefined')return;installed=true;
 menu=document.createElement('div');menu.className='point-menu';menu.setAttribute('role','menu');menu.hidden=true;document.body.appendChild(menu);
 pill=document.createElement('div');pill.className='measure-pill';pill.setAttribute('role','status');pill.hidden=true;
 pillText=document.createElement('span');const cb=btn('measure-pill-cancel','',()=>cancelMeasureUi());undoBtn=btn('measure-pill-undo','',()=>{const f=undoFn;undoFn=null;renderPill();f?.()});undoBtn.hidden=true;pill.append(pillText,cb,undoBtn);document.body.appendChild(pill);
 // a tap / click outside the menu closes it (captured, so the press still reaches the canvas: the next long press / tap behaves as usual)
 document.addEventListener('pointerdown',e=>{if(openId&&!menu.contains(e.target))closePointMenu()},true);
 document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(openId)closePointMenu();else if(getMeasureStart())cancelMeasureUi()});
 window.addEventListener('scroll',()=>{if(openId)closePointMenu()},true);
 onMeasureStartChange(renderPill);onCommentsChange(()=>{if(openId)(getComments().some(c=>c.id===openId)?build(openId,false):closePointMenu());renderPill()});
 renderPill();
}
