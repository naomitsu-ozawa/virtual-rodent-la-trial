// Linked crosshair (build 458): pure geometry, no DOM and no imports (unit-tested in tests/unit/crosshair.test.js).
// A position is a VOXEL index {i,j,k} (integers inside the data), not patient millimetres: dicom.js orders slices by Z only and
// does not read ImageOrientationPatient, so millimetres would be wrong for a tilted series, while voxel indices stay valid
// whatever orientation handling is added later. Millimetres are derived from volume.spacing and are for display only.
// The object is plain JSON ({i,j,k}) so a later stage can store it in a comment or the project file.
//
// 2D drawing (mpr-render.js): axial x = column (i), y = row (j); coronal x = column (i), y = slices-1-k (slice index = j);
// sagittal x = row (j), y = slices-1-k (slice index = i). The canvas is stretched over the displayed rectangle, so a pixel
// maps to a voxel by FRACTION of the rectangle (anisotropic spacing only changes the rectangle's aspect, not the mapping).
export const CROSSHAIR_PLANES=['axial','coronal','sagittal'];
const isDims=d=>!!d&&d.columns>0&&d.rows>0&&d.slices>0;
const clampInt=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
// [width,height] in voxels of the 2D image of a plane
export function planeDims(plane,dims){
 return plane==='axial'?[dims.columns,dims.rows]:plane==='coronal'?[dims.columns,dims.slices]:[dims.rows,dims.slices];
}
// slice index of a plane that a voxel lies on
export function sliceIndexFor(plane,v){return plane==='axial'?v.k:plane==='coronal'?v.j:v.i}
// the voxel with one plane's slice index replaced (clamped); the other two coordinates stay
export function withSliceIndex(v,plane,idx,dims){
 const n=Math.round(Number(idx));if(!Number.isFinite(n))return null;
 const out={i:v.i,j:v.j,k:v.k};
 if(plane==='axial')out.k=clampInt(n,0,dims.slices-1);else if(plane==='coronal')out.j=clampInt(n,0,dims.rows-1);else out.i=clampInt(n,0,dims.columns-1);
 return out;
}
// integer voxel inside the data, or null when v is not a usable position / there is no volume
export function clampVoxel(v,dims){
 if(!v||!isDims(dims))return null;
 const i=Math.round(Number(v.i)),j=Math.round(Number(v.j)),k=Math.round(Number(v.k));
 if(![i,j,k].every(Number.isFinite))return null;
 return{i:clampInt(i,0,dims.columns-1),j:clampInt(j,0,dims.rows-1),k:clampInt(k,0,dims.slices-1)};
}
export const sameVoxel=(a,b)=>!!a&&!!b&&a.i===b.i&&a.j===b.j&&a.k===b.k;
// position of a point inside the displayed rectangle as a fraction 0..1 (clamped: a drag may leave the image)
export function clientToFraction(rect,clientX,clientY){
 const w=Math.max(rect.width,1e-9),h=Math.max(rect.height,1e-9);
 return{fx:clampInt((clientX-rect.left)/w,0,1),fy:clampInt((clientY-rect.top)/h,0,1)};
}
// screen fraction in a plane's image -> voxel. The plane's own axis comes from its current slice (sliceIdx).
export function voxelFromPlanePoint(plane,fx,fy,dims,sliceIdx){
 const[w,h]=planeDims(plane,dims),col=clampInt(Math.floor(fx*w),0,w-1),row=clampInt(Math.floor(fy*h),0,h-1),own=Math.round(Number(sliceIdx))||0;
 if(plane==='axial')return{i:col,j:row,k:clampInt(own,0,dims.slices-1)};
 const k=dims.slices-1-row;
 if(plane==='coronal')return{i:col,j:clampInt(own,0,dims.rows-1),k};
 return{i:clampInt(own,0,dims.columns-1),j:col,k};
}
// voxel -> centre of its pixel in a plane's image as a fraction 0..1 (inverse of voxelFromPlanePoint)
export function planePointFromVoxel(plane,v,dims){
 const[w,h]=planeDims(plane,dims);
 if(plane==='axial')return{fx:(v.i+.5)/w,fy:(v.j+.5)/h};
 const fy=(dims.slices-1-v.k+.5)/h;
 return plane==='coronal'?{fx:(v.i+.5)/w,fy}:{fx:(v.j+.5)/w,fy};
}
// millimetres from the volume origin (voxel centre), for display only
export function voxelToMm(v,spacing){
 const[sx,sy,sz]=spacing||[1,1,1];
 return{x:v.i*sx,y:v.j*sy,z:v.k*sz};
}
// voxel -> the 3D scene's local coordinates (the same mapping the 3D MPR planes / section view use: centred on the volume, mm * 3.3/longest
// side, y flipped; sagittal index i -> x, coronal j -> y, axial k -> z), so a 3D marker sits exactly on its plane position
export function voxelToLocal3D(v,dims,spacing){
 const[sx,sy,sz]=spacing||[1,1,1],px=dims.columns*sx,py=dims.rows*sy,pz=dims.slices*sz,scale=3.3/Math.max(px,py,pz,1);
 return{x:((v.i+.5)*sx-px/2)*scale,y:-((v.j+.5)*sy-py/2)*scale,z:((v.k+.5)*sz-pz/2)*scale};
}
// calibrated HU of the ORIGINAL data at a voxel, or null when it cannot be read without decoding.
// Memory volumes: the array. Source-backed volumes are not in memory: read only a slice that is already in the slice cache
// (peekSlice(meta) must NOT decode); a miss is null, never 0.
export function sampleHu(vol,v,peekSlice){
 if(!vol||!v||!isDims(vol))return null;
 const{columns:w,rows:h,slices:d}=vol;
 if(!(v.i>=0&&v.i<w&&v.j>=0&&v.j<h&&v.k>=0&&v.k<d))return null;
 const arr=vol.data||vol.mprData;
 if(arr){const x=arr[(v.k*h+v.j)*w+v.i];return Number.isFinite(x)?x:null}
 if(vol.sourceBacked&&vol.series?.slices&&peekSlice){
  const meta=vol.series.slices[v.k],plane=meta?peekSlice(meta):null;
  if(plane){const x=plane[v.j*w+v.i];return Number.isFinite(x)?x:null}
 }
 return null;
}
export function formatHu(x){return x==null||!Number.isFinite(x)?'—':(Number.isInteger(x)?String(x):x.toFixed(1))}
export const formatMm=x=>(Math.round(x*100)/100).toFixed(2);
