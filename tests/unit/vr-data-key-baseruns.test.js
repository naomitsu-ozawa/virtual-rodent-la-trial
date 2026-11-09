import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// vr-view.js needs a DOM, so this pins the source: baseRuns enter the VR data key (vrDataKey) and the hidden-cls key only for
// segments with a processed mask (the only ones whose VR data uses baseRuns, gpu-volume-data.js). The page-side auto-range
// counting creates baseRuns for the other segments right after data open and must not change the key.
describe('vrDataKey / hiddenClsKey count baseRuns only for processed-mask segments', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('both keys gate idOf(st.baseRuns) on segmentHasProcessedMask(k)', () => {
    const gated = src.match(/segmentHasProcessedMask\(k\)\?idOf\(st\.baseRuns\):0/g) || [];
    expect(gated.length).toBe(2);
    expect(src).not.toMatch(/[,\[]idOf\(st\.baseRuns\)/);
  });
  it('the gate sits in the segment map of vrDataKey and hiddenClsKey', () => {
    for (const name of ['export function vrDataKey', 'const hiddenClsKey']) {
      const i = src.indexOf(name);
      expect(i).toBeGreaterThan(0);
      expect(src.slice(i, i + 700)).toContain('segmentHasProcessedMask(k)?idOf(st.baseRuns):0');
    }
  });
});
