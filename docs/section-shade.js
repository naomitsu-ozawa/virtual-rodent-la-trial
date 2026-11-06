// the browser 3D view's cut-face shading controls (断面解析 panel): the fill (単色 / CT濃淡, as the VR menu's スライスの塗り), 明るさ and コントラスト of the shading the cut face gets when
// 「スライス画像を表示」 is off (segment colour x a brightness from the data value, through the page's own window wc / ww = the slice image's window; maths: cap-shade.js).
// The controls only act while a section is open, the cap is on and the slice image is hidden, so they are disabled otherwise (明るさ / コントラスト also with 単色).
// Like VR (vr-view.js ctShade / ctShadeBright / ctShadeContrast: device settings saved in localStorage, defaults CT濃淡 / 1.8 / 1.7) the three values are kept on this device and restored at start.
import { sectionViewOpen, sectionViewPlane, sectionSliceImageVisible, sectionCapEnabled, sectionShadeMode, sectionShadeBright, sectionShadeContrast, setSectionShadeMode, setSectionShadeBright, setSectionShadeContrast } from './state.js?v=20261106-build692';
import { sectionShadeModeControl, sectionShadeBrightControl, sectionShadeBrightValue, sectionShadeContrastControl, sectionShadeContrastValue } from './ui-shell.js?v=20261106-build692';
import { brightOf, contrastOf } from './cap-shade.js?v=20261106-build692';

const KEY = 'vrl-section-shade';

// what the renderers use now: on = the cut face is shaded (slice image hidden and the fill is CT濃淡), plus the two values (already clamped)
export function sectionShadeParams() {
  return { on: !sectionSliceImageVisible && sectionShadeMode === 1, bright: brightOf(sectionShadeBright), contrast: contrastOf(sectionShadeContrast) };
}

export function syncSectionShadeUi() {
  const enabled = sectionViewOpen && !!sectionViewPlane && sectionCapEnabled && !sectionSliceImageVisible, p = sectionShadeParams();
  if (sectionShadeModeControl) { sectionShadeModeControl.value = String(sectionShadeMode); sectionShadeModeControl.disabled = !enabled; }
  const put = (control, out, value) => { if (control) { control.value = String(Math.round(value * 100)); control.disabled = !enabled || sectionShadeMode !== 1; } if (out) out.value = Math.round(value * 100) + '%'; };
  put(sectionShadeBrightControl, sectionShadeBrightValue, p.bright);
  put(sectionShadeContrastControl, sectionShadeContrastValue, p.contrast);
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
  if (sectionShadeModeControl) sectionShadeModeControl.onchange = () => { setSectionShadeMode(+sectionShadeModeControl.value === 0 ? 0 : 1); save(); syncSectionShadeUi(); refresh(); };
  syncSectionShadeUi();
}
