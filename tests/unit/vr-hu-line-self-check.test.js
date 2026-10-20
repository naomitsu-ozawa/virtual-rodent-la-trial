import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// the VR self-check 「HU線」 scenario: a synthetic drag of HU_LINE_DRAG_SECONDS, then the release's full read is timed; state restored in finally
const huSrc = readFileSync(new URL('../../docs/vr-hu-line.js', import.meta.url), 'utf8');
// the scenario lives in the pure module (vr-hu-line.js pulls in the DOM-bound app modules); use the runner instance it registered with
const tag = readFileSync(new URL('../../docs/vr-hu-line-core.js', import.meta.url), 'utf8').match(/'\.\/vr-self-check\.js(\?v=[^']+)'/)[1];
const { HU_LINE_SELF_CHECK, HU_LINE_DRAG_SECONDS } = await import('../../docs/vr-hu-line-core.js');
const { listVrSelfChecks, selfCheckTexts } = await import('../../docs/vr-self-check.js' + tag);
const view = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');

let clock = 0;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
// a fake env.huLine whose full read takes readMs; a fake ctx whose measure() runs `frames` frames
function fake({ readMs = 300, frames = 50, begin = '', cancelAt = Infinity } = {}) {
  const log = [], st = { reading: false, until: 0, us: [] };
  const env = { huLine: {
    beginDrag: () => { log.push('begin'); return begin; },
    moveTo: u => st.us.push(u),
    release: () => { log.push('release'); st.reading = true; st.until = clock + readMs; },
    reading: () => { if (st.reading && clock >= st.until) st.reading = false; return st.reading; },
    cancel: () => log.push('cancel'),
  } };
  const ctx = { ja: true, env, notes: [], skip: r => ({ skip: r }), note: t => ctx.notes.push(t), cancelled: () => clock >= cancelAt,
    async measure({ seconds, onFrame }) { ctx.seconds = seconds; for (let i = 0; i < frames; i++) { clock += 14; onFrame(i / 72, i / (frames - 1)); } return { frames, meanFps: 72 }; } };
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  // the poll waits 50 ms per round: advance the fake clock with it
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => { clock += ms || 0; Promise.resolve().then(fn); return 0; });
  return { ctx, log, st };
}

describe('VR self-check: HU line scenario', () => {
  it('is registered with the self-check runner, after the built-in scenarios', () => {
    const ids = listVrSelfChecks().map(d => d.id);
    expect(ids).toContain('huLine'); expect(ids.indexOf('huLine')).toBeGreaterThan(ids.indexOf('zoomCloseRot'));
  });
  it('drags for HU_LINE_DRAG_SECONDS from 0 to 1, releases, notes the full read time and restores', async () => {
    const { ctx, log, st } = fake({ readMs: 1200 });
    const s = await HU_LINE_SELF_CHECK.run(ctx);
    expect(s.frames).toBe(50); expect(ctx.seconds).toBe(HU_LINE_DRAG_SECONDS); expect(HU_LINE_DRAG_SECONDS).toBe(3);
    expect(st.us[0]).toBe(0); expect(st.us.at(-1)).toBe(1);
    expect(log).toEqual(['begin', 'release', 'cancel']);
    expect(ctx.notes[0]).toMatch(/^確定読み取り 1\.2 秒$/);
  });
  it('a read that does not end within the timeout is noted as such', async () => {
    const { ctx, log } = fake({ readMs: 60000 });
    await HU_LINE_SELF_CHECK.run(ctx);
    expect(ctx.notes[0]).toMatch(/^確定読み取りが 20\.0 秒で終わらず$/); expect(log.at(-1)).toBe('cancel');
  });
  it('is skipped without the env hook, and when the drag cannot start (state still restored)', async () => {
    expect((await HU_LINE_SELF_CHECK.run({ ja: true, env: {}, skip: why => ({ skip: why }) })).skip).toBe('HU線なし');
    const { ctx, log } = fake({ begin: '線を引けません' });
    expect((await HU_LINE_SELF_CHECK.run(ctx)).skip).toBe('線を引けません');
    expect(log).toEqual(['begin', 'cancel']);
  });
  it('stops polling when the run is cancelled and still restores', async () => {
    const { ctx, log } = fake({ readMs: 60000, cancelAt: clock + 50 * 14 + 500 });
    await HU_LINE_SELF_CHECK.run(ctx);
    expect(ctx.notes).toHaveLength(0); expect(log.at(-1)).toBe('cancel');
  });
  it('the duration label is the new total (about 70 s with the zoom phases and 最大 90°静止) and the hint names the HU scenarios', () => {
    expect(selfCheckTexts(true).button).toBe('自己診断（約 70 秒）'); expect(selfCheckTexts(false).button).toBe('Self-check (about 70 s)');
    expect(selfCheckTexts(true).hint[0]).toContain('最大90°'); expect(selfCheckTexts(false).hint[0]).toContain('max at 90°');
    expect(selfCheckTexts(true).hint[0]).toContain('HU線'); expect(selfCheckTexts(false).hint[0]).toContain('HU line');
  });
  it('vr-view.js wires env.huLine to a synthetic laser and restores through huLine.restoreState (source guard)', () => {
    expect(view).toContain('selfCheck.env.huLine={');
    expect(view).toContain('pick:(c,out)=>{if(c===huSynth.c){');
    expect(view).toContain('huSynth.snap=huLine.snapshot();huLine.setArmed(true,true)');
    expect(view).toContain('huLine.start(huSynth.c)'); expect(view).toContain('huLine.end(huSynth.c)');
    expect(view).toContain('reading:()=>huLine.isReading()');
    expect(view).toContain('cancel:()=>{if(huSynth.snap){huLine.restoreState(huSynth.snap);huSynth.snap=null;if(!huSynth.placed)huPlaced=false}}');
    expect(view).toContain('huSynth.placed=huPlaced;huSynth.snap='); // a panel never placed before the self-check is placed afresh by the next real line
    // the module: a quiet arm (no flash), the read flag, and a restore that puts the shared model back even after dispose()
    expect(huSrc).toContain('if (!quiet) env.flash(');
    expect(huSrc).toContain('isReading: () => fullBusy');
    const r = huSrc.slice(huSrc.indexOf('restoreState(s) {'), huSrc.indexOf('restoreState(s) {') + 900);
    expect(r.indexOf("setHuLine(s.line.a, s.line.b, 'final', 'self-check')")).toBeLessThan(r.indexOf('if (disposed) return;'));
    expect(r.indexOf("clearHuLine('self-check')")).toBeLessThan(r.indexOf('if (disposed) return;'));
  });
});
