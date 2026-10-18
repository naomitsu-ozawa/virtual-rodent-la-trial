// State handling of the classification bytes behind the 3D position-comment markers' hidden judgement (build 465). Pure (no three.js, no DOM,
// the clock and timers are injectable) so it is unit-tested; vr-view.js hiddenClsFor plugs in the real keys and builders.
//  - one build at a time; a key change during a build makes that build stale (dropped when it comes back), the next one starts after the debounce
//  - debounce: a build starts only when the key has been the same for debounceMs (a slider drag does not start a build per step)
//  - the downsampled volume is kept per volumeKey (series + filter); when only segments / edits change just buildCls runs again
//  - while rebuilding, get() keeps returning the previous result (the judgement does not flicker)
//  - a failure is not cached: the build is retried after retryMs; only an error with .permanent (e.g. no source data) is cached
//  - release() drops everything (series change, markers hidden)
export const HIDDEN_CLS_DEBOUNCE_MS=250,HIDDEN_CLS_RETRY_MS=5000;
export function createHiddenClsManager({volumeKey,segKey,loadVolume,buildCls,debounceMs=HIDDEN_CLS_DEBOUNCE_MS,retryMs=HIDDEN_CLS_RETRY_MS,now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout}){
 let result=null,vol=null,building=null,pendingKey=null,pendingSince=0,failed=null,timer=0,notify=()=>{};
 const later=ms=>{clearTimer(timer);timer=setTimer(()=>{timer=0;notify()},Math.max(1,ms))};
 const start=(key,vk)=>{
  const h={key};building=h;
  (async()=>{
   try{
    let v=vol&&vol.key===vk?vol.value:null;
    if(!v){v=await loadVolume();if(building!==h)return;vol={key:vk,value:v}}
    await Promise.resolve();if(building!==h)return;
    if(segKey()!==key){building=null;notify();return} // changed meanwhile: drop it, the next get() starts a fresh one after the debounce
    const r=buildCls(v);if(building!==h)return;
    result={key,...r};building=null;failed=null;notify();
   }catch(e){
    if(building!==h)return;
    building=null;
    if(e&&e.permanent){result={key,cls:null,dims:null,halfExt:null};failed=null;notify()}
    else{failed={key,at:now()};later(retryMs)}
   }
  })();
 };
 return{
  // -> the latest result {key,cls,dims,halfExt} (possibly of an older key while a newer one is being built) or null; starts / schedules builds
  get(onReady){
   if(onReady)notify=onReady;
   const vk=volumeKey();if(!vk){return null}
   const key=segKey();
   if(result&&result.key===key)return result;
   const t=now();
   if(pendingKey!==key){pendingKey=key;pendingSince=t}
   if(building)return result;
   if(t-pendingSince<debounceMs){later(debounceMs-(t-pendingSince));return result}
   if(failed&&failed.key===key&&t-failed.at<retryMs){later(retryMs-(t-failed.at));return result}
   start(key,vk);return result;
  },
  release(){building=null;result=null;vol=null;pendingKey=null;failed=null;clearTimer(timer);timer=0},
  // for tests
  state(){return{building:!!building,hasResult:!!result,hasVolume:!!vol,failed:!!failed}},
 };
}
