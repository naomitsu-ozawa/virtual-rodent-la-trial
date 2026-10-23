// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import { dicomCodecModulePromise, setDicomCodecModulePromise } from './state.js?v=20261023-build663';
import { fmt, frameYield, isIPhoneRuntime, isTabletRuntime, isDesktopRuntime } from './utils.js?v=20261023-build663';
import { isNativeDicomTransferSyntax, COMPRESSED_DICOM_TRANSFER_SYNTAXES, encapsulatedFrameBytes, dicomImageFrameInfo } from './dicom.js?v=20261023-build663';
import dicomParser from 'https://esm.sh/dicom-parser@1.8.21';
export function sourceMprCacheLimit(){
 if(isIPhoneRuntime())return 512*1024*1024;
 if(isTabletRuntime())return 1536*1024*1024;
 return Number.MAX_SAFE_INTEGER;
}
export function sourceMprDecodeConcurrency(){
 const hc=Math.max(2,Number(navigator.hardwareConcurrency)||4);
 return navigator.maxTouchPoints>0?Math.max(2,Math.min(4,hc-1)):Math.max(4,Math.min(8,hc-1));
}
export async function prepareSourceMprCache(v,onProgress){
 const s=v?.series;if(!s)return false;
 const Ctor=s.compact?Int16Array:Float32Array,w=s.columns,h=s.rows,d=s.slices.length,plane=w*h,count=plane*d,volumeBytes=count*Ctor.BYTES_PER_ELEMENT,limit=sourceMprCacheLimit();
 if(volumeBytes>limit)return false;
 let data,coronalAll=null,sagittalAll=null;
 try{
  data=new Ctor(count);
  if(isDesktopRuntime()||volumeBytes*2<=limit)sagittalAll=new Ctor(count);
  if(volumeBytes*3<=limit)coronalAll=new Ctor(count);
 }catch{
  try{
   data=data||new Ctor(count);
   sagittalAll=null;coronalAll=null;
  }catch{return false}
 }
 let next=0,completed=0,min=Infinity,max=-Infinity;
 const decodeOne=async z=>{
  const slice=await decodeSourceSlice(s.slices[z]),base=z*plane,corZ=d-1-z;
  let localMin=Infinity,localMax=-Infinity;
  for(let y=0;y<h;y++){
   const srcRow=y*w,baseRow=base+srcRow;
   for(let x=0;x<w;x++){
    const value=s.compact?slice[srcRow+x]:Number(slice[srcRow+x]);
    data[baseRow+x]=value;if(value<localMin)localMin=value;if(value>localMax)localMax=value;
    if(coronalAll)coronalAll[(y*d+corZ)*w+x]=value;
    if(sagittalAll)sagittalAll[(x*d+corZ)*h+y]=value;
   }
  }
  if(localMin<min)min=localMin;if(localMax>max)max=localMax;
  completed++;onProgress?.(completed,d);
 };
 const runner=async()=>{
  while(true){
   const z=next++;if(z>=d)return;
   await decodeOne(z);
   if((completed&3)===0)await frameYield();
  }
 };
 const concurrency=Math.min(d,sourceMprDecodeConcurrency());
 await Promise.all(Array.from({length:concurrency},()=>runner()));
 v.mprData=data;v.mprCtor=Ctor;v.mprCoronalAll=coronalAll;v.mprSagittalAll=sagittalAll;
 v.mprPlaneBuffers={coronal:coronalAll?null:new Ctor(w*d),sagittal:sagittalAll?null:new Ctor(h*d)};
 if(Number.isFinite(min))v.min=min;if(Number.isFinite(max))v.max=max;
 return true;
}
export function cachedSagittalDisplayPlane(v,idx){
 const data=v?.mprSagittalDisplayAll,h=v?.rows||0,d=v?.slices||0;if(!data||idx<0||idx>=v.columns)return null;
 const n=h*d,off=idx*n,src=data.subarray(off,off+n),out=v.mprSagittalDisplayBuffer?.length===n?v.mprSagittalDisplayBuffer:(v.mprSagittalDisplayBuffer=new Float32Array(n)),min=v.mprSagittalDisplayMin,max=v.mprSagittalDisplayMax,scale=(max-min)/65535;
 for(let i=0;i<n;i++)out[i]=min+src[i]*scale;
 return out;
}
export function cachedSourceMprPlane(v,p,idx){
 const w=v?.columns||0,h=v?.rows||0,d=v?.slices||0;
 if(p==='sagittal'&&v?.mprSagittalAll)return v.mprSagittalAll.subarray(idx*d*h,(idx+1)*d*h);
 const data=v?.mprData;if(!data)return null;
 const Ctor=v.mprCtor||data.constructor,plane=w*h;
 if(p==='axial')return data.subarray(idx*plane,(idx+1)*plane);
 if(p==='coronal'){
  if(v.mprCoronalAll)return v.mprCoronalAll.subarray(idx*d*w,(idx+1)*d*w);
  const out=v.mprPlaneBuffers?.coronal||new Ctor(w*d);
  for(let z=0;z<d;z++){const src=z*plane+idx*w,dst=(d-1-z)*w;out.set(data.subarray(src,src+w),dst)}
  return out;
 }
 const out=v.mprPlaneBuffers?.sagittal||new Ctor(h*d);
 for(let z=0;z<d;z++){const base=z*plane,dst=(d-1-z)*h;for(let y=0;y<h;y++)out[dst+y]=data[base+y*w+idx]}
 return out;
}
export async function getDicomCodecModule(){
 if(!dicomCodecModulePromise)setDicomCodecModulePromise(import('https://esm.sh/@cornerstonejs/dicom-image-loader@5.10.8?bundle').catch(e=>{setDicomCodecModulePromise(null);throw e}));
 return dicomCodecModulePromise;
}
export async function decodeCompressedDicomSlice(meta,opts){
 if(!COMPRESSED_DICOM_TRANSFER_SYNTAXES.has(meta.ts))throw new Error('Unsupported compressed DICOM transfer syntax: '+meta.ts);
 if((meta.samples||1)!==1)throw new Error('Compressed color DICOM is outside the CT viewer scope');
 const bytes=new Uint8Array(await meta.file.arrayBuffer()),ds=dicomParser.parseDicom(bytes),element=ds.elements.x7fe00010,pixelData=encapsulatedFrameBytes(ds,element,meta.ts,meta.frameIndex||0),frame=dicomImageFrameInfo(meta),module=await getDicomCodecModule(),decoders=module.decoders;
 let decoded;
 if(meta.ts==='1.2.840.10008.1.2.5')decoded=await decoders.RLE(frame,pixelData);
 else if(meta.ts==='1.2.840.10008.1.2.4.50')decoded=await decoders.JPEGBaseline8Bit(pixelData,frame);
 else if(meta.ts==='1.2.840.10008.1.2.4.51')decoded=await decoders.JPEGBaseline12Bit(frame,pixelData);
 else if(meta.ts==='1.2.840.10008.1.2.4.57'||meta.ts==='1.2.840.10008.1.2.4.70')decoded=await decoders.JPEGLossless(frame,pixelData);
 else if(meta.ts==='1.2.840.10008.1.2.4.80'||meta.ts==='1.2.840.10008.1.2.4.81')decoded=await decoders.JPEGLS(pixelData,frame);
 else if(meta.ts==='1.2.840.10008.1.2.4.90'||meta.ts==='1.2.840.10008.1.2.4.91')decoded=await decoders.JPEG2000(pixelData,frame);
 else decoded=await decoders.HTJ2K(pixelData,frame);
 const stored=decoded?.pixelData;if(!stored||stored.length<meta.rows*meta.columns)throw new Error('Compressed DICOM decoder returned incomplete pixel data');
 if(opts?.stored)return stored; // crop export: the stored integers as decoded, before RescaleSlope / Intercept
 const n=meta.rows*meta.columns,out=new Float32Array(n);for(let i=0;i<n;i++)out[i]=Number(stored[i])*meta.slope+meta.intercept;
 return out;
}
export async function decodeSourceSlice(meta){
 if(!isNativeDicomTransferSyntax(meta.ts))return decodeCompressedDicomSlice(meta);
 const bpp=meta.bits===8?1:meta.bits===16?2:0;
 if(!bpp)throw new Error('Unsupported BitsAllocated='+meta.bits);
 let bytes,offset=meta.pixelOffset;
 if(offset!=null){
  const tf=performance.now();bytes=new Uint8Array(await meta.file.slice(offset,offset+meta.rows*meta.columns*bpp).arrayBuffer());globalThis.__vrlTime?.('read:file',performance.now()-tf);
  offset=0;
 }else{
  const all=new Uint8Array(await meta.file.arrayBuffer()),ds=dicomParser.parseDicom(all),el=ds.elements.x7fe00010;
  if(!el)throw new Error('Pixel Data missing');bytes=all;offset=el.dataOffset;
 }
 const little=meta.ts!=='1.2.840.10008.1.2.2',view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=meta.rows*meta.columns,out=new Float32Array(n),td=performance.now();
 // typed-array fast path (DataView per pixel was 6.9 s per rebuild)
 if(meta.bits===16&&little&&((bytes.byteOffset+offset)&1)===0&&bytes.byteLength-offset>=n*2){
  const a=meta.signed?new Int16Array(bytes.buffer,bytes.byteOffset+offset,n):new Uint16Array(bytes.buffer,bytes.byteOffset+offset,n),sl=meta.slope,ic=meta.intercept;
  for(let i=0;i<n;i++)out[i]=a[i]*sl+ic;
  globalThis.__vrlTime?.('read:decode',performance.now()-td);return out;
 }
 try{for(let i=0;i<n;i++){
  let raw;
  if(meta.bits===8){raw=bytes[offset+i];if(meta.signed&&raw>127)raw-=256}
  else raw=meta.signed?view.getInt16(offset+i*2,little):view.getUint16(offset+i*2,little);
  out[i]=raw*meta.slope+meta.intercept;
 }}finally{globalThis.__vrlTime?.('read:decode',performance.now()-td)}
 return out;
}
export async function readSourceRows(meta,rowStart,rowCount){
 const bpp=meta.bits===8?1:meta.bits===16?2:0;if(!bpp)throw new Error('Unsupported BitsAllocated='+meta.bits);
 const count=Math.max(0,Math.min(rowCount,meta.rows-rowStart));if(!count)return new Float32Array();
 if(!isNativeDicomTransferSyntax(meta.ts)||meta.pixelOffset==null){const full=await decodeSourceSlice(meta);return full.slice(rowStart*meta.columns,(rowStart+count)*meta.columns)}
 const start=meta.pixelOffset+rowStart*meta.columns*bpp,end=start+count*meta.columns*bpp,bytes=new Uint8Array(await meta.file.slice(start,end).arrayBuffer()),little=meta.ts!=='1.2.840.10008.1.2.2',view=new DataView(bytes.buffer),out=new Float32Array(count*meta.columns);
 for(let i=0;i<out.length;i++){let raw;if(meta.bits===8){raw=bytes[i];if(meta.signed&&raw>127)raw-=256}else raw=meta.signed?view.getInt16(i*2,little):view.getUint16(i*2,little);out[i]=raw*meta.slope+meta.intercept}
 return out;
}
export async function readSourceColumn(meta,column){
 const hit=sourceSliceCache.map.get(meta);
 if(hit){
  sourceSliceCache.map.delete(meta);sourceSliceCache.map.set(meta,hit);
  const out=new Float32Array(meta.rows);for(let y=0;y<meta.rows;y++)out[y]=hit[y*meta.columns+column];return out;
 }
 const bpp=meta.bits===8?1:meta.bits===16?2:0;if(!bpp)throw new Error('Unsupported BitsAllocated='+meta.bits);
 if(!isNativeDicomTransferSyntax(meta.ts)||meta.pixelOffset==null){const full=await decodeSourceSlice(meta),out=new Float32Array(meta.rows);for(let y=0;y<meta.rows;y++)out[y]=full[y*meta.columns+column];return out}
 const bytes=new Uint8Array(await meta.file.slice(meta.pixelOffset,meta.pixelOffset+meta.rows*meta.columns*bpp).arrayBuffer()),little=meta.ts!=='1.2.840.10008.1.2.2',view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=new Float32Array(meta.rows);
 for(let y=0;y<meta.rows;y++){
  const off=(y*meta.columns+column)*bpp;let raw;
  if(meta.bits===8){raw=bytes[off];if(meta.signed&&raw>127)raw-=256}
  else raw=meta.signed?view.getInt16(off,little):view.getUint16(off,little);
  out[y]=raw*meta.slope+meta.intercept;
 }
 return out;
}
export async function decode(s,onProgress){
 const Ctor=s.compact?Int16Array:Float32Array,w=s.columns,h=s.rows,d=s.slices.length,plane=w*h,count=plane*d,bytesNeeded=count*Ctor.BYTES_PER_ELEMENT,limit=sourceMprCacheLimit();
 let data,coronalAll=null,sagittalAll=null;
 try{
  data=new Ctor(count);
  if(bytesNeeded*3<=limit){coronalAll=new Ctor(count);sagittalAll=new Ctor(count)}
 }catch(e){throw new Error('Volume memory allocation failed: '+fmt(bytesNeeded)+' ('+Ctor.name+')')}
 let next=0,completed=0,min=Infinity,max=-Infinity;
 const decodeOne=async z=>{
  const slice=await decodeSourceSlice(s.slices[z]),base=z*plane,corZ=d-1-z;let localMin=Infinity,localMax=-Infinity;
  for(let y=0;y<h;y++){
   const srcRow=y*w,baseRow=base+srcRow;
   for(let x=0;x<w;x++){
    const value=s.compact?slice[srcRow+x]:Number(slice[srcRow+x]);
    data[baseRow+x]=value;if(value<localMin)localMin=value;if(value>localMax)localMax=value;
    if(coronalAll)coronalAll[(y*d+corZ)*w+x]=value;
    if(sagittalAll)sagittalAll[(x*d+corZ)*h+y]=value;
   }
  }
  if(localMin<min)min=localMin;if(localMax>max)max=localMax;completed++;onProgress?.(completed,d);
 };
 const runner=async()=>{while(true){const z=next++;if(z>=d)return;await decodeOne(z);if((completed&3)===0)await frameYield()}};
 const concurrency=Math.min(d,sourceMprDecodeConcurrency());await Promise.all(Array.from({length:concurrency},()=>runner()));
 return{data,mprData:data,mprCtor:Ctor,mprCoronalAll:coronalAll,mprSagittalAll:sagittalAll,mprPlaneBuffers:{coronal:coronalAll?null:new Ctor(w*d),sagittal:sagittalAll?null:new Ctor(h*d)},columns:w,rows:h,slices:d,spacing:[s.spacingX,s.spacingY,s.spacingZ],min,max,windowCenter:s.windowCenter,windowWidth:s.windowWidth,storage:Ctor.name,sourceBacked:false};
}
export const sourceSliceCache={map:new Map(),bytes:0};
