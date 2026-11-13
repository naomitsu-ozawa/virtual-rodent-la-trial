// (first prototype): a region / child segment taken OUT of the body and moved freely (VR / AR only). Pure: no DOM, no three.js, no app state (unit-tested: tests/unit/vr-part-view.test.js).
// docs/vr-view.js owns the GPU side (the `part` block of startVrView); this module holds the rules it applies:
//   - the method (Issue 案A): the same textures are drawn a second time in another box (the part's own pose), where everything but the target is "not tissue" (PART_GLSL, compiled only with VRL_PART);
//     the body's own draw is NOT changed: the target is hidden in the body by patching the look-up tables AFTER they were written (patchRegionLut / patchChildLut) -- a run-time overlay like the stick's colour-off,
//     region.hidden / child.visible (saved in the project, shown on the 表示 buttons) are never written,
//   - which uniforms the part owns (the rest is the body's by reference: PART_OWN), the target a grip takes (partTargetOf), the part's own box (partBoundsOf), the laser's rule on the CPU (partKeepVoxelOf),
//   - several parts at once: every part has its own box, uniforms and pose; the tables are patched for all of them (patchRegionLutMany / patchChildLutMany); a part's proxy box is its own bounding box (partProxyBox) and its laser march
//     runs only inside it (partRayRange), the texts. The way in is the long-press ring (region-ring.js 切り出す / 戻す); the grip stays the body's grab and takes a part only where the laser meets one.
import { regionLutAlpha } from './region-visibility.js?v=20261113-build734';
import { boxFromRange } from './vr-content-box.js?v=20261113-build734';

