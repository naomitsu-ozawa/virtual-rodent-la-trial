// VR/AR section planes: the plane limit and the frame's depth state (build 509). Pure helpers: no three.js, no DOM.
//
// Limit (build 509: 4 -> 10). The same number is in the volume shader (#define SECTION_PLANES in vr-view.js: the cutPlanes[] uniform array, the per-ray cross / slice
// arrays and their loops); tests/unit/vr-section-frame.test.js compares the two. Only the planes in use are tested: the shader's per-ray loops skip every index >= planeCount
// (vr-view.js writes planeCount = the number of shown planes, never the limit).
export const MAX_SECTION_PLANES = 10;
// frame colours, one per plane index (the first four are the build 400 palette: soft gold, sky, rose, mint; the hands use vivid orange / indigo outside this set)
export const PLANE_COLORS = [0xf2d27a, 0x8ec5ff, 0xf5a3c7, 0x9be3b0, 0xc4a8ff, 0xffb980, 0x7fdcd2, 0xd6e885, 0xff9f94, 0xd2d9e0];
// the colour of the next plane: the first palette colour no plane uses (a palette of 10 for at most 10 planes: always one free)
export const nextPlaneColor = usedColors => { const used = new Set(usedColors); return PLANE_COLORS.find(c => !used.has(c)) ?? PLANE_COLORS[0]; };

export const frameDepthTest = (occlusion, lit) => !!occlusion && !lit;

export const ARROW_LEN = 0.04, ARROW_FADE_S = 0.15, ARROW_FLASH_MS = 1000; // ARROW_FLASH_MS: after 「切り口反転」 the arrow shows this long (the laser is on the menu, the plane is not lit)
export const arrowFade = (op, lit, dt) => Math.min(1, Math.max(0, op + (lit ? 1 : -1) * Math.max(0, dt) / ARROW_FADE_S));
// drawn when the one-side cut (settings.cut === 2) is on for a clipping plane and the fade has not run out
export const arrowShown = (cutMode, planeCut, op) => cutMode === 2 && !!planeCut && op > 0;

// the section number tag is picked before anything else (vr-point.js resolveTriggerTarget): when the tissue surface along the same ray is nearer than the tag by more than eps
// (world metres) and the frame is hidden by the tissue (occlusion on), the tag is not there for the laser. tagDistance / tissueDistance: world metres along the ray (null = none).
export const tagBehindTissue = (occlusion, tagDistance, tissueDistance, eps = 1e-4) =>
  !!occlusion && tagDistance != null && tissueDistance != null && tissueDistance < tagDistance - eps;

// the 断面 tab lists the planes 4 at a time (10 rows do not fit the menu): page p (0-based) of count planes. page is clamped; pages >= 1.
export const SECTION_ROWS_PER_PAGE = 4;
export function sectionPage(count, page = 0, per = SECTION_ROWS_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(Math.max(0, count) / per)), p = Math.min(pages - 1, Math.max(0, page | 0));
  return { page: p, pages, from: p * per, to: Math.min(count, (p + 1) * per) };
}
// the page that holds plane index i
export const pageOfPlane = (i, per = SECTION_ROWS_PER_PAGE) => Math.max(0, Math.floor(i / per));

