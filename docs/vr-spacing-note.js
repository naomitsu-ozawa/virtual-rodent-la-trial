// slice-spacing warning for the VR / AR volume displays (pure, DOM- and three-free so it can be unit-tested).
// Only a warn-level check counts; the info-level "unverified" note stays on the 2D pages (same split as analysis-results.js).
import { spacingWarningText } from './slice-spacing.js?v=20261029-build689';

export const VR_SPACING_MARK = '⚠';

// null when there is nothing to warn about; otherwise {mark, short, lines}. short = one line next to the volume numbers,
// lines = the full summary (+ detail) wrapped for the analysis tab. lang: 'ja' | 'en'.
export function vrSpacingNote(check, lang, wrapAt) {
  const w = spacingWarningText(check);
  if (!w || w.level !== 'warn') return null;
  const ja = lang === 'ja';
  const full = ja ? w.ja : w.en;
  return {
    mark: VR_SPACING_MARK,
    short: ja ? 'スライス間隔に問題：体積は近似' : 'Slice spacing issue: volumes are approximate',
    lines: wrapText(full, wrapAt || (ja ? 44 : 85), 3),
  };
}

// "⚠ " prefix for a volume number ("" without a warning)
export const vrVolumeText = (mm3, note) => (note ? note.mark + ' ' : '') + mm3.toFixed(2) + ' mm³';

// Hard wrap by characters (canvas labels do not wrap); the last allowed line is cut with an ellipsis.
export function wrapText(text, width, maxLines) {
  const out = [];
  let rest = String(text);
  while (rest.length && out.length < maxLines) {
    if (rest.length <= width) { out.push(rest); rest = ''; break; }
    let cut = width;
    const sp = rest.lastIndexOf(' ', width);
    if (sp > width * 0.5) cut = sp;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length && out.length) out[out.length - 1] = out[out.length - 1].slice(0, -1) + '…';
  return out;
}
