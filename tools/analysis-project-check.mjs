import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root=path.resolve('docs'),nm=path.resolve('node_modules');const errors=[];
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]));
 // the practice data's bundled project (docs/demo/sample1/project.vrlab) is applied on load; the checks start
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
const t0=Date.now();while(Date.now()-t0<180000){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>5000)break;await pg.waitForTimeout(250)}
const r=await pg.evaluate(async(FILTER)=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,ops,dl,pf,seg,sg,al]=await Promise.all([im('state.js'),im('analysis-ops.js'),im('data-load.js'),im('project-file.js'),im('segment-ui.js'),im('segments.js'),im('analysis-label.js')]);
 const add=document.getElementById('segment-add-select'),btn=document.getElementById('segment-add-button');if(add&&!btn.disabled){add.value='bone';add.dispatchEvent(new Event('change'));btn.click()}
 await new Promise(r=>setTimeout(r,500));
 const vol=st.current3DVolume||st.volume;if(!vol)return{error:'no volume'};
 const box=(z0,z1,y0,y1,x0,x1)=>{const runs=new Array(vol.slices).fill(null);for(let z=z0;z<=z1;z++){const a=[];for(let y=y0;y<=y1;y++)a.push(y,x0,x1);runs[z]=new Int32Array(a)}return runs};
 let boxA=box(200,209,200,209,200,219),boxB=box(300,304,100,104,100,104),nA=2000,nB=125;
 if(FILTER){
  // a processed segment (opening 1) and results that are part of it (box ∩ final runs), so the load's recompute keeps them
  const fa=document.getElementById('filter-add-select');fa.value='gaussian';fa.dispatchEvent(new Event('change'));document.getElementById('filter-add-button').click();
  await new Promise(r=>setTimeout(r,1500));for(let t=Date.now();Date.now()-t<240000;){await new Promise(r=>setTimeout(r,500));if(!window.__vrlBusyModal?.().active)break}
  seg.setControlValue(seg.segmentControl('opening','bone'),1);await new Promise(r=>setTimeout(r,1500));
  for(let t=Date.now();Date.now()-t<240000;){await new Promise(r=>setTimeout(r,500));if(!window.__vrlBusyModal?.().active)break}
  const [sr,rl]=await Promise.all([im('segment-runs.js'),im('run-length.js')]),fin=await sr.getFinalSegmentRuns('bone',vol);
  const cut=b=>rl.intersectRunArrays(b,fin,vol.slices),cnt=b=>rl.analysisRunsVoxelCount(b);
  // boxes where the bone is: around its first voxels
  const z0=fin.findIndex(r=>r&&r.length),r0=fin[z0+5];const y=r0[0],x=r0[1];
  boxA=cut(box(z0+5,z0+14,y-10,y+10,x-10,x+20));const zb=fin.findIndex((r,z)=>z>z0+20&&r&&r.length),rb=fin[zb];boxB=cut(box(zb,zb+4,rb[0]-5,rb[0]+5,rb[1]-5,rb[1]+5));nA=cnt(boxA);nB=cnt(boxB)}
 await ops.addAnalysisRegion(vol,{key:'bone',segmentKeys:['bone'],runsBySlice:boxA,voxels:nA,mm3:1});
 await ops.addAnalysisRegion(vol,{key:'bone',segmentKeys:['bone'],runsBySlice:boxB,voxels:nB,mm3:1});
 st.analysisRegions[1].visible=false;
 // the first result has a MOVED label (anchor + offset, voxel units), the second a label at its default place; an old project has none
 al.setRegionLabel(st.analysisRegions[0],{anchor:{i:210,j:205,k:205},offset:{i:12.5,j:-8,k:30}});al.setRegionLabel(st.analysisRegions[1],{anchor:{i:102,j:102,k:302}});
 const before=st.analysisRegions.map(r=>({color:r.color,visible:r.visible,voxels:r.voxels,key:r.key,label:r.label||null}));
 const {project,binaries}=dl.gatherProject(),bytes=pf.packProject(project,binaries),un=pf.unpackProject(bytes);
 seg.clearAnalysisHighlight();const cleared=st.analysisRegions.length;
 await dl.applyProject(un);
 await new Promise(r=>setTimeout(r,3000)); // a delayed clear (debounced segment invalidation) would show here
 // the load's own work (filter rebuild, segment recompute) must have ended before the results are compared
 for(let t=Date.now();Date.now()-t<240000;){await new Promise(r=>setTimeout(r,500));if(!window.__vrlBusyModal?.().active&&!document.querySelector('[data-filter-busy]'))break}
 await new Promise(r=>setTimeout(r,3000));
 const after=st.analysisRegions.map(r=>({color:r.color,visible:r.visible,voxels:r.voxels,key:r.key,label:r.label||null}));
 // deletion linked: exclude half of the first box, trim the results to the edit
 const refs=ops.snapshotAnalysisRegionsForSegment('bone'),es=sg.segmentEditState.bone;es.excludeRuns=box(200,204,200,209,200,219);
 await ops.trimAnalysisRegionsAfterEdit('bone',refs);const trimmed=st.analysisRegions.map(r=>r.voxels),trimLabels=st.analysisRegions.map(r=>r.label||null);es.excludeRuns=null;
 // VR: the visible result goes into the region index (one colour), and the programs with VRL_REGIONS compile
 const vr=await im('vr-view.js');const P=await vr.prepareVrData();const g=await vr.prepareVrGpu(P,'vr');
 const rids=(P.region?.list||[]).map(e=>e.rid),reg={ids:P.region?.ids?P.region.ids.reduce((a,x)=>a+(x===1?1:0),0):0,data:!!P.region?.data,colors:P.region?.colors?.length||0,list:P.region?.list?.length||0,set:P.region?.data?P.region.data.reduce((a,x)=>a+(x?1:0),0):0,gpu:!!g,programs:g?.warm?.length||0};
 // FILTER: a real filter change afterwards must still clear the results
 let afterChange=null;if(FILTER){const el=document.getElementById('gaussian-strength');const nv=String(+el.value===+el.max?+el.min:+el.max);el.value=nv;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,2000));for(let t=Date.now();Date.now()-t<240000;){await new Promise(r=>setTimeout(r,500));if(!window.__vrlBusyModal?.().active)break}
  await new Promise(r=>setTimeout(r,3000));afterChange=st.analysisRegions.length}
 return{filter:FILTER,afterChange,trimLabels,rids,regionIds:st.analysisRegions.map(r=>r.id),filters:st.filterOrder?.slice?.()||null,before,cleared,after,trimmed,reg,files:Object.keys(binaries).filter(k=>k.startsWith('analysis/')),bytes:bytes.byteLength};
},!!process.env.FILTER);
console.log(JSON.stringify(r));
const ok=!r.error&&r.cleared===0&&JSON.stringify(r.before)===JSON.stringify(r.after)&&r.files.length===2&&JSON.stringify(r.trimmed)===(r.filter?JSON.stringify(r.after.map(x=>x.voxels)):'[1000,125]')&&r.reg.data&&r.reg.colors===1&&r.reg.list===1&&r.reg.gpu&&r.reg.ids===r.reg.set&&(!r.filter||r.afterChange===0)
 // the labels (moved / default) survive save -> load and an edit's trim; VR's list knows each result's region id
 &&!!r.before[0].label?.offset&&!!r.before[1].label&&!r.before[1].label.offset&&JSON.stringify(r.trimLabels)===JSON.stringify(r.before.map(x=>x.label))&&r.rids.length===1&&r.rids[0]===r.regionIds[0];
await b.close();srv.close();
if(errors.length||!ok){console.error('analysis project check FAILED');process.exit(1)}console.log('analysis project check OK');
