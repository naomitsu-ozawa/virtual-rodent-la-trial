// 2D colour strength setting (build 430): practice data, fat segment; the 2D view's pixels at the default (65 %)
// use the pre-430 formula (checked for the opacity steps), 30 % and 100 % change the image, and back to 65 % restores
// the image exactly.
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/mpr-alpha-check.mjs
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
const idle=async()=>{const t0=Date.now();while(Date.now()-t0<180000){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>1500)break;await pg.waitForTimeout(250)}};
await idle();
const r=await pg.evaluate(async()=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [as,sg]=await Promise.all([im('app-settings.js'),im('segments.js')]);
 const add=document.getElementById('segment-add-select'),btn=document.getElementById('segment-add-button');if(add&&!btn.disabled){add.value='fat';add.dispatchEvent(new Event('change'));btn.click()}
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(2500);
 const cv=[...document.querySelectorAll('canvas')].filter(c=>c.width>64&&c.getContext&&c.closest('.mpr, .plane, [data-plane], .view-2d, .mpr-view')||false);
 const all=cv.length?cv:[...document.querySelectorAll('canvas')].filter(c=>{try{return c.width>64&&!!c.getContext('2d')}catch{return false}});
 const grab=()=>all.map(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.slice());
 const put=async x=>{as.settings.set('mpr2dAlpha',x);await wait(2500)};
 const diff=(a,b)=>a.reduce((n,d,i)=>{let k=0;for(let j=0;j<d.length;j+=4)if(d[j]!==b[i][j]||d[j+1]!==b[i][j+1]||d[j+2]!==b[i][j+2])k++;return n+k},0);
 // the pre-430 formula against the new function, for every opacity step the slider can give
 const formula=[0,0.05,0.25,0.5,0.75,1].every(o=>Math.min(.75,o*.65)===sg.mprSegmentAlpha({opacity:o}));
 await put('0.65');const a=grab();await put('0.3');const b=grab();await put('1');const c=grab();await put('0.65');const d=grab();
 const fat=sg.segmentState.fat;return{canvases:all.length,opacity:fat.opacity,formula,changed30:diff(a,b),changed100:diff(a,c),restored:diff(a,d)};
});
console.log(JSON.stringify(r));
const ok=r.canvases>0&&r.formula&&r.changed30>0&&r.changed100>0&&r.restored===0;
await b.close();srv.close();
if(errors.length||!ok){console.error('mpr alpha check FAILED');process.exit(1)}console.log('mpr alpha check OK');
