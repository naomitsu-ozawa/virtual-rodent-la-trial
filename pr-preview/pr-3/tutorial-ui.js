import { settings } from './app-settings.js?v=20261022-build642';
import { tr, I18N } from './i18n.js?v=20261022-build642';
import { TUTORIAL_MISSIONS, TUT_SAMPLE, TUT_INTRO } from './tutorial-data.js?v=20261022-build642';
import { createTutorialAudio } from './tutorial-audio.js?v=20261022-build642';
import { createTutorialEngine } from './tutorial-engine.js?v=20261022-build642';
import { resetPress, resetArmed, RESET_ARM_MS, EVENT_LEVELS } from './event-mode.js?v=20261022-build642';

// the switch (設定 > 外観 > チュートリアル) off = the engine ignores every signal (nothing advances, nothing is saved); on again = as before
// true while the tutorial UI is live (the switch is on AND the device supports VR): the Lv0 card of 体験会 acts as the tutorial only then (event-mode-ui.js)
let uiActive=false;
export const tutorialUiActive=()=>uiActive;
// signals count only while the switch is on AND the tutorial's practice data (TUT_SAMPLE = the Lv0 data) is the open one: on any other practice data (Lv1-Lv3) or the
// visitor's own data nothing advances (the tutorial never takes over another dataset)
export const tutorialSignalsOn=()=>{try{return globalThis.__vrlSettings?.get?.('tutorialMode')===true&&globalThis.__vrlOpenSample===TUT_SAMPLE}catch{return false}}; // = settings (app-settings.js sets globalThis.__vrlSettings; the same switch tutorialModeOn() reads)
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
 return eng; // no AR step any more (nothing depends on AR support)
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

