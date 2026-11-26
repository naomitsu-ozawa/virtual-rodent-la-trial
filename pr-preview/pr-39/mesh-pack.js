// Pack surface meshes into one blob and back (for mesh-cache.js). Pure (no DOM, no three.js); unit-tested in
// tests/unit/mesh-pack.test.js.
//
// A cache entry holds every mesh of one build (a whole base surface, or one segment's run surface) as ONE blob:
//   bytes  0..23  six Uint32: [MAGIC, MESH_PACK_FORMAT, headerBytes, dataStart, checksum, totalBytes]
//   bytes 24..    header JSON (UTF-8, padded with spaces to 4 bytes): {meshes:[{key,name,editSurface,displayScale,vertices,
//                 normals,indices,bounding}]}
//   dataStart..   per mesh in order: positions Float32 (3*vertices), normals Float32 (3*vertices, when `normals`),
//                 index Uint32 (`indices`, none for a non-indexed mesh)
// Every section starts on a 4-byte boundary, so unpackMeshes() hands out Float32Array / Uint32Array VIEWS on the blob's
// buffer (no second copy of the geometry in memory). `checksum` covers everything after the header (data section).
export const MESH_PACK_FORMAT=1;
const MAGIC=0x48534d56; // 'VMSH'
const HEAD_WORDS=6;

function checksum(words){let h=0x811c9dc5;for(let i=0;i<words.length;i++)h=Math.imul(h^words[i],0x01000193);return h>>>0}

// meshes: [{key,name,editSurface,displayScale,positions:Float32Array,normals?:Float32Array|null,index?:Uint32Array|Uint16Array|null,bounding?:[x,y,z,r]|null}]
export function packedMeshBytes(meshes){
 let data=0;
 for(const m of meshes){data+=m.positions.length*4;if(m.normals)data+=m.normals.length*4;if(m.index)data+=m.index.length*4}
 return data+HEAD_WORDS*4+headerOf(meshes).length;
}
function headerOf(meshes){
 const head=JSON.stringify({meshes:meshes.map(m=>({key:m.key,name:m.name,editSurface:!!m.editSurface,displayScale:Number.isFinite(+m.displayScale)?+m.displayScale:null,
  vertices:m.positions.length/3,normals:!!m.normals,indices:m.index?m.index.length:0,indexed:!!m.index,bounding:m.bounding?[...m.bounding].map(Number):null}))});
 const bytes=new TextEncoder().encode(head),padded=new Uint8Array(Math.ceil(bytes.length/4)*4).fill(0x20);padded.set(bytes);return padded;
}
export function packMeshes(meshes){
 if(!Array.isArray(meshes)||!meshes.length)throw new Error('no meshes to pack');
 for(const m of meshes){
  if(!(m.positions instanceof Float32Array)||m.positions.length%3||!m.positions.length)throw new Error('bad mesh positions');
  if(m.normals&&m.normals.length!==m.positions.length)throw new Error('bad mesh normals');
  if(m.index&&(m.index.length%3||!m.index.length))throw new Error('bad mesh index');
 }
 const head=headerOf(meshes),dataStart=HEAD_WORDS*4+head.length;let total=dataStart;
 for(const m of meshes){total+=m.positions.length*4;if(m.normals)total+=m.normals.length*4;if(m.index)total+=m.index.length*4}
 const buffer=new ArrayBuffer(total),u32=new Uint32Array(buffer),f32=new Float32Array(buffer);
 new Uint8Array(buffer,HEAD_WORDS*4,head.length).set(head);
 let at=dataStart/4;
 for(const m of meshes){
  f32.set(m.positions,at);at+=m.positions.length;
  if(m.normals){f32.set(m.normals,at);at+=m.normals.length}
  if(m.index){u32.set(m.index,at);at+=m.index.length}
 }
 u32[0]=MAGIC;u32[1]=MESH_PACK_FORMAT;u32[2]=head.length;u32[3]=dataStart;u32[4]=checksum(u32.subarray(dataStart/4));u32[5]=total;
 return new Uint8Array(buffer);
}
// null when the blob is damaged or from another layout: the caller drops the entry and builds the mesh the normal way
export function unpackMeshes(bytes,{maxVertices=Infinity}={}){
 try{
  let buf=bytes instanceof Uint8Array?bytes:bytes instanceof ArrayBuffer?new Uint8Array(bytes):null;if(!buf)return null;
  if(buf.byteLength%4||buf.byteLength<HEAD_WORDS*4)return null;
  // views need a 4-byte aligned start (a blob read from IndexedDB is its own buffer at offset 0: no copy then)
  if(buf.byteOffset%4)buf=buf.slice();
  const u32=new Uint32Array(buf.buffer,buf.byteOffset,buf.byteLength/4),headBytes=u32[2],dataStart=u32[3];
  if(u32[0]!==MAGIC||u32[1]!==MESH_PACK_FORMAT||u32[5]!==buf.byteLength||headBytes%4||dataStart!==HEAD_WORDS*4+headBytes||dataStart>buf.byteLength)return null;
  if(checksum(u32.subarray(dataStart/4))!==u32[4])return null;
  const head=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf.subarray(HEAD_WORDS*4,dataStart)));
  if(!Array.isArray(head?.meshes)||!head.meshes.length)return null;
  const f32=new Float32Array(buf.buffer,buf.byteOffset,buf.byteLength/4),out=[];let at=dataStart/4;
  for(const h of head.meshes){
   if(typeof h?.key!=='string'||typeof h.name!=='string'||!Number.isInteger(h.vertices)||h.vertices<=0||h.vertices>maxVertices||!Number.isInteger(h.indices)||h.indices<0||h.indices%3)return null;
   if(!!h.indexed!==(h.indices>0))return null;
   const pEnd=at+h.vertices*3,nEnd=pEnd+(h.normals?h.vertices*3:0),iEnd=nEnd+h.indices;if(iEnd>u32.length)return null;
   const positions=f32.subarray(at,pEnd),normals=h.normals?f32.subarray(pEnd,nEnd):null,index=h.indices?u32.subarray(nEnd,iEnd):null;
   for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))return null;
   if(normals)for(let i=0;i<normals.length;i++)if(!Number.isFinite(normals[i]))return null;
   if(index)for(let i=0;i<index.length;i++)if(index[i]>=h.vertices)return null;
   let bounding=null;if(h.bounding!=null){if(!Array.isArray(h.bounding)||h.bounding.length!==4||!h.bounding.every(Number.isFinite))return null;bounding=h.bounding}
   out.push({key:h.key,name:h.name,editSurface:!!h.editSurface,displayScale:h.displayScale,positions,normals,index,bounding});at=iEnd;
  }
  return at===u32.length?out:null;
 }catch{return null}
}
