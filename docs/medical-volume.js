import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js';
import dicomParser from 'https://esm.sh/dicom-parser@1.8.21';
import { canvasBackground3dUnit } from './canvas-theme.js?v=20261028-build686';
import { lightOffsetExpr, lightingWGSL, MATERIALS, materialKey } from './lighting.js?v=20261028-build686';
import { EDIT_MASK_MAX_BYTES, editMaskInfoWord, editMaskLayout, editMaskPlanes, fillEditMaskWords, sameU32 } from './edit-mask-texture.js?v=20261028-build686';
import { loadStats } from './load-stats.js?v=20261028-build686'; // what the load did, for the VR switch report
import { frameOrTimer } from './utils.js?v=20261028-build686'; // rAF or a timer (the window rAF stands still during a WebXR session)
import { gpuRunsForTexture } from './gpu-runs.js?v=20261028-build686'; // the run-mapping functions moved to their own module (the VR preparation worker is made from them)
export { gpuRunsForTexture };

const UNCOMPRESSED_TS=new Set(['1.2.840.10008.1.2','1.2.840.10008.1.2.1','1.2.840.10008.1.2.2']);
const safeWgsl=source=>source.replace(/\bmeta\b/g,'vrlMeta').replace(/\bactive\b/g,'vrlActive').replace(/\btarget\b/g,'vrlTarget');

async function rawPixelBytes(meta){
 if(meta.bits!==16||meta.samples!==1)throw new Error('GPU volume requires single-channel 16-bit DICOM');
 if(!UNCOMPRESSED_TS.has(meta.ts))throw new Error('GPU volume currently requires uncompressed DICOM');
 const bytesNeeded=meta.rows*meta.columns*2;
 if(meta.pixelOffset!=null){
  const bytes=new Uint8Array(await meta.file.slice(meta.pixelOffset,meta.pixelOffset+bytesNeeded).arrayBuffer());
  if(bytes.byteLength<bytesNeeded)throw new Error('Pixel Data is shorter than expected');
  return bytes;
 }
 const all=new Uint8Array(await meta.file.arrayBuffer()),ds=dicomParser.parseDicom(all),el=ds.elements.x7fe00010;
 if(!el)throw new Error('Pixel Data missing');
 return all.slice(el.dataOffset,el.dataOffset+bytesNeeded);
}

export async function packedRgSlice(meta){
 const src=await rawPixelBytes(meta),little=meta.ts!=='1.2.840.10008.1.2.2';
 const signed=!!meta.signed,bitsStored=Math.max(1,Math.min(16,meta.bitsStored||16)),highBit=Number.isFinite(meta.highBit)?meta.highBit:bitsStored-1,lowBit=Math.max(0,highBit-bitsStored+1);
 const fastUnsigned=little&&!signed&&lowBit===0;
 if(fastUnsigned)return src;
 const out=new Uint8Array(src.byteLength),view=new DataView(src.buffer,src.byteOffset,src.byteLength),mask=bitsStored===16?0xffff:(1<<bitsStored)-1,signBit=1<<(bitsStored-1);
 for(let i=0;i<meta.rows*meta.columns;i++){
  let word=view.getUint16(i*2,little);
  if(lowBit)word>>=lowBit;
  word&=mask;
  let encoded;
  if(signed){
   const value=(word&signBit)?word-(bitsStored===16?65536:(1<<bitsStored)):word;
   encoded=(value+32768)&0xffff;
  }else encoded=word;
  out[i*2]=encoded&255;out[i*2+1]=encoded>>>8;
 }
 return out;
}

// Pack one axial slice of CT values (e.g. a filtered slice) into the same rg8
// 16-bit encoding as packedRgSlice, so the shaders decode it with the series
// calibration unchanged: stored = round((ct - intercept) / slope) + bias.
export function packCtSlice(values,calibration){
 const n=values.length,out=new Uint8Array(n*2);
 const slope=calibration.slope||1,intercept=calibration.intercept||0,bias=calibration.signed?32768:0;
 for(let i=0;i<n;i++){
  let w=Math.round((values[i]-intercept)/slope)+bias;
  w=w<0?0:(w>65535?65535:w);
  out[i*2]=w&255;out[i*2+1]=w>>>8;
 }
 return out;
}

