// Resizable panes (build 586, workspace UI only): drag handles on the borders between the panes.
//   left    : the left column (tool rail + panel) | the views          (landscape: width)
//   bottom  : the views / the panel below them                          (portrait: panel height)
//   split   : the 3D view | the 2D column in 分割                        (landscape: 2D width, portrait: 2D height)
// The sizes are CSS variables on .app-shell (style.css uses them with the old sizes as fallback) and are remembered per device.
// Double-click (double-tap) a handle = back to the default size. The analysis dock keeps its own grip (analysis-dock.js).
const KEY = 'vrl-pane-sizes-v1';
const VARS = { left: '--ws-left-w', bottom: '--ws-bottom-h', split: '--ws-split-2d-w', splitV: '--ws-split-2d-h' };

// [min, room the other side keeps]: the pane never gets smaller than min, and the panes beside it always keep their room
export function clampPane(kind, value, avail) {
  const lim = { left: [240, 420], bottom: [160, 240], split: [220, 300], splitV: [140, 160] }[kind] || [100, 200];
  const max = Math.max(lim[0], Math.floor(avail - lim[1]));
  return Math.round(Math.min(max, Math.max(lim[0], value)));
}

export function installPaneResize() {
  const shell = document.querySelector('.app-shell'), ws = document.querySelector('.workspace');
  const sidebar = document.querySelector('.sidebar'), viewer = document.getElementById('viewer-grid');
  const main = document.getElementById('main-view-slot'), sub = document.getElementById('sub-view-slots');
  if (!shell || !ws || !sidebar || !viewer || !main || !sub || !document.documentElement.classList.contains('vrl-ipad-ui')) return null;
  let sizes = {};
  try { sizes = JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}') || {}; } catch { sizes = {}; }
  const save = () => { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(sizes)); } catch { /* not stored */ } };
  const portrait = () => globalThis.matchMedia?.('(orientation:portrait)').matches;
  const split = () => shell.classList.contains('ipad-mode-split');
  const applyVars = () => { for (const [k, v] of Object.entries(VARS)) { if (Number.isFinite(sizes[k])) shell.style.setProperty(v, sizes[k] + 'px'); else shell.style.removeProperty(v); } };
  let raf = 0;
  const notify = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; globalThis.dispatchEvent(new Event('resize')); }); };

  const mk = (name, host) => {
    const h = document.createElement('div');
    h.className = 'pane-resizer'; h.dataset.pane = name; h.setAttribute('role', 'separator'); h.tabIndex = -1;
    host.append(h); return h;
  };
  const hLeft = mk('left', ws), hSplit = mk('split', viewer);

  // which size a handle sets now, and where it sits
  const kindOf = h => (h === hLeft ? (portrait() ? 'bottom' : 'left') : (portrait() ? 'splitV' : 'split'));
  function place() {
    const p = portrait(), wr = ws.getBoundingClientRect(), sr = sidebar.getBoundingClientRect();
    hLeft.dataset.axis = p ? 'y' : 'x';
    if (p) Object.assign(hLeft.style, { left: '0px', width: wr.width + 'px', top: (sr.top - wr.top - 8) + 'px', height: '8px' });
    else Object.assign(hLeft.style, { top: '0px', height: wr.height + 'px', left: (sr.right - wr.left) + 'px', width: '8px' });
    const showSplit = split() && main.offsetParent && sub.offsetParent;
    hSplit.hidden = !showSplit;
    if (showSplit) {
      const vr = viewer.getBoundingClientRect(), mr = main.getBoundingClientRect();
      hSplit.dataset.axis = p ? 'y' : 'x';
      if (p) Object.assign(hSplit.style, { left: '0px', width: vr.width + 'px', top: (mr.bottom - vr.top) + 'px', height: '8px' });
      else Object.assign(hSplit.style, { top: '0px', height: (mr.height) + 'px', left: (mr.right - vr.left) + 'px', width: '8px' });
    }
  }
  function sizeFor(kind, e) {
    if (kind === 'left') { const r = ws.getBoundingClientRect(); return clampPane(kind, e.clientX - r.left, r.width); }
    if (kind === 'bottom') { const r = ws.getBoundingClientRect(); return clampPane(kind, r.bottom - e.clientY, r.height); }
    const r = viewer.getBoundingClientRect();
    if (kind === 'split') return clampPane(kind, r.right - e.clientX - 4, r.width);
    return clampPane(kind, sub.getBoundingClientRect().bottom - e.clientY - 4, r.height);
  }
  for (const h of [hLeft, hSplit]) {
    let drag = null;
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      drag = { id: e.pointerId, kind: kindOf(h) };
      try { h.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      h.classList.add('is-dragging'); document.documentElement.classList.add('pane-resizing');
    });
    h.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return; e.stopPropagation();
      sizes[drag.kind] = sizeFor(drag.kind, e); applyVars(); place(); notify();
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return; e.stopPropagation();
      try { h.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      drag = null; h.classList.remove('is-dragging'); document.documentElement.classList.remove('pane-resizing'); save(); notify();
    };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    h.addEventListener('dblclick', e => { e.stopPropagation(); delete sizes[kindOf(h)]; applyVars(); save(); place(); notify(); });
  }

  applyVars();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;
  for (const el of [ws, sidebar, viewer, main, sub]) ro?.observe(el);
  new MutationObserver(() => requestAnimationFrame(place)).observe(shell, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => requestAnimationFrame(place));
  place();
  return { sizes, place };
}
