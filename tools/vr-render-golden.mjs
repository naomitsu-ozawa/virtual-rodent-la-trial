// VR render golden check. Renders a small deterministic synthetic scene (bone ball / plate / rod, soft tissue, complex
// high-opacity fat: thin sheets with holes and single-voxel specks) with the REAL fragment shader of docs/vr-view.js on headless Chromium /
// SwiftShader, in the shader variants the app uses, at 100 % and through the low-resolution path (f < 1: offscreen target + composite pass),
// and compares every image with the committed golden PNG in tests/golden/vr-render/.
//   node tools/vr-render-golden.mjs                       compare (exit 1 above the threshold)
//   node tools/vr-render-golden.mjs --update              regenerate the goldens (review the PNGs, commit them)
//   options: --max-pixels N  --max-diff N   threshold (default 0 / 0: pixel-identical); env GOLDEN_MAX_PIXELS / GOLDEN_MAX_DIFF
//            --shader FILE  render another copy of vr-view.js (e.g. a perturbed scratch copy)    --runs K  render K times, report run-to-run variance
//            --out DIR  where actual / diff PNGs go on failure (default test-results/vr-golden)
//   PW_CHROMIUM=/opt/pw-browsers/chromium (optional: Playwright's own Chromium otherwise)
import fs from 'node:fs'; import path from 'node:path';
import { ROOT, grabShaders, buildScene, withPage, runBatch, sceneArgs, HALF_EXT, encodePng, decodePng, diffPixels } from './lib/vr-gl-harness.mjs';
import { contentBox } from '../docs/vr-content-box.js';

