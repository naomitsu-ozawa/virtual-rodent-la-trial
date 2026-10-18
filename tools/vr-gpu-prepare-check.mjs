// Smoke check of the GPU preparation before a VR session (build 393): loads the
// app offline like boot-check, imports vr-view.js, calls prepareVrGpu with a small
// synthetic volume on SwiftShader WebGL2 and expects the textures uploaded and
// every shader variant compiled without GL errors. Build 484 guard: three.js compiles lazily and only logs a failure on first use, so the check also asks the GL
// context for the link status and info log of every program it created (a GLSL syntax error in the VR shader fails here, and therefore CI).
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/vr-gpu-prepare-check.mjs
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root=path.resolve('docs'),nm=path.resolve('node_modules');const errors=[];
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]));
 // build 437: the practice data's bundled project (docs/demo/sample1/project.vrlab) is applied on load; the checks start
 // from the bare data unless SAMPLE_PROJECT=1
 if(p.endsWith('project.vrlab')&&!process.env.SAMPLE_PROJECT){r.writeHead(404);r.end();return}
 fs.readFile(p.endsWith('/')?p+'index.html':p,(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':'application/octet-stream'});r.end(b)})}).listen(8767);
const map=u=>{
 if(u.includes('three@0.186.0/build/three.module.js'))return nm+'/three/build/three.module.js';
 if(u.includes('three@0.186.0/build/three.webgpu.js'))return nm+'/three/build/three.webgpu.js';
 if(u.includes('three.core.js'))return nm+'/three/build/three.core.js';
 if(u.includes('dicom-parser'))return nm+'/dicom-parser/dist/dicomParser.min.js';
 if(u.includes('fflate'))return nm+'/fflate/esm/browser.js';
 return null};
const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const pg=await b.newPage();
pg.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('console.'+m.type()+':',m.text().slice(0,300))});
pg.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR:',String(e).slice(0,500))});
await pg.route(/^https:\/\//,async rt=>{const u=rt.request().url(),f=map(u);
 if(f){let body=fs.readFileSync(f,'utf8');if(u.includes('dicom-parser'))body='const require=()=>({});const module={exports:{}};const exports=module.exports;\n'+body+'\nexport default (module.exports.default||module.exports);';
  return rt.fulfill({status:200,contentType:'text/javascript',body})}
 if(u.includes('three-mesh-bvh')||u.includes('cornerstone'))return rt.fulfill({status:200,contentType:'text/javascript',body:'export const MeshBVH=class{};export const acceleratedRaycast=()=>{};export const computeBoundsTree=()=>{};export const disposeBoundsTree=()=>{};export default {};'});
 return rt.abort()});
await pg.goto('http://localhost:8767/index.html');await pg.waitForTimeout(3000);
const ver=fs.readFileSync('docs/version.js','utf8').match(/APP_VERSION='([^']+)'/)[1];
const result=await pg.evaluate(async ver=>{
 const m=await import('./vr-view.js?v='+ver.replace(/\./g,'')+'x');
 const N=32,n=N*N*N,data=new Uint8Array(n*2);for(let i=0;i<n;i++){const v=1024+((i%7)*200);data[i*2]=v&255;data[i*2+1]=v>>8}
 const bx=N/8,bricks=new Float32Array(bx*bx*bx*4);for(let i=0;i<bx*bx*bx;i++){bricks[i*4]=-1000;bricks[i*4+1]=2000} // build 526: RGBA32F (B = mask-only occupancy)
 const vd={data,dims:[N,N,N],bricks,brickDims:[bx,bx,bx],halfExt:[1.65,1.65,1.65],step:0.08,calibration:[1,-1024,0]};
 const C=4,cls=new Uint8Array(n*C),dist=new Uint8Array(n*C);for(let i=0;i<n;i++){cls[i*C]=i%2?200:10;cls[i*C+1]=100;cls[i*C+2]=10;dist[i*C]=1;dist[i*C+1]=3;dist[i*C+2]=9}
 const P={key:'smoke',vd,half:null,edit:{dims:[N,N,N],data:null,active:0},cls:{data:cls,C,chan:[0,1,2,-1]},dist:{data:dist,C,chan:[0,1,2,-1]},times:{}};
 const t0=performance.now();const g=await m.prepareVrGpu(P,'vr',{data:0,refine:1,quality:0});
 if(!g)return{ok:false,reason:'prepareVrGpu returned null'};
 const gl=g.renderer.getContext(),err=gl.getError();
 const progs=g.renderer.info.programs||[],broken=progs.filter(p=>!gl.getProgramParameter(p.program,gl.LINK_STATUS)).map(p=>(gl.getProgramInfoLog(p.program)||'link failed').slice(0,400));
 const out={ok:err===gl.NO_ERROR&&g.warm.length===7&&!!g.full&&!!g.full.combo&&progs.length>=4&&broken.length===0,broken,glError:err,warm:g.warm.length,combo:!!g.full.combo,times:g.times,ms:performance.now()-t0,programs:g.renderer.info.programs.length};
 m.disposeGpuPrepared();return out;
},ver);
console.log(JSON.stringify(result));
await b.close();srv.close();if(errors.length||!result.ok){console.error('vr-gpu-prepare check FAILED');process.exit(1)}console.log('vr-gpu-prepare check OK');
