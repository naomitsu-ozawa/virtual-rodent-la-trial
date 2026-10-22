import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_SECTION_PLANES, PLANE_COLORS, nextPlaneColor,
  FLING_SPEED_MPS, FLING_WINDOW_MS, FLING_STALE_MS, FLING_MIN_SPAN_MS, FLING_COS, FLING_FADE_S, FLING_UNDO_MS, FLING_MAX_FLY_MPS,
  createVelocityTracker, flingDecision, capVelocity, flyStep, makeSectionSnapshot, restorePlan, createSectionUndo, undoButtonPlace,
} from '../../docs/vr-section-frame.js';
import { SECTION_DELETE_ID, VIEW_TOGGLE_ID, ringIdsFor } from '../../docs/vr-view-toggle.js';
import { DEFAULT_WHEEL } from '../../docs/vr-ring.js';
import { I18N } from '../../docs/i18n.js';

// delete a section by throwing it away (fling), 「元に戻す」 for a few seconds, and the 断面を削除 ring item.
const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
const src = read('vr-view.js');

// a hand moving along dir at speed (m/s) for ms, sampled every 11 ms (90 Hz), ending at `end`
const sweep = (tr, { end = { x: 0, y: 0, z: 0 }, dir, speed, ms = 200, t0 = 1000, step = 11 }) => {
  const n = Math.floor(ms / step); let t = t0;
  for (let i = n; i >= 0; i--) { const d = -i * step / 1000 * speed; tr.push(t0 + (n - i) * step, { x: end.x + dir.x * d, y: end.y + dir.y * d, z: end.z + dir.z * d }); t = t0 + (n - i) * step; }
  return t;
};
const X = { x: 1, y: 0, z: 0 };

describe('fling constants', () => {
  it('named, tunable values', () => {
    expect(FLING_SPEED_MPS).toBe(1.0); expect(FLING_WINDOW_MS).toBe(200); expect(FLING_STALE_MS).toBe(120); expect(FLING_MIN_SPAN_MS).toBe(30); expect(FLING_COS).toBe(0.26);
  });
});

describe('createVelocityTracker', () => {
  it('measures the velocity of the last FLING_WINDOW_MS (90 Hz samples)', () => {
    const tr = createVelocityTracker(), t = sweep(tr, { dir: X, speed: 3 });
    const v = tr.velocity(t); expect(v.x).toBeCloseTo(3, 5); expect(v.y).toBeCloseTo(0, 6); expect(v.speed).toBeCloseTo(3, 5);
  });
  it('only the last FLING_WINDOW_MS count: a frame that was fast earlier but then stood (nearly) still for longer reads slow', () => {
    const tr = createVelocityTracker();
    sweep(tr, { dir: X, speed: 4, ms: 200, t0: 1000 });                       // fast, ends at t = 1198
    for (let i = 1; i <= 21; i++) tr.push(1198 + i * 11, { x: 0.001 * i, y: 0, z: 0 }); // then nearly still for 231 ms (longer than the 200 ms window)
    expect(tr.velocity(1198 + 21 * 11).speed).toBeLessThan(0.2);
  });
  it('the PEAK over the window (the trigger is let go a little after the fastest part): a flick that ended 60 ms before the release still reads fast', () => {
    const tr = createVelocityTracker();
    sweep(tr, { dir: X, speed: 4, ms: 120, t0: 1000 });                       // fast, ends at t = 1110
    for (let i = 1; i <= 5; i++) tr.push(1110 + i * 11, { x: 0, y: 0, z: 0 });   // still 55 ms
    const m = tr.measure(1110 + 5 * 11 + 8);
    expect(m.v.speed).toBeCloseTo(4, 5); expect(m.v.x).toBeCloseTo(4, 5); expect(m.spanMs).toBeGreaterThanOrEqual(FLING_MIN_SPAN_MS); expect(m.ageMs).toBe(8); expect(m.why).toBeNull();
  });
  it('no usable estimate: one sample, too short a span, or a stale last sample (the hand paused before the release)', () => {
    const tr = createVelocityTracker(); expect(tr.velocity(0)).toBeNull();
    tr.push(1000, { x: 0, y: 0, z: 0 }); expect(tr.velocity(1000)).toBeNull();
    tr.push(1011, { x: 0.05, y: 0, z: 0 }); expect(tr.velocity(1011)).toBeNull(); // span 11 ms < 30 ms
    expect(tr.measure(1011).why).toBe('span');
    tr.push(1040, { x: 0.12, y: 0, z: 0 }); expect(tr.velocity(1040)).not.toBeNull();
    expect(tr.velocity(1040 + 80)).not.toBeNull(); // 80 ms is one slow frame plus the release event (was the limit of 50 ms)
    expect(tr.measure(1040 + FLING_STALE_MS + 1)).toMatchObject({ v: null, why: 'stale' }); // no frame sample for more than FLING_STALE_MS
  });
  it('reset forgets everything', () => { const tr = createVelocityTracker(); sweep(tr, { dir: X, speed: 2 }); tr.reset(); expect(tr.size).toBe(0); expect(tr.velocity(1200)).toBeNull(); });
});

