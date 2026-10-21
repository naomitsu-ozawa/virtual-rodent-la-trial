// チュートリアル 2D panel (設定 > 外観 switch -> a panel at the top of the データ panel, above the 体験会 level cards when both are on).
// Mission list (✓ / locked / unavailable + reason), a start button per available mission (engine.start + the mission's practice dataset through the
// same 'vrl-event-sample' route the level cards use), 全部スキップ, 最初から (double press, event-mode.js resetPress; clears vrl.tutorial.v1; resetUserState only while a practice dataset is open, see resetTutorialAll),
// and the current step as a carousel card (n/N, 前へ / 次へ, Japanese body + English subtitle). No new assets are fetched.
// VR-ONLY: the tutorial is for VR/AR. The switch, the voice select and the panel appear only on a device where navigator.xr.isSessionSupported('immersive-vr') resolves true
// (decided asynchronously; hidden until known; no navigator.xr / rejection / false = hidden). The saved setting is never rewritten.
//
// SHARED ENGINE: getTutorialEngine() is the ONE engine of the page. The VR module (tutorial-vr.js) must import it from here and never call createTutorialEngine itself:
//   (import getTutorialEngine from this file)  const eng = getTutorialEngine();  eng.subscribe(snap => ...)
// The instance is kept on globalThis.__vrlTutorialEngine, so it stays single even when the module is loaded under two ?v= URLs.
// Signals: the first getTutorialEngine() also wires document/window 'vrl-tut-signal' ({detail:{kind,count?}}) to engine.onSignal (once; a signal seen on both is counted once).
// A module that wires signals itself must set globalThis.__vrlTutSignalWired=true BEFORE the first getTutorialEngine() call.
import { settings } from './app-settings.js?v=20261021-build641';
import { tr, I18N } from './i18n.js?v=20261021-build641';
import { TUTORIAL_MISSIONS } from './tutorial-data.js?v=20261021-build641';
import { createTutorialEngine } from './tutorial-engine.js?v=20261021-build641';
import { resetPress, resetArmed, RESET_ARM_MS, EVENT_LEVELS } from './event-mode.js?v=20261021-build641';

// the switch (設定 > 外観 > チュートリアル) off = the engine ignores every signal (nothing advances, nothing is saved); on again = as before
// true while the tutorial UI is live (the switch is on AND the device supports VR): the Lv0 card of 体験会 acts as the tutorial only then (event-mode-ui.js)
let uiActive=false;
export const tutorialUiActive=()=>uiActive;
export const tutorialSignalsOn=()=>{try{return globalThis.__vrlSettings?.get?.('tutorialMode')===true}catch{return false}}; // = settings (app-settings.js sets globalThis.__vrlSettings; the same switch tutorialModeOn() reads)
export function getTutorialEngine(opts){
 const g=globalThis;
 if(g.__vrlTutorialEngine)return g.__vrlTutorialEngine;
 const eng=g.__vrlTutorialEngine=createTutorialEngine({...opts});
 if(!g.__vrlTutSignalWired&&typeof document!=='undefined'){
  g.__vrlTutSignalWired=true;
  const seen=new WeakSet();
  const on=e=>{if(seen.has(e))return;seen.add(e);if(!tutorialSignalsOn())return;const d=e.detail;if(d&&typeof d.kind==='string')eng.onSignal({kind:d.kind,count:d.count})};
  document.addEventListener('vrl-tut-signal',on);g.addEventListener?.('vrl-tut-signal',on);
 }
 try{ // no XR on Mac / iPad: ステップ7 (M7, AR) becomes 'unavailable'
  const xr=g.navigator?.xr;
  if(!xr?.isSessionSupported)eng.setEnv({arAvailable:false});
  else xr.isSessionSupported('immersive-ar').then(ok=>eng.setEnv({arAvailable:!!ok}),()=>eng.setEnv({arAvailable:false}));
 }catch{}
 return eng;
}
// pure-ish: true only when the device can start an immersive-vr session (never throws)
export async function detectVrSupport(nav=globalThis.navigator){
 try{const xr=nav?.xr;if(!xr||typeof xr.isSessionSupported!=='function')return false;return (await xr.isSessionSupported('immersive-vr'))===true}catch{return false}
}
export function _resetTutorialEngineForTest(){uiActive=false;delete globalThis.__vrlTutorialEngine;delete globalThis.__vrlTutSignalWired}

