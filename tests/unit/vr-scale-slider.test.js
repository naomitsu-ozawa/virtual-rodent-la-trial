// the 拡大率 slider of the VR menus (かんたん menu and 表示 tab): the log position <-> scale maths and the layout coordinates (no overlaps)
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { scaleLimits, clampScale, realHolderScale, realMagnification, scalePosOf, posToScale, magToPos, posToMag, viewTabScaleLayout, MAX_LONG_M, NORM_LONG, FALLBACK_MIN, FALLBACK_MAX } from '../../docs/vr-real-scale.js';
import { simpleMenuLayout, simpleMenuSegments, SIMPLE_MENU, triggerModeRow } from '../../docs/event-mode.js';

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
const TEXT = ja => ({ show: ja ? '表示' : 'Show', hide: ja ? '非表示' : 'Hide', section: ja ? '断面' : 'Sections', sliceOpacity: ja ? 'スライス不透明度' : 'Slice opacity', scale: ja ? '拡大率' : 'Scale', trigger: ja ? 'トリガー' : 'Trigger', trigPoint: ja ? 'ポイントモード' : 'Point mode', trigLabel: ja ? '解析モード' : 'Analysis mode', trigHintPoint: 'h', trigHintLabel: 'h', results: ja ? '解析結果（体積）' : 'Analysis results (volume)', total: ja ? '合計' : 'Total', noSeg: 'none', home: ja ? '正面に戻す' : 'Bring to front', undo: ja ? '元に戻す' : 'Undo', reset: ja ? '最初の状態に戻す' : 'Back to the start', resetAgain: ja ? 'もう一度押すとリセット' : 'Press again to reset', all: ja ? 'すべての設定' : 'All settings', exit: ja ? 'VRを終了' : 'Exit VR' });
const LEVELS = { items: [1, 2, 3, 4].map(i => ({ id: 'l' + i, label: 'Lv' + i })), busy: false, hint: '', text: { title: 'Data', again: 'Again' } };
const boardFor = (demo, ja, scale, levels) => {
  const p = demo ? bundled(demo) : { segments: {}, analysis: {} }, keys = simpleMenuSegments(SEG_ORDER.filter(k => p.segments?.[k]?.active));
  const regs = (p.analysis?.regions || []).map((r, i) => ({ hex: '#fff', name: `${i + 1}. ${keys[0] ?? ''}`, text: '123.45 mm³' }));
  return { regs, w: simpleMenuLayout({ segments: keys.map(k => ({ key: k, name: k, color: '#fff', on: true })), sectionOn: true, trigger: { show: regs.length > 0, label: false }, results: regs, total: '99.99 mm³', text: TEXT(ja), scale, ...(levels ? { levels } : {}) }) };
};

describe('かんたん menu: the 拡大率 row (coordinates)', () => {
  const SC = { pos: 0.5, text: '×12.3（実寸比）', locked: false };
  it('one row under the slice-opacity slider, with its name; the ids are scale / scale:name', () => {
    for (const ja of [true, false]) {
      const { w } = boardFor('sample2', ja, SC), so = w.find(x => x.id === 'sliceOpacity'), sc = w.find(x => x.id === 'scale');
      expect(sc.type).toBe('slider'); expect(sc.y).toBe(so.y + SIMPLE_MENU.ROW); expect(sc.value).toBe(0.5); expect(sc.text).toBe(SC.text); expect(sc.disabled).toBeUndefined();
      expect(w.find(x => x.id === 'scale:name').text).toBe(ja ? '拡大率' : 'Scale');
      expect(w.filter(x => x.type === 'slider').length).toBe(2);
    }
  });
  it('without o.scale the board is the one before (no scale row)', () => {
    const { w } = boardFor('sample2', true, undefined);
    expect(w.some(x => /^scale/.test(x.id || ''))).toBe(false);
  });
  it('locked: the slider is disabled and carries the given text', () => {
    const { w } = boardFor('sample2', true, { pos: 0, text: '実寸にできません（30cm超）', locked: true });
    expect(w.find(x => x.id === 'scale')).toMatchObject({ disabled: true, text: '実寸にできません（30cm超）' });
  });
  it('the value is clamped to 0..1', () => {
    expect(boardFor('sample1', true, { pos: 3, text: '' }).w.find(x => x.id === 'scale').value).toBe(1);
    expect(boardFor('sample1', true, { pos: -3, text: '' }).w.find(x => x.id === 'scale').value).toBe(0);
  });
  for (const demo of [...DEMOS, null]) for (const ja of [true, false]) for (const lv of [false, true]) for (const locked of [false, true]) {
    it(`${demo ?? 'no data'} / ${ja ? 'ja' : 'en'} / ${lv ? 'with data switch row' : 'no data switch row'} / ${locked ? 'locked' : 'free'}: nothing overlaps, the bottom row stays clear, the value text fits`, () => {
      const { w } = boardFor(demo, ja, locked ? { pos: 0, text: ja ? '実寸にできません（30cm超）' : 'No real size (over 30 cm)', locked } : SC, lv ? LEVELS : null);
      const bs = w.filter(x => x.type === 'button'), M = SIMPLE_MENU;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(overlap(rect(bs[i]), rect(bs[j])), `${bs[i].id} / ${bs[j].id}`).toBe(false);
      for (const b of bs) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(M.W); expect(b.y + b.h).toBeLessThanOrEqual(M.H); }
      const sc = w.find(x => x.id === 'scale'), bottom = Math.min(...bs.filter(b => b.id === 'home').map(b => b.y));
      const box = { x: sc.x - 26, y: sc.y, w: sc.w + 26 + (M.W - 24 - (sc.x + sc.w + 30)), h: sc.h }; // knob, track and the value text (up to x = W - 24)
      expect(sc.y + sc.h).toBeLessThan(bottom);
      expect(box.x + box.w).toBeLessThanOrEqual(M.W);
      for (const x of w.filter(x => x.id !== 'scale' && (x.type === 'button' || x.type === 'slider'))) expect(overlap(box, rect(x)), `scale / ${x.id}`).toBe(false);
      // every label (results list, total, level hint, row names) clear of the scale row and of the bottom row
      for (const x of w.filter(x => x.type === 'label' && !/^(scale|seg:\w+|section|sliceOpacity|trigger):name$/.test(x.id) && x.id !== 'trigger:hint')) {
        if (x.y < sc.y + sc.h) continue; // rows above
        expect(x.y, `label ${x.id} below the scale row`).toBeGreaterThan(sc.y + sc.h - 1);
        expect(x.y, `label ${x.id} above the bottom row`).toBeLessThan(bottom);
      }
      const nm = w.find(x => x.id === 'scale:name'); expect(nm.x + measure(nm.text, 34, true)).toBeLessThanOrEqual(430);
      // the value text shrinks to its room (makeMenu: maxWidth = W - 24 - text x): at most 40 % for the longest (locked) text
      const room = M.W - 24 - (sc.x + sc.w + 30); expect(measure(sc.text, 30, false) / room).toBeLessThanOrEqual(locked ? 1.7 : 1.15);
    });
  }
  it('result rows listed per sample (kept honest): the list is cut by the existing cap, never overlapping', () => {
    for (const demo of DEMOS) for (const lv of [false, true]) {
      const { w, regs } = boardFor(demo, true, SC, lv ? LEVELS : null);
      const listed = w.filter(x => /^result:\d+$/.test(x.id)).length;
      expect(listed).toBeLessThanOrEqual(regs.length);
      const tot = w.find(x => x.id === 'total');
      if (regs.length > listed) expect(tot.text).toContain(`(… +${regs.length - listed})`); else if (regs.length) expect(tot.text).not.toContain('…');
    }
  });
});

