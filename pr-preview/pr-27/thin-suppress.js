// Thin-region suppression for segments. Pure kernels, no module state.
//
// A. surfaceMm: drop segment voxels within this distance of "air": values
//    below the segment's lower bound (outside the body, gut gas, lungs). Targets the partial-volume
//    rim at air boundaries (air + tissue averaging into the fat range).
// B. thicknessMm: remove parts of the segment this thick or thinner
//    (opening by a ball of radius thicknessMm/2, in mm, via distance fields).
//
// Settings are in mm, kernels work in voxels using the voxel spacing, so the
// result is the same for reduced display textures and full-resolution export,
// and on anisotropic voxels. Processing is block-wise (z blocks, xy tiles)
// so memory stays bounded on large source-backed volumes. The work is done by
// stamping balls around boundary voxels (exact; see stampBoundary).

// Voxels at or above this value count as body; air outside the body is below.
export const BODY_MIN_HU=-500;
const INF=1e20;

export function thinSuppressActive(seg){return (+seg?.surfaceMm||0)>0||(+seg?.thicknessMm||0)>0}

// Squared Euclidean distance (mm²) from each voxel to the nearest feature
// voxel (feature[i]!==0) inside the box; INF when the box has none.
// Separable exact transform (Felzenszwalb & Huttenlocher) with per-axis spacing.
export function edtSq(feature,w,h,d,sx,sy,sz){
 const n=w*h*d,out=new Float32Array(n);
 for(let i=0;i<n;i++)out[i]=feature[i]?0:INF;
 const len=Math.max(w,h,d),f=new Float64Array(len),g=new Float64Array(len),v=new Int32Array(len),zb=new Float64Array(len+1);
 const pass=(count,stride,s2,starts)=>{
  for(const base of starts){
   for(let q=0;q<count;q++)f[q]=out[base+q*stride];
   dt1(f,count,s2,g,v,zb);
   for(let q=0;q<count;q++)out[base+q*stride]=g[q];
  }
 };
 const plane=w*h;
 if(w>1){const s=[];for(let z=0;z<d;z++)for(let y=0;y<h;y++)s.push(z*plane+y*w);pass(w,1,sx*sx,s)}
 if(h>1){const s=[];for(let z=0;z<d;z++)for(let x=0;x<w;x++)s.push(z*plane+x);pass(h,w,sy*sy,s)}
 if(d>1){const s=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++)s.push(y*w+x);pass(d,plane,sz*sz,s)}
 return out;
}
// 1D lower envelope of parabolas: g[q]=min_p f[p]+s2*(q-p)².
function dt1(f,n,s2,g,v,z){
 let k=-1;
 for(let q=0;q<n;q++){
  if(f[q]>=INF)continue;
  if(k<0){k=0;v[0]=q;z[0]=-Infinity;z[1]=Infinity;continue}
  let s;
  for(;;){const p=v[k];s=((f[q]+s2*q*q)-(f[p]+s2*p*p))/(2*s2*(q-p));if(s<=z[k]&&k>0)k--;else break}
  if(s<=z[k]){v[k]=q;z[k]=-Infinity;z[k+1]=Infinity;continue}
  k++;v[k]=q;z[k]=s;z[k+1]=Infinity;
 }
 if(k<0){for(let q=0;q<n;q++)g[q]=INF;return}
 let j=0;
 for(let q=0;q<n;q++){while(z[j+1]<q)j++;const p=v[j],dq=q-p;g[q]=f[p]+s2*dq*dq}
}

// Per-slice exterior air: non-body pixels connected to the slice border
// (enclosed air excluded). Not used by A any more; kept for reference/tests.
export function exteriorAirSlice(body,w,h){
 const out=new Uint8Array(w*h),stack=new Int32Array(w*h);let top=0;
 const push=i=>{if(!body[i]&&!out[i]){out[i]=1;stack[top++]=i}};
 for(let x=0;x<w;x++){push(x);push((h-1)*w+x)}
 for(let y=0;y<h;y++){push(y*w);push(y*w+w-1)}
 while(top){const i=stack[--top],y=(i/w)|0,x=i-y*w;if(x>0)push(i-1);if(x<w-1)push(i+1);if(y>0)push(i-w);if(y<h-1)push(i+w)}
 return out;
}

