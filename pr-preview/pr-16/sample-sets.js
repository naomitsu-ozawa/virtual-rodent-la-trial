// Practice datasets hosted on this site (pure: no DOM, unit-tested).
// sample1 keeps its original base path and Cache Storage key, so users who already
// downloaded it do not download it again; later sets put their folder in the key.
import { DEMO_FROM_SITE_ROOT, SLICE_ROOT } from './sample-config.js?v=20261112-build729';
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
// The root the slices (.dcm only) are read from when the published site carries none (docs/sample-config.js SLICE_ROOT). ONE shape only:
// https://raw.githubusercontent.com/<account>/<repo>/main/docs/ ; any other value (another host, branch or path, `..`) is ignored (''), so the slices are read as before.
const SLICE_ROOT_SHAPE=/^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*\/main\/docs\/$/;
export function sliceRoot(root){return typeof root==='string'&&SLICE_ROOT_SHAPE.test(root)?root:''}
const isSlice=name=>/\.dcm$/i.test(name);
// slice URL: <slice root>demo/<id>/<name> for a .dcm when the root is set; otherwise page-relative, or site-root absolute in a preview
// A name in an index.json is ONE path segment below the set folder; the only exception is ONE sub-folder level in this exact shape: <sub-folder>/<file>.dcm (sub-folder: lower-case letters, digits, hyphens, starting with a letter;
// file: no / or \ ; .dcm). It is split into the two segments, each encoded. Anything else (.., a leading /, an empty segment, a second level, a capital in the folder, another extension) stays ONE encoded segment, as before.
const SLICE_SUBPATH=/^([a-z][a-z0-9-]*)\/([^/\\]+\.[dD][cC][mM])$/;
const slicePath=name=>{const m=SLICE_SUBPATH.exec(name);return m?encodeURIComponent(m[1])+'/'+encodeURIComponent(m[2]):encodeURIComponent(name)};
// the name a File gets from an index.json entry: the file name only for the split shape above (the slice itself is the same data as at the top level), the whole entry otherwise (as before)
export function sampleSliceFileName(name){const m=SLICE_SUBPATH.exec(name);return m?m[2]:name}
export function sampleSliceUrl(id,name,pathname,root=SLICE_ROOT){const set=need(id),r=isSlice(name)?sliceRoot(root):'';return (r?r+set.base:baseOf(id,pathname,set))+slicePath(name)}
export function sampleCacheKey(origin,id,name){return origin+need(id).keyPrefix+encodeURIComponent(name)}
export function sampleIndexUrl(id,pathname){return baseOf(id,pathname)+'index.json'}
export function sampleProjectUrl(id,pathname){return baseOf(id,pathname)+'project.vrlab'}
// sample.json of a folder: read by the registry BEFORE the ids are known, so only the folder name rule applies here
// A partner folder is named '<id>/<dir>' (the pair row of the VR menu reads the partner's name from its sample.json): only a <dir> that docs/sample-pairs.json lists below a folder-name-rule <id> is accepted (memberSet).
export function sampleJsonUrl(id,pathname){
 const m=/^([^/]+)\/([^/]+)$/.exec(String(id));if(m&&isSampleId(m[1])&&isPairDir(m[2])){const s=memberSet(m[1],m[2]);if(!s)throw new Error('Unknown sample partner: '+id);return memberBase(s,pathname)+'sample.json'}
 const set=ruleSet(id);if(!set)throw new Error('Unknown sample set: '+id);return baseOf(id,pathname,set)+'sample.json'}

// the list of the datasets of this site (docs/demo/samples.json): the ONE file the registry reads first; a folder that is not in it is never read. Read the same way as the data (a PR preview: from the site root)
export function sampleListUrl(pathname){return resolveSampleBase('demo/samples.json',pathname??here(),DEMO_FROM_SITE_ROOT)}

