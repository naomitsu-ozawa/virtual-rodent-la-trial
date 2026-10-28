// Linux Chrome: WebGPU can be missing (navigator.gpu absent, or requestAdapter() null) even though chrome://gpu
// reports it as hardware accelerated, unless Chrome is launched with --enable-features=ForceEnableWebGpuInterop
// (Wayland only; X11 is unsupported). This module shows a short note + expandable explanation under the GPU status
// bar, only on Linux and only when WebGPU is unavailable. Self-contained: one call from updateGpuStatus().
import { tr } from './i18n.js?v=20261027-build680';

export const isLinuxUserAgent=ua=>/Linux/i.test(ua||'')&&!/Android|CrOS/i.test(ua||'');
// pure decision: show only on Linux, and only when WebGPU is unavailable
export const shouldShowLinuxWebgpuNote=({ua,hasGpu,adapterNull})=>isLinuxUserAgent(ua)&&(!hasGpu||adapterNull===true);

let probed=null; // null = not probed, 'pending', or boolean adapterNull
// read-only status for the debug-mode GPU info tab (reads state, probes nothing)
export function linuxWebgpuNoteState(){
 try{return{linux:isLinuxUserAgent(globalThis.navigator?.userAgent),probed,shown:!!document.getElementById('linux-webgpu-note-btn')}}catch{return{linux:false,probed,shown:false}}
}
async function probeAdapterNull(gpu){
 const tries=[{powerPreference:'high-performance',featureLevel:'core'},{powerPreference:'high-performance'},undefined,{powerPreference:'high-performance',featureLevel:'compatibility'},{featureLevel:'compatibility'}];
 for(const o of tries){try{if(await gpu.requestAdapter(o))return false}catch{}}
 return true;
}
export function updateLinuxWebgpuNote(){
 try{
  const bar=document.getElementById('gpu-status-bar');if(!bar)return;
  const nav=globalThis.navigator,ua=nav?.userAgent||'',hasGpu=!!nav&&'gpu' in nav&&!!nav.gpu;
  if(!isLinuxUserAgent(ua))return;
  if(hasGpu&&probed===null){probed='pending';probeAdapterNull(nav.gpu).then(v=>{probed=v;updateLinuxWebgpuNote()}).catch(()=>{probed=false})}
  const show=shouldShowLinuxWebgpuNote({ua,hasGpu,adapterNull:probed===true});
  let btn=document.getElementById('linux-webgpu-note-btn'),box=document.getElementById('linux-webgpu-note-text');
  if(!show){if(btn)btn.remove();if(box)box.remove();return}
  if(!btn){
   btn=document.createElement('button');btn.type='button';btn.id='linux-webgpu-note-btn';btn.dataset.i18n='linuxGpuNote';btn.setAttribute('aria-expanded','false');
   btn.style.cssText='margin-left:8px;padding:0 6px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:5px;cursor:pointer';
   box=document.createElement('div');box.id='linux-webgpu-note-text';box.hidden=true;box.dataset.i18n='linuxGpuNoteText';box.className='gpu-status-bar is-warning';
   btn.addEventListener('click',()=>{box.hidden=!box.hidden;btn.setAttribute('aria-expanded',String(!box.hidden))});
   bar.appendChild(btn);bar.after(box);
  }
  btn.textContent=tr('linuxGpuNote');box.textContent=tr('linuxGpuNoteText');
 }catch{}
}
