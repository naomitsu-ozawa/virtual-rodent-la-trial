import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildRegionIndexOf, buildChildIndexOf, hideIndexOf, rgIndexBytes, packIndexRg, prepWorkerSource } from '../../docs/vr-volume-prep.js';
import { gpuOwnerOrder } from '../../docs/gpu-runs.js';
import { hiddenRegionVoxelOf, regionLutAlpha } from '../../docs/region-visibility.js';
import { pickRay, hiddenTestOf } from '../../docs/webgl-volume-pick.js';
import { marchClassificationHitInfo } from '../../docs/vr-pick.js';


const src = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const box = (dims, inside) => { const out = []; for (let z = 0; z < dims[2]; z++) { const r = []; for (let y = 0; y < dims[1]; y++) { let x = 0; while (x < dims[0]) { if (!inside(x, y, z)) { x++; continue; } let e = x; while (e + 1 < dims[0] && inside(e + 1, y, z)) e++; r.push(y, x, e); x = e + 1; } } out.push(new Uint32Array(r)); } return out; };
const at = (dims, x, y, z) => x + dims[0] * (y + dims[1] * z);
const item = (runsBySlice, color = 0xff0000, segMask = 1) => ({ color, segMask, runsBySlice, mm3: 0, segmentKeys: ['bone'], rid: 0 });

