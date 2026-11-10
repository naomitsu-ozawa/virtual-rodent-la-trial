// the 拡大率 slider of the VR menus (かんたん menu and 表示 tab): the log position <-> scale maths and the layout coordinates (no overlaps)
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { scaleLimits, clampScale, scaleStep, SCALE_STEP, realHolderScale, realMagnification, scalePosOf, posToScale, magToPos, posToMag, viewTabScaleLayout, MAX_LONG_M, NORM_LONG, FALLBACK_MIN, FALLBACK_MAX } from '../../docs/vr-real-scale.js';
import { simpleMenuLayout, simpleMenuSegments, SIMPLE_MENU, triggerModeRow, sliderHitTest, sliderGrabOffset, sliderValueAt, sliderKnobX, KNOB_GRAB_PX, resultPaging } from '../../docs/event-mode.js';
import { MENU_CANVAS, MENU_WIDTH, MENU_OFFSET, menuHeightM, MENU_BOTTOM_DOWN, BOARD_DIST } from '../../docs/vr-layout.js';

const CAP = MAX_LONG_M / NORM_LONG;
const SIZES = [3, 5, 20, 25.6, 100, 250, 299, 300]; // longest side in mm (a few mm up to the 30 cm limit)

describe('拡大率 slider: position <-> scale (pure)', () => {
  it('left end = real size, right end = the upper limit (30 cm longest side), exactly', () => {
    for (const mm of SIZES.filter(m => m < 300)) {
      expect(posToScale(0, mm)).toBe(realHolderScale(mm));
      expect(posToScale(1, mm)).toBe(CAP);
      expect(posToMag(0, mm)).toBeCloseTo(1, 9);
      expect(posToMag(1, mm)).toBeCloseTo(MAX_LONG_M * 1000 / mm, 9);
      expect(scalePosOf(realHolderScale(mm), mm)).toBe(0);
      expect(scalePosOf(CAP, mm)).toBe(1);
    }
  });
  it('round trip position -> scale -> position (and magnification) agrees, and the scale grows with the position (log)', () => {
    for (const mm of SIZES.filter(m => m < 300)) {
      let prev = 0;
      for (let i = 0; i <= 20; i++) {
        const p = i / 20, s = posToScale(p, mm);
        expect(scalePosOf(s, mm)).toBeCloseTo(p, 9);
        expect(magToPos(posToMag(p, mm), mm)).toBeCloseTo(p, 9);
        expect(s).toBeGreaterThanOrEqual(prev); prev = s;
        const lim = scaleLimits(mm); expect(s).toBeGreaterThanOrEqual(lim.min); expect(s).toBeLessThanOrEqual(lim.max);
      }
      // log: the middle of the track is the geometric mean of the two ends
      const l = scaleLimits(mm); expect(posToScale(0.5, mm)).toBeCloseTo(Math.sqrt(l.min * l.max), 9);
    }
  });
  it('round trip scale -> position -> scale, and out-of-range scales are clamped to the ends', () => {
    for (const mm of [5, 25.6, 100]) {
      const l = scaleLimits(mm);
      for (const s of [l.min, l.min * 1.7, l.min * 6, l.max * 0.9, l.max].filter(v => v <= l.max)) expect(posToScale(scalePosOf(s, mm), mm)).toBeCloseTo(s, 9);
      expect(scalePosOf(l.min * 0.1, mm)).toBe(0); expect(scalePosOf(l.max * 10, mm)).toBe(1);
      expect(posToScale(-1, mm)).toBe(l.min); expect(posToScale(2, mm)).toBe(l.max); expect(posToScale(NaN, mm)).toBe(l.min);
      expect(clampScale(posToScale(0.37, mm), mm)).toBe(posToScale(0.37, mm));
    }
  });
  it('a tiny sample (a few mm) can be enlarged to the 30 cm cap and comes back to real size at the left end', () => {
    const mm = 4, s0 = realHolderScale(mm);
    expect(s0 * NORM_LONG * 1000).toBeCloseTo(4, 9); // real size: 4 mm on the longest side
    expect(posToScale(1, mm) * NORM_LONG).toBeCloseTo(0.30, 9); // 30 cm: x75
    expect(posToMag(1, mm)).toBeCloseTo(75, 9);
    expect(posToScale(0, mm)).toBe(s0);
  });
  it('locked data (longest side over 30 cm): no range, the locked scale whatever the position, knob at 0', () => {
    for (const mm of [301, 400, 1200]) {
      expect(scaleLimits(mm).locked).toBe(true);
      for (const p of [0, 0.3, 1]) expect(posToScale(p, mm)).toBe(CAP);
      expect(scalePosOf(CAP, mm)).toBe(0); expect(scalePosOf(0.5, mm)).toBe(0);
    }
  });
  it('unknown size: the old limits 0.025 .. 20 on the same log track, no magnification', () => {
    for (const mm of [0, NaN, undefined]) {
      expect(posToScale(0, mm)).toBe(FALLBACK_MIN); expect(posToScale(1, mm)).toBe(FALLBACK_MAX);
      for (let i = 0; i <= 10; i++) expect(scalePosOf(posToScale(i / 10, mm), mm)).toBeCloseTo(i / 10, 9);
      expect(posToMag(0.5, mm)).toBe(0); expect(magToPos(2, mm)).toBe(0);
    }
  });
  it('exactly 30 cm (real size = the cap): no range, the cap, knob at 0 (not locked, nothing breaks)', () => {
    expect(posToScale(0, 300)).toBe(CAP); expect(posToScale(1, 300)).toBe(CAP); expect(scalePosOf(CAP, 300)).toBe(0);
    expect(realMagnification(CAP, 300)).toBeCloseTo(1, 9);
  });
});

