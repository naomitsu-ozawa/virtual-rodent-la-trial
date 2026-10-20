// VR depth read-back check. The volume's fragment shader writes the clip depth of the first thing a ray shows (pushed back by
// depthBias()) to gl_FragDepth; the distance labels / lines are depth tested against it. This tool renders the synthetic phantom with the REAL fragment shader on headless Chromium /
// SwiftShader at f = 1 (volume pass straight into the depth buffer) and f < 1 (low-resolution target + the app's composite pass, which writes its nearest-sampled depth back), reads the
// depth buffer back and compares, for hit pixels and for miss pixels, with the expected depth: the hit point of the same camera ray (the shader patched at its first hit, as in
// tools/vr-cls-parity.mjs) pushed back by depthBias() of docs/vr-depth.js and projected with the camera matrices (clipDepth). The phantom's voxels are anisotropic on purpose (HALF_EXT).
//   node tools/vr-depth-check.mjs [--shader FILE]        PW_CHROMIUM=/opt/pw-browsers/chromium (optional)
import path from 'node:path'; import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { ROOT, grabShaders, buildScene, withPage, runBatch, sceneArgs, HALF_EXT } from './lib/vr-gl-harness.mjs';
const { clipDepth, depthBias } = await import(pathToFileURL(path.join(ROOT, 'docs/vr-depth.js')));

const argv = process.argv.slice(2), opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? path.resolve(argv[i + 1]) : d; };
const shaderFile = opt('--shader', path.join(ROOT, 'docs/vr-view.js'));
const N = 64, W = 160, H = 160, F_LOW = 0.5, TOL = 1e-6, MIN_GAIN = 1e-5, MIN_AGREE = 0.995;
const allOpaque = [[300, 3000, 1, 1], [-200, 299, 1, 1], [-250, -50, 1, 1], [0, 0, 0, 0]];
const base = { name: 'surface', defines: ['VRL_NO_GENERAL', 'VRL_OPAQUE', 'VRL_NO_EVENTS'], u: { segA: allOpaque } };
const voxelSize = HALF_EXT.map(h => 2 * h / N), voxelMin = Math.min(...voxelSize);
// the harness camera (tools/lib/vr-gl-harness.mjs): the volume sits at the origin, unit scale, so model-view = the camera's view matrix
const cam = new THREE.PerspectiveCamera(45, W / H, 0.01, 50); cam.position.set(2.0, 1.3, 2.5); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
const mv = cam.matrixWorldInverse.elements, proj = cam.projectionMatrix.elements;

const sh = grabShaders(shaderFile), scene = await buildScene(N);
const tw = Math.ceil(W * F_LOW), th = Math.ceil(H * F_LOW);
const { depth, hitFull, hitLow, info } = await withPage(async (pg, info) => {
  const sa = sceneArgs(scene), common = { sh, N, halfExt: HALF_EXT, scene: sa, filter: 'linear' };
  const d = await runBatch(pg, { ...common, W, H, mode: 'depth', cases: [{ ...base, name: 'f100', f: 1 }, { ...base, name: 'f50', f: F_LOW }] });
  const hf = await runBatch(pg, { ...common, W, H, mode: 'hit', cases: [base] });
  const hl = await runBatch(pg, { ...common, W: tw, H: th, mode: 'hit', cases: [base] });
  if (d.glError || hf.glError || hl.glError || info.problems.length) throw new Error('GL error ' + [d.glError, hf.glError, hl.glError] + ' ' + info.problems.join('; '));
  const f32 = b => new Float32Array(new Uint8Array(b).buffer);
  return { depth: { f100: f32(d.out.f100), f50: f32(d.out.f50) }, hitFull: { hit: f32(hf.out.surface), rays: hf.raysBuf }, hitLow: { hit: f32(hl.out.surface), rays: hl.raysBuf }, info };
});
console.log('Chromium ' + info.version + ' · shader ' + path.relative(ROOT, shaderFile) + ' · ' + W + 'x' + H + ' · tolerance ' + TOL);

