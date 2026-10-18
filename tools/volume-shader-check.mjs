// Headless check of the WebGPU volume shader (docs/medical-volume.js
// volumeShader): renders a synthetic phantom with the real WGSL through
// SwiftShader WebGPU, saves the image, and compares two versions of the file
// pixel by pixel. SwiftShader time is a CPU proxy (relative only).
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/volume-shader-check.mjs [fileA] [fileB] [outDir]   (ROLL=1: the viewer upside down = the volume turned half a circle about the view axis; build 612)
// fileA defaults to docs/medical-volume.js; fileB (optional) is compared with
// it, e.g. a copy from git: git show HEAD:docs/medical-volume.js > /tmp/old.js
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { lightingWGSL, lightOffsetExpr, materialVec } from '../docs/lighting.js';
const fileA=process.argv[2]||'docs/medical-volume.js',fileB=process.argv[3]||null,outDir=process.argv[4]||'.',refine=+(process.env.REFINE??1),overlap=+(process.env.OVERLAP??1),mpr=+(process.env.MPR??0),analysis=+(process.env.ANALYSIS??0);
// build 612: the shader text is cut from the source, so the two placeholders of the shared lighting (docs/lighting.js) are resolved here
const resolveLighting=t=>t.replace('${lightingWGSL()}',lightingWGSL()).replace("${lightOffsetExpr('u.camRightTan.xyz','u.camUpAspect.xyz')}",lightOffsetExpr('u.camRightTan.xyz','u.camUpAspect.xyz'));
const safeWgsl=source=>source.replace(/\bmeta\b/g,'vrlMeta').replace(/\bactive\b/g,'vrlActive').replace(/\btarget\b/g,'vrlTarget');
const shaderOf=file=>{const s=fs.readFileSync(file,'utf8'),a=s.indexOf('export function volumeShader(){'),b=s.indexOf('export function brickShader(){',a);const body=s.slice(a,b),i=body.indexOf('`')+1,j=body.lastIndexOf('`');return safeWgsl(resolveLighting(body.slice(i,j)))};
const counting=code=>('var<private> nFetch:u32=0u;var<private> nBrick:u32=0u;var<private> nEdit:u32=0u;\n'+code)
 .replace('fn huAt(tc0:vec3<f32>)->f32{','fn huAt(tc0:vec3<f32>)->f32{nFetch=nFetch+1u;').replace('fn huVoxel(tc0:vec3<f32>)->f32{','fn huVoxel(tc0:vec3<f32>)->f32{nFetch=nFetch+1u;')
 .replace('fn brickMayContain(p:vec3<f32>)->bool{return brickClass(p)>0;}','fn brickMayContain(p:vec3<f32>)->bool{return brickClass(p)>0;}').replace('fn brickClass(p:vec3<f32>)->i32{','fn brickClass(p:vec3<f32>)->i32{nBrick=nBrick+1u;').replace(/fn brickMayContain\(p:vec3<f32>\)->bool\{\n/,'fn brickMayContain(p:vec3<f32>)->bool{nBrick=nBrick+1u;\n')
 .replace('fn editAllows(seg:u32,tc0:vec3<f32>)->bool{','fn editAllows(seg:u32,tc0:vec3<f32>)->bool{nEdit=nEdit+1u;')
 .replace(/return vec4<f32>\(acc\.rgb\+bg\*\(1\.0-acc\.a\),1\.0\);\n}`?$/,'return vec4<f32>(f32(nFetch),f32(nBrick),f32(nEdit),1.0);\n}');
// uniform size is derived from the volume shader's own Uniforms struct (every member is a vec4, segments is array<vec4,8>), so it follows the app's layout
const uniformBytes=(()=>{const m=/struct Uniforms\{([\s\S]*?)\};/.exec(shaderOf(fileA));if(!m){console.error('FAIL: Uniforms struct not found in '+fileA);process.exit(1)}
 const members=m[1].replace(/\s+/g,'').replace(/,$/,''),re=/(\w+):(?:array<vec4<f32>,(\d+)>|vec4<f32>)(?:,|$)/y;let n=0,at=0;
 while(at<members.length){re.lastIndex=at;const x=re.exec(members);if(!x){console.error('FAIL: unexpected Uniforms member near: '+members.slice(at,at+40));process.exit(1)}n+=x[2]?+x[2]:1;at=re.lastIndex}
 return n*16})();
const shaders={A:shaderOf(fileA),B:fileB?shaderOf(fileB):null};
// IDCAP=1 (build 416): a third pass per file returns, for every pixel whose ray reaches the section cap, the voxel at
// the cap point (linear index + 1), the segment the cap shows (capSegmentIndex) and whether it takes a result colour;
// the page compares them with the phantom's voxel truth (that voxel's HU in the segment range, inside the region)
// IDHIT=1 (build 417): instead, every surface hit of a segment with results returns the voxel its colour is taken
// from (linear index + 1), the segment and whether it is coloured; compared with that voxel's truth
const HITLINE='var overlay=0u;if(anyRegion&&!isCutPreview){overlay=analysisOverlayAt(tcv);}';
const idHit=code=>{const old='var overlay=0u;if(anyRegion&&!isCutPreview){if(regionByTexture){overlay=regionOverlayNear(tc,dir,inward);}else{overlay=analysisOverlayAt(tcv);}}';
 const line=code.includes(HITLINE)?HITLINE:code.includes(old)?old:null;if(!line)throw new Error('IDHIT: hit line not found');
 // the older code takes the colour from regionOverlayNear's voxel: report the voxel insideVoxelTc picks as the surface voxel, and the colour as shown
 return code.replace(line,line+'if(anyRegion&&idx==0){let st=insideVoxelTc(tc,dir,inward,u32(idx));let td=vec3<u32>(u.textureDims.xyz);let pv=min(vec3<u32>(clamp(st,vec3<f32>(0.0),vec3<f32>(0.999999))*u.textureDims.xyz),td-vec3<u32>(1u));return vec4<f32>(f32((pv.z*td.y+pv.y)*td.x+pv.x)+1.0,f32(idx),select(0.0,1.0,overlay!=0u),1.0);}')};
const CAPLINE='let cp=u.camOrigin.xyz+dir*capT;let ctc=texCoord(cp);let capIndex=capSegmentIndex(ctc);';
const idCap=code=>{if(!code.includes(CAPLINE))throw new Error('IDCAP: cap line not found');return code.replace(CAPLINE,CAPLINE+'{let td=vec3<u32>(u.textureDims.xyz);let pv=min(vec3<u32>(clamp(ctc,vec3<f32>(0.0),vec3<f32>(0.999999))*u.textureDims.xyz),td-vec3<u32>(1u));var rg=0u;if(analysisOverlay[0]!=0u&&capIndex>=0){rg=analysisOverlayAt(ctc);}return vec4<f32>(f32((pv.z*td.y+pv.y)*td.x+pv.x)+1.0,f32(capIndex),select(0.0,1.0,rg!=0u),1.0);}')};
const srv=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end('<!doctype html><html><body></body></html>')}).listen(8778);
const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader']});
let gpuErrors=0;
const pg=await b.newPage();pg.on('console',m=>{if(m.type()==='error'||m.type()==='warning'){if(/invalid|validation/i.test(m.text()))gpuErrors++;console.log('console.'+m.type()+':',m.text().slice(0,400))}});
await pg.goto('http://localhost:8778/');
const result=await pg.evaluate(async ({segM,uniformBytes,shaders,counting,refine,overlap,mpr,analysis,regionTexOn,regionR,edit,specksOn,section,sectionZ,sectionSign,roll})=>{
 const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
 // phantom: 128³, unsigned u16 = HU + 1024 (slope 1, intercept -1024, bias 0):
 // soft-tissue ellipsoid (40 HU) holding a bone sphere (900 HU), a 2-voxel
 // bone plate and a hollow bone tube; air outside (-1000)
 const N=128,dims=[N,N,N],data=new Uint8Array(N*N*N*2);
 // SPECKS=1: 400 single-voxel bone specks (500 HU) scattered in the soft tissue (seeded); EDIT=2 excludes exactly those voxels
 const specks=new Set();if(specksOn){let seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff};
  while(specks.size<400){const x=Math.floor(20+rnd()*88),y=Math.floor(30+rnd()*68),z=Math.floor(16+rnd()*96);const cx=x-64,cy=y-64,cz=z-64;
   if(cx*cx/(52*52)+cy*cy/(40*40)+cz*cz/(56*56)<0.8&&cx*cx+cy*cy+cz*cz>26*26&&!(Math.abs(cy-20)<3))specks.add((z*N+y)*N+x)}}
 // SPECKS=2: a noisy blob (x 24..56, y 70..100, z 40..80: HU uniform 100..700 per voxel, seeded); EDIT=2 then excludes exactly its voxels >= 300 (bone threshold)
 const noise=new Map();if(specksOn===2){let seed=777;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff};
  for(let z=40;z<80;z++)for(let y=70;y<100;y++)for(let x=24;x<56;x++){const v=Math.floor(100+rnd()*600);noise.set((z*N+y)*N+x,v);if(v>=300)specks.add((z*N+y)*N+x)}}
 const hu=(x,y,z)=>{const cx=x-64,cy=y-64,cz=z-64;
  let v=-1000;if(specksOn===2){const nv=noise.get((z*N+y)*N+x);if(nv!==undefined)return nv}if(specks.has((z*N+y)*N+x))return 500;
  if(cx*cx/(52*52)+cy*cy/(40*40)+cz*cz/(56*56)<1)v=40;
  if(cx*cx+cy*cy+cz*cz<22*22)v=900;
  if(Math.abs(cy-20)<1&&Math.abs(cx)<36&&Math.abs(cz)<36)v=900;
  const r=Math.hypot(cx+30,cz);if(r>8&&r<11&&Math.abs(cy)<40)v=900;
  return v};
 for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){const q=hu(x,y,z)+1024,o=((z*N+y)*N+x)*2;data[o]=q&255;data[o+1]=q>>8}
 const tex=device.createTexture({size:{width:N,height:N,depthOrArrayLayers:N},dimension:'3d',format:'rg8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 device.queue.writeTexture({texture:tex},data,{bytesPerRow:N*2,rowsPerImage:N},{width:N,height:N,depthOrArrayLayers:N});
 // bricks (min/max HU, 8³, index bz*bx*by+by*bx+bx)
 const BS=8,bx=N/BS,brick=new Float32Array(bx*bx*bx*2);
 for(let k=0;k<bx;k++)for(let j=0;j<bx;j++)for(let i=0;i<bx;i++){let lo=1e9,hi=-1e9;
  const ov=overlap?1:0;for(let z=Math.max(0,k*BS-ov);z<Math.min(N,(k+1)*BS+ov);z++)for(let y=Math.max(0,j*BS-ov);y<Math.min(N,(j+1)*BS+ov);y++)for(let x=Math.max(0,i*BS-ov);x<Math.min(N,(i+1)*BS+ov);x++){const v=hu(x,y,z);if(v<lo)lo=v;if(v>hi)hi=v}
  const o=((k*bx+j)*bx+i)*2;brick[o]=lo;brick[o+1]=hi}
 const storage=arr=>{const buf=device.createBuffer({size:Math.max(16,arr.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buf,0,arr);return buf};
 let editRows=storage(new Uint32Array(64)),editIntervals=null;
 // EDIT=1: exclusion edit on segment 0 (bone): the box x 44..84, y 44..84, z 64..127 is removed (editAllows layout of setEditRuns: [activeMask, keepMask, 4 × (rowCount+1) offsets], intervals x0|x1<<16)
 if(edit){const rowCount=N*N,offsets=new Uint32Array(2+4*(rowCount+1)),ints=[];offsets[0]=1;offsets[1]=0;
  const speckRows=new Map();for(const i of specks){const x=i%N,r=(i/N)|0;(speckRows.get(r)||speckRows.set(r,[]).get(r)).push(x)}
  for(let si=0;si<4;si++){const base=2+si*(rowCount+1);for(let r=0;r<rowCount;r++){offsets[base+r]=ints.length;const z=(r/N)|0,y=r%N;if(si===0&&edit===1&&z>=64&&y>=44&&y<=84)ints.push((84<<16)|44);if(si===0&&edit===2&&speckRows.has(r))for(const x of speckRows.get(r).sort((a,b)=>a-b))ints.push((x<<16)|x)}offsets[base+rowCount]=ints.length}
  editRows=storage(offsets);editIntervals=storage(new Uint32Array(ints.length?ints:[0]))}
 const brickBuf=storage(brick),zero=storage(new Uint32Array([0,0,0,0]));
 // analysis overlay (medical-volume.js setAnalysisRuns layout): the bone sphere as one focused cyan region
 let overlayBuf=zero,regionTex=device.createTexture({size:{width:1,height:1,depthOrArrayLayers:1},dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 if(analysis){const rowCount=N*N,counts=new Uint32Array(rowCount),runs=[];
  for(let z=0;z<N;z++)for(let y=0;y<N;y++){let x0=-1;for(let x=0;x<=N;x++){const inR=x<N&&Math.hypot(x-64,y-64,z-64)<regionR;if(inR&&x0<0)x0=x;if(!inR&&x0>=0){runs.push([z*N+y,x0,x-1]);counts[z*N+y]++;x0=-1}}}
  const header=2+rowCount,data=new Uint32Array(header+runs.length*2),cursor=new Uint32Array(rowCount);data[0]=1;let at=header;for(let r=0;r<rowCount;r++){data[1+r]=at;cursor[r]=at;at+=counts[r]*2}data[1+rowCount]=at;
  const word=(0x00c8ff|0x1000000|0x80000000)>>>0;for(const [row,x0,x1] of runs){const c=cursor[row];data[c]=((x1&65535)<<16)|(x0&65535);data[c+1]=word;cursor[row]=c+2}
  // build 374 layout: colour table after the pairs, data[0] = its start; region index texture (4 bits per voxel)
  const tableStart=header+runs.length*2,data2=new Uint32Array(tableStart+16);data2.set(data);data2[0]=tableStart;data2[tableStart]=0xff;data2[tableStart+1]=word;
  overlayBuf=storage(data2);
  // build 376 (as setAnalysisRuns): staging buffer at the 256-byte row pitch, one copyBufferToTexture (tw = 16 words here, so rows are padded)
  const tw=N/8,bytesPerRow=Math.ceil(tw*4/256)*256,rowWords=bytesPerRow/4,staging=device.createBuffer({size:bytesPerRow*N*N,usage:GPUBufferUsage.COPY_SRC,mappedAtCreation:true}),words=new Uint32Array(staging.getMappedRange());
  for(const [row,x0,x1] of runs){for(let x=x0;x<=x1;x++){const wi=row*rowWords+(x>>3),sh=(x&7)*4;words[wi]=(words[wi]&~(15<<sh))|(1<<sh)}}
  staging.unmap();
  regionTex=device.createTexture({size:{width:tw,height:N,depthOrArrayLayers:N},dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const enc=device.createCommandEncoder();enc.copyBufferToTexture({buffer:staging,bytesPerRow,rowsPerImage:N},{texture:regionTex},{width:tw,height:N,depthOrArrayLayers:N});device.queue.submit([enc.finish()]);}
 const W=384,H=384,uni=new Float32Array(uniformBytes/4),put=(s,a,c,d,e)=>{uni[s*4]=a;uni[s*4+1]=c;uni[s*4+2]=d;uni[s*4+3]=e};
 // camera: app units, longest side 3.3; half extents 1.65; looking from a corner
 const half=[1.65,1.65,1.65],scale=3.3/N,step=Math.max(1e-5,scale*0.85);
 const o=[3.2,2.1,4.0],len=Math.hypot(...o),fwd=o.map(v=>-v/len),upW=[0,roll?-1:1,0];
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const l=Math.hypot(...a);return a.map(v=>v/l)};
 const right=norm(cross(fwd,upW)),up=cross(right,fwd);
 put(0,o[0],o[1],o[2],0);put(1,right[0],right[1],right[2],Math.tan(45/2*Math.PI/180));put(2,up[0],up[1],up[2],W/H);put(3,fwd[0],fwd[1],fwd[2],0);
 put(4,half[0],half[1],half[2],step);put(5,N,N,N,1);put(6,-1024,0,bx,bx);put(7,W,H,bx,BS);
 // segments: bone opaque, soft tissue 35 % (rays continue through it)
 put(8,300,3000,1,1);put(9,0.91,0.86,0.72,1);put(10,-200,299,0.35,1);put(11,0.85,0.55,0.42,1);put(12,0,0,0,0);put(13,0,0,0,0);put(14,0,0,0,0);put(15,0,0,0,0);
 put(16,64,64,64,mpr?0.6:0);put(17,mpr,0,0,refine);put(18,40,400,0,0);put(19,section?1:0,sectionZ,sectionSign,analysis&&regionTexOn?1:0);put(20,section?1:0,0.85,0,28);put(21,N,N,N,1);put(22,0.05,0.06,0.08,1);
 for(let s=0;s<4&&23+s<uni.length/4;s++)put(23+s,...segM); // build 620: segMat (the standard material in every slot), when the struct has it
 // SECTION=1 (build 410): axial section at z = SECTION_Z (app units), SECTION_SIGN picks the kept side, cap at 85 %
 const uniBuf=device.createBuffer({size:uni.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(uniBuf,0,uni);
 const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
 const targets={rgba8unorm:device.createTexture({size:{width:W,height:H},format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),rgba32float:device.createTexture({size:{width:W,height:H},format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC})};
 const readBufs={rgba8unorm:device.createBuffer({size:W*H*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),rgba32float:device.createBuffer({size:W*H*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})};
 const validation=[];
 const run=async(code,label,format='rgba8unorm')=>{device.pushErrorScope('validation');try{return await run0(code,label,format)}finally{const e=await device.popErrorScope();if(e)validation.push(label+': '+e.message.slice(0,300))}};
 const run0=async(code,label,format)=>{
  const target=targets[format],readBuf=readBufs[format],bpp=format==='rgba8unorm'?4:16;
  const module=device.createShaderModule({code});const info=await module.getCompilationInfo();
  const errs=info.messages.filter(m=>m.type==='error').map(m=>m.lineNum+':'+m.message);if(errs.length)return{label,errs};
  const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:uniBuf}},{binding:1,resource:tex.createView({dimension:'3d'})},{binding:2,resource:{buffer:editRows}},{binding:3,resource:{buffer:brickBuf}},{binding:4,resource:sampler},
   {binding:5,resource:{buffer:editIntervals||zero}},{binding:6,resource:{buffer:zero}},{binding:7,resource:{buffer:zero}},{binding:8,resource:{buffer:zero}},{binding:9,resource:{buffer:zero}},{binding:10,resource:{buffer:overlayBuf}}].concat(code.includes('regionTex')?[{binding:11,resource:regionTex.createView({dimension:'3d'})}]:[])});
  const times=[];let px=null;
  const passes=format==='rgba8unorm'?6:1;
  for(let i=0;i<passes;i++){
   const enc=device.createCommandEncoder(),pass=enc.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
   pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
   if(i===passes-1)enc.copyTextureToBuffer({texture:target},{buffer:readBuf,bytesPerRow:W*bpp},{width:W,height:H});
   const t0=performance.now();device.queue.submit([enc.finish()]);await device.queue.onSubmittedWorkDone();times.push(performance.now()-t0);
  }
  await readBuf.mapAsync(GPUMapMode.READ);px=format==='rgba8unorm'?Array.from(new Uint8Array(readBuf.getMappedRange())):Array.from(new Float32Array(readBuf.getMappedRange()));readBuf.unmap();
  times.sort((a,b)=>a-b);return{label,ms:times[0],px};
 };
 const out={A:await run(shaders.A,'A'),Ac:await run(shaders.Ac,'Ac','rgba32float')};if(shaders.B){out.B=await run(shaders.B,'B');out.Bc=await run(shaders.Bc,'Bc','rgba32float')}
 // IDCAP: compare the cap's segment / result with the voxel truth
 const truthSeg=(x,y,z)=>{const v=hu(x,y,z),boneOut=(edit===1&&z>=64&&y>=44&&y<=84&&x>=44&&x<=84)||(edit===2&&specks.has((z*N+y)*N+x));return v>=300&&v<=3000&&!boneOut?0:v>=-200&&v<=299?1:-1};
 for(const k of ['Aid','Bid']){if(!shaders[k])continue;const r=await run(shaders[k],k,'rgba32float');if(r.errs){out[k]=r;continue}const px=r.px;let colored=0,cap=0,segBad=0,segExtra=0,segMissing=0,regBad=0,regExtra=0,regMissing=0;
  for(let i=0;i<px.length;i+=4){if(px[i]<0.5)continue;cap++;const id=Math.round(px[i])-1,x=id%N,y=((id/N)|0)%N,z=(id/(N*N))|0,ts=truthSeg(x,y,z),ss=Math.round(px[i+1]);
   if(ss!==ts){segBad++;if(ts<0)segExtra++;else if(ss<0)segMissing++}
   if(px[i+2]>0.5)colored=(colored||0)+1;if(analysis&&ss===0){const tr=Math.hypot(x-64,y-64,z-64)<regionR,sr=px[i+2]>0.5;if(tr!==sr){regBad++;if(sr)regExtra++;else regMissing++}}}
  out[k]={colored,cap,segBad,segExtra,segMissing,regBad,regExtra,regMissing}}
 for(const k of ['Ac','Bc']){const r=out[k];if(!r||r.errs)continue;let f=0,br=0,e=0;for(let i=0;i<r.px.length;i+=4){f+=r.px[i];br+=r.px[i+1];e+=r.px[i+2]}r.sums={fetch:f,brick:br,edit:e};r.px=null}
 return{W,H,out,validation};
},{segM:materialVec('standard'),uniformBytes,shaders:{A:shaders.A,B:shaders.B,Ac:counting(shaders.A),Bc:shaders.B?counting(shaders.B):null,Aid:process.env.IDCAP?idCap(shaders.A):process.env.IDHIT?idHit(shaders.A):null,Bid:shaders.B?(process.env.IDCAP?idCap(shaders.B):process.env.IDHIT?idHit(shaders.B):null):null},refine,overlap,mpr,analysis,section:!!process.env.SECTION,sectionZ:+(process.env.SECTION_Z??0.3),sectionSign:+(process.env.SECTION_SIGN??-1),regionTexOn:+(process.env.REGIONTEX??1),regionR:+(process.env.REGIONR??22),edit:+(process.env.EDIT??0),specksOn:+(process.env.SPECKS??0),roll:+(process.env.ROLL??0)});
await b.close();srv.close();
const {W,H,out,validation}=result;
for(const k of Object.keys(out)){const r=out[k];if(r.errs){console.log(k,'COMPILE ERRORS',r.errs);process.exit(1)}
 if(k.endsWith('id')){console.log(k+(process.env.IDHIT?' (surface hits vs voxel truth): hit pixels ':' (cap vs voxel truth): cap pixels ')+r.cap+' · segment wrong '+r.segBad+' (shown where the voxel is not in it '+r.segExtra+', missing '+r.segMissing+') · result wrong '+r.regBad+' (coloured but not in the result '+r.regExtra+', missing '+r.regMissing+') · coloured '+r.colored);continue}
 if(r.sums)console.log(k+': per pixel — HU fetches '+(r.sums.fetch/(W*H)).toFixed(1)+', brick reads '+(r.sums.brick/(W*H)).toFixed(1)+', edit lookups '+(r.sums.edit/(W*H)).toFixed(1)+' (totals '+r.sums.fetch+' / '+r.sums.brick+' / '+r.sums.edit+')');
 else console.log(k+': SwiftShader pass '+r.ms.toFixed(0)+' ms (min of 6; CPU proxy, relative only)')}
// PNG writer (no deps): zlib via node
import zlib from 'node:zlib';
const png=(px,w,h)=>{const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;for(let x=0;x<w*4;x++)raw[y*(w*4+1)+1+x]=px[y*w*4+x]}
 const crc=b=>{let c=~0;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^(0xEDB88320&-(c&1))}return ~c>>>0};
 const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])};
fs.writeFileSync(path.join(outDir,'volume-A.png'),png(out.A.px,W,H));
if(out.B){fs.writeFileSync(path.join(outDir,'volume-B.png'),png(out.B.px,W,H));
 let maxd=0,n=0,sum=0;const a=out.A.px,bb=out.B.px;for(let i=0;i<a.length;i++){if(i%4===3)continue;const d=Math.abs(a[i]-bb[i]);if(d){n++;sum+=d;if(d>maxd)maxd=d}}
 console.log('A vs B: differing channels '+n+' of '+(a.length*3/4)+', max |diff| '+maxd+', mean |diff| over differing '+(n?(sum/n).toFixed(2):0));
 const diff=a.map((v,i)=>i%4===3?255:Math.min(255,Math.abs(v-bb[i])*8));fs.writeFileSync(path.join(outDir,'volume-diff.png'),png(diff,W,H));}
console.log('images in',outDir);
// guard: an invalid BindGroup / pipeline makes every pass ~1 ms with 0 fetches, so an A/B would read "no difference"
const problems=[];
if(validation.length)problems.push('WebGPU validation error: '+validation.join(' | '));
if(gpuErrors)problems.push(gpuErrors+' invalid/validation message(s) on the console');
for(const k of ['Ac','Bc']){const r=out[k];if(r&&r.sums&&!(r.sums.fetch>0))problems.push(k+': 0 HU fetches (shader did not run)')}
if(problems.length){console.error('FAIL: '+problems.join('; '));process.exit(1)}
