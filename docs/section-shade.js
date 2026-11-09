// the browser 3D view's cut-face shading controls (断面解析 panel): the fill (単色 / CT濃淡, as the VR menu's スライスの塗り), 明るさ and コントラスト of the shading the cut face gets when
// 「スライス画像を表示」 is off (segment colour x a brightness from the data value; maths: cap-shade.js), and the 濃淡の範囲 of each segment: choose a segment, 下限 / 上限 sliders with − / ＋, 初期値に戻す.
// The data value is read through the range of the segment (segments.js segmentShadeRange: auto = the 2nd..98th percentile of the values of the segment's voxels, manual = the user's), not through the slice image's window.
// The controls only act while a section is open, the cap is on and the slice image is hidden, so they are disabled otherwise (明るさ / コントラスト also with 単色).
// Like VR (vr-view.js ctShade / ctShadeBright / ctShadeContrast: device settings saved in localStorage, defaults CT濃淡 / 1.8 / 1.7) the three values are kept on this device and restored at start.
import { sectionViewOpen, sectionViewPlane, sectionSliceImageVisible, sectionCapEnabled, sectionShadeMode, currentLanguage, sectionShadeBright, sectionShadeContrast, setSectionShadeMode, setSectionShadeBright, setSectionShadeContrast } from './state.js?v=20261108-build695';
import { sectionShadeModeControl, sectionShadeBrightControl, sectionShadeBrightValue, sectionShadeContrastControl, sectionShadeContrastValue, sectionShadeSegGroup, sectionShadeLowerControl, sectionShadeLowerValue, sectionShadeLowerMinus, sectionShadeLowerPlus, sectionShadeUpperControl, sectionShadeUpperValue, sectionShadeUpperMinus, sectionShadeUpperPlus, sectionShadeResetButton } from './ui-shell.js?v=20261108-build695';
import { brightOf, contrastOf, shadeRangeStep, shadeValueAt, shadePosOf } from './cap-shade.js?v=20261108-build695';
import { SEGMENT_PRESET_ORDER, segmentState, segmentShadeRange, segmentShadeSpan, setSegmentShadeEnd, resetSegmentShadeRange, shadeDataRange, onShadeAutoChange } from './segments.js?v=20261108-build695';
import { wireStepButton, stepClamp } from './value-step.js?v=20261108-build695';
import { formatCtValue } from './utils.js?v=20261108-build695';
import { tr } from './i18n.js?v=20261108-build695';

const KEY = 'vrl-section-shade';

// what the renderers use now: on = the cut face is shaded (slice image hidden and the fill is CT濃淡), plus the two values (already clamped)
// ranges: every segment's range in use {key: {lower, upper}} (the GPU volume takes the slots' ranges from it, the mesh view the segment of each pixel)
export function sectionShadeParams() {
  const data = shadeDataRange(), ranges = {};
  for (const key of SEGMENT_PRESET_ORDER) { const r = segmentShadeRange(key, data); ranges[key] = { lower: r.lower, upper: r.upper }; }
  return { on: !sectionSliceImageVisible && sectionShadeMode === 1, bright: brightOf(sectionShadeBright), contrast: contrastOf(sectionShadeContrast), ranges };
}

// ---- the 濃淡の範囲 controls: the segments shown now (active and ticked), the one chosen, its two sliders over the segment's span (the values present in it + 5 %, else the data's full range; step = span / 200) ----
let chosen = null; // the segment key chosen in the panel (UI only)
export const shownShadeSegments = () => SEGMENT_PRESET_ORDER.filter(k => segmentState[k].active && segmentState[k].enabled);
export function chosenShadeSegment() { const shown = shownShadeSegments(); if (!shown.includes(chosen)) chosen = shown[0] ?? null; return chosen; }
let lastSig = '';
function syncRangeUi(enabled) {
  const key = chosenShadeSegment(), data = shadeDataRange(), shown = shownShadeSegments(), on = enabled && sectionShadeMode === 1 && !!key && !!data;
  if (sectionShadeSegGroup) {
    const sig = shown.join() + '|' + tr('bone') + '|' + key;
    if (sectionShadeSegGroup.dataset.sig !== sig) {
      sectionShadeSegGroup.dataset.sig = sig; sectionShadeSegGroup.textContent = '';
      for (const k of shown) { const b = document.createElement('button'); b.type = 'button'; b.dataset.shadeSeg = k; b.textContent = tr(k); b.setAttribute('aria-pressed', k === key ? 'true' : 'false'); b.style.cssText = k === key ? 'font-weight:700;outline:2px solid currentColor' : ''; b.onclick = () => { chosen = k; syncSectionShadeUi(); }; sectionShadeSegGroup.append(b); }
    }
    for (const b of sectionShadeSegGroup.children) b.disabled = !enabled || sectionShadeMode !== 1;
  }
  const r = key && data ? segmentShadeRange(key, data) : null, span = key && data ? segmentShadeSpan(key, data) : data, step = shadeRangeStep(span);
  for (const [control, out, minus, plus, value] of [[sectionShadeLowerControl, sectionShadeLowerValue, sectionShadeLowerMinus, sectionShadeLowerPlus, r?.lower], [sectionShadeUpperControl, sectionShadeUpperValue, sectionShadeUpperMinus, sectionShadeUpperPlus, r?.upper]]) {
    if (control) { if (span) { control.min = String(span.min); control.max = String(span.max); control.step = String(step || 1); } control.value = String(value ?? control.min); control.disabled = !on; }
    if (out) out.value = value == null ? '' : formatCtValue(value, step || 1);
    if (minus) minus.disabled = !on; if (plus) plus.disabled = !on;
  }
  if (sectionShadeResetButton) sectionShadeResetButton.disabled = !on || !r?.touched;
}

