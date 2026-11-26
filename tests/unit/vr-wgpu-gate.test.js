// The compile gate of the WebGPU view (docs/vr-wgpu-gate.js) and its use by the display's programs (docs/vr-wgpu-newpath.js queueAll / whenReady, docs/vr-wgpu.js warmWays): the programs of a data set go to the GPU a few at a time,
// each job in a task of its own (the page's frames run between two of them), in the order asked for, and a wait for them gives up only when nothing moves. CI has no GPU: the device is a mock that counts the calls of each task.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREEG from 'three/webgpu';
import { createCompileGate, yieldTask } from '../../docs/vr-wgpu-gate.js';
import { createVolumeGpu } from '../../docs/vr-wgpu.js';
import { createNewPath } from '../../docs/vr-wgpu-newpath.js';
import { GPU_GLOBALS, recordingDevice } from '../helpers/gpu-call-log.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');

describe('the compile gate', () => {
  it('runs every job in a task of its own: the main thread is given back between two jobs', async () => {
    const g = createCompileGate({ limit: 8 }), order = [], fired = [];
    const ps = Array.from({ length: 12 }, (_, i) => g.queue(() => { order.push(i); fired[i] = false; setTimeout(() => { fired[i] = true; }, 0); if (i) expect(fired[i - 1], 'a timer task ran between job ' + (i - 1) + ' and ' + i).toBe(true); }));
    await Promise.all(ps);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // first in, first out
  });
  it('never has more than `limit` programs compiling: the next job starts when one is done', async () => {
    const g = createCompileGate({ limit: 3, pollMs: 1 }); let now = 0, max = 0;
    const job = () => { now++; max = Math.max(max, now); return sleep(8).then(() => { now--; }); };
    await Promise.all(Array.from({ length: 14 }, () => g.queue(job)));
    expect(max).toBe(3); expect(g.stats().started).toBe(14);
  });
  it('counts the programs its sources report (the display\'s instance reports its own) against the limit', async () => {
    const g = createCompileGate({ limit: 2, pollMs: 1 }); let compiling = 0, max = 0;
    g.addSource(() => compiling);
    const job = () => { compiling++; max = Math.max(max, compiling); setTimeout(() => { compiling--; }, 8); };
    await Promise.all(Array.from({ length: 9 }, () => g.queue(job)));
    while (g.busy) await sleep(2);
    expect(max).toBe(2);
  });
  it('a job queued with front goes before the ones that wait; the value of a job comes back; a thrown error rejects its own promise only', async () => {
    const g = createCompileGate({ limit: 1, pollMs: 1 }), order = [];
    const first = g.queue(() => sleep(10).then(() => order.push('first'))); // running: the next ones wait for room
    const a = g.queue(() => { order.push('a'); }), b = g.queue(() => { order.push('b'); }), f = g.queue(() => { order.push('front'); return 7; }, { front: true }), bad = g.queue(() => { throw new Error('x'); });
    expect(await f).toBe(7);
    await expect(bad).rejects.toThrow('x'); await Promise.all([first, a, b]);
    expect(order).toEqual(['first', 'front', 'a', 'b']);
  });
  it('reports the share made: done / total of the batch that runs', async () => {
    const g = createCompileGate({ limit: 1, pollMs: 1 }); const fr = [];
    const ps = Array.from({ length: 5 }, () => g.queue(() => sleep(3).then(() => fr.push(g.progress().fraction))));
    expect(g.progress().total).toBe(5); await Promise.all(ps);
    for (let i = 1; i < fr.length; i++) expect(fr[i]).toBeGreaterThanOrEqual(fr[i - 1]);
    expect(g.progress().fraction).toBe(1);
  });
  it('yieldTask is a timer task, not a requestAnimationFrame / requestIdleCallback (those are held while an immersive session is presented)', () => {
    expect(read('vr-wgpu-gate.js').replace(/\/\/.*$/gm, '')).not.toMatch(/requestAnimationFrame|requestIdleCallback/); expect(String(yieldTask)).toContain('sleep');
  });
});

// a device that counts what one task hands over (the burst is closed by a timer task: everything made before the task ends)
function countingDevice(compileMs = 6) {
  const burst = { mod: 0, pipe: 0 }, max = { mod: 0, pipe: 0 }; let open = false;
  const note = k => { burst[k]++; if (!open) { open = true; setTimeout(() => { for (const x of Object.keys(burst)) { max[x] = Math.max(max[x], burst[x]); burst[x] = 0; } open = false; }, 0); } };
  let inflight = 0, maxInflight = 0;
  const pipeline = () => { inflight++; maxInflight = Math.max(maxInflight, inflight); return sleep(compileMs).then(() => { inflight--; return {}; }); };
  const dev = new Proxy({
    createShaderModule: () => { note('mod'); return {}; },
    createRenderPipelineAsync: () => { note('pipe'); return pipeline(); }, createComputePipelineAsync: () => { note('pipe'); return pipeline(); },
    createRenderPipeline: () => ({}), createComputePipeline: () => ({}), createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}), createSampler: () => ({}),
    createBuffer: () => ({ destroy() {}, getMappedRange: () => new ArrayBuffer(64), unmap() {} }), createTexture: () => ({ createView: () => ({}), destroy() {} }), queue: { writeBuffer() {}, writeTexture() {} }, limits: {},
  }, { get: (t, k) => (k in t ? t[k] : () => ({})) });
  return { dev, max, get maxInflight() { return maxInflight; } };
}
const withGpu = fn => async () => { for (const [k, v] of Object.entries(GPU_GLOBALS)) vi.stubGlobal(k, v); try { await fn(); } finally { vi.unstubAllGlobals(); } };
const mkNp = (dev, gate) => createNewPath({ device: dev, f16: true, bgl: {}, renderDesc: () => ({}), onShader: null, dropGroups() {}, dummy: () => ({}), entryOf: () => null, tag: 't', onFail() {}, ...(gate ? { gate } : {}) });

