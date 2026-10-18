import { describe, it, expect, vi, afterEach } from 'vitest';
import { HISTOGRAM_SELF_CHECK } from '../../docs/vr-histogram-panel.js';
import { readFileSync } from 'node:fs';

// the panel imports the runner with the build tag (?v=...): use that very module instance, whose registry the scenario went into
const tag = readFileSync(new URL('../../docs/vr-histogram-panel.js', import.meta.url), 'utf8').match(/'\.\/vr-self-check\.js(\?v=[^']+)'/)[1];
const { listVrSelfChecks, createVrSelfCheck } = await import('../../docs/vr-self-check.js' + tag);

// build 557: the VR self-check 「ヒストグラム」 scenario keeps the histogram pass running while the frame rate is measured
let clock = 0;
afterEach(() => vi.restoreAllMocks());
// a fake env.histogram whose pass takes passFrames frames; a fake ctx whose measure() runs `frames` frames of 14 ms
function fake({ passFrames = 30, frames = 100, open = false } = {}) {
  const log = [], h = { open: false, left: 0 };
  const env = { histogram: {
    isOpen: () => h.open, open: () => { h.open = true; log.push('open'); }, close: () => { h.open = false; log.push('close'); },
    forceCompute: () => { h.left = passFrames; log.push('force'); }, busy: () => h.left > 0,
  } };
  if (open) h.open = true;
  const ctx = { ja: true, env, notes: [], skip: r => ({ skip: r }), note: t => ctx.notes.push(t),
    async measure({ onFrame }) { for (let i = 0; i < frames; i++) { clock += 14; onFrame(i / 72, i / frames); if (h.left > 0) h.left--; } return { frames, meanFps: 72 }; } };
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  return { ctx, log, h };
}

describe('VR self-check: histogram scenario', () => {
  it('is registered with the self-check runner', () => {
    expect(listVrSelfChecks().map(d => d.id)).toContain('histogram');
  });
  it('opens the board, restarts the pass each time it finishes, notes the passes, closes again', async () => {
    const { ctx, log, h } = fake({ passFrames: 30, frames: 100 });
    const s = await HISTOGRAM_SELF_CHECK.run(ctx);
    expect(s.frames).toBe(100);
    expect(log[0]).toBe('open'); expect(log.at(-1)).toBe('close'); expect(h.open).toBe(false);
    expect(log.filter(x => x === 'force').length).toBe(4); // frames 0, 30, 60, 90
    expect(ctx.notes[0]).toMatch(/^集計 3 回完了・最長 0\.4 秒$/); // 30 frames x 14 ms
  });
  it('a pass that does not finish within the measurement is noted as such', async () => {
    const { ctx } = fake({ passFrames: 1000, frames: 50 });
    await HISTOGRAM_SELF_CHECK.run(ctx);
    expect(ctx.notes[0]).toMatch(/^集計が測定中に終わらず/);
  });
  it('leaves an already open board open', async () => {
    const { ctx, log, h } = fake({ open: true });
    await HISTOGRAM_SELF_CHECK.run(ctx);
    expect(h.open).toBe(true); expect(log).not.toContain('close');
  });
  it('is skipped without the env hook', async () => {
    const r = await HISTOGRAM_SELF_CHECK.run({ ja: true, env: {}, skip: why => ({ skip: why }) });
    expect(r.skip).toBe('パネルなし');
  });
  it('closes the board when the run is cancelled mid-measurement', async () => {
    const log = [];
    const env = { histogram: { isOpen: () => false, open: () => log.push('open'), close: () => log.push('close'), forceCompute: () => {}, busy: () => true } };
    const sc = createVrSelfCheck({ env, log: () => {} }), p = sc.start();
    let t = 0; for (let i = 0; i < 2000 && !log.includes('open'); i++) { sc.tick(t += 14); await new Promise(r => setTimeout(r, 0)); }
    sc.tick(t += 14); sc.cancel(); await p;
    expect(log).toEqual(['open', 'close']);
  });
});

describe('VR histogram self-check wiring (static)', () => {
  const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
  it('vr-view.js offers env.histogram with open / close / forceCompute', () => {
    expect(src).toMatch(/selfCheck\.env\.histogram=\{isOpen:[^}]*open:\(\)=>setHistOpen\(true\),close:\(\)=>setHistOpen\(false\),forceCompute:histForce,busy:/);
  });
});
