import { describe, it, expect } from 'vitest';
import { physicalExtentsMm, longestMm, realMagnification, realHolderScale, formatMagnification, magnificationText, NORM_LONG, scaleLimits, clampScale, pinchScale, isOversize, oversizeNote, sizeWarningHtml, startHolderScale } from '../../docs/vr-real-scale.js';

const DEFAULT_SCALE = 0.165 / NORM_LONG; // the initial display: longest side 16.5 cm
// synthetic mouse-like micro-CT: 400 x 200 x 500 voxels at 0.2 x 0.2 x 0.2 mm -> 80 x 40 x 100 mm
const mouse = { dims: { columns: 400, rows: 200, slices: 500 }, sp: [0.2, 0.2, 0.2] };

describe('vr-real-scale', () => {
  it('physical extent = dims x spacing, with anisotropic spacing', () => {
    expect(physicalExtentsMm(mouse.dims, mouse.sp)).toEqual([80, 40, 100]);
    // thick slices decide the longest side: 100 x 100 x 40 slices x 3 mm = 120 mm
    const e = physicalExtentsMm({ columns: 100, rows: 100, slices: 40 }, { x: 0.5, y: 0.5, z: 3 });
    expect(e).toEqual([50, 50, 120]);
    expect(longestMm(e)).toBe(120);
    expect(physicalExtentsMm(null, mouse.sp)).toBeNull();
    expect(physicalExtentsMm(mouse.dims, [0.2, 0.2, 0])).toBeNull();
  });
  it('the initial 16.5 cm display against real size', () => {
    expect(realMagnification(DEFAULT_SCALE, 100)).toBeCloseTo(1.65, 10);
    expect(realMagnification(DEFAULT_SCALE, 330)).toBeCloseTo(0.5, 10);
  });
  it('1x reset: scale for real size shows exactly 1 for any size and spacing', () => {
    for (const L of [30, 100, 120, 300]) {
      const s = realHolderScale(L);
      expect(realMagnification(s, L)).toBeCloseTo(1, 10);
    }
    expect(realHolderScale(0)).toBeNull();
    expect(realHolderScale(450)).toBeNull(); // over 30 cm: no real-size display
  });
  it('two-hand scaling multiplies the value by the hand-distance ratio (inside the limits)', () => {
    const L = 50, s0 = realHolderScale(L) * 2; // shown at 2x
    expect(realMagnification(pinchScale(s0, 0.3, 0.6, L), L)).toBeCloseTo(4, 10);
    expect(realMagnification(pinchScale(s0, 0.3, 0.15, L), L)).toBeCloseTo(1, 10); // 0.5x of 2x = exactly the 1x floor
    expect(realMagnification(pinchScale(s0, 0.3, 0.05, L), L)).toBeCloseTo(1, 10); // below: stops at 1x
  });
  it('formatting: 2 significant digits, one decimal from 10', () => {
    expect(formatMagnification(0.8)).toBe('0.8');
    expect(formatMagnification(0.8123)).toBe('0.81');
    expect(formatMagnification(1.66)).toBe('1.7'); // 1.66
    expect(formatMagnification(1.0004)).toBe('1');
    expect(formatMagnification(9.4)).toBe('9.4');
    expect(formatMagnification(12.34)).toBe('12.3');
    expect(formatMagnification(0)).toBe('');
    expect(magnificationText(0.8, 'ja')).toBe('×0.8（実寸比）');
    expect(magnificationText(1, 'en')).toBe('×1 (real size)');
  });

  it('limits: 1x .. 0.30 m; a 3 cm specimen is 1x = 3 cm up to 10x', () => {
    const l = scaleLimits(30);
    expect(displayed(l.min)).toBeCloseTo(0.03, 10);
    expect(displayed(l.max)).toBeCloseTo(0.30, 10);
    expect(realMagnification(l.max, 30)).toBeCloseTo(10, 10);
    expect(l.locked).toBe(false);
  });
  it('limits with anisotropic spacing use the longest physical side', () => {
    const L = longestMm(physicalExtentsMm({ columns: 100, rows: 100, slices: 40 }, { x: 0.5, y: 0.5, z: 3 })); // 120 mm
    const l = scaleLimits(L);
    expect(displayed(l.min)).toBeCloseTo(0.12, 10);
    expect(clampScale(0.001, L)).toBeCloseTo(l.min, 12);
  });
  it('the default 16.5 cm start respects the minimum (a 20 cm specimen starts at 1x)', () => {
    expect(displayed(clampScale(DEFAULT_SCALE, 200))).toBeCloseTo(0.2, 10);
    expect(displayed(clampScale(DEFAULT_SCALE, 100))).toBeCloseTo(0.165, 10);
  });
  it('pinch beyond the limits stops at them and resumes from the grab value (no drift)', () => {
    const L = 100, s0 = DEFAULT_SCALE, lim = scaleLimits(L);
    expect(pinchScale(s0, 0.3, 3, L)).toBe(lim.max);
    expect(pinchScale(s0, 0.3, 0.001, L)).toBeCloseTo(lim.min, 12);
    expect(pinchScale(s0, 0.3, 0.3, L)).toBeCloseTo(s0, 12);
    expect(pinchScale(s0, 0.3, 0.33, L)).toBeCloseTo(s0 * 1.1, 12);
  });
  it('over 30 cm: fitted to 0.30 m, scale locked, indicator below 1x', () => {
    const L = 700;
    expect(isOversize(L)).toBe(true);
    expect(isOversize(300)).toBe(false);
    const l = scaleLimits(L);
    expect(l.locked).toBe(true);
    expect(displayed(l.max)).toBeCloseTo(0.30, 10);
    expect(clampScale(DEFAULT_SCALE, L)).toBeCloseTo(l.max, 12);
    expect(pinchScale(0.05, 0.3, 0.9, L)).toBe(l.max);
    expect(pinchScale(0.05, 0.3, 0.1, L)).toBe(l.max);
    const m = realMagnification(l.max, L);
    expect(m).toBeCloseTo(300 / 700, 10);
    expect(magnificationText(m, 'ja')).toBe('×0.43（実寸比）');
  });
  it('the warning appears only for over 30 cm', () => {
    expect(oversizeNote(300, 'ja')).toBeNull();
    expect(oversizeNote(300.5, 'ja')).toContain('30cmを超える');
    expect(oversizeNote(500, 'en')).toContain('30 cm');
    const esc = x => x;
    expect(sizeWarningHtml({ columns: 512, rows: 512, slices: { length: 100 }, spacingX: 1, spacingY: 1, spacingZ: 1 }, 'ja', esc)).toContain('size-warn');
    expect(sizeWarningHtml({ columns: 400, rows: 200, slices: { length: 500 }, spacingX: 0.2, spacingY: 0.2, spacingZ: 0.2 }, 'ja', esc)).toBe('');
    expect(sizeWarningHtml(null, 'ja', esc)).toBe('');
  });
});
const displayed = s => s * NORM_LONG;

