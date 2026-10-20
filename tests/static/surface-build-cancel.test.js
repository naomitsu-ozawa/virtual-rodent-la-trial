import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// render3D() (docs/surface-build.js) treats only `null` from the builders as "superseded by a newer build / series" and
// shows nothing; `undefined` (a bare `return`) reads as a failure ("表面平滑化3Dの構築に失敗しました") although nothing failed
// (opening sample B while sample A's mesh build was running). Every revision-mismatch exit must return null.
const src = readFileSync('docs/surface-build.js', 'utf8');
const body = name => {
  const start = src.indexOf('export async function ' + name + '(');
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
};

describe('surface build: superseded exits return null', () => {
  for (const name of ['render3DSourceBacked', 'render3DMemoryGpu']) {
    it(name, () => {
      const b = body(name);
      const exits = [...b.matchAll(/if\(revision!==sourceRenderRevision\)\{dispose\(group\);return([^}]*)\}/g)];
      for (const m of exits) expect(m[1].trim()).toBe('null');
      // after the smoothing stream exists, a superseded exit also cancels its queued smoothing jobs (abandon())
      const abandons = [...b.matchAll(/if\(revision!==sourceRenderRevision\)return abandon\(\);/g)];
      expect(exits.length + abandons.length).toBeGreaterThanOrEqual(3);
      if (abandons.length) expect(b).toMatch(/const abandon=\(\)=>\{smoothStream\?\.cancel\(\);dispose\(group\);return null\};/);
      expect(b).not.toMatch(/if\(revision!==sourceRenderRevision\)return(?! abandon\(\);)/);
    });
  }
  it('render3D keeps null (cancelled) distinct from a failed build', () => {
    expect(body('render3D')).toMatch(/if\(ok===null\|\|threeDCancelRequested\)return false/);
  });
});
