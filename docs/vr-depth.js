// VR depth occlusion. The volume's fragment shader (vr-view.js) writes the clip-space depth of the first thing a ray shows (a tissue surface, or the cut
// face of a section) to gl_FragDepth; the distance lines / leaders / labels (vr-measure.js) are then drawn with a real depth test (hidden parts clipped at the surface
// outline) plus a faint "ghost" pass (depthFunc GreaterDepth) so a hidden part stays findable. Pure helpers: no three.js, no DOM.

// setting 「ラベルの隠れ方」 (VR settings): 1 = 実際に隠す (GPU depth, default), 0 = 薄くする
export const LABEL_HIDE_REAL = 1, LABEL_HIDE_FADE = 0, LABEL_HIDE_DEFAULT = LABEL_HIDE_REAL;
// only an explicit 0 / '0' / false selects the fade; a missing or odd saved value falls back to the default
export const normalizeLabelHide = v => (v === 0 || v === '0' || v === false) ? LABEL_HIDE_FADE : LABEL_HIDE_DEFAULT;
// GPU occlusion needs the standard depth mapping of the shader (z/w * 0.5 + 0.5): a logarithmic or reversed depth buffer would need another formula, so those fall back to the fade
export const gpuOcclusionActive = (setting, caps) => normalizeLabelHide(setting) === LABEL_HIDE_REAL && !!caps && !caps.logarithmicDepthBuffer && !caps.reversedDepthBuffer;

export const GHOST_ALPHA = 0.15;
// which pass an object gets: true = depth tested + a ghost (GreaterDepth, GHOST_ALPHA) child; false = drawn on top without a depth test and without a ghost.
// occlusion = gpuOcclusionActive(); lit = the object is operable right now (laser on it, grabbed, selected, being moved) and must stay fully visible.
export const occludedPass = (occlusion, lit) => !!occlusion && !lit;
// how far behind the surface the volume's written depth lies (object space, along the unit ray direction): DEPTH_BIAS_RAY * (the voxel's extent along the ray) + DEPTH_BIAS_MIN * voxelMin.
// Points / lines are recorded at a voxel CENTRE on a surface voxel or a cut face (up to half a voxel inside along the ray, so 0.5 * dot(|dir|, voxelSize), which follows an
// anisotropic spacing such as 0.1 / 0.1 / 0.5), plus up to 1.5 voxels of the surface march (grazing rays). For isotropic data this is 2.0 .. 2.4 voxels (never less than the
// bias of 2). Must equal DEPTH_BIAS_RAY / DEPTH_BIAS_MIN and depthBias() in the fragment shader (tests/unit/vr-depth.test.js).
export const DEPTH_BIAS_RAY = 0.5, DEPTH_BIAS_MIN = 1.5;
// the same maths as the fragment shader: dir = the unit ray direction (object space), voxelSize = the object-space size of a voxel per axis [x, y, z], voxelMin = its smallest side of the classification grid
export function depthBias(dir, voxelSize, voxelMin) {
  return DEPTH_BIAS_RAY * (Math.abs(dir[0]) * voxelSize[0] + Math.abs(dir[1]) * voxelSize[1] + Math.abs(dir[2]) * voxelSize[2]) + DEPTH_BIAS_MIN * voxelMin;
}
// the per-axis voxel size the bias uses: the coarser of the rendered grid and the data grid (the points sit at the centres of the data's voxels)
export function depthVoxelSize(halfExt, gridDims, dataDims) {
  return [0, 1, 2].map(a => 2 * halfExt[a] / Math.max(1, Math.min(gridDims[a], dataDims ? dataDims[a] : gridDims[a])));
}
// the object-space ray parameter t (along the unit direction) is pushed back by the bias, the point goes through the model-view and
// projection matrices (column-major 16 arrays, as three.js stores them) and the window depth is z/w * 0.5 + 0.5, clamped to 0..1. null = behind the camera plane (the shader keeps the box face depth).
export const biasedT = (t, dir, voxelSize, voxelMin) => t + depthBias(dir, voxelSize, voxelMin);
export function clipDepth(modelView, projection, p) {
  const m = modelView, q = projection;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], w0 = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  const cz = q[2] * x + q[6] * y + q[10] * z + q[14] * w0, cw = q[3] * x + q[7] * y + q[11] * z + q[15] * w0;
  if (!(cw > 1e-6)) return null;
  return Math.min(1, Math.max(0, cz / cw * 0.5 + 0.5));
}
// the window depth of a point at eye-space depth zEye (negative in front of the camera) for a standard perspective camera (near / far)
export function perspectiveDepth(zEye, near, far) {
  const a = -(far + near) / (far - near), b = -2 * far * near / (far - near);
  return Math.min(1, Math.max(0, (a * zEye + b) / -zEye * 0.5 + 0.5));
}

// the menu / help boards are depth tested (the volume's depth hides a board that lies inside or behind the tissue), so a hit on a board that the tissue covers must not take the
// laser or the trigger (no invisible delete / exit button). Same idea as's section plane rule: the board hit is ignored when the volume surface along the ray is nearer.
// hit = the raycaster hit of one board ({distance}) or null; tissueDistance = the volume surface hit distance along the same ray (world metres; null / undefined = none). true = the board is visible there.
// (The rings are drawn without a depth test, so they are not subject to this rule.)
export const boardVisible = (hit, tissueDistance) => !!hit && !(tissueDistance != null && tissueDistance < hit.distance);
