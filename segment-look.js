// The look of a child segment (a segment added under a preset in the tree): opacity, display mode (material) and cut-face shading range (shade). Pure: no DOM, no three.js, unit-tested (tests/unit/child-segments.test.js).
// A child segment has the same look fields as a preset card: opacity (0..1, default 1), material (lighting.js MATERIALS key, default 'standard') and shade ({lower, upper} in data values, set by hand; null = automatic,
// computed from the segment's own voxels). They are saved on each child segment entry of the project file (project.treeSegments; no project version bump: an old file has none and gets the defaults).
// Ported from the tree-segments work docs/region-look.js (d99f5414), renamed: it is applied to CHILD SEGMENTS only, never to analysis regions.
const finite = v => typeof v === 'number' && Number.isFinite(v);
export const CHILD_SEG_MATERIALS = ['standard', 'solid', 'plaster', 'plastic']; // the keys of lighting.js MATERIALS (kept here so that this module stays import-free)
export const CHILD_SEG_OPACITY_DEFAULT = 1, CHILD_SEG_MATERIAL_DEFAULT = 'standard';
export function childSegNormalizeOpacity(v) {
  if (v == null || v === '') return CHILD_SEG_OPACITY_DEFAULT;
  v = +v;
  return finite(v) ? Math.min(1, Math.max(0, v)) : CHILD_SEG_OPACITY_DEFAULT;
}
export const childSegNormalizeMaterial = m => (CHILD_SEG_MATERIALS.includes(m) ? m : CHILD_SEG_MATERIAL_DEFAULT);
// shade: {lower, upper} (also {min, max}, the project file's spelling) -> {lower, upper} ordered, or null (auto)
export function childSegNormalizeShade(s) {
  if (!s || typeof s !== 'object') return null;
  const a = s.lower ?? s.min, b = s.upper ?? s.max;
  if (a == null || b == null || a === '' || b === '' || !finite(+a) || !finite(+b)) return null;
  return { lower: Math.min(+a, +b), upper: Math.max(+a, +b) };
}
// the three fields of a source (a project entry, an undo snapshot, another segment), normalised; a missing field gets its default
export const childSegLookOf = src => ({ opacity: childSegNormalizeOpacity(src?.opacity), material: childSegNormalizeMaterial(src?.material), shade: childSegNormalizeShade(src?.shade) });
// put the look on the segment (every creation site calls this: a new child starts at the defaults, a copy keeps the source's look)
export function childSegApplyLook(seg, src) {
  const l = childSegLookOf(src);
  seg.opacity = l.opacity; seg.material = l.material; seg.shade = l.shade;
  return seg;
}
// the project file's fields of an entry: shade is {min, max} (the same spelling as the preset segments' shadeRanges) or null
export function childSegLookToProject(seg) {
  const l = childSegLookOf(seg);
  return { opacity: l.opacity, material: l.material, shade: l.shade ? { min: l.shade.lower, max: l.shade.upper } : null };
}
export const childSegLookIsDefault = seg => { const l = childSegLookOf(seg); return l.opacity === CHILD_SEG_OPACITY_DEFAULT && l.material === CHILD_SEG_MATERIAL_DEFAULT && !l.shade; };
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
