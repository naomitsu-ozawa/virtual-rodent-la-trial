import { describe, it, expect } from 'vitest';
import { wrapMenuText, stackMenuRows } from '../../docs/vr-menu-text.js';

// build 528/529: the 詳細 tab's long lines wrap at ' · ' and the rows are stacked above the first button row
const measure = t => t.length * 16; // 16 px per character
describe('wrapMenuText', () => {
  it('keeps a short line whole', () => { expect(wrapMenuText('72 fps · JS 1.1 ms', 944, measure)).toEqual(['72 fps · JS 1.1 ms']); });
  it('wraps a long line at its separators', () => {
    const line = '縮小描画 50% 1032×1104 / XR 2064×2208 (2眼) · ×0.05 · 16.5 cm (1.00×) · 256×256×256 フィルター適用 · データ 256 · 表示セグメント 4';
    const lines = wrapMenuText(line, 944, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(944);
    expect(lines.join(' · ')).toBe(line);
  });
  it('splits a single part wider than the width by characters', () => {
    const lines = wrapMenuText('x'.repeat(100), 160, measure);
    expect(lines).toEqual(Array(10).fill('x'.repeat(10)));
  });
});
describe('stackMenuRows', () => {
  it('stacks rows from the top with a gap and no scaling while they fit', () => {
    const { ys, scale } = stackMenuRows([{ n: 1, lh: 30 }, { n: 2, lh: 28 }, { n: 1, lh: 25 }], 280, 462);
    expect(scale).toBe(1); expect(ys).toEqual([280, 316, 378]);
  });
  it('scales the block down so that long wrapped rows still end above the bottom', () => {
    const rows = [{ n: 2, lh: 30 }, { n: 3, lh: 28 }, { n: 2, lh: 25 }, { n: 2, lh: 25 }, { n: 2, lh: 25 }];
    const { ys, scale } = stackMenuRows(rows, 280, 462);
    expect(scale).toBeLessThan(1); expect(scale).toBeGreaterThanOrEqual(0.5);
    const end = ys[4] + rows[4].n * rows[4].lh * scale;
    expect(end).toBeLessThanOrEqual(462 + 1);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });
});
