// Analysis result colour in 2D (build 419): practice data, fat segment, its largest component as the result; each
// plane (axial / coronal / sagittal at the volume centre) is painted without and with the result, and the changed
// pixels must be exactly the result's voxels on that plane (runsPlaneMask), no more, no fewer.
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/result-2d-check.mjs
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
const t0=Date.now();while(Date.now()-t0<300000){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>4000)break;await pg.waitForTimeout(500)}
const r=await pg.evaluate(async()=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,ui,mr,rl,sr,ops,sgu,sf]=await Promise.all([im('state.js'),im('ui-shell.js'),im('mpr-render.js'),im('run-length.js'),im('segment-runs.js'),im('analysis-ops.js'),im('segment-ui.js'),im('source-filters.js')]);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const sel=document.getElementById('segment-add-select'),btn=document.getElementById('segment-add-button');sel.value='fat';sel.dispatchEvent(new Event('change'));btn.click();await wait(2000);
 const vol=st.current3DVolume||st.volume,w=vol.columns,h=vol.rows,d=vol.slices;
 const runs=await sr.getFinalSegmentRuns('fat',vol),comp=rl.componentsFromRuns(runs,w,h,d)[0];
 const out={};
 for(const p of ['axial','coronal','sagittal']){
  const idx=p==='axial'?(d>>1):p==='coronal'?(h>>1):(w>>1);ui.planes[p].slider.value=String(idx);
  const grab=async()=>{await mr.renderPlane(p,++sf.planeRenderRevision[p],idx);await wait(300);const c=ui.planes[p].canvas;return{w:c.width,h:c.height,px:c.getContext('2d').getImageData(0,0,c.width,c.height).data}};
  sgu.clearAnalysisHighlight();const a=await grab();
  await ops.addAnalysisRegion(vol,{key:'fat',segmentKeys:['fat'],runsBySlice:comp.runsBySlice,voxels:comp.voxels,mm3:1});
  // a colour different from the fat colour
  st.analysisRegions[0].color=0x00ff00;const b2=await grab();
  const mask=rl.runsPlaneMask(comp.runsBySlice,p,idx,w,h,d);let changed=0,expected=0,extra=0,missing=0;
  for(let i=0;i<a.w*a.h;i++){const ch=a.px[i*4]!==b2.px[i*4]||a.px[i*4+1]!==b2.px[i*4+1]||a.px[i*4+2]!==b2.px[i*4+2];if(ch)changed++;if(mask[i])expected++;if(ch&&!mask[i])extra++;if(!ch&&mask[i])missing++}
  out[p]={idx,canvas:a.w+'x'+a.h,expected,changed,extra,missing};
  sgu.clearAnalysisHighlight();
 }
 return out;
});
console.log(JSON.stringify(r));
const bad=Object.values(r).some(x=>x.extra||x.missing||!x.expected);
await b.close();srv.close();
if(errors.length||bad){console.error('result 2d check FAILED');process.exit(1)}console.log('result 2d check OK');
