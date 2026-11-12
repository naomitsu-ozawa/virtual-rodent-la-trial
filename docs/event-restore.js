// 体験会モード, the VR 「最初の状態に戻す」: the saved state of the CHILD SEGMENTS and of the ANALYSIS REGIONS goes back to what the project file holds, IN PLACE (no decode, no GPU upload: a running XR session keeps its volume).
// Pure of the DOM; called by data-load.js restoreProjectAnnotations. Children of the open data are matched with the project's treeSegments entries in the file's order, each entry taking the first unused child with its parentKey
// (a child added or deleted since is not rebuilt here: that is a structural change the VR menu does not offer). Per child: name, colour, shape shown (visible), 色だけ消す (colorOff) and the pinned label (with its place).
// Per region: colour flag (visible), shape flag (hidden), colour; its label and name are put back by the caller as before.
import { childSegments } from './state.js?v=20261112-build730';
import { CHILD_PARENT_KEYS } from './child-segments.js?v=20261112-build730';
import { setChildLook } from './segments.js?v=20261112-build730';
import { childLabelItem } from './child-labels.js?v=20261112-build730';
import { setRegionLabel, normalizeAnalysisLabel } from './analysis-label.js?v=20261112-build730';
import { setRegionVisible, setRegionHidden } from './region-visibility.js?v=20261112-build730';
export function restoreChildSegmentsState(entries, list = childSegments) {
  const used = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e !== 'object' || !CHILD_PARENT_KEYS.includes(e.parentKey)) continue;
    const c = list.find(x => !used.has(x) && x.parentKey === e.parentKey); if (!c) continue;
    used.add(c);
    setChildLook(c.key, { name: e.name, color: e.color, visible: e.visible !== false, colorOff: e.colorOff === true });
    setRegionLabel(childLabelItem(c), normalizeAnalysisLabel(e.label) || null);
  }
  return used.size;
}
// an analysis region's saved shown flag and colour (the entry of project.analysis.regions)
export function restoreRegionState(region, e) {
  setRegionVisible(region, e.visible !== false);
  setRegionHidden(region, e.hidden === true); // the shape flag: a file saved before it has none = shown
  const col = Number(e.color); if (Number.isFinite(col) && region.color !== col) region.color = col;
}
