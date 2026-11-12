// (first prototype): a region / child segment taken OUT of the body and moved freely (VR / AR only). Pure: no DOM, no three.js, no app state (unit-tested: tests/unit/vr-part-view.test.js).
// docs/vr-view.js owns the GPU side (the `part` block of startVrView); this module holds the rules it applies:
//   - the method (Issue 案A): the same textures are drawn a second time in another box (the part's own pose), where everything but the target is "not tissue" (PART_GLSL, compiled only with VRL_PART);
//     the body's own draw is NOT changed: the target is hidden in the body by patching the look-up tables AFTER they were written (patchRegionLut / patchChildLut) -- a run-time overlay like the stick's colour-off,
//     region.hidden / child.visible (saved in the project, shown on the 表示 buttons) are never written,
//   - which uniforms the part owns (the rest is the body's by reference: PART_OWN), the target a grip takes (partTargetOf), the part's own box (partBoundsOf), the laser's rule on the CPU (partKeepVoxelOf),
//   - several parts at once: every part has its own box, uniforms and pose; the tables are patched for all of them (patchRegionLutMany / patchChildLutMany); a part's proxy box is its own bounding box (partProxyBox) and its laser march
//     runs only inside it (partRayRange), the texts. The way in is the long-press ring (region-ring.js 切り出す / 戻す); the grip stays the body's grab and takes a part only where the laser meets one.
import { regionLutAlpha } from './region-visibility.js?v=20261112-build727';
import { boxFromRange } from './vr-content-box.js?v=20261112-build727';

// ---- the shader block. Spliced into the volume fragment shader once (vr-view.js ${PART_GLSL}, after the hidden-shape block A and BEFORE the an earlier change hide helpers hideAnyOn / hideAt / hideGrad, so that they read the re-pointed functions too), so that no existing line of the shader has to change. Without VRL_PART (every program but the
// part's) the preprocessor drops all of it: the body's programs are the ones they were. With VRL_PART the two functions the marching loops ask "is this voxel a hidden shape?" (regionHiddenAt / childHiddenAt) are
// re-pointed (by #define, after their definitions, as regionColor is re-pointed by the child block) to versions that also say "yes" for every voxel that is not the part: the ray goes on through it, as through a hidden child.
// an earlier change: "which result / child is this voxel" for HIDING is the index texture's G channel (the hide index, never grown), so the part's own test reads G as well (regionTex .g, childHideIdAt): the voxels the body hides
// (its table, G == the target) are exactly the voxels the part keeps. hideAt / hideGrad / the prevHid logic then see the non-part voxels as a hidden part, inside the part's box.
// partKind 1 = an analysis result (regionTex id), 2 = a child segment (childTex id); partMask = the slots (bit s) of the part's own segments (a result / child is the shape of ITS segments' tissue only).
export const PART_GLSL = `
// ==== DETACHED PART: compiled only with VRL_PART (the part's own box; the body never has it) ====
#ifdef VRL_PART
uniform int partKind;
uniform int partId;
uniform int partMask;
#ifdef VRL_REGIONS
bool regionHiddenAtP(vec3 tc,int s){
 if(partKind==1){int i=int(texture(regionTex,clamp(tc,vec3(0.0),vec3(0.999999))).g*255.0+0.5);if(i!=partId||((partMask>>s)&1)==0)return true;}
 return regionHiddenAt(tc,s);
}
#define regionHiddenAt(tc,s) regionHiddenAtP(tc,s)
#endif
#ifdef VRL_CHILDREN
bool childHiddenAtP(vec3 tc,int s){
 if(partKind==2&&(childHideIdAt(tc)!=partId||((partMask>>s)&1)==0))return true;
 return childHiddenAt(tc,s);
}
#define childHiddenAt(tc,s) childHiddenAtP(tc,s)
#endif
#endif
// ==== end of DETACHED PART ====
`;
// the call sites the block above takes over: every one of them must stay in the shader, or the part would draw the whole body (tests/unit/vr-part-view.test.js reads the shader source for them)
// (the loops call childHiddenAt(tc,s) with two arguments; hideAt, the hidden-part test of the an earlier change hide logic, calls both functions too and sits after the block)
export const PART_CALL_SITES = Object.freeze(['passH=childHiddenAt(tcO+tcD*t,idx)', 'passH=childHiddenAt(tc0,idx)', 'passH=regionHiddenAt(tcO+tcD*t,idx)', 'passH=regionHiddenAt(tc0,idx)', ' if(childHiddenAt(tc,s))return true;', ' if(regionAnyHidden!=0&&regionHiddenAt(tc,s))return true;']);