const argv = process.argv.slice(2), has = f => argv.includes(f), opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const update = has('--update'), maxPixels = +opt('--max-pixels', process.env.GOLDEN_MAX_PIXELS ?? 0), maxDiff = +opt('--max-diff', process.env.GOLDEN_MAX_DIFF ?? 0), runs = +opt('--runs', 1);
const shaderFile = opt('--shader', path.join(ROOT, 'docs/vr-view.js')), outDir = path.resolve(opt('--out', 'test-results/vr-golden')), goldenDir = path.join(ROOT, 'tests/golden/vr-render');
const N = 64, W = 160, H = 160, F_LOW = 0.7;
const OPQ = ['VRL_NO_GENERAL', 'VRL_OPAQUE'], plane = [0.6, 0.3, 0.74], pl = (() => { const l = Math.hypot(...plane); return plane.map(v => v / l); })();
const allOpaque = [[300, 3000, 1, 1], [-200, 299, 1, 1], [-250, -50, 1, 1], [0, 0, 0, 0]];
const zero = [0, 0, 1, 0];
// the variants vr-view.js actually uses: noEvents (no plane) and combined (events: plane / slice / cap) with VRL_OPAQUE, the general loop (full, diag / no combined field),
// the HU path, and the analysis-result colours (VRL_REGIONS)
const noSoft = [[300, 3000, 1, 1], [-200, 299, 1, 0], [-250, -50, 1, 1], [0, 0, 0, 0]]; // soft tissue off: bone and (complex) fat show
const translucent = [[300, 3000, 1, 1], [-200, 299, 0.35, 1], [-250, -50, 0.5, 1], [0, 0, 0, 0]]; // the app's soft-tissue default 0.35; fat 0.5 so that rays pile up opacity through many sheets (ACC_STOP matters)
const cut = [[-pl[0], -pl[1], -pl[2], 0.05], zero, zero, zero]; // the half towards the camera is removed
const boneOnly = [[300, 3000, 1, 1], [-200, 299, 1, 0], [-250, -50, 1, 0], [0, 0, 0, 0]]; // only the (mask-only) bone is shown, so empty bricks exist to skip
const CASES = [
  { name: 'noevents-bonefat', defines: [...OPQ, 'VRL_NO_EVENTS'], u: { segA: noSoft } },
  { name: 'noevents-allopaque', defines: [...OPQ, 'VRL_NO_EVENTS'], u: { segA: allOpaque } },
  { name: 'combined-section', defines: OPQ, u: { segA: allOpaque, cutPlanes: cut, planeCount: 1, planeCut: 1, capOn: 1, sliceOpacity: 0.7 } },
  { name: 'combined-section-bonefat', defines: OPQ, u: { segA: noSoft, cutPlanes: cut, planeCount: 1, planeCut: 1, capOn: 1, sliceOpacity: 0.7 } },
  { name: 'combined-two-planes', defines: OPQ, u: { segA: allOpaque, cutPlanes: [cut[0], [0, -1, 0, 0.1], zero, zero], planeCount: 2, planeCut: 1, capOn: 1, sliceOpacity: 0.7 } },
  { name: 'full-cls-translucent', defines: [], useClsRaw: true, u: { segA: translucent, distInCls: 0, useDist: 0 } },
  { name: 'full-hu', defines: [], noCls: true, u: { segA: translucent } },
  { name: 'noevents-regions', defines: [...OPQ, 'VRL_NO_EVENTS', 'VRL_REGIONS'], u: { segA: noSoft } },
  { name: 'full-hu-maskonly', defines: [], noCls: true, maskOnly: true, u: { segA: boneOnly } }, // HU path with a mask-only bone (the scene's edit mask), brick occupancy in use
  // the viewer rolled by 180 degrees about its view axis = the volume turned upside down. The light is a headlight
  // above the VIEWER, so these two must look like the unrolled cases turned by 180 degrees (shadows on the same sides of the shapes), never lit from below
  { name: 'noevents-bonefat-rolled', defines: [...OPQ, 'VRL_NO_EVENTS'], camUp: [0, -1, 0], u: { segA: noSoft } },
  { name: 'combined-section-rolled', defines: OPQ, camUp: [0, -1, 0], u: { segA: allOpaque, cutPlanes: cut, planeCount: 1, planeCut: 1, capOn: 1, sliceOpacity: 0.7 } },
];
// four enabled segments (chan 0..3) on their own phantom (a -600 HU ball in the soft tissue as the fourth segment): the VRL_CLS4 variants the app uses
// then (the fourth segment's bytes in a second R8 texture) and, for reference, the general loop with the separate field those data used to run on
const allOpaque4 = [[300, 3000, 1, 1], [-200, 299, 1, 1], [-250, -50, 1, 1], [-800, -300, 1, 1]], noSoft4 = [[300, 3000, 1, 1], [-200, 299, 1, 0], [-250, -50, 1, 1], [-800, -300, 1, 1]];
const CASES4 = [
  { name: '4seg-noevents', defines: [...OPQ, 'VRL_NO_EVENTS', 'VRL_CLS4'], u: { segA: allOpaque4 } },
  { name: '4seg-noevents-nosoft', defines: [...OPQ, 'VRL_NO_EVENTS', 'VRL_CLS4'], u: { segA: noSoft4 } },
  { name: '4seg-combined-section', defines: [...OPQ, 'VRL_CLS4'], u: { segA: allOpaque4, cutPlanes: cut, planeCount: 1, planeCut: 1, capOn: 1, sliceOpacity: 0.7 } },
  { name: '4seg-full-general', defines: [], useClsRaw: true, useDistTex: true, u: { segA: allOpaque4 } },
  { name: '4seg-full4', defines: ['VRL_CLS4'], u: { segA: allOpaque4 } }, // the full4 variant (screenshots, diag modes): its runtime tight branch
  { name: '4seg-full4-noskip', defines: ['VRL_CLS4'], u: { segA: allOpaque4, diag: 4 } }, // and its general loop (診断 スキップなし) reading the fourth segment from cls4Tex
];
// the same scene with the pre-526 bricks (every brick a candidate of the mask-only segment = no empty-space skip) and the diag 5 probe
// (R = samples / 1024): the occupancy must skip (fewer samples) without losing a mask voxel (the drawn silhouette is the same; the skip re-phases
// the samples, so single pixels inside the silhouette may differ by dither)
const moCase = CASES.find(c => c.name === 'full-hu-maskonly'), PROOF = [
  { ...moCase, name: 'proof-occ', f: 1 }, { ...moCase, name: 'proof-mixed', f: 1, bricksMixed: true },
  { ...moCase, name: 'proof-occ-probe', f: 1, u: { ...moCase.u, diag: 5 } }, { ...moCase, name: 'proof-mixed-probe', f: 1, bricksMixed: true, u: { ...moCase.u, diag: 5 } },
];
const PROOF_MAX_SILHOUETTE = +opt('--max-silhouette', 24), PROOF_SAMPLE_RATIO = +opt('--max-sample-ratio', 0.6);
const jobs = CASES.flatMap(c => [{ ...c, name: c.name + '-f100', f: 1 }, { ...c, name: c.name + '-f' + Math.round(F_LOW * 100), f: F_LOW }]);
const jobs4 = CASES4.flatMap(c => [{ ...c, name: c.name + '-f100', f: 1 }, { ...c, name: c.name + '-f' + Math.round(F_LOW * 100), f: F_LOW }]);

