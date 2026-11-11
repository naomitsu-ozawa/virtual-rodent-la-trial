import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
// vr-view.js is not runnable here: the wiring is checked on its source.
describe('stick click short press with no section: the regions\' colours (stickShort 0, default) or the labels (1)', () => {
  it('stickShort is a saved setting, default 0 (regions\' colours); it is not an event-view key', () => {
    expect(v).toMatch(/const DEFAULTS=\{[^\n]*,stickShort:0\};/);
    expect(v).toMatch(/const EVENT_VIEW_KEYS=\[[^\]]*\];/);
    expect(v.match(/const EVENT_VIEW_KEYS=\[([^\]]*)\]/)[1]).not.toContain('stickShort');
    expect(v).toContain('...DEFAULTS,...st');
  });
  it('the press: no section + stickShort 1 = labels, otherwise the regions\' colours; with a section nothing changes', () => {
    expect(v).toContain("if(ev==='short'&&!planes.length){if((settings.stickShort|0)===1)toggleLabelsHidden(c);else toggleRegionColor(c)}");
    expect(v).toContain("else if(ev==='short')toggleSliceClear(c);");
    expect(v).toContain("else if(ev==='long')toggleFramesHidden(c);");
  });
  it('regionColorOff clears the segment bits in refreshRegionLut only (region.visible untouched), and toggleRegionColor re-uploads the table with a toast', () => {
    expect(v).toContain('a[o+3]=regionShownVr(e.rid)&&!regionColorOff?(');
    const t = v.match(/const toggleRegionColor=c=>\{[^\n]*\}/)[0];
    expect(t).toContain('regionColorOff=!regionColorOff;');
    expect(t).toContain('refreshRegionLut()');
    expect(t).toContain('L.regColT+(regionColorOff?L.labelHid:L.labelShow)');
    expect(t).not.toMatch(/setRegionVisible|regionVisible/);
    expect(v.indexOf('let regionColorOff=false;')).toBeLessThan(v.indexOf('const refreshRegionLut='));
  });
  it('toasts (ja / en)', () => {
    expect(v).toContain("regColT:'領域の色：',labelHid:'非表示',labelShow:'表示',");
    expect(v).toContain("regColT:'Region colours: ',labelHid:'hidden',labelShow:'shown',");
  });
  it('the 解析 tab has the choice (ja / en), saved with the other settings', () => {
    expect(v).toContain("stkT:'スティック短押し（断面なし）',stkV:['領域の色','ラベル']");
    expect(v).toContain("stkT:'Stick click (no section)',stkV:['Region colours','Labels']");
    expect(v).toContain('settings.stickShort=v;saveSettings(settings)');
  });
  it('the 体験会 reset and the data switch put regionColorOff back (and rewrite the table)', () => {
    const re = /labelsHidden=false;if\(regionColorOff\)\{regionColorOff=false;try\{refreshRegionLut\(\)\}catch\(e\)\{console\.warn\(e\)\}\}/g;
    expect(v.match(re).length).toBe(2);
  });
});
