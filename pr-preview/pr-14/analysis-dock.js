// Analysis dock: one container for the HU histogram, the HU line-profile and the crop export cards.
// The existing result DOM (#seg-hist-result, #line-profile-result) is moved into the dock (appendChild); histogram-ui.js / line-profile-ui.js
// keep rendering into those very elements, so no analysis logic changes. Where the dock sits depends on the workspace view mode
// (rules in analysis-dock-state.js):
//   3D only : floats over the 3D card (collapsible, resizable) or is pinned to a dock under the 3D card
//   2D only : a strip below the slice grid (or beside it): never over a view
//   split   : under the 2D column (or full width under both): never over a view
// Open state / size / placement are remembered per mode (localStorage, optional). Every part of the dock takes pointer input itself
// and stops the pointer events, so the 3D view never rotates from a dock interaction.
import { tr } from './i18n.js?v=20261027-build677';
import { ANALYSIS_CARDS, DOCK_MODES, loadDockState, saveDockState, nextPlace, layoutKey, isDocked, clampSize, resizeBy, dockExtent, OVERLAY_H, DOCK_LIMITS } from './analysis-dock-state.js?v=20261027-build677';
const mk = (tag, cls, attrs) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
const label = (el, key) => { el.dataset.i18n = key; el.textContent = tr(key); };
const placeKey = (mode, place) => (mode === '3d' ? (place === 'overlay' ? 'dockPin' : 'dockUnpin') : { below: 'dockSide', side: 'dockBelow', under2d: 'dockFull', full: 'dockUnder2d' }[place] || 'dockPin');

