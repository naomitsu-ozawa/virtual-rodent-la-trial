// Extracted verbatim from app.js by tools/extract-module.mjs.
// Self-contained: depends only on the imports below (no module state).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { analysisRunRows, forEachUncoveredRun } from './run-length.js?v=20261023-build657';
import { weldTrianglePositions } from './smooth-prepare.js?v=20261023-build657';
export function appendAnalysisRunBoundaryFaces(builder,records,prevRecords,nextRecords,coords,z,cutRecords=null,cutPrevRecords=null,cutNextRecords=null,pinnedKeys=null){
 const {xs,ys,zs}=coords,z0=zs[z],z1=zs[z+1],rows=analysisRunRows(records),prev=analysisRunRows(prevRecords),next=analysisRunRows(nextRecords),cut=analysisRunRows(cutRecords),cutPrev=analysisRunRows(cutPrevRecords),cutNext=analysisRunRows(cutNextRecords);
 const has=(map,x,y)=>{const a=map.get(y);if(!a)return false;for(let i=0;i<a.length;i+=2)if(x>=a[i]&&x<=a[i+1])return true;return false};
 const key=v=>Math.fround(v[0])+','+Math.fround(v[1])+','+Math.fround(v[2]);
 const quad=(a,b,c,d,pin=false)=>{builder.push(...a,...b,...c,...a,...c,...d);if(pin&&pinnedKeys){pinnedKeys.add(key(a));pinnedKeys.add(key(b));pinnedKeys.add(key(c));pinnedKeys.add(key(d))}};
 for(const [y,intervals] of rows){
  const y0=ys[y],y1=ys[y+1],up=rows.get(y-1),down=rows.get(y+1),front=prev.get(y),back=next.get(y);
  for(let r=0;r<intervals.length;r+=2){
   const x0=intervals[r],x1=intervals[r+1],lx=xs[x0],rx=xs[x1+1];
   quad([lx,y0,z0],[lx,y0,z1],[lx,y1,z1],[lx,y1,z0],has(cut,x0-1,y));
   quad([rx,y0,z0],[rx,y1,z0],[rx,y1,z1],[rx,y0,z1],has(cut,x1+1,y));
   const emit=(a,b,face)=>{for(let x=a;x<=b;x++){const xa=xs[x],xb=xs[x+1];face(x,xa,xb)}};
   forEachUncoveredRun(x0,x1,up,(a,b)=>emit(a,b,(x,xa,xb)=>quad([xa,y0,z0],[xb,y0,z0],[xb,y0,z1],[xa,y0,z1],has(cut,x,y-1))));
   forEachUncoveredRun(x0,x1,down,(a,b)=>emit(a,b,(x,xa,xb)=>quad([xa,y1,z0],[xa,y1,z1],[xb,y1,z1],[xb,y1,z0],has(cut,x,y+1))));
   forEachUncoveredRun(x0,x1,front,(a,b)=>emit(a,b,(x,xa,xb)=>quad([xa,y0,z0],[xa,y1,z0],[xb,y1,z0],[xb,y0,z0],has(cutPrev,x,y))));
   forEachUncoveredRun(x0,x1,back,(a,b)=>emit(a,b,(x,xa,xb)=>quad([xa,y0,z1],[xb,y0,z1],[xb,y1,z1],[xa,y1,z1],has(cutNext,x,y))));
  }
 }
}
export class Float32FaceBuilder{
 constructor(initial=131072){this.data=new Float32Array(initial);this.length=0;this.hasGpuMesh=false;this.hasCpuMesh=false;this.allGpuSmoothed=true}
 ensure(extra){
  const need=this.length+extra;if(need<=this.data.length)return;
  let size=this.data.length;while(size<need)size*=2;
  const next=new Float32Array(size);next.set(this.data.subarray(0,this.length));this.data=next;
 }
 appendArray(values){
  if(!values?.length)return;this.ensure(values.length);this.data.set(values,this.length);this.length+=values.length;
 }
 push(a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r){
  this.ensure(18);const x=this.data,q0=this.length;
  x[q0]=a;x[q0+1]=b;x[q0+2]=c;x[q0+3]=d;x[q0+4]=e;x[q0+5]=f;
  x[q0+6]=g;x[q0+7]=h;x[q0+8]=i;x[q0+9]=j;x[q0+10]=k;x[q0+11]=l;
  x[q0+12]=m;x[q0+13]=n;x[q0+14]=o;x[q0+15]=p;x[q0+16]=q;x[q0+17]=r;
  this.length=q0+18;
 }
 take(){
  if(!this.length)return null;
  const out=this.data.subarray(0,this.length);
  const nextSize=Math.max(131072,Math.min(this.data.length,1048576));
  this.data=new Float32Array(nextSize);this.length=0;this.hasGpuMesh=false;this.hasCpuMesh=false;this.allGpuSmoothed=true;return out;
 }
}
// the weld (smooth-prepare.js weldTrianglePositions, also run in the smoothing workers) as a BufferGeometry
export function indexedGeometryFromTrianglePositions(positions){
 const w=weldTrianglePositions(positions),geometry=new THREE.BufferGeometry();
 if(!w)return geometry;
 geometry.setAttribute('position',new THREE.BufferAttribute(w.pos,3));
 geometry.setIndex(new THREE.BufferAttribute(w.index,1));
 return geometry;
}
export function makeVolume3DCoordinates(v){
 const w=v.columns,h=v.rows,d=v.slices,[sx,sy,sz]=v.spacing,px=w*sx,py=h*sy,pz=d*sz,scale=3.3/Math.max(px,py,pz,1);
 const xs=new Float64Array(w+1),ys=new Float64Array(h+1),zs=new Float64Array(d+1);
 for(let x=0;x<=w;x++)xs[x]=(x*sx-px/2)*scale;
 for(let y=0;y<=h;y++)ys[y]=-(y*sy-py/2)*scale;
 for(let z=0;z<=d;z++)zs[z]=(z*sz-pz/2)*scale;
 return{xs,ys,zs,scale};
}
export function makeSource3DCoordinates(series){
 const w=series.columns,h=series.rows,d=series.slices.length,sx=series.spacingX,sy=series.spacingY,sz=series.spacingZ,px=w*sx,py=h*sy,pz=d*sz,scale=3.3/Math.max(px,py,pz,1);
 const xs=new Float64Array(w+1),ys=new Float64Array(h+1),zs=new Float64Array(d+1);
 for(let x=0;x<=w;x++)xs[x]=(x*sx-px/2)*scale;
 for(let y=0;y<=h;y++)ys[y]=-(y*sy-py/2)*scale;
 for(let z=0;z<=d;z++)zs[z]=(z*sz-pz/2)*scale;
 return{xs,ys,zs,scale};
}
export function appendSourceFacesFromCompactTile(positionsByKey,series,tile,active,coords){
 const {xs,ys,zs}=coords,plane=tile.width*tile.height,items=tile.items;
 for(let q=0;q<items.length;q+=2){
  const i=items[q],packed=items[q+1],tz=Math.floor(i/plane),rem=i-tz*plane,ty=Math.floor(rem/tile.width),tx=rem-ty*tile.width;
  const x=tile.x+tx,y=tile.y+ty,z=tile.z+tz,x0=xs[x],x1=xs[x+1],y0=ys[y],y1=ys[y+1],z0=zs[z],z1=zs[z+1];
  for(let s=0;s<active.length&&s<4;s++){
   const faces=(packed>>>(s*6))&63;if(!faces)continue;const positions=positionsByKey.get(active[s].key);if(!positions)continue;positions.hasCpuMesh=true;
   if(faces&1)positions.push(x0,y0,z0,x0,y0,z1,x0,y1,z1,x0,y0,z0,x0,y1,z1,x0,y1,z0);
   if(faces&2)positions.push(x1,y0,z0,x1,y1,z0,x1,y1,z1,x1,y0,z0,x1,y1,z1,x1,y0,z1);
   if(faces&4)positions.push(x0,y0,z0,x1,y0,z0,x1,y0,z1,x0,y0,z0,x1,y0,z1,x0,y0,z1);
   if(faces&8)positions.push(x0,y1,z0,x0,y1,z1,x1,y1,z1,x0,y1,z0,x1,y1,z1,x1,y1,z0);
   if(faces&16)positions.push(x0,y0,z0,x0,y1,z0,x1,y1,z0,x0,y0,z0,x1,y1,z0,x1,y0,z0);
   if(faces&32)positions.push(x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y0,z1,x1,y1,z1,x0,y1,z1);
  }
 }
}
export function appendSourceSliceFacesFast(positions,series,z,prev,curr,next,coords){
 const w=series.columns,h=series.rows,m=curr.mask,{xs,ys,zs}=coords,z0=zs[z],z1=zs[z+1],pm=prev?.mask,nm=next?.mask;
 for(const block of curr.blocks)for(let bi=0;bi<block.length;bi++){
  const i=block[bi],y=Math.floor(i/w),x=i-y*w,x0=xs[x],x1=xs[x+1],y0=ys[y],y1=ys[y+1];
  if(x===0||!m[i-1])positions.push(x0,y0,z0,x0,y0,z1,x0,y1,z1,x0,y0,z0,x0,y1,z1,x0,y1,z0);
  if(x===w-1||!m[i+1])positions.push(x1,y0,z0,x1,y1,z0,x1,y1,z1,x1,y0,z0,x1,y1,z1,x1,y0,z1);
  if(y===0||!m[i-w])positions.push(x0,y0,z0,x1,y0,z0,x1,y0,z1,x0,y0,z0,x1,y0,z1,x0,y0,z1);
  if(y===h-1||!m[i+w])positions.push(x0,y1,z0,x0,y1,z1,x1,y1,z1,x0,y1,z0,x1,y1,z1,x1,y1,z0);
  if(!pm||!pm[i])positions.push(x0,y0,z0,x0,y1,z0,x1,y1,z0,x0,y0,z0,x1,y1,z0,x1,y0,z0);
  if(!nm||!nm[i])positions.push(x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y0,z1,x1,y1,z1,x0,y1,z1);
 }
}
export function eachGeometryTriangleRange(geometry,start,count,callback){
 const pos=geometry?.getAttribute?.('position');if(!pos)return;
 const index=geometry.index,total=index?index.count:pos.count,first=Math.max(0,start||0),end=Math.min(total,count==null?total:first+Math.max(0,count));
 const a=new THREE.Vector3(),b=new THREE.Vector3(),cc=new THREE.Vector3();
 for(let i=first;i+2<end;i+=3){
  const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
  a.fromBufferAttribute(pos,ia);b.fromBufferAttribute(pos,ib);cc.fromBufferAttribute(pos,ic);callback(a,b,cc);
 }
}
export function eachGeometryTriangle(geometry,callback){
 const pos=geometry?.getAttribute?.('position');if(!pos)return;
 eachGeometryTriangleRange(geometry,0,geometry.index?geometry.index.count:pos.count,callback);
}
export function groupTriangleCount(group){
 let count=0;group?.traverse?.(o=>{if(o.isMesh&&o.geometry){const pos=o.geometry.getAttribute('position');count+=o.geometry.index?Math.floor(o.geometry.index.count/3):Math.floor((pos?.count||0)/3)}});return count;
}
export function groupToBinaryStl(group,name='region',inverseScale=1){
 const triCount=groupTriangleCount(group);if(!triCount)return null;const buffer=new ArrayBuffer(84+triCount*50),view=new DataView(buffer),header=new TextEncoder().encode('Virtual Rodent Lab '+name);new Uint8Array(buffer,0,Math.min(80,header.length)).set(header.slice(0,80));view.setUint32(80,triCount,true);
 const ab=new THREE.Vector3(),ac=new THREE.Vector3(),n=new THREE.Vector3();let off=84;
 group.traverse(o=>{if(!o.isMesh||!o.geometry)return;eachGeometryTriangle(o.geometry,(aa,bb,cc)=>{const a=aa.clone().multiplyScalar(inverseScale),b=bb.clone().multiplyScalar(inverseScale),c=cc.clone().multiplyScalar(inverseScale);ab.subVectors(b,a);ac.subVectors(c,a);n.crossVectors(ab,ac).normalize();for(const v of [n,a,b,c]){view.setFloat32(off,v.x,true);view.setFloat32(off+4,v.y,true);view.setFloat32(off+8,v.z,true);off+=12}view.setUint16(off,0,true);off+=2})});
 return new Blob([buffer],{type:'model/stl'});
}
export function geometryToBinaryStl(geometry,name='segment'){
 const pos=geometry.getAttribute('position'),index=geometry.index;
 if(!pos||!index)throw new Error('Indexed geometry required for STL export');
 const triCount=Math.floor(index.count/3),buffer=new ArrayBuffer(84+triCount*50),view=new DataView(buffer);
 const header=new TextEncoder().encode('Virtual Rodent Lab '+name);new Uint8Array(buffer,0,Math.min(80,header.length)).set(header.slice(0,80));
 view.setUint32(80,triCount,true);
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),n=new THREE.Vector3();
 let off=84;
 for(let t=0;t<triCount;t++){
  const ia=index.getX(t*3),ib=index.getX(t*3+1),ic=index.getX(t*3+2);
  a.fromBufferAttribute(pos,ia);b.fromBufferAttribute(pos,ib);c.fromBufferAttribute(pos,ic);
  ab.subVectors(b,a);ac.subVectors(c,a);n.crossVectors(ab,ac).normalize();
  for(const v of [n,a,b,c]){view.setFloat32(off,v.x,true);view.setFloat32(off+4,v.y,true);view.setFloat32(off+8,v.z,true);off+=12}
  view.setUint16(off,0,true);off+=2;
 }
 return new Blob([buffer],{type:'model/stl'});
}
