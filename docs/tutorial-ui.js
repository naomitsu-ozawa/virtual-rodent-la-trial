import { settings } from './app-settings.js?v=20261027-build679';
import { tr } from './i18n.js?v=20261027-build679';
import { TUTORIAL_MISSIONS, TUT_SAMPLE, TUT_INTRO, TUT_VOICE_PICK } from './tutorial-data.js?v=20261027-build679';
import { createTutorialAudio } from './tutorial-audio.js?v=20261027-build679';
import { createTutorialEngine } from './tutorial-engine.js?v=20261027-build679';
import { EVENT_LEVELS } from './event-mode.js?v=20261027-build679';

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

// 最初から (the same in 2D and VR): the progress (the engine's, in memory) always goes; the marks / distances / HU line (resetUserState) go only while a tutorial practice dataset is open,
// never the visitor's own data. openSample = globalThis.__vrlOpenSample (app.js setOpenSample), read at call time.
// every practice dataset counts (the 体験会 levels' Lv0-Lv3 = sample4..sample1, and the tutorial's own); the visitor's own data never
export const isPracticeSample=id=>!!id&&(EVENT_LEVELS.some(l=>l.sample===id)||TUTORIAL_MISSIONS.some(m=>m.sample===id));
export function resetTutorialAll({engine=getTutorialEngine(),resetUserState,openSample=globalThis.__vrlOpenSample}={}){
 engine.reset();
 if(isPracticeSample(openSample)){try{resetUserState?.()}catch(e){console.warn('Tutorial reset: user state',e)}}
}
// forget the progress of this page and open ステップ1. Only the engine's own (in-memory) progress goes; the marks / distances of the data are not touched here.
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
//   'startVr': after 「VRで見る」 the page's preparation panel shows its 「VRを開始」 button: the bar says to press it (lit)
//   'pressVr': the Lv0 data is READY (the volume is prepared, see sampleReady): press 「VRで見る」 (or 「ARで見る」)
// A target that is newly lit is scrolled into view (nearest: nothing moves when it is already visible).
// and ends when a VR / AR session starts (signal 'vr-start' / 'ar-start'; the VR board then shows ステップ1) or with its 閉じる button. Opening other data goes back to 'openLv0'.
// ready = the volume of the open data is prepared. data-load.js selectSeries sets globalThis.__vrlVolumeReady = true as its LAST step (after decode, configure, the GPU / MPR
// preparation and the first render) and false when a series starts loading; app.js setOpenSample sets it false when a dataset is chosen. The progress modal (#job-modal) is no
// signal by itself: it stays hidden for the first moments of a load (progress-modal.js showAfter delay), which is why 「VRで見る」 used to be announced at once.
export const sampleReady=(g=globalThis)=>g.__vrlVolumeReady===true;
// prepared = the page's VR / AR preparation panel (#vr-prepare-panel: shown after 「VRで見る」 when the data of the session is not ready yet) is up with its start button: 'startVr'
// (a start button that is disabled - the preparation failed or is not finished - is not announced)
export const preparePanelShown=(doc=globalThis.document)=>{try{const p=doc?.getElementById?.('vr-prepare-panel');const b=p?.querySelector?.('.start');return !!p&&p.style?.display!=='none'&&!!b&&!b.disabled}catch{return false}};
// the page is done loading only when EVERYTHING the visitor can see is quiet. __vrlVolumeReady is true right after the volume is prepared, but the bundled project is applied after that
// (the filters are replayed, the segments rebuilt: a job with its own progress dialog, about 100 s on a slow device) and the 「VRで見る」 button can be busy (the session's preparation).
// readiness = volume ready AND no progress job running or shown (__vrlBusyModal: active / visible) AND the VR button there and enabled AND the AR check finished (__vrlXrChecked: whether the
// AR button exists is only known then), and all of that holding for quietMs without a break (jobs chain: there is a gap between one and the next).
export const pageBusy=(g=globalThis)=>{try{const b=g.__vrlBusyModal?.();return !!(b&&(b.active||b.visible))}catch{return false}};
export const xrChecked=(g=globalThis)=>g.__vrlXrChecked===true;
export const READY_QUIET_MS=1500;
export function createReadyGate({now=()=>performance.now(),quietMs=READY_QUIET_MS,volumeReady=()=>sampleReady(),busy=()=>pageBusy(),buttonsOk=()=>true}={}){
 let since=null;
 return{
  ready(){const ok=!!volumeReady()&&!busy()&&!!buttonsOk(),t=now();if(!ok){since=null;return false}if(since==null)since=t;return t-since>=quietMs},
  reset(){since=null},
  get since(){return since},
 };
}
// the Lv1-Lv3 practice data (体験会): the data the tutorial leads to after the last ステップ
export const LV_SAMPLES=Object.freeze(EVENT_LEVELS.filter(l=>l.lv>=1).map(l=>l.sample));
// mode 'lv0' (after 「チュートリアルを始める」): open Lv0, then press VR / AR. mode 'levels' (after the last ステップ, back on the page): choose one of Lv1-Lv3, then press VR / AR.
export const introPhase=(openSample,ready=true,prepared=false,mode='lv0')=>{
 const open=mode==='levels'?LV_SAMPLES.includes(openSample):openSample===TUT_SAMPLE;
 return !open?(mode==='levels'?'chooseLv':'openLv0'):prepared?'startVr':!ready?'loading':'pressVr';
};
const shown=e=>!!e&&!e.hidden&&!e.closest?.('[hidden]');
// laid out on screen (not inside a closed drawer tab / display:none); an element of a fake / old DOM without offsetParent counts as laid out
export const laidOut=e=>!!e&&(e.offsetParent===undefined||e.offsetParent!==null||e.tagName==='BODY');
// The cards / the 練習データ button are in the データ tab of the drawer, but after a load the page switches to the 表示 tab (data-load.js selectSeries): lit, yet invisible. When the targets of the
// openLv0 / chooseLv phases are not laid out, the データ tab is opened for the visitor (and the first target is centred in its scrolling panel).
export function revealTargets(phase,targets,doc=globalThis.document){
 if(phase!=='openLv0'&&phase!=='chooseLv')return false;
 if(!targets.length||targets.some(laidOut))return false;
 const tab=doc?.querySelector?.('[data-ipad-drawer-tab="data"]');if(!tab)return false;
 try{tab.click();return true}catch{return false}
}
export function introTargets(phase,doc=globalThis.document){
 if(!doc)return[];
 if(phase==='openLv0'){const card=doc.querySelector('[data-event-level="lv0"]');if(shown(card))return[card];return[doc.getElementById('sample-demo-button'),doc.querySelector('[data-sample-set="'+TUT_SAMPLE+'"]')].filter(shown)}
 if(phase==='chooseLv'){const cards=LV_SAMPLES.map((_,i)=>doc.querySelector('[data-event-level="lv'+(i+1)+'"]')).filter(shown);if(cards.length)return cards;return[doc.getElementById('sample-demo-button'),...LV_SAMPLES.map(id=>doc.querySelector('[data-sample-set="'+id+'"]'))].filter(shown)}
 if(phase==='loading')return[];
 if(phase==='startVr'){const b=doc.getElementById('vr-prepare-panel')?.querySelector?.('.start');return shown(b)&&!b.disabled?[b]:[]}
 if(phase==='pressVr')return['vr-view-button','ar-view-button'].map(id=>doc.getElementById(id)).filter(shown);
 return[];
}
export function introTextKey(phase,doc=globalThis.document){
 if(phase==='openLv0')return shown(doc?.querySelector('[data-event-level="lv0"]'))?'tutIntroLv0':'tutIntroLv0Off';
 if(phase==='chooseLv')return shown(doc?.querySelector('[data-event-level="lv1"]'))?'tutIntroLv123':'tutIntroLv123Off';
 if(phase==='loading')return'tutIntroLoading';
 if(phase==='startVr')return'tutIntroStart';
 if(phase==='pressVr'){const v=doc?.getElementById('vr-view-button'),a=doc?.getElementById('ar-view-button'),job=doc?.getElementById('job-modal');if(!shown(v)||v.disabled||(job&&!job.classList.contains('is-hidden')))return'tutIntroLoading';return shown(a)?'tutIntroVr':'tutIntroVrOnly'}
 return'';
}
export function createTutorialIntro({doc=globalThis.document,audio=null,getOpenSample=()=>globalThis.__vrlOpenSample,getReady=null,tickMs=500,levelsVoiceDelayMs=3500,now=()=>performance.now()}={}){
 let phase=null,bar=null,timer=0,voiceTimer=0,mode='lv0',lit=new Set();const spoken=new Set(),scrolled=new WeakSet();
 const gate=createReadyGate({now,buttonsOk:()=>{const v=doc?.getElementById?.('vr-view-button');return xrChecked()&&shown(v)&&!v.disabled}});
 const ready=getReady||(()=>gate.ready());
 const want=()=>introPhase(getOpenSample(),ready(),preparePanelShown(doc),mode);
 const paint=()=>{
  if(!phase||!bar)return;
  {const w=want();if(w!==phase){setPhase(w);return}} // the data became ready / was replaced: the phase follows (checked every tick)
  const targets=introTargets(phase,doc),next=new Set(targets);
  for(const e of lit)if(!next.has(e))e.classList.remove('tut-hl');
  revealTargets(phase,targets,doc); // the データ tab if the targets sit in a hidden tab
  for(const e of next)if(!lit.has(e)){e.classList.add('tut-hl');if(phase!=='openLv0'&&phase!=='chooseLv'){try{e.scrollIntoView?.({block:'nearest',behavior:'smooth'})}catch{}}}
  // the first target that is on screen is scrolled into its panel once (the cards from the top, the 練習データ button centred); a target in a hidden tab waits until the tab is open
  if(phase==='openLv0'||phase==='chooseLv'){const first=targets.find(laidOut);if(first&&!scrolled.has(first)){scrolled.add(first);try{first.scrollIntoView?.({block:phase==='chooseLv'?'start':'center',behavior:'auto'})}catch{}}}
  lit=next;
  const key=introTextKey(phase,doc),t=bar.querySelector('.tut-guide-text');
  if(t.dataset.i18n!==key){t.dataset.i18n=key;t.textContent=tr(key)}
  bar.dataset.tutPhase=phase;bar.dataset.tutMode=mode;
 };
 // pressVr says both buttons (intro4) when the AR button is there, only VR (intro2) otherwise; chooseLv waits a little so the closing 「すべてクリアです」 of the last ステップ is not talked over
 const say=()=>{
  let it=phase&&TUT_INTRO[phase];if(phase==='pressVr'&&!shown(doc?.getElementById?.('ar-view-button')))it=TUT_INTRO.pressVrOnly;
  if(!it||spoken.has(it.id))return;spoken.add(it.id);
  const go=()=>{try{audio?.play([it.audio])}catch{}};
  clearTimeout(voiceTimer);
  if(phase==='chooseLv'&&levelsVoiceDelayMs>0){const my=phase;voiceTimer=setTimeout(()=>{if(phase===my)go()},levelsVoiceDelayMs)}else go();
 };
 const setPhase=p=>{const changed=p!==phase;phase=p;paint();if(changed)say()};
 function mount(){
  bar=doc.createElement('div');bar.id='tut-guide';bar.className='tut-guide';bar.setAttribute('role','status');
  const t=doc.createElement('span');t.className='tut-guide-text';
  // the bar is never shown (beginners followed it and pressed 閉じる, which ended the guidance). It stays in the DOM, hidden, as the carrier of the phase / text; the lit buttons and the voice are the guidance.
  bar.hidden=true;
  bar.append(t);doc.body.append(bar);
 }
 function run(m){if(!bar)mount();mode=m;spoken.clear();gate.reset();clearTimeout(voiceTimer);phase=null;setPhase(want());clearInterval(timer);timer=setInterval(paint,tickMs)}
 function stop(){phase=null;clearInterval(timer);clearTimeout(voiceTimer);timer=0;for(const e of lit)e.classList.remove('tut-hl');lit=new Set();bar?.remove();bar=null}
 doc?.addEventListener?.('vrl-event-sample-open',()=>{if(phase){gate.reset();setPhase(want())}});
 doc?.addEventListener?.('vrl-tut-signal',e=>{const k=e.detail?.kind;if(phase&&(k==='vr-start'||k==='ar-start'))stop()}); // a session started: the guidance of this page is over (the VR board takes over / Lv1-Lv3 do not get the tutorial)
 return{start:()=>run('lv0'),startLevels:()=>run('levels'),stop,get phase(){return phase},get mode(){return mode},get active(){return!!phase},gate};
}
export function initTutorialUi(){
 const box=document.getElementById('set-tutorial-mode'),voice=document.getElementById('set-tutorial-voice');
 if(box){box.checked=settings.get('tutorialMode')===true;box.onchange=()=>settings.set('tutorialMode',box.checked)}
 if(voice){voice.value=settings.get('tutorialVoice');voice.onchange=()=>settings.set('tutorialVoice',voice.value)}
 const rows=['tutorial-row-mode','tutorial-row-note','tutorial-row-voice'].map(i=>document.getElementById(i)).filter(Boolean);
 let vr=false;
 const showRows=on=>{for(const r of rows){r.hidden=!on;if(r.style)r.style.display=on?'':'none'}};
 const el=(tag,cls,key)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(key){e.dataset.i18n=key;e.textContent=tr(key)}return e};
 const btn=(cls,key,fn)=>{const b=el('button',cls,key);b.type='button';b.onclick=fn;return b};
 const sync=()=>{
  const on=vr&&settings.get('tutorialMode')===true;uiActive=on;if(box)box.checked=settings.get('tutorialMode')===true;if(voice)voice.value=settings.get('tutorialVoice');
 };
 window.addEventListener('vrl-settings',e=>{if(e.detail?.key==='tutorialMode'||e.detail?.key==='tutorialVoice')sync()});
 // 「チュートリアルを始める」 in the top bar, just before 「VRで見る」 (always in view, whichever panel is open; VR devices only): switches the tutorial on, continues it (the next step not done) and starts the introduction
 const intro=createTutorialIntro({audio:createTutorialAudio({getVoice:()=>settings.get('tutorialVoice')})});
 // the last ステップ (leave VR / AR) cleared = the tutorial is over: back on the page the bar guides to Lv1-Lv3 and then to VR / AR (it ends when that session starts). The signal arrives with the closing
 // 「すべてクリアです」, from the VR board (session-end) or from the 2D card (完了).
 getTutorialEngine().subscribe(snap=>{if(snap.feedback==='allClear'&&uiActive)intro.startLevels()});
 const mountCta=()=>{
  if(document.getElementById('tutorial-start-button'))return;
  const b=el('button','tut-cta','tutCta');b.id='tutorial-start-button';b.type='button';
  const begin=()=>{if(settings.get('tutorialMode')!==true)settings.set('tutorialMode',true);sync();restartTutorial();intro.start()}; // every start is from ステップ1 (nothing is remembered)
  b.onclick=()=>chooseVoice(begin); // the guide voice is chosen first (女性 / 男性); × closes without starting
  const at=document.getElementById('vr-view-button');
  if(at?.parentNode)at.parentNode.insertBefore(b,at);else document.querySelector('.topbar-actions')?.prepend(b);
 };
 window.addEventListener('vrl-settings',e=>{if(e.detail?.key==='tutorialMode'&&settings.get('tutorialMode')!==true)intro.stop()});
 // the voice choice dialog. A button says 「私が案内します」 in its own voice when the ray / pointer comes onto it (or it gets the focus); a press saves tutorialVoice and starts.
 // The credits of both voices are shown under the buttons.
 let pickDlg=null,pickVoice='F1';
 const pickAudio=createTutorialAudio({getVoice:()=>pickVoice});
 function chooseVoice(onPick){
  if(!pickDlg){
   const d=pickDlg=el('dialog','settings-dialog tut-voice-dialog');d.id='tutorial-voice-dialog';
   const head=el('div','settings-head'),title=el('strong','','tutVoiceTitle'),x=btn('secondary-button','',()=>close());x.textContent='×';x.setAttribute('aria-label','Close');x.autofocus=true; // the first focus is ×, so opening says nothing
   head.append(title,x);
   const list=el('div','sample-choices');
   for(const v of ['F1','M1']){
    const b=btn('secondary-button sample-choice tut-voice-choice','tutVoice'+v,()=>{pickAudio.stop();close();settings.set('tutorialVoice',v);d._onPick?.()});b.dataset.voice=v;
    const say=()=>{if(d._said===v)return;d._said=v;pickVoice=v;pickAudio.play([TUT_VOICE_PICK.audio])};
    b.addEventListener('pointerenter',say);b.addEventListener('focus',say);b.addEventListener('pointerleave',()=>{d._said=null});
    list.append(b);
   }
   const credit=el('div','hint tut-voice-credit');credit.append(el('div','','tutVoiceCredit'),el('div','','tutVoiceCreditF1'),el('div','','tutVoiceCreditM1'));
   d.append(head,list,credit);d.addEventListener('close',()=>pickAudio.stop());document.body.append(d);
   function close(){try{d.close()}catch{d.removeAttribute('open')}}
  }
  pickDlg._onPick=onPick;pickDlg._said=null;
  for(const e of pickDlg.querySelectorAll('[data-i18n]'))e.textContent=tr(e.dataset.i18n);
  pickDlg.showModal?pickDlg.showModal():pickDlg.setAttribute('open','');
 }
 forgetLegacyProgress();
 showRows(false);
 detectVrSupport().then(ok=>{vr=ok;showRows(ok);if(ok)mountCta();sync()});
}