export function volumeShader(){
 return `
struct Uniforms{
 camOrigin:vec4<f32>,
 camRightTan:vec4<f32>,
 camUpAspect:vec4<f32>,
 camForward:vec4<f32>,
 halfStep:vec4<f32>,
 dimsSlope:vec4<f32>,
 calibration:vec4<f32>,
 viewport:vec4<f32>,
 segments:array<vec4<f32>,8>,
 mprIndices:vec4<f32>,
 mprVisible:vec4<f32>,
 mprWindow:vec4<f32>,
 section:vec4<f32>,
 sectionCap:vec4<f32>,
 textureDims:vec4<f32>,
 background:vec4<f32>,
 segMat:array<vec4<f32>,4>
};
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var volumeTex:texture_3d<f32>;
@group(0) @binding(2) var<storage,read> editRows:array<u32>;
@group(0) @binding(3) var<storage,read> brickMinMax:array<vec2<f32>>;
@group(0) @binding(4) var volumeSampler:sampler;
@group(0) @binding(5) var<storage,read> editIntervals:array<u32>;
@group(0) @binding(6) var<storage,read> previewRows:array<u32>;
@group(0) @binding(7) var<storage,read> previewIntervals:array<u32>;
@group(0) @binding(8) var<storage,read> appliedCutRows:array<u32>;
@group(0) @binding(9) var<storage,read> appliedCutIntervals:array<u32>;
// Volume-analysis regions drawn in the volume itself (no mesh). One buffer so
// the fragment stage stays within 8 storage buffers: [0]=1 when non-empty,
// [1..rowCount+1]=offsets into this array, then (x0|x1<<16, rgb|flags) pairs.
@group(0) @binding(10) var<storage,read> analysisOverlay:array<u32>;
// region index per voxel, 4 bits each, 8 voxels per u32 along x
// (0 none, 1..14 = shown region, 15 = more regions: search the row). One
// texture load replaces the binary search of the row's run pairs at every
// hit. section.w = 1 when the texture is valid. analysisOverlay[0] is then the
// start of the colour table (index k -> word), or 0 when there is no region.
@group(0) @binding(11) var regionTex:texture_3d<u32>;
// edit / applied-cut voxel bit mask (edit-mask-texture.js): the interval membership of editIntervals /
// appliedCutIntervals for every voxel of the texture grid, so a masked sample costs one texture load instead of a binary
// search. mprWindow.z = bits per voxel + 256 * log2(texture width) (0 = no texture: the row search below, unchanged),
// mprWindow.w = plane table (3 bits per entry: edit slot s, then cut slot 4 + s).
@group(0) @binding(12) var editMaskTex:texture_3d<u32>;

struct VOut{@builtin(position) position:vec4<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->VOut{
 var p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
 var o:VOut;o.position=vec4<f32>(p[i],0.0,1.0);return o;
}
fn hitBox(orig:vec3<f32>,dir:vec3<f32>,halfBox:vec3<f32>)->vec2<f32>{
 let inv=1.0/dir;
 let a=(-halfBox-orig)*inv;let b=(halfBox-orig)*inv;
 let lo=min(a,b);let hi=max(a,b);
 return vec2<f32>(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));
}
// Box faces: the box face the ray enters through, as the OUTWARD unit normal (towards the viewer, volume space). A surface hit on the
// face itself (tissue reaches the edge of the volume: a cropped / cut scan) has no iso-surface there, so the HU gradient is only noise
// (one-sided, clamped at the edge) and the cut face rendered as a porous granular patch with the inside showing through. It is shaded as
// the flat face it is.
fn entryFaceNormal(orig:vec3<f32>,dir:vec3<f32>,halfBox:vec3<f32>)->vec3<f32>{
 let inv=1.0/dir;
 let a=(-halfBox-orig)*inv;let b=(halfBox-orig)*inv;
 let lo=min(a,b);
 var n=vec3<f32>(0.0);
 if(lo.x>=lo.y&&lo.x>=lo.z){n.x=-sign(dir.x);}else if(lo.y>=lo.z){n.y=-sign(dir.y);}else{n.z=-sign(dir.z);}
 return n;
}
fn texCoord(p:vec3<f32>)->vec3<f32>{
 return vec3<f32>(p.x/(2.0*u.halfStep.x)+0.5,0.5-p.y/(2.0*u.halfStep.y),p.z/(2.0*u.halfStep.z)+0.5);
}
fn huAt(tc0:vec3<f32>)->f32{
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 var q:vec2<f32>;
 if(u.textureDims.w>0.5){
  q=textureSampleLevel(volumeTex,volumeSampler,tc,0.0).rg*255.0;
 }else{
  let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
  q=round(textureLoad(volumeTex,vec3<i32>(p),0).rg*255.0);
 }
 let raw=q.x+q.y*256.0-u.calibration.y;
 return raw*u.dimsSlope.w+u.calibration.x;
}
fn maskVoxelAt(tc0:vec3<f32>)->vec3<u32>{
 let src=vec3<u32>(u32(u.dimsSlope.x),u32(u.dimsSlope.y),u32(u.dimsSlope.z));
 let tex=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 if(all(src==tex)){return min(vec3<u32>(tc*vec3<f32>(src)),src-vec3<u32>(1u));}
 let tp=min(vec3<u32>(tc*vec3<f32>(tex)),tex-vec3<u32>(1u));
 let sx=u32(round(f32(tp.x)*f32(max(src.x-1u,1u))/f32(max(tex.x-1u,1u))));
 let sy=u32(round(f32(tp.y)*f32(max(src.y-1u,1u))/f32(max(tex.y-1u,1u))));
 let sz=u32(round(f32(tp.z)*f32(max(src.z-1u,1u))/f32(max(tex.z-1u,1u))));
 return min(vec3<u32>(sx,sy,sz),src-vec3<u32>(1u));
}
// bit "plane" of voxel p in editMaskTex (layout: edit-mask-texture.js; editMaskBit there is the CPU copy)
fn editMaskBit(plane:u32,p:vec3<u32>)->bool{
 let info=u32(u.mprWindow.z);let l=countTrailingZeros(info&255u);let lw=info>>8u;let lv=5u-l;
 let wpr=(u32(u.textureDims.x)+(1u<<lv)-1u)>>lv;let i=p.y*wpr+(p.x>>lv);
 let word=textureLoad(editMaskTex,vec3<i32>(i32(i&((1u<<lw)-1u)),i32(i>>lw),i32(p.z)),0).r;
 return ((word>>(((p.x&((1u<<lv)-1u))<<l)+plane))&1u)!=0u;
}
// entry k: plane of edit slot k (k < 4) or of cut slot k - 4; an unused slot reads 0, so callers test editRows[0] / appliedCutRows[0] first
fn editMaskPlane(k:u32)->u32{return (u32(u.mprWindow.w)>>(3u*k))&7u;}
fn editAllows(seg:u32,tc0:vec3<f32>)->bool{
 let activeMask=editRows[0];if((activeMask&(1u<<seg))==0u){return true;}
 let keepMask=editRows[1];
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
 var inside=false;
 // one load from the mask texture when it is there (the same voxel decision as the search below)
 if(u.mprWindow.z>0.5){inside=editMaskBit(editMaskPlane(seg),p);}else{
 let rowCount=dims.y*dims.z;
 let base=2u+seg*(rowCount+1u);
 let row=p.z*dims.y+p.y;
 let start=editRows[base+row];
 let finish=editRows[base+row+1u];
 // intervals are sorted and disjoint per row: binary search for the last one
 // starting at or before p.x (a linear scan cost tens of reads per sample on
 // rows with many intervals, e.g. a processed fat segment)
 var lo=start;var hi=finish;
 loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if((editIntervals[mid]&65535u)<=p.x){lo=mid+1u;}else{hi=mid;}}
 if(lo>start){inside=p.x<=(editIntervals[lo-1u]>>16u);}
 }
 let keep=(keepMask&(1u<<seg))!=0u;return select(!inside,inside,keep);
}
// a segment whose mask can hold voxels outside its HU range (Closing / hole filling added them, and a higher
// segment's added voxels are removed from it) is decided by the mask alone, as the 2D views do: bit 4+s of editRows[1]
fn segMember(s:u32,v:f32,a:vec4<f32>,tc:vec3<f32>)->bool{
 if(a.w<=0.5){return false;}
 if((editRows[1]&(16u<<s))!=0u){return editAllows(s,tc);}
 return v>=a.x&&v<=a.y&&editAllows(s,tc);
}
fn previewContains(seg:u32,tc0:vec3<f32>)->bool{
 let target=previewRows[0];if(target==0u||target!=seg+1u){return false;}
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
 let row=p.z*dims.y+p.y;
 let start=previewRows[1u+row];
 let finish=previewRows[2u+row];
 // binary search for the last interval starting at or before p.x
 // (a fat region has hundreds of intervals per row; the linear scan ran once
 // per hit pixel and dominated the frame when zoomed in)
 var lo=start;var hi=finish;
 loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if((previewIntervals[mid]&65535u)<=p.x){lo=mid+1u;}else{hi=mid;}}
 if(lo>start){return p.x<=(previewIntervals[lo-1u]>>16u);}
 return false;
}
fn regionIndexAt(tc0:vec3<f32>)->u32{
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
 let word=textureLoad(regionTex,vec3<i32>(i32(p.x>>3u),i32(p.y),i32(p.z)),0).r;
 return (word>>((p.x&7u)*4u))&15u;
}
fn analysisOverlayRow(tc0:vec3<f32>)->u32{
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
 let row=p.z*dims.y+p.y;
 let start=analysisOverlay[1u+row];
 let finish=analysisOverlay[2u+row];
 // pairs (x0|x1<<16, colour) sorted by x0 per row (setAnalysisRuns): binary search
 var lo=start/2u;var hi=finish/2u;
 loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if((analysisOverlay[mid*2u]&65535u)<=p.x){lo=mid+1u;}else{hi=mid;}}
 if(lo>start/2u){let i=(lo-1u)*2u;if(p.x<=(analysisOverlay[i]>>16u)){return analysisOverlay[i+1u];}}
 return 0u;
}
fn analysisOverlayAt(tc0:vec3<f32>)->u32{
 if(analysisOverlay[0]==0u){return 0u;}
 if(u.section.w>0.5){
  let k=regionIndexAt(tc0);
  if(k==0u){return 0u;}
  if(k<15u){return analysisOverlay[analysisOverlay[0]+k];}
 }
 return analysisOverlayRow(tc0);
}
// region colour near a surface hit from the index texture alone:
// the hit voxel first, then the candidates insideVoxelTc would try (the hit
// lies between the inside and the outside voxel). No HU fetches; a coloured
// hit costs one texture load.
fn regionOverlayNear(tc0:vec3<f32>,dir:vec3<f32>,inward:vec3<f32>)->u32{
 let di=objToTc(inward);let dr=objToTc(dir);
 // candidates in order: tc0, +di*0.5, +di*1.0, +dr*0.5, +dr*1.0, +di*1.5 (one loop body: the inlined code stays small)
 var p=tc0;var r=0u;
 for(var k:u32=0u;k<6u;k=k+1u){
  p=tc0+select(di,dr,k==3u||k==4u)*(0.5*f32(k)-select(0.0,1.0,k>=3u));
  r=regionIndexAt(p);if(r!=0u){break;}
 }
 if(r==0u){return 0u;}
 if(r<15u){return analysisOverlay[analysisOverlay[0]+r];}
 return analysisOverlayRow(p);
}
fn appliedCutContains(seg:u32,tc0:vec3<f32>)->bool{
 let activeMask=appliedCutRows[0];
 if((activeMask&(1u<<seg))==0u){return false;}
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
 let rowCount=dims.y*dims.z;
 let base=1u+seg*(rowCount+1u);
 let row=p.z*dims.y+p.y;
 if(u.mprWindow.z>0.5){return editMaskBit(editMaskPlane(4u+seg),p);}
 let start=appliedCutRows[base+row];
 let finish=appliedCutRows[base+row+1u];
 var lo=start;var hi=finish;
 loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if((appliedCutIntervals[mid]&65535u)<=p.x){lo=mid+1u;}else{hi=mid;}}
 if(lo>start){return p.x<=(appliedCutIntervals[lo-1u]>>16u);}
 return false;
}
fn appliedCutNormal(seg:u32,tc0:vec3<f32>)->vec3<f32>{
 let dims=max(u.textureDims.xyz,vec3<f32>(1.0));
 let d=vec3<f32>(1.0/dims.x,1.0/dims.y,1.0/dims.z);
 let gx=select(0.0,1.0,appliedCutContains(seg,tc0+vec3<f32>(d.x,0.0,0.0)))-select(0.0,1.0,appliedCutContains(seg,tc0-vec3<f32>(d.x,0.0,0.0)));
 let gy=select(0.0,1.0,appliedCutContains(seg,tc0+vec3<f32>(0.0,d.y,0.0)))-select(0.0,1.0,appliedCutContains(seg,tc0-vec3<f32>(0.0,d.y,0.0)));
 let gz=select(0.0,1.0,appliedCutContains(seg,tc0+vec3<f32>(0.0,0.0,d.z)))-select(0.0,1.0,appliedCutContains(seg,tc0-vec3<f32>(0.0,0.0,d.z)));
 let voxel=2.0*u.halfStep.xyz/dims;
 let g=vec3<f32>(gx/max(voxel.x,1e-6),-gy/max(voxel.y,1e-6),gz/max(voxel.z,1e-6));
 let l=length(g);
 if(l<1e-6){return vec3<f32>(0.0,0.0,1.0);}
 return g/l;
}
// the segment tests take the HU value, so one texture fetch per
// sample serves both the raw index and the edited index (was two fetches)
fn rawSegmentIndexFor(v:f32)->i32{
 for(var s:u32=0u;s<4u;s=s+1u){
  let a=u.segments[s*2u];
  if(a.w>0.5&&v>=a.x&&v<=a.y){return i32(s);}
 }
 return -1;
}
// whether voxels x and x+1 of a row lie inside the segment's edit intervals (one binary search)
fn editInsidePair(seg:u32,row:u32,x:u32)->vec2<bool>{
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 // two bits of the mask texture (x + 1 past the row's end is outside, as in the search; the caller ignores it there)
 if(u.mprWindow.z>0.5){let pl=editMaskPlane(seg);let p=vec3<u32>(x,row%dims.y,row/dims.y);return vec2<bool>(editMaskBit(pl,p),x+1u<dims.x&&editMaskBit(pl,p+vec3<u32>(1u,0u,0u)));}
 let rowCount=dims.y*dims.z;
 let base=2u+seg*(rowCount+1u);
 let start=editRows[base+row];
 let finish=editRows[base+row+1u];
 var lo=start;var hi=finish;
 loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if((editIntervals[mid]&65535u)<=x){lo=mid+1u;}else{hi=mid;}}
 var in0=false;var in1=false;
 if(lo>start){let x1=editIntervals[lo-1u]>>16u;in0=x<=x1;in1=x+1u<=x1;}
 if(!in1&&lo<finish){in1=(editIntervals[lo]&65535u)==x+1u;}
 return vec2<bool>(in0,in1);
}
// an excluded voxel must not leak into the neighbouring samples through the
// trilinear interpolation (a deleted noisy blob stayed as a ghost cloud of face-aligned
// slivers; the same). For a segment with an exclude-mode mask, a sample
// that passed the raw range and its own voxel's mask is re-evaluated with the excluded
// corner voxels of its interpolation cell replaced by air. Keep-mode (processed) masks
// are unchanged.
fn excludeMaskedInside(seg:u32,tc:vec3<f32>,a:vec4<f32>)->bool{
 let dims=vec3<f32>(u.textureDims.xyz);
 let q=tc*dims-vec3<f32>(0.5);
 let f0=floor(q);let fr=q-f0;
 let maxI=vec3<i32>(dims)-vec3<i32>(1);
 var allowed=array<bool,8>(true,true,true,true,true,true,true,true);
 var any=false;
 for(var k:u32=0u;k<4u;k=k+1u){
  let oy=i32(k&1u);let oz=i32(k>>1u);
  let cy=clamp(i32(f0.y)+oy,0,maxI.y);let cz=clamp(i32(f0.z)+oz,0,maxI.z);
  let cx=clamp(i32(f0.x),0,maxI.x);
  let pair=editInsidePair(seg,u32(cz)*u32(dims.y)+u32(cy),u32(cx));
  let a0=!pair.x;let a1=select(!pair.y,!pair.x,cx==maxI.x);
  allowed[k*2u]=a0;allowed[k*2u+1u]=a1;
  if(!a0||!a1){any=true;}
 }
 if(!any){return true;}
 var acc=0.0;
 for(var k:u32=0u;k<8u;k=k+1u){
  let o=vec3<i32>(i32(k&1u),i32((k>>1u)&1u),i32(k>>2u));
  let ci=clamp(vec3<i32>(f0)+o,vec3<i32>(0),maxI);
  let w=select(1.0-fr.x,fr.x,o.x==1)*select(1.0-fr.y,fr.y,o.y==1)*select(1.0-fr.z,fr.z,o.z==1);
  let ctc=(vec3<f32>(ci)+vec3<f32>(0.5))/dims;
  acc=acc+w*select(-10000.0,huVoxel(ctc),allowed[k]);
 }
 return acc>=a.x&&acc<=a.y;
}
fn segmentIndexFor(v:f32,tc0:vec3<f32>)->i32{
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let excludeMode=editRows[0]&~editRows[1];
 for(var s:u32=0u;s<4u;s=s+1u){
  let a=u.segments[s*2u];
  if(segMember(s,v,a,tc)){
   if((excludeMode&(1u<<s))!=0u&&!excludeMaskedInside(s,tc,a)){continue;}
   return i32(s);
  }
 }
 return -1;
}
fn rawSegmentIndexAt(tc0:vec3<f32>)->i32{return rawSegmentIndexFor(huAt(tc0));}
// the voxel the run tables (analysis regions, cut preview) count as
// inside. The surface hit lies on the trilinear iso-surface, between an
// outside and an inside voxel centre, so its floor voxel is the outside one
// about half of the time and a region-coloured surface came out speckled /
// striped along the depth contours. Step along the ray by half a voxel (up
// to three times) until the voxel's own stored value is in the segment's range.
fn huVoxel(tc0:vec3<f32>)->f32{
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
 let q=round(textureLoad(volumeTex,vec3<i32>(p),0).rg*255.0);
 return (q.x+q.y*256.0-u.calibration.y)*u.dimsSlope.w+u.calibration.x;
}
fn objToTc(d:vec3<f32>)->vec3<f32>{return vec3<f32>(d.x/(2.0*u.halfStep.x),-d.y/(2.0*u.halfStep.y),d.z/(2.0*u.halfStep.z))/max(u.textureDims.xyz,vec3<f32>(1.0));}
// candidates: the hit voxel, then half / one voxel inward (along the
// gradient, into the segment), then along the ray (grazing hits)
fn insideVoxelTc(tc0:vec3<f32>,dir:vec3<f32>,inward:vec3<f32>,seg:u32)->vec3<f32>{
 let a=u.segments[seg*2u];
 let di=objToTc(inward);let dr=objToTc(dir);
 var cand=array<vec3<f32>,6>(tc0,tc0+di*0.5,tc0+di*1.0,tc0+dr*0.5,tc0+dr*1.0,tc0+di*1.5);
 // the candidate must be a member of the segment, its own edit / processing mask entry included
 for(var k:u32=0u;k<6u;k=k+1u){let v=huVoxel(cand[k]);if(segMember(seg,v,a,cand[k])){return cand[k];}}
 return tc0;
}
fn segmentIndexAt(tc0:vec3<f32>)->i32{return segmentIndexFor(huAt(tc0),tc0);}
fn capSegmentIndex(tc0:vec3<f32>)->i32{
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let v=huVoxel(tc);
 // the voxel's own edit / processing mask entry (editAllows looks up that voxel; the interpolated exclusion test of
 // the ray march, excludeMaskedInside, is not used here)
 for(var s:u32=0u;s<4u;s=s+1u){let a=u.segments[s*2u];if(segMember(s,v,a,tc)){return i32(s);}}
 return -1;
}
fn brickMayContain(p:vec3<f32>)->bool{return brickClass(p)>0;}
// 0 = no enabled segment in the brick, 1 = mixed, 2+s = every
// sample in the brick is segment s (its range holds the brick's min..max, no
// earlier enabled segment overlaps, no edit / cut mask on s): a ray already
// inside s crosses such a brick without sampling
fn brickClass(p:vec3<f32>)->i32{
 let tc=clamp(texCoord(p),vec3<f32>(0.0),vec3<f32>(0.999999));let dims=max(u.textureDims.xyz,vec3<f32>(1.0));let bs=max(u.viewport.w,1.0);
 let voxel=vec3<u32>(tc*dims);let bx=voxel.x/u32(bs);let by=voxel.y/u32(bs);let bz=voxel.z/u32(bs);let bcx=u32(u.calibration.z);let bcy=u32(u.calibration.w);
 let brick=bz*bcx*bcy+by*bcx+bx;let mm=brickMinMax[brick];
 let masks=editRows[0]|appliedCutRows[0];
 // a mask-only segment (bit 4+s) is decided by its mask, not the HU range, so the brick's HU
 // min/max say nothing about it; before, every brick was mixed while such a segment was shown (no empty-space skip at
 // all). setEditRuns appends one nibble per brick after the row index: bit s set when the brick holds a voxel of
 // segment s's final mask. Only bricks with that bit are candidates for s (same mixed treatment as before inside them).
 var occ=0u;if((editRows[1]&240u)!=0u){let w=editRows[2u+4u*(u32(dims.y)*u32(dims.z)+1u)+brick/8u];occ=(w>>((brick%8u)*4u))&15u;}
 for(var s:u32=0u;s<4u;s=s+1u){let a=u.segments[s*2u];var cand=a.y>=mm.x&&a.x<=mm.y;if((editRows[1]&(16u<<s))!=0u){cand=(occ&(1u<<s))!=0u;}if(a.w>0.5&&cand){
  if(mm.x>=a.x&&mm.y<=a.y&&(masks&(1u<<s))==0u){return 2+i32(s);}
  return 1;}}
 return 0;
}
fn brickExitDistance(p:vec3<f32>,dir:vec3<f32>)->f32{
 // on the texture grid, like brickMayContain (was the source grid: shorter skips on reduced textures)
 let tc=clamp(texCoord(p),vec3<f32>(0.0),vec3<f32>(0.999999));let dims=max(u.textureDims.xyz,vec3<f32>(1.0));let bs=max(u.viewport.w,1.0);let voxel=vec3<u32>(tc*dims);
 let b=voxel/u32(bs);let voxelSize=2.0*u.halfStep.xyz/dims;var best=1e20;
 if(abs(dir.x)>1e-8){let edge=select(f32(b.x*u32(bs)),min(f32((b.x+1u)*u32(bs)),dims.x),dir.x>0.0);let q=-u.halfStep.x+edge*voxelSize.x;let dt=(q-p.x)/dir.x;if(dt>1e-7){best=min(best,dt);}}
 if(abs(dir.y)>1e-8){let edge=select(f32(b.y*u32(bs)),min(f32((b.y+1u)*u32(bs)),dims.y),dir.y<0.0);let q=u.halfStep.y-edge*voxelSize.y;let dt=(q-p.y)/dir.y;if(dt>1e-7){best=min(best,dt);}}
 if(abs(dir.z)>1e-8){let edge=select(f32(b.z*u32(bs)),min(f32((b.z+1u)*u32(bs)),dims.z),dir.z>0.0);let q=-u.halfStep.z+edge*voxelSize.z;let dt=(q-p.z)/dir.z;if(dt>1e-7){best=min(best,dt);}}
 return best;
}
fn gradientAt(tc:vec3<f32>)->vec3<f32>{
 // textureDims.w: 0 nearest, 1 trilinear, 2/3 trilinear + normals from a
 // wider (2/3 voxel) difference, which smooths the shading of voxel steps
 let d=max(u.textureDims.w,1.0)*vec3<f32>(1.0/max(u.textureDims.x,1.0),1.0/max(u.textureDims.y,1.0),1.0/max(u.textureDims.z,1.0));
 let gx=huAt(tc+vec3<f32>(d.x,0.0,0.0))-huAt(tc-vec3<f32>(d.x,0.0,0.0));
 let gy=huAt(tc+vec3<f32>(0.0,d.y,0.0))-huAt(tc-vec3<f32>(0.0,d.y,0.0));
 let gz=huAt(tc+vec3<f32>(0.0,0.0,d.z))-huAt(tc-vec3<f32>(0.0,0.0,d.z));
 let voxel=2.0*u.halfStep.xyz/max(u.textureDims.xyz,vec3<f32>(1.0));
 let g=vec3<f32>(gx/max(voxel.x,1e-6),-gy/max(voxel.y,1e-6),gz/max(voxel.z,1e-6));
 let l=length(g);if(l<1e-6){return vec3<f32>(0.0,0.0,1.0);}return g/l;
}
${lightingWGSL()}
@fragment fn fs(@builtin(position) frag:vec4<f32>)->@location(0) vec4<f32>{
 let ndc=vec2<f32>(frag.x/max(u.viewport.x,1.0)*2.0-1.0,1.0-frag.y/max(u.viewport.y,1.0)*2.0);
 let dir=normalize(u.camForward.xyz+u.camRightTan.xyz*(ndc.x*u.camRightTan.w*u.camUpAspect.w)+u.camUpAspect.xyz*(ndc.y*u.camRightTan.w));
 let bounds=hitBox(u.camOrigin.xyz,dir,u.halfStep.xyz);
 if(bounds.x>bounds.y){return vec4<f32>(u.background.rgb,1.0);}
 var t=max(bounds.x,0.0);var endT=bounds.y;let step=max(u.halfStep.w,0.00001);var capT=1e30;
 if(u.section.x>0.5){
  var originAxis=u.camOrigin.z;var dirAxis=dir.z;
  if(u.section.x>1.5&&u.section.x<2.5){originAxis=u.camOrigin.y;dirAxis=dir.y;}
  if(u.section.x>=2.5){originAxis=u.camOrigin.x;dirAxis=dir.x;}
  let side=u.section.z*(originAxis-u.section.y);let slope=u.section.z*dirAxis;
  if(abs(slope)<1e-8){
   if(side<0.0){return vec4<f32>(u.background.rgb,1.0);}
  }else{
   let cross=-side/slope;
   if(cross>=max(bounds.x,0.0)-1e-7&&cross<=bounds.y+1e-7){capT=cross;}
   if(slope>0.0){t=max(t,cross);}else{endT=min(endT,cross);}
   if(t>endT){return vec4<f32>(u.background.rgb,1.0);}
  }
 }
 var axialT=1e30;var coronalT=1e30;var sagittalT=1e30;
 if(u.mprVisible.x>0.5&&abs(dir.z)>1e-8){
  let z=((u.mprIndices.x+0.5)/max(u.dimsSlope.z,1.0)*2.0-1.0)*u.halfStep.z;
  let q=(z-u.camOrigin.z)/dir.z;if(q>=t&&q<=endT){axialT=q;}
 }
 if(u.mprVisible.y>0.5&&abs(dir.y)>1e-8){
  let y=(1.0-(u.mprIndices.y+0.5)/max(u.dimsSlope.y,1.0)*2.0)*u.halfStep.y;
  let q=(y-u.camOrigin.y)/dir.y;if(q>=t&&q<=endT){coronalT=q;}
 }
 if(u.mprVisible.z>0.5&&abs(dir.x)>1e-8){
  let x=((u.mprIndices.z+0.5)/max(u.dimsSlope.x,1.0)*2.0-1.0)*u.halfStep.x;
  let q=(x-u.camOrigin.x)/dir.x;if(q>=t&&q<=endT){sagittalT=q;}
 }
 var previousT=t;var lastIndex:i32=-1;var previousCutIdx:i32=-1;var acc=vec4<f32>(0.0);
 // brickEnd = t where the current non-empty brick is left; the
 // brick min/max is read once per brick instead of once per sample
 var brickEnd=-1.0;var prevHv=-1e9;var uniformSeg:i32=-1;
 for(var iter:u32=0u;iter<4096u;iter=iter+1u){
  if(t>endT||acc.a>0.985){break;}
  let p=u.camOrigin.xyz+dir*t;
  var canSample=t<brickEnd;
  if(!canSample){let bc=brickClass(p);canSample=bc>0;uniformSeg=select(-1,bc-2,bc>=2);if(canSample){brickEnd=t+brickExitDistance(p,dir);}}
  var nextT=t+step;var uniformJump=false;
  if(!canSample){brickEnd=-1.0;prevHv=-1e9;let skip=brickExitDistance(p,dir);nextT=t+max(skip+step*0.05,step);}
  else if(uniformSeg>=0&&uniformSeg==lastIndex&&brickEnd>t+step){
   // inside a uniform brick of the segment the ray is already in: nothing can
   // change until the brick is left, so no sample; the cap and MPR planes
   // inside [t, nextT] are still composited below, lastIndex is kept
   // resume on the ray's own sample grid (first grid point past the brick) instead of brickEnd + 0.05 step: the
   // latter re-phased every ray at the brick exit, so the sub-voxel shell left along an exclusion edit rendered as solid
   // brick-sized tiles (harness: vs 368 with an exclusion edit); on the ray's grid it dithers
   canSample=false;uniformJump=true;nextT=t+max(ceil((brickEnd-t)/step),1.0)*step;if(nextT<=brickEnd){nextT=nextT+step;}prevHv=-1e9;
  }
  var capDrawn=false;
  if(capT>=t-1e-7&&capT<=nextT+1e-7){
   if(u.sectionCap.x>0.5){
    let cp=u.camOrigin.xyz+dir*capT;let ctc=texCoord(cp);let capIndex=capSegmentIndex(ctc);
    if(capIndex>=0){
     var capColor=mix(u.segments[u32(capIndex)*2u+1u].rgb,vec3<f32>(1.0),0.22);
     if(analysisOverlay[0]!=0u&&(analysisOverlay[analysisOverlay[0]]&(1u<<u32(capIndex)))!=0u){
      let ov=analysisOverlayAt(ctc);
      if(ov!=0u){capColor=mix(vec3<f32>(f32((ov>>16u)&255u),f32((ov>>8u)&255u),f32(ov&255u))/255.0,vec3<f32>(1.0),0.22);}
     }
     if(u.sectionCap.z>0.5){
      var huv=vec2<f32>(ctc.x,ctc.y);
      if(u.section.x>1.5&&u.section.x<2.5){huv=vec2<f32>(ctc.x,ctc.z);}
      if(u.section.x>=2.5){huv=vec2<f32>(ctc.y,ctc.z);}
      let stripe=abs(fract((huv.x+huv.y)*max(u.sectionCap.w,1.0))-0.5);
      if(stripe<0.14){capColor*=0.26;}
     }
     let ca=clamp(u.sectionCap.y,0.0,1.0);let contribution=(1.0-acc.a)*ca;
     acc=vec4<f32>(acc.rgb+capColor*contribution,acc.a+contribution);capDrawn=true;
    }
   }
   capT=1e30;
  }
  if(canSample&&!capDrawn){
   let tc0=texCoord(p);
   let hv=huAt(tc0);
   let rawIdx=rawSegmentIndexFor(hv);
   let idx=segmentIndexFor(hv,tc0);
   let hvPrev=prevHv;prevHv=hv;
   let maskedCutIdx=select(-1,rawIdx,rawIdx>=0&&idx<0&&appliedCutContains(u32(rawIdx),tc0));

   // The edit mask is authoritative. Voxels inside the cut volume are empty space.
   if(maskedCutIdx>=0){
    previousCutIdx=maskedCutIdx;
    lastIndex=-1;
   }else if(idx!=lastIndex){
    if(idx>=0){
     var lo=previousT;var hi=t;
     // surface search. mprVisible.w = 1: when the boundary is an
     // HU iso-value (no edit / cut mask on the segment, previous sample
     // measured and outside the range) two secant guesses on the HU plus one
     // bisection (3 fetches) replace the six bisections
     let sa=u.segments[u32(idx)*2u];
     let iso=u.mprVisible.w>0.5&&((editRows[0]|appliedCutRows[0])&(1u<<u32(idx)))==0u&&hvPrev>-1e8&&(hvPrev<sa.x||hvPrev>sa.y);
     if(iso){
      let thr=select(sa.y,sa.x,hvPrev<sa.x);var f0=hvPrev-thr;var f1=hv-thr;
      for(var r:u32=0u;r<3u;r=r+1u){
       var mid=(lo+hi)*0.5;
       if(r<2u&&abs(f1-f0)>1e-6){mid=clamp(lo+(hi-lo)*(-f0/(f1-f0)),lo+(hi-lo)*0.02,hi-(hi-lo)*0.02);}
       let tcm=texCoord(u.camOrigin.xyz+dir*mid);let hm=huAt(tcm);
       if(segmentIndexFor(hm,tcm)==idx){hi=mid;f1=hm-thr;}else{lo=mid;f0=hm-thr;}
      }
     }else if(hi>lo){
      // lo==hi: the very first sample hit (a ray entering on the box face); every bisection mid is hi itself and the result stays hi,
      // so the 6 steps and their edit-mask lookups are skipped
      for(var r:u32=0u;r<6u;r=r+1u){
       let mid=(lo+hi)*0.5;let mi=segmentIndexAt(texCoord(u.camOrigin.xyz+dir*mid));
       if(mi==idx){hi=mid;}else{lo=mid;}
      }
     }
     let hp=u.camOrigin.xyz+dir*hi;let tc=texCoord(hp);
     // a hit on the box face the ray entered through (camera outside the box; within one step of the face) takes the face normal and needs
     // no gradient (6 fetches, which for a cut face covering much of the view were all spent on a value that was then replaced); n is set
     // so that inward below comes out as the face's inward direction (the same select as for a gradient)
     let a=u.segments[u32(idx)*2u];
     let onBoxFace=bounds.x>0.0&&hi<=bounds.x+step&&previousCutIdx!=idx;
     var n=vec3<f32>(0.0);
     if(onBoxFace){n=select(1.0,-1.0,hvPrev<-1e8||hvPrev<a.x)*entryFaceNormal(u.camOrigin.xyz,dir,u.halfStep.xyz);}else{n=gradientAt(tc);}
     if(previousCutIdx==idx){
      let prevTc=texCoord(u.camOrigin.xyz+dir*previousT);
      n=appliedCutNormal(u32(idx),prevTc);
     }
     // inward = towards the segment's range: up the gradient when entered from below its minimum, else down
     let inward=select(-n,n,hvPrev<-1e8||hvPrev<a.x);
     // the one shared lighting model (lighting.js): a headlight above / right of the VIEWER (the camera axes in volume space, so a
     // turned volume keeps its light), one-sided diffuse, mild depth cue. The first surface the ray meets: the gradient is turned to face the viewer
     // (it has no fixed orientation). A hit BEHIND a translucent layer (acc.a > 0): the OUTWARD normal (-inward), not turned, so an inner / far wall that
     // faces away gets only the ambient floor. n itself is not changed (inward and the cut normal below use it).
     let viewDir=normalize(u.camOrigin.xyz-hp);
     let later=acc.a>0.0;
     let shade=vrlShade(select(n,-inward,later),viewDir,${lightOffsetExpr('u.camRightTan.xyz','u.camUpAspect.xyz')},vrlDepth01(hi,u.camOrigin.xyz,u.halfStep.xyz),select(0.0,1.0,later),u.segMat[u32(idx)].xyz);
     let diffuse=shade.x;let spec=shade.y;
     // regions only on the segments that have one (mask word at the colour table start); with the index texture the lookup needs no inside-voxel search
     let anyRegion=analysisOverlay[0]!=0u&&(analysisOverlay[analysisOverlay[0]]&(1u<<u32(idx)))!=0u;
     var tcv=tc;if(previewRows[0]!=0u||anyRegion){tcv=insideVoxelTc(tc,dir,inward,u32(idx));}
     let isCutPreview=previewContains(u32(idx),tcv);
     var col=u.segments[u32(idx)*2u+1u].rgb;
     var alpha=clamp(a.z,0.03,1.0);
     var lit=col*diffuse+vec3<f32>(spec);
     var overlay=0u;if(anyRegion&&!isCutPreview){overlay=analysisOverlayAt(tcv);}
     if(overlay!=0u){
      col=vec3<f32>(f32((overlay>>16u)&255u),f32((overlay>>8u)&255u),f32(overlay&255u))/255.0;
      let focused=(overlay&0x1000000u)!=0u;
      alpha=max(alpha,select(0.72,0.96,focused));
      lit=col*(0.3+0.7*diffuse)*select(1.0,1.18,focused)+vec3<f32>(spec);
     }
     if(isCutPreview){
      col=vec3<f32>(1.0,0.16,0.055);
      alpha=max(alpha,0.94);
      lit=col*0.92+vec3<f32>(0.12,0.015,0.0);
     }
     let contribution=(1.0-acc.a)*alpha;acc=vec4<f32>(acc.rgb+lit*contribution,acc.a+contribution);
    }
    lastIndex=idx;
    previousCutIdx=-1;
   }else if(idx<0){
    lastIndex=-1;
   }
  }else if(!canSample&&!uniformJump){lastIndex=-1;previousCutIdx=-1;}

  for(var pi:u32=0u;pi<3u;pi=pi+1u){
   var pt=1e30;var which:i32=-1;
   if(axialT>=t-1e-7&&axialT<=nextT+1e-7&&axialT<pt){pt=axialT;which=0;}
   if(coronalT>=t-1e-7&&coronalT<=nextT+1e-7&&coronalT<pt){pt=coronalT;which=1;}
   if(sagittalT>=t-1e-7&&sagittalT<=nextT+1e-7&&sagittalT<pt){pt=sagittalT;which=2;}
   if(which<0){break;}
   let planePoint=u.camOrigin.xyz+dir*pt;let planeValue=huAt(texCoord(planePoint));
   let ww=max(u.mprWindow.y,1.0);let low=u.mprWindow.x-ww*0.5;let g=clamp((planeValue-low)/ww,0.0,1.0);
   var planeColor=vec3<f32>(g);
   let isSectionPlane=u.section.x>0.5&&i32(round(u.section.x))-1==which;
   if(!isSectionPlane){
    // the same membership as the 2D and 3D views (processed mask and manual edits included), one segment per voxel
    let planeSeg=segmentIndexFor(planeValue,texCoord(planePoint));
    if(planeSeg>=0){
     let a=u.segments[u32(planeSeg)*2u];
     let tint=u.segments[u32(planeSeg)*2u+1u].rgb;let ta=min(0.75,clamp(a.z,0.0,1.0)*0.65);
     planeColor=mix(planeColor,tint,ta);
    }
   }
   let pa=clamp(u.mprIndices.w,0.0,1.0);let contribution=(1.0-acc.a)*pa;
   acc=vec4<f32>(acc.rgb+planeColor*contribution,acc.a+contribution);
   if(which==0){axialT=1e30;}else if(which==1){coronalT=1e30;}else{sagittalT=1e30;}
  }

  // after a uniform-brick jump the last point inside the brick is the previous (inside) sample of the next surface search
  previousT=select(t,max(t,nextT-step*0.1),uniformJump);t=nextT;
 }
 let bg=u.background.rgb; // the theme's dark 3D background (--ui-canvas-bg-3d)
 return vec4<f32>(acc.rgb+bg*(1.0-acc.a),1.0);
}`;
}

