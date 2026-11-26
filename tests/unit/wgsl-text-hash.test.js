// The WGSL texts of a session with none of the features of the m6 plan (no results' colours, no child segments, no hiding, no general loop, no parts, no pair) are fixed byte for byte:
// the feature axis of the texts (docs/vr-wgsl-feat.js) must leave every text of a feature-less variant as it was at (59088a992). The hashes are of the whole text of each variant.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { volumeWgsl } from '../../docs/vr-wgsl-core.js';
import { newPathText, DISPLAY_MODES } from '../../docs/vr-wgpu-newpath.js';

const sha = t => createHash('sha256').update(t).digest('hex');
export function allFeatureLessTexts() {
  const out = {};
  for (const f16 of [false, true]) for (const cls4 of [false, true]) {
    for (const events of [false, true]) out['volume f16=' + f16 + ' c4=' + cls4 + ' ev=' + events] = volumeWgsl({ f16, cls4, events });
    for (const mode of DISPLAY_MODES) out['way ' + mode + ' f16=' + f16 + ' c4=' + cls4] = newPathText({ f16, cls4, mode });
  }
  return out;
}
describe('the texts of a variant with no feature are those of', () => {
  const want = JSON.parse(readFileSync(new URL('./fixtures/wgsl-text-hashes.json', import.meta.url), 'utf8'));
  const got = allFeatureLessTexts();
  it('every variant is in the table and the table has no other', () => { expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort()); });
  for (const k of Object.keys(want)) it(k, () => { expect(sha(got[k])).toBe(want[k]); });
});
