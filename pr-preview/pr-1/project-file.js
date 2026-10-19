// Project files (.vrlab): the portable, original-resolution record of a
// session — filter settings, segment settings, 3D edits and display state —
// without the DICOM data itself. Pure functions (no DOM); app.js gathers and
// applies the state. Layout: a zip with project.json plus binary run files.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'https://esm.sh/fflate@0.8.2';

export const PROJECT_FORMAT='virtual-rodent-lab-project';
export const PROJECT_VERSION=1;
export const PROJECT_EXTENSION='.vrlab';

// What identifies the data a project belongs to (original resolution).
export function datasetFingerprint(series){
 const f=series?.slices?.[0]||{};
 return{
  seriesId:series?.id??null,studyUid:f.studyUid??null,seriesUid:f.seriesUid??null,
  description:series?.description??'',modality:series?.modality??'',
  columns:series?.columns??0,rows:series?.rows??0,slices:series?.slices?.length??0,
  // build 469: legacy first-two-slices spacing (recognises projects saved before the new rule) and excluded duplicates
  legacySpacingZ:series?.spacingCheck?.legacyZ??null,duplicatesExcluded:series?.spacingCheck?.duplicatesExcluded||0,
  spacing:[series?.spacingX,series?.spacingY,series?.spacingZ].map(n=>Number.isFinite(+n)?+(+n).toPrecision(8):null),
 };
}

const SPACING_TOL=(v)=>1e-4*Math.max(1,Math.abs(v));
const spacingDiffers=(a,b)=>a==null||b==null||Math.abs(a-b)>SPACING_TOL(a);
// opts.legacyZ: also accept a project whose ONLY difference is the z spacing of the pre-build-469 rule (see legacySpacingUpgrade)
export function compareFingerprints(saved,current,opts){
 const issues=[];
 if(saved?.seriesUid&&current?.seriesUid&&saved.seriesUid!==current.seriesUid)issues.push('seriesUid');
 for(const k of['columns','rows','slices'])if(saved?.[k]!==current?.[k])issues.push(k);
 const a=saved?.spacing||[],b=current?.spacing||[];
 if(a.length!==3||b.length!==3||a.some((v,i)=>spacingDiffers(v,b[i])))issues.push('spacing');
 if(opts?.legacyZ&&issues.length===1&&issues[0]==='spacing'&&legacySpacingUpgrade(saved,current))return{ok:true,issues:[],legacyZ:true};
 return{ok:issues.length===0,issues};
}
// Project saved before build 469 whose z spacing was the first-two-slices difference: only the z spacing differs,
// slice count / size / x,y spacing are unchanged and the saved z equals the legacy value of the current series.
// Returns {savedZ,newZ} (the user is asked) or null (reject).
export function legacySpacingUpgrade(saved,current){
 const c=compareFingerprints(saved,current);
 if(c.issues.length!==1||c.issues[0]!=='spacing')return null;
 const a=saved.spacing,b=current.spacing,lz=current.legacySpacingZ;
 if(spacingDiffers(a[0],b[0])||spacingDiffers(a[1],b[1])||lz==null||spacingDiffers(a[2],lz))return null;
 return{savedZ:a[2],newZ:b[2]};
}
// Why a project does not fit the series: {ja,en} for the footer, or null for the generic case.
export function projectMismatchReason(saved,current){
 const ex=current?.duplicatesExcluded||0;
 if(ex>0&&saved?.slices===current.slices+ex)return{ja:'このデータは重複スライスを除外するようになったため、以前のプロジェクトとスライス数が合いません',en:'Duplicate slices are now excluded from this data, so the slice count no longer matches the earlier project'};
 return null;
}

const mm=n=>(Math.round(n*10000)/10000).toString();
// The confirm text for a legacy-spacing project ({ja,en}).
// Relative change of the z spacing in percent (volumes scale by the same factor).
export const spacingChangePct=up=>(up.newZ/up.savedZ-1)*100;
export function legacySpacingPrompt(up){
 const pct=spacingChangePct(up),big=Math.abs(pct)>1,p=(pct>=0?'+':'')+(Math.round(pct*100)/100)+'%',a=Math.abs(Math.round(pct*100)/100)+'%';
 return{
  ja:'build 469 からスライス間隔の決め方が変わりました（先頭 2 枚の差 → 全体から計算）。保存時 '+mm(up.savedZ)+' mm → 新しい間隔 '+mm(up.newZ)+' mm（'+p+'）。新しい間隔で開きますか？'+(big?'体積が '+a+' 変わります。以前の結果は再計算が必要です':'体積がわずかに変わります'),
  en:'Since build 469 the slice spacing is computed differently (first two slices -> whole series). Saved: '+mm(up.savedZ)+' mm -> new: '+mm(up.newZ)+' mm ('+p+'). Open with the new spacing? '+(big?'Volumes change by '+a+'. Earlier results need to be recalculated':'Volumes change slightly'),
 };
}
// Decide what to do with a project for a series. confirmFn(text) -> boolean (window.confirm on the page).
// {action:'apply'} | {action:'cancel',legacy:true} | {action:'reject',reason:{ja,en}|null,issues}
export function resolveProjectMatch(saved,current,confirmFn,lang='ja'){
 const c=compareFingerprints(saved,current);
 if(c.ok)return{action:'apply'};
 const up=legacySpacingUpgrade(saved,current);
 if(up){
  const t=legacySpacingPrompt(up);
  return confirmFn(lang==='ja'?t.ja:t.en)?{action:'apply',legacy:up}:{action:'cancel',legacy:up};
 }
 return{action:'reject',reason:projectMismatchReason(saved,current),issues:c.issues};
}

