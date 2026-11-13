import { describe, it, expect } from 'vitest';
import { combineClassificationDistance, euclideanDistanceBytes } from '../../docs/distance-field.js';
import { hiddenClassBytes, hideFieldMin, hideBitsMatch, hideBitsSame, hideBitsAny, hideBitsOn } from '../../docs/vr-hide-field.js';
import { partBodyHidOf, PART_HID_MIN } from '../../docs/vr-part-view.js';

// the distance field of the VISIBLE content while a result / child segment is hidden (docs/vr-hide-field.js). The contract of every distance field here: a byte is never longer than the distance
// to something the shader can hit, so a jump never crosses visible content. Brute force on small non-cubic grids.
const rnd = seed => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
// a volume with tissue blobs (class byte 200 inside, 20 outside), item index G (1 = a block that is hidden on slot 0)
function scene(dims, seed) {
  const [w, h, d] = dims, n = w * h * d, r = rnd(seed), cls = new Uint8Array(n).fill(20), G = new Uint8Array(n);
  for (let b = 0; b < 3; b++) { const cx = r() * w, cy = r() * h, cz = r() * d, rad = 2 + r() * 3; for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy, z - cz) <= rad) cls[(z * h + y) * w + x] = 200; }
  const x0 = Math.floor(w * 0.3), x1 = Math.floor(w * 0.6);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) G[(z * h + y) * w + x] = 1;
  const bits = new Uint8Array(256); bits[1] = 1; // item 1 hidden on slot 0
  return { n, cls: { data: cls, C: 1 }, G, bits, sources: [{ ids: G, bits }] };
}

describe('hiddenClassBytes', () => {
  it('visible tissue and the air beside hidden tissue are 1; hidden tissue and the rest are 0', () => {
    const dims = [9, 5, 5], [w, h, d] = dims, n = w * h * d, cls = new Uint8Array(n).fill(20), G = new Uint8Array(n);
    const at = (x, y, z) => (z * h + y) * w + x;
    for (let z = 1; z < 4; z++) for (let y = 1; y < 4; y++) for (let x = 1; x < 8; x++) cls[at(x, y, z)] = 200; // a bar of tissue
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 4; x < 6; x++) G[at(x, y, z)] = 1; // item 1 across it (x 4..5), also over air
    const bits = new Uint8Array(256); bits[1] = 1;
    const P = hiddenClassBytes({ data: cls, C: 1 }, 0, dims, [{ ids: G, bits }], 0, new Uint8Array(n));
    expect(P[at(2, 2, 2)]).toBe(1); // visible tissue
    expect(P[at(4, 2, 2)]).toBe(0); expect(P[at(5, 2, 2)]).toBe(0); // hidden tissue
    expect(P[at(1, 0, 2)]).toBe(0); expect(P[at(7, 0, 0)]).toBe(0); // air far from hidden tissue
    expect(P[at(3, 0, 2)]).toBe(1); // air next to hidden tissue (a diagonal neighbour): the shader may draw a skin there
    expect(P[at(3, 2, 2)]).toBe(1);
    // an air voxel (not hidden itself) with hidden tissue among its 26 neighbours: drawn by the shader as a skin in places, so inside P
    const c2 = Uint8Array.from(cls), g2 = new Uint8Array(n); c2[at(4, 2, 2)] = 200; g2[at(4, 2, 2)] = 1; // only (4,2,2) is hidden tissue
    for (let z = 1; z < 4; z++) for (let y = 1; y < 4; y++) for (let x = 1; x < 8; x++) if (x !== 4 || y !== 2 || z !== 2) c2[at(x, y, z)] = 20; // the bar is gone but that one voxel
    const P2 = hiddenClassBytes({ data: c2, C: 1 }, 0, dims, [{ ids: g2, bits }], 0, new Uint8Array(n));
    expect(P2[at(4, 2, 2)]).toBe(0); expect(P2[at(3, 2, 2)]).toBe(1); expect(P2[at(5, 3, 3)]).toBe(1); expect(P2[at(6, 2, 2)]).toBe(0);
  });
  it('a slot the item is not hidden on is plain tissue (P = S); two index sources both count', () => {
    const { n, cls, G, bits } = scene([10, 6, 7], 3);
    const P = hiddenClassBytes(cls, 0, [10, 6, 7], [{ ids: G, bits }], 1, new Uint8Array(n)); // slot 1: bit 0 only
    for (let i = 0; i < n; i++) expect(P[i]).toBe(cls.data[i] >= 128 ? 1 : 0);
    const G2 = new Uint8Array(n), b2 = new Uint8Array(256); b2[2] = 1; for (let i = 0; i < n; i += 3) G2[i] = 2;
    const P2 = hiddenClassBytes(cls, 0, [10, 6, 7], [{ ids: G, bits }, { ids: G2, bits: b2 }], 0, new Uint8Array(n));
    for (let i = 0; i < n; i++) if (cls.data[i] >= 128 && (G[i] === 1 || G2[i] === 2)) expect(P2[i]).toBe(0);
  });
});

