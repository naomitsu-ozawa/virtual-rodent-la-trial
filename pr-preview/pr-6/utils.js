// Extracted verbatim from app.js by tools/extract-module.mjs.
// Self-contained: depends only on the imports below (no module state).
export const rangeNumber=(el,name,fallback)=>{const n=Number(el?.[name]);return Number.isFinite(n)?n:fallback};
export const rangeStep=el=>{
 const raw=el?.getAttribute?.('step'),n=raw&&raw!=='any'?Number(raw):1;
 return Number.isFinite(n)&&n>0?n:1;
};
export const rangePrecision=step=>{
 const s=String(step);if(/e-/i.test(s)){const m=s.match(/e-(\d+)/i);return m?Math.min(8,+m[1]):6}
 const dot=s.indexOf('.');return dot<0?0:Math.min(8,s.length-dot-1);
};
export const clampRangeValue=(el,value)=>{
 const min=rangeNumber(el,'min',0),max=rangeNumber(el,'max',100),step=rangeStep(el),precision=rangePrecision(step);
 const clamped=Math.max(min,Math.min(max,value)),snapped=min+Math.round((clamped-min)/step)*step;
 return Math.max(min,Math.min(max,Number(snapped.toFixed(precision))));
};
export function withTimeout(promise,ms,timeoutValue){
 return Promise.race([promise,new Promise(resolve=>setTimeout(()=>resolve(timeoutValue),ms))]);
}
export function isIPhoneRuntime(){return /iPhone|iPod/i.test(navigator.userAgent||'')}
export function isIPadRuntime(){return /iPad/i.test(navigator.userAgent||'')||((navigator.maxTouchPoints||0)>1&&/Mac/i.test(navigator.platform||''))}
export function isDesktopRuntime(){return (navigator.maxTouchPoints||0)===0&&!isIPhoneRuntime()}
// the iPad memory / texture caps also for the Meta Quest browser and Android tablets (mobile OS in the UA); a touch-screen laptop stays a desktop
export function isTabletRuntime(){return isIPadRuntime()||/Android|OculusBrowser|Quest/i.test(navigator.userAgent||'')}
export const frameYield=()=>new Promise(resolve=>setTimeout(resolve,0));
export function niceCtStep(span){
 const target=Math.max(Math.abs(span)/700,1e-6),power=10**Math.floor(Math.log10(target)),scaled=target/power;
 const nice=scaled<=1?1:scaled<=2?2:scaled<=5?5:10;
 return nice*power;
}
export function ctDigits(step){
 if(step>=1)return 0;
 return Math.min(4,Math.max(0,Math.ceil(-Math.log10(step))));
}
export function formatCtValue(value,step=1){return Number(value).toFixed(ctDigits(+step||1))}
export function hexRgb(hex){const n=parseInt(hex.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255]}
export function fmt(n){if(!n)return'0 B';const u=['B','KiB','MiB','GiB'];const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),u.length-1);return(n/1024**i).toFixed(i?2:0)+' '+u[i]}
export function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
export function numberOr(v,f){const n=Number(v);return Number.isFinite(n)?n:f}
export function multi(v,n){if(!v)return null;const a=v.split('\\').map(Number);return a.length>=n&&a.every(Number.isFinite)?a.slice(0,n):null}
export function safePair(a){return[a[0],a[1]]}
export function safeTriple(a){return[a[0],a[1],a[2]]}
export function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

// from data-load.js (STL export and project download)
export function downloadBlob(blob,filename){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();const url=a.href;a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