describe('the display\'s programs through the gate', () => {
  it('queueAll for a data set with results and child segments: a few programs per task (the ungated ensureAll makes ten of one set in one task), at most the limit compiling', withGpu(async () => {
    const c = countingDevice(), np = mkNp(c.dev);
    np.queueAll(false, { R: true, C: true }, false, true); np.queueAll(false, { R: true, C: true, T: true }, false, true);
    expect(await np.whenReady(2000)).toBe(true);
    expect(c.max.mod, 'shader modules created in one task').toBeLessThanOrEqual(4); expect(c.max.pipe, 'pipelines asked for in one task').toBeLessThanOrEqual(4);
    expect(c.maxInflight, 'programs compiling at once').toBeLessThanOrEqual(6); // a job may start a render program and the tools' compute programs together: the limit is for starting a job
    expect(np.pipes.size).toBeGreaterThanOrEqual(20);
    const again = c.max.mod; np.queueAll(false, { R: true, C: true }, false, true); await np.whenReady(2000); expect(c.max.mod, 'a program already made is not made twice').toBe(again);
  }));
  it('whenReady gives up only when nothing starts or finishes for stallMs (a compile that hangs); a long list that goes on is waited for however long it takes', withGpu(async () => {
    const slow = countingDevice(4), np = mkNp(slow.dev);
    np.queueAll(false, null, false, true); const t0 = Date.now(); const calls = [];
    expect(await np.whenReady(60, p => calls.push(p.fraction))).toBe(true); // steady progress: more than the stall time in all, still waited for
    expect(Date.now() - t0).toBeGreaterThan(60 * 0.5); expect(calls.length).toBeGreaterThan(1); expect(calls.at(-1)).toBe(1);
    // a compile that never answers: gives up after the stall time with false
    const hang = createNewPathHang(); hang.np.queueAll(false, null, false, true);
    const t1 = Date.now(); expect(await hang.np.whenReady(80)).toBe(false); expect(Date.now() - t1).toBeLessThan(2500);
  }));
  it('waitFor waits for the jobs it is given, not for the background ones queued before them (a prepared session does not wait for the other fourth-segment variant)', withGpu(async () => {
    const c = countingDevice(12), np = mkNp(c.dev);
    const bg = np.queueAll(true, null, false, false); // the other variant: behind, not waited for
    const need = np.queueAll(false, null, false, true); // the one the session needs: in front
    expect(await np.waitFor(need, 5000)).toBe(true);
    expect(np.gate.queued, 'background jobs still wait when the needed ones are made').toBeGreaterThan(0);
    for (const [k, p] of np.pipes) if (k.includes(':c3')) expect(p.state, k).toBe('ready');
    const started = np.gate.stats().started, again = np.queueAll(false, null, false, true); await Promise.all(again);
    expect(np.gate.stats().started, 'everything needed is made: no job is queued again, the wait is over at once').toBe(started);
    expect(await np.waitFor([], 10)).toBe(true);
    await Promise.all(bg); expect(await np.whenReady(2000)).toBe(true);
  }));
  it('the other fourth-segment variant is queued GATE.bgDelayMs after the call (nothing is made for it while the session starts), the page\'s preparation (opts.all) waits for both', withGpu(async () => {
    try {
      const rec = recordingDevice({ timestamps: false }), vol = createVolumeGpu({ device: rec.device, THREE: THREEG, f16: false, bgDelayMs: 120 }); const feat = { R: true };
      await vol.warmWays([{ cls4: false, events: false, feat }]);
      const np = vol.displayNp().inst, keys = () => [...np.pipes.keys()];
      expect(keys().some(k => k.includes(':c3'))).toBe(true); expect(keys().some(k => k.includes(':c4')), 'nothing of the other variant yet').toBe(false);
      await sleep(250); while (np.pending()) await sleep(5);
      expect(keys().some(k => k.includes(':c4')), 'queued after the delay').toBe(true);
      const rec2 = recordingDevice({ timestamps: false }), vol2 = createVolumeGpu({ device: rec2.device, THREE: THREEG, f16: false, bgDelayMs: 120 });
      await vol2.warmWays([{ cls4: false, events: false, feat }], null, { all: true });
      const np2 = vol2.displayNp().inst; expect([...np2.pipes.entries()].filter(([k]) => k.includes(':c4')).every(([, p]) => p.state === 'ready'), 'both variants are made when the call returns').toBe(true);
      vol.dispose(); vol2.dispose();
    } finally { /* nothing to put back */ }
  }));
  it('the session\'s waits are not capped by the clock: warmWays throws when the programs stop making progress instead of letting the first frames find none', () => {
    const w = read('vr-wgpu.js'); expect(w).toContain("the display programs stopped making progress"); expect(w).toContain('np.queueAll(c, f, z, front, force)');
    expect(read('vr-wgpu-newpath.js')).toContain('stallMs');
  });
});
function createNewPathHang() { const dev = countingDevice().dev; dev.createRenderPipelineAsync = () => new Promise(() => {}); dev.createComputePipelineAsync = () => new Promise(() => {}); return { np: mkNp(dev) }; }
