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
// translucent display = inside && !escaped.
export function pushOut(p, isInside, inBox, voxel, { maxSteps = 4000 } = {}) {
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
    if (ok && t0 >= 0 && t0 < best) { best = t0; bestDir = d; }
  }
  if (!bestDir) return { inside: true, escaped: false, pushed: false, p, dist: Infinity };
  if (best <= PUSH_FREE_VOXELS * voxel) return { inside: true, escaped: true, pushed: false, p, dist: best };
  const t = best + PUSH_MARGIN_VOXELS * voxel;
  return { inside: true, escaped: true, pushed: true, p: { x: p.x + bestDir[0] * t, y: p.y + bestDir[1] * t, z: p.z + bestDir[2] * t }, dist: best };
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
