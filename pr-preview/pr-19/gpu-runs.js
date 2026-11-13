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

export function gpuOwnerOrder(srcRuns,sourceDims){
 const sw=sourceDims[0],sh=sourceDims[1],n=srcRuns.length,cnt=new Float64Array(n),out=[];
 for(let k=0;k<n;k++){const runs=srcRuns[k];if(!runs)continue;out.push(k);
  for(let z=0;z<runs.length;z++){const rec=runs[z];if(!rec||!rec.length)continue;for(let i=0;i<rec.length;i+=3){if(rec[i]>=sh)continue;const xb=Math.min(rec[i+2],sw-1);if(xb>=rec[i+1])cnt[k]+=xb-rec[i+1]+1}}}
 return out.sort((a,b)=>cnt[b]-cnt[a]||a-b);
}
// onSlice(z, own) gets the grid slice z, own = Uint16Array(w * h), 0 = no item, k + 1 = item k (own is reused: copy what is kept). Slice by slice: one source slice of owners (w * h of the source, Uint16)
// and one grid-slice buffer, never a whole grid. Only for a grid no finer than the source on any axis. Self-contained apart from gpuOwnerOrder (worker source).
export function gpuOwnerSlices(srcRuns,sourceDims,textureDims,onSlice){
 const sw=sourceDims[0],sh=sourceDims[1],sd=sourceDims[2],w=textureDims[0],h=textureDims[1],d=textureDims[2],wh=w*h,n=Math.min(srcRuns.length,65535),items=srcRuns.slice(0,n);
 const order=gpuOwnerOrder(items,sourceDims),prio=new Int32Array(n).fill(-1);order.forEach((k,r)=>{prio[k]=r});
 const cen=(s,src,t)=>Math.min(t-1,Math.floor((s+0.5)*t/src));
 const yOf=new Int32Array(sh),xOf=new Int32Array(sw),zFirst=new Int32Array(d).fill(-1),zLast=new Int32Array(d).fill(-1);
 for(let z=0;z<sd;z++){const c=cen(z,sd,d);if(zFirst[c]<0)zFirst[c]=z;zLast[c]=z}
 for(let y=0;y<sh;y++)yOf[y]=cen(y,sh,h);
 for(let x=0;x<sw;x++)xOf[x]=cen(x,sw,w);
 const src=new Uint16Array(sw*sh),rx0=new Int32Array(sh).fill(-1),rx1=new Int32Array(sh),rows=[],segs=new Array(n),seen=[];
 const own=new Uint16Array(wh);
 for(let tz=0;tz<d;tz++){
  own.fill(0);
  if(zFirst[tz]>=0){
   for(let z=zFirst[tz];z<=zLast[tz];z++){
    for(const k of order){const rec=items[k][z];if(!rec||!rec.length)continue;
     for(let i=0;i<rec.length;i+=3){const y=rec[i];if(y>=sh)continue;const xa=rec[i+1],xb=Math.min(rec[i+2],sw-1);if(xb<xa)continue;src.fill(k+1,y*sw+xa,y*sw+xb+1);
      if(rx0[y]<0){rx0[y]=xa;rx1[y]=xb;rows.push(y)}else{if(xa<rx0[y])rx0[y]=xa;if(xb>rx1[y])rx1[y]=xb}}}
    for(const y of rows){const o=y*sw,e=rx1[y];let x=rx0[y];
     while(x<=e){const id=src[o+x];if(!id){x++;continue}let b=x;while(b+1<=e&&src[o+b+1]===id)b++;let L=segs[id-1];if(!L){L=segs[id-1]=[];seen.push(id-1)}L.push(y,x,b);x=b+1}
     src.fill(0,o+rx0[y],o+e+1);rx0[y]=-1}
    rows.length=0;
   }
   for(const k of seen){const L=segs[k];
    for(let i=0;i<L.length;i+=3){
     const o=yOf[L[i]]*w,c0=xOf[L[i+1]],c1=xOf[L[i+2]];
     for(let c=c0;c<=c1;c++){const v=o+c;if(!own[v]||prio[k]>prio[own[v]-1])own[v]=k+1}}
    segs[k]=null}
   seen.length=0;
  }
  onSlice(tz,own);
 }
}
