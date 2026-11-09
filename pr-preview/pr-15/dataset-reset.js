// what a newly opened dataset must not inherit from the previous one (the practice data switched without a page reload, another
// series card). The reset itself runs in ONE place, data-load.js resetDatasetState, at the start of selectSeries: before the volume is configured
// and before the new data's project (a bundled project.vrlab) is applied, so whatever that project sets wins. These are its pure parts (no DOM,
// no app state; unit-tested in tests/unit/dataset-reset.test.js).
// A segment preset's own settings (colour, opacity, post-processing, thin-region suppression, material). min / max are not here: configureSegments
// derives them from the new volume's HU range. active / enabled are not here either: a new load turns every segment off (app.js resetVolume), a
// series card switch keeps the segments in use (and their settings) as before.
export const SEGMENT_STYLE_FIELDS = ['color', 'opacity', 'opening', 'closing', 'minComponent', 'holeFill', 'surfaceMm', 'thicknessMm', 'material'];

// the preset defaults, taken from the initial segmentState (segments.js) before anything changed it
export function segmentPresetDefaults(state) {
  return Object.freeze(Object.fromEntries(Object.entries(state).map(([key, s]) => [key, Object.freeze(Object.fromEntries(SEGMENT_STYLE_FIELDS.map(f => [f, s[f]])))])));
}

// Back to the defaults: every segment the new dataset does not use (inactive), so adding it later starts from the preset and not from the
// previous data's settings (sample1's project, for one, does not list 'contrast'). Returns the keys that changed (their DOM controls follow
// configureSegments; the material <select> is set by the caller).
export function resetSegmentStyles(state, defaults) {
  const changed = [];
  for (const [key, s] of Object.entries(state)) {
    const d = defaults?.[key]; if (!d || s.active) continue;
    let diff = false;
    for (const f of SEGMENT_STYLE_FIELDS) if (s[f] !== d[f]) { s[f] = d[f]; diff = true; }
    if (diff) { s._maskCache = null; s._maskCacheKey = ''; changed.push(key); }
  }
  return changed;
}

// runs fn each time another dataset is opened or the data is cleared (state.js setActiveSeries dispatches 'vrl-serieschange' only when the
// series object changes: the same series card again does not). For modules that keep a copy of the dataset (the prepared VR data) and must let it go.
// A throwing release must not stop the others / the series switch itself.
export function onDatasetChange(fn, target = globalThis.document) {
  target?.addEventListener?.('vrl-serieschange', () => { try { fn(); } catch (e) { console.warn('Releasing the previous dataset failed:', e); } });
}
