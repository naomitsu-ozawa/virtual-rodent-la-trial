import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// three3DReady (state.js): settled once start3D has tried to create the GPU volume renderer. selectSeries waits for it (a few seconds at most)
// before it decides between the GPU path and the in-memory path.
const fresh = () => { vi.resetModules(); return import('../../docs/state.js'); };
afterEach(() => vi.useRealTimers());

describe('waitThree3DReady', () => {
  it('waits until markThree3DReady, then answers true', async () => {
    const S = await fresh();
    expect(S.three3DIsReady).toBe(false);
    let done = null; const p = S.waitThree3DReady(5000).then(v => { done = v; });
    await Promise.resolve(); expect(done).toBe(null);
    S.markThree3DReady(); await p;
    expect(done).toBe(true); expect(S.three3DIsReady).toBe(true);
    expect(await S.waitThree3DReady(5000)).toBe(true); // already ready: no waiting
  });
  it('gives up after the timeout (answers false) and the caller goes on as before', async () => {
    vi.useFakeTimers();
    const S = await fresh();
    const p = S.waitThree3DReady(3000);
    await vi.advanceTimersByTimeAsync(2999); let settled = false; p.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2); expect(await p).toBe(false);
    expect(S.three3DIsReady).toBe(false);
  });
  it('the app marks it after the renderer attempt, also when start3D fails; selectSeries waits for it first', () => {
    const app = readFileSync('docs/app.js', 'utf8'), dl = readFileSync('docs/data-load.js', 'utf8');
    expect(app).toMatch(/new MedicalVolumeRenderer[^\n]*\n[^\n]*\n[^\n]*\n\s*if\(backend!=='WEBGPU'\)try\{[^\n]*new vrMod\.WebGlVolumeRenderer[^\n]*\n\s*memState\.markThree3DReady\(\)/); // marked after BOTH renderers had their chance: the WebGPU volume, else (no WebGPU) the WebGL volume handed over by the VR module
    expect(app).toMatch(/start3D\(\)\.catch\([\s\S]*?\)\.finally\(\(\)=>memState\.markThree3DReady\(\)\);/);
    const sel = dl.slice(dl.indexOf('export async function selectSeries(s){'));
    expect(sel.indexOf('waitThree3DReady')).toBeGreaterThan(0);
    expect(sel.indexOf('waitThree3DReady')).toBeLessThan(sel.indexOf('smallSeriesGpuVolume(s)')); // before the path decision
    expect(sel.indexOf('waitThree3DReady')).toBeLessThan(sel.indexOf('setActiveId(s.id)'));
  });
});
