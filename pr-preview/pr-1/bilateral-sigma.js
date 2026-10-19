// Kept for the build 445 / 446 names; the generalised code is in filter-units.js (build 447).
import { FILTER_UNITS, filterLegacyRange, legacyFilterValueHU, resolveFilterParams, sourceFilterSignature } from './filter-units.js?v=20261019-build624';

export { sourceFilterSignature };
export const BILATERAL_SIGMA_HU_DEFAULT = FILTER_UNITS.bilateral.params.sigmaHU.def;
export const bilateralLegacyRange = filterLegacyRange;
export function legacyBilateralSigmaHU(ratio, range) { return legacyFilterValueHU('bilateral', 'sigmaHU', { intensitySigma: ratio }, range); }
export function resolveBilateralParams(saved, range) {
  const r = resolveFilterParams('bilateral', saved, range), d = r.derived[0];
  return { sigmaHU: r.values.sigmaHU, legacy: !!d, fallback: !!d?.fallback };
}
