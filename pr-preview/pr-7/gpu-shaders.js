// Extracted verbatim from app.js by tools/extract-module.mjs.
// Self-contained: depends only on the imports below (no module state).
import { ANISO_LAMBDA_MIN, ANISO_LAMBDA_MAX } from './filter-units.js?v=20261024-build665';
export const AIRDIST_X_MAX_N=64;
export function gpuFilterShader(kind,workgroupSize){
 const header=`
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<storage, read> meta: array<u32>;
@group(0) @binding(3) var<storage, read> params: array<f32>;
fn coord(i:u32)->vec3<u32>{
 let w=meta[0];let h=meta[1];let plane=w*h;
 return vec3<u32>(i%w,(i/w)%h,i/plane);
}
fn idx(x:u32,y:u32,z:u32)->u32{return z*meta[0]*meta[1]+y*meta[0]+x;}
fn cidx(x:i32,y:i32,z:i32)->u32{
 let xx=u32(clamp(x,0,i32(meta[0])-1));let yy=u32(clamp(y,0,i32(meta[1])-1));let zz=u32(clamp(z,0,i32(meta[2])-1));
 return idx(xx,yy,zz);
}
`;
 if(kind==='gaussian')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=coord(i);let w=meta[0];let h=meta[1];let d=meta[2];let axis=meta[4];
 var x0=c.x;var x1=c.x;var y0=c.y;var y1=c.y;var z0=c.z;var z1=c.z;
 if(axis==0u){x0=select(c.x-1u,0u,c.x==0u);x1=min(w-1u,c.x+1u);}
 if(axis==1u){y0=select(c.y-1u,0u,c.y==0u);y1=min(h-1u,c.y+1u);}
 if(axis==2u){z0=select(c.z-1u,0u,c.z==0u);z1=min(d-1u,c.z+1u);}
 let a=src[idx(x0,y0,z0)];let b=src[i];let cc=src[idx(x1,y1,z1)];
 let blur=(a+2.0*b+cc)*0.25;let s=params[0];dst[i]=b*(1.0-s)+blur*s;
}`;
 // Squared distance (mm²) from each voxel to the nearest "air" voxel (value <
 // segment min), one axis per pass; the three passes compose the exact squared
 // Euclidean distance within the box radius (min over dx, then dy, then dz).
 // meta[4]=axis, meta[5]=radius in voxels, meta[6]=mode; params[0..1]=segment min,max,
 // params[2]=spacing along the axis, params[3]=r² (mode 2). Encoding between passes:
 // a segment voxel stores g (>=0), any other voxel stores -(g+1). Axis 0 reads:
 //  mode 0: CT values; feature = air (< min), segment = [min,max]
 //  mode 1: a 0/1 mask; feature = outside the mask (opening: erosion distance)
 //  mode 2: an encoded field; feature = segment voxels with g > r² (the eroded core),
 //          segment = e >= 0 (opening: dilation distance)
 if(kind==='airDist')return header+`
fn decodeG(e:f32)->f32{if(e<0.0){return -e-1.0;}return e;}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=vec3<i32>(coord(i));let axis=meta[4];let n=i32(meta[5]);let s=params[2];
 let dims=vec3<i32>(i32(meta[0]),i32(meta[1]),i32(meta[2]));
 let mode=meta[6];var inSeg=false;
 if(axis==0u&&mode==0u){let v=src[i];inSeg=v>=params[0]&&v<=params[1];}else if(axis==0u&&mode==1u){inSeg=src[i]>0.5;}else{inSeg=src[i]>=0.0;}
 // visit offsets by increasing |k| and stop once (k*s)^2 >= g:
 // every term is >= (k*s)^2, so the rest cannot lower g. Air voxels (g=0 at
 // k=0) now read one value instead of 2n+1. Same result as the full scan.
 var g=1.0e30;
 for(var m=0;m<=2*n;m++){
  let k=select(-((m+1)/2),m/2,(m&1)==0);let d=f32(k)*s;
  if(d*d>=g){break;}
  var q=c;if(axis==0u){q.x=c.x+k;}else if(axis==1u){q.y=c.y+k;}else{q.z=c.z+k;}
  if(q.x<0||q.y<0||q.z<0||q.x>=dims.x||q.y>=dims.y||q.z>=dims.z){continue;}
  let e=src[idx(u32(q.x),u32(q.y),u32(q.z))];
  if(axis==0u){
   var feature=false;
   if(mode==0u){feature=e<params[0];}else if(mode==1u){feature=e<=0.5;}else{feature=e>=0.0&&e>params[3];}
   if(feature){g=min(g,d*d);}
  }else{g=min(g,decodeG(e)+d*d);}
 }
 dst[i]=select(-(g+1.0),g,inSeg);
}`;
 // the x pass of airDist (axis 0) with the row neighbours staged in
 // workgroup memory. The x pass was the slowest (3.8 s of 5.8 s): body voxels
 // with no air within n along x never hit the early break, so each read all
 // 2n+1 values from the storage buffer. Each workgroup now loads its span
 // [base-n, base+WG+n) once; the scan and the result are the same as airDist.
 // Needs n <= AIRDIST_X_MAX_N (the caller falls back to airDist otherwise).
 if(kind==='airDistX')return header+`
