import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAIR_GAP, pairOffsetX, PAIR_UNIFORMS, pairUniforms, shiftPlanes, pairShownMask, pairHeldMask, pairSlotShown } from '../../docs/vr-pair-view.js';
import { createUploadQueue } from '../../docs/vr-data-switch.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const V4 = (x = 0, y = 0, z = 1, w = 0) => ({ x, y, z, w, set(a, b, c, d) { this.x = a; this.y = b; this.z = c; this.w = d; return this; } });

describe('where the partner sits', () => {
  it('side by side along x: the half widths plus a gap of PAIR_GAP of the wider one', () => {
    expect(pairOffsetX([1.65, 1, 1], [1.65, 1, 1])).toBeCloseTo(3.3 + PAIR_GAP * 1.65, 12);
    expect(pairOffsetX([1, 2, 3], [0.5, 9, 9])).toBeCloseTo(1.5 + PAIR_GAP * 1, 12);
    expect(pairOffsetX([0.5, 1, 1], [2, 1, 1])).toBeCloseTo(2.5 + PAIR_GAP * 2, 12);
  });
  it('the boxes never overlap (the gap is positive)', () => { for (const [a, b] of [[1, 1], [0.1, 3], [3, 0.1]]) expect(pairOffsetX([a], [b])).toBeGreaterThan(a + b); });
});

