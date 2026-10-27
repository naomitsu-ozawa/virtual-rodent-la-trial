// Practice datasets hosted on this site (pure: no DOM, unit-tested).
// sample1 (rat abdomen) keeps its original base path and Cache Storage key, so users who already
// downloaded it do not download it again; later sets put their folder in the key.
import { DEMO_FROM_SITE_ROOT } from './sample-config.js?v=20261027-build678';
export const SAMPLE_CACHE='virtual-rodent-sample-v1';
export const SAMPLE_SETS={
 sample1:{base:'demo/sample1/',keyPrefix:'/__vrl-sample/v1/'},
 sample2:{base:'demo/sample2/',keyPrefix:'/__vrl-sample/v1/sample2/'},
 sample3:{base:'demo/sample3/',keyPrefix:'/__vrl-sample/v1/sample3/'},
 sample4:{base:'demo/sample4/',keyPrefix:'/__vrl-sample/v1/sample4/'},
};
export const DEFAULT_SAMPLE='sample1';
export function sampleSet(id){return Object.hasOwn(SAMPLE_SETS,id)?SAMPLE_SETS[id]:null}
function need(id){const s=sampleSet(id);if(!s)throw new Error('Unknown sample set: '+id);return s}
// PR previews live at <site root>/pr-preview/pr-<N>/ and (when deployed without docs/demo) read the
// practice data from the main site: <site root>/demo/... Pure: pathname is the page path.
// Returns the base unchanged (page-relative) outside a preview or when fromRoot is false.
const PREVIEW_PATH=/^(.*?\/)pr-preview\/pr-\d+(?:\/|$)/;
export function resolveSampleBase(base,pathname,fromRoot){
 if(!fromRoot)return base;
 const m=PREVIEW_PATH.exec(pathname||'');
 return m?m[1]+base:base;
}
const here=()=>globalThis.location?.pathname||'/';
function baseOf(id,pathname){return resolveSampleBase(need(id).base,pathname??here(),DEMO_FROM_SITE_ROOT)}
// slice URL (page-relative, or site-root absolute in a preview) and the page-path-independent Cache Storage key
export function sampleSliceUrl(id,name,pathname){return baseOf(id,pathname)+encodeURIComponent(name)}
export function sampleCacheKey(origin,id,name){return origin+need(id).keyPrefix+encodeURIComponent(name)}
export function sampleIndexUrl(id,pathname){return baseOf(id,pathname)+'index.json'}
export function sampleProjectUrl(id,pathname){return baseOf(id,pathname)+'project.vrlab'}