export function syncSectionShadeUi() {
  const enabled = sectionViewOpen && !!sectionViewPlane && sectionCapEnabled && !sectionSliceImageVisible, p = sectionShadeParams();
  if (sectionShadeModeControl) { sectionShadeModeControl.value = String(sectionShadeMode); sectionShadeModeControl.disabled = !enabled; }
  const put = (control, out, value) => { if (control) { control.value = String(Math.round(value * 100)); control.disabled = !enabled || sectionShadeMode !== 1; } if (out) out.value = Math.round(value * 100) + '%'; };
  put(sectionShadeBrightControl, sectionShadeBrightValue, p.bright);
  put(sectionShadeContrastControl, sectionShadeContrastValue, p.contrast);
  syncRangeUi(enabled);
}

const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ctShade: sectionShadeMode, ctShadeBright: brightOf(sectionShadeBright), ctShadeContrast: contrastOf(sectionShadeContrast) })); } catch {} };
function restore() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (o.ctShade === 0 || o.ctShade === 1) setSectionShadeMode(o.ctShade);
    setSectionShadeBright(brightOf(o.ctShadeBright)); setSectionShadeContrast(contrastOf(o.ctShadeContrast));
  } catch {}
}

// refresh(): repaint the cut face after a change (app.js passes it: the mesh view's cap is composed again, the GPU volume draws it on the next frame)
export function initSectionShadeUi({ refresh = () => {} } = {}) {
  restore();
  const wire = (control, read, apply) => { if (control) { control.oninput = () => { apply(read(+control.value)); syncSectionShadeUi(); refresh(); }; control.onchange = save; } }; // saved on release, like the VR sliders
  wire(sectionShadeBrightControl, v => brightOf(v / 100), setSectionShadeBright);
  wire(sectionShadeContrastControl, v => contrastOf(v / 100), setSectionShadeContrast);
  // the range sliders (a drag sets the end to the slider's value on its step grid; − / ＋ move it by 10, holding repeats: value-step.js). Moving an end keeps both ends of this segment (touched); lower stops at upper.
  const moveEnd = (which, value) => { const key = chosenShadeSegment(); if (!key) return; setSegmentShadeEnd(key, which, value); syncSectionShadeUi(); refresh(); };
  const dataNow = () => shadeDataRange();
  const spanNow = () => { const key = chosenShadeSegment(), d = dataNow(); return key && d ? segmentShadeSpan(key, d) : d; }; // the span the chosen segment's sliders run over
  for (const [which, control, minus, plus] of [['lower', sectionShadeLowerControl, sectionShadeLowerMinus, sectionShadeLowerPlus], ['upper', sectionShadeUpperControl, sectionShadeUpperMinus, sectionShadeUpperPlus]]) {
    if (control) control.oninput = () => { const d = spanNow(); if (d) moveEnd(which, shadeValueAt(shadePosOf(+control.value, d), d)); };
    const step = () => delta => { const key = chosenShadeSegment(), d = dataNow(); if (!key || !d) return; const r = segmentShadeRange(key, d); moveEnd(which, stepClamp(which === 'lower' ? r.lower : r.upper, delta, d.min, d.max)); };
    if (minus) wireStepButton(minus, -1, step()); if (plus) wireStepButton(plus, 1, step());
  }
  if (sectionShadeResetButton) sectionShadeResetButton.onclick = () => { const key = chosenShadeSegment(); if (!key) return; resetSegmentShadeRange(key); syncSectionShadeUi(); refresh(); };
  // an auto range is ready (data opened, threshold changed): the panel follows and the cut face is repainted
  onShadeAutoChange(() => { syncSectionShadeUi(); refresh(); });
  // the segments change outside this panel (ticked, added, their own sliders, a project): the panel follows, the cut face is repainted by those paths themselves
  setInterval(() => { const sig = currentLanguage + '|' + shownShadeSegments().join() + '|' + SEGMENT_PRESET_ORDER.map(k => { const r = segmentShadeRange(k); return r.lower + ',' + r.upper; }).join(';'); if (sig !== lastSig) { lastSig = sig; syncSectionShadeUi(); } }, 400);
  if (sectionShadeModeControl) sectionShadeModeControl.onchange = () => { setSectionShadeMode(+sectionShadeModeControl.value === 0 ? 0 : 1); save(); syncSectionShadeUi(); refresh(); };
  syncSectionShadeUi();
}
