import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { GUIDE_SLIDES, LEVEL_SLIDES, SLIDE_W, SLIDE_H, SLIDE_BASE, slideSrc, slideItem, itemRect, createSlideImages } from '../../docs/tutorial-slides.js';

// the event deck's slides as pictures on the VR boards (docs/tutorial/slides/<id>.webp, rendered from the deck itself)
const dir = new URL('../../docs/tutorial/slides/', import.meta.url);
const ids = [...GUIDE_SLIDES, ...LEVEL_SLIDES].map(s => s.id);
// width / height of a lossy WebP (RIFF ... 'VP8 ' key frame header)
const webpSize = b => ({ fourcc: b.toString('ascii', 12, 16), w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff });

describe('the slide pictures (docs/tutorial/slides)', () => {
  it('one 1280 x 720 webp per slide, nothing else; small enough for the boards (< 1 MB in all)', () => {
    const files = readdirSync(dir).sort();
    expect(files).toEqual(ids.map(id => id + '.webp').sort());
    let total = 0;
    for (const f of files) {
      const b = readFileSync(new URL(f, dir)); total += b.length;
      expect(b.toString('ascii', 0, 4) + b.toString('ascii', 8, 12), f).toBe('RIFFWEBP');
      expect(webpSize(b), f).toEqual({ fourcc: 'VP8 ', w: 1280, h: 720 });
      expect(b.length, f).toBeLessThan(120 * 1024);
    }
    expect(total).toBeLessThan(1024 * 1024);
  });
  it('slideSrc: the folder + the same cache-busting query as the other assets (tools/bump-build.mjs)', () => {
    const q = readFileSync(new URL('../../docs/tutorial-audio.js', import.meta.url), 'utf8').match(/const AUDIO_QUERY = '([^']+)'/)[1];
    expect(slideSrc('g1')).toBe(`${SLIDE_BASE}g1.webp${q}`); expect(SLIDE_BASE).toBe('./tutorial/slides/');
    expect(slideSrc(null)).toBeNull(); expect(slideSrc('lv2', 'x/')).toBe(`x/lv2.webp${q}`);
  });
  it('the numbered rows: inside the slide, numbered 1..N from the top, not overlapping (they were measured on the rendered slide)', () => {
    for (const s of GUIDE_SLIDES) {
      expect(s.items.map(r => r.n), s.id).toEqual(s.items.map((_, i) => i + 1));
      s.items.forEach((r, i) => {
        expect(r.x, s.id).toBeGreaterThanOrEqual(0); expect(r.y, s.id).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, s.id).toBeLessThanOrEqual(SLIDE_W); expect(r.y + r.h, s.id).toBeLessThanOrEqual(SLIDE_H);
        expect(r.w, s.id).toBeGreaterThanOrEqual(60); expect(r.h, s.id).toBeGreaterThanOrEqual(60); // at least the 60 x 60 number badge
        if (i) expect(r.y, s.id).toBeGreaterThan(s.items[i - 1].y + s.items[i - 1].h);
      });
    }
    expect(slideItem('g2', 2)).toEqual({ n: 2, x: 1228, y: 378, w: 580, h: 139 }); expect(slideItem('g2', 9)).toBeNull(); expect(slideItem('nope', 1)).toBeNull();
  });
  it('itemRect: a row in slide pixels onto the picture as drawn on a board, widened by pad', () => {
    const r = { x: 100, y: 200, w: 300, h: 60 }, at = { x: 18, y: 52, w: 960, h: 540 }; // half size
    expect(itemRect(r, at, 0)).toEqual({ x: 68, y: 152, w: 150, h: 30 });
    expect(itemRect(r, at)).toEqual({ x: 63, y: 147, w: 160, h: 40 });
  });
  it('createSlideImages: loads on first use only, the element once loaded, onLoad once per picture, a failed one stays null', () => {
    const made = [], loads = [];
    const imgs = createSlideImages({ make: () => { const e = {}; made.push(e); return e; }, onLoad: id => loads.push(id) });
    expect(imgs.get(null)).toBeNull(); expect(made).toHaveLength(0);
    expect(imgs.get('g1')).toBeNull(); expect(imgs.get('g1')).toBeNull(); expect(made).toHaveLength(1);
    expect(made[0].src).toBe(slideSrc('g1')); expect(made[0].decoding).toBe('async');
    made[0].onload(); expect(imgs.get('g1')).toBe(made[0]); expect(imgs.loaded('g1')).toBe(true); expect(loads).toEqual(['g1']);
    imgs.get('lv3'); made[1].onerror(); expect(imgs.get('lv3')).toBeNull(); expect(made).toHaveLength(2); expect(imgs.loaded('lv3')).toBe(false);
    const none = createSlideImages({ make: () => null }); expect(none.get('g1')).toBeNull();
    const bad = createSlideImages({ make: () => { throw new Error('x'); } }); expect(bad.get('g1')).toBeNull();
    const cb = createSlideImages({ make: () => { const e = {}; made.push(e); return e; }, onLoad: () => { throw new Error('board'); } }); cb.get('g2'); expect(() => made.at(-1).onload()).not.toThrow(); expect(cb.get('g2')).toBe(made.at(-1));
  });
  it('pure: no fetch, no DOM lookups', () => {
    const src = readFileSync(new URL('../../docs/tutorial-slides.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bfetch\s*\(|document\.|XMLHttpRequest/);
  });
});
