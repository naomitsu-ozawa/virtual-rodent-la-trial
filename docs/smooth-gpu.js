// The constrained surface smoothing on the GPU: the chunks of a surface are smoothed by the WGSL kernels
// SMOOTH_KERNELS (gpu-shaders.js) on the compute device, in the order of smoothIterationPlan (smooth-gpu-plan.js), when a
// WebGPU device is there (Mac, iPad, PC); the worker pool (smooth-workers.js) remains the path without one and the fallback
// when a chunk does not fit the device limits or the GPU fails. The GPU computes in f32 throughout, so its result differs
// from the CPU kernel's by ~1e-5 voxel (not bit for bit): the method is part of the mesh cache route (smoothMethod), and a
// failure turns the GPU path off for the session (which changes the route, so a mixed build is not stored).
// ?smoothgpu=off keeps the smoothing on the CPU.
import { ensureGpuFilterDevice, gpuFilterPipeline, gpuFilterRuntime, gpuDispatch1D } from './gpu-compute.js?v=20261021-build638';
import { SMOOTH_KERNEL_KINDS, smoothKernelBindings } from './gpu-shaders.js?v=20261021-build638';
import { buildSmoothTopology, smoothIterationPlan, smoothParamsWords, smoothGpuBytes } from './smooth-gpu-plan.js?v=20261021-build638';
import { setSmoothGpuBackend, SMOOTH_CANCELLED } from './smooth-workers.js?v=20261021-build638';

// chunks: smoothed on the GPU; skipped: too large for the device limits (smoothed by the workers); lastError: why the GPU
// path was turned off
export const smoothGpuState={disabled:false,chunks:0,skipped:0,lastError:''};
const forcedOff=()=>typeof location!=='undefined'&&/[?&]smoothgpu=off(&|$)/.test(location.search);
// synchronous (the route key): a device is there, or none has been asked for yet
export function smoothGpuUsable(){
 if(smoothGpuState.disabled||forcedOff()||typeof navigator==='undefined'||!('gpu' in navigator)||gpuFilterRuntime.disabled)return false;
 return !!gpuFilterRuntime.device||!gpuFilterRuntime.initAttempts;
}
// iterations per command buffer: the queue gets back to the page's drawing between them
const ITERATIONS_PER_SUBMIT=6;
// a job that has not finished after this long is taken as stalled (as smooth-workers.js: 20x a CPU core's time, >= 30 s)
// overrideMs: tests
export const smoothGpuStall={overrideMs:0};
const stallLimitMs=(n,iterations)=>smoothGpuStall.overrideMs>0?smoothGpuStall.overrideMs:Math.max(30000,20*n*Math.max(1,iterations|0)*2e-4);
// push / pop of an out-of-memory and a validation scope around synchronous GPU calls only (the scopes are the device's,
// shared with the renderer: nothing else may run between push and pop)
function scoped(device,label,fn){
 device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');
 let value,thrown=null;try{value=fn()}catch(e){thrown=e}
 const v=device.popErrorScope(),o=device.popErrorScope();
 const done=Promise.all([v,o]).then(([ve,oe])=>{const e=ve||oe;if(e)throw new Error(label+': '+e.message);if(thrown)throw thrown});
 done.catch(()=>{});
 return{value,done};
}
const withTimeout=(promise,ms,what)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(what+' timed out after '+Math.round(ms)+' ms')),ms);promise.then(v=>{clearTimeout(t);resolve(v)},e=>{clearTimeout(t);reject(e)})});

