// CPU 3D filter kernels (fallback when WebGPU compute is not used). Pure
// computation on a volume ({columns,rows,slices,data,min,max}); parameters come
// in as arguments and progress is reported through onProgress(done,total), so
// this module has no UI dependencies and is unit-tested
// (tests/unit/cpu-filters.test.js). The loops are the former app.js
// apply* bodies, unchanged apart from reading params instead of sliders.
import { frameYield } from './utils.js?v=20261022-build642';
import { boxBlur3D } from './mask-ops.js?v=20261022-build642';
import { anisotropicLambda, spacingWeights, spacingRatios, bilateralRadii, nlmRadii } from './filter-units.js?v=20261022-build642';
export async function cpuGaussian3D(v,params,onProgress=()=>{}){
 const {columns:w,rows:h,slices:d}=v,n=w*h*d,src=v.data;
 const strength=params.strength;
 // per-axis strength s_a = s * (hmin/h_a)^2 (params.sp, else from the volume spacing; null = isotropic = s on every axis), so one pass has the same variance in mm along every axis
 const sp=params.sp||spacingWeights(v.spacing)||[1,1,1],axisStrength=[strength*sp[0],strength*sp[1],strength*sp[2]];
 let a=new Float32Array(src),b=new Float32Array(n);
 const axes=[[1,0,0],[0,1,0],[0,0,1]];
 const rounds=Math.max(1,Math.round(params.passes));
 for(let round=0;round<rounds;round++)for(let pass=0;pass<axes.length;pass++){
  const [dx,dy,dz]=axes[pass],sa=axisStrength[pass];
  for(let z=0;z<d;z++){
   for(let y=0;y<h;y++){
    const row=z*h*w+y*w;
    for(let x=0;x<w;x++){
     const i=row+x;
     const x0=Math.max(0,x-dx),x1=Math.min(w-1,x+dx);
     const y0=Math.max(0,y-dy),y1=Math.min(h-1,y+dy);
     const z0=Math.max(0,z-dz),z1=Math.min(d-1,z+dz);
     const i0=z0*h*w+y0*w+x0,i1=z1*h*w+y1*w+x1;
     const blurred=(a[i0]+2*a[i]+a[i1])*.25;
     b[i]=a[i]*(1-sa)+blurred*sa;
    }
   }
   if((z&15)===0){onProgress((round*axes.length+pass)*d+z+1,rounds*axes.length*d);await frameYield()}
  }
  const t=a;a=b;b=t;
 }
 return{data:a};
}
export async function cpuMedian3D(v,params,onProgress=()=>{}){
 const {columns:w,rows:h,slices:d}=v,n=w*h*d,src=v.data;
 const strength=params.strength;
 let a=new Float32Array(src),b=new Float32Array(n);
 const rounds=Math.max(1,Math.round(params.passes));
 const vals=new Float32Array(7);
 for(let round=0;round<rounds;round++){
  b.set(a);
  for(let z=1;z<d-1;z++){
   for(let y=1;y<h-1;y++){
    const row=z*h*w+y*w;
    for(let x=1;x<w-1;x++){
     const i=row+x;
     vals[0]=a[i];vals[1]=a[i-1];vals[2]=a[i+1];vals[3]=a[i-w];vals[4]=a[i+w];vals[5]=a[i-w*h];vals[6]=a[i+w*h];
     for(let p=1;p<7;p++){const v=vals[p];let q=p-1;while(q>=0&&vals[q]>v){vals[q+1]=vals[q];q--}vals[q+1]=v}
     const median=vals[3];
     b[i]=a[i]*(1-strength)+median*strength;
    }
   }
   if((z&7)===0){onProgress(round*d+z+1,rounds*d);await frameYield()}
  }
  const t=a;a=b;b=t;
 }
 return{data:a};
}
export async function cpuSpikeHole(v,params,onProgress=()=>{}){
 const {columns:w,rows:h,slices:d}=v,src=v.data,out=new Float32Array(src);
 const strength=params.strength;
 // the threshold is an absolute HU value (params.thresholdHU), not a fraction of v.max - v.min
 const threshold=+params.thresholdHU,edgeGuard=threshold*(.55+.35*strength);
 const correctionBlend=.20+.75*strength;
 let corrected=0;
 for(let z=1;z<d-1;z++){
  for(let y=1;y<h-1;y++){
   const row=z*h*w+y*w;
   for(let x=1;x<w-1;x++){
    const i=row+x,c=src[i];
    const ns=[src[i-1],src[i+1],src[i-w],src[i+w],src[i-w*h],src[i+w*h]];
    let sum=0,min=Infinity,max=-Infinity;for(const v of ns){sum+=v;if(v<min)min=v;if(v>max)max=v}
    const mean=sum/6,spread=max-min,diff=c-mean;
    if(spread<=edgeGuard&&Math.abs(diff)>threshold){
     const target=mean+Math.sign(diff)*threshold*.08;
     out[i]=c*(1-correctionBlend)+target*correctionBlend;corrected++;
    }
   }
  }
  if((z&7)===0){onProgress(z,d);await frameYield()}
 }
 return{data:out,corrected};
}
export async function cpuNlm3D(v,params,onProgress=()=>{}){
 const {columns:w,rows:h,slices:d}=v,src=v.data,out=new Float32Array(src);
 const hParam=+params.hHU,h2=hParam*hParam; // h in HU
 const searchRadius=Math.max(1,Math.round(params.searchRadius)),patchRadius=Math.max(0,Math.round(params.patchRadius));
 // per-axis radii round(r * hmin/h_a) (params.sp, else from the volume spacing; isotropic = the same radius on every axis)
 const {sr:[srx,sry,srz],pr:[prx,pry,prz]}=nlmRadii(searchRadius,patchRadius,spacingRatios({sp:params.sp||spacingWeights(v.spacing)}));
 const offsets=[];
 for(let dz=-srz;dz<=srz;dz++)for(let dy=-sry;dy<=sry;dy++)for(let dx=-srx;dx<=srx;dx++){
  if(dx||dy||dz)offsets.push([dx,dy,dz]);
 }
 const patch=[[0,0,0]];
 for(let r=1;r<=Math.max(prx,pry,prz);r++){if(r<=prx)patch.push([r,0,0],[-r,0,0]);if(r<=pry)patch.push([0,r,0],[0,-r,0]);if(r<=prz)patch.push([0,0,r],[0,0,-r])}
 const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 const sample=(x,y,z)=>src[clamp(z,0,d-1)*h*w+clamp(y,0,h-1)*w+clamp(x,0,w-1)];
 for(let z=0;z<d;z++){
  for(let y=0;y<h;y++){
   for(let x=0;x<w;x++){
    const center=src[z*h*w+y*w+x];
    let weighted=center,weightSum=1;
    for(const [dx,dy,dz] of offsets){
     const nx=x+dx,ny=y+dy,nz=z+dz;
     if(nx<0||ny<0||nz<0||nx>=w||ny>=h||nz>=d)continue;
     let dist2=0;
     for(const [px,py,pz] of patch){
      const a=sample(x+px,y+py,z+pz),b=sample(nx+px,ny+py,nz+pz),dv=a-b;
      dist2+=dv*dv;
     }
     dist2/=patch.length;
     const weight=Math.exp(-dist2/Math.max(h2,1e-6));
     weighted+=weight*src[nz*h*w+ny*w+nx];
     weightSum+=weight;
    }
    out[z*h*w+y*w+x]=weighted/weightSum;
   }
  }
  if((z&3)===0){onProgress(z+1,d);await frameYield()}
 }
 return{data:out,searchRadius,patchRadius};
}
export async function cpuAnisotropicDiffusion(v,params,onProgress=()=>{}){
 const {columns:w,rows:h,slices:d}=v,n=w*h*d;
 let a=new Float32Array(v.data),b=new Float32Array(n);
 const strength=params.strength;
 const kappa=+params.kappaHU,kappa2=kappa*kappa,lambda=anisotropicLambda(strength),iterations=Math.max(1,Math.round(params.iterations));
 // per-axis weights (hmin/h)^2: params.sp if given (same as the stage params), else from the volume spacing; null = isotropic = all 1
 const sp=params.sp||spacingWeights(v.spacing)||[1,1,1],weights=[sp[0],sp[0],sp[1],sp[1],sp[2],sp[2]];
 for(let iter=0;iter<iterations;iter++){
  b.set(a);
  for(let z=1;z<d-1;z++){
   for(let y=1;y<h-1;y++){
    const row=z*h*w+y*w;
    for(let x=1;x<w-1;x++){
     const i=row+x,c=a[i];
     const neighbors=[a[i-1],a[i+1],a[i-w],a[i+w],a[i-w*h],a[i+w*h]];
     let flux=0;
     for(let q=0;q<6;q++){
      const diff=neighbors[q]-c;
      const conduct=Math.exp(-(diff*diff)/Math.max(kappa2,1e-6));
      flux+=weights[q]*(conduct*diff);
     }
     b[i]=c+lambda*flux;
    }
   }
   if((z&7)===0){onProgress(iter*d+z+1,iterations*d);await frameYield()}
  }
  const t=a;a=b;b=t;
 }
 return{data:a,iterations};
}
export async function cpuBilateral3D(v,params,onProgress=()=>{}){
 const {columns:w,rows:h,slices:d}=v,n=w*h*d;
 // the intensity sigma is an absolute HU value (params.sigmaHU); it no longer depends on v.min / v.max
 const strength=params.strength,spatialSigma=params.spatialSigma,intensitySigma=Math.max(1e-6,+params.sigmaHU),passes=Math.max(1,Math.round(params.passes));
 // spatial weight in mm: exp(-sum (d_a*h_a)^2 / (2 sigma^2 hmin^2)) = exp(-sum d_a^2 / w_a / (2 sigma^2)); radius per axis clamp(ceil(1.5 sigma hmin/h_a),0,3)
 const spw=params.sp||spacingWeights(v.spacing)||[1,1,1],[rx,ry,rz]=bilateralRadii(spatialSigma,spacingRatios({sp:spw})),[ix,iy,iz]=[1/spw[0],1/spw[1],1/spw[2]],sp2=2*spatialSigma*spatialSigma,int2=2*intensitySigma*intensitySigma;
 let a=new Float32Array(v.data),b=new Float32Array(n);
 for(let pass=0;pass<passes;pass++){
  for(let z=0;z<d;z++){
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=z*h*w+y*w+x,center=a[i];let sum=0,wsum=0;
    for(let dz=-rz;dz<=rz;dz++){const zz=z+dz;if(zz<0||zz>=d)continue;
     for(let dy=-ry;dy<=ry;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;
      for(let dx=-rx;dx<=rx;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;
       const j=zz*h*w+yy*w+xx,dv=a[j]-center,sw=Math.exp(-(dx*dx*ix+dy*dy*iy+dz*dz*iz)/sp2),iw=Math.exp(-(dv*dv)/int2),ww=sw*iw;
       sum+=a[j]*ww;wsum+=ww;
      }
     }
    }
    const filtered=wsum?sum/wsum:center;b[i]=center*(1-strength)+filtered*strength;
   }
   if((z&3)===0){onProgress(pass*d+z+1,passes*d);await frameYield()}
  }
  const t=a;a=b;b=t;
 }
 return{data:a};
}
export async function cpuTvDenoising3D(v,params,onProgress=()=>{}){
 const {columns:w,rows:h,slices:d}=v,n=w*h*d,src=v.data;
 const weight=params.weight,iterations=Math.max(1,Math.round(params.iterations)),lambda=Math.min(.18,.02+weight*.45);
 let a=new Float32Array(src),b=new Float32Array(n);
 const eps=+params.epsHU; // HU
 // per-axis weights (hmin/h)^2: params.sp if given, else from the volume spacing; null = isotropic = all 1 (lambda unchanged, weights <= 1)
 const sp=params.sp||spacingWeights(v.spacing)||[1,1,1],weights=[sp[0],sp[0],sp[1],sp[1],sp[2],sp[2]];
 for(let iter=0;iter<iterations;iter++){
  b.set(a);
  for(let z=1;z<d-1;z++)for(let y=1;y<h-1;y++){
   const row=z*h*w+y*w;
   for(let x=1;x<w-1;x++){
    const i=row+x,c=a[i],ns=[a[i-1],a[i+1],a[i-w],a[i+w],a[i-w*h],a[i+w*h]];
    let flux=0;
    for(let q=0;q<6;q++){const diff=ns[q]-c;flux+=weights[q]*(diff/Math.sqrt(diff*diff+eps*eps))}
    b[i]=c+lambda*flux;
   }
   if((z&7)===0){onProgress(iter*d+z+1,iterations*d);await frameYield()}
  }
  const t=a;a=b;b=t;
 }
 return{data:a,iterations};
}
export async function cpuUnsharpMask3D(v,params,onProgress=()=>{}){
 // sp (params.sp, else from the volume spacing; null = isotropic) makes the box the same size in mm along every axis
 const src=v.data,blurred=await boxBlur3D(v,params.radius,params.sp||spacingWeights(v.spacing)),out=new Float32Array(src.length);
 const amount=params.amount,threshold=+params.thresholdHU;
 for(let i=0;i<src.length;i++){const detail=src[i]-blurred[i];out[i]=Math.abs(detail)>=threshold?src[i]+amount*detail:src[i]}
 return{data:out};
}
export async function cpuSigmoid(v,params,onProgress=()=>{}){
 const src=v.data,out=new Float32Array(src.length);
 const centerValue=+params.center,hw=Math.max(1,(+params.width||300)/2),g=Math.max(0,+params.strength||0)*6,k=g>1e-4?1/Math.tanh(g):0;
 for(let i=0;i<src.length;i++){
  const x=src[i],t=(x-centerValue)/hw;
  out[i]=k&&t>-1&&t<1?centerValue+hw*Math.tanh(g*t)*k:x;
  if((i&0x3ffff)===0){onProgress(i+1,src.length);await frameYield()}
 }
 return{data:out,centerValue};
}
