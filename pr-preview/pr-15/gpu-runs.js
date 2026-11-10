// Run-length masks of a segment (rows of [y, x0, x1] triples per z slice) mapped onto another grid. Pure (no DOM, no GL, no imports): the functions are also the source of the VR
// preparation worker (vr-volume-prep.js), so each one must stay self-contained. gpuRunsForTexture is the one the page and the VR view call (medical-volume.js re-exports it).
export function gpuRunRowMapToSlice(rows,w){
 const rec=[];
 for(const y of [...rows.keys()].sort((a,b)=>a-b)){
  const raw=rows.get(y);if(!raw?.length)continue;
  raw.sort((a,b)=>a[0]-b[0]);let x0=raw[0][0],x1=raw[0][1];
  for(let i=1;i<raw.length;i++){
   const a=raw[i][0],b=raw[i][1];
   if(a<=x1+1)x1=Math.max(x1,b);else{rec.push(y,Math.max(0,x0),Math.min(w-1,x1));x0=a;x1=b}
  }
  rec.push(y,Math.max(0,x0),Math.min(w-1,x1));
 }
 return new Uint32Array(rec);
}
export function gpuLowerBound(map,value){
 let lo=0,hi=map.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(map[mid]<value)lo=mid+1;else hi=mid}
 return lo;
}
export function gpuUpperBound(map,value){
 let lo=0,hi=map.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(map[mid]<=value)lo=mid+1;else hi=mid}
 return lo;
}
export function gpuDilateRuns(runs,w,h,d,radius=1){
 if(radius<=0)return runs;
 const rowsByZ=Array.from({length:d},()=>new Map());
 for(let z=0;z<d;z++){
  const rec=runs?.[z];if(!rec?.length)continue;
  for(let i=0;i<rec.length;i+=3){
   const y=rec[i],x0=Math.max(0,rec[i+1]-radius),x1=Math.min(w-1,rec[i+2]+radius);
   for(let dz=-radius;dz<=radius;dz++){
    const zz=z+dz;if(zz<0||zz>=d)continue;
    const rows=rowsByZ[zz];
    for(let dy=-radius;dy<=radius;dy++){
     const yy=y+dy;if(yy<0||yy>=h)continue;
     const arr=rows.get(yy)||[];arr.push([x0,x1]);rows.set(yy,arr);
    }
   }
  }
 }
 return rowsByZ.map(rows=>gpuRunRowMapToSlice(rows,w));
}
export function gpuRunsForTexture(runs,sourceDims,textureDims,{dilate=0}={}){
 const [sw,sh,sd]=sourceDims,[tw,th,td]=textureDims;
 if(!runs)return null;
 // same grid, no dilation: the runs pass through as given. Every consumer (the row searches of volumeShader and the edit
 // mask texture, which must agree with them) assumes each row's intervals sorted by x0 and disjoint, as the run builders emit them.
 if(sw===tw&&sh===th&&sd===td)return dilate?gpuDilateRuns(runs,tw,th,td,dilate):runs;
 const xMap=new Uint32Array(tw),yMap=new Uint32Array(th),zMap=new Uint32Array(td);
 for(let x=0;x<tw;x++)xMap[x]=tw<=1?0:Math.round(x*(sw-1)/(tw-1));
 for(let y=0;y<th;y++)yMap[y]=th<=1?0:Math.round(y*(sh-1)/(th-1));
 for(let z=0;z<td;z++)zMap[z]=td<=1?0:Math.round(z*(sd-1)/(td-1));
 const out=new Array(td);
 for(let tz=0;tz<td;tz++){
  const rec=runs[zMap[tz]],srcRows=new Map(),dstRows=new Map();
  if(rec?.length){
   for(let i=0;i<rec.length;i+=3){const y=rec[i],arr=srcRows.get(y)||[];arr.push([rec[i+1],rec[i+2]]);srcRows.set(y,arr)}
   for(let ty=0;ty<th;ty++){
    const intervals=srcRows.get(yMap[ty]);if(!intervals?.length)continue;
    const dst=[];
    for(const [sx0,sx1] of intervals){
     const tx0=gpuLowerBound(xMap,sx0),tx1=gpuUpperBound(xMap,sx1)-1;
     if(tx0<=tx1&&tx0<tw&&tx1>=0)dst.push([Math.max(0,tx0),Math.min(tw-1,tx1)]);
    }
    if(dst.length)dstRows.set(ty,dst);
   }
  }
  out[tz]=gpuRunRowMapToSlice(dstRows,tw);
 }
 return dilate?gpuDilateRuns(out,tw,th,td,dilate):out;
}
