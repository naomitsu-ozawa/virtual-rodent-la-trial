// Occlusion rules of the analysis result labels on the PC / iPad 3D view (comment-3d.js). Pure (no three.js, no DOM).
// The VR labels have their own copy of the judgement (vr-view.js / vr-depth.js are not shared on purpose: the two are developed apart).
//
//  (1) BEHIND a volume (judged with vr-point.js pointIsHidden, in comment-3d.js): the label, its leader and its anchor dot are hidden completely.
//  (2) EMBEDDED: the place of the card (the anchor, or the anchor + the stored label.offset) lies INSIDE the tissue that is shown now.
//      Tissue = a voxel of a shown segment (classification channel >= 128, vr-pick.js classifiedAt, the VR rule) on the side every cutting
//      plane of the section view keeps (n.p - w >= 0). Judged only when the anchor, the offset, the shown segments or the section plane change.
//  (3) PUSH OUT: an embedded card is moved out of the tissue. From the card's place we march in 26 directions (6 axes, 12 edges, 8 corners) in
//      half-voxel steps up to LABEL_PUSH_MAX (object space; the long side of the box is 3.3); the direction that leaves the tissue first wins
//      (axes first on a tie) and the card goes LABEL_PUSH_MARGIN_VOX voxels beyond that surface point. The leader still starts at the anchor.
//      A card that could be pushed out is shown normally (rule 1 applies to its new place); one that could not stays embedded = translucent.
//  (4) OVERLAP: of the cards that overlap on the screen only the nearest stays; a lit (hovered / dragged) card always stays.
import { classifiedAt } from './vr-pick.js?v=20261110-build706';

export const LABEL_PUSH_MAX = 0.8; // how far (object space) a card may be pushed out of the tissue; beyond it the card stays embedded (translucent)
export const LABEL_PUSH_MARGIN_VOX = 1.5; // how far beyond the surface (in voxels of the classification grid) the pushed card is put
export const OVERLAP_PAD = 2; // px added around every card for the overlap test

const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
// 6 axes, then 12 edge diagonals, then 8 corners: the order is the tie-break
export const PUSH_DIRS = (() => {
  const out = [];
  for (const n of [1, 2, 3]) for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if ((x !== 0) + (y !== 0) + (z !== 0) === n) out.push(norm(x, y, z));
  }
  return out;
})();

// kept side of the section plane {x,y,z,w} (unit normal, kept: n.p - w >= 0); no plane = everything kept
const planeKeeps = (p, plane) => !plane || plane.x * p.x + plane.y * p.y + plane.z * p.z - plane.w >= 0;

// is the point p (object space) inside tissue that is shown? prep = {cls,dims,halfExt} (as comment-3d-hidden.js computeHiddenIds), chs = shown channels
export function tissueAt(p, prep, chs, plane = null) {
  if (!prep?.cls || !chs?.length || !p) return false;
  return planeKeeps(p, plane) && classifiedAt(p, prep.halfExt, prep.dims, prep.cls, chs);
}

// the smallest classification voxel edge in object space (step of the marches)
const voxelMin = prep => Math.min(2 * prep.halfExt[0] / prep.dims[0], 2 * prep.halfExt[1] / prep.dims[1], 2 * prep.halfExt[2] / prep.dims[2]);

// -> {point:{x,y,z}, dist} (the card's new place, the distance from p0 to the surface) or null (p0 is not embedded, or no way out within maxDist)
export function pushOutOfTissue(p0, prep, chs, plane = null, { maxDist = LABEL_PUSH_MAX, marginVox = LABEL_PUSH_MARGIN_VOX } = {}) {
  if (!tissueAt(p0, prep, chs, plane)) return null;
  const vm = voxelMin(prep), step = vm / 2, margin = marginVox * vm;
  let best = null;
  for (const d of PUSH_DIRS) {
    const limit = Math.min(maxDist, best ? best.dist : Infinity);
    let exit = -1;
    for (let t = step; t <= limit; t += step) {
      if (!tissueAt({ x: p0.x + d.x * t, y: p0.y + d.y * t, z: p0.z + d.z * t }, prep, chs, plane)) { exit = t; break; }
    }
    if (exit < 0) continue;
    const q = { x: p0.x + d.x * (exit + margin), y: p0.y + d.y * (exit + margin), z: p0.z + d.z * (exit + margin) };
    if (tissueAt(q, prep, chs, plane)) continue; // a thin wall: the point beyond it is tissue again, try another way
    if (!best || exit < best.dist) best = { point: q, dist: exit };
  }
  return best;
}

// one label: base = the card's place before pushing (the anchor, or the anchor + label.offset), object space.
// -> {embedded, push:{x,y,z}|null}  (embedded: base lies in the tissue; push: where the card went, null = could not be pushed out / not needed)
export function judgeLabelPlace(base, prep, chs, plane = null, opts) {
  if (!tissueAt(base, prep, chs, plane)) return { embedded: false, push: null };
  const r = pushOutOfTissue(base, prep, chs, plane, opts);
  return { embedded: true, push: r ? r.point : null };
}

// what is drawn: 'hide' (behind a volume: nothing at all), 'faint' (embedded and not pushed out: translucent), 'show'.
// A card that is dragged right now is never hidden (the hand needs to see it).
export function labelDisplay({ embedded = false, pushed = false, behind = false, dragging = false } = {}) {
  if (embedded && !pushed) return 'faint';
  if (behind && !dragging) return 'hide';
  return 'show';
}

// items: [{id,x,y,w,h,z,keep}] cards on the screen (centre x,y; size w,h; z = depth, smaller = nearer; keep = lit / dragged). -> Set of the ids to hide.
// Greedy: the cards that must stay first, then near to far; a card that overlaps one already kept is hidden.
export function thinOverlaps(items, pad = OVERLAP_PAD) {
  const order = items.slice().sort((a, b) => (b.keep ? 1 : 0) - (a.keep ? 1 : 0) || a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept = [], hide = new Set();
  for (const it of order) {
    const hw = it.w / 2 + pad, hh = it.h / 2 + pad;
    const clash = kept.some(k => Math.abs(it.x - k.x) < hw + k.w / 2 + pad && Math.abs(it.y - k.y) < hh + k.h / 2 + pad);
    if (clash && !it.keep) hide.add(it.id); else kept.push(it);
  }
  return hide;
}

// DOM writes only when the value changed: the last value written is kept on the element, so a frame in which nothing moved writes nothing.
// el = an Element (or anything with setAttribute / style).
export function putAttr(el, k, v) { const c = el.__w || (el.__w = {}); if (c[k] === v) return false; c[k] = v; el.setAttribute(k, v); return true; }
export function putStyle(el, k, v) { const c = el.__w || (el.__w = {}), key = 's:' + k; if (c[key] === v) return false; c[key] = v; el.style[k] = v; return true; }