var<workgroup> tile: array<f32, ${workgroupSize+2*AIRDIST_X_MAX_N}>;
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_id) lid:vec3<u32>){
 let i=gid.x;let total=meta[3];let n=i32(meta[5]);let s=params[2];let mode=meta[6];
 let base=i32(i)-i32(lid.x);
 for(var j=i32(lid.x);j<${workgroupSize}+2*n;j=j+${workgroupSize}){
  let p=base-n+j;var v=0.0;if(p>=0&&p<i32(total)){v=src[u32(p)];}tile[j]=v;
 }
 workgroupBarrier();
 if(i>=total){return;}
 let c=vec3<i32>(coord(i));let w=i32(meta[0]);let own=tile[i32(lid.x)+n];
 var inSeg=false;
 if(mode==0u){inSeg=own>=params[0]&&own<=params[1];}else if(mode==1u){inSeg=own>0.5;}else{inSeg=own>=0.0;}
 var g=1.0e30;
 for(var m=0;m<=2*n;m++){
  let k=select(-((m+1)/2),m/2,(m&1)==0);let d=f32(k)*s;
  if(d*d>=g){break;}
  let qx=c.x+k;if(qx<0||qx>=w){continue;}
  let e=tile[i32(lid.x)+n+k];
  var feature=false;
  if(mode==0u){feature=e<params[0];}else if(mode==1u){feature=e<=0.5;}else{feature=e>=0.0&&e>params[3];}
  if(feature){g=min(g,d*d);}
 }
 dst[i]=select(-(g+1.0),g,inSeg);
}`;
 // n passes of the 3-tap gaussian along one axis fused into one (2n+1)-tap
 // pass; weights
 // come from gaussianPassKernel(), meta[4]=axis, meta[5]=radius n
 if(kind==='gaussianK')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=vec3<i32>(coord(i));let axis=meta[4];let r=i32(meta[5]);
 var acc=0.0;
 for(var k=-r;k<=r;k=k+1){
  var p=c;if(axis==0u){p.x=p.x+k;}else if(axis==1u){p.y=p.y+k;}else{p.z=p.z+k;}
  acc=acc+params[u32(k+r)]*src[cidx(p.x,p.y,p.z)];
 }
 dst[i]=acc;
}`;
 // filtered block -> packed rg8 (u16) volume texture slices on the
 // GPU: in-plane area average over xs/ys spans, CT value -> raw u16, two texels
 // per u32 word; rows padded to meta[6] words (256-byte copy alignment)
 if(kind==='packReduce')return `
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<storage, read> meta: array<u32>;
@group(0) @binding(3) var<storage, read> params: array<f32>;
@group(0) @binding(4) var<storage, read> aux: array<u32>;
fn texel(x:u32,y:u32,z:u32)->u32{
 let w=meta[0];let h=meta[1];let tw=meta[3];let th=meta[4];
 if(x>=tw){return 0u;}
 let x0=aux[x];let x1=aux[x+1u];let y0=aux[tw+1u+y];let y1=aux[tw+1u+y+1u];
 var acc=0.0;var n=0.0;
 for(var sy=y0;sy<y1;sy=sy+1u){for(var sx=x0;sx<x1;sx=sx+1u){acc=acc+src[(z*h+sy)*w+sx];n=n+1.0;}}
 let v=acc/max(n,1.0);
 let raw=clamp(round((v-params[1])*params[0])+params[2],0.0,65535.0);
 return u32(raw);
}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[7]){return;}
 let rowWords=meta[6];let th=meta[4];let per=rowWords*th;
 let k=i/per;let rem=i%per;let y=rem/rowWords;let wx=rem%rowWords;
 let z=aux[meta[3]+1u+th+1u+k];
 dst[i]=texel(2u*wx,y,z)|(texel(2u*wx+1u,y,z)<<16u);
}`;
 if(kind==='median')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=coord(i);let w=meta[0];let h=meta[1];let d=meta[2];
 if(c.x==0u){dst[i]=src[i];return;}if(c.y==0u){dst[i]=src[i];return;}if(c.z==0u){dst[i]=src[i];return;}if(c.x+1u>=w){dst[i]=src[i];return;}if(c.y+1u>=h){dst[i]=src[i];return;}if(c.z+1u>=d){dst[i]=src[i];return;}
 let plane=w*h;var vals:array<f32,7>;
 vals[0]=src[i];vals[1]=src[i-1u];vals[2]=src[i+1u];vals[3]=src[i-w];vals[4]=src[i+w];vals[5]=src[i-plane];vals[6]=src[i+plane];
 for(var q:u32=1u;q<7u;q=q+1u){
  let v=vals[q];var j=i32(q)-1;
  loop{
   if(j<0){break;}if(vals[u32(j)]<=v){break;}
   vals[u32(j+1)]=vals[u32(j)];j=j-1;
  }
  vals[u32(j+1)]=v;
 }
 let s=params[0];dst[i]=src[i]*(1.0-s)+vals[3]*s;
}`;
 if(kind==='sigmoid')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=params[1];let hw=max(1.0,params[2]*0.5);let g=max(0.0,params[0])*6.0;
 // see cpuSigmoid (centre and values outside centre ± width/2 kept, strength 0 = none). tanh written as
 // 1 − 2/(exp(2a)+1): no inf/inf on drivers whose tanh overflows; |g·t| ≤ 6 here anyway
 let x=src[i];let t=(x-c)/hw;
 if(g>0.0001&&t>-1.0&&t<1.0){let a=1.0-2.0/(exp(2.0*g*t)+1.0);let b=1.0-2.0/(exp(2.0*g)+1.0);dst[i]=c+hw*a/b;}else{dst[i]=x;}
}`;
 if(kind==='spikeHole')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=coord(i);let w=meta[0];let h=meta[1];let d=meta[2];
 if(c.x==0u){dst[i]=src[i];return;}if(c.y==0u){dst[i]=src[i];return;}if(c.z==0u){dst[i]=src[i];return;}if(c.x+1u>=w){dst[i]=src[i];return;}if(c.y+1u>=h){dst[i]=src[i];return;}if(c.z+1u>=d){dst[i]=src[i];return;}
 let n0=src[i-1u];let n1=src[i+1u];let n2=src[i-w];let n3=src[i+w];let plane=w*h;let n4=src[i-plane];let n5=src[i+plane];
 let mean=(n0+n1+n2+n3+n4+n5)/6.0;let lo=min(min(min(n0,n1),min(n2,n3)),min(n4,n5));let hi=max(max(max(n0,n1),max(n2,n3)),max(n4,n5));
 let strength=params[0];let threshold=params[1];let guard=threshold*(0.55+0.35*strength);let diff=src[i]-mean;
 if(hi-lo<=guard){if(abs(diff)>threshold){let target=mean+sign(diff)*threshold*0.08;let blend=0.20+0.75*strength;dst[i]=src[i]*(1.0-blend)+target*blend;return;}}dst[i]=src[i];
}`;
 if(kind==='anisotropic')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=coord(i);let w=meta[0];let h=meta[1];let d=meta[2];
 if(c.x==0u){dst[i]=src[i];return;}if(c.y==0u){dst[i]=src[i];return;}if(c.z==0u){dst[i]=src[i];return;}if(c.x+1u>=w){dst[i]=src[i];return;}if(c.y+1u>=h){dst[i]=src[i];return;}if(c.z+1u>=d){dst[i]=src[i];return;}
 let center=src[i];let plane=w*h;let strength=params[0];let k=params[1];let k2=max(k*k,0.000001);let lambda=min(${ANISO_LAMBDA_MIN}+(${ANISO_LAMBDA_MAX}-${ANISO_LAMBDA_MIN})*clamp(strength,0.0,1.0),${ANISO_LAMBDA_MAX});let wx=params[2];let wy=params[3];let wz=params[4];
 var flux=0.0;var diff=src[i-1u]-center;flux+=wx*(exp(-(diff*diff)/k2)*diff);diff=src[i+1u]-center;flux+=wx*(exp(-(diff*diff)/k2)*diff);
 diff=src[i-w]-center;flux+=wy*(exp(-(diff*diff)/k2)*diff);diff=src[i+w]-center;flux+=wy*(exp(-(diff*diff)/k2)*diff);
 diff=src[i-plane]-center;flux+=wz*(exp(-(diff*diff)/k2)*diff);diff=src[i+plane]-center;flux+=wz*(exp(-(diff*diff)/k2)*diff);
 dst[i]=center+lambda*flux;
}`;
 if(kind==='tv')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=coord(i);let w=meta[0];let h=meta[1];let d=meta[2];
 if(c.x==0u){dst[i]=src[i];return;}if(c.y==0u){dst[i]=src[i];return;}if(c.z==0u){dst[i]=src[i];return;}if(c.x+1u>=w){dst[i]=src[i];return;}if(c.y+1u>=h){dst[i]=src[i];return;}if(c.z+1u>=d){dst[i]=src[i];return;}
 let center=src[i];let plane=w*h;let weight=params[0];let lambda=min(0.18,0.02+weight*0.45);let eps=params[1];let wx=params[2];let wy=params[3];let wz=params[4];
 var flux=0.0;var diff=src[i-1u]-center;flux+=wx*(diff/sqrt(diff*diff+eps*eps));diff=src[i+1u]-center;flux+=wx*(diff/sqrt(diff*diff+eps*eps));
 diff=src[i-w]-center;flux+=wy*(diff/sqrt(diff*diff+eps*eps));diff=src[i+w]-center;flux+=wy*(diff/sqrt(diff*diff+eps*eps));
 diff=src[i-plane]-center;flux+=wz*(diff/sqrt(diff*diff+eps*eps));diff=src[i+plane]-center;flux+=wz*(diff/sqrt(diff*diff+eps*eps));
 dst[i]=center+lambda*flux;
}`;
 // Separable unsharp mask: the clipped box mean is a product of 1D
 // means, so x and y passes ('boxMean') then a z pass fused with the sharpening
 // ('unsharpCombine', original CT at binding 4) give the same result as the cube
 // loop (since removed) with 3(2r+1) reads per voxel instead of (2r+1)³.
 // boxMean: meta[4]=axis, meta[5]=taps K on each side, params[1]=A (half-width of the box in voxels along the axis,
 // (R+0.5)*hmin/h_a); voxel k weighs clamp(A-|k|+0.5,0,1) (all 1 when isotropic = the plain box). params[0] is unused.
 if(kind==='boxMean')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=vec3<i32>(coord(i));let axis=meta[4];let r=i32(meta[5]);
 let dims=vec3<i32>(i32(meta[0]),i32(meta[1]),i32(meta[2]));var sum=0.0;var count=0.0;
 for(var k=-r;k<=r;k++){
  var q=c;if(axis==0u){q.x=c.x+k;}else if(axis==1u){q.y=c.y+k;}else{q.z=c.z+k;}
  if(q.x<0||q.y<0||q.z<0||q.x>=dims.x||q.y>=dims.y||q.z>=dims.z){continue;}
  let wk=clamp(params[1]-f32(abs(k))+0.5,0.0,1.0);
  sum+=wk*src[idx(u32(q.x),u32(q.y),u32(q.z))];count+=wk;
 }
 dst[i]=sum/max(count,0.000001);
}`;
 // unsharpCombine: src = x/y box mean, binding 4 = original; meta[5]=taps K; params = amount, thresholdHU
 // (the Unsharp stage's param layout;: no volume range), A of the z axis (see boxMean).
 if(kind==='unsharpCombine')return header+`
@group(0) @binding(4) var<storage, read> orig: array<f32>;
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=coord(i);let d=i32(meta[2]);let r=i32(meta[5]);var sum=0.0;var count=0.0;
 for(var k=-r;k<=r;k++){let zz=i32(c.z)+k;if(zz<0||zz>=d){continue;}let wk=clamp(params[2]-f32(abs(k))+0.5,0.0,1.0);sum+=wk*src[idx(c.x,c.y,u32(zz))];count+=wk;}
 let blur=sum/max(count,0.000001);let v=orig[i];let detail=v-blur;let threshold=params[1];
 dst[i]=select(v,v+params[0]*detail,abs(detail)>=threshold);
}`;
 if(kind==='bilateral')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=coord(i);let center=src[i];
 let strength=params[0];let spatialSigma=params[1];let intensitySigma=max(0.000001,params[2]);
 let rx=i32(meta[4]);let ry=i32(meta[5]);let rz=i32(meta[6]);let ix=params[3];let iy=params[4];let iz=params[5];let sp2=2.0*spatialSigma*spatialSigma;let int2=2.0*intensitySigma*intensitySigma;
 var sum=0.0;var wsum=0.0;
 for(var dz:i32=-rz;dz<=rz;dz=dz+1){
  let zz=i32(c.z)+dz;if(zz<0){continue;}if(zz>=i32(meta[2])){continue;}
  for(var dy:i32=-ry;dy<=ry;dy=dy+1){
   let yy=i32(c.y)+dy;if(yy<0){continue;}if(yy>=i32(meta[1])){continue;}
   for(var dx:i32=-rx;dx<=rx;dx=dx+1){
    let xx=i32(c.x)+dx;if(xx<0){continue;}if(xx>=i32(meta[0])){continue;}
    let j=idx(u32(xx),u32(yy),u32(zz));let dv=src[j]-center;
    let sw=exp(-(f32(dx*dx)*ix+f32(dy*dy)*iy+f32(dz*dz)*iz)/sp2);let iw=exp(-(dv*dv)/int2);let ww=sw*iw;
    sum+=src[j]*ww;wsum+=ww;
   }
  }
 }
 let filtered=select(center,sum/wsum,wsum>0.0);dst[i]=center*(1.0-strength)+filtered*strength;
}`;
 if(kind==='nlm')return header+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[3]){return;}let c=coord(i);let center=src[i];
 let srx=i32(meta[4]);let sry=i32(meta[5]);let srz=i32(meta[6]);let prx=i32(params[1]);let pry=i32(params[2]);let prz=i32(params[3]);let prm=max(prx,max(pry,prz));let hp=params[0];let h2=max(hp*hp,0.000001);
 var weighted=center;var weightSum=1.0;
 for(var dz:i32=-srz;dz<=srz;dz=dz+1){
  let nz=i32(c.z)+dz;if(nz<0){continue;}if(nz>=i32(meta[2])){continue;}
  for(var dy:i32=-sry;dy<=sry;dy=dy+1){
   let ny=i32(c.y)+dy;if(ny<0){continue;}if(ny>=i32(meta[1])){continue;}
   for(var dx:i32=-srx;dx<=srx;dx=dx+1){
    let nx=i32(c.x)+dx;if(nx<0){continue;}if(nx>=i32(meta[0])){continue;}if(dx==0){if(dy==0){if(dz==0){continue;}}}
    var dist2=0.0;var samples=1.0;
    var dv=src[cidx(i32(c.x),i32(c.y),i32(c.z))]-src[cidx(nx,ny,nz)];dist2+=dv*dv;
    for(var r:i32=1;r<=prm;r=r+1){
     if(r<=prx){
      dv=src[cidx(i32(c.x)+r,i32(c.y),i32(c.z))]-src[cidx(nx+r,ny,nz)];dist2+=dv*dv;
      dv=src[cidx(i32(c.x)-r,i32(c.y),i32(c.z))]-src[cidx(nx-r,ny,nz)];dist2+=dv*dv;
      samples+=2.0;
     }
     if(r<=pry){
      dv=src[cidx(i32(c.x),i32(c.y)+r,i32(c.z))]-src[cidx(nx,ny+r,nz)];dist2+=dv*dv;
      dv=src[cidx(i32(c.x),i32(c.y)-r,i32(c.z))]-src[cidx(nx,ny-r,nz)];dist2+=dv*dv;
      samples+=2.0;
     }
     if(r<=prz){
      dv=src[cidx(i32(c.x),i32(c.y),i32(c.z)+r)]-src[cidx(nx,ny,nz+r)];dist2+=dv*dv;
      dv=src[cidx(i32(c.x),i32(c.y),i32(c.z)-r)]-src[cidx(nx,ny,nz-r)];dist2+=dv*dv;
      samples+=2.0;
     }
    }
    dist2/=samples;let weight=exp(-dist2/h2);let j=idx(u32(nx),u32(ny),u32(nz));weighted+=weight*src[j];weightSum+=weight;
   }
  }
 }
 dst[i]=weighted/weightSum;
}`;
 if(kind==='meshCount')return `
struct Counters{values:array<atomic<u32>,4>};
@group(0) @binding(0) var<storage, read> src:array<f32>;
@group(0) @binding(2) var<storage, read> meta:array<u32>;
@group(0) @binding(3) var<storage, read> thresholds:array<f32>;
@group(0) @binding(4) var<storage, read_write> counters:Counters;
fn localIdx(x:u32,y:u32,z:u32)->u32{return z*meta[0]*meta[1]+y*meta[0]+x;}
fn insideSegment(v:f32,s:u32)->bool{if(v<thresholds[s*2u]){return false;}if(v>thresholds[s*2u+1u]){return false;}return true;}
fn outsideLocal(x:i32,y:i32,z:i32,s:u32)->bool{
 if(x<0){return true;}if(y<0){return true;}if(z<0){return true;}
 if(x>=i32(meta[0])){return true;}if(y>=i32(meta[1])){return true;}if(z>=i32(meta[2])){return true;}
 return !insideSegment(src[localIdx(u32(x),u32(y),u32(z))],s);
}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[9]){return;}let tw=meta[6];let th=meta[7];
 let tx=i%tw;let ty=(i/tw)%th;let tz=i/(tw*th);let x=meta[3]+tx;let y=meta[4]+ty;let z=meta[5]+tz;
 let gx=meta[11]+x;let gy=meta[12]+y;let gz=meta[13]+z;let center=src[localIdx(x,y,z)];
 for(var s:u32=0u;s<meta[10];s=s+1u){
  if(!insideSegment(center,s)){continue;}var count=0u;
  if(outsideLocal(i32(x)-1,i32(y),i32(z),s)){count=count+1u;}
  if(outsideLocal(i32(x)+1,i32(y),i32(z),s)){count=count+1u;}
  if(outsideLocal(i32(x),i32(y)-1,i32(z),s)){count=count+1u;}
  if(outsideLocal(i32(x),i32(y)+1,i32(z),s)){count=count+1u;}
  if(outsideLocal(i32(x),i32(y),i32(z)-1,s)){count=count+1u;}
  if(outsideLocal(i32(x),i32(y),i32(z)+1,s)){count=count+1u;}
  if(count>0u){atomicAdd(&counters.values[s],count);}
 }
}`;
 if(kind==='meshWrite')return `
struct Counters{values:array<atomic<u32>,4>};
@group(0) @binding(0) var<storage, read> src:array<f32>;
@group(0) @binding(1) var<storage, read_write> dst:array<f32>;
@group(0) @binding(2) var<storage, read> meta:array<u32>;
@group(0) @binding(3) var<storage, read> thresholds:array<f32>;
@group(0) @binding(4) var<storage, read_write> counters:Counters;
@group(0) @binding(5) var<storage, read> geom:array<f32>;
fn localIdx(x:u32,y:u32,z:u32)->u32{return z*meta[0]*meta[1]+y*meta[0]+x;}
fn insideSegment(v:f32,s:u32)->bool{if(v<thresholds[s*2u]){return false;}if(v>thresholds[s*2u+1u]){return false;}return true;}
fn outsideLocal(x:i32,y:i32,z:i32,s:u32)->bool{
 if(x<0){return true;}if(y<0){return true;}if(z<0){return true;}
 if(x>=i32(meta[0])){return true;}if(y>=i32(meta[1])){return true;}if(z>=i32(meta[2])){return true;}
 return !insideSegment(src[localIdx(u32(x),u32(y),u32(z))],s);
}
fn writeFace(base:u32,a:vec3<f32>,b:vec3<f32>,c:vec3<f32>,d:vec3<f32>,e:vec3<f32>,f:vec3<f32>){
 dst[base]=a.x;dst[base+1u]=a.y;dst[base+2u]=a.z;dst[base+3u]=b.x;dst[base+4u]=b.y;dst[base+5u]=b.z;
 dst[base+6u]=c.x;dst[base+7u]=c.y;dst[base+8u]=c.z;dst[base+9u]=d.x;dst[base+10u]=d.y;dst[base+11u]=d.z;
 dst[base+12u]=e.x;dst[base+13u]=e.y;dst[base+14u]=e.z;dst[base+15u]=f.x;dst[base+16u]=f.y;dst[base+17u]=f.z;
}
fn slotFor(s:u32)->u32{return (meta[17u+s]+atomicAdd(&counters.values[s],1u))*18u;}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[9]){return;}let tw=meta[6];let th=meta[7];
 let tx=i%tw;let ty=(i/tw)%th;let tz=i/(tw*th);let x=meta[3]+tx;let y=meta[4]+ty;let z=meta[5]+tz;
 let gx=meta[11]+x;let gy=meta[12]+y;let gz=meta[13]+z;let center=src[localIdx(x,y,z)];
 let sx=geom[0];let sy=geom[1];let sz=geom[2];let scale=geom[3];let px=geom[4];let py=geom[5];let pz=geom[6];
 let x0=(f32(gx)*sx-px*0.5)*scale;let x1=(f32(gx+1u)*sx-px*0.5)*scale;
 let y0=-(f32(gy)*sy-py*0.5)*scale;let y1=-(f32(gy+1u)*sy-py*0.5)*scale;
 let z0=(f32(gz)*sz-pz*0.5)*scale;let z1=(f32(gz+1u)*sz-pz*0.5)*scale;
 for(var s:u32=0u;s<meta[10];s=s+1u){
  if(!insideSegment(center,s)){continue;}
  if(outsideLocal(i32(x)-1,i32(y),i32(z),s)){let b=slotFor(s);writeFace(b,vec3f(x0,y0,z0),vec3f(x0,y0,z1),vec3f(x0,y1,z1),vec3f(x0,y0,z0),vec3f(x0,y1,z1),vec3f(x0,y1,z0));}
  if(outsideLocal(i32(x)+1,i32(y),i32(z),s)){let b=slotFor(s);writeFace(b,vec3f(x1,y0,z0),vec3f(x1,y1,z0),vec3f(x1,y1,z1),vec3f(x1,y0,z0),vec3f(x1,y1,z1),vec3f(x1,y0,z1));}
  if(outsideLocal(i32(x),i32(y)-1,i32(z),s)){let b=slotFor(s);writeFace(b,vec3f(x0,y0,z0),vec3f(x1,y0,z0),vec3f(x1,y0,z1),vec3f(x0,y0,z0),vec3f(x1,y0,z1),vec3f(x0,y0,z1));}
  if(outsideLocal(i32(x),i32(y)+1,i32(z),s)){let b=slotFor(s);writeFace(b,vec3f(x0,y1,z0),vec3f(x0,y1,z1),vec3f(x1,y1,z1),vec3f(x0,y1,z0),vec3f(x1,y1,z1),vec3f(x1,y1,z0));}
  if(outsideLocal(i32(x),i32(y),i32(z)-1,s)){let b=slotFor(s);writeFace(b,vec3f(x0,y0,z0),vec3f(x0,y1,z0),vec3f(x1,y1,z0),vec3f(x0,y0,z0),vec3f(x1,y1,z0),vec3f(x1,y0,z0));}
  if(outsideLocal(i32(x),i32(y),i32(z)+1,s)){let b=slotFor(s);writeFace(b,vec3f(x0,y0,z1),vec3f(x1,y0,z1),vec3f(x1,y1,z1),vec3f(x0,y0,z1),vec3f(x1,y1,z1),vec3f(x0,y1,z1));}
 }
}`;
 if(kind==='faceCompact')return `
struct Counter{value:atomic<u32>};
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<storage, read> meta: array<u32>;
@group(0) @binding(3) var<storage, read> thresholds: array<f32>;
@group(0) @binding(4) var<storage, read_write> counter:Counter;
fn localIdx(x:u32,y:u32,z:u32)->u32{return z*meta[0]*meta[1]+y*meta[0]+x;}
fn insideSegment(value:f32,s:u32)->bool{if(value<thresholds[s*2u]){return false;}if(value>thresholds[s*2u+1u]){return false;}return true;}
fn outsideLocal(x:i32,y:i32,z:i32,s:u32)->bool{
 if(x<0){return true;}if(y<0){return true;}if(z<0){return true;}
 if(x>=i32(meta[0])){return true;}if(y>=i32(meta[1])){return true;}if(z>=i32(meta[2])){return true;}
 return !insideSegment(src[localIdx(u32(x),u32(y),u32(z))],s);
}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let count=meta[9];if(i>=count){return;}
 let tw=meta[6];let th=meta[7];let tx=i%tw;let ty=(i/tw)%th;let tz=i/(tw*th);
 let x=meta[3]+tx;let y=meta[4]+ty;let z=meta[5]+tz;
 let gx=meta[11]+x;let gy=meta[12]+y;let gz=meta[13]+z;
 let center=src[localIdx(x,y,z)];var packed=0u;
 for(var s:u32=0u;s<meta[10];s=s+1u){
  if(!insideSegment(center,s)){continue;}
  let shift=s*6u;var faces=0u;
  if(outsideLocal(i32(x)-1,i32(y),i32(z),s)){faces=faces|1u;}
  if(outsideLocal(i32(x)+1,i32(y),i32(z),s)){faces=faces|2u;}
  if(outsideLocal(i32(x),i32(y)-1,i32(z),s)){faces=faces|4u;}
  if(outsideLocal(i32(x),i32(y)+1,i32(z),s)){faces=faces|8u;}
  if(outsideLocal(i32(x),i32(y),i32(z)-1,s)){faces=faces|16u;}
  if(outsideLocal(i32(x),i32(y),i32(z)+1,s)){faces=faces|32u;}
  packed=packed|(faces<<shift);
 }
 if(packed!=0u){
  let slot=atomicAdd(&counter.value,1u);
  dst[slot*2u]=i;dst[slot*2u+1u]=packed;
 }
}`;
 if(kind==='faceExtract')return `
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<storage, read> meta: array<u32>;
@group(0) @binding(3) var<storage, read> thresholds: array<f32>;
fn localIdx(x:u32,y:u32,z:u32)->u32{return z*meta[0]*meta[1]+y*meta[0]+x;}
fn insideSegment(value:f32,s:u32)->bool{if(value<thresholds[s*2u]){return false;}if(value>thresholds[s*2u+1u]){return false;}return true;}
fn outsideLocal(x:i32,y:i32,z:i32,s:u32)->bool{
 if(x<0){return true;}if(y<0){return true;}if(z<0){return true;}
 if(x>=i32(meta[0])){return true;}if(y>=i32(meta[1])){return true;}if(z>=i32(meta[2])){return true;}
 return !insideSegment(src[localIdx(u32(x),u32(y),u32(z))],s);
}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let count=meta[9];if(i>=count){return;}
 let tw=meta[6];let th=meta[7];let tx=i%tw;let ty=(i/tw)%th;let tz=i/(tw*th);
 let x=meta[3]+tx;let y=meta[4]+ty;let z=meta[5]+tz;
 let gx=meta[11]+x;let gy=meta[12]+y;let gz=meta[13]+z;
 let center=src[localIdx(x,y,z)];var packed=0u;
 for(var s:u32=0u;s<meta[10];s=s+1u){
  if(!insideSegment(center,s)){continue;}
  let shift=s*6u;var faces=0u;
  if(outsideLocal(i32(x)-1,i32(y),i32(z),s)){faces=faces|1u;}
  if(outsideLocal(i32(x)+1,i32(y),i32(z),s)){faces=faces|2u;}
  if(outsideLocal(i32(x),i32(y)-1,i32(z),s)){faces=faces|4u;}
  if(outsideLocal(i32(x),i32(y)+1,i32(z),s)){faces=faces|8u;}
  if(outsideLocal(i32(x),i32(y),i32(z)-1,s)){faces=faces|16u;}
  if(outsideLocal(i32(x),i32(y),i32(z)+1,s)){faces=faces|32u;}
  packed=packed|(faces<<shift);
 }
 dst[i]=packed;
}`;
 if(kind==='maskExtract')return `
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<storage, read> meta: array<u32>;
@group(0) @binding(3) var<storage, read> thresholds: array<f32>;
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let count=meta[9];if(i>=count){return;}
 let tw=meta[6];let th=meta[7];let x=i%tw;let y=(i/tw)%th;let z=i/(tw*th);
 let sx=meta[3]+x;let sy=meta[4]+y;let sz=meta[5]+z;let value=src[sz*meta[0]*meta[1]+sy*meta[0]+sx];
 var bits=0u;let segmentCount=meta[10];
 for(var s:u32=0u;s<segmentCount;s=s+1u){
  if(value>=thresholds[s*2u]){if(value<=thresholds[s*2u+1u]){bits=bits|(1u<<s);}}
 }
 dst[i]=bits;
}`;
 if(kind==='analysisRunCount')return `
struct Counter{value:atomic<u32>};
@group(0) @binding(0) var<storage, read> src:array<f32>;
@group(0) @binding(2) var<storage, read> meta:array<u32>;
@group(0) @binding(3) var<storage, read> thresholds:array<f32>;
@group(0) @binding(4) var<storage, read_write> counter:Counter;
fn localIdx(x:u32,y:u32,z:u32)->u32{return z*meta[0]*meta[1]+y*meta[0]+x;}
fn inside(v:f32)->bool{if(v<thresholds[0]){return false;}if(v>thresholds[1]){return false;}return true;}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[9]){return;}let tw=meta[6];let th=meta[7];
 let tx=i%tw;let ty=(i/tw)%th;let tz=i/(tw*th);let x=meta[3]+tx;let y=meta[4]+ty;let z=meta[5]+tz;
 if(!inside(src[localIdx(x,y,z)])){return;}
 if(tx>0u){if(inside(src[localIdx(x-1u,y,z)])){return;}}
 atomicAdd(&counter.value,1u);
}`;
 // Class RLE (air-distance layers): one pass for all layers. cls(v) = 0 outside,
 // else k (1..K) for v in (bounds[k-1], bounds[k]], with bounds[0] = thresholds[0]
 // and bounds[k] = thresholds[3+k], K = u32(thresholds[1]). Runs are maximal
 // stretches of one nonzero class; the record's first word is tz | class<<16.
 if(kind==='classRunCount'||kind==='classRunWrite')return `
struct Counter{value:atomic<u32>};
@group(0) @binding(0) var<storage, read> src:array<f32>;
${kind==='classRunWrite'?'@group(0) @binding(1) var<storage, read_write> dst:array<u32>;':''}
@group(0) @binding(2) var<storage, read> meta:array<u32>;
@group(0) @binding(3) var<storage, read> thresholds:array<f32>;
@group(0) @binding(4) var<storage, read_write> counter:Counter;
fn localIdx(x:u32,y:u32,z:u32)->u32{return z*meta[0]*meta[1]+y*meta[0]+x;}
fn cls(v:f32)->u32{
 if(v<thresholds[0]){return 0u;}
 let k=u32(thresholds[1]);
 for(var c=1u;c<=k;c=c+1u){if(v<=thresholds[3u+c]){return c;}}
 return 0u;
}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[9]){return;}let tw=meta[6];let th=meta[7];
 let tx=i%tw;let ty=(i/tw)%th;let tz=i/(tw*th);let x=meta[3]+tx;let y=meta[4]+ty;let z=meta[5]+tz;
 let c=cls(src[localIdx(x,y,z)]);if(c==0u){return;}
 if(tx>0u){if(cls(src[localIdx(x-1u,y,z)])==c){return;}}
 ${kind==='classRunWrite'?`var x1=tx;
 loop{
  if(x1+1u>=tw){break;}
  if(cls(src[localIdx(meta[3]+x1+1u,y,z)])!=c){break;}
  x1=x1+1u;
 }
 let slot=atomicAdd(&counter.value,1u)*4u;
 dst[slot]=tz|(c<<16u);dst[slot+1u]=ty;dst[slot+2u]=tx;dst[slot+3u]=x1;`:'atomicAdd(&counter.value,1u);'}
}`;
 if(kind==='analysisRunWrite')return `
struct Counter{value:atomic<u32>};
@group(0) @binding(0) var<storage, read> src:array<f32>;
@group(0) @binding(1) var<storage, read_write> dst:array<u32>;
@group(0) @binding(2) var<storage, read> meta:array<u32>;
@group(0) @binding(3) var<storage, read> thresholds:array<f32>;
@group(0) @binding(4) var<storage, read_write> counter:Counter;
fn localIdx(x:u32,y:u32,z:u32)->u32{return z*meta[0]*meta[1]+y*meta[0]+x;}
fn inside(v:f32)->bool{if(v<thresholds[0]){return false;}if(v>thresholds[1]){return false;}return true;}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=meta[9]){return;}let tw=meta[6];let th=meta[7];
 let tx=i%tw;let ty=(i/tw)%th;let tz=i/(tw*th);let x=meta[3]+tx;let y=meta[4]+ty;let z=meta[5]+tz;
 if(!inside(src[localIdx(x,y,z)])){return;}
 if(tx>0u){if(inside(src[localIdx(x-1u,y,z)])){return;}}
 var x1=tx;
 loop{
  if(x1+1u>=tw){break;}
  if(!inside(src[localIdx(meta[3]+x1+1u,y,z)])){break;}
  x1=x1+1u;
 }
 let slot=atomicAdd(&counter.value,1u)*4u;
 dst[slot]=tz;dst[slot+1u]=ty;dst[slot+2u]=tx;dst[slot+3u]=x1;
}`;
 if(kind==='extract')return `
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<storage, read> meta: array<u32>;
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let count=meta[9];if(i>=count){return;}
 let tw=meta[6];let th=meta[7];let x=i%tw;let y=(i/tw)%th;let z=i/(tw*th);
 let sx=meta[3]+x;let sy=meta[4]+y;let sz=meta[5]+z;
 dst[i]=src[sz*meta[0]*meta[1]+sy*meta[0]+sx];
}`;
 if(SMOOTH_KERNELS[kind])return smoothKernelShader(kind,workgroupSize);
 throw new Error('Unknown GPU filter shader '+kind);
}
export function normalizeVrlWgsl(source){
 return source.replace(/\bmeta\b/g,'vrlMeta').replace(/\bactive\b/g,'vrlActive').replace(/\btarget\b/g,'vrlTarget');
}
export const GPU_PREWARM_KINDS=['gaussian','gaussianK','packReduce','median','sigmoid','spikeHole','anisotropic','tv','bilateral','nlm','extract','maskExtract','faceCompact','meshCount','meshWrite','analysisRunCount','analysisRunWrite','airDist','airDistX','classRunCount','classRunWrite','boxMean','unsharpCombine'];

