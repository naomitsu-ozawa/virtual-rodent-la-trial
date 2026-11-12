import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  WHEEL_SLOTS, WHEEL_ITEMS, DEFAULT_WHEEL, normalizeWheelItems, serializeWheelItems, parseWheelItems, setWheelItem, moveWheelItem, clearWheelItem, migrateWheelSectionFlip,
  wheelAngles, wheelSlotFromAngle, wheelSlotFromLocal, createWheelStick, createButtonPress,
} from '../../docs/vr-ring.js';

describe('normalizeWheelItems', () => {
  const def = [...DEFAULT_WHEEL];
  it('bad input gives the default, as a new array', () => {
    for (const raw of [null, undefined, 'x', 5, {}, [null, null, null, null, null, null], ['nope', 'x', 3, null, null, null]]) {
      const r = normalizeWheelItems(raw); expect(r).toEqual(def); expect(r).not.toBe(DEFAULT_WHEEL);
    }
    expect(normalizeWheelItems(null)).not.toBe(normalizeWheelItems(null));
  });
  it('length 3 is padded, length 9 cut', () => {
    expect(normalizeWheelItems(['undo', 'home', 'menu'])).toEqual(['undo', 'home', 'menu', null, null, null]);
    expect(normalizeWheelItems(['undo', 'home', 'menu', 'screenshot', 'section-add', 'section-next', 'snap-axial', 'snap-coronal', 'menu'])).toHaveLength(WHEEL_SLOTS);
  });
  it('unknown ids and later duplicates become null', () => {
    expect(normalizeWheelItems(['undo', 'zzz', 'undo', 'home', null, null])).toEqual(['undo', null, null, 'home', null, null]);
  });
  it('catalog ids are unique', () => expect(new Set(WHEEL_ITEMS.map(i => i.id)).size).toBe(WHEEL_ITEMS.length));
});
describe('settings (de)serialization', () => {
  it('round trip', () => { const a = ['home', null, 'undo', null, null, 'menu']; expect(parseWheelItems(serializeWheelItems(a))).toEqual(a); });
  it('broken text or values fall back to the default', () => {
    for (const t of ['{bad', '', 'null', '"x"', undefined]) expect(parseWheelItems(t)).toEqual([...DEFAULT_WHEEL]);
    expect(serializeWheelItems('x')).toBe(JSON.stringify([...DEFAULT_WHEEL]));
  });
});
describe('edit helpers', () => {
  const a = ['undo', 'home', null, null, null, 'menu'];
  it('setWheelItem swaps a duplicate', () => {
    expect(setWheelItem(a, 2, 'menu')).toEqual(['undo', 'home', 'menu', null, null, null]);
    expect(setWheelItem(a, 3, 'screenshot')[3]).toBe('screenshot');
    expect(setWheelItem(a, 0, 'undo')).toEqual(a);
    expect(a[2]).toBeNull(); // input untouched
  });
  it('moveWheelItem wraps round', () => {
    expect(moveWheelItem(a, 5, 1)).toEqual(['menu', 'home', null, null, null, 'undo']);
    expect(moveWheelItem(a, 0, -1)).toEqual(['menu', 'home', null, null, null, 'undo']);
    expect(moveWheelItem(a, 0, 1)).toEqual(['home', 'undo', null, null, null, 'menu']);
  });
  it('clearWheelItem', () => expect(clearWheelItem(a, 1)).toEqual(['undo', null, null, null, null, 'menu']));
});
describe('wheelAngles', () => {
  it('6, 2, 3', () => {
    expect(wheelAngles(6)).toEqual([0, 60, 120, 180, 240, 300]); expect(wheelAngles(2)).toEqual([270, 90]); expect(wheelAngles(4)).toEqual([0, 90, 180, 270]); expect(wheelAngles(4, false)).toEqual([0, 90, 180, 270]); expect(wheelAngles(4, true)).toEqual([315, 45, 225, 135]); expect(wheelAngles(6, true)).toEqual([300, 60, 0, 240, 120, 180]); expect(wheelAngles(3, true)).toEqual([240, 120, 0]); /* an earlier change: the region ring's 6 / 3 items */ expect(wheelAngles(2, true)).toEqual([270, 90]); expect(wheelAngles(3)).toEqual([0, 120, 240]);
  });
});
describe('createWheelStick', () => {
  const en = [true, true, true, true, true, false];
  // stick vector at angle a (0 = up, clockwise) and magnitude m -> axes (ax, ay); up is negative ay
  const ax = (a, m) => [m * Math.sin(a * Math.PI / 180), -m * Math.cos(a * Math.PI / 180)];
  const feed = (s, a, m) => s.update(...ax(a, m), en);
  it('does not select until it has been at rest', () => {
    const s = createWheelStick();
    expect(feed(s, 0, 1)).toMatchObject({ highlight: null, changed: false, confirm: null });
    expect(feed(s, 0, 1).highlight).toBeNull();
    s.update(0, 0, en); expect(feed(s, 0, 1).highlight).toBe(0);
  });
  it('up = slot 0, 120 deg = slot 2', () => {
    const s = createWheelStick(); s.update(0, 0, en);
    expect(feed(s, 0, 1)).toMatchObject({ highlight: 0, changed: true });
    expect(feed(s, 120, 1).highlight).toBe(2);
  });
  it('hysteresis: +5 deg stays, +15 deg changes', () => {
    const s = createWheelStick(); s.update(0, 0, en); feed(s, 0, 1);
    expect(feed(s, 35, 1)).toMatchObject({ highlight: 0, changed: false });
    expect(feed(s, 45, 1)).toMatchObject({ highlight: 1, changed: true });
    expect(feed(s, 25, 1).highlight).toBe(1); // 30 - 5 stays
    expect(feed(s, 15, 1).highlight).toBe(0);
  });
  it('an empty sector clears the light and releasing there confirms nothing', () => {
    const s = createWheelStick(); s.update(0, 0, en); feed(s, 0, 1);
    expect(feed(s, 180 + 60 + 60, 1).highlight).toBeNull(); // 300 = empty slot 5 (more than 40 deg from slot 4)
    expect(feed(s, 300, 1).highlight).toBeNull();
    expect(s.update(0, 0, en).confirm).toBeNull();
  });
  it('keeps the light between 0.25 and 0.5, confirms once below 0.25', () => {
    const s = createWheelStick(); s.update(0, 0, en); feed(s, 120, 1);
    expect(feed(s, 120, 0.4).highlight).toBe(2);
    expect(feed(s, 120, 0.3).confirm).toBeNull();
    const r = feed(s, 120, 0.1); expect(r.confirm).toBe(2); expect(r.highlight).toBeNull();
    expect(feed(s, 120, 0.1).confirm).toBeNull();
  });
  it('changed on every new item', () => {
    const s = createWheelStick(); s.update(0, 0, en);
    let n = 0; for (const a of [0, 60, 120, 120, 180]) if (feed(s, a, 1).changed) n++;
    expect(n).toBe(4);
  });
});
describe('wheelSlotFromAngle / wheelSlotFromLocal', () => {
  it('angles', () => { const e = Array(6).fill(true); expect(wheelSlotFromAngle(359, 6, e)).toBe(0); expect(wheelSlotFromAngle(200, 6, e)).toBe(3); expect(wheelSlotFromAngle(200, 6, [true, true, true, false, true, true])).toBeNull(); });
  it('local: hole and margin are null, each angle maps', () => {
    const R = 0.055;
    expect(wheelSlotFromLocal(0, 0, 6, R)).toBeNull(); expect(wheelSlotFromLocal(0, 0.3 * R, 6, R)).toBeNull(); expect(wheelSlotFromLocal(0, 2 * R, 6, R)).toBeNull();
    wheelAngles(6).forEach((a, k) => expect(wheelSlotFromLocal(R * Math.sin(a * Math.PI / 180), R * Math.cos(a * Math.PI / 180), 6, R)).toBe(k));
    expect(wheelSlotFromLocal(-R, 0, 2, R)).toBe(0); expect(wheelSlotFromLocal(R, 0, 2, R)).toBe(1);
  });
});
describe('createButtonPress', () => {
  it('short before 500 ms', () => { const b = createButtonPress(); expect(b.update(true, 0)).toBeNull(); expect(b.update(true, 499)).toBeNull(); expect(b.update(false, 499)).toBe('short'); });
  it('long once at 500 ms, nothing on release', () => {
    const b = createButtonPress(); b.update(true, 0);
    expect(b.update(true, 500)).toBe('long'); expect(b.update(true, 900)).toBeNull(); expect(b.update(false, 1000)).toBeNull();
  });
  it('release at exactly 500 without a frame in between is not short; idle is null', () => {
    const b = createButtonPress(); expect(b.update(false, 0)).toBeNull(); b.update(true, 0); expect(b.update(false, 500)).toBeNull();
  });
});

