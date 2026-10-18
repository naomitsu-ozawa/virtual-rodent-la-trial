// Memory ledger (build 303, diagnostics): GPU textures/buffers created on the
// shared WebGPU device, by label, plus the app's own caches. Safari gives a
// page no memory API, so this is what the app itself holds (browser internals
// and garbage not yet collected are not included).
const BPP={r8unorm:1,rg8unorm:2,r16float:2,r32float:4,rgba8unorm:4,bgra8unorm:4,'rgba8unorm-srgb':4,'bgra8unorm-srgb':4,rgba16float:8,rgba32float:16,depth24plus:4,'depth24plus-stencil8':4,depth32float:4,depth16unorm:2};
export const gpuLedger={tex:new Map(),buf:new Map(),texBytes:0,bufBytes:0};
const gone=new FinalizationRegistry(({kind,label,bytes})=>release(kind,label,bytes));
function add(kind,label,bytes){const m=gpuLedger[kind];m.set(label,(m.get(label)||0)+bytes);gpuLedger[kind+'Bytes']+=bytes}
function release(kind,label,bytes){const m=gpuLedger[kind];m.set(label,Math.max(0,(m.get(label)||0)-bytes));gpuLedger[kind+'Bytes']=Math.max(0,gpuLedger[kind+'Bytes']-bytes)}
function track(obj,kind,label,bytes){
 if(!obj||!bytes)return obj;add(kind,label,bytes);let live=true;const token={};gone.register(obj,{kind,label,bytes},token);
 const destroy=obj.destroy?.bind(obj);if(destroy)obj.destroy=()=>{if(live){live=false;gone.unregister(token);release(kind,label,bytes)}return destroy()};
 return obj;
}
const short=l=>String(l||'unlabelled').replace(/^VRL /,'').slice(0,28);
export function installGpuLedger(device){
 if(!device||device.__vrlLedger)return;device.__vrlLedger=true;
 const ct=device.createTexture.bind(device),cb=device.createBuffer.bind(device);
 device.createTexture=desc=>{const t=ct(desc);try{const s=desc.size,d=Array.isArray(s)?s:[s.width,s.height??1,s.depthOrArrayLayers??1];track(t,'tex',short(desc.label||desc.format),d[0]*(d[1]||1)*(d[2]||1)*(BPP[desc.format]||4)*(desc.sampleCount||1))}catch{}return t};
 device.createBuffer=desc=>{const b=cb(desc);try{track(b,'buf',short(desc.label||'buffer'),desc.size||0)}catch{}return b};
}
const mb=n=>(n/2**20).toFixed(0)+'MB';
export function ledgerText(caches={}){
 const top=(m,k)=>[...m].filter(([,v])=>v>=16*2**20).sort((a,b)=>b[1]-a[1]).slice(0,k).map(([n,v])=>n+' '+mb(v)).join(', ');
 const c=Object.entries(caches).filter(([,v])=>v>0).map(([n,v])=>n+' '+mb(v)).join(', ');
 return 'GPU tex '+mb(gpuLedger.texBytes)+' ['+top(gpuLedger.tex,4)+'] · buf '+mb(gpuLedger.bufBytes)+' ['+top(gpuLedger.buf,4)+']'+(c?' · JS '+c:'');
}
