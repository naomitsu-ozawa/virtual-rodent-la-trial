import { describe, it, expect } from 'vitest';
import { horizAngleDeg, createOrient, ORIENT_PHASES, LOOK_DEG, LOOK_DWELL_MS, SAY_MAX_MS } from '../../docs/tutorial-orient.js';
import { TUT_ORIENT } from '../../docs/tutorial-data.js';
import { HELP_OFFSET, MENU_OFFSET } from '../../docs/vr-layout.js';
import { I18N } from '../../docs/i18n.js';

describe('horizAngleDeg', () => {
  it('0 straight at the board, 90 at right angles, 180 behind; null without a horizontal extent', () => {
    expect(horizAngleDeg(0, -1, 0, -2)).toBeCloseTo(0, 6);
    expect(horizAngleDeg(0, -1, 1, 0)).toBeCloseTo(90, 6);
    expect(horizAngleDeg(0, -1, 0, 3)).toBeCloseTo(180, 6);
    expect(horizAngleDeg(0, -1, Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3))).toBeCloseTo(60, 6); // a board 60 deg out, the head looking straight
    expect(horizAngleDeg(0, 0, 1, 1)).toBeNull(); expect(horizAngleDeg(1, 0, 0, 0)).toBeNull();
  });
});
describe('the phases match the real layout: right = the help board, left = the menu', () => {
  it('order right then left; the boards named are the help board (right of the head) and the menu (left)', () => {
    expect(ORIENT_PHASES).toEqual(['right', 'left']);
    expect(TUT_ORIENT.right.board).toBe('help'); expect(TUT_ORIENT.left.board).toBe('menu');
    expect(HELP_OFFSET.left).toBeLessThan(0); // negative = to the head's right (vr-layout.js)
    expect(MENU_OFFSET.left).toBeGreaterThan(0);
    expect(I18N.ja.tutOrientRight).toMatch(/^右.*操作パネル/); expect(I18N.ja.tutOrientLeft).toMatch(/^左.*メニュー/);
    expect(TUT_ORIENT.right.audioText).toMatch(/^みぎ/); expect(TUT_ORIENT.left.audioText).toMatch(/^ひだり/);
    for (const it of Object.values(TUT_ORIENT)) for (const l of ['ja', 'en']) expect(I18N[l][it.text]).toBeTruthy();
  });
  it('a board 60 deg out is found by turning the head 30 deg or more toward it, not before', () => {
    expect(LOOK_DEG).toBe(30); const board = 60; // deg from straight ahead
    const ang = head => Math.abs(board - head);
    expect(ang(0)).toBeGreaterThan(LOOK_DEG); expect(ang(29)).toBeGreaterThan(LOOK_DEG); expect(ang(30)).toBeLessThanOrEqual(LOOK_DEG);
  });
});
describe('createOrient', () => {
  const run = (o = {}) => { const log = []; const or = createOrient({ onChange: () => log.push(or.phase), ...o }); return { or, log }; };
  it('idle until started; start = right', () => {
    const { or, log } = run(); expect(or.active).toBe(false); expect(or.phase).toBeNull(); expect(or.done).toBe(false);
    or.start(0); expect(or.phase).toBe('right'); expect(or.active).toBe(true); expect(log).toEqual(['right']);
  });
  it('turning toward the board for the dwell time (voice done) moves on; a glance, the wrong side or an unknown angle does not', () => {
    const { or } = run(); or.start(0);
    expect(or.update(100, { right: 10, left: 170 }, true)).toBe(false); // looking: starts the dwell
    expect(or.update(100 + LOOK_DWELL_MS - 1, { right: 10 }, true)).toBe(false);
    expect(or.update(100 + LOOK_DWELL_MS, { right: 10 }, true)).toBe(true); expect(or.phase).toBe('left');
    expect(or.update(2000, { right: 5, left: 100 }, true)).toBe(false); // the right board is no longer the one
    expect(or.update(2100, { left: null }, true)).toBe(false);
    expect(or.update(2200, { left: 20 }, true)).toBe(false); expect(or.update(2200 + 100, { left: 80 }, true)).toBe(false); // looked away: the dwell restarts
    expect(or.update(3000, { left: 20 }, true)).toBe(false); expect(or.update(3000 + LOOK_DWELL_MS, { left: 20 }, true)).toBe(true);
    expect(or.done).toBe(true); expect(or.active).toBe(false); expect(or.phase).toBeNull();
  });
  it('the voice is not cut off: looking counts only after the clip ended (or SAY_MAX_MS)', () => {
    const { or } = run(); or.start(0);
    expect(or.update(1000, { right: 0 }, false)).toBe(false); expect(or.update(1000 + LOOK_DWELL_MS + 100, { right: 0 }, false)).toBe(false); // still speaking
    expect(or.update(2000, { right: 0 }, true)).toBe(false); expect(or.update(2000 + LOOK_DWELL_MS, { right: 0 }, true)).toBe(true); // clip ended: dwell then go
    const b = run(); b.or.start(0);
    expect(b.or.update(SAY_MAX_MS, { right: 0 }, false)).toBe(false); expect(b.or.update(SAY_MAX_MS + LOOK_DWELL_MS, { right: 0 }, false)).toBe(true); // the time limit stands in for the voice
  });
  it('次へ ends the running phase at once (both phases), then nothing is left to press', () => {
    const { or, log } = run(); or.start(0);
    expect(or.next(5)).toBe(true); expect(or.phase).toBe('left'); expect(or.next(6)).toBe(true); expect(or.done).toBe(true); expect(or.next(7)).toBe(false);
    expect(log).toEqual(['right', 'left', null]); expect(or.update(8, { left: 0 }, true)).toBe(false);
  });
});
