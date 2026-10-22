// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { installGpuLedger } from './mem-ledger.js?v=20261022-build651';
import { gpuSplitCandidate, gpuSplitDecision, gpuVendorKey, gpuAdapterVendorKey, gpuSplitStatusParts, gpuHybridStatusText, gpuStatusDetailed, webglDisplayGpu } from './gpu-split.js?v=20261022-build651';
import { gpuPlatformOs, gpuEffectivePreference, gpuPreferenceSupported, gpuAdapterRequestOptions, gpuPreferenceInfoText, gpuEffectiveHybridMode } from './gpu-preference.js?v=20261022-build651';
import { setGpuPrewarmIndex, setGpuPrewarmScheduled, sceneState } from './state.js?v=20261022-build651';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { normalizeVrlWgsl, gpuFilterShader, GPU_PREWARM_KINDS, gaussianPassKernel, AIRDIST_X_MAX_N } from './gpu-shaders.js?v=20261022-build651';
import { spacingParams, spacingRatios, bilateralRadii, nlmRadii, unsharpAxes } from './filter-units.js?v=20261022-build651';
import { isDesktopRuntime, frameYield } from './utils.js?v=20261022-build651';
import { runsSliceToMask } from './run-length.js?v=20261022-build651';
import { status } from './ui-shell.js?v=20261022-build651';
import { updateLinuxWebgpuNote } from './linux-webgpu-note.js?v=20261022-build651';
import { logGpuError } from './gpu-diagnostics.js?v=20261022-build651';
export const gpuFilterRuntime={device:null,adapter:null,initPromise:null,disabled:false,pipelines:new Map(),warned:false,lastBackend:'CPU',lastError:'',adapterLabel:'',retryAfter:0,initAttempts:0,bufferPool:new Map(),bufferPoolBytes:0,sharedRendererDevice:false,workgroupSize:128,lastShaderKind:'',split:null,renderDevice:null,renderError:'',renderInfo:'',pendingCompute:null};
export function gpuAdapterLabel(adapter){
 try{
  const info=adapter?.info;if(!info)return'';
  return [...new Set([info.vendor,info.architecture,info.device,info.description].filter(Boolean).map(v=>String(v).trim()).filter(Boolean))].join(' ');
 }catch{return''}
}
// device.lost reason ('destroyed' / 'unknown') and the browser's message, for the status bar
export function gpuLostText(info){return 'WebGPU device lost'+(info?.reason?' ('+info.reason+')':'')+(info?.message?': '+info.message:'')}
export function gpuDeviceMode(device){return device?.features?.has?.('core-features-and-limits')?'CORE':'COMPAT'}
export function gpuComputeWorkgroupSize(device=gpuFilterRuntime.device){
 const a=Number(device?.limits?.maxComputeInvocationsPerWorkgroup)||128,b=Number(device?.limits?.maxComputeWorkgroupSizeX)||a;
 const cap=Math.max(1,Math.min(256,a,b));return cap>=256?256:cap>=128?128:cap>=64?64:Math.max(1,cap);
}
export const gpuForceCompat=(()=>{try{return /[?&]gpucompat\b/.test(globalThis.location?.search||'')||globalThis.localStorage?.getItem('vrl.gpucompat')==='1'}catch{return false}})();
export const GPU_BUFFER_LIMIT_CAPS=[4*1024**3,2*1024**3,1024**3,0];
export function capGpuBufferLimits(limits,cap){
 if(!(cap>0)){delete limits.maxBufferSize;delete limits.maxStorageBufferBindingSize;return limits}
 // binding cap: Dawn's tier value (cap - 4: 4 GiB - 4 / 2 GiB - 4), a multiple of 4, fits a u32 and is <= the buffer cap
 const bindingCap=cap>=2*1024**3?cap-4:cap;
 if(limits.maxBufferSize>cap)limits.maxBufferSize=cap;
 if(limits.maxStorageBufferBindingSize>bindingCap)limits.maxStorageBufferBindingSize=bindingCap;
 return limits;
}
// one status-bar line: buffer limits asked for / the adapter's, and the retries it took
export function gpuLimitInfoText(adapter,descriptor,retries=[]){
 const mb=v=>v>0?Math.round(v/2**20)+'MB':'default',l=descriptor?.requiredLimits||{},a=adapter?.limits||{};
 return 'limits buf '+mb(l.maxBufferSize)+'/bind '+mb(l.maxStorageBufferBindingSize)+' (adapter '+mb(a.maxBufferSize)+'/'+mb(a.maxStorageBufferBindingSize)+')'+(retries.length?' · retry '+retries.join(' → '):'');
}
export function gpuDeviceRequestDescriptor(adapter,cap=GPU_BUFFER_LIMIT_CAPS[0]){
 const requiredFeatures=[];if(!gpuForceCompat&&adapter?.features?.has?.('core-features-and-limits'))requiredFeatures.push('core-features-and-limits');
 if(adapter?.features?.has?.('clip-distances'))requiredFeatures.push('clip-distances');
 if(!requiredFeatures.includes('core-features-and-limits')){const all={};for(const k in adapter?.limits||{}){const v=adapter.limits[k];if(typeof v==='number'&&Number.isFinite(v))all[k]=v}return{requiredFeatures,requiredLimits:capGpuBufferLimits(all,cap)}}
 const requiredLimits={};
 if((adapter?.limits?.maxComputeInvocationsPerWorkgroup||0)>=256)requiredLimits.maxComputeInvocationsPerWorkgroup=256;
 if((adapter?.limits?.maxComputeWorkgroupSizeX||0)>=256)requiredLimits.maxComputeWorkgroupSizeX=256;
 const maxBufferSize=Number(adapter?.limits?.maxBufferSize)||0;if(maxBufferSize>0)requiredLimits.maxBufferSize=maxBufferSize;
 const maxStorageBufferBindingSize=Number(adapter?.limits?.maxStorageBufferBindingSize)||0;if(maxStorageBufferBindingSize>0)requiredLimits.maxStorageBufferBindingSize=maxStorageBufferBindingSize;
 return{requiredFeatures,requiredLimits:capGpuBufferLimits(requiredLimits,cap)};
}
// the setting 「使う GPU」 (settings > 描画; 'auto' / 'high-performance' / 'low-power'). It is honoured only on
// Linux / Windows; on Mac, iPad and everything else this is 'auto', the request the app always made. Read once per device
// request, so every buffer-limit retry (below) asks for the same GPU.
export const vrlGpuPreference=()=>gpuEffectivePreference(globalThis.__vrlSettings?.get?.('gpuPreference'),navigator);
// the requestAdapter option sets, in order: 'auto' = {high-performance, core}, {high-performance}, (none), then the
// compatibility adapters of (a Linux OpenGL ES backend rather than none); see gpu-preference.js
export async function requestVrlGpuAdapter(preference=vrlGpuPreference(),role='compute'){
 let adapter=null;
 const opts=gpuAdapterRequestOptions(gpuForceCompat,preference);
 const request={stored:String(globalThis.__vrlSettings?.get?.('gpuPreference')??'auto'),effective:preference,supported:gpuPreferenceSupported(navigator),option:undefined,optionIndex:-1};
 for(let i=0;i<opts.length&&!adapter;i++){
  try{adapter=await(opts[i]?navigator.gpu.requestAdapter(opts[i]):navigator.gpu.requestAdapter())}catch{}
  if(adapter){request.option=opts[i];request.optionIndex=i}
 }
 // the extra render-device request of the split mode must not overwrite the compute device's record
 // role 'probe' = the debug-mode GPU info tab asking once when the app never did; it keeps its own record
 gpuFilterRuntime[role==='render'?'renderAdapterRequest':role==='probe'?'probeAdapterRequest':'adapterRequest']=request;
 return adapter;
}
// resolves with the device.lost info when the device was lost within the creation window, else null. One round trip to the
// GPU process first (a loss reported at creation arrives before it), then a short settle for the promise itself.
export async function gpuLostAtCreation(device,settleMs=20,workMs=500){
 if(!device?.lost)return null;
 // the round trip is bounded (500 ms): a driver that never answers must not stall the start-up of any platform
 let wait=0;
 try{await Promise.race([device.queue?.onSubmittedWorkDone?.(),new Promise(r=>{wait=setTimeout(r,workMs)})])}catch{}
 clearTimeout(wait);
 let timer=0;
 const info=await Promise.race([device.lost.then(i=>i||{},()=>null),new Promise(r=>{timer=setTimeout(()=>r(null),settleMs)})]);
 clearTimeout(timer);
 return info;
}
export async function requestVrlGpuDevice({preference:wanted,role='compute',accept=null}={}){
 // a refused request is retried with the next lower buffer-limit cap; an adapter serves
 // one request only, so each attempt asks for it again (same adapter order as before)
 const retries=[];let lastError=null;
 // the chosen GPU is resolved once and every attempt below asks for it
 const preference=wanted||vrlGpuPreference(),render=role==='render',infoKey=render?'renderPrefInfo':'prefInfo',limitKey=render?'renderLimitInfo':'limitInfo',retryKey=render?'renderLimitRetries':'limitRetries';
 // a rung whose request would be identical to the one that just failed (the adapter's limits are already at or
 // below this cap) is skipped, so a refusing driver is not asked the same thing again
 let lastAdapter=null,lastKey='';
 const descriptorKey=d=>JSON.stringify([d.requiredFeatures,d.requiredLimits]);
 for(const cap of GPU_BUFFER_LIMIT_CAPS){
  if(lastAdapter&&descriptorKey(gpuDeviceRequestDescriptor(lastAdapter,cap))===lastKey)continue;
  const adapter=await requestVrlGpuAdapter(preference,role);
  gpuFilterRuntime[infoKey]=gpuPreferenceInfoText(gpuFilterRuntime[render?'renderAdapterRequest':'adapterRequest'],adapter);
  if(!adapter)throw lastError||new Error('WebGPU adapter unavailable (core and compatibility)');
  // the split render device only wants the display (Intel) adapter; any other adapter ends the request (no retry)
  if(accept&&!accept(adapter))throw Object.assign(new Error('adapter not accepted: '+(gpuAdapterLabel(adapter)||'unknown')),{adapterRejected:true});
  const descriptor=gpuDeviceRequestDescriptor(adapter,cap),capText=cap>0?Math.round(cap/2**20)+'MB':'default';
  lastAdapter=adapter;lastKey=descriptorKey(descriptor);
  try{
   const device=await adapter.requestDevice(descriptor);
   // a device that is already lost at / right after creation (Chrome resolves requestDevice with a device
   // whose lost promise settles at once, e.g. "Device failed at creation" / VK_ERROR_OUT_OF_DEVICE_MEMORY) counts as a
   // failed request too: destroy it and take the next cap. Only this window is checked; later failures (the GPU
   // self-verification, device loss during use) never lower the cap.
   const lostAtCreation=await gpuLostAtCreation(device);
   if(lostAtCreation){try{device.destroy?.()}catch{};throw new Error('device lost at creation'+(lostAtCreation.reason?' ('+lostAtCreation.reason+')':'')+(lostAtCreation.message?': '+lostAtCreation.message:''))}
   gpuFilterRuntime[limitKey]=gpuLimitInfoText(adapter,descriptor,retries);gpuFilterRuntime[retryKey]=retries.length;console.info('VRL WebGPU '+(render?'render ':'')+'device: '+gpuFilterRuntime[limitKey]);
   // records for the debug-mode GPU info tab (data only): the retries as a list and the cap that finally worked
   gpuFilterRuntime[limitKey+'Log']=retries.slice();gpuFilterRuntime[limitKey+'CapUsed']=capText;
   return{adapter,device};
  }catch(e){
   lastError=e;retries.push(capText+' failed: '+String(e?.message||e).slice(0,140));logGpuError('requestDevice (cap '+capText+(render?', render':'')+')',e);
   console.warn('WebGPU device request failed (rejected or lost at creation) with buffer-limit cap '+capText+'; retrying lower.',e);
  }
 }
 gpuFilterRuntime[limitKey]='device request failed · retry '+retries.join(' → ');gpuFilterRuntime[retryKey]=retries.length;gpuFilterRuntime[limitKey+'Log']=retries.slice();gpuFilterRuntime[limitKey+'CapUsed']='';
 throw lastError;
}
export function updateGpuStatus(){
 if(!status)return;
 const rt=gpuFilterRuntime,render=sceneState?.backend||'INIT';
 const compute=rt.lastBackend||(rt.device?'WEBGPU READY':'CPU');
 const adapter=rt.adapterLabel?(' · '+rt.adapterLabel):'';
 // the extra diagnostics (160-character error, limits, GPU preference, hybrid / split notes) appear only when
 // something out of the ordinary happened (retry, detected hybrid, explicit GPU preference, debug); otherwise the text is
 // exactly the one of builds up to 515 (Mac, iPad, single-GPU machines)
 const detailed=gpuStatusDetailed(rt,!!globalThis.__vrlSettings?.debugOn?.());
 const errText=rt.lastError||'',showErr=/FAIL|ERROR|LOST/.test(compute)&&!!errText,cutAt=detailed?160:96;
 const failure=showErr?(' · '+errText.slice(0,cutAt)+(detailed&&errText.length>cutAt?'…':'')):'';
 // GPU split (display Intel / compute NVIDIA): "Render WEBGPU intel (display) · Compute WEBGPU … nvidia (split)";
 // a volume label in split mode reads "Volume WEBGPU RESIDENT intel (display)"; '' parts otherwise
 const sp=gpuSplitStatusParts(rt.split,compute,rt.hybridMode==='primary'?rt.hybridVendor:''),renderFail=rt.renderError?(' · Render error: '+rt.renderError):'';
 const line=failureText=>'Render '+render+sp.render+' · '+sp.computeName+' '+sp.computeLabel+sp.compute+failureText+renderFail+adapter;
 status.removeAttribute('data-i18n');
 status.textContent=line(failure);
 const computeGpu=compute.startsWith('WEBGPU'),gpuActive=render==='WEBGPU'||computeGpu;
 status.className=gpuActive?'status status-ok':'status status-warning';
 status.title=errText+(rt.renderError?(errText?'\n':'')+'Render: '+rt.renderError:'');
 // the top chip is truncated; the bar under the views shows the full text
 const bar=document.getElementById('gpu-status-bar'),barText=document.getElementById('gpu-status-text');
 if(bar&&barText){
  let text=detailed&&showErr&&errText.length>cutAt?line(' · '+errText):status.textContent;
  if(errText&&!showErr)text+=' · '+errText;
  if(detailed){
   const note=rt.splitNote&&!rt.split&&(rt.hybridSeen||globalThis.__vrlSettings?.debugOn?.())?' · GPU split: '+rt.splitNote:'';
   text+=(rt.prefInfo?' · '+rt.prefInfo:'')+(rt.limitInfo?' · '+rt.limitInfo:'')+(gpuHybridStatusText(rt)?' · '+gpuHybridStatusText(rt):'')+(rt.split&&rt.renderInfo?' · render device: '+(rt.renderAdapterLabel?rt.renderAdapterLabel+' · ':'')+rt.renderInfo:'')+note;
  }
  barText.textContent=text;bar.classList.toggle('is-warning',!gpuActive);
 }
 updateLinuxWebgpuNote();
}
export function setGpuComputeBackend(label,error=''){
 // an uncaptured WebGPU error leaves 'WEBGPU GPU FAIL' standing: a later success
 // label ('WEBGPU COMPUTE' ...) must not erase it or its lastError. A new device
 // check ('WEBGPU CHECKING') or any non-WEBGPU (CPU...) label ends it.
 if(!error&&gpuFilterRuntime.lastBackend==='WEBGPU GPU FAIL'&&label.startsWith('WEBGPU')&&label!=='WEBGPU CHECKING'){updateGpuStatus();return}
 gpuFilterRuntime.lastBackend=label;
 if(error){gpuFilterRuntime.lastError=String(error);logGpuError('compute · '+label,error)}
 else if(label.startsWith('WEBGPU'))gpuFilterRuntime.lastError='';
 updateGpuStatus();
}
export function installGpuErrorListener(device,role='compute'){
 installGpuLedger(device);
 if(!device||device.__vrlErrorListenerInstalled)return;
 try{
  device.__vrlErrorListenerInstalled=true;
  const create=device.createTexture?.bind(device);
  if(create)device.createTexture=desc=>{
   const s=desc?.size,dims=Array.isArray(s)?s:[s?.width,s?.height??1,s?.depthOrArrayLayers??1];
   if(dims.some(n=>!n)){const at=(new Error().stack||'').split('\n').slice(2,5).map(l=>l.trim().replace(/^at /,'').replace(/https?:[^ )]*\//g,'').replace(/\?v=[^:]*/,'')).join(' < ');gpuFilterRuntime.zeroTexture=(desc?.label||'unlabelled')+' '+dims.join('x')+' @ '+at;console.warn('zero-size texture',desc,at)}
   return create(desc);
  };
  device.addEventListener?.('uncapturederror',event=>{
   // an error on the split render device (presenting, three.js, the volume renderer) is a render error, never a compute FAIL
   if(role==='render'){gpuFilterRuntime.renderError='uncaptured: '+String(event?.error?.message||event?.message||'uncaptured WebGPU error');logGpuError('render device · uncaptured error',gpuFilterRuntime.renderError);console.error('Virtual Rodent Lab WebGPU render-device error:',event?.error||event);updateGpuStatus();return}
   const message=String(event?.error?.message||event?.message||'uncaptured WebGPU error'),kind=gpuFilterRuntime.lastShaderKind?(' ['+gpuFilterRuntime.lastShaderKind+']'):'';
   gpuFilterRuntime.lastError='uncaptured'+kind+': '+message+(/zero/i.test(message)&&gpuFilterRuntime.zeroTexture?' ['+gpuFilterRuntime.zeroTexture+']':'');
   setGpuComputeBackend('WEBGPU GPU FAIL',gpuFilterRuntime.lastError);
   console.error('Virtual Rodent Lab WebGPU error:',event?.error||event);
  });
 }catch{}
}
export async function gpuValidationScope(device,label,fn){
 if(!device?.pushErrorScope||!device?.popErrorScope)return fn();
 let popped=false;device.pushErrorScope('validation');
 try{
  const result=await fn(),validation=await device.popErrorScope();popped=true;
  if(validation)throw new Error(label+': '+validation.message);
  return result;
 }catch(e){
  if(!popped){
   try{const validation=await device.popErrorScope();popped=true;if(validation&&!String(e?.message||e).includes(validation.message))throw new Error(label+': '+validation.message+' | '+String(e?.message||e))}catch(scopeError){if(scopeError!==e)throw scopeError}
  }
  throw e;
 }
}
// Synchronous validation check: push -> fn() -> pop with no await in between, so
// only this call's own commands can land in the scope (unlike gpuValidationScope,
// which awaits fn() and can pick up errors of concurrent work). fn must be synchronous.
// gpuCheckBegin returns {value, done} at once: `done` settles when the pop result is in
// (rejects with label+message on a validation error), so a hot loop can collect the
// promises and await them together before its submit. gpuCheckSync awaits it directly.
export function gpuCheckBegin(device,label,fn){
 if(!device?.pushErrorScope||!device?.popErrorScope)return{value:fn(),done:Promise.resolve()};
 let value,thrown=null,failed=false;
 device.pushErrorScope('validation');
 try{value=fn()}catch(e){failed=true;thrown=e}
 const done=device.popErrorScope().then(validation=>{
  if(validation)throw new Error(label+': '+validation.message+(failed?' | '+String(thrown?.message||thrown):''));
  if(failed)throw thrown;
 });
 done.catch(()=>{}); // never an unhandled rejection if the caller throws before awaiting it
 return{value,done};
}
export async function gpuCheckSync(device,label,fn){
 const r=gpuCheckBegin(device,label,fn);await r.done;return r.value;
}
// finish + submit of one encoder inside a synchronous validation check; `checks` are the
// pending gpuCheckBegin results of the commands recorded so far (awaited first, in one go)
export async function gpuSubmitChecked(device,label,encoder,checks=[]){
 if(checks.length)await Promise.all(checks.splice(0));
 return gpuCheckSync(device,label,()=>device.queue.submit([encoder.finish()]));
}
export const GPU_FILTER_KEYS=new Set(['gaussian','sigmoid','spikeHole','unsharp','anisotropic','tv','bilateral','nlm']);
export function gpuStagesSupported(stages){
 return stages.every(stage=>GPU_FILTER_KEYS.has(stage.key));
}
export function gpuPoolLimit(){return navigator.maxTouchPoints>0?64*1024*1024:(isDesktopRuntime()?256:192)*1024*1024}
export function gpuBufferBucketSize(bytes){
 let size=4096;while(size<bytes)size*=2;return size;
}
export function acquireGpuWorkBuffer(device,bytes){
 const size=gpuBufferBucketSize(bytes),bucket=gpuFilterRuntime.bufferPool.get(size);
 if(bucket?.length){const buffer=bucket.pop();gpuFilterRuntime.bufferPoolBytes-=size;return{buffer,size}}
 return{buffer:device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),size};
}
// during a block loop (segment processing) the two work buffers of a
// block are kept for the next block even above the pool limit. Before, a 1024²×38
// block (256 MB bucket on the Mac) was destroyed and re-created per block, and
// WebGPU zero-fills every new buffer on first use: measured as dist:touch 2.2 s.
// The buffers exist during the block anyway; retention ends with the loop.
export function beginGpuBufferRetention(){gpuFilterRuntime.retainDepth=(gpuFilterRuntime.retainDepth||0)+1}
export function endGpuBufferRetention(){
 gpuFilterRuntime.retainDepth=Math.max(0,(gpuFilterRuntime.retainDepth||0)-1);if(gpuFilterRuntime.retainDepth)return;
 const limit=gpuPoolLimit();
 for(const[size,bucket]of gpuFilterRuntime.bufferPool){while(bucket.length&&(size>limit/2||gpuFilterRuntime.bufferPoolBytes>limit)){try{bucket.pop().destroy()}catch{};gpuFilterRuntime.bufferPoolBytes-=size}}
}
export function releaseGpuWorkBuffer(buffer,size){
 if(!buffer||gpuFilterRuntime.sharedRendererDevice&&gpuFilterRuntime.device?.lost===undefined){try{buffer?.destroy?.()}catch{};return}
 const limit=gpuPoolLimit(),retain=gpuFilterRuntime.retainDepth>0;
 if(!retain&&(size>limit/2||gpuFilterRuntime.bufferPoolBytes+size>limit)){try{buffer.destroy()}catch{};return}
 let bucket=gpuFilterRuntime.bufferPool.get(size);if(!bucket){bucket=[];gpuFilterRuntime.bufferPool.set(size,bucket)}
 if(bucket.length>=2){try{buffer.destroy()}catch{};return}
 bucket.push(buffer);gpuFilterRuntime.bufferPoolBytes+=size;
}
export function clearGpuBufferPool(){
 for(const bucket of gpuFilterRuntime.bufferPool.values())for(const buffer of bucket){try{buffer.destroy()}catch{}}
 gpuFilterRuntime.bufferPool.clear();gpuFilterRuntime.bufferPoolBytes=0;
}
export async function verifyGpuComputeDevice(device){
 if(!device)return false;const wg=gpuComputeWorkgroupSize(device);gpuFilterRuntime.workgroupSize=wg;
 const out=device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{
  const code=`struct TestBuffer {
 data : array<u32, 1>
}
@group(0) @binding(0) var<storage, read_write> testBuffer : TestBuffer;
@compute @workgroup_size(${wg})
fn main(@builtin(local_invocation_index) localIndex : u32) {
 if (localIndex == 0u) {
  testBuffer.data[0] = 7u;
 }
}`;
  const module=device.createShaderModule({label:'VRL compute self-test',code});
  if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('self-test WGSL: '+errors.map(m=>m.message).join(' | '))}
  const pipeline=await gpuValidationScope(device,'compute self-test pipeline',async()=>device.createComputePipelineAsync?await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}}):device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}}));
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:out}}]}),encoder=device.createCommandEncoder({label:'VRL compute self-test'}),pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(out,0,read,0,4);device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);const value=new Uint32Array(read.getMappedRange().slice(0))[0];read.unmap();
  if(value!==7)throw new Error('compute self-test readback mismatch: '+value);
  return true;
 }finally{try{out.destroy()}catch{}try{read.destroy()}catch{}}
}
export function adoptRendererGpuDevice(renderer,adapter=null,explicitDevice=null){
 const device=explicitDevice||renderer?.backend?.device;
 if(!device||typeof device.createBuffer!=='function'||gpuFilterRuntime.device===device)return false;
 clearGpuBufferPool();gpuFilterRuntime.pipelines.clear();gpuFilterRuntime.device=device;gpuFilterRuntime.adapter=adapter;gpuFilterRuntime.disabled=false;gpuFilterRuntime.sharedRendererDevice=true;gpuFilterRuntime.initPromise=null;gpuFilterRuntime.retryAfter=0;gpuFilterRuntime.lastError='';gpuFilterRuntime.adapterLabel=gpuAdapterLabel(adapter);gpuFilterRuntime.lastBackend='WEBGPU CHECKING';gpuFilterRuntime.workgroupSize=gpuComputeWorkgroupSize(device);setGpuPrewarmIndex(0);setGpuPrewarmScheduled(false);installGpuErrorListener(device);
 try{device.lost.then(info=>{if(gpuFilterRuntime.device===device){gpuFilterRuntime.device=null;gpuFilterRuntime.sharedRendererDevice=false;gpuFilterRuntime.pipelines.clear();clearGpuBufferPool();setGpuPrewarmIndex(0);setGpuPrewarmScheduled(false);setGpuComputeBackend('GPU DEVICE LOST',gpuLostText(info))}})}catch{}
 void verifyGpuComputeDevice(device).then(async ok=>{if(gpuFilterRuntime.device===device&&ok){await verifyGpuPipelineSet();if(gpuFilterRuntime.device===device)setGpuComputeBackend('WEBGPU '+gpuDeviceMode(device)+' FULL VERIFIED · WG'+gpuFilterRuntime.workgroupSize)}}).catch(e=>{if(gpuFilterRuntime.device===device){gpuFilterRuntime.lastError='verify ['+(gpuFilterRuntime.lastShaderKind||'self-test')+']: '+String(e?.message||e);setGpuComputeBackend('WEBGPU RENDER ONLY · COMPUTE FAIL',gpuFilterRuntime.lastError)}});
 updateGpuStatus();return true;
}
// the setting 「ハイブリッド環境での処理」 ('hybrid' = the split of, 'primary' = display GPU for everything).
// Linux only; 'hybrid' everywhere else, whatever is stored (see gpu-preference.js).
export const vrlHybridMode=()=>gpuEffectiveHybridMode(globalThis.__vrlSettings?.get?.('gpuHybridMode'),navigator);
// the GPU split (see gpu-split.js for the cause and the rule). Returns {adapter,device,split} for the render device
// on the display (low-power) adapter, or null when this is not the display-Intel / compute-NVIDIA hybrid case on Linux, or the
// render device cannot be created: the caller then keeps one shared device, exactly as before. Cost of the check: Mac, iPad,
// Windows and every other machine return at the platform / compute-adapter test (no extra requestAdapter, no WebGL context).
// A Linux machine whose compute adapter is NVIDIA (a hybrid and a one-GPU desktop alike) makes one throwaway 1x1 WebGL probe
// (created, read, released) to learn the display GPU; the extra low-power requestAdapter is made only when that GPU is Intel.
export async function requestVrlSplitRenderDevice({nav=globalThis.navigator,computeAdapter=null,probe=webglDisplayGpu,request=requestVrlGpuDevice}={}){
 try{
  if(!gpuSplitCandidate(nav,computeAdapter))return null;
  const os=gpuPlatformOs(nav),computeVendor=gpuAdapterVendorKey(computeAdapter),display=probe(),displayVendor=display?gpuVendorKey(display.vendor,display.renderer):'';
  gpuFilterRuntime.splitNote='display '+(displayVendor||'unknown')+', compute '+computeVendor;
  // cheap pre-check before the extra adapter request: the display GPU itself must be Intel
  if(!gpuSplitDecision({os,computeVendor,displayVendor,lowPowerVendor:'intel'}).split)return null;
  // display Intel + compute NVIDIA = the hybrid case; the status shows the split notes from here on
  gpuFilterRuntime.hybridSeen=true;
  let decision=null;
  const accept=adapter=>{decision=gpuSplitDecision({os,computeVendor,displayVendor,lowPowerVendor:gpuAdapterVendorKey(adapter)});return decision.split};
  const render=await request({preference:'low-power',role:'render',accept});
  if(!decision?.split)return null;
  return{adapter:render.adapter,device:render.device,split:{active:true,renderVendor:decision.renderVendor,computeVendor:decision.computeVendor,reason:decision.reason}};
 }catch(e){
  gpuFilterRuntime.splitNote='split not used: '+String(e?.message||e).slice(0,160);
  console.warn('GPU split not used (single shared device).',e);
  return null;
 }
}
// 「ハイブリッド環境での処理」 = 「プライマリ GPU のみ」. Linux only, and only when the hybrid case is detected before any
// device exists (the high-performance adapter is NVIDIA, the display GPU read through WebGL is Intel, the low-power adapter is
// Intel): then the one device of the app is created on the low-power (display) adapter and serves render and compute, as on a
// one-GPU machine; no NVIDIA device is created. Returns {adapter,device}, or null when the setting is 'hybrid', this is not
// Linux, the machine is not that hybrid, or the primary device cannot be created (the caller then takes the default path).
export async function requestVrlPrimaryGpuDevice({nav=globalThis.navigator,mode=vrlHybridMode(),preference=vrlGpuPreference(),probe=webglDisplayGpu,request=requestVrlGpuDevice,adapterOf=requestVrlGpuAdapter}={}){
 try{
  if(mode!=='primary'||gpuPlatformOs(nav)!=='linux'||preference==='low-power')return null;
  const high=await adapterOf(preference,'compute');
  if(!gpuSplitCandidate(nav,high))return null;
  const computeVendor=gpuAdapterVendorKey(high),display=probe(),displayVendor=display?gpuVendorKey(display.vendor,display.renderer):'';
  if(!gpuSplitDecision({os:'linux',computeVendor,displayVendor,lowPowerVendor:'intel'}).split)return null;
  gpuFilterRuntime.hybridSeen=true;gpuFilterRuntime.splitNote='display '+displayVendor+', compute '+computeVendor;
  const low=await adapterOf('low-power','render'),lowVendor=gpuAdapterVendorKey(low);
  const decision=gpuSplitDecision({os:'linux',computeVendor,displayVendor,lowPowerVendor:lowVendor});
  if(!decision.split){gpuFilterRuntime.splitNote='primary GPU only not used: low-power adapter is '+(lowVendor||'unknown');return null}
  const got=await request({preference:'low-power',accept:a=>gpuAdapterVendorKey(a)==='intel'});
  gpuFilterRuntime.hybridMode='primary';gpuFilterRuntime.hybridVendor=decision.renderVendor;
  gpuFilterRuntime.splitNote='primary GPU only: '+decision.renderVendor+' for display and compute (no '+computeVendor+' device)';
  console.info('VRL GPU primary only: '+gpuAdapterLabel(got.adapter)+' serves render and compute; no '+computeVendor+' device created.');
  return got;
 }catch(e){
  gpuFilterRuntime.splitNote='primary GPU only not used: '+String(e?.message||e).slice(0,160);
  console.warn('Primary-GPU-only mode not used (default path).',e);
  return null;
 }
}
// Hands the two devices over: the renderer owns the render (display) device, compute keeps its own device (never configures a
// canvas or imports an external image) and is brought up by ensureGpuFilterDevice. A resource of one device is never used by
// the other: createGpuResidentFloat3Attribute returns null (device mismatch), so meshes come back through the CPU readback path.
export function adoptSplitGpuDevices(renderer,compute,render){
 const rd=render.device;
 clearGpuBufferPool();gpuFilterRuntime.pipelines.clear();
 gpuFilterRuntime.split=render.split;gpuFilterRuntime.hybridMode='hybrid';gpuFilterRuntime.renderDevice=rd;gpuFilterRuntime.renderError='';gpuFilterRuntime.renderAdapterLabel=gpuAdapterLabel(render.adapter);
 gpuFilterRuntime.renderInfo=[gpuFilterRuntime.renderPrefInfo,gpuFilterRuntime.renderLimitInfo].filter(Boolean).join(' · ');
 gpuFilterRuntime.device=null;gpuFilterRuntime.disabled=false;gpuFilterRuntime.sharedRendererDevice=false;gpuFilterRuntime.initPromise=null;gpuFilterRuntime.retryAfter=0;gpuFilterRuntime.lastError='';
 gpuFilterRuntime.pendingCompute={adapter:compute.adapter,device:compute.device};
 installGpuErrorListener(rd,'render');
 // a render device destroyed after a failed start-up (resetSplitGpuDevices) must not leave a "lost" error behind
 try{rd.lost.then(info=>{if(gpuFilterRuntime.renderDevice===rd){gpuFilterRuntime.renderError=gpuLostText(info);logGpuError('render device · lost',gpuFilterRuntime.renderError);updateGpuStatus()}})}catch{}
 console.info('VRL GPU split: render on '+gpuFilterRuntime.renderAdapterLabel+' (display), compute on '+gpuAdapterLabel(compute.adapter)+' · '+render.split.reason);
 updateGpuStatus();return true;
}
// the split render device could not be brought up (renderer init failed, or adoptSplitGpuDevices threw half-way):
// forget everything the split recorded so the single shared device that follows starts from a clean state, and say why.
export function resetSplitGpuDevices(note=''){
 const rt=gpuFilterRuntime;
 rt.split=null;rt.hybridMode='';rt.renderDevice=null;rt.pendingCompute=null;rt.renderError='';rt.renderInfo='';rt.renderAdapterLabel='';
 if(note)rt.splitNote=note;
 updateGpuStatus();
}
export async function ensureGpuFilterDevice(){
 if(!('gpu' in navigator)){gpuFilterRuntime.disabled=true;setGpuComputeBackend('CPU · WebGPU unavailable','navigator.gpu is unavailable');return null}
 gpuFilterRuntime.disabled=false;
 if(gpuFilterRuntime.device)return gpuFilterRuntime.device;
 // Safari/iPad can refuse a second adapter request even while the Three.js WebGPU
 // renderer already owns a valid GPUDevice. Reuse that renderer device first.
 // not in split mode, where the renderer's device is the display (Intel) one and compute has its own device
 const rendererDevice=gpuFilterRuntime.split?.active?null:sceneState?.renderer?.backend?.device;
 if(rendererDevice&&typeof rendererDevice.createBuffer==='function'){
  adoptRendererGpuDevice(sceneState.renderer,gpuFilterRuntime.adapter,rendererDevice);
  if(gpuFilterRuntime.device)return gpuFilterRuntime.device;
 }
 if(gpuFilterRuntime.initPromise)return gpuFilterRuntime.initPromise;
 const now=performance.now();if(gpuFilterRuntime.retryAfter>now)return null;
 gpuFilterRuntime.initPromise=(async()=>{
  gpuFilterRuntime.initAttempts++;setGpuComputeBackend('WEBGPU CHECKING');
  // `device` lives outside the try so the failure path can destroy a device that failed its verification
  let device=null;
  try{
   // split mode hands over the compute device that create3DRenderer already requested
   const handed=gpuFilterRuntime.pendingCompute;gpuFilterRuntime.pendingCompute=null;
   // 「ハイブリッド環境での処理」 = primary GPU only: the display GPU serves compute too (null elsewhere)
   const got=handed||await requestVrlPrimaryGpuDevice()||await requestVrlGpuDevice(),adapter=got.adapter;
   device=got.device;
   // a new device never inherits pipelines compiled on another one
   gpuFilterRuntime.pipelines.clear();
   gpuFilterRuntime.adapter=adapter;gpuFilterRuntime.device=device;gpuFilterRuntime.sharedRendererDevice=false;gpuFilterRuntime.adapterLabel=gpuAdapterLabel(adapter);gpuFilterRuntime.retryAfter=0;gpuFilterRuntime.lastError='';gpuFilterRuntime.warned=false;gpuFilterRuntime.workgroupSize=gpuComputeWorkgroupSize(device);installGpuErrorListener(device);setGpuComputeBackend('WEBGPU CHECKING');
   device.lost.then(info=>{if(gpuFilterRuntime.device===device){gpuFilterRuntime.device=null;gpuFilterRuntime.pipelines.clear();clearGpuBufferPool();setGpuPrewarmIndex(0);setGpuPrewarmScheduled(false);gpuFilterRuntime.retryAfter=performance.now()+2000;setGpuComputeBackend('GPU DEVICE LOST',gpuLostText(info))}});
   try{await verifyGpuComputeDevice(device);await verifyGpuPipelineSet();setGpuComputeBackend('WEBGPU '+gpuDeviceMode(device)+' FULL VERIFIED · WG'+gpuFilterRuntime.workgroupSize)}catch(testError){gpuFilterRuntime.lastError='verify ['+(gpuFilterRuntime.lastShaderKind||'self-test')+']: '+String(testError?.message||testError);setGpuComputeBackend('WEBGPU COMPUTE FAIL',gpuFilterRuntime.lastError);throw testError}
   return device;
  }catch(e){
   gpuFilterRuntime.device=null;gpuFilterRuntime.adapter=null;gpuFilterRuntime.sharedRendererDevice=false;gpuFilterRuntime.retryAfter=performance.now()+5000;
   // pipelines / pooled buffers of the failed device must not reach the next one, and the device is released
   // (never the renderer's own device)
   gpuFilterRuntime.pipelines.clear();clearGpuBufferPool();setGpuPrewarmIndex(0);setGpuPrewarmScheduled(false);
   if(device&&device!==sceneState?.renderer?.backend?.device)try{device.destroy()}catch{}
   setGpuComputeBackend('CPU COMPUTE · GPU ERROR',e?.message||e);
   console.warn('WebGPU compute unavailable for this attempt; exact CPU compute path active. GPU will be retried.',e);
   return null;
  }finally{gpuFilterRuntime.initPromise=null}
 })();
 return gpuFilterRuntime.initPromise;
}
const GPU_MAX_GROUPS=65535;
// step-time accumulator for ?debug status lines (segment-runs.js resets and reads it)
export const gpuStepTimes=new Map(),gpuRunInfo={};
// ?debug: wait for the GPU after the filter and distance passes to time them separately
// ?debug or the settings dialog's debug switch
const GPU_TIMING_DEBUG=()=>!!globalThis.__vrlSettings?.debugOn?.()||(typeof location!=='undefined'&&/[?&]debug(\b|=|&|$)/.test(location.search));
export function addGpuStepTime(name,ms){gpuStepTimes.set(name,(gpuStepTimes.get(name)||0)+ms)}
// read diagnostics: modules without a gpu-compute import report here;
// counts (cache hits/misses) are kept apart from the times
export const gpuCounts=new Map();
globalThis.__vrlTime=(name,ms)=>addGpuStepTime(name,ms);globalThis.__vrlCount=name=>gpuCounts.set(name,(gpuCounts.get(name)||0)+1);
export function gpuDispatch1D(pass,groups){pass.dispatchWorkgroups(Math.min(groups,GPU_MAX_GROUPS),Math.max(1,Math.ceil(groups/GPU_MAX_GROUPS)))}
export async function gpuFilterPipeline(kind){
 const device=await ensureGpuFilterDevice();if(!device)return null;
 if(gpuFilterRuntime.pipelines.has(kind))return gpuFilterRuntime.pipelines.get(kind);
 gpuFilterRuntime.lastShaderKind=kind;
 // 2D grids: a 1D dispatch is limited to 65535 workgroups, which a 1024x1024 block
 // of more than 16 slices exceeds (e.g. with the air-distance halo); the voxel index
 // spans gid.y rows of 65535 workgroups (gpuDispatch1D). 1D dispatches keep gid.y=0.
 const source=normalizeVrlWgsl(gpuFilterShader(kind,gpuFilterRuntime.workgroupSize)).replaceAll('gid.x','(gid.x+gid.y*'+(GPU_MAX_GROUPS*gpuFilterRuntime.workgroupSize)+'u)'),module=device.createShaderModule({code:source,label:'VRL '+kind+' compute'});
 if(typeof module.getCompilationInfo==='function'){
  const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('WGSL '+kind+': '+errors.map(m=>m.message).join(' | '));
 }
 const desc={layout:'auto',compute:{module,entryPoint:'main'},label:'VRL '+kind};
 const pipeline=await gpuValidationScope(device,'pipeline '+kind,async()=>device.createComputePipelineAsync?await device.createComputePipelineAsync(desc):device.createComputePipeline(desc));
 gpuFilterRuntime.pipelines.set(kind,pipeline);return pipeline;
}
export async function verifyGpuPipelineSet(){
 for(const kind of GPU_PREWARM_KINDS){
  gpuFilterRuntime.lastShaderKind=kind;
  await gpuFilterPipeline(kind);
 }
 gpuFilterRuntime.lastShaderKind='';
 return true;
}
export function gpuSmallBuffer(device,data){
 const buffer=device.createBuffer({size:Math.max(32,Math.ceil(data.byteLength/4)*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 device.queue.writeBuffer(buffer,0,data);return buffer;
}
export function createGpuResidentFloat3Attribute(device,vertexCount,label){
 const renderer=sceneState?.renderer,backend=renderer?.backend;
 if(sceneState?.backend!=='WEBGPU'||backend?.device!==device||typeof backend.set!=='function')return null;
 try{
  const attribute=new THREE.Float32BufferAttribute(new Float32Array(vertexCount*3),3);attribute.name=label;
  const buffer=device.createBuffer({label,size:Math.max(4,attribute.array.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  backend.set(attribute,{buffer});return{attribute,buffer};
 }catch(e){console.warn('GPU-resident attribute allocation failed.',e);return null}
}
export function destroyGpuResidentAttribute(entry){
 if(!entry)return;
 const backend=sceneState?.renderer?.backend;
 try{if(backend?.get(entry.attribute)?.buffer===entry.buffer&&typeof backend.destroyAttribute==='function')backend.destroyAttribute(entry.attribute);else entry.buffer?.destroy?.()}catch{try{entry.buffer?.destroy?.()}catch{}}
}
export function finishGpuResidentTemps(device,cleanup){
 let completion;
 try{completion=device.queue.onSubmittedWorkDone()}catch{cleanup();return Promise.resolve()}
 completion.then(cleanup,cleanup);return completion;
}
export async function runGpuSourceFilters(data,w,h,d,stages,target,segments=null,faceContext=null){
 const device=await ensureGpuFilterDevice();if(!device||!gpuStagesSupported(stages))return null;
 const bytes=data.byteLength,n=data.length;
 if(bytes>device.limits.maxStorageBufferBindingSize)return null;
 const aw=acquireGpuWorkBuffer(device,bytes),bw=acquireGpuWorkBuffer(device,bytes),a=aw.buffer,b=bw.buffer;const tUp=performance.now();device.queue.writeBuffer(a,0,data);addGpuStepTime('upload',performance.now()-tUp);
 const small=[],checks=[],tmp=[];let encoder=device.createCommandEncoder({label:'VRL filter chunk'});let current=a,next=b;
 // everything acquired here is released on every exit: the success paths release their own
 // (releaseWork is once-only), a throw releases the rest in the catch at the end.
 // tmp = scratch buffers (destroyed on a throw only); small = destroyed on success too.
 let poolReleased=false,residentHanded=false;const releaseWork=()=>{if(poolReleased)return;poolReleased=true;releaseGpuWorkBuffer(a,aw.size);releaseGpuWorkBuffer(b,bw.size)};
 const mk=desc=>{const buf=device.createBuffer(desc);tmp.push(buf);return buf};
 // createBindGroup inside its own check (a bad bind group would otherwise be an uncaptured error as well)
 const bg=(label,desc)=>{const r=gpuCheckBegin(device,'bind group '+label,()=>device.createBindGroup(desc));checks.push(r.done);return r.value};
 const dispatch=async(kind,extraU32=[],paramsF32=[],extraEntries=[])=>{
  const pipeline=await gpuFilterPipeline(kind);if(!pipeline)throw new Error('GPU pipeline unavailable: '+kind);
  const meta=new Uint32Array(8);meta[0]=w;meta[1]=h;meta[2]=d;meta[3]=n;for(let i=0;i<extraU32.length&&i<4;i++)meta[4+i]=extraU32[i]>>>0;
  const params=new Float32Array(Math.max(8,paramsF32.length));params.set(paramsF32);
  const mb=gpuSmallBuffer(device,meta),pb=gpuSmallBuffer(device,params);small.push(mb,pb);
  // bind group + pass recorded inside a synchronous validation check (no await between push and pop);
  // the result is awaited together with the others before the first submit
  checks.push(gpuCheckBegin(device,'dispatch '+kind,()=>{
   const bind=pipeline.getBindGroupLayout(0);
   const group=device.createBindGroup({layout:bind,entries:[
    {binding:0,resource:{buffer:current}},{binding:1,resource:{buffer:next}},{binding:2,resource:{buffer:mb}},{binding:3,resource:{buffer:pb}},...extraEntries
   ]});
   const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);gpuDispatch1D(pass,Math.ceil(n/gpuFilterRuntime.workgroupSize));pass.end();
  }).done);
  const t=current;current=next;next=t;
 };
 try{
 for(const stage of stages){
  const p=stage.params;
  if(stage.key==='gaussian'){
   if(p.mode==='median'){
    for(let round=0;round<Math.max(1,Math.round(p.passes));round++)await dispatch('median',[],[p.strength]);
   }else{
    // fused: one (2n+1)-tap pass per axis instead of n 3-tap passes
    // per-axis strength s_a = s*(hmin/h_a)^2 (spacing weights w_a; equal to s when isotropic)
    const sw=spacingParams(p);
    for(let axis=0;axis<3;axis++){const kernel=gaussianPassKernel(p.strength*sw[axis],p.passes),kr=(kernel.length-1)/2;await dispatch('gaussianK',[axis,kr],kernel)}
   }
  }else if(stage.key==='sigmoid')await dispatch('sigmoid',[],[p.strength,p.center,p.width||300]);
  else if(stage.key==='spikeHole')await dispatch('spikeHole',[],[p.strength,p.thresholdHU]);
  else if(stage.key==='anisotropic'){const [wx,wy,wz]=spacingParams(p);for(let iter=0;iter<Math.max(1,Math.round(p.iterations));iter++)await dispatch('anisotropic',[],[p.strength,p.kappaHU,wx,wy,wz])}
  else if(stage.key==='tv'){const [wx,wy,wz]=spacingParams(p);for(let iter=0;iter<Math.max(1,Math.round(p.iterations));iter++)await dispatch('tv',[],[p.weight,p.epsHU,wx,wy,wz])}
  else if(stage.key==='unsharp'){
   // separable: x and y box means, then z mean fused with the sharpening (see gpu-shaders.js)
   // box half-width per axis (R+0.5)*hmin/h_a voxels with fractional weights at its edge (A, K per axis; plain box when isotropic)
   const [ux,uy,uz]=unsharpAxes(p.radius,spacingRatios(p)),orig=current,xw=acquireGpuWorkBuffer(device,bytes),extra=xw.buffer;
   let xwDone=false;const relXw=()=>{if(xwDone)return;xwDone=true;releaseGpuWorkBuffer(xw.buffer,xw.size)};tmp.push({destroy:relXw});
   await dispatch('boxMean',[0,ux.K],[0,ux.A]);            // orig -> next (now current)
   const xMean=current;current=xMean;next=extra;await dispatch('boxMean',[1,uy.K],[0,uy.A]); // xMean -> extra (now current)
   const xyMean=current;next=xMean;                         // write into the x-mean buffer
   await dispatch('unsharpCombine',[0,uz.K],[p.amount,p.thresholdHU,uz.A],[{binding:4,resource:{buffer:orig}}]);
   // now current = result (old xMean buffer); keep orig as the spare, drop the extra buffer
   next=orig;small.push({destroy:relXw});
  }
  else if(stage.key==='bilateral'){
   // radius per axis clamp(ceil(1.5*sigma*hmin/h_a),0,3); spatial weight in mm via 1/w_a = (h_a/hmin)^2 (params[3..5])
   const [bx,by,bz]=bilateralRadii(p.spatialSigma,spacingRatios(p)),[wx,wy,wz]=spacingParams(p),ix=1/wx,iy=1/wy,iz=1/wz;
   for(let pass=0;pass<Math.max(1,Math.round(p.passes));pass++)await dispatch('bilateral',[bx,by,bz],[p.strength,p.spatialSigma,p.sigmaHU,ix,iy,iz]);
  }else if(stage.key==='nlm'){
   // search radius per axis in meta[4..6], patch radius per axis in params[1..3]: round(r*hmin/h_a)
   const {sr:[srx,sry,srz],pr:[prx,pry,prz]}=nlmRadii(p.searchRadius,p.patchRadius,spacingRatios(p));
   await dispatch('nlm',[srx,sry,srz],[p.hHU,prx,pry,prz]);
  }
  else return null;
  // ?debug: GPU time of each filter stage
  // (the GPU_TIMING_DEBUG submits below, up to the distance passes, are diagnostics only and are not validation-checked;
  // a pending error of the recorded commands is still reported by the next checked submit)
  if(GPU_TIMING_DEBUG()&&/[?&]stagetimes/.test(location.search)){const t=performance.now();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();addGpuStepTime('f:'+(stage.key==='gaussian'&&p.mode==='median'?'median':stage.key),performance.now()-t);encoder=device.createCommandEncoder({label:'VRL filter stage'})}
 }
 if(segments?.length&&faceContext?.analysisRuns){
  // One filtered block, one run set per segment: the filters (the expensive
  // part) run once even when several threshold ranges are extracted, e.g. a
  // segment and its body mask for the air-boundary exclusion.
  const targetCount=target.width*target.height*target.depth,meta=new Uint32Array(12);
  meta[0]=w;meta[1]=h;meta[2]=d;meta[3]=target.x;meta[4]=target.y;meta[5]=target.z;meta[6]=target.width;meta[7]=target.height;meta[8]=target.depth;meta[9]=targetCount;
  const mb=gpuSmallBuffer(device,meta),counter=mk({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});small.push(mb);
  const countPipeline=await gpuFilterPipeline('analysisRunCount'),writePipeline=await gpuFilterPipeline('analysisRunWrite'),groups=Math.ceil(targetCount/gpuFilterRuntime.workgroupSize);
  const maxOut=Math.min(device.limits.maxStorageBufferBindingSize,device.limits.maxBufferSize||device.limits.maxStorageBufferBindingSize);
  if(GPU_TIMING_DEBUG()){const t=performance.now();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();addGpuStepTime('gpu filters',performance.now()-t);encoder=device.createCommandEncoder({label:'VRL analysis after filters'})}
  const itemsList=[];let enc=encoder;
  // optional distance-to-air field (airLayers): the segments are then ranges of
  // squared distance, read from the field instead of the CT values
  const airl=faceContext.airLayers;
  // diagnostics (?debug&stagetimes): GPU time of each airDist axis pass
  const axisSync=GPU_TIMING_DEBUG()&&/[?&]stagetimes/.test(location.search);
  if(axisSync){const t=performance.now();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();addGpuStepTime('pre-dist',performance.now()-t);encoder=device.createCommandEncoder({label:'VRL airDist axes'})}
  // diagnostics: clear the output buffer first ('dist:touch'), so a first-write
  // cost of that buffer is split from the x pass's own GPU time
  if(axisSync&&airl){const t=performance.now();encoder.clearBuffer(next);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();addGpuStepTime('dist:touch',performance.now()-t);encoder=device.createCommandEncoder({label:'VRL airDist axes'})}
  if(airl)for(let axis=0;axis<3;axis++){await dispatch(axis===0&&airl.n[0]<=AIRDIST_X_MAX_N?'airDistX':'airDist',[axis,airl.n[axis],0],[airl.min,airl.max,airl.spacing[axis]]);if(axisSync){const t=performance.now();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();addGpuStepTime('dist:'+'xyz'[axis]+'(n='+airl.n[axis]+')',performance.now()-t);encoder=device.createCommandEncoder({label:'VRL airDist axes'})}}
  // opening by a ball (thin-region removal B) on a 0/1 mask: erosion distance
  // (mode 1), then distance to the eroded core (mode 2); segment[0] then reads
  // the kept voxels as [0, r²]
  const open=faceContext.openBall;
  if(open){
   for(let axis=0;axis<3;axis++)await dispatch(axis===0&&open.n[0]<=AIRDIST_X_MAX_N?'airDistX':'airDist',[axis,open.n[axis],1],[0,1,open.spacing[axis],open.r2]);
   for(let axis=0;axis<3;axis++)await dispatch(axis===0&&open.n[0]<=AIRDIST_X_MAX_N?'airDistX':'airDist',[axis,open.n[axis],2],[0,1,open.spacing[axis],open.r2]);
  }
  if(GPU_TIMING_DEBUG()&&(airl||open)){const t=performance.now();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();addGpuStepTime('gpu distance',performance.now()-t);encoder=device.createCommandEncoder({label:'VRL analysis after distance'});enc=encoder}
  const firstSrc=current;
  // distance layers: one class RLE pass for all layers instead of a count/write
  // round trip per layer (the ranges are consecutive: layer k = (max[k-1], max[k]])
  if(airl&&segments.length>1){
   const K=segments.length,th=new Float32Array(4+K);th[0]=segments[0].seg.min;th[1]=K;for(let k=0;k<K;k++)th[4+k]=segments[k].seg.max;
   const tb=gpuSmallBuffer(device,th);small.push(tb);
   try{
    const cp=await gpuFilterPipeline('classRunCount'),wp=await gpuFilterPipeline('classRunWrite');device.queue.writeBuffer(counter,0,new Uint32Array([0]));
    const cg=bg('class RLE count',{layout:cp.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:current}},{binding:2,resource:{buffer:mb}},{binding:3,resource:{buffer:tb}},{binding:4,resource:{buffer:counter}}]});
    const pass=enc.beginComputePass();pass.setPipeline(cp);pass.setBindGroup(0,cg);gpuDispatch1D(pass,groups);pass.end();
    const countRead=mk({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});enc.copyBufferToBuffer(counter,0,countRead,0,4);{const e=enc;enc=null;await gpuSubmitChecked(device,'class RLE count',e,checks)}
    const tGpu=performance.now();await countRead.mapAsync(GPUMapMode.READ);addGpuStepTime('gpu compute',performance.now()-tGpu);const runCount=new Uint32Array(countRead.getMappedRange().slice(0))[0];countRead.unmap();countRead.destroy();
    let items=new Uint32Array(0);
    if(runCount){
     const recordBytes=runCount*16;if(recordBytes>maxOut)throw new Error('GPU analysis run output exceeds device buffer limit');
     const records=mk({size:recordBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),readback=mk({size:recordBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});device.queue.writeBuffer(counter,0,new Uint32Array([0]));
     const wg=bg('class RLE write',{layout:wp.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:current}},{binding:1,resource:{buffer:records}},{binding:2,resource:{buffer:mb}},{binding:3,resource:{buffer:tb}},{binding:4,resource:{buffer:counter}}]}),we=device.createCommandEncoder({label:'VRL class RLE'});
     const p2=we.beginComputePass();p2.setPipeline(wp);p2.setBindGroup(0,wg);gpuDispatch1D(p2,groups);p2.end();we.copyBufferToBuffer(records,0,readback,0,recordBytes);await gpuSubmitChecked(device,'class RLE write',we,checks);
     const tRb=performance.now();await readback.mapAsync(GPUMapMode.READ);addGpuStepTime('readback',performance.now()-tRb);items=new Uint32Array(readback.getMappedRange().slice(0));readback.unmap();records.destroy();readback.destroy();
    }
    // split by class; the first word goes back to the local slice index
    const tSplit=performance.now();
    const counts=new Uint32Array(K);for(let i=0;i<items.length;i+=4)counts[(items[i]>>>16)-1]++;
    const itemsList=[...counts].map(n=>new Uint32Array(n*4)),fill=new Uint32Array(K);
    for(let i=0;i<items.length;i+=4){const c=(items[i]>>>16)-1,o=fill[c]++*4,dst=itemsList[c];dst[o]=items[i]&65535;dst[o+1]=items[i+1];dst[o+2]=items[i+2];dst[o+3]=items[i+3]}
    addGpuStepTime('split',performance.now()-tSplit);setGpuComputeBackend('WEBGPU ANALYSIS RLE');
    return{analysisRuns:true,items:itemsList[0],itemsList,count:itemsList[0].length/4};
   }finally{
    if(enc)device.queue.submit([enc.finish()]);
    releaseWork();counter.destroy();for(const buf of small)buf.destroy();
   }
  }
  try{
   for(const [si,{seg}] of segments.entries()){
    const src=si===0?firstSrc:current;
    const tb=gpuSmallBuffer(device,new Float32Array([seg.min,seg.max,0,0]));small.push(tb);device.queue.writeBuffer(counter,0,new Uint32Array([0]));
    enc=enc||device.createCommandEncoder({label:'VRL analysis RLE count'});
    const countGroup=bg('analysis RLE count',{layout:countPipeline.getBindGroupLayout(0),entries:[
     {binding:0,resource:{buffer:src}},{binding:2,resource:{buffer:mb}},{binding:3,resource:{buffer:tb}},{binding:4,resource:{buffer:counter}}
    ]});
    const countPass=enc.beginComputePass();countPass.setPipeline(countPipeline);countPass.setBindGroup(0,countGroup);gpuDispatch1D(countPass,groups);countPass.end();
    const countRead=mk({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});enc.copyBufferToBuffer(counter,0,countRead,0,4);{const e=enc;enc=null;await gpuSubmitChecked(device,'analysis RLE count',e,checks)}
    const tGpu=performance.now();await countRead.mapAsync(GPUMapMode.READ);addGpuStepTime('gpu compute',performance.now()-tGpu);const runCount=new Uint32Array(countRead.getMappedRange().slice(0))[0];countRead.unmap();countRead.destroy();
    if(!runCount){itemsList.push(new Uint32Array(0));continue}
    const recordBytes=runCount*16;if(recordBytes>maxOut)throw new Error('GPU analysis run output exceeds device buffer limit');
    const records=mk({size:recordBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),readback=mk({size:recordBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});device.queue.writeBuffer(counter,0,new Uint32Array([0]));
    const writeGroup=bg('analysis RLE write',{layout:writePipeline.getBindGroupLayout(0),entries:[
     {binding:0,resource:{buffer:src}},{binding:1,resource:{buffer:records}},{binding:2,resource:{buffer:mb}},{binding:3,resource:{buffer:tb}},{binding:4,resource:{buffer:counter}}
    ]}),writeEncoder=device.createCommandEncoder({label:'VRL analysis RLE'});
    const writePass=writeEncoder.beginComputePass();writePass.setPipeline(writePipeline);writePass.setBindGroup(0,writeGroup);gpuDispatch1D(writePass,groups);writePass.end();writeEncoder.copyBufferToBuffer(records,0,readback,0,recordBytes);await gpuSubmitChecked(device,'analysis RLE write',writeEncoder,checks);
    const tRb=performance.now();await readback.mapAsync(GPUMapMode.READ);addGpuStepTime('readback',performance.now()-tRb);itemsList.push(new Uint32Array(readback.getMappedRange().slice(0)));readback.unmap();records.destroy();readback.destroy();
   }
  }finally{
   if(enc)device.queue.submit([enc.finish()]);
   releaseWork();counter.destroy();for(const buf of small)buf.destroy();
  }
  setGpuComputeBackend('WEBGPU ANALYSIS RLE');
  return{analysisRuns:true,items:itemsList[0],itemsList,count:itemsList[0].length/4};
 }
 if(segments?.length&&faceContext?.mesh){
  const targetCount=target.width*target.height*target.depth,meta=new Uint32Array(28);
  meta[0]=w;meta[1]=h;meta[2]=d;meta[3]=target.x;meta[4]=target.y;meta[5]=target.z;meta[6]=target.width;meta[7]=target.height;meta[8]=target.depth;meta[9]=targetCount;meta[10]=Math.min(segments.length,4);
  meta[11]=faceContext.boxX;meta[12]=faceContext.boxY;meta[13]=faceContext.boxZ;meta[14]=faceContext.globalW;meta[15]=faceContext.globalH;meta[16]=faceContext.globalD;
  // spacing for the gradient normals (meta[21..23]) and the field blur weight (meta[24])
  // no field blur: the surface smoothing (constrained-smooth.js, on the CPU) starts from the voxel faces
  {const mf=new Float32Array(meta.buffer);mf[21]=faceContext.spacingX||1;mf[22]=faceContext.spacingY||1;mf[23]=faceContext.spacingZ||1;mf[24]=0}
  const thresholds=new Float32Array(8);for(let i=0;i<meta[10];i++){thresholds[i*2]=segments[i].seg.min;thresholds[i*2+1]=segments[i].seg.max}
  const mb=gpuSmallBuffer(device,meta),tb=gpuSmallBuffer(device,thresholds);small.push(mb,tb);
  const counters=mk({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(counters,0,new Uint32Array(4));
  const countPipeline=await gpuFilterPipeline('meshCount'),countGroup=bg('mesh count',{layout:countPipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:current}},{binding:2,resource:{buffer:mb}},{binding:3,resource:{buffer:tb}},{binding:4,resource:{buffer:counters}}
  ]});
  const cp=encoder.beginComputePass();cp.setPipeline(countPipeline);cp.setBindGroup(0,countGroup);gpuDispatch1D(cp,Math.ceil(targetCount/gpuFilterRuntime.workgroupSize));cp.end();
  const countRead=mk({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});encoder.copyBufferToBuffer(counters,0,countRead,0,16);await gpuSubmitChecked(device,'mesh count',encoder,checks);
  await countRead.mapAsync(GPUMapMode.READ);const counts=new Uint32Array(countRead.getMappedRange().slice(0));countRead.unmap();countRead.destroy();
  const totalFaces=counts[0]+counts[1]+counts[2]+counts[3],vertexBytes=totalFaces*18*4,maxOut=Math.min(device.limits.maxStorageBufferBindingSize,device.limits.maxBufferSize||device.limits.maxStorageBufferBindingSize);
  if(totalFaces===0){
   releaseWork();counters.destroy();for(const buf of small)buf.destroy();setGpuComputeBackend('WEBGPU FILTER+MESH');return{mesh:true,vertices:new Float32Array(0),counts};
  }
  if(vertexBytes<=maxOut){
   let offset=0;for(let i=0;i<4;i++){meta[17+i]=offset;offset+=counts[i]}device.queue.writeBuffer(mb,0,meta);device.queue.writeBuffer(counters,0,new Uint32Array(4));
   // the GPU writes the voxel faces as they are (the lattice positions) also with surface smoothing on: the
   // constrained smoothing starts from them (the blurred-field corners of-611, meshCornerInit / meshWriteSmooth,
   // flattened gentle slopes only so far and moved thin structures; they are gone)
   const vertexCount=totalFaces*6,allowGpuResident=faceContext?.gpuResident!==false;
   const residentPosition=allowGpuResident?createGpuResidentFloat3Attribute(device,vertexCount,'VRL GPU resident position'):null,gpuResident=!!residentPosition;
   tmp.push({destroy:()=>{if(!residentHanded)destroyGpuResidentAttribute(residentPosition)}});
   const output=gpuResident?residentPosition.buffer:mk({size:vertexBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
   const sx=faceContext.spacingX,sy=faceContext.spacingY,sz=faceContext.spacingZ,px=faceContext.globalW*sx,py=faceContext.globalH*sy,pz=faceContext.globalD*sz,scale=3.3/Math.max(px,py,pz,1);
   const gb=gpuSmallBuffer(device,new Float32Array([sx,sy,sz,scale,px,py,pz,0]));small.push(gb);
   const writeEncoder=device.createCommandEncoder({label:'VRL GPU mesh vertices'});
   const writePipeline=await gpuFilterPipeline('meshWrite'),entries=[
    {binding:0,resource:{buffer:current}},{binding:1,resource:{buffer:output}},{binding:2,resource:{buffer:mb}},{binding:3,resource:{buffer:tb}},{binding:4,resource:{buffer:counters}},{binding:5,resource:{buffer:gb}}
   ];
   const writeGroup=bg('mesh write',{layout:writePipeline.getBindGroupLayout(0),entries}),wp=writeEncoder.beginComputePass();wp.setPipeline(writePipeline);wp.setBindGroup(0,writeGroup);gpuDispatch1D(wp,Math.ceil(targetCount/gpuFilterRuntime.workgroupSize));wp.end();
   if(gpuResident){
    await gpuSubmitChecked(device,'mesh write (resident)',writeEncoder,checks);residentHanded=true;
    const cleanup=()=>{releaseWork();counters.destroy();for(const buf of small)buf.destroy()};
    const completion=finishGpuResidentTemps(device,cleanup);
    setGpuComputeBackend('WEBGPU GPU-RESIDENT MESH');
    return{mesh:true,gpuResident:true,positionAttribute:residentPosition.attribute,counts,completion};
   }
   const readback=mk({size:vertexBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});writeEncoder.copyBufferToBuffer(output,0,readback,0,vertexBytes);await gpuSubmitChecked(device,'mesh write',writeEncoder,checks);
   await readback.mapAsync(GPUMapMode.READ);const vertices=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();
   output.destroy();readback.destroy();releaseWork();counters.destroy();for(const buf of small)buf.destroy();
   setGpuComputeBackend('WEBGPU FILTER+MESH');return{mesh:true,vertices,counts};
  }
  counters.destroy();
  encoder=device.createCommandEncoder({label:'VRL compact face extraction'});
  // Oversized vertex output falls through to compact-face extraction using the already filtered GPU buffer.
 }
 // texture-ready output for the GPU volume (faceContext.pack):
 // packed/reduced rg8 slices for pack.zList (box-local z) plus full-res float
 // planes only for pack.previewZ (the 3D C/S preview), instead of reading the
 // whole filtered block back as floats
 if(faceContext?.pack&&!segments?.length&&w===target.width&&h===target.height&&target.x===0&&target.y===0){
  const pk=faceContext.pack,rowWords=pk.rowStride/4,nz=pk.zList.length,words=rowWords*pk.th*nz;
  const aux=new Uint32Array(pk.tw+1+pk.th+1+Math.max(1,nz));aux.set(pk.xs,0);aux.set(pk.ys,pk.tw+1);aux.set(pk.zList,pk.tw+1+pk.th+1);
  const meta=new Uint32Array(8);meta[0]=w;meta[1]=h;meta[2]=d;meta[3]=pk.tw;meta[4]=pk.th;meta[5]=nz;meta[6]=rowWords;meta[7]=words;
  const params=new Float32Array([1/(pk.slope||1),pk.intercept||0,pk.bias||0,0]);
  const mb=gpuSmallBuffer(device,meta),pb=gpuSmallBuffer(device,params),ab=gpuSmallBuffer(device,aux);small.push(mb,pb,ab);
  const outBytes=Math.max(4,words*4),out=mk({size:outBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const pipe=await gpuFilterPipeline('packReduce');
  const group=bg('pack',{layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:current}},{binding:1,resource:{buffer:out}},{binding:2,resource:{buffer:mb}},{binding:3,resource:{buffer:pb}},{binding:4,resource:{buffer:ab}}]});
  if(nz){const pass=encoder.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,group);gpuDispatch1D(pass,Math.ceil(words/gpuFilterRuntime.workgroupSize));pass.end()}
  const plane=w*h*4,pz=pk.previewZ||[],readBytes=outBytes+pz.length*plane,readback=mk({size:readBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  encoder.copyBufferToBuffer(out,0,readback,0,outBytes);
  pz.forEach((z,i)=>encoder.copyBufferToBuffer(current,z*plane,readback,outBytes+i*plane,plane));
  await gpuSubmitChecked(device,'pack',encoder,checks);
  const tWait=performance.now();await readback.mapAsync(GPUMapMode.READ);addGpuStepTime('gpu:wait',performance.now()-tWait);
  const tCopy=performance.now(),bytes=readback.getMappedRange().slice(0);readback.unmap();addGpuStepTime('gpu:copy',performance.now()-tCopy);globalThis.__vrlCount?.('filter blocks');
  releaseWork();out.destroy();readback.destroy();for(const buf of small)buf.destroy();
  setGpuComputeBackend('WEBGPU COMPUTE');
  return{packed:new Uint8Array(bytes,0,words*4),preview:new Float32Array(bytes,outBytes,pz.length*w*h),zList:pk.zList,previewZ:pz,sliceBytes:rowWords*4*pk.th};
 }
 const targetCount=target.width*target.height*target.depth,compactFaces=!!(segments?.length&&faceContext),targetBytes=targetCount*(compactFaces?8:4);
 const targetBuffer=mk({size:Math.max(4,targetBytes),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const extractMeta=new Uint32Array(20);extractMeta[0]=w;extractMeta[1]=h;extractMeta[2]=d;extractMeta[3]=target.x;extractMeta[4]=target.y;extractMeta[5]=target.z;extractMeta[6]=target.width;extractMeta[7]=target.height;extractMeta[8]=target.depth;extractMeta[9]=targetCount;
 let extractPipeline,extractGroup,counter=null,counterReadback=null;
 const emb=gpuSmallBuffer(device,extractMeta);small.push(emb);
 if(segments?.length){
  extractMeta[10]=Math.min(segments.length,4);
  if(faceContext){
   extractMeta[11]=faceContext.boxX;extractMeta[12]=faceContext.boxY;extractMeta[13]=faceContext.boxZ;
   extractMeta[14]=faceContext.globalW;extractMeta[15]=faceContext.globalH;extractMeta[16]=faceContext.globalD;
  }
  device.queue.writeBuffer(emb,0,extractMeta);
  const thresholdValues=new Float32Array(8);
  for(let i=0;i<Math.min(segments.length,4);i++){thresholdValues[i*2]=segments[i].seg.min;thresholdValues[i*2+1]=segments[i].seg.max}
  const tb=gpuSmallBuffer(device,thresholdValues);small.push(tb);
  extractPipeline=await gpuFilterPipeline(compactFaces?'faceCompact':'maskExtract');
  const entries=[{binding:0,resource:{buffer:current}},{binding:1,resource:{buffer:targetBuffer}},{binding:2,resource:{buffer:emb}},{binding:3,resource:{buffer:tb}}];
  if(compactFaces){
   counter=mk({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
   device.queue.writeBuffer(counter,0,new Uint32Array([0]));
   entries.push({binding:4,resource:{buffer:counter}});
  }
  extractGroup=bg('extract',{layout:extractPipeline.getBindGroupLayout(0),entries});
 }else{
  extractPipeline=await gpuFilterPipeline('extract');
  extractGroup=bg('extract',{layout:extractPipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:current}},{binding:1,resource:{buffer:targetBuffer}},{binding:2,resource:{buffer:emb}}
  ]});
 }
 const ep=encoder.beginComputePass();ep.setPipeline(extractPipeline);ep.setBindGroup(0,extractGroup);gpuDispatch1D(ep,Math.ceil(targetCount/gpuFilterRuntime.workgroupSize));ep.end();
 if(compactFaces){
  counterReadback=mk({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  encoder.copyBufferToBuffer(counter,0,counterReadback,0,4);await gpuSubmitChecked(device,'face compact',encoder,checks);
  await counterReadback.mapAsync(GPUMapMode.READ);const count=Math.min(targetCount,new Uint32Array(counterReadback.getMappedRange().slice(0))[0]);counterReadback.unmap();
  let items=new Uint32Array(0);
  if(count){
   const itemBytes=count*8,readback=mk({size:itemBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),copyEncoder=device.createCommandEncoder({label:'VRL compact face readback'});
   copyEncoder.copyBufferToBuffer(targetBuffer,0,readback,0,itemBytes);await gpuSubmitChecked(device,'face compact readback',copyEncoder,checks);
   await readback.mapAsync(GPUMapMode.READ);items=new Uint32Array(readback.getMappedRange().slice(0));readback.unmap();readback.destroy();
  }
  releaseWork();targetBuffer.destroy();counter.destroy();counterReadback.destroy();for(const buf of small)buf.destroy();
  setGpuComputeBackend('WEBGPU FILTER+COMPACT FACES');return{compact:true,items};
 }
 const readback=mk({size:targetBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 encoder.copyBufferToBuffer(targetBuffer,0,readback,0,targetBytes);await gpuSubmitChecked(device,'extract',encoder,checks);
 // diagnostics: GPU filter work (everything queued for this block,
 // incl. the upload) vs copying the result back into JS
 const tWait=performance.now();await readback.mapAsync(GPUMapMode.READ);addGpuStepTime('gpu:wait',performance.now()-tWait);
 const tCopy=performance.now(),copy=readback.getMappedRange().slice(0),result=segments?.length?new Uint32Array(copy):new Float32Array(copy);readback.unmap();addGpuStepTime('gpu:copy',performance.now()-tCopy);globalThis.__vrlCount?.('filter blocks');
 releaseWork();targetBuffer.destroy();readback.destroy();for(const buf of small)buf.destroy();
 setGpuComputeBackend(segments?.length?'WEBGPU FILTER+MASK':'WEBGPU COMPUTE');return result;
 }catch(e){
  // a throw (validation error, capacity, ...) must not leak the pooled work buffers or any scratch buffer
  for(const t of tmp){try{t.destroy()}catch{}}
  for(const t of small){try{t.destroy()}catch{}}
  releaseWork();throw e;
 }
}

// Thin-region removal B on the GPU: opening of per-slice runs by a ball of
// diameter thicknessMm (erode, then dilate back within the segment), block-wise
// along z. Returns per-slice runs sorted by row, or null when WebGPU is unavailable.
export async function gpuOpenRuns(runs,w,h,d,spacing,thicknessMm,onProgress=null,alive=()=>true){
 const device=await ensureGpuFilterDevice();if(!device)return null;
 const sp=spacing.map(Number),r=thicknessMm/2,r2=r*r,n=sp.map(s=>Math.floor(r/s+1e-9)),halo=2*n[2]+1,plane=w*h;
 const limit=Number(device.limits?.maxStorageBufferBindingSize)||134217728,core=Math.max(1,Math.min(32,Math.floor(limit/(plane*4))-2*halo-1));
 const out=new Array(d),seg=[{key:'open',seg:{min:0,max:r2*(1+1e-5)}}];
 for(let z0=0;z0<d;z0+=core){
  if(!alive())throw new Error('__SUPERSEDED__');
  const depth=Math.min(core,d-z0),za=Math.max(0,z0-halo),zb=Math.min(d,z0+depth+halo),mask=new Float32Array(plane*(zb-za));
  const tMask=performance.now();for(let z=za;z<zb;z++){const m=runsSliceToMask(runs[z],w,h),base=(z-za)*plane;for(let i=0;i<plane;i++)if(m[i])mask[base+i]=1}addGpuStepTime('open mask',performance.now()-tMask);
  const target={x:0,y:0,z:z0-za,width:w,height:h,depth};
  const result=await runGpuSourceFilters(mask,w,h,zb-za,[],target,seg,{analysisRuns:true,openBall:{r2,n,spacing:sp}});
  if(!result?.analysisRuns)return null;
  const per=Array.from({length:depth},()=>[]),items=result.items;
  for(let i=0;i<items.length;i+=4){const lz=items[i];if(lz<depth)per[lz].push(items[i+1],items[i+2],items[i+3])}
  for(let z=0;z<depth;z++){
   const flat=per[z],k=flat.length/3,order=Array.from({length:k},(_,i)=>i).sort((a,b)=>(flat[a*3]-flat[b*3])||(flat[a*3+1]-flat[b*3+1])),rec=new Uint32Array(flat.length);
   for(let i=0;i<k;i++){const j=order[i]*3;rec[i*3]=flat[j];rec[i*3+1]=flat[j+1];rec[i*3+2]=flat[j+2]}
   out[z0+z]=rec;
  }
  onProgress?.(Math.min(d,z0+depth),d);await frameYield();
 }
 return out;
}
