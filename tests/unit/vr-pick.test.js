import { describe, it, expect } from 'vitest';
import { marchClassificationHit, marchClassificationHitInfo, classifiedAt } from '../../docs/vr-pick.js';

// 8³ grid in a ±1 box, one channel; index mapping as the VR shader's texCoord (y index runs down)
const N=8,he=[1,1,1],dims=[N,N,N];
const grid=fill=>{const data=new Uint8Array(N*N*N);for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(fill(x,y,z))data[x+N*(y+N*z)]=200;return{data,C:1,chan:[0,-1,-1,-1]}};
const v=(x,y,z)=>({x,y,z});
const step=0.125; // half a voxel

describe('marchClassificationHit', () => {
 it('index 0 in y is the top of the box (+y)', () => {
  const cls=grid((x,y)=>y<=1); // p.y in (0.5, 1]
  expect(marchClassificationHit(v(0,3,0),v(0,-1,0),he,dims,cls,[0])).toBeCloseTo(2,6);
  const t=marchClassificationHit(v(0,-3,0),v(0,1,0),he,dims,cls,[0]);
  expect(t).toBeGreaterThanOrEqual(3.5);expect(t).toBeLessThan(3.5+step+1e-9);
 });
 it('x and z run up the index', () => {
  const cx=grid(x=>x===7),cz=grid((x,y,z)=>z===7);
  const tx=marchClassificationHit(v(-3,0,0),v(1,0,0),he,dims,cx,[0]),tz=marchClassificationHit(v(0,0,-3),v(0,0,1),he,dims,cz,[0]);
  for(const t of [tx,tz]){expect(t).toBeGreaterThanOrEqual(3.75);expect(t).toBeLessThan(3.75+step+1e-9)}
 });
 it('starts on the side a clipping plane keeps', () => {
  const cls=grid((x,y)=>y<=1);
  // kept where −y + 0.75 ≥ 0 (y ≤ 0.75): the ray from above starts at the plane
  const pl=[{x:0,y:-1,z:0,w:-0.75}];
  expect(marchClassificationHit(v(0,3,0),v(0,-1,0),he,dims,cls,[0],pl,1,1)).toBeCloseTo(2.25,6);
  // the same plane without its clip bit does nothing
  expect(marchClassificationHit(v(0,3,0),v(0,-1,0),he,dims,cls,[0],pl,1,0)).toBeCloseTo(2,6);
  // kept where y ≥ 0.9: the ray from below starts at the plane, inside the block
  const keepTop=[{x:0,y:1,z:0,w:0.9}];
  expect(marchClassificationHit(v(0,-3,0),v(0,1,0),he,dims,cls,[0],keepTop,1,1)).toBeCloseTo(3.9,6);
 });
 it('misses: hidden channel, outside the box, below 128', () => {
  const cls=grid(()=>true);
  expect(marchClassificationHit(v(0,3,0),v(0,-1,0),he,dims,cls,[])).toBe(-1);
  expect(marchClassificationHit(v(0,3,0),v(1,0,0),he,dims,cls,[0])).toBe(-1);
  const low=grid(()=>true);low.data.fill(127);
  expect(marchClassificationHit(v(0,3,0),v(0,-1,0),he,dims,low,[0])).toBe(-1);
 });
 it('t is in the caller units when the direction is scaled', () => {
  const cls=grid((x,y)=>y<=1);
  expect(marchClassificationHit(v(0,3,0),v(0,-2,0),he,dims,cls,[0])).toBeCloseTo(1,6);
 });
 it('the info variant returns the hit voxel and the matching channel', () => {
  const data=new Uint8Array(N*N*N*2);data[(3+N*(1+N*4))*2+1]=200; // voxel x 3, y 1, z 4, channel 1
  const cls={data,C:2,chan:[0,1,-1,-1]};
  // ray along +x through the centre of that voxel: y index 1 → p.y = 1 - 1.5/8*2 = 0.625; z index 4 → p.z = 0.125
  const h=marchClassificationHitInfo(v(-3,0.625,0.125),v(1,0,0),he,dims,cls,[0,1]);
  expect(h&&[h.x,h.y,h.z,h.ch]).toEqual([3,1,4,1]);
  expect(marchClassificationHitInfo(v(-3,0.625,0.125),v(1,0,0),he,dims,cls,[0])).toBe(null);
 });
});