export const FLING_SPEED_MPS = 1.5, FLING_WINDOW_MS = 150, FLING_MIN_SPAN_MS = 30, FLING_STALE_MS = 120, FLING_COS = 0.5, FLING_MIN_RADIUS_M = 0.03;
export const FLING_FADE_S = 0.3, FLING_MAX_FLY_MPS = 4, FLING_UNDO_MS = 5000; // fly-off / fade time, speed cap of the flying frame, how long 「元に戻す」 stays
export const FLING_DEBUG_MS = 8000; // ?debug / デバッグモード: how long the measured values of the last release stay on screen
// Velocity of a sampled point (the dragged frame): push(t ms, {x,y,z} world m) once per frame. measure(now) looks at the samples of the last windowMs before `now` (the release) and
// returns the FASTEST velocity over any pair of them at least FLING_MIN_SPAN_MS apart: {v: {x,y,z (m/s), speed} | null, n, spanMs, ageMs, why}. v is null (why says which) for
// fewer than 2 samples ('samples'), the newest older than FLING_STALE_MS ('stale'), or no pair far enough apart ('span'). A frame that stood still for the whole window reads ~0.
// velocity(now) = measure(now).v
export function createVelocityTracker({ windowMs = FLING_WINDOW_MS, minSpanMs = FLING_MIN_SPAN_MS, staleMs = FLING_STALE_MS } = {}) {
  let s = [];
  const measure = now => {
    const w = s.filter(q => q.t >= now - windowMs && q.t <= now), n = w.length, ageMs = n ? now - w[n - 1].t : null;
    if (n < 2) return { v: null, n, spanMs: 0, ageMs, why: 'samples' };
    if (ageMs > staleMs) return { v: null, n, spanMs: 0, ageMs, why: 'stale' };
    let best = null, bestSpan = 0;
    for (let j = 1; j < n; j++) {
      let i = j - 1; while (i > 0 && w[j].t - w[i].t < minSpanMs) i--;
      const a = w[i], b = w[j], span = b.t - a.t; if (span < minSpanMs) continue;
      const k = 1000 / span, x = (b.x - a.x) * k, y = (b.y - a.y) * k, z = (b.z - a.z) * k, speed = Math.hypot(x, y, z);
      if (!best || speed > best.speed) { best = { x, y, z, speed }; bestSpan = span; }
    }
    return best ? { v: best, n, spanMs: bestSpan, ageMs, why: null } : { v: null, n, spanMs: w[n - 1].t - w[0].t, ageMs, why: 'span' };
  };
  return {
    push(t, p) { s.push({ t, x: p.x, y: p.y, z: p.z }); const keep = t - 3 * windowMs; while (s.length > 2 && s[0].t < keep) s.shift(); },
    measure,
    velocity(now) { return measure(now).v; },
    reset() { s = []; },
    get size() { return s.length; },
  };
}
// Is the release a throw? v: {x,y,z} (m/s, world) or null: the frame's velocity; from: the frame's centre at the release (world); center: the volume centre; head: the viewer
// (used only when the frame is on the centre); blocked: a two-hand / grip gesture moved or scaled the volume during the drag. -> {fling, reason, speed, cos}
export function flingDecision({ v, from, center, head = null, blocked = false, minSpeed = FLING_SPEED_MPS, minCos = FLING_COS } = {}) {
  if (blocked) return { fling: false, reason: 'volume-gesture', speed: v ? Math.hypot(v.x, v.y, v.z) : 0, cos: 0 };
  if (!v || !from) return { fling: false, reason: 'no-velocity', speed: 0, cos: 0 };
  const speed = Math.hypot(v.x, v.y, v.z);
  let ax = from.x - (center?.x ?? 0), ay = from.y - (center?.y ?? 0), az = from.z - (center?.z ?? 0), r = Math.hypot(ax, ay, az);
  if (!center || r < FLING_MIN_RADIUS_M) { if (head) { ax = from.x - head.x; ay = from.y - head.y; az = from.z - head.z; r = Math.hypot(ax, ay, az); } else r = 0; }
  const axis = r > 1e-6, cos = axis && speed > 1e-9 ? (v.x * ax + v.y * ay + v.z * az) / (speed * r) : 0; // cos is reported even for a slow release (the ?debug readout)
  if (!(speed >= minSpeed)) return { fling: false, reason: 'slow', speed, cos };
  if (!axis) return { fling: false, reason: 'no-axis', speed, cos: 0 };
  return cos >= minCos ? { fling: true, reason: 'fling', speed, cos } : { fling: false, reason: 'inward', speed, cos };
}
// ?debug readout of the last section release (vr-view.js shows it for FLING_DEBUG_MS): d = flingDecision's result + the tracker's {n, spanMs, ageMs, why} + hand (controller
// peak speed, m/s, or null). -> lines of text (the first one is the verdict).
const FLING_WHY = { ja: { fling: '削除した', slow: '遅い', inward: '外向きでない', 'volume-gesture': 'グリップ／両手操作あり', 'no-velocity': '速さを測れず', 'no-axis': '方向が決まらない' },
  en: { fling: 'deleted', slow: 'too slow', inward: 'not outward', 'volume-gesture': 'grip / two-hand used', 'no-velocity': 'no speed estimate', 'no-axis': 'no direction' } };