describe('the uniforms of the volume shader are all placed', () => {
  const block = (() => { const i = src.indexOf('const volumeUniforms=(vd,full,settings)=>({'); const j = src.indexOf('// ---- GPU preparation before the session', i); return src.slice(i, j); })();
  const keys = [...block.matchAll(/(?:^|[,{ \n])([A-Za-z0-9]+):\{value:/g)].map(m => m[1]);
  it('every uniform volumeUniforms makes is in exactly one of shared / frame / own (a new uniform must be placed in docs/vr-pair-view.js)', () => {
    expect(keys.length).toBeGreaterThan(40);
    const all = Object.values(PAIR_UNIFORMS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...new Set(keys)].sort());
  });
  it('pairUniforms: the shared keys are the primary\'s own objects, everything else the partner\'s', () => {
    const primary = Object.fromEntries(keys.map(k => [k, { value: 'p' + k }])), fresh = Object.fromEntries(keys.map(k => [k, { value: 'f' + k }]));
    const u = pairUniforms(fresh, primary);
    for (const k of PAIR_UNIFORMS.shared) expect(u[k]).toBe(primary[k]);
    for (const k of [...PAIR_UNIFORMS.frame, ...PAIR_UNIFORMS.own]) expect(u[k]).toBe(fresh[k]);
  });
  it('the shared view uniforms are the ones the frame loop of the primary writes (sections, slice look, cut, quality)', () => {
    for (const k of ['planeCount', 'sliceOpacity', 'sliceTint', 'sliceWindow', 'sliceAir', 'capOn', 'ctShade', 'refine']) expect(PAIR_UNIFORMS.shared).toContain(k);
    for (const k of ['cutPlanes', 'planeCut']) { expect(PAIR_UNIFORMS.frame).toContain(k); expect(PAIR_UNIFORMS.shared).not.toContain(k); }
    for (const k of ['vol', 'clsTex', 'halfExt', 'calib', 'texDims', 'regionTex']) expect(PAIR_UNIFORMS.own).toContain(k);
  });
});

describe('shiftPlanes', () => {
  it('a plane of the primary\'s object space is the same plane in the partner\'s (offset along x)', () => {
    const n = [0.6, 0.3, 0.74], l = Math.hypot(...n), nn = n.map(v => v / l), w = 0.25, delta = [3.5, 0, 0];
    const out = [V4(), V4()];
    shiftPlanes([{ x: nn[0], y: nn[1], z: nn[2], w }], 1, delta, out);
    // a point on the plane in the primary's space, p, is q = p - delta in the partner's: dot(n, q) must equal the new w
    const p = [w * nn[0] + 0.1 * nn[1] * -1, w * nn[1] + 0.1 * nn[0], w * nn[2]]; // any point with dot(n, p) = w: w*n + a vector perpendicular to n
    const perp = [-nn[1], nn[0], 0], pp = [w * nn[0] + 2 * perp[0], w * nn[1] + 2 * perp[1], w * nn[2] + 2 * perp[2]];
    expect(nn[0] * pp[0] + nn[1] * pp[1] + nn[2] * pp[2]).toBeCloseTo(w, 12);
    const q = [pp[0] - delta[0], pp[1] - delta[1], pp[2] - delta[2]];
    expect(nn[0] * q[0] + nn[1] * q[1] + nn[2] * q[2]).toBeCloseTo(out[0].w, 12);
    expect([out[0].x, out[0].y, out[0].z]).toEqual(nn); void p;
  });
  it('only the first `count` planes are written; a plane along the offset moves by its normal x delta', () => {
    const out = [V4(9, 9, 9, 9), V4(9, 9, 9, 9)];
    shiftPlanes([{ x: 1, y: 0, z: 0, w: 5 }, { x: 0, y: 1, z: 0, w: 5 }], 1, [3, 1, 0], out);
    expect(out[0]).toMatchObject({ x: 1, y: 0, z: 0, w: 2 });
    expect(out[1]).toMatchObject({ x: 9, w: 9 }); // untouched
  });
  it('no offset: the same planes', () => {
    const out = [V4()]; shiftPlanes([{ x: 0, y: 0, z: 1, w: 0.4 }], 1, [0, 0, 0], out); expect(out[0]).toMatchObject({ x: 0, y: 0, z: 1, w: 0.4 });
  });
});

describe('the partner\'s slots (its own order; the primary\'s state looked up by KEY)', () => {
  const order = ['soft', 'bone', 'fat', 'lung'], chan = [0, 1, -1, -1];
  it('a slot is shown when the primary shows that segment key and the partner has data in it', () => {
    expect(pairShownMask(order, chan, k => k === 'bone')).toBe(0b0010);
    expect(pairShownMask(order, chan, () => true)).toBe(0b0011); // fat / lung have no channel: never
    expect(pairShownMask(order, chan, () => false)).toBe(0);
    expect(pairShownMask(['bone', undefined, 'soft', 'fat'], [0, -1, 1, 2], () => true)).toBe(0b1101);
    expect(pairShownMask(order, null, () => true)).toBe(0b1111);
  });
  it('the order of the partner, not the primary: the same keys in another slot order give the bits of those slots', () => {
    const shown = k => k === 'bone';
    expect(pairShownMask(['bone', 'soft', 'fat', 'lung'], [0, 1, 2, 3], shown)).toBe(0b0001);
    expect(pairShownMask(['soft', 'bone', 'fat', 'lung'], [0, 1, 2, 3], shown)).toBe(0b0010);
  });
  it('held / safe: a segment just shown appears once it is in the texture; held while none of the wanted ones is', () => {
    expect(pairHeldMask(0b0100, 0b0011)).toBe(0b0011); // wanted only slot 2, the texture holds 0 / 1: those stay
    expect(pairHeldMask(0b0110, 0b0011)).toBe(0); // one of the wanted ones is in the texture
    expect(pairHeldMask(0, 0b0011)).toBe(0);
    expect(pairSlotShown(0b0011, 0b0011, 0, false)).toBe(1); // held
    expect(pairSlotShown(0, 0b0011, 1, true)).toBe(1);
    expect(pairSlotShown(0, 0b0011, 2, true)).toBe(0); // wanted but not in the texture yet
    expect(pairSlotShown(0, 0b0011, 1, false)).toBe(0);
  });
});

describe('uploadQueue.drop', () => {
  it('removes the queued jobs of a key set (their waiters get false) and leaves the others', async () => {
    const copied = [];
    const q = createUploadQueue({ copy: (j, z0, z1) => copied.push([j.key, z0, z1]), now: () => 0, bytesPerTick: 1 << 30 });
    q.add({ key: 'pair1-vol', depth: 4, bytesPerSlice: 8 }); q.add({ key: 'fine', depth: 4, bytesPerSlice: 8 }); q.add({ key: 'pair1-combo', depth: 2, bytesPerSlice: 8 });
    const w1 = q.whenDone('pair1-vol'), w2 = q.whenDone('fine');
    q.drop(k => k.startsWith('pair1-'));
    expect(q.pending).toBe(1);
    expect(await w1).toBe(false);
    q.tick();
    expect(await w2).toBe(true);
    expect(copied.every(c => c[0] === 'fine')).toBe(true);
  });
});

describe('vr-view.js: the partner hooks are where the frame needs them', () => {
  it('every pass that renders volScene hides or serves the partner\'s ray mesh (the probe hides it; the low and the periphery pass draw both)', () => {
    const sites = [...src.matchAll(/renderer\.render\(volScene,sub\)/g)].length;
    expect(sites).toBe(3); // the probe, the low-resolution pass and the periphery pass: a new site must be checked against the partner
    expect(src).toMatch(/pairRender\(true\);[^\n]*\n\s*renderer\.xr\.enabled=false;/); // before the low pass renders
    expect(src).toMatch(/if\(pairRay\)pairRay\.visible=false;[^\n]*renderer\.render\(volScene,sub\);renderer\.readRenderTargetPixels/); // the probe
    expect(src).toContain('pairRender(false);');
    expect(src).toContain('pairFrame(); // the partner');
  });
  it('the partner composite is drawn after the primary\'s and rejects an equal depth (no second blend of the same low-resolution pixel)', () => {
    expect(src).toMatch(/depthFunc:THREE\.LessDepth/);
    expect(src).toMatch(/m2\.renderOrder=1\.5/);
    expect(src).toMatch(/meshObj=new THREE\.Mesh\(new THREE\.BoxGeometry\(2,2,2\),st\.base\);meshObj\.frustumCulled=false;meshObj\.renderOrder=1;/);
  });
  it('the page\'s own 3D texture is only ever copied for the page\'s own data (a partner\'s series id may equal the primary\'s)', () => {
    expect(src).toContain('const mv=inp===pageInputs?sceneState?.medicalVolume:null;');
  });
  it('the session has no partner by default and releases it at the swap, the session end and a new pair', () => {
    expect(src).toMatch(/let pair=null,pairFrame=\(\)=>\{\},pairRender=\(\)=>\{\},pairRegionLut=\(\)=>\{\};/);
    expect(src).toMatch(/if\(!running\|\|ui\.swapBusy\)return false;\n\s*stopPair\(\);/);
    expect(src).toMatch(/const cleanup=\(\)=>\{stopPair\(\);pairHost=null;/);
    expect(src).toMatch(/const newPairJob=\(id,dir\)=>\{stopPair\(\);/);
  });
  it('no partner index / .vrlab / slice read happens unless startPair is called (the loaders are only referenced inside the entry points); the menu row reads only sample-pairs.json and the partner name', () => {
    const uses = [...src.matchAll(/findSamplePartners|loadSamplePartnerFiles|loadSamplePartnerProject/g)].length;
    expect(uses).toBe(6); // 3 in the import line, 3 in startPair
    const i = src.indexOf('export async function startPair(id'); expect(i).toBeGreaterThan(0);
    for (const n of ['findSamplePartners(id)', 'loadSamplePartnerFiles(found,', 'loadSamplePartnerProject(found)']) expect(src.indexOf(n)).toBeGreaterThan(i);
    // stage 3: the pair row (refreshPairInfo) asks for sample-pairs.json (loadSamplePairs, once per page) and the name of the listed partner (loadPartnerName) only; nothing of the partner's data
    const j = src.indexOf('const refreshPairInfo=async()=>{'); expect(j).toBeGreaterThan(0);
    const body = src.slice(j, src.indexOf('const pairBoardEnd', j));
    expect(body).toContain('await loadSamplePairs()'); expect(body).toContain('loadPartnerName(id,dir)');
    for (const n of ['findSamplePartners', 'loadSamplePartnerFiles', 'loadSamplePartnerProject', 'startPair']) expect(body).not.toContain(n);
  });
});

describe('each dataset has its own sections', () => {
  it('a section belongs to the partner past the middle between the boxes, else to the primary; the parked plane never meets a box', async () => {
    const { planeOnPartner, PLANE_PARK_W } = await import('../../docs/vr-pair-view.js');
    expect(planeOnPartner(0, 3.6)).toBe(false); expect(planeOnPartner(1.79, 3.6)).toBe(false); expect(planeOnPartner(1.81, 3.6)).toBe(true); expect(planeOnPartner(3.6, 3.6)).toBe(true);
    expect(PLANE_PARK_W).toBeGreaterThan(1e3); // far outside any box (the longest side is 3.3 units)
  });
  it('the holder of a section is decided where its frame is put: the partner box width -> the partner, the primary box width -> the primary, the gap (or outside both) -> unchanged', async () => {
    const { pairSectionOwner } = await import('../../docs/vr-pair-view.js');
    const dx = 3.6, hA = 1.5, hB = 1.5; // boxes [-1.5, 1.5] and [2.1, 5.1], gap (1.5, 2.1)
    expect(pairSectionOwner(false, 0, dx, hA, hB)).toBe(false); expect(pairSectionOwner(true, 0, dx, hA, hB)).toBe(false); // in the primary's width: the primary, whatever it was
    expect(pairSectionOwner(false, dx, dx, hA, hB)).toBe(true); expect(pairSectionOwner(true, dx, dx, hA, hB)).toBe(true); // in the partner's width: the partner
    for (const x of [1.51, 1.8, 2.09]) { expect(pairSectionOwner(false, x, dx, hA, hB), 'gap ' + x).toBe(false); expect(pairSectionOwner(true, x, dx, hA, hB), 'gap ' + x).toBe(true); } // the gap keeps it
    for (const x of [-9, 9]) { expect(pairSectionOwner(false, x, dx, hA, hB)).toBe(false); expect(pairSectionOwner(true, x, dx, hA, hB)).toBe(true); } // outside both: unchanged
    expect(pairSectionOwner(false, 2.1, dx, hA, hB)).toBe(true); expect(pairSectionOwner(true, 1.5, dx, hA, hB)).toBe(false);
    let own = false; for (const x of [1.6, 1.9, 1.7, 2.0, 1.55, 2.05]) own = pairSectionOwner(own, x, dx, hA, hB); expect(own).toBe(false);
    own = true; for (const x of [1.6, 1.9, 1.7, 2.0, 1.55, 2.05]) own = pairSectionOwner(own, x, dx, hA, hB); expect(own).toBe(true);
    // boxes of different widths
    expect(pairSectionOwner(false, 4, 5, 1, 2.5)).toBe(true); expect(pairSectionOwner(true, 0.9, 5, 1, 2.5)).toBe(false); expect(pairSectionOwner(true, 2, 5, 1, 2.5)).toBe(true);
  });
  it('vr-view.js: the holder is decided in the frame loop only (from the earlier holder and the centre\'s x); a new / restored frame takes the rule of planeOnPartner; every clamp gets the holder; a scroll never changes it; unbinding gives the partner\'s sections back to the primary', () => {
    const loop = src.slice(src.indexOf('for(const pl of planes){\n     if(pOn)'), src.indexOf('if(bench.noSection){n=0;cutBits=0}'));
    expect(loop).toContain('planeOwnerNow(pl)'); expect(loop).toContain('setPlaneOwner(pl,o)');
    expect(src.match(/planeOwnerNow\(/g).length).toBe(2); // the loop and the scroll's check
    expect(src).toContain('pairSectionOwnerIn(!!pl.own,inPairBox(pl.obj.position,false),inPairBox(pl.obj.position,true))'); // each box seen from its own pose
    expect(src).toContain('const planeOwnerPair=pl=>!!pair?.on&&!!pl.own;');
    expect(src).toContain('const intoBox=(fn,pos,n,own=false)=>');
    expect(src).toContain('intoBox(snapPlaneCenterIntoBox,pl.obj.position,n,planeOwnerPair(pl))');
    expect(src).toContain('{x:1,y:0,z:0}),planeOwnerPair(pl)):pl.obj.position;'); // deleteSection
    expect(src).toContain('intoBox(clampPlaneCenter,sp.obj.position,qRot(sp.obj.quaternion,{x:1,y:0,z:0}),planeOwnerPair(sp))');
    expect(src).toContain('sp.obj.position.set(sx0,sy0,sz0)');
    expect(src.match(/pl\.own=planeStartOwner\(pl\)/g).length).toBe(2); // addPlane, restoreSection
    const u0 = src.indexOf('const unbindPair=pt=>{'), ub = src.slice(u0, src.indexOf('if(pair===pt)pair=null;', u0));
    expect(ub).toContain('if(!pl.own)continue;pl.own=false;'); expect(ub).toContain('snapPlaneCenterIntoBox(c,'); expect(ub).toContain('tmpIm.copy(pt.mesh.matrix).invert()'); // the frame seen from the partner's own pose
    expect(src).toContain('outline:(()=>{'); expect(src).toContain('pt.outline.removeFromParent()'); expect(src).toContain('holder.add(pt.outline);pair=pt;');
    expect(src).toContain('if(p.lit&&!pl)pl=p;if(now<p.ownFlash&&!fl)fl=p'); expect(src).toContain('o.material.color.setHex(pl.color)');
    for (const k of ['pairSecOwn', 'ptDistOtherPair', 'ptDistHintPair', 'pairMainName']) expect(src.match(new RegExp(k + ':', 'g')).length, k).toBe(2); // ja + en
  });
  it('vr-view.js: the loop writes each plane for the dataset that owns it and parks it for the other; the partner takes its own planes and clip bits', () => {
    expect(src).toContain('const own=pOn&&planeOwnerPair(pl),M=own?pair.mesh:mesh,E=own?tmpE2:tmpE;');
    expect(src).toContain('if(own){u.cutPlanes.value[n].set(1,0,0,PLANE_PARK_W);pairPl[n].set(tmpN.x,tmpN.y,tmpN.z,tmpN.dot(tmpP));if(cutOn)pairCutBits|=1<<n}');
    expect(src).toContain('u2.cutPlanes.value[i].copy(pairPl[i]);u2.planeCut.value=pairCutBits;');
    expect(src).not.toMatch(/\bshiftPlanes\(u\.cutPlanes/); // the stage-2 rule (one set of planes shifted into the partner's space) is gone from the frame
    expect(src).toContain('intoBox(clampPlaneCenter,sp.obj.position,'); expect(src).toContain('&&!planeOwnerPair(section.selected)'); // the box a section is clamped into, the markers' perpendicular
  });
});
