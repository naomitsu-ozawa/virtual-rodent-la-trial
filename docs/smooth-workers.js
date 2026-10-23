// Web Workers for the constrained surface smoothing. The kernel (constrained-smooth.js) takes ~16 us per vertex
// at strength 4, so a full-resolution surface of a few million vertices is a minute on one thread; the chunks of a
// surface are smoothed side by side in a small pool of workers while the main thread keeps extracting faces. The workers
// run the very same function from its source text, so a chunk comes out bit for bit as on the main thread (where it runs
// when workers are unavailable: no Worker, a blocked blob: URL, or a worker that failed or stalled). With a WebGPU device the
// chunks go to the GPU first (smooth-gpu.js registers itself here with setSmoothGpuBackend); the pool is then only the
// fallback for the kernel; the workers still prepare the chunks for it (snap, weld) and are started for that.
// A chunk's preparation and normals (smooth-prepare.js) run in the worker with its kernel: the main thread only cuts the core.
import { constrainedSmoothPositions } from './constrained-smooth.js?v=20261022-build656';
import { snapToLattice, weldTrianglePositions, vertexNormals, prepareSmoothChunk } from './smooth-prepare.js?v=20261022-build656';

// one job, in a worker or on the main thread: either a chunk's faces (prepared here: snap, weld, pinned flags) or welded
// positions; then the kernel (iterations > 0) and the vertex normals (normals). null: no triangle. (exported: tests)
export function runSmoothMessage(m){
 const r=m.faces?prepareSmoothChunk(m.faces,m.lattice,m.pinnedKeys):{pos:m.pos,index:m.index,orig:m.orig,pinned:m.pinned};
 if(!r)return null;
 if(m.iterations>0)constrainedSmoothPositions(r.pos,r.index,{iterations:m.iterations,lowpass:m.lowpass,box:m.box,pinned:r.pinned,orig:r.orig});
 r.normals=m.normals?vertexNormals(r.pos,r.index):null;
 return r;
}
function smoothWorkerMain(){
 self.onmessage=e=>{
  const m=e.data;
  try{
   const r=runSmoothMessage(m);if(!r){self.postMessage({id:m.id,empty:true});return}
   // a chunk prepared here sends back all it made; welded positions only pos (the main thread kept the rest)
   const out=m.faces?{id:m.id,pos:r.pos,index:r.index,orig:r.orig,pinned:r.pinned,normals:r.normals}:{id:m.id,pos:r.pos,normals:r.normals};
   self.postMessage(out,[out.pos,out.index,out.orig,out.pinned,out.normals].filter(Boolean).map(a=>a.buffer));
  }
  catch(err){self.postMessage({id:m.id,error:String(err&&err.message||err)})}
 };
}
const pool={slots:null,queue:[],nextId:1,disabled:false,source:''};
// what the GPU path (smooth-gpu.js) returns for a job whose build was cancelled before it ran (null: too large for the GPU)
export const SMOOTH_CANCELLED=Object.freeze({cancelled:true});
// workers in the pool: two cores stay with the page and the GPU process (with one, a 4-core machine stalled the page's
// drawing for seconds), at most 4 on a desktop and 2 on an iPad / iPhone (memory: every chunk in flight holds its own
// copy of the mesh and the kernel's buffers)
export function smoothWorkerCount(){
 const cores=Math.max(1,(typeof navigator!=='undefined'&&navigator.hardwareConcurrency)||2),touch=typeof navigator!=='undefined'&&navigator.maxTouchPoints>0;
 return Math.max(1,Math.min(touch?2:4,cores-2));
}
// chunks a build keeps in flight (OrderedChunkSmoother.throttle): one per worker and one being prepared. Asking does not
// start the pool (a build without chunks never creates workers).
export function smoothInFlightLimit(){return smoothMethod()==='gpu'?2:smoothWorkerCount()+1}
// the GPU path (smooth-gpu.js): {usable() -> bool (synchronous), run(pos, index, opts) -> Promise<Float32Array | null>}
// (null: this chunk is for the workers; a rejection: the GPU failed, and is off from then on)
let gpuBackend=null;
export function setSmoothGpuBackend(backend){gpuBackend=backend}
// where the chunks are smoothed now: 'gpu' or 'cpu' (part of the mesh cache route: the two differ by ~1e-5 voxel)
export function smoothMethod(){return gpuBackend?.usable?.()?'gpu':'cpu'}
// floats of faces (chunk with its halo slices) in flight: a chunk being smoothed holds ~12 bytes per float (welded mesh, its
// copies in the worker and the kernel's arrays), over all segments and builds (smooth-chunks.js throttleSmoothing).
// Desktop: 72M floats, ~0.9 GB; iPad / iPhone: 16M floats, ~190 MB (two average chunks with their halos; a larger chunk
// still goes, alone).
export function smoothInFlightFloats(){return(typeof navigator!=='undefined'&&navigator.maxTouchPoints>0?16:72)*1024*1024}
// a worker that has not answered after this long is taken as stalled: it is replaced and its chunk is smoothed on the main
// thread. 20x the expected time (~0.2 us per vertex and iteration on one core), at least 30 s, so a slow device under load
// is not cut off. overrideMs: tests.
export const smoothStall={overrideMs:0};
// (faces: a corner is shared by ~6 triangles, so the faces of n vertices are ~18 n floats; counted as 9 n, generously)
function stallLimitMs(m){const n=m.faces?m.faces.length/9:m.pos.length/3;return smoothStall.overrideMs>0?smoothStall.overrideMs:Math.max(30000,20*n*Math.max(1,m.iterations|0)*2e-4)}
function dropSlot(slot){
 clearTimeout(slot.timer);slot.timer=0;try{slot.worker.terminate()}catch{}
 pool.slots=pool.slots.filter(s=>s!==slot);if(!pool.slots.length)pool.disabled=true;
}
function addSlot(){
 const url=URL.createObjectURL(new Blob([pool.source],{type:'text/javascript'}));
 try{
  const worker=new Worker(url),slot={worker,task:null,timer:0};
  worker.onmessage=e=>{const task=slot.task;slot.task=null;clearTimeout(slot.timer);slot.timer=0;if(task)task.done(e.data);pump()};
  worker.onerror=e=>{e.preventDefault?.();const task=slot.task;slot.task=null;dropSlot(slot);if(task)task.fail(new Error(e.message||'smoothing worker failed'));pump()};
  pool.slots.push(slot);return slot;
 }finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
function ensurePool(){
 if(pool.slots||pool.disabled)return pool.slots;
 if(typeof Worker==='undefined'||typeof Blob==='undefined'||typeof URL==='undefined'||!URL.createObjectURL){pool.disabled=true;return null}
 try{
  pool.source=[constrainedSmoothPositions,snapToLattice,weldTrianglePositions,vertexNormals,prepareSmoothChunk,runSmoothMessage].map(f=>'const '+f.name+'='+f.toString()+';\n').join('')+'('+smoothWorkerMain.toString()+')();';
  pool.slots=[];
  for(let i=0;i<smoothWorkerCount();i++)addSlot();
 }catch(e){console.warn('Smoothing workers unavailable; smoothing on the main thread.',e);pool.slots=null;pool.disabled=true}
 return pool.slots;
}
// a stalled worker: terminated and replaced by a new one (the pool keeps its size), its chunk goes to the main thread
function onStall(slot){
 const task=slot.task;slot.task=null;slot.timer=0;
 dropSlot(slot);pool.disabled=false;
 try{addSlot()}catch(e){console.warn('Smoothing worker could not be replaced.',e);if(!pool.slots.length)pool.disabled=true}
 if(task)task.fail(new Error('smoothing worker stalled'));
 pump();
}
// the next queued task whose build is still wanted; the others settle as cancelled without running
function nextTask(){
 for(;;){const task=pool.queue.shift();if(!task||!task.token?.cancelled)return task;task.cancel()}
}
function pump(){
 if(!pool.slots)return;
 for(const slot of pool.slots){
  if(slot.task)continue;const task=nextTask();if(!task)break;
  // only pos moves to the worker (and back); index, orig and pinned are copied, so the main thread keeps all it needs to
  // smooth the chunk itself if the worker fails, dies or stalls (pos starts on orig). A chunk's faces are copied too (the
  // main thread keeps them until the worker answers, for the same reason).
  slot.task=task;const m=task.message;
  slot.timer=setTimeout(()=>onStall(slot),stallLimitMs(m));
  slot.worker.postMessage(m,m.faces?[]:[m.pos.buffer]);
 }
 // every worker gone: the queued chunks run on the main thread
 if(pool.disabled)while(pool.queue.length)pool.queue.shift().fail(new Error('no smoothing workers'));
}
// smooths pos (welded positions, starting on the lattice positions orig) on the GPU, in place or in a worker; resolves to
// {pos, index, orig, pinned, normals}: the arrays passed in, except pos from the GPU or a worker (one passed to a worker
// is detached), and the vertex normals of the result when asked for (normals: true; else null). A chunk whose worker
// fails, dies or stalls is smoothed on the main thread, from orig again.
// token: {cancelled} (read when the job would start): a job of a cancelled build does not run and resolves to null.
export function smoothInPool(pos,index,{iterations,lowpass,box,pinned=null,orig=new Float32Array(pos),token=null,normals=false}){
 const opts={iterations,lowpass,box,pinned,orig,token,normals};
 if(token?.cancelled)return Promise.resolve(null);
 // the GPU leaves pos as it is (its upload is a copy), so a chunk it cannot take goes on to the workers unchanged
 if(box&&smoothMethod()==='gpu')return gpuBackend.run(pos,index,opts).then(out=>out===SMOOTH_CANCELLED?null:out?{pos:out.pos,index,orig,pinned,normals:out.normals||null}:smoothInWorkers(pos,index,opts),()=>smoothInWorkers(pos,index,opts));
 return smoothInWorkers(pos,index,opts);
}
// a chunk's voxel-face triangles (faces; the caller does not use them afterwards) -> {pos, index, orig, pinned, normals}
// smoothed, or null (no triangle, or a cancelled build). lattice: {xs, ys, zs} to snap to (smooth-chunks.js), pinnedKeys:
// array of 'x,y,z' keys of the vertices that stay. On the CPU one worker job prepares, smooths and makes the normals;
// with the GPU a worker prepares, the GPU smooths and makes the normals.
export function smoothChunkInPool(faces,{lattice=null,pinnedKeys=null,iterations,lowpass,box,token=null}){
 if(token?.cancelled)return Promise.resolve(null);
 // a view into a larger buffer (Float32FaceBuilder.take) would keep that buffer while the chunk is in flight, and a
 // structured clone copies the whole buffer
 if(faces.byteOffset||faces.byteLength!==faces.buffer.byteLength)faces=faces.slice();
 const gpu=!!box&&iterations>0&&smoothMethod()==='gpu';
 const prepared=inWorkers({id:0,faces,lattice,pinnedKeys,iterations:gpu?0:iterations,lowpass,box,normals:!gpu},token);
 if(!gpu)return prepared;
 return prepared.then(r=>r&&smoothInPool(r.pos,r.index,{iterations,lowpass,box,pinned:r.pinned,orig:r.orig,token,normals:true}));
}
function smoothInWorkers(pos,index,{iterations,lowpass,box,pinned,orig,token,normals=false}){
 return inWorkers({id:0,pos,index,orig,pinned,iterations,lowpass,box,normals},token);
}
const fromWorker=(m,d)=>m.faces?{pos:d.pos,index:d.index,orig:d.orig,pinned:d.pinned,normals:d.normals||null}:{pos:d.pos,index:m.index,orig:m.orig,pinned:m.pinned,normals:d.normals||null};
function inWorkers(message,token){
 if(token?.cancelled)return Promise.resolve(null);
 if(!ensurePool())return Promise.resolve(runSmoothMessage(message));
 message.id=pool.nextId++;
 return new Promise((resolve,reject)=>{
  // the main thread's copy: the faces as they were sent, or pos from orig again
  const onMain=why=>{if(token?.cancelled){resolve(null);return}console.warn('Smoothing worker failed; smoothing the chunk on the main thread.',why);try{resolve(runSmoothMessage(message.faces?message:{...message,pos:new Float32Array(message.orig)}))}catch(e){reject(e)}};
  pool.queue.push({message,token,done:d=>{if(d.error)onMain(d.error);else resolve(d.empty?null:fromWorker(message,d))},fail:onMain,cancel:()=>resolve(null)});
  pump();
 });
}
export function smoothPoolSize(){return ensurePool()?.length||0}
