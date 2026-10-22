import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { emit, SIGNAL_KINDS, createMoveTracker, scaleChanged } from '../../docs/tutorial-signal.js';

const DOCS = new URL('../../docs/', import.meta.url);
const files = readdirSync(DOCS).filter(f => f.endsWith('.js') && f !== 'tutorial-signal.js');
const src = Object.fromEntries(files.map(f => [f, readFileSync(new URL(f, DOCS), 'utf8')]));

describe('tutorial signals', () => {
  it('has the agreed kinds', () => {
    expect(SIGNAL_KINDS.length).toBe(19);
    expect(new Set(SIGNAL_KINDS).size).toBe(19);
  });
  it('every kind has an emit site in docs/', () => {
    for (const k of SIGNAL_KINDS) {
      const hit = Object.values(src).some(s => s.includes(`emit('${k}'`));
      expect(hit, k).toBe(true);
    }
  });
  it('emit is a no-op without document and never throws', () => {
    expect(typeof document).toBe('undefined');
    expect(() => emit('home')).not.toThrow();
    expect(() => emit('home', { a: 1 })).not.toThrow();
  });
  it('dispatches vrl-tut-signal when a document exists', () => {
    const got = [];
    globalThis.document = { dispatchEvent: e => got.push(e.detail) };
    try { emit('undo', { n: 2 }); emit('label-show'); emit('label-show'); } finally { delete globalThis.document; }
    expect(got[0]).toEqual({ kind: 'undo', n: 2 });
    expect(got.filter(g => g.kind === 'label-show').length).toBe(1); // rate-limited
  });
  it('no emit inside a shader string', () => {
    for (const [f, s] of Object.entries(src)) {
      for (const m of s.matchAll(/`([^`]*)`/g)) {
        if (!/gl_Position|gl_FragColor|precision\s+\w+\s+float|@compute|@fragment|@vertex/.test(m[1])) continue;
        expect(/\bemit\(\s*'/.test(m[1]), f).toBe(false);
      }
    }
  });
  it('move tracker fires once after 0.3 m of travel', () => {
    const t = createMoveTracker();
    expect(t.step({ x: 0, y: 1.6, z: 0 })).toBe(false);
    expect(t.step({ x: 0.2, y: 1.6, z: 0 })).toBe(false);
    expect(t.step({ x: 0.4, y: 1.6, z: 0 })).toBe(true);
    expect(t.step({ x: 2, y: 1.6, z: 0 })).toBe(false);
  });
  it('move tracker reset() re-arms it (sum 0, next position is the new start)', () => {
    const t = createMoveTracker();
    t.step({ x: 0, y: 1.6, z: 0 }); t.step({ x: 0.2, y: 1.6, z: 0 }); expect(t.step({ x: 0.4, y: 1.6, z: 0 })).toBe(true);
    t.reset();
    expect(t.step({ x: 5, y: 1.6, z: 0 })).toBe(false); // the first position after reset is only the baseline (no jump counted)
    expect(t.step({ x: 5.2, y: 1.6, z: 0 })).toBe(false);
    expect(t.step({ x: 5.4, y: 1.6, z: 0 })).toBe(true);
    expect(t.step({ x: 6, y: 1.6, z: 0 })).toBe(false);
  });
  it('scale threshold is 15 %', () => {
    expect(scaleChanged(1, 1.14)).toBe(false);
    expect(scaleChanged(1, 1.2)).toBe(true);
    expect(scaleChanged(1, 0.8)).toBe(true);
  });
});
