// Checks the VR slice shader (extracted from docs/vr-view.js) against the 2D window per opacity; run: PW_CHROMIUM=/opt/pw-browsers/chromium node tools/vr-slice-check.mjs
// Headless measurement: the real VR fragment shader (docs/vr-view.js) drawing
// an oblique-free axial slice of a synthetic HU ramp, read back as bytes and
// compared with the 2D MPR formula (mpr-render.js: round((hu-low)*255/ww)).
// Runs three.js from node_modules in headless Chromium (SwiftShader WebGL2).
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { resolveLighting } from './lib/vr-gl-harness.mjs';
import { materialVec } from '../docs/lighting.js';
const root=path.resolve('docs'),nm=path.resolve('node_modules');
const src=fs.readFileSync(path.join(root,'vr-view.js'),'utf8');
const grab=name=>{const m=src.match(new RegExp('const '+name+'=`([\\s\\S]*?)`;'));if(!m)throw new Error('shader '+name+' not found');return resolveLighting(m[1])}; // build 612: the shared lighting placeholders
const vertexShader=grab('vertexShader'),fragmentShader=grab('fragmentShader');
const srv=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end('<!doctype html><html><body></body></html>')}).listen(8766);
const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg=await b.newPage();
pg.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('console.'+m.type()+':',m.text().slice(0,400))});
pg.on('pageerror',e=>console.log('PAGEERROR:',String(e).slice(0,500)));
await pg.route(/^https:\/\//,async rt=>{const u=rt.request().url();
 if(u.includes('three.module.js'))return rt.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(nm+'/three/build/three.module.js','utf8')});
 if(u.includes('three.core.js'))return rt.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(nm+'/three/build/three.core.js','utf8')});
 return rt.abort()});