const jobs3 = jobs.slice(); // the three-segment jobs (and the proof) go to the first scene; jobs gets the four-segment ones appended for the comparison loop
const sh = grabShaders(shaderFile), scene = await buildScene(N), scene4 = await buildScene(N, { four: true });
// content-box proof (not goldens: compared within the run). The app discards a ray that misses the content box (docs/vr-content-box.js) and
// ends the march at its exit; the proxy and the ray parameter stay the full box's, so every image must be pixel-identical to the full-box render: each golden
// case, plus cases where the box is much smaller than the data box (bone only; bone only with a CT slice, whose air threshold reaches the body).
// The diag-5 probe (R = samples / 1024 per pixel) sums the samples over all pixels, full box vs content box (the work saved). Not failing, reported
// for reference: the same with the march also STARTING at the content box (boxEntry 1, a re-phased march: the image may change by a dither).
const DEF_SEGA = [[300, 3000, 1, 1], [-200, 299, 0.35, 1], [-250, -50, 1, 1], [0, 0, 0, 0]], DEF_SEGA4 = [[300, 3000, 1, 1], [-200, 299, 0.35, 1], [-250, -50, 1, 1], [-800, -300, 1, 1]];
const boneOnlyCls = [[300, 3000, 1, 1], [-200, 299, 1, 0], [-250, -50, 1, 0], [0, 0, 0, 0]];
const BOX_EXTRA = [
  { name: 'xbox-boneonly', defines: [...OPQ, 'VRL_NO_EVENTS'], u: { segA: boneOnlyCls } },
  { name: 'xbox-boneonly-slice', defines: OPQ, u: { segA: boneOnlyCls, cutPlanes: cut, planeCount: 1, planeCut: 1, capOn: 1, sliceOpacity: 0.7 } },
  { name: 'xbox-boneonly-slice-noclip', defines: OPQ, u: { segA: boneOnlyCls, cutPlanes: [[0, 0, 1, 0.1], zero, zero, zero], planeCount: 1, planeCut: 0, capOn: 1, sliceOpacity: 0.7 } },
  { name: 'xbox-boneonly-slice-air', defines: OPQ, u: { segA: boneOnlyCls, cutPlanes: [[0, 0, 1, 0.1], zero, zero, zero], planeCount: 1, planeCut: 0, capOn: 1, sliceOpacity: 0.7, sliceAir: 100 } },
].flatMap(c => [{ ...c, name: c.name + '-f100', f: 1 }, { ...c, name: c.name + '-f70', f: F_LOW }]);
const boxOf = (c, sc) => {
  const segA = c.u?.segA || (sc.four ? DEF_SEGA4 : DEF_SEGA), mo = c.maskOnly ? 1 : 0;
  const segs = segA.map((a, s) => ({ min: a[0], max: a[1], on: a[3] > 0.5, maskOnly: ((mo >> s) & 1) === 1 }));
  const slices = (c.u?.planeCount | 0) > 0 && (c.u?.sliceOpacity || 0) > 0, grid = { bricks: sc.bricks, brickDims: [sc.brickN, sc.brickN, sc.brickN], dims: [N, N, N] };
  return contentBox({ halfExt: HALF_EXT, grid, segs, slices, sliceGrid: grid, sliceAir: c.u?.sliceAir ?? -500 });
};
const boxCase = (c, sc, extra = {}) => { const b = boxOf(c, sc); return { ...c, name: 'box:' + c.name + (extra.boxEntry ? ':in' : ''), u: { ...c.u, ...(b.full || b.empty ? {} : { boxC: b.c, boxH: b.h }), ...extra }, box: b }; };
const probeOf = c => ({ ...c, name: 'probe:' + c.name, u: { ...c.u, diag: 5 } });
const BOX3 = [...jobs3, ...BOX_EXTRA], BOX4 = jobs4;
const PROBE_NAMES = new Set(['noevents-allopaque-f100', 'combined-section-f100', 'xbox-boneonly-f100', 'xbox-boneonly-slice-f100', '4seg-noevents-f100']);
const boxRuns = (list, sc) => [...list.filter(c => c.name.startsWith('xbox-')),
  ...list.map(c => boxCase(c, sc)), ...list.map(c => boxCase(c, sc, { boxEntry: 1 })),
  ...list.filter(c => PROBE_NAMES.has(c.name)).flatMap(c => [probeOf(c), probeOf(boxCase(c, sc))])];
