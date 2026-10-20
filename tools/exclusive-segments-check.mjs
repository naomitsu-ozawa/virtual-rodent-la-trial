import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root=path.resolve('docs'),nm=path.resolve('node_modules');const errors=[];
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]));
 // the practice data's bundled project (docs/demo/sample1/project.vrlab) is applied on load; the checks start
 // from the bare data unless SAMPLE_PROJECT=1
 if(p.endsWith('project.vrlab')&&!process.env.SAMPLE_PROJECT){r.writeHead(404);r.end();return}
 fs.readFile(p.endsWith('/')?p+'index.html':p,(e,b)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html'});r.end(b)})}).listen(Number(process.env.PORT||8765));
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
await pg.goto('http://localhost:'+(process.env.PORT||8765)+'/index.html');await pg.waitForTimeout(3000);
await pg.click('#sample-demo-button');await pg.click('[data-sample-set="sample1"]');
const idle=async()=>{const t0=Date.now();while(Date.now()-t0<300000){const s=await pg.evaluate(()=>window.__vrlBusyModal?.()||{});if(!s.active&&Date.now()-t0>1500)break;await pg.waitForTimeout(250)}};
await idle();
const r=await pg.evaluate(async()=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,seg,sr,rl,sg,dl,pf]=await Promise.all([im('state.js'),im('segment-ui.js'),im('segment-runs.js'),im('run-length.js'),im('segments.js'),im('data-load.js'),im('project-file.js')]);
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),idle=async()=>{await wait(1200);for(let t=Date.now();Date.now()-t<600000;){await wait(300);if(!window.__vrlBusyModal?.().active)break}};
 const add=k=>{const a=document.getElementById('segment-add-select');a.value=k;a.dispatchEvent(new Event('change'));document.getElementById('segment-add-button').click()};
 for(const k of ['bone','fat','soft'])add(k);await idle();
 const S=sg.segmentState,vol=st.current3DVolume||st.volume,d=vol.slices;
 const setR=(k,a,b)=>{seg.setControlValue(seg.segmentControl('min',k),a);seg.setControlValue(seg.segmentControl('max',k),b)};
 setR('fat',-250,81);setR('soft',-93,248);await idle();
 const mode=m=>{const sel=document.getElementById('segment-exclusive-mode');sel.value=m;sel.dispatchEvent(new Event('change'))};
 const runs=async k=>await sr.ensureSegmentBaseRuns(k,vol);
 const count=async()=>{const f=await runs('fat'),s=await runs('soft');const both=rl.analysisRunsVoxelCount(rl.intersectRunArrays(f,s,d)),uni=rl.analysisRunsVoxelCount(rl.unionRunArrays(f,s,d));return{fat:rl.analysisRunsVoxelCount(f),soft:rl.analysisRunsVoxelCount(s),both,union:uni,fatRange:[S.fat.min,S.fat.max],softRange:[S.soft.min,S.soft.max],user:{fat:[S.fat.userMin,S.fat.userMax],soft:[S.soft.userMin,S.soft.userMax]}}};
 const out={order:[...sg.segmentExclusive.order],cards:[...document.querySelectorAll('#segment-controls [data-segment]')].filter(c=>!c.classList.contains('is-hidden')).map(c=>c.dataset.segment)};
 mode('off');await idle();out.off=await count();
 mode('priority');await idle();out.priority=await count();
 out.note=document.querySelector('[data-seg-effective="soft"]').textContent;
 // hide the fat card (checkbox): soft keeps its voxels
 const en=seg.segmentControl('enabled','fat');en.checked=false;en.dispatchEvent(new Event('change'));await idle();out.hidden=await count();en.checked=true;en.dispatchEvent(new Event('change'));await idle();
 // nested: soft around fat
 setR('soft',-300,300);await idle();out.nested={soft:[S.soft.min,S.soft.max],dropped:S.soft.exclusive?.dropped,note:document.querySelector('[data-seg-effective="soft"]').textContent};
 setR('soft',-93,248);await idle();
 // project round trip
 const before={mode:sg.segmentExclusive.mode,order:[...sg.segmentExclusive.order],fat:[S.fat.userMin,S.fat.userMax,S.fat.min,S.fat.max],soft:[S.soft.userMin,S.soft.userMax,S.soft.min,S.soft.max]};
 const {project,binaries}=dl.gatherProject(),un=pf.unpackProject(pf.packProject(project,binaries));
 mode('off');sg.segmentExclusive.order=['bone','soft','fat','lung'];await idle();
 await dl.applyProject(un);await idle();
 const after={mode:sg.segmentExclusive.mode,order:[...sg.segmentExclusive.order],fat:[S.fat.userMin,S.fat.userMax,S.fat.min,S.fat.max],soft:[S.soft.userMin,S.soft.userMax,S.soft.min,S.soft.max]};
 out.roundTrip={before,after,saved:project.segmentOptions,savedSoft:[project.segments.soft.min,project.segments.soft.max]};
 // known limit (reported, not asserted): Closing / hole fill add voxels after the ranges are split
 seg.setControlValue(seg.segmentControl('closing','fat'),1);await idle();await wait(1500);await idle();
 {const f=await sr.getFinalSegmentRuns('fat',vol),s2=await sr.getFinalSegmentRuns('soft',vol);out.closingBoth=rl.analysisRunsVoxelCount(rl.intersectRunArrays(f,s2,d))}
 return out;
});
// drag the soft card's ⋮⋮ above the fat card (pointer events, as on a touch screen): soft then takes the overlap
await pg.evaluate(()=>{document.querySelector('[data-seg-closing="fat"]').value='0';document.querySelector('[data-seg-closing="fat"]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-seg-closing="fat"]').dispatchEvent(new Event('change',{bubbles:true}))});
await idle();
const h=pg.locator('[data-seg-drag="soft"]'),fatCard=pg.locator('[data-segment="fat"]');await fatCard.scrollIntoViewIfNeeded();await h.scrollIntoViewIfNeeded();
const hb=await h.boundingBox(),fb=await fatCard.boundingBox();
await pg.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await pg.mouse.down();
for(let i=1;i<=12;i++)await pg.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2+(fb.y+fb.height*0.2-(hb.y+hb.height/2))*i/12);
await pg.mouse.up();await idle();
r.drag=await pg.evaluate(async()=>{const v=new URL(document.querySelector('script[src*="app.js"]').src).search,sg=await import('./segments.js'+v);const S=sg.segmentState;
 return{order:[...sg.segmentExclusive.order],cards:[...document.querySelectorAll('#segment-controls [data-segment]')].filter(c=>!c.classList.contains('is-hidden')).map(c=>c.dataset.segment),soft:[S.soft.min,S.soft.max],fat:[S.fat.min,S.fat.max],fatUser:[S.fat.userMin,S.fat.userMax],softUser:[S.soft.userMin,S.soft.userMax],fatNote:document.querySelector('[data-seg-effective="fat"]').textContent}});