// the uniforms the part owns (all of them are keys of volumeUniforms); every other uniform of the volume shader is the BODY's OWN object (shared by reference: the data, the view, the shown set, the march step ...).
//   boxC / boxH / boxEntry: the part's own content box, and the march starts at it (boxEntry 1); planeCount / planeCut: 0, a part is never cut by the sections and draws no slice;
//   regionLut / childLut: the part's own copies of the tables (the target NOT hidden: the body's has it hidden); regionAnyHidden: the part's own.
export const PART_OWN = Object.freeze(['boxC', 'boxH', 'boxEntry', 'planeCount', 'planeCut', 'regionLut', 'regionAnyHidden', 'childLut']);
// the part's uniform names that volumeUniforms does NOT have (made only for the part's materials)
export const PART_EXTRA = Object.freeze(['partKind', 'partId', 'partMask']);
// the part's uniforms: the body's (every key by reference) with `own` ({name: {value}}) put over them
export function partUniforms(primary, own) { return { ...primary, ...own }; }

// ---- the target of a pull-out. hit = the laser's volume hit {id (1-based position in regionList, 0 = none), childKey ('' = none)} (vr-view.js volumeHitRay); regionList / childList = the prepared lists
// (regionList[i].rid, childList[j].key). Where a child segment lies inside a result (they overlap) the CHILD is taken: it is the smaller, more specific thing (decision of this prototype; the ring offers both).
// -> {kind: 'child', index (0-based), id (1-based: the index texture's value), key} | {kind: 'region', index, id, rid} | null
export function partTargetOf(hit, regionList, childList) {
  if (!hit) return null;
  if (typeof hit.childKey === 'string' && hit.childKey) {
    const j = (childList || []).findIndex(e => e.key === hit.childKey);
    if (j >= 0 && j < 255) return { kind: 'child', index: j, id: j + 1, key: hit.childKey };
  }
  const i = (hit.id | 0) - 1;
  if (i >= 0 && i < 255 && regionList && regionList[i]) return { kind: 'region', index: i, id: i + 1, rid: regionList[i].rid };
  return null;
}
export const partSame = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id && (a.kind === 'child' ? a.key === b.key : a.rid === b.rid);
// the GPU slot bits of a result as the table has them (the prepared mask, else from its segment keys in the runtime slot order): the same rule as vr-view.js refreshRegionLut
export const regionSlotMask = (e, slotKeys) => (typeof e.segMask === 'number' ? e.segMask : (e.segmentKeys || []).reduce((m, key) => { const sl = slotKeys.indexOf(key); return sl >= 0 ? m | (1 << sl) : m; }, 0));

