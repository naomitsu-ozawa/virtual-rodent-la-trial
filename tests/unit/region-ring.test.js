// stage 3 (VR): the long-press ring of a region / a child segment (docs/region-ring.js) and its wiring in docs/vr-view.js.
// vr-view.js is not runnable here: the wiring is checked on its source, the ring's items / targets / confirm run for real.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ringState, regionRingItems, regionRingName, applyRingItem, ringTargetOf, RING_ITEM_IDS } from '../../docs/region-ring.js';
import { setRegionVisible, setRegionHidden, regionVisible, regionHidden } from '../../docs/region-visibility.js';
import { wheelAngles } from '../../docs/vr-ring.js';
import { I18N } from '../../docs/i18n.js';
const v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const ring = readFileSync(new URL('../../docs/vr-ring.js', import.meta.url), 'utf8');
const text = { color: '色', shape: '表示', regionColor: '領域の色', regionShape: '領域の表示', childColor: '子の色', childShape: '子の表示', detach: '切り出す', regionDetach: '領域の切り出す', childDetach: '子の切り出す', back: '戻す' };
const mkChild = (o = {}) => ({ key: 's1', visible: true, colorOff: false, ...o });

describe('the ring items: one target = 2, a region and a child together = 4', () => {
  it('a region alone: 色 (left) and 表示 (right), lit = colour on / shape shown', () => {
    const items = regionRingItems(ringState({ id: 1 }, null), text);
    expect(items.map(i => i.label)).toEqual(['色', '表示', '切り出す']); expect(items.map(i => i.id)).toEqual(['rcolor', 'rshape', 'rdetach']); expect(items.map(i => i.on)).toEqual([true, true, false]);
    expect(wheelAngles(items.length, true)).toEqual([240, 120, 0]); // slot 0 (色) = lower left, slot 1 (表示) = lower right, slot 2 (切り出す) = top (vr-ring.js): 色 left, 表示 right as decided
  });
  it('a child alone: the same two items on the child\'s flags', () => {
    const items = regionRingItems(ringState(null, mkChild({ colorOff: true })), text);
    expect(items.map(i => i.label)).toEqual(['色', '表示', '切り出す']); expect(items.map(i => i.id)).toEqual(['ccolor', 'cshape', 'cdetach']); expect(items.map(i => i.on)).toEqual([false, true, false]);
  });
  it('a region and a child (they overlap under the laser): four items that say whose they are, in the agreed order', () => {
    const items = regionRingItems(ringState({ id: 1, hidden: true }, mkChild({ visible: false })), text);
    expect(items.map(i => i.label)).toEqual(['領域の色', '領域の表示', '領域の切り出す', '子の色', '子の表示', '子の切り出す']); expect(items.map(i => i.id)).toEqual(['rcolor', 'rshape', 'rdetach', 'ccolor', 'cshape', 'cdetach']);
    expect(items.map(i => i.on)).toEqual([true, false, false, true, false, false]);
    expect(RING_ITEM_IDS).toEqual(['rcolor', 'rshape', 'ccolor', 'cshape', 'rdetach', 'cdetach', 'pback']);
    const ang = wheelAngles(items.length, true), at = id => ang[items.findIndex(i => i.id === id)];
    expect([at('rcolor'), at('rshape'), at('rdetach')]).toEqual([300, 60, 0]); expect([at('ccolor'), at('cshape'), at('cdetach')]).toEqual([240, 120, 180]);
    for (const id of ['rcolor', 'rshape', 'rdetach']) expect(Math.cos(at(id) * Math.PI / 180)).toBeGreaterThanOrEqual(0); // up (0 = up, clockwise)
    for (const id of ['ccolor', 'cshape', 'cdetach']) expect(Math.cos(at(id) * Math.PI / 180)).toBeLessThan(0);
    for (const [l, r] of [['rcolor', 'rshape'], ['ccolor', 'cshape']]) expect(Math.sin(at(l) * Math.PI / 180)).toBeLessThan(0), expect(Math.sin(at(r) * Math.PI / 180)).toBeGreaterThan(0); // left / right
    expect(new Set(ang).size).toBe(6);
  });
  it('no target = no ring; the names go in the middle', () => {
    expect(regionRingItems(ringState(null, null), text)).toEqual([]);
    expect(regionRingName('1. Femur', 's1')).toBe('1. Femur / s1'); expect(regionRingName('', 'a')).toBe('a'); expect(regionRingName('1. Femur', '')).toBe('1. Femur');
  });
  it('the words exist in ja and en (fixed wording, no emoji)', () => {
    for (const lang of ['ja', 'en']) for (const k of ['regionColorToggle', 'regionShapeToggle', 'ringRegionColor', 'ringRegionShape', 'ringChildColor', 'ringChildShape', 'vrShowAllHidden']) {
      expect(I18N[lang][k], `${lang} ${k}`).toBeTruthy(); expect(I18N[lang][k]).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect([I18N.ja.regionColorToggle, I18N.ja.regionShapeToggle, I18N.en.regionColorToggle, I18N.en.regionShapeToggle]).toEqual(['色', '表示', 'Color', 'Show']);
    expect(I18N.ja.vrShowAllHidden.replace('{n}', '3')).toBe('すべて表示（隠 3）');
  });
});

describe('confirming an item: each switches only its own flag of its own target', () => {
  const make = () => {
    const calls = [], reg = { id: 1 }, child = mkChild();
    const ops = { setRegionVisible, setRegionHidden, setChildLook: (key, look) => { calls.push([key, look]); if ('colorOff' in look) child.colorOff = look.colorOff; if ('visible' in look) child.visible = look.visible; return true; } };
    return { reg, child, ops, calls };
  };
  it('色 of a region = region.visible only; 表示 of a region = region.hidden only (and back)', () => {
    const { reg, child, ops, calls } = make();
    expect(applyRingItem('rcolor', { reg, child: null }, ops)).toBe(true);
    expect([regionVisible(reg), regionHidden(reg)]).toEqual([false, false]);
    expect(applyRingItem('rshape', { reg, child: null }, ops)).toBe(true);
    expect([regionVisible(reg), regionHidden(reg)]).toEqual([false, true]);
    applyRingItem('rcolor', { reg, child: null }, ops); applyRingItem('rshape', { reg, child: null }, ops);
    expect([regionVisible(reg), regionHidden(reg)]).toEqual([true, false]);
    expect(calls).toEqual([]); expect(child.colorOff).toBe(false); // a region item never touches a child
  });
  it('色 of a child = colorOff only; 表示 of a child = visible only', () => {
    const { reg, child, ops, calls } = make();
    applyRingItem('ccolor', { reg: null, child }, ops); expect(calls).toEqual([['s1', { colorOff: true }]]); expect([child.colorOff, child.visible]).toEqual([true, true]);
    applyRingItem('cshape', { reg: null, child }, ops); expect(calls[1]).toEqual(['s1', { visible: false }]); expect([child.colorOff, child.visible]).toEqual([true, false]);
    applyRingItem('cshape', { reg: null, child }, ops); expect([child.colorOff, child.visible]).toEqual([true, true]);
    expect(regionVisible(reg)).toBe(true); expect(regionHidden(reg)).toBe(false);
  });
  it('the four-item ring: each item acts on its own side; an item whose target is missing does nothing', () => {
    const { reg, child, ops, calls } = make();
    applyRingItem('rshape', { reg, child }, ops); expect([regionHidden(reg), child.visible]).toEqual([true, true]);
    applyRingItem('cshape', { reg, child }, ops); expect([regionHidden(reg), child.visible]).toEqual([true, false]);
    expect(applyRingItem('ccolor', { reg, child: null }, ops)).toBe(false); expect(applyRingItem('rcolor', { reg: null, child }, ops)).toBe(false); expect(applyRingItem('nope', { reg, child }, ops)).toBe(false);
    expect(calls.length).toBe(1);
  });
});

describe('which laser hits ring (ringTargetOf)', () => {
  const hit = (o = {}) => ({ id: 0, childKey: '', ...o });
  it('a region, a child, or both under the laser, on the three kinds that carry a tissue hit (解析 tab label / surface record / section-mode tissue)', () => {
    for (const k of ['label', 'record', 'tissue']) {
      expect(ringTargetOf(k, hit({ id: 3 }))).toEqual({ regionId: 3, childKey: '' });
      expect(ringTargetOf(k, hit({ childKey: 's2' }))).toEqual({ regionId: 0, childKey: 's2' });
      expect(ringTargetOf(k, hit({ id: 3, childKey: 's2' }))).toEqual({ regionId: 3, childKey: 's2' });
    }
  });
  it('no ring: a plain segment (no region, no child), the partner\'s bone, a section\'s plane, any other kind', () => {
    expect(ringTargetOf('label', hit())).toBeNull(); expect(ringTargetOf('record', hit({ id: 1, pair: true }))).toBeNull();
    expect(ringTargetOf('record', hit({ id: 1, plane: true }))).toBeNull(); expect(ringTargetOf('section', hit({ id: 1 }))).toBeNull();
    expect(ringTargetOf('point', hit({ id: 1 }))).toBeNull(); expect(ringTargetOf('label', null)).toBeNull();
  });
});

describe('vr-view.js wiring of the ring', () => {
  it('the long press opens the ring on a region / child; the point ring and the old consumed-only path are kept', () => {
    expect(v).toContain("if(pr.res.kind==='point'){pr.consumed=true;openPointWheel(c,pr.res.ref.id);pulseTwice(c)}");
    expect(v).toContain("else if(pr.res.kind==='record'||pr.res.kind==='label'||pr.res.kind==='tissue'){");
    expect(v).toContain('const tg=msStart()?null:ringTargetOf(pr.res.kind,pr.res.ref);');
    expect(v).toContain('if(tg&&openRegionRing(c,tg,pr.res.ref)){pr.consumed=true;pulseTwice(c)}');
    expect(v).toContain("else if(pr.res.kind!=='tissue')pr.consumed=true;");
  });
  it('pw carries a kind: the point-only assumptions are split (pointsChanged, pwIds, confirmPoint, updateRings)', () => {
    expect(v).toContain("pw={c,kind:'point',id,mode:'main'}");
    expect(v).toContain("if(pw?.kind==='point'&&!ids.has(pw.id))closePointWheel();");
    expect(v).toContain("const pwIds=()=>pw?.kind==='region'?pw.items.map(i=>i.id):pw?.mode==='color'?COLOR_IDS:");
    expect(v).toContain("if(pw?.kind==='region')return confirmRegionRing(k,c);");
    expect(v).toContain("if(pw.kind==='region'){if(pw.partUid!=null?!parts.some(q=>q.uid===pw.partUid):!(pw.rid?regionById(pw.rid):childByKey(pw.childKey))){closePointWheel();return}}");
    expect(v).toContain('else{const pt=vpMarkers.centres().find(x=>x.id===pw.id);if(!pt){closePointWheel();return}}');
  });
  it('the ring is the point ring\'s board (same laser pick, thumbstick, closing); a confirm closes it, pulses and applies the item', () => {
    expect(v).toContain("pointWheel.setItems(items.map(i=>i.label),items.map(i=>i.enabled!==false),items.map(i=>i.on),items.length===3||items.length===4||items.length===6);pointWheel.setCentre(pw.name);");
    expect(v).toContain('closePointWheel();pulse(c,HAPTIC.ringConfirm.amp,HAPTIC.ringConfirm.ms);\n  applyRingItem(it.id,{reg,child},{setRegionVisible,setRegionHidden,setChildLook,pressRegionColor,pressChildColor,');
    expect(v).toContain("pointWheel.setCentre('')"); // the point ring has no name in the middle
    expect(ring).toContain('setCentre(t){');
  });
  it('the partner\'s bone has no ring (ringTargetOf rejects ref.pair); the partner\'s results follow the primary\'s shape flag as before', () => {
    expect(v).toContain('hidden:regionHidden(p)});');
  });
});

describe('(消えたら消灯に揃える): the 色 items and buttons show what the user sees, the stick\'s colour-off included', () => {
  it('ringState: seen overrides the colour only; omitted = the flags', () => {
    const reg = { id: 1, visible: true }, kid = mkChild();
    expect(ringState(reg, kid).reg.color).toBe(true); expect(ringState(reg, kid).child.color).toBe(true);
    const s = ringState(reg, kid, { reg: false, child: false });
    expect(s.reg).toEqual({ color: false, shape: true }); expect(s.child).toEqual({ color: false, shape: true });
    expect(ringState(reg, kid, { reg: undefined, child: undefined }).reg.color).toBe(true);
    expect(regionRingItems(ringState(reg, null, { reg: false }), text).map(i => i.on)).toEqual([false, true, false]);
  });
  it('applyRingItem: the 色 items go through the board\'s press when it is given (one helper), else toggle the flag as before', () => {
    const calls = [], reg = { id: 1, visible: true }, kid = mkChild({ colorOff: false });
    const ops = { setRegionVisible: () => { calls.push('flag-r'); return true; }, setRegionHidden: () => true, setChildLook: () => { calls.push('flag-c'); return true; }, pressRegionColor: g => { calls.push('press-r' + g.id); return true; }, pressChildColor: k => { calls.push('press-c' + k); return true; } };
    expect(applyRingItem('rcolor', { reg, child: kid }, ops)).toBe(true); expect(applyRingItem('ccolor', { reg, child: kid }, ops)).toBe(true);
    expect(calls).toEqual(['press-r1', 'press-cs1']);
    const plain = { ...ops }; delete plain.pressRegionColor; delete plain.pressChildColor;
    applyRingItem('rcolor', { reg, child: kid }, plain); applyRingItem('ccolor', { reg, child: kid }, plain); expect(calls.slice(2)).toEqual(['flag-r', 'flag-c']);
    // the 表示 items are untouched
    expect(applyRingItem('rshape', { reg, child: kid }, ops)).toBe(true);
  });
  it('vr-view.js: the buttons / the ring read the seen colour, the stick redraws the board, one press helper serves the かんたん board, the full tree and the ring; the tables keep reading the flags', () => {
    expect(v).toContain("const regionColorSeen=rid=>regionColorOff?colorPick.has('r'+rid):regionShownVr(rid),childColorSeen=key=>regionColorOff?colorPick.has('c'+key):childByKey(key)?.colorOff!==true;");
    expect(v).toContain("const pressRegionColor=g=>{if(!g)return false;if(regionColorOff){const k='r'+g.id;if(!colorPick.delete(k))colorPick.add(k)}else setRegionVisible(g,!regionVisible(g));repaintColors();return true};");
    expect(v).toContain("const pressChildColor=key=>{const c=childByKey(key);if(!c)return false;if(regionColorOff){const k='c'+key;if(!colorPick.delete(k))colorPick.add(k)}else setChildLook(key,{colorOff:c.colorOff!==true});repaintColors();return true};");
    expect(v).toContain("const repaintColors=()=>{visGen++;try{refreshRegionLut();refreshChildLut()}catch(e){console.warn(e)}if(ui.open)menu.refresh()};");
    expect(v).toContain("try{refreshRegionLut();refreshChildLut()}catch(e){console.warn(e)}if(ui.open)menu.refresh();sliceToast.set(L.regColT+"); // the stick press redraws the board: the buttons follow
    expect(v).toContain("ringState(reg,child,{reg:reg?regionColorSeen(reg.id):undefined,child:child?childColorSeen(child.key):undefined})");
    expect(v).toContain("colorOn=isKid?r.colorOn:regionColorSeen(r2.id)");
    expect(v).toContain("colorOn:childColorSeen(g.key),canToggle:vrSegShown(k)");
    expect(v).toContain('{shown:regionColorSeen(e.rid),hidden:regionHiddenVr(e.rid)}'); // the look-up table: the same seen rule as the buttons
    expect(v).toContain("a[o+3]=hid||!(regionColorOff?colorPick.has('c'+e.key):!en.colorOff)?0:m;");
  });
});

describe('an earlier change: regionAnyHidden gates every regionHiddenAt read of the VR shader', () => {
  it('declared with the results\' table, 1 until a table is written, set from the table just written (the partner: its own), a partner uniform of its own', () => {
    expect(v).toContain('uniform int regionAnyHidden;');
    expect(v).toContain('int regionVis(vec3 p,int si){if(si<0||regionAnyHidden==0)return si;return regionHiddenAt(texCoord(p),si)?-1:si;}');
    expect(v.match(/regionHiddenAt\(/g).length).toBe(1 + 1 + 3); // the definition, regionVis, and the three loops' hit tests
    expect(v.match(/if\(!passH&&regionAnyHidden!=0\)passH=regionHiddenAt\(/g)).toHaveLength(3);
    expect(v).toContain('regionLut:{value:null},regionAnyHidden:{value:1},childTex');
    expect(v).toContain('if(regionLutHiddenSlots(a[i*4+3])){any=1;break}if(material)material.uniforms.regionAnyHidden.value=any}');
    expect(v).toContain('if(regionLutHiddenSlots(a[i*4+3])){any=1;break}pt.u.regionAnyHidden.value=any}');
    const pair = readFileSync(new URL('../../docs/vr-pair-view.js', import.meta.url), 'utf8');
    expect(pair).toContain("'regionTex', 'regionLut', 'regionAnyHidden',");
  });
});
