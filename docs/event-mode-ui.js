// build 626: 体験会モード - the 設定 > 外観 switch and the level choice shown in the データ panel while it is on (event-mode.js holds
// the levels). A level card asks app.js for its practice dataset ('vrl-event-sample' -> the practice-data chooser's own startSample,
// so the bundled project.vrlab applies as usual); then the visitor presses 「VRで見る」/「ARで見る」. With the switch off (default)
// nothing is added to the page.
import { settings } from './app-settings.js?v=20261019-build622';
import { tr } from './i18n.js?v=20261019-build622';
import { EVENT_LEVELS, EVENT_HINT_KEYS, levelForSample, chooseEventLevel, chosenEventLevel } from './event-mode.js?v=20261019-build622';
export function initEventModeUi(){
 const box=document.getElementById('set-event-mode');
 if(box){box.checked=settings.get('eventMode')===true;box.onchange=()=>settings.set('eventMode',box.checked)}
 let panel=null,loading=false;
 const el=(tag,cls,key)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(key){e.dataset.i18n=key;e.textContent=tr(key)}return e};
 const mark=()=>{
  if(!panel)return;const cur=chosenEventLevel()?.id;panel.setAttribute('aria-busy',String(loading));
  for(const c of panel.querySelectorAll('[data-event-level]')){const on=c.dataset.eventLevel===cur;c.classList.toggle('is-selected',on);c.setAttribute('aria-pressed',String(on));c.disabled=loading}
 };
 const build=()=>{
  const p=el('section','event-level-panel');p.id='event-level-panel';p.setAttribute('aria-labelledby','event-level-title');
  const title=el('strong','event-level-title','evTitle');title.id='event-level-title';
  const list=el('div','event-level-list');
  for(const lv of EVENT_LEVELS){
   const card=el('button','event-level-card');card.type='button';card.dataset.eventLevel=lv.id;card.dataset.eventSample=lv.sample;card.setAttribute('aria-pressed','false');
   const top=el('span','event-level-top'),badge=el('span','event-level-badge');badge.textContent='Lv'+lv.lv;
   top.append(badge,el('span','event-level-name',lv.nameKey),el('span','event-level-mark','evSelected'));
   const hints=el('span','event-level-hints');for(const h of lv.hints)hints.append(el('span','event-level-hint',EVENT_HINT_KEYS[h]));
   card.append(top,el('span','event-level-mission',lv.missionKey),hints);
   card.onclick=()=>{
    if(loading)return;chooseEventLevel(lv.id);
    const ev=new CustomEvent('vrl-event-sample',{detail:{sampleSet:lv.sample,done:null}});document.dispatchEvent(ev);
    if(!ev.detail.done){mark();return}
    loading=true;mark();Promise.resolve(ev.detail.done).catch(()=>{}).finally(()=>{loading=false;mark()});
   };
   list.append(card);
  }
  p.append(title,list,el('p','hint event-level-after','evAfter'));
  return p;
 };
 const mount=()=>{
  panel=build();
  // at the top of the データ panel (workspace UI; the first sidebar panel in the classic UI), above the open / practice-data rows
  const host=document.querySelector('[data-ipad-drawer-section="data"]')||document.querySelector('.sidebar-scroll > .panel');
  if(host)host.prepend(panel);else document.body.append(panel);
  mark();
 };
 const sync=()=>{
  const on=settings.get('eventMode')===true;if(box)box.checked=on;
  if(on&&!panel)mount();else if(!on&&panel){panel.remove();panel=null}
 };
 window.addEventListener('vrl-settings',e=>{if(e.detail?.key==='eventMode')sync()});
 // the practice-data chooser's own buttons move the choice too, so the VR mission always matches the data opened last
 document.addEventListener('click',e=>{const b=e.target?.closest?.('[data-sample-set]');if(!b)return;chooseEventLevel(levelForSample(b.dataset.sampleSet)?.id);mark()},true);
 sync();
}
