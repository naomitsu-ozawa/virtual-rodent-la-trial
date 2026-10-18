// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { volume, mpr3DWindowLutKey, mpr3DWindowLutTable, setMpr3DWindowLutKey, residentGpuUploadSeriesId, sceneState, threeRenderMode, mpr3DSurfaceOpacity, sectionViewOpen, sectionViewPlane, sectionAutoPlane, setSectionAutoPlane, sectionCapEnabled, sectionCapOpacity, sectionCapHatch, sectionSliceImageVisible } from './state.js?v=20261018-build620';
import { wc, ww, planes, mpr3DSliceSliders, $, mprVolumeOpacity, mprSurfaceOpacity } from './ui-shell.js?v=20261018-build620';
import { sourceFilterStages, getFilteredSourceAxialBlock, getCachedSourceSlice, sourceFilterSignature } from './source-filters.js?v=20261018-build620';
import { residentGpuMprAvailable } from './mpr-orthogonal.js?v=20261018-build620';
import { frameYield } from './utils.js?v=20261018-build620';
import { request3DRender } from './scene3d.js?v=20261018-build620';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
export const mpr3DVisibility={axes:true,axial:false,coronal:false,sagittal:false};
export function restoreSectionAutoPlane(){
 if(!sectionAutoPlane)return;
 const {key,wasVisible}=sectionAutoPlane;setSectionAutoPlane(null);
 const entry=sceneState?.mprPlaneEntries?.[key];
 if(entry){entry.mesh.material.opacity=.64;if(entry.highlight){entry.highlight.visible=false;entry.highlight.material.opacity=0}entry.border.material.opacity=.95;entry.label.scale.set(.78,.195,1)}
 setMpr3DOverlayVisible(key,wasVisible);
}
export function showSectionPlaneOverlay(key){
 const volumeMode=threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active;
 if(sectionAutoPlane?.key===key){
  const entry=sceneState?.mprPlaneEntries?.[key];if(entry){entry.mesh.material.opacity=.96;if(entry.highlight){entry.highlight.visible=!volumeMode;entry.highlight.material.opacity=volumeMode?0:.24}entry.border.material.opacity=1;entry.label.scale.set(.95,.238,1);if(!volumeMode)refreshMpr3DPlaneTexture(key)}
  return;
 }
 restoreSectionAutoPlane();
 const wasVisible=!!mpr3DVisibility[key];setSectionAutoPlane({key,wasVisible});
 if(!wasVisible)setMpr3DOverlayVisible(key,true);
 const entry=sceneState?.mprPlaneEntries?.[key];
 if(entry){entry.mesh.material.opacity=.96;if(entry.highlight){entry.highlight.visible=!volumeMode;entry.highlight.material.opacity=volumeMode?0:.24}entry.border.material.opacity=1;entry.label.scale.set(.95,.238,1);if(!volumeMode)refreshMpr3DPlaneTexture(key)}
}
export const mpr3DOrthoSliding={coronal:false,sagittal:false};
export function pushCachedMpr3DPlane(p,idx){
 if((p!=='coronal'&&p!=='sagittal')||mpr3DPreviewCache.signature!==mpr3DPreviewSignature(volume)||!mpr3DPreviewCache.planes[p])return false;
 let entry=sceneState?.mprPlaneEntries?.[p];if(!entry||!mpr3DVisibility[p])return false;
 const dims=mpr3DPreviewCache.dims[p],src=mpr3DPreviewCache.planes[p];if(!dims||!src)return false;
 if(!entry.liveTexture||entry.liveTexture.image.width!==dims[0]||entry.liveTexture.image.height!==dims[1]){updateMpr3DPlanePositions();entry=sceneState?.mprPlaneEntries?.[p];if(!entry?.liveTexture)return false}
 const n=dims[0]*dims[1],off=idx*n,pixels=entry.livePixels,lut=mpr3DWindowLut();if(idx<0||off+n>src.length||!pixels||pixels.length!==n)return false;
 for(let i=0;i<n;i++)pixels[i]=lut[src[off+i]];
 entry.liveTexture.needsUpdate=true;
 if(entry.mesh.material.map!==entry.liveTexture){entry.mesh.material.map=entry.liveTexture;entry.mesh.material.needsUpdate=true}
 request3DRender();return true;
}
export function syncMpr3DSliceSliders(){
 let any=false;
 for(const[p,el]of Object.entries(mpr3DSliceSliders)){
  if(!el)continue;const row=el.closest('.mpr3d-slice-row'),src=planes[p].slider,show=!!volume&&!!mpr3DVisibility[p];
  row?.classList.toggle('is-hidden',!show);any||=show;
  const inv=String(+src.max-(+src.value));if(el.max!==src.max)el.max=src.max;if(el.value!==inv)el.value=inv;
  const out=row?.querySelector('output');if(out)out.textContent=(+src.value+1)+' / '+(+src.max+1);
 }
 // opacity of the planes for the current 3D mode (volume or surface setting)
 const op=$('#mpr3d-opacity'),opRow=op?.closest('.mpr3d-slice-row'),opSrc=mpr3DOpacitySource();
 if(op&&opSrc){opRow.classList.toggle('is-hidden',!any);if(op.value!==opSrc.value)op.value=opSrc.value;const o=opRow.querySelector('output');if(o)o.textContent=opSrc.value+'%'}
 $('#mpr3d-slice-controls')?.classList.toggle('is-hidden',!any);
}
export function mpr3DOpacitySource(){return threeRenderMode==='volume'&&sceneState?.medicalVolume?.active?mprVolumeOpacity:mprSurfaceOpacity}
export const mpr3DPreviewCache={token:0,signature:'',buildingSignature:'',building:false,min:0,max:1,planes:{axial:null,coronal:null,sagittal:null},dims:{axial:null,coronal:null,sagittal:null}};
export function mpr3DPreviewPlan(v){
 const touch=navigator.maxTouchPoints>0,target=touch?448:640,budget=(touch?128:256)*1024*1024,w=v.columns,h=v.rows,d=v.slices;
 const bytesFor=side=>{
  const cw=Math.min(w,side),ch=Math.min(d,side),sw=Math.min(h,side),sh=Math.min(d,side);
  return h*cw*ch+w*sw*sh;
 };
 let side=Math.min(target,Math.max(w,h,d));
 while(side>256&&bytesFor(side)>budget)side-=32;
 if(bytesFor(side)>budget)side=256;
 return{side,bytes:bytesFor(side)};
}
export function mpr3DPreviewMap(i,n,outN){return outN<=1?0:Math.max(0,Math.min(n-1,Math.round(i*(n-1)/(outN-1))))}
export function mpr3DPreviewSignature(v,stages=sourceFilterStages()){return [v?.series?.seriesUid||'',v?.columns||0,v?.rows||0,v?.slices||0,v?.min||0,v?.max||0,sourceFilterSignature(stages)].join('|')}
export async function ensureMpr3DPreviewCache(){
 const v=volume;if(!v)return false;
 const stages=sourceFilterStages(),series=v.series,canSource=!!(v.sourceBacked&&series);
 if(residentGpuUploadSeriesId&&residentGpuUploadSeriesId===series?.id)return false;
 if(!stages.length&&residentGpuMprAvailable(v)&&sceneState?.medicalVolume?.hasPreview?.(v))return true;
 if(stages.length&&!canSource)return false;
 if(!v.mprData&&!canSource)return false;
 const signature=mpr3DPreviewSignature(v,stages);
 if(mpr3DPreviewCache.signature===signature&&mpr3DPreviewCache.planes.coronal&&mpr3DPreviewCache.planes.sagittal)return true;
 if(mpr3DPreviewCache.building&&mpr3DPreviewCache.buildingSignature===signature)return false;
 // build 308: a filtered 3D rebuild is filling this preview from its own blocks
 if(stages.length&&sharedPreview&&sharedPreview.signature===signature)return false;
 const token=++mpr3DPreviewCache.token,plan=mpr3DPreviewPlan(v),maxSide=plan.side,w=v.columns,h=v.rows,d=v.slices,min=Number.isFinite(v.min)?v.min:-1024,max=Number.isFinite(v.max)&&v.max>min?v.max:min+1,scale=255/(max-min);
 const dims={axial:null,coronal:[Math.min(w,maxSide),Math.min(d,maxSide)],sagittal:[Math.min(h,maxSide),Math.min(d,maxSide)]};
 const coronal=new Uint8Array(h*dims.coronal[0]*dims.coronal[1]),sagittal=new Uint8Array(w*dims.sagittal[0]*dims.sagittal[1]);
 let fullSagittal16=null;
 if(canSource&&!stages.length&&!v.mprSagittalAll&&!v.mprSagittalDisplayAll){
  const bytes=w*h*d*2,limit=(navigator.maxTouchPoints||0)>0?1024*1024*1024:512*1024*1024;
  if(bytes<=limit)try{fullSagittal16=new Uint16Array(w*h*d)}catch{}
 }
 const corX=Array.from({length:dims.coronal[0]},(_,i)=>mpr3DPreviewMap(i,w,dims.coronal[0])),sagY=Array.from({length:dims.sagittal[0]},(_,i)=>mpr3DPreviewMap(i,h,dims.sagittal[0]));
 const corRows=new Map(),sagRows=new Map();
 for(let py=0;py<dims.coronal[1];py++){const z=d-1-mpr3DPreviewMap(py,d,dims.coronal[1]);if(!corRows.has(z))corRows.set(z,[]);corRows.get(z).push(py)}
 for(let py=0;py<dims.sagittal[1];py++){const z=d-1-mpr3DPreviewMap(py,d,dims.sagittal[1]);if(!sagRows.has(z))sagRows.set(z,[]);sagRows.get(z).push(py)}
 const q=value=>Math.max(0,Math.min(255,Math.round((value-min)*scale))),blockDepth=stages.length?(navigator.maxTouchPoints>0?2:4):1,plane=w*h;
 mpr3DPreviewCache.building=true;mpr3DPreviewCache.buildingSignature=signature;
 try{
  for(let z0=0;z0<d;z0+=blockDepth){
   if(token!==mpr3DPreviewCache.token||volume!==v)throw new Error('__SUPERSEDED__');
   let block=null,depth=Math.min(blockDepth,d-z0);
   if(stages.length){
    const filtered=await getFilteredSourceAxialBlock(z0,depth,series,'mpr3d-preview');
    if(token!==mpr3DPreviewCache.token||volume!==v)throw new Error('__SUPERSEDED__');
    block=filtered?.data;depth=filtered?.coreDepth||depth;
   }
   for(let local=0;local<depth;local++){
    const z=z0+local,src=block?block.subarray(local*plane,(local+1)*plane):(v.mprData?v.mprData.subarray(z*plane,(z+1)*plane):await getCachedSourceSlice(series.slices[z]));
    if(fullSagittal16){
     const rz=d-1-z,q16Scale=65535/Math.max(max-min,1e-12);
     for(let y=0;y<h;y++){const sy=y*w;for(let x=0;x<w;x++)fullSagittal16[(x*d+rz)*h+y]=Math.max(0,Math.min(65535,Math.round((src[sy+x]-min)*q16Scale)))}
    }
    const cr=corRows.get(z);if(cr){const cw=dims.coronal[0],ch=dims.coronal[1];for(const py of cr)for(let y=0;y<h;y++){const row=y*cw*ch+py*cw,sy=y*w;for(let px=0;px<cw;px++)coronal[row+px]=q(src[sy+corX[px]])}}
    const sr=sagRows.get(z);if(sr){const sw=dims.sagittal[0],sh=dims.sagittal[1];for(const py of sr)for(let x=0;x<w;x++){const row=x*sw*sh+py*sw;for(let px=0;px<sw;px++)sagittal[row+px]=q(src[sagY[px]*w+x])}}
   }
   if((z0&7)===0)await frameYield();
  }
  if(token!==mpr3DPreviewCache.token||volume!==v)throw new Error('__SUPERSEDED__');
  if(fullSagittal16){v.mprSagittalDisplayAll=fullSagittal16;v.mprSagittalDisplayMin=min;v.mprSagittalDisplayMax=max;v.mprSagittalDisplayBuffer=new Float32Array(h*d)}
  mpr3DPreviewCache.signature=signature;mpr3DPreviewCache.min=min;mpr3DPreviewCache.max=max;mpr3DPreviewCache.dims=dims;mpr3DPreviewCache.planes={axial:null,coronal,sagittal};
  for(const p of ['coronal','sagittal'])refreshMpr3DPlaneTexture(p);
  return true;
 }catch(e){
  if(String(e.message||e)!=='__SUPERSEDED__')console.warn('3D MPR C/S cache build failed.',e);
  return false;
 }finally{
  if(token===mpr3DPreviewCache.token){mpr3DPreviewCache.building=false;mpr3DPreviewCache.buildingSignature=''}
 }
}
export const mpr3DCacheImage={coronal:null,sagittal:null};
export function mpr3DWindowLut(){
 const min=mpr3DPreviewCache.min,max=mpr3DPreviewCache.max,low=+wc.value-(+ww.value)/2,width=Math.max(+ww.value,1),key=[min,max,low,width].join('|');
 if(key===mpr3DWindowLutKey)return mpr3DWindowLutTable;
 const range=Math.max(max-min,1),gscale=255/width;
 for(let i=0;i<256;i++){const hu=min+(i/255)*range,g=Math.max(0,Math.min(255,Math.round((hu-low)*gscale)));mpr3DWindowLutTable[i]=(255<<24)|(g<<16)|(g<<8)|g}
 setMpr3DWindowLutKey(key);return mpr3DWindowLutTable;
}
export function paintMpr3DCacheSliceFast(p,idx,canvas){
 const data=mpr3DPreviewCache.planes[p],dims=mpr3DPreviewCache.dims[p];if(!data||!dims||!canvas)return false;
 const [pw,ph]=dims,count=p==='coronal'?volume.rows:volume.columns;if(idx<0||idx>=count)return false;
 if(canvas.width!==pw)canvas.width=pw;if(canvas.height!==ph)canvas.height=ph;
 const ctx=canvas.getContext('2d');let cache=mpr3DCacheImage[p];if(!cache||cache.width!==pw||cache.height!==ph){const image=ctx.createImageData(pw,ph);cache={width:pw,height:ph,image,pixels:new Uint32Array(image.data.buffer)};mpr3DCacheImage[p]=cache}
 const pixels=cache.pixels,off=idx*pw*ph,lut=mpr3DWindowLut();
 for(let i=0;i<pixels.length;i++)pixels[i]=lut[data[off+i]];
 ctx.putImageData(cache.image,0,0);return true;
}
export function syncMpr3DOverlayPresentation(){
 syncMpr3DSliceSliders();
 const volumeMode=threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active;
 for(const key of ['axial','coronal','sagittal']){
  const entry=sceneState?.mprPlaneEntries?.[key],visible=!!mpr3DVisibility[key];if(!entry)continue;
  entry.root.visible=visible;
  entry.mesh.visible=visible&&!volumeMode&&!(sectionViewOpen&&sectionViewPlane===key&&!sectionSliceImageVisible);
  entry.mesh.material.opacity=mpr3DSurfaceOpacity;
  entry.mesh.material.needsUpdate=true;
  entry.border.visible=visible;
  entry.label.visible=visible;
  if(volumeMode)entry.highlight.visible=false;
  else if(sectionViewOpen&&sectionViewPlane===key)entry.highlight.visible=true;
 }
 request3DRender();
}
export function setMpr3DOverlayVisible(key,visible){
 if(!(key in mpr3DVisibility))return;mpr3DVisibility[key]=!!visible;syncMpr3DSliceSliders();
 if(key==='axes'){if(sceneState?.axisWidget)sceneState.axisWidget.visible=!!visible}
 else{
  if(visible&&!sceneState?.mprPlaneEntries)updateMpr3DPlanePositions();
  const entry=sceneState?.mprPlaneEntries?.[key];if(entry){if(visible&&threeRenderMode!=='volume')refreshMpr3DPlaneTexture(key);syncMpr3DOverlayPresentation()}
 }
 const button=document.querySelector('[data-3d-overlay="'+key+'"]');button?.classList.toggle('is-active',!!visible);request3DRender();
}
export function disposeMprPlaneGroup(){
 if(!sceneState?.mprPlaneGroup)return;
 sceneState.scene.remove(sceneState.mprPlaneGroup);
 const textures=new Set();for(const entry of Object.values(sceneState.mprPlaneEntries||{})){if(entry.fullTexture)textures.add(entry.fullTexture);if(entry.liveTexture)textures.add(entry.liveTexture)}
 for(const entry of Object.values(sceneState.mprPlaneEntries||{}))if(entry.capTexture)textures.add(entry.capTexture);
 sceneState.mprPlaneGroup.traverse(o=>{o.geometry?.dispose?.();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(m?.map)textures.add(m.map);m?.dispose?.()}});
 for(const texture of textures)texture?.dispose?.();
 sceneState.mprPlaneGroup=null;sceneState.mprPlaneEntries=null;sceneState.mprPlaneSignature='';
}
export function makeMprPlaneLabel(text,color){
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.font='700 26px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=7;ctx.strokeStyle='rgba(0,0,0,.9)';ctx.strokeText(text,128,32);ctx.fillStyle=color;ctx.fillText(text,128,32);
 const texture=new THREE.CanvasTexture(canvas),material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}),sprite=new THREE.Sprite(material);sprite.scale.set(.78,.195,1);sprite.renderOrder=82;return sprite;
}
export function ensureMpr3DPlanes(){
 if(!sceneState||!volume)return null;
 const [sx,sy,sz]=volume.spacing,w=volume.columns,h=volume.rows,d=volume.slices,px=w*sx,py=h*sy,pz=d*sz,scale=3.3/Math.max(px,py,pz,1),cacheReady=mpr3DPreviewCache.signature===mpr3DPreviewSignature(volume),corDims=cacheReady?mpr3DPreviewCache.dims.coronal:null,sagDims=cacheReady?mpr3DPreviewCache.dims.sagittal:null,sig=[w,h,d,sx,sy,sz,cacheReady?mpr3DPreviewCache.signature:'',corDims?.join('x')||'',sagDims?.join('x')||''].join('|');
 if(sceneState.mprPlaneGroup&&sceneState.mprPlaneSignature===sig)return sceneState.mprPlaneEntries;
 disposeMprPlaneGroup();
 const group=new THREE.Group();group.name='mpr_planes_3d';group.renderOrder=70;sceneState.scene.add(group);
 const defs={
  axial:{canvas:planes.axial.canvas,color:0xff5a5a,css:'#ff5a5a',size:[px*scale,py*scale],rotation:[0,0,0],label:'AXIAL',cacheDims:null},
  coronal:{canvas:planes.coronal.canvas,color:0x62d96b,css:'#62d96b',size:[px*scale,pz*scale],rotation:[Math.PI/2,0,0],label:'CORONAL',cacheDims:corDims},
  sagittal:{canvas:planes.sagittal.canvas,color:0xf3cc30,css:'#f3cc30',size:[py*scale,pz*scale],basis:true,label:'SAGITTAL',cacheDims:sagDims}
 };
 const entries={};
 for(const [key,def] of Object.entries(defs)){
  const root=new THREE.Group();root.name='mpr_plane_'+key;
  if(def.basis)root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(-1,0,0)));else root.rotation.set(...def.rotation);
  const previewCanvas=document.createElement('canvas');previewCanvas.width=Math.max(1,def.canvas.width||1);previewCanvas.height=Math.max(1,def.canvas.height||1);const previewCtx=previewCanvas.getContext('2d');if(def.canvas.width&&def.canvas.height)previewCtx.drawImage(def.canvas,0,0,previewCanvas.width,previewCanvas.height);
  const fullTexture=new THREE.CanvasTexture(previewCanvas);fullTexture.minFilter=THREE.LinearFilter;fullTexture.magFilter=THREE.LinearFilter;fullTexture.generateMipmaps=false;
  let liveTexture=null,liveData=null,livePixels=null;
  if(def.cacheDims){
   const [tw,th]=def.cacheDims;liveData=new Uint8Array(tw*th*4);livePixels=new Uint32Array(liveData.buffer);
   liveTexture=new THREE.DataTexture(liveData,tw,th,THREE.RGBAFormat,THREE.UnsignedByteType);liveTexture.minFilter=THREE.LinearFilter;liveTexture.magFilter=THREE.LinearFilter;liveTexture.generateMipmaps=false;liveTexture.flipY=true;liveTexture.needsUpdate=true;
  }
  const geometry=new THREE.PlaneGeometry(def.size[0],def.size[1]),material=new THREE.MeshBasicMaterial({map:fullTexture,transparent:true,opacity:.64,side:THREE.DoubleSide,depthWrite:false});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='mpr_texture_'+key;mesh.renderOrder=70;root.add(mesh);
  const highlightMaterial=new THREE.MeshBasicMaterial({color:def.color,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,depthTest:true});
  const highlight=new THREE.Mesh(geometry.clone(),highlightMaterial);highlight.name='mpr_section_highlight_'+key;highlight.position.z=-.003;highlight.renderOrder=69;highlight.visible=false;root.add(highlight);
  const edgeGeometry=new THREE.EdgesGeometry(geometry),edgeMaterial=new THREE.LineBasicMaterial({color:def.color,transparent:true,opacity:.95,depthTest:false,depthWrite:false});
  const border=new THREE.LineSegments(edgeGeometry,edgeMaterial);border.renderOrder=81;root.add(border);
  const capCanvas=document.createElement('canvas');capCanvas.width=1;capCanvas.height=1;
  const capTexture=new THREE.CanvasTexture(capCanvas);capTexture.minFilter=THREE.LinearFilter;capTexture.magFilter=THREE.NearestFilter;capTexture.generateMipmaps=false;
  const cap=new THREE.Mesh(geometry.clone(),new THREE.MeshBasicMaterial({map:capTexture,transparent:true,opacity:1,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  cap.name='mpr_section_face_'+key;cap.renderOrder=71;cap.visible=false;root.add(cap);
  const label=makeMprPlaneLabel(def.label,def.css);label.position.set(0,def.size[1]*.5+.12,0);root.add(label);
  root.visible=!!mpr3DVisibility[key];mesh.visible=!!mpr3DVisibility[key]&&threeRenderMode!=='volume';mesh.material.opacity=mpr3DSurfaceOpacity;border.visible=!!mpr3DVisibility[key];label.visible=!!mpr3DVisibility[key];
  group.add(root);entries[key]={root,texture:fullTexture,fullTexture,liveTexture,liveData,livePixels,mesh,highlight,border,label,previewCanvas,cap,capCanvas,capTexture,capColors:null,capIdx:-1,capHas:false};
 }
 sceneState.mprPlaneGroup=group;sceneState.mprPlaneEntries=entries;sceneState.mprPlaneSignature=sig;
 if(sectionViewOpen&&sectionViewPlane)showSectionPlaneOverlay(sectionViewPlane);
 return entries;
}
export function updateMpr3DPlanePositions(){
 if(!sceneState||!volume||(!mpr3DVisibility.axial&&!mpr3DVisibility.coronal&&!mpr3DVisibility.sagittal))return;
 const entries=ensureMpr3DPlanes();if(!entries)return;
 const w=volume.columns,h=volume.rows,d=volume.slices,[sx,sy,sz]=volume.spacing,px=w*sx,py=h*sy,pz=d*sz,scale=3.3/Math.max(px,py,pz,1);
 const ai=+planes.axial.slider.value,ci=+planes.coronal.slider.value,si=+planes.sagittal.slider.value;
 entries.axial.root.position.set(0,0,((ai+.5)*sz-pz/2)*scale);
 entries.coronal.root.position.set(0,-((ci+.5)*sy-py/2)*scale,0);
 entries.sagittal.root.position.set(((si+.5)*sx-px/2)*scale,0,0);
 sceneState.mprPlaneGroup.visible=!!sceneState.obj;
 request3DRender();
}
export function refreshMpr3DPlaneTexture(p){
 const entry=sceneState?.mprPlaneEntries?.[p];if(!entry||!mpr3DVisibility[p])return;
 if((p==='coronal'||p==='sagittal')&&mpr3DOrthoSliding[p]&&pushCachedMpr3DPlane(p,+planes[p].slider.value))return;
 const src=planes[p]?.canvas,dst=entry.previewCanvas;
 if(src?.width&&src?.height&&dst){
  if(dst.width!==src.width)dst.width=src.width;
  if(dst.height!==src.height)dst.height=src.height;
  const ctx=dst.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,dst.width,dst.height);ctx.drawImage(src,0,0);
 }
 entry.fullTexture.needsUpdate=true;
 if(entry.mesh.material.map!==entry.fullTexture){entry.mesh.material.map=entry.fullTexture;entry.mesh.material.needsUpdate=true}
 request3DRender();
}

