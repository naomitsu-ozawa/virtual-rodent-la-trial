// Headless check of the VR volume shader (docs/vr-view.js fragmentShader):
// renders a synthetic phantom with the real GLSL through three.js on
// SwiftShader WebGL2, in the HU path and the precomputed-classification path,
// counts texture fetches per pixel (counters injected into huAt / sliceGray /
// brickMayContain / the cls fetch) and compares two versions of the file.
//   PW_CHROMIUM=/opt/pw-browsers/chromium node tools/vr-volume-check.mjs [fileA] [fileB] [outDir]
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { resolveLighting } from './lib/vr-gl-harness.mjs';
import { materialVec } from '../docs/lighting.js';
const fileA=process.argv[2]||'docs/vr-view.js',fileB=process.argv[3]||null,outDir=process.argv[4]||'.';
const grab=(src,name)=>{const m=src.match(new RegExp('const '+name+'=`([\\s\\S]*?)`;'));if(!m)throw new Error('shader '+name+' not found');return resolveLighting(m[1])}; // the shared lighting placeholders
// REGION=1: a synthetic analysis result — colour index 1 on the half x < N/2 of the volume (cyan), with VRL_REGIONS
// REGION=fat: the result only on the fat voxels of that half (a fat result, regionSeg = fat); REGZERO=1: no
// result voxels (same shader); SEGS=nofat: fat hidden. Fat hidden, REGION=fat vs REGZERO=1 must render the same image.
// VRL_MEDIUMP is the app's default; VR_PREC=highp checks the 32-bit variant
const DEFS=[...(process.env.DEFINES||'').split(',').filter(Boolean),...(process.env.VR_PREC==='highp'||(process.env.DEFINES||'').includes('VRL_MEDIUMP')?[]:['VRL_MEDIUMP']),...(process.env.REGION?['VRL_REGIONS']:[])].map(d=>'#define '+d+'\n').join('');
const load=f=>{const s=fs.readFileSync(f,'utf8');return{vs:grab(s,'vertexShader'),fs:DEFS+grab(s,'fragmentShader')}};
const counting=code=>code
 .replace('out highp vec4 outColor;','out highp vec4 outColor;')
 .replace('float huAt(vec3 tc0){','float huAt(vec3 tc0){nFetch++;')
 .replace('bool brickMayContain(vec3 tc){\n','bool brickMayContain(vec3 tc){nBrick++;\n').replace('int brickClass(vec3 tc){','int brickClass(vec3 tc){nBrick++;')
 .replace('uniform sampler3D clsTex;','uniform sampler3D clsTex;\nvec4 clsFetch(vec3 tc){nCls++;return texture(clsTex,tc);}').replace(/texture\(clsTex,/g,'clsFetch(').replace('vec4 clsFetch(vec3 tc){nCls++;return clsFetch(tc);}','vec4 clsFetch(vec3 tc){nCls++;return texture(clsTex,tc);}')
 .replace('precision highp float;','precision highp float;\nint nFetch=0;int nBrick=0;int nCls=0;int nDist=0;').replace('float distAt(vec3 tc){','float distAt(vec3 tc){nDist++;')
 .replace(/ outColor=acc;\n}$/,' outColor=vec4(float(nFetch),float(nBrick),float(nCls),float(nDist));\n}');
