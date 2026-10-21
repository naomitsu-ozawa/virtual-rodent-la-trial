// 設定 > デバッグ > テスト機能: a collapsed list with the one test switch (debug-flags.js). A switch that only applies after a
// reload says so and, when changed, shows a reload button.
import { settings } from './app-settings.js?v=20261021-build641';
import { tr } from './i18n.js?v=20261021-build641';
import { armConfirm } from './inline-ask.js?v=20261021-build641';
import { DEBUG_SWITCHES, debugFlag, resetDebugFlags } from './debug-flags.js?v=20261021-build641';
const WHEN_KEY={reload:'dbgApplyReload',vr:'dbgApplyVr'};
const GROUP_KEY={light:'dbgGroupLight'};
export function initDebugSwitches(){
 const host=document.getElementById('debug-switches');if(!host||host.dataset.ready)return;host.dataset.ready='1';
 const el=(tag,cls,key)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(key){e.dataset.i18n=key;e.textContent=tr(key)}return e};
 host.append(el('summary','debug-switches-title','dbgTitle'));
 const loaded={},boxes={};
 let group='';
 for(const d of DEBUG_SWITCHES){
  if(d.group!==group){group=d.group;host.append(el('p','debug-switch-group',GROUP_KEY[group]))}
  const row=el('label','settings-row settings-check');row.insertAdjacentHTML('afterbegin','<input type="checkbox" id="dbg-'+d.id+'">');const box=row.firstElementChild;boxes[d.id]=box;
  row.append(el('span','',d.label));
  const note=el('p','hint debug-switch-note',d.note);
  note.append(' (',el('span','debug-switch-when',WHEN_KEY[d.when]),')');
  host.append(row,note);
  loaded[d.id]=debugFlag(d.id);
  box.onchange=()=>{settings.set(d.id,box.checked);refresh()};
 }
 const reload=el('div','debug-switch-reload');reload.hidden=true;
 const rbtn=el('button','secondary-button','dbgReload');rbtn.type='button';rbtn.id='dbg-reload';rbtn.onclick=()=>location.reload();
 reload.append(el('span','hint','dbgReloadNote'),rbtn);
 const reset=el('button','secondary-button','dbgReset');reset.type='button';reset.id='dbg-reset';
 armConfirm(reset,()=>{resetDebugFlags((k,v)=>settings.set(k,v));refresh();document.dispatchEvent(new CustomEvent('vrl-settings-sync'))});
 host.append(reload,reset);
 function refresh(){
  let needReload=false;
  for(const d of DEBUG_SWITCHES){const v=debugFlag(d.id);boxes[d.id].checked=v;if(d.when==='reload'&&v!==loaded[d.id])needReload=true}
  reload.hidden=!needReload;
 }
 document.addEventListener('vrl-settings-sync',refresh);
 refresh();
}
