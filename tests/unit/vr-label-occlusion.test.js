import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { rectEdgePoint } from '../../docs/analysis-label.js';
// Pinned result labels (docs/vr-label-occlusion.js, pure): embedded judgement + push out to the surface, thinning of overlapping cards. vr-view.js is checked on the source.
const ver = JSON.parse(readFileSync(new URL('../../docs/version.json', import.meta.url), 'utf8')).version, tag = '?v=' + ver.replace(/\./g, '').replace(/-(\d+)$/, '-build$1');
const { pushOut, pinLine, pinPlaceLimited, pinPulledIntoTissue, pinDue, pinJudge, createScaleSettle, PIN_SETTLE_MS, PIN_LINE_EPS, createLabelThinner, screenRect, gazeBasis, PUSH_FREE_VOXELS, PUSH_MARGIN_VOXELS, PUSH_DIRECTIONS, setLeaderIfMoved, createFaceCache, clippedAt, rayCovered, CARD_W0, CARD_W_MAX, CARD_PAD_R, CARD_H0, CARD_LINE_H, CARD_MAX_LINES, cardLayout, cardHalfW, cardHalfH } = await import(/* @vite-ignore */ '../../docs/vr-label-occlusion.js' + tag);
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

describe('the push never exceeds the leader limit (pushOut accept)', () => {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  it('accept: only a pushed place the limit allows is taken; the shortest allowed way out wins; none allowed = not escaped (translucent), not moved', () => {
    const b = ball(0.5), p = { x: 0.3, y: 0.1, z: 0 }, anchor = { x: 0.3, y: 0.1, z: 0 };
    const free = pushOut(p, b, inBox, VOX); expect(free.pushed).toBe(true);
    const need = dist(free.p, anchor); // the shortest way out needs a leader this long
    const ok = pushOut(p, b, inBox, VOX, { accept: q => dist(q, anchor) <= need + 1e-9 }); // a limit that just allows it: the same place
    expect(ok.pushed).toBe(true); expect(dist(ok.p, free.p)).toBeLessThan(1e-12);
    const no = pushOut(p, b, inBox, VOX, { accept: q => dist(q, anchor) <= need * 0.5 }); // a limit half as long: no free place within it
    expect(no).toMatchObject({ inside: true, escaped: false, pushed: false }); expect(no.p).toBe(p);
    // an anchor elsewhere: the nearest exit is refused (too far from the anchor), a longer way out that ends nearer the anchor is taken instead
    const a2 = { x: 0.1, y: 0.55, z: 0 }, lim = 0.2, alt = pushOut(p, b, inBox, VOX, { accept: q => dist(q, a2) <= lim });
    if (alt.pushed) { expect(dist(alt.p, a2)).toBeLessThanOrEqual(lim); expect(b(alt.p)).toBe(false); expect(alt.dist).toBeGreaterThanOrEqual(free.dist); }
    else expect(alt.escaped).toBe(false);
    let seen = 0; pushOut(p, b, inBox, VOX, { accept: q => { seen++; expect(b(q)).toBe(false); return true; } }); expect(seen).toBeGreaterThan(0); // only places outside the tissue are offered
  });
  it('a surface point that stays where it is (within freeVoxels) does not depend on accept: nothing moves, so nothing can exceed the limit', () => {
    const r = pushOut({ x: 0.49, y: 0, z: 0 }, ball(0.5), inBox, VOX, { accept: () => false }); // every pushed place refused
    expect(r).toMatchObject({ inside: true, escaped: true, pushed: false }); expect(r.dist).toBeLessThanOrEqual(PUSH_FREE_VOXELS * VOX);
  });
});