export function brickShader(){
 return `
@group(0) @binding(0) var volumeTex:texture_3d<f32>;
@group(0) @binding(1) var<storage,read> meta:array<u32>;
@group(0) @binding(2) var<storage,read> params:array<f32>;
@group(0) @binding(3) var<storage,read_write> outMinMax:array<vec2<f32>>;
fn huAt(x:u32,y:u32,z:u32)->f32{
 let q=round(textureLoad(volumeTex,vec3<i32>(i32(x),i32(y),i32(z)),0).rg*255.0);
 return (q.x+q.y*256.0-params[2])*params[0]+params[1];
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let bxCount=meta[3];let byCount=meta[4];let bzCount=meta[5];let total=bxCount*byCount*bzCount;let i=gid.x;if(i>=total){return;}
 let bx=i%bxCount;let by=(i/bxCount)%byCount;let bz=i/(bxCount*byCount);let bs=meta[6];
 // one voxel of overlap, so every trilinear sample inside the brick lies within [min,max] (uniform bricks can then be crossed without sampling)
 let x0=select(bx*bs-1u,0u,bx==0u);let y0=select(by*bs-1u,0u,by==0u);let z0=select(bz*bs-1u,0u,bz==0u);let x1=min((bx+1u)*bs+1u,meta[0]);let y1=min((by+1u)*bs+1u,meta[1]);let z1=min((bz+1u)*bs+1u,meta[2]);
 var lo=1e30;var hi=-1e30;
 for(var z=z0;z<z1;z=z+1u){for(var y=y0;y<y1;y=y+1u){for(var x=x0;x<x1;x=x+1u){let v=huAt(x,y,z);lo=min(lo,v);hi=max(hi,v);}}}
 outMinMax[i]=vec2<f32>(lo,hi);
}`;
}

export function volumePickShader(){
 return `
struct Uniforms{
 camOrigin:vec4<f32>,camRightTan:vec4<f32>,camUpAspect:vec4<f32>,camForward:vec4<f32>,
 halfStep:vec4<f32>,dimsSlope:vec4<f32>,calibration:vec4<f32>,viewport:vec4<f32>,segments:array<vec4<f32>,8>,
 mprIndices:vec4<f32>,mprVisible:vec4<f32>,mprWindow:vec4<f32>,section:vec4<f32>,sectionCap:vec4<f32>,textureDims:vec4<f32>
};
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var volumeTex:texture_3d<f32>;
@group(0) @binding(2) var<storage,read> editRows:array<u32>;
@group(0) @binding(3) var<storage,read> pick:array<f32>;
@group(0) @binding(4) var<storage,read_write> result:array<u32>;
@group(0) @binding(5) var<storage,read> editIntervals:array<u32>;
fn hitBox(orig:vec3<f32>,dir:vec3<f32>,halfBox:vec3<f32>)->vec2<f32>{
 let inv=1.0/dir;let a=(-halfBox-orig)*inv;let b=(halfBox-orig)*inv;let lo=min(a,b);let hi=max(a,b);
 return vec2<f32>(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));
}
fn texCoord(p:vec3<f32>)->vec3<f32>{return vec3<f32>(p.x/(2.0*u.halfStep.x)+0.5,0.5-p.y/(2.0*u.halfStep.y),p.z/(2.0*u.halfStep.z)+0.5);}
fn huAt(tc0:vec3<f32>)->f32{
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
 let q=round(textureLoad(volumeTex,vec3<i32>(p),0).rg*255.0);
 return (q.x+q.y*256.0-u.calibration.y)*u.dimsSlope.w+u.calibration.x;
}
fn maskVoxelAt(tc0:vec3<f32>)->vec3<u32>{
 let src=vec3<u32>(u32(u.dimsSlope.x),u32(u.dimsSlope.y),u32(u.dimsSlope.z));
 let tex=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 if(all(src==tex)){return min(vec3<u32>(tc*vec3<f32>(src)),src-vec3<u32>(1u));}
 let tp=min(vec3<u32>(tc*vec3<f32>(tex)),tex-vec3<u32>(1u));
 let sx=u32(round(f32(tp.x)*f32(max(src.x-1u,1u))/f32(max(tex.x-1u,1u))));
 let sy=u32(round(f32(tp.y)*f32(max(src.y-1u,1u))/f32(max(tex.y-1u,1u))));
 let sz=u32(round(f32(tp.z)*f32(max(src.z-1u,1u))/f32(max(tex.z-1u,1u))));
 return min(vec3<u32>(sx,sy,sz),src-vec3<u32>(1u));
}
fn editAllows(seg:u32,tc0:vec3<f32>)->bool{
 let activeMask=editRows[0];if((activeMask&(1u<<seg))==0u){return true;}
 let keepMask=editRows[1];
 let dims=vec3<u32>(u32(u.textureDims.x),u32(u.textureDims.y),u32(u.textureDims.z));
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let p=min(vec3<u32>(tc*vec3<f32>(dims)),dims-vec3<u32>(1u));
 let rowCount=dims.y*dims.z;
 let base=2u+seg*(rowCount+1u);
 let row=p.z*dims.y+p.y;
 let start=editRows[base+row];
 let finish=editRows[base+row+1u];
 var inside=false;
 // intervals are sorted and disjoint per row: binary search for the last one
 // starting at or before p.x (a linear scan cost tens of reads per sample on
 // rows with many intervals, e.g. a processed fat segment)
 var lo=start;var hi=finish;
 loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if((editIntervals[mid]&65535u)<=p.x){lo=mid+1u;}else{hi=mid;}}
 if(lo>start){inside=p.x<=(editIntervals[lo-1u]>>16u);}
 let keep=(keepMask&(1u<<seg))!=0u;return select(!inside,inside,keep);
}
// a segment whose mask can hold voxels outside its HU range (Closing / hole filling added them, and a higher
// segment's added voxels are removed from it) is decided by the mask alone, as the 2D views do: bit 4+s of editRows[1]
fn segMember(s:u32,v:f32,a:vec4<f32>,tc:vec3<f32>)->bool{
 if(a.w<=0.5){return false;}
 if((editRows[1]&(16u<<s))!=0u){return editAllows(s,tc);}
 return v>=a.x&&v<=a.y&&editAllows(s,tc);
}
fn segmentIndexAt(tc0:vec3<f32>,preferred:i32)->i32{
 let tc=clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999));
 let v=huAt(tc);
 if(preferred>=0){
  let s=u32(preferred);
  let a=u.segments[s*2u];
  if(segMember(s,v,a,tc)){return preferred;}
  return -1;
 }
 for(var s:u32=0u;s<4u;s=s+1u){let a=u.segments[s*2u];if(segMember(s,v,a,tc)){return i32(s);}}
 return -1;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;
 let count=u32(pick[0]);
 if(i>=count){return;}
 let ib=4u+i*4u;
 let ob=i*4u;
 result[ob]=0u;result[ob+1u]=0u;result[ob+2u]=0u;result[ob+3u]=0u;
 let preferred=i32(round(pick[ib+2u]))-1;
 let ndc=vec2<f32>(pick[ib]/max(u.viewport.x,1.0)*2.0-1.0,1.0-pick[ib+1u]/max(u.viewport.y,1.0)*2.0);
 let dir=normalize(u.camForward.xyz+u.camRightTan.xyz*(ndc.x*u.camRightTan.w*u.camUpAspect.w)+u.camUpAspect.xyz*(ndc.y*u.camRightTan.w));
 let bounds=hitBox(u.camOrigin.xyz,dir,u.halfStep.xyz);if(bounds.x>bounds.y){return;}
 var t=max(bounds.x,0.0);let endT=bounds.y;let step=max(u.halfStep.w,0.00001);var previousT=t;
 for(var iter:u32=0u;iter<4096u;iter=iter+1u){
  if(t>endT){return;}let tc0=texCoord(u.camOrigin.xyz+dir*t);let idx=segmentIndexAt(tc0,preferred);
  if(idx>=0){
   var lo=previousT;var hi=t;
   for(var r:u32=0u;r<5u;r=r+1u){let mid=(lo+hi)*0.5;if(segmentIndexAt(texCoord(u.camOrigin.xyz+dir*mid),preferred)==idx){hi=mid;}else{lo=mid;}}
   let tc=clamp(texCoord(u.camOrigin.xyz+dir*hi),vec3<f32>(0.0),vec3<f32>(0.999999));
   let sourceP=maskVoxelAt(tc);
   result[ob]=sourceP.x;
   result[ob+1u]=sourceP.y;
   result[ob+2u]=sourceP.z;
   result[ob+3u]=u32(idx)+1u;return;
  }
  previousT=t;t+=step;
 }
}`;
}

