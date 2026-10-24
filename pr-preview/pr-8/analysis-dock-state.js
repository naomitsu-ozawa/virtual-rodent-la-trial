// Placement / size / persistence rules of the analysis dock. Pure: no DOM, no storage of its own (the storage is passed in),
// so the unit tests and a later VR panel can use the same rules. The result models themselves stay where they are
// (histogram.js, line-profile.js); the dock only decides where their cards are shown.
//
// Modes are the workspace view modes (workspace-ui.js): '3d' | '2d' | 'split'.
//   3d    : 'overlay' (over the 3D card, collapsible + resizable) or 'below' (pinned to the dock under the 3D card)
//   2d    : 'below' the slice grid, or 'side' (beside it)
//   split : 'under2d' (under the 2D column) or 'full' (full width under both)
// Only 3d + 'overlay' covers a view; every other placement takes its own grid track.
export const DOCK_MODES = ['3d', '2d', 'split'];
export const DOCK_PLACES = { '3d': ['overlay', 'below'], '2d': ['below', 'side'], split: ['under2d', 'full'] };
export const DOCK_STORAGE_KEY = 'vrl-analysis-dock-v1';
export const DOCK_LIMITS = {
  below: { min: 120, max: 0.7, def: 240, axis: 'h' }, under2d: { min: 120, max: 0.7, def: 240, axis: 'h' }, full: { min: 120, max: 0.7, def: 240, axis: 'h' },
  side: { min: 280, max: 0.6, def: 380, axis: 'w' },
  overlay: { min: 240, max: 1, def: 380, axis: 'w' }
};
export const OVERLAY_H = { min: 140, def: 300 };
export const COLLAPSED_PX = 34;
const W_DEF = 380;
// the result cards the dock holds (ids of the existing DOM; a VR panel can list the same cards and read the same result models)
export const ANALYSIS_CARDS = [
  { id: 'hist', boxId: 'seg-hist-result', toggleId: 'seg-hist-toggle', titleKey: 'segHist' },
  { id: 'line', boxId: 'line-profile-result', toggleId: 'line-profile-toggle', titleKey: 'lineProfile' },
  { id: 'crop', boxId: 'crop-export-panel', toggleId: 'crop-export-toggle', titleKey: 'cropTitle' } // (absent from the DOM when CROP_EXPORT_UI_ENABLED is false)
];

const num = (x, lo, hi, def) => (x !== null && x !== '' && Number.isFinite(+x) ? Math.min(hi, Math.max(lo, Math.round(+x))) : def);

// the first placement a mode gets when nothing is remembered: beside the slices on a wide landscape screen in 2D, below otherwise
export function defaultPlace(mode, viewport = {}) {
  if (mode === '3d') return 'overlay';
  if (mode === 'split') return 'under2d';
  const wide = (viewport.width || 0) >= 1100 && (viewport.width || 0) > (viewport.height || 0);
  return wide ? 'side' : 'below';
}
export function defaultModeState(mode, viewport) {
  const place = defaultPlace(mode, viewport);
  return { open: true, place, w: W_DEF, h: place === 'overlay' ? OVERLAY_H.def : DOCK_LIMITS[place].def };
}
// one mode's state from anything that was stored: unknown fields dropped, bad values replaced by the defaults.
// Both sizes are always kept, so switching the placement keeps what the user set (w = side / overlay width, h = docked / overlay height).
export function normalizeModeState(mode, raw, viewport) {
  const d = defaultModeState(mode, viewport), r = raw && typeof raw === 'object' ? raw : {};
  const place = DOCK_PLACES[mode]?.includes(r.place) ? r.place : d.place;
  return {
    open: typeof r.open === 'boolean' ? r.open : true,
    place,
    w: num(r.w, DOCK_LIMITS.overlay.min, 4000, W_DEF),
    h: num(r.h, OVERLAY_H.min, 4000, place === 'overlay' ? OVERLAY_H.def : DOCK_LIMITS[place].def)
  };
}
export function normalizeState(raw, viewport) {
  const out = {};
  for (const m of DOCK_MODES) out[m] = normalizeModeState(m, raw && typeof raw === 'object' ? raw[m] : null, viewport);
  return out;
}
export function loadDockState(storage, viewport) {
  let raw = null;
  try { const s = storage?.getItem(DOCK_STORAGE_KEY); if (s) raw = JSON.parse(s); } catch { raw = null; }
  return normalizeState(raw, viewport);
}
export function saveDockState(storage, state) {
  if (!storage) return false;
  try { storage.setItem(DOCK_STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
// the other placement of the mode (the placement button)
export function nextPlace(mode, place) {
  const list = DOCK_PLACES[mode] || []; if (!list.length) return place;
  return list[(Math.max(0, list.indexOf(place)) + 1) % list.length];
}
// does this placement take a track of the viewer grid (true) or float over the 3D card (false)?
export const isDocked = place => place !== 'overlay';
// the dock's grid layout key (data-dock on #viewer-grid, style.css); null = the dock takes no track
export function layoutKey(mode, place, visible) {
  if (!visible || !isDocked(place) || !DOCK_PLACES[mode]?.includes(place)) return null;
  return mode + '-' + place;
}
// size limits against the room the area has: the dock never takes more than `max` of it and never less than `min`
export function clampSize(place, value, avail) {
  const lim = DOCK_LIMITS[place] || DOCK_LIMITS.below, cap = Math.max(lim.min, Math.floor((avail > 0 ? avail : 4000) * lim.max));
  return Math.min(cap, Math.max(lim.min, Math.round(Number.isFinite(+value) ? +value : lim.def)));
}
// a resize drag: the dock grows when its free edge moves away from the views
//   below / under2d / full: top edge, up = bigger      side: left edge, left = bigger
//   overlay (bottom-left of the 3D card): top-right corner, right = wider, up = taller
export function resizeBy(place, start, dx, dy) {
  if (place === 'side') return { w: start.w - dx, h: start.h };
  if (place === 'overlay') return { w: start.w + dx, h: start.h - dy };
  return { w: start.w, h: start.h - dy };
}
// the size the dock takes in a state (collapsed = just the header strip)
export function dockExtent(st) {
  const place = st.place, collapsed = !st.open;
  if (place === 'side') return { w: collapsed ? COLLAPSED_PX + 10 : st.w, h: 0 };
  if (place === 'overlay') return { w: collapsed ? 0 : st.w, h: collapsed ? 0 : st.h };
  return { w: 0, h: collapsed ? COLLAPSED_PX : st.h };
}
