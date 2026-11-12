// The VR preparation input of the PARTNER of a sample pair (stage 1 of the sample pair work). Pure: no DOM, no app state, no network.
// The primary volume's input is the page itself (docs/vr-view.js pageInputs: getters over the app's globals); the partner has no page state, so its input is made here from its own files:
//   - the unpacked .vrlab ({ project, files } of project-file.js unpackProject): the segments (range, colour, shown), their overlap rule, the analysis results (runs decoded with decodeRuns)
//   - the series (the one docs/data-load.js loadSamplePartnerFiles' files make: columns, rows, slices[], spacingX / Y / Z, id)
// What the partner has none of: manual edits (project.edits), child segments (project.treeSegments), filters and post-processing of a segment are NOT applied (the data is raw, a segment is its range only). A project that has any of them is
// reported in `unsupported` (never silently dropped), so the caller decides.
// The result is the `inp` of docs/vr-prep-inputs.js (see there for every field) plus `unsupported` (strings) and `segmentColors` ({key: css colour}) for the later stages.
import { decodeRuns } from './project-file.js?v=20261112-build720';
import { effectiveRanges } from './segment-exclusive.js?v=20261112-build720';
import { gpuSlotOrder } from './segment-slots.js?v=20261112-build720';
import { analysisRunsVoxelCount } from './run-length.js?v=20261112-build720';
import { vrUnitsPerMm } from './vr-prep-inputs.js?v=20261112-build720';

// the segment presets (segments.js SEGMENT_PRESET_ORDER: segments.js reads the page, so this pure module keeps its own copy; tests/unit/vr-pair-data.test.js checks that they agree)
export const SEGMENT_PRESET_ORDER = ['bone', 'soft', 'fat', 'lung', 'contrast'];
// the order of the overlap rule when the project names none (the page's segmentExclusive.order at the start)
const DEFAULT_EXCLUSIVE_ORDER = ['contrast', 'bone', 'fat', 'soft', 'lung'];
// what applyProject (data-load.js) fills in behind a given order
const ORDER_FILL = ['bone', 'fat', 'soft', 'lung', 'contrast'];

// the overlap rule of a project: { mode, order } exactly as applyProject + applyExclusiveRanges read it (projects without it keep overlaps: 'off')
export function exclusiveRuleOf(project) {
  const so = project?.segmentOptions || {};
  const mode = ['off', 'priority'].includes(so.exclusive) ? so.exclusive : 'off';
  let base = DEFAULT_EXCLUSIVE_ORDER;
  if (Array.isArray(so.order) && so.order.length) base = [...so.order.filter(k => SEGMENT_PRESET_ORDER.includes(k)), ...ORDER_FILL.filter(k => !so.order.includes(k))];
  return { mode, order: [...base.filter(k => SEGMENT_PRESET_ORDER.includes(k)), ...SEGMENT_PRESET_ORDER.filter(k => !base.includes(k))] };
}

// the segment state of a project, as the page holds it after applyProject: { key: { active, enabled, min, max, color } }.
// min / max are the range IN USE (the user range minus the ranges of the active segments above it: effectiveRanges), not the sliders' values the project stores.
export function segmentStateOf(project) {
  const user = {};
  for (const key of SEGMENT_PRESET_ORDER) {
    const g = project?.segments?.[key];
    if (g && Number.isFinite(+g.min) && Number.isFinite(+g.max)) user[key] = { userMin: +g.min, userMax: +g.max, active: !!g.active };
  }
  const { mode, order } = exclusiveRuleOf(project), eff = effectiveRanges(user, order, mode), out = {};
  for (const key of SEGMENT_PRESET_ORDER) {
    const g = project?.segments?.[key], e = eff[key];
    out[key] = { active: !!g?.active, enabled: !!g?.enabled, min: e ? e.min : 0, max: e ? e.max : 0, color: g?.color };
  }
  return out;
}

// the name label of a result as the project stores it ({anchor: {i, j, k}, offset?: {i, j, k}}, voxel units): only finite numbers are kept; null = no label. The partner's card is drawn at this anchor (stage 3).
export function partnerLabelOf(l) {
  const vec = v => (v && [v.i, v.j, v.k].every(x => typeof x === 'number' && Number.isFinite(x)) ? { i: v.i, j: v.j, k: v.k } : null), anchor = vec(l?.anchor), offset = vec(l?.offset);
  return anchor ? { anchor, ...(offset ? { offset } : {}) } : null;
}
// the analysis results of a project: [{ id, color, segmentKeys, runsBySlice, voxels, mm3, atlasId?, name?, label? }] in the project's order, ids 1.. (as restoreAnalysisRegions numbers them: a result without voxels or segments gets none)
export function regionsOf(project, files, dims, voxelMm3) {
  const out = [];
  for (const e of project?.analysis?.regions || []) {
    const keys = (e.segmentKeys || []).filter(k => SEGMENT_PRESET_ORDER.includes(k)); if (!keys.length) continue;
    const bytes = files?.[e.runs]; if (!bytes) throw new Error('missing ' + e.runs);
    const runsBySlice = decodeRuns(bytes, dims), voxels = analysisRunsVoxelCount(runsBySlice); if (!voxels) continue;
    out.push({ id: out.length + 1, color: Number(e.color), segmentKeys: keys, runsBySlice, voxels, mm3: voxels * voxelMm3, ...(Number.isFinite(e.atlasId) ? { atlasId: e.atlasId } : {}),
      ...(typeof e.name === 'string' && e.name.trim() ? { name: e.name.trim() } : {}), ...(partnerLabelOf(e.label) ? { label: partnerLabelOf(e.label) } : {}) }); // atlasId: which bone it is (the two datasets of a pair list different results: the list position does NOT match, the atlas ID does)
  }
  return out;
}

