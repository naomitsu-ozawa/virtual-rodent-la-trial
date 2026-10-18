// 3D plane views face the plane as the 2D view draws it (build 434): practice data; for each plane the 3D view is turned by
// sceneState.setAxisView, then object-local directions are taken into camera space. 2D drawing (mpr-render.js): axial
// x = column, y = row (row 0 at the top); coronal x = column, y = d−1−slice; sagittal x = row, y = d−1−slice. So on screen:
// axial: +column right, +row down; coronal: +column right, +slice up; sagittal: +row right, +slice up. Object-local axes
// (mesh-geometry.js makeSource3DCoordinates): +x = column, +y = −row, +z = slice. Also: the default (reversed) section cut
// keeps the half behind the plane, so the cut face is what the camera sees.
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/plane-orientation-check.mjs
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
 const [st,sv]=await Promise.all([im('state.js'),im('section-view.js')]);const ss=st.sceneState;
 // setAxisView only turns sceneState.obj: a bare Object3D stands in for the volume (no 3D build needed headless)
 if(!ss.obj){const O3=Object.getPrototypeOf(ss.scene.constructor.prototype).constructor,o=new O3();ss.scene.add(o);ss.obj=o}
 if(!ss.obj)return{error:'no 3D object'};
 const V=ss.obj.position.constructor,cam=ss.camera;
 const dir=(x,y,z)=>{const a=new V(0,0,0),b=new V(x,y,z);ss.obj.localToWorld(a);ss.obj.localToWorld(b);a.applyMatrix4(cam.matrixWorldInverse);b.applyMatrix4(cam.matrixWorldInverse);const d=b.sub(a);return[Math.round(d.x/d.length()*100)/100,Math.round(d.y/d.length()*100)/100]};
 const out={};
 for(const [p,axis,right,up] of [['axial','z',[1,0,0],[0,1,0]],['coronal','y',[1,0,0],[0,0,1]],['sagittal','x',[0,-1,0],[0,0,1]]]){
  ss.setAxisView(axis);ss.obj.updateMatrixWorld(true);cam.updateMatrixWorld(true);
  // the default (reversed) cut keeps the half on the normal's side: it must lie behind the plane (camera-space z < 0)
  st.setSectionViewReverse(true);const n=sv.sectionLocalNormal(p),a=new V(0,0,0),bb=n.clone();ss.obj.localToWorld(a);ss.obj.localToWorld(bb);a.applyMatrix4(cam.matrixWorldInverse);bb.applyMatrix4(cam.matrixWorldInverse);
  out[p]={right:dir(...right),up:dir(...up),keptZ:Math.round((bb.z-a.z)/bb.sub(a).length()*100)/100}}
 return out;
});
console.log(JSON.stringify(r));
const ok=!r.error&&Object.values(r).every(o=>o.right[0]>0.99&&Math.abs(o.right[1])<0.01&&o.up[1]>0.99&&Math.abs(o.up[0])<0.01&&o.keptZ<-0.99);
await b.close();srv.close();
if(errors.length||!ok){console.error('plane orientation check FAILED');process.exit(1)}console.log('plane orientation check OK');
