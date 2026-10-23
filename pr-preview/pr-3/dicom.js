// Extracted verbatim from app.js by tools/extract-module.mjs.
// Depends only on the imports below; never imports from app.js (no cycles).
import dicomParser from 'https://esm.sh/dicom-parser@1.8.21';
import { multi, safePair, num, safeTriple, numberOr, frameYield } from './utils.js?v=20261023-build657';
import { analyzeSliceSpacing, excludeDuplicateSlices, seriesNormal, slicePosition } from './slice-spacing.js?v=20261023-build657';
export async function parseDicomHeader(file){
 const attempts=[Math.min(file.size,256*1024),Math.min(file.size,1024*1024)];
 let lastError=null;
 for(const size of [...new Set(attempts)]){
  try{return dicomParser.parseDicom(new Uint8Array(await file.slice(0,size).arrayBuffer()),{untilTag:'x7fe00010'})}
  catch(e){lastError=e}
 }
 try{return dicomParser.parseDicom(new Uint8Array(await file.arrayBuffer()),{untilTag:'x7fe00010'})}
 catch(e){throw lastError||e}
}
export function parsedSliceMeta(f,ds){
 const seriesUid=ds.string('x0020000e')?.trim();if(!seriesUid)return null;
 const ps=multi(ds.string('x00280030'),2),pos=multi(ds.string('x00200032'),3),iop=multi(ds.string('x00200037'),6);
 return{file:f,studyUid:ds.string('x0020000d')?.trim()||'study',seriesUid,description:ds.string('x0008103e')?.trim()||'Unnamed series',modality:ds.string('x00080060')?.trim()||'Unknown',rows:ds.uint16('x00280010')||0,columns:ds.uint16('x00280011')||0,bits:ds.uint16('x00280100')||16,bitsStored:ds.uint16('x00280101')||ds.uint16('x00280100')||16,highBit:ds.uint16('x00280102'),signed:ds.uint16('x00280103')||0,samples:ds.uint16('x00280002')||1,photometricInterpretation:ds.string('x00280004')?.trim()||'MONOCHROME2',planarConfiguration:ds.uint16('x00280006')||0,numberOfFrames:Number(ds.string('x00280008')||1),pixelSpacing:ps?safePair(ps):null,thickness:num(ds.string('x00180050')),spacingBetween:num(ds.string('x00180088')),instance:num(ds.string('x00200013')),pos:pos?safeTriple(pos):null,orientation:iop,slope:numberOr(ds.string('x00281053'),1),intercept:numberOr(ds.string('x00281052'),0),windowCenter:num(ds.string('x00281050')),windowWidth:num(ds.string('x00281051')),smallest:ds.uint16('x00280106'),largest:ds.uint16('x00280107'),pixelOffset:ds.elements.x7fe00010?.dataOffset??null,pixelLength:ds.elements.x7fe00010?.length??null,ts:ds.string('x00020010')?.trim()||'1.2.840.10008.1.2.1'};
}
export function expandParsedFrames(meta){
 const frames=Math.max(1,meta.numberOfFrames||1);
 if(frames===1||!COMPRESSED_DICOM_TRANSFER_SYNTAXES.has(meta.ts))return[meta];
 const dz=meta.spacingBetween||meta.thickness||1,baseInstance=Number.isFinite(meta.instance)?meta.instance:0;
 return Array.from({length:frames},(_,frameIndex)=>({...meta,frameIndex,syntheticPos:true,sortIndex:baseInstance+frameIndex/Math.max(frames,1),instance:baseInstance+frameIndex,pos:meta.pos?[meta.pos[0],meta.pos[1],meta.pos[2]+frameIndex*dz]:null}));
}
export function canDecodeToInt16(slices){
 for(const meta of slices){
  if(meta.bits!==8&&meta.bits!==16)return false;
  if(!Number.isInteger(meta.slope)||!Number.isInteger(meta.intercept))return false;
  const storedBits=meta.bitsStored||meta.bits,rawMin=meta.signed?-(2**(storedBits-1)):0,rawMax=meta.signed?(2**(storedBits-1)-1):(2**storedBits-1);
  const x=rawMin*meta.slope+meta.intercept,y=rawMax*meta.slope+meta.intercept;
  if(Math.min(x,y)<-32768||Math.max(x,y)>32767)return false;
 }
 return true;
}
export function sourceRangeFromMetadata(slices){
 let min=Infinity,max=-Infinity;
 for(const meta of slices){
  let rawMin=meta.smallest,rawMax=meta.largest;
  if(rawMin==null||rawMax==null){
   const storedBits=meta.bitsStored||meta.bits;
   rawMin=meta.signed?-(2**(storedBits-1)):0;
   rawMax=meta.signed?(2**(storedBits-1)-1):(2**storedBits-1);
  }else if(meta.signed){
   if(rawMin>32767)rawMin-=65536;
   if(rawMax>32767)rawMax-=65536;
  }
  const x=rawMin*meta.slope+meta.intercept,y=rawMax*meta.slope+meta.intercept;
  min=Math.min(min,x,y);max=Math.max(max,x,y);
 }
 return{min,max};
}
export function groupSeries(slices){
 const m=new Map();
 for(const s of slices){const k=s.studyUid+'::'+s.seriesUid;(m.get(k)||m.set(k,[]).get(k)).push(s)}
 return[...m.entries()].map(([id,all])=>{
  const readIndex=new Map(all.map((x,i)=>[x,i])),g0=[...all],normal=seriesNormal(g0),synthetic=g0.some(s=>s.syntheticPos),key=s=>synthetic?(s.sortIndex??s.instance??0):(slicePosition(s,normal)??s.sortIndex??s.instance??0);
  g0.sort((a,b)=>key(a)-key(b));
  // every gap along the slice normal is checked; duplicate slices are excluded (smaller InstanceNumber stays);
  // the z spacing is the whole span / (N-1), or a gap-corrected fit when slices are missing
  const tagZ=g0[0].spacingBetween||g0[0].thickness||1;
  let g=g0,spacingCheck=analyzeSliceSpacing(g0,tagZ,normal);
  if(spacingCheck.duplicateIndices.length&&!spacingCheck.allDuplicates){
   const r=excludeDuplicateSlices(g0,spacingCheck.duplicateIndices,readIndex);g=r.slices;
   spacingCheck={...analyzeSliceSpacing(g,tagZ,normal),duplicates:r.excluded,duplicatesExcluded:r.excluded,warn:true,legacyZ:spacingCheck.legacyZ};
  }
  const z=spacingCheck.used;
  const f=g[0],rows=Math.max(...g.map(x=>x.rows)),columns=Math.max(...g.map(x=>x.columns)),bits=Math.max(...g.map(x=>x.bits)),compact=canDecodeToInt16(g),count=rows*columns*g.length,decodedBytes=count*(compact?2:4),sourceBacked=decodedBytes>256*1024*1024,range=sourceRangeFromMetadata(g);
  const windowCenter=g.find(x=>Number.isFinite(x.windowCenter))?.windowCenter,windowWidth=g.find(x=>Number.isFinite(x.windowWidth)&&x.windowWidth>0)?.windowWidth;
  return{id,description:f.description,modality:f.modality,slices:g,rows,columns,bits,bytes:decodedBytes,decodedBytes,compact,sourceBacked,min:range.min,max:range.max,windowCenter,windowWidth,spacingX:f.pixelSpacing?.[1]??1,spacingY:f.pixelSpacing?.[0]??1,spacingZ:z,spacingCheck};
 }).sort((a,b)=>b.slices.length-a.slices.length)
}
export const NATIVE_DICOM_TRANSFER_SYNTAXES=new Set(['1.2.840.10008.1.2','1.2.840.10008.1.2.1','1.2.840.10008.1.2.2']);
export const COMPRESSED_DICOM_TRANSFER_SYNTAXES=new Set(['1.2.840.10008.1.2.5','1.2.840.10008.1.2.4.50','1.2.840.10008.1.2.4.51','1.2.840.10008.1.2.4.57','1.2.840.10008.1.2.4.70','1.2.840.10008.1.2.4.80','1.2.840.10008.1.2.4.81','1.2.840.10008.1.2.4.90','1.2.840.10008.1.2.4.91','1.2.840.10008.1.2.4.201','1.2.840.10008.1.2.4.202','1.2.840.10008.1.2.4.203']);
export function isNativeDicomTransferSyntax(ts){return NATIVE_DICOM_TRANSFER_SYNTAXES.has(ts)}
export function dicomImageFrameInfo(meta){
 const bits=meta.bitsStored||meta.bits,bytesPerPixel=meta.bits<=8?1:2;
 return{samplesPerPixel:meta.samples||1,photometricInterpretation:meta.photometricInterpretation||'MONOCHROME2',planarConfiguration:meta.planarConfiguration||0,rows:meta.rows,columns:meta.columns,bitsAllocated:meta.bits,bitsStored:bits,highBit:meta.highBit??bits-1,pixelRepresentation:meta.signed?1:0,smallestPixelValue:meta.smallest??(meta.signed?-(2**(bits-1)):0),largestPixelValue:meta.largest??(meta.signed?(2**(bits-1)-1):(2**bits-1)),bytesPerPixel,signed:!!meta.signed,componentsPerPixel:meta.samples||1};
}
export function encapsulatedFrameBytes(ds,element,ts,frameIndex=0){
 if(!element?.encapsulatedPixelData||!element.fragments?.length)throw new Error('Encapsulated Pixel Data missing');
 const frames=Math.max(1,Number(ds.string('x00280008')||1));if(frameIndex<0||frameIndex>=frames)throw new Error('Compressed DICOM frame out of range: '+frameIndex+' / '+frames);
 if(ts==='1.2.840.10008.1.2.5')return dicomParser.readEncapsulatedPixelDataFromFragments(ds,element,frameIndex,1);
 let bot=element.basicOffsetTable||[];
 if(!bot.length&&frames>1){
  if(typeof dicomParser.createJPEGBasicOffsetTable!=='function')throw new Error('Compressed multi-frame DICOM has no Basic Offset Table');
  bot=dicomParser.createJPEGBasicOffsetTable(ds,element);
 }
 if(bot.length)return dicomParser.readEncapsulatedImageFrame(ds,element,frameIndex,bot);
 if(frames===1)return dicomParser.readEncapsulatedPixelDataFromFragments(ds,element,0,element.fragments.length);
 throw new Error('Unable to resolve compressed DICOM frame boundaries');
}
export async function parseFiles(files,onProgress){
 const out=new Array(files.length),workers=navigator.maxTouchPoints>0?2:Math.min(4,Math.max(2,navigator.hardwareConcurrency||2));let cursor=0,done=0;
 const work=async()=>{
  while(true){
   const i=cursor++;if(i>=files.length)return;const f=files[i];
   try{const ds=await parseDicomHeader(f),meta=parsedSliceMeta(f,ds);out[i]=meta?expandParsedFrames(meta):null}catch{}
   done++;onProgress?.(done,files.length);
   if((done&31)===0)await frameYield();
  }
 };
 await Promise.all(Array.from({length:Math.min(workers,files.length)},()=>work()));
 return out.flatMap(item=>item||[]);
}
