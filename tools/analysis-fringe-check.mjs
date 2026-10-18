// Practice-data check of the analysis result boundary (build 412 follow-up): opens docs/demo/sample1, adds the fat
// segment (and FILTER=<key> from the filter menu), takes the final segment runs and their largest connected component
// (componentsFromRuns, the analysis region), and counts segment voxels outside the component that touch it face-wise
// (6-neighbour: must be 0) or only edge / corner-wise (26-neighbour only: separate components drawn uncoloured
// along the result boundary).
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/analysis-fringe-check.mjs
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root=path.resolve('docs'),nm=path.resolve('node_modules');const errors=[];
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]));
 // build 437: the practice data's bundled project (docs/demo/sample1/project.vrlab) is applied on load; the checks start
 // from the bare data unless SAMPLE_PROJECT=1
 if(p.endsWith('project.vrlab')&&!process.env.SAMPLE_PROJECT){r.writeHead(404);r.end();return}
 fs.readFile(p.endsWith('/')?p+'index.html':p,(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html'});r.end(b)})}).listen(8765);
const map=u=>{
 if(u.includes('three@0.186.0/build/three.module.js'))return nm+'/three/build/three.module.js';
 if(u.includes('three@0.186.0/build/three.webgpu.js'))return nm+'/three/build/three.webgpu.js';
 if(u.includes('three.core.js'))return nm+'/three/build/three.core.js';
 if(u.includes('dicom-parser'))return nm+'/dicom-parser/dist/dicomParser.min.js';
 if(u.includes('fflate'))return nm+'/fflate/esm/browser.js';
 return null};
const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{})});const pg=await b.newPage();pg.setDefaultTimeout(0);
pg.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('console.'+m.type()+':',m.text().slice(0,300))});
pg.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR:',String(e).slice(0,500))});
await pg.route(/^https:\/\//,async rt=>{const u=rt.request().url(),f=map(u);
 if(f){let body=fs.readFileSync(f,'utf8');if(u.includes('dicom-parser'))body='const require=()=>({});const module={exports:{}};const exports=module.exports;\n'+body+'\nexport default (module.exports.default||module.exports||window.dicomParser);';
  return rt.fulfill({status:200,contentType:'text/javascript',body})}
 if(u.includes('three-mesh-bvh')||u.includes('cornerstone'))return rt.fulfill({status:200,contentType:'text/javascript',body:'export const MeshBVH=class{};export const acceleratedRaycast=()=>{};export const computeBoundsTree=()=>{};export const disposeBoundsTree=()=>{};export default {};'});
 return rt.abort()});
await pg.goto('http://localhost:8765/index.html');await pg.waitForTimeout(3000);
await pg.click('#sample-demo-button');await pg.click('[data-sample-set="sample1"]');
const idle=async(ms=300000)=>{const t0=Date.now();while(Date.now()-t0<ms){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>4000)break;await pg.waitForTimeout(500)}};
await idle();
const FILTER=process.env.FILTER||'';
const r=await pg.evaluate(async(FILTER)=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,sr,rl,sg]=await Promise.all([im('state.js'),im('segment-runs.js'),im('run-length.js'),im('segments.js')]);
 const sel=document.getElementById('segment-add-select'),btn=document.getElementById('segment-add-button');sel.value='fat';sel.dispatchEvent(new Event('change'));btn.click();
 if(FILTER){const fs=document.getElementById('filter-add-select'),fb=document.getElementById('filter-add-button');fs.value=FILTER;fs.dispatchEvent(new Event('change'));fb.click()}
 await new Promise(r=>setTimeout(r,3000));
 const vol=st.current3DVolume||st.volume,w=vol.columns,h=vol.rows,d=vol.slices;
 const seg=sg.segmentState.fat;
 const t0=performance.now();const runs=await sr.getFinalSegmentRuns('fat',vol);const t1=performance.now();
 const comps=rl.componentsFromRuns(runs,w,h,d);const R=comps[0];
 // per slice masks: F (segment), R (largest component)
 const sliceMask=(rr,z)=>{const m=new Uint8Array(w*h),rec=rr[z];if(rec)for(let i=0;i<rec.length;i+=3){const o=rec[i]*w;m.fill(1,o+rec[i+1],o+rec[i+2]+1)}return m};
 let fNotR=0,adj6=0,adj26only=0,far=0;
 let Rm=[null,sliceMask(R.runsBySlice,0),d>1?sliceMask(R.runsBySlice,1):null];
 for(let z=0;z<d;z++){
  const F=sliceMask(runs,z),Rz=Rm[1],Rp=Rm[0],Rn=Rm[2];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!F[i]||Rz[i])continue;fNotR++;
   const g=(m,xx,yy)=>m&&xx>=0&&yy>=0&&xx<w&&yy<h&&m[yy*w+xx];
   if(g(Rz,x-1,y)||g(Rz,x+1,y)||g(Rz,x,y-1)||g(Rz,x,y+1)||g(Rp,x,y)||g(Rn,x,y)){adj6++;continue}
   let a=false;for(let dz=-1;dz<=1&&!a;dz++){const m=dz<0?Rp:dz>0?Rn:Rz;for(let dy=-1;dy<=1&&!a;dy++)for(let dx=-1;dx<=1;dx++)if(g(m,x+dx,y+dy)){a=true;break}}
   if(a)adj26only++;else far++}
  Rm=[Rz,Rn,z+2<d?sliceMask(R.runsBySlice,z+2):null];
 }
 return{filter:FILTER,seg:{min:seg.min,max:seg.max,opening:seg.opening,closing:seg.closing,minComponent:seg.minComponent},finalVoxels:rl.analysisRunsVoxelCount(runs),runsMs:Math.round(t1-t0),components:comps.length,largest:R.voxels,second:comps[1]?.voxels||0,fNotR,adj6,adj26only,far};
},FILTER);
console.log(JSON.stringify(r));
await b.close();srv.close();
