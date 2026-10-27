// Device-local cache of filtered MPR planes (one Float32 plane per entry), so
// reopening the same data with the same filter shows the 2D plane without
// re-running the GPU filters. Same database, budget, auto-prune and "clear
// cache" button as segment-runs (run-cache.js). Values stay Float32 (no
// quantizing). Browser storage can be evicted; this is only a cache.
// Kept free of DOM-bound imports (the volume cache is passed in) for unit tests.
import { cacheKey, pruneOtherFilterSettings } from './gpu-volume-cache.js?v=20261027-build679';
import { datasetFingerprint } from './project-file.js?v=20261027-build679';

export const PLANE_FORMAT = 1;
export const MAX_PLANES_PER_FILTER = 6;
export const PLANE_WRITE_DELAY_MS = 1200;
// the volume cache (gpu-volume-data.js registers itself; this module stays free of DOM-bound imports)
export const planeCacheProvider = { cache: async () => null, budget: async () => null };
export function setPlaneCacheProvider(p) { Object.assign(planeCacheProvider, p); }
export const planeCacheStats = { hit: 0, miss: 0, store: 0 };
globalThis.__vrlPlaneCacheStats = planeCacheStats;

// only the MPR panes are stored; analysis-pick / hu-analysis planes are not
export function isCacheablePlane(keyPrefix) { return typeof keyPrefix === 'string' && keyPrefix.startsWith('mpr:'); }

// The dataset id is stored as a string (pruneOtherFilterSettings compares datasets by value, so this matches the
// object form of volume / segment-runs entries too).
const datasetId = series => JSON.stringify(datasetFingerprint(series));
export function planeCacheInfo(series, filterSignature) { return { kind: 'filtered-plane', dataset: datasetId(series), filter: filterSignature || '' }; }
export function planeCacheKey(series, filterSignature, plane, idx) {
  return cacheKey({ kind: 'filtered-plane', planeFormat: PLANE_FORMAT, dataset: datasetId(series), filter: filterSignature || '', plane, idx });
}

// Float32Array of `length` values, or null (miss / damaged entry, which is dropped)
export async function loadCachedPlane(cache, key, length) {
  if (!cache) return null;
  try {
    const hit = await cache.lookup(key);
    if (!hit || hit.info?.kind !== 'filtered-plane') return null;
    const raw = await cache.read(key, 0);
    const values = raw instanceof Float32Array ? raw : raw?.buffer && raw.byteLength % 4 === 0 ? new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) : raw instanceof ArrayBuffer ? new Float32Array(raw) : null;
    if (!values || values.length !== length) { try { await cache.remove(key) } catch {} return null; }
    return values;
  } catch (e) { return null; }
}

// Writes one plane, then keeps at most `max` planes per (dataset, filter) (oldest used first) and the overall budget.
export async function storeCachedPlane(cache, key, info, values, { budget = null, max = MAX_PLANES_PER_FILTER } = {}) {
  try {
    if (!cache) return false;
    const writer = await cache.begin(key, { slices: 1, bytesPerSlice: values.byteLength, info: { ...info } });
    try { await writer.write(0, values); await writer.commit(); } catch (e) { await writer.abort(); throw e; }
    await pruneOtherFilterSettings(cache, info, key);
    const same = (await cache.list()).filter(e => e.complete && e.key !== key && e.info?.kind === 'filtered-plane' && e.info.dataset === info.dataset && e.info.filter === info.filter).sort((a, b) => a.lastUsed - b.lastUsed);
    for (let i = 0; i < same.length - (max - 1); i++) await cache.remove(same[i].key);
    if (budget != null) await cache.prune(budget, { keep: key });
    planeCacheStats.store++;
    return true;
  } catch (e) { return false; }
}

// Pending writes wait until nothing has been requested for `delayMs` (the slice
// slider is being dragged otherwise); only the newest `max` are kept.
export function createPlaneWriteQueue(write, { delayMs = PLANE_WRITE_DELAY_MS, max = MAX_PLANES_PER_FILTER, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let pending = [], timer = null;
  const flush = async () => { timer = null; const items = pending; pending = []; for (const it of items) { try { await write(it) } catch {} } };
  const touch = () => { if (timer != null) clearTimer(timer); timer = setTimer(flush, delayMs); };
  return {
    // call on every plane request (cached or not) to restart the idle wait
    touch() { if (pending.length) touch(); },
    add(item) { pending = pending.filter(p => p.key !== item.key); pending.push(item); while (pending.length > max) pending.shift(); touch(); },
    // drop writes of a filter that is no longer current
    keepOnly(pred) { pending = pending.filter(pred); if (!pending.length && timer != null) { clearTimer(timer); timer = null; } },
    get size() { return pending.length; },
    flush,
  };
}
