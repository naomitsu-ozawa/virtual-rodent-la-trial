// the long-press progress ring at the laser's tip (thumbstick click hold = frames toggle). vr-view.js is not runnable here: wiring is checked on its source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHoldTracker, ringDrawCount, createHoldRing, HOLD_RING_SEGMENTS } from '../../docs/vr-hold-ring.js';
import { createButtonPress } from '../../docs/vr-ring.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const MS = +/const FRAME_HIDE_MS=(\d+)/.exec(src)[1];

describe('createHoldTracker (the ring fill)', () => {
  const trace = (downMs, step = 10, showMs = 80) => {
    const t = createHoldTracker({ longMs: MS, showMs }), out = []; let now = 0;
    for (; now < downMs; now += step) out.push([now, t.update(true, now)]);
    out.push([now, t.update(false, now)]);
    return out;
  };
  it('not shown at first (a short click flashes nothing), then fills with elapsed / longMs', () => {
    const o = trace(MS - 10);
    expect(o.filter(([ms, f]) => ms < 80 && f !== null)).toEqual([]);
    const shown = o.filter(([, f]) => f !== null);
    expect(shown.length).toBeGreaterThan(0);
    for (const [ms, f] of shown) expect(f).toBeCloseTo(ms / MS, 6);
    expect(shown.map(([, f]) => f)).toEqual([...shown.map(([, f]) => f)].sort((a, b) => a - b)); // only ever grows
  });
  it('reaches (almost) full just before the hold time, and is gone at the hold time and after (the toggle fires there)', () => {
    const t = createHoldTracker({ longMs: MS, showMs: 80 });
    t.update(true, 0);
    expect(t.update(true, MS - 1)).toBeCloseTo((MS - 1) / MS, 6);
    expect(t.update(true, MS)).toBeNull();
    expect(t.update(true, MS + 500)).toBeNull();
  });
  it('released early: the ring is gone at once, and the next press starts from 0 again', () => {
    const t = createHoldTracker({ longMs: MS, showMs: 80 });
    t.update(true, 0); expect(t.update(true, 200)).toBeCloseTo(200 / MS, 6);
    expect(t.update(false, 210)).toBeNull();
    expect(t.update(true, 1000)).toBeNull(); expect(t.update(true, 1100)).toBeCloseTo(100 / MS, 6);
  });
  it('the ring time is the real hold time (same constant as the toggle): its last fill is just under 100 %', () => {
    expect(MS).toBe(300);
    const t = createHoldTracker({ longMs: MS }); let last = null;
    for (let ms = 0; ms < MS + 100; ms += 5) { const f = t.update(true, ms); if (f !== null) last = f; }
    expect(last).toBeGreaterThan(0.95); expect(last).toBeLessThan(1);
  });
});

describe('the toggle with the hold ring: hold on, hold off, early release does nothing', () => {
  // the same wiring as the controller loop: createButtonPress ('long' toggles the frames), createHoldTracker (the ring)
  const run = downs => {
    const bp = createButtonPress({ longMs: MS }), tr = createHoldTracker({ longMs: MS, showMs: 80 }); let hidden = false, t = 1000, ringMax = 0; const events = [];
    const frame = p => { const ev = bp.update(p, t), f = tr.update(p, t); if (ev === 'long') { hidden = !hidden; events.push(hidden ? 'on' : 'off'); } else if (ev === 'short') events.push('slice'); if (f !== null) ringMax = Math.max(ringMax, f); t += 10; };
    const maxes = [];
    for (const d of downs) { ringMax = 0; for (let ms = 0; ms < d; ms += 10) frame(true); frame(false); frame(false); maxes.push(ringMax); }
    return { events, hidden, maxes };
  };
  it('hold = on, hold again = off', () => { expect(run([700]).events).toEqual(['on']); expect(run([700, 700]).events).toEqual(['on', 'off']); expect(run([700, 700, 700]).hidden).toBe(true); });
  it('an early release (0.2 s) does not toggle the frames (the existing short click toggles the slice only); the ring got part-way and is gone', () => {
    const r = run([200]);
    expect(r.events).toEqual(['slice']); expect(r.hidden).toBe(false);
    expect(r.maxes[0]).toBeGreaterThan(0.3); expect(r.maxes[0]).toBeLessThan(0.7);
  });
  it('a click under the show delay shows no ring at all', () => { expect(run([50]).maxes[0]).toBe(0); });
});

