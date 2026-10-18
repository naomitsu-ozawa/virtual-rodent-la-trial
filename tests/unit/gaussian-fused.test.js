import { describe, it, expect } from 'vitest';
import { gaussianPassKernel } from '../../docs/gpu-shaders.js';

// JS mirrors of the old per-pass shader and the fused kernel along one axis
const pass = (a, s) => a.map((b, i) => { const l = a[Math.max(0, i - 1)], r = a[Math.min(a.length - 1, i + 1)]; return b * (1 - s) + s * (l + 2 * b + r) / 4; });
const fused = (a, k) => { const r = (k.length - 1) / 2; return a.map((_, i) => { let acc = 0; for (let j = -r; j <= r; j++) acc += k[j + r] * a[Math.min(a.length - 1, Math.max(0, i + j))]; return acc; }); };

describe('fused gaussian (build 286)', () => {
  it('equals n repeated 3-tap passes away from the edges', () => {
    let s = 3; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const a = Array.from({ length: 64 }, () => rnd() * 2000 - 1000);
    for (const [st, n] of [[0.6, 4], [0.3, 1], [1, 6]]) {
      let ref = a; for (let p = 0; p < n; p++) ref = pass(ref, st);
      const out = fused(a, gaussianPassKernel(st, n));
      for (let i = n; i < a.length - n; i++) expect(out[i]).toBeCloseTo(ref[i], 6);
    }
  });
  it('kernel sums to 1', () => {
    expect(gaussianPassKernel(0.55, 4).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
  });
});
