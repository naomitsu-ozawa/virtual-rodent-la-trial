// Surface smoothing of the welded voxel-face mesh (build 612): constrained, coherence-damped Laplacian smoothing.
//
// Every vertex starts on the voxel lattice and stays inside a box of +-half a voxel around that lattice point (Gibson 1998,
// constrained elastic surface nets): a staircase can relax into the slope it stands for, but a surface can never move by
// more than half a voxel, so a 1-voxel rod, plate or gap keeps its place and thickness. The Laplacian step alone would still
// shrink a rod or a rim towards its box; the shrink is coherent (every vertex around moves inward), the relaxation of a
// staircase is not (the treads move one way, the risers the other). rho = LP(delta) / LP(|delta|), the low-passed normal
// motion over its low-passed magnitude, measures that coherence in [-1, 1]; a vertex moving in the coherent direction keeps
// only (1 - |rho|) of its own normal motion, one moving against it keeps all of it.
//
// Self-contained on purpose: constrainedSmoothPositions is also run in Web Workers from its source text
// (smooth-workers.js), so it must not reference anything outside its own body.

// strength (the 0-6 slider) -> iterations K and low-pass rounds J. 1: steps down to ~30 deg go; 3: ~15 deg; 4: ~5 deg.
export const CONSTRAINED_SMOOTH_TABLE=[[0,0,8],[1,20,8],[2,40,12],[3,60,12],[4,100,20],[5,150,20],[6,150,20]];
export function constrainedSmoothSchedule(strength){
 const s=Math.max(0,Math.min(6,Number(strength)||0));
 if(s<=0)return{iterations:0,lowpass:0};
 const i=Math.min(5,Math.floor(s)),t=s-i,a=CONSTRAINED_SMOOTH_TABLE[i],b=CONSTRAINED_SMOOTH_TABLE[i+1];
 return{iterations:Math.max(1,Math.round(a[1]+(b[1]-a[1])*t)),lowpass:Math.round(a[2]+(b[2]-a[2])*t)};
}

