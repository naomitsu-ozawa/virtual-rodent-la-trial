// VR pinned result labels: embedded judgement, push out to the tissue surface, thinning of overlapping cards. Pure helpers: no three.js, no DOM.
// All points are plain {x,y,z} in the volume's object space (box +-halfExt) unless said otherwise.
//
// 1) pushOut: the label's base point (the anchor, or the card place when the label was moved) is "inside" when isInside(p) is true (vr-view.js passes
//    vr-point.js classifiedAt: a voxel of a SHOWN segment, classification channel >= 128). The point is then pushed along the SHORTEST of 26 directions
//    that leave the tissue and stay tissue-free up to the box boundary (so a marrow cavity or a pocket in the tissue is never chosen), to the first free
//    voxel + PUSH_MARGIN_VOXELS. A base point within PUSH_FREE_VOXELS of free space (a surface voxel: the volume's written depth lies about 2 voxels behind
//    the surface, so a card there is drawn normally) is not moved. No direction leaves = enclosed: translucent.
// 2) createLabelThinner: cards that overlap on the screen (seen from the head) lose the farther one.

export const PUSH_FREE_VOXELS = 2, PUSH_MARGIN_VOXELS = 3;

const DIRS = (() => {
  const a = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (!x && !y && !z) continue;
    const l = Math.hypot(x, y, z); a.push([x / l, y / l, z / l]);
  }
  return a;
})();
export const PUSH_DIRECTIONS = DIRS.length;

// p: base point. isInside(p) -> true inside shown tissue. inBox(p) -> true inside the volume box. voxel: the smallest side of a classification voxel (object space).
// -> { inside, escaped, pushed, p, dist }. inside = the base point is in tissue; escaped = outside tissue (before or after the push); pushed = p moved;
// translucent display = inside && !escaped. freeVoxels: how near free space a base point may stay unmoved (PUSH_FREE_VOXELS; every caller uses the default).
// accept: accept(point) -> false rejects a pushed place (pinJudge: the line drawn to it would be longer than the limit, analysis-label.js THE RULE). The shortest
// way out whose pushed place is accepted wins; when none is, the result is "not escaped" (the card stays where it is, translucent): the limit is never exceeded for the push.
export function pushOut(p, isInside, inBox, voxel, { maxSteps = 4000, freeVoxels = PUSH_FREE_VOXELS, accept = null } = {}) {
  if (!isInside(p)) return { inside: false, escaped: true, pushed: false, p, dist: 0 };
  const step = 0.5 * voxel, q = { x: 0, y: 0, z: 0 };
  let best = Infinity, bestDir = null;
  for (const d of DIRS) {
    let t0 = -1, ok = true;
    for (let i = 1; i <= maxSteps; i++) {
      const t = i * step;
      if (t0 < 0 && t >= best) { ok = false; break; } // a longer escape than the best so far
      q.x = p.x + d[0] * t; q.y = p.y + d[1] * t; q.z = p.z + d[2] * t;
      if (!inBox(q)) break; // reached the box boundary: the rest of the way is clear
      const inside = isInside(q);
      if (t0 < 0) { if (!inside) t0 = t; } else if (inside) { ok = false; break; } // tissue again after the exit: a pocket, not the outside
    }
    if (!ok || t0 < 0 || t0 >= best) continue;
    if (accept && t0 > freeVoxels * voxel) { const t = t0 + PUSH_MARGIN_VOXELS * voxel; q.x = p.x + d[0] * t; q.y = p.y + d[1] * t; q.z = p.z + d[2] * t; if (!accept(q)) continue; } // the place this way would give is beyond the cap
    best = t0; bestDir = d;
  }
  if (!bestDir) return { inside: true, escaped: false, pushed: false, p, dist: Infinity };
  if (best <= freeVoxels * voxel) return { inside: true, escaped: true, pushed: false, p, dist: best };
  const t = best + PUSH_MARGIN_VOXELS * voxel;
  return { inside: true, escaped: true, pushed: true, p: { x: p.x + bestDir[0] * t, y: p.y + bestDir[1] * t, z: p.z + bestDir[2] * t }, dist: best };
}