describe('createRingMenu (drawing)', () => {
  it('maps a uv to a slot and keeps its labels', async () => {
    const { createRingMenu } = await import('../../docs/vr-ring.js');
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
    const THREE = await import('three');
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    try {
      const r = createRingMenu(THREE); r.setItems(['a', 'b', null, 'd', 'e', 'f'], [true, true, false, true, true, true], []);
      expect(r.n()).toBe(6); expect(r.mesh.visible).toBe(false);
      const R = 0.055 / 0.16, at = (deg, f = R) => ({ x: 0.5 + f * Math.sin(deg * Math.PI / 180), y: 0.5 + f * Math.cos(deg * Math.PI / 180) });
      expect(r.slotFromUv(at(0))).toBe(0); expect(r.slotFromUv(at(60))).toBe(1);
      expect(r.slotFromUv(at(120))).toBeNull(); // empty slot
      expect(r.slotFromUv(at(30))).toBeNull(); // the gap between two sectors (60 deg sectors, 4 deg gap: 28..32 is gap)
      expect(r.slotFromUv(at(26))).toBe(0); expect(r.slotFromUv(at(34))).toBe(1);
      expect(r.slotFromUv(at(0, 0.45))).toBe(0); // the outer part of the ring (an annular sector, not a box)
      expect(r.slotFromUv(at(0, 0.5))).toBeNull(); // beyond the ring
      expect(r.slotFromUv(at(180))).toBe(3);
      expect(r.slotFromUv({ x: 0.5, y: 0.5 })).toBeNull(); expect(r.slotFromUv(at(0, 0.49))).toBeNull(); expect(r.slotFromUv(at(0, 0.1))).toBeNull(); // the hole and the margin
      r.setItems(['a', 'b', 'c', 'd', 'e', 'f'], [true, false, true, true, true, true], []);
      expect(r.slotFromUv(at(60))).toBeNull(); // disabled slot
      r.placeAt({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 5 }); expect(r.mesh.position.toArray()).toEqual([1, 2, 3]);
      r.dispose();
    } finally { delete globalThis.document; }
  });
});

