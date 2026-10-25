// チュートリアル engine. Pure: no DOM, no THREE; unit-tested (tests/unit/tutorial-engine.test.js).
// createTutorialEngine() returns one engine; the UI (carousel: step n/N, back / next) and the signal bridge (tutorial-signal.js) talk to it.
//   start(id)         begin a mission at step 1 (false when unknown / locked / unavailable)
//   onSignal({kind,count?})  a step finishes once its done.count signals of its done.signal kind have arrived (other kinds are ignored)
//   next() / prev()   manual paging; next() on the last page finishes the mission (every step has a manual way on); next() on a finished mission starts the next one (nothing starts by itself)
//   skipMission(id?)  mark a mission done without doing it (default: the current one); skipAll() all of them (experienced users)
//   refresh()         pass over the current page when its `when` condition no longer holds (no praise); the VR board calls it every frame
//   reset()           forget the (in-memory) progress and go idle
//   subscribe(fn)     fn(snapshot) after every change; returns the unsubscribe function
//   feedback: snapshot.feedback is 'stepClear' | 'missionClear' | 'allClear' | null, only in the snapshot of the transition that earned it (signal clear of a non-final step -> stepClear,
//   rotating ok1..ok3; finishing a mission by signal or by next() on the last page -> missionClear, or allClear when no required mission is left; paging, skips, reset -> null);
//   snapshot.feedbackItem = the TUT_FEEDBACK entry {id,text,audio,audioText}, feedbackSeq counts earned feedbacks (changes on each).
//   getState()        {mission (id | null), step, done:{}, count, finished, skipAll}   (step is 0-based; mission null = idle)
//   pageInfo()        {n, N, hasPrev, hasNext, isLast, finished} for "n/N" (null when idle)
//   currentStep(), listMissions(), isUnlocked(id), nextMissionId(), setEnv({arAvailable})
// Unlock: M(n) is open once every earlier mission that exists on this device is done (or skipped); skipAll opens everything. A mission that does not exist
// here (requiresAr without AR) is neither startable nor in the way of the next one. listMissions() rows carry stepNo = index + 1 (the ステップN of the lists; fixed, also while the step is unavailable).
import { TUTORIAL_MISSIONS, TUT_FEEDBACK } from './tutorial-data.js?v=20261025-build669';
// NOTHING is saved or loaded. The progress lives in memory only (this page): every page load / every 「チュートリアルを始める」 starts from ステップ1; a value an older build left in
// localStorage (vrl.tutorial.v1) is never read (tutorial-ui.js removes it once).
const emptyProgress=()=>({v:1,done:{},skipAll:false,last:null});
export function createTutorialEngine({missions=TUTORIAL_MISSIONS,arAvailable=true}={}){
 const env={arAvailable,cond:{}}; // cond: {name: () => bool} for the pages that carry `when`; a name without a function counts as true (the page shows)
 let prog=emptyProgress();
 let mission=null,step=0,count=0,finished=false,pageSet=[]; // pageSet: the pages (indices) that applied when the mission was entered: n / N are counted over it and stay fixed
 let fb=null,fbItem=null,fbSeq=0,stepClears=0; // spoken feedback of the last transition (set by signal clears / finishing, delivered with the next snapshot only)
 const subs=new Set();
 const byId=id=>missions.find(m=>m.id===id)||null;
 const available=m=>!!m&&!(m.requiresAr&&!env.arAvailable);
 const isDone=id=>prog.skipAll||prog.done[id]===true;
 function isUnlocked(id){
  const i=missions.findIndex(m=>m.id===id);if(i<0||!available(missions[i]))return false;
  if(prog.skipAll)return true;
  for(let j=0;j<i;j++)if(available(missions[j])&&!missions[j].optional&&!isDone(missions[j].id))return false;
  return true;
 }
 function snapshot(){return{mission:mission?mission.id:null,step,count,finished,skipAll:prog.skipAll,feedback:fb,feedbackItem:fbItem,feedbackSeq:fbSeq,done:{...(prog.skipAll?Object.fromEntries(missions.map(m=>[m.id,true])):prog.done)}}}
 function emit(){const s=snapshot();fb=null;fbItem=null;for(const f of [...subs]){try{f(s)}catch{}}}
 function say(kind){fb=kind;fbSeq++;fbItem=kind==='stepClear'?TUT_FEEDBACK.stepClear[stepClears++%TUT_FEEDBACK.stepClear.length]:TUT_FEEDBACK[kind]}
 const allRequiredDone=()=>missions.every(m=>!available(m)||m.optional||isDone(m.id));
 function complete(){
  prog.done[mission.id]=true;prog.last=mission.id;finished=true;count=0;
 }
 // a page with `when` is there only while its condition holds
 const applies=(m,i)=>{const w=m.steps[i]?.when;if(!w)return true;try{const f=env.cond[w];return typeof f==='function'?!!f():true}catch{return true}};
 const firstApplying=(m,from)=>{let i=from;while(i<m.steps.length-1&&!applies(m,i))i++;return i};
 function start(id){
  const m=byId(id);if(!m||!isUnlocked(id))return false;
  mission=m;step=firstApplying(m,0);count=0;finished=false;prog.last=id;pageSet=m.steps.map((_,i)=>i).filter(i=>applies(m,i)||i===step);emit();return true;
 }
 // the page on screen has a condition that no longer holds (e.g. the section frame it asks for is up now): pass over it, no praise. The UI calls this every frame (cheap).
 function refresh(){
  if(!mission||finished||applies(mission,step)||step>=mission.steps.length-1)return false;
  count=0;step=firstApplying(mission,step+1);emit();return true;
 }
 function advance(bySignal){ // the current step is done (by signal or by hand)
  if(!mission||finished)return;
  count=0;
  if(step>=mission.steps.length-1){complete();say(!mission.optional&&allRequiredDone()?'allClear':'missionClear')}
  else{step=firstApplying(mission,step+1);if(bySignal===true)say('stepClear')} // paging by hand is not praised; a page whose condition does not hold is passed over
  emit();
 }
 function onSignal(sig){
  if(!mission||finished||!sig)return false;
  const d=mission.steps[step].done;if(!d||sig.kind!==d.signal)return false;
  const c=Number(sig.count);count+=Number.isFinite(c)&&c>0?c:1;
  if(count>=(d.count||1))advance(true);else emit();
  return true;
 }
 const prevIndex=()=>{if(!mission)return -1;for(let i=step-1;i>=0;i--)if(applies(mission,i))return i;return -1};
 function prev(){if(!mission)return false;if(finished)finished=false;else{const i=prevIndex();if(i<0)return false;step=i}count=0;emit();return true}
 function skipMission(id=mission?.id){
  const m=byId(id);if(!m)return false;
  prog.done[m.id]=true;prog.last=m.id;
  if(mission&&mission.id===m.id){finished=true;count=0;step=mission.steps.length-1}
  emit();return true;
 }
 function skipAll(){prog.skipAll=true;for(const m of missions)prog.done[m.id]=true;if(mission){finished=true;count=0;step=mission.steps.length-1}emit();return true}
 function reset(){prog=emptyProgress();mission=null;step=0;count=0;finished=false;emit();return true}
 function setEnv(e={}){if('arAvailable'in e)env.arAvailable=!!e.arAvailable;if(e.cond&&typeof e.cond==='object')env.cond={...env.cond,...e.cond};if(mission&&!available(mission)){mission=null;step=0;count=0;finished=false}emit()}
 function nextMissionId(){ // the first startable mission that is not done yet (null when there is none)
  for(const m of missions)if(isUnlocked(m.id)&&!isDone(m.id)&&!m.optional)return m.id;
  for(const m of missions)if(isUnlocked(m.id)&&!isDone(m.id))return m.id;
  return null;
 }
 function listMissions(){
  return missions.map((m,i)=>({id:m.id,title:m.title,index:i,stepNo:i+1,steps:m.steps.length,optional:!!m.optional,done:isDone(m.id),current:mission?.id===m.id,
   status:!available(m)?'unavailable':isDone(m.id)?'done':isUnlocked(m.id)?'available':'locked',
   reason:m.requiresAr&&!env.arAvailable?'tutNoAr':null}));
 }
 const currentStep=()=>mission?mission.steps[step]:null;
 function pageInfo(){
  if(!mission)return null;
  // n / N: over the pages that applied when the mission was entered (a page skipped at the start is not counted; N never changes while the mission runs)
  const set=pageSet.includes(step)?pageSet:[...pageSet,step].sort((a,b)=>a-b);
  const N=set.length,n=set.filter(i=>i<=step).length;
  return{n,N,hasPrev:finished||prevIndex()>=0,hasNext:finished?!!nextMissionId():true,isLast:step===mission.steps.length-1,finished};
 }
 function subscribe(fn){subs.add(fn);return()=>subs.delete(fn)}
 // 次へ after a mission was cleared (finished) opens the next ステップ (nothing starts by itself); mid-mission it pages as before. Returns true when something moved.
 function next(){
  if(mission&&finished){const id=nextMissionId();return id?start(id):false}
  if(!mission||finished)return false;advance(false);return true;
 }
 return{start,onSignal,next,prev,refresh,skipMission,skipAll,reset,setEnv,subscribe,getState:snapshot,pageInfo,currentStep,listMissions,isUnlocked,nextMissionId,isDone,
  get lastMission(){return prog.last}};
}