// build 588: the same with an asking function that may answer later (an in-place question instead of window.confirm)
export async function resolveProjectMatchAsync(saved,current,askFn,lang='ja'){
 const up=compareFingerprints(saved,current).ok?null:legacySpacingUpgrade(saved,current);
 if(!up)return resolveProjectMatch(saved,current,()=>false,lang);
 const t=legacySpacingPrompt(up),answer=!!(await askFn(lang==='ja'?t.ja:t.en));
 return resolveProjectMatch(saved,current,()=>answer,lang);
}

// Run-length edit masks: per axial slice a flat Uint32Array of [y,x0,x1]
// triples (see run-length.js). Binary layout, little-endian uint32:
//   'VLR1' magic, slices, offsets[slices+1] (in uint32 units), data...
const RUNS_MAGIC=0x31524c56; // 'VLR1'
export function encodeRuns(runsBySlice,slices){
 let total=0;const offsets=new Uint32Array(slices+1);
 for(let z=0;z<slices;z++){offsets[z]=total;total+=runsBySlice?.[z]?.length||0}
 offsets[slices]=total;
 const words=2+offsets.length+total,dv=new DataView(new ArrayBuffer(words*4));
 let o=0;const put=v=>{dv.setUint32(o,v,true);o+=4};
 put(RUNS_MAGIC);put(slices);for(const v of offsets)put(v);
 for(let z=0;z<slices;z++){const r=runsBySlice?.[z];if(r)for(let i=0;i<r.length;i++)put(r[i])}
 return new Uint8Array(dv.buffer);
}

export function decodeRuns(bytes,{slices,columns,rows}){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<8||bytes.byteLength%4)throw new Error('Invalid run data');
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),get=i=>dv.getUint32(i*4,true);
 if(get(0)!==RUNS_MAGIC)throw new Error('Invalid run data (magic)');
 if(get(1)!==slices)throw new Error(`Run data has ${get(1)} slices, expected ${slices}`);
 const base=2+slices+1,words=bytes.byteLength/4;
 if(words<base)throw new Error('Invalid run data (truncated)');
 const out=new Array(slices);
 for(let z=0;z<slices;z++){
  const a=get(2+z),b=get(3+z);
  if(b<a||base+b>words||(b-a)%3)throw new Error('Invalid run data (offsets)');
  if(a===b){out[z]=null;continue}
  const r=new Uint32Array(b-a);
  for(let i=0;i<r.length;i+=3){
   const y=get(base+a+i),x0=get(base+a+i+1),x1=get(base+a+i+2);
   if(y>=rows||x0>x1||x1>=columns)throw new Error(`Run out of bounds at slice ${z}`);
   r[i]=y;r[i+1]=x0;r[i+2]=x1;
  }
  out[z]=r;
 }
 return out;
}

// project: plain JSON-able object; binaries: {path: Uint8Array}
export function packProject(project,binaries={}){
 const files={'project.json':strToU8(JSON.stringify({format:PROJECT_FORMAT,version:PROJECT_VERSION,...project},null,1))};
 for(const[path,bytes]of Object.entries(binaries))files[path]=[bytes,{level:6}];
 return zipSync(files,{level:6});
}

export function unpackProject(bytes){
 let files;
 try{files=unzipSync(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes))}catch{throw new Error('Not a project file (zip expected)')}
 return readProjectFiles(files);
}

// Names that may hold a project: .vrlab, and .zip because Safari/iOS can
// append ".zip" to downloads (e.g. "name.vrlab.zip").
export function isProjectArchiveName(name){return /\.(vrlab|zip)$/i.test(name||'')}

// A project whose zip was extracted (e.g. by tapping it in the iOS Files app):
// entries [{path, bytes}] containing .../project.json and .../edits/*.bin.
// Paths are relative to any folder; files next to project.json are used.
export function projectFromEntries(entries){
 const json=entries.find(e=>/(^|\/)project\.json$/.test(e.path));
 if(!json)throw new Error('Not a project folder (project.json missing)');
 const base=json.path.slice(0,json.path.length-'project.json'.length),files={};
 for(const e of entries)if(e.path.startsWith(base))files[e.path.slice(base.length)]=e.bytes;
 return readProjectFiles(files);
}

function readProjectFiles(files){
 if(!files['project.json'])throw new Error('Not a project file (project.json missing)');
 let project;
 try{project=JSON.parse(strFromU8(files['project.json']))}catch{throw new Error('Broken project.json')}
 if(project?.format!==PROJECT_FORMAT)throw new Error('Not a Virtual Rodent Lab project');
 if(!Number.isInteger(project.version)||project.version<1)throw new Error('Unknown project version');
 if(project.version>PROJECT_VERSION)throw new Error(`Project version ${project.version} is newer than this app supports (${PROJECT_VERSION}); please update`);
 return{project,files};
}
