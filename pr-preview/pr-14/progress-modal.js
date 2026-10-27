import { currentLanguage } from './state.js?v=20261027-build678';

export const SHOW_DELAY=400,ESCAPE_MS=10000,CANCEL_GRACE=3000;

// slot bookkeeping without the DOM (unit-tested)
export function createJobTracker({now=()=>performance.now(),delay=SHOW_DELAY,escapeMs=ESCAPE_MS,cancelGrace=CANCEL_GRACE}={}){
 const slots=new Map();let seq=0;
 const slot=name=>{let s=slots.get(name);if(!s){s={name,count:0,active:false,label:'',detail:'',done:0,total:0,cancel:null,cancelling:false,cancelAt:0,started:0,seq:0,dismissed:false};slots.set(name,s)}return s};
 const set=(name,on,{label,cancel,counted=false}={})=>{
  const s=slot(name),was=s.active;
  if(counted){s.count=on?s.count+1:Math.max(0,s.count-1);s.active=s.count>0}else{s.count=on?1:0;s.active=!!on}
  if(s.active&&!was){s.started=now();s.seq=++seq;s.dismissed=false;s.cancelling=false;s.detail='';s.done=0;s.total=0;s.cancel=null}
  if(s.active){if(label)s.label=label;if(cancel!==undefined)s.cancel=cancel||null}
  if(!s.active){s.cancel=null;s.cancelling=false}
 };
 const top=()=>{let best=null;for(const s of slots.values())if(s.active&&!s.dismissed&&(!best||s.seq>best.seq))best=s;return best};
 const progress=(name,done,total,detail)=>{const s=name==null?top():slots.get(name);if(!s?.active)return;s.done=+done||0;s.total=+total||0;if(detail!=null)s.detail=String(detail)};
 const anyActive=()=>{for(const s of slots.values())if(s.active)return true;return false};
 const view=()=>{
  const s=top();if(!s)return{visible:false};
  const t=now(),elapsed=t-s.started;if(elapsed<delay)return{visible:false,showAt:s.started+delay};
  const frac=s.total>0?Math.min(1,Math.max(0,s.done/s.total)):null;
  // close (keeps running) once the escape time has passed: without a cancel path, or when a 中断 has not ended the job within the grace time
  const canClose=elapsed>=escapeMs&&(!s.cancel||(s.cancelling&&t-s.cancelAt>=cancelGrace));
  const button=canClose?{kind:'close',disabled:false}:s.cancel?{kind:'cancel',disabled:s.cancelling}:null;
  return{visible:true,name:s.name,label:s.label,detail:s.detail,frac,elapsed,button,cancelling:s.cancelling};
 };
 // the modal's button: run the cancel path, or hide the modal for this run of the slot
 const press=()=>{const s=top();if(!s)return;const b=view().button;if(!b||b.disabled)return;if(b.kind==='close'){s.dismissed=true;return}s.cancelling=true;s.cancelAt=now();try{s.cancel()}catch(e){console.error(e)}};
 return{set,progress,view,press,top,anyActive,slots};
}

const tracker=createJobTracker();
let root=null,els=null,timer=0,ticker=0;
const T=()=>currentLanguage==='en'?{cancel:'Stop',cancelling:'Stopping…',close:'Close (keeps running)',closeHelp:'No response? The work goes on in the background.',elapsed:'Elapsed '}:{cancel:'中断',cancelling:'中断中…',close:'閉じる（処理は続行）',closeHelp:'応答がないときは閉じられます。処理は裏で続きます。',elapsed:'経過 '};
function build(){
 if(root||typeof document==='undefined'||!document.body)return;
 root=document.createElement('div');root.id='job-modal';root.className='job-modal is-hidden';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-live','polite');
 root.innerHTML='<div class="job-card"><div class="job-head"><div class="job-spinner" aria-hidden="true"></div><strong class="job-title"></strong></div><div class="job-detail"></div><div class="job-track"><div class="job-bar"></div></div><div class="job-foot"><span class="job-time"></span><button type="button" class="job-button"></button></div><div class="job-help"></div></div>';
 document.body.append(root);
 const q=c=>root.querySelector(c);els={title:q('.job-title'),detail:q('.job-detail'),track:q('.job-track'),bar:q('.job-bar'),time:q('.job-time'),button:q('.job-button'),help:q('.job-help')};
 els.button.onclick=()=>{tracker.press();render()};
 // input stays blocked while shown: pointer and wheel by the full-screen root (its own non-passive wheel listener
 // costs nothing while it is hidden), key presses here (key releases pass, so no key stays held in the app)
 root.addEventListener('wheel',e=>e.preventDefault(),{passive:false});
 const block=e=>{if(root.classList.contains('is-hidden')||root.contains(e.target))return;e.preventDefault();e.stopPropagation()};
 for(const ev of ['keydown','keypress'])window.addEventListener(ev,block,{capture:true});
}
function render(){
 clearTimeout(timer);timer=0;build();if(!root)return;
 const v=tracker.view(),t=T();
 if(!v.visible){
  root.classList.add('is-hidden');
  if(v.showAt!=null)timer=setTimeout(render,Math.max(0,v.showAt-performance.now())+5);
  if(!tracker.anyActive()){clearInterval(ticker);ticker=0}
  return;
 }
 root.classList.remove('is-hidden');
 els.title.textContent=v.label||'…';els.detail.textContent=v.detail||'';els.detail.classList.toggle('is-hidden',!v.detail);
 els.track.classList.toggle('is-indeterminate',v.frac==null);els.bar.style.width=v.frac==null?'':Math.round(v.frac*100)+'%';
 els.time.textContent=t.elapsed+Math.floor(v.elapsed/1000)+(currentLanguage==='en'?' s':' 秒')+(v.frac!=null?' · '+Math.round(v.frac*100)+'%':'');
 const b=v.button;els.button.classList.toggle('is-hidden',!b);
 if(b){els.button.textContent=b.kind==='cancel'?(v.cancelling?t.cancelling:t.cancel):t.close;els.button.disabled=b.disabled;els.button.classList.toggle('is-close',b.kind==='close')}
 els.help.textContent=b?.kind==='close'?t.closeHelp:'';els.help.classList.toggle('is-hidden',b?.kind!=='close');
 if(!ticker)ticker=setInterval(render,250);
}
export function setBusySlot(name,on,opts){tracker.set(name,on,opts);render()}
// new title for a running slot (ignored when the slot is not running, so a stray call cannot open the modal)
export function setBusyLabel(name,label){const s=tracker.slots.get(name);if(s?.active&&label){s.label=label;render()}}
export function reportBusyProgress(name,done,total,detail){tracker.progress(name,done,total,detail);if(root&&!root.classList.contains('is-hidden'))render()}
// for checks: is the modal shown / is any slot active
export function busyModalState(){const v=tracker.view();return{visible:!!v.visible,active:tracker.anyActive(),label:v.label||'',name:v.name||''}}
if(typeof window!=='undefined')window.__vrlBusyModal=busyModalState;