describe('hideFieldMin: never longer than the distance to visible tissue', () => {
  for (const dims of [[14, 9, 11], [12, 12, 6], [20, 7, 8]]) it('brute force on ' + dims.join('x'), () => {
    const [w, h, d] = dims, { n, cls, G, bits, sources } = scene(dims, w * 7 + h), ins = Uint8Array.from(cls.data, v => (v >= 128 ? 1 : 0));
    const ord = euclideanDistanceBytes(ins, dims), alpha = Uint8Array.from(ord), merged = hideFieldMin(alpha, { cls, chan: [0, -1, -1, -1], dims, mask: 1, sources });
    expect(merged).toBe(true);
    const vis = []; for (let i = 0; i < n; i++) if (ins[i] && !(G[i] === 1)) vis.push(i);
    let changed = 0;
    for (let i = 0; i < n; i++) {
      expect(alpha[i]).toBeLessThanOrEqual(ord[i]); // a lower bound of the ordinary field too (the old shader rule stays safe with any mix of the two)
      if (alpha[i] < ord[i]) changed++;
      if (ins[i] && G[i] !== 1) continue; // a voxel of visible tissue is a hit itself
      const x = i % w, y = Math.floor(i / w) % h, z = Math.floor(i / (w * h));
      let best = 1e9; for (const v of vis) { const q = Math.hypot((v % w) - x, (Math.floor(v / w) % h) - y, Math.floor(v / (w * h)) - z); if (q < best) best = q; }
      expect(alpha[i]).toBeLessThanOrEqual(best + 1e-9); // from every voxel that is not visible tissue: not longer than the distance to the nearest visible tissue voxel
    }
    expect(changed).toBeGreaterThan(0); // the hidden block is not a surface of the ordinary field: the new field differs there
  });
  it('a slot without a hidden part keeps the ordinary field; no shown slot with a hidden part: nothing merged', () => {
    const dims = [10, 8, 6], { n, cls, sources } = scene(dims, 5), ord = euclideanDistanceBytes(Uint8Array.from(cls.data, v => (v >= 128 ? 1 : 0)), dims), a = Uint8Array.from(ord);
    expect(hideFieldMin(a, { cls, chan: [0, -1, -1, -1], dims, mask: 2, sources })).toBe(false); // slot 0 hidden, but only slot 1 asked (no channel)
    expect(hideFieldMin(a, { cls, chan: [-1, 0, -1, -1], dims, mask: 2, sources })).toBe(false); // slot 1 has no hidden bit
    expect(Buffer.compare(Buffer.from(a), Buffer.from(ord))).toBe(0);
  });
});

