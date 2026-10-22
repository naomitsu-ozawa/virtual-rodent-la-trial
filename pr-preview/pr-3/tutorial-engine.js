// チュートリアル engine. Pure: no DOM, no THREE; unit-tested (tests/unit/tutorial-engine.test.js).
// createTutorialEngine() returns one engine; the UI (carousel: step n/N, back / next) and the signal bridge (tutorial-signal.js) talk to it.
//   start(id)         begin a mission at step 1 (false when unknown / locked / unavailable)
//   onSignal({kind,count?})  a step finishes once its done.count signals of its done.signal kind have arrived (other kinds are ignored)
//   next() / prev()   manual paging; next() on the last page finishes the mission (every step has a manual way on); next() on a finished mission starts the next one (nothing starts by itself)
//   skipMission(id?)  mark a mission done without doing it (default: the current one); skipAll() all of them (experienced users)
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
import { TUTORIAL_MISSIONS, TUT_FEEDBACK } from './tutorial-data.js?v=20261022-build642';
const emptyProgress=()=>({v:1,done:{},skipAll:false,last:null});
export function createTutorialEngine({missions=TUTORIAL_MISSIONS,arAvailable=true}={}){
 const env={arAvailable};
 let prog=emptyProgress();
 let mission=null,step=0,count=0,finished=false;
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
 function start(id){
  const m=byId(id);if(!m||!isUnlocked(id))return false;
  mission=m;step=0;count=0;finished=false;prog.last=id;emit();return true;
 }
 function advance(bySignal){ // the current step is done (by signal or by hand)
  if(!mission||finished)return;
  count=0;
  if(step>=mission.steps.length-1){complete();say(!mission.optional&&allRequiredDone()?'allClear':'missionClear')}
  else{step++;if(bySignal===true)say('stepClear')} // paging by hand is not praised
  emit();
 }
 function onSignal(sig){
  if(!mission||finished||!sig)return false;
  const d=mission.steps[step].done;if(!d||sig.kind!==d.signal)return false;
  const c=Number(sig.count);count+=Number.isFinite(c)&&c>0?c:1;
  if(count>=(d.count||1))advance(true);else emit();
  return true;
 }
 function prev(){if(!mission||step===0&&!finished)return false;if(finished)finished=false;else step--;count=0;emit();return true}
 function skipMission(id=mission?.id){
  const m=byId(id);if(!m)return false;
  prog.done[m.id]=true;prog.last=m.id;
  if(mission&&mission.id===m.id){finished=true;count=0;step=mission.steps.length-1}
  emit();return true;
 }
 function skipAll(){prog.skipAll=true;for(const m of missions)prog.done[m.id]=true;if(mission){finished=true;count=0;step=mission.steps.length-1}emit();return true}
 function reset(){prog=emptyProgress();mission=null;step=0;count=0;finished=false;emit();return true}
 function setEnv(e={}){if('arAvailable'in e)env.arAvailable=!!e.arAvailable;if(mission&&!available(mission)){mission=null;step=0;count=0;finished=false}emit()}
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
  if(!mission)return null;const N=mission.steps.length;
  return{n:step+1,N,hasPrev:step>0||finished,hasNext:finished?!!nextMissionId():true,isLast:step===N-1,finished};
 }
 function subscribe(fn){subs.add(fn);return()=>subs.delete(fn)}
 function next(){
  if(mission&&finished){const id=nextMissionId();return id?start(id):false}
  if(!mission||finished)return false;advance(false);return true;
 }
 return{start,onSignal,next,prev,skipMission,skipAll,reset,setEnv,subscribe,getState:snapshot,pageInfo,currentStep,listMissions,isUnlocked,nextMissionId,isDone,
  get lastMission(){return prog.last}};
}
