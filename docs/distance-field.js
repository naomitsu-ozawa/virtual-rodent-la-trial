// Distance field for VR sphere tracing (build 369). For each segment channel
// of the classification bytes (>= 128 inside), a byte per voxel: a lower
// bound, in voxels, of the distance to the nearest voxel of the other class
// (inside → nearest outside, outside → nearest inside), capped at 255.
// Chamfer 3-4-5 distance to the seed voxels: every voxel with a 26-neighbour
// of the other class (both sides). Every corner of a cell crossed by the
// trilinear 0.5 iso-surface is such a voxel, so any surface point is within
// 0.87 voxel of a seed. The chamfer metric is at most 1.106 × the Euclidean
// one, so 0.9 × chamfer/3, floored, never exceeds the true distance to a
// seed. The VR shader samples the field at the nearest voxel (offset up to
// 0.87) and jumps d − 2 voxels when d >= 3: no surface inside the jump.
// Pure module (no DOM), unit-tested.
const INF=0x3fffffff;
// inside: Uint8Array (non-zero = inside), dims [w,h,d]; returns Uint8Array
// scratch: optional {D:Int32Array(n), a, b, dil: Uint8Array(n)} reused across channels (build 371)
export function chamferDistanceBytes(inside,dims,scratch=null){
 const [w,h,d]=dims,n=w*h*d,wh=w*h,D=scratch?.D||new Int32Array(n);
 // seeds: voxels with a 26-neighbour of the other class = dilate(inside) and
 // not erode(inside), with separable 3-tap max / min passes (build 370: the
 // direct 27-neighbour test took most of the build time at 256³)
 const a=scratch?.a||new Uint8Array(n),b=scratch?.b||new Uint8Array(n);
 const axisPass=(src,dst,op)=>{
  // x axis
  for(let z=0;z<d;z++)for(let y=0;y<h;y++){const r=z*wh+y*w;for(let x=0;x<w;x++){let v=src[r+x];const l=x>0?src[r+x-1]:v,rr=x<w-1?src[r+x+1]:v;dst[r+x]=op?(v|l|rr):(v&l&rr)}}
  // y axis (in place on dst via a row buffer)
  const rowBuf=new Uint8Array(w);
  for(let z=0;z<d;z++){const layer=z*wh;let prev=null;for(let y=0;y<h;y++){const r=layer+y*w;rowBuf.set(dst.subarray(r,r+w));const nxt=y<h-1?r+w:r,prv=y>0?r-w:r;
   for(let x=0;x<w;x++){const v=rowBuf[x],up=y>0?prev[x]:v,dn=dst[nxt+x];dst[r+x]=op?(v|up|dn):(v&up&dn)}
   prev=prev||new Uint8Array(w);prev.set(rowBuf)}}
  // z axis
  const layBuf=new Uint8Array(wh);let prevL=null;
  for(let z=0;z<d;z++){const r=z*wh;layBuf.set(dst.subarray(r,r+wh));const nxt=z<d-1?r+wh:r;
   for(let i=0;i<wh;i++){const v=layBuf[i],up=z>0?prevL[i]:v,dn=dst[nxt+i];dst[r+i]=op?(v|up|dn):(v&up&dn)}
   prevL=prevL||new Uint8Array(wh);prevL.set(layBuf)}
 };
 for(let i=0;i<n;i++)a[i]=inside[i]?1:0;
 axisPass(a,b,1); // b = dilate(inside)
 const dil=scratch?.dil||new Uint8Array(n);dil.set(b);axisPass(a,b,0); // b = erode(inside)
 for(let i=0;i<n;i++)D[i]=(dil[i]&&!b[i])?0:INF;
 // chamfer passes: forward over the 13 already-visited neighbours (z-1
 // layer: 9, y-1 row: 3, x-1: 1), backward over their mirrors; interior
 // voxels use precomputed index offsets without bounds checks
 const F=[[-1,0,0,3],[-1,-1,0,4],[0,-1,0,3],[1,-1,0,4],[-1,-1,-1,5],[0,-1,-1,4],[1,-1,-1,5],[-1,0,-1,4],[0,0,-1,3],[1,0,-1,4],[-1,1,-1,5],[0,1,-1,4],[1,1,-1,5]];
 const pass=(offs,back)=>{
  const io=new Int32Array(13),ic=new Int32Array(13);for(let k=0;k<13;k++){const o=offs[k];io[k]=o[0]+o[1]*w+o[2]*wh;ic[k]=o[3]}
  const zs=back?d-1:0,ze=back?-1:d,zi=back?-1:1,ys=back?h-1:0,ye=back?-1:h,yi=back?-1:1,xs=back?w-1:0,xe=back?-1:w,xi=back?-1:1;
  for(let z=zs;z!==ze;z+=zi){const zin=z>0&&z<d-1;for(let y=ys;y!==ye;y+=yi){const yin=zin&&y>0&&y<h-1,row=z*wh+y*w;
   for(let x=xs;x!==xe;x+=xi){const i=row+x;let m=D[i];if(m===0)continue;
    if(yin&&x>0&&x<w-1){for(let k=0;k<13;k++){const c=D[i+io[k]]+ic[k];if(c<m)m=c}}
    else for(let k=0;k<13;k++){const o=offs[k],xx=x+o[0],yy=y+o[1],zz=z+o[2];if(xx<0||yy<0||zz<0||xx>=w||yy>=h||zz>=d)continue;const c=D[zz*wh+yy*w+xx]+o[3];if(c<m)m=c}
    D[i]=m}}}
 };
 pass(F,false);
 pass(F.map(o=>[-o[0],-o[1],-o[2],o[3]]),true);
 const out=new Uint8Array(n);
 for(let i=0;i<n;i++){const v=Math.floor(D[i]*0.3);out[i]=v>255?255:v}
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
  const dist=chamferDistanceBytes(inside,dims,scratch);
  for(let i=0;i<n;i++)out[i*C+c]=dist[i];
 }
 onProgress?.(C,C);
 return{data:out,C,chan:cls.chan};
}
// build 384: the classification bytes and the per-segment distance bytes
// share one RGBA texture: channels as in cls (chan), alpha = the smallest
// distance over the enabled segments (bit s of mask), 255 when none. One
// fetch per ray step then serves the jump test and the classification.
// Needs a free channel: at most three segments stored (chan < 3).
// build 528: with {four:true} four stored channels are accepted as well: channels 0..2 go to the texture as before, the
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
// build 528: the classification bytes of channel 3 (the fourth stored segment), one byte per voxel, for the VR shader's
// second texture (VRL_CLS4); null when no segment uses channel 3
export function fourthChannelBytes(cls){
 const C=cls.C,chan=cls.chan;if(!chan.includes(3)||C<4)return null;
 const n=cls.data.length/C,out=new Uint8Array(n);
 for(let i=0;i<n;i++)out[i]=cls.data[i*C+3];
 return out;
}
