// "is the page's state still the state the practice level opened with?" (体験会モード). A plain signature of everything that decides the finished VR data of the page's data: the data and its
// filter, every segment's settings, the manual edits (their revision), the shown analysis results. Not the identity of the run arrays (they are built on demand: the VR preparation adds the runs of the hidden
// segments, which must not look like a change by the visitor). The page records it when a practice level has finished opening (standard-open.js); the VR preparation compares it (vr-prep-cache.js isStandardOpen).
// This module is loaded with the page (vr-view.js is loaded lazily, when VR is entered, after the level has been opened).
import { gpuVolumeTarget } from './gpu-volume-data.js?v=20261027-build677';
import { SEGMENT_PRESET_ORDER, gpuSegmentOrder, segmentState, segmentEditState, segmentSourceSignature } from './segments.js?v=20261027-build677';
import { analysisRegions } from './state.js?v=20261027-build677';
import { eventModeOn } from './event-mode.js?v=20261027-build677';

const segAvail = g => !!g?.active && (!!g.enabled || eventModeOn()); // the same rule as vr-view.js: in 体験会モード a segment the page keeps hidden counts as available
export function vrStateSignature() {
  const v = gpuVolumeTarget(); if (!v?.series) return '';
  const segs = SEGMENT_PRESET_ORDER.map(k => {
    const g = segmentState[k] || {}, st = segmentEditState[k] || {};
    return [g.active ? 1 : 0, segAvail(g) ? 1 : 0, g.min, g.max, g.opening, g.closing, g.holeFill ? 1 : 0, g.minComponent, g.surfaceMm, g.thicknessMm, st.revision | 0, segmentSourceSignature(k)].join(',');
  });
  const regions = analysisRegions.filter(r => r.visible !== false && r.voxels > 0).map(r => r.id + ':' + r.color + ':' + r.voxels).join(',');
  return [v.series.id, v.filterSignature || '', gpuSegmentOrder().join('>'), ...segs, regions].join('|');
}