export function installAnalysisDock() {
  const shell = document.querySelector('.app-shell'), viewer = document.getElementById('viewer-grid'), card3d = document.querySelector('#main-view-slot .view-card-3d');
  const toolbar = document.getElementById('ipad-workspace-toolbar');
  if (!shell || !viewer || !card3d || !toolbar || !document.documentElement.classList.contains('vrl-ipad-ui')) return null;
  const cards = ANALYSIS_CARDS.map(c => ({ ...c, box: document.getElementById(c.boxId), toggle: document.getElementById(c.toggleId) })).filter(c => c.box && c.toggle);
  if (!cards.length) return null;
  const viewport = () => ({ width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 });
  let storage = null; try { storage = globalThis.localStorage || null; } catch { storage = null; }
  const S = loadDockState(storage, viewport());
  const save = () => saveDockState(storage, S);
  const modeNow = () => DOCK_MODES.find(m => shell.classList.contains('ipad-mode-' + m)) || '3d';

  // ---- DOM ----
  const dock = mk('section', 'analysis-dock is-hidden', { id: 'analysis-dock', 'aria-label': 'Analysis' });
  const grip = mk('div', 'analysis-dock-grip', { role: 'separator', 'aria-label': tr('dockResize'), tabindex: '-1' });
  const head = mk('div', 'analysis-dock-head'), title = mk('strong'); label(title, 'dockTitle');
  const placeBtn = mk('button', 'seg-hist-mini', { type: 'button', 'data-dock-act': 'place' });
  const foldBtn = mk('button', 'seg-hist-mini', { type: 'button', 'data-dock-act': 'collapse' });
  head.append(title, placeBtn, foldBtn);
  const body = mk('div', 'analysis-dock-body');
  for (const c of cards) body.append(c.box);
  dock.append(grip, head, body);

  // proxy buttons: the originals sit in the 3D card, which the 2D-only view hides (and the workspace CSS hides them there anyway).
  // they live in the tool's own panel of the left column ([data-tool-buttons] from workspace-ui.js: 解析 / 切り出し);
  // volume / section analysis act on the 3D view, so they are proxied too and are off in the 2D-only view
  const tools3d = [{ id: 'volume', toggleId: 'volume-analysis-toggle', titleKey: 'volumeMode' }, { id: 'section', toggleId: 'section-view-toggle', titleKey: 'sliceAnalysis' }]
    .map(c => ({ ...c, toggle: document.getElementById(c.toggleId) })).filter(c => c.toggle);
  const proxied = [...tools3d, ...cards];
  const groupOf = c => (c.id === 'crop' ? 'crop' : 'analysis');
  const fallback = mk('div', 'ipad-analysis-tools', { role: 'group', 'aria-label': 'Analysis tools' });
  for (const c of proxied) {
    const b = mk('button', '', { type: 'button', 'data-dock-tool': c.id }); label(b, c.titleKey); b.onclick = () => c.toggle.click(); c.proxy = b;
    (document.querySelector(`[data-tool-buttons="${groupOf(c)}"]`) || fallback).append(b);
  }
  if (fallback.childElementCount) { const modes = toolbar.querySelector('.ipad-view-modes'); if (modes) modes.after(fallback); else toolbar.append(fallback); }
  const syncTools = () => { const no3d = modeNow() === '2d'; for (const c of proxied) { c.proxy.disabled = c.toggle.disabled || (no3d && tools3d.includes(c)); c.proxy.classList.toggle('is-active', c.toggle.classList.contains('is-active')); } };
  // where the result cards are shown (settings 'resultPlace'): 'panel' = in the tool's panel of the left column (the default),
  // 'below' = in this dock, always under the views (3D / 2D: below, split: full width)
  const resultPlace = () => (globalThis.__vrlSettings?.get?.('resultPlace') === 'below' ? 'below' : 'panel');
  const hostOf = c => document.querySelector(`[data-result-host="${groupOf(c)}"]`);
  const BELOW = { '3d': 'below', '2d': 'below', split: 'full' };

  // ---- layout ----
  const visible = () => cards.some(c => !c.box.classList.contains('is-hidden'));
  let sig = '', ownResize = false, cur = { w: 0, h: 0 }; // cur: the size on screen (a drag starts from it, also when 'below' forces a place)
  const notify = () => requestAnimationFrame(() => { ownResize = true; try { globalThis.dispatchEvent(new Event('resize')); } finally { ownResize = false; } });
  function apply() {
    const inPanel = resultPlace() === 'panel' && cards.every(hostOf);
    for (const c of cards) { const want = inPanel ? hostOf(c) : body; if (c.box.parentNode !== want) want.append(c.box); }
    const mode = modeNow(), st = S[mode];
    // 'below' fixes the place (the placement button is gone): a stored side / overlay place is replaced, with the default height
    // when the old place had no height of its own (side) - so a drag on the free edge always has room to grow
    if (!inPanel && BELOW[mode] && st.place !== BELOW[mode]) { if (st.place === 'side') st.h = DOCK_LIMITS[BELOW[mode]].def; st.place = BELOW[mode]; save(); }
    const show = !inPanel && visible(), docked = isDocked(st.place), key = layoutKey(mode, st.place, show);
    placeBtn.hidden = true;
    const parent = docked ? viewer : card3d;
    if (dock.parentNode !== parent) parent.append(dock);
    dock.classList.toggle('is-hidden', !show);
    dock.classList.toggle('is-collapsed', !st.open);
    dock.dataset.place = st.place; dock.dataset.mode = mode;
    if (key) viewer.dataset.dock = key; else delete viewer.dataset.dock;
    const ext = dockExtent(st);
    let w = ext.w, h = ext.h;
    if (docked && st.open) { if (st.place === 'side') w = clampSize('side', st.w, viewer.clientWidth); else h = clampSize(st.place, st.h, viewer.clientHeight); }
    if (!docked && st.open) { w = Math.max(240, Math.min(st.w, Math.max(240, card3d.clientWidth - 20))); h = Math.max(OVERLAY_H.min, Math.min(st.h, Math.max(OVERLAY_H.min, card3d.clientHeight - 60))); }
    cur = { w, h };
    if (docked) { viewer.style.setProperty('--dock-h', h + 'px'); viewer.style.setProperty('--dock-w', w + 'px'); dock.style.width = ''; dock.style.height = ''; }
    else { dock.style.width = w ? w + 'px' : ''; dock.style.height = h ? h + 'px' : ''; }
    label(placeBtn, placeKey(mode, st.place)); label(foldBtn, st.open ? 'dockCollapse' : 'dockExpand');
    foldBtn.setAttribute('aria-expanded', String(st.open));
    const s = [mode, st.place, st.open, show, w, h].join('|');
    if (s !== sig) { sig = s; notify(); }
  }

  // ---- actions ----
  foldBtn.onclick = () => { const st = S[modeNow()]; st.open = !st.open; save(); apply(); };
  placeBtn.onclick = () => { const m = modeNow(), st = S[m]; st.place = nextPlace(m, st.place); save(); apply(); };
  // drag the free edge (top / left / top-right corner) to resize
  let drag = null;
  grip.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    const m = modeNow(), st = S[m]; if (!st.open) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: m, start: { w: st.w, h: cur.h || st.h } };
    try { grip.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    dock.classList.add('is-resizing');
  });
  grip.addEventListener('pointermove', e => {
    e.stopPropagation(); if (!drag || e.pointerId !== drag.id) return;
    const st = S[drag.mode], r = resizeBy(st.place, drag.start, e.clientX - drag.x, e.clientY - drag.y);
    st.w = Math.max(240, Math.round(r.w)); st.h = Math.max(OVERLAY_H.min, Math.round(r.h)); apply();
  });
  const endDrag = e => { e.stopPropagation(); if (!drag || e.pointerId !== drag.id) return; try { grip.releasePointerCapture(e.pointerId); } catch { /* ignore */ } drag = null; dock.classList.remove('is-resizing'); save(); };
  grip.addEventListener('pointerup', endDrag); grip.addEventListener('pointercancel', endDrag);
  // the dock never lets a pointer reach the 3D view behind / around it
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup']) dock.addEventListener(t, e => e.stopPropagation());
  for (const t of ['touchstart', 'touchmove', 'touchend', 'wheel']) dock.addEventListener(t, e => e.stopPropagation(), { passive: true });

  // ---- follow the app ----
  const mo = new MutationObserver(() => { syncTools(); apply(); });
  for (const c of cards) mo.observe(c.box, { attributes: true, attributeFilter: ['class'] });
  for (const c of proxied) mo.observe(c.toggle, { attributes: true, attributeFilter: ['class', 'disabled'] });
  new MutationObserver(() => { syncTools(); apply(); }).observe(shell, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => { if (!ownResize) apply(); });
  addEventListener('vrl-settings', e => { if (e.detail?.key === 'resultPlace') apply(); });
  syncTools(); apply();
  return { dock, apply, state: S };
}
