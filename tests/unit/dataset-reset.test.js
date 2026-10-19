import { describe, it, expect } from 'vitest';
import { SEGMENT_STYLE_FIELDS, segmentPresetDefaults, resetSegmentStyles } from '../../docs/dataset-reset.js';

// the segment presets' own settings go back to the defaults for every segment the next dataset does not use
const preset = (color, extra = {}) => ({ active: false, enabled: false, color, opacity: 1, min: 0, max: 1, opening: 0, closing: 0, minComponent: 0, holeFill: false, surfaceMm: 0, thicknessMm: 0, material: 'standard', _maskCache: null, _maskCacheKey: '', ...extra });
const fresh = () => ({ bone: preset('#f3f0e8'), contrast: preset('#c026d3') });

describe('segment preset defaults', () => {
  it('keeps only the style fields, frozen, so later changes to the state do not move them', () => {
    const state = fresh(), d = segmentPresetDefaults(state);
    expect(Object.keys(d.bone).sort()).toEqual([...SEGMENT_STYLE_FIELDS].sort());
    expect(d.contrast).toEqual({ color: '#c026d3', opacity: 1, opening: 0, closing: 0, minComponent: 0, holeFill: false, surfaceMm: 0, thicknessMm: 0, material: 'standard' });
    state.contrast.color = '#00ff00';
    expect(d.contrast.color).toBe('#c026d3');
    expect(Object.isFrozen(d) && Object.isFrozen(d.bone)).toBe(true);
  });
  it('the real presets (segments.js) are not touched: min / max / active are not style fields', () => {
    for (const f of ['active', 'enabled', 'min', 'max', 'userMin', 'userMax']) expect(SEGMENT_STYLE_FIELDS).not.toContain(f);
  });
});

describe('resetSegmentStyles', () => {
  it('restores an inactive segment changed on the previous data and drops its mask cache', () => {
    const state = fresh(), d = segmentPresetDefaults(state);
    Object.assign(state.contrast, { color: '#00ff00', opacity: 0.5, opening: 2, closing: 1, minComponent: 30, holeFill: true, surfaceMm: 0.3, thicknessMm: 0.2, material: 'solid', _maskCache: new Uint8Array(4), _maskCacheKey: 'k' });
    expect(resetSegmentStyles(state, d)).toEqual(['contrast']);
    expect(state.contrast).toEqual(preset('#c026d3'));
  });
  it('leaves a segment in use alone (a series card switch keeps the segments in use and their settings), and its range in any case', () => {
    const state = fresh(), d = segmentPresetDefaults(state);
    Object.assign(state.bone, { active: true, enabled: true, color: '#ff3300', material: 'plaster', min: -600, max: 100 });
    Object.assign(state.contrast, { min: 300, max: 3000 });
    expect(resetSegmentStyles(state, d)).toEqual([]);
    expect(state.bone).toMatchObject({ active: true, color: '#ff3300', material: 'plaster', min: -600, max: 100 });
    expect(state.contrast).toMatchObject({ min: 300, max: 3000 });
  });
  it('reports nothing when nothing differs, and ignores keys without defaults', () => {
    const state = fresh(), d = segmentPresetDefaults(state);
    state.extra = preset('#123456', { color: '#654321' });
    expect(resetSegmentStyles(state, d)).toEqual([]);
    expect(state.extra.color).toBe('#654321');
    expect(resetSegmentStyles(state, null)).toEqual([]);
  });
});
