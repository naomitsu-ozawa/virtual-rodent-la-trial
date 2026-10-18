import { describe, it, expect } from 'vitest';
import { latestOnlyRunner } from '../../docs/latest-runner.js';

const tick = () => new Promise(r => setTimeout(r, 0));

describe('latestOnlyRunner', () => {
  it('coalesces requests made during a run and runs once more with the latest state', async () => {
    let slider = 0, active = 0, maxActive = 0;
    const seen = [], gates = [];
    const run = latestOnlyRunner(async () => {
      active++; maxActive = Math.max(maxActive, active);
      seen.push(slider);
      await new Promise(r => gates.push(r));
      active--;
    });
    slider = 1; run();                  // starts rendering slice 1
    await tick();
    for (slider = 2; slider <= 9; slider++) run(); // slider keeps moving
    slider = 9;
    gates.shift()();                     // slice 1 finishes
    await tick(); await tick();
    expect(seen).toEqual([1, 9]);        // intermediate steps dropped, latest rendered
    gates.shift()();
    await tick(); await tick();
    expect(seen).toEqual([1, 9]);        // nothing new requested -> stops
    expect(maxActive).toBe(1);           // never concurrent
    expect(run.isRunning()).toBe(false);
  });

  it('keeps going after a failed run', async () => {
    const errors = [], calls = [];
    const run = latestOnlyRunner(async () => { calls.push(1); if (calls.length === 1) throw new Error('boom'); }, e => errors.push(e.message));
    run(); run();
    await tick(); await tick(); await tick();
    expect(errors).toEqual(['boom']);
    expect(calls.length).toBe(2);
  });
});