describe('flingDecision: speed, direction, slow release, two-hand', () => {
  const center = { x: 0, y: 1.2, z: -0.5 }, from = { x: 0.1, y: 1.2, z: -0.5 }, head = { x: 0, y: 1.6, z: 0 };
  const mk = (dir, speed) => { const k = speed / Math.hypot(dir.x, dir.y, dir.z); return { x: dir.x * k, y: dir.y * k, z: dir.z * k }; };
  it('a fast flick straight away from the volume centre deletes', () => {
    const r = flingDecision({ v: mk(X, 2.5), from, center, head }); expect(r.fling).toBe(true); expect(r.cos).toBeCloseTo(1, 6); expect(r.reason).toBe('fling');
  });
  it('speed threshold: just below does not delete, at the threshold does', () => {
    expect(flingDecision({ v: mk(X, FLING_SPEED_MPS - 0.01), from, center, head })).toMatchObject({ fling: false, reason: 'slow' });
    expect(flingDecision({ v: mk(X, FLING_SPEED_MPS), from, center, head }).fling).toBe(true);
  });
  it('normal slow releases never delete (a careful drag is below 1.0 m/s), outward included', () => {
    for (const s of [0, 0.1, 0.4, 0.8, 0.95]) for (const d of [X, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]) expect(flingDecision({ v: mk(d, s) || { x: 0, y: 0, z: 0 }, from, center, head }).fling).toBe(false);
    expect(flingDecision({ v: { x: 0, y: 0, z: 0 }, from, center, head }).fling).toBe(false);
  });
  it('direction: toward the volume (inward) or across it never deletes, however fast', () => {
    expect(flingDecision({ v: mk({ x: -1, y: 0, z: 0 }, 4), from, center, head })).toMatchObject({ fling: false, reason: 'inward' });
    expect(flingDecision({ v: mk({ x: 0, y: 1, z: 0 }, 4), from, center, head }).fling).toBe(false); // tangential: cos = 0
  });
  it('direction: ~75 degrees is the edge (cos 0.26)', () => {
    const a = (deg) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180), z: 0 });
    expect(flingDecision({ v: mk(a(55), 3), from, center, head }).fling).toBe(true);
    expect(flingDecision({ v: mk(a(70), 3), from, center, head }).fling).toBe(true);
    expect(flingDecision({ v: mk(a(80), 3), from, center, head }).fling).toBe(false);
  });
  it('a grip / two-hand gesture during the drag blocks it, even for a perfect throw', () => {
    expect(flingDecision({ v: mk(X, 5), from, center, head, blocked: true })).toMatchObject({ fling: false, reason: 'volume-gesture' });
  });
  it('no velocity estimate: nothing happens', () => { expect(flingDecision({ v: null, from, center, head })).toMatchObject({ fling: false, reason: 'no-velocity' }); });
  it('a frame on the volume centre uses the head -> frame direction (away from the viewer); without a head it does nothing', () => {
    const onCenter = { x: 0, y: 1.2, z: -0.5 };
    expect(flingDecision({ v: mk({ x: 0, y: 0, z: -1 }, 3), from: onCenter, center, head }).fling).toBe(true);  // away from the viewer
    expect(flingDecision({ v: mk({ x: 0, y: 0, z: 1 }, 3), from: onCenter, center, head }).fling).toBe(false);  // toward the viewer
    expect(flingDecision({ v: mk({ x: 0, y: 0, z: -1 }, 3), from: onCenter, center, head: null })).toMatchObject({ fling: false, reason: 'no-axis' });
  });
  it('end to end with the tracker: throw, slow release, and a throw after pausing', () => {
    const fast = createVelocityTracker(), tf = sweep(fast, { end: from, dir: X, speed: 3 });
    expect(flingDecision({ v: fast.velocity(tf + 5), from, center, head }).fling).toBe(true);
    const slow = createVelocityTracker(), ts = sweep(slow, { end: from, dir: X, speed: 0.5 });
    expect(flingDecision({ v: slow.velocity(ts + 5), from, center, head }).fling).toBe(false);
    const paused = createVelocityTracker(), tp = sweep(paused, { end: from, dir: X, speed: 3 });
    for (let i = 1; i <= 18; i++) paused.push(tp + i * 11, from);
    expect(flingDecision({ v: paused.velocity(tp + 18 * 11 + 5), from, center, head }).fling).toBe(false); // held still ~200 ms before the release
  });
});