// ---- layout coordinates
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rect = x => ({ x: x.x, y: x.y, w: x.w, h: x.h });
const bundled = d => JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(new URL(`../../docs/demo/${d}/project.vrlab`, import.meta.url))))['project.json']));
const DEMOS = readdirSync(new URL('../../docs/demo', import.meta.url)).filter(d => existsSync(new URL(`../../docs/demo/${d}/project.vrlab`, import.meta.url)));
const SEG_ORDER = ['bone', 'soft', 'fat', 'lung', 'contrast'];
const measure = (text, size, bold) => [...String(text)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6) * size * (bold ? 1.08 : 1), 0);
const TEXT = ja => ({ show: ja ? '表示' : 'Show', hide: ja ? '非表示' : 'Hide', section: ja ? '断面' : 'Sections', sliceOpacity: ja ? 'スライス不透明度' : 'Slice opacity', scale: ja ? '拡大率' : 'Scale', trigger: ja ? 'トリガー' : 'Trigger', trigPoint: ja ? 'ポイントモード' : 'Point mode', trigLabel: ja ? '解析モード' : 'Analysis mode', trigHintPoint: 'h', trigHintLabel: 'h', results: ja ? '解析結果（体積）' : 'Analysis results (volume)', total: ja ? '合計' : 'Total', page: ja ? 'ページ' : 'Page', noSeg: 'none', home: ja ? '正面に戻す' : 'Bring to front', undo: ja ? '元に戻す' : 'Undo', reset: ja ? '最初の状態に戻す' : 'Back to the start', resetAgain: ja ? 'もう一度押すとリセット' : 'Press again to reset', all: ja ? 'すべての設定' : 'All settings', exit: ja ? 'VRを終了' : 'Exit VR' });
const LEVELS = { items: [1, 2, 3, 4].map(i => ({ id: 'l' + i, label: 'Lv' + i })), busy: false, hint: '', text: { title: 'Data', again: 'Again' } };
const boardFor = (demo, ja, scale, levels, page = 0) => {
  const p = demo ? bundled(demo) : { segments: {}, analysis: {} }, keys = simpleMenuSegments(SEG_ORDER.filter(k => p.segments?.[k]?.active));
  const regs = (p.analysis?.regions || []).map((r, i) => ({ hex: '#fff', name: `${i + 1}. ${keys[0] ?? ''}`, text: '123.45 mm³' }));
  return { regs, w: simpleMenuLayout({ segments: keys.map(k => ({ key: k, name: k, color: '#fff', on: true })), sectionOn: true, trigger: { show: regs.length > 0, label: false }, results: regs, total: '99.99 mm³', text: TEXT(ja), scale, page, ...(levels ? { levels } : {}) }) };
};