export function mprPlaneShader(){
 return `
struct MprParams{
 dims:vec4<u32>,
 plane:vec4<u32>,
 calibration:vec4<f32>
};
@group(0) @binding(0) var<uniform> p:MprParams;
@group(0) @binding(1) var volumeTex:texture_3d<f32>;
@group(0) @binding(2) var<storage,read_write> outValues:array<f32>;
fn huAt(x:u32,y:u32,z:u32)->f32{
 // x,y,z are source voxels; a reduced texture (iPad) is sampled at the
 // nearest texel (identity when the texture has the source dimensions).
 let td=textureDimensions(volumeTex,0);
 let tx=min(td.x-1u,(x*td.x)/p.dims.x);let ty=min(td.y-1u,(y*td.y)/p.dims.y);let tz=min(td.z-1u,(z*td.z)/p.dims.z);
 let q=round(textureLoad(volumeTex,vec3<i32>(i32(tx),i32(ty),i32(tz)),0).rg*255.0);
 let raw=q.x+q.y*256.0-p.calibration.z;
 return raw*p.calibration.x+p.calibration.y;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;
 let kind=p.plane.x;let index=p.plane.y;let outW=p.plane.z;let outH=p.plane.w;
 if(i>=outW*outH){return;}
 let ox=i%outW;let oy=i/outW;
 let sx=min(p.dims.x-1u,(ox*p.dims.x)/outW);
 let sy=min(p.dims.y-1u,(oy*p.dims.y)/outH);
 let sz=min(p.dims.z-1u,(oy*p.dims.z)/outH);
 var x:u32;var y:u32;var z:u32;
 if(kind==0u){
  x=sx;y=sy;z=index;
 }else if(kind==1u){
  x=sx;y=index;z=p.dims.z-1u-sz;
 }else{
  x=index;y=min(p.dims.y-1u,(ox*p.dims.y)/outW);z=p.dims.z-1u-sz;
 }
 outValues[i]=huAt(x,y,z);
}`;
}

export function volumeTexturePlan(v,maxTextureBytes=0,maxTextureDim=Infinity,targetInPlane=0){
 const sw=Math.max(1,v?.columns||0),sh=Math.max(1,v?.rows||0),sd=Math.max(1,v?.slices||0),sourceBytes=sw*sh*sd*2;
 let scale=1;
 const inPlaneMax=Math.max(sw,sh);
 if(targetInPlane>0&&inPlaneMax>targetInPlane)scale=Math.min(scale,targetInPlane/inPlaneMax);
 if(maxTextureBytes>0&&sourceBytes>maxTextureBytes)scale=Math.min(scale,Math.cbrt(maxTextureBytes/sourceBytes)*0.965);
 const maxSourceDim=Math.max(sw,sh,sd);
 if(Number.isFinite(maxTextureDim)&&maxTextureDim>0&&maxSourceDim>maxTextureDim)scale=Math.min(scale,maxTextureDim/maxSourceDim);
 let tw=Math.max(1,Math.floor(sw*scale)),th=Math.max(1,Math.floor(sh*scale)),td=Math.max(1,Math.floor(sd*scale));
 if(maxTextureBytes>0){
  while(tw*th*td*2>maxTextureBytes){
   if(tw>=th&&tw>=td&&tw>1)tw--;else if(th>=td&&th>1)th--;else if(td>1)td--;else break;
  }
 }
 return{sourceDims:[sw,sh,sd],dims:[tw,th,td],sourceBytes,bytes:tw*th*td*2,reduced:tw!==sw||th!==sh||td!==sd};
}


// area-average a packed rg8 (little-endian u16) slice into tw x th; xs/ys are
// source span boundaries per target column/row
export function reduceSliceArea(packed,sw,xs,ys,tw,th,rowStride,out,rowSum=new Float64Array(tw),rowCnt=new Uint32Array(tw)){
 for(let y=0;y<th;y++){
  rowSum.fill(0);rowCnt.fill(0);
  for(let sy=ys[y];sy<ys[y+1];sy++){
   const src=sy*sw*2;
   for(let x=0;x<tw;x++){let acc=0;const a=xs[x],b=xs[x+1];for(let sx=a;sx<b;sx++){const o=src+sx*2;acc+=packed[o]|(packed[o+1]<<8)}rowSum[x]+=acc;rowCnt[x]+=b-a}
  }
  const dst=y*rowStride;
  for(let x=0;x<tw;x++){const v=rowCnt[x]?Math.round(rowSum[x]/rowCnt[x]):0;out[dst+x*2]=v&255;out[dst+x*2+1]=v>>8}
 }
 return out;
}
// per-brick occupancy of the mask-only segments, for the brick classification of volumeShader
// (brickClass): one nibble per 8^3 brick of the TEXTURE grid (runs = gpuRunsForTexture output), bit s set when the brick
// holds at least one voxel of segment s's mask; eight bricks per u32, brick index (bz*bcy+by)*bcx+bx as in the shader.
// Only segments with maskOnly contribute; null when there is none (the row-index buffer then has no tail, as before).
export function editBrickOccupancy(descs,gridDims,brickSize=8){
 const [w,h,d]=gridDims,bs=Math.max(1,brickSize|0),bcx=Math.ceil(w/bs),bcy=Math.ceil(h/bs),bcz=Math.ceil(d/bs);
 if(!descs.some(desc=>desc?.maskOnly&&desc.runs))return null;
 const words=new Uint32Array(Math.ceil(bcx*bcy*bcz/8));
 for(let si=0;si<descs.length&&si<4;si++){
  const desc=descs[si];if(!desc?.maskOnly||!desc.runs)continue;const bit=1<<si;
  for(let z=0;z<d;z++){
   const rec=desc.runs[z];if(!rec?.length)continue;const bz=Math.floor(z/bs);
   for(let i=0;i<rec.length;i+=3){
    const row=(bz*bcy+Math.floor(rec[i]/bs))*bcx,x1=Math.min(rec[i+2],w-1);
    for(let bx=Math.floor(rec[i+1]/bs);bx<=Math.floor(x1/bs);bx++){const b=row+bx;words[b>>3]|=bit<<((b&7)*4)}
   }
  }
 }
 return words;
}

