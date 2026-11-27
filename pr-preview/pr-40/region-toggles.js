// The two toggles of a row of the analysis regions and of the child segments: 「色」 and 「表示」, the same two everywhere on the page (the analysis list, the segment tree, the child rows).
//   色   = the colouring only: off = the colour goes, the shape stays and is seen in the parent's / the tissue's colour (region.visible, child.colorOff). Also called 「色を消す」.
//   表示 = the shape: off = the whole shape is hidden, so what lies behind it shows (region.hidden, child.visible:false).
// Wording is FIXED: the label never changes with the state. On / off is the pressed look + aria-pressed (pressed = colour on / shape shown, the usual state). No mode: both are plain buttons, they do not depend on each other.
// Pure spec (unit-tested, tests/unit/region-toggles.test.js) + the small DOM builder the three views share.
import { tr } from './i18n.js?v=20261127-build773';
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