describe('かんたん menu: the 拡大率 row (coordinates)', () => {
  const SC = { pos: 0.5, text: '×12.3（実寸比）', locked: false };
  it('one row under the slice-opacity slider, with its name, the value text under the name, − / ＋ at the slider\'s ends; the ids are scale / scale:name / scale:text / scale:minus / scale:plus', () => {
    for (const ja of [true, false]) {
      const { w } = boardFor('sample2', ja, SC), so = w.find(x => x.id === 'sliceOpacity'), sc = w.find(x => x.id === 'scale'), mi = w.find(x => x.id === 'scale:minus'), pl = w.find(x => x.id === 'scale:plus');
      expect(sc.type).toBe('slider'); expect(sc.y).toBe(so.y + SIMPLE_MENU.ROW); expect(sc.value).toBe(0.5); expect(sc.disabled).toBeUndefined(); expect(sc.knob).toBe(KNOB_GRAB_PX);
      expect(w.find(x => x.id === 'scale:name').text).toBe(ja ? '拡大率' : 'Scale'); expect(w.find(x => x.id === 'scale:text').text).toBe(SC.text);
      expect([mi.label, pl.label]).toEqual(['−', '＋']); expect(mi.y).toBe(sc.y); expect(pl.y).toBe(sc.y); expect(mi.hold).toBe(true); expect(pl.hold).toBe(true);
      expect(mi.x + mi.w).toBeLessThan(sc.x - 26); expect(sc.x + sc.w + 26).toBeLessThan(pl.x); expect(pl.x + pl.w).toBeLessThanOrEqual(SIMPLE_MENU.W - SIMPLE_MENU.X);
      expect(w.filter(x => x.type === 'slider').length).toBe(2);
      expect(w.find(x => x.type === 'slider').id).toBe('sliceOpacity'); // the tutorial takes the first slider: still the slice opacity
    }
  });
  it('without o.scale the board is the one before (no scale row)', () => {
    const { w } = boardFor('sample2', true, undefined);
    expect(w.some(x => /^scale/.test(x.id || ''))).toBe(false);
  });
  it('locked: the slider is disabled and carries the given text', () => {
    const { w } = boardFor('sample2', true, { pos: 0, text: '実寸にできません（30cm超）', locked: true });
    expect(w.find(x => x.id === 'scale')).toMatchObject({ disabled: true }); expect(w.find(x => x.id === 'scale:text').text).toBe('実寸にできません（30cm超）');
    expect(w.find(x => x.id === 'scale:minus').disabled).toBe(true); expect(w.find(x => x.id === 'scale:plus').disabled).toBe(true);
  });
  it('the value is clamped to 0..1', () => {
    expect(boardFor('sample1', true, { pos: 3, text: '' }).w.find(x => x.id === 'scale').value).toBe(1);
    expect(boardFor('sample1', true, { pos: -3, text: '' }).w.find(x => x.id === 'scale').value).toBe(0);
  });
  for (const demo of [...DEMOS, null]) for (const ja of [true, false]) for (const lv of [false, true]) for (const locked of [false, true]) {
    it(`${demo ?? 'no data'} / ${ja ? 'ja' : 'en'} / ${lv ? 'with data switch row' : 'no data switch row'} / ${locked ? 'locked' : 'free'}: on every results page nothing overlaps, the bottom row stays at the board's lower edge, the texts fit, every result is reachable`, () => {
      const scale = locked ? { pos: 0, text: ja ? '実寸にできません（30cm超）' : 'No real size (over 30 cm)', locked } : SC, M = SIMPLE_MENU;
      const first = boardFor(demo, ja, scale, lv ? LEVELS : null), pages = first.w.some(x => x.id === 'results:page') ? +first.w.find(x => x.id === 'results:page').text.split('/')[1] : 1, seen = new Set();
      for (let pg = 0; pg < pages; pg++) {
        const { w, regs } = boardFor(demo, ja, scale, lv ? LEVELS : null, pg), bs = w.filter(x => x.type === 'button'), hits = w.filter(x => x.type === 'hit');
        for (const h of hits) { seen.add(h.target); expect(h.id).toBe(h.target + ':row'); }
        for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(overlap(rect(bs[i]), rect(bs[j])), `p${pg} ${bs[i].id} / ${bs[j].id}`).toBe(false);
        for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) expect(overlap(rect(hits[i]), rect(hits[j])), `p${pg} ${hits[i].id} / ${hits[j].id}`).toBe(false);
        for (const h of hits) for (const b of bs) if (b.id !== h.target) expect(overlap(rect(h), rect(b)), `p${pg} ${h.id} / ${b.id}`).toBe(false); // a row's own chip is the one thing inside it
        for (const b of bs) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(M.W); expect(b.y + b.h).toBeLessThanOrEqual(M.H); }
        for (const h of hits) { expect(h.x).toBeGreaterThanOrEqual(0); expect(h.x + h.w).toBeLessThanOrEqual(M.W); expect(h.y + h.h).toBeLessThanOrEqual(M.H); }
        const sc = w.find(x => x.id === 'scale'), home = bs.find(b => b.id === 'home'), bottom = home.y;
        expect(bottom).toBe(M.BOTTOM); expect(bottom + M.BTN_H).toBeLessThanOrEqual(M.H); expect(M.H - (bottom + M.BTN_H)).toBeLessThanOrEqual(30); // the bottom row stays at the lower edge
        expect(sc.y + sc.h).toBeLessThan(bottom);
        const knobBox = { x: sc.x - 26, y: sc.y, w: sc.w + 52, h: sc.h }; // the knob's reach beyond the track; the value text is no longer at the slider's right
        for (const x of w.filter(x => x.id !== 'scale' && (x.type === 'button' || x.type === 'slider'))) expect(overlap(knobBox, rect(x)), `scale / ${x.id}`).toBe(false);
        // every label (results list, total, pager text, level hint, row names) clear of the scale row and of the bottom row
        for (const x of w.filter(x => x.type === 'label' && !/^(scale|seg:\w+|section|sliceOpacity|trigger):(name|text)$/.test(x.id) && x.id !== 'trigger:hint')) {
          if (x.y < sc.y + sc.h) continue; // rows above
          expect(x.y, `label ${x.id} below the scale row`).toBeGreaterThan(sc.y + sc.h - 1);
          expect(x.y, `label ${x.id} above the bottom row`).toBeLessThan(bottom);
        }
        // the pager (only when the results do not fit one page): ◀ ▶ and the page text right of the total, inside the list's room
        const nx = w.find(x => x.id === 'results:next'), pv = w.find(x => x.id === 'results:prev'), pt = w.find(x => x.id === 'results:page'), tot = w.find(x => x.id === 'total');
        if (pages > 1) {
          expect(nx && pv && pt).toBeTruthy(); expect(pv.page).toBe(pg - 1); expect(nx.page).toBe(pg + 1); expect(!!pv.disabled).toBe(pg === 0); expect(!!nx.disabled).toBe(pg === pages - 1);
          expect(pt.text).toBe(`${ja ? 'ページ' : 'Page'} ${pg + 1}/${pages}`); expect(pt.x + measure(pt.text, pt.size, false)).toBeLessThanOrEqual(M.W - 20);
          expect(tot.x + measure(tot.text, tot.size, false)).toBeLessThan(pv.x); expect(tot.text).not.toContain('…');
          expect(pv.y + pv.h).toBeLessThanOrEqual((lv ? M.LEVEL_Y - M.ROW / 2 : M.BOTTOM)); expect(pv.y).toBeGreaterThan(Math.max(...hits.map(h => h.y + h.h)) - 1);
        } else { expect(nx || pv || pt).toBeFalsy(); expect(tot ? tot.text : '').not.toContain('…'); }
        const nm = w.find(x => x.id === 'scale:name'), tx = w.find(x => x.id === 'scale:text');
        expect(nm.x + measure(nm.text, 34, true)).toBeLessThanOrEqual(430);
        const mi = w.find(x => x.id === 'scale:minus'); expect(tx.x + measure(tx.text, tx.size, false)).toBeLessThanOrEqual(mi.x - 10); // the value text (24 px, under the name) ends before the − button, no shrink needed
        expect(tx.y).toBeGreaterThan(nm.y); expect(tx.y).toBeLessThan(sc.y + sc.h);
        expect(regs.length).toBeGreaterThanOrEqual(0);
      }
      const regsN = boardFor(demo, ja, scale, lv ? LEVELS : null).regs.length;
      expect(seen.size, 'every result is on some page').toBe(regsN);
      for (let i = 0; i < regsN; i++) expect(seen.has('result:' + i)).toBe(true);
    });
  }
  it('many results: 後足 (sample7: 34 results, no data switch row) pages 12 + 12 + 10; 2 and 4 results (sample1 / sample2) show no pager', () => {
    const rows = (demo, pg, lv) => boardFor(demo, true, SC, lv ? LEVELS : null, pg).w.filter(x => x.type === 'hit').map(x => +x.target.split(':')[1]);
    expect(rows('sample7', 0).length).toBe(12); expect(rows('sample7', 1).length).toBe(12); expect(rows('sample7', 2).length).toBe(10);
    expect([...rows('sample7', 0), ...rows('sample7', 1), ...rows('sample7', 2)]).toEqual(Array.from({ length: 34 }, (_, i) => i));
    expect(boardFor('sample7', true, SC, null, 0).w.find(x => x.id === 'results:page').text).toBe('ページ 1/3');
    for (const lv of [false, true]) for (const d of ['sample2', 'sample1']) {
      const { w, regs } = boardFor(d, true, SC, lv ? LEVELS : null); expect(w.filter(x => x.type === 'hit').length).toBe(regs.length); expect(w.some(x => x.id === 'results:next')).toBe(false);
    }
    expect(boardFor('sample2', true, SC, LEVELS).regs.length).toBe(4); // sample2: 4 results, 4 segments, with the data switch row: all four listed
  });
  it('the page is rounded into range (data switch, results added / removed): beyond the last page = the last, negative / NaN = the first', () => {
    for (const [n, cap] of [[34, 12], [5, 12], [0, 12], [13, 12], [24, 12], [34, 0]]) {
      for (const page of [-3, 0, 1, 2, 5, 99, NaN, undefined, 1.7]) {
        const r = resultPaging(n, page, cap);
        expect(r.page).toBeGreaterThanOrEqual(0); expect(r.page).toBeLessThan(r.pages); expect(r.start).toBeLessThanOrEqual(Math.max(0, n)); expect(r.start + r.count).toBeLessThanOrEqual(Math.max(n, 0));
        if (n > cap && cap > 0) { expect(r.pages).toBe(Math.ceil(n / cap)); expect(r.count).toBeGreaterThan(0); } else expect(r.pages).toBe(1);
      }
    }
    expect(resultPaging(34, 99, 12)).toMatchObject({ page: 2, start: 24, count: 10 }); expect(resultPaging(34, -1, 12)).toMatchObject({ page: 0, start: 0, count: 12 }); expect(resultPaging(12, 3, 12)).toMatchObject({ pages: 1, page: 0, count: 12 });
    // the layout itself: a stale page index (the data now has fewer results) draws the last page, not an empty one
    const w = boardFor('sample7', true, SC, null, 99).w; expect(w.find(x => x.id === 'results:page').text).toBe('ページ 3/3'); expect(w.filter(x => x.type === 'hit').length).toBe(10);
    expect(boardFor('sample1', true, SC, null, 7).w.filter(x => x.type === 'hit').length).toBe(2);
  });
  it('the whole result row is the hit area, its action target is the colour chip (same id as before: result:<i>)', () => {
    const { w } = boardFor('sample7', true, SC, null, 1);
    for (const h of w.filter(x => x.type === 'hit')) {
      const chip = w.find(x => x.id === h.target); expect(chip.type).toBe('button');
      expect(h.x).toBe(chip.x); expect(h.y).toBeLessThanOrEqual(chip.y); expect(h.y + h.h).toBeGreaterThanOrEqual(chip.y + chip.h);
      expect(h.w).toBe(SIMPLE_MENU.W - 2 * SIMPLE_MENU.X); // the name and the volume text are inside it
      for (const l of w.filter(x => x.type === 'label' && x.id.startsWith(h.target + ':'))) { expect(l.y).toBeGreaterThan(h.y); expect(l.y).toBeLessThan(h.y + h.h); }
    }
  });
});

