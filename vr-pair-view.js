// Drawing the PARTNER of a sample pair next to the primary volume inside a VR / AR session (stage 2 of the sample pair work). Pure: no DOM, no three.js, no app state.
// docs/vr-view.js owns the GPU side (textures, materials, the frame loop); this module holds the rules it applies, so that they can be unit-tested:
//   - where the partner sits (side by side, real sizes, a small gap),
//   - which uniforms of the volume shader the two volumes SHARE (the view: sections, slice look, ...), which are the partner's own (its data) and which are worked out each frame,
//   - the sections: each dataset has its OWN; which dataset a section belongs to (pairSectionOwner: where its frame is put; planeOnPartner: the rule for a new / restored frame) and the parked plane of the other one;
//     shiftPlanes (the primary's planes in the partner's object space: the partner is offset inside the same holder) is the stage-2 "one section for both" rule, kept for its test,
//   - which of the partner's slots are shown (the primary's segment state, looked up by segment KEY: the partner's slot order is its own).

// the gap between the two boxes, as a fraction of the wider half width
export const PAIR_GAP = 0.2;

// the partner's offset along the holder's x axis (scene units; the primary's box centre is the holder's origin). halfA / halfB: [x, y, z] half extents of the primary / the partner.
export const pairOffsetX = (halfA, halfB) => halfA[0] + halfB[0] + PAIR_GAP * Math.max(halfA[0], halfB[0]);

// a section belongs to the partner when its frame's centre (holder space, x) is past the middle between the two boxes (the partner's box is the primary's moved by deltaX along x); else to the primary
export const planeOnPartner = (x, deltaX) => x > deltaX / 2;
// the HOLDER of a section: true = the partner's. A frame whose centre x (holder space) is within the PARTNER's box width [deltaX - halfB, deltaX + halfB] belongs to the partner, within the
// primary's [-halfA, halfA] to the primary; in the gap between the boxes (or outside both) the holder stays what it was (prevOnPartner), so a small shake in the gap never flips it. halfA / halfB: the half widths along x of the two boxes.
// A new / restored frame has no earlier holder: it takes planeOnPartner (past the middle = the partner's).
export const pairSectionOwner = (prevOnPartner, x, deltaX, halfA, halfB) => (x >= deltaX - halfB && x <= deltaX + halfB ? true : x >= -halfA && x <= halfA ? false : !!prevOnPartner);
// Individual poses: each dataset of a pair is moved / turned by its own grip, so the partner is NOT at a fixed offset of the primary any more: its box is seen from its own space.
// pairBoxHas: is the point p ({x, y, z} in a dataset's OWN object space) inside that dataset's box (half extents half = [x, y, z])?
export const pairBoxHas = (p, half) => Math.abs(p.x) <= half[0] && Math.abs(p.y) <= half[1] && Math.abs(p.z) <= half[2];
// The holder of a section from where its frame's centre is NOW (置いた場所で決まる, as pairSectionOwner but for boxes in any pose): inPartner / inPrimary = the centre is inside that dataset's box (each seen from its own space).
// Inside the partner's only -> the partner's; inside the primary's only -> the primary's; inside both or neither (the gap between the boxes, empty space) the holder stays what it was.
export const pairSectionOwnerIn = (prevOnPartner, inPrimary, inPartner) => (inPartner && !inPrimary ? true : inPrimary && !inPartner ? false : !!prevOnPartner);
// the holder of a NEW / restored frame (no earlier holder): the dataset whose box centre is nearer (distances in the same unit)
export const planeNearerPartner = (distPrimary, distPartner) => distPartner < distPrimary;
// Which dataset a grip / a fist takes: the laser's hits on the primary (vh) and on the partner (ph), {distance} or null; the nearer one (the primary when the partner is not hit or the distances tie)
export const grabTargetOf = (vh, ph) => (ph && (!vh || ph.distance < vh.distance) ? 'pair' : 'main');
// What the hands holding a volume do. kinds: for every hand that holds one, 'main' (the primary) or 'pair' (the partner). Two hands on the SAME dataset scale (the magnification is one for both: real size);
// otherwise every hand moves / turns its own dataset (one hand on each, or one hand alone).
export function pairGrabPlan(kinds) {
  const main = kinds.filter(k => k !== 'pair').length, pair = kinds.length - main;
  return { main, pair, scale: main === 2 || pair === 2, moveMain: main === 1 && pair < 2, movePair: pair === 1 && main < 2 };
}
// the plane written for a dataset that does NOT own that section: far outside the box (never meets it, draws no slice), with no clip bit
export const PLANE_PARK_W = 1e6;

