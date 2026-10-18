// Global app settings (build 280): stored per device in localStorage and
// shown in the settings dialog. Pure module, no imports, so any module
// (including medical-volume.js, which the unit tests load alone) can read it
// through globalThis.__vrlSettings.
const KEY='vrl.settings.v1';
export const SETTINGS_DEFAULTS={
 gpuSide:512,          // 3D volume texture in-plane size: 512 / 768 / 0 (full, desktop only)
 dragQuality:'standard', // pixel budget while dragging
 restQuality:'standard', // pixel budget at rest
 stepQuality:'standard', // ray-march step
 refine:'fast',        // surface search: fast (2 secant + 1 bisection on the HU iso-value) / exact (6 bisections)
 interp:'linear',
 dragLowerRes:true,    // lower the 3D resolution while dragging (resizes the canvas)      // 3D sampling: none / linear / smooth / smoother
 showPerf:true,        // frame time / fps in the status bar
 debug:false,          // same as ?debug
 cacheAutoPrune:true,  // keep only the current filter setting per dataset + 3D resolution
 cacheLimit:'auto',    // GPU volume cache limit: auto / 0.5 / 1 / 2 / 4 (GB)
 resultPlace:'panel',   // build 585: workspace UI: analysis results in the left panel with the tool ('panel') or under the views ('below')
 mpr2dAlpha:'0.65',    // build 430: strength of the segment / result colours in the 2D views (× segment opacity)
 gpuHybridMode:'hybrid', // build 517: Linux hybrid (display Intel / NVIDIA) only: 'hybrid' (display Intel, compute NVIDIA; the build 516 split) / 'primary' (everything on the display GPU); ignored off Linux, applies after a reload
 surfaceSmooth:true,  // device default of the 表面平滑化 checkbox: applied at start and to data / projects without a saved value (the project file stays the primary store)
 surfaceSmoothStrength:'0.60', // device default of its strength slider (0-6), same rule
 gpuPreference:'auto'  // build 515: GPU for WebGPU: 'auto' (as before) / 'high-performance' / 'low-power'; honoured only on Linux / Windows (gpu-preference.js), applies after a reload
};
// pixel budgets (MP) per interaction tier / at rest; 'max' = no budget
export const DRAG_BUDGETS={low:[0.12e6,0.09e6,0.06e6],standard:[0.25e6,0.18e6,0.12e6],high:[0.45e6,0.32e6,0.22e6],max:[Infinity,Infinity,Infinity]};
export const REST_BUDGETS={low:0.5e6,standard:1.0e6,high:1.8e6,max:Infinity};
export const STEP_SCALES={coarse:1.4,standard:1,fine:0.7};
let values={...SETTINGS_DEFAULTS};
try{const raw=globalThis.localStorage?.getItem(KEY);if(raw)values={...values,...JSON.parse(raw)}}catch{}
const api={
 get:k=>values[k],
 all:()=>({...values}),
 set(k,v){values[k]=v;try{globalThis.localStorage?.setItem(KEY,JSON.stringify(values))}catch{}try{globalThis.dispatchEvent?.(new CustomEvent('vrl-settings',{detail:{key:k,value:v}}))}catch{}},
 dragBudget:tier=>(DRAG_BUDGETS[values.dragQuality]||DRAG_BUDGETS.standard)[tier]??DRAG_BUDGETS.standard[0],
 restBudget:()=>REST_BUDGETS[values.restQuality]??REST_BUDGETS.standard,
 stepScale:()=>STEP_SCALES[values.stepQuality]??1,
 refineMode:()=>values.refine==='exact'?0:1,
 interpLevel:()=>({none:0,linear:1,smooth:2,smoother:3})[values.interp]??1,
 debugOn:()=>debugEnabled()
};
globalThis.__vrlSettings=api;
export const settings=api;
export function debugEnabled(){
 if(values.debug)return true;
 return typeof location!=='undefined'&&/[?&]debug(\b|=|&|$)/.test(location.search);
}
// build 309: ?ahead=N sets how many slices are read in parallel (default 4)
try{const n=+new URLSearchParams(globalThis.location?.search||'').get('ahead');if(n>=1&&n<=32)globalThis.__vrlReadAhead=Math.round(n)}catch{}