describe('拡大率: − / ＋ steps and the knob-only grab (pure)', () => {
  const mm = 25.6, lim = scaleLimits(mm), s0 = realHolderScale(mm);
  it('one step multiplies by 1.1 or 1/1.1 (constant on the log track), every press the same ratio', () => {
    expect(SCALE_STEP).toBe(1.1);
    let s = s0 * 3;
    for (let i = 0; i < 12; i++) { const n = scaleStep(s, 1, mm); expect(n / s).toBeCloseTo(1.1, 9); s = n; }
    for (let i = 0; i < 12; i++) { const n = scaleStep(s, -1, mm); expect(s / n).toBeCloseTo(1.1, 9); s = n; }
    expect(s).toBeCloseTo(s0 * 3, 9); // + then − comes back
    expect(scalePosOf(scaleStep(s0 * 3, 1, mm), mm) - scalePosOf(s0 * 3, mm)).toBeCloseTo(Math.log(1.1) / Math.log(lim.max / lim.min), 9);
  });
  it('stops at both ends (real size / the 30 cm limit): further presses and holds change nothing, and a step that would pass the end lands exactly on it', () => {
    expect(scaleStep(lim.max, 1, mm)).toBe(lim.max); expect(scaleStep(lim.min, -1, mm)).toBe(lim.min);
    expect(scaleStep(lim.max / 1.05, 1, mm)).toBe(lim.max); expect(scaleStep(lim.min * 1.05, -1, mm)).toBe(lim.min);
    let s = lim.min; for (let i = 0; i < 200; i++) s = scaleStep(s, 1, mm); expect(s).toBe(lim.max);
    for (let i = 0; i < 200; i++) s = scaleStep(s, -1, mm); expect(s).toBe(lim.min);
  });
  it('locked data (over 30 cm) does not move; an unknown size uses the old limits', () => {
    const lk = scaleLimits(400); expect(lk.locked).toBe(true);
    expect(scaleStep(lk.max, 1, 400)).toBe(lk.max); expect(scaleStep(lk.max, -1, 400)).toBe(lk.max); expect(scaleStep(lk.max * 0.5, 1, 400)).toBe(lk.max); // (the holder is at the locked scale anyway)
    expect(scaleStep(0.05, 1, 0)).toBeCloseTo(0.055, 9); expect(scaleStep(FALLBACK_MAX, 1, 0)).toBe(FALLBACK_MAX); expect(scaleStep(FALLBACK_MIN, -1, undefined)).toBe(FALLBACK_MIN);
  });
  it('a hold repeats one 1.1 step per repeat of value-step.js (0.4 s, then every 0.1 s, whatever the repeat size), wired like the 693 buttons', () => {
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toContain('hold:()=>scaleNudge(dir)'); expect(src).toContain('else if(it.id===\'scale:minus\')w.push({...it,...scaleHold(-1)});'); expect(src).toContain('else if(it.id===\'scale:plus\')w.push({...it,...scaleHold(1)});');
    expect(src).toContain("btn(vs.minus.x,vs.minus.y,vs.minus.w,'−',false,scaleHold(-1).action,"); expect(src).toContain("btn(vs.plus.x,vs.plus.y,vs.plus.w,'＋',false,scaleHold(1).action,");
    expect(src).toContain('const scaleNudge=(dir,steps=1)=>{const lm=realLongMm();if(scaleLimits(lm).locked)return;const s=scaleStep(holder.scale.x,dir,lm,steps);');
  });
  const W = { x: 552, y: 100, w: 320, h: 72, value: 0.5, knob: KNOB_GRAB_PX }, kx = sliderKnobX(W), P = (x, y = 130) => ({ x, y });
  it('only a press near the knob (within KNOB_GRAB_PX either side) grabs the knob-only slider; the track elsewhere does nothing; rows above / below do not count', () => {
    expect(KNOB_GRAB_PX).toBe(40); expect(kx).toBe(552 + 160);
    expect(sliderHitTest(P(kx), W)).toBe(true); expect(sliderHitTest(P(kx - 40), W)).toBe(true); expect(sliderHitTest(P(kx + 40), W)).toBe(true);
    expect(sliderHitTest(P(kx - 41), W)).toBe(false); expect(sliderHitTest(P(kx + 41), W)).toBe(false);
    for (const x of [W.x, W.x + 40, W.x + 100, W.x + W.w, W.x - 20, W.x + W.w + 20]) expect(sliderHitTest(P(x), W), String(x)).toBe(false); // the ends and the middle of the track, away from the knob
    expect(sliderHitTest(P(kx, W.y - 1), W)).toBe(false); expect(sliderHitTest(P(kx, W.y + W.h + 1), W)).toBe(false);
    // the knob moves with the value: at 0 and at 1 the knob's own place is grabbed, the other end is not
    expect(sliderHitTest(P(W.x), { ...W, value: 0 })).toBe(true); expect(sliderHitTest(P(W.x + W.w), { ...W, value: 0 })).toBe(false); expect(sliderHitTest(P(W.x + W.w), { ...W, value: 1 })).toBe(true);
  });
  it('the other sliders are as before: a press anywhere on the track (and a knob radius beyond it) grabs, and the value is the pressed place', () => {
    const o = { x: 440, y: 100, w: 330, h: 72, value: 0.2 };
    for (const x of [414, 440, 600, 770, 796]) expect(sliderHitTest(P(x), o), String(x)).toBe(true);
    for (const x of [413, 797]) expect(sliderHitTest(P(x), o), String(x)).toBe(false);
    expect(sliderGrabOffset(600, o)).toBe(0); expect(sliderValueAt(605, o, 0)).toBeCloseTo((605 - 440) / 330, 9); expect(sliderValueAt(0, o)).toBe(0); expect(sliderValueAt(5000, o)).toBe(1);
  });
  it('the drag keeps the offset of the press from the knob\'s centre: no jump at the press, then it follows the laser, clamped to 0..1', () => {
    const px = kx + 30, off = sliderGrabOffset(px, W); expect(off).toBe(30);
    expect(sliderValueAt(px, W, off)).toBeCloseTo(W.value, 12); // the value at the press is the value it already had
    expect(sliderValueAt(px + 32, W, off)).toBeCloseTo(0.6, 9); // 32 px of 320 px
    expect(sliderValueAt(px - 160, W, off)).toBeCloseTo(0, 9); expect(sliderValueAt(-999, W, off)).toBe(0); expect(sliderValueAt(9999, W, off)).toBe(1);
    expect(sliderGrabOffset(kx - 25, W)).toBe(-25);
  });
  it('vr-view.js wiring: the menu uses these for the hit test and the drag; the press of a knob slider sets nothing; only the 拡大率 widgets carry knob', () => {
    const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
    expect(src).toContain("(w.type==='slider'?sliderHitTest(p,w):p.x>=w.x&&p.x<=w.x+w.w&&p.y>=w.y&&p.y<=w.y+w.h)");
    expect(src).toContain('w.set(sliderValueAt(at(uv).x,w,grabOff))');
    expect(src).toContain('if(!menu.beginDrag(i,h.uv))menu.drag(i,h.uv)');
    expect(src).toContain('knob:KNOB_GRAB_PX,set:scaleSlide');
    expect((src.match(/knob:/g) || []).length).toBe(1);
    const em = readFileSync(new URL('../../docs/event-mode.js', import.meta.url), 'utf8');
    expect((em.match(/knob:KNOB_GRAB_PX/g) || []).length).toBe(1); expect(em).toContain("id:'scale',x:552");
  });
});

