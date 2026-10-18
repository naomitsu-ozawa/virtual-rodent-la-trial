# VR render guards

Automated checks added before further VR performance work (past VR regressions came from drift between the four copies of the tissue
classification, shader hot-loop edits, and a `//` comment that swallowed a statement). They test the real `docs/vr-view.js` shaders and the
real `docs/vr-pick.js` / `docs/point-cls.js` on **synthetic data only** (`tools/lib/vr-phantom.mjs`). None of them changes app behaviour.

| Check | Command | CI | Needs a browser |
|---|---|---|---|
| Shader compile / link of every variant | `npm run vr-gpu-prepare-check` | job `vr-guards` | yes |
| Render golden images | `npm run vr-render-golden` | job `vr-guards` | yes |
| CPU / GPU classification parity | `npm run vr-cls-parity` | job `vr-guards` | yes |
| Depth read-back (the volume's `gl_FragDepth` at f = 1 and f < 1 vs the hit point pushed back by `depthBias()`) | `npm run vr-depth-check` | job `vr-guards` | yes |
| Static guard: no `//` comment swallows a statement | `npm test` (`tests/unit/swallowed-statement.test.js`) | job `unit` | no |
| CPU parity unit test (`buildClsData` vs HU truth, thresholds in the sources, `marchClassificationHitInfo` vs a dense march) | `npm test` (`tests/unit/cls-parity.test.js`) | job `unit` | no |

All four browser checks run on headless Chromium with SwiftShader (software WebGL2). Locally set `PW_CHROMIUM=/opt/pw-browsers/chromium`
(otherwise Playwright's own Chromium is used); `npm run vr-guards` runs them in a row (about 30 s).

## Rule for VR performance PRs

- **VR perf PRs must keep the golden diff at 0** (`changed pixels 0, max channel diff 0`), or declare and justify a threshold in the PR
  (`--max-pixels N --max-diff N`, and why the picture is allowed to change). Builds 386-393 had no regressions because every shader change was pixel-compared first; this makes it automatic.
- **Perf PRs must not touch `docs/vr-pick.js`, `docs/point-cls.js` or `docs/vr-point.js` without updating the parity test**
  (`tools/vr-cls-parity.mjs`, `tests/unit/cls-parity.test.js`) and saying so in the PR. The picking (laser, 3D markers, hidden points) must classify the same voxels the shader draws.
- An intended picture change: `npm run vr-render-golden:update`, look at every changed PNG in `tests/golden/vr-render/`, commit them with the reason in the commit message.

## Render golden (`tools/vr-render-golden.mjs`)

A 64^3 phantom (bone ball / plate / rod with 100 HU-per-voxel ramps, soft tissue, "complex" fat: thin sheets with holes plus single-voxel specks), anisotropic box
(halfExt 1.65 x 1.3 x 1.0), 160 x 160 px, fixed camera. Nine cases x two resolutions = 18 PNGs in `tests/golden/vr-render/`:

- `noevents-bonefat`, `noevents-allopaque`: variant `VRL_NO_GENERAL + VRL_NO_EVENTS + VRL_OPAQUE` (the tight loop without plane events), soft tissue off / on;
- `combined-section`, `combined-section-bonefat`, `combined-two-planes`: variant `VRL_NO_GENERAL + VRL_OPAQUE` with a clipping plane, cut-face cap and CT slice (and a second, non-clipping slice plane);
- `noevents-regions`: the same with `VRL_REGIONS` (analysis result colours);
- `full-cls-translucent`, `full-hu`: the general loop (translucent soft tissue 0.35 / fat 0.5), classification path and HU path (this is where `ACC_STOP` shows).
- `full-hu-maskonly` (build 526, issue #132): the HU path with only the bone shown and the bone decided by a mask-only edit (`editMaskOnly`; the scene's edit mask on a
  half-size grid, as the app's 512³ data with the 256 mask: the ball "closed" to 12 voxels plus a detached cube of soft tissue). The brick texture's B channel
  carries the mask-only occupancy (`docs/vr-brick-occupancy.js`). The same run also checks the **occupancy proof** (not a golden): the scene rendered with every
  brick a candidate (the pre-526 behaviour = no skip) must have the same drawn silhouette (at most `--max-silhouette` 24 edge pixels re-phased by the skip) and the
  diag 5 probe must show at most `--max-sample-ratio` 0.6 of the samples per ray (measured 0.25).
- `noevents-bonefat-rolled`, `combined-section-rolled` (build 612, shared lighting `docs/lighting.js`): the same scenes with the viewer rolled by 180 degrees about its view axis (`camUp` in the case, = the volume turned upside down). The light is a headlight above the viewer, so these are lit from the same side in the picture as the unrolled cases; before build 612 the light was fixed in volume coordinates and the rolled picture was lit from below. Build 612 changed every golden on purpose (one-sided diffuse, the light above the viewer, a mild depth cue): silhouettes and depths are unchanged, only the shading. A hit behind a translucent layer (a slice, a cut face or a translucent segment composited first) is shaded with the segment's OUTWARD normal and not turned to the viewer (an inner wall that faces away gets only the ambient floor): only the cases with such hits (combined-*, full-*, 4seg-combined-section) changed in that second step, the opaque first-hit cases did not.
- `-f100` = direct 100 % drawing; `-f70` = the low-resolution path of `vr-view.js` (ray material into a 70 % target, then the composite pass over the background).
- **Content-box proof** (build 562, not a golden: compared within the run). The app discards a ray that misses the content box (`docs/vr-content-box.js`: the box of the
  bricks a shown segment can occupy, plus the CT slices above `sliceAir`) and ends the march at its exit; the proxy geometry and the ray parameter stay the full box's.
  Every golden case, plus bone-only cases with and without CT slices (where the box is much smaller), is rendered again with the box: all must be pixel-identical
  (0 px / 0 diff) to the full-box render. The run also prints the box size, the diag-5 samples summed over the image (full vs content box) and, for reference
  (not judged), the diff when the march also *starts* at the content box (`boxEntry 1`, not used by the app: it re-phases the distance-field jumps).
  Why the proxy geometry is not the content box itself: the ray direction is interpolated from the proxy's faces and the march is sensitive to its last bit
  (shrinking the full box by 1e-6 already changed 86 pixels by up to 11), so only the full-box geometry keeps the image bit-identical.

Options: `--update`, `--max-pixels N`, `--max-diff N` (default 0 / 0, env `GOLDEN_MAX_PIXELS` / `GOLDEN_MAX_DIFF`), `--shader FILE` (render a scratch copy of vr-view.js), `--runs K` (variance), `--out DIR`.
A scene that renders (almost) nothing, a GL error or a shader / page error also fail. On failure the actual and a 16x diff image go to `test-results/vr-golden/` (a CI artifact).

**Not covered:** the WebGPU volume (`medical-volume.js` WGSL), real-device GPU differences (Quest Adreno), sub-LSB changes (e.g. 6 -> 5 bisection steps changes no 8-bit pixel),
the 2D slice views, stereo / XR projection, the menu / labels / laser drawing.

**Determinism:** SwiftShader is bit-exact here: 0 changed pixels / 0 channel diff over 5 fresh browsers in one go and repeated separate runs, and identical between the
full Chromium and the headless shell of the same version (141). Not verified: other Chromium versions (CI installs Playwright's current one). If a Chromium update moves SwiftShader by an LSB,
the CI log shows the exact counts; then regenerate the goldens with the new engine (`--update`) in the same PR, or set `GOLDEN_MAX_PIXELS` / `GOLDEN_MAX_DIFF` in the workflow and document why.

## CPU / GPU parity (`tools/vr-cls-parity.mjs`)

A 32^3 phantom. The real fragment shader is patched only at the hit shading of the tight loop (`outColor = (hit position, segment + 1)`), so the march, distance-field jumps,
surface search and plane clip are the real ones. For every pixel's camera ray the GPU first hit (segment, voxel, distance) is compared with `marchClassificationHitInfo`
(same bytes from the real `buildClsData`, same planes). Cases: all segments, fat hidden, one clipping plane; two filters:

- `nearest`: the GPU classifies exactly the bytes the CPU reads, so this isolates the shader's `>= 0.5` against the CPU's `>= 128`: segment >= 95.5 %, exact voxel >= 75 %, |dt| p95 <= 0.8 voxel (measured 97.9 / 81 / 0.45).
- `linear` (what the app uses): the GPU surface is a trilinear isosurface and thin structures are seen by one side only: hit/miss agreement >= 88 %, voxel within 1 >= 96 %, |dt| p95 <= 1.9 voxels (measured 91.5 / 97.7 / 1.6).

Why not 100 %: the CPU marches nearest-voxel at half-voxel steps, the shader at 0.85 of the smallest voxel with jumps, and one-voxel shells (skin) are seen by one side. The bounds are the measured values plus a margin;
shifting the CPU threshold 128 -> 96 or 160, or the shader's `q - 0.5` by 0.05 (about one voxel on the bone ramp), fails them.
`buildClsData` itself feeds both sides, so its contract is checked against the HU truth in `tests/unit/cls-parity.test.js` (byte >= 128 exactly where the HU is in range).

**Not covered:** the WGSL volume (it classifies from HU, not from these bytes), the event loop's cap / slice colours (golden only), laser logic above the march (`vr-point.js`, unit tests), edit-mask / processed-segment bytes (`buildClsData` mask path is unit-tested only).

## Static guard (`tests/unit/swallowed-statement.test.js`)

Scans every `docs/*.js` (template literals / GLSL too) for a `//` comment that swallowed code: a comment after code that ends with `;`, `;` directly followed by a call / assignment, or a word glued to `scene.` / `ctx.` / `mesh.` + call.
Strings (URLs), `scheme://`, regex ends (`\/\/`) and `/* */` are skipped. Two live defects on main were found when it was written (kept in an explicit `KNOWN` list, with the swallowed text, so the guard is green; fix and delete the entry): `docs/comment-ui.js` (build 481: `onMeasureStartChange(...)` never registered) and `docs/data-load.js` (build 436: `sigmoidCenter.disabled=...` never runs).
