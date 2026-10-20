// 3D status UI that needs no edit tools: busy overlay, GPU volume filter badge.
// Depends only on the imports below; never imports from app.js.
import { sceneState, threeRenderMode, threeDCancelRequested, threeDApplying } from './state.js?v=20261020-build629';
import { threeFilterBadge, threeBusy, threeBusyLabel, threeBusyCancel } from './ui-shell.js?v=20261020-build629';
import { currentFilterSignature } from './source-filters.js?v=20261020-build629';
import { tr } from './i18n.js?v=20261020-build629';
import { setBusySlot, setBusyLabel } from './progress-modal.js?v=20261020-build629';
export const gpuVolumeRefresh={token:0,running:null};
export function updateVolumeFilterBadge(){
 if(!threeFilterBadge)return;
 const mv=sceneState?.medicalVolume,show=threeRenderMode==='volume'&&!!mv?.active&&(mv.dataSignature||'')!==currentFilterSignature();
 threeFilterBadge.classList.toggle('is-hidden',!show);
 if(show){const key=gpuVolumeRefresh.running!=null?'volumeFilterUpdating':'volumeFilterPending';if(threeFilterBadge.dataset.i18n!==key){threeFilterBadge.dataset.i18n=key;threeFilterBadge.textContent=tr(key)}}
}
// shown in the central progress modal; 中断 there runs the 3D cancel button's handler (cancel3DRebuild),
// offered only while a 3D rebuild runs (the only job that handler stops; others get the modal's close fallback).
// Not paired (repeated true calls update the label, false may come without a true): the last call wins.
export function set3DBusy(busyState,label='3D構築中…',cancelable=true){
 setBusySlot('three',busyState,{label,cancel:cancelable&&threeDApplying?()=>threeBusyCancel?.onclick?.():null});
 if(threeBusy)threeBusy.classList.toggle('is-hidden',!busyState);
 if(threeBusyLabel)threeBusyLabel.textContent=label;
 if(threeBusyCancel){threeBusyCancel.classList.toggle('is-hidden',!busyState||!cancelable);threeBusyCancel.disabled=!busyState||!cancelable||threeDCancelRequested;threeBusyCancel.textContent=threeDCancelRequested?tr('cancelling3D'):tr('cancel3D')}
}
// label of the running 3D job (phase counts written while it runs)
export function set3DBusyLabel(text){if(threeBusyLabel)threeBusyLabel.textContent=text;setBusyLabel('three',text)}
