import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { simpleMenuLayout, SIMPLE_MENU } from '../../docs/event-mode.js';
import { installDomStub, importApp } from '../helpers/dom-stub.js';
const v = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const dl = readFileSync(new URL('../../docs/data-load.js', import.meta.url), 'utf8');
installDomStub();
// vr-view.js is not runnable here: its wiring is checked on its source; the board is the pure simpleMenuLayout, the data side runs for real.
const text = { show: '表示', hide: '非表示', section: '断面', sliceOpacity: 'o', trigger: 't', trigPoint: 'p', trigLabel: 'l', trigHintPoint: 'hp', trigHintLabel: 'hl', results: '解析結果（体積）', kids: 'セグメント', total: '合計', page: 'ページ', noSeg: 'none', home: 'h', undo: 'u', reset: 'r', resetAgain: 'ra', all: 'a', exit: 'e' };
const board = (results, kids, over = {}) => simpleMenuLayout({ segments: [{ key: 'bone', name: '骨', color: '#fff', on: true }], sectionOn: false, trigger: { show: results.length + kids.length > 0, label: false }, results, kids, total: results.length ? '9.00 mm³' : '', text, ...over });
const kids = n => Array.from({ length: n }, (_, i) => ({ hex: '#33aa66', name: `セグメント ${i + 1}`, on: true }));
const regs = n => Array.from({ length: n }, (_, i) => ({ hex: '#ff0000', name: `${i + 1}. Fat`, text: '1.00 mm³', on: true }));
const rowsOf = (w, p) => w.filter(x => new RegExp(`^${p}:\\d+$`).test(x.id));

describe('かんたんメニュー: child segments are their own list (not analysis results)', () => {
  it('rat-brain-sigma (0 results, 222 children): the children are listed as segment rows with a heading, paged, every one on some page; there is no results block and no volume total', () => {
    const w = board([], kids(222));
    expect(w.find(x => x.id === 'kids').text).toBe('セグメント');
    expect(w.find(x => x.id === 'results')).toBeUndefined();
    expect(w.find(x => x.id === 'total')).toBeUndefined();
    expect(rowsOf(w, 'result').length).toBe(0);
    const rows = rowsOf(w, 'kid'); expect(rows.length).toBeGreaterThan(5);
    expect(rows[0].color).toBe('#33aa66');
    expect(w.find(x => x.id === 'kid:0:row').target).toBe('kid:0');
    const pages = Math.ceil(222 / rows.length);
    expect(w.find(x => x.id === 'kids:page').text).toBe(`ページ 1/${pages}`);
    expect(w.find(x => x.id === 'kids:next').disabled).toBe(false); expect(w.find(x => x.id === 'kids:prev').disabled).toBe(true);
    expect(w.find(x => x.id === 'kids:next').page).toBe(1);
    const seen = new Set();
    for (let p = 0; p < pages; p++) for (const x of rowsOf(board([], kids(222), { kidPage: p }), 'kid')) seen.add(x.id);
    expect(seen.size).toBe(222);
  });
  it('a hidden-colour child reads as off (chip not lit, grey name)', () => {
    const w = board([], [{ hex: '#33aa66', name: 'a', on: false }]);
    expect(w.find(x => x.id === 'kid:0').on).toBe(false);
    expect(w.find(x => x.id === 'kid:0:name').color).toBe('#6b7885');
  });
  it('with analysis results AND children: both lists are there, the results keep their rows / count / total, the children come below them and nothing runs into the bottom row', () => {
    for (const [nr, nk] of [[4, 3], [30, 222], [2, 1]]) {
      const w = board(regs(nr), kids(nk));
      const r = rowsOf(w, 'result'), k = rowsOf(w, 'kid');
      expect(r.length).toBeGreaterThan(0); expect(k.length).toBeGreaterThan(0);
      expect(w.find(x => x.id === 'total').text.startsWith('合計 9.00 mm³ · ' + nr)).toBe(true);
      expect(Math.max(...r.map(x => x.y + x.h))).toBeLessThanOrEqual(Math.min(...k.map(x => x.y)));
      const bottom = w.find(x => x.id === 'home').y;
      for (const x of w) if (x.type === 'button' || x.type === 'hit') { if (/^(kid|kids|result|results)/.test(x.id)) expect(x.y + x.h, x.id).toBeLessThanOrEqual(bottom); }
      expect(k.length).toBeGreaterThanOrEqual(Math.min(nk, 4));
    }
  });
  it('a board with analysis results only is the same as before: no kids ids at all', () => {
    const w = board(regs(2), []);
    expect(w.filter(x => /^kids?(:|$)/.test(x.id)).length).toBe(0);
    expect(w.find(x => x.id === 'result:0:vol').text).toBe('1.00 mm³');
    expect(w.find(x => x.id === 'total').text).toBe('合計 9.00 mm³ · 2');
    expect(SIMPLE_MENU.LIST_ROW).toBe(46);
  });
});