// build 308: build the filtered C/S preview from the filtered blocks the GPU
// volume rebuild already makes (it used to filter the whole volume a second
// time in small tiled blocks: 1564 GPU filter calls instead of ~120).
let sharedPreview=null;
export function beginSharedMpr3DPreview(){
 const v=volume,stages=sourceFilterStages();if(!v||!stages.length||!v.sourceBacked)return null;
 const signature=mpr3DPreviewSignature(v,stages);
 if(mpr3DPreviewCache.signature===signature&&mpr3DPreviewCache.planes.coronal)return null;
 mpr3DPreviewCache.token++;mpr3DPreviewCache.building=false;
 const plan=mpr3DPreviewPlan(v),maxSide=plan.side,w=v.columns,h=v.rows,d=v.slices,min=Number.isFinite(v.min)?v.min:-1024,max=Number.isFinite(v.max)&&v.max>min?v.max:min+1,scale=255/(max-min);
 const dims={axial:null,coronal:[Math.min(w,maxSide),Math.min(d,maxSide)],sagittal:[Math.min(h,maxSide),Math.min(d,maxSide)]};
 const coronal=new Uint8Array(h*dims.coronal[0]*dims.coronal[1]),sagittal=new Uint8Array(w*dims.sagittal[0]*dims.sagittal[1]);
 const corX=Array.from({length:dims.coronal[0]},(_,i)=>mpr3DPreviewMap(i,w,dims.coronal[0])),sagY=Array.from({length:dims.sagittal[0]},(_,i)=>mpr3DPreviewMap(i,h,dims.sagittal[0]));
 const corRows=new Map(),sagRows=new Map();
 for(let py=0;py<dims.coronal[1];py++){const z=d-1-mpr3DPreviewMap(py,d,dims.coronal[1]);if(!corRows.has(z))corRows.set(z,[]);corRows.get(z).push(py)}
 for(let py=0;py<dims.sagittal[1];py++){const z=d-1-mpr3DPreviewMap(py,d,dims.sagittal[1]);if(!sagRows.has(z))sagRows.set(z,[]);sagRows.get(z).push(py)}
 const q=value=>Math.max(0,Math.min(255,Math.round((value-min)*scale))),need=new Set([...corRows.keys(),...sagRows.keys()]),done=new Set();
 sharedPreview={signature,needZ:need,
  feed(z,src){
   if(done.has(z)||!need.has(z))return;done.add(z);
   const cr=corRows.get(z);if(cr){const cw=dims.coronal[0],ch=dims.coronal[1];for(const py of cr)for(let y=0;y<h;y++){const row=y*cw*ch+py*cw,sy=y*w;for(let px=0;px<cw;px++)coronal[row+px]=q(src[sy+corX[px]])}}
   const sr=sagRows.get(z);if(sr){const sw=dims.sagittal[0],sh=dims.sagittal[1];for(const py of sr)for(let x=0;x<w;x++){const row=x*sw*sh+py*sw;for(let px=0;px<sw;px++)sagittal[row+px]=q(src[sagY[px]*w+x])}}
  },
  finish(ok){
   const me=sharedPreview;sharedPreview=null;
   if(!ok||!me||done.size<need.size||volume!==v)return false;
   mpr3DPreviewCache.signature=signature;mpr3DPreviewCache.min=min;mpr3DPreviewCache.max=max;mpr3DPreviewCache.dims=dims;mpr3DPreviewCache.planes={axial:null,coronal,sagittal};
   for(const p of ['coronal','sagittal'])refreshMpr3DPlaneTexture(p);request3DRender();return true;
  }};
 return sharedPreview;
}