describe('(d) the hide index: never grown, never dilated', () => {
  it('same grid: a hidden result does not take the voxel layer of unlabelled tissue next to it (the colour index still grows, unchanged)', () => {
    const D = [16, 16, 16], A = box(D, x => x >= 6 && x <= 8);
    const r = buildRegionIndexOf([item(A)], D, D);
    expect(r.ids[at(D, 9, 5, 5)]).toBe(1); // the colour index: grown by one voxel (VR_PREP_VERSION 7, for the colour read just behind a surface)
    expect(r.hide[at(D, 9, 5, 5)]).toBe(0); // the hide index: exactly the result's voxels
    for (let x = 0; x < 16; x++) expect(r.hide[at(D, x, 3, 3)]).toBe(x >= 6 && x <= 8 ? 1 : 0);
    // the pick / laser skip built from it skips the hidden result only
    const lut = new Float32Array(8); lut[7] = regionLutAlpha(1, { hidden: true });
    const skip = hiddenRegionVoxelOf(r.hide, D, lut, [0, -1, -1, -1]);
    expect(skip(8, 3, 3, 0)).toBe(true); expect(skip(9, 3, 3, 0)).toBe(false);
  });
  it('same grid: two results that touch keep their own voxels (where they overlap the one with FEWER voxels owns it, in either list order)', () => {
    const D = [12, 6, 6], A = box(D, x => x <= 5), B = box(D, x => x >= 5); // A: 6 columns, B: 7
    const r = buildRegionIndexOf([item(A, 1), item(B, 2)], D, D);
    for (let x = 0; x < 12; x++) expect(r.hide[at(D, x, 2, 2)]).toBe(x <= 5 ? 1 : 2);
    const q = buildRegionIndexOf([item(B, 2), item(A, 1)], D, D);
    for (let x = 0; x < 12; x++) expect(q.hide[at(D, x, 2, 2)]).toBe(x <= 5 ? 2 : 1);
  });
  it('reduced grid: two items whose border lies on a grid-cell border keep their own grid voxels (the neighbour is not eaten; the old dilation took one layer)', () => {
    const S = [16, 8, 8], T = [8, 4, 4], A = box(S, x => x >= 4 && x <= 7), B = box(S, x => x >= 8 && x <= 11);
    const c = buildChildIndexOf([{ key: 'b', segMask: 1, runsBySlice: B }, { key: 'a', segMask: 1, runsBySlice: A }], S, T); // A (hidden later) is the later child
    expect(c.ids[at(T, 4, 1, 1)]).toBe(2); // the colour index as before: A dilated by one grid voxel takes B's first grid voxel
    for (let x = 0; x < 8; x++) expect(c.hide[at(T, x, 1, 1)]).toBe(x === 2 || x === 3 ? 2 : x === 4 || x === 5 ? 1 : 0);
  });
  it('reduced grid: a thin item (one source voxel) next to unlabelled tissue still covers the grid voxel it touches (no sliver of a hidden one is left)', () => {
    const S = [16, 8, 8], T = [8, 4, 4], thin = box(S, x => x === 5);
    const h = hideIndexOf([thin], S, T);
    for (let x = 0; x < 8; x++) expect(h[at(T, x, 2, 2)]).toBe(x === 2 ? 1 : 0);
    const r = buildRegionIndexOf([item(thin)], S, T);
    expect(Array.from(r.hide)).toEqual(Array.from(h));
  });
  it('reduced grid: of the items in a grid voxel the one with fewer voxels owns it, equal counts the later item; an odd ratio stays inside the grid', () => {
    const S = [8, 4, 4], T = [4, 2, 2], A = box(S, x => x === 4), B = box(S, x => x === 5);
    expect(hideIndexOf([A, B], S, T)[at(T, 2, 1, 1)]).toBe(2); expect(hideIndexOf([B, A], S, T)[at(T, 2, 1, 1)]).toBe(2);
    const B2 = box(S, (x, y) => x === 5 || (x === 7 && y === 0)); // B2 has more voxels (4 more on x 7): the 4 : 4 tie at grid x 2 goes to A in either order
    expect(hideIndexOf([A, B2], S, T)[at(T, 2, 1, 1)]).toBe(1); expect(hideIndexOf([B2, A], S, T)[at(T, 2, 1, 1)]).toBe(2);
    expect(gpuOwnerOrder([B2, null, A], S)).toEqual([0, 2]); // the paint order: more voxels first (the last painted owns)
    const S2 = [7, 5, 3], T2 = [3, 2, 2], all = box(S2, () => true), h = hideIndexOf([all], S2, T2);
    expect(h.length).toBe(12); expect(Array.from(h).every(v => v === 1)).toBe(true);
  });
  it('the RG8 texture bytes: R = the colour index, G = the hide index (without one: the colour index, the old rule)', () => {
    expect(Array.from(rgIndexBytes(new Uint8Array([1, 2, 0]), new Uint8Array([0, 2, 3])))).toEqual([1, 0, 2, 2, 0, 3]);
    expect(Array.from(rgIndexBytes(new Uint8Array([4, 5]), null))).toEqual([4, 4, 5, 5]);
    // packIndexRg: the ONE array kept (the texture's bytes, read by the picks two bytes apart); ids and hide are not kept beside it
    const p = packIndexRg({ ids: new Uint8Array([1, 2]), hide: new Uint8Array([3, 4]), list: [1] });
    expect(Array.from(p.rg)).toEqual([1, 3, 2, 4]); expect('ids' in p).toBe(false); expect('hide' in p).toBe(false); expect(p.list).toEqual([1]);
    expect(packIndexRg({ ids: null, hide: null, list: [] }).rg).toBeNull(); expect(packIndexRg(null)).toBeNull();
  });
  it('the worker source builds the same hide index (self-contained)', () => {
    const ws = prepWorkerSource().replace(/\(0,\s*__vite_ssr_import_\d+__\.(\w+)\)/g, '$1').replace(/__vite_ssr_import_\d+__\./g, ''); // the vitest import rewrite undone (as region-index-block.test.js)
    const fn = new Function('self', ws + '\nreturn {buildRegionIndexOf, buildChildIndexOf, packIndexRg};')({ postMessage() {} });
    expect(typeof fn.packIndexRg).toBe('function');
    const S = [16, 8, 8], T = [8, 4, 4], A = box(S, x => x >= 3 && x <= 9);
    expect(Array.from(fn.buildRegionIndexOf([item(A)], S, T).hide)).toEqual(Array.from(buildRegionIndexOf([item(A)], S, T).hide));
    expect(Array.from(fn.buildChildIndexOf([{ key: 'a', segMask: 1, runsBySlice: A }], S, T).hide)).toEqual(Array.from(buildChildIndexOf([{ key: 'a', segMask: 1, runsBySlice: A }], S, T).hide));
  });
});