const FLING_WHY_V = { ja: { samples: 'サンプル不足', stale: '最後のサンプルが古い', span: '区間が短い' }, en: { samples: 'too few samples', stale: 'last sample too old', span: 'span too short' } };
export function flingDebugLines(d, ja = true) {
  const L = ja ? 'ja' : 'en', f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-'), why = FLING_WHY[L][d.reason] || d.reason, wv = d.why ? (FLING_WHY_V[L][d.why] || d.why) : '';
  const head = d.fling ? (ja ? '投げ判定: 削除した' : 'Throw: deleted') : (ja ? '投げ判定: 削除しない（' : 'Throw: kept (') + why + (wv ? ' / ' + wv : '') + (ja ? '）' : ')');
  return [
    head,
    (ja ? '枠の速さ ' : 'frame speed ') + f2(d.speed) + ' m/s (≥ ' + FLING_SPEED_MPS + ')' + (d.hand != null ? (ja ? '  手 ' : '  hand ') + f2(d.hand) + ' m/s' : ''),
    (ja ? '方向 cos ' : 'direction cos ') + f2(d.cos) + ' (≥ ' + FLING_COS + ')',
    (ja ? 'サンプル ' : 'samples ') + (d.n ?? 0) + (ja ? ' / 区間 ' : ' / span ') + Math.round(d.spanMs || 0) + ' ms' + (ja ? ' / 離すまで ' : ' / to release ') + (d.ageMs == null ? '-' : Math.round(d.ageMs)) + ' ms',
  ];
}
// fly-off of the deleted frame: one step of dt seconds. f = {pos, v, age}; opacity fades linearly 1 -> 0 over FLING_FADE_S; done at the end. capVelocity limits the throw to FLING_MAX_FLY_MPS.
export function capVelocity(v, maxMps = FLING_MAX_FLY_MPS) { const s = Math.hypot(v.x, v.y, v.z); if (!(s > maxMps)) return { x: v.x, y: v.y, z: v.z }; const k = maxMps / s; return { x: v.x * k, y: v.y * k, z: v.z * k }; }
export function flyStep(f, dt) {
  const d = Math.max(0, dt), age = f.age + d;
  return { pos: { x: f.pos.x + f.v.x * d, y: f.pos.y + f.v.y * d, z: f.pos.z + f.v.z * d }, v: f.v, age, opacity: Math.max(0, 1 - age / FLING_FADE_S), done: age >= FLING_FADE_S };
}

// What 「元に戻す」 needs to put a deleted section back exactly: its place in the list (= its number), colour, clip on/off, kept side, last hand, and its pose in the volume's
// object space (holder-local, so it stays right even if the volume was moved or scaled meanwhile). Plain numbers only (a copy: nothing shares the live objects).
export function makeSectionSnapshot({ index, color, cut, side, hand = null, position, quaternion, wasSelected = false }) {
  return Object.freeze({
    index: index | 0, color, cut: !!cut, side: side < 0 ? -1 : 1, hand: hand === 'left' || hand === 'right' ? hand : null,
    position: Object.freeze({ x: position.x, y: position.y, z: position.z }), quaternion: Object.freeze({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }),
    wasSelected: !!wasSelected,
  });
}
// Where / how a snapshot is restored given the current planes (their colours, in list order): {ok:false, reason:'full'} at the limit, else the index (clamped to the list) and the colour
// (the saved one; when another plane has taken it meanwhile, the first free palette colour, so two planes never share a colour).
export function restorePlan(snap, usedColors, count, max = MAX_SECTION_PLANES) {
  if (!snap) return { ok: false, reason: 'none' };
  if (count >= max) return { ok: false, reason: 'full' };
  const used = new Set(usedColors), color = used.has(snap.color) ? nextPlaneColor(usedColors) : snap.color;
  return { ok: true, index: Math.min(Math.max(0, snap.index), count), color, recolored: color !== snap.color };
}
// The deletions that can still be undone: newest on top, each alive for windowMs (a second delete does not cancel the first: undo restores in reverse order, so each saved index is right).
// Adding a plane meanwhile is allowed (the index is clamped, the colour re-checked by restorePlan).
export function createSectionUndo({ windowMs = FLING_UNDO_MS, max = MAX_SECTION_PLANES } = {}) {
  let items = [];
  const prune = now => { items = items.filter(e => e.until > now); };
  return {
    push(snap, now) { prune(now); items.push({ snap, until: now + windowMs }); if (items.length > max) items.shift(); },
    peek(now) { prune(now); return items.length ? items[items.length - 1] : null; },
    pop(now) { prune(now); return items.pop() || null; },
    remainingMs(now) { prune(now); return items.length ? Math.max(0, items[items.length - 1].until - now) : 0; },
    size(now) { prune(now); return items.length; },
    clear() { items = []; },
  };
}
// The 「元に戻す」 board: placed once where the hand let go, pulled toward the head by `pull` m and kept min..max m from the head (a distance the other hand's laser reaches easily).
export const UNDO_BTN_PULL_M = 0.12, UNDO_BTN_MIN_M = 0.30, UNDO_BTN_MAX_M = 0.70;
export function undoButtonPlace(hand, head, { pull = UNDO_BTN_PULL_M, min = UNDO_BTN_MIN_M, max = UNDO_BTN_MAX_M } = {}) {
  const dx = hand.x - head.x, dy = hand.y - head.y, dz = hand.z - head.z, d = Math.hypot(dx, dy, dz);
  if (!(d > 1e-6)) return { x: head.x, y: head.y - 0.1, z: head.z - min };
  const k = Math.min(max, Math.max(min, d - pull)) / d;
  return { x: head.x + dx * k, y: head.y + dy * k, z: head.z + dz * k };
}
