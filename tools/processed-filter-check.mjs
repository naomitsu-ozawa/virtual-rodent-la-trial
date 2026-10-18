// Processed segments follow the filters (build 433): practice data, fat segment; base-run voxel counts plain / Opening 1,
// without and with a Gaussian filter. Before 433 the Opening segment came from the unfiltered in-memory MPR copy, so the
// Gaussian did not change it (4086436 both times).
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/processed-filter-check.mjs
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
 const [st,seg,sr,rl,sg]=await Promise.all([im('state.js'),im('segment-ui.js'),im('segment-runs.js'),im('run-length.js'),im('segments.js')]);
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),idle=async()=>{await wait(1500);for(let t=Date.now();Date.now()-t<600000;){await wait(300);if(!window.__vrlBusyModal?.().active)break}};
 const add=document.getElementById('segment-add-select');add.value='fat';add.dispatchEvent(new Event('change'));document.getElementById('segment-add-button').click();await idle();
 const vol=st.current3DVolume||st.volume;const count=async()=>rl.analysisRunsVoxelCount(await sr.ensureSegmentBaseRuns('fat',vol));
 const out={mprData:!!vol.mprData,fat:{min:sg.segmentState.fat.min,max:sg.segmentState.fat.max}};
 out.plainRaw=await count();
 seg.setControlValue(seg.segmentControl('opening','fat'),1);await idle();out.openRaw=await count();
 seg.setControlValue(seg.segmentControl('opening','fat'),0);await idle();
 const fa=document.getElementById('filter-add-select');fa.value='gaussian';fa.dispatchEvent(new Event('change'));document.getElementById('filter-add-button').click();await idle();
 out.plainGauss=await count();
 seg.setControlValue(seg.segmentControl('opening','fat'),1);await idle();out.openGauss=await count();
 return out;
});
console.log(JSON.stringify(r));
const ok=r.plainGauss!==r.plainRaw&&r.openGauss!==r.openRaw&&r.openGauss>0;
await b.close();srv.close();
if(errors.length||!ok){console.error('processed filter check FAILED');process.exit(1)}console.log('processed filter check OK');