describe('the body\'s cut as a hidden source (n731 perf ③)', () => {
  const tri = (f, size, C, c, p) => { const [w, h, d] = size, q = p.map(v => v - 0.5), b = q.map(Math.floor), t = q.map((v, k) => v - b[k]); let r = 0; for (let k = 0; k < 8; k++) { const o = [k & 1, (k >> 1) & 1, (k >> 2) & 1], xx = Math.min(w - 1, Math.max(0, b[0] + o[0])), yy = Math.min(h - 1, Math.max(0, b[1] + o[1])), zz = Math.min(d - 1, Math.max(0, b[2] + o[2])); r += (o[0] ? t[0] : 1 - t[0]) * (o[1] ? t[1] : 1 - t[1]) * (o[2] ? t[2] : 1 - t[2]) * f[(xx + w * (yy + h * zz)) * C + c]; } return r / 255; };
  it('partBodyHidOf: every sample near a counted voxel reads the field above 0.5 by the margin (two channels, random fields)', () => {
    const r = rnd(11), size = [17, 13, 15], C = 2, n = size[0] * size[1] * size[2], f = new Uint8Array(n * C);
    for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) { const x = i % 17, y = Math.floor(i / 17) % 13, z = Math.floor(i / 221); f[i * C + c] = Math.max(0, Math.min(255, Math.round(128 + 120 * Math.sin(x * 0.4 + c) * Math.cos(y * 0.3 - z * 0.25) + (r() - 0.5) * 40))); }
    const hid = partBodyHidOf(f, size, C); let counted = 0, samples = 0;
    expect(PART_HID_MIN).toBe(132);
    for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) {
      if (!((hid[i] >> c) & 1)) continue; counted++;
      const v = [i % 17, Math.floor(i / 17) % 13, Math.floor(i / 221)];
      expect(v.every((x, k) => x > 0 && x < size[k] - 1)).toBe(true); // never on the box's edge
      for (let k = 0; k < 20; k++) { const p = v.map(x => x + r()); expect(tri(f, size, C, c, p)).toBeGreaterThanOrEqual(PART_HID_MIN / 255 - 1e-9); samples++; }
    }
    expect(counted).toBeGreaterThan(50); expect(samples).toBeGreaterThan(1000);
  });
  it('hideFieldMin with the body\'s cut: never longer than the distance to visible tissue (brute force), shorter than the ordinary field somewhere', () => {
    const dims = [22, 14, 16], [w, h, d] = dims, { n, cls } = scene(dims, 9), ins = Uint8Array.from(cls.data, v => (v >= 128 ? 1 : 0));
    // the body's field: a ball of the cut over a box (as partFieldOf's bytes: >= 128 inside), scattered on the grid as partHideSet does
    const lo = [3, 2, 2], size = [14, 11, 12], fb = new Uint8Array(size[0] * size[1] * size[2]);
    for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) { const q = Math.hypot(x - 7, y - 5, z - 6); fb[x + size[0] * (y + size[1] * z)] = Math.max(0, Math.min(255, Math.round(255 * (0.5 + (5 - q) / 6)))); }
    const hid = partBodyHidOf(fb, size, 1), ids = new Uint8Array(n), cutAt = new Uint8Array(n);
    for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) { const o = lo[0] + x + w * (lo[1] + y + h * (lo[2] + z)), k = x + size[0] * (y + size[1] * z); ids[o] = hid[k]; cutAt[o] = fb[k] >= 128 ? 1 : 0; }
    const bits = new Uint8Array(256); for (let i = 1; i < 16; i++) if (i & 1) bits[i] = 1;
    const ord = euclideanDistanceBytes(ins, dims), alpha = Uint8Array.from(ord);
    expect(hideFieldMin(alpha, { cls, chan: [0, -1, -1, -1], dims, mask: 1, sources: [{ ids, bits }] })).toBe(true);
    const vis = []; for (let i = 0; i < n; i++) if (ins[i] && !cutAt[i]) vis.push(i); // visible: tissue the cut does not hide at the voxel centre
    let changed = 0;
    for (let i = 0; i < n; i++) {
      expect(alpha[i]).toBeLessThanOrEqual(ord[i]); if (alpha[i] < ord[i]) changed++;
      if (ins[i] && !cutAt[i]) continue;
      const x = i % w, y = Math.floor(i / w) % h, z = Math.floor(i / (w * h)); let best = 1e9;
      for (const v of vis) { const q = Math.hypot((v % w) - x, (Math.floor(v / w) % h) - y, Math.floor(v / (w * h)) - z); if (q < best) best = q; }
      expect(alpha[i]).toBeLessThanOrEqual(best + 1e-9);
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('hide state helpers', () => {
  const t = (...idx) => { const b = new Uint8Array(256); for (const [i, v] of idx) b[i] = v; return b; };
  it('match / same / any / on', () => {
    const built = [t([1, 1]), t([2, 2])];
    expect(hideBitsMatch(built, [t([1, 1]), t([2, 2])], 15)).toBe(true);
    expect(hideBitsMatch(built, [t([1, 1], [3, 1]), t([2, 2])], 15)).toBe(false); // hides MORE: not safe (the newly hidden part is inside visible tissue in the bytes)
    expect(hideBitsMatch(built, [t([1, 1]), t()], 15)).toBe(false); // item 2 of the second index is shown again
    const more = [t([1, 3]), t([2, 6])]; // item 1 also on slot 1, item 2 also on slot 2
    expect(hideBitsMatch(built, more, 15)).toBe(false); expect(hideBitsMatch(built, more, 2)).toBe(false); expect(hideBitsMatch(built, more, 4)).toBe(false);
    expect(hideBitsMatch(built, more, 1)).toBe(true); // slot 0 alone: the same
    expect(hideBitsMatch(built, [t([1, 3]), t([2, 6])], 8)).toBe(true); // only the slots that are shown count
    expect(hideBitsMatch(null, built, 15)).toBe(false);
    expect(hideBitsSame(built, [t([1, 1]), t([2, 2])])).toBe(true); expect(hideBitsSame(built, [t([1, 1]), t()])).toBe(false); expect(hideBitsSame(null, null)).toBe(true);
    expect(hideBitsAny([t(), t()])).toBe(false); expect(hideBitsAny(built)).toBe(true);
    expect(hideBitsOn(built, 1)).toBe(true); expect(hideBitsOn(built, 4)).toBe(false); expect(hideBitsOn(built, 2)).toBe(true);
  });
});


// the wiring in docs/vr-view.js (static): the page's hidden items are captured BEFORE the part patch, the shader drops the no-jump rule only through hideFieldOk (never in the programs of a part),
// hideVMode is the partner's own uniform (0), and hideTick runs after the shown set of the frame is known
import { readFileSync } from 'node:fs';
const vsrc = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
describe('vr-view.js wiring of the visible-content field', () => {
  it('the hidden items per slot are read from the tables before the part patch (a part taken out is not a hidden item)', () => {
    expect(vsrc.indexOf('hideBitsR[i]=')).toBeGreaterThan(0); expect(vsrc.indexOf('hideBitsR[i]=')).toBeLessThan(vsrc.indexOf('partPatchRegion(a);'));
    expect(vsrc.indexOf('hideBitsC[j]=')).toBeGreaterThan(0); expect(vsrc.indexOf('hideBitsC[j]=')).toBeLessThan(vsrc.indexOf('partPatchChild(a);'));
  });
  it('the shader: hideFieldOk is false in the programs of a part (the body while parts are out reads hideVMode), the uniform is declared with the hide helpers, three loops read it', () => {
    expect(vsrc).toContain('uniform int hideVMode;\n#ifdef VRL_PART\nbool hideFieldOk(){return partKind==0&&hideVMode>0;}\n#else\nbool hideFieldOk(){return hideVMode>0;}\n#endif');
    expect(vsrc.match(/prevHid&&!hideFieldOk\(\)/g)).toHaveLength(6); // opaque and see-through copies of the two tight loops and of the combined branch of the general loop
    expect(vsrc).toContain('hideVMode:{value:0}');
  });
  it('the partner owns hideVMode (always 0); hideTick runs once per frame after the content box, with the shader\'s shown set', () => {
    expect(readFileSync(new URL('../../docs/vr-pair-view.js', import.meta.url), 'utf8')).toContain("'distInCls', 'hideVMode', 'distTex'");
    expect(vsrc).toMatch(/   refreshContentBox\(\);\n   hideTick\(vis,sh\);[^\n]*\n   skipTick\(\);/);
    expect(vsrc).toContain("hide:{cls:P.cls,rgs:hideSrcs()}");
    expect(vsrc).toContain("const hideSrcs=()=>[P.region?.rg||null,P.child?.rg||null,partHideSrc()?.ids||null];");
    expect(vsrc).toContain('u.hideVMode.value=rb&&rb.hideValid(cur,vis)?1:0;');
    // a part taken out (n731 perf ③): the old rule unless the body's cut is a hide source for the field the body draws with, and the VRL_PART programs draw the body; the state leaves every part's target out
    expect(vsrc).toContain('if(!t||!(u.distInCls.value>0)){u.hideVMode.value=0;return}');
    expect(vsrc).not.toContain('if(parts.length&&(!partHideSrc()||diagAn.noRegion||!partBodySet(variantKey()))){u.hideVMode.value=0;return}'); // no state keeps the old rule now: hideCur is that of the way the body is drawn (bodyCutDraws)
    expect(vsrc).toContain('const bodyCutDraws=()=>!!(parts.length&&partHideSrc()&&!diagAn.noRegion&&partBodySet(variantKey()));');
    expect(vsrc).toContain('const cur=hideCur();let rb=t.rb;');
    expect(vsrc).toContain("for(const q of parts){const tg=q.target,i=(tg?.index|0)+1;if(i>0&&i<256)(tg.kind==='region'?hideCurR:hideCurC)[i]=0}");
    expect(vsrc).toContain("(tg.kind==='region'?hideCurR:hideCurC)[i]|=q.mask");
    expect(vsrc).toContain('partHideSrc=()=>{const r=partRes;if(!(parts.length&&r?.body?.ok))return null;if(!r.hide&&r.hidArgs&&comboT&&pageHides())partHideBuild(r,r.hidArgs.body,r.hidArgs.dims);return r.hide&&r.hide.td===(comboT?.dims||[]).join()?r.hide:null};'); // the cut source is made when the page hides something
    expect(vsrc).toContain('b.ok=true;if(!keepB||(!r.hide&&!r.hidArgs))partHideSet(r,set.body,dims);');
  });
  it('a rebuilt child index drops what the visible-content field was built from', () => {
    expect(vsrc).toContain("hideSourcesChanged=()=>{comboT?.rb?.setHideSources(P.cls,hideSrcs())};");
    expect(vsrc).toContain('childTex=tex;hideSourcesChanged();');
  });
});