// ---- the look-up tables. Called by vr-view.js right AFTER refreshRegionLut / refreshChildLut wrote the normal table `a` (a Float32Array). `out` = the part's own table (same size): it gets a copy of the normal table with the target
// NOT hidden (and with its colour bits: a hidden entry has none), then the body's table `a` gets the target HIDDEN (the shape-hide bits, as setRegionHidden / child.visible=false would write, but only in this table).
// The laser, the points and the occlusion tests read these tables, so they follow the body at once.
// result table: texel i = result i, rgba; a = colour slot bits (0..3) | hidden slot bits (8..11) (region-visibility.js regionLutAlpha). i = 0-based list index, mask = the result's slot bits, colorShown = its colour is on (as the user sees it)
export function patchRegionLut(a, out, i, mask, colorShown) {
  out.set(a);
  const o = (i + 1) * 4;
  if (o + 3 >= a.length) return false;
  out[o + 3] = regionLutAlpha(mask, { shown: !!colorShown });
  a[o + 3] = regionLutAlpha(mask, { hidden: true });
  return true;
}
// child table: 256 x 3 texels (row stride R = 256 * 4 floats), texel j + 1 = child j. Row 0 a = colour slot bits (0 while hidden / colour off), row 1 a = hidden mask. colorOn = the child's colour is on
export function patchChildLut(a, out, j, mask, colorOn, stride = 1024) {
  out.set(a);
  const o = (j + 1) * 4;
  if (o + 3 >= stride) return false;
  out[o + 3] = colorOn ? mask : 0;
  out[stride + o + 3] = 0;
  a[o + 3] = 0;
  a[stride + o + 3] = mask;
  return true;
}
// several parts at once: targets = [{i, mask, colorShown}] (result table) / [{j, mask, colorOn}] (child table). `out` = ONE table for every part (a copy of the normal table in which no part's target is hidden and each target keeps its colour bits:
// every part's box keeps only its own target, so the others' entries do no harm there); the body's table `a` gets every target hidden. Returns how many targets were written.
export function patchRegionLutMany(a, out, targets) {
  out.set(a);
  let n = 0;
  for (const t of targets) {
    const o = (t.i + 1) * 4;
    if (o + 3 >= a.length) continue;
    out[o + 3] = regionLutAlpha(t.mask, { shown: !!t.colorShown });
    a[o + 3] = regionLutAlpha(t.mask, { hidden: true });
    n++;
  }
  return n;
}
export function patchChildLutMany(a, out, targets, stride = 1024) {
  out.set(a);
  let n = 0;
  for (const t of targets) {
    const o = (t.j + 1) * 4;
    if (o + 3 >= stride) continue;
    out[o + 3] = t.colorOn ? t.mask : 0;
    out[stride + o + 3] = 0;
    a[o + 3] = 0;
    a[stride + o + 3] = t.mask;
    n++;
  }
  return n;
}
// does any entry of the (part's) result table hide a shape? -> 1 / 0 (the uniform regionAnyHidden: the shader reads regionHiddenAt only then)
export function anyHiddenIn(a, count, shift = 8) {
  for (let i = 1; i <= count && i < 256 && 4 * i + 3 < a.length; i++) if ((Math.round(a[4 * i + 3]) >> shift) & 15) return 1;
  return 0;
}

// the hide index plane (G) of an RG8 index (vr-volume-prep.js packIndexRg: rg[2 i] = R colour index, rg[2 i + 1] = G hide index): the bytes the part's box, its laser rule and the shader's part test all go by
export function hideIndexPlane(rg) {
  if (!rg) return null;
  const n = rg.length >> 1, out = new Uint8Array(n);
  for (let i = 0, o = 1; i < n; i++, o += 2) out[i] = rg[o];
  return out;
}

