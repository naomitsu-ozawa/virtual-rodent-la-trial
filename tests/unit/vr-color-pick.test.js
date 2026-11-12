import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const line = (re) => { const m = v.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
const seenLine = line(/const regionColorSeen=[^\n]*childColorSeen=[^\n;]*;/);
const pressR = line(/const pressRegionColor=[^\n]*\};/);
const pressC = line(/const pressChildColor=[^\n]*\};/);
const toggle = line(/const toggleRegionColor=c=>\{[^\n]*\}/);
const resetOnce = line(/if\(regionColorOff\|\|colorPick\.size\)\{regionColorOff=false;colorPick\.clear\(\);try\{refreshRegionLut\(\);refreshChildLut\(\)\}catch\(e\)\{console\.warn\(e\)\}\}/);
const make = () => {
  const body = `
    const regions={1:{id:1,visible:true},2:{id:2,visible:true},3:{id:3,visible:false}};
    const kids={s1:{key:'s1',colorOff:false},s2:{key:'s2',colorOff:true}};
    const writes=[];let paints=0;
    let regionColorOff=false;const colorPick=new Set();
    const regionVisible=g=>g.visible,regionShownVr=rid=>regionVisible(regions[rid]);
    const childByKey=k=>kids[k]||null;
    const setRegionVisible=(g,on)=>{writes.push(['r',g.id,on]);g.visible=on};
    const setChildLook=(k,o)=>{writes.push(['c',k,o]);Object.assign(kids[k],o)};
    const repaintColors=()=>{paints++};
    const refreshRegionLut=()=>{},refreshChildLut=()=>{},pulse=()=>{},ui={open:false},menu={refresh(){}},L={regColT:'',labelHid:'',labelShow:''},SLICE_TOAST_MS=1,performance={now:()=>0};
    const sliceToast={set(){},until:0,mesh:{parent:null,visible:false}};
    ${seenLine}
    ${pressR}
    ${pressC}
    ${toggle}
    const reset=()=>{${resetOnce}};
    const ctl={add(){}};
    return {regions,kids,writes,seenR:r=>regionColorSeen(r),seenC:k=>childColorSeen(k),pressR:id=>pressRegionColor(regions[id]),pressC:pressChildColor,stick:()=>toggleRegionColor(ctl),reset,off:()=>regionColorOff,picks:()=>[...colorPick].sort()};`;
  return new Function(body)();
};
describe('an earlier change: stick colour-off + picking single colours (案1)', () => {
  it('stick press: every colour off; a 色 press then colours only that one; the saved flags are not written', () => {
    const s = make();
    expect([s.seenR(1), s.seenR(2), s.seenR(3), s.seenC('s1'), s.seenC('s2')]).toEqual([true, true, false, true, false]); // the saved flags, stick not pressed
    s.stick();
    expect(s.off()).toBe(true);
    expect([s.seenR(1), s.seenR(2), s.seenR(3), s.seenC('s1'), s.seenC('s2')]).toEqual([false, false, false, false, false]);
    s.pressR(1); // region A
    expect([s.seenR(1), s.seenR(2), s.seenC('s1')]).toEqual([true, false, false]);
    s.pressR(3); // a region whose saved colour is off can be picked too (the colour shows)
    s.pressC('s2');
    expect([s.seenR(3), s.seenC('s2')]).toEqual([true, true]);
    s.pressR(1); // the same one again: off
    expect(s.seenR(1)).toBe(false);
    expect(s.writes).toEqual([]); // region.visible / colorOff untouched
    expect(s.regions[1].visible).toBe(true);
    expect(s.regions[3].visible).toBe(false);
    expect(s.kids.s2.colorOff).toBe(true);
  });
  it('stick press again: every colour is back (the saved flags), the picks are dropped; another press = all off again, from an empty pick', () => {
    const s = make();
    s.stick(); s.pressR(1); s.pressC('s1');
    expect(s.picks()).toEqual(['c' + 's1', 'r1']);
    s.stick();
    expect(s.off()).toBe(false);
    expect(s.picks()).toEqual([]);
    expect([s.seenR(1), s.seenR(2), s.seenR(3), s.seenC('s1'), s.seenC('s2')]).toEqual([true, true, false, true, false]);
    s.stick();
    expect(s.off()).toBe(true);
    expect([s.seenR(1), s.seenR(2), s.seenC('s1')]).toEqual([false, false, false]); // A is off again
  });
  it('stick not pressed: the 色 press toggles the saved flag as before', () => {
    const s = make();
    s.pressR(1); s.pressC('s2');
    expect(s.writes).toEqual([['r', 1, false], ['c', 's2', { colorOff: false }]]);
    expect([s.seenR(1), s.seenC('s2')]).toEqual([false, true]);
    expect(s.picks()).toEqual([]);
  });
  it('the data switch / 体験会 reset empties the picks and the stick state', () => {
    const s = make();
    s.stick(); s.pressR(2);
    s.reset();
    expect(s.off()).toBe(false);
    expect(s.picks()).toEqual([]);
  });
  it('one rule for every place: the 解析 chip, the buttons, the ring, the partner and the tables all use regionColorSeen / childColorSeen; the chip press is the 色 press', () => {
    expect(v).toContain('on:regionColorSeen(r.rid),color:hex,action:()=>{pressRegionColor(regionById(r.rid))}');
    expect(v).toContain('colorOn:regionColorSeen(r.rid)');
    expect(v).toContain('{shown:p?regionColorSeen(p.id):!regionColorOff,hidden:regionHidden(p)}');
    expect(v).not.toMatch(/regionShownVr\([^)]*\)&&!regionColorOff/);
  });
});
