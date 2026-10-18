import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// build 468 (stage 2): the section handling of vr-view.js (a WebXR file, not run in node) is checked on its source
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

describe('vr-view.js: sections are no longer grabbed (one-handed redesign, stage 2)', () => {
  it('the invisible plane board, the 20 cm proximity grab and the guide lines are gone', () => {
    for (const w of ['rayPlane', 'nearestPlane', 'planeDist', 'heldPlanes', 'takePlane', 'fixPlane', 'fixAll', 'userData.guide', 'userData.target', 'heldPlane', 'pl.hit', 'PlaneGeometry(2*h,2*h)']) {
      expect(src.includes(w), w).toBe(false);
    }
  });
  it('the 持ち方 setting is gone', () => {
    for (const w of ['secHold', 'L.hold', 'holdModes', 'helpHold']) expect(src.includes(w), w).toBe(false);
  });
  it('the old trigger resolution and the record button are gone', () => {
    for (const w of ['resolveTriggerMode', 'resolveTrigger(', 'recordPoint(null)', 'L.ptRec', 'L.ptNeed']) expect(src.includes(w), w).toBe(false);
  });
  it('the grip handler only moves the volume', () => {
    const a = src.indexOf("addEventListener('squeezestart'"), b = src.indexOf("addEventListener('selectstart'");
    const grip = src.slice(a, b);
    expect(grip).toContain('grabbing.add(c)');
    expect(grip).not.toMatch(/plane|Plane/);
  });
  it('the trigger uses the pure functions of vr-point.js', () => {
    for (const w of ['resolveTriggerTarget(', 'createTriggerPress()', 'dragShouldStart(', 'sectionFollowStart(', 'sectionFollowStep(', 'snapPlaneCenterIntoBox(', 'chooseSectionForRay(', 'DRAG_RECORD', 'createHoverPulse(', 'only:idx']) expect(src.includes(w), w).toBe(true);
  });
});

describe('vr-view.js: ring menus, undo and the removed left-hand panel (stage 3)', () => {
  it('the left-hand panel and the menu tag as a laser target are gone; the cue stays as a plain plane', () => {
    for (const w of ['panelHit', 'panel.onDraw', 'panelKey', 'badgeHit', 'bd.badge', 'bd.panel', 'makeMenu(640', 'undoDelete', 'vpDeleted']) expect(src.includes(w), w).toBe(false);
    expect(src).toContain("c.add(badge)");
    expect(src).toContain('X：よく使う／長押し：メニュー');
    expect(src).toContain('X: quick / hold: menu');
  });
  it('the 位置 tab no longer has the mode switch or the record button', () => {
    expect(src.includes('L.ptMode,')).toBe(false);
    expect(src.includes('L.ptRec')).toBe(false);
  });
  it('the ring items are saved in the settings with a fallback to the defaults', () => {
    expect(src).toContain('wheel:[...DEFAULT_WHEEL]');
    expect(src).toContain('v.wheel=normalizeWheelItems(v.wheel)');
    expect(src).toContain('saveSettings(settings)');
  });
  it('A/X goes through createButtonPress (short = ring, long = menu)', () => {
    expect(src).toContain('createButtonPress()');
    expect(src).toContain('onAxShort(c)');
    expect(src).toContain('onAxLong(c)');
  });
  it('the point comment is behind a localStorage flag that is off by default', () => {
    expect(src).toMatch(/VR_POINT_COMMENT=\(\(\)=>\{try\{return localStorage\.getItem\('vrl-vr-point-comment'\)==='1'\}catch\{return false\}\}\)\(\)/);
  });
  it('record, delete and move are put on the undo stack', () => {
    for (const w of ["undo.push({type:'add'", "undo.push({type:'delete'", "undo.push({type:'move'", 'createUndoStack()']) expect(src.includes(w), w).toBe(true);
  });
});

describe('vr-view.js: review fixes (F1-F9)', () => {
  it('F2: endAllDrags keeps presses for record / label / point / move', () => {
    const a = src.indexOf('const endAllDrags='), line = src.slice(a, src.indexOf('\n', a));
    expect(line).toContain('pr.dragPl=null');
    expect(line).toContain('snapSection(');
    expect(line).not.toContain('press=null');
  });
  it('F1: no vibration when a drag starts from empty space', () => { expect(src.includes('HAPTIC.dragStart')).toBe(false); });
  it('F3: disconnect closes the rings and clears the move', () => {
    const a = src.indexOf("addEventListener('disconnected'"), blk = src.slice(a, a + 400);
    expect(blk).toContain('endDrag(c)'); // a drag cut by tracking loss still snaps the section back into the box
    for (const w of ['closeWheel()', 'closePointWheel()', 'moving=null', 'axPress?.reset()', 'stickLock=false']) expect(blk.includes(w), w).toBe(true);
  });
  it('F6: a move to the same place pushes no undo', () => { expect(src).toContain('the same place: nothing to undo'); });
  it('F7 / F8: the selected point is checked, a stale drag ends at the press', () => {
    expect(src).toContain("getComments().some(x=>x.id===pr.res.ref.id))selectPoint");
    expect(src).toMatch(/addEventListener\('selectstart',\(\)=>\{\s*endDrag\(c\);/);
  });
});

describe('vr-view.js: section drag restored, one cursor (build 470)', () => {
  it('the section is not clamped while dragging and snaps back into the box on release', () => {
    const a = src.indexOf('const updatePress='), b = src.indexOf('const sectionForEmpty=');
    expect(src.slice(a, b)).not.toContain('clampPlaneCenter');
    const e = src.indexOf('const endDrag='), line = src.slice(e, src.indexOf('\n', e));
    expect(line).toContain('snapSection(dg.pl)');
  });
  it('no jump to the perpendicular foot at the start of a drag', () => {
    const a = src.indexOf('const startDrag='), blk = src.slice(a, src.indexOf('const updatePress='));
    expect(blk).not.toContain('outside'); expect(blk).not.toContain('planeFoot'); expect(blk).toContain('sectionFollowStart(');
  });
  it('a section-mode tap point drags only after the higher threshold; empty space moves the section the laser passes through', () => {
    expect(src).toContain('pr.dragRec?DRAG_RECORD:undefined');
    expect(src).toContain('sectionForEmpty(c,');
  });
  it('the square cursor is gone: placeSecCursor uses the dot of the surface cursor', () => {
    expect(src.includes('createSectionCursor')).toBe(false); expect(src.includes('secCursors')).toBe(false);
    const a = src.indexOf('const placeSecCursor='), blk = src.slice(a, a + 300);
    expect(blk).toContain('surfCursors[');
  });
});
