// CPU / GPU parity of the VR classification path (build 484 guard). The VR laser, the 3D position-comment markers and the point-hidden test pick on the
// CPU (docs/vr-pick.js marchClassificationHitInfo over docs/point-cls.js buildClsData bytes); the picture is drawn by the GLSL march of docs/vr-view.js.
// This tool renders a small synthetic volume (32^3, gentle HU ramps) with the REAL fragment shader patched only at its first-hit point (the shader writes
// hit position and segment instead of colour; everything before it, the march, the distance-field jumps, the surface search, the plane clip, is unchanged),
// and compares for every pixel's camera ray the GPU first-hit segment and voxel with marchClassificationHitInfo.
// Two texture filters: 'linear' (what the app uses; surface = trilinear 0.5 isosurface, differs from the CPU's nearest-voxel byte >= 128 by up to about one voxel)
// and 'nearest' (the GPU classifies exactly the bytes the CPU reads, so segment and voxel must agree almost everywhere: this isolates the 0.5 vs 128 rule).
//   node tools/vr-cls-parity.mjs [--shader FILE] [--pick FILE]     (scratch copies of vr-view.js / vr-pick.js, to show that the test fails)
// The bytes come from the real buildClsData for BOTH sides (so a drift inside buildClsData is not seen here: tests/unit/cls-parity.test.js checks it against the HU truth).
//   PW_CHROMIUM=/opt/pw-browsers/chromium (optional)
import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { ROOT, grabShaders, buildScene, withPage, runBatch, sceneArgs, HALF_EXT } from './lib/vr-gl-harness.mjs';

