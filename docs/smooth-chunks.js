// Chunked surface smoothing. A segment surface too large to hold at once is built in chunks of slices; each
// chunk is smoothed together with SMOOTH_CHUNK_HALO slices of its neighbours on both sides and keeps only the triangles of
// its own slices. The vertices on the plane between two chunks then come out of both smoothings almost alike (1e-4 voxel)
// but not bit for bit, and a crack of that size is an open edge in an STL: the seam copy gives the vertices of a chunk's
// first plane the positions the previous chunk gave them, so the assembled surface is watertight.
// Free of DOM-bound imports so the unit tests can use it directly.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { constrainedSmoothPositions, constrainedSmoothSchedule } from './constrained-smooth.js?v=20261020-build628';
import { snapToLattice, prepareSmoothChunk, vertexNormals } from './smooth-prepare.js?v=20261020-build628';
import { smoothChunkInPool, smoothInFlightLimit, smoothInFlightFloats } from './smooth-workers.js?v=20261020-build628';
export { snapToLattice };

// slices of the neighbouring chunks smoothed with a chunk: the constrained smoothing reaches farther the stronger it is.
// Largest difference between the chunked and the one-piece result (a ball with a 1-voxel rod, a 5 degree slab; chunks of
// 24 slices): strength 0.6-1, halo 8: 0.002 voxel; 2-3, halo 12: 0.01; 4-6, halo 16: 0.03 (halo 8 at strength 3: 0.08,
// at 4-6: 0.25). Every halo slice is smoothed twice, so the halo is no longer than the strength needs.
export const SMOOTH_CHUNK_HALO=16;
export function smoothChunkHalo(strength){const s=Number(strength)||0;return s<=1?8:s<=3?12:SMOOTH_CHUNK_HALO}

