import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeDeferredEnd } from '../../docs/deferred-end.js';

describe('makeDeferredEnd (end of a 3D drag waits before the full-resolution frame)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs after the delay, not before', () => {
    const run = vi.fn(), d = makeDeferredEnd(run);
    d.end(200);
    expect(d.pending()).toBe(true);
    vi.advanceTimersByTime(199);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.pending()).toBe(false);
  });

  it('a drag that resumes within the delay cancels the end', () => {
    const run = vi.fn(), d = makeDeferredEnd(run);
    d.end(200);
    vi.advanceTimersByTime(120);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('a second end restarts the wait and runs once', () => {
    const run = vi.fn(), d = makeDeferredEnd(run);
    d.end(200);
    vi.advanceTimersByTime(150);
    d.end(200);
    vi.advanceTimersByTime(150);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('end(0) runs at once and drops a pending delayed end', () => {
    const run = vi.fn(), d = makeDeferredEnd(run);
    d.end(200);
    d.end(0);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('app.js wiring of the drag end', () => {
  const src = readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8');
  it('pointer release and lost capture end the drag with the delay; the wheel keeps its own 120 ms', () => {
    expect(src).toContain('const DRAG_END_DELAY_MS=200;');
    expect(src.match(/end3DInteraction\(DRAG_END_DELAY_MS\)/g)?.length).toBe(2);
    expect(src).toContain('wheelQualityTimer=setTimeout(()=>end3DInteraction(),120)');
  });
  it('a new interaction cancels the pending end', () => {
    expect(src).toMatch(/const begin3DInteraction=\(\)=>\{dragEnd\.cancel\(\)/);
    expect(src).toMatch(/if\(next\)dragEnd\.cancel\(\)/);
  });
});