describe('vr-view.js wiring: child segments in the かんたん menu and the stick click', () => {
  it('kid rows are fed apart from the results; the results, their total and the 解析 tab are untouched by children', () => {
    expect(v).toContain("kidPage:ui.kidPage|0,kids:kidItems.map(k=>({hex:k.hex,name:k.name,on:k.on})),total:");
    expect(v).toContain("results:regionList.map(r=>({hex:'#'+r.color.toString(16).padStart(6,'0'),name:vrChipTitle(r),text:vrVolumeText(r.mm3,sn),on:regionShownVr(r.rid)})),");
    expect(v).toContain("total:(sn?sn.mark+' ':'')+regionList.reduce((a,r)=>a+(regionShownVr(r.rid)?r.mm3:0),0).toFixed(2)+' mm³',");
    expect(v).toContain("kids:tr('childSegment')");
    // the 解析 tab (anT list / total / empty text) does not mention children
    const tab = v.slice(v.indexOf('label(X,y0+10,L.anT,'), v.indexOf('label(X,y0+10,L.anT,') + 3000);
    expect(tab).not.toMatch(/kidItems|childList/);
  });
  it('a kid row switches 色だけ消す (colorOff), never the shape (setChildLook visible); only while the parent is drawn', () => {
    expect(v).toContain("acts['kid:'+j]=()=>{if(k.canToggle)setChildLook(k.key,{colorOff:!k.colorOff})}");
    const line = v.match(/kidItems\.forEach\(\(k,j\)=>\{[^\n]*\}\);/)[0];
    expect(line).not.toContain('visible');
    expect(v).toContain("else if(it.id==='kids:prev'||it.id==='kids:next')w.push({...it,action:()=>{ui.kidPage=it.page}});");
    // the full menu's tree keeps its shape toggle
    expect(v).toContain('setChildLook(r2.id,{visible:on})');
  });
  it('the row state is what the user sees: colour on AND the shape shown AND the parent drawn', () => {
    expect(v).toContain('on:c.colorOff!==true&&!!g.visible&&vrSegShown(g.parentKey)');
  });
  it('refreshChildLut writes the colour bits 0 for the stick click (regionColorOff) and for a colorOff child; hidden / flat masks and the parent are untouched; the stick rewrites both tables', () => {
    expect(v).toContain('a[o+3]=hid||regionColorOff||en.colorOff?0:m;');
    expect(v).toContain('a[R+o+3]=hid?m:0');
    expect(v).toContain('const toggleRegionColor=c=>{regionColorOff=!regionColorOff;pulse(c,0.4,40);try{refreshRegionLut();refreshChildLut()}catch(e){console.warn(e)}');
    const bits = (hid, off, kidOff, m) => (hid || off || kidOff ? 0 : m);
    expect([bits(false, false, false, 2), bits(false, true, false, 2), bits(false, false, true, 2), bits(true, false, false, 2)]).toEqual([2, 0, 0, 0]);
    expect(v).not.toContain('a[o+3]=hid||regionColorOff?0:m');
  });
  it('the child page counter goes back with the other pages on reset', () => { expect((v.match(/ui\.kidPage=0;/g) || []).length).toBeGreaterThanOrEqual(2); expect(v).toContain('ui.anPage=0;ui.resPage=0;ui.kidPage=0;'); });
  it('最初の状態に戻す (data-load.js): the regions\' shown flag / colour and the child segments\' saved state are put back', () => {
    expect(dl).toContain('restoreRegionState(r,e);');
    expect(dl).toContain('restoreChildSegmentsState(project.treeSegments);');
    expect(dl.indexOf('restoreChildSegmentsState(project.treeSegments);')).toBeGreaterThan(dl.indexOf('export function restoreProjectAnnotations'));
  });
});

