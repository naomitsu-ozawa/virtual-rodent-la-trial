// Progress modal check (build 405): as boot-check (docs/ served, CDN imports from node_modules), then
// opens the practice data (docs/demo/sample1) and watches the central progress modal: it must show
// up (the load takes longer than the delay), block input (pointer-events auto) while shown, and be
// gone with no job left running at the end. Screenshots of the modal at desktop and iPad size.
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/progress-modal-check.mjs [outDir]
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
const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{})});const outDir=process.argv[2]||'.';
const pg=await b.newPage({viewport:{width:1280,height:800}});
pg.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('console.'+m.type()+':',m.text().slice(0,300))});
pg.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR:',String(e).slice(0,500))});
await pg.route(/^https:\/\//,async rt=>{const u=rt.request().url(),f=map(u);
 if(f){let body=fs.readFileSync(f,'utf8');if(u.includes('dicom-parser'))body='const require=()=>({});const module={exports:{}};const exports=module.exports;\n'+body+'\nexport default (module.exports.default||module.exports||window.dicomParser);';
  return rt.fulfill({status:200,contentType:'text/javascript',body})}
 if(u.includes('three-mesh-bvh')||u.includes('cornerstone'))return rt.fulfill({status:200,contentType:'text/javascript',body:'export const MeshBVH=class{};export const acceleratedRaycast=()=>{};export const computeBoundsTree=()=>{};export const disposeBoundsTree=()=>{};export default {};'});
 return rt.abort()});
await pg.goto('http://localhost:8765/index.html');await pg.waitForTimeout(3000);
const st=()=>pg.evaluate(()=>{const s=window.__vrlBusyModal?.()||{},el=document.getElementById('job-modal');return{...s,pe:el?getComputedStyle(el).pointerEvents:'',shown:!!el&&!el.classList.contains('is-hidden')}});
const t0=Date.now();await pg.click('#sample-demo-button');await pg.click('[data-sample-set="sample1"]');
let seen=0,labels=new Set(),blocked=true,shot=false,idleSince=0,last=null;
while(Date.now()-t0<180000){
 const s=await st();last=s;
 if(s.shown){seen++;labels.add(s.label);if(s.pe!=='auto')blocked=false;
  if(!shot&&s.label.includes('·')){await pg.screenshot({path:outDir+'/progress-modal-desktop.png'});shot=true}}
 if(!s.active&&!s.shown&&Date.now()-t0>3000){if(!idleSince)idleSince=Date.now();if(Date.now()-idleSince>3000)break}else idleSince=0;
 await pg.waitForTimeout(100);
}
const end=await st();
console.log('modal seen in',seen,'polls; labels:',[...labels].join(' | ')||'-','; blocks input:',blocked,'; at the end: shown',end.shown,'active',end.active,'; '+((Date.now()-t0)/1000).toFixed(1)+' s');
const ok=seen>0&&blocked&&!end.shown&&!end.active;
// real processing paths on the loaded data: add a filter (NLM: CPU work) and a segment, watch the modal for 60 s each
const watch=async ms=>{const seen=new Set();const t=Date.now();let idle=0;while(Date.now()-t<ms){const x=await st();if(x.shown)seen.add(x.name+': '+x.label);if(!x.active&&!x.shown){if(!idle)idle=Date.now();if(Date.now()-idle>2500&&Date.now()-t>3000)break}else idle=0;await pg.waitForTimeout(100)}const e=await st();return{seen:[...seen],endActive:e.active,endShown:e.shown,s:((Date.now()-t)/1000).toFixed(1)}};
for(const [what,sel,val] of [['filter NLM','#filter-add-select','nlm'],['segment bone','#segment-add-select','bone']]){
 const ok=await pg.evaluate(([sel,val,btn])=>{const s=document.querySelector(sel),b=document.querySelector(btn);if(!s||!b||s.disabled||b.disabled)return false;s.value=val;s.dispatchEvent(new Event('change'));b.click();return true},[sel,val,sel.replace('-select','-button')]);
 if(!ok){console.log(what+': skipped (control disabled)');continue}
 const r=await watch(90000);console.log(what+':',JSON.stringify(r));if(r.endActive||r.endShown)errors.push(what+': job left running');
}
// 3D rebuild with 中断: the modal shows the 'three' job with a cancel button; pressing it ends the job
let rebuild='skipped (button disabled)';
if(await pg.evaluate(()=>{const b=document.getElementById('filter-rebuild-3d');if(!b||b.disabled)return false;b.click();return true})){
 let s3=null;const t1=Date.now();while(Date.now()-t1<20000){s3=await st();if(s3.shown&&s3.name==='three')break;if(!s3.active&&Date.now()-t1>3000)break;await pg.waitForTimeout(100)}
 if(!(s3?.shown&&s3.name==='three'))rebuild='no modal (rebuild ended within '+((Date.now()-t1)/1000).toFixed(1)+' s)';
 else{const btn=await pg.evaluate(()=>{const b=document.querySelector('#job-modal .job-button');return b&&!b.classList.contains('is-hidden')?b.textContent:''});
  await pg.click('#job-modal .job-button');const t2=Date.now();let e=null;while(Date.now()-t2<30000){e=await st();if(!e.shown)break;await pg.waitForTimeout(100)}
  rebuild='modal "'+s3.label+'", button "'+btn+'", after 中断: '+(e.shown?'STILL SHOWN':'closed in '+((Date.now()-t2)/1000).toFixed(1)+' s');if(e.shown)errors.push('modal still shown after cancel')}}
