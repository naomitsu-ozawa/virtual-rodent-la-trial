// Canvas backgrounds follow the theme (builds 450-451). --ui-canvas-bg-3d is a DARK colour in every theme, tinted like the theme
// (the 3D view keeps a dark background so the volume reads the same; a light background changes how grey levels look);
// --ui-canvas-bg-2d (around a 2D slice) follows the theme fully.
// The 3D background is used by: the GPU volume view (MedicalVolumeRenderer: clear colour and the colour a ray gets when it
// hits nothing), the WebGL fallback clear colour in scene-view.js, and the CSS backdrop of the 3D card (the three.js WebGPU
// canvas is transparent). Only the BACKGROUND is read here: the image itself (grey levels, window / level, segment colours,
// transfer function) never depends on a theme.
export const DEFAULT_CANVAS_BG_3D=[0.035,0.045,0.05]; // the colour before themes
export function cssTriplet(name,root=globalThis.document?.documentElement){
 try{const v=getComputedStyle(root).getPropertyValue(name).trim().split(/\s+/).map(Number);return v.length===3&&v.every(Number.isFinite)?v:null}catch{return null}
}
export const canvasBackground3d=()=>cssTriplet('--ui-canvas-bg-3d');
let cache=null,listening=false;
// [r,g,b] in 0..1 for the GPU volume view; recomputed after a theme change ('vrl-themechange' from theme.js), cheap per frame
export function canvasBackground3dUnit(){
 if(!listening&&globalThis.document?.addEventListener){listening=true;document.addEventListener('vrl-themechange',()=>{cache=null})}
 if(!cache){const c=canvasBackground3d();cache=c?c.map(x=>Math.max(0,Math.min(255,x))/255):DEFAULT_CANVAS_BG_3D}
 return cache;
}
// theme.js dispatches 'vrl-themechange' on the document; the 3D view sets its clear colour and draws again
export function onCanvasThemeChange(cb,doc=globalThis.document){doc?.addEventListener?.('vrl-themechange',cb);return()=>doc?.removeEventListener?.('vrl-themechange',cb)}