const argv = process.argv.slice(2), opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? path.resolve(argv[i + 1]) : d; };
const shaderFile = opt('--shader', path.join(ROOT, 'docs/vr-view.js')), pickFile = opt('--pick', path.join(ROOT, 'docs/vr-pick.js'));
const { marchClassificationHitInfo } = await import(pathToFileURL(pickFile));
const N = 32, W = 96, H = 96, voxelMin = Math.min(...HALF_EXT.map(h => 2 * h / N));
// Declared tolerances: the measured values (Chromium 141 SwiftShader, this phantom) with a margin, see tests/golden/README.md. Distances are in voxels (smallest voxel side, along the ray).
// Why not 100 %: the CPU marches nearest-voxel at half-voxel steps, the shader samples at 0.85 of the smallest voxel with distance-field jumps (and, with the app's linear filter, a
// trilinear isosurface), so one-voxel-thin structures and silhouettes are seen by one side only. A threshold drift (128 -> 96 or 160) moves the numbers far outside these bounds.
const TOL = {
  linear: { agree: 0.88, segment: 0.90, dtP95: 1.9, dtP99: 3.2, cheb1: 0.96, exact: 0 },
  nearest: { agree: 0.97, segment: 0.955, dtP95: 0.8, dtP99: 2.5, cheb1: 0.985, exact: 0.75 },
};
const scene = await buildScene(N, { complex: false }), scene4 = await buildScene(N, { complex: false, four: true }); // build 528: four enabled segments
const sh = grabShaders(shaderFile);
const plane = (() => { const n = [0.6, 0.3, 0.74], l = Math.hypot(...n); return { x: n[0] / l, y: n[1] / l, z: n[2] / l, w: 0.05 }; })(); // kept side: n.p - w >= 0
const none = [0, 0, 1, 0], allOpaque = [[300, 3000, 1, 1], [-200, 299, 1, 1], [-250, -50, 1, 1], [0, 0, 0, 0]];
const noFat = [[300, 3000, 1, 1], [-200, 299, 1, 1], [-250, -50, 1, 0], [0, 0, 0, 0]];
const allOpaque4 = [[300, 3000, 1, 1], [-200, 299, 1, 1], [-250, -50, 1, 1], [-800, -300, 1, 1]];
// build 528: four stored segments: the VRL_CLS4 tight loop (the fourth segment's bytes from the second texture) against the CPU march over the same
// four-channel bytes (the general loop those data used to take cannot be patched at its hit by this harness; its picture is in the render goldens)
// Their own linear tolerance for the distances: the fourth segment is a 3-voxel ball with a 213 HU-per-voxel ramp in a phantom without the skin ramp (hard air / soft step),
// so the trilinear 0.5 surface and the CPU's nearest voxel differ by up to about a voxel more than on the bone ramps (measured p95 2.2, p99 4.0, within 1: 93.4 %);
// the nearest run (the bytes themselves) keeps the standard bounds
const TOL4 = { linear: { dtP95: 2.6, dtP99: 4.6, cheb1: 0.92 } };
const CASES4 = [
  { name: '4seg-tight-cls4', tol: TOL4, defines: ['VRL_NO_GENERAL', 'VRL_NO_EVENTS', 'VRL_OPAQUE', 'VRL_CLS4'], u: { segA: allOpaque4 }, shown: [0, 1, 2, 3], planes: [], cut: 0 },
  { name: '4seg-full4', tol: TOL4, defines: ['VRL_CLS4'], u: { segA: allOpaque4 }, shown: [0, 1, 2, 3], planes: [], cut: 0 }, // build 529: the full4 variant (its runtime tight branch, as screenshots take it)
  { name: '4seg-tight-plane', tol: TOL4, defines: ['VRL_NO_GENERAL', 'VRL_OPAQUE', 'VRL_CLS4'], u: { segA: allOpaque4, cutPlanes: [[plane.x, plane.y, plane.z, plane.w], none, none, none], planeCount: 1, planeCut: 1, capOn: 0, sliceOpacity: 0 }, shown: [0, 1, 2, 3], planes: [plane], cut: 1 },
];
const CASES = [
  { name: 'all-segments', defines: ['VRL_NO_GENERAL', 'VRL_NO_EVENTS', 'VRL_OPAQUE'], u: { segA: allOpaque }, shown: [0, 1, 2], planes: [], cut: 0 },
  { name: 'fat-hidden', defines: ['VRL_NO_GENERAL', 'VRL_NO_EVENTS', 'VRL_OPAQUE'], u: { segA: noFat }, shown: [0, 1], planes: [], cut: 0 },
  { name: 'clip-plane', defines: ['VRL_NO_GENERAL', 'VRL_OPAQUE'], u: { segA: allOpaque, cutPlanes: [[plane.x, plane.y, plane.z, plane.w], none, none, none], planeCount: 1, planeCut: 1, capOn: 0, sliceOpacity: 0 }, shown: [0, 1, 2], planes: [plane], cut: 1 },
];
const results = [];
await withPage(async (pg, info) => {
  for (const filter of ['linear', 'nearest']) {
    const r = await runBatch(pg, { sh, N, W, H, halfExt: HALF_EXT, scene: sceneArgs(scene), cases: CASES.map(c => ({ ...c, name: c.name })), mode: 'hit', filter });
    if (r.glError || info.problems.length) throw new Error('GL error ' + r.glError + ' ' + info.problems.join('; '));
    for (const c of CASES) results.push({ filter, c, scene, hit: new Float32Array(new Uint8Array(r.out[c.name]).buffer), rays: r.raysBuf, cam: r.cam });
    const r4 = await runBatch(pg, { sh, N, W, H, halfExt: HALF_EXT, scene: sceneArgs(scene4), cases: CASES4.map(c => ({ ...c, name: c.name })), mode: 'hit', filter });
    if (r4.glError || info.problems.length) throw new Error('GL error ' + r4.glError + ' ' + info.problems.join('; '));
    for (const c of CASES4) results.push({ filter, c, scene: scene4, hit: new Float32Array(new Uint8Array(r4.out[c.name]).buffer), rays: r4.raysBuf, cam: r4.cam });
  }
  console.log('Chromium ' + info.version);
});
const [hx, hy, hz] = HALF_EXT, voxelOf = p => [Math.min(N - 1, Math.max(0, Math.floor((p[0] / (2 * hx) + 0.5) * N))), Math.min(N - 1, Math.max(0, Math.floor((0.5 - p[1] / (2 * hy)) * N))), Math.min(N - 1, Math.max(0, Math.floor((p[2] / (2 * hz) + 0.5) * N)))];
let failed = false;
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : 0;
for (const { filter, c, scene, hit, rays, cam } of results) {
  let both = 0, gpuOnly = 0, cpuOnly = 0, none_ = 0, segOk = 0, exact = 0, cheb1 = 0; const dts = [];
  const o = { x: cam[0], y: cam[1], z: cam[2] };
  for (let i = 0; i < W * H; i++) {
    const idx = hit[i * 4 + 3], q = { x: rays[i * 3], y: rays[i * 3 + 1], z: rays[i * 3 + 2] };
    const cpu = marchClassificationHitInfo(o, q, HALF_EXT, [N, N, N], scene.cls, c.shown.map(s => scene.cls.chan[s]), c.planes, c.planes.length, c.cut);
    const gpu = idx >= 0.5 ? { s: Math.round(idx) - 1, p: [hit[i * 4], hit[i * 4 + 1], hit[i * 4 + 2]] } : null;
    if (!gpu && !cpu) { none_++; continue; } if (!gpu) { cpuOnly++; continue; } if (!cpu) { gpuOnly++; continue; }
    both++; const cs = scene.cls.chan.indexOf(cpu.ch); if (cs === gpu.s) segOk++;
    const gv = voxelOf(gpu.p), cd = Math.max(Math.abs(gv[0] - cpu.x), Math.abs(gv[1] - cpu.y), Math.abs(gv[2] - cpu.z));
    if (cd === 0) exact++; if (cd <= 1) cheb1++;
    dts.push(Math.abs(Math.hypot(gpu.p[0] - o.x, gpu.p[1] - o.y, gpu.p[2] - o.z) - cpu.t) / voxelMin);
  }
  const rayCount = both + gpuOnly + cpuOnly, T = { ...TOL[filter], ...(c.tol?.[filter] || {}) }, agree = both / Math.max(1, rayCount);
  const m = { agree, segment: segOk / Math.max(1, both), dtP95: pct(dts, 0.95), dtP99: pct(dts, 0.99), dtMax: Math.max(0, ...dts), cheb1: cheb1 / Math.max(1, both), exact: exact / Math.max(1, both) };
  const bad = [agree < T.agree && 'hit/miss agreement', m.segment < T.segment && 'segment', m.dtP95 > T.dtP95 && 'distance p95', m.dtP99 > T.dtP99 && 'distance p99', m.cheb1 < T.cheb1 && 'voxel within 1', m.exact < T.exact && 'exact voxel', both < 300 && 'too few hits'].filter(Boolean);
  console.log((bad.length ? 'FAIL ' : 'ok   ') + filter.padEnd(8) + c.name.padEnd(14) + 'rays hit by both ' + both + ', gpu only ' + gpuOnly + ', cpu only ' + cpuOnly + ', neither ' + none_ + ' · agree ' + (100 * agree).toFixed(1) + '% · segment ' + (100 * m.segment).toFixed(1) + '% · voxel exact ' + (100 * m.exact).toFixed(1) + '% within 1 ' + (100 * m.cheb1).toFixed(1) + '% · |dt| p95 ' + m.dtP95.toFixed(2) + ' p99 ' + m.dtP99.toFixed(2) + ' max ' + m.dtMax.toFixed(2) + ' voxels' + (bad.length ? '  <- ' + bad.join(', ') : ''));
  if (bad.length) failed = true;
}
if (failed) { console.error('vr-cls-parity FAILED: the GLSL classification march and vr-pick.js / point-cls.js no longer agree (see tests/golden/README.md)'); process.exit(1); }
console.log('vr-cls-parity OK');