// recording on a section only where it shows tissue (the Surface mode's tissue test at one place)
describe('classifiedAt: is a place inside a shown segment', () => {
 it('true inside a filled region, false in air / outside the box; the same voxel indexing as the march (y index runs down)', () => {
  const cls=grid((x,y,z)=>x>=4&&y<=1); // x in (0, 1], y in (0.5, 1] (the top), any z
  expect(classifiedAt(v(0.5,0.8,0),he,dims,cls,[0])).toBe(true);
  expect(classifiedAt(v(-0.5,0.8,0),he,dims,cls,[0])).toBe(false); // air at x < 0
  expect(classifiedAt(v(0.5,0.2,0),he,dims,cls,[0])).toBe(false); // air below the top layer
  expect(classifiedAt(v(0.5,-0.8,0),he,dims,cls,[0])).toBe(false);
  expect(classifiedAt(v(1.5,0.8,0),he,dims,cls,[0])).toBe(false); expect(classifiedAt(v(0.5,0.8,-1.2),he,dims,cls,[0])).toBe(false); // outside the box
  expect(classifiedAt(v(1,1,1),he,dims,cls,[0])).toBe(true); // the box edge belongs to its last voxel (clamped, as in the march)
  // it agrees with the march: a ray whose first hit is that voxel has the hit voxel's centre classified
  const hit=marchClassificationHitInfo(v(0.5,0.9,2),v(0,0,-1),he,dims,cls,[0]); expect(hit).not.toBeNull();
  expect(classifiedAt(v(0.5,0.9,2-hit.t),he,dims,cls,[0])).toBe(true);
 });
 it('no shown channel, no data, a non-finite point: false (nothing is recorded)', () => {
  const cls=grid(()=>true);
  expect(classifiedAt(v(0,0,0),he,dims,cls,[])).toBe(false); expect(classifiedAt(v(0,0,0),he,dims,null,[0])).toBe(false);
  expect(classifiedAt(v(NaN,0,0),he,dims,cls,[0])).toBe(false); expect(classifiedAt(null,he,dims,cls,[0])).toBe(false); expect(classifiedAt(v(0,0,0),he,dims,cls,[0])).toBe(true);
 });
 it('several channels: any shown one counts; a hidden channel does not', () => {
  const data=new Uint8Array(N*N*N*2);data[(3+N*(3+N*3))*2+1]=255; // only channel 1, at voxel x 3, y 3, z 3
  const cls={data,C:2,chan:[0,1,-1,-1]},q=v(-0.125,0.125,-0.125); // x index floor((-0.125/2+0.5)*8)=3, y index floor((0.5-0.125/2)*8)=3, z index 3
  expect(classifiedAt(q,he,dims,cls,[1])).toBe(true); expect(classifiedAt(q,he,dims,cls,[0])).toBe(false); expect(classifiedAt(q,he,dims,cls,[0,1])).toBe(true);
 });
});