describe('the picks go through the hidden part and stop at the neighbour (synthetic volume, reduced grid)', () => {
  // 16 x 8 x 8 source, tissue everywhere at x 4..11; child A (hidden) = x 4..7, child B (shown) = x 8..11; the index grid is 8 x 4 x 4 (as VR's 256 grid of 512 data)
  const S = [16, 8, 8], T = [8, 4, 4], A = box(S, x => x >= 4 && x <= 7), B = box(S, x => x >= 8 && x <= 11);
  const c = buildChildIndexOf([{ key: 'b', segMask: 1, runsBySlice: B }, { key: 'a', segMask: 1, runsBySlice: A }], S, T);
  const slotsOf = id => (id === 2 ? 1 : 0); // child 2 (A) hidden on slot 0
  it('pickRay (PC WebGL): the hit is B\'s first voxel, not one grid voxel deeper', () => {
    const data = new Uint8Array(16 * 8 * 8 * 2); for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 4; x <= 11; x++) { const o = at(S, x, y, z) * 2; data[o] = 1000 & 255; data[o + 1] = 1000 >> 8; }
    const base = { data, dims: S, calibration: [1, 0, 0], halfExt: [1, 0.5, 0.5], step: 0.02, origin: [-1.5, 0.01, 0.01], dir: [1, 0, 0], segs: [{ min: 500, max: 2000, enabled: true }, {}, {}, {}].map(s => ({ min: 0, max: 0, enabled: false, ...s })) };
    expect(pickRay(base).x).toBe(4); // nothing hidden: A's first voxel
    const now = pickRay({ ...base, hidden: hiddenTestOf([{ ids: c.hide, dims: T, slotsOf, any: true }]) });
    expect(now.x).toBe(8);
    const old = pickRay({ ...base, hidden: hiddenTestOf([{ ids: c.ids, dims: T, slotsOf, any: true }]) }); // the dilated colour index (the rule before): B's first two voxels were skipped
    expect(old.x).toBeGreaterThan(9);
  });
  it('the VR laser march (classification on the index grid): the hit is B\'s first grid voxel', () => {
    const cls = { C: 1, data: new Uint8Array(8 * 4 * 4) }; for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 2; x <= 5; x++) cls.data[at(T, x, y, z)] = 255;
    const lut = new Float32Array(4 * 3); // the child table's hide bits are emulated with a result table: id 2 hidden on slot 0
    lut[4 * 2 + 3] = regionLutAlpha(1, { hidden: true });
    const o = { x: -1.5, y: 0.01, z: 0.01 }, q = { x: 1, y: 0, z: 0 };
    const hit = marchClassificationHitInfo(o, q, [1, 0.5, 0.5], T, cls, [0], [], 0, 0, 0, Infinity, hiddenRegionVoxelOf(c.hide, T, lut, [0, -1, -1, -1]));
    expect(hit.x).toBe(4);
  });
});