// build 490: the section frame (a child of the holder) keeps its world size above the default 16.5 cm display
import { FRAME_REF_SCALE, FRAME_SQUARE_MAX, frameWorldScale, frameSquareWorldScale, planeFrameLocalScale, planeTagLocalScale } from '../../docs/vr-real-scale.js';
describe('section frame size cap', () => {
  const HALF = 0.12, HANDLE = 0.034, GLOW = 0.0015; // design sizes in vr-view.js (frame half side, number tag, glow half width), metres at the default display
  const squareWorld = (holderScale, v) => v * holderScale * planeFrameLocalScale(holderScale); // square / glow: local size x holder scale x frame local scale
  const tagWorld = (holderScale, v) => squareWorld(holderScale, v) * planeTagLocalScale(holderScale); // tag: also x its own scale inside the frame group
  it('the reference is the default 16.5 cm display; the square cap is 1.5x', () => {
    expect(FRAME_REF_SCALE).toBeCloseTo(0.165 / NORM_LONG, 12);
    expect(FRAME_SQUARE_MAX).toBe(1.5);
    expect(frameWorldScale(DEFAULT_SCALE)).toBeCloseTo(1, 12);
    expect(frameSquareWorldScale(DEFAULT_SCALE)).toBeCloseTo(1, 12);
  });
  it('square and glow never exceed 1.5x, the tag never exceeds 1x, from 1x to 30 cm', () => {
    for (let longCm = 3; longCm <= 30; longCm += 0.5) {
      const s = longCm / 100 / NORM_LONG;
      expect(squareWorld(s, HALF)).toBeLessThanOrEqual(HALF * 1.5 + 1e-12);
      expect(squareWorld(s, GLOW)).toBeLessThanOrEqual(GLOW * 1.5 + 1e-12);
      expect(tagWorld(s, HANDLE)).toBeLessThanOrEqual(HANDLE + 1e-12);
      expect(planeTagLocalScale(s)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
  it('at 30 cm the frame edge is 36 cm (margin around the volume), the tag stays 3.4 cm', () => {
    const s30 = 0.30 / NORM_LONG;
    expect(2 * squareWorld(s30, HALF)).toBeCloseTo(0.36, 12);
    expect(2 * squareWorld(s30, HALF)).toBeGreaterThanOrEqual(0.30 * 1.2 - 1e-12);
    expect(tagWorld(s30, HANDLE)).toBeCloseTo(0.034, 12);
    expect(squareWorld(s30, GLOW)).toBeCloseTo(GLOW * 1.5, 12);
    expect(s30 / DEFAULT_SCALE).toBeGreaterThan(1.8); // the pre-490 growth factor (44 cm edge)
  });
  it('at the default 16.5 cm display the frame is the design size (24 cm edge, 3.4 cm tag)', () => {
    expect(2 * squareWorld(DEFAULT_SCALE, HALF)).toBeCloseTo(0.24, 12);
    expect(tagWorld(DEFAULT_SCALE, HANDLE)).toBeCloseTo(0.034, 12);
    expect(planeTagLocalScale(DEFAULT_SCALE)).toBeCloseTo(1, 12);
  });
  it('below the default display it still follows the volume exactly as before (a small mouse at 1x)', () => {
    const s = realHolderScale(mouse.dims ? longestMm(physicalExtentsMm(mouse.dims, mouse.sp)) : 0);
    expect(s).toBeLessThan(DEFAULT_SCALE);
    expect(squareWorld(s, HALF)).toBeCloseTo(HALF * s / DEFAULT_SCALE, 12);
    expect(tagWorld(s, HANDLE)).toBeCloseTo(HANDLE * s / DEFAULT_SCALE, 12);
    expect(frameWorldScale(s)).toBeCloseTo(s / DEFAULT_SCALE, 12);
    expect(planeTagLocalScale(s)).toBeCloseTo(1, 12);
    for (let t = 0.005; t <= FRAME_REF_SCALE; t += 0.001) expect(planeFrameLocalScale(t)).toBeCloseTo(1 / FRAME_REF_SCALE, 9); // same as the build 490 value 1/max(s, ref)
  });
  it('is monotone and continuous at both caps', () => {
    let prev = 0, prevTag = 0;
    for (let s = 0.005; s <= 0.0909; s += 0.001) {
      const w = squareWorld(s, HALF), t = tagWorld(s, HANDLE);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12); prev = w;
      expect(t).toBeGreaterThanOrEqual(prevTag - 1e-12); prevTag = t;
    }
    const edge = FRAME_REF_SCALE * FRAME_SQUARE_MAX; // holder scale where the square cap starts
    expect(squareWorld(edge * 0.999999, HALF)).toBeCloseTo(squareWorld(edge * 1.000001, HALF), 5);
    expect(planeTagLocalScale(FRAME_REF_SCALE * 0.999999)).toBeCloseTo(planeTagLocalScale(FRAME_REF_SCALE * 1.000001), 5);
  });
});


describe('startHolderScale (VR / AR start = 1x)', () => {
  it('75 mm cube starts at real size (magnification 1)', () => {
    const s = startHolderScale(75, DEFAULT_SCALE);
    expect(realMagnification(s, 75)).toBeCloseTo(1, 9);
    expect(s * NORM_LONG).toBeCloseTo(0.075, 9);
  });
  it('300 mm data starts at real size, which is also the 0.30 m cap', () => {
    expect(realMagnification(startHolderScale(300, DEFAULT_SCALE), 300)).toBeCloseTo(1, 9);
  });
  it('over 30 cm: fitted to 0.30 m and locked', () => {
    const s = startHolderScale(1800, DEFAULT_SCALE);
    expect(s * NORM_LONG).toBeCloseTo(0.30, 9);
    expect(scaleLimits(1800).locked).toBe(true);
    expect(clampScale(s, 1800)).toBe(s);
  });
  it('unknown physical size keeps the old default fit', () => {
    expect(startHolderScale(0, DEFAULT_SCALE)).toBeCloseTo(DEFAULT_SCALE, 12);
    expect(startHolderScale(NaN, DEFAULT_SCALE)).toBeCloseTo(DEFAULT_SCALE, 12);
  });
});
