import { describe, it, expect } from 'vitest';
import { pruneOtherFilterSettings } from '../../docs/gpu-volume-cache.js';

describe('cache auto-prune (build 296)', () => {
  it('drops only same dataset + resolution entries with another filter', async () => {
    const entries = [
      { key: 'cur', info: { kind: 'volume', dataset: 'A', plan: '512', filter: 'g0.6' } },
      { key: 'old', info: { kind: 'volume', dataset: 'A', plan: '512', filter: 'g0.5' } },
      { key: 'res', info: { kind: 'volume', dataset: 'A', plan: '768', filter: 'g0.5' } },
      { key: 'other', info: { kind: 'volume', dataset: 'B', plan: '512', filter: 'g0.5' } },
      { key: 'legacy', info: { description: 'x' } },
      { key: 'runs', info: { kind: 'segment-runs', dataset: 'A', filter: 'g0.5' } },
    ];
    const removed = [];
    const cache = { list: async () => entries, remove: async k => removed.push(k) };
    await pruneOtherFilterSettings(cache, { kind: 'volume', dataset: 'A', plan: '512', filter: 'g0.6' }, 'cur');
    expect(removed).toEqual(['old']);
  });
});
