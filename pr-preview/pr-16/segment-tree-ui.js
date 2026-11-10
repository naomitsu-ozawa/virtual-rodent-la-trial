// The controls of one CHILD SEGMENT (a segment added under a preset card in the tree,; ported from the tree-segments work d99f5414 segment-tree-ui.js, applied to child segments only): the SAME controls as a preset segment card, built from the same pieces so that they look and behave the same:
// opacity slider (the card's .segment-range row), display mode (the card's .segment-material-row select, lighting.js MATERIALS), cut-face shading range (lower / upper sliders with − / ＋ and 「自動に戻す」, the section panel's
// controls, section-shade.js). Everything reads / writes the ONE segment interface (segments.js segmentById / setChildLook / setSegmentShadeEnd), so VR and the browser stay one state.
import { segmentById, setChildLook, segmentShadeRange, segmentShadeSpan, setSegmentShadeEnd, resetSegmentShadeRange, shadeDataRange, onShadeAutoChange, onChildSegLookChange } from './segments.js?v=20261110-build709';
import { CHILD_SEG_MATERIALS, CHILD_SEG_NAME_MAX } from './segment-look.js?v=20261110-build709';
import { childByKey } from './child-segments.js?v=20261110-build709';
import { shadeRangeStep, shadeValueAt, shadePosOf } from './cap-shade.js?v=20261110-build709';
import { wireStepButton, stepClamp } from './value-step.js?v=20261110-build709';
import { formatCtValue } from './utils.js?v=20261110-build709';
import { tr } from './i18n.js?v=20261110-build709';

const MATERIAL_LABEL = { standard: 'matStandard', solid: 'matSolid', plaster: 'matPlaster', plastic: 'matPlastic' };
// the actions the page injects (app.js: deleteChild(key)), so that this module imports nothing of the 3D code
let actions = { deleteChild: null };
export const setSegmentTreeActions = a => { actions = { ...actions, ...a }; };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const i18n = (e, key) => { e.dataset.i18n = key; e.textContent = tr(key); return e; };

// the detail block of one child segment (key 's<id>'); the page's tree row holds it (segment-ui.js renderSegmentTree)
export function buildSegmentLookControls(key) {
  const box = el('div', 'segment-tree-detail'); box.dataset.childDetail = key;
  // name (free text, the analysis list's rule: 40 characters) and colour
  const nameRow = el('label', 'segment-range segment-child-name'); const nameIn = el('input'); nameIn.type = 'text'; nameIn.maxLength = CHILD_SEG_NAME_MAX; nameIn.autocomplete = 'off'; nameIn.dataset.childName = key;
  nameIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); } }); nameIn.addEventListener('keyup', e => e.stopPropagation());
  nameIn.onchange = () => { setChildLook(key, { name: nameIn.value }); syncSegmentLookControls(box); };
  nameRow.append(i18n(el('span'), 'regionNameLabel'), nameIn);
  const colorIn = el('input'); colorIn.type = 'color'; colorIn.className = 'segment-color'; colorIn.dataset.childColor = key; colorIn.oninput = () => setChildLook(key, { color: colorIn.value });
  nameRow.append(colorIn); box.append(nameRow);
  const row = (labelKey, out, input) => { const l = el('label', 'segment-range'); l.append(i18n(el('span'), labelKey), out, input); return l; };
  // opacity: the card's slider (0..1, step 0.05)
  const opOut = el('output'); opOut.dataset.childOpacityOut = key;
  const op = el('input'); op.type = 'range'; op.min = '0'; op.max = '1'; op.step = '0.05'; op.dataset.childOpacity = key;
  op.oninput = () => { setChildLook(key, { opacity: +op.value }); syncSegmentLookControls(box); };
  box.append(row('opacity', opOut, op));
  // display mode: the card's material select
  const mat = el('select', 'filter-select'); mat.dataset.childMaterial = key;
  for (const m of CHILD_SEG_MATERIALS) { const o = el('option'); o.value = m; i18n(o, MATERIAL_LABEL[m]); mat.append(o); }
  mat.onchange = () => { setChildLook(key, { material: mat.value }); syncSegmentLookControls(box); };
  const matRow = el('label', 'segment-range segment-material-row'); matRow.append(i18n(el('span'), 'segMaterial'), mat); box.append(matRow);
  // cut-face shading range: lower / upper over the region's span (the values present in it + 5 %), a drag keeps both ends (manual), 「自動に戻す」 drops it
  const shade = el('div', 'segment-shade'); shade.dataset.childShadeBox = key;
  shade.append(i18n(el('strong', 'segment-shade-title'), 'shadeRange'));
  for (const which of ['lower', 'upper']) {
    const r = el('div', 'section-shade-range-row'); r.style.cssText = 'display:grid;grid-template-columns:1fr auto auto auto;gap:3px 6px;align-items:center';
    const out = el('output'); out.dataset.childShadeOut = which;
    const minus = el('button', '', '−'); minus.type = 'button'; minus.setAttribute('aria-label', '−'); minus.dataset.childShadeMinus = which;
    const plus = el('button', '', '＋'); plus.type = 'button'; plus.setAttribute('aria-label', '＋'); plus.dataset.childShadePlus = which;
    const input = el('input'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.005'; input.dataset.childShade = which; input.style.cssText = 'grid-column:1/-1;width:100%';
    const span = () => segmentShadeSpan(key, shadeDataRange()) || shadeDataRange();
    input.oninput = () => { const d = span(); if (d) setSegmentShadeEnd(key, which, shadeValueAt(shadePosOf(+input.value, d), d)); syncSegmentLookControls(box); };
    const step = delta => { const d = shadeDataRange(); if (!d || !childByKey(key)) return; const cur = segmentShadeRange(key, d); setSegmentShadeEnd(key, which, stepClamp(which === 'lower' ? cur.lower : cur.upper, delta, d.min, d.max)); syncSegmentLookControls(box); };
    wireStepButton(minus, -1, step); wireStepButton(plus, 1, step);
    r.append(i18n(el('span'), which === 'lower' ? 'shadeLower' : 'shadeUpper'), out, minus, plus, input); shade.append(r);
  }
  const reset = i18n(el('button', 'analysis-region-button'), 'shadeReset'); reset.type = 'button'; reset.dataset.childShadeReset = key;
  reset.onclick = () => { resetSegmentShadeRange(key); syncSegmentLookControls(box); };
  shade.append(reset); box.append(shade);
  const del = i18n(el('button', 'segment-remove-button'), 'removeSegment'); del.type = 'button'; del.dataset.childDelete = key;
  del.onclick = () => { if (actions.deleteChild) actions.deleteChild(key); };
  box.append(del);
  syncSegmentLookControls(box);
  return box;
}