describe('表示 tab: 拡大率 row beside the 実寸 button (coordinates)', () => {
  const MENU_W = 1024, MENU_H = 1180, X = 40, yb = MENU_H - 110, L = viewTabScaleLayout(yb, MENU_W, X);
  const R = (x, y, w, h) => ({ x, y, w, h });
  // the neighbours as vr-view.js draws them (4 segment rows end at 270 + 3 * 76 + 72; the histogram row: 230 + 130 + 130 buttons; choice rows span the board)
  const others = {
    segments: R(X, 270, MENU_W - 2 * X, 3 * 76 + 72),
    hist: R(X, yb - 480, 230, 72), histLin: R(X + 242, yb - 480, 130, 72), histLog: R(X + 382, yb - 480, 130, 72),
    helpRow: R(X, yb - 400, MENU_W - 2 * X, 72), menuPos: R(X, yb - 240, MENU_W - 2 * X, 72), laser: R(X, yb - 160, MENU_W - 2 * X, 72), hand: R(X, yb - 80, MENU_W - 2 * X, 72), bottom: R(X, yb, MENU_W - 2 * X, 72),
  };
  const mine = { wheel: L.wheel, real: L.real, sliderBox: R(L.slider.x - 26, L.slider.y, L.slider.w + 26 + (L.slider.textMax + 30), L.slider.h), label: R(L.label.x, L.label.y - 18, 90, 36) };
  it('nothing of the 拡大率 row, the 実寸 button and the moved リング button overlaps any other element, all inside the board', () => {
    for (const [a, ra] of Object.entries(mine)) {
      expect(ra.x, a).toBeGreaterThanOrEqual(0); expect(ra.x + ra.w, a).toBeLessThanOrEqual(MENU_W); expect(ra.y + ra.h, a).toBeLessThanOrEqual(MENU_H);
      for (const [b, rb] of Object.entries(others)) expect(overlap(ra, rb), `${a} / ${b}`).toBe(false);
    }
    for (const [a, ra] of Object.entries(mine)) for (const [b, rb] of Object.entries(mine)) if (a < b) expect(overlap(ra, rb), `${a} / ${b}`).toBe(false);
  });
  it('the slider text room ends before the 実寸 button; the label ends before the knob; the リング button sits right of the 対数 button on the histogram row', () => {
    expect(L.slider.textX + L.slider.textMax).toBeLessThan(L.real.x);
    expect(L.label.x + 90).toBeLessThan(L.slider.x - 26);
    expect(L.wheel.y).toBe(others.hist.y); expect(L.wheel.x).toBeGreaterThan(others.histLog.x + others.histLog.w);
    expect(L.real.y).toBe(L.slider.y); expect(L.real.x + L.real.w).toBe(MENU_W - X);
  });
  it('the texts fit their room: 「×12.3（実寸比）」 within the shrink the canvas allows, the リング and 実寸 labels within their buttons', () => {
    expect(measure('×12.3（実寸比）', 30, false)).toBeLessThanOrEqual(L.slider.textMax * 1.0);
    expect(measure('×12.3 (real size)', 30, false)).toBeLessThanOrEqual(L.slider.textMax * 1.25);
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
    expect(src).toContain('set:scaleSlide,...(lk?{disabled:true}:{})');
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
