// What the VR data preparation reads (sample pair work, stage 1). Pure: no DOM, no app state. docs/vr-view.js used to read the page's globals directly (gpuVolumeTarget, segmentState, analysisRegions, ...);
// these functions take ONE object `inp` instead, so the same code can prepare another volume (the partner of a sample pair, docs/vr-pair-data.js builds its `inp`). The page's own `inp` (vr-view.js pageInputs) is a set
// of getters over the globals: every read happens when the function asks for it, exactly as before (nothing is snapshotted on entry: the preparation reads the volume first, then initialVrModes changes segMode, then the rest).
//
// inp (a property is only read by the functions that need it):
//   volume       : { columns, rows, slices, sourceBacked, series, filterSignature?, sliceData? } or null (what gpuVolumeTarget() gives)
//   order        : the 4 GPU slot keys (gpuSegmentOrder())
//   segments     : { key: { active, enabled, min, max } } the segment state (what decides "available")
//   eventMode    : true = a segment that is active counts as available even when its checkbox is off (体験会モード)
//   segMode      : { key: 0 | 1 | 2 } the VR-local mode of a segment (2 = hidden)
//   vrSegments   : { key: { active, enabled, min, max } } what the worker's classification state is made of (segments; in event mode with enabled = active)
//   editDescs    : { key: { mode, runs, maskOnly } } the processed / edited segments (gpuVolumeEditDescriptors); {} = none
//   children     : [{ key, runs, voxels, parentKey, hash }] the child segments (childRenderEntries()); [] = none
//   regions      : [{ id, color, segmentKeys, runsBySlice, voxels, mm3 }] the analysis results
//   unitsPerMm   : scene units per mm; omitted = 3.3 / the volume's longest side (every volume on its own scale, as before). A partner passes the PRIMARY volume's value (real size ratio kept).
//   initModes    : () => void, called once before the segment state is read (the page: initialVrModes); omitted = nothing
import { volumeTexturePlan } from './medical-volume.js?v=20261112-build719';
import { marchStep } from './vr-auto-quality.js?v=20261112-build719';
import { unionRunArrays, subtractRunArrays } from './run-length.js?v=20261112-build719';

export const VR_TARGET_SIDE = 512; // the in-plane size the VR grid is reduced to (was a const of vr-view.js)
export const VR_LONGEST_UNITS = 3.3; // the longest side of a volume in scene units when it is on its own scale

// scene units per mm of a series on its own scale (the longest side of the volume = VR_LONGEST_UNITS). A partner of a sample pair takes the PRIMARY's value (inp.unitsPerMm) so that both keep the real size ratio.
export function vrUnitsPerMm(s) {
  const px = s.columns * s.spacingX, py = s.rows * s.spacingY, pz = s.slices.length * s.spacingZ, maxP = Math.max(px, py, pz, 1);
  return VR_LONGEST_UNITS / maxP;
}

// a segment counts as available: active and (enabled, or event mode)
export const segAvailOf = (inp, g) => !!g?.active && (!!g.enabled || !!inp.eventMode);

// the analysis results that are prepared (the same rule as the page's shownRegions): not hidden by their segments, with voxels
export const shownRegions = inp => inp.regions.filter(r => (!r.segmentKeys?.length || r.segmentKeys.some(k => segAvailOf(inp, inp.segments[k]))) && r.runsBySlice && r.voxels > 0);
// the child segments of the tree that are prepared: a mask whose parent segment is available (a child's shown flag is NOT part of it)
export const shownChildren = inp => inp.children.filter(c => c.runs && c.voxels > 0 && segAvailOf(inp, inp.segments[c.parentKey]));

// shown-segment mask of the combined texture's alpha (segMode 2 = hidden)
export function shownMask(inp) {
  let mask = 0;
  const slotKeys = inp.order, segments = inp.segments, segMode = inp.segMode;
  for (let i = 0; i < 4; i++) { const key = slotKeys[i], seg = segments[key]; if (segAvailOf(inp, seg) && segMode[key] !== 2) mask |= 1 << i; }
  return mask;
}

