import { describe, it, expect } from 'vitest';
import { packRuns, unpackRuns } from '../../docs/run-pack.js';

// Segment runs are cached on the device as one packed blob (run-cache.js).
describe('run-pack', () => {
  const runs = [new Uint32Array([0, 1, 3, 2, 0, 5]), new Uint32Array(0), new Uint32Array([7, 2, 2])];

  it('round-trips per-slice runs, including empty slices', () => {
    const back = unpackRuns(packRuns(runs), 3);
    expect(back.map(r => [...r])).toEqual(runs.map(r => [...r]));
  });

  it('rejects a slice-count mismatch, a wrong format and truncated data', () => {
    const bytes = packRuns(runs);
    expect(unpackRuns(bytes, 4)).toBeNull();
    const wrong = new Uint8Array(bytes); new Uint32Array(wrong.buffer)[0] = 99;
    expect(unpackRuns(wrong, 3)).toBeNull();
    expect(unpackRuns(bytes.slice(0, bytes.byteLength - 4), 3)).toBeNull();
  });

  it('accepts a Uint8Array view at an offset', () => {
    const bytes = packRuns(runs), host = new Uint8Array(bytes.byteLength + 8);
    host.set(bytes, 8);
    expect(unpackRuns(host.subarray(8), 3).map(r => [...r])).toEqual(runs.map(r => [...r]));
  });
});
