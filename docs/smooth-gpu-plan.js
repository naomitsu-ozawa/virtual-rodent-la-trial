// The constrained surface smoothing on the GPU (build 612), the part without a device: the mesh topology as the kernels
// read it (SMOOTH_KERNELS, gpu-shaders.js) and the order of their dispatches. smooth-gpu.js uploads and dispatches; the
// unit test runs the same plan with the kernel bodies on the CPU. Same algorithm as constrainedSmoothPositions
// (constrained-smooth.js); the GPU computes in f32 throughout, the CPU in f64 between the f32 arrays, so the results
// agree to ~1e-5 voxel, not bit for bit.

// index: triangle vertex indices of a welded mesh of n vertices; pinned: Uint8Array (1 = never moves) or null.
// topoA: [off (n+1) | toff (n+1) | adj] (off: CSR of the unique neighbours, sorted; toff: CSR of the triangles at a vertex,
// in triangle order, as the CPU sums the normals), topoB: [first index slot of every vertex-triangle incidence | index],
// invs: per vertex (1/degree, 0 when pinned or isolated: the vertex stays; 1/(degree+1) for the low-pass).
export function buildSmoothTopology(index,n,pinned=null){
 const triCount=(index.length/3)|0,slots=triCount*3;
 // unique neighbours (the CPU kernel's construction): rows filled with duplicates, then sorted and compacted
 const off=new Uint32Array(n+1);
 for(let t=0;t<slots;t++)off[index[t]+1]+=2;
 for(let i=0;i<n;i++)off[i+1]+=off[i];
 const raw=new Uint32Array(off[n]),fill=off.slice(0,n);
 for(let t=0;t<slots;t+=3){
  const a=index[t],b=index[t+1],c=index[t+2];
  raw[fill[a]++]=b;raw[fill[a]++]=c;raw[fill[b]++]=c;raw[fill[b]++]=a;raw[fill[c]++]=a;raw[fill[c]++]=b;
 }
 let w=0;
 for(let i=0;i<n;i++){
  const s=off[i],e=off[i+1];
  for(let q=s+1;q<e;q++){const v=raw[q];let r=q-1;while(r>=s&&raw[r]>v){raw[r+1]=raw[r];r--}raw[r+1]=v}
  off[i]=w;let last=-1;for(let q=s;q<e;q++){const v=raw[q];if(v!==last){raw[w++]=v;last=v}}
 }
 off[n]=w;
 const offB=0,toffB=n+1,adjB=2*n+2,topoA=new Uint32Array(adjB+w);
 topoA.set(off,offB);topoA.set(raw.subarray(0,w),adjB);
 // triangles at each vertex, in triangle order
 const toff=topoA.subarray(toffB,toffB+n+1);
 for(let t=0;t<slots;t++)toff[index[t]+1]++;
 for(let i=0;i<n;i++)toff[i+1]+=toff[i];
 const triB=0,idxB=slots,topoB=new Uint32Array(slots*2),tfill=toff.slice(0,n);
 for(let t=0;t<slots;t+=3){topoB[triB+tfill[index[t]]++]=t;topoB[triB+tfill[index[t+1]]++]=t;topoB[triB+tfill[index[t+2]]++]=t}
 topoB.set(index.subarray?index.subarray(0,slots):index.slice(0,slots),idxB);
 const invs=new Float32Array(n*2);
 for(let i=0;i<n;i++){const d=off[i+1]-off[i];invs[i*2]=d&&!(pinned&&pinned[i])?1/d:0;invs[i*2+1]=1/(d+1)}
 return{topoA,topoB,invs,params:{n,offB,toffB,adjB,triB,idxB}};
}
// the uniform block SmoothParams (SMOOTH_PARAMS_WORDS words)
export function smoothParamsWords(params,lambda,box){
 const buf=new ArrayBuffer(48),u=new Uint32Array(buf),f=new Float32Array(buf);
 u[0]=params.n;u[1]=params.offB;u[2]=params.toffB;u[3]=params.adjB;u[4]=params.triB;u[5]=params.idxB;
 f[8]=lambda;f[9]=box[0];f[10]=box[1];f[11]=box[2];
 return buf;
}
// the dispatches of one iteration k: normals, Laplacian step, (every rhoEvery iterations: the low-pass, J rounds between la
// and lb, and rho), the coherence step. swap: la / lb exchanged in the bindings (round r reads lb when r is odd; rho reads
// the buffer the last round wrote).
export function smoothIterationPlan(k,lowpass,rhoEvery){
 const J=Math.max(0,lowpass|0),steps=[{kind:'smoothNormals'},{kind:'smoothLaplace'}];
 if(J>0&&k%Math.max(1,rhoEvery|0)===0){
  steps.push({kind:'smoothLowpassInit'});
  for(let r=0;r<J;r++)steps.push({kind:'smoothLowpass',swap:r%2===1});
  steps.push({kind:'smoothRho',swap:J%2===1});
 }
 steps.push({kind:'smoothApply'});
 return steps;
}
// bytes the GPU holds for a mesh of n vertices and its topology (the job's buffers): checked against the device limits
export function smoothGpuBytes(topology){
 const n=topology.params.n;
 return{largest:Math.max(topology.topoA.byteLength,topology.topoB.byteLength,n*12),total:topology.topoA.byteLength+topology.topoB.byteLength+topology.invs.byteLength+n*12*5+n*8*3+48};
}