// ---- the leader's length limit of a pinned card (analysis-label.js THE RULE) ----
// The line as vr-view.js placeLabel draws it (world metres), without three.js. A = the anchor, B = the card's place, head = the viewer's head (all world).
//  g.off (a card the user moved): the card's centre is B and the card faces the head (three.js Object3D.lookAt: z = towards the head, x = up x z, y = z x x, up = +y); the line
//         runs from A to the point of the card's rectangle (half size g.hw x g.hh, world) in the direction of A as seen in the card's plane (analysis-label.js rectEdgePoint).
//         With A under the card (a card wider than its leader is long: the usual case on a small model) that point is the edge beyond A, and the line runs under the card.
//  !g.off (no stored offset: the default place seen from B): the line runs from A to the middle of the card's lower edge: B + g.fwd towards the head + g.rise upwards.
export function pinLine(A, B, head, g) {
  let zx = head.x - B.x, zy = head.y - B.y, zz = head.z - B.z, l = Math.hypot(zx, zy, zz);
  if (l > 0) { zx /= l; zy /= l; zz /= l; } else { zx = 0; zy = 0; zz = 1; }
  if (!g.off) return Math.hypot(B.x + zx * g.fwd - A.x, B.y + zy * g.fwd + g.rise - A.y, B.z + zz * g.fwd - A.z);
  let xx = zz, xz = -zx, xl = Math.hypot(xx, xz); // x = up x z = (z.z, 0, -z.x)
  if (xl === 0) { zz += 1e-4; l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l; xx = zz; xz = -zx; xl = Math.hypot(xx, xz); } // looking straight up / down: three.js nudges z
  xx /= xl; xz /= xl;
  const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx; // y = z x x (x.y = 0)
  const dx = A.x - B.x, dy = A.y - B.y, dz = A.z - B.z, px = dx * xx + dz * xz, py = dx * yx + dy * yy + dz * yz, pz = dx * zx + dy * zy + dz * zz;
  const ax = Math.abs(px), ay = Math.abs(py);
  let ex = 0, ey = -g.hh; // no direction: the middle of the lower edge (rectEdgePoint)
  if (!(ax < 1e-12 && ay < 1e-12)) { const t = Math.min(ax > 1e-12 ? g.hw / ax : Infinity, ay > 1e-12 ? g.hh / ay : Infinity); ex = px * t; ey = py * t; }
  return Math.hypot(px - ex, py - ey, pz);
}
// The place of a pinned card under the limit, in the volume's object space (every frame; vr-view.js pinPlace). a = the label's anchor; v0 = anchor -> the place of the initial
// display (the stored offset, or where that display pushes the card out of the tissue); K = keepLengthFactor (1 up to the initial scale, initial / current beyond it).
//  - Not enlarged (K >= 1): a + v0, the place of.
//  - Enlarged, no place pushed while enlarged (v1 = null): a + K v0. Object-space lengths times the holder scale are world lengths, so in the world this card sits, relative to
//    its anchor, exactly where the initial scale puts it: the line drawn is the line the initial scale draws from where the viewer is now. That line is the limit T.
//  - Enlarged, v1 = anchor -> a place found by a push while enlarged (pinJudge): lineOf(p) -> the line drawn with the card at p (object space) now (pinLine through the volume's
//    world matrix, the head and the card's size as they are in this frame). T = lineOf(a + K v0). The card goes to a + v1 when its line is within T; when it is not (the head
//    moved, the card's size changed or the scale grew since the judgement) to a + kappa v1 with the largest kappa found by going down from 1 in steps of 1 / PIN_SCAN to the
//    first step whose line is within T, then PIN_BISECT halvings towards the step before it (the line is not monotone in kappa: it has a kink where the anchor passes under
//    the card's edge, so this is the upper end of the highest stretch a step lands in); when no step above 0 is within T, back to a + K v0, whose line is T by definition.
//    So no frame draws a line longer than T.
// -> out {x,y,z}; out.kappa = the factor applied to v1 (1: as judged; 0 < kappa < 1: shortened; -1: no v1 in use; -2: back at a + K v0).
export const PIN_SCAN = 16, PIN_BISECT = 12, PIN_LINE_EPS = 1e-7; // 1e-7 m: a line this much over T counts as on it
export function pinPlaceLimited(a, v0, K, v1, lineOf, out = { x: 0, y: 0, z: 0 }) {
  const k = K < 1 ? Math.max(0, K) : 1;
  out.x = a.x + v0.x * k; out.y = a.y + v0.y * k; out.z = a.z + v0.z * k; out.kappa = -1;
  if (!(k < 1) || !v1) return out;
  const T = lineOf(out) + PIN_LINE_EPS, at = q => { out.x = a.x + v1.x * q; out.y = a.y + v1.y * q; out.z = a.z + v1.z * q; return lineOf(out) <= T; };
  if (at(1)) { out.kappa = 1; return out; }
  let hi = 1, lo = -1;
  for (let i = 1; i < PIN_SCAN; i++) { const q = 1 - i / PIN_SCAN; if (at(q)) { lo = q; break; } hi = q; } // not down to 0: a card on its own anchor is no place for a pushed card
  if (lo < 0) { out.x = a.x + v0.x * k; out.y = a.y + v0.y * k; out.z = a.z + v0.z * k; out.kappa = -2; return out; }
  for (let i = 0; i < PIN_BISECT; i++) { const m = (lo + hi) / 2; if (at(m)) lo = m; else hi = m; }
  at(lo); out.kappa = lo; return out;
}
// A pushed place that pinPlaceLimited had to change in this frame (place.kappa: shortened, or back at a + K v0) is not the free place that was judged. When the card then lies
// in a tissue voxel (one voxel test, no search) it is drawn translucent for this frame, like a card with no free place within the limit: otherwise the depth test would hide it
// until the next judgement (which the head's movement does not start). cx = {isInside} or null.
export const pinPulledIntoTissue = (place, cx) => place.kappa !== 1 && place.kappa !== -1 && !!cx && cx.isInside(place);
// When a pinned card is judged (the embedded judgement and the push out of the tissue: pushOut, up to thousands of voxel tests). lb = the card's state {lab, ref, emb};
// gen = the generation of the judgement's inputs (the shown segments, the classification, the section planes: vr-view.js embedInputs); hs = the holder scale; K as above;
// settled = the scale has not changed for PIN_SETTLE_MS (createScaleSettle). -> bit 1: lb.ref is due (the place of the initial display: the judgement of, for a new /
// moved label or new inputs; it does not depend on the scale), bit 2: lb.emb is due (the limited place a + K ref.v of an enlarged model: once per scale, and only when the
// scale has stopped; while it changes nothing is judged and pinPlaceLimited alone keeps the line within T).
export const PIN_SETTLE_MS = 150;
export function pinDue(lb, gen, hs, K, settled) {
  const ref = !(lb.ref && lb.ref.lab === lb.lab && lb.ref.gen === gen);
  const emb = K < 1 && settled && (ref || !(lb.emb && lb.emb.lab === lb.lab && lb.emb.gen === gen && lb.emb.hs === hs));
  return (ref ? 1 : 0) | (emb ? 2 : 0);
}
// the scale "has stopped": step(scale, now) every frame -> true once the scale has been the same for ms (a pinch, the slider, the + / - buttons and "real size" all change it)
export function createScaleSettle(ms = PIN_SETTLE_MS) {
  let last = NaN, at = -Infinity;
  return { step(scale, now) { if (scale !== last) { last = scale; at = now; } return now - at >= ms; } };
}
// One card's judgement (what pinDue said is due). a = the anchor, base = the anchor + the stored offset (or the anchor itself), both object space; cx = {isInside, inBox, voxel}
// or null (no classification: nothing is embedded); lineOf as in pinPlaceLimited (the head, the card's size and the volume's place of this frame).
//  lb.ref = {lab, gen, v, len, trans}: v = anchor -> base, or where pushOut moves that card out of the tissue (null: the card sits at its anchor); trans = in the tissue with no
//           way out (translucent). As (a base point within PUSH_FREE_VOXELS of free space is not moved).
//  lb.emb = {lab, gen, hs, v, len, trans} for the limited place B = a + K ref.v: the same pushOut, same rule for a surface voxel (not moved), plus accept: a pushed place is
//           taken only when the line drawn to it is within T = lineOf(B) (so the push never lengthens the line). v = anchor -> that place (null: not pushed); trans = B is in
//           the tissue and no way out is within T: the card stays at B, translucent.
// lb.emb is dropped when it is not judged in the same call as a new lb.ref (its B changed). -> the number of pushOut calls (for the measurements).
export function pinJudge(lb, due, a, base, K, hs, gen, cx, lineOf) {
  let n = 0;
  if (due & 1) {
    const r = cx ? pushOut({ x: base.x, y: base.y, z: base.z }, cx.isInside, cx.inBox, cx.voxel) : null, p = r && r.pushed ? r.p : base, v = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z }, len = Math.hypot(v.x, v.y, v.z);
    lb.ref = { lab: lb.lab, gen, v: len > 1e-12 ? v : null, len, trans: !!r && r.inside && !r.escaped }; lb.emb = null; if (r) n++;
  }
  if (due & 2) {
    const rf = lb.ref; let v = null, len = 0, trans = rf.trans;
    if (rf.v && cx) {
      const B = { x: a.x + rf.v.x * K, y: a.y + rf.v.y * K, z: a.z + rf.v.z * K }, T = lineOf(B) + PIN_LINE_EPS, r = pushOut(B, cx.isInside, cx.inBox, cx.voxel, { accept: q => lineOf(q) <= T }); n++;
      trans = r.inside && !r.escaped; if (r.pushed) { v = { x: r.p.x - a.x, y: r.p.y - a.y, z: r.p.z - a.z }; len = Math.hypot(v.x, v.y, v.z); }
    }
    lb.emb = { lab: lb.lab, gen, hs, v, len, trans };
  }
  return n;
}

