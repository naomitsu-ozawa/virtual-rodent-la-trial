// 2D / 3D edit consistency on the practice data (build 414): opens docs/demo/sample1, adds the fat segment with
// SURFACE=<mm> "exclude next to air" (default 0.3), applies an exclusion edit (a box) the way the volume-view edits do
// (excludeRuns + finalRuns reset + syncGpuVolumeEdits), then changes the air exclusion again; after each step compares
// the runs the 2D views draw (activeMprSegments: processedRuns / finalRuns) with the runs the 3D volume gets
// (gpuVolumeEditDescriptors keep mask, or base − exclude). Mismatched voxels must be 0.
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/edit-consistency-check.mjs
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
const r=await pg.evaluate(async(SURF)=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,sg,gv,rl,sr]=await Promise.all([im('state.js'),im('segments.js'),im('gpu-volume-data.js'),im('run-length.js'),im('segment-runs.js')]);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const settle=async()=>{for(let i=0;i<600;i++){await wait(200);const s=window.__vrlBusyModal();if(!s.active&&!sg.segmentEditState.fat.pendingBase)break}await wait(1500)};
 const sel=document.getElementById('segment-add-select'),btn=document.getElementById('segment-add-button');sel.value='fat';sel.dispatchEvent(new Event('change'));btn.click();await wait(1500);
 const surf=document.querySelector('[data-seg-surface-mm="fat"]');
 const setSurf=async mm=>{surf.value=String(mm);surf.dispatchEvent(new Event('input'));surf.dispatchEvent(new Event('change'));await settle()};
 const vol=st.current3DVolume||st.volume,d=vol.slices,es=sg.segmentEditState.fat;
 const cmp=label=>{
  const two=sg.activeMprSegments().find(x=>x.key==='fat'),runs2d=two?.processedRuns||(sg.segmentEditActive('fat')&&two?.edit.finalRuns)||null;
  const desc=gv.gpuVolumeEditDescriptors(vol).fat;let runs3d=null;
  if(desc?.mode==='keep')runs3d=desc.runs;else if(es.baseRuns)runs3d=desc?.mode==='exclude'?rl.subtractRunArrays(es.baseRuns,desc.runs,d):es.baseRuns;
  // no processing and no edits: both views threshold the same HU range, nothing to compare
  if(!runs2d||!runs3d)return{label,runs2d:!!runs2d,runs3d:!!runs3d,surfaceMm:sg.segmentState.fat.surfaceMm,plain:!sg.segmentEditActive('fat')&&!sg.segmentNeedsGlobalMask(sg.segmentState.fat)};
  const a=rl.analysisRunsVoxelCount(rl.subtractRunArrays(runs2d,runs3d,d)),b=rl.analysisRunsVoxelCount(rl.subtractRunArrays(runs3d,runs2d,d));
  return{label,surfaceMm:sg.segmentState.fat.surfaceMm,only2d:a,only3d:b,voxels3d:rl.analysisRunsVoxelCount(runs3d)};
 };
 const out=[];
 await setSurf(SURF);out.push(cmp('air exclusion '+SURF+' mm'));
 // exclusion edit: a box through the middle (as applyEditRemoveSelected / cuts do in the volume view)
 const box=new Array(d).fill(null);for(let z=200;z<=320;z++){const a=[];for(let y=150;y<=350;y++)a.push(y,150,350);box[z]=new Uint32Array(a)}
 es.excludeRuns=rl.unionRunArrays(es.excludeRuns,box,d);es.finalRuns=null;es.revision++;gv.syncGpuVolumeEdits(st.sourceVolume||st.volume);await settle();
 out.push(cmp('after exclusion edit'));
 await setSurf(SURF*2);out.push(cmp('air exclusion changed to '+SURF*2+' mm (edit kept)'));
 const mn=document.querySelector('[data-seg-min="fat"]'),mx=document.querySelector('[data-seg-max="fat"]');
 const slide=async(el,val)=>{el.value=String(val);el.dispatchEvent(new Event('input'));await wait(50);el.dispatchEvent(new Event('change'));await settle()};
 const modalSeen=[];const watch=setInterval(()=>{const s=window.__vrlBusyModal?.();if(s?.visible)modalSeen.push(s.label)},100);
 await slide(mn,-200);await slide(mx,-80);clearInterval(watch);
 out.push({...cmp('CT range changed to −200..−80'),segMin:sg.segmentState.fat.min,segMax:sg.segmentState.fat.max,modal:[...new Set(modalSeen)],stuck:window.__vrlBusyModal?.().active});
 // filter added (Spatial Filter 3D) with the edit and the processing in place: what 2D draws and what 3D gets must
 // equal the final runs freshly computed for the new filter, and analysis results made before must not survive
 const [ops]=await Promise.all([im('analysis-ops.js')]);
 const boxR=new Array(d).fill(null);for(let z=330;z<=340;z++){const a=[];for(let y=200;y<=210;y++)a.push(y,200,220);boxR[z]=new Uint32Array(a)}
 await ops.addAnalysisRegion(vol,{key:'fat',segmentKeys:['fat'],runsBySlice:boxR,voxels:2541,mm3:1});const regionsBefore=st.analysisRegions.length;
 const fs=document.getElementById('filter-add-select'),fb=document.getElementById('filter-add-button');fs.value='gaussian';fs.dispatchEvent(new Event('change'));fb.click();
 await wait(3000);await settle();await wait(3000);await settle();
 const staleBase=es.baseRuns&&es.baseSignature!==sr.segmentBaseSignature('fat',vol);
 const truth=await sr.ensureSegmentBaseRuns('fat',vol,null,true).then(b=>{let r=b;if(es.keepRuns)r=rl.intersectRunArrays(r,es.keepRuns,d);if(es.excludeRuns)r=rl.subtractRunArrays(r,es.excludeRuns,d);return r});
 await settle();
 const two=sg.activeMprSegments().find(x=>x.key==='fat'),runs2d=two?.processedRuns||(sg.segmentEditActive('fat')&&two?.edit.finalRuns)||null,desc=gv.gpuVolumeEditDescriptors(vol).fat;
 // 3D: a keep mask, or (plain segment) the threshold = base runs minus the exclusion
 const runs3dOf=desc=>desc?.mode==='keep'?desc.runs:es.baseRuns?(desc?.mode==='exclude'?rl.subtractRunArrays(es.baseRuns,desc.runs,d):es.baseRuns):null;
 const diff=(a,b)=>a&&b?rl.analysisRunsVoxelCount(rl.subtractRunArrays(a,b,d))+rl.analysisRunsVoxelCount(rl.subtractRunArrays(b,a,d)):null;
 out.push({label:'filter added (gaussian)',staleBaseBeforeRecompute:!!staleBase,mismatch2dTruth:diff(runs2d,truth),mismatch3dTruth:diff(runs3dOf(desc),truth),regionsBefore,regionsAfter:st.analysisRegions.length,only2d:diff(runs2d,truth)??-1,only3d:diff(runs3dOf(desc),truth)??-1});
 return out;
},+(process.env.SURFACE??0.3));
for(const x of r)console.log(JSON.stringify(x));
const bad=r.some(x=>x.stuck||x.staleBaseBeforeRecompute||(x.regionsAfter>0)||(x.only2d==null?!x.plain:(x.only2d!==0||x.only3d!==0)));
await b.close();srv.close();
if(errors.length||bad){console.error('edit consistency check FAILED');process.exit(1)}console.log('edit consistency check OK');
