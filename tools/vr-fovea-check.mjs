// VR offscreen-path check (build 560 guard). Renders the synthetic phantom with the REAL fragment and composite shaders of docs/vr-view.js on headless Chromium /
// SwiftShader through the low-resolution path three ways and compares them pixel by pixel (colour and the depth the composite writes back):
//  1) full-size target (B): the offscreen target allocated at the full size with only its corner used (the rest holds garbage) must give exactly the image of
//     the exactly-sized target the app used before (the invSize math and the cleared margin are right; changing f needs no reallocation).
//  2) offscreen foveation (D): inside the centre rect (minus the blend band) the image must equal the plain path at f; outside the rect it must equal the plain
//     path at f * k (the periphery scale); in the band every channel lies between the two (a blend, no garbage).
//   node tools/vr-fovea-check.mjs [--shader FILE]        PW_CHROMIUM=/opt/pw-browsers/chromium (optional)
import path from 'node:path';
import { ROOT, grabShaders, buildScene, withPage, runBatch, sceneArgs, HALF_EXT } from './lib/vr-gl-harness.mjs';

const argv = process.argv.slice(2), opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? path.resolve(argv[i + 1]) : d; };
const shaderFile = opt('--shader', path.join(ROOT, 'docs/vr-view.js'));
const N = 64, W = 160, H = 160, F = 0.7, K = 0.5, RECT = [44, 40, 116, 120], BAND = 8, EDGE = 2;
// colour tolerance: 1 / 255 per channel. The upscale samples the same texels at uv = fragCoord * f / (target size): a different target size gives a uv that differs in
// the last float bits, and SwiftShader's bilinear weights then round a few pixels the other way (measured: at most 1 LSB, a few dozen of 25 600 pixels). Depth is nearest: exact.
const TOL = 1;
const same4 = (P, Q, i) => Math.abs(P[i * 4] - Q[i * 4]) <= TOL && Math.abs(P[i * 4 + 1] - Q[i * 4 + 1]) <= TOL && Math.abs(P[i * 4 + 2] - Q[i * 4 + 2]) <= TOL && Math.abs(P[i * 4 + 3] - Q[i * 4 + 3]) <= TOL;
const allOpaque = [[300, 3000, 1, 1], [-200, 299, 1, 1], [-250, -50, 1, 1], [0, 0, 0, 0]];
const translucent = [[300, 3000, 1, 1], [-200, 299, 0.35, 1], [-250, -50, 0.5, 1], [0, 0, 0, 0]];
const SCENES = [
  { name: 'opaque', defines: ['VRL_NO_GENERAL', 'VRL_OPAQUE', 'VRL_NO_EVENTS'], u: { segA: allOpaque } },
  { name: 'translucent', defines: [], useClsRaw: true, u: { segA: translucent, distInCls: 0, useDist: 0 } },
];
const fov = { k: K, rect: RECT, band: BAND };
const cases = SCENES.flatMap(s => [
  { ...s, name: s.name + '-f', f: F }, { ...s, name: s.name + '-fk', f: F * K },
  { ...s, name: s.name + '-full', f: F, fullAlloc: true }, { ...s, name: s.name + '-fov', f: F, fov },
]);
const sh = grabShaders(shaderFile), scene = await buildScene(N);
const { col, dep, info } = await withPage(async (pg, info) => {
  const common = { sh, N, halfExt: HALF_EXT, scene: sceneArgs(scene), filter: 'linear', W, H, cases };
  const c = await runBatch(pg, { ...common, mode: 'color' }), d = await runBatch(pg, { ...common, mode: 'depth' });
  if (c.glError || d.glError || info.problems.length) throw new Error('GL error ' + [c.glError, d.glError] + ' ' + info.problems.join('; '));
  return { col: c.out, dep: Object.fromEntries(Object.entries(d.out).map(([k, v]) => [k, new Float32Array(new Uint8Array(v).buffer)])), info };
});
console.log('Chromium ' + info.version + ' · shader ' + path.relative(ROOT, shaderFile) + ' · ' + W + 'x' + H + ' · f ' + F + ' · periphery x' + K + ' · rect ' + RECT.join(',') + ' band ' + BAND);

