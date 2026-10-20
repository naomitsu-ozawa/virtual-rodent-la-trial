import { describe, it, expect } from 'vitest';
import { clampPane } from '../../docs/pane-resize.js';

describe('clampPane', () => {
  it('keeps the size between the minimum and the room the other side needs', () => {
    expect(clampPane('left', 500, 1600)).toBe(500);
    expect(clampPane('left', 100, 1600)).toBe(240);
    expect(clampPane('left', 1500, 1600)).toBe(1180);
    expect(clampPane('split', 2000, 1000)).toBe(700);
    expect(clampPane('splitV', 400, 311)).toBe(151);
    expect(clampPane('bottom', 50, 900)).toBe(160);
  });
  it('never goes below the minimum, even with no room', () => {
    expect(clampPane('left', 600, 300)).toBe(240);
    expect(clampPane('splitV', 600, 100)).toBe(140);
  });
});
