// the distance field of the VISIBLE content.
//
// The combined texture's alpha (distance-field.js) is the distance to the SEGMENT's surface. A hidden part (a hidden result or child segment, an earlier change) is inside the segment, so that field does not see the
// cut a hidden part leaves: the shader takes no jump from a sample inside a hidden part (vr-view.js prevHid: dd = 0), and a ray that crosses a hidden part (a brain region, a bone) walks all of it in fine
// steps (about 4.7x the iterations of the same ray without the hidden part, measured on a CPU model of the loop). Here the field is built for what the ray can still HIT: the segment without its hidden voxels
// (+ the air voxels next to a hidden voxel, which the shader may still draw, see hiddenClassBytes). A ray inside a hidden part then jumps as far as the field allows, up to the cut it leaves.
//
// Safety (the contract of every distance field here: it must never be longer than the distance to something the shader would hit):
//   - the class of a slot s is P = (S and not H) or (air, not H, with a hidden-S voxel among its 26 neighbours), S = the classification byte >= 128, H = the voxel's hide index (G of the result / child index,
//     nearest, as regionHiddenAt / childHiddenAt read it) is hidden ON THIS SLOT. A sample the shader draws (trilinear class >= 0.5, nearest voxel not hidden; the cell test hideCellAt only hides more) has its nearest
//     voxel in P or next to a class change, and the deep inside of P (no seed within 2.7 voxels) is all S, i.e. a hit: so the distance to the class change of P, floored (euclideanDistanceBytes), is at most
//     the distance to the next hit from every sample that is not a hit itself. A slot without a hidden part keeps the ordinary field of the segment (P = S).
//   - the bytes are for the hidden set they were built with (and the shown set): the shader drops the no-jump rule only while the current state is EXACTLY that set on every shown slot and shows at most that mask
//     (hideBitsMatch below; hiding more is NOT safe: the newly hidden part is inside visible tissue in the bytes) and no rebuild is running; otherwise it keeps the old rule (hideVMode 0), which is safe for any bytes
//     (they are never above the ordinary field).
//   - the shader keeps the old rule in the programs of a detached part (VRL_PART: the part's cut is not in the hide index) and in the partner.
// The bytes go into the combined texture's ALPHA, as min(ordinary field, this field), by the same rebuild that follows the shown set (vr-combo-rebuild.js: a worker; the class bytes and the hide indexes go to it once, one
// slab per frame). min(.., ordinary) keeps every byte a lower bound of the ordinary field too, so while any part of the texture is of the old or the new kind the OLD rule (no jump from a hidden sample) stays safe;
// the shader drops that rule (hideVMode) only when the rebuild is complete and the current state is exactly what the bytes were built with (on the shown slots). Pure (no DOM / GL), unit-tested.
import { euclideanDistanceBytes, morph3 } from './distance-field.js?v=20261112-build730';

// P of slot `slot` on channel `ch`: 1 where the voxel is visible tissue (S and not hidden) or an air voxel beside hidden tissue (not hidden itself). cls: {data, C}; sources: [{ids: Uint8Array (the G byte of an index per
// voxel), bits: Uint8Array(256) (bit s of entry i: item i is hidden on slot s)}]; out: Uint8Array(n) (written); scratch: {sh, dl, hd} Uint8Array(n) each (optional). Self-contained (no outer names): it is the worker's source too.
export function hiddenClassBytes(cls, ch, dims, sources, slot, out, scratch) {
  const n = dims[0] * dims[1] * dims[2], C = cls.C, data = cls.data, ns = sources.length;
  const sh = (scratch && scratch.sh) || new Uint8Array(n), dl = (scratch && scratch.dl) || new Uint8Array(n), hd = (scratch && scratch.hd) || new Uint8Array(n);
  const tabs = sources.map(s => { const t = new Uint8Array(256); for (let i = 1; i < 256; i++) t[i] = (s.bits[i] >> slot) & 1; return t; });
  for (let i = 0; i < n; i++) {
    const s = data[i * C + ch] >= 128;
    let h = false; for (let k = 0; k < ns; k++) if (tabs[k][sources[k].ids[i]]) { h = true; break; }
    out[i] = s && !h ? 1 : 0; sh[i] = s && h ? 1 : 0; hd[i] = h ? 1 : 0;
  }
  morph3(sh, dl, dims, 1); // dl = 26-neighbourhood of the hidden tissue
  for (let i = 0; i < n; i++) if (dl[i] && !out[i] && !hd[i] && data[i * C + ch] < 128) out[i] = 1;
  return out;
}

// min-merge into `alpha` (one byte per voxel, already the ordinary field of the shown slots of `mask`: bit s of slot s, chan[s] = its stored channel) the field of every shown slot that has a hidden part, from its P
// (above); the slots without a hidden part are left as they are (their ordinary field is already in alpha). Returns true when something was merged. Self-contained.
export function hideFieldMin(alpha, { cls, chan, dims, mask, sources }) {
  const n = dims[0] * dims[1] * dims[2];
  let inside = null, scratch = null, hs = null, any = false;
  for (let s = 0; s < 4; s++) {
    if (!(chan[s] >= 0) || !((mask >> s) & 1)) continue;
    let hid = false; for (let k = 0; k < sources.length && !hid; k++) for (let i = 1; i < 256; i++) if ((sources[k].bits[i] >> s) & 1) { hid = true; break; }
    if (!hid) continue;
    inside = inside || new Uint8Array(n); scratch = scratch || { D: new Int32Array(n), a: new Uint8Array(n), b: new Uint8Array(n), dil: new Uint8Array(n) };
    hs = hs || { sh: scratch.a, dl: scratch.b, hd: scratch.dil }; // the class pass is over before the distance pass starts: one set of byte buffers serves both (memory: about 8 bytes per voxel, not 11)
    hiddenClassBytes(cls, chan[s], dims, sources, s, inside, hs);
    const f = euclideanDistanceBytes(inside, dims, scratch);
    for (let i = 0; i < n; i++) if (f[i] < alpha[i]) alpha[i] = f[i];
    any = true;
  }
  return any;
}

// a hidden state: one Uint8Array(256) per index source (the results' index, the children's): bit s of entry i = item i is hidden on slot s. The bytes are valid for a state only when it is EXACTLY the one they were built with
// on every slot that is shown (shown = a slot mask): a part that is hidden now but was visible when the bytes were built is, in them, the inside of visible tissue (a large distance), so a ray inside it would jump over
// the cut it leaves; a part that was hidden then and is shown now was a cut in the bytes where there is none. (Hiding MORE is not safe: measured on the CPU model, 226 of 16657 jumps crossed visible tissue, up to 9.2 voxels.)
export const hideBitsMatch = (built, cur, shown) => !!built && !!cur && built.length === cur.length && built.every((b, k) => { for (let i = 1; i < 256; i++) if ((b[i] ^ cur[k][i]) & shown & 15) return false; return true; });
export const hideBitsSame = (a, b) => (!a && !b) || (!!a && !!b && a.length === b.length && a.every((x, k) => { for (let i = 1; i < 256; i++) if (x[i] !== b[k][i]) return false; return true; }));
// is anything hidden in the state (on any slot)
export const hideBitsAny = a => !!a && a.some(b => { for (let i = 1; i < 256; i++) if (b[i] & 15) return true; return false; });
// the same, restricted to the slots of `mask`
export const hideBitsOn = (a, mask) => !!a && a.some(b => { for (let i = 1; i < 256; i++) if (b[i] & mask & 15) return true; return false; });