// a voxel INSIDE a result, {i, j, k} (the middle run of the middle non-empty slice: the same choice as analysis-results.js analysisRegionRepresentativeVoxel, which reads the page and so cannot be used here), or null for a result with no voxel.
// The name card of a result is placed on its surface seen from the head: the ray goes from the head to this voxel (analysis-label.js surfaceAnchor). region: { runsBySlice } (decodeRuns: per slice [y, x0, x1, ...]).
export function resultRepresentativeVoxel(region) {
  const per = region?.runsBySlice; if (!per) return null;
  const nonEmpty = []; for (let z = 0; z < per.length; z++) if (per[z]?.length) nonEmpty.push(z);
  if (!nonEmpty.length) return null;
  const z = nonEmpty[Math.floor(nonEmpty.length / 2)], rec = per[z], i = Math.floor((rec.length / 3) / 2) * 3;
  return { i: Math.floor((rec[i + 1] + rec[i + 2]) / 2), j: rec[i], k: z };
}

// what a project holds that the partner's raw data cannot show (empty = nothing is lost)
export function unsupportedOf(project) {
  const out = [];
  if (Object.values(project?.edits || {}).some(e => e && (e.keep || e.exclude))) out.push('edits');
  if (Array.isArray(project?.treeSegments) && project.treeSegments.length) out.push('childSegments');
  if ((project?.filters?.order || []).length) out.push('filters');
  if (SEGMENT_PRESET_ORDER.some(k => { const g = project?.segments?.[k]; return g?.active && (g.opening > 0 || g.closing > 0 || g.minComponent > 0 || g.holeFill || g.surfaceMm > 0 || g.thicknessMm > 0); })) out.push('postProcessing');
  return out;
}

// the input of the partner. opts:
//   unitsPerMm : the PRIMARY volume's scene units per mm (unitsPerMmOfSeries(primarySeries) = vr-prep-inputs.js vrUnitsPerMm): the partner is drawn at its real size next to it.
//                omitted = the partner is normalised on its own (longest side = 3.3), like a lone volume.
//   eventMode  : 体験会モード: an active segment counts as available even with its checkbox off (as the page's segAvail)
//   segMode    : { key: 0 | 1 | 2 } the VR-local modes (2 = hidden); the page's own at the time (a partner follows the primary)
//   volume     : the volume object of the series (data-load.js openSourceBackedVolume(series)); omitted = the minimal one made here
export function partnerInputs({ project, files, series, unitsPerMm, eventMode = false, segMode = {}, volume = null }) {
  if (!project || !series?.slices?.length) throw new Error('partner inputs: a project and a series are needed');
  const dims = { slices: series.slices.length, columns: series.columns, rows: series.rows };
  const v = volume || { sourceBacked: true, series, columns: series.columns, rows: series.rows, slices: series.slices.length, spacing: [series.spacingX, series.spacingY, series.spacingZ] };
  const segState = segmentStateOf(project), segments = {};
  for (const key of SEGMENT_PRESET_ORDER) segments[key] = { active: segState[key].active, enabled: segState[key].enabled, min: segState[key].min, max: segState[key].max };
  const order = gpuSlotOrder(SEGMENT_PRESET_ORDER, segments);
  const vrSegments = eventMode ? Object.fromEntries(SEGMENT_PRESET_ORDER.map(k => [k, { ...segments[k], enabled: !!segments[k].active }])) : segments;
  return {
    volume: v, order, segments, eventMode: !!eventMode, segMode, vrSegments,
    editDescs: {}, children: [],
    regions: regionsOf(project, files, dims, series.spacingX * series.spacingY * series.spacingZ),
    ...(unitsPerMm != null ? { unitsPerMm } : {}),
    segmentColors: Object.fromEntries(SEGMENT_PRESET_ORDER.map(k => [k, segState[k].color])),
    unsupported: unsupportedOf(project),
  };
}

// the scene units per mm the PRIMARY volume is drawn at (pass it as partnerInputs' unitsPerMm so that the partner has the same scale)
export const unitsPerMmOfSeries = vrUnitsPerMm;