// pure: what the panel shows (unit-tested)
export function panelModel(eng){
 const missions=eng.listMissions().map(m=>({id:m.id,stepNo:m.stepNo,titleKey:m.title,status:m.status,reasonKey:m.reason,optional:m.optional,current:m.current,mark:m.status==='done'?'tutDone':null,canStart:m.status==='available'||m.status==='done'}));
 const info=eng.pageInfo(),st=eng.currentStep(),snap=eng.getState();
 const step=info&&st?{n:info.n,N:info.N,textKey:st.text,hasPrev:info.hasPrev,hasNext:info.hasNext,isLast:info.isLast,finished:info.finished,missionId:snap.mission}:null;
 const allDone=missions.filter(m=>m.status!=='unavailable'&&!m.optional).every(m=>m.status==='done');
 return{missions,step,allDone};
}

// 最初から (the same in 2D and VR): the progress (engine + vrl.tutorial.v1) always goes; the marks / distances / HU line (resetUserState) go only while a tutorial practice dataset is open,
// never the visitor's own data. openSample = globalThis.__vrlOpenSample (app.js setOpenSample), read at call time.
// every practice dataset counts (the 体験会 levels' Lv0-Lv3 = sample4..sample1, and the tutorial's own); the visitor's own data never
export const isPracticeSample=id=>!!id&&(EVENT_LEVELS.some(l=>l.sample===id)||TUTORIAL_MISSIONS.some(m=>m.sample===id));
export function resetTutorialAll({engine=getTutorialEngine(),resetUserState,openSample=globalThis.__vrlOpenSample}={}){
 engine.reset();
 if(isPracticeSample(openSample)){try{resetUserState?.()}catch(e){console.warn('Tutorial reset: user state',e)}}
}
// the Lv0 card of 体験会 (tutorial switch on) = the tutorial: continue where the visitor was. A mission under way (not finished) goes on as it is; else the next not-done
// step (ステップ) starts; everything done = nothing starts (the card only opens the data). Returns {action:'resume'|'start'|'none', id}. No dataset is loaded here (every step practises on sample4 = Lv0's data).
export function continueTutorial(engine=getTutorialEngine()){
 const st=engine.getState();
 if(st.mission&&!st.finished)return{action:'resume',id:st.mission};
 const id=engine.nextMissionId();
 if(id&&engine.start(id))return{action:'start',id};
 return{action:'none',id:null};
}
export function initTutorialUi({resetUserState}={}){
 const box=document.getElementById('set-tutorial-mode'),voice=document.getElementById('set-tutorial-voice');
 if(box){box.checked=settings.get('tutorialMode')===true;box.onchange=()=>settings.set('tutorialMode',box.checked)}
 if(voice){voice.value=settings.get('tutorialVoice');voice.onchange=()=>settings.set('tutorialVoice',voice.value)}
 const rows=['tutorial-row-mode','tutorial-row-note','tutorial-row-voice'].map(i=>document.getElementById(i)).filter(Boolean);
 let panel=null,unsub=null,armedUntil=0,armTimer=0,loading=false,vr=false;
 const showRows=on=>{for(const r of rows){r.hidden=!on;if(r.style)r.style.display=on?'':'none'}};
 const el=(tag,cls,key)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(key){e.dataset.i18n=key;e.textContent=tr(key)}return e};
 const btn=(cls,key,fn)=>{const b=el('button',cls,key);b.type='button';b.onclick=fn;return b};
 const startMission=async id=>{
  const eng=getTutorialEngine();if(loading||!eng.start(id))return;
  const sample=TUTORIAL_MISSIONS.find(x=>x.id===id)?.sample;
  if(!sample||globalThis.__vrlOpenSample===sample)return;
  const ev=new CustomEvent('vrl-event-sample',{detail:{sampleSet:sample,done:null}});document.dispatchEvent(ev);
  if(!ev.detail.done)return;
  loading=true;render();try{await ev.detail.done}catch{}loading=false;render();
 };
 const pressReset=()=>{
  const r=resetPress(armedUntil,performance.now());armedUntil=r.armedUntil;clearTimeout(armTimer);
  if(!r.fire){armTimer=setTimeout(()=>{armedUntil=0;render()},RESET_ARM_MS+80);render();return}
  resetTutorialAll({resetUserState});
  render();
 };
 function render(){
  if(!panel)return;const eng=getTutorialEngine(),model=panelModel(eng);
  panel.setAttribute('aria-busy',String(loading));
  const list=panel.querySelector('.tut-list');list.replaceChildren();
  for(const m of model.missions){
   const row=el('div','tut-row');row.dataset.tutMission=m.id;row.dataset.tutStatus=m.status;if(m.current)row.classList.add('is-current');
   const name=el('span','tut-name'),mark=el('span','tut-mark'),no=el('span','tut-stepno'),noW=el('span','',"tutStepWord"),noN=el('span','tut-stepno-n');noN.textContent=String(m.stepNo);no.append(noW,noN);name.append(no,el('span','tut-name-title',m.titleKey)); // ステップN + the title (the number is fixed: M1..M7 = 1..7)
   mark.textContent=m.status==='done'?tr('tutDone'):m.status==='locked'?'🔒':m.status==='unavailable'?'–':'';
   if(m.status==='done')mark.setAttribute('aria-label','done');
   row.append(mark,name);
   if(m.optional)row.append(el('span','tut-opt','tutOptional'));
   if(m.status==='locked')row.append(el('span','tut-reason','tutLocked'));
   else if(m.status==='unavailable'&&m.reasonKey)row.append(el('span','tut-reason',m.reasonKey));
   else{const b=btn('tut-start',m.status==='done'?'tutRetry':'tutStart',()=>startMission(m.id));b.disabled=loading;b.dataset.tutStart=m.id;row.append(b)}
   list.append(row);
  }
  const card=panel.querySelector('.tut-card'),s=model.step;card.hidden=!s;
  if(s){
   card.replaceChildren();
   const head=el('div','tut-card-head'),count=el('span','tut-count');count.textContent=s.n+'/'+s.N;count.dataset.tutCount='1';
   head.append(count);card.append(head);
   if(s.finished){card.append(el('p','tut-text',model.allDone?'tutAllDone':'tutMissionDone'))}
   else{
    card.append(el('p','tut-text',s.textKey));
    const sub=el('p','tut-sub');sub.textContent=I18N.en?.[s.textKey]||'';sub.lang='en';card.append(sub);
   }
   const nav=el('div','tut-nav');
   const prev=btn('tut-prev','tutPrev',()=>getTutorialEngine().prev());prev.disabled=!s.hasPrev;
   const next=btn('tut-next',s.isLast?'tutFinish':'tutNext',()=>getTutorialEngine().next());next.disabled=!s.hasNext;
   nav.append(prev,next,btn('tut-skip-mission','tutSkipMission',()=>getTutorialEngine().skipMission()));card.append(nav);
  }
  if(model.allDone&&!s)panel.querySelector('.tut-all').hidden=false;else panel.querySelector('.tut-all').hidden=true;
  const rb=panel.querySelector('.tut-reset'),armed=resetArmed(armedUntil,performance.now()),key=armed?'tutResetAgain':'tutReset';
  rb.classList.toggle('is-armed',armed);rb.dataset.i18n=key;rb.textContent=tr(key);
 }
 function mount(){
  panel=el('section','tut-panel');panel.id='tutorial-panel';panel.setAttribute('aria-labelledby','tut-title');
  const title=el('strong','tut-title','tutTitle');title.id='tut-title';
  const all=el('p','tut-all','tutAllDone');all.hidden=true;
  const tools=el('div','tut-tools');
  const skipAll=btn('tut-skip-all','tutSkipAll',()=>getTutorialEngine().skipAll());
  const rb=btn('tut-reset','tutReset',pressReset);
  tools.append(skipAll,rb);
  panel.append(title,el('div','tut-list'),el('div','tut-card'),all,tools);
  const host=document.querySelector('[data-ipad-drawer-section="data"]')||document.querySelector('.sidebar-scroll > .panel');
  if(host)host.prepend(panel);else document.body.append(panel);
  unsub=getTutorialEngine().subscribe(render);render();
 }
 const sync=()=>{
  const on=vr&&settings.get('tutorialMode')===true;uiActive=on;if(box)box.checked=settings.get('tutorialMode')===true;if(voice)voice.value=settings.get('tutorialVoice');
  if(on&&!panel)mount();else if(!on&&panel){unsub?.();unsub=null;panel.remove();panel=null;armedUntil=0;clearTimeout(armTimer)}
 };
 window.addEventListener('vrl-settings',e=>{if(e.detail?.key==='tutorialMode'||e.detail?.key==='tutorialVoice')sync()});
 document.addEventListener('vrl-event-sample-open',()=>render());
 showRows(false);
 detectVrSupport().then(ok=>{vr=ok;showRows(ok);sync()});
}
