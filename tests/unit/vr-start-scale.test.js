import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lv0HolderScale, LV0_START_MAG, startHolderScale, realMagnification, clampScale, scaleLineText, magnificationText, NORM_LONG } from '../../docs/vr-real-scale.js';
import { createViewToggle } from '../../docs/vr-view-toggle.js';

// a VR / AR session starts at 1x (real size), AR and VR alike, and the AR passthrough <-> VR view toggle never changes the scale.
const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const DEFAULT_SCALE = 0.165 / NORM_LONG; // baseScale: the old 16.5 cm fit, used only when the physical size is unknown
const LONGEST = [2.4, 60.4, 75.8, 100, 300]; // synthetic test volume, practice mouse (sample2), practice rat (sample1), a 10 cm and a 30 cm animal

// what vr-view.js does for the holder scale: placement (bringVolumeFront), then the per-frame clamp; the toggle is the only thing that runs afterwards
function session(isAr, longMm) {
  const vt = createViewToggle(isAr);
  let s = startHolderScale(longMm, DEFAULT_SCALE); // placement at the first pose
  const frame = () => { if (longMm > 0) { const c = clampScale(s, longMm); if (c !== s) s = c; } };
  frame();
  return { vt, scale: () => s, frame, mag: () => realMagnification(s, longMm) };
}

describe('session start scale is 1x for AR and VR', () => {
  for (const isAr of [true, false]) {
    it((isAr ? 'AR' : 'VR') + ': real-size magnification is exactly 1 at the start for every data size, and the tag / detail line read x1', () => {
      for (const L of LONGEST) {
        const s = session(isAr, L);
        expect(s.mag()).toBeCloseTo(1, 10);
        expect(magnificationText(s.mag(), 'ja')).toBe('×1（実寸比）');
        expect(scaleLineText(s.scale(), L, 'ja')).toBe('×1（実寸比）');
        expect(scaleLineText(s.scale(), L, 'en')).toBe('×1 (real size)');
      }
    });
  }
  it('the fallback (0.05, 16.5 cm) is used only when the physical size is unknown', () => {
    expect(startHolderScale(0, DEFAULT_SCALE)).toBe(DEFAULT_SCALE);
    for (const L of LONGEST) expect(startHolderScale(L, DEFAULT_SCALE)).not.toBe(DEFAULT_SCALE);
  });
  it('the scale is not changed by the per-frame clamp after the start', () => {
    for (const L of LONGEST) { const s = session(true, L), a = s.scale(); s.frame(); s.frame(); expect(s.scale()).toBe(a); }
  });
});

describe('the AR view toggle leaves the scale alone', () => {
  it('toggling any number of times keeps the scale (and so x1) exactly', () => {
    for (const L of LONGEST) {
      const s = session(true, L), a = s.scale();
      for (let i = 0; i < 5; i++) { s.vt.toggle(); s.frame(); expect(s.scale()).toBe(a); expect(s.mag()).toBeCloseTo(1, 10); }
    }
  });
  it('vr-view.js: applyView / toggleView never touch the holder or its scale, and do not place the volume again', () => {
    const a = src.indexOf('const vt=createViewToggle(ar)'), b = src.indexOf('\n', a);
    const c = src.indexOf('const toggleView='), d = src.indexOf('\n', c);
    for (const part of [src.slice(a, b), src.slice(c, d)]) {
      expect(part.length).toBeGreaterThan(40);
      for (const w of ['holder', 'scale', 'setScalar', 'bringVolumeFront', 'twoHand']) expect(part.includes(w), w).toBe(false);
    }
  });
  it('vr-view.js: the start places the volume with startHolderScale (real size), AR and VR through the same line', () => {
    const e = src.indexOf('const bringVolumeFront=');
    const fn = src.slice(e, src.indexOf('// grab: one hand', e)); // the function has two lines now (the tutorial's own placement is the first branch of a ternary)
    expect(fn).toContain('holder.scale.setScalar(tut?tutorialHolderScale(realLongMm()):globalThis.__vrlOpenSample===TUT_SAMPLE?lv0HolderScale(realLongMm(),baseScale):startHolderScale(realLongMm(),baseScale))');
    expect(src).not.toMatch(/holder\.scale\.setScalar\([^)]*\bar\b/); // no AR-specific scale
  });
});

describe('detail tab scale line', () => {
  it('shows the real-size magnification, not the raw holder scale (x0.02 at real size looked like "not 1x")', () => {
    const real = 60.4 / 1000 / NORM_LONG; // holder scale of the practice mouse at real size
    expect(real.toFixed(2)).toBe('0.02'); // what the line used to print
    expect(scaleLineText(real, 60.4, 'ja')).toBe('×1（実寸比）');
    expect(scaleLineText(real * 2, 60.4, 'ja')).toBe('×2（実寸比）');
  });
  it('falls back to the raw holder scale only when the physical size is unknown', () => {
    expect(scaleLineText(0.05, 0, 'ja')).toBe('×0.05');
  });
  it('vr-view.js builds the line with scaleLineText and no longer prints holder.scale.x directly', () => {
    const e = src.indexOf('ui.sizeLine=');
    const line = src.slice(e, src.indexOf('\n', e));
    expect(line).toContain('scaleLineText(holder.scale.x,realLongMm(),language)');
    expect(line).not.toContain("'×'+holder.scale.x");
  });
});

describe('Lv0 (the practice bone, sample4) starts at x4, every other data at x1', () => {
  it('the Lv0 start reads x4（実寸比） and is 4 x the real size; the physical size is 2.56 cm so 10.2 cm', () => {
    const L = 25.6, s = lv0HolderScale(L, DEFAULT_SCALE);
    expect(LV0_START_MAG).toBe(4);
    expect(realMagnification(s, L)).toBeCloseTo(4, 10);
    expect(magnificationText(realMagnification(s, L), 'ja')).toBe('×4（実寸比）');
    expect(scaleLineText(s, L, 'ja')).toBe('×4（実寸比）');
    expect(scaleLineText(s, L, 'en')).toBe('×4 (real size)');
    expect(NORM_LONG * s).toBeCloseTo(0.1024, 6);
  });
  it('the other data keep x1 (startHolderScale), and the per-frame clamp leaves the x4 start alone', () => {
    for (const L of LONGEST) expect(realMagnification(startHolderScale(L, DEFAULT_SCALE), L)).toBeCloseTo(1, 10);
    const s = lv0HolderScale(25.6, DEFAULT_SCALE); expect(clampScale(s, 25.6)).toBe(s);
  });
  it('unknown physical size and oversize data fall back as every other start does', () => {
    expect(lv0HolderScale(0, DEFAULT_SCALE)).toBe(startHolderScale(0, DEFAULT_SCALE));
    expect(lv0HolderScale(500, DEFAULT_SCALE)).toBe(startHolderScale(500, DEFAULT_SCALE));
  });
  it('vr-view.js: only the practice bone (the open sample is TUT_SAMPLE) takes the x4 start', () => {
    expect(src).toContain('globalThis.__vrlOpenSample===TUT_SAMPLE?lv0HolderScale(');
  });
});