describe('ring laser hit', () => {
  it('inDisk covers the dark disc, not the margin; a ring in front of the hand is hit by its laser, nearer than a board behind it', async () => {
    const { createRingMenu } = await import('../../docs/vr-ring.js');
    const THREE = await import('three');
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    try {
      const r = createRingMenu(THREE); r.setItems(['a', 'b', 'c', 'd', 'e', 'f'], [true, true, true, true, true, true], []);
      expect(r.inDisk({ x: 0.5, y: 0.5 })).toBe(true);        // the blank centre is in the disc, but is not an item
      expect(r.slotFromUv({ x: 0.5, y: 0.5 })).toBeNull();
      expect(r.inDisk({ x: 0.5, y: 0.5 + 0.55 * 0.5 })).toBe(true);
      expect(r.inDisk({ x: 0.02, y: 0.02 })).toBe(false);     // the corner of the board
      // hand at the origin looking down -z, ring 0.1 m in front facing the head (at the origin), a board 0.6 m behind the ring
      r.placeAt({ x: 0, y: 0, z: -0.1 }, { x: 0, y: 0, z: 0 }); r.mesh.visible = true; r.mesh.updateMatrixWorld(true);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()); board.position.set(0, 0, -0.7); board.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
      const xr = rc.intersectObject(r.mesh, false)[0], xb = rc.intersectObject(board, false)[0];
      expect(xr.distance).toBeCloseTo(0.1, 5); expect(xr.distance).toBeLessThan(xb.distance);
      expect(r.inDisk(xr.uv)).toBe(true);
      // pointing at the top item hits that slot at the ring plane
      const top = new THREE.Vector3(0, 0.055, -0.1).normalize(), x2 = new THREE.Raycaster(new THREE.Vector3(), top).intersectObject(r.mesh, false)[0];
      expect(r.slotFromUv(x2.uv)).toBe(0);
      // a ray from the hand pointing away from the head can never meet a ring placed 4 cm toward the head (the old placement)
      r.placeAt({ x: 0, y: 0, z: 0.04 }, { x: 0, y: 0, z: 1 }); r.mesh.updateMatrixWorld(true);
      expect(rc.intersectObject(r.mesh, false)).toHaveLength(0);
      r.dispose();
    } finally { delete globalThis.document; }
  });
});

