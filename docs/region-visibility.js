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

const hiddenListeners=new Set();
export const regionHidden=r=>!!r&&r.hidden===true;
// fn(region, hidden) runs after every change made through setRegionHidden; returns the function that removes it
export function onRegionHiddenChange(fn){hiddenListeners.add(fn);return()=>{hiddenListeners.delete(fn)}}
// true when the flag changed (a region already in that state does nothing)
export function setRegionHidden(region,on){
 if(!region)return false;
 const v=!!on;if(regionHidden(region)===v&&typeof region.hidden==='boolean')return false;
 region.hidden=v;
 for(const fn of [...hiddenListeners]){try{fn(region,v)}catch(e){console.warn('[region-hidden]',e)}}
 return true;
}

// ---- an earlier change stage 2: how a HIDDEN shape is drawn (pure; shared by the VR volume, the PC WebGL volume and the VR / partner laser). A hidden result is drawn like a hidden child segment: its voxels are no tissue
// (the ray goes through them, no cut face, no slice tint), on the slots of its own segments only. Switching it rewrites the look-up table only (no preparation, the index texture stays).
// The region look-up table's alpha (one RGBA32F texel per result, vr-view.js refreshRegionLut / pairRegionLut, webgl-volume.js applyRegions):
//   bits 0..3 = the slots the result's COLOUR is drawn on (0 = colour off: the tissue's own colour), bit 4 = focused (the PC page only),
//   bits 8..11 (REGION_HIDE_SHIFT) = the slots the result's SHAPE is HIDDEN on. A hidden result has no colour bits (its voxels are not drawn at all), whatever its colour flag says.
export const REGION_HIDE_SHIFT=8;
export function regionLutAlpha(segMask,{shown=true,hidden=false,focused=false}={}){
 const m=(segMask|0)&15;
 if(hidden)return m<<REGION_HIDE_SHIFT;
 return shown?m|(focused?16:0):0;
}
// the slots a texel's alpha hides (0 = none)
export const regionLutHiddenSlots=a=>(Math.round(+a||0)>>REGION_HIDE_SHIFT)&15;
// the laser / point tests' skip function for the hidden results (the shader's rule on the CPU): ids = the result index per voxel of the pick grid (1..255, 0 = none; dims = [w, h, d]), lut = the table's
// Float32Array (texel i at 4 i), chan = the classification channel of each slot (cls.chan). -> null when no result is hidden (nothing to skip), else (x, y, z, c) -> true when the voxel is a hidden result on the slot of channel c
export function hiddenRegionVoxelOf(ids,dims,lut,chan){
 if(!ids||!dims||!lut)return null;
 let any=false;for(let i=1;i<256&&4*i+3<lut.length;i++)if(regionLutHiddenSlots(lut[4*i+3])){any=true;break}
 if(!any)return null;
 const slotOf=new Int8Array(8).fill(-1);(chan||[]).forEach((c,sl)=>{if(c>=0&&c<8)slotOf[c]=sl});
 const w=dims[0],h=dims[1];
 return(x,y,z,c)=>{const id=ids[x+w*(y+h*z)];if(!id||4*id+3>=lut.length)return false;const sl=slotOf[c];return sl>=0&&((regionLutHiddenSlots(lut[4*id+3])>>sl)&1)===1};
}
// two skip functions (a hidden child, a hidden result) as one: null when neither hides anything
export const anyHiddenVoxel=(a,b)=>a&&b?(x,y,z,c)=>a(x,y,z,c)||b(x,y,z,c):(a||b||null);
