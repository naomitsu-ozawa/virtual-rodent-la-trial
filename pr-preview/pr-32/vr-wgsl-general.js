// The general loop of the WebGL program (docs/vr-view.js, the loop after `}else for(int iter...` of fragmentShader: no distance jumps, the bricks' min / max HU skip the empty bricks and cross a uniform brick at once, a hit is searched and shaded where it is
// found and the ray goes on behind it when its segment is see-through) as a text of the WGSL volume pass. It is the program of every frame whose combined classification + distance texture is not in use (distInCls 0 or useCls 0):
// the diagnostic that takes the distance field away (distDiag), data without a distance field, the classification-off diagnostic (the HU of the data itself: src 'hu').
// The text is made from the core text (docs/vr-wgsl-core.js volumeWgsl: the bindings, the helpers, the section planes, the slices, the cut face, the output) by replacing its march (from the per-ray constants to the end of the deferred hit) with this loop,
// so everything outside the march is the core's own. Nothing of the march is shared with the core's loop: the samples are at t = t0 + n * step only until a brick is skipped, so the core's grid index k does not exist here.
// skip: the way of the display for these frames (the plan's chapter 5-2): the marks of docs/vr-wgpu-marks.js (group 1) tell that the sample is outside every shown segment, and then its read is left out: the loop's state after it is the state after a read that finds
// no segment (lastIndex -1, prevValid, previousT = t, the same next t), and prevSkip makes a hit that follows read the outside value (prevF) at previousT; the bricks, the nextT, the iteration count are the baseline's own.
import { volumeWgsl } from './vr-wgsl-core.js?v=20261125-build763';
import { featParts, featOf } from './vr-wgsl-feat.js?v=20261125-build763';
import { COARSE } from './vr-wgpu-coarse-proxy.js?v=20261125-build763';
import { MARK_GROUP } from './vr-wgpu-marks.js?v=20261125-build763';
import { HU_MAY_WGSL } from './vr-wgpu-humarks.js?v=20261125-build763'; // the HU marks' test of the classification-off diagnostic

export const BRICKS_BINDING = 14; // rgba32float, 3d, one texel per 8^3 brick: R, G = the HU min / max of the brick (one voxel of overlap), B = the occupancy nibble of the mask-only segments
const once = (t, from) => { const i = t.indexOf(from); if (i < 0 || t.indexOf(from, i + 1) >= 0) throw new Error('general loop: anchor not found exactly once: ' + from.slice(0, 70)); return i; };