// the off-frame rebuild of the combined texture (docs/vr-combo-rebuild.js; vr-view.js uploadCombo / applyCombo), compared within the run:
//  - patched: the texture holding a wrong alpha, then the right bytes sent in z slabs (copyTextureToTexture, as uploadCombo) = the normal image, pixel-identical;
//  - interim: while a shown segment is added, the general loop without jumps (distInCls 0, useDist 0) reads the texture with an alpha that no longer fits:
//    pixel-identical to the same loop on the plain classification bytes (the 距離場 diagnostic's path, golden full-cls-translucent);
//  - hide: the jumps kept on an alpha built for more segments (a lower bound for fewer). That is the configuration of this golden set's own noevents-bonefat
//    (alpha of 0b111, fat + bone shown) and of vr-cls-parity's fat-hidden case (checked against the CPU march there). Reported, not judged: the difference to
//    the exact alpha of the shown segments (other jump lengths re-phase the samples,: dither on the fat sheets and specks)
const byName = (list, n) => list.find(c => c.name === n), nsb = byName(jobs3, 'noevents-bonefat-f100'), ns4 = byName(jobs4, '4seg-noevents-f100');
const REBUILD = [{ ...nsb, name: 'rb-patched', comboVariant: 'patched' }, { ...byName(jobs3, 'full-cls-translucent-f100'), name: 'rb-interim', useClsRaw: false, comboVariant: 'stale' }, { ...nsb, name: 'rb-hide-exact', comboVariant: 'alt' }];
const REBUILD4 = [{ ...ns4, name: 'rb4-patched', comboVariant: 'patched' },
  { name: 'rb4-interim', defines: ['VRL_CLS4'], f: 1, comboVariant: 'stale', u: { segA: allOpaque4, distInCls: 0, useDist: 0 } },
  { name: 'rb4-interim-ref', defines: [], f: 1, useClsRaw: true, u: { segA: allOpaque4, distInCls: 0, useDist: 0 } }];
