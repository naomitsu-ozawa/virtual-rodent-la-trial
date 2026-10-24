// Extracted verbatim from app.js by tools/extract-module.mjs.
// Self-contained: depends only on the imports below (no module state).
import { morphMask } from './mask-ops.js?v=20261024-build666';
import { frameYield } from './utils.js?v=20261024-build666';
import { thinSuppressActive, suppressThinStack } from './thin-suppress.js?v=20261024-build666';
export class RunUnionFind{
 constructor(capacity=65536){this.parent=new Uint32Array(capacity);this.size=new Uint32Array(capacity);this.count=0}
 grow(){
  const nextCap=this.parent.length*2,p=new Uint32Array(nextCap),s=new Uint32Array(nextCap);p.set(this.parent);s.set(this.size);this.parent=p;this.size=s;
 }
 add(weight){
  if(this.count>=this.parent.length)this.grow();const id=this.count++;this.parent[id]=id;this.size[id]=weight;return id;
 }
 find(id){
  let root=id;while(this.parent[root]!==root)root=this.parent[root];
  while(this.parent[id]!==id){const next=this.parent[id];this.parent[id]=root;id=next}
  return root;
 }
 union(a,b){
  let ra=this.find(a),rb=this.find(b);if(ra===rb)return ra;
  if(this.size[ra]<this.size[rb]){const t=ra;ra=rb;rb=t}
  this.parent[rb]=ra;this.size[ra]+=this.size[rb];return ra;
 }
}
export function unionOverlappingRuns(a,b,uf){
 let i=0,j=0;
 while(i<a.length&&j<b.length){
  const ar=a[i],br=b[j];
  if(ar[1]<br[0]){i++;continue}
  if(br[1]<ar[0]){j++;continue}
  uf.union(ar[2],br[2]);
  if(ar[1]<=br[1])i++;else j++;
 }
}
export function sourceRunSlice(mask,w,h,z,seed,uf,prevSliceRows){
 const records=[],rows=new Array(h);let prevRow=[];
 for(let y=0;y<h;y++){
  const runs=[];let x=0,row=y*w;
  while(x<w){
   while(x<w&&!mask[row+x])x++;if(x>=w)break;
   const x0=x;while(x+1<w&&mask[row+x+1])x++;const x1=x,label=uf.add(x1-x0+1),run=[x0,x1,label];runs.push(run);
   if(Math.abs(z-seed.z)<=2&&Math.abs(y-seed.y)<=2){
    const dx=seed.x<x0?x0-seed.x:seed.x>x1?seed.x-x1:0;
    if(dx<=2){
     const dist2=dx*dx+(y-seed.y)*(y-seed.y)+(z-seed.z)*(z-seed.z);
     if(dist2<seed.bestDist2){seed.bestDist2=dist2;seed.label=label}
    }
   }
   records.push(y,x0,x1,label);x++;
  }
  unionOverlappingRuns(runs,prevRow,uf);
  unionOverlappingRuns(runs,prevSliceRows?.[y]||[],uf);
  rows[y]=runs;prevRow=runs;
 }
 return{rows,records:new Uint32Array(records)};
}
export function sourceRunSliceFromRanges(rowRanges,w,h,z,seed,uf,prevSliceRows){
 const records=[],rows=new Array(h);let prevRow=[];
 for(let y=0;y<h;y++){
  const raw=rowRanges.get(y)||[];raw.sort((a,b)=>a[0]-b[0]);const merged=[];
  for(const pair of raw){if(!merged.length||pair[0]>merged[merged.length-1][1]+1)merged.push([pair[0],pair[1]]);else merged[merged.length-1][1]=Math.max(merged[merged.length-1][1],pair[1])}
  const runs=[];
  for(const [x0,x1] of merged){
   const label=uf.add(x1-x0+1),run=[x0,x1,label];runs.push(run);
   if(Math.abs(z-seed.z)<=2&&Math.abs(y-seed.y)<=2){
    const dx=seed.x<x0?x0-seed.x:seed.x>x1?seed.x-x1:0,dist2=dx*dx+(y-seed.y)*(y-seed.y)+(z-seed.z)*(z-seed.z);
    if(dx<=2&&dist2<seed.bestDist2){seed.bestDist2=dist2;seed.label=label}
   }
   records.push(y,x0,x1,label);
  }
  unionOverlappingRuns(runs,prevRow,uf);unionOverlappingRuns(runs,prevSliceRows?.[y]||[],uf);rows[y]=runs;prevRow=runs;
 }
 return{rows,records:new Uint32Array(records)};
}
export function consumeGpuAnalysisRuns(items,zStart,depth,w,h,seed,uf,prevRows,sliceRuns){
 const bySlice=Array.from({length:depth},()=>new Map());
 for(let i=0;i<items.length;i+=4){
  const lz=items[i],y=items[i+1],x0=items[i+2],x1=items[i+3];if(lz>=depth||y>=h)continue;
  const map=bySlice[lz],arr=map.get(y)||[];arr.push([x0,x1]);map.set(y,arr);
 }
 let rows=prevRows;
 for(let local=0;local<depth;local++){
  const z=zStart+local,result=sourceRunSliceFromRanges(bySlice[local],w,h,z,seed,uf,rows);sliceRuns[z]=result.records;rows=result.rows;
 }
 return rows;
}
export function maskToAnalysisRuns(mask,w,h,d){
 const slices=new Array(d);
 for(let z=0;z<d;z++){
  const rec=[];const base=z*w*h;
  for(let y=0;y<h;y++){
   let x=0,row=base+y*w;
   while(x<w){
    while(x<w&&!mask[row+x])x++;if(x>=w)break;
    const x0=x;while(x+1<w&&mask[row+x+1])x++;rec.push(y,x0,x);x++;
   }
  }
  slices[z]=new Uint32Array(rec);
 }
 return slices;
}
export function sourceResultToAnalysisRuns(result,d){
 const slices=new Array(d);
 for(let z=0;z<d;z++){
  const src=result.sliceRuns[z],rec=[];
  if(src)for(let i=0;i<src.length;i+=4){
   const y=src[i],x0=src[i+1],x1=src[i+2],label=src[i+3];
   if(result.uf.find(label)===result.root)rec.push(y,x0,x1);
  }
  slices[z]=new Uint32Array(rec);
 }
 return slices;
}
export function analysisRunsVoxelCount(runsBySlice){
 let count=0;for(const rec of runsBySlice||[])if(rec)for(let i=0;i<rec.length;i+=3)count+=rec[i+2]-rec[i+1]+1;return count;
}
// Pixel mask of one MPR plane from per-slice runs, cached per runs array (the
// 2D overlay tested every pixel with analysisRunsContain, a scan of the whole
// slice's runs per pixel, which made every 2D repaint slow). Pixel mapping as in
// paintSourcePlane: axial (x,y) at z=idx; coronal (x, d-1-z) at y=idx;
// sagittal (y, d-1-z) at x=idx.
const planeMaskCache=new WeakMap();
export function runsPlaneMask(runs,p,idx,w,h,d){
 let byPlane=planeMaskCache.get(runs);if(!byPlane){byPlane=new Map();planeMaskCache.set(runs,byPlane)}
 const key=p+':'+idx,hit=byPlane.get(key);if(hit)return hit;
 const pw=p==='sagittal'?h:w,ph=p==='axial'?h:d,mask=new Uint8Array(pw*ph);
 if(p==='axial'){const rec=runs[idx];if(rec)for(let i=0;i<rec.length;i+=3)mask.fill(1,rec[i]*pw+rec[i+1],rec[i]*pw+rec[i+2]+1)}
 else for(let z=0;z<d;z++){
  const rec=runs[z];if(!rec?.length)continue;const row=(d-1-z)*pw;
  if(p==='coronal'){for(let i=0;i<rec.length;i+=3)if(rec[i]===idx)mask.fill(1,row+rec[i+1],row+rec[i+2]+1)}
  else for(let i=0;i<rec.length;i+=3)if(rec[i+1]<=idx&&idx<=rec[i+2])mask[row+rec[i]]=1;
 }
 if(byPlane.size>=12)byPlane.delete(byPlane.keys().next().value);
 byPlane.set(key,mask);return mask;
}
export function analysisRunsContain(runsBySlice,x,y,z){
 const rec=runsBySlice?.[z];if(!rec)return false;
 for(let i=0;i<rec.length;i+=3){if(rec[i]!==y)continue;if(x>=rec[i+1]&&x<=rec[i+2])return true}
 return false;
}
export function analysisRunsOverlap(a,b){
 const d=Math.min(a?.length||0,b?.length||0);
 for(let z=0;z<d;z++){
  const ar=a[z],br=b[z];if(!ar?.length||!br?.length)continue;
  let i=0,j=0;
  while(i<ar.length&&j<br.length){
   const ay=ar[i],by=br[j];
   if(ay<by){i+=3;continue}if(by<ay){j+=3;continue}
   const a0=ar[i+1],a1=ar[i+2],b0=br[j+1],b1=br[j+2];
   if(a1<b0){i+=3;continue}if(b1<a0){j+=3;continue}return true;
  }
 }
 return false;
}
export function unionAnalysisRuns(regions,d){
 const out=new Array(d);
 for(let z=0;z<d;z++){
  const byRow=new Map();
  for(const region of regions){
   const rec=region.runsBySlice[z];if(!rec)continue;
   for(let i=0;i<rec.length;i+=3){
    const y=rec[i],arr=byRow.get(y)||[];arr.push([rec[i+1],rec[i+2]]);byRow.set(y,arr);
   }
  }
  const merged=[];
  for(const y of [...byRow.keys()].sort((a,b)=>a-b)){
   const intervals=byRow.get(y).sort((a,b)=>a[0]-b[0]);let [s,e]=intervals[0];
   for(let i=1;i<intervals.length;i++){
    const [ns,ne]=intervals[i];
    if(ns<=e+1)e=Math.max(e,ne);else{merged.push(y,s,e);s=ns;e=ne}
   }
   merged.push(y,s,e);
  }
  out[z]=new Uint32Array(merged);
 }
 return out;
}
export function rowIntervalsFromRuns(rec){
 const rows=new Map();if(!rec)return rows;
 for(let i=0;i<rec.length;i+=3){const y=rec[i],arr=rows.get(y)||[];arr.push([rec[i+1],rec[i+2]]);rows.set(y,arr)}
 for(const arr of rows.values())arr.sort((a,b)=>a[0]-b[0]);
 return rows;
}
export function mergeIntervals(intervals){
 if(!intervals?.length)return[];
 const sorted=intervals.slice().sort((a,b)=>a[0]-b[0]),out=[];let [s,e]=sorted[0];
 for(let i=1;i<sorted.length;i++){const [ns,ne]=sorted[i];if(ns<=e+1)e=Math.max(e,ne);else{out.push([s,e]);s=ns;e=ne}}
 out.push([s,e]);return out;
}
export function rowsToRunSlice(rows){
 const rec=[];for(const y of [...rows.keys()].sort((a,b)=>a-b))for(const [x0,x1] of mergeIntervals(rows.get(y)))if(x1>=x0)rec.push(y,x0,x1);
 return new Uint32Array(rec);
}
export function unionRunSlice(a,b){
 const rows=rowIntervalsFromRuns(a);for(const [y,arr] of rowIntervalsFromRuns(b)){const dst=rows.get(y)||[];dst.push(...arr);rows.set(y,dst)}return rowsToRunSlice(rows);
}
export function intersectRunSlice(a,b){
 const ar=rowIntervalsFromRuns(a),br=rowIntervalsFromRuns(b),out=new Map();
 for(const [y,aa] of ar){const bb=br.get(y);if(!bb)continue;const rr=[];let i=0,j=0;while(i<aa.length&&j<bb.length){const lo=Math.max(aa[i][0],bb[j][0]),hi=Math.min(aa[i][1],bb[j][1]);if(lo<=hi)rr.push([lo,hi]);if(aa[i][1]<bb[j][1])i++;else j++}if(rr.length)out.set(y,rr)}
 return rowsToRunSlice(out);
}
export function subtractRunSlice(a,b){
 const ar=rowIntervalsFromRuns(a),br=rowIntervalsFromRuns(b),out=new Map();
 for(const [y,aa] of ar){const bb=br.get(y)||[],rr=[];for(const [a0,a1] of aa){let cursor=a0;for(const [b0,b1] of bb){if(b1<cursor)continue;if(b0>a1)break;if(b0>cursor)rr.push([cursor,Math.min(a1,b0-1)]);cursor=Math.max(cursor,b1+1);if(cursor>a1)break}if(cursor<=a1)rr.push([cursor,a1])}if(rr.length)out.set(y,rr)}
 return rowsToRunSlice(out);
}
export function runArraysBinary(a,b,d,op){
 const out=new Array(d);for(let z=0;z<d;z++)out[z]=op(a?.[z],b?.[z]);return out;
}
export function unionRunArrays(a,b,d){return runArraysBinary(a,b,d,unionRunSlice)}
export function intersectRunArrays(a,b,d){return runArraysBinary(a,b,d,intersectRunSlice)}
export function subtractRunArrays(a,b,d){return runArraysBinary(a,b,d,subtractRunSlice)}
export function runsSliceToMask(rec,w,h){
 const mask=new Uint8Array(w*h);if(!rec)return mask;
 for(let i=0;i<rec.length;i+=3){const y=rec[i],x0=rec[i+1],x1=rec[i+2],row=y*w;mask.fill(1,row+x0,row+x1+1)}
 return mask;
}
export function complementRunArrays(runs,w,h,d){
 const out=new Array(d);
 for(let z=0;z<d;z++){
  const rows=rowIntervalsFromRuns(runs[z]),rec=[];
  for(let y=0;y<h;y++){
   const rr=rows.get(y)||[];let x=0;
   for(const [x0,x1] of rr){if(x<x0)rec.push(y,x,x0-1);x=Math.max(x,x1+1)}
   if(x<w)rec.push(y,x,w-1);
  }
  out[z]=new Uint32Array(rec);
 }
 return out;
}
export function componentTouchesVolumeBoundary(comp,w,h,d){
 for(let z=0;z<d;z++){
  const rec=comp.runsBySlice[z];if(!rec?.length)continue;
  if(z===0||z===d-1)return true;
  for(let i=0;i<rec.length;i+=3){const y=rec[i],x0=rec[i+1],x1=rec[i+2];if(y===0||y===h-1||x0===0||x1===w-1)return true}
 }
 return false;
}
export async function morphSourceRunArrays(runs,w,h,d,opening,closing){
 if(!opening&&!closing)return runs;
 const out=new Array(d),blockDepth=navigator.maxTouchPoints>0?4:12,halo=2*(opening+closing),plane=w*h;
 for(let z0=0;z0<d;z0+=blockDepth){
  const core=Math.min(blockDepth,d-z0),a=Math.max(0,z0-halo),b=Math.min(d,z0+core+halo),localD=b-a,mask=new Uint8Array(localD*plane);
  for(let z=a;z<b;z++)mask.set(runsSliceToMask(runs[z],w,h),(z-a)*plane);
  let processed=mask;
  if(opening>0){processed=morphMask(processed,w,h,localD,opening,false);processed=morphMask(processed,w,h,localD,opening,true)}
  if(closing>0){processed=morphMask(processed,w,h,localD,closing,true);processed=morphMask(processed,w,h,localD,closing,false)}
  for(let z=0;z<core;z++){const local=z0+z-a,slice=processed.subarray(local*plane,(local+1)*plane);out[z0+z]=maskToAnalysisRuns(slice,w,h,1)[0]}
  await frameYield();
 }
 return out;
}
// Thin-region suppression on runs, block-wise; bodyRuns (voxels at or above
// segment's lower bound) are needed only for the air-boundary exclusion.
export async function thinSuppressSourceRuns(runs,w,h,d,spacing,seg,bodyRuns,alive=()=>true,onProgress=null){
 const out=new Array(d),opts={surfaceMm:bodyRuns?seg.surfaceMm:0,thicknessMm:seg.thicknessMm};
 if(!thinSuppressActive(opts))return runs;
 const it=suppressThinStack(z=>runsSliceToMask(runs[z],w,h),z=>runsSliceToMask(bodyRuns[z],w,h),w,h,d,spacing,opts,(z,mask)=>{out[z]=maskToAnalysisRuns(mask,w,h,1)[0]},{blockDepth:8});
 for(let r=it.next();!r.done;r=it.next()){onProgress?.(r.value,d);await frameYield();if(!alive())throw new Error('__SUPERSEDED__')}
 return out;
}
export async function postprocessSourceRuns(runs,v,seg,bodyRuns=null,alive=()=>true,onProgress=null){
 const w=v.columns,h=v.rows,d=v.slices;
 let out=thinSuppressActive(seg)?await thinSuppressSourceRuns(runs,w,h,d,v.spacing||[1,1,1],seg,bodyRuns,alive,onProgress):runs;
 if(!alive())throw new Error('__SUPERSEDED__');
 out=await morphSourceRunArrays(out,w,h,d,seg.opening,seg.closing);
 if(seg.holeFill){
  const background=complementRunArrays(out,w,h,d),holes=componentsFromRuns(background,w,h,d).filter(comp=>!componentTouchesVolumeBoundary(comp,w,h,d));
  if(holes.length){const holeRuns=unionAnalysisRuns(holes,d);out=unionRunArrays(out,holeRuns,d)}
  await frameYield();
 }
 if(seg.minComponent>0){
  const keep=componentsFromRuns(out,w,h,d).filter(comp=>comp.voxels>=seg.minComponent);
  out=keep.length?unionAnalysisRuns(keep,d):Array.from({length:d},()=>new Uint32Array(0));
  await frameYield();
 }
 return out;
}
export function componentsFromRuns(runs,w,h,d){
 const uf=new RunUnionFind(),labeled=new Array(d),seed={x:-999999,y:-999999,z:-999999,label:null,bestDist2:Infinity};let prevRows=null;
 for(let z=0;z<d;z++){const map=rowIntervalsFromRuns(runs[z]),res=sourceRunSliceFromRanges(map,w,h,z,seed,uf,prevRows);labeled[z]=res.records;prevRows=res.rows}
 const groups=new Map();
 for(let z=0;z<d;z++){const rec=labeled[z];for(let i=0;i<rec.length;i+=4){const root=uf.find(rec[i+3]);let g=groups.get(root);if(!g){g={root,runsBySlice:Array.from({length:d},()=>[])};groups.set(root,g)}g.runsBySlice[z].push(rec[i],rec[i+1],rec[i+2])}}
 return [...groups.values()].map(g=>{g.runsBySlice=g.runsBySlice.map(a=>new Uint32Array(a));g.voxels=uf.size[uf.find(g.root)];return g}).sort((a,b)=>b.voxels-a.voxels);
}
export async function componentsFromRunsAsync(runs,w,h,d,onProgress=null){
 const uf=new RunUnionFind(),labeled=new Array(d),seed={x:-999999,y:-999999,z:-999999,label:null,bestDist2:Infinity};let prevRows=null;
 for(let z=0;z<d;z++){
  const map=rowIntervalsFromRuns(runs[z]),res=sourceRunSliceFromRanges(map,w,h,z,seed,uf,prevRows);labeled[z]=res.records;prevRows=res.rows;
  if((z&15)===0){onProgress?.('label',z+1,d);await frameYield()}
 }
 const groups=new Map();
 for(let z=0;z<d;z++){
  const rec=labeled[z];for(let i=0;i<rec.length;i+=4){const root=uf.find(rec[i+3]);let g=groups.get(root);if(!g){g={root,runsBySlice:Array.from({length:d},()=>[])};groups.set(root,g)}g.runsBySlice[z].push(rec[i],rec[i+1],rec[i+2])}
  if((z&31)===0){onProgress?.('collect',z+1,d);await frameYield()}
 }
 onProgress?.('collect',d,d);
 return [...groups.values()].map(g=>{g.runsBySlice=g.runsBySlice.map(a=>new Uint32Array(a));g.voxels=uf.size[uf.find(g.root)];return g}).sort((a,b)=>b.voxels-a.voxels);
}
export function analysisRunRows(records){
 const rows=new Map();
 if(records)for(let i=0;i<records.length;i+=3){const y=records[i],arr=rows.get(y)||[];arr.push(records[i+1],records[i+2]);rows.set(y,arr)}
 return rows;
}
export function forEachUncoveredRun(x0,x1,cover,fn){
 let cursor=x0;
 if(cover)for(let i=0;i<cover.length;i+=2){
  const a=cover[i],b=cover[i+1];if(b<cursor)continue;if(a>x1)break;
  if(a>cursor)fn(cursor,Math.min(x1,a-1));cursor=Math.max(cursor,b+1);if(cursor>x1)return;
 }
 if(cursor<=x1)fn(cursor,x1);
}
export function maskFromAnalysisRuns(v,runs){
 const out=new Uint8Array(v.columns*v.rows*v.slices),w=v.columns,h=v.rows;
 for(let z=0;z<v.slices;z++){const a=runs?.[z];if(!a)continue;for(let i=0;i<a.length;i+=3){const y=a[i],x0=a[i+1],x1=a[i+2],base=z*w*h+y*w;out.fill(1,base+x0,base+x1+1)}}
 return out;
}