// ---- thinning of overlapping cards ----
export const GAZE_ON_RAD = 6 * Math.PI / 180, GAZE_HOLD_RAD = 9 * Math.PI / 180; // a card this close to the gaze is "looked at" (the larger angle keeps a card that already was)
export const THIN_KEEP_PAD = 0.1; // hysteresis: a card that was shown may overlap by 10 % of its size more, one that was hidden must clear by 10 %

// the screen rectangle (tangent plane of the gaze) of a card: centre (u,v), half size (hw,hh), distance, angle to the gaze; null when behind the head
export function screenRect(item, head, f, r, u, out = null) {
  const dx = item.x - head.x, dy = item.y - head.y, dz = item.z - head.z, zf = dx * f.x + dy * f.y + dz * f.z;
  if (!(zf > 1e-4)) return null;
  const dist = Math.hypot(dx, dy, dz), o = out || {};
  o.u = (dx * r.x + dy * r.y + dz * r.z) / zf; o.v = (dx * u.x + dy * u.y + dz * u.z) / zf; o.hw = item.halfW / zf; o.hh = item.halfH / zf; o.dist = dist; o.ang = Math.acos(Math.min(1, zf / dist));
  return o;
}
const norm = v => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l } };
export function gazeBasis(gaze) {
  const f = norm(gaze);
  let r = { x: f.z, y: 0, z: -f.x }; // f x up(0,1,0)
  if (Math.hypot(r.x, r.z) < 1e-6) r = { x: 1, y: 0, z: 0 };
  r = norm(r);
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  return { f, r, u };
}

