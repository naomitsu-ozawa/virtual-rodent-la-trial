// 体験会モード - the 設定 > 外観 switch. With it on the page shows the event page (event-launcher.js: the bar with VR / AR / チュートリアル / status, and one card per practice dataset that
// opens its data through the practice-data chooser's own startSample and goes on to prepare VR); the settings modal keeps 「最初の状態に戻す」 at its top. With the switch off (default) nothing is added to the page.
import { settings } from './app-settings.js?v=20261112-build721';
import { tr } from './i18n.js?v=20261112-build721';
import { levelForSample, chooseEventLevel, resetPress, resetArmed, RESET_ARM_MS } from './event-mode.js?v=20261112-build721';
import { createEventLauncher } from './event-launcher.js?v=20261112-build721';
export function initEventModeUi(){
 const box=document.getElementById('set-event-mode');
 if(box){box.checked=settings.get('eventMode')===true;box.onchange=()=>settings.set('eventMode',box.checked)}
 const launcher=createEventLauncher();
 let panel=null,resetBtn=null,armedUntil=0,armTimer=0;
 const el=(tag,cls,key)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(key){e.dataset.i18n=key;e.textContent=tr(key)}return e};
 const mark=()=>{
  if(!resetBtn)return;
  // 最初の状態に戻す: only with a practice dataset open; armed = the second press within RESET_ARM_MS fires (the VR button's confirm, event-mode.js resetPress)
  const armed=resetArmed(armedUntil,performance.now()),key=armed?'evResetAgain':'evReset';
  resetBtn.disabled=launcher.busy||!globalThis.__vrlOpenSample;resetBtn.classList.toggle('is-armed',armed);
  if(resetBtn.dataset.i18n!==key){resetBtn.dataset.i18n=key}resetBtn.textContent=tr(key);
 };
 const pressReset=()=>{
  if(launcher.busy||!globalThis.__vrlOpenSample)return;
  const r=resetPress(armedUntil,performance.now());armedUntil=r.armedUntil;clearTimeout(armTimer);
  if(!r.fire){armTimer=setTimeout(()=>{armedUntil=0;mark()},RESET_ARM_MS+80);mark();return}
  const ev=new CustomEvent('vrl-event-reset-request',{detail:{done:null}});document.dispatchEvent(ev);
  if(ev.detail.done)launcher.hold(ev.detail.done); // the cards and this button wait while the data is opened again
  mark();
 };
 const build=()=>{
  const p=el('section','event-level-panel');p.id='event-level-panel';
  resetBtn=el('button','event-reset-btn','evReset');resetBtn.type='button';resetBtn.id='event-reset-btn';resetBtn.onclick=pressReset;
  p.append(resetBtn);
  return p;
 };
 const mount=()=>{
  if(!launcher.enable())return; // the page's layout is there from startup (app.js builds it before this runs)
  panel=build();
  // at the top of the settings modal's body (#settings-dialog .settings-body), above the 外観 / 言語 rows and the tabs
  const host=document.querySelector('#settings-dialog .settings-body');
  if(host)host.prepend(panel);else document.body.append(panel);
  mark();
 };
 const sync=()=>{
  const on=settings.get('eventMode')===true;if(box)box.checked=on;
  if(on&&!panel)mount();else if(!on&&panel){panel.remove();panel=null;resetBtn=null;armedUntil=0;clearTimeout(armTimer);launcher.disable()}
 };
 document.addEventListener('vrl-event-sample-open',()=>{armedUntil=0;mark()}); // a practice dataset was (re)opened or other data replaced it: the button is disarmed and follows
 document.addEventListener('vrl-event-launcher-state',mark); // a card press is loading / preparing: the button waits
 window.addEventListener('vrl-settings',e=>{if(e.detail?.key==='eventMode')sync()});
 // the practice-data chooser's own buttons move the choice too, so the VR mission always matches the data opened last
 document.addEventListener('click',e=>{const b=e.target?.closest?.('[data-sample-set]');if(!b)return;chooseEventLevel(levelForSample(b.dataset.sampleSet)?.id);mark()},true);
 sync();
}