// ---- part 2: what a higher segment removes or adds moves the segments below it, in every view ----
const runPart2=withFilter=>pg.evaluate(async withFilter=>{
 const v=new URL(document.querySelector('script[src*="app.js"]').src).search,im=f=>import('./'+f+v);
 const [st,seg,sr,rl,sg,gv,ops,mr,ui,sf]=await Promise.all([im('state.js'),im('segment-ui.js'),im('segment-runs.js'),im('run-length.js'),im('segments.js'),im('gpu-volume-data.js'),im('analysis-ops.js'),im('mpr-render.js'),im('ui-shell.js'),im('source-filters.js')]);
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),idle=async()=>{await wait(1200);for(let t=Date.now();Date.now()-t<600000;){await wait(300);if(!window.__vrlBusyModal?.().active&&!['bone','fat','soft'].some(k=>sg.segmentEditState[k].pendingBase))break}await wait(500)};
 const S=sg.segmentState,vol=st.current3DVolume||st.volume,d=vol.slices,w=vol.columns,h=vol.rows,out={};
 // part 3: the same checks with a filter on, i.e. the run path (the in-memory CT copy cannot stand in for the filtered data)
 for(const k of ['bone','fat','soft']){await (await im('analysis-ops.js')).resetFocusedSegmentEdit?.(k)}
 if(st.analysisRegions)st.analysisRegions.length=0;
 {const ex=sg.segmentEditState;for(const k of ['bone','fat','soft']){ex[k].keepRuns=null;ex[k].excludeRuns=null;ex[k].undo=[];ex[k].redo=[];sg.segmentEditGen[k]++}}
 if(withFilter){const fa=document.getElementById('filter-add-select');fa.value='gaussian';fa.dispatchEvent(new Event('change'));document.getElementById('filter-add-button').click();await idle()}
 out.filters=(await im('source-filters.js')).sourceFilterStages().length;
 const cnt=rl.analysisRunsVoxelCount,inter=(a,b)=>cnt(rl.intersectRunArrays(a,b,d)),sub=(a,b)=>rl.subtractRunArrays(a,b,d);
 const setCtl=(attr,k,val)=>seg.setControlValue(seg.segmentControl(attr,k),val);
 const mode=m=>{const sel=document.getElementById('segment-exclusive-mode');sel.value=m;sel.dispatchEvent(new Event('change'))};
 mode('priority');sg.segmentExclusive.order=['bone','fat','soft','lung'];setCtl('closing','fat',0);sg.commitExclusiveRanges();await idle();
 // soft over the whole bone range (and fat's), so what bone drops is inside soft's range
 setCtl('min','soft',-93);setCtl('max','soft',S.bone.userMax);await idle();
 const final=k=>sr.getFinalSegmentRuns(k,vol);
 const all=async()=>({bone:await final('bone'),fat:await final('fat'),soft:await final('soft')});
 const overlap=f=>({bf:inter(f.bone,f.fat),bs:inter(f.bone,f.soft),fs:inter(f.fat,f.soft)});
 const base=await all();out.base={bone:cnt(base.bone),fat:cnt(base.fat),soft:cnt(base.soft),sources:{fat:[...sg.segmentSourcesOf('fat')],soft:[...sg.segmentSourcesOf('soft')]},soft0:[S.soft.min,S.soft.max],overlap:overlap(base)};
 // 3D keep descriptor vs the final runs of the same segment
 const desc=(k,f)=>{const x=gv.gpuVolumeEditDescriptors(vol)[k];if(!x)return null;
  // an exclude-mode descriptor holds the excluded voxels: the shader shows the HU range minus them (= the base runs minus them)
  const shown=x.mode==='keep'?x.runs:sub(sg.segmentEditState[k].baseRuns,x.runs);return{mode:x.mode,maskOnly:!!x.maskOnly,onlyDesc:cnt(sub(shown,f[k])),onlyFinal:cnt(sub(f[k],shown))}};
 // 2D: the painted pixels of each segment alone (against the plane with none shown) vs the final runs on that plane
 const plane=async(p,idx,shown)=>{for(const k of ['bone','fat','soft'])S[k].enabled=shown.includes(k);ui.planes[p].slider.value=String(idx);await mr.renderPlane(p,++sf.planeRenderRevision[p],idx);await wait(400);const c=ui.planes[p].canvas;return c.getContext('2d').getImageData(0,0,c.width,c.height).data};
 const pix2d=async f=>{
  const res={};for(const [p,idx] of [['axial',d>>1],['coronal',h>>1],['sagittal',w>>1]]){
   const none=await plane(p,idx,[]),each={};
   for(const k of ['bone','fat','soft']){const a=await plane(p,idx,[k]),m=rl.runsPlaneMask(f[k],p,idx,w,h,d);let extra=0,missing=0,exp=0;for(let i=0;i<m.length;i++){const ch=a[i*4]!==none[i*4]||a[i*4+1]!==none[i*4+1]||a[i*4+2]!==none[i*4+2];if(m[i])exp++;if(ch&&!m[i])extra++;if(!ch&&m[i])missing++}each[k]={exp,extra,missing}}
   res[p]=each}
  for(const k of ['bone','fat','soft'])S[k].enabled=true;return res};
 const phase=async(label,f,wantDesc=true)=>{const o={overlap:overlap(f),bone:cnt(f.bone),soft:cnt(f.soft),fat:cnt(f.fat),sources:{soft:[...sg.segmentSourcesOf('soft')]}};if(wantDesc)o.desc={bone:desc('bone',f),fat:desc('fat',f),soft:desc('soft',f)};o.pix=await pix2d(f);out[label]=o;return o};
 // (1) bone: small components removed. The size is chosen so that something is removed.
 const boneRaw=base.bone;let removed=null,f1=null,usedMin=0;
 for(const m of [200,2000,20000,200000]){setCtl('min-component','bone',m);await idle();f1=await all();removed=sub(boneRaw,f1.bone);usedMin=m;if(cnt(removed)>0)break}
 await phase('minComponent',f1);out.minComponent.used=usedMin;out.minComponent.removed=cnt(removed);out.minComponent.removedInSoft=inter(removed,f1.soft);out.minComponent.softGain=cnt(sub(f1.soft,base.soft));out.minComponent.softLost=cnt(sub(base.soft,f1.soft));out.minComponent.softRange=[S.soft.min,S.soft.max];out.minComponent.note=document.querySelector('[data-seg-effective="soft"]').textContent;
 setCtl('min-component','bone',0);await idle();
 // (2) bone: air boundary
 const surf=seg.segmentControl('surface-mm','bone');setCtl('surface-mm','bone',+surf.step*2);await idle();
 const f2=await all(),removed2=sub(boneRaw,f2.bone);await phase('airBoundary',f2);out.airBoundary.removed=cnt(removed2);out.airBoundary.removedInSoft=inter(removed2,f2.soft);out.airBoundary.softGain=cnt(sub(f2.soft,base.soft));
 setCtl('surface-mm','bone',0);await idle();
 // (3) bone: hole filling (voxels outside bone's HU range join bone)
 const hf=seg.segmentControl('hole-fill','bone');seg.setControlChecked(hf,true);await idle();
 const f3=await all(),added=sub(f3.bone,boneRaw);await phase('holeFill',f3);out.holeFill.added=cnt(added);out.holeFill.addedInSoft=inter(added,f3.soft);out.holeFill.addedInFat=inter(added,f3.fat);out.holeFill.softLost=cnt(sub(base.soft,f3.soft))+cnt(sub(base.fat,f3.fat));out.holeFill.boneMaskOnly=!!gv.gpuVolumeEditDescriptors(vol).bone?.maskOnly;
 seg.setControlChecked(hf,false);await idle();
 // (4) bone: Closing 1 (adds voxels on the lower segments' ranges)
 setCtl('closing','bone',1);await idle();const f4=await all();await phase('closing',f4);out.closing.added=cnt(sub(f4.bone,boneRaw));setCtl('closing','bone',0);await idle();
 // cost of the voxel exclusion (reported, not asserted): soft's base runs rebuilt with bone as a source vs without
 {const heap=()=>performance.memory?.usedJSHeapSize||0,T={};
  const timeSoft=async()=>{sg.segmentEditState.soft.baseRuns=null;sg.segmentEditState.soft.baseSignature='';sg.segmentEditState.soft.finalRuns=null;const t=performance.now();await final('soft');return Math.round(performance.now()-t)};
  T.softWithSourceMs=await timeSoft();T.softWithSourceMs2=await timeSoft();
  setCtl('min-component','bone',0);await idle();T.softPlainMs=await timeSoft();T.softPlainMs2=await timeSoft();
  setCtl('min-component','bone',usedMin);await idle();T.softWithSourceAfterMs=await timeSoft();
  T.boneProcessedMs=await (async()=>{sg.segmentEditState.bone.baseRuns=null;sg.segmentEditState.bone.baseSignature='';const t=performance.now();await final('bone');return Math.round(performance.now()-t)})();
  T.heapMB=Math.round(heap()/1048576);out.timing=T;setCtl('min-component','bone',0);await idle();}
 // (5) manual exclusion in bone (the real edit path), its undo and redo
 const f5a=await all(),comps=rl.componentsFromRuns(f5a.bone,w,h,d).sort((a,b)=>b.voxels-a.voxels),comp=comps[0];
 await ops.addAnalysisRegion(vol,{key:'bone',segmentKeys:['bone'],runsBySlice:comp.runsBySlice,voxels:comp.voxels,mm3:1});
 st.analysisRegions[0].selected=true;ops.setAnalysisEditTargetKey?.('bone');
 // results of other segments: a manual edit in bone only drops the results of the segments that depend on it (soft), not fat's
 const tinyRuns=()=>Array.from({length:d},(_,z)=>z===(d>>1)?new Uint32Array([5,5,6]):new Uint32Array(0));
 await ops.addAnalysisRegion(vol,{key:'fat',segmentKeys:['fat'],runsBySlice:tinyRuns(),voxels:2,mm3:1});
 await ops.addAnalysisRegion(vol,{key:'soft',segmentKeys:['soft'],runsBySlice:tinyRuns(),voxels:2,mm3:1});
 st.analysisRegions[0].selected=true;for(const r of st.analysisRegions.slice(1))r.selected=false;
 await ops.applyEditRemoveSelected();await idle();
 out.regionsAfterEdit=st.analysisRegions.map(r=>r.key);
 const f5=await all();await phase('manualExclude',f5);out.manualExclude.removed=cnt(sub(f5a.bone,f5.bone));out.manualExclude.comp=comp.voxels;out.manualExclude.compInSoft=inter(comp.runsBySlice,f5.soft);out.manualExclude.softSources=[...sg.segmentSourcesOf('soft')];out.manualExclude.softGain=cnt(sub(f5.soft,f5a.soft));
 await ops.undoSegmentEdit();await idle();const f6=await all();out.undo={bone:cnt(sub(f6.bone,f5a.bone))+cnt(sub(f5a.bone,f6.bone)),soft:cnt(sub(f6.soft,f5a.soft))+cnt(sub(f5a.soft,f6.soft)),overlap:overlap(f6),softSources:[...sg.segmentSourcesOf('soft')]};
 await ops.redoSegmentEdit();await idle();const f7=await all();out.redo={bone:cnt(sub(f7.bone,f5.bone))+cnt(sub(f5.bone,f7.bone)),soft:cnt(sub(f7.soft,f5.soft))+cnt(sub(f5.soft,f7.soft)),overlap:overlap(f7)};
 S.bone.enabled=false;setCtl('max','soft',248);setCtl('min','soft',-93);await idle();
 const fsurf=seg.segmentControl('surface-mm','fat'),ssurf=seg.segmentControl('surface-mm','soft'),fatPlain=await final('fat');
 setCtl('surface-mm','fat',+fsurf.step*3);await idle();
 const g6=await all(),band=sub(fatPlain,g6.fat);
 await phase('fatAir_softPlain',g6);out.fatAir_softPlain.band=cnt(band);out.fatAir_softPlain.bandInSoft=inter(band,g6.soft);out.fatAir_softPlain.softSources=[...sg.segmentSourcesOf('soft')];
 setCtl('surface-mm','soft',+ssurf.step*3);await idle();
 const g7=await all();await phase('fatAir_softAir',g7);out.fatAir_softAir.band=cnt(band);out.fatAir_softAir.bandInSoft=inter(band,g7.soft);out.fatAir_softAir.softNotInPlain=cnt(sub(g7.soft,g6.soft));
 setCtl('surface-mm','soft',0);setCtl('surface-mm','fat',0);await idle();S.bone.enabled=true;
 // (7) thin-part removal in soft (it runs after the higher voxels are taken out, on both paths)
 setCtl('thickness-mm','soft',+seg.segmentControl('thickness-mm','soft').step*3);await idle();
 const g8=await all();await phase('thinSoft',g8);out.thinSoft.soft=cnt(g8.soft);setCtl('thickness-mm','soft',0);await idle();
 return out;
},withFilter);
const r2=await runPart2(false);
r.part2=r2;
console.log(JSON.stringify(r));
const pixOk=x=>Object.values(x.pix).every(pl=>Object.values(pl).every(e=>e.extra===0&&e.missing===0))&&['bone','fat','soft'].every(k=>Object.values(x.pix).some(pl=>pl[k].exp>0)),noOverlap=o=>o.bf===0&&o.bs===0&&o.fs===0,descOk=x=>!x.desc||Object.values(x.desc).every(e=>!e||(e.onlyDesc===0&&e.onlyFinal===0));
const check2=p2=>noOverlap(p2.base.overlap)
 &&p2.minComponent.removed>0&&p2.minComponent.removedInSoft===p2.minComponent.removed&&p2.minComponent.softLost===0&&p2.minComponent.softGain===p2.minComponent.removed&&noOverlap(p2.minComponent.overlap)&&pixOk(p2.minComponent)&&descOk(p2.minComponent)
 &&p2.airBoundary.removed>0&&p2.airBoundary.removedInSoft>=0.999*p2.airBoundary.removed&&p2.airBoundary.softGain===p2.airBoundary.removedInSoft&&noOverlap(p2.airBoundary.overlap)&&pixOk(p2.airBoundary)&&descOk(p2.airBoundary)
 &&p2.holeFill.added>0&&p2.holeFill.addedInSoft===0&&p2.holeFill.addedInFat===0&&p2.holeFill.boneMaskOnly&&noOverlap(p2.holeFill.overlap)&&pixOk(p2.holeFill)&&descOk(p2.holeFill)
 &&p2.closing.added>0&&noOverlap(p2.closing.overlap)&&pixOk(p2.closing)
 &&p2.manualExclude.removed>0&&p2.manualExclude.compInSoft>0&&p2.manualExclude.softGain>0&&noOverlap(p2.manualExclude.overlap)&&pixOk(p2.manualExclude)&&descOk(p2.manualExclude)
 &&p2.fatAir_softPlain.band>0&&p2.fatAir_softPlain.bandInSoft>0&&noOverlap(p2.fatAir_softPlain.overlap)&&pixOk(p2.fatAir_softPlain)&&descOk(p2.fatAir_softPlain)&&p2.fatAir_softPlain.softSources.includes('fat')
 &&noOverlap(p2.fatAir_softAir.overlap)&&p2.fatAir_softAir.bandInSoft<p2.fatAir_softPlain.bandInSoft&&p2.fatAir_softAir.softNotInPlain===0&&pixOk(p2.fatAir_softAir)&&descOk(p2.fatAir_softAir)
 &&p2.regionsAfterEdit.includes('fat')&&!p2.regionsAfterEdit.includes('soft')&&p2.undo.bone===0&&p2.undo.soft===0&&noOverlap(p2.undo.overlap)&&p2.redo.bone===0&&p2.redo.soft===0&&noOverlap(p2.redo.overlap)
 &&noOverlap(p2.thinSoft.overlap)&&p2.thinSoft.soft>0&&pixOk(p2.thinSoft)&&descOk(p2.thinSoft);
