import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { volumeGripAllowed, pressDragSection, resolveTriggerTarget } from '../../docs/vr-point.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const sliceBetween = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); expect(i, a).toBeGreaterThanOrEqual(0); expect(j, b).toBeGreaterThan(i); return src.slice(i, j); };

describe('grip: the volume is taken only with the laser on it (volumeGripAllowed)', () => {
  it('needs a volume hit and a laser', () => {
    expect(volumeGripAllowed({ rayOn: true, hit: { distance: 0.4 } })).toBe(true);
    expect(volumeGripAllowed({ rayOn: true, hit: null })).toBe(false);
    expect(volumeGripAllowed({ rayOn: false, hit: { distance: 0.4 } })).toBe(false);
    expect(volumeGripAllowed({})).toBe(false);
  });
  it('simulation: only the hand whose laser is on the volume takes part; the other grip is ignored; the hold survives the laser leaving', () => {
    const grabbing = new Set();
    const gripDown = (hand, hit) => { if (volumeGripAllowed({ rayOn: true, hit })) grabbing.add(hand); }; // the body of gripStart (volume branch)
    gripDown('L', null); gripDown('R', { distance: 0.5 });
    expect([...grabbing]).toEqual(['R']); // one-hand grab, no two-hand scale from the hand that missed
    // the laser leaves the volume: nothing asks again, the grab stays until the release
    const laserHit = null; void laserHit;
    expect([...grabbing]).toEqual(['R']);
    grabbing.delete('R'); // gripEnd
    expect(grabbing.size).toBe(0);
    gripDown('L', { distance: 0.4 }); gripDown('R', { distance: 0.5 });
    expect(grabbing.size).toBe(2); // both on the volume: two-hand scale / turn as before
  });
  it('vr-view.js: the volume branch of gripStart asks gripOnVolume once; nothing asks it again while held', () => {
    const gs = sliceBetween('const gripStart=c=>{', 'const gripEnd=c=>{');
    expect(gs).toContain('if(!gripOnVolume(c))return false;');
    expect(gs.indexOf('if(!gripOnVolume(c))return false;')).toBeLessThan(gs.indexOf('grabbing.add(c);regrab();'));
    expect(gs.indexOf('boardHits(c).hu')).toBeLessThan(gs.indexOf('gripOnVolume(c)')); // the boards are still grabbed first, as before
    expect(src.match(/gripOnVolume\(c\)/g)).toHaveLength(1); // the definition is `const gripOnVolume=c=>`; one call site
    // the frame loop never adds to / removes from the grab set by the laser
    const loop = src.slice(src.indexOf('const fHide=framesHidden();'));
    expect(loop).not.toContain('grabbing.add');
    expect(loop).not.toContain('grabbing.delete');
    // the same hit as the laser's end dot: this hand's volHit of the last frame (re-asked only when the loop did not march it)
    const g = sliceBetween('const gripOnVolume=c=>{', '\n');
    expect(g).toContain('handIn.rayOn(c)'); expect(g).toContain('u.vhFrame===frameNo?u.volHit:volumeHit(c)');
  });
  it('a hand whose fist found no laser hit is refused (it must open the fist first), a hit is accepted', () => {
    expect(src).toContain('grab:(c,t)=>{if(t){gripStartNear(c,t);return true}if(c.userData.wristOn)return false;return gripStart(c)!==false}');
  });
  it('a fist that touches the volume (palm in the box, hands only, no laser) is not changed', () => {
    const st = sliceBetween('const gripStartNear=(c,t)=>{', '// ===== ring menus');
    expect(st).toContain("case'volume':grabbing.add(c);regrab();return;");
  });
});

describe('trigger: a section is taken only with the laser on it (pressDragSection)', () => {
  const pl = { id: 'p1' }, sel = { id: 'sel' };
  it('a frame band / tag / the inside of the frame (kind section = the white glow) takes that section', () => {
    expect(pressDragSection({ kind: 'section', ref: { pl, t: 1 } })).toEqual({ pl, rec: false });
    expect(pressDragSection({ kind: 'section', ref: { pl, glass: true } }, { recordOk: true, selected: sel })).toEqual({ pl, rec: false });
  });
  it('the selected section under the laser (a point would be recorded there) is dragged with the higher threshold', () => {
    expect(pressDragSection({ kind: 'record', ref: { plane: true } }, { recordOk: true, selected: sel })).toEqual({ pl: sel, rec: true });
    expect(pressDragSection({ kind: 'record', ref: { plane: true } }, { recordOk: false, selected: sel })).toBe(null); // surface mode / label mode
    expect(pressDragSection({ kind: 'record', ref: { plane: true } }, { recordOk: true, selected: null })).toBe(null);
  });
  it('empty space, tissue, nothing, a point, a board: no section', () => {
    for (const kind of ['empty', 'none', 'tissue', 'point', 'mlabel', 'label', 'board', 'move']) expect(pressDragSection({ kind, ref: { pl } }, { recordOk: true, selected: sel }), kind).toBe(null);
    expect(pressDragSection(null)).toBe(null); expect(pressDragSection(undefined)).toBe(null);
  });
  it('the lit frame and the grab use one rule: whatever resolveTriggerTarget calls "section" is what the glow lights and what the press takes', () => {
    const band = { t: 0.5, pl };
    const hit = resolveTriggerTarget({ band, canDrag: true }), miss = resolveTriggerTarget({ canDrag: true });
    expect(hit.kind).toBe('section'); expect(pressDragSection(hit)?.pl).toBe(pl);
    expect(miss.kind).toBe('empty'); expect(pressDragSection(miss, { recordOk: true, selected: sel })).toBe(null);
    const glass = resolveTriggerTarget({ glass: { t: 0.6, pl }, canDrag: true });
    expect(glass.kind).toBe('section'); expect(pressDragSection(glass)?.pl).toBe(pl);
  });
  it('vr-view.js: the press asks pressDragSection once; the glow uses the same res.kind; the old empty-space pick is gone; a started drag is not re-picked', () => {
    expect(src).not.toContain('sectionForEmpty');
    expect(src).toContain("const pd=pressDragSection(res,{recordOk:!surfaceActive()&&!labelMode(),selected:section.selected});");
    expect(src.match(/pressDragSection\(/g)).toHaveLength(1); // the call (the import is `pressDragSection,`)
    expect(src).toContain('pl=glowPl(rr)||'); // the white glow: kind 'section', and a record on the selected plane
    const up = sliceBetween('const startDrag=(c,pr,hp)=>{', 'const updatePress=');
    expect(up).not.toContain('pressDragSection'); // the laser is not asked again after the press: the drag record keeps the section until the release
  });
});