export class MedicalVolumeRenderer{
 constructor({device,host,rendererCanvas,onProgress,onStatus,onRedraw}){
  this.device=device;this.host=host;this.rendererCanvas=rendererCanvas;this.onProgress=onProgress||(()=>{});this.onStatus=onStatus||(()=>{});this.onRedraw=onRedraw||(()=>{}); // onRedraw = request a 3D frame (the edit mask texture became usable)
  this.canvas=document.createElement('canvas');this.canvas.className='gpu-medical-volume-canvas';
  Object.assign(this.canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',display:'none',pointerEvents:'none',zIndex:'0'});
  this.host.style.position='relative';this.host.appendChild(this.canvas);
  this.context=this.canvas.getContext('webgpu');this.format=navigator.gpu.getPreferredCanvasFormat();
  this.context.configure({device:this.device,format:this.format,alphaMode:'opaque'});
  this.uniformBuffer=this.device.createBuffer({size:432,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  this.sampler=this.device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',addressModeW:'clamp-to-edge'});
  const module=this.device.createShaderModule({label:'VRL medical volume raycast',code:safeWgsl(volumeShader())});
  this.pipeline=this.device.createRenderPipeline({label:'VRL medical volume raycast',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list'}});
  const pickModule=this.device.createShaderModule({label:'VRL medical volume pick',code:safeWgsl(volumePickShader())});this.pickPipeline=this.device.createComputePipeline({label:'VRL medical volume pick',layout:'auto',compute:{module:pickModule,entryPoint:'main'}});this.pickBuffer=null;this.pickOutput=null;this.pickCapacity=0;
  const brickModule=this.device.createShaderModule({label:'VRL volume minmax bricks',code:safeWgsl(brickShader())});this.brickPipeline=this.device.createComputePipeline({label:'VRL volume minmax bricks',layout:'auto',compute:{module:brickModule,entryPoint:'main'}});this.brickBuffer=null;this.brickDims=[1,1,1];this.brickSize=8;
  const mprModule=this.device.createShaderModule({label:'VRL resident volume MPR',code:safeWgsl(mprPlaneShader())});this.mprPipeline=this.device.createComputePipeline({label:'VRL resident volume MPR',layout:'auto',compute:{module:mprModule,entryPoint:'main'}});this.mprUniformBuffer=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  this.editMaskTexture=null;this.editMaskBuilt=null;this.editMaskInfo='';this.editUpload=null;this.cutUpload=null;
  this.editRowsBuffer=null;this.editIntervalsBuffer=null;this.editSignature='';this.clearEditRuns();
  this.previewRowsBuffer=null;this.previewIntervalsBuffer=null;this.previewSignature='';this.clearPreviewRuns();
  this.appliedCutRowsBuffer=null;this.appliedCutIntervalsBuffer=null;this.appliedCutSignature='';this.clearAppliedCutRuns();
  this.analysisOverlayBuffer=null;this.analysisOverlaySignature='';this.clearAnalysisRuns();
  this.texture=null;this.bindGroup=null;this.seriesId=null;this.bricksReady=false;this.previewVolume=null;this.previewPlaneBuffers={coronal:null,sagittal:null};this.active=false;this.interactive=false;this.interactionTier=0;this.halfExtents=[1,1,1];this.step=0.002;this.calibration={slope:1,intercept:0,signedBias:0};this.volume=null;this.textureDims=[1,1,1];this.reducedVolume=false;this.textureBytes=0;this.planSignature='';this.dataGeneration=0;this.ensureQueue=null;
  this.frameData=new Float32Array(108);this.tmpInv=new THREE.Matrix4();this.tmpOrigin=new THREE.Vector3();this.tmpQuat=new THREE.Quaternion();this.tmpRight=new THREE.Vector3();this.tmpUp=new THREE.Vector3();this.tmpForward=new THREE.Vector3();
 }
 support(v,{maxTextureBytes=0,targetInPlane=0}={}){
  const s=v?.series;if(!v?.sourceBacked||!s)return{ok:false,reason:'GPU volume currently targets source-backed DICOM'};
  if(!this.device||!this.context)return{ok:false,reason:'WebGPU device unavailable'};
  if(!s.slices.length||s.slices.some(m=>m.bits!==16||m.samples!==1||!UNCOMPRESSED_TS.has(m.ts)))return{ok:false,reason:'16-bit uncompressed single-channel DICOM required'};
  if(s.slices.some(m=>m.rows!==s.rows||m.columns!==s.columns))return{ok:false,reason:'Inconsistent DICOM matrix'};
  const first=s.slices[0],slope=first.slope,intercept=first.intercept,signed=!!first.signed;
  if(s.slices.some(m=>Math.abs(m.slope-slope)>1e-9||Math.abs(m.intercept-intercept)>1e-6||!!m.signed!==signed))return{ok:false,reason:'Per-slice calibration differs'};
  const lim=this.device.limits.maxTextureDimension3D,plan=volumeTexturePlan(v,maxTextureBytes,lim,targetInPlane);
  if(plan.dims[0]>lim||plan.dims[1]>lim||plan.dims[2]>lim)return{ok:false,reason:'Volume exceeds maxTextureDimension3D '+lim};
  return{ok:true,plan};
 }
 // One upload at a time: a new ensure() waits until the previous one has settled, so their device error scopes never
 // interleave (a series switch while the previous series' filtered refresh was still uploading failed the new upload
 // with the old texture's "destroyed texture" validation errors and left 3D blank).
 ensure(v,options){
  const run=(this.ensureQueue||Promise.resolve()).then(()=>this.ensureNow(v,options));
  this.ensureQueue=run.catch(()=>{});
  return run;
 }
 async ensureNow(v,{prepareBricks=true,previewSide=0,maxTextureBytes=0,targetInPlane=0}={}){
  const support=this.support(v,{maxTextureBytes,targetInPlane});if(!support.ok)throw new Error(support.reason);
  const s=v.series,plan=support.plan,[tw,th,td]=plan.dims,planSignature=plan.dims.join('x');
  // v.filterSignature + v.sliceData(z) -> CT values: upload those (e.g. filtered
  // slices) instead of the original DICOM pixels. Same series and texture plan
  // but different data rewrites the existing texture in place (no second
  // texture: GPU memory is tight on iPad), so the old image stays until replaced.
  const dataSignature=v.filterSignature&&typeof v.sliceData==='function'?String(v.filterSignature):'';
  let inPlace=false;
  if(this.seriesId===s.id&&this.texture&&this.planSignature===planSignature){
   if((this.dataSignature||'')===dataSignature){this.volume=v;if(prepareBricks)await this.ensureBricks();return;}
   inPlace=true;
  }
  if(!inPlace)this.resetData();
  // resetData() from outside (series change) supersedes this upload: never write to or keep a texture it destroyed
  const generation=this.dataGeneration,superseded=()=>{if(this.dataGeneration!==generation)throw new Error('__SUPERSEDED__')};
  this.volume=v;this.onStatus(plan.reduced?'WEBGPU MOBILE VOLUME UPLOAD':'WEBGPU VOLUME UPLOAD');
  const first=s.slices[0],signed=!!first.signed;let texture,popped=false;
  // v.isCancelled(): lets the caller stop an upload superseded by a newer one
  const cancelled=()=>{if(typeof v.isCancelled==='function'&&v.isCancelled())throw new Error('__SUPERSEDED__')};
  const sliceBytes=dataSignature?(async z=>{cancelled();const tw0=performance.now(),vals=await v.sliceData(z);globalThis.__vrlTime?.('tex:wait',performance.now()-tw0);const tp=performance.now(),b=packCtSlice(vals,first);globalThis.__vrlTime?.('tex:pack',performance.now()-tp);return b}):(z=>{cancelled();return packedRgSlice(s.slices[z])});
  if(inPlace)this.dataSignature='partial';
  // v.textureCache(info) -> handle (see gpu-volume-cache.js): on a hit the
  // stored texture slices are uploaded as-is (no filtering, packing or
  // resampling); on a miss every uploaded slice is stored and committed at
  // the end. Cache problems never fail the upload.
  const reducedRowStride=Math.ceil(tw*2/256)*256;
  let cache=null;
  if(dataSignature&&typeof v.textureCache==='function'){
   try{cache=await v.textureCache({planSignature:plan.reduced?planSignature+'-avg':planSignature,reduced:!!plan.reduced,slices:plan.reduced?td:s.slices.length,bytesPerSlice:plan.reduced?reducedRowStride*th:s.columns*2*s.rows})}catch{cache=null}
  }
  this.lastCacheHit=!!cache?.hit;
  (loadStats.ensures||(loadStats.ensures=[])).push({filtered:!!dataSignature,cache:!!cache,hit:!!cache?.hit,t:performance.now()}); // every upload of the 3D volume: filtered (the device cache applies), a cache handle was given, it was a hit
  let preview=null,previewSourceZ=null,previewX=null,previewY=null;
  const previewMax=Math.max(0,Math.floor(previewSide||0));
  if(previewMax>0&&!plan.reduced){
   const ratio=Math.min(1,previewMax/Math.max(s.columns,s.rows,s.slices.length)),pw=Math.max(1,Math.round(s.columns*ratio)),ph=Math.max(1,Math.round(s.rows*ratio)),pd=Math.max(1,Math.round(s.slices.length*ratio));
   try{
    preview={data:new Uint16Array(pw*ph*pd),dims:[pw,ph,pd],sourceDims:[s.columns,s.rows,s.slices.length]};
    previewSourceZ=new Int32Array(s.slices.length);previewSourceZ.fill(-1);
    previewX=new Uint32Array(pw);previewY=new Uint32Array(ph);
    for(let x=0;x<pw;x++)previewX[x]=pw<=1?0:Math.round(x*(s.columns-1)/(pw-1));
    for(let y=0;y<ph;y++)previewY[y]=ph<=1?0:Math.round(y*(s.rows-1)/(ph-1));
    for(let z=0;z<pd;z++){const src=pd<=1?0:Math.round(z*(s.slices.length-1)/(pd-1));previewSourceZ[src]=z}
   }catch{preview=null;previewSourceZ=previewX=previewY=null}
  }
  this.device.pushErrorScope?.('validation');
  try{
   texture=inPlace?this.texture:this.device.createTexture({label:plan.reduced?'VRL mobile reduced DICOM volume':'VRL DICOM volume',size:{width:tw,height:th,depthOrArrayLayers:td},dimension:'3d',format:'rg8unorm',
    // RENDER_ATTACHMENT so Dawn (Chrome) lazy-clears the new texture with a
    // render-target clear. Without it, Dawn's D3D12 backend (Windows) clears a color texture
    // by uploading a zero buffer the size of the whole subresource (d3d12/TextureD3D12.cpp
    // ClearTexture): 3.74 GB for Full here, over the 2 GB maxBufferSize -> "Buffer size
    // (3741319168) exceeds the max buffer size limit … Dawn_DynamicUploaderStaging".
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
   if(plan.reduced){
    const xMap=new Uint32Array(tw),yMap=new Uint32Array(th),zMap=new Uint32Array(td);
    for(let x=0;x<tw;x++)xMap[x]=tw<=1?0:Math.round(x*(s.columns-1)/(tw-1));
    for(let y=0;y<th;y++)yMap[y]=th<=1?0:Math.round(y*(s.rows-1)/(th-1));
    for(let z=0;z<td;z++)zMap[z]=td<=1?0:Math.round(z*(s.slices.length-1)/(td-1));
    const rowBytes=tw*2,rowStride=Math.ceil(rowBytes/256)*256,reducedSlice=new Uint8Array(rowStride*th);
    const spans=(n,t)=>{const a=new Uint32Array(t+1);for(let i=0;i<=t;i++)a[i]=Math.min(n,Math.round(i*n/t));for(let i=0;i<t;i++)if(a[i+1]<=a[i])a[i+1]=Math.min(n,a[i]+1);return a};
    const xs=spans(s.columns,tw),ys=spans(s.rows,th),rowSum=new Float64Array(tw),rowCnt=new Uint32Array(tw);
    // slices packed and reduced on the GPU by the filter pass
    const packedSlice=!cache?.hit&&dataSignature&&typeof v.packedSliceProvider==='function'?v.packedSliceProvider({tw,th,xs,ys,zMap,rowStride,slope:first.slope||1,intercept:first.intercept||0,bias:signed?32768:0}):null;
    for(let tz=0;tz<td;tz++){
     let upload=reducedSlice;
     const gpuPacked=packedSlice?(cancelled(),await packedSlice(tz)):null;
     if(cache?.hit){cancelled();upload=await cache.read(tz)}
     else if(gpuPacked){upload=gpuPacked;if(cache)await cache.write(tz,gpuPacked.slice())}
     else{
      const packed=await sliceBytes(zMap[tz]);reducedSlice.fill(0);
      {const tr=performance.now();reduceSliceArea(packed,s.columns,xs,ys,tw,th,rowStride,reducedSlice,rowSum,rowCnt);globalThis.__vrlTime?.('tex:reduce',performance.now()-tr)}
      if(cache)await cache.write(tz,reducedSlice.slice());
     }
     superseded();this.device.queue.writeTexture({texture,origin:{x:0,y:0,z:tz}},upload,{bytesPerRow:rowStride,rowsPerImage:th},{width:tw,height:th,depthOrArrayLayers:1});
     if((tz&63)===63||tz===td-1){this.onProgress(tz+1,td);try{await this.device.queue.onSubmittedWorkDone()}catch{}await frameOrTimer(32)}
    }
   }else{
    for(let z=0;z<s.slices.length;z++){
     let packed;
     if(cache?.hit){cancelled();packed=await cache.read(z)}
     else{packed=await sliceBytes(z);if(cache)await cache.write(z,packed)}
     superseded();this.device.queue.writeTexture({texture,origin:{x:0,y:0,z}},packed,{bytesPerRow:s.columns*2,rowsPerImage:s.rows},{width:s.columns,height:s.rows,depthOrArrayLayers:1});
     if(preview&&previewSourceZ){
      const pz=previewSourceZ[z];
      if(pz>=0){
       const [pw,ph]=preview.dims,base=pz*pw*ph;
       for(let py=0;py<ph;py++){
        const sy=previewY[py],srcRow=sy*s.columns*2,dstRow=base+py*pw;
        for(let px=0;px<pw;px++){const off=srcRow+previewX[px]*2;preview.data[dstRow+px]=packed[off]|(packed[off+1]<<8)}
       }
      }
     }
     if((z&31)===31||z===s.slices.length-1){this.onProgress(z+1,s.slices.length);try{await this.device.queue.onSubmittedWorkDone()}catch{}await frameOrTimer(32)}
    }
   }
   const validation=await this.device.popErrorScope?.();popped=true;superseded();if(validation)throw new Error(validation.message);
   if(cache&&!cache.hit)await cache.commit();
   superseded();
  }catch(e){
   if(!popped){try{await this.device.popErrorScope?.()}catch{}}
   try{await cache?.abort?.()}catch{}
   if(!inPlace)texture?.destroy?.();throw e;
  }
  const px=s.columns*s.spacingX,py=s.rows*s.spacingY,pz=s.slices.length*s.spacingZ,maxP=Math.max(px,py,pz,1),scale=3.3/maxP;
  this.halfExtents=[px*scale*.5,py*scale*.5,pz*scale*.5];
  const effX=px/tw,effY=py/th,effZ=pz/td;this.step=Math.max(1e-5,Math.min(effX,effY,effZ)*scale*.85);
  this.calibration={slope:first.slope,intercept:first.intercept,signedBias:signed?32768:0};this.texture=texture;this.textureDims=[tw,th,td];this.reducedVolume=plan.reduced;this.textureBytes=plan.bytes;this.planSignature=planSignature;this.dataSignature=dataSignature;this.seriesId=s.id;this.bricksReady=false;this.previewVolume=preview;this.previewPlaneBuffers={coronal:null,sagittal:null};
  if(prepareBricks)await this.ensureBricks();else this.onStatus(plan.reduced?'WEBGPU MOBILE VOLUME RESIDENT':'WEBGPU VOLUME RESIDENT');
 }
 async ensureBricks(){
  if(this.bricksReady)return;
  const s=this.volume?.series;if(!s||!this.texture)throw new Error('GPU volume texture is not resident');
  const first=s.slices[0],signed=!!first.signed,[tw,th,td]=this.textureDims,bs=this.brickSize,bx=Math.ceil(tw/bs),by=Math.ceil(th/bs),bz=Math.ceil(td/bs),brickCount=bx*by*bz;this.brickDims=[bx,by,bz];
  this.brickBuffer?.destroy?.();this.brickBuffer=this.device.createBuffer({label:'VRL volume minmax bricks',size:Math.max(8,brickCount*8),usage:GPUBufferUsage.STORAGE});
  const meta=smallStorage(this.device,new Uint32Array([tw,th,td,bx,by,bz,bs,0])),params=smallStorage(this.device,new Float32Array([first.slope,first.intercept,signed?32768:0,0]));
  try{
   const brickGroup=this.device.createBindGroup({layout:this.brickPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture.createView({dimension:'3d'})},{binding:1,resource:{buffer:meta}},{binding:2,resource:{buffer:params}},{binding:3,resource:{buffer:this.brickBuffer}}]}),brickEncoder=this.device.createCommandEncoder({label:'VRL volume minmax bricks'}),brickPass=brickEncoder.beginComputePass();
   brickPass.setPipeline(this.brickPipeline);brickPass.setBindGroup(0,brickGroup);brickPass.dispatchWorkgroups(Math.ceil(brickCount/64));brickPass.end();this.device.queue.submit([brickEncoder.finish()]);await this.device.queue.onSubmittedWorkDone();
  }finally{meta.destroy();params.destroy()}
  this.rebuildBindGroup();
  this.bricksReady=true;this.onStatus('WEBGPU VOLUME READY');
 }
 rebuildBindGroup(){
  if(!this.texture||!this.brickBuffer||!this.editRowsBuffer||!this.editIntervalsBuffer||!this.previewRowsBuffer||!this.previewIntervalsBuffer||!this.appliedCutRowsBuffer||!this.appliedCutIntervalsBuffer||!this.analysisOverlayBuffer){this.bindGroup=null;return}
  this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.texture.createView({dimension:'3d'})},
   {binding:2,resource:{buffer:this.editRowsBuffer}},{binding:3,resource:{buffer:this.brickBuffer}},{binding:4,resource:this.sampler},{binding:5,resource:{buffer:this.editIntervalsBuffer}},
   {binding:6,resource:{buffer:this.previewRowsBuffer}},{binding:7,resource:{buffer:this.previewIntervalsBuffer}},
   {binding:8,resource:{buffer:this.appliedCutRowsBuffer}},{binding:9,resource:{buffer:this.appliedCutIntervalsBuffer}},
   {binding:11,resource:(this.regionTexture||this.regionDummy()).createView({dimension:'3d'})},
   // the mask texture only once its out-of-memory scope came back clean (an invalid texture would invalidate the whole group)
   {binding:12,resource:(this.editMaskTexture&&this.editMaskBuilt?.ready?this.editMaskTexture:this.regionDummy()).createView({dimension:'3d'})},
   {binding:10,resource:{buffer:this.analysisOverlayBuffer}}
  ]});
 }
 clearEditRuns(){
  this.editRunsInfo='';this.editUpload=null;
  this.editRowsBuffer?.destroy?.();this.editIntervalsBuffer?.destroy?.();
  this.editRowsBuffer=this.device.createBuffer({label:'VRL edit rows empty',size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.editIntervalsBuffer=this.device.createBuffer({label:'VRL edit intervals empty',size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.device.queue.writeBuffer(this.editRowsBuffer,0,new Uint32Array([0,0]));this.device.queue.writeBuffer(this.editIntervalsBuffer,0,new Uint32Array([0]));
  this.editSignature='';if(this.texture&&this.brickBuffer)this.rebuildBindGroup();
 }
 // 1×1×1 r32uint stand-in for binding 11 while no region texture exists
 regionDummy(){
  if(!this._regionDummy)this._regionDummy=this.device.createTexture({label:'VRL region index empty',size:{width:1,height:1,depthOrArrayLayers:1},dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  return this._regionDummy;
 }
 clearAnalysisRuns(){
  this.regionTexture?.destroy?.();this.regionTexture=null;this.regionTexInfo='';this.regionTexSignature='';
  this.analysisOverlayBuffer?.destroy?.();
  this.analysisOverlayBuffer=this.device.createBuffer({label:'VRL analysis overlay empty',size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.device.queue.writeBuffer(this.analysisOverlayBuffer,0,new Uint32Array([0,0]));
  this.analysisOverlaySignature='';this.rebuildBindGroup();
 }
 // regions: [{runs (per-slice y,x0,x1 triples in source voxels), color (0xRRGGBB), focused, segments (shader segment indices, optional)}].
 // Reduced textures point-sample the source, so thin cortical shells would
 // miss most texels (speckled colouring); dilate by one texel as the cut
 // preview does.
 // textureSignature: changes only when the set of regions (ids, runs) changes; colour and focus live in the
 // overlay buffer, so a focus or colour change keeps the region index texture (each rebuild allocated
 // and uploaded 67 MB at 512³ on every tap)
 setAnalysisRuns(regions,v,signature='',textureSignature=signature){
  if(signature&&signature===this.analysisOverlaySignature)return;
  if(!v||!this.textureDims||!regions?.length){this.clearAnalysisRuns();this.analysisOverlaySignature=signature;return}
  const sourceDims=[v.columns,v.rows,v.slices],gridDims=this.textureDims.slice(),[w,h,d]=gridDims;
  if(w>65535)throw new Error('GPU analysis overlay requires width <= 65535');
  const rowCount=h*d,counts=new Uint32Array(rowCount),grids=regions.map(r=>gpuRunsForTexture(r.runs,sourceDims,gridDims,{dilate:this.reducedVolume?1:0}));
  for(const g of grids)if(g)for(let z=0;z<d;z++){const rec=g[z];if(rec)for(let i=0;i<rec.length;i+=3)counts[z*h+rec[i]]++}
  const header=2+rowCount;let total=0;for(let r=0;r<rowCount;r++)total+=counts[r];
  if(!total){this.clearAnalysisRuns();this.analysisOverlaySignature=signature;return}
  // colour table after the pairs: word for region index k (1..14); data[0] points at it
  const tableStart=header+total*2,data=new Uint32Array(tableStart+16),cursor=new Uint32Array(rowCount);data[0]=tableStart;let at=header;
  for(let r=0;r<rowCount;r++){data[1+r]=at;cursor[r]=at;at+=counts[r]*2}
  data[1+rowCount]=at;
  for(let ri=0;ri<grids.length;ri++){
   const g=grids[ri];if(!g)continue;const word=((regions[ri].color>>>0)&0xffffff)|(regions[ri].focused?0x1000000:0)|0x80000000;
   for(let z=0;z<d;z++){const rec=g[z];if(rec)for(let i=0;i<rec.length;i+=3){const row=z*h+rec[i],c=cursor[row];data[c]=((rec[i+2]&65535)<<16)|(rec[i+1]&65535);data[c+1]=word>>>0;cursor[row]=c+2}}
  }
  for(let ri=0;ri<Math.min(grids.length,14);ri++)data[tableStart+1+ri]=(((regions[ri].color>>>0)&0xffffff)|(regions[ri].focused?0x1000000:0)|0x80000000)>>>0;
  // data[tableStart] = mask of the segment indices that have a shown region (unknown segment: all); hits on other segments skip the lookup
  let segMask=0;for(let ri=0;ri<grids.length;ri++){if(!grids[ri])continue;const segs=regions[ri].segments;if(!segs?.length||segs.some(i=>!(i>=0&&i<8)))segMask=0xff;else for(const i of segs)segMask|=1<<i}
  data[tableStart]=segMask;
  // the shader binary-searches each row, so its pairs must be sorted by x0 (regions were appended in region order)
  for(let r=0;r<rowCount;r++){const a=data[1+r],b=data[2+r];if(b-a<=2)continue;const pairs=[];for(let c=a;c<b;c+=2)pairs.push([data[c],data[c+1]]);pairs.sort((x,y)=>(x[0]&65535)-(y[0]&65535));for(let k=0;k<pairs.length;k++){data[a+k*2]=pairs[k][0];data[a+k*2+1]=pairs[k][1]}}
  if(data.byteLength>this.device.limits.maxStorageBufferBindingSize)throw new Error('GPU analysis overlay exceeds storage buffer limit');
  const buffer=this.device.createBuffer({label:'VRL analysis overlay',size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.device.queue.writeBuffer(buffer,0,data);
  // region index texture (4 bits per voxel, 8 per u32 along x; 67 MB at 512³, 8 MB at 256³). Regions past the 14th read 15 = search the row.
  // filled in a mapped staging buffer and copied with one copyBufferToTexture at the 256-byte row pitch the
  // spec requires there (the iPad waited ~120 ms per frame for seconds after a writeTexture of the same data, and the
  // colouring showed stripes meanwhile: a row-wise or chunked upload). Upload time and size go to the status bar.
  if(textureSignature&&this.regionTexture&&textureSignature===this.regionTexSignature){
   this.analysisOverlayBuffer?.destroy?.();this.analysisOverlayBuffer=buffer;this.analysisOverlaySignature=signature;this.rebuildBindGroup();return;
  }
  let tex=null,staging=null;this.regionTexInfo='';this.regionTexSignature=textureSignature;
  try{
   const tw=Math.ceil(w/8),bytesPerRow=Math.ceil(tw*4/256)*256,rowWords=bytesPerRow/4,bytes=bytesPerRow*h*d;
   this.device.pushErrorScope?.('out-of-memory');
   staging=this.device.createBuffer({label:'VRL region index staging',size:bytes,usage:GPUBufferUsage.COPY_SRC,mappedAtCreation:true});
   const words=new Uint32Array(staging.getMappedRange());
   for(let ri=0;ri<grids.length;ri++){const g=grids[ri];if(!g)continue;const k=Math.min(ri+1,15);
    for(let z=0;z<d;z++){const rec=g[z];if(!rec)continue;for(let i=0;i<rec.length;i+=3){const base=(z*h+rec[i])*rowWords;for(let x=rec[i+1];x<=rec[i+2];x++){const wi=base+(x>>3),sh=(x&7)*4;words[wi]=(words[wi]&~(15<<sh))|(k<<sh)}}}}
   staging.unmap();
   tex=this.device.createTexture({label:'VRL region index',size:{width:tw,height:h,depthOrArrayLayers:d},dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const enc=this.device.createCommandEncoder({label:'VRL region index upload'});
   enc.copyBufferToTexture({buffer:staging,bytesPerRow,rowsPerImage:h},{texture:tex},{width:tw,height:h,depthOrArrayLayers:d});
   const t0=performance.now();this.device.queue.submit([enc.finish()]);
   const created=tex,stagingBuf=staging,mb=(bytes/1048576).toFixed(0);
   this.regionTexInfo=tw+'×'+h+'×'+d+' '+mb+' MB 転送中';
   this.device.queue.onSubmittedWorkDone?.()?.then(()=>{stagingBuf.destroy?.();if(this.regionTexture===created)this.regionTexInfo=tw+'×'+h+'×'+d+' '+mb+' MB 転送 '+Math.round(performance.now()-t0)+' ms'}).catch(()=>{});
   // WebGPU reports allocation failure through the error scope, not by throwing: drop the texture (the row search stays correct) when it arrives
   this.device.popErrorScope?.()?.then(err=>{if(err&&this.regionTexture===created){console.warn('Region index texture not available; searching rows instead.',err.message);created.destroy?.();this.regionTexture=null;this.regionTexInfo='なし（'+err.message+'）→ 行検索';this.rebuildBindGroup()}}).catch(()=>{});
  }catch(e){console.warn('Region index texture not available; searching rows instead.',e);tex?.destroy?.();tex=null;staging?.destroy?.();this.regionTexInfo='なし（'+String(e?.message||e)+'）→ 行検索'}
  this.regionTexture?.destroy?.();this.regionTexture=tex;
  this.analysisOverlayBuffer?.destroy?.();this.analysisOverlayBuffer=buffer;this.analysisOverlaySignature=signature;this.rebuildBindGroup();
 }
 clearPreviewRuns(){
  this.previewRowsBuffer?.destroy?.();this.previewIntervalsBuffer?.destroy?.();
  this.previewRowsBuffer=this.device.createBuffer({label:'VRL cut preview rows empty',size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.previewIntervalsBuffer=this.device.createBuffer({label:'VRL cut preview intervals empty',size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.device.queue.writeBuffer(this.previewRowsBuffer,0,new Uint32Array([0,0]));this.device.queue.writeBuffer(this.previewIntervalsBuffer,0,new Uint32Array([0]));
  this.previewSignature='';if(this.texture&&this.brickBuffer&&this.editRowsBuffer&&this.editIntervalsBuffer)this.rebuildBindGroup();
 }
 setPreviewRuns(key,runs,segmentOrder,v){
  const seg=segmentOrder?.indexOf?.(key)??-1;
  if(!v||seg<0||!runs){this.clearPreviewRuns();return}
  const sourceDims=[v.columns,v.rows,v.slices],gridDims=this.textureDims.slice(),gridRuns=gpuRunsForTexture(runs,sourceDims,gridDims,{dilate:this.reducedVolume?1:0});
  const [w,h,d]=gridDims;if(w>65535)throw new Error('GPU cut preview RLE requires width <= 65535');
  const rowCount=h*d;let total=0;
  for(let z=0;z<d;z++)total+=(gridRuns[z]?.length||0)/3;
  if(!total){this.clearPreviewRuns();return}
  const rows=new Uint32Array(2+rowCount),intervals=new Uint32Array(total);rows[0]=seg+1;let cursor=0,rowIndex=0;
  for(let z=0;z<d;z++){
   const rec=gridRuns[z]||null;let ri=0;
   for(let y=0;y<h;y++,rowIndex++){
    rows[1+rowIndex]=cursor;
    while(rec&&ri<rec.length&&rec[ri]===y){const x0=rec[ri+1],x1=rec[ri+2];intervals[cursor++]=((x1&65535)<<16)|(x0&65535);ri+=3}
   }
  }
  rows[1+rowCount]=cursor;
  const maxBinding=this.device.limits.maxStorageBufferBindingSize;
  if(rows.byteLength>maxBinding||intervals.byteLength>maxBinding)throw new Error('GPU cut preview RLE exceeds storage buffer limit');
  const rowsBuffer=this.device.createBuffer({label:'VRL cut preview row index',size:rows.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const intervalsBuffer=this.device.createBuffer({label:'VRL cut preview intervals',size:intervals.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.device.queue.writeBuffer(rowsBuffer,0,rows);this.device.queue.writeBuffer(intervalsBuffer,0,intervals);
  this.previewRowsBuffer?.destroy?.();this.previewIntervalsBuffer?.destroy?.();this.previewRowsBuffer=rowsBuffer;this.previewIntervalsBuffer=intervalsBuffer;
  this.previewSignature=key+':'+gridDims.join('x')+':'+cursor;this.rebuildBindGroup();
 }
 clearAppliedCutRuns(){
  this.cutUpload=null;
  this.appliedCutRowsBuffer?.destroy?.();this.appliedCutIntervalsBuffer?.destroy?.();
  this.appliedCutRowsBuffer=this.device.createBuffer({label:'VRL applied cut rows empty',size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.appliedCutIntervalsBuffer=this.device.createBuffer({label:'VRL applied cut intervals empty',size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.device.queue.writeBuffer(this.appliedCutRowsBuffer,0,new Uint32Array([0,0]));
  this.device.queue.writeBuffer(this.appliedCutIntervalsBuffer,0,new Uint32Array([0]));
  this.appliedCutSignature='';
  if(this.texture&&this.brickBuffer&&this.editRowsBuffer&&this.editIntervalsBuffer&&this.previewRowsBuffer&&this.previewIntervalsBuffer)this.rebuildBindGroup();
 }
 setAppliedCutRuns(edits,segmentOrder,v){
  if(!v||!segmentOrder?.length){this.clearAppliedCutRuns();return}
  const sourceDims=[v.columns,v.rows,v.slices],gridDims=this.textureDims.slice(),[w,h,d]=gridDims;
  if(w>65535)throw new Error('GPU applied cut RLE requires width <= 65535');
  const sourceDescs=segmentOrder.slice(0,4).map(key=>edits?.[key]||null);
  const descs=sourceDescs.map(desc=>desc?.cutRuns?gpuRunsForTexture(desc.cutRuns,sourceDims,gridDims,{dilate:this.reducedVolume?1:0}):null);
  const rowCount=h*d;let activeMask=0,total=0;
  for(let si=0;si<descs.length;si++){
   const runs=descs[si];if(!runs)continue;let count=0;
   for(let z=0;z<d;z++)count+=(runs[z]?.length||0)/3;
   if(count){activeMask|=(1<<si);total+=count}
  }
  if(!activeMask){this.clearAppliedCutRuns();return}
  const offsets=new Uint32Array(1+4*(rowCount+1)),intervals=new Uint32Array(Math.max(1,total));offsets[0]=activeMask;let cursor=0;
  for(let si=0;si<4;si++){
   const runs=descs[si]||null,base=1+si*(rowCount+1);let rowIndex=0;
   for(let z=0;z<d;z++){
    const rec=runs?.[z]||null;let ri=0;
    for(let y=0;y<h;y++,rowIndex++){
     offsets[base+rowIndex]=cursor;
     while(rec&&ri<rec.length&&rec[ri]===y){const x0=rec[ri+1],x1=rec[ri+2];intervals[cursor++]=((x1&65535)<<16)|(x0&65535);ri+=3}
    }
   }
   offsets[base+rowCount]=cursor;
  }
  const maxBinding=this.device.limits.maxStorageBufferBindingSize;
  if(offsets.byteLength>maxBinding||intervals.byteLength>maxBinding)throw new Error('GPU applied cut RLE exceeds storage buffer limit');
  const rowsBuffer=this.device.createBuffer({label:'VRL applied cut row index',size:offsets.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const intervalsBuffer=this.device.createBuffer({label:'VRL applied cut intervals',size:intervals.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.device.queue.writeBuffer(rowsBuffer,0,offsets);this.device.queue.writeBuffer(intervalsBuffer,0,intervals);
  this.appliedCutRowsBuffer?.destroy?.();this.appliedCutIntervalsBuffer?.destroy?.();this.appliedCutRowsBuffer=rowsBuffer;this.appliedCutIntervalsBuffer=intervalsBuffer;
  this.cutUpload={offsets,intervals,activeMask}; // what the mask texture is built from
  this.appliedCutSignature=gridDims.join('x')+':'+String(activeMask)+':'+String(cursor);this.rebuildBindGroup();
 }
 // the row buffers, then the voxel bit mask texture from exactly what they hold (rebuilt only when that changed)
 setEditRuns(edits,segmentOrder,v){
  try{this.setEditRows(edits,segmentOrder,v)}finally{this.updateEditMaskTexture()}
 }
 setEditRows(edits,segmentOrder,v){
  if(!v||!segmentOrder?.length){this.clearEditRuns();this.clearAppliedCutRuns();return}
  this.setAppliedCutRuns(edits,segmentOrder,v);
  const sourceDims=[v.columns,v.rows,v.slices],gridDims=this.textureDims.slice(),[w,h,d]=gridDims;
  if(w>65535)throw new Error('GPU edit RLE requires width <= 65535');
  const sourceDescs=segmentOrder.slice(0,4).map(key=>edits?.[key]||null);
  const descs=sourceDescs.map(desc=>{
   if(!desc?.runs)return null;
   return{mode:desc.mode,maskOnly:!!desc.maskOnly,runs:gpuRunsForTexture(desc.runs,sourceDims,gridDims,{dilate:this.reducedVolume&&desc.mode==='exclude'?1:0})};
  });
  const rowCount=h*d;let activeMask=0,keepMask=0,total=0;
  for(let si=0;si<descs.length;si++){
   const desc=descs[si];if(!desc)continue;activeMask|=(1<<si);if(desc.mode==='keep')keepMask|=(1<<si);if(desc.maskOnly)keepMask|=(16<<si);
   for(let z=0;z<d;z++)total+=(desc.runs?.[z]?.length||0)/3;
  }
  if(!activeMask){this.clearEditRuns();return}
  // brick occupancy of the mask-only segments after the row index (brickClass reads it there)
  const occupancy=editBrickOccupancy(descs,gridDims,this.brickSize);
  const offsets=new Uint32Array(2+4*(rowCount+1)+(occupancy?occupancy.length:0)),intervals=new Uint32Array(Math.max(1,total));offsets[0]=activeMask;offsets[1]=keepMask;let cursor=0;
  if(occupancy)offsets.set(occupancy,2+4*(rowCount+1));
  for(let si=0;si<4;si++){
   const desc=descs[si],base=2+si*(rowCount+1);let rowIndex=0;
   for(let z=0;z<d;z++){
    const rec=desc?.runs?.[z]||null;let ri=0;
    for(let y=0;y<h;y++,rowIndex++){
     offsets[base+rowIndex]=cursor;
     while(rec&&ri<rec.length&&rec[ri]===y){const x0=rec[ri+1],x1=rec[ri+2];intervals[cursor++]=((x1&65535)<<16)|(x0&65535);ri+=3}
    }
   }
   offsets[base+rowCount]=cursor;
  }
  const maxBinding=this.device.limits.maxStorageBufferBindingSize;
  if(offsets.byteLength>maxBinding||intervals.byteLength>maxBinding)throw new Error('GPU edit RLE exceeds storage buffer limit');
  const rowsBuffer=this.device.createBuffer({label:'VRL edit row index',size:offsets.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const intervalsBuffer=this.device.createBuffer({label:'VRL edit intervals',size:intervals.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.device.queue.writeBuffer(rowsBuffer,0,offsets);this.device.queue.writeBuffer(intervalsBuffer,0,intervals);
  this.editRowsBuffer?.destroy?.();this.editIntervalsBuffer?.destroy?.();this.editRowsBuffer=rowsBuffer;this.editIntervalsBuffer=intervalsBuffer;
  this.editUpload={offsets,intervals,activeMask};
  // diagnostics: what the GPU edit mask holds, per segment index (mode and interval count), for the status bar
  this.editRunsInfo=descs.map((desc,si)=>{if(!desc)return null;let n=0;for(let z=0;z<d;z++)n+=(desc.runs?.[z]?.length||0)/3;return si+':'+desc.mode+' '+n+'区間'}).filter(Boolean).join(' ');
  this.editSignature=gridDims.join('x')+':'+String(activeMask)+':'+String(keepMask)+':'+String(cursor);this.rebuildBindGroup();
 }
 // edit / applied-cut voxel bit mask (edit-mask-texture.js) for volumeShader. Built from the uploaded offsets /
 // intervals (dilation and grid mapping included), so every bit is the row search's decision. Kept while the uploads are
 // byte-identical (a re-sync with the same edits does not rebuild it). Staging buffer + one copyBufferToTexture as the
 // region texture. It is used only after its out-of-memory error scope came back clean; a failure, the size cap
 // or a missing texture keeps the row search (mprWindow.z = 0), which gives the same pixels.
 updateEditMaskTexture(){
  const edit=this.editUpload||null,cut=this.cutUpload||null,dims=this.textureDims.slice(),b=this.editMaskBuilt;
  const same=(a,c)=>a===c||(!!a&&!!c&&a.activeMask===c.activeMask&&sameU32(a.offsets,c.offsets)&&sameU32(a.intervals,c.intervals));
  if(b&&this.editMaskTexture&&b.dims.join('x')===dims.join('x')&&same(b.edit,edit)&&same(b.cut,cut)){b.edit=edit;b.cut=cut;return}
  this.dropEditMaskTexture();
  if(!edit&&!cut)return;
  const planes=editMaskPlanes(edit?.activeMask||0,cut?.activeMask||0),layout=editMaskLayout(dims,planes.count);
  if(!layout||typeof this.device?.createTexture!=='function')return;
  const lim=this.device.limits||{},cap=Math.min(EDIT_MASK_MAX_BYTES,lim.maxBufferSize||Infinity),dimCap=lim.maxTextureDimension3D||2048,mb=(layout.bytes/1048576).toFixed(0);
  if(layout.bytes>cap||layout.width>dimCap||layout.height>dimCap||layout.depth>dimCap){this.editMaskInfo='なし（'+mb+' MB）→ 区間検索';return}
  let tex=null,staging=null,pushed=false;
  try{
   this.device.pushErrorScope?.('out-of-memory');pushed=!!this.device.pushErrorScope;
   staging=this.device.createBuffer({label:'VRL edit mask staging',size:layout.bytes,usage:GPUBufferUsage.COPY_SRC,mappedAtCreation:true});
   fillEditMaskWords(layout,planes.table,edit,cut,new Uint32Array(staging.getMappedRange()));
   staging.unmap();
   tex=this.device.createTexture({label:'VRL edit mask',size:{width:layout.width,height:layout.height,depthOrArrayLayers:layout.depth},dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const enc=this.device.createCommandEncoder({label:'VRL edit mask upload'});
   enc.copyBufferToTexture({buffer:staging,bytesPerRow:layout.bytesPerRow,rowsPerImage:layout.height},{texture:tex},{width:layout.width,height:layout.height,depthOrArrayLayers:layout.depth});
   this.device.queue.submit([enc.finish()]);
   const created=tex,stagingBuf=staging,state={edit,cut,dims,layout,table:planes.table,ready:!pushed};
   this.device.queue.onSubmittedWorkDone?.()?.then(()=>stagingBuf.destroy?.()).catch(()=>{});
   this.editMaskTexture=tex;this.editMaskBuilt=state;this.editMaskInfo=layout.bits+'bit '+mb+' MB';this.rebuildBindGroup();
   if(pushed){pushed=false;this.device.popErrorScope().then(err=>{if(this.editMaskTexture!==created)return;
    if(err){console.warn('Edit mask texture not available; searching rows instead.',err.message);this.dropEditMaskTexture();this.editMaskInfo='なし（'+err.message+'）→ 区間検索'}
    else{state.ready=true;this.rebuildBindGroup();this.onRedraw?.()}}).catch(()=>{})}
  }catch(e){
   console.warn('Edit mask texture not available; searching rows instead.',e);
   if(pushed){try{this.device.popErrorScope().catch(()=>{})}catch{}}
   if(this.editMaskTexture===tex){this.editMaskTexture=null;this.editMaskBuilt=null}
   tex?.destroy?.();staging?.destroy?.();this.editMaskInfo='なし（'+String(e?.message||e)+'）→ 区間検索';this.rebuildBindGroup();
  }
 }
 // the bind group is rebuilt when a texture was bound: a group holding the destroyed texture fails every later submit (3D stops drawing)
 dropEditMaskTexture(){const had=this.editMaskTexture;this.editMaskTexture=null;this.editMaskBuilt=null;this.editMaskInfo='';if(had){this.rebuildBindGroup();had.destroy?.();this.onRedraw?.()}}
 // mprWindow.z / .w of the frame: the layout word and plane table while the texture holds the current uploads, else 0 (row search)
 editMaskUniform(){
  // globalThis.__vrlEditMaskTex=false (console): the row search for an A/B of the frame time on the device
  const b=this.editMaskBuilt;
  if(globalThis.__vrlEditMaskTex!==false&&this.editMaskTexture&&b?.ready&&b.edit===(this.editUpload||null)&&b.cut===(this.cutUpload||null)&&b.dims.join('x')===this.textureDims.join('x'))return[editMaskInfoWord(b.layout),b.table];
  return[0,0];
 }
 ensurePickCapacity(count){
  if(count<=this.pickCapacity&&this.pickBuffer&&this.pickOutput)return;
  let cap=1;while(cap<count)cap<<=1;this.pickBuffer?.destroy?.();this.pickOutput?.destroy?.();
  this.pickBuffer=this.device.createBuffer({label:'VRL volume batch picks',size:(cap+1)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.pickOutput=this.device.createBuffer({label:'VRL volume batch pick output',size:cap*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});this.pickCapacity=cap;
 }
 hasResident(v){
  return !!(this.texture&&v?.series&&this.seriesId===v.series.id);
 }
 isReduced(v){
  return !!(this.reducedVolume&&this.hasResident(v));
 }
 hasPreview(v){
  return !!(this.previewVolume&&this.hasResident(v));
 }
 previewPlane(v,plane,index){
  if(!this.hasPreview(v))return null;
  const preview=this.previewVolume,[pw,ph,pd]=preview.dims,[w,h,d]=preview.sourceDims,data=preview.data,map=(value,srcN,dstN)=>dstN<=1?0:Math.max(0,Math.min(dstN-1,Math.round(value*(dstN-1)/Math.max(srcN-1,1))));
  if(plane==='axial'){
   const pz=map(index,d,pd),n=pw*ph;return{values:data.subarray(pz*n,(pz+1)*n),dims:[pw,ph],encoded:true,calibration:this.calibration};
  }
  if(plane==='coronal'){
   const py=map(index,h,ph),n=pw*pd;let out=this.previewPlaneBuffers.coronal;
   if(!out||out.length!==n)out=this.previewPlaneBuffers.coronal=new Uint16Array(n);
   for(let oy=0;oy<pd;oy++){const pz=pd-1-oy,src=pz*pw*ph+py*pw,dst=oy*pw;out.set(data.subarray(src,src+pw),dst)}
   return{values:out,dims:[pw,pd],encoded:true,calibration:this.calibration};
  }
  if(plane==='sagittal'){
   const px=map(index,w,pw),n=ph*pd;let out=this.previewPlaneBuffers.sagittal;
   if(!out||out.length!==n)out=this.previewPlaneBuffers.sagittal=new Uint16Array(n);
   let q=0;for(let oy=0;oy<pd;oy++){const pz=pd-1-oy,base=pz*pw*ph;for(let py=0;py<ph;py++)out[q++]=data[base+py*pw+px]}
   return{values:out,dims:[ph,pd],encoded:true,calibration:this.calibration};
  }
  return null;
 }
 // allowReduced: also read from a reduced texture (lower resolution); only
 // for previews while a slider moves, never for values cached as exact.
 extractPlane(v,plane,index,{maxSide=0,allowReduced=false}={}){
  const run=async()=>{
   if(!this.hasResident(v)||(this.reducedVolume&&!allowReduced))return null;
   const w=v.columns,h=v.rows,d=v.slices,kind=plane==='axial'?0:plane==='coronal'?1:plane==='sagittal'?2:-1;
   if(kind<0)throw new Error('Unsupported MPR plane: '+plane);
   const maxIndex=kind===0?d-1:kind===1?h-1:w-1;if(index<0||index>maxIndex)throw new Error('MPR plane index out of range');
   const fullW=kind===0?w:kind===1?w:h,fullH=kind===0?h:d;
   let outW=fullW,outH=fullH;
   if(maxSide>0&&Math.max(fullW,fullH)>maxSide){
    const ratio=maxSide/Math.max(fullW,fullH);outW=Math.max(1,Math.round(fullW*ratio));outH=Math.max(1,Math.round(fullH*ratio));
   }
   const count=outW*outH,bytes=count*4;
   if(bytes>(this.device.limits.maxStorageBufferBindingSize||bytes))return null;
   const paramsBytes=new ArrayBuffer(48),u32=new Uint32Array(paramsBytes),f32=new Float32Array(paramsBytes);
   u32.set([w,h,d,0,kind,index,outW,outH],0);f32.set([this.calibration.slope,this.calibration.intercept,this.calibration.signedBias,0],8);
   const uniform=this.device.createBuffer({label:'VRL resident MPR params',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   this.device.queue.writeBuffer(uniform,0,paramsBytes);
   const output=this.device.createBuffer({label:'VRL resident MPR output',size:Math.max(4,bytes),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=this.device.createBuffer({label:'VRL resident MPR readback',size:Math.max(4,bytes),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{
    const group=this.device.createBindGroup({layout:this.mprPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:this.texture.createView({dimension:'3d'})},{binding:2,resource:{buffer:output}}]}),encoder=this.device.createCommandEncoder({label:'VRL resident MPR extract'}),pass=encoder.beginComputePass();
    pass.setPipeline(this.mprPipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/256));pass.end();encoder.copyBufferToBuffer(output,0,read,0,bytes);this.device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange().slice(0,bytes));read.unmap();return{values,dims:[outW,outH],fullDims:[fullW,fullH]};
   }finally{
    try{if(read.mapState==='mapped')read.unmap()}catch{}uniform.destroy();output.destroy();read.destroy();
   }
  };
  return run();
 }
 // raw copy of the resident texture for the VR view (same rg8
 // packed u16 bytes as uploaded), slice by slice in chunks, so VR need not
 // read and filter the DICOM files again. Returns null when it cannot.
 async readPackedTexture(onProgress=()=>{}){
  if(!this.texture)return null;
  const [w,h,d]=this.textureDims,plane=w*h;if(plane%2)return null;
  // 8 MB per read-back (was 32): the copy of one chunk into the result runs on the main thread, which a VR session (a data switch reads the volume back while frames run) cannot give 10 ms in one piece
  const device=this.device,sliceBytes=plane*2,chunk=Math.max(1,Math.min(d,Math.floor(Math.min(8*1024*1024,device.limits.maxStorageBufferBindingSize||8*1024*1024)/sliceBytes)));
  this.packPipeline||=device.createComputePipeline({label:'VRL texture pack',layout:'auto',compute:{module:device.createShaderModule({label:'VRL texture pack',code:`
@group(0) @binding(0) var tex:texture_3d<f32>;
@group(0) @binding(1) var<storage,read_write> outWords:array<u32>;
@group(0) @binding(2) var<uniform> p:vec4<u32>; // w, h, z0, pairs
fn word(i:u32)->u32{
 let x=i%p.x;let y=(i/p.x)%p.y;let z=p.z+i/(p.x*p.y);
 let q=textureLoad(tex,vec3<i32>(i32(x),i32(y),i32(z)),0).rg;
 return u32(round(q.x*255.0))|(u32(round(q.y*255.0))<<8u);
}
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let k=g.x+g.y*65535u*256u;if(k>=p.w){return;}
 outWords[k]=word(k*2u)|(word(k*2u+1u)<<16u);
}`}),entryPoint:'main'}});
  const out=new Uint8Array(plane*d*2),bytes=chunk*sliceBytes;
  const storage=device.createBuffer({label:'VRL texture pack out',size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const read=device.createBuffer({label:'VRL texture pack read',size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const uniform=device.createBuffer({label:'VRL texture pack params',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  try{
   for(let z0=0;z0<d;z0+=chunk){
    const n=Math.min(chunk,d-z0),pairs=plane*n/2,groups=Math.ceil(pairs/256);
    device.queue.writeBuffer(uniform,0,new Uint32Array([w,h,z0,pairs]));
    const group=device.createBindGroup({layout:this.packPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture.createView({dimension:'3d'})},{binding:1,resource:{buffer:storage}},{binding:2,resource:{buffer:uniform}}]});
    const enc=device.createCommandEncoder({label:'VRL texture pack'}),pass=enc.beginComputePass();
    pass.setPipeline(this.packPipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.min(groups,65535),Math.ceil(groups/65535));pass.end();
    enc.copyBufferToBuffer(storage,0,read,0,n*sliceBytes);device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ,0,n*sliceBytes);out.set(new Uint8Array(read.getMappedRange(0,n*sliceBytes)),z0*sliceBytes);read.unmap();
    onProgress(z0+n,d);
   }
  }finally{try{if(read.mapState==='mapped')read.unmap()}catch{}storage.destroy();read.destroy();uniform.destroy()}
  return{data:out,dims:[w,h,d]};
 }
 setActive(active){if(!active&&typeof document!=='undefined'){const el=document.getElementById('gpu-frame-time');if(el)el.textContent=''}
  this.active=!!active;this.canvas.style.display=this.active?'block':'none';
 }
 // while dragging, the pixel budget of the tier is scaled by the
 // measured GPU time of the volume pass: over 10 ms (a 60 Hz frame cannot
 // hold it with the present) one step down, under 5 ms one step up; steps
 // 1 / 0.7 / 0.5 / 0.35, at most every 300 ms, kept between drags
 setInteractive(active,tier=0){
  const next=!!active,nextTier=next?Math.max(0,Math.min(2,Math.round(+tier||0))):0;
  if(this.interactive===next&&this.interactionTier===nextTier)return;
  this.interactive=next;this.interactionTier=nextTier;this.resize();
 }
 // GPU frame time + canvas size in the status bar (4 updates/s at most)
 showFrameTime(){
  const now=performance.now();if(now-(this._frameShownAt||0)<250)return;this._frameShownAt=now;
  const el=typeof document!=='undefined'&&document.getElementById('gpu-frame-time');if(!el)return;if(globalThis.__vrlSettings?.get?.('showPerf')===false){el.textContent='';return}
  const ms=this.lastFrameMs;const gap=this.frameGapMs,js=globalThis.__vrlThreeRenderMs;
  el.textContent=' · 3D '+Math.round(ms)+' ms · 待ち '+Math.round(this.queueWaitMs||0)+' ms'+(js!=null?' · three '+Math.round(js)+' ms':'')+(gap!=null&&gap<2000?' · 間隔 '+Math.round(gap)+' ms ('+Math.round(1000/Math.max(gap,1))+' fps)'+this.gapStats():'')+(this.regionTexInfo?' · 領域tex '+this.regionTexInfo:'')+(this.editRunsInfo?' · 編集 '+this.editRunsInfo:'')+(this.editMaskInfo?' · 編集tex '+this.editMaskInfo:'')+' · '+(this.renderW||this.canvas.width)+'×'+(this.renderH||this.canvas.height)+' · resize '+(this.resizeCount||0)+'/'+(globalThis.__vrlThreeResizes||0)+' · drag targets '+(this.lowTargetCount||0)+(this.interactive?' '+(document.documentElement.lang==='en'?'dragging':'操作中'):'');
 }
 // frames in the last second while dragging: count, longest gap, gaps over 20 ms (a 60 Hz frame missed)
 gapStats(){
  const g=this._gaps;if(!this.interactive||!g?.length)return'';let n=0,mx=0,drops=0;for(let k=1;k<g.length;k+=2){n++;if(g[k]>mx)mx=g[k];if(g[k]>20)drops++}
  return' [1秒: '+n+' 枚, 最大 '+Math.round(mx)+' ms, 落ち '+drops+']';
 }
 dropLowTargets(){for(const t of (this.lowTargets||new Map()).values())t.texture.destroy?.();this.lowTargets=new Map()}
 // one texture per drag size, kept until the canvas size changes
 lowTarget(w,h){
  this.lowTargets=this.lowTargets||new Map();const key=w+'x'+h;let t=this.lowTargets.get(key);
  if(!t){
   const texture=this.device.createTexture({label:'VRL volume drag target',size:{width:w,height:h},format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
   if(!this.blitPipeline){
    const module=this.device.createShaderModule({label:'VRL volume blit',code:`@group(0) @binding(0) var t:texture_2d<f32>;@group(0) @binding(1) var s:sampler;
struct O{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->O{var P=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));let q=P[i];var o:O;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;}
@fragment fn fs(i:O)->@location(0) vec4<f32>{return textureSampleLevel(t,s,i.uv,0.0);}`});
    this.blitPipeline=this.device.createRenderPipeline({label:'VRL volume blit',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list'}});
    this.blitSampler=this.device.createSampler({magFilter:'linear',minFilter:'linear'});
   }
   const group=this.device.createBindGroup({layout:this.blitPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.blitSampler}]});
   t={texture,view:texture.createView(),group};this.lowTargets.set(key,t);this.lowTargetCount=(this.lowTargetCount||0)+1;
  }
  return t;
 }
 resize(force=false){
  const hostW=this.host.clientWidth,hostH=this.host.clientHeight;if(hostW<8||hostH<8)return;
  const dpr=window.devicePixelRatio||1;
  const interactiveRatios=[0.72,0.58,0.46],cfg=globalThis.__vrlSettings,budgets=this.interactive?[0,1,2].map(t=>cfg?.dragBudget?.(t)??[0.25e6,0.18e6,0.12e6][t]):[cfg?.restBudget?.()??1.0e6];
  const lowered=this.interactive&&cfg?.get?.('dragLowerRes')!==false;
  const fit=(r,b)=>{if(hostW*hostH*r*r>b)r=Math.sqrt(b/(hostW*hostH));return[Math.max(1,Math.floor(hostW*r)),Math.max(1,Math.floor(hostH*r))]};
  const [w,h]=fit(Math.min(dpr,1.5),cfg?.restBudget?.()??1.0e6);
  if(force||this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.resizeCount=(this.resizeCount||0)+1;this.dropLowTargets()}
  const [rw,rh]=lowered?fit(Math.min(dpr,interactiveRatios[this.interactionTier]||interactiveRatios[0]),(budgets[this.interactionTier]||budgets[0])):[w,h];
  this.renderW=Math.min(rw,w);this.renderH=Math.min(rh,h);
 }
 render(camera,obj,segmentState,segmentOrder,mpr={}){
  if(!this.active||!this.texture||!this.bindGroup||!obj)return;
  this.lastMpr=mpr; // a pick re-renders the frame; it must be the frame on screen (section / MPR planes included), not an uncut one
  this.resize();camera.updateMatrixWorld(true);obj.updateMatrixWorld(true);
  const inv=this.tmpInv.copy(obj.matrixWorld).invert(),origin=camera.getWorldPosition(this.tmpOrigin).applyMatrix4(inv),q=camera.getWorldQuaternion(this.tmpQuat);
  const right=this.tmpRight.set(1,0,0).applyQuaternion(q).transformDirection(inv),up=this.tmpUp.set(0,1,0).applyQuaternion(q).transformDirection(inv),forward=this.tmpForward.set(0,0,-1).applyQuaternion(q).transformDirection(inv);
  const data=this.frameData,put=(slot,a,b,c,d)=>{const i=slot*4;data[i]=a;data[i+1]=b;data[i+2]=c;data[i+3]=d};
  put(0,origin.x,origin.y,origin.z,0);put(1,right.x,right.y,right.z,Math.tan(THREE.MathUtils.degToRad(camera.fov*.5)));put(2,up.x,up.y,up.z,camera.aspect);put(3,forward.x,forward.y,forward.z,0);
  const interactionStep=this.interactive?[1.65,2.0,2.5][this.interactionTier]||1.65:1;put(4,this.halfExtents[0],this.halfExtents[1],this.halfExtents[2],this.step*interactionStep*(globalThis.__vrlSettings?.stepScale?.()??1));
  put(5,this.volume.columns,this.volume.rows,this.volume.slices,this.calibration.slope);put(6,this.calibration.intercept,this.calibration.signedBias,this.brickDims[0],this.brickDims[1]);put(7,this.renderW||this.canvas.width,this.renderH||this.canvas.height,this.brickDims[2],this.brickSize);
  for(let s=0;s<4;s++){
   const key=segmentOrder[s],seg=segmentState[key],enabled=seg?.active&&seg?.enabled?1:0,color=new THREE.Color(seg?.color||'#ffffff');
   put(8+s*2,seg?.min||0,seg?.max||0,seg?.opacity??1,enabled);put(9+s*2,color.r,color.g,color.b,1);
  }
  const indices=mpr.indices||[0,0,0],visible=mpr.visible||[0,0,0];
  put(16,+indices[0]||0,+indices[1]||0,+indices[2]||0,Number.isFinite(+mpr.opacity)?Math.max(0,Math.min(1,+mpr.opacity)):0);
  put(17,visible[0]?1:0,visible[1]?1:0,visible[2]?1:0,globalThis.__vrlSettings?.refineMode?.()??1);
  const em=this.editMaskUniform(); // edit mask texture layout (z) and plane table (w)
  put(18,Number.isFinite(+mpr.windowCenter)?+mpr.windowCenter:0,Math.max(1,Number.isFinite(+mpr.windowWidth)?+mpr.windowWidth:1),em[0],em[1]);
  const section=mpr.section||{},plane=section.plane,active=section.active&&plane,mode=plane==='axial'?1:plane==='coronal'?2:plane==='sagittal'?3:0;
  let coord=0;
  if(active&&this.volume){
   const idx=Number.isFinite(+section.index)?+section.index:0,w=this.volume.columns,h=this.volume.rows,d=this.volume.slices;
   if(mode===1)coord=((idx+.5)/Math.max(d,1)*2-1)*this.halfExtents[2];
   else if(mode===2)coord=(1-(idx+.5)/Math.max(h,1)*2)*this.halfExtents[1];
   else if(mode===3)coord=((idx+.5)/Math.max(w,1)*2-1)*this.halfExtents[0];
  }
  // kept side = sign·(axis − coord) ≥ 0, the same rule as section-view.js sectionLocalNormal: coronal and
  // sagittal base normals point to −y / −x (the 3D plane views now face those planes from the other side, as 2D draws them)
  put(19,active?mode:0,coord,(section.reverse?-1:1)*(mode===2||mode===3?-1:1),this.regionTexture?1:0);
  put(20,section.capEnabled?1:0,Number.isFinite(+section.capOpacity)?Math.max(0,Math.min(1,+section.capOpacity)):.85,section.hatch?1:0,28);
  put(21,this.textureDims[0],this.textureDims[1],this.textureDims[2],globalThis.__vrlSettings?.interpLevel?.()??1);
  const bg=canvasBackground3dUnit();put(22,bg[0],bg[1],bg[2],1); // the 3D background follows the theme; no re-upload of the volume
  // the material preset of each segment slot (lighting.js MATERIALS: ambient, spec, shininess), appended after background (segMat)
  for(let s=0;s<4;s++){const m=MATERIALS[materialKey(segmentState[segmentOrder[s]]?.material)];put(23+s,m.ambient,m.spec,m.shininess,0)}
  this.device.queue.writeBuffer(this.uniformBuffer,0,data);
  const low=(this.renderW&&(this.renderW!==this.canvas.width||this.renderH!==this.canvas.height))?this.lowTarget(this.renderW,this.renderH):null;
  const encoder=this.device.createCommandEncoder({label:'VRL volume frame'}),canvasView=this.context.getCurrentTexture().createView(),view=low?low.view:canvasView,pass=encoder.beginRenderPass({colorAttachments:[{view,clearValue:{r:canvasBackground3dUnit()[0],g:canvasBackground3dUnit()[1],b:canvasBackground3dUnit()[2],a:1},loadOp:'clear',storeOp:'store'}]});
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.draw(3);pass.end();
  if(low){const bp=encoder.beginRenderPass({colorAttachments:[{view:canvasView,loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});bp.setPipeline(this.blitPipeline);bp.setBindGroup(0,low.group);bp.draw(3);bp.end()}
  // diagnostics (640x343 took longer than 1516x813, so the time is
  // not the ray casting alone): wait = GPU work queued before this frame,
  // lastFrameMs = this volume pass after that, gap = time between frames
  const fq=this.device.queue,measure=!this._frameTimerPending&&fq.onSubmittedWorkDone,now=performance.now();
  if(this._lastRenderAt){this.frameGapMs=now-this._lastRenderAt;
   // per-second frame statistics for the status bar (a single gap sample hid the dropped frames)
   if(this.interactive&&this.frameGapMs<250){const g=this._gaps=this._gaps||[];g.push(now,this.frameGapMs);while(g.length&&g[0]<now-1000)g.splice(0,2)}}
  this._lastRenderAt=now;
  let before=null;if(measure){this._frameTimerPending=true;before=fq.onSubmittedWorkDone().then(()=>performance.now())}
  fq.submit([encoder.finish()]);
  if(measure){const t0=now;Promise.all([before,fq.onSubmittedWorkDone().then(()=>performance.now())]).then(([tb,te])=>{this.queueWaitMs=Math.max(0,tb-t0);this.lastFrameMs=te-Math.max(t0,tb);this._frameTimerPending=false;this.showFrameTime()},()=>{this._frameTimerPending=false})}
 }
 async pickMany(points,camera,obj,segmentState,segmentOrder,preferredKey=null){
  if(!this.active||!this.texture||!this.bindGroup||!obj||!points?.length)return points?.map(()=>null)||[];
  this.render(camera,obj,segmentState,segmentOrder,this.lastMpr||{});const count=points.length;this.ensurePickCapacity(count);
  const rect=this.rendererCanvas.getBoundingClientRect(),data=new Float32Array((count+1)*4);data[0]=count;
  const preferred=preferredKey?segmentOrder.indexOf(preferredKey):-1;
  for(let i=0;i<count;i++){const p=points[i],base=(i+1)*4;data[base]=(p.clientX-rect.left)/Math.max(rect.width,1)*(this.renderW||this.canvas.width);data[base+1]=(p.clientY-rect.top)/Math.max(rect.height,1)*(this.renderH||this.canvas.height);data[base+2]=preferred>=0?preferred+1:0}
  this.device.queue.writeBuffer(this.pickBuffer,0,data);
  const zero=new Uint32Array(count*4);this.device.queue.writeBuffer(this.pickOutput,0,zero);
  const group=this.device.createBindGroup({layout:this.pickPipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.texture.createView({dimension:'3d'})},{binding:2,resource:{buffer:this.editRowsBuffer}},
   {binding:3,resource:{buffer:this.pickBuffer}},{binding:4,resource:{buffer:this.pickOutput}},{binding:5,resource:{buffer:this.editIntervalsBuffer}}
  ]});
  const bytes=count*16,read=this.device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=this.device.createCommandEncoder({label:'VRL volume batch pick'}),pass=encoder.beginComputePass();
  pass.setPipeline(this.pickPipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();encoder.copyBufferToBuffer(this.pickOutput,0,read,0,bytes);this.device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);const out=new Uint32Array(read.getMappedRange().slice(0));read.unmap();read.destroy();
  const result=new Array(count);
  for(let i=0;i<count;i++){const b=i*4,index=out[b+3];result[i]=index?{x:out[b],y:out[b+1],z:out[b+2],key:segmentOrder[index-1]}:null}
  return result;
 }
 async pick(clientX,clientY,camera,obj,segmentState,segmentOrder,preferredKey=null){
  const result=await this.pickMany([{clientX,clientY}],camera,obj,segmentState,segmentOrder,preferredKey);return result[0]||null;
 }
 resetData(){this.dataGeneration=(this.dataGeneration|0)+1;this.setActive(false);this.dropEditMaskTexture();this.texture?.destroy?.();this.brickBuffer?.destroy?.();this.texture=null;this.brickBuffer=null;this.bindGroup=null;this.seriesId=null;this.bricksReady=false;this.previewVolume=null;this.previewPlaneBuffers={coronal:null,sagittal:null};this.volume=null;this.textureDims=[1,1,1];this.reducedVolume=false;this.textureBytes=0;this.planSignature='';this.clearEditRuns();this.clearPreviewRuns();this.clearAppliedCutRuns();this.clearAnalysisRuns()} // the region index texture (r32uint, 67 MB at 512³) and the overlay buffer belong to the old grid too: released here, not at the next clearAnalysisRuns
 destroy(){this.resetData();this.regionTexture?.destroy?.();this._regionDummy?.destroy?.();this.uniformBuffer?.destroy?.();this.pickBuffer?.destroy?.();this.pickOutput?.destroy?.();this.editRowsBuffer?.destroy?.();this.editIntervalsBuffer?.destroy?.();this.previewRowsBuffer?.destroy?.();this.previewIntervalsBuffer?.destroy?.();this.analysisOverlayBuffer?.destroy?.();this.appliedCutRowsBuffer?.destroy?.();this.appliedCutIntervalsBuffer?.destroy?.();this.mprUniformBuffer?.destroy?.();this.canvas.remove()}
}


const runPipelineCache=new WeakMap();
function runPipeline(device){
 let pipeline=runPipelineCache.get(device);if(pipeline)return pipeline;
 const module=device.createShaderModule({label:'VRL raw DICOM analysis RLE',code:safeWgsl(`
struct Counter{value:atomic<u32>};
@group(0) @binding(0) var volumeTex:texture_3d<f32>;
@group(0) @binding(1) var<storage,read> meta:array<u32>;
@group(0) @binding(2) var<storage,read> params:array<f32>;
@group(0) @binding(3) var<storage,read_write> records:array<u32>;
@group(0) @binding(4) var<storage,read_write> counter:Counter;
fn valueAt(x:u32,y:u32,z:u32)->f32{
 let q=round(textureLoad(volumeTex,vec3<i32>(i32(x),i32(y),i32(z)),0).rg*255.0);
 let raw=q.x+q.y*256.0-params[4];return raw*params[2]+params[3];
}
fn inside(x:u32,y:u32,z:u32)->bool{let v=valueAt(x,y,z);return v>=params[0]&&v<=params[1];}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let w=meta[0];let h=meta[1];let d=meta[2];let n=w*h*d;let i=gid.x;if(i>=n){return;}
 let x=i%w;let y=(i/w)%h;let z=i/(w*h);if(!inside(x,y,z)){return;}if(x>0u&&inside(x-1u,y,z)){return;}
 var x1=x;loop{if(x1+1u>=w||!inside(x1+1u,y,z)){break;}x1++;}
 let slot=atomicAdd(&counter.value,1u)*4u;records[slot]=z;records[slot+1u]=y;records[slot+2u]=x;records[slot+3u]=x1;
}`)});
 pipeline=device.createComputePipeline({label:'VRL raw DICOM analysis RLE',layout:'auto',compute:{module,entryPoint:'main'}});runPipelineCache.set(device,pipeline);return pipeline;
}
function smallStorage(device,data){
 const buffer=device.createBuffer({size:Math.max(16,Math.ceil(data.byteLength/4)*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,data);return buffer;
}
export async function extractSourceThresholdRuns(device,series,zStart,depth,seg){
 const coreDepth=Math.min(depth,series.slices.length-zStart),w=series.columns,h=series.rows,first=series.slices[zStart];
 if(coreDepth<=0)return{items:new Uint32Array(0),coreDepth:0};
 if(first.bits!==16||first.samples!==1||!UNCOMPRESSED_TS.has(first.ts))return null;
 if(series.slices.slice(zStart,zStart+coreDepth).some(m=>m.rows!==h||m.columns!==w||m.bits!==16||m.samples!==1||!UNCOMPRESSED_TS.has(m.ts)||Math.abs(m.slope-first.slope)>1e-9||Math.abs(m.intercept-first.intercept)>1e-6||!!m.signed!==!!first.signed))return null;
 const texture=device.createTexture({label:'VRL analysis DICOM block',size:{width:w,height:h,depthOrArrayLayers:coreDepth},dimension:'3d',format:'rg8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 try{
  for(let z=0;z<coreDepth;z++){
   const packed=await packedRgSlice(series.slices[zStart+z]);device.queue.writeTexture({texture,origin:{x:0,y:0,z}},packed,{bytesPerRow:w*2,rowsPerImage:h},{width:w,height:h,depthOrArrayLayers:1});
  }
  const maxRuns=Math.ceil(w/2)*h*coreDepth,recordBytes=Math.max(16,maxRuns*16);
  if(recordBytes>device.limits.maxStorageBufferBindingSize)return null;
  const records=device.createBuffer({size:recordBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),counter=device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  const meta=smallStorage(device,new Uint32Array([w,h,coreDepth,0])),params=smallStorage(device,new Float32Array([seg.min,seg.max,first.slope,first.intercept,first.signed?32768:0,0,0,0]));device.queue.writeBuffer(counter,0,new Uint32Array([0]));
  const pipeline=runPipeline(device),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView({dimension:'3d'})},{binding:1,resource:{buffer:meta}},{binding:2,resource:{buffer:params}},{binding:3,resource:{buffer:records}},{binding:4,resource:{buffer:counter}}]});
  const counterRead=device.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder({label:'VRL raw DICOM analysis RLE'}),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(w*h*coreDepth/256));pass.end();encoder.copyBufferToBuffer(counter,0,counterRead,0,4);device.queue.submit([encoder.finish()]);
  await counterRead.mapAsync(GPUMapMode.READ);const count=Math.min(maxRuns,new Uint32Array(counterRead.getMappedRange().slice(0))[0]);counterRead.unmap();counterRead.destroy();
  let items=new Uint32Array(0);
  if(count){
   const bytes=count*16,read=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),copy=device.createCommandEncoder({label:'VRL analysis RLE readback'});copy.copyBufferToBuffer(records,0,read,0,bytes);device.queue.submit([copy.finish()]);
   await read.mapAsync(GPUMapMode.READ);items=new Uint32Array(read.getMappedRange().slice(0));read.unmap();read.destroy();
  }
  records.destroy();counter.destroy();meta.destroy();params.destroy();return{items,coreDepth};
 }finally{texture.destroy()}
}
