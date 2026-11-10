// Practice datasets hosted on this site (pure: no DOM, unit-tested).
// sample1 keeps its original base path and Cache Storage key, so users who already
// downloaded it do not download it again; later sets put their folder in the key.
import { DEMO_FROM_SITE_ROOT } from './sample-config.js?v=20261110-build708';
export const SAMPLE_CACHE='virtual-rodent-sample-v1';
// The sets follow one rule: base demo/<id>/, cache key prefix /__vrl-sample/v1/<id>/ (sample1 keeps the original prefix). Which folders exist is the registry's business
// (docs/sample-registry.js, which hands the ids over with setKnownSampleIds): an id that is not a registered dataset is refused, so the loading path can only reach those folders.
// The folder name rule, in ONE place: `sample` + a number, or a name that starts with a lower-case letter and has only lower-case letters, digits and hyphens.
// A name with `../`, `/`, a capital letter or a leading hyphen is refused. Every other module asks isSampleId.
const SET_ID=/^(?:sample[1-9]\d*|[a-z][a-z0-9-]*)$/;
export const isSampleId=id=>typeof id==='string'&&SET_ID.test(id);
let known=new Set();
export function setKnownSampleIds(ids){known=new Set(ids)}
// The default dataset is not named here: it comes from the registry (sample-registry.js defaultSampleId: sample.json "default": true).
function ruleSet(id){
 return isSampleId(id)?{base:'demo/'+id+'/',keyPrefix:id==='sample1'?'/__vrl-sample/v1/':'/__vrl-sample/v1/'+id+'/'}:null;
}
export function sampleSet(id){return known.has(id)?ruleSet(id):null}
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
function baseOf(id,pathname,set=need(id)){return resolveSampleBase(set.base,pathname??here(),DEMO_FROM_SITE_ROOT)}
// slice URL (page-relative, or site-root absolute in a preview) and the page-path-independent Cache Storage key
export function sampleSliceUrl(id,name,pathname){return baseOf(id,pathname)+encodeURIComponent(name)}
export function sampleCacheKey(origin,id,name){return origin+need(id).keyPrefix+encodeURIComponent(name)}
export function sampleIndexUrl(id,pathname){return baseOf(id,pathname)+'index.json'}
export function sampleProjectUrl(id,pathname){return baseOf(id,pathname)+'project.vrlab'}
// sample.json of a folder: read by the registry BEFORE the ids are known, so only the folder name rule applies here
export function sampleJsonUrl(id,pathname){const set=ruleSet(id);if(!set)throw new Error('Unknown sample set: '+id);return baseOf(id,pathname,set)+'sample.json'}

// the list of the datasets of this site (docs/demo/samples.json): the ONE file the registry reads first; a folder that is not in it is never read. Read the same way as the data (a PR preview: from the site root)
export function sampleListUrl(pathname){return resolveSampleBase('demo/samples.json',pathname??here(),DEMO_FROM_SITE_ROOT)}