// the controls show the segment's state now (a control being dragged / typed in is left alone)
export function syncSegmentLookControls(box) {
  const key = box?.dataset?.childDetail, g = key ? segmentById(key) : null; if (!g) return;
  const put = (input, value) => { if (input && document.activeElement !== input) input.value = String(value); };
  const op = box.querySelector('[data-child-opacity]'); put(op, g.opacity);
  const opOut = box.querySelector('[data-child-opacity-out]'); if (opOut) opOut.value = String(Math.round(g.opacity * 100)) + '%';
  const mat = box.querySelector('[data-child-material]'); if (mat) mat.value = g.material;
  const nm = box.querySelector('[data-child-name]'), co = box.querySelector('[data-child-color]'); put(nm, childByKey(key)?.name || ''); put(co, g.color);
  const data = shadeDataRange(), r = data ? segmentShadeRange(key, data) : null, span = data ? segmentShadeSpan(key, data) : null, st = shadeRangeStep(span);
  for (const which of ['lower', 'upper']) {
    const input = box.querySelector('input[data-child-shade="' + which + '"]'), out = box.querySelector('[data-child-shade-out="' + which + '"]'), on = !!r;
    if (input) { if (span) { input.min = String(span.min); input.max = String(span.max); input.step = String(st || 1); } put(input, r ? r[which] : input.min); input.disabled = !on; }
    if (out) out.value = r ? formatCtValue(r[which], st || 1) : '';
    for (const b of box.querySelectorAll('[data-child-shade-minus="' + which + '"],[data-child-shade-plus="' + which + '"]')) b.disabled = !on;
  }
  const reset = box.querySelector('[data-child-shade-reset]'); if (reset) reset.disabled = !r?.touched;
}
const syncAll = () => { for (const box of document.querySelectorAll('[data-child-detail]')) syncSegmentLookControls(box); };
// the auto range arrives / a look changes elsewhere (the cut-face panel, VR, a project): the open controls follow
onShadeAutoChange(syncAll);
onChildSegLookChange(syncAll);
