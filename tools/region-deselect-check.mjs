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
const t0=Date.now();while(Date.now()-t0<180000){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>5000)break;await pg.waitForTimeout(250)}
const r=await pg.evaluate(async()=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,ops,dl,pf,seg,et,THREE]=await Promise.all([im('state.js'),im('analysis-ops.js'),im('data-load.js'),im('project-file.js'),im('segment-ui.js'),im('edit-tools.js'),import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js')]);
 const add=document.getElementById('segment-add-select'),btn=document.getElementById('segment-add-button');if(add&&!btn.disabled){add.value='bone';add.dispatchEvent(new Event('change'));btn.click()}
 await new Promise(r=>setTimeout(r,500));
 const vol=st.current3DVolume||st.volume;if(!vol)return{error:'no volume'};
 // the lasso only needs sceneState.obj's matrix: a bare Object3D stands in for the volume (no 3D build headless), as
 // plane-orientation-check
 const ss=st.sceneState;if(!ss.obj){const O3=Object.getPrototypeOf(ss.scene.constructor.prototype).constructor,o=new O3();ss.scene.add(o);ss.obj=o}
 if(!ss.obj)return{error:'no 3D object'};
 const W=vol.columns,H=vol.rows,D=vol.slices;
 const box=(z0,z1,y0,y1,x0,x1)=>{const runs=new Array(D).fill(null);for(let z=z0;z<=z1;z++){const a=[];for(let y=y0;y<=y1;y++)a.push(y,x0,x1);runs[z]=new Int32Array(a)}return runs};
 const q=f=>Math.round(f),b1=[q(D*.3),q(D*.3)+5,q(H*.2),q(H*.2)+5,q(W*.2),q(W*.2)+5],b2=[q(D*.7),q(D*.7)+5,q(H*.8),q(H*.8)+5,q(W*.8),q(W*.8)+5],b3=[q(D*.5),q(D*.5)+5,q(H*.2),q(H*.2)+5,q(W*.8),q(W*.8)+5];
 const rl=await im('run-length.js'),n=216;
 await ops.addAnalysisRegion(vol,{key:'bone',segmentKeys:['bone'],runsBySlice:rl.unionRunArrays(box(...b1),box(...b2),D),voxels:2*n,mm3:1,merged:true});
 await ops.addAnalysisRegion(vol,{key:'bone',segmentKeys:['bone'],runsBySlice:box(...b3),voxels:n,mm3:1});
 const ticks=()=>st.analysisRegions.map(r=>!!r.selected),total=()=>st.analysisRegions.reduce((a,r)=>a+rl.analysisRunsVoxelCount(r.runsBySlice),0);
 const out={start:ticks()};
 // click toggle on the second result
 const R2=st.analysisRegions[1];ops.toggleAnalysisRegionSelection(R2);out.toggleOff={ticks:ticks(),focused:st.analysisFocusedRegionId};
 ops.toggleAnalysisRegionSelection(R2);out.toggleOn={ticks:ticks(),focused:st.analysisFocusedRegionId===R2.id};
 // a camera and a loop around one box's projected corners
 const cam=new THREE.PerspectiveCamera(45,1,0.01,100);cam.position.set(0,0,7);cam.lookAt(0,0,0);cam.updateMatrixWorld(true);cam.updateProjectionMatrix();
 const canvas={getBoundingClientRect:()=>({left:0,top:0,width:800,height:800})};
 st.sceneState.obj.updateMatrixWorld(true);
 const vp=new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse),lasso=await im('lasso.js'),proj=lasso.makeVoxelProjector(vol,st.sceneState.obj.matrixWorld.elements,vp.elements,800,800);
 const loop=([z0,z1,y0,y1,x0,x1])=>{let a=1e9,b=1e9,c=-1e9,d=-1e9;for(const z of [z0,z1])for(const y of [y0,y1])for(const x of [x0,x1]){const p=proj(x,y,z);a=Math.min(a,p.x);b=Math.min(b,p.y);c=Math.max(c,p.x);d=Math.max(d,p.y)}a-=2;b-=2;c+=2;d+=2;return[{x:a,y:b},{x:c,y:b},{x:c,y:d},{x:a,y:d}]};
 const color0=st.analysisRegions[0].color,total0=total();
 await ops.deselectRegionsInLasso(loop(b1),canvas,cam);
 out.split={count:st.analysisRegions.length,ticks:ticks(),voxels:st.analysisRegions.map(r=>r.voxels),colors:st.analysisRegions.map(r=>r.color===color0),total:total(),total0};
 await ops.deselectRegionsInLasso(loop(b3),canvas,cam);
 out.whole={count:st.analysisRegions.length,ticks:ticks()};
 // save → load
 const {project,binaries}=dl.gatherProject(),bytes=pf.packProject(project,binaries),un=pf.unpackProject(bytes);
 seg.clearAnalysisHighlight();await dl.applyProject(un);
 for(let t=Date.now();Date.now()-t<240000;){await new Promise(r=>setTimeout(r,500));if(!window.__vrlBusyModal?.().active)break}
 await new Promise(r=>setTimeout(r,2000));
 out.loaded={count:st.analysisRegions.length,ticks:ticks(),voxels:st.analysisRegions.map(r=>r.voxels)};
 out.targetsBefore=et.editTargetRegions().length;
 document.getElementById('analysis-deselect-all').click();
 out.all={ticks:ticks(),focused:st.analysisFocusedRegionId,targets:et.editTargetRegions().length,disabled:document.getElementById('analysis-edit-deselect-all').disabled};
 return out;
});
console.log(JSON.stringify(r));
const J=JSON.stringify,ok=!r.error&&J(r.start)===J([true,true])&&J(r.toggleOff)===J({ticks:[true,false],focused:null})&&J(r.toggleOn)===J({ticks:[true,true],focused:true})
 &&r.split.count===3&&J(r.split.ticks)===J([true,false,true])&&J(r.split.voxels)===J([216,216,216])&&J(r.split.colors)===J([true,true,false])&&r.split.total===r.split.total0
 &&r.whole.count===3&&J(r.whole.ticks)===J([true,false,false])
 &&J(r.loaded)===J({count:3,ticks:[true,false,false],voxels:[216,216,216]})&&r.targetsBefore===1
 &&J(r.all.ticks)===J([false,false,false])&&r.all.focused===null&&r.all.targets===0&&r.all.disabled===true;
await b.close();srv.close();
if(errors.length||!ok){console.error('region deselect check FAILED');process.exit(1)}console.log('region deselect check OK');
