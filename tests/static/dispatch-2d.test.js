import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// build 292: an extract pass dispatched 229376 workgroups in x (limit 65535)
// once the filtered 3D blocks grew. Every size-dependent compute dispatch in
// gpu-compute.js must go through gpuDispatch1D (2D grid past 65535).
describe('gpu-compute dispatches', () => {
  it('has no raw size-dependent dispatchWorkgroups', () => {
    const src = readFileSync('docs/gpu-compute.js', 'utf8');
    const raw = [...src.matchAll(/dispatchWorkgroups\(([^)]*)\)/g)].map(m => m[1]).filter(a => a !== '1' && !/GPU_MAX_GROUPS/.test(a));
    expect(raw).toEqual([]);
  });
});