const { combineClassificationDistance } = await import('../docs/distance-field.js');
const comboAlt = combineClassificationDistance(scene.cls, scene.dist, 0b101); // bone + fat (noSoft): the exact alpha of noevents-bonefat (its golden uses the 0b111 one)
const render = () => withPage(async (pg, info) => {
  const r = await runBatch(pg, { sh, N, W, H, halfExt: HALF_EXT, scene: { ...sceneArgs(scene), comboAlt: Buffer.from(comboAlt).toString('base64') }, cases: [...jobs3, ...PROOF, ...boxRuns(BOX3, scene), ...REBUILD], mode: 'color', filter: 'linear' });
  const r4 = await runBatch(pg, { sh, N, W, H, halfExt: HALF_EXT, scene: sceneArgs(scene4), cases: [...jobs4, ...boxRuns(BOX4, scene4), ...REBUILD4], mode: 'color', filter: 'linear' });
  return { ...r, out: { ...r.out, ...r4.out }, glError: r.glError || r4.glError, info };
});
jobs.push(...jobs4);
const results = []; for (let i = 0; i < runs; i++) results.push(await render());
const first = results[0];
console.log('Chromium ' + first.info.version + ' · shader ' + path.relative(ROOT, shaderFile) + ' · ' + jobs.length + ' images ' + W + 'x' + H + ' · threshold: pixels <= ' + maxPixels + ', max channel diff <= ' + maxDiff);
let failed = first.info.problems.length > 0 || first.glError !== 0;
if (first.glError) console.log('GL error ' + first.glError);
if (first.info.problems.length) console.log('FAIL: shader / page problems:\n  ' + first.info.problems.join('\n  '));