// the run path: a filter is on (the in-memory CT copy is then not the data), the same invariants
r.part3=await runPart2(true);
const ok2=check2(r.part2)&&r.part2.filters===0&&check2(r.part3)&&r.part3.filters>0;
console.log('part3',JSON.stringify(r.part3));
if(!check2(r.part3))console.error('part 3 (filter on, run path) failed');

const ok=r.drag.cards.join()==='bone,soft,fat'&&r.drag.order.filter(k=>k!=='contrast').slice(0,3).join()==='bone,soft,fat'&&r.drag.soft[0]===r.drag.softUser[0]&&r.drag.fat[1]<r.drag.softUser[0]&&r.drag.fatNote.length>0&&r.off.both>0&&r.priority.both===0&&r.priority.union===r.priority.fat+r.priority.soft&&r.hidden.soft===r.priority.soft&&r.nested.dropped?.length===1&&r.nested.note.length>0&&JSON.stringify(r.roundTrip.before)===JSON.stringify(r.roundTrip.after)&&r.cards.join()==='bone,fat,soft'&&r.closingBoth===0&&ok2;
if(!ok2)console.error('part 2 failed');
await b.close();srv.close();
if(errors.length||!ok){console.error('exclusive segments check FAILED');process.exit(1)}console.log('exclusive segments check OK');
