// "The HU the user sees" for the analysis panels (build 538): histogram and HU line profile read the FILTERED axial planes (the same
// planes the 2D MPR cards show) when image filters are on, or the raw source values when the user chooses so. Pure module: no app
// state, no DOM at import time. The app-specific readers (source-filters.js, state.js) are injected, see effective-hu-source.js.
// Units: both the raw source slices (slope / intercept applied) and the filter outputs are HU, so no conversion is needed.
export const HU_MODE_FILTERED = 'filtered', HU_MODE_RAW = 'raw';
const store = { mode: HU_MODE_FILTERED, listeners: new Set() };
export const getHuMode = () => store.mode;
export function setHuMode(mode) {
  const m = mode === HU_MODE_RAW ? HU_MODE_RAW : HU_MODE_FILTERED;
  if (m === store.mode) return;
  store.mode = m;
  for (const fn of [...store.listeners]) { try { fn(m); } catch (e) { console.error(e); } }
}
export function onHuModeChange(fn) { store.listeners.add(fn); return () => store.listeners.delete(fn); }

// the mode that is really read: 'filtered' only when a filter stage is on (otherwise filtered === raw)
export const resolveHuMode = (mode, stageCount) => (mode === HU_MODE_RAW || !(stageCount > 0) ? HU_MODE_RAW : HU_MODE_FILTERED);
// part of every cache key: the filter signature (only when it matters) + the mode actually read
export const effectiveHuSignature = (mode, stageCount, filterSignature) => (resolveHuMode(mode, stageCount) === HU_MODE_FILTERED ? 'f:' + filterSignature : 'r');

// Does a segment need its final runs (instead of being a plain [min,max] slice of the whole-volume histogram)? The slice is only valid
// when the histogram values and the segment's own voxel test see the same data: with image filters active the segment is built from
// filtered data (source-backed: filtered blocks; in-memory: the filtered 3D volume), so membership must come from the final runs,
// for in-memory volumes too (build 539; before, only source-backed volumes were routed to the runs).
export const segmentNeedsRuns = (needsVoxelMask, stageCount) => !!needsVoxelMask || stageCount > 0;

// deps: { stageCount(): number, rawSlice(z, v): Float32Array|Int16Array|Promise, filteredSlice(z, v): Float32Array|Promise }
// readEffectiveSlice(z, { mode, volume }) -> the slice values in HU (row-major, columns x rows). Never copies the volume.
export function createEffectiveReader(deps) {
  return async function readEffectiveSlice(z, { mode = getHuMode(), volume } = {}) {
    return resolveHuMode(mode, deps.stageCount()) === HU_MODE_FILTERED ? deps.filteredSlice(z, volume) : deps.rawSlice(z, volume);
  };
}

// ---- the small shared toggle (Filtered / Raw), one per panel; every toggle follows the shared mode ----
const LABELS = { ja: ['フィルター後', '元の値'], en: ['Filtered', 'Raw'] };
export function huModeToggle(lang, filtersActive = () => true) {
  const en = lang === 'en', [fl, rl] = LABELS[en ? 'en' : 'ja'];
  const wrap = document.createElement('span'); wrap.className = 'hu-mode-toggle'; wrap.setAttribute('role', 'group');
  const mk = (mode, text) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'seg-hist-mini'; b.dataset.huMode = mode; b.textContent = text;
    b.onclick = () => setHuMode(mode); return b;
  };
  const fb = mk(HU_MODE_FILTERED, fl), rb = mk(HU_MODE_RAW, rl);
  const sync = () => {
    const m = getHuMode(), on = filtersActive();
    fb.classList.toggle('is-active', m === HU_MODE_FILTERED); rb.classList.toggle('is-active', m === HU_MODE_RAW);
    wrap.dataset.huShown = resolveHuMode(m, on ? 1 : 0);
    wrap.title = on ? '' : (en ? 'No image filter is on: both show the same values' : '画像フィルターが無いため、どちらも同じ値です');
  };
  const off = onHuModeChange(() => { if (!wrap.isConnected) off(); else sync(); });
  wrap.append(fb, rb); sync();
  return wrap;
}