export const PART_GLSL = `
// ==== DETACHED PART: compiled only with VRL_PART (the parts' boxes, and the body while a part is out; never otherwise) ====
#ifdef VRL_PART
#ifdef VRL_HIDE
#define VRL_PART_HIDE
#endif
uniform int partKind; // 0 = the body while parts are out, 1 = a result's part, 2 = a child segment's part
uniform int partId;
uniform int partMask;
// the field of the cut (vr-part-view.js partFieldOf, read LINEAR, 0.5 = the cut; outside its box 0; partFieldSet): slot s is cut where min over the channels of partFieldA[s] * texel + partFieldB[s] is >= 0.5 (one read, the
// channels by products, no branch). The body: one channel per group of slots the same parts have (a = 1 on slot s's, b = 1 on the others; a = b = 0: no part has slot s, never cut). A part, on its own box: the same field
// on its slots (a part alone: its own field; parts that touch: their joint field J, the body's bytes, so the body and the parts meet on the same numbers) and its share of it where it touches other parts (the seams:
// 1 - S on one side, S on the other, the same numbers again); a = b = 0 on a slot that is not its own
uniform sampler3D partField;
uniform vec3 partFieldScale;
uniform vec3 partFieldOff;
uniform vec4 partFieldA[4];
uniform vec4 partFieldB[4];
uniform sampler3D partOcc; // n731 perf 案②: per 8x8x8 cells of partField, 0 = no point of them is in the part (partOccOf); read by the parts' rays only (partKind != 0)
float partFieldAt(vec3 tc,vec4 a,vec4 b){vec3 u=tc*partFieldScale+partFieldOff;if(any(lessThan(u,vec3(0.0)))||any(greaterThan(u,vec3(1.0))))return 0.0;vec4 m=texture(partField,u)*a+b;return min(min(m.x,m.y),min(m.z,m.w));}
bool partFieldIn(vec3 tc,int s){return partFieldAt(tc,partFieldA[s],partFieldB[s])>=0.5;}
#ifdef VRL_REGIONS
bool regionHiddenAtP(vec3 tc,int s){ // one read each of the field, the index and the table (the compiler inlines this at every hidden test: one copy of each keeps the programs as quick to compile); a result's part leaves at once outside its field
 bool f=partKind!=2&&partFieldIn(tc,s);
 if(partKind==1&&!f)return true; // outside its share of the field
 int i=int(texture(regionTex,clamp(tc,vec3(0.0),vec3(0.999999))).g*255.0+0.5);
 int a=i<1?0:int(texelFetch(regionLut,ivec2(i,0),0).a+0.5);
 bool h=((a>>(8+s))&1)==1; // regionHiddenAt: a hidden result (slot s)
 if(partKind!=0)return h;
 if(((a>>16)&1)==1)return f; // a cut-out result (vr-part-view.js PART_CUT_REGION_BIT): the field of slot s decides, not its voxels
#ifndef VRL_CHILDREN
 if(f)return true; // the cut reaching into a neighbour's voxel (with child segments: childHiddenAtP, read first by every caller)
#endif
 return h;
}
#define regionHiddenAt(tc,s) regionHiddenAtP(tc,s)
#endif
#ifdef VRL_CHILDREN
bool childHiddenAtP(vec3 tc,int s){ // as regionHiddenAtP: one read each, a child's part leaves at once outside its field
 bool f=partKind!=1&&partFieldIn(tc,s);
 if(partKind==2&&!f)return true;
 int i=childHideIdAt(tc);
 int a=i<1?0:int(texelFetch(childLut,ivec2(i,1),0).a+0.5);
 bool h=((a>>s)&1)==1; // childHiddenAt: a hidden child (slot s)
 if(partKind!=0)return h;
 if(((a>>8)&1)==1)return f; // a cut-out child (PART_CUT_CHILD_BIT), as the results'
 return f||h; // the cut reaching into a neighbour's voxel
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
export const PART_EXTRA = Object.freeze(['partKind', 'partId', 'partMask', 'partField', 'partFieldScale', 'partFieldOff', 'partFieldA', 'partFieldB', 'partOcc']);
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
export function partOwnRegionLut(out, i, dst) {
  dst.set(out);
  const o = (i + 1) * 4;
  if (o + 3 >= out.length) return false;
  for (let k = 1; k * 4 + 3 < out.length && k < 256; k++) { dst[k * 4] = out[o]; dst[k * 4 + 1] = out[o + 1]; dst[k * 4 + 2] = out[o + 2]; dst[k * 4 + 3] = out[o + 3]; }
  return true;
}
// child table: 3 rows of `stride` floats (row 0 colour + slot bits, row 1 range / flat mask / hidden mask, row 2 material + opacity); every entry of every row becomes the part's entry
// the OTHER kind's table of a part (re-review): a copy of the shared one that keeps only what is hidden: a child part's result table keeps each result's hidden bits (8..11) and loses its colour / focus (0..4) and
// cut (16) bits; a result part's child table keeps each child's hidden bits (row 1 alpha) and loses its colour / material (row 0 slot bits) and flat mode (row 1 blue). So what is hidden stays hidden inside the part,
// and no neighbour's colour or material reaches its cut
export function partHideOnlyRegionLut(out, dst) {
  dst.set(out);
  for (let k = 1; k * 4 + 3 < dst.length && k < 256; k++) dst[k * 4 + 3] = Math.round(dst[k * 4 + 3]) & 0xf00;
}
export function partHideOnlyChildLut(src, dst, stride = 1024) {
  dst.set(src);
  for (let k = 1; k * 4 + 3 < stride && k < 256; k++) { dst[k * 4 + 3] = 0; if (stride + k * 4 + 2 < dst.length) dst[stride + k * 4 + 2] = 0; }
}
export function partOwnChildLut(out, j, dst, stride = 1024) {
  dst.set(out);
  const o = (j + 1) * 4;
  if (o + 3 >= stride) return false;
  for (let r = 0; r < 3; r++) for (let k = 1; k * 4 + 3 < stride && k < 256; k++) for (let c = 0; c < 4; c++) dst[r * stride + k * 4 + c] = out[r * stride + o + c];
  return true;
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
  return { c: b.c, h: b.h, count, full: !!b.full, vox: { lo: [x0, y0, z0], hi: [x1, y1, z1] } };
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

export const PART_FIELD = Object.freeze({ band: 3, sigma: 2, margin: 0.15, pad: 5 });
// the part's voxel box on the index grid: its bounding box grown by pad voxels, clamped. -> {lo: [x, y, z], size: [w, h, d]} | null (no voxel)
// the same from the voxel range partBoundsOf found (vox: {lo, hi}, inclusive): no second scan of the grid
export function partFieldBoxOf(vox, dims, pad = PART_FIELD.pad) {
  if (!vox || !dims) return null;
  const lo = [0, 1, 2].map(a => Math.max(0, vox.lo[a] - pad)), hi = [0, 1, 2].map(a => Math.min(dims[a] - 1, vox.hi[a] + pad));
  return { lo, size: [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1] };
}
export function partFieldBox(ids, dims, id, pad = PART_FIELD.pad) {
  if (!ids || !dims) return null;
  const [w, h, d] = dims;
  let x0 = w, x1 = -1, y0 = h, y1 = -1, z0 = d, z1 = -1;
  for (let z = 0, k = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, k++) if (ids[k] === id) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  if (x1 < 0) return null;
  const lo = [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.max(0, z0 - pad)], hi = [Math.min(w - 1, x1 + pad), Math.min(h - 1, y1 + pad), Math.min(d - 1, z1 + pad)];
  return { lo, size: [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1] };
}
// the codes of the box (x fastest): 1 = the part (ids == id), 2 = a voxel that may be its skin (hide index 0 and air on every slot of the part: airAt(x, y, z) on the index grid; null = no skin), 0 = anything else
export function partFieldCodes(ids, dims, id, box, airAt) {
  const [w, h] = dims, [bw, bh, bd] = box.size, [lx, ly, lz] = box.lo, out = new Uint8Array(bw * bh * bd);
  for (let z = 0, o = 0; z < bd; z++) for (let y = 0; y < bh; y++) {
    const k = lx + w * (ly + y + h * (lz + z));
    for (let x = 0; x < bw; x++, o++) { const v = ids[k + x]; out[o] = v === id ? 1 : v === 0 && airAt && airAt(lx + x, ly + y, lz + z) ? 2 : 0; }
  }
  return out;
}
// the same, a few planes at a time with a task between them (the frames go on while a large part's codes are made): -> Promise of the codes (the bytes partFieldCodes gives)
export async function partFieldCodesAsync(ids, dims, id, box, airAt, planesPerTask = 8) {
  const [w, h] = dims, [bw, bh, bd] = box.size, [lx, ly, lz] = box.lo, out = new Uint8Array(bw * bh * bd), step = Math.max(1, planesPerTask | 0);
  for (let z0 = 0; z0 < bd; z0 += step) {
    if (z0) await new Promise(r => setTimeout(r, 0));
    for (let z = z0, o = z0 * bw * bh; z < Math.min(bd, z0 + step); z++) for (let y = 0; y < bh; y++) {
      const k = lx + w * (ly + y + h * (lz + z));
      for (let x = 0; x < bw; x++, o++) { const v = ids[k + x]; out[o] = v === id ? 1 : v === 0 && airAt && airAt(lx + x, ly + y, lz + z) ? 2 : 0; }
    }
  }
  return out;
}
// the field bytes of the box from its codes (partFieldCodes), size = [w, h, d]. Self-contained (it also runs in a worker from its source text: no reference outside its body).
//  1. inside = the part + its skin (a code-2 voxel with a 26-neighbour of code 1);
//  2. signed distance sd (voxels, + inside) to the other side: a two-pass 3x3x3 chamfer from voxel centre to voxel centre, minus half a voxel (two face neighbours on either side: +-0.5, the voxel face between them = 0), within +-band;
//  3. one smoothing step: sd -> 2 G(sd) - G(G(sd)) (G: separable Gaussian, sigma; the "twice" form removes the shrink a plain blur gives a curved surface), damped where it is coherent (rho, below: a rod, a plate,
//     a gap keep their place), then every voxel centre held on its side (inside >= margin, outside <= -margin): the surface smoothing's half-voxel constraint;
//  4. byte = 255 (0.5 + sd / (2 band)), inside >= 128 and outside <= 127, so the LINEAR read is exactly the inside / outside of each voxel centre.
// A large box is done in slabs of z planes (opt.budget voxels a slab with its halo, default 8e6): the same bytes, with the memory of a slab.
export function partFieldOf(codes, size, opt) {
  const o = opt || {}, band = o.band || 3, sigma = o.sigma == null ? 2 : +o.sigma, margin = o.margin == null ? 0.15 : +o.margin;
  const w = size[0] | 0, h = size[1] | 0, d = size[2] | 0, wh = w * h, n = wh * d, ins = new Uint8Array(n);
  for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const c = codes[i]; if (c === 1) { ins[i] = 1; continue; } if (c !== 2) continue;
    let near = false;
    for (let dz = -1; dz <= 1 && !near; dz++) { const zz = z + dz; if (zz < 0 || zz >= d) continue; for (let dy = -1; dy <= 1 && !near; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; if (codes[xx + w * (yy + h * zz)] === 1) { near = true; break; } } } }
    if (near) ins[i] = 1;
  }
  const BIG = band + 2, S2 = Math.SQRT2, S3 = Math.sqrt(3), off = [], wt = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = dx + 3 * (dy + 3 * dz); if (k >= 0) continue; const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz); off.push(dx, dy, dz); wt.push(m === 1 ? 1 : m === 2 ? S2 : S3); }
  // the three box radii of a Gaussian of sigma sg (Kovesi, "Fast almost-Gaussian filtering")
  const radiiOf = sg => { const wi = Math.sqrt(4 * sg * sg + 1); let wl = Math.floor(wi); if (wl % 2 === 0) wl--; const mI = Math.round((12 * sg * sg - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4)); return [0, 1, 2].map(i => ((i < mI ? wl : wl + 2) - 1) >> 1); };
  const rA = sigma > 0 ? radiiOf(sigma) : [], rB = sigma > 0 ? radiiOf(2 * sigma) : [], sum = r => r.reduce((t, v) => t + v, 0);
  // how far (planes) a voxel's byte depends on its neighbours: the chamfer within the band (a seed nearer than band + 0.5), G twice, then the coherence's wider G. A slab of planes computed with this many more on either
  // side gives its own planes exactly as the whole box would (the box edges stay the box edges: a clamped edge is only ever a true one for the planes kept)
  const halo = Math.ceil(band + 1) + 2 * sum(rA) + sum(rB);
  // the slabs: the whole box when it is small, else slabs of z planes with the halo (memory: about 17 bytes per voxel of a slab, instead of the box)
  const budget = o.budget > 0 ? o.budget : 8e6, K = n <= budget ? d : Math.max(1, Math.floor(budget / wh) - 2 * halo), out = new Uint8Array(n);
  // the slab's arrays, made once for the largest slab and used again by every slab (no garbage left per slab): the distance / sd, and three for the smoothing
  const mMax = wh * Math.min(d, K + 2 * halo), S = new Float32Array(mMax), X = new Float32Array(mMax), Y = sigma > 0 ? new Float32Array(mMax) : null, Z = sigma > 0 ? new Float32Array(mMax) : null;
  const rMax = Math.max(0, ...rA, ...rB), padL = new Float32Array(w + 2 * rMax + 2), accW = new Float64Array(w), pl = new Float32Array(wh), ring = new Float32Array((rMax + 1) * wh), acc = new Float64Array(wh);
  for (let z0 = 0; z0 < d; z0 += K) {
    const z1 = Math.min(d, z0 + K), e0 = Math.max(0, z0 - halo), e1 = Math.min(d, z1 + halo), sd_ = e1 - e0, m = wh * sd_, sIns = ins.subarray(e0 * wh, e1 * wh);
    // chamfer distance (centre to centre) to the nearest voxel of the given side: 0 on it, then the forward half of the 3x3x3 neighbourhood in raster order, the backward half in reverse
    const offL = []; for (let q = 0, p = 0; q < wt.length; q++, p += 3) offL.push(off[p] + w * (off[p + 1] + h * off[p + 2]));
    const chamfer = (side, dist) => {
      for (let i = 0; i < m; i++) dist[i] = sIns[i] === side ? 0 : BIG;
      for (let fw = 1; fw >= -1; fw -= 2) for (let zi = 0; zi < sd_; zi++) { const z = fw > 0 ? zi : sd_ - 1 - zi, zIn = z > 0 && z < sd_ - 1; for (let yi = 0; yi < h; yi++) { const y = fw > 0 ? yi : h - 1 - yi, yIn = zIn && y > 0 && y < h - 1; for (let xi = 0; xi < w; xi++) {
        const x = fw > 0 ? xi : w - 1 - xi, i = x + w * (y + h * z); let mm = dist[i]; if (mm === 0) continue;
        if (yIn && x > 0 && x < w - 1) { for (let q = 0; q < wt.length; q++) { const v = dist[i + fw * offL[q]] + wt[q]; if (v < mm) mm = v; } }
        else for (let q = 0, p = 0; q < wt.length; q++, p += 3) {
          const xx = x + fw * off[p], yy = y + fw * off[p + 1], zz = z + fw * off[p + 2];
          if (xx < 0 || xx >= w || yy < 0 || yy >= h || zz < 0 || zz >= sd_) continue;
          const v = dist[xx + w * (yy + h * zz)] + wt[q]; if (v < mm) mm = v;
        }
        dist[i] = mm;
      } } }
      return dist;
    };
    const sd = chamfer(1, S.subarray(0, m));
    { const toOut = chamfer(0, X.subarray(0, m)); for (let i = 0; i < m; i++) { const v = sIns[i] ? Math.min(toOut[i], BIG) - 0.5 : 0.5 - Math.min(sd[i], BIG); sd[i] = Math.max(-band, Math.min(band, v)); } }
    // a Gaussian (sigma sg, clamped edges) as three box filters per axis (running sums: the cost does not grow with sg), IN PLACE; along y and z all the lines of a plane / of the slab advance together (memory in order)
    const gauss = (a, radii) => {
      for (const r of radii) {
        if (r <= 0) continue;
        const inv = 1 / (2 * r + 1);
        const O = r + 1; // x: the row copied with its clamped ends (r + 1 copies of the first value before it, r + 1 of the last after), so that the running sum reads no bound test: the same values, the same order
        for (let base = 0; base < m; base += w) {
          const f0 = a[base], f1 = a[base + w - 1];
          for (let t = 0; t < O; t++) { padL[t] = f0; padL[O + w + t] = f1; }
          for (let t = 0; t < w; t++) padL[O + t] = a[base + t];
          let acc = 0; for (let t = -r; t <= r; t++) acc += padL[O + t];
          for (let t = 0; t < w; t++) { a[base + t] = acc * inv; acc += padL[O + t + r + 1] - padL[O + t - r]; }
        }
        for (let z = 0; z < sd_; z++) { // y
          const P = z * wh; pl.set(a.subarray(P, P + wh)); accW.fill(0);
          for (let t = -r; t <= r; t++) { const R = (t < 0 ? 0 : t >= h ? h - 1 : t) * w; for (let x = 0; x < w; x++) accW[x] += pl[R + x]; }
          for (let t = 0; t < h; t++) { const add = t + r + 1, sub = t - r, A = (add >= h ? h - 1 : add) * w, S = (sub < 0 ? 0 : sub) * w, T = P + t * w; for (let x = 0; x < w; x++) { a[T + x] = accW[x] * inv; accW[x] += pl[A + x] - pl[S + x]; } }
        }
        acc.fill(0); // z: ring = the last r + 1 planes as they were
        for (let t = -r; t <= r; t++) { const P = (t < 0 ? 0 : t >= sd_ ? sd_ - 1 : t) * wh; for (let i = 0; i < wh; i++) acc[i] += a[P + i]; }
        for (let t = 0; t < sd_; t++) {
          const P = t * wh, Rt = (t % (r + 1)) * wh;
          for (let i = 0; i < wh; i++) { ring[Rt + i] = a[P + i]; a[P + i] = acc[i] * inv; } // the plane as it was goes to the ring as it is overwritten (one pass)
          const add = Math.min(t + r + 1, sd_ - 1), sub = Math.max(t - r, 0), Sb = (sub % (r + 1)) * wh;
          if (add > t) { const A = add * wh; for (let i = 0; i < wh; i++) acc[i] += a[A + i] - ring[Sb + i]; }
          else { const A = (add % (r + 1)) * wh; for (let i = 0; i < wh; i++) acc[i] += ring[A + i] - ring[Sb + i]; }
        }
      }
      return a;
    };
    // the smoothing step and its coherence (constrained-smooth.js rho): delta = Gaussian(sd) - sd; near the surface (|sd| < 1.2) rho = LP(delta) / LP(|delta|) (LP: a wider Gaussian over those voxels only) is +-1 where the
    // whole neighbourhood moves one way (a rod, a plate, a convex blob shrinking) and about 0 on a staircase (treads and risers move opposite ways). A voxel moving with the coherent direction keeps (1 - |rho|) of its step.
    if (sigma > 0) {
      const g1 = X.subarray(0, m); g1.set(sd); gauss(g1, rA);
      let del = Y.subarray(0, m); del.set(g1); gauss(del, rA); // G(G(sd)), then (below) delta in the same array
      const ab = Z.subarray(0, m); ab.fill(0);
      for (let i = 0; i < m; i++) { g1[i] = 2 * g1[i] - del[i]; if (Math.abs(sd[i]) < 1.2) { del[i] = g1[i] - sd[i]; ab[i] = Math.abs(del[i]); } else del[i] = 0; }
      const lp = gauss(del, rB), lpa = gauss(ab, rB); del = null;
      for (let i = 0; i < m; i++) {
        let dl = g1[i] - sd[i];
        if (lpa[i] > 1e-6) { const rho = Math.max(-1, Math.min(1, lp[i] / lpa[i])); if (dl * rho > 0) dl *= 1 - Math.abs(rho); }
        sd[i] += dl;
      }
    }
    for (let z = z0; z < z1; z++) for (let j = 0, i = (z - e0) * wh, k = z * wh; j < wh; j++, i++, k++) {
      let v = sd[i]; const inn = ins[k]; if (inn) { if (v < margin) v = margin; } else if (v > -margin) v = -margin;
      let b = Math.round(255 * (0.5 + v / (2 * band))); b = b < 0 ? 0 : b > 255 ? 255 : b;
      if (inn) { if (b < 128) b = 128; } else if (b > 127) b = 127;
      out[k] = b;
    }
  }
  return out;
}
// the field on a worker (partFieldOf from its source text; the codes' buffer is transferred) -> Promise of the bytes. No Worker (tests, an old browser): the same function on this thread, after a task.
export const PART_FIELD_TIMEOUT_MS = 120000; // the worker's limit: past it (or on any worker error) the promise is rejected and the caller takes the unsmoothed field
export function runPartField(codes, size, opt = PART_FIELD, timeoutMs = PART_FIELD_TIMEOUT_MS) {
  const local = () => new Promise((res, rej) => setTimeout(() => { try { res(partFieldOf(codes, size, opt)); } catch (e) { rej(e); } }, 0));
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return local();
  let w, url;
  try { url = URL.createObjectURL(new Blob(['const partFieldOf=' + partFieldOf.toString() + ';\nonmessage=e=>{const m=e.data;try{const r=partFieldOf(new Uint8Array(m.codes),m.size,m.opt);postMessage({ok:true,bytes:r.buffer},[r.buffer])}catch(err){postMessage({ok:false,message:String(err&&err.message||err)})}};'], { type: 'text/javascript' })); w = new Worker(url); }
  catch { if (url) URL.revokeObjectURL(url); return local(); }
  const copy = codes.slice(); // the caller keeps its codes (the worker takes the copy's buffer)
  return new Promise((res, rej) => {
    let done = false, timer = 0;
    const end = () => { done = true; clearTimeout(timer); try { w.terminate(); } catch { /* none */ } URL.revokeObjectURL(url); };
    const fail = m => { if (!done) { end(); rej(new Error(m)); } };
    w.onmessage = e => { if (done) return; end(); if (e.data && e.data.ok) res(new Uint8Array(e.data.bytes)); else rej(new Error('part field: ' + (e.data && e.data.message))); };
    w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); fail('part field worker: ' + ((ev && ev.message) || 'error')); };
    w.onmessageerror = () => fail('part field worker: message error');
    timer = setTimeout(() => fail('part field worker: no answer in ' + timeoutMs + ' ms'), timeoutMs);
    try { w.postMessage({ codes: copy.buffer, size: [...size], opt: { band: opt.band, sigma: opt.sigma, margin: opt.margin, budget: opt.budget } }, [copy.buffer]); } catch (e) { fail('part field worker: ' + (e && e.message || e)); }
  });
}
export function runEditMaskField(smooth, data, dims, slots, opt = PART_FIELD, timeoutMs = PART_FIELD_TIMEOUT_MS) {
  const local = () => new Promise((res, rej) => setTimeout(() => { try { const out = data.slice(); smooth(out, dims, slots, opt); res(out); } catch (e) { rej(e); } }, 0));
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return local();
  let w, url;
  try {
    url = URL.createObjectURL(new Blob(['const partFieldOf=' + partFieldOf.toString() + ';\nconst smoothEditMaskOf=' + smooth.toString() + ';\nonmessage=e=>{const m=e.data;try{const d=new Uint8Array(m.data);smoothEditMaskOf(d,m.dims,m.slots,m.opt);postMessage({ok:true,data:d.buffer},[d.buffer])}catch(err){postMessage({ok:false,message:String(err&&err.message||err)})}};'], { type: 'text/javascript' }));
    w = new Worker(url);
  } catch { if (url) URL.revokeObjectURL(url); return local(); }
  const copy = data.slice();
  return new Promise((res, rej) => {
    let done = false, timer = 0;
    const end = () => { done = true; clearTimeout(timer); try { w.terminate(); } catch { /* none */ } URL.revokeObjectURL(url); };
    const fail = m => { if (!done) { end(); rej(new Error(m)); } };
    w.onmessage = e => { if (done) return; end(); if (e.data && e.data.ok) res(new Uint8Array(e.data.data)); else rej(new Error('mask field: ' + (e.data && e.data.message))); };
    w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); fail('mask field worker: ' + ((ev && ev.message) || 'error')); };
    w.onmessageerror = () => fail('mask field worker: message error');
    timer = setTimeout(() => fail('mask field worker: no answer in ' + timeoutMs + ' ms'), timeoutMs);
    try { w.postMessage({ data: copy.buffer, dims: [...dims], slots: slots | 0, opt: { band: opt.band, sigma: opt.sigma, margin: opt.margin, pad: opt.pad, budget: opt.budget } }, [copy.buffer]); } catch (e) { fail('mask field worker: ' + (e && e.message || e)); }
  });
}
// the field without its smoothing (the voxels as they are: 255 = the part + its skin, as partFieldOf's step 1; 0 = the rest), for when the smoothed one could not be made (a worker out of memory on a very large part): the cut works, unsmoothed
export function partFieldPlain(codes, size) {
  const [w, h, d] = size, wh = w * h, out = new Uint8Array(w * h * d);
  for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (codes[i] === 1) { out[i] = 255; continue; }
    if (codes[i] !== 2) continue;
    let near = false;
    for (let dz = -1; dz <= 1 && !near; dz++) { const zz = z + dz; if (zz < 0 || zz >= d) continue; for (let dy = -1; dy <= 1 && !near; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w && codes[xx + w * yy + wh * zz] === 1) { near = true; break; } } } }
    if (near) out[i] = 255;
  }
  return out;
}
// the grouping of partFieldUnion (and of partFieldJoint): slot s -> the parts that have it (a key), equal keys share a channel. -> {list, masks, mask, keys, chOf, nc, C} | null
function partFieldChannels(fields) {
  const list = (fields || []).filter(f => f && f.data && f.lo && f.size);
  if (!list.length) return null;
  const masks = list.map(f => (typeof f.mask === 'number' ? f.mask : 15) & 15), mask = masks.reduce((t, m) => t | m, 0);
  const keyOf = s => masks.map(m => (m >> s) & 1).join(''), keys = [], chOf = [-1, -1, -1, -1];
  for (let s = 0; s < 4; s++) { if (!((mask >> s) & 1)) continue; const k = keyOf(s); let c = keys.indexOf(k); if (c < 0) { c = keys.length; keys.push(k); } chOf[s] = c; }
  const nc = Math.max(1, keys.length);
  return { list, masks, mask, keys, chOf, nc, C: nc === 3 ? 4 : nc };
}
// the body's field: the parts' fields in the box that holds them all, one CHANNEL per group of slots that the same parts have (the larger byte wins where boxes overlap). fields = [{data, lo, size, mask?}] (mask: the part's slots,
// 15 when it does not say) -> {data (C bytes a voxel, interleaved), lo, size, C, sel, mask} | null. sel[s] = the shader's partFieldSel[s] (one-hot [4] on slot s's channel; zeros when no part has slot s), mask = the slots some part has.
// Every part with the same slots (the usual case): C = 1, the bytes are the larger byte of all, as before. Parts with different slots (a result and a child segment): a channel for each group, so that a part's field hides only
// its own slots (the tissue of another slot in its band stays the body's: no part draws it) and every slot a part has is cut smoothly. Channels 3 are stored as 4 (no 3-byte 3D texture).
export function partFieldUnion(fields, skip) {
  const g = partFieldChannels(fields);
  if (!g) return null;
  const { list, mask, keys, chOf, C } = g;
  const sel = [0, 1, 2, 3].map(s => [0, 1, 2, 3].map(c => (chOf[s] === c ? 1 : 0)));
  const lo = [0, 1, 2].map(a => Math.min(...list.map(f => f.lo[a]))), hi = [0, 1, 2].map(a => Math.max(...list.map(f => f.lo[a] + f.size[a])));
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  // one part, one channel, its own box: its field IS the union (the same bytes, not a second copy of them in memory)
  if (!skip && list.length === 1 && C === 1 && size.every((v, a) => v === list[0].size[a])) return { data: list[0].data, lo, size, C, sel, mask };
  const data = new Uint8Array(size[0] * size[1] * size[2] * C);
  list.forEach((f, p) => {
    const chs = keys.map((k, c) => (k[p] === '1' && !(skip && skip.has(p + '|' + c)) ? c : -1)).filter(c => c >= 0);
    if (!chs.length) return;
    partFieldPutMax(data, size, C, chs, f.data, f.lo, f.size, lo);
  });
  return { data, lo, size, C, sel, mask };
}
// the bytes of a box (src, 1 byte a voxel, at srcLo, srcSize) into the channels chs of a union (data: C bytes a voxel over size, at lo), the larger byte wins
function partFieldPutMax(data, size, C, chs, src, srcLo, srcSize, lo) {
  const [fw, fh, fd] = srcSize, ox = srcLo[0] - lo[0], oy = srcLo[1] - lo[1], oz = srcLo[2] - lo[2];
  for (let z = 0; z < fd; z++) for (let y = 0; y < fh; y++) {
    const s0 = fw * (y + fh * z), o = (ox + size[0] * (oy + y + size[1] * (oz + z))) * C;
    for (const c of chs) for (let x = 0, q = o + c; x < fw; x++, q += C) { const v = src[s0 + x]; if (v > data[q]) data[q] = v; }
  }
}
const partBoxesMeet = (a, b) => [0, 1, 2].every(k => a.lo[k] <= b.lo[k] + b.size[k] && b.lo[k] <= a.lo[k] + a.size[k]);
function partFieldTouching(list, members, near) {
  const par = members.map((_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) if (partBoxesMeet(list[members[i]], list[members[j]]) && (!near || near(members[i], members[j]))) par[find(i)] = find(j);
  const gr = new Map(); members.forEach((p, i) => { const r = find(i); if (!gr.has(r)) gr.set(r, []); gr.get(r).push(p); });
  return [...gr.values()];
}
const partIsChild = f => f.kind === 'child' || f.kind === 2;
// the decision order of a group: the smallest-last order of the graph of meeting boxes (the part with the fewest neighbours left goes LAST, again and again; equal: the later in `fields` goes last), so every part has as few
// earlier neighbours as the graph allows
function partSeamOrder(list, gr) {
  const left = [...gr], out = [];
  while (left.length) {
    let best = -1, bd = Infinity;
    left.forEach((p, i) => { const dg = left.filter(q => q !== p && partBoxesMeet(list[p], list[q])).length; if (dg < bd || (dg === bd && p > left[best])) { bd = dg; best = i; } });
    out.unshift(left[best]); left.splice(best, 1);
  }
  return out;
}
// the groups of touching parts (of two or more) in all the channels of the union of `fields`, each in its decision order: [{channel, parts}]. [] = no seam to make. Without `near`: the boxes only (the rule a caller that has no bytes uses)
export function partFieldJointGroups(fields, near) {
  const g = partFieldChannels(fields); if (!g) return [];
  const out = [];
  g.keys.forEach((k, c) => {
    const members = g.list.map((_, p) => p).filter(p => k[p] === '1');
    if (members.length > 1) for (const gr of partFieldTouching(g.list, members, near)) if (gr.length > 1) out.push({ channel: c, parts: partSeamOrder(g.list, gr) }); // the order counts the neighbours by their boxes (a part reads the seam of every earlier part whose box meets its own, near or not)
  });
  return out;
}
// a box of 0 / 1 (fw x fh x fd) grown by r voxels along every axis (the cube of radius r around each voxel > 0): three passes of a sliding count
export function partFieldDilate(m, fw, fh, fd, r) {
  const nf = fw * fh * fd; let a = new Uint8Array(nf), b = new Uint8Array(nf); const pre = new Int32Array(Math.max(fw, fh, fd) + 1);
  for (let i = 0; i < nf; i++) a[i] = m[i] > 0 ? 1 : 0;
  for (let z = 0; z < fd; z++) for (let y = 0; y < fh; y++) { const o = fw * (y + fh * z); for (let x = 0; x < fw; x++) pre[x + 1] = pre[x] + a[o + x]; for (let x = 0; x < fw; x++) b[o + x] = pre[Math.min(fw, x + r + 1)] - pre[Math.max(0, x - r)] > 0 ? 1 : 0; }
  for (let z = 0; z < fd; z++) for (let x = 0; x < fw; x++) { const o = x + fw * fh * z; for (let y = 0; y < fh; y++) pre[y + 1] = pre[y] + b[o + fw * y]; for (let y = 0; y < fh; y++) a[o + fw * y] = pre[Math.min(fh, y + r + 1)] - pre[Math.max(0, y - r)] > 0 ? 1 : 0; }
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { const o = x + fw * y, st = fw * fh; for (let z = 0; z < fd; z++) pre[z + 1] = pre[z] + a[o + st * z]; for (let z = 0; z < fd; z++) b[o + st * z] = pre[Math.min(fd, z + r + 1)] - pre[Math.max(0, z - r)] > 0 ? 1 : 0; }
  return b;
}
// do two parts' fields reach each other: is there a voxel in both boxes that lies within r (a cube) of the inside of both (a field is > 0 within PART_FIELD.pad of its part's inside: its box holds nothing outside that)? Parts whose
// boxes meet but whose fields do not reach each other need no joint field and no seam: they do not touch. -> near(a, b) for indices of `list` ({data (>= 128: the inside), lo, size}), each part's grown inside made once
export function partFieldNearOf(list, r) {
  const dil = new Map(), memo = new Map();
  const dilOf = p => { let d = dil.get(p); if (!d) { const f = list[p], nf = f.size[0] * f.size[1] * f.size[2], ins = new Uint8Array(nf); for (let i = 0; i < nf; i++) ins[i] = f.data[i] >= 128 ? 1 : 0; d = partFieldDilate(ins, f.size[0], f.size[1], f.size[2], r); dil.set(p, d); } return d; };
  return (a, b) => {
    const key = a < b ? a + '|' + b : b + '|' + a; if (memo.has(key)) return memo.get(key);
    const fa = list[a], fb = list[b], lo = [0, 1, 2].map(k => Math.max(fa.lo[k], fb.lo[k])), hi = [0, 1, 2].map(k => Math.min(fa.lo[k] + fa.size[k], fb.lo[k] + fb.size[k]));
    let hit = false;
    if (hi.every((h, k) => h > lo[k])) {
      const da = dilOf(a), db = dilOf(b);
      for (let z = lo[2]; z < hi[2] && !hit; z++) for (let y = lo[1]; y < hi[1] && !hit; y++) {
        const ia = fa.size[0] * (y - fa.lo[1] + fa.size[1] * (z - fa.lo[2])) - fa.lo[0], ib = fb.size[0] * (y - fb.lo[1] + fb.size[1] * (z - fb.lo[2])) - fb.lo[0];
        for (let x = lo[0]; x < hi[0]; x++) if (da[ia + x] && db[ib + x]) { hit = true; break; }
      }
    }
    memo.set(key, hit); return hit;
  };
}
// which parts need their OWN smoothed field: those that are alone on some channel they have (a part in a group on every channel it has is cut by the group's joint field and seams: partFieldSet). Only the boxes, the slots and the kinds
// are read. fields = [{lo, size, mask, kind}] -> [bool] (one for each part that has a lo and a size, in order)
export function partFieldNeedsOwn(fields) {
  const fs = (fields || []).filter(f => f && f.lo && f.size).map(f => ({ lo: f.lo, size: f.size, mask: f.mask, kind: f.kind, data: 1 })), g = partFieldChannels(fs);
  if (!g) return [];
  const inGroup = g.list.map(() => new Set()); for (const { channel, parts } of partFieldJointGroups(fs)) for (const p of parts) inGroup[p].add(channel);
  return g.list.map((_, p) => [0, 1, 2, 3].some(s => ((g.masks[p] >> s) & 1) && !inGroup[p].has(g.chOf[s])));
}
// the joint field and the seams of one group (self-contained but for partFieldOf: it runs in a worker from the source text of both). lab = the group's box (x fastest), 0 = outside every part, k = part k (1-based, the
// decision order). -> {J, S: [S_1 .. S_(n-1)]} (bytes over the box, as partFieldOf's)
export function partGroupFieldsOf(lab, size, n, opt) {
  const J = partGroupJointOf(lab, size, opt), S = [];
  for (let k = 1; k < n; k++) S.push(partGroupSeamOf(lab, size, k, opt));
  return { J, S };
}
// the two halves of partGroupFieldsOf, each a task of its own (partGroupFieldsOf is their sum: the same bytes): J, the field of the inside of any part; S_k, the field of "the nearest of the parts k..n is part k"
export function partGroupJointOf(lab, size, opt) {
  const N = (size[0] | 0) * (size[1] | 0) * (size[2] | 0), codes = new Uint8Array(N);
  for (let i = 0; i < N; i++) codes[i] = lab[i] ? 1 : 0;
  return partFieldOf(codes, size, opt);
}
// the voxels whose nearest of the parts k..n is part k (1 / 0): S_k's own voxels, before their smoothing (the byte of S_k is >= 128 exactly there, partFieldOf's rule)
export function partGroupLabelOf(lab, size, k) {
  const w = size[0] | 0, h = size[1] | 0, d = size[2] | 0, N = w * h * d, codes = new Uint8Array(N);
  // the nearest of the parts k..n for every voxel: a two-pass 3x3x3 chamfer from their voxels, carrying the part (an equal distance keeps the one found first)
  // n731 perf (the labels are the longest tasks of a group): the same arithmetic in the same order, with the neighbours of a voxel by index offsets (no bound test) where all 26 neighbours are inside the box, and the bounds tested only on the box's faces
  const dist = new Float32Array(N), nl = new Uint8Array(N), off = [], wt = [], di = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = dx + 3 * (dy + 3 * dz); if (q >= 0) continue; const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz); off.push(dx, dy, dz); di.push(dx + w * (dy + h * dz)); wt.push(m === 1 ? 1 : m === 2 ? Math.SQRT2 : Math.sqrt(3)); }
  const nq = wt.length;
  for (let i = 0; i < N; i++) { const l = lab[i]; if (l >= k) { dist[i] = 0; nl[i] = l; } else { dist[i] = 1e9; nl[i] = 0; } }
  for (let fw = 1; fw >= -1; fw -= 2) for (let zi = 0; zi < d; zi++) { const z = fw > 0 ? zi : d - 1 - zi; for (let yi = 0; yi < h; yi++) { const y = fw > 0 ? yi : h - 1 - yi, rowIn = z > 0 && z < d - 1 && y > 0 && y < h - 1; for (let xi = 0; xi < w; xi++) {
    const x = fw > 0 ? xi : w - 1 - xi, i = x + w * (y + h * z); let mm = dist[i], ml = nl[i]; if (mm === 0) continue;
    if (rowIn && x > 0 && x < w - 1) {
      for (let q = 0; q < nq; q++) { const j = i + fw * di[q], v = dist[j] + wt[q]; if (v < mm) { mm = v; ml = nl[j]; } }
    } else {
      for (let q = 0, p = 0; q < nq; q++, p += 3) {
        const xx = x + fw * off[p], yy = y + fw * off[p + 1], zz = z + fw * off[p + 2];
        if (xx < 0 || xx >= w || yy < 0 || yy >= h || zz < 0 || zz >= d) continue;
        const j = xx + w * (yy + h * zz), v = dist[j] + wt[q]; if (v < mm) { mm = v; ml = nl[j]; }
      }
    }
    dist[i] = mm; nl[i] = ml;
  } } }
  for (let i = 0; i < N; i++) codes[i] = nl[i] === k ? 1 : 0;
  return codes;
}
export function partGroupSeamOf(lab, size, k, opt) { return partFieldOf(partGroupLabelOf(lab, size, k), size, opt); }
// how many planes a byte of partFieldOf depends on its neighbours (the same sum as its `halo`: the chamfer within the band, the Gaussian twice, the coherence's wider Gaussian), and two more: a box of codes cut out of a larger one and grown by
// this on every side gives, inside the part that was not grown, the very bytes of the larger box (the edges of the cut box are not true ones, those of the larger box are). tests/unit/vr-part-set-worker.test.js checks it on shapes
export function partFieldHaloOf(opt) {
  const o = opt || {}, band = o.band || 3, sigma = o.sigma == null ? 2 : +o.sigma;
  const radiiOf = sg => { const wi = Math.sqrt(4 * sg * sg + 1); let wl = Math.floor(wi); if (wl % 2 === 0) wl--; const mI = Math.round((12 * sg * sg - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4)); return [0, 1, 2].map(i => ((i < mI ? wl : wl + 2) - 1) >> 1); };
  const rA = sigma > 0 ? radiiOf(sigma) : [], rB = sigma > 0 ? radiiOf(2 * sigma) : [], sum = r => r.reduce((t, v) => t + v, 0);
  return Math.ceil(band + 1) + 2 * sum(rA) + sum(rB) + 2;
}
// 1 where m > 0 at the voxel or at any of its 26 neighbours inside the box (fw x fh x fd): three passes of the 3-wide maximum
export function partFieldReach(m, fw, fh, fd) {
  const nf = fw * fh * fd, a = new Uint8Array(nf), b = new Uint8Array(nf), fwh = fw * fh;
  for (let i = 0; i < nf; i++) a[i] = m[i] > 0 ? 1 : 0;
  for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) b[i] = a[i] || (x > 0 && a[i - 1]) || (x + 1 < fw && a[i + 1]) ? 1 : 0;
  for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) a[i] = b[i] || (y > 0 && b[i - fw]) || (y + 1 < fh && b[i + fw]) ? 1 : 0;
  for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) b[i] = a[i] || (z > 0 && a[i - fwh]) || (z + 1 < fd && a[i + fwh]) ? 1 : 0;
  return b;
}
// the three tasks of a group as partFieldSet asks for them (ops: joint(lab, size, opt) -> J, label(lab, size, k) -> the voxels of S_k, smooth(codes, size, opt, ctx) -> partFieldOf's bytes), from a `run(lab, size, n, opt) -> {J, S}`
// that makes the whole group at once (partGroupFieldsOf / runPartGroup: the old shape, tests): smooth is then the cut of S_k to the box asked (ctx = {lab, gs, k, lo}), and without ctx (or ctx.own: a part's own field, which the caller keeps: never remembered) the plain partFieldOf
export function partOpsOfRun(run) {
  const memo = new WeakMap(), full = (lab, size, opt) => { let p = memo.get(lab); if (!p) { let n = 2; for (let i = 0; i < lab.length; i++) if (lab[i] > n) n = lab[i]; p = Promise.resolve().then(() => run(lab, size, n, opt)); memo.set(lab, p); } return p; };
  return {
    joint: (lab, size, opt) => full(lab, size, opt).then(r => r.J),
    label: (lab, size, k, opt) => full(lab, size, opt || PART_FIELD).then(r => r.S[k - 1].map(v => (v >= 128 ? 1 : 0))),
    smooth: async (codes, size, opt, ctx) => {
      if (!ctx || ctx.own) return partFieldOf(codes, size, opt);
      const r = await full(ctx.lab, ctx.gs, opt), src = r.S[ctx.k - 1], out = new Uint8Array(size[0] * size[1] * size[2]);
      for (let z = 0, i = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) { const o = ctx.lo[0] + ctx.gs[0] * (ctx.lo[1] + y + ctx.gs[1] * (ctx.lo[2] + z)); for (let x = 0; x < size[0]; x++, i++) out[i] = src[o + x]; }
      return out;
    },
  };
}
// partGroupFieldsOf on a worker (the labels' buffer is transferred) -> Promise of {J, S}. No Worker (tests, an old browser): the same function on this thread, after a task. The worker's limit and failures as runPartField's.
export function runPartGroup(lab, size, n, opt = PART_FIELD, timeoutMs = PART_FIELD_TIMEOUT_MS) {
  const local = () => new Promise((res, rej) => setTimeout(() => { try { res(partGroupFieldsOf(lab, size, n, opt)); } catch (e) { rej(e); } }, 0));
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return local();
  let w, url;
  try { url = URL.createObjectURL(new Blob(['const partFieldOf=' + partFieldOf.toString() + ';\nconst partGroupLabelOf=' + partGroupLabelOf.toString() + ';\nconst partGroupJointOf=' + partGroupJointOf.toString() + ';\nconst partGroupSeamOf=' + partGroupSeamOf.toString() + ';\nconst partGroupFieldsOf=' + partGroupFieldsOf.toString() + ';\nonmessage=e=>{const m=e.data;try{const r=partGroupFieldsOf(new Uint8Array(m.lab),m.size,m.n,m.opt);postMessage({ok:true,J:r.J.buffer,S:r.S.map(s=>s.buffer)},[r.J.buffer,...r.S.map(s=>s.buffer)])}catch(err){postMessage({ok:false,message:String(err&&err.message||err)})}};'], { type: 'text/javascript' })); w = new Worker(url); }
  catch { if (url) URL.revokeObjectURL(url); return local(); }
  const copy = lab.slice();
  return new Promise((res, rej) => {
    let done = false, timer = 0;
    const end = () => { done = true; clearTimeout(timer); try { w.terminate(); } catch { /* none */ } URL.revokeObjectURL(url); };
    const fail = m => { if (!done) { end(); rej(new Error(m)); } };
    w.onmessage = e => { if (done) return; end(); if (e.data && e.data.ok) res({ J: new Uint8Array(e.data.J), S: e.data.S.map(b => new Uint8Array(b)) }); else rej(new Error('part seams: ' + (e.data && e.data.message))); };
    w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); fail('part seams worker: ' + ((ev && ev.message) || 'error')); };
    w.onmessageerror = () => fail('part seams worker: message error');
    timer = setTimeout(() => fail('part seams worker: no answer in ' + timeoutMs + ' ms'), timeoutMs);
    try { w.postMessage({ lab: copy.buffer, size: [...size], n, opt: { band: opt.band, sigma: opt.sigma, margin: opt.margin, budget: opt.budget } }, [copy.buffer]); } catch (e) { fail('part seams worker: ' + (e && e.message || e)); }
  });
}
// the seams without their smoothing (S_k = 255 on part k's own voxels, 0 elsewhere: the film beside the parts is the last part's), for when the worker could not make them: every point is still drawn once, the seams as voxels
export function partGroupPlain(lab, size, n) {
  const N = size[0] * size[1] * size[2], S = [];
  for (let k = 1; k < n; k++) { const s = new Uint8Array(N); for (let i = 0; i < N; i++) if (lab[i] === k) s[i] = 255; S.push(s); }
  return S;
}
// the fields of the cut for the parts `fields` = [{data, lo, size, mask, kind ('region' | 'child')}] (their own fields: partFieldOf). run(lab, size, n) -> Promise of {J, S} (runPartGroup: a worker); a failure of run leaves
// that group with the larger byte and the unsmoothed seams (partGroupPlain: still drawn once), counted in `plain`.
// -> {body, parts, plain, merged} | null (no field). body = {data, lo, size, C, a, b, mask}: partFieldUnion's channels, the joint field J in the channel of a group; parts[p] = {data, lo, size, C, a, b}: on the part's own box,
// the channels it reads: J of each of its slots' channels (a part alone in a channel: its own field, the same bytes: `data` IS its field when it reads nothing else) and its seams. a[s], b[s] = the shader's partFieldA / partFieldB
// of slot s: the cut keeps where min over the channels of a * texel + b >= 0.5 (J: a = 1, b = 0; its own S_k: a = 1, b = -PART_SEAM_TIE; S_j of a part before it: a = -1, b = 1; a channel slot s does not read: a = 0, b = 1; a slot that is not the
// part's / that no part has: a = 0, b = 0, never). A part reads the seams that reach into its own box only (one that cannot change the answer there is left out). More than 4 channels on one part (a part with three or more
// neighbours reaching into its box, in a crowd of parts): two of its terms made one, the pair that is exact where possible; the merges that are not exact counted in `merged`.
// a point exactly on a seam (S_k = 0.5 to the last bit: the same interpolated number read on both sides) is the later part's: part k keeps S_k > 0.5 (its own seam's b = -2^-24, one step of a 32-bit float at 0.5: S_k - 2^-24 >= 0.5
// is S_k > 0.5 for every float S_k), an earlier part's seam keeps S_j <= 0.5 (1 - S_j >= 0.5). Without it, that point was drawn by both
export const PART_SEAM_TIE = 2 ** -24;
export async function partFieldSet(fields, run = runPartGroup, opt = PART_FIELD, state = null) {
  const g0 = partFieldChannels(fields);
  if (!g0) return null;
  if (state) { // the parts' ages (G): a part seen before keeps its age, a new one is the newest (later in `fields`: newer), a part that is gone is forgotten (it is new when it comes back)
    const ids = new Set(g0.list.map(f => f.id).filter(v => v != null)); for (const id of [...state.rank.keys()]) if (!ids.has(id)) state.rank.delete(id);
    for (const f of g0.list) if (f.id != null && !state.rank.has(f.id)) state.rank.set(f.id, state.next++);
  }
  const ops = typeof run === 'function' ? partOpsOfRun(run) : run; // the tasks of a group: ops.joint / ops.label / ops.smooth (partOpsOfRun); a function is the whole group at once, as before
  const near = partFieldNearOf(g0.list, PART_FIELD.pad), groups = partFieldJointGroups(fields, near), ownOut = []; // ownOut: [{p, data}] the own fields this call smoothed (a field given with plain = true: the unsmoothed bytes, 255 on the part and its skin, 0 elsewhere)
  // a part in a group, on every channel it has, takes its bytes from the group's joint field and seams (the own smoothing is not read: the labels are its bytes >= 128, which the unsmoothed ones give as the smoothed ones do):
  // only a part that is alone on some channel it has needs its own smoothed field (the union and its own box read it there)
  const inGroup = g0.list.map(() => new Set()); for (const { channel, parts } of groups) for (const p of parts) inGroup[p].add(channel);
  const fieldsNow = g0.list.slice();
  let plain = 0, merged = 0;
  // a part's own smoothed field from its unsmoothed bytes. When it cannot be made (out of memory on a large part) the part keeps the unsmoothed bytes: the cut as its voxels, drawn once, counted in `plain` (as the field of a part
  // was,, when its smoothing failed); it is not handed back in `own`, so it is made again the next time
  const smoothField = async p => {
    const f = fieldsNow[p], c = new Uint8Array(f.data.length); for (let i = 0; i < c.length; i++) c[i] = f.data[i] ? 1 : 0;
    let d; try { d = await ops.smooth(c, f.size, opt, { own: true }); } catch (e) { plain++; fieldsNow[p] = { ...f, plain: false }; return; }
    fieldsNow[p] = { ...f, data: d, plain: false }; ownOut.push({ p, data: d });
  };
  await Promise.all(fieldsNow.map((f, p) => (f.plain && [0, 1, 2, 3].some(s => ((g0.masks[p] >> s) & 1) && !inGroup[p].has(g0.chOf[s])) ? smoothField(p) : null))); // together when there are several (own: on workers, in parallel)
  const skip = new Set(); for (const { channel, parts } of groups) for (const p of parts) skip.add(p + '|' + channel); // a group's parts are not in the union: the group's joint field is (below)
  const g = partFieldChannels(fieldsNow), un = partFieldUnion(fieldsNow, skip.size ? skip : undefined);
  const { list, C, chOf } = g, size = un.size, lo = un.lo, data = un.data; // partFieldUnion made its own bytes (a group has two or more parts, and skip is given)
  const seams = list.map(() => []), grouped = list.map(() => new Set()), jcrops = list.map(() => new Map()); // per part: [{slots, a, src (bytes over the part's box)}]; the channels it shares with a group, and the group's joint field on its box
  const meet = (a, b) => partBoxesMeet(g0.list[a], g0.list[b]); // by the boxes: a part reads the seam of every earlier part of its group whose box meets its own (where J reaches), near or not
  // the 4 a part's box can read: J of each of its channels (nch), then for every group it is in: its own seam (unless it is last there) and one 1 - S_j for each earlier neighbour. `used` = what the groups decided so far ask of each part
  // (an upper bound: a seam that does not reach the part's box is left out later)
  const nch = g0.list.map((_, p) => g.keys.filter(k => k[p] === '1').length), used = nch.slice();
  const asks = order => order.map((p, k) => (k < order.length - 1 ? 1 : 0) + order.slice(0, k).filter(q => meet(p, q)).length); // per position
  const over = (order, ask) => order.reduce((t, p, k) => t + Math.max(0, used[p] + ask[k] - 4), 0);
  for (const { channel: c, parts: gr0 } of groups) {
    // G: the newest part goes FIRST (it has no earlier neighbour, and the seams of the older parts are the same as before it came: they are not made again). The smallest-last order (partSeamOrder) is kept where it matters: the order
    // is decided by what each part really reads (the plan: the joint field and the seams' voxels, before any smoothing), the newest first when it asks no more than the 4 a part can read, or when every part of the group meets every other
    // (every order asks the same), or when it asks fewer than the smallest-last order (with as many: the smallest-last order where the boxes said so, as did). Only the order taken is smoothed (n731 perf ⑤: smoothed
    // the newest first and then made the whole group again in the smallest-last order, or made it in that order at once, where the boxes over-counted: every seam made again at every detach past the fifth)
    let newest = null, full = false, boxOk = false;
    { // n731 perf ⑤: the parts' ages are the state's ranks; without them (no state, or a part without an id) the age is the position in `fields` (a later one is newer, as the ranks are made): the newest first in every case
      const ranked = !!state && gr0.every(p => list[p].id != null && state.rank.has(list[p].id)), age = p => (ranked ? state.rank.get(list[p].id) : p);
      newest = [...gr0].sort((u, v) => age(v) - age(u));
      full = gr0.every(p => gr0.every(q => p === q || meet(p, q)));
      boxOk = over(newest, asks(newest)) === 0 || (full && over(newest, asks(newest)) <= over(gr0, asks(gr0)));
    }
    // the group's box and the inside of any of its parts (the same for every order): the joint field J is made once, from these 0 / 1 (partGroupJointOf reads lab != 0 only: the same bytes as from the labels of any order)
    const n = gr0.length, glo = [0, 1, 2].map(a => Math.min(...gr0.map(p => list[p].lo[a]))), ghi = [0, 1, 2].map(a => Math.max(...gr0.map(p => list[p].lo[a] + list[p].size[a])));
    const gs = [ghi[0] - glo[0], ghi[1] - glo[1], ghi[2] - glo[2]], halo = partFieldHaloOf(opt);
    let jP = null; const jointOf = () => { if (!jP) { const bin = new Uint8Array(gs[0] * gs[1] * gs[2]); for (const p of gr0) { const f = list[p], [fw, fh, fd] = f.size, ox = f.lo[0] - glo[0], oy = f.lo[1] - glo[1], oz = f.lo[2] - glo[2]; for (let z = 0; z < fd; z++) for (let y = 0; y < fh; y++) { const s0 = fw * (y + fh * z), o = ox + gs[0] * (oy + y + gs[1] * (oz + z)); for (let x = 0; x < fw; x++) if (f.data[s0 + x] >= 128) bin[o + x] = 1; } } jP = ops.joint(bin, gs, opt, { glo }); jP.catch(() => {}); } return jP; };
    // the box f of the part out of a region m = {bytes, lo, size} (one byte a voxel)
    const reg = (m, f) => {
      const [fw, fh, fd] = f.size, out = new Uint8Array(fw * fh * fd), ox = f.lo[0] - glo[0] - m.lo[0], oy = f.lo[1] - glo[1] - m.lo[1], oz = f.lo[2] - glo[2] - m.lo[2];
      for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) { const q = ox + m.size[0] * (oy + y + m.size[1] * (oz + z)); for (let x = 0; x < fw; x++, i++) out[i] = m.bytes[q + x]; }
      return out;
    };
    // the box of some parts (their field boxes) and `pad` around it, in the group's coordinates, cut to `within` ({lo, size}; none: not cut). The seam of the parts k..n is made over the box of THOSE parts (as if they were a group of their
    // own) and the halo around the parts that read it, cut to that box: what it is made of then does not depend on the parts that are decided before them (nor on how large the group is), so it is the same bytes when such a part comes or goes
    const boxAround = (parts, pad, within) => {
      const lo3 = [0, 1, 2].map(a => Math.min(...parts.map(p => list[p].lo[a])) - glo[a] - pad), hi3 = [0, 1, 2].map(a => Math.max(...parts.map(p => list[p].lo[a] + list[p].size[a])) - glo[a] + pad);
      if (within) for (let a = 0; a < 3; a++) { lo3[a] = Math.max(lo3[a], within.lo[a]); hi3[a] = Math.min(hi3[a], within.lo[a] + within.size[a]); }
      return { lo: lo3, size: [0, 1, 2].map(a => hi3[a] - lo3[a]) };
    };
    // the group in the order `gr`, up to its plan (the labels, the seams' voxels, J, which seams each part reads; no smoothing): -> {gr, lab, lb, masks, J, pl, failed}
    const prep = async (gr, again = true) => {
      try { jointOf(); } catch (e) { jP = null; } // the joint field's task goes to the pool first: it runs there while this thread makes the labels
      const lab = new Uint8Array(gs[0] * gs[1] * gs[2]);
      // the labels: the results, then the child segments over them (a child inside a result: the child's voxel); of one kind, the one earlier in `fields` (written last)
      const writes = gr.map((p, k) => ({ p, k: k + 1 })).sort((u, v) => (partIsChild(list[u.p]) - partIsChild(list[v.p])) || (v.p - u.p));
      for (const { p, k } of writes) {
        const f = list[p], [fw, fh, fd] = f.size, ox = f.lo[0] - glo[0], oy = f.lo[1] - glo[1], oz = f.lo[2] - glo[2];
        for (let z = 0; z < fd; z++) for (let y = 0; y < fh; y++) { const s0 = fw * (y + fh * z), o = ox + gs[0] * (oy + y + gs[1] * (oz + z)); for (let x = 0; x < fw; x++) if (f.data[s0 + x] >= 128) lab[o + x] = k; }
      }
      // ---- the group's tasks (ops): J, and for every seam the voxels of S_k (before their smoothing; exact: S_k's byte is >= 128 where its label is); only the S_k that some part reads are smoothed, each over the box of the parts that read it.
      // The labels of S_k are made over the box of the parts k..n (and the halo): from the voxels of part k (1), those of the later parts (2), nothing else, so that they are the same however the parts before k are, and are made again
      // by nobody (the answer is remembered by these bytes). All the boxes below are boxes of the group, as {bytes, lo, size}
      const labelsOf = j => { // the canonical labels of the seam j (parts j..n-1) over their box
        const bx = boxAround(gr.slice(j), 0), [bw, bh, bd] = bx.size, out = new Uint8Array(bw * bh * bd);
        for (let z = 0, i = 0; z < bd; z++) for (let y = 0; y < bh; y++) { const o = bx.lo[0] + gs[0] * (bx.lo[1] + y + gs[1] * (bx.lo[2] + z)); for (let x = 0; x < bw; x++, i++) { const v = lab[o + x]; out[i] = v === j + 1 ? 1 : v > j + 1 ? 2 : 0; } }
        return { codes: out, ...bx };
      };
      // which seams each part reads: j <= k, and only where a point of a cell can be in J and on the seam's other side (a corner of the cell is in J's reach (> 0) and a corner is on that side: a voxel on that side with a voxel
      // of J > 0 within one step): the part's J grown by one voxel (partFieldReach) meets the side's voxels. `Jarr` = the group's joint field over its box (J; when J could not be made: the larger byte of its parts' own fields)
      const planOf = (Jarr, masks) => gr.map((p, k) => {
        const f = list[p], [fw, fh, fd] = f.size, jc = reg({ bytes: Jarr, lo: [0, 0, 0], size: gs }, f), reach = partFieldReach(jc, fw, fh, fd), js = [];
        for (let j = 0; j <= k && j < n - 1; j++) {
          const m = masks[j], own = j === k, ox = f.lo[0] - glo[0] - m.lo[0], oy = f.lo[1] - glo[1] - m.lo[1], oz = f.lo[2] - glo[2] - m.lo[2]; let need = false;
          for (let z = 0, i = 0; z < fd && !need; z++) for (let y = 0; y < fh && !need; y++) { const o = ox + m.size[0] * (oy + y + m.size[1] * (oz + z)); for (let x = 0; x < fw; x++, i++) if (reach[i] && (m.bytes[o + x] ? !own : own)) { need = true; break; } }
          if (need) js.push(j);
        }
        return { js, jc };
      });
      try {
        const lb = Array.from({ length: n - 1 }, (_, j) => labelsOf(j));
        const [Jr, ...ms] = await Promise.all([jointOf(), ...lb.map(b => ops.label(b.codes, b.size, 1, opt))]);
        const masks = ms.map((bytes, j) => ({ bytes, lo: lb[j].lo, size: lb[j].size }));
        return { gr, lab, lb, masks, J: Jr, pl: planOf(Jr, masks), planOf, failed: false };
      } catch (e) { jP = null; return again ? prep(gr, false) : failedOf(gr, lab, planOf); } // a task failed: the group is asked once more by the same path; the voxel fallback only when that fails too
    };
    // a task failed (out of memory on a large group): this group is made from the voxels (S_k = 255 on part k's own voxels, 0 elsewhere: still drawn once) and the larger byte of its parts' own fields; counted
    const failedOf = async (gr, lab, planOf) => {
      const masks = Array.from({ length: n - 1 }, (_, j) => { const m = new Uint8Array(lab.length); for (let i = 0; i < m.length; i++) if (lab[i] === j + 1) m[i] = 1; return { bytes: m, lo: [0, 0, 0], size: gs }; });
      const S = masks.map(m => ({ bytes: m.bytes.map(v => (v ? 255 : 0)), lo: [0, 0, 0], size: gs }));
      for (const p of gr) if (list[p].plain) { fieldsNow[p] = list[p]; await smoothField(p); list[p] = fieldsNow[p]; } // the larger byte of the parts' OWN smoothed fields: the members that were given unsmoothed bytes are smoothed now
      const J = new Uint8Array(lab.length); for (const p of gr) partFieldPutMax(J, gs, 1, [0], list[p].data, list[p].lo, list[p].size, glo);
      return { gr, lab, J, S, pl: planOf(J, masks), planOf, failed: true };
    };
    // the seams some part reads, smoothed, each over the box of its readers and the halo (cut to the seam's own box). A seam is 0 farther than the halo from its voxels (partFieldOf's byte depends on the codes within the halo only,
    // and a box without any is 0 there): only the box of its voxels and the halo around them is made (from that box and one more halo), the rest is 0, the very bytes of the whole box (④)
    const smoothOf = async (mk, again = true) => {
      if (mk.failed) return mk;
      const { gr, lb, masks, pl } = mk, S = new Array(n - 1).fill(null);
      try {
        await Promise.all(Array.from({ length: n - 1 }, async (_, j) => {
          const readers = gr.filter((_p, k) => pl[k].js.includes(j)); if (!readers.length) return;
          const sb = boxAround(readers, halo, masks[j]), sz3 = sb.size, m = masks[j], out = new Uint8Array(sz3[0] * sz3[1] * sz3[2]);
          const in1 = [Infinity, Infinity, Infinity], ax1 = [-1, -1, -1];
          for (let z = 0; z < sz3[2]; z++) for (let y = 0; y < sz3[1]; y++) { // the box of the seam's voxels: the first and the last 1 of each row (the typed array's own search)
            const o = sb.lo[0] - m.lo[0] + m.size[0] * (sb.lo[1] - m.lo[1] + y + m.size[1] * (sb.lo[2] - m.lo[2] + z)), row = m.bytes.subarray(o, o + sz3[0]), x0 = row.indexOf(1); if (x0 < 0) continue;
            const x1 = row.lastIndexOf(1); if (x0 < in1[0]) in1[0] = x0; if (x1 > ax1[0]) ax1[0] = x1; if (y < in1[1]) in1[1] = y; if (y > ax1[1]) ax1[1] = y; if (z < in1[2]) in1[2] = z; if (z > ax1[2]) ax1[2] = z;
          }
          if (ax1[0] >= 0) {
            const kl = in1.map(v => Math.max(0, v - halo)), kh = ax1.map((v, a) => Math.min(sz3[a], v + 1 + halo)), el = kl.map(v => Math.max(0, v - halo)), eh = kh.map((v, a) => Math.min(sz3[a], v + halo)), es = eh.map((v, a) => v - el[a]);
            const codes = new Uint8Array(es[0] * es[1] * es[2]);
            for (let z = 0, i = 0; z < es[2]; z++) for (let y = 0; y < es[1]; y++) { const o = sb.lo[0] + el[0] - m.lo[0] + m.size[0] * (sb.lo[1] + el[1] + y - m.lo[1] + m.size[1] * (sb.lo[2] + el[2] + z - m.lo[2])); for (let x = 0; x < es[0]; x++, i++) codes[i] = m.bytes[o + x] === 1 ? 1 : 0; }
            const r = await ops.smooth(codes, es, opt, { lab: lb[j].codes, gs: lb[j].size, k: 1, lo: [0, 1, 2].map(a => sb.lo[a] + el[a] - lb[j].lo[a]) });
            for (let z = kl[2]; z < kh[2]; z++) for (let y = kl[1]; y < kh[1]; y++) { const s0 = (kl[0] - el[0]) + es[0] * (y - el[1] + es[1] * (z - el[2])), o = sz3[0] * (y + sz3[1] * z); for (let x = kl[0]; x < kh[0]; x++) out[o + x] = r[s0 + x - kl[0]]; }
          }
          S[j] = { bytes: out, lo: sb.lo, size: sz3 };
        }));
      } catch (e) { return again ? smoothOf(mk, false) : failedOf(gr, mk.lab, mk.planOf); }
      return { ...mk, S };
    };
    const overOf = (mk, order) => order.reduce((t, p, k) => t + Math.max(0, used[p] + mk.pl[k].js.length - 4), 0); // how many seams over the 4 a part can read (before the merging): the parts' own count of what was decided
    let mk;
    if (!newest) mk = await prep(gr0);
    else {
      // where the boxes say the newest first can ask more than 4 (and the order is another one), the smallest-last order's plan is asked at the same time (its labels on the pool beside the newest's: not one after the other); taken
      // or not, the decision and the bytes are the same as when it is asked only after
      const pN = prep(newest), pG = !boxOk && newest.some((p, k) => p !== gr0[k]) ? prep(gr0) : null;
      if (pG) pG.catch(() => {});
      const mN = await pN, oN = overOf(mN, newest);
      if (oN === 0 || (full && boxOk)) mk = mN;
      else { const mG = await (pG || prep(gr0)), oG = overOf(mG, gr0); mk = oN < oG || (boxOk && oN === oG) ? mN : mG; }
    }
    mk = await smoothOf(mk);
    const gr = mk.gr, { J, S, pl } = mk; if (mk.failed) plain++;
    gr.forEach((p, k) => { used[p] += pl[k].js.length; });
    // the group's joint field over each of its parts' own field boxes, as the larger byte there (a part of the channel that is not in the group can have its box over a part of this one: what it has is not overwritten; the parts of the group
    // are not in the union, so the bytes are the group's alone); a part reads the group's field on its box (jc), not the union's
    for (const p of gr) { const f = list[p]; for (let z = f.lo[2]; z < f.lo[2] + f.size[2]; z++) for (let y = f.lo[1]; y < f.lo[1] + f.size[1]; y++) { const s0 = gs[0] * (y - glo[1] + gs[1] * (z - glo[2])) - glo[0], o = (size[0] * (y - lo[1] + size[1] * (z - lo[2])) - lo[0]) * C + c; for (let x = f.lo[0]; x < f.lo[0] + f.size[0]; x++) { const v = J[s0 + x]; if (v > data[o + x * C]) data[o + x * C] = v; } } }
    // each part's seams, cut to its own box: S_j (j before it) read as 1 - S_j, its own S_k read as S_k; only those that can change the answer in its box
    const slots = [0, 1, 2, 3].filter(s => chOf[s] === c);
    gr.forEach((p, k) => {
      grouped[p].add(c); jcrops[p].set(c, pl[k].jc);
      for (const j of pl[k].js) { const own = j === k, sj = S[j]; seams[p].push({ slots, own, a: own ? 1 : -1, src: reg(sj, list[p]) }); }
    });
  }
  const same = (x, y) => { if (x === y) return true; if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
  const parts = list.map((f, p) => {
    const nf = f.size[0] * f.size[1] * f.size[2], chans = [], add = src => { let i = chans.findIndex(x => same(x, src)); if (i < 0) { chans.push(src); i = chans.length - 1; } return i; };
    const jOf = new Map(); // slot channel -> its J on the part's box: alone in the channel, the part's own field (the union's bytes there ARE its field: no other part of the channel reaches into its box)
    for (let s = 0; s < 4; s++) { const c = chOf[s]; if (!((g.masks[p] >> s) & 1) || jOf.has(c)) continue; jOf.set(c, grouped[p].has(c) ? jcrops[p].get(c) : f.data); }
    const nJ = new Set([...jOf.values()].map(x => add(x))).size;
    let sm = seams[p];
    if (nJ + sm.length > 4) { // more than 4: two terms of one slot group made one (the smaller of the two, a = 1); the pair whose terms are never both short of passing in one cell where J reaches is exact (min of the two
      // interpolations = the interpolation of the min where one of them passes at all 8 corners); `merged` counts the merges that are not exact
      const [fw, fh, fd] = f.size, cellOf = m => { // the cells (by their lower corner) with a corner in m
        const o = m.slice();
        for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) if (x + 1 < fw && m[i + 1]) o[i] = 1;
        const o2 = o.slice(); for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) if (y + 1 < fh && o[i + fw]) o2[i] = 1;
        const o3 = o2.slice(); for (let i = 0; i + fw * fh < nf; i++) if (o2[i + fw * fh]) o3[i] = 1;
        return o3;
      };
      // plain loops (Uint8Array.from(x, callback) made a function call a voxel: 4.5 times slower, whole seconds on a large part)
      const term = x => { if (x.a > 0) return x.src; const o = new Uint8Array(nf), s = x.src; for (let i = 0; i < nf; i++) o[i] = 255 - s[i]; return o; };
      const short = t => { const o = new Uint8Array(nf); for (let i = 0; i < nf; i++) o[i] = t[i] < 255 ? 1 : 0; return o; };
      const positive = t => { const o = new Uint8Array(nf); for (let i = 0; i < nf; i++) o[i] = t[i] > 0 ? 1 : 0; return o; };
      const reachOf = new Map(); for (const [c, jb] of jOf) reachOf.set(c, cellOf(positive(jb)));
      sm = sm.map(x => ({ ...x, t: term(x) })); sm.forEach(x => { x.cells = cellOf(short(x.t)); });
      while (nJ + sm.length > 4) {
        let best = null;
        for (let i = 0; i < sm.length; i++) for (let j = i + 1; j < sm.length; j++) {
          if (sm[i].slots !== sm[j].slots) continue;
          const R = reachOf.get(chOf[sm[i].slots[0]]), A = sm[i].cells, B = sm[j].cells; let n = 0;
          for (let q = 0; q < nf; q++) if (A[q] && B[q] && R[q]) n++;
          if (!best || n < best.n) best = { i, j, n };
        }
        if (!best) throw new Error('part seams: more than 4 channels on one part');
        const A = sm[best.i], B = sm[best.j], t = new Uint8Array(nf); for (let q = 0; q < nf; q++) t[q] = A.t[q] < B.t[q] ? A.t[q] : B.t[q];
        const x = { slots: A.slots, own: A.own || B.own, a: 1, src: t, t }; x.cells = cellOf(short(t)); // with its own seam: the tie rule of its own seam
        sm = [x, ...sm.filter((_, iy) => iy !== best.i && iy !== best.j)]; if (best.n) merged++;
      }
    }
    const a = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), b = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    for (let s = 0; s < 4; s++) {
      if (!((g.masks[p] >> s) & 1)) continue;
      b[s] = [1, 1, 1, 1];
      for (const e of [{ ch: add(jOf.get(chOf[s])), a: 1, b: 0 }, ...sm.filter(x => x.slots.includes(s)).map(x => ({ ch: add(x.src), a: x.a, b: x.a < 0 ? 1 : x.own ? -PART_SEAM_TIE : 0 }))]) { a[s][e.ch] = e.a; b[s][e.ch] = e.b; }
    }
    if (chans.length > 4) throw new Error('part seams: more than 4 channels on one part');
    if (chans.length === 1) return { data: chans[0], lo: f.lo, size: f.size, C: 1, a, b };
    const Cp = chans.length === 3 ? 4 : chans.length, out = new Uint8Array(nf * Cp);
    chans.forEach((x, ch) => { for (let i = 0, q = ch; i < nf; i++, q += Cp) out[q] = x[i]; });
    return { data: out, lo: f.lo, size: f.size, C: Cp, a, b };
  });
  const a = [0, 1, 2, 3].map(s => [0, 1, 2, 3].map(c => (chOf[s] === c ? 1 : 0))), b = [0, 1, 2, 3].map(s => [0, 1, 2, 3].map(c => (chOf[s] < 0 ? 0 : chOf[s] === c ? 0 : 1)));
  return { body: { data, lo, size, C, a, b, mask: un.mask, occ: partBodyOccOf({ data, size, C, a, b }) }, parts, plain, merged, own: ownOut.sort((u, v) => u.p - v.p) };
}
// n731 perf ③: the voxels the body's cut surely hides, for the distance field of the visible content (vr-hide-field.js: an index source, bit c of a voxel's byte = channel c of the body's field hides it). A voxel counts only when
// the field's byte is at least PART_HID_MIN on that channel at the voxel and at all 26 of its neighbours inside the box (a voxel on the box's edge never): every sample whose nearest voxel it is reads the field LINEAR from those 8
// of the 27 bytes, all above 0.5 by a margin (0.518: the GPU's filtering rounds), so the shader hides it (the body hides where the field is >= 0.5). Fewer voxels than the shader hides, never more: the field built from them is
// never longer than the distance to something the body draws (hiding less is safe). -> Uint8Array over the box (1 byte a voxel)
export const PART_HID_MIN = 132;
export function partBodyHidOf(data, size, C, min = 132) {
  const w = size[0] | 0, h = size[1] | 0, d = size[2] | 0, wh = w * h, n = wh * d, out = new Uint8Array(n), a = new Uint8Array(n), b = new Uint8Array(n);
  for (let c = 0; c < C; c++) {
    for (let i = 0, q = c; i < n; i++, q += C) a[i] = data[q] >= min ? 1 : 0;
    for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) b[i] = a[i] && x > 0 && x + 1 < w && a[i - 1] && a[i + 1] ? 1 : 0;
    for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) a[i] = b[i] && y > 0 && y + 1 < h && b[i - w] && b[i + w] ? 1 : 0;
    for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (a[i] && z > 0 && z + 1 < d && a[i - wh] && a[i + wh]) out[i] |= 1 << c;
  }
  return out;
}
export const PART_POOL = Object.freeze({ workers: 3, voxels: 36e6 });
export function partComputeWorkerSource() {
  return [partFieldOf, partGroupLabelOf, partGroupJointOf].map(f => f.toString()).join('\n') +
    '\nonmessage=e=>{const m=e.data;try{const b=new Uint8Array(m.bytes),r=m.kind==="L"?partGroupLabelOf(b,m.size,m.k):m.kind==="J"?partGroupJointOf(b,m.size,m.opt):partFieldOf(b,m.size,m.opt);postMessage({ok:true,id:m.id,bytes:r.buffer},[r.buffer])}catch(err){postMessage({ok:false,id:m.id,message:String(err&&err.message||err)})}};';
}
// -> {run(kind ('J': the joint field of labels, 'L': the voxels of S_k of labels (k), 'F': partFieldOf of codes), k, bytes (an ArrayBuffer: the caller's to give away), size, opt) -> Promise of bytes, dispose()}
export function createPartPool(opt0 = PART_FIELD, pool = PART_POOL, taskTimeoutMs = PART_FIELD_TIMEOUT_MS) {
  let url = null, seq = 0, inflight = 0, dead = false; const ws = [], waiting = [];
  const spawn = () => { if (!url) url = URL.createObjectURL(new Blob([partComputeWorkerSource()], { type: 'text/javascript' })); const x = { w: new Worker(url), busy: false }; ws.push(x); return x; };
  const drop = x => { const i = ws.indexOf(x); if (i >= 0) ws.splice(i, 1); try { x.w.terminate(); } catch { /* none */ } };
  const pump = () => {
    while (waiting.length && !dead) {
      const t = waiting[0], free = ws.find(x => !x.busy) || (ws.length < pool.workers ? spawn() : null);
      if (!free || (inflight > 0 && inflight + t.vox > pool.voxels)) return;
      waiting.shift(); inflight += t.vox; free.busy = true;
      const id = ++seq; let over = false;
      const finish = () => { if (over) return false; over = true; clearTimeout(timer); inflight -= t.vox; return true; };
      const timer = setTimeout(() => { if (finish()) { drop(free); t.rej(new Error('part task: no answer in ' + taskTimeoutMs + ' ms')); pump(); } }, taskTimeoutMs);
      free.w.onmessage = e => { const d = e.data; if (!finish()) return; free.busy = false; if (d && d.ok) t.res(new Uint8Array(d.bytes)); else t.rej(new Error('part task: ' + (d && d.message))); pump(); };
      free.w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (finish()) { drop(free); t.rej(new Error('part task worker: ' + ((ev && ev.message) || 'error'))); pump(); } };
      try { free.w.postMessage({ id, kind: t.kind, k: t.k, bytes: t.bytes, size: t.size, opt: t.opt }, [t.bytes]); } catch (er) { if (finish()) { drop(free); t.rej(er); pump(); } }
    }
  };
  const task = (kind, k, bytes, size, opt, vox) => new Promise((res, rej) => { if (dead) { rej(new Error('part pool is closed')); return; } waiting.push({ kind, k, bytes, size: [...size], opt, vox, res, rej }); pump(); });
  const o = opt => ({ band: opt.band, sigma: opt.sigma, margin: opt.margin, budget: opt.budget });
  return {
    run(kind, k, bytes, size, opt = opt0) { return task(kind, k, bytes, size, o(opt), size[0] * size[1] * size[2] * (kind === 'L' ? 0.35 : 1)); }, // a label task holds a third of what a smoothing does
    dispose() { dead = true; waiting.length = 0; for (const x of ws.splice(0)) { try { x.w.terminate(); } catch { /* none */ } } if (url) URL.revokeObjectURL(url); url = null; },
  };
}
export const PART_SET_WORKER_TIMEOUT_MS = 600000, PART_CACHE_BYTES = 160e6;
// 64 bits of a byte array as a string (two different 32-bit hashes and the length): the key of a group's labels, the signature of a field's bytes
function partHash64(b) {
  // by 32-bit words where the bytes lie aligned (four times fewer steps), the tail by bytes
  let h1 = 0x811c9dc5, h2 = 0x9747b28c, i = 0;
  const n = b.length, n4 = b.byteOffset % 4 === 0 && b.BYTES_PER_ELEMENT === 1 ? n >> 2 : 0;
  if (n4) { const u = new Uint32Array(b.buffer, b.byteOffset, n4); for (; i < n4; i++) { const v = u[i]; h1 = Math.imul(h1 ^ v, 16777619); h1 ^= h1 >>> 15; h2 = (Math.imul(h2 ^ (v + 0x9e), 0x85ebca6b) + (h2 >>> 15)) | 0; } i = n4 << 2; }
  for (; i < n; i++) { const v = b[i]; h1 = Math.imul(h1 ^ v, 16777619); h2 = (Math.imul(h2 ^ (v + 0x9e), 0x85ebca6b) + (h2 >>> 15)) | 0; }
  return (h1 >>> 0).toString(16) + '.' + (h2 >>> 0).toString(16) + '.' + n;
}
// the memory of the answers of the tasks of the groups (the same group again, or a task whose input did not change, costs nothing): key -> bytes, the least recently used out first, at most `limit` bytes (an answer larger than that is not kept)
function partGroupCacheOf(limit) {
  const m = new Map(); let bytes = 0;
  return {
    get(k) { const e = m.get(k); if (!e) return null; m.delete(k); m.set(k, e); return e.r; },
    put(k, r) { const bb = r.length; if (bb > limit || m.has(k)) return; while (bytes + bb > limit && m.size) { const f = m.keys().next().value; bytes -= m.get(f).bb; m.delete(f); } m.set(k, { r, bb }); bytes += bb; },
    clear() { m.clear(); bytes = 0; },
    stats() { return { entries: m.size, bytes }; },
    last(test) { const ks = [...m.keys()]; for (let i = ks.length - 1; i >= 0; i--) if (test(ks[i])) return m.get(ks[i]).r; return null; }, // the most recently used answer whose key passes (not moved)
  };
}
// the group's tasks (ops) with the cache in front of them: the key is every byte of the input, its box, the smoothing's numbers. stats.hit / stats.miss count them. A part's own field (ctx.own) is the caller's to keep: not remembered
function partCachedOps(cache, stats, ops) {
  const keys = new WeakMap(), no = o => [o.band, o.sigma, o.margin, o.budget].join(',');
  const keyOf = (a, size) => { let k = keys.get(a); if (!k) { k = partHash64(a) + '|' + size.join('x'); keys.set(a, k); } return k; };
  const through = async (key, make) => { const got = cache.get(key); if (got) { stats.hit++; return got; } stats.miss++; const r = await make(); cache.put(key, r); return r; };
  // n731 perf ④: the joint field of a group from the last one made (ctx.glo: where the box lies). J's byte depends on the codes and the box's faces within the halo only (partFieldHaloOf), so the voxels with the same codes and
  // faces within the halo keep the last field's bytes; the rest (one box: around the codes that changed and along the faces that moved, and the halo) is made again from that box and one more halo, the very bytes of the whole box.
  // The last field's codes are its bytes >= 128 (partFieldOf's rule). No size limit on what is reused (a box that is most of the group costs what the whole field does); only where there is no last field (a first group) or it shares no voxel with this box: the whole field
  const jointNear = async (lab, size, opt, ctx) => {
    const h = partFieldHaloOf(opt), sfx = '|' + no(opt), old = ctx && ctx.glo ? cache.last(k => k.startsWith('J|') && k.endsWith(sfx)) : null, N = size[0] * size[1] * size[2];
    if (!old || !old.vrAt || !old.vrGs) return ops.joint(lab, size, opt);
    const glo = ctx.glo, ol = old.vrAt, os = old.vrGs, lo = [0, 1, 2].map(a => Math.max(0, ol[a] - glo[a])), hi = [0, 1, 2].map(a => Math.min(size[a], ol[a] + os[a] - glo[a]));
    if (hi.some((v, a) => v <= lo[a])) return ops.joint(lab, size, opt);
    const cl = [Infinity, Infinity, Infinity], ch = [-1, -1, -1], dl = [Infinity, Infinity, Infinity], dh = [-Infinity, -Infinity, -Infinity];
    for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) {
      const i0 = size[0] * (y + size[1] * z), j0 = os[0] * (y + glo[1] - ol[1] + os[1] * (z + glo[2] - ol[2])) + glo[0] - ol[0];
      for (let x = lo[0]; x < hi[0]; x++) if ((lab[i0 + x] !== 0) !== (old[j0 + x] >= 128)) { if (x < cl[0]) cl[0] = x; if (x > ch[0]) ch[0] = x; if (y < cl[1]) cl[1] = y; if (y > ch[1]) ch[1] = y; if (z < cl[2]) cl[2] = z; if (z > ch[2]) ch[2] = z; }
    }
    const add = (l, u) => { for (let a = 0; a < 3; a++) { dl[a] = Math.min(dl[a], Math.max(0, l[a])); dh[a] = Math.max(dh[a], Math.min(size[a], u[a])); } };
    if (ch[0] >= 0) add(cl.map(v => v - h), ch.map(v => v + 1 + h));
    for (let a = 0; a < 3; a++) {
      if (glo[a] !== ol[a]) { const l = [0, 0, 0], u = [...size]; u[a] = Math.max(0, ol[a] - glo[a]) + h; add(l, u); }
      if (glo[a] + size[a] !== ol[a] + os[a]) { const l = [0, 0, 0], u = [...size]; l[a] = Math.min(size[a], ol[a] + os[a] - glo[a]) - h; add(l, u); }
    }
    const out = new Uint8Array(N);
    if (dl[0] !== Infinity) {
      const el = dl.map(v => Math.max(0, v - h)), eh = dh.map((v, a) => Math.min(size[a], v + h)), es = eh.map((v, a) => v - el[a]);
      const sub = new Uint8Array(es[0] * es[1] * es[2]);
      for (let z = 0, i = 0; z < es[2]; z++) for (let y = 0; y < es[1]; y++) { const o = el[0] + size[0] * (el[1] + y + size[1] * (el[2] + z)); for (let x = 0; x < es[0]; x++, i++) sub[i] = lab[o + x] ? 1 : 0; }
      const Je = await ops.joint(sub, es, opt);
      for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) { const i0 = size[0] * (y + size[1] * z), j0 = os[0] * (y + glo[1] - ol[1] + os[1] * (z + glo[2] - ol[2])) + glo[0] - ol[0]; for (let x = lo[0]; x < hi[0]; x++) out[i0 + x] = old[j0 + x]; }
      for (let z = dl[2]; z < dh[2]; z++) for (let y = dl[1]; y < dh[1]; y++) { const i0 = size[0] * (y + size[1] * z), s0 = es[0] * (y - el[1] + es[1] * (z - el[2])) - el[0]; for (let x = dl[0]; x < dh[0]; x++) out[i0 + x] = Je[s0 + x]; }
      stats.near = (stats.near || 0) + 1; // made from the last joint field
    } else for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) { const i0 = size[0] * (y + size[1] * z), j0 = os[0] * (y + glo[1] - ol[1] + os[1] * (z + glo[2] - ol[2])) + glo[0] - ol[0]; for (let x = 0; x < size[0]; x++) out[i0 + x] = old[j0 + x]; } // the same codes, the same box
    return out;
  };
  return {
    joint: (lab, size, opt, ctx) => through('J|' + keyOf(lab, size) + '|' + no(opt), async () => { const r = await jointNear(lab, size, opt, ctx); if (ctx && ctx.glo) { r.vrAt = [...ctx.glo]; r.vrGs = [...size]; } return r; }),
    label: (lab, size, k, opt) => through('L' + k + '|' + keyOf(lab, size), () => ops.label(lab, size, k, opt)),
    smooth: (codes, size, opt, ctx) => (ctx && ctx.own ? ops.smooth(codes, size, opt, ctx) : through('F|' + keyOf(codes, size) + '|' + no(opt), () => ops.smooth(codes, size, opt, ctx))),
  };
}
// a result's bytes as a signature (the same bytes, the same channels and box: the same texture)
function partSigOf(x) { return partHash64(x.data) + ':' + x.C + ':' + x.size.join('x'); }
export function partSetWorkerSource(limit = PART_CACHE_BYTES) {
  return ['const PART_SEAM_TIE=' + PART_SEAM_TIE + ';', 'const partBoxesMeet=' + partBoxesMeet.toString() + ';', 'const partIsChild=' + partIsChild.toString() + ';', 'const PART_FIELD=' + JSON.stringify(PART_FIELD) + ';',
    partHash64, partGroupCacheOf, partCachedOps, partSigOf, partOpsOfRun,
    partFieldOf, partFieldPlain, partGroupLabelOf, partGroupJointOf, partFieldHaloOf, partBodyHidOf, partBodyOccOf, partFieldReach, partFieldDilate, partFieldNearOf, partFieldChannels, partFieldUnion, partFieldPutMax, partFieldTouching, partSeamOrder, partFieldJointGroups, partFieldSet].map(f => (typeof f === 'string' ? f : f.toString())).join('\n') +
    '\nconst cache=partGroupCacheOf(' + (+limit || 0) + '),state={rank:new Map(),next:0};let seq=0;const pend=new Map(),rpc=(msg,buf)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,{res,rej});postMessage({...msg,id},[buf])});' +
    '\nconst taskOf=(kind,k,bytes,size,opt)=>{const c=bytes.slice(),o=opt||{};return rpc({rpc:"task",kind,k,bytes:c.buffer,size:[...size],opt:{band:o.band,sigma:o.sigma,margin:o.margin,budget:o.budget}},c.buffer).then(r=>new Uint8Array(r.bytes))};' +
    '\nconst rpcOps={joint:(lab,size,opt)=>taskOf("J",0,lab,size,opt),label:(lab,size,k,opt)=>taskOf("L",k,lab,size,opt),smooth:(codes,size,opt)=>taskOf("F",0,codes,size,opt)};' +
    '\nconst localOps={joint:async(lab,size,opt)=>partGroupJointOf(lab,size,opt),label:async(lab,size,k)=>partGroupLabelOf(lab,size,k),smooth:async(codes,size,opt)=>partFieldOf(codes,size,opt)};' +
    '\nconst noOps={joint:async()=>{throw new Error("plain only")},label:async()=>{throw new Error("plain only")},smooth:async(codes,size,opt,ctx)=>{if(ctx&&ctx.own)return partFieldOf(codes,size,opt);throw new Error("plain only")}};' +
    '\nonmessage=async e=>{const m=e.data;if(m.reply){const p=pend.get(m.id);pend.delete(m.id);if(p){if(m.ok)p.res(m);else p.rej(new Error(m.message))}return}if(m.clear){cache.clear();state.rank.clear();state.next=0;return}try{const fields=m.fields.map(f=>{const b=new Uint8Array(f.bytes);return f.codes?{data:partFieldPlain(b,f.size),plain:true,lo:f.lo,size:f.size,mask:f.mask,kind:f.kind,id:f.id}:{data:b,lo:f.lo,size:f.size,mask:f.mask,kind:f.kind,id:f.id}});' +
    'const stats={hit:0,miss:0},base=m.plainOnly?noOps:m.pool?rpcOps:localOps,set=await partFieldSet(fields,m.plainOnly?base:partCachedOps(cache,stats,base),m.opt,m.plainOnly?null:state);' +
    'if(!set){postMessage({ok:true,id:m.id,set:null});return}const idx=new Map(fields.map((f,i)=>[f.data,i])),tr=new Set(),pack=x=>{const i=idx.get(x.data);if(i!==undefined&&!fields[i].plain)return{...x,data:null,same:i,sig:partSigOf(x)};tr.add(x.data.buffer);return{...x,sig:partSigOf(x)}};' +
    'if(set.body.hid)tr.add(set.body.hid.buffer);if(set.body.occ)tr.add(set.body.occ.data.buffer);const body=pack(set.body),parts=set.parts.map(pack),own=set.own.map(o=>{tr.add(o.data.buffer);return o});postMessage({ok:true,id:m.id,set:{body,parts,plain:set.plain,merged:set.merged,own,cache:{...stats,...cache.stats()}}},[...tr])}catch(err){postMessage({ok:false,id:m.id,message:String(err&&err.message||err)})}};';
}
// partFieldSet on a worker that stays (so that its memory of the groups' answers does) -> {run(fields) -> Promise of {body, parts, plain, merged, own, cache} | null, clear(), dispose()}. A set is partFieldSet's answer, but for
//  - a part's / the body's `data` is the very array of its field where partFieldSet gives that (a part alone in its channels), and every one has a `sig` (its bytes' signature: the same sig = the same texture),
//  - a field is {data (its own smoothed field, partFieldOf), lo, size, mask, kind} or {codes (partFieldCodes' bytes, no smoothing made yet), ...}: the worker smooths it only where it is needed (partFieldNeedsOwn) and hands the bytes
//    back in `own` = [{p, data}] (p = the index among the fields given, those without lo / size left out), for the caller to keep,
//  - `cache` = {hit, miss, entries, bytes}: the groups' answers it took from its memory / made, and what it holds now,
//  - a field with an `id` has an age: the runner remembers in which order the ids came, and the newest part of a group is decided FIRST (G: the seams of the older parts stay as they were).
// The fields' bytes are COPIED to the worker (the caller keeps them). The tasks of the groups run on a pool of workers (createPartPool) that lives for one run. Jobs go one after the other. No Worker (tests, an old browser): the same on this
// thread, group after group after a task. If the worker itself fails (it crashes, no answer in timeoutMs) the set is made once more on a new one with every group unsmoothed (the cut works, drawn once: `plain` counts them), as a failure
// inside a group always did.
export function createPartSetRunner(opt = PART_FIELD, cfg = {}) {
  const limit = cfg.cacheBytes != null ? cfg.cacheBytes : PART_CACHE_BYTES, timeoutMs = cfg.timeoutMs || PART_SET_WORKER_TIMEOUT_MS;
  const o = { band: opt.band, sigma: opt.sigma, margin: opt.margin, budget: opt.budget }, validOf = fields => (fields || []).filter(f => f && (f.data || f.codes) && f.lo && f.size);
  const threads = !(typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL);
  let chain = Promise.resolve(), cur = null, gone = false; const localCache = partGroupCacheOf(limit), localState = { rank: new Map(), next: 0 };
  // ---- this thread
  const local = async (valid, plainOnly) => {
    const stats = { hit: 0, miss: 0 }, no = async () => { throw new Error('plain only'); };
    const tick = f => (...a) => new Promise((res, rej) => setTimeout(() => { try { res(f(...a)); } catch (e) { rej(e); } }, 0));
    const ops = plainOnly ? { joint: no, label: no, smooth: async (codes, size, op, ctx) => { if (ctx && ctx.own) return partFieldOf(codes, size, op); throw new Error('plain only'); } }
      : { joint: tick(partGroupJointOf), label: tick(partGroupLabelOf), smooth: tick((codes, size, op) => partFieldOf(codes, size, op)) };
    const set = await partFieldSet(valid.map(f => (f.data ? f : { ...f, data: partFieldPlain(f.codes, f.size), plain: true })), plainOnly ? ops : partCachedOps(localCache, stats, ops), o, plainOnly ? null : localState);
    if (!set) return null;
    return { ...set, body: { ...set.body, sig: partSigOf(set.body) }, parts: set.parts.map(x => ({ ...x, sig: partSigOf(x) })), cache: { ...stats, ...localCache.stats() } };
  };
  // ---- the worker
  const spawn = () => {
    const url = URL.createObjectURL(new Blob([partSetWorkerSource(limit)], { type: 'text/javascript' })), w = new Worker(url), st = { w, url, job: null, pool: null };
    w.onmessage = e => {
      const d = e.data, j = st.job; if (!j) return;
      if (d && d.rpc) { // the worker's request for a task (a group's J / a seam's labels / a smoothing): on the pool (several workers at once), the answer goes back to it
        st.pool = st.pool || createPartPool(opt);
        const back = (ok, msg, tr = []) => { if (st.job === j) { try { w.postMessage({ reply: true, id: d.id, ok, ...msg }, tr); } catch (er) { j.fail('part set worker: ' + (er && er.message || er)); } } };
        st.pool.run(d.kind, d.k, d.bytes, d.size, d.opt).then(r => back(true, { bytes: r.buffer }, [r.buffer]), er => back(false, { message: String(er && er.message || er) }));
        return;
      }
      j.finish();
      if (!d || !d.ok) { const er = new Error('part set: ' + (d && d.message)); er.answered = true; j.rej(er); return; } // answered: partFieldSet itself threw (as it does on this thread): not a worker failure, not tried again
      if (!d.set) { j.res(null); return; }
      const back = x => { if (x.same == null) return x; const r = { ...x, data: j.valid[x.same].data }; delete r.same; return r; }, { body, parts, plain, merged, own, cache } = d.set;
      j.res({ body: back(body), parts: parts.map(back), plain, merged, own, cache });
    };
    w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (st.job) st.job.fail('part set worker: ' + ((ev && ev.message) || 'error')); };
    w.onmessageerror = () => { if (st.job) st.job.fail('part set worker: message error'); };
    return st;
  };
  const kill = () => { if (!cur) return; const st = cur; cur = null; try { st.w.terminate(); } catch { /* none */ } URL.revokeObjectURL(st.url); if (st.pool) st.pool.dispose(); st.pool = null; };
  const once = (valid, plainOnly) => new Promise((res, rej) => {
    let st; try { cur = cur || spawn(); st = cur; } catch (e) { kill(); rej(e); return; }
    let timer = 0, over = false;
    const finish = () => { over = true; clearTimeout(timer); st.job = null; if (st.pool) { st.pool.dispose(); st.pool = null; } };
    const fail = m => { if (!over) { finish(); if (cur === st) kill(); rej(new Error(m)); } };
    st.job = { valid, res, rej, finish, fail }; timer = setTimeout(() => fail('part set worker: no answer in ' + timeoutMs + ' ms'), timeoutMs);
    const copies = valid.map(f => (f.data || f.codes).slice());
    try { st.w.postMessage({ id: 0, fields: valid.map((f, i) => ({ bytes: copies[i].buffer, codes: !f.data, lo: f.lo, size: f.size, mask: f.mask, kind: f.kind, id: f.id })), opt: o, plainOnly, pool: true }, copies.map(c => c.buffer)); } catch (e) { fail('part set worker: ' + (e && e.message || e)); }
  });
  const runOne = fields => {
    const valid = validOf(fields);
    if (gone) return Promise.reject(new Error('the runner is closed'));
    if (!threads) return local(valid, false);
    return once(valid, false).catch(e => { if (gone || (e && e.answered)) throw e; console.warn('[VR] part set worker failed, tried once more:', e && e.message || e); return once(valid, false); }).catch(e => { if (gone || (e && e.answered)) throw e; console.warn('[VR] part set worker failed twice, the groups are made unsmoothed:', e && e.message || e); return once(valid, true); }); // a failure is first made again by the same path (the same speed), the unsmoothed groups only when it fails again
  };
  return {
    run(fields) { const p = chain.then(() => runOne(fields)); chain = p.catch(() => {}); return p; },
    clear() { localCache.clear(); localState.rank.clear(); localState.next = 0; if (cur) { try { cur.w.postMessage({ clear: true }); } catch { /* none */ } } },
    dispose() { gone = true; localCache.clear(); if (cur && cur.job) { const j = cur.job; j.finish(); j.rej(new Error('the runner is closed')); } kill(); }, // a set being made is answered (rejected): whoever waits for it does not wait for ever
  };
}
// one set, no memory kept: a runner for this call only
export async function runPartSet(fields, opt = PART_FIELD, cfg = {}) {
  const r = createPartSetRunner(opt, cfg);
  try { return await r.run(fields); } finally { r.dispose(); }
}
// a part's own field (R8) on the shader: partFieldSel[s] = the red channel on the slots of mask, zeros on the others
export function partFieldSelOf(mask) { return [0, 1, 2, 3].map(s => ((mask >> s) & 1 ? [1, 0, 0, 0] : [0, 0, 0, 0])); }
// the shader's mapping of a field box: texture coordinate u = tc * scale + off (tc over the index grid dims) -> {scale: [3], off: [3]}
// n731 perf 案② (the parts' rays): the occupancy of a part's field texture by blocks of PART_OCC_B^3 trilinear cells, for the shader's partOcc. pf = the part's field as partFieldSet gives it ({data, size, C, a, b}: C channels a voxel,
// a[s] / b[s] = the shader's partFieldA / partFieldB of slot s). A point is in the part on slot s only where every channel c passes: a[s][c] * T_c + b[s][c] >= 0.5, T_c = the trilinear value of the channel (a channel the texture does not have
// reads 0, the fourth 1: the texture's RGBA of an R8 / RG8 texture). The trilinear value passes only where one of the cell's 8 corner texels does (a convex mix), so a block is 1 when, on some slot, every channel has a passing texel among
// those its cells read, grown by one texel on every side (the texel addressing of the hardware, a cell off by one), else 0: no point of the block is in the part (the shader leaves it out). Conservative by construction: a 1 costs only speed.
// -> {data: Uint8Array (255 / 0, x fastest), dims: [bx, by, bz]}
export const PART_OCC_B = 8;
export function partOccOf(pf) {
  const [w, h, d] = pf.size, C = pf.C || 1, B = PART_OCC_B, bw = Math.ceil(w / B), bh = Math.ceil(h / B), bd = Math.ceil(d / B), nb = bw * bh * bd, data = pf.data, out = new Uint8Array(nb);
  const thr = 0.5 - 1 / 1024; // a margin under the shader's 0.5 (its float arithmetic): only ever more blocks
  const blk = (i, n) => [Math.max(0, Math.ceil((i - B - 1) / B)), Math.min(n - 1, Math.floor((i + 1) / B))]; // the blocks whose texels (cells 8b..8b+7 read 8b..8b+8, grown by one: 8b-1..8b+9) contain texel i
  const bx = [], by = [], bz = []; for (let x = 0; x < w; x++) bx.push(blk(x, bw)); for (let y = 0; y < h; y++) by.push(blk(y, bh)); for (let z = 0; z < d; z++) bz.push(blk(z, bd));
  let any = null; // per slot: the blocks where every channel has a passing texel
  for (let s = 0; s < 4; s++) {
    const a = pf.a[s], b = pf.b[s]; if (!a || !b) continue;
    let all = null;
    for (let c = 0; c < 4; c++) {
      const ac = +a[c] || 0, bc = +b[c] || 0;
      if (c >= C || ac === 0) { const v = c >= C ? (c === 3 ? 1 : 0) : 0; if (ac * v + bc >= thr) continue; all = new Uint8Array(nb); break; } // a constant term: passes everywhere (no limit) or nowhere (the slot has no point)
      const m = new Uint8Array(nb);
      for (let z = 0, i = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
        if (!(ac * (data[i * C + c] / 255) + bc >= thr)) continue;
        const [x0, x1] = bx[x], [y0, y1] = by[y], [z0, z1] = bz[z];
        for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) for (let q = x0; q <= x1; q++) m[q + bw * (j + bh * k)] = 1;
      }
      if (!all) all = m; else for (let q = 0; q < nb; q++) all[q] &= m[q];
    }
    if (!all) { all = new Uint8Array(nb).fill(1); } // every channel constant and passing: the whole box (no limit from this slot)
    if (!any) any = all; else for (let q = 0; q < nb; q++) any[q] |= all[q];
  }
  if (any) for (let q = 0; q < nb; q++) out[q] = any[q] ? 255 : 0;
  return { data: out, dims: [bw, bh, bd] };
}
// n731 perf ③ (without the distance field): the body's blocks that are wholly inside the cut, for the shader's partOcc of the BODY (partKind 0; RGBA8, channel s = slot s). The body draws nothing where its field is >= 0.5 on the slot (PART_GLSL: every
// hidden test says yes there), so a ray may leave out a block of 8x8x8 trilinear cells whose every texel the cells read (grown by one, as partOccOf) passes on every channel of the slot, by a margin over 0.5; blocks that touch the texture's edge are never
// left out (outside the field's box nothing is cut). A slot nothing cuts (a = b = 0) is never full (the shader ignores the slots it does not draw). The texel margin is the whole of it: no voxel neighbourhood rule. -> {data: Uint8Array RGBA (255 / 0), dims: [bx, by, bz]}
export function partBodyOccOf(pf) {
  const [w, h, d] = pf.size, C = pf.C || 1, B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B), bd = Math.ceil(d / B), nb = bw * bh * bd, data = pf.data, thr = 0.5 + 1 / 1024;
  const edge = new Uint8Array(nb); // 1 = a texel the block reads (8b - 1 .. 8b + 9) is outside the texture
  for (let k = 0, q = 0; k < bd; k++) for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++, q++) if (i < 1 || 8 * i + 9 > w - 1 || j < 1 || 8 * j + 9 > h - 1 || k < 1 || 8 * k + 9 > d - 1) edge[q] = 1;
  const out = new Uint8Array(nb * 4);
  for (let s = 0; s < 4; s++) {
    const a = pf.a[s], b = pf.b[s]; if (!a || !b) continue;
    let never = false; const act = [];
    for (let c = 0; c < 4; c++) {
      const ac = +a[c] || 0, bc = +b[c] || 0;
      if (c >= C || ac === 0) { const v = c >= C ? (c === 3 ? 1 : 0) : 0; if (!(ac * v + bc >= thr)) never = true; } else act.push([c, ac, bc]);
    }
    if (never) continue;
    // the blocks with a failing texel among those they read (8b - 1 .. 8b + 9 per axis), as three separable passes: the rows of x first (each texel once), then y and z over the reduced arrays
    const F1 = new Uint8Array(bw * h * d), pass = new Uint8Array(w);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) {
      const o = w * (y + h * z);
      for (let x = 0; x < w; x++) { let ok = 1; const q = (o + x) * C; for (let k = 0; k < act.length; k++) { const e = act[k]; if (!(e[1] * (data[q + e[0]] / 255) + e[2] >= thr)) { ok = 0; break; } } pass[x] = ok; }
      const r0 = bw * (y + h * z);
      for (let i = 0; i < bw; i++) { const a0 = Math.max(0, 8 * i - 1), a1 = Math.min(w - 1, 8 * i + 9); let f = 0; for (let x = a0; x <= a1; x++) if (!pass[x]) { f = 1; break; } F1[r0 + i] = f; }
    }
    const F2 = new Uint8Array(bw * bh * d);
    for (let z = 0; z < d; z++) for (let j = 0; j < bh; j++) { const a0 = Math.max(0, 8 * j - 1), a1 = Math.min(h - 1, 8 * j + 9); for (let i = 0; i < bw; i++) { let f = 0; for (let y = a0; y <= a1; y++) if (F1[i + bw * (y + h * z)]) { f = 1; break; } F2[i + bw * (j + bh * z)] = f; } }
    const bad = new Uint8Array(nb);
    for (let k = 0; k < bd; k++) { const a0 = Math.max(0, 8 * k - 1), a1 = Math.min(d - 1, 8 * k + 9); for (let q = 0; q < bw * bh; q++) { let f = 0; for (let z = a0; z <= a1; z++) if (F2[q + bw * bh * z]) { f = 1; break; } bad[q + bw * bh * k] = f; } }
    for (let q = 0; q < nb; q++) if (!bad[q] && !edge[q]) out[q * 4 + s] = 255;
  }
  return { data: out, dims: [bw, bh, bd] };
}
export function partFieldMap(box, dims) { return { scale: [0, 1, 2].map(a => dims[a] / box.size[a]), off: [0, 1, 2].map(a => -box.lo[a] / box.size[a]) }; }
// the "air" test of partFieldCodes from the laser's classification bytes (vr-pick: cls {data, C, chan} on cdims): an index-grid voxel is air when, on every slot of mask, its classification byte is below 128 (the shader's 0.5); null without them
export function partAirOf(cls, cdims, idims, mask) {
  if (!cls || !cls.data || !cdims || !idims) return null;
  const chs = []; for (let s = 0; s < 4; s++) if ((mask >> s) & 1 && cls.chan && cls.chan[s] >= 0) chs.push(cls.chan[s]);
  if (!chs.length) return null;
  const [cw, ch] = cdims, same = cdims[0] === idims[0] && cdims[1] === idims[1] && cdims[2] === idims[2], sx = cdims[0] / idims[0], sy = cdims[1] / idims[1], sz = cdims[2] / idims[2], C = cls.C, data = cls.data;
  return (x, y, z) => {
    const cx = same ? x : Math.min(cdims[0] - 1, Math.floor((x + 0.5) * sx)), cy = same ? y : Math.min(cdims[1] - 1, Math.floor((y + 0.5) * sy)), cz = same ? z : Math.min(cdims[2] - 1, Math.floor((z + 0.5) * sz)), k = (cx + cw * (cy + ch * cz)) * C;
    for (const c of chs) if (data[k + c] >= 128) return false;
    return true;
  };
}
// the body's tables while parts are out: a part's target is marked "cut out" (its shape is decided by the field, not by its voxels), on top of its hidden bits (patchRegionLutMany / patchChildLutMany wrote those). The bits are read only by
// the VRL_PART programs the body draws with while a part is out (PART_GLSL, partKind 0); every other reader looks at other bits (region-visibility.js: 0..4 colour / focus, 8..11 hidden; child row 1: 0..3 hidden).
export const PART_CUT_REGION_BIT = 65536, PART_CUT_CHILD_BIT = 256;
export function markCutRegionLut(a, indices) { let n = 0; for (const i of indices) { const o = (i + 1) * 4 + 3; if (o >= a.length) continue; a[o] = (Math.round(a[o]) | PART_CUT_REGION_BIT); n++; } return n; }
export function markCutChildLut(a, indices, stride = 1024) { let n = 0; for (const j of indices) { const o = stride + (j + 1) * 4 + 3; if ((j + 1) * 4 + 3 >= stride || o >= a.length) continue; a[o] = (Math.round(a[o]) | PART_CUT_CHILD_BIT); n++; } return n; }

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