// The uniforms of the volume shader (vr-view.js volumeUniforms), each in exactly one group. tests/unit/vr-pair-view.test.js reads volumeUniforms from the source and fails when a key is in none / two of them
// (a new uniform must be placed here, or the partner would silently draw with the wrong one).
export const PAIR_UNIFORMS = {
  // the view: the SAME uniform object as the primary's (the slice look, the cut mode and the quality settings follow the primary at once, by reference; the section planes themselves are NOT shared: see `frame`)
  shared: ['diag', 'ctShade', 'ctShadeBright', 'ctShadeContrast', 'sliceSegOnly', 'planeCount', 'capOn', 'sliceTint', 'sliceOpacity', 'sliceWindow', 'sliceAir', 'refine'],
  // worked out every frame from the primary's state: the partner's OWN sections (planes in its object space + their clip bits: each dataset has its own sections, vr-view.js planeOwnerPair), the march step, and the per-slot segment values
  frame: ['cutPlanes', 'planeCut', 'stepSize', 'segA', 'segC', 'segM', 'ctShadeRange'],
  // the partner's own data (textures, grid, calibration, the combined classification state, the analysis index); never touched by the primary
  own: ['vol', 'bricks', 'halfExt', 'boxC', 'boxH', 'boxEntry', 'texDims', 'brickDims', 'calib', 'regionTex', 'regionLut', 'regionAnyHidden', 'childTex', 'childLut', 'childAnyHidden', 'sliceVol', 'useCls', 'clsTex', 'cls4Tex', 'useSkip', 'skipTex', 'clsChan', 'editMask', 'editMaskOnly', 'editTex', 'useDist', 'distInCls', 'hideVMode', 'distTex', 'voxelMin', 'voxelSize', 'bakeCut', 'bakeField', 'bakeFieldScale', 'bakeFieldOff', 'bakeFieldA', 'bakeFieldB'], // n740: the bake* keys: the primary's baked cut (a partner is never baked: 0 / null)
};

// an earlier change: whether the partner's result card is shown. The SHAPE rule of a partner result is the one it is DRAWN and PICKED by (vr-view.js pairRegionLut / pairHit): the matching primary result's region.hidden (p);
// a partner result with no match in the primary (the regions are defined differently) is drawn and picked whatever its own saved flag says, so it has its card too (the partner's own reg.hidden is never read).
export const pairShapeShown = p => !(p && p.hidden === true);

// the partner's uniforms: `own` (a fresh set made by volumeUniforms for the partner's data) with the shared view keys replaced by the primary's objects
export function pairUniforms(fresh, primary) {
  const u = { ...fresh };
  for (const k of PAIR_UNIFORMS.shared) u[k] = primary[k];
  return u;
}

// The primary's section planes ({x, y, z, w}: dot(n, p) = w in the primary's object space) in the partner's object space. The partner's origin is at `delta` ([x, y, z], holder space = the primary's object
// space): a point p of the primary's space is q = p - delta there, so dot(n, q + delta) = w  ->  dot(n, q) = w - dot(n, delta). The normal is unchanged (both boxes are children of one holder, no rotation between them).
// out: the partner's cutPlanes (objects with .set(x, y, z, w)); only the first `count` are written. Returns out.
export function shiftPlanes(src, count, delta, out) {
  for (let i = 0; i < count; i++) { const p = src[i]; out[i].set(p.x, p.y, p.z, p.w - (p.x * delta[0] + p.y * delta[1] + p.z * delta[2])); }
  return out;
}

// The slots of the partner. `order` = its prepared slot keys (the 4 GPU slots), `chan` = its classification channels (chan[i] < 0: the slot has no data), isShown(key) = the primary's rule for that segment KEY
// (available and not hidden by a VR-local mode). Bit i of the mask = slot i is drawn.
export function pairShownMask(order, chan, isShown) {
  let m = 0;
  for (let i = 0; i < 4; i++) { const key = order[i]; if (key && (chan ? chan[i] >= 0 : true) && isShown(key)) m |= 1 << i; }
  return m;
}

// the shown set as the shader sees it (vr-view.js: the shown segments within the texture's safe mask; a segment just shown appears once its alpha is uploaded; `held` while none of the wanted ones is in it yet)
export const pairHeldMask = (shown, safe) => (shown && !(shown & safe) ? safe : 0);
export const pairSlotShown = (held, safe, i, shownHere) => ((held >> i & 1) || ((safe >> i & 1) && shownHere) ? 1 : 0);

// the primary's result of a bone (atlas ID), looked up EVERY frame for each name card of the partner (vr-view.js pairPins), was a find over the
// primary's whole list per result. createAtlasIndex().get(list) gives a Map(atlas ID -> the FIRST result of list with that ID: what list.find(r => r.atlasId === a) gives), made again only when the list
// changed (another array, another length, another result or another atlas ID at a place: one pass of comparisons, no lookup); `builds` counts how often it was made (for the tests).
export function createAtlasIndex() {
  let arr = null, builds = 0;
  const refs = [], ids = [], map = new Map();
  return {
    get(list) {
      let ok = arr === list && refs.length === list.length;
      for (let i = 0; ok && i < list.length; i++) ok = refs[i] === list[i] && ids[i] === list[i].atlasId;
      if (!ok) {
        arr = list; refs.length = 0; ids.length = 0; map.clear(); builds++;
        for (const r of list) { refs.push(r); ids.push(r.atlasId); if (!map.has(r.atlasId)) map.set(r.atlasId, r); }
      }
      return map;
    },
    get builds() { return builds; },
  };
}
// the primary's result for atlas ID a (null / undefined: none; NaN: none, as === never matches it)
export const atlasPrimary = (map, a) => (a == null || a !== a ? null : map.get(a) || null);
