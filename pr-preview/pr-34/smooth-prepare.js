// The parts of a smoothed chunk around the kernel: the lattice snap, the weld, the pinned flags and the vertex
// normals. They run in the smoothing workers (smooth-workers.js) together with the kernel, so a chunk costs the main thread
// only its seam copy and core cut (smooth-chunks.js finishChunk), not ~0.5 s of weld and normals per chunk.
// Self-contained on purpose, like constrained-smooth.js: the workers run these functions from their source text, so they
// must not reference anything outside this file, and only one another by name.

// every coordinate onto the lattice of coords (xs / ys / zs: the voxel corner positions, evenly spaced): faces written by
// the GPU (f32 arithmetic) and by the CPU (Float64 tables) then weld and meet the seam planes bit for bit
export function snapToLattice(positions,coords){
 const axes=[coords.xs,coords.ys,coords.zs];
 for(let a=0;a<3;a++){
  const t=axes[a],last=t.length-1,t0=t[0],step=last>0?t[1]-t[0]:0;if(!step)continue;
  for(let i=a;i<positions.length;i+=3){let k=Math.round((positions[i]-t0)/step);if(k<0)k=0;else if(k>last)k=last;positions[i]=t[k]}
 }
 return positions;
}
// triangle soup -> {pos (unique positions, in order of first use), index}: corners with bit-equal coordinates (+0 = -0)
// become one vertex. null without a triangle corner.
export function weldTrianglePositions(positions){
 const vertexRefs=Math.floor((positions?.length||0)/3);
 if(!vertexRefs)return null;
 let tableSize=1;while(tableSize<vertexRefs*2)tableSize*=2;
 const table=new Uint32Array(tableSize),mask=tableSize-1,srcBits=new Uint32Array(positions.buffer,positions.byteOffset,positions.length);
 const unique=new Float32Array(positions.length),uniqueBits=new Uint32Array(unique.buffer),indices=new Uint32Array(vertexRefs);
 let uniqueCount=0;
 const normZero=v=>v===0x80000000?0:v;
 const hash3=(x,y,z)=>{let h=Math.imul((x^(x>>>16))>>>0,0x45d9f3b);h=(h^Math.imul((y^(y>>>16))>>>0,0x27d4eb2d))>>>0;h=(h^Math.imul((z^(z>>>16))>>>0,0x165667b1))>>>0;return(h^(h>>>16))>>>0};
 for(let v=0;v<vertexRefs;v++){
  const o=v*3,xb=normZero(srcBits[o]),yb=normZero(srcBits[o+1]),zb=normZero(srcBits[o+2]);let slot=hash3(xb,yb,zb)&mask,id=-1;
  while(table[slot]){
   const candidate=table[slot]-1,u=candidate*3;
   if(normZero(uniqueBits[u])===xb&&normZero(uniqueBits[u+1])===yb&&normZero(uniqueBits[u+2])===zb){id=candidate;break}
   slot=(slot+1)&mask;
  }
  if(id<0){id=uniqueCount++;const u=id*3;unique[u]=positions[o];unique[u+1]=positions[o+1];unique[u+2]=positions[o+2];table[slot]=id+1}
  indices[v]=id;
 }
 return{pos:unique.slice(0,uniqueCount*3),index:indices};
}
// area-weighted vertex normals, bit for bit as three.js BufferGeometry.computeVertexNormals (indexed): per triangle
// (C - B) x (A - B) in f64, summed into the f32 normals of its corners, then normalised
export function vertexNormals(pos,index){
 const n=new Float32Array(pos.length);
 for(let t=0;t+2<index.length;t+=3){
  const a=index[t]*3,b=index[t+1]*3,c=index[t+2]*3,bx=pos[b],by=pos[b+1],bz=pos[b+2];
  const cbx=pos[c]-bx,cby=pos[c+1]-by,cbz=pos[c+2]-bz,abx=pos[a]-bx,aby=pos[a+1]-by,abz=pos[a+2]-bz;
  const x=cby*abz-cbz*aby,y=cbz*abx-cbx*abz,z=cbx*aby-cby*abx;
  // all three corners read before any is written (as three.js: a corner used twice gets the triangle once)
  const ax=n[a]+x,ay=n[a+1]+y,az=n[a+2]+z,qx=n[b]+x,qy=n[b+1]+y,qz=n[b+2]+z,rx=n[c]+x,ry=n[c+1]+y,rz=n[c+2]+z;
  n[a]=ax;n[a+1]=ay;n[a+2]=az;n[b]=qx;n[b+1]=qy;n[b+2]=qz;n[c]=rx;n[c+1]=ry;n[c+2]=rz;
 }
 for(let i=0;i<n.length;i+=3){const x=n[i],y=n[i+1],z=n[i+2],s=1/(Math.sqrt(x*x+y*y+z*z)||1);n[i]=x*s;n[i+1]=y*s;n[i+2]=z*s}
 return n;
}
// a chunk's voxel-face triangles (snapped in place when lattice is given) -> {pos, index, pinned, orig} for the kernel.
// pinnedKeys: Set or array of 'x,y,z' keys of lattice points that never move (cut faces), or null.
export function prepareSmoothChunk(faces,lattice,pinnedKeys){
 if(lattice)snapToLattice(faces,lattice);
 const w=weldTrianglePositions(faces);if(!w)return null;
 const pos=w.pos,count=pos.length/3;let pinned=null;
 const keys=pinnedKeys&&(pinnedKeys.size||pinnedKeys.length)?(pinnedKeys instanceof Set?pinnedKeys:new Set(pinnedKeys)):null;
 if(keys){pinned=new Uint8Array(count);for(let i=0;i<count;i++)if(keys.has(pos[i*3]+','+pos[i*3+1]+','+pos[i*3+2]))pinned[i]=1}
 return{pos,index:w.index,pinned,orig:new Float32Array(pos)};
}