describe('the VR / PC WebGL shader (a)-(c): only on a ray that passed a hidden part', () => {
  const v = src('vr-view.js');
  it('(a) no distance-field jump from a hidden sample, in every loop (two tight copies, the combined and the distance path of the general loop)', () => {
    expect(v.match(/#ifdef VRL_HIDE\n#ifdef VRL_OPAQUE\n {3}if\(prevHid&&!hideFieldOk\(\)\)dd=0\.0;[^\n]*\n#else\n {3}if\(\(prevHid&&!hideFieldOk\(\)\)\|\|\(lastIndex>=0&&hideAnyOn\(\)\)\)dd=0\.0;[^\n]*\n#endif\n/g)).toHaveLength(3); // unless the combined alpha is the field of the visible content (hideVMode, vr-hide-field.js); the distance path below keeps the plain rule
    expect(v).toMatch(/#ifdef VRL_HIDE\n#ifdef VRL_OPAQUE\n {4}if\(prevHid\)dd=0\.0;[^\n]*\n#else\n {4}if\(prevHid\|\|\(lastIndex>=0&&hideAnyOn\(\)\)\)dd=0\.0;[^\n]*\n#endif\n/);
    // review 1: on a see-through path, inside the segment the ray is in (lastIndex >= 0), no jump either while something is hidden (a jump could cross a thin hidden part); the opaque path as before
    // and none from the FIRST sample when it lies in a hidden part (a hidden cap point, the eye inside the box): tested ONCE per ray before the loops (prevHid), only while something is hidden
    expect(v).not.toContain('t<=t0)');
    expect(v).toContain(' bool prevHid=false;\n'); expect(v).toContain('if(hideAnyOn()){vec3 tcS=tcO+tcD*t;int si=segmentIndexAt(tcS);if(si>=0&&hideAt(tcS,si))prevHid=true;}');
    expect(v.indexOf('if(hideAnyOn()){vec3 tcS=')).toBeLessThan(v.indexOf('for(int iter=0;iter<4096;iter++)'));
    expect(v.match(/prevHid=hidNow;/g)).toHaveLength(3); // set at the end of every sample of the three loops
    expect(v.match(/hidNow=passH;/g)).toHaveLength(3);
    expect(v.match(/prevValid=true;prevSkip=true;lastIndex=-1;prevHid=false;/g)).toHaveLength(2); // a skipped (empty) sample clears it
  });
  it('(b) the hit search: inside = in the segment and NOT in a hidden part, nor in the air cell beside one (hideSkinAt = hideAt || hideCellAt, one call), at all four search sites (n730: also a hit not after a hidden part; no secant search while something is hidden)', () => {
    expect(v.match(/if\(inside&&hideAnyOn\(\)&&hideSkinAt\(tcO\+tcD\*mid,idx\)\)inside=false;/g)).toHaveLength(3); // the two see-through copies and the one after the loops
    expect(v).toContain('if(segmentIndexAt(tm)==idx&&!(hideAnyOn()&&hideSkinAt(tm,idx)))hi=mid;else lo=mid;');
    // the part's programs: after a hidden part, any shown segment (its own slot), else the hit's segment while something is hidden: one call for both
    expect(v).toContain('{int hs=idx;bool hc=inside&&hideAnyOn();');
    expect(v).toContain('inside=hs>=0;hc=inside;}');
    expect(v).toContain('if(hc&&hideSkinAt(tcO+tcD*mid,hs))inside=false;}');
    expect(v).not.toMatch(/\(hideAt\((tcO\+tcD\*mid|tm),(idx|sm)\)\|\|hideCellAt\(/); // no search site calls the two bodies itself
    expect(v).toContain('bool hideSkinAt(vec3 tc,int s){return hideAt(tc,s)||hideCellAt(tc,s);}'); // with a part: hideAt reads the part's re-pointed tests
    // the secant search has no hidden test: while something is hidden the bisection (with it) finds every hit
    expect(v.match(/if\(!simple&&iso&&!hideAnyOn\(\)\)\{float f0=prevF;/g)).toHaveLength(3);
    expect(v).toContain('else if(hitIso&&!hideAnyOn()){');
    expect(v).toContain('else if(hitIso&&!hitHid&&!hideAnyOn()){');
    expect(v.match(/hitHid=prevHid;/g)).toHaveLength(4); // the deferred hit carries it (opaque and translucent, two copies each)
  });
  it('(c) the normal of that hit is the hidden part\'s border (hideGrad over one voxel of the index grid), lit as a face (not flipped)', () => {
    expect(v.match(/vec3 hn=prevHid&&!simple&&!face\?hideGrad\(tc,idx\):vec3\(0\.0\);bool hcut=dot\(hn,hn\)>0\.0;/g)).toHaveLength(3);
    expect(v).toContain('vec3 hn=hitHid&&!hitSimple&&!face?hideGrad(tc,idx):vec3(0.0);bool hcut=dot(hn,hn)>0.0;');
    expect(v.match(/\(hcut\?normalize\(hn\):gradientAt\(tc\)\)\);face=face\|\|hcut;/g)).toHaveLength(4);
    expect(v).toContain('vec3 d=1.0/max(vec3(textureSize(childTex,0)),vec3(1.0));');
  });
  it('(d) the hidden tests read the G channel (the hide index); the colour reads stay on R', () => {
    expect(v).toContain('int i=int(texture(regionTex,clamp(tc,vec3(0.0),vec3(0.999999))).g*255.0+0.5);');
    expect(v).toContain('int childHideIdAt(vec3 tc){return int(texture(childTex,clamp(tc,vec3(0.0),vec3(0.999999))).g*255.0+0.5);}');
    expect(v).toContain('int i=int(texture(regionTex,clamp(texCoord(p),vec3(0.0),vec3(0.999999))).r*255.0+0.5);'); // regionColor
    expect(v).toContain('int childIdAt(vec3 tc){return int(texture(childTex,clamp(tc,vec3(0.0),vec3(0.999999))).r*255.0+0.5);}');
    expect(v).not.toMatch(/childHiddenAt\([^)]*,chE\)/);
    // where the colour index's item is the HIDDEN one (grown / dilated / nearest on a reduced grid) the voxel takes the colour / material of the hide index's own item
    expect(v).toContain('if(regionAnyHidden!=0&&((int(e.a+0.5)>>(8+s))&1)==1){int j=int(texture(regionTex,clamp(texCoord(p),vec3(0.0),vec3(0.999999))).g*255.0+0.5);if(j<1||j==i)return base;e=texelFetch(regionLut,ivec2(j,0),0);}');
    expect(v).toContain('if(((int(e.a+0.5)>>s)&1)==0&&((int(texelFetch(childLut,ivec2(i,1),0).a+0.5)>>s)&1)==1){int j=childHideIdAt(texCoord(p));if(j<1||j==i)return base;e=texelFetch(childLut,ivec2(j,0),0);}');
    expect(v.match(/passH=childHiddenAt\((tcO\+tcD\*t|tc0),idx\);if\(!passH&&\(\(int\(chE\.a\+0\.5\)>>idx\)&1\)==1\)\{chI=childHideIdAt\(/g)).toHaveLength(3);
    expect(src('webgl-volume.js')).toContain('i=j==i?0:j;}');
  });
  it('the textures are RG8 everywhere they are made (the session, the coarse switch, the child rebuild, the partner, the PC WebGL page), from the ONE RG array that is kept (no ids / hide beside it)', () => {
    expect(v).not.toMatch(/\b(region|child|P2\.region|Pn\.region|Pn\.child|ch|g|vp)\??\.(ids|hide)\b/); // nothing reads a separate colour / hide array any more
    expect(v.match(/slicedTexture\([^;]*\.rg,[^;]*,2,THREE\.RGFormat/g)).toHaveLength(4); // the coarse switch (results, children), the child rebuild, the partner
    expect(v).toContain('new THREE.Data3DTexture(g.rg,...g.dims)');
    expect(v).toContain("['regionRg',P.region.rg],['childRg',P.child?.rg]"); expect(v).toContain('rg:a.regionRg||null');
    expect(v).toContain('hiddenRegionVoxelOf(vp.rg,vp.dims,regionLut.image.data,vp.cls.chan,2,1)'); expect(v).toContain('hiddenRegionVoxelOf(pt.vp.rg,pt.vp.dims,pt.lut.image.data,pt.vp.cls.chan,2,1)'); expect(v).toContain('id=rg[2*k+1];');
    expect(v).toContain('packIndexRg(buildChildIndexOf(items,'); expect(src('vr-volume-prep.js')).toContain('region = packIndexRg(buildRegionIndexOf(');
    const w = src('webgl-volume.js');
    expect(w.match(/packIndexRg\(build(Region|Child)IndexOf\(/g)).toHaveLength(2); expect(w).not.toContain('rgIndexBytes');
    expect(w).toContain('rids = this.regionTexture ? this.regionRg : null'); expect(w).toContain('cids = this.hasChildren && this.childTexture ? this.childRg : null');
    expect(w.match(/stride: 2, off: 1/g)).toHaveLength(2);
    expect(src('comment-3d-hidden.js')).toContain('hiddenRegionVoxelOf(idx.hide||idx.ids,');
  });
});

describe('the egg: an item inside another keeps its shape when the outer one is hidden (hide index, picks, VR / PC WebGL / children)', () => {
  const N = 32, S = [N, N, N], T = [16, 16, 16];
  const ball = (c, r) => (x, y, z) => Math.hypot(x - c, y - c, z - c) <= r;
  const plate = (a, b) => (x, y, z) => x === 15 && y >= a && y <= b && z >= a && z <= b; // one voxel thick, in the white
  const not = (f, g) => (x, y, z) => f(x, y, z) && !g(x, y, z);
  // counts of a hide index h on grid G (S or T) for the source voxels of yolk Y and white W (white minus yolk): yolk voxels owned by the white (lost when the white is hidden), white voxels owned by the yolk
  // (lost when the yolk is hidden), and the grid voxels the yolk owns
  const tally = (h, G, Y, W, yi, wi) => {
    const r = G[0] / N; let yolkLost = 0, whiteLost = 0, yolkAll = 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const g = h[at(G, Math.floor(x * r), Math.floor(y * r), Math.floor(z * r))];
      if (Y(x, y, z)) { yolkAll++; if (g === wi) yolkLost++; } else if (W(x, y, z) && g === yi) whiteLost++;
    }
    return { yolkLost, whiteLost, yolkAll };
  };
  const cases = (Y, Wf, shell) => { const W = shell ? not(Wf, Y) : Wf, y = box(S, Y), w = box(S, W); return { Y, W: not(W, Y), orders: [['white first', [w, y], 2, 1], ['yolk first', [y, w], 1, 2]] }; };
  for (const shell of [false, true]) {
    const kind = shell ? 'the white has a hole where the yolk is (no overlap)' : 'the white covers the yolk (overlap)';
    it('(1) ' + kind + ': same grid and reduced grid, both list orders: hiding the white hides NO yolk voxel; (3) hiding the yolk hides the yolk only (same grid: exactly; reduced: grid voxels the yolk fills at least half of)', () => {
      const { Y, W, orders } = cases(ball(15.5, 5), ball(15.5, 12), shell);
      for (const [name, items, yi, wi] of orders) {
        const same = tally(hideIndexOf(items, S, S), S, Y, W, yi, wi), red = tally(hideIndexOf(items, S, T), T, Y, W, yi, wi);
        expect(same, name).toEqual({ yolkLost: 0, whiteLost: 0, yolkAll: 552 });
        expect(red.yolkLost, name).toBe(0);
        expect(red.whiteLost, name).toBe(152); // the white voxels in the grid voxels the yolk has any voxel in (the yolk owns them): they go with the hidden yolk on the reduced grid
      }
    });
    it('(1) ' + kind + ', the yolk NOT symmetric about the grid-cell borders (centre 15): still no yolk voxel hidden with the white; LIMIT: hiding the yolk takes 277 white voxels with it on the reduced grid (the grid voxels the yolk has any voxel in); same grid: none', () => {
      const { Y, W, orders } = cases(ball(15, 5), ball(15, 12), shell);
      for (const [name, items, yi, wi] of orders) {
        expect(tally(hideIndexOf(items, S, S), S, Y, W, yi, wi), name).toEqual({ yolkLost: 0, whiteLost: 0, yolkAll: 515 });
        const red = tally(hideIndexOf(items, S, T), T, Y, W, yi, wi);
        expect(red.yolkLost, name).toBe(0); expect(red.whiteLost, name).toBe(277);
      }
    });
    it('(2) ' + kind + ', a one-voxel plate yolk: kept whole on the reduced grid in both orders (the plate has fewer voxels: it owns every grid voxel it touches); its grid voxels go with it when it is hidden', () => {
      const { Y, W, orders } = cases(plate(10, 21), ball(15.5, 12), shell);
      for (const [name, items, yi, wi] of orders) {
        expect(tally(hideIndexOf(items, S, S), S, Y, W, yi, wi), name).toEqual({ yolkLost: 0, whiteLost: 0, yolkAll: 144 });
        expect(tally(hideIndexOf(items, S, T), T, Y, W, yi, wi), name).toEqual({ yolkLost: 0, whiteLost: 144, yolkAll: 144 });
      }
    });
    it('(2) ' + kind + ', a one-voxel plate whose edges are not on grid-cell borders (y, z 11..21): kept whole too; LIMIT: hiding it takes 167 white voxels with it on the reduced grid', () => {
      const { Y, W, orders } = cases(plate(11, 21), ball(15.5, 12), shell);
      for (const [name, items, yi, wi] of orders) {
        expect(tally(hideIndexOf(items, S, S), S, Y, W, yi, wi).yolkLost, name).toBe(0);
        expect(tally(hideIndexOf(items, S, T), T, Y, W, yi, wi), name).toEqual({ yolkLost: 0, whiteLost: 167, yolkAll: 121 });
      }
    });
  }
  it('(4) the yolk in ANOTHER segment (slot 1, the white on slot 0): hiding the white leaves the yolk shown, also on the white\'s slot; the white\'s own voxels are hidden (results, reduced grid)', () => {
    const Y = ball(15.5, 5), W = ball(15.5, 12), y = box(S, Y), w = box(S, W);
    for (const [items, wid] of [[[item(w, 1, 1), item(y, 2, 2)], 1], [[item(y, 2, 2), item(w, 1, 1)], 2]]) {
      for (const G of [S, T]) {
        const r = buildRegionIndexOf(items, S, G), lut = new Float32Array(12); lut[4 * wid + 3] = regionLutAlpha(1, { hidden: true });
        const skip = hiddenRegionVoxelOf(r.hide, G, lut, [0, 1, -1, -1]), q = G[0] / N, g = v => Math.floor(v * q);
        for (const [x, yy, z] of [[11, 15, 15], [15, 15, 15], [20, 16, 16]]) { expect(skip(g(x), g(yy), g(z), 1)).toBe(false); expect(skip(g(x), g(yy), g(z), 0)).toBe(false); }
        expect(skip(g(5), g(15), g(15), 0)).toBe(true); // the white alone: hidden
      }
    }
  });
  it('(5) the same for child segments (buildChildIndexOf: the hide index, never dilated), both orders, same and reduced grid', () => {
    for (const shell of [false, true]) {
      const { Y, W, orders } = cases(ball(15.5, 5), ball(15.5, 12), shell);
      for (const [name, items, yi, wi] of orders) {
        const kids = items.map((runsBySlice, i) => ({ key: 'k' + i, segMask: 1, runsBySlice }));
        expect(tally(buildChildIndexOf(kids, S, S).hide, S, Y, W, yi, wi), name).toEqual({ yolkLost: 0, whiteLost: 0, yolkAll: 552 });
        const red = tally(buildChildIndexOf(kids, S, T).hide, T, Y, W, yi, wi); expect(red.yolkLost, name).toBe(0); expect(red.whiteLost, name).toBe(152);
      }
      const P = cases(plate(10, 21), ball(15.5, 12), shell);
      for (const [name, items, yi, wi] of P.orders) {
        const kids = items.map((runsBySlice, i) => ({ key: 'k' + i, segMask: 1, runsBySlice }));
        expect(tally(buildChildIndexOf(kids, S, T).hide, T, P.Y, P.W, yi, wi).yolkLost, name).toBe(0);
      }
    }
    // the yolk child on another slot (its parent is another segment) stays shown on its slot when the white child is hidden
    const y = box(S, ball(15.5, 5)), w = box(S, ball(15.5, 12)), c = buildChildIndexOf([{ key: 'w', segMask: 1, runsBySlice: w }, { key: 'y', segMask: 2, runsBySlice: y }], S, T);
    expect(c.hide[at(T, 7, 7, 7)]).toBe(2); expect(c.hide[at(T, 2, 7, 7)]).toBe(1);
  });
  it('(6) the picks: with the white hidden the laser / the PC pick hit the yolk\'s first voxel (pickRay on the data grid with the reduced RG index, read two bytes apart; the VR march on the index grid)', () => {
    const Y = ball(15.5, 5), W = ball(15.5, 12);
    for (const items of [[box(S, W), box(S, Y)], [box(S, Y), box(S, W)]]) {
      const whiteId = hideIndexOf(items, S, T)[at(T, 2, 7, 7)]; expect(whiteId).toBeGreaterThan(0);
      const kids = items.map((runsBySlice, i) => ({ key: 'k' + i, segMask: 1, runsBySlice })), r = packIndexRg(buildChildIndexOf(kids, S, T)), rs = packIndexRg(buildChildIndexOf(kids, S, S));
      const slotsOf = id => (id === whiteId ? 1 : 0);
      const data = new Uint8Array(N * N * N * 2); for (let z = 0; z < N; z++) for (let yy = 0; yy < N; yy++) for (let x = 0; x < N; x++) if (W(x, yy, z)) { const o = at(S, x, yy, z) * 2; data[o] = 1000 & 255; data[o + 1] = 1000 >> 8; }
      const base = { data, dims: S, calibration: [1, 0, 0], halfExt: [1, 1, 1], step: 0.01, origin: [-1.5, 0.01, 0.01], dir: [1, 0, 0], segs: [{ min: 500, max: 2000, enabled: true }, {}, {}, {}].map(s => ({ min: 0, max: 0, enabled: false, ...s })) };
      expect(pickRay(base).x).toBe(4); // nothing hidden: the white's first voxel on that line
      expect(pickRay({ ...base, hidden: hiddenTestOf([{ ids: rs.rg, stride: 2, off: 1, dims: S, slotsOf, any: true }]) }).x).toBe(11); // index on the data grid: the yolk's first voxel (x 11..20 on that line)
      expect(pickRay({ ...base, hidden: hiddenTestOf([{ ids: r.rg, stride: 2, off: 1, dims: T, slotsOf, any: true }]) }).x).toBe(10); // index on the reduced grid: the start of the yolk's first grid voxel (source x 10, 11: the yolk has voxels there, so it owns it), one white layer in it
      const cls = { C: 1, data: new Uint8Array(16 * 16 * 16) }; for (let z = 0; z < N; z++) for (let yy = 0; yy < N; yy++) for (let x = 0; x < N; x++) if (W(x, yy, z)) cls.data[at(T, x >> 1, yy >> 1, z >> 1)] = 255;
      const lut = new Float32Array(4 * 3); lut[4 * whiteId + 3] = regionLutAlpha(1, { hidden: true });
      const hit = marchClassificationHitInfo({ x: -1.5, y: 0.01, z: 0.01 }, { x: 1, y: 0, z: 0 }, [1, 1, 1], T, cls, [0], [], 0, 0, 0, Infinity, hiddenRegionVoxelOf(r.rg, T, lut, [0, -1, -1, -1], 2, 1));
      expect(hit.x).toBe(5); // the yolk's first grid voxel (source x 10, 11)
    }
  });
});

describe('the shader follow-up (see-through hidden part, the child look, the gate)', () => {
  const v = src('vr-view.js');
  it('a hidden part met INSIDE the segment a see-through ray is in is left like one met from outside (the far cut face is drawn), only while something is hidden, never on the opaque path', () => {
    const tight = 'else if(idx>=0&&hideAnyOn()&&hideAt(tcO+tcD*t,idx)){lastIndex=-1;hidNow=true;}\n#endif\n   prevHid=hidNow;';
    expect(v.split(tight)).toHaveLength(3); // both tight loops
    for (let at = v.indexOf(tight); at >= 0; at = v.indexOf(tight, at + 1)) { const before = v.slice(0, at); expect(before.lastIndexOf('#ifndef VRL_OPAQUE')).toBeGreaterThan(before.lastIndexOf('#endif')); } // never on the opaque path
    expect(v).toContain('else if(idx>=0&&hideAnyOn()&&hideAt(tc0,idx)){lastIndex=-1;hidNow=true;}');
    expect(v).toContain('brickEnd>t+step&&!hideAnyOn()){'); // the general loop's uniform-brick skip is off while something is hidden
    expect(v).toContain('bool hideAnyOn(){'); expect(v).toContain('uniform int childAnyHidden;');
    expect(v).toContain("material.uniforms.childAnyHidden.value=any}"); expect(v).toContain('u2.childAnyHidden.value=0;');
    expect(src('webgl-volume.js')).toContain('u.childAnyHidden.value = any;');
  });
  it('the cut face and the slice take the child look of the child the colour takes (R; a hidden one there: G), as childBase', () => {
    expect(v).toContain('int childLookIdAt(vec3 tc,int s){');
    expect(v).toContain(' childLook(childLookIdAt(texCoord(p),si),si);');
    expect(v.match(/if\(ci>=0\)childLook\(childLookIdAt\(texCoord\(cp\),ci\),ci\);/g)).toHaveLength(2);
    expect(v).not.toContain('childLook(childIdAt(');
  });
  it('the VR HU histogram marks a hidden result / child by the hide index (G, rg[2 i + 1]), as the shader (review 2)', () => {
    expect(v).toContain('const rg=g.rg;for(let i=0;i<d.length;i++){const v=mr[rg[2*i+1]];if(v)d[i]=v}}');
    expect(v).toContain('const rg=ch.rg;for(let i=0;i<d.length;i++){const v=mk[rg[2*i+1]];if(v)d[i]=v}}');
  });
  it("the laser label / pin: where the colour index's result or child is HIDDEN, the hide index's own one (as the shader's colour)", () => {
    expect(v).toContain('id0=idR&&regionHiddenVr(regionList[idR-1]?.rid)&&idG!==idR?idG:idR,');
    expect(v).toContain('id0=idR&&hidOf(idR)&&idG!==idR?idG:idR,'); // the partner
    expect(v).toContain('off=cr&&si>=0&&((Math.round(ca[1024+cr*4+3])>>si)&1)===1?1:0;childKey=childKeyAtHit(ch.rg,childList,k2+off,si)');
  });
});
