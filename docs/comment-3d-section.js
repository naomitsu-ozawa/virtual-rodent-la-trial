// Position cues of the 3D position-comment markers relative to the ACTIVE section (the PC section view's plane), the same as VR (
// vr-point-markers.js): a point ON the plane is drawn bigger (SECTION_EMPHASIS, x1.4 in VR), a point off it gets a thin line down to its foot
// on the plane; no active section = neither. Pure (no three.js, no DOM). The rule is VR's vr-point.js sectionRelation (on the section = the
// plane passes through the point's voxel: distance <= half the voxel's thickness along the normal), reused here, not copied.
import { sectionRelation } from './vr-point.js?v=20261028-build687';

export const SECTION_EMPHASIS=1.4;

// object-space half extents of the 3D view's volume box (voxelToLocal3D: the longest side is 3.3 units, centred); spacing [sx,sy,sz]
export function boxHalfExtent(dims,spacing){
 const[sx,sy,sz]=spacing||[1,1,1],px=dims.columns*sx,py=dims.rows*sy,pz=dims.slices*sz,k=3.3/Math.max(px,py,pz,1);
 return[px*k/2,py*k/2,pz*k/2];
}

// -> Map id -> {on: boolean, foot: {x,y,z}}; empty without a plane (no emphasis, no lines).
// pts: [{id,local}] object space; plane: {x,y,z,w} (unit normal, comment-3d-hidden.js sectionPlaneLocal); dims {columns,rows,slices}
export function planeRelations(pts,plane,halfExt,dims){
 const out=new Map();
 if(!plane||!pts?.length||!halfExt||!dims)return out;
 for(const p of pts){const r=sectionRelation(p.local,plane,halfExt,dims);out.set(p.id,{on:r.onSection,foot:r.foot})}
 return out;
}

// Clip the segment a-b (camera space, the camera looks down -z, so a point is in front when z <= -near) to the part in front of the near
// plane: -> [a',b'] or null when the whole segment is behind (nothing to draw; projecting a point behind the camera would give garbage).
export function clipSegmentNear(a,b,near=0.01){
 const za=a.z+near,zb=b.z+near; // in front when <= 0
 if(za>0&&zb>0)return null;
 if(za<=0&&zb<=0)return[a,b];
 const t=za/(za-zb),m={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:-near};
 return za>0?[m,b]:[a,m];
}
