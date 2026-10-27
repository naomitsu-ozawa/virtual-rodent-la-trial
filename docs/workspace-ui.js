// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { set3DBusy } from './three-status.js?v=20261027-build680';
import { useWorkspaceUi, updateRenderModeControl, clearResidentMprJobs, prepareResidentGpuVolume, activateMedicalVolume, setThreeVolumeOverlay } from './data-load.js?v=20261027-build680';
import { appVersionBadge, planes, ipadGpuQualityControl, ipadGpuQuality, footer } from './ui-shell.js?v=20261027-build680';
import { sceneState, volume, currentLanguage, ipadGpuTargetSide, setIpadGpuTargetSide, sourceVolume, threeRenderMode, setResidentMprReadbackDisabled, setThreeRenderMode } from './state.js?v=20261027-build680';
import { updateMprCanvasPhysicalAspect, schedulePlaneRender } from './mpr-render.js?v=20261027-build680';
import { request3DRender } from './scene3d.js?v=20261027-build680';
import { applyLanguage } from './i18n.js?v=20261027-build680';
import { isIPhoneRuntime, isTabletRuntime, isVrHeadsetRuntime, fmt } from './utils.js?v=20261027-build680';
import { settings } from './app-settings.js?v=20261027-build680';
export function initIPadWorkspaceUi(){
 if(!useWorkspaceUi())return;
 const shell=document.querySelector('.app-shell'),workspace=document.querySelector('.workspace'),sidebar=document.querySelector('.sidebar'),sidebarScroll=document.querySelector('.sidebar-scroll'),viewer=document.querySelector('#viewer-grid'),topbar=document.querySelector('.topbar');
 if(!shell||!workspace||!sidebar||!sidebarScroll||!viewer||!topbar)return;
 document.documentElement.classList.add('vrl-ipad-ui','ipad-settings-persistent');
 shell.classList.add('ipad-mode-3d');

 const toolbar=document.createElement('div');
 toolbar.id='ipad-workspace-toolbar';toolbar.className='ipad-workspace-toolbar';
 toolbar.innerHTML='<div class="ipad-view-modes" role="group" aria-label="View mode"><button type="button" class="is-active" data-ipad-view-mode="3d" data-i18n="ipadView3d">3D</button><button type="button" data-ipad-view-mode="2d" data-i18n="ipadView2d">2D</button><button type="button" data-ipad-view-mode="split" data-i18n="ipadViewSplit">分割</button></div><div class="ipad-mpr-tabs" role="tablist" aria-label="MPR plane"><button type="button" class="is-active" data-ipad-mpr="axial">Axial</button><button type="button" data-ipad-mpr="coronal">Coronal</button><button type="button" data-ipad-mpr="sagittal">Sagittal</button></div>';
 topbar.after(toolbar);
 const cap=(key,text)=>{const c=document.createElement('span');c.className='ws-cap';c.dataset.i18n=key;c.textContent=text;return c};
 const sep=()=>{const d=document.createElement('span');d.className='ws-sep';d.setAttribute('aria-hidden','true');return d};
 toolbar.prepend(cap('wsScreen','画面'));
 const mprTabs=toolbar.querySelector('.ipad-mpr-tabs');
 // the 2D plane group only means something with 2D views on screen (2D / 分割) - hidden in 3D (.ws-2d-only)
 if(mprTabs){const s2=sep();s2.classList.add('ws-2d-only');mprTabs.classList.add('ws-2d-only');mprTabs.before(s2);mprTabs.prepend(cap('ws2dPlane','2D断面'))}
 const overlay3d=document.querySelector('.three-overlay-controls'),gpuToggle=document.querySelector('#render-mode-toggle');
 if(overlay3d){
  if(gpuToggle)overlay3d.prepend(gpuToggle);
  overlay3d.prepend(cap('ws3dOverlay','3D重ね'));overlay3d.classList.add('ws-3d-only');
  const s3=sep();s3.classList.add('ws-3d-only');toolbar.append(s3,overlay3d);
 }

 const settingsHead=document.createElement('div');settingsHead.className='ipad-drawer-head ipad-settings-head';
 settingsHead.innerHTML='<strong data-i18n="ipadSettings">設定</strong>';
 sidebar.insertBefore(settingsHead,sidebarScroll);
 const headTitle=settingsHead.querySelector('strong');

 const panels=[...sidebarScroll.querySelectorAll(':scope > .panel')];
 const dataPanel=panels[0]||null,displayPanel=panels.find(p=>p.classList.contains('compact-panel'))||panels[1]||null;
 const section=key=>{const el=document.createElement('section');el.className='panel ws-tool-panel';el.dataset.ipadDrawerSection=key;
  return el}; // the panel's title is the sidebar head (the active tool's name)
 const moveInto=(target,selectors)=>{for(const q of selectors)for(const el of [...document.querySelectorAll(q)])target.append(el)};
 if(dataPanel){
  dataPanel.dataset.ipadDrawerSection='data';
  // open / save at the top of the データ panel (the same buttons, moved: ids, handlers and i18n are unchanged)
  const q=id=>document.getElementById(id),open=[q('sample-demo-button')].filter(Boolean);
  if(open.length){
   const box=document.createElement('div');box.className='ws-file-actions';
   const row=(key,text,btns)=>{if(!btns.length)return;const r=document.createElement('div');r.className='ws-file-row';r.append(cap(key,text),...btns);box.append(r)};
   row('wsFileOpen','データ',open);
   dataPanel.prepend(box);
   const choices=document.querySelector('#sample-dialog .sample-choices');
   if(choices&&box.firstElementChild){
    const picker=document.createElement('div');picker.id='ws-sample-picker';picker.className='ws-sample-picker';picker.inert=true;
    const inner=document.createElement('div');inner.className='ws-sample-inner';inner.append(cap('sampleChoose','練習データを選ぶ'),choices);
    picker.append(inner);box.firstElementChild.after(picker);
    const empty=dataPanel.querySelector('.empty-state');
    if(empty){const b=document.createElement('button');b.type='button';b.className='secondary-button ws-empty-sample';b.dataset.i18n='sampleTry';b.textContent='練習データを試す';
     b.onclick=()=>{if(!picker.classList.contains('is-open'))q('sample-demo-button')?.click();picker.scrollIntoView?.({block:'nearest',behavior:'smooth'})};empty.append(b)}
   }
  }
 }
 if(displayPanel)displayPanel.dataset.ipadDrawerSection='display';
 const segPanel=section('segment'),filterPanel=section('filter');
 if(displayPanel){
  moveInto(segPanel,['.compact-panel > .segment-heading','.compact-panel > .segment-add-row','.compact-panel > .segment-exclusive-row','.compact-panel > #segment-controls','.compact-panel > .surface-smooth-card']);
  moveInto(filterPanel,['.compact-panel > .filter-add-row','.compact-panel > .filter-3d-commit','.compact-panel > .filter-control-list']);
  displayPanel.after(segPanel,filterPanel);
 }
 const editDetails=document.querySelector('.three-edit-panel');
 if(editDetails){
  const editPanel=document.createElement('section');editPanel.className='panel ipad-edit-drawer-panel';editPanel.dataset.ipadDrawerSection='edit';
  editPanel.appendChild(editDetails);sidebarScroll.appendChild(editPanel);editDetails.open=true;
 }
 const ctRange=document.querySelector('.ct-range-mode'),gpuQuality=document.querySelector('#ipad-gpu-quality-control'),mprOpacity=document.querySelector('.mpr-opacity-settings');
 if(displayPanel&&ctRange&&gpuQuality){gpuQuality.classList.remove('is-hidden');gpuQuality.style.display='inline-flex';ctRange.insertAdjacentElement('afterend',gpuQuality)}
 if(displayPanel&&mprOpacity)displayPanel.appendChild(mprOpacity);

 // 解析: the tool buttons (analysis-dock.js fills [data-tool-buttons]), the HU results host, then the section / volume analysis settings + results
 const analysisPanel=section('analysis');
 const aButtons=document.createElement('div');aButtons.className='ws-tool-buttons';aButtons.dataset.toolButtons='analysis';
 const aHost=document.createElement('div');aHost.className='ws-result-host';aHost.dataset.resultHost='analysis';
 const analysisSettings=document.createElement('div');analysisSettings.className='ipad-analysis-settings';
 const sectionResult=document.querySelector('#section-view-result'),analysisResult=document.querySelector('#volume-analysis-result');
 if(sectionResult)analysisSettings.appendChild(sectionResult);
 if(analysisResult)analysisSettings.appendChild(analysisResult);
 analysisPanel.append(aButtons,analysisSettings,aHost);sidebarScroll.appendChild(analysisPanel);
 const hasCrop=!!document.querySelector('#crop-export-toggle');
 if(hasCrop){
  const cropPanel=section('crop');
  const cButtons=document.createElement('div');cButtons.className='ws-tool-buttons';cButtons.dataset.toolButtons='crop';
  const cHost=document.createElement('div');cHost.className='ws-result-host';cHost.dataset.resultHost='crop';
  cropPanel.append(cButtons,cHost);sidebarScroll.appendChild(cropPanel);
 }

 const byId=id=>document.getElementById(id);
 // VR / AR buttons stay in the top bar (#vr-view-button / #ar-view-button in .topbar-actions): reachable whichever tool panel is open. Their `hidden`
 // (shown only where WebXR reports the session type as supported, app.js xrShow) is not touched here. Until this build they were moved into the 表示 panel.
 const prefsPanel=section('prefs');
 const prefRow=(key,text,el)=>{if(!el)return;const r=document.createElement('div');r.className='ws-pref-row';r.append(cap(key,text),el);prefsPanel.append(r)};
 prefRow('wsTheme','外観',document.querySelector('.theme-quick'));
 prefRow('wsLanguage','言語',byId('language-toggle'));
 const dlg=byId('settings-dialog'),openBtn=byId('settings-open');
 if(dlg){
  const embed=document.createElement('div');embed.className='ws-settings-embed';
  for(const el of [...dlg.children])if(!el.classList.contains('settings-head'))embed.append(el);
  prefsPanel.append(embed);dlg.dataset.embedded='1';
 }
 if(openBtn){openBtn.hidden=true;prefsPanel.append(openBtn)}
 sidebarScroll.appendChild(prefsPanel);

 const TOOLS=[['data','ipadData','データ'],['display','toolDisplay','表示'],['segment','toolSegment','セグメント'],['filter','toolFilter','フィルター'],['edit','ipadEdit','3D編集'],['analysis','wsAnalysis','解析'],...(hasCrop?[['crop','cropTitle','切り出し']]:[]),['prefs','settingsTitle','設定']];
 const drawerTabs=document.createElement('nav');drawerTabs.className='ipad-drawer-tabs ws-tool-rail';drawerTabs.setAttribute('aria-label','Tools');
 const ICON={data:'<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  display:'<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  segment:'<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12 9.5 5 9.5-5"/><path d="m2.5 16 9.5 5 9.5-5"/>',
  filter:'<path d="M3 4.5h18l-7 8.5v6l-4 2v-8z"/>',
  edit:'<circle cx="6" cy="6.5" r="2.8"/><circle cx="6" cy="17.5" r="2.8"/><path d="M8.2 8.2 20 18.5M8.2 15.8 20 5.5"/>',
  analysis:'<path d="M3 20.5h18"/><path d="M6.5 20.5v-6M11.5 20.5V8M16.5 20.5v-9.5"/>',
  crop:'<path d="M6.5 2.5v15h15"/><path d="M2.5 6.5h15v15"/>',
  prefs:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'};
 drawerTabs.innerHTML=TOOLS.map(([k,key,t])=>'<button type="button" data-ipad-drawer-tab="'+k+'"><svg class="ws-rail-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(ICON[k]||'')+'</svg><span class="ws-rail-label" data-i18n="'+key+'">'+t+'</span></button>').join('');
 sidebar.insertBefore(drawerTabs,settingsHead);

 const footerBar=document.querySelector('.app-shell > footer');
 if(appVersionBadge&&footerBar)footerBar.appendChild(appVersionBadge);

 let drawerTab='display',viewMode='3d',mprPlane='axial';
 let layoutRefreshToken=0;
 const refreshLayout=()=>{
  const token=++layoutRefreshToken;
  const run=()=>{
   if(token!==layoutRefreshToken)return;
   sigNow=viewerSig(); // what the views were laid out for (refreshLayoutIfMoved compares against it)
   try{sceneState?.resize?.()}catch{}
   try{if(volume)for(const p of Object.keys(planes))updateMprCanvasPhysicalAspect(p)}catch{}
   try{request3DRender()}catch{}
  };
  requestAnimationFrame(()=>{run();requestAnimationFrame(run)});
  setTimeout(run,120);
 };
 const viewerSig=()=>{const r=viewer.getBoundingClientRect();return[r.left,r.top,r.width,r.height].map(Math.round).join()};
 let sigNow=null;
 const refreshLayoutIfMoved=()=>requestAnimationFrame(()=>{if(viewerSig()!==sigNow)refreshLayout()});
 const EVENT_TABS=['data','prefs'];
 const eventOn=()=>{try{return settings.get('eventMode')===true}catch{return false}};
 const setDrawerTab=tab=>{
  if(eventOn()&&!EVENT_TABS.includes(tab))tab='data';
  if(tab==='prefs')document.dispatchEvent(new Event('vrl-settings-sync')); // the embedded settings show the stored values
  drawerTab=tab;
  drawerTabs.querySelectorAll('[data-ipad-drawer-tab]').forEach(b=>b.classList.toggle('is-active',b.dataset.ipadDrawerTab===tab));
  const active=drawerTabs.querySelector('[data-ipad-drawer-tab="'+tab+'"] .ws-rail-label');if(headTitle&&active){headTitle.dataset.i18n=active.dataset.i18n;headTitle.textContent=active.textContent}
  sidebarScroll.querySelectorAll('[data-ipad-drawer-section]').forEach(p=>p.classList.toggle('is-ipad-drawer-hidden',p.dataset.ipadDrawerSection!==tab));
  if(tab==='edit'&&editDetails)editDetails.open=true;
  // Switching the tool panel only changes the sidebar's content: the views keep their place and size, so nothing is resized or re-rendered
  // (it used to run the 3D resize + a re-render 3 times per switch - a clear of the canvas and up to 3 volume renders on the click). Only when the viewer area moved.
  refreshLayoutIfMoved();
 };
 const onSettingsTabRequest=e=>{
  const tab=e?.detail?.tab;
  if(TOOLS.some(t=>t[0]===tab))setDrawerTab(tab);
 };
 document.addEventListener('vrl-ipad-settings-tab',onSettingsTabRequest);

 // the 2D tab takes part in the shared plane selection (app.js selectPlane)
 const setMprPlane=(plane,fromSync=false)=>{
  mprPlane=['axial','coronal','sagittal'].includes(plane)?plane:'axial';
  if(!fromSync)document.dispatchEvent(new CustomEvent('vrl-plane-chosen',{detail:{plane:mprPlane,source:'workspace'}}));
  toolbar.querySelectorAll('[data-ipad-mpr]').forEach(b=>b.classList.toggle('is-active',b.dataset.ipadMpr===mprPlane));
  document.querySelectorAll('#sub-view-slots .view-slot-sub').forEach(slot=>slot.classList.toggle('is-ipad-active',slot.querySelector('[data-view-key]')?.dataset.viewKey===mprPlane));
  try{schedulePlaneRender(mprPlane,true)}catch{}
  refreshLayout();
 };
 const setViewMode=mode=>{
  viewMode=['3d','2d','split'].includes(mode)?mode:'3d';
  shell.classList.remove('ipad-mode-3d','ipad-mode-2d','ipad-mode-split');shell.classList.add('ipad-mode-'+viewMode);
  toolbar.querySelectorAll('[data-ipad-view-mode]').forEach(b=>b.classList.toggle('is-active',b.dataset.ipadViewMode===viewMode));
  setMprPlane(mprPlane,true);
 };
 drawerTabs.querySelectorAll('[data-ipad-drawer-tab]').forEach(b=>b.addEventListener('click',()=>setDrawerTab(b.dataset.ipadDrawerTab)));
 const applyEventMenu=()=>{
  const on=eventOn();
  drawerTabs.querySelectorAll('[data-ipad-drawer-tab]').forEach(x=>{const hide=on&&!EVENT_TABS.includes(x.dataset.ipadDrawerTab);x.hidden=hide;x.style.display=hide?'none':''});
  if(on&&!EVENT_TABS.includes(drawerTab))setDrawerTab('data');
 };
 window.addEventListener('vrl-settings',e=>{if(e.detail?.key==='eventMode')applyEventMenu()});
 toolbar.querySelectorAll('[data-ipad-view-mode]').forEach(b=>b.addEventListener('click',()=>setViewMode(b.dataset.ipadViewMode)));
 toolbar.querySelectorAll('[data-ipad-mpr]').forEach(b=>b.addEventListener('click',()=>setMprPlane(b.dataset.ipadMpr)));
 document.addEventListener('vrl-plane-selected',e=>{const p=e.detail?.plane;if(e.detail?.source!=='workspace'&&p&&p!==mprPlane)setMprPlane(p,true)});
 window.addEventListener('orientationchange',refreshLayout,{passive:true});
 window.addEventListener('resize',()=>{if(useWorkspaceUi())refreshLayout()},{passive:true});
 setDrawerTab('data');applyEventMenu();setMprPlane('axial',true);setViewMode(isVrHeadsetRuntime()?'2d':'3d');applyLanguage(currentLanguage);
}
export function initIPadGpuQualityControl(){
 if(!ipadGpuQualityControl||!ipadGpuQuality)return;
 if(isIPhoneRuntime()){ipadGpuQualityControl.classList.add('is-hidden');ipadGpuQualityControl.style.display='none';return}
 // full size only off iPad (memory); the label is the 3D volume resolution
 if(isTabletRuntime())ipadGpuQuality.querySelector('option[value="0"]')?.remove();
  ipadGpuQualityControl.classList.remove('is-hidden');ipadGpuQualityControl.style.display='flex';ipadGpuQuality.value=String(ipadGpuTargetSide);
 ipadGpuQuality.onchange=async()=>{
  const v=+ipadGpuQuality.value,next=v===768?768:v===0&&!isTabletRuntime()?0:512;if(next===ipadGpuTargetSide)return;
  setIpadGpuTargetSide(next);settings.set('gpuSide',next);
  const mv=sceneState?.medicalVolume,target=sourceVolume||volume,wasVolume=threeRenderMode==='volume'&&!!mv?.active;
  if(!mv||!target?.sourceBacked){updateRenderModeControl(target);return}
  clearResidentMprJobs();setResidentMprReadbackDisabled(true);mv.resetData();
  set3DBusy(true,'GPU '+(next||'full')+' 準備中…');
  const ok=await prepareResidentGpuVolume(target);
  if(ok&&wasVolume)await activateMedicalVolume();
  else if(ok){mv.setActive(false);setThreeRenderMode('surface');setThreeVolumeOverlay(false);updateRenderModeControl(target);request3DRender()}
  if(ok)footer.textContent='GPU '+(next||'full')+' · '+(mv.textureDims||[]).join('×')+' · '+fmt(mv.textureBytes);
 };
}
