import { test, expect } from '@playwright/test';

// the constrained smoothing runs in a pool of Web Workers (smooth-workers.js) from the kernel's source text; a
// chunk smoothed in a worker must come out bit for bit as on the main thread (the seam copy and the mesh cache rely on it).

// (in the page) a welded voxel-face mesh: a ball with a 1-voxel rod
const smoothCase = () => {
  window.__vrlSmoothCase = async () => {
    const q = new URL(document.querySelector('script[src*="app.js"]').src).search;
    const cs = await import('./constrained-smooth.js' + q), mg = await import('./mesh-geometry.js' + q);
    const n = 20, inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && (Math.hypot(x - 9.5, y - 9.5, z - 9.5) < 7 || (x === 3 && y === 3 && z > 2 && z < 17)), tri = [];
    const quad = (a, b, c, d) => tri.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!inside(x, y, z)) continue;
      if (!inside(x - 1, y, z)) quad([x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]);
      if (!inside(x + 1, y, z)) quad([x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]);
      if (!inside(x, y - 1, z)) quad([x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]);
      if (!inside(x, y + 1, z)) quad([x, y + 1, z], [x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]);
      if (!inside(x, y, z - 1)) quad([x, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z]);
      if (!inside(x, y, z + 1)) quad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]);
    }
    const g = mg.indexedGeometryFromTrianglePositions(new Float32Array(tri)), pos = g.getAttribute('position').array, index = g.index.array;
    const opts = { ...cs.constrainedSmoothSchedule(4), box: [0.5, 0.5, 0.5] }, pinned = new Uint8Array(pos.length / 3); pinned[0] = 1;
    return { pos, index, opts, pinned, faces: new Float32Array(tri) };
  };
  // (in the page) a chunk's faces prepared, smoothed and given normals in a worker (smoothChunkInPool) and on the main
  // thread (runSmoothMessage): every array they return, bit for bit
  window.__vrlChunkCase = async sw => {
    const { pos, opts, faces } = await window.__vrlSmoothCase(), keys = [0, 5].map(k => pos[k * 3] + ',' + pos[k * 3 + 1] + ',' + pos[k * 3 + 2]);
    const main = sw.runSmoothMessage({ faces: new Float32Array(faces), lattice: null, pinnedKeys: keys, iterations: opts.iterations, lowpass: opts.lowpass, box: opts.box, normals: true });
    const out = await sw.smoothChunkInPool(new Float32Array(faces), { pinnedKeys: keys, ...opts });
    const same = ['pos', 'index', 'orig', 'pinned', 'normals'].filter(k => main[k].length === out[k].length && main[k].every((v, i) => Object.is(v, out[k][i])));
    let moved = 0; for (let i = 0; i < main.pos.length; i++) if (main.pos[i] !== main.orig[i]) moved++;
    return { same, moved, count: main.pos.length, pinned: main.pinned.reduce((a, b) => a + b, 0) };
  };
};

test('a chunk smoothed in a worker is bit for bit the main-thread result', async ({ page }) => {
  await page.addInitScript(smoothCase);
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const q = new URL(document.querySelector('script[src*="app.js"]').src).search;
    const cs = await import('./constrained-smooth.js' + q), sw = await import('./smooth-workers.js' + q);
    const { pos, index, opts, pinned } = await window.__vrlSmoothCase();
    const a = new Float32Array(pos);
    cs.constrainedSmoothPositions(a, index, { ...opts, pinned, orig: new Float32Array(pos) });
    const b = new Float32Array(pos), bIndex = new Uint32Array(index), out = await sw.smoothInPool(b, bIndex, { ...opts, pinned: new Uint8Array(pinned), orig: new Float32Array(pos) });
    let diff = 0, moved = 0; for (let i = 0; i < a.length; i++) { if (a[i] !== out.pos[i]) diff++; if (a[i] !== pos[i]) moved++; }
    return { workers: sw.smoothPoolSize(), detached: b.length === 0, diff, moved, count: a.length, indexSame: out.index.every((v, i) => v === index[i]) };
  });
  expect(r.workers).toBeGreaterThan(0);
  expect(r.detached).toBe(true); // the chunk went to a worker
  expect(r.moved).toBeGreaterThan(r.count / 4);
  expect(r.diff).toBe(0);
  expect(r.indexSame).toBe(true);
});