// half a voxel along each axis, in the units of coords
export function latticeHalfBox(coords){
 const h=t=>t.length>1?Math.abs(t[1]-t[0])/2:Infinity,b=[h(coords.xs),h(coords.ys),h(coords.zs)],m=Math.min(...b);
 return b.map(v=>Number.isFinite(v)?v:m);
}
// the seam copy between consecutive chunks (built in z order): record() keeps the smoothed positions of a chunk's last
// plane, link() puts them on the same lattice points of the next chunk's first plane
export function createSeamLinker(){
 let plane=NaN,map=null;
 return{
  record(z,pos,orig){
   plane=z;map=new Map();
   for(let i=0;i<orig.length;i+=3)if(orig[i+2]===z)map.set(orig[i]+','+orig[i+1],[pos[i],pos[i+1],pos[i+2]]);
  },
  link(z,pos,orig){
   if(z!==plane||!map)return 0;let linked=0;
   for(let i=0;i<orig.length;i+=3){if(orig[i+2]!==z)continue;const p=map.get(orig[i]+','+orig[i+1]);if(p){pos[i]=p[0];pos[i+1]=p[1];pos[i+2]=p[2];linked++}}
   return linked;
  },
 };
}
// one chunk: positions = voxel-face triangles [halo before | core | halo after] (floats coreFrom..coreTo are the core);
// welded, smoothed, seams linked, and cut down to the core triangles. zLow / zHigh: slice indices of the chunk's first
// plane and of the plane after its last slice (null: no neighbour chunk there). In two parts, so that all but the last
// can run in a worker (OrderedChunkSmoother): the preparation (smooth-prepare.js: snap, weld, pinned flags, lattice
// positions), the kernel and the vertex normals (over the whole chunk with its halo, so a vertex on the core's edge gets
// the triangles on both sides of it), then finishChunk (seams, core triangles) here.
// r: {pos, index, orig, normals} of the whole chunk; floats: floats of its faces
function finishChunk(r,floats,{coreFrom=0,coreTo=floats,coords=null,seams=null,zLow=null,zHigh=null}){
 const {pos,index,orig}=r,normals=r.normals||vertexNormals(pos,index);
 if(seams&&coords){
  if(zLow!=null)seams.link(Math.fround(coords.zs[zLow]),pos,orig);
  if(zHigh!=null)seams.record(Math.fround(coords.zs[zHigh]),pos,orig);
 }
 // the core triangles, and only the vertices they use (the halo's own vertices would be memory and upload for nothing)
 let core=index,used=pos,usedNormals=normals;
 if(coreFrom>0||coreTo<floats){
  core=index.slice(coreFrom/3,coreTo/3);
  const n=pos.length/3,map=new Int32Array(n).fill(-1);let m=0;
  for(let i=0;i<core.length;i++)map[core[i]]=0;
  for(let i=0;i<n;i++)if(map[i]===0)map[i]=m++;
  if(m<n){
   used=new Float32Array(m*3);usedNormals=new Float32Array(m*3);
   for(let i=0;i<n;i++){const j=map[i];if(j>=0){const a=j*3,b=i*3;used[a]=pos[b];used[a+1]=pos[b+1];used[a+2]=pos[b+2];usedNormals[a]=normals[b];usedNormals[a+1]=normals[b+1];usedNormals[a+2]=normals[b+2]}}
   for(let i=0;i<core.length;i++)core[i]=map[core[i]];
  }
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(used,3));
 geometry.setAttribute('normal',new THREE.BufferAttribute(usedNormals,3));
 geometry.setIndex(new THREE.BufferAttribute(core,1));
 geometry.computeBoundingSphere();
 return geometry;
}
function kernelOptions(strength,coords){return{...constrainedSmoothSchedule(strength),box:coords?latticeHalfBox(coords):null}}
// the same on the main thread, in one go (as a worker does it)
export function smoothedChunkGeometry(positions,{strength,coreFrom=0,coreTo=positions?.length||0,coords=null,pinnedKeys=null,seams=null,zLow=null,zHigh=null}={}){
 if(!positions?.length)return null;
 const floats=positions.length,r=prepareSmoothChunk(positions,coords,pinnedKeys);if(!r)return null;
 constrainedSmoothPositions(r.pos,r.index,{...kernelOptions(strength,coords),pinned:r.pinned,orig:r.orig});
 r.normals=vertexNormals(r.pos,r.index);
 return finishChunk(r,floats,{coreFrom,coreTo,coords,seams,zLow,zHigh});
}
// Chunks in flight over every smoother (all segments of a surface, and builds that overlap): the chunk and memory limits
// are for the whole page, not per segment (a 6-segment surface would otherwise hold 6x the memory the limits allow).
const inflight=new Set();let inflightFloats=0;
export function smoothingInFlight(){return{chunks:inflight.size,floats:inflightFloats}}
// waits while more than `max` chunks (smoothInFlightLimit()), or more than one chunk and more than smoothInFlightFloats()
// floats of faces, are in flight
export async function throttleSmoothing(max){
 max??=smoothInFlightLimit();const budget=smoothInFlightFloats();
 while(inflight.size>max||(inflight.size>1&&inflightFloats>budget))await Promise.race([...inflight].map(e=>e.settled));
}
// The chunks of one surface, smoothed side by side in the worker pool (smooth-workers.js) and finished one after the other
// in the order they were submitted (the seam copy needs the previous chunk's last plane): submit() returns at once,
// onGeometry(geometry, tag) follows in order; throttle() waits while too many chunks are in flight over all surfaces
// (throttleSmoothing: memory),
// drain() until all are done (and throws the first error). After cancel(), or once isCurrent() is false (the build was
// superseded), no more geometries are handed out, and the chunks not yet started are skipped (worker queue, GPU queue), so
// drain() settles soon.
export class OrderedChunkSmoother{
 constructor({strength,coords=null,seams=null,onGeometry,isCurrent=null}){
  this.strength=strength;this.coords=coords;this.seams=seams;this.onGeometry=onGeometry;this.chain=Promise.resolve();this.pending=[];this.floats=0;this.cancelled=false;
  const self=this;this.token={get cancelled(){return self.cancelled||(isCurrent?!isCurrent():false)}};
 }
 submit(positions,opts={}){
  if(!positions?.length||this.token.cancelled)return false;
  // positions: the caller's own copy (it goes to a worker); the pinned keys as they are now (the caller reuses its set)
  const job={floats:positions.length},c=this.coords,lattice=c?{xs:c.xs,ys:c.ys,zs:c.zs}:null;
  const smoothed=smoothChunkInPool(positions,{...kernelOptions(this.strength,c),lattice,pinnedKeys:opts.pinnedKeys?.size?[...opts.pinnedKeys]:null,token:this.token});
  const done=Promise.all([smoothed,this.chain]).then(([r])=>{if(r&&!this.token.cancelled)this.onGeometry(finishChunk(r,job.floats,{...opts,coords:c,seams:this.seams}),opts.tag)});
  this.chain=done;this.pending.push(done);this.floats+=job.floats;
  const entry={floats:job.floats,settled:null};inflight.add(entry);inflightFloats+=job.floats;
  const settle=()=>{const i=this.pending.indexOf(done);if(i>=0){this.pending.splice(i,1);this.floats-=job.floats}if(inflight.delete(entry))inflightFloats-=entry.floats};
  entry.settled=done.then(settle,settle);return true;
 }
 // the limits hold over all surfaces (throttleSmoothing)
 throttle(max){return throttleSmoothing(max)}
 drain(){return this.chain}
 cancel(){this.cancelled=true}
}
// The streamed form, for the base surface (render3DSourceBacked / render3DMemoryGpu): the faces arrive block by block (GPU
// blocks of a few slices, or slice by slice), each segment's into one growing buffer (builders: the Float32FaceBuilder of
// each key) with a mark at every block end. cut() ends a chunk at the current stream position; the chunk is smoothed once
// the stream is `halo` slices past its end (or at the last slice), with the halo slices on both sides, keeps its core
// triangles, and is handed to onGeometry(key, geometry, last slice of the chunk) (in order, after its smoothing in the
// worker pool: finish() waits for all, throttle() while too many are in flight). Slices no pending chunk needs are dropped.
export class SmoothedSurfaceStream{
 constructor({keys,coords,strength,slices,halo=smoothChunkHalo(strength),onGeometry,Builder,isCurrent=null}){
  this.coords=coords;this.strength=strength;this.slices=slices;this.halo=halo;
  this.builders=new Map(keys.map(k=>[k,new Builder()]));
  this.state=new Map(keys.map(k=>[k,{base:0,marks:[{z:0,at:0}],smoother:new OrderedChunkSmoother({strength,coords,seams:createSeamLinker(),isCurrent,onGeometry:(geometry,z)=>onGeometry(k,geometry,z)})}]));
  this.z=0;this.start=0;this.pending=[];
 }
 // floats of the chunk being filled (the largest over the keys)
 coreFloats(){let m=0;for(const [k,b] of this.builders){const s=this.state.get(k),at=this.markAt(s,this.start,'floor');m=Math.max(m,s.base+b.length-at)}return m}
 // every slice below z is in the builders; returns the number of chunks that went to be smoothed (the caller lets a frame
 // through after them)
 endBlock(z){this.z=z;for(const [k,b] of this.builders){const s=this.state.get(k);s.marks.push({z,at:s.base+b.length})}return this.flushReady()}
 cut(){if(this.z>this.start){this.pending.push({z0:this.start,z1:this.z});this.start=this.z}}
 // waits while too many chunks are being smoothed (counted over all segments and builds: throttleSmoothing)
 throttle(){return throttleSmoothing()}
 async finish(){this.cut();this.flushReady(true);for(const s of this.state.values())await s.smoother.drain()}
 cancel(){for(const s of this.state.values())s.smoother.cancel()}
 // offset of the mark at z: 'floor' = the last mark at or below z (at least the oldest kept), 'ceil' = the first at or above
 markAt(s,z,mode){
  const m=s.marks;
  if(mode==='floor'){let at=m[0].at;for(const k of m){if(k.z<=z)at=k.at;else break}return at}
  for(const k of m)if(k.z>=z)return k.at;return null;
 }
 flushReady(all=false){
  let sent=0;
  while(this.pending.length){
   const c=this.pending[0];if(!all&&this.z<Math.min(this.slices,c.z1+this.halo))break;
   this.pending.shift();
   for(const [k,b] of this.builders)if(this.flushChunk(b,this.state.get(k),c))sent++;
  }
  // keep from `halo` slices below the next chunk on
  const keepZ=(this.pending.length?this.pending[0].z0:this.start)-this.halo;
  for(const [k,b] of this.builders){
   const s=this.state.get(k);let keep=0;for(let i=0;i<s.marks.length;i++){if(s.marks[i].z<=keepZ)keep=i;else break}
   const cutAt=s.marks[keep].at-s.base;if(cutAt<=0)continue;
   b.data.copyWithin(0,cutAt,b.length);b.length-=cutAt;s.base+=cutAt;s.marks=s.marks.slice(keep);
  }
  return sent;
 }
 flushChunk(b,s,c){
  const from=this.markAt(s,c.z0-this.halo,'floor'),coreFrom=this.markAt(s,c.z0,'floor'),coreTo=this.markAt(s,c.z1,'ceil'),end=s.base+b.length,to=Math.min(end,this.markAt(s,c.z1+this.halo,'ceil')??end);
  if(coreTo==null||coreTo<=coreFrom)return false;
  return s.smoother.submit(b.data.slice(from-s.base,to-s.base),{coreFrom:coreFrom-from,coreTo:coreTo-from,zLow:c.z0>0?c.z0:null,zHigh:c.z1<this.slices?c.z1:null,tag:c.z1-1});
 }
}