let failed = false;
const fail = m => { failed = true; console.log('FAIL ' + m); };
// region of output pixel (x, y): 'in' = inside the rect beyond the band, 'out' = outside the rect (1 px margin), 'band' otherwise; the outer EDGE px of the image are skipped
// (there the bilinear upscale reads one texel past the used corner: the neighbouring eye's pixels in the app, as before this build)
const region = (x, y) => {
  const px = x + 0.5, py = y + 0.5, e = Math.min(px - RECT[0], RECT[2] - px, py - RECT[1], RECT[3] - py);
  if (x < EDGE || y < EDGE || x >= W - EDGE || y >= H - EDGE) return 'skip';
  return e >= BAND + 1 ? 'in' : e <= -1 ? 'out' : 'band';
};
for (const s of SCENES) {
  const n = s.name, A = col[n + '-f'], Ak = col[n + '-fk'], B = col[n + '-full'], C = col[n + '-fov'];
  const dA = dep[n + '-f'], dAk = dep[n + '-fk'], dB = dep[n + '-full'], dC = dep[n + '-fov'];
  // 1) full-size target == exactly-sized target
  let diff = 0, ddiff = 0, drawn = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (region(x, y) === 'skip') continue; const i = y * W + x;
    if (!same4(A, B, i)) diff++;
    if (dA[i] !== dB[i]) ddiff++; if (dA[i] < 1) drawn++;
  }
  if (drawn < 2000) fail(n + ': too few volume pixels (' + drawn + '): phantom / camera changed?');
  if (diff || ddiff) fail(n + ' full-size target: ' + diff + ' colour / ' + ddiff + ' depth pixels differ from the exactly-sized target');
  else console.log('ok   ' + n + ' full-size target (corner used, garbage elsewhere) = exactly-sized target: ' + drawn + ' volume pixels identical (colour within 1/255, depth exact)');
  // 2) foveation
  const cnt = { in: 0, out: 0, band: 0 }, bad = { in: 0, out: 0, band: 0, din: 0, dout: 0 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = region(x, y); if (r === 'skip') continue; const i = y * W + x; cnt[r]++;
    if (r === 'in') { if (!same4(C, A, i)) bad.in++; if (dC[i] !== dA[i]) bad.din++; }
    else if (r === 'out') { if (!same4(C, Ak, i)) bad.out++; if (dC[i] !== dAk[i]) bad.dout++; }
    else for (let k = 0; k < 4; k++) { const lo = Math.min(A[i * 4 + k], Ak[i * 4 + k]) - 2, hi = Math.max(A[i * 4 + k], Ak[i * 4 + k]) + 2; if (C[i * 4 + k] < lo || C[i * 4 + k] > hi) { bad.band++; break; } }
  }
  if (bad.in || bad.din) fail(n + ' foveation centre: ' + bad.in + ' colour / ' + bad.din + ' depth pixels differ from the plain path at f = ' + F);
  else console.log('ok   ' + n + ' foveation centre (' + cnt.in + ' px) = plain path at f ' + F + ' (colour within 1/255, depth exact)');
  if (bad.out || bad.dout) fail(n + ' foveation periphery: ' + bad.out + ' colour / ' + bad.dout + ' depth pixels differ from the plain path at f = ' + F * K);
  else console.log('ok   ' + n + ' foveation periphery (' + cnt.out + ' px) = plain path at f ' + (F * K).toFixed(2) + ' (colour within 1/255, depth exact)');
  if (bad.band) fail(n + ' foveation band: ' + bad.band + ' of ' + cnt.band + ' pixels outside the range of the two scales');
  else console.log('ok   ' + n + ' foveation band (' + cnt.band + ' px): every channel between the centre and periphery images');
}
console.log(failed ? 'vr-fovea-check FAILED' : 'vr-fovea-check OK');
process.exit(failed ? 1 : 0);
