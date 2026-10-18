// Shared plane selection (build 420): practice data; choosing axial / coronal / sagittal in the section analysis,
// the workspace 2D tabs, the 3D plane buttons and the main view must make all the others follow.
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/plane-sync-check.mjs
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
const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{})});const pg=await b.newPage({viewport:{width:1280,height:900}});pg.setDefaultTimeout(0);
pg.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('console.'+m.type()+':',m.text().slice(0,300))});
pg.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR:',String(e).slice(0,500))});
await pg.route(/^https:\/\//,async rt=>{const u=rt.request().url(),f=map(u);
 if(f){let body=fs.readFileSync(f,'utf8');if(u.includes('dicom-parser'))body='const require=()=>({});const module={exports:{}};const exports=module.exports;\n'+body+'\nexport default (module.exports.default||module.exports||window.dicomParser);';
  return rt.fulfill({status:200,contentType:'text/javascript',body})}
 if(u.includes('three-mesh-bvh')||u.includes('cornerstone'))return rt.fulfill({status:200,contentType:'text/javascript',body:'export const MeshBVH=class{};export const acceleratedRaycast=()=>{};export const computeBoundsTree=()=>{};export const disposeBoundsTree=()=>{};export default {};'});
 return rt.abort()});
await pg.goto('http://localhost:8765/index.html');await pg.waitForTimeout(3000);
await pg.click('#sample-demo-button');await pg.click('[data-sample-set="sample1"]');
const t0=Date.now();while(Date.now()-t0<300000){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>4000)break;await pg.waitForTimeout(500)}
const state=()=>pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,st=await import('./state.js'+v),mo=await import('./mpr3d-overlay.js'+v);
 const tab=document.querySelector('[data-ipad-mpr].is-active')?.dataset.ipadMpr||null,main=document.querySelector('#main-view-slot .view-card')?.dataset.viewKey||null;
 const q=st.sceneState?.obj?.quaternion,view=q?(Math.abs(q.w-1)<1e-6?'z':Math.abs(q.y+Math.SQRT1_2)<1e-6&&Math.abs(q.w-Math.SQRT1_2)<1e-6?'x':Math.abs(q.x-Math.SQRT1_2)<1e-6&&Math.abs(q.w-Math.SQRT1_2)<1e-6?'y':'other'):'no 3D object';
 return{section:st.sectionViewOpen?st.sectionViewPlane:null,reverse:st.sectionViewReverse,overlay:['axial','coronal','sagittal'].filter(k=>mo.mpr3DVisibility[k]),tab,main,view}});
const steps=[['section analysis: coronal','[data-section-view="coronal"]','coronal'],['workspace tab: sagittal','[data-ipad-mpr="sagittal"]','sagittal'],['3D plane button: axial (off → on)',null,'axial'],['main view: coronal','[data-view-main="coronal"]','coronal']];
const out=[];let bad=false;
// build 422: with the section closed, choose sagittal in the 2D tab, then open the section analysis: it must open on sagittal
await pg.evaluate(()=>document.querySelector('[data-ipad-mpr="sagittal"]')?.click());await pg.waitForTimeout(500);
await pg.evaluate(()=>document.getElementById('section-view-toggle')?.click());await pg.waitForTimeout(800);
{const s=await state();const ok=s.section==='sagittal'&&s.reverse===true&&s.tab==='sagittal';if(!ok)bad=true;out.push({label:'open section analysis after choosing sagittal',expect:'sagittal',...s,ok})}
await pg.evaluate(()=>document.getElementById('section-view-toggle')?.click());await pg.waitForTimeout(500);
for(const [label,sel,p] of steps){
 if(sel)await pg.evaluate(s=>document.querySelector(s)?.click(),sel);
 else await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,mo=await import('./mpr3d-overlay.js'+v);if(mo.mpr3DVisibility.axial)document.querySelector('[data-3d-overlay="axial"]').click();document.querySelector('[data-3d-overlay="axial"]').click()});
 await pg.waitForTimeout(800);const s=await state();
 const axis=p==='axial'?'z':p==='coronal'?'y':'x',ok=s.section===p&&s.reverse===true&&s.overlay.includes(p)&&s.tab===p&&(s.main==='3d'||s.main===p)&&(s.view==='no 3D object'||s.view===axis);if(!ok)bad=true;out.push({label,expect:p,...s,ok});
}
for(const x of out)console.log(JSON.stringify(x));
await b.close();srv.close();
if(errors.length||bad){console.error('plane sync check FAILED');process.exit(1)}console.log('plane sync check OK');