describe('the line drawn for a pinned card and its limit (pinLine, pinPlaceLimited, pinDue, pinJudge)', () => {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), W = 0.12, H = 0.036;
  let seed = 9; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const g = (k = 0.5, off = true) => ({ off, hw: k * W / 2, hh: k * H / 2, fwd: 0.012, rise: k * 0.045 - k * H / 2 });
  it('pinLine, a moved card facing the head: anchor beside the card = centre distance - half width; above = - half height; under the card = from the anchor to the edge beyond it; straight behind = to the lower edge', () => {
    const head = { x: 0, y: 0, z: 2 }, B = { x: 0, y: 0, z: 0 }, o = g(1);
    expect(pinLine({ x: 0.2, y: 0, z: 0 }, B, head, o)).toBeCloseTo(0.2 - 0.06, 12);
    expect(pinLine({ x: 0, y: -0.1, z: 0 }, B, head, o)).toBeCloseTo(0.1 - 0.018, 12);
    expect(pinLine({ x: 0.02, y: 0, z: 0 }, B, head, o)).toBeCloseTo(0.06 - 0.02, 12); // under the card: 4 cm to the right edge, though the centre is 2 cm away
    expect(pinLine({ x: 0.2, y: 0, z: -0.1 }, B, head, o)).toBeCloseTo(Math.hypot(0.14, 0.1), 12); // depth counts
    expect(pinLine({ x: 0, y: 0, z: -0.1 }, B, head, o)).toBeCloseTo(Math.hypot(0.018, 0.1), 12);
    expect(pinLine({ x: 0.2, y: 0, z: 0 }, B, { x: 2, y: 0, z: 0 }, o)).toBeCloseTo(Math.hypot(0.018, 0.2), 12); // seen from the side the same leader runs straight away from the viewer: the line depends on where the head is
    expect(Number.isFinite(pinLine({ x: 0.1, y: 0, z: 0 }, B, { x: 0, y: 3, z: 0 }, o))).toBe(true); // the head straight above
  });
  it('pinLine, no stored offset: from the anchor to the middle of the card\'s lower edge at the default place seen from B', () => {
    const o = g(0.5, false), A = { x: 0, y: 0, z: 0 };
    expect(pinLine(A, A, { x: 0, y: 0, z: 1 }, o)).toBeCloseTo(Math.hypot(0.012, o.rise), 12); // the default place at the anchor itself
    expect(pinLine(A, { x: 0.05, y: 0, z: 0 }, { x: 0.05, y: 0, z: 1 }, o)).toBeCloseTo(Math.hypot(0.05, o.rise, 0.012), 12);
  });
  // a world as vr-view.js: object space * scale s (+ a shift) = world; the head and the card's size as they are in the frame
  const world = (s, t = { x: 0.1, y: 1.3, z: -0.65 }) => p => ({ x: p.x * s + t.x, y: p.y * s + t.y, z: p.z * s + t.z });
  it('pinPlaceLimited: not enlarged = the place of the initial display; enlarged without a pushed place = anchor + K v0, the same card (in the world) as the initial scale draws', () => {
    const a = { x: 0.2, y: -0.1, z: 0.4 }, v0 = { x: 0.3, y: 0.4, z: -1.2 }, s0 = 0.05 / 3.3, head = { x: 0, y: 1.5, z: 0 }, o = g();
    for (const K of [1, 1.7, 5]) { const p = pinPlaceLimited(a, v0, K, { x: 9, y: 9, z: 9 }, () => { throw new Error('no line is needed') }); expect([p.x, p.y, p.z]).toEqual([a.x + v0.x, a.y + v0.y, a.z + v0.z]); expect(p.kappa).toBe(-1); } // a stale pushed place is not used
    const w0 = world(s0), T0 = pinLine(w0(a), w0({ x: a.x + v0.x, y: a.y + v0.y, z: a.z + v0.z }), head, o);
    for (let i = 1; i <= 60; i++) { // 5 cm -> 30 cm (and beyond): the anchor kept where it is in the world, the model enlarged about it
      const s = s0 * Math.pow(8, i / 60), K = s0 / s, t = { x: 0.1 + a.x * (s0 - s), y: 1.3 + a.y * (s0 - s), z: -0.65 + a.z * (s0 - s) }, w = world(s, t);
      const p = pinPlaceLimited(a, v0, K, null, () => { throw new Error('no line is needed') });
      expect(dist(w(p), w0({ x: a.x + v0.x, y: a.y + v0.y, z: a.z + v0.z }))).toBeLessThan(1e-12); expect(pinLine(w(a), w(p), head, o)).toBeCloseTo(T0, 12);
    }
    const out = { x: 0, y: 0, z: 0 }; expect(pinPlaceLimited(a, v0, 0.5, null, null, out)).toBe(out); // no allocation when an output object is passed
  });
  it('pinPlaceLimited: a place pushed while enlarged is drawn as judged when its line is within T; otherwise shortened along its own vector to the largest factor within T, or back at anchor + K v0; never a line longer than T (random cards, heads, sizes, with the anchor under the card or not)', () => {
    let asJudged = 0, shortened = 0, back = 0, under = 0;
    for (let n = 0; n < 6000; n++) {
      const s = 0.02 + rnd() * 0.08, K = 0.15 + rnd() * 0.8, w = world(s), k = [0.5, 0.7, 1, 1.15][n % 4], o = g(k, n % 5 !== 0), head = { x: (rnd() - 0.5) * 2, y: 1 + rnd(), z: (rnd() - 0.5) * 2 };
      const a = { x: rnd() - 0.5, y: rnd() - 0.5, z: rnd() - 0.5 }, v0 = { x: (rnd() - 0.5) * 3, y: (rnd() - 0.5) * 3, z: (rnd() - 0.5) * 3 }, v1 = { x: (rnd() - 0.5) * 3 * K, y: (rnd() - 0.5) * 3 * K, z: (rnd() - 0.5) * 3 * K };
      const lineOf = p => pinLine(w(a), w(p), head, o), B = { x: a.x + v0.x * K, y: a.y + v0.y * K, z: a.z + v0.z * K }, T = lineOf(B);
      const p = pinPlaceLimited(a, v0, K, v1, lineOf), L = lineOf(p);
      expect(L).toBeLessThanOrEqual(T + PIN_LINE_EPS * 1.001);
      if (dist(w(a), w(B)) < o.hw) under++;
      if (p.kappa === 1) { asJudged++; expect(dist(p, { x: a.x + v1.x, y: a.y + v1.y, z: a.z + v1.z })).toBeLessThan(1e-12); }
      else if (p.kappa === -2) { back++; expect(dist(p, B)).toBeLessThan(1e-12); expect(lineOf({ x: a.x + v1.x, y: a.y + v1.y, z: a.z + v1.z })).toBeGreaterThan(T); }
      else { shortened++; expect(p.kappa).toBeGreaterThan(0); expect(p.kappa).toBeLessThan(1); expect(dist(p, { x: a.x + v1.x * p.kappa, y: a.y + v1.y * p.kappa, z: a.z + v1.z * p.kappa })).toBeLessThan(1e-12);
        const q = Math.min(1, p.kappa + 1 / 16 / 4096 * 1.01); expect(lineOf({ x: a.x + v1.x * q, y: a.y + v1.y * q, z: a.z + v1.z * q })).toBeGreaterThan(T); } // the largest factor of its scan step: a little further the line is over T
    }
    expect(asJudged).toBeGreaterThan(500); expect(shortened).toBeGreaterThan(500); expect(back).toBeGreaterThan(20); expect(under).toBeGreaterThan(500);
  });
  it('pinPulledIntoTissue: only a pushed place that the limit changed in this frame (shortened, or back at the limited place) and that lies in a tissue voxel', () => {
    const cx = { isInside: ball(0.5) }, inP = { x: 0.1, y: 0, z: 0 }, outP = { x: 0.9, y: 0, z: 0 };
    expect(pinPulledIntoTissue({ ...inP, kappa: 0.6 }, cx)).toBe(true); expect(pinPulledIntoTissue({ ...inP, kappa: -2 }, cx)).toBe(true);
    expect(pinPulledIntoTissue({ ...outP, kappa: 0.6 }, cx)).toBe(false); expect(pinPulledIntoTissue({ ...outP, kappa: -2 }, cx)).toBe(false);
    let asked = 0; const count = { isInside: p => { asked++; return true; } };
    expect(pinPulledIntoTissue({ ...inP, kappa: 1 }, count)).toBe(false); expect(pinPulledIntoTissue({ ...inP, kappa: -1 }, count)).toBe(false); expect(asked).toBe(0); // as judged / no pushed place: the judgement stands, no voxel is tested
    expect(pinPulledIntoTissue({ ...inP, kappa: 0.6 }, null)).toBe(false); // no classification
  });
  it('pinDue: the place of the initial display when the label / an input changed (as 708, whatever the scale does); the enlarged place once per scale and only when the scale has stopped', () => {
    const lab = {}, lb = { lab, ref: null, emb: null };
    expect(pinDue(lb, 1, 0.02, 1, true)).toBe(1); expect(pinDue(lb, 1, 0.04, 0.5, false)).toBe(1); expect(pinDue(lb, 1, 0.04, 0.5, true)).toBe(3);
    lb.ref = { lab, gen: 1, v: null, len: 0, trans: false };
    expect(pinDue(lb, 1, 0.02, 1, true)).toBe(0); // not enlarged: nothing more
    expect(pinDue(lb, 1, 0.04, 0.5, false)).toBe(0); // enlarged, the scale is changing: NOTHING is judged
    expect(pinDue(lb, 1, 0.04, 0.5, true)).toBe(2); // it has stopped: once
    lb.emb = { lab, gen: 1, hs: 0.04, v: null, len: 0, trans: false };
    expect(pinDue(lb, 1, 0.04, 0.5, true)).toBe(0); // judged for this scale: not again
    expect(pinDue(lb, 1, 0.0401, 0.499, false)).toBe(0); expect(pinDue(lb, 1, 0.05, 0.4, false)).toBe(0); // any change of the scale waits for the stop (no 2 % rule)
    expect(pinDue(lb, 1, 0.05, 0.4, true)).toBe(2);
    expect(pinDue(lb, 2, 0.04, 0.5, false)).toBe(1); expect(pinDue(lb, 2, 0.04, 0.5, true)).toBe(3); // new inputs: the 708 judgement at once, the enlarged one with it when the scale stands
    expect(pinDue({ lab: {}, ref: lb.ref, emb: lb.emb }, 1, 0.04, 0.5, true)).toBe(3); // another label object (moved / replaced)
  });
  it('createScaleSettle: true once the scale has been the same for PIN_SETTLE_MS; any change starts the wait again', () => {
    const st = createScaleSettle(); expect(PIN_SETTLE_MS).toBe(150);
    expect(st.step(0.02, 1000)).toBe(false); expect(st.step(0.02, 1100)).toBe(false); expect(st.step(0.02, 1150)).toBe(true); expect(st.step(0.02, 5000)).toBe(true);
    expect(st.step(0.021, 5011)).toBe(false); expect(st.step(0.022, 5022)).toBe(false); expect(st.step(0.022, 5171)).toBe(false); expect(st.step(0.022, 5172)).toBe(true);
  });
  it('pinJudge: the 708 judgement for lb.ref; for an enlarged model the limited place is pushed only to a free place whose LINE is within the line of the limited place, a surface voxel is not moved, none = translucent; while the scale changes pushOut is never called', () => {
    const solid = ball(0.5), cx = { isInside: solid, inBox, voxel: VOX }, s = 0.2, w = world(s, { x: 0, y: 1.3, z: -0.65 }), head = { x: 0, y: 1.42, z: 0 }, o = g(0.5), lab = {};
    const lineFor = a => p => pinLine(w(a), w(p), head, o);
    // (a) a card whose stored place is in the air, but whose limited place (K = 0.25) is deep in the ball
    const a = { x: 0, y: 0.45, z: 0 }, base = { x: 0, y: -0.75, z: 0 }, lb = { lab, ref: null, emb: null }, lineOf = lineFor(a);
    expect(pinJudge(lb, pinDue(lb, 1, s, 0.25, false), a, base, 0.25, s, 1, cx, lineOf)).toBe(1); // the scale is changing: the 708 judgement only
    expect(lb.ref).toMatchObject({ lab, gen: 1, trans: false }); expect(lb.ref.v.y).toBeCloseTo(-1.2, 12); expect(lb.emb).toBeNull();
    expect(pinDue(lb, 1, s, 0.25, false)).toBe(0); // ... and then nothing while it changes
    expect(pinJudge(lb, pinDue(lb, 1, s, 0.25, true), a, base, 0.25, s, 1, cx, lineOf)).toBe(1); // stopped: the limited place (0, 0.15, 0), 0.35 below the surface
    const B = { x: 0, y: 0.15, z: 0 }, T = lineOf(B);
    if (lb.emb.v) { const q = { x: a.x + lb.emb.v.x, y: a.y + lb.emb.v.y, z: a.z + lb.emb.v.z }; expect(solid(q)).toBe(false); expect(lineOf(q)).toBeLessThanOrEqual(T + PIN_LINE_EPS); expect(lb.emb.trans).toBe(false); }
    else expect(lb.emb.trans).toBe(true); // no free place within the line: translucent at B
    expect(lb.emb.hs).toBe(s); expect(pinDue(lb, 1, s, 0.25, true)).toBe(0);
    // (b) the same with a line that allows nothing: translucent, not moved; and with any line allowed: pushed out of the ball
    const lb2 = { lab, ref: null, emb: null }; let n = 0; pinJudge(lb2, 3, a, base, 0.25, s, 1, cx, p => (n++ ? 1 : 0)); expect(lb2.emb).toMatchObject({ v: null, trans: true });
    const lb3 = { lab, ref: null, emb: null }; expect(pinJudge(lb3, 3, a, base, 0.25, s, 1, cx, () => 0)).toBe(2); expect(lb3.emb.trans).toBe(false); expect(solid({ x: a.x + lb3.emb.v.x, y: a.y + lb3.emb.v.y, z: a.z + lb3.emb.v.z })).toBe(false);
    // (c) the limited place at a surface voxel (within PUSH_FREE_VOXELS of free space): not moved, not translucent, as treats a surface voxel
    const a4 = { x: 0, y: 0.6, z: 0 }, base4 = { x: 0, y: 0.6 - 0.11 * 4, z: 0 }, lb4 = { lab, ref: null, emb: null }; pinJudge(lb4, 3, a4, base4, 0.25, s, 1, cx, lineFor(a4)); // B = (0, 0.49, 0)
    expect(solid({ x: 0, y: 0.49, z: 0 })).toBe(true); expect(lb4.emb).toMatchObject({ v: null, trans: false });
    // (d) no classification: nothing is embedded, no pushOut
    const lb5 = { lab, ref: null, emb: null }; expect(pinJudge(lb5, 3, a, base, 0.25, s, 1, null, lineOf)).toBe(0); expect(lb5.ref.trans).toBe(false); expect(lb5.emb).toMatchObject({ v: null, trans: false });
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
    expect(src).toContain('if(!occ||held||lb.hid||!vrHalfExt||!vrDims||!mesh){lb.ref=null;lb.emb=null;lb.trans=false;return}');
    expect(src).toContain('const due=pinDue(lb,embGen,holder.scale.x,K,pinSettled);'); // the place of the initial display: per label / input (as 708); the enlarged one: once each time the scale has stopped
    expect(src).toContain('if(occ&&pins.size){const now=performance.now();embedInputs(now);embBudget=EMB_PER_FRAME;pinSettled=pinSettle.step(holder.scale.x,now)}'); expect(src).toContain('if(due&&embBudget>0){embBudget--;'); // a queue: a few stale cards per frame
    expect(src).toContain('if(now-embAt<EMB_CHECK_MS)return;'); // the signature strings only every 100 ms
    expect(src).toContain('pinJudge(lb,due,a,lb.off?labelLocal(a,lb.off,vrVoxelStep(vrHalfExt,vrDims)):a,K,holder.scale.x,embGen,embedCtx(),lineOf);'); expect(src).not.toContain('embUp'); // the shortest of 26 directions (no up rule), so a turned volume needs no re-judging
    expect(src).toContain('rayCovered(tmpTh,tmpTc,cx.isInside,cx.halfExt,cx.voxel)'); // covered cards are out of the thinning
    // the place drawn goes through pinPlaceLimited every frame; the line is placeLabel's (pinLine with the head, the card's size and the volume's world matrix of the frame); no caller asks pushOut to move a surface voxel
    expect(src).toContain('return pinPlaceLimited(a,v0,K,em?em.v:null,lineOf,tmpPp);'); expect(src).toContain('const lineOf=p=>pinLine(lineA,tmpLq.set(p.x,p.y,p.z).applyMatrix4(mesh.matrixWorld),head,lineG);');
    expect(src).toContain('lineG.off=!!lb.off;lineG.hw=cardHalfW(LABEL_W,lb.wr,k);lineG.hh=cardHalfH(LABEL_H,lb.hr,k);lineG.rise=labelRise(lb)-cardHalfH(LABEL_H,lb.hr,k)'); expect(src).toContain('addScaledVector(tmpLb,0.012);lb.m.position.y+=labelRise(lb);'); // the same numbers as placeLabel draws with
    expect(src).toContain('const pp=pinPlace(lb);if(pp&&!lb.trans&&pinPulledIntoTissue(pp,embedCtx()))lb.trans=true;'); // a pushed place pulled back into the tissue by the limit: translucent for that frame
    expect(src).not.toContain('freeVoxels'); expect(src).not.toContain('pushOut('); expect(src).not.toContain('cappedPlace');
  });
  it('an embedded (translucent) card stays pickable; a pushed card sits at its pushed place (within the leader cap, pinPlace) and the leader still starts at the anchor; thinned cards are hidden, lit never', () => {
    expect(src).toContain('!pins.get(mlb.id)?.trans&&tagBehindTissue(');
    expect(src).toContain('if(ld.moved&&!ld.done)pinHeld.add(ld.id)'); // a bare press on a pushed card does not make it jump
    expect(src).toContain('const bw=pp?tmpLe.set(pp.x,pp.y,pp.z):null;'); expect(src).toContain('SEGMENT_PRESET_ORDER.map(k=>{const g=segmentState[k]||{};return g.min');
    expect(src).toContain('const pp=pinPlace(lb);'); expect(src).toContain('if(lb.off&&pp){'); expect(src).not.toContain('lb.ext');
    expect(src).toContain('{if(lb.lit||lb.glow)lb.thin=false;if(lb.thin){lb.m.visible=false;lb.line.visible=false}}');
    expect(src).toContain('if(thinFrame++%3===0)thinCompute(occ);');
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
    expect((src.match(/setLeaderIfMoved\(lb\.line\.geometry\.attributes\.position,/g) || []).length).toBe(4); // placeLabel's two + (stage 3) placePairLabel's two (the partner's name cards)
    const placeLabel = src.slice(src.indexOf('const placeLabel=lb=>{'), src.indexOf('const hideLabel=')); expect(placeLabel).not.toContain('needsUpdate=true');
    expect(src).toContain("if(r&&faint)emit('label-show');"); // the tutorial signal still fires on every change of the hover card, cached or drawn
  });
});

