// Theme picker: the select in the top bar and the cards in settings > Appearance. Both show the same choice
// (theme.js keeps it, localStorage 'vrl-theme'; with no choice it follows the OS light / dark setting).
import { THEMES, createThemeController } from './theme.js?v=20261021-build638';
import { tr } from './i18n.js?v=20261021-build638';
const key=id=>id.replace(/-/g,'_');
export function initThemeUi(){
 const ctl=createThemeController(),select=document.getElementById('theme-quick'),box=document.getElementById('theme-options');
 if(box){
  for(const t of THEMES){
   const b=document.createElement('button');b.type='button';b.className='theme-option';b.dataset.themeId=t.id;b.setAttribute('role','radio');
   const sw=document.createElement('span');sw.className='theme-swatch';
   for(const c of t.preview){const i=document.createElement('i');i.style.background=c;sw.append(i)}
   const name=document.createElement('span');name.dataset.i18n='theme_'+key(t.id);name.textContent=tr('theme_'+key(t.id));
   const desc=document.createElement('small');desc.dataset.i18n='themeDesc_'+key(t.id);desc.textContent=tr('themeDesc_'+key(t.id));
   b.append(sw,name,desc);b.onclick=()=>ctl.set(t.id);box.append(b);
  }
  box.addEventListener('keydown',e=>{
   const i=THEMES.findIndex(t=>t.id===ctl.get()),d=e.key==='ArrowRight'||e.key==='ArrowDown'?1:e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:0;
   if(!d)return;e.preventDefault();const n=THEMES[(i+d+THEMES.length)%THEMES.length].id;ctl.set(n);box.querySelector('[data-theme-id="'+n+'"]')?.focus();
  });
 }
 const sync=()=>{
  if(select)select.value=ctl.get();
  for(const b of box?.children||[]){const on=b.dataset.themeId===ctl.get();b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1}
 };
 if(select)select.onchange=()=>ctl.set(select.value);
 ctl.onChange(sync);sync();
 return ctl;
}
