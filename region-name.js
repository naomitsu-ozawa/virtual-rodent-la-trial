// Analysis region name / Atlas ID (optional, saved in the project): pure functions, no DOM, shared by the browser list, the VR labels and the project load / save.
// name = free text (control characters stripped, 40 characters at most); atlasId = a finite number.
export const REGION_NAME_MAX=40;
export function normalizeRegionName(s){
 if(typeof s!=='string')return '';
 return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,'').trim().slice(0,REGION_NAME_MAX).trim();
}
export function normalizeRegionAtlasId(n){return typeof n==='number'&&Number.isFinite(n)?n:undefined}
// a project file's region entry -> its name: `name`, else a STRING `label` (files made by an atlas tool; an object label is the pin and is not a name)
export function regionNameFromEntry(e){
 return normalizeRegionName(e?.name)||(typeof e?.label==='string'?normalizeRegionName(e.label):'');
}
// the custom part of the display name: name, else "ID <atlasId>", else '' (the caller shows its own default)
export function regionCustomName(region){
 const n=normalizeRegionName(region?.name);if(n)return n;
 const a=normalizeRegionAtlasId(region?.atlasId);return a!==undefined?'ID '+a:'';
}
// the display name rule: name, else "ID <atlasId>", else the fallback (a string or a function returning one)
export function regionDisplayName(region,fallback){
 return regionCustomName(region)||(typeof fallback==='function'?fallback(region):fallback);
}
