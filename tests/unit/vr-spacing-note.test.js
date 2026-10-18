import { describe, it, expect } from 'vitest';
import { vrSpacingNote, vrVolumeText, wrapText } from '../../docs/vr-spacing-note.js';

// synthetic checks only
const warn = { warn: true, info: false, used: 1.5, missing: 2, medianGap: 1.5, basis: 'fit', method: 'positions' };
const info = { warn: false, info: true, used: 1, method: 'none' };

describe('vrSpacingNote', () => {
  it('no check / clean check / info-only -> null (no behaviour change)', () => {
    expect(vrSpacingNote(null, 'ja')).toBeNull();
    expect(vrSpacingNote(undefined, 'en')).toBeNull();
    expect(vrSpacingNote({ warn: false, info: false, used: 1 }, 'ja')).toBeNull();
    expect(vrSpacingNote(info, 'ja')).toBeNull();
  });
  it('warn-level -> mark, short line and wrapped detail in Japanese', () => {
    const n = vrSpacingNote(warn, 'ja');
    expect(n.mark).toBe('⚠');
    expect(n.short).toBe('スライス間隔に問題：体積は近似');
    expect(n.lines.length).toBeGreaterThan(0);
    expect(n.lines.length).toBeLessThanOrEqual(3);
    expect(n.lines.join('')).toContain('抜け 2 枚');
  });
  it('switches with the language', () => {
    const n = vrSpacingNote(warn, 'en');
    expect(n.short).toMatch(/approximate/);
    expect(n.lines.join(' ')).toContain('2 missing');
    expect(n.lines.join(' ')).not.toMatch(/抜け/);
  });
});

describe('vrVolumeText', () => {
  it('plain without a warning, marked with one', () => {
    expect(vrVolumeText(12.345, null)).toBe('12.35 mm³');
    expect(vrVolumeText(12.345, vrSpacingNote(warn, 'ja'))).toBe('⚠ 12.35 mm³');
  });
});

describe('wrapText', () => {
  it('wraps, caps the line count and ends with an ellipsis', () => {
    const r = wrapText('aaa bbb ccc ddd eee fff', 7, 2);
    expect(r.length).toBe(2);
    expect(r[1].endsWith('…')).toBe(true);
    expect(wrapText('short', 10, 3)).toEqual(['short']);
  });
});