describe('ring disc for every hand', () => {
  it('the disc covers blank gaps between items and the hole, and slots stay null there', async () => {
    const { createRingMenu } = await import('../../docs/vr-ring.js');
    const THREE = await import('three');
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    try {
      const r = createRingMenu(THREE); r.setItems(['a', 'b', null, 'd', 'e', 'f'], [true, true, false, true, true, true], []);
      const R = 0.055 / 0.16, at = (deg, f = R) => ({ x: 0.5 + f * Math.sin(deg * Math.PI / 180), y: 0.5 + f * Math.cos(deg * Math.PI / 180) });
      for (const uv of [{ x: 0.5, y: 0.5 }, at(120), at(30), at(0, 0.3)]) { expect(r.inDisk(uv)).toBe(true); }
      expect(r.slotFromUv(at(30))).toBeNull(); expect(r.slotFromUv(at(120))).toBeNull();
      expect(r.inDisk(at(0, 0.6))).toBe(false);
      r.dispose();
    } finally { delete globalThis.document; }
  });
});

describe('the laser stops on the whole drawn ring', () => {
  it('every point of the sectors, their gaps, the hole and the lit sector growth is inside inDisk; every slot hit is too', async () => {
    const { createRingMenu } = await import('../../docs/vr-ring.js');
    const THREE = await import('three');
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } });
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    try {
      for (const n of [2, 3, 6, 9]) {
        const r = createRingMenu(THREE); r.setItems(Array.from({ length: n }, (_, i) => 'x' + i), Array(n).fill(true), []);
        const seen = new Set();
        for (let deg = 0; deg < 360; deg += 1) for (let px = 0; px <= 256; px += 4) {
          const uv = { x: 0.5 + px / 512 * Math.sin(deg * Math.PI / 180), y: 0.5 + px / 512 * Math.cos(deg * Math.PI / 180) };
          const k = r.slotFromUv(uv);
          if (k !== null) { expect(r.inDisk(uv)).toBe(true); seen.add(k) }
          if (px <= 244) expect(r.inDisk(uv)).toBe(true); // up to the outer edge of the sectors (236 + the lit growth)
        }
        expect(seen.size).toBe(n); // every sector can be hit
        r.dispose();
      }
    } finally { delete globalThis.document; }
  });
});

describe('focus highlight is redrawn', () => {
  it('setHighlight redraws the texture only when the lit slot changes, for names and for swatches', async () => {
    const { createRingMenu } = await import('../../docs/vr-ring.js');
    const THREE = await import('three');
    let clears = 0, fills = [];
    const ctx = new Proxy({}, { get: (t, k) => (k === 'clearRect' ? () => { clears++ } : k in t ? t[k] : () => {}), set: (t, k, v) => { if (k === 'fillStyle') fills.push(v); t[k] = v; return true } });
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    try {
      const r = createRingMenu(THREE); r.setItems(['a', 'b', 'c', 'd', 'e', 'f'], Array(6).fill(true), []);
      const c0 = clears; fills = [];
      r.setHighlight(2); expect(clears).toBe(c0 + 1); expect(fills).toContain('#ffe27a'); // the lit sector is drawn bright yellow
      r.setHighlight(2); expect(clears).toBe(c0 + 1); // unchanged: no redraw
      r.setHighlight(null); expect(clears).toBe(c0 + 2);
      r.setItems([{ color: '#cc3333', name: 'red' }, { color: '#33cc33', name: 'green' }], [true, true], []);
      fills = []; r.setHighlight(1); expect(fills).toContain('rgba(255,255,255,.28)'); // the lit swatch is brightened
      r.dispose();
    } finally { delete globalThis.document; }
  });
});

describe('the quick / point ring are world-fixed and focus follows the laser (static check of vr-view.js)', () => {
  it('the ring is placed once on opening, and the owner laser sector sets the highlight', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toContain('const WHEEL_FRONT_M=0.20');
    const upd = src.slice(src.indexOf('const updateRings='), src.indexOf('const rates='));
    expect(upd).not.toContain('placeAt'); // nothing moves the rings every frame any more
    expect(src.slice(src.indexOf('const openWheel='), src.indexOf('const openWheel=') + 500)).toContain('wheel.placeAt');
    expect(upd).toContain('laserLit(c,bd?.wheel)'); expect(upd).toContain('laserLit(c,bd?.pwheel)');
  });
});

