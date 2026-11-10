// Analysis region show / hide (one flag, region.visible, saved in the project): pure, no DOM, no three.js, shared by the browser (the analysis list and the segment tree) and VR (the
// segment tree, the かんたん menu's results). Everything that shows a region follows this one flag; the views register a listener and apply it their own way (the PC 3D mesh,
// the 2D overlay, the lists / VR: a uniform, never a new preparation).
const listeners=new Set();
export const regionVisible=r=>!!r&&r.visible!==false;
// fn(region, visible) runs after every change made through setRegionVisible; returns the function that removes it
export function onRegionVisibleChange(fn){listeners.add(fn);return()=>{listeners.delete(fn)}}
// true when the flag changed (a region already in that state does nothing)
export function setRegionVisible(region,on){
 if(!region)return false;
 const v=!!on;if(regionVisible(region)===v&&typeof region.visible==='boolean')return false;
 region.visible=v;
 for(const fn of [...listeners]){try{fn(region,v)}catch(e){console.warn('[region-visible]',e)}}
 return true;
}