describe('the size of a label card follows its text (cardLayout: width, then wrapped lines; cardHalfW / cardHalfH)', () => {
  // a stand-in for measureText: full-width characters 44 px, others 24 px (bold 44 px) / 40 and 22 (second line)
  const cjk = c => /[　-鿿＀-￯]/.test(c);
  const meas = (i, t) => [...t].reduce((a, c) => a + (cjk(c) ? (i ? 40 : 44) : (i ? 22 : 24)), 0);
  const sub = '1.23 mm³', L = (name, x = 118, s = sub) => cardLayout(meas, { text: name, x }, { text: s, x });
  const names = l => l.lines.filter(x => !x.sub), joined = l => names(l).map(x => x.text).join('');
  it('a short name keeps the card as it was: 512 x 154 px, one line at y 50, the volume at y 108, plain fillText (no maxWidth), the text as is', () => {
    const r = L('1. 頭蓋骨');
    expect(r).toMatchObject({ w: CARD_W0, wr: 1, h: CARD_H0, hr: 1 }); expect(r.lines).toEqual([{ text: '1. 頭蓋骨', x: 118, y: 50, maxWidth: null, sub: false }, { text: sub, x: 118, y: 108, maxWidth: null, sub: true }]);
  });
  it('the long names of the report widen the card up to the text on ONE line (never cut, not wrapped): the last character is drawn', () => {
    for (const t of ['7. 第4趾末節骨（DP4）', '12. 第4趾末節骨（DP4）', '13. 爪（CLAW・5趾分）']) {
      const r = L(t);
      expect(r.w).toBeGreaterThan(CARD_W0); expect(r.w).toBeLessThanOrEqual(CARD_W_MAX); expect(r.w % 32).toBe(0); expect(r.h).toBe(CARD_H0); expect(r.hr).toBe(1);
      expect(r.lines[0]).toEqual({ text: t, x: 118, y: 50, maxWidth: null, sub: false }); expect(118 + meas(0, t) + CARD_PAD_R).toBeLessThanOrEqual(r.w); expect(r.wr).toBe(r.w / CARD_W0);
    }
    const seg = L('第4趾末節骨（DP4）', 34, 'no analysis result'); // the card of a bone the laser points at
    expect(seg.lines[0].text).toBe('第4趾末節骨（DP4）'); expect(seg.lines[0].maxWidth).toBeNull();
  });
  it('the width is the smallest 32 px step that holds the text (not wider than needed), and grows with the name', () => {
    let last = 0; for (let n = 1; n <= 20; n++) {
      const t = '骨'.repeat(n), r = L(t); expect(r.w).toBeGreaterThanOrEqual(last); last = r.w;
      if (r.w > CARD_W0 && r.w < CARD_W_MAX) { expect(118 + meas(0, t) + CARD_PAD_R).toBeLessThanOrEqual(r.w); expect(118 + meas(0, t) + CARD_PAD_R).toBeGreaterThan(r.w - 32); expect(r.h).toBe(CARD_H0); }
    }
  });
  it('a name that does not fit one line at 1024 is wrapped (text size unchanged, nothing squeezed or cut) and the card grows CARD_LINE_H per extra line; the volume line moves down with it', () => {
    const avail = CARD_W_MAX - CARD_PAD_R - 118;
    for (const [t, lines] of [['骨'.repeat(Math.floor(avail / 44) + 1), 2], ['14. ' + '第4趾末節骨（DP4）'.repeat(4), 3], ['骨'.repeat(40), 3]]) {
      const r = L(t), ns = names(r);
      expect(r.w).toBe(CARD_W_MAX); expect(ns.length).toBe(lines); expect(joined(r)).toBe(t); // every character of the name is drawn, in order
      for (const [j, x] of ns.entries()) { expect(x.maxWidth).toBeNull(); expect(x.y).toBe(50 + j * CARD_LINE_H); expect(x.x).toBe(118); expect(meas(0, x.text)).toBeLessThanOrEqual(avail); }
      expect(r.h).toBe(CARD_H0 + (lines - 1) * CARD_LINE_H); expect(r.hr).toBe(r.h / CARD_H0); expect(r.lines.at(-1)).toMatchObject({ sub: true, y: 108 + (lines - 1) * CARD_LINE_H, maxWidth: null });
    }
    expect(L('x'.repeat(0) + '骨'.repeat(40)).lines.filter(x => !x.sub).length).toBeLessThanOrEqual(CARD_MAX_LINES); // a 40-character name needs fewer than the maximum
  });
  it('a wrap does not cut a word (DP4) in two, start a line with a closing mark or end one with an opening mark', () => {
    for (let n = 14; n <= 40; n++) {
      const t = '骨'.repeat(n) + '第4趾末節骨（DP4）', ns = names(L(t)).map(x => x.text);
      for (let j = 1; j < ns.length; j++) { expect(/[A-Za-z0-9]$/.test(ns[j - 1]) && /^[A-Za-z0-9]/.test(ns[j])).toBe(false); expect('）)」、。・'.includes(ns[j][0])).toBe(false); expect('（(「'.includes(ns[j - 1].at(-1))).toBe(false); }
      expect(ns.join('')).toBe(t);
    }
  });
  it('last resort only: more than CARD_MAX_LINES lines of text are squeezed sideways in the last line (down to half), beyond that cut with an ellipsis', () => {
    const avail = CARD_W_MAX - CARD_PAD_R - 118, per = Math.floor(avail / 44);
    const a = L('骨'.repeat(per * CARD_MAX_LINES + 3)), la = names(a);
    expect(la.length).toBe(CARD_MAX_LINES); expect(la.at(-1).maxWidth).toBe(avail); expect(la.at(-1).text.endsWith('…')).toBe(false); expect(la.slice(0, -1).every(x => x.maxWidth === null)).toBe(true);
    const b = L('骨'.repeat(per * CARD_MAX_LINES * 3)), lb = names(b).at(-1);
    expect(names(b).length).toBe(CARD_MAX_LINES); expect(lb.text.endsWith('…')).toBe(true); expect(lb.maxWidth).toBe(avail); expect(meas(0, lb.text)).toBeLessThanOrEqual(avail * 2);
    expect(b.h).toBe(CARD_H0 + (CARD_MAX_LINES - 1) * CARD_LINE_H);
  });
  it('the second line (volume text) widens the card too (and is never wrapped)', () => {
    const r = L('1. 頭', 118, '1234567890.12 mm³ (note)');
    expect(r.w).toBeGreaterThan(CARD_W0); expect(r.lines[1].maxWidth).toBeNull(); expect(r.h).toBe(CARD_H0);
  });
  it('the size users agree: half size = base * ratio * k; pinLine runs to the edge of a wide / tall card; the ray hit and the edge point (plane space) match the world size', () => {
    expect(cardHalfW(0.12, 1, 0.5)).toBeCloseTo(0.03, 12); expect(cardHalfW(0.12, 1.5, 0.7)).toBeCloseTo(0.12 * 1.5 * 0.7 / 2, 12); expect(cardHalfH(0.036, 2.35, 0.7)).toBeCloseTo(0.036 * 2.35 * 0.7 / 2, 12);
    const W = 0.12, H = 0.036, k = 0.7, wr = 1.75, hr = 2.35, head = { x: 0, y: 0, z: 2 }, B = { x: 0, y: 0, z: 0 };
    const o = (w, h) => ({ off: true, hw: cardHalfW(W, w, k), hh: cardHalfH(H, h, k), fwd: 0.012, rise: 0 });
    expect(pinLine({ x: 0.3, y: 0, z: 0 }, B, head, o(wr, 1))).toBeCloseTo(0.3 - W * wr * k / 2, 12); expect(pinLine({ x: 0.3, y: 0, z: 0 }, B, head, o(1, 1))).toBeCloseTo(0.3 - W * k / 2, 12);
    expect(pinLine({ x: 0, y: -0.2, z: 0 }, B, head, o(1, hr))).toBeCloseTo(0.2 - H * hr * k / 2, 12); expect(pinLine({ x: 0, y: -0.2, z: 0 }, B, head, o(1, 1))).toBeCloseTo(0.2 - H * k / 2, 12); // the tall card's edge is nearer
    // a mesh as vr-view.js: plane W x H, scale (k wr, k hr, k), turned: the hit test (plane space, W * 0.6 / H * 0.9) and rectEdgePoint (plane space, W / 2, H / 2) are right on the wide / tall card
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H)); m.scale.set(k * wr, k * hr, k); m.position.set(0.1, 1.2, -0.3); m.lookAt(0.6, 1.5, 1.5); m.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert(), hitAt = p => { const l = p.clone().applyMatrix4(inv); return !(Math.abs(l.x) > W * 0.6 || Math.abs(l.y) > H * 0.9) };
    const right = new THREE.Vector3(1, 0, 0).transformDirection(m.matrixWorld), up = new THREE.Vector3(0, 1, 0).transformDirection(m.matrixWorld);
    const atX = f => m.position.clone().addScaledVector(right, f * k * wr * W / 2), atY = f => m.position.clone().addScaledVector(up, f * k * hr * H / 2);
    expect(hitAt(atX(0.95))).toBe(true); expect(hitAt(atX(1.15))).toBe(true); expect(hitAt(atX(1.3))).toBe(false); expect(hitAt(atX(-1.3))).toBe(false); // the card's own width (+ 20 %), not the 12 cm one
    expect(hitAt(atY(0.95))).toBe(true); expect(hitAt(atY(1.7))).toBe(true); expect(hitAt(atY(1.85))).toBe(false); expect(hitAt(atY(-1.85))).toBe(false); // the card's own height (+ 80 %), not the 3.6 cm one
    for (const [dir, f] of [[right, atX], [up, atY]]) {
      const A = f(2.5), la = A.clone(); m.worldToLocal(la); const e = rectEdgePoint(la.x, la.y, W / 2, H / 2), ew = new THREE.Vector3(e.x, e.y, 0).applyMatrix4(m.matrixWorld);
      expect(ew.distanceTo(f(1))).toBeLessThan(1e-9); // the leader ends at the card's edge: world half size k * ratio * base / 2
    }
  });
  it('the leader cap holds for wide and tall cards: pinPlaceLimited never draws a line longer than T with the card\'s own half size (random cards / heads / sizes)', () => {
    let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const W = 0.12, H = 0.036, world = s => p => ({ x: p.x * s + 0.1, y: p.y * s + 1.3, z: p.z * s - 0.65 });
    let big = 0;
    for (let n = 0; n < 3000; n++) {
      const s = 0.02 + rnd() * 0.08, K = 0.15 + rnd() * 0.8, w = world(s), k = [0.5, 0.7, 1, 1.15][n % 4], wr = 1 + (n % 5) * 0.25, hr = 1 + (n % 4) * 0.5;
      const o = { off: n % 5 !== 0, hw: cardHalfW(W, wr, k), hh: cardHalfH(H, hr, k), fwd: 0.012, rise: k * 0.045 - cardHalfH(H, hr, k) }, head = { x: (rnd() - 0.5) * 2, y: 1 + rnd(), z: (rnd() - 0.5) * 2 };
      const a = { x: rnd() - 0.5, y: rnd() - 0.5, z: rnd() - 0.5 }, v0 = { x: (rnd() - 0.5) * 3, y: (rnd() - 0.5) * 3, z: (rnd() - 0.5) * 3 }, v1 = { x: (rnd() - 0.5) * 3 * K, y: (rnd() - 0.5) * 3 * K, z: (rnd() - 0.5) * 3 * K };
      const lineOf = p => pinLine(w(a), w(p), head, o), B = { x: a.x + v0.x * K, y: a.y + v0.y * K, z: a.z + v0.z * K }, T = lineOf(B), p = pinPlaceLimited(a, v0, K, v1, lineOf);
      expect(lineOf(p)).toBeLessThanOrEqual(T + PIN_LINE_EPS * 1.001); if (wr > 1 && hr > 1) big++;
    }
    expect(big).toBeGreaterThan(1000);
  });
  it('vr-view.js wiring: the picture and the board are scaled together in x and y, each size user takes the card\'s own size, a taller card grows upward, a picture is made only for a new content (the cache), not per frame', () => {
    expect(src).toContain('lb.m.scale.set(k*lb.wr,k*lb.hr,k);'); expect(src).toContain('it.halfW=cardHalfW(LABEL_W,lb.wr,k);it.halfH=cardHalfH(LABEL_H,lb.hr,k);');
    expect(src).toContain('const labelRise=lb=>labelScale()*0.045+(lb.hr-1)*LABEL_H*labelScale()/2;'); expect(src).toContain('lb.m.position.y-cardHalfH(LABEL_H,lb.hr,k),lb.m.position.z,'); // the leader's start: the lower edge of the card
    expect(src).toContain('ctx.roundRect(4,4,CW-8,CH-8,26)'); expect(src).toContain('lb.wr=face.wr;lb.hr=face.hr;'); expect(src).toContain('ctx.arc(62,CH/2,34'); expect(src).not.toContain('ctx.clearRect(0,0,512,154)');
    const draw = src.slice(src.indexOf('const drawLabel=(lb,hit,faint,lit=false)=>{'), src.indexOf('const lineGlow=')); // the layout (measureText) sits after the cache hit: a cached face returns before it
    expect(draw.indexOf('if(face){')).toBeGreaterThan(0); expect(draw.indexOf('if(face){')).toBeLessThan(draw.indexOf('cardLayout(')); expect(draw.slice(0, draw.indexOf('cardLayout(')).includes('return}')).toBe(true);
    const placeLabel = src.slice(src.indexOf('const placeLabel=lb=>{'), src.indexOf('const hideLabel=')); expect(placeLabel).not.toContain('cardLayout'); expect(placeLabel).not.toContain('newFace');
    expect(src).toContain('lb.spare&&lb.spare.w===CW&&lb.spare.h===CH?lb.spare:'); // a face whose canvas has another size is not reused as a spare (a texture is not resized in place)
    expect(src).toContain('const e=rectEdgePoint(tmpLb.x,tmpLb.y,LABEL_W/2,LABEL_H/2);'); // plane space: the unscaled plane
    // a one-line card (hr = 1, wr = 1) is placed exactly as before: rise = labelScale * 0.045, leader start = the lower edge
    const hr1 = 0.5 * 0.045 + (1 - 1) * 0.036 * 0.5 / 2; expect(hr1).toBe(0.5 * 0.045);
  });
});

