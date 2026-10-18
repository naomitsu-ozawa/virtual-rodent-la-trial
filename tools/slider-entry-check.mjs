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
 const [st,sg]=await Promise.all([im('state.js'),im('segments.js')]);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const add=document.getElementById('segment-add-select'),btn=document.getElementById('segment-add-button');if(add&&![...document.querySelectorAll('[data-seg-min="fat"]')].some(e=>!e.disabled)){add.value='fat';add.dispatchEvent(new Event('change'));btn.click()}
 await wait(1500);for(let t=Date.now();Date.now()-t<120000;){await wait(300);if(!window.__vrlBusyModal?.().active)break}
 const fatMin=document.querySelector('[data-seg-min="fat"]'),fatOut=document.querySelector('[data-seg-min-out="fat"]');
 const wheel=(el,deltaY,shiftKey=false)=>el.dispatchEvent(new WheelEvent('wheel',{deltaY,shiftKey,bubbles:true,cancelable:true}));
 const out={unit:fatMin.step,wcStep:document.getElementById('wc').step,profile:[st.ctRangeProfile.fullMin,st.ctRangeProfile.fullMax]};
 // wheel
 let a=+fatMin.value;wheel(fatMin,100);await wait(300);out.notch=+fatMin.value-a;out.userAfterNotch=sg.segmentState.fat.userMin-a;
 a=+fatMin.value;wheel(fatMin,-100,true);await wait(300);out.shiftNotch=+fatMin.value-a;
 a=+fatMin.value;for(let i=0;i<9;i++)wheel(fatMin,-10);await wait(300);out.trackpad=+fatMin.value-a;
 const ax=document.getElementById('axial-slider');a=+ax.value;wheel(ax,100);await wait(300);out.slice=+ax.value-a;
 const op=document.querySelector('[data-seg-opening="fat"]');a=+op.value;wheel(op,-100);await wait(300);out.opening=+op.value-a;wheel(op,100);await wait(1500);
 for(let t=Date.now();Date.now()-t<120000;){await wait(300);if(!window.__vrlBusyModal?.().active)break}
 // typing
 const type=async(output,text,key='Enter')=>{output.click();await wait(50);const f=output.parentElement.querySelector('.range-entry-field');if(!f)return'no field';f.value=text;f.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));await wait(400);return{field:true,hiddenAfter:output.hidden,fieldLeft:!!output.parentElement.querySelector('.range-entry-field')}};
 out.t1=await type(fatOut,'-237');out.t1.user=sg.segmentState.fat.userMin;out.t1.min=sg.segmentState.fat.min;out.t1.shown=fatOut.textContent;out.t1.slider=+fatMin.value;
 out.esc=await type(fatOut,'-111','Escape');out.esc.user=sg.segmentState.fat.userMin;
 const lo0=+fatMin.min;out.wide=await type(fatOut,'-1000');out.wide.user=sg.segmentState.fat.userMin;out.wide.sliderMin=+fatMin.min;out.wide.lo0=lo0;
 out.clamp=await type(fatOut,'-99999');out.clamp.user=sg.segmentState.fat.userMin;
 for(let t=Date.now();Date.now()-t<120000;){await wait(300);if(!window.__vrlBusyModal?.().active)break}
 const cap=document.getElementById('mpr-surface-opacity'),capOut=document.getElementById('mpr-surface-opacity-value');out.pctDisabled=cap.disabled;
 out.pct=await type(capOut,'50');out.pct.value=+cap.value;out.pct.shown=capOut.textContent;
 const m3=document.getElementById('mpr3d-slider-axial'),m3Out=m3?.closest('label')?.querySelector('output');
 if(m3Out){out.slice1=await type(m3Out,'100');out.slice1.axial=+document.getElementById('axial-slider').value;out.slice1.shown=m3Out.textContent}
 const sec=document.getElementById('section-position-value');sec.click();await wait(50);out.dash=!!sec.parentElement.querySelector('.range-entry-field');
 return out;
});
console.log(JSON.stringify(r));
const ok=r.unit==='1'&&r.wcStep==='1'&&r.notch===-1&&r.userAfterNotch===-1&&r.shiftNotch===10&&r.trackpad===2&&r.slice===-1&&r.opening===1
 &&r.t1.field&&!r.t1.hiddenAfter&&!r.t1.fieldLeft&&r.t1.user===-237&&r.t1.slider===-237&&r.t1.shown==='-237'
 &&r.esc.user===-237&&r.wide.user===-1000&&r.wide.sliderMin<=-1000&&r.clamp.user===r.profile[0]
 &&r.pct.value===50&&(!r.slice1||(r.slice1.axial===99&&r.slice1.shown.startsWith('100 / ')))&&r.dash===false;
await b.close();srv.close();
if(errors.length||!ok){console.error('slider entry check FAILED');process.exit(1)}console.log('slider entry check OK');
