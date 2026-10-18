// VR laser hit on the volume (build 402). The ray, in the volume's object
// space (box ±halfExt, the shader's texCoord: x and z up the index, y down),
// is marched in half-voxel steps over the classification bytes (nearest
// voxel) to the first voxel where one of the given channels is >= 128 (the
// shader's 0.5), on the side every clipping plane keeps (n·p − w >= 0).
// o: origin, q: direction per unit of t (t is then the caller's distance).
// planes: [{x,y,z,w}], only those with their bit set in planeCut clip.
// Returns t of the hit or -1.
export function marchClassificationHit(o,q,halfExt,dims,cls,chs,planes=[],planeCount=0,planeCut=0){
 const h=marchClassificationHitInfo(o,q,halfExt,dims,cls,chs,planes,planeCount,planeCut);return h?h.t:-1;
}
// build 423: the same march, returning the hit voxel and the channel that matched (null when nothing is hit)
// tMin / tMax (optional, default 0 / Infinity): only the part of the ray between them is marched (VR points: from just outside a point's own
// voxel to the head, see vr-point.js pointIsHidden)
export function marchClassificationHitInfo(o,q,halfExt,dims,cls,chs,planes=[],planeCount=0,planeCut=0,tMin=0,tMax=Infinity){
 if(!chs.length)return null;
 const he=halfExt,[w,h,d]=dims,O=[o.x,o.y,o.z],Q=[q.x,q.y,q.z];let t0=tMin,t1=tMax;
 for(let a=0;a<3;a++){
  if(Math.abs(Q[a])<1e-12){if(Math.abs(O[a])>he[a])return null;continue}
  const ta=(-he[a]-O[a])/Q[a],tb=(he[a]-O[a])/Q[a];t0=Math.max(t0,Math.min(ta,tb));t1=Math.min(t1,Math.max(ta,tb));
 }
 for(let i=0;i<planeCount;i++){
  if(!(planeCut>>i&1))continue;
  const pl=planes[i],side=pl.x*o.x+pl.y*o.y+pl.z*o.z-pl.w,slope=pl.x*q.x+pl.y*q.y+pl.z*q.z;
  if(Math.abs(slope)>1e-12){const x=-side/slope;if(slope>0)t0=Math.max(t0,x);else t1=Math.min(t1,x)}
  else if(side<0)return null;
 }
 if(!(t0<=t1))return null;
 const data=cls.data,C=cls.C,len=Math.hypot(q.x,q.y,q.z);
 if(len<1e-12)return null;
 const dt=0.5*Math.min(2*he[0]/w,2*he[1]/h,2*he[2]/d)/len;
 for(let t=t0;t<=t1;t+=dt){
  const x=Math.min(w-1,Math.max(0,Math.floor(((o.x+q.x*t)/(2*he[0])+0.5)*w)));
  const y=Math.min(h-1,Math.max(0,Math.floor((0.5-(o.y+q.y*t)/(2*he[1]))*h)));
  const z=Math.min(d-1,Math.max(0,Math.floor(((o.z+q.z*t)/(2*he[2])+0.5)*d)));
  const k=(x+w*(y+h*z))*C;
  for(const ch of chs)if(data[k+ch]>=128)return{t,x,y,z,ch};
 }
 return null;
}
