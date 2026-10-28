// what the page's load of the data did, for the report of a data switch inside VR (vr-view.js puts it into the switch report and the 詳細 tab line): which caches
// were hit (practice DICOM in Cache Storage, the filtered volume / segment runs in the device cache) and how long the parts took (ms). Plain numbers on globalThis.__vrlLoadStats.
export const loadStats = {};
export function resetLoadStats() { for (const k of Object.keys(loadStats)) delete loadStats[k]; loadStats.t0 = performance.now(); }
export function loadStat(key, value) { loadStats[key] = value; }
export function loadStatAdd(key, n = 1) { loadStats[key] = (loadStats[key] || 0) + n; }
export function loadStatTime(key, t0) { loadStats[key] = Math.round((loadStats[key] || 0) + performance.now() - t0); }
globalThis.__vrlLoadStats = loadStats;