const A=load(fileA),B=fileB?load(fileB):null;
const nm=path.resolve('node_modules');
const VOL=process.env.VOL||null,volBytes=VOL?fs.readFileSync(VOL):null,volN=+(process.env.DIMS||256),clsBytes=process.env.CLS?fs.readFileSync(process.env.CLS):null,distBytes=process.env.DISTF?fs.readFileSync(process.env.DISTF):null,modes=(process.env.MODES||'hu,cls').split(',');
const srv=http.createServer((q,r)=>{if(q.url.startsWith('/vol.bin')){r.writeHead(200,{'content-type':'application/octet-stream'});return r.end(volBytes)}if(q.url.startsWith('/cls.bin')){r.writeHead(200,{'content-type':'application/octet-stream'});return r.end(clsBytes)}if(q.url.startsWith('/dist.bin')){r.writeHead(200,{'content-type':'application/octet-stream'});return r.end(distBytes)}if(q.url.startsWith('/distance-field.js')){r.writeHead(200,{'content-type':'text/javascript'});return r.end(fs.readFileSync('docs/distance-field.js','utf8'))}r.writeHead(200,{'content-type':'text/html'});r.end('<!doctype html><html><body></body></html>')}).listen(8779);
const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg=await b.newPage();pg.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('console.'+m.type()+':',m.text().slice(0,300))});pg.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,300)));
await pg.route(/^https:\/\//,rt=>{const u=rt.request().url();if(u.includes('three.module.js'))return rt.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(nm+'/three/build/three.module.js','utf8')});if(u.includes('three.core.js'))return rt.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(nm+'/three/build/three.core.js','utf8')});return rt.abort()});
await pg.goto('http://localhost:8779/');
const result=await pg.evaluate(async ({segM,A,B,countA,countB,refine,useDist,boneOnly,boneFat,noFat,regFat,regZero,fat,edit,useVol,volN,seg,segOp,distCls,cached,modes,section,bgSet,air})=>{
 const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js');
 const W=useVol?256:384,H=W,renderer=new THREE.WebGLRenderer({antialias:false});renderer.setPixelRatio(1);renderer.setSize(W,H,false);
 // phantom as in tools/volume-shader-check.mjs: u16 = HU + 1024, slope 1, intercept -1024
 // VOL: a raw u16 volume (little endian, DIMS³, HU = raw - 4000: the practice data as tools/../sample-volume.mjs halves it) instead of the phantom
 const N=useVol?volN:128;let data;let huOf=null;
 if(useVol){data=new Uint8Array(await (await fetch('/vol.bin')).arrayBuffer());huOf=(x,y,z)=>{const o=((z*N+y)*N+x)*2;return (data[o]|(data[o+1]<<8))-4000}}
 else data=new Uint8Array(N*N*N*2);
 const hu=(x,y,z)=>{if(huOf)return huOf(x,y,z);const cx=x-64,cy=y-64,cz=z-64;let v=-1000;
  const e=cx*cx/(52*52)+cy*cy/(40*40)+cz*cz/(56*56);
  if(e<1)v=40;
  // FAT=1: thin sheets of fat (-150 HU) every 6 voxels along the ellipsoid's radial direction, with holes (seeded pattern): the distance field stays small everywhere in the body
  if(fat===1&&e<1&&e>0.05){const r=Math.sqrt(e)*56;const sheet=Math.abs(r-6*Math.round(r/6))<0.5;const hole=((x*7+y*13+z*31)%11)<3;if(sheet&&!hole)v=-150}
  if(fat===2&&e<1&&e>0.05){let h=(x*73856093)^(y*19349663)^(z*83492791);h=(h^(h>>>13))*1274126177;h=(h^(h>>>16))>>>0;if((h%1000)<15)v=-150}
  if(cx*cx+cy*cy+cz*cz<22*22)v=900;
  if(Math.abs(cy-20)<1&&Math.abs(cx)<36&&Math.abs(cz)<36)v=900;const r=Math.hypot(cx+30,cz);if(r>8&&r<11&&Math.abs(cy)<40)v=900;return v};
 if(!useVol)for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){const q=hu(x,y,z)+1024,o=((z*N+y)*N+x)*2;data[o]=q&255;data[o+1]=q>>8}
 const INTERCEPT=useVol?-4000:-1024;
 const vol=new THREE.Data3DTexture(data,N,N,N);vol.format=THREE.RGFormat;vol.type=THREE.UnsignedByteType;vol.minFilter=vol.magFilter=THREE.LinearFilter;vol.unpackAlignment=1;vol.needsUpdate=true;
 // bricks 8³ with one voxel of overlap (vr-view computeBricks)
 const BS=8,bx=N/BS,mm=new Float32Array(bx*bx*bx*4); // four floats per brick (B = mask-only occupancy, unused here)
 for(let k=0;k<bx;k++)for(let j=0;j<bx;j++)for(let i=0;i<bx;i++){let lo=1e9,hi=-1e9;
  for(let z=Math.max(0,k*BS-1);z<Math.min(N,(k+1)*BS+1);z++)for(let y=Math.max(0,j*BS-1);y<Math.min(N,(j+1)*BS+1);y++)for(let x=Math.max(0,i*BS-1);x<Math.min(N,(i+1)*BS+1);x++){const v=hu(x,y,z);if(v<lo)lo=v;if(v>hi)hi=v}
  const o=((k*bx+j)*bx+i)*4;mm[o]=lo;mm[o+1]=hi}
 const bricks=new THREE.Data3DTexture(mm,bx,bx,bx);bricks.format=THREE.RGBAFormat;bricks.type=THREE.FloatType;bricks.minFilter=bricks.magFilter=THREE.NearestFilter;bricks.unpackAlignment=1;bricks.needsUpdate=true;
 // classification (vr-view): per segment 0.5 + (HU distance inside the range)/2048, one byte per channel
 const SEG=[seg.bone,seg.soft,seg.fat],C=4,cls=cached?new Uint8Array(await (await fetch('/cls.bin')).arrayBuffer()):new Uint8Array(N*N*N*C);
 const excluded=(x,y,z)=>edit&&z>=64&&y>=44&&y<=84&&x>=44&&x<=84;
 if(!cached)for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){const v=hu(x,y,z),o=((z*N+y)*N+x)*C;for(let s=0;s<3;s++){const [a,c]=SEG[s],d=Math.min(v-a,c-v);cls[o+s]=(s===0&&excluded(x,y,z))?0:Math.max(0,Math.min(255,Math.round(127.5+d/2048*255)))}}
 const clsTex=new THREE.Data3DTexture(cls,N,N,N);clsTex.format=THREE.RGBAFormat;clsTex.type=THREE.UnsignedByteType;clsTex.minFilter=clsTex.magFilter=THREE.LinearFilter;clsTex.unpackAlignment=1;clsTex.needsUpdate=true;
 // HU path edit mask (editAllows): channel 0 = 255 where bone is allowed
 const regData=new Uint8Array(N*N*N);if(!regZero)for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N/2;x++){if(regFat){const v=hu(x,y,z);if(v<seg.fat[0]||v>seg.fat[1])continue}regData[(z*N+y)*N+x]=1}
 const regionTex=new THREE.Data3DTexture(regData,N,N,N);regionTex.format=THREE.RedFormat;regionTex.type=THREE.UnsignedByteType;regionTex.minFilter=regionTex.magFilter=THREE.NearestFilter;regionTex.unpackAlignment=1;regionTex.needsUpdate=true;
 const editData=new Uint8Array(N*N*N*4);for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){const o=((z*N+y)*N+x)*4;editData[o]=excluded(x,y,z)?0:255;editData[o+1]=255;editData[o+2]=255;editData[o+3]=255}
 const editTex=new THREE.Data3DTexture(editData,N,N,N);editTex.format=THREE.RGBAFormat;editTex.type=THREE.UnsignedByteType;editTex.minFilter=editTex.magFilter=THREE.LinearFilter;editTex.unpackAlignment=1;editTex.needsUpdate=true;
 const dummy=new THREE.Data3DTexture(new Uint8Array(4),1,1,1);dummy.format=THREE.RGBAFormat;dummy.needsUpdate=true;
 const {buildDistanceBytes}=await import('/distance-field.js');const t0=performance.now();const dist=cached?{data:new Uint8Array(await (await fetch('/dist.bin')).arrayBuffer()),C:4,chan:[0,1,2,-1]}:await buildDistanceBytes({data:cls,C:4,chan:[0,1,2,-1]},[N,N,N]);const distMs=performance.now()-t0;
 // DISTCLS=1: write min over the shown segments' distance bytes into the classification alpha (channel 3)
 const shownCh=[0,1,2].filter(s=>!(boneOnly&&s>0)&&!(boneFat&&s===1)&&(s!==2||fat||useVol));
 if(distCls){for(let i=0;i<N*N*N;i++){let m=255;for(const c of shownCh)m=Math.min(m,dist.data[i*4+c]);cls[i*4+3]=m}clsTex.needsUpdate=true}
 const distTex=new THREE.Data3DTexture(dist.data,N,N,N);distTex.format=THREE.RGBAFormat;distTex.type=THREE.UnsignedByteType;distTex.minFilter=distTex.magFilter=THREE.NearestFilter;distTex.unpackAlignment=1;distTex.needsUpdate=true;
 const half=1.65,scale=3.3/N,step=scale*0.85;
 const uniforms=()=>({vol:{value:vol},bricks:{value:bricks},halfExt:{value:new THREE.Vector3(half,half,half)},texDims:{value:new THREE.Vector3(N,N,N)},brickDims:{value:new THREE.Vector3(bx,bx,bx)},
  stepSize:{value:step},diag:{value:0},calib:{value:new THREE.Vector3(1,INTERCEPT,0)},segA:{value:[new THREE.Vector4(seg.bone[0],seg.bone[1],segOp.bone,1),new THREE.Vector4(seg.soft[0],seg.soft[1],segOp.soft,1),new THREE.Vector4(seg.fat[0],seg.fat[1],segOp.fat,(fat||useVol)?1:0),new THREE.Vector4()]},segC:{value:[new THREE.Vector4(0.91,0.86,0.72,0),new THREE.Vector4(0.85,0.55,0.42,0),new THREE.Vector4(0.95,0.85,0.35,0),new THREE.Vector4()]},segM:{value:[0,1,2,3].map(()=>new THREE.Vector4(...segM))},
  cutPlanes:{value:Array.from({length:10},()=>new THREE.Vector4(0,0,1,0))},planeCount:{value:0},planeCut:{value:0},capOn:{value:1},sliceTint:{value:0.5},sliceOpacity:{value:0},sliceWindow:{value:new THREE.Vector2(40,400)},sliceAir:{value:air},sliceVol:{value:vol},useCls:{value:0},clsTex:{value:clsTex},clsChan:{value:new THREE.Vector4(0,1,2,-1)},editMask:{value:edit?1:0},editTex:{value:edit?editTex:dummy},regionTex:{value:regionTex},regionC:{value:Array.from({length:14},(_,i)=>new THREE.Vector3(...(i?[1,1,1]:[0,0.85,1])))},regionSeg:{value:Array.from({length:14},()=>regFat?4:15)},distInCls:{value:distCls},refine:{value:refine},distTex:{value:distTex},useDist:{value:0},voxelMin:{value:2*half/N}});
 const scene=new THREE.Scene();const cam=new THREE.PerspectiveCamera(45,1,0.01,50);if(useVol)cam.position.set(2.6,1.4,3.6);else cam.position.set(3.2,2.1,4.0);cam.lookAt(0,0,0);cam.updateMatrixWorld();
 const rtColor=new THREE.WebGLRenderTarget(W,H,{depthBuffer:false}),rtCount=new THREE.WebGLRenderTarget(W,H,{depthBuffer:false,type:THREE.FloatType});
 const run=(sh,mode,count)=>{
  const u=uniforms();u.useCls.value=mode;u.useDist.value=mode&&useDist?1:0;if(boneOnly){u.segA.value[1].w=0;u.segA.value[2].w=0}if(boneFat)u.segA.value[1].w=0;if(noFat)u.segA.value[2].w=0;
  // SECTION=1: one section plane through the centre (normal (0.6,0.3,0.74), the half towards the camera removed), cut face and CT slice at 70 % with tint
  if(section){const n=new THREE.Vector3(0.6,0.3,0.74).normalize();u.cutPlanes.value[0].set(n.x,n.y,n.z,0.05);u.planeCount.value=1;u.planeCut.value=1;u.capOn.value=1;u.sliceOpacity.value=0.7;u.sliceTint.value=0.5}
  const mat=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:sh.vs,fragmentShader:count?sh.fsc:sh.fs,side:THREE.BackSide,uniforms:u,transparent:false,blending:THREE.NoBlending,depthWrite:false});
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),mat);mesh.frustumCulled=false;scene.add(mesh);
  const rt=count?rtCount:rtColor;renderer.setRenderTarget(rt);renderer.setClearColor(0x000000,bgSet?0:1);
  // timing: SwiftShader runs the fragment work on readback, so the pixels are read inside the timed region (min of 5)
  const tmp=new Uint8Array(W*H*4);const times=[];for(let i=0;i<(count?1:5);i++){renderer.clear();const t0=performance.now();renderer.render(scene,cam);renderer.readRenderTargetPixels(count?rtCount:rtColor,0,0,1,1,count?new Float32Array(4):tmp.subarray(0,4));renderer.getContext().finish();times.push(performance.now()-t0)}
  let px;if(count){px=new Float32Array(W*H*4);renderer.readRenderTargetPixels(rt,0,0,W,H,px);let f=0,br=0,c=0,dd=0;for(let i=0;i<px.length;i+=4){f+=px[i];br+=px[i+1];c+=px[i+2];dd+=px[i+3]}scene.remove(mesh);mat.dispose();return{sums:{fetch:f,brick:br,cls:c,dist:dd}}}
  px=new Uint8Array(W*H*4);renderer.readRenderTargetPixels(rt,0,0,W,H,px);scene.remove(mesh);mat.dispose();times.sort((a,b)=>a-b);
  const err=renderer.getContext().getError();return{ms:times[0],px:Array.from(px),glErr:err};
 };
 const shA={vs:A.vs,fs:A.fs,fsc:countA},shB=B?{vs:B.vs,fs:B.fs,fsc:countB}:null,out={};
 for(const mode of [0,1]){if(!modes.includes(mode?'cls':'hu'))continue;out['A'+mode]=run(shA,mode,false);out['A'+mode+'c']=run(shA,mode,true);if(shB){out['B'+mode]=run(shB,mode,false);out['B'+mode+'c']=run(shB,mode,true)}}
 return{W,H,out,distMs};
},{segM:materialVec('standard'),A,B,countA:counting(A.fs),countB:B?counting(B.fs):null,refine:+(process.env.REFINE??1),useDist:+(process.env.DIST??1),boneOnly:process.env.SEGS==='bone',boneFat:process.env.SEGS==='bonefat',noFat:process.env.SEGS==='nofat',regFat:process.env.REGION==='fat',regZero:!!process.env.REGZERO,fat:+(process.env.FAT??0),edit:+(process.env.EDIT??0),useVol:!!VOL,volN,distCls:+(process.env.DISTCLS??0),cached:!!(clsBytes&&distBytes),modes,section:+(process.env.SECTION??0),bgSet:!!process.env.BG,air:+(process.env.AIR??-500),seg:{bone:(process.env.BONE||'300,3000').split(',').map(Number),soft:(process.env.SOFT||'-200,299').split(',').map(Number),fat:(process.env.FATR||'-250,-50').split(',').map(Number)},segOp:{bone:+(process.env.BONEOP??1),soft:+(process.env.SOFTOP??0.35),fat:+(process.env.FATOP??1)}});
await b.close();srv.close();
const {W,H,out,distMs}=result;console.log('distance field build (128³, 2 channels): '+distMs.toFixed(0)+' ms');
import zlib from 'node:zlib';
const png=(px,w,h)=>{const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;for(let x=0;x<w*4;x++)raw[y*(w*4+1)+1+x]=px[(h-1-y)*w*4+x]}
 const crc=b=>{let c=~0;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^(0xEDB88320&-(c&1))}return ~c>>>0};
 const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])};
