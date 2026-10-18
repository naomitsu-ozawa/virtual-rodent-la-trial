// Filter parameters in absolute HU (builds 445-447).
// Before, the strength of several filters was a fraction of (v.max - v.min), and v.min / v.max differed between load
// paths and devices (DICOM metadata range vs the range of the decoded data, rewritten by prepareSourceMprCache), so the
// same project gave different results. Now each of these parameters is an absolute HU value, saved in the project file
// and used as it is. Projects saved before have only the old (ratio / strength) parameters; their HU value is derived
// from the old parameter and the range the old code effectively used (see filterLegacyRange).
// Pure module (no DOM) so that the unit tests and the signature can use it directly.

const round6 = x => Math.round(x * 1e6) / 1e6;
const spanOf = range => Math.max(1, (range?.max ?? 0) - (range?.min ?? 0));
const num = (x, d) => (Number.isFinite(+x) && x !== '' && x !== null && x !== undefined ? +x : d);
// a saved ratio of 0 is a value (Unsharp: 0 = every detail is sharpened), not a missing one; only a negative one is replaced
const ratioOf = (saved, name, def) => { const r = num(saved?.[name], def); return r >= 0 ? r : def; };
// A usable HU value: finite and > 0, or >= 0 where the slider itself starts at 0 (Unsharp threshold: 0 HU is a real setting).
// Used when reading a project and when setting a control, so a value is never taken for "missing" (and then replaced by
// a derived or default value) just because it is small.
export const isValidUnitValue = (def, v) => Number.isFinite(v) && (def?.min === 0 ? v >= 0 : v > 0);

// One entry per filter: `algo` = version of its HU-based algorithm (part of the filter signature, so cache entries made
// by the ratio-era code are never reused); `params` = the HU parameters:
//  name       parameter name in the project file and in the stage params (all HU)
//  label      short name for messages
//  def/min/max/step   new-project default and slider range (min / max / step null = no slider)
//  legacy(saved, span)  HU value of a project that only has the old parameters; span = max(1, range.max - range.min)
// Anisotropic diffusion step size: strength 0..1 maps linearly onto [ANISO_LAMBDA_MIN, ANISO_LAMBDA_MAX]. The 6-neighbour
// explicit scheme is stable for lambda <= 1/6 (conductance <= 1), but at exactly 1/6 the finest checkerboard component has
// eigenvalue 1 - 12*lambda*g = -1 and is not damped. 1/7 keeps it at about -0.71, so fine noise shrinks at strength 1.
// Strengths outside 0..1 (and non-numbers) are clamped to that range.
// The worker in source-filters.js is serialised and cannot import this; it repeats the two values (a test pins them).
export const ANISO_LAMBDA_MIN = 0.06;
export const ANISO_LAMBDA_MAX = 1 / 7;

// Per-axis weights from the voxel spacing (shared by every spacing-aware filter: Anisotropic, TV, Gaussian, Bilateral, NLM and Unsharp).
// w_a = (hmin / h_a)^2 with hmin = min(hx, hy, hz), so every weight is in (0, 1]: a finer axis keeps weight 1, a coarser
// one is weighted down (a physical gradient is diff / h_a, the flux term scales with 1 / h_a^2). Weights <= 1 keep the
// explicit scheme stable with the same lambda <= 1/7 (the sum of the six weights never exceeds 6).
// Returns [wx, wy, wz], or null when the data is isotropic (every weight within SPACING_ISO_TOL of 1) or the spacing is
// unusable (not three finite numbers > 0): callers then add nothing to the stage params, so the filter signature and the
// result are exactly those of a build without spacing weights.
export const SPACING_ISO_TOL = 1e-3;
export const SPACING_AWARE_KEYS = new Set(['anisotropic', 'tv', 'gaussian', 'bilateral', 'nlm', 'unsharp']);
export function spacingWeights(spacing) {
  if (!spacing || typeof spacing.length !== 'number' || spacing.length < 3) return null;
  const h = [+spacing[0], +spacing[1], +spacing[2]];
  if (!h.every(x => Number.isFinite(x) && x > 0)) return null;
  const hmin = Math.min(h[0], h[1], h[2]), w = h.map(x => (hmin / x) ** 2);
  if (w.every(x => Math.abs(x - 1) <= SPACING_ISO_TOL)) return null;
  return w.map(round6);
}
// The three weights a kernel gets for a stage: params.sp, or [1, 1, 1] when the stage has none (isotropic).
export const spacingParams = p => [p?.sp?.[0] ?? 1, p?.sp?.[1] ?? 1, p?.sp?.[2] ?? 1];
// Adds `sp` to a stage (only for spacing-aware filters and only for non-isotropic data); otherwise returns it unchanged.
export function withSpacingWeights(stage, spacing) {
  if (!SPACING_AWARE_KEYS.has(stage.key)) return stage;
  if (stage.key === 'gaussian' && stage.params?.mode === 'median') return stage; // Median is not spacing-aware (yet): its stage and cache key stay as they were
  const sp = spacingWeights(spacing);
  return sp ? { ...stage, params: { ...stage.params, sp } } : stage;
}
// Ratios hmin / h_a = sqrt(w_a) per axis (1 for the finest axis and for a stage without sp). Radii and sigmas given in voxels
// of the finest axis are scaled by these to cover the same distance in mm along every axis.
export const spacingRatios = p => spacingParams(p).map(Math.sqrt);
// Bilateral: half-width in voxels per axis, clamp(ceil(1.5 * sigma * ratio_a), 0, 3). The finest axis (ratio 1) keeps the
// lower bound 1 of the isotropic filter, so isotropic data gets exactly [r, r, r] as before. On a coarser axis (ratio < 1)
// the radius is 0 only when sigma = 0: any sigma > 0 rounds up to at least 1.
export const bilateralRadii = (spatialSigma, ratios) => ratios.map(r => Math.min(3, Math.max(r >= 1 ? 1 : 0, Math.ceil(spatialSigma * 1.5 * r))));
// NLM: search / patch radius per axis = round(base * ratio_a) (a coarse axis may drop to 0 = no search / patch along it).
export function nlmRadii(searchRadius, patchRadius, ratios) {
  const sr = Math.max(1, Math.round(searchRadius)), pr = Math.max(0, Math.round(patchRadius));
  return { sr: ratios.map(r => Math.round(sr * r)), pr: ratios.map(r => Math.round(pr * r)) };
}
// Unsharp: box of half-width (R + 0.5) * ratio_a voxels along axis a (R = the radius in voxels of the finest axis; the
// isotropic box has half-width R + 0.5, i.e. R whole voxels). Voxel k gets the fraction of it inside the box,
// clamp(A - |k| + 0.5, 0, 1): all 1 for the finest axis. K = taps on each side of the centre.
export const unsharpWeight = (A, k) => Math.min(1, Math.max(0, A - Math.abs(k) + 0.5));
export function unsharpAxes(radius, ratios) {
  const R = Math.max(1, Math.round(radius));
  return ratios.map(r => { const A = (R + 0.5) * r; return { A, K: Math.min(R, Math.max(0, Math.ceil(A - 0.5 - 1e-9))) }; });
}
export const anisotropicLambda = strength => { const s = Number.isFinite(+strength) ? Math.min(1, Math.max(0, +strength)) : 0; return Math.min(ANISO_LAMBDA_MIN + (ANISO_LAMBDA_MAX - ANISO_LAMBDA_MIN) * s, ANISO_LAMBDA_MAX); };

