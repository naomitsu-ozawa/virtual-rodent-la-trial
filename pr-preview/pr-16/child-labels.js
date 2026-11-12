// CHILD SEGMENT NAME LABELS: the 3D name label of a child segment (PC 3D view and VR), pinned at a point, MOVABLE, saved and loaded with the project: the SAME label as the one of an analysis result
// (analysis-label.js: label = {anchor, offset?} in voxel units), so the views draw / drag / judge it with the code they already have for the results' labels. A child is NOT an analysis region and is never turned into one:
// the label lives on the child itself (c.label, saved as project.treeSegments[i].label; a project without it = not pinned), and the views get an ADAPTER (childLabelItem) that has the shape of a region
// ({id, label, color, mm3, segmentKeys, runsBySlice, voxels, visible, name}) so that no view needs a second copy of its label code.
//   id    : -(the child's id) (a negative number: it never meets an analysis region's id, which is positive). The views key their label cards by it ('A:' + id on the PC, the pin map of VR).
//   mm3   : the child's voxel count x one voxel's volume (spacing in mm), NaN while the spacing is not known.
// Pure data (no DOM, no three.js): unit-tested (tests/unit/child-labels.test.js).
import { childSegments, volume, current3DVolume } from './state.js?v=20261112-build728';
import { childDisplayName, childByKey } from './child-segments.js?v=20261112-build728';
import { regionChipTitle } from './region-name.js?v=20261112-build728';

// the volume of one child in mm3: voxels x sx x sy x sz; NaN when the voxel size is unknown (never a made-up number)
export function childVolumeMm3(voxels, spacing) {
  const [x, y, z] = spacing || [];
  const v = x * y * z;
  return Number.isFinite(v) && v > 0 && Number.isFinite(voxels) ? voxels * v : NaN;
}
const cssToNumber = css => { const n = parseInt(String(css).slice(1), 16); return Number.isFinite(n) ? n & 0xffffff : 0; };
const currentSpacing = () => (current3DVolume || volume)?.spacing;

class ChildLabelItem {
  constructor(c) { this.child = c; this.labelOwner = c; }
  get id() { return -this.child.id; }
  get key() { return this.child.key; }
  get label() { return this.child.label; }
  get color() { return cssToNumber(this.child.color); }
  get mm3() { return childVolumeMm3(this.child.voxels, currentSpacing()); }
  get segmentKeys() { return [this.child.parentKey]; }
  get runsBySlice() { return this.child.runsBySlice; }
  get voxels() { return this.child.voxels; }
  get visible() { return this.child.visible !== false; }
  get name() { return this.child.name || ''; }
}
const items = new WeakMap();
// the label item of a child (the same object for the same child)
export function childLabelItem(c) {
  if (!c) return null;
  let it = items.get(c);
  if (!it) { it = new ChildLabelItem(c); items.set(c, it); }
  return it;
}
export const isChildLabelId = id => typeof id === 'number' && id < 0;
// the child segments that have a pinned label (the views draw these)
export function childLabelItems() {
  const out = [];
  for (const c of childSegments) if (c.label && c.runsBySlice && c.voxels > 0) out.push(childLabelItem(c));
  return out;
}
// the label item of a negative label id (-> the child with that id), or null
export function childLabelItemById(id) {
  if (!isChildLabelId(id)) return null;
  const c = childSegments.find(x => x.id === -id);
  return c ? childLabelItem(c) : null;
}
export const hasChildLabels = () => childSegments.some(c => c.label);
// the name on the card: the child's name, else "<childSegment text> <id>" (segments.js segmentById: the same rule, the tree row's name)
export const childLabelTitle = (c, tr) => childDisplayName(c, x => tr('childSegment') + ' ' + x.id);
// the first text of a card for a label item: a child -> its name; an analysis result -> "<number>. <name | segments>" (region-name.js)
export const labelChipTitle = (item, tr) => (item?.child ? childLabelTitle(item.child, tr) : regionChipTitle(item, tr));
// the volume text of a card (NaN = unknown: no number at all)
export const labelVolumeText = mm3 => (Number.isFinite(+mm3) ? (+mm3).toFixed(2) + ' mm³' : '');

// the child segment under the laser (VR): ids = the child index texture's data (0 none, j = the j-th child of `list`), index = the voxel's position in it, slot = the GPU slot (bit) of the segment the laser hit.
// Only a child that hangs under the hit segment counts (list[j-1].segMask has the slot's bit). -> the child's key, or ''.
export function childKeyAtHit(ids, list, index, slot) {
  if (!ids || !list?.length || !(slot >= 0)) return '';
  const j = ids[index], e = j ? list[j - 1] : null;
  return e && ((e.segMask >> slot) & 1) ? e.key : '';
}

// the label id the laser's volume hit stands for (VR): the result's id when a result covers the voxel (regionList[hit.id - 1].rid), else -(the child's id) for the child under the laser, else 0 (nothing with a label).
// The single "what the laser reads" (the result wins). The hover cards, the pins and the glow now read hitLabelRids below (both targets of an overlap); this one stays for the single answer.
export function hitLabelRid(hit, regionList, byKey = childByKey) {
  if (!hit) return 0;
  if (hit.id) return regionList?.[hit.id - 1]?.rid || 0;
  if (hit.childKey) { const c = byKey(hit.childKey); return c ? -c.id : 0; }
  return 0;
}

export function hitLabelRids(hit, regionList, byKey = childByKey, out = []) {
  out.length = 0;
  if (!hit) return out;
  if (hit.id) { const r = regionList?.[hit.id - 1]?.rid; if (r) out.push(r); }
  if (hit.childKey) { const c = byKey(hit.childKey); if (c) out.push(-c.id); }
  return out;
}
// One trigger tap on a hit with these targets (rids in card order; hasLabel(rid) = is its card pinned now): the first one that is not pinned gets pinned; with all of them pinned they are all unpinned.
// One target = the tap as it always was (pin / unpin it). Two: tap 1 pins the result, tap 2 the child, tap 3 unpins both (back to none). A tap on a pinned card unpins that very card alone (unchanged).
// -> {pin: rid} | {unpin: [rids]} | null (no target)
export function labelToggle(rids, hasLabel) {
  if (!rids?.length) return null;
  for (const rid of rids) if (!hasLabel(rid)) return { pin: rid };
  return { unpin: rids.slice() };
}
// the two hover cards side by side (the cards face the head: x = the head's right): the centre shifts of a card of width w1 on the left and one of w2 on the right with `gap` between, the pair centred on the chip's place.
export function pairShifts(w1, w2, gap) {
  const total = w1 + w2 + gap;
  return [-(total - w1) / 2, (total - w2) / 2];
}
