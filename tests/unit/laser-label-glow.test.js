import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { glowRid, createBoneGlow, boneHoverPickable, glowRegionOf } from '../../docs/analysis-label.js';

// Laser -> label glow (VR). Pure rule (glowRid) + a simulation of the vr-view.js frame block (same Set / per-hand logic) + checks that the source is wired as described.
const vr = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

// the frame block of vr-view.js, as a function of the hands (no allocation in the real code; here plain objects)
const frame = (hands, on = true) => {
  const set = new Set();
  for (const x of hands) {
    const g = glowRid(on, x.visible !== false, x.rid || 0, x.kind === 'mlabel' || !!(x.lblDrag && x.press) || !!x.ringOpen);
    if (g) set.add(g);
  }
  return set;
};

describe('glowRid: which result glows for one hand', () => {
  it('on a result: that result', () => expect(glowRid(true, true, 7, false)).toBe(7));
  it('empty space / a segment without a result / the menu or a board (no hit): none', () => expect(glowRid(true, true, 0, false)).toBe(0));
  it('label mode off: none', () => expect(glowRid(false, true, 7, false)).toBe(0));
  it('the laser is gone / the controller is lost (not visible): none', () => expect(glowRid(true, false, 7, false)).toBe(0));
  it('the laser is on (or holds) a label card, or this hand has its quick / point ring open: none', () => expect(glowRid(true, true, 7, true)).toBe(0));
});

describe('scenes (two hands, per frame)', () => {
  it('starts to glow when the laser hits, goes out when it leaves', () => {
    expect([...frame([{ rid: 3 }, {}])]).toEqual([3]);
    expect([...frame([{ rid: 0 }, {}])]).toEqual([]);
  });
  it('moving to another bone: only the new one glows', () => {
    expect([...frame([{ rid: 3 }, {}])]).toEqual([3]);
    expect([...frame([{ rid: 5 }, {}])]).toEqual([5]);
  });
  it('both hands on different bones: both glow; on the same bone: one entry', () => {
    expect([...frame([{ rid: 3 }, { rid: 5 }])].sort()).toEqual([3, 5]);
    expect([...frame([{ rid: 3 }, { rid: 3 }])]).toEqual([3]);
  });
  it('a hand that moves onto a menu (no hit) / onto a label card / holds a card: its glow is gone, the other hand keeps its own', () => {
    expect([...frame([{ rid: 0 }, { rid: 5 }])]).toEqual([5]);
    expect([...frame([{ rid: 3, kind: 'mlabel' }, { rid: 5 }])]).toEqual([5]);
    expect([...frame([{ rid: 3, lblDrag: {}, press: {} }, {}])]).toEqual([]);
    expect([...frame([{ rid: 3, ringOpen: true }, { rid: 5 }])]).toEqual([5]); // the hand whose quick / point ring is open
  });
  it('the laser is off / the controller is lost / label mode ends: nothing glows', () => {
    expect([...frame([{ rid: 3, visible: false }, { rid: 5, visible: false }])]).toEqual([]);
    expect([...frame([{ rid: 3 }, { rid: 5 }], false)]).toEqual([]);
  });
});

