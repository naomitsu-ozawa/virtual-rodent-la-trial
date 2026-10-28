// start3D pieces that use no start3D-local mutable state (camera distance,
// pointer maps, fast-interaction flags stay in start3D). Statement bodies are
// verbatim from app.js; each factory takes the locals they used as parameters.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { WebGLRenderer } from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js';
import { frameYield } from './utils.js?v=20261027-build680';
import { tr } from './i18n.js?v=20261027-build680';
import { analysisCutScreen, analysisEditTargetMode, analysisEditTool, current3DVolume, sceneState, sectionViewOpen, sectionViewPlane, setAnalysisCutScreen, setAnalysisEditTargetKey, threeRenderMode, volume } from './state.js?v=20261027-build680';
import { planes, sectionPosition, threeEditOverlay, viewport } from './ui-shell.js?v=20261027-build680';
import { adoptRendererGpuDevice, adoptSplitGpuDevices, requestVrlGpuDevice, requestVrlPrimaryGpuDevice, requestVrlSplitRenderDevice, resetSplitGpuDevices } from './gpu-compute.js?v=20261027-build680';
import { request3DRender } from './scene3d.js?v=20261027-build680';
import { logGpuError } from './gpu-diagnostics.js?v=20261027-build680';
import { canvasBackground3d, onCanvasThemeChange } from './canvas-theme.js?v=20261027-build680';
import { updateMpr3DPlanePositions } from './mpr3d-overlay.js?v=20261027-build680';
import { gpuSegmentOrder, segmentState } from './segments.js?v=20261027-build680';
import { rebindWebGpuSectionClipGroup, sectionLocalPoint, updateSectionClipPlaneWorld, updateSectionViewUi, sectionLocalStep } from './section-view.js?v=20261027-build680';
import { renderSectionPlaneLive } from './mpr-render.js?v=20261027-build680';
import { cutPointerVoxel } from './analysis-ops.js?v=20261027-build680';
// Orientation axes widget attached to the camera (bottom-left XYZ).
export function makeAxisWidget(camera){
 const axisWidget=new THREE.Group();axisWidget.name='orientation_axes';camera.add(axisWidget);
 const axisLength=.22,axisOrigin=new THREE.Vector3(0,0,0),axisDefs=[['X',new THREE.Vector3(1,0,0),0xff5a5a],['Y',new THREE.Vector3(0,1,0),0x62d96b],['Z',new THREE.Vector3(0,0,1),0x5d8dff]];
 const makeAxisLabel=(label,color)=>{
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,64,64);ctx.font='700 30px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=5;ctx.strokeStyle='rgba(0,0,0,.85)';ctx.strokeText(label,32,33);ctx.fillStyle='#'+color.toString(16).padStart(6,'0');ctx.fillText(label,32,33);
  const texture=new THREE.CanvasTexture(canvas),material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}),sprite=new THREE.Sprite(material);sprite.scale.set(.09,.09,1);sprite.renderOrder=1002;return sprite;
 };
 for(const[label,dir,color]of axisDefs){
  const arrow=new THREE.ArrowHelper(dir,axisOrigin,axisLength,color,.055,.032);arrow.renderOrder=1001;arrow.line.material.depthTest=false;arrow.line.material.depthWrite=false;arrow.cone.material.depthTest=false;arrow.cone.material.depthWrite=false;axisWidget.add(arrow);
  const marker=makeAxisLabel(label,color);if(label==='Z')marker.position.set(.065,.065,.025);else marker.position.copy(dir).multiplyScalar(axisLength+.05);axisWidget.add(marker);
 }
 const updateAxisWidget=()=>{const depth=1.8,halfH=Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))*depth/Math.max(camera.zoom,1e-6),halfW=halfH*camera.aspect,pad=.16;axisWidget.position.set(-halfW+pad,-halfH+pad,-depth)};
 return{axisWidget,updateAxisWidget};
}
// WebGPU renderer on the shared VRL device when available, WebGL otherwise.
export async function create3DRenderer(){
 let renderer,backend='WEBGL';
 if('gpu' in navigator){
  try{
   // 「ハイブリッド環境での処理」 = primary GPU only (Linux hybrid): the display GPU creates the one device, no NVIDIA
   // device; null (not Linux / not that hybrid / setting 'hybrid') leaves the request exactly as before
   const core=await requestVrlPrimaryGpuDevice()||await requestVrlGpuDevice();
   // Linux hybrid (display Intel / compute NVIDIA) only: the renderer gets its own device on the display adapter and
   // compute keeps the NVIDIA device (gpu-split.js). Everywhere else this returns null at once and the code below is the old path.
   const split=await requestVrlSplitRenderDevice({computeAdapter:core.adapter});
   if(split){
    try{
     const splitRenderer=new THREE.WebGPURenderer({antialias:true,alpha:true,device:split.device});splitRenderer.setPixelRatio(Math.min(devicePixelRatio,2));await splitRenderer.init();
     adoptSplitGpuDevices(splitRenderer,core,split);renderer=splitRenderer;backend='WEBGPU';
    }catch(splitError){
     // the render device is unusable: back to one shared device (the NVIDIA one), as before.: whatever the
     // split had recorded (also after a half-done adoptSplitGpuDevices) is reset and the reason is shown in the status.
     console.warn('GPU split render device failed; using one shared device.',splitError);logGpuError('GPU split render device init',splitError);try{split.device.destroy?.()}catch{}
     resetSplitGpuDevices('render device init failed: '+String(splitError?.message||splitError).slice(0,160));
     renderer=null;backend='WEBGL';
    }
   }
   if(!renderer){
    const gpuRenderer=new THREE.WebGPURenderer({antialias:true,alpha:true,device:core.device});gpuRenderer.setPixelRatio(Math.min(devicePixelRatio,2));await gpuRenderer.init();renderer=gpuRenderer;backend='WEBGPU';adoptRendererGpuDevice(gpuRenderer,core.adapter,core.device);
   }
  }catch(error){
   console.warn('WebGPU core init failed; falling back to WebGL.',error);logGpuError('WebGPU renderer init',error);
  }
 }
 if(!renderer){
  renderer=new WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));backend='WEBGL';
 }
 // the background follows the theme (WebGL clear colour; the WebGPU canvas is transparent over the card's CSS backdrop)
 const applyThemeBackground=()=>{if(backend==='WEBGL'){const c=canvasBackground3d();if(c)renderer.setClearColor(new THREE.Color('rgb('+c.join(',')+')'),1)}};
 applyThemeBackground();onCanvasThemeChange(()=>{applyThemeBackground();request3DRender()});
 return{renderer,backend};
}
// 3D view overlays: rotation pivot indicator, view buttons container and the help button/panel.
export function makeViewOverlays(renderer){
 const pivotIndicator=document.createElement('div');
 Object.assign(pivotIndicator.style,{position:'absolute',left:'50%',top:'50%',width:'18px',height:'18px',transform:'translate(-50%,-50%)',border:'1px solid rgba(255,255,255,.78)',boxShadow:'0 0 0 1px rgba(0,0,0,.55),inset 0 0 0 1px rgba(0,0,0,.35)',borderRadius:'50%',boxSizing:'border-box',pointerEvents:'none',zIndex:'12',opacity:'0',transition:'opacity 90ms linear'});
 const pivotDot=document.createElement('div');Object.assign(pivotDot.style,{position:'absolute',left:'50%',top:'50%',width:'4px',height:'4px',transform:'translate(-50%,-50%)',borderRadius:'50%',background:'rgba(255,255,255,.92)',boxShadow:'0 0 0 1px rgba(0,0,0,.55)'});
 pivotIndicator.appendChild(pivotDot);viewport.appendChild(pivotIndicator);
 const ws=document.documentElement.classList.contains('vrl-ipad-ui');
 const viewControls=document.createElement('div');viewControls.setAttribute('aria-label','3D view controls');viewControls.className='three-view-controls';
 Object.assign(viewControls.style,{position:'absolute',right:'10px',bottom:'10px',display:'flex',gap:'5px',padding:'5px',border:'1px solid rgba(122,145,154,.55)',borderRadius:'9px',background:'rgba(10,14,16,.78)',backdropFilter:'blur(5px)',zIndex:'13',pointerEvents:'auto'});
 const makeViewButton=(label,title,handler)=>{
  const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);
  Object.assign(b.style,{minWidth:'34px',height:'34px',padding:'0 8px',border:'1px solid rgba(128,151,160,.6)',borderRadius:'7px',background:'rgba(25,33,37,.92)',color:'#e8f0f2',font:'600 13px -apple-system,BlinkMacSystemFont,sans-serif',cursor:'pointer'});
  b.addEventListener('pointerdown',e=>e.stopPropagation());b.addEventListener('click',e=>{e.stopPropagation();handler()});if(ws&&helpButton.parentNode===viewControls)viewControls.insertBefore(b,helpButton);else viewControls.appendChild(b);return b;
 };
 viewport.appendChild(viewControls);

 const helpButton=document.createElement('button');
 helpButton.type='button';helpButton.textContent='?';helpButton.title=tr('threeHelp');helpButton.setAttribute('aria-label',tr('threeHelp'));helpButton.setAttribute('aria-expanded','false');helpButton.className='three-help-button';
 Object.assign(helpButton.style,{position:'absolute',right:'10px',bottom:'55px',width:'36px',height:'36px',padding:'0',border:'1px solid rgba(128,151,160,.62)',borderRadius:'50%',background:'rgba(25,33,37,.9)',color:'#e8f0f2',font:'700 16px -apple-system,BlinkMacSystemFont,sans-serif',cursor:'pointer',zIndex:'14',pointerEvents:'auto',boxShadow:'none'});

 const helpPanel=document.createElement('div');
 helpPanel.className='three-help-panel';helpPanel.setAttribute('role','dialog');helpPanel.setAttribute('aria-label',tr('threeHelp'));
 Object.assign(helpPanel.style,{position:'absolute',right:'10px',bottom:'98px',width:'min(290px,calc(100% - 20px))',maxHeight:'min(360px,70%)',overflow:'auto',display:'none',padding:'10px 11px',border:'1px solid rgba(122,145,154,.58)',borderRadius:'10px',background:'rgba(10,14,16,.94)',backdropFilter:'blur(7px)',color:'#e8f0f2',font:'12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif',zIndex:'15',pointerEvents:'auto',boxSizing:'border-box'});
 const helpSection=(title,items)=>{
  const section=document.createElement('section');section.style.marginBottom='8px';
  const h=document.createElement('strong');h.textContent=title;Object.assign(h.style,{display:'block',marginBottom:'4px',fontSize:'12px',color:'#d7e4e8'});section.appendChild(h);
  for(const item of items){const row=document.createElement('div');row.textContent=item;Object.assign(row.style,{padding:'2px 0',color:'#bfcfd5'});section.appendChild(row)}
  return section;
 };
 const rebuildHelpPanel=()=>{
  helpButton.title=tr('threeHelp');helpButton.setAttribute('aria-label',tr('threeHelp'));helpPanel.setAttribute('aria-label',tr('threeHelp'));helpPanel.replaceChildren();
  const head=document.createElement('div');Object.assign(head.style,{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',marginBottom:'8px'});
  const title=document.createElement('strong');title.textContent=tr('threeHelp');title.style.fontSize='13px';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close');Object.assign(close.style,{width:'30px',height:'30px',padding:'0',border:'0',borderRadius:'6px',background:'transparent',color:'#d7e4e8',fontSize:'18px',cursor:'pointer'});close.addEventListener('click',()=>setHelpOpen(false));
  head.append(title,close);helpPanel.appendChild(head);
  helpPanel.appendChild(helpSection(tr('threeHelpMouse'),[tr('threeHelpRotate'),tr('threeHelpRoll'),tr('threeHelpPan'),tr('threeHelpZoom')]));
  helpPanel.appendChild(helpSection(tr('threeHelpTouch'),[tr('threeHelpTouchRotate'),tr('threeHelpTouchGesture')]));
  helpPanel.appendChild(helpSection(tr('threeHelpQuick'),[tr('threeHelpAxis'),tr('threeHelpStep'),tr('threeHelpPivot')]));
 };
 const setHelpOpen=open=>{const yes=!!open;helpPanel.style.display=yes?'block':'none';helpButton.setAttribute('aria-expanded',yes?'true':'false');if(yes)rebuildHelpPanel()};
 helpButton.addEventListener('pointerdown',e=>e.stopPropagation());helpButton.addEventListener('click',e=>{e.stopPropagation();setHelpOpen(helpPanel.style.display==='none')});
 helpPanel.addEventListener('pointerdown',e=>e.stopPropagation());
 renderer.domElement.addEventListener('pointerdown',()=>setHelpOpen(false));
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&helpPanel.style.display!=='none')setHelpOpen(false)});
 if(ws){viewControls.append(helpButton);viewport.append(helpPanel)} // the ? joins the row (after X Y Z, see makeViewButton)
 else viewport.append(helpButton,helpPanel);

 const showViewPivot=()=>{pivotIndicator.style.opacity='1'};
 const hideViewPivot=()=>{pivotIndicator.style.opacity='0'};
 return{pivotIndicator,makeViewButton,showViewPivot,hideViewPivot};
}
// Rotations of the scene object around the view-centre pivot.
export function makeViewRotation(camera){
 const viewCenterPivot=()=>{
  if(!sceneState.obj)return new THREE.Vector3();
  camera.updateMatrixWorld(true);sceneState.obj.updateMatrixWorld(true);
  const camPos=camera.getWorldPosition(new THREE.Vector3()),forward=camera.getWorldDirection(new THREE.Vector3()).normalize(),objOrigin=sceneState.obj.getWorldPosition(new THREE.Vector3());
  const depth=Math.max(.01,objOrigin.clone().sub(camPos).dot(forward));
  return camPos.addScaledVector(forward,depth);
 };
 const rotateAroundViewCenter=(dx,dy)=>{
  const obj=sceneState.obj;if(!obj)return;
  const pivot=viewCenterPivot(),qYaw=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),dx*.008),qPitch=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),dy*.008);
  obj.position.sub(pivot).applyQuaternion(qYaw).add(pivot);obj.quaternion.premultiply(qYaw);
  obj.position.sub(pivot).applyQuaternion(qPitch).add(pivot);obj.quaternion.premultiply(qPitch);obj.quaternion.normalize();
 };
 const applyQuaternionAroundViewCenter=q=>{
  const obj=sceneState.obj;if(!obj)return;
  const pivot=viewCenterPivot();obj.position.sub(pivot).applyQuaternion(q).add(pivot);obj.quaternion.premultiply(q);obj.quaternion.normalize();
 };
 const rollAroundViewCenter=angle=>{
  if(!sceneState.obj||!Number.isFinite(angle)||Math.abs(angle)<1e-7)return;
  const axis=camera.getWorldDirection(new THREE.Vector3()).normalize();
  applyQuaternionAroundViewCenter(new THREE.Quaternion().setFromAxisAngle(axis,angle));
 };
 return{viewCenterPivot,rotateAroundViewCenter,applyQuaternionAroundViewCenter,rollAroundViewCenter};
}
// Cut stroke (pen/line/lasso) screen handling and surface projection, and section-plane dragging.
export function makeCutTools(renderer,camera){
 const cutSamplesToSurfaceStroke=(samples,mode='pen',screenCurve=null)=>{
  if(!samples?.length||!sceneState?.obj||!volume)return[];
  const v=current3DVolume||volume,[vx,vy,vz]=v.spacing,w=v.columns,h=v.rows,d=v.slices,px=w*vx,py=h*vy,pz=d*vz,scale=3.3/Math.max(px,py,pz,1),rect=renderer.domElement.getBoundingClientRect();
  sceneState.obj.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const drawn=screenCurve?.length?screenCurve:samples.map(sample=>sample.screen);
  const nearestPointOnStroke=(p)=>{
   let best=null,bestD2=Infinity;if(drawn.length===1)return{x:drawn[0].x,y:drawn[0].y,d2:(p.x-drawn[0].x)**2+(p.y-drawn[0].y)**2};
   for(let i=0;i<drawn.length-1;i++){const a=drawn[i],b=drawn[i+1],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy,t=len2>1e-9?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2)):0,qx=a.x+dx*t,qy=a.y+dy*t,d2=(p.x-qx)*(p.x-qx)+(p.y-qy)*(p.y-qy);if(d2<bestD2){bestD2=d2;best={x:qx,y:qy,d2}}}
   return best;
  };
  let anchorWorld=null,anchorMeta=null,anchorScreen=null,bestCameraD2=Infinity;
  if(threeRenderMode==='volume'){
   for(const sample of samples){const surface=sample?.surface;if(!surface)continue;const local=new THREE.Vector3(((surface.x+.5)*vx-px/2)*scale,-((surface.y+.5)*vy-py/2)*scale,((surface.z+.5)*vz-pz/2)*scale),world=local.applyMatrix4(sceneState.obj.matrixWorld),cameraD2=world.distanceToSquared(camera.position);if(cameraD2<bestCameraD2){bestCameraD2=cameraD2;anchorWorld=world;anchorMeta=surface;const ndc=world.clone().project(camera);anchorScreen={x:(ndc.x+1)*.5*Math.max(rect.width,1),y:(1-ndc.y)*.5*Math.max(rect.height,1)}}}
  }else{
   const seen=new Set();
   for(const sample of samples){const surface=sample?.surface,hit=surface?.hit,geom=hit?.object?.geometry,pos=geom?.getAttribute?.('position'),face=hit?.face;if(!pos||!face)continue;for(const vi of [face.a,face.b,face.c]){const id=(hit.object.uuid||'mesh')+':'+vi;if(seen.has(id))continue;seen.add(id);const world=new THREE.Vector3().fromBufferAttribute(pos,vi).applyMatrix4(hit.object.matrixWorld),cameraD2=world.distanceToSquared(camera.position);if(cameraD2<bestCameraD2){bestCameraD2=cameraD2;anchorWorld=world;anchorMeta=surface;const ndc=world.clone().project(camera);anchorScreen={x:(ndc.x+1)*.5*Math.max(rect.width,1),y:(1-ndc.y)*.5*Math.max(rect.height,1)}}}}
  }
  if(!anchorWorld||!anchorMeta||!anchorScreen)return[];
  const curveContact=nearestPointOnStroke(anchorScreen);if(!curveContact)return[];
  const shiftX=anchorScreen.x-curveContact.x,shiftY=anchorScreen.y-curveContact.y,anchorNdc=anchorWorld.clone().project(camera);
  const toVoxel=world=>{const local=sceneState.obj.worldToLocal(world.clone());return{x:(local.x/scale+px/2)/vx,y:(-local.y/scale+py/2)/vy,z:(local.z/scale+pz/2)/vz,ray:{...anchorMeta.ray},right:{...anchorMeta.right},up:{...anchorMeta.up},key:anchorMeta.key}};
  const full=drawn.map(screen=>{const x=screen.x+shiftX,y=screen.y+shiftY,ndcX=(x/Math.max(rect.width,1))*2-1,ndcY=-(y/Math.max(rect.height,1))*2+1;return toVoxel(new THREE.Vector3(ndcX,ndcY,anchorNdc.z).unproject(camera))});
  if(mode==='line'&&full.length>1)return[full[0],full[full.length-1]];return full;
 };
 const sectionDragHit=e=>{
  if(!sectionViewOpen||!sectionViewPlane||analysisEditTool!=='select'||threeRenderMode!=='surface'||!sceneState.obj)return null;
  const entry=sceneState.mprPlaneEntries?.[sectionViewPlane];if(!entry?.mesh?.visible)return null;
  const rect=renderer.domElement.getBoundingClientRect(),mouse=new THREE.Vector2(((e.clientX-rect.left)/Math.max(rect.width,1))*2-1,-((e.clientY-rect.top)/Math.max(rect.height,1))*2+1),raycaster=new THREE.Raycaster();raycaster.setFromCamera(mouse,camera);
  const targets=[entry.mesh,entry.highlight].filter(Boolean);return raycaster.intersectObjects(targets,false)[0]||null;
 };
 const sectionScreenStep=()=>{
  const p=sectionViewPlane,point=sectionLocalPoint(p),step=sectionLocalStep(p);if(!p||!point||!step||!sceneState.obj)return null;
  sceneState.obj.updateMatrixWorld(true);
  const a=point.clone().applyMatrix4(sceneState.obj.matrixWorld).project(camera),b=point.clone().add(step).applyMatrix4(sceneState.obj.matrixWorld).project(camera),rect=renderer.domElement.getBoundingClientRect();
  const x=(b.x-a.x)*rect.width*.5,y=-(b.y-a.y)*rect.height*.5,len2=x*x+y*y;return len2>=.25?{x,y,len2}:null;
 };
 const dragSectionPlane=(start,e)=>{
  const p=start?.sectionPlane;if(!p||sectionViewPlane!==p||!planes[p])return;
  const step=start.sectionScreenStep,dx=e.clientX-start.x,dy=e.clientY-start.y,delta=step?Math.round((dx*step.x+dy*step.y)/step.len2):Math.round(-dy/8),max=+planes[p].slider.max,idx=Math.max(0,Math.min(max,start.sectionIndex+delta));
  if(idx===+planes[p].slider.value)return;
  planes[p].slider.value=idx;planes[p].label.textContent=idx+1;if(sectionPosition)sectionPosition.value=idx;
  updateMpr3DPlanePositions();updateSectionClipPlaneWorld();rebindWebGpuSectionClipGroup();updateSectionViewUi();request3DRender();renderSectionPlaneLive(p);
 };
 const drawEditStroke=mode=>{const ctx=threeEditOverlay?.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,threeEditOverlay.width,threeEditOverlay.height);if(!analysisCutScreen.length)return;ctx.save();ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash(mode==='line'?[8,5]:[]);ctx.beginPath();ctx.moveTo(analysisCutScreen[0].x,analysisCutScreen[0].y);for(let i=1;i<analysisCutScreen.length;i++)ctx.lineTo(analysisCutScreen[i].x,analysisCutScreen[i].y);if(mode==='lasso'){ctx.closePath();ctx.fillStyle='rgba(0,229,255,.12)';ctx.fill()}ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;ctx.stroke();ctx.restore()}; // dark outline: readable on a light background too
 const appendCutScreenPoints=(e,mode)=>{
  const rect=renderer.domElement.getBoundingClientRect(),events=typeof e.getCoalescedEvents==='function'&&e.getCoalescedEvents().length?e.getCoalescedEvents():[e];
  for(const ce of events){
   const p={x:ce.clientX-rect.left,y:ce.clientY-rect.top};
   if(mode==='line'){setAnalysisCutScreen([analysisCutScreen[0],p]);continue}
   const last=analysisCutScreen[analysisCutScreen.length-1];if(!last||Math.hypot(p.x-last.x,p.y-last.y)>=.65)analysisCutScreen.push(p);
  }
  drawEditStroke(mode);
 };
 const resampleCutScreenCurve=(curve,step=3)=>{
  if(!curve?.length)return[];if(curve.length===1)return[{...curve[0]}];
  const out=[{...curve[0]}];let carry=0;
  for(let i=1;i<curve.length;i++){
   const a=curve[i-1],b=curve[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<1e-6)continue;
   let dist=step-carry;
   while(dist<=len){const t=dist/len;out.push({x:a.x+dx*t,y:a.y+dy*t});dist+=step}
   carry=Math.max(0,len-(dist-step));
  }
  const last=curve[curve.length-1],tail=out[out.length-1];if(!tail||Math.hypot(last.x-tail.x,last.y-tail.y)>.5)out.push({...last});
  return out;
 };
 const collectCutSurfaceSamples=async(screenCurve)=>{
  const rect=renderer.domElement.getBoundingClientRect(),samples=[];let preferred=analysisEditTargetMode==='auto'?null:analysisEditTargetMode;
  const volumeMode=threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active;
  const volumeMeta=(picked,screen)=>{
   if(!picked)return null;sceneState.obj.updateMatrixWorld(true);camera.updateMatrixWorld(true);
   const mouse=new THREE.Vector2((screen.x/Math.max(rect.width,1))*2-1,-(screen.y/Math.max(rect.height,1))*2+1),raycaster=new THREE.Raycaster();raycaster.setFromCamera(mouse,camera);
   const inv=sceneState.obj.matrixWorld.clone().invert(),toVoxelDir=vec=>{const q=vec.clone().transformDirection(inv).normalize();return{x:q.x,y:-q.y,z:q.z}};
   return{...picked,ray:toVoxelDir(raycaster.ray.direction),right:toVoxelDir(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0)),up:toVoxelDir(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1)),hit:null,volume:true};
  };
  const probe=async step=>{
   const points=resampleCutScreenCurve(screenCurve,step);let hitCount=0;
   if(volumeMode){
    const clients=points.map(p=>({clientX:rect.left+p.x,clientY:rect.top+p.y}));
    let picked;
    if(!preferred){
     const auto=await sceneState.medicalVolume.pickMany(clients,camera,sceneState.obj,segmentState,gpuSegmentOrder(),null),first=auto.find(Boolean);preferred=first?.key||null;
     if(!preferred){for(const screen of points)samples.push({screen,surface:null});return 0}
    }
    picked=await sceneState.medicalVolume.pickMany(clients,camera,sceneState.obj,segmentState,gpuSegmentOrder(),preferred);
    for(let i=0;i<points.length;i++){const surface=volumeMeta(picked[i],points[i]);samples.push({screen:points[i],surface});if(surface)hitCount++}
   }else{
    for(let i=0;i<points.length;i++){const screen=points[i],surface=cutPointerVoxel({clientX:rect.left+screen.x,clientY:rect.top+screen.y},renderer.domElement,camera,preferred);samples.push({screen,surface});if(surface){hitCount++;if(analysisEditTargetMode==='auto'&&!preferred)preferred=surface.key||null}if((i&63)===63)await frameYield()}
   }
   return hitCount;
  };
  const primaryStep=volumeMode?3:(sceneState?.cutRaycastAccelerated?3:6);let hits=await probe(primaryStep);
  if(!hits&&primaryStep>2)hits=await probe(2);
  if(analysisEditTargetMode==='auto')setAnalysisEditTargetKey(preferred);else setAnalysisEditTargetKey(analysisEditTargetMode);
  return samples;
 };
 return{cutSamplesToSurfaceStroke,sectionDragHit,sectionScreenStep,dragSectionPlane,drawEditStroke,appendCutScreenPoints,resampleCutScreenCurve,collectCutSurfaceSamples};
}