// ---- partner folders ("pairs"): a sub-folder of a registered dataset that holds a second series to be shown next to it (docs/demo/<id>/<dir>/ with its own index.json, sample.json and ONE .vrlab).
// Which partners exist is NOT decided here or by hand: tools/scan-sample-pairs.mjs reads the folder structure and writes docs/sample-pairs.json, and the page hands that file over with
// setKnownSamplePairs (docs/sample-pairs.js parses it). Only a <dir> and a project file name that the file lists are ever built into a URL; the parent <id> must be a registered dataset as well.
// The URLs and cache keys follow the same rule as the sets above, one level deeper: base demo/<id>/<dir>/, key prefix /__vrl-sample/v1/<id>/<dir>/ (also for sample1: no partner shares a key with a plain set).
const PAIR_DIR=/^[a-z][a-z0-9-]*$/;
export const isPairDir=d=>typeof d==='string'&&PAIR_DIR.test(d);
// a plain file name of a project: one path segment (no / or \ or control character, not starting with a dot), ending in .vrlab
export const isPairProjectName=n=>typeof n==='string'&&n.length<=200&&/^[^/\\\x00-\x1f.][^/\\\x00-\x1f]*\.vrlab$/.test(n);
// the parsed docs/sample-pairs.json -> {pairs: {<id>: [{dir, project}]} (only what follows the rules, dir order kept), problems: [what was left out]}. Pure; the one place of the file's shape.
export function normalizeSamplePairs(raw){
 const pairs={},problems=[];
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return{pairs,problems:['not an object']};
 for(const id of Object.keys(raw)){
  if(!isSampleId(id)){problems.push(JSON.stringify(id)+' is not a valid folder name');continue}
  if(!Array.isArray(raw[id])){problems.push(id+': not an array');continue}
  const list=[];
  for(const e of raw[id]){
   if(!e||typeof e!=='object'||!isPairDir(e.dir)||!isPairProjectName(e.project)){problems.push(id+': '+JSON.stringify(e)+' is not {dir, project}');continue}
   if(list.some(x=>x.dir===e.dir)){problems.push(id+'/'+e.dir+' is listed twice');continue}
   list.push({dir:e.dir,project:e.project});
  }
  if(list.length)pairs[id]=list;
 }
 return{pairs,problems};
}
let knownPairs=new Map();
export function setKnownSamplePairs(raw){knownPairs=new Map(Object.entries(normalizeSamplePairs(raw).pairs).map(([id,l])=>[id,new Map(l.map(e=>[e.dir,e.project]))]))}
// the partner folders listed for a registered dataset: [{dir, project}] ([] for a dataset without one)
export function samplePartners(id){return known.has(id)&&knownPairs.has(id)?[...knownPairs.get(id)].map(([dir,project])=>({dir,project})):[]}
// null unless `id` is a registered dataset AND the pairs file lists <dir> below it
export function memberSet(id,dir){
 const set=sampleSet(id),project=set&&knownPairs.get(id)?.get(dir);
 return project?{base:set.base+dir+'/',keyPrefix:(id==='sample1'?'/__vrl-sample/v1/'+id+'/':set.keyPrefix)+dir+'/',project}:null;
}
function needMember(id,dir){const s=memberSet(id,dir);if(!s)throw new Error('Unknown sample partner: '+id+'/'+dir);return s}
const memberBase=(set,pathname)=>resolveSampleBase(set.base,pathname??here(),DEMO_FROM_SITE_ROOT);
export function memberIndexUrl(id,dir,pathname){return memberBase(needMember(id,dir),pathname)+'index.json'}
export function memberProjectUrl(id,dir,pathname){const s=needMember(id,dir);return memberBase(s,pathname)+encodeURIComponent(s.project)}
// slice URL: like sampleSliceUrl (the .dcm come from the slice root when the site has one), one folder deeper
export function memberSliceUrl(id,dir,name,pathname,root=SLICE_ROOT){const set=needMember(id,dir),r=isSlice(name)?sliceRoot(root):'';return (r?r+set.base:memberBase(set,pathname))+slicePath(name)}
export function memberCacheKey(origin,id,dir,name){return origin+needMember(id,dir).keyPrefix+encodeURIComponent(name)}
// the sub-folder segment of an index.json name of the shape <sub-folder>/<file>.dcm ('' for every other name, which is read from the folder itself)
export function sliceSubfolder(name){const m=SLICE_SUBPATH.exec(name);return m?m[1]:''}
