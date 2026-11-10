import { describe, it, expect } from 'vitest';
import { I18N } from '../../docs/i18n.js';
import {
  DOCK_MODES, DOCK_PLACES, DOCK_STORAGE_KEY, ANALYSIS_CARDS, defaultPlace, normalizeState, loadDockState, saveDockState,
  nextPlace, layoutKey, isDocked, clampSize, resizeBy, dockExtent, COLLAPSED_PX
} from '../../docs/analysis-dock-state.js';

const memStore = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };

describe('default placement', () => {
  it('3D overlays, split goes under the 2D column, 2D is beside the slices only on a wide landscape screen', () => {
    expect(defaultPlace('3d', { width: 1600, height: 900 })).toBe('overlay');
    expect(defaultPlace('split', { width: 1600, height: 900 })).toBe('under2d');
    expect(defaultPlace('2d', { width: 1600, height: 900 })).toBe('side');
    expect(defaultPlace('2d', { width: 1024, height: 768 })).toBe('below');
    expect(defaultPlace('2d', { width: 800, height: 1200 })).toBe('below');
    expect(defaultPlace('2d')).toBe('below');
  });
});

describe('layoutKey: only the overlay covers a view', () => {
  it('2D and split always take a grid track, never an overlay', () => {
    for (const m of ['2d', 'split']) for (const p of DOCK_PLACES[m]) { expect(isDocked(p)).toBe(true); expect(layoutKey(m, p, true)).toBe(m + '-' + p); }
    expect(DOCK_PLACES['2d']).not.toContain('overlay');
    expect(DOCK_PLACES.split).not.toContain('overlay');
  });
  it('3D overlay takes no track, pinned takes one; hidden dock takes none', () => {
    expect(layoutKey('3d', 'overlay', true)).toBeNull();
    expect(layoutKey('3d', 'below', true)).toBe('3d-below');
    expect(layoutKey('2d', 'below', false)).toBeNull();
    expect(layoutKey('2d', 'overlay', true)).toBeNull(); // not a 2D placement
  });
});

describe('state normalisation and persistence', () => {
  const vp = { width: 1400, height: 800 };
  it('fills every mode with valid defaults', () => {
    const s = normalizeState(null, vp);
    expect(Object.keys(s)).toEqual(DOCK_MODES);
    for (const m of DOCK_MODES) { expect(DOCK_PLACES[m]).toContain(s[m].place); expect(s[m].open).toBe(true); expect(s[m].w).toBeGreaterThan(0); expect(s[m].h).toBeGreaterThan(0); }
  });
  it('drops bad placements and sizes, keeps good ones', () => {
    const s = normalizeState({ '2d': { place: 'overlay', open: false, w: 'x', h: 5 }, split: { place: 'full', open: false, w: 500, h: 300 }, '3d': 7 }, vp);
    expect(s['2d'].place).toBe('side'); // overlay is not a 2D placement -> default
    expect(s['2d'].open).toBe(false);
    expect(s['2d'].h).toBeGreaterThanOrEqual(120); // 5 is raised to the minimum
    expect(s.split).toEqual({ open: false, place: 'full', w: 500, h: 300 });
    expect(s['3d'].place).toBe('overlay');
  });
  it('round-trips through a storage, per mode', () => {
    const store = memStore(), s = normalizeState(null, vp);
    s['2d'].place = 'below'; s['2d'].h = 321; s.split.open = false;
    expect(saveDockState(store, s)).toBe(true);
    expect(store.m[DOCK_STORAGE_KEY]).toBeTruthy();
    const back = loadDockState(store, vp);
    expect(back['2d'].place).toBe('below'); expect(back['2d'].h).toBe(321); expect(back.split.open).toBe(false); expect(back['3d'].open).toBe(true);
  });
  it('survives a broken, blocked or missing storage', () => {
    expect(loadDockState(memStore({ [DOCK_STORAGE_KEY]: '{not json' }), vp)['3d'].place).toBe('overlay');
    expect(loadDockState(null, vp).split.place).toBe('under2d');
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(loadDockState(blocked, vp)['2d'].place).toBe('side');
    expect(saveDockState(blocked, normalizeState(null, vp))).toBe(false);
    expect(saveDockState(null, normalizeState(null, vp))).toBe(false);
  });
});

describe('placement toggle and sizing', () => {
  it('cycles within the mode only', () => {
    expect(nextPlace('3d', 'overlay')).toBe('below'); expect(nextPlace('3d', 'below')).toBe('overlay');
    expect(nextPlace('2d', 'below')).toBe('side'); expect(nextPlace('2d', 'side')).toBe('below');
    expect(nextPlace('split', 'under2d')).toBe('full'); expect(nextPlace('split', 'full')).toBe('under2d');
  });
  it('clamps to the minimum and to a share of the room', () => {
    expect(clampSize('below', 10, 1000)).toBe(120);
    expect(clampSize('below', 9999, 1000)).toBe(700);
    expect(clampSize('side', 100, 1000)).toBe(280);
    expect(clampSize('side', 9999, 1000)).toBe(600);
    expect(clampSize('below', 300, 100)).toBe(120); // tiny area: the minimum wins
    expect(clampSize('below', NaN, 1000)).toBe(240);
  });
  it('resize drags grow the dock when its free edge moves away from the views', () => {
    expect(resizeBy('below', { w: 300, h: 200 }, 5, -40)).toEqual({ w: 300, h: 240 });
    expect(resizeBy('full', { w: 300, h: 200 }, 0, 30)).toEqual({ w: 300, h: 170 });
    expect(resizeBy('side', { w: 380, h: 200 }, -50, 10)).toEqual({ w: 430, h: 200 });
    expect(resizeBy('overlay', { w: 380, h: 300 }, 20, -20)).toEqual({ w: 400, h: 320 });
  });
  it('a collapsed dock is only its header', () => {
    expect(dockExtent({ place: 'below', open: false, w: 380, h: 240 })).toEqual({ w: 0, h: COLLAPSED_PX });
    expect(dockExtent({ place: 'below', open: true, w: 380, h: 240 })).toEqual({ w: 0, h: 240 });
    expect(dockExtent({ place: 'side', open: true, w: 380, h: 240 }).w).toBe(380);
    expect(dockExtent({ place: 'side', open: false, w: 380, h: 240 }).w).toBeLessThan(100);
  });
});

describe('cards and i18n', () => {
  it('lists the two result cards by DOM id (a VR panel can reuse the list)', () => {
    expect(ANALYSIS_CARDS.map(c => c.id)).toEqual(['hist', 'line']);
  });
  it('every dock label exists in ja and en', () => {
    const keys = ['dockTitle', 'dockCollapse', 'dockExpand', 'dockPin', 'dockUnpin', 'dockSide', 'dockBelow', 'dockUnder2d', 'dockFull', 'dockResize', ...ANALYSIS_CARDS.map(c => c.titleKey)];
    for (const lang of ['ja', 'en']) for (const k of keys) expect(I18N[lang][k], lang + ':' + k).toBeTruthy();
  });
});
