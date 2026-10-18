import { describe, it, expect } from 'vitest';
import { VIEW_TOGGLE_ID, VIEW_TOGGLE_BUTTON, VIEW_TOGGLE_DOUBLE_MS, SECTION_DELETE_ID, createViewToggle, createDoublePress, ringIdsFor } from '../../docs/vr-view-toggle.js';
import { WHEEL_IDS, DEFAULT_WHEEL } from '../../docs/vr-ring.js';
import { I18N } from '../../docs/i18n.js';

describe('createViewToggle', () => {
  it('AR session starts as passthrough and flips each toggle', () => {
    const t = createViewToggle(true);
    expect(t.canToggle).toBe(true); expect(t.vrView).toBe(false); expect(t.passthrough).toBe(true);
    expect(t.toggle()).toBe(true); expect(t.vrView).toBe(true); expect(t.passthrough).toBe(false);
    expect(t.toggle()).toBe(false); expect(t.passthrough).toBe(true);
  });
  it('a new AR session is back to passthrough (state is per session)', () => {
    const a = createViewToggle(true); a.toggle();
    expect(createViewToggle(true).vrView).toBe(false);
    a.reset(); expect(a.vrView).toBe(false);
  });
  it('a VR session never toggles and is never passthrough', () => {
    const t = createViewToggle(false);
    expect(t.canToggle).toBe(false); expect(t.toggle()).toBe(false); expect(t.vrView).toBe(false); expect(t.passthrough).toBe(false);
  });
});

describe('ringIdsFor', () => {
  it('VR: 断面を削除 is the only extra (a copy; the saved layout is not changed)', () => {
    const ids = [...DEFAULT_WHEEL];
    const r = ringIdsFor(ids, false); expect(r).toEqual([...DEFAULT_WHEEL, SECTION_DELETE_ID]); expect(r).not.toBe(ids); expect(ids).toEqual(DEFAULT_WHEEL);
  });
  it('AR with a full ring: the toggle keeps its 7th slot (as before build 521), 断面を削除 is the 8th; the saved array is not changed', () => {
    const ids = [...DEFAULT_WHEEL], r = ringIdsFor(ids, true);
    expect(r).toEqual([...DEFAULT_WHEEL, VIEW_TOGGLE_ID, SECTION_DELETE_ID]); expect(ids).toEqual(DEFAULT_WHEEL);
    expect(r.indexOf(VIEW_TOGGLE_ID)).toBe(DEFAULT_WHEEL.length);
  });
  it('AR with empty slots: the toggle takes the first, 断面を削除 the next', () => {
    const ids = ['home', null, 'undo', null, null, null];
    expect(ringIdsFor(ids, true)).toEqual(['home', VIEW_TOGGLE_ID, 'undo', SECTION_DELETE_ID, null, null]);
  });
  it('VR with one empty slot: 断面を削除 fills it (no 7th slot)', () => {
    expect(ringIdsFor(['home', 'undo', null, 'menu', 'screenshot', 'section-add'], false)).toEqual(['home', 'undo', SECTION_DELETE_ID, 'menu', 'screenshot', 'section-add']);
  });
  it('AR with exactly one empty slot: the toggle takes it, 断面を削除 is appended (both coexist)', () => {
    expect(ringIdsFor(['home', 'undo', null, 'menu', 'screenshot', 'section-add'], true)).toEqual(['home', 'undo', VIEW_TOGGLE_ID, 'menu', 'screenshot', 'section-add', SECTION_DELETE_ID]);
  });
  it('never twice; bad input still gives the extras only', () => {
    expect(ringIdsFor(['home', VIEW_TOGGLE_ID, SECTION_DELETE_ID], true)).toEqual(['home', VIEW_TOGGLE_ID, SECTION_DELETE_ID]);
    expect(ringIdsFor(['home', VIEW_TOGGLE_ID], true)).toEqual(['home', VIEW_TOGGLE_ID, SECTION_DELETE_ID]);
    expect(ringIdsFor(null, false)).toEqual([SECTION_DELETE_ID]);
    expect(ringIdsFor(null, true)).toEqual([VIEW_TOGGLE_ID, SECTION_DELETE_ID]);
  });
  it('the extra ids are not saved wheel item ids (never stored in the ring settings)', () => { expect(WHEEL_IDS).not.toContain(VIEW_TOGGLE_ID); expect(WHEEL_IDS).not.toContain(SECTION_DELETE_ID); });
});

describe('createDoublePress', () => {
  const press = (d, t) => { const a = d.update(true, t); d.update(false, t + 40); return a; };
  it('single press: nothing', () => { const d = createDoublePress(); expect(press(d, 1000)).toBe(false); });
  it('two presses within 350 ms fire on the second press edge', () => {
    const d = createDoublePress();
    expect(press(d, 1000)).toBe(false); expect(press(d, 1250)).toBe(true);
  });
  it('exactly the window counts, one ms over does not', () => {
    const d = createDoublePress(); press(d, 0); expect(press(d, VIEW_TOGGLE_DOUBLE_MS)).toBe(true);
    const e = createDoublePress(); press(e, 0); expect(press(e, VIEW_TOGGLE_DOUBLE_MS + 1)).toBe(false);
  });
  it('a slow second press becomes the first press of a new pair', () => {
    const d = createDoublePress(); press(d, 0); expect(press(d, 1000)).toBe(false); expect(press(d, 1200)).toBe(true);
  });
  it('holding a button does not repeat; a third quick press is not another double', () => {
    const d = createDoublePress();
    expect(d.update(true, 0)).toBe(false); expect(d.update(true, 16)).toBe(false); expect(d.update(true, 600)).toBe(false); d.update(false, 620);
    const e = createDoublePress(); press(e, 0); expect(press(e, 100)).toBe(true); expect(press(e, 200)).toBe(false); expect(press(e, 300)).toBe(true);
  });
  it('reset forgets the first press', () => {
    const d = createDoublePress(); press(d, 0); d.reset(); expect(press(d, 100)).toBe(false);
  });
  it('uses the thumbstick click (button 3), not A/X (4) or B/Y (5)', () => { expect(VIEW_TOGGLE_BUTTON).toBe(3); });
});

describe('i18n strings', () => {
  it('ja and en both have the toggle texts', () => {
    for (const k of ['vrToggleToVr', 'vrToggleToAr', 'vrToggleNowVr', 'vrToggleNowAr']) { expect(I18N.ja[k]).toBeTruthy(); expect(I18N.en[k]).toBeTruthy(); }
  });
});