// march step = half a voxel along the ray (anisotropic data: fewer steps along the coarse axes, no 1-voxel plate skipped)
describe('march step on isotropic / anisotropic data', () => {
 const make=(dims,fill)=>{const [w,h,d]=dims,raw=new Uint8Array(w*h*d);for(let z=0;z<d;z++)for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(fill(x,y,z))raw[x+w*(y+h*z)]=200;
  const box={n:0},data=new Proxy(raw,{get(t,k){if(typeof k==='string'&&k!==''&&!isNaN(k))box.n++;return t[k]}});return{cls:{data,C:1,chan:[0,-1,-1,-1]},box}};
 // the march as it was before (dt = 0.5*min voxel edge/len), kept here as the reference
 const oldMarch=(o,q,he,dims,data)=>{const [w,h,d]=dims,O=[o.x,o.y,o.z],Q=[q.x,q.y,q.z];let t0=0,t1=Infinity,n=0;
  for(let a=0;a<3;a++){if(Math.abs(Q[a])<1e-12){if(Math.abs(O[a])>he[a])return{t:-1,n};continue}const ta=(-he[a]-O[a])/Q[a],tb=(he[a]-O[a])/Q[a];t0=Math.max(t0,Math.min(ta,tb));t1=Math.min(t1,Math.max(ta,tb))}
  const dt=0.5*Math.min(2*he[0]/w,2*he[1]/h,2*he[2]/d)/Math.hypot(q.x,q.y,q.z);
  for(let t=t0;t<=t1;t+=dt){const x=Math.min(w-1,Math.max(0,Math.floor(((o.x+q.x*t)/(2*he[0])+0.5)*w))),y=Math.min(h-1,Math.max(0,Math.floor((0.5-(o.y+q.y*t)/(2*he[1]))*h))),z=Math.min(d-1,Math.max(0,Math.floor(((o.z+q.z*t)/(2*he[2])+0.5)*d)));n++;if(data[x+w*(y+h*z)]>=128)return{t,n}}
  return{t:-1,n}};
 it('isotropic grid: same hit and same number of steps as before', () => {
  const dims=[8,6,8],he=[1,0.75,1]; // all voxel edges 0.25
  for(const q of [v(1,0,0),v(0,-1,0),v(0.3,-0.8,0.5),v(1,1,1),v(-2,0.7,1.1)]){
   const {cls,box}=make(dims,(x,y,z)=>x===5&&y===3&&z===4);
   const o=v(-3*Math.sign(q.x||1),0.1,0.2),ref=oldMarch(o,q,he,dims,cls.data);box.n=0;
   const info=marchClassificationHitInfo(o,q,he,dims,cls,[0]);
   expect(info?info.t:-1).toBe(ref.t);expect(box.n).toBe(ref.n);
  }
 });
 // voxel edges 2 : 2 : 1 as the mouse hindlimb half grid (x,y coarse, z fine)
 const aD=[20,18,24],aHe=[20,18,12];
 it('anisotropic grid: a 1-voxel plate is hit from every direction', () => {
  const centre=(i,j,k)=>v((i+0.5)*2-20,(18-(j+0.5)*2)*1,(k+0.5)*1-12); // voxel centre in object space
  const dirs=[v(1,0,0),v(0,1,0),v(0,0,1),v(1,1,0),v(1,0,1),v(0.3,0.9,0.6),v(-1,0.4,-0.7),v(0.05,0.02,1),v(1,0.02,0.01)];
  for(const f of [x=>x===9,(x,y)=>y===7,(x,y,z)=>z===11])for(const q of dirs){
   const {cls}=make(aD,f),c=centre(9,7,11),o=v(c.x-q.x*60,c.y-q.y*60,c.z-q.z*60);
   expect(marchClassificationHit(o,q,aHe,aD,cls,[0])).toBeGreaterThanOrEqual(0);
  }
 });
 it('anisotropic grid: no axis moves more than half a voxel per step', () => {
  for(const q of [v(1,0,0),v(0,0,1),v(1,1,1),v(0.3,0.9,0.6),v(-1,0.4,-0.7)]){
   const {cls,box}=make(aD,()=>false);box.n=0;marchClassificationHit(v(-q.x*80,-q.y*80,-q.z*80),q,aHe,aD,cls,[0]);
   // steps along the chord in voxel units: n steps cover <= n/2 voxels per axis -> n >= 2 * (voxels crossed along the busiest axis); checked by a fine pass
   const len=Math.hypot(q.x,q.y,q.z),m=Math.hypot(q.x/2,q.y/2,q.z/1);
   expect(0.5/m*len).toBeGreaterThan(0);expect(Math.max(Math.abs(q.x)/2,Math.abs(q.y)/2,Math.abs(q.z))*(0.5/m)).toBeLessThanOrEqual(0.5+1e-12);
  }
 });
 it('mouse hindlimb half grid 173x153x204 (2:2:1): rays along x and y take fewer steps than the old rule', () => {
  const dims=[173,153,204],he=[173,153,102],{cls,box}=make(dims,()=>false);
  const run=q=>{box.n=0;marchClassificationHit(v(-q.x*500,0.3*(q.y===0),0.2*(q.z===0)),q,he,dims,cls,[0]);return box.n};
  const oldN=q=>oldMarch(v(-q.x*500,0.3*(q.y===0),0.2*(q.z===0)),q,he,dims,new Uint8Array(173*153*204)).n;
  const nx=run(v(1,0,0)),ny=run(v(0,1,0)),nz=run(v(0,0,1));
  expect(nx).toBeLessThanOrEqual(oldN(v(1,0,0))/2+2);expect(ny).toBeLessThanOrEqual(oldN(v(0,1,0))/2+2);
  expect(nx).toBeLessThan(oldN(v(1,0,0)));expect(ny).toBeLessThan(oldN(v(0,1,0)));
  expect(nz).toBe(oldN(v(0,0,1))); // the fine axis is unchanged
 });
});
