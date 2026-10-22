// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { surfaceSmoothEnabled, surfaceSmoothStrength, surfaceSmoothValue } from './ui-shell.js?v=20261022-build646';
import { settings } from './app-settings.js?v=20261022-build646';
export function surfaceSmoothingActive(){
 return !!surfaceSmoothEnabled?.checked&&Number(surfaceSmoothStrength?.value)>0;
}
// Device default of the surface smoothing (app-settings): the project file is the primary store and wins when it has a value;
// the default only fills in at start and for data / projects without one. Only the user's own changes update it, so applying a
// project (which fires the same events) raises smoothingSync.busy to keep it out.
export const smoothingSync={busy:false};
export function saveDeviceSmoothing(){
 if(smoothingSync.busy||!surfaceSmoothEnabled||!surfaceSmoothStrength)return;
 settings.set('surfaceSmooth',!!surfaceSmoothEnabled.checked);settings.set('surfaceSmoothStrength',String(surfaceSmoothStrength.value));
}
export function applyDeviceSmoothing(){
 if(!surfaceSmoothEnabled||!surfaceSmoothStrength)return;
 const n=Number(settings.get('surfaceSmoothStrength'));
 surfaceSmoothEnabled.checked=settings.get('surfaceSmooth')!==false;
 if(Number.isFinite(n)&&n>=0&&n<=6)surfaceSmoothStrength.value=String(n);
 if(surfaceSmoothValue)surfaceSmoothValue.value=(+surfaceSmoothStrength.value).toFixed(2);
}