console.log('3D rebuild:',rebuild);
// the 3D adapter directly (no WebGPU here, so no real 3D job): set3DBusy shows the modal; without a running rebuild
// there is no 中断 (its handler stops only a rebuild), and the job ends cleanly
const three=await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,m=await import('./three-status.js'+v);
 m.set3DBusy(true,'3D check');await new Promise(r=>setTimeout(r,600));const b=document.querySelector('#job-modal .job-button'),vv=window.__vrlBusyModal();const btn=b&&!b.classList.contains('is-hidden')?b.textContent:'';
 m.set3DBusy(false);await new Promise(r=>setTimeout(r,50));return{shown:vv.visible,label:vv.label,btn,after:window.__vrlBusyModal()}});
console.log('set3DBusy: shown',three.shown,'label',three.label,'button',JSON.stringify(three.btn),'after: shown',three.after.visible,'active',three.after.active);
if(!three.shown||three.after.visible||three.after.active)errors.push('3D adapter check failed');
// VR preparation: runs in the modal ('vr'), then the page panel shows up with the start button
const vr=await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,m=await import('./vr-view.js'+v);
 m.showPreparePanel({language:'ja',mode:'vr',onStart:()=>{}});const t0=performance.now();let seen=false,label='';
 while(performance.now()-t0<120000){const s=window.__vrlBusyModal(),p=document.getElementById('vr-prepare-panel');if(s.visible&&s.name==='vr'){seen=true;label=s.label}
  if(p&&p.style.display!=='none'&&!s.active)return{seen,label,panel:true,start:!p.querySelector('.start').disabled,ph:p.querySelector('.ph').textContent,s:((performance.now()-t0)/1000).toFixed(1)};
  await new Promise(r=>setTimeout(r,100))}
 return{seen,label,panel:false}});
console.log('VR preparation:',JSON.stringify(vr));
if(!vr.panel)errors.push('VR panel did not appear');
// a short job never shows: open and close a slot within the delay
const short=await pg.evaluate(async()=>{const m=await import('./progress-modal.js'+new URL(document.querySelector('script[src*="app.js"]').src).search);m.setBusySlot('check',true,{label:'short'});await new Promise(r=>setTimeout(r,150));const a=window.__vrlBusyModal().visible;m.setBusySlot('check',false);await new Promise(r=>setTimeout(r,500));return{during:a,after:window.__vrlBusyModal().visible}});
console.log('short job: shown during',short.during,'after',short.after);
// iPad-size screenshot on a fresh page laid out at that size (a synthetic job with a bar)
{const p2=await b.newPage({viewport:{width:820,height:1180},deviceScaleFactor:1});await p2.route(/^https:\/\//,rt=>rt.abort());
 await p2.goto('http://localhost:8765/index.html');await p2.waitForTimeout(2500);
 await p2.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,m=await import('./progress-modal.js'+v);m.setBusySlot('processing',true,{label:'Fast NLM 3D を適用中…',counted:true});m.reportBusyProgress('processing',96,256,'96 / 256')});
 await p2.waitForTimeout(700);await p2.screenshot({path:outDir+'/progress-modal-ipad.png'});await p2.close()}
await b.close();srv.close();
if(errors.length||!ok||short.during||short.after){console.error('progress modal check FAILED');process.exit(1)}console.log('progress modal check OK');