export const FILTER_UNITS = {
  spikeHole: { algo: 2, params: {
    thresholdHU: { label: 'Spike/Hole threshold', def: 100, min: 20, max: 1000, step: 5, legacy: (s, span) => ratioOf(s, 'threshold', 0.075) * span } } },
  nlm: { algo: 2, params: {
    hHU: { label: 'NLM h', def: 40, min: 5, max: 300, step: 1, legacy: (s, span) => span * (0.018 + 0.11 * num(s?.strength, 0.45)) } } },
  anisotropic: { algo: 3, params: {
    kappaHU: { label: 'Anisotropic kappa', def: 60, min: 5, max: 300, step: 1, legacy: (s, span) => span * (0.025 + 0.09 * num(s?.strength, 0.45)) } } },
  tv: { algo: 2, params: {
    epsHU: { label: 'TV eps', def: 1, min: null, max: null, step: null, legacy: (s, span) => 1e-4 * span } } },
  unsharp: { algo: 2, params: {
    thresholdHU: { label: 'Unsharp threshold', def: 60, min: 0, max: 500, step: 5, legacy: (s, span) => ratioOf(s, 'threshold', 0.02) * span } } },
  bilateral: { algo: 2, params: {
    sigmaHU: { label: 'Bilateral sigma', def: 50, min: 10, max: 300, step: 1, legacy: (s, span) => ratioOf(s, 'intensitySigma', 0.02) * span } },
  },
};

// The range v.min / v.max a pre-447 project effectively used. It depends on the load path:
//  - sourceBacked series, resident GPU volume prepared: the metadata range (sourceRangeFromMetadata(): DICOM tags, else
//    the full bit-depth range with intercept)
//  - sourceBacked series, no resident GPU volume: prepareSourceMprCache() rewrites it to the data range (device dependent)
//  - small series (not sourceBacked): decode() returns the data range on every device, and nothing rewrites it
// The device-dependent middle case cannot be reproduced; the metadata range is used for sourceBacked series (the value
// the project was most likely made with). Small series use the data range, which is what they always used.
export function filterLegacyRange(sourceBacked, metaRange, dataRange) { return sourceBacked ? metaRange : dataRange; }

// HU value of one parameter derived from the old parameters; NaN if the range is not finite.
export function legacyFilterValueHU(key, name, saved, range) {
  const def = FILTER_UNITS[key]?.params?.[name];
  if (!def || !Number.isFinite(range?.min) || !Number.isFinite(range?.max)) return NaN;
  return round6(def.legacy(saved || {}, spanOf(range)));
}

// Saved params of one filter → { values: {name: HU}, derived: [{name, value, fallback}] }. A saved HU value is used as it
// is (never recomputed); a missing one is derived from the old parameters and the range, and if that is not possible
// (range not finite) the new-project default is used and `fallback` is set. `derived` is empty for a new project.
export function resolveFilterParams(key, saved, range) {
  const out = { values: {}, derived: [] };
  for (const [name, def] of Object.entries(FILTER_UNITS[key]?.params || {})) {
    const own = saved?.[name];
    if (own !== undefined && own !== null && own !== '' && isValidUnitValue(def, +own)) { out.values[name] = +own; continue; }
    const v = legacyFilterValueHU(key, name, saved, range);
    const ok = isValidUnitValue(def, v);
    out.values[name] = ok ? v : def.def;
    out.derived.push({ name, label: def.label, value: out.values[name], fallback: !ok });
  }
  return out;
}

// The filter signature (cache key part): stages with the algorithm version of every HU-based filter added.
export function sourceFilterSignature(stages) {
  return JSON.stringify(stages.map(s => FILTER_UNITS[s.key] ? { ...s, params: { ...s.params, algo: FILTER_UNITS[s.key].algo } } : s));
}
