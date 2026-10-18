import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeVolume3DCoordinates } from '../../docs/mesh-geometry.js';
import { OrderedChunkSmoother, smoothingInFlight } from '../../docs/smooth-chunks.js';
import { smoothWorkerCount, runSmoothMessage } from '../../docs/smooth-workers.js';
import { makeMask, voxelFaces } from '../helpers/voxel-mesh.js';

// build 612: the smoothing jobs of a cancelled or superseded build do not run (they would hold the workers for nothing),
// and its drain() still settles. Node has no Worker: a fake one runs the worker's job (runSmoothMessage) a few
// milliseconds after each message.
let started = 0;
class FakeWorker {
  postMessage(m) {
    const copy = structuredClone(m);
    setTimeout(() => {
      started++;
      const r = runSmoothMessage(copy);
      this.onmessage?.({ data: r ? { id: m.id, ...r } : { id: m.id, empty: true } });
    }, 5);
  }
  terminate() {}
}
const saved = globalThis.Worker;
beforeAll(() => { globalThis.Worker = FakeWorker; });
afterAll(() => { globalThis.Worker = saved; });

const W = 24, H = 24, D = 24, v = { columns: W, rows: H, slices: D, spacing: [0.1, 0.1, 0.1] }, coords = makeVolume3DCoordinates(v);
const faces = () => {
  const p = voxelFaces(makeMask(W, H, D, (x, y, z) => Math.hypot(x - 12, y - 12, z - 12) < 9), W, H, D).positions, o = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) { o[i] = coords.xs[p[i]]; o[i + 1] = coords.ys[p[i + 1]]; o[i + 2] = coords.zs[p[i + 2]]; }
  return o;
};

describe('cancelled smoothing jobs', () => {
  it.each(['cancel()', 'isCurrent() false'])('after %s the queued chunks do not run and drain() settles', async how => {
    let current = true, handed = 0;
    const smoother = new OrderedChunkSmoother({ strength: 4, coords, onGeometry: () => { handed++; }, isCurrent: () => current });
    started = 0;
    const chunks = smoothWorkerCount() + 5;
    for (let k = 0; k < chunks; k++) smoother.submit(faces());
    if (how === 'cancel()') smoother.cancel(); else current = false;
    await smoother.drain();
    await new Promise(r => setTimeout(r, 50));
    expect(started).toBeLessThanOrEqual(smoothWorkerCount()); // only the ones already handed to a worker
    expect(handed).toBe(0);
  });

  it('a build that goes on gets every chunk', async () => {
    let handed = 0;
    const smoother = new OrderedChunkSmoother({ strength: 1, coords, onGeometry: () => { handed++; }, isCurrent: () => true });
    for (let k = 0; k < 3; k++) smoother.submit(faces());
    await smoother.drain();
    expect(handed).toBe(3);
  });
});

// the in-flight limits hold over all smoothers (every segment of a surface), not per smoother
describe('shared in-flight limit', () => {
  it('one smoother waits while the chunks of another fill the limit', async () => {
    const a = new OrderedChunkSmoother({ strength: 1, coords, onGeometry: () => {} });
    const b = new OrderedChunkSmoother({ strength: 1, coords, onGeometry: () => {} });
    for (let k = 0; k < 3; k++) a.submit(faces());
    b.submit(faces());
    expect(smoothingInFlight().chunks).toBe(4);
    await b.throttle(2); // b alone has one chunk in flight: a per-smoother limit would not wait
    expect(smoothingInFlight().chunks).toBeLessThanOrEqual(2);
    await Promise.all([a.drain(), b.drain()]);
    await new Promise(r => setTimeout(r, 0));
    expect(smoothingInFlight()).toEqual({ chunks: 0, floats: 0 });
  });
});
