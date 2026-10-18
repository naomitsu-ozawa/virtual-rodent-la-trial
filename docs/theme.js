// Colour themes (build 449). Six themes: three light, three dark. The colours themselves are the CSS tokens in themes.css
// (selected by <html data-theme="...">); this module only knows the ids, names and the choice.
// The IMAGE AREA (MPR, 3D, volume rendering, segment colours, window / level) is never changed by a theme: see themes.css.
export const THEME_STORAGE_KEY='vrl-theme';
export const DEFAULT_LIGHT_THEME='light-standard',DEFAULT_DARK_THEME='dark-standard';
// preview: page, panel, accent, text (for the swatches in the settings dialog; kept equal to themes.css by a unit test)
export const THEMES=[
 {id:'light-standard',mode:'light',ja:'ライト（標準）',en:'Light (standard)',preview:['#e8ecef', '#ffffff', '#2b7fa3', '#11181c']},
 {id:'light-paper',mode:'light',ja:'ライト（紙・暖色）',en:'Light (paper, warm)',preview:['#ebe5d8', '#fbf8f1', '#3a7a90', '#231f17']},
 {id:'light-gray',mode:'light',ja:'ライト（グレー）',en:'Light (gray)',preview:['#cfcfcf', '#e8e8e8', '#4a4a4a', '#101010']},
 {id:'dark-standard',mode:'dark',ja:'ダーク（標準）',en:'Dark (standard)',preview:['#0b0d0f', '#11171a', '#67b2d1', '#e9eef1']},
 {id:'dark-reading',mode:'dark',ja:'ダーク（読影・黒）',en:'Dark (reading, near-black)',preview:['#050506', '#0b0c0d', '#67b2d1', '#ececec']},
 {id:'dark-gray',mode:'dark',ja:'ダーク（グレー）',en:'Dark (gray)',preview:['#161616', '#1e1e1e', '#c4c4c4', '#ededed']},
];
export const THEME_IDS=THEMES.map(t=>t.id);
export const isThemeId=id=>THEME_IDS.includes(id);
// themes that were renamed (build 450: the blue ones became gray): a saved old id is read as the new one
export const THEME_ALIASES={'light-cool':'light-gray','dark-navy':'dark-gray'};
export const normalizeThemeId=id=>THEME_ALIASES[id]||id;
export const themeMode=id=>THEMES.find(t=>t.id===id)?.mode||'dark';
// the first visit follows the OS setting (prefers-color-scheme); nothing reported = the dark standard theme (the look before themes)
export function resolveInitialTheme(stored,prefersLight){
 stored=normalizeThemeId(stored);
 if(isThemeId(stored))return stored;
 return prefersLight?DEFAULT_LIGHT_THEME:DEFAULT_DARK_THEME;
}
export function readStoredTheme(storage=globalThis.localStorage){
 try{const v=normalizeThemeId(storage?.getItem(THEME_STORAGE_KEY));return isThemeId(v)?v:null}catch{return null}
}
export function writeStoredTheme(id,storage=globalThis.localStorage){
 try{storage?.setItem(THEME_STORAGE_KEY,id);return true}catch{return false}
}
const prefersLightNow=(mm=globalThis.matchMedia)=>{try{return !!mm?.call(globalThis,'(prefers-color-scheme: light)')?.matches}catch{return false}};
// sets the attributes the CSS keys on, and the browser UI colour (<meta name="theme-color">) to the page colour
export function applyTheme(id,doc=globalThis.document){
 if(!isThemeId(id)||!doc?.documentElement)return false;
 const root=doc.documentElement;root.dataset.theme=id;root.dataset.themeMode=themeMode(id);
 const meta=doc.querySelector?.('meta[name="theme-color"]'),t=THEMES.find(x=>x.id===id);
 if(meta&&t)meta.setAttribute('content',t.preview[0]);
 // canvas-theme.js listens (the 3D clear colour follows the theme and the 3D view is drawn again)
 try{doc.dispatchEvent?.(new CustomEvent('vrl-themechange',{detail:{id}}))}catch{}
 return true;
}
// state: the stored choice wins; with no choice the theme follows the OS setting (also when it changes while the app is open)
export function createThemeController({storage=globalThis.localStorage,matchMedia=globalThis.matchMedia,doc=globalThis.document}={}){
 let stored=readStoredTheme(storage),current=resolveInitialTheme(stored,prefersLightNow(matchMedia));
 try{const raw=storage?.getItem(THEME_STORAGE_KEY);if(stored&&raw!==stored)writeStoredTheme(stored,storage)}catch{}
 const listeners=new Set();
 const emit=()=>{for(const f of listeners)try{f(current,stored!==null)}catch{}};
 applyTheme(current,doc);
 let mq=null;try{mq=matchMedia?.call(globalThis,'(prefers-color-scheme: light)')}catch{}
 mq?.addEventListener?.('change',e=>{if(stored!==null)return;current=resolveInitialTheme(null,e.matches);applyTheme(current,doc);emit()});
 return{
  get:()=>current,
  isChosen:()=>stored!==null,
  set(id){if(!isThemeId(id))return false;stored=id;current=id;writeStoredTheme(id,storage);applyTheme(id,doc);emit();return true},
  onChange(f){listeners.add(f);return()=>listeners.delete(f)},
 };
}