test('a chunk\'s faces prepared and smoothed in a worker come out bit for bit as on the main thread', async ({ page }) => {
  await page.addInitScript(smoothCase);
  await page.goto('/?smoothgpu=off');
  const r = await page.evaluate(async () => {
    const sw = await import('./smooth-workers.js' + new URL(document.querySelector('script[src*="app.js"]').src).search);
    return { ...(await window.__vrlChunkCase(sw)), workers: sw.smoothPoolSize() };
  });
  expect(r.workers).toBeGreaterThan(0);
  expect(r.same).toEqual(['pos', 'index', 'orig', 'pinned', 'normals']);
  expect(r.moved).toBeGreaterThan(r.count / 4);
  expect(r.pinned).toBe(2);
});

// a worker that dies with the chunk (its positions already moved to it) leaves the chunk to the main thread, which smooths
// it again from the lattice positions: the same result, no failed build
test('a chunk whose worker dies is smoothed on the main thread', async ({ page }) => {
  await page.addInitScript(smoothCase);
  await page.addInitScript(() => {
    window.Worker = class { constructor() { this.onmessage = null; this.onerror = null; } postMessage(m, transfer) { structuredClone(m, { transfer }); setTimeout(() => this.onerror?.({ message: 'killed', preventDefault() {} }), 0); } terminate() {} };
  });
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const q = new URL(document.querySelector('script[src*="app.js"]').src).search;
    const cs = await import('./constrained-smooth.js' + q), sw = await import('./smooth-workers.js' + q);
    const { pos, index, opts, pinned } = await window.__vrlSmoothCase();
    const a = new Float32Array(pos);
    cs.constrainedSmoothPositions(a, index, { ...opts, pinned, orig: new Float32Array(pos) });
    const results = await Promise.all([0, 1, 2, 3, 4].map(async () => { const b = new Float32Array(pos), out = await sw.smoothInPool(b, new Uint32Array(index), { ...opts, pinned: new Uint8Array(pinned), orig: new Float32Array(pos) }); let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== out.pos[i]) diff++; return { detached: b.length === 0, diff }; }));
    return { results, chunk: await window.__vrlChunkCase(sw), workersLeft: sw.smoothPoolSize() };
  });
  expect(r.results.some(x => x.detached)).toBe(true); // at least one chunk was lost with its worker
  expect(r.results.map(x => x.diff)).toEqual([0, 0, 0, 0, 0]);
  expect(r.chunk.same).toEqual(['pos', 'index', 'orig', 'pinned', 'normals']); // a chunk's faces: smoothed on the main thread
  expect(r.workersLeft).toBe(0);
});

// a worker that never answers (stalled) is replaced after smoothStall.overrideMs and its chunk is smoothed on the main
// thread: the build does not hang, the result is the same and the pool keeps its size
test('a chunk whose worker stalls is smoothed on the main thread and the worker is replaced', async ({ page }) => {
  await page.addInitScript(smoothCase);
  await page.addInitScript(() => {
    window.__vrlWorkersMade = 0;
    window.Worker = class { constructor() { window.__vrlWorkersMade++; this.onmessage = null; this.onerror = null; } postMessage(m, transfer) { structuredClone(m, { transfer }); } terminate() {} };
  });
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const q = new URL(document.querySelector('script[src*="app.js"]').src).search;
    const cs = await import('./constrained-smooth.js' + q), sw = await import('./smooth-workers.js' + q);
    sw.smoothStall.overrideMs = 200;
    const { pos, index, opts, pinned } = await window.__vrlSmoothCase();
    const a = new Float32Array(pos);
    cs.constrainedSmoothPositions(a, index, { ...opts, pinned, orig: new Float32Array(pos) });
    const results = await Promise.all([0, 1, 2].map(async () => { const b = new Float32Array(pos), out = await sw.smoothInPool(b, new Uint32Array(index), { ...opts, pinned: new Uint8Array(pinned), orig: new Float32Array(pos) }); let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== out.pos[i]) diff++; return { detached: b.length === 0, diff }; }));
    return { results, workers: sw.smoothPoolSize(), wanted: sw.smoothWorkerCount(), made: window.__vrlWorkersMade };
  });
  expect(r.results.every(x => x.detached)).toBe(true); // every chunk went to a (stalled) worker
  expect(r.results.map(x => x.diff)).toEqual([0, 0, 0]);
  expect(r.workers).toBe(r.wanted); // stalled workers were replaced
  expect(r.made).toBeGreaterThan(r.wanted);
});
