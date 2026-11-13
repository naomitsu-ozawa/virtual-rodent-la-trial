import { tr } from './i18n.js?v=20261113-build733';
export const SHOW_TOGGLE_KEYS = Object.freeze({ color: 'regionColorToggle', shape: 'regionShapeToggle' });
// canToggle false = the parent tissue is off: the region / child is hidden with it, so both rest (greyed, the title says why: regionSegmentHidden)
export function showToggleSpec({ colorOn, shapeOn, canToggle = true }) {
  return [
    { id: 'color', labelKey: SHOW_TOGGLE_KEYS.color, hintKey: 'regionColorToggleHint', pressed: !!colorOn, disabled: !canToggle },
    { id: 'shape', labelKey: SHOW_TOGGLE_KEYS.shape, hintKey: 'regionShapeToggleHint', pressed: !!shapeOn, disabled: !canToggle },
  ];
}
// handlers: { color: {onClick, attr: [dataName, value]}, shape: {...} } (attr keeps the existing data-* hooks: data-region-visible, data-child-color-off, ...)
export function buildShowToggles(state, handlers, doc = document) {
  const wrap = doc.createElement('span'); wrap.className = 'analysis-region-toggles'; wrap.setAttribute('role', 'group');
  for (const s of showToggleSpec(state)) {
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'analysis-region-button analysis-region-toggle';
    b.dataset.i18n = s.labelKey; b.textContent = tr(s.labelKey); b.title = s.disabled ? tr('regionSegmentHidden') : tr(s.hintKey);
    b.setAttribute('aria-pressed', String(s.pressed)); b.disabled = s.disabled;
    const h = handlers?.[s.id]; if (h?.attr) b.dataset[h.attr[0]] = h.attr[1];
    if (h?.onClick) b.onclick = h.onClick;
    wrap.append(b);
  }
  return wrap;
}
