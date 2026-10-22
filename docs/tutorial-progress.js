// チュートリアル progress, saved on this device (localStorage key vrl.tutorial.v1, separate from vrl.settings.v1). Pure: no DOM, no THREE;
// unit-tested (tests/unit/tutorial-progress.test.js). Shape {v:1, done:{controls:true,…}, skipAll:false, last:'section'|null}. Every storage access is guarded: when
// localStorage is missing / throws / holds garbage, the progress lives in memory only (this page) and loading never throws.
export const TUT_KEY='vrl.tutorial.v1';
export const emptyProgress=()=>({v:1,done:{},skipAll:false,last:null});
let memory=null; // last saved / loaded progress of this page (the fallback when storage is unusable)
const store=s=>{try{return (s===undefined?globalThis.localStorage:s)??null}catch{return null}};
export function sanitizeProgress(o){
 if(!o||typeof o!=='object'||o.v!==1)return emptyProgress();
 const done={};if(o.done&&typeof o.done==='object')for(const [k,v] of Object.entries(o.done))if(v===true)done[k]=true;
 return{v:1,done,skipAll:o.skipAll===true,last:typeof o.last==='string'?o.last:null};
}
export function loadProgress(storage){
 try{const raw=store(storage)?.getItem(TUT_KEY);if(raw!=null){const p=sanitizeProgress(JSON.parse(raw));memory=p;return structuredCloneSafe(p)}}catch{}
 return structuredCloneSafe(memory||emptyProgress());
}
export function saveProgress(p,storage){
 const s=sanitizeProgress(p);memory=s;
 try{const st=store(storage);if(!st)return false;st.setItem(TUT_KEY,JSON.stringify(s));return true}catch{return false}
}
export function clearProgress(storage){
 memory=null;
 try{const st=store(storage);if(!st)return false;st.removeItem(TUT_KEY);return true}catch{return false}
}
const structuredCloneSafe=p=>({v:1,done:{...p.done},skipAll:p.skipAll,last:p.last});
// test hook: forget the in-memory copy
export function _resetMemory(){memory=null}
