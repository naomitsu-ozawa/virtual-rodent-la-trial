// The depth axis of the display's volume programs: a frame that draws two or more volumes (the body and a pair partner, the body and the parts taken out of it) draws them into the SAME low-resolution target with a depth buffer, nearest hit wins (the
// WebGL view does the same: the ray meshes of the volumes are drawn into one render target with a depth test, then each box composites it). The programs of those frames are the volume's own text with a wrapper: the volume's fragment entry is renamed
// fsMain and a new fs calls it and writes, besides the two colour outputs it has always written (unchanged), the depth buffer: frag_depth = the packed depth decoded as the composite decodes it, 1 where nothing was hit (colour alpha 0 after the 8-bit
// rounding of the target: the composite throws such a pixel away too), so a volume that hits nothing at a pixel never covers another one's hit. A frame with one volume keeps the programs it had: this text is another program of the same way, never
// a change of the volume's own text (the texts of docs/vr-wgsl-core.js, -feat.js, -general.js are untouched).
export const DEPTH_FORMAT = 'depth32float';
const FROM = '@fragment fn fs(in:VOut)->FOut{';
export function depthWgsl(text) {
  if (text.split(FROM).length !== 2) throw new Error('depth axis: the fragment entry was not found exactly once');
  return text.split(FROM).join('fn fsMain(in:VOut)->FOut{') + `
// the depth axis (docs/vr-wgsl-depth.js): the same outputs, plus the depth buffer
struct FOutZ{@location(0) color:vec4<f32>,@location(1) depth:vec4<f32>,@builtin(frag_depth) z:f32};
@fragment fn fs(in:VOut)->FOutZ{
 let fo=fsMain(in);
 var o:FOutZ;o.color=fo.color;o.depth=fo.depth;o.z=1.0;
 if(round(clamp(fo.color.a,0.0,1.0)*255.0)>0.0){o.z=(fo.depth.r*(255.0*65536.0)+fo.depth.g*(255.0*256.0)+fo.depth.b*255.0)/16777215.0;}
 return o;
}
`;
}
// the pipeline state the depth axis adds to a way's render pipeline (a pass with a depth attachment of this format)
export const depthState = () => ({ format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' });
