// (first prototype): a region / child segment taken OUT of the body and moved freely (VR / AR only). Pure: no DOM, no three.js, no app state (unit-tested: tests/unit/vr-part-view.test.js).
// docs/vr-view.js owns the GPU side (the `part` block of startVrView); this module holds the rules it applies:
//   - the method (Issue 案A): the same textures are drawn a second time in another box (the part's own pose), where everything but the target is "not tissue" (PART_GLSL, compiled only with VRL_PART);
//     the body's own draw is NOT changed: the target is hidden in the body by patching the look-up tables AFTER they were written (patchRegionLut / patchChildLut) -- a run-time overlay like the stick's colour-off,
//     region.hidden / child.visible (saved in the project, shown on the 表示 buttons) are never written,
//   - which uniforms the part owns (the rest is the body's by reference: PART_OWN), the target a grip takes (partTargetOf), the part's own box (partBoundsOf), the laser's rule on the CPU (partKeepVoxelOf),
//   - several parts at once: every part has its own box, uniforms and pose; the tables are patched for all of them (patchRegionLutMany / patchChildLutMany); a part's proxy box is its own bounding box (partProxyBox) and its laser march
//     runs only inside it (partRayRange), the texts. The way in is the long-press ring (region-ring.js 切り出す / 戻す); the grip stays the body's grab and takes a part only where the laser meets one.
import { regionLutAlpha } from './region-visibility.js?v=20261112-build730';
import { boxFromRange } from './vr-content-box.js?v=20261112-build730';

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
export const PART_EXTRA = Object.freeze(['partKind', 'partId', 'partMask', 'partField', 'partFieldScale', 'partFieldOff', 'partFieldA', 'partFieldB']);
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
  const rMax = Math.max(0, ...rA, ...rB), line = new Float32Array(Math.max(w, h, d)), accW = new Float64Array(w), pl = new Float32Array(wh), ring = new Float32Array((rMax + 1) * wh), acc = new Float64Array(wh);
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
        for (let base = 0; base < m; base += w) { // x
          for (let t = 0; t < w; t++) line[t] = a[base + t];
          let acc = 0; for (let t = -r; t <= r; t++) acc += line[t < 0 ? 0 : t >= w ? w - 1 : t];
          for (let t = 0; t < w; t++) { a[base + t] = acc * inv; const add = t + r + 1, sub = t - r; acc += line[add >= w ? w - 1 : add] - line[sub < 0 ? 0 : sub]; }
        }
        for (let z = 0; z < sd_; z++) { // y
          const P = z * wh; pl.set(a.subarray(P, P + wh)); accW.fill(0);
          for (let t = -r; t <= r; t++) { const R = (t < 0 ? 0 : t >= h ? h - 1 : t) * w; for (let x = 0; x < w; x++) accW[x] += pl[R + x]; }
          for (let t = 0; t < h; t++) { const add = t + r + 1, sub = t - r, A = (add >= h ? h - 1 : add) * w, S = (sub < 0 ? 0 : sub) * w, T = P + t * w; for (let x = 0; x < w; x++) { a[T + x] = accW[x] * inv; accW[x] += pl[A + x] - pl[S + x]; } }
        }
        acc.fill(0); // z: ring = the last r + 1 planes as they were
        for (let t = -r; t <= r; t++) { const P = (t < 0 ? 0 : t >= sd_ ? sd_ - 1 : t) * wh; for (let i = 0; i < wh; i++) acc[i] += a[P + i]; }
        for (let t = 0; t < sd_; t++) {
          const P = t * wh, Rt = (t % (r + 1)) * wh; ring.set(a.subarray(P, P + wh), Rt);
          for (let i = 0; i < wh; i++) a[P + i] = acc[i] * inv;
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
export function partFieldUnion(fields) {
  const g = partFieldChannels(fields);
  if (!g) return null;
  const { list, mask, keys, chOf, C } = g;
  const sel = [0, 1, 2, 3].map(s => [0, 1, 2, 3].map(c => (chOf[s] === c ? 1 : 0)));
  const lo = [0, 1, 2].map(a => Math.min(...list.map(f => f.lo[a]))), hi = [0, 1, 2].map(a => Math.max(...list.map(f => f.lo[a] + f.size[a])));
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  // one part, one channel, its own box: its field IS the union (the same bytes, not a second copy of them in memory)
  if (list.length === 1 && C === 1 && size.every((v, a) => v === list[0].size[a])) return { data: list[0].data, lo, size, C, sel, mask };
  const data = new Uint8Array(size[0] * size[1] * size[2] * C);
  list.forEach((f, p) => {
    const chs = keys.map((k, c) => (k[p] === '1' ? c : -1)).filter(c => c >= 0);
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
function partFieldTouching(list, members) {
  const par = members.map((_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) if (partBoxesMeet(list[members[i]], list[members[j]])) par[find(i)] = find(j);
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
// the groups of touching parts (of two or more) in all the channels of the union of `fields`, each in its decision order: [{channel, parts}]. [] = no seam to make
export function partFieldJointGroups(fields) {
  const g = partFieldChannels(fields); if (!g) return [];
  const out = [];
  g.keys.forEach((k, c) => {
    const members = g.list.map((_, p) => p).filter(p => k[p] === '1');
    if (members.length > 1) for (const gr of partFieldTouching(g.list, members)) if (gr.length > 1) out.push({ channel: c, parts: partSeamOrder(g.list, gr) });
  });
  return out;
}
// the joint field and the seams of one group (self-contained but for partFieldOf: it runs in a worker from the source text of both). lab = the group's box (x fastest), 0 = outside every part, k = part k (1-based, the
// decision order). -> {J, S: [S_1 .. S_(n-1)]} (bytes over the box, as partFieldOf's)
export function partGroupFieldsOf(lab, size, n, opt) {
  const w = size[0] | 0, h = size[1] | 0, d = size[2] | 0, N = w * h * d, codes = new Uint8Array(N);
  for (let i = 0; i < N; i++) codes[i] = lab[i] ? 1 : 0;
  const J = partFieldOf(codes, size, opt), S = [];
  if (n < 2) return { J, S };
  // the nearest of the parts k..n for every voxel: a two-pass 3x3x3 chamfer from their voxels, carrying the part (an equal distance keeps the one found first)
  const dist = new Float32Array(N), nl = new Uint8Array(N), off = [], wt = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = dx + 3 * (dy + 3 * dz); if (k >= 0) continue; const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz); off.push(dx, dy, dz); wt.push(m === 1 ? 1 : m === 2 ? Math.SQRT2 : Math.sqrt(3)); }
  for (let k = 1; k < n; k++) {
    for (let i = 0; i < N; i++) { const l = lab[i]; if (l >= k) { dist[i] = 0; nl[i] = l; } else { dist[i] = 1e9; nl[i] = 0; } }
    for (let fw = 1; fw >= -1; fw -= 2) for (let zi = 0; zi < d; zi++) { const z = fw > 0 ? zi : d - 1 - zi; for (let yi = 0; yi < h; yi++) { const y = fw > 0 ? yi : h - 1 - yi; for (let xi = 0; xi < w; xi++) {
      const x = fw > 0 ? xi : w - 1 - xi, i = x + w * (y + h * z); let mm = dist[i], ml = nl[i]; if (mm === 0) continue;
      for (let q = 0, p = 0; q < wt.length; q++, p += 3) {
        const xx = x + fw * off[p], yy = y + fw * off[p + 1], zz = z + fw * off[p + 2];
        if (xx < 0 || xx >= w || yy < 0 || yy >= h || zz < 0 || zz >= d) continue;
        const j = xx + w * (yy + h * zz), v = dist[j] + wt[q]; if (v < mm) { mm = v; ml = nl[j]; }
      }
      dist[i] = mm; nl[i] = ml;
    } } }
    for (let i = 0; i < N; i++) codes[i] = nl[i] === k ? 1 : 0;
    S.push(partFieldOf(codes, size, opt));
  }
  return { J, S };
}
// partGroupFieldsOf on a worker (the labels' buffer is transferred) -> Promise of {J, S}. No Worker (tests, an old browser): the same function on this thread, after a task. The worker's limit and failures as runPartField's.
export function runPartGroup(lab, size, n, opt = PART_FIELD, timeoutMs = PART_FIELD_TIMEOUT_MS) {
  const local = () => new Promise((res, rej) => setTimeout(() => { try { res(partGroupFieldsOf(lab, size, n, opt)); } catch (e) { rej(e); } }, 0));
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return local();
  let w, url;
  try { url = URL.createObjectURL(new Blob(['const partFieldOf=' + partFieldOf.toString() + ';\nconst partGroupFieldsOf=' + partGroupFieldsOf.toString() + ';\nonmessage=e=>{const m=e.data;try{const r=partGroupFieldsOf(new Uint8Array(m.lab),m.size,m.n,m.opt);postMessage({ok:true,J:r.J.buffer,S:r.S.map(s=>s.buffer)},[r.J.buffer,...r.S.map(s=>s.buffer)])}catch(err){postMessage({ok:false,message:String(err&&err.message||err)})}};'], { type: 'text/javascript' })); w = new Worker(url); }
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
export async function partFieldSet(fields, run = runPartGroup, opt = PART_FIELD) {
  const g = partFieldChannels(fields), un = g ? partFieldUnion(fields) : null;
  if (!un) return null;
  const { list, C, chOf } = g, size = un.size, lo = un.lo, groups = partFieldJointGroups(fields), data = un.data; // partFieldUnion made its own bytes whenever there are two or more parts (a group has two or more)
  const seams = list.map(() => []), grouped = list.map(() => new Set()); // per part: [{slots, a, src (bytes over the part's box)}]; the channels it shares with a group
  let plain = 0, merged = 0;
  for (const { channel: c, parts: gr } of groups) {
    const n = gr.length, glo = [0, 1, 2].map(a => Math.min(...gr.map(p => list[p].lo[a]))), ghi = [0, 1, 2].map(a => Math.max(...gr.map(p => list[p].lo[a] + list[p].size[a])));
    const gs = [ghi[0] - glo[0], ghi[1] - glo[1], ghi[2] - glo[2]], lab = new Uint8Array(gs[0] * gs[1] * gs[2]);
    // the labels: the results, then the child segments over them (a child inside a result: the child's voxel); of one kind, the one earlier in `fields` (written last)
    const writes = gr.map((p, k) => ({ p, k: k + 1 })).sort((u, v) => (partIsChild(list[u.p]) - partIsChild(list[v.p])) || (v.p - u.p));
    for (const { p, k } of writes) {
      const f = list[p], [fw, fh, fd] = f.size, ox = f.lo[0] - glo[0], oy = f.lo[1] - glo[1], oz = f.lo[2] - glo[2];
      for (let z = 0; z < fd; z++) for (let y = 0; y < fh; y++) { const s0 = fw * (y + fh * z), o = ox + gs[0] * (oy + y + gs[1] * (oz + z)); for (let x = 0; x < fw; x++) if (f.data[s0 + x] >= 128) lab[o + x] = k; }
    }
    let r;
    try { r = await run(lab, gs, n, opt); } catch (e) { plain++; r = { J: null, S: partGroupPlain(lab, gs, n) }; }
    if (r.J) { // the joint field over the group's box written only inside each part's own field box (the group's bounding box can hold another part of the channel that is not in the group: it is not overwritten)
      for (const p of gr) { const f = list[p]; for (let z = f.lo[2]; z < f.lo[2] + f.size[2]; z++) for (let y = f.lo[1]; y < f.lo[1] + f.size[1]; y++) { const s0 = gs[0] * (y - glo[1] + gs[1] * (z - glo[2])) - glo[0], o = (size[0] * (y - lo[1] + size[1] * (z - lo[2])) - lo[0]) * C + c; for (let x = f.lo[0]; x < f.lo[0] + f.size[0]; x++) data[o + x * C] = r.J[s0 + x]; } }
    }
    // each part's seams, cut to its own box: S_j (j before it) read as 1 - S_j, its own S_k read as S_k; only those that can change the answer in its box
    const slots = [0, 1, 2, 3].filter(s => chOf[s] === c);
    gr.forEach((p, k) => {
      grouped[p].add(c);
      const f = list[p], [fw, fh, fd] = f.size, nf = fw * fh * fd, jc = partFieldCrop(data, size, lo, C, c, f.lo, f.size);
      const crop = s => { const out = new Uint8Array(nf), ox = f.lo[0] - glo[0], oy = f.lo[1] - glo[1], oz = f.lo[2] - glo[2]; for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) { const o = ox + gs[0] * (oy + y + gs[1] * (oz + z)); for (let x = 0; x < fw; x++, i++) out[i] = s[o + x]; } return out; };
      for (let j = 0; j <= k && j < n - 1; j++) {
        const src = crop(r.S[j]), own = j === k;
        // a point of a cell can be in J and on the seam's other side when a corner of the cell is in J's reach (> 0) and a corner is on that side: a voxel on that side with a voxel of J > 0 within one step
        let need = false;
        for (let z = 0, i = 0; z < fd && !need; z++) for (let y = 0; y < fh && !need; y++) for (let x = 0; x < fw && !need; x++, i++) {
          if (own ? src[i] >= 128 : src[i] < 128) continue;
          for (let dz = Math.max(0, z - 1); dz <= Math.min(fd - 1, z + 1) && !need; dz++) for (let dy = Math.max(0, y - 1); dy <= Math.min(fh - 1, y + 1) && !need; dy++) for (let dx = Math.max(0, x - 1); dx <= Math.min(fw - 1, x + 1); dx++) if (jc[dx + fw * (dy + fh * dz)] > 0) { need = true; break; }
        }
        if (need) seams[p].push({ slots, own, a: own ? 1 : -1, src });
      }
    });
  }
  const same = (x, y) => { if (x === y) return true; if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
  const parts = list.map((f, p) => {
    const nf = f.size[0] * f.size[1] * f.size[2], chans = [], add = src => { let i = chans.findIndex(x => same(x, src)); if (i < 0) { chans.push(src); i = chans.length - 1; } return i; };
    const jOf = new Map(); // slot channel -> its J on the part's box: alone in the channel, the part's own field (the union's bytes there ARE its field: no other part of the channel reaches into its box)
    for (let s = 0; s < 4; s++) { const c = chOf[s]; if (!((g.masks[p] >> s) & 1) || jOf.has(c)) continue; jOf.set(c, grouped[p].has(c) ? partFieldCrop(data, size, lo, C, c, f.lo, f.size) : f.data); }
    const nJ = new Set([...jOf.values()].map(x => add(x))).size;
    let sm = seams[p];
    if (nJ + sm.length > 4) { // more than 4: two terms of one slot group made one (the smaller of the two, a = 1); the pair whose terms are never both short of passing in one cell where J reaches is exact (min of the two
      // interpolations = the interpolation of the min where one of them passes at all 8 corners); `merged` counts the merges that are not exact
      const [fw, fh, fd] = f.size, cellOf = m => { // the cells (by their lower corner) with a corner in m
        const o = Uint8Array.from(m);
        for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) if (x + 1 < fw && m[i + 1]) o[i] = 1;
        const o2 = Uint8Array.from(o); for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++, i++) if (y + 1 < fh && o[i + fw]) o2[i] = 1;
        const o3 = Uint8Array.from(o2); for (let i = 0; i + fw * fh < nf; i++) if (o2[i + fw * fh]) o3[i] = 1;
        return o3;
      };
      const term = x => (x.a > 0 ? x.src : Uint8Array.from(x.src, v => 255 - v)), short = t => Uint8Array.from(t, v => (v < 255 ? 1 : 0));
      const reachOf = new Map(); for (const [c, jb] of jOf) reachOf.set(c, cellOf(Uint8Array.from(jb, v => (v > 0 ? 1 : 0))));
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
  return { body: { data, lo, size, C, a, b, mask: un.mask }, parts, plain, merged };
}
// channel c of a C-channel box (data over size at lo) on the box (blo, bsize): 1 byte a voxel
function partFieldCrop(data, size, lo, C, c, blo, bsize) {
  const [fw, fh, fd] = bsize, out = new Uint8Array(fw * fh * fd), ox = blo[0] - lo[0], oy = blo[1] - lo[1], oz = blo[2] - lo[2];
  for (let z = 0, i = 0; z < fd; z++) for (let y = 0; y < fh; y++) { const o = (ox + size[0] * (oy + y + size[1] * (oz + z))) * C + c; for (let x = 0, q = o; x < fw; x++, i++, q += C) out[i] = data[q]; }
  return out;
}
// a part's own field (R8) on the shader: partFieldSel[s] = the red channel on the slots of mask, zeros on the others
export function partFieldSelOf(mask) { return [0, 1, 2, 3].map(s => ((mask >> s) & 1 ? [1, 0, 0, 0] : [0, 0, 0, 0])); }
// the shader's mapping of a field box: texture coordinate u = tc * scale + off (tc over the index grid dims) -> {scale: [3], off: [3]}
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
