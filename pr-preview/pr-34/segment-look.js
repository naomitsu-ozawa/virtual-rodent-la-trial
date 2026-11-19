// What a child segment (a segment added under a preset in the tree) owns of its look: name, colour, label, show / hide, 色だけ消す. Pure: no DOM, no three.js, unit-tested (tests/unit/child-segments.test.js).
// child = inherits, like an analysis region: opacity, material and cut-face shading range are NOT the child's: they are always its PARENT preset's (segments.js segmentById / childRenderEntries read them from the parent).
// An older project file may still hold opacity / material / shade on a child entry: they are ignored on load and not written on save.
// a child segment key ('s<id>') is told from a preset key ('bone' ...); an analysis region has no key of this kind
export const isChildKey = key => typeof key === 'string' && /^s\d+$/.test(key);
// 0xRRGGBB (an analysis colour) -> '#rrggbb' (the common segment shape holds a CSS colour like the presets' colour); a CSS string stays
export const childSegColorCss = c => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : '#' + (Number.isFinite(+c) ? (+c & 0xffffff) : 0x00d8ff).toString(16).padStart(6, '0'));
// the free-text name of a child segment: control characters stripped, 40 characters at most (child equivalents of the analysis list's rule; this module does not use region-name.js)
export const CHILD_SEG_NAME_MAX = 40;
export function childSegNormalizeName(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim().slice(0, CHILD_SEG_NAME_MAX).trim();
}