// ---- the part's own box. ids = the index texture's bytes (x fastest, then y, then z; dims [w, h, d]), id = the target's value; the box covers its voxels plus `pad` voxels (the trilinear footprint of a surface sample).
// -> {c: [3], h: [3], count, full} in object space (vr-content-box.js boxFromRange: the data box half extents he), or null when no voxel has that id
export function partBoundsOf(ids, dims, id, he, pad = 2) {
  if (!ids || !dims || !he) return null;
  const [w, h, d] = dims;
  let x0 = w, x1 = -1, y0 = h, y1 = -1, z0 = d, z1 = -1, count = 0;
  for (let z = 0; z < d; z++) {
    let zHit = false;
    for (let y = 0, k = w * h * z; y < h; y++, k += w) {
      let first = -1, last = -1;
      for (let x = 0; x < w; x++) if (ids[k + x] === id) { if (first < 0) first = x; last = x; count++; }
      if (first >= 0) { zHit = true; if (first < x0) x0 = first; if (last > x1) x1 = last; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (zHit) { if (z < z0) z0 = z; if (z > z1) z1 = z; }
  }
  if (!count) return null;
  const lo = [Math.max(0, x0 - pad) / w, Math.max(0, y0 - pad) / h, Math.max(0, z0 - pad) / d], hi = [Math.min(w, x1 + 1 + pad) / w, Math.min(h, y1 + 1 + pad) / h, Math.min(d, z1 + 1 + pad) / d];
  const b = boxFromRange(he, lo, hi, { c: [0, 0, 0], h: [0, 0, 0] });
  return { c: b.c, h: b.h, count, full: !!b.full };
}

// the box a part's proxy geometry (the box the GPU rasterises: its rays, its composite) is drawn on: the content box grown by `pad` voxels of the data grid on every side (the composite's bilinear upscale reaches a texel past the silhouette), clamped to
// the data box. box = {c, h} (partBoundsOf), he = the data box half extents, dims = the grid. -> {c, h} in object space. The proxy is NOT the full data box (a part covering a few pixels must not run a ray for every pixel the whole body covers).
export function partProxyBox(box, he, dims, pad = 4) {
  const c = [0, 0, 0], h = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const v = 2 * he[a] / dims[a], lo = Math.max(-he[a], box.c[a] - box.h[a] - pad * v), hi = Math.min(he[a], box.c[a] + box.h[a] + pad * v);
    c[a] = (lo + hi) / 2; h[a] = (hi - lo) / 2;
  }
  return { c, h };
}
// where a ray (o + q t, object space) is inside a box {c, h}: [t0, t1] (t0 >= 0), or null. The part's laser march runs only there (vr-pick.js marchClassificationHitInfo tMin / tMax).
export function partRayRange(o, q, box) {
  let t0 = 0, t1 = Infinity;
  const O = [o.x, o.y, o.z], Q = [q.x, q.y, q.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(Q[a]) < 1e-12) { if (Math.abs(O[a] - box.c[a]) > box.h[a]) return null; continue; }
    const ta = (box.c[a] - box.h[a] - O[a]) / Q[a], tb = (box.c[a] + box.h[a] - O[a]) / Q[a];
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  return t0 <= t1 ? [t0, t1] : null;
}

// ---- the laser's rule on the CPU (the shader's rule: a voxel that is not the part is no tissue; vr-pick.js marchClassificationHitInfo skipVoxel). ids / idims = the index texture; cdims = the classification grid the march runs on
// (the same grid in practice; when they differ the voxel is mapped by position). chan = the classification channel of each slot (cls.chan). -> (x, y, z, c) -> true when the voxel of channel c is NOT part of the part
export function partKeepVoxelOf({ ids, idims, cdims, id, mask, chan }) {
  if (!ids || !idims || !cdims) return null;
  const slotOf = new Int8Array(8).fill(-1);
  (chan || []).forEach((c, sl) => { if (c >= 0 && c < 8) slotOf[c] = sl; });
  const [w, h] = idims, same = idims[0] === cdims[0] && idims[1] === cdims[1] && idims[2] === cdims[2];
  const sx = idims[0] / cdims[0], sy = idims[1] / cdims[1], sz = idims[2] / cdims[2];
  return (x, y, z, c) => {
    const ix = same ? x : Math.min(idims[0] - 1, Math.floor((x + 0.5) * sx)), iy = same ? y : Math.min(idims[1] - 1, Math.floor((y + 0.5) * sy)), iz = same ? z : Math.min(idims[2] - 1, Math.floor((z + 0.5) * sz));
    if (ids[ix + w * (iy + h * iz)] !== id) return true;
    const sl = slotOf[c];
    return sl < 0 || ((mask >> sl) & 1) === 0;
  };
}

// ---- the texts (this prototype keeps them here, not in the i18n table)
export const PART_TEXT = Object.freeze({
  ja: { restore: 'すべて元に戻す', pairBusy: '並べて表示中は切り出せません', preparing: '切り出しを準備中…', done: '切り出しました。握って動かせます', back: '元に戻しました', failed: '切り出せませんでした', busy: '切り出し中です。少し待ってください',
    ringDetach: '切り出す', ringRegionDetach: '領域の切り出す', ringChildDetach: '子の切り出す', ringBack: '戻す' },
  en: { restore: 'Put all back', pairBusy: 'Not while a pair is shown', preparing: 'Preparing the cut-out...', done: 'Cut out. Grab it to move it', back: 'Put back', failed: 'Could not cut it out', busy: 'Cutting out, please wait',
    ringDetach: 'Cut out', ringRegionDetach: 'Region cut out', ringChildDetach: 'Child cut out', ringBack: 'Put back' },
});

// ---- where the button sits (menu canvas px, the header row y 18..90: the title 'Virtual Rodent Lab' ends near x 400, 「閉じる」 starts at 780): between them, on every page of the menu
export const PART_BTN_X = 412, PART_RESTORE_W = 360; // 412 + 360 = 772
// a part that was just cut out comes this far toward the viewer (world metres) and glides there in PART_ANIM_MS
export const PART_OUT_M = 0.05, PART_ANIM_MS = 300;