export function generalWgsl({ f16 = false, cls4 = false, events = false, feat = null, src = 'cls', skip = false } = {}) {
  const FT = featParts(feat), H = (s, e = '') => (FT.on ? s : e), core = volumeWgsl({ f16, cls4, events, feat });
  const TT = !!featOf(feat);
  // ---- the pieces of the loop's setup
  const iA = once(core, ' let skipOn=u.useSkip>0&&u.diag!=4;\n'), iB = once(core, '  depthMark(hi,1.0);\n }\n'), iEnd = iB + '  depthMark(hi,1.0);\n }\n'.length;
  const evA = core.indexOf('  // slices up to t + step, then the cut face, then the sample (the order of the WebGL loop)\n'), evB = core.indexOf('  // the creep skip:');
  const ev = events && evA >= 0 && evB > evA ? core.slice(evA, evB).replace('lastIndex=ci;previousT=t;k++;continue;', 'lastIndex=ci;previousT=t;t+=stp;continue;') : '';
  if (events && !ev.includes('t+=stp;continue;')) throw new Error('general loop: the section block of the core text was not found');
  const segFns = (src === 'hu'
    ? `var<private> gHu:f32=0.0;
fn editAllows(s:i32,tc:vec3<f32>)->bool{
 if(((u.editMask>>u32(s))&1)==0){return true;}
 return textureSampleLevel(editTex,smpE,cl(tc),0.0)[s]>=0.5;
}
// the segment (slot) the data's own value at tc is in (its HU range, or the processing mask alone), -1 = none; gHu = the value read
fn segIdxAt(tc:vec3<f32>)->i32{
 let v=huAt(tc);gHu=v;
 for(var s=0;s<NSEG;s++){let a=u.segA[s];if(a.w>0.5&&(((u.editMaskOnly>>u32(s))&1)==1||(v>=a.x&&v<=a.y))&&editAllows(s,tc)){return s;}}
 return -1;
}
fn segIdxG(tc:vec3<f32>)->i32{return segIdxAt(tc);}
fn segValue(s:i32)->f32{let a=u.segA[s];return select(a.y-gHu,gHu-a.x,gHu<a.x);}
`
    : `var<private> gQ:vec4<f32>=vec4<f32>(0.0);
// the classification vector at tc (gQ = what the last read found: the values the search and the next sample's outside value are made from)
fn segIdxG(tc:vec3<f32>)->i32{let q=clsAt(tc);gQ=q;return segIdxOfQ(q);}
fn segValue(s:i32)->f32{let c=u.clsChan[s];return select(-1.0,gQ[c] - 0.5,c>=0);}
`)
    + (skip && src === 'hu' ? HU_MAY_WGSL : '') + `fn maxSegValue()->f32{var m=-1.0e9;for(var s=0;s<NSEG;s++){if(u.segA[s].w>0.5){m=max(m,segValue(s));}}return m;}
fn brickClass(tc:vec3<f32>)->i32{
 let bd=vec3<f32>(textureDimensions(bricks));
 let mm=textureLoad(bricks,vec3<i32>(clamp(tc,vec3<f32>(0.0),vec3<f32>(0.999999))*bd),0).rgb;let occ=i32(mm.z+0.5);
 for(var s=0;s<NSEG;s++){
  let a=u.segA[s];
  if(a.w>0.5&&select(a.y>=mm.x&&a.x<=mm.y,((occ>>u32(s))&1)==1,((u.editMaskOnly>>u32(s))&1)==1)){
   if(mm.x>=a.x&&mm.y<=a.y&&((u.editMask>>u32(s))&1)==0){return 2+s;}
   return 1;
  }
 }
 return 0;
}
// the distance along dir (object space) to leave the brick tc is in
fn brickExit(tc:vec3<f32>,dir:vec3<f32>)->f32{
 let bd=vec3<f32>(textureDimensions(bricks));
 let dtc=vec3<f32>(dir.x/(2.0*u.halfExt.x),-dir.y/(2.0*u.halfExt.y),dir.z/(2.0*u.halfExt.z));
 let cell=floor(clamp(tc,vec3<f32>(0.0),vec3<f32>(0.999999))*bd);
 var best=1.0e20;
 for(var i=0;i<3;i++){
  if(abs(dtc[i])>1.0e-8){
   let edge=select(cell[i],cell[i]+1.0,dtc[i]>0.0)/bd[i];
   let dt=(edge-tc[i])/dtc[i];
   if(dt>1.0e-7){best=min(best,dt);}
  }
 }
 return best;
}
`;
  const marksDecl = skip ? `@group(${MARK_GROUP.group}) @binding(${MARK_GROUP.tex}) var markTex:texture_3d<u32>;\n` : '';
  const perRay = skip ? (src === 'hu' ? ` let markDims=vec3<f32>(textureDimensions(vol));
 let markCells=vec3<i32>(ceil(markDims/${COARSE.cell}.0));
` : ` var shownMask=0u;
 {for(var s=0;s<4;s++){let c=u.clsChan[s];if(c>=0&&u.segA[s].w>0.5){shownMask=shownMask|(1u<<u32(c));}}}
 let markDims=vec3<f32>(textureDimensions(clsTex));
 let markCells=vec3<i32>(ceil(markDims/${COARSE.cell}.0));
`) : '';
  // the skip, before the sample's read: the cell's marks say no shown segment can be inside (the classification's: the channel marks; the HU path's: the value range and the edit maxima, docs/vr-wgpu-humarks.js)
  const skipBlock = skip ? `   {
    let mc=min(vec3<i32>(clamp(tc0,vec3<f32>(0.0),vec3<f32>(0.999999))*markDims)/${COARSE.cell},markCells-vec3<i32>(1));
${src === 'hu' ? `    let mt=textureLoad(markTex,mc,0);
    if(!huCellMay(mt)){` : `    let mt=textureLoad(markTex,vec3<i32>(mc.x/${COARSE.perTexel},mc.y,mc.z),0);
    if((mt[mc.x%${COARSE.perTexel}]&shownMask)==0u){`}prevValid=true;prevSkip=true;lastIndex=-1;${H('prevHid=false;')}previousT=t;t=nextT;continue;}
   }
` : '';
  const SA = FT.segA, SM = FT.segM;
  const child = FT.C ? `     {var chI=cIdx(tc0).x;var chE=vec4<f32>(0.0);if(chI>=1){chE=childLut[256+chI];}
      passH=${FT.chH}(tc0,idx);
      if(!passH&&((i32(chE.a+0.5)>>u32(idx))&1)==1){chI=cIdx(tc0).y;chE=vec4<f32>(0.0);if(chI>=1){chE=childLut[256+chI];}}
      if(((i32(chE.b+0.5)>>u32(idx))&1)==1){simple=true;}
      childLook(chI,idx);}
` : '';
  const loop = ` var brickEnd=-1.0;var uniformSeg=-1;
${perRay} for(var iter=0;iter<4096;iter++){
  if(t>endT||acc.a>ACC_STOP){break;}
  iters++;
${ev}  let p=o+dir*t;let tc0=texCoord(p);
${H('  var hidNow=false;\n')}  var canSample=u.diag==4||t<brickEnd;
  if(!canSample){let bc=brickClass(tc0);canSample=bc>0;uniformSeg=select(-1,bc-2,bc>=2);if(canSample){brickEnd=t+brickExit(tc0,dir);}}
  var nextT=t+stp;
  if(!canSample){brickEnd=-1.0;prevValid=false;nextT=t+max(brickExit(tc0,dir)+stp*0.05,stp);lastIndex=-1;}
  else if(u.diag!=4&&uniformSeg>=0&&uniformSeg==lastIndex&&brickEnd>t+stp${H('&&!hideAnyOn()')}){
   // inside a uniform brick of the segment the ray is already in: nothing changes until it is left
   nextT=brickEnd+stp*0.05;previousT=max(t,brickEnd-stp*0.05);prevValid=false;t=nextT;continue;
  }
  else{
${skipBlock}   let idx=segIdxG(tc0);
   let curF=select(-1.0,segValue(idx),idx>=0);
   if(idx!=lastIndex){
${H('    var passH=false;\n')}    if(idx>=0){
${skip ? '     if(prevSkip&&prevValid){let ip=segIdxG(texCoord(o+dir*previousT));prevF=maxSegValue();}\n' : ''}     var lo=previousT;var hi=t;${H('var', 'let')} simple=u.diag==3||u.segC[idx].w>0.5;
${child}${FT.R ? `     if(!passH&&u.regionAnyHidden!=0){passH=${FT.rgH}(tc0,idx);}\n` : ''}${H('     hidNow=passH;\n     if(!passH){\n')}      var f1=curF;let iso=u.refine==1&&((u.editMask>>u32(idx))&1)==0&&prevValid&&prevF<0.0;
      var f0=prevF;
      if(!simple&&iso${H('&&!hideAnyOn()')}){
       for(var r=0;r<3;r++){
        var mid=(lo+hi)*0.5;if(r<2&&abs(f1-f0)>1.0e-6){mid=clamp(lo+(hi-lo)*(-f0/(f1-f0)),lo+(hi-lo)*0.02,hi-(hi-lo)*0.02);}
        let inside=segIdxG(texCoord(o+dir*mid))==idx;let fm=segValue(idx);
        if(inside){hi=mid;f1=fm;}else{lo=mid;f0=fm;}
       }
      }else if(!simple){
       for(var r=0;r<6;r++){
        let mid=(lo+hi)*0.5;let tm=texCoord(o+dir*mid);
        if(segIdxG(tm)==idx${H('&&!(hideAnyOn()&&hideAt(tm,idx))')}){hi=mid;}else{lo=mid;}
       }
      }
      let hp=o+dir*hi;let tc=texCoord(hp);
${FT.on ? `      var face=!simple&&hi<=faceEnd;
      var n=-dir;var hcut=false;
      if(!simple){if(face){n=entryFaceNormal(o,dir);}else{if(prevHid){let hn=hideGrad(tc,idx);if(dot(hn,hn)>0.0){n=normalize(hn);hcut=true;}}if(!hcut){n=gradientAtS(tc,idx);}}}
      face=face||hcut;
` : `      let face=!simple&&hi<=faceEnd;
      var n=-dir;
      if(!simple){if(face){n=entryFaceNormal(o,dir);}else{n=gradientAtS(tc,idx);}}
`}      let viewDir=normalize(o-hp);let later=acc.a>0.0&&!simple&&!face;
      let nn=select(n,select(n,-n,gHuMean<0.5*(u.segA[idx].x+u.segA[idx].y)),later);
      let shade=vrlShade(nn,viewDir,u.lightOff,vrlDepth01(hi,o,u.halfExt),select(0.0,1.0,later),${SM}[idx].xyz);
      let alpha=clamp(${SA}[idx].z,0.03,1.0);
      let lit=${FT.col('hp+dir*(0.75*u.voxelMin)', 'u.segC[idx].rgb', 'idx')}*shade.x+vec3<f32>(shade.y);
      let contribution=(1.0-acc.a)*alpha;acc=vec4<f32>(acc.rgb+lit*contribution,acc.a+contribution);depthMark(hi,contribution);
${H('     }\n')}    }
    lastIndex=${H('select(idx,-1,passH)', 'idx')};
   }${H(' else if(idx>=0&&hideAnyOn()&&hideAt(tc0,idx)){lastIndex=-1;hidNow=true;}')}
   // the outside value for the next segment's search: the largest segment value of this sample when no segment holds it (kept negative), else its own
   prevSkip=false;prevValid=true;prevF=select(maxSegValue(),curF,idx>=0);
  }
${H('  prevHid=hidNow;\n')}  previousT=t;t=nextT;
 }
`;
  let out = core.slice(0, iA) + loop + core.slice(iEnd);
  if (FT.bake) { once(out, FT.bake); out = out.replace(FT.bake, ''); } // the general loop is the WebGL 'full' program's: no baked cut's light (VRL_BAKE_CUT needs VRL_NO_GENERAL)
  // the bindings and the segment helpers
  const declAnchor = '@group(0) @binding(9) var proxyTex:texture_2d<f32>;\n';
  once(out, declAnchor);
  out = out.replace(declAnchor, declAnchor + '@group(0) @binding(' + BRICKS_BINDING + ') var bricks:texture_3d<f32>;\n' + marksDecl);
  const fnAnchor = 'fn segIdxAt(tc:vec3<f32>)->i32{return segIdxOfQ(clsAt(tc));}\n';
  once(out, fnAnchor);
  out = out.replace(fnAnchor, (src === 'hu' ? '' : fnAnchor) + segFns);
  void TT;
  return out.replace(/(\/\/ VR \/ AR volume pass \(WGSL\), variant [^\n]*)\n/, '$1 general src=' + src + (skip ? ' skip-marks' : '') + '\n');
}
