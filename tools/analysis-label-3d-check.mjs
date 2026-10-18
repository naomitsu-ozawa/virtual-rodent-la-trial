// Analysis labels on the PC 3D view (build 523): opens the practice data, adds a result, pins its label (region.label) and checks in the real page that
//  - the chip is drawn at the anchor's screen position (default: just above it, no leader), the anchor dot is there
//  - a mouse drag on the chip moves it in the camera-facing plane (the camera does not rotate), stores a voxel-unit offset, shows the leader line,
//    and the chip then sits at anchor + offset as the camera independently computes it
//  - rotating the volume carries the label (the data-space offset is unchanged, the chip follows)
//  - a double click puts it back (no offset, no leader); the card buttons pin / reset; a lit label (hover) is highlighted; removing the label removes the chip
//    PW_CHROMIUM=/opt/pw-browsers/chromium node tools/analysis-label-3d-check.mjs
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const PORT=8766,root=path.resolve('docs'),nm=path.resolve('node_modules');const errors=[];
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]));
 if(p.endsWith('project.vrlab')){r.writeHead(404);r.end();return}
 fs.readFile(p.endsWith('/')?p+'index.html':p,(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html'});r.end(b)})}).listen(PORT);
const map=u=>{
 if(u.includes('three@0.186.0/build/three.module.js'))return nm+'/three/build/three.module.js';
 if(u.includes('three@0.186.0/build/three.webgpu.js'))return nm+'/three/build/three.webgpu.js';
 if(u.includes('three.core.js'))return nm+'/three/build/three.core.js';
 if(u.includes('dicom-parser'))return nm+'/dicom-parser/dist/dicomParser.min.js';
 if(u.includes('fflate'))return nm+'/fflate/esm/browser.js';
 return null};
const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{})});const pg=await b.newPage({viewport:{width:1400,height:900}});
pg.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR:',String(e).slice(0,500))});
await pg.route(/^https:\/\//,async rt=>{const u=rt.request().url(),f=map(u);
 if(f){let body=fs.readFileSync(f,'utf8');if(u.includes('dicom-parser'))body='const require=()=>({});const module={exports:{}};const exports=module.exports;\n'+body+'\nexport default (module.exports.default||module.exports||window.dicomParser);';
  return rt.fulfill({status:200,contentType:'text/javascript',body})}
 if(u.includes('three-mesh-bvh')||u.includes('cornerstone'))return rt.fulfill({status:200,contentType:'text/javascript',body:'export const MeshBVH=class{};export const acceleratedRaycast=()=>{};export const computeBoundsTree=()=>{};export const disposeBoundsTree=()=>{};export default {};'});
 return rt.abort()});