// items: [{id, x, y, z (world), halfW, halfH (world half size of the card as drawn), lit}], view: {head, gaze}. Returns the Set of ids to hide
// (the same Set object every call: valid until the next update; the rectangles and sets are reused, nothing is allocated per card).
// Order of keeping: lit (always shown) -> looked at (nearest the gaze first) -> the rest nearest first. A card is kept unless it overlaps one already kept.
export function createLabelThinner() {
  let shown = new Set(), gazed = new Set(), nextShown = new Set(), nextGazed = new Set();
  const hide = new Set(), keep = [], cand = [], pool = [];
  return {
    update(items, view) {
      const { f, r, u } = gazeBasis(view.gaze);
      hide.clear(); keep.length = 0; cand.length = 0; nextShown.clear(); nextGazed.clear();
      let n = 0;
      for (const it of items) {
        const s = screenRect(it, view.head, f, r, u, pool[n] || (pool[n] = {}));
        if (!s) continue; // behind the head: not on the screen, hides nothing
        n++; s.id = it.id;
        if (it.lit) { keep.push(s); nextShown.add(it.id); continue; }
        s.gz = s.ang < GAZE_ON_RAD || (gazed.has(it.id) && s.ang < GAZE_HOLD_RAD);
        cand.push(s);
      }
      cand.sort((a, b) => a.gz !== b.gz ? (a.gz ? -1 : 1) : a.gz ? a.ang - b.ang : (a.dist * (shown.has(a.id) ? 0.9 : 1)) - (b.dist * (shown.has(b.id) ? 0.9 : 1)));
      for (const c of cand) {
        const pad = shown.has(c.id) ? -THIN_KEEP_PAD : THIN_KEEP_PAD;
        let hit = false;
        for (const k of keep) {
          if (Math.abs(c.u - k.u) < (c.hw + k.hw) * (1 + pad) && Math.abs(c.v - k.v) < (c.hh + k.hh) * (1 + pad)) { hit = true; break; }
        }
        if (hit) { hide.add(c.id); continue; }
        keep.push(c); nextShown.add(c.id); if (c.gz) nextGazed.add(c.id);
      }
      let t = shown; shown = nextShown; nextShown = t; t = gazed; gazed = nextGazed; nextGazed = t;
      return hide;
    },
    reset() { shown.clear(); gazed.clear(); hide.clear(); },
  };
}

