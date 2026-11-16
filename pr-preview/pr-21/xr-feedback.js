const fmt=(t,v)=>t.replace(/\{(\w+)\}/g,(_,k)=>v[k]??'');
const MSG={loading:'vrStepLoading',starting:'vrStepStarting',running:'vrStepRunning'},BTN={loading:'vrBtnBusy',prepare:'vrBtnBusy',starting:'vrBtnStarting',running:'vrBtnRunning'};
export function createXrFeedback({buttons,footer,tr}){
 let step='',saved=null,pressed=null,mine='';
 const all=buttons.filter(Boolean);
 // while busy the label is ours (data-i18n removed so a language switch does not overwrite it); afterwards it is the button's own again
 const label=(b,key)=>{if(key){b.removeAttribute('data-i18n');b.textContent=tr(key)}else{if(b.dataset.xrI18n){b.setAttribute('data-i18n',b.dataset.xrI18n);b.textContent=tr(b.dataset.xrI18n)}}};
 const line=text=>{if(!footer)return;if(saved===null)saved=footer.textContent;footer.textContent=mine=text};
 function set(next,{button,mode='vr',text=''}={}){
  if(button)pressed=button;
  step=next;const m=mode==='ar'?'AR':'VR';
  for(const b of all){if(b.dataset.xrI18n===undefined)b.dataset.xrI18n=b.getAttribute('data-i18n')||'';b.disabled=true;b.setAttribute('aria-busy','true')}
  if(pressed)label(pressed,BTN[next]);
  line(next==='prepare'?fmt(tr('vrStepPrepare'),{m,t:text}):fmt(tr(MSG[next]),{m}));
 }
 function clear(){
  if(!step)return;step='';
  for(const b of all){b.disabled=false;b.removeAttribute('aria-busy');label(b,null)}
  pressed=null;
  // a message of something else written meanwhile (a failure, say) stays
  if(footer&&saved!==null&&footer.textContent===mine)footer.textContent=saved;
  saved=null;mine='';
 }
 return{set,clear,get step(){return step}};
}