let failed = false;
const fail = m => { failed = true; console.log('FAIL ' + m); };
// the expected depth of full-resolution pixel (x, y): the hit of the pixel itself (f = 1) or of the low-resolution texel the composite pass samples (f < 1: uv = (x + 0.5) / W, nearest)
const expected = (job, x, y) => {
  const lo = job === 'f50', hit = lo ? hitLow : hitFull, w = lo ? tw : W, px = lo ? Math.min(tw - 1, Math.floor((x + 0.5) * F_LOW)) : x, py = lo ? Math.min(th - 1, Math.floor((y + 0.5) * F_LOW)) : y, i = py * w + px;
  if (hit.hit[i * 4 + 3] < 0.5) return { hit: false, biased: 1, plain: 1 };
  const p = [hit.hit[i * 4], hit.hit[i * 4 + 1], hit.hit[i * 4 + 2]], d = [hit.rays[i * 3], hit.rays[i * 3 + 1], hit.rays[i * 3 + 2]], b = depthBias(d, voxelSize, voxelMin);
  return { hit: true, biased: clipDepth(mv, proj, p.map((v, k) => v + d[k] * b)), plain: clipDepth(mv, proj, p), bias: b };
};
for (const job of ['f100', 'f50']) {
  const dz = depth[job], at = (x, y) => dz[y * W + x], label = (job === 'f100' ? 'f = 1' : 'f = ' + F_LOW) + ' ';
  // 1) the centre pixel: a hit
  const c = expected(job, W / 2, H / 2), dc = at(W / 2, H / 2);
  if (!c.hit) fail(label + 'centre pixel is not a hit (phantom / camera changed?)');
  else {
    const err = Math.abs(dc - c.biased), gain = dc - c.plain;
    console.log((err <= TOL && gain > MIN_GAIN ? 'ok   ' : 'FAIL ') + label + 'centre: depth ' + dc.toFixed(7) + ' expected ' + c.biased.toFixed(7) + ' (error ' + err.toExponential(1) + '), behind the unbiased surface by ' + gain.toExponential(2) + ', bias ' + (c.bias / voxelMin).toFixed(2) + ' voxelMin');
    if (!(err <= TOL)) failed = true; if (!(gain > MIN_GAIN)) failed = true;
  }
  // 2) a miss pixel (corner): nothing drawn, the depth buffer keeps its clear value 1
  const dm = at(0, 0); console.log((dm === 1 ? 'ok   ' : 'FAIL ') + label + 'miss corner: depth ' + dm); if (dm !== 1) failed = true;
  // 3) the silhouette edge of the middle row: the first / last hit pixel and the miss pixel next to it
  const row = H / 2; let first = -1, last = -1;
  for (let x = 0; x < W; x++) if (expected(job, x, row).hit) { if (first < 0) first = x; last = x; }
  for (const [name, x, out] of [['left edge', first, first - 1], ['right edge', last, last + 1]]) {
    const e = expected(job, x, row), err = Math.abs(at(x, row) - e.biased), o = expected(job, out, row), eo = Math.abs(at(out, row) - o.biased);
    const okE = err <= TOL && eo <= TOL; console.log((okE ? 'ok   ' : 'FAIL ') + label + name + ': hit pixel x=' + x + ' error ' + err.toExponential(1) + ', next pixel x=' + out + (o.hit ? ' (a hit too at this f)' : ' (miss, depth ' + at(out, row) + ')') + ' error ' + eo.toExponential(1)); if (!okE) failed = true;
  }
  // 4) every pixel
  let ok = 0, hits = 0, worst = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const e = expected(job, x, y), err = Math.abs(at(x, y) - e.biased); if (e.hit) hits++; worst = Math.max(worst, err); if (err <= TOL) ok++; }
  const agree = ok / (W * H); console.log((agree >= MIN_AGREE && hits > W * H * 0.05 ? 'ok   ' : 'FAIL ') + label + 'all pixels: ' + (agree * 100).toFixed(2) + ' % within tolerance (hit pixels ' + hits + ', worst error ' + worst.toExponential(1) + ')'); if (!(agree >= MIN_AGREE && hits > W * H * 0.05)) failed = true;
}
// 5) "no ghost": the distance points are recorded at the CENTRE of a surface voxel (vr-point.js voxelToLocal), up to half a voxel inside the surface along the ray. With an anisotropic
// spacing (here 5 : 1, like 0.1 / 0.1 / 0.5 mm) that centre can lie far behind the surface, and a line between two surface points would be depth tested against the written depth and drawn
// as a ghost. For every hit pixel the centre of the voxel that contains the hit point must lie IN FRONT of (or on) the written depth. The old bias (2 * voxelMin) must fail on the anisotropic
// case (the test has teeth) while the current one passes there and on the isotropic phantom.
// the same holds for the point MARKERS (sphere + number chip drawn at the recorded voxel centre, depth tested + ghost) and for a point recorded on the CUT FACE of a section: the
// centre of the voxel that contains the first hit (the surface, or the cut face with the capped section) must not lie behind the written depth, otherwise the marker would be ghosted.
const cutPl = (() => { const n = [0.6, 0.3, 0.74], l = Math.hypot(...n); return [-n[0] / l, -n[1] / l, -n[2] / l, 0.05]; })(); // the half towards the camera is removed (as tools/vr-render-golden.mjs combined-section)
const cutBase = { name: 'surface', defines: ['VRL_NO_GENERAL', 'VRL_OPAQUE'], u: { segA: allOpaque, cutPlanes: [cutPl, [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]], planeCount: 1, planeCut: 1, capOn: 1, sliceOpacity: 0.7 } };
for (const [name, he, bs] of [['isotropic voxels', [1.3, 1.3, 1.3], base], ['anisotropic 5:1 (z)', [0.3, 0.3, 1.5], base], ['isotropic voxels, section cut face', [1.3, 1.3, 1.3], cutBase], ['anisotropic 5:1 (z), section cut face', [0.3, 0.3, 1.5], cutBase]]) {
  const r = await withPage(async (pg, info) => {
    const common = { sh, N, halfExt: he, scene: sceneArgs(scene), filter: 'linear', W, H };
    const d = await runBatch(pg, { ...common, mode: 'depth', cases: [{ ...bs, name: 'f100', f: 1 }] }), h = await runBatch(pg, { ...common, mode: 'hit', cases: [bs] });
    if (d.glError || h.glError || info.problems.length) throw new Error('GL error ' + [d.glError, h.glError] + ' ' + info.problems.join('; '));
    const f32 = b => new Float32Array(new Uint8Array(b).buffer); return { z: f32(d.out.f100), hit: f32(h.out.surface), rays: h.raysBuf };
  });
  const vs = he.map(v => 2 * v / N), vm = Math.min(...vs); let hits = 0, behindNew = 0, behindOld = 0, worstNew = 0, worstOld = 0;
  for (let i = 0; i < W * H; i++) {
    if (r.hit[i * 4 + 3] < 0.5) continue; hits++;
    const d = [r.rays[i * 3], r.rays[i * 3 + 1], r.rays[i * 3 + 2]], p = [r.hit[i * 4] + d[0] * 1e-3 * vm, r.hit[i * 4 + 1] + d[1] * 1e-3 * vm, r.hit[i * 4 + 2] + d[2] * 1e-3 * vm];
    const vi = Math.min(N - 1, Math.max(0, Math.floor((p[0] / (2 * he[0]) + 0.5) * N))), vj = Math.min(N - 1, Math.max(0, Math.floor((0.5 - p[1] / (2 * he[1])) * N))), vk = Math.min(N - 1, Math.max(0, Math.floor((p[2] / (2 * he[2]) + 0.5) * N)));
    const c = [((vi + 0.5) / N - 0.5) * 2 * he[0], (0.5 - (vj + 0.5) / N) * 2 * he[1], ((vk + 0.5) / N - 0.5) * 2 * he[2]];
    const dc = clipDepth(mv, proj, c), written = r.z[i], hp = [r.hit[i * 4], r.hit[i * 4 + 1], r.hit[i * 4 + 2]];
    // the unbiased surface depth is what the old bias is added to; the old depth = the hit point pushed back by 2 * voxelMin
    const old = clipDepth(mv, proj, hp.map((v, k) => v + d[k] * 2 * vm));
    if (dc > written + 1e-7) { behindNew++; worstNew = Math.max(worstNew, dc - written); }
    if (dc > old + 1e-7) { behindOld++; worstOld = Math.max(worstOld, dc - old); }
  }
  const okNew = behindNew === 0 && hits > W * H * 0.03, teeth = name.startsWith('iso') || behindOld > 0;
  console.log((okNew && teeth ? 'ok   ' : 'FAIL ') + 'no ghost, ' + name + ': hit pixels ' + hits + ', voxel centres behind the written depth: ' + behindNew + ', ' + behindOld + ' (bias 2 * voxelMin, worst ' + worstOld.toExponential(1) + ')' + (teeth ? '' : ' <- the old bias should fail here'));
  if (!(okNew && teeth)) failed = true;
}
{
  const n0 = [0.6, 0.3, 0.74], l0 = Math.hypot(...n0), nh = n0.map(v => v / l0), p0 = nh.map(v => -0.05 * v); // the plane point (-nh . x = 0.05), nh points at the camera
  const dirs = { removedSide: nh, keptSide: nh.map(v => -v) }; // removedSide: the arrow points at the camera (it lies in the removed half = the half towards the camera)
  const planes = { removedSide: [-nh[0], -nh[1], -nh[2], 0.05], keptSide: [nh[0], nh[1], nh[2], -0.05] }; // the plane vector (unit n, offset); the removed half = the side of -n
  const up = Math.abs(nh[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); }, u1 = nrm(cr(nh, up)), u2 = nrm(cr(nh, u1)), L = 0.5;
  const arrowPts = d => { const tip = p0.map((v, i) => v + d[i] * L), back = (u, s) => tip.map((v, i) => v - d[i] * 0.28 * L + u[i] * s * 0.22 * L); return [p0, tip, tip, back(u1, 1), tip, back(u1, -1), tip, back(u2, 1), tip, back(u2, -1)]; };
  const countGreen = px => { let c = 0; for (let i = 0; i < px.length; i += 4) if (px[i + 1] >= 200 && px[i] <= 60 && px[i + 2] <= 60) c++; return c; };
  const res = {};
  await withPage(async (pg, info) => {
    const common = { sh, N, halfExt: HALF_EXT, scene: sceneArgs(scene), filter: 'linear', W, H, mode: 'color' };
    for (const side of ['removedSide', 'keptSide']) for (const dt of [true, false]) {
      const c = { name: 'surface', defines: ['VRL_NO_GENERAL', 'VRL_OPAQUE'], u: { segA: allOpaque, cutPlanes: [planes[side], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]], planeCount: 1, planeCut: 1, capOn: 1, sliceOpacity: 0.7 }, arrow: { pts: arrowPts(dirs[side]), depthTest: dt } };
      const r = await runBatch(pg, { ...common, cases: [c] }); if (r.glError || info.problems.length) throw new Error('GL error ' + r.glError + ' ' + info.problems.join('; '));
      res[side + (dt ? ' depth test' : ' no depth test')] = countGreen(new Uint8Array(r.out.surface));
    }
  });
  console.log('arrow pixels (green): ' + Object.keys(res).map(k => k + ' ' + res[k] + ' px').join(', '));
  const okLit = res['keptSide no depth test'] > 20 && res['removedSide no depth test'] > 20;
  console.log((okLit ? 'ok   ' : 'FAIL ') + 'lit / grabbed section arrow (no depth test, as drawn) is visible from both sides: removed side ' + res['removedSide no depth test'] + ' px, kept side ' + res['keptSide no depth test'] + ' px');
  if (!okLit) failed = true;
  const okTeeth = res['keptSide depth test'] === 0 && res['removedSide depth test'] > 20;
  console.log((okTeeth ? 'ok   ' : 'FAIL ') + 'a depth-tested arrow (the 509 state) would be hidden behind the kept tissue (' + res['keptSide depth test'] + ' px) but not over the cut face (' + res['removedSide depth test'] + ' px): why the unlit arrow is not drawn instead');
  if (!okTeeth) failed = true;
}
if (failed) { console.error('vr-depth-check FAILED'); process.exit(1); }
console.log('vr-depth-check OK');