// ---- cut planes and "covered from the head" ----
// planes [{x,y,z,w}], count, cut (bit i = plane i clips): the side n.p - w < 0 of a clipping plane is removed (the march of vr-pick.js keeps >= 0). true = p is cut away.
export function clippedAt(p, planes, count, cut) {
  for (let i = 0; i < count; i++) {
    if (!((cut >> i) & 1)) continue;
    const pl = planes[i];
    if (pl.x * p.x + pl.y * p.y + pl.z * p.z - pl.w < 0) return true;
  }
  return false;
}
// is the card at `to` hidden from the eye `from` behind shown tissue? A coarse walk (one voxel per step) over the part of the segment inside the box; the last
// endSkip voxels before the card are not looked at (a card at / just in front of a surface is not covered by it: the depth bias, vr-depth.js).
// isInside(p) -> tissue here; halfExt = box half extents; voxel = the smallest voxel side. All object space.
export function rayCovered(from, to, isInside, halfExt, voxel, endSkip = 2.5) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.hypot(dx, dy, dz);
  if (!(L > 1e-9)) return false;
  const O = [from.x, from.y, from.z], D = [dx / L, dy / L, dz / L];
  let t0 = 0, t1 = L - endSkip * voxel;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(D[a]) < 1e-12) { if (Math.abs(O[a]) > halfExt[a]) return false; continue; }
    const ta = (-halfExt[a] - O[a]) / D[a], tb = (halfExt[a] - O[a]) / D[a];
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  const q = { x: 0, y: 0, z: 0 };
  for (let t = t0; t <= t1; t += voxel) {
    q.x = O[0] + D[0] * t; q.y = O[1] + D[1] * t; q.z = O[2] + D[2] * t;
    if (isInside(q)) return true;
  }
  return false;
}

// ---- upload savers (build 7xx: weight) ----
// a leader's two end points: the vertex buffer is re-sent to the GPU only when an end moved by more than eps (world metres: 1e-4 = 0.1 mm).
// attr = a BufferAttribute (or anything with .array, setXYZ, needsUpdate). Returns true when it was written (= will be uploaded).
export const LEADER_EPS = 1e-4; // 0.1 mm: invisible; normal head sway moves the ends (they follow the head) by tens of micrometres
export function setLeaderIfMoved(attr, x0, y0, z0, x1, y1, z1, eps = LEADER_EPS) {
  const a = attr.array;
  if (Math.abs(a[0] - x0) <= eps && Math.abs(a[1] - y0) <= eps && Math.abs(a[2] - z0) <= eps && Math.abs(a[3] - x1) <= eps && Math.abs(a[4] - y1) <= eps && Math.abs(a[5] - z1) <= eps) return false;
  attr.setXYZ(0, x0, y0, z0); attr.setXYZ(1, x1, y1, z1); attr.needsUpdate = true;
  return true;
}

// a small LRU cache of drawn label faces (canvas + texture), key -> value. max entries; an evicted value goes through dispose(value); a value for which
// isUsed(value) is true (shown right now) is never evicted. get() refreshes the recency. clear() disposes everything.
export function createFaceCache(max, dispose = () => {}, isUsed = () => false) {
  const m = new Map();
  return {
    get(key) { if (!m.has(key)) return undefined; const v = m.get(key); m.delete(key); m.set(key, v); return v; },
    set(key, v) {
      if (m.has(key)) m.delete(key);
      m.set(key, v);
      for (const [k, e] of m) { if (m.size <= max) break; if (e === v || isUsed(e)) continue; m.delete(k); dispose(e); }
    },
    clear() { for (const e of m.values()) dispose(e); m.clear(); },
    values() { return [...m.values()]; },
    get size() { return m.size; },
  };
}