// what the data's geometry decides (the grid, the calibration, the box, the march step): no voxel is read
export function volumeMeta(inp, maxDim) {
  const v = inp.volume, s = v?.series;
  if (!v?.sourceBacked || !s) throw new Error('VR: open a DICOM series first');
  const plan = volumeTexturePlan(v, 0, maxDim, VR_TARGET_SIDE), [tw, th, td] = plan.dims, first = s.slices[0], signed = !!first.signed;
  const slope = first.slope || 1, intercept = first.intercept || 0, bias = signed ? 32768 : 0, calibration = [slope, intercept, bias];
  const px = s.columns * s.spacingX, py = s.rows * s.spacingY, pz = s.slices.length * s.spacingZ, maxP = Math.max(px, py, pz, 1), scale = inp.unitsPerMm != null ? inp.unitsPerMm : 3.3 / maxP;
  const halfExt = [px * scale * .5, py * scale * .5, pz * scale * .5], step = marchStep(halfExt, [tw, th, td]);
  return { v, s, plan, dims: [tw, th, td], first, signed, calibration, halfExt, step, filtered: !!(v.filterSignature && typeof v.sliceData === 'function') };
}

// what the segments hold for the processing mask: [{ si, mode, maskOnly, runs }] and the source grid, or null without a volume.
// The child segments' masks are put back (the page builds a preset WITHOUT its children's voxels): a keep mask gets them added, an exclude mask loses them,
// so the prepared data does not depend on any child's shown flag.
export function editDescsOf(inp) {
  const v = inp.volume; if (!v) return null;
  const descs = inp.editDescs, out = [];
  const kidRuns = new Map(); for (const c of shownChildren(inp)) { const d = v.slices, cur = kidRuns.get(c.parentKey); kidRuns.set(c.parentKey, cur ? unionRunArrays(cur, c.runs, d) : c.runs); }
  inp.order.forEach((key, si) => { const desc = descs[key]; if (!desc?.runs) return; const kr = kidRuns.get(key); let runs = desc.runs; if (kr) runs = desc.mode === 'keep' ? unionRunArrays(runs, kr, v.slices) : subtractRunArrays(runs, kr, v.slices); out.push({ si, mode: desc.mode, maskOnly: !!desc.maskOnly, runs }); });
  return { descs: out, sourceDims: [v.columns, v.rows, v.slices] };
}

// the child segments' masks for the worker's child index: key, the parent's GPU slot bit, the mask (colour / range / shown flag are read at run time)
export function childItemsOf(inp) {
  const sk = inp.order;
  return shownChildren(inp).map(c => { const sl = sk.indexOf(c.parentKey); return { key: c.key, segMask: sl >= 0 ? 1 << sl : 0, runsBySlice: c.runs, hash: c.hash }; });
}

// the analysis results for the worker's region index: colour, the GPU slots of their segments, runs, volume, id
export function regionItemsOf(inp) {
  const slotKeys = inp.order;
  return shownRegions(inp).map(r => ({ color: r.color, segMask: (r.segmentKeys || []).reduce((m, key) => { const sl = slotKeys.indexOf(key); return sl >= 0 ? m | (1 << sl) : m; }, 0), runsBySlice: r.runsBySlice, mm3: r.mm3, segmentKeys: [...(r.segmentKeys || [])], rid: r.id }));
}

// the segment state the worker's classification takes: { key: { active, enabled, min, max } } for the first four slots (undefined for a slot with no segment)
export function classifyStateOf(inp) {
  const segs = inp.vrSegments, state = {};
  for (const k of inp.order.slice(0, 4)) { const g = segs[k]; state[k] = g ? { active: !!g.active, enabled: !!g.enabled, min: g.min, max: g.max } : undefined; }
  return state;
}
