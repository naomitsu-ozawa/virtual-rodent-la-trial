// stage 3 (VR): the かんたん menu's 色 / 表示 toggles and 「すべて表示（隠 N）」, the full menu's tree, and the shape rule of the totals and the labels.
// vr-view.js is not runnable here: its wiring is checked on its source; the board is the pure simpleMenuLayout.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { simpleMenuLayout, TOGGLE_X, TOGGLE_W, TOGGLE_GAP, SIMPLE_MENU } from '../../docs/event-mode.js';
import { regionHidden, regionVisible } from '../../docs/region-visibility.js';
const v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const pair = readFileSync(new URL('../../docs/vr-pair-data.js', import.meta.url), 'utf8');
const text = { color: '色', shape: '表示', show: '表示', hide: '非表示', section: '断面', sliceOpacity: 'o', trigger: 't', trigPoint: 'p', trigLabel: 'l', trigHintPoint: 'hp', trigHintLabel: 'hl', results: '解析結果（体積）', kids: 'セグメント', total: '合計', page: 'ページ', noSeg: 'none', home: 'h', undo: 'u', reset: 'r', resetAgain: 'ra', all: 'a', exit: 'e' };
const row = (o = {}) => ({ hex: '#ff0000', name: '1. Femur', text: '1.00 mm³', colorOn: true, shapeOn: true, ...o });
const board = (results, kids = [], showAll) => simpleMenuLayout({ segments: [{ key: 'bone', name: '骨', color: '#fff', on: true }], sectionOn: false, trigger: { show: true, label: false }, results, kids, total: '1.00 mm³', text, ...(showAll ? { showAll } : {}) });
const by = (w, id) => w.find(x => x.id === id);

describe('かんたん menu rows: 色 and 表示 as two toggles, the colour chip is a sample', () => {
  it('a result row has the colour sample, 色 and 表示 at the right end; the only pressable parts are the two toggles (no whole-row hit area)', () => {
    const w = board([row()]);
    expect(w.some(x => x.type === 'hit')).toBe(false);
    const chip = by(w, 'result:0'), c = by(w, 'result:0:color'), s = by(w, 'result:0:shape');
    expect(chip.swatch).toBe(true); expect(chip.action).toBeUndefined(); expect(chip.color).toBe('#ff0000');
    expect([c.label, s.label]).toEqual(['色', '表示']); // wording fixed
    expect(c.x).toBe(TOGGLE_X); expect(s.x).toBe(TOGGLE_X + TOGGLE_W + TOGGLE_GAP); expect(s.x + s.w).toBe(SIMPLE_MENU.W - SIMPLE_MENU.X);
    expect(c.y).toBe(chip.y); expect(s.y).toBe(chip.y);
  });
  it('lit = on, per flag, independently (colour off keeps the shape lit and the name coloured; hidden shape: grey name)', () => {
    const w = board([row({ colorOn: false }), row({ shapeOn: false }), row({ colorOn: false, shapeOn: false })]);
    expect([by(w, 'result:0:color').on, by(w, 'result:0:shape').on]).toEqual([false, true]); expect(by(w, 'result:0:name').color).toBe('#ff0000');
    expect([by(w, 'result:1:color').on, by(w, 'result:1:shape').on]).toEqual([true, false]); expect(by(w, 'result:1:name').color).toBe('#6b7885');
    expect([by(w, 'result:2:color').on, by(w, 'result:2:shape').on]).toEqual([false, false]); expect(by(w, 'result:2:name').color).toBe('#6b7885');
  });
  it('the label never changes with the state; the parent tissue off disables both and greys the name', () => {
    const a = board([row()]), b = board([row({ colorOn: false, shapeOn: false })]), d = board([row({ disabled: true })]);
    expect([by(a, 'result:0:color').label, by(a, 'result:0:shape').label]).toEqual([by(b, 'result:0:color').label, by(b, 'result:0:shape').label]);
    expect([by(d, 'result:0:color').disabled, by(d, 'result:0:shape').disabled, by(d, 'result:0:name').color]).toEqual([true, true, '#6b7885']);
    expect([!!by(a, 'result:0:color').disabled, !!by(a, 'result:0:shape').disabled]).toEqual([false, false]);
  });
  it('a child row has the same two toggles', () => {
    const w = board([], [row({ name: 's1', shapeOn: false })]);
    expect([by(w, 'kid:0:color').label, by(w, 'kid:0:shape').label]).toEqual(['色', '表示']); expect(by(w, 'kid:0').swatch).toBe(true);
    expect([by(w, 'kid:0:color').on, by(w, 'kid:0:shape').on]).toEqual([true, false]);
  });
});

describe('「すべて表示（隠 N）」 on the list heading', () => {
  it('one button at the right of the first heading; disabled while N is 0, pressable with N > 0', () => {
    for (const [n, dis] of [[0, true], [3, false]]) {
      const w = board([row()], [row({ name: 'k' })], { n, label: `すべて表示（隠 ${n}）` }), b = by(w, 'showAll'), h = by(w, 'results');
      expect(w.filter(x => x.id === 'showAll').length).toBe(1);
      expect(b.label).toBe(`すべて表示（隠 ${n}）`); expect(!!b.disabled).toBe(dis); expect(b.x + b.w).toBe(SIMPLE_MENU.W - SIMPLE_MENU.X);
      expect(b.y).toBeLessThan(h.y + 30); expect(b.y + b.h).toBeGreaterThan(h.y); // on the heading's line
      const first = by(w, 'result:0:color'); expect(b.y + b.h).toBeLessThanOrEqual(first.y); // above the first row
    }
  });
  it('with no analysis results the button sits on the children\'s heading; without o.showAll there is none', () => {
    const w = board([], [row({ name: 'k' })], { n: 1, label: 'x' }), b = by(w, 'showAll'), h = by(w, 'kids');
    expect(b).toBeTruthy(); expect(b.y).toBeLessThan(h.y + 30); expect(b.y + b.h).toBeLessThanOrEqual(by(w, 'kid:0:color').y);
    expect(by(board([row()]), 'showAll')).toBeUndefined();
    expect(by(board([], []), 'showAll')).toBeUndefined();
  });
});