describe('表示 tab: 拡大率 row beside the 実寸 button (coordinates)', () => {
  const MENU_W = MENU_CANVAS.W, MENU_H = MENU_CANVAS.H, X = 40, yb = MENU_H - 110, L = viewTabScaleLayout(yb, MENU_W, X);
  const R = (x, y, w, h) => ({ x, y, w, h });
  // the neighbours as vr-view.js draws them (4 segment rows end at 270 + 3 * 76 + 72; the histogram row: 230 + 130 + 130 buttons; choice rows span the board)
  const others = {
    segments: R(X, 270, MENU_W - 2 * X, 3 * 76 + 72), // (the board is 1400 px tall now: the rows below are anchored to the bottom row, the gap between is empty)
    hist: R(X, yb - 480, 230, 72), histLin: R(X + 242, yb - 480, 130, 72), histLog: R(X + 382, yb - 480, 130, 72),
    helpRow: R(X, yb - 400, MENU_W - 2 * X, 72), menuPos: R(X, yb - 240, MENU_W - 2 * X, 72), laser: R(X, yb - 160, MENU_W - 2 * X, 72), hand: R(X, yb - 80, MENU_W - 2 * X, 72), bottom: R(X, yb, MENU_W - 2 * X, 72),
  };
  const mine = { wheel: L.wheel, real: L.real, minus: L.minus, plus: L.plus, sliderBox: R(L.slider.x - 26, L.slider.y, L.slider.w + 52, L.slider.h), textBox: R(L.text.x, L.text.y - 14, L.text.maxW, 28), label: R(L.label.x, L.label.y - 18, 90, 36) };
  it('nothing of the 拡大率 row, the 実寸 button and the moved リング button overlaps any other element, all inside the board', () => {
    for (const [a, ra] of Object.entries(mine)) {
      expect(ra.x, a).toBeGreaterThanOrEqual(0); expect(ra.x + ra.w, a).toBeLessThanOrEqual(MENU_W); expect(ra.y + ra.h, a).toBeLessThanOrEqual(MENU_H);
      for (const [b, rb] of Object.entries(others)) expect(overlap(ra, rb), `${a} / ${b}`).toBe(false);
    }
    for (const [a, ra] of Object.entries(mine)) for (const [b, rb] of Object.entries(mine)) if (a < b) expect(overlap(ra, rb), `${a} / ${b}`).toBe(false);
  });
  it('the value text sits under the name and ends before the − button; − and ＋ sit at the slider\'s ends on its row, clear of the knob; the リング button sits right of the 対数 button on the histogram row; the 実寸 button ends at the board\'s right margin', () => {
    expect(L.text.x + L.text.maxW).toBeLessThan(L.minus.x); expect(L.text.y).toBeGreaterThan(L.label.y); expect(L.text.y).toBeLessThan(L.slider.y + L.slider.h);
    expect(L.minus.y).toBe(L.slider.y); expect(L.plus.y).toBe(L.slider.y); expect(L.minus.x + L.minus.w).toBeLessThan(L.slider.x - 26); expect(L.slider.x + L.slider.w + 26).toBeLessThan(L.plus.x);
    expect(L.plus.x + L.plus.w).toBeLessThan(L.real.x); expect(L.label.x + 90).toBeLessThan(L.minus.x);
    expect(L.wheel.y).toBe(others.hist.y); expect(L.wheel.x).toBeGreaterThan(others.histLog.x + others.histLog.w);
    expect(L.real.y).toBe(L.slider.y); expect(L.real.x + L.real.w).toBe(MENU_W - X);
  });
  it('the texts fit their room: the value text (24 px, shrinks to text.maxW) in both languages without shrinking, the locked note within a 1.5 shrink; the リング and 実寸 labels within their buttons', () => {
    expect(measure('×12.3（実寸比）', 24, false)).toBeLessThanOrEqual(L.text.maxW); expect(measure('×12.3 (real size)', 24, false)).toBeLessThanOrEqual(L.text.maxW);
    for (const t of ['実寸にできません（30cm超）', 'No real size (over 30 cm)']) expect(measure(t, 24, false)).toBeLessThanOrEqual(L.text.maxW * 1.5);
    for (const t of ['よく使う（リング）を設定', 'Set quick ring items']) expect(measure(t, 28, false)).toBeLessThanOrEqual((L.wheel.w - 8) * 1.25);
    for (const t of ['実寸（1倍）にする', 'Real size (×1)']) expect(measure(t, 28, false)).toBeLessThanOrEqual((L.real.w - 8) * 1.25);
    for (const t of ['実寸にできません（30cm超）', 'No real size (over 30 cm)']) expect(measure(t, 22, false)).toBeLessThanOrEqual((L.real.w - 8) * 1.25);
  });
});

