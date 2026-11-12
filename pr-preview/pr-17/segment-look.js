export const isChildKey = key => typeof key === 'string' && /^s\d+$/.test(key);
// 0xRRGGBB (an analysis colour) -> '#rrggbb' (the common segment shape holds a CSS colour like the presets' colour); a CSS string stays
export const childSegColorCss = c => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : '#' + (Number.isFinite(+c) ? (+c & 0xffffff) : 0x00d8ff).toString(16).padStart(6, '0'));
// the free-text name of a child segment: control characters stripped, 40 characters at most (child equivalents of the analysis list's rule; this module does not use region-name.js)
export const CHILD_SEG_NAME_MAX = 40;
export function childSegNormalizeName(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim().slice(0, CHILD_SEG_NAME_MAX).trim();
}