// weights of n passes of out=b*(1-s)+s*(a+2b+c)/4, i.e. the 3-tap kernel
// [s/4, 1-s/2, s/4] convolved with itself n times (length 2n+1). Equal to the
// repeated passes away from the volume edge (edges clamp once instead of per pass).
export function gaussianPassKernel(strength,passes){
 const s=Math.max(0,Math.min(1,+strength||0)),base=[s/4,1-s/2,s/4];let k=[1];
 for(let p=0;p<Math.max(1,Math.round(passes));p++){const o=new Array(k.length+2).fill(0);for(let i=0;i<k.length;i++)for(let j=0;j<3;j++)o[i+j]+=k[i]*base[j];k=o}
 return k;
}

// the constrained surface smoothing (constrained-smooth.js) on the GPU, one kernel per pass of an iteration
// (smooth-gpu.js dispatches them in the order of smoothDispatchPlan, smooth-gpu-plan.js). Each runs once per vertex i.
// The bodies are written so that they are valid JavaScript as well (no type annotations or literal suffixes, scalar
// arithmetic only): the unit test runs them on the CPU, pass by pass, against constrainedSmoothPositions.
// P: SmoothParams (n, the offsets into topoA / topoB, lambda, the half box); topoA: [off (n+1) | toff (n+1) | adj],
// topoB: [the triangle (first index slot) of every vertex-triangle incidence | index]; pos / orig / p1 / nrm: xyz per
// vertex; dr: (delta, rho) per vertex; la / lb: the two low-pass channels (delta, |delta|), ping-pong; invs: (1/degree, 0 for
// a pinned or isolated vertex; 1/(degree+1)).
export const SMOOTH_PARAMS_WORDS=12;
const SMOOTH_BINDING={topoA:[1,'u32'],topoB:[2,'u32'],pos:[3,'f32'],orig:[4,'f32'],p1:[5,'f32'],nrm:[6,'f32'],dr:[7,'f32'],la:[8,'f32'],lb:[9,'f32'],invs:[10,'f32']};
export const SMOOTH_KERNELS={
 // area-weighted vertex normal: the cross products of the vertex's triangles (each from its first corner, as on the CPU),
 // summed in triangle order and normalised
 smoothNormals:{uses:{topoA:'read',topoB:'read',pos:'read',nrm:'read_write'},body:`
 let ts=topoA[P.toffB+i];let te=topoA[P.toffB+i+1];
 var nx=0.0;var ny=0.0;var nz=0.0;
 for(var q=ts;q<te;q++){
  let t=topoB[P.triB+q];let a=topoB[P.idxB+t]*3;let b=topoB[P.idxB+t+1]*3;let c=topoB[P.idxB+t+2]*3;
  let ax=pos[a];let ay=pos[a+1];let az=pos[a+2];
  let ux=pos[b]-ax;let uy=pos[b+1]-ay;let uz=pos[b+2]-az;let vx=pos[c]-ax;let vy=pos[c+1]-ay;let vz=pos[c+2]-az;
  nx+=uy*vz-uz*vy;ny+=uz*vx-ux*vz;nz+=ux*vy-uy*vx;
 }
 let l=sqrt(nx*nx+ny*ny+nz*nz);
 if(l>0.0){nx=nx/l;ny=ny/l;nz=nz/l;}
 let p=i*3;nrm[p]=nx;nrm[p+1]=ny;nrm[p+2]=nz;`},
 // the Laplacian step clamped to the box (p1) and its normal component (delta); a pinned or isolated vertex stays
 smoothLaplace:{uses:{topoA:'read',pos:'read',orig:'read',p1:'read_write',nrm:'read',dr:'read_write',invs:'read'},body:`
 let p=i*3;let x=pos[p];let y=pos[p+1];let z=pos[p+2];
 let f=invs[i*2];
 if(f==0.0){p1[p]=x;p1[p+1]=y;p1[p+2]=z;dr[i*2]=0.0;return;}
 let s=topoA[P.offB+i]+P.adjB;let e=topoA[P.offB+i+1]+P.adjB;
 var sx=0.0;var sy=0.0;var sz=0.0;
 for(var q=s;q<e;q++){let j=topoA[q]*3;sx+=pos[j];sy+=pos[j+1];sz+=pos[j+2];}
 let ox=orig[p];let oy=orig[p+1];let oz=orig[p+2];
 let qx=clamp(x+P.lambda*(sx*f-x),ox-P.bx,ox+P.bx);
 let qy=clamp(y+P.lambda*(sy*f-y),oy-P.by,oy+P.by);
 let qz=clamp(z+P.lambda*(sz*f-z),oz-P.bz,oz+P.bz);
 p1[p]=qx;p1[p+1]=qy;p1[p+2]=qz;
 dr[i*2]=(qx-x)*nrm[p]+(qy-y)*nrm[p+1]+(qz-z)*nrm[p+2];`},
 // the low-pass channels start as (delta, |delta|)
 smoothLowpassInit:{uses:{dr:'read',la:'read_write'},body:`
 let d=dr[i*2];la[i*2]=d;la[i*2+1]=abs(d);`},
 // one round of neighbourhood averaging of both channels (la -> lb)
 smoothLowpass:{uses:{topoA:'read',la:'read',lb:'read_write',invs:'read'},body:`
 var s0=la[i*2];var s1=la[i*2+1];
 let s=topoA[P.offB+i]+P.adjB;let e=topoA[P.offB+i+1]+P.adjB;
 for(var q=s;q<e;q++){let j=topoA[q]*2;s0+=la[j];s1+=la[j+1];}
 let f=invs[i*2+1];lb[i*2]=s0*f;lb[i*2+1]=s1*f;`},
 // rho = LP(delta) / LP(|delta|) in [-1, 1]
 smoothRho:{uses:{la:'read',dr:'read_write'},body:`
 let w=la[i*2+1];var r=0.0;
 if(w>0.0){r=clamp(la[i*2]/w,-1.0,1.0);}
 dr[i*2+1]=r;`},
 // a vertex moving in the coherent direction cancels |rho| of its own normal motion, clamped to the box again
 smoothApply:{uses:{pos:'read_write',orig:'read',p1:'read',nrm:'read',dr:'read'},body:`
 let p=i*3;var qx=p1[p];var qy=p1[p+1];var qz=p1[p+2];
 let dl=dr[i*2];let r=dr[i*2+1];
 if(dl!=0.0&&((dl<0.0)==(r<0.0))){
  let c=r*abs(dl);
  qx=clamp(qx-c*nrm[p],orig[p]-P.bx,orig[p]+P.bx);
  qy=clamp(qy-c*nrm[p+1],orig[p+1]-P.by,orig[p+1]+P.by);
  qz=clamp(qz-c*nrm[p+2],orig[p+2]-P.bz,orig[p+2]+P.bz);
 }
 pos[p]=qx;pos[p+1]=qy;pos[p+2]=qz;`},
};
function smoothKernelShader(kind,workgroupSize){
 const k=SMOOTH_KERNELS[kind],decl=Object.entries(k.uses).map(([name,access])=>{const [binding,type]=SMOOTH_BINDING[name];return `@group(0) @binding(${binding}) var<storage, ${access}> ${name}:array<${type}>;`}).join('\n');
 return `
struct SmoothParams{n:u32,offB:u32,toffB:u32,adjB:u32,triB:u32,idxB:u32,pad0:u32,pad1:u32,lambda:f32,bx:f32,by:f32,bz:f32};
@group(0) @binding(0) var<uniform> P:SmoothParams;
${decl}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=P.n){return;}
${k.body}
}`;
}
export const SMOOTH_KERNEL_KINDS=Object.keys(SMOOTH_KERNELS);
// compiled while the page is idle after a series loads (data-load.js scheduleGpuPrewarm), so the first smoothed build does
// not wait for six compiles (an iPad compiles slowly); not part of GPU_PREWARM_KINDS, which the device check awaits
export const GPU_IDLE_PREWARM_KINDS=[...GPU_PREWARM_KINDS,...SMOOTH_KERNEL_KINDS];
export function smoothKernelBindings(kind){return Object.keys(SMOOTH_KERNELS[kind].uses).map(name=>({name,binding:SMOOTH_BINDING[name][0]}))}