await pg.goto('http://localhost:8766/');
const result=await pg.evaluate(async ({vertexShader,fragmentShader,segM})=>{
 const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js');
 const W=64,H=64;
 const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false});renderer.setPixelRatio(1);renderer.setSize(W,H,false);
 // synthetic volume: 64×8×8 voxels, u16 stored value = HU (slope 1, intercept 0,
 // unsigned), HU ramps along x from 0 to 630 (10 HU per voxel)
 const dims=[64,8,8],data=new Uint8Array(dims[0]*dims[1]*dims[2]*2);
 for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){const v=x*10,o=((z*dims[1]+y)*dims[0]+x)*2;data[o]=v&255;data[o+1]=v>>8}
 const vol=new THREE.Data3DTexture(data,...dims);vol.format=THREE.RGFormat;vol.type=THREE.UnsignedByteType;vol.minFilter=vol.magFilter=THREE.LinearFilter;vol.unpackAlignment=1;vol.needsUpdate=true;
 // bricks: one brick covering everything, HU 0..630
 const bricks=new THREE.Data3DTexture(new Float32Array([0,630,0,0]),1,1,1);bricks.format=THREE.RGBAFormat;bricks.type=THREE.FloatType;bricks.minFilter=bricks.magFilter=THREE.NearestFilter;bricks.needsUpdate=true; // build 526: RGBA32F (B = mask-only occupancy)
 const dummy=new THREE.Data3DTexture(new Uint8Array(4),1,1,1);dummy.format=THREE.RGBAFormat;dummy.needsUpdate=true;
 const halfExt=[1.6,0.2,0.2];
 const u={vol:{value:vol},bricks:{value:bricks},halfExt:{value:new THREE.Vector3(...halfExt)},texDims:{value:new THREE.Vector3(...dims)},brickDims:{value:new THREE.Vector3(1,1,1)},
  stepSize:{value:0.02},diag:{value:0},calib:{value:new THREE.Vector3(1,0,0)},segA:{value:[0,1,2,3].map(()=>new THREE.Vector4())},segC:{value:[0,1,2,3].map(()=>new THREE.Vector4())},segM:{value:[0,1,2,3].map(()=>new THREE.Vector4(...segM))},
  cutPlanes:{value:Array.from({length:10},()=>new THREE.Vector4(0,0,1,0))},planeCount:{value:1},planeCut:{value:1},capOn:{value:0},sliceTint:{value:0},sliceOpacity:{value:1},sliceWindow:{value:new THREE.Vector2(300,400)},sliceVol:{value:vol},useCls:{value:0},clsTex:{value:dummy},clsChan:{value:new THREE.Vector4(-1,-1,-1,-1)},editMask:{value:0},editTex:{value:dummy}};
 const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader,side:THREE.BackSide,toneMapped:false,uniforms:u});
 material.transparent=true;material.depthWrite=false;material.blending=THREE.CustomBlending;material.blendSrc=THREE.OneFactor;material.blendDst=THREE.OneMinusSrcAlphaFactor;
 const scene=new THREE.Scene();const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material);mesh.frustumCulled=false;scene.add(mesh);
 // orthographic camera looking down -z at the slab; the plane z=0 (normal +z,
 // kept side z>=0 i.e. towards the eye is removed -> normal flipped: kept
 // side is dot(n,p)>=w with n=(0,0,-1), w=0 => z<=0 kept, eye at +z removed)
 u.cutPlanes.value[0].set(0,0,-1,0);
 const cam=new THREE.OrthographicCamera(-halfExt[0],halfExt[0],halfExt[1],-halfExt[1],0.01,10);cam.position.set(0,0,3);cam.lookAt(0,0,0);
 const BG=new THREE.Color(0.035,0.045,0.05);
 const read=()=>{const px=new Uint8Array(W*H*4);renderer.getContext().readPixels(0,0,W,H,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,px);return px};
 const row=(px,y)=>{const out=[];for(let x=0;x<W;x++)out.push(px[(y*W+x)*4]);return out};
 const run=(label,setup)=>{setup();renderer.setClearColor(BG,1);renderer.clear();renderer.render(scene,cam);const px=read();return{label,row:row(px,H>>1),g:row(px,H>>1).map((_,x)=>px[((H>>1)*W+x)*4+1]),b:row(px,H>>1).map((_,x)=>px[((H>>1)*W+x)*4+2])}};
 const cases=[];
 cases.push(run('opacity 100%, no cap, no tint',()=>{u.sliceOpacity.value=1;u.capOn.value=0;u.sliceTint.value=0}));
 cases.push(run('opacity 60%, no cap, no tint (default opacity)',()=>{u.sliceOpacity.value=0.6;u.capOn.value=0;u.sliceTint.value=0}));
 // bone-like segment over HU >= 350 (white-ish colour), opacity 1, normal mode
 const seg=()=>{u.segA.value[0].set(350,10000,1,1);u.segC.value[0].set(0.9,0.85,0.7,0)};
 cases.push(run('opacity 60%, cap on, tint 0.5, segment HU>=350 (defaults)',()=>{seg();u.sliceOpacity.value=0.6;u.capOn.value=1;u.sliceTint.value=0.5}));
 cases.push(run('opacity 100%, cap on, tint 0.5, segment HU>=350',()=>{seg();u.sliceOpacity.value=1;u.capOn.value=1;u.sliceTint.value=0.5}));
 cases.push(run('opacity 100%, cap off, tint 0, segment HU>=350',()=>{seg();u.sliceOpacity.value=1;u.capOn.value=0;u.sliceTint.value=0}));
 const gl=renderer.getContext();
 return{cases,gl:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER),W};
},{vertexShader,fragmentShader,segM:materialVec('standard')});
await b.close();srv.close();
// 2D formula (mpr-render.js): low=wc-ww/2, g=clamp(round((hu-low)*255/ww))
const wc=300,ww=400,low=wc-ww/2,scale=255/ww;
const hu2d=x=>{const xs=-1.6+(x+0.5)/64*3.2,xp=xs*3/3.2,u=0.5+xp/3.2,hu=10*(u*64-0.5);return{hu:Math.round(hu),g:Math.max(0,Math.min(255,Math.round((hu-low)*scale)))}};
console.log('GL:',result.gl,'/',result.renderer);
console.log('window centre',wc,'width',ww,'  HU = value the ray samples on the plane (rays leave the eye at z=3, plane z=0)');
const cols=[4,12,20,24,28,32,36,40,44,52,60];
for(const c of result.cases){
 console.log('\n== VR: '+c.label);
 const segOn=/segment/.test(c.label);console.log(' x     HU   2D-r 2D-g 2D-b   VR-r VR-g VR-b   VR-2D (r)');
 for(const x of cols){const {hu,g}=hu2d(x);let r2=g,g2=g,b2=g;if(segOn&&hu>=350){const a=Math.min(.75,1*.65);r2=Math.round(g*(1-a)+230*a);g2=Math.round(g*(1-a)+217*a);b2=Math.round(g*(1-a)+179*a)}console.log(String(x).padStart(2),String(hu).padStart(6),String(r2).padStart(5),String(g2).padStart(4),String(b2).padStart(4),String(c.row[x]).padStart(6),String(c.g[x]).padStart(4),String(c.b[x]).padStart(4),String(c.row[x]-r2).padStart(7))}
}