describe('flip-cut ring item, point mode default, ring distance (static check of vr-view.js)', () => {
  it('the catalog has section-flip and the default ring includes it', () => {
    expect(WHEEL_ITEMS.find(i => i.id === 'section-flip')).toMatchObject({ ja: '切り口反転', en: 'Flip cut' });
    expect(DEFAULT_WHEEL).toContain('section-flip');
    expect(normalizeWheelItems(['section-flip', null, null, null, null, null])[0]).toBe('section-flip');
  });
  it('point mode defaults to surface; the flip item shares the section-tab action and needs a one-side cut plane', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toContain("let vrPointMode='surface'");
    expect(src).toContain("case'section-flip':return canFlipPlane(section.selected)");
    expect(src).toContain("case'section-flip':flipPlane(section.selected);break");
    expect(src).toContain('L.flip,false,()=>flipPlane(pl)');
    expect(src).toContain('const flipPlane=pl=>{if(canFlipPlane(pl)){pl.side=-pl.side;pl.aFlash=performance.now()+ARROW_FLASH_MS}}'); // the flip also shows the arrow for a moment
  });
});

describe('migrateWheelSectionFlip (one-time)', () => {
  it('fills the first empty slot of a saved layout', () => {
    const r = migrateWheelSectionFlip({ wheel: ['home', null, 'undo', null, null, 'menu'] });
    expect(r.wheel).toEqual(['home', 'section-flip', 'undo', null, null, 'menu']);
    expect(r.wheelMig).toBe(1);
    expect(r.changed).toBe(true);
  });
  it('leaves a full layout unchanged but records the migration', () => {
    const full = ['home', 'undo', 'menu', 'screenshot', 'section-toggle', 'section-add'];
    const r = migrateWheelSectionFlip({ wheel: full });
    expect(r.wheel).toEqual(full);
    expect(r.wheelMig).toBe(1);
  });
  it('does nothing when section-flip is already present', () => {
    const w = ['home', null, 'section-flip', null, null, null];
    expect(migrateWheelSectionFlip({ wheel: w }).wheel).toEqual(w);
  });
  it('does not re-add it after the user removed it', () => {
    const r1 = migrateWheelSectionFlip({ wheel: ['home', null, null, null, null, null] });
    const removed = clearWheelItem(r1.wheel, r1.wheel.indexOf('section-flip'));
    const r2 = migrateWheelSectionFlip({ wheel: removed, wheelMig: r1.wheelMig });
    expect(r2.wheel).toEqual(removed);
    expect(r2.wheel).not.toContain('section-flip');
    expect(r2.changed).toBe(false);
  });
  it('a full layout is not filled later either (flag already set)', () => {
    const r = migrateWheelSectionFlip({ wheel: ['home', null, null, null, null, null], wheelMig: 1 });
    expect(r.wheel).not.toContain('section-flip');
  });
});

describe('an earlier change: the region / child ring with 4 items is a 2 x 2 board (quad), the other rings are unchanged', () => {
  const R = 0.055, at = (x, y, n, q) => wheelSlotFromLocal(x * R, y * R, n, R, q);
  it('upper left / upper right / lower left / lower right = items 0 / 1 / 2 / 3 (the region on top, the child below; 色 left, 表示 right)', () => {
    expect(at(-0.8, 0.8, 4, true)).toBe(0); expect(at(0.8, 0.8, 4, true)).toBe(1); expect(at(-0.8, -0.8, 4, true)).toBe(2); expect(at(0.8, -0.8, 4, true)).toBe(3);
    expect(wheelSlotFromAngle(315, 4, [true, true, true, true], null, { quad: true })).toBe(0); expect(wheelSlotFromAngle(45, 4, [true, true, true, true], null, { quad: true })).toBe(1);
    expect(wheelSlotFromAngle(225, 4, [true, true, true, true], null, { quad: true })).toBe(2); expect(wheelSlotFromAngle(135, 4, [true, true, true, true], null, { quad: true })).toBe(3);
  });
  it('without quad the 4-item layout is the old one (top / right / bottom / left)', () => {
    expect(at(0, 1, 4)).toBe(0); expect(at(1, 0, 4)).toBe(1); expect(at(0, -1, 4)).toBe(2); expect(at(-1, 0, 4)).toBe(3);
  });
  it('the drawing and the laser pick of the ring board both use the same angles (quad set by setItems; the ring passes it only for 4 items)', () => {
    const r = readFileSync(new URL('../../docs/vr-ring.js', import.meta.url), 'utf8'), v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(r).toContain('ang=wheelAngles(n,quad),half=n?180/n:180;'); expect(r).toContain('ang=wheelAngles(n,quad),half=180/n;');
    expect(r).toContain('setItems(l,e,o,q){labels=l;enabled=e;on=o||[];quad=!!q;draw()}');
    expect(v).toContain('items.map(i=>i.on),items.length===3||items.length===4||items.length===6);pointWheel.setCentre(pw.name)');
    expect(v).toContain("pointWheel.setItems(ids.map(k=>lab[k]),ids.map(()=>true),[]);"); // the point ring: no quad
  });
});