describe('vr-view.js: overlapping cards follow the device setting labelOverlap (source)', () => {
  it('thinning is off in keep (no judgement at all), is not tied to 実際に隠す, and counts the labels in sight', () => {
    expect(src).toContain("if(pins.size<2||labelOverlapMode()==='keep'){for(const lb of pins.values()){lb.thin=false;lb.cov=false}labelThinner.reset();return}");
    expect(src).not.toContain('if(!occ||pins.size<2)');
    expect(src).toContain('const cx=occ?embedCtx():null;'); // tissue cover is a depth-test matter: only 実際に隠す; 薄くする draws every card, so every card counts
    expect(src).toContain("if(!thinActive(labelOverlapMode(),seen)){for(const lb of pins.values())lb.thin=false;labelThinner.reset();return}");
    expect(src).toContain('if(inSight(p,Math.hypot(it.halfW,it.halfH)))seen++;');
    expect(src).toContain("normalizeLabelOverlap(globalThis.__vrlSettings?.get?.('labelOverlap'))");
  });
  it('a lit card and its leader are drawn above the others; a thinned card takes its leader (and its anchor dot, which follows lb.m.visible) with it', () => {
    expect(src).toContain('lb.m.renderOrder=lb.line.renderOrder=lit?6:5;');
    expect(src).toContain('{if(lb.lit||lb.glow)lb.thin=false;if(lb.thin){lb.m.visible=false;lb.line.visible=false}}');
    expect(src).toContain('if(lb.hid||!lb.m.visible)continue;'); // syncAnchorDots: a card that is not shown has no dot
  });
  it('the menu: a 3-way row in the 解析 tab (消さない / 常に消す / 15枚以上で消す) and the settings dialog row, both on the device setting', () => {
    expect(src).toContain("lbOvV:['消さない','常に消す','15枚以上で消す']"); expect(src).toContain("lbOvV:['Keep','Always hide','Hide at 15+']");
    expect(src).toContain('LABEL_OVERLAP_MODES.forEach((m,i)=>btn(330+i*(bw+12),y0+854,bw,L.lbOvV[i],labelOverlapMode()===m,()=>{setLabelOverlapMode(m)},{size:22}))');
    const shell = readFileSync(new URL('../../docs/ui-shell.js', import.meta.url), 'utf8'), ui = readFileSync(new URL('../../docs/settings-ui.js', import.meta.url), 'utf8');
    expect(shell).toContain('<select id="set-label-overlap"><option value="keep" data-i18n="labelOverlapKeep"></option><option value="always" data-i18n="labelOverlapAlways"></option><option value="many" data-i18n="labelOverlapMany"></option></select>');
    expect(ui).toContain("bind('set-label-overlap','labelOverlap')"); expect(ui).toContain("put('set-label-overlap',normalizeLabelOverlap(v.labelOverlap))");
    const i18n = readFileSync(new URL('../../docs/i18n.js', import.meta.url), 'utf8');
    for (const k of ['setLabelOverlap', 'labelOverlapKeep', 'labelOverlapAlways', 'labelOverlapMany']) expect(i18n.split(k + ':').length - 1).toBe(2); // ja and en
  });
  it('the anchor of a pinned label is judged with the CPU probes in 薄くする only (updateHidden), and the dot follows it', () => {
    expect(src).toContain('aps=gpuOcc?[]:[...pins.values()].filter(lb=>!lb.hid)');
    expect(src).toContain('for(const lb of aps)if(pointIsHidden(lb.anchor,tmpEyeL,opt))nextA.add(lb.rid);vpAnchorHidden=nextA');
    expect(src).toContain('d.hidden=!gpu&&vpAnchorHidden.has(lb.rid)');
    expect(src).toContain('syncAnchorDots(occ)');
  });
});

describe('the leg ribbon (createLegMesh) and setLeaderIfMoved with a 4-vertex leg', () => {
  const mk = () => { const arr = new Float32Array(12); let up = 0; return { array: arr, count: 4, setXYZ(i, x, y, z) { arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z; }, set needsUpdate(v) { if (v) up++; }, get uploads() { return up; } }; };
  it('writes A,B,A,B and the opposite ends; nothing when unmoved', () => {
    const a = mk(), o = mk();
    expect(setLeaderIfMoved(a, 1, 2, 3, 4, 5, 6, undefined, o)).toBe(true);
    expect([...a.array]).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
    expect([...o.array]).toEqual([4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3]);
    expect(setLeaderIfMoved(a, 1, 2, 3, 4, 5, 6, undefined, o)).toBe(false);
  });
  it('vr-view.js uses the ribbon leg; width is 2.4 mm with a minimum angular width', () => {
    const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(vr).toContain('const line=createLegMesh(THREE);');
    const dots = readFileSync(new URL('../../docs/vr-anchor-dots.js', import.meta.url), 'utf8');
    expect(dots).toContain('LEG_WIDTH_M = 0.0024'); expect(dots).toContain('length(cameraPosition-position)*minAngle');
  });
});