if (runs > 1) { // run-to-run variance (same process image order, fresh browser per run)
  let worst = { pixels: 0, maxDiff: 0 };
  for (const j of jobs) for (let i = 1; i < runs; i++) { const d = diffPixels(first.out[j.name], results[i].out[j.name]); if (d.pixels > worst.pixels) worst.pixels = d.pixels; if (d.maxDiff > worst.maxDiff) worst.maxDiff = d.maxDiff; }
  console.log('run-to-run variance over ' + runs + ' fresh browsers: changed pixels (worst image) ' + worst.pixels + ', max channel diff ' + worst.maxDiff);
}
fs.mkdirSync(update ? goldenDir : outDir, { recursive: true });
const BGpx = [0.04, 0.06, 0.09].map(v => Math.round(v * 255));
for (const j of jobs) {
  const px = first.out[j.name], file = path.join(goldenDir, j.name + '.png');
  let covered = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - BGpx[0]) + Math.abs(px[i + 1] - BGpx[1]) + Math.abs(px[i + 2] - BGpx[2]) > 6) covered++;
  const blank = covered < W * H * 0.05; // a scene that renders nothing would "match" a blank golden
  if (blank) { failed = true; console.log('FAIL ' + j.name + ': the scene is (almost) empty, ' + covered + ' pixels drawn'); }
  if (update) { fs.writeFileSync(file, encodePng(px, W, H)); console.log('wrote ' + path.relative(ROOT, file) + ' (' + covered + ' px drawn)'); continue; }
  if (!fs.existsSync(file)) { failed = true; console.log('FAIL ' + j.name + ': golden missing (run with --update)'); continue; }
  const g = decodePng(fs.readFileSync(file));
  if (g.w !== W || g.h !== H) { failed = true; console.log('FAIL ' + j.name + ': golden size ' + g.w + 'x' + g.h); continue; }
  const d = diffPixels(px, g.px), bad = d.pixels > maxPixels || d.maxDiff > maxDiff;
  console.log((bad ? 'FAIL ' : 'ok   ') + j.name + ': changed pixels ' + d.pixels + ', max channel diff ' + d.maxDiff + ' (' + covered + ' px drawn)');
  if (bad) {
    failed = true; fs.writeFileSync(path.join(outDir, j.name + '-actual.png'), encodePng(px, W, H));
    const dp = new Uint8Array(px.length); for (let i = 0; i < px.length; i += 4) { for (let k = 0; k < 3; k++) dp[i + k] = Math.min(255, Math.abs(px[i + k] - g.px[i + k]) * 16); dp[i + 3] = 255; }
    fs.writeFileSync(path.join(outDir, j.name + '-diff.png'), encodePng(dp, W, H));
  }
}
// the mask-only occupancy proof (not a golden: compared within the run)
{
  const px = n => first.out[n], covered = p => { const c = new Uint8Array(W * H); for (let i = 0; i < c.length; i++) { const o = i * 4; if (Math.abs(p[o] - BGpx[0]) + Math.abs(p[o + 1] - BGpx[1]) + Math.abs(p[o + 2] - BGpx[2]) > 6) c[i] = 1; } return c; };
  const a = covered(px('proof-occ')), b = covered(px('proof-mixed')); let sil = 0, drawn = 0; for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) sil++; if (b[i]) drawn++; }
  const mean = p => { let s = 0, n = 0; for (let i = 0; i < p.length; i += 4) { s += p[i]; n++; } return s / n; }; // samples / 1024 * 255, averaged over the image
  const sOcc = mean(px('proof-occ-probe')), sMixed = mean(px('proof-mixed-probe')), ratio = sOcc / Math.max(sMixed, 1e-9), d = diffPixels(px('proof-occ'), px('proof-mixed'));
  const bad = sil > PROOF_MAX_SILHOUETTE || ratio > PROOF_SAMPLE_RATIO || drawn < W * H * 0.02 || scene.occupied === 0 || scene.occupied >= scene.brickN ** 3;
  console.log((bad ? 'FAIL ' : 'ok   ') + 'mask-only occupancy proof: occupied bricks ' + scene.occupied + ' / ' + scene.brickN ** 3 + ', silhouette pixels changed ' + sil + ' of ' + drawn + ' drawn (max ' + PROOF_MAX_SILHOUETTE + '), samples per ray ' + (sOcc * 1024 / 255).toFixed(1) + ' with occupancy vs ' + (sMixed * 1024 / 255).toFixed(1) + ' with every brick mixed (ratio ' + ratio.toFixed(3) + ', max ' + PROOF_SAMPLE_RATIO + '); colour diff inside the silhouette ' + d.pixels + ' px / max ' + d.maxDiff);
  if (bad) { failed = true; fs.mkdirSync(outDir, { recursive: true }); for (const n of ['proof-occ', 'proof-mixed']) fs.writeFileSync(path.join(outDir, n + '.png'), encodePng(px(n), W, H)); }
}
// the content-box proof
{
  const boxFails = [], inDiffs = []; let worstIn = { pixels: 0, maxDiff: 0 }, n = 0;
  for (const [list, sc] of [[BOX3, scene], [BOX4, scene4]]) for (const c of list) {
    const ref = first.out[c.name], b = boxOf(c, sc), got = first.out['box:' + c.name], gin = first.out['box:' + c.name + ':in']; n++;
    const d = diffPixels(got, ref), di = diffPixels(gin, ref);
    if (d.pixels || d.maxDiff) boxFails.push(c.name + ' (' + d.pixels + ' px, max ' + d.maxDiff + ')');
    if (di.pixels > worstIn.pixels) worstIn = { ...di, name: c.name }; if (di.pixels) inDiffs.push(c.name + ' ' + di.pixels + '/' + di.maxDiff);
    if (c.name.endsWith('-f100') && (PROBE_NAMES.has(c.name) || c.name.startsWith('xbox-'))) console.log('     content box ' + c.name + ': ' + (b.full ? 'full box' : b.h.map((v, a) => Math.round(v / HALF_EXT[a] * 100) + '%').join(' x ')) + ' of the data box (' + b.bricks + ' segment bricks, ' + b.sliceBricks + ' bricks in the slice slab range)');
  }
  const pr = name => { const px = first.out['probe:' + name], bx = first.out['probe:box:' + name]; let sf = 0, sb = 0, nf = 0, nb = 0; const drawn = (p, i) => p[i + 1] === 0 || p[i + 1] === 255; /* diag 5 writes G = hit flag 0 / 255 over the background (G 15) */ for (let i = 0; i < px.length; i += 4) { if (drawn(px, i)) { sf += px[i]; nf++; } if (drawn(bx, i)) { sb += bx[i]; nb++; } } return { sf: sf / 255 * 1024, sb: sb / 255 * 1024, nf, nb }; };
  for (const name of PROBE_NAMES) { const p = pr(name); console.log('     samples over the image ' + name + ': full box ' + Math.round(p.sf) + ' in ' + p.nf + ' shaded px, content box ' + Math.round(p.sb) + ' in ' + p.nb + ' px (' + Math.round((1 - p.sb / Math.max(p.sf, 1)) * 100) + ' % fewer samples, ' + Math.round((1 - p.nb / Math.max(p.nf, 1)) * 100) + ' % fewer fragments)'); }
  console.log((boxFails.length ? 'FAIL ' : 'ok   ') + 'content-box proof: ' + (n - boxFails.length) + ' / ' + n + ' images pixel-identical to the full-box render' + (boxFails.length ? ': ' + boxFails.join(', ') : ''));
  console.log('     (reference, not judged) march also starting at the content box: ' + inDiffs.length + ' / ' + n + ' images differ, worst ' + worstIn.pixels + ' px / max channel diff ' + worstIn.maxDiff + (worstIn.name ? ' (' + worstIn.name + ')' : ''));
  if (boxFails.length) failed = true;
}
// the combined-texture rebuild proof
{
  const px = n => first.out[n], same = (a, b) => { const d = diffPixels(px(a), px(b)); const ok = !d.pixels && !d.maxDiff; console.log((ok ? 'ok   ' : 'FAIL ') + 'combo rebuild: ' + a + ' vs ' + b + ': changed pixels ' + d.pixels + ', max channel diff ' + d.maxDiff); return ok; };
  let ok = same('rb-patched', 'noevents-bonefat-f100') & same('rb4-patched', '4seg-noevents-f100') & same('rb-interim', 'full-cls-translucent-f100') & same('rb4-interim', 'rb4-interim-ref');
  const covered = p => { const c = new Uint8Array(W * H); for (let i = 0; i < c.length; i++) { const o = i * 4; if (Math.abs(p[o] - BGpx[0]) + Math.abs(p[o + 1] - BGpx[1]) + Math.abs(p[o + 2] - BGpx[2]) > 6) c[i] = 1; } return c; };
  const a = covered(px('noevents-bonefat-f100')), b = covered(px('rb-hide-exact')), d = diffPixels(px('noevents-bonefat-f100'), px('rb-hide-exact')); let sil = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) sil++;
  console.log('     (reference, not judged) combo rebuild: hide with the superset alpha vs the exact alpha: silhouette pixels changed ' + sil + ', changed pixels ' + d.pixels + ', max channel diff ' + d.maxDiff);
  if (!ok) { failed = true; fs.mkdirSync(outDir, { recursive: true }); for (const n of ['rb-patched', 'rb4-patched', 'rb-interim', 'rb4-interim', 'rb4-interim-ref', 'rb-hide-exact']) fs.writeFileSync(path.join(outDir, n + '.png'), encodePng(px(n), W, H)); }
}
if (update) console.log('goldens updated in ' + path.relative(ROOT, goldenDir) + ': review the images and commit them, stating why the picture changed');
else if (failed) { console.error('vr-render-golden FAILED (actual / diff images in ' + path.relative(ROOT, outDir) + '). If the change is intended, rerun with --update, review and commit the goldens.'); process.exit(1); }
else console.log('vr-render-golden OK');