// Air = not body. The partial-volume rim forms at every air boundary (skin,
// gut gas, lungs, holder), so A uses all air, not only air outside the body.
export function airSlice(body){const out=new Uint8Array(body.length);for(let i=0;i<body.length;i++)out[i]=body[i]?0:1;return out}

// Halo in voxels per axis that a block needs around its core.
export function thinSuppressHalo(spacing,seg){
 const [sx,sy,sz]=spacing,a=Math.max(0,+seg.surfaceMm||0),r=Math.max(0,+seg.thicknessMm||0)/2;
 const axis=s=>Math.ceil(a/s)+2*Math.ceil(r/s)+1;
 return[axis(sx),axis(sy),axis(sz)];
}

// Row spans of an ellipsoid ball (squared radius r2 in mm²): [dy,dz,hx]
// means x offsets -hx..hx on row (dy,dz).
export function ballSpans(r2,sx,sy,sz){
 const out=[],r=Math.sqrt(r2),ny=Math.floor(r/sy+1e-9),nz=Math.floor(r/sz+1e-9);
 for(let dz=-nz;dz<=nz;dz++)for(let dy=-ny;dy<=ny;dy++){
  const rest=r2-(dy*sy)**2-(dz*sz)**2;if(rest<-1e-9)continue;
  out.push(dy,dz,Math.floor(Math.sqrt(Math.max(0,rest))/sx+1e-9));
 }
 return out;
}
// Write val over the ball around every feature voxel that has a non-feature
// 6-neighbour in the box. The nearest feature voxel to any non-feature voxel
// is such a boundary voxel, so this marks exactly the voxels within the ball
// radius of the feature set (the same result as a distance transform, at a
// cost proportional to the boundary, not the volume).
function stampBoundary(feature,target,w,h,d,spans,val){
 const plane=w*h;
 for(let z=0;z<d;z++)for(let y=0;y<h;y++){
  const row=z*plane+y*w;
  for(let x=0;x<w;x++){
   const i=row+x;if(!feature[i])continue;
   if(!((x>0&&!feature[i-1])||(x<w-1&&!feature[i+1])||(y>0&&!feature[i-w])||(y<h-1&&!feature[i+w])||(z>0&&!feature[i-plane])||(z<d-1&&!feature[i+plane])))continue;
   for(let k=0;k<spans.length;k+=3){
    const yy=y+spans[k],zz=z+spans[k+1];if(yy<0||yy>=h||zz<0||zz>=d)continue;
    const hx=spans[k+2],base=zz*plane+yy*w;target.fill(val,base+Math.max(0,x-hx),base+Math.min(w-1,x+hx)+1);
   }
  }
 }
}
// One box: seg and exterior are box-sized Uint8 arrays. Returns a new mask.
// A: drop voxels within surfaceMm of exterior air. B: opening by a ball of
// radius thicknessMm/2 (erode, then dilate back, within the original).
export function suppressThinBox(seg,exterior,w,h,d,spacing,opts){
 const [sx,sy,sz]=spacing,a=Math.max(0,+opts.surfaceMm||0),r=Math.max(0,+opts.thicknessMm||0)/2,n=w*h*d;
 const m=new Uint8Array(seg);
 if(a>0&&exterior){
  for(let i=0;i<n;i++)if(exterior[i])m[i]=0;
  stampBoundary(exterior,m,w,h,d,ballSpans(a*a,sx,sy,sz),0);
 }
 if(r>0){
  const spans=ballSpans(r*r,sx,sy,sz),inv=new Uint8Array(n);
  for(let i=0;i<n;i++)inv[i]=m[i]?0:1;
  const core=new Uint8Array(m);stampBoundary(inv,core,w,h,d,spans,0);
  const open=new Uint8Array(core);stampBoundary(core,open,w,h,d,spans,1);
  for(let i=0;i<n;i++)if(m[i]&&!open[i])m[i]=0;
 }
 return m;
}
// Reference implementation with exact distance transforms (tests only).
export function suppressThinBoxEdt(seg,exterior,w,h,d,spacing,opts){
 const [sx,sy,sz]=spacing,a=Math.max(0,+opts.surfaceMm||0),r=Math.max(0,+opts.thicknessMm||0)/2,n=w*h*d;
 const m=new Uint8Array(seg);
 if(a>0&&exterior){
  const dist=edtSq(exterior,w,h,d,sx,sy,sz),a2=a*a;
  for(let i=0;i<n;i++)if(m[i]&&dist[i]<=a2)m[i]=0;
 }
 if(r>0){
  const r2=r*r,inv=new Uint8Array(n);
  for(let i=0;i<n;i++)inv[i]=m[i]?0:1;
  const d1=edtSq(inv,w,h,d,sx,sy,sz),core=inv;
  for(let i=0;i<n;i++)core[i]=d1[i]>r2?1:0;
  const d2=edtSq(core,w,h,d,sx,sy,sz);
  for(let i=0;i<n;i++)if(m[i]&&d2[i]>r2)m[i]=0;
 }
 return m;
}

