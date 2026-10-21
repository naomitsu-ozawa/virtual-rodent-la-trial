// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { processingOverlay, processingOverlayLabel, resetFilterBtn, gaussianBtn, spikeHoleBtn, nlmBtn, anisotropicBtn, sigmoidBtn, smoothingType, gaussianStrength, spatialPasses, spikeHoleStrength, spikeHoleThreshold, nlmStrength, nlmSearchRadius, nlmPatchRadius, anisotropicStrength, anisotropicIterations, sigmoidStrength, sigmoidCenter, sigmoidWidth, bilateralStrength, bilateralSpatial, bilateralIntensity, bilateralPasses, tvWeight, tvIterations, unsharpRadius, unsharpAmount, unsharpThreshold, prog, bar, progLabel, anisotropicKappa } from './ui-shell.js?v=20261021-build638';
import { sourceVolume } from './state.js?v=20261021-build638';
import { filterState } from './source-filters.js?v=20261021-build638';
import { setBusySlot } from './progress-modal.js?v=20261021-build638';
export function setProcessingBusy(busyState,label='Processing',lockControls=true){
 // shown in the central progress modal (calls are paired: counted slot)
 setBusySlot('processing',busyState,{label,counted:true});
 if(processingOverlay){
  processingOverlay.classList.toggle('is-hidden',!busyState||!lockControls);
  processingOverlay.setAttribute('aria-busy',busyState?'true':'false');
 }
 if(processingOverlayLabel)processingOverlayLabel.textContent=busyState&&lockControls?label+' · 処理中…':'';
 if(lockControls){
  resetFilterBtn.disabled=busyState||!sourceVolume;
  gaussianBtn.disabled=spikeHoleBtn.disabled=nlmBtn.disabled=anisotropicBtn.disabled=sigmoidBtn.disabled=busyState||!sourceVolume;smoothingType.disabled=busyState||!sourceVolume||!filterState.gaussian;
  gaussianStrength.disabled=busyState||!sourceVolume||!filterState.gaussian;
  spatialPasses.disabled=busyState||!sourceVolume||!filterState.gaussian;
  spikeHoleStrength.disabled=busyState||!sourceVolume||!filterState.spikeHole;
  spikeHoleThreshold.disabled=busyState||!sourceVolume||!filterState.spikeHole;
  nlmStrength.disabled=busyState||!sourceVolume||!filterState.nlm;
  nlmSearchRadius.disabled=busyState||!sourceVolume||!filterState.nlm;
  nlmPatchRadius.disabled=busyState||!sourceVolume||!filterState.nlm;
  anisotropicStrength.disabled=anisotropicKappa.disabled=busyState||!sourceVolume||!filterState.anisotropic;
  anisotropicIterations.disabled=busyState||!sourceVolume||!filterState.anisotropic;
  sigmoidStrength.disabled=busyState||!sourceVolume||!filterState.sigmoid;
  sigmoidCenter.disabled=sigmoidWidth.disabled=busyState||!sourceVolume||!filterState.sigmoid;
  bilateralStrength.disabled=bilateralSpatial.disabled=bilateralIntensity.disabled=bilateralPasses.disabled=busyState||!sourceVolume||!filterState.bilateral;
  tvWeight.disabled=tvIterations.disabled=busyState||!sourceVolume||!filterState.tv;
  unsharpRadius.disabled=unsharpAmount.disabled=unsharpThreshold.disabled=busyState||!sourceVolume||!filterState.unsharp;
 }
 prog.classList.toggle('is-hidden',!busyState);
 if(busyState){bar.style.width='0%';progLabel.textContent=label}
}