describe('vr-view.js wiring: the board, the full menu\'s tree, the totals and the labels', () => {
  it('かんたん menu: the 色 of a result is region.visible, the 表示 is region.hidden; both do nothing while the parent tissue is off; すべて表示 = showAllHiddenShapes', () => {
    expect(v).toContain("acts['result:'+i+':color']=()=>{pressRegionColor(reg())};");
    expect(v).toContain("acts['result:'+i+':shape']=()=>{const g=reg();if(g)setRegionHidden(g,!regionHidden(g))}});");
    expect(v).toContain('const regionParentOn=r=>!r.segmentKeys?.length||r.segmentKeys.some(vrSegShown);');
    expect(v).toContain('acts.showAll=()=>{showAllHiddenShapes()};');
    expect(v).toContain("showAll:(()=>{const n=hiddenShapeCount();return{n,label:tr('vrShowAllHidden').replace('{n}',String(n))}})()");
    expect(v).toContain("color:tr('regionColorToggle'),shape:tr('regionShapeToggle'),section:L.sec,");
    expect(v).not.toContain("it.type==='hit'"); // the whole-row hit area is gone
    expect(v).toContain("else if(it.swatch)w.push({...it});"); // the sample is drawn, never pressed
  });
  it('the 色 / 表示 stay as they are on the stick press: the stick click (regionColorOff) is untouched', () => {
    expect(v).toContain('const toggleRegionColor=c=>{regionColorOff=!regionColorOff;colorPick.clear();');
    expect(v).toContain('{shown:regionColorSeen(e.rid),hidden:regionHiddenVr(e.rid)}');
  });
  it('full menu tree: 色 / 表示 (a region: visible / hidden; a child: colorOff / visible) instead of the 表示 / 非表示 pair; the chip is a sample; a child keeps 濃淡 and 簡易', () => {
    expect(v).toContain("setColor=on=>{if(isKid)pressChildColor(r2.id);else pressRegionColor(regionById(r2.id))},setShape=on=>{if(isKid)setChildLook(r2.id,{visible:on});else setRegionHidden(regionById(r2.id),!on)};");
    expect(v).toContain("btn(sx,y+2,rowBtnW,tr('regionColorToggle'),colorOn,()=>setColor(!colorOn),");
    expect(v).toContain("btn(sx+rowBtnW+6,y+2,rowBtnW,tr('regionShapeToggle'),shapeOn,()=>setShape(!shapeOn),");
    expect(v).toContain("w.push({type:'button',x:X+36,y:y+4,w:48,h:46,label:'',on:true,color:hex,swatch:true});");
    expect(v).not.toContain("tr('showRegion')"); expect(v).not.toContain("tr('hideRegion')");
    expect(v).toContain('L.shBtn'); expect(v).toContain('L.segModes[1],(segMode[r2.id]|0)===1');
  });
  it('totals and labels follow the SHAPE rule (a colour-off result counts, a hidden-shape one does not): かんたん total, 解析 tab total, pinned cards, the partner\'s cards', () => {
    expect(v).toContain('regionCountedVr=rid=>!regionHiddenVr(rid)');
    expect(v).toContain("regionList.reduce((a,r)=>a+(regionCountedVr(r.rid)?r.mm3:0),0).toFixed(2)");
    expect(v).toContain('const shownRes=regionList.filter(r=>regionCountedVr(r.rid)),total=shownRes.reduce((a,r)=>a+r.mm3,0);');
    expect(v).toContain('if(regionHidden(reg))lb.hid=true;');
    expect(v).toContain('(p?(!!p.label&&pairShapeShown(p)&&labelSegmentsShown(p.segmentKeys,vrSegShown))');
    expect(v).toContain(':pairShapeShown(null)&&labelSegmentsShown(reg.segmentKeys,pairShownKey)');
    expect(v).not.toContain('if(!regionVisible(reg))lb.hid=true;'); // the old colour rule is gone
    expect(v).not.toContain('(!regionVisible(p)');
    // the rule itself, on the page's flags
    const total = regs => regs.filter(r => !regionHidden(r)).reduce((a, r) => a + r.mm3, 0);
    expect(total([{ mm3: 1 }, { mm3: 2, visible: false }, { mm3: 4, hidden: true }, { mm3: 8, visible: false, hidden: true }])).toBe(3);
    expect(regionVisible({ visible: false })).toBe(false); // the colour flag alone does not remove a result from the total
  });
  it('a hidden shape\'s menu refresh: the board redraws when the shape flag changes', () => {
    expect(v).toContain('if(ui.open)menu.refresh()}); // stage 3: the board\'s 表示 toggles and 「すべて表示（隠 N）」 follow');
  });
  it('the partner\'s project flag is passed through (vr-pair-data.js regionsOf); the drawing of the partner is not changed', () => {
    expect(pair).toContain('...(e.hidden === true ? { hidden: true } : {})');
  });
});