// 最初から (the same in 2D and VR): the progress (the engine's, in memory) always goes; the marks / distances / HU line (resetUserState) go only while a tutorial practice dataset is open,
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
export function restartTutorial(engine=getTutorialEngine(),{start=true}={}){
 engine.reset();
 if(!start)return{action:'none',id:null};
 const id=engine.nextMissionId();
 return id&&engine.start(id)?{action:'start',id}:{action:'none',id:null};
}
// a value an older build saved (vrl.tutorial.v1) is never read; it is removed once so no stale copy stays around
export function forgetLegacyProgress(storage){
 try{(storage===undefined?globalThis.localStorage:storage)?.removeItem?.('vrl.tutorial.v1')}catch{}
}
// the page's introduction after 「チュートリアルを始める」 (the topbar button, VR devices only): a subtitle bar (+ the voice once per phase) that guides
//   'openLv0': open the Lv0 practice data (the 体験会 Lv0 card when it is there, else 「練習データ」 and its 骨梁 entry are lit; nothing is opened for the visitor)
//   'loading': the Lv0 data was chosen but is not READY yet: the bar says to wait (no VR / AR button is lit, nothing is spoken)
//   'pressVr': the Lv0 data is READY (the volume is prepared, see sampleReady): press 「VRで見る」 (or 「ARで見る」)
// A target that is newly lit is scrolled into view (nearest: nothing moves when it is already visible).
// and ends when a VR / AR session starts (signal 'vr-start' / 'ar-start'; the VR board then shows ステップ1) or with its 閉じる button. Opening other data goes back to 'openLv0'.
// ready = the volume of the open data is prepared. data-load.js selectSeries sets globalThis.__vrlVolumeReady = true as its LAST step (after decode, configure, the GPU / MPR
// preparation and the first render) and false when a series starts loading; app.js setOpenSample sets it false when a dataset is chosen. The progress modal (#job-modal) is no
// signal by itself: it stays hidden for the first moments of a load (progress-modal.js showAfter delay), which is why 「VRで見る」 used to be announced at once.
export const sampleReady=(g=globalThis)=>g.__vrlVolumeReady===true;
export const introPhase=(openSample,ready=true)=>openSample!==TUT_SAMPLE?'openLv0':ready?'pressVr':'loading';
const shown=e=>!!e&&!e.hidden&&!e.closest?.('[hidden]');
export function introTargets(phase,doc=globalThis.document){
 if(!doc)return[];
 if(phase==='openLv0'){const card=doc.querySelector('[data-event-level="lv0"]');if(shown(card))return[card];return[doc.getElementById('sample-demo-button'),doc.querySelector('[data-sample-set="'+TUT_SAMPLE+'"]')].filter(shown)}
 if(phase==='loading')return[];
 if(phase==='pressVr')return['vr-view-button','ar-view-button'].map(id=>doc.getElementById(id)).filter(shown);
 return[];
}
export function introTextKey(phase,doc=globalThis.document){
 if(phase==='openLv0')return shown(doc?.querySelector('[data-event-level="lv0"]'))?'tutIntroLv0':'tutIntroLv0Off';
 if(phase==='loading')return'tutIntroLoading';
 if(phase==='pressVr'){const v=doc?.getElementById('vr-view-button'),a=doc?.getElementById('ar-view-button'),job=doc?.getElementById('job-modal');if(!shown(v)||v.disabled||(job&&!job.classList.contains('is-hidden')))return'tutIntroLoading';return shown(a)?'tutIntroVr':'tutIntroVrOnly'}
 return'';
}
export function createTutorialIntro({doc=globalThis.document,audio=null,getOpenSample=()=>globalThis.__vrlOpenSample,getReady=()=>sampleReady(),tickMs=500}={}){
 let phase=null,bar=null,timer=0,lit=new Set();const spoken=new Set();
 const want=()=>introPhase(getOpenSample(),getReady());
 const paint=()=>{
  if(!phase||!bar)return;
  {const w=want();if(w!==phase){setPhase(w);return}} // the data became ready / was replaced: the phase follows (checked every tick)
  const next=new Set(introTargets(phase,doc));
  for(const e of lit)if(!next.has(e))e.classList.remove('tut-hl');
  for(const e of next)if(!lit.has(e)){e.classList.add('tut-hl');try{e.scrollIntoView?.({block:'nearest',behavior:'smooth'})}catch{}}
  lit=next;
  const key=introTextKey(phase,doc),t=bar.querySelector('.tut-guide-text');
  if(t.dataset.i18n!==key){t.dataset.i18n=key;t.textContent=tr(key)}
  bar.dataset.tutPhase=phase;
 };
 const say=()=>{const it=phase&&TUT_INTRO[phase];if(it&&!spoken.has(it.id)){spoken.add(it.id);try{audio?.play([it.audio])}catch{}}};
 const setPhase=p=>{const changed=p!==phase;phase=p;paint();if(changed)say()};
 function mount(){
  bar=doc.createElement('div');bar.id='tut-guide';bar.className='tut-guide';bar.setAttribute('role','status');
  const t=doc.createElement('span');t.className='tut-guide-text';
  const x=doc.createElement('button');x.type='button';x.className='tut-guide-close';x.dataset.i18n='tutGuideClose';x.textContent=tr('tutGuideClose');x.onclick=()=>stop();
  bar.append(t,x);doc.body.append(bar);
 }
 function start(){if(!bar)mount();spoken.clear();phase=null;setPhase(want());clearInterval(timer);timer=setInterval(paint,tickMs)}
 function stop(){phase=null;clearInterval(timer);timer=0;for(const e of lit)e.classList.remove('tut-hl');lit=new Set();bar?.remove();bar=null}
 doc?.addEventListener?.('vrl-event-sample-open',()=>{if(phase)setPhase(want())});
 doc?.addEventListener?.('vrl-tut-signal',e=>{const k=e.detail?.kind;if(phase&&(k==='vr-start'||k==='ar-start'))stop()});
 return{start,stop,get phase(){return phase},get active(){return!!phase}};
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
   if(s.finished){card.append(el('p','tut-text',model.allDone?'tutAllDone':'tutMissionDone'));card.append(el('p','tut-next-note',model.allDone?'tutFbEnd':'tutFbGoNext'))} // a cleared ステップ waits for 次へ (it opens the next ステップ)
   else{
    card.append(el('p','tut-text',s.textKey));
    const sub=el('p','tut-sub');sub.textContent=I18N.en?.[s.textKey]||'';sub.lang='en';card.append(sub);
   }
   const nav=el('div','tut-nav');
   const prev=btn('tut-prev','tutPrev',()=>getTutorialEngine().prev());prev.disabled=!s.hasPrev;
   const next=btn('tut-next',s.isLast&&!s.finished?'tutFinish':'tutNext',()=>getTutorialEngine().next());next.disabled=!s.hasNext;
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
 // 「チュートリアルを始める」 in the top bar, just before 「VRで見る」 (always in view, whichever panel is open; VR devices only): switches the tutorial on, continues it (the next step not done) and starts the introduction
 const intro=createTutorialIntro({audio:createTutorialAudio({getVoice:()=>settings.get('tutorialVoice')})});
 const mountCta=()=>{
  if(document.getElementById('tutorial-start-button'))return;
  const b=el('button','tut-cta','tutCta');b.id='tutorial-start-button';b.type='button';
  b.onclick=()=>{if(settings.get('tutorialMode')!==true)settings.set('tutorialMode',true);sync();restartTutorial();intro.start()}; // every start is from ステップ1 (nothing is remembered)
  const at=document.getElementById('vr-view-button');
  if(at?.parentNode)at.parentNode.insertBefore(b,at);else document.querySelector('.topbar-actions')?.prepend(b);
 };
 window.addEventListener('vrl-settings',e=>{if(e.detail?.key==='tutorialMode'&&settings.get('tutorialMode')!==true)intro.stop()});
 forgetLegacyProgress();
 showRows(false);
 detectVrSupport().then(ok=>{vr=ok;showRows(ok);if(ok)mountCta();sync()});
}