export const CARD_W0 = 512, CARD_W_MAX = 1024, CARD_STEP = 32, CARD_PAD_R = 28, CARD_MIN_SHRINK = 0.5, CARD_ELLIPSIS = '…';
export const CARD_H0 = 154, CARD_LINE_H = 52, CARD_Y1 = 50, CARD_Y2 = 108, CARD_MAX_LINES = 4;
const NO_LINE_START = '）)」』】〕、。，．・：；！？!?,.:;%'; // a wrapped line does not start with these (kinsoku)
const NO_LINE_END = '（(「『【〔'; // ... nor ends with these (an opening mark)
const isWord = c => /[A-Za-z0-9]/.test(c || '');
// the squeeze / ellipsis of a text that does not fit in avail: a text up to avail / CARD_MIN_SHRINK is squeezed into avail; a longer one is cut (with an ellipsis) to that first.
function fitLast(measure, i, text, avail) {
  const n = measure(i, text); if (n <= avail) return { text, maxWidth: null };
  const limit = avail / CARD_MIN_SHRINK; let t = text;
  if (n > limit) { // the longest prefix (+ an ellipsis) whose natural width is within the limit
    const cs = [...text]; let lo = 0, hi = cs.length - 1; // the width is monotone in the prefix: binary search
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(i, cs.slice(0, mid).join('') + CARD_ELLIPSIS) <= limit) lo = mid; else hi = mid - 1; }
    t = cs.slice(0, lo).join('') + CARD_ELLIPSIS;
  }
  return { text: t, maxWidth: measure(i, t) <= avail ? null : avail };
}
// the greedy wrap of a text into lines of width <= avail (at most `max` lines; the rest stays in the last one, for fitLast). A break avoids the middle of a word (DP4), a line that starts
// with a closing mark and a line that ends with an opening mark, within a few characters back. -> [string]
function wrap(measure, i, text, avail, max) {
  const cs = [...text], out = []; let from = 0;
  while (from < cs.length) {
    if (out.length === max - 1) { out.push(cs.slice(from).join('')); break; }
    if (measure(i, cs.slice(from).join('')) <= avail) { out.push(cs.slice(from).join('')); break; }
    let lo = from + 1, hi = cs.length - 1; // the largest end (exclusive) whose line fits (at least one character)
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(i, cs.slice(from, mid).join('')) <= avail) lo = mid; else hi = mid - 1; }
    let end = lo;
    for (let e = lo; e > Math.max(from + 1, lo - 6); e--) if (!(isWord(cs[e - 1]) && isWord(cs[e])) && !NO_LINE_START.includes(cs[e]) && !NO_LINE_END.includes(cs[e - 1])) { end = e; break; }
    out.push(cs.slice(from, end).join('')); from = end;
  }
  return out;
}
// measure(i, text) -> the natural width in px of line i (0 = the name, 1 = the second line) drawn in its font; name / sub = { text, x } (x = where the text starts).
// -> { w, wr, h, hr, lines: [{ text, x, y, maxWidth, sub }] } in drawing order (the name's lines, then the second line; maxWidth null = draw plainly, else pass it to fillText).
// New objects each call (called only when a picture is drawn, not per frame).
export function cardLayout(measure, name, sub) {
  const nn = measure(0, name.text), ns = measure(1, sub.text);
  const need = Math.max(name.x + nn + CARD_PAD_R, sub.x + ns + CARD_PAD_R);
  const w = need <= CARD_W0 ? CARD_W0 : Math.min(CARD_W_MAX, Math.ceil(need / CARD_STEP) * CARD_STEP);
  const availN = w - CARD_PAD_R - name.x, availS = w - CARD_PAD_R - sub.x;
  const parts = nn <= availN ? [name.text] : wrap(measure, 0, name.text, availN, CARD_MAX_LINES);
  const lines = parts.map((t, j) => { const f = j === parts.length - 1 ? fitLast(measure, 0, t, availN) : { text: t, maxWidth: null }; return { text: f.text, x: name.x, y: CARD_Y1 + j * CARD_LINE_H, maxWidth: f.maxWidth, sub: false }; });
  const extra = (parts.length - 1) * CARD_LINE_H, f2 = fitLast(measure, 1, sub.text, availS);
  lines.push({ text: f2.text, x: sub.x, y: CARD_Y2 + extra, maxWidth: f2.maxWidth, sub: true });
  const h = CARD_H0 + extra;
  return { w, wr: w / CARD_W0, h, hr: h / CARD_H0, lines };
}
// the half size (world) of a card of size ratio r (wr or hr) at size factor k: the number every size user shares (thinning rectangles, the leader's edge, ...)
export const cardHalfW = (baseW, r, k) => baseW * r * k / 2;
export const cardHalfH = cardHalfW;