describe('vr-view.js wiring', () => {
  const block = vr.slice(vr.indexOf('pinGlow.clear();'), vr.indexOf('   {const occ=occlusionGpu();if(occ&&pins.size)'));
  it('the glow set is rebuilt every frame from each controller (a cleared Set: no stale state across frames)', () => {
    expect(block).toContain('pinGlow.clear();for(const x of controllers)');
    expect(block).toContain("blocked=rs?.kind==='mlabel'||(u.lblDrag&&u.press)||wheelOwner===x||pw?.c===x;for(const rid of u.hrids){const g=glowRid(on,x.visible!==false,rid,blocked)");
  });
  it('the cards: glow = not lit by the card rule, from the set; the face is the lit face (white outline), the card is the lit size, the leader gets the bone colour', () => {
    expect(vr).toContain('lb.glow=!pinLit.has(lb.rid)&&pinGlow.has(lb.rid)');
    expect(vr).toContain('drawLabel(lb,{id:idx,key:\'\'},false,pinLit.has(reg.id)||pinGlow.has(reg.id))');
    expect(vr).toContain('labelScale()*(lb.lit||lb.glow?LABEL_LIT_SCALE:1)');
    expect(vr).toMatch(/lineGlow=lb=>\{[^\n]*highlightColor\(\[lutColor\.r,lutColor\.g,lutColor\.b\],null,'on'\)/);
  });
  it('a glowing card is always shown: the depth / thin / cover rules treat it like a lit one (on top, kept, never covered, never thinned); a hidden RESULT (lb.hid) still has no card', () => {
    expect(vr).toContain('pinOcclusion(lb,lb.lit||lb.glow)');
    expect(vr).toContain('if(lb.lit||lb.glow)lb.thin=false;');
    expect(vr).toContain('if(cx&&mesh&&!lb.lit&&!lb.glow&&!lb.trans)');
    expect(vr).toContain('it.lit=lb.lit||lb.glow;');
    expect(vr).toContain('const k=labelScale()*(lb.lit||lb.glow?LABEL_LIT_SCALE:1),p=lb.m.position');
    expect(vr).toContain('if(lb.hid){lb.m.visible=false;lb.line.visible=false;return}');
    expect(vr).not.toContain('pinOcclusion(lb,lb.lit)');
    expect(block).not.toContain('pinLit.add(g');
  });
  it('the glow flag is set before the placement block of the same frame (no one-frame lag), and the lit set is not touched by it', () => {
    const i = vr.indexOf('lb.glow=!pinLit.has(lb.rid)&&pinGlow.has(lb.rid)');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(vr.indexOf('thinPins(occ);for(const lb of pins.values())pinOcclusion'));
  });
  it('the pinned-card laser rule (pinLit) is unchanged', () => {
    expect(block).toContain("if(r&&r.kind==='mlabel'&&r.ref?.pin)pinLit.add(r.ref.id)");
  });
});

// ---- PC (3D view): the mouse resting on a bone lights that result's card ----
const pc = readFileSync(new URL('../../docs/comment-3d.js', import.meta.url), 'utf8');
describe('boneHoverPickable: when a bone pick may run', () => {
  const ok = { touch: false, buttons: 0, onCanvas: true, overLabel: false, gate: true, labelled: true };
  it('mouse resting on the canvas: yes', () => expect(boneHoverPickable(ok)).toBe(true));
  it.each([
    ['touch', { touch: true }], ['a button down (rotate / pan / drag)', { buttons: 1 }], ['off the canvas (menu, panel, dock)', { onCanvas: false }],
    ['over a label card (lit by its own rule)', { overLabel: true }], ['not the analysis select mode / no volume pick (gate)', { gate: false }], ['no shown result with a label', { labelled: false }],
  ])('%s: no', (_n, o) => expect(boneHoverPickable({ ...ok, ...o })).toBe(false));
});

describe('glowRegionOf: voxel -> the labelled result', () => {
  const regs = [{ id: 1, segmentKeys: ['a'], label: {} }, { id: 2, segmentKeys: ['b'], label: {} }, { id: 3, segmentKeys: ['b'] }];
  const contains = (r, x) => (r.id === 2 ? x >= 10 : r.id === 3 ? x >= 0 : x < 10);
  it('the labelled result that contains the voxel and owns the picked segment', () => expect(glowRegionOf(regs, { key: 'b', x: 12, y: 0, z: 0 }, contains)).toBe(2));
  it('a result without a label (3) never glows; a segment key that is not the result\'s: none', () => {
    expect(glowRegionOf([regs[2]], { key: 'b', x: 1, y: 0, z: 0 }, contains)).toBe(0);
    expect(glowRegionOf(regs, { key: 'a', x: 12, y: 0, z: 0 }, contains)).toBe(0);
  });
  it('no pick (empty space): none', () => expect(glowRegionOf(regs, null, contains)).toBe(0));
});

describe('createBoneGlow: scenes on the PC', () => {
  const make = () => { const log = []; const g = createBoneGlow((n, p) => log.push([n, p])); return { g, log }; };
  it('rests on a bone: glows; moves to another bone: the new one (one change); leaves the bone: out', () => {
    const { g, log } = make();
    g.settle(g.ticket(), 3); expect(g.get()).toBe(3);
    g.settle(g.ticket(), 5); expect(g.get()).toBe(5);
    g.settle(g.ticket(), 0); expect(g.get()).toBe(0);
    expect(log).toEqual([[3, 0], [5, 3], [0, 5]]);
  });
  it('the same bone again: no change event (no redraw per pick)', () => {
    const { g, log } = make();
    g.settle(g.ticket(), 3); g.settle(g.ticket(), 3);
    expect(log).toEqual([[3, 0]]);
  });
  it('out at once (left the canvas / panel / menu, pressed, mode left): clear(); a pick that returns later is stale and dropped', () => {
    const { g } = make();
    g.settle(g.ticket(), 3);
    const late = g.ticket(); g.clear();
    expect(g.get()).toBe(0);
    g.settle(late, 7); expect(g.get()).toBe(0);
  });
  it('only the newest ticket counts (two picks in flight)', () => {
    const { g } = make();
    const t1 = g.ticket(), t2 = g.ticket();
    g.settle(t1, 4); expect(g.get()).toBe(0);
    g.settle(t2, 6); expect(g.get()).toBe(6);
  });
});

describe('comment-3d.js wiring (PC)', () => {
  it('the bone is found with the existing volume pick, only for a resting mouse: one in flight, no work while moving, the surface mode is not picked', () => {
    expect(pc).toContain('mv.pick(bonePick.x,bonePick.y,s.camera,s.obj,segmentState,gpuSegmentOrder())');
    expect(pc).toContain("threeRenderMode==='volume'&&!!sceneState?.medicalVolume?.active");
    expect(pc).toContain('if(bonePick.busy){bonePick.again=true;return}');
    expect(pc).toContain('performance.now()-bonePick.at>=200?0:80');
  });
  it('the listener is a capture one on the view (the dock / menus stop their own events); leave / press / blur / Escape put the glow out at once', () => {
    expect(pc).toMatch(/host\.addEventListener\('pointermove',ev=>\{\s*const onCanvas=[\s\S]*?\},true\);/);
    expect(pc).toContain("host.addEventListener('pointerleave',boneHoverOff)");
    expect(pc).toContain("host.addEventListener('pointerdown',boneHoverOff,true)");
    expect(pc).toContain("window.addEventListener('blur',boneHoverOff)");
  });
  it('the card is lit with the existing .is-lit look (labelFocus unchanged: no volume focus from the bone hover); the card of the bone under the mouse is kept in the overlap thinning even when judged behind the tissue', () => {
    expect(pc).toContain("const isLitKey=key=>key!=null&&(labelFocus.get()===key||(!!boneGlow.get()&&'A:'+boneGlow.get()===key)||(!!childBoneGlow.get()&&'A:'+childBoneGlow.get()===key))");
    expect(pc).toContain("(e.disp!=='hide'||r.id===bg||r.id===bgc)");
    expect(pc).toContain('keep:lit===\'A:\'+r.id||r.id===bg||r.id===bgc');
    expect(pc).toContain('if(bg&&(!alEls.has(bg)||!boneGate()))boneGlow.clear();if(bgc&&(!alEls.has(bgc)||!boneGate()))childBoneGlow.clear()');
  });
});
