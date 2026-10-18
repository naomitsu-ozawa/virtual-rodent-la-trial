// Sigmoid (build 436): practice data, the filter on the fat / soft-tissue border (centre −30 HU, width 200, strength 0.5).
// The 2D plane values with the filter equal the formula applied to the values at strength 0 (= unfiltered), every value
// outside centre ± width/2 is unchanged, and the share of voxels in the blurred band (−80 … 20 HU) drops. Then the
// defaults (centre 0, width 300, strength 0.5): no value moves by more than width/2 and the body does not turn white in
// a −300…300 window (share of body pixels above 300 HU unchanged; the pre-436 filter moved −110 → +119, 40 → +398).
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/sigmoid-check.mjs
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
const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{})});const pg=await b.newPage();
pg.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('console.'+m.type()+':',m.text().slice(0,300))});
pg.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR:',String(e).slice(0,500))});
await pg.route(/^https:\/\//,async rt=>{const u=rt.request().url(),f=map(u);
 if(f){let body=fs.readFileSync(f,'utf8');if(u.includes('dicom-parser'))body='const require=()=>({});const module={exports:{}};const exports=module.exports;\n'+body+'\nexport default (module.exports.default||module.exports||window.dicomParser);';
  return rt.fulfill({status:200,contentType:'text/javascript',body})}
 if(u.includes('three-mesh-bvh')||u.includes('cornerstone'))return rt.fulfill({status:200,contentType:'text/javascript',body:'export const MeshBVH=class{};export const acceleratedRaycast=()=>{};export const computeBoundsTree=()=>{};export const disposeBoundsTree=()=>{};export default {};'});
 return rt.abort()});
await pg.goto('http://localhost:8765/index.html');await pg.waitForTimeout(3000);
await pg.click('#sample-demo-button');await pg.click('[data-sample-set="sample1"]');
const idle=async()=>{const t0=Date.now();while(Date.now()-t0<240000){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>1500)break;await pg.waitForTimeout(250)}};
await idle();
const r=await pg.evaluate(async()=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,sf,seg]=await Promise.all([im('state.js'),im('source-filters.js'),im('segment-ui.js')]);
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),idle=async()=>{await wait(1500);for(let t=Date.now();Date.now()-t<240000;){await wait(300);if(!window.__vrlBusyModal?.().active)break}};
 const fa=document.getElementById('filter-add-select');fa.value='sigmoid';fa.dispatchEvent(new Event('change'));document.getElementById('filter-add-button').click();await idle();
 const set=(id,x)=>seg.setControlValue(document.getElementById(id),x);
 const C=-30,W=200,S=0.5;set('sigmoid-center',C);set('sigmoid-width',W);set('sigmoid-strength',0);await idle();
 const vol=st.sourceVolume||st.volume,series=vol.series,idx=Math.floor(series.slices.length/2);
 const grab=async()=>Float32Array.from(await sf.getFilteredSourcePlaneValues('axial',idx,series,'chk'));
 const params=sf.sourceFilterStages().find(s=>s.key==='sigmoid')?.params;
 const raw=await grab();set('sigmoid-strength',S);await idle();const out=await grab();const params2=sf.sourceFilterStages().find(s=>s.key==='sigmoid')?.params;
 const c=params2.center,hw=W/2,g=S*6,f=x=>{const t=(x-c)/hw;return t>-1&&t<1?c+hw*Math.tanh(g*t)/Math.tanh(g):x}; // the slider snaps the centre to its step
 let maxErr=0,outsideChanged=0,bandBefore=0,bandAfter=0,fat=0,soft=0,fatA=0,softA=0;
 for(let i=0;i<raw.length;i++){const a=raw[i],b=out[i];maxErr=Math.max(maxErr,Math.abs(f(a)-b));if(Math.abs(a-c)>=hw&&a!==b)outsideChanged++;
  if(a>=-80&&a<=20)bandBefore++;if(b>=-80&&b<=20)bandAfter++;if(a>=-130&&a<-80)fat++;if(b>=-130&&b<-80)fatA++;if(a>20&&a<=70)soft++;if(b>20&&b<=70)softA++}
 // defaults (the slider values a new Sigmoid starts with)
 set('sigmoid-center',0);set('sigmoid-width',300);await idle();const out3=await grab();const params3=sf.sourceFilterStages().find(s=>s.key==='sigmoid')?.params;
 let maxShift=0,whiteBefore=0,whiteAfter=0,body=0;for(let i=0;i<raw.length;i++){if(raw[i]<-500)continue;body++;maxShift=Math.max(maxShift,Math.abs(out3[i]-raw[i]));if(raw[i]>300)whiteBefore++;if(out3[i]>300)whiteAfter++}
 const defaults={params:params3,maxShift:Math.round(maxShift),whiteBefore:+(100*whiteBefore/body).toFixed(2),whiteAfter:+(100*whiteAfter/body).toFixed(2)};
 return{defaults,params,params2,n:raw.length,maxErr,outsideChanged,bandBefore,bandAfter,fatBefore:fat,fatAfter:fatA,softBefore:soft,softAfter:softA,center:[c,f(c)]};
});
console.log(JSON.stringify(r));
const ok=r.params?.strength===0&&r.params2?.width===200&&r.maxErr<0.01&&r.outsideChanged===0&&r.bandAfter<r.bandBefore&&r.defaults.params?.width===300&&Math.abs(r.defaults.params?.center)<=10&&r.defaults.maxShift<=150&&r.defaults.whiteAfter===r.defaults.whiteBefore;
await b.close();srv.close();
if(errors.length||!ok){console.error('sigmoid check FAILED');process.exit(1)}console.log('sigmoid check OK');