// pos: Float32Array of welded vertex positions (smoothed in place); index: triangle vertex indices.
// opts: iterations, lowpass, lambda (0.5), rhoEvery (5: rho is re-estimated every 5 iterations), box ([hx,hy,hz] half
// sizes in the units of pos; inferred from the shortest axis-aligned edges when absent), pinned (Uint8Array, 1 = never
// moves), orig (lattice positions when pos is not on the lattice any more).
export function constrainedSmoothPositions(pos,index,opts){
 const o=opts||{},n=(pos.length/3)|0,triCount=(index.length/3)|0,K=o.iterations|0,J=Math.max(0,o.lowpass|0),lambda=o.lambda==null?.5:+o.lambda,rhoEvery=Math.max(1,o.rhoEvery|0||5),pinned=o.pinned||null;
 if(!n||!triCount||K<=0)return{iterations:0,box:null};
 // half box per axis: half the lattice step, i.e. half the shortest non-zero extent of an edge along that axis
 let bx,by,bz;
 if(o.box){bx=+o.box[0];by=+o.box[1];bz=+o.box[2]}
 else{
  let ext=0;for(let i=0;i<pos.length;i++){const a=Math.abs(pos[i]);if(a>ext)ext=a}
  const eps=Math.max(1e-30,ext*1e-6);let mx=Infinity,my=Infinity,mz=Infinity;
  for(let t=0;t<triCount*3;t+=3){
   for(let e=0;e<3;e++){
    const a=index[t+e]*3,b=index[t+(e===2?0:e+1)]*3,dx=Math.abs(pos[a]-pos[b]),dy=Math.abs(pos[a+1]-pos[b+1]),dz=Math.abs(pos[a+2]-pos[b+2]);
    if(dx>eps&&dx<mx)mx=dx;if(dy>eps&&dy<my)my=dy;if(dz>eps&&dz<mz)mz=dz;
   }
  }
  const m=Math.min(mx,my,mz);if(!Number.isFinite(m))return{iterations:0,box:null};
  bx=(Number.isFinite(mx)?mx:m)/2;by=(Number.isFinite(my)?my:m)/2;bz=(Number.isFinite(mz)?mz:m)/2;
 }
 // CSR adjacency (unique neighbours) without per-vertex objects: rows filled with duplicates, then sorted and compacted
 const off=new Uint32Array(n+1);
 for(let t=0;t<triCount*3;t++)off[index[t]+1]+=2;
 for(let i=0;i<n;i++)off[i+1]+=off[i];
 const raw=new Uint32Array(off[n]),fill=off.slice(0,n);
 for(let t=0;t<triCount*3;t+=3){
  const a=index[t],b=index[t+1],c=index[t+2];
  raw[fill[a]++]=b;raw[fill[a]++]=c;raw[fill[b]++]=c;raw[fill[b]++]=a;raw[fill[c]++]=a;raw[fill[c]++]=b;
 }
 let w=0;
 for(let i=0;i<n;i++){
  const s=off[i],e=off[i+1];
  for(let q=s+1;q<e;q++){const v=raw[q];let r=q-1;while(r>=s&&raw[r]>v){raw[r+1]=raw[r];r--}raw[r+1]=v}
  off[i]=w;let last=-1;for(let q=s;q<e;q++){const v=raw[q];if(v!==last){raw[w++]=v;last=v}}
 }
 off[n]=w;const adj=raw.slice(0,w);
 const inv=new Float32Array(n),inv1=new Float32Array(n);
 for(let i=0;i<n;i++){const d=off[i+1]-off[i];inv[i]=d?1/d:0;inv1[i]=1/(d+1)}
 const orig=o.orig||new Float32Array(pos),p1=new Float32Array(n*3),nrm=new Float32Array(n*3),del=new Float32Array(n),rho=new Float32Array(n);
 let la=J>0?new Float32Array(n*2):null,lb=J>0?new Float32Array(n*2):null;
 for(let k=0;k<K;k++){
  // area-weighted vertex normals
  nrm.fill(0);
  for(let t=0;t<triCount*3;t+=3){
   const a=index[t]*3,b=index[t+1]*3,c=index[t+2]*3,ax=pos[a],ay=pos[a+1],az=pos[a+2],ux=pos[b]-ax,uy=pos[b+1]-ay,uz=pos[b+2]-az,vx=pos[c]-ax,vy=pos[c+1]-ay,vz=pos[c+2]-az;
   const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
   nrm[a]+=nx;nrm[a+1]+=ny;nrm[a+2]+=nz;nrm[b]+=nx;nrm[b+1]+=ny;nrm[b+2]+=nz;nrm[c]+=nx;nrm[c+1]+=ny;nrm[c+2]+=nz;
  }
  // Laplacian step clamped to the box (p1) and its realised normal component (del)
  for(let i=0,p=0;i<n;i++,p+=3){
   const s=off[i],e=off[i+1];
   let nx=nrm[p],ny=nrm[p+1],nz=nrm[p+2];const l=Math.sqrt(nx*nx+ny*ny+nz*nz);
   if(l>0){nx/=l;ny/=l;nz/=l}
   nrm[p]=nx;nrm[p+1]=ny;nrm[p+2]=nz;
   const x=pos[p],y=pos[p+1],z=pos[p+2];
   if(e===s||(pinned&&pinned[i])){p1[p]=x;p1[p+1]=y;p1[p+2]=z;del[i]=0;continue}
   let sx=0,sy=0,sz=0;for(let q=s;q<e;q++){const j=adj[q]*3;sx+=pos[j];sy+=pos[j+1];sz+=pos[j+2]}
   const f=inv[i],ox=orig[p],oy=orig[p+1],oz=orig[p+2];
   let qx=x+lambda*(sx*f-x),qy=y+lambda*(sy*f-y),qz=z+lambda*(sz*f-z);
   if(qx>ox+bx)qx=ox+bx;else if(qx<ox-bx)qx=ox-bx;
   if(qy>oy+by)qy=oy+by;else if(qy<oy-by)qy=oy-by;
   if(qz>oz+bz)qz=oz+bz;else if(qz<oz-bz)qz=oz-bz;
   p1[p]=qx;p1[p+1]=qy;p1[p+2]=qz;del[i]=(qx-x)*nx+(qy-y)*ny+(qz-z)*nz;
  }
  // coherence rho = LP(delta) / LP(|delta|): J rounds of neighbourhood averaging of both at once
  if(J>0&&k%rhoEvery===0){
   for(let i=0;i<n;i++){const d=del[i];la[i*2]=d;la[i*2+1]=d<0?-d:d}
   for(let r=0;r<J;r++){
    for(let i=0;i<n;i++){
     let s0=la[i*2],s1=la[i*2+1];const e=off[i+1];
     for(let q=off[i];q<e;q++){const j=adj[q]*2;s0+=la[j];s1+=la[j+1]}
     const f=inv1[i];lb[i*2]=s0*f;lb[i*2+1]=s1*f;
    }
    const t=la;la=lb;lb=t;
   }
   for(let i=0;i<n;i++){const wv=la[i*2+1];let r=wv>0?la[i*2]/wv:0;if(r>1)r=1;else if(r<-1)r=-1;rho[i]=r}
  }
  // a vertex moving in the coherent direction cancels |rho| of its own normal motion (never more, never reversed)
  for(let i=0,p=0;i<n;i++,p+=3){
   if(pinned&&pinned[i])continue;
   const dl=del[i],r=rho[i];let qx=p1[p],qy=p1[p+1],qz=p1[p+2];
   if(dl!==0&&(dl<0)===(r<0)){
    const c=r*(dl<0?-dl:dl),ox=orig[p],oy=orig[p+1],oz=orig[p+2];
    qx-=c*nrm[p];qy-=c*nrm[p+1];qz-=c*nrm[p+2];
    if(qx>ox+bx)qx=ox+bx;else if(qx<ox-bx)qx=ox-bx;
    if(qy>oy+by)qy=oy+by;else if(qy<oy-by)qy=oy-by;
    if(qz>oz+bz)qz=oz+bz;else if(qz<oz-bz)qz=oz-bz;
   }
   pos[p]=qx;pos[p+1]=qy;pos[p+2]=qz;
  }
 }
 return{iterations:K,box:[bx,by,bz]};
}
