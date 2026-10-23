// App wiring of effective-hu.js: the real readers. Raw = the source slice (or the resident array); filtered = the
// filtered axial plane from source-filters.js (cached by filter signature / plane / index, the same path the MPR cards use).
import { sourceVolume, volume } from './state.js?v=20261022-build656';
import { sourceFilterStages, sourceFilterSignature, getFilteredSourcePlaneValues, getFilteredMemoryPlaneValues, getCachedSourceSlice, sourceFilterCacheGet, memoryFilterPreviewGet } from './source-filters.js?v=20261022-build656';
import { sourceSliceCache } from './volume-io.js?v=20261022-build656';
import { createEffectiveReader, resolveHuMode } from './effective-hu.js?v=20261022-build656';
// the unfiltered volume the filters work on (memory volume: sourceVolume; source-backed: the volume itself)
export const rawHuVolume = () => sourceVolume || volume;
export const filtersActive = () => sourceFilterStages().length > 0;
export const readEffectiveSlice = createEffectiveReader({
  stageCount: () => sourceFilterStages().length,
  rawSlice(z, v) {
    const plane = v.columns * v.rows, arr = v.data || v.mprData;
    if (arr && arr.length >= plane * v.slices) return arr.subarray(z * plane, (z + 1) * plane);
    if (v.sourceBacked && v.series?.slices) return getCachedSourceSlice(v.series.slices[z]);
    throw new Error('slice ' + z + ' is not readable');
  },
  filteredSlice: (z, v) => (v.sourceBacked && v.series?.slices ? getFilteredSourcePlaneValues('axial', z, v.series, 'hu-analysis') : getFilteredMemoryPlaneValues('axial', z, v, null))
});

// Cache-only readers for the live preview of a dragged HU line: they return what is ALREADY in memory (a cached filtered
// plane, a resident array, a cached source slice) or null; they never decode, filter or wait. plane(p, idx) is the filtered plane image
// of the 2D card (axial / coronal / sagittal; null in raw mode: the slice path serves raw), slice(z) an axial slice of the effective HU.
export function peekEffectiveReaders({ mode, volume: v }) {
  const filtered = resolveHuMode(mode, sourceFilterStages().length) === 'filtered';
  const sig = filtered ? sourceFilterSignature(sourceFilterStages()) : '';
  const cached = (p, idx) => (v.sourceBacked ? sourceFilterCacheGet(sig + '|' + p + '|' + idx) : memoryFilterPreviewGet(sig + '|' + p + '|' + idx)) || null;
  return {
    plane: (p, idx) => (filtered ? cached(p, idx) : null),
    slice(z) {
      if (filtered) return cached('axial', z);
      const plane = v.columns * v.rows, arr = v.data || v.mprData;
      if (arr && arr.length >= plane * v.slices) return arr.subarray(z * plane, (z + 1) * plane);
      const meta = v.sourceBacked && v.series?.slices ? v.series.slices[z] : null;
      return (meta && sourceSliceCache.map.get(meta)) || null;
    }
  };
}
