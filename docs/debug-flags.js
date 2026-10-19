// デバッグ設定 (設定 > デバッグ): the one test switch that used to be a URL parameter (typing a URL on the headset is painful).
// Pure module (no imports, no DOM, no URL access): the caller that already reads its URL parameter passes it in as `urlOn`, so the
// URL parameter still wins (URL on OR setting on). The switch only changes drawing precision; it selects, opens or loads no data.
const SETTINGS_KEY='vrl.settings.v1';
// when: 'reload' = read at page load (reload button). store: 'settings' (vrl.settings.v1 JSON)
export const DEBUG_SWITCHES=[
 {id:'vrMediump',group:'light',store:'settings',when:'reload',label:'dbgVrPrec',note:'dbgVrPrecNote'},
];
export const DEBUG_SETTING_DEFAULTS={vrMediump:false};
const ls=()=>{try{return globalThis.localStorage||null}catch{return null}};
const objOf=t=>{try{const o=JSON.parse(t);return o&&typeof o==='object'&&!Array.isArray(o)?o:null}catch{return null}};
// the stored value of a switch (without the URL), as a boolean
export function debugFlag(id,storage=ls()){
 if(!DEBUG_SWITCHES.some(s=>s.id===id))return false;
 try{return objOf(storage?.getItem(SETTINGS_KEY))?.[id]===true}catch{return false}
}
// a URL parameter that is present always wins over the stored value (both only ever switch the test ON)
export const effectiveFlag=(id,urlOn,storage=ls())=>!!urlOn||debugFlag(id,storage);
// back to the defaults, through `setSetting(key,value)` so the app is notified
export function resetDebugFlags(setSetting){
 for(const k of Object.keys(DEBUG_SETTING_DEFAULTS))setSetting?.(k,DEBUG_SETTING_DEFAULTS[k]);
}