await pg.goto(`http://localhost:${PORT}/index.html`);await pg.waitForTimeout(3000);
await pg.click('#sample-demo-button');await pg.click('[data-sample-set="sample1"]');
const t0=Date.now();while(Date.now()-t0<180000){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>5000)break;await pg.waitForTimeout(250)}
const imp=(f)=>pg.evaluate(async f=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search;const m=await import('./'+f+v);return Object.keys(m).length},f);
await imp('state.js');
const checks=[],ok=(name,cond,info='')=>{checks.push({name,ok:!!cond,info});if(!cond)console.log('FAIL',name,info)};
// one result (a box of runs) and its label at a voxel inside it
await pg.evaluate(async()=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,ops,al]=await Promise.all([im('state.js'),im('analysis-ops.js'),im('analysis-label.js')]);
 const add=document.getElementById('segment-add-select'),btn=document.getElementById('segment-add-button');if(add&&!btn.disabled){add.value='bone';add.dispatchEvent(new Event('change'));btn.click()}
 await new Promise(r=>setTimeout(r,500));
 const vol=st.current3DVolume||st.volume,runs=new Array(vol.slices).fill(null);
 for(let z=200;z<=209;z++){const a=[];for(let y=200;y<=209;y++)a.push(y,200,219);runs[z]=new Int32Array(a)}
 await ops.addAnalysisRegion(vol,{key:'bone',segmentKeys:['bone'],runsBySlice:runs,voxels:2000,mm3:1});
 al.setRegionLabel(st.analysisRegions[0],{anchor:{i:210,j:205,k:205}});
 // no WebGPU here, so no 3D object is built: stand in a plain group (a volume's local frame: origin = centre), as tests/e2e/comments3d.spec.js does
 const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js'),sc=st.sceneState;if(!sc.obj){sc.obj=new THREE.Group();sc.scene.add(sc.obj)}
 sc.needsRender=true;
});
await pg.waitForSelector('.analysis-label-3d:not([hidden])',{timeout:30000}).catch(()=>{});
const anchorXY=(a,off)=>pg.evaluate(async([a,off])=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,st=await import('./state.js'+v),THREE=await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js');
 const {obj,camera}=st.sceneState,vol=st.volume,[sx,sy,sz]=vol.spacing,px=vol.columns*sx,py=vol.rows*sy,pz=vol.slices*sz,scale=3.3/Math.max(px,py,pz);
 const r=document.getElementById('viewport-3d').getBoundingClientRect();obj.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 const q=off?{i:a.i+off.i,j:a.j+off.j,k:a.k+off.k}:a;
 const p=new THREE.Vector3(((q.i+.5)*sx-px/2)*scale,-((q.j+.5)*sy-py/2)*scale,((q.k+.5)*sz-pz/2)*scale).applyMatrix4(obj.matrixWorld).project(camera);
 return{x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height,z:p.z};
},[a,off]);
const chipXY=()=>pg.evaluate(()=>{const e=document.querySelector('.analysis-label-3d:not([hidden])');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,text:e.textContent}});
const state=()=>pg.evaluate(async()=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,st=await import('./state.js'+v);
 const l=st.analysisRegions[0]?.label||null,ld=document.querySelector('.analysis-leader-3d');
 return{label:l?JSON.parse(JSON.stringify(l)):null,quat:st.sceneState.obj.quaternion.toArray(),leader:ld?ld.style.display!=='none':false,chips:document.querySelectorAll('.analysis-label-3d:not([hidden])').length,dot:!!document.querySelector('.analysis-anchor-3d')&&document.querySelector('.analysis-anchor-3d').style.display!=='none'};
});
const A={i:210,j:205,k:205};
let c0=await chipXY(),w0=await anchorXY(A),s0=await state();
ok('one chip with number, segment and volume',c0&&s0.chips===1&&/^1\./.test(c0.text)&&/mm³/.test(c0.text),JSON.stringify(c0));
ok('default chip is above its anchor, no leader, anchor dot shown',c0&&Math.abs(c0.x-w0.x)<3&&c0.y<w0.y&&!s0.leader&&s0.dot,JSON.stringify({c0,w0,s0}));
// hover lights the chip
await pg.mouse.move(c0.x,c0.y);await pg.waitForTimeout(150);
ok('hover lights the chip',await pg.evaluate(()=>!!document.querySelector('.analysis-label-3d.is-lit')));
// drag
const vp=await pg.evaluate(()=>{const r=document.getElementById('viewport-3d').getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height}});
const tx=Math.min(vp.x+vp.w-80,c0.x+110),ty=Math.min(vp.y+vp.h-40,c0.y+80);
await pg.mouse.down();await pg.mouse.move(c0.x+30,c0.y+20,{steps:4});await pg.mouse.move(tx,ty,{steps:8});
ok('dragging class while held',await pg.evaluate(()=>!!document.querySelector('.analysis-label-3d.is-dragging')));
await pg.mouse.up();await pg.waitForTimeout(300);
const c1=await chipXY(),s1=await state();
ok('the chip follows the pointer',c1&&Math.abs(c1.x-tx)<3&&Math.abs(c1.y-ty)<3,JSON.stringify({c1,tx,ty}));
ok('the camera did not rotate',JSON.stringify(s1.quat)===JSON.stringify(s0.quat),JSON.stringify([s0.quat,s1.quat]));
ok('offset stored in voxel units, anchor kept, leader line shown',s1.label&&s1.label.offset&&JSON.stringify(s1.label.anchor)===JSON.stringify(A)&&s1.leader,JSON.stringify(s1));
const w1=await anchorXY(A,s1.label.offset);
ok('the chip is at anchor + offset as projected independently',Math.abs(w1.x-c1.x)<3&&Math.abs(w1.y-c1.y)<3,JSON.stringify({w1,c1}));
// rotate the volume: the chip follows the data
await pg.mouse.move(vp.x+vp.w*.5,vp.y+vp.h*.9);await pg.mouse.down();await pg.mouse.move(vp.x+vp.w*.58,vp.y+vp.h*.84,{steps:8});await pg.mouse.up();await pg.waitForTimeout(400);
const c2=await chipXY(),s2=await state(),w2=await anchorXY(A,s1.label.offset);
ok('rotation changed the camera but not the stored label',JSON.stringify(s2.quat)!==JSON.stringify(s1.quat)&&JSON.stringify(s2.label)===JSON.stringify(s1.label),JSON.stringify([s1.quat,s2.quat]));
ok('the chip follows the rotation (anchor + offset)',c2&&Math.abs(w2.x-c2.x)<3&&Math.abs(w2.y-c2.y)<3,JSON.stringify({w2,c2}));
// double click puts it back
await pg.mouse.dblclick(c2.x,c2.y);await pg.waitForTimeout(300);
const s3=await state(),c3=await chipXY(),w3=await anchorXY(A);
ok('double click: default place, no offset, no leader',s3.label&&!s3.label.offset&&!s3.leader&&c3&&Math.abs(c3.x-w3.x)<3&&c3.y<w3.y,JSON.stringify({s3,c3,w3}));
// card buttons: focus the result, reset button appears only when moved
await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,st=await import('./state.js'+v),ar=await import('./analysis-results.js'+v);st.setAnalysisFocusedRegionId(st.analysisRegions[0].id);ar.renderAnalysisResults()});
ok('card: remove-label button, no reset button while at the default place',await pg.evaluate(()=>!!document.querySelector('.analysis-label-pin')&&!document.querySelector('.analysis-label-reset')));
await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,st=await import('./state.js'+v),al=await import('./analysis-label.js'+v);al.setRegionLabelOffset(st.analysisRegions[0],{i:-20,j:-15,k:0})});
await pg.waitForTimeout(300);
ok('card: reset button appears when moved and puts it back',await pg.evaluate(()=>!!document.querySelector('.analysis-label-reset')));
await pg.evaluate(()=>document.querySelector('.analysis-label-reset').click());await pg.waitForTimeout(300);
ok('reset button: default place',(await state()).label&&!(await state()).label.offset);
await pg.evaluate(()=>document.querySelector('.analysis-label-pin').click());await pg.waitForTimeout(300);
ok('remove-label button removes the chip',(await state()).label===null&&(await state()).chips===0);
await pg.evaluate(()=>document.querySelector('.analysis-label-pin').click());await pg.waitForTimeout(400);
const s5=await state();ok('pin button pins it again (at a voxel of the result)',s5.label&&!s5.label.offset&&s5.chips===1,JSON.stringify(s5));
// build 524: the PC pin is on the result's SURFACE facing the camera (not an inside voxel): the default camera looks from +z (= +k), so the anchor is on the k = 209 face
ok('pinned anchor is on the surface facing the camera (k near the top face 209, i / j inside the result)',s5.label&&s5.label.anchor.k>=208.4&&s5.label.anchor.k<=209.6&&s5.label.anchor.i>=199.5&&s5.label.anchor.i<=219.5&&s5.label.anchor.j>=199.5&&s5.label.anchor.j<=209.5,JSON.stringify(s5.label));
// build 524: the chip number is the region id, as the panel's 「解析領域 N」
ok('chip number = region id',await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,st=await import('./state.js'+v),e=document.querySelector('.analysis-label-3d:not([hidden])');return !!e&&e.textContent.startsWith(st.analysisRegions[0].id+'.')}));
// build 524: merging two results keeps the (first) label
const mg=await pg.evaluate(async()=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,ops]=await Promise.all([im('state.js'),im('analysis-ops.js')]),vol=st.current3DVolume||st.volume,runs=new Array(vol.slices).fill(null);
 for(let z=300;z<=304;z++){const a=[];for(let y=100;y<=104;y++)a.push(y,100,104);runs[z]=new Int32Array(a)}
 await ops.addAnalysisRegion(vol,{key:'bone',segmentKeys:['bone'],runsBySlice:runs,voxels:125,mm3:1});
 const first=JSON.parse(JSON.stringify(st.analysisRegions[0].label));for(const r of st.analysisRegions)r.selected=true;
 await ops.mergeSelectedAnalysisRegions();
 return{count:st.analysisRegions.length,label:st.analysisRegions[0]?.label?JSON.parse(JSON.stringify(st.analysisRegions[0].label)):null,first};
});
ok('merge: one result left, it inherits the first label',mg.count===1&&JSON.stringify(mg.label)===JSON.stringify(mg.first),JSON.stringify(mg));
// an edit tool owns the pointer: the chip is not draggable then
await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,st=await import('./state.js'+v);st.setAnalysisEditTool('lasso')});
const c6=await chipXY();await pg.mouse.move(c6.x,c6.y);await pg.waitForTimeout(150);
ok('with an edit tool active the chip is not lit / grabbed',!(await pg.evaluate(()=>!!document.querySelector('.analysis-label-3d.is-lit'))));
await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,st=await import('./state.js'+v);st.setAnalysisEditTool('select')});
await pg.screenshot({path:path.join(os.tmpdir(),'label3d.png')});
console.log(JSON.stringify(checks.map(c=>(c.ok?'ok ':'FAIL ')+c.name)));
await b.close();srv.close();
if(errors.length||checks.some(c=>!c.ok)){console.error('analysis label 3d check FAILED');process.exit(1)}console.log('analysis label 3d check OK');
