// three.js side of the mesh cache (mesh-cache-apply.js): meshes -> descriptors for the blob (mesh-pack.js) and back. DOM-free,
// so the unit tests can run it in Node.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import { createSurfaceMaterial } from './mesh-material.js?v=20261021-build634';
// meshes under root -> blob descriptors, or null when any of them is not a plain mesh this cache can reproduce exactly
// (GPU-resident positions, several materials, geometry groups, a draw range, extra attributes)
export function describeMeshes(root){
 const out=[];let ok=true;
 root?.traverse?.(o=>{
  if(!ok||!o.isMesh)return;
  const g=o.geometry,pos=g?.getAttribute?.('position'),nor=g?.getAttribute?.('normal'),key=o.userData?.segmentKey;
  if(o.userData?.gpuResident||Array.isArray(o.material)||typeof key!=='string'||!pos||pos.isInterleavedBufferAttribute||!(pos.array instanceof Float32Array)||pos.itemSize!==3||pos.array.length!==pos.count*3||!pos.count){ok=false;return}
  if(Object.keys(g.attributes).some(n=>n!=='position'&&n!=='normal')||g.groups?.length||g.drawRange.start!==0||g.drawRange.count!==Infinity){ok=false;return}
  if(nor&&(nor.isInterleavedBufferAttribute||!(nor.array instanceof Float32Array)||nor.itemSize!==3||nor.array.length!==pos.array.length)){ok=false;return}
  const index=g.index?g.index.array:null;
  if(g.index&&(!(index instanceof Uint32Array||index instanceof Uint16Array)||g.index.count!==index.length||index.length%3)){ok=false;return}
  const bs=g.boundingSphere;
  out.push({key,name:o.name,editSurface:!!o.userData.editSurface,displayScale:o.userData.displayScale,positions:pos.array,normals:nor?nor.array:null,index,bounding:bs?[bs.center.x,bs.center.y,bs.center.z,bs.radius]:null});
 });
 return ok&&out.length?out:null;
}
// stored meshes -> three.js meshes (materials from the CURRENT segment colour / opacity, never stored); null when an entry
// names a segment this session does not have. The attributes are views on the blob read from storage: no second copy.
export function meshesFromEntry(entry,paramsFor){
 const meshes=[];
 for(const d of entry.meshes){
  const params=paramsFor(d.key);if(!params){for(const m of meshes)m.geometry.dispose();return null}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(d.positions,3));
  if(d.normals)g.setAttribute('normal',new THREE.BufferAttribute(d.normals,3));
  if(d.index)g.setIndex(new THREE.BufferAttribute(d.index,1));
  if(d.bounding)g.boundingSphere=new THREE.Sphere(new THREE.Vector3(d.bounding[0],d.bounding[1],d.bounding[2]),d.bounding[3]);else g.computeBoundingSphere();
  const mesh=new THREE.Mesh(g,createSurfaceMaterial(params,d.key));
  mesh.name=d.name;mesh.userData.segmentKey=d.key;if(d.editSurface)mesh.userData.editSurface=true;if(d.displayScale!=null)mesh.userData.displayScale=d.displayScale;
  meshes.push(mesh);
 }
 return meshes;
}
