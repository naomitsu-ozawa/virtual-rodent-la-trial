// Practice datasets hosted on this site (pure: no DOM, unit-tested).
// sample1 keeps its original base path and Cache Storage key, so users who already
// downloaded it do not download it again; later sets put their folder in the key.
import { DEMO_FROM_SITE_ROOT, SLICE_ROOT } from './sample-config.js?v=20261109-build703';
export const SAMPLE_CACHE='virtual-rodent-sample-v1';
// The sets follow one rule: base demo/sampleN/, cache key prefix /__vrl-sample/v1/sampleN/ (sample1 keeps the original prefix). Which folders exist is the registry's business
// (docs/sample-registry.js, which hands the ids over with setKnownSampleIds): an id that is not a registered dataset is refused, so the loading path can only reach those folders.
const SET_ID=/^sample([1-9]\d*)$/;
let known=new Set();
export function setKnownSampleIds(ids){known=new Set(ids)}
export const DEFAULT_SAMPLE='sample1';
function ruleSet(id){
 const m=SET_ID.exec(typeof id==='string'?id:'');
 return m?{base:'demo/'+id+'/',keyPrefix:m[1]==='1'?'/__vrl-sample/v1/':'/__vrl-sample/v1/'+id+'/'}:null;
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
// The root the slices (.dcm only) are read from when the published site carries none (docs/sample-config.js SLICE_ROOT). ONE shape only:
// https://raw.githubusercontent.com/<account>/<repo>/main/docs/ ; any other value (another host, branch or path, `..`) is ignored (''), so the slices are read as before.
const SLICE_ROOT_SHAPE=/^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*\/main\/docs\/$/;
export function sliceRoot(root){return typeof root==='string'&&SLICE_ROOT_SHAPE.test(root)?root:''}
const isSlice=name=>/\.dcm$/i.test(name);
// slice URL: <slice root>demo/<id>/<name> for a .dcm when the root is set; otherwise page-relative, or site-root absolute in a preview
export function sampleSliceUrl(id,name,pathname,root=SLICE_ROOT){const set=need(id),r=isSlice(name)?sliceRoot(root):'';return (r?r+set.base:baseOf(id,pathname,set))+encodeURIComponent(name)}
export function sampleCacheKey(origin,id,name){return origin+need(id).keyPrefix+encodeURIComponent(name)}
export function sampleIndexUrl(id,pathname){return baseOf(id,pathname)+'index.json'}
export function sampleProjectUrl(id,pathname){return baseOf(id,pathname)+'project.vrlab'}
// sample.json of a folder: read by the registry BEFORE the ids are known, so only the folder name rule applies here
export function sampleJsonUrl(id,pathname){const set=ruleSet(id);if(!set)throw new Error('Unknown sample set: '+id);return baseOf(id,pathname,set)+'sample.json'}
