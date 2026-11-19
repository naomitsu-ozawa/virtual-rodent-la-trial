// "Latest only, one at a time": request() may be called on every slider step;
// the task never runs concurrently, and after each run it runs once more only
// if new requests arrived meanwhile (intermediate requests are dropped). Used
// for per-slice filtered MPR planes so 2D and the 3D planes keep following the
// slider in real time without piling up GPU filter work.
export function latestOnlyRunner(task,onError=e=>console.warn(e)){
 let running=false,dirty=false;
 const request=()=>{
  dirty=true;if(running)return;running=true;
  (async()=>{
   try{while(dirty){dirty=false;try{await task()}catch(e){onError(e)}}}
   finally{running=false}
  })();
 };
 request.isRunning=()=>running;
 return request;
}