// BG=r,g,b: composite the premultiplied result over this background before the PNGs and the A/B
// comparison, so a change of alpha alone (e.g. a transparent slice over black) is counted
const BG=process.env.BG?process.env.BG.split(',').map(Number):null;
if(BG)for(const k of Object.keys(out)){const r=out[k];if(!r?.px)continue;const p=r.px;for(let i=0;i<p.length;i+=4){const ia=1-p[i+3]/255;for(let j=0;j<3;j++)p[i+j]=Math.min(255,Math.round(p[i+j]+BG[j]*ia))}}
for(const mode of [0,1]){
 const name=mode?'cls':'HU';
 for(const k of ['A','B']){const r=out[k+mode];if(!r)continue;const c=out[k+mode+'c'].sums;
  console.log(k+' ('+name+'): SwiftShader '+r.ms.toFixed(0)+' ms (min of 5; CPU proxy) · per pixel HU fetches '+(c.fetch/(W*H)).toFixed(1)+', brick reads '+(c.brick/(W*H)).toFixed(1)+', cls fetches '+(c.cls/(W*H)).toFixed(1)+', dist fetches '+(c.dist/(W*H)).toFixed(1)+(r.glErr?' · GL error '+r.glErr:''));
  fs.writeFileSync(path.join(outDir,'vr-'+k+'-'+name+'.png'),png(r.px.map((v,i)=>i%4===3?255:v),W,H));}
 if(out['B'+mode]){const a=out['A'+mode].px,bb=out['B'+mode].px;let maxd=0,n=0,sum=0;for(let i=0;i<a.length;i++){if(i%4===3)continue;const d=Math.abs(a[i]-bb[i]);if(d){n++;sum+=d;if(d>maxd)maxd=d}}
  console.log('A vs B ('+name+'): differing channels '+n+' of '+(a.length*3/4)+', max |diff| '+maxd+', mean |diff| over differing '+(n?(sum/n).toFixed(2):0));
  fs.writeFileSync(path.join(outDir,'vr-diff-'+name+'.png'),png(a.map((v,i)=>i%4===3?255:Math.min(255,Math.abs(v-bb[i])*8)),W,H))}
}
console.log('images in',outDir);