// token: {cancelled} of the build (smooth-workers.js smoothInPool): read before the job and between its command buffers; a
// cancelled job returns SMOOTH_CANCELLED (not a GPU failure). Resolves to {pos, normals} (normals: the vertex normals of
// the result, one more smoothNormals pass, when asked for; else null), or null when the mesh is too large for the device.
async function smoothJob(pos,index,{iterations,lowpass,box,pinned=null,orig=pos,lambda=.5,rhoEvery=5,token=null,normals=false}){
 if(token?.cancelled)return SMOOTH_CANCELLED;
 const n=(pos.length/3)|0;if(!n||!(iterations>0)||!index.length)return null;
 const device=await ensureGpuFilterDevice();if(!device)throw new Error('no WebGPU device');
 const topology=buildSmoothTopology(index,n,pinned),bytes=smoothGpuBytes(topology),limits=device.limits;
 if(bytes.largest>limits.maxStorageBufferBindingSize||bytes.largest>(limits.maxBufferSize||Infinity)){smoothGpuState.skipped++;return null}
 const pipelines={};for(const kind of SMOOTH_KERNEL_KINDS)pipelines[kind]=await gpuFilterPipeline(kind);
 if(gpuFilterRuntime.device!==device||SMOOTH_KERNEL_KINDS.some(k=>!pipelines[k]))throw new Error('WebGPU device changed');
 const made=[],checks=[];
 try{
  const setup=scoped(device,'smoothing buffers',()=>{
   const S=GPUBufferUsage.STORAGE,D=GPUBufferUsage.COPY_DST;
   const mk=(size,usage,label)=>{const b=device.createBuffer({size:Math.max(16,Math.ceil(size/4)*4),usage,label:'VRL smooth '+label});made.push(b);return b};
   const up=(data,usage,label)=>{const b=mk(data.byteLength,usage|D,label);device.queue.writeBuffer(b,0,data);return b};
   const buf={
    P:up(new Uint8Array(smoothParamsWords(topology.params,lambda,box)),GPUBufferUsage.UNIFORM,'params'),
    topoA:up(topology.topoA,S,'topoA'),topoB:up(topology.topoB,S,'topoB'),invs:up(topology.invs,S,'invs'),
    pos:up(pos,S|GPUBufferUsage.COPY_SRC,'pos'),orig:up(orig,S,'orig'),p1:mk(n*12,S,'p1'),nrm:mk(n*12,S|GPUBufferUsage.COPY_SRC,'nrm'),
    dr:mk(n*8,S,'dr'),la:mk(n*8,S,'la'),lb:mk(n*8,S,'lb'),read:mk(n*12*(normals?2:1),GPUBufferUsage.MAP_READ|D,'readback'),
   };
   const group=(kind,swap=false)=>device.createBindGroup({label:'VRL '+kind+(swap?' swap':''),layout:pipelines[kind].getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:buf.P}},...smoothKernelBindings(kind).map(({name,binding})=>({binding,resource:{buffer:buf[swap&&name==='la'?'lb':swap&&name==='lb'?'la':name]}}))]});
   const groups=new Map();for(const kind of SMOOTH_KERNEL_KINDS)groups.set(kind,group(kind));
   groups.set('smoothLowpass*',group('smoothLowpass',true));groups.set('smoothRho*',group('smoothRho',true));
   return{buf,groups};
  });
  await setup.done;
  const {buf,groups}=setup.value,workgroups=Math.ceil(n/gpuFilterRuntime.workgroupSize);
  for(let k0=0;k0<iterations;k0+=ITERATIONS_PER_SUBMIT){
   const last=k0+ITERATIONS_PER_SUBMIT>=iterations;
   checks.push(scoped(device,'smoothing',()=>{
    const encoder=device.createCommandEncoder({label:'VRL constrained smoothing'}),pass=encoder.beginComputePass();
    for(let k=k0;k<Math.min(iterations,k0+ITERATIONS_PER_SUBMIT);k++)for(const step of smoothIterationPlan(k,lowpass,rhoEvery)){
     pass.setPipeline(pipelines[step.kind]);pass.setBindGroup(0,groups.get(step.kind+(step.swap?'*':'')));gpuDispatch1D(pass,workgroups);
    }
    if(last&&normals){pass.setPipeline(pipelines.smoothNormals);pass.setBindGroup(0,groups.get('smoothNormals'));gpuDispatch1D(pass,workgroups)}
    pass.end();
    if(last){encoder.copyBufferToBuffer(buf.pos,0,buf.read,0,n*12);if(normals)encoder.copyBufferToBuffer(buf.nrm,0,buf.read,n*12,n*12)}
    device.queue.submit([encoder.finish()]);
   }).done);
   // the page's frames and the other GPU work get their turn between the command buffers
   if(!last){await device.queue.onSubmittedWorkDone();if(token?.cancelled){await Promise.all(checks);return SMOOTH_CANCELLED}}
  }
  await Promise.all(checks);
  await withTimeout(buf.read.mapAsync(GPUMapMode.READ),stallLimitMs(n,iterations),'GPU smoothing');
  // one mapped range (an offset into a mapping must be a multiple of 8 bytes, n * 12 is not when n is odd)
  const mapped=buf.read.getMappedRange(0,n*12*(normals?2:1)),out=new Float32Array(mapped.slice(0,n*12)),nrm=normals?new Float32Array(mapped.slice(n*12,n*24)):null;buf.read.unmap();
  smoothGpuState.chunks++;
  return{pos:out,normals:nrm};
 }finally{for(const b of made)try{b.destroy()}catch{}}
}
// one job on the GPU at a time (its buffers are the mesh x ~160 bytes per vertex); a failed job turns the GPU path off
let queue=Promise.resolve();
export function smoothOnGpu(pos,index,opts){
 // the whole job under the stall limit (device, pipelines, submits and readback): a GPU that stops answering anywhere is a
 // failure, and the workers take this chunk and the next ones
 const job=queue.then(()=>withTimeout(smoothJob(pos,index,opts),stallLimitMs((pos.length/3)|0,opts?.iterations),'GPU smoothing job')).catch(e=>{
  smoothGpuState.disabled=true;smoothGpuState.lastError=String(e?.message||e);
  console.warn('GPU surface smoothing failed; the workers smooth from here on.',e);
  throw e;
 });
 queue=job.catch(()=>{});
 return job;
}
setSmoothGpuBackend({usable:smoothGpuUsable,run:smoothOnGpu});