// Whole volume, slice by slice. segSlice(z) / bodySlice(z) return full w*h
// Uint8 slices; emit(z, mask) receives each processed slice in order.
// A generator: it yields between blocks so async callers can keep the UI
// responsive; sync callers just drain it.
export function* suppressThinStack(segSlice,bodySlice,w,h,d,spacing,opts,emit,{blockDepth=8,tile=256}={}){
 const [hx,hy,hz]=thinSuppressHalo(spacing,opts),useA=(+opts.surfaceMm||0)>0,plane=w*h,cache=new Map();
 const sliceAt=z=>{let s=cache.get(z);if(!s){const seg=segSlice(z);s={seg,ext:useA?airSlice(bodySlice(z)):null};cache.set(z,s)}return s};
 for(let z0=0;z0<d;z0+=blockDepth){
  const core=Math.min(blockDepth,d-z0),za=Math.max(0,z0-hz),zb=Math.min(d,z0+core+hz),ld=zb-za;
  for(const key of [...cache.keys()])if(key<za)cache.delete(key);
  const slices=[];for(let z=za;z<zb;z++)slices.push(sliceAt(z));
  const out=Array.from({length:core},()=>new Uint8Array(plane));
  for(let ty=0;ty<h;ty+=tile)for(let tx=0;tx<w;tx+=tile){
   const tw=Math.min(tile,w-tx),th=Math.min(tile,h-ty),xa=Math.max(0,tx-hx),xb=Math.min(w,tx+tw+hx),ya=Math.max(0,ty-hy),yb=Math.min(h,ty+th+hy),lw=xb-xa,lh=yb-ya;
   const seg=new Uint8Array(lw*lh*ld),ext=useA?new Uint8Array(lw*lh*ld):null;let any=false;
   for(let z=0;z<ld;z++)for(let y=0;y<lh;y++){
    const src=(ya+y)*w+xa,dst=(z*lh+y)*lw,s=slices[z];
    const row=s.seg.subarray(src,src+lw);seg.set(row,dst);if(!any)for(let i=0;i<lw;i++)if(row[i]){any=true;break}
    if(ext)ext.set(s.ext.subarray(src,src+lw),dst);
   }
   if(!any)continue;
   const m=suppressThinBox(seg,ext,lw,lh,ld,spacing,opts);
   for(let z=0;z<core;z++){const lz=z0+z-za;for(let y=0;y<th;y++){const src=(lz*lh+ty-ya+y)*lw+(tx-xa),dst=(ty+y)*w+tx;out[z].set(m.subarray(src,src+tw),dst)}}
  }
  for(let z=0;z<core;z++)emit(z0+z,out[z]);
  yield z0+core;
 }
}

// Full in-memory mask (Uint8 w*h*d) with source values for the body mask.
export function suppressThinMask(mask,values,w,h,d,spacing,opts,tiling){
 const plane=w*h,out=new Uint8Array(mask.length),bodyMin=Number.isFinite(+opts.min)?+opts.min:BODY_MIN_HU;
 const bodySlice=z=>{const b=new Uint8Array(plane),base=z*plane;for(let i=0;i<plane;i++)b[i]=values[base+i]>=bodyMin?1:0;return b};
 const it=suppressThinStack(z=>mask.subarray(z*plane,(z+1)*plane),bodySlice,w,h,d,spacing,opts,(z,s)=>out.set(s,z*plane),tiling);
 while(!it.next().done){}
 return out;
}
