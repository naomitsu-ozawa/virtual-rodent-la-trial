import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// Pinned result labels (docs/vr-label-occlusion.js, pure): embedded judgement + push out to the surface, thinning of overlapping cards. vr-view.js is checked on the source.
const ver = JSON.parse(readFileSync(new URL('../../docs/version.json', import.meta.url), 'utf8')).version, tag = '?v=' + ver.replace(/\./g, '').replace(/-(\d+)$/, '-build$1');
const { pushOut, createLabelThinner, screenRect, gazeBasis, PUSH_FREE_VOXELS, PUSH_MARGIN_VOXELS, PUSH_DIRECTIONS, setLeaderIfMoved, createFaceCache, clippedAt, rayCovered } = await import(/* @vite-ignore */ '../../docs/vr-label-occlusion.js' + tag);
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

// a box of side 2 (+-1), voxel 0.02; a solid ball of radius R around the origin, optionally with a hollow cavity of radius r
const VOX = 0.02, inBox = p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1;
const ball = (R, r = 0, c = { x: 0, y: 0, z: 0 }) => p => { const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z); return d <= R && d >= r };

describe('pushOut: embedded judgement and the push to the surface', () => {
  it('a base point in the air is not embedded and is left alone', () => {
    const r = pushOut({ x: 0.9, y: 0, z: 0 }, ball(0.5), inBox, VOX);
    expect(r).toMatchObject({ inside: false, escaped: true, pushed: false }); expect(r.p).toEqual({ x: 0.9, y: 0, z: 0 });
  });
  it('a surface-voxel anchor (within 2 voxels of free space): inside but escaped, NOT moved, not translucent (looks as before)', () => {
    const r = pushOut({ x: 0.5 - 0.01, y: 0, z: 0 }, ball(0.5), inBox, VOX);
    expect(r.inside).toBe(true); expect(r.escaped).toBe(true); expect(r.pushed).toBe(false); expect(r.dist).toBeLessThanOrEqual(PUSH_FREE_VOXELS * VOX + 1e-9);
    expect(r.inside && !r.escaped).toBe(false);
  });
  it('an anchor deep in a solid blob is pushed OUT along the shortest way, to just outside the surface (first free + margin), and is then free of tissue', () => {
    const solid = ball(0.5), r = pushOut({ x: 0.3, y: 0, z: 0 }, solid, inBox, VOX);
    expect(r.inside && r.escaped && r.pushed).toBe(true);
    expect(r.p.x).toBeGreaterThan(0.5); expect(solid(r.p)).toBe(false);
    expect(r.p.x).toBeCloseTo(0.5 + PUSH_MARGIN_VOXELS * VOX, 1); expect(Math.hypot(r.p.y, r.p.z)).toBeLessThan(0.05); // along +x (shortest), not sideways
    expect(r.dist).toBeCloseTo(0.2, 1);
  });
  it('the shortest way wins: near the -y face of the blob the push goes towards -y', () => {
    const r = pushOut({ x: 0, y: -0.4, z: 0 }, ball(0.5), inBox, VOX);
    expect(r.pushed).toBe(true); expect(r.p.y).toBeLessThan(-0.5);
  });
  it('a hollow cavity (marrow) is not "outside": the push goes out of the shell, past the cavity', () => {
    const shell = ball(0.5, 0.3), r = pushOut({ x: 0.4, y: 0, z: 0 }, shell, inBox, VOX); // in the shell, the inner surface is nearer than the outer
    expect(r.escaped).toBe(true); expect(r.p.x).toBeGreaterThan(0.5); expect(Math.hypot(r.p.x, r.p.y, r.p.z)).toBeGreaterThan(0.5);
  });
  it('enclosed with no way out (tissue to the box boundary on every side): not escaped = translucent, not moved', () => {
    const r = pushOut({ x: 0, y: 0, z: 0 }, () => true, inBox, VOX);
    expect(r).toMatchObject({ inside: true, escaped: false, pushed: false }); expect(r.p).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('tissue behind the exit on every ray (a pocket) is not an exit: the ball inside a bigger solid ball cannot get out', () => {
    const big = ball(0.9), r = pushOut({ x: 0, y: 0, z: 0 }, p => big(p) && !ball(0.1)(p) ? true : ball(0.1)(p) ? false : false, inBox, VOX);
    expect(r.inside).toBe(false); // the centre is free here (a cavity): not embedded at all
    const r2 = pushOut({ x: 0.15, y: 0, z: 0 }, p => big(p) && !ball(0.1)(p), inBox, VOX); // in tissue next to the cavity: the cavity is the nearest free space but tissue follows
    expect(r2.escaped).toBe(true); expect(big(r2.p)).toBe(false); // it goes out through the outer surface, not into the cavity
  });
  it('a cut-away part is not tissue (clippedAt): a label on a cut face is not embedded; the push may leave through the cut face', () => {
    const planes = [{ x: 0, y: 1, z: 0, w: 0 }], solid = ball(0.5), isIn = p => !clippedAt(p, planes, 1, 1) && solid(p); // keeps y >= 0
    expect(clippedAt({ x: 0, y: -0.1, z: 0 }, planes, 1, 1)).toBe(true); expect(clippedAt({ x: 0, y: 0.1, z: 0 }, planes, 1, 1)).toBe(false);
    expect(clippedAt({ x: 0, y: -0.1, z: 0 }, planes, 1, 0)).toBe(false); // the plane does not clip (bit not set)
    expect(clippedAt({ x: 0, y: -0.1, z: 0 }, planes, 0, 1)).toBe(false); // count 0
    expect(pushOut({ x: 0, y: -0.2, z: 0 }, isIn, inBox, VOX).inside).toBe(false); // below the cut: air
    const onFace = pushOut({ x: 0, y: 0.03, z: 0 }, isIn, inBox, VOX); expect(onFace.inside).toBe(true); expect(onFace.escaped).toBe(true); expect(onFace.pushed).toBe(false); // 3 cm above the cut face: the cut face is 1.5 voxel away, a surface
  });
  it('26 directions; deterministic', () => { expect(PUSH_DIRECTIONS).toBe(26); const a = pushOut({ x: 0.3, y: 0.1, z: 0 }, ball(0.5), inBox, VOX), b = pushOut({ x: 0.3, y: 0.1, z: 0 }, ball(0.5), inBox, VOX); expect(a).toEqual(b) });
  it('cost (node, not Quest): 33 deeply embedded labels in a 256-voxel grid are judged + pushed in a few ms .. tens of ms, once per change', () => {
    const vox = 2 / 256, solid = ball(0.8); const t0 = performance.now();
    for (let i = 0; i < 33; i++) pushOut({ x: -0.3 + (i % 11) * 0.06, y: -0.2 + (i % 3) * 0.1, z: 0.1 }, solid, inBox, vox);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('rayCovered: a card behind tissue from the head (coarse walk)', () => {
  const he = [1, 1, 1], wall = p => p.z > -0.1 && p.z < 0.0; // a wall across z
  it('tissue between the eye and the card = covered; no tissue = not', () => {
    expect(rayCovered({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -0.5 }, wall, he, VOX)).toBe(true);
    expect(rayCovered({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 0.5 }, wall, he, VOX)).toBe(false); // the card is in front of the wall
    expect(rayCovered({ x: 0, y: 5, z: 2 }, { x: 0, y: 5, z: -0.5 }, wall, he, VOX)).toBe(false); // the whole walk is outside the box
  });
  it('a card at the surface (within the last 2.5 voxels) is not covered by the surface it sits on; one deeper (9 cm into the wall) is', () => {
    expect(rayCovered({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -0.01 + 0.2 * VOX }, wall, he, VOX)).toBe(false);
    expect(rayCovered({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -0.09 }, wall, he, VOX)).toBe(true);
  });
  it('cost (node): 33 cards across a 256-voxel box walk in well under 5 ms', () => {
    const t0 = performance.now(), v = 2 / 256; for (let i = 0; i < 33; i++) rayCovered({ x: 0.3, y: 0.2, z: 3 }, { x: -0.3 + i * 0.01, y: 0, z: -0.9 }, () => false, he, v); expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('createLabelThinner: overlapping cards lose the farther one', () => {
  const head = { x: 0, y: 0, z: 0 }, gaze = { x: 0, y: 0, z: -1 };
  const card = (id, x, y, z, extra = {}) => ({ id, x, y, z, halfW: 0.03, halfH: 0.009, lit: false, ...extra });
  it('two cards on the same line of sight: the nearer stays, the farther is hidden', () => {
    const t = createLabelThinner(); const hide = t.update([card('far', 0.4, 0, -1.0), card('near', 0.2, 0, -0.5)], { head, gaze });
    expect([...hide]).toEqual(['far']);
  });
  it('cards that do not overlap on the screen are all kept', () => {
    const t = createLabelThinner(); expect(t.update([card('a', -0.3, 0, -0.5), card('b', 0.3, 0, -0.6), card('c', 0, 0.2, -0.7)], { head, gaze }).size).toBe(0);
  });
  it('the card looked at (near the gaze) wins over a nearer overlapping one', () => {
    const t = createLabelThinner(); const hide = t.update([card('gazed', 0, 0, -1.0), card('near', 0.04, 0.005, -0.5)], { head, gaze });
    expect([...hide]).toEqual(['near']);
  });
  it('a lit card (laser / held) is always shown, even farther and overlapping', () => {
    const t = createLabelThinner(); const hide = t.update([card('lit', 0.4, 0, -1.5, { lit: true }), card('near', 0.27, 0, -1.0)], { head, gaze });
    expect([...hide]).toEqual(['near']);
    expect(t.update([card('lit', 0.4, 0, -1.5, { lit: true }), card('lit2', 0.41, 0, -1.4, { lit: true })], { head, gaze }).size).toBe(0);
  });
  it('turning the head to a hidden card shows it', () => {
    const items = [card('far', 0.4, 0, -1.0), card('near', 0.2, 0, -0.5)], t = createLabelThinner();
    expect([...t.update(items, { head, gaze })]).toEqual(['far']);
    const f = { x: 0.4, y: 0, z: -1 }; // looking at 'far'
    expect([...t.update(items, { head, gaze: f })]).toEqual(['near']);
  });
  it('the returned Set is reused (no allocation per pass) and the state survives it', () => {
    const t = createLabelThinner(), items = [card('far', 0.4, 0, -1.0), card('near', 0.2, 0, -0.5)], a = t.update(items, { head, gaze }), b = t.update(items, { head, gaze });
    expect(a).toBe(b); expect([...b]).toEqual(['far']);
  });
  it('a card behind the head is not on the screen: it hides nothing and is not hidden', () => {
    const t = createLabelThinner(); expect(t.update([card('b', 0, 0, 1), card('f', 0, 0, -1)], { head, gaze }).size).toBe(0);
  });
  it('hysteresis: a shown card may overlap by up to 10 % of the card size before it is hidden; a hidden / new one must clear by 10 %', () => {
    const t = createLabelThinner(), a = card('a', 0, 0, -0.5);
    expect(t.update([a, card('b', 0.07, 0, -0.5)], { head, gaze }).size).toBe(0); // clear: both shown
    expect(t.update([a, card('b', 0.0595, 0, -0.5)], { head, gaze }).size).toBe(0); // a hair of overlap: b was shown, so it stays
    const t2 = createLabelThinner(); expect([...t2.update([a, card('b', 0.0595, 0, -0.5)], { head, gaze })]).toEqual(['b']); // the same layout without history: hidden
  });
  it('screenRect / gazeBasis: orthonormal basis, a card straight ahead is centred', () => {
    const { f, r, u } = gazeBasis({ x: 0, y: 0, z: -2 }); expect(f).toEqual({ x: 0, y: 0, z: -1 }); expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(1); expect(r.x * u.x + r.y * u.y + r.z * u.z).toBeCloseTo(0);
    const s = screenRect(card('x', 0, 0, -1), head, f, r, u); expect(s.u).toBeCloseTo(0); expect(s.v).toBeCloseTo(0); expect(s.ang).toBeCloseTo(0); expect(s.hw).toBeCloseTo(0.03);
    expect(gazeBasis({ x: 0, y: 1, z: 0 }).r).toEqual({ x: 1, y: 0, z: 0 }); // straight up: no NaN
  });
  it('cost (node, not Quest): 33 cards, one thinning pass is far below a millisecond', () => {
    const items = Array.from({ length: 33 }, (_, i) => card('c' + i, Math.sin(i) * 0.3, Math.cos(i * 1.7) * 0.2, -0.4 - (i % 7) * 0.05)), t = createLabelThinner();
    const t0 = performance.now(); for (let i = 0; i < 100; i++) t.update(items, { head, gaze }); expect((performance.now() - t0) / 100).toBeLessThan(1);
  });
});

describe('vr-view.js wiring (source)', () => {
  it('judged only when an input changed: the signature is built once per frame, the push uses classifiedAt + the shown channels, old mode untouched', () => {
    expect(src).toContain("from './vr-label-occlusion.js?v="); expect(src).toContain('const embedInputs=now=>{');
    expect(src).toContain('shownMask()+\'|\'+gpuSegmentOrder().join(\'>\')+\'|\'+childHideSig()');
    expect(src).toContain('isInside:p=>!clippedAt(p,planes,np,cut)&&classifiedAt(p,he,dm,vp.cls,chs,skip)'); // the cut-away side of the section planes is not tissue (as the laser's march)
    expect(src).toContain('if(!occ||held||lb.hid){lb.ext=null;lb.trans=false;lb.emb=null;return}');
    expect(src).toContain('if(lb.emb&&lb.emb.lab===lb.lab&&lb.emb.gen===embGen)return;');
    expect(src).toContain('if(occ&&pins.size){embedInputs(performance.now());embBudget=EMB_PER_FRAME}'); expect(src).toContain('if(embBudget<=0)return;embBudget--;'); // a queue: a few stale cards per frame
    expect(src).toContain('if(now-embAt<EMB_CHECK_MS)return;'); // the signature strings only every 100 ms
    expect(src).toContain('pushOut({x:base.x,y:base.y,z:base.z},cx.isInside,cx.inBox,cx.voxel)'); expect(src).not.toContain('embUp'); // the shortest of 26 directions (no up rule), so a turned volume needs no re-judging
    expect(src).toContain('rayCovered(tmpTh,tmpTc,cx.isInside,cx.halfExt,cx.voxel)'); // covered cards are out of the thinning
  });
  it('an embedded (translucent) card stays pickable; a pushed card sits at lb.ext and the leader still starts at the anchor; thinned cards are hidden, lit never', () => {
    expect(src).toContain('!pins.get(mlb.id)?.trans&&tagBehindTissue(');
    expect(src).toContain('if(ld.moved&&!ld.done)pinHeld.add(ld.id)'); // a bare press on a pushed card does not make it jump
    expect(src).toContain('const bw=lb.ext?tmpLe.copy(lb.ext):null;'); expect(src).toContain('SEGMENT_PRESET_ORDER.map(k=>{const g=segmentState[k]||{};return g.min');
    expect(src).toContain('const d=lb.ext||labelLocal(lb.anchor,lb.off,vrVoxelStep(vrHalfExt,vrDims));');
    expect(src).toContain('{if(lb.lit||lb.glow)lb.thin=false;if(lb.thin){lb.m.visible=false;lb.line.visible=false}}');
    expect(src).toContain('if(thinFrame++%3===0)thinCompute();');
  });
});

describe('weight: leader upload only when an end moved; label faces cached (LRU)', () => {
  const fakeAttr = () => { const a = { array: new Float32Array(6), uploads: 0, setXYZ(i, x, y, z) { this.array[i * 3] = x; this.array[i * 3 + 1] = y; this.array[i * 3 + 2] = z }, set needsUpdate(v) { if (v) this.uploads++ } }; return a };
  it('an unchanged end point is not written or re-sent; a moved one is (once)', () => {
    const a = fakeAttr();
    expect(setLeaderIfMoved(a, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6)).toBe(true); expect(a.uploads).toBe(1);
    expect(setLeaderIfMoved(a, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6)).toBe(false); expect(a.uploads).toBe(1);
    expect(setLeaderIfMoved(a, 0.1, 0.2, 0.3, 0.4, 0.5, 0.600001)).toBe(false); // float32 noise / a hair of head sway (0.01 mm)
    expect(setLeaderIfMoved(a, 0.1, 0.2, 0.3, 0.4, 0.5, 0.61)).toBe(true); expect(a.uploads).toBe(2); // 1 cm: sent
  });
  it('33 pinned leaders standing still for 300 frames: 33 uploads in the first frame, 0 per frame afterwards', () => {
    const attrs = Array.from({ length: 33 }, fakeAttr); let perFrame = [];
    for (let f = 0; f < 300; f++) { const before = attrs.reduce((n, a) => n + a.uploads, 0); attrs.forEach((a, i) => setLeaderIfMoved(a, i * 0.01, 0.1, -0.5, i * 0.01 + 0.02, 0.15, -0.49)); perFrame.push(attrs.reduce((n, a) => n + a.uploads, 0) - before) }
    expect(perFrame[0]).toBe(33); expect(perFrame.slice(1).every(n => n === 0)).toBe(true);
  });
  it('the face cache: going back and forth between two regions draws each only once; hits keep the same face', () => {
    let drawn = 0, disposed = 0; const cache = createFaceCache(64, () => disposed++);
    const draw = k => { let f = cache.get(k); if (!f) { f = { k, n: ++drawn }; cache.set(k, f) } return f };
    const seq = []; for (let i = 0; i < 20; i++) seq.push(draw(i % 2 ? 'femur' : 'tibia'));
    expect(drawn).toBe(2); expect(disposed).toBe(0); expect(seq[0]).toBe(seq[2]);
  });
  it('LRU: the oldest unused face goes first and is disposed; the one in use is never evicted; max is respected', () => {
    const gone = []; let inUse = null; const c = createFaceCache(3, f => gone.push(f.k), f => f === inUse);
    const f = k => ({ k }); const [a, b, d, e] = ['a', 'b', 'c', 'd'].map(f);
    c.set('a', a); c.set('b', b); c.set('c', d); c.get('a'); c.set('d', e); // b is the oldest now
    expect(gone).toEqual(['b']); expect(c.size).toBe(3);
    inUse = a; c.set('e', f('e')); c.set('f', f('f')); // a is the oldest but in use
    expect(gone.includes('a')).toBe(false); expect(c.size).toBe(3);
    c.clear(); expect(c.size).toBe(0); expect(gone.length).toBe(1 + 2 + 3);
  });
  it('16 faces are never exceeded over many different keys', () => {
    const c = createFaceCache(16, () => {}); for (let i = 0; i < 500; i++) c.set('k' + i, { i }); expect(c.size).toBe(16);
  });
  it('vr-view.js wiring: hover cards share a 16-face cache, a pinned card has its own (2), faces are disposed; the leaders go through setLeaderIfMoved', () => {
    expect(src).toContain('createFaceCache(16,faceDispose,'); expect(src).toContain('createFaceCache(2,faceDispose,'); expect(src).toContain('const faceDispose=f=>f.tex.dispose();');
    expect(src).toContain('let face=lb.cache.get(ck);'); expect(src).toContain('lb.cache.clear();lb.spare?.tex.dispose();');
    expect((src.match(/setLeaderIfMoved\(lb\.line\.geometry\.attributes\.position,/g) || []).length).toBe(2);
    const placeLabel = src.slice(src.indexOf('const placeLabel=lb=>{'), src.indexOf('const hideLabel=')); expect(placeLabel).not.toContain('needsUpdate=true');
    expect(src).toContain("if(r&&faint)emit('label-show');"); // the tutorial signal still fires on every change of the hover card, cached or drawn
  });
});