describe('fly-off', () => {
  it('flies along the velocity and fades linearly to 0 in FLING_FADE_S, then is done', () => {
    let f = { pos: { x: 0, y: 0, z: 0 }, v: { x: 2, y: 0, z: 0 }, age: 0 };
    const half = flyStep(f, FLING_FADE_S / 2); expect(half.opacity).toBeCloseTo(0.5, 6); expect(half.done).toBe(false); expect(half.pos.x).toBeCloseTo(2 * FLING_FADE_S / 2, 6);
    const end = flyStep({ ...f, age: half.age }, FLING_FADE_S / 2 + 0.001); expect(end.opacity).toBe(0); expect(end.done).toBe(true);
  });
  it('dt <= 0 does not move it; the throw speed is capped', () => {
    const f = { pos: { x: 1, y: 2, z: 3 }, v: { x: 9, y: 0, z: 0 }, age: 0 };
    expect(flyStep(f, 0)).toMatchObject({ pos: { x: 1, y: 2, z: 3 }, age: 0, done: false }); expect(flyStep(f, -1).pos.x).toBe(1);
    expect(Math.hypot(...Object.values(capVelocity({ x: 9, y: 0, z: 12 })))).toBeCloseTo(FLING_MAX_FLY_MPS, 6);
    expect(capVelocity({ x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
  });
});

// A model of vr-view.js's planes list built only from the pure helpers (delete = snapshot + remove; restore = restorePlan + splice), to check restore fidelity and numbering.
const makeModel = () => {
  const planes = [], undo = createSectionUndo();
  const add = (extra = {}) => { const color = nextPlaneColor(planes.map(p => p.color)); const pl = { color, cut: true, side: 1, hand: null, position: { x: planes.length * 0.01, y: 0.02, z: -0.03 }, quaternion: { x: 0, y: 0.7071, z: 0, w: 0.7071 }, ...extra }; planes.push(pl); return pl; };
  const del = (pl, now) => { const i = planes.indexOf(pl); undo.push(makeSectionSnapshot({ index: i, color: pl.color, cut: pl.cut, side: pl.side, hand: pl.hand, position: pl.position, quaternion: pl.quaternion, wasSelected: true }), now); planes.splice(i, 1); };
  const restore = now => {
    const e = undo.peek(now); if (!e) return null;
    const plan = restorePlan(e.snap, planes.map(p => p.color), planes.length, MAX_SECTION_PLANES); if (!plan.ok) return plan;
    undo.pop(now); const pl = { color: plan.color, cut: e.snap.cut, side: e.snap.side, hand: e.snap.hand, position: { ...e.snap.position }, quaternion: { ...e.snap.quaternion } };
    planes.splice(plan.index, 0, pl); return pl;
  };
  return { planes, undo, add, del, restore };
};

describe('undo restores the section exactly', () => {
  it('position, orientation, colour, number (list index), clip and side / hand', () => {
    const m = makeModel(); const [a, b, c, d] = [0, 1, 2, 3].map(() => m.add());
    b.side = -1; b.cut = false; b.hand = 'left'; b.position = { x: 0.123, y: -0.045, z: 0.067 }; b.quaternion = { x: 0.1, y: 0.2, z: 0.3, w: 0.927 };
    const before = JSON.parse(JSON.stringify(b)), colors = m.planes.map(p => p.color);
    m.del(b, 1000);
    expect(m.planes).toEqual([a, c, d]); // numbering closes up: 断面1, 2, 3
    const r = m.restore(2000);
    expect(m.planes.indexOf(r)).toBe(1); expect(r).toEqual(before); expect(m.planes.map(p => p.color)).toEqual(colors);
  });
  it('the snapshot is a frozen copy: later changes to the live plane do not leak in', () => {
    const pos = { x: 1, y: 2, z: 3 }, q = { x: 0, y: 0, z: 0, w: 1 }, s = makeSectionSnapshot({ index: 2, color: 0xabcdef, cut: true, side: -1, hand: 'right', position: pos, quaternion: q });
    pos.x = 99; q.w = 0; expect(s.position.x).toBe(1); expect(s.quaternion.w).toBe(1); expect(Object.isFrozen(s)).toBe(true);
    expect(makeSectionSnapshot({ index: 0, color: 1, cut: 1, side: 0.3, hand: 'nope', position: pos, quaternion: q })).toMatchObject({ side: 1, hand: null, cut: true });
  });
  it('the deleted colour is free for the next plane, but undo after a new plane took it gives a different free colour (no two planes share one)', () => {
    const m = makeModel(); const ps = [0, 1, 2].map(() => m.add());
    m.del(ps[0], 0); const n = m.add(); expect(n.color).toBe(PLANE_COLORS[0]); // the freed colour is reused by the new plane
    const r = m.restore(100); expect(r.color).not.toBe(n.color); expect(new Set(m.planes.map(p => p.color)).size).toBe(m.planes.length);
  });
  it('count limit: undo at 10 planes is refused (and the entry is kept); after a delete it works again', () => {
    const m = makeModel(); const ps = Array.from({ length: MAX_SECTION_PLANES }, () => m.add());
    m.del(ps[4], 0); m.add(); expect(m.planes.length).toBe(MAX_SECTION_PLANES);
    expect(m.restore(10)).toMatchObject({ ok: false, reason: 'full' }); expect(m.undo.size(10)).toBe(1);
    m.del(m.planes[0], 20); expect(m.planes.length).toBe(MAX_SECTION_PLANES - 1);
    expect(m.restore(30)).toBeTruthy(); expect(m.planes.length).toBe(MAX_SECTION_PLANES); expect(m.planes.length).toBeLessThanOrEqual(MAX_SECTION_PLANES);
    expect(new Set(m.planes.map(p => p.color)).size).toBe(m.planes.length);
  });
  it('the index is clamped when the list got shorter meanwhile', () => {
    const m = makeModel(); const ps = [0, 1, 2, 3].map(() => m.add());
    m.del(ps[3], 0); m.del(ps[1], 10); m.del(ps[0], 20);
    expect(restorePlan(m.undo.peek(30).snap, m.planes.map(p => p.color), m.planes.length)).toMatchObject({ ok: true, index: 0 });
    expect(restorePlan(makeSectionSnapshot({ index: 7, color: PLANE_COLORS[5], cut: true, side: 1, position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }), [], 1).index).toBe(1);
  });
  it('several deletes undo newest first, each back at its own number', () => {
    const m = makeModel(); const ps = [0, 1, 2, 3, 4].map(() => m.add());
    m.del(ps[3], 0); m.del(ps[1], 100);
    expect(m.planes).toEqual([ps[0], ps[2], ps[4]]);
    m.restore(200); m.restore(300);
    expect(m.planes).toEqual(ps);
  });
});

describe('createSectionUndo: the undo window', () => {
  const snap = i => makeSectionSnapshot({ index: i, color: 1, cut: true, side: 1, position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
  it('alive for FLING_UNDO_MS, then gone', () => {
    const u = createSectionUndo(); u.push(snap(0), 1000);
    expect(u.peek(1000 + FLING_UNDO_MS - 1)).not.toBeNull(); expect(u.remainingMs(1000 + 1000)).toBe(FLING_UNDO_MS - 1000);
    expect(u.peek(1000 + FLING_UNDO_MS)).toBeNull(); expect(u.size(1000 + FLING_UNDO_MS)).toBe(0); expect(u.remainingMs(1000 + FLING_UNDO_MS)).toBe(0);
  });
  it('each entry has its own deadline; pop takes the newest; clear empties', () => {
    const u = createSectionUndo(); u.push(snap(0), 0); u.push(snap(1), 3000);
    expect(u.pop(4000).snap.index).toBe(1); expect(u.peek(4000).snap.index).toBe(0);
    expect(u.peek(5100)).toBeNull(); u.push(snap(2), 6000); u.clear(); expect(u.peek(6000)).toBeNull();
  });
});

describe('undo board placement', () => {
  it('pulled toward the head but kept 0.30 - 0.70 m from it', () => {
    const head = { x: 0, y: 1.6, z: 0 }, d = p => Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z);
    expect(d(undoButtonPlace({ x: 0, y: 1.6, z: -0.5 }, head))).toBeCloseTo(0.38, 6);
    expect(d(undoButtonPlace({ x: 0, y: 1.6, z: -0.35 }, head))).toBeCloseTo(0.30, 6);
    expect(d(undoButtonPlace({ x: 0, y: 1.6, z: -1.5 }, head))).toBeCloseTo(0.70, 6);
    expect(undoButtonPlace(head, head).z).toBeLessThan(head.z);
  });
});

describe('ring item 断面を削除: slot coexistence with the VR表示 toggle, enable / disable', () => {
  it('8 slots in AR, 7 in VR with a full default ring; both extras present', () => {
    expect(ringIdsFor([...DEFAULT_WHEEL], true)).toEqual([...DEFAULT_WHEEL, VIEW_TOGGLE_ID, SECTION_DELETE_ID]);
    expect(ringIdsFor([...DEFAULT_WHEEL], false)).toEqual([...DEFAULT_WHEEL, SECTION_DELETE_ID]);
  });
  it('wheelAvail: 断面を削除 needs shown sections and a selected plane (disabled with no planes); 元に戻す is also on while a deleted section can be restored', () => {
    expect(src).toContain('case SECTION_DELETE_ID:return!!(section.on&&section.selected&&planes.includes(section.selected))');
    expect(src).toContain("case'undo':return undo.size>0||!!secUndo.peek(performance.now())");
  });
  it('wheelDo: 断面を削除 deletes the selected plane through the undoable path; the ring 元に戻す restores the section first', () => {
    expect(src).toContain('case SECTION_DELETE_ID:deleteSection(section.selected,{c});break');
    expect(src).toContain("case'undo':if(secUndo.peek(performance.now()))restoreSection(c);else undoLast();break");
    expect(src).toContain("id===SECTION_DELETE_ID?tr('vrSecDeleteRing')");
  });
});

describe('vr-view.js wiring (static)', () => {
  it('the throw is decided at the trigger release BEFORE endDrag (which would snap the plane back into the box)', () => {
    expect(src).toContain('if(!tryFling(c))endDrag(c)');
    const t = src.slice(src.indexOf('const tryFling='), src.indexOf('const tryFling=') + 900);
    expect(t).toContain('const blocked=!!dg.volTouched||!!twoHand||grabbing.size>0'); expect(t).toContain('flingDecision({v:m.v,from:tmpFv,center:tmpFc,head,blocked})'); // blocked also gates the out-of-view delete
    expect(t).not.toContain('.push('); // no extra sample at the release (the event carries the last frame's pose)
  });
  it('the dragged frame is sampled per frame from the press on; a grip / two-hand gesture restarts the record and marks the drag as touched; a new press resets', () => {
    expect(src).toContain('fp=dg?dg.pl:pr?pr.dragPl:null;');
    expect(src).toContain('if(twoHand||grabbing.size){fv.reset();fh.reset();if(dg)dg.volTouched=true}else if(fp){fp.obj.getWorldPosition(tmpFv);fv.push(js0,tmpFv);');
    expect(src).toContain('volTouched:false}');
    expect(src).toContain('c.userData.press=pr;(c.userData.fv||=createVelocityTracker()).reset()');
  });
  it('removePlane = detachPlane + disposePlane; a deleted plane leaves the list at once, flies, fades and is disposed (also at cleanup)', () => {
    expect(src).toContain('const removePlane=pl=>{detachPlane(pl);disposePlane(pl)}');
    expect(src).toContain('flyStep({pos:o.position,v:f.v,age:f.age},dt)');
    expect(src).toContain('flying.forEach(f=>disposePlane(f.pl))');
    expect(src).toContain('secUndo.push(snap,performance.now())');
  });
  it('the undo board is laser-clickable: part of boardHits, handled in selectstart before the help board, hidden until a delete', () => {
    expect(src).toContain("for(const k of ['menu','help','hist','wheel','pwheel','undoBtn','hu','ev'])"); // + the histogram board,: + the HU line's live panel
    expect(src).toContain('if(bd.undoBtn){restoreSection(c);return}');
    expect(src.indexOf('if(bd.undoBtn){restoreSection(c);return}')).toBeLessThan(src.indexOf('if(bd.hu||bd.ev)return;'));
    expect(read('vr-undo-button.js')).toContain('mesh.visible = false');
  });
  it('the 断面 tab 削除 button goes through the same undoable delete', () => { expect(src).toContain('L.remove,false,()=>deleteSection(pl)'); });
  it('the bench keeps its immediate removePlane', () => { expect(src).toContain('removePlane(bench.tempPlane)'); });
  it('the snapshot of a deleted plane holds the resting position (snapPlaneCenterIntoBox, as a normal release), not the thrown one', () => {
    const t = src.slice(src.indexOf('const deleteSection='), src.indexOf('const restoreSection='));
    expect(t).toContain('snapPlaneCenterIntoBox(pl.obj.position');
    expect(t).toContain('position:rest');
    expect(t.indexOf('snapPlaneCenterIntoBox')).toBeLessThan(t.indexOf('startFly(pl,vel)'));
    expect(t).not.toContain('pl.obj.position.set'); // the flying frame is not moved back
  });
  it('restore puts the plane in holder space at its number and refreshes the numbering; the selected plane drives the menu page', () => {
    const t = src.slice(src.indexOf('const restoreSection='), src.indexOf('const restoreSection=') + 1500);
    for (const w of ['restorePlan(e.snap', 'holder.add(pl.obj)', 'planes.splice(plan.index,0,pl)', 'refreshHandles()', 'pl.side=sn.side', 'pl.hand=sn.hand', 'sn.position.x', 'sn.quaternion.w']) expect(t, w).toContain(w);
  });
  it('strings exist in both languages', () => {
    for (const k of ['vrSecUndo', 'vrSecDeletedShort', 'vrSecDeleted', 'vrSecRestored', 'vrSecUndoFull', 'vrSecDeleteRing']) { expect(I18N.ja[k], k).toBeTruthy(); expect(I18N.en[k], k).toBeTruthy(); }
    expect(I18N.ja.vrSecUndo).toBe('元に戻す'); expect(I18N.ja.vrSecDeleteRing).toBe('断面を削除');
  });
});
