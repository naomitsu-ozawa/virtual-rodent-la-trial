import { describe, it, expect } from 'vitest';
import { chamferDistanceBytes, buildDistanceBytes, combineClassificationDistance } from '../../docs/distance-field.js';

// build 369: the VR sphere tracing jumps by (byte - 3) voxels, so the byte
// must never exceed the true distance to the other class, and should not be
// much smaller either (the jumps would be short)
function sphereVolume(N,r){
 const inside=new Uint8Array(N*N*N),c=(N-1)/2;
 for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++)inside[(z*N+y)*N+x]=Math.hypot(x-c,y-c,z-c)<=r?1:0;
 return inside;
}
function trueDistance(inside,N){
 // brute force: nearest voxel of the other class
 const out=new Float32Array(N*N*N),pts=[[],[]];
 for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++)pts[inside[(z*N+y)*N+x]].push([x,y,z]);
 for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=(z*N+y)*N+x,other=pts[1-inside[i]];let best=1e9;
  for(const p of other){const d=Math.hypot(p[0]-x,p[1]-y,p[2]-z);if(d<best)best=d}out[i]=best}
 return out;
}
describe('distance field (chamfer 3-4-5 lower bound)',()=>{
 it('never exceeds the true distance to the other class and is not far below it',()=>{
  const N=24,inside=sphereVolume(N,7),bytes=chamferDistanceBytes(inside,[N,N,N]),truth=trueDistance(inside,N);
  let worstRatio=1;
  for(let i=0;i<bytes.length;i++){
   expect(bytes[i]).toBeLessThanOrEqual(truth[i]+1e-9);
   if(truth[i]>=8)worstRatio=Math.min(worstRatio,bytes[i]/truth[i]);
  }
  expect(worstRatio).toBeGreaterThan(0.55); // seeds sit one voxel inside the other class, then 0.9 and the floor
 });
 it('is zero on both sides of the boundary and grows away from it',()=>{
  const N=16,inside=sphereVolume(N,5),bytes=chamferDistanceBytes(inside,[N,N,N]),c=(N-1)/2,at=(x,y,z)=>bytes[(z*N+y)*N+x];
  expect(at(Math.round(c),Math.round(c),Math.round(c))).toBeGreaterThanOrEqual(2); // sphere centre (radius 5): seeds one voxel in, 0.9, floor
  expect(at(0,0,0)).toBeGreaterThan(3); // corner: outside, far
  // a voxel on the surface has a neighbour of the other class → 0
  let zeros=0;for(let i=0;i<bytes.length;i++)if(bytes[i]===0)zeros++;
  expect(zeros).toBeGreaterThan(200);
 });
 it('packs one byte per classification channel',async()=>{
  const N=8,n=N*N*N,C=2,data=new Uint8Array(n*C);
  for(let i=0;i<n;i++){data[i*C]=i<n/2?200:10;data[i*C+1]=10}
  const r=await buildDistanceBytes({data,C,chan:[0,1,-1,-1]},[N,N,N]);
  expect(r.C).toBe(2);expect(r.data.length).toBe(n*C);
  // channel 1 is all outside → no boundary → capped at 255 everywhere
  expect(r.data[1]).toBe(255);
  // channel 0: half/half → small distances
  expect(r.data[0]).toBeLessThan(8);
 });

 it('combines classification channels with the smallest enabled distance in alpha (build 384)',()=>{
  const cls={data:new Uint8Array([200,10, 10,200, 128,128]),C:2,chan:[0,1,-1,-1]};
  const dist={data:new Uint8Array([5,9, 2,7, 255,255]),C:2,chan:[0,1,-1,-1]};
  const both=combineClassificationDistance(cls,dist,0b11);
  expect([...both]).toEqual([200,10,0,5, 10,200,0,2, 128,128,0,255]);
  const boneOnly=combineClassificationDistance(cls,dist,0b01);
  expect([boneOnly[3],boneOnly[7],boneOnly[11]]).toEqual([5,2,255]);
  const none=combineClassificationDistance(cls,dist,0);
  expect([none[3],none[7]]).toEqual([255,255]);
  // reuse of the output buffer
  const again=combineClassificationDistance(cls,dist,0b10,both);expect(again).toBe(both);expect(both[3]).toBe(9);
  // four stored channels: no free alpha
  expect(combineClassificationDistance({data:new Uint8Array(4),C:4,chan:[0,1,2,3]},{data:new Uint8Array(4),C:4,chan:[0,1,2,3]},15)).toBeNull();
 });
});

// build 528: four stored segments share the combined texture (channels 0..2 + the distance alpha over every shown
// segment, the fourth included); the fourth segment's bytes go to their own texture
import { fourthChannelBytes } from '../../docs/distance-field.js';
describe('combineClassificationDistance with four stored channels (build 528)', () => {
 const cls={C:4,chan:[0,1,2,3],data:Uint8Array.from([200,10,20,30, 5,6,7,8])},dist={C:4,chan:[0,1,2,3],data:Uint8Array.from([9,4,7,2, 1,3,5,6])};
 it('is null without the option (as before)',()=>{expect(combineClassificationDistance(cls,dist,0b1111)).toBeNull()});
 it('keeps channels 0..2 and takes the alpha over the shown segments, the fourth included',()=>{
  const r=combineClassificationDistance(cls,dist,0b1111,null,{four:true});
  expect(Array.from(r)).toEqual([200,10,20,2, 5,6,7,1]);
  const noFourth=combineClassificationDistance(cls,dist,0b0111,null,{four:true});expect(Array.from(noFourth)).toEqual([200,10,20,4, 5,6,7,1]);
  const onlyFourth=combineClassificationDistance(cls,dist,0b1000,null,{four:true});expect(Array.from(onlyFourth)).toEqual([200,10,20,2, 5,6,7,6]);
 });
 it('fourthChannelBytes returns channel 3, null when unused',()=>{
  expect(Array.from(fourthChannelBytes(cls))).toEqual([30,8]);
  expect(fourthChannelBytes({C:4,chan:[0,1,2,-1],data:cls.data})).toBeNull();
  expect(fourthChannelBytes({C:2,chan:[0,1,-1,-1],data:new Uint8Array(4)})).toBeNull();
 });
});
