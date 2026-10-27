import { clampRangeValue } from './utils.js?v=20261027-build680';

export const WHEEL_NOTCH_PX=50,WHEEL_SMOOTH_PX=42;
// state {acc}: returns the signed number of steps for one wheel event (deltaMode 0 px, 1 line, 2 page)
export function rangeWheelSteps(state,delta,deltaMode=0){
 if(!delta)return 0;
 const sign=delta>0?1:-1;
 if(deltaMode!==0||Math.abs(delta)>=WHEEL_NOTCH_PX){state.acc=0;return sign}
 if(state.acc&&Math.sign(state.acc)!==sign)state.acc=0;
 state.acc+=delta;
 const steps=Math.trunc(state.acc/WHEEL_SMOOTH_PX);state.acc-=steps*WHEEL_SMOOTH_PX;
 return steps||0; // not -0
}

// "257 / 512" → 1-based display; plain numbers ("-250", "0.80 mm", "64%") → as is; anything else ("—") → not typable
export function parseShownValue(text){
 const s=String(text??'').trim(),slice=s.match(/^(-?\d+)\s*\/\s*\d+$/);
 if(slice)return{value:+slice[1],offset:1};
 const m=s.match(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i);
 return m?{value:+m[0],offset:0}:null;
}

let boundsHook=null;
// fn(el) → [min, max] the slider may be widened to for a typed value, or null
export function setRangeEntryBounds(fn){boundsHook=fn}

function sliderOf(output){
 const host=output.closest('label')||output.parentElement;
 return host?.querySelector('input[type="range"]')||null;
}
function commitTyped(el,typed){
 let v=typed;
 const b=boundsHook?.(el);
 if(b){
  v=Math.max(b[0],Math.min(b[1],v));
  if(v<+el.min)el.min=String(v);
  if(v>+el.max)el.max=String(v);
 }
 const next=clampRangeValue(el,v);
 el.value=String(next);
 el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
}
function openEntry(output,el){
 const shown=parseShownValue(output.textContent);if(!shown)return;
 const field=document.createElement('input');
 field.type='number';field.step='any';field.className='range-entry-field';field.value=String(shown.value);
 field.setAttribute('aria-label',output.closest('label')?.querySelector('span')?.textContent||'');
 output.hidden=true;output.after(field);field.focus();field.select();
 let done=false;
 const close=apply=>{
  if(done)return;done=true;
  const typed=Number(field.value);
  field.remove();output.hidden=false;
  if(!apply||field.value.trim()===''||!Number.isFinite(typed)||el.disabled)return;
  // data-range-entry-invert: the slider runs opposite to the value it shows (the 3D slice sliders: max − slice)
  const at=typed-shown.offset;commitTyped(el,el.hasAttribute('data-range-entry-invert')?+el.max-at:at);
 };
 field.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();close(true)}
  else if(e.key==='Escape'){e.preventDefault();close(false)}
  e.stopPropagation();
 });
 field.addEventListener('blur',()=>close(true));
 // the label would hand clicks inside the field to the slider
 field.addEventListener('click',e=>{e.preventDefault();e.stopPropagation()});
 field.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
}
export function installRangeEntry(root=document){
 root.addEventListener('click',e=>{
  const output=e.target?.closest?.('output');if(!output||output.hidden)return;
  const el=sliderOf(output);if(!el||el.disabled)return;
  if(!parseShownValue(output.textContent))return;
  e.preventDefault();e.stopPropagation();openEntry(output,el);
 },true);
}