describe('ringDrawCount', () => {
  it('0..1 maps to 1..all segments (6 indices each), never beyond', () => {
    expect(ringDrawCount(0)).toBe(6);
    expect(ringDrawCount(0.5)).toBe(HOLD_RING_SEGMENTS / 2 * 6);
    expect(ringDrawCount(1)).toBe(HOLD_RING_SEGMENTS * 6);
    expect(ringDrawCount(7)).toBe(HOLD_RING_SEGMENTS * 6);
  });
  it('is monotonic', () => { let p = 0; for (let i = 0; i <= 100; i++) { const c = ringDrawCount(i / 100); expect(c).toBeGreaterThanOrEqual(p); p = c; } });
});

describe('createHoldRing (drawing, with a minimal THREE stub)', () => {
  const V = () => ({ x: 0, y: 0, z: 0, copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; } });
  const THREE = {
    RingGeometry: class { constructor(...a) { this.args = a; this.range = null; } setDrawRange(s, c) { this.range = [s, c]; } },
    MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); this.color = { hex: null, setHex(h) { this.hex = h; } }; } },
    Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
    Group: class { constructor() { this.children = []; this.position = V(); this.scale = { setScalar: s => { this.s = s; } }; this.visible = true; } add(...c) { this.children.push(...c); } },
  };
  it('the fill mesh draws part of the ring in the laser colour, the track stays full; hide() hides the group', () => {
    const r = createHoldRing(THREE); expect(r.group.visible).toBe(false);
    r.show(0.5, 0x7c6cff, { x: 1, y: 2, z: 3, }, 0.04);
    const [track, fill] = r.group.children;
    expect(r.group.visible).toBe(true); expect(r.group.position).toMatchObject({ x: 1, y: 2, z: 3 }); expect(r.group.s).toBe(0.04);
    expect(fill.geometry.range).toEqual([0, HOLD_RING_SEGMENTS / 2 * 6]); expect(track.geometry.range).toBeNull();
    expect(fill.material.color.hex).toBe(0x7c6cff); expect(track.material.color.hex).toBe(0x7c6cff);
    expect(fill.geometry.args[3]).toBe(1); expect(fill.geometry.args[4]).toBeCloseTo(Math.PI / 2); expect(fill.geometry.args[5]).toBeCloseTo(-Math.PI * 2); // clockwise from the top, a full turn
    r.hide(); expect(r.group.visible).toBe(false);
  });
});

describe('wiring in vr-view.js', () => {
  it('imports the ring, one per controller, with the thumbstick hold tracker on the same hold time', () => {
    expect(src).toContain("from './vr-hold-ring.js?v=");
    expect(src).toContain('c.userData.holdRing=hr;');
    expect(src).toContain('createHoldTracker({longMs:FRAME_HIDE_MS,showMs:HOLD_RING_SHOW_MS})');
  });
  it("the ring takes the hand's laser colour (laserColorOf via hc), sits on the cursor dot when the laser hits something, else at the default laser tip (0.6 m)", () => {
    expect(src).toContain('const hc=laserColorOf(c),dot=c.userData.dot;');
    expect(src).toContain('if(dist!=null)tmpHr.copy(dot.position);else{tmpHr.set(0,0,-0.6);c.localToWorld(tmpHr)}hrg.show(hf,hc,tmpHr,');
    expect(src).toContain('else{ray.scale.z=0.6;ray.material.opacity=0.6}'); // the default laser length the tip above is on
  });
  it('the ring is hidden when not holding, and reset when an input goes away', () => {
    expect(src).toContain('if(hf===null)hrg.hide();else{');
    expect(src).toContain('c.userData.tcHold?.reset();c.userData.holdRing?.hide();');
  });
});
