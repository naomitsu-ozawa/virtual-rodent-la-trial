import { segmentById, setChildLook, onChildSegLookChange } from './segments.js?v=20261112-build720';
import { CHILD_SEG_NAME_MAX } from './segment-look.js?v=20261112-build720';
import { childByKey } from './child-segments.js?v=20261112-build720';
import { childLabelItem } from './child-labels.js?v=20261112-build720';
import { setRegionLabelOffset, hasOffset, onAnalysisLabelsChange } from './analysis-label.js?v=20261112-build720';
import { tr } from './i18n.js?v=20261112-build720';

// the actions the page injects (app.js: deleteChild(key)), so that this module imports nothing of the 3D code
let actions = { deleteChild: null };
export const setSegmentTreeActions = a => { actions = { ...actions, ...a }; };
// the 3D name label of a child (pin on the surface the 3D camera sees / unpin: the page's analysis-results.js toggleAnalysisLabel, injected so that this module imports no 3D code)
let labelPin = null;
export const setChildLabelPin = fn => { labelPin = fn; };

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
  // the name label on the 3D view and in VR: pin / unpin it, put it back at its default place after it was moved (a drag on the 3D view / in VR moves it; the label is saved with the project)
  const lbRow = el('div', 'analysis-label-actions'); lbRow.dataset.childLabelRow = key;
  const pin = el('button', 'analysis-label-pin'); pin.type = 'button'; pin.dataset.childLabelPin = key;
  pin.onclick = () => { const c = childByKey(key); if (c && labelPin) labelPin(childLabelItem(c)); syncSegmentLookControls(box); };
  lbRow.append(pin); box.append(lbRow);
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
  {const c = childByKey(key), it = c ? childLabelItem(c) : null, pin = box.querySelector('[data-child-label-pin]'), rs = box.querySelector('[data-child-label-reset]');
   if (pin) { const k = it?.label ? 'analysisLabelUnpin' : 'analysisLabelPin'; pin.dataset.i18n = k; pin.textContent = tr(k); } // data-i18n: a language switch re-words it (the key follows the pinned state)
   const lbRow = box.querySelector('[data-child-label-row]'), has = !!(it?.label && hasOffset(it.label));
   if (lbRow && has !== !!rs) { // the put-back button exists only while the label was moved (as the analysis card's)
     if (has) { const b = i18n(el('button', 'analysis-label-reset'), 'analysisLabelReset'); b.type = 'button'; b.dataset.childLabelReset = key; b.onclick = () => { const c2 = childByKey(key); if (c2) setRegionLabelOffset(childLabelItem(c2), null); syncSegmentLookControls(box); }; lbRow.append(b); }
     else rs.remove();
   }}
  const nm = box.querySelector('[data-child-name]'), co = box.querySelector('[data-child-color]'); put(nm, childByKey(key)?.name || ''); put(co, g.color);
}
const syncAll = () => { for (const box of document.querySelectorAll('[data-child-detail]')) syncSegmentLookControls(box); };
// the auto range arrives / a look changes elsewhere (the cut-face panel, VR, a project): the open controls follow
onChildSegLookChange(syncAll);
onAnalysisLabelsChange(syncAll); // a name label pinned / unpinned / moved on the 3D view or in VR: the buttons follow