describe('colorOff: the data, the project file and the reset (real modules)', () => {
  let S, C, R, ST, CL, RV;
  beforeAll(async () => { S = await importApp('segments'); C = await importApp('child-segments'); R = await importApp('event-restore'); ST = await importApp('state'); CL = await importApp('child-labels'); RV = await importApp('region-visibility'); });
  afterEach(() => { C.clearChildSegments(); ST.setAnalysisRegions([]); });
  const runs = (n = 1) => { const r = Array.from({ length: 4 }, () => null); r[0] = [1, 2, 2 + n]; return r; };
  const mk = (extra = {}) => C.addChildSegment({ name: 'Femur', parentKey: 'bone', runsBySlice: runs(3), color: '#ff00cc', ...extra });
  it('default: colour shown; the flag is announced once as colorOff and appears in the render hand-off', () => {
    const c = mk(); expect(c.colorOff).toBe(false);
    const seen = []; const off = S.onChildSegLookChange((x, ch) => seen.push(ch.join()));
    expect(S.setChildLook(c.key, { colorOff: true })).toBe(true); expect(S.setChildLook(c.key, { colorOff: true })).toBe(false);
    expect(seen).toEqual(['colorOff']);
    expect(S.childRenderEntries().find(e => e.key === c.key).colorOff).toBe(true);
    expect(S.setChildLook(c.key, { colorOff: false })).toBe(true); expect(S.childRenderEntries()[0].colorOff).toBe(false);
    expect(S.childRenderEntries()[0].shown).toBe(true); // the shape's own flag is separate
    off();
  });
  it('project file: treeSegments[i].colorOff is always a boolean, and it is read back (a file without it = shown)', () => {
    const c = mk();
    expect(C.childSegmentsForProject()[0].entry.colorOff).toBe(false);
    S.setChildLook(c.key, { colorOff: true });
    const entry = JSON.parse(JSON.stringify(C.childSegmentsForProject()[0].entry));
    expect(entry.colorOff).toBe(true);
    expect(C.childSrcFromEntry(entry, runs(3)).colorOff).toBe(true);
    const { made } = C.restoreChildSegments([C.childSrcFromEntry(entry, runs(3))]); expect(made[0].colorOff).toBe(true);
    const plain = JSON.parse(JSON.stringify(C.childSegmentsForProject()[0].entry)); delete plain.colorOff;
    expect(C.childSrcFromEntry(plain, runs(3)).colorOff).toBe(false);
  });
  it('最初の状態に戻す: name, colour, shape shown, 色だけ消す and the pinned label (with its place) of each child go back to the file; a child the file lacks is left alone', () => {
    const a = mk({ name: 'A', color: '#112233', label: { anchor: { i: 1, j: 2, k: 0 }, offset: { i: 3, j: 0, k: 0 } } }), b = mk({ name: 'B', parentKey: 'bone', color: '#445566', colorOff: true });
    const entries = JSON.parse(JSON.stringify(C.childSegmentsForProject().map(x => x.entry)));
    // the visitor changes everything
    S.setChildLook(a.key, { name: 'zzz', color: '#ffffff', visible: false, colorOff: true });
    S.setChildLook(b.key, { name: '', color: '#000000', visible: false, colorOff: false });
    const extra = mk({ name: 'added', color: '#777777' });
    delete a.label; // label un-pinned
    b.label = { anchor: { i: 0, j: 0, k: 0 } }; // label pinned
    expect(R.restoreChildSegmentsState(entries)).toBe(2);
    expect(a).toMatchObject({ name: 'A', color: '#112233', visible: true }); expect(a.colorOff).toBe(false);
    expect(a.label).toEqual({ anchor: { i: 1, j: 2, k: 0 }, offset: { i: 3, j: 0, k: 0 } });
    expect(b).toMatchObject({ name: 'B', color: '#445566', visible: true, colorOff: true }); expect(b.label).toBeUndefined();
    expect(extra.name).toBe('added');
    expect(R.restoreChildSegmentsState(entries)).toBe(2); // nothing differs now: no further change
  });
  it('a region\'s shown flag and colour go back to the file', () => {
    const r = { id: 1, visible: false, color: 0x00ff00 };
    R.restoreRegionState(r, { visible: true, color: 0xff0000 }); expect(r.visible).toBe(true); expect(r.color).toBe(0xff0000);
    const r2 = { id: 2, visible: true, color: 1 }; R.restoreRegionState(r2, { color: 1 }); expect(RV.regionVisible(r2)).toBe(true);
    const r3 = { id: 3, visible: true, color: 1 }; R.restoreRegionState(r3, { visible: false, color: 1 }); expect(r3.visible).toBe(false);
  });
});