describe('vr-view.js wiring of the 拡大率 slider (static)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  const line = re => src.split('\n').find(l => re.test(l)) || '';
  it('the slider sets the scale through clampScale / posToScale and re-bases a running two-hand pinch like the 実寸 button; it is neither saved nor written to the project', () => {
    const f = line(/const scaleSlide=/);
    expect(f).toContain('clampScale(posToScale(pos,lm),lm)');
    expect(f).toContain('twoHand.s0=s;twoHand.d0=Math.max(handDist(),1e-3)');
    expect(f).toContain('scaleLimits(lm).locked');
    expect(f).not.toMatch(/saveSettings|localStorage|emit\(/);
  });
  it('both menus use it: かんたん (id scale) and the 表示 tab; the knob, text and locked state come from scaleView (the holder scale now)', () => {
    expect(src).toContain("else if(it.id==='scale')w.push({...it,set:scaleSlide});");
    expect(src).toContain('knob:KNOB_GRAB_PX,set:scaleSlide,...(lk?{disabled:true}:{})');
    for (const t of ['scalePosOf(holder.scale.x,lm)', 'magnificationText(m,language)', 'L.realSizeNo', 'lim.locked']) expect(line(/const scaleView=/)).toContain(t);
    expect(src).toContain('scale:scaleView(),trigger:');
  });
  it('the menu follows scale changes made elsewhere (pinch, 実寸, 正面に戻す, data switch): redrawn when the holder scale / size changes, tabs 10 and 0 only', () => {
    expect(src).toContain("if(ui.open&&(ui.tab===10||ui.tab===0)){const k=holder.scale.x+'|'+lm+'|'+lim.locked");
  });
  it('the 実寸 button, the pinch and the start scale are untouched', () => {
    expect(src).toContain('const setRealSize=()=>{const s=realHolderScale(realLongMm());if(!s)return;holder.scale.setScalar(s);if(twoHand){twoHand.s0=s;twoHand.d0=Math.max(handDist(),1e-3)}};');
    expect(src).toContain('if(twoHand)holder.scale.setScalar(pinchScale(twoHand.s0,twoHand.d0,handDist(),realLongMm()));');
    expect(src).toContain('startHolderScale(realLongMm(),baseScale,vrInitialScaleOf(globalThis.__vrlOpenSample))');
  });
  it('the added texts are the label 拡大率 / Scale only (the locked text is the 実寸 button\'s)', () => {
    expect(src).toContain("scaleL:'拡大率',"); expect(src).toContain("scaleL:'Scale',");
  });
});
