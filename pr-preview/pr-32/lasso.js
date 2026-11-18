// Lasso (pen-drawn loop) selection geometry for the 3D editor.
// Pure functions: no DOM, no three.js objects (matrices are passed as the
// column-major 16-element arrays three.js keeps in Matrix4.elements).

// Even-odd rule point-in-polygon test. poly: [{x,y}, ...] (implicitly closed).
export function pointInPolygon(x,y,poly){
 let inside=false;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const a=poly[i],b=poly[j];
  if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
 }
 return inside;
}

export function polygonBounds(poly){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const p of poly){if(p.x<minX)minX=p.x;if(p.x>maxX)maxX=p.x;if(p.y<minY)minY=p.y;if(p.y>maxY)maxY=p.y}
 return{minX,minY,maxX,maxY};
}

// Voxel (x,y,z) -> canvas pixel {x,y}, or null when behind the camera.
// Voxel placement matches makeVolume3DCoordinates / surfaceSegmentPointerVoxel:
//   local = ((i*spacing - extent/2) * scale) with y flipped, scale = 3.3 / max extent,
// then world = objectMatrixWorld * local, clip = viewProjection * world.
export function makeVoxelProjector(v,objectMatrixWorld,viewProjection,width,height){
 const [sx,sy,sz]=v.spacing,px=v.columns*sx,py=v.rows*sy,pz=v.slices*sz,scale=3.3/Math.max(px,py,pz,1);
 const o=objectMatrixWorld,m=viewProjection;
 return(x,y,z)=>{
  const lx=(x*sx-px/2)*scale,ly=-(y*sy-py/2)*scale,lz=(z*sz-pz/2)*scale;
  const wx=o[0]*lx+o[4]*ly+o[8]*lz+o[12],wy=o[1]*lx+o[5]*ly+o[9]*lz+o[13],wz=o[2]*lx+o[6]*ly+o[10]*lz+o[14];
  const cx=m[0]*wx+m[4]*wy+m[8]*wz+m[12],cy=m[1]*wx+m[5]*wy+m[9]*wz+m[13],cw=m[3]*wx+m[7]*wy+m[11]*wz+m[15];
  if(cw<=1e-9)return null;
  return{x:(cx/cw+1)*0.5*width,y:(1-cy/cw)*0.5*height};
 };
}

// True when every voxel of a component projects inside the loop. Rows are run
// records (flat [y, x0, x1, ...] per slice, see run-length.js); run ends plus
// samples every `step` voxels are tested, and the test stops at the first
// point outside, so large structures crossing the loop are rejected quickly.
export function componentFullyInside(runsBySlice,project,poly,{step=4,bounds=polygonBounds(poly)}={}){
 let tested=0;
 for(let z=0;z<runsBySlice.length;z++){
  const runs=runsBySlice[z];if(!runs?.length)continue;
  for(let i=0;i<runs.length;i+=3){
   const y=runs[i],x0=runs[i+1],x1=runs[i+2];
   for(let x=x0;;x=Math.min(x1,x+step)){
    const p=project(x,y,z);tested++;
    if(!p||p.x<bounds.minX||p.x>bounds.maxX||p.y<bounds.minY||p.y>bounds.maxY||!pointInPolygon(p.x,p.y,poly))return false;
    if(x>=x1)break;
   }
  }
 }
 return tested>0;
}
