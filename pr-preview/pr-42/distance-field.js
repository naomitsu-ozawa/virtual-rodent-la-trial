// Distance field for VR sphere tracing. For each segment channel
// of the classification bytes (>= 128 inside), a byte per voxel: a lower
// bound, in voxels, of the distance to the nearest voxel of the other class
// (inside -> nearest outside, outside -> nearest inside), capped at 255.
// the EXACT Euclidean distance (in voxel units of the grid) to the seed voxels, floored. Before: a
// chamfer 3-4-5 distance scaled by 0.3 (never above the Euclidean one but up to ~10 % and on average ~8 % below it, so every jump was that much shorter).
// Seeds: every voxel with a 26-neighbour of the other class (both sides). Every corner of a cell crossed by the trilinear 0.5 iso-surface is such a voxel,
// so any surface point is within 0.87 voxel of a seed. The byte is floor(Euclidean distance to the nearest seed voxel centre), so it never exceeds the true
// distance to a seed (the property the jump needs: the VR shader samples the field at the nearest voxel, offset up to 0.87, and jumps d - 1.8 voxels when
// d >= 2.7: no surface inside the jump). Pure module (no DOM), unit-tested.
// 3 x 3 x 3 maximum (op 1: dilate) or minimum (op 0: erode) of a 0 / 1 byte volume, as three separable 3-tap passes (the grid edge replicated); dst may not be src.
// Self-contained (no outer names): it is also part of the workers' sources.
export function morph3(src,dst,dims,op){
 const [w,h,d]=dims,wh=w*h;
 // x axis
 for(let z=0;z<d;z++)for(let y=0;y<h;y++){const r=z*wh+y*w;for(let x=0;x<w;x++){let v=src[r+x];const l=x>0?src[r+x-1]:v,rr=x<w-1?src[r+x+1]:v;dst[r+x]=op?(v|l|rr):(v&l&rr)}}
 // y axis (in place on dst via a row buffer)
 const rowBuf=new Uint8Array(w);
 for(let z=0;z<d;z++){const layer=z*wh;let prev=null;for(let y=0;y<h;y++){const r=layer+y*w;rowBuf.set(dst.subarray(r,r+w));const nxt=y<h-1?r+w:r;
  for(let x=0;x<w;x++){const v=rowBuf[x],up=y>0?prev[x]:v,dn=dst[nxt+x];dst[r+x]=op?(v|up|dn):(v&up&dn)}
  prev=prev||new Uint8Array(w);prev.set(rowBuf)}}
 // z axis
 const layBuf=new Uint8Array(wh);let prevL=null;
 for(let z=0;z<d;z++){const r=z*wh;layBuf.set(dst.subarray(r,r+wh));const nxt=z<d-1?r+wh:r;
  for(let i=0;i<wh;i++){const v=layBuf[i],up=z>0?prevL[i]:v,dn=dst[nxt+i];dst[r+i]=op?(v|up|dn):(v&up&dn)}
  prevL=prevL||new Uint8Array(wh);prevL.set(layBuf)}
}
// inside: Uint8Array (non-zero = inside), dims [w,h,d]; returns Uint8Array
// scratch: optional {D:Int32Array(n), a, b, dil: Uint8Array(n)} reused across channels
// Self-contained (no outer names): it is also part of the workers' sources.
export function euclideanDistanceBytes(inside,dims,scratch=null){
 const [w,h,d]=dims,n=w*h*d,wh=w*h,D=scratch?.D||new Int32Array(n);
 // seeds: voxels with a 26-neighbour of the other class = dilate(inside) and
 // not erode(inside), with separable 3-tap max / min passes (the
 // direct 27-neighbour test took most of the build time at 256^3)
 const a=scratch?.a||new Uint8Array(n),b=scratch?.b||new Uint8Array(n);
 for(let i=0;i<n;i++)a[i]=inside[i]?1:0;
 morph3(a,b,dims,1); // b = dilate(inside)
 const dil=scratch?.dil||new Uint8Array(n);dil.set(b);morph3(a,b,dims,0); // b = erode(inside)
 // squared distances, capped at CAP2 (> 255^2: such a voxel is 255 anyway; capping before a pass changes only values that would be capped after it)
 const CAP2=65536;
 for(let i=0;i<n;i++)D[i]=(dil[i]&&!b[i])?0:CAP2;
 // pass 1 (x): the squared distance to the nearest seed of the row, a forward and a backward sweep
 for(let z=0;z<d;z++)for(let y=0;y<h;y++){const r=z*wh+y*w;let last=-1;
  for(let x=0;x<w;x++){if(D[r+x]===0)last=x;else if(last>=0){const q=x-last,s=q*q;if(s<D[r+x])D[r+x]=s}}
  last=-1;
  for(let x=w-1;x>=0;x--){if(D[r+x]===0)last=x;else if(last>=0){const q=last-x,s=q*q;if(s<D[r+x])D[r+x]=s}}}
 // passes 2 and 3 (y, z): per line the lower envelope of the parabolas (Felzenszwalb & Huttenlocher), all in integers apart from the intersection
 const m=Math.max(h,d),f=new Int32Array(m),v=new Int32Array(m),zs=new Float64Array(m+1);
 const line=(len,base,stride)=>{
  let any=false;
  for(let q=0;q<len;q++){const x=D[base+q*stride];f[q]=x;if(x<CAP2)any=true}
  if(!any)return; // no seed in the line: stays capped
  let k=0;v[0]=0;zs[0]=-1e30;zs[1]=1e30;
  for(let q=1;q<len;q++){
   const fq=f[q]+q*q;let s;
   for(;;){const p=v[k];s=(fq-(f[p]+p*p))/(2*(q-p));if(s<=zs[k])k--;else break}
   k++;v[k]=q;zs[k]=s;zs[k+1]=1e30;
  }
  k=0;
  for(let q=0;q<len;q++){while(zs[k+1]<q)k++;const p=v[k],e=q-p,g=e*e+f[p];D[base+q*stride]=g<CAP2?g:CAP2}
 };
 for(let z=0;z<d;z++)for(let x=0;x<w;x++)line(h,z*wh+x,w);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)line(d,y*w+x,wh);
 const out=new Uint8Array(n);
 for(let i=0;i<n;i++){const t=Math.floor(Math.sqrt(D[i]));out[i]=t>255?255:t}
 return out;
}
// cls: {data, C, chan} as built by the VR view (bytes per channel, >= 128
// inside); resolves to the same layout with distance bytes. One set of
// scratch buffers for all channels, a yield and onProgress(done, total)
// between channels (a 256³ channel takes about 1.7 s)
export async function buildDistanceBytes(cls,dims,onProgress=null){
 const n=dims[0]*dims[1]*dims[2],C=cls.C,out=new Uint8Array(n*C),inside=new Uint8Array(n);
 const scratch={D:new Int32Array(n),a:new Uint8Array(n),b:new Uint8Array(n),dil:new Uint8Array(n)};
 for(let c=0;c<C;c++){
  onProgress?.(c,C);await new Promise(r=>setTimeout(r,0));
  for(let i=0;i<n;i++)inside[i]=cls.data[i*C+c]>=128?1:0;
  const dist=euclideanDistanceBytes(inside,dims,scratch);
  for(let i=0;i<n;i++)out[i*C+c]=dist[i];
 }
 onProgress?.(C,C);
 return{data:out,C,chan:cls.chan};
}
// the classification bytes and the per-segment distance bytes
// share one RGBA texture: channels as in cls (chan), alpha = the smallest
// distance over the enabled segments (bit s of mask), 255 when none. One
// fetch per ray step then serves the jump test and the classification.
// Needs a free channel: at most three segments stored (chan < 3).
// with {four:true} four stored channels are accepted as well: channels 0..2 go to the texture as before, the
// alpha is the smallest distance over every shown segment (channel 3 included), and channel 3's classification bytes are
// served by fourthChannelBytes for a second (R8) texture. Without the option the result is as before (null for four).
export function combineClassificationDistance(cls,dist,mask,out=null,{four=false}={}){
 const C=cls.C,n=cls.data.length/C,chan=cls.chan;
 if(chan.some(c=>c>=3)&&!four)return null;
 const res=out&&out.length===n*4?out:new Uint8Array(n*4);
 const used=[];for(let s=0;s<4;s++)if(chan[s]>=0&&chan[s]<3)used.push(chan[s]);
 const on=[];for(let s=0;s<4;s++)if(chan[s]>=0&&((mask>>s)&1))on.push(chan[s]);
 for(let i=0;i<n;i++){
  const b=i*C,o=i*4;
  for(const c of used)res[o+c]=cls.data[b+c];
  let m=255;for(const c of on){const v=dist.data[b+c];if(v<m)m=v}
  res[o+3]=m;
 }
 return res;
}
// only the alpha of combineClassificationDistance, one byte per voxel, for the voxels [i0, i1) into alpha[i0..i1): the smallest
// distance over the shown segments (bit s of mask, any stored channel), 255 when none, the same rule as above. The classification channels of
// the combined bytes do not depend on the mask, so a rebuild for a new mask only rewrites the alpha (vr-combo-rebuild.js; byte-identical to the
// one-shot result, unit-tested). Self-contained (no outer names): it also runs as the source of the rebuild worker.
export function combinedAlphaRange(dist,chan,mask,alpha,i0,i1){
 const C=dist.C,d=dist.data;let c0=-1,c1=-1,c2=-1,c3=-1,k=0;
 for(let s=0;s<4;s++)if(chan[s]>=0&&((mask>>s)&1)){const c=chan[s];if(k===0)c0=c;else if(k===1)c1=c;else if(k===2)c2=c;else c3=c;k++}
 for(let i=i0;i<i1;i++){
  const b=i*C;let m=255,v=0;
  if(c0>=0){v=d[b+c0];if(v<m)m=v}
  if(c1>=0){v=d[b+c1];if(v<m)m=v}
  if(c2>=0){v=d[b+c2];if(v<m)m=v}
  if(c3>=0){v=d[b+c3];if(v<m)m=v}
  alpha[i]=m;
 }
}
// the classification bytes of channel 3 (the fourth stored segment), one byte per voxel, for the VR shader's
// second texture (VRL_CLS4); null when no segment uses channel 3
export function fourthChannelBytes(cls){
 const C=cls.C,chan=cls.chan;if(!chan.includes(3)||C<4)return null;
 const n=cls.data.length/C,out=new Uint8Array(n);
 for(let i=0;i<n;i++)out[i]=cls.data[i*C+3];
 return out;
}