function composeSectionCap(entry){
 const colors=entry.capColors;if(!colors)return;
 const {w,h,pixels:src,gray}=colors,canvas=entry.capCanvas;
 if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
 const ctx=canvas.getContext('2d');let image=entry.capImage;if(!image||image.width!==w||image.height!==h)image=entry.capImage=ctx.createImageData(w,h);
 const out=new Uint32Array(image.data.buffer),ca=sectionCapEnabled?Math.max(0,Math.min(1,sectionCapOpacity)):0,pa=sectionSliceImageVisible?Math.max(0,Math.min(1,mpr3DSurfaceOpacity)):0;
 const insideA=ca+(1-ca)*pa,ga=pa?Math.round(pa*255):0;
 for(let y=0,i=0;y<h;y++){
  const v=(y+.5)/h;
  for(let x=0;x<w;x++,i++){
   const g=gray[i],c=src[i];
   if(!c||!ca){out[i]=ga?((ga<<24)|(g<<16)|(g<<8)|g)>>>0:0;continue}
   let r=c&255,gg=(c>>8)&255,b=(c>>16)&255;
   if(sectionCapHatch){const f=((x+.5)/w+v)*28,stripe=Math.abs(f-Math.floor(f)-.5);if(stripe<.14){r*=.26;gg*=.26;b*=.26}}
   const k=(1-ca)*pa*g;
   out[i]=((Math.round(insideA*255)<<24)|(Math.round((b*ca+k)/insideA)<<16)|(Math.round((gg*ca+k)/insideA)<<8)|Math.round((r*ca+k)/insideA))>>>0;
  }
 }
 ctx.putImageData(image,0,0);entry.capTexture.needsUpdate=true;
}
export function setSectionCapColors(p,idx,w,h,pixels,gray){
 const entry=sceneState?.mprPlaneEntries?.[p];if(!entry?.cap)return;
 entry.capColors={w,h,pixels,gray};entry.capIdx=idx;entry.capHas=true;composeSectionCap(entry);syncSectionCapPresentation();request3DRender();
}
export function recomposeSectionCaps(){for(const entry of Object.values(sceneState?.mprPlaneEntries||{}))if(entry.cap)composeSectionCap(entry);syncSectionCapPresentation()}
export function syncSectionCapPresentation(){
 const volumeMode=threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active;
 for(const key of ['axial','coronal','sagittal']){
  const entry=sceneState?.mprPlaneEntries?.[key];if(!entry?.cap)continue;
  const section=!volumeMode&&sectionViewOpen&&sectionViewPlane===key;
  if(!section)entry.capHas=false;
  const face=section&&entry.capHas;
  entry.cap.visible=face;entry.cap.material.opacity=1;
  // the tinted 2D image stays only as the fallback before the first face is painted
  if(section)entry.mesh.visible=!face&&!!mpr3DVisibility[key]&&sectionSliceImageVisible;
  if(section&&face&&entry.highlight)entry.highlight.visible=false;
 }
}
